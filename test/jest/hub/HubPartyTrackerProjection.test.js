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
			kind: "dm_truth",
			character: {
				id: "cloud",
				data: {
					name: "Cloud",
					abilities: {str: 12, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
					classes: [{name: "Wizard", level: 3, source: "PHB"}],
					hp: {current: 12, max: 18},
				},
			},
		}]);

		expect(root.getCharacters().map(it => it.name)).toEqual(["Manual", "Cloud"]);
		expect(root.getCharacters().find(it => it.name === "Cloud")?.isHubProjection).toBe(true);
		const saved = root.getSaveableState();
		expect(saved.characters).toHaveLength(1);
		expect(saved.characters[0].id).toBe("manual");
		expect(events).toContainEqual({type: "partyTrackerUpdate"});
	});

	it("renders a peer profile from the projected catalog without reading it as a document", () => {
		const events = [];
		const root = new PartyTrackerRoot({fireBoardEvent: event => events.push(event), doSaveStateDebounced () {}}, null);
		root.setHubCharacterProjections([{
			kind: "peer_profile",
			id: "peer-1",
			campaignId: "cmp",
			revision: 4,
			projectionRevision: 2,
			data: {
				identity: {name: "Mira"},
				species: {name: "Elf"},
				classes: [{name: "Ranger", level: 5}],
				abilities: {str: 10, dex: 18, con: 14, int: 8, wis: 15, cha: 12},
				saves: {dex: {modifier: 7, proficient: true}},
				skills: {stealth: {modifier: 10, rank: "expertise"}},
				ac: {value: 15},
				hp: {current: 30, max: 44},
			},
		}]);

		const row = root.getCharacters().find(it => it.name === "Mira");
		expect(row).toBeDefined();
		expect(row.isHubProjection).toBe(true);
		// A peer profile is not persisted into the Board blob either.
		expect(root.getSaveableState().characters).toHaveLength(0);
	});

	it("skips a peer profile that shares no identity", () => {
		const root = new PartyTrackerRoot({fireBoardEvent: () => {}, doSaveStateDebounced () {}}, null);
		root.setHubCharacterProjections([{kind: "peer_profile", id: "hidden-1", campaignId: "cmp", revision: 1, projectionRevision: 1, data: {}}]);

		// A character whose owner shares nothing produces no row rather than an
		// "Unnamed Character" placeholder that would confirm its existence.
		expect(root.getCharacters()).toHaveLength(0);
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
