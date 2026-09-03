import {HubActiveCampaignCoordinator, TEARDOWN_MARKERS} from "../../../js/hub/hub-active-campaign-coordinator.js";
import {HubActiveCampaignChannel} from "../../../js/hub/hub-active-campaign-channel.js";
import {HubActiveCampaignStore} from "../../../js/hub/hub-active-campaign-store.js";
import {makeSelectedRecord} from "../../../js/hub/hub-active-campaign-record.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_B = "44444444-4444-4444-8444-444444444444";
const CAMPAIGN_C = "77777777-7777-4777-8777-777777777777";
const WRITER_A = "55555555-5555-4555-8555-555555555555";
const WRITER_B = "66666666-6666-4666-8666-666666666666";

class FakeStorage {
	constructor () { this.map = new Map(); }
	getItem (key) { return this.map.has(key) ? this.map.get(key) : null; }
	setItem (key, value) { this.map.set(key, value); }
	removeItem (key) { this.map.delete(key); }
}

class FakeTarget {
	constructor () { this.listeners = new Map(); }
	addEventListener (type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(fn);
	}
	removeEventListener (type, fn) { this.listeners.get(type)?.delete(fn); }
	countListeners (type) { return this.listeners.get(type)?.size || 0; }
}

const apiError = (code, status = 403) => Object.assign(new Error(code), {code, status});

/** Records every request so per-host budgets can be asserted exactly. */
function makeApi ({
	session = {signedIn: true, account: {id: ACCOUNT_A}},
	campaigns = {},
	contexts = {},
} = {}) {
	const calls = [];
	const api = {
		calls,
		countOf: name => calls.filter(call => call.name === name).length,
		pGetSession: async () => {
			calls.push({name: "session"});
			if (session instanceof Error) throw session;
			return session;
		},
		pGetCampaign: async ({campaignId}) => {
			calls.push({name: "campaign", campaignId});
			const value = campaigns[campaignId];
			if (value instanceof Error) throw value;
			if (!value) throw apiError("CAMPAIGN_NOT_FOUND", 404);
			return value;
		},
		pGetCampaignContext: async ({campaignId}) => {
			calls.push({name: "context", campaignId});
			const value = contexts[campaignId];
			if (value instanceof Error) throw value;
			return value || {rulesVersion: {rules: {}}, brewBundle: null};
		},
	};
	return api;
}

const activeCampaign = (id, role = "player") => ({id, status: "active", role});

function makeCoordinator ({
	api,
	host = {},
	storage = new FakeStorage(),
	target = new FakeTarget(),
	writerId = WRITER_A,
	contexts = [],
} = {}) {
	const store = new HubActiveCampaignStore({storage, locks: null, writerId, fnNow: () => Date.now(), fnDelay: async () => {}});
	const channel = new HubActiveCampaignChannel({writerId, fnCreateChannel: () => null, target});
	const created = contexts;
	const coordinator = new HubActiveCampaignCoordinator({
		api,
		host,
		store,
		channel,
		fnCreateContext: ({campaignId, context}) => {
			const instance = {
				campaignId,
				context,
				isActivated: false,
				isDisposed: false,
				pActivate: async () => { instance.isActivated = true; return context; },
				dispose: () => { instance.isDisposed = true; },
			};
			created.push(instance);
			return instance;
		},
	});
	return {coordinator, store, channel, storage, target, created};
}

describe("HubActiveCampaignCoordinator", () => {
	describe("precedence", () => {
		it("prefers the authoritative resource campaign over an explicit URL and a stored selection", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_C]: activeCampaign(CAMPAIGN_C)}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					pGetResourceCampaignId: async () => CAMPAIGN_C,
					getExplicitCampaignId: () => CAMPAIGN_B,
				},
			});
			await coordinator.pResolve();
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_C);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_C});
		});

		it("prefers an explicit URL over a stored selection", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => CAMPAIGN_B}});
			await coordinator.pResolve();
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_B);
		});

		it("falls back to an account-matching stored selection when there is no explicit candidate", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator} = makeCoordinator({api, storage});
			await coordinator.pResolve();
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.state).toBe("active");
		});

		it("preserves local mode when there is no candidate at all", async () => {
			const api = makeApi();
			const {coordinator} = makeCoordinator({api});
			await coordinator.pResolve();
			expect(coordinator.state).toBe("local");
			expect(coordinator.activeCampaignId).toBeNull();
			expect(api.countOf("campaign")).toBe(0);
			expect(api.countOf("context")).toBe(0);
		});

		it("blocks a malformed explicit candidate without falling through to the stored selection", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => "not-a-uuid"}});
			await coordinator.pResolve();
			expect(coordinator.state).toBe("blocked");
			expect(coordinator.activeCampaignId).toBeNull();
			// The stored record must survive a bad explicit navigation.
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_A});
		});
	});

	describe("request budgets", () => {
		it("issues exactly one session read plus campaign and context in parallel for a heavy host", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();

			expect(api.countOf("session")).toBe(1);
			expect(api.countOf("campaign")).toBe(1);
			expect(api.countOf("context")).toBe(1);
			expect(api.calls).toHaveLength(3);
		});

		it("never fetches the campaign context for a selection-only host", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({
				api,
				host: {isContextHost: false, getExplicitCampaignId: () => CAMPAIGN_A},
			});
			await coordinator.pResolve();

			expect(coordinator.state).toBe("active");
			expect(api.countOf("context")).toBe(0);
			expect(api.countOf("session")).toBe(1);
		});

		it("adopts an already-verified session and campaign at zero request cost", async () => {
			const api = makeApi();
			const {coordinator, store} = makeCoordinator({api});
			await coordinator.adoptVerified({
				session: {signedIn: true, account: {id: ACCOUNT_A}},
				campaign: activeCampaign(CAMPAIGN_A),
			});
			expect(api.calls).toHaveLength(0);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_A});
		});

		it("clears a matching selection when an adopted campaign turns out to be archived", async () => {
			const storage = new FakeStorage();
			const api = makeApi();
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			// `campaign.html` renders an archive read-only, but it must never stay selected.
			const {coordinator, store} = makeCoordinator({api, storage});
			const record = await coordinator.adoptVerified({
				session: {signedIn: true, account: {id: ACCOUNT_A}},
				campaign: {id: CAMPAIGN_A, status: "archived", role: "dm"},
			});

			expect(record).toBeNull();
			expect(coordinator.state).toBe("blocked");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
		});

		it("classifies a host-reported bootstrap failure so a stale selection is invalidated", async () => {
			const storage = new FakeStorage();
			const api = makeApi();
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage});
			await coordinator.pResolve({session: {signedIn: true, account: {id: ACCOUNT_A}}});
			await coordinator.pReportFailure({error: apiError("FORBIDDEN", 403), campaignId: CAMPAIGN_A});

			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
		});

		it("reuses a seeded session instead of issuing a duplicate read", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve({session: {signedIn: true, account: {id: ACCOUNT_A}}});
			expect(api.countOf("session")).toBe(0);
		});
	});

	describe("generation fencing", () => {
		it("drops a stale completion so a late A/B response cannot displace C", async () => {
			const gates = new Map();
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
				[CAMPAIGN_C]: activeCampaign(CAMPAIGN_C),
			}});
			const basePGetCampaign = api.pGetCampaign;
			api.pGetCampaign = async args => {
				const gate = gates.get(args.campaignId);
				if (gate) await gate;
				return basePGetCampaign(args);
			};

			let releaseA;
			let releaseB;
			gates.set(CAMPAIGN_A, new Promise(resolve => { releaseA = resolve; }));
			gates.set(CAMPAIGN_B, new Promise(resolve => { releaseB = resolve; }));

			const {coordinator, created} = makeCoordinator({api, host: {}});
			await coordinator.pResolve();

			const pA = coordinator.pSwitchTo({campaignId: CAMPAIGN_A});
			const pB = coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			const pC = coordinator.pSwitchTo({campaignId: CAMPAIGN_C});
			await pC;
			releaseA();
			releaseB();
			await Promise.all([pA, pB]);

			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_C);
			expect(coordinator.staleCompletionCount).toBeGreaterThan(0);
			// No stale context may remain installed.
			for (const instance of created) {
				if (instance.campaignId !== CAMPAIGN_C) expect(instance.isActivated && !instance.isDisposed).toBe(false);
			}
		});

		it("classifies an aborted request without treating it as offline", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: Object.assign(new Error("aborted"), {code: "REQUEST_ABORTED", status: 0})}});
			const {coordinator, store} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			const seeded = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
			await coordinator.pResolve();
			// A cancellation proves nothing about access, so the preference survives.
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: seeded.campaignId});
		});
	});

	describe("account boundaries", () => {
		it("never leaks another account's selection and replaces it with a tombstone", async () => {
			const storage = new FakeStorage();
			const api = makeApi({session: {signedIn: true, account: {id: ACCOUNT_B}}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage});
			await coordinator.pResolve();

			expect(coordinator.activeCampaignId).toBeNull();
			expect(store.readForAccount(ACCOUNT_A)).toBeNull();
			expect(store.readForAccount(ACCOUNT_B)).toMatchObject({state: "cleared", revision: 1});
			expect(api.countOf("campaign")).toBe(0);
		});

		it("clears a lingering selection when the session is signed out", async () => {
			const storage = new FakeStorage();
			const api = makeApi({session: {signedIn: false}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage});
			await coordinator.pResolve();
			expect(coordinator.state).toBe("signed_out");
			expect(store.read()).toMatchObject({state: "cleared", accountId: ACCOUNT_A});
		});

		it("clears a lingering selection from a seeded signed-out session without re-reading it", async () => {
			const storage = new FakeStorage();
			const api = makeApi();
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			// This is the Hub shell path: the page already knows the visitor is signed out.
			const {coordinator, store} = makeCoordinator({api, storage});
			await coordinator.pResolve({trigger: "logout", session: {signedIn: false}});

			expect(api.countOf("session")).toBe(0);
			expect(coordinator.state).toBe("signed_out");
			expect(store.read()).toMatchObject({state: "cleared", accountId: ACCOUNT_A});
		});
	});

	describe("invalidation", () => {
		it.each([
			["FORBIDDEN", apiError("FORBIDDEN", 403)],
			["CAMPAIGN_NOT_FOUND", apiError("CAMPAIGN_NOT_FOUND", 404)],
			["MEMBERSHIP_NOT_FOUND", apiError("MEMBERSHIP_NOT_FOUND", 404)],
		])("clears the matching selection and runtime state on %s", async (_label, error) => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: error}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();

			expect(coordinator.state).toBe("blocked");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
		});

		it("clears an archived campaign selection", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: {id: CAMPAIGN_A, status: "archived", role: "dm"}}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
		});

		it("does not clear a selection naming a different campaign", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_B]: apiError("FORBIDDEN", 403)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => CAMPAIGN_B}});
			await coordinator.pResolve();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_A, state: "selected"});
		});

		it("retains the selection on a transient network or 5xx failure", async () => {
			for (const error of [apiError("NETWORK_UNAVAILABLE", 0), apiError("REQUEST_FAILED", 503)]) {
				const storage = new FakeStorage();
				const api = makeApi({campaigns: {[CAMPAIGN_A]: error}});
				const seed = makeCoordinator({api, storage});
				await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

				const {coordinator, store} = makeCoordinator({api, storage, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
				await coordinator.pResolve();
				expect(coordinator.state).toBe("offline_unverified");
				expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_A, state: "selected"});
			}
		});

		it("does not tear down a still-valid open campaign when a switch target is inaccessible", async () => {
			const order = [];
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: apiError("FORBIDDEN", 403),
			}});
			const {coordinator, store} = makeCoordinator({
				api,
				storage,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pPreflightSwitch: async () => ({safe: true}),
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});

			// B is inaccessible, but A is still valid and still open: nothing may be torn down.
			expect(order).toEqual([]);
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_A, state: "selected"});
		});

		it("tears down when the campaign that is actually active becomes inaccessible", async () => {
			const order = [];
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({
				api,
				storage,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pPreflightSwitch: async () => ({safe: true}),
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			api.pGetCampaign = async () => { throw apiError("FORBIDDEN", 403); };
			await coordinator.pSwitchTo({campaignId: CAMPAIGN_A, trigger: "retry"});
			// Same campaign, so `pSwitchTo` short-circuits; drive the loss directly instead.
			await coordinator._pClearForAccessLoss({campaignId: CAMPAIGN_A});
			expect(order).toContain("brew");
		});

		it("keeps the device selection when only a DM-only surface loses its role", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A, "dm")}});
			const order = [];
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownProjections: async () => order.push("projections"),
					pTeardownRules: async () => order.push("rules"),
				},
			});
			await coordinator.pResolve();

			const retained = await coordinator.pHandleSurfaceRoleLoss();
			// The private surface closes, but general membership is not disproved.
			expect(order).toEqual(["realtime", "projections"]);
			expect(retained).toMatchObject({campaignId: CAMPAIGN_A, state: "selected"});
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "selected"});
		});
	});

	describe("teardown", () => {
		it("runs every marker exactly once, in order, before the next activation", async () => {
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					onFenceGeneration: () => order.push("teardown-generation"),
					pTeardownRealtime: async () => order.push("teardown-realtime"),
					pTeardownProjections: async () => order.push("teardown-projections"),
					pTeardownRules: async () => order.push("teardown-rules"),
					pTeardownBrew: async () => order.push("teardown-brew"),
					pOnContextActivated: async () => order.push("activate-next"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			expect(order).toEqual([...TEARDOWN_MARKERS, "activate-next"]);
			for (const marker of TEARDOWN_MARKERS) {
				expect(order.filter(entry => entry === marker)).toHaveLength(1);
			}
		});

		it("attempts remaining cleanup but never activates the next campaign after a teardown failure", async () => {
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => { order.push("realtime"); throw new Error("realtime stuck"); },
					pTeardownProjections: async () => order.push("projections"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
					pOnContextActivated: async () => order.push("activate-next"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			expect(order).toEqual(["realtime", "projections", "rules", "brew"]);
			expect(order).not.toContain("activate-next");
			expect(coordinator.state).toBe("blocked");
		});

		it("disposes the campaign context during teardown-brew", async () => {
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, created} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();
			const first = created[0];
			expect(first.isDisposed).toBe(false);

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			expect(first.isDisposed).toBe(true);
		});
	});

	describe("switching, pinning, and preflight", () => {
		it("records the new device selection without tearing down a resource-pinned tab", async () => {
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const pending = [];
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					onPendingSelection: ({campaignId}) => pending.push(campaignId),
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B, trigger: "broadcast_channel"});
			expect(coordinator.state).toBe("switch_pending");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.pendingCampaignId).toBe(CAMPAIGN_B);
			expect(order).toEqual([]);
			expect(pending).toEqual([CAMPAIGN_B]);
		});

		it("refuses an unsafe switch and keeps the current campaign active with no teardown", async () => {
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pPreflightSwitch: async () => ({safe: false, reason: "UNSAFE_PENDING_WRITES"}),
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			expect(coordinator.state).toBe("switch_pending");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(order).toEqual([]);
		});

		it("completes a safe switch on a switchable host", async () => {
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pPreflightSwitch: async () => ({safe: true}),
				},
			});
			await coordinator.pResolve();
			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});

			expect(coordinator.state).toBe("active");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_B);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_B});
		});
	});

	describe("logout", () => {
		it("clears the record and tears down before any logout request is issued", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			await coordinator.pClearSelection({trigger: "logout"});
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
			expect(order).toContain("brew");
			expect(coordinator.state).toBe("signed_out");
		});
	});

	describe("BFCache", () => {
		it("retains context, rules, and brew across a persisted hide and show", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, created} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			coordinator.suspend();
			await coordinator.pResume();

			expect(order).toEqual([]);
			expect(created[0].isDisposed).toBe(false);
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
		});

		it("tears down fully when the account signed out while frozen", async () => {
			const order = [];
			let session = {signedIn: true, account: {id: ACCOUNT_A}};
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			api.pGetSession = async () => { api.calls.push({name: "session"}); return session; };

			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			coordinator.suspend();
			session = {signedIn: false};
			await coordinator.pResume();

			// A storage reread alone could not have detected this.
			expect(order).toEqual(["realtime", "rules", "brew"]);
			expect(coordinator.state).toBe("signed_out");
			expect(store.read()).toMatchObject({state: "cleared"});
		});

		it("tears down when another tab cleared the selection while this page was frozen", async () => {
			const order = [];
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, store} = makeCoordinator({
				api,
				storage,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			coordinator.suspend();
			// Another tab in the same browser signs out and writes a durable tombstone.
			const other = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_B, fnDelay: async () => {}});
			await other.pClear({accountId: ACCOUNT_A});
			await coordinator.pResume();

			// A tombstone is not a `selected` record; it must still be honoured on resume.
			expect(order).toEqual(["realtime", "rules", "brew"]);
			expect(coordinator.activeCampaignId).toBeNull();
			expect(store.read()).toMatchObject({state: "cleared"});
		});

		it("clears partially applied rules and brew when host activation throws", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, created} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pOnContextActivated: async () => { throw new Error("overlay failed"); },
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			expect(coordinator.state).toBe("blocked");
			// No half-applied context may remain live.
			expect(order).toEqual(["rules", "brew"]);
			expect(created[0].isDisposed).toBe(true);
			expect(coordinator.activeCampaignId).toBeNull();
		});

		it("tears down fully when a different account signed in while frozen", async () => {
			const order = [];
			let session = {signedIn: true, account: {id: ACCOUNT_A}};
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			api.pGetSession = async () => { api.calls.push({name: "session"}); return session; };

			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			coordinator.suspend();
			session = {signedIn: true, account: {id: ACCOUNT_B}};
			await coordinator.pResume();

			expect(order).toContain("realtime");
			expect(order).toContain("brew");
			// Account A's selection must not be visible to account B.
			expect(store.readForAccount(ACCOUNT_A)).toBeNull();
		});
	});

	describe("observability and disposal", () => {
		it("emits bounded transition labels with no campaign or account identifiers", async () => {
			const events = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const store = new HubActiveCampaignStore({storage: new FakeStorage(), locks: null, writerId: WRITER_A, fnDelay: async () => {}});
			const channel = new HubActiveCampaignChannel({writerId: WRITER_A, fnCreateChannel: () => null, target: new FakeTarget()});
			const coordinator = new HubActiveCampaignCoordinator({
				api,
				host: {getExplicitCampaignId: () => CAMPAIGN_A},
				store,
				channel,
				fnObserve: event => events.push(event),
				fnCreateContext: ({campaignId, context}) => ({campaignId, context, pActivate: async () => context, dispose: () => {}}),
			});
			await coordinator.pResolve();

			expect(events.length).toBeGreaterThan(0);
			const serialized = JSON.stringify(events);
			expect(serialized).not.toContain(CAMPAIGN_A);
			expect(serialized).not.toContain(ACCOUNT_A);
			expect(events.at(-1)).toMatchObject({name: "hub_active_context_transition", to: "active", result: "success"});
		});

		it("releases the channel, storage listener, and campaign context on dispose", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, created, target} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();
			expect(target.countListeners("storage")).toBe(1);

			coordinator.dispose();
			expect(target.countListeners("storage")).toBe(0);
			expect(created[0].isDisposed).toBe(true);
			// Disposal is idempotent and further work is inert.
			coordinator.dispose();
			await expect(coordinator.pResolve()).resolves.toBeDefined();
		});

		it("fences on dispose so an in-flight resolve cannot install state afterwards", async () => {
			let release;
			const gate = new Promise(resolve => { release = resolve; });
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const basePGetCampaign = api.pGetCampaign;
			api.pGetCampaign = async args => { await gate; return basePGetCampaign(args); };

			const {coordinator, created, store} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			const pending = coordinator.pResolve();
			coordinator.dispose();
			release();
			await pending;

			// Aborting alone would not stop an already-resolved request from installing brew.
			expect(coordinator.activeCampaignId).toBeNull();
			expect(created.every(instance => !instance.isActivated || instance.isDisposed)).toBe(true);
			expect(store.read()).toBeNull();
		});

		it("normalises unknown telemetry labels instead of forwarding raw values", async () => {
			const events = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const store = new HubActiveCampaignStore({storage: new FakeStorage(), locks: null, writerId: WRITER_A, fnDelay: async () => {}});
			const channel = new HubActiveCampaignChannel({writerId: WRITER_A, fnCreateChannel: () => null, target: new FakeTarget()});
			const coordinator = new HubActiveCampaignCoordinator({
				api,
				host: {getExplicitCampaignId: () => CAMPAIGN_A, isResourcePinned: () => true},
				store,
				channel,
				fnObserve: event => events.push(event),
				fnCreateContext: ({campaignId, context}) => ({campaignId, context, pActivate: async () => context, dispose: () => {}}),
			});
			await coordinator.pResolve();
			events.length = 0;

			// `pSwitchTo` forwards the caller's trigger verbatim, so it is the label that must be
			// normalised before it can reach a metric.
			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B, trigger: CAMPAIGN_A});

			expect(events.length).toBeGreaterThan(0);
			expect(events.every(event => event.trigger !== CAMPAIGN_A)).toBe(true);
			expect(events.some(event => event.trigger === "other")).toBe(true);
			expect(JSON.stringify(events)).not.toContain(CAMPAIGN_A);
		});
	});

	describe("cross-tab convergence", () => {
		it("adopts a strictly greater same-account record observed from another tab", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, store} = makeCoordinator({
				api,
				storage,
				host: {getExplicitCampaignId: () => CAMPAIGN_A, isResourcePinned: () => false, pPreflightSwitch: async () => ({safe: true})},
			});
			await coordinator.pResolve();

			const remote = makeSelectedRecord({
				accountId: ACCOUNT_A,
				campaignId: CAMPAIGN_B,
				revision: 50,
				updatedAt: Date.now() + 10_000,
				writerId: WRITER_B,
			});
			await coordinator._pHandleRemote({record: remote, isStorageSignal: false});

			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_B);
			expect(store.read()).toMatchObject({campaignId: CAMPAIGN_B, revision: 50});
		});

		it("ignores a record broadcast for a different account", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({api, host: {getExplicitCampaignId: () => CAMPAIGN_A}});
			await coordinator.pResolve();

			await coordinator._pHandleRemote({
				record: makeSelectedRecord({accountId: ACCOUNT_B, campaignId: CAMPAIGN_B, revision: 99, updatedAt: Date.now() + 1, writerId: WRITER_B}),
				isStorageSignal: false,
			});
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
		});
	});
});
