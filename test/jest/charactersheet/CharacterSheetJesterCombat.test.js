import "./setup.js";
import fs from "node:fs";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const TGTT = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const LAUGHING_LUNGE = TGTT.optionalfeature.find(feature => feature.name === "Laughing Lunge");

function makeCombat () {
	const state = new CharacterSheetState();
	state.addClass({name: "Bard", source: "TGTT", level: 3});
	state.setAbilityBase("str", 16);
	state.addFeature({...LAUGHING_LUNGE, featureType: "Optional Feature", optionalFeatureTypes: ["JA"]});
	const feature = state.getFeature("Laughing Lunge");
	const activationInfo = state.getActivatableFeatures().find(it => it.feature.id === feature.id).activationInfo;
	state.addActiveState("custom", {
		name: feature.name,
		sourceFeatureId: feature.id,
		duration: activationInfo.duration,
		consumeOnAttack: true,
		pendingAttack: activationInfo.pendingAttack,
	});
	state.addAttack({
		id: "longsword",
		name: "Longsword",
		isMelee: true,
		abilityMod: "str",
		damage: "1d8",
		damageType: "slashing",
	});
	state.addAttack({
		id: "fire-bolt",
		name: "Fire Bolt",
		isSpell: true,
		isRanged: true,
		abilityMod: "cha",
		damage: "1d10",
		damageType: "fire",
	});

	const rollModes = [];
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._battleTacticToggles = {};
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._flankingEnabled = false;
	const damageResults = [];
	combat._page = {
		rollD20: ({mode} = {}) => {
			rollModes.push(mode);
			return {roll: 10, mode: mode || "normal"};
		},
		getModeLabel: () => "",
		formatD20Breakdown: () => "",
		pAnimateD20: () => {},
		pAnimateDamageDice: () => {},
		showDiceResult: () => null,
		saveCharacter: () => {},
		_offerGuidedStrikePostAttack: () => {},
	};
	combat._page.showDiceResult = result => damageResults.push(result);
	combat._parseDamage = dice => ({total: dice === "1d6" ? 4 : 5, sides: 8, rolls: [dice === "1d6" ? 4 : 5]});
	combat._pushDiceGroup = () => {};
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
	combat._promptUseCombatMethod = async () => null;
	combat._getSelectedAmmoForWeapon = () => null;
	combat._getCombatLocalAttackBonus = () => ({bonus: 0, parts: []});
	combat._canRollAttackActionAttack = () => true;
	combat._offerPenetratingBlow = () => {};
	combat._recordAttackForTurn = () => {};
	combat._renderSneakAttackToggle = () => {};
	combat._isSneakAttackAvailableThisTurn = () => false;
	combat._consumeOnAttackStates = () => {};
	combat._runPostAttackHooks = async () => {};

	return {state, combat, rollModes, damageResults};
}

describe("College of Jesters combat integration", () => {
	it("applies Laughing Lunge to the next attack, transfers its damage rider, and consumes it once", async () => {
		const {state, combat, rollModes, damageResults} = makeCombat();

		expect(combat._rollAttack("longsword", null)).toBe(true);

		expect(rollModes).toEqual(["advantage"]);
		expect(combat._pendingActiveStateDamageRiders).toEqual({
			attackId: "longsword",
			rollId: 1,
			riders: [{name: "Laughing Lunge", dice: "1d6", damageType: "psychic"}],
		});
		expect(state.getPendingAttackRiders()).toEqual([]);

		expect(combat._rollAttack("longsword", null)).toBe(true);
		expect(rollModes).toEqual(["advantage", undefined]);
		expect(combat._pendingActiveStateDamageRiders.riders).toEqual([
			{name: "Laughing Lunge", dice: "1d6", damageType: "psychic"},
		]);

		await combat._rollDamage("longsword", false);
		expect(damageResults.at(-1)?.subtitle).toContain("Laughing Lunge 1d6 psychic");
		expect(combat._pendingActiveStateDamageRiders).toBeNull();
	});

	it("does not apply or consume Laughing Lunge on a spell attack", () => {
		const {state, combat, rollModes} = makeCombat();

		expect(combat._rollAttack("fire-bolt", null)).toBe(true);

		expect(rollModes).toEqual([undefined]);
		expect(combat._pendingActiveStateDamageRiders).toBeUndefined();
		expect(state.getPendingAttackRiders()).toHaveLength(1);
	});

	it("clears an unspent Laughing Lunge when combat ends", () => {
		const {state} = makeCombat();
		state.startCombat();

		expect(state.getPendingAttackRiders()).toHaveLength(1);
		state.endCombat();
		expect(state.getPendingAttackRiders()).toEqual([]);
	});
});
