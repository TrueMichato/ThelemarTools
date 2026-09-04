import fs from "node:fs";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const migrationUrl = new URL("../../../server/migrations/0001_hub_core.sql", import.meta.url);
const sql = fs.readFileSync(migrationUrl, "utf8");
const lifecycleSql = fs.readFileSync(new URL("../../../server/migrations/0002_lifecycle_administration.sql", import.meta.url), "utf8");
const operationsSql = fs.readFileSync(new URL("../../../server/migrations/0003_operational_runs.sql", import.meta.url), "utf8");
const semanticOperationsSql = fs.readFileSync(new URL("../../../server/migrations/0005_semantic_character_operations.sql", import.meta.url), "utf8");
const identitySql = fs.readFileSync(new URL("../../../server/migrations/0006_multi_provider_identity.sql", import.meta.url), "utf8");
const peerSourceCostsSql = fs.readFileSync(new URL("../../../server/migrations/0007_peer_source_costs.sql", import.meta.url), "utf8");
const postgresStore = fs.readFileSync(new URL("../../../server/src/postgres-hub-store.js", import.meta.url), "utf8");

describe("campaign hub first migration contract", () => {
	it.each([
		"accounts",
		"external_identities",
		"sessions",
		"campaigns",
		"memberships",
		"invites",
		"characters",
		"character_leases",
		"dm_workspaces",
		"dm_workspace_leases",
		"brew_bundle_versions",
		"rules_versions",
		"party_inventories",
		"inventory_entries",
		"pending_actions",
		"transfers",
		"domain_events",
		"audit_entries",
		"command_receipts",
		"outbox_entries",
	])("creates the %s table", table => {
		expect(sql).toMatch(new RegExp(`CREATE TABLE hub\\.${table}\\b`));
	});

	it("places tenant identifiers on campaign-owned data", () => {
		for (const table of [
			"memberships",
			"invites",
			"characters",
			"dm_workspaces",
			"brew_bundle_versions",
			"rules_versions",
			"party_inventories",
			"inventory_entries",
			"pending_actions",
			"transfers",
			"domain_events",
		]) {
			const tableSql = sql.match(new RegExp(`CREATE TABLE hub\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
			expect(tableSql).toContain("campaign_id uuid");
		}
	});

	it("includes revision and fencing invariants before cloud writes ship", () => {
		expect(sql).toMatch(/characters[\s\S]*revision bigint NOT NULL DEFAULT 1/);
		expect(sql).toMatch(/characters[\s\S]*lease_epoch bigint NOT NULL DEFAULT 0/);
		expect(sql).toMatch(/character_leases[\s\S]*epoch bigint NOT NULL/);
		expect(sql).toMatch(/dm_workspaces[\s\S]*revision bigint NOT NULL DEFAULT 1/);
		expect(sql).toMatch(/dm_workspace_leases[\s\S]*epoch bigint NOT NULL/);
	});

	it("makes event ordering, command idempotency, and outbox delivery durable", () => {
		expect(sql).toContain("UNIQUE (campaign_id, sequence)");
		expect(sql).toContain("PRIMARY KEY (actor_account_id, idempotency_key)");
		expect(sql).toContain("command_receipts_expires_idx");
		expect(sql).toContain("expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')");
		expect(sql).toContain("FOREIGN KEY (campaign_id, event_id)");
	});

	it("requires exactly one inventory container", () => {
		expect(sql).toContain("(character_id IS NOT NULL)::integer + (party_inventory_id IS NOT NULL)::integer = 1");
	});

	it("enforces character tenant consistency at child-row write time without blocking later moves", () => {
		expect(sql).toContain("CREATE FUNCTION hub.enforce_character_campaign_match");
		expect(sql).toContain("inventory_entries_character_campaign_check");
		expect(sql).toContain("pending_actions_character_campaign_check");
		expect(sql).toContain("transfers_character_campaign_check");
	});

	it.each([
		["invite creator", "FOREIGN KEY (campaign_id, created_by_membership_id)"],
		["active campaign brew", "FOREIGN KEY (id, active_brew_bundle_version_id)"],
		["active campaign rules", "FOREIGN KEY (id, active_rules_version_id)"],
		["DM workspace owner", "FOREIGN KEY (campaign_id, owner_membership_id)"],
		["party inventory", "FOREIGN KEY (campaign_id, party_inventory_id)"],
		["inventory brew reference", "FOREIGN KEY (campaign_id, bundle_version_id)"],
		["transfer source party inventory", "FOREIGN KEY (campaign_id, source_party_inventory_id)"],
		["transfer target party inventory", "FOREIGN KEY (campaign_id, target_party_inventory_id)"],
		["outbox event", "FOREIGN KEY (campaign_id, event_id)"],
	])("enforces tenant consistency for %s", (label, constraint) => {
		expect(sql).toContain(constraint);
	});

	it("serializes first-time identity creation and idempotent commands", () => {
		expect(postgresStore.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(2);
		expect(postgresStore).toContain("[identity.provider, identity.subject]");
		expect(postgresStore).toContain("[accountId, normalized.key]");
	});

	it("stores compact expiring receipts for character-returning commands", async () => {
		const queries = [];
		const store = new PostgresHubStore({
			pool: {
				query: async () => ({rows: [], rowCount: 0}),
				connect: async () => null,
				on: () => {},
			},
		});

		await store._pSaveReceipt({
			client: {query: async (...args) => { queries.push(args); }},
			accountId: "account",
			idempotencyKey: {key: "key", requestHash: "hash"},
			commandType: "character.patch",
			response: {character: {id: "character", revision: 2, data: {notes: "large"}}},
		});
		const stored = JSON.parse(queries[0][1][4]);
		expect(stored.character).toEqual({__hubReceiptRef: "character", id: "character"});
	});

	it("adds lifecycle deletion state and safe creator/actor foreign-key behavior in migration 0002", () => {
		expect(lifecycleSql).toContain("'deletion_requested'");
		expect(lifecycleSql).toContain("accounts_deletion_due_idx");
		expect(lifecycleSql).toContain("archived_at timestamptz");
		expect(lifecycleSql).toContain("ON DELETE SET NULL (created_by_membership_id)");
		expect(lifecycleSql).toContain("pending_actions_actor_account_fk");
		expect(lifecycleSql).toContain("transfers_actor_account_fk");
		expect(lifecycleSql).toContain("domain_events_actor_account_fk");
		expect(lifecycleSql).toContain("invites_creator_membership_fk");
	});

	it("adds bounded operational run evidence in migration 0003", () => {
		expect(operationsSql).toContain("CREATE TABLE hub.operational_runs");
		expect(operationsSql).toContain("job_type IN ('maintenance', 'backup', 'restore_drill')");
		expect(operationsSql).toContain("operational_runs_job_started_idx");
	});

	it("persists semantic operations, commands, target references, and watermarks in migration 0005", () => {
		expect(semanticOperationsSql).toContain("CREATE TABLE hub.semantic_operations");
		expect(semanticOperationsSql).toContain("CREATE TABLE hub.semantic_operation_commands");
		expect(semanticOperationsSql).toContain("target_ref uuid");
		expect(semanticOperationsSql).toContain("operation_watermark bigint NOT NULL DEFAULT 0");
		expect(semanticOperationsSql).toContain("ON hub.semantic_operations (target_character_id, resulting_character_revision)");
		expect(semanticOperationsSql).toContain("command_id uuid PRIMARY KEY");
		expect(semanticOperationsSql).toContain("interval '24 hours'");
		expect(semanticOperationsSql).toContain("status = 'cancelled'");
	});

	it("adds provider-neutral identities and one-time OAuth transactions in migration 0006", () => {
		for (const required of [
			"provider_handle text",
			"provider_display_name text",
			"last_authenticated_at timestamptz",
			"UNIQUE (account_id, id)",
			"authenticated_via_identity_id uuid",
			"recent_reauthenticated_at timestamptz",
			"CREATE TABLE hub.oauth_transactions",
			"operation IN ('sign_in', 'reauthenticate', 'link')",
			"oauth_transactions_session_account_fk",
			"oauth_transactions_consumption_check",
			"oauth_transactions_expiry_idx",
			"DEFERRABLE INITIALLY DEFERRED",
		]) expect(identitySql).toContain(required);
		expect(identitySql).not.toMatch(/access_token|refresh_token|id_token/i);
		expect(identitySql).not.toMatch(/UPDATE hub\.external_identities\s+SET provider_subject/i);
	});

	it("adds constrained, retention-safe peer source-cost authority in migration 0007", () => {
		for (const required of [
			"'failed'",
			"target_owner_account_id_at_proposal uuid",
			"source_cost_version integer",
			"source_cost jsonb",
			"rules_version_id uuid",
			"rules_pin jsonb",
			"template_registry_version text",
			"effect_resolution_seed bytea",
			"octet_length(effect_resolution_seed) = 32",
			"source_revision_observed bigint",
			"target_revision_observed bigint",
			"resulting_source_character_revision bigint",
			"source_cost_event_id uuid",
			"source_cost_invalidated boolean",
			"private_failure_code text",
			"ON DELETE RESTRICT",
			"semantic_operations_source_result_check",
			"semantic_operations_live_template_idx",
			"peer_source_cost_binding_value",
			"mark_peer_source_cost_invalidated",
			"characters_peer_source_cost_invalidation",
		]) expect(peerSourceCostsSql).toContain(required);
		expect(peerSourceCostsSql).not.toMatch(/CREATE INDEX[\s\S]*source_cost\s*\)/);
	});
});
