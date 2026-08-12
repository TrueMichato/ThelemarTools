/**
 * Arcane Archer — Arcane Shot system (round-4 bug #8).
 *
 * Asserts REAL mechanics, not level counts:
 *  - Resource tracking: max uses (TGTT prof-bonus / official flat 2), spend, clamp,
 *    manual +/-, restore.
 *  - Rest recharge: restored on BOTH short and long rest.
 *  - Ever-Ready Shot (L15): regain one use only when at zero and only when the feature
 *    is present.
 *  - getKnownArcaneShots: surfaces only "AS" optional features.
 *  - Save DC: 8 + prof + (CON TGTT / INT official).
 *  - Subclass-aware option gains: AS progression surfaces at 3/7/10/15/18 with the
 *    correct cumulative counts (root-cause fix in getOptionalFeatureGains), plus
 *    coverage of class/subclass shared featureTypes being summed (CS-BUG-140).
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetRest;
let CharacterSheetClassUtils;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

describe("Arcane Archer — Arcane Shot system", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------
	function makeArcaneArcher (level, {source = "TGTT"} = {}) {
		state.addClass({
			name: "Fighter",
			source,
			level,
			hitDice: "d10",
			subclass: level >= 3
				? {name: "Arcane Archer", shortName: "Arcane Archer", source}
				: undefined,
		});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 18); // +4
		state.setAbilityBase("con", 16); // +3
		state.setAbilityBase("int", 14); // +2
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 8);
	}

	function addKnownShot (name, source = "XGE") {
		state.addFeature({
			name,
			source,
			featureType: "Optional Feature",
			optionalFeatureTypes: ["AS"],
			description: `<p>${name} effect</p>`,
			entries: [`${name} effect`],
		});
	}

	const aaSubclassData = {
		name: "Arcane Archer",
		shortName: "Arcane Archer",
		optionalfeatureProgression: [
			{name: "Arcane Shots", featureType: ["AS"], progression: {3: 2, 7: 3, 10: 4, 15: 5, 18: 6}},
		],
	};

	// -------------------------------------------------------------------------
	// hasArcaneShot gating
	// -------------------------------------------------------------------------
	describe("feature gating", () => {
		it("is inactive before subclass is chosen", () => {
			makeArcaneArcher(1);
			expect(state.hasArcaneShot()).toBe(false);
			expect(state.getArcaneShotMax()).toBe(0);
			expect(state.getArcaneShotRemaining()).toBe(0);
		});

		it("activates at level 3 with the Arcane Archer subclass", () => {
			makeArcaneArcher(3);
			expect(state.hasArcaneShot()).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Resource tracking
	// -------------------------------------------------------------------------
	describe("resource tracking", () => {
		it("TGTT max uses equal the proficiency bonus", () => {
			makeArcaneArcher(3); // prof +2
			expect(state.getArcaneShotMax()).toBe(2);
			makeArcaneArcher(5); // resets class; prof +3
			expect(state.getArcaneShotMax()).toBe(3);
		});

		it("official (PHB) Arcane Archer has a flat 2 uses", () => {
			makeArcaneArcher(11, {source: "PHB"}); // prof +4, but official is flat 2
			expect(state.getArcaneShotMax()).toBe(2);
		});

		it("spends a use and decrements remaining", () => {
			makeArcaneArcher(3);
			expect(state.getArcaneShotRemaining()).toBe(2);
			expect(state.useArcaneShot()).toBe(true);
			expect(state.getArcaneShotRemaining()).toBe(1);
			expect(state.getArcaneShotUsed()).toBe(1);
		});

		it("cannot spend below zero", () => {
			makeArcaneArcher(3); // 2 uses
			expect(state.useArcaneShot()).toBe(true);
			expect(state.useArcaneShot()).toBe(true);
			expect(state.useArcaneShot()).toBe(false); // none left
			expect(state.getArcaneShotRemaining()).toBe(0);
		});

		it("clamps used to max when max shrinks (defensive normalization)", () => {
			makeArcaneArcher(5); // prof +3 → 3 uses
			state.useArcaneShot();
			state.useArcaneShot();
			state.useArcaneShot();
			expect(state.getArcaneShotRemaining()).toBe(0);
			// Drop to level 3 (prof +2 → max 2); used should clamp.
			makeArcaneArcher(3);
			expect(state.getArcaneShotMax()).toBe(2);
			expect(state.getArcaneShotUsed()).toBeLessThanOrEqual(2);
			expect(state.getArcaneShotRemaining()).toBeGreaterThanOrEqual(0);
		});

		it("manual adjust restores and spends, clamped to [0,max]", () => {
			makeArcaneArcher(3); // 2 uses
			state.useArcaneShot();
			state.useArcaneShot(); // 0 remaining
			expect(state.adjustArcaneShotRemaining(1)).toBe(true);
			expect(state.getArcaneShotRemaining()).toBe(1);
			// Cannot exceed max.
			state.adjustArcaneShotRemaining(5);
			expect(state.getArcaneShotRemaining()).toBe(2);
			// Cannot drop below 0.
			state.adjustArcaneShotRemaining(-10);
			expect(state.getArcaneShotRemaining()).toBe(0);
		});

		it("restoreArcaneShot refills to max", () => {
			makeArcaneArcher(3);
			state.useArcaneShot();
			state.useArcaneShot();
			state.restoreArcaneShot();
			expect(state.getArcaneShotRemaining()).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Rest recharge
	// -------------------------------------------------------------------------
	describe("rest recharge", () => {
		it("recharges on a short rest", () => {
			makeArcaneArcher(3);
			state.useArcaneShot();
			state.useArcaneShot();
			expect(state.getArcaneShotRemaining()).toBe(0);
			CharacterSheetRest.prototype._restoreResources.call({_state: state}, "short");
			expect(state.getArcaneShotRemaining()).toBe(2);
		});

		it("recharges on a long rest", () => {
			makeArcaneArcher(3);
			state.useArcaneShot();
			expect(state.getArcaneShotRemaining()).toBe(1);
			CharacterSheetRest.prototype._restoreResources.call({_state: state}, "long");
			expect(state.getArcaneShotRemaining()).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Ever-Ready Shot (level 15)
	// -------------------------------------------------------------------------
	describe("Ever-Ready Shot", () => {
		it("does NOT regain before level 15", () => {
			makeArcaneArcher(10);
			// drain
			while (state.useArcaneShot()) { /* spend all */ }
			expect(state.getArcaneShotRemaining()).toBe(0);
			expect(state.regainOneArcaneShot()).toBe(false);
		});

		it("regains exactly one at level 15 when empty", () => {
			makeArcaneArcher(15);
			expect(state.getFeatureCalculations().hasEverReadyShot).toBe(true);
			while (state.useArcaneShot()) { /* spend all */ }
			expect(state.getArcaneShotRemaining()).toBe(0);
			expect(state.regainOneArcaneShot()).toBe(true);
			expect(state.getArcaneShotRemaining()).toBe(1);
		});

		it("does not regain if uses still remain", () => {
			makeArcaneArcher(15);
			state.useArcaneShot(); // still some left
			expect(state.getArcaneShotRemaining()).toBeGreaterThan(0);
			expect(state.regainOneArcaneShot()).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// getKnownArcaneShots
	// -------------------------------------------------------------------------
	describe("known arcane shots", () => {
		it("returns only AS optional features", () => {
			makeArcaneArcher(3);
			addKnownShot("Banishing Arrow");
			addKnownShot("Grasping Arrow");
			// noise: a non-AS optional feature
			state.addFeature({
				name: "Some Maneuver",
				source: "PHB",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["MV:B"],
				description: "<p>maneuver</p>",
			});
			const shots = state.getKnownArcaneShots();
			expect(shots.map(s => s.name).sort()).toEqual(["Banishing Arrow", "Grasping Arrow"]);
			expect(shots[0]).toHaveProperty("description");
			expect(shots[0]).toHaveProperty("source");
		});

		it("returns an empty array when none are known", () => {
			makeArcaneArcher(3);
			expect(state.getKnownArcaneShots()).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// Save DC
	// -------------------------------------------------------------------------
	describe("save DC", () => {
		it("TGTT uses CON: 8 + prof + CON mod", () => {
			makeArcaneArcher(3); // prof +2, CON +3
			const calcs = state.getFeatureCalculations();
			expect(calcs.arcaneShotSaveDc).toBe(13);
			expect(calcs.arcaneShotAbility).toBe("con");
		});

		it("official uses INT: 8 + prof + INT mod", () => {
			makeArcaneArcher(3, {source: "PHB"}); // prof +2, INT +2
			const calcs = state.getFeatureCalculations();
			expect(calcs.arcaneShotSaveDc).toBe(12);
			expect(calcs.arcaneShotAbility).toBe("int");
		});
	});

	// -------------------------------------------------------------------------
	// Subclass-aware option gains (root-cause fix)
	// -------------------------------------------------------------------------
	describe("subclass-aware option gains", () => {
		const fighterClassData = {name: "Fighter", optionalfeatureProgression: []};

		function gainsFor (cur, next, knownAs = 0) {
			makeArcaneArcher(Math.max(next, 3));
			for (let i = 0; i < knownAs; ++i) addKnownShot(`Shot ${i}`);
			return CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterClassData, cur, next, state, aaSubclassData,
			);
		}

		it("grants 2 options at level 3", () => {
			const gains = gainsFor(0, 3, 0);
			const as = gains.find(g => g.featureTypes.includes("AS"));
			expect(as).toBeDefined();
			expect(as.totalCount).toBe(2);
			expect(as.newCount).toBe(2);
		});

		it("grants 1 more at level 7 (3 total) given 2 already known", () => {
			const gains = gainsFor(3, 7, 2);
			const as = gains.find(g => g.featureTypes.includes("AS"));
			expect(as.totalCount).toBe(3);
			expect(as.newCount).toBe(1);
		});

		it("grants the right cumulative totals at 10/15/18", () => {
			expect(gainsFor(7, 10, 3).find(g => g.featureTypes.includes("AS")).totalCount).toBe(4);
			expect(gainsFor(10, 15, 4).find(g => g.featureTypes.includes("AS")).totalCount).toBe(5);
			expect(gainsFor(15, 18, 5).find(g => g.featureTypes.includes("AS")).totalCount).toBe(6);
		});

		it("surfaces nothing without the subclass argument (proves it is subclass-driven)", () => {
			makeArcaneArcher(3);
			const gains = CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterClassData, 0, 3, state, null,
			);
			expect(gains.find(g => g.featureTypes.includes("AS"))).toBeUndefined();
		});

		// CS-BUG-140 replaced the blanket overlap-guard ("skip any subclass progression
		// whose featureType the class also grants") with an additive merge. These two
		// tests pin what the guard must STILL refuse to merge, so that removing the old
		// behaviour cannot silently re-introduce the opposite bug — over-granting.
		it("still refuses to merge a subclass CTM:* progression (the level-up path owns it)", () => {
			makeArcaneArcher(3);
			const classWithCtm = {
				name: "Fighter",
				optionalfeatureProgression: [
					{name: "Combat Methods", featureType: ["CTM:1AM"], progression: {1: 1}},
				],
			};
			const subWithCtm = {
				name: "Sub",
				optionalfeatureProgression: [
					{name: "More Methods", featureType: ["CTM:1AM"], progression: {3: 2}},
				],
			};
			const gain = CharacterSheetClassUtils.getOptionalFeatureGains(
				classWithCtm, 2, 3, state, subWithCtm,
			).find(g => g.featureTypes.includes("CTM:1AM"));
			// The CLASS-level CTM curve is honoured (total 1), but the subclass's {3: 2}
			// is NOT summed in — were it merged the total would read 3.
			expect(gain.totalCount).toBe(1);
		});

		it("does not over-grant when only the class declares a shared featureType", () => {
			makeArcaneArcher(10);
			const fighterOnly = {
				name: "Fighter",
				optionalfeatureProgression: [
					{name: "Fighting Style", featureType: ["FS:F"], progression: {1: 1, 10: 2}},
				],
			};
			// A subclass that grants a DIFFERENT type must leave the shared curve alone —
			// the merge is per-featureType, not per-subclass.
			const unrelatedSub = {
				name: "Unrelated",
				optionalfeatureProgression: [
					{name: "Arcane Shot", featureType: ["AS"], progression: {3: 2}},
				],
			};
			const gain = CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterOnly, 9, 10, state, unrelatedSub,
			).find(g => g.featureTypes.includes("FS:F"));
			// Two from the class curve alone — the unrelated subclass does not inflate it.
			expect(gain.totalCount).toBe(2);
		});

		it("sums a subclass progression that shares a class featureType (CS-BUG-140)", () => {
			makeArcaneArcher(10);
			// PHB Champion: Fighter grants one Fighting Style at 1, and the subclass grants a
			// SECOND at 10. Both curves are cumulative against one shared "already known"
			// count, so they must be summed — skipping the subclass curve (the old behaviour)
			// meant the level-10 pick was never offered at all.
			const fighterWithClassFs = {
				name: "Fighter",
				optionalfeatureProgression: [
					{name: "Fighting Style", featureType: ["FS:F"], progression: {1: 1}},
				],
			};
			const championSub = {
				name: "Champion",
				optionalfeatureProgression: [
					{name: "Additional Fighting Style", featureType: ["FS:F"], progression: {10: 1}},
				],
			};

			// The character already knows the level-1 Fighting Style.
			state.addFeature({
				name: "Archery",
				source: "PHB",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["FS:F"],
				description: "<p>Archery</p>",
				entries: ["Archery"],
			});

			const withSub = CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterWithClassFs, 9, 10, state, championSub,
			).find(g => g.featureTypes.includes("FS:F"));
			// Exactly ONE new pick at 10, for a running total of two.
			expect(withSub).toBeTruthy();
			expect(withSub.currentCount).toBe(1);
			expect(withSub.newCount).toBe(1);
			expect(withSub.totalCount).toBe(2);

			// Without the subclass there is no second style, so nothing is offered.
			const withoutSub = CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterWithClassFs, 9, 10, state, null,
			).find(g => g.featureTypes.includes("FS:F"));
			expect(withoutSub).toBeUndefined();
		});

		it("does not re-offer a summed subclass pick on a later level-up", () => {
			makeArcaneArcher(11);
			const fighterWithClassFs = {
				name: "Fighter",
				optionalfeatureProgression: [
					{name: "Fighting Style", featureType: ["FS:F"], progression: {1: 1}},
				],
			};
			const championSub = {
				name: "Champion",
				optionalfeatureProgression: [
					{name: "Additional Fighting Style", featureType: ["FS:F"], progression: {10: 1}},
				],
			};
			["Archery", "Defense"].forEach(name => state.addFeature({
				name,
				source: "PHB",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["FS:F"],
				description: `<p>${name}</p>`,
				entries: [name],
			}));
			const gains = CharacterSheetClassUtils.getOptionalFeatureGains(
				fighterWithClassFs, 10, 11, state, championSub,
			);
			expect(gains.find(g => g.featureTypes.includes("FS:F"))).toBeUndefined();
		});
	});
});
