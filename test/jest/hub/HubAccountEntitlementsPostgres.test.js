import crypto from "node:crypto";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const databaseUrl = process.env.HUB_TEST_POSTGRES_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

async function pCreateAccount (store, prefix, label) {
	return store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: `${prefix}-${label}`,
		displayName: label,
	});
}

async function pCreateFreshSession (store, account) {
	const [identity] = await store.pListExternalIdentities({accountId: account.id});
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(Date.now() + 60 * 60_000),
		authenticatedViaIdentityId: identity.id,
	});
	await store._pool.query(`
		UPDATE hub.sessions
		SET recent_reauthenticated_at = now()
		WHERE id = $1
	`, [session.id]);
	return session;
}

async function pMakeOnlyActiveOperators (store, accountIds) {
	const client = await store._pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 9))`, ["account-entitlements"]);
		const previous = await client.query(`
			SELECT entitlement.account_id
			FROM hub.account_entitlements entitlement
			JOIN hub.accounts account ON account.id = entitlement.account_id
			WHERE entitlement.entitlement_name = 'platform:operate'
				AND entitlement.revoked_at IS NULL
				AND account.status = 'active'
		`);
		for (const accountId of accountIds) {
			await client.query(`
				INSERT INTO hub.account_entitlements (
					id, account_id, entitlement_name, source
				)
				VALUES ($1, $2, 'platform:operate', 'postgres_concurrency_test')
				ON CONFLICT (account_id, entitlement_name) WHERE revoked_at IS NULL DO NOTHING
			`, [crypto.randomUUID(), accountId]);
		}
		await client.query(`
			UPDATE hub.account_entitlements
			SET revoked_at = now(), updated_at = now()
			WHERE entitlement_name = 'platform:operate'
				AND revoked_at IS NULL
				AND account_id <> ALL($1::uuid[])
		`, [accountIds]);
		await client.query("COMMIT");
		return previous.rows.map(row => row.account_id);
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

describePostgres("PostgreSQL account entitlement authority", () => {
	let store;
	let prefix;
	let operator;
	let target;
	let operatorSession;

	beforeAll(async () => {
		store = PostgresHubStore.fromConnectionString({
			connectionString: databaseUrl,
			ssl: false,
			maxConnections: 6,
			isAccountEntitlementsEnabled: true,
		});
		await store.pCheckHealth();
	});

	beforeEach(async () => {
		prefix = `entitlements-pg-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
		operator = await pCreateAccount(store, prefix, "operator");
		target = await pCreateAccount(store, prefix, "target");
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [operator.id]});
		operatorSession = await pCreateFreshSession(store, operator);
	});

	afterAll(async () => store?.pClose());

	it("enforces creator authority with no rejected-write side effects", async () => {
		const before = await store._pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.campaigns WHERE owner_account_id = $1) AS campaigns,
				(SELECT count(*)::integer FROM hub.audit_entries WHERE actor_account_id = $1) AS audits,
				(SELECT count(*)::integer FROM hub.command_receipts WHERE actor_account_id = $1) AS receipts
		`, [target.id]);
		await expect(store.pCreateCampaign({
			accountId: target.id,
			name: "Denied",
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "CAMPAIGN_CREATE_NOT_ENTITLED"});
		const after = await store._pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.campaigns WHERE owner_account_id = $1) AS campaigns,
				(SELECT count(*)::integer FROM hub.audit_entries WHERE actor_account_id = $1) AS audits,
				(SELECT count(*)::integer FROM hub.command_receipts WHERE actor_account_id = $1) AS receipts
		`, [target.id]);
		expect(after.rows[0]).toEqual(before.rows[0]);
	});

	it("serializes revoke/create and concurrent mutual operator revocation", async () => {
		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
			idempotencyKey: crypto.randomUUID(),
		});
		const [revokeResult, createResult] = await Promise.allSettled([
			store.pRevokeAccountEntitlement({
				accountId: operator.id,
				sessionId: operatorSession.id,
				targetAccountId: target.id,
				entitlementName: "campaign:create",
				idempotencyKey: crypto.randomUUID(),
			}),
			store.pCreateCampaign({
				accountId: target.id,
				name: "Serialized",
				idempotencyKey: crypto.randomUUID(),
			}),
		]);
		expect([revokeResult.status, createResult.status].sort()).toEqual(["fulfilled", expect.stringMatching(/fulfilled|rejected/)]);
		if (createResult.status === "rejected") expect(createResult.reason).toMatchObject({code: "CAMPAIGN_CREATE_NOT_ENTITLED"});

		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "platform:operate",
			idempotencyKey: crypto.randomUUID(),
		});
		await store._pool.query(`
			INSERT INTO hub.command_receipts (
				actor_account_id, idempotency_key, request_hash, command_type, response
			)
			VALUES (
				$1, $2, decode($3, 'hex'), 'account.entitlement.grant',
				jsonb_build_object(
					'account',
					jsonb_build_object('id', $4::text, 'displayName', $5::text),
					'changed',
					true
				)
			)
		`, [operator.id, crypto.randomUUID(), crypto.randomBytes(32).toString("hex"), target.id, target.displayName]);
		const targetSession = await pCreateFreshSession(store, target);
		const mutual = await Promise.allSettled([
			store.pRevokeAccountEntitlement({
				accountId: operator.id,
				sessionId: operatorSession.id,
				targetAccountId: target.id,
				entitlementName: "platform:operate",
				idempotencyKey: crypto.randomUUID(),
			}),
			store.pRevokeAccountEntitlement({
				accountId: target.id,
				sessionId: targetSession.id,
				targetAccountId: operator.id,
				entitlementName: "platform:operate",
				idempotencyKey: crypto.randomUUID(),
			}),
		]);
		expect(mutual.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const active = await store._pool.query(`
			SELECT count(*)::integer AS count
			FROM hub.account_entitlements entitlement
			JOIN hub.accounts account ON account.id = entitlement.account_id
			WHERE entitlement.entitlement_name = 'platform:operate'
				AND entitlement.revoked_at IS NULL
				AND account.status = 'active'
		`);
		expect(active.rows[0].count).toBeGreaterThanOrEqual(1);
	});

	it("keeps no-op grant/revoke audit-free and purges a non-last operator", async () => {
		const grant = {
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "campaign:create",
		};
		const replayKey = crypto.randomUUID();
		const firstGrant = await store.pGrantAccountEntitlement({...grant, idempotencyKey: replayKey});
		expect(await store.pGrantAccountEntitlement({...grant, idempotencyKey: replayKey})).toEqual(firstGrant);
		const compactReceipt = await store._pool.query(`
			SELECT response
			FROM hub.command_receipts
			WHERE actor_account_id = $1 AND idempotency_key = $2
		`, [operator.id, replayKey]);
		expect(compactReceipt.rows[0].response).toEqual(firstGrant);
		await store.pGrantAccountEntitlement({...grant, idempotencyKey: crypto.randomUUID()});
		const targetExport = await store.pExportAccountData({accountId: target.id});
		expect(targetExport.entitlements[0]).not.toHaveProperty("grantedByAccountId");
		expect(targetExport.entitlements[0]).not.toHaveProperty("revokedByAccountId");
		expect(JSON.stringify(targetExport)).not.toContain(operator.id);
		await store.pRevokeAccountEntitlement({...grant, idempotencyKey: crypto.randomUUID()});
		await store.pRevokeAccountEntitlement({...grant, idempotencyKey: crypto.randomUUID()});
		const audit = await store._pool.query(`
			SELECT action
			FROM hub.audit_entries
			WHERE actor_account_id = $1
				AND details->>'targetAccountId' = $2
				AND details->>'entitlementName' = 'campaign:create'
		`, [operator.id, target.id]);
		expect(audit.rows.filter(row => row.action === "account.entitlement.granted")).toHaveLength(1);
		expect(audit.rows.filter(row => row.action === "account.entitlement.revoked")).toHaveLength(1);

		await store.pGrantAccountEntitlement({
			accountId: operator.id,
			sessionId: operatorSession.id,
			targetAccountId: target.id,
			entitlementName: "platform:operate",
			idempotencyKey: crypto.randomUUID(),
		});

		const targetSession = await pCreateFreshSession(store, target);
		await store.pRequestAccountDeletion({
			accountId: target.id,
			sessionId: targetSession.id,
			idempotencyKey: crypto.randomUUID(),
			graceMs: 1,
		});
		await new Promise(resolve => setTimeout(resolve, 5));
		expect((await store.pPurgeDueAccounts({limit: 100})).purgedAccountIds).toContain(target.id);
		const retainedReceipt = await store._pool.query(`
			SELECT 1
			FROM hub.command_receipts
			WHERE response->'account'->>'id' = $1
		`, [target.id]);
		expect(retainedReceipt.rowCount).toBe(0);
	});

	it("replays revoke-other-sessions with its original response", async () => {
		const secondSession = await store.pCreateSession({
			accountId: operator.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const idempotencyKey = crypto.randomUUID();
		const first = await store.pRevokeOtherSessions({
			accountId: operator.id,
			currentSessionId: operatorSession.id,
			idempotencyKey,
		});
		expect(first.revokedSessionIds).toContain(secondSession.id);
		expect(await store.pRevokeOtherSessions({
			accountId: operator.id,
			currentSessionId: operatorSession.id,
			idempotencyKey,
		})).toEqual(first);
	});

	it("completes a valid PostgreSQL reauthentication transaction", async () => {
		const transactionId = crypto.randomUUID();
		const stateHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			initiatingAccountId: operator.id,
			initiatingSessionId: operatorSession.id,
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			expiresAt: new Date(Date.now() + 60_000),
		});
		await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		const completed = await store.pCompleteOAuthReauthentication({
			identity: {provider: "github", subject: `${prefix}-operator`, displayName: "Operator"},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			currentSessionId: operatorSession.id,
			oauthTransactionId: transactionId,
		});
		expect(completed.session).toEqual(expect.objectContaining({
			authenticatedViaIdentityId: completed.identity.id,
			recentReauthenticatedAt: expect.any(Date),
		}));
		expect(completed.revokedSessionIds).toEqual([operatorSession.id]);
		expect(await store.pGetSessionById({sessionId: operatorSession.id})).toBeNull();
	});

	it("rejects reauthentication completion after transaction expiry without side effects", async () => {
		const transactionId = crypto.randomUUID();
		const stateHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			initiatingAccountId: operator.id,
			initiatingSessionId: operatorSession.id,
			redirectUri: "https://tools.example/auth/github/callback",
			returnTo: "/hub.html",
			expiresAt: new Date(Date.now() + 60_000),
		});
		await store.pConsumeOAuthTransaction({
			id: transactionId,
			stateHash,
			provider: "github",
			operation: "reauthenticate",
			redirectUri: "https://tools.example/auth/github/callback",
		});
		await store._pool.query(`
			UPDATE hub.oauth_transactions
			SET created_at = now() - interval '2 minutes',
				expires_at = now() - interval '1 second'
			WHERE id = $1
		`, [transactionId]);
		await expect(store.pCompleteOAuthReauthentication({
			identity: {provider: "github", subject: `${prefix}-operator`, displayName: "Changed"},
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			currentSessionId: operatorSession.id,
			oauthTransactionId: transactionId,
		})).rejects.toMatchObject({code: "REAUTHENTICATION_FAILED"});
		expect(await store.pGetSessionById({sessionId: operatorSession.id})).not.toBeNull();
	});

	it("rechecks reauthentication expiry after awaited work inside the transaction", async () => {
		const delayedStore = PostgresHubStore.fromConnectionString({
			connectionString: databaseUrl,
			ssl: false,
			maxConnections: 2,
			isAccountEntitlementsEnabled: true,
			fnBeforeSensitiveCommit: async ({operation}) => {
				if (operation === "oauth.reauthenticate") {
					await new Promise(resolve => setTimeout(resolve, 1_100));
				}
			},
		});
		try {
			const delayedOperator = await pCreateAccount(delayedStore, prefix, "delayed-operator");
			const delayedSession = await pCreateFreshSession(delayedStore, delayedOperator);
			const transactionId = crypto.randomUUID();
			const stateHash = crypto.randomBytes(32).toString("hex");
			await delayedStore.pCreateOAuthTransaction({
				id: transactionId,
				stateHash,
				provider: "github",
				operation: "reauthenticate",
				initiatingAccountId: delayedOperator.id,
				initiatingSessionId: delayedSession.id,
				redirectUri: "https://tools.example/auth/github/callback",
				returnTo: "/hub.html",
				expiresAt: new Date(Date.now() + 1_000),
			});
			await delayedStore.pConsumeOAuthTransaction({
				id: transactionId,
				stateHash,
				provider: "github",
				operation: "reauthenticate",
				redirectUri: "https://tools.example/auth/github/callback",
			});
			await expect(delayedStore.pCompleteOAuthReauthentication({
				identity: {provider: "github", subject: `${prefix}-delayed-operator`, displayName: "Delayed"},
				tokenHash: crypto.randomBytes(32).toString("hex"),
				expiresAt: new Date(Date.now() + 60_000),
				currentSessionId: delayedSession.id,
				oauthTransactionId: transactionId,
			})).rejects.toMatchObject({code: "REAUTHENTICATION_FAILED"});
			expect(await delayedStore.pGetSessionById({sessionId: delayedSession.id})).not.toBeNull();
		} finally {
			await delayedStore.pClose();
		}
	});

	it("serializes deferred concurrent revoke and account-status transitions", async () => {
		const priorOperators = await pMakeOnlyActiveOperators(store, [operator.id, target.id]);
		const entitlements = await store._pool.query(`
			SELECT account_id, id
			FROM hub.account_entitlements
			WHERE entitlement_name = 'platform:operate'
				AND revoked_at IS NULL
				AND account_id = ANY($1::uuid[])
		`, [[operator.id, target.id]]);
		const entitlementId = new Map(entitlements.rows.map(row => [row.account_id, row.id]));
		const revokeClients = await Promise.all([store._pool.connect(), store._pool.connect()]);
		try {
			await Promise.all(revokeClients.map(client => client.query("BEGIN")));
			await Promise.all([
				revokeClients[0].query(`UPDATE hub.account_entitlements SET revoked_at = now(), updated_at = now() WHERE id = $1`, [entitlementId.get(operator.id)]),
				revokeClients[1].query(`UPDATE hub.account_entitlements SET revoked_at = now(), updated_at = now() WHERE id = $1`, [entitlementId.get(target.id)]),
			]);
			const commits = await Promise.allSettled(revokeClients.map(client => client.query("COMMIT")));
			expect(commits.filter(result => result.status === "fulfilled")).toHaveLength(1);
			expect(commits.find(result => result.status === "rejected")?.reason).toMatchObject({code: "23514"});
		} finally {
			await Promise.all(revokeClients.map(client => client.query("ROLLBACK").catch(() => {})));
			revokeClients.forEach(client => client.release());
		}

		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [operator.id, target.id, ...priorOperators]});
		await pMakeOnlyActiveOperators(store, [operator.id, target.id]);
		const statusClients = await Promise.all([store._pool.connect(), store._pool.connect()]);
		try {
			await Promise.all(statusClients.map(client => client.query("BEGIN")));
			await Promise.all(statusClients.map(client =>
				client.query(`SELECT set_config('hub.enforce_operator_guard', 'on', true)`),
			));
			await Promise.all([
				statusClients[0].query(`
					UPDATE hub.accounts
					SET status = 'deletion_requested',
						deletion_requested_at = now(),
						purge_after = now() + interval '1 day'
					WHERE id = $1
				`, [operator.id]),
				statusClients[1].query(`
					UPDATE hub.accounts
					SET status = 'deletion_requested',
						deletion_requested_at = now(),
						purge_after = now() + interval '1 day'
					WHERE id = $1
				`, [target.id]),
			]);
			const commits = await Promise.allSettled(statusClients.map(client => client.query("COMMIT")));
			expect(commits.filter(result => result.status === "fulfilled")).toHaveLength(1);
			expect(commits.find(result => result.status === "rejected")?.reason).toMatchObject({code: "23514"});
		} finally {
			await Promise.all(statusClients.map(client => client.query("ROLLBACK").catch(() => {})));
			statusClients.forEach(client => client.release());
		}
		await store._pool.query(`
			UPDATE hub.accounts
			SET status = 'active', deletion_requested_at = NULL, purge_after = NULL
			WHERE id = ANY($1::uuid[])
		`, [[operator.id, target.id]]);
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: priorOperators});
	});

	it("keeps predecessor default-off status updates compatible while current deletion protects the last operator", async () => {
		const legacyOperator = await pCreateAccount(store, prefix, "legacy-operator");
		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [legacyOperator.id]});
		const priorOperators = await pMakeOnlyActiveOperators(store, [legacyOperator.id]);
		const predecessorUpdate = await store._pool.query(`
			UPDATE hub.accounts
			SET status = 'deletion_requested',
				deletion_requested_at = now(),
				purge_after = now() + interval '1 day'
			WHERE id = $1
			RETURNING status
		`, [legacyOperator.id]);
		expect(predecessorUpdate.rows[0].status).toBe("deletion_requested");
		await expect(store._pool.query(`DELETE FROM hub.accounts WHERE id = $1`, [legacyOperator.id]))
			.resolves.toMatchObject({rowCount: 1});

		await store.pReconcileConfiguredOperatorEntitlements({accountIds: [operator.id]});
		const currentPriorOperators = await pMakeOnlyActiveOperators(store, [operator.id]);
		const defaultOffStore = PostgresHubStore.fromConnectionString({
			connectionString: databaseUrl,
			ssl: false,
			maxConnections: 2,
			isAccountEntitlementsEnabled: false,
		});
		try {
			const freshSession = await pCreateFreshSession(defaultOffStore, operator);
			await expect(defaultOffStore.pRequestAccountDeletion({
				accountId: operator.id,
				sessionId: freshSession.id,
				idempotencyKey: crypto.randomUUID(),
			})).rejects.toMatchObject({code: "LAST_OPERATOR_PROTECTED", status: 409});
		} finally {
			await defaultOffStore.pClose();
			await store.pReconcileConfiguredOperatorEntitlements({
				accountIds: [...priorOperators, ...currentPriorOperators],
			});
		}
	});

	it("checks deletion freshness before last-operator protection", async () => {
		const priorOperators = await pMakeOnlyActiveOperators(store, [operator.id]);
		const [identity] = await store.pListExternalIdentities({accountId: operator.id});
		const staleSession = await store.pCreateSession({
			accountId: operator.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			authenticatedViaIdentityId: identity.id,
		});
		try {
			await expect(store.pRequestAccountDeletion({
				accountId: operator.id,
				sessionId: staleSession.id,
				idempotencyKey: crypto.randomUUID(),
			})).rejects.toMatchObject({code: "REAUTHENTICATION_REQUIRED", status: 403});
		} finally {
			await store.pReconcileConfiguredOperatorEntitlements({accountIds: priorOperators});
		}
	});
});
