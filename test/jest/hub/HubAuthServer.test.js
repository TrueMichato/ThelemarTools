import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getSha256} from "../../../server/src/security.js";

const ORIGIN = "https://tools.example";

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

describe("Hub durable GitHub registry flow", () => {
	let app;
	let store;
	let oauthProvider;

	beforeEach(async () => {
		store = new MemoryHubStore();
		oauthProvider = {
			getAuthorizationUrl: jest.fn(({state, codeChallenge}) => `https://github.example/authorize?state=${state}&code_challenge=${codeChallenge}`),
			pExchangeCode: jest.fn(async () => ({
				provider: "github",
				providerSubject: "123",
				login: "player",
				displayName: "Player",
				email: "ignored@example.com",
			})),
		};
		app = await createHubApp({
			store,
			oauthProvider,
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				allowedOAuthSubjects: ["github:123"],
			},
		});
	});

	afterEach(async () => app.close());

	async function pStart () {
		const response = await app.inject({method: "GET", url: "/auth/github/start?returnTo=/hub.html"});
		return {
			response,
			state: new URL(response.headers.location).searchParams.get("state"),
			cookie: getCookie(response, "__Host-hub_oauth"),
		};
	}

	it("advertises only bounded registry capability metadata", async () => {
		const response = await app.inject({method: "GET", url: "/api/meta"});
		expect(response.json()).toEqual(expect.objectContaining({
			protocolVersion: "3",
			capabilities: ["auth.provider_registry.v1"],
			authProviders: [{
				slug: "github",
				label: "GitHub",
				startPath: "/auth/github/start",
				status: "available",
			}],
		}));
		expect(JSON.stringify(response.json())).not.toMatch(/secret|callback/i);
	});

	it("keeps state and PKCE server-side and consumes the callback once", async () => {
		const {state, cookie} = await pStart();
		const transaction = [...store._oauthTransactions.values()][0];
		expect(transaction).toEqual(expect.objectContaining({
			provider: "github",
			operation: "sign_in",
			redirectUri: `${ORIGIN}/auth/github/callback`,
			stateHash: getSha256(state),
			pkceVerifier: expect.any(String),
		}));
		expect(cookie).not.toContain(state);
		expect(cookie).not.toContain(transaction.pkceVerifier);

		const request = {
			method: "GET",
			url: `/auth/github/callback?code=code&state=${encodeURIComponent(state)}`,
			headers: {cookie: `__Host-hub_oauth=${cookie}`},
		};
		const callback = await app.inject(request);
		expect(callback.statusCode).toBe(302);
		const replay = await app.inject(request);
		expect(replay.statusCode).toBe(400);
		expect(replay.json()).toEqual({error: "INVALID_OAUTH_STATE"});
		expect(oauthProvider.pExchangeCode).toHaveBeenCalledTimes(1);
	});

	it("does not register disabled or unknown provider routes", async () => {
		const response = await app.inject({method: "GET", url: "/auth/discord/start"});
		expect(response.statusCode).toBe(404);
		expect(store._oauthTransactions.size).toBe(0);
	});

	it("rejects a validly signed legacy transaction cookie without reflecting it", async () => {
		const legacyValue = "legacy-state-and-verifier";
		const response = await app.inject({
			method: "GET",
			url: "/auth/github/callback?code=code&state=state",
			headers: {cookie: `__Host-hub_oauth=${app.signCookie(legacyValue)}`},
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({error: "INVALID_OAUTH_STATE"});
		expect(response.body).not.toContain(legacyValue);
	});

	it("falls back safely when URL normalization expands returnTo beyond its durable bound", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/auth/github/start?returnTo=/${encodeURIComponent("€".repeat(2_000))}`,
		});
		expect(response.statusCode).toBe(302);
		expect([...store._oauthTransactions.values()][0].returnTo).toBe("/hub.html");
	});

	it("returns a privacy-safe provider error and removes transient secrets", async () => {
		oauthProvider.pExchangeCode.mockRejectedValueOnce(new Error("token=provider-secret profile@example.com"));
		const {state, cookie} = await pStart();
		const transaction = [...store._oauthTransactions.values()][0];
		const response = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=bad&state=${encodeURIComponent(state)}`,
			headers: {cookie: `__Host-hub_oauth=${cookie}`},
		});

		expect(response.statusCode).toBe(503);
		expect(response.json()).toEqual({error: "AUTH_PROVIDER_UNAVAILABLE"});
		expect(response.body).not.toMatch(/provider-secret|example\.com/);
		expect(store._oauthTransactions.get(transaction.id)).toEqual(expect.objectContaining({
			stateHash: null,
			pkceVerifier: null,
		}));
	});

	it("records provider-neutral identity and session provenance without provider tokens", async () => {
		const {state, cookie} = await pStart();
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${encodeURIComponent(state)}`,
			headers: {cookie: `__Host-hub_oauth=${cookie}`},
		});
		const sessionCookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const auth = (await app.inject({method: "GET", url: "/api/session", headers: {cookie: sessionCookie}})).json();
		const exported = (await app.inject({
			method: "GET",
			url: "/api/account/export",
			headers: {cookie: sessionCookie},
		})).json();

		expect(auth.signedIn).toBe(true);
		expect(exported.externalIdentities).toEqual([
			expect.objectContaining({provider: "github", subject: "123", handle: "player"}),
		]);
		expect(exported.sessions).toEqual([
			expect.objectContaining({authenticatedViaIdentityId: exported.externalIdentities[0].id}),
		]);
		expect(JSON.stringify(exported)).not.toMatch(/access.?token|refresh.?token|pkce|nonce|ignored@example/i);
	});
});
