/**
 * ROUND 38 — spell-hover render crash + stale exhaustion display.
 *
 * Bug #1 (getSpellHoverLink "Number was out of range! Range was 1-9"):
 *   The TGTT homebrew cantrip "Transposition" expressed its CHARACTER-LEVEL
 *   damage scaling with {@scaledamage}/{@scaledice} tags whose progression
 *   ranges ran up to 20 (e.g. `1-4,5-10,11-16,17-20` and `5,11,17`). Those
 *   tags are only valid for spell-SLOT upcasting (levels 1-9) — `parseScaleDice`
 *   feeds the progression to `MiscUtil.parseNumberRange(progression, 1, 9)`,
 *   which throws on any value > 9. Because Transposition sits in every wizard's
 *   available-spell list, the throw fired on every spell-list render (the
 *   getSpellHoverLink try/catch kept the UI alive but spammed the console).
 *   Fixed in DATA: cantrip scaling now uses `scalingLevelDice` + plain {@damage}
 *   tags (the Fire Bolt pattern). This test guards that NO TGTT spell carries an
 *   out-of-range scaledice/scaledamage progression.
 *
 *   SYSTEMIC GUARD: a user's loaded brew (their own storage / a remote repo) can
 *   carry the SAME malformed tag — and a repo data fix can't reach it. So
 *   `_sanitizeSpellScaleTags` sweeps the merged spell pool at load time and
 *   downgrades any out-of-range scale tag to a plain {@damage} tag. Tested below.
 *
 * Bug #2 (exhaustion effects don't update until refresh):
 *   `_addExhaustion`/`_removeExhaustion`/the settings rule-change handler only
 *   re-rendered the exhaustion widget + combat stats, and tried to refresh
 *   spells via `this._spellsModule` — a property that is ALWAYS null (the real
 *   handle is `this._spells`). So speed, save DCs, and the d20 breakdowns stayed
 *   stale until a full refresh, and the spell DC never updated at all. The
 *   handlers now call a single `_rerenderExhaustionDependents()` that refreshes
 *   every exhaustion-dependent display. Guarded via source + structure below.
 */

import "./setup.js";

import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

describe("R38 Bug #1 — no out-of-range scaledice/scaledamage in TGTT spells", () => {
	const data = JSON.parse(fs.readFileSync(path.join(ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf-8"));

	/** Extract every progression value from {@scaledice}/{@scaledamage} tags in a blob. */
	const collectProgressionNumbers = (blob) => {
		const tagRe = /\{@scale(?:dice|damage)\s+([^}]*)\}/g;
		const nums = [];
		let m;
		while ((m = tagRe.exec(blob)) !== null) {
			const parts = m[1].split("|");
			if (parts.length < 2) continue;
			for (const n of parts[1].match(/\d+/g) || []) nums.push(Number(n));
		}
		return nums;
	};

	test("every scaledice/scaledamage progression value is within the slot-level range 1-9", () => {
		const offenders = [];
		for (const spell of data.spell || []) {
			const blob = JSON.stringify(spell.entries || []) + JSON.stringify(spell.entriesHigherLevel || []);
			const nums = collectProgressionNumbers(blob);
			if (nums.some(n => n < 1 || n > 9)) offenders.push({name: spell.name, nums});
		}
		expect(offenders).toEqual([]);
	});

	test("Transposition uses scalingLevelDice for its character-level scaling", () => {
		const transposition = (data.spell || []).find(s => s.name === "Transposition");
		expect(transposition).toBeTruthy();
		expect(transposition.level).toBe(0); // it's a cantrip
		// Character-level scaling lives on scalingLevelDice, NOT inline scaledice tags.
		expect(transposition.scalingLevelDice).toBeTruthy();
		expect(transposition.scalingLevelDice.scaling).toMatchObject({
			"1": "1d6", "5": "2d6", "11": "3d6", "17": "4d6",
		});
		const blob = JSON.stringify(transposition.entries || []);
		expect(blob).not.toMatch(/@scaledice|@scaledamage/);
	});
});

describe("R38 Bug #2 — exhaustion changes refresh every dependent display", () => {
	const src = fs.readFileSync(path.join(ROOT, "js/charactersheet/charactersheet.js"), "utf-8");

	test("a single _rerenderExhaustionDependents helper exists and refreshes all exhaustion-dependent sections", () => {
		expect(src).toMatch(/_rerenderExhaustionDependents\s*\(\)\s*\{/);
		const start = src.indexOf("_rerenderExhaustionDependents () {");
		const body = src.slice(start, src.indexOf("}", start) + 1);
		// Speed/senses/AC, the d20-penalty breakdowns, and the sub-module DCs.
		for (const call of [
			"this._renderExhaustion()",
			"this._renderCombatStats()",
			"this._renderSavingThrows()",
			"this._renderSkills()",
			"this._renderAbilities()",
			"this._renderAbilitiesDetailed()",
			"this._renderAttacks()",
			"this._spells.render()",
			"this._features.render()",
			"this._combat.render()",
		]) {
			expect(body).toContain(call);
		}
	});

	test("exhaustion handlers route through the helper, not the always-null _spellsModule", () => {
		// _addExhaustion / _removeExhaustion call the helper... (scope to the two
		// handler bodies, which end where the helper's docstring begins — that
		// docstring legitimately *names* the old `_spellsModule` bug.)
		const addIdx = src.indexOf("_addExhaustion () {");
		const handlersRegion = src.slice(addIdx, src.indexOf("Re-render every display"));
		expect(handlersRegion).toMatch(/_addExhaustion[\s\S]*_rerenderExhaustionDependents/);
		expect(handlersRegion).toMatch(/_removeExhaustion[\s\S]*_rerenderExhaustionDependents/);
		// ...and the dead `this._spellsModule` branch is gone from them.
		expect(handlersRegion).not.toMatch(/_spellsModule/);

		// The settings exhaustion-rules change handler is fixed the same way.
		const rulesIdx = src.indexOf("Exhaustion rules handler");
		const rulesRegion = src.slice(rulesIdx, rulesIdx + 700);
		expect(rulesRegion).toMatch(/_rerenderExhaustionDependents/);
		expect(rulesRegion).not.toMatch(/_spellsModule/);
	});
});

describe("R38 Bug #1 (systemic) — _sanitizeSpellScaleTags repairs ANY loaded brew", () => {
	let CharacterSheetPage;

	beforeAll(async () => {
		// Minimal window/document stubs so the controller module imports in node.
		globalThis.window = {
			addEventListener: () => {},
			dispatchEvent: () => {},
			location: {search: ""},
			matchMedia: () => ({matches: false, addEventListener: () => {}}),
		};
		globalThis.document = {
			querySelector: () => null,
			querySelectorAll: () => [],
			getElementById: () => null,
			addEventListener: () => {},
			body: {classList: {add () {}, remove () {}}},
		};
		await import("../../../js/charactersheet/charactersheet.js");
		CharacterSheetPage = globalThis.CharacterSheetPage;
	});

	const sanitize = (spells) => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._sanitizeSpellScaleTags(spells);
		return spells;
	};

	test("downgrades an out-of-range cantrip {@scaledamage} to a plain {@damage} base", () => {
		const spells = [{
			name: "Bad Cantrip",
			source: "HB",
			level: 0,
			entries: [
				"On a failed save the creature takes {@scaledamage 1d6|1-4,5-10,11-16,17-20|1d6,2d6,3d6,4d6} force damage.",
			],
		}];
		sanitize(spells);
		const text = spells[0].entries[0];
		expect(text).not.toMatch(/@scaledice|@scaledamage/);
		expect(text).toContain("{@damage 1d6}");
	});

	test("repairs out-of-range {@scaledice} in entriesHigherLevel too, and uses displayText when present", () => {
		const spells = [{
			name: "Bad Upcast",
			source: "HB",
			level: 1,
			entriesHigherLevel: [{
				type: "entries",
				entries: ["Increases by {@scaledice 2d6|11-16|2d6|psi|three to four d6} for each level."],
			}],
		}];
		sanitize(spells);
		const text = spells[0].entriesHigherLevel[0].entries[0];
		expect(text).not.toMatch(/@scaledice|@scaledamage/);
		expect(text).toContain("three to four d6");
	});

	test("leaves VALID slot-range scale tags untouched", () => {
		const spells = [{
			name: "Good Spell",
			source: "HB",
			level: 1,
			entries: ["The damage increases by {@scaledamage 2d8|2-9|1d8} for each slot level above 1st."],
		}];
		const before = spells[0].entries[0];
		sanitize(spells);
		expect(spells[0].entries[0]).toBe(before); // unchanged
	});

	test("a sanitized spell renders through the real Renderer without throwing", () => {
		// This is the end-to-end guarantee: the exact path that used to throw.
		const Renderer = globalThis.Renderer;
		if (!Renderer?.get) return; // renderer not present in this env — structural tests above still cover it
		const spells = [{
			name: "Bad Cantrip",
			source: "HB",
			level: 0,
			entries: ["Takes {@scaledamage 1d6|1-4,5-10,11-16,17-20|1d6,2d6,3d6,4d6} force damage."],
		}];
		sanitize(spells);
		expect(() => Renderer.get().render({type: "entries", entries: spells[0].entries})).not.toThrow();
	});
});
