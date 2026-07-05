/**
 * Character Sheet — Combat-tab consumable "Use" dispatch + two-button (Bonus/Action) use (Bug 2)
 *
 * Regression coverage for two defects:
 *   (a) SILENT NO-OP: the combat consumables panel lists items via the broad `_isConsumable`
 *       (type prefix / poison / name), but `_useConsumable` used to dispatch with a STRICT
 *       `item.type === "P"`/`"SC"` check — so a Potion of Healing stored as name-matched,
 *       lowercase, or source-suffixed (`"P|DMG"`) never reached `_usePotion` and nothing happened.
 *       The fix routes every listed consumable to a use path via shared detection helpers.
 *   (b) MAX-ROLL GATING: `_usePotion` used to take the MAXIMUM whenever the global
 *       `thelemar_itemUtilization` setting was on (maxing EVERY use). The TGTT item-utilization
 *       rule instead only maxes when the item is used as an ACTION. This is now driven by a
 *       `maximize` flag threaded from the button, not the global setting.
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

function makeInventory (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	inv._page = {
		getState: () => state,
		renderCharacter: () => {},
		saveCharacter: () => {},
	};
	inv.setItems([]);
	return inv;
}

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("con", 14);
	// Pin a large max so healing never caps — lets us observe the exact HP delta.
	state.setHp(1, 200);
	return state;
}

/** Add a potion, return its inventory id. */
function addPotion (state, itemProps, quantity = 1) {
	state.addItem({...itemProps, quantity});
	const items = state.getItems();
	return items[items.length - 1].id;
}

// The three storage shapes that previously broke the strict dispatch: a canonical `type:"P"`,
// a NAME-matched potion with a source-suffixed `type:"P|DMG"`, and a NAME-matched potion with
// no `type` at all. All should heal via `_useConsumable`.
const POTION_SHAPES = [
	{label: "strict type:'P'", props: {name: "Potion of Healing", source: "PHB", type: "P"}},
	{label: "name-matched type:'P|DMG'", props: {name: "Potion of Healing", source: "DMG", type: "P|DMG", _isCustom: true}},
	{label: "name-matched, type undefined", props: {name: "Potion of Healing", source: "Homebrew", _isCustom: true}},
];

describe("Bug 2 — consumable detection routes every listed potion to a use path", () => {
	test.each(POTION_SHAPES)("_isConsumable + dispatch helpers accept $label", ({props}) => {
		const state = newState();
		const inv = makeInventory(state);
		const id = addPotion(state, props);
		const item = state.getItems().find(i => i.id === id);

		// Listed by the combat panel...
		expect(inv._isConsumable(item)).toBe(true);
		// ...and actually routed to the potion path (the previously-broken half).
		expect(inv._isPotionConsumable(item)).toBe(true);
		expect(inv._isScrollConsumable(item)).toBe(false);
	});

	test("getItemHealingEffect fallback still resolves 2d4+2 for a bare Potion of Healing", () => {
		const state = newState();
		const inv = makeInventory(state);
		const id = addPotion(state, {name: "Potion of Healing", source: "Homebrew", _isCustom: true});
		expect(inv).toBeDefined();
		expect(state.getItemHealingEffect(id)).toEqual({dice: "2d4+2"});
	});
});

describe("Bug 2 — _useConsumable actually heals + decrements (dispatch fix)", () => {
	test.each(POTION_SHAPES)("normal use of $label heals within [4,10] and consumes one", async ({props}) => {
		const state = newState();
		const inv = makeInventory(state);
		const id = addPotion(state, props, 2);

		const before = state.getHp().current;
		await inv._useConsumable(id);
		const after = state.getHp().current;
		const delta = after - before;

		// 2d4+2 ⇒ min 4, max 10.
		expect(delta).toBeGreaterThanOrEqual(4);
		expect(delta).toBeLessThanOrEqual(10);
		// One consumed (qty 2 → 1).
		expect(state.getItems().find(i => i.id === id).quantity).toBe(1);
	});

	test("maximize (used as an action) heals the MAXIMUM (10) and consumes one", async () => {
		const state = newState();
		const inv = makeInventory(state);
		const id = addPotion(state, {name: "Potion of Healing", source: "DMG", type: "P|DMG", _isCustom: true}, 2);

		const before = state.getHp().current;
		await inv._useConsumable(id, {maximize: true});
		const delta = state.getHp().current - before;

		expect(delta).toBe(10); // 2*4 + 2
		expect(state.getItems().find(i => i.id === id).quantity).toBe(1);
	});
});

describe("Bug 2 — max is driven by the button, NOT the global setting", () => {
	test("with thelemar_itemUtilization ON, a normal (bonus-action) use still ROLLS (not always max)", async () => {
		const state = newState();
		expect(state.getSettings().thelemar_itemUtilization).toBe(true); // default ON in this fork

		const inv = makeInventory(state);
		// Big stack so we can sample many normal uses.
		const id = addPotion(state, {name: "Potion of Healing", source: "PHB", type: "P"}, 200);

		const deltas = [];
		for (let i = 0; i < 60; i++) {
			state.setHp(1, 200); // reset so nothing caps
			const before = state.getHp().current;
			await inv._useConsumable(id); // no maximize ⇒ bonus-action ⇒ roll
			deltas.push(state.getHp().current - before);
		}

		// Every roll must be in range...
		expect(Math.min(...deltas)).toBeGreaterThanOrEqual(4);
		expect(Math.max(...deltas)).toBeLessThanOrEqual(10);
		// ...and at least one must be below the max, proving the old "always max when setting on"
		// behavior is gone (P(all 60 == 10) is astronomically small).
		expect(Math.min(...deltas)).toBeLessThan(10);
	});

	test("maximize path takes max regardless of setting state", async () => {
		const state = newState();
		state.setSetting("thelemar_itemUtilization", false);
		const inv = makeInventory(state);
		const id = addPotion(state, {name: "Potion of Healing", source: "PHB", type: "P"});

		const before = state.getHp().current;
		await inv._useConsumable(id, {maximize: true});
		expect(state.getHp().current - before).toBe(10);
	});
});
