/**
 * Character Sheet — World Tree Barbarian: Vitality of the Tree (R40 #8)
 *
 * Asserts the REAL mechanics of the "Vitality of the Tree" feature:
 *  - Vitality Surge: activating Rage grants Temp HP == Barbarian LEVEL (not proficiency bonus).
 *  - The temp HP is non-stacking and only granted on an inactive->active Rage transition.
 *  - Only World Tree barbarians (L3+) get the surge — no leak to other barbarians.
 *  - Life-Giving Force: number of d6 to roll == the Rage Damage bonus (2/3/4).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeWorldTreeBarbarian (level) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "XPHB"});
	state.addClass({
		name: "Barbarian",
		source: "XPHB",
		level,
		subclass: {name: "Path of the World Tree", shortName: "World Tree", source: "XPHB"},
	});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 15);
	return state;
}

function makeVanillaBarbarian (level, subclass) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "XPHB"});
	state.addClass({name: "Barbarian", source: "XPHB", level, subclass});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 15);
	return state;
}

describe("World Tree — Vitality Surge temp HP calculation", () => {
	it("sets vitalityTempHp equal to the Barbarian LEVEL, not the proficiency bonus (L6)", () => {
		const state = makeWorldTreeBarbarian(6);
		const calc = state.getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBe(true);
		expect(calc.vitalityTempHp).toBe(6); // barbarian level
		expect(calc.vitalityTempHp).not.toBe(state.getProficiencyBonus()); // NOT +3 prof bonus
	});

	it("scales with Barbarian level (L3 -> 3, L12 -> 12) and never equals prof bonus", () => {
		const l3 = makeWorldTreeBarbarian(3).getFeatureCalculations();
		expect(l3.vitalityTempHp).toBe(3);

		const state12 = makeWorldTreeBarbarian(12);
		const l12 = state12.getFeatureCalculations();
		expect(l12.vitalityTempHp).toBe(12);
		expect(l12.vitalityTempHp).not.toBe(state12.getProficiencyBonus()); // 12 !== 4
	});

	it("does not flag Vitality of the Tree for a non-World-Tree barbarian", () => {
		const calc = makeVanillaBarbarian(6, {name: "Path of the Berserker", shortName: "Berserker", source: "XPHB"}).getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBeFalsy();
		expect(calc.vitalityTempHp).toBeUndefined();
	});

	it("is level-gated: a World Tree barbarian below level 3 gets no Vitality of the Tree", () => {
		const state = makeWorldTreeBarbarian(2);
		const calc = state.getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBeFalsy();
		expect(calc.vitalityTempHp).toBeUndefined();
		state.activateState("rage");
		expect(state.getTempHp()).toBe(0); // no surge below L3
	});

	it("uses the BARBARIAN class level, not total character level (multiclass)", () => {
		const state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Barbarian",
			source: "XPHB",
			level: 3,
			subclass: {name: "Path of the World Tree", shortName: "World Tree", source: "XPHB"},
		});
		state.addClass({name: "Fighter", source: "XPHB", level: 7});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 15);
		const calc = state.getFeatureCalculations();
		expect(calc.vitalityTempHp).toBe(3); // Barbarian level 3, NOT total level 10
		state.activateState("rage");
		expect(state.getTempHp()).toBe(3);
	});
});

describe("World Tree — Vitality Surge on Rage activation", () => {
	it("grants Temp HP == Barbarian level when Rage is activated", () => {
		const state = makeWorldTreeBarbarian(6);
		expect(state.getTempHp()).toBe(0);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(6);
	});

	it("is non-stacking: re-activating an already-active Rage does not re-grant temp HP", () => {
		const state = makeWorldTreeBarbarian(6);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(6);
		// Player spends some of the temp HP soaking damage.
		state.setTempHp(2);
		// Re-activating an already-active rage must NOT refresh the surge.
		state.activateState("rage");
		expect(state.getTempHp()).toBe(2);
	});

	it("re-grants the surge after Rage ends and is activated again", () => {
		const state = makeWorldTreeBarbarian(6);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(6);
		state.deactivateState("rage");
		state.setTempHp(0);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(6);
	});

	it("does NOT leak temp HP to a non-World-Tree barbarian activating Rage", () => {
		const state = makeVanillaBarbarian(6, {name: "Path of the Berserker", shortName: "Berserker", source: "XPHB"});
		expect(state.getTempHp()).toBe(0);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(0);
	});

	it("does not overwrite a higher existing temp HP pool with a smaller surge", () => {
		const state = makeWorldTreeBarbarian(3); // surge would be 3
		state.setTempHp(10); // already have a bigger pool from elsewhere
		state.activateState("rage");
		expect(state.getTempHp()).toBe(10);
	});
});

describe("World Tree — Life-Giving Force dice count", () => {
	it("rolls Xd6 where X == Rage Damage bonus (2 at L3)", () => {
		const calc = makeWorldTreeBarbarian(3).getFeatureCalculations();
		expect(calc.rageDamage).toBe(2);
	});

	it("scales to 3d6 at L9 and 4d6 at L16", () => {
		expect(makeWorldTreeBarbarian(9).getFeatureCalculations().rageDamage).toBe(3);
		expect(makeWorldTreeBarbarian(16).getFeatureCalculations().rageDamage).toBe(4);
	});
});
