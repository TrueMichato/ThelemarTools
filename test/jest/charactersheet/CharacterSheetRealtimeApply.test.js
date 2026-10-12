import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import {CharacterSheetRealtimeCoordinator} from "../../../js/charactersheet/charactersheet-realtime.js";
import {CharacterSheetHubEffects} from "../../../js/charactersheet/charactersheet-hub-effects.js";
import {CharacterSheetPeerTargeting} from "../../../js/charactersheet/charactersheet-peer-targeting.js";
import {getMultiTargetOperationsCapability} from "../../../js/hub/hub-multi-target-operations.js";
import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";
import {LocalCharacterRepository} from "../../../js/hub/hub-character-repository.js";
import {applyJsonPatch} from "../../../js/hub/hub-json-patch.js";

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
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return {promise, resolve, reject};
};

const makeCharacterDocument = (data, revision = 1) => ({id: "character-1", campaignId: "campaign-1", revision, data});

const makeApi = character => {
	const state = {character: structuredClone(character), patches: [], isOffline: false};
	return {
		state,
		pGetSession: jest.fn(async () => ({signedIn: true, account: {id: "account-1"}})),
		pGetCharacter: jest.fn(async () => structuredClone(state.character)),
		pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
		pPatchCharacter: jest.fn(async ({patches}) => {
			if (state.isOffline) throw Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"});
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
const pMakeHarness = async ({seed = {}, access = "owner"} = {}) => {
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
	if (access === "dm_readonly") {
		api.pGetCharacterProjection = jest.fn(async () => ({
			kind: "dm_truth",
			character: structuredClone(api.state.character),
		}));
	}
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
		suspend: jest.fn(),
		onConnectionState: jest.fn(),
		onRealtimeOperation: jest.fn(),
		onApplied: jest.fn(),
		onApplicationError: jest.fn(),
		onAuthoritativeCoverage: jest.fn(),
	};
	const peerTargeting = {suspend: jest.fn(), onConnectionState: jest.fn(), onRealtimeOperation: jest.fn()};
	// The sheet modules destructure `JqueryUtil` at load time, so mutate the shared object rather than
	// replacing it (see test/jest/charactersheet/setup.js).
	globalThis.JqueryUtil.doToast = message => toasts.push(message);

	const host = {
		_state: state,
		_characterRepository: repository,
		_hubRealtime: coordinator,
		_hubEffects: hubEffects,
		_peerTargeting: peerTargeting,
		_hubCampaignId: "campaign-1",
		_hubContext: {membership: {role: "player"}},
		_hubActiveCampaign: {pHandleAccessLoss: jest.fn(async () => {})},
		_teardownHubRules: jest.fn(),
		_currentCharacterId: "character-1",
		_currentCharacterAccess: access,
		_characterLoadGeneration: 0,
		_hubReadOnlyRefreshGeneration: 0,
		_hubReadOnlyRefreshRequest: null,
		_hubReadOnlyRefreshPromise: null,
		_isHubReadOnlyRefreshRequired: false,
		_hubRealtimeGeneration: 0,
		_isHubRealtimeListenersBound: false,
		_renderCount: 0,
		_saveIndicator: [],
		_lastSavedAt: 0,
		_renderCharacter: function () { this._renderCount++; },
		_reconcileClassFeatures: () => ({}),
		_updateSaveIndicator: function (status) { this._saveIndicator.push(status); },
	};
	host._hubActiveCampaign.pHandleAccessLoss.mockImplementation(async () => { host._characterLoadGeneration++; });
	for (const name of [
		"_initHubRealtimeListeners",
		"_onHubRealtimeCursor",
		"_onHubRealtimeConnectionState",
		"_onHubRealtimeDeliveryError",
		"_onHubRecipientNotice",
		"_pRefreshHubReadOnlyCharacter",
		"_pStartHubReadOnlyRefresh",
		"_pDrainHubReadOnlyRefresh",
		"_pRunHubReadOnlyRefresh",
		"_onHubSemanticOperation",
		"_isHubOperationAuthorityReady",
		"_getHubLiveCharacterData",
		"_adoptHubLiveCharacterData",
		"_scheduleHubRealtimeResync",
		"_onHubAuthoritativeApproval",
		"_pRunHubRealtimeResync",
		"_onHubProjectionInvalidated",
		"_scheduleHubAuthoritativeReconcile",
		"_isHubAuthoritativeReconcileScopeCurrent",
		"_pDrainHubAuthoritativeReconcile",
		"_pRunHubAuthoritativeReconcile",
		"_pResolveHubCharacterConflict",
		"_adoptCanonicalCharacterIdentity",
		"_pRefreshCanonicalCharacterRoster",
		"_getNextSavedAt",
		"_saveCurrentCharacter",
	]) {
		if (typeof CharacterSheetPage.prototype[name] === "function") host[name] = CharacterSheetPage.prototype[name].bind(host);
	}

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

const makeMultiEvent = ({revision = 3, sequence = 20, legId = "review-leg"} = {}) => {
	const event = makeAppliedEvent({id: `event-${legId}`, operationId: "review-operation", revision, sequence, kind: "hp.heal", args: {amount: 4}});
	event.type = "character.multi_operation.target_applied";
	Object.assign(event.payload, {operationId: "review-operation", leg: "target", legId, changed: true});
	return event;
};
const makeAuthorityEvent = type => ({
	id: `authority-${type}`,
	campaignId: "campaign-1",
	sequence: 30,
	type,
	aggregateType: type === "rules.activated" ? "rules_version" : type === "campaign.archived" ? "campaign" : "character",
	aggregateId: type === "rules.activated" ? "rules-2" : type === "campaign.archived" ? "campaign-1" : "character-1",
	aggregateRevision: null,
	payload: {},
});
const pMakeAuthorityHarness = async () => {
	globalThis.window.removeEventListener ||= jest.fn();
	globalThis.document.removeEventListener ||= jest.fn();
	const harness = await pMakeHarness({seed: {hp: {current: 5, max: 44, temp: 0}}});
	const {host, api, state} = harness;
	const contextGate = makeDeferred();
	const context = {
		membership: {role: "player"},
		capabilities: {multiTargetOperations: getMultiTargetOperationsCapability({enabled: true})},
		rulesVersion: {id: "rules-2", version: 2, schemaVersion: 1, catalogVersion: 1, rules: createDefaultCampaignRulesPolicy()},
	};
	Object.assign(host, {
		_isHubCharacter: true,
		_hubContextGeneration: 0,
		_hubRulesRefreshGeneration: 0,
		_hubRoleRosterGeneration: 0,
		_hubContext: context,
		_hubCampaignContext: {context, pRefresh: jest.fn(() => contextGate.promise)},
		_concealHubPrivateCharacter: jest.fn(() => { host._currentCharacterId = null; state.reset(); }),
		isCurrentCharacterReadOnly: () => false,
		_hubApi: api,
	});
	for (const method of ["_pRefreshHubRules", "_clearHubRules", "_applyHubContext", "_fenceHubGeneration", "_detachHubRealtimeClient", "_detachHubProjections", "_endCurrentHubCharacterAccess", "_teardownHubRules"]) {
		host[method] = CharacterSheetPage.prototype[method].bind(host);
	}
	Object.assign(api, {
		pListCharacterPendingActions: jest.fn(async () => []),
		pListMultiTargetInbox: jest.fn(async () => ({invitations: [], nextCursor: null})),
		pListCampaignCharacterProjections: jest.fn(async () => ({projections: [], roster: []})),
		pListCharacterOutgoingActions: jest.fn(async () => []),
		pListMultiTargetOutgoing: jest.fn(async () => ({operations: [], nextCursor: null})),
	});
	host._hubEffects = new CharacterSheetHubEffects({
		campaignId: "campaign-1",
		api,
		root: globalThis.e_({tag: "div"}),
		fnGetCharacterId: () => host._currentCharacterId,
		fnIsOwner: () => host._currentCharacterId === "character-1",
		fnGetMultiTargetCapability: () => context.capabilities.multiTargetOperations,
		fnGetAuthorityVersion: () => host._hubContextGeneration,
		fnOnAuthoritativeApproval: result => host._onHubAuthoritativeApproval(result),
		fnSetTimeout: jest.fn(),
		fnClearTimeout: jest.fn(),
	});
	host._peerTargeting = new CharacterSheetPeerTargeting({
		campaignId: "campaign-1",
		api,
		root: globalThis.e_({tag: "div"}),
		fnGetCharacterId: () => host._currentCharacterId,
		fnIsOwner: () => host._currentCharacterId === "character-1",
		fnGetRulesVersionId: () => null,
		fnGetCapability: () => null,
		fnGetMultiTargetCapability: () => context.capabilities.multiTargetOperations,
		fnGetAuthorityVersion: () => host._hubContextGeneration,
	});
	host._hubEffects.init();
	host._peerTargeting.init();
	host._hubEffects.activate({characterId: "character-1"});
	host._peerTargeting.activate({characterId: "character-1", membershipRole: "player"});
	await pFlush();
	const adopted = jest.spyOn(host, "_adoptHubLiveCharacterData");
	const notice = jest.spyOn(host._hubEffects, "_addNotice");
	const focus = jest.spyOn(host._hubEffects, "_focusMultiInvitation");
	const deliverHttp = event => host._onHubAuthoritativeApproval({
		actionId: event.payload.operationId,
		characterId: "character-1",
		eventId: event.id,
		sequence: event.sequence,
		operation: event.payload.operation,
		leg: "target",
		legId: event.payload.legId,
		resultingCharacterRevision: event.aggregateRevision,
		changed: event.payload.changed,
	});
	return {...harness, contextGate, context, adopted, notice, focus, deliverHttp, effects: host._hubEffects, targeting: host._peerTargeting};
};
const pBlockSave = async ({host, api, repository, state}) => {
	const started = makeDeferred();
	const release = makeDeferred();
	api.pPatchCharacter.mockImplementationOnce(async input => {
		started.resolve();
		await release.promise;
		const saved = makeCharacterDocument(applyJsonPatch(api.state.character.data, input.patches), 2);
		api.state.character = makeCharacterDocument({...saved.data, hp: {...saved.data.hp, current: 9}}, 3);
		return {character: saved};
	});
	state.setName("Save A");
	const save = repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
	await started.promise;
	host._renderCount = 0;
	return {release, save};
};

describe("A4 interrupted canonical demand recovery on real authority arrival", () => {
	it("automatically replaces a rules-fenced canonical read after authorized context resumes, without a new demand", async () => {
		const h = await pMakeAuthorityHarness();
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		expect(h.toasts).toEqual([]);
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.notice).not.toHaveBeenCalled();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("coalesces newer projection demands received during an interrupted read without overwriting them", async () => {
		const h = await pMakeAuthorityHarness();
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		const original = h.host._hubAuthoritativeReconcileRequest;
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		const newer = h.host._hubAuthoritativeReconcileRequest;
		expect(newer).not.toBe(original);
		expect(newer.authorityGeneration).toBe(h.coordinator.getAuthorityGeneration());
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		expect(h.host._hubAuthoritativeReconcileRequest).toBe(newer);
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.adopted).not.toHaveBeenCalled();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("repeats rules and projection interruptions with fresh automatic catch-up and no authority-unavailable spin", async () => {
		const h = await pMakeAuthorityHarness();
		h.api.pGetCharacter.mockClear();
		for (const [i, type] of ["rules.activated", "character.projection.invalidated"].entries()) {
			const started = makeDeferred();
			const read = makeDeferred();
			const context = makeDeferred();
			const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9 + i * 4, max: 44, temp: 0}}, 2 + i);
			h.api.state.character = truth;
			h.host._hubCampaignContext.pRefresh.mockImplementation(() => context.promise);
			h.api.pGetCharacter.mockImplementationOnce(async () => {
				started.resolve();
				return read.promise;
			});
			h.host._onHubProjectionInvalidated({characterId: "character-1"});
			await started.promise;
			h.clients[0].emit("event", {...makeAuthorityEvent(type), id: `cycle-${i}`, sequence: 30 + i});
			read.resolve(truth);
			await h.host._hubAuthoritativeReconcilePromise;
			await pFlush();
			await pFlush();
			expect(h.api.pGetCharacter).toHaveBeenCalledTimes(i * 2 + 1);
			expect(h.adopted).toHaveBeenCalledTimes(i);
			expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
			context.resolve(h.context);
			await pFlush();
			await pFlush();
			expect(h.api.pGetCharacter).toHaveBeenCalledTimes(i * 2 + 2);
			expect(h.adopted).toHaveBeenCalledTimes(i + 1);
			expect(h.state.toJson().hp.current).toBe(9 + i * 4);
			expect(h.repository._accepted.get("character-1").revision).toBe(2 + i);
			expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
			expect(h.notice).not.toHaveBeenCalled();
			expect(h.toasts).toEqual([]);
		}
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("keeps one demand through a second invalidation of its automatic replacement read", async () => {
		const h = await pMakeAuthorityHarness();
		const firstStarted = makeDeferred();
		const secondStarted = makeDeferred();
		const firstRead = makeDeferred();
		const secondRead = makeDeferred();
		const secondContext = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter
			.mockImplementationOnce(async () => { firstStarted.resolve(); return firstRead.promise; })
			.mockImplementationOnce(async () => { secondStarted.resolve(); return secondRead.promise; });
		h.host._hubCampaignContext.pRefresh
			.mockImplementationOnce(() => h.contextGate.promise)
			.mockImplementationOnce(() => secondContext.promise);
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await firstStarted.promise;
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		firstRead.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		h.contextGate.resolve(h.context);
		await secondStarted.promise;
		h.clients[0].emit("event", {...makeAuthorityEvent("rules.activated"), id: "second-rules", sequence: 31});
		secondRead.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		secondContext.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(3);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.notice).not.toHaveBeenCalled();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("refreshes attempt tokens after reconnect without dropping recoverable same-scope demand", async () => {
		const h = await pMakeAuthorityHarness();
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("state", {state: "reconnecting"});
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		h.clients[0].emit("state", {state: "live"});
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["durable", "adopt"])("retains canonical demand and rolls back both command tracks when real rules arrive during %s", async phase => {
		const h = await pMakeAuthorityHarness();
		h.api.pPatchCharacter.mockRejectedValue(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}));
		for (const name of ["edit A", "edit B"]) {
			h.state.setName(name);
			await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		const commandsBefore = JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"));
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		const target = phase === "durable" ? h.repository : h.host;
		const method = phase === "durable" ? "_stageRecoveryCommandQueue" : "_reconcileClassFeatures";
		const original = target[method].bind(target);
		const boundary = jest.spyOn(target, method).mockImplementationOnce(input => {
			const result = original(input);
			h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
			return result;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.state.toJson().name).toBe("edit B");
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"))).toBe(commandsBefore);
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		expect(h.host._renderCount).toBe(0);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		if (phase === "durable") expect(h.adopted).not.toHaveBeenCalled();
		boundary.mockRestore();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.state.toJson().name).toBe("edit B");
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		const recovered = h.repository._recoveryCommandQueues.get("character-1");
		expect(recovered).toHaveLength(3);
		expect(recovered.slice(0, 2).map(command => command.commandKeys)).toEqual(JSON.parse(commandsBefore).map(command => command.commandKeys));
		expect(recovered.map(command => [command.submittedBase.hp.current, command.submittedSnapshot.hp.current])).toEqual([[9, 9], [9, 9], [9, 9]]);
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(3);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["archive", "access-loss", "account", "signout", "campaign", "access-mode", "repository", "teardown"])("does not revive an interrupted canonical demand after %s ends its captured scope", async loss => {
		const h = await pMakeAuthorityHarness();
		h.host._hubActiveCampaign.accountId = "account-1";
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent(loss === "archive" ? "campaign.archived" : "rules.activated"));
		if (loss === "access-loss") h.clients[0].emit("state", {state: "access_lost"});
		if (loss === "account") h.host._hubActiveCampaign.accountId = "replacement-account";
		if (loss === "signout") h.host._hubActiveCampaign.accountId = null;
		if (loss === "campaign") h.host._hubCampaignId = "replacement-campaign";
		if (loss === "access-mode") h.host._currentCharacterAccess = "dm_readonly";
		if (loss === "repository") h.host._characterRepository = {accessKind: "hub"};
		if (loss === "teardown") h.host._endCurrentHubCharacterAccess({characterId: "character-1"});
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		if (["archive", "teardown"].includes(loss)) expect(h.host._currentCharacterId).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("does not revive a held read across a real character load, even when that character is selected again", async () => {
		const h = await pMakeAuthorityHarness();
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		const previousLocation = window.location;
		const previousHistory = window.history;
		window.location = new URL("http://test/charactersheet.html?hubCampaign=campaign-1");
		window.history = {replaceState: jest.fn()};
		Object.assign(h.host, {
			_pLoadCharacter: CharacterSheetPage.prototype._pLoadCharacter.bind(h.host),
			_detachHubRealtime: CharacterSheetPage.prototype._detachHubRealtime.bind(h.host),
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter.bind(h.host),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: ({characterId}) => h.coordinator.attach({characterId}),
		});
		try {
			h.api.pGetCharacter.mockImplementationOnce(async () => ({...h.api.state.character, id: "character-2"}));
			await h.host._pLoadCharacter("character-2");
			expect(h.host._currentCharacterId).toBe("character-2");
			await h.host._pLoadCharacter("character-1");
			expect(h.host._currentCharacterId).toBe("character-1");
			const readsBeforeRelease = h.api.pGetCharacter.mock.calls.length;
			read.resolve(truth);
			await h.host._hubAuthoritativeReconcilePromise;
			h.contextGate.resolve(h.context);
			await pFlush();
			await pFlush();
			expect(h.api.pGetCharacter).toHaveBeenCalledTimes(readsBeforeRelease);
			expect(h.adopted).not.toHaveBeenCalled();
			expect(h.state.toJson().hp.current).toBe(5);
			expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
			expect(h.notice).not.toHaveBeenCalled();
		} finally {
			window.location = previousLocation;
			window.history = previousHistory;
			h.effects.destroy();
			h.targeting.destroy();
		}
	});

	it("retains an authority-fenced demand across persisted pagehide/pageshow without treating BFCache as teardown", async () => {
		const h = await pMakeAuthorityHarness();
		const listeners = new Map();
		const originalAdd = window.addEventListener;
		window.addEventListener = (name, listener) => listeners.set(name, listener);
		try {
			CharacterSheetPage.prototype._initHubRealtimeTeardown.call(h.host);
		} finally {
			window.addEventListener = originalAdd;
		}
		Object.assign(h.host._hubActiveCampaign, {
			activeCampaignId: "campaign-1",
			suspend: jest.fn(),
			pResume: jest.fn(async () => {}),
		});
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		listeners.get("pagehide")({persisted: true});
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		listeners.get("pageshow")({persisted: true});
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.host._hubActiveCampaign.pResume).toHaveBeenCalledTimes(1);
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});
});

describe("A4 reconnect authorized-context barrier on real consumers", () => {
	const pMakeReconnectHarness = async () => {
		const h = await pMakeAuthorityHarness();
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		h.host._handleTerminalCharacterCampaignAccessError = CharacterSheetPage.prototype._handleTerminalCharacterCampaignAccessError.bind(h.host);
		return h;
	};
	const expectPendingAuthority = (h, revision = 1) => {
		expect(h.host._hubContext).toBeNull();
		expect(h.host._isHubContextRefreshing).toBe(true);
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.repository._accepted.get("character-1").revision).toBe(revision);
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.host._renderCount).toBe(0);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/review-leg")).toBe(false);
		expect(h.repository._coverage.get("character-1")?.live.revision).not.toBe(revision + 1);
		expect(h.repository._realtimeCursors.get("character-1")?.operationWatermark).not.toBe(20);
	};

	it.each(["live-before-read-finishes", "read-finishes-before-live"])("requires installed authorized context for canonical retry when %s", async order => {
		const h = await pMakeReconnectHarness();
		const started = makeDeferred();
		const read = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("state", {state: "reconnecting"});
		if (order === "live-before-read-finishes") h.clients[0].emit("state", {state: "live"});
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		await pFlush();
		if (order === "read-finishes-before-live") h.clients[0].emit("state", {state: "live"});
		await pFlush();
		expectPendingAuthority(h);
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		expect(h.toasts).toEqual([]);
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["http", "websocket", "resync"])("fences fresh-generation %s delivery until reconnect context is installed", async kind => {
		const h = await pMakeReconnectHarness();
		const {release, save} = await pBlockSave(h);
		const event = makeMultiEvent();
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 20, hasMore: false}});
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		let delivered;
		if (kind === "http") delivered = h.deliverHttp(event);
		else if (kind === "websocket") h.clients[0].emit("event", event);
		else {
			h.repository._queuePendingResync({canonicalId: "character-1",
				envelope: {
					eventId: event.id, sequence: event.sequence, ...event.payload,
				}});
			delivered = h.host._pRunHubRealtimeResync({characterId: "character-1"});
		}
		release.resolve();
		await save;
		if (delivered) expect(await delivered).toBe(false);
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 3);
		await pFlush();
		expectPendingAuthority(h, 2);
		expect(h.repository.hasPendingResync("character-1")).toBe(true);
		expect(h.toasts).toEqual([]);
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(3);
		expect(h.notice).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("retains in-flight semantic recovery through reconnect until authorized context is installed", async () => {
		const h = await pMakeReconnectHarness();
		const event = makeMultiEvent({revision: 2});
		const read = makeDeferred();
		const started = makeDeferred();
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 20, hasMore: false}});
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: event.id, sequence: event.sequence, ...event.payload,
			}});
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			await read.promise;
			return h.api.state.character;
		});
		const pending = h.host._pRunHubRealtimeResync({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		read.resolve();
		expect(await pending).toBe(false);
		await pFlush();
		expectPendingAuthority(h);
		expect(h.repository.hasPendingResync("character-1")).toBe(true);
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		expect(h.notice).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("coalesces newer demand across repeated reconnects and ignores the older late context", async () => {
		const h = await pMakeReconnectHarness();
		const read = makeDeferred();
		const started = makeDeferred();
		const latestContext = makeDeferred();
		const truth = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.state.character = truth;
		h.api.pGetCharacter.mockClear();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._hubCampaignContext.pRefresh
			.mockImplementationOnce(() => h.contextGate.promise)
			.mockImplementationOnce(() => latestContext.promise);
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		await started.promise;
		for (let i = 0; i < 2; ++i) {
			h.clients[0].emit("state", {state: "reconnecting"});
			h.clients[0].emit("state", {state: "live"});
			h.host._onHubProjectionInvalidated({characterId: "character-1"});
		}
		const newer = h.host._hubAuthoritativeReconcileRequest;
		read.resolve(truth);
		await h.host._hubAuthoritativeReconcilePromise;
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expectPendingAuthority(h);
		expect(h.host._hubAuthoritativeReconcileRequest === newer).toBe(true);
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.effects._isCapabilityRevoked).toBe(true);
		expect(h.targeting._isSuspended).toBe(true);
		latestContext.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(2);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("retains canonical demand without retrying when authorized context fails, then resumes after a successful reconnect", async () => {
		const h = await pMakeReconnectHarness();
		const nextContext = makeDeferred();
		h.host._hubCampaignContext.pRefresh
			.mockImplementationOnce(() => h.contextGate.promise)
			.mockImplementationOnce(() => nextContext.promise);
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.pGetCharacter.mockClear();
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		h.contextGate.reject(new Error("context offline"));
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).not.toHaveBeenCalled();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.host._isHubContextUnavailable).toBe(true);
		expect(h.host._hubAuthoritativeReconcileRequest).not.toBeNull();
		expect(h.toasts).toHaveLength(1);
		expect(h.toasts[0].type).toBe("danger");
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		await pFlush();
		expectPendingAuthority(h);
		expect(h.api.pGetCharacter).not.toHaveBeenCalled();
		nextContext.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.api.pGetCharacter).toHaveBeenCalledTimes(1);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.toasts).toHaveLength(1);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("conceals terminal context failure instead of retrying unfinished canonical demand", async () => {
		const h = await pMakeReconnectHarness();
		h.api.pGetCharacter.mockClear();
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		h.contextGate.reject(Object.assign(new Error("forbidden"), {code: "FORBIDDEN", status: 403}));
		await pFlush();
		await pFlush();
		expect(h.host._concealHubPrivateCharacter).toHaveBeenCalledTimes(1);
		expect(h.host._currentCharacterId).toBeNull();
		expect(h.host._hubContext).toBeNull();
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.api.pGetCharacter).not.toHaveBeenCalled();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["archive", "access-loss"])("does not install late reconnect context after %s", async ending => {
		const h = await pMakeReconnectHarness();
		h.api.pGetCharacter.mockClear();
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		h.host._onHubProjectionInvalidated({characterId: "character-1"});
		if (ending === "archive") h.clients[0].emit("event", makeAuthorityEvent("campaign.archived"));
		else h.clients[0].emit("state", {state: "access_lost"});
		await pFlush();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.host._hubContext).toBeNull();
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.api.pGetCharacter).not.toHaveBeenCalled();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		if (ending === "archive") expect(h.host._currentCharacterId).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each([["canonical", "durable"], ["canonical", "adopt"], ["resync", "durable"], ["resync", "journal"], ["resync", "adopt"]])("rolls back %s at %s when reconnect starts a pending context refresh", async (kind, phase) => {
		const h = await pMakeReconnectHarness();
		h.api.pPatchCharacter.mockRejectedValue(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}));
		for (const name of ["edit A", "edit B"]) {
			h.state.setName(name);
			await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		const before = JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"));
		const journalKey = h.repository._getRevisionlessCoverageKey("character-1");
		const event = makeMultiEvent({revision: 2});
		const noop = makeMultiEvent({revision: null, sequence: 21, legId: "noop"});
		noop.payload.changed = false;
		noop.payload.resultingCharacterRevision = null;
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.pListEventPage.mockResolvedValue({events: [event, noop], replay: {scannedThroughSequence: 21, hasMore: false}});
		if (kind === "resync") {
			h.repository._queuePendingResync({canonicalId: "character-1",
				envelope: {
					eventId: event.id, sequence: event.sequence, ...event.payload,
				}});
		}
		const target = phase === "adopt" ? h.host : h.repository;
		const method = phase === "adopt" ? "_reconcileClassFeatures" : phase === "journal" ? "_stageRevisionlessCoverage" : "_stageRecoveryCommandQueue";
		const original = target[method].bind(target);
		const boundary = jest.spyOn(target, method).mockImplementationOnce(input => {
			const result = original(input);
			h.clients[0].emit("state", {state: "reconnecting"});
			h.clients[0].emit("state", {state: "live"});
			return result;
		});
		if (kind === "canonical") h.host._onHubProjectionInvalidated({characterId: "character-1"});
		else await h.host._pRunHubRealtimeResync({characterId: "character-1"});
		await pFlush();
		await pFlush();
		expect(h.host._hubContext).toBeNull();
		expect(h.host._isHubContextRefreshing).toBe(true);
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.state.toJson().name).toBe("edit B");
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"))).toBe(before);
		expect(h.repository._recoveryStorage.getItem(journalKey)).toBeNull();
		expect(h.host._renderCount).toBe(0);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		if (phase !== "adopt") expect(h.adopted).not.toHaveBeenCalled();
		boundary.mockRestore();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.state.toJson().name).toBe("edit B");
		expect(h.repository._accepted.get("character-1").revision).toBe(2);
		const commands = h.repository._recoveryCommandQueues.get("character-1");
		expect(commands.slice(0, 2).map(command => command.commandKeys)).toEqual(JSON.parse(before).map(command => command.commandKeys));
		expect(commands.every(command => command.submittedBase.hp.current === 9 && command.submittedSnapshot.hp.current === 9)).toBe(true);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		h.effects.destroy();
		h.targeting.destroy();
	});
});

describe("A4 late fenced-evidence recovery handoff", () => {
	it("hands off a stale queued receipt after the save settles and context installation has no canonical demand", async () => {
		const h = await pMakeAuthorityHarness();
		h.host._hubAuthoritativeReconcileRequest = null;
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		const {release, save} = await pBlockSave(h);
		const deliveryStarted = makeDeferred();
		const deliveryRelease = makeDeferred();
		const priorDelivery = h.repository.pEnqueueRealtimeDelivery({
			characterId: "character-1",
			fnDeliver: async () => { deliveryStarted.resolve(); await deliveryRelease.promise; },
		});
		const event = makeMultiEvent();
		const http = h.deliverHttp(event);
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		release.resolve();
		await save;
		await deliveryStarted.promise;
		h.api.state.character.operationWatermark = 20;
		expect(h.repository.getPendingRecovery("character-1")).toBeNull();
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		h.api.pListEventPage.mockClear();
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 20, hasMore: false}});
		h.contextGate.resolve(h.context);
		await pFlush();
		expect(h.host._isHubOperationAuthorityReady()).toBe(true);
		expect(h.host._hubAuthoritativeReconcileRequest).toBeNull();
		deliveryRelease.resolve();
		await priorDelivery;
		expect(await http).toBe(false);
		await pFlush();
		await pFlush();
		expect(h.api.pListEventPage).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.repository.isSaveBlocked("character-1")).toBe(false);
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.notice).toHaveBeenCalledTimes(1);
		h.api.pPatchCharacter.mockImplementationOnce(async input => {
			h.api.state.character = {...makeCharacterDocument(applyJsonPatch(h.api.state.character.data, input.patches), 4), operationWatermark: 20};
			return {character: h.api.state.character};
		});
		h.state.setName("Save B after late evidence");
		await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).resolves.toMatchObject({hp: {current: 9}});
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(2);
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["context-before-delivery", "context-after-delivery"])("automatically clears semantic save blocks and permits a future save with %s", async order => {
		const h = await pMakeAuthorityHarness();
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		const started = makeDeferred();
		const release = makeDeferred();
		const event = makeMultiEvent();
		h.api.pPatchCharacter.mockImplementationOnce(async input => {
			started.resolve();
			await release.promise;
			const saved = {...makeCharacterDocument(applyJsonPatch(h.api.state.character.data, input.patches), 2), operationWatermark: 0};
			h.api.state.character = {...makeCharacterDocument({...saved.data, hp: {...saved.data.hp, current: 9}}, 3), operationWatermark: 20};
			return {character: saved};
		});
		h.state.setName("Save A");
		const save = h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}});
		await started.promise;
		h.api.pListEventPage.mockClear();
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 20, hasMore: false}});
		const http = h.deliverHttp(event);
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		if (order === "context-before-delivery") {
			h.contextGate.resolve(h.context);
			await pFlush();
			expect(h.host._hubContext).toBe(h.context);
			expect(h.host._isHubOperationAuthorityReady()).toBe(true);
			expect(h.repository.hasPendingResync("character-1")).toBe(false);
		}
		release.resolve();
		await save;
		expect(await http).toBe(false);
		if (order === "context-after-delivery") {
			await pFlush();
			expect(h.repository.hasPendingResync("character-1")).toBe(true);
			expect(h.api.pListEventPage).not.toHaveBeenCalled();
			expect(h.notice).not.toHaveBeenCalled();
			h.contextGate.resolve(h.context);
		}
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.repository._accepted.get("character-1").revision).toBe(3);
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(1);
		h.api.pPatchCharacter.mockImplementationOnce(async input => {
			h.api.state.character = {...makeCharacterDocument(applyJsonPatch(h.api.state.character.data, input.patches), 4), operationWatermark: 20};
			return {character: h.api.state.character};
		});
		h.state.setName("Save B after recovered effect");
		await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).resolves.toMatchObject({id: "character-1", hp: {current: 9}});
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.repository._saveBlocks.has("character-1")).toBe(false);
		expect(h.api.pListEventPage).toHaveBeenCalledTimes(1);
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(2);
		expect(h.api.state.character.data.name).toBe("Save B after recovered effect");
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.notice).toHaveBeenCalledTimes(1);
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each([false, true])("coalesces repeated stale HTTP arrivals (websocket copies: %s) into one mixed-leg history read and clears the save block", async withSocketCopies => {
		const h = await pMakeAuthorityHarness();
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		const events = [
			makeMultiEvent({revision: 3, legId: "first"}),
			makeMultiEvent({revision: 4, sequence: 21, legId: "second"}),
			makeMultiEvent({revision: null, sequence: 22, legId: "noop"}),
		];
		events[2].payload.changed = false;
		events[2].payload.resultingCharacterRevision = null;
		const started = makeDeferred();
		const release = makeDeferred();
		h.api.pPatchCharacter.mockImplementationOnce(async input => {
			started.resolve();
			await release.promise;
			const saved = {...makeCharacterDocument(applyJsonPatch(h.api.state.character.data, input.patches), 2), operationWatermark: 0};
			h.api.state.character = {...makeCharacterDocument({...saved.data, hp: {...saved.data.hp, current: 13}}, 4), operationWatermark: 21};
			return {character: saved};
		});
		h.state.setName("Save A");
		const save = h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}});
		await started.promise;
		h.api.pListEventPage.mockClear();
		h.api.pListEventPage.mockResolvedValue({events, replay: {scannedThroughSequence: 22, hasMore: false}});
		const http = events.flatMap(event => [h.deliverHttp(event), h.deliverHttp(event)]);
		if (withSocketCopies) for (const event of events) h.clients[0].emit("event", event);
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		h.contextGate.resolve(h.context);
		await pFlush();
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		release.resolve();
		await save;
		expect(await Promise.all(http)).toEqual([false, false, false, false, false, false]);
		await pFlush();
		await pFlush();
		expect(h.api.pListEventPage).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.repository._saveBlocks.has("character-1")).toBe(false);
		expect(h.repository._accepted.get("character-1").revision).toBe(4);
		expect(h.state.toJson().hp.current).toBe(13);
		expect(h.state.toJson().name).toBe("Save A");
		expect(h.adopted.mock.calls.map(([character]) => character.hp.current)).toEqual(withSocketCopies ? [9, 13] : [13]);
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/noop")).toBe(true);
		expect(h.repository._revisionlessCoverage.get(h.repository._getRevisionlessCoverageKey("character-1")).has("review-operation/target/noop")).toBe(true);
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(1);
		h.api.pPatchCharacter.mockImplementationOnce(async input => {
			h.api.state.character = {...makeCharacterDocument(applyJsonPatch(h.api.state.character.data, input.patches), 5), operationWatermark: 21};
			return {character: h.api.state.character};
		});
		h.state.setName("Save B");
		await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).resolves.toMatchObject({hp: {current: 13}});
		expect(h.api.pPatchCharacter).toHaveBeenCalledTimes(2);
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["archive", "access-loss", "account", "campaign", "access", "repository", "character"])("does not hand off queued old HTTP evidence after %s scope loss", async ending => {
		const h = await pMakeAuthorityHarness();
		h.host._hubActiveCampaign.accountId = "account-1";
		h.host._onHubCampaignContextChanged = CharacterSheetPage.prototype._onHubCampaignContextChanged.bind(h.host);
		const {release, save} = await pBlockSave(h);
		const http = h.deliverHttp(makeMultiEvent());
		h.clients[0].emit("state", {state: "reconnecting"});
		h.clients[0].emit("state", {state: "live"});
		h.contextGate.resolve(h.context);
		await pFlush();
		h.api.pListEventPage.mockClear();
		if (ending === "archive") h.clients[0].emit("event", makeAuthorityEvent("campaign.archived"));
		if (ending === "access-loss") h.clients[0].emit("state", {state: "access_lost"});
		if (ending === "account") h.host._hubActiveCampaign.accountId = "replacement-account";
		if (ending === "campaign") h.host._hubCampaignId = "replacement-campaign";
		if (ending === "access") h.host._currentCharacterAccess = "dm_readonly";
		if (ending === "repository") h.host._characterRepository = {hasPendingResync: () => false};
		if (ending === "character") {
			h.host._endCurrentHubCharacterAccess({characterId: "character-1"});
			h.host._currentCharacterId = "replacement-character";
		}
		release.resolve();
		await save;
		expect(await http).toBe(false);
		await pFlush();
		await pFlush();
		expect(h.api.pListEventPage).not.toHaveBeenCalled();
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("fences an already-scheduled recovery microtask after terminal teardown", async () => {
		const h = await pMakeAuthorityHarness();
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: "queued-event", sequence: 20, ...makeMultiEvent().payload,
			}});
		expect(h.host._scheduleHubRealtimeResync({characterId: "character-1"})).toBe(true);
		h.host._endCurrentHubCharacterAccess({characterId: "character-1"});
		await pFlush();
		expect(h.api.pListEventPage).not.toHaveBeenCalled();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.host._currentCharacterId).toBeNull();
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("does not let a stale scheduled scope suppress new authorized recovery after reopen", async () => {
		const h = await pMakeAuthorityHarness();
		h.host._pRunHubRealtimeResync = jest.fn();
		const oldGeneration = h.host._characterLoadGeneration;
		h.host._scheduleHubRealtimeResync({characterId: "character-1"});
		h.host._concealHubPrivateCharacter = CharacterSheetPage.prototype._concealHubPrivateCharacter.bind(h.host);
		h.host._endCurrentHubCharacterAccess({characterId: "character-1"});
		expect(h.host._characterLoadGeneration).toBe(oldGeneration + 1);
		Object.assign(h.host, {
			_currentCharacterId: "character-1",
			_currentCharacterAccess: "owner",
			_isHubCharacter: true,
			_hubContext: h.context,
			_isHubContextUnavailable: false,
			_isHubContextRevalidationRequired: false,
			_isHubOperationAuthorityPending: false,
			_hubRulesRefreshBlocked: false,
		});
		h.host._scheduleHubRealtimeResync({characterId: "character-1"});
		await pFlush();
		expect(h.host._pRunHubRealtimeResync).toHaveBeenCalledTimes(1);
		expect(h.host._pRunHubRealtimeResync).toHaveBeenCalledWith({characterId: "character-1"});
		h.effects.destroy();
		h.targeting.destroy();
	});
});

describe("A4 immediate authority invalidation on real queued consumers", () => {
	it.each(["campaign.archived", "rules.activated", "character.projection.invalidated"].flatMap(type => ["http-first", "event-first"].map(order => [type, order])))("fences %s before %s delivery behind save A and recovers only under fresh authority", async (type, order) => {
		const h = await pMakeAuthorityHarness();
		const {release, save} = await pBlockSave(h);
		const event = makeMultiEvent();
		let http;
		if (order === "http-first") http = h.deliverHttp(event);
		h.clients[0].emit("event", event);
		if (order === "event-first") http = h.deliverHttp(event);
		h.clients[0].emit("event", makeAuthorityEvent(type));
		expect(h.effects._isCapabilityRevoked).toBe(true);
		expect(h.targeting._isSuspended).toBe(true);
		release.resolve();
		await save;
		expect(await http).toBe(false);
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.toasts).toEqual([]);
		expect(h.focus).not.toHaveBeenCalled();
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/review-leg")).toBe(false);
		expect(h.repository._realtimeCursors.get("character-1")?.operationWatermark).not.toBe(20);
		if (type === "campaign.archived") {
			expect(h.host._concealHubPrivateCharacter).toHaveBeenCalledTimes(1);
			expect(h.host._currentCharacterId).toBeNull();
		} else {
			expect(h.state.toJson().hp.current).toBe(5);
			expect(h.repository.hasPendingResync("character-1")).toBe(true);
			h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 30, hasMore: false}});
			h.contextGate.resolve(h.context);
			await pFlush();
			await pFlush();
			expect(h.state.toJson().hp.current).toBe(9);
			expect(h.adopted).toHaveBeenCalledTimes(1);
			expect(h.notice).toHaveBeenCalledTimes(1);
			await h.deliverHttp(event);
			expect(h.adopted).toHaveBeenCalledTimes(1);
			expect(h.notice).toHaveBeenCalledTimes(1);
		}
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["campaign.archived", "rules.activated", "character.projection.invalidated"])("fences a queued resync behind save A on actual %s arrival without committing its leg", async type => {
		const h = await pMakeAuthorityHarness();
		const {release, save} = await pBlockSave(h);
		const event = makeMultiEvent();
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: event.id,
				sequence: event.sequence,
				leg: "target",
				legId: "review-leg",
				operationId: "review-operation",
				operation: event.payload.operation,
				resultingCharacterRevision: 3,
			}});
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 30, hasMore: false}});
		const pending = h.host._pRunHubRealtimeResync({characterId: "character-1"});
		h.clients[0].emit("event", makeAuthorityEvent(type));
		release.resolve();
		await save;
		expect(await pending).toBe(false);
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		expect(h.toasts).toEqual([]);
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/review-leg")).toBe(false);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["campaign.archived", "rules.activated", "character.projection.invalidated"])("fences canonical adoption already awaiting its authorized read on actual %s arrival", async type => {
		const h = await pMakeAuthorityHarness();
		const read = makeDeferred();
		const started = makeDeferred();
		h.api.pGetCharacter.mockImplementationOnce(async () => {
			started.resolve();
			return read.promise;
		});
		h.host._scheduleHubAuthoritativeReconcile({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent(type));
		read.resolve(makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2));
		await pFlush();
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		expect(h.toasts).toEqual([]);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["canonical", "history"])("fences pending resync during its %s await and retains exact evidence for fresh recovery", async phase => {
		const h = await pMakeAuthorityHarness();
		const event = makeMultiEvent({revision: 2});
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: event.id, sequence: event.sequence, ...event.payload, resultingCharacterRevision: 2,
			}});
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 20, hasMore: false}});
		const read = makeDeferred();
		const started = makeDeferred();
		const method = phase === "canonical" ? "pGetCharacter" : "pListEventPage";
		const original = h.api[method].getMockImplementation();
		h.api[method].mockImplementationOnce(async input => {
			started.resolve();
			await read.promise;
			return original(input);
		});
		const resync = h.host._pRunHubRealtimeResync({characterId: "character-1"});
		await started.promise;
		h.clients[0].emit("event", makeAuthorityEvent("character.projection.invalidated"));
		read.resolve();
		await resync;
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(true);
		expect(h.notice).not.toHaveBeenCalled();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.notice).toHaveBeenCalledTimes(1);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("retains canonical projection demand and accepts a future current-authority leg after refresh", async () => {
		const h = await pMakeAuthorityHarness();
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 9, max: 44, temp: 0}}, 2);
		h.clients[0].emit("event", makeAuthorityEvent("character.projection.invalidated"));
		await pFlush();
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.effects.onApplied({operation: makeMultiEvent({revision: 2}).payload.operation, legId: "stale"})).toBe(false);
		expect(h.notice).not.toHaveBeenCalled();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.host._renderCount).toBe(2);
		expect(h.notice).not.toHaveBeenCalled();
		const event = makeMultiEvent({revision: 3, sequence: 40, legId: "fresh"});
		expect(await h.deliverHttp(event)).toBe(true);
		expect(h.state.toJson().hp.current).toBe(13);
		expect(h.adopted).toHaveBeenCalledTimes(2);
		expect(h.notice).toHaveBeenCalledTimes(1);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it.each(["durable", "journal", "adopt"])("rolls back mixed resync, every durable command and coverage when actual authority changes at %s boundary", async phase => {
		const h = await pMakeAuthorityHarness();
		h.api.pPatchCharacter.mockRejectedValue(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}));
		for (const name of ["edit A", "edit B"]) {
			h.state.setName(name);
			await expect(h.repository.pUpsert({character: {...h.state.toJson(), id: "character-1"}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		const documentsBefore = JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"));
		const journalKey = h.repository._getRevisionlessCoverageKey("character-1");
		const events = [makeMultiEvent({revision: 2, sequence: 20, legId: "first"}), makeMultiEvent({revision: 3, sequence: 21, legId: "second"}), makeMultiEvent({revision: null, sequence: 22, legId: "noop"})];
		events[2].payload.changed = false;
		events[2].payload.resultingCharacterRevision = null;
		h.api.pListEventPage.mockResolvedValue({events, replay: {scannedThroughSequence: 22, hasMore: false}});
		h.api.state.character = makeCharacterDocument({...h.api.state.character.data, hp: {current: 13, max: 44, temp: 0}}, 3);
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: events[1].id, sequence: events[1].sequence, ...events[1].payload, resultingCharacterRevision: 3,
			}});
		const method = phase === "durable" ? "_stageRecoveryCommandQueue" : phase === "journal" ? "_stageRevisionlessCoverage" : "_reconcileClassFeatures";
		const target = phase === "adopt" ? h.host : h.repository;
		const original = target[method].bind(target);
		const boundary = jest.spyOn(target, method).mockImplementationOnce(input => {
			const result = original(input);
			h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
			return result;
		});
		await h.host._pRunHubRealtimeResync({characterId: "character-1"});
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.state.toJson().name).toBe("edit B");
		expect(JSON.stringify(h.repository._recoveryCommandQueues.get("character-1"))).toBe(documentsBefore);
		expect(h.repository._recoveryStorage.getItem(journalKey)).toBeNull();
		expect(h.repository._accepted.get("character-1").revision).toBe(1);
		expect(h.repository._getCoverageBook("character-1").acceptedOperationLegIds.toArray()).toEqual([]);
		expect(h.repository.hasPendingResync("character-1")).toBe(true);
		expect(h.notice).not.toHaveBeenCalled();
		expect(h.host._renderCount).toBe(0);
		if (phase !== "adopt") expect(h.adopted).not.toHaveBeenCalled();
		boundary.mockRestore();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.repository.getSaveBlock("character-1")).toBeNull();
		expect(h.state.toJson().hp.current).toBe(13);
		expect(h.state.toJson().name).toBe("edit B");
		expect(h.notice).toHaveBeenCalledTimes(3);
		for (const command of h.repository._recoveryCommandQueues.get("character-1")) {
			for (const field of ["submittedBaseCoverage", "submittedSnapshotCoverage"]) {
				expect(command[field].appliedOperationLegIds.has("review-operation/target/noop")).toBe(true);
				expect(command[field].revision).toBe(3);
			}
		}
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("rolls back a revisionless-only resync journal when actual authority changes after staging", async () => {
		const h = await pMakeAuthorityHarness();
		const event = makeMultiEvent({revision: null, legId: "noop-only"});
		event.payload.changed = false;
		event.payload.resultingCharacterRevision = null;
		h.repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: event.id, sequence: event.sequence, ...event.payload, resultingCharacterRevision: null,
			}});
		const original = h.repository._stageRevisionlessCoverage.bind(h.repository);
		const boundary = jest.spyOn(h.repository, "_stageRevisionlessCoverage").mockImplementationOnce(input => {
			const staged = original(input);
			h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
			return staged;
		});
		await h.host._pRunHubRealtimeResync({characterId: "character-1"});
		expect(h.repository._recoveryStorage.getItem(h.repository._getRevisionlessCoverageKey("character-1"))).toBeNull();
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/noop-only")).toBe(false);
		expect(h.repository.hasPendingResync("character-1")).toBe(true);
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.notice).not.toHaveBeenCalled();
		boundary.mockRestore();
		h.contextGate.resolve(h.context);
		await pFlush();
		await pFlush();
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.repository._getAppliedIds("character-1").operationLegs.has("review-operation/target/noop-only")).toBe(true);
		expect(h.adopted).not.toHaveBeenCalled();
		expect(h.state.toJson().hp.current).toBe(5);
		expect(h.notice).toHaveBeenCalledTimes(1);
		h.effects.destroy();
		h.targeting.destroy();
	});

	it("recovers retained HTTP evidence when fresh context finishes before the old queued callback drains", async () => {
		const h = await pMakeAuthorityHarness();
		const {release, save} = await pBlockSave(h);
		const event = makeMultiEvent();
		const http = h.deliverHttp(event);
		h.api.pListEventPage.mockResolvedValue({events: [event], replay: {scannedThroughSequence: 30, hasMore: false}});
		h.clients[0].emit("event", makeAuthorityEvent("rules.activated"));
		const contextRefresh = h.host._pRefreshHubRules({isUseLatest: true});
		h.contextGate.resolve(h.context);
		await contextRefresh;
		expect(h.host._isHubOperationAuthorityPending).toBe(false);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		expect(h.adopted).not.toHaveBeenCalled();
		release.resolve();
		await save;
		expect(await http).toBe(false);
		await pFlush();
		await pFlush();
		expect(h.state.toJson().hp.current).toBe(9);
		expect(h.adopted).toHaveBeenCalledTimes(1);
		expect(h.notice).toHaveBeenCalledTimes(1);
		expect(h.repository.hasPendingResync("character-1")).toBe(false);
		h.effects.destroy();
		h.targeting.destroy();
	});
});

describe("Reviewed multi-target deliveries on the real sheet/repository queue", () => {
	it.each(["_hubContextGeneration", "_hubRoleRosterGeneration", "_hubRealtimeGeneration"])("fences an authoritative receipt behind a real save when %s changes", async field => {
		const {host, repository, api, state, hubEffects} = await pMakeHarness();
		const started = makeDeferred();
		const release = makeDeferred();
		api.pPatchCharacter.mockImplementationOnce(async input => {
			started.resolve();
			await release.promise;
			api.state.character = makeCharacterDocument(applyJsonPatch(api.state.character.data, input.patches), 2);
			return {character: structuredClone(api.state.character)};
		});
		state.setName("Save A");
		const save = repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		await started.promise;
		const pending = host._onHubAuthoritativeApproval({
			actionId: "multi-1",
			characterId: "character-1",
			eventId: "multi-source",
			sequence: 20,
			resultingCharacterRevision: 3,
			leg: "source",
			sourceCost: makeSourceCost(),
		});
		host[field] = (host[field] ?? 0) + 1;
		release.resolve();
		await save;
		expect(await pending).toBe(false);
		expect(state.toJson().spellcasting.spellSlots[1].current).toBe(2);
		expect(host._renderCount).toBe(0);
		expect(hubEffects.onApplied).not.toHaveBeenCalled();
	});

	it.each(["http-first", "event-first"])("adopts a combined self-cost/effect once with %s delivery", async order => {
		const {host, clients, state, hubEffects} = await pMakeHarness();
		const event = makeCombinedEvent();
		event.type = "character.multi_operation.target_applied";
		event.payload.operationId = "operation-1";
		event.payload.legId = "combined-leg";
		const deliverHttp = () => host._onHubAuthoritativeApproval({
			actionId: "operation-1",
			characterId: "character-1",
			eventId: event.id,
			sequence: event.sequence,
			operation: event.payload.operation,
			resultingCharacterRevision: 2,
			leg: "combined",
			legId: "combined-leg",
			operationLegKey: "operation-1/combined/combined-leg",
			sourceCost: makeSourceCost(),
		});
		if (order === "http-first") await deliverHttp();
		clients[0].emit("event", event);
		await pFlush();
		if (order === "event-first") await deliverHttp();
		expect(state.toJson().hp.current).toBe(34);
		expect(state.toJson().spellcasting.spellSlots[1].current).toBe(1);
		expect(host._renderCount).toBe(1);
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
	});

	it.each(["http-first", "event-first"])("covers a revisionless no-op with zero sheet adoption/render/save in %s order", async order => {
		const {host, clients, repository, api, hubEffects, state} = await pMakeHarness();
		const event = makeAppliedEvent({kind: "hp.heal"});
		event.type = "character.multi_operation.target_applied";
		event.aggregateRevision = null;
		event.payload.operationId = "operation-1";
		event.payload.legId = "noop-leg";
		event.payload.leg = "target";
		event.payload.changed = false;
		delete event.payload.resultingCharacterRevision;
		const before = JSON.stringify(state.toJson());
		const adopt = jest.spyOn(host, "_adoptHubLiveCharacterData");
		const http = () => host._onHubAuthoritativeApproval({
			actionId: "operation-1",
			characterId: "character-1",
			eventId: event.id,
			sequence: event.sequence,
			operation: event.payload.operation,
			resultingCharacterRevision: null,
			legId: "noop-leg",
			changed: false,
		});
		if (order === "http-first") await http();
		clients[0].emit("event", event);
		await pFlush();
		if (order === "event-first") await http();
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(adopt).not.toHaveBeenCalled();
		expect(host._renderCount).toBe(0);
		expect(api.pPatchCharacter).not.toHaveBeenCalled();
		expect(repository._realtimeCursors.get("character-1")?.operationWatermark).toBeUndefined();
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
		expect(hubEffects.onApplied).toHaveBeenCalledWith(expect.objectContaining({legId: "noop-leg", changed: false}));
	});

	it.each(["http-first", "event-first"])("preserves edit/save B after save A and source-cost delivery queued in %s order", async order => {
		const {host, clients, repository, api, state} = await pMakeHarness();
		const started = makeDeferred();
		const release = makeDeferred();
		api.pPatchCharacter.mockImplementationOnce(async input => {
			started.resolve();
			await release.promise;
			api.state.character = makeCharacterDocument(applyJsonPatch(api.state.character.data, input.patches), 2);
			return {character: structuredClone(api.state.character)};
		});
		state.setName("Save A");
		const saveA = repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		await started.promise;
		const event = makeSourceEvent({revision: 3});
		event.type = "character.multi_operation.source_cost_consumed";
		const http = () => host._onHubAuthoritativeApproval({
			actionId: "operation-1",
			characterId: "character-1",
			eventId: event.id,
			sequence: event.sequence,
			resultingCharacterRevision: 3,
			leg: "source",
			sourceCost: makeSourceCost(),
			operationLegKey: "operation-1/source",
		});
		const pendingHttp = order === "http-first" ? http() : null;
		clients[0].emit("event", event);
		state.setName("Unsaved B");
		release.resolve();
		await saveA;
		await pFlush();
		if (pendingHttp) await pendingHttp;
		else await http();
		expect(state.toJson().name).toBe("Unsaved B");
		expect(state.toJson().spellcasting.spellSlots[1].current).toBe(1);
		expect(host._renderCount).toBe(1);
		api.pPatchCharacter.mockImplementationOnce(async input => {
			api.state.character = makeCharacterDocument(applyJsonPatch(repository._accepted.get("character-1").data, input.patches), 4);
			return {character: structuredClone(api.state.character)};
		});
		await repository.pUpsert({character: {...state.toJson(), id: "character-1"}});
		expect(repository._accepted.get("character-1").data.name).toBe("Unsaved B");
		expect(repository._accepted.get("character-1").data.spellcasting.spellSlots[1].current).toBe(1);
	});
});

describe("Live campaign effects on an open Character Sheet", () => {
	it("shows bounded XP and item award reasons and schedules XP reconciliation", async () => {
		const {api, clients, host, state, toasts} = await pMakeHarness();
		api.state.character = makeCharacterDocument({
			...api.state.character.data,
			xp: 9000,
		}, 2);

		clients[0].emit("event", {
			id: "xp-notice",
			campaignId: "campaign-1",
			sequence: 21,
			type: "xp.granted",
			aggregateType: "character",
			aggregateId: "character-1",
			payload: {amount: 250, xp: 9000, reason: "<b>For the Ashen Pass</b>"},
		});
		clients[0].emit("event", {
			id: "item-notice",
			campaignId: "campaign-1",
			sequence: 22,
			type: "item.granted",
			aggregateType: "character",
			aggregateId: "character-1",
			payload: {
				entry: {item: {name: "Longsword", source: "PHB"}, quantity: 1},
				note: "<i>For the Ashen Pass</i>",
			},
		});
		await pFlush();
		if (host._hubAuthoritativeReconcilePromise) await host._hubAuthoritativeReconcilePromise;
		await pFlush();

		expect(toasts.map(toast => toast.content.textContent || toast.content.innerHTML || toast.content._html)).toEqual([
			"Received 250 XP (9000 XP total) — For the Ashen Pass.",
			"Received Longsword — For the Ashen Pass.",
		]);
		expect(state.toJson().xp).toBe(9000);
		expect(api.pGetCharacter).toHaveBeenCalled();
	});

	it("keeps item invalidation live without showing recipient notices to a DM inspector", async () => {
		const {clients, coordinator, toasts} = await pMakeHarness({access: "dm_readonly"});
		const inventoryEvents = [];
		coordinator.on("inventoryTransfer", event => inventoryEvents.push(event));

		clients[0].emit("event", {
			id: "dm-visible-item-award",
			campaignId: "campaign-1",
			sequence: 22,
			type: "item.granted",
			aggregateType: "character",
			aggregateId: "character-1",
			payload: {
				entry: {item: {name: "Longsword", source: "PHB"}, quantity: 1},
				note: "For the player",
			},
		});
		await pFlush();

		expect(toasts).toEqual([]);
		expect(inventoryEvents).toEqual([expect.objectContaining({
			eventId: "dm-visible-item-award",
			type: "item.granted",
			isCurrentCharacterAffected: true,
		})]);
	});

	it("refreshes DM truth for XP awards without showing the player recipient notice", async () => {
		const {api, clients, host, state, toasts} = await pMakeHarness({access: "dm_readonly"});
		api.state.character = makeCharacterDocument({
			...api.state.character.data,
			xp: 9_000,
		}, 2);

		clients[0].emit("event", {
			id: "dm-visible-xp-award",
			campaignId: "campaign-1",
			sequence: 23,
			type: "xp.granted",
			aggregateType: "character",
			aggregateId: "character-1",
			payload: {amount: 250, xp: 9_000, reason: "For the player"},
		});
		await pFlush();
		await pFlush();

		expect(toasts).toEqual([]);
		expect(state.toJson().xp).toBe(9_000);
		expect(api.pGetCharacterProjection).toHaveBeenCalledTimes(2);
		expect(host._renderCount).toBe(1);
	});

	it("commits spell activity once when Keep Local retries a post-save live conflict", async () => {
		const {api, host, state} = await pMakeHarness({seed: {name: "Mira"}});
		const firstPatchStarted = makeDeferred();
		const releaseFirstPatch = makeDeferred();
		const requests = [];
		api.pPatchCharacter.mockImplementation(async input => {
			requests.push(structuredClone(input));
			if (requests.length === 1) {
				firstPatchStarted.resolve();
				await releaseFirstPatch.promise;
				api.state.character = makeCharacterDocument({
					...applyJsonPatch(api.state.character.data, input.patches),
					name: "Server Edit",
				}, 2);
				return {character: structuredClone(api.state.character)};
			}
			api.state.character = makeCharacterDocument(
				applyJsonPatch(api.state.character.data, input.patches),
				api.state.character.revision + 1,
			);
			return {character: structuredClone(api.state.character)};
		});
		const prompt = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		const activity = {
			type: "spell.used",
			spellName: "Shield",
			spellSource: "PHB",
			spellLevel: 1,
			slotLevel: 1,
			mode: "spell_slot",
		};

		try {
			const pendingSave = host._saveCurrentCharacter({activity});
			await firstPatchStarted.promise;
			state.setName("Local Edit");
			releaseFirstPatch.resolve();

			await expect(pendingSave).resolves.toBe(true);
			expect(requests).toHaveLength(2);
			expect(requests.map(request => request.activity)).toEqual([activity, null]);
			expect(state.toJson().name).toBe("Local Edit");
		} finally {
			consoleError.mockRestore();
			prompt.mockRestore();
		}
	});

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
		expect(host._teardownHubRules).toHaveBeenCalledTimes(1);
		expect(host._hubActiveCampaign.pHandleAccessLoss).toHaveBeenCalledWith({campaignId: "campaign-1"});
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

	it("adopts a combined self operation from HTTP before a missed realtime event, then dedupes the replay", async () => {
		const {clients, host, state} = await pMakeHarness();
		const event = makeCombinedEvent();
		await host._onHubAuthoritativeApproval({
			actionId: "operation-1",
			characterId: "character-1",
			eventId: event.id,
			sequence: event.sequence,
			operation: event.payload.operation,
			resultingCharacterRevision: event.payload.resultingCharacterRevision,
			leg: "combined",
			sourceCost: event.payload.sourceCost,
		});
		await pFlush();
		expect(state.getCurrentHp()).toBe(34);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);

		clients[0].emit("event", event);
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

	it("announces a canonical no-op once without re-rendering or stealing focus", async () => {
		const {clients, host, hubEffects, state} = await pMakeHarness({seed: {hp: {current: 44, max: 44, temp: 0}}});
		const renderCountBefore = host._renderCount;
		const activeElement = {focus: jest.fn()};
		document.activeElement = activeElement;
		clients[0].emit("event", {
			...makeAppliedEvent({kind: "hp.heal", args: {amount: 5}}),
			payload: {
				...makeAppliedEvent({kind: "hp.heal", args: {amount: 5}}).payload,
				changed: false,
			},
		});
		await pFlush();

		expect(state.getCurrentHp()).toBe(44);
		expect(host._renderCount).toBe(renderCountBefore);
		expect(document.activeElement).toBe(activeElement);
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
		expect(hubEffects.onApplied).toHaveBeenCalledWith(expect.objectContaining({
			changed: false,
			beforeData: expect.objectContaining({hp: expect.objectContaining({current: 44})}),
			afterData: expect.objectContaining({hp: expect.objectContaining({current: 44})}),
		}));

		clients[0].emit("event", {
			...makeAppliedEvent({id: "event-replay", kind: "hp.heal", args: {amount: 5}}),
			payload: {
				...makeAppliedEvent({kind: "hp.heal", args: {amount: 5}}).payload,
				changed: false,
			},
		});
		await pFlush();
		expect(hubEffects.onApplied).toHaveBeenCalledTimes(1);
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

	it("refetches canonical truth after mixed semantic and ordinary reconnect changes without double-applying", async () => {
		const {api, clients, state} = await pMakeHarness({seed: {xp: 6_500}});
		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 20},
			characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1, operationWatermark: 20}],
		});
		await pFlush();
		const fetchCount = api.pGetCharacter.mock.calls.length;
		api.state.character = makeCharacterDocument({
			...structuredClone(api.state.character.data),
			hp: {...api.state.character.data.hp, current: 26},
			xp: 7_000,
		}, 3);

		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 21},
			characterRefs: [{id: "character-1", revision: 3, projectionRevision: 3, operationWatermark: 21}],
		});
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();
		await pFlush();

		expect(api.pGetCharacter.mock.calls.length).toBeGreaterThan(fetchCount);
		expect(state.getCurrentHp()).toBe(26);
		expect(state.getXp()).toBe(7_000);
	});

	it("surfaces an overlapping offline draft and converges when reconnect reports a newer canonical revision", async () => {
		const {api, clients, host, repository, state} = await pMakeHarness();
		const previousPrompt = globalThis.InputUiUtil.pGetUserBoolean;
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => false);
		try {
			clients[0].emit("cursor", {
				cursor: {campaignId: "campaign-1", lastSequence: 20},
				characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1, operationWatermark: 20}],
			});
			await pFlush();
			state.setCurrentHp(24);
			api.state.isOffline = true;
			await expect(repository.pUpsert({
				character: {...state.toJson(), id: "character-1"},
			})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});

			api.state.isOffline = false;
			api.state.character = makeCharacterDocument({
				...structuredClone(api.state.character.data),
				hp: {...api.state.character.data.hp, current: 18},
			}, 2);

			clients[0].emit("cursor", {
				cursor: {campaignId: "campaign-1", lastSequence: 21},
				characterRefs: [{id: "character-1", revision: 2, projectionRevision: 2, operationWatermark: 20}],
			});
			await pFlush();
			await pFlush();

			expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledWith(expect.objectContaining({
				title: "Character Changed on Another Device",
			}));
			expect(state.getCurrentHp()).toBe(18);
			expect(repository._accepted.get("character-1").revision).toBe(2);
			expect(repository.getConflictRecovery("character-1")).toBeNull();
			expect(host._saveIndicator.at(-1)).toBe("saved");
		} finally {
			globalThis.InputUiUtil.pGetUserBoolean = previousPrompt;
		}
	});

	it("preserves the overlapping offline value when the player explicitly chooses Use Local", async () => {
		const {api, clients, repository, state} = await pMakeHarness();
		const previousPrompt = globalThis.InputUiUtil.pGetUserBoolean;
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		try {
			clients[0].emit("cursor", {
				cursor: {campaignId: "campaign-1", lastSequence: 20},
				characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1, operationWatermark: 20}],
			});
			await pFlush();
			state.setCurrentHp(24);
			api.state.isOffline = true;
			await expect(repository.pUpsert({
				character: {...state.toJson(), id: "character-1"},
			})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});

			api.state.isOffline = false;
			api.state.character = makeCharacterDocument({
				...structuredClone(api.state.character.data),
				hp: {...api.state.character.data.hp, current: 18},
			}, 2);
			api.pPatchCharacter.mockImplementation(async ({patches}) => {
				api.state.patches.push(...patches);
				api.state.character = makeCharacterDocument(
					applyJsonPatch(api.state.character.data, patches),
					api.state.character.revision + 1,
				);
				return {character: structuredClone(api.state.character)};
			});

			clients[0].emit("cursor", {
				cursor: {campaignId: "campaign-1", lastSequence: 21},
				characterRefs: [{id: "character-1", revision: 2, projectionRevision: 2, operationWatermark: 20}],
			});
			await pFlush();
			await pFlush();

			expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledWith(expect.objectContaining({
				title: "Character Changed on Another Device",
			}));
			expect(api.state.character).toMatchObject({
				revision: 3,
				data: {hp: {current: 24}},
			});
			expect(state.getCurrentHp()).toBe(24);
			expect(repository.getConflictRecovery("character-1")).toBeNull();
		} finally {
			globalThis.InputUiUtil.pGetUserBoolean = previousPrompt;
		}
	});

	it("retries a disjoint offline draft when the realtime connection returns", async () => {
		const {api, clients, repository, state} = await pMakeHarness();
		state.setName("Mira Offline");
		api.state.isOffline = true;
		await expect(repository.pUpsert({
			character: {...state.toJson(), id: "character-1"},
		})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});

		api.state.isOffline = false;
		api.pPatchCharacter.mockImplementation(async ({patches}) => {
			api.state.patches.push(...patches);
			api.state.character = makeCharacterDocument(
				applyJsonPatch(api.state.character.data, patches),
				api.state.character.revision + 1,
			);
			return {character: structuredClone(api.state.character)};
		});
		clients[0].emit("state", {state: "live"});
		await pFlush();
		await pFlush();

		expect(api.state.character).toMatchObject({
			revision: 2,
			data: {name: "Mira Offline"},
		});
		expect(repository.hasPendingWrites()).toBe(false);
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

	it("advances the character document generation after authoritative live adoption", () => {
		const state = new CharacterSheetState();
		state.setName("Before Adoption");
		const host = {
			_state: state,
			_currentCharacterId: "character-1",
			_characterDocumentGeneration: 4,
			_reconcileClassFeatures: jest.fn(),
		};

		CharacterSheetPage.prototype._adoptHubLiveCharacterData.call(host, {
			...state.toJson(),
			name: "After Adoption",
		});

		expect(state.getName()).toBe("After Adoption");
		expect(host._characterDocumentGeneration).toBe(5);
	});

	it("closes only document-sensitive character portals when authoritative live adoption invalidates them", () => {
		CharacterSheetModal._resetForTests();
		const state = new CharacterSheetState();
		const makeElement = () => ({
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			remove: jest.fn(),
		});
		const documentSensitiveElement = makeElement();
		const ordinaryElement = makeElement();
		const cleanup = jest.fn();
		const ordinaryCleanup = jest.fn();
		const host = {
			_state: state,
			_currentCharacterId: "character-1",
			_characterLoadGeneration: 2,
			_characterDocumentGeneration: 4,
			_currentCharacterAccess: "owner",
			_reconcileClassFeatures: jest.fn(),
		};
		CharacterSheetModal.registerCharacterScopePortal({
			sheet: host,
			element: documentSensitiveElement,
			cleanup,
			isCloseOnDocumentInvalidation: true,
		});
		CharacterSheetModal.registerCharacterScopePortal({
			sheet: host,
			element: ordinaryElement,
			cleanup: ordinaryCleanup,
		});

		CharacterSheetPage.prototype._adoptHubLiveCharacterData.call(host, state.toJson());

		expect(documentSensitiveElement.remove).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledWith({isCharacterScopeTeardown: true});
		expect(ordinaryElement.remove).not.toHaveBeenCalled();
		expect(ordinaryCleanup).not.toHaveBeenCalled();
		CharacterSheetModal._resetForTests();
	});
});
