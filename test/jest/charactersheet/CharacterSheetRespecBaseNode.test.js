/**
 * Bug #6 — Respec base/class separation + first-class promotion.
 *
 * A multiclass character's chronologically-first class sits at total level 1, where (pre-redesign)
 * race/background origin choices AND the first class's starting save/armor/weapon proficiencies were
 * conflated, making that first level unremovable. These tests lock in the new model:
 *
 *  - `_data.characterBase` holds origin user-choices independently of any class level.
 *  - `_data._firstClassStartGrants` records the chronological-first class's starting proficiencies so
 *    they can be reversed and re-granted when the primary class changes (promotion).
 *  - Either class's first level is removable; the base + the surviving class stay valid (HP, features,
 *    saves, abilities), and the new chronological-first class is promoted to primary.
 *
 * State has no class DB, so promotion (which needs class DATA) is driven here exactly the way the
 * Respec controller drives it: capture the chronological-first class, peel the class, and on change call
 * `applyFirstClassStartingProficiencies(newFirstClassData)`.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Minimal class-data literals (shape: name/source/proficiency[saves]/startingProficiencies).
const RANGER = {
	name: "Ranger",
	source: "TGTT",
	proficiency: ["str", "dex"],
	startingProficiencies: {armor: ["light", "medium", "shield"], weapons: ["simple", "martial"]},
};
const DRUID = {
	name: "Druid",
	source: "XPHB",
	proficiency: ["int", "wis"],
	startingProficiencies: {armor: ["light", "medium", "shield"], weapons: ["clubs", "daggers"]},
};

function recordRun (state, cls, totals, choicesByTotal = {}) {
	for (const total of totals) {
		state.recordLevelChoice({level: total, class: {name: cls.name, source: cls.source}, choices: choicesByTotal[total] || {}});
	}
}

function addClassFeature (state, name, className, classSource, level, extra = {}) {
	state.addFeature({name, source: classSource, level, className, classSource, description: "", ...extra});
}

/**
 * Build a clean Ranger 2 / Druid 1 multiclass character (Ranger @ totals 1-2, Druid @ total 3) with
 * the character base (race/background/origin choices) and the first-class (Ranger) starting profs set.
 * Ranger d10, Druid d8; CON 14 (+2) so HP math is deterministic.
 */
function buildRangerDruid (state) {
	state.setAbilityBase("con", 14); // +2 modifier — set before classes so stored max HP uses it

	state.addClass({name: "Ranger", source: "TGTT", level: 2});
	state.addClass({name: "Druid", source: "XPHB", level: 1});

	addClassFeature(state, "Ranger Feature 1", "Ranger", "TGTT", 1);
	addClassFeature(state, "Ranger Feature 2", "Ranger", "TGTT", 2);
	addClassFeature(state, "Druid Feature 1", "Druid", "XPHB", 1);

	recordRun(state, {name: "Ranger", source: "TGTT"}, [1, 2]);
	recordRun(state, {name: "Druid", source: "XPHB"}, [3]);

	// Character base: origin entity objects + origin user-choices.
	state.setRace({name: "Elf", source: "PHB"}, {name: "Wood Elf", source: "PHB"});
	state.setBackground({name: "Outlander", source: "PHB"});
	state.setBaseRaceUserChoices({selectedSkills: ["Perception"]});
	state.setBaseBackgroundUserChoices({selectedTools: ["Herbalism Kit"]});

	// First (chronological) class establishes starting proficiencies with provenance.
	state.applyFirstClassStartingProficiencies(RANGER);
}

/**
 * Drive the controller-level promotion sequence: peel every level of `className` (top-down), and if the
 * chronological-first class changes as a result, apply the new first class's starting proficiencies.
 * Returns the new chronological-first class descriptor.
 */
function peelClassWithPromotion (state, className, classSource, newFirstClassData) {
	const firstBefore = state.getChronologicalFirstClass();
	let guard = 0;
	while (state.getClasses().some(c => c.name === className && c.source === classSource) && guard++ < 30) {
		const res = state.removeClassLastLevel(className, classSource);
		if (!res.success) break;
	}
	const firstAfter = state.getChronologicalFirstClass();
	if (firstAfter && (!firstBefore || firstBefore.name !== firstAfter.name || firstBefore.source !== firstAfter.source)) {
		if (newFirstClassData) state.applyFirstClassStartingProficiencies(newFirstClassData);
	}
	return firstAfter;
}

describe("CharacterSheetRespecBaseNode", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// 1. Peel the chronological-first class (Ranger) fully, including its first level.
	describe("Removing the first class's first level", () => {
		it("peels Ranger entirely (incl. total level 1) leaving Druid + base intact", () => {
			buildRangerDruid(state);
			expect(state.getTotalLevel()).toBe(3);

			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			const classes = state.getClasses();
			expect(classes.some(c => c.name === "Ranger")).toBe(false);
			const druid = classes.find(c => c.name === "Druid");
			expect(druid.level).toBe(1);
			expect(state.getTotalLevel()).toBe(1);

			// Features: Ranger gone, Druid kept
			const featureNames = state._data.features.map(f => f.name);
			expect(featureNames).not.toContain("Ranger Feature 1");
			expect(featureNames).not.toContain("Ranger Feature 2");
			expect(featureNames).toContain("Druid Feature 1");

			// Base survives untouched
			expect(state.getRace().name).toBe("Elf");
			expect(state.getSubrace().name).toBe("Wood Elf");
			expect(state.getBackground().name).toBe("Outlander");
			expect(state.getCharacterBase().raceUserChoices.selectedSkills).toEqual(["Perception"]);
			expect(state.getCharacterBase().backgroundUserChoices.selectedTools).toEqual(["Herbalism Kit"]);

			// Sanity: getFeatureCalculations still computes without throwing
			expect(() => state.getFeatureCalculations()).not.toThrow();
		});
	});

	// 2. Promotion: removed class's saves/profs reverse, new class's apply, feat saves survive.
	describe("First-class promotion", () => {
		it("swaps starting saves + weapon proficiencies from Ranger to Druid", () => {
			buildRangerDruid(state);

			// Before: Ranger starting profs
			expect(state.hasSaveProficiency("str")).toBe(true);
			expect(state.hasSaveProficiency("dex")).toBe(true);
			expect(state.hasSaveProficiency("int")).toBe(false);
			expect(state.hasSaveProficiency("wis")).toBe(false);
			expect(state.getWeaponProficiencies()).toEqual(expect.arrayContaining(["simple", "martial"]));

			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			// After: Druid starting profs, Ranger's gone
			expect(state.hasSaveProficiency("str")).toBe(false);
			expect(state.hasSaveProficiency("dex")).toBe(false);
			expect(state.hasSaveProficiency("int")).toBe(true);
			expect(state.hasSaveProficiency("wis")).toBe(true);
			expect(state.getWeaponProficiencies()).toEqual(expect.arrayContaining(["clubs", "daggers"]));
			expect(state.getWeaponProficiencies()).not.toContain("martial");
		});

		it("does NOT strip a save independently granted by a feat (Resilient) during promotion", () => {
			buildRangerDruid(state);
			// Simulate Resilient (Dex): feat registers a named modifier AND adds the save proficiency.
			state._data.namedModifiers.push({type: "proficiency:save:dex", enabled: true, source: "Resilient"});
			state.addSaveProficiency("dex");

			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			// Ranger's Str starting save is gone, but the feat-granted Dex save survives the recompute.
			expect(state.hasSaveProficiency("str")).toBe(false);
			expect(state.hasSaveProficiency("dex")).toBe(true);
			expect(state.hasSaveProficiency("wis")).toBe(true);
		});
	});

	// 3. Remove the OTHER class's first level independently (second class — Druid).
	describe("Removing the second class's first level", () => {
		it("peels Druid entirely without disturbing Ranger or its primary status", () => {
			buildRangerDruid(state);

			// Druid is NOT the chronological-first, so peeling it should not change primary/saves.
			peelClassWithPromotion(state, "Druid", "XPHB", null);

			const classes = state.getClasses();
			expect(classes.some(c => c.name === "Druid")).toBe(false);
			expect(classes.find(c => c.name === "Ranger").level).toBe(2);
			expect(state.getTotalLevel()).toBe(2);

			// Ranger remains primary → keeps its starting saves
			expect(state.hasSaveProficiency("str")).toBe(true);
			expect(state.hasSaveProficiency("dex")).toBe(true);
			expect(state.hasSaveProficiency("int")).toBe(false);

			// Base survives
			expect(state.getRace().name).toBe("Elf");
			expect(state.getBackground().name).toBe("Outlander");
		});
	});

	// 4. Base-node idempotency + synthesis from legacy level-1 choices.
	describe("getCharacterBase / _ensureCharacterBase", () => {
		it("synthesises the base once from legacy level-1 choices and is idempotent", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			state.recordLevelChoice({level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {
					raceUserChoices: {selectedSkills: ["Arcana"]},
					backgroundUserChoices: {selectedLanguages: ["Elvish"]},
				}});

			const base1 = state.getCharacterBase();
			expect(base1.v).toBe(1);
			expect(base1.raceUserChoices.selectedSkills).toEqual(["Arcana"]);
			expect(base1.backgroundUserChoices.selectedLanguages).toEqual(["Elvish"]);

			// Mutating the base then re-ensuring must not clobber it.
			state.setBaseRaceUserChoices({selectedSkills: ["History"]});
			const base2 = state.getCharacterBase();
			expect(base2.raceUserChoices.selectedSkills).toEqual(["History"]);
			expect(base2).toBe(base1); // same reference, never re-derived
		});
	});

	// 5. End-to-end migration → remove first class → base survives + promotion.
	describe("Migrated legacy save", () => {
		it("migrates a conflated save, then peels the first class with base preserved + promotion", () => {
			const json = {
				race: {name: "Elf", source: "PHB"},
				subrace: {name: "Wood Elf", source: "PHB"},
				background: {name: "Outlander", source: "PHB"},
				abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
				classes: [
					{name: "Ranger", source: "TGTT", level: 2},
					{name: "Druid", source: "XPHB", level: 1},
				],
				saveProficiencies: ["str", "dex"],
				weaponProficiencies: ["simple", "martial"],
				_firstClassStartGrants: {className: "Ranger", classSource: "TGTT", saves: ["str", "dex"], armor: [], weapons: ["simple", "martial"]},
				levelHistory: [
					{level: 1,
						class: {name: "Ranger", source: "TGTT"},
						choices: {
							race: {name: "Elf", source: "PHB"},
							raceUserChoices: {selectedSkills: ["Perception"]},
							background: {name: "Outlander", source: "PHB"},
							backgroundUserChoices: {selectedTools: ["Herbalism Kit"]},
						}},
					{level: 2, class: {name: "Ranger", source: "TGTT"}, choices: {}},
					{level: 3, class: {name: "Druid", source: "XPHB"}, choices: {}},
				],
			};
			state.loadFromJson(json);

			// Migration split: base populated, level-1 base keys stripped.
			const base = state.getCharacterBase();
			expect(base.v).toBe(1);
			expect(base.raceUserChoices.selectedSkills).toEqual(["Perception"]);
			expect(base.backgroundUserChoices.selectedTools).toEqual(["Herbalism Kit"]);
			const lvl1 = state.getLevelHistoryEntry(1);
			expect(lvl1.choices.race).toBeUndefined();
			expect(lvl1.choices.raceUserChoices).toBeUndefined();
			expect(lvl1.choices.background).toBeUndefined();

			// Loading again is a no-op for the base node (idempotent).
			state.loadFromJson(json);
			expect(state.getCharacterBase().raceUserChoices.selectedSkills).toEqual(["Perception"]);

			// Now peel the first class (Ranger) including total level 1.
			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			expect(state.getClasses().some(c => c.name === "Ranger")).toBe(false);
			expect(state.getTotalLevel()).toBe(1);
			// Base survives the level-1 removal
			expect(state.getRace().name).toBe("Elf");
			expect(state.getBackground().name).toBe("Outlander");
			expect(state.getCharacterBase().raceUserChoices.selectedSkills).toEqual(["Perception"]);
			// Promotion: Druid saves in, Ranger saves out
			expect(state.hasSaveProficiency("wis")).toBe(true);
			expect(state.hasSaveProficiency("int")).toBe(true);
			expect(state.hasSaveProficiency("str")).toBe(false);
		});
	});

	// 6. Single-class: cannot remove the only level.
	describe("Single-class guard", () => {
		it("blocks removing the character's only level and keeps the base intact", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			recordRun(state, {name: "Wizard", source: "PHB"}, [1]);
			state.setRace({name: "Human", source: "PHB"});
			state.setBackground({name: "Sage", source: "PHB"});

			const res = state.removeClassLastLevel("Wizard", "PHB");
			expect(res.success).toBe(false);
			expect(state.getTotalLevel()).toBe(1);
			expect(state.getRace().name).toBe("Human");
			expect(state.getBackground().name).toBe("Sage");
		});
	});

	// 7. HP recompute after promotion: new first level becomes "max" with the new class's hit die.
	describe("HP after promotion", () => {
		it("recomputes max HP using the promoted class's hit die at the new first level", () => {
			buildRangerDruid(state);

			// Before: Ranger d10 first (10+2), Ranger d10 avg (6+2), Druid d8 avg (5+2) = 27
			expect(state.getMaxHp()).toBe(27);

			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			// After: Druid d8 as the new first level → 8 + 2 = 10
			expect(state.getMaxHp()).toBe(10);
			const breakdown = state.getHpBreakdown();
			expect(breakdown.perLevel[0].source).toBe("max");
			expect(breakdown.perLevel[0].className).toBe("Druid");
			expect(breakdown.perLevel[0].hitDie).toBe(8);
		});
	});

	// 8. Edit invariants: editing origin after promotion mutates the base node, not a class entry.
	describe("Origin edit invariants after promotion", () => {
		it("writes species/background edits to the base node; getRace and getCharacterBase agree", () => {
			buildRangerDruid(state);
			peelClassWithPromotion(state, "Ranger", "TGTT", DRUID);

			// Edit origin user-choices via the base API (the path the Base card uses).
			state.setBaseRaceUserChoices({selectedSkills: ["Stealth"]});
			state.setRace({name: "Halfling", source: "PHB"});

			expect(state.getRace().name).toBe("Halfling");
			expect(state.getCharacterBase().raceUserChoices.selectedSkills).toEqual(["Stealth"]);

			// The promoted Druid's level-1 entry must NOT carry origin keys.
			const lvl1 = state.getLevelHistoryEntry(1);
			expect(lvl1.choices.race).toBeUndefined();
			expect(lvl1.choices.raceUserChoices).toBeUndefined();
		});
	});
});
