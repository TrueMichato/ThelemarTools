import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetState = globalThis.CharacterSheetState;

let CharacterSheetPage;
let savedWindow;
let savedDocument;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
	globalThis.Renderer.dice ||= {};
	globalThis.Renderer.dice.parseRandomise2 ||= () => 0;
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

function addRollDie (state, {
	name,
	type = "rollBonus",
	target = "attack",
	dice = "1d4",
}) {
	state.addActiveState("custom", {
		name,
		customEffects: [{type, target, dice}],
	});
}

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("int", 16);
	state.setSpellcastingAbility("int");
	return state;
}

function makeAttack (id = "sword") {
	return {
		id,
		name: id === "sword" ? "Longsword" : id,
		isMelee: true,
		type: "melee",
		abilityMod: "str",
		range: "melee",
		damage: "1d8",
	};
}

function makePage (state, d20 = 10) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page.rollD20 = jest.fn(({mode} = {}) => ({
		roll: d20,
		roll1: d20,
		roll2: d20,
		mode: mode || "normal",
		thelemar_critBonus: 0,
	}));
	page.pAnimateD20 = jest.fn();
	page.showDiceResult = jest.fn(() => null);
	page._offerGuidedStrikePostAttack = jest.fn();
	return page;
}

function makeCombat (state, page) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = page;
	combat._battleTacticToggles = {};
	combat._flankingEnabled = false;
	combat._canRollAttackActionAttack = () => true;
	combat._getSelectedAmmoForWeapon = () => null;
	combat._getCombatLocalAttackBonus = () => ({bonus: 0, parts: []});
	combat._renderSneakAttackToggle = () => {};
	combat._isSneakAttackAvailableThisTurn = () => false;
	combat._runPostAttackHooks = async () => {};
	combat._consumeOnAttackStates = () => {};
	combat._clearPendingSpellRider = () => {};
	combat._recordAttackForTurn = () => {};
	return combat;
}

function mockDice (...rolls) {
	const queue = [...rolls];
	return jest.spyOn(globalThis.Renderer.dice, "parseRandomise2")
		.mockImplementation(() => {
			if (!queue.length) throw new Error("Unexpected state-die roll");
			return queue.shift();
		});
}

describe("Combat-tab active-state roll bonus/penalty dice", () => {
	test("adds a generic bonus die to a weapon attack total and labeled breakdown", async () => {
		const state = makeState();
		state.addAttack(makeAttack());
		addRollDie(state, {name: "Bless"});
		mockDice(3);
		const page = makePage(state, 11);
		const combat = makeCombat(state, page);

		await expect(combat._rollAttack("sword", {})).resolves.toBe(true);

		const result = page.showDiceResult.mock.calls[0][0];
		expect(result.total).toBe(20);
		expect(result.modifier).toBe(9);
		expect(result.subtitle).toContain("+ 3 [1d4 Bless]");
	});

	test("subtracts a generic penalty die from a weapon attack total and labeled breakdown", async () => {
		const state = makeState();
		state.addAttack(makeAttack());
		addRollDie(state, {name: "Bane", type: "rollPenalty"});
		mockDice(2);
		const page = makePage(state, 11);
		const combat = makeCombat(state, page);

		await combat._rollAttack("sword", {});

		const result = page.showDiceResult.mock.calls[0][0];
		expect(result.total).toBe(15);
		expect(result.modifier).toBe(4);
		expect(result.subtitle).toContain("- 2 [1d4 Bane]");
	});

	test("adds and labels a generic bonus die on the quick spell-attack path", () => {
		const state = makeState();
		addRollDie(state, {name: "Boldness"});
		mockDice(4);
		const page = makePage(state, 10);
		const combat = makeCombat(state, page);

		combat._rollSpellAttack({});

		const result = page.showDiceResult.mock.calls[0][0];
		expect(result.total).toBe(20);
		expect(result.modifier).toBe(10);
		expect(result.subtitle).toContain("+ 4 [1d4 Boldness]");
	});

	test("subtracts and labels a generic penalty die on the quick spell-attack path", () => {
		const state = makeState();
		addRollDie(state, {name: "Spell Bane", type: "rollPenalty"});
		mockDice(1);
		const page = makePage(state, 10);
		const combat = makeCombat(state, page);

		combat._rollSpellAttack({});

		const result = page.showDiceResult.mock.calls[0][0];
		expect(result.total).toBe(15);
		expect(result.modifier).toBe(5);
		expect(result.subtitle).toContain("- 1 [1d4 Spell Bane]");
	});

	test("does not roll or apply a die whose target does not match the attack", async () => {
		const state = makeState();
		state.addAttack(makeAttack());
		addRollDie(state, {name: "Resistance", target: "save"});
		const diceSpy = mockDice();
		const page = makePage(state, 11);
		const combat = makeCombat(state, page);

		await combat._rollAttack("sword", {});
		combat._rollSpellAttack({});

		expect(diceSpy).not.toHaveBeenCalled();
		expect(page.showDiceResult.mock.calls[0][0]).toMatchObject({total: 17, modifier: 6});
		expect(page.showDiceResult.mock.calls[1][0]).toMatchObject({total: 17, modifier: 6});
		expect(page.showDiceResult.mock.calls[0][0].subtitle).not.toContain("Resistance");
		expect(page.showDiceResult.mock.calls[1][0].subtitle).not.toContain("Resistance");
	});

	test.each([
		["stored weapon", "stored"],
		["temporary attack", "temporary"],
		["active-state attack", "activeState"],
	])("rolls the state dice exactly once for %s", async (_label, source) => {
		const state = makeState();
		const attack = makeAttack(source);
		if (source === "stored") state.addAttack(attack);
		else if (source === "temporary") state.addTemporaryAttack(attack);
		else state.getActiveStateAttacks = () => [{...attack, isActiveStateAttack: true}];
		addRollDie(state, {name: "Bless"});
		const diceSpy = mockDice(2);
		const page = makePage(state, 10);
		const rollStateDiceSpy = jest.spyOn(page, "_rollStateDiceBonuses");
		const combat = makeCombat(state, page);

		await combat._rollAttack(source, {});

		expect(rollStateDiceSpy).toHaveBeenCalledTimes(1);
		expect(rollStateDiceSpy).toHaveBeenCalledWith("attack:melee:str");
		expect(diceSpy).toHaveBeenCalledTimes(1);
	});

	test("a high bonus-die total does not create a critical hit without a critical d20", async () => {
		const state = makeState();
		state.addAttack(makeAttack());
		addRollDie(state, {name: "Bless"});
		mockDice(4, 4);
		const page = makePage(state, 19);
		const combat = makeCombat(state, page);

		await combat._rollAttack("sword", {});
		combat._rollSpellAttack({});

		for (const result of page.showDiceResult.mock.calls.map(([it]) => it)) {
			expect(result.total).toBeGreaterThan(20);
			expect(result.resultClass).toBe("");
			expect(result.resultNote).toBe("");
		}
	});

	test("post-attack Fortune rerolls retain the rolled die total and labeled source", async () => {
		const state = makeState();
		const page = makePage(state, 10);
		page._pMaybeApplyFortuneIntervention = jest.fn(async ({rollResult}) => {
			rollResult.roll = 20;
			rollResult.roll1 = 20;
			return {applied: true, effectiveRoll: 20, note: "Fortune changed the d20."};
		});
		const combat = makeCombat(state, page);
		const ctx = {
			attack: makeAttack(),
			attackId: "sword",
			rollResult: {roll: 10, roll1: 10, roll2: 10, mode: "normal", thelemar_critBonus: 0},
			totalBonus: 6,
			flatRollModifier: 6,
			rollModifier: 9,
			stateDice: {total: 3, breakdownStr: "+ 3 [1d4 Bless]"},
		};

		await combat._pOfferFortuneIntervention(ctx);

		expect(page._pMaybeApplyFortuneIntervention).toHaveBeenCalledWith(expect.objectContaining({totalMod: 9}));
		expect(page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			total: 29,
			modifier: 9,
			resultNote: expect.stringContaining("Critical Hit!"),
			subtitle: expect.stringContaining("+ 3 [1d4 Bless]"),
		}));
		expect(ctx.total).toBe(29);
		expect(ctx.rollFollowup.breakdown).toContain("+ 3 [1d4 Bless]");
	});

	test("EFA Experimental Elixir Boldness reaches both dedicated Combat-tab attack paths", async () => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Artificer",
			source: "EFA",
			level: 9,
			subclass: {name: "Alchemist", shortName: "Alchemist", source: "EFA"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("int", 16);
		state.setSpellcastingAbility("int");
		state.addAttack(makeAttack());
		const created = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "boldness",
			batchId: "combat-boldness",
			spentSlotLevel: 1,
		});
		expect(created.ok).toBe(true);
		expect(state.consumeEfaExperimentalElixir({itemId: created.itemId})).toMatchObject({
			ok: true,
			committed: true,
			effectKey: "boldness",
		});
		mockDice(3, 4);
		const page = makePage(state, 10);
		const combat = makeCombat(state, page);

		await combat._rollAttack("sword", {});
		combat._rollSpellAttack({});

		const [weaponResult, spellResult] = page.showDiceResult.mock.calls.map(([it]) => it);
		expect(weaponResult.subtitle).toContain("+ 3 [1d4 Experimental Elixir: Boldness]");
		expect(spellResult.subtitle).toContain("+ 4 [1d4 Experimental Elixir: Boldness]");
	});
});
