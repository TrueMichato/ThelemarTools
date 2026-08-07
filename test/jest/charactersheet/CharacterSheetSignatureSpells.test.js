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

const rawSpell = name => ({
	name,
	source: "PHB",
	level: 3,
	school: "V",
	time: [{number: 1, unit: "action"}],
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

const makeState = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 20});
	return state;
};

const makeSpellsModule = (state, allSpells, castResult = {}) => {
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
	module._showCastResult = jest.fn().mockResolvedValue(castResult);
	module.renderSlots = jest.fn();
	return module;
};

describe("Wizard Signature Spells", () => {
	test("stores two distinct spellbook spells and round-trips uses through JSON", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		expect(state.setSignatureSpells([fireball, counterspell])).toBe(true);
		expect(state.useSignatureSpell(fireball)).toBe(true);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSignatureSpells()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fireball", usesCurrent: 0, usesMax: 1, recharge: "short"}),
			expect.objectContaining({name: "Counterspell", usesCurrent: 1, usesMax: 1, recharge: "short"}),
		]));
	});

	test("rejects duplicates and non-Wizard-spellbook entries", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		expect(state.setSignatureSpells([fireball, fireball])).toBe(false);
		expect(state.setSignatureSpells([fireball, {...rawSpell("Spirit Guardians"), sourceClass: "Cleric", inSpellbook: true}])).toBe(false);
	});

	test("signature spells are always prepared and excluded from the prepared count", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		const haste = addWizardSpell(state, rawSpell("Haste"), {prepared: true});
		state.setSignatureSpells([fireball, counterspell]);

		expect(state.getPreparedSpells().map(it => it.name)).toEqual(expect.arrayContaining(["Fireball", "Counterspell", "Haste"]));
		expect(CharacterSheetClassUtils.countPreparedSpells(state.getSpells()).current).toBe(1);
	});

	test("free cast spends its own use, preserves the slot, and blocks at zero", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		state.setSpellSlots(3, 3, 3);
		const spells = makeSpellsModule(state, [fireballData, counterspellData]);

		const fireballId = state.getSpells().find(it => it.name === "Fireball").id;
		await spells._castSpell(fireballId, {withMetamagic: false});
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(0);
		expect(state.getSpellSlotsCurrent(3)).toBe(3);

		state.setSpellSlots(3, 0, 0);
		await spells._castSpell(fireballId, {withMetamagic: false, decision: {slotLevel: 3}});
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	});

	test("ordinary higher-level casting still spends a slot, not the free use", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		state.setSpellSlots(4, 2, 2);
		const spells = makeSpellsModule(state, [fireballData, counterspellData]);

		await spells._castSpell(state.getSpells().find(it => it.name === "Fireball").id, {withMetamagic: false, decision: {slotLevel: 4}});

		expect(state.getSpellSlotsCurrent(4)).toBe(1);
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);
	});

	test("cancelled free cast refunds the Signature use", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		const spells = makeSpellsModule(state, [fireballData, counterspellData], {cancelled: true});

		await spells._castSpell(state.getSpells().find(it => it.name === "Fireball").id, {withMetamagic: false});

		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);
	});

	test("both short and long rests restore each spell's free cast", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		state.setSignatureSpells([fireball, counterspell]);

		state.useSignatureSpell(fireball);
		state.onShortRest();
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);

		state.useSignatureSpell(fireball);
		state.useSignatureSpell(counterspell);
		state.onLongRest();
		expect(state.getSignatureSpells().map(it => it.usesCurrent)).toEqual([1, 1]);
	});
});
