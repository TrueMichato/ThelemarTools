import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function getAstralState (level, {str = 8, dex = 16, wis = 18} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Monk",
		source: "PHB",
		level,
		subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
	});
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", dex);
	state.setAbilityBase("wis", wis);
	state.setKiPoints(level);
	state.setKiPointsCurrent(level);
	return state;
}

function getCombatHarness (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {_showDiceResult: jest.fn()};
	combat.renderCombatStates = jest.fn();
	combat._resetTurnActionUsage();
	globalThis.JqueryUtil = {doToast: jest.fn()};
	return combat;
}

describe("Way of the Astral Self — computed mechanics", () => {
	it.each([
		[3, "1d4", "2d4"],
		[6, "1d6", "2d6"],
		[11, "1d8", "2d8"],
		[17, "1d10", "2d10"],
	])("uses the canonical level %i Martial Arts die for attacks and the summoning burst", (level, die, burst) => {
		const state = getAstralState(level);
		const calc = state.getFeatureCalculations();

		expect(calc.astralArmsActivationBurst).toMatchObject({
			damage: burst,
			damageType: "force",
			saveAbility: "dex",
			range: 10,
		});
		expect(state.getFeatureGrantedAttacks()).toHaveLength(0);

		state.activateState("astralArms");
		expect(state.getFeatureGrantedAttacks()).toContainEqual(expect.objectContaining({
			name: "Astral Arms",
			damage: die,
			damageType: "force",
			abilityMod: "finesseWis",
			reachBonus: 5,
			reachCondition: "onYourTurn",
			isUnarmedStrike: true,
			isFeatureAttack: true,
		}));
	});

	it("uses the best permitted STR, DEX, or WIS modifier for Astral Arms", () => {
		const state = getAstralState(3);
		state.activateState("astralArms");
		const attack = state.getFeatureGrantedAttacks()[0];
		const combat = getCombatHarness(state);

		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 18);
		state.setAbilityBase("wis", 12);
		expect(state.getWeaponAbilityMod(attack)).toBe(4);
		expect(combat._resolveAttackAbilityKey(attack, true)).toBe("dex");

		state.setAbilityBase("wis", 20);
		expect(state.getWeaponAbilityMod(attack)).toBe(5);
		expect(combat._resolveAttackAbilityKey(attack, true)).toBe("wis");
	});

	it("adds 5 feet to normal reach only on the Monk's turn", () => {
		const state = getAstralState(3);
		state._data.namedModifiers.push({name: "Long-Limbed", type: "reach", value: 5, enabled: true});
		state.activateState("astralArms");
		const attack = state.getFeatureGrantedAttacks()[0];

		expect(state.getMeleeReach()).toBe(10);
		expect(state.getAttackReach(attack, {isOwnTurn: true})).toBe(15);
		expect(state.getAttackReach(attack, {isOwnTurn: false})).toBe(10);
	});

	it("uses Wisdom for Strength checks and saves only while the arms are active", () => {
		const state = getAstralState(3);
		expect(state.getAbilityCheckBreakdown("str").total).toBe(-1);
		expect(state.getSaveMod("str")).toBe(-1);

		state.activateState("astralArms");
		expect(state.getActiveAbilitySubstitution("check:str")).toBe("wis");
		expect(state.getAbilityCheckBreakdown("str")).toMatchObject({total: 4});
		expect(state.getAbilityCheckBreakdown("str").components[0].name).toContain("substitution");
		expect(state.getSaveMod("str")).toBe(4);

		state.deactivateState("astralArms");
		expect(state.getAbilityCheckBreakdown("str").total).toBe(-1);
	});

	it("resolves the summoning burst with the Monk save DC", () => {
		const state = getAstralState(3);
		state.activateState("astralArms");

		expect(state.getActiveStateTrigger("astralArms")).toMatchObject({
			label: "Summoning Burst",
			actionType: "free",
			effect: {
				resolvedDamage: "2d4",
				resolvedDc: 14,
				damageType: "force",
				saveAbility: "dex",
				range: 10,
			},
		});
	});

	it("grants Visage sight, skill advantage, and both speech modes only while active", () => {
		const state = getAstralState(6);
		state.activateState("astralVisage");

		expect(state.getSense("darkvision")).toBe(120);
		expect(state.getAdvantageState("skill:insight")).toMatchObject({advantage: true});
		expect(state.getAdvantageState("skill:intimidation")).toMatchObject({advantage: true});
		expect(state.getActiveStateTrigger("astralVisage").effect.choices).toEqual([
			expect.objectContaining({id: "private", range: 60}),
			expect.objectContaining({id: "amplified", range: 600}),
		]);

		state.deactivateState("astralVisage");
		expect(state.getSense("darkvision")).toBe(0);
		expect(state.getAdvantageState("skill:insight").advantage).toBe(false);
	});

	it("gates Body behind Arms and Visage and cascades teardown", () => {
		const state = getAstralState(11);
		expect(state.activateState("astralBody")).toBeNull();

		state.activateState("astralArms");
		state.activateState("astralVisage");
		expect(state.activateState("astralBody")).not.toBeNull();
		expect(state.getFeatureCalculations().weaponDamageRiders).toContainEqual(expect.objectContaining({
			id: "empowered-arms",
			dice: "1d8",
			attackSourceFeature: "Astral Arms",
		}));

		state.deactivateState("astralVisage");
		expect(state.isStateTypeActive("astralBody")).toBe(false);
		expect(state.getFeatureCalculations().weaponDamageRiders || []).not.toContainEqual(expect.objectContaining({id: "empowered-arms"}));
	});

	it("activates the complete Awakened form, adds 2 AC, and removes it as one state", () => {
		const state = getAstralState(17);
		const baseAc = state.getAc();

		state.activateState("awakenedAstralSelf");
		expect(state.isStateTypeActive("astralArms")).toBe(true);
		expect(state.isStateTypeActive("astralVisage")).toBe(true);
		expect(state.isStateTypeActive("astralBody")).toBe(true);
		expect(state.getAc()).toBe(baseAc + 2);

		state.deactivateState("awakenedAstralSelf");
		expect(state.getAc()).toBe(baseAc);
		expect(state.isStateTypeActive("astralArms")).toBe(false);
		expect(state.isStateTypeActive("astralVisage")).toBe(false);
		expect(state.isStateTypeActive("astralBody")).toBe(false);
	});

	it("ends every manifested component at 0 HP or when incapacitated", () => {
		const state = getAstralState(17);
		state.activateState("awakenedAstralSelf");
		state.setCurrentHp(0);
		for (const stateTypeId of ["astralArms", "astralVisage", "astralBody", "awakenedAstralSelf"]) {
			expect(state.isStateTypeActive(stateTypeId)).toBe(false);
		}

		state.setCurrentHp(1);
		state.activateState("awakenedAstralSelf");
		state._resolveConditionEffects = jest.fn().mockReturnValue({effects: [{type: "incapacitated", value: true}]});
		state.addCondition("incapacitated");
		for (const stateTypeId of ["astralArms", "astralVisage", "astralBody", "awakenedAstralSelf"]) {
			expect(state.isStateTypeActive(stateTypeId)).toBe(false);
		}
	});
});

describe("Way of the Astral Self — combat execution", () => {
	it("offers only eligible Deflect Energy types and consumes one reaction", async () => {
		const state = getAstralState(11);
		state.activateState("astralArms");
		state.activateState("astralVisage");
		state.activateState("astralBody");
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		combat._parseDamage = jest.fn().mockReturnValue({total: 6});
		combat._showCombatActionChoiceModal = jest.fn().mockResolvedValue({damageType: "fire"});

		await expect(combat._useActiveStateTrigger("astralBody")).resolves.toBe(true);
		expect(combat._showCombatActionChoiceModal.mock.calls[0][1].map(it => it.id)).toEqual([
			"acid", "cold", "fire", "force", "lightning", "thunder",
		]);
		expect(combat._page._showDiceResult).toHaveBeenCalledWith(
			"Body of the Astral Self — Deflect Energy",
			10,
			"1d10 + WIS fire damage reduction",
		);
		expect(combat._useActiveStateTrigger("astralBody")).toBe(false);
	});

	it("keeps Astral Barrage at three attacks only while the Attack action contains Astral Arms attacks", () => {
		const state = getAstralState(17);
		state.activateState("awakenedAstralSelf");
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		const astralAttack = state.getFeatureGrantedAttacks()[0];

		expect(combat._getAttackActionAllowance(astralAttack)).toBe(3);
		combat._recordAttackForTurn(astralAttack);
		expect(combat._getAttackActionAllowance(astralAttack)).toBe(3);
		expect(combat._canRollAttackActionAttack(astralAttack)).toBe(true);
		combat._recordAttackForTurn(astralAttack);
		combat._recordAttackForTurn(astralAttack);
		expect(combat._canRollAttackActionAttack(astralAttack)).toBe(false);

		combat._resetTurnActionUsage();
		combat._recordAttackForTurn(astralAttack);
		combat._recordAttackForTurn({name: "Quarterstaff", actionType: "action"});
		expect(combat._getAttackActionAllowance(astralAttack)).toBe(2);
		expect(combat._canRollAttackActionAttack(astralAttack)).toBe(false);
	});

	it("limits Empowered Arms to the Astral Arms attack row", () => {
		const state = getAstralState(11);
		state.activateState("astralArms");
		state.activateState("astralVisage");
		state.activateState("astralBody");
		const combat = getCombatHarness(state);
		const rider = state.getFeatureCalculations().weaponDamageRiders.find(it => it.id === "empowered-arms");

		expect(combat._isWeaponDamageRiderEligible(rider, state.getFeatureGrantedAttacks()[0])).toBe(true);
		expect(combat._isWeaponDamageRiderEligible(rider, {name: "Unarmed Strike", isUnarmedStrike: true})).toBe(false);
		expect(combat._isWeaponDamageRiderEligible(rider, {name: "Quarterstaff"})).toBe(false);
	});

	it("does not qualify bonus-action, reaction, or spell attacks for Astral Barrage", () => {
		const state = getAstralState(17);
		state.activateState("awakenedAstralSelf");
		state._data.inCombat = true;
		const combat = getCombatHarness(state);
		const astralAttack = state.getFeatureGrantedAttacks()[0];

		for (const attack of [
			{name: "Bonus Strike", actionType: "bonus"},
			{name: "Reaction Strike", actionType: "reaction"},
			{name: "Fire Bolt", actionType: "action", isSpellAttack: true},
		]) combat._recordAttackForTurn(attack);

		expect(combat._turnAttackUsage.hasAttackAction).toBe(false);
		expect(combat._getAttackActionAllowance(astralAttack)).toBe(3);
	});
});
