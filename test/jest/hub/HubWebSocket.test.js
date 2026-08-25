import {once} from "node:events";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const APP_ORIGIN = "https://tools.example";

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

async function pNextJson (socket, type) {
	for (;;) {
		const [raw] = await once(socket, "message");
		const message = JSON.parse(raw.toString());
		if (!type || message.type === type) return message;
	}
}

describe("campaign WebSocket", () => {
	let app;
	let store;

	beforeEach(async () => {
		store = new MemoryHubStore();
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => ({
					provider: "github",
					providerSubject: "123",
					login: "dm",
					displayName: "DM",
				}),
			},
			config: {
				appOrigin: APP_ORIGIN,
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: ["github:123"],
			},
		});
	});

	afterEach(async () => app?.close());

	async function pSignIn () {
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getCookie(start, "__Host-hub_oauth")}`},
		});
		const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
		return {cookie, ...session};
	}

	function headers (session, key) {
		return {
			cookie: session.cookie,
			origin: APP_ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "1",
			"idempotency-key": key,
		};
	}

	it("authenticates, resyncs, and receives outbox events", async () => {
		const session = await pSignIn();
		const campaignResponse = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: headers(session, "campaign"),
			payload: {name: "Realtime"},
		});
		const campaignId = campaignResponse.json().campaign.id;
		await app.hubOutboxDispatcher.pDispatchOnce();

		const socket = await app.injectWS(`/ws/campaign/${campaignId}?v=1`, {
			headers: {cookie: session.cookie, origin: APP_ORIGIN},
		});
		const pResync = pNextJson(socket, "resync_complete");
		socket.send(JSON.stringify({type: "resync", afterSequence: 0}));
		const resync = await pResync;
		expect(resync.snapshot).toEqual(expect.objectContaining({lastSequence: 1, characters: []}));

		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaignId}/rolls`,
			headers: headers(session, "roll"),
			payload: {formula: "1d20+5", total: 17, visibility: "dm_only"},
		});
		const pEvent = pNextJson(socket, "event");
		await app.hubOutboxDispatcher.pDispatchOnce();
		const event = await pEvent;
		expect(event.event).toEqual(expect.objectContaining({
			type: "roll.logged",
			visibility: "dm_only",
		}));
		socket.close();
	});

	it("rejects missing protocol version and cross-origin upgrades", async () => {
		const session = await pSignIn();
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: headers(session, "campaign"),
			payload: {name: "Realtime"},
		})).json().campaign;
		await expect(app.injectWS(`/ws/campaign/${campaign.id}`, {
			headers: {cookie: session.cookie, origin: APP_ORIGIN},
		})).rejects.toThrow();
		await expect(app.injectWS(`/ws/campaign/${campaign.id}?v=1`, {
			headers: {cookie: session.cookie, origin: "https://evil.example"},
		})).rejects.toThrow();
	});

	it("closes active sockets with a bounded server-shutdown code", async () => {
		const session = await pSignIn();
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: headers(session, "shutdown-campaign"),
			payload: {name: "Shutdown"},
		})).json().campaign;
		const socket = await app.injectWS(`/ws/campaign/${campaign.id}?v=1`, {
			headers: {cookie: session.cookie, origin: APP_ORIGIN},
		});
		const pClosed = once(socket, "close");
		await app.close();
		app = null;
		const [code, reason] = await pClosed;
		expect(code).toBe(1001);
		expect(reason.toString()).toBe("Server shutdown");
	});

	it("passes the configured provider client address into WebSocket authorization context", async () => {
		let connection;
		const providerStore = new MemoryHubStore();
		const providerApp = await createHubApp({
			store: providerStore,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => ({
					provider: "github",
					providerSubject: "123",
					login: "dm",
					displayName: "DM",
				}),
			},
			realtime: {
				getConnectionCount: () => 0,
				addConnection: value => connection = value,
				pPublishEvent: async () => {},
				close: () => {},
			},
			config: {
				appOrigin: APP_ORIGIN,
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: ["github:123"],
				clientIpHeader: "do-connecting-ip",
			},
		});
		try {
			const start = await providerApp.inject({method: "GET", url: "/auth/github/start"});
			const state = new URL(start.headers.location).searchParams.get("state");
			const callback = await providerApp.inject({
				method: "GET",
				url: `/auth/github/callback?code=x&state=${state}`,
				headers: {cookie: `__Host-hub_oauth=${getCookie(start, "__Host-hub_oauth")}`},
			});
			const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
			const session = (await providerApp.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
			const campaign = (await providerApp.inject({
				method: "POST",
				url: "/api/campaigns",
				headers: headers({cookie, ...session}, "provider-campaign"),
				payload: {name: "Provider Realtime"},
			})).json().campaign;
			const socket = await providerApp.injectWS(`/ws/campaign/${campaign.id}?v=1`, {
				headers: {
					cookie,
					origin: APP_ORIGIN,
					"do-connecting-ip": "203.0.113.15",
				},
			});
			expect(connection).toEqual(expect.objectContaining({clientIp: "203.0.113.15"}));
			socket.close();
		} finally {
			await providerApp.close();
		}
	});
});
