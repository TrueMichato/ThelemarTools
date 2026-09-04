import crypto from "node:crypto";
import pg from "pg";

import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const {Pool} = pg;
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

function command (key, requestHash = `hash:${key}`) {
	return {key, requestHash};
}

function getSqlText (query) {
	return typeof query === "string" ? query : query.text;
}

function createRulesManagementInterleavingPool ({pool, pPublish}) {
	let resolveVersionsRead;
	let resolvePublished;
	const pVersionsRead = new Promise(resolve => resolveVersionsRead = resolve);
	const pPublished = new Promise(resolve => resolvePublished = resolve);
	let publishPromise = null;
	const pTriggerPublish = () => {
		publishPromise ||= pPublish().finally(resolvePublished);
		return publishPromise;
	};
	const isPointerRead = query => {
		const sql = getSqlText(query);
		return sql.includes("SELECT active_rules_version_id")
			&& sql.includes("FROM hub.campaigns")
			&& !sql.includes("FOR UPDATE");
	};
	const isVersionHistoryRead = query => {
		const sql = getSqlText(query);
		return sql.includes("FROM hub.rules_versions")
			&& sql.includes("ORDER BY version DESC");
	};
	return {
		query: async (query, values) => {
			if (isPointerRead(query)) {
				await pVersionsRead;
				await pTriggerPublish();
				return pool.query(query, values);
			}
			if (isVersionHistoryRead(query)) {
				const result = await pool.query(query, values);
				resolveVersionsRead();
				await pPublished;
				return result;
			}
			return pool.query(query, values);
		},
		connect: async () => {
			const client = await pool.connect();
			return {
				query: async (query, values) => {
					const result = await client.query(query, values);
					if (isPointerRead(query)) await pTriggerPublish();
					return result;
				},
				release: () => client.release(),
			};
		},
	};
}

function normalizeDynamicValues (value) {
	const replacements = new Map();
	let uuidIx = 0;
	const visit = input => {
		if (Array.isArray(input)) return input.map(visit);
		if (input && typeof input === "object") {
			return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child)]));
		}
		if (typeof input !== "string") return input;
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
			if (!replacements.has(input)) replacements.set(input, `<uuid:${++uuidIx}>`);
			return replacements.get(input);
		}
		if (/^\d{4}-\d{2}-\d{2}T/.test(input)) return "<timestamp>";
		return input;
	};
	return visit(structuredClone(value));
}

async function pRunScenario (store, label) {
	const account = await store.pUpsertOAuthAccount({
		provider: "test",
		providerSubject: `${label}-${crypto.randomUUID()}`,
		displayName: `${label} DM`,
	});
	const campaign = (await store.pCreateCampaign({
		accountId: account.id,
		name: `${label} rules`,
		idempotencyKey: command(`${label}:campaign`),
	})).campaign;
	const initialPolicy = createDefaultCampaignRulesPolicy();
	const first = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: initialPolicy,
		expectedActiveRulesVersionId: null,
		idempotencyKey: command(`${label}:publish:1`),
	});
	const replay = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: initialPolicy,
		expectedActiveRulesVersionId: null,
		idempotencyKey: command(`${label}:publish:1`),
	});
	const changedPolicy = createDefaultCampaignRulesPolicy();
	changedPolicy.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
	const second = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: changedPolicy,
		expectedActiveRulesVersionId: first.rulesVersion.id,
		idempotencyKey: command(`${label}:publish:2`),
	});
	const rolledBack = await store.pActivateRulesPolicyVersion({
		accountId: account.id,
		campaignId: campaign.id,
		rulesVersionId: first.rulesVersion.id,
		expectedActiveRulesVersionId: second.rulesVersion.id,
		idempotencyKey: command(`${label}:rollback`),
	});
	return {
		account,
		campaign,
		first,
		replay,
		second,
		rolledBack,
		management: await store.pGetRulesPolicyManagement({accountId: account.id, campaignId: campaign.id}),
		context: await store.pGetCampaignContext({accountId: account.id, campaignId: campaign.id}),
	};
}

function getMemoryEvidence (store, campaignId) {
	return {
		audit: store._audit
			.filter(entry => entry.campaignId === campaignId && entry.action.startsWith("rules."))
			.map(entry => ({action: entry.action, targetType: entry.targetType, targetId: entry.targetId, details: entry.details || {}}))
			.sort((a, b) => a.action.localeCompare(b.action)),
		events: store._events
			.filter(event => event.campaignId === campaignId && event.type === "rules.activated")
			.map(event => ({
				sequence: event.sequence,
				type: event.type,
				aggregateType: event.aggregateType,
				aggregateId: event.aggregateId,
				aggregateRevision: event.aggregateRevision,
				visibility: event.visibility,
				payload: event.payload,
			})),
		outboxCount: store._outbox.filter(entry => entry.campaignId === campaignId).length,
	};
}

async function pGetPostgresEvidence (pool, campaignId) {
	const [audit, events, outbox] = await Promise.all([
		pool.query(`
			SELECT action, target_type, target_id, details
			FROM hub.audit_entries
			WHERE campaign_id = $1 AND action LIKE 'rules.%'
			ORDER BY created_at, id
		`, [campaignId]),
		pool.query(`
			SELECT sequence, event_type, aggregate_type, aggregate_id, aggregate_revision, visibility, payload
			FROM hub.domain_events
			WHERE campaign_id = $1 AND event_type = 'rules.activated'
			ORDER BY sequence
		`, [campaignId]),
		pool.query(`SELECT count(*)::integer AS count FROM hub.outbox_entries WHERE campaign_id = $1`, [campaignId]),
	]);
	return {
		audit: audit.rows.map(row => ({
			action: row.action,
			targetType: row.target_type,
			targetId: row.target_id,
			details: row.details,
		})).sort((a, b) => a.action.localeCompare(b.action)),
		events: events.rows.map(row => ({
			sequence: Number(row.sequence),
			type: row.event_type,
			aggregateType: row.aggregate_type,
			aggregateId: row.aggregate_id,
			aggregateRevision: row.aggregate_revision == null ? null : Number(row.aggregate_revision),
			visibility: row.visibility,
			payload: row.payload,
		})),
		outboxCount: outbox.rows[0].count,
	};
}

describePostgres("Campaign rules policy PostgreSQL parity", () => {
	let pool;

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 6,
		});
	});

	afterAll(async () => pool.end());

	it("matches memory response, compatibility, audit, ordered-event, and outbox behavior exactly", async () => {
		const memoryStore = new MemoryHubStore();
		const postgresStore = new PostgresHubStore({pool});
		await postgresStore.pCheckHealth();
		const memory = await pRunScenario(memoryStore, "memory");
		const postgres = await pRunScenario(postgresStore, "postgres");

		for (const key of ["first", "replay", "second", "rolledBack", "management", "context"]) {
			expect(normalizeDynamicValues(postgres[key])).toEqual(normalizeDynamicValues(memory[key]));
		}
		expect(postgres.first).toEqual(postgres.replay);
		expect(postgres.management.versions.map(version => version.version)).toEqual([2, 1]);
		expect(postgres.context.rulesVersion.id).toBe(postgres.first.rulesVersion.id);
		expect(postgres.context.rulesVersion.policy).toBeUndefined();

		const memoryEvidence = getMemoryEvidence(memoryStore, memory.campaign.id);
		const postgresEvidence = await pGetPostgresEvidence(pool, postgres.campaign.id);
		expect(normalizeDynamicValues(postgresEvidence)).toEqual(normalizeDynamicValues(memoryEvidence));
		expect(postgresEvidence.events.map(event => event.sequence)).toEqual([2, 3, 4]);
		expect(postgresEvidence.events.map(event => event.payload.operation)).toEqual(["publish", "publish", "rollback"]);
	});

	it("supplies the complete active rules identity to carry projections", async () => {
		const store = new PostgresHubStore({pool});
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `rules-projection-${crypto.randomUUID()}`,
			displayName: "Rules Projection",
		});
		const campaign = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Rules projection",
			idempotencyKey: command("rules-projection-campaign"),
		})).campaign;
		const published = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: command("rules-projection-policy"),
		});

		const basisContext = await store._pGetCarryBasisContext(campaign.id);
		expect(basisContext.rulesVersion).toMatchObject({
			id: published.rulesVersion.id,
			version: published.rulesVersion.version,
			schemaVersion: 2,
			rules: expect.objectContaining({
				schemaVersion: 2,
				catalogVersion: published.rulesVersion.catalogVersion,
			}),
		});
	});

	it("rejects a stale schema-v2 character create without a partial PostgreSQL write", async () => {
		const store = new PostgresHubStore({pool});
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `rules-fence-${crypto.randomUUID()}`,
			displayName: "Rules Fence",
		});
		const campaign = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Rules fence",
			idempotencyKey: command("rules-fence-campaign"),
		})).campaign;
		const active = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: command("rules-fence-policy"),
		});
		for (const {label, basis, protocolVersion, code} of [
			{label: "missing", basis: {kind: "campaign", settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "detached", basis: {kind: "detached", settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "stale", basis: {kind: "campaign", rulesVersionId: crypto.randomUUID(), settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "old-protocol", basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: "3", code: "RULES_PROTOCOL_UNSUPPORTED"},
			{label: "omitted-protocol", basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: null, code: "RULES_PROTOCOL_UNSUPPORTED"},
		]) {
			await expect(store.pCreateCharacter({
				accountId: account.id,
				campaignId: campaign.id,
				clientImportId: `invalid-${label}-${crypto.randomUUID()}`,
				schemaVersion: 1,
				data: {carry: {schemaVersion: 1, basis}},
				protocolVersion,
				idempotencyKey: command(`rules-invalid-create-${label}`),
			})).rejects.toEqual(expect.objectContaining({code}));
		}
		const invalidCount = await pool.query(`SELECT count(*)::integer AS count FROM hub.characters WHERE campaign_id = $1`, [campaign.id]);
		expect(invalidCount.rows[0].count).toBe(0);
		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "stale",
			schemaVersion: 1,
			data: {carry: {basis: {kind: "campaign", rulesVersionId: crypto.randomUUID(), settingsDigest: "digest"}}},
			protocolVersion: "4",
			idempotencyKey: command("rules-fence-character"),
		})).rejects.toEqual(expect.objectContaining({code: "POLICY_VERSION_STALE"}));
		const count = await pool.query(`SELECT count(*)::integer AS count FROM hub.characters WHERE campaign_id = $1`, [campaign.id]);
		expect(count.rows[0].count).toBe(0);

		const created = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "current",
			schemaVersion: 1,
			data: {carry: {basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}}},
			protocolVersion: "4",
			idempotencyKey: command("rules-current-character"),
		});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: "b".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const lease = await store.pAcquireCharacterLease({
			accountId: account.id,
			sessionId: session.id,
			characterId: created.character.id,
		});
		const evidenceBefore = await pGetPostgresEvidence(pool, campaign.id);
		for (const {basis, protocolVersion} of [
			{basis: {kind: "campaign", settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "detached", settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "campaign", rulesVersionId: crypto.randomUUID(), settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: null},
			{basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: "3"},
		]) {
			await expect(store.pPatchCharacter({
				accountId: account.id,
				sessionId: session.id,
				characterId: created.character.id,
				baseRevision: created.character.revision,
				leaseEpoch: lease.epoch,
				patches: [{op: "replace", path: "/carry", value: {schemaVersion: 1, basis}}],
				protocolVersion,
				idempotencyKey: command(`rules-patch-${protocolVersion}-${basis.kind}`),
			})).rejects.toEqual(expect.objectContaining({
				code: expect.stringMatching(/POLICY_VERSION_STALE|RULES_PROTOCOL_UNSUPPORTED/),
			}));
		}
		const unchanged = await pool.query(`SELECT revision FROM hub.characters WHERE id = $1`, [created.character.id]);
		expect(Number(unchanged.rows[0].revision)).toBe(created.character.revision);
		expect(await pGetPostgresEvidence(pool, campaign.id)).toEqual(evidenceBefore);
		const patched = await store.pPatchCharacter({
			accountId: account.id,
			sessionId: session.id,
			characterId: created.character.id,
			baseRevision: created.character.revision,
			leaseEpoch: lease.epoch,
			patches: [{
				op: "replace",
				path: "/carry",
				value: {schemaVersion: 1, basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}},
			}],
			protocolVersion: "4",
			idempotencyKey: command("rules-patch-current"),
		});
		expect(patched.character.revision).toBe(created.character.revision + 1);

		const destination = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Rules destination",
			idempotencyKey: command("rules-destination-campaign"),
		})).campaign;
		await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: destination.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: command("rules-destination-policy"),
		});
		const detached = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: null,
			clientImportId: `rules-detached-${crypto.randomUUID()}`,
			schemaVersion: 1,
			data: {name: "Detached", carry: {schemaVersion: 1, basis: {kind: "detached"}}},
			idempotencyKey: command("rules-detached-create"),
		});
		const attached = await store.pMoveCharacter({
			accountId: account.id,
			characterId: detached.character.id,
			campaignId: destination.id,
			idempotencyKey: command("rules-detached-attach"),
		});
		expect(attached.character.data.carry).toBeUndefined();
		await store.pReleaseCharacterLease({
			accountId: account.id,
			sessionId: session.id,
			characterId: created.character.id,
		});
		const cloned = await store.pCloneCharacter({
			accountId: account.id,
			characterId: created.character.id,
			campaignId: destination.id,
			idempotencyKey: command("rules-destination-clone"),
		});
		expect(cloned.character.data.carry).toBeUndefined();
		const moved = await store.pMoveCharacter({
			accountId: account.id,
			characterId: cloned.character.id,
			campaignId: campaign.id,
			idempotencyKey: command("rules-destination-move"),
		});
		expect(moved.character.data.carry).toBeUndefined();
	});

	it("serializes concurrent writers against one base and rolls the stale transaction back fully", async () => {
		const store = new PostgresHubStore({pool});
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `rules-concurrency-${crypto.randomUUID()}`,
			displayName: "Rules Concurrency DM",
		});

		const campaign = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Rules concurrency",
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const policyA = createDefaultCampaignRulesPolicy();
		const policyB = createDefaultCampaignRulesPolicy();
		policyA.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
		policyB.rules.find(rule => rule.id === "tgtt.critical-rolls").parameters.enabled = false;
		const settled = await Promise.allSettled([
			store.pCreateAndActivateRulesPolicy({
				accountId: account.id,
				campaignId: campaign.id,
				policy: policyA,
				expectedActiveRulesVersionId: null,
				idempotencyKey: command("pg-concurrent-a"),
			}),
			store.pCreateAndActivateRulesPolicy({
				accountId: account.id,
				campaignId: campaign.id,
				policy: policyB,
				expectedActiveRulesVersionId: null,
				idempotencyKey: command("pg-concurrent-b"),
			}),
		]);
		expect(settled.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
		expect(settled.find(result => result.status === "rejected").reason).toEqual(expect.objectContaining({
			code: "RULES_VERSION_STALE",
			status: 409,
		}));
		const versions = await store.pGetRulesPolicyManagement({accountId: account.id, campaignId: campaign.id});
		expect(versions.versions).toHaveLength(1);
		const evidence = await pGetPostgresEvidence(pool, campaign.id);
		expect(evidence.audit).toHaveLength(2);
		expect(evidence.events).toHaveLength(1);
		expect(evidence.outboxCount).toBe(2);
	});

	it("keeps the active pointer and version history in one snapshot during a concurrent publish", async () => {
		const writer = new PostgresHubStore({pool});
		const account = await writer.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `rules-management-snapshot-${crypto.randomUUID()}`,
			displayName: "Rules Snapshot DM",
		});
		const campaign = (await writer.pCreateCampaign({
			accountId: account.id,
			name: "Rules management snapshot",
			idempotencyKey: command("snapshot-campaign"),
		})).campaign;
		const first = await writer.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: command("snapshot-publish-first"),
		});
		const changed = createDefaultCampaignRulesPolicy();
		changed.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
		const interleavingPool = createRulesManagementInterleavingPool({
			pool,
			pPublish: () => writer.pCreateAndActivateRulesPolicy({
				accountId: account.id,
				campaignId: campaign.id,
				policy: changed,
				expectedActiveRulesVersionId: first.rulesVersion.id,
				idempotencyKey: command("snapshot-publish-second"),
			}),
		});
		const reader = new PostgresHubStore({pool: interleavingPool});

		const management = await reader.pGetRulesPolicyManagement({
			accountId: account.id,
			campaignId: campaign.id,
		});
		expect(management.activeRulesVersionId).toBe(first.rulesVersion.id);
		expect(management.versions.map(version => version.id)).toEqual([first.rulesVersion.id]);
		const afterPublish = await writer.pGetRulesPolicyManagement({accountId: account.id, campaignId: campaign.id});
		expect(afterPublish.activeRulesVersionId).not.toBe(management.activeRulesVersionId);
		expect(afterPublish.versions.some(version => version.id === afterPublish.activeRulesVersionId)).toBe(true);
	});
});
