/**
 * Aasimar "Healing Hands" classification + uses (round 5, Bug 9 — species)
 *
 * BUG: Healing Hands ("As a Magic action … roll a number of d4s equal to your
 * Proficiency Bonus … Once you use this trait, you can't use it again until you
 * finish a Long Rest") surfaced as a TOGGLE active state, and the generic uses
 * parser mis-read "equal to your Proficiency Bonus" (the HEAL amount) as the use
 * COUNT, so it would have tracked PB uses instead of one.
 *
 * FIX (species, using existing mechanisms):
 *   - curated uses {max: 1, recharge: "long"} via `_getCuratedFeatureUses` (wins
 *     over the generic parser), so it's a correctly-sized single-use resource.
 *   - classified as a limited-use resource (interactionMode "limited", isToggle
 *     false): with curated uses present, the active-states classifier routes it
 *     through the LIMITED-USE FEATURE FALLBACK so it surfaces as a use-tracked
 *     resource (spend affordance + recharge), NOT a persistent toggle. (Round-5
 *     integration: this supersedes the earlier "combat" override, deferring to the
 *     foundation session's richer limited-use taxonomy.)
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const HEALING_HANDS_DESC = "As a Magic action, you can touch a creature and roll a number of d4s equal to "
	+ "your Proficiency Bonus. The creature regains a number of Hit Points equal to the total rolled. "
	+ "Once you use this trait, you can't use it again until you finish a Long Rest.";

function makeAasimarWithHealingHands (source = "XPHB") {
	const state = new CharacterSheetState();
	// Level 5 → proficiency bonus +3, so a PB-sized (buggy) parse would give max 3.
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.addFeature({name: "Healing Hands", source, description: HEALING_HANDS_DESC});
	return state;
}

describe("Healing Hands is a single-use action, not a toggle", () => {
	test("PB is greater than 1 so a correct single use is distinguishable from the buggy PB parse", () => {
		const state = makeAasimarWithHealingHands();
		expect(state.getProficiencyBonus()).toBeGreaterThan(1);
	});

	test("is tracked as a single use (max 1), never PB-sized", () => {
		const state = makeAasimarWithHealingHands();
		const feature = state.getFeatures().find(f => f.name === "Healing Hands");
		expect(feature).toBeDefined();
		expect(feature.uses).toBeDefined();
		expect(feature.uses.max).toBe(1);
		expect(feature.uses.max).not.toBe(state.getProficiencyBonus());
		expect(feature.uses.recharge).toBe("long");
	});

	test("the curated single use is edition/source-agnostic (XPHB, MPMM, DMG)", () => {
		for (const src of ["XPHB", "MPMM", "DMG", "VGM"]) {
			const feature = makeAasimarWithHealingHands(src).getFeatures().find(f => f.name === "Healing Hands");
			expect(feature.uses.max).toBe(1);
			expect(feature.uses.recharge).toBe("long");
		}
	});

	test("is classified as a limited-use resource (not a toggle), with use tracking", () => {
		const result = CharacterSheetState.detectActivatableFeature({
			name: "Healing Hands",
			source: "XPHB",
			description: HEALING_HANDS_DESC,
			uses: {current: 1, max: 1, recharge: "long"},
		});
		expect(result).toBeTruthy();
		expect(result.isToggle).toBe(false);
		expect(result.isInstant).toBe(true);
		expect(result.interactionMode).toBe("limited");
		expect(result.resourceName).toBe("Healing Hands");
		expect(result.resourceCost).toBe(1);
	});

	test("does not appear among the toggleable active-state features", () => {
		const state = makeAasimarWithHealingHands();
		const activatable = state.getActivatableFeatures?.() || [];
		const toggles = activatable.filter(a => a.isToggle);
		expect(toggles.some(a => (a.feature?.name || a.name || "").toLowerCase() === "healing hands")).toBe(false);
	});
});
