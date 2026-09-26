import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const SWORD = {id: "sword", name: "Longsword", isMelee: true, type: "melee", abilityMod: "str", range: "melee", damage: "1d8", damageType: "slashing"};
const BOW = {id: "bow", name: "Longbow", isRanged: true, abilityMod: "str", range: "150/600", damage: "1d8", damageType: "piercing"};
const UNARMED = {id: "fist", name: "Unarmed Strike", isUnarmedStrike: true, isMelee: true, abilityMod: "str", range: "melee", damage: "1d4", damageType: "bludgeoning"};

function makeCombat ({source = "XPHB", level = 9, attack = SWORD, natural = 12} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source, level});
	state.setAbilityBase("str", 18);
	state.addAttack(attack);
	state.startCombat();

	const rolls = [];
	const results = [];
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._battleTacticToggles = {};
	combat._flankingEnabled = false;
	combat._attackRollSequence = 0;
	combat._page = {
		rollD20: opts => {
			rolls.push(opts);
			const mode = opts.stateAdvantage !== undefined
				? CharacterSheetClassUtils.resolveD20Mode(opts)
				: opts.event?.shiftKey ? "advantage"
					: opts.event?.ctrlKey || opts.event?.metaKey ? "disadvantage"
						: opts.mode || "normal";
			return {roll: natural, roll1: natural, roll2: mode === "normal" ? null : natural, mode};
		},
		rollDice: () => 6,
		getModeLabel: mode => mode === "normal" ? "" : ` (${mode})`,
		formatD20Breakdown: () => "1d20",
		pAnimateD20: () => {},
		pAnimateDamageDice: () => {},
		showDiceResult: result => { results.push(result); return null; },
		_offerGuidedStrikePostAttack: () => {},
		_saveCurrentCharacter: jest.fn(),
		saveCharacter: jest.fn(),
	};
	combat._renderSneakAttackToggle = () => {};
	combat._runPostAttackHooks = async () => {};
	combat._consumeOnAttackStates = () => {};
	combat._clearPendingSpellRider = () => {};
	combat.renderCombatStates = () => {};
	combat.renderCombatEffects = () => {};
	combat.renderCombatDefenses = () => {};
	combat._updateQuickButtonStates = () => {};
	return {state, combat, rolls, results};
}

describe("Brutal Strike at the actual attack/damage call sites", () => {
	beforeEach(() => {
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockResolvedValue(0);
		jest.spyOn(InputUiUtil, "pGetUserString").mockResolvedValue("Ogre");
	});
	afterEach(() => jest.restoreAllMocks());

	it.each(["XPHB", "TGTT"])("%s explicitly trades ALL advantage for one normal roll, commits a durable receipt on a miss", async source => {
		const {state, combat, rolls, results} = makeCombat({source, natural: 1});
		await combat._rollRecklessAttack("sword", {shiftKey: true}, {brutalStrike: true});
		expect(rolls).toHaveLength(1);
		expect(rolls[0]).toMatchObject({mode: "normal", isAttack: true});
		expect(rolls[0].event).toBeFalsy();
		expect(results[0].total).toBe(1 + state.getAttackBonusBreakdown(state.getAttacks()[0]).total);
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		expect(combat._pendingBrutalStrike).toBeNull();
		const receiptKey = combat._getBrutalStrikeReceipt().key;
		expect(receiptKey).toBe(`Brutal Strike|Barbarian|XPHB|9:Barbarian|${source}:attack`);
		expect(state.queryTurnReceipt(receiptKey).used).toBe(true);
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.queryTurnReceipt(receiptKey).used).toBe(true);
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(1);
		expect(combat._lastAttackContext.mode).toBe("normal");
		state.advanceRound();
		expect(state.queryTurnReceipt(receiptKey).used).toBe(false);
	});

	it.each(["ctrlKey", "metaKey"])("rejects a %s disadvantage source before the choice, even if Reckless would cancel it", async key => {
		const {state, combat, rolls} = makeCombat();
		expect(await combat._rollRecklessAttack("sword", {[key]: true}, {brutalStrike: true})).toBe(false);
		expect(CharacterSheetModal.pGetUserBoolean).not.toHaveBeenCalled();
		expect(rolls).toHaveLength(0);
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(false);
	});

	it("rejects an active Disadvantage source even when Reckless cancels it to a normal roll", async () => {
		const {state, combat, rolls} = makeCombat();
		state.activateState("prone");
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(0);
		expect(CharacterSheetModal.pGetUserBoolean).not.toHaveBeenCalled();
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(false);
	});

	it.each(["ctrlKey", "metaKey"])("cancels ordinary Reckless Advantage with a %s gesture", async key => {
		const {combat, rolls} = makeCombat();
		await combat._rollRecklessAttack("sword", {[key]: true});
		expect(rolls).toHaveLength(1);
		expect(combat._lastAttackContext.mode).toBe("normal");
		expect(combat._lastAttackContext.hasAdvantage).toBe(false);
	});

	it("cancels a Shift gesture against an actual Disadvantage source on an ordinary attack", async () => {
		const {state, combat} = makeCombat();
		state.activateState("prone");
		await combat._rollAttack("sword", {shiftKey: true});
		expect(combat._lastAttackContext.mode).toBe("normal");
		expect(combat._lastAttackContext.hasDisadvantage).toBe(false);
	});

	it("does not spend a receipt or retain provisional Reckless exposure after a cancelled pre-roll choice", async () => {
		CharacterSheetModal.pGetUserBoolean.mockResolvedValue(false);
		const {state, combat, rolls} = makeCombat();
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(0);
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(false);
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
	});

	it("rejects an already-used Brutal Strike without rolling or changing Reckless exposure", async () => {
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		const {state, combat, rolls} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(1);
		expect(combat._lastAttackContext.mode).toBe("normal");
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			type: "warning",
			content: expect.stringContaining("already used this turn"),
		}));
	});

	it("retains out-of-combat use across reload until an explicit new turn without starting combat", async () => {
		const {state, combat, rolls} = makeCombat();
		state.endCombat();
		const receiptKey = combat._getBrutalStrikeReceipt().key;
		expect(state.isInCombat()).toBe(false);
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(state.queryTurnReceipt(receiptKey).used).toBe(true);
		state.loadFromJson(state.toJson());
		expect(state.queryTurnReceipt(receiptKey).used).toBe(true);
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(1);
		state.resetTurnEconomy();
		combat._resetTurnActionUsage();
		expect(state.isInCombat()).toBe(false);
		expect(state.queryTurnReceipt(receiptKey).used).toBe(false);
		const nextTurn = new CharacterSheetState();
		nextTurn.loadFromJson(state.toJson());
		expect(nextTurn.queryTurnReceipt(receiptKey).used).toBe(false);
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(rolls).toHaveLength(2);
		expect(state.queryTurnReceipt(receiptKey).used).toBe(true);
	});

	it("does not deactivate an already-active Reckless state when the player cancels Brutal Strike", async () => {
		const {state, combat, rolls} = makeCombat();
		state.activateState("recklessAttack");
		CharacterSheetModal.pGetUserBoolean.mockResolvedValueOnce(false);
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
		expect(rolls).toHaveLength(0);
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(false);
	});

	it("expires Reckless on the next own-turn reset, not on another creature's receipt boundary", async () => {
		const {state, combat, rolls} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		state.advanceTurnReceiptBoundary();
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		state.resetTurnEconomy();
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true, isOwnTurn: false})).toBe(false);
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		expect(rolls).toHaveLength(1);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).toBeNull();
	});

	it("uses an already-active Reckless state on the player's turn but never offers Brutal Strike off-turn", async () => {
		const {state, combat, rolls} = makeCombat();
		state.activateState("recklessAttack");
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true, isOwnTurn: false})).toBe(false);
		expect(rolls).toHaveLength(0);
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(false);
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		await combat._rollRecklessAttack("sword", {shiftKey: true}, {brutalStrike: true});
		expect(combat._lastAttackContext.mode).toBe("normal");
		expect(rolls.at(-1)).toMatchObject({mode: "normal", isAttack: true});
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(true);
	});

	it("restricts PHB, Dexterity and spell attacks, and does not offer on another creature's turn", async () => {
		for (const config of [
			{source: "PHB", attack: SWORD},
			{source: "XPHB", attack: {...SWORD, abilityMod: "dex"}},
			{source: "XPHB", attack: {...SWORD, isSpell: true}},
		]) {
			const {state, combat, rolls} = makeCombat(config);
			expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true})).toBe(false);
			expect(CharacterSheetModal.pGetUserBoolean).not.toHaveBeenCalled();
			expect(rolls).toHaveLength(0);
			expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		}
		const {combat, rolls} = makeCombat();
		expect(await combat._rollRecklessAttack("sword", null, {brutalStrike: true, isOwnTurn: false})).toBe(false);
		expect(CharacterSheetModal.pGetUserBoolean).not.toHaveBeenCalled();
		expect(rolls).toHaveLength(0);
		expect(combat._state.isStateTypeActive("recklessAttack")).toBe(false);
	});

	it("supports a Strength-based ranged weapon and Unarmed Strike for 2024, not PHB Reckless Unarmed Strike", async () => {
		for (const attack of [BOW, UNARMED]) {
			const {state, combat, rolls} = makeCombat({attack});
			await combat._rollRecklessAttack(attack.id, null, {brutalStrike: true});
			expect(combat._lastAttackContext.mode).toBe("normal");
			expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(true);
			await combat._rollRecklessAttack(attack.id, null);
			expect(combat._lastAttackContext.mode).toBe("advantage");
		}
		const {combat, rolls} = makeCombat({source: "PHB", attack: UNARMED});
		await combat._rollRecklessAttack("fist", null);
		expect(combat._lastAttackContext.mode).toBe("normal");
	});

	it("shares PHB Unarmed Reckless exclusion with other sheet attack surfaces without removing generic Advantage", () => {
		const {state: phb} = makeCombat({source: "PHB", attack: UNARMED});
		phb.activateState("recklessAttack");
		expect(phb.hasAdvantageFromStatesForAttack(UNARMED, "attack:melee:str")).toBe(false);
		phb.activateState("steadyAim");
		expect(phb.hasAdvantageFromStatesForAttack(UNARMED, "attack:melee:str")).toBe(true);
		const {state: xphb} = makeCombat({attack: UNARMED});
		xphb.activateState("recklessAttack");
		expect(xphb.hasAdvantageFromStatesForAttack(UNARMED, "attack:melee:str")).toBe(true);
	});

	it("does not treat forgone Advantage as a Sneak Attack trigger or a post-attack Advantage context", async () => {
		const finesse = {...SWORD, properties: ["F"]};
		const {state, combat} = makeCombat({attack: finesse});
		const getFeatures = state.getFeatureCalculations.bind(state);
		jest.spyOn(state, "getFeatureCalculations").mockImplementation(() => ({
			...getFeatures(),
			sneakAttack: {dice: "2d6"},
		}));
		combat._isSneakAttackAvailableThisTurn = () => true;
		combat._isSneakAttackWeaponEligible = () => true;
		combat._sneakAttackEnabled = false;
		combat._sneakAttackHasAdjacentAlly = false;
		const postContexts = [];
		combat._runPostAttackHooks = async (ctx, opts) => {
			if (opts.blocking) postContexts.push(ctx);
		};
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(combat._lastAttackContext.mode).toBe("normal");
		expect(combat._lastAttackContext.hasAdvantage).toBe(false);
		expect(combat._sneakAttackEnabled).toBe(false);
		expect(postContexts[0].hasAdvantage).toBe(false);

		await combat._rollAttack("sword");
		expect(combat._lastAttackContext.mode).toBe("advantage");
		expect(combat._lastAttackContext.hasAdvantage).toBe(true);
		expect(combat._sneakAttackEnabled).toBe(true);
	});

	it("does not carry pending damage through another attack, reload, character switch, or turn boundary", async () => {
		const {state, combat} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(combat._getPendingBrutalStrikeForAttack("bow")).toBeNull();

		state.resetTurnEconomy();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		const snapshot = state.toJson();
		state.loadFromJson(snapshot);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).toBeNull();

		state.resetTurnEconomy();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		state.loadFromJson({...state.toJson(), id: "another-character"});
		expect(combat._getPendingBrutalStrikeForAttack("sword")).toBeNull();
		state.loadFromJson(snapshot);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).toBeNull();
	});

	it("adds same-type dice after a confirmed hit, with distinct 13/17 effect choices and crit doubling", async () => {
		const {state, combat, results} = makeCombat({level: 17, natural: 20});
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(combat._pendingBrutalStrike).toMatchObject({attackId: "sword", rollId: combat._lastAttackContext.rollId});
		CharacterSheetModal.pGetUserEnum.mockResolvedValueOnce(2).mockResolvedValueOnce(2);
		await combat._rollDamage("sword", true);
		const damage = results.at(-1);
		expect(damage.subtitle).toContain("Brutal Strike 4d10 slashing");
		expect(damage.subtitle).toContain("Staggering Blow");
		expect(damage.subtitle).toContain("Sundering Blow");
		expect(damage.subtitle).toContain("next saving throw");
		expect(damage.subtitle).toContain("another creature");
		expect(damage.total).toBeGreaterThan(24);
		expect(combat._pendingBrutalStrike).toBeNull();
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(true);
	});

	it.each([
		{original: 1, revised: 20, expectedDice: "4d10", expectPending: true},
		{original: 20, revised: 1, expectedDice: null, expectPending: false},
	])("follows the finalized post-attack roll when a natural $original changes to $revised", async ({original, revised, expectedDice, expectPending}) => {
		const {combat, results} = makeCombat({level: 17, natural: original});
		combat._runPostAttackHooks = async (ctx, {blocking}) => {
			if (!blocking) return;
			ctx.rollResult = {...ctx.rollResult, roll: revised};
			ctx.isCrit = revised === 20;
			ctx.isFumble = revised === 1;
			ctx.rollFollowup = {naturalRoll: revised, total: revised + ctx.rollModifier};
		};
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(!!combat._getPendingBrutalStrikeForAttack("sword")).toBe(expectPending);
		if (!expectPending) return;
		expect(combat._pendingBrutalStrike.rollFollowup.naturalRoll).toBe(revised);
		await combat._rollDamage("sword");
		expect(results.at(-1).subtitle).toContain(`Brutal Strike ${expectedDice} slashing`);
	});

	it("at level 13 offers the upgraded effects but adds only 1d10 and one effect", async () => {
		const {combat, results} = makeCombat({level: 13});
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		CharacterSheetModal.pGetUserEnum.mockResolvedValueOnce(3);
		await combat._rollDamage("sword");
		const damage = results.at(-1);
		expect(damage.subtitle).toContain("Brutal Strike 1d10 slashing");
		expect(damage.subtitle).toContain("Sundering Blow");
		expect(damage.subtitle).toContain("Ogre");
		expect(damage.subtitle).not.toContain("Staggering Blow");
	});

	it("describes Forceful and Hamstring for the named target without inventing enemy state", async () => {
		const {state, combat, results} = makeCombat();
		const targetEffectsBefore = state._data.targetEffects.length;
		state.setSpeed("walk", 35);
		state._data.customModifiers.speed.walk = -5;
		state._data.itemBonuses.speedBonus = {...state._data.itemBonuses.speedBonus, walk: 6};
		expect(state.getWalkSpeed()).toBe(36);
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		await combat._rollDamage("sword");
		expect(results.at(-1).subtitle).toContain("Brutal Strike on Ogre: Forceful Blow");
		expect(results.at(-1).subtitle).toContain("pushed 15 feet straight away");
		expect(results.at(-1).subtitle).toContain("move up to 18 feet (half your current 36-foot Speed) straight toward it");
		expect(results.at(-1).subtitle).toContain("move manually");
		expect(results.at(-1).subtitle).not.toMatch(/DC \d+/);
		state.resetTurnEconomy();
		combat._resetTurnActionUsage();
		CharacterSheetModal.pGetUserEnum.mockResolvedValueOnce(1);
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		await combat._rollDamage("sword");
		expect(results.at(-1).subtitle).toContain("Brutal Strike on Ogre: Hamstring Blow");
		expect(results.at(-1).subtitle).toContain("Speed reduced by 15 feet until the start of your next turn");
		expect(results.at(-1).subtitle).toContain("only the most recent Hamstring Blow applies");
		expect(state._data.targetEffects).toHaveLength(targetEffectsBefore);
	});

	it("cancelling the target prompt rolls no typed dice and preserves the exact pending attack", async () => {
		const {state, combat, results} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		InputUiUtil.pGetUserString.mockResolvedValueOnce(null);
		const before = results.length;
		await combat._rollDamage("sword");
		expect(results).toHaveLength(before);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).not.toBeNull();
		expect(state.queryTurnReceipt(combat._getBrutalStrikeReceipt().key).used).toBe(true);
	});

	it("does not attach damage from an unconfirmed hit or from a later attack roll", async () => {
		const {state, combat, results} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		CharacterSheetModal.pGetUserBoolean.mockResolvedValue(false);
		const beforeMiss = results.length;
		await combat._rollDamage("sword");
		expect(results).toHaveLength(beforeMiss);
		expect(combat._pendingBrutalStrike).toBeNull();
		state.resetTurnEconomy();
		combat._resetTurnActionUsage();
		CharacterSheetModal.pGetUserBoolean.mockResolvedValue(true);
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		expect(combat._getPendingBrutalStrikeForAttack("sword")).not.toBeNull();
		expect(await combat._rollAttack("sword")).toBe(true);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).toBeNull();
		await combat._rollDamage("sword");
		expect(results.at(-1).subtitle).not.toContain("Brutal Strike 1d10");
	});

	it("closing hit confirmation does not roll damage or consume the pending strike", async () => {
		const {combat, results} = makeCombat();
		await combat._rollRecklessAttack("sword", null, {brutalStrike: true});
		CharacterSheetModal.pGetUserBoolean.mockResolvedValueOnce(null);
		const before = results.length;
		await combat._rollDamage("sword");
		expect(results).toHaveLength(before);
		expect(combat._getPendingBrutalStrikeForAttack("sword")).not.toBeNull();
	});
});
