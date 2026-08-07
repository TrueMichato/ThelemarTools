/**
 * R21 — Interdict Boon effect surfacing/application + boon-vs-feat-picker gating.
 *
 * Bug #8: every KNOWN Interdict Boon must surface its mechanical effect (computed summary)
 *         AND, where the effect lands on the character's own sheet (Soul Eater temp HP),
 *         actually apply it. The four live-toggle / narrative boons that previously returned
 *         `null` from the summary map now carry real labels so they still surface after the
 *         active-state toggles are removed.
 * Bug #10: Interdict Boons (`ItdBoon`) must NOT be offered in the generic feat / epic-boon
 *          picker. The L19 epic-boon slot is gated by a single shared, source-aware helper so
 *          a homebrew sub-source (e.g. "TGTT-IllR") gets a normal ASI/Feat, matching level-up.
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => readFileSync(resolve(__dirname, rel), "utf8");
const COMBAT_SRC = readSrc("../../../js/charactersheet/charactersheet-combat.js");
const QUICKBUILD_SRC = readSrc("../../../js/charactersheet/charactersheet-quickbuild.js");
const LEVELUP_SRC = readSrc("../../../js/charactersheet/charactersheet-levelup.js");

function buildIllrigger (level = 10, {cha} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level});
	if (cha != null) state._data.abilities.cha = cha;
	return state;
}

/** Add a chosen Interdict Boon exactly as the level-up/quick-build wizard stores it. */
function addBoon (state, name) {
	state._data.features.push({name, featureType: ["ItdBoon"], source: "TGTT-IllR"});
	return state;
}

// ==========================================================================
// Bug #8 — toggle/narrative boon summaries (previously null) now surface
// ==========================================================================
describe("R21 #8 — previously-null boon summaries now surface a label", () => {
	const CASES = [
		{boon: "Hellish Frenzy", level: 10, match: /AC/},
		{boon: "Shadow Shroud", level: 10, match: /AC/},
		{boon: "Hellsight", level: 10, match: /Truesight 60/},
		{boon: "Veil of Lies", level: 10, match: /Invisible/},
	];

	test.each(CASES)("$boon surfaces a non-empty effect label", ({boon, level, match}) => {
		const state = buildIllrigger(level);
		addBoon(state, boon);
		const feature = state.getInterdictBoons().find(b => b.name === boon);
		const summary = state.getFeatureEffectSummary(feature);
		expect(summary).toBeTruthy();
		expect(summary).toMatch(match);
	});
});

// ==========================================================================
// Bug #8 — discrete on-sheet activation (Soul Eater temp HP)
// ==========================================================================
describe("R21 #8 — Interdict Boon activation applies on-sheet effects", () => {
	test("Soul Eater exposes an activation; others do not", () => {
		const state = buildIllrigger(10);
		expect(state.hasInterdictBoonActivation("Soul Eater")).toBe(true);
		expect(state.hasInterdictBoonActivation("Veil of Lies")).toBe(false);
		expect(state.hasInterdictBoonActivation("Not A Boon")).toBe(false);
	});

	test("applying Soul Eater grants temp HP equal to Illrigger level", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Soul Eater");
		expect(state.getTempHp()).toBe(0);
		const res = state.applyInterdictBoonActivation("Soul Eater");
		expect(res).toMatchObject({label: expect.stringContaining("10 temporary HP")});
		expect(state.getTempHp()).toBe(10);
	});

	test("temp HP do not stack — re-applying keeps the higher value", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Soul Eater");
		state.setTempHp(15);
		state.applyInterdictBoonActivation("Soul Eater"); // would grant 10
		expect(state.getTempHp()).toBe(15);
	});

	test("activation scales with level", () => {
		const state = buildIllrigger(17);
		addBoon(state, "Soul Eater");
		state.applyInterdictBoonActivation("Soul Eater");
		expect(state.getTempHp()).toBe(17);
	});

	test("activating a boon without an on-sheet effect is a no-op (null)", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Veil of Lies");
		expect(state.applyInterdictBoonActivation("Veil of Lies")).toBeNull();
	});
});

// ==========================================================================
// Bug #8 — combat Interdiction panel wiring (no false-green: assert source)
// ==========================================================================
describe("R21 #8 — combat panel surfaces summaries + working Apply button", () => {
	test("renderCombatInterdiction surfaces the computed effect summary", () => {
		expect(COMBAT_SRC).toMatch(/getFeatureEffectSummary\?\.\(b, calcs\)/);
		expect(COMBAT_SRC).toMatch(/charsheet__interdict-boon-effect/);
	});

	test("the dead 'not wired yet' expend-seal stub is gone", () => {
		expect(COMBAT_SRC).not.toMatch(/not wired yet/);
		expect(COMBAT_SRC).not.toMatch(/interdict-boon-expend/);
	});

	test("the Apply button is wired to applyInterdictBoonActivation", () => {
		expect(COMBAT_SRC).toMatch(/charsheet__interdict-boon-activate/);
		expect(COMBAT_SRC).toMatch(/applyInterdictBoonActivation\?\.\(boonName\)/);
		expect(COMBAT_SRC).toMatch(/hasInterdictBoonActivation\?\.\(b\.name\)/);
	});
});

// ==========================================================================
// Bug #10 — shared epic-boon-level gating helper
// ==========================================================================
describe("R21 #10 — isEpicBoonLevel is source-aware and shared", () => {
	test.each([
		["XPHB", 19, true],
		["TGTT", 19, true],
		["TGTT-IllR", 19, false], // Illrigger uses Interdict Boons, not epic-boon feats
		["PHB", 19, false],
		["XPHB", 18, false],
		["XPHB", 20, false],
	])("isEpicBoonLevel(%s, %i) === %s", (source, level, expected) => {
		expect(CharacterSheetClassUtils.isEpicBoonLevel(source, level)).toBe(expected);
	});

	test("both builders consume the shared helper (no divergent inline gating)", () => {
		expect(QUICKBUILD_SRC).toMatch(/CharacterSheetClassUtils\.isEpicBoonLevel\(classSource, classLevel\)/);
		expect(LEVELUP_SRC).toMatch(/CharacterSheetClassUtils\.isEpicBoonLevel\(classEntry\.source, newLevel\)/);
		// The old inline level-only / source-divergent checks are gone.
		expect(QUICKBUILD_SRC).not.toMatch(/isEpicBoon = classLevel === 19;/);
		expect(LEVELUP_SRC).not.toMatch(/newLevel === 19 && \(classEntry\.source === "XPHB"/);
	});

	test("both choice UIs consume the propagated ability max", () => {
		expect(LEVELUP_SRC).toMatch(/const\s+cap\s*=\s*abilityChoiceSpec\.max\s*\|\|\s*20/);
		expect(QUICKBUILD_SRC).toMatch(/const\s+cap\s*=\s*choices\.ability\.max\s*\|\|\s*20/);
		expect(QUICKBUILD_SRC).toMatch(/CharacterSheetClassUtils\.buildFeatChoicesSpec\(feat/);
	});

	test("both progression flows require the selected boon's ability choice", () => {
		expect(LEVELUP_SRC).toMatch(/selectedFeat\s*&&\s*!CharacterSheetClassUtils\.isFeatChoiceSpecComplete\(selectedFeat/);
		expect(QUICKBUILD_SRC).toMatch(/CharacterSheetClassUtils\.isFeatChoiceSpecComplete\(selectedFeat,/);
	});
});

// ==========================================================================
// Bug #10 — boons are excluded from the feat/epic-boon picker
// ==========================================================================
describe("R21 #10 — Interdict Boons never enter the feat/epic-boon picker", () => {
	test("isInterdictBoonEntry detects ItdBoon entries in any shape", () => {
		expect(CharacterSheetClassUtils.isInterdictBoonEntry({featureType: ["ItdBoon"]})).toBe(true);
		expect(CharacterSheetClassUtils.isInterdictBoonEntry({optionalFeatureTypes: ["ItdBoon"]})).toBe(true);
		expect(CharacterSheetClassUtils.isInterdictBoonEntry({optionalfeatureType: "ItdBoon"})).toBe(true);
		expect(CharacterSheetClassUtils.isInterdictBoonEntry({name: "Actor", category: "G"})).toBe(false);
		expect(CharacterSheetClassUtils.isInterdictBoonEntry(null)).toBe(false);
	});

	test("both builders filter the feat pool through the boon guard", () => {
		expect(QUICKBUILD_SRC).toMatch(/!CharacterSheetClassUtils\.isInterdictBoonEntry\(f\)/);
		expect(LEVELUP_SRC).toMatch(/!CharacterSheetClassUtils\.isInterdictBoonEntry\(f\)/);
	});
});

// ==========================================================================
// End-to-end on a representative Illrigger L10 (Soul Eater + Veil of Lies)
// — mirrors the real Hochling Hellspeaker character used to validate the bug.
// ==========================================================================
describe("R21 — representative Illrigger L10 (Soul Eater + Veil of Lies)", () => {
	function buildRepresentative () {
		const state = buildIllrigger(10);
		addBoon(state, "Soul Eater");
		addBoon(state, "Veil of Lies");
		return state;
	}

	test("known boons surface their effects", () => {
		const state = buildRepresentative();
		const calc = state.getFeatureCalculations();
		const soulEater = state.getInterdictBoons().find(b => b.name === "Soul Eater");
		const veil = state.getInterdictBoons().find(b => b.name === "Veil of Lies");
		expect(state.getFeatureEffectSummary(soulEater, calc)).toBe("Temp HP 10");
		expect(state.getFeatureEffectSummary(veil, calc)).toBeTruthy();
	});

	test("Soul Eater activation changes the sheet (temp HP 0 → 10)", () => {
		const state = buildRepresentative();
		expect(state.getTempHp()).toBe(0);
		state.applyInterdictBoonActivation("Soul Eater");
		expect(state.getTempHp()).toBe(10);
	});

	test("the character's class source is excluded from the L19 epic-boon slot", () => {
		expect(CharacterSheetClassUtils.isEpicBoonLevel("TGTT-IllR", 19)).toBe(false);
	});
});
