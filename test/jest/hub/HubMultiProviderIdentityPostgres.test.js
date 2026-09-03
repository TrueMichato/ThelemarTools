import crypto from "node:crypto";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {getSha256} from "../../../server/src/security.js";

const databaseUrl = process.env.HUB_TEST_POSTGRES_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("PostgreSQL provider-neutral identity substrate", () => {
	let store;

	beforeAll(() => {
		store = PostgresHubStore.fromConnectionString({
			connectionString: databaseUrl,
			ssl: false,
			maxConnections: 4,
		});
	});

	afterAll(async () => store?.pClose());

	it("never joins Discord or Google accounts by shared profile metadata", async () => {
		const prefix = `auth-pg-providers-${process.pid}-${Date.now()}`;
		const identities = [
			{provider: "github", providerSubject: `${prefix}-github`},
			{provider: "discord", providerSubject: `${prefix}-discord`},
			{provider: "google", providerSubject: `${prefix}-google`},
		];
		const accounts = await Promise.all(identities.map(identity => store.pUpsertOAuthAccount({
			...identity,
			displayName: "Shared Name",
			login: "shared-handle",
			email: "shared@example.com",
		})));

		expect(new Set(accounts.map(account => account.id)).size).toBe(3);
		const sameDiscord = await store.pUpsertOAuthAccount({
			provider: "discord",
			providerSubject: `${prefix}-discord`,
			displayName: "Renamed Discord",
			login: "renamed",
			email: "changed@example.com",
		});
		expect(sameDiscord.id).toBe(accounts[1].id);
	});

	it("keeps sign-in, provenance, transaction, constraint, and role behavior in one authority", async () => {
		const prefix = `auth-pg-${process.pid}-${Date.now()}`;
		const firstTokenHash = crypto.randomBytes(32).toString("hex");
		const first = await store.pCompleteOAuthSignIn({
			identity: {
				provider: "github",
				subject: `${prefix}-subject`,
				displayName: "First Name",
				handle: "first-handle",
				email: "ignored@example.com",
			},
			tokenHash: firstTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			userAgent: "postgres-auth-test",
		});
		expect(first.session.authenticatedViaIdentityId).toBe(first.identity.id);
		expect((await store.pGetSessionByTokenHash({tokenHash: firstTokenHash})).session)
			.toEqual(expect.objectContaining({authenticatedViaIdentityId: first.identity.id}));

		const updated = await store.pCompleteOAuthSignIn({
			identity: {
				provider: "github",
				subject: `${prefix}-subject`,
				displayName: "Updated Name",
				handle: "updated-handle",
			},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			priorSessionId: first.session.id,
		});
		expect(updated.account.id).toBe(first.account.id);
		expect(updated.identity.id).toBe(first.identity.id);
		expect(updated.identity.handle).toBe("updated-handle");
		expect(updated.revokedSessionIds).toEqual([first.session.id]);
		expect(await store.pGetSessionByTokenHash({tokenHash: firstTokenHash})).toBeNull();

		const concurrent = await Promise.all([
			store.pUpsertOAuthAccount({
				provider: "github",
				providerSubject: `${prefix}-concurrent`,
				displayName: "Concurrent One",
			}),
			store.pUpsertOAuthAccount({
				provider: "github",
				providerSubject: `${prefix}-concurrent`,
				displayName: "Concurrent Two",
			}),
		]);
		expect(new Set(concurrent.map(account => account.id)).size).toBe(1);

		const transactionId = crypto.randomUUID();
		const stateHash = getSha256(`${prefix}-state`);
		await expect(store.pConsumeOAuthTransaction({
			id: "legacy-state-and-verifier",
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE", status: 400});
		await store.pCreateOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const transaction = await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		expect(transaction.pkceVerifier).toBe("v".repeat(64));
		await expect(store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({code: "INVALID_OAUTH_STATE"});

		const consumedRow = await store._pool.query(`
			SELECT state_hash, pkce_verifier, oidc_nonce, consumed_at
			FROM hub.oauth_transactions
			WHERE id = $1
		`, [transactionId]);
		expect(consumedRow.rows[0]).toEqual(expect.objectContaining({
			state_hash: null,
			pkce_verifier: null,
			oidc_nonce: null,
			consumed_at: expect.any(Date),
		}));
		const activeTransactionId = crypto.randomUUID();
		await store.pCreateOAuthTransaction({
			id: activeTransactionId,
			stateHash: getSha256(`${prefix}-active-state`),
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const expiredTransactionId = crypto.randomUUID();
		await store._pool.query(`
			INSERT INTO hub.oauth_transactions (
				id, state_hash, provider, operation, redirect_uri, return_to,
				pkce_verifier, authorization_started_at, expires_at, created_at
			)
			VALUES (
				$1, decode($2, 'hex'), 'github', 'sign_in',
				'https://tools.example/auth/github/callback', '/hub.html', $3,
				now() - interval '2 minutes', now() - interval '1 minute', now() - interval '2 minutes'
			)
		`, [expiredTransactionId, getSha256(`${prefix}-expired-state`), "v".repeat(64)]);

		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(2);
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(2);
		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(0);
		expect((await store._pool.query(
			`SELECT count(*)::integer AS count FROM hub.oauth_transactions WHERE id = $1`,
			[activeTransactionId],
		)).rows[0].count).toBe(1);
		await store._pool.query(`DELETE FROM hub.oauth_transactions WHERE id = $1`, [activeTransactionId]);

		const conflictTokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateSession({
			accountId: first.account.id,
			tokenHash: conflictTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(store.pCompleteOAuthSignIn({
			identity: {
				provider: "github",
				subject: `${prefix}-must-rollback`,
				displayName: "Rollback",
			},
			tokenHash: conflictTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
		})).rejects.toMatchObject({code: "23505"});
		const orphan = await store._pool.query(`
			SELECT 1
			FROM hub.external_identities
			WHERE provider = 'github' AND provider_subject = $1
		`, [`${prefix}-must-rollback`]);
		expect(orphan.rowCount).toBe(0);

		const other = await store.pCompleteOAuthSignIn({
			identity: {
				provider: "github",
				subject: `${prefix}-other`,
				displayName: "Other",
			},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(store.pCreateSession({
			accountId: first.account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			authenticatedViaIdentityId: other.identity.id,
		})).rejects.toMatchObject({code: "23503"});

		const client = await store._pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`DELETE FROM hub.external_identities WHERE id = $1`, [first.identity.id]);
			await expect(client.query("COMMIT")).rejects.toMatchObject({code: "23514"});
		} finally {
			await client.query("ROLLBACK").catch(() => {});
			client.release();
		}

		const privileges = await store._pool.query(`
			SELECT
				has_table_privilege(current_user, 'hub.oauth_transactions', 'SELECT') AS can_select,
				has_table_privilege(current_user, 'hub.oauth_transactions', 'INSERT') AS can_insert,
				has_table_privilege(current_user, 'hub.oauth_transactions', 'UPDATE') AS can_update,
				has_table_privilege(current_user, 'hub.oauth_transactions', 'DELETE') AS can_delete
		`);
		expect(privileges.rows[0]).toEqual({
			can_select: true,
			can_insert: true,
			can_update: true,
			can_delete: true,
		});

		const exported = await store.pExportAccountData({accountId: first.account.id});
		expect(exported.externalIdentities).toEqual([
			expect.objectContaining({
				provider: "github",
				subject: `${prefix}-subject`,
				handle: "updated-handle",
			}),
		]);
		expect(JSON.stringify(exported)).not.toMatch(/access.?token|refresh.?token|pkce|nonce|ignored@example/i);
	});
});
