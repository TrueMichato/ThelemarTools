import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
let CharacterSheetPage;
let CharacterSheetPlayMode;

beforeAll(async () => {
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
	({CharacterSheetPlayMode} = await import("../../../js/charactersheet/charactersheet-playmode.js"));
});

const EFA_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const REANIMATOR_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";

const getOwnerClass = (source, level) => ({
	name: "Artificer",
	source,
	level,
	subclass: {
		name: "Battle Smith",
		shortName: "Battle Smith",
		source,
	},
});

const getState = ({
	source = "EFA",
	level = 5,
	intelligence = 18,
	hp = {max: 30, current: 12, temp: 0},
	repairCurrent = 3,
	hitDiceCurrent = 3,
} = {}) => {
	const state = new CharacterSheetState();
	state.loadFromJson({
		abilities: {str: 10, dex: 10, con: 10, int: intelligence, wis: 10, cha: 10},
		classes: [getOwnerClass(source, level)],
	});
	const featureUid = source === "TCE" ? TCE_UID : EFA_UID;
	const companionId = state.addCompanion({
		name: "Steel Defender",
		source,
		type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
		origin: "Battle Smith",
		creatureType: "construct",
		hp,
		featureGrant: {uid: featureUid},
		uses: {repair: {current: repairCurrent, max: 3, recharge: source === "EFA" ? "longRest" : "daily"}},
		hitDice: {die: "d8", current: hitDiceCurrent, max: level},
		lifecycle: {status: "alive"},
	});
	state.reconcileFeatureOwnedCompanion(companionId, {
		summonerContext: state.getFeatureCompanionSummonerContext(featureUid),
	});
	return {state, companionId, featureUid};
};

const getAttackReplacement = ({available = true} = {}) => {
	const receipts = [];
	return {
		availability: {
			available,
			reason: available ? null : "No attacks remain in the current Attack action.",
		},
		adapter: {
			consume: jest.fn(({replacementUid}) => {
				const receipt = {id: `replacement-${receipts.length + 1}`, replacementUid};
				receipts.push(receipt);
				return {ok: true, receipt};
			}),
			rollback: jest.fn(receipt => ({ok: !!receipt, restored: receipt?.id || null})),
		},
	};
};

const getTurnReceipts = state => Object.values(state.toJson().turnReceipts.receipts);

const useRend = (state, companionId, {
	commandMethod = "bonusAction",
	attackReplacement = null,
	attackReplacementAdapter = null,
	attackD20 = 12,
	damageDie = 6,
	hitConfirmed = true,
} = {}) => state.commandCompanionAction({
	companionId,
	actionKey: "forceEmpoweredRend",
	commandMethod,
	attackReplacement,
	attackReplacementAdapter,
	target: {name: "Training Dummy"},
	rangeConfirmed: true,
	hitConfirmed,
	rolls: {attackD20, damageDie},
});

describe("Battle Smith shared companion command policy", () => {
	test("defaults to Dodge without an owner cost and spends only the companion action receipt", () => {
		const {state, companionId} = getState();
		const result = state.commandCompanionAction({
			companionId,
			actionKey: "dodge",
		});

		expect(result).toMatchObject({
			ok: true,
			commandMethod: "defaultDodge",
			costs: {
				ownerAction: null,
				companionAction: true,
				companionReaction: false,
			},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
		expect(state.getCompanionOperationAvailability(companionId, "repair").reason).toBe("companionActionSpent");
	});

	test("normally spends the owner's Bonus Action and the defender action atomically", () => {
		const {state, companionId} = getState();
		const result = useRend(state, companionId);

		expect(result).toMatchObject({
			ok: true,
			operation: "forceEmpoweredRend",
			commandMethod: "bonusAction",
			costs: {ownerAction: "bonus", companionAction: true},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(getTurnReceipts(state)).toHaveLength(1);
	});

	test("offers the EFA level-5 Rend-only Attack replacement and consumes exactly one canonical attack", () => {
		const {state, companionId} = getState({level: 5});
		const replacement = getAttackReplacement();
		const result = useRend(state, companionId, {
			commandMethod: "replaceOneAttack",
			attackReplacement: replacement.availability,
			attackReplacementAdapter: replacement.adapter,
		});

		expect(result).toMatchObject({
			ok: true,
			commandMethod: "replaceOneAttack",
			costs: {ownerAction: "replaceOneAttack"},
		});
		expect(replacement.adapter.consume).toHaveBeenCalledWith({
			replacementUid: "Force-Empowered Rend|Steel Defender|EFA",
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);

		state.resetTurnEconomy();
		const illegal = state.commandCompanionAction({
			companionId,
			actionKey: "help",
			commandMethod: "replaceOneAttack",
			attackReplacement: replacement.availability,
			attackReplacementAdapter: replacement.adapter,
		});
		expect(illegal).toMatchObject({ok: false, reason: "commandMethodUnavailable"});
		expect(illegal.message).toContain("Only Force-Empowered Rend");
		expect(replacement.adapter.consume).toHaveBeenCalledTimes(1);
	});

	test("requires an explicit command choice when Bonus Action and Attack replacement are both legal", () => {
		const {state, companionId} = getState({level: 5});
		const replacement = getAttackReplacement();
		const result = useRend(state, companionId, {
			commandMethod: null,
			attackReplacement: replacement.availability,
			attackReplacementAdapter: replacement.adapter,
		});

		expect(result).toMatchObject({ok: false, reason: "commandMethodRequired"});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
		expect(getTurnReceipts(state)).toEqual([]);
	});

	test("lets an incapacitated owner command freely while preserving the defender action gate", () => {
		const {state, companionId} = getState();
		jest.spyOn(state, "isIncapacitated").mockReturnValue(true);
		const result = state.commandCompanionAction({
			companionId,
			actionKey: "help",
		});

		expect(result).toMatchObject({
			ok: true,
			commandMethod: "incapacitatedFree",
			costs: {ownerAction: null, companionAction: true},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
	});

	test("explains why neither owner command method is available", () => {
		const {state, companionId} = getState({level: 5});
		state.consumeActionType("bonus");
		const availability = state.getCompanionOperationAvailability(companionId, "forceEmpoweredRend", {
			attackReplacement: {available: false, reason: "No attacks remain in the current Attack action."},
		});

		expect(availability).toMatchObject({
			available: false,
			reason: "noCommandMethodAvailable",
		});
		expect(availability.message).toContain("Bonus Action already used.");
		expect(availability.message).toContain("No attacks remain");
	});

	test("reports real receipt status when the defender is inactive or at 0 HP", () => {
		const {state, companionId} = getState({hp: {max: 30, current: 0, temp: 0}});
		const availability = state.getCompanionOperationAvailability(companionId, "forceEmpoweredRend");
		expect(availability).toMatchObject({
			available: false,
			reason: "companionAtZeroHp",
			status: {
				actionAvailable: true,
				reactionAvailable: true,
			},
		});
	});
});

describe("Battle Smith Rend, Repair, Deflect, and Hit Dice", () => {
	test("uses the exact EFA spell attack and force-damage formula while preserving TCE differences", () => {
		const efa = getState({source: "EFA", level: 15, intelligence: 20});
		const efaResult = useRend(efa.state, efa.companionId, {attackD20: 14, damageDie: 7});
		expect(efaResult.rolls).toMatchObject({
			attack: {d20: 14, bonus: 10, total: 24, range: 5, type: "meleeWeaponAttack"},
			damage: {dieRoll: 7, flat: 7, total: 14, dice: "1d8", type: "force"},
		});
		expect(efaResult.operationUid).toBe("Force-Empowered Rend|Steel Defender|EFA");

		const tce = getState({source: "TCE", level: 15, intelligence: 20});
		const tceResult = useRend(tce.state, tce.companionId, {attackD20: 14, damageDie: 7});
		expect(tceResult.rolls.damage).toMatchObject({flat: 5, total: 12, type: "force"});
		expect(tce.state.getCompanionOperationAvailability(tce.companionId, "forceEmpoweredRend", {
			attackReplacement: {available: true},
		}).commandMethods.some(it => it.id === "replaceOneAttack")).toBe(false);
	});

	test("Repair confirms modeled target and range before spending its use or either action", () => {
		const {state, companionId} = getState({repairCurrent: 2});
		const before = state.toJson();
		const unconfirmed = state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {companionId, confirmed: false},
			rangeConfirmed: false,
			rolls: {healingDice: 9},
		});

		expect(unconfirmed).toMatchObject({ok: false, reason: "repairTargetUnconfirmed"});
		expect(state.toJson()).toEqual(before);

		const repaired = state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {companionId, confirmed: true},
			rangeConfirmed: true,
			rolls: {healingDice: 9},
		});
		expect(repaired).toMatchObject({
			ok: true,
			costs: {ownerAction: "bonus", companionAction: true, repairUses: 1},
			rolls: {healing: {dieRoll: 9, flat: 4, total: 13, dice: "2d8"}},
			hp: {before: 12, after: 25, actual: 13},
		});
		expect(state.getCompanion(companionId).uses.repair.current).toBe(1);
	});

	test("Repair supports confirmed external Constructs/objects and rejects invalid modeled targets", () => {
		const {state, companionId} = getState();
		const invalidId = state.addCompanion({
			name: "Wolf",
			creatureType: "beast",
			hp: {current: 3, max: 10},
		});
		const before = state.toJson();
		const invalid = state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {companionId: invalidId, confirmed: true},
			rangeConfirmed: true,
			rolls: {healingDice: 8},
		});
		expect(invalid).toMatchObject({ok: false, reason: "invalidRepairTarget"});
		expect(state.toJson()).toEqual(before);

		const external = state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {external: true, kind: "object", name: "Clockwork Gate", confirmed: true},
			rangeConfirmed: true,
			rolls: {healingDice: 8},
		});
		expect(external).toMatchObject({
			ok: true,
			hp: {external: true, manualApplication: true, requested: 12, actual: null},
		});
	});

	test("Deflect Attack spends the defender reaction, never the owner reaction, and returns level-15 retaliation", () => {
		const {state, companionId} = getState({level: 15, intelligence: 20});
		const result = state.useCompanionReaction({
			companionId,
			reactionKey: "deflectAttack",
			target: {
				attackerName: "Ogre",
				protectedTargetName: "Artificer",
				protectedTargetIsCompanion: false,
			},
			rangeConfirmed: true,
			attackerVisibleConfirmed: true,
			rolls: {retaliationDie: 3},
		});

		expect(result).toMatchObject({
			ok: true,
			costs: {ownerAction: null, companionAction: false, companionReaction: true},
			rolls: {
				disadvantage: {applies: true, manualResolution: true},
				retaliation: {dieRoll: 3, flat: 5, total: 8, dice: "1d4", type: "force"},
			},
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
		expect(state.getCompanionOperationAvailability(companionId, "deflectAttack").reason)
			.toBe("companionReactionSpent");
	});

	test("Deflect cancellation and invalid self-targeting spend no reaction", () => {
		const {state, companionId} = getState({level: 15});
		const invalid = state.useCompanionReaction({
			companionId,
			reactionKey: "deflectAttack",
			target: {
				attackerName: "Ogre",
				protectedTargetName: "Steel Defender",
				protectedTargetIsCompanion: true,
			},
			rangeConfirmed: true,
			attackerVisibleConfirmed: true,
			rolls: {retaliationDie: 2},
		});
		expect(invalid).toMatchObject({ok: false, reason: "invalidDeflectTarget"});
		expect(getTurnReceipts(state)).toEqual([]);

		const cancelled = state.useCompanionReaction({
			companionId,
			reactionKey: "deflectAttack",
			cancelled: true,
		});
		expect(cancelled).toMatchObject({ok: false, reason: "cancelled"});
		expect(getTurnReceipts(state)).toEqual([]);
	});

	test("spends a companion d8 plus its Constitution modifier without touching player Hit Dice", () => {
		const {state, companionId} = getState({hitDiceCurrent: 2});
		state._data.hitDice = {d8: {total: 5, used: 1}};
		const playerHitDiceBefore = structuredClone(state._data.hitDice);
		const result = state.spendCompanionHitDie({
			companionId,
			target: {companionId, confirmed: true},
			rolls: {hitDie: 6},
		});

		expect(result).toMatchObject({
			ok: true,
			costs: {hitDice: 1, companionAction: false, companionReaction: false},
			rolls: {healing: {dieRoll: 6, flat: 2, total: 8, dice: "d8"}},
			hp: {before: 12, after: 20, actual: 8},
		});
		expect(state.getCompanion(companionId).hitDice.current).toBe(1);
		expect(state._data.hitDice).toEqual(playerHitDiceBefore);
	});
});

describe("Battle Smith companion atomicity, persistence, and isolation", () => {
	test("rolls back the exact receipt, Bonus Action, Repair use, and HP snapshot after a late failure", () => {
		const {state, companionId} = getState({repairCurrent: 2});
		jest.spyOn(state, "healCompanion").mockReturnValue(0);
		const beforeHp = {...state.getCompanion(companionId).hp};
		const result = state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {companionId, confirmed: true},
			rangeConfirmed: true,
			rolls: {healingDice: 8},
		});

		expect(result).toMatchObject({
			ok: false,
			reason: "transactionRolledBack",
			rollback: {
				companionReceipt: {ok: true},
				ownerAction: {ok: true, actionType: "bonus"},
				resource: {ok: true, type: "repair", current: 2},
				hp: {ok: true, companionId},
			},
		});
		expect(getTurnReceipts(state)).toEqual([]);
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
		expect(state.getCompanion(companionId).uses.repair.current).toBe(2);
		expect(state.getCompanion(companionId).hp).toEqual(beforeHp);
	});

	test("keeps receipts stable across combatRound changes, save/load, and clears them only on turn reset", () => {
		const {state, companionId} = getState();
		expect(useRend(state, companionId).ok).toBe(true);
		state._data.combatRound = 999;
		expect(state.getCompanionOperationAvailability(companionId, "forceEmpoweredRend").reason)
			.toBe("companionActionSpent");

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getCompanionOperationAvailability(companionId, "forceEmpoweredRend").reason)
			.toBe("companionActionSpent");
		restored.resetTurnEconomy();
		expect(restored.getCompanionOperationAvailability(companionId, "forceEmpoweredRend").available)
			.toBe(true);
	});

	test("prunes only exact EFA receipts on source loss and preserves TCE and Reanimator receipts", () => {
		const efa = getState({source: "EFA"});
		const tceId = efa.state.addCompanion({
			name: "Steel Defender",
			source: "TCE",
			creatureType: "construct",
			hp: {current: 20, max: 20},
			featureGrant: {uid: TCE_UID},
		});
		const reanimatorId = efa.state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			creatureType: "undead",
			hp: {current: 20, max: 20},
			featureGrant: {uid: REANIMATOR_UID},
		});
		expect(useRend(efa.state, efa.companionId).ok).toBe(true);
		efa.state.commitTurnReceipt({
			key: `tce:${tceId}:action`,
			ownerUid: TCE_UID,
			sourceUid: "Steel Defender|TCE",
			actionUid: "Companion Action|Steel Defender|TCE",
		});
		efa.state.commitTurnReceipt({
			key: `reanimator:${reanimatorId}:action`,
			ownerUid: REANIMATOR_UID,
			sourceUid: "Reanimated Companion|RHW",
			actionUid: "Companion Action|Reanimated Companion|RHW",
		});

		efa.state.deactivateFeatureOwnedCompanions(EFA_UID, {status: "vanished"});
		expect(getTurnReceipts(efa.state)).toEqual(expect.arrayContaining([
			expect.objectContaining({ownerUid: TCE_UID}),
			expect.objectContaining({ownerUid: REANIMATOR_UID}),
		]));
		expect(getTurnReceipts(efa.state).some(it => it.ownerUid === EFA_UID)).toBe(false);
	});

	test("prunes one companion's exact receipt keys without refunding a sibling defender", () => {
		const {state, companionId} = getState();
		const siblingId = state.addCompanion({
			name: "Steel Defender",
			source: "EFA",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			origin: "Battle Smith",
			creatureType: "construct",
			hp: {max: 30, current: 20},
			featureGrant: {uid: EFA_UID},
			lifecycle: {status: "alive"},
		});
		state.reconcileFeatureOwnedCompanion(siblingId, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});
		expect(state.commandCompanionAction({companionId, actionKey: "dodge"}).ok).toBe(true);
		expect(state.commandCompanionAction({companionId: siblingId, actionKey: "dodge"}).ok).toBe(true);
		expect(getTurnReceipts(state)).toHaveLength(2);

		expect(state._pruneFeatureCompanionTurnReceipts(state.getCompanion(companionId))).toBe(1);
		expect(getTurnReceipts(state)).toEqual([
			expect.objectContaining({metadata: expect.objectContaining({companionId: siblingId})}),
		]);
	});

	test("long rest restores only EFA Repair and half companion Hit Dice without healing or resurrecting", () => {
		const {state, companionId} = getState({
			source: "EFA",
			level: 5,
			hp: {max: 30, current: 0, temp: 0},
			repairCurrent: 0,
			hitDiceCurrent: 1,
		});
		const companion = state.getCompanion(companionId);
		companion.active = false;
		companion.lifecycle.status = "dead";
		const futurePool = companion.uses.futurePool = {current: 0, max: 2, recharge: "longRest"};

		state.onLongRest();
		expect(companion.hp.current).toBe(0);
		expect(companion.active).toBe(false);
		expect(companion.lifecycle.status).toBe("dead");
		expect(companion.uses.repair.current).toBe(3);
		expect(companion.hitDice.current).toBe(4);
		expect(futurePool.current).toBe(0);

		const tce = getState({
			source: "TCE",
			level: 5,
			repairCurrent: 0,
			hitDiceCurrent: 1,
		});
		tce.state.onLongRest();
		expect(tce.state.getCompanion(tce.companionId).uses.repair).toMatchObject({
			current: 0,
			max: 3,
			recharge: "daily",
		});
	});

	test("uses the Combat module's canonical Attack-action budget and reverses the exact replacement", () => {
		const {state} = getState({level: 5});
		state._data.inCombat = true;
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._resetTurnActionUsage();
		combat._recordAttackForTurn({name: "Longsword", actionType: "action"});

		expect(combat.getAttackActionReplacementAvailability()).toMatchObject({
			available: true,
			used: 1,
			allowance: 2,
			remaining: 1,
		});
		const consumed = combat.consumeAttackActionReplacement({
			replacementUid: "Force-Empowered Rend|Steel Defender|EFA",
		});
		expect(consumed.ok).toBe(true);
		expect(combat.getAttackActionReplacementAvailability().remaining).toBe(0);
		expect(combat.rollbackAttackActionReplacement(consumed.receipt)).toEqual({
			ok: true,
			restoredCount: 1,
		});
		expect(combat.getAttackActionReplacementAvailability().remaining).toBe(1);
	});

	test("resets the canonical Attack replacement budget at Play Mode turn boundaries", () => {
		const {state} = getState({level: 5});
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._resetTurnActionUsage();
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._combat = combat;

		page.startCombat();
		combat._recordAttackForTurn({name: "Longsword", actionType: "action"});
		expect(combat.getAttackActionReplacementAvailability().available).toBe(true);
		page.advanceCombatRound();
		expect(combat.getAttackActionReplacementAvailability()).toMatchObject({
			available: false,
			hasAttackAction: false,
			used: 0,
		});
		page.endCombat();
		expect(combat.getAttackActionReplacementAvailability().reason).toContain("only during combat");
	});

	test("routes desktop and Play Mode through the same page operation method", async () => {
		const {state, companionId} = getState();
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._combat = null;
		page._playMode = null;
		page.saveCharacter = jest.fn(async () => {});
		page._renderCompanions = jest.fn();
		page._showCompanionOperationResult = jest.fn();

		const desktop = await page.pUseCompanionOperation({
			companionId,
			operation: "action",
			actionKey: "dodge",
		});
		expect(desktop).toMatchObject({ok: true, operation: "action", actionKey: "dodge"});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		state.resetTurnEconomy();
		const sharedOperation = jest.fn(async () => ({ok: true, committed: true}));
		const playPage = {
			getState: () => state,
			getCompanionOperationAvailability: (id, operation) => page.getCompanionOperationAvailability(id, operation),
			pUseCompanionOperation: sharedOperation,
		};
		const playMode = new CharacterSheetPlayMode(playPage);
		playMode._refreshOpenDrawer = jest.fn();
		const buttons = [];
		playMode._ce = (tag, className, parent) => {
			const element = {
				tag,
				className,
				children: [],
				style: {},
				attributes: {},
				handlers: {},
				setAttribute (name, value) { this.attributes[name] = value; },
				addEventListener (name, handler) { this.handlers[name] = handler; },
			};
			if (tag === "button") buttons.push(element);
			parent?.children?.push(element);
			return element;
		};
		const card = {children: []};
		playMode._renderFeatureCompanionOperations(card, state.getCompanion(companionId));
		await buttons[0].handlers.click();
		expect(sharedOperation).toHaveBeenCalledWith({
			companionId,
			operation: "forceEmpoweredRend",
		});
		expect(playMode._refreshOpenDrawer).toHaveBeenCalledWith("companions");
	});
});
