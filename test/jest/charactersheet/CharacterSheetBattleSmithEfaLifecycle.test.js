import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const EFA_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const REANIMATOR_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";

const makeClass = ({source = "EFA", level = 9, subclassSource = source} = {}) => ({
	name: "Artificer",
	source,
	level,
	subclass: {
		name: "Battle Smith",
		shortName: "Battle Smith",
		source: subclassSource,
	},
});

const makeState = ({
	level = 9,
	companionHp = 30,
	lifecycle = {status: "alive", generation: 1},
	spellSlots = {1: {current: 2, max: 2}},
	pactSlots = {current: 0, max: 0, level: 0},
} = {}) => {
	const state = new CharacterSheetState();
	state.loadFromJson({
		name: "Battle Smith",
		abilities: {str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10},
		classes: [makeClass({level})],
		hp: {current: 20, max: 20, temp: 0},
		spellcasting: {spellSlots, pactSlots},
	});
	const companionId = state.addCompanion({
		name: "Steel Defender",
		source: "EFA",
		type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
		origin: "Battle Smith",
		customName: "Rivet",
		setup: {
			nickname: "Rivet",
			appearance: "A brass-plated iron hound.",
			locomotion: "fourLegs",
		},
		creatureType: "construct",
		hp: {max: 50, current: companionHp, temp: 0},
		featureGrant: {uid: EFA_UID},
		uses: {repair: {current: 1, max: 3, recharge: "longRest"}},
		hitDice: {die: "d8", current: 2, max: level},
		lifecycle,
	});
	state.reconcileFeatureOwnedCompanion(companionId, {
		summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
	});
	return {state, companionId};
};

const killDefender = (state, companionId) => {
	const current = state.getCompanion(companionId).hp.current;
	return state.damageCompanion(companionId, current);
};

const addTool = (state, {
	id = "smith-tools",
	name = "Smith's Tools",
	source = "XPHB",
	quantity = 1,
	isCustom = false,
} = {}) => {
	state.addItem({
		id,
		name,
		source,
		type: "AT",
		...(isCustom ? {_isCustom: true} : {}),
	}, quantity);
	return id;
};

const beginRevival = (state, companionId, overrides = {}) => state.beginFeatureCompanionRevival({
	companionId,
	spellSlot: {kind: "normal", level: 1},
	touchConfirmed: true,
	...overrides,
});

describe("EFA Steel Defender death and canonical minute lifecycle", () => {
	test("records the first positive-to-zero transition once and preserves it through reconcile and round-trip", () => {
		const {state, companionId} = makeState({
			lifecycle: {status: "alive", generation: 3, customLifecycleMarker: {kept: true}},
		});
		state.advanceGameTimeMinutes(12, {reason: "setup", identity: companionId});

		state.setCompanionHp(companionId, 0);
		const dead = state.getCompanion(companionId);
		expect(dead).toMatchObject({
			id: companionId,
			active: false,
			hp: {current: 0},
			lifecycle: {
				status: "dead",
				generation: 3,
				diedAtGameMinute: 12,
				timingKnown: true,
				deathReason: "setCompanionHp",
				customLifecycleMarker: {kept: true},
			},
		});

		state.advanceGameTimeMinutes(10, {reason: "later", identity: companionId});
		state.damageCompanion(companionId, 5);
		state.reconcileFeatureOwnedCompanion(companionId, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});
		expect(state.getCompanion(companionId).lifecycle.diedAtGameMinute).toBe(12);
		expect(state.getCompanion(companionId).hp.current).toBe(0);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getCompanion(companionId).lifecycle).toEqual(state.getCompanion(companionId).lifecycle);
		expect(restored.getCompanion(companionId).id).toBe(companionId);
		expect(restored.getCompanion(companionId).hp.current).toBe(0);
	});

	test("keeps revival legal through +60 minutes and expires at +61", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);

		expect(state.advanceGameTimeMinutes(59, {
			reason: "boundary",
			identity: companionId,
		}).updated).toEqual([]);
		expect(state.getCompanion(companionId).lifecycle.status).toBe("dead");
		expect(state.getFeatureCompanionRevivalAvailability(companionId, {
			spellSlot: {kind: "normal", level: 1},
			touchConfirmed: true,
		})).toMatchObject({
			available: true,
			currentMinute: 59,
			deathTiming: {
				known: true,
				diedAtGameMinute: 0,
				deadlineMinute: 60,
				remainingMinutes: 1,
			},
		});

		state.advanceGameTimeMinutes(1, {reason: "boundary", identity: companionId});
		expect(state.getGameTimeMinutes()).toBe(60);
		expect(state.getCompanion(companionId).lifecycle.status).toBe("dead");
		expect(state.getFeatureCompanionRevivalAvailability(companionId, {
			spellSlot: {kind: "normal", level: 1},
			touchConfirmed: true,
		})).toMatchObject({
			available: true,
			currentMinute: 60,
			deathTiming: {deadlineMinute: 60, remainingMinutes: 0},
		});

		const expired = state.advanceGameTimeMinutes(1, {reason: "boundary", identity: companionId});
		expect(expired.updated).toContainEqual(expect.objectContaining({
			kind: "featureCompanion",
			companionId,
			transition: "expired",
			atMinute: 61,
		}));
		expect(state.getCompanion(companionId)).toMatchObject({
			active: false,
			hp: {current: 0},
			lifecycle: {status: "expired", expiredAtGameMinute: 61},
		});
	});

	test("begins at minute +60 and completes at +61 before expiry processing", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);
		state.advanceGameTimeMinutes(60, {reason: "window", identity: companionId});

		const begun = beginRevival(state, companionId);
		expect(begun).toMatchObject({
			ok: true,
			committed: true,
			operation: "Revival",
			companionId,
			ownerUid: EFA_UID,
			sourceUid: "Steel Defender|EFA",
			costs: {
				ownerAction: "action",
				spellSlot: {kind: "normal", level: 1, amount: 1},
			},
			actionType: "magicAction",
			completionMinute: 61,
			lifecycle: {
				status: "revivalPending",
				revivalPending: {startedAtGameMinute: 60, dueAtGameMinute: 61},
			},
		});
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state._data.spellcasting.spellSlots[1].current).toBe(1);

		const completed = state.advanceGameTimeMinutes(1, {reason: "revival", identity: companionId});
		expect(completed.updated).toContainEqual(expect.objectContaining({
			companionId,
			transition: "revivalCompleted",
			atMinute: 61,
			hp: 50,
		}));
		expect(state.getCompanion(companionId)).toMatchObject({
			active: true,
			hp: {current: 50, max: 50},
			lifecycle: {
				status: "alive",
				generation: 1,
				lastRevival: {completedAtGameMinute: 61},
			},
		});
	});

	test("completes pending revival during a multi-minute advance and supports Pact Magic slots", () => {
		const {state, companionId} = makeState({
			spellSlots: {},
			pactSlots: {current: 1, max: 1, level: 3},
		});
		killDefender(state, companionId);

		const begun = beginRevival(state, companionId, {
			spellSlot: {kind: "pact"},
		});
		expect(begun).toMatchObject({
			ok: true,
			costs: {spellSlot: {kind: "pact", level: 3, amount: 1}},
			completionMinute: 1,
		});
		expect(state.getPactSlots().current).toBe(0);

		const advanced = state.advanceGameTimeMinutes(5, {
			reason: "multi-minute-revival",
			identity: companionId,
		});
		expect(advanced.newMinute).toBe(5);
		expect(advanced.updated).toContainEqual(expect.objectContaining({
			transition: "revivalCompleted",
			atMinute: 1,
		}));
		expect(state.getCompanion(companionId).lifecycle.status).toBe("alive");
	});

	test("rolls a due lifecycle transition back with the shared minute transaction", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);
		beginRevival(state, companionId);
		const before = state.toJson();
		jest.spyOn(state, "_advanceGeneratedFeatureItemLifecyclesToMinute").mockImplementation(() => {
			throw new Error("later minute participant failed");
		});

		expect(state.advanceGameTimeMinutes(1, {
			reason: "atomic-lifecycle-test",
			identity: companionId,
		})).toMatchObject({
			ok: false,
			code: "game-time-advance-rolled-back",
			priorMinute: 0,
			message: "later minute participant failed",
		});
		expect(state.toJson()).toEqual(before);
	});
});

describe("EFA Steel Defender revival validation and rollback", () => {
	test("prevalidates touch, owner Action, and slot selection before spending anything", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);
		const before = state.toJson();

		expect(beginRevival(state, companionId, {touchConfirmed: false})).toMatchObject({
			ok: false,
			reason: "touchNotConfirmed",
		});
		expect(state.toJson()).toEqual(before);

		state.consumeActionType("action");
		const actionSpent = state.toJson();
		expect(beginRevival(state, companionId)).toMatchObject({
			ok: false,
			reason: "ownerActionUnavailable",
		});
		expect(state.toJson()).toEqual(actionSpent);
		state.restoreActionType("action");

		const missingSlot = state.toJson();
		expect(state.beginFeatureCompanionRevival({
			companionId,
			touchConfirmed: true,
		})).toMatchObject({ok: false, reason: "spellSlotRequired"});
		expect(state.toJson()).toEqual(missingSlot);

		const unavailableSlot = state.toJson();
		expect(beginRevival(state, companionId, {
			spellSlot: {kind: "normal", level: 9},
		})).toMatchObject({ok: false, reason: "spellSlotUnavailable"});
		expect(state.toJson()).toEqual(unavailableSlot);
	});

	test("reports no-slot and cancellation failures without mutation", () => {
		const noSlot = makeState({spellSlots: {}, pactSlots: {current: 0, max: 1, level: 3}});
		killDefender(noSlot.state, noSlot.companionId);
		const noSlotBefore = noSlot.state.toJson();
		expect(noSlot.state.beginFeatureCompanionRevival({
			companionId: noSlot.companionId,
			spellSlot: {kind: "pact"},
			touchConfirmed: true,
		})).toMatchObject({ok: false, reason: "noSpellSlotAvailable"});
		expect(noSlot.state.toJson()).toEqual(noSlotBefore);

		const cancelled = makeState();
		killDefender(cancelled.state, cancelled.companionId);
		const cancelledBefore = cancelled.state.toJson();
		expect(beginRevival(cancelled.state, cancelled.companionId, {cancelled: true})).toMatchObject({
			ok: false,
			reason: "cancelled",
		});
		expect(cancelled.state.toJson()).toEqual(cancelledBefore);
	});

	test("rolls back owner Action, selected slot, and lifecycle after a late failure", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);
		const before = state.toJson();
		jest.spyOn(state, "_commitFeatureCompanionRevivalPending").mockImplementation(() => {
			throw new Error("late lifecycle failure");
		});

		const result = beginRevival(state, companionId);
		expect(result).toMatchObject({
			ok: false,
			reason: "transactionRolledBack",
			rollback: {
				ownerAction: {ok: true, actionType: "action"},
				spellSlot: {ok: true, kind: "normal", level: 1, current: 2},
				lifecycle: {ok: true, status: "dead"},
			},
			error: "late lifecycle failure",
		});
		expect(state.toJson()).toEqual(before);
	});

	test.each([null, [], "bad", 42])("rejects malformed revival input %p", input => {
		const {state} = makeState();
		const before = state.toJson();
		expect(state.beginFeatureCompanionRevival(input)).toMatchObject({
			ok: false,
			reason: "invalidRevivalOptions",
		});
		expect(state.toJson()).toEqual(before);
	});
});

describe("EFA Steel Defender legacy lifecycle migration", () => {
	test("migrates an exact zero-HP legacy defender to unknown-time dead idempotently", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			abilities: {int: 18},
			classes: [makeClass()],
			spellcasting: {spellSlots: {1: {current: 1, max: 1}}},
			companions: [{
				id: "legacy-efa",
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 0, temp: 0},
			}],
		});

		expect(state.getCompanion("legacy-efa")).toMatchObject({
			id: "legacy-efa",
			active: false,
			featureGrant: {uid: EFA_UID},
			hp: {current: 0},
			lifecycle: {
				status: "dead",
				generation: 1,
				diedAtGameMinute: null,
				timingKnown: false,
			},
		});
		const once = state.toJson();
		state._migrateCompanions();
		expect(state.toJson()).toEqual(once);

		expect(state.getFeatureCompanionRevivalAvailability("legacy-efa", {
			spellSlot: {kind: "normal", level: 1},
			touchConfirmed: true,
		})).toMatchObject({
			available: false,
			reason: "deathTimeConfirmationRequired",
			deathTiming: {
				known: false,
				diedAtGameMinute: null,
				deadlineMinute: null,
				remainingMinutes: null,
			},
		});
		expect(state.beginFeatureCompanionRevival({
			companionId: "legacy-efa",
			spellSlot: {kind: "normal", level: 1},
			touchConfirmed: true,
			deathWithinHourConfirmed: true,
		})).toMatchObject({
			ok: true,
			lifecycle: {
				status: "revivalPending",
				revivalPending: {
					deathTiming: {
						known: false,
						diedAtGameMinute: null,
						deathWithinHourConfirmed: true,
					},
				},
			},
		});
	});

	test("does not trust a zero-HP legacy alive marker or a minute explicitly marked unknown", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			abilities: {int: 18},
			classes: [makeClass()],
			companions: [{
				id: "legacy-contradiction",
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 0, temp: 0},
				featureGrant: {uid: EFA_UID},
				lifecycle: {
					status: "alive",
					diedAtGameMinute: 0,
					timingKnown: false,
					customLifecycleMarker: "kept",
				},
			}],
		});

		expect(state.getCompanion("legacy-contradiction")).toMatchObject({
			active: false,
			hp: {current: 0},
			lifecycle: {
				status: "dead",
				diedAtGameMinute: null,
				timingKnown: false,
				customLifecycleMarker: "kept",
			},
		});
	});

	test("does not mutate name-only, wrong-source, TCE, or RHW companions", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			abilities: {int: 18},
			classes: [makeClass()],
			companions: [
				{id: "name-only", name: "Steel Defender", hp: {max: 10, current: 0}},
				{
					id: "wrong-source",
					name: "Steel Defender",
					source: "RHW",
					type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
					origin: "Battle Smith",
					creatureType: "construct",
					hp: {max: 10, current: 0},
				},
				{
					id: "tce",
					name: "Steel Defender",
					source: "TCE",
					type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
					origin: "Battle Smith",
					featureGrant: {uid: TCE_UID},
					hp: {max: 10, current: 0},
				},
				{
					id: "rhw",
					name: "Reanimated Companion",
					source: "RHW",
					type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
					origin: "Reanimator",
					featureGrant: {uid: REANIMATOR_UID},
					hp: {max: 10, current: 0},
				},
			],
		});

		expect(state.getCompanion("name-only").lifecycle).toBeUndefined();
		expect(state.getCompanion("wrong-source").lifecycle).toBeUndefined();
		expect(state.getCompanion("tce").lifecycle).toEqual({generation: 1});
		expect(state.getCompanion("rhw").lifecycle).toEqual({generation: 1});
	});
});

describe("non-alive Steel Defender recovery and operation isolation", () => {
	test.each([
		["dead", "companionDead"],
		["revivalPending", "companionRevivalPending"],
		["expired", "companionExpired"],
		["vanished", "companionVanished"],
	])("rejects action, reaction, Repair, and Hit Die operations while %s", (status, reason) => {
		const {state, companionId} = makeState({
			companionHp: 0,
			lifecycle: {
				status,
				generation: 1,
				...(status === "revivalPending"
					? {revivalPending: {dueAtGameMinute: 1}}
					: {}),
			},
		});
		for (const [operation, options] of [
			["action", {actionKey: "dodge"}],
			["deflectAttack", {}],
			["repair", {}],
			["hitDie", {}],
		]) {
			expect(state.getCompanionOperationAvailability(companionId, operation, options))
				.toMatchObject({available: false, reason});
		}
	});

	test("ordinary healing, Repair, Arcane Jolt, Hit Dice, and rests never revive it", () => {
		const {state, companionId} = makeState();
		killDefender(state, companionId);

		expect(state.healCompanion(companionId, 999)).toBe(0);
		state.setCompanionHp(companionId, 10);
		expect(state.getCompanion(companionId).hp.current).toBe(0);
		expect(state.useCompanionRepair({
			companionId,
			commandMethod: "bonusAction",
			target: {companionId, confirmed: true},
			rangeConfirmed: true,
			rolls: {healingDice: 8},
		})).toMatchObject({ok: false, reason: "companionDead"});
		expect(state.spendCompanionHitDie({
			companionId,
			target: {companionId, confirmed: true},
			rolls: {hitDie: 8},
		})).toMatchObject({ok: false, reason: "companionDead"});
		expect(state._getEfaArcaneJoltTargetPreflight({
			effect: "restorative",
			target: {
				type: "companion",
				companionId,
				visible: true,
				distanceFeet: 5,
			},
			originatingHit: {targetName: "Dummy"},
		})).toMatchObject({ok: false, reason: "targetDeadOrUnavailable"});

		state.onShortRest();
		expect(state.getCompanion(companionId)).toMatchObject({
			active: false,
			hp: {current: 0},
			lifecycle: {status: "dead"},
		});
		state.onLongRest();
		expect(state.getCompanion(companionId)).toMatchObject({
			active: false,
			hp: {current: 0},
			lifecycle: {status: "expired"},
		});
	});
});

describe("EFA Steel Defender Long Rest replacement", () => {
	test("projects only detached positive persisted Smith's Tools (XPHB) inventory rows", () => {
		const {state, companionId} = makeState();
		const exact = addTool(state);
		addTool(state, {id: "smith-tools-spare", quantity: 2});
		addTool(state, {id: "wrong-source-tools", source: "PHB"});
		addTool(state, {id: "custom-tools", isCustom: true});
		state._data.inventory.push({
			id: "generated-tools",
			item: {
				name: "Smith's Tools",
				source: "XPHB",
				type: "AT",
				_isGeneratedFeatureItem: true,
				_generatedItemProvenance: {temporary: true},
			},
			quantity: 1,
		});

		const rows = state.getFeatureCompanionReplacementToolRows(companionId);
		expect(rows).toEqual([
			{
				itemId: exact,
				itemUid: "Smith's Tools|XPHB",
				name: "Smith's Tools",
				source: "XPHB",
				quantity: 3,
				label: "Smith's Tools (XPHB) — quantity 3",
			},
		]);
		rows[0].quantity = 99;
		rows[0].name = "Changed";
		expect(state.getFeatureCompanionReplacementToolRows(companionId)[0]).toEqual({
			itemId: exact,
			itemUid: "Smith's Tools|XPHB",
			name: "Smith's Tools",
			source: "XPHB",
			quantity: 3,
			label: "Smith's Tools (XPHB) — quantity 3",
		});
		expect(state.getFeatureCompanionReplacementToolRows("missing-companion")).toEqual([]);
	});

	test("requires the exact persisted XPHB Smith's Tools row and explicit in-hand confirmation", () => {
		const {state, companionId} = makeState();
		const exact = addTool(state);
		const wrongSource = addTool(state, {id: "wrong-source-tools", source: "PHB"});
		const synthetic = addTool(state, {id: "synthetic-tools", isCustom: true});

		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId: exact,
			inHandConfirmed: true,
		})).toMatchObject({available: false, reason: "longRestRequired"});

		state.onLongRest();
		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId: exact,
			inHandConfirmed: false,
		})).toMatchObject({available: false, reason: "toolInHandNotConfirmed"});
		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId: wrongSource,
			inHandConfirmed: true,
		})).toMatchObject({available: false, reason: "wrongToolItem"});
		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId: synthetic,
			inHandConfirmed: true,
		})).toMatchObject({available: false, reason: "syntheticToolItem"});
		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId: exact,
			inHandConfirmed: true,
		})).toMatchObject({
			available: true,
			toolItem: {itemId: exact, itemUid: "Smith's Tools|XPHB", quantity: 1},
		});
	});

	test("keeps the stable ID/setup, increments generation, restores resources, and records the vanished generation once per rest", () => {
		const {state, companionId} = makeState({
			companionHp: 7,
			lifecycle: {status: "alive", generation: 4, customLifecycleMarker: "kept"},
		});
		const toolItemId = addTool(state);
		const beforeSetup = structuredClone(state.getCompanion(companionId).setup);
		state.getCompanion(companionId).conditions = ["poisoned"];
		state.getCompanion(companionId).turnUsage = {action: true, reaction: true, flags: {spent: true}};
		state.onLongRest();
		expect(state.getCompanion(companionId).hp.current).toBe(7);

		const replaced = state.replaceFeatureCompanionAfterLongRest({
			companionId,
			toolItemId,
			inHandConfirmed: true,
		});
		expect(replaced).toMatchObject({
			ok: true,
			committed: true,
			companionId,
			generation: {previousGeneration: 4, generation: 5},
			hp: {current: 50, max: 50, temp: 0},
			lifecycle: {
				status: "alive",
				generation: 5,
				customLifecycleMarker: "kept",
				generationHistory: [{
					generation: 4,
					status: "vanished",
					reason: "longRestReplacement",
					longRestMinute: 480,
				}],
			},
		});
		const companion = state.getCompanion(companionId);
		expect(companion.id).toBe(companionId);
		expect(companion.customName).toBe("Rivet");
		expect(companion.setup).toEqual(beforeSetup);
		expect(companion.uses.repair.current).toBe(companion.uses.repair.max);
		expect(companion.hitDice.current).toBe(companion.hitDice.max);
		expect(companion.turnUsage).toEqual({action: false, reaction: false, flags: {}});
		expect(companion.conditions).toEqual([]);

		const afterFirst = state.toJson();
		expect(state.replaceFeatureCompanionAfterLongRest({
			companionId,
			toolItemId,
			inHandConfirmed: true,
		})).toMatchObject({ok: false, reason: "replacementAlreadyUsed"});
		expect(state.toJson()).toEqual(afterFirst);
	});

	test("replacement is optional, never automatic, and rolls back a late failure", () => {
		const {state, companionId} = makeState({companionHp: 9});
		const toolItemId = addTool(state);
		state.onLongRest();
		expect(state.getCompanion(companionId)).toMatchObject({
			id: companionId,
			hp: {current: 9},
			lifecycle: {status: "alive", generation: 1},
		});

		const before = state.toJson();
		jest.spyOn(state, "_commitFeatureCompanionReplacement").mockImplementation((companion, availability) => {
			companion.lifecycle.status = "vanished";
			throw new Error(`late replacement failure at ${availability.lastLongRestMinute}`);
		});
		expect(state.replaceFeatureCompanionAfterLongRest({
			companionId,
			toolItemId,
			inHandConfirmed: true,
		})).toMatchObject({
			ok: false,
			reason: "transactionRolledBack",
			rollback: {
				companion: {ok: true, companionId},
				turnReceipts: {ok: true},
			},
		});
		expect(state.toJson()).toEqual(before);
	});

	test("rejects replacement while the owner is dead and malformed operation bags", () => {
		const {state, companionId} = makeState();
		const toolItemId = addTool(state);
		state.onLongRest();
		state.setDeathSaveFailures(3);
		expect(state.getFeatureCompanionReplacementAvailability(companionId, {
			toolItemId,
			inHandConfirmed: true,
		})).toMatchObject({available: false, reason: "ownerDead"});

		const before = state.toJson();
		expect(state.replaceFeatureCompanionAfterLongRest(null)).toMatchObject({
			ok: false,
			reason: "invalidReplacementOptions",
		});
		expect(state.toJson()).toEqual(before);
	});
});

describe("owner death and exact-source isolation", () => {
	const deathMutations = [
		["massive damage", state => state.takeDamage(999, {unpreventable: true})],
		["death-save object setter", state => state.setDeathSaves({successes: 0, failures: 3})],
		["death-save failure setter", state => state.setDeathSaveFailures(3)],
		["third added failure", state => {
			state.setDeathSaveFailures(2);
			state.addDeathSaveFailure();
		}],
		["third failed save", state => {
			state.setDeathSaveFailures(2);
			state.makeDeathSave(false);
		}],
		["exhaustion death", state => {
			state.setExhaustionRules("2024");
			state.setExhaustion(6);
		}],
	];

	test.each(deathMutations)("vanishes the exact EFA generation on %s and never restores it when the owner recovers", (_label, mutate) => {
		const {state, companionId} = makeState();
		mutate(state);
		const vanished = state.getCompanion(companionId);
		expect(vanished).toMatchObject({
			active: false,
			hp: {current: 0},
			lifecycle: {
				status: "vanished",
				vanishedReason: "summonerDeath",
				ownerDeathReceiptId: expect.any(String),
			},
		});

		state.setDeathSaveFailures(0);
		state.setExhaustion(0);
		state.setHp(20, 20, 0);
		expect(state.getCompanion(companionId).lifecycle.status).toBe("vanished");
		expect(state.getCompanion(companionId).active).toBe(false);
	});

	test("defers owner-death vanishing while an actionable zero-HP intervention remains pending", () => {
		const {state, companionId} = makeState();
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.takeDamage(20);
		state.setDeathSaveFailures(3);
		expect(state.getPendingZeroHpIntervention()).not.toBeNull();
		expect(state.getCompanion(companionId).lifecycle.status).toBe("alive");

		state.clearPendingZeroHpIntervention();
		expect(state.getCompanion(companionId).lifecycle.status).toBe("vanished");
	});

	test("vanishes only the exact EFA defender when TCE, RHW, name-only, and wrong-source companions coexist", () => {
		const {state, companionId} = makeState();
		const others = [
			{
				id: "tce",
				name: "Steel Defender",
				source: "TCE",
				featureGrant: {uid: TCE_UID},
				lifecycle: {status: "alive", generation: 2},
			},
			{
				id: "rhw",
				name: "Reanimated Companion",
				source: "RHW",
				featureGrant: {uid: REANIMATOR_UID},
				lifecycle: {status: "alive", generation: 2},
			},
			{id: "name-only", name: "Steel Defender", source: "EFA"},
			{
				id: "wrong-owner-source",
				name: "Steel Defender",
				source: "EFA",
				featureGrant: {uid: "Steel Defender|Artificer|EFA|Battle Smith|RHW|3|RHW"},
				lifecycle: {status: "alive"},
			},
			{
				id: "wrong-companion-source",
				name: "Steel Defender",
				source: "TCE",
				featureGrant: {uid: EFA_UID},
				lifecycle: {status: "alive"},
			},
		].map(spec => state.addCompanion({
			...spec,
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			origin: "Battle Smith",
			creatureType: "construct",
			hp: {max: 20, current: 20},
		}));

		state.setDeathSaveFailures(3);
		expect(state.getCompanion(companionId).lifecycle.status).toBe("vanished");
		for (const id of others) {
			expect(state.getCompanion(id).active).toBe(true);
			expect(state.getCompanion(id).hp.current).toBe(20);
			expect(state.getCompanion(id).lifecycle?.status).not.toBe("vanished");
		}
	});
});

describe("lifecycle malformed-input controls", () => {
	test.each([Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined])(
		"rejects malformed companion HP assignment %p without mutation",
		hp => {
			const {state, companionId} = makeState();
			const before = state.toJson();
			state.setCompanionHp(companionId, hp);
			expect(state.toJson()).toEqual(before);
		},
	);

	test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, "5", null])(
		"rejects malformed companion damage %p without mutation",
		amount => {
			const {state, companionId} = makeState();
			const before = state.toJson();
			expect(state.damageCompanion(companionId, amount)).toMatchObject({
				hpLost: 0,
				droppedToZero: false,
				reason: "invalidDamageAmount",
			});
			expect(state.toJson()).toEqual(before);
		},
	);
});
