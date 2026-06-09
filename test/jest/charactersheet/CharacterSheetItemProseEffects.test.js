/**
 * Character Sheet — Item PROSE effect aggregation (Bug #1)
 *
 * Verifies that magic items whose mechanical effects are expressed only in prose `entries`
 * (not structured fields) actually flow through the same aggregation pipeline the structured
 * fields use, and change the aggregated values on the sheet:
 *   - senses (grant + the Goggles-of-Night "increase by N if you already have it" case)
 *   - ability score set/bonus
 *   - speed bonus
 *   - resistances / condition immunities
 *   - saving-throw bonus
 * Also verifies structured > prose precedence and equipped/attunement gating.
 */

import "./setup.js";

// The inventory module wires document-level listeners in its constructor; provide a stub so it
// can be instantiated under the Node test environment.
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

/** Build an inventory module wired to a state, with a stub page + optional catalog. */
function makeInventory (state, catalog = []) {
	const page = {
		getState: () => state,
		renderCharacter: () => {},
	};
	const inv = new CharacterSheetInventory(page);
	inv.setItems(catalog);
	return inv;
}

/** Add an item to state, equip it, optionally attune, return its inventory id. */
function addEquip (state, item, {attune = false} = {}) {
	state.addItem(item);
	const items = state.getItems();
	const added = items[items.length - 1];
	state.setItemEquipped(added.id, true);
	if (attune) state.setItemAttuned(added.id, true);
	return added.id;
}

/** A prose-only wondrous item (no structured effect fields). */
function proseItem (name, entries, overrides = {}) {
	return {
		name,
		source: "DMG",
		type: "wondrous",
		weight: 0,
		equipped: false,
		attuned: false,
		requiresAttunement: false,
		entries: Array.isArray(entries) ? entries : [entries],
		...overrides,
	};
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

describe("Item prose → sense effects (Bug #1)", () => {
	test("Goggles of Night grants darkvision 60 when none present", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem("Goggles of Night", "While wearing these dark lenses, you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(60);
		expect(state.getSense("darkvision")).toBe(60);
	});

	test("Goggles of Night adds +60 to an existing darkvision range", () => {
		const state = newState();
		state.setSense("darkvision", 60); // e.g. from a race
		const inv = makeInventory(state);
		addEquip(state, proseItem("Goggles of Night", "you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(120);
	});

	test("plain prose darkvision grant acts as a floor (does not stack additively)", () => {
		const state = newState();
		state.setSense("darkvision", 90);
		const inv = makeInventory(state);
		addEquip(state, proseItem("Helm of Seeing", "While wearing this helm, you gain {@sense darkvision} out to a range of 60 feet."));

		inv._updateItemBonuses(state.getItems());

		// Floor: existing 90 wins over the 60 grant; no additive stacking.
		expect(state.getSenses().darkvision).toBe(90);
	});

	test("structured senses take precedence over prose for the same type", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem(
			"Conflicting Lenses",
			"you have {@sense darkvision} out to a range of 30 feet.",
			{senses: {darkvision: 120}},
		));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(120);
	});

	test("unequipped prose sense item contributes nothing", () => {
		const state = newState();
		const inv = makeInventory(state);
		state.addItem(proseItem("Goggles of Night", "you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, it increases its range by 60 feet."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(0);
	});

	// Regression guards using the EXACT shipping entries text from data/items.json so the
	// headline Goggles-of-Night case keeps working against real data, not just synthetic prose.
	test("REAL Goggles of Night (DMG) wording: 60 with none, 120 with existing 60", () => {
		const dmgText = "While wearing these dark lenses, you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet.";

		const s1 = newState();
		const i1 = makeInventory(s1);
		addEquip(s1, proseItem("Goggles of Night", dmgText)); // no attunement on real item
		i1._updateItemBonuses(s1.getItems());
		expect(s1.getSenses().darkvision).toBe(60);

		const s2 = newState();
		s2.setSense("darkvision", 60);
		const i2 = makeInventory(s2);
		addEquip(s2, proseItem("Goggles of Night", dmgText));
		i2._updateItemBonuses(s2.getItems());
		expect(s2.getSenses().darkvision).toBe(120);
	});

	test("REAL Goggles of Night (XDMG) wording with tag source + 'out to 60 feet'", () => {
		const xdmgText = "While wearing these dark lenses, you have {@sense Darkvision|XPHB} out to 60 feet. If you already have {@sense Darkvision|XPHB}, wearing the goggles increases its range by 60 feet.";

		const s1 = newState();
		const i1 = makeInventory(s1);
		addEquip(s1, proseItem("Goggles of Night", xdmgText, {source: "XDMG"}));
		i1._updateItemBonuses(s1.getItems());
		expect(s1.getSenses().darkvision).toBe(60);

		const s2 = newState();
		s2.setSense("darkvision", 90);
		const i2 = makeInventory(s2);
		addEquip(s2, proseItem("Goggles of Night", xdmgText, {source: "XDMG"}));
		i2._updateItemBonuses(s2.getItems());
		expect(s2.getSenses().darkvision).toBe(150);
	});
});

describe("Item prose → ability / speed / defense / save effects (Bug #1)", () => {
	test("prose ability-score SET applies when no structured ability", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem("Headband of Intellect", "While wearing this headband, your Intelligence score is 19. It has no effect on you if your Intelligence is already 19 or higher."), {attune: true});
		// no attunement required on this fixture, but harmless

		inv._updateItemBonuses(state.getItems());

		expect(state.getAbilityScore("int")).toBe(19);
	});

	test("structured ability SET wins over prose", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem(
			"Odd Headband",
			"your Intelligence score is 12.",
			{ability: {static: {int: 19}}},
		));

		inv._updateItemBonuses(state.getItems());

		expect(state.getAbilityScore("int")).toBe(19);
	});

	test("prose walking-speed bonus increases speed", () => {
		const state = newState();
		const inv = makeInventory(state);
		const before = state.getSpeed("walk");
		addEquip(state, proseItem("Boots of Striding", "While you wear these boots, your walking speed increases by 10 feet."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSpeed("walk")).toBe(before + 10);
	});

	test("prose resistance applies to defenses", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem("Ring of Fire Warding", "While wearing this ring, you have resistance to fire damage."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getResistances()).toContain("fire");
	});

	test("prose condition immunity applies", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem("Brooch of Calm", "While wearing this brooch, you are immune to being charmed."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getConditionImmunities()).toContain("charmed");
	});

	test("prose saving-throw bonus feeds item saving-throw bonus", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem("Cloak of Protection", "While wearing this cloak, you have a +1 bonus to AC and saving throws."), {attune: true});

		inv._updateItemBonuses(state.getItems());

		expect(state.getItemBonuses().savingThrow).toBe(1);
	});

	test("activated-only prose (command word) does NOT auto-apply speed", () => {
		const state = newState();
		const inv = makeInventory(state);
		const before = state.getSpeed("walk");
		addEquip(state, proseItem("Boots of Speed", "While you wear these boots, you can use a bonus action to click the boots' heels together. Your walking speed increases by 30 feet for 10 minutes."));

		inv._updateItemBonuses(state.getItems());

		// Activation phrasing present → not treated as a passive always-on bonus.
		expect(state.getSpeed("walk")).toBe(before);
	});

	test("entries re-hydrate from catalog when inventory item lacks entries", () => {
		const state = newState();
		const catalog = [{
			name: "Goggles of Night",
			source: "DMG",
			entries: ["you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet."],
		}];
		const inv = makeInventory(state, catalog);
		// Item stored WITHOUT entries (older save)
		addEquip(state, {name: "Goggles of Night", source: "DMG", type: "wondrous", weight: 0, equipped: false, attuned: false, requiresAttunement: false});

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(60);
	});
});

describe("Item prose → edge cases & gating (Bug #1)", () => {
	test("structured senses suppress the prose 'increase' on the SAME item (no double-count)", () => {
		const state = newState();
		const inv = makeInventory(state);
		// Pathological item carrying BOTH structured darkvision 60 AND Goggles-style increase prose.
		// Structured wins for the type → the additive 'increase' must NOT stack on top.
		addEquip(state, proseItem(
			"Hybrid Goggles",
			"you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, it increases its range by 60 feet.",
			{senses: {darkvision: 60}},
		));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(60); // not 120
	});

	test("darkvision from another equipped item + Goggles increase stacks to 120", () => {
		const state = newState();
		const inv = makeInventory(state);
		// One item grants structured darkvision 60; Goggles add +60 on top.
		addEquip(state, proseItem("Lenses of Sight", "irrelevant prose", {senses: {darkvision: 60}}));
		addEquip(state, proseItem("Goggles of Night", "you have {@sense darkvision} out to a range of 60 feet. If you already have {@sense darkvision}, wearing the goggles increases its range by 60 feet."));

		inv._updateItemBonuses(state.getItems());

		expect(state.getSenses().darkvision).toBe(120);
	});

	test("prose effect is GATED by attunement: no effect until attuned, clears when unattuned", () => {
		const state = newState();
		const inv = makeInventory(state);
		// requiresAttunement true; equipped but NOT attuned → no effect.
		const id = addEquip(state, proseItem(
			"Cloak of Cold Warding",
			"While wearing this cloak, you have resistance to cold damage.",
			{requiresAttunement: true},
		));
		inv._updateItemBonuses(state.getItems());
		expect(state.getResistances()).not.toContain("cold");

		// Attune → effect applies.
		state.setItemAttuned(id, true);
		inv._updateItemBonuses(state.getItems());
		expect(state.getResistances()).toContain("cold");

		// Un-attune → effect clears.
		state.setItemAttuned(id, false);
		inv._updateItemBonuses(state.getItems());
		expect(state.getResistances()).not.toContain("cold");
	});

	test("mixed passive + activated prose: passive resistance still applies despite an activated sentence", () => {
		const state = newState();
		const inv = makeInventory(state);
		addEquip(state, proseItem(
			"Ring of Flame Warding",
			"While wearing this ring, you have resistance to fire damage. You can use an action to cast {@spell burning hands} from the ring.",
		));

		inv._updateItemBonuses(state.getItems());

		expect(state.getResistances()).toContain("fire");
	});

	test("unequipping an item clears its prose effect", () => {
		const state = newState();
		const inv = makeInventory(state);
		const id = addEquip(state, proseItem("Ring of Fire Warding", "While wearing this ring, you have resistance to fire damage."));
		inv._updateItemBonuses(state.getItems());
		expect(state.getResistances()).toContain("fire");

		state.setItemEquipped(id, false);
		inv._updateItemBonuses(state.getItems());
		expect(state.getResistances()).not.toContain("fire");
	});

	test("prose STR set flows through to the consumed ability modifier", () => {
		const state = newState();
		const inv = makeInventory(state);
		// Base STR 16 (+3). Belt sets STR to 21 (+5) — assert the CONSUMED modifier changes.
		addEquip(state, proseItem(
			"Belt of Giant Strength",
			"While wearing this belt, your Strength score is 21.",
			{requiresAttunement: true},
		), {attune: true});

		inv._updateItemBonuses(state.getItems());

		expect(state.getAbilityScore("str")).toBe(21);
		expect(state.getAbilityMod("str")).toBe(5);
	});
});
