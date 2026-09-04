import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {AuthProviderRegistry} from "../../../server/src/auth-provider-registry.js";
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
			protocolVersion: "4",
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

	it.each([
		"http://tools.example",
		"https://tools.example/path",
		"https://user@tools.example",
		"https://tools.example?query=1",
		"https://tools.example#fragment",
	])("rejects an insecure or non-origin application URL", async appOrigin => {
		await expect(createHubApp({
			store: new MemoryHubStore(),
			oauthProvider,
			config: {
				appOrigin,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
			},
		})).rejects.toThrow(/exact origin|HTTPS/);
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

describe("Hub concrete multi-provider routes", () => {
	let app;
	let store;
	const exchanges = new Map();

	beforeEach(async () => {
		store = new MemoryHubStore();
		exchanges.clear();
		const definitions = [
			{slug: "github", label: "GitHub", subject: "101", pkce: "S256", oidcNonce: false},
			{slug: "discord", label: "Discord", subject: "202", pkce: false, oidcNonce: false},
			{slug: "google", label: "Google", subject: "google-sub", pkce: "S256", oidcNonce: true},
		];
		const providers = definitions.map(definition => ({
			slug: definition.slug,
			label: definition.label,
			startPath: `/auth/${definition.slug}/start`,
			callbackPath: `/auth/${definition.slug}/callback`,
			capabilities: {pkce: definition.pkce, oidcNonce: definition.oidcNonce},
			getAuthorizationUrl: jest.fn(({state}) => `https://${definition.slug}.example/authorize?state=${state}`),
			pExchangeCodeForIdentity: jest.fn(async context => {
				exchanges.set(definition.slug, context);
				if (context.code === "fail") throw new Error("provider body and token must not escape");
				return {
					provider: definition.slug,
					subject: definition.subject,
					handle: `${definition.slug}-user`,
					displayName: `${definition.label} User`,
				};
			}),
		}));
		app = await createHubApp({
			store,
			authProviderRegistry: new AuthProviderRegistry({
				registrations: providers.map(provider => ({status: "available", provider})),
			}),
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				allowedOAuthSubjects: ["github:101", "discord:202", "google:google-sub"],
			},
		});
	});

	afterEach(async () => app.close());

	async function pStart (slug) {
		const response = await app.inject({method: "GET", url: `/auth/${slug}/start?returnTo=/hub.html`});
		const transaction = [...store._oauthTransactions.values()].at(-1);
		return {
			response,
			transaction,
			cookie: getCookie(response, "__Host-hub_oauth"),
			state: transaction && new URL(response.headers.location).searchParams.get("state"),
		};
	}

	it("persists only the PKCE and nonce shape declared by each concrete provider", async () => {
		for (const expected of [
			{slug: "github", hasPkce: true, hasNonce: false},
			{slug: "discord", hasPkce: false, hasNonce: false},
			{slug: "google", hasPkce: true, hasNonce: true},
		]) {
			const {transaction} = await pStart(expected.slug);
			expect(transaction).toEqual(expect.objectContaining({
				provider: expected.slug,
				redirectUri: `${ORIGIN}/auth/${expected.slug}/callback`,
				pkceVerifier: expected.hasPkce ? expect.any(String) : null,
				oidcNonce: expected.hasNonce ? expect.any(String) : null,
			}));
			expect(transaction).not.toHaveProperty("state");
		}
	});

	it("rejects provider callback mix-up before exchange", async () => {
		const {cookie, state} = await pStart("google");
		const response = await app.inject({
			method: "GET",
			url: `/auth/discord/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${cookie}`},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({error: "INVALID_OAUTH_STATE"});
		expect(exchanges.has("discord")).toBe(false);
		expect(exchanges.has("google")).toBe(false);
	});

	it("keeps a healthy provider usable after a sibling callback failure", async () => {
		const failed = await pStart("discord");
		const failedResponse = await app.inject({
			method: "GET",
			url: `/auth/discord/callback?code=fail&state=${failed.state}`,
			headers: {cookie: `__Host-hub_oauth=${failed.cookie}`},
		});
		expect(failedResponse.statusCode).toBe(503);
		expect(failedResponse.json()).toEqual({error: "AUTH_PROVIDER_UNAVAILABLE"});
		expect(failedResponse.body).not.toMatch(/provider body|token/);

		const healthy = await pStart("google");
		const response = await app.inject({
			method: "GET",
			url: `/auth/google/callback?code=ok&state=${healthy.state}`,
			headers: {cookie: `__Host-hub_oauth=${healthy.cookie}`},
		});
		expect(response.statusCode).toBe(302);
		expect(exchanges.get("google")).toEqual(expect.objectContaining({
			codeVerifier: expect.any(String),
			nonce: expect.any(String),
			redirectUri: `${ORIGIN}/auth/google/callback`,
		}));
	});
});
