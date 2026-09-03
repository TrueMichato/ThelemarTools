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
			provider: "future",
			providerSubject: "100",
			displayName: "Future",
			email: "same@example.com",
		});

		expect(renamed.id).toBe(first.id);
		expect(renamed.displayName).toBe("Renamed");
		expect(sameEmailDifferentSubject.id).not.toBe(first.id);
		expect(sameSubjectDifferentProvider.id).not.toBe(first.id);
	});

	it("creates identity provenance and rotates a prior session atomically", async () => {
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

		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(2);
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(2);
		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(0);
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
});
