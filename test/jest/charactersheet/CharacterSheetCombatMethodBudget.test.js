/**
 * CS-BUG-087 — subclass-granted combat methods must not absorb the class table.
 *
 * 27 TGTT subclasses grant an extra combat method outright ("you learn one
 * additional method from this tradition"; Eldritch Knight grants two). The class
 * `optionalfeatureProgression` for CTM:* stores a CUMULATIVE total, and
 * `getOptionalFeatureGains` computed `newCount = totalAtLevel - alreadyKnown`.
 * Because the granted method sits in `alreadyKnown`, it silently absorbed the
 * class table's NEXT increment and the character stayed permanently one method
 * short from that level onward.
 *
 * Measured before the fix on a wizard-built Astral Self Monk: 3 methods at L3
 * (correct: 2 table + 1 grant) and still 3 at L5 (wrong: should be 3 + 1 = 4).
 *
 * These tests assert the SPEND-SIDE number the level-up wizard actually offers
 * (`newCount`), not a level count.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
});

// Verbatim from homebrew/TravelersGuidetoThelemar.json (Monk, TGTT).
const MONK_CLASS_DATA = {
	name: "Monk",
	source: "TGTT",
	optionalfeatureProgression: [
		{
			name: "Combat Methods",
			featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
			progression: {2: 2, 3: 2, 4: 3, 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6, 12: 6, 13: 7, 14: 7, 15: 8, 16: 8, 17: 9, 18: 9, 19: 10, 20: 10},
		},
	],
};

// Verbatim from homebrew/TravelersGuidetoThelemar.json (Fighter, TGTT).
const FIGHTER_CLASS_DATA = {
	name: "Fighter",
	source: "TGTT",
	optionalfeatureProgression: [
		{
			name: "Combat Methods",
			featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
			progression: {1: 3, 2: 4, 3: 4, 4: 5, 5: 6, 6: 7, 7: 7, 8: 8, 9: 9, 10: 10, 11: 10, 12: 11, 13: 12, 14: 13, 15: 13, 16: 14, 17: 15, 18: 16, 19: 16, 20: 17},
		},
	],
};

const ASTRAL_SELF = {name: "Astral Self", shortName: "Astral Self", source: "TGTT"};
const ELDRITCH_KNIGHT = {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "TGTT"};

describe("CS-BUG-087 — subclass-granted combat methods are additive", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	function addKnownMethods (n) {
		for (let i = 0; i < n; ++i) {
			state.addFeature({
				name: `Method ${i}`,
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["CTM:1"],
				entries: [`Method ${i} effect`],
			});
		}
	}

	function ctmGain (classData, cur, next, subclass) {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(classData, cur, next, state, subclass);
		return gains.find(g => g.featureTypes?.some(ft => ft.startsWith("CTM:")));
	}

	// --- the bug itself ---------------------------------------------------

	it("offers the level-4 class increment to an Astral Self Monk who already holds the granted method", () => {
		// Class table: 2 known at L3, 3 at L4. Plus the Astral Self grant = 4 at L4.
		addKnownMethods(3); // 2 class picks + 1 subclass grant, taken at L2/L3
		const gain = ctmGain(MONK_CLASS_DATA, 3, 4, ASTRAL_SELF);
		expect(gain).toBeDefined();
		expect(gain.newCount).toBe(1);
	});

	it("keeps currentCount + newCount === totalCount so the picker header is not self-contradictory", () => {
		addKnownMethods(3);
		const gain = ctmGain(MONK_CLASS_DATA, 3, 4, ASTRAL_SELF);
		expect(gain).toBeDefined();
		expect(gain.currentCount + gain.newCount).toBe(gain.totalCount);
		expect(gain.totalCount).toBe(4);
	});

	it("keeps offering class increments at every later step (L5->L6)", () => {
		addKnownMethods(4); // 3 class + 1 grant, correct holding at L4/L5
		const gain = ctmGain(MONK_CLASS_DATA, 5, 6, ASTRAL_SELF);
		expect(gain).toBeDefined();
		expect(gain.newCount).toBe(1);
		expect(gain.totalCount).toBe(5);
	});

	it("grants both Eldritch Knight bonus methods without either absorbing a class increment", () => {
		// Fighter table: 4 known at L3, 5 at L4. Plus EK's two grants = 7 at L4.
		addKnownMethods(6); // 4 class picks + 2 EK grants
		const gain = ctmGain(FIGHTER_CLASS_DATA, 3, 4, ELDRITCH_KNIGHT);
		expect(gain).toBeDefined();
		expect(gain.newCount).toBe(1);
		expect(gain.totalCount).toBe(7);
	});

	// --- composition guard: no double-count at the grant level ------------

	it("does NOT also offer the grant from the class path at the subclass-selection level", () => {
		// At Monk 2->3 the table is flat (2 -> 2) and the grant has not been taken
		// yet. The level-up module's own bonus augmentation supplies that pick, so
		// the class path must contribute nothing or the player is offered it twice.
		addKnownMethods(2);
		const gain = ctmGain(MONK_CLASS_DATA, 2, 3, ASTRAL_SELF);
		expect(gain).toBeUndefined();
	});

	it("never discounts more than the subclass actually grants", () => {
		// A character carrying far more methods than the table allows (e.g. a
		// hand-edited import) must not have the surplus read as bonus grants.
		addKnownMethods(9);
		const gain = ctmGain(MONK_CLASS_DATA, 3, 4, ASTRAL_SELF);
		expect(gain).toBeUndefined(); // 3 - (9 - 1) is negative, so no gain
	});

	// --- no-regression controls -------------------------------------------

	it("is subclass-driven: a Monk with no bonus-granting subclass sees the old arithmetic", () => {
		addKnownMethods(3);
		const gain = ctmGain(MONK_CLASS_DATA, 3, 4, null);
		expect(gain).toBeUndefined(); // 3 known, table wants 3 -> nothing new
	});

	it("leaves non-CTM progressions untouched even when the subclass grants methods", () => {
		const fighterAs = {
			name: "Fighter",
			source: "TGTT",
			optionalfeatureProgression: [
				{name: "Arcane Shot", featureType: ["AS"], progression: {3: 2, 7: 3}},
			],
		};
		state.addFeature({
			name: "Piercing Arrow",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["AS"],
			entries: ["effect"],
		});
		state.addFeature({
			name: "Bursting Arrow",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["AS"],
			entries: ["effect"],
		});
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(fighterAs, 3, 7, state, ELDRITCH_KNIGHT);
		const as = gains.find(g => g.featureTypes?.includes("AS"));
		expect(as).toBeDefined();
		expect(as.newCount).toBe(1);
		expect(as.totalCount).toBe(3); // NOT inflated by the EK method grants
	});
});
