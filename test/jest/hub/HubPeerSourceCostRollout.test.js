import {
	parsePeerSourceCostsCampaignIds,
	pCheckPeerSourceCostsCampaignReadiness,
} from "../../../server/src/peer-source-cost-rollout.js";

const CAMPAIGN_A = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_B = "22222222-2222-4222-8222-222222222222";

describe("peer source-cost rollout configuration", () => {
	it("accepts only a bounded set of exact campaign UUIDs in production", () => {
		expect(parsePeerSourceCostsCampaignIds(` ${CAMPAIGN_A.toUpperCase()} , ${CAMPAIGN_B} `))
			.toEqual([CAMPAIGN_A, CAMPAIGN_B]);
		expect(() => parsePeerSourceCostsCampaignIds("*")).toThrow(expect.objectContaining({
			code: "WILDCARD_NOT_ALLOWED",
		}));
		expect(() => parsePeerSourceCostsCampaignIds(`${CAMPAIGN_A},${CAMPAIGN_A}`)).toThrow(expect.objectContaining({
			code: "DUPLICATE_CAMPAIGN_ID",
		}));
		expect(() => parsePeerSourceCostsCampaignIds("not-a-campaign")).toThrow(expect.objectContaining({
			code: "INVALID_CAMPAIGN_ID",
		}));
	});

	it("permits the wildcard only when an isolated test stack opts in", () => {
		expect(parsePeerSourceCostsCampaignIds("*", {allowWildcard: true})).toEqual(["*"]);
		expect(() => parsePeerSourceCostsCampaignIds(`*,${CAMPAIGN_A}`, {allowWildcard: true}))
			.toThrow(expect.objectContaining({code: "WILDCARD_MUST_BE_EXCLUSIVE"}));
	});

	it("requires every configured campaign to be active with an immutable rules version", async () => {
		const queryable = {
			query: async (sql, params) => {
				expect(sql).toContain("active_rules_version_id");
				expect(params).toEqual([[CAMPAIGN_A, CAMPAIGN_B]]);
				return {
					rows: [
						{id: CAMPAIGN_A, status: "active", active_rules_version_id: "rules-a"},
						{id: CAMPAIGN_B, status: "archived", active_rules_version_id: null},
					],
				};
			},
		};

		await expect(pCheckPeerSourceCostsCampaignReadiness({
			queryable,
			campaignIds: [CAMPAIGN_A, CAMPAIGN_B],
		})).rejects.toMatchObject({
			code: "CAMPAIGN_ROLLOUT_NOT_READY",
			details: {
				blockers: [{campaignId: CAMPAIGN_B, reason: "campaign_not_active"}],
			},
		});
	});

	it("reports a ready exact-id enrollment without mutating campaign state", async () => {
		const queryable = {
			query: async () => ({
				rows: [
					{id: CAMPAIGN_A, status: "active", active_rules_version_id: "rules-a"},
					{id: CAMPAIGN_B, status: "active", active_rules_version_id: "rules-b"},
				],
			}),
		};

		await expect(pCheckPeerSourceCostsCampaignReadiness({
			queryable,
			campaignIds: [CAMPAIGN_A, CAMPAIGN_B],
		})).resolves.toEqual({
			configuredCampaignCount: 2,
			readyCampaignCount: 2,
		});
	});
});
