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
});
