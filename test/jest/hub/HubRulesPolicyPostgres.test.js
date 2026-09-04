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

function setContentPolicy (policy, {sources, species, editions}) {
	policy.rules.find(rule => rule.id === "content.sources.allowed").parameters.sources = sources;
	policy.rules.find(rule => rule.id === "content.species.allowed").parameters.species = species;
	policy.rules.find(rule => rule.id === "content.editions.allowed").parameters.editions = editions;
	return policy;
}

async function pGetErrorCode (promise) {
	try {
		await promise;
		return null;
	} catch (error) {
		return error?.code || null;
	}
}

async function pRunContentScenario (store, label) {
	const account = await store.pUpsertOAuthAccount({
		provider: "test",
		providerSubject: `${label}-content-${crypto.randomUUID()}`,
		displayName: `${label} content DM`,
	});
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(Date.now() + 60_000),
	});
	const campaign = (await store.pCreateCampaign({
		accountId: account.id,
		name: `${label} content policy`,
		idempotencyKey: command(`${label}:content:campaign`),
	})).campaign;
	const permissive = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: createDefaultCampaignRulesPolicy(),
		expectedActiveRulesVersionId: null,
		idempotencyKey: command(`${label}:content:permissive`),
	});
	const legacy = (await store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		data: {
			name: "Private legacy name",
			race: {name: "Elf", source: "XPHB", edition: "one"},
			inventory: [{id: "legacy-item", item: {name: "Legacy item", source: "XPHB", edition: "one"}, quantity: 1}],
		},
		schemaVersion: 1,
		clientImportId: `${label}:legacy`,
		rulesVersionId: permissive.rulesVersion.id,
		idempotencyKey: command(`${label}:content:legacy`),
	})).character;
	const detached = (await store.pCreateCharacter({
		accountId: account.id,
		data: {name: "Detached", feats: [{name: "Personal feat", source: "PERSONAL"}]},
		schemaVersion: 1,
		clientImportId: `${label}:detached`,
		idempotencyKey: command(`${label}:content:detached`),
	})).character;
	const restrictedPolicy = setContentPolicy(createDefaultCampaignRulesPolicy(), {
		sources: ["PHB"],
		species: ["Human (Base)|PHB"],
		editions: ["2014"],
	});
	const restricted = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: restrictedPolicy,
		expectedActiveRulesVersionId: permissive.rulesVersion.id,
		idempotencyKey: command(`${label}:content:restricted`),
	});
	const rulesVersionId = restricted.rulesVersion.id;
	const allowed = (await store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		data: {name: "Allowed", race: {name: "Human (Base)", source: "PHB", edition: "classic"}, inventory: []},
		schemaVersion: 1,
		clientImportId: `${label}:allowed`,
		rulesVersionId,
		idempotencyKey: command(`${label}:content:allowed`),
	})).character;
	const transfer = (await store.pProposeTransfer({
		accountId: account.id,
		campaignId: campaign.id,
		sourceKind: "character",
		sourceId: legacy.id,
		targetKind: "character",
		targetId: allowed.id,
		payload: {items: [{entryId: "legacy-item", quantity: 1}]},
		idempotencyKey: command(`${label}:content:transfer`),
	})).transfer;
	const legacyAfterReservation = (await store.pGetCharacter({
		accountId: account.id,
		characterId: legacy.id,
	})).character;
	const sessionId = session.id;
	const lease = await store.pAcquireCharacterLease({
		accountId: account.id,
		sessionId,
		characterId: legacy.id,
	});
	const unrelated = (await store.pPatchCharacter({
		accountId: account.id,
		sessionId,
		characterId: legacy.id,
		baseRevision: legacyAfterReservation.revision,
		leaseEpoch: lease.epoch,
		patches: [{op: "replace", path: "/name", value: "Legacy renamed"}],
		rulesVersionId,
		idempotencyKey: command(`${label}:content:unrelated`),
	})).character;
	const eventsBeforeRejectedWrites = (await store.pListVisibleEvents({
		accountId: account.id,
		campaignId: campaign.id,
		limit: 500,
	})).length;
	const codes = {
		import: await pGetErrorCode(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Denied import", race: {name: "Elf", source: "XPHB", edition: "one"}},
			schemaVersion: 1,
			clientImportId: `${label}:denied-import`,
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-import`),
		})),
		stalePin: await pGetErrorCode(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name: "Stale pin", race: {name: "Human (Base)", source: "PHB", edition: "classic"}},
			schemaVersion: 1,
			clientImportId: `${label}:stale-pin`,
			rulesVersionId: permissive.rulesVersion.id,
			idempotencyKey: command(`${label}:content:stale-pin`),
		})),
		patch: await pGetErrorCode(store.pPatchCharacter({
			accountId: account.id,
			sessionId,
			characterId: legacy.id,
			baseRevision: unrelated.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "add", path: "/feats", value: [{name: "Denied feat", source: "XPHB", edition: "one"}]}],
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-patch`),
		})),
		clone: await pGetErrorCode(store.pCloneCharacter({
			accountId: account.id,
			characterId: legacy.id,
			campaignId: campaign.id,
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-clone`),
		})),
		move: await pGetErrorCode(store.pMoveCharacter({
			accountId: account.id,
			characterId: detached.id,
			campaignId: campaign.id,
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-move`),
		})),
		grant: await pGetErrorCode(store.pGrantItem({
			accountId: account.id,
			campaignId: campaign.id,
			characterId: allowed.id,
			item: {name: "Denied item", source: "XPHB", edition: "one"},
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-grant`),
		})),
		award: await pGetErrorCode(store.pAwardItems({
			accountId: account.id,
			campaignId: campaign.id,
			source: {kind: "catalog", item: {name: "Denied batch item", source: "XPHB", edition: "one"}},
			targetCharacterIds: [allowed.id],
			quantity: 1,
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-award`),
		})),
		transferStalePin: await pGetErrorCode(store.pResolveTransfer({
			accountId: account.id,
			campaignId: campaign.id,
			transferId: transfer.id,
			decision: "accept",
			rulesVersionId: permissive.rulesVersion.id,
			idempotencyKey: command(`${label}:content:stale-transfer`),
		})),
		transfer: await pGetErrorCode(store.pResolveTransfer({
			accountId: account.id,
			campaignId: campaign.id,
			transferId: transfer.id,
			decision: "accept",
			rulesVersionId,
			idempotencyKey: command(`${label}:content:denied-transfer`),
		})),
	};
	const eventsAfterRejectedWrites = (await store.pListVisibleEvents({
		accountId: account.id,
		campaignId: campaign.id,
		limit: 500,
	})).length;
	await store.pResolveTransfer({
		accountId: account.id,
		campaignId: campaign.id,
		transferId: transfer.id,
		decision: "reject",
		idempotencyKey: command(`${label}:content:restore-transfer`),
	});
	const rolledBack = await store.pActivateRulesPolicyVersion({
		accountId: account.id,
		campaignId: campaign.id,
		rulesVersionId: permissive.rulesVersion.id,
		expectedActiveRulesVersionId: rulesVersionId,
		idempotencyKey: command(`${label}:content:rollback`),
	});
	const admittedAfterRollback = (await store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		data: {name: "Admitted after rollback", race: {name: "Elf", source: "XPHB", edition: "one"}},
		schemaVersion: 1,
		clientImportId: `${label}:after-rollback`,
		rulesVersionId: permissive.rulesVersion.id,
		idempotencyKey: command(`${label}:content:after-rollback`),
	})).character;
	return {
		codes,
		unrelated: {
			name: unrelated.data.name,
			raceSource: unrelated.data.race.source,
		},
		rejectedEventDelta: eventsAfterRejectedWrites - eventsBeforeRejectedWrites,
		restoredLegacyItem: (await store.pGetCharacter({accountId: account.id, characterId: legacy.id}))
			.character.data.inventory.some(entry => entry.id === "legacy-item"),
		detachedCampaignId: (await store.pGetCharacter({accountId: account.id, characterId: detached.id})).character.campaignId,
		rolledBackToFirstVersion: rolledBack.rulesVersion.id === permissive.rulesVersion.id,
		admittedAfterRollbackSource: admittedAfterRollback.data.race.source,
		versions: (await store.pGetRulesPolicyManagement({accountId: account.id, campaignId: campaign.id}))
			.versions.map(version => version.version),
	};
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

	it("matches memory enforcement for admissions, writes, grandfathering, rollback, atomicity, and privacy", async () => {
		const memory = await pRunContentScenario(new MemoryHubStore(), "memory");
		const postgresStore = new PostgresHubStore({pool});
		await postgresStore.pCheckHealth();
		const postgres = await pRunContentScenario(postgresStore, "postgres");

		expect(postgres).toEqual(memory);
		expect(postgres).toEqual({
			codes: {
				import: "CONTENT_POLICY_VIOLATION",
				stalePin: "RULES_VERSION_STALE",
				patch: "CONTENT_POLICY_VIOLATION",
				clone: "CONTENT_POLICY_VIOLATION",
				move: "CONTENT_POLICY_VIOLATION",
				grant: "CONTENT_POLICY_VIOLATION",
				award: "CONTENT_POLICY_VIOLATION",
				transferStalePin: "RULES_VERSION_STALE",
				transfer: "CONTENT_POLICY_VIOLATION",
			},
			unrelated: {name: "Legacy renamed", raceSource: "XPHB"},
			rejectedEventDelta: 0,
			restoredLegacyItem: true,
			detachedCampaignId: null,
			rolledBackToFirstVersion: true,
			admittedAfterRollbackSource: "XPHB",
			versions: [2, 1],
		});
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
		const cursor = await store.pGetCampaignCursor({accountId: account.id, campaignId: campaign.id});
		expect(cursor.campaign).toEqual(expect.objectContaining({
			activeRulesVersionId: versions.activeRulesVersionId,
			activeBrewBundleVersionId: null,
		}));
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
