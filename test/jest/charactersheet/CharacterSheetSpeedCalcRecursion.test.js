/**
 * Character Sheet — speed-pipeline / feature-calculation re-entrancy guard.
 *
 * Regression coverage for a cross-feature integration bug that only appears when
 * two independently-correct features are present on the same character:
 *
 *   • Dark Augmentation (Blood Hunter 10) contributes +5 to WALKING speed, so
 *     `getSpeedByType("walk")` asks for it.
 *   • Stormborn (Tempest Cleric 17) grants a FLY speed equal to the walking
 *     speed, so `getFeatureCalculations()` asks the speed pipeline for it.
 *
 * If the Dark Augmentation getter resolves its bonus by calling
 * `getFeatureCalculations()`, those two form a cycle
 * (`getSpeed` → `getDarkAugmentationSpeedBonus` → `getFeatureCalculations` →
 * Stormborn → `getSpeed` → …) and any read of speed or calculations blows the
 * stack. Each feature alone is fine; only the combination recurses.
 *
 * The rule these tests lock in: speed-pipeline bonus getters derive from stored
 * data / class levels directly and never call `getFeatureCalculations()`.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const STORMBORN_DESCRIPTION =
	"You have a flying speed equal to your current walking speed whenever you are not underground or indoors.";

/** Blood Hunter `bloodHunterLevel` / Tempest Cleric `clericLevel` multiclass. */
function mkState ({bloodHunterLevel = 0, clericLevel = 0} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("con", 14);

	if (bloodHunterLevel) {
		state.addClass({name: "Blood Hunter", source: "BH2022", level: bloodHunterLevel});
	}
	if (clericLevel) {
		state.addClass({
			name: "Cleric",
			source: "PHB",
			level: clericLevel,
			subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"},
		});
		if (clericLevel >= 17) {
			state.addFeature({
				name: "Stormborn",
				source: "PHB",
				level: 17,
				className: "Cleric",
				classSource: "PHB",
				subclassShortName: "Tempest",
				isSubclassFeature: true,
				description: STORMBORN_DESCRIPTION,
			});
		}
	}
	return state;
}

describe("speed pipeline ↔ getFeatureCalculations re-entrancy", () => {
	it("resolves Dark Augmentation's walk bonus without consulting getFeatureCalculations", () => {
		const state = mkState({bloodHunterLevel: 10});
		const spy = jest.spyOn(state, "getFeatureCalculations");

		expect(state.getDarkAugmentationSpeedBonus()).toBe(5);
		expect(spy).not.toHaveBeenCalled();

		spy.mockRestore();
	});

	it.each([
		["below the Dark Augmentation threshold", 9, 0],
		["at the Dark Augmentation threshold", 10, 5],
		["above the Dark Augmentation threshold", 15, 5],
	])("gates the walk bonus on Blood Hunter level (%s)", (_label, level, expected) => {
		expect(mkState({bloodHunterLevel: level}).getDarkAugmentationSpeedBonus()).toBe(expected);
	});

	it("does not recurse when Dark Augmentation and Stormborn are both present", () => {
		const state = mkState({bloodHunterLevel: 10, clericLevel: 17});

		// Either direction of entry used to overflow the stack.
		expect(() => state.getSpeed("walk")).not.toThrow();
		expect(() => state.getFeatureCalculations()).not.toThrow();
	});

	it("keeps both features mechanically correct together", () => {
		const state = mkState({bloodHunterLevel: 10, clericLevel: 17});

		// Base 30 + Dark Augmentation's +5.
		expect(state.getSpeed("walk")).toBe(35);

		// Stormborn mirrors the *bonused* walking speed, not the raw base.
		const calc = state.getFeatureCalculations();
		expect(calc.hasStormborn).toBe(true);
		expect(calc.stormFlySpeed).toBe(35);
	});
});
