/**
 * Round 35 — combat-method ATTRIBUTION persistence (TGTT Fighter).
 *
 * Report: after changing combat methods and reloading, "some methods are not
 * attributed". Verified against the REAL repro fixture `D_kaios_Petri_2_v2.json`
 * (Fighter 9 TGTT Arcane Archer): four methods are stored with
 * `_entityType:"combatMethod"` and the GENERIC `optionalFeatureTypes:["CTM:1".."CTM:5"]`
 * but NO `tradition` field — Lean Into It, Blindshot, Missile Volley, Countershot.
 * The generic CTM codes carry no tradition letter, so `getMethodTraditionCode`
 * returns `null` and those methods are un-attributed to a tradition forever.
 *
 * Two coupled root causes (both fixed here):
 *   (1a) `_addCombatMethod` (charactersheet-combat.js) dropped the structured markers
 *        (`tradition/degree/staminaCost/actionType/_entityType`) when persisting a
 *        learned method, so a freshly-learned method also lost its tradition on reload.
 *   (1b) `_repairCombatMethodMarkers` (charactersheet-state.js) early-`continue`d on any
 *        feature already recognised by `isCombatMethod`, so a recognised-but-
 *        tradition-less method was skipped and never backfilled from the catalog.
 *
 * RED→GREEN (each sub-change fails independently when reverted):
 *   - Revert 1b → the four methods still resolve `getMethodTraditionCode === null`
 *     after the production load order (the "repair backfills tradition" tests fail).
 *   - Revert 1a → a `_addCombatMethod` learn does not survive a toJson→reload with its
 *     tradition intact (the "add persists tradition" test fails).
 *
 * Tests mirror the production load order: loadFromJson → setCombatMethodCatalog →
 * _repairCombatMethodMarkers → reconcileGrantedCombatMethods, using a faithful subset
 * of the real `homebrew/TravelersGuidetoThelemar.json` `.combatMethod` catalog (the
 * nine dikaios method names with their real traditions).
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const ClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");

// Faithful subset of the real TGTT combat-method catalog (verbatim tradition / degree /
// staminaCost / actionType from homebrew/TravelersGuidetoThelemar.json .combatMethod),
// tagged with `_entityType` exactly as the page does when it calls setCombatMethodCatalog.
const RAW_CATALOG = [
	{name: "Lean Into It", source: "TGTT", tradition: "Adamant Mountain", degree: 1, staminaCost: 2, actionType: "action"},
	{name: "Shrug It Off", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Warding Wield", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 1, actionType: "bonus action"},
	{name: "Covering Fire", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "action"},
	{name: "Doubleshot", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action"},
	{name: "Countershot", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 1, actionType: "reaction"},
	{name: "Quickdraw", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Blindshot", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 1, actionType: "bonus action"},
	{name: "Missile Volley", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 2, actionType: "action"},
];
const CATALOG = RAW_CATALOG.map(m => ({...m, _entityType: "combatMethod"}));

// The four methods stored RECOGNISED (CTM optionalFeatureType + _entityType) but with NO
// tradition — the un-attributed ones the report is about.
const UNATTRIBUTED = [
	{name: "Lean Into It", trad: "AM"},
	{name: "Blindshot", trad: "BZ"},
	{name: "Missile Volley", trad: "BZ"},
	{name: "Countershot", trad: "BZ"},
];

function readFixture () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

/** Production load order. */
function loadState (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	state.setCombatMethodCatalog(CATALOG);
	state._repairCombatMethodMarkers();
	state.reconcileGrantedCombatMethods();
	return state;
}

const findFeature = (state, name) => (state._data.features || []).find(f => f.name === name);

/** Real combat controller bound to a real state; `_page.saveCharacter` captures toJson(). */
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	const saves = [];
	combat._page = {
		saveCharacter: jest.fn(() => { saves.push(JSON.parse(JSON.stringify(state.toJson()))); }),
	};
	combat._saves = saves;
	return combat;
}

describe("Combat-method attribution (repro: D_kaios Petri v2, Fighter 9 TGTT Arcane Archer)", () => {
	test("RED precondition: the four methods load recognised but with NO tradition", () => {
		// Pre-catalog / pre-repair: read the raw stored features exactly as loaded.
		const state = new CharacterSheetState();
		state.loadFromJson(readFixture());
		for (const {name} of UNATTRIBUTED) {
			const f = findFeature(state, name);
			expect(f).toBeDefined();
			// They ARE recognised as combat methods (generic CTM optionalfeatureType)...
			expect(ClassUtils.isCombatMethod(f)).toBe(true);
			// ...yet carry no tradition, so attribution resolves to null (the bug).
			expect(f.tradition == null).toBe(true);
			expect(ClassUtils.getMethodTraditionCode(f)).toBeNull();
		}
	});

	test("GREEN: after the production load order, all four resolve their catalog tradition", () => {
		const state = loadState(readFixture());
		for (const {name, trad} of UNATTRIBUTED) {
			const f = findFeature(state, name);
			expect(ClassUtils.getMethodTraditionCode(f)).toBe(trad);
		}
	});

	test("GREEN: getCombatMethods() surfaces every method with a non-null tradition", () => {
		const state = loadState(readFixture());
		const methods = state.getCombatMethods();
		const byName = new Map(methods.map(m => [m.name, m]));
		for (const {name, trad} of UNATTRIBUTED) {
			const m = byName.get(name);
			expect(m).toBeDefined();
			expect(m.tradition).toBe(trad);
		}
		// No surfaced method is left tradition-less.
		expect(methods.every(m => m.tradition && m.tradition !== "Unknown")).toBe(true);
	});

	test("never overwrites an already-attributed method's tradition", () => {
		// The fixture's Adamant Mountain / Biting Zephyr methods that DO carry a tradition
		// (e.g. Warding Wield = AM, Quickdraw = BZ) keep it through the repair.
		const state = loadState(readFixture());
		expect(ClassUtils.getMethodTraditionCode(findFeature(state, "Warding Wield"))).toBe("AM");
		expect(ClassUtils.getMethodTraditionCode(findFeature(state, "Quickdraw"))).toBe("BZ");
	});

	test("repair is idempotent: a second pass changes nothing and adds no duplicate", () => {
		const state = loadState(readFixture());
		const snap = name => JSON.stringify(findFeature(state, name));
		const before = UNATTRIBUTED.map(({name}) => snap(name));
		const countBefore = state._data.features.length;

		state._repairCombatMethodMarkers();

		UNATTRIBUTED.forEach(({name}, i) => expect(snap(name)).toBe(before[i]));
		expect(state._data.features.length).toBe(countBefore);
	});

	test("1a — a learned method via _addCombatMethod persists its tradition through toJson→reload", () => {
		const state = loadState(readFixture());
		const combat = makeCombat(state);

		// Singular Focus (Unerring Hawk) is NOT known by the fixture; learn it from the catalog.
		const SINGULAR_FOCUS = {
			name: "Singular Focus",
			source: "TGTT",
			_entityType: "combatMethod",
			tradition: "Unerring Hawk",
			degree: 3,
			staminaCost: 2,
			actionType: "bonus action",
			featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
			entries: ["Choose a creature you can see; you gain advantage on attacks against it."],
		};

		combat._addCombatMethod(SINGULAR_FOCUS);
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);

		// The stored feature must carry the structured markers immediately.
		const stored = findFeature(state, "Singular Focus");
		expect(stored._entityType).toBe("combatMethod");
		expect(stored.tradition).toBe("Unerring Hawk");
		expect(ClassUtils.getMethodTraditionCode(stored)).toBe("UH");

		// And it must survive a save→reload WITHOUT the catalog being needed to re-attribute.
		const captured = combat._saves[combat._saves.length - 1];
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(captured);
		const reStored = reloaded._data.features.find(f => f.name === "Singular Focus");
		expect(reStored).toBeDefined();
		expect(ClassUtils.getMethodTraditionCode(reStored)).toBe("UH");
	});
});
