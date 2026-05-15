/**
 * Character Sheet Class-Feature Reconciliation - Unit Tests
 *
 * Verifies the root-cause fix for "Evasion is calc'd correctly but not in
 * the Features tab": `state.addClass()` / `state.levelUp()` only refresh
 * calculation flags — they don't push canonical class features into
 * `_data.features`. Only the level-up wizard does. So characters whose
 * level was set via direct mutation (or via a save migration that dropped
 * features) end up with `hasEvasion = true` but no Evasion card.
 *
 * `CharacterSheetClassUtils.reconcileClassFeatures(state, opts)` walks the
 * canonical class+level matrix and ingests anything missing.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// ---- Mock class data registries ------------------------------------------

const mockRogueXphb = {
	name: "Rogue",
	source: "XPHB",
	classFeatures: [
		"Expertise|Rogue|XPHB|1",
		"Sneak Attack|Rogue|XPHB|1",
		"Cunning Action|Rogue|XPHB|2",
		"Roguish Archetype|Rogue|XPHB|3",
		"Ability Score Improvement|Rogue|XPHB|4",
		"Uncanny Dodge|Rogue|XPHB|5",
		"Expertise|Rogue|XPHB|6",
		"Evasion|Rogue|XPHB|7",
	],
};

const mockMonkXphb = {
	name: "Monk",
	source: "XPHB",
	classFeatures: [
		"Martial Arts|Monk|XPHB|1",
		"Unarmored Defense|Monk|XPHB|1",
		"Monk's Focus|Monk|XPHB|2",
		"Unarmored Movement|Monk|XPHB|2",
		"Monk Subclass|Monk|XPHB|3",
		"Deflect Attacks|Monk|XPHB|3",
		"Ability Score Improvement|Monk|XPHB|4",
		"Slow Fall|Monk|XPHB|4",
		"Extra Attack|Monk|XPHB|5",
		"Stunning Strike|Monk|XPHB|5",
		"Empowered Strikes|Monk|XPHB|6",
		"Evasion|Monk|XPHB|7",
	],
};

const mockClassFeaturesRegistry = [
	{name: "Expertise", className: "Rogue", source: "XPHB", level: 1, entries: ["Pick two skills."]},
	{name: "Sneak Attack", className: "Rogue", source: "XPHB", level: 1, entries: ["Extra damage on advantage."]},
	{name: "Cunning Action", className: "Rogue", source: "XPHB", level: 2, entries: ["Bonus action dash/dodge/disengage."]},
	{name: "Roguish Archetype", className: "Rogue", source: "XPHB", level: 3, entries: ["Pick a subclass."]},
	{name: "Uncanny Dodge", className: "Rogue", source: "XPHB", level: 5, entries: ["Halve damage as reaction."]},
	{name: "Evasion", className: "Rogue", source: "XPHB", level: 7, entries: ["On a successful Dex save..."]},

	{name: "Martial Arts", className: "Monk", source: "XPHB", level: 1, entries: ["Martial arts dice."]},
	{name: "Unarmored Defense", className: "Monk", source: "XPHB", level: 1, entries: ["AC = 10 + DEX + WIS."]},
	{name: "Monk's Focus", className: "Monk", source: "XPHB", level: 2, entries: ["Focus points."]},
	{name: "Unarmored Movement", className: "Monk", source: "XPHB", level: 2, entries: ["Speed bonus."]},
	{name: "Deflect Attacks", className: "Monk", source: "XPHB", level: 3, entries: ["Reduce ranged damage."]},
	{name: "Slow Fall", className: "Monk", source: "XPHB", level: 4, entries: ["Reduce fall damage."]},
	{name: "Extra Attack", className: "Monk", source: "XPHB", level: 5, entries: ["Two attacks per Attack action."]},
	{name: "Stunning Strike", className: "Monk", source: "XPHB", level: 5, entries: ["Spend focus to stun."]},
	{name: "Empowered Strikes", className: "Monk", source: "XPHB", level: 6, entries: ["Magical unarmed strikes."]},
	{name: "Evasion", className: "Monk", source: "XPHB", level: 7, entries: ["On a successful Dex save..."]},
];

const buildOpts = () => ({
	getClassData: (name, source) => {
		if (name === "Rogue" && source === "XPHB") return mockRogueXphb;
		if (name === "Monk" && source === "XPHB") return mockMonkXphb;
		return null;
	},
	classFeatures: mockClassFeaturesRegistry,
	subclassFeatures: [],
});

// ---- Tests ----------------------------------------------------------------

describe("CharacterSheetClassUtils.reconcileClassFeatures", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("baseline gap (root-cause demonstration)", () => {
		test("addClass() alone leaves _data.features empty for canonical class features", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			const featureNames = state.getFeatures().map(f => f.name);
			// This is the bug: Evasion is a real class feature but never lands.
			expect(featureNames).not.toContain("Evasion");
		});

		test("but the calculation flag IS set (so combat works)", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			expect(state.getFeatureCalculations().hasEvasion).toBe(true);
		});
	});

	describe("reconcile fixes the gap", () => {
		test("Rogue 7 reconcile pulls Evasion into _data.features as a class feature", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			expect(result.classesProcessed).toBe(1);
			expect(result.added).toBeGreaterThan(0);

			const evasion = state.getFeatures().find(f => f.name === "Evasion");
			expect(evasion).toBeDefined();
			expect(evasion.className).toBe("Rogue");
			expect(evasion.classSource).toBe("XPHB");
			expect(evasion.level).toBe(7);
			expect(evasion.featureType).toBe("Class");
		});

		test("also backfills lower-level features (Sneak Attack at L1, Cunning Action at L2, ...)", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const featureNames = state.getFeatures().map(f => f.name);
			expect(featureNames).toContain("Sneak Attack");
			expect(featureNames).toContain("Cunning Action");
			expect(featureNames).toContain("Uncanny Dodge");
			expect(featureNames).toContain("Evasion");
		});

		test("Monk 7 reconcile pulls Evasion as a Monk class feature", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 7});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const monkEvasion = state.getFeatures().find(f => f.name === "Evasion" && f.className === "Monk");
			expect(monkEvasion).toBeDefined();
			expect(monkEvasion.level).toBe(7);
		});

		test("does NOT pull features for levels above the character's current level", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 6});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const featureNames = state.getFeatures().map(f => f.name);
			expect(featureNames).toContain("Uncanny Dodge"); // L5 — included
			expect(featureNames).not.toContain("Evasion"); // L7 — excluded
		});

		test("filters out ASI placeholders", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const asiCount = state.getFeatures().filter(f =>
				/ability score (improvement|increase)/i.test(f.name),
			).length;
			expect(asiCount).toBe(0);
		});
	});

	describe("idempotency", () => {
		test("running reconcile twice does not duplicate features", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
			const countAfterFirst = state.getFeatures().length;

			const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
			const countAfterSecond = state.getFeatures().length;

			expect(countAfterSecond).toBe(countAfterFirst);
			expect(result.added).toBe(0);
		});

		test("does not duplicate when wizard had already ingested the feature", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			// Simulate the wizard having already ingested Evasion.
			state.addFeature({
				name: "Evasion",
				className: "Rogue",
				classSource: "XPHB",
				source: "XPHB",
				level: 7,
				featureType: "Class",
				entries: ["..."],
			});
			const countBefore = state.getFeatures().filter(f => f.name === "Evasion").length;
			expect(countBefore).toBe(1);

			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const countAfter = state.getFeatures().filter(f => f.name === "Evasion").length;
			expect(countAfter).toBe(1);
		});
	});

	describe("multiclass", () => {
		test("Rogue 7 + Monk 7 keeps both Evasions (different className)", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			state.addClass({name: "Monk", source: "XPHB", level: 7});
			CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

			const evasions = state.getFeatures().filter(f => f.name === "Evasion");
			expect(evasions).toHaveLength(2);
			const classNames = evasions.map(e => e.className).sort();
			expect(classNames).toEqual(["Monk", "Rogue"]);
		});
	});

	describe("safety / robustness", () => {
		test("returns 0/0 when state is missing", () => {
			const result = CharacterSheetClassUtils.reconcileClassFeatures(null, buildOpts());
			expect(result).toEqual({added: 0, classesProcessed: 0});
		});

		test("returns 0/0 when getClassData is not a function", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			const result = CharacterSheetClassUtils.reconcileClassFeatures(state, {});
			expect(result).toEqual({added: 0, classesProcessed: 0});
		});

		test("skips classes whose data cannot be resolved (homebrew not loaded)", () => {
			state.addClass({name: "UnknownHomebrewClass", source: "ZZZ", level: 5});
			const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
			expect(result.classesProcessed).toBe(0);
			expect(result.added).toBe(0);
		});

		test("processes mixed known + unknown classes correctly", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 3});
			state.addClass({name: "UnknownHomebrew", source: "ZZZ", level: 2});
			const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
			expect(result.classesProcessed).toBe(1);
			expect(result.added).toBeGreaterThan(0);
		});
	});
});
