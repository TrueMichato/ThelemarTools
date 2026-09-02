import "./setup.js";
import {jest} from "@jest/globals";
import {CharacterSheetRealtimeCoordinator} from "../../../js/charactersheet/charactersheet-realtime.js";

const pFlush = () => new Promise(resolve => setImmediate(resolve));

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

const makeRepository = () => ({
	pEnqueueRealtimeDelivery: jest.fn(({fnDeliver}) => Promise.resolve().then(fnDeliver)),
});

const makeCoordinator = ({campaignId = "campaign-1", isAuthenticated = true, repository = makeRepository()} = {}) => {
	const clients = [];
	const coordinator = new CharacterSheetRealtimeCoordinator({
		campaignId,
		isAuthenticated,
		repository,
		fnCreateRealtimeClient: () => {
			const client = new FakeRealtimeClient();
			clients.push(client);
			return client;
		},
	});
	return {clients, coordinator, repository};
};

const makeAppliedEvent = ({
	id = "event-applied",
	operationId = "operation-1",
	sequence = 7,
	targetCharacterId = "character-1",
} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: "character.operation.applied",
	aggregateType: "character",
	aggregateId: targetCharacterId,
	aggregateRevision: 4,
	payload: {
		operation: {
			operationId,
			kind: "hp.adjust",
			version: 1,
			targetCharacterId,
			arguments: {amount: -3},
		},
		resultingCharacterRevision: 4,
	},
});

const makeLifecycleEvent = ({
	id,
	operationId = "operation-1",
	sequence,
	status,
	targetCharacterId = "character-1",
} = {}) => ({
	id,
	campaignId: "campaign-1",
	sequence,
	type: `character.operation.${status}`,
	aggregateType: "semantic_operation",
	aggregateId: operationId,
	payload: {
		operationId,
		targetCharacterId,
		status,
		...(status === "proposed"
			? {
				sourceDisplaySnapshot: {identity: {name: "Aster"}},
				targetDisplaySnapshot: {identity: {name: "Mira"}},
				effectDisplaySnapshot: {label: "Lay on Hands"},
				expiresAt: "2030-01-01T00:00:00.000Z",
			}
			: {
				reason: "closed",
				sourceDisplaySnapshot: {identity: {name: "Aster"}},
				targetDisplaySnapshot: {identity: {name: "Mira"}},
				effectDisplaySnapshot: {label: "Lay on Hands"},
			}),
	},
});

describe("Character Sheet realtime coordinator", () => {
	it.each([
		{campaignId: null, isAuthenticated: true},
		{campaignId: "campaign-1", isAuthenticated: false},
	])("does not subscribe outside an authenticated campaign context", options => {
		const {clients, coordinator} = makeCoordinator(options);

		expect(coordinator.attach({characterId: "character-1"})).toBe(false);
		expect(clients).toHaveLength(0);
	});

	it("delivers cursor and invalidation metadata for only the open character", async () => {
		const {clients, coordinator} = makeCoordinator();
		const cursors = [];
		const invalidations = [];
		coordinator.on("cursor", value => cursors.push(value));
		coordinator.on("projectionInvalidated", value => invalidations.push(value));
		coordinator.attach({characterId: "character-1"});

		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 12},
			characterRefs: [
				{id: "other", revision: 9, projectionRevision: 5, operationWatermark: 8},
				{id: "character-1", revision: 4, projectionRevision: 2, operationWatermark: 10},
			],
		});
		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 12},
			characterRefs: [{id: "character-1", revision: 4, projectionRevision: 2, operationWatermark: 10}],
		});
		clients[0].emit("event", {
			id: "invalidation-current",
			campaignId: "campaign-1",
			sequence: 13,
			type: "character.projection.invalidated",
			aggregateType: "character",
			aggregateId: "character-1",
			aggregateRevision: 4,
			payload: {projectionRevision: 3},
		});
		clients[0].emit("event", {
			id: "invalidation-other",
			campaignId: "campaign-1",
			sequence: 14,
			type: "character.projection.invalidated",
			aggregateType: "character",
			aggregateId: "other",
			aggregateRevision: 9,
			payload: {projectionRevision: 6},
		});
		await pFlush();

		expect(cursors).toEqual([{
			campaignId: "campaign-1",
			characterId: "character-1",
			lastSequence: 12,
			revision: 4,
			projectionRevision: 2,
			operationWatermark: 10,
		}]);
		expect(invalidations).toEqual([
			expect.objectContaining({
				source: "cursor",
				characterId: "character-1",
				operationWatermark: 10,
			}),
			{
				source: "event",
				eventId: "invalidation-current",
				campaignId: "campaign-1",
				characterId: "character-1",
				sequence: 13,
				revision: 4,
				projectionRevision: 3,
			},
		]);
	});

	it("preserves the difference between an absent watermark and authoritative zero", async () => {
		const {clients, coordinator} = makeCoordinator();
		const cursors = [];
		coordinator.on("cursor", value => cursors.push(value));
		coordinator.attach({characterId: "character-1"});
		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 1},
			characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1}],
		});
		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 1},
			characterRefs: [{id: "character-1", revision: 1, projectionRevision: 1, operationWatermark: 0}],
		});
		await pFlush();

		expect(cursors).toHaveLength(2);
		expect(cursors[0]).not.toHaveProperty("operationWatermark");
		expect(cursors[1].operationWatermark).toBe(0);
	});

	it("delivers already-replayed operations before a missing character ref tears down the sheet", async () => {
		const {clients, coordinator} = makeCoordinator();
		const delivered = [];
		const states = [];
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.on("connectionState", value => states.push(value));
		coordinator.attach({characterId: "character-1"});

		clients[0].emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 8},
			characterRefs: [],
		});
		clients[0].emit("event", makeAppliedEvent({sequence: 7}));
		await pFlush();

		expect(delivered).toEqual([expect.objectContaining({eventId: "event-applied"})]);
		expect(clients[0].close).toHaveBeenCalledTimes(1);
		expect(states).toContainEqual({
			state: "closed",
			reason: "Character is no longer available in this campaign.",
		});
	});

	it.each(["character.archived", "character.moved_out"])("tears down on a remote %s event", async type => {
		const {clients, coordinator} = makeCoordinator();
		coordinator.attach({characterId: "character-1"});

		clients[0].emit("event", {
			id: `event-${type}`,
			campaignId: "campaign-1",
			sequence: 9,
			type,
			aggregateType: "character",
			aggregateId: "character-1",
		});
		await pFlush();

		expect(clients[0].close).toHaveBeenCalledTimes(1);
	});

	it("suspends and resumes the same client without resetting its delivery generation", async () => {
		const {clients, coordinator} = makeCoordinator();
		const delivered = [];
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.attach({characterId: "character-1"});

		expect(coordinator.suspend()).toBe(true);
		expect(clients[0].suspend).toHaveBeenCalledTimes(1);
		expect(clients[0].close).not.toHaveBeenCalled();
		expect(coordinator.resume()).toBe(true);
		expect(clients[0].pConnect).toHaveBeenCalledTimes(2);
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(clients).toHaveLength(1);
		expect(delivered).toHaveLength(1);
	});

	it("delivers the exact lifecycle allowlist and dedupes each operation state", async () => {
		const {clients, coordinator} = makeCoordinator();
		const delivered = [];
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.attach({characterId: "character-1"});

		clients[0].emit("event", makeLifecycleEvent({id: "p", sequence: 1, status: "proposed"}));
		clients[0].emit("event", {
			...makeAppliedEvent({sequence: 2}),
			actorAccountId: "private-actor",
			payload: {
				...makeAppliedEvent({sequence: 2}).payload,
				sourceCharacterId: "must-not-pass",
				hiddenTruth: {hp: 1},
			},
		});
		clients[0].emit("event", makeLifecycleEvent({id: "r", sequence: 3, status: "rejected"}));
		clients[0].emit("event", makeLifecycleEvent({id: "c", sequence: 4, status: "cancelled"}));
		clients[0].emit("event", makeLifecycleEvent({id: "x", sequence: 5, status: "expired"}));
		clients[0].emit("event", makeLifecycleEvent({id: "duplicate-proposed", sequence: 6, status: "proposed"}));
		clients[0].emit("event", {...makeAppliedEvent({targetCharacterId: "other"}), id: "other"});
		clients[0].emit("event", {
			...makeLifecycleEvent({id: "unsupported", sequence: 8, status: "accepted"}),
			type: "character.operation.accepted",
		});
		await pFlush();

		expect(delivered.map(it => it.type)).toEqual([
			"character.operation.proposed",
			"character.operation.applied",
			"character.operation.rejected",
			"character.operation.cancelled",
			"character.operation.expired",
		]);
		expect(delivered[1]).toEqual(expect.objectContaining({
			operationId: "operation-1",
			targetCharacterId: "character-1",
			status: "applied",
			payload: expect.objectContaining({resultingCharacterRevision: 4}),
		}));
		expect(delivered[1]).not.toHaveProperty("actorAccountId");
		expect(delivered[1].payload).not.toHaveProperty("sourceCharacterId");
		expect(delivered[1].payload).not.toHaveProperty("hiddenTruth");
		expect(delivered[0].payload).toEqual({
			actionId: "operation-1",
			status: "proposed",
			expiresAt: "2030-01-01T00:00:00.000Z",
			presentation: {sourceName: "Aster", effectLabel: "Lay on Hands"},
			capabilities: {canApprove: true, canReject: true},
		});
		expect(delivered[0].payload).not.toHaveProperty("targetCharacterId");
	});

	it("fences queued delivery when a sheet is switched and reopened", async () => {
		const queued = [];
		const repository = {
			pEnqueueRealtimeDelivery: jest.fn(({fnDeliver}) => {
				queued.push(fnDeliver);
				return new Promise(() => {});
			}),
		};
		const {clients, coordinator} = makeCoordinator({repository});
		const delivered = [];
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.attach({characterId: "character-1"});
		clients[0].emit("event", makeAppliedEvent());

		coordinator.attach({characterId: "character-1"});
		expect(clients[0].close).toHaveBeenCalledTimes(1);
		expect(queued).toHaveLength(1);
		expect(queued[0]()).toBe(false);
		clients[1].emit("event", makeAppliedEvent({id: "reopened", operationId: "operation-2", sequence: 8}));
		expect(queued).toHaveLength(2);
		expect(queued[1]()).toBe(true);
		expect(delivered).toEqual([expect.objectContaining({eventId: "reopened"})]);
	});

	it("fences a delivery that was already queued when access is lost", () => {
		const queued = [];
		const repository = {
			pEnqueueRealtimeDelivery: jest.fn(({fnDeliver}) => {
				queued.push(fnDeliver);
				return new Promise(() => {});
			}),
		};
		const {clients, coordinator} = makeCoordinator({repository});
		const delivered = [];
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.attach({characterId: "character-1"});
		clients[0].emit("event", makeAppliedEvent());
		clients[0].emit("state", {state: "access_lost", code: 1008});

		expect(queued).toHaveLength(1);
		expect(queued[0]()).toBe(false);
		expect(delivered).toEqual([]);
	});

	it("tears down and fences delivery when access is lost", async () => {
		const {clients, coordinator} = makeCoordinator();
		const states = [];
		const delivered = [];
		coordinator.on("connectionState", () => { throw new Error("broken state observer"); });
		coordinator.on("connectionState", value => states.push(value));
		coordinator.on("semanticOperation", value => delivered.push(value));
		coordinator.attach({characterId: "character-1"});

		clients[0].emit("state", {state: "access_lost", code: 1008, reason: "Membership removed"});
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(states).toEqual([{state: "access_lost", code: 1008, reason: "Membership removed"}]);
		expect(clients[0].close).toHaveBeenCalledTimes(1);
		expect(delivered).toEqual([]);
		expect(coordinator.attach({characterId: "character-1"})).toBe(false);
		expect(clients).toHaveLength(1);
	});

	it("reports delivery failure without logging or retaining the event payload", async () => {
		const repository = {
			pEnqueueRealtimeDelivery: jest.fn(() => Promise.reject(new Error("queue failed"))),
		};
		const {clients, coordinator} = makeCoordinator({repository});
		const errors = [];
		coordinator.on("deliveryError", value => errors.push(value));
		coordinator.attach({characterId: "character-1"});
		clients[0].emit("event", makeAppliedEvent());
		await pFlush();

		expect(errors).toEqual([{
			characterId: "character-1",
			deliveryType: "semanticOperation",
			sequence: 7,
		}]);
		expect(JSON.stringify(errors)).not.toContain("amount");
		expect(coordinator).not.toHaveProperty("_eventQueue");
	});
});
