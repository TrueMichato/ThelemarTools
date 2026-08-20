/**
 * Damage-die composition — Unit Tests
 *
 * TWO ladders move a weapon's damage die, and they are not the same ladder:
 *
 *   - `CharacterSheetMaterials.stepDamageDie`  walks the 11-rung Thelemar progression
 *     (`1d4 … 1d12, 2d6 … 2d12, 3d8, 3d10`) and accepts negative steps.
 *   - `CharacterSheetUpgrades.increaseDamageDie` holds the die COUNT fixed and steps only
 *     the die SIZE through `[4, 6, 8, 10, 12]`.
 *
 * They agree across most of the range, which is why the difference went unnamed: it is
 * invisible everywhere a weapon actually sits. These tests pin the three things that are
 * NOT obvious from either function alone.
 *
 * 1. WHERE THEY DIVERGE. Three dice, not one — and the third one INVERTS. At `1d12` and
 *    `2d12` the upgrade ladder clamps while the material ladder walks on; at `3d10` it is
 *    the MATERIAL ladder that stops and the upgrade ladder that continues, to `3d12` —
 *    a die that is not on the material ladder at all. "The upgrade ladder is the short
 *    one" is therefore two-thirds true, and any rules decision phrased as "should Superior
 *    walk further past 1d12" silently also decides `2d12` and REDUCES `3d8`/`3d10`.
 *
 * 2. THE COMPOSITION DOES NOT COMMUTE. Applying a material step then an upgrade step gives
 *    a different die from the reverse at five of thirteen dice, including `1d10` — a very
 *    common weapon die. So the order is load-bearing, not incidental.
 *
 * 3. THE PRODUCT APPLIES MATERIAL FIRST. Every path agrees on this today — the read-time
 *    projection bakes the material into `dmg1`, and the upgrade step is applied afterwards
 *    by whoever reads the projected item. Nothing enforced it, and the corpus cannot: the
 *    one real character combining the two (Arthur's Cataclysm, `2d6` + Steeline + Superior)
 *    sits at a die where the two orders AGREE. The combination is live; the invariant is
 *    corpus-invisible. That is exactly the gap a unit test has to cover.
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

describe("damage-die composition: two ladders, one order", () => {
	// ==========================================================================
	// 1. Where the ladders disagree
	// ==========================================================================
	describe("the two ladders diverge on an exact set", () => {
		const diverging = DICE.filter(die => matStep(die) !== upgStep(die));

		it("diverges somewhere at all", () => {
			// Anti-vacuity: if the ladders were ever unified this whole describe would pass
			// by saying nothing, so prove the comparison has teeth before pinning the set.
			expect(diverging.length).toBeGreaterThan(0);
		});

		it("diverges on exactly these dice", () => {
			expect(diverging).toEqual(["1d12", "2d12", "3d10"]);
		});

		it("lets the material ladder walk past the upgrade clamp at the 1d12 and 2d12 rungs", () => {
			expect([matStep("1d12"), upgStep("1d12")]).toEqual(["2d6", "1d12"]);
			expect([matStep("2d12"), upgStep("2d12")]).toEqual(["3d8", "2d12"]);
		});

		it("INVERTS at 3d10, where the material ladder is the one that stops", () => {
			// The reason "make Superior use the Thelemar ladder" is not a one-line change:
			// at the top rung it would turn 3d12 into 3d10, a reduction nobody asked for.
			expect(matStep("3d10")).toBe("3d10");
			expect(upgStep("3d10")).toBe("3d12");
			expect(CharacterSheetMaterials.DIE_LADDER).not.toContain("3d12");
		});
	});

	// ==========================================================================
	// 2. Order is load-bearing
	// ==========================================================================
	describe("the two steps do not commute", () => {
		const nonCommuting = DICE.filter(die => upgStep(matStep(die)) !== matStep(upgStep(die)));

		it("fails to commute somewhere at all", () => {
			expect(nonCommuting.length).toBeGreaterThan(0);
		});

		it("fails to commute on exactly these dice", () => {
			expect(nonCommuting).toEqual(["1d10", "1d12", "2d10", "2d12", "3d8"]);
		});

		it("differs by a whole die on 1d10, which is an ordinary weapon die", () => {
			// Halberd, glaive, pike, heavy crossbow, versatile longsword. Not a corner case.
			expect(upgStep(matStep("1d10"))).toBe("1d12");
			expect(matStep(upgStep("1d10"))).toBe("2d6");
		});
	});

	// ==========================================================================
	// 3. The invariant: the product applies the material first
	// ==========================================================================
	describe("the product composes material-first", () => {
		it("applies the material step before the upgrade step on 1d10", () => {
			// Anti-vacuity, stated inside the test: this die is only diagnostic because the
			// two orders disagree on it. If that ever stops being true the assertion below
			// stops distinguishing anything, and this line fails first.
			expect(upgStep(matStep("1d10"))).not.toBe(matStep(upgStep("1d10")));

			expect(composeThroughProduct("1d10").effective).toBe("1d12");
		});

		it("applies the material step before the upgrade step on 1d12", () => {
			expect(upgStep(matStep("1d12"))).not.toBe(matStep(upgStep("1d12")));

			expect(composeThroughProduct("1d12").effective).toBe("2d8");
		});

		it("bakes the material into the projected die and leaves the upgrade to the reader", () => {
			// The two halves land in different places, which is what makes the order fixed:
			// `dmg1` carries the material only, and the upgrade is applied on top at read time.
			const {projected, effective} = composeThroughProduct("1d10");
			expect(projected).toBe("1d12");
			expect(effective).toBe("1d12");

			expect(composeThroughProduct("1d10", {isUpgrade: false}).projected).toBe("1d12");
			expect(composeThroughProduct("1d10", {isMaterial: false}).projected).toBe("1d10");
		});
	});

	// ==========================================================================
	// 4. The one real character — and why it cannot police the rule
	// ==========================================================================
	describe("Arthur's Cataclysm is live but blind to the ordering", () => {
		it("reproduces the shipped 2d10", () => {
			// 2d6 maul, Steeline (+1 damage axis), Superior among five upgrades.
			expect(composeThroughProduct("2d6").effective).toBe("2d10");
		});

		it("sits on a die where both orders agree, so a reorder would not move it", () => {
			// Recorded, not celebrated: the only corpus instance of material+Superior cannot
			// detect the bug the tests above exist to catch. A corpus diff of `IDENTICAL`
			// across an ordering change would be true and worthless.
			expect(upgStep(matStep("2d6"))).toBe(matStep(upgStep("2d6")));
		});
	});
});
