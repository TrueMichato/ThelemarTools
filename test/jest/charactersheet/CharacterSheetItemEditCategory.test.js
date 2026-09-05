/**
 * Character Sheet — Item EDIT must preserve category / attack / round-trip fields (Bug #2, +#8)
 *
 * Editing an item runs it back through the custom-item form pipeline
 * (_seedOptionsFromItem -> form -> _buildCustomItem -> _saveCustomItem -> replaceItem).
 * That form is NOT a complete representation of an item, so a from-scratch rebuild used to drop
 * or clear fields the form doesn't model or hides for the item's type:
 *   - the boolean `weapon` flag (both the inventory categorizer and Combat attack-detection key
 *     off it) -> edited weapon became "Other" and lost its attack;
 *   - weapon `properties` / `mastery` / `damage`;
 *   - `curse` / `charges` on weapon/armor (the "magic" form section is hidden for those types);
 *   - `attachedSpells`, and `addItem`-derived catalog fields (grantsProficiency, …);
 *   - structured `effects[]` (#8 continuation).
 *
 * These tests pin the fix: _buildCustomItem now sets `weapon`/`damage`, and _saveCustomItem's edit
 * branch MERGES the rebuilt payload onto the original item (skip-undefined), so anything the form
 * omits survives.
 */

import "./setup.js";
import {jest} from "@jest/globals";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

// _buildCustomItem derives a friendly `damage` string via Parser.dmgTypeToFull (the same call
// _addItem already makes); the shared test mock doesn't define it, so stub a minimal mapping.
if (typeof globalThis.Parser?.dmgTypeToFull !== "function") {
	globalThis.Parser = globalThis.Parser || {};
	globalThis.Parser.dmgTypeToFull = (c) => ({S: "slashing", P: "piercing", B: "bludgeoning"}[c] || c);
}

if (typeof globalThis.CharacterSheetUpgrades === "undefined") {
	globalThis.CharacterSheetUpgrades = {
		isWeapon: () => false,
		isArmor: () => false,
		isShield: () => false,
		getUpgradeEffects: () => ({tags: [], notes: []}),
		getGemstoneSummary: () => "",
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	return state;
}

function makeInventory (state, pageOverrides = {}) {
	const inv = new CharacterSheetInventory({getState: () => state});
	const page = {
		getState: () => state,
		renderCharacter: () => inv.syncItemDerivedState?.(),
		saveCharacter: () => {},
		...pageOverrides,
	};
	inv._page = page;
	inv.setItems([]);
	return inv;
}

function lastId (state) {
	const items = state.getItems();
	return items[items.length - 1].id;
}

/** The flat inventory shape an enriched catalog weapon has once added (mirrors _addItem output). */
function makeInventoryWeapon (over = {}) {
	return {
		name: "Catalog Blade",
		source: "XPHB",
		type: "weapon",
		weapon: true,
		weaponCategory: "martial",
		dmg1: "1d8",
		dmgType: "S",
		damage: "1d8 slashing",
		properties: ["V"],
		mastery: ["Sap"],
		grantsProficiency: true,
		...over,
	};
}

describe("_buildCustomItem sets categorization fields", () => {
	test("weapon flag + damage string are derived", () => {
		const inv = makeInventory(newState());
		const w = inv._buildCustomItem("Sword", 1, 3, {type: "weapon", weaponCategory: "martial", dmg1: "1d8", dmgType: "S"});
		expect(w.weapon).toBe(true);
		expect(w.damage).toBe("1d8 slashing");
	});

	test("weapon flag is set from weaponCategory/dmg1 even without an explicit weapon type", () => {
		const inv = makeInventory(newState());
		expect(inv._buildCustomItem("A", 1, 0, {type: "gear", weaponCategory: "simple"}).weapon).toBe(true);
		expect(inv._buildCustomItem("B", 1, 0, {type: "gear", dmg1: "1d4"}).weapon).toBe(true);
	});

	test("non-weapon item does not get the weapon flag", () => {
		const inv = makeInventory(newState());
		expect(inv._buildCustomItem("Cloak", 1, 0, {type: "wondrous"}).weapon).toBe(false);
	});

	test("hidden-section fields are bare (undefined) when absent so the edit merge can preserve them", () => {
		const inv = makeInventory(newState());
		const g = inv._buildCustomItem("Plain", 1, 0, {type: "gear"});
		expect(g.curse).toBeUndefined();
		expect(g.focus).toBeUndefined();
		expect(g.sentient).toBeUndefined();
		expect(g.charges).toBeUndefined();
		expect(g.attachedSpells).toBeUndefined();
	});
});

describe("_mergeEditedItem (skip-undefined overlay)", () => {
	test("keeps original value when the new value is undefined", () => {
		const inv = makeInventory(newState());
		const merged = inv._mergeEditedItem({a: 1, b: "keep"}, {a: 2, b: undefined});
		expect(merged.a).toBe(2);
		expect(merged.b).toBe("keep");
	});

	describe("Campaign custom-item policy", () => {
		test("blocks a new custom item before mutating local state", () => {
			const state = newState();
			const saveCharacter = jest.fn();
			const inv = makeInventory(state, {
				_hubContext: {},
				isCampaignContentEntityAllowed: () => false,
				saveCharacter,
			});

			expect(inv._saveCustomItem("Unsupported custom item", 1, 1, {type: "gear"})).toBeUndefined();
			expect(state.getItems()).toEqual([]);
			expect(saveCharacter).not.toHaveBeenCalled();
		});

		test("blocks a new custom item while campaign context is being revalidated", () => {
			const state = newState();
			const saveCharacter = jest.fn();
			const inv = makeInventory(state, {
				_hubContext: null,
				_isHubContextRevalidationRequired: true,
				saveCharacter,
			});

			expect(inv._saveCustomItem("Stale-policy item", 1, 1, {type: "gear"})).toBeUndefined();
			expect(state.getItems()).toEqual([]);
			expect(saveCharacter).not.toHaveBeenCalled();
		});

		test("preserves source identity when editing catalog and grandfathered items", () => {
			const state = newState();
			const saveCharacter = jest.fn();
			const inv = makeInventory(state, {
				_hubContext: {},
				isCampaignContentEntityAllowed: item => item.source === "PHB",
				saveCharacter,
			});
			state.addItem(makeInventoryWeapon({source: "PHB"}));
			const catalogId = lastId(state);
			expect(inv._saveCustomItem("Renamed Blade", 1, 5, {type: "weapon", dmg1: "1d8", dmgType: "S"}, catalogId)).toBe(catalogId);
			expect(state.getItems().find(item => item.id === catalogId).source).toBe("PHB");

			state.addItem(makeInventoryWeapon({name: "Legacy Blade", source: "XPHB"}));
			const legacyId = lastId(state);
			expect(inv._saveCustomItem("Legacy Blade", 1, 5, {type: "weapon", dmg1: "1d8", dmgType: "S"}, legacyId)).toBe(legacyId);
			expect(state.getItems().find(item => item.id === legacyId).source).toBe("XPHB");
			expect(saveCharacter).toHaveBeenCalledTimes(2);
		});

		test("blocks a renamed off-policy item before mutating its grandfathered identity", () => {
			const state = newState();
			const saveCharacter = jest.fn();
			const inv = makeInventory(state, {
				_hubContext: {},
				isCampaignContentEntityAllowed: () => false,
				saveCharacter,
			});
			state.addItem(makeInventoryWeapon({name: "Legacy Blade", source: "XPHB"}));
			const legacyId = lastId(state);
			const before = structuredClone(state.getItems().find(item => item.id === legacyId));

			expect(inv._saveCustomItem("Renamed Legacy Blade", 1, 5, {type: "weapon", dmg1: "1d8", dmgType: "S"}, legacyId)).toBeUndefined();
			expect(state.getItems().find(item => item.id === legacyId)).toEqual(before);
			expect(saveCharacter).not.toHaveBeenCalled();
		});
	});

	test("applies explicit clears (null / false / 0 / [])", () => {
		const inv = makeInventory(newState());
		const merged = inv._mergeEditedItem(
			{n: 5, f: true, s: "x", arr: [1, 2]},
			{n: 0, f: false, s: null, arr: []},
		);
		expect(merged.n).toBe(0);
		expect(merged.f).toBe(false);
		expect(merged.s).toBeNull();
		expect(merged.arr).toEqual([]);
	});
});

describe("Editing a weapon keeps it a weapon with its attack (Bug #2)", () => {
	test("weapon flag, category, attack-detection + weapon stats survive a name/weight edit", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(makeInventoryWeapon());
		const id = lastId(state);
		state.setItemEquipped(id, true);

		const before = state.getItems().find(i => i.id === id);
		expect(before.weapon).toBe(true);
		expect(inv._getItemCategory(before)).toBe("Weapons");

		// Simulate the weapon edit form: weapon-section fields only (no magic section), name changed.
		inv._saveCustomItem("Renamed Blade", 1, 5, {
			type: "weapon",
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			mastery: ["Sap"],
			property: ["V"],
		}, id);

		const after = state.getItems().find(i => i.id === id);
		expect(after.name).toBe("Renamed Blade");
		expect(after.weapon).toBe(true);
		expect(inv._getItemCategory(after)).toBe("Weapons");
		expect(inv._isWeapon(after)).toBe(true);
		// Combat attack-detection surrogate: weapons are the inventory items with a truthy `weapon`.
		expect(state.getItems().filter(i => i.weapon).map(i => i.id)).toContain(id);
		// Weapon stats preserved.
		expect(after.weaponCategory).toBe("martial");
		expect(after.mastery).toEqual(["Sap"]);
		expect(after.property).toEqual(["V"]);
		expect(after.damage).toBe("1d8 slashing");
		// addItem-derived catalog field the form never models survives the round-trip.
		expect(after.grantsProficiency).toBe(true);
		// No duplicate row.
		expect(state.getItems().filter(i => i.id === id)).toHaveLength(1);
	});

	test("recategorizing a weapon to gear clears the weapon flag", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(makeInventoryWeapon());
		const id = lastId(state);

		inv._saveCustomItem("Just A Stick", 1, 1, {type: "gear"}, id);

		const after = state.getItems().find(i => i.id === id);
		expect(after.weapon).toBe(false);
		expect(inv._getItemCategory(after)).not.toBe("Weapons");
	});
});

describe("Hidden-section fields survive editing a weapon (Bug #6 / #7)", () => {
	test("curse + charges on a weapon are NOT wiped when the magic section is absent from the edit", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(makeInventoryWeapon({curse: true, charges: 3, chargesCurrent: 1}));
		const id = lastId(state);
		state.setItemEquipped(id, true);

		// Weapon edit form output: no charges/curse fields (that section is hidden for weapons).
		inv._saveCustomItem("Cursed Blade", 1, 5, {
			type: "weapon", weaponCategory: "martial", dmg1: "1d8", dmgType: "S",
		}, id);

		const after = state.getItems().find(i => i.id === id);
		expect(after.curse).toBe(true);
		expect(after.charges).toBe(3);
		// Remaining (depleted) charges are also preserved by the edit path.
		expect(after.chargesCurrent).toBe(1);
	});

	test("attached spells on a weapon survive the edit", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(makeInventoryWeapon({attachedSpells: {will: ["fire bolt|XPHB"]}}));
		const id = lastId(state);

		inv._saveCustomItem("Spell Blade", 1, 5, {
			type: "weapon", weaponCategory: "martial", dmg1: "1d8", dmgType: "S",
		}, id);

		const after = state.getItems().find(i => i.id === id);
		expect(after.attachedSpells).toEqual({will: ["fire bolt|XPHB"]});
	});
});

describe("Structured effects + attunement survive editing (Bug #8 continuation)", () => {
	test("effects[] and equipped/attuned state are preserved through an edit", () => {
		const state = newState();
		const inv = makeInventory(state);
		// An equippable wondrous item with a +1 AC effect, requiring (and granted) attunement.
		state.addItem({
			name: "Cloak of Warding",
			source: "Custom",
			_isCustom: true,
			type: "wondrous",
			requiresAttunement: true,
			effects: [{type: "ac", value: 1}],
		});
		const id = lastId(state);
		state.setItemEquipped(id, true);
		state.setItemAttuned(id, true);

		// Seed the editor from the live item, then "save" with only the name changed.
		const seed = inv._seedOptionsFromItem(state.getItems().find(i => i.id === id));
		inv._saveCustomItem("Cloak of Greater Warding", 1, 0, seed.options, id);

		const after = state.getItems().find(i => i.id === id);
		expect(after.name).toBe("Cloak of Greater Warding");
		// Structured effects[] are not dropped by the rebuild.
		expect(Array.isArray(after.effects)).toBe(true);
		expect(after.effects).toEqual([{type: "ac", value: 1}]);
		// Equipped + attuned state survive the edit (replaceItem preserves them).
		expect(after.attuned).toBe(true);
		expect(after.equipped).toBe(true);
		// Attunement requirement is retained so the effect keeps gating correctly.
		expect(after.requiresAttunement).toBe(true);
	});
});

describe("_seedOptionsFromItem + _prefillCustomItemForm round-trip weapon mastery/properties", () => {
	test("seed reads `properties` (plural) inventory shape into singular `property`", () => {
		const inv = makeInventory(newState());
		const seed = inv._seedOptionsFromItem(makeInventoryWeapon({property: undefined, properties: ["F", "L"]}));
		expect(seed.options.property).toEqual(["F", "L"]);
		expect(seed.options.mastery).toEqual(["Sap"]);
	});

	test("prefill ticks the mastery + property checkboxes the item carries", () => {
		const inv = makeInventory(newState());
		const checks = {
			".weapon-mastery-check": [{value: "Sap", checked: false}, {value: "Vex", checked: false}],
			".weapon-prop-check": [{value: "V", checked: false}, {value: "F", checked: false}],
		};
		const form = {
			querySelector: () => ({value: "", checked: false}),
			querySelectorAll: (sel) => checks[sel] || [],
		};
		inv._prefillCustomItemForm(form, {name: "Blade", type: "weapon", options: {mastery: ["Sap"], property: ["V"]}});

		expect(checks[".weapon-mastery-check"].find(c => c.value === "Sap").checked).toBe(true);
		expect(checks[".weapon-mastery-check"].find(c => c.value === "Vex").checked).toBe(false);
		expect(checks[".weapon-prop-check"].find(c => c.value === "V").checked).toBe(true);
		expect(checks[".weapon-prop-check"].find(c => c.value === "F").checked).toBe(false);
	});
});
