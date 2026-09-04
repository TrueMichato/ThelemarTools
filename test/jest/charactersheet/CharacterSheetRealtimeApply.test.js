import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetRealtimeCoordinator} from "../../../js/charactersheet/charactersheet-realtime.js";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";
import {LocalCharacterRepository} from "../../../js/hub/hub-character-repository.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

let CharacterSheetPage;

/** Mirrors the transport double used by the merged coordinator tests. */
class FakeRealtimeClient {
	constructor () {
		this.listeners = new Map();
		this.pConnect = jest.fn(async () => {});
		this.suspend = jest.fn();
		this.close = jest.fn();
	}

	on (type, listener) {
		const listeners = this.listeners.get(type) || new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
		return () => listeners.delete(listener);
	}

	emit (type, value) {
		for (const listener of this.listeners.get(type) || []) listener(value);
	}
}

const makeAppliedEvent = ({
	id = "event-1",
	operationId = "operation-1",
	sequence = 20,
	revision = 2,
	kind = "hp.damage",
	args = {amount: 4},
	targetCharacterId = "character-1",
	leg = null,
} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: "character.operation.applied",
	aggregateType: "character",
	aggregateId: targetCharacterId,
	aggregateRevision: revision,
	payload: {
		...(leg ? {leg} : {}),
		operation: {operationId, kind, version: 1, targetCharacterId, arguments: args},
		resultingCharacterRevision: revision,
	},
});

const makeSourceCost = () => ({
	version: 1,
	components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
});

const makeSourceEvent = ({
	id = "source-event-1",
	operationId = "operation-1",
	sequence = 20,
	revision = 2,
} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: "character.operation.source_cost_consumed",
	aggregateType: "character",
	aggregateId: "character-1",
	aggregateRevision: revision,
	payload: {
		operationId,
		leg: "source",
		sourceCost: makeSourceCost(),
		resultingSourceCharacterRevision: revision,
	},
});

const makeCombinedEvent = () => ({
	...makeAppliedEvent({kind: "hp.heal", args: {amount: 4}}),
	payload: {
		...makeAppliedEvent({kind: "hp.heal", args: {amount: 4}}).payload,
		leg: "combined",
		sourceCost: makeSourceCost(),
	},
});

const makeFailedEvent = () => ({
	id: "failed-event",
	campaignId: "campaign-1",
	sequence: 20,
	type: "character.operation.failed",
	aggregateType: "semantic_operation",
	aggregateId: "operation-1",
	aggregateRevision: 2,
	payload: {
		operationId: "operation-1",
		status: "failed",
		reason: "unavailable",
		targetDisplaySnapshot: {label: "Mira"},
		effectDisplaySnapshot: {label: "Heal"},
	},
});

const makeSessionStorage = () => {
	const store = new Map();
	return {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
};

const makeDeferred = () => {
	let resolve;
	const promise = new Promise(res => { resolve = res; });
	return {promise, resolve};
};

const makeCharacterDocument = (data, revision = 1) => ({id: "character-1", campaignId: "campaign-1", revision, data});

const makeApi = character => {
	const state = {character: structuredClone(character), patches: []};
	return {
		state,
		pGetSession: jest.fn(async () => ({signedIn: true})),
		pGetCharacter: jest.fn(async () => structuredClone(state.character)),
		pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
		pPatchCharacter: jest.fn(async ({patches}) => {
			state.patches.push(...patches);
			return {character: structuredClone(state.character)};
		}),
		pListEventPage: jest.fn(async () => ({events: [], replay: {scannedThroughSequence: 0, hasMore: false}})),
	};
};

/**
 * Wire the real coordinator, the real HTTP repository and the real sheet handlers together so the assertions
 * exercise the merged PR #222 seam rather than a stand-in.
 */
const pMakeHarness = async ({seed = {}} = {}) => {
	const previousStorage = globalThis.sessionStorage;
	globalThis.sessionStorage = makeSessionStorage();

	const state = new CharacterSheetState();
	// A real class/level so derived max HP is stable across the `loadFromJson` adopt path.
	state.loadFromJson({
		name: "Mira",
		classes: [{name: "Fighter", level: 5}],
		abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
		hp: {current: 30, max: 44, temp: 0},
		conditions: [],
		spellcasting: {spellSlots: {1: {current: 2, max: 2}}},
		...seed,
	});

	// Canonical documents never carry the sheet's transient id field.
	const seedData = structuredClone(state.toJson());
	delete seedData.id;
	const api = makeApi(makeCharacterDocument(seedData));
	const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
	if (previousStorage === undefined) delete globalThis.sessionStorage;
	else globalThis.sessionStorage = previousStorage;

	const clients = [];
	const coordinator = new CharacterSheetRealtimeCoordinator({
		campaignId: "campaign-1",
		isAuthenticated: true,
		repository,
		fnCreateRealtimeClient: () => {
			const client = new FakeRealtimeClient();
			clients.push(client);
			return client;
		},
	});

	const toasts = [];
	const hubEffects = {
		onConnectionState: jest.fn(),
		onRealtimeOperation: jest.fn(),
		onApplied: jest.fn(),
		onApplicationError: jest.fn(),
		onAuthoritativeCoverage: jest.fn(),
	};
	const peerTargeting = {onConnectionState: jest.fn(), onRealtimeOperation: jest.fn()};
	// The sheet modules destructure `JqueryUtil` at load time, so mutate the shared object rather than
	// replacing it (see test/jest/charactersheet/setup.js).
	globalThis.JqueryUtil.doToast = message => toasts.push(message);

	const host = {
		_state: state,
		_characterRepository: repository,
		_hubRealtime: coordinator,
		_hubEffects: hubEffects,
		_peerTargeting: peerTargeting,
		_currentCharacterId: "character-1",
		_characterLoadGeneration: 0,
		_hubRealtimeGeneration: 0,
		_isHubRealtimeListenersBound: false,
		_renderCount: 0,
		_saveIndicator: [],
		_renderCharacter: function () { this._renderCount++; },
		_reconcileClassFeatures: () => ({}),
		_updateSaveIndicator: function (status) { this._saveIndicator.push(status); },
	};
	for (const name of [
		"_initHubRealtimeListeners",
		"_onHubRealtimeCursor",
		"_onHubRealtimeConnectionState",
		"_onHubRealtimeDeliveryError",
		"_onHubSemanticOperation",
		"_getHubLiveCharacterData",
		"_adoptHubLiveCharacterData",
		"_scheduleHubRealtimeResync",
		"_onHubAuthoritativeApproval",
		"_pRunHubRealtimeResync",
	]) host[name] = CharacterSheetPage.prototype[name].bind(host);

	host._initHubRealtimeListeners();
	await repository.pGet({characterId: "character-1"});
	coordinator.attach({characterId: "character-1"});

	return {api, clients, coordinator, host, hubEffects, peerTargeting, repository, state, toasts};
};

const pFlush = () => new Promise(resolve => setImmediate(resolve));

beforeAll(async () => {
	globalThis.window ||= {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
	globalThis.document ||= {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
	CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
});

describe("Live campaign effects on an open Character Sheet", () => {
	it("adopts an authoritative approval response when its socket edge is missed", async () => {
		const {clients, host, hubEffects, state} = await pMakeHarness();
		const operation = makeAppliedEvent({
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		}).payload.operation;

		await expect(host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "approved-event",
			sequence: 20,
			operation,
			resultingCharacterRevision: 2,
		})).resolves.toBe(true);
		expect(state.getHp().current).toBe(34);

		clients[0].emit("event", makeAppliedEvent({
			id: "approved-event",
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		}));
		await pFlush();
		expect(state.getHp().current).toBe(34);
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
		expect(hubEffects.onApplied).toHaveBeenCalledWith(expect.objectContaining({
			operation: expect.objectContaining({operationId: "approved-operation"}),
		}));
	});

	it("adopts the authoritative source leg from HTTP when its socket edge is missed", async () => {
		const {host, state} = await pMakeHarness();

		await expect(host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "source-event",
			leg: "source",
			sequence: 20,
			sourceCost: makeSourceCost(),
			resultingCharacterRevision: 2,
		})).resolves.toBe(true);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
	});

	it("adopts an authoritative combined HTTP leg as one self-target revision", async () => {
		const {host, state} = await pMakeHarness();
		const operation = makeAppliedEvent({
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		}).payload.operation;

		await expect(host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "combined-event",
			leg: "combined",
			sequence: 20,
			operation,
			sourceCost: makeSourceCost(),
			resultingCharacterRevision: 2,
		})).resolves.toBe(true);
		expect(state.getCurrentHp()).toBe(34);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
	});

	it("deduplicates an approval response when its socket edge wins the race", async () => {
		const {clients, host, hubEffects, state} = await pMakeHarness();
		const event = makeAppliedEvent({
			id: "approved-event",
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		});
		clients[0].emit("event", event);
		await pFlush();
		expect(state.getHp().current).toBe(34);

		await expect(host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "approved-event",
			sequence: 20,
			operation: event.payload.operation,
			resultingCharacterRevision: 2,
		})).resolves.toBe(true);
		expect(state.getHp().current).toBe(34);
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
		expect(hubEffects.onAuthoritativeCoverage).toHaveBeenCalledWith({operationId: "approved-operation"});
	});

	it("fences an approval response after the open character changes", async () => {
		const {host, hubEffects, state} = await pMakeHarness();
		const operation = makeAppliedEvent({
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		}).payload.operation;
		host._currentCharacterId = "character-2";
		host._characterLoadGeneration++;

		await expect(host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "approved-event",
			sequence: 20,
			operation,
			resultingCharacterRevision: 2,
		})).resolves.toBe(false);
		expect(state.getHp().current).toBe(30);
		expect(hubEffects.onApplied).not.toHaveBeenCalled();
	});

	it("fences a queued approval response after realtime access is lost", async () => {
		const {host, hubEffects, repository, state} = await pMakeHarness();
		const gate = makeDeferred();
		repository._pMutationQueue = gate.promise;
		const operation = makeAppliedEvent({
			operationId: "approved-operation",
			kind: "hp.heal",
			args: {amount: 4},
		}).payload.operation;

		const pending = host._onHubAuthoritativeApproval({
			actionId: "approved-operation",
			characterId: "character-1",
			eventId: "approved-event",
			sequence: 20,
			operation,
			resultingCharacterRevision: 2,
		});
		host._onHubRealtimeConnectionState({state: "access_lost"});
		gate.resolve();

		await expect(pending).resolves.toBe(false);
		expect(state.getHp().current).toBe(30);
		expect(hubEffects.onApplied).not.toHaveBeenCalled();
	});

	it("applies DM damage to the open sheet without a reload", async () => {
		const {clients, host, hubEffects, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({leg: "target"}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(26);
		expect(host._renderCount).toBeGreaterThan(0);
		expect(hubEffects.onApplied).toHaveBeenCalledWith(expect.objectContaining({
			operation: expect.objectContaining({operationId: "operation-1", kind: "hp.damage"}),
			beforeData: expect.objectContaining({hp: expect.objectContaining({current: 30})}),
			afterData: expect.objectContaining({hp: expect.objectContaining({current: 26})}),
		}));
	});

	it("consumes an accepted peer source cost on the open sheet", async () => {
		const {clients, state} = await pMakeHarness();
		clients[0].emit("event", makeSourceEvent());
		await pFlush();

		expect(state.getSpellSlotsCurrent(1)).toBe(1);
	});

	it("applies a combined self operation exactly once", async () => {
		const {clients, coordinator, state} = await pMakeHarness();
		clients[0].emit("event", makeCombinedEvent());
		await pFlush();
		expect(state.getCurrentHp()).toBe(34);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);

		coordinator.attach({characterId: "character-1"});
		clients[1].emit("event", makeCombinedEvent());
		await pFlush();
		expect(state.getCurrentHp()).toBe(34);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
	});

	it("routes a failed lifecycle without mutating the character", async () => {
		const {clients, peerTargeting, state} = await pMakeHarness();
		const before = state.toJson();
		clients[0].emit("event", makeFailedEvent());
		await pFlush();

		expect(state.toJson()).toEqual(before);
		expect(peerTargeting.onRealtimeOperation).toHaveBeenCalledWith(expect.objectContaining({status: "failed"}));
	});

	it("consumes temporary hit points before current hit points", async () => {
		const {clients, state} = await pMakeHarness({seed: {hp: {current: 30, max: 44, temp: 5}}});
		clients[0].emit("event", makeAppliedEvent({args: {amount: 7}}));
		await pFlush();

		expect(state.getTempHp()).toBe(0);
		expect(state.getCurrentHp()).toBe(28);
	});

	it("applies DM healing up to the stored maximum", async () => {
		const {clients, state} = await pMakeHarness({seed: {hp: {current: 20, max: 44, temp: 0}}});
		clients[0].emit("event", makeAppliedEvent({kind: "hp.heal", args: {amount: 5}}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(25);
	});

	it("adds and removes a condition using the server's identity", async () => {
		const {clients, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({
			kind: "condition.add",
			args: {condition: {name: "Poisoned", source: "XPHB"}},
		}));
		await pFlush();
		expect(state.getConditions()).toEqual([{name: "Poisoned", source: "XPHB"}]);

		clients[0].emit("event", makeAppliedEvent({
			id: "event-2",
			operationId: "operation-2",
			sequence: 21,
			revision: 3,
			kind: "condition.remove",
			args: {condition: {name: "Poisoned", source: "XPHB"}},
		}));
		await pFlush();
		expect(state.getConditions()).toEqual([]);
	});

	it("spends and restores the correct spell-slot level", async () => {
		const {clients, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({kind: "spell_slot.spend", args: {level: 1, amount: 2}}));
		await pFlush();
		expect(state.getSpellSlotsCurrent(1)).toBe(0);

		clients[0].emit("event", makeAppliedEvent({
			id: "event-2",
			operationId: "operation-2",
			sequence: 21,
			revision: 3,
			kind: "spell_slot.restore",
			args: {level: 1, amount: 1},
		}));
		await pFlush();
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
	});

	it("preserves an unsaved local edit and persists both it and the effect", async () => {
		const {api, clients, repository, state} = await pMakeHarness();
		state.setName("Mira the Bold");

		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getName()).toBe("Mira the Bold");
		expect(state.getCurrentHp()).toBe(26);

		api.state.character = makeCharacterDocument(structuredClone(repository._accepted.get("character-1").data), 2);
		const saved = {...state.toJson(), id: "character-1"};
		await repository.pUpsert({character: saved});

		// Only the player's own edit is patched; the effect is already canonical, and neither is
		// lost. The accompanying root `/carry` write is the carry-authority protocol: a
		// document-changing save from a current client must always re-assert its summary, or
		// the server treats the writer as carry-unaware and strips it.
		const substantive = api.state.patches.filter(patch => patch.path !== "/carry");
		expect(substantive).toEqual([{op: "replace", path: "/name", value: "Mira the Bold"}]);
		expect(api.state.patches.some(patch => patch.path === "/carry" && patch.op === "replace")).toBe(true);
	});

	it("applies a duplicated delivery exactly once", async () => {
		const {clients, hubEffects, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent());
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(26);
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
	});

	it("applies an operation replayed after a reconnect exactly once", async () => {
		const {clients, coordinator, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();
		expect(state.getCurrentHp()).toBe(26);

		// A reconnect resets the coordinator's per-attach dedupe, so suppression must come from coverage.
		coordinator.attach({characterId: "character-1"});
		clients[1].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(26);
	});

	it("ignores an operation aimed at a different character", async () => {
		const {clients, hubEffects, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({targetCharacterId: "character-2"}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
		expect(hubEffects.onApplied).not.toHaveBeenCalled();
	});

	it("rejects an operation kind outside the closed catalog and pauses saving", async () => {
		const {clients, hubEffects, repository, state, toasts} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({kind: "hp.adjust", args: {amount: 4}}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
		expect(repository.isSaveBlocked("character-1")).toBe(true);
		expect(toasts.some(toast => toast.type === "danger")).toBe(true);
		expect(hubEffects.onApplied).not.toHaveBeenCalled();
		expect(hubEffects.onApplicationError).toHaveBeenCalledWith({operationId: "operation-1"});
	});

	it("stops applying effects once the campaign subscription is torn down", async () => {
		const {clients, coordinator, state} = await pMakeHarness();
		coordinator.detach();
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
	});

	it("stops applying effects after campaign access is lost", async () => {
		const {clients, state} = await pMakeHarness();
		clients[0].emit("state", {state: "access_lost"});
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
	});

	it("records the authoritative cursor for later history recovery", async () => {
		const {clients, repository} = await pMakeHarness();
		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 42},
			characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1, operationWatermark: 41}],
		});
		await pFlush();

		expect(repository._realtimeCursors.get("character-1")).toMatchObject({lastSequence: 42, operationWatermark: 41});
	});

	it("surfaces a delivery failure without leaking the operation payload", async () => {
		const {clients, host, toasts} = await pMakeHarness();
		host._characterRepository.pEnqueueRealtimeDelivery = () => Promise.reject(new Error("queue failed"));
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		const surfaced = toasts.filter(toast => toast.type === "danger");
		expect(surfaced.length).toBeGreaterThan(0);
		expect(JSON.stringify(surfaced)).not.toContain("amount");
	});

	it("never subscribes a signed-out local character sheet", () => {
		const repository = new LocalCharacterRepository({storage: {pGet: async () => null, pSet: async () => {}}});
		const coordinator = new CharacterSheetRealtimeCoordinator({
			campaignId: "campaign-1",
			isAuthenticated: true,
			repository,
			fnCreateRealtimeClient: () => { throw new Error("must not create a realtime client"); },
		});

		expect(typeof repository.pEnqueueRealtimeDelivery).not.toBe("function");
		expect(coordinator.attach({characterId: "character-1"})).toBe(false);
	});

	it("keeps Thelemar homebrew settings intact while applying a condition", async () => {
		const {clients, state} = await pMakeHarness({seed: {settings: {enableTgtt: true, exhaustionRules: "thelemar"}}});
		clients[0].emit("event", makeAppliedEvent({
			kind: "condition.add",
			args: {condition: {name: "Poisoned", source: "XPHB"}},
		}));
		await pFlush();

		expect(state.getSettings()).toEqual(expect.objectContaining({enableTgtt: true, exhaustionRules: "thelemar"}));
		// The server's canonical identity is kept verbatim rather than remapped to a Thelemar variant.
		expect(state.getConditions()).toEqual([{name: "Poisoned", source: "XPHB"}]);
	});
});

describe("Applicable maximum through live reconciliation", () => {
	it("does not put the applicable maximum into the follow-up save when no max input changed", async () => {
		const {api, clients, repository, state} = await pMakeHarness();
		const effectiveMaxBefore = state.toJson().hp.effectiveMax;

		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		// Both R and F carry the same materialised maximum, so it is not a change to persist.
		expect(state.toJson().hp.effectiveMax).toBe(effectiveMaxBefore);
		expect(repository._accepted.get("character-1").data.hp.effectiveMax).toBe(effectiveMaxBefore);

		api.state.character = makeCharacterDocument(structuredClone(repository._accepted.get("character-1").data), 2);
		await repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		expect(api.state.patches.filter(patch => patch.path === "/hp/effectiveMax")).toEqual([]);
	});

	it("persists a genuine max-input change exactly once across interleaved damage and healing", async () => {
		const {api, clients, repository, state} = await pMakeHarness();
		const before = state.toJson().hp.effectiveMax;

		// A durable max-affecting input: constitution feeds `_calculateMaxHp()`, so once the cached maximum
		// is recalculated the new value survives the `loadFromJson` adoption path — unlike an explicit
		// `setMaxHp()` override, which adoption recomputes away.
		state.setAbilityBase("con", 18);
		state.recalculateHp();
		const after = state.toJson().hp.effectiveMax;
		expect(after).toBeGreaterThan(before);

		clients[0].emit("event", makeAppliedEvent({args: {amount: 4}}));
		await pFlush();
		clients[0].emit("event", makeAppliedEvent({
			id: "event-2",
			operationId: "operation-2",
			sequence: 21,
			revision: 3,
			kind: "hp.heal",
			args: {amount: 2},
		}));
		await pFlush();

		// The rematerialised maximum survives both operations and is never double counted.
		expect(state.toJson().hp.effectiveMax).toBe(after);

		api.state.character = makeCharacterDocument(structuredClone(repository._accepted.get("character-1").data), 3);
		await repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		const maxPatches = api.state.patches.filter(patch => patch.path === "/hp/effectiveMax");
		expect(maxPatches).toEqual([{op: "replace", path: "/hp/effectiveMax", value: after}]);
	});

	it("keeps a strained character's current hit points above the transient effective maximum", async () => {
		// Psionic body strain halves the applicable maximum without touching the current total, so a document
		// whose current HP legitimately exceeds it must survive adoption, reconciliation and saving unchanged.
		const {api, clients, repository, state} = await pMakeHarness({
			seed: {
				classes: [{name: "Talent", level: 10, subclass: null}],
				psionicStrain: {body: 7, mind: 0, soul: 0},
				hp: {current: 60, max: 80, temp: 0},
			},
		});
		const effectiveMax = state.toJson().hp.effectiveMax;
		expect(effectiveMax).toBeLessThan(state.getCurrentHp());

		// Healing must not be able to pull the total down to the halved maximum.
		clients[0].emit("event", makeAppliedEvent({kind: "hp.heal", args: {amount: 5}}));
		await pFlush();
		expect(state.getCurrentHp()).toBe(60);

		// Repeated adoption must be idempotent, not erosive.
		for (let i = 0; i < 3; ++i) {
			CharacterSheetPage.prototype._adoptHubLiveCharacterData.call(
				{_state: state, _currentCharacterId: "character-1", _reconcileClassFeatures: () => ({})},
				state.toJson(),
			);
		}
		expect(state.getCurrentHp()).toBe(60);

		api.state.character = makeCharacterDocument(structuredClone(repository._accepted.get("character-1").data), 2);
		await repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		expect(api.state.patches.filter(patch => patch.path === "/hp/current")).toEqual([]);
		expect(state.getCurrentHp()).toBe(60);
	});
});
