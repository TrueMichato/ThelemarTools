import "../charactersheet/setup.js";
import {PartyTrackerRoot} from "../../../js/dmscreen/partytracker/dmscreen-partytracker.js";

describe("Party Tracker campaign rules", () => {
	it("layers campaign rules for calculations without persisting them into the workspace", () => {
		let context = {
			rulesVersion: {
				id: "rules-1",
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
});
