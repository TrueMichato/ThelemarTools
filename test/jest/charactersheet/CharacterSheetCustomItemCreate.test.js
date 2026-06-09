/**
 * Character Sheet — Custom-item CREATE/edit correctness (latent pre-existing bugs)
 *
 * Three confirmed bugs in the plain "Create Custom Item" flow:
 *   A. Value was stored as raw gp but `_formatValue` treats item value as COPPER → 15gp showed as 1s5c.
 *      Fix: collector stores gp*100 (copper); prefill divides copper/100 back to gp for the field.
 *   B. A custom shield was flagged `armor:true` (never `shield`) → detected as BODY ARMOR, wrong AC.
 *      Fix: shield carries an explicit `shield` flag; `_buildCustomItem` emits both flags explicitly.
 *   C. Custom armor never read the armor-type select (always light, no DEX cap) and stored `bonusAc`
 *      as a "+N" STRING → `baseAC + "+1"` = "10+1". Fix: armorType/dexterityMax persisted; the whole
 *      numeric bonus family is normalized to numbers (catalog-parity), crit-damage dice preserved.
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
	const page = {
		getState: () => state,
		renderCharacter: () => inv.syncItemDerivedState(),
		saveCharacter: () => {},
	};
	inv._page = page;
	inv.setItems(catalog);
	return inv;
}

function newState (dex = 14) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", dex);
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

/**
 * Minimal stand-in for the modal's <form>. Stores field values keyed by selector so
 * `_prefillCustomItemForm` can write into it and the test can read them back.
 */
function makeFakeForm () {
	const fields = {};
	return {
		_fields: fields,
		querySelector (sel) {
			if (!(sel in fields)) fields[sel] = {value: "", checked: false};
			return fields[sel];
		},
		querySelectorAll () { return []; },
		val (sel) { return fields[sel]?.value; },
	};
}

describe("Bug A — custom item value is stored in copper and round-trips as gp", () => {
	test("a copper-stored value displays as gp via _formatValue", () => {
		const state = newState();
		const inv = makeInventory(state);
		// Collector stores gp*100; 15 gp → 1500 copper.
		const built = inv._buildCustomItem("Fancy Trinket", 1, 0, {type: "gear", value: 1500});
		expect(built.value).toBe(1500);
		expect(inv._formatValue(built.value)).toBe("15 gp");
	});

	test("prefill converts stored copper back to gp for the form field, inverse of the collector", () => {
		const state = newState();
		const inv = makeInventory(state);
		const item = inv._buildCustomItem("Fancy Trinket", 1, 0, {type: "gear", value: 1500});
		const seed = inv._seedOptionsFromItem(item);
		expect(seed.options.value).toBe(1500);

		const form = makeFakeForm();
		inv._prefillCustomItemForm(form, seed);
		// Field shows gp.
		expect(form.val("#custom-item-value")).toBe("15");
		// Collector's exact arithmetic recovers the original copper value (inverse round-trip).
		const recovered = Math.round((parseFloat(form.val("#custom-item-value")) || 0) * 100);
		expect(recovered).toBe(1500);
	});

	test("fractional gp survives the round-trip without being truncated to zero", () => {
		const state = newState();
		const inv = makeInventory(state);
		// 50 copper = 0.5 gp.
		const item = inv._buildCustomItem("Cheap Bauble", 1, 0, {type: "gear", value: 50});
		const seed = inv._seedOptionsFromItem(item);
		const form = makeFakeForm();
		inv._prefillCustomItemForm(form, seed);
		expect(form.val("#custom-item-value")).toBe("0.5");
		const recovered = Math.round((parseFloat(form.val("#custom-item-value")) || 0) * 100);
		expect(recovered).toBe(50);
	});
});

describe("Bug B — a custom shield is detected as a shield, not body armor", () => {
	test("_buildCustomItem flags a shield explicitly and not as armor", () => {
		const state = newState();
		const inv = makeInventory(state);
		const built = inv._buildCustomItem("Bulwark", 1, 6, {type: "shield", shield: true, ac: 2, bonusAc: 1});
		expect(built.shield).toBe(true);
		expect(built.armor).toBe(false);
		expect(built.bonusAc).toBe(1);
	});

	test("an equipped custom shield fills the shield slot (not the armor slot) and adds AC", () => {
		const state = newState(); // DEX 14 (+2), unarmored AC = 12
		const inv = makeInventory(state);
		const baseAc = state.getAc();
		expect(baseAc).toBe(12);

		state.addItem(inv._buildCustomItem("Bulwark", 1, 6, {type: "shield", shield: true, ac: 2, bonusAc: 1}));
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();

		expect(state._data.ac.armor).toBeFalsy(); // NOT mistaken for body armor
		expect(state._data.ac.shield).toBeTruthy();
		// Unarmored 12 + shield base 2 + magic 1 = 15.
		expect(state.getAc()).toBe(15);
	});

	test("cloning a catalog shield seeds the shield flag, not armor", () => {
		const state = newState();
		const inv = makeInventory(state);
		const rawShield = {name: "Shield, +1", source: "DMG", type: "S|DMG", ac: 2, bonusAc: "+1"};
		const seed = inv._seedOptionsFromItem(rawShield);
		expect(seed.type).toBe("shield");
		expect(seed.options.shield).toBe(true);
		expect(seed.options.armor).toBeUndefined();
		expect(seed.options.bonusAc).toBe(1);
	});
});

describe("Bug C — custom armor classification + numeric AC bonus", () => {
	test("armor AC is a NUMBER (no '10+1' string concat) even from a legacy '+N' string bonus", () => {
		const state = newState();
		const inv = makeInventory(state);
		// Simulate the OLD collector that fed a string; _buildCustomItem must normalize it.
		const built = inv._buildCustomItem("Plate +1", 1, 65, {type: "armor", armor: true, armorType: "heavy", dexterityMax: 0, ac: 18, bonusAc: "+1"});
		expect(typeof built.bonusAc).toBe("number");
		expect(built.bonusAc).toBe(1);
		expect(built.armorType).toBe("heavy");

		state.addItem(built);
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();
		expect(state._data.ac.armor.ac).toBe(19); // 18 + 1, numeric
		expect(typeof state._data.ac.armor.ac).toBe("number");
	});

	test("armorType drives the DEX cap: light full, medium capped, heavy none", () => {
		const mk = (armorType, ac, dexterityMax) => {
			const state = newState(18); // DEX 18 → +4
			const inv = makeInventory(state);
			state.addItem(inv._buildCustomItem("Test Armor", 1, 0, {type: "armor", armor: true, armorType, dexterityMax, ac}));
			state.setItemEquipped(lastItemId(state), true);
			inv._syncArmorState();
			return state.getAc();
		};
		// Light AC 12 + full DEX(4) = 16.
		expect(mk("light", 12, null)).toBe(16);
		// Medium AC 14 + min(2, 4) = 16.
		expect(mk("medium", 14, 2)).toBe(16);
		// Heavy AC 18 + no DEX = 18.
		expect(mk("heavy", 18, 0)).toBe(18);
	});

	test("cloning catalog armor derives armorType + dexterityMax from the type code", () => {
		const state = newState();
		const inv = makeInventory(state);
		const rawMedium = {name: "Half Plate", source: "PHB", type: "MA|PHB", ac: 15, dexterityMax: 2};
		const seedM = inv._seedOptionsFromItem(rawMedium);
		expect(seedM.type).toBe("armor");
		expect(seedM.options.armorType).toBe("medium");
		expect(seedM.options.dexterityMax).toBe(2);

		const rawHeavy = {name: "Plate", source: "PHB", type: "HA|PHB", ac: 18};
		const seedH = inv._seedOptionsFromItem(rawHeavy);
		expect(seedH.options.armorType).toBe("heavy");
	});

	test("prefill populates the armor-type select from a cloned/edited armor", () => {
		const state = newState();
		const inv = makeInventory(state);
		const item = inv._buildCustomItem("Custom Mail", 1, 0, {type: "armor", armor: true, armorType: "medium", dexterityMax: 2, ac: 14, bonusAc: 1});
		const seed = inv._seedOptionsFromItem(item);
		const form = makeFakeForm();
		inv._prefillCustomItemForm(form, seed);
		expect(form.val("#custom-item-armor-type")).toBe("medium");
		expect(form.val("#custom-item-armor-bonus")).toBe("1");
	});
});

describe("Bug C (cont.) — numeric bonus family normalization", () => {
	test("the whole +N bonus family is stored as numbers, negatives preserved", () => {
		const state = newState();
		const inv = makeInventory(state);
		const built = inv._buildCustomItem("Cursed Blade", 1, 3, {
			type: "weapon",
			bonusWeaponAttack: -1,
			bonusSavingThrow: "+2",
			bonusSpellSaveDc: "+1",
			bonusAbilityCheck: -1,
		});
		expect(built.bonusWeaponAttack).toBe(-1);
		expect(built.bonusSavingThrow).toBe(2);
		expect(built.bonusSpellSaveDc).toBe(1);
		expect(built.bonusAbilityCheck).toBe(-1);
	});

	test("a numeric save bonus aggregates without string concat", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(inv._buildCustomItem("Ring of +1 Saves", 1, 0, {type: "ring", bonusSavingThrow: "+1"}));
		state.setItemEquipped(lastItemId(state), true);
		inv._updateItemBonuses(state.getItems());
		expect(state.getItemBonuses().savingThrow).toBe(1);
	});

	test("bonusWeaponCritDamage dice string is preserved, not parsed to a number", () => {
		const state = newState();
		const inv = makeInventory(state);
		const built = inv._buildCustomItem("Brutal Axe", 1, 4, {type: "weapon", dmg1: "1d12", bonusWeaponCritDamage: "1d6"});
		expect(built.bonusWeaponCritDamage).toBe("1d6");
	});
});

describe("save/load round-trip preserves the new flags", () => {
	test("shield flag, armorType, and copper value survive serialization", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(inv._buildCustomItem("Tower", 1, 6, {type: "shield", shield: true, ac: 2, bonusAc: 1, value: 1000}));
		state.addItem(inv._buildCustomItem("War Mail", 1, 55, {type: "armor", armor: true, armorType: "heavy", dexterityMax: 0, ac: 18}));

		const json = state.toJson();
		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);
		const items = state2.getItems();
		const shield = items.find(i => i.name === "Tower");
		const armor = items.find(i => i.name === "War Mail");
		expect(shield.shield).toBe(true);
		expect(shield.armor).toBe(false);
		expect(shield.value).toBe(1000);
		expect(armor.armorType).toBe("heavy");
	});
});
