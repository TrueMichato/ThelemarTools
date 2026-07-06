/**
 * R48 Bug 1 — Class-level always-prepared spells.
 *
 * The base CLASS object (not the subclass) can carry structured `additionalSpells`
 * — e.g. the TGTT Cleric ALWAYS prepares Ceremony + Thaumaturgy, the TGTT Ranger
 * ALWAYS prepares Hunter's Mark. Before this fix the character sheet applied
 * `additionalSpells` for race / feat / subclass only, silently dropping the
 * class-level grant.
 *
 * These tests drive the state-level mechanism directly (setClassCatalog +
 * applyClassFeatureEffects) — the same wiring the page performs in
 * `_reconcileClassFeatures()` — and separately assert that wiring line exists.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// Minimal spell DB so class-granted spells get enriched with real level/school
// (without it, entries keep `level: null` and the level-grouped list drops them).
const SPELL_DB = [
	{name: "Ceremony", source: "XPHB", level: 1, school: "A"},
	{name: "Thaumaturgy", source: "XPHB", level: 0, school: "T"},
	{name: "Hunter's Mark", source: "XPHB", level: 1, school: "D"},
	{name: "Speak with Animals", source: "XPHB", level: 1, school: "D"},
];

/** The real TGTT Cleric class object carries `additionalSpells` at the class level. */
function tgttClericCatalogEntry () {
	return {
		name: "Cleric",
		source: "TGTT",
		additionalSpells: [{prepared: {1: ["thaumaturgy|xphb", "ceremony|xphb"]}}],
	};
}

/** The real TGTT Ranger class object — Hunter's Mark is always prepared at level 1. */
function tgttRangerCatalogEntry () {
	return {
		name: "Ranger",
		source: "TGTT",
		additionalSpells: [{prepared: {1: ["hunter's mark|xphb"]}}],
	};
}

function newClericState ({level = 10} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(SPELL_DB);
	state._data.classes = [{name: "Cleric", source: "TGTT", level, subclass: null}];
	return state;
}

const lc = arr => arr.map(s => (s.name || "").toLowerCase());

describe("Class-level always-prepared spells — grant", () => {
	test("TGTT Cleric always prepares Ceremony + Thaumaturgy, tagged, not counted vs limit", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		const known = state.getSpellsKnown();
		const cantrips = state.getCantripsKnown();

		// Ceremony (level 1) is a leveled always-prepared spell.
		const ceremony = known.find(s => s.name.toLowerCase() === "ceremony");
		expect(ceremony).toBeTruthy();
		expect(ceremony.alwaysPrepared).toBe(true);
		expect(ceremony.grantedByClass).toBe(true);
		expect(ceremony.sourceFeature).toBe("Cleric Spells");
		expect(ceremony.sourceClass).toBe("Cleric");
		expect(ceremony.level).toBe(1);

		// Thaumaturgy is a cantrip — routed to cantripsKnown, tagged.
		const thaum = cantrips.find(s => s.name.toLowerCase() === "thaumaturgy");
		expect(thaum).toBeTruthy();
		expect(thaum.grantedByClass).toBe(true);
		expect(thaum.sourceFeature).toBe("Cleric Spells");

		// Always-prepared class spells must NOT count against the prepared limit:
		// their sourceFeature is not a player-chosen tag.
		const ClassUtils = globalThis.CharacterSheetClassUtils;
		expect(ClassUtils.isPlayerChosenSpell(ceremony)).toBe(false);
		expect(ClassUtils.isPlayerChosenSpell(thaum)).toBe(false);
	});

	test("re-applying is idempotent (no duplicate class spells)", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();

		const ceremonies = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		const thaums = state.getCantripsKnown().filter(s => s.name.toLowerCase() === "thaumaturgy");
		expect(ceremonies).toHaveLength(1);
		expect(thaums).toHaveLength(1);
	});

	test("no-ops until the class catalog is provided", () => {
		const state = newClericState();
		// No setClassCatalog → populateClassSpells early-returns.
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");
		expect(lc(state.getCantripsKnown())).not.toContain("thaumaturgy");
	});

	test("classes without class-level additionalSpells no-op cleanly", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Fighter", source: "TGTT", level: 5, subclass: null}];
		state.setClassCatalog([{name: "Fighter", source: "TGTT"}]);
		expect(() => state.applyClassFeatureEffects()).not.toThrow();
		expect(state.getSpellsKnown()).toHaveLength(0);
	});
});

describe("Class-level always-prepared spells — level gating", () => {
	test("a 1-level Cleric multiclass dip still gets the level-1 class spells", () => {
		const state = newClericState({level: 1});
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("ceremony");
		expect(lc(state.getCantripsKnown())).toContain("thaumaturgy");
	});

	test("a higher-level grant is withheld below its level then added on level-up", () => {
		// Druid: speak with animals at class level 1.
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Druid", source: "TGTT", level: 1, subclass: null}];
		const druidCatalog = [{
			name: "Druid",
			source: "TGTT",
			additionalSpells: [{prepared: {1: ["speak with animals|xphb"], 3: ["hunter's mark|xphb"]}}],
		}];
		state.setClassCatalog(druidCatalog);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("speak with animals");
		// hunter's mark requires class level 3 — withheld at level 1.
		expect(lc(state.getSpellsKnown())).not.toContain("hunter's mark");

		// Level up to 3 → the higher grant appears.
		state._data.classes[0].level = 3;
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("hunter's mark");
	});
});

describe("Class-level always-prepared spells — genericity (non-Cleric)", () => {
	test("TGTT Ranger always prepares Hunter's Mark at class level 1", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Ranger", source: "TGTT", level: 1, subclass: null}];
		state.setClassCatalog([tgttRangerCatalogEntry()]);
		state.applyClassFeatureEffects();

		const hm = state.getSpellsKnown().find(s => s.name.toLowerCase() === "hunter's mark");
		expect(hm).toBeTruthy();
		expect(hm.alwaysPrepared).toBe(true);
		expect(hm.grantedByClass).toBe(true);
		expect(hm.sourceFeature).toBe("Ranger Spells");
		expect(hm.sourceClass).toBe("Ranger");
	});
});

describe("Class-level always-prepared spells — teardown on removal / level-down", () => {
	test("removing the class tears down its class-granted spells", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("ceremony");

		// Remove the Cleric class and re-reconcile.
		state._data.classes = [];
		state.applyClassFeatureEffects();

		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");
		expect(lc(state.getCantripsKnown())).not.toContain("thaumaturgy");
	});

	test("a same-named PLAYER-OWNED spell is NOT deleted when the class is removed", () => {
		const state = newClericState();
		// Player independently learned Ceremony (their own copy, different source, player tag).
		state.addSpell({name: "Ceremony", source: "PHB", level: 1, school: "A", sourceFeature: "Spells Known", sourceClass: "Cleric"}, true);
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		// Both exist now: the class-granted XPHB one + the player's PHB one.
		const ceremonies = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		expect(ceremonies.length).toBeGreaterThanOrEqual(2);

		// Remove the class.
		state._data.classes = [];
		state.applyClassFeatureEffects();

		const remaining = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		expect(remaining).toHaveLength(1);
		const survivor = remaining[0];
		expect(survivor.source).toBe("PHB");
		expect(survivor.grantedByClass).toBeFalsy();
		expect(survivor.sourceFeature).toBe("Spells Known");
	});
});

describe("Class-level always-prepared spells — existing save auto-fix on load", () => {
	const FIXTURE = "/Users/tommichaeli/.copilot/session-state/8152ec14-2999-4191-a841-cfad776ac594/files/lorian-tempest-cleric.json";
	const maybe = fs.existsSync(FIXTURE) ? test : test.skip;

	maybe("a stored L10 TGTT Cleric gains Ceremony/Thaumaturgy WITHOUT editing the save", () => {
		const raw = fs.readFileSync(FIXTURE, "utf8");
		const before = JSON.parse(raw);

		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state.loadFromJson(before);

		// Before catalog wiring the class spells are absent (stored save predates the fix).
		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");

		// Drive the exact page wiring: catalog then re-apply.
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		expect(lc(state.getSpellsKnown())).toContain("ceremony");
		expect(lc(state.getCantripsKnown())).toContain("thaumaturgy");
		const ceremony = state.getSpellsKnown().find(s => s.name.toLowerCase() === "ceremony");
		expect(ceremony.alwaysPrepared).toBe(true);
		expect(ceremony.grantedByClass).toBe(true);

		// The on-disk save file is untouched (auto-fix is derived on load).
		expect(fs.readFileSync(FIXTURE, "utf8")).toBe(raw);
	});

	test("the page wires setClassCatalog + applyClassFeatureEffects in the reconcile block", () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		expect(src).toMatch(/this\._state\.setClassCatalog\(this\._classes\b/);
		// The reconcile block re-applies effects so populate runs with the catalog available.
		const idxCatalog = src.indexOf("setClassCatalog(this._classes");
		const idxApply = src.indexOf("applyClassFeatureEffects()", idxCatalog);
		expect(idxCatalog).toBeGreaterThan(-1);
		expect(idxApply).toBeGreaterThan(idxCatalog);
	});
});
