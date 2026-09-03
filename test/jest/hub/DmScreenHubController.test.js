import {DmScreenHubController} from "../../../js/dmscreen/dmscreen-hub-controller.js";

class Observable {
	constructor () {
		this._listeners = new Map();
	}

	on (type, listener) {
		const listeners = this._listeners.get(type) || new Set();
		listeners.add(listener);
		this._listeners.set(type, listeners);
		return () => listeners.delete(listener);
	}

	emit (type, value) {
		for (const listener of this._listeners.get(type) || []) listener(value);
	}
}

describe("campaign DM Screen controller", () => {
	it("opens only active campaigns for DMs and co-DMs", async () => {
		const getController = campaign => new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => campaign,
			},
			document: null,
		});

		const dm = getController({name: "Ashen March", status: "active", role: "dm"});
		await expect(dm.pLoadCampaign()).resolves.toEqual(expect.objectContaining({name: "Ashen March"}));
		expect(dm.getState().access).toBe("ready");

		const player = getController({name: "Ashen March", status: "active", role: "player"});
		await expect(player.pLoadCampaign()).resolves.toBeNull();
		expect(player.getState()).toEqual(expect.objectContaining({
			access: "permission_denied",
			sync: "stopped",
		}));

		const archived = getController({name: "Ashen March", status: "archived", role: "dm"});
		await expect(archived.pLoadCampaign()).resolves.toBeNull();
		expect(archived.getState().access).toBe("archived");
	});

	it("publishes live, reconnecting, and stale projection states to the Board", async () => {
		const timers = [];
		const realtime = new Observable();
		const repository = {
			onStatus: listener => {
				listener({state: "ready"});
				return () => {};
			},
		};
		const events = [];
		const board = {fireBoardEvent: event => events.push(event)};
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({
					name: "Ashen March",
					status: "active",
					role: "co_dm",
					membershipId: "membership-1",
				}),
			},
			document: null,
			staleAfterMs: 10,
			fnSetTimeout: fn => {
				timers.push(fn);
				return timers.length;
			},
			fnClearTimeout: () => {},
		});
		await controller.pLoadCampaign();
		controller.attach({board, repository, realtime});
		controller.applySnapshot({characters: [{id: "character-1"}]});
		expect(controller.getState()).toEqual(expect.objectContaining({
			sync: "live",
			linkedCharacterCount: 1,
		}));
		expect(events).toContainEqual({
			type: "hubCharacterProjections",
			payload: {characters: [{id: "character-1"}], roster: []},
		});

		realtime.emit("state", {state: "reconnecting"});
		expect(controller.getState().sync).toBe("reconnecting");
		realtime.emit("state", {state: "reconnecting"});
		expect(timers).toHaveLength(1);
		timers.at(-1)();
		expect(controller.getState().sync).toBe("stale");
		realtime.emit("state", {state: "reconnecting"});
		expect(controller.getState().sync).toBe("stale");
		expect(events.at(-1)).toEqual(expect.objectContaining({
			type: "hubCampaignStatus",
			payload: expect.objectContaining({sync: "stale"}),
		}));
	});

	it("schedules a coalesced refetch with browser-safe timers", async () => {
		const {DmScreenHubController} = await import("../../../js/dmscreen/dmscreen-hub-controller.js");
		let fetchCount = 0;
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({name: "Ashen March", status: "active", role: "dm"}),
				pListCampaignCharacterProjections: async () => {
					fetchCount++;
					return {projections: [], roster: []};
				},
			},
			document: null,
		});
		await controller.pLoadCampaign();
		const realtime = new Observable();
		controller.attach({board: {fireBoardEvent: () => {}}, repository: null, realtime});

		// Default timers must be callable as controller methods: an unbound
		// `globalThis.setTimeout` throws "Illegal invocation" in a browser, which would
		// abort the realtime handler that dispatched this listener.
		expect(() => realtime.emit("cursor", {cursor: {lastSequence: 1}, characterRefs: []})).not.toThrow();
		await new Promise(resolve => setTimeout(resolve, 250));
		expect(fetchCount).toBeGreaterThan(0);
	});

	it("closes projections when the current co-DM is demoted", async () => {
		const realtime = new Observable();
		const events = [];
		let surfaceRoleLossCount = 0;
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({
					name: "Ashen March",
					status: "active",
					role: "co_dm",
					membershipId: "membership-1",
				}),
			},
			document: null,
			fnOnSurfaceRoleLoss: () => surfaceRoleLossCount++,
		});
		await controller.pLoadCampaign();
		controller.attach({
			board: {fireBoardEvent: event => events.push(event)},
			repository: null,
			realtime,
		});
		controller.applySnapshot({characters: [{id: "character-1"}]});
		realtime.emit("event", {
			type: "membership.role_changed",
			aggregateId: "membership-1",
			payload: {role: "player"},
		});

		expect(controller.getState().access).toBe("permission_denied");
		expect(events).toContainEqual({
			type: "hubCharacterProjections",
			payload: {characters: [], roster: []},
		});
		expect(surfaceRoleLossCount).toBe(1);
	});

	it("reports authoritative campaign archival for selection clearing and full teardown", async () => {
		const realtime = new Observable();
		const accessLossCodes = [];
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({
					name: "Ashen March",
					status: "active",
					role: "dm",
				}),
			},
			document: null,
			fnOnCampaignAccessLoss: ({campaignId, code}) => accessLossCodes.push({campaignId, code}),
		});
		await controller.pLoadCampaign();
		controller.attach({board: {fireBoardEvent: () => {}}, repository: null, realtime});

		realtime.emit("event", {type: "campaign.archived"});

		expect(controller.getState().access).toBe("archived");
		expect(accessLossCodes).toEqual([{campaignId: "campaign-1", code: "CAMPAIGN_ARCHIVED"}]);
	});

	it("requests a fresh authoritative projection after character-changing events", async () => {
		const realtime = new Observable();
		const timers = new Map();
		let nextTimerId = 0;
		let fetchCount = 0;
		let requestResyncCount = 0;
		realtime.requestResync = () => requestResyncCount++;
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({
					name: "Ashen March",
					status: "active",
					role: "dm",
				}),
				pListCampaignCharacterProjections: async () => {
					fetchCount++;
					return {projections: [], roster: []};
				},
			},
			document: null,
			fnSetTimeout: fn => {
				const id = ++nextTimerId;
				timers.set(id, fn);
				return id;
			},
			fnClearTimeout: id => timers.delete(id),
		});
		await controller.pLoadCampaign();
		controller.attach({
			board: {fireBoardEvent: () => {}},
			repository: null,
			realtime,
		});

		realtime.emit("event", {type: "roll.logged"});
		expect(fetchCount).toBe(0);
		realtime.emit("event", {type: "character.projection.invalidated", payload: {projectionRevision: 4}});
		realtime.emit("event", {type: "item.granted"});
		realtime.emit("event", {type: "transfer.committed"});
		// Repeated invalidations coalesce into a single scoped refetch.
		expect(fetchCount).toBe(0);
		expect(timers.size).toBe(1);
		timers.values().next().value();
		await new Promise(resolve => setImmediate(resolve));
		expect(fetchCount).toBe(1);
		// ADR 0011: projections come from the HTTP projector, never from a socket resync.
		expect(requestResyncCount).toBe(0);
	});
});
