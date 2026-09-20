import crypto from "node:crypto";
import {createHubApp} from "../../../server/src/app.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {getSha256} from "../../../server/src/security.js";
import {pGetAuthProviderRollbackBlockers} from "../../../server/src/auth-provider-operations.js";

const databaseUrl = process.env.HUB_TEST_POSTGRES_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const ORIGIN = "https://tools.example";

async function pCreateFreshSession (store, account) {
	const [identity] = await store.pListExternalIdentities({accountId: account.id});
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(Date.now() + 60_000),
		authenticatedViaIdentityId: identity.id,
	});
	await store._pool.query(`
		UPDATE hub.sessions
		SET recent_reauthenticated_at = clock_timestamp()
		WHERE id = $1
	`, [session.id]);
	return session;
}

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
		await expect(store.pCheckHealth()).resolves.toBe(true);
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
		expect(sameDiscord.displayName).toBe("Shared Name");
	});

	it("keeps link/unlink authority, audit, retention, and session rotation aligned with MemoryHubStore", async () => {
		const prefix = `auth-pg-link-${process.pid}-${Date.now()}`;
		const account = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-github`,
			displayName: "Stable account name",
		});
		const [githubIdentity] = await store.pListExternalIdentities({accountId: account.id});
		const currentTokenHash = crypto.randomBytes(32).toString("hex");
		const currentSession = await store.pCreateSession({
			accountId: account.id,
			tokenHash: currentTokenHash,
			expiresAt: new Date(Date.now() + 60 * 60_000),
			authenticatedViaIdentityId: githubIdentity.id,
		});
		const freshened = await store._pool.query(`
			UPDATE hub.sessions
			SET recent_reauthenticated_at = clock_timestamp()
			WHERE id = $1
			RETURNING created_at, recent_reauthenticated_at
		`, [currentSession.id]);
		expect(freshened.rows[0].recent_reauthenticated_at.getTime())
			.toBeGreaterThanOrEqual(freshened.rows[0].created_at.getTime());
		const otherSession = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60 * 60_000),
			authenticatedViaIdentityId: githubIdentity.id,
		});
		const transactionId = crypto.randomUUID();
		const stateHash = getSha256(`${prefix}-state`);
		const intent = await store.pCreateOAuthLinkTransaction({
			accountId: account.id,
			sessionId: currentSession.id,
			transaction: {
				id: transactionId,
				stateHash,
				provider: "google",
				redirectUri: `${ORIGIN}/auth/google/callback`,
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				oidcNonce: "n".repeat(32),
				expiresAt: new Date(Date.now() + 5 * 60_000),
			},
			idempotencyKey: "postgres-link-intent",
		});
		expect(intent.transaction.id).toBe(transactionId);
		await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "google",
			operation: "link",
			redirectUri: `${ORIGIN}/auth/google/callback`,
		});
		const linkedTokenHash = crypto.randomBytes(32).toString("hex");
		const linked = await store.pCompleteOAuthLink({
			identity: {
				provider: "google",
				subject: `${prefix}-google`,
				displayName: "Different provider name",
			},
			tokenHash: linkedTokenHash,
			expiresAt: new Date(Date.now() + 60 * 60_000),
			currentAccountId: account.id,
			currentSessionId: currentSession.id,
			oauthTransactionId: transactionId,
			availableProviders: ["github", "google"],
		});
		expect(linked.account.displayName).toBe("Stable account name");
		expect(new Set(linked.revokedSessionIds)).toEqual(new Set([currentSession.id, otherSession.id]));
		expect((await store.pListExternalIdentities({accountId: account.id})).map(identity => identity.provider))
			.toEqual(["github", "google"]);
		expect(await store.pGetCompletedOAuthLink({
			oauthTransactionId: transactionId,
			provider: "google",
			redirectUri: `${ORIGIN}/auth/google/callback`,
		})).toEqual(expect.objectContaining({
			identity: expect.objectContaining({id: linked.identity.id}),
			session: expect.objectContaining({id: linked.session.id}),
			returnTo: "/hub.html",
		}));

		const unlinkKey = "postgres-unlink";
		const unlinked = await store.pUnlinkExternalIdentity({
			accountId: account.id,
			currentSessionId: linked.session.id,
			identityId: githubIdentity.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60 * 60_000),
			idempotencyKey: unlinkKey,
			retentionRequiredProviders: ["google"],
		});
		expect(new Date(unlinked.session.recentReauthenticatedAt).getTime())
			.toBeGreaterThanOrEqual(new Date(unlinked.session.createdAt).getTime());
		await expect(store.pUnlinkExternalIdentity({
			accountId: account.id,
			currentSessionId: unlinked.session.id,
			identityId: githubIdentity.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60 * 60_000),
			idempotencyKey: unlinkKey,
			retentionRequiredProviders: ["google"],
		})).resolves.toEqual(unlinked);
		expect(await store.pGetIdentityUnlinkRecovery({
			tokenHash: linkedTokenHash,
			idempotencyKey: unlinkKey,
		})).toEqual(expect.objectContaining({
			account: expect.objectContaining({id: account.id}),
			session: expect.objectContaining({id: linked.session.id}),
			replacementSession: expect.objectContaining({id: unlinked.session.id}),
		}));
		const exported = await store.pExportAccountData({accountId: account.id});
		for (const sessionId of [currentSession.id, otherSession.id]) {
			expect(exported.sessions.find(session => session.id === sessionId)).toEqual(expect.objectContaining({
				authenticatedViaIdentityId: null,
				recentReauthenticatedAt: null,
			}));
		}
		const audit = await store._pool.query(`
			SELECT action, target_id, details
			FROM hub.audit_entries
			WHERE actor_account_id = $1 AND action IN ('identity.linked', 'identity.unlinked')
			ORDER BY created_at, id
		`, [account.id]);
		expect(audit.rows).toEqual([
			expect.objectContaining({
				action: "identity.linked",
				target_id: linked.identity.id,
				details: {provider: "google"},
			}),
			expect.objectContaining({
				action: "identity.unlinked",
				target_id: githubIdentity.id,
				details: {provider: "github"},
			}),
		]);
		expect(JSON.stringify(audit.rows)).not.toContain(`${prefix}-github`);
		expect(JSON.stringify(audit.rows)).not.toContain(`${prefix}-google`);
	});

	it("keeps sign-in, provenance, transaction, constraint, and role behavior in one authority", async () => {
		await store.pDeleteExpiredOAuthTransactions({limit: 10_000});
		await store.pDeleteExpiredInviteContexts({limit: 10_000});
		const prefix = `auth-pg-${process.pid}-${Date.now()}`;
		await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-subject`,
			displayName: "First Name",
		});
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

		const revokable = await store.pCreateSession({
			accountId: first.account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const revokeKey = crypto.randomUUID();
		const firstRevoke = await store.pRevokeAccountSession({
			accountId: first.account.id,
			sessionId: revokable.id,
			idempotencyKey: revokeKey,
		});
		await expect(store.pRevokeAccountSession({
			accountId: first.account.id,
			sessionId: revokable.id,
			idempotencyKey: revokeKey,
		})).resolves.toEqual(firstRevoke);

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

		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(1);
		expect(await store.pDeleteExpiredOAuthTransactions()).toBe(1);
		expect((await store.pGetOperationalMetrics()).expiredOAuthTransactions).toBe(0);
		expect((await store._pool.query(
			`SELECT count(*)::integer AS count FROM hub.oauth_transactions WHERE id = $1`,
			[transactionId],
		)).rows[0].count).toBe(1);
		expect((await store._pool.query(
			`SELECT count(*)::integer AS count FROM hub.oauth_transactions WHERE id = $1`,
			[activeTransactionId],
		)).rows[0].count).toBe(1);
		await store._pool.query(`DELETE FROM hub.oauth_transactions WHERE id = ANY($1::uuid[])`, [[transactionId, activeTransactionId]]);

		const correlatedTransactionId = crypto.randomUUID();
		const correlatedStateHash = getSha256(`${prefix}-correlated-state`);
		await store.pCreateOAuthTransaction({
			id: correlatedTransactionId,
			stateHash: correlatedStateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/charactersheet.html?hubCampaign=00000000-0000-4000-8000-000000000001#sheet",
			pkceVerifier: "v".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const correlated = await store.pConsumeOAuthTransaction({
			id: correlatedTransactionId,
			stateHash: correlatedStateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		expect(correlated.id).toBe(correlatedTransactionId);

		const conflictTokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateSession({
			accountId: first.account.id,
			tokenHash: conflictTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const rollbackCampaign = (await store.pCreateCampaign({
			accountId: first.account.id,
			name: `Admission rollback ${prefix}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const rollbackInviteTokenHash = getSha256(`${prefix}-rollback-invite`);
		await store.pCreateInvite({
			accountId: first.account.id,
			campaignId: rollbackCampaign.id,
			role: "player",
			tokenHash: rollbackInviteTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const rollbackTransactionId = crypto.randomUUID();
		const rollbackStateHash = getSha256(`${prefix}-rollback-state`);
		await store.pCreateInviteOAuthTransaction({
			transaction: {
				id: rollbackTransactionId,
				stateHash: rollbackStateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				ttlSeconds: 60,
			},
			inviteTokenHash: rollbackInviteTokenHash,
			retryTokenHash: getSha256(`${prefix}-rollback-retry`),
			contextTtlSeconds: 60,
		});
		await store.pConsumeOAuthTransaction({
			id: rollbackTransactionId,
			stateHash: rollbackStateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		await expect(store.pCompleteOAuthSignIn({
			identity: {
				provider: "github",
				subject: `${prefix}-must-rollback`,
				displayName: "Rollback",
			},
			tokenHash: conflictTokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			oauthTransactionId: rollbackTransactionId,
			isNewAccountAdmissionEnabled: true,
		})).rejects.toMatchObject({code: "23505"});
		const orphan = await store._pool.query(`
			SELECT 1
			FROM hub.external_identities
			WHERE provider = 'github' AND provider_subject = $1
		`, [`${prefix}-must-rollback`]);
		expect(orphan.rowCount).toBe(0);
		const rollbackState = await store._pool.query(`
			SELECT
				context.consumed_at,
				invite.use_count
			FROM hub.oauth_transactions tx
			JOIN hub.invite_contexts context ON context.id = tx.invite_context_id
			JOIN hub.invites invite ON invite.id = context.invite_id
			WHERE tx.id = $1
		`, [rollbackTransactionId]);
		expect(rollbackState.rows[0]).toEqual({
			consumed_at: null,
			use_count: 0,
		});

		const otherAccount = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-other`,
			displayName: "Other",
		});
		const other = await store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: `${prefix}-other`, displayName: "Other"},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(other.account.id).toBe(otherAccount.id);
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
				has_table_privilege(current_user, 'hub.oauth_transactions', 'DELETE') AS can_delete,
				has_table_privilege(current_user, 'hub.invite_contexts', 'SELECT, INSERT, UPDATE, DELETE') AS can_use_invite_contexts
		`);
		expect(privileges.rows[0]).toEqual({
			can_select: true,
			can_insert: true,
			can_update: true,
			can_delete: true,
			can_use_invite_contexts: true,
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

	it("serializes invite-gated first access, max-use races, and creator purge without deadlock", async () => {
		const prefix = `auth-pg-admission-${process.pid}-${Date.now()}`;
		const owner = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-owner`,
			displayName: "Admission Owner",
		});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: `Admission ${prefix}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const inviteHash = getSha256(`${prefix}-invite`);
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: inviteHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: inviteHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "INVITE_TOKEN_CONFLICT", status: 409});

		const pCreateConsumedTransaction = async suffix => {
			const id = crypto.randomUUID();
			const stateHash = getSha256(`${prefix}-${suffix}-state`);
			await store.pCreateInviteOAuthTransaction({
				transaction: {
					id,
					stateHash,
					provider: "github",
					operation: "sign_in",
					redirectUri: "https://tools.example/auth/github/callback",
					returnTo: "/hub.html",
					pkceVerifier: "v".repeat(64),
					ttlSeconds: 60,
				},
				inviteTokenHash: inviteHash,
				retryTokenHash: getSha256(`${prefix}-${suffix}-retry`),
				contextTtlSeconds: 60,
			});
			await store.pConsumeOAuthTransaction({
				id,
				stateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
			});
			return id;
		};
		const [transactionA, transactionB] = await Promise.all([
			pCreateConsumedTransaction("a"),
			pCreateConsumedTransaction("b"),
		]);
		const raced = await Promise.allSettled([
			store.pCompleteOAuthSignIn({
				identity: {provider: "github", subject: `${prefix}-racer-a`, displayName: "Racer A"},
				tokenHash: crypto.randomBytes(32).toString("hex"),
				expiresAt: new Date(Date.now() + 60_000),
				oauthTransactionId: transactionA,
				isNewAccountAdmissionEnabled: true,
			}),
			store.pCompleteOAuthSignIn({
				identity: {provider: "github", subject: `${prefix}-racer-b`, displayName: "Racer B"},
				tokenHash: crypto.randomBytes(32).toString("hex"),
				expiresAt: new Date(Date.now() + 60_000),
				oauthTransactionId: transactionB,
				isNewAccountAdmissionEnabled: true,
			}),
		]);
		expect(raced.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(raced.filter(result => result.status === "rejected").map(result => result.reason.code))
			.toEqual(["INVITE_ADMISSION_INVALID"]);
		const committed = await store._pool.query(`
			SELECT
				(SELECT use_count FROM hub.invites WHERE token_hash = decode($1, 'hex')) AS use_count,
				(SELECT count(*)::integer FROM hub.invite_contexts WHERE consumed_at IS NOT NULL AND completed_account_id IS NOT NULL) AS completed_contexts,
				(SELECT count(*)::integer FROM hub.external_identities WHERE provider_subject LIKE $2) AS created_identities,
				(SELECT count(*)::integer FROM hub.memberships WHERE campaign_id = $3 AND account_id <> $4) AS joined_memberships,
				(
					SELECT count(*)::integer
					FROM hub.audit_entries audit
					WHERE audit.action = 'account.created'
						AND audit.details->>'admission' = 'campaign_invite'
						AND audit.actor_account_id IN (
							SELECT account_id
							FROM hub.external_identities
							WHERE provider_subject LIKE $2
						)
				) AS account_audits,
				(SELECT count(*)::integer FROM hub.audit_entries WHERE campaign_id = $3 AND action = 'invite.redeemed') AS invite_audits,
				(SELECT count(*)::integer FROM hub.domain_events WHERE campaign_id = $3 AND event_type = 'membership.joined') AS join_events
		`, [inviteHash, `${prefix}-racer-%`, campaign.id, owner.id]);
		expect(committed.rows[0]).toEqual({
			use_count: 1,
			completed_contexts: expect.any(Number),
			created_identities: 1,
			joined_memberships: 1,
			account_audits: 1,
			invite_audits: 1,
			join_events: 1,
		});
		expect(committed.rows[0].completed_contexts).toBeGreaterThanOrEqual(1);

		const retryInviteHash = getSha256(`${prefix}-retry-invite`);
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: retryInviteHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const failedTransactionId = crypto.randomUUID();
		const failedStateHash = getSha256(`${prefix}-failed-state`);
		const failedRetryHash = getSha256(`${prefix}-failed-retry`);
		await store.pCreateInviteOAuthTransaction({
			transaction: {
				id: failedTransactionId,
				stateHash: failedStateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				ttlSeconds: 60,
			},
			inviteTokenHash: retryInviteHash,
			retryTokenHash: failedRetryHash,
			contextTtlSeconds: 60,
		});
		const retryTransactionId = crypto.randomUUID();
		await expect(store.pRetryInviteOAuthTransaction({
			transaction: {
				id: retryTransactionId,
				stateHash: getSha256(`${prefix}-retry-state-cross-browser`),
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				ttlSeconds: 60,
			},
			retryTokenHash: failedRetryHash,
			nextRetryTokenHash: getSha256(`${prefix}-cross-browser-retry`),
			contextTtlSeconds: 60,
			browserTransactionIds: [],
		})).rejects.toMatchObject({code: "INVITE_ADMISSION_INVALID"});
		await store.pRetryInviteOAuthTransaction({
			transaction: {
				id: retryTransactionId,
				stateHash: getSha256(`${prefix}-retry-state`),
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				ttlSeconds: 60,
			},
			retryTokenHash: failedRetryHash,
			nextRetryTokenHash: getSha256(`${prefix}-next-retry`),
			contextTtlSeconds: 60,
			browserTransactionIds: [failedTransactionId],
		});
		const retryRows = await store._pool.query(`
			SELECT id
			FROM hub.oauth_transactions
			WHERE id = ANY($1::uuid[])
			ORDER BY id
		`, [[failedTransactionId, retryTransactionId]]);
		expect(retryRows.rows.map(row => row.id)).toEqual([retryTransactionId]);

		const coDm = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-co-dm`,
			displayName: "Co-DM",
		});
		const coDmInviteHash = getSha256(`${prefix}-co-dm-invite`);
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "co_dm",
			tokenHash: coDmInviteHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pRedeemInvite({
			accountId: coDm.id,
			tokenHash: coDmInviteHash,
			idempotencyKey: crypto.randomUUID(),
		});
		const createdByCoDm = await store.pCreateInvite({
			accountId: coDm.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: getSha256(`${prefix}-purge-race`),
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const coDmSession = await pCreateFreshSession(store, coDm);
		await store.pRequestAccountDeletion({
			accountId: coDm.id,
			sessionId: coDmSession.id,
			idempotencyKey: crypto.randomUUID(),
			graceMs: 1,
		});
		await new Promise(resolve => setTimeout(resolve, 5));
		const interleaving = await Promise.allSettled([
			store.pRevokeInvite({
				accountId: owner.id,
				campaignId: campaign.id,
				inviteId: createdByCoDm.invite.id,
				idempotencyKey: crypto.randomUUID(),
			}),
			store.pPurgeDueAccounts({limit: 10}),
		]);
		for (const result of interleaving) {
			if (result.status === "rejected") expect(result.reason.code).not.toBe("40P01");
		}
		const remainingInvite = await store._pool.query(`SELECT 1 FROM hub.invites WHERE id = $1`, [createdByCoDm.invite.id]);
		expect(remainingInvite.rowCount).toBe(0);
	});

	it("enforces active, deletion-requested, suspended, and deleted sign-in states", async () => {
		const prefix = `auth-pg-status-${process.pid}-${Date.now()}`;
		const account = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-member`,
			displayName: "Status Member",
		});
		const owner = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-owner`,
			displayName: "Status Owner",
		});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: `Status ${prefix}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const inviteHash = getSha256(`${prefix}-invite`);
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: inviteHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		const pNormalTransaction = async suffix => {
			const id = crypto.randomUUID();
			const stateHash = getSha256(`${prefix}-${suffix}`);
			await store.pCreateOAuthTransaction({
				id,
				stateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				expiresAt: new Date(Date.now() + 60_000),
			});
			await store.pConsumeOAuthTransaction({
				id,
				stateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
			});
			return id;
		};
		await store._pool.query(`
			UPDATE hub.accounts
			SET status = 'deletion_requested',
				deletion_requested_at = now(),
				purge_after = now() + interval '1 day'
			WHERE id = $1
		`, [account.id]);
		await expect(store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: `${prefix}-member`, displayName: "Status Member"},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			oauthTransactionId: await pNormalTransaction("deletion-normal"),
		})).resolves.toEqual(expect.objectContaining({account: expect.objectContaining({status: "deletion_requested"})}));

		const inviteTransactionId = crypto.randomUUID();
		const inviteStateHash = getSha256(`${prefix}-invite-state`);
		await store.pCreateInviteOAuthTransaction({
			transaction: {
				id: inviteTransactionId,
				stateHash: inviteStateHash,
				provider: "github",
				operation: "sign_in",
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				pkceVerifier: "v".repeat(64),
				ttlSeconds: 60,
			},
			inviteTokenHash: inviteHash,
			retryTokenHash: getSha256(`${prefix}-invite-retry`),
			contextTtlSeconds: 60,
		});
		await store.pConsumeOAuthTransaction({
			id: inviteTransactionId,
			stateHash: inviteStateHash,
			provider: "github",
			operation: "sign_in",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		await expect(store.pCompleteOAuthSignIn({
			identity: {provider: "github", subject: `${prefix}-member`, displayName: "Status Member"},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			oauthTransactionId: inviteTransactionId,
			isNewAccountAdmissionEnabled: true,
		})).rejects.toMatchObject({code: "INVITE_ADMISSION_INVALID"});
		const untouchedInvite = await store._pool.query(`
			SELECT
				invite.use_count,
				context.consumed_at
			FROM hub.oauth_transactions tx
			JOIN hub.invite_contexts context ON context.id = tx.invite_context_id
			JOIN hub.invites invite ON invite.id = context.invite_id
			WHERE tx.id = $1
		`, [inviteTransactionId]);
		expect(untouchedInvite.rows[0]).toEqual({use_count: 0, consumed_at: null});

		for (const status of ["suspended", "deleted"]) {
			await store._pool.query(`
				UPDATE hub.accounts
				SET status = $2, deletion_requested_at = NULL, purge_after = NULL
				WHERE id = $1
			`, [account.id, status]);
			await expect(store.pCompleteOAuthSignIn({
				identity: {provider: "github", subject: `${prefix}-member`, displayName: "Status Member"},
				tokenHash: crypto.randomBytes(32).toString("hex"),
				expiresAt: new Date(Date.now() + 60_000),
				oauthTransactionId: await pNormalTransaction(status),
			})).rejects.toMatchObject({code: "ACCOUNT_UNAVAILABLE"});
		}
	});

	it("blocks legacy rollback for a newly invite-admitted GitHub subject outside the old allowlist", async () => {
		const prefix = `auth-pg-rollback-${process.pid}-${Date.now()}`;
		await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-legacy`,
			displayName: "Legacy",
		});
		const baseline = await pGetAuthProviderRollbackBlockers({
			queryable: store._pool,
			supportedProviders: ["github"],
			allowedSubjects: [`github:${prefix}-legacy`],
		});
		const inviteAdmitted = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-invite-admitted`,
			displayName: "Invite admitted",
		});
		await store._pool.query(`
			INSERT INTO hub.audit_entries (
				id, actor_account_id, action, target_type, target_id, details
			)
			VALUES ($1, $2, 'account.created', 'account', $2, '{"admission":"campaign_invite"}'::jsonb)
		`, [crypto.randomUUID(), inviteAdmitted.id]);
		const result = await pGetAuthProviderRollbackBlockers({
			queryable: store._pool,
			supportedProviders: ["github"],
			allowedSubjects: [`github:${prefix}-legacy`],
		});
		expect(result.blockedAccounts).toBeGreaterThanOrEqual(baseline.blockedAccounts + 1);
	});

	it("replays invite creation across secret rotation without persisting or returning an unusable token", async () => {
		const prefix = `auth-pg-token-rotation-${process.pid}-${Date.now()}`;
		const owner = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${prefix}-owner`,
			displayName: "Rotation Owner",
		});
		const rawSessionToken = crypto.randomBytes(32).toString("base64url");
		await store.pCreateSession({
			accountId: owner.id,
			tokenHash: getSha256(rawSessionToken),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: `Rotation ${prefix}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const oauthProvider = {
			getAuthorizationUrl: ({state}) => `https://example.invalid/?state=${state}`,
			pExchangeCode: async () => ({
				provider: "github",
				providerSubject: `${prefix}-owner`,
				displayName: "Rotation Owner",
			}),
		};
		const oldSecret = "old-invite-token-secret-at-least-thirty-two";
		const newSecret = "new-invite-token-secret-at-least-thirty-two";
		const createApp = inviteTokenSecrets => createHubApp({
			store,
			oauthProvider,
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				inviteTokenSecrets,
			},
		});
		let app = await createApp([oldSecret]);
		const sessionCookie = `__Host-hub_session=${app.signCookie(rawSessionToken)}`;
		const session = (await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {cookie: sessionCookie},
		})).json();
		const request = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: {
				cookie: sessionCookie,
				origin: ORIGIN,
				"x-csrf-token": session.csrfToken,
				"x-hub-protocol-version": "5",
				"idempotency-key": `${prefix}-invite`,
			},
			payload: {role: "player"},
		};
		try {
			const first = await app.inject(request);
			expect(first.statusCode).toBe(201);
			const firstToken = first.json().token;
			await app.close();

			app = await createApp([newSecret, oldSecret]);
			const replay = await app.inject(request);
			expect(replay.statusCode).toBe(201);
			expect(replay.json().token).toBe(firstToken);
			const receipt = await store._pool.query(`
				SELECT response::text
				FROM hub.command_receipts
				WHERE actor_account_id = $1 AND idempotency_key = $2
			`, [owner.id, `${prefix}-invite`]);
			expect(receipt.rows[0].response).not.toContain(firstToken);

			await app.close();
			app = await createApp([newSecret]);
			const unavailable = await app.inject(request);
			expect(unavailable.statusCode).toBe(409);
			expect(unavailable.json()).toEqual({error: "INVITE_TOKEN_RECOVERY_UNAVAILABLE"});
		} finally {
			await app.close();
		}
	});
});
