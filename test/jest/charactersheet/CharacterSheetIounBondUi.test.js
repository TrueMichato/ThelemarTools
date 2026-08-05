/**
 * Character Sheet — Ioun bond vs. attunement, as the player reads them
 *
 * An Ioun bond and an attunement are different mechanics that used to wear identical
 * clothes: the same amber star button labelled "Attune", and the same row in the
 * attunement sidebar. That is actively misleading — a bond costs days of consecutive
 * orbit rather than a short rest, it never consumes one of the 3-6 attunement slots,
 * and it is governed entirely by the Ioun Stone manager.
 *
 * These tests pin the three separations, plus the guard that makes the first one safe:
 *   - the row control speaks "Bond"/"Bonded" in its own hue and glyph
 *   - bonded stones are absent from the attunement list (the manager button is their doorway)
 *   - the "slot-free" counter is derived from what is actually displayed
 *   - breaking a bond is confirmed, because reforming it is expensive
 *
 * Every assertion is against an item whose *own text* declares the bond, so none of
 * them depend on the TGTT master flag.
 */

import {jest} from "@jest/globals";
import "./setup.js";

// `js/utils.js` installs these String extensions in the browser. The Jest harness loads
// the inventory module without them, and that module relies on `.qq()` for HTML-escaping
// in five places — four of them predating this suite.
if (!String.prototype.escapeQuotes) {
	String.prototype.escapeQuotes = function () {
		return this.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	};
}
if (!String.prototype.qq) {
	String.prototype.qq = function () { return this.escapeQuotes(); };
}

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

// _renderItemRow probes these statics for upgrade badges; a plain wondrous item
// exercises only the is{Weapon,Armor,Shield} guards.
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

const IOUN_BOND_TEXT = "An Ioun bond is a special form of attunement and doesn't count against the number of magic items to which a creature can normally be attuned.";

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
}

function makeInventory (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
	return inv;
}

function makeStone (name = "Ioun Stone #046, Green Star") {
	return {
		name,
		source: "MECIounStones",
		type: "wondrous",
		weight: 0,
		requiresAttunement: true,
		entries: ["This stone orbits your head.", IOUN_BOND_TEXT],
	};
}

function makeRing (name = "Ring of Protection") {
	return {
		name,
		source: "DMG",
		type: "RG",
		weight: 0,
		requiresAttunement: true,
		entries: ["You gain a +1 bonus to AC and saving throws while wearing this ring."],
	};
}

function addAttuned (state, itemData) {
	state.addItem(itemData);
	const row = state.getItems().at(-1);
	state.setItemEquipped(row.id, true);
	state.setItemAttuned(row.id, true);
	return state.getItems().find(i => i.id === row.id);
}

function rowHtml (inv, state, itemData, {attuned = false} = {}) {
	state.addItem(itemData);
	const row = state.getItems().at(-1);
	if (attuned) state.setItemAttuned(row.id, true);
	return inv._renderItemRow(state.getItems().find(i => i.id === row.id)).outerHTML;
}

/** A stand-in for the `#charsheet-attuned-list` container, capturing what gets appended. */
function captureAttunedList (inv) {
	const appended = [];
	const container = {
		innerHTML: "",
		append (el) { appended.push(el); },
	};
	const prior = globalThis.document.getElementById;
	globalThis.document.getElementById = (id) => (id === "charsheet-attuned-list" ? container : null);
	try {
		inv._renderAttunedItems();
	} finally {
		globalThis.document.getElementById = prior;
	}
	return appended.map(el => el?.outerHTML ?? String(el)).join("\n");
}

describe("Row control — a bond does not dress as an attunement", () => {
	test("an unbonded stone offers 'Bond', not 'Attune'", () => {
		const state = newState();
		const inv = makeInventory(state);
		const html = rowHtml(inv, state, makeStone());

		expect(html).toContain("charsheet__item-attune--bond");
		expect(html).toMatch(/<\/span>\s*Bond\s*<\/button>/);
		expect(html).not.toMatch(/<\/span>\s*Attune\s*<\/button>/);
		// Hue is not the only cue: the hollow diamond marks "not yet bonded".
		expect(html).toContain("◇");
	});

	test("a bonded stone reads 'Bonded' in the bonded state class and filled glyph", () => {
		const state = newState();
		const inv = makeInventory(state);
		const html = rowHtml(inv, state, makeStone(), {attuned: true});

		expect(html).toContain("charsheet__item-attune--bond is-bonded");
		expect(html).toMatch(/<\/span>\s*Bonded\s*<\/button>/);
		expect(html).toContain("◈");
		// The amber attunement skin must never appear on a bond.
		expect(html).not.toContain("ve-btn-warning");
	});

	test("its name badge is the bond badge, not the attunement badge", () => {
		const state = newState();
		const inv = makeInventory(state);
		const html = rowHtml(inv, state, makeStone(), {attuned: true});

		expect(html).toContain("charsheet__item-attuned-badge--bond");
		expect(html).toContain("Ioun bond");
	});

	test("REGRESSION: an ordinary attunement item keeps the attunement skin, label and glyph", () => {
		const state = newState();
		const inv = makeInventory(state);

		const unattuned = rowHtml(inv, state, makeRing());
		expect(unattuned).toMatch(/<\/span>\s*Attune\s*<\/button>/);
		expect(unattuned).toContain("glyphicon-star-empty");
		expect(unattuned).not.toContain("charsheet__item-attune--bond");

		const attuned = rowHtml(inv, state, makeRing("Ring of Evasion"), {attuned: true});
		expect(attuned).toContain("ve-btn-warning");
		expect(attuned).toMatch(/<\/span>\s*Attuned\s*<\/button>/);
		expect(attuned).not.toContain("charsheet__item-attune--bond");
		expect(attuned).not.toContain("charsheet__item-attuned-badge--bond");
	});

	test("an item that needs no attunement still renders no attunement control at all", () => {
		const state = newState();
		const inv = makeInventory(state);
		const html = rowHtml(inv, state, {name: "Rope", source: "PHB", type: "G", weight: 10, requiresAttunement: false, entries: ["Rope."]});

		expect(html).not.toContain("charsheet__item-attune");
	});
});

describe("Attunement list — bonded stones are governed elsewhere", () => {
	test("a bonded stone does not appear in the attunement list", () => {
		const state = newState();
		const inv = makeInventory(state);
		addAttuned(state, makeStone());

		const html = captureAttunedList(inv);
		expect(html).not.toContain("Green Star");
	});

	test("REGRESSION: ordinary attuned items still appear, with their slot count", () => {
		const state = newState();
		const inv = makeInventory(state);
		addAttuned(state, makeRing());
		addAttuned(state, makeStone());

		const html = captureAttunedList(inv);
		expect(html).toContain("Ring of Protection");
		expect(html).toContain("Attunement Slots: 1/");
		expect(html).not.toContain("Green Star");
	});

	test("REGRESSION: the slot-free counter is derived from displayed rows, never a negative remainder", () => {
		const state = newState();
		const inv = makeInventory(state);
		// Three bonded stones and one ordinary attunement. The old
		// `attunedItems.length - currentAttuned` arithmetic advertised "+3 slot-free"
		// for stones this list no longer shows.
		addAttuned(state, makeRing());
		addAttuned(state, makeStone("Ioun Stone #001, Pale Blue Rhomboid"));
		addAttuned(state, makeStone("Ioun Stone #002, Scarlet Sphere"));
		addAttuned(state, makeStone("Ioun Stone #003, Incandescent Blue Sphere"));

		const html = captureAttunedList(inv);
		expect(html).toContain("Attunement Slots: 1/");
		expect(html).not.toContain("slot-free");
	});

	test("with only stones attuned the list reads as empty rather than listing them", () => {
		const state = newState();
		const inv = makeInventory(state);
		addAttuned(state, makeStone());

		const html = captureAttunedList(inv);
		expect(html).toContain("No attuned items");
	});
});

describe("Breaking a bond is confirmed", () => {
	function stubConfirm (answer) {
		const prior = globalThis.InputUiUtil;
		const pGetUserBoolean = jest.fn(async () => answer);
		globalThis.InputUiUtil = {...(prior || {}), pGetUserBoolean};
		return {pGetUserBoolean, restore: () => { globalThis.InputUiUtil = prior; }};
	}

	test("declining the confirmation leaves the bond intact", async () => {
		const state = newState();
		const inv = makeInventory(state);
		const row = addAttuned(state, makeStone());
		const {pGetUserBoolean, restore} = stubConfirm(false);

		try {
			await inv._toggleAttuned(row.id);
		} finally { restore(); }

		expect(pGetUserBoolean).toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === row.id).attuned).toBe(true);
	});

	test("confirming ends the bond", async () => {
		const state = newState();
		const inv = makeInventory(state);
		const row = addAttuned(state, makeStone());
		const {restore} = stubConfirm(true);

		try {
			await inv._toggleAttuned(row.id);
		} finally { restore(); }

		expect(state.getItems().find(i => i.id === row.id).attuned).toBe(false);
	});

	test("REGRESSION: un-attuning an ordinary item is not gated behind a confirmation", async () => {
		const state = newState();
		const inv = makeInventory(state);
		const row = addAttuned(state, makeRing());
		const {pGetUserBoolean, restore} = stubConfirm(false);

		try {
			await inv._toggleAttuned(row.id);
		} finally { restore(); }

		expect(pGetUserBoolean).not.toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === row.id).attuned).toBe(false);
	});
});
