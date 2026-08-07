import "./setup.js";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetState = globalThis.CharacterSheetState;

const rawSpell = ({name, level, source = "PHB", unit = "action"}) => ({
	name,
	source,
	level,
	school: "A",
	time: [{number: 1, unit}],
	duration: [{type: "instant"}],
	components: {v: true},
	range: {type: "point", distance: {type: "self"}},
});

const addWizardSpell = (state, spell, {prepared = false} = {}) => {
	const stored = CharacterSheetClassUtils.buildSpellStateObject(spell, {
		sourceFeature: "Wizard Spellbook",
		sourceClass: "Wizard",
		inSpellbook: true,
		prepared,
	});
	state.addSpell(stored);
	return stored;
};

const makeState = ({source = "PHB", level = 18} = {}) => {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source, level});
	return state;
};

const makeSpellsModule = (state, allSpells) => {
	const page = {
		getState: () => state,
		_renderQuickSpells: jest.fn(),
		saveCharacter: jest.fn(),
	};
	const module = new CharacterSheetSpells(page);
	module._allSpells = allSpells;
	module._resolveMetamagicChoice = jest.fn().mockResolvedValue(null);
	module._pHandleCastingConstraints = jest.fn().mockResolvedValue(true);
	module._resolveVariantComponentChoice = jest.fn().mockResolvedValue(null);
	module._pConsumeMaterialComponent = jest.fn().mockResolvedValue(undefined);
	module._showCastResult = jest.fn().mockResolvedValue({});
	module.renderSlots = jest.fn();
	return module;
};

describe("Wizard Spell Mastery", () => {
	test("stores one level 1 and one level 2 spell and round-trips through JSON", () => {
		const state = makeState();
		const shield = addWizardSpell(state, rawSpell({name: "Shield", level: 1}), {prepared: true});
		const mistyStep = addWizardSpell(state, rawSpell({name: "Misty Step", level: 2}), {prepared: true});

		expect(state.setSpellMasterySpells([shield, mistyStep])).toBe(true);
		expect(state.getSpellMasterySpells().map(it => [it.name, it.level])).toEqual([["Shield", 1], ["Misty Step", 2]]);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSpellMasterySpells().map(it => it.name)).toEqual(["Shield", "Misty Step"]);
	});

	test("rejects spells outside the Wizard spellbook and wrong-level pairs", () => {
		const state = makeState();
		const shield = addWizardSpell(state, rawSpell({name: "Shield", level: 1}), {prepared: true});
		const magicMissile = addWizardSpell(state, rawSpell({name: "Magic Missile", level: 1}), {prepared: true});
		const clericSpell = {...rawSpell({name: "Aid", level: 2}), sourceClass: "Cleric", inSpellbook: true};

		expect(state.setSpellMasterySpells([shield, magicMissile])).toBe(false);
		expect(state.setSpellMasterySpells([shield, clericSpell])).toBe(false);
	});

	test("PHB free casting requires preparation and replacement requires study", () => {
		const state = makeState();
		const shield = addWizardSpell(state, rawSpell({name: "Shield", level: 1}));
		const mistyStep = addWizardSpell(state, rawSpell({name: "Misty Step", level: 2}), {prepared: true});
		const magicMissile = addWizardSpell(state, rawSpell({name: "Magic Missile", level: 1}), {prepared: true});
		expect(state.setSpellMasterySpells([shield, mistyStep])).toBe(true);

		expect(state.getSpellMasteryCastInfo(shield)).toBeNull();
		state.setSpellPrepared("Shield", "PHB", true);
		expect(state.getSpellMasteryCastInfo(state.getSpells().find(it => it.name === "Shield"))?.atWill).toBe(true);
		expect(state.replaceSpellMasterySpell(1, magicMissile, {trigger: "longRest"})).toBe(false);
		expect(state.replaceSpellMasterySpell(1, magicMissile, {trigger: "study"})).toBe(true);
	});

	test("XPHB allows only one-action spells, always prepares picks, and swaps only on a long rest", () => {
		const state = makeState({source: "XPHB"});
		const shield = addWizardSpell(state, rawSpell({name: "Shield", level: 1}));
		const detectMagic = addWizardSpell(state, rawSpell({name: "Detect Magic", level: 1, unit: "minute"}));
		const blur = addWizardSpell(state, rawSpell({name: "Blur", level: 2}));
		const mirrorImage = addWizardSpell(state, rawSpell({name: "Mirror Image", level: 2}));

		expect(state.getSpellMasteryCandidates(1).map(it => it.name)).toEqual(["Shield"]);
		expect(state.setSpellMasterySpells([detectMagic, blur])).toBe(false);
		expect(state.setSpellMasterySpells([shield, blur])).toBe(true);
		expect(state.getSpells().find(it => it.name === "Shield").alwaysPrepared).toBe(true);
		expect(state.replaceSpellMasterySpell(2, mirrorImage, {trigger: "study"})).toBe(false);
		expect(state.replaceSpellMasterySpell(2, mirrorImage, {trigger: "longRest"})).toBe(true);
	});

	test("free at-will cast does not decrement a spell slot", async () => {
		const shieldData = rawSpell({name: "Shield", level: 1});
		const mistyStepData = rawSpell({name: "Misty Step", level: 2});
		const state = makeState();
		const shield = addWizardSpell(state, shieldData, {prepared: true});
		const mistyStep = addWizardSpell(state, mistyStepData, {prepared: true});
		state.setSpellMasterySpells([shield, mistyStep]);
		state.setSpellSlots(1, 4, 4);
		const spells = makeSpellsModule(state, [shieldData, mistyStepData]);

		await spells._castSpell(state.getSpells().find(it => it.name === "Shield").id, {withMetamagic: false});

		expect(state.getSpellSlotsCurrent(1)).toBe(4);
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Shield"}),
			1,
			false,
			false,
			expect.objectContaining({freeCastSource: "Spell Mastery"}),
		);
	});

	test("always-prepared Mastery grants do not consume the prepared count", () => {
		const state = makeState({source: "XPHB"});
		const shield = addWizardSpell(state, rawSpell({name: "Shield", level: 1}));
		const blur = addWizardSpell(state, rawSpell({name: "Blur", level: 2}));
		const fireball = addWizardSpell(state, rawSpell({name: "Fireball", level: 3}), {prepared: true});
		state.setSpellMasterySpells([shield, blur]);

		expect(CharacterSheetClassUtils.countPreparedSpells(state.getSpells()).current).toBe(1);
		expect(state.getPreparedSpells().map(it => it.name)).toEqual(expect.arrayContaining(["Shield", "Blur", "Fireball"]));
	});
});
