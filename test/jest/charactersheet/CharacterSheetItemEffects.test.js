/**
 * Custom-item structured effects (Bug #8) — items now carry an `effects[]` array using the
 * SAME catalog/schema as custom abilities and flow through the SAME modifier pipeline
 * (`_applyCatalogEffect` → named modifiers / defensive arrays / carryCapacity). These tests
 * pin the item-effects LIFECYCLE in charactersheet-state.js (register on equip, unregister on
 * unequip/remove, attunement gating, no duplication across save/load) plus the shared
 * catalog/editor wiring that the custom-item modal reuses.
 *
 * Bridge to Bug #10: a custom item with a `carryCapacity` effect feeds the carry breakdown's
 * PRE-multiplier flatBonus (consistent with abilities), distinct from the post-multiplier
 * external-container channel that the built-in Bag of Holding uses.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-customabilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCustomAbilities = globalThis.CharacterSheetCustomAbilities;

function mkState ({level = 5} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setSetting("thelemar_carryWeight", false); // standard 5e rule: STR × 15
	state.setAbilityBase("str", 10);
	return state;
}

/** Build a flat custom-item payload carrying structured effects. */
function customItem (name, effects, extra = {}) {
	return {
		name,
		source: "Custom",
		_isCustom: true,
		weight: 1,
		equipped: false,
		attuned: false,
		quantity: 1,
		effects,
		...extra,
	};
}

describe("Bug #8 — item effects flow through the shared modifier pipeline", () => {
	it("an equipped custom item's carryCapacity effect raises the PRE-multiplier flat bonus", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.flatBonus).toBe(50); // pre-multiplier (distinct from the Bag-of-Holding external term)
		expect(b.externalCapacity).toBe(0);
		expect(b.total).toBe(200); // (150 + 50) × 1
	});

	it("an equipped custom item's AC effect surfaces as a custom AC modifier", () => {
		const state = mkState();
		state.addItem(customItem("Bracers of Defense", [{type: "ac", value: 2}], {equipped: true}));
		expect(state.getCustomModifier("ac")).toBe(2);
	});

	it("an equipped custom item's resistance effect appears in getResistances()", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		expect(state.getResistances()).toContain("fire");
	});

	it("a custom item's save effect raises the saving-throw custom modifier", () => {
		const state = mkState();
		state.addItem(customItem("Ring of Iron Will", [{type: "save:wis", value: 1}], {equipped: true}));
		expect(state.getCustomModifier("save:wis")).toBe(1);
	});
});

describe("Bug #8 — item effects activation gating (equipped / attuned)", () => {
	it("effects do NOT apply while the item is unequipped", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("equipping applies effects; unequipping reverts them", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		const id = state.getItems()[0].id;

		state.setItemEquipped(id, true);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.setItemEquipped(id, false);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("an attunement-required item applies effects only once ATTUNED (not merely equipped)", () => {
		const state = mkState();
		state.addItem(customItem(
			"Amulet of Hauling",
			[{type: "carryCapacity", value: 50}],
			{equipped: true, attuned: false, requiresAttunement: true},
		));
		const id = state.getItems()[0].id;

		// Equipped but not attuned → inert.
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);

		state.setItemAttuned(id, true);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.setItemAttuned(id, false);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});
});

describe("Bug #8 — item effects cleanup on removal / replacement", () => {
	it("removing an equipped item purges its contributed modifiers", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.removeItem(id);
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("removing an equipped item purges its contributed defensive traits", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getResistances()).toContain("fire");

		state.removeItem(id);
		expect(state.getResistances()).not.toContain("fire");
	});

	it("replaceItem swaps the effect cleanly: +50 → +20 leaves exactly +20", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.replaceItem(id, customItem("Belt of Hauling +", [{type: "carryCapacity", value: 20}], {equipped: true}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(20); // not 70, not 50
	});

	it("replaceItem to a no-effect payload removes the old contribution entirely", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const id = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		state.replaceItem(id, {name: "Plain Belt", source: "Custom", _isCustom: true, weight: 1});
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	it("registering an item's effects is idempotent — equip()-twice does not double the bonus", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: false}));
		const id = state.getItems()[0].id;
		state.equip(id);
		state.equip(id); // second equip must NOT stack a second +50
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);
	});
});

describe("Bug #8 — save/load does not duplicate item effects", () => {
	it("a round-trip through toJson/loadFromJson keeps the bonus at its single value", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(50);

		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		// Must be 50, not 100 (no double-apply from restored named modifiers + re-register).
		expect(restored.getCarryingCapacityBreakdown().flatBonus).toBe(50);
	});

	it("a defensive-trait item round-trips without duplication and cleans up after load", () => {
		const state = mkState();
		state.addItem(customItem("Cloak of Fire Resistance", [{type: "resistance:fire", value: 0}], {equipped: true}));
		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		// Exactly one "fire" entry survives the round-trip.
		expect(restored.getResistances().filter(r => r === "fire").length).toBe(1);

		// Unequipping after load removes it exactly once (no orphaned duplicate).
		const id = restored.getItems()[0].id;
		restored.setItemEquipped(id, false);
		expect(restored.getResistances()).not.toContain("fire");
	});

	it("the item effects array survives the round-trip", () => {
		const state = mkState();
		state.addItem(customItem("Belt of Hauling", [{type: "carryCapacity", value: 50}], {equipped: true}));
		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		const item = restored.getItems()[0];
		expect(item.effects).toEqual([{type: "carryCapacity", value: 50}]);
	});
});

describe("Bug #8 — shared catalog & effects editor (one pipeline for items + abilities)", () => {
	it("getModifierGroups exposes the full catalog (carryCapacity included)", () => {
		const state = mkState();
		const groups = CharacterSheetCustomAbilities.getModifierGroups(state);
		const allTypes = groups.flatMap(g => g.options.map(o => o.value));
		expect(allTypes).toContain("carryCapacity");
		expect(allTypes).toContain("ac");
		expect(allTypes).toContain("resistance:fire");
		expect(allTypes).toContain("save:all");
	});

	it("the item-scoped option list drops active-state-only types the item pipeline ignores", () => {
		const state = mkState();
		const itemHtml = CharacterSheetCustomAbilities.getEffectTypeOptionsHtml(state, {forItems: true});
		const fullHtml = CharacterSheetCustomAbilities.getEffectTypeOptionsHtml(state, {forItems: false});
		// critRange is an active-state-only effect; offering it on items would silently no-op.
		expect(fullHtml).toContain("value=\"critRange\"");
		expect(itemHtml).not.toContain("value=\"critRange\"");
		// carryCapacity IS consumed by items, so it must remain available.
		expect(itemHtml).toContain("value=\"carryCapacity\"");
	});

	it("mountEffectsEditor exists and is defensive (returns a render fn, no-ops on a null container)", () => {
		expect(typeof CharacterSheetCustomAbilities.mountEffectsEditor).toBe("function");
		const render = CharacterSheetCustomAbilities.mountEffectsEditor({
			sheet: mkState(), state: mkState(), listEl: null, effects: [],
		});
		expect(typeof render).toBe("function");
		expect(() => render()).not.toThrow();
	});
});

describe("Bug #8 — custom-item modal wiring (source-pinned)", () => {
	const invSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-inventory.js"), "utf8");
	const abilSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-customabilities.js"), "utf8");

	it("the custom-item modal mounts the shared effects editor", () => {
		expect(invSrc).toContain("CharacterSheetCustomAbilities");
		expect(invSrc).toContain("mountEffectsEditor");
		expect(invSrc).toContain("custom-item-effects-list");
		expect(invSrc).toContain("custom-item-add-effect");
	});

	it("the custom-item modal collects effects into the saved options + builds them onto the item", () => {
		expect(invSrc).toMatch(/options\.effects\s*=/);
		expect(invSrc).toMatch(/effects:\s*Array\.isArray\(options\.effects\)/);
	});

	it("effects round-trip through seed + prefill for edit/clone flows", () => {
		expect(invSrc).toMatch(/options\.effects\s*=\s*JSON\.parse\(JSON\.stringify\(item\.effects\)\)/);
	});

	it("the shared catalog class is exposed globally so the inventory module can reuse it", () => {
		expect(abilSrc).toContain("globalThis.CharacterSheetCustomAbilities = CharacterSheetCustomAbilities");
	});
});
