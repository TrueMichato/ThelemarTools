/**
 * Round 35 — Fighter subclass combat-tradition pools are ADDITIVE in the picker.
 *
 * USER DECISION (authoritative): the base Fighter free tradition choice (all
 * traditions) must stay available; a subclass's locked grants and its choice pool
 * are ADDITIVE on top — you can always pick MORE traditions in the combat-tab
 * tradition editor.
 *
 * Bug: `_getTraditionSelectionModel` (charactersheet-combat.js) treated a Fighter
 * subclass choice pool flagged `replacesBase: true` (Arcane Archer → BZ/RE/UW/UH,
 * Champion, Banneret, Battle Master) as EXCLUSIVE — it `continue`d past the base
 * Fighter "all traditions" list, so an Arcane Archer who already knew Adamant
 * Mountain / Sanguine Knot methods (chosen at L1-2, before subclassing) could not
 * keep or add them. The repro fixture (D_kaios Petri) is exactly this case.
 *
 * Fix: the post-hoc combat-tab picker always includes the base available list; the
 * subclass pool + locked grants are surfaced additively. (`replacesBase` /
 * `shouldSuppressBaseTraditionPicker` are unchanged — they only suppress the
 * DUPLICATE base picker at subclass-selection time in QuickBuild/LevelUp.)
 *
 * RED→GREEN: restore the `if (pool.replacesBase) continue;` and the Arcane Archer
 * `choosableCodes` collapses back to BZ/RE/UW/UH (AM/SK disappear) — these tests fail.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

let CharacterSheetState;
let CharacterSheetCombat;
let ClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-combat.js");
	CharacterSheetCombat = globalThis.CharacterSheetCombat;
	ClassUtils = globalThis.CharacterSheetClassUtils;
});

// Faithful Fighter page stub: a TGTT Fighter whose Combat Methods progression uses the
// generic degree-only CTM codes (so the base available list resolves to ALL traditions).
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {
		getOptionalFeatures: () => [],
		getClassFeatures: () => [],
		getClasses: () => [{
			name: "Fighter",
			source: "TGTT",
			optionalfeatureProgression: [{name: "Combat Methods", featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], progression: {"1": 1}}],
		}],
	};
	return combat;
}

describe("Round 35 — additive Fighter subclass tradition pools (combat-tab picker)", () => {
	test("Arcane Archer can choose AM and SK (outside the BZ/RE/UW/UH pool)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9, subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}});
		const combat = makeCombat(state);

		// The dikaios Arcane Archer already knows AM + SK methods chosen before subclassing.
		const model = combat._getTraditionSelectionModel(["BZ", "RE", "AM", "SK"]);

		// Additive: the subclass pool is included AND the base (all) list is available, so
		// AM and SK are choosable rather than dumped into the "Other" fallback group.
		expect(model.choosableCodes).toEqual(expect.arrayContaining(["BZ", "RE", "UW", "UH", "AM", "SK"]));
		// The full base list (every tradition) is choosable — not just the 4-code pool.
		expect(model.choosableCodes.length).toBe(ClassUtils.getAllTraditions().length);

		// AM and SK surface in the live "available" group (selectable), not "other".
		const availCodes = (model.groups.find(g => g.key === "available")?.traditions || []).map(t => t.code);
		expect(availCodes).toEqual(expect.arrayContaining(["AM", "SK"]));
	});

	test("a fresh Arcane Archer (no prior picks) can still reach AM/SK in the picker", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9, subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}});
		const combat = makeCombat(state);
		const model = combat._getTraditionSelectionModel([]);
		expect(model.choosableCodes).toEqual(expect.arrayContaining(["AM", "SK"]));
	});

	test("locked subclass-granted traditions stay locked/checked while the pool is additive", () => {
		// Cavalier grants Gallant Heart (GH) and Spirited Steed (SS) as FIXED (non-choice)
		// traditions → both locked.
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9, subclass: {name: "Cavalier", shortName: "Cavalier", source: "TGTT"}});
		const combat = makeCombat(state);

		const model = combat._getTraditionSelectionModel([]);
		const granted = model.groups.find(g => g.key === "granted");
		expect(granted).toBeDefined();
		const gh = granted.traditions.find(t => t.code === "GH");
		expect(gh).toBeDefined();
		expect(gh.locked).toBe(true);
		expect(granted.traditions.every(t => t.locked)).toBe(true);
		expect(model.selected).toContain("GH");
		// Additive base list is still fully choosable alongside the locked grants
		// (every tradition minus the locked ones).
		expect(model.choosableCodes.length).toBe(ClassUtils.getAllTraditions().length - granted.traditions.length);
	});
});
