import crypto from "node:crypto";
import fs from "node:fs";
import {jest} from "@jest/globals";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const ORIGIN = "https://tools.example";

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

function getOAuthCookieHeader (response, state) {
	const transactionId = state.split(".", 1)[0];
	const cookieName = `__Host-hub_oauth-${transactionId}`;
	return `${cookieName}=${getCookie(response, cookieName)}`;
}

async function pCreateAccount (store, subject, displayName = subject) {
	return store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: subject,
		displayName,
	});
}

async function pCreateFreshSession ({store, account, now, token = crypto.randomBytes(32).toString("hex")}) {
	const [identity] = await store.pListExternalIdentities({accountId: account.id});
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: token,
		expiresAt: new Date(now.getTime() + 60 * 60_000),
		authenticatedViaIdentityId: identity.id,
		recentReauthenticatedAt: now,
	});
	return {session, token};
}

describe("Hub account entitlement memory authority", () => {
	let now;
	let store;
	let operator;
	let target;
	let operatorSession;

	beforeEach(async () => {
		now = new Date("2026-09-20T10:00:00.000Z");
		store = new MemoryHubStore({
			fnNow: () => new Date(now),
			isAccountEntitlementsEnabled: true,
		});
		operator = await pCreateAccount(store, "operator", "Operator");
		target = await pCreateAccount(store, "target", "Target");
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [operator.id]});
		operatorSession = (await pCreateFreshSession({store, account: operator, now})).session;
	});

	it("denies campaign creation before any side effect when creator authority is absent", async () => {
		const before = {
			campaigns: store._campaigns.size,
			memberships: store._memberships.size,
			audit: store._audit.length,
			events: store._events.length,
			outbox: store._outbox.length,
			receipts: store._commandReceipts.size,
		};
		await expect(store.pCreateCampaign({
			accountId: target.id,
			name: "Denied",
			idempotencyKey: "denied-create",
		})).rejects.toMatchObject({code: "CAMPAIGN_CREATE_NOT_ENTITLED", status: 403});
		expect({
			campaigns: store._campaigns.size,
			memberships: store._memberships.size,
			audit: store._audit.length,
			events: store._events.length,
			outbox: store._outbox.length,
			receipts: store._commandReceipts.size,
		}).toEqual(before);
	});

	it("rechecks freshness at commit and rolls back an entitlement grant", async () => {
		store._fnBeforeSensitiveCommit = async () => {
			now = new Date(now.getTime() + 5 * 60_000 + 1);
		};
		await expect(store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
			idempotencyKey: "expired-grant",
		})).rejects.toMatchObject({code: "REAUTHENTICATION_REQUIRED"});
		expect(store._getActiveEntitlement({accountId: target.id, entitlementName: "campaign:create"})).toBeNull();
		expect(store._audit.filter(entry => entry.details?.targetAccountId === target.id)).toHaveLength(0);
	});

	it("rechecks Memory reauthentication authority after awaited work", async () => {
		const transactionId = crypto.randomUUID();
		const stateHash = "c".repeat(64);
		await store.pCreateOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			initiatingAccountId: operator.id,
			initiatingSessionId: operatorSession.id,
			redirectUri: `${ORIGIN}/auth/github/callback`,
			returnTo: "/hub.html",
			expiresAt: new Date(now.getTime() + 1_000),
		});
		await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			redirectUri: `${ORIGIN}/auth/github/callback`,
		});
		const [linkedIdentity] = await store.pListExternalIdentities({accountId: operator.id});
		const sessionCount = store._sessions.size;
		const lastAuthenticatedAt = linkedIdentity.lastAuthenticatedAt;
		store._fnBeforeSensitiveCommit = async () => {
			now = new Date(now.getTime() + 1_001);
		};
		await expect(store.pCompleteOAuthReauthentication({
			identity: {provider: "github", subject: "operator", displayName: "Changed"},
			tokenHash: "d".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
			currentSessionId: operatorSession.id,
			oauthTransactionId: transactionId,
		})).rejects.toMatchObject({code: "REAUTHENTICATION_FAILED"});
		expect(store._sessions.size).toBe(sessionCount);
		expect(await store.pGetSessionById({sessionId: operatorSession.id})).not.toBeNull();
		expect(store._externalIdentities.get(linkedIdentity.id).lastAuthenticatedAt).toBe(lastAuthenticatedAt);
	});

	it("rechecks deletion freshness before any lifecycle side effect", async () => {
		const targetSession = (await pCreateFreshSession({store, account: target, now})).session;
		store._fnBeforeSensitiveCommit = async () => {
			now = new Date(now.getTime() + 5 * 60_000 + 1);
		};
		await expect(store.pRequestAccountDeletion({
			accountId: target.id,
			sessionId: targetSession.id,
			idempotencyKey: "expired-delete",
		})).rejects.toMatchObject({code: "REAUTHENTICATION_REQUIRED"});
		expect((await store.pGetAccountDeletion({accountId: target.id})).status).toBe("active");
		expect(await store.pGetSessionById({sessionId: targetSession.id})).not.toBeNull();
	});

	it("serializes creator revocation against campaign creation", async () => {
		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
			idempotencyKey: "grant-target",
		});
		const revoke = await store.pRevokeAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
			idempotencyKey: "revoke-target",
		});
		expect(revoke.changed).toBe(true);
		await expect(store.pCreateCampaign({
			accountId: target.id,
			name: "Too late",
			idempotencyKey: "post-revoke-create",
		})).rejects.toMatchObject({code: "CAMPAIGN_CREATE_NOT_ENTITLED"});
	});

	it("protects the last operator under self and mutual revocation", async () => {
		await expect(store.pRevokeAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: operator.id,
			entitlementName: "platform:operate",
			idempotencyKey: "self-last",
		})).rejects.toMatchObject({code: "LAST_OPERATOR_PROTECTED"});
		await expect(store.pRequestAccountDeletion({
			accountId: operator.id,
			sessionId: operatorSession.id,
			idempotencyKey: "delete-last",
		})).rejects.toMatchObject({code: "LAST_OPERATOR_PROTECTED"});

		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "platform:operate",
			idempotencyKey: "grant-second-operator",
		});
		const targetSession = (await pCreateFreshSession({store, account: target, now})).session;
		const results = await Promise.allSettled([
			store.pRevokeAccountEntitlement({
				accountId: operator.id,
				sessionId: operatorSession.id,
				targetAccountId: target.id,
				entitlementName: "platform:operate",
				idempotencyKey: "mutual-a",
			}),
			store.pRevokeAccountEntitlement({
				accountId: target.id,
				sessionId: targetSession.id,
				targetAccountId: operator.id,
				entitlementName: "platform:operate",
				idempotencyKey: "mutual-b",
			}),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect([...store._accounts.values()].filter(account => (
			account.status === "active"
			&& store._getActiveEntitlement({accountId: account.id, entitlementName: "platform:operate"})
		))).toHaveLength(1);
	});

	it("checks deletion freshness before last-operator protection", async () => {
		store._sessions.get(operatorSession.tokenHash).recentReauthenticatedAt = new Date(now.getTime() - 5 * 60_000 - 1).toISOString();
		await expect(store.pRequestAccountDeletion({
			accountId: operator.id,
			sessionId: operatorSession.id,
			idempotencyKey: "stale-last-operator-delete",
		})).rejects.toMatchObject({code: "REAUTHENTICATION_REQUIRED", status: 403});
	});

	it("keeps grant/revoke idempotent and reconciliation add-only", async () => {
		const grant = {
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
		};
		const firstGrant = await store.pGrantAccountEntitlement({...grant, idempotencyKey: "grant-one"});
		await store.pGrantAccountEntitlement({...grant, idempotencyKey: "grant-two"});
		expect(store._audit.filter(entry => (
			entry.action === "account.entitlement.granted"
			&& entry.details?.targetAccountId === target.id
			&& entry.details?.entitlementName === "campaign:create"
		))).toHaveLength(1);
		await store.pRevokeAccountEntitlement({...grant, idempotencyKey: "revoke-one"});
		await store.pRevokeAccountEntitlement({...grant, idempotencyKey: "revoke-two"});
		expect(await store.pGrantAccountEntitlement({...grant, idempotencyKey: "grant-one"})).toEqual(firstGrant);
		expect(store._audit.filter(entry => (
			entry.action === "account.entitlement.revoked"
			&& entry.details?.targetAccountId === target.id
		))).toHaveLength(1);

		const warnings = [];
		const missingId = crypto.randomUUID();
		const suspended = await pCreateAccount(store, "suspended", "Suspended");
		const deleting = await pCreateAccount(store, "deleting", "Deleting");
		store._accounts.get(suspended.id).status = "suspended";
		store._accounts.get(deleting.id).status = "deletion_requested";
		store._accounts.get(deleting.id).deletionRequestedAt = now.toISOString();
		store._accounts.get(deleting.id).purgeAfter = new Date(now.getTime() + 60_000).toISOString();
		await store.pReconcileConfiguredOperatorEntitlements({
			accountIds: [operator.id, suspended.id, deleting.id, missingId],
			onWarning: warning => warnings.push(warning),
		});
		expect(warnings).toEqual([
			{code: "CONFIGURED_OPERATOR_ACCOUNT_NOT_FOUND", accountId: suspended.id},
			{code: "CONFIGURED_OPERATOR_ACCOUNT_NOT_FOUND", accountId: deleting.id},
			{code: "CONFIGURED_OPERATOR_ACCOUNT_NOT_FOUND", accountId: missingId},
		]);
		expect(store._getActiveEntitlement({accountId: suspended.id, entitlementName: "platform:operate"})).toBeNull();
		expect(store._getActiveEntitlement({accountId: deleting.id, entitlementName: "platform:operate"})).toBeNull();
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: []});
		expect(store._getActiveEntitlement({accountId: operator.id, entitlementName: "platform:operate"})).not.toBeNull();
	});

	it("serializes duplicate commands and deletion against revocation across awaited hooks", async () => {
		let releaseHook;
		let enterHook;
		const entered = new Promise(resolve => { enterHook = resolve; });
		const release = new Promise(resolve => { releaseHook = resolve; });
		let shouldBlock = true;
		store._fnBeforeSensitiveCommit = async () => {
			if (!shouldBlock) return;
			shouldBlock = false;
			enterHook();
			await release;
		};
		const grant = {
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
		};
		const firstGrant = store.pGrantAccountEntitlement({...grant, idempotencyKey: "interleaved-grant-a"});
		await entered;
		const secondGrant = store.pGrantAccountEntitlement({...grant, idempotencyKey: "interleaved-grant-b"});
		releaseHook();
		const grants = await Promise.all([firstGrant, secondGrant]);
		expect(grants.map(result => result.changed).sort()).toEqual([false, true]);
		expect(store._audit.filter(entry => (
			entry.action === "account.entitlement.granted"
			&& entry.details?.targetAccountId === target.id
			&& entry.details?.entitlementName === "campaign:create"
		))).toHaveLength(1);

		store._fnBeforeSensitiveCommit = null;
		await store.pGrantAccountEntitlement({
			...grant,
			entitlementName: "platform:operate",
			idempotencyKey: "grant-target-operator-for-delete-race",
		});
		const targetSession = (await pCreateFreshSession({store, account: target, now})).session;
		let releaseDeletion;
		let enterDeletion;
		const deletionEntered = new Promise(resolve => { enterDeletion = resolve; });
		const deletionRelease = new Promise(resolve => { releaseDeletion = resolve; });
		store._fnBeforeSensitiveCommit = async () => {
			enterDeletion();
			await deletionRelease;
		};
		const deletion = store.pRequestAccountDeletion({
			accountId: target.id,
			sessionId: targetSession.id,
			idempotencyKey: "interleaved-delete",
		});
		await deletionEntered;
		const revoke = store.pRevokeAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "platform:operate",
			idempotencyKey: "interleaved-revoke",
		});
		releaseDeletion();
		await expect(Promise.all([deletion, revoke])).resolves.toHaveLength(2);
		expect((await store.pGetAccountDeletion({accountId: target.id})).status).toBe("deletion_requested");
		expect(store._getActiveEntitlement({accountId: target.id, entitlementName: "platform:operate"})).toBeNull();
	});

	it("purges a non-last operator and nulls entitlement actor references", async () => {
		const recipient = await pCreateAccount(store, "recipient", "Recipient");
		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "platform:operate",
			idempotencyKey: "grant-target-operator",
		});
		store._commandReceipts.set(`${operator.id}::legacy-target-receipt`, {
			requestHash: "legacy",
			response: {account: {id: target.id, displayName: target.displayName}, changed: true},
		});
		const targetSession = (await pCreateFreshSession({store, account: target, now})).session;
		await store.pGrantAccountEntitlement({
			accountId: target.id,
			sessionId: targetSession.id,
			targetAccountId: recipient.id,
			entitlementName: "campaign:create",
			idempotencyKey: "target-actor-grant",
		});
		await store.pRequestAccountDeletion({
			accountId: target.id,
			sessionId: targetSession.id,
			idempotencyKey: "delete-non-last",
			graceMs: 0,
		});
		expect((await store.pPurgeDueAccounts()).purgedAccountIds).toEqual([target.id]);
		expect([...store._accountEntitlements.values()]
			.filter(entitlement => entitlement.accountId === recipient.id)
			.every(entitlement => entitlement.grantedByAccountId !== target.id)).toBe(true);
		expect([...store._commandReceipts.values()]
			.some(receipt => receipt.response?.account?.id === target.id)).toBe(false);
	});

	it("exports own entitlements without other-account entitlement audit identifiers", async () => {
		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
			idempotencyKey: "grant-export",
		});
		const exported = await store.pExportAccountData({accountId: operator.id});
		const entitlementAudit = exported.auditEntries.find(entry => entry.action === "account.entitlement.granted" && entry.details?.entitlementName === "campaign:create");
		expect(entitlementAudit.details).not.toHaveProperty("targetAccountId");
		expect(exported.entitlements.map(entry => entry.entitlementName)).toEqual(expect.arrayContaining([
			"campaign:create",
			"platform:operate",
		]));
		const targetExport = await store.pExportAccountData({accountId: target.id});
		expect(targetExport.entitlements[0]).not.toHaveProperty("grantedByAccountId");
		expect(targetExport.entitlements[0]).not.toHaveProperty("revokedByAccountId");
		expect(JSON.stringify(targetExport)).not.toContain(operator.id);
	});
});

describe("Hub account entitlement routes and reauthentication", () => {
	let app;
	let store;
	let identity;
	let operator;
	let target;
	let realtime;

	beforeEach(async () => {
		store = new MemoryHubStore();
		operator = await pCreateAccount(store, "route-operator", "Route Operator");
		target = await pCreateAccount(store, "route-target", "Route Target");
		identity = {provider: "github", providerSubject: "route-operator", displayName: "Route Operator"};
		realtime = {
			closeSession: jest.fn(),
			closeAccount: jest.fn(),
			getConnectionCount: () => 0,
			stop: jest.fn(),
		};
		app = await createHubApp({
			store,
			realtime,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://provider.example/authorize?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				isAccountEntitlementsEnabled: true,
				operatorAccountIds: [operator.id],
			},
		});
	});

	afterEach(async () => app.close());

	async function pSignIn (accountIdentity = identity) {
		identity = accountIdentity;
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${state}`,
			headers: {cookie: getOAuthCookieHeader(start, state)},
		});
		const sessionCookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie: sessionCookie}})).json();
		return {cookie: sessionCookie, ...session};
	}

	function mutationHeaders (session, idempotencyKey = crypto.randomUUID()) {
		return {
			cookie: session.cookie,
			origin: ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "5",
			"idempotency-key": idempotencyKey,
		};
	}

	async function pReauthenticate (session) {
		const started = await app.inject({
			method: "POST",
			url: "/api/account/reauthentication/github",
			headers: mutationHeaders(session),
			payload: {returnTo: "/hub.html"},
		});
		const state = new URL(started.json().authorizationUrl).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${state}`,
			headers: {
				cookie: `${session.cookie}; ${getOAuthCookieHeader(started, state)}`,
			},
		});
		const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const refreshed = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
		return {started, callback, session: {cookie, ...refreshed}};
	}

	it("rotates the current session and rejects wrong-account and mismatched-session callbacks", async () => {
		const signedIn = await pSignIn();
		const oldSessionId = [...store._sessions.values()].find(session => !session.revokedAt).id;
		const successful = await pReauthenticate(signedIn);
		expect(successful.started.statusCode).toBe(201);
		expect(successful.callback.statusCode).toBe(302);
		expect(successful.session.csrfToken).not.toBe(signedIn.csrfToken);
		expect(await store.pGetSessionById({sessionId: oldSessionId})).toBeNull();
		expect(realtime.closeSession).toHaveBeenCalledWith({sessionId: oldSessionId});

		const wrongStart = await app.inject({
			method: "POST",
			url: "/api/account/reauthentication/github",
			headers: mutationHeaders(successful.session),
			payload: {returnTo: "/hub.html"},
		});

		identity = {provider: "github", providerSubject: "route-target", displayName: "Route Target"};
		const wrongState = new URL(wrongStart.json().authorizationUrl).searchParams.get("state");
		const wrong = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${wrongState}`,
			headers: {
				cookie: `${successful.session.cookie}; ${getOAuthCookieHeader(wrongStart, wrongState)}`,
			},
		});
		expect(wrong.statusCode).toBe(403);
		expect(wrong.json()).toEqual({error: "REAUTHENTICATION_FAILED"});

		identity = {provider: "github", providerSubject: "route-operator", displayName: "Route Operator"};
		const mismatchStart = await app.inject({
			method: "POST",
			url: "/api/account/reauthentication/github",
			headers: mutationHeaders(successful.session),
			payload: {returnTo: "/hub.html"},
		});
		const replacement = await pSignIn(identity);
		const mismatchState = new URL(mismatchStart.json().authorizationUrl).searchParams.get("state");
		const mismatch = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${mismatchState}`,
			headers: {
				cookie: `${replacement.cookie}; ${getOAuthCookieHeader(mismatchStart, mismatchState)}`,
			},
		});
		expect(mismatch.statusCode).toBe(403);
		expect(mismatch.json()).toEqual({error: "REAUTHENTICATION_FAILED"});
	});

	it("rejects completion after a consumed reauthentication transaction expires", async () => {
		const signedIn = await pSignIn();
		const current = [...store._sessions.values()].find(session => !session.revokedAt);
		const [linkedIdentity] = await store.pListExternalIdentities({accountId: operator.id});
		const transactionId = crypto.randomUUID();
		const stateHash = "a".repeat(64);
		await store.pCreateOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			initiatingAccountId: operator.id,
			initiatingSessionId: current.id,
			redirectUri: `${ORIGIN}/auth/github/callback`,
			returnTo: "/hub.html",
			expiresAt: new Date(Date.now() + 1_000),
		});
		await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			redirectUri: `${ORIGIN}/auth/github/callback`,
		});
		store._oauthTransactions.get(transactionId).expiresAt = new Date(Date.now() - 1).toISOString();
		const lastAuthenticatedAt = linkedIdentity.lastAuthenticatedAt;
		await expect(store.pCompleteOAuthReauthentication({
			identity: {provider: "github", subject: "route-operator", displayName: "Changed"},
			tokenHash: "b".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
			currentSessionId: current.id,
			oauthTransactionId: transactionId,
		})).rejects.toMatchObject({code: "REAUTHENTICATION_FAILED"});
		expect(await store.pGetSessionById({sessionId: current.id})).not.toBeNull();
		expect(store._externalIdentities.get(linkedIdentity.id).lastAuthenticatedAt).toBe(lastAuthenticatedAt);
		expect(signedIn.signedIn).toBe(true);
	});

	it("hides operator routes and requires fresh reauthentication", async () => {
		const operatorSession = await pSignIn();
		const stale = await app.inject({
			method: "GET",
			url: "/api/operator/accounts",
			headers: {cookie: operatorSession.cookie, "x-hub-protocol-version": "5"},
		});
		expect(stale.statusCode).toBe(403);
		expect(stale.json()).toEqual({error: "REAUTHENTICATION_REQUIRED"});

		const nonoperator = await pSignIn({
			provider: "github",
			providerSubject: "route-target",
			displayName: "Route Target",
		});
		const hidden = await app.inject({
			method: "GET",
			url: "/api/operator/accounts",
			headers: {cookie: nonoperator.cookie, "x-hub-protocol-version": "5"},
		});
		expect(hidden.statusCode).toBe(404);
		expect(hidden.json()).toEqual({error: "NOT_FOUND"});

		identity = {provider: "github", providerSubject: "route-operator", displayName: "Route Operator"};
		const {session: freshOperator} = await pReauthenticate(operatorSession);
		const accounts = await app.inject({
			method: "GET",
			url: "/api/operator/accounts",
			headers: {cookie: freshOperator.cookie, "x-hub-protocol-version": "5"},
		});
		expect(accounts.statusCode).toBe(200);
		expect(accounts.json().accounts.find(account => account.id === target.id)).toEqual(expect.objectContaining({
			entitlements: [],
		}));
		const granted = await app.inject({
			method: "POST",
			url: `/api/operator/accounts/${target.id}/entitlements/campaign%3Acreate/grant`,
			headers: mutationHeaders(freshOperator, "route-grant"),
		});
		expect(granted.statusCode).toBe(200);
		expect(granted.json()).toEqual({
			account: expect.objectContaining({
				id: target.id,
				entitlements: ["campaign:create"],
			}),
			changed: true,
		});

		const unknown = crypto.randomUUID();
		const operatorUnknown = await app.inject({
			method: "POST",
			url: `/api/operator/accounts/${unknown}/entitlements/campaign%3Acreate/grant`,
			headers: mutationHeaders(freshOperator, "unknown-operator"),
		});
		expect(operatorUnknown.statusCode).toBe(404);
		expect(operatorUnknown.json()).toEqual({error: "ACCOUNT_NOT_FOUND"});
		const nonoperatorUnknown = await app.inject({
			method: "POST",
			url: `/api/operator/accounts/${unknown}/entitlements/campaign%3Acreate/grant`,
			headers: mutationHeaders(nonoperator, "unknown-nonoperator"),
		});
		expect(nonoperatorUnknown.statusCode).toBe(404);
		expect(nonoperatorUnknown.json()).toEqual({error: "NOT_FOUND"});
	});

	it("requires exact mutation security for reauthentication", async () => {
		const session = await pSignIn();
		const transactionCount = store._oauthTransactions.size;
		for (const [headers, expected] of [
			[{cookie: session.cookie, "x-csrf-token": session.csrfToken, "x-hub-protocol-version": "5"}, "INVALID_ORIGIN"],
			[{cookie: session.cookie, origin: ORIGIN, "x-csrf-token": "wrong", "x-hub-protocol-version": "5"}, "INVALID_CSRF"],
			[{cookie: session.cookie, origin: ORIGIN, "x-csrf-token": session.csrfToken, "x-hub-protocol-version": "3"}, "PROTOCOL_UPDATE_REQUIRED"],
		]) {
			const response = await app.inject({
				method: "POST",
				url: "/api/account/reauthentication/github",
				headers,
				payload: {returnTo: "/hub.html"},
			});
			expect(response.json().error).toBe(expected);
		}
		expect(store._oauthTransactions.size).toBe(transactionCount);
	});

	it("limits deletion-grace authentication to export and cancellation", async () => {
		const operatorSession = await pSignIn();
		const {session: freshOperator} = await pReauthenticate(operatorSession);
		await app.inject({
			method: "POST",
			url: `/api/operator/accounts/${target.id}/entitlements/platform%3Aoperate/grant`,
			headers: mutationHeaders(freshOperator, "grant-target-operator"),
		});
		const targetSession = await pSignIn({
			provider: "github",
			providerSubject: "route-target",
			displayName: "Route Target",
		});
		const {session: freshTarget} = await pReauthenticate(targetSession);
		const requested = await app.inject({
			method: "POST",
			url: "/api/account/deletion/request",
			headers: mutationHeaders(freshTarget, "delete-target"),
			payload: {confirmation: "DELETE"},
		});
		expect(requested.statusCode).toBe(200);

		const grace = await pSignIn({
			provider: "github",
			providerSubject: "route-target",
			displayName: "Route Target",
		});
		const graceReauthentication = await app.inject({
			method: "POST",
			url: "/api/account/reauthentication/github",
			headers: mutationHeaders(grace, "grace-reauthentication"),
			payload: {returnTo: "/hub.html?accountAction=cancel-deletion"},
		});
		expect(graceReauthentication.statusCode).toBe(201);
		expect((await app.inject({
			method: "GET",
			url: "/api/operator/accounts",
			headers: {cookie: grace.cookie, "x-hub-protocol-version": "5"},
		})).json()).toEqual({error: "NOT_FOUND"});
		expect((await app.inject({
			method: "GET",
			url: "/api/account/export",
			headers: {cookie: grace.cookie},
		})).statusCode).toBe(200);
		expect((await app.inject({
			method: "POST",
			url: "/api/account/deletion/cancel",
			headers: mutationHeaders(grace, "cancel-target"),
		})).statusCode).toBe(200);
	});

	it("advertises and projects entitlements only when enabled", async () => {
		const session = await pSignIn();
		expect(session.capabilities).toContain("account.entitlements.v1");
		expect(session.entitlements).toEqual(expect.arrayContaining(["campaign:create", "platform:operate"]));
		expect(session.reauthenticationProviders).toEqual(["github"]);
		expect((await app.inject({method: "GET", url: "/api/meta"})).json().capabilities)
			.toContain("account.entitlements.v1");
	});
});

describe("Hub account entitlement startup gates", () => {
	const provider = {
		getAuthorizationUrl: ({state}) => `https://provider.example/authorize?state=${state}`,
		pExchangeCode: async () => ({
			provider: "github",
			providerSubject: "startup",
			displayName: "Startup",
		}),
	};
	const config = {
		appOrigin: ORIGIN,
		cookieSecret: "c".repeat(32),
		csrfSecret: "s".repeat(32),
	};

	it("keeps entitlement enforcement and API exposure default-off", async () => {
		const store = new MemoryHubStore();
		const account = await pCreateAccount(store, "default-off", "Default Off");
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [account.id]});
		const session = (await pCreateFreshSession({store, account, now: new Date()})).session;
		const app = await createHubApp({store, oauthProvider: provider, config});
		try {
			expect((await app.inject({method: "GET", url: "/api/meta"})).json().capabilities)
				.not.toContain("account.entitlements.v1");
			expect((await app.inject({method: "GET", url: "/api/operator/accounts"})).statusCode).toBe(404);
			await expect(store.pCreateCampaign({
				accountId: account.id,
				name: "Legacy creation",
				idempotencyKey: "default-off-create",
			})).resolves.toHaveProperty("campaign");
			await expect(store.pRequestAccountDeletion({
				accountId: account.id,
				sessionId: session.id,
				idempotencyKey: "default-off-last-operator-delete",
			})).rejects.toMatchObject({code: "LAST_OPERATOR_PROTECTED", status: 409});
		} finally {
			await app.close();
		}
	});

	it("fails invite-admission startup without enforcement or an active operator", async () => {
		await expect(createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: provider,
			config: {...config, isInviteAccountAdmissionEnabled: true},
		})).rejects.toThrow(/requires account entitlement enforcement/i);

		await expect(createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: provider,
			config: {
				...config,
				isAccountEntitlementsEnabled: true,
			},
		})).rejects.toThrow(/requires an active platform operator/i);

		const store = new MemoryHubStore();
		const deleting = await pCreateAccount(store, "startup-deleting", "Deleting");
		store._accounts.get(deleting.id).status = "deletion_requested";
		store._accounts.get(deleting.id).deletionRequestedAt = new Date().toISOString();
		store._accounts.get(deleting.id).purgeAfter = new Date(Date.now() + 60_000).toISOString();
		await expect(createHubApp({
			store,
			oauthProvider: provider,
			config: {
				...config,
				isInviteAccountAdmissionEnabled: true,
				isAccountEntitlementsEnabled: true,
				operatorAccountIds: [deleting.id],
			},
		})).rejects.toThrow(/requires an active platform operator/i);
		expect(await store.pHasActivePlatformOperator()).toBe(false);
	});

	it("wires the production environment names through the entrypoint", () => {
		const source = fs.readFileSync(new URL("../../../server/src/index.js", import.meta.url), "utf8");
		expect(source).toContain("HUB_ACCOUNT_ENTITLEMENTS_ENABLED");
		expect(source).toContain("HUB_OPERATOR_ACCOUNT_IDS");
		expect(source).toContain("isAccountEntitlementsEnabled");
		expect(source).toContain("operatorAccountIds");
		expect(source).toContain("pReconcileConfiguredOperatorEntitlements");
		expect(source).toContain("pHasActivePlatformOperator");
	});
});

describe("migration 0009 account entitlement contract", () => {
	const sql = fs.readFileSync(new URL("../../../server/migrations/0009_account_entitlements.sql", import.meta.url), "utf8");

	it("backfills campaign owners across every current campaign status, not role-only DMs", () => {
		expect(sql).toMatch(/SELECT DISTINCT c\.owner_account_id/);
		expect(sql).toMatch(/c\.status IN \('active', 'archived', 'deleting'\)/);
		expect(sql).not.toMatch(/memberships[\s\S]{0,200}campaign_owner_backfill/);
		expect(sql).toContain("campaign_owner_backfill");
	});

	it("uses cascading ownership, nullable actors, one active row, and a deferred operator backstop", () => {
		expect(sql).toMatch(/account_id uuid NOT NULL REFERENCES hub\.accounts\(id\) ON DELETE CASCADE/);
		expect(sql.match(/REFERENCES hub\.accounts\(id\) ON DELETE SET NULL/g)).toHaveLength(2);
		expect(sql).toMatch(/CREATE UNIQUE INDEX account_entitlements_active_key[\s\S]*WHERE revoked_at IS NULL/);
		expect(sql).toMatch(/DEFERRABLE INITIALLY DEFERRED/g);
		expect(sql).toContain("pg_try_advisory_xact_lock(hashtextextended('account-entitlements', 9))");
		expect(sql).toContain("At least one active platform operator is required.");
	});
});
