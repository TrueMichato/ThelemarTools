/**
 * Bard musical-instrument proficiency + spellcasting-focus support.
 *
 * Two related bugs are covered:
 *
 *   Bug 1 — Multiclassing into Bard granted NO musical-instrument proficiency.
 *     `_applyMulticlassProficiencies` used a hardcoded table that omitted tools, and
 *     `_showMulticlassChoices` never read the class's
 *     `multiclassing.proficienciesGained.toolProficiencies` (`[{anyMusicalInstrument:1}]`,
 *     present for BOTH the 2014 PHB and 2024 XPHB bard). The fix parses the grant from
 *     the real class data (`_getMulticlassInstrumentGrant`) and applies the chosen
 *     instrument via `addToolProficiency`, recording it for level-removal reversal.
 *
 *   Bug 2 — A Bard could not use a musical instrument as a spellcasting focus.
 *     `getSpellcastingFocusStatus` recognised only dedicated foci, a component pouch,
 *     and feat substitutions. The fix adds a narrow Bard branch: a carried instrument
 *     (item type "INS") the bard is proficient with satisfies the focus requirement.
 *
 * These tests drive the REAL helpers/state methods (parse helper, `_applyMulticlass`
 * apply path, `getSpellcastingFocusStatus`) and pin the persistence + regression edges.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-spells.js";

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const readJson = (/** @type {string} */ rel) => JSON.parse(readFileSync(resolve(REPO_ROOT, rel), "utf8"));

const BARD_DATA = readJson("data/class/class-bard.json");
const BARD_PHB = BARD_DATA.class.find((/** @type {*} */ c) => c.source === "PHB");
const BARD_XPHB = BARD_DATA.class.find((/** @type {*} */ c) => c.source === "XPHB");

// Page stub providing only what `_applyMulticlass` touches.
const makePage = (/** @type {*} */ state) => ({
	getState: () => state,
	saveCharacter: async () => {},
	renderCharacter: () => {},
	getSpells: () => [],
	getFilteredSpellData: () => [],
	getClassFeatures: () => [],
	getSubclassFeatures: () => [],
});

const makeLevelUp = (/** @type {*} */ state) => new CharacterSheetLevelUp(makePage(state));

const makeFighterBase = () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 16);
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
};

/* -------------------------------------------------------------------------- */
/* Bug 1 — multiclass instrument grant parsing                                 */
/* -------------------------------------------------------------------------- */

describe("Bug 1 — _getMulticlassInstrumentGrant (data-driven, both editions)", () => {
	test("parses the PHB bard's anyMusicalInstrument grant", () => {
		const lu = makeLevelUp(makeFighterBase());
		const grant = lu._getMulticlassInstrumentGrant(BARD_PHB);
		expect(grant).toBeTruthy();
		expect(grant.count).toBe(1);
		expect(grant.options).toEqual(expect.arrayContaining(["lute", "flute"]));
	});

	test("parses the XPHB bard's anyMusicalInstrument grant", () => {
		const lu = makeLevelUp(makeFighterBase());
		const grant = lu._getMulticlassInstrumentGrant(BARD_XPHB);
		expect(grant).toBeTruthy();
		expect(grant.count).toBe(1);
		expect(grant.options.length).toBeGreaterThan(0);
	});

	test("returns null for a class with no instrument grant (Fighter)", () => {
		const lu = makeLevelUp(makeFighterBase());
		expect(lu._getMulticlassInstrumentGrant({name: "Fighter", source: "PHB"})).toBeNull();
		expect(lu._getMulticlassInstrumentGrant({})).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Bug 1 — chosen instrument is applied + persisted                            */
/* -------------------------------------------------------------------------- */

describe("Bug 1 — multiclass instrument choice applied via addToolProficiency", () => {
	const bard = {
		name: "Bard",
		source: "PHB",
		multiclassing: BARD_PHB.multiclassing,
		spellsKnownProgression: BARD_PHB.spellsKnownProgression,
		cantripProgression: BARD_PHB.cantripProgression,
		casterProgression: "full",
		spellcastingAbility: "cha",
	};

	test("adds the selected instrument as a tool proficiency", async () => {
		const state = makeFighterBase();
		const lu = makeLevelUp(state);
		await lu._applyMulticlass(bard, [], {}, {}, [], [], [], ["lute"]);

		expect(state.getClasses().some((/** @type {*} */ c) => c.name === "Bard")).toBe(true);
		expect(state.hasToolProficiency("Lute")).toBe(true);
		expect(state.hasToolProficiency("lute")).toBe(true);
		// Stored in titlecase form (matches the Builder's storage convention).
		expect(state.getToolProficiencies()).toContain("Lute");
	});

	test("does not add a tool proficiency when no instrument was chosen", async () => {
		const state = makeFighterBase();
		const lu = makeLevelUp(state);
		await lu._applyMulticlass(bard, [], {}, {}, [], [], [], []);
		expect(state.getToolProficiencies()).toHaveLength(0);
	});

	test("the chosen instrument survives a save/load round-trip", async () => {
		const state = makeFighterBase();
		const lu = makeLevelUp(state);
		await lu._applyMulticlass(bard, [], {}, {}, [], [], [], ["pan flute"]);

		const json = JSON.parse(JSON.stringify(state.toJson()));
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.hasToolProficiency("pan flute")).toBe(true);
	});

	test("records the instrument in level history so removal reverses it", async () => {
		const state = makeFighterBase();
		const lu = makeLevelUp(state);
		await lu._applyMulticlass(bard, [], {}, {}, [], [], [], ["lute"]);

		const history = state.getLevelHistory();
		const mcEntry = history.find((/** @type {*} */ h) => h.class?.name === "Bard");
		expect(mcEntry?.choices?.tools).toContain("Lute");
		expect(mcEntry?.choices?.multiclassProficiencies?.tools).toContain("Lute");

		// Peeling the Bard level back off should remove the granted instrument prof.
		state.removeClassLastLevel("Bard", "PHB");
		expect(state.getClasses().some((/** @type {*} */ c) => c.name === "Bard")).toBe(false);
		expect(state.hasToolProficiency("Lute")).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* Bug 2 — instrument as spellcasting focus                                    */
/* -------------------------------------------------------------------------- */

describe("Bug 2 — getSpellcastingFocusStatus recognises a bard's instrument", () => {
	const makeBard = () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 3, casterProgression: "full", spellcastingAbility: "cha"});
		return state;
	};

	test("a proficient bard carrying an instrument satisfies the focus", () => {
		const state = makeBard();
		state.addToolProficiency("Lute");
		state.addItem({name: "Lute", source: "PHB", type: "INS", _isCustom: true});

		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.source).toBe("musical instrument");
		expect(status.itemName).toBe("Lute");
	});

	test("works for a 2024 (XPHB-typed) instrument and generic instrument proficiency", () => {
		const state = makeBard();
		state.addToolProficiency("Musical Instrument"); // generic proficiency
		state.addItem({name: "Lyre", source: "XPHB", type: "INS|XPHB", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	test("regression: a bard carrying an instrument they are NOT proficient with fails", () => {
		const state = makeBard();
		state.addItem({name: "Lute", source: "PHB", type: "INS", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});

	test("regression: a proficient bard with NO instrument in inventory fails", () => {
		const state = makeBard();
		state.addToolProficiency("Lute");
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});

	test("regression: a non-bard carrying an instrument they own is NOT a focus", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		state.addToolProficiency("Lute");
		state.addItem({name: "Lute", source: "PHB", type: "INS", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});

	test("regression: existing focus paths still work (arcane focus for a wizard)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		state.addItem({name: "Orb", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.source).toBe("arcane focus");
	});
});

/* -------------------------------------------------------------------------- */
/* Bug 2 — material-component error copy mentions the instrument for bards      */
/* -------------------------------------------------------------------------- */

describe("Bug 2 — material-component block copy", () => {
	const makeSpells = (/** @type {*} */ state) => {
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = state;
		spells._page = {saveCharacter: () => {}};
		return spells;
	};
	// A no-cost material component → satisfiable by a focus.
	const SPELL_NO_COST = {name: "Detect Magic", source: "PHB", level: 1, components: {v: true, s: true, m: "a pinch of powder"}};

	test("bard with no focus sees a message mentioning a musical instrument", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 3, casterProgression: "full", spellcastingAbility: "cha"});
		const msg = makeSpells(state)._getMaterialComponentBlock(SPELL_NO_COST, SPELL_NO_COST);
		expect(msg).toMatch(/musical instrument/i);
	});

	test("non-bard message does NOT mention a musical instrument", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		const msg = makeSpells(state)._getMaterialComponentBlock(SPELL_NO_COST, SPELL_NO_COST);
		expect(msg).toMatch(/spellcasting focus or component pouch/i);
		expect(msg).not.toMatch(/musical instrument/i);
	});

	test("a proficient bard carrying an instrument can cast (no block)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 3, casterProgression: "full", spellcastingAbility: "cha"});
		state.addToolProficiency("Lute");
		state.addItem({name: "Lute", source: "PHB", type: "INS", _isCustom: true});
		expect(makeSpells(state)._getMaterialComponentBlock(SPELL_NO_COST, SPELL_NO_COST)).toBeNull();
	});
});
