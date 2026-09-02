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
} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: "character.operation.applied",
	aggregateType: "character",
	aggregateId: targetCharacterId,
	aggregateRevision: revision,
	payload: {
		operation: {operationId, kind, version: 1, targetCharacterId, arguments: args},
		resultingCharacterRevision: revision,
	},
});

const makeSessionStorage = () => {
	const store = new Map();
	return {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
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
	// The sheet modules destructure `JqueryUtil` at load time, so mutate the shared object rather than
	// replacing it (see test/jest/charactersheet/setup.js).
	globalThis.JqueryUtil.doToast = message => toasts.push(message);

	const host = {
		_state: state,
		_characterRepository: repository,
		_hubRealtime: coordinator,
		_currentCharacterId: "character-1",
		_characterLoadGeneration: 0,
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
		"_pRunHubRealtimeResync",
	]) host[name] = CharacterSheetPage.prototype[name].bind(host);

	host._initHubRealtimeListeners();
	await repository.pGet({characterId: "character-1"});
	coordinator.attach({characterId: "character-1"});

	return {api, clients, coordinator, host, repository, state, toasts};
};

const pFlush = () => new Promise(resolve => setImmediate(resolve));

beforeAll(async () => {
	globalThis.window ||= {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
	globalThis.document ||= {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
	CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
});

describe("Live campaign effects on an open Character Sheet", () => {
	it("applies DM damage to the open sheet without a reload", async () => {
		const {clients, host, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(26);
		expect(host._renderCount).toBeGreaterThan(0);
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

		// Only the player's own edit is patched; the effect is already canonical, and neither is lost.
		expect(api.state.patches).toEqual([{op: "replace", path: "/name", value: "Mira the Bold"}]);
	});

	it("applies a duplicated delivery exactly once", async () => {
		const {clients, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent());
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(state.getCurrentHp()).toBe(26);
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
		const {clients, state} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({targetCharacterId: "character-2"}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
	});

	it("rejects an operation kind outside the closed catalog and pauses saving", async () => {
		const {clients, repository, state, toasts} = await pMakeHarness();
		clients[0].emit("event", makeAppliedEvent({kind: "hp.adjust", args: {amount: 4}}));
		await pFlush();

		expect(state.getCurrentHp()).toBe(30);
		expect(repository.isSaveBlocked("character-1")).toBe(true);
		expect(toasts.some(toast => toast.type === "danger")).toBe(true);
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
