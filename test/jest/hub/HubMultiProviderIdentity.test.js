import crypto from "node:crypto";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getSha256} from "../../../server/src/security.js";

describe("Hub provider-neutral identity and OAuth transaction authority", () => {
	let now;
	let store;

	beforeEach(() => {
		now = new Date("2026-09-03T00:00:00.000Z");
		store = new MemoryHubStore({fnNow: () => new Date(now)});
	});

	async function pCreateFreshAccount ({
		provider = "github",
		subject = "owner",
		displayName = "Owner",
		tokenHash = crypto.randomBytes(32).toString("hex"),
	}) {
		const account = await store.pUpsertOAuthAccount({
			provider,
			providerSubject: subject,
			displayName,
		});
		const [identity] = await store.pListExternalIdentities({accountId: account.id});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash,
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			authenticatedViaIdentityId: identity.id,
			recentReauthenticatedAt: now,
		});
		return {account, identity, session, tokenHash};
	}

	async function pCreateConsumedLink ({accountId, sessionId, provider, key = crypto.randomUUID()}) {
		const id = crypto.randomUUID();
		const state = `link-${id}`;
		await store.pCreateOAuthLinkTransaction({
			accountId,
			sessionId,
			transaction: {
				id,
				stateHash: getSha256(state),
				provider,
				redirectUri: `https://tools.example/auth/${provider}/callback`,
				returnTo: "/hub.html",
				pkceVerifier: provider === "discord" ? null : "v".repeat(64),
				oidcNonce: provider === "google" ? "n".repeat(32) : null,
				expiresAt: new Date(now.getTime() + 5 * 60_000),
			},
			idempotencyKey: key,
		});
		await store.pConsumeOAuthTransaction({
			id,
			stateHash: getSha256(state),
			provider,
			operation: "link",
			redirectUri: `https://tools.example/auth/${provider}/callback`,
		});
		return id;
	}

	it("selects accounts only by provider and immutable subject", async () => {
		const first = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "100",
			displayName: "First",
			login: "first",
			email: "same@example.com",
		});
		const renamed = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "100",
			displayName: "Renamed",
			login: "renamed",
			email: "changed@example.com",
		});
		const sameEmailDifferentSubject = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "101",
			displayName: "Other",
			email: "same@example.com",
		});
		const sameSubjectDifferentProvider = await store.pUpsertOAuthAccount({
			provider: "discord",
			providerSubject: "100",
			displayName: "Discord",
			email: "same@example.com",
		});
		const googleWithSameProfile = await store.pUpsertOAuthAccount({
			provider: "google",
			providerSubject: "google-subject",
			displayName: "Renamed",
			login: "renamed",
			email: "same@example.com",
		});

		expect(renamed.id).toBe(first.id);
		expect(renamed.displayName).toBe("First");
		expect(sameEmailDifferentSubject.id).not.toBe(first.id);
		expect(sameSubjectDifferentProvider.id).not.toBe(first.id);
		expect(googleWithSameProfile.id).not.toBe(first.id);
		expect(new Set([
			first.id,
			sameEmailDifferentSubject.id,
			sameSubjectDifferentProvider.id,
			googleWithSameProfile.id,
		]).size).toBe(4);
	});

	it("creates identity provenance and rotates a prior session atomically", async () => {
		await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "200",
			displayName: "Player",
		});
		const firstTokenHash = "a".repeat(64);
		const first = await store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: "200", displayName: "Player", handle: "player"},
			tokenHash: firstTokenHash,
			expiresAt: new Date(now.getTime() + 60_000),
		});
		now = new Date(now.getTime() + 1_000);
		const second = await store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: "200", displayName: "Player Two", handle: "player-two"},
			tokenHash: "b".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
			priorSessionId: first.session.id,
		});

		expect(second.account.id).toBe(first.account.id);
		expect(second.identity.id).toBe(first.identity.id);
		expect(second.session.authenticatedViaIdentityId).toBe(first.identity.id);
		expect(second.revokedSessionIds).toEqual([first.session.id]);
		expect(await store.pGetSessionByTokenHash({tokenHash: firstTokenHash})).toBeNull();

		const exported = await store.pExportAccountData({accountId: first.account.id});
		expect(exported.externalIdentities).toEqual([
			expect.objectContaining({
				provider: "github",
				subject: "200",
				handle: "player-two",
				displayName: "Player Two",
			}),
		]);
		expect(exported.sessions).toHaveLength(2);
		expect(JSON.stringify(exported)).not.toContain(firstTokenHash);
	});

	it("binds and atomically consumes expiring OAuth state once", async () => {
		const id = crypto.randomUUID();
		const stateHash = getSha256("raw-state");
		await store.pCreateOAuthTransaction({
			id,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html#invite",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(now.getTime() + 10 * 60_000),
		});

		await expect(store.pConsumeOAuthTransaction({
			id,
			stateHash,
			provider: "wrong",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});

		const consumed = await store.pConsumeOAuthTransaction({
			id,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		expect(consumed).toEqual(expect.objectContaining({
			pkceVerifier: "v".repeat(64),
			returnTo: "/hub.html#invite",
		}));
		expect(store._oauthTransactions.get(id)).toEqual(expect.objectContaining({
			stateHash: null,
			pkceVerifier: null,
			oidcNonce: null,
			consumedAt: expect.any(String),
		}));
		await expect(store.pConsumeOAuthTransaction({
			id,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(0);
		now = new Date(now.getTime() + 10 * 60_000 + 1);
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(1);
	});

	it("keeps OAuth cleanup-backlog metrics aligned with cleanup eligibility", async () => {
		const consumedId = crypto.randomUUID();
		const expiredId = crypto.randomUUID();
		const activeId = crypto.randomUUID();
		for (const [id, state, expiresIn] of [
			[consumedId, "consumed-metric", 10 * 60_000],
			[expiredId, "expired-metric", 60_000],
			[activeId, "active-metric", 10 * 60_000],
		]) {
			await store.pCreateOAuthTransaction({
				id,
				stateHash: getSha256(state),
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				expiresAt: new Date(now.getTime() + expiresIn),
			});
		}
		await store.pConsumeOAuthTransaction({
			id: consumedId,
			stateHash: getSha256("consumed-metric"),
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		now = new Date(now.getTime() + 60_001);

		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(1);
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(1);
		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(0);
		expect(store._oauthTransactions.has(consumedId)).toBe(true);
		expect(store._oauthTransactions.has(activeId)).toBe(true);
	});

	it("rejects expired or improperly account-bound transactions", async () => {
		const account = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "300",
			displayName: "Player",
		});

		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: "c".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
		});
		await expect(store.pCreateOAuthTransaction({
			id: crypto.randomUUID(),
			stateHash: getSha256("link"),
			provider: "github",
			operation: "link",
			initiatingAccountId: account.id,
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
		})).rejects.toThrow(/Invalid OAuth transaction/);

		const id = crypto.randomUUID();
		await store.pCreateOAuthTransaction({
			id,
			stateHash: getSha256("reauth"),
			provider: "github",
			operation: "reauthenticate",
			initiatingAccountId: account.id,
			initiatingSessionId: session.id,
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
		});
		now = new Date(now.getTime() + 60_001);
		await expect(store.pConsumeOAuthTransaction({
			id,
			stateHash: getSha256("reauth"),
			provider: "github",
			operation: "reauthenticate",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});
	});

	it("enforces the same durable redirect bounds as PostgreSQL", async () => {
		await expect(store.pCreateOAuthTransaction({
			id: crypto.randomUUID(),
			stateHash: getSha256("long-return"),
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: `/${"x".repeat(2_048)}`,
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(now.getTime() + 60_000),
		})).rejects.toThrow(/Invalid OAuth transaction/);
	});

	it("links an unknown subject only to the initiating account and rotates every old session and lease", async () => {
		const owner = await pCreateFreshAccount({subject: "link-owner", displayName: "Stable owner"});
		const otherSession = await store.pCreateSession({
			accountId: owner.account.id,
			tokenHash: "d".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			authenticatedViaIdentityId: owner.identity.id,
		});
		store._characterLeases.set("character-1", {sessionId: owner.session.id});
		store._dmWorkspaceLeases.set("workspace-1", {sessionId: otherSession.id});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const accountCount = store._accounts.size;
		const completed = await store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "google-link-owner", displayName: "Changed provider name"},
			tokenHash: "e".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});

		expect(store._accounts.size).toBe(accountCount);
		expect(completed.account.displayName).toBe("Stable owner");
		expect(completed.identity).toEqual(expect.objectContaining({
			accountId: owner.account.id,
			provider: "google",
			subject: "google-link-owner",
		}));
		expect(completed.session).toEqual(expect.objectContaining({
			authenticatedViaIdentityId: completed.identity.id,
			recentReauthenticatedAt: expect.any(String),
		}));
		expect(new Set(completed.revokedSessionIds)).toEqual(new Set([owner.session.id, otherSession.id]));
		expect(store._characterLeases.size).toBe(0);
		expect(store._dmWorkspaceLeases.size).toBe(0);
		expect(store._audit.filter(entry => entry.action === "identity.linked")).toEqual([
			expect.objectContaining({
				targetId: completed.identity.id,
				details: {provider: "google"},
			}),
		]);
		expect(JSON.stringify(store._audit)).not.toContain("google-link-owner");
	});

	it("rejects a subject owned by another account without creating an account, identity, or audit", async () => {
		const owner = await pCreateFreshAccount({subject: "conflict-owner"});
		await store.pUpsertOAuthAccount({
			provider: "discord",
			providerSubject: "9001",
			displayName: "Other account",
		});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "discord",
		});
		const before = {
			accounts: store._accounts.size,
			identities: store._externalIdentities.size,
			audits: store._audit.length,
		};

		await expect(store.pCompleteOAuthLink({
			identity: {provider: "discord", subject: "9001", displayName: "Other account"},
			tokenHash: "f".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "discord"],
		})).rejects.toMatchObject({code: "IDENTITY_ALREADY_LINKED"});
		expect({
			accounts: store._accounts.size,
			identities: store._externalIdentities.size,
			audits: store._audit.length,
		}).toEqual(before);
	});

	it("allows only one winner when two accounts concurrently link the same subject", async () => {
		const firstOwner = await pCreateFreshAccount({subject: "link-racer-a"});
		const secondOwner = await pCreateFreshAccount({subject: "link-racer-b"});
		const firstTransactionId = await pCreateConsumedLink({
			accountId: firstOwner.account.id,
			sessionId: firstOwner.session.id,
			provider: "google",
		});
		const secondTransactionId = await pCreateConsumedLink({
			accountId: secondOwner.account.id,
			sessionId: secondOwner.session.id,
			provider: "google",
		});
		const results = await Promise.allSettled([
			store.pCompleteOAuthLink({
				identity: {provider: "google", subject: "shared-link-subject"},
				tokenHash: "2".repeat(64),
				expiresAt: new Date(now.getTime() + 60 * 60_000),
				currentAccountId: firstOwner.account.id,
				currentSessionId: firstOwner.session.id,
				oauthTransactionId: firstTransactionId,
				availableProviders: ["github", "google"],
			}),
			store.pCompleteOAuthLink({
				identity: {provider: "google", subject: "shared-link-subject"},
				tokenHash: "3".repeat(64),
				expiresAt: new Date(now.getTime() + 60 * 60_000),
				currentAccountId: secondOwner.account.id,
				currentSessionId: secondOwner.session.id,
				oauthTransactionId: secondTransactionId,
				availableProviders: ["github", "google"],
			}),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")[0].reason)
			.toEqual(expect.objectContaining({code: "IDENTITY_ALREADY_LINKED"}));
		expect([...store._externalIdentities.values()]
			.filter(identity => identity.provider === "google" && identity.subject === "shared-link-subject"))
			.toHaveLength(1);
	});

	it("replays one link command without duplicating the identity or audit", async () => {
		const owner = await pCreateFreshAccount({subject: "replay-owner"});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const request = {
			identity: {provider: "google", subject: "replay-google", displayName: "Replay"},
			tokenHash: "1".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		};
		const first = await store.pCompleteOAuthLink(request);
		const replay = await store.pCompleteOAuthLink({...request, tokenHash: "2".repeat(64)});
		expect(replay).toEqual(first);
		expect((await store.pListExternalIdentities({accountId: owner.account.id}))
			.filter(identity => identity.provider === "google")).toHaveLength(1);
		expect(store._audit.filter(entry => entry.action === "identity.linked")).toHaveLength(1);
	});

	it("rechecks link freshness and provider availability at the sensitive commit", async () => {
		const owner = await pCreateFreshAccount({subject: "freshness-owner"});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const ownerSession = [...store._sessions.values()].find(session => session.id === owner.session.id);
		ownerSession.recentReauthenticatedAt = new Date(now.getTime() - 4 * 60_000).toISOString();
		store._fnBeforeSensitiveCommit = async () => now = new Date(now.getTime() + 60_001);
		await expect(store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "freshness-google"},
			tokenHash: "3".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		})).rejects.toMatchObject({code: "REAUTHENTICATION_REQUIRED"});
		expect((await store.pListExternalIdentities({accountId: owner.account.id})).map(identity => identity.provider))
			.toEqual(["github"]);

		store._fnBeforeSensitiveCommit = null;
		now = new Date("2026-09-03T00:00:00.000Z");
		const nextOwner = await pCreateFreshAccount({subject: "disabled-owner"});
		const disabledTransactionId = await pCreateConsumedLink({
			accountId: nextOwner.account.id,
			sessionId: nextOwner.session.id,
			provider: "google",
		});
		await expect(store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "disabled-google"},
			tokenHash: "4".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: nextOwner.account.id,
			currentSessionId: nextOwner.session.id,
			oauthTransactionId: disabledTransactionId,
			availableProviders: ["github"],
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});
		expect((await store.pListExternalIdentities({accountId: nextOwner.account.id})).map(identity => identity.provider))
			.toEqual(["github"]);
	});

	it("protects the current reauthentication identity, the last identity, and retention providers on unlink", async () => {
		const owner = await pCreateFreshAccount({subject: "unlink-owner"});
		await expect(store.pUnlinkExternalIdentity({
			accountId: owner.account.id,
			currentSessionId: owner.session.id,
			identityId: owner.identity.id,
			tokenHash: "5".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			idempotencyKey: "unlink-current",
			retentionRequiredProviders: ["github"],
		})).rejects.toMatchObject({code: "LAST_IDENTITY_PROTECTED"});

		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const linked = await store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "unlink-google"},
			tokenHash: "6".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});
		await expect(store.pUnlinkExternalIdentity({
			accountId: owner.account.id,
			currentSessionId: linked.session.id,
			identityId: linked.identity.id,
			tokenHash: "7".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			idempotencyKey: "unlink-current",
			retentionRequiredProviders: ["github"],
		})).rejects.toMatchObject({code: "REAUTHENTICATION_IDENTITY_CONFLICT"});
		await expect(store.pUnlinkExternalIdentity({
			accountId: owner.account.id,
			currentSessionId: linked.session.id,
			identityId: owner.identity.id,
			tokenHash: "b".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			idempotencyKey: "unlink-retention",
			retentionRequiredProviders: ["github"],
		})).rejects.toMatchObject({code: "IDENTITY_RETENTION_REQUIRED"});
		const githubSession = await store.pCreateSession({
			accountId: owner.account.id,
			tokenHash: "c".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			authenticatedViaIdentityId: owner.identity.id,
			recentReauthenticatedAt: now,
		});
		await expect(store.pUnlinkExternalIdentity({
			accountId: owner.account.id,
			currentSessionId: githubSession.id,
			identityId: linked.identity.id,
			tokenHash: "d".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			idempotencyKey: "unlink-only-usable",
			retentionRequiredProviders: ["github"],
			availableProviders: ["google"],
		})).rejects.toMatchObject({code: "LAST_IDENTITY_PROTECTED"});
	});

	it("unlinks idempotently, preserves the different reauthentication identity, and rotates CSRF authority", async () => {
		const owner = await pCreateFreshAccount({subject: "unlink-success-owner"});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const linked = await store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "unlink-success-google"},
			tokenHash: "8".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});
		const request = {
			accountId: owner.account.id,
			currentSessionId: linked.session.id,
			identityId: owner.identity.id,
			tokenHash: "9".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			idempotencyKey: "unlink-success",
			retentionRequiredProviders: ["google"],
		};
		const first = await store.pUnlinkExternalIdentity(request);
		const replay = await store.pUnlinkExternalIdentity({
			...request,
			currentSessionId: first.session.id,
			tokenHash: "a".repeat(64),
		});
		expect(replay).toEqual(first);
		expect(first.session.authenticatedViaIdentityId).toBe(linked.identity.id);
		expect(await store.pGetSessionByTokenHash({tokenHash: "8".repeat(64)})).toBeNull();
		expect(await store.pGetSessionByTokenHash({tokenHash: "9".repeat(64)})).toEqual(expect.objectContaining({
			session: expect.objectContaining({id: first.session.id}),
		}));
		expect(store._audit.filter(entry => entry.action === "identity.unlinked")).toEqual([
			expect.objectContaining({
				targetId: owner.identity.id,
				details: {provider: "github"},
			}),
		]);
	});

	it("serializes concurrent unlink attempts so only one removes the identity", async () => {
		const owner = await pCreateFreshAccount({subject: "concurrent-unlink-owner"});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const linked = await store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "concurrent-unlink-google"},
			tokenHash: "c".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});
		const secondSession = await store.pCreateSession({
			accountId: owner.account.id,
			tokenHash: "d".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			authenticatedViaIdentityId: linked.identity.id,
			recentReauthenticatedAt: now,
		});
		const results = await Promise.allSettled([
			store.pUnlinkExternalIdentity({
				accountId: owner.account.id,
				currentSessionId: linked.session.id,
				identityId: owner.identity.id,
				tokenHash: "e".repeat(64),
				expiresAt: new Date(now.getTime() + 60 * 60_000),
				idempotencyKey: "concurrent-unlink-a",
				retentionRequiredProviders: ["google"],
			}),
			store.pUnlinkExternalIdentity({
				accountId: owner.account.id,
				currentSessionId: secondSession.id,
				identityId: owner.identity.id,
				tokenHash: "f".repeat(64),
				expiresAt: new Date(now.getTime() + 60 * 60_000),
				idempotencyKey: "concurrent-unlink-b",
				retentionRequiredProviders: ["google"],
			}),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")[0].reason)
			.toEqual(expect.objectContaining({code: "IDENTITY_NOT_FOUND"}));
		expect(store._audit.filter(entry => entry.action === "identity.unlinked")).toHaveLength(1);
	});

	it("supports deletion-grace sign-in through another linked provider and purges every identity", async () => {
		const owner = await pCreateFreshAccount({subject: "deletion-owner"});
		const transactionId = await pCreateConsumedLink({
			accountId: owner.account.id,
			sessionId: owner.session.id,
			provider: "google",
		});
		const linked = await store.pCompleteOAuthLink({
			identity: {provider: "google", subject: "deletion-google"},
			tokenHash: "0".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			currentAccountId: owner.account.id,
			currentSessionId: owner.session.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});
		const account = store._accounts.get(owner.account.id);
		account.status = "deletion_requested";
		account.deletionRequestedAt = now.toISOString();
		account.purgeAfter = new Date(now.getTime() + 1_000).toISOString();
		const grace = await store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: "deletion-owner"},
			tokenHash: "1".repeat(64),
			expiresAt: new Date(now.getTime() + 60 * 60_000),
			priorSessionId: linked.session.id,
		});
		expect(grace.session).toEqual(expect.objectContaining({
			authenticatedViaIdentityId: owner.identity.id,
			recentReauthenticatedAt: expect.any(String),
		}));

		now = new Date(now.getTime() + 1_001);
		await expect(store.pPurgeDueAccounts()).resolves.toEqual({
			purgedAccountIds: [owner.account.id],
			blockedAccountIds: [],
		});
		expect([...store._externalIdentities.values()].filter(identity => identity.accountId === owner.account.id))
			.toHaveLength(0);
	});
});
