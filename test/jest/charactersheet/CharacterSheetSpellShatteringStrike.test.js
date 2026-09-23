import "./setup.js";
import {jest} from "@jest/globals";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const TGTT_PATH = path.resolve(__dirnameLocal, "../../../homebrew/TravelersGuidetoThelemar.json");
const TGTT = JSON.parse(fs.readFileSync(TGTT_PATH, "utf8"));
const SPELL_SHATTERING = TGTT.combatMethod.find(it => it.name === "Spell Shattering Strike" && it.source === "TGTT");
const CATCH_YOUR_BREATH = TGTT.combatMethod.find(it => it.name === "Catch Your Breath" && it.source === "TGTT");
const KNOCKDOWN = TGTT.combatMethod.find(it => it.name === "Knockdown" && it.source === "TGTT");
const REACTIVE_WARD = TGTT.combatMethod.find(it => it.name === "Reactive Ward" && it.source === "TGTT");

function makeCombat (state, page = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = page;
	return combat;
}

function makeSpellShatteringState ({stamina = 2} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.addCombatTradition("Tempered Iron");
	state.addFeature({...SPELL_SHATTERING, _entityType: "combatMethod"});
	state.setStaminaMax(6);
	state.setStaminaCurrent(stamina);
	return state;
}

describe("Spell Shattering Strike authored data", () => {
	test("keeps degree and authored cost independent", () => {
		expect(SPELL_SHATTERING).toMatchObject({
			degree: 4,
			staminaCost: 2,
			actionType: "reaction",
		});
	});

	test("has exactly four ordered d4 outcomes with self-contained mechanics", () => {
		const random = CharacterSheetClassUtils.getMethodRandomOutcomes(SPELL_SHATTERING);

		expect(random.die).toBe("1d4");
		expect(random.options.map(it => it.roll)).toEqual([1, 2, 3, 4]);
		expect(random.options[0].effectText).toMatch(/Speed is reduced to 0/i);
		expect(random.options[1].effectText).toMatch(/Confused until the end of its next turn/i);
		expect(random.options[1].effectText).toMatch(/cannot take reactions/i);
		expect(random.options[1].effectText).toMatch(/1.?2.*random direction.*no action/i);
		expect(random.options[1].effectText).toMatch(/3.?4.*does not move or take an action/i);
		expect(random.options[1].effectText).toMatch(/5.?6.*acts and moves normally/i);
		expect(random.options[2].effectText).toMatch(/disadvantage on checks made to concentrate on spells/i);
		expect(random.options[2].effectText).toMatch(/until it succeeds on a concentration check/i);
		expect(random.options[3].effectText).toMatch(/Stunned until the end of its next turn/i);
		expect(random.options[3].effectText).toMatch(/Rattled for 1 minute/i);
		expect(random.options[3].effectText).toMatch(/disadvantage on ability checks and saving throws/i);
	});

	test("does not classify unrelated list-bearing methods as random outcomes", () => {
		const unrelated = {
			name: "Choose a Technique",
			entries: [
				"Choose one of the following benefits:",
				{
					type: "list",
					items: [
						{type: "item", name: "1. First.", entries: ["First effect."]},
						{type: "item", name: "2. Second.", entries: ["Second effect."]},
					],
				},
			],
		};

		expect(CharacterSheetClassUtils.getMethodRandomOutcomes(unrelated)).toBeNull();
	});
});

describe("Combat Method authored Stamina costs", () => {
	test("desktop resolves Spell Shattering as cost 2 rather than degree 4", () => {
		const combat = makeCombat({});
		expect(combat._getMethodStaminaCost(SPELL_SHATTERING)).toBe(2);
	});

	test("desktop resolves another degree/cost mismatch from the structured cost", () => {
		expect(CATCH_YOUR_BREATH.degree).toBe(1);
		expect(CATCH_YOUR_BREATH.staminaCost).toBe(2);
		expect(makeCombat({})._getMethodStaminaCost(CATCH_YOUR_BREATH)).toBe(2);
	});

	test("preserves an authored zero cost", () => {
		expect(KNOCKDOWN.staminaCost).toBe(0);
		expect(CharacterSheetClassUtils.getMethodStaminaCostMeta(KNOCKDOWN)).toEqual({
			isVariable: false,
			min: 0,
			max: 0,
			cost: 0,
			display: "0",
		});
	});

	test("recognizes an authored variable range without falling back to degree", () => {
		expect(REACTIVE_WARD.degree).toBe(3);
		expect(CharacterSheetClassUtils.getMethodStaminaCostMeta(REACTIVE_WARD)).toEqual({
			isVariable: true,
			min: 1,
			max: 3,
			cost: null,
			display: "1–3",
		});
	});
});

describe("Spell Shattering Strike action transaction", () => {
	test.each([
		[1, /Speed is reduced to 0/i],
		[2, /Confused until the end of its next turn/i],
		[3, /disadvantage on checks made to concentrate on spells/i],
		[4, /Stunned until the end of its next turn.*Rattled for 1 minute/i],
	])("fresh d4 roll %i spends 2 and resolves the matching DC reminder", async (roll, expectedEffect) => {
		const state = makeSpellShatteringState();
		const page = {
			rollDice: jest.fn(() => roll),
			_saveCurrentCharacter: jest.fn(async () => {}),
		};
		const combat = makeCombat(state, page);

		const result = await combat._pUseCombatMethod(SPELL_SHATTERING);

		expect(result).toMatchObject({
			ok: true,
			cost: 2,
			resource: "stamina",
			methodDc: 14,
			outcome: {roll},
		});
		expect(result.message).toMatch(/DC 14 Wisdom/i);
		expect(result.message).toMatch(/if the attack hits and the target fails/i);
		expect(result.message).toMatch(expectedEffect);
		expect(state.getStaminaCurrent()).toBe(0);
		expect(page.rollDice).toHaveBeenCalledWith(1, 4);
		expect(page._saveCurrentCharacter).toHaveBeenCalled();
		expect(state.toJson()).not.toHaveProperty("lastCombatMethodOutcome");
	});

	test("zero Stamina blocks without rolling, saving, or partial mutation", async () => {
		const state = makeSpellShatteringState({stamina: 0});
		const page = {
			rollDice: jest.fn(() => 4),
			_saveCurrentCharacter: jest.fn(async () => {}),
		};
		const combat = makeCombat(state, page);
		const before = state.toJson();

		const result = await combat._pUseCombatMethod(SPELL_SHATTERING);

		expect(result).toMatchObject({ok: false, reason: "insufficient-stamina", cost: 2});
		expect(state.toJson()).toEqual(before);
		expect(page.rollDice).not.toHaveBeenCalled();
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test("a fixed zero-cost method succeeds at zero Stamina", async () => {
		const state = new CharacterSheetState();
		state.addFeature({...KNOCKDOWN, _entityType: "combatMethod"});
		state.setStaminaMax(0);
		state.setStaminaCurrent(0);
		const page = {_saveCurrentCharacter: jest.fn(async () => {})};
		const combat = makeCombat(state, page);

		const result = await combat._pUseCombatMethod(KNOCKDOWN);

		expect(result).toMatchObject({ok: true, cost: 0, resource: "stamina"});
		expect(state.getStaminaCurrent()).toBe(0);
		expect(page._saveCurrentCharacter).toHaveBeenCalled();
	});

	test("a variable-cost method spends the selected amount and persists it", async () => {
		const state = new CharacterSheetState();
		state.addFeature({...REACTIVE_WARD, _entityType: "combatMethod"});
		state.setStaminaMax(6);
		state.setStaminaCurrent(3);
		let saved = null;
		const page = {_saveCurrentCharacter: jest.fn(async () => { saved = state.toJson(); })};
		const combat = makeCombat(state, page);

		const result = await combat._pUseCombatMethod(REACTIVE_WARD, {requestedCost: 2});

		expect(result).toMatchObject({ok: true, cost: 2, resource: "stamina"});
		expect(state.getStaminaCurrent()).toBe(1);
		expect(page._saveCurrentCharacter).toHaveBeenCalled();
		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		expect(restored.getStaminaCurrent()).toBe(1);
	});

	test("cancelling a variable cost choice does not mutate or save", async () => {
		const state = new CharacterSheetState();
		state.addFeature({...REACTIVE_WARD, _entityType: "combatMethod"});
		state.setStaminaMax(6);
		state.setStaminaCurrent(3);
		const page = {_saveCurrentCharacter: jest.fn(async () => {})};
		const combat = makeCombat(state, page);
		const originalPicker = globalThis.InputUiUtil.pGetUserNumber;
		globalThis.InputUiUtil.pGetUserNumber = jest.fn(async () => null);
		const before = state.toJson();

		let result;
		try {
			result = await combat._pUseCombatMethod(REACTIVE_WARD);
		} finally {
			if (originalPicker) globalThis.InputUiUtil.pGetUserNumber = originalPicker;
			else delete globalThis.InputUiUtil.pGetUserNumber;
		}

		expect(result).toMatchObject({ok: false, reason: "cancelled"});
		expect(state.toJson()).toEqual(before);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test("focus gating happens before a ki/focus fallback can spend or roll", async () => {
		const method = {name: "Predator Method", source: "TGTT", staminaCost: 2, requiresFocus: "predator"};
		const state = {
			_findCombatMethodFeature: jest.fn(() => method),
			isStanceActive: jest.fn(() => false),
			isCombatMethodFocusBlocked: jest.fn(() => true),
			getStaminaCurrent: jest.fn(() => 0),
			getKiPointsCurrent: jest.fn(() => 5),
			canUseFocusForStamina: jest.fn(() => true),
			useFocusForStamina: jest.fn(() => true),
		};
		const page = {
			rollDice: jest.fn(() => 1),
			_saveCurrentCharacter: jest.fn(async () => {}),
		};
		const combat = makeCombat(state, page);

		const result = await combat._pUseCombatMethod(method);

		expect(result).toMatchObject({ok: false, reason: "focus-blocked"});
		expect(state.useFocusForStamina).not.toHaveBeenCalled();
		expect(page.rollDice).not.toHaveBeenCalled();
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test("dispatch failure restores the full snapshot without saving or success feedback", async () => {
		const method = {
			name: "Unresolvable Stance",
			source: "TGTT",
			_entityType: "combatMethod",
			tradition: "Tempered Iron",
			degree: 2,
			staminaCost: 2,
			entries: ["Bonus Action (2 Stamina Points). This stance lasts for 1 minute."],
		};
		const state = new CharacterSheetState();
		state.addFeature(method);
		state.setStaminaMax(6);
		state.setStaminaCurrent(3);
		state.activateStance = jest.fn(() => false);
		const page = {
			_saveCurrentCharacter: jest.fn(async () => {}),
			_renderActiveStates: jest.fn(),
			_renderCharacter: jest.fn(),
		};
		const combat = makeCombat(state, page);
		combat.renderCombatStates = jest.fn();
		combat.renderCombatEffects = jest.fn();
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast").mockImplementation(() => {});
		const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		const before = state.toJson();

		let result;
		try {
			result = await combat._pUseCombatMethod(method);
			expect(toastSpy).not.toHaveBeenCalled();
		} finally {
			toastSpy.mockRestore();
			errorSpy.mockRestore();
		}

		expect(result).toMatchObject({ok: false, reason: "dispatch-failed", cost: 2});
		expect(state.toJson()).toEqual(before);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(page._renderCharacter).not.toHaveBeenCalled();
	});
});

describe("Spell Shattering Strike save/load repair", () => {
	test("refreshes a pre-fix learned snapshot from the exact catalog match", () => {
		const staleEntry = SPELL_SHATTERING.entries[0];
		const state = new CharacterSheetState();
		state.loadFromJson({
			features: [{
				name: SPELL_SHATTERING.name,
				source: SPELL_SHATTERING.source,
				_entityType: "combatMethod",
				tradition: SPELL_SHATTERING.tradition,
				degree: SPELL_SHATTERING.degree,
				staminaCost: SPELL_SHATTERING.staminaCost,
				actionType: SPELL_SHATTERING.actionType,
				entries: [staleEntry],
				description: staleEntry,
			}],
		});
		state.setCombatMethodCatalog([{...SPELL_SHATTERING, _entityType: "combatMethod"}]);
		state._repairCombatMethodMarkers();

		const stored = state.getFeatures().find(it => it.name === SPELL_SHATTERING.name);
		expect(CharacterSheetClassUtils.getMethodRandomOutcomes(stored)?.options).toHaveLength(4);
		expect(stored.description).toMatch(/Confused/i);
	});

	test("persists the learned method and four-option capability, but not the last roll", () => {
		const state = makeSpellShatteringState();
		const saved = state.toJson();
		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		restored.setCombatMethodCatalog([{...SPELL_SHATTERING, _entityType: "combatMethod"}]);
		restored._repairCombatMethodMarkers();

		const method = restored.getCombatMethods().find(it => it.name === SPELL_SHATTERING.name);
		expect(method.randomOutcomes.options).toHaveLength(4);
		expect(restored.toJson()).not.toHaveProperty("lastCombatMethodOutcome");
	});
});
