/**
 * Integration evidence for ADR 0013 against the real BFF: a real `HubApiClient` talking to a real
 * `createHubApp` instance, with two simulated tabs sharing one device storage partition and one
 * broadcast bus.
 *
 * This covers the wiring that fake-only unit tests cannot: genuine session/campaign/context
 * responses, genuine error codes, and genuine request counts. The browser-lifecycle contracts
 * (native storage events, real BroadcastChannel, reload, BFCache) are covered by
 * `test/e2e/hub/active-campaign-context.spec.ts`.
 */
import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {HubApiClient} from "../../../js/hub/hub-api-client.js";
import {HubActiveCampaignCoordinator} from "../../../js/hub/hub-active-campaign-coordinator.js";
import {HubActiveCampaignStore} from "../../../js/hub/hub-active-campaign-store.js";
import {HubActiveCampaignChannel} from "../../../js/hub/hub-active-campaign-channel.js";
import {ACTIVE_CAMPAIGN_STORAGE_KEY} from "../../../js/hub/hub-active-campaign-record.js";

const APP_ORIGIN = "https://tools.example";
const COOKIE_SECRET = "cookie-secret-at-least-thirty-two-characters";
const CSRF_SECRET = "csrf-secret-at-least-thirty-two-characters--";

/** One browser's storage partition, shared by every tab in that browser. */
class DeviceStorage {
	constructor () { this.map = new Map(); }
	getItem (key) { return this.map.has(key) ? this.map.get(key) : null; }
	setItem (key, value) { this.map.set(key, value); }
	removeItem (key) { this.map.delete(key); }
}

/** In-process stand-in for the origin-wide BroadcastChannel shared by same-browser tabs. */
class DeviceBus {
	constructor () { this.channels = new Set(); }

	create () {
		const bus = this;
		const channel = {
			listeners: new Set(),
			isClosed: false,
			addEventListener: (type, fn) => { if (type === "message") channel.listeners.add(fn); },
			removeEventListener: (type, fn) => { if (type === "message") channel.listeners.delete(fn); },
			postMessage: data => {
				for (const peer of bus.channels) {
					if (peer === channel || peer.isClosed) continue;
					for (const fn of peer.listeners) fn({data});
				}
			},
			close: () => { channel.isClosed = true; bus.channels.delete(channel); },
		};
		bus.channels.add(channel);
		return channel;
	}
}

class FakeTarget {
	addEventListener () {}
	removeEventListener () {}
}

function getSetCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

describe("active campaign context against the real BFF", () => {
	let app;
	let store;
	let device;
	let bus;
	let requests;

	beforeEach(async () => {
		store = new MemoryHubStore();
		device = new DeviceStorage();
		bus = new DeviceBus();
		requests = [];
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: jest.fn(({state}) => `https://github.example/authorize?state=${state}`),
				pExchangeCode: jest.fn(async () => ({
					provider: "github",
					providerSubject: "123",
					login: "table-owner",
					displayName: "Table Owner",
				})),
			},
			config: {
				appOrigin: APP_ORIGIN,
				cookieSecret: COOKIE_SECRET,
				csrfSecret: CSRF_SECRET,
				allowedOAuthSubjects: ["github:123"],
			},
		});
	});

	afterEach(async () => app.close());

	async function pSignIn () {
		const start = await app.inject({method: "GET", url: "/auth/github/start?returnTo=/hub.html"});
		const oauthCookie = getSetCookie(start, "__Host-hub_oauth");
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code-1&state=${encodeURIComponent(state)}`,
			headers: {cookie: `__Host-hub_oauth=${oauthCookie}`},
		});
		return `__Host-hub_session=${getSetCookie(callback, "__Host-hub_session")}`;
	}

	/** A real `HubApiClient` whose fetch is backed by `app.inject`, recording every request. */
	function makeApi ({cookie}) {
		return new HubApiClient({
			fnFetch: async (path, options = {}) => {
				requests.push(path);
				const response = await app.inject({
					method: options.method || "GET",
					url: path,
					headers: {...(options.headers || {}), cookie, origin: APP_ORIGIN},
					payload: options.body ? JSON.parse(options.body) : undefined,
				});
				return {
					ok: response.statusCode >= 200 && response.statusCode < 300,
					status: response.statusCode,
					json: async () => response.json(),
				};
			},
		});
	}

	/** One tab in the shared device: its own writer id, coordinator, channel, and API client. */
	function makeTab ({cookie, writerId, host = {}}) {
		const api = makeApi({cookie});
		const selectionStore = new HubActiveCampaignStore({
			storage: device,
			locks: null,
			writerId,
			fnDelay: async () => {},
		});
		const channel = new HubActiveCampaignChannel({
			writerId,
			fnCreateChannel: () => bus.create(),
			target: new FakeTarget(),
		});
		const coordinator = new HubActiveCampaignCoordinator({
			api,
			host,
			store: selectionStore,
			channel,
			// The brew overlay itself is exercised by HubBrewContext/HubCampaignContext tests.
			fnCreateContext: ({campaignId, context}) => ({
				campaignId,
				context,
				isDisposed: false,
				pActivate: async () => context,
				dispose () { this.isDisposed = true; },
			}),
		});
		return {api, coordinator, store: selectionStore, channel};
	}

	async function pCreateCampaign ({cookie, name}) {
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie, "x-hub-protocol-version": "3"}});
		const created = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {
				cookie,
				origin: APP_ORIGIN,
				"x-hub-protocol-version": "3",
				"x-csrf-token": session.json().csrfToken,
				"idempotency-key": `create-${name}`,
				"content-type": "application/json",
			},
			payload: {name},
		});
		expect(created.statusCode).toBe(201);
		return created.json().campaign;
	}

	it("persists a verified explicit selection and recovers it after a reload", async () => {
		const cookie = await pSignIn();
		const campaign = await pCreateCampaign({cookie, name: "Ironroot"});

		const first = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => campaign.id}});
		await first.coordinator.pResolve();
		expect(first.coordinator.state).toBe("active");
		expect(first.coordinator.activeCampaignId).toBe(campaign.id);

		// Simulate a reload: brand-new coordinator over the same device storage, no URL context.
		first.coordinator.dispose();
		const reloaded = makeTab({cookie, writerId: crypto.randomUUID()});
		await reloaded.coordinator.pResolve();

		expect(reloaded.coordinator.activeCampaignId).toBe(campaign.id);
		expect(JSON.parse(device.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toMatchObject({
			campaignId: campaign.id,
			state: "selected",
		});
	});

	it("keeps a second device independent of the first device's selection", async () => {
		const cookie = await pSignIn();
		const campaign = await pCreateCampaign({cookie, name: "Duskwatch"});

		const here = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => campaign.id}});
		await here.coordinator.pResolve();
		expect(here.coordinator.activeCampaignId).toBe(campaign.id);

		// A different device is a different storage partition, even for the same account.
		const otherDevice = new DeviceStorage();
		device = otherDevice;
		bus = new DeviceBus();
		const elsewhere = makeTab({cookie, writerId: crypto.randomUUID()});
		await elsewhere.coordinator.pResolve();

		expect(elsewhere.coordinator.state).toBe("local");
		expect(otherDevice.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY)).toBeNull();
	});

	it("uses one session read plus campaign and context for a single heavy candidate", async () => {
		const cookie = await pSignIn();
		const campaign = await pCreateCampaign({cookie, name: "Highfen"});

		const tab = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => campaign.id}});
		requests.length = 0;
		await tab.coordinator.pResolve();

		expect(requests.filter(path => path === "/api/session")).toHaveLength(1);
		expect(requests.filter(path => path === `/api/campaigns/${campaign.id}`)).toHaveLength(1);
		expect(requests.filter(path => path === `/api/campaigns/${campaign.id}/context`)).toHaveLength(1);
		expect(requests).toHaveLength(3);
	});

	it("never reads the campaign context for a selection-only host", async () => {
		const cookie = await pSignIn();
		const campaign = await pCreateCampaign({cookie, name: "Saltmarch"});

		const tab = makeTab({
			cookie,
			writerId: crypto.randomUUID(),
			host: {isContextHost: false, getExplicitCampaignId: () => campaign.id},
		});
		requests.length = 0;
		await tab.coordinator.pResolve();

		expect(tab.coordinator.state).toBe("active");
		expect(requests.some(path => path.endsWith("/context"))).toBe(false);
	});

	it("clears the device selection before the logout request is issued", async () => {
		const cookie = await pSignIn();
		const campaign = await pCreateCampaign({cookie, name: "Emberfall"});

		const tab = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => campaign.id}});
		await tab.coordinator.pResolve();

		let selectionAtLogoutRequest;
		const api = tab.api;
		api.pLogout = async () => {
			selectionAtLogoutRequest = device.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
			return {ok: true};
		};

		await tab.coordinator.pClearSelection({trigger: "logout"});
		await api.pLogout();

		// A failed logout must not leave campaign context active in this browser, so the clear
		// has to be durable *before* the request goes out.
		expect(JSON.parse(selectionAtLogoutRequest)).toMatchObject({state: "cleared", campaignId: null});
	});

	it("clears only the matching selection when access to that campaign is lost", async () => {
		const cookie = await pSignIn();
		const kept = await pCreateCampaign({cookie, name: "Kept"});
		const lost = await pCreateCampaign({cookie, name: "Lost"});

		const tab = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => kept.id}});
		await tab.coordinator.pResolve();
		expect(tab.coordinator.activeCampaignId).toBe(kept.id);

		// A different campaign becoming inaccessible must not disturb the stored selection.
		const other = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => lost.id}});
		other.api.pGetCampaign = async () => { throw Object.assign(new Error("FORBIDDEN"), {code: "FORBIDDEN", status: 403}); };
		await other.coordinator.pResolve();

		expect(other.coordinator.state).toBe("blocked");
		expect(JSON.parse(device.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toMatchObject({
			campaignId: kept.id,
			state: "selected",
		});
	});

	it("converges two tabs without rebinding a resource-pinned tab", async () => {
		const cookie = await pSignIn();
		const open = await pCreateCampaign({cookie, name: "Open Table"});
		const other = await pCreateCampaign({cookie, name: "Other Table"});

		const teardowns = [];
		// Tab A holds an open campaign character, so it is resource-pinned.
		const tabA = makeTab({
			cookie,
			writerId: crypto.randomUUID(),
			host: {
				getExplicitCampaignId: () => open.id,
				isResourcePinned: () => true,
				pTeardownRealtime: async () => teardowns.push("realtime"),
				pTeardownRules: async () => teardowns.push("rules"),
				pTeardownBrew: async () => teardowns.push("brew"),
			},
		});
		await tabA.coordinator.pResolve();

		const tabB = makeTab({cookie, writerId: crypto.randomUUID(), host: {getExplicitCampaignId: () => other.id}});
		await tabB.coordinator.pResolve();

		// The device selection follows tab B...
		expect(JSON.parse(device.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toMatchObject({campaignId: other.id});
		for (let i = 0; i < 50 && tabA.coordinator.state !== "switch_pending"; ++i) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		// ...while tab A keeps its own resource and its own rules and brew.
		expect(tabA.coordinator.state).toBe("switch_pending");
		expect(tabA.coordinator.activeCampaignId).toBe(open.id);
		expect(tabA.coordinator.pendingCampaignId).toBe(other.id);
		expect(teardowns).toEqual([]);
	});
});
