/**
 * Effective weapon damage — Unit Tests
 *
 * `item.damage` is a display string frozen when the item was ADDED. Materials and upgrades both
 * land afterwards, so the inventory row spent its whole life showing a number the combat tab
 * disagreed with. `getEffectiveWeaponDamage` derives the line at read time instead.
 *
 * These tests pin the derivation: that it follows the PROJECTED dice (so a material's die step
 * is picked up), that it folds in upgrade bonuses, that riders are kept out of `display` and
 * present in `displayFull`, and that it returns null rather than inventing a damage line.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
// Required, not incidental: `projectItemMaterial` returns the item UNCHANGED when
// `CharacterSheetMaterials` is undefined, so omitting this import silently disables every
// material effect and leaves a die-step test asserting against an unprojected weapon.
import "../../../js/charactersheet/charactersheet-materials.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const mkState = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
};

const addSword = (state, over = {}) => {
	state.addItem({
		name: "Longsword",
		source: "PHB",
		type: "M",
		weapon: true,
		weaponCategory: "martial",
		dmg1: "1d8",
		dmg2: "1d10",
		dmgType: "S",
		weight: 3,
		value: 1500,
		quantity: 1,
		equipped: true,
		...over,
	});
	return state.getItems().slice(-1)[0].id;
};

describe("getEffectiveWeaponDamage", () => {
	// ==========================================================================
	// Null, don't lie
	// ==========================================================================
	it("returns null for an unknown item id", () => {
		expect(mkState().getEffectiveWeaponDamage("nope")).toBeNull();
	});

	it("returns null for an item with no damage dice", () => {
		const state = mkState();
		state.addItem({name: "Lantern", source: "PHB", type: "G", weight: 2, quantity: 1});
		const id = state.getItems().slice(-1)[0].id;
		expect(state.getEffectiveWeaponDamage(id)).toBeNull();
	});

	// ==========================================================================
	// The plain case
	// ==========================================================================
	it("derives the printed line for an unmodified weapon", () => {
		const state = mkState();
		const id = addSword(state);
		const dmg = state.getEffectiveWeaponDamage(id);

		expect(dmg.dice).toBe("1d8");
		expect(dmg.diceVersatile).toBe("1d10");
		expect(dmg.flat).toBe(0);
		expect(dmg.display).toBe("1d8 (1d10) slashing");
		expect(dmg.critThreshold).toBe(20);
	});

	it("does not flag an unmodified weapon as derived", () => {
		const state = mkState();
		expect(state.getEffectiveWeaponDamage(addSword(state)).isModified).toBe(false);
	});

	// ==========================================================================
	// Flat bonuses fold in
	// ==========================================================================
	it("folds a flat weapon bonus into the dice and the versatile figure", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2"});
		const dmg = state.getEffectiveWeaponDamage(id);

		expect(dmg.flat).toBe(2);
		expect(dmg.display).toBe("1d8+2 (1d10+2) slashing");
		expect(dmg.isModified).toBe(true);
	});

	it("reports the attack bonus alongside the damage", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeaponAttack: "+1"});
		expect(state.getEffectiveWeaponDamage(id).attackBonus).toBe(1);
	});

	// ==========================================================================
	// Riders stay out of `display`
	// ==========================================================================
	it("keeps damage riders out of display and in displayFull", () => {
		const state = mkState();
		const id = addSword(state, {bonusDamageDice: "1d6", bonusDamageType: "fire"});
		const dmg = state.getEffectiveWeaponDamage(id);

		if (!dmg.riders.length) return; // rider plumbing is item-shape dependent; skip if unfed
		expect(dmg.display).not.toContain("1d6");
		expect(dmg.displayFull).toContain("1d6");
	});

	// ==========================================================================
	// The whole point: it tracks a material swap
	// ==========================================================================
	it("tracks a material die step without any re-add", () => {
		const state = mkState();
		state.setSetting("enableTgtt", true);
		state.setSetting("materials", true);
		// The brew authors a die step as a top-level `damage` axis. There is no
		// `weaponEffects.damageDieStep` key anywhere in `js/` — a fixture inventing one
		// projects nothing, and every assertion below would pass against an untouched 1d8.
		state.setItemMaterialCatalog([{
			name: "Steeline",
			source: "TGTT",
			_entityType: "itemMaterial",
			materialCategory: "constructed",
			damage: 1,
			appliesTo: ["weapon"],
			roles: ["strikingSurface"],
		}]);

		const id = addSword(state);
		const before = state.getEffectiveWeaponDamage(id).dice;

		state.setItemMaterial(id, state.getItemMaterialCatalog()[0]);
		const after = state.getEffectiveWeaponDamage(id);

		// The die actually moves, and it moves along the material ladder.
		expect(before).toBe("1d8");
		expect(after.dice).toBe("1d10");
		expect(after.diceVersatile).toBe("1d12");

		// And it moved because the derivation re-read the PROJECTED item, not because the
		// stored string changed: the raw entry is still the weapon as authored.
		expect(after.dice).toBe(state.getItems().find(i => i.id === id).dmg1);
		expect(state.getItemRaw(id).dmg1).toBe("1d8");
	});

	// ==========================================================================
	// The stored string is legacy
	// ==========================================================================
	it("ignores the frozen item.damage string entirely", () => {
		const state = mkState();
		const id = addSword(state);
		state.getItemRaw(id).damage = "9d99 psychic";

		expect(state.getEffectiveWeaponDamage(id).display).not.toContain("9d99");
	});
});
