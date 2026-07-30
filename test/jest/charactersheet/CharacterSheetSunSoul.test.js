import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function getSunSoulState (level, {dex = 16, wis = 16} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Monk",
		source: "PHB",
		level,
		subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
	});
	state.setAbilityBase("dex", dex);
	state.setAbilityBase("wis", wis);
	state.setKiPoints(level);
	state.setKiPointsCurrent(level);
	return state;
}

function getCombatHarness (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {
		_renderFeatures: jest.fn(),
		_renderResources: jest.fn(),
		_saveCurrentCharacter: jest.fn(),
		_showDiceResult: jest.fn(),
	};
	combat.renderCombatActions = jest.fn();
	combat.renderCombatResources = jest.fn();
	combat.renderCombatStates = jest.fn();
	combat.renderCombatActionEconomy = jest.fn();
	combat._resetTurnActionUsage();
	globalThis.JqueryUtil = {doToast: jest.fn()};
	return combat;
}

describe("Way of the Sun Soul — computed mechanics", () => {
	it.each([
		[3, "1d4"],
		[5, "1d6"],
		[11, "1d8"],
		[17, "1d10"],
	])("builds a rollable Radiant Sun Bolt using the level %i Martial Arts die", (level, die) => {
		const state = getSunSoulState(level);
		const calc = state.getFeatureCalculations();
		const attack = state.getFeatureGrantedAttacks().find(it => it.sourceFeature === "Radiant Sun Bolt");

		expect(calc.radiantSunBoltAttackBonus).toBe(state.getProficiencyBonus() + 3);
		expect(calc.radiantSunBoltDamageBonus).toBe(3);
		expect(attack).toMatchObject({
			damage: die,
			damageType: "radiant",
			range: "30 ft.",
			abilityMod: "dex",
			isSpellAttack: true,
			isFeatureAttack: true,
		});
	});

	it("caps Searing Arc Strike spend at half the Monk level and computes the Ki DC", () => {
		const state = getSunSoulState(6);
		const calc = state.getFeatureCalculations();

		expect(calc.searingArcStrikeCost).toBe(2);
		expect(calc.searingArcStrikeMaxCost).toBe(3);
		expect(calc.searingArcStrikeMaxSpellLevel).toBe(2);
		expect(calc.searingArcStrikeDc).toBe(14);
	});

	it("computes Searing Sunburst range, radius, scaling cap, and Ki DC", () => {
		const state = getSunSoulState(11);
		const calc = state.getFeatureCalculations();

		expect(calc.searingSunburstDc).toBe(15);
		expect(calc.searingSunburstRange).toBe(150);
		expect(calc.searingSunburstRadius).toBe(20);
		expect(calc.searingSunburstMaxCost).toBe(3);
		expect(calc.searingSunburstDamagePerKi).toBe("2d6");
	});

	it("resolves Sun Shield retaliation from the active state as 5 + WIS radiant damage", () => {
		const state = getSunSoulState(17, {wis: 18});
		state.activateState("sunShield");

		const trigger = state.getActiveStateTrigger("sunShield");
		expect(trigger).toMatchObject({
			label: "Retaliate",
			actionType: "reaction",
			effect: {
				type: "retaliationDamage",
				damageType: "radiant",
				resolvedValue: 9,
			},
		});
		expect(CharacterSheetState.summarizeEffects(CharacterSheetState.ACTIVE_STATE_TYPES.sunShield.effects))
			.toContain("5 + WIS mod radiant damage");
	});
});

describe("Way of the Sun Soul — combat execution", () => {
	it("assembles each bonus-action Radiant Sun Bolt with the computed attack and damage bonuses", () => {
		const state = getSunSoulState(5);
		const combat = getCombatHarness(state);
		combat._rollCombatActionDice = jest.fn((feature, config) => config);
		const attack = state.getFeatureGrantedAttacks()[0];

		const results = combat._executeFeatureAttackVolley({name: "Radiant Sun Bolt"}, {attack, count: 2});

		expect(results).toHaveLength(2);
		expect(combat._rollCombatActionDice).toHaveBeenNthCalledWith(1, expect.anything(), {type: "attack", attackBonus: 6});
		expect(combat._rollCombatActionDice).toHaveBeenNthCalledWith(2, expect.anything(), {
			type: "damage",
			formula: "1d6+3",
			label: "radiant damage",
		});
	});

	it("deducts 1 Ki and executes two Radiant Sun Bolt attacks", async () => {
		const state = getSunSoulState(3);
		const combat = getCombatHarness(state);
		combat._executeFeatureAttackVolley = jest.fn();

		await combat._useCombatAction({
			name: "Radiant Sun Bolt",
			source: "XGE",
			description: "As a bonus action, spend 1 ki point to make the special attack twice.",
		});

		expect(state.getKiPointsCurrent()).toBe(2);
		expect(combat._executeFeatureAttackVolley).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({count: 2}));
	});

	it("requires a Radiant Sun Bolt attack before its bonus-action volley in combat", async () => {
		const state = getSunSoulState(3);
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		combat._executeFeatureAttackVolley = jest.fn();
		const feature = {
			name: "Radiant Sun Bolt",
			source: "XGE",
			description: "As a bonus action, spend 1 ki point to make the special attack twice.",
		};

		await combat._useCombatAction(feature);
		expect(state.getKiPointsCurrent()).toBe(3);
		expect(combat._executeFeatureAttackVolley).not.toHaveBeenCalled();

		combat._recordAttackForTurn(state.getFeatureGrantedAttacks()[0]);
		await combat._useCombatAction(feature);
		expect(state.getKiPointsCurrent()).toBe(2);
		expect(combat._executeFeatureAttackVolley).toHaveBeenCalledTimes(1);
	});

	it("deducts the selected Searing Arc Strike spend and scales Burning Hands", async () => {
		const state = getSunSoulState(6);
		const combat = getCombatHarness(state);
		combat._pChooseVariablePointSpend = jest.fn().mockResolvedValue(3);
		combat._executeFeatureSaveDamage = jest.fn();

		await combat._useCombatAction({
			name: "Searing Arc Strike",
			source: "XGE",
			description: "Immediately after the Attack action, cast Burning Hands as a bonus action.",
		});

		expect(state.getKiPointsCurrent()).toBe(3);
		expect(combat._executeFeatureSaveDamage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			dc: 14,
			saveAbility: "dex",
			damage: "4d6",
			damageType: "fire",
		}));
	});

	it("requires an attack before Searing Arc Strike in combat", async () => {
		const state = getSunSoulState(6);
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		combat._pChooseVariablePointSpend = jest.fn().mockResolvedValue(2);
		combat._executeFeatureSaveDamage = jest.fn();
		const feature = {
			name: "Searing Arc Strike",
			source: "XGE",
			description: "Immediately after the Attack action, cast Burning Hands as a bonus action.",
		};

		await combat._useCombatAction(feature);
		expect(state.getKiPointsCurrent()).toBe(6);
		expect(combat._pChooseVariablePointSpend).not.toHaveBeenCalled();

		combat._recordAttackForTurn({name: "Fire Bolt", isSpellAttack: true, actionType: "action"});
		combat._recordAttackForTurn({name: "Variant Spell Attack", abilityMod: "spellcasting", sourceSpell: "Fire Bolt", actionType: "action"});
		await combat._useCombatAction(feature);
		expect(state.getKiPointsCurrent()).toBe(6);
		expect(combat._pChooseVariablePointSpend).not.toHaveBeenCalled();

		combat._recordAttackForTurn({name: "Quarterstaff", actionType: "action"});
		await combat._useCombatAction(feature);
		expect(state.getKiPointsCurrent()).toBe(4);
		expect(combat._executeFeatureSaveDamage).toHaveBeenCalledTimes(1);
	});

	it("deducts the selected Searing Sunburst spend and adds 2d6 per point", async () => {
		const state = getSunSoulState(11);
		const combat = getCombatHarness(state);
		combat._pChooseVariablePointSpend = jest.fn().mockResolvedValue(2);
		combat._executeFeatureSaveDamage = jest.fn();

		await combat._useCombatAction({
			name: "Searing Sunburst",
			source: "XGE",
			description: "As an action, hurl an orb of light.",
		});

		expect(state.getKiPointsCurrent()).toBe(9);
		expect(combat._executeFeatureSaveDamage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			dc: 15,
			saveAbility: "con",
			damage: "6d6",
			damageType: "radiant",
		}));
	});

	it("uses Sun Shield retaliation and consumes the reaction in combat", () => {
		const state = getSunSoulState(17);
		state.activateState("sunShield");
		state._data.inCombat = true;
		const combat = getCombatHarness(state);

		expect(combat._useActiveStateTrigger("sunShield")).toBe(true);
		expect(combat._turnActionUsage.reaction).toBe(true);
		expect(combat._page._showDiceResult).toHaveBeenCalledWith(
			"Sun Shield — Retaliate",
			8,
			"8 radiant damage to the melee attacker",
		);
		expect(combat._useActiveStateTrigger("sunShield")).toBe(false);
	});

	it("consumes a bonus action when Sun Shield is restored or extinguished in combat", () => {
		const state = getSunSoulState(17);
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.sunShield;

		expect(combat._tryConsumeStateToggleAction(stateType)).toBe(true);
		expect(combat._turnActionUsage.bonus).toBe(true);
		expect(combat._tryConsumeStateToggleAction(stateType)).toBe(false);
	});
});
