import "../../../js/parser.js";
import "../../../js/utils.js";
import {
	PartyTrackerRoot,
} from "../../../js/dmscreen/partytracker/dmscreen-partytracker.js";

describe("live Party Tracker projections", () => {
	it("injects linked campaign characters without persisting them in the Board blob", () => {
		const events = [];
		const root = new PartyTrackerRoot({fireBoardEvent: event => events.push(event), doSaveStateDebounced () {}}, null);
		root.setStateFrom({
			characters: [{
				id: "manual",
				n: "Manual",
				ab: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
				cl: [{n: "Fighter", l: 1, s: "PHB"}],
			}],
		});
		root.setHubCharacterProjections([{
			id: "cloud",
			data: {
				name: "Cloud",
				abilities: {str: 12, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
				classes: [{name: "Wizard", level: 3, source: "PHB"}],
				hp: {current: 12, max: 18},
			},
		}]);

		expect(root.getCharacters().map(it => it.name)).toEqual(["Manual", "Cloud"]);
		const saved = root.getSaveableState();
		expect(saved.characters).toHaveLength(1);
		expect(saved.characters[0].id).toBe("manual");
		expect(events).toContainEqual({type: "partyTrackerUpdate"});
	});
});
