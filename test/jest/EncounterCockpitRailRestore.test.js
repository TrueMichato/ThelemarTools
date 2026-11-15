import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	createEncounterPartyInstance,
	getEncounterCharacterClassLine,
	getEncounterPartyStatsFromCharacter,
} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {getCockpitConsoleRowBadge} from "../../js/encounterworkspace/cockpit/features/act-console-model.js";
import {getPrepAreaTraitGroups} from "../../js/encounterworkspace/cockpit/features/prep-model.js";
import {
	RAIL_LAIR_INITIATIVE,
	getIsRailLairTurnCrossed,
	getRailLairIndex,
} from "../../js/encounterworkspace/cockpit/features/rail-battlefield-model.js";
import {pGetCockpitState} from "./encounter-cockpit-fixtures.js";

describe("Encounter Cockpit rail restorations", () => {
	describe("lair row (initiative 20, loses ties)", () => {
		it("sits before the first row strictly below 20, after ties, and last when every row is above", () => {
			expect(RAIL_LAIR_INITIATIVE).toBe(20);
			expect(getRailLairIndex([23, 20, 20, 15, 4])).toBe(3);
			expect(getRailLairIndex([19, 12])).toBe(0);
			expect(getRailLairIndex([25, 21, 20])).toBe(3);
			expect(getRailLairIndex([22, null, 18])).toBe(1);
			expect(getRailLairIndex([])).toBe(-1);
			expect(getRailLairIndex([22, 5], {initiative: 10})).toBe(1);
		});

		it("passes count 20 going forward within a round or across the round boundary, never going back", () => {
			const at = (round, init) => ({round, init});
			expect(getIsRailLairTurnCrossed(at(1, 22), at(1, 20))).toBe(false);
			expect(getIsRailLairTurnCrossed(at(1, 20), at(1, 18))).toBe(true);
			expect(getIsRailLairTurnCrossed(at(1, 18), at(1, 12))).toBe(false);
			// Combat start: the lair comes first only when the first creature is below 20.
			expect(getIsRailLairTurnCrossed(at(0, null), at(1, 17))).toBe(true);
			expect(getIsRailLairTurnCrossed(at(0, null), at(1, 21))).toBe(false);
			// New round: either the previous round ended at ≥20 (lair came last) or this one starts below 20.
			expect(getIsRailLairTurnCrossed(at(1, 21), at(2, 23))).toBe(true);
			expect(getIsRailLairTurnCrossed(at(1, 8), at(2, 14))).toBe(true);
			expect(getIsRailLairTurnCrossed(at(1, 8), at(2, 23))).toBe(false);
			expect(getIsRailLairTurnCrossed(at(2, 15), at(1, 21))).toBe(false);
			expect(getIsRailLairTurnCrossed(at(1, 20), at(0, null))).toBe(false);
		});
	});

	it("groups habitat traits by area, areas and names sorted, dropping unusable entries", () => {
		const groups = getPrepAreaTraitGroups([
			{name: "Quicksand", source: "FM", _areaName: "Desert"},
			{name: "Thin Ice", source: "FM", _areaName: "Arctic"},
			{name: "Blizzard", source: "FM", _areaName: "Arctic"},
			{name: "Echoes", source: "FM"},
			{name: "No source", _areaName: "Arctic"},
			null,
		]);
		expect(groups.map(it => [it.area, it.traits.map(t => t.name)])).toEqual([
			["Arctic", ["Blizzard", "Thin Ice"]],
			["Desert", ["Quicksand"]],
			["Environment", ["Echoes"]],
		]);
		expect(getPrepAreaTraitGroups(undefined)).toEqual([]);
	});

	it("shortens console preview lines into row badges, classifying damage, healing, additions and skips", () => {
		expect(getCockpitConsoleRowBadge("−7 → 0 (dies) — bludgeoning ×2")).toMatchObject({text: "−7 → 0 (dies)", kind: "dmg"});
		expect(getCockpitConsoleRowBadge("+5 → 12")).toMatchObject({text: "+5 → 12", kind: "heal"});
		expect(getCockpitConsoleRowBadge("+ Bless (1 min)")).toMatchObject({text: "+Bless (1 min)", kind: "add"});
		expect(getCockpitConsoleRowBadge("HP not set — skipped")).toMatchObject({kind: "skip"});
		expect(getCockpitConsoleRowBadge("7/7 — rolled on Enter")).toEqual({text: "rolls on Enter", title: "7/7 — rolled on Enter", kind: "info"});
		const long = getCockpitConsoleRowBadge("DC 15 Dexterity saving throw");
		expect(long.text).toHaveLength(16);
		expect(long.text.endsWith("…")).toBe(true);
		expect(long.title).toBe("DC 15 Dexterity saving throw");
		expect(getCockpitConsoleRowBadge("select")).toBeNull();
		expect(getCockpitConsoleRowBadge("  ")).toBeNull();
	});

	it("builds a PC class line from the sheet and keeps it on the party instance", () => {
		expect(getEncounterCharacterClassLine({classes: [{name: "Rogue", level: 5}]})).toBe("Rogue 5");
		expect(getEncounterCharacterClassLine({classes: [{name: "Fighter", level: 3}, {name: "Wizard", level: "2"}, {name: " "}]})).toBe("Fighter 3 / Wizard 2");
		expect(getEncounterCharacterClassLine({})).toBe("");
		const stats = getEncounterPartyStatsFromCharacter({id: "c", name: "Aria", classes: [{name: "Rogue", level: 5}], abilities: {}, hp: {current: 10, max: 10}});
		expect(stats.classLine).toBe("Rogue 5");
		expect(createEncounterPartyInstance({id: "p1", name: "Aria", classLine: " Rogue 5 "}).party.classLine).toBe("Rogue 5");
		expect(createEncounterPartyInstance({id: "p2", name: "Bo"}).party).not.toHaveProperty("classLine");
	});

	describe("encounter note", () => {
		it("defaults to empty, fills in for saves that predate it, and round-trips", async () => {
			const state = await pGetCockpitState([["Goblin", 1]]);
			expect(state.encounterNote).toBe("");
			const {encounterNote, ...older} = structuredClone(state);
			expect(EncounterWorkspaceState.validate(older).encounterNote).toBe("");
			const noted = EncounterWorkspaceState.withEncounterNote(state, "  Bridge collapses on round 3.  ");
			expect(noted.encounterNote).toBe("Bridge collapses on round 3.");
			expect(EncounterWorkspaceState.validate(structuredClone(noted)).encounterNote).toBe("Bridge collapses on round 3.");
		});

		it("caps the note at 500 characters and rejects a non-string note", async () => {
			const state = await pGetCockpitState([["Goblin", 1]]);
			expect(EncounterWorkspaceState.withEncounterNote(state, "x".repeat(900)).encounterNote).toHaveLength(500);
			expect(EncounterWorkspaceState.withEncounterNote(state, null).encounterNote).toBe("");
			expect(() => EncounterWorkspaceState.validate({...structuredClone(state), encounterNote: 7})).toThrow(/encounter note/);
		});

		it("rejects a non-string PC class line", async () => {
			const state = await pGetCockpitState([["Goblin", 1]]);
			const pc = createEncounterPartyInstance({id: "p1", name: "Aria", classLine: "Rogue 5"});
			expect(() => EncounterWorkspaceState.validate({...structuredClone(state), instances: [...state.instances, {...pc, party: {...pc.party, classLine: 5}}]})).toThrow(/invalid/);
		});
	});
});
