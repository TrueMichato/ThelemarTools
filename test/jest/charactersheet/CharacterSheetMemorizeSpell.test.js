/**
 * Wizard "Memorize Spell" (#16) — 2024 Wizard level-5 feature.
 *
 * The feature lets a wizard, on a Short Rest, swap one prepared level 1+ spell
 * for another level 1+ spell from their spellbook. Previously the
 * `hasMemorizeSpell` calculation flag was set but nothing consumed it (dead
 * flag). These tests lock in the candidate computation and the 1-for-1 swap.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;

function makeWizard ({source = "XPHB", level = 5} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source, level});
	state.setAbilityBase("int", 18);
	return state;
}

function addWizardSpell (state, {name, level, prepared = false, alwaysPrepared = false, sourceClass = "Wizard"}) {
	state.addSpell({name, source: "PHB", level, school: "V", sourceClass, alwaysPrepared}, prepared);
}

describe("getMemorizeSpellCandidates (#16)", () => {
	test("returns prepared (outgoing) and spellbook (incoming) Wizard spell lists", () => {
		const state = makeWizard({level: 5}); // maxLevel = ceil(5/2) = 3
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		addWizardSpell(state, {name: "Misty Step", level: 2, prepared: false});

		const {prepared, spellbook, maxLevel} = CharacterSheetRest.getMemorizeSpellCandidates(state);

		expect(maxLevel).toBe(3);
		expect(prepared.map(s => s.name)).toEqual(["Shield"]);
		expect(spellbook.map(s => s.name)).toEqual(["Misty Step"]);
	});

	test("excludes always-prepared spells from the outgoing list", () => {
		const state = makeWizard({level: 5});
		addWizardSpell(state, {name: "Find Familiar", level: 1, prepared: true, alwaysPrepared: true});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});

		const {prepared} = CharacterSheetRest.getMemorizeSpellCandidates(state);
		expect(prepared.map(s => s.name)).toEqual(["Shield"]);
	});

	test("excludes spellbook spells above the wizard's max castable level", () => {
		const state = makeWizard({level: 5}); // maxLevel 3
		addWizardSpell(state, {name: "Fireball", level: 3, prepared: false});
		addWizardSpell(state, {name: "Polymorph", level: 4, prepared: false}); // too high

		const {spellbook} = CharacterSheetRest.getMemorizeSpellCandidates(state);
		expect(spellbook.map(s => s.name)).toEqual(["Fireball"]);
	});

	test("ignores spells from other classes (multiclass isolation)", () => {
		const state = makeWizard({level: 5});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		addWizardSpell(state, {name: "Cure Wounds", level: 1, prepared: false, sourceClass: "Cleric"});

		const {prepared, spellbook} = CharacterSheetRest.getMemorizeSpellCandidates(state);
		expect(prepared.map(s => s.name)).toEqual(["Shield"]);
		expect(spellbook.map(s => s.name)).toEqual([]); // Cure Wounds is Cleric
	});

	test("returns empty lists when there is no Wizard class", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const {prepared, spellbook, maxLevel} = CharacterSheetRest.getMemorizeSpellCandidates(state);
		expect(prepared).toEqual([]);
		expect(spellbook).toEqual([]);
		expect(maxLevel).toBe(0);
	});
});

describe("Memorize Spell swap mechanic (#16)", () => {
	test("swapping flips prepared flags: outgoing unprepared, incoming prepared", () => {
		const state = makeWizard({level: 5});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		addWizardSpell(state, {name: "Misty Step", level: 2, prepared: false});

		const {prepared, spellbook} = CharacterSheetRest.getMemorizeSpellCandidates(state);
		const out = prepared[0];
		const inc = spellbook[0];

		// Mirrors _buildMemorizeSpellSection().apply()
		state.setSpellPrepared(out.name, out.source, false);
		state.setSpellPrepared(inc.name, inc.source, true);

		const after = state.getSpells();
		expect(after.find(s => s.name === "Shield").prepared).toBe(false);
		expect(after.find(s => s.name === "Misty Step").prepared).toBe(true);
	});

	test("the prepared count is unchanged by a 1-for-1 swap", () => {
		const state = makeWizard({level: 5});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		addWizardSpell(state, {name: "Misty Step", level: 2, prepared: false});

		const before = state.getPreparedSpells().length;
		state.setSpellPrepared("Shield", "PHB", false);
		state.setSpellPrepared("Misty Step", "PHB", true);
		expect(state.getPreparedSpells().length).toBe(before);
	});
});

describe("_buildMemorizeSpellSection gating (#16)", () => {
	// Call the method directly with a minimal `this` to avoid the constructor's
	// DOM/event wiring (the node test env has no `document`).
	function buildSection (state) {
		return CharacterSheetRest.prototype._buildMemorizeSpellSection.call({_state: state});
	}

	test("returns null for a non-2024 (classic) Wizard — feature absent", () => {
		const state = makeWizard({source: "PHB", level: 5});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		addWizardSpell(state, {name: "Misty Step", level: 2, prepared: false});
		expect(buildSection(state)).toBeNull();
	});

	test("returns null when there is nothing to swap (no spellbook spell)", () => {
		const state = makeWizard({source: "XPHB", level: 5});
		addWizardSpell(state, {name: "Shield", level: 1, prepared: true});
		expect(buildSection(state)).toBeNull();
	});
});
