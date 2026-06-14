/**
 * Character Sheet — Custom-item modifier caps & signed UX (Round 17, Bug #1).
 *
 * The custom-item modal previously capped its legacy bonus fields at small ranges
 * (e.g. Attack/Damage -5..10, Saves -5..10, Ability bonus -10..10) and offered several
 * "+1/+2/+3" dropdowns. The user wanted larger and negative values. The underlying data
 * path (`_buildCustomItem` → `_parseBonus`) never clamped, so relaxing the HTML caps is the
 * fix; these tests pin the relaxed behaviour at the data + round-trip level:
 *   - large (+25) and negative (-3) bonuses survive build, aggregation and prefill;
 *   - the Ability Score SET-to value keeps its hard 1-30 domain guard (now enforced in
 *     `_buildCustomItem`, not just the HTML attribute);
 *   - the signed-preview decoration mirrors a field's value as "+N"/"-N".
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
import "../../../js/charactersheet/charactersheet-customabilities.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const CustomAbilities = globalThis.CharacterSheetCustomAbilities;

function makeInventory (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	const page = {
		getState: () => state,
		renderCharacter: () => inv.syncItemDerivedState(),
		saveCharacter: () => {},
	};
	inv._page = page;
	inv.setItems([]);
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

/** Minimal fake <form>; `querySelector` lazily mints `{value, checked}` field stand-ins. */
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

describe("Bug #1 — relaxed numeric caps survive build (large + negative)", () => {
	test("attack/damage bonuses accept values well beyond the old -5..10 cap", () => {
		const inv = makeInventory(newState());
		const built = inv._buildCustomItem("Colossus Blade", 1, 3, {
			type: "weapon",
			bonusWeaponAttack: 15,
			bonusWeaponDamage: -7,
		});
		expect(built.bonusWeaponAttack).toBe(15);
		expect(built.bonusWeaponDamage).toBe(-7);
	});

	test("saving-throw + ability bonuses accept large positive and negative values", () => {
		const inv = makeInventory(newState());
		const built = inv._buildCustomItem("Cursed Regalia", 1, 1, {
			type: "wondrous",
			bonusSavingThrow: 12,
			bonusSavingThrowStr: -8,
			bonusSpellSaveDc: 9,
			bonusAbilityCheck: -4,
			ability: {con: -3, str: 14},
		});
		expect(built.bonusSavingThrow).toBe(12);
		expect(built.bonusSavingThrowStr).toBe(-8);
		expect(built.bonusSpellSaveDc).toBe(9);
		expect(built.bonusAbilityCheck).toBe(-4);
		expect(built.ability.con).toBe(-3);
		expect(built.ability.str).toBe(14);
	});
});

describe("Bug #1 — relaxed bonuses aggregate onto the character", () => {
	test("a +25 AC item raises AC by 25", () => {
		const state = newState(); // unarmored AC 12 (10 + DEX 2)
		const inv = makeInventory(state);
		expect(state.getAc()).toBe(12);

		state.addItem(inv._buildCustomItem("Aegis of Absurdity", 1, 1, {type: "wondrous", bonusAc: 25, requiresAttunement: false}));
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();

		expect(state.getAc()).toBe(37); // 12 + 25
	});

	test("a -3 CON item lowers the CON score (negative bonus aggregates)", () => {
		const state = newState();
		const inv = makeInventory(state);
		expect(state.getAbilityScore("con")).toBe(14);

		state.addItem(inv._buildCustomItem("Belt of Frailty", 1, 1, {type: "wondrous", ability: {con: -3}, requiresAttunement: false}));
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();

		expect(state.getAbilityScore("con")).toBe(11); // 14 - 3
	});

	test("a global +12 saving-throw item is exposed via getItemBonus", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(inv._buildCustomItem("Cloak of the Titan", 1, 1, {type: "wondrous", bonusSavingThrow: 12, requiresAttunement: false}));
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();
		expect(state.getItemBonus("savingThrow")).toBe(12);
	});
});

describe("Bug #1 — relaxed values round-trip through edit prefill", () => {
	test("large + negative bonuses reappear verbatim in the form fields", () => {
		const inv = makeInventory(newState());
		const item = inv._buildCustomItem("Round-trip Rod", 1, 1, {
			type: "wondrous",
			bonusAc: 25,
			bonusSavingThrow: -6,
			bonusSpellAttack: 8,
			ability: {str: -3},
		});
		const seed = inv._seedOptionsFromItem(item);
		const form = makeFakeForm();
		inv._prefillCustomItemForm(form, seed);

		expect(form.val("#custom-item-bonus-save-all")).toBe("-6");
		expect(form.val("#custom-item-bonus-spell-attack")).toBe("8");
		expect(form.val("#custom-item-ability-bonus-str")).toBe("-3");
	});
});

describe("Bug #1 — Ability Score SET keeps its hard 1-30 domain guard", () => {
	test("a SET value above 30 is clamped to 30", () => {
		const inv = makeInventory(newState());
		const built = inv._buildCustomItem("Gauntlets of Hyperbole", 1, 1, {type: "wondrous", ability: {static: {str: 99}}});
		expect(built.ability.static.str).toBe(30);
	});

	test("a zero / negative SET value is dropped (never applied as a score)", () => {
		const inv = makeInventory(newState());
		const built = inv._buildCustomItem("Broken Band", 1, 1, {type: "wondrous", ability: {static: {str: 0, dex: -5}}});
		expect(built.ability.static.str).toBeUndefined();
		expect(built.ability.static.dex).toBeUndefined();
	});

	test("an in-domain SET value (e.g. 27 Belt of Giant Strength) is preserved", () => {
		const inv = makeInventory(newState());
		const built = inv._buildCustomItem("Belt of Giant Strength", 1, 1, {type: "wondrous", ability: {static: {str: 27}}});
		expect(built.ability.static.str).toBe(27);
	});

	test("a SET score above 30 still applies as exactly 30 when equipped", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.setAbilityBase("str", 10);
		state.addItem(inv._buildCustomItem("Gauntlets of Hyperbole", 1, 1, {type: "wondrous", ability: {static: {str: 99}}, requiresAttunement: false}));
		state.setItemEquipped(lastItemId(state), true);
		inv._syncArmorState();
		expect(state.getAbilityScore("str")).toBe(30);
	});
});

describe("Bug #1 — signed-bonus preview decoration", () => {
	/** Build a fake <form> exposing `.charsheet__signed-input` inputs for the decorator. */
	function makeSignedForm (initialValues) {
		const inputs = initialValues.map(v => ({
			value: String(v),
			nextElementSibling: null,
			_listeners: {},
			after (node) { this.nextElementSibling = node; },
			addEventListener (evt, cb) { this._listeners[evt] = cb; },
			fire (evt) { this._listeners[evt]?.(); },
		}));
		return {
			_inputs: inputs,
			querySelectorAll (sel) { return sel === ".charsheet__signed-input" ? inputs : []; },
		};
	}

	let savedDocument;
	beforeAll(() => {
		savedDocument = globalThis.document;
		globalThis.document = {
			addEventListener () {},
			getElementById () { return null; },
			querySelector () { return null; },
			querySelectorAll () { return []; },
			createElement () { return {className: "", title: "", textContent: ""}; },
		};
	});
	afterAll(() => { globalThis.document = savedDocument; });

	test("renders a leading + for positive, - for negative, blank for empty", () => {
		const inv = makeInventory(newState());
		const form = makeSignedForm([25, -3, ""]);
		inv._decorateSignedBonusInputs(form);
		expect(form._inputs[0].nextElementSibling.textContent).toBe("+25");
		expect(form._inputs[1].nextElementSibling.textContent).toBe("-3");
		expect(form._inputs[2].nextElementSibling.textContent).toBe("");
	});

	test("the preview updates live when the input fires 'input'", () => {
		const inv = makeInventory(newState());
		const form = makeSignedForm([0]);
		inv._decorateSignedBonusInputs(form);
		const input = form._inputs[0];
		expect(input.nextElementSibling.textContent).toBe("0");
		input.value = "-12";
		input.fire("input");
		expect(input.nextElementSibling.textContent).toBe("-12");
	});

	test("decoration is idempotent — it does not double-append a preview", () => {
		const inv = makeInventory(newState());
		const form = makeSignedForm([5]);
		inv._decorateSignedBonusInputs(form);
		const firstPreview = form._inputs[0].nextElementSibling;
		// Simulate the preview now being recognised as a sibling.
		firstPreview.classList = {contains: cls => cls === "charsheet__signed-preview"};
		inv._decorateSignedBonusInputs(form);
		expect(form._inputs[0].nextElementSibling).toBe(firstPreview);
	});
});

describe("Bug #1 — formatEffectBonus contract reused by the item preview (Round 16 parity)", () => {
	test("matches the shared signed formatter", () => {
		expect(CustomAbilities.formatEffectBonus(25)).toBe("+25");
		expect(CustomAbilities.formatEffectBonus(-3)).toBe("-3");
		expect(CustomAbilities.formatEffectBonus(0)).toBe("0");
	});
});
