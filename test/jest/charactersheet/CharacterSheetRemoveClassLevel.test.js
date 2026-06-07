/**
 * Tests for per-class ("branch") level removal in a multiclass character.
 *
 * These cover the two Respec bugs:
 *  1. Multiclass characters must be able to remove the LAST level of EITHER class independently.
 *  2. A subclass-bearing level must be removable (subclass + its features torn down, restored on re-add).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/**
 * Record a contiguous run of history entries for a class across the given total levels.
 * @param {*} state
 * @param {{name: string, source: string}} cls
 * @param {number[]} totals - total character levels this class occupies
 * @param {object} [choicesByTotal] - optional map of total level -> choices object
 */
function recordRun (state, cls, totals, choicesByTotal = {}) {
	for (const total of totals) {
		state.recordLevelChoice({level: total, class: {name: cls.name, source: cls.source}, choices: choicesByTotal[total] || {}});
	}
}

/**
 * Add a class feature at a specific class level.
 */
function addClassFeature (state, name, className, classSource, level, extra = {}) {
	state.addFeature({name, source: classSource, level, className, classSource, description: "", ...extra});
}

/**
 * Build a clean, contiguous Ranger 6 (Hunter) / Druid 3 (Zodiac) multiclass character.
 * Ranger occupies totals 1-6, Druid totals 7-9. Subclass features are added for both.
 */
function buildCleanRangerDruid (state) {
	state.addClass({name: "Ranger", source: "TGTT", level: 6});
	state.addClass({name: "Druid", source: "XPHB", level: 3});

	state.setSubclass("Ranger", {name: "Hunter", shortName: "Hunter", source: "TGTT"});
	state.setSubclass("Druid", {name: "Circle of the Zodiac", shortName: "Zodiac", source: "XPHB"});

	// Ranger class features 1-6 (+ Hunter subclass feature at 3)
	for (let lvl = 1; lvl <= 6; lvl++) addClassFeature(state, `Ranger Feature ${lvl}`, "Ranger", "TGTT", lvl);
	addClassFeature(state, "Hunter's Prey", "Ranger", "TGTT", 3, {subclassShortName: "Hunter"});

	// Druid class features 1-3 (+ Zodiac subclass feature at 3)
	for (let lvl = 1; lvl <= 3; lvl++) addClassFeature(state, `Druid Feature ${lvl}`, "Druid", "XPHB", lvl);
	addClassFeature(state, "Zodiac Sign", "Druid", "XPHB", 3, {subclassShortName: "Zodiac"});

	recordRun(state, {name: "Ranger", source: "TGTT"}, [1, 2, 3, 4, 5, 6], {
		3: {subclass: {name: "Hunter", shortName: "Hunter", source: "TGTT"}},
	});
	recordRun(state, {name: "Druid", source: "XPHB"}, [7, 8, 9], {
		9: {subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "XPHB"}},
	});
}

describe("CharacterSheetRemoveClassLevel", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("Per-class branch removal", () => {
		it("removes the last Druid level while leaving Ranger intact", () => {
			buildCleanRangerDruid(state);
			expect(state.getTotalLevel()).toBe(9);
			expect(state.isLegacyCharacter()).toBe(false);

			const result = state.removeClassLastLevel("Druid", "XPHB");
			expect(result.success).toBe(true);

			const ranger = state.getClasses().find(c => c.name === "Ranger");
			const druid = state.getClasses().find(c => c.name === "Druid");
			expect(ranger.level).toBe(6);
			expect(druid.level).toBe(2);
			expect(state.getTotalLevel()).toBe(8);

			// Druid 3 feature gone, Ranger features intact
			const featureNames = state._data.features.map(f => f.name);
			expect(featureNames).not.toContain("Druid Feature 3");
			expect(featureNames).toContain("Druid Feature 2");
			expect(featureNames).toContain("Ranger Feature 6");
		});

		it("removes the last Ranger level while leaving Druid (and its subclass) intact", () => {
			buildCleanRangerDruid(state);

			const result = state.removeClassLastLevel("Ranger", "TGTT");
			expect(result.success).toBe(true);

			const ranger = state.getClasses().find(c => c.name === "Ranger");
			const druid = state.getClasses().find(c => c.name === "Druid");
			expect(ranger.level).toBe(5);
			expect(druid.level).toBe(3);
			expect(druid.subclass).toBeTruthy();
			expect(druid.subclass.name).toBe("Circle of the Zodiac");

			const featureNames = state._data.features.map(f => f.name);
			expect(featureNames).not.toContain("Ranger Feature 6");
			expect(featureNames).toContain("Zodiac Sign");
		});

		it("re-indexes higher total levels so the history stays contiguous (non-legacy)", () => {
			buildCleanRangerDruid(state);

			// Remove Ranger's last (interior) level — Druid totals 7,8,9 must shift down to 6,7,8.
			state.removeClassLastLevel("Ranger", "TGTT");

			expect(state.getTotalLevel()).toBe(8);
			expect(state.isLegacyCharacter()).toBe(false);
			const levels = state.getLevelHistory().map(h => h.level).sort((a, b) => a - b);
			expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
			// The top two entries are still the Druid levels
			const top = state.getLevelHistory().filter(h => h.class.name === "Druid").map(h => h.level).sort((a, b) => a - b);
			expect(top).toEqual([6, 7, 8]);
		});
	});

	describe("Subclass-bearing level removal (Bug 2)", () => {
		it("tears down the subclass + its features when peeling the subclass-granting level", () => {
			buildCleanRangerDruid(state);
			expect(state.getClasses().find(c => c.name === "Druid").subclass).toBeTruthy();

			state.removeClassLastLevel("Druid", "XPHB");

			const druid = state.getClasses().find(c => c.name === "Druid");
			expect(druid.subclass).toBeNull();
			expect(druid.subclassChoice).toBeNull();
			expect(state._data.features.map(f => f.name)).not.toContain("Zodiac Sign");
		});

		it("reports willRemoveSubclass in the preview for the subclass-granting level", () => {
			buildCleanRangerDruid(state);
			const preview = state.getRemoveClassLastLevelPreview("Druid", "XPHB");
			expect(preview).not.toBeNull();
			expect(preview.className).toBe("Druid");
			expect(preview.classLevel).toBe(3);
			expect(preview.willRemoveSubclass).toBe(true);
			expect(preview.subclassName).toBe("Circle of the Zodiac");
		});

		it("restores the subclass prompt on re-level (subclass nulled so level-up re-prompts)", () => {
			buildCleanRangerDruid(state);
			state.removeClassLastLevel("Druid", "XPHB");

			// Simulate re-leveling Druid back to 3: class level goes up, subclass must be re-selected.
			const druid = state.getClasses().find(c => c.name === "Druid");
			expect(druid.subclass).toBeNull(); // level-up uses `!classEntry.subclass` to decide needsSubclass
			state.setSubclass("Druid", {name: "Circle of the Zodiac", shortName: "Zodiac", source: "XPHB"});
			expect(state.getClasses().find(c => c.name === "Druid").subclass.name).toBe("Circle of the Zodiac");
		});
	});

	describe("Guards", () => {
		it("blocks removing the character's origin level (delete the character instead)", () => {
			// Single class at level 1 dipped into another at level 1: Ranger 1 / Druid 1.
			state.addClass({name: "Ranger", source: "TGTT", level: 1});
			state.addClass({name: "Druid", source: "XPHB", level: 1});
			recordRun(state, {name: "Ranger", source: "TGTT"}, [1]);
			recordRun(state, {name: "Druid", source: "XPHB"}, [2]);

			const result = state.removeClassLastLevel("Ranger", "TGTT");
			expect(result.success).toBe(false);
			expect(result.reason).toMatch(/first level|only level/i);
		});

		it("removes a 1-level dip class entirely (non-origin)", () => {
			state.addClass({name: "Ranger", source: "TGTT", level: 2});
			state.addClass({name: "Druid", source: "XPHB", level: 1});
			for (let lvl = 1; lvl <= 2; lvl++) addClassFeature(state, `Ranger Feature ${lvl}`, "Ranger", "TGTT", lvl);
			addClassFeature(state, "Druid Feature 1", "Druid", "XPHB", 1);
			recordRun(state, {name: "Ranger", source: "TGTT"}, [1, 2]);
			recordRun(state, {name: "Druid", source: "XPHB"}, [3]);

			const result = state.removeClassLastLevel("Druid", "XPHB");
			expect(result.success).toBe(true);
			expect(state.getClasses().find(c => c.name === "Druid")).toBeUndefined();
			expect(state.getClasses()).toHaveLength(1);
			expect(state.getTotalLevel()).toBe(2);
			expect(state._data.features.map(f => f.name)).not.toContain("Druid Feature 1");
		});

		it("blocks a dangerous partial-history prefix (recorded levels don't reach the class top)", () => {
			// Fighter 5 but only totals 1-3 recorded → max recorded entry maps to the wrong class level.
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			recordRun(state, {name: "Fighter", source: "PHB"}, [1, 2, 3]);

			const result = state.removeClassLastLevel("Fighter", "PHB");
			expect(result.success).toBe(false);
			expect(result.reason).toMatch(/incomplete/i);
			expect(state.getRemoveClassLastLevelPreview("Fighter", "PHB")).toBeNull();
		});
	});

	describe("Partial-history multiclass (Lunaria-shaped)", () => {
		/**
		 * Ranger 6 (totals 1-6, complete) + Druid 3 where Druid 1 (total 7) was NEVER recorded,
		 * only Druid 2,3 (totals 8,9). This is a legacy character overall, but each class's
		 * recorded top levels should still peel back safely.
		 */
		function buildLunariaShaped () {
			state.addClass({name: "Ranger", source: "TGTT", level: 6});
			state.addClass({name: "Druid", source: "XPHB", level: 3});
			state.setSubclass("Druid", {name: "Circle of the Zodiac", shortName: "Zodiac", source: "XPHB"});
			for (let lvl = 1; lvl <= 6; lvl++) addClassFeature(state, `Ranger Feature ${lvl}`, "Ranger", "TGTT", lvl);
			for (let lvl = 1; lvl <= 3; lvl++) addClassFeature(state, `Druid Feature ${lvl}`, "Druid", "XPHB", lvl);
			addClassFeature(state, "Zodiac Sign", "Druid", "XPHB", 3, {subclassShortName: "Zodiac"});
			recordRun(state, {name: "Ranger", source: "TGTT"}, [1, 2, 3, 4, 5, 6]);
			recordRun(state, {name: "Druid", source: "XPHB"}, [8, 9], {
				9: {subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "XPHB"}},
			});
		}

		it("is legacy overall but allows peeling each class's recorded top level", () => {
			buildLunariaShaped();
			expect(state.isLegacyCharacter()).toBe(true);
			// Global last-level removal is gated off for legacy chars...
			expect(state.getRemoveLastLevelPreview()).toBeNull();
			// ...but per-class branch removal is available for both recorded tops.
			expect(state.getRemoveClassLastLevelPreview("Druid", "XPHB")).not.toBeNull();
			expect(state.getRemoveClassLastLevelPreview("Ranger", "TGTT")).not.toBeNull();
		});

		it("removes Druid 3 (subclass) then Druid 2, then blocks the unrecorded Druid 1", () => {
			buildLunariaShaped();

			const r1 = state.removeClassLastLevel("Druid", "XPHB");
			expect(r1.success).toBe(true);
			expect(state.getClasses().find(c => c.name === "Druid").level).toBe(2);
			expect(state.getClasses().find(c => c.name === "Druid").subclass).toBeNull();

			const r2 = state.removeClassLastLevel("Druid", "XPHB");
			expect(r2.success).toBe(true);
			expect(state.getClasses().find(c => c.name === "Druid").level).toBe(1);

			// Druid 1 was never recorded — cannot be safely reversed.
			const r3 = state.removeClassLastLevel("Druid", "XPHB");
			expect(r3.success).toBe(false);
			expect(r3.reason).toMatch(/no recorded level history/i);
			expect(state.getClasses().find(c => c.name === "Druid").level).toBe(1);
		});

		it("still allows removing Ranger's recorded top level on a legacy character", () => {
			buildLunariaShaped();
			const result = state.removeClassLastLevel("Ranger", "TGTT");
			expect(result.success).toBe(true);
			expect(state.getClasses().find(c => c.name === "Ranger").level).toBe(5);
			expect(state.getClasses().find(c => c.name === "Druid").level).toBe(3);
		});
	});

	describe("Extended teardown", () => {
		it("removes class-level featProgression feats (Fighting Style) granted at the level", () => {
			state.addClass({name: "Ranger", source: "TGTT", level: 2});
			addClassFeature(state, "Ranger Feature 1", "Ranger", "TGTT", 1);
			addClassFeature(state, "Ranger Feature 2", "Ranger", "TGTT", 2);
			state.addFeat({name: "Druidic Warrior", source: "TGTT"}, {
				classFeatProgression: {className: "Ranger", classSource: "TGTT", level: 2, progressionName: "Fighting Style"},
			});
			expect(state._data.feats.map(f => f.name)).toContain("Druidic Warrior");

			recordRun(state, {name: "Ranger", source: "TGTT"}, [1, 2], {
				2: {classFeatProgressionFeats: [{progressionName: "Fighting Style", name: "Druidic Warrior", source: "TGTT", category: "FS"}]},
			});

			const result = state.removeClassLastLevel("Ranger", "TGTT");
			expect(result.success).toBe(true);
			expect(state._data.feats.map(f => f.name)).not.toContain("Druidic Warrior");
		});

		it("reverses a spell swap: drops the added spell and restores the removed one", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2});
			addClassFeature(state, "Bard Feature 1", "Bard", "PHB", 1);
			addClassFeature(state, "Bard Feature 2", "Bard", "PHB", 2);
			// At level 2 the player swapped out Faerie Fire for Heat Metal.
			state.addSpell({name: "Heat Metal", source: "PHB", level: 2, school: "T"});
			recordRun(state, {name: "Bard", source: "PHB"}, [1, 2], {
				2: {spellSwap: {
					removed: {name: "Faerie Fire", source: "PHB", level: 1, school: "V"},
					added: {name: "Heat Metal", source: "PHB"},
				}},
			});

			const result = state.removeClassLastLevel("Bard", "PHB");
			expect(result.success).toBe(true);
			const known = state._data.spellcasting.spellsKnown.map(s => s.name);
			expect(known).not.toContain("Heat Metal");
			expect(known).toContain("Faerie Fire");
		});

		it("does not corrupt another class's class-level feat provenance on interior removal", () => {
			buildCleanRangerDruid(state);
			// A Druid Fighting-Style-style feat tagged with its CLASS level (3), not a total level.
			state.addFeat({name: "Resilient", source: "PHB"}, {
				classFeatProgression: {className: "Druid", classSource: "XPHB", level: 3, progressionName: "x"},
			});

			// Remove Ranger 6 (interior). Druid's class level is untouched, so its feat's class-level
			// provenance must stay 3 (it is a CLASS level, not a total level).
			state.removeClassLastLevel("Ranger", "TGTT");
			const feat = state._data.feats.find(f => f.name === "Resilient");
			expect(feat.classFeatProgression.level).toBe(3);
		});
	});

	describe("Subclass short-name collisions", () => {
		it("only removes subclass features belonging to the targeted class", () => {
			// Two classes whose subclasses share a short name "Zealot" — removing one must not touch the other.
			state.addClass({name: "Barbarian", source: "PHB", level: 3});
			state.addClass({name: "Cleric", source: "PHB", level: 3});
			state.setSubclass("Barbarian", {name: "Path of the Zealot", shortName: "Zealot", source: "PHB"});
			state.setSubclass("Cleric", {name: "Zealot Domain", shortName: "Zealot", source: "HB"});
			for (let lvl = 1; lvl <= 3; lvl++) addClassFeature(state, `Barb Feature ${lvl}`, "Barbarian", "PHB", lvl);
			for (let lvl = 1; lvl <= 3; lvl++) addClassFeature(state, `Cleric Feature ${lvl}`, "Cleric", "PHB", lvl);
			addClassFeature(state, "Divine Fury", "Barbarian", "PHB", 3, {subclassShortName: "Zealot"});
			addClassFeature(state, "Zealous Smite", "Cleric", "PHB", 3, {subclassShortName: "Zealot"});
			recordRun(state, {name: "Barbarian", source: "PHB"}, [1, 2, 3], {
				3: {subclass: {name: "Path of the Zealot", shortName: "Zealot", source: "PHB"}},
			});
			recordRun(state, {name: "Cleric", source: "PHB"}, [4, 5, 6], {
				6: {subclass: {name: "Zealot Domain", shortName: "Zealot", source: "HB"}},
			});

			state.removeClassLastLevel("Cleric", "PHB");

			const featureNames = state._data.features.map(f => f.name);
			expect(featureNames).not.toContain("Zealous Smite"); // Cleric's subclass feature removed
			expect(featureNames).toContain("Divine Fury"); // Barbarian's same-short-name feature untouched
			expect(state.getClasses().find(c => c.name === "Barbarian").subclass).toBeTruthy();
		});
	});

	describe("Single-class regression", () => {
		it("does not affect single-class removeLastLevel behaviour", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			for (let lvl = 1; lvl <= 3; lvl++) addClassFeature(state, `Fighter Feature ${lvl}`, "Fighter", "PHB", lvl);
			recordRun(state, {name: "Fighter", source: "PHB"}, [1, 2, 3]);

			const result = state.removeLastLevel();
			expect(result.success).toBe(true);
			expect(result.removed.level).toBe(3);
			expect(state.getTotalLevel()).toBe(2);
			expect(state.isLegacyCharacter()).toBe(false);
		});
	});
});
