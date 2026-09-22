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

function makeState () {
	const state = new State();
	state.addClass({name: "Artificer", source: "EFA", level: 2});
	state.setHp(20, 20, 0);
	return state;
}

function createGeneratedItem (state, {owner = State.EFA_REPLICATE_MAGIC_ITEM_OWNER, name = "Bag of Holding"} = {}) {
	return state.createGeneratedFeatureItem({
		item: {name, source: "TST", type: "W"},
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
			expiryRecords: [],
			callbacks: {
				onLongRest: "retain",
				onDeath: "expire-after-1d4-days",
				onLifecycleDay: "decrement-expiry",
			},
			metadata: {},
		},
	});
}

function getExpiry (state, itemId) {
	return state.getInventory()
		.find(row => row.id === itemId)
		?.item?._generatedItemProvenance?.lifecycle?.expiryRecords?.[0] || null;
}

describe("persisted monotonic in-game time", () => {
	let originalRandomise;

	beforeEach(() => {
		originalRandomise = globalThis.RollerUtil.randomise;
		globalThis.RollerUtil.randomise = jest.fn(() => 1);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		if (originalRandomise === undefined) delete globalThis.RollerUtil.randomise;
		else globalThis.RollerUtil.randomise = originalRandomise;
	});

	test("defaults old saves idempotently and round-trips through both persistence APIs", () => {
		const state = makeState();
		const receipt = state.advanceGameTimeMinutes(59, {
			reason: "test-advance",
			identity: "clock-round-trip",
		});

		expect(receipt).toMatchObject({
			ok: true,
			code: "game-time-advanced",
			priorMinute: 0,
			newMinute: 59,
			deltaMinutes: 59,
			reason: "test-advance",
			identity: "clock-round-trip",
			receiptId: expect.any(String),
		});
		expect(state.getGameTimeMinutes()).toBe(59);
		expect(state.toJson().gameTime).toEqual({
			version: State.GAME_TIME_VERSION,
			minute: 59,
			lastLongRestMinute: 0,
		});

		const loaded = new State();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		expect(loaded.getGameTimeMinutes()).toBe(59);

		const deserialized = State.deserialize(state.serialize());
		expect(deserialized.getGameTimeMinutes()).toBe(59);
		expect(JSON.parse(deserialized.serialize()).data.gameTime).toEqual(state.toJson().gameTime);

		const legacy = state.toJson();
		delete legacy.gameTime;
		delete legacy.lastLongRestTime;
		const legacyLoaded = new State();
		expect(legacyLoaded.loadFromJson(legacy)).not.toBe(false);
		expect(legacyLoaded.getGameTimeMinutes()).toBe(0);
		expect(legacyLoaded.toJson().gameTime).toEqual({
			version: State.GAME_TIME_VERSION,
			minute: 0,
			lastLongRestMinute: 0,
		});

		const legacyLoadedAgain = new State();
		expect(legacyLoadedAgain.loadFromJson(legacyLoaded.toJson())).not.toBe(false);
		expect(legacyLoadedAgain.toJson().gameTime).toEqual(legacyLoaded.toJson().gameTime);

		const legacyTimed = state.toJson();
		delete legacyTimed.gameTime;
		legacyTimed.lastLongRestTime = 20;
		const legacyTimedLoaded = new State();
		expect(legacyTimedLoaded.loadFromJson(legacyTimed)).not.toBe(false);
		expect(legacyTimedLoaded.getGameTimeMinutes()).toBe(1200);
		expect(legacyTimedLoaded.getTimeSinceLastLongRest()).toBe(20);
		expect(legacyTimedLoaded.advanceTime(4)).toMatchObject({
			ok: true,
			priorMinute: 1200,
			newMinute: 1440,
			deltaMinutes: 240,
		});
		expect(legacyTimedLoaded.canLongRest()).toBe(true);
	});

	test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null, undefined])(
		"rejects invalid minute delta %p before mutation",
		value => {
			const state = makeState();
			const before = state.toJson();
			const result = state.advanceGameTimeMinutes(value, {
				reason: "invalid-test",
				identity: "validation",
			});

			expect(result).toMatchObject({
				ok: false,
				code: "invalid-game-time-minutes",
				priorMinute: 0,
				newMinute: 0,
				deltaMinutes: 0,
				reason: "invalid-test",
				identity: "validation",
				receiptId: null,
			});
			expect(state.toJson()).toEqual(before);
		},
	);

	test("rejects invalid receipt metadata before mutation", () => {
		const state = makeState();
		const before = state.toJson();

		expect(state.advanceGameTimeMinutes(1, {reason: "", identity: "clock"})).toMatchObject({
			ok: false,
			code: "invalid-game-time-reason",
			deltaMinutes: 0,
		});
		expect(state.advanceGameTimeMinutes(1, {reason: "test", identity: {id: "clock"}})).toMatchObject({
			ok: false,
			code: "invalid-game-time-identity",
			deltaMinutes: 0,
		});
		expect(state.toJson()).toEqual(before);
	});

	test("distinguishes exact +59, +60, and +61 minute boundaries", () => {
		const state = makeState();
		const deathMinute = state.getGameTimeMinutes();

		state.advanceGameTimeMinutes(59, {reason: "revival-window", identity: "companion-a"});
		expect(state.getGameTimeMinutes() - deathMinute).toBe(59);

		state.advanceGameTimeMinutes(1, {reason: "revival-window", identity: "companion-a"});
		expect(state.getGameTimeMinutes() - deathMinute).toBe(60);

		state.advanceGameTimeMinutes(1, {reason: "revival-window", identity: "companion-a"});
		expect(state.getGameTimeMinutes() - deathMinute).toBe(61);
	});

	test("expires an exact-owner Replicate item at 1439 + 1 minutes, not early", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);

		expect(getExpiry(state, created.itemId)).toMatchObject({
			roll: {formula: "1d4", result: 1},
			assignedMinute: 0,
			expiryMinute: 1440,
			minutesRemaining: 1440,
			daysRemaining: 1,
		});

		const beforeBoundary = state.advanceGameTimeMinutes(1439, {
			reason: "boundary-test",
			identity: created.itemId,
		});
		expect(beforeBoundary).toMatchObject({
			ok: true,
			priorMinute: 0,
			newMinute: 1439,
			updated: [{
				itemId: created.itemId,
				minutesRemaining: 1,
				daysRemaining: 1,
				expiryMinute: 1440,
			}],
			removed: [],
		});
		expect(state.getInventory().some(row => row.id === created.itemId)).toBe(true);

		const atBoundary = state.advanceGameTimeMinutes(1, {
			reason: "boundary-test",
			identity: created.itemId,
		});
		expect(atBoundary).toMatchObject({
			ok: true,
			priorMinute: 1439,
			newMinute: 1440,
			removed: [{itemId: created.itemId, name: "Bag of Holding"}],
		});
		expect(state.getInventory().some(row => row.id === created.itemId)).toBe(false);
	});

	test("composes repeated partial advances without truncation or double decrement", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);

		for (const expectedMinute of [480, 960]) {
			const receipt = state.advanceGameTimeMinutes(480, {
				reason: "partial-rest",
				identity: "rest-sequence",
			});
			expect(receipt.newMinute).toBe(expectedMinute);
			expect(state.getInventory().some(row => row.id === created.itemId)).toBe(true);
		}
		state.advanceGameTimeMinutes(479, {reason: "partial-rest", identity: "rest-sequence"});
		expect(getExpiry(state, created.itemId)).toMatchObject({
			minutesRemaining: 1,
			daysRemaining: 1,
		});
		expect(state.advanceGameTimeMinutes(1, {
			reason: "partial-rest",
			identity: "rest-sequence",
		}).removed).toEqual([{itemId: created.itemId, name: "Bag of Holding"}]);
	});

	test("migrates a legacy daysRemaining countdown once without rerolling or shifting its due minute", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);
		const saved = state.toJson();
		saved.gameTime = {version: State.GAME_TIME_VERSION, minute: 600, lastLongRestMinute: 0};
		const lifecycle = saved.inventory.find(row => row.id === created.itemId).item._generatedItemProvenance.lifecycle;
		lifecycle.expiryRecords[0].roll.result = 4;
		lifecycle.expiryRecords[0].daysRemaining = 2;
		delete lifecycle.expiryRecords[0].assignedMinute;
		delete lifecycle.expiryRecords[0].expiryMinute;
		delete lifecycle.expiryRecords[0].minutesRemaining;
		lifecycle.deathExpiryDaysRemaining = 2;
		globalThis.RollerUtil.randomise.mockClear();

		const loaded = new State();
		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getExpiry(loaded, created.itemId)).toMatchObject({
			roll: {formula: "1d4", result: 4},
			assignedMinute: 600,
			expiryMinute: 3480,
			minutesRemaining: 2880,
			daysRemaining: 2,
		});
		expect(globalThis.RollerUtil.randomise).not.toHaveBeenCalled();

		const loadedAgain = new State();
		expect(loadedAgain.loadFromJson(loaded.toJson())).not.toBe(false);
		expect(getExpiry(loadedAgain, created.itemId)).toEqual(getExpiry(loaded, created.itemId));
		expect(globalThis.RollerUtil.randomise).not.toHaveBeenCalled();
	});

	test("isolates foreign generated owners while exact-owner expiry advances", () => {
		const state = makeState();
		const replicate = createGeneratedItem(state);
		const foreign = createGeneratedItem(state, {owner: OTHER_OWNER, name: "Experimental Elixir"});
		state.setDeathSaveFailures(3);
		const foreignLifecycle = state.getInventory()
			.find(row => row.id === foreign.itemId)
			.item._generatedItemProvenance.lifecycle;
		foreignLifecycle.expiryRecords = [{
			version: State.GENERATED_FEATURE_ITEM_EXPIRY_VERSION,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: "foreign",
			roll: {formula: "1d4", result: 1},
			assignedMinute: 0,
			expiryMinute: 1440,
			minutesRemaining: 1440,
			daysRemaining: 1,
		}];

		expect(state.advanceGameTimeMinutes(1440, {
			reason: "owner-isolation",
			identity: "clock",
		})).toMatchObject({
			ok: true,
			removed: [{itemId: replicate.itemId, name: "Bag of Holding"}],
		});
		expect(state.getInventory().some(row => row.id === replicate.itemId)).toBe(false);
		expect(state.getInventory().some(row => row.id === foreign.itemId)).toBe(true);
		expect(getExpiry(state, foreign.itemId)).toMatchObject({
			expiryMinute: 1440,
			minutesRemaining: 1440,
			daysRemaining: 1,
		});
	});

	test("rolls back the clock and lifecycle teardown when exact-owner removal fails", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);
		jest.spyOn(state, "removeItem").mockImplementation(() => {
			throw new Error("teardown failed");
		});

		expect(state.advanceGameTimeMinutes(1440, {
			reason: "rollback-test",
			identity: created.itemId,
		})).toMatchObject({
			ok: false,
			code: "game-time-advance-rolled-back",
			message: "teardown failed",
			priorMinute: 0,
			newMinute: 0,
			deltaMinutes: 0,
			updated: [],
			removed: [],
		});
		expect(state.getGameTimeMinutes()).toBe(0);
		expect(state.getInventory().some(row => row.id === created.itemId)).toBe(true);
		expect(getExpiry(state, created.itemId)).toMatchObject({
			minutesRemaining: 1440,
			daysRemaining: 1,
		});
	});

	test("keeps the public day API as a causal wrapper over the minute transaction", () => {
		const state = makeState();
		const advance = jest.spyOn(state, "advanceGameTimeMinutes").mockReturnValue({
			ok: true,
			code: "game-time-advanced",
			priorMinute: 10,
			newMinute: 2890,
			deltaMinutes: 2880,
			reason: "generated-feature-lifecycle-days",
			identity: "advanceGeneratedFeatureItemLifecycleDays",
			receiptId: "receipt",
			updated: [{itemId: "item", daysRemaining: 1, minutesRemaining: 1440, expiryMinute: 4330}],
			removed: [],
		});

		expect(state.advanceGeneratedFeatureItemLifecycleDays(2)).toMatchObject({
			ok: true,
			code: "lifecycle-days-advanced",
			daysAdvanced: 2,
			priorMinute: 10,
			newMinute: 2890,
		});
		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(2880, {
			reason: "generated-feature-lifecycle-days",
			identity: "advanceGeneratedFeatureItemLifecycleDays",
		});
	});

	test("keeps advanceTime as an exact whole-minute delegation", () => {
		const state = makeState();
		const advance = jest.spyOn(state, "advanceGameTimeMinutes");

		expect(state.advanceTime(0.1)).toMatchObject({
			ok: true,
			deltaMinutes: 6,
			newMinute: 6,
		});
		expect(advance).toHaveBeenCalledWith(6, {
			reason: "advance-time-hours",
			identity: "CharacterSheetState.advanceTime",
		});
		expect(state.getTimeSinceLastLongRest()).toBe(0.1);

		const before = state.toJson();
		expect(state.advanceTime(1 / 600)).toMatchObject({
			ok: false,
			code: "invalid-game-time-hours",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("uses repository rest durations, advances partial expiry, and never treats long rest as a lifecycle day", () => {
		const state = makeState();
		const created = createGeneratedItem(state);
		state.setDeathSaveFailures(3);
		const dayAdvance = jest.spyOn(state, "advanceGeneratedFeatureItemLifecycleDays");
		const requirements = jest.spyOn(state, "getRestRequirements");

		expect(state.onShortRest()).toMatchObject({
			ok: true,
			deltaMinutes: 60,
			newMinute: 60,
			reason: "short-rest",
		});
		expect(state.onLongRest()).toMatchObject({
			ok: true,
			deltaMinutes: 480,
			priorMinute: 60,
			newMinute: 540,
			reason: "long-rest",
		});
		expect(requirements).toHaveBeenCalledWith("short");
		expect(requirements).toHaveBeenCalledWith("long");
		expect(dayAdvance).not.toHaveBeenCalled();
		expect(state.getGameTimeMinutes()).toBe(540);
		expect(state.getTimeSinceLastLongRest()).toBe(0);
		expect(getExpiry(state, created.itemId)).toMatchObject({
			expiryMinute: 1440,
			minutesRemaining: 900,
			daysRemaining: 1,
		});
	});

	test("consumes the duration returned by getRestRequirements instead of duplicating rest constants", () => {
		const state = makeState();
		jest.spyOn(state, "getRestRequirements").mockImplementation(restType => ({
			duration: restType === "short" ? 7 : 11,
		}));

		expect(state.onShortRest()).toMatchObject({
			ok: true,
			priorMinute: 0,
			newMinute: 7,
			deltaMinutes: 7,
		});
		expect(state.onLongRest()).toMatchObject({
			ok: true,
			priorMinute: 7,
			newMinute: 18,
			deltaMinutes: 11,
		});
	});
});
