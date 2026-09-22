import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CRUEL_SOURCE = "TalDoreiCampaignSettingReborn";

const RECEIPT_A = Object.freeze({
	key: "feature:Exact Feature|SRC:owner:Exact Owner|SRC:action:rider",
	ownerUid: "feature:Exact Feature|SRC",
	sourceUid: "owner:Exact Owner|SRC",
	actionUid: "rider",
});

const RECEIPT_B = Object.freeze({
	key: "feature:Exact Feature|SRC:owner:Other Owner|SRC2:action:rider",
	ownerUid: "feature:Exact Feature|SRC",
	sourceUid: "owner:Other Owner|SRC2",
	actionUid: "rider",
});

function makeCruelState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	expect(state.addFeat({name: "Cruel", source: CRUEL_SOURCE})).toBe(true);
	return state;
}

function getCrueltyDice (state) {
	return state.getResources().find(resource => resource.name === "Cruelty Dice");
}

describe("CharacterSheetState stable-key per-turn receipts", () => {
	it("commits and queries in combat, rejects a duplicate, and resets on the next turn", () => {
		const state = new CharacterSheetState();
		state.startCombat();

		const committed = state.commitTurnReceipt({...RECEIPT_A, metadata: {target: "first"}});
		expect(committed).toMatchObject({
			ok: true,
			committed: true,
			duplicate: false,
			reason: null,
			key: RECEIPT_A.key,
			turnId: expect.any(Number),
			receipt: {
				receiptVersion: 1,
				receiptId: expect.stringMatching(/^turn-receipt-/),
				...RECEIPT_A,
				turnId: expect.any(Number),
				metadata: {target: "first"},
			},
		});
		expect(state.queryTurnReceipt(RECEIPT_A.key)).toMatchObject({
			ok: true,
			used: true,
			receipt: committed.receipt,
		});
		expect(state.commitTurnReceipt(RECEIPT_A)).toMatchObject({
			ok: false,
			committed: false,
			duplicate: true,
			reason: "alreadyUsed",
			receipt: committed.receipt,
		});

		const turnId = committed.turnId;
		state.advanceRound();
		expect(state.queryTurnReceipt(RECEIPT_A.key)).toMatchObject({
			ok: true,
			used: false,
			turnId: turnId + 1,
			receipt: null,
		});
	});

	it("enforces the same gate out of combat until resetTurnEconomy is called explicitly", () => {
		const state = new CharacterSheetState();

		state.consumeActionType("reaction");
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(state.commitTurnReceipt(RECEIPT_A).ok).toBe(true);
		expect(state.commitTurnReceipt(RECEIPT_A)).toMatchObject({
			ok: false,
			reason: "alreadyUsed",
		});
		state.applyTurnStartEffects();
		expect(state.queryTurnReceipt(RECEIPT_A.key).used).toBe(true);

		const reset = state.resetTurnEconomy();
		expect(reset).toMatchObject({
			ok: true,
			reset: true,
			previousTurnId: 0,
			turnId: 1,
			clearedReceipts: [expect.objectContaining(RECEIPT_A)],
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
		expect(state.queryTurnReceipt(RECEIPT_A.key).used).toBe(false);
		expect(state.commitTurnReceipt(RECEIPT_A).ok).toBe(true);
	});

	it("keeps exact source-qualified keys independent", () => {
		const state = new CharacterSheetState();

		expect(state.commitTurnReceipt(RECEIPT_A).ok).toBe(true);
		expect(state.commitTurnReceipt(RECEIPT_B).ok).toBe(true);
		expect(state.queryTurnReceipt(RECEIPT_A.key).receipt).toMatchObject({
			ownerUid: RECEIPT_A.ownerUid,
			sourceUid: RECEIPT_A.sourceUid,
		});
		expect(state.queryTurnReceipt(RECEIPT_B.key).receipt).toMatchObject({
			ownerUid: RECEIPT_B.ownerUid,
			sourceUid: RECEIPT_B.sourceUid,
		});
	});

	it("rolls back only the matching committed receipt and permits an explicit retry", () => {
		const state = new CharacterSheetState();
		const committed = state.commitTurnReceipt(RECEIPT_A);

		expect(state.rollbackTurnReceipt({...committed.receipt, receiptId: "wrong"})).toMatchObject({
			ok: false,
			rolledBack: false,
			reason: "receiptMismatch",
			receipt: committed.receipt,
		});
		expect(state.queryTurnReceipt(RECEIPT_A.key).used).toBe(true);

		expect(state.rollbackTurnReceipt(committed.receipt)).toMatchObject({
			ok: true,
			rolledBack: true,
			reason: null,
			receipt: committed.receipt,
		});
		expect(state.queryTurnReceipt(RECEIPT_A.key).used).toBe(false);
		expect(state.commitTurnReceipt(RECEIPT_A).ok).toBe(true);
	});

	it("prunes only an exact owner/source scope", () => {
		const state = new CharacterSheetState();
		state.commitTurnReceipt(RECEIPT_A);
		state.commitTurnReceipt(RECEIPT_B);

		expect(state.pruneTurnReceipts({ownerUid: RECEIPT_A.ownerUid})).toMatchObject({
			ok: false,
			pruned: false,
			reason: "invalidPruneScope",
		});
		expect(state.pruneTurnReceipts({
			ownerUid: RECEIPT_A.ownerUid,
			sourceUid: RECEIPT_A.sourceUid,
		})).toMatchObject({
			ok: true,
			pruned: true,
			count: 1,
			receipts: [expect.objectContaining(RECEIPT_A)],
		});
		expect(state.queryTurnReceipt(RECEIPT_A.key).used).toBe(false);
		expect(state.queryTurnReceipt(RECEIPT_B.key).used).toBe(true);
	});
});

describe("per-turn receipt consumer migration", () => {
	it("gates the Cruel triggered die in and out of combat without combatRound coupling", () => {
		const state = makeCruelState();
		const resource = getCrueltyDice(state);
		const descriptor = resource.triggeredDiePool.turnReceipt;

		expect(descriptor).toMatchObject({
			key: `feat:Cruel|${CRUEL_SOURCE}:effect:cruelty-die:action:triggered-die`,
			ownerUid: `feat:Cruel|${CRUEL_SOURCE}`,
			sourceUid: `feat:Cruel|${CRUEL_SOURCE}:effect:cruelty-die`,
			actionUid: "triggered-die",
		});
		expect(state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"})).toMatchObject({
			ok: true,
			committed: true,
			turnReceipt: expect.objectContaining(descriptor),
		});
		expect(state.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true})).toEqual([]);
		expect(state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"})).toMatchObject({
			ok: false,
			committed: false,
			reason: "alreadyUsed",
		});

		state.resetTurnEconomy();
		expect(state.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true})).toHaveLength(1);
		expect(state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"}).ok).toBe(true);
	});

	it("reports a post-receipt resource failure and rolls back the exact receipt", () => {
		const state = makeCruelState();
		const resource = getCrueltyDice(state);
		const descriptor = resource.triggeredDiePool.turnReceipt;
		state.setResourceCurrent = () => {};

		expect(state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"})).toMatchObject({
			ok: false,
			committed: false,
			reason: "resourceCommitFailed",
			turnReceipt: expect.objectContaining(descriptor),
			rollback: {
				ok: true,
				rolledBack: true,
				reason: null,
			},
		});
		expect(resource.current).toBe(resource.max);
		expect(state.queryTurnReceipt(descriptor.key).used).toBe(false);
	});

	it("uses the same receipt transaction for deferred spell-damage riders", () => {
		const state = new CharacterSheetState();
		const input = {
			sourceFeatureId: "feature-id",
			sourceName: "Exact Deferred Rider",
			value: 4,
			turnReceipt: RECEIPT_A,
		};

		expect(state.armPendingSpellDamageBonus(input)).toMatchObject({
			ok: true,
			committed: true,
			reason: null,
			pending: {
				sourceFeatureId: "feature-id",
				sourceName: "Exact Deferred Rider",
				value: 4,
				turnReceipt: RECEIPT_A,
			},
			turnReceipt: expect.objectContaining(RECEIPT_A),
		});
		expect(state.consumePendingSpellDamageBonus()).toMatchObject({
			sourceName: "Exact Deferred Rider",
			value: 4,
			turnReceipt: RECEIPT_A,
		});
		expect(state.armPendingSpellDamageBonus(input)).toMatchObject({
			ok: false,
			committed: false,
			reason: "alreadyUsed",
		});

		state.resetTurnEconomy();
		expect(state.armPendingSpellDamageBonus(input).ok).toBe(true);
	});

	it("migrates the current combat-round resource gate once and removes the legacy store", () => {
		const original = makeCruelState();
		original.startCombat();
		const resource = getCrueltyDice(original);
		const json = original.toJson();
		delete json.turnReceipts;
		json.resourceTurnUsage = {[resource.id]: json.combatRound};

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		const restoredResource = getCrueltyDice(restored);
		const query = restored.queryTurnReceipt(restoredResource.triggeredDiePool.turnReceipt.key);

		expect(query).toMatchObject({
			ok: true,
			used: true,
			receipt: {
				metadata: {migratedFrom: "resourceTurnUsage"},
			},
		});
		expect(restored.getTriggeredFeatDieOptions("damage", {damageSource: "weapon"})).toEqual([]);
		expect(restored.toJson()).not.toHaveProperty("resourceTurnUsage");

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(restored.toJson());
		const reloadedResource = getCrueltyDice(reloaded);
		expect(reloaded.queryTurnReceipt(reloadedResource.triggeredDiePool.turnReceipt.key)).toMatchObject({
			ok: true,
			used: true,
			receipt: {receiptId: query.receipt.receiptId},
		});
	});

	it("migrates a deferred-rider cooldown to its exact class/subclass source identity", () => {
		const original = new CharacterSheetState();
		original.addClass({
			name: "Sorcerer",
			source: "TGTT",
			level: 3,
			subclass: {name: "Sun Bloodline", source: "TGTT"},
		});
		const json = original.toJson();
		delete json.turnReceipts;
		json.pendingSpellDamageBonus = {
			sourceFeatureId: null,
			sourceName: "Summer's Defiant Blood",
			value: 4,
			oncePerRoundKey: "summersDefiantBlood",
			armedAtRound: null,
		};
		json.pendingSpellDamageBonusUsedKeys = ["summersDefiantBlood"];

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		const pending = restored.getPendingSpellDamageBonus();

		expect(pending.turnReceipt).toMatchObject({
			key: expect.stringContaining("Summer's Defiant Blood|Sorcerer|TGTT|Sun Bloodline|TGTT"),
			ownerUid: expect.stringContaining("Sun Bloodline|TGTT|Sorcerer|TGTT"),
			sourceUid: expect.stringContaining("Summer's Defiant Blood|Sorcerer|TGTT|Sun Bloodline|TGTT"),
			actionUid: "spell-damage-rider",
		});
		expect(restored.queryTurnReceipt(pending.turnReceipt.key)).toMatchObject({
			ok: true,
			used: true,
			receipt: {
				metadata: {migratedFrom: "pendingSpellDamageBonusUsedKeys"},
			},
		});
		expect(restored.toJson()).not.toHaveProperty("pendingSpellDamageBonusUsedKeys");
		expect(restored.getPendingSpellDamageBonus()).not.toHaveProperty("oncePerRoundKey");
	});
});
