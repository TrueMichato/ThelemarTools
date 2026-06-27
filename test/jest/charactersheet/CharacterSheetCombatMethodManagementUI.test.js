/**
 * Combat Methods / Traditions / Arcane Shot MANAGEMENT-UI regression tests
 * (orchestrator bugs #6, #4, #15).
 *
 * These assert REAL mechanics on the pure logic seams that back the management
 * UI — counts, caps, de-duplication, tradition unioning, the tradition-filter
 * display model, and render-step error isolation — not mere existence. The DOM
 * render methods consume these seams, so locking the seams down protects the
 * three reported management bugs even though jsdom isn't available to drive the
 * actual DOM.
 *
 *  #6  Combat Methods management
 *      - cap now includes the subclass bonus method (Arcane Archer +1), matching
 *        LevelUp/QuickBuild (`_getCharacterMaxMethods`).
 *      - the manager stays reachable with 0 methods learned when the character
 *        has combat-method access (`_hasCombatMethodAccess`).
 *      - the picker catalog is de-duplicated by name|source, preferring the
 *        richer combatMethod entity (`dedupeCombatMethodCatalog`).
 *      - subclass-granted FIXED traditions surface even before any method is
 *        learned (`_getCharacterTraditions`).
 *
 *  #4  Combat Traditions filter UI — driven by a pure option model
 *      (`buildTraditionSelectionModel`): restricts to the class pool, locks
 *      subclass-granted traditions, groups granted → selected → available.
 *
 *  #15 Arcane Shot area — render steps are isolated (`_runRenderSteps`) so a
 *      throw in an earlier combat panel can't suppress a later one (the Arcane
 *      Shot section lives in a late render step).
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// --- helpers -----------------------------------------------------------------

function makeCombat ({state = {}, page = {}} = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = page;
	return combat;
}

const FIGHTER_CTM_PROGRESSION = {
	name: "Combat Methods",
	featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
	progression: {"1": 3, "2": 4, "3": 5, "4": 5, "5": 7},
};

function fighterClassData () {
	return {name: "Fighter", source: "TGTT", optionalfeatureProgression: [FIGHTER_CTM_PROGRESSION]};
}

function nonMethodClassData () {
	return {name: "Wizard", source: "PHB"};
}

// =========================================================================================
// #6 defect 1 — cap includes subclass bonus method
//
// NOTE: the cap+subclass-bonus mechanic for the single-class case (Arcane
// Archer +1) and the no-subclass baseline are already locked down by the
// integration branch's Round-30 #5 block (CharacterSheetRound30Fixes.test.js).
// We add only the net-new MULTICLASS-summation case here to avoid duplication.
// =========================================================================================
describe("#6 _getCharacterMaxMethods — multiclass cap sums base + subclass bonus per class", () => {
	test("multiclass sums each class's base + subclass bonus", () => {
		const combat = makeCombat({
			state: {getClasses: () => [
				{name: "Fighter", source: "TGTT", level: 5, subclass: {name: "Cavalier", shortName: "Cavalier", source: "TGTT"}},
				{name: "Monk", source: "TGTT", level: 3, subclass: {name: "Mercy", shortName: "Mercy", source: "TGTT"}},
			]},
			page: {getClasses: () => [
				fighterClassData(),
				{name: "Monk", source: "TGTT", optionalfeatureProgression: [{name: "Combat Methods", featureType: ["CTM:1"], progression: {"3": 2}}]},
			]},
		});
		// Fighter: 7 + 1 (Cavalier GH bonus) ; Monk: 2 + 1 (Mercy SK bonus) = 11
		expect(combat._getCharacterMaxMethods()).toBe(11);
	});
});

// =========================================================================================
// #6 defect 2 — manager reachable with 0 methods when access exists
// =========================================================================================
describe("#6 _hasCombatMethodAccess", () => {
	test("true when a class has a CTM optionalfeatureProgression", () => {
		const combat = makeCombat({
			state: {getClasses: () => [{name: "Fighter", source: "TGTT", level: 1}]},
			page: {getClasses: () => [fighterClassData()]},
		});
		expect(combat._hasCombatMethodAccess()).toBe(true);
	});

	test("false when no class grants combat methods", () => {
		const combat = makeCombat({
			state: {getClasses: () => [{name: "Wizard", source: "PHB", level: 5}]},
			page: {getClasses: () => [nonMethodClassData()]},
		});
		expect(combat._hasCombatMethodAccess()).toBe(false);
	});

	test("false when class list is empty", () => {
		const combat = makeCombat({state: {getClasses: () => []}, page: {getClasses: () => []}});
		expect(combat._hasCombatMethodAccess()).toBe(false);
	});
});

// =========================================================================================
// #6 defect 3 — picker catalog de-duplication
// =========================================================================================
describe("#6 dedupeCombatMethodCatalog", () => {
	const LEGACY = {name: "Catch Your Breath", source: "TGTT", optionalFeatureTypes: ["CTM:1AM"]};
	const ENTITY = {
		name: "Catch Your Breath",
		source: "TGTT",
		_entityType: "combatMethod",
		tradition: "Adamant Mountain",
		degree: 1,
		staminaCost: 2,
		entries: ["..."],
	};

	test("collapses a name|source twin to one row, keeping the richer entity", () => {
		const out = CharacterSheetClassUtils.dedupeCombatMethodCatalog([LEGACY, ENTITY]);
		expect(out).toHaveLength(1);
		expect(out[0]._entityType).toBe("combatMethod");
	});

	test("entity wins regardless of input order", () => {
		const out = CharacterSheetClassUtils.dedupeCombatMethodCatalog([ENTITY, LEGACY]);
		expect(out).toHaveLength(1);
		expect(out[0]._entityType).toBe("combatMethod");
	});

	test("name match with a different source is NOT merged", () => {
		const other = {...ENTITY, source: "HB2"};
		const out = CharacterSheetClassUtils.dedupeCombatMethodCatalog([ENTITY, other]);
		expect(out).toHaveLength(2);
	});

	test("case-insensitive name|source matching", () => {
		const out = CharacterSheetClassUtils.dedupeCombatMethodCatalog([
			{name: "Iron Will", source: "TGTT"},
			{name: "iron will", source: "tgtt", _entityType: "combatMethod", tradition: "RE", degree: 1, staminaCost: 1},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]._entityType).toBe("combatMethod");
	});

	test("entries with no name are dropped", () => {
		const out = CharacterSheetClassUtils.dedupeCombatMethodCatalog([null, {source: "TGTT"}, LEGACY]);
		expect(out).toHaveLength(1);
		expect(out[0].name).toBe("Catch Your Breath");
	});
});

// =========================================================================================
// #6 defect 4 — subclass-granted fixed traditions surface
// =========================================================================================
describe("#6 _getCharacterTraditions — unions subclass-granted fixed codes", () => {
	test("Cavalier surfaces its fixed traditions (GH, SS) with 0 methods and no saved traditions", () => {
		const combat = makeCombat({
			state: {
				getClasses: () => [{name: "Fighter", source: "TGTT", level: 5, subclass: {name: "Cavalier", shortName: "Cavalier", source: "TGTT"}}],
				getCombatTraditions: () => [],
				getFeatures: () => [],
			},
		});
		expect(combat._getCharacterTraditions().sort()).toEqual(["GH", "SS"]);
	});

	test("persisted traditions union with granted (no duplicates)", () => {
		const combat = makeCombat({
			state: {
				getClasses: () => [{name: "Fighter", source: "TGTT", level: 5, subclass: {name: "Cavalier", shortName: "Cavalier", source: "TGTT"}}],
				getCombatTraditions: () => ["AM", "GH"], // GH overlaps the grant
				getFeatures: () => [],
			},
		});
		expect(combat._getCharacterTraditions().sort()).toEqual(["AM", "GH", "SS"]);
	});

	test("falls back to inferring from known methods when nothing explicit/granted", () => {
		const combat = makeCombat({
			state: {
				getClasses: () => [{name: "Fighter", source: "TGTT", level: 5}], // no subclass
				getCombatTraditions: () => [],
				getFeatures: () => [
					{name: "Doubleshot", source: "TGTT", _entityType: "combatMethod", tradition: "Biting Zephyr", degree: 1, staminaCost: 1},
				],
			},
		});
		expect(combat._getCharacterTraditions()).toEqual(["BZ"]);
	});

	test("choice-only grants (e.g. Arcane Archer) are NOT auto-surfaced as fixed", () => {
		const combat = makeCombat({
			state: {
				getClasses: () => [{name: "Fighter", source: "TGTT", level: 5, subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}}],
				getCombatTraditions: () => [],
				getFeatures: () => [],
			},
		});
		// Arcane Archer's grants are all `choice: true` → no fixed traditions pre-seeded.
		expect(combat._getCharacterTraditions()).toEqual([]);
	});
});

// =========================================================================================
// #4 — tradition filter display model
// =========================================================================================
describe("#4 buildTraditionSelectionModel", () => {
	const available = [
		{code: "AM", name: "Adamant Mountain"},
		{code: "BZ", name: "Biting Zephyr"},
		{code: "GH", name: "Gallant Heart"},
	];

	test("granted traditions are locked + selected and sorted first", () => {
		const model = CharacterSheetClassUtils.buildTraditionSelectionModel({
			availableTraditions: available,
			selectedCodes: ["BZ"],
			grantedCodes: ["GH"],
		});
		const gh = model.find(m => m.code === "GH");
		expect(gh).toMatchObject({locked: true, selected: true, group: "granted"});
		// granted comes first
		expect(model[0].code).toBe("GH");
	});

	test("groups granted → selected → available", () => {
		const model = CharacterSheetClassUtils.buildTraditionSelectionModel({
			availableTraditions: available,
			selectedCodes: ["BZ"],
			grantedCodes: ["GH"],
		});
		const groups = model.map(m => m.group);
		expect(groups).toEqual(["granted", "selected", "available"]);
		expect(model.map(m => m.code)).toEqual(["GH", "BZ", "AM"]);
	});

	test("a selected code outside the available pool is still surfaced", () => {
		const model = CharacterSheetClassUtils.buildTraditionSelectionModel({
			availableTraditions: available,
			selectedCodes: ["RE"], // not in pool
			grantedCodes: [],
		});
		const re = model.find(m => m.code === "RE");
		expect(re).toBeTruthy();
		expect(re).toMatchObject({selected: true, locked: false, group: "selected"});
		expect(re.name).toBe("Razor's Edge"); // resolved from code
	});

	test("unselected available traditions are not auto-selected", () => {
		const model = CharacterSheetClassUtils.buildTraditionSelectionModel({
			availableTraditions: available,
			selectedCodes: [],
			grantedCodes: [],
		});
		expect(model.every(m => !m.selected && !m.locked)).toBe(true);
		expect(model.map(m => m.code)).toEqual(["AM", "BZ", "GH"]); // alphabetical by name
	});

	test("empty input yields an empty model", () => {
		expect(CharacterSheetClassUtils.buildTraditionSelectionModel({})).toEqual([]);
	});
});

describe("#4 _getTraditionSelectionModel (combat wiring)", () => {
	test("locks subclass-granted traditions and includes the class pool", () => {
		const fighterFeature = {
			name: "Combat Methods",
			source: "TGTT",
			className: "Fighter",
			classSource: "TGTT",
			level: 1,
			entries: ["{@b Choose Traditions.} Gain proficiency in two {@filter combat traditions|combatmethods} of your choice."],
		};
		const combat = makeCombat({
			state: {getClasses: () => [{name: "Fighter", source: "TGTT", level: 5, subclass: {name: "Cavalier", shortName: "Cavalier", source: "TGTT"}}]},
			page: {
				getOptionalFeatures: () => [],
				getCombatMethodEntities: () => [],
				getClassFeatures: () => [fighterFeature],
				getClasses: () => [fighterClassData()],
			},
		});
		const model = combat._getTraditionSelectionModel(["GH", "SS"]);
		const gh = model.find(m => m.code === "GH");
		const ss = model.find(m => m.code === "SS");
		expect(gh).toMatchObject({locked: true, group: "granted"});
		expect(ss).toMatchObject({locked: true, group: "granted"});
		// Fighter degree-only progression → full tradition pool available to add from.
		expect(model.length).toBeGreaterThanOrEqual(CharacterSheetClassUtils.getAllTraditions().length);
	});
});

// =========================================================================================
// #15 — render step isolation
// =========================================================================================
describe("#15 _runRenderSteps — error isolation", () => {
	let errSpy;
	beforeEach(() => { errSpy = jest.spyOn(console, "error").mockImplementation(() => {}); });
	afterEach(() => { errSpy.mockRestore(); });

	test("a throwing step does not stop later steps and never propagates", () => {
		const combat = makeCombat();
		const ran = [];
		const ok1 = function () { ran.push("ok1"); };
		const boom = function () { throw new Error("panel exploded"); };
		const ok2 = function () { ran.push("ok2"); };
		expect(() => combat._runRenderSteps([ok1, boom, ok2])).not.toThrow();
		expect(ran).toEqual(["ok1", "ok2"]);
		expect(errSpy).toHaveBeenCalled();
	});

	test("steps run with the combat instance as `this`", () => {
		const combat = makeCombat();
		combat._marker = 42;
		let seen = null;
		combat._runRenderSteps([function () { seen = this._marker; }]);
		expect(seen).toBe(42);
	});

	test("non-function entries are skipped safely", () => {
		const combat = makeCombat();
		const ran = [];
		expect(() => combat._runRenderSteps([null, undefined, 5, function () { ran.push("x"); }])).not.toThrow();
		expect(ran).toEqual(["x"]);
	});
});
