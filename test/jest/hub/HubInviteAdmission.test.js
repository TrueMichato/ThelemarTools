import crypto from "node:crypto";
import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getSha256} from "../../../server/src/security.js";

const ORIGIN = "https://tools.example";

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

function getCookieHeader (response) {
	return (response.cookies || [])
		.filter(cookie => cookie.value !== "")
		.map(cookie => `${cookie.name}=${cookie.value}`)
		.join("; ");
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

function getProvider ({subject = "new-player", pExchange = null} = {}) {
	return {
		getAuthorizationUrl: jest.fn(({state, codeChallenge}) => `https://github.example/authorize?state=${state}&code_challenge=${codeChallenge}`),
		pExchangeCode: jest.fn(pExchange || (async () => ({
			provider: "github",
			providerSubject: subject,
			login: subject,
			displayName: subject,
		}))),
	};
}

async function pSeedInvite ({store, now, maxUses = 1, expiresAt = new Date(now.getTime() + 60_000)}) {
	const owner = await store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: `owner-${crypto.randomUUID()}`,
		displayName: "Owner",
	});
	const {campaign} = await store.pCreateCampaign({
		accountId: owner.id,
		name: "Invite campaign",
		idempotencyKey: crypto.randomUUID(),
	});
	const token = crypto.randomBytes(32).toString("base64url");
	const created = await store.pCreateInvite({
		accountId: owner.id,
		campaignId: campaign.id,
		role: "player",
		tokenHash: getSha256(token),
		expiresAt,
		maxUses,
		idempotencyKey: crypto.randomUUID(),
	});
	return {owner, campaign, token, invite: created.invite};
}

async function pStartInvite ({app, token, provider = "github"}) {
	const response = await app.inject({
		method: "POST",
		url: "/api/auth/invite-contexts",
		headers: {
			origin: ORIGIN,
			"x-hub-protocol-version": "5",
		},
		payload: {token, provider, returnTo: "/hub.html"},
	});
	const authorizationUrl = response.statusCode === 201 ? new URL(response.json().authorizationUrl) : null;
	return {
		response,
		state: authorizationUrl?.searchParams.get("state") || null,
		cookie: getCookie(response, "__Host-hub_oauth"),
		cookieHeader: getCookieHeader(response),
		retryToken: response.statusCode === 201 ? response.json().retryToken : null,
	};
}

async function pRetryInvite ({app, retryToken, provider = "github", cookieHeader = null}) {
	const response = await app.inject({
		method: "POST",
		url: "/api/auth/invite-contexts/retry",
		headers: {
			origin: ORIGIN,
			"x-hub-protocol-version": "5",
			...(cookieHeader ? {cookie: cookieHeader} : {}),
		},
		payload: {retryToken, provider, returnTo: "/hub.html"},
	});
	const authorizationUrl = response.statusCode === 201 ? new URL(response.json().authorizationUrl) : null;
	return {
		response,
		state: authorizationUrl?.searchParams.get("state") || null,
		cookie: getCookie(response, "__Host-hub_oauth"),
		cookieHeader: getCookieHeader(response),
		retryToken: response.statusCode === 201 ? response.json().retryToken : null,
	};
}

async function pCallback ({app, state, cookie, cookieHeader = null, code = "code"}) {
	return app.inject({
		method: "GET",
		url: `/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
		headers: {cookie: cookieHeader || `__Host-hub_oauth=${cookie}`},
	});
}

describe("Hub invite-gated first OAuth access", () => {
	let now;
	let store;
	let provider;
	let app;

	beforeEach(async () => {
		now = new Date("2026-09-20T00:00:00.000Z");
		store = new MemoryHubStore({fnNow: () => new Date(now)});
		provider = getProvider();
		app = await createHubApp({
			store,
			oauthProvider: provider,
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				isInviteAccountAdmissionEnabled: true,
			},
		});
	});

	afterEach(async () => app.close());

	it("creates account, identity, session, membership, audit, event, and invite use atomically", async () => {
		const seeded = await pSeedInvite({store, now});
		const started = await pStartInvite({app, token: seeded.token});
		expect(started.response.statusCode).toBe(201);
		expect(started.response.body).not.toContain(seeded.token);
		expect(started.response.json().retryToken).toEqual(expect.any(String));
		expect(started.response.json()).not.toHaveProperty("inviteContextId");
		const transaction = [...store._oauthTransactions.values()].at(-1);
		expect(transaction.inviteContextId).toEqual(expect.any(String));
		expect(new Date(store._inviteContexts.get(transaction.inviteContextId).expiresAt) - now).toBeLessThanOrEqual(5 * 60_000);

		const callback = await pCallback({app, ...started});
		expect(callback.statusCode).toBe(302);
		const sessionCookie = getCookie(callback, "__Host-hub_session");
		const auth = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: `__Host-hub_session=${sessionCookie}`},
		})).json();
		const membership = await store.pGetMembership({accountId: auth.account.id, campaignId: seeded.campaign.id});
		expect(membership).toEqual(expect.objectContaining({role: "player", status: "active"}));
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(1);
		expect(store._inviteContexts.get(transaction.inviteContextId).consumedAt).toEqual(expect.any(String));
		expect(store.getAuditEntries().filter(it => it.action === "invite.redeemed")).toHaveLength(1);
		expect(store.getDomainEvents().filter(it => it.type === "membership.joined")).toHaveLength(1);
	});

	it("keeps existing-account sign-in unchanged and redeems a bound invite before redirect", async () => {
		const existing = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "new-player",
			displayName: "Existing",
		});
		const normalStart = await app.inject({method: "GET", url: "/auth/github/start?returnTo=/hub.html"});
		const normalState = new URL(normalStart.headers.location).searchParams.get("state");
		const normalCallback = await pCallback({
			app,
			state: normalState,
			cookie: getCookie(normalStart, "__Host-hub_oauth"),
		});
		expect(normalCallback.statusCode).toBe(302);
		const normalSession = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: `__Host-hub_session=${getCookie(normalCallback, "__Host-hub_session")}`},
		})).json();
		expect(normalSession.account.id).toBe(existing.id);

		const seeded = await pSeedInvite({store, now});
		const started = await pStartInvite({app, token: seeded.token});
		const callback = await pCallback({app, ...started});
		expect(callback.statusCode).toBe(302);
		expect(await store.pGetMembership({accountId: existing.id, campaignId: seeded.campaign.id}))
			.toEqual(expect.objectContaining({role: "player"}));
	});

	it("rejects unknown identities without admission and collapses invalid invite states", async () => {
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const denied = await pCallback({
			app,
			state: new URL(start.headers.location).searchParams.get("state"),
			cookie: getCookie(start, "__Host-hub_oauth"),
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json()).toEqual({error: "INVITE_ADMISSION_REQUIRED"});
		expect(store._accounts.size).toBe(0);
		expect(store._sessions.size).toBe(0);

		for (const token of ["x".repeat(32), "y".repeat(32)]) {
			const invalid = await pStartInvite({app, token});
			expect(invalid.response.statusCode).toBe(403);
			expect(invalid.response.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});
		}
		expect(store._inviteContexts.size).toBe(0);
		const wrongOrigin = await app.inject({
			method: "POST",
			url: "/api/auth/invite-contexts",
			headers: {origin: "https://evil.example", "x-hub-protocol-version": "5"},
			payload: {token: "z".repeat(32), provider: "github", returnTo: "/hub.html"},
		});
		expect(wrongOrigin.json()).toEqual({error: "INVALID_ORIGIN"});
		const staleProtocol = await app.inject({
			method: "POST",
			url: "/api/auth/invite-contexts",
			headers: {origin: ORIGIN, "x-hub-protocol-version": "4"},
			payload: {token: "z".repeat(32), provider: "github", returnTo: "/hub.html"},
		});
		expect(staleProtocol.json()).toEqual({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: "5"});
	});

	it("matches PostgreSQL duplicate invite-token rejection", async () => {
		const seeded = await pSeedInvite({store, now});
		await expect(store.pCreateInvite({
			accountId: seeded.owner.id,
			campaignId: seeded.campaign.id,
			role: "player",
			tokenHash: getSha256(seeded.token),
			expiresAt: new Date(now.getTime() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "INVITE_TOKEN_CONFLICT", status: 409});
	});

	it("binds one context to one provider transaction and rejects replay", async () => {
		const seeded = await pSeedInvite({store, now});
		const started = await pStartInvite({app, token: seeded.token});
		const transaction = [...store._oauthTransactions.values()].at(-1);
		await expect(store.pCreateOAuthTransaction({
			id: crypto.randomUUID(),
			stateHash: getSha256("second-state"),
			provider: "discord",
			operation: "sign_in",
			redirectUri: `${ORIGIN}/auth/discord/callback`,
			returnTo: "/hub.html",
			inviteContextId: transaction.inviteContextId,
			expiresAt: new Date(now.getTime() + 60_000),
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});

		const callback = await pCallback({app, ...started});
		expect(callback.statusCode).toBe(302);
		const replay = await pCallback({app, ...started});
		expect(replay.statusCode).toBe(400);
		expect(replay.json()).toEqual({error: "INVALID_OAUTH_STATE"});
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(1);
	});

	it("rolls back raced, expired, revoked, and failed callback admission without orphan state", async () => {
		provider.pExchangeCode.mockImplementation(async ({code}) => ({
			provider: "github",
			providerSubject: code,
			login: code,
			displayName: code,
		}));
		const seeded = await pSeedInvite({store, now, maxUses: 1});
		const first = await pStartInvite({app, token: seeded.token});
		const second = await pStartInvite({app, token: seeded.token});
		expect((await pCallback({app, ...first, code: "racer-a"})).statusCode).toBe(302);
		const loser = await pCallback({app, ...second, code: "racer-b"});
		expect(loser.statusCode).toBe(403);
		expect(loser.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});
		expect([...store._externalIdentities.values()].filter(it => it.subject.startsWith("racer-"))).toHaveLength(1);
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(1);

		provider.pExchangeCode.mockRejectedValueOnce(new Error("provider secret"));
		const retrySeed = await pSeedInvite({store, now});
		const failed = await pStartInvite({app, token: retrySeed.token});
		const failedTransaction = [...store._oauthTransactions.values()].at(-1);
		const providerFailure = await pCallback({app, ...failed});
		expect(providerFailure.statusCode).toBe(503);
		expect(providerFailure.json()).toEqual({error: "AUTH_PROVIDER_UNAVAILABLE"});
		expect(store._inviteContexts.get(failedTransaction.inviteContextId).consumedAt).toBeNull();
		expect(store._invites.get(getSha256(retrySeed.token)).useCount).toBe(0);
		await store.pDeleteExpiredOAuthTransactions();
		expect(store._oauthTransactions.has(failedTransaction.id)).toBe(true);
		const postFailureCookieHeader = getFinalCookieHeader(failed.response, providerFailure);
		const retry = await pRetryInvite({
			app,
			retryToken: failed.retryToken,
			cookieHeader: postFailureCookieHeader,
		});
		expect(retry.response.statusCode).toBe(201);
		expect((await pCallback({app, ...retry, code: "retry-player"})).statusCode).toBe(302);
		expect(store._invites.get(getSha256(retrySeed.token)).useCount).toBe(1);

		const expired = await pSeedInvite({
			store,
			now,
			expiresAt: new Date(now.getTime() + 1_000),
		});
		const expiredStart = await pStartInvite({app, token: expired.token});
		now = new Date(now.getTime() + 1_001);
		expect((await pCallback({app, ...expiredStart})).json()).toEqual({error: "INVITE_ADMISSION_INVALID"});

		now = new Date("2026-09-20T00:00:00.000Z");
		const revoked = await pSeedInvite({store, now});
		const revokedStart = await pStartInvite({app, token: revoked.token});
		store._invites.get(getSha256(revoked.token)).revokedAt = now.toISOString();
		const revokedCallback = await pCallback({app, ...revokedStart});
		expect(revokedCallback.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});
		const postRevocationCookieHeader = getFinalCookieHeader(revokedStart.response, revokedCallback);
		expect((await pRetryInvite({
			app,
			retryToken: revokedStart.retryToken,
			cookieHeader: postRevocationCookieHeader,
		})).response.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});
	});

	it("keeps new-account admission default-off while existing identities remain usable", async () => {
		await app.close();
		const seeded = await pSeedInvite({store, now});
		app = await createHubApp({
			store,
			oauthProvider: provider,
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
			},
		});
		const started = await pStartInvite({app, token: seeded.token});
		const blocked = await pCallback({app, ...started});
		expect(blocked.statusCode).toBe(403);
		expect(blocked.json()).toEqual({error: "INVITE_ADMISSION_UNAVAILABLE"});
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(0);
		expect([...store._externalIdentities.values()].some(it => it.subject === "new-player")).toBe(false);

		await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "new-player",
			displayName: "Existing",
		});
		const normalStart = await app.inject({method: "GET", url: "/auth/github/start"});
		expect((await pCallback({
			app,
			state: new URL(normalStart.headers.location).searchParams.get("state"),
			cookie: getCookie(normalStart, "__Host-hub_oauth"),
		})).statusCode).toBe(302);
	});

	it("does not redeem invites for unavailable account states", async () => {
		const existing = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "new-player",
			displayName: "Existing",
		});
		for (const [status, expected] of [
			["deletion_requested", "INVITE_ADMISSION_INVALID"],
			["suspended", "ACCOUNT_UNAVAILABLE"],
			["deleted", "ACCOUNT_UNAVAILABLE"],
		]) {
			store._accounts.get(existing.id).status = status;
			const seeded = await pSeedInvite({store, now});
			const started = await pStartInvite({app, token: seeded.token});
			const response = await pCallback({app, ...started});
			expect(response.statusCode).toBe(403);
			expect(response.json()).toEqual({error: expected});
			expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(0);
		}
		store._accounts.get(existing.id).status = "deletion_requested";
		const normalStart = await app.inject({method: "GET", url: "/auth/github/start"});
		expect((await pCallback({
			app,
			state: new URL(normalStart.headers.location).searchParams.get("state"),
			cookie: getCookie(normalStart, "__Host-hub_oauth"),
		})).statusCode).toBe(302);
	});

	it("supports two fresh concurrent starts under the browser's final shared cookie jar", async () => {
		const existing = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "new-player",
			displayName: "Existing",
		});
		const seeded = await pSeedInvite({store, now});
		const tabA = await pStartInvite({app, token: seeded.token});
		const tabB = await pStartInvite({app, token: seeded.token});
		const finalCookieHeader = getFinalCookieHeader(tabA.response, tabB.response);
		expect((await pCallback({app, ...tabB, cookieHeader: finalCookieHeader})).statusCode).toBe(302);
		expect((await pCallback({app, ...tabA, cookieHeader: finalCookieHeader})).statusCode).toBe(302);
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(1);
		expect(await store.pGetMembership({accountId: existing.id, campaignId: seeded.campaign.id}))
			.toEqual(expect.objectContaining({status: "active"}));
	});

	it("replaces abandoned transactions, rejects old state and cross-browser retry, and expires cleanly", async () => {
		const seeded = await pSeedInvite({store, now});
		const abandoned = await pStartInvite({app, token: seeded.token});
		const crossBrowser = await pRetryInvite({app, retryToken: abandoned.retryToken});
		expect(crossBrowser.response.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});

		const retried = await pRetryInvite({
			app,
			retryToken: abandoned.retryToken,
			cookieHeader: abandoned.cookieHeader,
		});
		expect(retried.response.statusCode).toBe(201);
		expect((await pCallback({app, ...abandoned})).json()).toEqual({error: "INVALID_OAUTH_STATE"});
		expect((await pCallback({app, ...retried})).statusCode).toBe(302);

		const expiring = await pSeedInvite({store, now});
		const expired = await pStartInvite({app, token: expiring.token});
		now = new Date(now.getTime() + 5 * 60_000 + 1);
		const expiredRetry = await pRetryInvite({
			app,
			retryToken: expired.retryToken,
			cookieHeader: expired.cookieHeader,
		});
		expect(expiredRetry.response.json()).toEqual({error: "INVITE_ADMISSION_INVALID"});
	});

	it("preserves correlation through provider cancellation so retry can replace the consumed transaction", async () => {
		const seeded = await pSeedInvite({store, now});
		const started = await pStartInvite({app, token: seeded.token});
		const cancelled = await app.inject({
			method: "GET",
			url: `/auth/github/callback?error=access_denied&state=${encodeURIComponent(started.state)}`,
			headers: {cookie: started.cookieHeader},
		});
		expect(cancelled.json()).toEqual({error: "INVALID_OAUTH_STATE"});
		const postCancellationJar = getFinalCookieHeader(started.response, cancelled);
		const retried = await pRetryInvite({
			app,
			retryToken: started.retryToken,
			cookieHeader: postCancellationJar,
		});
		expect(retried.response.statusCode).toBe(201);
		expect((await pCallback({app, ...retried})).statusCode).toBe(302);
	});

	it("does not let a normal OAuth transaction consume an invite-bound context", async () => {
		const seeded = await pSeedInvite({store, now});
		const inviteStart = await pStartInvite({app, token: seeded.token});
		const normalStart = await app.inject({
			method: "GET",
			url: "/auth/github/start",
			headers: {cookie: `__Host-hub_oauth=${inviteStart.cookie}`},
		});
		const normalCallback = await pCallback({
			app,
			state: new URL(normalStart.headers.location).searchParams.get("state"),
			cookie: getCookie(normalStart, "__Host-hub_oauth"),
		});
		expect(normalCallback.json()).toEqual({error: "INVITE_ADMISSION_REQUIRED"});
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(0);
		expect((await pCallback({app, ...inviteStart})).statusCode).toBe(302);
		expect(store._invites.get(getSha256(seeded.token)).useCount).toBe(1);
	});

	it("strips fragments and invite-shaped query fields from durable return paths", async () => {
		const seeded = await pSeedInvite({store, now});
		for (const returnTo of [
			"/hub.html#invite=secret",
			"/campaign.html?id=00000000-0000-4000-8000-000000000001&inviteContext=secret",
			"/campaign.html?id=not-a-uuid",
		]) {
			const response = await app.inject({
				method: "POST",
				url: "/api/auth/invite-contexts",
				headers: {origin: ORIGIN, "x-hub-protocol-version": "5"},
				payload: {token: seeded.token, provider: "github", returnTo},
			});
			expect(response.statusCode).toBe(201);
			expect([...store._oauthTransactions.values()].at(-1).returnTo).toBe("/hub.html");
		}
	});
});
