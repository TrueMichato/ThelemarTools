import "../charactersheet/setup.js";
import {PartyTrackerRoot} from "../../../js/dmscreen/partytracker/dmscreen-partytracker.js";
import {evaluateCampaignRules} from "../../../js/hub/hub-campaign-rule-evaluator.js";
import {CAMPAIGN_RULES_POLICY_CAPABILITY, createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";

describe("Party Tracker campaign rules", () => {
	it("layers campaign rules for calculations without persisting them into the workspace", () => {
		let context = {
			rulesVersion: {
				id: "rules-1",
				version: 1,
				schemaVersion: 1,
				catalogVersion: 1,
				rules: {
					enableTgtt: true,
					exhaustionRules: "2024",
					thelemar_carryWeight: true,
					thelemar_encumbranceTiers: false,
					thelemar_jumping: true,
					thelemar_linguisticsBonus: false,
					thelemar_criticalRolls: true,
				},
			},
		};
		const board = {
			getHubCampaignContext: () => context,
			getHubCampaignStatus: () => null,
			fireBoardEvent: () => {},
		};
		const root = new PartyTrackerRoot(board, null);
		root.setStateFrom({
			settings: {
				et: false,
				exr: "2014",
				tcw: false,
				tet: true,
				tj: false,
				tlb: true,
				tcr: false,
			},
		});

		expect(root.getSettings()).toMatchObject({
			enableTgtt: true,
			exhaustionRules: "2024",
			thelemar_carryWeight: true,
			thelemar_encumbranceTiers: false,
		});
		expect(root.getSaveableState().settings).toMatchObject({
			et: false,
			exr: "2014",
			tcw: false,
			tet: true,
		});

		context = null;
		root.setHubCampaignContext(null);
		expect(root.getSettings()).toMatchObject({
			enableTgtt: false,
			exhaustionRules: "2014",
			thelemar_carryWeight: false,
			thelemar_encumbranceTiers: true,
		});
	});

	it("uses the schema-v2 decision and makes TGTT subrules inert with the master off", () => {
		const policy = createDefaultCampaignRulesPolicy();
		policy.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled = false;
		policy.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system = "2024";
		const rulesVersion = {id: "rules-v2", version: 2, schemaVersion: 2, catalogVersion: 1, rules: policy};
		rulesVersion.ruleDecision = evaluateCampaignRules({
			capabilities: [CAMPAIGN_RULES_POLICY_CAPABILITY],
			personalSettings: {},
			protocolVersion: 4,
			rulesVersion,
			surface: "dmProjection",
		});
		const board = {
			getHubCampaignContext: () => ({rulesVersion}),
			getHubCampaignStatus: () => null,
			fireBoardEvent: () => {},
		};
		const root = new PartyTrackerRoot(board, null);
		expect(root.getSettings()).toMatchObject({
			enableTgtt: false,
			thelemar_carryWeight: false,
			thelemar_jumping: false,
		});
	});
});
