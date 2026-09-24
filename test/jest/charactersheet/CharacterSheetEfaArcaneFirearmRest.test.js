import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
let CharacterSheetRest;

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 5,
		subclass: {name: "Artillerist", shortName: "Artillerist", source: "EFA"},
	});
	return state;
}

function addCandidate (state, {id, name, type = "WD"} = {}) {
	state.addItem({
		id,
		name,
		source: "XPHB",
		type,
		quantity: 1,
		equipped: true,
		_isCustom: true,
	});
	state.setItemEquipped(id, true);
	return state.getInventory().find(row => row.id === id);
}

function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: jest.fn(async () => {}),
		renderCharacter: jest.fn(),
	};
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

function makeElement ({tag = "div", clazz = "", txt = "", val = "", id = "", outer = ""} = {}) {
	const classMatch = outer.match(/class="([^"]+)"/);
	const attributes = {};
	return {
		tagName: tag.toUpperCase(),
		className: clazz || classMatch?.[1] || "",
		textContent: txt,
		value: val,
		id,
		children: [],
		parentNode: null,
		appendChild (child) {
			child.parentNode = this;
			this.children.push(child);
			return child;
		},
		setAttribute (name, value) { attributes[name] = String(value); },
		getAttribute (name) { return attributes[name] ?? null; },
	};
}

beforeAll(async () => {
	const original = globalThis.e_;
	globalThis.e_ = options => makeElement(options);
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
	globalThis.e_ = original;
});

function findByClass (element, className) {
	if (String(element.className || "").split(/\s+/).includes(className)) return element;
	for (const child of element.children || []) {
		const found = findByClass(child, className);
		if (found) return found;
	}
	return null;
}

async function withFakeElements (fn) {
	return fn();
}

describe("EFA Arcane Firearm Long Rest choice", () => {
	it("defaults to Keep Current when the binding remains legal", async () => withFakeElements(() => {
		const state = makeState();
		const current = addCandidate(state, {id: "current", name: "Current Wand"});
		addCandidate(state, {id: "other", name: "Other Wand"});
		state.setEfaArcaneFirearmBinding(current.id);
		const {rest} = makeRest(state);

		const choice = rest._buildEfaArcaneFirearmLongRestSection();
		const select = findByClass(choice.section, "charsheet__arcane-firearm-rest-select");
		expect(select.value).toBe("__keep__");
		expect(select.getAttribute("aria-label")).toBe("Arcane Firearm item to carve after this Long Rest");
		expect(choice.getSelectedItemId()).toBe(current.id);
		expect(choice.apply()).toBe(false);
		expect(state.getEfaArcaneFirearmStatus().binding.inventoryItemId).toBe(current.id);
	}));

	it("changes the binding only when the Long Rest choice is applied", async () => withFakeElements(() => {
		const state = makeState();
		const current = addCandidate(state, {id: "current", name: "Current Wand"});
		const replacement = addCandidate(state, {id: "replacement", name: "Replacement Staff", type: "ST"});
		state.setEfaArcaneFirearmBinding(current.id);
		const {rest} = makeRest(state);
		const choice = rest._buildEfaArcaneFirearmLongRestSection();
		const select = findByClass(choice.section, "charsheet__arcane-firearm-rest-select");

		select.value = replacement.id;
		expect(choice.getSelectedItemId()).toBe(replacement.id);
		expect(choice.apply()).toBe("Replacement Staff");
		expect(state.getEfaArcaneFirearmStatus().binding.inventoryItemId).toBe(replacement.id);
	}));

	it("shows an accessible recovery state and preserves an unbound character when no candidate exists", async () => withFakeElements(() => {
		const state = makeState();
		const {rest} = makeRest(state);
		const choice = rest._buildEfaArcaneFirearmLongRestSection();
		const empty = findByClass(choice.section, "charsheet__arcane-firearm-rest-empty");

		expect(empty.getAttribute("role")).toBe("status");
		expect(empty.textContent).toContain("No eligible rod, staff, wand, or martial ranged weapon");
		expect(choice.apply()).toBe(false);
		expect(state.getEfaArcaneFirearmStatus().binding).toBeNull();
	}));

	it("does not mutate when the player cancels before applying the selected replacement", async () => withFakeElements(() => {
		const state = makeState();
		const current = addCandidate(state, {id: "current", name: "Current Wand"});
		const replacement = addCandidate(state, {id: "replacement", name: "Replacement Wand"});
		state.setEfaArcaneFirearmBinding(current.id);
		const {rest} = makeRest(state);
		const choice = rest._buildEfaArcaneFirearmLongRestSection();
		const select = findByClass(choice.section, "charsheet__arcane-firearm-rest-select");

		select.value = replacement.id;
		expect(state.getEfaArcaneFirearmStatus().binding.inventoryItemId).toBe(current.id);
	}));

	it("rest undo restores the prior binding after a committed re-carve", () => {
		const state = makeState();
		const current = addCandidate(state, {id: "current", name: "Current Wand"});
		const replacement = addCandidate(state, {id: "replacement", name: "Replacement Wand"});
		state.setEfaArcaneFirearmBinding(current.id);
		const {rest} = makeRest(state);

		rest._captureRestSnapshot("long");
		state.resetTurnEconomy();
		state.setEfaArcaneFirearmBinding(replacement.id);
		expect(state.getEfaArcaneFirearmStatus().binding.inventoryItemId).toBe(replacement.id);

		expect(rest._onUndoRest()).toBe(true);
		expect(state.getEfaArcaneFirearmStatus().binding.inventoryItemId).toBe(current.id);
	});

	it("guards failed Long Rest persistence with snapshot rollback before closing", () => {
		const source = fs.readFileSync("js/charactersheet/charactersheet-rest.js", "utf8");
		expect(source).toContain("if (!restSnapshot?.json)");
		expect(source).toContain("No changes were made.");
		expect(source).toContain("await this._page._saveCurrentCharacter({isReturnStatus: true})");
		expect(source).toContain("if (saveResult === false) throw new Error");
		expect(source).toContain("this._state.loadFromJson(restSnapshot.json)");
		expect(source).toContain("this._page._lastRestSnapshot = previousRestSnapshot");
	});
});
