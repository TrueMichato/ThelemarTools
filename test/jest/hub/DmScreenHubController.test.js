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

	it("retries a failed rules-context refresh when realtime returns live", async () => {
		const realtime = new Observable();
		const contexts = [];
		let contextFetchCount = 0;
		const context = {
			rulesVersion: {id: "rules-2", ruleDecision: {blocking: false}},
			brewBundle: null,
		};
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetCampaignContext: async () => {
					contextFetchCount++;
					if (contextFetchCount === 1) throw new Error("offline");
					return context;
				},
				pGetPartyInventory: async () => ({inventory: [], currency: {}}),
			},
			document: null,
			fnSetTimeout: () => 1,
			fnClearTimeout: () => {},
		});
		controller.attach({
			board: {
				fireBoardEvent: () => {},
				setHubCampaignContext: value => contexts.push(value),
			},
			repository: null,
			realtime,
		});

		realtime.emit("event", {
			type: "rules.activated",
			aggregateId: "rules-2",
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(contextFetchCount).toBe(1);
		expect(contexts).toEqual([null]);

		realtime.emit("state", {state: "reconnecting"});
		await Promise.resolve();
		expect(contextFetchCount).toBe(1);

		realtime.emit("state", {state: "live"});
		await Promise.resolve();
		await Promise.resolve();

		expect(contextFetchCount).toBe(2);
		expect(contexts).toEqual([null, context]);
	});

	it("does not let a stale refresh failure reopen a retry after a newer refresh wins", async () => {
		const realtime = new Observable();
		const contexts = [];
		const requests = [];
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetCampaignContext: () => new Promise((resolve, reject) => requests.push({resolve, reject})),
			},
			document: null,
		});
		controller.attach({
			board: {
				fireBoardEvent: () => {},
				setHubCampaignContext: value => contexts.push(value),
			},
			repository: null,
			realtime,
		});

		realtime.emit("event", {type: "rules.activated", aggregateId: "rules-1"});
		realtime.emit("event", {type: "rules.activated", aggregateId: "rules-2"});
		expect(requests).toHaveLength(2);

		const currentContext = {rulesVersion: {id: "rules-2", ruleDecision: {blocking: false}}};
		requests[1].resolve(currentContext);
		await Promise.resolve();
		await Promise.resolve();
		expect(contexts).toEqual([null, currentContext]);

		requests[0].reject(new Error("offline"));
		await Promise.resolve();
		await Promise.resolve();
		expect(contexts).toEqual([null, currentContext]);

		realtime.emit("state", {state: "live"});
		await Promise.resolve();
		expect(requests).toHaveLength(2);
	});

	it("uses resync cursor identities to replace stale rules and brew context", async () => {
		const realtime = new Observable();
		const contexts = [];
		const context = {
			rulesVersion: {id: "rules-2", ruleDecision: {blocking: false}},
			brewBundle: {id: "brew-2"},
		};
		let contextFetchCount = 0;
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetCampaignContext: async () => {
					contextFetchCount++;
					return context;
				},
			},
			document: null,
			fnSetTimeout: () => 1,
			fnClearTimeout: () => {},
		});
		controller._campaign = {
			activeRulesVersionId: "rules-2",
			activeBrewBundleVersionId: "brew-2",
		};
		controller.attach({
			board: {
				fireBoardEvent: () => {},
				getHubCampaignContext: () => ({
					rulesVersion: {id: "rules-1"},
					brewBundle: {id: "brew-1"},
				}),
				setHubCampaignContext: value => contexts.push(value),
			},
			repository: null,
			realtime,
		});

		realtime.emit("cursor", {
			cursor: {campaignId: "campaign-1", lastSequence: 4},
			campaign: {
				activeRulesVersionId: "rules-2",
				activeBrewBundleVersionId: "brew-2",
			},
			characterRefs: [],
		});
		expect(contexts).toEqual([null]);
		await Promise.resolve();
		await Promise.resolve();

		expect(contextFetchCount).toBe(1);
		expect(contexts).toEqual([null, context]);
	});

	it("refreshes through the campaign context owner so brew overlays change atomically", async () => {
		const realtime = new Observable();
		const ownerCalls = [];
		const context = {
			rulesVersion: {id: "rules-2", ruleDecision: {blocking: false}},
			brewBundle: {id: "brew-2"},
		};
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {pGetCampaignContext: () => { throw new Error("raw API bypassed context owner"); }},
			document: null,
			fnSetTimeout: () => 1,
			fnClearTimeout: () => {},
			pRefreshCampaignContext: async options => {
				ownerCalls.push(options);
				return context;
			},
		});
		controller.attach({
			board: {
				fireBoardEvent: () => {},
				setHubCampaignContext: () => {},
			},
			repository: null,
			realtime,
		});

		realtime.emit("event", {type: "brew.activated", aggregateId: "brew-2"});
		await Promise.resolve();
		await Promise.resolve();

		expect(ownerCalls).toHaveLength(1);
		expect(ownerCalls[0]).toEqual(expect.objectContaining({
			expectedBrewBundleVersionId: "brew-2",
			fnIsCurrent: expect.any(Function),
		}));
		expect(ownerCalls[0].fnIsCurrent()).toBe(true);
	});

	it("invalidates and refreshes campaign context when brew activation arrives live", async () => {
		const realtime = new Observable();
		const contexts = [];
		const context = {
			rulesVersion: {id: "rules-1", ruleDecision: {blocking: false}},
			brewBundle: {id: "brew-2"},
		};
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {pGetCampaignContext: async () => context},
			document: null,
			fnSetTimeout: () => 1,
			fnClearTimeout: () => {},
		});
		controller.attach({
			board: {
				fireBoardEvent: () => {},
				setHubCampaignContext: value => contexts.push(value),
			},
			repository: null,
			realtime,
		});

		realtime.emit("event", {type: "brew.activated", aggregateId: "brew-2"});
		expect(contexts).toEqual([null]);
		await Promise.resolve();
		await Promise.resolve();

		expect(contexts).toEqual([null, context]);
	});

	it("routes authoritative projection access loss back to the context coordinator", async () => {
		const errors = [];
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pListCampaignCharacterProjections: async () => {
					throw Object.assign(new Error("membership removed"), {code: "MEMBERSHIP_NOT_FOUND", status: 404});
				},
			},
			document: null,
			pOnAuthoritativeAccessError: async error => errors.push(error.code),
		});
		controller.attach({
			board: {fireBoardEvent: () => {}},
			repository: null,
			realtime: null,
		});

		await controller.pRefreshProjections();
		await Promise.resolve();

		expect(errors).toEqual(["MEMBERSHIP_NOT_FOUND"]);
		expect(controller.getState()).toMatchObject({access: "access_lost", sync: "stopped"});
	});

	it("routes an authoritative workspace save failure back to the context coordinator", async () => {
		const errors = [];
		let emitStatus;
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {},
			document: null,
			pOnAuthoritativeAccessError: async error => errors.push(error.code),
		});
		controller.attach({
			board: {fireBoardEvent: () => {}},
			repository: {
				onStatus: listener => {
					emitStatus = listener;
					return () => {};
				},
			},
			realtime: null,
		});

		emitStatus({
			state: "error",
			error: Object.assign(new Error("membership removed"), {code: "MEMBERSHIP_NOT_FOUND", status: 404}),
		});
		await Promise.resolve();

		expect(errors).toEqual(["MEMBERSHIP_NOT_FOUND"]);
		expect(controller.getState()).toMatchObject({access: "access_lost", sync: "stopped", workspace: "error"});
	});

	it("routes realtime access loss and archive events through coordinator teardown", async () => {
		const errors = [];
		const realtime = new Observable();
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {},
			document: null,
			pOnAuthoritativeAccessError: async error => errors.push(error.code),
		});
		controller.attach({
			board: {fireBoardEvent: () => {}},
			repository: null,
			realtime,
		});

		realtime.emit("state", {state: "access_lost"});
		realtime.emit("event", {type: "campaign.archived"});
		await Promise.resolve();

		expect(errors).toEqual(["FORBIDDEN", "CAMPAIGN_ARCHIVED"]);
		expect(controller.getState()).toMatchObject({access: "archived", sync: "stopped"});
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
		const accessErrors = [];
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
			pOnAuthoritativeAccessError: async error => accessErrors.push(error.code),
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
		await Promise.resolve();
		expect(accessErrors).toEqual(["DM_ROLE_REQUIRED"]);
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
		// Repeated invalidations coalesce into a single scoped refetch. There are two
		// independent coalescers — projections and the party stash — and `transfer.committed`
		// legitimately feeds both, so each holds at most one pending timer.
		expect(fetchCount).toBe(0);
		expect(timers.size).toBe(2);
		for (const fn of [...timers.values()]) fn();
		await new Promise(resolve => setImmediate(resolve));
		expect(fetchCount).toBe(1);
		// ADR 0011: projections come from the HTTP projector, never from a socket resync.
		expect(requestResyncCount).toBe(0);
	});
});

describe("party stash weight path", () => {
	/**
	 * `dmscreen.js` calls `pLoadCampaign()` BEFORE `attach()`, so a fetch kicked off during
	 * load has no Board to publish onto. The controller caches the summary and republishes it
	 * on attach, which makes the ordering irrelevant and handles re-attach for free.
	 */
	function getHarness ({pGetPartyInventory, fnNow} = {}) {
		const published = [];
		const timers = new Map();
		let nextTimerId = 0;
		const realtime = new Observable();
		const board = {fireBoardEvent: event => published.push(event)};
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({name: "C", status: "active", role: "dm"}),
				pListCampaignCharacterProjections: async () => ({projections: [], roster: []}),
				pGetPartyInventory: pGetPartyInventory || (async () => ({inventory: []})),
			},
			document: null,
			fnNow,
			fnSetTimeout: fn => {
				const id = ++nextTimerId;
				timers.set(id, fn);
				return id;
			},
			fnClearTimeout: id => timers.delete(id),
		});
		const getStashEvents = () => published.filter(it => it.type === "hubPartyInventory");
		return {controller, board, realtime, timers, published, getStashEvents};
	}

	const flush = () => new Promise(resolve => setImmediate(resolve));

	it("publishes a summary when the fetch resolves BEFORE attach", async () => {
		const h = getHarness({
			pGetPartyInventory: async () => ({inventory: [{quantity: 2, item: {weight: 5}}]}),
		});
		await h.controller.pLoadCampaign();
		await flush();
		// No Board yet, so nothing could have been published.
		expect(h.getStashEvents()).toHaveLength(0);

		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		expect(h.getStashEvents().at(-1).payload).toEqual(expect.objectContaining({state: "known", knownWeight: 10, stackCount: 1}));
	});

	it("publishes when the fetch resolves AFTER attach", async () => {
		let release;
		const h = getHarness({pGetPartyInventory: () => new Promise(resolve => { release = resolve; })});
		await h.controller.pLoadCampaign();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		release({inventory: [{quantity: 1, item: {weight: 7}}]});
		await flush();
		expect(h.getStashEvents().at(-1).payload).toEqual(expect.objectContaining({state: "known", knownWeight: 7}));
	});

	it("republishes the cached summary on re-attach", async () => {
		const h = getHarness({pGetPartyInventory: async () => ({inventory: [{quantity: 1, item: {weight: 3}}]})});
		await h.controller.pLoadCampaign();
		await flush();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		h.controller.detach();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		expect(h.getStashEvents().at(-1).payload).toEqual(expect.objectContaining({state: "known", knownWeight: 3}));
	});

	it("a late completion after detach() must not publish", async () => {
		let release;
		const h = getHarness({pGetPartyInventory: () => new Promise(resolve => { release = resolve; })});
		await h.controller.pLoadCampaign();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		const before = h.getStashEvents().length;

		h.controller.detach();
		release({inventory: [{quantity: 99, item: {weight: 99}}]});
		await flush();

		// The generation bumped on detach, so the in-flight response is discarded rather than
		// landing on a Board this controller no longer owns.
		expect(h.getStashEvents()).toHaveLength(before);
	});

	it("counts stacks with unusable weights instead of silently dropping them", async () => {
		const h = getHarness({
			pGetPartyInventory: async () => ({inventory: [
				{quantity: 1, item: {weight: 4}},
				{quantity: 1, item: {}},
				{quantity: "many", item: {weight: 2}},
			]}),
		});
		await h.controller.pLoadCampaign();
		await flush();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		expect(h.getStashEvents().at(-1).payload).toEqual(expect.objectContaining({knownWeight: 4, unknownStackCount: 2}));
	});

	it("a transient failure stays retryable", async () => {
		let shouldFail = true;
		const h = getHarness({
			pGetPartyInventory: async () => {
				if (shouldFail) throw Object.assign(new Error("offline"), {status: 503});
				return {inventory: [{quantity: 1, item: {weight: 8}}]};
			},
		});
		await h.controller.pLoadCampaign();
		await flush();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		expect(h.getStashEvents().at(-1).payload.state).toBe("unavailable");

		shouldFail = false;
		h.realtime.emit("event", {type: "party_inventory.invalidated"});
		for (const fn of [...h.timers.values()]) fn();
		await flush();
		expect(h.getStashEvents().at(-1).payload).toEqual(expect.objectContaining({state: "known", knownWeight: 8}));
	});

	it("authoritative access loss fences refresh until a new attach", async () => {
		let calls = 0;
		const h = getHarness({
			pGetPartyInventory: async () => {
				calls++;
				throw Object.assign(new Error("forbidden"), {status: 403});
			},
		});
		await h.controller.pLoadCampaign();
		await flush();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		// Let the attach-time refresh settle so the fence is actually in place before the
		// property under test is exercised.
		await flush();
		expect(h.getStashEvents().at(-1).payload.state).toBe("unavailable");
		const callsAfterAttach = calls;

		// Unlike a network blip there is nothing to retry: the endpoint will keep refusing
		// until authorization actually changes, which only a new verified attach can reflect.
		h.realtime.emit("event", {type: "party_inventory.invalidated"});
		for (const fn of [...h.timers.values()]) fn();
		await flush();
		expect(calls).toBe(callsAfterAttach);
	});

	it("never publishes the stash item list, only its weight", async () => {
		const h = getHarness({
			pGetPartyInventory: async () => ({inventory: [{quantity: 1, item: {name: "Crown of Secrets", weight: 2}}]}),
		});
		await h.controller.pLoadCampaign();
		await flush();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		const payload = h.getStashEvents().at(-1).payload;
		expect(Object.keys(payload).sort()).toEqual(["knownWeight", "stackCount", "state", "unknownStackCount"]);
		expect(JSON.stringify(payload)).not.toContain("Crown of Secrets");
	});
});
