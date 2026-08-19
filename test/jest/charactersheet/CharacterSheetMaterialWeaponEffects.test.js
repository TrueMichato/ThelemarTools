/**
 * Material effects that change what a weapon does.
 *
 * Every case here is a promise the brew made and the sheet quietly broke: Skyshard said
 * "+20 ft. thrown range" and the range string never moved; Emberglass said the blade "may
 * deal fire damage instead" and no such choice was ever offered; Silver and Orichalcum said
 * they overcome resistance and nothing overcame anything.
 *
 * Two invariants are load-bearing and get their own cases:
 *
 * 1. **Optional overrides widen, they do not replace.** Emberglass offers fire *as well as*
 *    slashing. A material that silently swapped the damage type would take a decision away
 *    from the player that the book explicitly gives them.
 * 2. **Gates are honoured.** Thrown range only shifts on a weapon that can actually be
 *    thrown; a crit rider that requires a property does not appear without it. The
 *    projection reads the item, so a gate that is not checked is a gate that does not exist.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

const SKYSHARD = {
	name: "Skyshard",
	source: "TGTT",
	materialCategory: "condensate",
	density: 2.5,
	magicCapacity: 3,
	appliesTo: ["weapon"],
	effects: [{type: "thrownRangeDelta", value: 20}],
};

const EMBERGLASS = {
	name: "Emberglass",
	source: "TGTT",
	materialCategory: "condensate",
	density: 2.5,
	magicCapacity: 3,
	appliesTo: ["weapon"],
	effects: [{type: "overrideDamageType", damageType: "fire", optional: true}],
};

const ORICHALINE = {
	name: "Orichaline",
	source: "TGTT",
	materialCategory: "metal",
	density: 7,
	magicCapacity: 5,
	appliesTo: ["weapon"],
	penetration: 5,
	effects: [
		{type: "countsAsMagical", appliesTo: ["weapon"]},
		{type: "penetrationIgnoresMagicalAc"},
	],
};

const SILVER = {
	name: "Silver",
	source: "TGTT",
	materialCategory: "metal",
	density: 10,
	magicCapacity: 3,
	appliesTo: ["weapon"],
	effects: [{type: "countsAsSilvered"}],
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

const COLD_IRON = {
	name: "Cold Iron",
	source: "TGTT",
	materialCategory: "metal",
	density: 7,
	magicCapacity: 2,
	appliesTo: ["weapon"],
	effects: [{type: "extraDamageDiceVsType", dice: 1, creatureType: "fey"}],
};

const YELLOWWOOD = {
	name: "Yellowwood",
	source: "TGTT",
	materialCategory: "wood",
	density: 1,
	magicCapacity: 2,
	appliesTo: ["weapon"],
	effects: [{type: "noRangedDisadvantageInMelee"}],
};

const CATALOG = [SKYSHARD, EMBERGLASS, ORICHALINE, SILVER, STOUT_BLACKWOOD, COLD_IRON, YELLOWWOOD];

const HANDAXE = {
	name: "Handaxe",
	source: "PHB",
	type: "M",
	weapon: true,
	dmg1: "1d6",
	dmgType: "S",
	range: "20/60",
	property: ["L", "T"],
	weight: 2,
	value: 500,
};
const LONGSWORD = {
	name: "Longsword",
	source: "PHB",
	type: "M",
	weapon: true,
	dmg1: "1d8",
	dmgType: "S",
	property: ["V"],
	weight: 3,
	value: 1500,
};
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

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setItemMaterialCatalog(CATALOG);
	return state;
}

/** Add an item, equip it, apply a material, and return its id. */
function equipWithMaterial (state, item, materialName) {
	state.addItem({quantity: 1, equipped: true, ...item});
	const id = state.getItems().slice(-1)[0].id;
	if (materialName) state.setItemMaterial(id, CATALOG.find(m => m.name === materialName));
	const raw = state._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = true;
	state._recalculateEquipmentModifiers();
	return id;
}

const projected = (state, id) => state.getItems().find(it => it.id === id);

describe("Skyshard thrown range", () => {
	it("shifts both the short and long band of a thrown weapon", () => {
		const state = makeState();
		const id = equipWithMaterial(state, HANDAXE, "Skyshard");
		expect(projected(state, id).range).toBe("40/80");
	});

	it("leaves a weapon that cannot be thrown alone", () => {
		const state = makeState();
		const id = equipWithMaterial(state, {...LONGSWORD, range: "5"}, "Skyshard");
		expect(projected(state, id).range).toBe("5");
	});

	it("recognises a source-qualified thrown property", () => {
		const state = makeState();
		const id = equipWithMaterial(state, {...HANDAXE, property: ["L|XPHB", "T|XPHB"]}, "Skyshard");
		expect(projected(state, id).range).toBe("40/80");
	});

	it("shifts a single-band range", () => {
		const state = makeState();
		const id = equipWithMaterial(state, {...HANDAXE, range: "30"}, "Skyshard");
		expect(projected(state, id).range).toBe("50");
	});
});

describe("Orichaline penetration against magical AC", () => {
	it("projects the flag onto the item", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, "Orichaline");
		expect(projected(state, id).penetrationIgnoresMagicalAc).toBe(true);
	});

	it("does not set it on an ordinary material", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, "Silver");
		expect(projected(state, id).penetrationIgnoresMagicalAc).toBeUndefined();
	});

	it("reaches the item derivation the combat path reads", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, "Orichaline");
		expect(state.getEffectiveItemBonuses(id).penetrationIgnoresMagicalAc).toBe(true);
	});
});

describe("Optional damage-type overrides", () => {
	it("offers fire alongside the weapon's own type, base first", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, "Emberglass");
		expect(state.getWeaponDamageTypeChoices(id, "slashing")).toEqual(["slashing", "fire"]);
	});

	it("offers nothing extra without a material", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, null);
		expect(state.getWeaponDamageTypeChoices(id, "slashing")).toEqual(["slashing"]);
	});

	it("never duplicates a type the weapon already deals", () => {
		const state = makeState();
		const id = equipWithMaterial(state, {...LONGSWORD, dmgType: "F"}, "Emberglass");
		expect(state.getWeaponDamageTypeChoices(id, "fire")).toEqual(["fire"]);
	});

	it("returns just the base for a weapon id that is not in inventory", () => {
		const state = makeState();
		expect(state.getWeaponDamageTypeChoices("nope", "slashing")).toEqual(["slashing"]);
	});

	it("reports the offering material by name", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LONGSWORD, "Emberglass");
		expect(state.getMaterialDamageTypeChoice(id)).toMatchObject({damageType: "fire", optional: true, materialName: "Emberglass"});
	});

	it("returns null when asked about nothing", () => {
		expect(makeState().getMaterialDamageTypeChoice(null)).toBeNull();
	});
});

describe("Weapon tags from materials", () => {
	it("tags an Orichaline weapon as magical", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, "Orichaline"));
		expect(eff.countsAsMagical).toBe(true);
		expect(eff.tags).toContain("Magical");
	});

	it("tags a Silver weapon as silvered, and not as magical", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, "Silver"));
		expect(eff.countsAsSilvered).toBe(true);
		expect(eff.tags).toContain("Silvered");
		expect(eff.countsAsMagical).toBe(false);
	});

	it("leaves a plain weapon untagged", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, null));
		expect(eff.countsAsMagical).toBe(false);
		expect(eff.countsAsSilvered).toBe(false);
		expect(eff.tags).toEqual([]);
	});
});

describe("Material combat riders", () => {
	it("gives Stout Blackwood its crit dice on a weapon with the required property", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, MAUL, "Stout Blackwood"));
		expect(eff.materialCritDamage).toMatchObject({dice: "1d4", name: "Stout Blackwood"});
	});

	it("withholds it from a weapon lacking the property", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, "Stout Blackwood"));
		expect(eff.materialCritDamage).toBeUndefined();
	});

	it("resolves a 'weapon' crit damage type to the weapon's own, not a literal type", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, MAUL, "Stout Blackwood"));
		expect(eff.materialCritDamage.damageType).toBeNull();
	});

	it("carries Cold Iron's fey rider with its creature type", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, "Cold Iron"));
		expect(eff.materialExtraDiceVsType).toEqual([{dice: 1, creatureType: "fey", name: "Cold Iron"}]);
	});

	it("carries Yellowwood's melee-range exemption", () => {
		const state = makeState();
		const eff = state.getEffectiveItemBonuses(equipWithMaterial(state, LONGSWORD, "Yellowwood"));
		expect(eff.noRangedDisadvantageInMelee).toBe(true);
	});
});

describe("Property gate helper", () => {
	it("matches a bare property abbreviation", () => {
		expect(CharacterSheetMaterials._hasProperty({property: ["LD", "H"]}, "LD")).toBe(true);
	});

	it("matches a source-qualified abbreviation", () => {
		expect(CharacterSheetMaterials._hasProperty({property: ["LD|XPHB"]}, "LD")).toBe(true);
	});

	it("does not match a different property", () => {
		expect(CharacterSheetMaterials._hasProperty({property: ["V"]}, "LD")).toBe(false);
	});

	it("tolerates an item with no properties at all", () => {
		expect(CharacterSheetMaterials._hasProperty({}, "LD")).toBe(false);
	});
});
