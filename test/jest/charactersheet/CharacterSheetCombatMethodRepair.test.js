/**
 * Combat-method marker repair — re-hydrating manually-learned TGTT combat methods
 * whose structured entity markers were lost on save.
 *
 * Root cause of the "Doubleshot does nothing" report (#14) and a major part of the
 * "Combat Methods management completely bugged" report (#6): some manually-learned
 * methods are stored as a bare `{featureType:"Optional Feature"}` with no
 * `_entityType`/`tradition`/`degree`/`staminaCost` and `optionalFeatureTypes:null`.
 * They fail `CharacterSheetClassUtils.isCombatMethod`, so `getCombatMethods()` drops
 * them silently — they can't be managed or activated (Doubleshot can never even fire).
 *
 * Validated against the REAL Fighter 9 TGTT Arcane Archer repro fixture (D_kaios Petri),
 * whose `_data.features` contains the bug in five methods (Shrug It Off, Warding Wield,
 * Doubleshot, Covering Fire, Quickdraw) alongside correctly-stored siblings.
 *
 * `_repairCombatMethodMarkers()` re-attaches the structured fields from the canonical
 * combat-method catalog on an EXACT name|source match to a `combatMethod` entity. It is
 * catalog-gated (no-op until `setCombatMethodCatalog`), idempotent, never converts a
 * Battle Tactic (BT) / Arcane Shot (AS) optionalfeature, and persists the repair so
 * `toJson()` keeps it.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "dkaios-petri-fighter9-arcanearcher.json");

// The five methods stored in the repro WITHOUT entity markers — silently dropped pre-fix.
const MALFORMED_NAMES = ["Shrug It Off", "Warding Wield", "Doubleshot", "Covering Fire", "Quickdraw"];

// Minimal, faithful combat-method catalog. tradition / staminaCost / actionType mirror
// the repro's own description text; degree is a plausible internally-consistent value.
const CATALOG = [
	{name: "Shrug It Off", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Reaction (2 Stamina Points). You defy weakness."]},
	{name: "Warding Wield", source: "TGTT", tradition: "Adamant Mountain", degree: 1, staminaCost: 1, actionType: "bonus action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Bonus Action (1 Stamina Point). Your AC increases by 2."]},
	{name: "Doubleshot", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Bonus Action (1 Stamina Point). The next ranged weapon attack you make uses two missiles instead of one. On a hit, you deal an additional weapon damage die."]},
	{name: "Covering Fire", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 1, actionType: "action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Action (1 Stamina Point). Choose a number of creatures equal to your proficiency bonus."]},
	{name: "Quickdraw", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 2, actionType: "reaction", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Reaction (2 Stamina Points). When initiative is rolled you can draw a weapon and make a ranged attack."]},
];

const loadRepro = () => {
	const json = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
};

const methodNames = state => new Set(state.getCombatMethods().map(m => m.name));
const findFeature = (state, name) => state._data.features.find(f => f.name === name);

describe("Combat-method marker repair (repro: D_kaios Petri, Fighter 9 TGTT Arcane Archer)", () => {
	it("repro precondition: the five methods are stored malformed (no markers)", () => {
		const state = loadRepro();
		for (const name of MALFORMED_NAMES) {
			const f = findFeature(state, name);
			expect(f).toBeDefined();
			expect(f._entityType).toBeFalsy();
			expect(f.tradition).toBeFalsy();
			expect(f.staminaCost).toBeFalsy();
			expect(CharacterSheetClassUtils.isCombatMethod(f)).toBe(false);
		}
	});

	it("BEFORE repair (no catalog set): getCombatMethods() drops all five", () => {
		const state = loadRepro();
		const names = methodNames(state);
		for (const name of MALFORMED_NAMES) expect(names.has(name)).toBe(false);
		// Sanity: correctly-stored siblings still surface, so the surface itself works.
		expect(names.has("Catch Your Breath")).toBe(true);
		expect(names.has("Point Blank Shot")).toBe(true);
	});

	it("direct _repairCombatMethodMarkers() resurfaces all five with correct fields", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(CATALOG);
		state._repairCombatMethodMarkers();

		const methods = state.getCombatMethods();
		const byName = new Map(methods.map(m => [m.name, m]));
		for (const cat of CATALOG) {
			const m = byName.get(cat.name);
			expect(m).toBeDefined();
			expect(m.staminaCost).toBe(cat.staminaCost);
			expect(m.degree).toBe(cat.degree);
			// tradition surfaces as the two/three-letter code via getMethodTraditionCode
			expect(m.tradition).toBe(CharacterSheetClassUtils.getTraditionCode(cat.tradition));
		}
	});

	it("the repaired features now satisfy isCombatMethod and _parseCombatMethodEffects", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(CATALOG);
		state._repairCombatMethodMarkers();

		const doubleshot = findFeature(state, "Doubleshot");
		expect(CharacterSheetClassUtils.isCombatMethod(doubleshot)).toBe(true);
		expect(doubleshot._entityType).toBe("combatMethod");
		expect(doubleshot.staminaCost).toBe(1);

		const parsed = state._parseCombatMethodEffects(doubleshot);
		expect(parsed.staminaCost).toBe(1);
		expect(parsed.degree).toBe(1);
		expect(parsed.tradition).toBe(CharacterSheetClassUtils.getTraditionCode("Biting Zephyr"));
		// Doubleshot's "additional weapon damage die" rider is parsed from its description.
		expect(parsed.bonusDamage).toEqual({die: "weapon", condition: null});
	});

	it("repair fires through the public applyClassFeatureEffects() reconcile path", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(CATALOG);
		// Mirrors the page flow: catalog is set after load, then effects reapply runs the
		// catalog-gated repair (hooked immediately before reconcileGrantedCombatMethods).
		state.applyClassFeatureEffects();

		const names = methodNames(state);
		for (const name of MALFORMED_NAMES) expect(names.has(name)).toBe(true);
	});

	it("never converts Battle Tactic (BT) or Arcane Shot (AS) optionalfeatures", () => {
		const state = loadRepro();
		// Add a BT/AS entry that name+source-collides with a combat-method catalog entry to
		// prove the guard wins even on a name match.
		const decoyCatalog = [
			...CATALOG,
			{name: "High Ground", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, _entityType: "combatMethod"},
			{name: "Grasping Arrow", source: "XGE", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, _entityType: "combatMethod"},
		];
		state.setCombatMethodCatalog(decoyCatalog);
		state._repairCombatMethodMarkers();

		const highGround = findFeature(state, "High Ground");
		const graspingArrow = findFeature(state, "Grasping Arrow");
		expect(highGround._entityType).toBeFalsy();
		expect(graspingArrow._entityType).toBeFalsy();
		expect(CharacterSheetClassUtils.isCombatMethod(highGround)).toBe(false);
		expect(CharacterSheetClassUtils.isCombatMethod(graspingArrow)).toBe(false);

		const names = methodNames(state);
		expect(names.has("High Ground")).toBe(false);
		expect(names.has("Grasping Arrow")).toBe(false);
	});

	it("is catalog-gated: a no-catalog repair is a no-op", () => {
		const state = loadRepro();
		state._repairCombatMethodMarkers(); // no catalog set
		for (const name of MALFORMED_NAMES) {
			expect(CharacterSheetClassUtils.isCombatMethod(findFeature(state, name))).toBe(false);
		}
	});

	it("is idempotent: repairing twice adds no duplicate features and keeps markers stable", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(CATALOG);

		state._repairCombatMethodMarkers();
		const afterFirst = state.getCombatMethods().filter(m => MALFORMED_NAMES.includes(m.name));
		const featureCount1 = state._data.features.length;
		const doubleshot1 = {...findFeature(state, "Doubleshot")};

		state._repairCombatMethodMarkers();
		const afterSecond = state.getCombatMethods().filter(m => MALFORMED_NAMES.includes(m.name));
		const featureCount2 = state._data.features.length;
		const doubleshot2 = findFeature(state, "Doubleshot");

		expect(afterSecond.length).toBe(afterFirst.length);
		expect(featureCount2).toBe(featureCount1);
		// No duplicate Doubleshot features introduced.
		expect(state._data.features.filter(f => f.name === "Doubleshot").length).toBe(1);
		// Markers unchanged on the second pass.
		expect(doubleshot2._entityType).toBe(doubleshot1._entityType);
		expect(doubleshot2.staminaCost).toBe(doubleshot1.staminaCost);
		expect(doubleshot2.degree).toBe(doubleshot1.degree);
		expect(doubleshot2.tradition).toBe(doubleshot1.tradition);
	});

	it("persists the repair across a toJson -> load round-trip", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(CATALOG);
		state._repairCombatMethodMarkers();

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		// Catalog NOT re-set on the reloaded state: the repaired markers must already be
		// baked into the saved features so the methods surface without re-repair.
		const names = methodNames(reloaded);
		for (const name of MALFORMED_NAMES) expect(names.has(name)).toBe(true);
	});
});
