/**
 * S1 — TGTT Arcane Archer subclass-repair migration (bugs #4, #5, #6, #15).
 *
 * The repro character (`fixtures/arcaneArcherRepro.json`) is a Fighter 9 TGTT
 * Arcane Archer whose `classes[0].subclass === null` even though the Arcane
 * Archer subclass features are present in the flat `features[]` array. Before
 * the fix, every detector keyed on `cls.subclass` silently no-ops:
 *   - hasArcaneShot() → false   (gate for the Arcane Shot panel + synthetic resource)
 *   - getArcaneShotMax() → 0
 *   - getSyntheticCombatResources() omits the `arcaneShot` resource (bug #15)
 *   - _getCharacterMaxMethods() is short by the subclass +1 (bugs #5/#6)
 *
 * These tests LOAD the repro character through `loadFromJson` and assert the
 * REAL runtime mechanics — never a helper in isolation.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, join} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let CharacterSheetState;
let CharacterSheetCombat;
let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-combat.js");
	CharacterSheetCombat = globalThis.CharacterSheetCombat;
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
});

function loadRepro () {
	const json = JSON.parse(readFileSync(join(__dirname, "fixtures/arcaneArcherRepro.json"), "utf8"));
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
}

describe("S1 Arcane Archer subclass repair migration", () => {
	// =========================================================================
	// Resolver (pure static) — sanity on the embedded-feature reconstruction
	// =========================================================================
	describe("getSubclassFromFeatures resolver", () => {
		it("returns cls.subclass verbatim when already populated", () => {
			const sub = {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"};
			const cls = {name: "Fighter", source: "TGTT", subclass: sub};
			expect(CharacterSheetClassUtils.getSubclassFromFeatures(cls, [])).toBe(sub);
		});

		it("reconstructs {name, shortName, source} from embedded features (gain-level source wins)", () => {
			const cls = {name: "Fighter", source: "TGTT", subclass: null};
			const features = [
				{name: "Magic Arrow", isSubclassFeature: true, className: "Fighter", classSource: "TGTT", subclassName: "Arcane Archer", subclassShortName: "Arcane Archer", subclassSource: "XGE", level: 7},
				{name: "Arcane Archer", isSubclassFeature: true, className: "Fighter", classSource: "TGTT", subclassName: "Arcane Archer", subclassShortName: "Arcane Archer", subclassSource: "TGTT", level: 3},
			];
			const resolved = CharacterSheetClassUtils.getSubclassFromFeatures(cls, features);
			expect(resolved).toEqual({name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"});
		});

		it("returns null when embedded features reference more than one subclass (ambiguous)", () => {
			const cls = {name: "Fighter", source: "TGTT", subclass: null};
			const features = [
				{name: "A", isSubclassFeature: true, className: "Fighter", classSource: "TGTT", subclassShortName: "Arcane Archer", subclassSource: "TGTT", level: 3},
				{name: "B", isSubclassFeature: true, className: "Fighter", classSource: "TGTT", subclassShortName: "Champion", subclassSource: "TGTT", level: 3},
			];
			expect(CharacterSheetClassUtils.getSubclassFromFeatures(cls, features)).toBeNull();
		});

		it("does not pull a different class's subclass features (multiclass safety)", () => {
			const cls = {name: "Fighter", source: "TGTT", subclass: null};
			const features = [
				{name: "X", isSubclassFeature: true, className: "Rogue", classSource: "TGTT", subclassShortName: "Arcane Trickster", subclassSource: "TGTT", level: 3},
			];
			expect(CharacterSheetClassUtils.getSubclassFromFeatures(cls, features)).toBeNull();
		});
	});

	// =========================================================================
	// Migration heals the repro character at load time
	// =========================================================================
	describe("loadFromJson repair", () => {
		it("repairs the null subclass from embedded features", () => {
			const state = loadRepro();
			const cls = state.getClasses()[0];
			expect(cls.subclass).toBeTruthy();
			expect(cls.subclass.shortName).toBe("Arcane Archer");
			expect(cls.subclass.source).toBe("TGTT");
		});

		it("resolves the effective subclass", () => {
			const state = loadRepro();
			const cls = state.getClasses()[0];
			expect(state.getEffectiveSubclassForClass(cls)?.shortName).toBe("Arcane Archer");
		});

		// ----- bug #15: Arcane Shot panel + synthetic resource come back -----
		it("hasArcaneShot() is true after load", () => {
			expect(loadRepro().hasArcaneShot()).toBe(true);
		});

		it("getArcaneShotMax() equals the proficiency bonus (TGTT, L9 → +4)", () => {
			const state = loadRepro();
			expect(state.getProficiencyBonus()).toBe(4);
			expect(state.getArcaneShotMax()).toBe(4);
		});

		it("exposes the synthetic arcaneShot combat resource (bug #15)", () => {
			const state = loadRepro();
			const kinds = (state.getSyntheticCombatResources() || []).map(r => r.kind);
			expect(kinds).toContain("arcaneShot");
			const res = state.getSyntheticCombatResources().find(r => r.kind === "arcaneShot");
			expect(res.max).toBe(4);
		});

		// ----- bug #15: known Arcane Shot options surface in the panel -----
		it("surfaces the known Arcane Shot options (bug #15 panel content)", () => {
			const state = loadRepro();
			const names = (state.getKnownArcaneShots() || []).map(s => s.name).sort();
			expect(names).toEqual(["Grasping Arrow", "Seeking Arrow", "Shadow Arrow"]);
		});

		// ----- bug #6: known combat methods list surfaces -----
		it("surfaces the known combat methods (bug #6 management list)", () => {
			const state = loadRepro();
			const methods = state.getCombatMethods() || [];
			const names = methods.map(m => m.name);
			expect(methods.length).toBeGreaterThanOrEqual(9);
			expect(names).toEqual(expect.arrayContaining([
				"Catch Your Breath", "Countershot", "Missile Volley",
			]));
		});

		// ----- bug #5/#6: combat-method cap includes the subclass +1 -----
		it("_getCharacterMaxMethods includes the Arcane Archer +1 bonus method", () => {
			const state = loadRepro();
			const cls = state.getClasses()[0];

			const combat = Object.create(CharacterSheetCombat.prototype);
			combat._state = state;
			// Minimal page stub returning the class data with a CTM progression so the
			// real _getCharacterMaxMethods path runs end-to-end.
			combat._page = {
				getClasses: () => [{
					name: cls.name,
					source: cls.source,
					optionalfeatureProgression: [{
						name: "Combat Methods",
						featureType: ["CTM:F"],
						progression: {"1": 1, "3": 2, "5": 3, "9": 4},
					}],
				}],
			};

			const baseAtL9 = 4; // from the stubbed progression
			const bonus = CharacterSheetClassUtils.getSubclassBonusMethodCount(cls.subclass, cls.source);
			expect(bonus).toBe(1); // Arcane Archer grants +1
			expect(combat._getCharacterMaxMethods()).toBe(baseAtL9 + 1);
		});
	});
});
