import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const State = globalThis.CharacterSheetState;

const OTHER_OWNER = {
	featureUid: "Experimental Elixir|Artificer|EFA|3",
	classUid: "Artificer|EFA",
	subclassUid: null,
	featureSource: "EFA",
};

const WRONG_SOURCE_OWNER = {
	...State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
	featureSource: "RHW",
};

function makeState () {
	const state = new State();
	state.addClass({name: "Artificer", source: "EFA", level: 2});
	state.setHp(20, 20, 0);
	return state;
}

function createGeneratedItem (
	state,
	{
		owner = State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
		name = "Bag of Holding",
		type = "W",
		equipped = false,
		attuned = false,
		containerCapacity = null,
	} = {},
) {
	return state.createGeneratedFeatureItem({
		item: {
			name,
			source: "TST",
			type,
			...(containerCapacity ? {containerCapacity} : {}),
			...(equipped || attuned ? {effects: [{type: "ac", value: 1, name: `${name} ward`}]} : {}),
		},
		owner,
		metadata: {sourceFeatureUid: owner.featureUid, temporary: true},
		creation: {
			order: state.getGeneratedFeatureItemRows(owner).length + 1,
			receiptId: `${name}-creation`,
			event: "test",
			batchId: null,
		},
		lifecycle: {
			version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
			state: "active",
			deathExpiryDaysRemaining: null,
			deathExpiryAssignedReceiptId: null,
			callbacks: {
				onLongRest: "retain",
				onDeath: "expire-after-1d4-days",
				onLifecycleDay: "decrement-expiry",
			},
			metadata: {},
		},
		equipped,
		attuned,
	});
}

function getExpiry (state, itemId) {
	return state.getInventory()
		.find(row => row.id === itemId)
		?.item?._generatedItemProvenance?.lifecycle?.expiryRecords?.[0] || null;
}

describe("EFA Replicate Magic Item death expiry", () => {
	let randomise;

	beforeEach(() => {
		globalThis.RollerUtil.randomise = jest.fn(() => 3);
		randomise = globalThis.RollerUtil.randomise;
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete globalThis.RollerUtil.randomise;
	});

	test("assigns one persisted 1d4 expiry on the third failed death save without passive-read rerolls", () => {
		const state = makeState();
		const created = createGeneratedItem(state);

		state.setDeathSaveFailures(2);
		expect(getExpiry(state, created.itemId)).toBeNull();
		state.addDeathSaveFailure();

		expect(getExpiry(state, created.itemId)).toMatchObject({
			version: 1,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: expect.any(String),
			roll: {formula: "1d4", result: 3},
			daysRemaining: 3,
		});
		expect(state.toJson().generatedFeatureItemLifecycle).toMatchObject({
			version: 1,
			deathTransition: {
				version: 1,
				isFinalizedDead: true,
				receiptId: expect.any(String),
			},
		});

		for (let i = 0; i < 3; i++) {
			expect(state.isDead()).toBe(true);
			expect(state.getHp()).toMatchObject({current: 20, max: 20});
			state.getGeneratedFeatureItemManagementRows();
			state.reconcileGeneratedFeatureItemDeathTransition({reason: "repeat"});
		}
		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("keeps passive death, HP, rendering, and management reads mutation-free", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state._data.deathSaves.failures = 3;
		const before = state.toJson();

		expect(state.isDead()).toBe(true);
		expect(state.getHp()).toMatchObject({current: 20, max: 20});
		state.getGeneratedFeatureItemManagementRows();

		expect(getExpiry(state, created.itemId)).toBeNull();
		expect(state.toJson()).toEqual(before);
		expect(randomise).not.toHaveBeenCalled();
	});

	test("defers expiry until a pending zero-HP intervention is cleared, then finalizes success or failure once", () => {
		const declined = makeState();
		const declinedItem = createGeneratedItem(declined);
		declined.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		declined.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		declined.takeDamage(20);
		declined.setDeathSaveFailures(3);
		expect(declined.getPendingZeroHpIntervention()).not.toBeNull();
		expect(declined.isDead()).toBe(true);
		expect(getExpiry(declined, declinedItem.itemId)).toBeNull();
		declined.clearPendingZeroHpIntervention();
		expect(getExpiry(declined, declinedItem.itemId)?.daysRemaining).toBe(3);

		const saved = makeState();
		const savedItem = createGeneratedItem(saved);
		saved.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		saved.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		saved.takeDamage(20);
		expect(getExpiry(saved, savedItem.itemId)).toBeNull();
		expect(saved.applyZeroHpIntervention("strengthOfTheGrave", {total: 99})).toMatchObject({
			applied: true,
			success: true,
		});
		expect(saved.isDead()).toBe(false);
		expect(getExpiry(saved, savedItem.itemId)).toBeNull();
		expect(randomise).toHaveBeenCalledTimes(1);

		const failed = makeState();
		const failedItem = createGeneratedItem(failed);
		failed.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		failed.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		failed.takeDamage(20);
		failed.setDeathSaveFailures(3);
		expect(failed.applyZeroHpIntervention("strengthOfTheGrave", {total: 0})).toMatchObject({
			applied: true,
			success: false,
		});
		expect(getExpiry(failed, failedItem.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(2);
	});

	test("finalizes a persisted massive-death trigger on load instead of restoring a stale intervention", () => {
		randomise.mockReturnValue(4);
		const state = makeState();
		const created = createGeneratedItem(state);
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.takeDamage(20);
		const pending = MiscUtil.copyFast(state._data._pendingZeroHpIntervention);
		state._data.massiveDamageDeath = true;
		const payload = state.toJson();
		payload._pendingZeroHpIntervention = pending;
		expect(getExpiry(state, created.itemId)).toBeNull();

		const loaded = new State();
		expect(loaded.loadFromJson(payload)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)?.daysRemaining).toBe(4);
		expect(loaded.toJson()._pendingZeroHpIntervention).toBeUndefined();
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("does not let a healed stale intervention defer a later death", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.takeDamage(20);
		expect(state.getPendingZeroHpIntervention()).not.toBeNull();

		state.heal(5);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
		state.setDeathSaveFailures(3);

		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(3);
		expect(state.toJson()._pendingZeroHpIntervention).toBeUndefined();
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("finalizes massive damage after its death flag is set when no eligible intervention remains", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});

		state.takeDamage(40, {damageType: "radiant"});

		expect(state.getPendingZeroHpIntervention()).toEqual(expect.objectContaining({
			interventions: [expect.objectContaining({
				id: "strengthOfTheGrave",
				available: false,
			})],
		}));
		expect(state.isDead()).toBe(true);
		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("reconciles all death-save and exhaustion mutation families through the shared seam", () => {
		const viaObjectSetter = makeState();
		const objectItem = createGeneratedItem(viaObjectSetter);
		viaObjectSetter.setDeathSaves({successes: 0, failures: 3});
		expect(getExpiry(viaObjectSetter, objectItem.itemId)?.daysRemaining).toBe(3);

		const viaSave = makeState();
		const saveItem = createGeneratedItem(viaSave);
		viaSave.setDeathSaveFailures(2);
		viaSave.makeDeathSave(false);
		expect(getExpiry(viaSave, saveItem.itemId)?.daysRemaining).toBe(3);

		const viaExhaustion = makeState();
		const exhaustionItem = createGeneratedItem(viaExhaustion);
		viaExhaustion.setExhaustionRules("2024");
		viaExhaustion.setExhaustion(6);
		expect(getExpiry(viaExhaustion, exhaustionItem.itemId)?.daysRemaining).toBe(3);

		const viaRuleChange = makeState();
		const ruleItem = createGeneratedItem(viaRuleChange);
		viaRuleChange.setExhaustionRules("thelemar");
		viaRuleChange.setExhaustion(6);
		expect(viaRuleChange.isDead()).toBe(false);
		viaRuleChange.setExhaustionRules("2024");
		expect(getExpiry(viaRuleChange, ruleItem.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(4);
	});

	test("starts expiry for items created after finalized death through the generic creation callback", () => {
		const state = makeState();
		state.setExhaustionRules("2024");
		state.setExhaustion(6);
		expect(state.isDead()).toBe(true);

		const replicate = createGeneratedItem(state);
		const other = createGeneratedItem(state, {owner: OTHER_OWNER, name: "Experimental Elixir"});
		const wrongSource = createGeneratedItem(state, {owner: WRONG_SOURCE_OWNER, name: "Wrong-Source Replicate"});

		expect(getExpiry(state, replicate.itemId)?.daysRemaining).toBe(3);
		expect(getExpiry(state, other.itemId)).toBeNull();
		expect(getExpiry(state, wrongSource.itemId)).toBeNull();
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("does not advance or remove persisted expiry records owned by another feature or source", () => {
		const state = makeState();
		const other = createGeneratedItem(state, {owner: OTHER_OWNER, name: "Experimental Elixir"});
		const wrongSource = createGeneratedItem(state, {owner: WRONG_SOURCE_OWNER, name: "Wrong-Source Replicate"});
		for (const itemId of [other.itemId, wrongSource.itemId]) {
			const lifecycle = state.getInventory().find(row => row.id === itemId).item._generatedItemProvenance.lifecycle;
			lifecycle.expiryRecords = [{
				version: 1,
				policyId: "expire-after-1d4-days",
				trigger: "death",
				assignedReceiptId: "foreign-receipt",
				roll: {formula: "1d4", result: 1},
				daysRemaining: 1,
			}];
			lifecycle.deathExpiryDaysRemaining = 1;
			lifecycle.deathExpiryAssignedReceiptId = "foreign-receipt";
		}

		expect(state.advanceGeneratedFeatureItemLifecycleDays(1)).toMatchObject({
			ok: true,
			updated: [],
			removed: [],
		});
		expect(getExpiry(state, other.itemId)?.daysRemaining).toBe(1);
		expect(getExpiry(state, wrongSource.itemId)?.daysRemaining).toBe(1);
	});

	test("round-trips without rerolling and starts a dead legacy save exactly once", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);
		const saved = state.toJson();

		const loaded = new State();
		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(1);

		const legacy = makeState();
		const legacyItem = createGeneratedItem(legacy);
		const legacySave = legacy.toJson();
		delete legacySave.generatedFeatureItemLifecycle;
		legacySave.deathSaves.failures = 3;
		const legacyLoaded = new State();
		expect(legacyLoaded.loadFromJson(legacySave)).not.toBe(false);
		expect(getExpiry(legacyLoaded, legacyItem.itemId)?.daysRemaining).toBe(3);
		expect(randomise).toHaveBeenCalledTimes(2);
	});

	test("keeps a started countdown through revival and repairs duplicate numeric records idempotently without rerolling", () => {
		randomise.mockReturnValue(4);
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);
		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(4);
		state.setDeathSaveFailures(0);
		expect(state.isDead()).toBe(false);
		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(4);

		const saved = state.toJson();
		saved.deathSaves.failures = 3;
		saved.generatedFeatureItemLifecycle.deathTransition = {
			version: 1,
			isFinalizedDead: true,
			receiptId: "persisted-death",
		};
		const lifecycle = saved.inventory.find(row => row.id === created.itemId).item._generatedItemProvenance.lifecycle;
		lifecycle.expiryRecords = [
			{
				version: 1,
				policyId: "expire-after-1d4-days",
				trigger: "death",
				assignedReceiptId: "persisted-death",
				roll: {formula: "wrong", result: 10},
				daysRemaining: 9,
			},
			{
				version: 99,
				policyId: "expire-after-1d4-days",
				trigger: "death",
				assignedReceiptId: "duplicate",
				roll: {formula: "1d4", result: 4},
				daysRemaining: 2,
			},
			{
				version: 1,
				policyId: "expire-after-1d4-days",
				trigger: "death",
				assignedReceiptId: "invalid",
				roll: {formula: "1d4", result: "not-a-number"},
				daysRemaining: 1,
			},
		];

		randomise.mockClear();
		const loaded = new State();
		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)).toEqual({
			version: 1,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: "duplicate",
			roll: {formula: "1d4", result: 4},
			daysRemaining: 2,
		});
		const loadedLifecycle = loaded.getInventory().find(row => row.id === created.itemId)
			.item._generatedItemProvenance.lifecycle;
		expect(loadedLifecycle).toMatchObject({
			deathExpiryDaysRemaining: 2,
			deathExpiryAssignedReceiptId: "duplicate",
		});
		expect(randomise).not.toHaveBeenCalled();

		const savedAgain = loaded.toJson();
		const loadedAgain = new State();
		expect(loadedAgain.loadFromJson(savedAgain)).not.toBe(false);
		expect(getExpiry(loadedAgain, created.itemId)).toEqual(getExpiry(loaded, created.itemId));
		expect(randomise).not.toHaveBeenCalled();
	});

	test("migrates a valid legacy mirror-only countdown without rerolling", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		const saved = state.toJson();
		saved.deathSaves.failures = 3;
		saved.generatedFeatureItemLifecycle.deathTransition = {
			version: 1,
			isFinalizedDead: true,
			receiptId: "persisted-death",
		};
		const lifecycle = saved.inventory.find(row => row.id === created.itemId).item._generatedItemProvenance.lifecycle;
		lifecycle.expiryRecords = [];
		lifecycle.deathExpiryDaysRemaining = 2;
		lifecycle.deathExpiryAssignedReceiptId = "legacy-receipt";

		const loaded = new State();
		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)).toEqual({
			version: 1,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: "legacy-receipt",
			roll: {formula: "1d4", result: 2},
			daysRemaining: 2,
		});
		expect(randomise).not.toHaveBeenCalled();

		const loadedAgain = new State();
		expect(loadedAgain.loadFromJson(loaded.toJson())).not.toBe(false);
		expect(getExpiry(loadedAgain, created.itemId)).toEqual(getExpiry(loaded, created.itemId));
		expect(randomise).not.toHaveBeenCalled();
	});

	test("public serialize omits a pending zero-HP intervention", () => {
		const state = makeState();
		createGeneratedItem(state);
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.takeDamage(20);
		expect(state.getPendingZeroHpIntervention()).not.toBeNull();

		expect(JSON.parse(state.serialize()).data._pendingZeroHpIntervention).toBeUndefined();
	});

	test("public deserialize clears a persisted pending intervention and finalizes dead expiry idempotently", () => {
		randomise.mockReturnValue(4);
		const state = makeState();
		const created = createGeneratedItem(state);
		state.getFeatureCalculations = () => ({hasStrengthOfTheGrave: true});
		state.addFeature({
			name: "Strength of the Grave",
			source: "XGE",
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.takeDamage(20);
		const pending = MiscUtil.copyFast(state._data._pendingZeroHpIntervention);
		state.setDeathSaveFailures(3);
		expect(getExpiry(state, created.itemId)).toBeNull();
		const payload = JSON.parse(state.serialize());
		payload.data._pendingZeroHpIntervention = pending;

		const loaded = State.deserialize(JSON.stringify(payload));
		expect(getExpiry(loaded, created.itemId)?.daysRemaining).toBe(4);
		expect(loaded.toJson()._pendingZeroHpIntervention).toBeUndefined();
		expect(randomise).toHaveBeenCalledTimes(1);

		const loadedAgain = State.deserialize(loaded.serialize());
		expect(getExpiry(loadedAgain, created.itemId)).toEqual(getExpiry(loaded, created.itemId));
		expect(randomise).toHaveBeenCalledTimes(1);
	});

	test("public deserialize migrates a mirror-only countdown without rerolling", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		const payload = JSON.parse(state.serialize());
		payload.data.deathSaves.failures = 3;
		payload.data.generatedFeatureItemLifecycle.deathTransition = {
			version: 1,
			isFinalizedDead: true,
			receiptId: "persisted-death",
		};
		const lifecycle = payload.data.inventory.find(row => row.id === created.itemId).item._generatedItemProvenance.lifecycle;
		lifecycle.expiryRecords = [];
		lifecycle.deathExpiryDaysRemaining = 2;
		lifecycle.deathExpiryAssignedReceiptId = "legacy-receipt";

		const loaded = State.deserialize(JSON.stringify(payload));
		expect(getExpiry(loaded, created.itemId)).toEqual({
			version: 1,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: "legacy-receipt",
			roll: {formula: "1d4", result: 2},
			daysRemaining: 2,
		});
		expect(randomise).not.toHaveBeenCalled();
	});

	test("quarantines irreparable expiry numerics without guessing or rerolling", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		const saved = state.toJson();
		saved.deathSaves.failures = 3;
		saved.generatedFeatureItemLifecycle.deathTransition = {
			version: 1,
			isFinalizedDead: true,
			receiptId: "persisted-death",
		};
		saved.inventory.find(row => row.id === created.itemId)
			.item._generatedItemProvenance.lifecycle.expiryRecords = [{
				version: 1,
				policyId: "expire-after-1d4-days",
				trigger: "death",
				assignedReceiptId: "persisted-death",
				roll: {formula: "1d4", result: "invalid"},
				daysRemaining: "invalid",
			}];

		const loaded = new State();
		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)).toMatchObject({
			policyId: "expire-after-1d4-days",
			roll: {formula: "1d4", result: null},
			daysRemaining: null,
			repairRequired: true,
			repairReason: "invalid-expiry-numeric",
		});
		expect(loaded.getGeneratedFeatureItemManagementRows()).toEqual([
			expect.objectContaining({
				itemId: created.itemId,
				repairRequired: true,
				issues: expect.arrayContaining(["invalid-expiry-numeric"]),
			}),
		]);
		expect(randomise).not.toHaveBeenCalled();
	});

	test("advances explicit lifecycle days atomically, never on long rest, and removes expired rows normally", () => {
		randomise.mockReturnValue(2);
		const state = makeState();
		const container = createGeneratedItem(state, {
			name: "Replicated Satchel",
			equipped: true,
			attuned: true,
			containerCapacity: {weight: [100]},
		});
		state.addItem({id: "cargo", name: "Cargo", source: "TST", type: "G"});
		expect(state.putItemInContainer("cargo", container.itemId)).toEqual({success: true});
		state.setDeathSaveFailures(3);

		state.onLongRest();
		expect(getExpiry(state, container.itemId)?.daysRemaining).toBe(2);
		expect(state.advanceGeneratedFeatureItemLifecycleDays(0)).toMatchObject({ok: false});
		expect(state.advanceGeneratedFeatureItemLifecycleDays(1.5)).toMatchObject({ok: false});
		expect(getExpiry(state, container.itemId)?.daysRemaining).toBe(2);

		expect(state.advanceGeneratedFeatureItemLifecycleDays(1)).toMatchObject({
			ok: true,
			daysAdvanced: 1,
			updated: [{itemId: container.itemId, daysRemaining: 1}],
			removed: [],
		});
		expect(state.advanceGeneratedFeatureItemLifecycleDays(1)).toMatchObject({
			ok: true,
			daysAdvanced: 1,
			removed: [{itemId: container.itemId, name: "Replicated Satchel"}],
		});
		expect(state.getInventory().find(row => row.id === container.itemId)).toBeUndefined();
		expect(state.getInventory().find(row => row.id === "cargo")).toBeDefined();
		expect(state.getItemContainer("cargo")).toBeNull();
		expect(state.getAttunedItems().some(row => row.id === container.itemId)).toBe(false);
		expect(state.getNamedModifiers().some(mod => mod.sourceItemId === container.itemId)).toBe(false);
	});

	test("advances multiple explicit days in one validated transaction", () => {
		randomise.mockReturnValue(4);
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);

		expect(state.advanceGeneratedFeatureItemLifecycleDays(2)).toMatchObject({
			ok: true,
			daysAdvanced: 2,
			updated: [{itemId: created.itemId, daysRemaining: 2}],
			removed: [],
		});
		expect(getExpiry(state, created.itemId)?.daysRemaining).toBe(2);
	});
});
