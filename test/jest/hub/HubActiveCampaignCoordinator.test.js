import {HubActiveCampaignCoordinator, TEARDOWN_MARKERS} from "../../../js/hub/hub-active-campaign-coordinator.js";
import {HubActiveCampaignChannel} from "../../../js/hub/hub-active-campaign-channel.js";
import {HubActiveCampaignStore} from "../../../js/hub/hub-active-campaign-store.js";
import {ACTIVE_CAMPAIGN_STORAGE_KEY, makeClearedRecord, makeSelectedRecord} from "../../../js/hub/hub-active-campaign-record.js";

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

		it("uses an explicit local route instead of an account-matching stored selection", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator} = makeCoordinator({
				api,
				storage,
				host: {
					isExplicitLocal: () => true,
					getExplicitCampaignId: () => CAMPAIGN_B,
				},
			});
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

		it("fails closed before campaign or context reads when the server omits a required capability", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					requiredCapabilities: ["campaign.active_context.v1"],
					getExplicitCampaignId: () => CAMPAIGN_A,
				},
			});

			await coordinator.pResolve();

			expect(coordinator.state).toBe("blocked");
			expect(api.countOf("campaign")).toBe(0);
			expect(api.countOf("context")).toBe(0);
		});

		it("accepts a server-advertised active-context capability", async () => {
			const api = makeApi({
				session: {
					signedIn: true,
					account: {id: ACCOUNT_A},
					capabilities: ["campaign.active_context.v1"],
				},
				campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)},
			});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					requiredCapabilities: ["campaign.active_context.v1"],
					getExplicitCampaignId: () => CAMPAIGN_A,
				},
			});

			await coordinator.pResolve();

			expect(coordinator.state).toBe("active");
			expect(api.countOf("context")).toBe(1);
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

		it("clears from a fresh coordinator in production ordering, before any resolve", async () => {
			const storage = new FakeStorage();
			const api = makeApi();
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			// Production ordering: `campaign.html` and the DM Screen own their bootstrap and call
			// this BEFORE `pResolve`/`adoptVerified`, so no account has been adopted yet.
			const {coordinator, store} = makeCoordinator({api, storage});
			expect(coordinator.accountId).toBeNull();
			await coordinator.pReportFailure({
				error: apiError("FORBIDDEN", 403),
				campaignId: CAMPAIGN_A,
				session: {signedIn: true, account: {id: ACCOUNT_A}},
			});

			expect(coordinator.accountId).toBe(ACCOUNT_A);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});
		});

		it("adopts a session cached by an earlier verification when none is passed", async () => {
			const storage = new FakeStorage();
			const api = makeApi({campaigns: {[CAMPAIGN_A]: apiError("FORBIDDEN", 403)}});
			const seed = makeCoordinator({api, storage});
			await seed.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});

			const {coordinator, store} = makeCoordinator({api, storage});
			// The DM Screen path: `pVerifyContext` reads and caches the session, then throws.
			await expect(coordinator.pVerifyContext({campaignId: CAMPAIGN_A})).rejects.toBeDefined();
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
			await coordinator.pHandleAccessLoss({campaignId: CAMPAIGN_A});
			expect(order).toContain("brew");
			expect(coordinator.state).toBe("blocked");
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
			const {coordinator, store} = makeCoordinator({
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
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({
				state: "selected",
				campaignId: CAMPAIGN_B,
			});
		});

		it("restores a pinned runtime campaign as the device selection after another campaign was selected", async () => {
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
			expect(coordinator.state).toBe("switch_pending");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_B});

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_A});

			expect(order).toEqual([]);
			expect(coordinator.state).toBe("active");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.pendingCampaignId).toBeNull();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({
				state: "selected",
				campaignId: CAMPAIGN_A,
			});
		});

		it("restores a pinned runtime campaign as the device selection after local mode was selected", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			await coordinator.pSwitchToLocal();
			expect(coordinator.state).toBe("switch_pending");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared"});

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_A});

			expect(order).toEqual([]);
			expect(coordinator.state).toBe("active");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.pendingCampaignId).toBeNull();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({
				state: "selected",
				campaignId: CAMPAIGN_A,
			});
		});

		it("switches a selection-only host immediately instead of leaving a false pending state", async () => {
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					isContextHost: false,
					getExplicitCampaignId: () => CAMPAIGN_A,
				},
			});
			await coordinator.pResolve();

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});

			expect(coordinator.state).toBe("active");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_B);
			expect(coordinator.pendingCampaignId).toBeNull();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({campaignId: CAMPAIGN_B});
		});

		it("tears down a switchable context before entering explicit local mode", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownProjections: async () => order.push("projections"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			await coordinator.pSwitchToLocal();

			expect(order).toEqual(["realtime", "projections", "rules", "brew"]);
			expect(coordinator.state).toBe("local");
			expect(coordinator.activeCampaignId).toBeNull();
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared", cause: "selection"});
		});

		it("records local mode without tearing down a pinned resource", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();

			await coordinator.pSwitchToLocal();

			expect(order).toEqual([]);
			expect(coordinator.state).toBe("switch_pending");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared", cause: "selection"});
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

		it("honours shouldActivateContext on the switch path, not only at startup", async () => {
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			const {coordinator, created} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					// The Character Sheet gate: only the campaign this page was opened with may
					// activate, because repository/realtime/URL are bound to it.
					shouldActivateContext: ({campaignId}) => campaignId === CAMPAIGN_A,
					isResourcePinned: () => false,
					pPreflightSwitch: async () => ({safe: true}),
				},
			});
			await coordinator.pResolve();
			const contextCountBefore = created.length;
			api.calls.length = 0;

			await coordinator.pSwitchTo({campaignId: CAMPAIGN_B, trigger: "broadcast_channel"});

			// The device default moves, but B's context must never be installed here.
			expect(coordinator.state).toBe("switch_pending");
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.pendingCampaignId).toBe(CAMPAIGN_B);
			expect(created).toHaveLength(contextCountBefore);
			expect(api.calls.some(call => call.name === "context")).toBe(false);
		});

		it("does not let a remote selection disturb a pinned host during heavy initialisation", async () => {
			const storage = new FakeStorage();
			const order = [];
			const api = makeApi({campaigns: {
				[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A),
				[CAMPAIGN_B]: activeCampaign(CAMPAIGN_B),
			}});
			// Pinning must not depend on state that only exists after heavy init completes.
			const {coordinator, created} = makeCoordinator({
				api,
				storage,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					shouldActivateContext: ({campaignId}) => campaignId === CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;
			const contextCountBefore = created.length;

			// Another tab selects B while this page is still initialising.
			await coordinator._pHandleRemote({
				record: makeSelectedRecord({
					accountId: ACCOUNT_A,
					campaignId: CAMPAIGN_B,
					revision: 50,
					updatedAt: Date.now() + 10_000,
					writerId: WRITER_B,
				}),
				isStorageSignal: false,
			});

			expect(order).toEqual([]);
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.state).toBe("switch_pending");
			expect(created).toHaveLength(contextCountBefore);
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

		it("tears down private state when the active campaign was archived while frozen", async () => {
			const order = [];
			const campaign = activeCampaign(CAMPAIGN_A);
			const api = makeApi({campaigns: {[CAMPAIGN_A]: campaign}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownProjections: async () => order.push("projections"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			coordinator.suspend();
			campaign.status = "archived";
			await coordinator.pResume();

			expect(order).toEqual(["realtime", "projections", "rules", "brew"]);
			expect(coordinator.activeCampaignId).toBeNull();
			expect(coordinator.state).toBe("blocked");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "cleared", cause: "access_loss"});
		});

		it("closes a role-gated surface but preserves the device selection after demotion", async () => {
			const order = [];
			const campaign = activeCampaign(CAMPAIGN_A, "dm");
			const api = makeApi({campaigns: {[CAMPAIGN_A]: campaign}});
			const {coordinator, store} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isCampaignAuthorized: ({campaign: verified}) => ["dm", "co_dm"].includes(verified.role),
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownProjections: async () => order.push("projections"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			campaign.role = "player";
			await coordinator.pRevalidate({trigger: "access_loss"});

			expect(order).toEqual(["realtime", "projections"]);
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.state).toBe("blocked");
			expect(store.readForAccount(ACCOUNT_A)).toMatchObject({state: "selected", campaignId: CAMPAIGN_A});
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
		it("publishes immutable state snapshots for local and remote UI convergence", async () => {
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({api, host: {isContextHost: false}});
			const snapshots = [];
			const unsubscribe = coordinator.subscribe(snapshot => snapshots.push(snapshot));

			await coordinator.pResolve();
			await coordinator.pSwitchTo({campaignId: CAMPAIGN_A});
			unsubscribe();
			await coordinator.pSwitchToLocal();

			expect(Object.isFrozen(snapshots[0])).toBe(true);
			expect(snapshots.some(snapshot => snapshot.state === "active" && snapshot.activeCampaignId === CAMPAIGN_A)).toBe(true);
			expect(snapshots.at(-1).state).toBe("active");
		});

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

		const makeRemoteTombstone = (cause = "logout") => makeClearedRecord({
			accountId: ACCOUNT_A,
			revision: 99,
			updatedAt: Date.now() + 10_000,
			writerId: WRITER_B,
			cause,
		});

		it("keeps a pinned open resource when another tab clears after losing access elsewhere", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator, created} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			// Losing access to some *other* campaign must not dismantle this open resource.
			await coordinator._pHandleRemote({record: makeRemoteTombstone("access_loss"), isStorageSignal: false});

			expect(order).toEqual([]);
			expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
			expect(coordinator.state).toBe("switch_pending");
			expect(created[0].isDisposed).toBe(false);
		});

		it("always tears down a pinned resource when another tab signs out", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => true,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownRules: async () => order.push("rules"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			// Logout is a security boundary: pinning never defers it.
			await coordinator._pHandleRemote({record: makeRemoteTombstone("logout"), isStorageSignal: false});

			expect(order).toEqual(["realtime", "rules", "brew"]);
			expect(coordinator.activeCampaignId).toBeNull();
			expect(coordinator.state).toBe("local");
		});

		it("tears down an unpinned host on any remote clear", async () => {
			const order = [];
			const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
			const {coordinator} = makeCoordinator({
				api,
				host: {
					getExplicitCampaignId: () => CAMPAIGN_A,
					isResourcePinned: () => false,
					pTeardownRealtime: async () => order.push("realtime"),
					pTeardownBrew: async () => order.push("brew"),
				},
			});
			await coordinator.pResolve();
			order.length = 0;

			await coordinator._pHandleRemote({record: makeRemoteTombstone("access_loss"), isStorageSignal: false});

			expect(order).toEqual(["realtime", "brew"]);
			expect(coordinator.state).toBe("local");
		});

		/**
		 * The delivery-ordering and transport hazards that a transient, message-only cause could
		 * not survive. The cause lives on the durable record precisely so these hold.
		 */
		describe("logout teardown survives every delivery path", () => {
			const makePinnedHost = order => ({
				getExplicitCampaignId: () => CAMPAIGN_A,
				isResourcePinned: () => true,
				pTeardownRealtime: async () => order.push("realtime"),
				pTeardownRules: async () => order.push("rules"),
				pTeardownBrew: async () => order.push("brew"),
			});

			it("tears down when the storage event lands before the broadcast message", async () => {
				const order = [];
				const storage = new FakeStorage();
				const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
				const {coordinator} = makeCoordinator({api, storage, host: makePinnedHost(order)});
				await coordinator.pResolve();
				order.length = 0;

				// Another tab logs out: it writes durable storage, then broadcasts.
				const remote = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_B, fnDelay: async () => {}});
				const tombstone = await remote.pClear({accountId: ACCOUNT_A, cause: "logout"});

				// The storage signal wins the race and carries no payload at all.
				await coordinator._pHandleRemote({record: null, isStorageSignal: true});
				expect(order).toEqual(["realtime", "rules", "brew"]);
				expect(coordinator.activeCampaignId).toBeNull();

				// The later broadcast of the same record is correctly ignored as not-greater, and
				// must not undo or duplicate the teardown that already happened.
				order.length = 0;
				await coordinator._pHandleRemote({record: tombstone, isStorageSignal: false});
				expect(order).toEqual([]);
				expect(coordinator.activeCampaignId).toBeNull();
			});

			it("tears down with no BroadcastChannel at all, over the storage fallback only", async () => {
				const order = [];
				const storage = new FakeStorage();
				const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
				const store = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_A, fnDelay: async () => {}});
				// No channel: `fnCreateChannel` returns null, so only `storage` events arrive.
				const channel = new HubActiveCampaignChannel({
					writerId: WRITER_A,
					fnCreateChannel: () => null,
					target: new FakeTarget(),
				});
				expect(channel.hasChannel).toBe(false);
				const coordinator = new HubActiveCampaignCoordinator({
					api,
					host: makePinnedHost(order),
					store,
					channel,
					fnCreateContext: ({campaignId, context}) => ({campaignId, context, isDisposed: false, pActivate: async () => context, dispose () { this.isDisposed = true; }}),
				});
				await coordinator.pResolve();
				order.length = 0;

				const remote = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_B, fnDelay: async () => {}});
				await remote.pClear({accountId: ACCOUNT_A, cause: "logout"});
				await coordinator._pHandleRemote({record: null, isStorageSignal: true});

				expect(order).toEqual(["realtime", "rules", "brew"]);
				expect(coordinator.activeCampaignId).toBeNull();
				coordinator.dispose();
			});

			it("still preserves a pinned resource for an access-loss clear over the storage fallback", async () => {
				const order = [];
				const storage = new FakeStorage();
				const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
				const {coordinator, created} = makeCoordinator({api, storage, host: makePinnedHost(order)});
				await coordinator.pResolve();
				order.length = 0;

				const remote = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_B, fnDelay: async () => {}});
				await remote.pClear({accountId: ACCOUNT_A, cause: "access_loss"});
				await coordinator._pHandleRemote({record: null, isStorageSignal: true});

				expect(order).toEqual([]);
				expect(coordinator.activeCampaignId).toBe(CAMPAIGN_A);
				expect(coordinator.state).toBe("switch_pending");
				expect(created[0].isDisposed).toBe(false);
			});

			it("treats a tombstone with no cause as a logout", async () => {
				const order = [];
				const storage = new FakeStorage();
				const api = makeApi({campaigns: {[CAMPAIGN_A]: activeCampaign(CAMPAIGN_A)}});
				const {coordinator} = makeCoordinator({api, storage, host: makePinnedHost(order)});
				await coordinator.pResolve();
				order.length = 0;

				// A record written by an older client, before the cause existed.
				storage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, JSON.stringify({
					schemaVersion: 1,
					accountId: ACCOUNT_A,
					campaignId: null,
					state: "cleared",
					revision: 99,
					updatedAt: Date.now() + 10_000,
					writerId: WRITER_B,
				}));
				await coordinator._pHandleRemote({record: null, isStorageSignal: true});

				expect(order).toEqual(["realtime", "rules", "brew"]);
				expect(coordinator.activeCampaignId).toBeNull();
			});
		});
	});
});
