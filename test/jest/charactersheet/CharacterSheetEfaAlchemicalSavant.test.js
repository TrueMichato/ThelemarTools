import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const DAMAGE_TYPES = ["acid", "fire", "poison"];

function damageSpell (damageType, {name = `${damageType} test spell`} = {}) {
	return {
		name,
		source: "XPHB",
		level: 1,
		school: "V",
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		range: {type: "point", distance: {type: "feet", amount: 60}},
		entries: [`The target takes {@damage 1d6} ${damageType} damage.`],
		damageInflict: [damageType],
	};
}

const HEALING_SPELL = {
	name: "Alchemical Mending",
	source: "XPHB",
	level: 1,
	school: "A",
	components: {v: true, s: true},
	duration: [{type: "instant"}],
	range: {type: "point", distance: {type: "self"}},
	entries: ["You regain {@dice 1d8} + your spellcasting ability modifier hit points."],
	miscTags: ["HL"],
};

const MULTI_ROLL_SPELL = {
	name: "Dual Reagent",
	source: "XPHB",
	level: 1,
	school: "V",
	components: {v: true, s: true},
	duration: [{type: "instant"}],
	range: {type: "point", distance: {type: "feet", amount: 60}},
	entries: [
		"The first reaction deals {@damage 1d6} acid damage.",
		"The second reaction deals {@damage 1d4} fire damage.",
	],
	damageInflict: ["acid", "fire"],
};

function addTool (state, {
	id = "supplies",
	name = "Alchemist's Supplies",
	source = "XPHB",
} = {}) {
	state.addItem({id, name, source, type: "AT", quantity: 1, _isCustom: true});
	state.setItemEquipped(id, true);
	state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function addSpell (state, spellData, {
	className = "Artificer",
	classSource = "EFA",
	subclassName = null,
	subclassSource = null,
} = {}) {
	state.addSpell({
		...spellData,
		prepared: true,
		sourceClass: className,
		sourceClassSource: classSource,
		...(subclassName ? {sourceSubclass: subclassName} : {}),
		...(subclassSource ? {sourceSubclassSource: subclassSource} : {}),
	}, true);
	return state.getSpells().find(spell => spell.name === spellData.name && spell.source === spellData.source);
}

function makeState ({
	level = 5,
	className = "Artificer",
	classSource = "EFA",
	subclassName = "Alchemist",
	subclassSource = "EFA",
	intelligence = 16,
	focusSource = "XPHB",
} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: className,
		source: classSource,
		level,
		subclass: subclassName
			? {name: subclassName, shortName: subclassName, source: subclassSource}
			: null,
	});
	state.setAbilityBase("int", intelligence);
	state.setSpellcastingAbility("int");
	state.setSpellSlots(1, 8, 8);
	addTool(state, {source: focusSource});
	return state;
}

function makeSpells (state, spellData, {cancelled = false} = {}) {
	const page = {
		_combat: null,
		_rollHistory: {addRoll: jest.fn()},
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_updateAllCalculations: jest.fn(),
		_renderActiveStates: jest.fn(),
		_renderHp: jest.fn(),
		_saveCurrentCharacter: jest.fn(),
		saveCharacter: jest.fn(),
		rollD20: jest.fn(() => ({roll: 10})),
		rollDice: jest.fn(() => 2),
		pAnimateDamageDice: jest.fn(),
		pAnimateDiceSpec: jest.fn(),
	};
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = page;
	spells._state = state;
	spells._allSpells = [spellData];
	spells._resolveMetamagicChoice = jest.fn(async () => ({cancelled: false, metamagic: null}));
	spells._resolveVariantComponentChoice = jest.fn(async () => ({cancelled: false, variantComponent: null}));
	spells._pHandleCastingConstraints = jest.fn(async () => true);
	spells._pConsumeMaterialComponent = jest.fn(async () => ({consumed: null}));
	spells._refreshSorceryPointUI = jest.fn();
	spells._updateConcentrationUI = jest.fn();
	spells.renderSlots = jest.fn();
	spells.render = jest.fn();
	spells._renderSpellList = jest.fn();
	if (cancelled) spells._showCastResult = jest.fn(async () => ({cancelled: true, rolls: []}));
	spells._registerCommittedSpellCastHooks();
	return spells;
}

async function castSpell ({
	state = makeState(),
	spellData = damageSpell("acid"),
	focusInventoryItemId = "supplies",
	cancelled = false,
	spellOwnership = {},
} = {}) {
	const stored = addSpell(state, spellData, spellOwnership);
	const spells = makeSpells(state, spellData, {cancelled});
	const receipt = await spells._castSpell(stored.id, {
		withMetamagic: false,
		decision: {slotLevel: 1, focusInventoryItemId},
	});
	return {state, spells, stored, receipt};
}

beforeEach(() => {
	jest.restoreAllMocks();
	globalThis.JqueryUtil.doToast = jest.fn();
	globalThis.Renderer.dice = globalThis.Renderer.dice || {};
	globalThis.Renderer.dice.parseRandomise2 = jest.fn(() => 2);
});

describe("EFA Alchemical Savant committed cast roll modifier", () => {
	it("adds the current Intelligence modifier to an exact-focus healing roll", async () => {
		const state = makeState();
		state.setHp(1, 20);

		const {receipt} = await castSpell({state, spellData: HEALING_SPELL});

		expect(receipt).toMatchObject({
			castingClassUid: "Artificer|EFA",
			castingSubclassUid: "Alchemist|Artificer|EFA|EFA",
			focusItemUid: "Alchemist's Supplies|XPHB",
		});
		expect(receipt.alchemicalSavant).toMatchObject({
			sourceFeatureUid: CharacterSheetState.EFA_ALCHEMICAL_SAVANT_FEATURE_UID,
			kind: "healing",
			bonus: 3,
			originalFormula: "1d8 + 3",
			originalTotal: 5,
			finalFormula: "1d8 + 3 + 3",
			finalTotal: 8,
			consumed: true,
		});
		expect(state.getCurrentHp()).toBe(9);
		expect(receipt.cast.rolls).toHaveLength(1);
	});

	it.each(DAMAGE_TYPES)("adds the bonus to one %s damage roll", async damageType => {
		const {receipt} = await castSpell({spellData: damageSpell(damageType)});

		expect(receipt.alchemicalSavant).toMatchObject({
			kind: "damage",
			damageType,
			bonus: 3,
			originalTotal: 2,
			finalTotal: 5,
			consumed: true,
		});
		expect(receipt.cast.rolls.filter(roll => roll.alchemicalSavant)).toHaveLength(1);
	});

	it("keeps damage evidence for a damaging spell that can inflict a condition", async () => {
		const spellData = {
			...damageSpell("poison", {name: "Ray of Sickness"}),
			conditionInflict: ["poisoned"],
		};
		const {receipt} = await castSpell({spellData});

		expect(receipt.cast.rolls).toEqual([
			expect.objectContaining({
				kind: "damage",
				damageType: "poison",
				alchemicalSavant: expect.objectContaining({bonus: 3}),
			}),
		]);
		expect(receipt.damageEvidence).toMatchObject({
			resolution: "unavailable",
			damage: [expect.objectContaining({damageType: "poison"})],
		});
	});

	it("does not apply to necrotic damage", async () => {
		const {receipt} = await castSpell({spellData: damageSpell("necrotic")});

		expect(receipt.alchemicalSavant).toBeUndefined();
		expect(receipt.cast.rolls[0]).toMatchObject({damageType: "necrotic", total: 2});
	});

	it("rejects same-name PHB supplies", async () => {
		const state = makeState({focusSource: "PHB"});
		const {receipt} = await castSpell({state, spellData: damageSpell("fire")});

		expect(receipt.focusItemUid).toBe("Alchemist's Supplies|PHB");
		expect(receipt.alchemicalSavant).toBeUndefined();
		expect(receipt.cast.rolls[0].total).toBe(2);
	});

	it.each([
		["TCE parent class", {classSource: "TCE", subclassSource: "TCE"}],
		["TCE compatibility subclass", {classSource: "EFA", subclassSource: "TCE"}],
		["another EFA subclass", {classSource: "EFA", subclassName: "Artillerist", subclassSource: "EFA"}],
	])("rejects %s", async (_label, stateOptions) => {
		const state = makeState(stateOptions);
		const {receipt} = await castSpell({
			state,
			spellData: damageSpell("acid"),
			spellOwnership: {classSource: stateOptions.classSource},
		});

		expect(receipt?.alchemicalSavant).toBeUndefined();
	});

	it("rejects a spell cast through another class", async () => {
		const state = makeState();
		state.addClass({name: "Wizard", source: "XPHB", level: 1});
		const {receipt} = await castSpell({
			state,
			spellData: damageSpell("fire"),
			spellOwnership: {className: "Wizard", classSource: "XPHB"},
		});

		expect(receipt.castingClassUid).toBe("Wizard|XPHB");
		expect(receipt.alchemicalSavant).toBeUndefined();
	});

	it("rejects an item cast even when it is attributed to Artificer|EFA", async () => {
		const state = makeState();
		state.addItem({id: "wand", name: "Test Wand", source: "EFA", quantity: 1, _isCustom: true});
		const spellData = damageSpell("poison");
		const spells = makeSpells(state, spellData);

		const receipt = await spells.pCastItemSpell({
			id: "poison-cast",
			itemId: "wand",
			itemName: "Test Wand",
			spellName: spellData.name,
			spellSource: spellData.source,
			castLevel: 1,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		}, {decision: {focusInventoryItemId: "supplies"}});

		expect(receipt).toMatchObject({committed: true, castType: "item"});
		expect(receipt.alchemicalSavant).toBeUndefined();
	});

	it("does nothing for a cancelled cast and leaves the slot untouched", async () => {
		const state = makeState();
		const before = state.getSpellSlotsCurrent(1);
		const {receipt} = await castSpell({state, spellData: damageSpell("acid"), cancelled: true});

		expect(receipt).toBeUndefined();
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining("Alchemical Savant"),
		}));
	});

	it("uses a minimum bonus of +1", async () => {
		const state = makeState({intelligence: 8});
		const {receipt} = await castSpell({state, spellData: damageSpell("fire")});

		expect(receipt.alchemicalSavant).toMatchObject({bonus: 1, originalTotal: 2, finalTotal: 3});
	});

	it("reads the current Intelligence modifier for each committed cast", async () => {
		const state = makeState({intelligence: 16});
		const first = await castSpell({state, spellData: damageSpell("acid", {name: "Mutable Formula"})});
		state.setAbilityBase("int", 20);
		const stored = state.getSpells().find(spell => spell.name === "Mutable Formula");
		const secondReceipt = await first.spells._castSpell(stored.id, {
			withMetamagic: false,
			decision: {slotLevel: 1, focusInventoryItemId: "supplies"},
		});

		expect(first.receipt.alchemicalSavant.bonus).toBe(3);
		expect(secondReceipt.alchemicalSavant.bonus).toBe(5);
	});

	it("offers an explicit one-of-many selection and applies the bonus once", async () => {
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async opts => opts.values[1]);

		const {receipt} = await castSpell({spellData: MULTI_ROLL_SPELL});

		expect(CharacterSheetModal.pGetUserEnum).toHaveBeenCalledWith(expect.objectContaining({
			title: "Alchemical Savant — Choose Roll",
			isAllowNull: true,
		}));
		expect(receipt.alchemicalSavant).toMatchObject({rollId: "damage:1", damageType: "fire", bonus: 3});
		expect(receipt.cast.rolls).toHaveLength(2);
		expect(receipt.cast.rolls.filter(roll => roll.alchemicalSavant)).toHaveLength(1);
		expect(receipt.cast.rolls.map(roll => roll.total)).toEqual([2, 5]);
	});

	it("cannot consume a second eligible roll when the same receipt is handled again", async () => {
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async opts => opts.values[0]);
		const {spells, receipt} = await castSpell({spellData: MULTI_ROLL_SPELL});

		const secondAttempt = await spells._pApplyEfaAlchemicalSavant(receipt);

		expect(secondAttempt).toEqual({applied: false, reason: "alreadyHandled"});
		expect(receipt.cast.rolls.filter(roll => roll.alchemicalSavant)).toHaveLength(1);
		expect(receipt.cast.rolls.map(roll => roll.total)).toEqual([5, 2]);
	});

	it("clears a declined cast without leaking the bonus to the next cast", async () => {
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockResolvedValueOnce(null);
		const state = makeState();
		const first = await castSpell({state, spellData: MULTI_ROLL_SPELL});

		expect(first.receipt.alchemicalSavant).toMatchObject({declined: true, consumed: false});
		expect(first.receipt.cast.rolls.every(roll => !roll.alchemicalSavant)).toBe(true);
		expect(JSON.stringify(state.toJson())).not.toContain("alchemicalSavant");

		const secondData = damageSpell("poison", {name: "Later Poison"});
		const secondStored = addSpell(state, secondData);
		first.spells._allSpells.push(secondData);
		const secondReceipt = await first.spells._castSpell(secondStored.id, {
			withMetamagic: false,
			decision: {slotLevel: 1, focusInventoryItemId: "supplies"},
		});

		expect(secondReceipt.alchemicalSavant).toMatchObject({damageType: "poison", bonus: 3, consumed: true});
		expect(secondReceipt.cast.rolls.filter(roll => roll.alchemicalSavant)).toHaveLength(1);
	});

	it("keeps the cast committed and surfaces a failed Savant follow-up", async () => {
		const state = makeState();
		const spellData = damageSpell("acid");
		const stored = addSpell(state, spellData);
		const spells = makeSpells(state, spellData);
		spells._pApplyEfaAlchemicalSavant = jest.fn(async () => {
			throw new Error("Savant selection failed");
		});
		const before = state.getSpellSlotsCurrent(1);

		const receipt = await spells._castSpell(stored.id, {
			withMetamagic: false,
			decision: {slotLevel: 1, focusInventoryItemId: "supplies"},
		});

		expect(state.getSpellSlotsCurrent(1)).toBe(before - 1);
		expect(receipt).toMatchObject({
			ok: true,
			committed: true,
			followUpFailed: true,
			followUps: [{hookId: "efa-alchemical-savant", ok: false, error: "Savant selection failed"}],
		});
		expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({
			type: "warning",
			content: expect.stringContaining("The spell was cast"),
		}));
	});
});
