/**
 * Custom ring equippability (Bug #3).
 *
 * The equip control is gated by `CharacterSheetInventory.canEquipItem(item)`. Previously the
 * predicate listed weapon/armor/shield/gear/wondrous/attunement/flat-bonus but OMITTED
 * `type === "ring"` (and `wand`) and ignored the structured `effects[]` array — so a custom ring
 * whose only payload was an effect (e.g. "advantage on initiative") had NO equip control, and an
 * item you can't equip can never activate its effects.
 *
 * These tests pin (a) the pure predicate now treats rings/wands and effect-bearing items as
 * equippable, and (b) once equipped, a custom ring's effects actually register through the state
 * pipeline (and clear on unequip).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-customabilities.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function mkState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("dex", 14);
	return state;
}

function customItem (name, type, effects, extra = {}) {
	return {
		name,
		source: "Custom",
		_isCustom: true,
		type,
		weight: 0,
		equipped: false,
		attuned: false,
		quantity: 1,
		effects,
		...extra,
	};
}

describe("Bug #3 — canEquipItem predicate", () => {
	it("a custom ring is equippable purely by type (even with no effects)", () => {
		expect(CharacterSheetInventory.canEquipItem(customItem("Plain Band", "ring", []))).toBe(true);
	});

	it("a wand/rod/staff is equippable by type", () => {
		expect(CharacterSheetInventory.canEquipItem(customItem("Oak Wand", "wand", []))).toBe(true);
	});

	it("a ring whose only payload is a behavioural effect is equippable", () => {
		const ring = customItem("Ring of Initiative", "ring", [{type: "initiative", value: 0, advantage: true}]);
		expect(CharacterSheetInventory.canEquipItem(ring)).toBe(true);
	});

	it("an effect-bearing item of an otherwise-unlisted type is still equippable", () => {
		// "trinket" is not in the explicit equippable type list, but it carries a real effect.
		const amulet = customItem("Odd Trinket", "trinket", [{type: "ac", value: 1}]);
		expect(CharacterSheetInventory.canEquipItem(amulet)).toBe(true);
	});

	it("a plain consumable with no bonus, effect, or attunement is NOT equippable", () => {
		expect(CharacterSheetInventory.canEquipItem(customItem("Torch", "gear", []))).toBe(true); // gear IS equippable
		expect(CharacterSheetInventory.canEquipItem(customItem("Healing Potion", "potion", []))).toBe(false);
		expect(CharacterSheetInventory.canEquipItem(customItem("Spell Scroll", "scroll", []))).toBe(false);
	});

	it("a no-op +0 effect does NOT by itself make an inert item equippable", () => {
		const potion = customItem("Fizzy Drink", "potion", [{type: "ac", value: 0}]);
		expect(CharacterSheetInventory.canEquipItem(potion)).toBe(false);
	});

	it("guards against a null item", () => {
		expect(CharacterSheetInventory.canEquipItem(null)).toBe(false);
	});
});

describe("Bug #3 — equipping a custom ring activates its effects", () => {
	it("setItemEquipped(true) registers the ring's effects; false clears them", () => {
		const state = mkState();
		state.addItem(customItem("Ring of Protection", "ring", [{type: "ac", value: 1}]));
		const id = state.getItems()[0].id;

		// Unequipped → inert.
		expect(state.getCustomModifier("ac")).toBe(0);

		state.setItemEquipped(id, true);
		expect(state.getCustomModifier("ac")).toBe(1);

		state.setItemEquipped(id, false);
		expect(state.getCustomModifier("ac")).toBe(0);
	});
});
