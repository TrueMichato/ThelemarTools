import fs from "node:fs";

import {
	MultiTargetOperationsRolloutError,
	parseMultiTargetOperationsCampaignIds,
	pCheckMultiTargetOperationsCampaignReadiness,
} from "../../../server/src/multi-target-operation-rollout.js";
import {getMultiTargetOperationsCapability} from "../../../js/hub/hub-multi-target-operations.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const CAMPAIGN_A = "00000000-0000-4000-8000-000000000001";
const CAMPAIGN_B = "00000000-0000-4000-8000-000000000002";

describe("multi-target rollout enrollment", () => {
	it("requires bounded exact campaign UUIDs outside isolated tests", () => {
		expect(getMultiTargetOperationsCapability()).toEqual({
			enabled: false,
			contractVersion: 1,
			protocolVersion: 6,
			maxTargets: 8,
			collectionTtlSeconds: 600,
			operationTtlSeconds: 86400,
			supportsSourceOwnedFinalizationConsent: true,
			supportsPartialSelection: true,
			supportsPartialCommit: false,
			templateRegistryVersion: "multi-target-effects-v1",
		});
		expect(parseMultiTargetOperationsCampaignIds(`${CAMPAIGN_A},${CAMPAIGN_B}`)).toEqual([
			CAMPAIGN_A,
			CAMPAIGN_B,
		]);
		expect(() => parseMultiTargetOperationsCampaignIds("*")).toThrow(expect.objectContaining({
			code: "WILDCARD_NOT_ALLOWED",
		}));
		expect(() => parseMultiTargetOperationsCampaignIds(`${CAMPAIGN_A},${CAMPAIGN_A}`)).toThrow(
			expect.objectContaining({code: "DUPLICATE_CAMPAIGN_ID"}),
		);
		expect(parseMultiTargetOperationsCampaignIds("*", {allowWildcard: true})).toEqual(["*"]);
	});

	it("checks migration 0011, normalized tables, active campaign, and rules pins", async () => {
		const queryable = {
			query: async (sql, params) => {
				if (sql.includes("schema_migrations")) {
					return {rows: [{
						migration_ready: true,
						targets_ready: true,
						finalizations_ready: true,
						usage_marker_ready: true,
						campaign_marker_ready: true,
					}]};
				}
				expect(params).toEqual([[CAMPAIGN_A, CAMPAIGN_B]]);
				return {rows: [
					{id: CAMPAIGN_A, status: "active", active_rules_version_id: "rules-a"},
					{id: CAMPAIGN_B, status: "active", active_rules_version_id: "rules-b"},
				]};
			},
		};
		await expect(pCheckMultiTargetOperationsCampaignReadiness({
			queryable,
			campaignIds: [CAMPAIGN_A, CAMPAIGN_B],
		})).resolves.toEqual({
			configuredCampaignCount: 2,
			readyCampaignCount: 2,
			migrationVersion: "0011",
		});
	});

	it("fails closed for missing schema or campaign authority", async () => {
		await expect(pCheckMultiTargetOperationsCampaignReadiness({
			queryable: {
				query: async () => ({rows: [{
					migration_ready: true,
					targets_ready: false,
					finalizations_ready: true,
					usage_marker_ready: true,
					campaign_marker_ready: true,
				}]}),
			},
			campaignIds: [CAMPAIGN_A],
		})).rejects.toEqual(expect.objectContaining({code: "SCHEMA_NOT_READY"}));

		const queryable = {
			query: async sql => sql.includes("schema_migrations")
				? {rows: [{
					migration_ready: true,
					targets_ready: true,
					finalizations_ready: true,
					usage_marker_ready: true,
					campaign_marker_ready: true,
				}]}
				: {rows: [{id: CAMPAIGN_A, status: "archived", active_rules_version_id: null}]},
		};
		await expect(pCheckMultiTargetOperationsCampaignReadiness({
			queryable,
			campaignIds: [CAMPAIGN_A],
		})).rejects.toEqual(expect.objectContaining({
			code: "CAMPAIGN_ROLLOUT_NOT_READY",
			details: {blockers: [{campaignId: CAMPAIGN_A, reason: "campaign_not_active"}]},
		}));
	});

	it("uses stable rollout error identities", () => {
		expect(new MultiTargetOperationsRolloutError("CODE", "message")).toMatchObject({
			name: "MultiTargetOperationsRolloutError",
			code: "CODE",
		});
	});

	it("exposes the exact readiness preflight through the PostgreSQL store", async () => {
		const pool = {
			on: () => {},
			connect: async () => {
				throw new Error("not used");
			},
			query: async (sql, params) => {
				if (sql.includes("schema_migrations")) {
					return {rows: [{
						migration_ready: true,
						targets_ready: true,
						finalizations_ready: true,
						usage_marker_ready: true,
						campaign_marker_ready: true,
					}]};
				}
				expect(params).toEqual([[CAMPAIGN_A]]);
				return {rows: [{
					id: CAMPAIGN_A,
					status: "active",
					active_rules_version_id: "rules-a",
				}]};
			},
		};
		const store = new PostgresHubStore({pool});
		await expect(store.pCheckMultiTargetOperationsCampaignReadiness({
			campaignIds: [CAMPAIGN_A],
		})).resolves.toEqual({
			configuredCampaignCount: 1,
			readyCampaignCount: 1,
			migrationVersion: "0011",
		});
	});

	it("runs the nonempty exact-campaign preflight before production initialization", () => {
		const source = fs.readFileSync(
			new URL("../../../server/src/index.js", import.meta.url),
			"utf8",
		);
		expect(source).toContain("const multiTargetOperationsCampaignIds = parseMultiTargetOperationsCampaignIds(");
		expect(source).toContain("multiTargetOperationsEnabled: multiTargetOperationsCampaignIds");
		expect(source).toContain("if (multiTargetOperationsCampaignIds.length)");
		expect(source).toContain("await store.pCheckMultiTargetOperationsCampaignReadiness({");
		expect(source.indexOf("await store.pCheckMultiTargetOperationsCampaignReadiness({"))
			.toBeLessThan(source.indexOf("await store.pReconcileConfiguredOperatorEntitlements({"));
		expect(source.indexOf("await store.pCheckMultiTargetOperationsCampaignReadiness({"))
			.toBeLessThan(source.indexOf("const app = await createHubApp({"));
	});
});
