/**
 * ROUND 37 — surgical fixes.
 *
 * Bug #1 (ammo recognition): Blowgun Needles weren't recognised as ammo for a
 * Blowgun (they carry `needleBlowgun: true`, not `needle`), so the weapon got no
 * ammo selector; and a ranged ammunition weapon with no special ammo in the
 * quiver (Hand Crossbow, Blowgun) should STILL show the selector with "Regular"
 * as the sole option.
 *
 * This pins:
 *   (a) state `_matchesAmmoType` matches `needleBlowgun` ammo for both the 2014
 *       Blowgun ammoType ("blowgun needle|phb") and the 2024 one ("needle|xphb").
 *   (b) state `_isAmmunitionItem` recognises a `needleBlowgun` item.
 *   (c) combat `_isAmmoSelectorEligible` is TRUE for a ranged ammunition weapon
 *       even when the quiver is empty (so the selector renders "Regular"-only),
 *       and still FALSE for melee / spell attacks.
 */

import "./setup.js";

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

describe("R37 Bug #1 — Blowgun needle ammo recognition (state)", () => {
	/** @type {*} */
	let state;
	beforeEach(() => { state = Object.create(CharacterSheetState.prototype); });

	const blowgunNeedle = {name: "Blowgun Needle", type: "A", needleBlowgun: true};
	const needle2024 = {name: "Needle", type: "A|XPHB", needleBlowgun: true};
	const arrow = {name: "Arrow", type: "A", arrow: true};

	test("_matchesAmmoType: needleBlowgun matches the 2014 Blowgun ammoType", () => {
		expect(state._matchesAmmoType(blowgunNeedle, "blowgun needle|phb")).toBe(true);
	});

	test("_matchesAmmoType: needleBlowgun matches the 2024 Blowgun ammoType", () => {
		expect(state._matchesAmmoType(needle2024, "needle|xphb")).toBe(true);
		expect(state._matchesAmmoType(blowgunNeedle, "needle|xphb")).toBe(true);
	});

	test("_matchesAmmoType: a needle does NOT match an arrow weapon", () => {
		expect(state._matchesAmmoType(blowgunNeedle, "arrow|phb")).toBe(false);
		// And an arrow does not match a needle weapon.
		expect(state._matchesAmmoType(arrow, "needle|xphb")).toBe(false);
	});

	test("_isAmmunitionItem recognises a needleBlowgun item", () => {
		expect(state._isAmmunitionItem(blowgunNeedle)).toBe(true);
		expect(state._isAmmunitionItem(needle2024)).toBe(true);
	});
});

describe("R37 Bug #1 — selector eligibility for ammo-less ranged weapons (combat)", () => {
	function mkCombat (stateOverrides = {}) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {
			getQuiverAmmunitionForWeapon: () => [],
			getSelectedAmmoId: () => null,
			getEffectiveAmmoCount: (a) => a.quantity || 0,
			...stateOverrides,
		};
		// _getAttackRollKind is only consulted when isMelee isn't passed explicitly.
		combat._getAttackRollKind = (attack) => ({isMelee: !!attack.isMelee, isRanged: !attack.isMelee});
		return combat;
	}

	const blowgun = {name: "Blowgun", isMelee: false, isSpell: false, sourceItem: {id: "bg1", ammoType: "needle|xphb"}};
	const handXbow = {name: "Hand Crossbow", isMelee: false, isSpell: false, sourceItem: {id: "hx1", ammoType: "bolt|xphb"}};

	test("Blowgun with an EMPTY quiver is eligible (Regular-only selector)", () => {
		const combat = mkCombat();
		expect(combat._isAmmoSelectorEligible(blowgun, false)).toBe(true);
		const html = combat._renderAmmoSelector(blowgun, false);
		expect(html).toMatch(/charsheet__attack-ammo-select/);
		expect(html).toMatch(/Regular/);
	});

	test("Hand Crossbow with no special ammo is eligible (Regular-only selector)", () => {
		const combat = mkCombat();
		expect(combat._isAmmoSelectorEligible(handXbow, false)).toBe(true);
		expect(combat._renderAmmoSelector(handXbow, false)).toMatch(/Regular/);
	});

	test("melee and spell attacks remain ineligible", () => {
		const combat = mkCombat();
		const melee = {name: "Rapier", isMelee: true, isSpell: false, sourceItem: {id: "r1", ammoType: undefined}};
		const spell = {name: "Fire Bolt", isMelee: false, isSpell: true, sourceItem: {id: "bg1", ammoType: "needle|xphb"}};
		expect(combat._isAmmoSelectorEligible(melee, true)).toBe(false);
		expect(combat._isAmmoSelectorEligible(spell, false)).toBe(false);
	});

	test("a weapon with NO ammoType is ineligible", () => {
		const combat = mkCombat();
		const sling = {name: "Javelin", isMelee: false, isSpell: false, sourceItem: {id: "j1", ammoType: undefined}};
		expect(combat._isAmmoSelectorEligible(sling, false)).toBe(false);
	});
});
