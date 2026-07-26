/**
 * Character Sheet — Proficiency Picker (shared editor component)
 *
 * Bug 5: both proficiency editors were broken — the main-sheet dropdown never
 * revealed itself (JS cleared an inline `display` that fell back to the
 * stylesheet's `display:none`; the visibility class was never toggled), and the
 * play-mode editor was raw comma-separated free text that wrote straight to
 * `_state._data.*`, bypassing the armor-token normalization.
 *
 * Both surfaces now share `CharacterSheetProfPicker`. These tests exercise its
 * pure, DOM-independent core against a REAL CharacterSheetState:
 *  - the dropdown "opens" (filtered suggestions are produced) and filters by query,
 *  - already-present entries are excluded,
 *  - keyboard highlight navigation clamps/wraps,
 *  - selecting a suggestion commits to state (armor stores the canonical token),
 *  - invalid free-text is rejected for the closed armor set but accepted for
 *    the open languages/weapons/tools sets.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-prof-editor.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetProfPicker = globalThis.CharacterSheetProfPicker;

const ARMOR_TOKEN_TO_LABEL = {light: "Light Armor", medium: "Medium Armor", heavy: "Heavy Armor", shields: "Shields"};

function buildState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	return state;
}

/** Armor picker mirroring the real modal config (closed set, canonical tokens). */
function armorPicker (state) {
	return new CharacterSheetProfPicker({
		label: "Armor",
		suggestions: ["light", "medium", "heavy", "shields"],
		getCurrent: () => state.getArmorProficiencies(),
		adder: (v) => state.addArmorProficiencyCanonical(v),
		remover: (v) => state.removeArmorProficiency(v),
		removerByToken: (v) => state.removeArmorProficiencyVariants(v),
		normalize: (v) => state._normalizeArmorProfToken(v),
		toDisplay: (v) => ARMOR_TOKEN_TO_LABEL[state._normalizeArmorProfToken(v)] || String(v),
		toToken: (v) => state._normalizeArmorProfToken(v),
		allowFreeText: false,
	});
}

/** Languages picker mirroring the real modal config (open, custom allowed). */
function languagePicker (state, suggestions = ["Common", "Elvish", "Dwarvish", "Draconic"]) {
	return new CharacterSheetProfPicker({
		label: "Languages",
		suggestions,
		getCurrent: () => state.getLanguages(),
		adder: (v) => state.addLanguage(v),
		remover: (v) => state.removeLanguage(v),
		allowFreeText: true,
	});
}

describe("CharacterSheetProfPicker — filtering / dropdown 'opens'", () => {
	let state; let picker;
	beforeEach(() => { state = buildState(); picker = languagePicker(state); });

	it("returns all suggestions on an empty query (dropdown has content to show)", () => {
		expect(picker.getFilteredSuggestions("")).toEqual(["Common", "Elvish", "Dwarvish", "Draconic"]);
	});

	it("filters by query against the display label", () => {
		expect(picker.getFilteredSuggestions("dwa")).toEqual(["Dwarvish"]);
		expect(picker.getFilteredSuggestions("ish")).toEqual(["Elvish", "Dwarvish"]);
	});

	it("returns [] when nothing matches (dropdown stays closed)", () => {
		expect(picker.getFilteredSuggestions("zzz")).toEqual([]);
	});

	it("excludes entries already present in state", () => {
		state.addLanguage("Common");
		expect(picker.getFilteredSuggestions("")).toEqual(["Elvish", "Dwarvish", "Draconic"]);
	});

	it("caps the list at the configured limit", () => {
		const many = Array.from({length: 25}, (_, i) => `Lang${i}`);
		const p = new CharacterSheetProfPicker({
			suggestions: many, getCurrent: () => [], adder: () => {}, remover: () => {}, limit: 10,
		});
		expect(p.getFilteredSuggestions("").length).toBe(10);
	});
});

describe("CharacterSheetProfPicker — armor closed set excludes present tokens", () => {
	let state; let picker;
	beforeEach(() => { state = buildState(); picker = armorPicker(state); });

	it("matches a token typed as its friendly label", () => {
		expect(picker.getFilteredSuggestions("light")).toEqual(["light"]);
		expect(picker.getFilteredSuggestions("armor")).toEqual(["light", "medium", "heavy"]);
	});

	it("excludes an armor token already present regardless of stored form", () => {
		state.addArmorProficiency("Light Armor"); // legacy friendly-label store
		expect(picker.getFilteredSuggestions("")).toEqual(["medium", "heavy", "shields"]);
	});
});

describe("CharacterSheetProfPicker — commit writes through state", () => {
	it("commits a selected language and reflects it in state", () => {
		const state = buildState();
		const picker = languagePicker(state);
		expect(picker.commit("Elvish")).toBe(true);
		expect(state.getLanguages()).toContain("Elvish");
	});

	it("commits armor as the CANONICAL token (not the friendly label)", () => {
		const state = buildState();
		const picker = armorPicker(state);
		expect(picker.commit("Light Armor")).toBe(true);
		expect(state.getArmorProficiencies()).toContain("light");
		expect(state.getArmorProficiencies()).not.toContain("Light Armor");
		// The stored token satisfies the exact-token proficiency check.
		expect(state.hasArmorProficiency("light")).toBe(true);
	});

	it("allows custom free-text for the open language set", () => {
		const state = buildState();
		const picker = languagePicker(state, ["Common"]);
		expect(picker.commit("Homebrewish")).toBe(true);
		expect(state.getLanguages()).toContain("Homebrewish");
	});
});

describe("CharacterSheetProfPicker — validity gate rejects invalid entries", () => {
	let state; let picker;
	beforeEach(() => { state = buildState(); picker = armorPicker(state); });

	it("rejects empty / whitespace input everywhere", () => {
		expect(picker.isAcceptable("")).toBe(false);
		expect(picker.isAcceptable("   ")).toBe(false);
		expect(languagePicker(buildState()).isAcceptable("")).toBe(false);
	});

	it("rejects unknown armor types (closed set) and does not mutate state", () => {
		expect(picker.isAcceptable("Plate of Doom")).toBe(false);
		expect(picker.commit("Plate of Doom")).toBe(false);
		expect(state.getArmorProficiencies()).toEqual([]);
	});

	it("accepts known armor whether typed as token or friendly label", () => {
		expect(picker.isAcceptable("shields")).toBe(true);
		expect(picker.isAcceptable("Heavy Armor")).toBe(true);
		expect(picker.isAcceptable("shield")).toBe(true); // singular normalizes to shields
	});

	it("open sets accept arbitrary non-empty text", () => {
		const langs = languagePicker(state, ["Common"]);
		expect(langs.isAcceptable("Anything")).toBe(true);
	});
});

describe("CharacterSheetProfPicker — removal", () => {
	it("removes a plain entry", () => {
		const state = buildState();
		const picker = languagePicker(state);
		state.addLanguage("Elvish");
		picker.removeItem("Elvish");
		expect(state.getLanguages()).not.toContain("Elvish");
	});

	it("armor removal collapses every stored variant that normalizes to the token", () => {
		const state = buildState();
		const picker = armorPicker(state);
		state.addArmorProficiency("light");
		state.addArmorProficiency("Light Armor"); // polluted duplicate
		picker.removeItem("light");
		expect(state.getArmorProficiencies().some(a => state._normalizeArmorProfToken(a) === "light")).toBe(false);
	});

	it("normalize-only removal (no removerByToken) collapses matching variants", () => {
		const store = ["light", "Light Armor", "heavy"];
		const picker = new CharacterSheetProfPicker({
			suggestions: ["light", "medium", "heavy", "shields"],
			getCurrent: () => store.slice(),
			adder: (v) => store.push(v),
			remover: (v) => { const i = store.indexOf(v); if (i >= 0) store.splice(i, 1); },
			normalize: (v) => String(v).toLowerCase().startsWith("light") ? "light" : String(v).toLowerCase(),
			allowFreeText: false,
		});
		picker.removeItem("light");
		expect(store).toEqual(["heavy"]);
	});
});

describe("CharacterSheetProfPicker — duplicate guard", () => {
	it("rejects a case/whitespace duplicate language without a second state entry", () => {
		const state = buildState();
		const picker = languagePicker(state);
		expect(picker.commit("Elvish")).toBe(true);
		expect(picker.commit("  elvish  ")).toBe(false);
		expect(state.getLanguages().filter(l => l.toLowerCase() === "elvish").length).toBe(1);
	});

	it("rejects re-adding an armor token already present", () => {
		const state = buildState();
		const picker = armorPicker(state);
		expect(picker.commit("Light Armor")).toBe(true);
		expect(picker.commit("light")).toBe(false);
		expect(state.getArmorProficiencies().filter(a => state._normalizeArmorProfToken(a) === "light").length).toBe(1);
	});
});

describe("CharacterSheetProfPicker — keyboard highlight navigation", () => {
	it("clampHighlight keeps the index within [-1, len-1]", () => {
		expect(CharacterSheetProfPicker.clampHighlight(5, 3)).toBe(2);
		expect(CharacterSheetProfPicker.clampHighlight(-3, 3)).toBe(-1);
		expect(CharacterSheetProfPicker.clampHighlight(1, 3)).toBe(1);
		expect(CharacterSheetProfPicker.clampHighlight(0, 0)).toBe(-1);
	});

	it("moveHighlight walks and wraps around the last-rendered list", () => {
		const state = buildState();
		const picker = languagePicker(state); // 4 suggestions, none present
		picker._lastFiltered = picker.getFilteredSuggestions(""); // simulate a render
		expect(picker.moveHighlight(1)).toBe(0);
		expect(picker.moveHighlight(1)).toBe(1);
		expect(picker.moveHighlight(-1)).toBe(0);
		expect(picker.moveHighlight(-1)).toBe(3); // wraps to end
		expect(picker.moveHighlight(1)).toBe(0); // wraps to start
	});

	it("moveHighlight is a no-op when there is nothing to highlight", () => {
		const picker = languagePicker(buildState());
		picker._lastFiltered = [];
		expect(picker.moveHighlight(1)).toBe(-1);
	});
});

describe("CharacterSheetProfPicker — play-mode regression (canonical armor token)", () => {
	// Guards the old play-mode bug: raw `_data.armorProficiencies = [...]` stored
	// friendly labels that hasArmorProficiency() never matched. Routing through the
	// picker's adder (addArmorProficiencyCanonical) fixes it.
	it("stores the canonical token and clears the non-proficiency penalty", () => {
		const state = buildState();
		state.setArmor({name: "Studded Leather", ac: 12, type: "light"});
		expect(state.isWearingNonProficientArmor()).toBe(true);

		const picker = armorPicker(state);
		picker.commit("Light Armor");

		expect(state.getArmorProficiencies()).toContain("light");
		expect(state.isWearingNonProficientArmor()).toBe(false);
	});
});
