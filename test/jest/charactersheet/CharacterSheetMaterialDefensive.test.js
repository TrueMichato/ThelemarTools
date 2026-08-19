/**
 * Defensive and utility material effects.
 *
 * Three promises the brew made that the sheet never kept:
 *
 * - **Deep Crystal**: "a weapon with a deep-crystal striking surface can be used as a
 *   spellcasting focus" — and casting still reported no focus carried.
 * - **Mirror Amalgam**: a focus, plus a Divination/Illusion bonus.
 * - **Nightsilk**: "creatures have a −2 penalty to passive Perception to notice its
 *   carrier" — a number that never appeared anywhere.
 *
 * The Nightsilk case is the interesting one. The sheet models ONE character, so an
 * observer's penalty has no direct home; the temptation is to write it off as prose. But a
 * −2 to the observer's check is arithmetically identical to a +2 on the wearer's contested
 * Stealth, so it IS mechanizable — as a CONDITIONAL bonus, because it applies to being
 * noticed and not to every use of Stealth, and only the player knows which roll is which.
 *
 * The focus cases pin scope carefully: focus paths are CARRIED, not equipped (a component
 * pouch in your pack works), and `appliesTo` gating must survive — a Deep Crystal ring is
 * not a focus, because the brew says the property belongs to a weapon's striking surface.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const DEEP_CRYSTAL = {
	name: "Deep Crystal",
	source: "TGTT",
	materialCategory: "stone",
	density: 3,
	magicCapacity: 4,
	appliesTo: ["weapon", "other"],
	effects: [{type: "spellcastingFocus", appliesTo: ["weapon"], note: "A weapon with a deep-crystal striking surface can be used as a spellcasting focus."}],
};

const MIRROR_AMALGAM = {
	name: "Mirror Amalgam",
	source: "TGTT",
	materialCategory: "metal",
	density: 5,
	magicCapacity: 4,
	appliesTo: ["weapon", "armor", "other"],
	effects: [{type: "spellcastingFocus", schools: ["D", "I"], noteMode: "qualifier", note: "Once per Long Rest when a Divination or Illusion spell is cast through it, the caster can double either the spell's range or its duration."}],
};

const NIGHTSILK = {
	name: "Nightsilk",
	source: "TGTT",
	materialCategory: "cloth",
	density: 0.5,
	magicCapacity: 3,
	appliesTo: ["armor", "other"],
	effects: [{type: "perceptionPenaltyToNotice", value: -2, appliesTo: ["armor", "other"]}],
};

const STEEL = {
	name: "Steel",
	source: "TGTT",
	materialCategory: "metal",
	density: 7.8,
	magicCapacity: 3,
	appliesTo: ["weapon", "armor", "shield"],
	effects: [],
};

const CATALOG = [DEEP_CRYSTAL, MIRROR_AMALGAM, NIGHTSILK, STEEL];

const DAGGER = {name: "Dagger", source: "PHB", type: "M", weapon: true, dmg1: "1d4", dmgType: "P", property: ["F", "L", "T"], range: "20/60", weight: 1, value: 200};
const RING = {name: "Ring", source: "PHB", type: "RG", weight: 0, value: 100};
const LEATHER = {name: "Leather Armor", source: "PHB", type: "LA", ac: 11, weight: 10, value: 1000};

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	state.setItemMaterialCatalog(CATALOG);
	return state;
}

/** Add an item and apply a material, WITHOUT equipping — focus paths are carry-scoped. */
function carryWithMaterial (state, item, materialName) {
	state.addItem({quantity: 1, ...item});
	const id = state.getItems().slice(-1)[0].id;
	if (materialName) state.setItemMaterial(id, CATALOG.find(m => m.name === materialName));
	state._recalculateEquipmentModifiers();
	return id;
}

function equipWithMaterial (state, item, materialName) {
	const id = carryWithMaterial(state, item, materialName);
	const raw = state._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = true;
	state._recalculateEquipmentModifiers();
	return id;
}

describe("Material spellcasting focus", () => {
	it("reports no focus for a character carrying nothing", () => {
		expect(makeState().getSpellcastingFocusStatus().ok).toBe(false);
	});

	it("makes a Deep Crystal weapon a focus", () => {
		const state = makeState();
		carryWithMaterial(state, DAGGER, "Deep Crystal");
		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.source).toBe("Deep Crystal focus");
		expect(status.itemName).toBe("Dagger");
	});

	it("honours the material's appliesTo gate — a Deep Crystal ring is not a focus", () => {
		// The brew scopes the property to a weapon's striking surface. A ring of the same
		// stuff is just a ring.
		const state = makeState();
		carryWithMaterial(state, RING, "Deep Crystal");
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});

	it("counts a CARRIED focus, not only an equipped one", () => {
		// Matches every sibling path: a component pouch in your pack is a valid focus.
		const state = makeState();
		const id = carryWithMaterial(state, DAGGER, "Deep Crystal");
		expect(state._data.inventory.find(it => it.id === id).equipped).toBeFalsy();
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("still works when the item is equipped", () => {
		const state = makeState();
		equipWithMaterial(state, DAGGER, "Deep Crystal");
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("makes Mirror Amalgam a general focus, not one limited to two schools", () => {
		// `schools: ["D","I"]` with `noteMode: "qualifier"` scopes the BONUS, not focus
		// eligibility. Reading it as a limit would make the material worse than authored.
		const state = makeState();
		carryWithMaterial(state, DAGGER, "Mirror Amalgam");
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("does not make an ordinary material a focus", () => {
		const state = makeState();
		carryWithMaterial(state, DAGGER, "Steel");
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});

	it("returns null from the helper when nothing qualifies", () => {
		expect(makeState().getMaterialSpellcastingFocus()).toBeNull();
	});

	it("respects the materials setting being off", () => {
		const state = makeState();
		carryWithMaterial(state, DAGGER, "Deep Crystal");
		state._data.settings.enableMaterials = false;
		expect(state.getMaterialSpellcastingFocus()).toBeNull();
	});
});

describe("Nightsilk — an observer's penalty becomes the wearer's bonus", () => {
	const stealthMods = state => (state._data.namedModifiers || [])
		.filter(m => m.sourceType === "itemMaterial" && m.type === "skill:stealth");

	it("registers nothing without the material", () => {
		const state = makeState();
		equipWithMaterial(state, LEATHER, "Steel");
		expect(stealthMods(state)).toHaveLength(0);
	});

	it("turns the −2 observer penalty into a +2 on the wearer's roll", () => {
		const state = makeState();
		equipWithMaterial(state, LEATHER, "Nightsilk");
		const mods = stealthMods(state);
		expect(mods).toHaveLength(1);
		expect(mods[0].value).toBe(2);
	});

	it("marks it conditional, so it is offered per roll rather than always applied", () => {
		// It applies to being noticed, not to every use of Stealth. Only the player knows
		// which roll is which, so the conditional system must gate it.
		const state = makeState();
		equipWithMaterial(state, LEATHER, "Nightsilk");
		expect(stealthMods(state)[0].conditional).toBeTruthy();
	});

	it("names the material and the item it came from", () => {
		const state = makeState();
		equipWithMaterial(state, LEATHER, "Nightsilk");
		const mod = stealthMods(state)[0];
		expect(mod.name).toContain("Nightsilk");
		expect(mod.sourceLabel).toBe("Leather Armor");
	});

	it("does not double up when equipment is recalculated repeatedly", () => {
		const state = makeState();
		equipWithMaterial(state, LEATHER, "Nightsilk");
		state._recalculateEquipmentModifiers();
		state._recalculateEquipmentModifiers();
		expect(stealthMods(state)).toHaveLength(1);
	});

	it("withdraws the modifier when the armour is removed", () => {
		const state = makeState();
		const id = equipWithMaterial(state, LEATHER, "Nightsilk");
		state.removeItem(id);
		state._recalculateEquipmentModifiers();
		expect(stealthMods(state)).toHaveLength(0);
	});
});
