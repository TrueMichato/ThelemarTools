/**
 * Material damage riders on the attack roll.
 *
 * Cold Iron's "+1 weapon damage die against fey" and Stout Blackwood's "+1d4 on a critical
 * hit" were both authored, normalised and described in the item modal, and neither ever
 * added a single point of damage.
 *
 * Three things here are load-bearing and easy to get quietly wrong:
 *
 * 1. **"+1 weapon damage die" means ONE of the weapon's dice, not a copy of its whole
 *    expression.** A maul rolling `2d6` adds `d6`, not another `2d6`. Getting this wrong
 *    doubles a greatweapon's rider.
 * 2. **A crit rider must not be crit-doubled.** `materialCritDamage` IS the critical bonus;
 *    running it through `_parseDamage(dice, isCrit)` would pay the crit out twice.
 * 3. **One target question, not one per subsystem.** A Cold Iron blade with a socketed
 *    gemstone must ask the player what they're hitting exactly once, and hand the single
 *    answer to both.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const COLD_IRON = {
	name: "Cold Iron",
	source: "TGTT",
	materialCategory: "metal",
	density: 7,
	magicCapacity: 2,
	appliesTo: ["weapon"],
	effects: [{type: "extraDamageDiceVsType", dice: 1, creatureType: "fey"}],
};

const STOUT_BLACKWOOD = {
	name: "Stout Blackwood",
	source: "TGTT",
	materialCategory: "wood",
	density: 1,
	magicCapacity: 2,
	appliesTo: ["weapon"],
	effects: [{type: "bonusCritDamage", dice: "1d4", damageType: "weapon", requiresProperty: "LD"}],
};

const CATALOG = [COLD_IRON, STOUT_BLACKWOOD];

const MAUL = {
	name: "Maul",
	source: "PHB",
	type: "M",
	weapon: true,
	dmg1: "2d6",
	dmgType: "B",
	property: ["H", "2H", "LD"],
	weight: 10,
	value: 1000,
};

function makeCombat () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setItemMaterialCatalog(CATALOG);
	// `Object.create` rather than `new`: the constructor calls `_init`, which binds DOM
	// listeners, and this suite runs in the `node` environment with no `document`. The
	// house idiom (see CharacterSheetActiveAmmoSelector, CharacterSheetBattleMasterXphb).
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	return {state, combat};
}

function equipWithMaterial (state, item, materialName) {
	state.addItem({quantity: 1, equipped: true, ...item});
	const id = state.getItems().slice(-1)[0].id;
	if (materialName) state.setItemMaterial(id, CATALOG.find(m => m.name === materialName));
	const raw = state._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = true;
	state._recalculateEquipmentModifiers();
	return id;
}

describe("_getSingleWeaponDie", () => {
	const {combat} = makeCombat();

	it("takes one die off a multi-die weapon rather than the whole expression", () => {
		// The bug this exists to prevent: a maul's "+1 weapon damage die" is d6, not 2d6.
		expect(combat._getSingleWeaponDie("2d6")).toBe("d6");
	});

	it("reads a single-die weapon", () => {
		expect(combat._getSingleWeaponDie("1d8")).toBe("d8");
	});

	it("ignores a flat modifier attached to the expression", () => {
		expect(combat._getSingleWeaponDie("1d10+3")).toBe("d10");
	});

	it("returns null for flat damage, where the phrase has no meaning", () => {
		expect(combat._getSingleWeaponDie("5")).toBeNull();
	});

	it("tolerates a missing expression", () => {
		expect(combat._getSingleWeaponDie(null)).toBeNull();
		expect(combat._getSingleWeaponDie(undefined)).toBeNull();
		expect(combat._getSingleWeaponDie("")).toBeNull();
	});
});

describe("Target-type prompt pooling", () => {
	it("asks nothing when no rider on the attack is target-gated", async () => {
		const {state, combat} = makeCombat();
		const id = equipWithMaterial(state, MAUL, null);
		const attack = {name: "Maul", sourceItem: {id}};
		await expect(combat._pChooseTargetTypeContext(attack)).resolves.toEqual([]);
	});

	it("offers a material's creature type as a candidate", async () => {
		const {state, combat} = makeCombat();
		const id = equipWithMaterial(state, MAUL, "Cold Iron");
		let offered = null;
		globalThis.InputUiUtil = {
			pGetUserEnum: async ({values}) => {
				offered = values;
				return "fey";
			},
		};
		const result = await combat._pChooseTargetTypeContext({name: "Maul", sourceItem: {id}});
		expect(offered).toEqual(["none", "fey"]);
		expect(result).toEqual(["fey"]);
	});

	it("treats declining the prompt as no qualifying type", async () => {
		const {state, combat} = makeCombat();
		const id = equipWithMaterial(state, MAUL, "Cold Iron");
		globalThis.InputUiUtil = {pGetUserEnum: async () => "none"};
		await expect(combat._pChooseTargetTypeContext({name: "Maul", sourceItem: {id}})).resolves.toEqual([]);
	});

	it("treats a cancelled prompt as no qualifying type", async () => {
		const {state, combat} = makeCombat();
		const id = equipWithMaterial(state, MAUL, "Cold Iron");
		globalThis.InputUiUtil = {pGetUserEnum: async () => null};
		await expect(combat._pChooseTargetTypeContext({name: "Maul", sourceItem: {id}})).resolves.toEqual([]);
	});

	it("asks nothing for an attack with no source item", async () => {
		const {combat} = makeCombat();
		await expect(combat._pChooseTargetTypeContext({name: "Unarmed"})).resolves.toEqual([]);
	});
});

describe("Rider payloads reaching the roll", () => {
	it("hands the combat path Cold Iron's rider with its creature type", () => {
		const {state} = makeCombat();
		const id = equipWithMaterial(state, MAUL, "Cold Iron");
		expect(state.getEffectiveItemBonuses(id).materialExtraDiceVsType)
			.toEqual([{dice: 1, creatureType: "fey", name: "Cold Iron"}]);
	});

	it("hands the combat path Stout Blackwood's crit dice on a qualifying weapon", () => {
		const {state} = makeCombat();
		const id = equipWithMaterial(state, MAUL, "Stout Blackwood");
		expect(state.getEffectiveItemBonuses(id).materialCritDamage)
			.toEqual({dice: "1d4", damageType: null, name: "Stout Blackwood"});
	});

	it("withholds the crit dice from a weapon without the required property", () => {
		const {state} = makeCombat();
		const id = equipWithMaterial(state, {...MAUL, property: ["H", "2H"]}, "Stout Blackwood");
		expect(state.getEffectiveItemBonuses(id).materialCritDamage).toBeUndefined();
	});
});
