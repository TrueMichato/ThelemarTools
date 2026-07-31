import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const TDCSR = "TalDoreiCampaignSettingReborn";

function getState (level, {str = 18, subclassSource = TDCSR, classSource = "PHB"} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", str);
	state.addClass({
		name: "Barbarian",
		source: classSource,
		level,
		subclass: {name: "Path of the Juggernaut", shortName: "Juggernaut", source: subclassSource},
	});
	return state;
}

function getCombat (state, choices = []) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {_showDiceResult: jest.fn(), showDiceResult: jest.fn(), pAnimateDamageDice: jest.fn()};
	combat._resetTurnActionUsage();
	combat._showCombatActionChoiceModal = jest.fn(async () => choices.shift() || null);
	return combat;
}

function getDamageCombat (state, target) {
	state.addAttack({name: "Maul", damage: "1d8", damageType: "bludgeoning", abilityMod: "str", isMelee: true});
	const attack = state.getAttacks().find(it => it.name === "Maul");
	const combat = getCombat(state);
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._parseDamage = jest.fn((formula, isCrit = false) => ({
		total: formula === "1d8" ? (isCrit ? 16 : 4) : 0,
		sides: 8,
		rolls: isCrit ? [8, 8] : [4],
	}));
	combat._promptUseCombatMethod = jest.fn(async () => null);
	combat._pChooseJuggernautTargetContext = jest.fn(async () => target);
	combat._pResolveJuggernautHitEffects = jest.fn(async () => "");
	combat._canApplySneakAttack = jest.fn(() => false);
	combat._resolveChannelRiderDamage = jest.fn(() => ({
		channelSpell: null,
		channelSpellRoll: null,
		channelSpellDamage: 0,
		riderMatched: false,
	}));
	combat._consumeBattleMasterDamage = jest.fn(() => ({damage: 0, name: null}));
	combat._getSelectedAmmoForWeapon = jest.fn(() => null);
	combat._getWeaponUpgradeDamageRiders = jest.fn(() => []);
	return {combat, attack};
}

describe("Path of the Juggernaut — feature calculations", () => {
	it.each([
		[3, {push: 5, demolishing: false, hurricane: false, unstoppable: false}],
		[6, {push: 5, demolishing: true, hurricane: false, unstoppable: false}],
		[10, {push: 10, demolishing: true, hurricane: true, unstoppable: false}],
		[14, {push: 10, demolishing: true, hurricane: true, unstoppable: true}],
	])("gates and scales mechanics at Barbarian level %i", (level, expected) => {
		const calc = getState(level).getFeatureCalculations();
		expect(calc.thunderousBlowsDistance).toBe(expected.push);
		expect(!!calc.hasDemolishingMight).toBe(expected.demolishing);
		expect(!!calc.hasHurricaneStrike).toBe(expected.hurricane);
		expect(!!calc.hasUnstoppable).toBe(expected.unstoppable);
		expect(calc.juggernautSaveDc).toBe(8 + getState(level).getProficiencyBonus() + 4);
	});

	it("accepts the authoritative source and the pinned TGTT-2014 adapter only", () => {
		expect(getState(3, {classSource: "TGTT", subclassSource: "TGTT-2014"}).getFeatureCalculations().hasThunderousBlows).toBe(true);

		const state = getState(14);
		state.getClasses()[0].subclass.source = "HB";
		expect(state.getFeatureCalculations().hasThunderousBlows).toBeFalsy();
	});
});

describe("Path of the Juggernaut — Rage and stance states", () => {
	it("augments canonical Rage with Spirit of the Mountain without leaking to other Barbarians", () => {
		const juggernaut = getState(3);
		juggernaut.activateState("rage");
		expect(juggernaut.hasConditionImmunityFromStates("prone")).toBe(true);
		expect(juggernaut.hasForcedMovementImmunityFromStates("ground")).toBe(true);

		const berserker = new CharacterSheetState();
		berserker.addClass({name: "Barbarian", source: "PHB", level: 3, subclass: {name: "Path of the Berserker", source: "PHB"}});
		berserker.activateState("rage");
		expect(berserker.hasConditionImmunityFromStates("prone")).toBe(false);
	});

	it("suppresses an existing condition while immune and restores it when Rage ends", () => {
		const state = getState(14);
		state.addCondition({name: "Stunned", source: "XPHB"});
		expect(state.getActiveStateEffects().some(it => it.isCondition && it.conditionName === "Stunned")).toBe(true);

		state.activateState("rage");
		expect(state.hasCondition("Stunned")).toBe(true);
		expect(state.getActiveStateEffects().some(it => it.isCondition && it.conditionName === "Stunned")).toBe(false);

		state.deactivateState("rage");
		expect(state.getActiveStateEffects().some(it => it.isCondition && it.conditionName === "Stunned")).toBe(true);
	});

	it("ignores Slowed speed reduction only while Unstoppable Rage is active", () => {
		const state = getState(14);
		state.addCondition({name: "Slowed", source: "XPHB"});
		expect(state.getWalkSpeed()).toBe(15);
		state.activateState("rage");
		expect(state.getWalkSpeed()).toBe(30);
		state.deactivateState("rage");
		expect(state.getWalkSpeed()).toBe(15);
	});

	it("registers Resolute Stance as a free start-of-turn state with real defenses", () => {
		const state = getState(6);
		state.addFeature({name: "Resolute Stance", source: TDCSR, level: 6, className: "Barbarian", isSubclassFeature: true});
		state.activateState("resoluteStance");

		expect(state.getActiveStateTrigger("resoluteStance")).toMatchObject({label: "Enter Stance", actionType: "free"});
		expect(state.hasConditionImmunityFromStates("grappled")).toBe(true);
		expect(state.hasDisadvantageFromStates("attack")).toBe(true);
		expect(state.getActiveStateEffects()).toContainEqual(expect.objectContaining({type: "disadvantage", target: "attacksAgainst"}));
	});
});

describe("Path of the Juggernaut — attack-integrated choices", () => {
	it("does not materialize Demolishing Might's conditional die as a standalone natural weapon", () => {
		const state = getState(6);
		state.addFeature({
			name: "Demolishing Might",
			description: "Your melee weapon attacks deal an extra 1d8 damage against constructs.",
		});
		expect(state.getAttacks().some(it => it.name === "Demolishing Might")).toBe(false);
	});

	it("collects Demolishing Might target context only for melee weapon hits", async () => {
		const state = getState(6);
		const combat = getCombat(state, [{id: "construct"}]);
		await expect(combat._pChooseJuggernautTargetContext({isMelee: true, isSpell: false})).resolves.toBe("construct");
		expect(combat._showCombatActionChoiceModal).toHaveBeenCalledWith(
			expect.objectContaining({name: expect.stringContaining("Target")}),
			expect.arrayContaining([
				expect.objectContaining({id: "construct"}),
				expect.objectContaining({id: "object"}),
				expect.objectContaining({id: "structure"}),
			]),
		);
		await expect(combat._pChooseJuggernautTargetContext({isMelee: false, isRanged: true, isSpell: false})).resolves.toBe("normal");
	});

	it("adds a crit-compatible d8 against constructs", async () => {
		const {combat, attack} = getDamageCombat(getState(6), "construct");
		await combat._rollDamage(attack.id, true);
		expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			total: 36,
			subtitle: expect.stringContaining("Demolishing Might 1d8"),
		}));
	});

	it("doubles the final damage total against objects and structures", async () => {
		for (const target of ["object", "structure"]) {
			const {combat, attack} = getDamageCombat(getState(6), target);
			await combat._rollDamage(attack.id, false);
			expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
				total: "8 × 2 = 16",
				subtitle: expect.stringContaining(`×2 vs ${target}`),
			}));
		}
	});

	it("resolves Thunderous Blows distance/direction and a Huge target save", async () => {
		const state = getState(10);
		state.activateState("rage");
		const combat = getCombat(state, [
			{id: "push"},
			{id: "10"},
			{id: "left"},
			{id: "huge"},
			{id: "fail"},
			{id: "skip"},
		]);
		await expect(combat._pResolveJuggernautHitEffects({isMelee: true, isSpell: false}))
			.resolves.toContain("pushed 10 ft left");
		expect(combat._showCombatActionChoiceModal).toHaveBeenCalledWith(
			expect.objectContaining({name: expect.stringContaining(`DC ${state.getFeatureCalculations().juggernautSaveDc}`)}),
			expect.any(Array),
		);
	});

	it("chains Hurricane Strike after a push and spends the Juggernaut's reaction", async () => {
		const state = getState(10);
		state._data.inCombat = true;
		state.activateState("rage");
		const combat = getCombat(state, [
			{id: "push"},
			{id: "10"},
			{id: "away"},
			{id: "large"},
			{id: "use"},
			{id: "fail"},
		]);

		const outcome = await combat._pResolveJuggernautHitEffects({isMelee: true, isSpell: false});
		expect(outcome).toContain("Hurricane Strike reaction spent");
		expect(outcome).toContain("target Prone");
		expect(outcome).toContain("one ally may spend its reaction");
		expect(combat._turnActionUsage.reaction).toBe(true);
	});
});
