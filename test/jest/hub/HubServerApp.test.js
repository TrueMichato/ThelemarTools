import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {jest} from "@jest/globals";

const APP_ORIGIN = "https://tools.example";
const COOKIE_SECRET = "cookie-secret-at-least-thirty-two-characters";
const CSRF_SECRET = "csrf-secret-at-least-thirty-two-characters--";

function getSetCookie (response, name) {
	const cookies = response.cookies || [];
	return cookies.find(cookie => cookie.name === name)?.value;
}

describe("campaign hub BFF", () => {
	let app;
	let store;
	let oauthProvider;

	beforeEach(async () => {
		store = new MemoryHubStore();
		oauthProvider = {
			getAuthorizationUrl: jest.fn(({state}) => `https://github.example/authorize?state=${state}`),
			pExchangeCode: jest.fn(async () => ({
				provider: "github",
				providerSubject: "123",
				login: "allowed-user",
				displayName: "Allowed User",
			})),
		};
		app = await createHubApp({
			store,
			oauthProvider,
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
		expect(start.statusCode).toBe(302);
		const oauthCookie = getSetCookie(start, "__Host-hub_oauth");
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code-1&state=${encodeURIComponent(state)}`,
			headers: {cookie: `__Host-hub_oauth=${oauthCookie}`},
		});
		expect(callback.statusCode).toBe(302);
		return `__Host-hub_session=${getSetCookie(callback, "__Host-hub_session")}`;
	}

	function getMutationHeaders ({cookie, csrfToken, idempotencyKey = "mutation-1"}) {
		return {
			cookie,
			origin: APP_ORIGIN,
			"x-csrf-token": csrfToken,
			"x-hub-protocol-version": "1",
			"idempotency-key": idempotencyKey,
		};
	}

	it("reports health without authentication", async () => {
		const response = await app.inject({method: "GET", url: "/api/health"});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ok: true});
		expect(response.headers).toEqual(expect.objectContaining({
			"x-content-type-options": "nosniff",
			"x-frame-options": "DENY",
			"cache-control": "no-store",
		}));
	});

	it("reports database readiness failures", async () => {
		store.pCheckHealth = async () => { throw new Error("database unavailable"); };
		const response = await app.inject({method: "GET", url: "/api/health"});
		expect(response.statusCode).toBe(503);
		expect(response.json()).toEqual({ok: false, error: "DATABASE_UNAVAILABLE"});
	});

	it("uses signed OAuth state and creates a server-side session", async () => {
		const cookie = await pSignIn();
		const response = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(expect.objectContaining({
			signedIn: true,
			account: expect.objectContaining({displayName: "Allowed User"}),
			csrfToken: expect.any(String),
		}));
		expect(oauthProvider.pExchangeCode).toHaveBeenCalledWith(expect.objectContaining({
			code: "code-1",
			codeVerifier: expect.any(String),
		}));
	});

	it("rejects tampered OAuth state and identities outside the private allowlist", async () => {
		const badState = await app.inject({
			method: "GET",
			url: "/auth/github/callback?code=code&state=wrong",
			headers: {cookie: "__Host-hub_oauth=tampered"},
		});

		expect(badState.statusCode).toBe(400);

		oauthProvider.pExchangeCode.mockResolvedValueOnce({
			provider: "github",
			providerSubject: "999",
			login: "stranger",
			displayName: "Stranger",
		});
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const denied = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`},
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json()).toEqual({error: "ACCOUNT_NOT_ALLOWED"});
	});

	it("does not allow a mutable login name to substitute for the stable provider subject", async () => {
		oauthProvider.pExchangeCode.mockResolvedValueOnce({
			provider: "github",
			providerSubject: "999",
			login: "allowed-user",
			displayName: "Different Account",
		});
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const denied = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`},
		});
		expect(denied.statusCode).toBe(403);
	});

	it("normalizes OAuth return paths to the configured app origin", async () => {
		const start = await app.inject({method: "GET", url: "/auth/github/start?returnTo=//evil.example/phish"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`},
		});
		expect(callback.headers.location).toBe("/hub.html");
	});

	it("rejects same-origin URLs whose path would become a scheme-relative redirect", async () => {
		const start = await app.inject({method: "GET", url: "/auth/github/start?returnTo=https%3A%2F%2Ftools.example%2F%2Fevil.example%2Fphish"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`},
		});
		expect(callback.headers.location).toBe("/hub.html");
	});

	it("requires authentication, same origin, and CSRF for campaign mutations", async () => {
		const anonymous = await app.inject({method: "POST", url: "/api/campaigns", payload: {name: "Test"}});
		expect(anonymous.statusCode).toBe(403);
		expect(anonymous.json()).toEqual({error: "INVALID_ORIGIN"});

		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();

		const noCsrf = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {cookie, origin: APP_ORIGIN},
			payload: {name: "Test"},
		});
		expect(noCsrf.statusCode).toBe(403);
		expect(noCsrf.json()).toEqual({error: "INVALID_CSRF"});

		const created = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken}),
			payload: {name: "Test Campaign"},
		});
		expect(created.statusCode).toBe(201);
		expect(created.json()).toEqual(expect.objectContaining({
			campaign: expect.objectContaining({name: "Test Campaign"}),
			membership: expect.objectContaining({role: "dm"}),
		}));
		expect(store.getAuditEntries()).toEqual([
			expect.objectContaining({action: "campaign.created"}),
		]);

		const detail = await app.inject({
			method: "GET",
			url: `/api/campaigns/${created.json().campaign.id}`,
			headers: {cookie},
		});
		expect(detail.statusCode).toBe(200);
		expect(detail.json().campaign).toEqual(expect.objectContaining({name: "Test Campaign", role: "dm"}));
	});

	it("lists only campaigns visible to the signed-in account", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();
		await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken}),
			payload: {name: "Visible"},
		});

		const response = await app.inject({method: "GET", url: "/api/campaigns", headers: {cookie}});
		expect(response.statusCode).toBe(200);
		expect(response.json().campaigns).toEqual([
			expect.objectContaining({name: "Visible", role: "dm"}),
		]);
	});

	it("revokes the session on logout", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();
		const logout = await app.inject({
			method: "POST",
			url: "/api/logout",
			headers: getMutationHeaders({cookie, csrfToken}),
		});
		expect(logout.statusCode).toBe(200);

		const after = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		expect(after.json()).toEqual({signedIn: false});
	});

	it("rotates and revokes the previous browser session on reauthentication", async () => {
		const firstCookie = await pSignIn();
		const start = await app.inject({
			method: "GET",
			url: "/auth/github/start",
			headers: {cookie: firstCookie},
		});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code-2&state=${state}`,
			headers: {
				cookie: `${firstCookie}; __Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`,
			},
		});
		expect(callback.statusCode).toBe(302);

		const oldSession = await app.inject({method: "GET", url: "/api/session", headers: {cookie: firstCookie}});
		expect(oldSession.json()).toEqual({signedIn: false});
	});

	it("deduplicates retried campaign commands", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();
		const request = {
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken, idempotencyKey: "create-campaign-1"}),
			payload: {name: "Idempotent"},
		};

		const first = await app.inject(request);
		const retry = await app.inject(request);

		expect(retry.statusCode).toBe(201);
		expect(retry.json()).toEqual(first.json());
		expect(store.getDomainEvents()).toHaveLength(1);
		expect(store.getOutboxEntries()).toHaveLength(1);
	});

	it("rejects idempotency-key reuse with a different payload", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const headers = getMutationHeaders({cookie, csrfToken: session.json().csrfToken, idempotencyKey: "same-key"});
		expect((await app.inject({method: "POST", url: "/api/campaigns", headers, payload: {name: "First"}})).statusCode).toBe(201);
		const changed = await app.inject({method: "POST", url: "/api/campaigns", headers, payload: {name: "Second"}});
		expect(changed.statusCode).toBe(409);
		expect(changed.json()).toEqual({error: "IDEMPOTENCY_KEY_REUSED"});
	});

	it("rejects idempotency-key reuse across different path resources", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const csrfToken = session.json().csrfToken;
		const firstCampaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken, idempotencyKey: "campaign-a"}),
			payload: {name: "A"},
		})).json().campaign;
		const secondCampaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken, idempotencyKey: "campaign-b"}),
			payload: {name: "B"},
		})).json().campaign;
		const inviteHeaders = getMutationHeaders({cookie, csrfToken, idempotencyKey: "same-invite-key"});
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${firstCampaign.id}/invites`,
			headers: inviteHeaders,
			payload: {role: "player"},
		})).statusCode).toBe(201);
		const collision = await app.inject({
			method: "POST",
			url: `/api/campaigns/${secondCampaign.id}/invites`,
			headers: inviteHeaders,
			payload: {role: "player"},
		});
		expect(collision.statusCode).toBe(409);
		expect(collision.json()).toEqual({error: "IDEMPOTENCY_KEY_REUSED"});
	});

	it("requires an idempotency key for campaign creation", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();
		const response = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {
				cookie,
				origin: APP_ORIGIN,
				"x-csrf-token": csrfToken,
				"x-hub-protocol-version": "1",
			},
			payload: {name: "Missing Key"},
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({error: "IDEMPOTENCY_KEY_REQUIRED"});
	});

	it("returns the same redeemable invite token on idempotent retries", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const {csrfToken} = session.json();
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getMutationHeaders({cookie, csrfToken, idempotencyKey: "campaign-invite-test"}),
			payload: {name: "Invite"},
		})).json().campaign;
		const request = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: getMutationHeaders({cookie, csrfToken, idempotencyKey: "invite-stable"}),
			payload: {role: "player"},
		};
		const first = await app.inject(request);
		const retry = await app.inject(request);
		expect(retry.json().token).toBe(first.json().token);
	});

	it("clears production host cookies with Secure attributes", async () => {
		const cookie = await pSignIn();
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		const logout = await app.inject({
			method: "POST",
			url: "/api/logout",
			headers: getMutationHeaders({cookie, csrfToken: session.json().csrfToken}),
		});
		const cleared = logout.headers["set-cookie"];
		expect(cleared).toContain("Secure");
		expect(cleared).toContain("HttpOnly");
		expect(cleared).toContain("SameSite=Lax");
	});

	it("maps malformed identifiers to a stable 400 response", async () => {
		const cookie = await pSignIn();
		const response = await app.inject({method: "GET", url: "/api/campaigns/not-a-uuid", headers: {cookie}});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({error: "INVALID_ID"});
	});
});
