/**
 * Damage-die composition — Unit Tests
 *
 * There used to be TWO ladders. `CharacterSheetUpgrades.increaseDamageDie` held the die
 * COUNT fixed and stepped only the SIZE through `[4, 6, 8, 10, 12]`, while
 * `CharacterSheetMaterials.stepDamageDie` walked the 11-rung Thelemar progression
 * (`1d4 … 1d12, 2d6 … 2d12, 3d8, 3d10`). They agreed across most of the range, which is why
 * the difference went unnamed for so long.
 *
 * Where they disagreed, the upgrade ladder was simply wrong for this setting: `Superior` is
 * its ONLY author, and at `1d12` and `2d12` it clamped — so a Superior greataxe was an
 * upgrade the player paid for that could not change the weapon's damage at all. The ladders
 * are now one; `increaseDamageDie` extracts the bare die and delegates.
 *
 * What this file pins after that change:
 *
 * 1. THE LADDERS ARE ONE, on every die either was ever handed. A future private ladder in
 *    either helper reddens this immediately. The former divergence points are asserted by
 *    value, so "they agree" cannot be satisfied by both being broken the same way.
 *
 * 2. THE STEPS NOW COMMUTE — trivially, being the same function. Recorded rather than
 *    celebrated: order used to be load-bearing for the RESULT and is not any more. It
 *    remains load-bearing for WHERE the value lands, which is section 3. A control proves
 *    the comparison can still detect a difference, so the emptiness is a finding and not
 *    a broken harness.
 *
 * 3. THE PRODUCT APPLIES MATERIAL FIRST. The read-time projection bakes the material into
 *    `dmg1`; the upgrade is applied on top by whoever reads the projected item. The two
 *    halves land in different places, which is what makes the split observable even now
 *    that the arithmetic no longer depends on it.
 *
 * 4. THE CORPUS CANNOT POLICE ANY OF IT. The one real character combining material and
 *    Superior (Arthur's Cataclysm, `2d6` + Steeline + Superior) sits at a die where nothing
 *    above is diagnostic — and its shipped `2d10` is unchanged by the ladder swap, which is
 *    why a corpus diff would have reported this whole change as a no-op.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

/** Every die either ladder can be handed, on-ladder or listed as an equivalent. */
const DICE = ["1d4", "1d6", "1d8", "1d10", "1d12", "2d4", "2d6", "2d8", "2d10", "2d12", "3d6", "3d8", "3d10"];

const matStep = (die, n = 1) => CharacterSheetMaterials.stepDamageDie(die, n);
const upgStep = (die, n = 1) => CharacterSheetUpgrades.increaseDamageDie(die, n);

/**
 * A material carrying ONLY a damage-axis step, in the shape the brew actually authors it:
 * a top-level `damage` axis. There is no `weaponEffects.damageDieStep` key anywhere in the
 * product — a fixture inventing one steps nothing and reports success.
 */
const STEP_MATERIAL = {
	name: "Steeline",
	source: "TGTT",
	_entityType: "itemMaterial",
	materialCategory: "constructed",
	damage: 1,
	appliesTo: ["weapon"],
	roles: ["strikingSurface"],
};

/**
 * Drive the REAL read path: projection bakes the material into `dmg1`, and
 * `getEffectiveWeaponDamage` applies the upgrade step to whatever it finds there.
 *
 * `charactersheet-materials.js` and `charactersheet-upgrades.js` must both be imported —
 * `projectItemMaterial` and `getEffectiveItemBonuses` each skip their whole contribution
 * on `typeof … === "undefined"`, so a missing import yields an unmodified die rather than
 * an error.
 */
const composeThroughProduct = (dmg1, {isMaterial = true, isUpgrade = true} = {}) => {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setItemMaterialCatalog([STEP_MATERIAL]);
	state.addItem({
		name: "Probe",
		source: "PHB",
		type: "M",
		weapon: true,
		weaponCategory: "martial",
		dmg1,
		dmgType: "S",
		weight: 3,
		value: 1500,
		quantity: 1,
		equipped: true,
		appliedUpgrades: isUpgrade ? [{name: "Superior", source: "TCAH"}] : [],
	});
	const id = state.getItems().slice(-1)[0].id;
	if (isMaterial) state.setItemMaterial(id, STEP_MATERIAL);

	return {
		projected: state.getItems().find(i => i.id === id).dmg1,
		effective: state.getEffectiveWeaponDamage(id).dice,
	};
};

describe("damage-die composition: one ladder, one order", () => {
	// ==========================================================================
	// 1. The ladders are one
	// ==========================================================================
	describe("the upgrade ladder is the material ladder", () => {
		const diverging = DICE.filter(die => matStep(die) !== upgStep(die));

		it("agrees on every die either ladder is ever handed", () => {
			expect(diverging).toEqual([]);
		});

		it("still agrees when the step is negative, which only the material ladder used to accept", () => {
			// Gold (−1) and Heart Stone (−2) author negative steps. The old upgrade ladder
			// would happily walk backwards down its own short ladder and disagree.
			expect(DICE.filter(die => matStep(die, -1) !== upgStep(die, -1))).toEqual([]);
			expect(DICE.filter(die => matStep(die, -2) !== upgStep(die, -2))).toEqual([]);
		});

		/**
		 * Agreement alone is satisfiable by both helpers being broken identically — which
		 * is precisely what delegation makes easy. So the three rungs that used to diverge
		 * are asserted BY VALUE, against the Thelemar progression rather than against each
		 * other.
		 */
		it("walks past the rungs where the upgrade ladder used to clamp", () => {
			expect(upgStep("1d12")).toBe("2d6");
			expect(upgStep("2d12")).toBe("3d8");
		});

		it("stops at 3d10, and never invents the off-ladder 3d12", () => {
			// The old upgrade ladder produced 3d12 here, a die the material progression does
			// not contain. Fixing the clamp had to not introduce its mirror image.
			expect(upgStep("3d10")).toBe("3d10");
			expect(CharacterSheetMaterials.DIE_LADDER).not.toContain("3d12");
		});

		/**
		 * The one contract the two helpers do NOT share, and must not: `increaseDamageDie`
		 * is die-only and loose about its input, because the exporter hands it a formula.
		 * `stepDamageDie` is anchored and would return that formula unchanged — a silent
		 * no-op. Extracting the bare die first is what lets one ladder serve both callers.
		 */
		it("keeps the die-only contract that lets a formula be stepped at all", () => {
			expect(upgStep("2d6+15")).toBe("2d8");
			expect(matStep("2d6+15")).toBe("2d6+15");
		});
	});

	// ==========================================================================
	// 2. Order no longer changes the number
	// ==========================================================================
	describe("the two steps commute", () => {
		const nonCommuting = DICE.filter(die => upgStep(matStep(die)) !== matStep(upgStep(die)));

		it("commutes on every die, now that both steps walk the same rungs", () => {
			expect(nonCommuting).toEqual([]);
		});

		/**
		 * Anti-vacuity. An empty list is what a broken comparison also produces, so prove
		 * the same filter still finds a difference when one genuinely exists — here against
		 * the sides-only ladder the upgrade helper used to carry.
		 */
		it("would still detect a divergence, so the empty list above is a finding", () => {
			const legacyStep = (die) => {
				const order = [4, 6, 8, 10, 12];
				const m = String(die).match(/(\d+)d(\d+)/);
				if (!m) return die;
				const ix = order.indexOf(Number(m[2]));
				if (ix === -1) return die;
				return `${Number(m[1])}d${order[Math.min(ix + 1, order.length - 1)]}`;
			};
			const wouldDiverge = DICE.filter(die => legacyStep(matStep(die)) !== matStep(legacyStep(die)));
			expect(wouldDiverge.length).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// 3. The invariant: the product applies the material first
	// ==========================================================================
	describe("the product composes material-first", () => {
		/**
		 * The arithmetic no longer distinguishes the orders, so this section can no longer
		 * be proven by a number. It is proven by WHERE each half lands instead: `dmg1`
		 * carries the material only, and the upgrade is applied on top at read time. That
		 * split is the actual invariant and it survived the ladder change untouched.
		 */
		it("bakes the material into the projected die and leaves the upgrade to the reader", () => {
			const {projected, effective} = composeThroughProduct("1d10");
			expect(projected).toBe("1d12");
			expect(effective).toBe("2d6");

			expect(composeThroughProduct("1d10", {isUpgrade: false}).projected).toBe("1d12");
			expect(composeThroughProduct("1d10", {isMaterial: false}).projected).toBe("1d10");
		});

		it("applies exactly two steps, not one and not three", () => {
			// The failure mode a material-first/upgrade-first mix-up would actually produce
			// today is a DOUBLE-APPLIED or DROPPED step, not a different rung.
			expect(composeThroughProduct("1d10").effective).toBe(matStep("1d10", 2));
			expect(composeThroughProduct("1d12").effective).toBe(matStep("1d12", 2));
			expect(composeThroughProduct("1d10", {isUpgrade: false}).effective).toBe(matStep("1d10", 1));
			expect(composeThroughProduct("1d10", {isMaterial: false}).effective).toBe(matStep("1d10", 1));
		});
	});

	// ==========================================================================
	// 4. The one real character — and why it cannot police the rule
	// ==========================================================================
	describe("Arthur's Cataclysm is live but blind to the ladder change", () => {
		it("reproduces the shipped 2d10, unchanged by the ladder swap", () => {
			// 2d6 maul, Steeline (+1 damage axis), Superior among five upgrades. 2d6 is
			// mid-ladder in both the old and new progressions, so the shipped statblock
			// number does not move. Recorded because a corpus diff of IDENTICAL across this
			// change would be true and worthless as evidence that nothing changed.
			expect(composeThroughProduct("2d6").effective).toBe("2d10");
		});

		it("sits where the former divergence cannot reach it", () => {
			expect(["1d12", "2d12", "3d10"]).not.toContain("2d6");
		});
	});
});
