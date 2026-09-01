import fs from "node:fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import {
	PartyTrackerRoot,
} from "../../../js/dmscreen/partytracker/dmscreen-partytracker.js";

const characterSource = fs.readFileSync(new URL("../../../js/dmscreen/partytracker/dmscreen-partytracker-character.js", import.meta.url), "utf8");

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
		expect(root.getCharacters().find(it => it.name === "Cloud")?.isHubProjection).toBe(true);
		const saved = root.getSaveableState();
		expect(saved.characters).toHaveLength(1);
		expect(saved.characters[0].id).toBe("manual");
		expect(events).toContainEqual({type: "partyTrackerUpdate"});
	});

	it("uses valid DOM class tokens and hides mutation controls for linked rows", () => {
		expect(characterSource).toContain(".addClass(\"glyphicon\")");
		expect(characterSource).toMatch(/\.addClass\(`glyphicon-\$\{this\._isExpanded \? "minus" : "plus"}`\)/);
		expect(characterSource).not.toContain(".addClass(`glyphicon glyphicon-");
		expect(characterSource).toMatch(/\$\{this\._isReadOnly \? "" : btnRemove\}/);
		expect(characterSource).toContain("Live campaign character; edit on the Character Sheet");
		expect(characterSource).toContain("this._renderReadOnlyDetails()");
		expect(characterSource).toContain("Campaign live");
		expect(characterSource).toContain("if (cls) input.addClass(cls);");
	});
});
