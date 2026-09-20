import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {AuthProviderRegistry} from "../../../server/src/auth-provider-registry.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getSha256} from "../../../server/src/security.js";

const ORIGIN = "https://tools.example";

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

function getFinalCookieHeader (...responses) {
	const jar = new Map();
	for (const response of responses) {
		for (const cookie of response.cookies || []) {
			if (cookie.maxAge === 0 || cookie.value === "") jar.delete(cookie.name);
			else jar.set(cookie.name, cookie.value);
		}
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

describe("Hub durable GitHub registry flow", () => {
	let app;
	let store;
	let oauthProvider;

	beforeEach(async () => {
		store = new MemoryHubStore();
		await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "123",
			displayName: "Player",
		});
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
			protocolVersion: "5",
			capabilities: ["auth.provider_registry.v1", "campaign.active_context.v1"],
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

	it("keeps two concurrent empty-jar starts bound by transaction-specific cookies", async () => {
		const first = await pStart();
		const second = await pStart();
		const finalCookieHeader = getFinalCookieHeader(first.response, second.response);
		for (const current of [second, first]) {
			const callback = await app.inject({
				method: "GET",
				url: `/auth/github/callback?code=code&state=${encodeURIComponent(current.state)}`,
				headers: {cookie: finalCookieHeader},
			});
			expect(callback.statusCode).toBe(302);
		}
	});

	it("does not register disabled or unknown provider routes", async () => {
		const response = await app.inject({method: "GET", url: "/auth/discord/start"});
		expect(response.statusCode).toBe(404);
		expect(store._oauthTransactions.size).toBe(0);
		expect((await app.inject({
			method: "GET",
			url: "/api/account/identities",
		})).statusCode).toBe(404);
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

	it("rejects an empty, duplicate, oversized, or short invite-token key ring", async () => {
		for (const inviteTokenSecrets of [
			[],
			["short"],
			["a".repeat(32), "a".repeat(32)],
			Array.from({length: 5}, (_, index) => `${index}`.repeat(32)),
		]) {
			await expect(createHubApp({
				store: new MemoryHubStore(),
				oauthProvider,
				config: {
					appOrigin: ORIGIN,
					cookieSecret: "c".repeat(32),
					csrfSecret: "s".repeat(32),
					inviteTokenSecrets,
				},
			})).rejects.toThrow(/inviteTokenSecrets/);
		}
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
	const exchangedSubjects = new Map();

	beforeEach(async () => {
		store = new MemoryHubStore();
		exchanges.clear();
		exchangedSubjects.clear();
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
					subject: exchangedSubjects.get(definition.slug) || definition.subject,
					handle: `${definition.slug}-user`,
					displayName: `${definition.label} User`,
				};
			}),
		}));
		for (const definition of definitions) {
			await store.pUpsertOAuthAccount({
				provider: definition.slug,
				providerSubject: definition.subject,
				displayName: `${definition.label} User`,
			});
		}
		app = await createHubApp({
			store,
			authProviderRegistry: new AuthProviderRegistry({
				registrations: providers.map(provider => ({status: "available", provider})),
			}),
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				isAccountIdentityLinkingEnabled: true,
				identityRetentionRequiredProviders: ["github"],
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

	async function pSignIn (slug) {
		const started = await pStart(slug);
		const callback = await app.inject({
			method: "GET",
			url: `/auth/${slug}/callback?code=code&state=${encodeURIComponent(started.state)}`,
			headers: {cookie: getFinalCookieHeader(started.response)},
		});
		return {
			callback,
			cookie: `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`,
		};
	}

	async function pReauthenticate ({slug, cookie}) {
		const session = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie},
		})).json();
		const started = await app.inject({
			method: "POST",
			url: `/api/account/reauthentication/${slug}`,
			headers: {
				cookie,
				origin: ORIGIN,
				"x-csrf-token": session.csrfToken,
				"x-hub-protocol-version": "5",
			},
			payload: {returnTo: "/hub.html"},
		});
		const state = new URL(started.json().authorizationUrl).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/${slug}/callback?code=reauth&state=${encodeURIComponent(state)}`,
			headers: {cookie: getFinalCookieHeader({cookies: [{name: "__Host-hub_session", value: cookie.split("=")[1]}]}, started)},
		});
		return {
			callback,
			cookie: `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`,
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

	it("lists only bounded caller identity metadata and completes link with full session rotation", async () => {
		const signedIn = await pSignIn("github");
		const reauthenticated = await pReauthenticate({slug: "github", cookie: signedIn.cookie});
		const oldAuth = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: reauthenticated.cookie},
		})).json();
		const otherSession = await store.pCreateSession({
			accountId: oldAuth.account.id,
			tokenHash: "f".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		store._characterLeases.set("character-link", {sessionId: otherSession.id});
		store._dmWorkspaceLeases.set("workspace-link", {sessionId: otherSession.id});
		app.hubRealtime.closeSession = jest.fn();
		exchangedSubjects.set("google", "google-new-link");

		const intent = await app.inject({
			method: "POST",
			url: "/api/account/identities/google/link-intents",
			headers: {
				cookie: reauthenticated.cookie,
				origin: ORIGIN,
				"x-csrf-token": oldAuth.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "link-google",
			},
			payload: {returnTo: "/hub.html?identityNotice=linked"},
		});
		expect(intent.statusCode).toBe(201);
		const intentReplay = await app.inject({
			method: "POST",
			url: "/api/account/identities/google/link-intents",
			headers: {
				cookie: reauthenticated.cookie,
				origin: ORIGIN,
				"x-csrf-token": oldAuth.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "link-google",
			},
			payload: {returnTo: "/hub.html?identityNotice=linked"},
		});
		expect(intentReplay.statusCode).toBe(201);
		expect(intentReplay.json()).toEqual(intent.json());
		const state = new URL(intent.json().authorizationUrl).searchParams.get("state");
		const callbackRequest = {
			method: "GET",
			url: `/auth/google/callback?code=link&state=${encodeURIComponent(state)}`,
			headers: {cookie: getFinalCookieHeader({cookies: [{name: "__Host-hub_session", value: reauthenticated.cookie.split("=")[1]}]}, intent)},
		};
		const callback = await app.inject(callbackRequest);
		expect(callback.statusCode).toBe(302);
		const callbackReplay = await app.inject(callbackRequest);
		expect(callbackReplay.statusCode).toBe(400);
		expect(store._audit.filter(entry => entry.action === "identity.linked")).toHaveLength(1);
		const nextCookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const nextSession = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: nextCookie},
		})).json();
		const listed = (await app.inject({
			method: "GET",
			url: "/api/account/identities",
			headers: {
				cookie: nextCookie,
				"x-hub-protocol-version": "5",
			},
		})).json();

		expect(listed.identities).toEqual([
			expect.objectContaining({provider: "github", isCurrentSessionIdentity: false}),
			expect.objectContaining({provider: "google", isCurrentSessionIdentity: true}),
		]);
		expect(JSON.stringify(listed)).not.toMatch(/subject|token|pkce|nonce/i);
		expect(store._characterLeases.size).toBe(0);
		expect(store._dmWorkspaceLeases.size).toBe(0);
		expect(app.hubRealtime.closeSession).toHaveBeenCalledTimes(2);

		const oldCsrf = await app.inject({
			method: "POST",
			url: "/api/account/sessions/revoke-others",
			headers: {
				cookie: nextCookie,
				origin: ORIGIN,
				"x-csrf-token": oldAuth.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "old-csrf",
			},
		});
		expect(oldCsrf.statusCode).toBe(403);
		expect(oldCsrf.json()).toEqual({error: "INVALID_CSRF"});
		const freshCsrf = await app.inject({
			method: "POST",
			url: "/api/account/sessions/revoke-others",
			headers: {
				cookie: nextCookie,
				origin: ORIGIN,
				"x-csrf-token": nextSession.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "fresh-csrf",
			},
		});
		expect(freshCsrf.statusCode).toBe(200);

		const unlinkReauth = await pReauthenticate({slug: "github", cookie: nextCookie});
		const unlinkSession = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: unlinkReauth.cookie},
		})).json();
		const googleIdentity = listed.identities.find(identity => identity.provider === "google");
		const unlink = await app.inject({
			method: "DELETE",
			url: `/api/account/identities/${googleIdentity.id}`,
			headers: {
				cookie: unlinkReauth.cookie,
				origin: ORIGIN,
				"x-csrf-token": unlinkSession.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "unlink-google",
			},
		});
		expect(unlink.statusCode).toBe(200);
		expect(unlink.json()).toEqual(expect.objectContaining({
			unlinkedIdentityId: googleIdentity.id,
			csrfToken: expect.any(String),
		}));
		const unlinkCookie = `__Host-hub_session=${getCookie(unlink, "__Host-hub_session")}`;
		const unlinkReplay = await app.inject({
			method: "DELETE",
			url: `/api/account/identities/${googleIdentity.id}`,
			headers: {
				cookie: unlinkCookie,
				origin: ORIGIN,
				"x-csrf-token": unlink.json().csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "unlink-google",
			},
		});
		expect(unlinkReplay.statusCode).toBe(200);
		expect(getCookie(unlinkReplay, "__Host-hub_session")).toBe(getCookie(unlink, "__Host-hub_session"));
		const staleAfterUnlink = await app.inject({
			method: "POST",
			url: "/api/account/sessions/revoke-others",
			headers: {
				cookie: unlinkCookie,
				origin: ORIGIN,
				"x-csrf-token": unlinkSession.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "unlink-old-csrf",
			},
		});
		expect(staleAfterUnlink.statusCode).toBe(403);
		const freshAfterUnlink = await app.inject({
			method: "POST",
			url: "/api/account/sessions/revoke-others",
			headers: {
				cookie: unlinkCookie,
				origin: ORIGIN,
				"x-csrf-token": unlinkReplay.json().csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "unlink-fresh-csrf",
			},
		});
		expect(freshAfterUnlink.statusCode).toBe(200);
	});

	it("rejects link callback session/account mismatch and owned-elsewhere conflict without partial linking", async () => {
		const github = await pSignIn("github");
		const githubReauth = await pReauthenticate({slug: "github", cookie: github.cookie});
		const githubSession = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: githubReauth.cookie},
		})).json();
		exchangedSubjects.set("google", "google-mismatch-link");
		const intent = await app.inject({
			method: "POST",
			url: "/api/account/identities/google/link-intents",
			headers: {
				cookie: githubReauth.cookie,
				origin: ORIGIN,
				"x-csrf-token": githubSession.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "link-mismatch",
			},
			payload: {returnTo: "/hub.html"},
		});
		const discord = await pSignIn("discord");
		const mismatchState = new URL(intent.json().authorizationUrl).searchParams.get("state");
		const mismatch = await app.inject({
			method: "GET",
			url: `/auth/google/callback?code=link&state=${encodeURIComponent(mismatchState)}`,
			headers: {cookie: getFinalCookieHeader({cookies: [{name: "__Host-hub_session", value: discord.cookie.split("=")[1]}]}, intent)},
		});
		expect(mismatch.statusCode).toBe(400);
		expect((await store.pListExternalIdentities({accountId: githubSession.account.id})).map(identity => identity.provider))
			.toEqual(["github"]);

		const freshGitHub = await pReauthenticate({slug: "github", cookie: githubReauth.cookie});
		const freshSession = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: freshGitHub.cookie},
		})).json();
		exchangedSubjects.delete("google");
		const conflictIntent = await app.inject({
			method: "POST",
			url: "/api/account/identities/google/link-intents",
			headers: {
				cookie: freshGitHub.cookie,
				origin: ORIGIN,
				"x-csrf-token": freshSession.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": "link-conflict",
			},
			payload: {returnTo: "/hub.html"},
		});
		const conflictState = new URL(conflictIntent.json().authorizationUrl).searchParams.get("state");
		const conflict = await app.inject({
			method: "GET",
			url: `/auth/google/callback?code=link&state=${encodeURIComponent(conflictState)}`,
			headers: {cookie: getFinalCookieHeader({cookies: [{name: "__Host-hub_session", value: freshGitHub.cookie.split("=")[1]}]}, conflictIntent)},
		});
		expect(conflict.statusCode).toBe(409);
		expect(conflict.json()).toEqual({error: "IDENTITY_ALREADY_LINKED"});
	});
});
