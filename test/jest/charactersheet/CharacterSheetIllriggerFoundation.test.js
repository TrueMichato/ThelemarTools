/**
 * Illrigger FOUNDATION suite (R18) — option-pool selectability + Weapon Mastery.
 *
 * Scope is SELECTION / PERSISTENCE / "known" display only. The per-option
 * mechanical EFFECTS (boon riders, combat-mastery effects, specialty bonuses)
 * are a deferred follow-up round and are intentionally NOT asserted here.
 *
 * The TGTT Illrigger class is a `_copy` of `Illrigger|IllriggerRevised`; at
 * runtime `DataUtil.class.pMergeCopy` produces a merged class carrying the
 * inherited `optionalfeatureProgression` (Interdict Boons = "ItdBoon",
 * Combat Mastery = "IllMastery") plus the TGTT `_mod` additions (Weapon Mastery
 * L2, Specialties L{3,5,7,9,11,14,19} class features). The IllriggerRevised brew
 * loads from a remote URL (homebrew/index.json), so it is NOT available in Jest.
 * These tests therefore drive the GENERIC, data-driven pickers directly with
 * constructed class objects that mirror the merged runtime shape — the
 * runtime-independent unit-test path.
 *
 * Covers:
 *  - #2  Weapon Mastery flags surface at L2 (hasWeaponMastery + count 2).
 *  - #5  Interdict Boons (ItdBoon) picker gains at the right levels/counts.
 *  - #6  Combat Mastery (IllMastery) picker gain at L2.
 *  - #10 Specialties class-feature option pool selectable at 3/5/7/9/11/14/19.
 *  - Persistence round-trip for optional features + specialties.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// Fixtures — the merged TGTT Illrigger class shape (inherited from IllriggerRevised)
// ==========================================================================

// Inherited verbatim from the IllriggerRevised base class (carried through `_copy`).
const ILLRIGGER_CLASS = Object.freeze({
	name: "Illrigger",
	source: "TGTT-IllR",
	edition: "classic",
	optionalfeatureProgression: [
		{
			name: "Interdict Boons",
			featureType: ["ItdBoon"],
			progression: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4],
		},
		{
			name: "Combat Mastery",
			featureType: ["IllMastery"],
			progression: {2: 1},
		},
	],
});

function freshState () {
	return {getFeatures: () => []};
}

/** A mock state whose getFeatures() returns the supplied stored features. */
function stateWithFeatures (features) {
	return {getFeatures: () => features};
}

/**
 * Build a stored "Optional Feature" the way the apply paths do. Mirrors the
 * proven `buildFeatureStateObject` contract: the raw `featureType` array becomes
 * `optionalFeatureTypes`, and the metadata `featureType` becomes the string
 * discriminator read back by `getOptionalFeatureGains`.
 */
function storedOptionalFeature (name, type) {
	return CharacterSheetClassUtils.buildFeatureStateObject(
		{name, source: "IllriggerRevised", featureType: [type], entries: [`${name} body`]},
		{className: "Illrigger", classSource: "TGTT-IllR", level: 2, featureType: "Optional Feature"},
	);
}

// ==========================================================================
// PART 1 — #2 Weapon Mastery flags (via getFeatureCalculations)
// ==========================================================================
describe("Illrigger Weapon Mastery (#2)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("does NOT grant Weapon Mastery at level 1", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWeaponMastery).toBeFalsy();
	});

	it("grants Weapon Mastery with 2 weapons at level 2", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 2});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWeaponMastery).toBe(true);
		expect(calcs.weaponMasteryCount).toBe(2);
	});

	it("keeps the count fixed at 2 across levels (the feature does not scale)", () => {
		for (const level of [5, 11, 17, 20]) {
			const s = new CharacterSheetState();
			s.addClass({name: "Illrigger", source: "IllriggerRevised", level});
			const calcs = s.getFeatureCalculations();
			expect(calcs.hasWeaponMastery).toBe(true);
			expect(calcs.weaponMasteryCount).toBe(2);
		}
	});

	it("exposes the weapon-mastery state API used by the picker", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 2});
		state.setWeaponMastery("Longsword|XPHB", "Sap");
		state.setWeaponMastery("Javelin|XPHB", "Slow");
		expect(state.getWeaponMasteries()).toEqual(["Longsword|XPHB", "Javelin|XPHB"]);
		expect(state.hasWeaponMastery("Longsword")).toBe(true);
		// Changeable on long rest: clearing one and choosing another.
		state.setWeaponMastery("Longsword|XPHB", null);
		expect(state.getWeaponMasteries()).toEqual(["Javelin|XPHB"]);
	});
});

// ==========================================================================
// PART 2 — #5/#6 Interdict Boons (ItdBoon) + Combat Mastery (IllMastery) gains
// ==========================================================================
describe("Illrigger optional-feature picker gains (#5 ItdBoon, #6 IllMastery)", () => {
	it("surfaces NO ItdBoon/IllMastery gains at builder level 1 (both grant at L2)", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 0, 1, freshState());
		expect(gains.find(g => g.featureTypes[0] === "ItdBoon")).toBeUndefined();
		expect(gains.find(g => g.featureTypes[0] === "IllMastery")).toBeUndefined();
	});

	it("surfaces 1 Interdict Boon and 1 Combat Mastery on level-up 1 -> 2", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 1, 2, freshState());
		const boon = gains.find(g => g.featureTypes[0] === "ItdBoon");
		const mastery = gains.find(g => g.featureTypes[0] === "IllMastery");
		expect(boon).toMatchObject({name: "Interdict Boons", totalCount: 1, newCount: 1});
		expect(mastery).toMatchObject({name: "Combat Mastery", totalCount: 1, newCount: 1});
	});

	it("scales Interdict Boons Known: 2 known by L7, 3 by L13, 4 by L18", () => {
		// Fresh quick-build jumps (0 -> N) ask for the full cumulative count.
		const at7 = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 0, 7, freshState())
			.find(g => g.featureTypes[0] === "ItdBoon");
		expect(at7).toMatchObject({totalCount: 2, newCount: 2});

		const at13 = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 0, 13, freshState())
			.find(g => g.featureTypes[0] === "ItdBoon");
		expect(at13).toMatchObject({totalCount: 3, newCount: 3});

		const at18 = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 0, 18, freshState())
			.find(g => g.featureTypes[0] === "ItdBoon");
		expect(at18).toMatchObject({totalCount: 4, newCount: 4});
	});

	it("grants exactly 1 NEW Interdict Boon on the 6 -> 7 level-up when 1 is already known", () => {
		const state = stateWithFeatures([storedOptionalFeature("First Boon", "ItdBoon")]);
		const boon = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 6, 7, state)
			.find(g => g.featureTypes[0] === "ItdBoon");
		expect(boon).toMatchObject({currentCount: 1, totalCount: 2, newCount: 1});
	});

	it("does NOT re-prompt for Combat Mastery once it is known (2 -> 3)", () => {
		const state = stateWithFeatures([storedOptionalFeature("Combat Mastery Pick", "IllMastery")]);
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(ILLRIGGER_CLASS, 2, 3, state);
		expect(gains.find(g => g.featureTypes[0] === "IllMastery")).toBeUndefined();
	});

	it("surfaces the actual ItdBoon options through the eligibility filter at L2", () => {
		const pool = [
			{name: "Empowered Seal", source: "IllriggerRevised", featureType: ["ItdBoon"], entries: ["Boon."]},
			{name: "Forceful Interdict", source: "IllriggerRevised", featureType: ["ItdBoon"], entries: ["Boon."]},
			{name: "Mastery of the Blade", source: "IllriggerRevised", featureType: ["IllMastery"], entries: ["Mastery."]},
		];
		const boons = CharacterSheetClassUtils.getEligibleOptionalFeatures(pool, {
			featureTypes: ["ItdBoon"],
			prereqContext: {classes: [{name: "Illrigger", source: "TGTT-IllR", level: 2}], totalLevel: 2, existingFeatures: []},
		});
		const selectable = boons.filter(o => o._selectable).map(o => o.name);
		expect(selectable).toEqual(expect.arrayContaining(["Empowered Seal", "Forceful Interdict"]));
		expect(selectable).not.toContain("Mastery of the Blade");

		const masteries = CharacterSheetClassUtils.getEligibleOptionalFeatures(pool, {
			featureTypes: ["IllMastery"],
			prereqContext: {classes: [{name: "Illrigger", source: "TGTT-IllR", level: 2}], totalLevel: 2, existingFeatures: []},
		});
		expect(masteries.filter(o => o._selectable).map(o => o.name)).toEqual(["Mastery of the Blade"]);
	});
});

// ==========================================================================
// PART 3 — #10 Specialties (class-feature option pool)
// ==========================================================================
// Faithful subset of the real "Specialties" pool (homebrew/TravelersGuidetoThelemar.json):
// a level-3 feature carrying the `options` block, then later-level features that
// reference it via "You gain another specialty ... {@classFeature Specialties|...|3}".
const SPEC_OPTION_LEVELS = {
	"Baleful Presence": 3,
	"Dark Resilience": 3,
	"Hellish Avenger": 5,
	"Infernal Awareness": 7,
	"Infernal Supremacy": 19,
};

const SPECIALTIES_L3 = Object.freeze({
	name: "Specialties",
	source: "TGTT-IllR",
	className: "Illrigger",
	classSource: "TGTT-IllR",
	level: 3,
	entries: [
		"You gain a specialty of your choice. You gain another specialty at 5th, 7th, 9th, 11th, 14th, and 19th level.",
		{
			type: "options",
			count: 1,
			entries: Object.entries(SPEC_OPTION_LEVELS).map(([name, lvl]) => ({
				type: "refClassFeature",
				classFeature: `${name}|Illrigger|TGTT-IllR|${lvl}`,
			})),
		},
	],
});

function specialtiesRefFeature (level) {
	return Object.freeze({
		name: "Specialties",
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		level,
		entries: ["You gain another specialty of your choice from the {@classFeature Specialties|Illrigger|TGTT-IllR|3} feature."],
	});
}

const SPECIALTY_LEVELS = [3, 5, 7, 9, 11, 14, 19];
const SPECIALTIES_FEATURES = [SPECIALTIES_L3, ...SPECIALTY_LEVELS.filter(l => l !== 3).map(specialtiesRefFeature)];
// All class features the ref-resolver can see (must include the L3 feature).
const CLASS_FEATURES = [...SPECIALTIES_FEATURES];

describe("Illrigger Specialties option pool (#10)", () => {
	it("surfaces the option group at level 3 with only level-3 specialties", () => {
		const groups = CharacterSheetClassUtils.getFeatureOptionsForLevel([SPECIALTIES_L3], 3, CLASS_FEATURES);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(1);
		const names = groups[0].options.map(o => o.name);
		expect(names).toEqual(expect.arrayContaining(["Baleful Presence", "Dark Resilience"]));
		// Higher-level specialties are gated out at L3.
		expect(names).not.toContain("Hellish Avenger");
		expect(names).not.toContain("Infernal Awareness");
		expect(names).not.toContain("Infernal Supremacy");
	});

	it("resolves the 'another specialty' reference and widens the pool at level 5", () => {
		const groups = CharacterSheetClassUtils.getFeatureOptionsForLevel([specialtiesRefFeature(5)], 5, CLASS_FEATURES);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(1);
		const names = groups[0].options.map(o => o.name);
		expect(names).toEqual(expect.arrayContaining(["Baleful Presence", "Dark Resilience", "Hellish Avenger"]));
		expect(names).not.toContain("Infernal Awareness"); // L7-gated
	});

	it("includes the level-7 specialty once the character reaches level 7", () => {
		const groups = CharacterSheetClassUtils.getFeatureOptionsForLevel([specialtiesRefFeature(7)], 7, CLASS_FEATURES);
		const names = groups[0].options.map(o => o.name);
		expect(names).toContain("Infernal Awareness");
		expect(names).not.toContain("Infernal Supremacy"); // L19-gated
	});

	it("offers exactly one specialty choice at every specialty level 3/5/7/9/11/14/19", () => {
		for (const level of SPECIALTY_LEVELS) {
			const feature = level === 3 ? SPECIALTIES_L3 : specialtiesRefFeature(level);
			const groups = CharacterSheetClassUtils.getFeatureOptionsForLevel([feature], level, CLASS_FEATURES);
			expect(groups.length).toBeGreaterThanOrEqual(1);
			const total = groups.reduce((acc, g) => acc + g.count, 0);
			expect(total).toBe(1);
			expect(groups[0].options.length).toBeGreaterThan(0);
		}
	});

	it("only offers the capstone specialty (Infernal Supremacy) at level 19", () => {
		const at14 = CharacterSheetClassUtils.getFeatureOptionsForLevel([specialtiesRefFeature(14)], 14, CLASS_FEATURES);
		expect(at14[0].options.map(o => o.name)).not.toContain("Infernal Supremacy");
		const at19 = CharacterSheetClassUtils.getFeatureOptionsForLevel([specialtiesRefFeature(19)], 19, CLASS_FEATURES);
		expect(at19[0].options.map(o => o.name)).toContain("Infernal Supremacy");
	});
});

// ==========================================================================
// PART 4 — Persistence round-trip (optional features + specialties)
// ==========================================================================
describe("Illrigger selections persist across a save/load round-trip", () => {
	function roundTrip (state) {
		const json = JSON.parse(JSON.stringify(state.toJSON()));
		const next = new CharacterSheetState();
		next.fromJSON(json);
		return next;
	}

	it("round-trips a known Interdict Boon and a Combat Mastery pick", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 7});
		state.addFeature(storedOptionalFeature("Empowered Seal", "ItdBoon"));
		state.addFeature(storedOptionalFeature("Mastery of the Blade", "IllMastery"));

		const restored = roundTrip(state);
		const feats = restored.getFeatures();
		const boon = feats.find(f => f.name === "Empowered Seal");
		const mastery = feats.find(f => f.name === "Mastery of the Blade");
		expect(boon).toBeTruthy();
		expect(boon.optionalFeatureTypes).toEqual(["ItdBoon"]);
		expect(mastery).toBeTruthy();
		expect(mastery.optionalFeatureTypes).toEqual(["IllMastery"]);

		// A persisted pick must suppress a re-prompt on the next level-up.
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(
			ILLRIGGER_CLASS, 2, 3, stateWithFeatures(restored.getFeatures()),
		);
		expect(gains.find(g => g.featureTypes[0] === "IllMastery")).toBeUndefined();
	});

	it("round-trips a chosen Specialty (feature-option) class feature", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 3});
		state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
			{name: "Dark Resilience", source: "TGTT-IllR", className: "Illrigger", entries: ["Resistance to fire."]},
			{className: "Illrigger", classSource: "TGTT-IllR", level: 3, featureType: "Class"},
		));

		const restored = roundTrip(state);
		const spec = restored.getFeatures().find(f => f.name === "Dark Resilience");
		expect(spec).toBeTruthy();
		expect(spec.featureType).toBe("Class");
	});
});
