/**
 * Character Sheet — Unified custom-item create / base-clone / modify flow (Bug #2)
 *
 * Verifies the single-source custom-item pipeline:
 *   - _buildCustomItem produces structured effect fields that flow through aggregation (#1)
 *   - _seedOptionsFromItem round-trips a base item (structured + prose) back into options
 *   - state.replaceItem edits an item IN PLACE preserving id / quantity / equipped / starred / note
 *   - the inventory "modify" path (_saveCustomItem with editItemId) preserves metadata + applies
 *     the new effect and drops the old one
 *   - a custom/edited item survives a save → load round-trip
 */

import "./setup.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function makeInventory (state, catalog = []) {
	const inv = new CharacterSheetInventory({getState: () => state});
	// Model the real controller: a full render refreshes item-derived state.
	const page = {
		getState: () => state,
		renderCharacter: () => inv.syncItemDerivedState(),
		saveCharacter: () => {},
	};
	inv._page = page;
	inv.setItems(catalog);
	return inv;
}

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 8);
	return state;
}

function lastItemId (state) {
	const items = state.getItems();
	return items[items.length - 1].id;
}

describe("Custom-item builder + aggregation (Bug #2 ↔ #1)", () => {
	test("_buildCustomItem marks custom + carries structured senses that aggregate", () => {
		const state = newState();
		const inv = makeInventory(state);
		const built = inv._buildCustomItem("Custom Goggles", 1, 0, {type: "wondrous", senses: {darkvision: 60}});

		expect(built._isCustom).toBe(true);
		expect(built.source).toBe("Custom");

		state.addItem(built);
		state.setItemEquipped(lastItemId(state), true);
		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(60);
	});

	test("_buildCustomItem normalizes a free-text description into entries", () => {
		const state = newState();
		const inv = makeInventory(state);
		const built = inv._buildCustomItem("Note Item", 1, 0, {type: "gear", entries: "Some lore text."});
		expect(built.entries).toEqual(["Some lore text."]);

		const built2 = inv._buildCustomItem("Arr Item", 1, 0, {type: "gear", entries: ["a", "b"]});
		expect(built2.entries).toEqual(["a", "b"]);

		const built3 = inv._buildCustomItem("Empty", 1, 0, {type: "gear"});
		expect(built3.entries).toBeUndefined();
	});
});

describe("_seedOptionsFromItem round-trip", () => {
	test("structured base item seeds options that rebuild the same effect", () => {
		const state = newState();
		const inv = makeInventory(state);
		const base = {
			name: "Boots of the Winterlands",
			source: "DMG",
			type: "wondrous",
			requiresAttunement: true,
			resist: ["cold"],
			modifySpeed: {bonus: {walk: 10}},
		};

		const seed = inv._seedOptionsFromItem(base);
		expect(seed.type).toBe("wondrous");
		expect(seed.options.requiresAttunement).toBe(true);
		expect(seed.options.resist).toEqual(["cold"]);

		const built = inv._buildCustomItem(seed.name, seed.quantity, seed.weight, seed.options);
		state.addItem(built);
		const id = lastItemId(state);
		state.setItemEquipped(id, true);
		state.setItemAttuned(id, true);
		inv._updateItemBonuses(state.getItems());

		expect(state.getResistances()).toContain("cold");
		expect(state.getSpeed("walk")).toBe(40); // base 30 + 10
	});

	test("prose-only base item seeds entries so prose effects still apply after rebuild", () => {
		const state = newState();
		const inv = makeInventory(state);
		const base = {
			name: "Goggles of Night",
			source: "DMG",
			type: "wondrous",
			entries: ["you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet."],
		};

		const seed = inv._seedOptionsFromItem(base);
		expect(seed.options.entries).toMatch(/darkvision/i);

		const built = inv._buildCustomItem(seed.name, seed.quantity, seed.weight, seed.options);
		state.addItem(built);
		state.setItemEquipped(lastItemId(state), true);
		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(60);
	});

	test("_getCustomTypeForItem maps type codes + flags", () => {
		const inv = makeInventory(newState());
		expect(inv._getCustomTypeForItem({type: "LA"})).toBe("armor");
		expect(inv._getCustomTypeForItem({shield: true})).toBe("shield");
		expect(inv._getCustomTypeForItem({type: "M"})).toBe("weapon");
		expect(inv._getCustomTypeForItem({type: "RG"})).toBe("ring");
		expect(inv._getCustomTypeForItem({type: "wondrous"})).toBe("wondrous");
		expect(inv._getCustomTypeForItem({type: "G"})).toBe("gear");
		// Raw catalog shape: wondrous flag (no `type`) + weapon type codes.
		expect(inv._getCustomTypeForItem({wondrous: true})).toBe("wondrous");
		expect(inv._getCustomTypeForItem({type: "R", weaponCategory: "martial"})).toBe("weapon");
	});

	test("raw catalog Cloak of Protection clones with attunement + numeric save bonus", () => {
		const state = newState();
		const inv = makeInventory(state);
		// RAW catalog shape: `reqAttune` (not requiresAttunement), `wondrous` flag, string bonuses.
		const raw = {
			name: "Cloak of Protection",
			source: "DMG",
			wondrous: true,
			reqAttune: true,
			bonusAc: "+1",
			bonusSavingThrow: "+1",
			entries: ["You gain a +1 bonus to AC and saving throws while wearing this cloak."],
		};

		const seed = inv._seedOptionsFromItem(raw);
		expect(seed.type).toBe("wondrous");
		expect(seed.options.requiresAttunement).toBe(true);
		// Bonuses normalized from "+1" strings to numbers.
		expect(seed.options.bonusSavingThrow).toBe(1);
		expect(seed.options.bonusAc).toBe(1);

		const built = inv._buildCustomItem(seed.name, seed.quantity, seed.weight, seed.options);
		state.addItem(built);
		const id = lastItemId(state);
		state.setItemEquipped(id, true);

		// Equipped but NOT attuned → no save bonus yet (attunement gating).
		inv._updateItemBonuses(state.getItems());
		expect(state.getItemBonuses().savingThrow || 0).toBe(0);

		// Attune → numeric +1 save bonus applies (not "+1"/"0+1").
		state.setItemAttuned(id, true);
		inv._updateItemBonuses(state.getItems());
		expect(state.getItemBonuses().savingThrow).toBe(1);
	});
});

describe("state.replaceItem preserves wrapper metadata", () => {
	test("preserves id / quantity / equipped / starred / note; drops attunement when not required", () => {
		const state = newState();
		state.addItem({name: "Old Cloak", source: "DMG", type: "wondrous", requiresAttunement: true});
		const id = lastItemId(state);
		state.setItemEquipped(id, true);
		state.setItemAttuned(id, true);
		state.setItemQuantity(id, 3);
		state.setItemStarred(id, true);
		state.updateItemNote(id, "my favourite cloak");

		const ok = state.replaceItem(id, {name: "New Cloak", source: "Custom", type: "wondrous", requiresAttunement: false, senses: {darkvision: 30}});
		expect(ok).toBe(true);

		const wrapper = state.getInventory().find(w => w.id === id);
		expect(wrapper).toBeTruthy();
		expect(wrapper.item.name).toBe("New Cloak");
		expect(wrapper.item._isCustom).toBe(true);
		expect(wrapper.quantity).toBe(3);
		expect(wrapper.equipped).toBe(true);
		expect(wrapper.starred).toBe(true);
		expect(wrapper.attuned).toBe(false); // dropped — new item doesn't require attunement
		expect(state.getItemNote(id)).toBe("my favourite cloak");
	});

	test("returns false for an unknown id", () => {
		const state = newState();
		expect(state.replaceItem("does-not-exist", {name: "X"})).toBe(false);
	});
});

describe("Inventory modify flow (_saveCustomItem editItemId)", () => {
	test("editing replaces in place, preserves note/star/quantity, swaps the effect", () => {
		const state = newState();
		const inv = makeInventory(state);

		// Start with a prose darkvision item, equipped + starred + noted
		state.addItem(inv._buildCustomItem("Seeing Goggles", 1, 0, {type: "wondrous", senses: {darkvision: 60}}));
		const id = lastItemId(state);
		state.setItemEquipped(id, true);
		state.setItemStarred(id, true);
		state.updateItemNote(id, "keep me");
		inv._updateItemBonuses(state.getItems());
		expect(state.getSenses().darkvision).toBe(60);

		// Modify: swap to a fire-resistance cloak (no darkvision)
		inv._saveCustomItem("Resist Cloak", 2, 1, {type: "wondrous", resist: ["fire"]}, id);

		const wrapper = state.getInventory().find(w => w.id === id);
		expect(wrapper.item.name).toBe("Resist Cloak");
		expect(wrapper.starred).toBe(true);
		expect(wrapper.quantity).toBe(2);
		expect(state.getItemNote(id)).toBe("keep me");

		// _saveCustomItem (edit path) itself resyncs derived state — assert WITHOUT re-aggregating.
		expect(state.getResistances()).toContain("fire");
		expect(state.getSenses().darkvision).toBe(0); // old sense gone
		// No duplicate created
		expect(state.getInventory().filter(w => w.id === id)).toHaveLength(1);
		expect(state.getItems()).toHaveLength(1);
	});
});

describe("Custom item survives save → load round-trip", () => {
	test("custom flag, entries, and effect persist across toJson/loadFromJson", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(inv._buildCustomItem("Custom Night Goggles", 1, 0, {
			type: "wondrous",
			entries: "you have darkvision out to a range of 90 feet.",
		}));
		const id = lastItemId(state);
		state.setItemEquipped(id, true);
		state.updateItemNote(id, "round-trip note");

		const json = state.toJson();

		const state2 = newState();
		state2.loadFromJson(json);
		const inv2 = makeInventory(state2);

		const wrapper = state2.getInventory().find(w => w.item.name === "Custom Night Goggles");
		expect(wrapper).toBeTruthy();
		expect(wrapper.item._isCustom).toBe(true);
		expect(wrapper.item.entries).toEqual(["you have darkvision out to a range of 90 feet."]);
		expect(state2.getItemNote(wrapper.id)).toBe("round-trip note");

		// Effect re-aggregates after load
		inv2._updateItemBonuses(state2.getItems());
		expect(state2.getSenses().darkvision).toBe(90);
	});
});
