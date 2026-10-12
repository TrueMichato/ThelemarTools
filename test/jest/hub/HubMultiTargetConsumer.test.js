import {jest} from "@jest/globals";
import {getCharacterOperationRouting} from "../../../js/hub/hub-character-operation-events.js";
import {createCoverage, planOperationLeg, serializeCoverage} from "../../../js/hub/hub-character-operation-reconciler.js";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";

const data = () => ({name: "Owner", hp: {current: 5, max: 20}, conditions: []});
const operation = () => ({operationId: "multi-1", targetCharacterId: "character-1", kind: "hp.heal", version: 1, arguments: {amount: 4}});
const envelope = ({legId = "leg-1", revision = 2, changed = true, sequence = 20} = {}) => ({
	id: `event-${legId}`,
	campaignId: "campaign-1",
	sequence,
	type: "character.multi_operation.target_applied",
	aggregateType: "character",
	aggregateId: "character-1",
	aggregateRevision: revision,
	payload: {operationId: "multi-1", legId, leg: "target", operation: operation(), resultingCharacterRevision: revision, changed},
});
const makeStorage = () => {
	const rows = new Map();
	return {rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)), removeItem: key => rows.delete(key)};
};
const makeRepository = ({api = {}, storage = makeStorage()} = {}) => {
	const previous = globalThis.sessionStorage;
	globalThis.sessionStorage = storage;
	const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api, broadcastSync: null});
	globalThis.sessionStorage = previous;
	repository._session = {signedIn: true, account: {id: "owner-1"}};
	return repository;
};

describe("Reviewed multi-target consumer contract", () => {
	it("routes an authorized target leg without collapsing other legs in the same operation", () => {
		const first = getCharacterOperationRouting(envelope());
		const second = getCharacterOperationRouting(envelope({legId: "leg-2"}));
		expect(first).toMatchObject({characterId: "character-1", legId: "leg-1", status: "applied"});
		expect(second.operationLegKey).not.toBe(first.operationLegKey);
		expect(first.payload.operation).toEqual(operation());
	});

	it("treats source-visible redacted target envelopes as lifecycle-only notifications", () => {
		const event = envelope();
		event.aggregateType = "semantic_operation";
		event.aggregateId = "multi-1";
		event.aggregateRevision = null;
		delete event.payload.operation.targetCharacterId;
		delete event.payload.resultingCharacterRevision;
		delete event.payload.changed;
		expect(getCharacterOperationRouting(event)).toMatchObject({characterId: null, leg: null, status: "refresh", operationId: "multi-1"});
	});

	it("routes the real revisionless WS envelope with omitted resulting revision", () => {
		const event = envelope({revision: null, changed: false});
		delete event.payload.resultingCharacterRevision;
		expect(getCharacterOperationRouting(event)).toMatchObject({legId: "leg-1", payload: {changed: false, resultingCharacterRevision: null}});
	});

	it("plans a revisionless no-op as exact-leg coverage without touching dirty bytes or revision/sequence", () => {
		const tracks = {accepted: {data: data(), coverage: createCoverage({revision: 1, acceptedSequence: 10})}, live: {data: data(), coverage: createCoverage({revision: 1, acceptedSequence: 10})}};
		const before = JSON.stringify(tracks);
		const result = planOperationLeg({tracks, leg: "target", legId: "noop-leg", operation: operation(), resultingCharacterRevision: null, changed: false});
		expect(result).toMatchObject({status: "coverage_only", revisionNext: null, staged: {}, changedTracks: {}});
		expect(JSON.stringify(tracks)).toBe(before);
	});

	it("records a no-op across every track without skipping an earlier unseen changed leg", () => {
		const repository = makeRepository();
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: data()});
		const book = repository._getCoverageBook("character-1");
		book.live.revision = 1;
		book.latestSubmitted.revision = 1;
		book.recoveredBase.revision = 1;
		book.failedWrite.revision = 1;
		repository._latestSubmitted.set("character-1", data());
		repository._recoveredBases.set("character-1", data());
		repository._failedWrites.set("character-1", {...data(), id: "character-1"});
		const adopt = jest.fn();
		const deliver = ({legId, revision, changed, sequence}) => repository.applyRealtimeOperation({
			characterId: "character-1", leg: "target", legId, operation: operation(), resultingCharacterRevision: revision, changed, sequence, eventId: `event-${legId}`, liveData: data(), fnAdoptLive: adopt,
		});
		expect(deliver({legId: "noop", revision: null, changed: false, sequence: 30}).status).toBe("coverage_only");
		expect(adopt).not.toHaveBeenCalled();
		expect(repository._realtimeCursors.get("character-1")?.operationWatermark).toBeUndefined();
		for (const name of ["live", "latestSubmitted", "recoveredBase", "failedWrite"]) {
			expect(book[name].revision).toBe(1);
			expect(book[name].acceptedSequence).toBeNull();
			expect(book[name].appliedOperationLegIds.toArray()).toContain("multi-1/target/noop");
		}
		expect(deliver({legId: "noop", revision: null, changed: false, sequence: 30}).status).toBe("suppressed");
		expect(deliver({legId: "changed", revision: 2, changed: true, sequence: 20}).status).toBe("applied");
		expect(adopt).toHaveBeenCalledTimes(1);
		expect(repository._accepted.get("character-1").data.hp.current).toBe(9);
	});

	it("does not let legacy same-operation coverage suppress an unrelated multi leg", () => {
		const coverage = createCoverage({revision: 1, appliedOperationIds: ["multi-1"]});
		expect(planOperationLeg({tracks: {live: {data: data(), coverage}}, leg: "target", legId: "new-leg", operation: operation(), resultingCharacterRevision: 2}).status).toBe("applied");
	});

	it("durably suppresses a revisionless no-op on a fresh repository with no pending save", () => {
		const storage = makeStorage();
		const deliver = repository => {
			repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: data()});
			repository._getCoverageBook("character-1").live.revision = 1;
			return repository.applyRealtimeOperation({characterId: "character-1", leg: "target", legId: "noop", operation: operation(), changed: false, resultingCharacterRevision: null, liveData: data(), sequence: 30, eventId: "noop-event"});
		};
		expect(deliver(makeRepository({storage})).status).toBe("coverage_only");
		expect(deliver(makeRepository({storage})).status).toBe("suppressed");
	});

	it("blocks adoption and saving explicitly when retained no-op coverage is corrupt", () => {
		const storage = makeStorage();
		const repository = makeRepository({storage});
		storage.setItem(repository._getRevisionlessCoverageKey("character-1"), "{invalid");
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 1, data: data()});
		const adopt = jest.fn();
		expect(repository.applyRealtimeOperation({
			characterId: "character-1",
			leg: "target",
			legId: "noop",
			operation: operation(),
			changed: false,
			resultingCharacterRevision: null,
			liveData: data(),
			fnAdoptLive: adopt,
		})).toMatchObject({status: "blocked", error: {code: "CHARACTER_RECOVERY_STORAGE_INVALID"}});
		expect(adopt).not.toHaveBeenCalled();
		expect(repository.getSaveBlock("character-1")).toMatchObject({code: "CHARACTER_RECOVERY_STORAGE_INVALID"});
	});

	it.each([false, true])("stages every durable command base/snapshot and conflict track atomically; storage failure=%s", async failStorage => {
		const storage = makeStorage();
		const api = {
			pGetSession: jest.fn(async () => ({signedIn: true, account: {id: "owner-1"}})),
			pGetCharacter: jest.fn(async () => ({id: "character-1", campaignId: "campaign-1", revision: 1, data: data()})),
			pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
			pPatchCharacter: jest.fn(async () => { throw Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}); }),
		};
		const repository = makeRepository({api, storage});
		await repository.pGet({characterId: "character-1"});
		for (const current of [4, 3]) {
			await expect(repository.pUpsert({character: {...data(), id: "character-1", hp: {current, max: 20}}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		const queueBefore = repository._recoveryCommandQueues.get("character-1").map(command => JSON.stringify([command.submittedBase, command.submittedSnapshot]));
		const coverage = serializeCoverage(createCoverage({revision: 1}));
		const conflict = {base: data(), local: data(), server: data(), coverage: {base: coverage, local: coverage, server: coverage}};
		repository._conflicts.set("character-1", structuredClone(conflict));
		repository._liveConflicts.set("character-1", structuredClone(conflict));
		if (failStorage) storage.setItem = () => { throw new Error("storage failed"); };
		const adopt = jest.fn();
		const result = repository.applyRealtimeOperation({characterId: "character-1", leg: "target", legId: "noop", operation: operation(), changed: false, resultingCharacterRevision: null, liveData: data(), sequence: 30, eventId: "noop-event", fnAdoptLive: adopt});
		expect(adopt).not.toHaveBeenCalled();
		expect(repository._recoveryCommandQueues.get("character-1").map(command => JSON.stringify([command.submittedBase, command.submittedSnapshot]))).toEqual(queueBefore);
		if (failStorage) {
			expect(result.status).toBe("blocked");
			expect(repository._getCoverageBook("character-1").acceptedOperationLegIds.has("multi-1/target/noop")).toBe(false);
			expect(repository._conflicts.get("character-1")).toEqual(conflict);
			return;
		}
		expect(result.status).toBe("coverage_only");
		for (const command of repository._recoveryCommandQueues.get("character-1")) {
			for (const field of ["submittedBaseCoverage", "submittedSnapshotCoverage"]) {
				expect(command[field].appliedOperationLegIds.has("multi-1/target/noop")).toBe(true);
				expect(command[field].revision).toBe(1);
			}
		}
		for (const store of [repository._conflicts, repository._liveConflicts]) {
			for (const part of ["base", "local", "server"]) expect(store.get("character-1").coverage[part].appliedOperationLegIds).toContain("multi-1/target/noop");
		}
		const reloaded = makeRepository({api, storage});
		await reloaded.pGet({characterId: "character-1"});
		for (const command of reloaded._recoveryCommandQueues.get("character-1")) {
			expect(command.submittedBaseCoverage.appliedOperationLegIds.has("multi-1/target/noop")).toBe(true);
			expect(command.submittedSnapshotCoverage.appliedOperationLegIds.has("multi-1/target/noop")).toBe(true);
		}
	});

	it("rolls back both durable command storage and no-op journal when a mixed ordered resync cannot adopt live state", async () => {
		const storage = makeStorage();
		let revision = 1;
		const api = {
			pGetSession: jest.fn(async () => ({signedIn: true, account: {id: "owner-1"}})),
			pGetCharacter: jest.fn(async () => ({id: "character-1", campaignId: "campaign-1", revision, data: {...data(), hp: {current: revision === 3 ? 13 : 5, max: 20}}})),
			pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
			pPatchCharacter: jest.fn(async () => { throw Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}); }),
			pListEventPage: jest.fn(async () => ({events: [
				envelope({legId: "changed-one", revision: 2, sequence: 20}),
				envelope({legId: "changed-two", revision: 3, sequence: 21}),
				envelope({legId: "noop", revision: null, changed: false, sequence: 22}),
			],
			replay: {scannedThroughSequence: 22, hasMore: false}})),
		};
		const repository = makeRepository({api, storage});
		await repository.pGet({characterId: "character-1"});
		for (const current of [4, 3]) {
			await expect(repository.pUpsert({character: {...data(), id: "character-1", hp: {current, max: 20}}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		const documentsBefore = JSON.stringify(repository._recoveryCommandQueues.get("character-1"));
		const storageBefore = [...storage.rows];
		const live = {...data(), hp: {current: 3, max: 20}};
		expect(repository.applyRealtimeOperation({
			characterId: "character-1",
			leg: "target",
			legId: "changed-two",
			operation: operation(),
			changed: true,
			resultingCharacterRevision: 3,
			sequence: 21,
			eventId: "event-changed-two",
			liveData: live,
		}).status).toBe("resync_required");
		revision = 3;
		const result = await repository.pRunPendingResync({
			characterId: "character-1",
			fnGetLiveData: () => live,
			fnAdoptLive: () => { throw new Error("live adoption failed"); },
		});
		expect(result).toMatchObject({status: "failed", error: {code: "LIVE_ADOPTION_FAILED"}});
		expect(JSON.stringify(repository._recoveryCommandQueues.get("character-1"))).toBe(documentsBefore);
		expect([...storage.rows]).toEqual(storageBefore);
		expect(repository._getCoverageBook("character-1").acceptedOperationLegIds.has("multi-1/target/noop")).toBe(false);
	});

	it("replays below a known live watermark when an older submitted track has no sequence coverage", async () => {
		const events = [envelope({legId: "older", revision: 2, sequence: 20}), envelope({legId: "current", revision: 3, sequence: 50})];
		const api = {
			pGetCharacter: jest.fn(async () => ({id: "character-1", campaignId: "campaign-1", revision: 3, data: {...data(), hp: {current: 13, max: 20}}})),
			pListEventPage: jest.fn(async ({afterSequence}) => ({
				events: events.filter(event => event.sequence > afterSequence),
				replay: {scannedThroughSequence: 50, hasMore: false},
			})),
		};
		const repository = makeRepository({api});
		const current = {...data(), hp: {current: 9, max: 20}};
		repository._accepted.set("character-1", {id: "character-1", campaignId: "campaign-1", revision: 2, data: current, operationWatermark: 40});
		const book = repository._getCoverageBook("character-1");
		book.live = createCoverage({revision: 2, acceptedSequence: 40});
		book.latestSubmitted = createCoverage({revision: 1, acceptedSequence: null});
		repository._latestSubmitted.set("character-1", data());
		repository._queuePendingResync({canonicalId: "character-1",
			envelope: {
				eventId: "event-current", sequence: 50, leg: "target", legId: "current", operation: operation(), resultingCharacterRevision: 3,
			}});
		const adopt = jest.fn();
		expect(await repository.pRunPendingResync({characterId: "character-1", fnGetLiveData: () => current, fnAdoptLive: adopt})).toMatchObject({status: "recovered"});
		expect(api.pListEventPage).toHaveBeenCalledWith({campaignId: "campaign-1", afterSequence: 0, limit: 200});
		expect(adopt).toHaveBeenCalledTimes(1);
		expect(adopt.mock.calls[0][0].hp.current).toBe(13);
		expect(repository._latestSubmitted.get("character-1").hp.current).toBe(13);
	});

	it("does not retain an unprovable settled submit after real teardown and a fresh owner document load", async () => {
		let canonical = {id: "character-1", campaignId: "campaign-1", revision: 1, data: data()};
		const api = {
			pGetCharacter: jest.fn(async () => structuredClone(canonical)),
			pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
			pPatchCharacter: jest.fn(async () => {
				canonical = {...canonical, revision: 2, data: {...data(), name: "saved edit"}};
				return {character: canonical};
			}),
		};
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});
		await repository.pUpsert({character: {...data(), name: "saved edit", id: "character-1"}});
		expect(repository._latestSubmitted.has("character-1")).toBe(true);
		repository.clearRealtimeReconciliation({characterId: "character-1"});
		canonical = {...canonical, revision: 3, data: {...canonical.data, hp: {current: 9, max: 20}}};
		const live = await repository.pGet({characterId: "character-1"});
		const adopt = jest.fn();
		expect(repository.applyRealtimeOperation({
			characterId: "character-1",
			leg: "target",
			legId: "after-return",
			operation: operation(),
			resultingCharacterRevision: 4,
			eventId: "after-return-event",
			sequence: 50,
			liveData: live,
			fnAdoptLive: adopt,
		})).toMatchObject({status: "applied"});
		expect(adopt).toHaveBeenCalledTimes(1);
		expect(adopt.mock.calls[0][0].hp.current).toBe(13);
		expect(repository._latestSubmitted.has("character-1")).toBe(false);
	});

	it("rehydrates exact unsettled submit coverage from both durable commands after teardown instead of discarding a draft", async () => {
		const api = {
			pGetCharacter: jest.fn(async () => ({id: "character-1", campaignId: "campaign-1", revision: 1, data: data()})),
			pAcquireCharacterLease: jest.fn(async () => ({epoch: 1})),
			pPatchCharacter: jest.fn(async () => { throw Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}); }),
		};
		const repository = makeRepository({api});
		await repository.pGet({characterId: "character-1"});
		for (const current of [4, 3]) {
			await expect(repository.pUpsert({character: {...data(), id: "character-1", hp: {current, max: 20}}})).rejects.toMatchObject({code: "NETWORK_UNAVAILABLE"});
		}
		repository.clearRealtimeReconciliation({characterId: "character-1"});
		const live = await repository.pGet({characterId: "character-1"});
		expect(live.hp.current).toBe(3);
		expect(repository._recoveryCommandQueues.get("character-1")).toHaveLength(2);
		expect(repository._getCoverageBook("character-1").latestSubmitted.revision).toBe(1);
		const adopt = jest.fn();
		expect(repository.applyRealtimeOperation({
			characterId: "character-1",
			leg: "target",
			legId: "after-draft-return",
			operation: operation(),
			resultingCharacterRevision: 2,
			eventId: "after-draft-return-event",
			sequence: 50,
			liveData: live,
			fnAdoptLive: adopt,
		})).toMatchObject({status: "applied"});
		expect(adopt.mock.calls[0][0].hp.current).toBe(7);
		expect(repository._recoveryCommandQueues.get("character-1").map(command => [command.submittedBase.hp.current, command.submittedSnapshot.hp.current])).toEqual([[9, 8], [8, 7]]);
	});
});
