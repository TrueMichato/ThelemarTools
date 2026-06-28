/**
 * Combat Methods count display (ROUND 33 BUG #2).
 *
 * The combat methods PICKER modal already shows `Known: N / M`, but the Combat
 * tab's Combat Methods *section* stats row showed only Method DC + Stamina — the
 * user could never see how many of their cap they had learned without opening the
 * picker. The fix adds a `Methods: <current>/<max>` mini-stat to BOTH stats rows
 * (the main read-only `#charsheet-combat-methods-stats` and the combat-tab
 * `#charsheet-combat-methods-tab-stats`), populated by `renderCombatMethods()`.
 *
 * This test refuses a false green: it drives the REAL `renderCombatMethods()`
 * render path against the REAL Fighter 9 TGTT Arcane Archer repro fixture
 * (D_kaios Petri v2 — all 14 techniques surface as combat methods), with a
 * `document.getElementById` map of `e_` stub elements, and asserts the actual
 * count elements receive `"14 / 10"`. `max === 10` is itself proof the subclass
 * bonus is counted: the class CTM progression caps a Fighter 9 at 9 methods, and
 * the Arcane Archer subclass adds +1 → 10 (max > raw class progression).
 *
 * RED  (before the html/render change): the count elements do not exist in the
 *      stat rows, so they are never populated (textContent stays "").
 * GREEN (after the change): both `#charsheet-methods-count` and
 *      `#charsheet-methods-count-tab` read `"14 / 10"`.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

// `charactersheet-combat.js` wires `document` listeners at construction; provide a
// minimal document so the module imports cleanly (we override getElementById per-test).
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");
const COMBAT_SRC_PATH = path.resolve(__dirnameLocal, "../../../js/charactersheet/charactersheet-combat.js");
const HTML_PATH = path.resolve(__dirnameLocal, "../../../charactersheet.html");

// Faithful Fighter TGTT class data: the real Combat Methods optionalfeatureProgression
// (extracted from homebrew/TravelersGuidetoThelemar.json). Level 9 → 9 base methods.
const FIGHTER_TGTT_CLASS = {
	name: "Fighter",
	source: "TGTT",
	optionalfeatureProgression: [
		{
			name: "Combat Methods",
			featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
			progression: {"1": 3, "2": 4, "3": 4, "4": 5, "5": 6, "6": 7, "7": 7, "8": 8, "9": 9, "10": 10, "11": 10, "12": 11, "13": 12, "14": 13, "15": 13, "16": 14, "17": 15, "18": 16, "19": 16, "20": 17},
		},
	],
};

const loadState = () => {
	const json = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
};

/** A document whose getElementById returns a fresh `e_` stub per id (so textContent is readable). */
const makeDocStub = () => {
	const els = new Map();
	return {
		_els: els,
		getElementById (id) {
			if (!els.has(id)) els.set(id, globalThis.e_({outer: `<span></span>`}));
			return els.get(id);
		},
		addEventListener () {},
		removeEventListener () {},
		querySelector () { return null; },
	};
};

const makeCombat = (state, doc) => {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {getClasses: () => [FIGHTER_TGTT_CLASS]};
	// Rendering helpers not under test — keep them inert so we isolate the count logic.
	combat._renderMethodsToContainer = () => {};
	combat._updateStaminaDisplay = () => {};
	combat._getMethodTradition = (m) => CharacterSheetClassUtils.getTraditionCode(m.tradition) || "BZ";
	return combat;
};

describe("renderCombatMethods — Methods count mini-stat (Fighter 9 TGTT Arcane Archer)", () => {
	it("sanity: the loaded fixture has 14 known combat methods", () => {
		const state = loadState();
		const known = state.getFeatures().filter(f => CharacterSheetClassUtils.isCombatMethod(f)).length;
		expect(known).toBe(14);
	});

	it("max counts the Arcane Archer subclass +1 on top of the class progression", () => {
		const state = loadState();
		const combat = makeCombat(state, makeDocStub());

		// Class CTM progression caps a Fighter 9 at 9 methods; Arcane Archer adds +1.
		const RAW_CLASS_MAX = FIGHTER_TGTT_CLASS.optionalfeatureProgression[0].progression["9"];
		expect(RAW_CLASS_MAX).toBe(9);

		const max = combat._getCharacterMaxMethods();
		expect(max).toBe(10);
		// Proof the subclass bonus is included (not just the raw class number).
		expect(max).toBeGreaterThan(RAW_CLASS_MAX);
	});

	it("populates BOTH count elements with known / max (14 / 10)", () => {
		const state = loadState();
		const doc = makeDocStub();
		globalThis.document = doc;
		const combat = makeCombat(state, doc);

		combat.renderCombatMethods();

		const tabCount = doc.getElementById("charsheet-methods-count-tab");
		const mainCount = doc.getElementById("charsheet-methods-count");

		expect(tabCount.textContent).toBe("14 / 10");
		expect(mainCount.textContent).toBe("14 / 10");
	});

	it("RED proof: with no count elements present the count is never shown; GREEN proof: the ids exist in both stat rows", () => {
		// The render path only writes the count when the element exists (guarded by
		// `if (methodsCountDisplay)`); the elements come from the html stat rows. So
		// the count display is wholly contingent on the html having the new ids.
		const html = fs.readFileSync(HTML_PATH, "utf8");

		// Main read-only stats row.
		const mainRow = html.slice(html.indexOf(`id="charsheet-combat-methods-stats"`));
		expect(mainRow).toContain(`id="charsheet-methods-count"`);

		// Combat-tab stats row.
		const tabRow = html.slice(html.indexOf(`id="charsheet-combat-methods-tab-stats"`));
		expect(tabRow).toContain(`id="charsheet-methods-count-tab"`);

		// And the render code targets exactly those ids.
		const src = fs.readFileSync(COMBAT_SRC_PATH, "utf8");
		expect(src).toContain(`getElementById("charsheet-methods-count")`);
		expect(src).toContain(`getElementById("charsheet-methods-count-tab")`);
	});

	it("shows 0 / max in the access-but-no-methods-yet branch (∞ when max is 0)", () => {
		// A class with combat-method ACCESS but zero known methods keeps the tab section
		// visible; the count must read 0 / <max>. Strip the known methods to reach that branch.
		const state = loadState();
		state._data.features = state._data.features.filter(f => !CharacterSheetClassUtils.isCombatMethod(f));

		const doc = makeDocStub();
		globalThis.document = doc;
		const combat = makeCombat(state, doc);

		combat.renderCombatMethods();

		const tabCount = doc.getElementById("charsheet-methods-count-tab");
		expect(tabCount.textContent).toBe("0 / 10");
	});
});
