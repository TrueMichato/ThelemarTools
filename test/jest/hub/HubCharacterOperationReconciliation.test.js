import {jest} from "@jest/globals";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";

const RECOVERY_KEY = characterId => `hub-character-recovery:campaign-1:${characterId}`;

const makeSessionStorage = (seed = {}) => {
	const store = new Map(Object.entries(seed));
	return {
		getItem: key => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, String(value)),
		removeItem: key => store.delete(key),
		_store: store,
	};
};

const makeCharacterData = ({current = 10, max = 20, temp = 0, name = "Mira"} = {}) => ({
	name,
	hp: {current, max, temp},
	conditions: [],
	spellcasting: {spellSlots: {1: {current: 2, max: 2}}},
});

const makeOperation = ({kind = "hp.damage", args = {amount: 4}, operationId = "operation-1"} = {}) => ({
	operationId,
	kind,
	version: 1,
	targetCharacterId: "character-1",
	arguments: args,
});

const makeAppliedEvent = ({operationId = "operation-1", sequence = 20, revision = 2, kind = "hp.damage", args = {amount: 4}, id = "event-1"} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: "character.operation.applied",
	aggregateType: "character",
	aggregateId: "character-1",
	aggregateRevision: revision,
	payload: {
		operation: {operationId, kind, version: 1, targetCharacterId: "character-1", arguments: args},
		resultingCharacterRevision: revision,
	},
});

/** Minimal authority double: enough to drive save, conflict and history paths deterministically. */
const makeApi = ({character, events = []} = {}) => {
	const state = {character: structuredClone(character), patches: [], events: structuredClone(events)};
	return {
		state,
		pGetSession: jest.fn(async () => ({signedIn: true})),
		pGetCharacter: jest.fn(async () => structuredClone(state.character)),
		pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
		pPatchCharacter: jest.fn(async ({patches}) => {
			state.patches.push(...patches);
			return {character: structuredClone(state.character)};
		}),
		pListEventPage: jest.fn(async ({afterSequence}) => ({
			events: state.events.filter(event => event.sequence > afterSequence),
			replay: {scannedThroughSequence: state.events.at(-1)?.sequence ?? afterSequence, hasMore: false},
		})),
	};
};

const makeRepository = ({api, sessionStorage = makeSessionStorage()} = {}) => {
	const previous = globalThis.sessionStorage;
	globalThis.sessionStorage = sessionStorage;
	try {
		return new HubHttpCharacterRepository({campaignId: "campaign-1", api});
	} finally {
		if (previous === undefined) delete globalThis.sessionStorage;
		else globalThis.sessionStorage = previous;
	}
};

describe("Repository operation reconciliation", () => {
	it("advances the accepted base and the live document together", () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()});
		repository._getCoverageBook("character-1").live = {...repository._getCoverageBook("character-1").live, revision: 1};

		let adopted = null;
		const result = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			sequence: 20,
			liveData: makeCharacterData({name: "Mira the Bold"}),
			fnAdoptLive: next => { adopted = next; },
		});

		expect(result.status).toBe("applied");
		expect(repository._accepted.get("character-1").revision).toBe(2);
		expect(repository._accepted.get("character-1").data.hp.current).toBe(6);
		// The unsaved rename survives alongside the server-authoritative damage.
		expect(adopted).toMatchObject({name: "Mira the Bold", hp: {current: 6}});
	});

	it("applies to a stale recovered draft even when fetched canonical truth already covers the operation", async () => {
		// `pGet` stores canonical revision 2 (already damaged) but returns the pre-damage draft as live state.
		const sessionStorage = makeSessionStorage({
			[RECOVERY_KEY("character-1")]: JSON.stringify({
				version: 1,
				base: makeCharacterData(),
				snapshot: makeCharacterData({name: "Draft"}),
				commandKeys: {create: "c", patch: "p"},
				coverageVersion: 1,
				coverage: {
					base: {revision: 1, acceptedSequence: 10, appliedOperationIds: []},
					snapshot: {revision: 1, acceptedSequence: 10, appliedOperationIds: []},
				},
			}),
		});
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 2, data: makeCharacterData({current: 6})}});
		const repository = makeRepository({api, sessionStorage});

		const loaded = await repository.pGet({characterId: "character-1"});
		expect(loaded).toMatchObject({name: "Draft", hp: {current: 10}});

		const adopted = [];
		const deliver = () => repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			sequence: 20,
			liveData: adopted.length ? adopted.at(-1) : loaded,
			fnAdoptLive: next => adopted.push(next),
		});

		expect(deliver().status).toBe("applied");
		expect(adopted).toHaveLength(1);
		expect(adopted[0]).toMatchObject({name: "Draft", hp: {current: 6}});
		// Canonical was already correct and must not be damaged a second time.
		expect(repository._accepted.get("character-1").data.hp.current).toBe(6);

		// Redelivery after reconnect must be a no-op.
		expect(deliver().status).toBe("suppressed");
		expect(adopted).toHaveLength(1);
	});

	it("treats a recovery blob written without coverage metadata as unproven", async () => {
		const sessionStorage = makeSessionStorage({
			[RECOVERY_KEY("character-1")]: JSON.stringify({
				version: 1,
				base: makeCharacterData(),
				snapshot: makeCharacterData({name: "Legacy draft"}),
				commandKeys: {create: "c", patch: "p"},
			}),
		});
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 2, data: makeCharacterData({current: 6})}});
		const repository = makeRepository({api, sessionStorage});
		const loaded = await repository.pGet({characterId: "character-1"});

		const result = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: loaded,
			fnAdoptLive: () => { throw new Error("must not adopt on unproven coverage"); },
		});

		expect(result.status).toBe("resync_required");
		expect(repository.hasPendingResync("character-1")).toBe(true);
		expect(repository.isSaveBlocked("character-1")).toBe(true);
	});

	it("does not raise a conflict when a later save touches a path the operation did not", async () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});

		let live = makeCharacterData();
		repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: live,
			fnAdoptLive: next => { live = next; },
		});
		api.state.character = {id: "character-1", campaignId: "campaign-1", revision: 2, data: {...live}};

		await repository.pUpsert({character: {...live, name: "Renamed", id: "character-1"}});

		expect(api.pPatchCharacter).toHaveBeenCalledTimes(1);
		expect(api.state.patches).toEqual([{op: "replace", path: "/name", value: "Renamed"}]);
	});

	it("leaves a conflict's server candidate untouched when it already contains the operation", async () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});

		// The owner patch loses the race: the server has already applied the damage at revision 2.
		api.pPatchCharacter.mockRejectedValueOnce(Object.assign(new Error("stale"), {code: "REVISION_CONFLICT"}));
		api.state.character = {id: "character-1", campaignId: "campaign-1", revision: 2, data: makeCharacterData({current: 6, name: "Server"})};

		await expect(repository.pUpsert({character: {...makeCharacterData({name: "Local"}), id: "character-1"}}))
			.rejects.toMatchObject({code: "CHARACTER_CONFLICT"});

		const before = repository.getConflictRecovery("character-1");
		expect(before.server.hp.current).toBe(6);

		repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: undefined,
			fnAdoptLive: null,
		});

		const after = repository.getConflictRecovery("character-1");
		// Re-applying to the refetched server candidate would have double-damaged it down to 2.
		expect(after?.server?.hp?.current ?? 6).toBe(6);
	});

	it("clears a conflict whose only overlap was the operation itself", () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()});
		repository._conflicts.set("character-1", {
			base: makeCharacterData(),
			local: makeCharacterData({current: 6}),
			server: makeCharacterData({current: 6}),
			serverDocument: {id: "character-1", revision: 1, data: makeCharacterData({current: 6})},
			conflicts: [{localPath: "/hp/current", remotePath: "/hp/current"}],
			coverage: {
				base: {revision: 1, acceptedSequence: null, appliedOperationIds: []},
				local: {revision: 2, acceptedSequence: null, appliedOperationIds: ["operation-1"]},
				server: {revision: 2, acceptedSequence: null, appliedOperationIds: ["operation-1"]},
			},
		});

		repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: undefined,
			fnAdoptLive: null,
		});

		// Once the base also reflects the damage, local and server agree and the overlap is gone.
		expect(repository.getConflictRecovery("character-1")).toBeNull();
	});

	it("mutates nothing and marks no ids when live adoption throws", () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()});
		repository._getCoverageBook("character-1").live.revision = 1;

		const result = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: makeCharacterData(),
			fnAdoptLive: () => { throw new Error("render exploded"); },
		});

		expect(result.status).toBe("blocked");
		expect(repository._accepted.get("character-1").revision).toBe(1);
		expect(repository._accepted.get("character-1").data.hp.current).toBe(10);

		// Because ids are only marked after commit, an identical retry still applies.
		let adopted = null;
		const retry = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			liveData: makeCharacterData(),
			fnAdoptLive: next => { adopted = next; },
		});
		expect(retry.status).toBe("applied");
		expect(adopted.hp.current).toBe(6);
		expect(repository._accepted.get("character-1").revision).toBe(2);
	});

	it("serializes an operation behind an in-flight save and applies it exactly once", async () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});

		const order = [];
		let releasePatch;
		const gate = new Promise(resolve => { releasePatch = resolve; });
		api.pPatchCharacter.mockImplementationOnce(async () => {
			await gate;
			order.push("save");
			return {character: {id: "character-1", campaignId: "campaign-1", revision: 2, data: makeCharacterData({name: "Renamed"})}};
		});

		const pSave = repository.pUpsert({character: {...makeCharacterData({name: "Renamed"}), id: "character-1"}});
		const pDelivery = repository.pEnqueueRealtimeDelivery({
			characterId: "character-1",
			fnDeliver: () => { order.push("operation"); return true; },
		});

		await new Promise(resolve => setImmediate(resolve));
		releasePatch();
		await pSave;
		await pDelivery;
		expect(order).toEqual(["save", "operation"]);
	});
});

describe("Repository resync recovery", () => {
	const setupGap = async () => {
		const api = makeApi({
			character: {id: "character-1", campaignId: "campaign-1", revision: 3, data: makeCharacterData({current: 3})},
			events: [
				makeAppliedEvent({operationId: "operation-1", sequence: 20, revision: 2, args: {amount: 4}, id: "event-1"}),
				makeAppliedEvent({operationId: "operation-2", sequence: 21, revision: 3, args: {amount: 3}, id: "event-2"}),
			],
		});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});
		// Force a coverage gap: live is two operations behind canonical.
		repository._getCoverageBook("character-1").live.revision = 1;

		const result = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation({operationId: "operation-2", args: {amount: 3}}),
			resultingCharacterRevision: 3,
			eventId: "event-2",
			sequence: 21,
			liveData: makeCharacterData(),
			fnAdoptLive: () => {},
		});
		expect(result.status).toBe("resync_required");
		return {api, repository};
	};

	it("replays only the missing operations in revision order and unblocks saving", async () => {
		const {api, repository} = await setupGap();
		let live = makeCharacterData();

		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => live,
			fnAdoptLive: next => { live = next; },
		});

		expect(result.status).toBe("recovered");
		expect(api.pListEventPage).toHaveBeenCalled();
		// 10 - 4 - 3 = 3, matching canonical truth without double counting.
		expect(live.hp.current).toBe(3);
		expect(repository._accepted.get("character-1").revision).toBe(3);
		expect(repository.isSaveBlocked("character-1")).toBe(false);
		expect(repository.hasPendingResync("character-1")).toBe(false);
	});

	it("keeps saving blocked and mutates nothing when canonical truth cannot be fetched", async () => {
		const {api, repository} = await setupGap();
		api.pGetCharacter.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_ERROR"}));

		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => makeCharacterData(),
			fnAdoptLive: () => { throw new Error("must not adopt after a failed fetch"); },
		});

		expect(result.status).toBe("failed");
		expect(repository.isSaveBlocked("character-1")).toBe(true);
		expect(repository.hasPendingResync("character-1")).toBe(true);
	});

	it("refuses to guess when the required history is no longer retained", async () => {
		const {api, repository} = await setupGap();
		api.pListEventPage.mockResolvedValueOnce({events: [], replay: {scannedThroughSequence: 0, hasMore: true}});

		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => makeCharacterData(),
			fnAdoptLive: () => { throw new Error("must not adopt without provable history"); },
		});

		expect(result.status).toBe("history_unavailable");
		expect(repository.isSaveBlocked("character-1")).toBe(true);
	});

	it("fences a recovery whose character is no longer open", async () => {
		const {repository} = await setupGap();
		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => makeCharacterData(),
			fnAdoptLive: () => { throw new Error("must not adopt after teardown"); },
			fnIsCurrent: () => false,
		});
		expect(result.status).toBe("fenced");
	});

	it("forgets pending reconciliation state on teardown", async () => {
		const {repository} = await setupGap();
		repository.clearRealtimeReconciliation({characterId: "character-1"});
		expect(repository.hasPendingResync("character-1")).toBe(false);
		expect(repository.isSaveBlocked("character-1")).toBe(false);
	});
});

describe("Failed save followed by a live effect", () => {
	it("keeps applying effects after a mid-session save failure instead of demanding a reload", async () => {
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});

		// A transient failure leaves a recovered local snapshot behind.
		api.pPatchCharacter.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_ERROR"}));
		await expect(repository.pUpsert({character: {...makeCharacterData({name: "Renamed"}), id: "character-1"}}))
			.rejects.toMatchObject({code: "NETWORK_ERROR"});
		expect(repository._failedWrites.has("character-1")).toBe(true);

		let adopted = null;
		const result = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			sequence: 20,
			liveData: makeCharacterData({name: "Renamed"}),
			fnAdoptLive: next => { adopted = next; },
		});

		// The recovered snapshot's coverage is known, so the effect applies rather than cascading to a resync.
		expect(result.status).toBe("applied");
		expect(adopted).toMatchObject({name: "Renamed", hp: {current: 6}});
		expect(repository.isSaveBlocked("character-1")).toBe(false);
		// The pending local snapshot is carried forward too, so retrying the save cannot undo the effect.
		expect(repository._failedWrites.get("character-1").hp.current).toBe(6);
	});
});

describe("Recovery storage stays consistent with its coverage", () => {
	const pSetUpFailedWriteThenOperation = async () => {
		const sessionStorage = makeSessionStorage();
		const api = makeApi({character: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData()}});
		const repository = makeRepository({api, sessionStorage});
		await repository.pGet({characterId: "character-1"});

		api.pPatchCharacter.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_ERROR"}));
		await expect(repository.pUpsert({character: {...makeCharacterData({name: "Renamed"}), id: "character-1"}}))
			.rejects.toMatchObject({code: "NETWORK_ERROR"});

		repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation(),
			resultingCharacterRevision: 2,
			eventId: "event-1",
			sequence: 20,
			liveData: makeCharacterData(),
			fnAdoptLive: () => {},
		});
		api.state.character = {id: "character-1", campaignId: "campaign-1", revision: 2, data: makeCharacterData({current: 6})};
		return {api, repository, sessionStorage};
	};

	it("does not leave a reload trusting pre-operation data as already reconciled", async () => {
		const {api, sessionStorage} = await pSetUpFailedWriteThenOperation();

		// Simulate a tab refresh: sessionStorage survives, in-memory tracks do not.
		const reloaded = makeRepository({api, sessionStorage});
		const draft = await reloaded.pGet({characterId: "character-1"});

		const book = reloaded._getCoverageBook("character-1");
		// Coverage claims the operation is folded in, so the persisted draft must actually contain it.
		expect(book.live.revision).toBe(2);
		expect(draft.hp.current).toBe(6);
	});

	it("keeps applying later effects correctly after a reload that followed a failed write", async () => {
		const {api, sessionStorage} = await pSetUpFailedWriteThenOperation();
		const reloaded = makeRepository({api, sessionStorage});
		let live = await reloaded.pGet({characterId: "character-1"});

		const result = reloaded.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation({operationId: "operation-2", args: {amount: 3}}),
			resultingCharacterRevision: 3,
			eventId: "event-2",
			sequence: 21,
			liveData: live,
			fnAdoptLive: next => { live = next; },
		});

		// 10 - 4 - 3 = 3. Anything else means the first operation was silently dropped on reload.
		expect(result.status).toBe("applied");
		expect(live.hp.current).toBe(3);
	});
});

describe("Resync batch atomicity", () => {
	// Canonical is at revision 3 having applied op1 (4 damage) and op2 (3 damage); live is still at revision 1
	// with 10 hit points, so a correct recovery must bring it to 3.
	const pSetUpGapWithHistory = async () => {
		const api = makeApi({
			character: {id: "character-1", campaignId: "campaign-1", revision: 3, data: makeCharacterData({current: 3})},
			events: [
				makeAppliedEvent({operationId: "operation-1", sequence: 20, revision: 2, args: {amount: 4}, id: "event-1"}),
				makeAppliedEvent({operationId: "operation-2", sequence: 21, revision: 3, args: {amount: 3}, id: "event-2"}),
			],
		});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});
		repository._getCoverageBook("character-1").live.revision = 1;

		const queued = repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation({operationId: "operation-2", args: {amount: 3}}),
			resultingCharacterRevision: 3,
			eventId: "event-2",
			sequence: 21,
			liveData: makeCharacterData(),
			fnAdoptLive: () => {},
		});
		expect(queued.status).toBe("resync_required");
		return {api, repository};
	};

	it("applies every operation exactly once when a first adoption throws and the retry succeeds", async () => {
		const {repository} = await pSetUpGapWithHistory();
		let live = makeCharacterData();

		const failed = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => live,
			fnAdoptLive: () => { throw new Error("render exploded"); },
		});
		expect(failed).toMatchObject({status: "failed", error: {code: "LIVE_ADOPTION_FAILED"}});

		// A failed adoption must leave the batch replayable, not mark it as already covered.
		expect(repository._getCoverageBook("character-1").live.revision).toBe(1);
		expect(repository.isSaveBlocked("character-1")).toBe(true);
		expect(repository.hasPendingResync("character-1")).toBe(true);

		const recovered = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => live,
			fnAdoptLive: next => { live = next; },
		});

		expect(recovered.status).toBe("recovered");
		// 10 - 4 - 3 = 3: both operations applied exactly once.
		expect(live.hp.current).toBe(3);
		expect(recovered.appliedEffects.map(({operation, beforeData, afterData}) => ({
			operationId: operation.operationId,
			before: beforeData.hp.current,
			after: afterData.hp.current,
		}))).toEqual([
			{operationId: "operation-1", before: 10, after: 6},
			{operationId: "operation-2", before: 6, after: 3},
		]);
		expect(repository.isSaveBlocked("character-1")).toBe(false);
		expect(repository.hasPendingResync("character-1")).toBe(false);
	});

	it("commits nothing when a later replay entry cannot be reconciled", async () => {
		const {api, repository} = await pSetUpGapWithHistory();
		// A third operation whose revision leaves an unbridgeable gap after the replayable ones.
		api.state.events.push(makeAppliedEvent({operationId: "operation-3", sequence: 22, revision: 9, args: {amount: 2}, id: "event-3"}));

		const acceptedBefore = structuredClone(repository._accepted.get("character-1"));
		const liveCoverageBefore = repository._getCoverageBook("character-1").live.revision;

		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => makeCharacterData(),
			fnAdoptLive: () => { throw new Error("must not adopt a partially reconciled batch"); },
		});

		expect(result.status).toBe("history_unavailable");
		// The earlier, individually replayable operations must not have been committed on their own.
		expect(repository._accepted.get("character-1")).toEqual(acceptedBefore);
		expect(repository._getCoverageBook("character-1").live.revision).toBe(liveCoverageBefore);
		expect(repository._appliedOperationIds.get("character-1")?.has("operation-1")).toBeFalsy();
		expect(repository.isSaveBlocked("character-1")).toBe(true);
		expect(repository.hasPendingResync("character-1")).toBe(true);
	});
});

describe("Conflict candidates after a resync", () => {
	// A persistent `/name` overlap keeps the conflict open while the batch advances the server candidate's
	// hit points, so the resolved document must carry a revision that matches the data it now holds.
	const pSetUpConflictAcrossResync = async () => {
		const api = makeApi({
			character: {id: "character-1", campaignId: "campaign-1", revision: 3, data: makeCharacterData({current: 3, name: "Server"})},
			events: [
				makeAppliedEvent({operationId: "operation-1", sequence: 20, revision: 2, args: {amount: 4}, id: "event-1"}),
				makeAppliedEvent({operationId: "operation-2", sequence: 21, revision: 3, args: {amount: 3}, id: "event-2"}),
			],
		});
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});
		repository._getCoverageBook("character-1").live.revision = 1;

		const coverageAtRevisionOne = {revision: 1, acceptedSequence: null, appliedOperationIds: []};
		repository._conflicts.set("character-1", {
			base: makeCharacterData({name: "Base"}),
			local: makeCharacterData({name: "Local"}),
			server: makeCharacterData({name: "Server"}),
			serverDocument: {id: "character-1", campaignId: "campaign-1", revision: 1, data: makeCharacterData({name: "Server"})},
			conflicts: [{localPath: "/name", remotePath: "/name"}],
			coverage: {base: coverageAtRevisionOne, local: coverageAtRevisionOne, server: coverageAtRevisionOne},
		});

		repository.applyRealtimeOperation({
			characterId: "character-1",
			operation: makeOperation({operationId: "operation-2", args: {amount: 3}}),
			resultingCharacterRevision: 3,
			eventId: "event-2",
			sequence: 21,
			liveData: makeCharacterData(),
			fnAdoptLive: () => {},
		});

		const recovered = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => makeCharacterData(),
			fnAdoptLive: () => {},
		});
		expect(recovered.status).toBe("recovered");
		return {api, repository};
	};

	it("keeps the resolvable server document's revision in step with the data it now holds", async () => {
		const {repository} = await pSetUpConflictAcrossResync();
		const conflict = repository.getConflictRecovery("character-1");

		// The unrelated `/name` overlap survives, so the conflict is still awaiting a choice.
		expect(conflict).toBeTruthy();
		expect(conflict.server.hp.current).toBe(3);
		expect(conflict.serverDocument.data.hp.current).toBe(3);
		// Data and revision must agree, or the resolved document seeds accepted truth with stale fencing.
		expect(conflict.serverDocument.revision).toBe(3);
		expect(conflict.coverage.server.revision).toBe(3);
	});

	it("installs a coherent accepted base when the conflict resolves to the server version", async () => {
		const {repository} = await pSetUpConflictAcrossResync();

		const resolved = await repository.pResolveConflict({characterId: "character-1", choice: "server"});

		expect(resolved.hp.current).toBe(3);
		const accepted = repository._accepted.get("character-1");
		expect(accepted.data.hp.current).toBe(3);
		expect(accepted.revision).toBe(3);
	});
});
