import crypto from "node:crypto";
import pg from "pg";
import {applyJsonPatch} from "../../js/hub/hub-json-patch.js";
import {HubStoreError} from "./hub-store-error.js";
import {
	computePeerProfile,
	getDefaultProjectionPolicy,
	getPolicyManagementResponse,
	isPeerVisibleIdentity,
	projectCharacterForRequester,
	validateProjectionPolicy,
} from "./character-projection.js";
import {
	addTransferPayload,
	applyStructuredEffect,
	normalizeCharacterInventory,
	normalizeCurrency,
	removeTransferPayload,
	STRUCTURED_EFFECT_TYPES,
} from "./hub-actions.js";
import {validateCloudCharacterData, validateCloudValue} from "./cloud-data-validation.js";
import {HUB_REQUIRED_MIGRATION_VERSION} from "./migration-version.js";
import {createCharacterDisplayNameSnapshot, enrichEventPayload} from "./hub-event-snapshots.js";

const {Pool} = pg;

function getAccount (row) {
	return {
		id: row.id,
		displayName: row.display_name,
		status: row.status,
		deletionRequestedAt: row.deletion_requested_at ?? null,
		purgeAfter: row.purge_after ?? null,
	};
}

function getSession (row) {
	return {
		id: row.session_id,
		accountId: row.account_id,
		userAgent: row.user_agent,
		createdAt: row.created_at,
		lastSeenAt: row.last_seen_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
	};
}

function getCampaign (row) {
	return {
		id: row.id,
		ownerAccountId: row.owner_account_id,
		name: row.name,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		activeBrewBundleVersionId: row.active_brew_bundle_version_id,
		activeRulesVersionId: row.active_rules_version_id,
	};
}

function getMembership (row) {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		accountId: row.account_id,
		role: row.role,
		status: row.status,
		...(row.display_name == null ? {} : {displayName: row.display_name}),
	};
}

function getCharacter (row) {
	return {
		id: row.id,
		ownerAccountId: row.owner_account_id,
		campaignId: row.campaign_id,
		clonedFromCharacterId: row.cloned_from_character_id,
		clientImportId: row.client_import_id,
		status: row.status,
		schemaVersion: row.schema_version,
		revision: Number(row.revision),
		leaseEpoch: Number(row.lease_epoch),
		data: row.data,
		projectionPolicy: row.projection_policy ?? getDefaultProjectionPolicy(),
		projectionRevision: Number(row.projection_revision ?? 1),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class PostgresHubStore {
	constructor ({pool, fnOnPoolError = null}) {
		if (!pool?.query || !pool?.connect) throw new TypeError(`A pg-compatible pool is required.`);
		this._pool = pool;
		this._fnOnPoolError = fnOnPoolError || (error => {
			process.stderr.write(`Campaign Hub PostgreSQL idle client error: ${error.stack || error.message}\n`);
		});
		this._pool.on?.("error", this._fnOnPoolError);
	}

	static fromConnectionString ({
		connectionString,
		ssl = true,
		connectionTimeoutMillis = 5_000,
		queryTimeoutMillis = 10_000,
		maxConnections = 10,
		fnOnPoolError = null,
	}) {
		if (!connectionString) throw new TypeError(`connectionString is required.`);
		return new this({
			pool: new Pool({
				connectionString,
				ssl: ssl ? {rejectUnauthorized: true} : false,
				connectionTimeoutMillis,
				query_timeout: queryTimeoutMillis,
				statement_timeout: queryTimeoutMillis,
				idleTimeoutMillis: 30_000,
				max: maxConnections,
			}),
			fnOnPoolError,
		});
	}

	async pClose () {
		return this._pool.end();
	}

	async pCheckHealth () {
		const result = await this._pool.query(`
			SELECT
				to_regclass('hub.accounts') AS accounts_table,
				to_regclass('hub.schema_migrations') AS migrations_table
		`);
		if (result.rows[0]?.accounts_table !== "hub.accounts") {
			throw new Error(`Campaign Hub database migration 0001_hub_core.sql has not been applied.`);
		}
		if (result.rows[0]?.migrations_table !== "hub.schema_migrations") {
			throw new Error(`Campaign Hub migration ledger has not been initialized.`);
		}
		const migration = await this._pool.query(`
			SELECT version
			FROM hub.schema_migrations
			WHERE version = $1
		`, [HUB_REQUIRED_MIGRATION_VERSION]);
		if (!migration.rowCount) {
			throw new Error(`Campaign Hub database is missing required migration ${HUB_REQUIRED_MIGRATION_VERSION}.`);
		}
		return true;
	}

	async pUpsertOAuthAccount ({provider, providerSubject, displayName}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`
				SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 1))
			`, [provider, providerSubject]);
			const existing = await client.query(`
				SELECT a.id, a.display_name, a.status, a.deletion_requested_at, a.purge_after
				FROM hub.external_identities ei
				JOIN hub.accounts a ON a.id = ei.account_id
				WHERE ei.provider = $1 AND ei.provider_subject = $2
				FOR UPDATE
			`, [provider, providerSubject]);
			let account;
			if (existing.rowCount) {
				const updated = await client.query(`
					UPDATE hub.accounts
					SET display_name = $2, updated_at = now()
					WHERE id = $1
					RETURNING id, display_name, status, deletion_requested_at, purge_after
				`, [existing.rows[0].id, displayName]);
				account = getAccount(updated.rows[0]);
			} else {
				const accountId = crypto.randomUUID();
				const identityId = crypto.randomUUID();
				const inserted = await client.query(`
					INSERT INTO hub.accounts (id, display_name)
					VALUES ($1, $2)
					RETURNING id, display_name, status, deletion_requested_at, purge_after
				`, [accountId, displayName]);
				await client.query(`
					INSERT INTO hub.external_identities (id, account_id, provider, provider_subject)
					VALUES ($1, $2, $3, $4)
				`, [identityId, accountId, provider, providerSubject]);
				account = getAccount(inserted.rows[0]);
			}
			await client.query("COMMIT");
			return account;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pCreateSession ({accountId, tokenHash, expiresAt, userAgent = null}) {
		const id = crypto.randomUUID();
		const result = await this._pool.query(`
			INSERT INTO hub.sessions (id, account_id, token_hash, expires_at, user_agent)
			VALUES ($1, $2, decode($3, 'hex'), $4, $5)
			RETURNING id AS session_id, account_id, user_agent, created_at, last_seen_at, expires_at, revoked_at
		`, [id, accountId, tokenHash, expiresAt, userAgent]);
		return getSession(result.rows[0]);
	}

	async pGetSessionByTokenHash ({tokenHash}) {
		const result = await this._pool.query(`
			SELECT
				s.id AS session_id,
				s.account_id,
				s.user_agent,
				s.created_at,
				s.last_seen_at,
				s.expires_at,
				s.revoked_at,
				a.id,
				a.display_name,
				a.status,
				a.deletion_requested_at,
				a.purge_after
			FROM hub.sessions s
			JOIN hub.accounts a ON a.id = s.account_id
			WHERE s.token_hash = decode($1, 'hex')
				AND s.revoked_at IS NULL
				AND s.expires_at > now()
				AND a.status IN ('active', 'deletion_requested')
		`, [tokenHash]);
		if (!result.rowCount) return null;
		if (new Date(result.rows[0].last_seen_at).getTime() < Date.now() - 60_000) {
			void this._pool.query(`
				UPDATE hub.sessions
				SET last_seen_at = now()
				WHERE id = $1 AND last_seen_at < now() - interval '1 minute'
			`, [result.rows[0].session_id]).catch(error => this._fnOnPoolError(error));
		}
		return {
			session: getSession(result.rows[0]),
			account: getAccount(result.rows[0]),
		};
	}

	async pGetSessionById ({sessionId}) {
		const result = await this._pool.query(`
			SELECT
				s.id AS session_id, s.account_id, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
				a.id, a.display_name, a.status, a.deletion_requested_at, a.purge_after
			FROM hub.sessions s
			JOIN hub.accounts a ON a.id = s.account_id
			WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
				AND a.status IN ('active', 'deletion_requested')
		`, [sessionId]);
		if (!result.rowCount) return null;
		return {session: getSession(result.rows[0]), account: getAccount(result.rows[0])};
	}

	async pRevokeSession ({sessionId}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const result = await client.query(`
				UPDATE hub.sessions
				SET revoked_at = now()
				WHERE id = $1 AND revoked_at IS NULL
			`, [sessionId]);
			await client.query(`DELETE FROM hub.character_leases WHERE session_id = $1`, [sessionId]);
			await client.query(`DELETE FROM hub.dm_workspace_leases WHERE session_id = $1`, [sessionId]);
			await client.query("COMMIT");
			return result.rowCount > 0;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pListSessions ({accountId, currentSessionId = null}) {
		const result = await this._pool.query(`
				SELECT id AS session_id, account_id, user_agent, created_at, last_seen_at, expires_at, revoked_at
				FROM hub.sessions
				WHERE account_id = $1
				ORDER BY created_at DESC, id
			`, [accountId]);
		return result.rows.map(row => ({...getSession(row), isCurrent: row.session_id === currentSessionId}));
	}

	async pRevokeAccountSession ({accountId, sessionId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const result = await client.query(`
					UPDATE hub.sessions
					SET revoked_at = COALESCE(revoked_at, now())
					WHERE id = $1 AND account_id = $2
					RETURNING id
				`, [sessionId, accountId]);
			if (!result.rowCount) throw new HubStoreError("SESSION_NOT_FOUND", `Session was not found.`, {status: 404});
			await client.query(`DELETE FROM hub.character_leases WHERE session_id = $1`, [sessionId]);
			await client.query(`DELETE FROM hub.dm_workspace_leases WHERE session_id = $1`, [sessionId]);
			const response = {ok: true, revokedSessionIds: [sessionId]};
			await this._pAppendAudit({client, actorAccountId: accountId, action: "session.revoked", targetType: "session", targetId: sessionId});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "session.revoke", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pRevokeOtherSessions ({accountId, currentSessionId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const result = await client.query(`
					UPDATE hub.sessions
					SET revoked_at = COALESCE(revoked_at, now())
					WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL
					RETURNING id
				`, [accountId, currentSessionId]);
			const revokedSessionIds = result.rows.map(row => row.id);
			if (revokedSessionIds.length) {
				await client.query(`DELETE FROM hub.character_leases WHERE session_id = ANY($1::uuid[])`, [revokedSessionIds]);
				await client.query(`DELETE FROM hub.dm_workspace_leases WHERE session_id = ANY($1::uuid[])`, [revokedSessionIds]);
			}
			const response = {ok: true, revokedSessionIds};
			await this._pAppendAudit({client, actorAccountId: accountId, action: "session.revoked_others", targetType: "account", targetId: accountId, details: {count: revokedSessionIds.length}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "session.revoke_others", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pCreateCampaign ({accountId, name, idempotencyKey}) {
		const normalizedIdempotency = this._normalizeIdempotencyKey(idempotencyKey);
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`
				SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))
			`, [accountId, normalizedIdempotency.key]);
			await client.query(`
				DELETE FROM hub.command_receipts
				WHERE actor_account_id = $1 AND idempotency_key = $2 AND expires_at <= now()
			`, [accountId, normalizedIdempotency.key]);
			const prior = await client.query(`
				SELECT response, request_hash
				FROM hub.command_receipts
				WHERE actor_account_id = $1 AND idempotency_key = $2
				FOR UPDATE
			`, [accountId, normalizedIdempotency.key]);
			if (prior.rowCount) {
				if (prior.rows[0].request_hash !== normalizedIdempotency.requestHash) {
					throw new HubStoreError("IDEMPOTENCY_KEY_REUSED", `Idempotency key was reused with a different request.`, {status: 409});
				}
				await client.query("COMMIT");
				return prior.rows[0].response;
			}

			const campaignId = crypto.randomUUID();
			const membershipId = crypto.randomUUID();
			const auditId = crypto.randomUUID();
			const eventId = crypto.randomUUID();
			const campaignResult = await client.query(`
				INSERT INTO hub.campaigns (id, owner_account_id, name, next_event_sequence)
				VALUES ($1, $2, $3, 2)
				RETURNING id, owner_account_id, name, status, created_at
			`, [campaignId, accountId, name]);
			const membershipResult = await client.query(`
				INSERT INTO hub.memberships (id, campaign_id, account_id, role, status)
				VALUES ($1, $2, $3, 'dm', 'active')
				RETURNING id, campaign_id, account_id, role, status
			`, [membershipId, campaignId, accountId]);
			await client.query(`
				INSERT INTO hub.audit_entries (
					id, campaign_id, actor_account_id, action, target_type, target_id
				) VALUES ($1, $2, $3, 'campaign.created', 'campaign', $2)
			`, [auditId, campaignId, accountId]);
			await client.query(`
				INSERT INTO hub.domain_events (
					id, campaign_id, sequence, event_type, actor_account_id,
					aggregate_type, aggregate_id, visibility, payload
				) VALUES (
					$1, $2, 1, 'campaign.created', $3,
					'campaign', $2, 'all_members', jsonb_build_object('name', $4::text)
				)
			`, [eventId, campaignId, accountId, name]);
			await client.query(`
				INSERT INTO hub.outbox_entries (event_id, campaign_id)
				VALUES ($1, $2)
			`, [eventId, campaignId]);

			const campaign = campaignResult.rows[0];
			const membership = membershipResult.rows[0];
			const response = {
				campaign: {
					id: campaign.id,
					ownerAccountId: campaign.owner_account_id,
					name: campaign.name,
					status: campaign.status,
					createdAt: campaign.created_at,
				},
				membership: {
					id: membership.id,
					campaignId: membership.campaign_id,
					accountId: membership.account_id,
					role: membership.role,
					status: membership.status,
				},
			};
			await client.query(`
				INSERT INTO hub.command_receipts (
					actor_account_id, idempotency_key, request_hash, command_type, response
				) VALUES ($1, $2, $3, 'campaign.create', $4::jsonb)
			`, [accountId, normalizedIdempotency.key, normalizedIdempotency.requestHash, JSON.stringify(response)]);
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pListCampaigns ({accountId}) {
		const result = await this._pool.query(`
			SELECT
				c.id,
				c.owner_account_id,
				c.name,
				c.status,
				c.created_at,
				m.id AS membership_id,
				m.role
			FROM hub.memberships m
			JOIN hub.campaigns c ON c.id = m.campaign_id
			WHERE m.account_id = $1
				AND m.status = 'active'
				AND c.status <> 'deleting'
			ORDER BY lower(c.name), c.id
		`, [accountId]);
		return result.rows.map(row => ({
			id: row.id,
			ownerAccountId: row.owner_account_id,
			name: row.name,
			status: row.status,
			createdAt: row.created_at,
			membershipId: row.membership_id,
			role: row.role,
		}));
	}

	async pGetCampaign ({accountId, campaignId}) {
		const result = await this._pool.query(`
			SELECT
				c.id,
				c.owner_account_id,
				c.name,
				c.status,
				c.created_at,
				m.id AS membership_id,
				m.role
			FROM hub.memberships m
			JOIN hub.campaigns c ON c.id = m.campaign_id
			WHERE m.account_id = $1
				AND m.campaign_id = $2
				AND m.status = 'active'
				AND c.status <> 'deleting'
		`, [accountId, campaignId]);
		if (!result.rowCount) return null;
		const row = result.rows[0];
		return {
			id: row.id,
			ownerAccountId: row.owner_account_id,
			name: row.name,
			status: row.status,
			createdAt: row.created_at,
			membershipId: row.membership_id,
			role: row.role,
		};
	}

	async pGetMembership ({accountId, campaignId}) {
		const result = await this._pool.query(`
			SELECT id, campaign_id, account_id, role, status
			FROM hub.memberships
			WHERE campaign_id = $1 AND account_id = $2 AND status = 'active'
		`, [campaignId, accountId]);
		if (!result.rowCount) return null;
		const row = result.rows[0];
		return {
			id: row.id,
			campaignId: row.campaign_id,
			accountId: row.account_id,
			role: row.role,
			status: row.status,
		};
	}

	async _pLockCommand ({client, accountId, idempotencyKey}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		await client.query(`
			SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))
		`, [accountId, normalized.key]);
		await client.query(`
			DELETE FROM hub.command_receipts
			WHERE actor_account_id = $1 AND idempotency_key = $2 AND expires_at <= now()
		`, [accountId, normalized.key]);
		const prior = await client.query(`
			SELECT response, request_hash
			FROM hub.command_receipts
			WHERE actor_account_id = $1 AND idempotency_key = $2
			FOR UPDATE
		`, [accountId, normalized.key]);
		if (prior.rowCount && prior.rows[0].request_hash !== normalized.requestHash) {
			throw new HubStoreError("IDEMPOTENCY_KEY_REUSED", `Idempotency key was reused with a different request.`, {status: 409});
		}
		return prior.rowCount ? this._pHydrateReceiptResponse({client, response: prior.rows[0].response}) : null;
	}

	async _pSaveReceipt ({client, accountId, idempotencyKey, commandType, response}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		const storedResponse = structuredClone(response);
		if (storedResponse.character?.id && Object.hasOwn(storedResponse.character, "data")) {
			storedResponse.character = {__hubReceiptRef: "character", id: storedResponse.character.id};
		}
		await client.query(`
			INSERT INTO hub.command_receipts (actor_account_id, idempotency_key, request_hash, command_type, response)
			VALUES ($1, $2, $3, $4, $5::jsonb)
		`, [accountId, normalized.key, normalized.requestHash, commandType, JSON.stringify(storedResponse)]);
	}

	async _pHydrateReceiptResponse ({client, response}) {
		if (response?.character?.__hubReceiptRef !== "character") return response;
		const result = await client.query(`SELECT * FROM hub.characters WHERE id = $1`, [response.character.id]);
		if (!result.rowCount) throw new HubStoreError("IDEMPOTENCY_RESULT_GONE", `The prior command succeeded, but its character no longer exists.`, {status: 410});
		return {...response, character: getCharacter(result.rows[0])};
	}

	async pDeleteExpiredCommandReceipts ({limit = 1_000} = {}) {
		const result = await this._pool.query(`
			DELETE FROM hub.command_receipts
			WHERE ctid IN (
				SELECT ctid
				FROM hub.command_receipts
				WHERE expires_at <= now()
				ORDER BY expires_at
				LIMIT $1
			)
		`, [limit]);
		return result.rowCount;
	}

	async pDeletePublishedOutbox ({limit = 1_000, retentionDays = 7} = {}) {
		const result = await this._pool.query(`
			DELETE FROM hub.outbox_entries
			WHERE ctid IN (
				SELECT ctid
				FROM hub.outbox_entries
				WHERE status = 'published'
					AND published_at < now() - ($2::integer * interval '1 day')
				ORDER BY published_at, id
				LIMIT $1
			)
		`, [limit, retentionDays]);
		return result.rowCount;
	}

	async pDeleteExpiredSessions ({limit = 1_000, retentionDays = 30} = {}) {
		const result = await this._pool.query(`
			DELETE FROM hub.sessions
			WHERE ctid IN (
				SELECT ctid
				FROM hub.sessions
				WHERE (
					expires_at < now() - ($2::integer * interval '1 day')
					OR revoked_at < now() - ($2::integer * interval '1 day')
				)
				ORDER BY COALESCE(revoked_at, expires_at), id
				LIMIT $1
			)
		`, [limit, retentionDays]);
		return result.rowCount;
	}

	async pDeleteExpiredInvites ({limit = 1_000, retentionDays = 30} = {}) {
		const result = await this._pool.query(`
			DELETE FROM hub.invites
			WHERE ctid IN (
				SELECT ctid
				FROM hub.invites
				WHERE (
					expires_at < now() - ($2::integer * interval '1 day')
					OR revoked_at < now() - ($2::integer * interval '1 day')
				)
				ORDER BY COALESCE(revoked_at, expires_at), id
				LIMIT $1
			)
		`, [limit, retentionDays]);
		return result.rowCount;
	}

	async pDeleteExpiredLeases ({limit = 1_000, retentionDays = 1} = {}) {
		const characters = await this._pool.query(`
			DELETE FROM hub.character_leases
			WHERE ctid IN (
				SELECT ctid FROM hub.character_leases
				WHERE expires_at < now() - ($2::integer * interval '1 day')
				ORDER BY expires_at, character_id
				LIMIT $1
			)
		`, [limit, retentionDays]);
		const workspaces = await this._pool.query(`
			DELETE FROM hub.dm_workspace_leases
			WHERE ctid IN (
				SELECT ctid FROM hub.dm_workspace_leases
				WHERE expires_at < now() - ($2::integer * interval '1 day')
				ORDER BY expires_at, workspace_id
				LIMIT $1
			)
		`, [limit, retentionDays]);
		return {characterLeases: characters.rowCount, workspaceLeases: workspaces.rowCount};
	}

	async pGetOperationalMetrics () {
		const result = await this._pool.query(`
			SELECT
				(SELECT count(*) FROM hub.outbox_entries WHERE status IN ('pending', 'publishing', 'failed'))::bigint AS outbox_pending,
				(SELECT count(*) FROM hub.outbox_entries WHERE status = 'failed')::bigint AS outbox_failed,
				COALESCE((SELECT EXTRACT(EPOCH FROM now() - min(created_at)) FROM hub.outbox_entries WHERE status IN ('pending', 'publishing', 'failed')), 0)::double precision AS outbox_oldest_age_seconds,
				(SELECT count(*) FROM hub.sessions WHERE revoked_at IS NULL AND expires_at > now())::bigint AS active_sessions,
				(SELECT count(*) FROM hub.command_receipts WHERE expires_at <= now())::bigint AS expired_receipts,
				(SELECT count(*) FROM hub.accounts WHERE status = 'deletion_requested' AND purge_after <= now())::bigint AS deletion_due_accounts,
				COALESCE((
					SELECT EXTRACT(EPOCH FROM now() - completed_at)
					FROM hub.operational_runs
					WHERE job_type = 'maintenance' AND status = 'succeeded'
					ORDER BY completed_at DESC
					LIMIT 1
				), -1)::double precision AS last_maintenance_age_seconds,
				COALESCE((
					SELECT EXTRACT(EPOCH FROM now() - completed_at)
					FROM hub.operational_runs
					WHERE job_type = 'backup' AND status = 'succeeded'
					ORDER BY completed_at DESC
					LIMIT 1
				), -1)::double precision AS last_backup_age_seconds,
				COALESCE((
					SELECT EXTRACT(EPOCH FROM now() - completed_at)
					FROM hub.operational_runs
					WHERE job_type = 'restore_drill' AND status = 'succeeded'
					ORDER BY completed_at DESC
					LIMIT 1
				), -1)::double precision AS last_restore_drill_age_seconds
		`);
		const row = result.rows[0];
		return {
			outboxPending: Number(row.outbox_pending),
			outboxFailed: Number(row.outbox_failed),
			outboxOldestAgeSeconds: Number(row.outbox_oldest_age_seconds),
			activeSessions: Number(row.active_sessions),
			expiredReceipts: Number(row.expired_receipts),
			deletionDueAccounts: Number(row.deletion_due_accounts),
			lastMaintenanceAgeSeconds: Number(row.last_maintenance_age_seconds),
			lastBackupAgeSeconds: Number(row.last_backup_age_seconds),
			lastRestoreDrillAgeSeconds: Number(row.last_restore_drill_age_seconds),
		};
	}

	async pRunMaintenance ({batchSize = 1_000} = {}) {
		const lockClient = await this._pool.connect();
		const runId = crypto.randomUUID();
		let isLocked = false;
		try {
			const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtextextended($1, 8)) AS locked`, ["campaign-hub-maintenance"]);
			isLocked = !!lock.rows[0]?.locked;
			if (!isLocked) return {skipped: true, reason: "already_running"};
			await lockClient.query(`
				INSERT INTO hub.operational_runs (id, job_type, status, app_version)
				VALUES ($1, 'maintenance', 'running', $2)
			`, [runId, process.env.npm_package_version || null]);
			try {
				const result = {
					skipped: false,
					commandReceipts: await this.pDeleteExpiredCommandReceipts({limit: batchSize}),
					publishedOutbox: await this.pDeletePublishedOutbox({limit: batchSize}),
					sessions: await this.pDeleteExpiredSessions({limit: batchSize}),
					invites: await this.pDeleteExpiredInvites({limit: batchSize}),
					leases: await this.pDeleteExpiredLeases({limit: batchSize}),
					accounts: await this.pPurgeDueAccounts({limit: Math.min(batchSize, 100)}),
				};
				await lockClient.query(`
					UPDATE hub.operational_runs
					SET status = 'succeeded', details = $2::jsonb, completed_at = now()
					WHERE id = $1
				`, [runId, JSON.stringify(result)]);
				return result;
			} catch (error) {
				try {
					await lockClient.query(`
						UPDATE hub.operational_runs
						SET status = 'failed',
							details = jsonb_build_object('errorCode', $2::text),
							completed_at = now()
						WHERE id = $1
					`, [runId, `${error.code || error.name || "ERROR"}`.slice(0, 100)]);
				} catch (evidenceError) {
					this._fnOnPoolError(evidenceError);
				}
				throw error;
			}
		} finally {
			try {
				if (isLocked) {
					try {
						await lockClient.query(`SELECT pg_advisory_unlock(hashtextextended($1, 8))`, ["campaign-hub-maintenance"]);
					} catch (unlockError) {
						this._fnOnPoolError(unlockError);
					}
				}
			} finally {
				lockClient.release();
			}
		}
	}

	_normalizeIdempotencyKey (idempotencyKey) {
		if (idempotencyKey && typeof idempotencyKey === "object") return idempotencyKey;
		const key = `${idempotencyKey}`;
		return {key, requestHash: crypto.createHash("sha256").update(key).digest("hex")};
	}

	async _pGetMembershipForUpdate ({client, accountId, campaignId, roles = null}) {
		await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignId]);
		const result = await client.query(`
			SELECT m.id, m.campaign_id, m.account_id, m.role, m.status
			FROM hub.memberships m
			JOIN hub.campaigns c ON c.id = m.campaign_id AND c.status = 'active'
			WHERE m.campaign_id = $1 AND m.account_id = $2 AND m.status = 'active'
			FOR UPDATE OF m
		`, [campaignId, accountId]);
		if (!result.rowCount) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const membership = getMembership(result.rows[0]);
		if (roles && !roles.includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Campaign role is not allowed.`, {status: 403});
		return membership;
	}

	async _pAppendEvent ({client, campaignId, actorAccountId, type, aggregateType, aggregateId, aggregateRevision = null, visibility = "all_members", visibleAccountIds = null, payload = {}}) {
		const sequenceResult = await client.query(`
			UPDATE hub.campaigns
			SET next_event_sequence = next_event_sequence + 1, updated_at = now()
			WHERE id = $1
			RETURNING next_event_sequence - 1 AS sequence
		`, [campaignId]);
		if (!sequenceResult.rowCount) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const eventId = crypto.randomUUID();
		const characterIds = [...new Set([
			aggregateType === "character" ? aggregateId : null,
			payload.targetCharacterId,
			payload.sourceKind === "character" ? payload.sourceId : null,
			payload.targetKind === "character" ? payload.targetId : null,
			...(Array.isArray(payload.detachedCharacterIds) ? payload.detachedCharacterIds : []),
		].filter(Boolean))];
		const characterResult = characterIds.length
			? await client.query(`
				SELECT id, data->>'name' AS name
				FROM hub.characters
				WHERE id = ANY($1::uuid[]) AND campaign_id = $2
			`, [characterIds, campaignId])
			: {rows: []};
		const names = new Map(characterResult.rows.map(row => [row.id, {data: {name: row.name}}]));
		const eventPayload = enrichEventPayload({
			payload,
			aggregateType,
			aggregateId,
			getCharacterById: characterId => names.get(characterId),
		});
		await client.query(`
			INSERT INTO hub.domain_events (
				id, campaign_id, sequence, event_type, actor_account_id, aggregate_type,
				aggregate_id, aggregate_revision, visibility, visible_account_ids, payload
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
		`, [
			eventId,
			campaignId,
			sequenceResult.rows[0].sequence,
			type,
			actorAccountId,
			aggregateType,
			aggregateId,
			aggregateRevision,
			visibility,
			visibleAccountIds,
			JSON.stringify(eventPayload),
		]);
		await client.query(`
			INSERT INTO hub.outbox_entries (event_id, campaign_id)
			VALUES ($1, $2)
		`, [eventId, campaignId]);
	}

	async _pAppendAudit ({client, campaignId = null, actorAccountId, action, targetType, targetId, details = {}}) {
		await client.query(`
			INSERT INTO hub.audit_entries (
				id, campaign_id, actor_account_id, action, target_type, target_id, details
			) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		`, [crypto.randomUUID(), campaignId, actorAccountId, action, targetType, targetId, JSON.stringify(details)]);
	}

	async pListMembers ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT m.id, m.campaign_id, m.account_id, m.role, m.status, a.display_name
			FROM hub.memberships m
			JOIN hub.accounts a ON a.id = m.account_id
			WHERE m.campaign_id = $1 AND m.status = 'active'
			ORDER BY lower(a.display_name), m.id
		`, [campaignId]);
		return result.rows.map(getMembership);
	}

	async pListInvites ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		if (!["dm", "co_dm"].includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Campaign role is not allowed.`, {status: 403});
		const result = await this._pool.query(`
			SELECT id, campaign_id, role, max_uses, use_count, expires_at, revoked_at, created_at
			FROM hub.invites
			WHERE campaign_id = $1
			ORDER BY created_at DESC, id
		`, [campaignId]);
		return result.rows.map(row => ({
			id: row.id,
			campaignId: row.campaign_id,
			role: row.role,
			maxUses: row.max_uses,
			useCount: row.use_count,
			expiresAt: row.expires_at,
			revokedAt: row.revoked_at,
			createdAt: row.created_at,
		}));
	}

	async pCreateInvite ({accountId, campaignId, role, tokenHash, expiresAt, maxUses, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}

			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const inviteId = crypto.randomUUID();
			const inserted = await client.query(`
				INSERT INTO hub.invites (
					id, campaign_id, created_by_membership_id, token_hash, role, max_uses, expires_at
				) VALUES ($1, $2, $3, decode($4, 'hex'), $5, $6, $7)
				RETURNING id, campaign_id, role, max_uses, use_count, expires_at, created_at
			`, [inviteId, campaignId, membership.id, tokenHash, role, maxUses, expiresAt]);
			const row = inserted.rows[0];
			const response = {invite: {
				id: row.id,
				campaignId: row.campaign_id,
				role: row.role,
				maxUses: row.max_uses,
				useCount: row.use_count,
				expiresAt: row.expires_at,
				createdAt: row.created_at,
			}};
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "invite.created", targetType: "invite", targetId: inviteId, details: {role, maxUses}});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "invite.created", aggregateType: "invite", aggregateId: inviteId, visibility: "dm_only", payload: {role, expiresAt}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "invite.create", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pRevokeInvite ({accountId, campaignId, inviteId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const result = await client.query(`
				UPDATE hub.invites
				SET revoked_at = COALESCE(revoked_at, now())
				WHERE id = $1 AND campaign_id = $2
				RETURNING id, campaign_id, role, max_uses, use_count, expires_at, revoked_at, created_at
			`, [inviteId, campaignId]);
			if (!result.rowCount) throw new HubStoreError("INVITE_NOT_FOUND", `Invite was not found.`, {status: 404});
			const row = result.rows[0];
			const response = {invite: {
				id: row.id,
				campaignId: row.campaign_id,
				role: row.role,
				maxUses: row.max_uses,
				useCount: row.use_count,
				expiresAt: row.expires_at,
				revokedAt: row.revoked_at,
				createdAt: row.created_at,
			}};
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "invite.revoked", targetType: "invite", targetId: inviteId});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "invite.revoked", aggregateType: "invite", aggregateId: inviteId, visibility: "dm_only", payload: {}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "invite.revoke", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pRedeemInvite ({accountId, tokenHash, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const inviteResult = await client.query(`
				SELECT i.id, i.campaign_id, i.role, i.max_uses, i.use_count, i.expires_at, i.revoked_at
				FROM hub.invites i
				JOIN hub.campaigns c ON c.id = i.campaign_id AND c.status = 'active'
				WHERE i.token_hash = decode($1, 'hex')
				FOR UPDATE
			`, [tokenHash]);
			const invite = inviteResult.rows[0];
			if (!invite || invite.revoked_at || invite.expires_at <= new Date() || invite.use_count >= invite.max_uses) {
				throw new HubStoreError("INVITE_INVALID", `Invite is invalid or expired.`, {status: 404});
			}
			const activeMembership = await client.query(`
				SELECT id, campaign_id, account_id, role, status
				FROM hub.memberships
				WHERE campaign_id = $1 AND account_id = $2 AND status = 'active'
				FOR UPDATE
			`, [invite.campaign_id, accountId]);
			if (activeMembership.rowCount) {
				const response = {membership: getMembership(activeMembership.rows[0])};
				await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "invite.redeem", response});
				await client.query("COMMIT");
				return response;
			}
			const membershipResult = await client.query(`
				INSERT INTO hub.memberships (id, campaign_id, account_id, role, status)
				VALUES ($1, $2, $3, $4, 'active')
				ON CONFLICT (campaign_id, account_id) DO UPDATE
				SET role = EXCLUDED.role, status = 'active', updated_at = now()
				RETURNING id, campaign_id, account_id, role, status
			`, [crypto.randomUUID(), invite.campaign_id, accountId, invite.role]);
			await client.query(`UPDATE hub.invites SET use_count = use_count + 1 WHERE id = $1`, [invite.id]);
			const membership = getMembership(membershipResult.rows[0]);
			const response = {membership};
			await this._pAppendAudit({client, campaignId: invite.campaign_id, actorAccountId: accountId, action: "invite.redeemed", targetType: "membership", targetId: membership.id, details: {inviteId: invite.id}});
			await this._pAppendEvent({client, campaignId: invite.campaign_id, actorAccountId: accountId, type: "membership.joined", aggregateType: "membership", aggregateId: membership.id, payload: {accountId, role: membership.role}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "invite.redeem", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pListCharacters ({accountId, campaignId = null}) {
		if (!campaignId) {
			const result = await this._pool.query(`
				SELECT * FROM hub.characters
				WHERE owner_account_id = $1 AND status = 'active'
				ORDER BY lower(data->>'name'), id
			`, [accountId]);
			return result.rows.map(getCharacter);
		}
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT * FROM hub.characters
			WHERE campaign_id = $1 AND status = 'active'
				AND ($2::boolean OR owner_account_id = $3)
			ORDER BY lower(data->>'name'), id
		`, [campaignId, ["dm", "co_dm"].includes(membership.role), accountId]);
		return result.rows.map(getCharacter);
	}

	async pGetCharacter ({accountId, characterId}) {
		const result = await this._pool.query(`
			SELECT c.*, m.role AS requester_role
			FROM hub.characters c
			LEFT JOIN hub.memberships m
				ON m.campaign_id = c.campaign_id
				AND m.account_id = $1
				AND m.status = 'active'
			WHERE c.id = $2
				AND c.status = 'active'
				AND (c.owner_account_id = $1 OR m.role IS NOT NULL)
		`, [accountId, characterId]);
		if (!result.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const row = result.rows[0];
		const character = getCharacter(row);
		const authorizationClass = character.ownerAccountId === accountId
			? "owner"
			: (["dm", "co_dm"].includes(row.requester_role) ? "dm" : "peer");
		return projectCharacterForRequester({character, authorizationClass});
	}

	/**
	 * Emit the metadata-only ADR 0011 invalidation. This is the only place PostgreSQL
	 * announces that a character's projection may have changed, so a new mutation cannot
	 * silently leave peers holding stale data.
	 */
	async _pAppendProjectionInvalidation ({client, character, actorAccountId}) {
		if (!character.campaignId) return;
		await this._pAppendEvent({
			client,
			campaignId: character.campaignId,
			actorAccountId,
			type: "character.projection.invalidated",
			aggregateType: "character",
			aggregateId: character.id,
			aggregateRevision: character.revision,
			payload: {projectionRevision: character.projectionRevision},
		});
	}

	/**
	 * Project one character, isolating failures so a single corrupt policy cannot abort a
	 * batch or leak truth into the rest of it.
	 */
	_projectOne ({accountId, membership, character}) {
		const authorizationClass = character.ownerAccountId === accountId
			? "owner"
			: (["dm", "co_dm"].includes(membership.role) ? "dm" : "peer");
		try {
			return projectCharacterForRequester({character, authorizationClass});
		} catch {
			return computePeerProfile({character: {...character, projectionPolicy: null}});
		}
	}

	/**
	 * Owner attribution is campaign-roster metadata, never a character projection field:
	 * it carries a membership id rather than an account id, and it is emitted only while
	 * the character's identity is peer-visible under its own sharing policy.
	 */
	_getCampaignRoster ({membership, rows}) {
		const isDm = ["dm", "co_dm"].includes(membership.role);
		return rows
			.map(row => ({row, character: getCharacter(row)}))
			.filter(({character}) => isDm
				|| character.ownerAccountId === membership.accountId
				|| isPeerVisibleIdentity(character))
			.map(({row, character}) => ({
				characterId: character.id,
				ownerMembershipId: row.owner_membership_id ?? null,
			}));
	}

	async pListCampaignCharacterProjections ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT c.*, m.id AS owner_membership_id
			FROM hub.characters c
			LEFT JOIN hub.memberships m
				ON m.campaign_id = c.campaign_id
				AND m.account_id = c.owner_account_id
				AND m.status = 'active'
			WHERE c.campaign_id = $1 AND c.status = 'active'
			ORDER BY lower(c.data->>'name'), c.id
		`, [campaignId]);
		return {
			projections: result.rows.map(row => this._projectOne({accountId, membership, character: getCharacter(row)})),
			roster: this._getCampaignRoster({membership, rows: result.rows}),
		};
	}

	async pGetProjectionPolicy ({accountId, characterId}) {
		const result = await this._pool.query(`SELECT * FROM hub.characters WHERE id = $1 AND status = 'active' AND owner_account_id = $2`, [characterId, accountId]);
		if (!result.rowCount) throw new HubStoreError("FORBIDDEN", `Only the owner can manage sharing.`, {status: 403});
		return getPolicyManagementResponse(getCharacter(result.rows[0]));
	}

	async pSetProjectionPolicy ({accountId, characterId, policy, expectedProjectionRevision, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const current = await client.query(`SELECT * FROM hub.characters WHERE id = $1 AND status = 'active' AND owner_account_id = $2 FOR UPDATE`, [characterId, accountId]);
			if (!current.rowCount) throw new HubStoreError("FORBIDDEN", `Only the owner can manage sharing.`, {status: 403});
			const character = getCharacter(current.rows[0]);
			if (character.projectionRevision !== expectedProjectionRevision) {
				throw new HubStoreError("PROJECTION_POLICY_CONFLICT", `Sharing settings changed on another device.`, {
					status: 409,
					details: getPolicyManagementResponse(character),
				});
			}
			// Validate before any write so a rejected policy leaves the last valid one intact.
			const validated = validateProjectionPolicy(policy);
			const updated = await client.query(`
				UPDATE hub.characters
				SET projection_policy = $2::jsonb, projection_revision = projection_revision + 1, updated_at = now()
				WHERE id = $1
				RETURNING *
			`, [characterId, JSON.stringify(validated)]);
			const characterNxt = getCharacter(updated.rows[0]);
			await this._pAppendAudit({client, campaignId: characterNxt.campaignId, actorAccountId: accountId, action: "character.projection_policy.updated", targetType: "character", targetId: characterId});
			await this._pAppendProjectionInvalidation({client, character: characterNxt, actorAccountId: accountId});
			const response = getPolicyManagementResponse(characterNxt);
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "character.projection_policy.set", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pCreateCharacter ({
		accountId,
		campaignId = null,
		data,
		schemaVersion,
		clientImportId,
		idempotencyKey,
	}) {
		validateCloudCharacterData(data);
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			if (campaignId) await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 3))`, [accountId, clientImportId]);
			const existing = await client.query(`
				SELECT * FROM hub.characters
				WHERE owner_account_id = $1 AND client_import_id = $2
					AND campaign_id IS NOT DISTINCT FROM $3
				FOR UPDATE
			`, [accountId, clientImportId, campaignId]);
			let character;
			if (existing.rowCount) {
				if (existing.rows[0].status === "archived") {
					const reactivated = await client.query(`
						UPDATE hub.characters
						SET status = 'active', campaign_id = $2, schema_version = $3,
							data = $4::jsonb, revision = revision + 1, updated_at = now()
						WHERE id = $1
						RETURNING *
					`, [existing.rows[0].id, campaignId, schemaVersion, JSON.stringify(data)]);
					character = getCharacter(reactivated.rows[0]);
					await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "character.reactivated", targetType: "character", targetId: character.id});
					if (campaignId) {
						await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "character.reactivated", aggregateType: "character", aggregateId: character.id, aggregateRevision: character.revision, payload: {}});
					}
				} else character = getCharacter(existing.rows[0]);
			} else {
				const characterId = crypto.randomUUID();
				const cloneSource = await client.query(`
					SELECT id FROM hub.characters
					WHERE owner_account_id = $1 AND client_import_id = $2
					ORDER BY created_at
					LIMIT 1
				`, [accountId, clientImportId]);
				const inserted = await client.query(`
					INSERT INTO hub.characters (
						id, owner_account_id, campaign_id, client_import_id,
						cloned_from_character_id, schema_version, data
					) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
					RETURNING *
				`, [characterId, accountId, campaignId, clientImportId, cloneSource.rows[0]?.id || null, schemaVersion, JSON.stringify(data)]);
				character = getCharacter(inserted.rows[0]);
				await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "character.created", targetType: "character", targetId: characterId});
				if (campaignId) {
					await this._pAppendEvent({
						client,
						campaignId,
						actorAccountId: accountId,
						type: "character.created",
						aggregateType: "character",
						aggregateId: characterId,
						aggregateRevision: character.revision,
						payload: {ownerAccountId: accountId},
					});
				}
			}
			const response = {character};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "character.create", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pAcquireCharacterLease ({accountId, sessionId, characterId, isTakeover = false, ttlMs = 30_000}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const campaignLookup = await client.query(`SELECT campaign_id FROM hub.characters WHERE id = $1 AND status = 'active'`, [characterId]);
			if (!campaignLookup.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const expectedCampaignId = campaignLookup.rows[0].campaign_id;
			if (expectedCampaignId) await this._pGetMembershipForUpdate({client, accountId, campaignId: expectedCampaignId, roles: ["dm", "co_dm", "player"]});
			const archiveCampaign = await client.query(`SELECT campaign_id FROM hub.characters WHERE id = $1 AND status = 'active'`, [characterId]);
			if (archiveCampaign.rows[0]?.campaign_id) {
				await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [archiveCampaign.rows[0].campaign_id]);
			}
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const characterResult = await client.query(`
				SELECT * FROM hub.characters
				WHERE id = $1 AND status = 'active'
				FOR UPDATE
			`, [characterId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const character = getCharacter(characterResult.rows[0]);
			if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
			if (character.campaignId !== expectedCampaignId) throw new HubStoreError("REVISION_CONFLICT", `Character campaign changed.`, {status: 409});
			const leaseResult = await client.query(`
				SELECT character_id, session_id, epoch, expires_at
				FROM hub.character_leases
				WHERE character_id = $1
				FOR UPDATE
			`, [characterId]);
			const current = leaseResult.rows[0];
			const isActive = current && current.expires_at > new Date();
			if (isActive && current.session_id !== sessionId && !isTakeover) {
				throw new HubStoreError("LEASE_HELD", `Character is being edited by another device.`, {
					status: 409,
					details: {expiresAt: current.expires_at},
				});
			}
			const isSame = isActive && current.session_id === sessionId;
			const epoch = isSame ? Number(current.epoch) : character.leaseEpoch + 1;
			const expiresAt = new Date(Date.now() + ttlMs);
			if (!isSame) {
				await client.query(`UPDATE hub.characters SET lease_epoch = $2 WHERE id = $1`, [characterId, epoch]);
			}
			await client.query(`
				INSERT INTO hub.character_leases (character_id, session_id, epoch, expires_at)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (character_id) DO UPDATE
				SET session_id = EXCLUDED.session_id, epoch = EXCLUDED.epoch,
					expires_at = EXCLUDED.expires_at, updated_at = now()
			`, [characterId, sessionId, epoch, expiresAt]);
			await client.query("COMMIT");
			return {characterId, sessionId, epoch, expiresAt};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pReleaseCharacterLease ({accountId, sessionId, characterId}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const characterResult = await client.query(`
				SELECT owner_account_id
				FROM hub.characters
				WHERE id = $1 AND status = 'active'
				FOR UPDATE
			`, [characterId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			if (characterResult.rows[0].owner_account_id !== accountId) {
				throw new HubStoreError("FORBIDDEN", `Only the owner can release this character editor.`, {status: 403});
			}
			const leaseResult = await client.query(`
				SELECT session_id, expires_at
				FROM hub.character_leases
				WHERE character_id = $1
				FOR UPDATE
			`, [characterId]);
			const lease = leaseResult.rows[0];
			if (!lease || lease.expires_at <= new Date()) {
				if (lease) await client.query(`DELETE FROM hub.character_leases WHERE character_id = $1`, [characterId]);
				await client.query("COMMIT");
				return {released: false};
			}
			if (lease.session_id !== sessionId) {
				throw new HubStoreError("LEASE_HELD", `Character is being edited by another device.`, {
					status: 409,
					details: {expiresAt: lease.expires_at},
				});
			}
			await client.query(`DELETE FROM hub.character_leases WHERE character_id = $1`, [characterId]);
			await client.query("COMMIT");
			return {released: true};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pPatchCharacter ({
		accountId,
		sessionId,
		characterId,
		baseRevision,
		leaseEpoch,
		patches,
		idempotencyKey,
	}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const campaignLookup = await client.query(`SELECT campaign_id FROM hub.characters WHERE id = $1 AND status = 'active'`, [characterId]);
			if (!campaignLookup.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const expectedCampaignId = campaignLookup.rows[0].campaign_id;
			if (expectedCampaignId) await this._pGetMembershipForUpdate({client, accountId, campaignId: expectedCampaignId, roles: ["dm", "co_dm", "player"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const characterResult = await client.query(`
				SELECT * FROM hub.characters
				WHERE id = $1 AND status = 'active'
				FOR UPDATE
			`, [characterId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const character = getCharacter(characterResult.rows[0]);
			if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
			if (character.campaignId !== expectedCampaignId) throw new HubStoreError("REVISION_CONFLICT", `Character campaign changed.`, {status: 409});
			const leaseResult = await client.query(`
				SELECT session_id, epoch, expires_at
				FROM hub.character_leases
				WHERE character_id = $1
				FOR UPDATE
			`, [characterId]);
			const lease = leaseResult.rows[0];
			if (!lease || lease.expires_at <= new Date()) throw new HubStoreError("LEASE_EXPIRED", `Character edit lease expired.`, {status: 409});
			if (lease.session_id !== sessionId || Number(lease.epoch) !== leaseEpoch) {
				throw new HubStoreError("LEASE_FENCED", `This device no longer holds the character lease.`, {status: 409});
			}
			if (character.revision !== baseRevision) {
				throw new HubStoreError("REVISION_CONFLICT", `Character revision changed.`, {
					status: 409,
					details: {revision: character.revision, character},
				});
			}
			const data = applyJsonPatch(character.data, patches);
			validateCloudCharacterData(data);
			const updated = await client.query(`
				UPDATE hub.characters
				SET data = $2::jsonb, revision = revision + 1, updated_at = now()
				WHERE id = $1
				RETURNING *
			`, [characterId, JSON.stringify(data)]);
			const characterNxt = getCharacter(updated.rows[0]);
			if (characterNxt.campaignId) {
				await this._pAppendEvent({
					client,
					campaignId: characterNxt.campaignId,
					actorAccountId: accountId,
					type: "character.patched",
					aggregateType: "character",
					aggregateId: characterId,
					aggregateRevision: characterNxt.revision,
					visibility: "actor_and_dm",
					payload: {patches},
				});
				await this._pAppendProjectionInvalidation({client, character: characterNxt, actorAccountId: accountId});
			}
			const response = {character: characterNxt};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "character.patch", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pCloneCharacter ({accountId, characterId, campaignId, idempotencyKey}) {
		return this._pCopyOrMoveCharacter({accountId, characterId, campaignId, idempotencyKey, isMove: false});
	}

	async pMoveCharacter ({accountId, characterId, campaignId, idempotencyKey}) {
		return this._pCopyOrMoveCharacter({accountId, characterId, campaignId, idempotencyKey, isMove: true});
	}

	async _pCopyOrMoveCharacter ({accountId, characterId, campaignId, idempotencyKey, isMove}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const sourceCampaignLookup = await client.query(`SELECT campaign_id FROM hub.characters WHERE id = $1 AND status = 'active'`, [characterId]);
			if (!sourceCampaignLookup.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			for (const campaignLockId of [sourceCampaignLookup.rows[0].campaign_id, campaignId].filter(Boolean).sort()) {
				await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignLockId]);
			}
			await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const characterResult = await client.query(`
				SELECT * FROM hub.characters
				WHERE id = $1 AND status = 'active'
				FOR UPDATE
			`, [characterId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const source = getCharacter(characterResult.rows[0]);
			if (source.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can ${isMove ? "move" : "clone"} this character.`, {status: 403});

			let character;
			let action;
			const characterNameSnapshot = createCharacterDisplayNameSnapshot(source.data?.name);
			if (isMove) {
				if (source.campaignId) {
					await this._pCancelIncomingForCharacter({client, campaignId: source.campaignId, characterId, actorAccountId: accountId});
				}
				const activeLease = await client.query(`
					SELECT 1 FROM hub.character_leases
					WHERE character_id = $1 AND expires_at > now()
					FOR UPDATE
				`, [characterId]);
				if (activeLease.rowCount) throw new HubStoreError("LEASE_HELD", `Release the active editor before moving.`, {status: 409});
				const busy = await client.query(`SELECT 1 FROM hub.transfers WHERE status = 'reserved' AND source_character_id = $1 LIMIT 1`, [characterId]);
				if (busy.rowCount) throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before moving.`, {status: 409});
				const updated = await client.query(`
					UPDATE hub.characters
					SET campaign_id = $2, client_import_id = NULL, revision = revision + 1, updated_at = now()
					WHERE id = $1
					RETURNING *
				`, [characterId, campaignId]);
				character = getCharacter(updated.rows[0]);
				action = "character.moved";
			} else {
				const cloneId = crypto.randomUUID();
				const data = {...source.data, name: `${source.data.name || "Character"} (Copy)`};
				delete data.id;
				const inserted = await client.query(`
					INSERT INTO hub.characters (
						id, owner_account_id, campaign_id, cloned_from_character_id, schema_version, data, projection_policy
					) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
					RETURNING *
				`, [cloneId, accountId, campaignId, characterId, source.schemaVersion, JSON.stringify(data), JSON.stringify(source.projectionPolicy ?? getDefaultProjectionPolicy())]);
				character = getCharacter(inserted.rows[0]);
				action = "character.cloned";
			}
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action, targetType: "character", targetId: character.id, details: {sourceCampaignId: source.campaignId, sourceCharacterId: source.id}});
			if (isMove && source.campaignId && source.campaignId !== campaignId) {
				await this._pAppendEvent({
					client,
					campaignId: source.campaignId,
					actorAccountId: accountId,
					type: "character.moved_out",
					aggregateType: "character",
					aggregateId: character.id,
					aggregateRevision: character.revision,
					payload: {targetCampaignId: campaignId, characterNameSnapshot},
				});
			}
			await this._pAppendEvent({
				client,
				campaignId,
				actorAccountId: accountId,
				type: action,
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				payload: {
					sourceCampaignId: source.campaignId,
					sourceCharacterId: source.id,
					...(isMove ? {characterNameSnapshot} : {}),
				},
			});
			const response = {character};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: action, response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pArchiveCharacter ({accountId, characterId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const campaignLookup = await client.query(`SELECT campaign_id FROM hub.characters WHERE id = $1 AND status = 'active'`, [characterId]);
			if (!campaignLookup.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			if (campaignLookup.rows[0].campaign_id) {
				await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignLookup.rows[0].campaign_id]);
			}
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const existing = await client.query(`SELECT * FROM hub.characters WHERE id = $1 AND owner_account_id = $2 AND status = 'active' FOR UPDATE`, [characterId, accountId]);
			if (!existing.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const characterBefore = getCharacter(existing.rows[0]);
			if (characterBefore.campaignId) {
				await this._pCancelIncomingForCharacter({client, campaignId: characterBefore.campaignId, characterId, actorAccountId: accountId});
			}
			const reserved = await client.query(`SELECT 1 FROM hub.transfers WHERE status = 'reserved' AND source_character_id = $1 LIMIT 1`, [characterId]);
			if (reserved.rowCount) throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before archiving.`, {status: 409});
			const result = await client.query(`UPDATE hub.characters SET status = 'archived', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [characterId]);
			const character = getCharacter(result.rows[0]);
			await client.query(`DELETE FROM hub.character_leases WHERE character_id = $1`, [characterId]);
			await this._pAppendAudit({client, campaignId: character.campaignId, actorAccountId: accountId, action: "character.archived", targetType: "character", targetId: characterId});
			if (character.campaignId) {
				await this._pAppendEvent({client, campaignId: character.campaignId, actorAccountId: accountId, type: "character.archived", aggregateType: "character", aggregateId: characterId, aggregateRevision: character.revision});
			}
			const response = {ok: true};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "character.archive", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pGetCampaignContext ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT
				c.id AS campaign_id,
				b.id AS brew_id, b.version AS brew_version, b.content_hash,
				b.content, b.manifest,
				r.id AS rules_id, r.version AS rules_version,
				r.schema_version AS rules_schema_version, r.rules
			FROM hub.campaigns c
			LEFT JOIN hub.brew_bundle_versions b ON b.id = c.active_brew_bundle_version_id
			LEFT JOIN hub.rules_versions r ON r.id = c.active_rules_version_id
			WHERE c.id = $1 AND c.status <> 'deleting'
		`, [campaignId]);
		if (!result.rowCount) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const row = result.rows[0];
		return {
			campaignId: row.campaign_id,
			brewBundle: row.brew_id ? {
				id: row.brew_id,
				campaignId: row.campaign_id,
				version: row.brew_version,
				contentHash: row.content_hash,
				content: row.content,
				manifest: row.manifest,
			} : null,
			rulesVersion: row.rules_id ? {
				id: row.rules_id,
				campaignId: row.campaign_id,
				version: row.rules_version,
				schemaVersion: row.rules_schema_version,
				rules: row.rules,
			} : null,
		};
	}

	async pGetCampaignCompatibility ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT
				c.id AS campaign_id,
				b.id AS brew_id, b.version AS brew_version, b.content_hash, b.manifest,
				r.id AS rules_id, r.version AS rules_version, r.rules
			FROM hub.campaigns c
			LEFT JOIN hub.brew_bundle_versions b ON b.id = c.active_brew_bundle_version_id
			LEFT JOIN hub.rules_versions r ON r.id = c.active_rules_version_id
			WHERE c.id = $1 AND c.status <> 'deleting'
		`, [campaignId]);
		if (!result.rowCount) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const row = result.rows[0];
		return {
			campaignId: row.campaign_id,
			brewBundle: row.brew_id
				? {
					id: row.brew_id,
					version: row.brew_version,
					contentHash: row.content_hash,
					documentCount: row.manifest?.documentCount || 0,
				}
				: null,
			rulesVersion: row.rules_id
				? {
					id: row.rules_id,
					version: row.rules_version,
					rules: row.rules,
				}
				: null,
		};
	}

	async pCreateBrewBundleVersion ({accountId, campaignId, contentHash, content, manifest, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			await client.query(`SELECT id FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
			const existing = await client.query(`
				SELECT * FROM hub.brew_bundle_versions
				WHERE campaign_id = $1 AND content_hash = $2
			`, [campaignId, contentHash]);
			let row = existing.rows[0];
			if (!row) {
				const inserted = await client.query(`
					INSERT INTO hub.brew_bundle_versions (
						id, campaign_id, version, content_hash, content, manifest, created_by_membership_id
					) VALUES (
						$1, $2,
						COALESCE((SELECT max(version) + 1 FROM hub.brew_bundle_versions WHERE campaign_id = $2), 1),
						$3, $4::jsonb, $5::jsonb, $6
					)
					RETURNING *
				`, [crypto.randomUUID(), campaignId, contentHash, JSON.stringify(content), JSON.stringify(manifest), membership.id]);
				row = inserted.rows[0];
				await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "brew.created", targetType: "brew_bundle_version", targetId: row.id});
			}
			const response = {brewBundle: {
				id: row.id,
				campaignId: row.campaign_id,
				version: row.version,
				contentHash: row.content_hash,
				content: row.content,
				manifest: row.manifest,
				createdAt: row.created_at,
			}};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "brew.create", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pActivateBrewBundleVersion ({accountId, campaignId, brewBundleId, idempotencyKey}) {
		return this._pActivateCampaignVersion({accountId, campaignId, versionId: brewBundleId, idempotencyKey, kind: "brew"});
	}

	async pCreateRulesVersion ({accountId, campaignId, schemaVersion, rules, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			await client.query(`SELECT id FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
			const inserted = await client.query(`
				INSERT INTO hub.rules_versions (
					id, campaign_id, version, schema_version, rules, created_by_membership_id
				) VALUES (
					$1, $2,
					COALESCE((SELECT max(version) + 1 FROM hub.rules_versions WHERE campaign_id = $2), 1),
					$3, $4::jsonb, $5
				)
				RETURNING *
			`, [crypto.randomUUID(), campaignId, schemaVersion, JSON.stringify(rules), membership.id]);
			const row = inserted.rows[0];
			const response = {rulesVersion: {
				id: row.id,
				campaignId: row.campaign_id,
				version: row.version,
				schemaVersion: row.schema_version,
				rules: row.rules,
				createdAt: row.created_at,
			}};
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "rules.created", targetType: "rules_version", targetId: row.id});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "rules.create", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pActivateRulesVersion ({accountId, campaignId, rulesVersionId, idempotencyKey}) {
		return this._pActivateCampaignVersion({accountId, campaignId, versionId: rulesVersionId, idempotencyKey, kind: "rules"});
	}

	async _pActivateCampaignVersion ({accountId, campaignId, versionId, idempotencyKey, kind}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const table = kind === "brew" ? "brew_bundle_versions" : "rules_versions";
			const column = kind === "brew" ? "active_brew_bundle_version_id" : "active_rules_version_id";
			const version = await client.query(`SELECT * FROM hub.${table} WHERE campaign_id = $1 AND id = $2`, [campaignId, versionId]);
			if (!version.rowCount) throw new HubStoreError(kind === "brew" ? "BREW_NOT_FOUND" : "RULES_NOT_FOUND", `Campaign version was not found.`, {status: 404});
			await client.query(`UPDATE hub.campaigns SET ${column} = $2, updated_at = now() WHERE id = $1`, [campaignId, versionId]);
			const row = version.rows[0];
			const response = kind === "brew"
				? {brewBundle: {id: row.id, campaignId: row.campaign_id, version: row.version, contentHash: row.content_hash, content: row.content, manifest: row.manifest}}
				: {rulesVersion: {id: row.id, campaignId: row.campaign_id, version: row.version, schemaVersion: row.schema_version, rules: row.rules}};
			const action = `${kind}.activated`;
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action, targetType: `${kind}_version`, targetId: versionId});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: action, aggregateType: `${kind}_version`, aggregateId: versionId, payload: {version: row.version}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: action, response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pGetOrCreateDmWorkspace ({accountId, campaignId, defaultState}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			let result = await client.query(`
				SELECT * FROM hub.dm_workspaces
				WHERE campaign_id = $1 AND owner_membership_id = $2
				FOR UPDATE
			`, [campaignId, membership.id]);
			if (!result.rowCount) {
				result = await client.query(`
					INSERT INTO hub.dm_workspaces (
						id, campaign_id, owner_membership_id, schema_version, state
					) VALUES ($1, $2, $3, 1, $4::jsonb)
					RETURNING *
				`, [crypto.randomUUID(), campaignId, membership.id, JSON.stringify(defaultState)]);
				await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "dm_workspace.created", targetType: "dm_workspace", targetId: result.rows[0].id});
			} else if (result.rows[0].archived_at) {
				result = await client.query(`UPDATE hub.dm_workspaces SET archived_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [result.rows[0].id]);
			}
			await client.query("COMMIT");
			const row = result.rows[0];
			return {
				id: row.id,
				campaignId: row.campaign_id,
				ownerMembershipId: row.owner_membership_id,
				schemaVersion: row.schema_version,
				revision: Number(row.revision),
				leaseEpoch: Number(row.lease_epoch),
				state: row.state,
			};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pAcquireDmWorkspaceLease ({accountId, sessionId, campaignId, workspaceId, isTakeover = false, ttlMs = 30_000}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const workspaceResult = await client.query(`
				SELECT * FROM hub.dm_workspaces
				WHERE id = $1 AND campaign_id = $2 AND owner_membership_id = $3
				FOR UPDATE
			`, [workspaceId, campaignId, membership.id]);
			if (!workspaceResult.rowCount) throw new HubStoreError("WORKSPACE_NOT_FOUND", `DM workspace was not found.`, {status: 404});
			const workspace = workspaceResult.rows[0];
			const leaseResult = await client.query(`
				SELECT * FROM hub.dm_workspace_leases
				WHERE workspace_id = $1
				FOR UPDATE
			`, [workspaceId]);
			const current = leaseResult.rows[0];
			const isActive = current && current.expires_at > new Date();
			if (isActive && current.session_id !== sessionId && !isTakeover) {
				throw new HubStoreError("LEASE_HELD", `DM workspace is being edited on another device.`, {status: 409});
			}
			const isSame = isActive && current.session_id === sessionId;
			const epoch = isSame ? Number(current.epoch) : Number(workspace.lease_epoch) + 1;
			const expiresAt = new Date(Date.now() + ttlMs);
			if (!isSame) await client.query(`UPDATE hub.dm_workspaces SET lease_epoch = $2 WHERE id = $1`, [workspaceId, epoch]);
			await client.query(`
				INSERT INTO hub.dm_workspace_leases (workspace_id, session_id, epoch, expires_at)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (workspace_id) DO UPDATE
				SET session_id = EXCLUDED.session_id, epoch = EXCLUDED.epoch,
					expires_at = EXCLUDED.expires_at, updated_at = now()
			`, [workspaceId, sessionId, epoch, expiresAt]);
			await client.query("COMMIT");
			return {workspaceId, sessionId, epoch, expiresAt};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pWriteDmWorkspace ({
		accountId,
		sessionId,
		campaignId,
		workspaceId,
		baseRevision,
		leaseEpoch,
		state,
		idempotencyKey,
	}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const workspaceResult = await client.query(`
				SELECT * FROM hub.dm_workspaces
				WHERE id = $1 AND campaign_id = $2 AND owner_membership_id = $3
				FOR UPDATE
			`, [workspaceId, campaignId, membership.id]);
			if (!workspaceResult.rowCount) throw new HubStoreError("WORKSPACE_NOT_FOUND", `DM workspace was not found.`, {status: 404});
			const workspace = workspaceResult.rows[0];
			const leaseResult = await client.query(`
				SELECT * FROM hub.dm_workspace_leases
				WHERE workspace_id = $1
				FOR UPDATE
			`, [workspaceId]);
			const lease = leaseResult.rows[0];
			if (!lease || lease.expires_at <= new Date()) throw new HubStoreError("LEASE_EXPIRED", `DM workspace lease expired.`, {status: 409});
			if (lease.session_id !== sessionId || Number(lease.epoch) !== leaseEpoch) throw new HubStoreError("LEASE_FENCED", `This device no longer holds the DM workspace lease.`, {status: 409});
			if (Number(workspace.revision) !== baseRevision) throw new HubStoreError("REVISION_CONFLICT", `DM workspace revision changed.`, {status: 409});
			const updated = await client.query(`
				UPDATE hub.dm_workspaces
				SET state = $2::jsonb, revision = revision + 1, updated_at = now()
				WHERE id = $1
				RETURNING *
			`, [workspaceId, JSON.stringify(state)]);
			const row = updated.rows[0];
			const response = {workspace: {
				id: row.id,
				campaignId: row.campaign_id,
				ownerMembershipId: row.owner_membership_id,
				schemaVersion: row.schema_version,
				revision: Number(row.revision),
				leaseEpoch: Number(row.lease_epoch),
				state: row.state,
			}};
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "dm_workspace.updated", targetType: "dm_workspace", targetId: workspaceId});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "dm_workspace.update", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pGetCampaignSnapshot ({accountId, campaignId}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
			const membershipResult = await client.query(`
				SELECT id, campaign_id, account_id, role, status
				FROM hub.memberships
				WHERE campaign_id = $1 AND account_id = $2 AND status = 'active'
			`, [campaignId, accountId]);
			if (!membershipResult.rowCount) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
			const membership = getMembership(membershipResult.rows[0]);
			const campaignResult = await client.query(`SELECT id, owner_account_id, name, status, created_at FROM hub.campaigns WHERE id = $1`, [campaignId]);
			const characterResult = await client.query(`SELECT * FROM hub.characters WHERE campaign_id = $1 AND status = 'active' ORDER BY lower(data->>'name'), id`, [campaignId]);
			const sequenceResult = await client.query(`SELECT COALESCE(max(sequence), 0) AS sequence FROM hub.domain_events WHERE campaign_id = $1`, [campaignId]);
			const campaign = campaignResult.rows[0];
			const snapshot = {
				campaign: {
					id: campaign.id,
					ownerAccountId: campaign.owner_account_id,
					name: campaign.name,
					status: campaign.status,
					createdAt: campaign.created_at,
				},
				membership,
				characters: characterResult.rows.map(row => this._projectOne({accountId, membership, character: getCharacter(row)})),
				roster: this._getCampaignRoster({membership, rows: characterResult.rows}),
				lastSequence: Number(sequenceResult.rows[0].sequence),
			};
			await client.query("COMMIT");
			return snapshot;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * The realtime resync cursor: campaign, membership, the ids/revisions needed to
	 * invalidate client caches, and the sequence. Deliberately carries no character
	 * document or peer profile — those come from the scoped HTTP projector.
	 */
	async pGetCampaignCursor ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const [campaignResult, characterResult, sequenceResult] = await Promise.all([
			this._pool.query(`SELECT id, owner_account_id, name, status, created_at FROM hub.campaigns WHERE id = $1`, [campaignId]),
			this._pool.query(`SELECT id, revision, projection_revision FROM hub.characters WHERE campaign_id = $1 AND status = 'active' ORDER BY id`, [campaignId]),
			this._pool.query(`SELECT COALESCE(max(sequence), 0) AS sequence FROM hub.domain_events WHERE campaign_id = $1`, [campaignId]),
		]);
		const campaign = campaignResult.rows[0];
		return {
			cursor: {campaignId, lastSequence: Number(sequenceResult.rows[0].sequence)},
			campaign: campaign
				? {
					id: campaign.id,
					ownerAccountId: campaign.owner_account_id,
					name: campaign.name,
					status: campaign.status,
					createdAt: campaign.created_at,
				}
				: null,
			membership,
			characterRefs: characterResult.rows.map(row => ({
				id: row.id,
				revision: Number(row.revision),
				projectionRevision: Number(row.projection_revision ?? 1),
			})),
		};
	}

	async pListVisibleEvents ({accountId, campaignId, afterSequence = 0, limit = 500}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const isDm = ["dm", "co_dm"].includes(membership.role);
		const result = await this._pool.query(`
			SELECT e.*, a.display_name AS actor_display_name
			FROM hub.domain_events
			AS e
			LEFT JOIN hub.accounts a ON a.id = e.actor_account_id
			WHERE e.campaign_id = $1
				AND e.sequence > $2
				AND (
					e.visibility = 'all_members'
					OR ($3::boolean AND e.visibility IN ('dm_only', 'actor_and_dm'))
					OR (e.visibility = 'actor_and_dm' AND e.actor_account_id = $4)
					OR (e.visibility = 'explicit_accounts' AND ($3::boolean OR $4 = ANY(e.visible_account_ids)))
				)
			ORDER BY e.sequence
			LIMIT $5
		`, [campaignId, afterSequence, isDm, accountId, limit]);
		return result.rows.map(row => ({
			id: row.id,
			campaignId: row.campaign_id,
			sequence: Number(row.sequence),
			type: row.event_type,
			actorAccountId: row.actor_account_id,
			...(row.actor_display_name == null ? {} : {actorDisplayName: row.actor_display_name}),
			aggregateType: row.aggregate_type,
			aggregateId: row.aggregate_id,
			aggregateRevision: row.aggregate_revision == null ? null : Number(row.aggregate_revision),
			visibility: row.visibility,
			visibleAccountIds: row.visible_account_ids,
			payload: row.payload,
			createdAt: row.created_at,
		}));
	}

	async pLogRoll ({accountId, campaignId, characterId = null, visibility, payload, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			if (characterId) {
				const character = await client.query(`SELECT owner_account_id FROM hub.characters WHERE campaign_id = $1 AND id = $2 AND status = 'active'`, [campaignId, characterId]);
				if (!character.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
				if (character.rows[0].owner_account_id !== accountId && !["dm", "co_dm"].includes(membership.role)) {
					throw new HubStoreError("FORBIDDEN", `Cannot log a roll for this character.`, {status: 403});
				}
			}
			await this._pAppendEvent({
				client,
				campaignId,
				actorAccountId: accountId,
				type: "roll.logged",
				aggregateType: characterId ? "character" : "campaign",
				aggregateId: characterId || campaignId,
				visibility,
				payload,
			});
			const events = await client.query(`SELECT * FROM hub.domain_events WHERE campaign_id = $1 ORDER BY sequence DESC LIMIT 1`, [campaignId]);
			const row = events.rows[0];
			const response = {event: {
				id: row.id,
				campaignId: row.campaign_id,
				sequence: Number(row.sequence),
				type: row.event_type,
				actorAccountId: row.actor_account_id,
				aggregateType: row.aggregate_type,
				aggregateId: row.aggregate_id,
				visibility: row.visibility,
				payload: row.payload,
				createdAt: row.created_at,
			}};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "roll.log", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pClaimOutboxBatch ({limit = 100}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const claimToken = crypto.randomUUID();
			const claimed = await client.query(`
				WITH picked AS (
					SELECT o.id
					FROM hub.outbox_entries o
					WHERE (
						o.status IN ('pending', 'failed') AND o.available_at <= now()
						OR o.status = 'publishing' AND o.claimed_at < now() - interval '30 seconds'
					)
					AND NOT EXISTS (
						SELECT 1
						FROM hub.outbox_entries earlier
						WHERE earlier.campaign_id = o.campaign_id
							AND earlier.id < o.id
							AND (
								earlier.status IN ('pending', 'failed')
								OR earlier.status = 'publishing'
							)
					)
					AND NOT EXISTS (
						SELECT 1
						FROM hub.outbox_entries active_claim
						WHERE active_claim.campaign_id = o.campaign_id
							AND active_claim.id <> o.id
							AND active_claim.status = 'publishing'
							AND active_claim.claimed_at >= now() - interval '30 seconds'
					)
					ORDER BY o.id
					LIMIT $1
					FOR UPDATE SKIP LOCKED
				)
				UPDATE hub.outbox_entries o
				SET status = 'publishing', attempt_count = attempt_count + 1, claimed_at = now(), claim_token = $2
				FROM picked
				WHERE o.id = picked.id
				RETURNING o.*
			`, [limit, claimToken]);
			const out = [];
			for (const entry of claimed.rows) {
				const events = await client.query(`SELECT * FROM hub.domain_events WHERE id = $1`, [entry.event_id]);
				const row = events.rows[0];
				out.push({
					id: Number(entry.id),
					claimToken: entry.claim_token,
					event: {
						id: row.id,
						campaignId: row.campaign_id,
						sequence: Number(row.sequence),
						type: row.event_type,
						actorAccountId: row.actor_account_id,
						aggregateType: row.aggregate_type,
						aggregateId: row.aggregate_id,
						aggregateRevision: row.aggregate_revision == null ? null : Number(row.aggregate_revision),
						visibility: row.visibility,
						visibleAccountIds: row.visible_account_ids,
						payload: row.payload,
						createdAt: row.created_at,
					},
				});
			}
			await client.query("COMMIT");
			return out;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pMarkOutboxPublished ({outboxId, claimToken}) {
		await this._pool.query(`UPDATE hub.outbox_entries SET status = 'published', published_at = now(), claimed_at = NULL, claim_token = NULL, last_error = NULL WHERE id = $1 AND claim_token = $2`, [outboxId, claimToken]);
	}

	async pMarkOutboxFailed ({outboxId, claimToken, error}) {
		await this._pool.query(`
			UPDATE hub.outbox_entries
			SET status = 'failed', claimed_at = NULL, claim_token = NULL, last_error = $3, available_at = now() + interval '1 second'
			WHERE id = $1 AND claim_token = $2
		`, [outboxId, claimToken, `${error}`.slice(0, 2000)]);
	}

	async pCreateStructuredAction ({accountId, campaignId, targetCharacterId, effect, idempotencyKey}) {
		validateCloudValue(effect, {label: "Structured effect"});
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [targetCharacterId]);
			if (!STRUCTURED_EFFECT_TYPES.includes(effect?.type)) throw new HubStoreError("ACTION_INVALID", `Unsupported structured effect.`);
			const target = await client.query(`SELECT id, owner_account_id FROM hub.characters WHERE campaign_id = $1 AND id = $2 AND status = 'active'`, [campaignId, targetCharacterId]);
			if (!target.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const actionId = crypto.randomUUID();
			const inserted = await client.query(`
				INSERT INTO hub.pending_actions (
					id, campaign_id, actor_account_id, target_character_id, action_type, payload
				) VALUES ($1, $2, $3, $4, 'structured_effect', $5::jsonb)
				RETURNING *
			`, [actionId, campaignId, accountId, targetCharacterId, JSON.stringify({effect})]);
			const action = this._getPendingAction(inserted.rows[0]);
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "action.proposed", aggregateType: "pending_action", aggregateId: actionId, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, target.rows[0].owner_account_id])], payload: {targetCharacterId, effect}});
			const response = {action};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "action.propose", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	_getPendingAction (row) {
		return {
			id: row.id,
			campaignId: row.campaign_id,
			actorAccountId: row.actor_account_id,
			targetCharacterId: row.target_character_id,
			actionType: row.action_type,
			status: row.status,
			payload: row.payload,
			expiresAt: row.expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async pListPendingActions ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT pa.*
			FROM hub.pending_actions pa
			LEFT JOIN hub.characters c ON c.id = pa.target_character_id
			WHERE pa.campaign_id = $1
				AND (
					$2::boolean
					OR pa.actor_account_id = $3
					OR c.owner_account_id = $3
				)
			ORDER BY pa.created_at DESC
		`, [campaignId, ["dm", "co_dm"].includes(membership.role), accountId]);
		return result.rows.map(row => this._getPendingAction(row));
	}

	async pResolveStructuredAction ({accountId, campaignId, actionId, decision, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const targetLookup = await client.query(`SELECT target_character_id FROM hub.pending_actions WHERE campaign_id = $1 AND id = $2 AND status = 'proposed'`, [campaignId, actionId]);
			if (!targetLookup.rowCount) throw new HubStoreError("ACTION_NOT_FOUND", `Pending action was not found.`, {status: 404});
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [targetLookup.rows[0].target_character_id]);
			const actionResult = await client.query(`SELECT * FROM hub.pending_actions WHERE campaign_id = $1 AND id = $2 AND status = 'proposed' FOR UPDATE`, [campaignId, actionId]);
			if (!actionResult.rowCount) throw new HubStoreError("ACTION_NOT_FOUND", `Pending action was not found.`, {status: 404});
			const action = this._getPendingAction(actionResult.rows[0]);
			const characterResult = await client.query(`SELECT * FROM hub.characters WHERE id = $1 AND campaign_id = $2 AND status = 'active' FOR UPDATE`, [action.targetCharacterId, campaignId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const character = getCharacter(characterResult.rows[0]);
			if (character.ownerAccountId !== accountId && !["dm", "co_dm"].includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Cannot resolve this action.`, {status: 403});
			let characterNxt = character;
			const status = decision === "accept" ? "applied" : "rejected";
			if (decision === "accept") {
				const data = applyStructuredEffect({data: character.data, effect: action.payload.effect});
				validateCloudCharacterData(data);
				const updated = await client.query(`UPDATE hub.characters SET data = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [character.id, JSON.stringify(data)]);
				characterNxt = getCharacter(updated.rows[0]);
			}
			const updatedAction = await client.query(`UPDATE hub.pending_actions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [actionId, status]);
			const actionNxt = this._getPendingAction(updatedAction.rows[0]);
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: `action.${status}`, targetType: "pending_action", targetId: actionId});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: `action.${status}`, aggregateType: "pending_action", aggregateId: actionId, visibility: "explicit_accounts", visibleAccountIds: [...new Set([action.actorAccountId, character.ownerAccountId])], payload: {targetCharacterId: character.id, effect: action.payload.effect, characterRevision: characterNxt.revision}});
			// An applied effect changes hp/conditions, which are catalog fields, while the
			// action event itself is visible only to the actor and DM.
			if (decision === "accept") await this._pAppendProjectionInvalidation({client, character: characterNxt, actorAccountId: accountId});
			const response = {action: actionNxt, character: characterNxt};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "action.resolve", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pGrantXp ({accountId, campaignId, characterId, amount, reason = null, idempotencyKey}) {
		return this._pGrantCharacterMutation({
			accountId,
			campaignId,
			characterId,
			idempotencyKey,
			commandType: "xp.grant",
			fnMutate: data => ({...data, xp: Math.max(0, Math.floor(Number(data.xp) || 0) + Math.floor(amount))}),
			eventType: "xp.granted",
			eventPayload: data => ({amount, reason, xp: data.xp}),
			auditDetails: {amount, reason},
			// `xp` is not a catalog field, so no peer-visible value can change here.
			isProjectionAffecting: false,
		});
	}

	async pGrantItem ({accountId, campaignId, characterId, item, quantity = 1, idempotencyKey}) {
		validateCloudValue(item, {label: "Granted item"});
		const entry = {id: crypto.randomUUID(), item: structuredClone(item), quantity: Math.max(1, Math.floor(quantity))};
		return this._pGrantCharacterMutation({
			accountId,
			campaignId,
			characterId,
			idempotencyKey,
			commandType: "item.grant",
			fnMutate: data => {
				const out = normalizeCharacterInventory(data);
				out.inventory.push(entry);
				return out;
			},
			eventType: "item.granted",
			eventPayload: () => ({entry}),
			auditDetails: {entryId: entry.id, quantity: entry.quantity},
			responseExtra: {entry},
		});
	}

	async _pGrantCharacterMutation ({
		accountId,
		campaignId,
		characterId,
		idempotencyKey,
		commandType,
		fnMutate,
		eventType,
		eventPayload,
		auditDetails,
		responseExtra = {},
		isProjectionAffecting = true,
	}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
			const characterResult = await client.query(`SELECT * FROM hub.characters WHERE campaign_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`, [campaignId, characterId]);
			if (!characterResult.rowCount) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const data = fnMutate(characterResult.rows[0].data);
			validateCloudCharacterData(data);
			const updated = await client.query(`UPDATE hub.characters SET data = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [characterId, JSON.stringify(data)]);
			const character = getCharacter(updated.rows[0]);
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: eventType, targetType: "character", targetId: characterId, details: auditDetails});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: eventType, aggregateType: "character", aggregateId: characterId, aggregateRevision: character.revision, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, character.ownerAccountId])], payload: eventPayload(data)});
			if (isProjectionAffecting) await this._pAppendProjectionInvalidation({client, character, actorAccountId: accountId});
			const response = {character, ...responseExtra};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType, response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async _pGetOrCreatePartyInventory ({client, campaignId}) {
		await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 4))`, [campaignId]);
		let result = await client.query(`SELECT * FROM hub.party_inventories WHERE campaign_id = $1 FOR UPDATE`, [campaignId]);
		if (!result.rowCount) {
			result = await client.query(`INSERT INTO hub.party_inventories (id, campaign_id) VALUES ($1, $2) RETURNING *`, [crypto.randomUUID(), campaignId]);
		}
		return result.rows[0];
	}

	async _pReadPartyContainer ({client, party}) {
		const entries = await client.query(`SELECT * FROM hub.inventory_entries WHERE party_inventory_id = $1 ORDER BY created_at, id`, [party.id]);
		return {
			inventory: entries.rows.map(row => ({
				id: row.id,
				item: row.metadata?.item || {name: row.item_uid.split("|")[0], source: row.item_uid.split("|")[1]},
				quantity: Number(row.quantity),
			})),
			currency: normalizeCurrency(party.currency),
		};
	}

	async _pWritePartyContainer ({client, party, container}) {
		await client.query(`UPDATE hub.party_inventories SET currency = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1`, [party.id, JSON.stringify(container.currency)]);
		await client.query(`DELETE FROM hub.inventory_entries WHERE party_inventory_id = $1`, [party.id]);
		for (const entry of container.inventory) {
			await client.query(`
				INSERT INTO hub.inventory_entries (
					id, campaign_id, party_inventory_id, item_uid, quantity, metadata
				) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
			`, [entry.id, party.campaign_id, party.id, `${entry.item?.name || "item"}|${entry.item?.source || ""}`, entry.quantity, JSON.stringify({item: entry.item})]);
		}
	}

	async pGetPartyInventory ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const party = await this._pGetOrCreatePartyInventory({client, campaignId});
			const container = await this._pReadPartyContainer({client, party});
			await client.query("COMMIT");
			return {id: party.id, campaignId, revision: Number(party.revision), ...container};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async _pGetTransferContainer ({client, campaignId, kind, id, actorAccountId = null}) {
		const self = this;
		if (kind === "character") {
			const result = await client.query(`SELECT * FROM hub.characters WHERE campaign_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`, [campaignId, id]);
			if (!result.rowCount) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Character was not found.`, {status: 404});
			const character = getCharacter(result.rows[0]);
			character.data = normalizeCharacterInventory(character.data);
			return {
				kind,
				id,
				ownerAccountId: character.ownerAccountId,
				container: character.data,
				async pWrite (container) {
					validateCloudCharacterData(container);
					character.data = container;
					const updated = await client.query(`UPDATE hub.characters SET data = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, JSON.stringify(character.data)]);
					// Reserving escrow and resolving a transfer both change the inventory and
					// carry summaries of the character on either end.
					await self._pAppendProjectionInvalidation({client, character: getCharacter(updated.rows[0]), actorAccountId});
				},
			};
		}
		const party = await this._pGetOrCreatePartyInventory({client, campaignId});
		if (party.id !== id) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Party inventory was not found.`, {status: 404});
		return {
			kind,
			id,
			container: await this._pReadPartyContainer({client, party}),
			pWrite: container => this._pWritePartyContainer({client, party, container}),
		};
	}

	_getTransfer (row) {
		return {
			id: row.id,
			campaignId: row.campaign_id,
			actorAccountId: row.actor_account_id,
			sourceKind: row.source_character_id ? "character" : "party_inventory",
			sourceId: row.source_character_id || row.source_party_inventory_id,
			targetKind: row.target_character_id ? "character" : "party_inventory",
			targetId: row.target_character_id || row.target_party_inventory_id,
			status: row.status,
			payload: row.payload,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async _pCancelIncomingForCharacter ({client, campaignId, characterId, actorAccountId}) {
		await client.query(`UPDATE hub.pending_actions SET status = 'cancelled', updated_at = now() WHERE campaign_id = $1 AND target_character_id = $2 AND status = 'proposed'`, [campaignId, characterId]);
		const transfers = await client.query(`SELECT * FROM hub.transfers WHERE campaign_id = $1 AND target_character_id = $2 AND status = 'reserved' FOR UPDATE`, [campaignId, characterId]);
		for (const row of transfers.rows) {
			const transfer = this._getTransfer(row);
			const source = await this._pGetTransferContainer({client, campaignId, kind: transfer.sourceKind, id: transfer.sourceId, actorAccountId});
			await source.pWrite(addTransferPayload({container: source.container, escrow: transfer.payload.escrow, isRestore: true}));
			await client.query(`UPDATE hub.transfers SET status = 'cancelled', updated_at = now() WHERE id = $1`, [transfer.id]);
			await this._pAppendEvent({
				client,
				campaignId,
				actorAccountId,
				type: "transfer.cancelled",
				aggregateType: "transfer",
				aggregateId: transfer.id,
				payload: {
					reason: "target_lifecycle_change",
					sourceKind: transfer.sourceKind,
					sourceId: transfer.sourceId,
					targetKind: transfer.targetKind,
					targetId: transfer.targetId,
				},
			});
		}
	}

	async _pCancelTransferForLifecycle ({client, row, actorAccountId, reason}) {
		const transfer = this._getTransfer(row);
		const source = await this._pGetTransferContainer({client, campaignId: transfer.campaignId, kind: transfer.sourceKind, id: transfer.sourceId, actorAccountId});
		await source.pWrite(addTransferPayload({container: source.container, escrow: transfer.payload.escrow, isRestore: true}));
		await client.query(`UPDATE hub.transfers SET status = 'cancelled', updated_at = now() WHERE id = $1`, [transfer.id]);
		await this._pAppendEvent({
			client,
			campaignId: transfer.campaignId,
			actorAccountId,
			type: "transfer.cancelled",
			aggregateType: "transfer",
			aggregateId: transfer.id,
			payload: {
				reason,
				sourceKind: transfer.sourceKind,
				sourceId: transfer.sourceId,
				targetKind: transfer.targetKind,
				targetId: transfer.targetId,
			},
		});
	}

	async _pRemoveMembershipLifecycle ({client, campaignId, membership, actorAccountId, status}) {
		const characters = await client.query(`
			SELECT id, data->>'name' AS name
			FROM hub.characters
			WHERE campaign_id = $1 AND owner_account_id = $2 AND status = 'active'
			ORDER BY id
			FOR UPDATE
		`, [campaignId, membership.accountId]);
		const characterIds = characters.rows.map(row => row.id);
		const characterNameSnapshots = characters.rows.map(row => ({
			characterId: row.id,
			...createCharacterDisplayNameSnapshot(row.name),
		}));
		const characterNameSnapshotById = new Map(characterNameSnapshots.map(snapshot => [snapshot.characterId, snapshot]));
		for (const characterId of characterIds) {
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [characterId]);
		}

		const transfers = await client.query(`
			SELECT *
			FROM hub.transfers
			WHERE campaign_id = $1 AND status = 'reserved'
				AND (
					actor_account_id = $2
					OR source_character_id = ANY($3::uuid[])
					OR target_character_id = ANY($3::uuid[])
				)
			ORDER BY id
			FOR UPDATE
		`, [campaignId, membership.accountId, characterIds]);
		for (const row of transfers.rows) {
			await this._pCancelTransferForLifecycle({client, row, actorAccountId, reason: "membership_lifecycle"});
		}

		const actions = await client.query(`
			SELECT pa.*, c.owner_account_id AS target_owner_account_id
			FROM hub.pending_actions pa
			LEFT JOIN hub.characters c ON c.id = pa.target_character_id
			WHERE pa.campaign_id = $1 AND pa.status = 'proposed'
				AND (pa.actor_account_id = $2 OR c.owner_account_id = $2)
			ORDER BY pa.id
			FOR UPDATE OF pa
		`, [campaignId, membership.accountId]);
		if (actions.rowCount) {
			await client.query(`
				UPDATE hub.pending_actions
				SET status = 'cancelled', updated_at = now()
				WHERE id = ANY($1::uuid[])
			`, [actions.rows.map(row => row.id)]);
			for (const action of actions.rows) {
				await this._pAppendEvent({
					client,
					campaignId,
					actorAccountId,
					type: "action.cancelled",
					aggregateType: "pending_action",
					aggregateId: action.id,
					visibility: "explicit_accounts",
					visibleAccountIds: [...new Set([action.actor_account_id, action.target_owner_account_id].filter(Boolean))],
					payload: {reason: "membership_lifecycle", targetCharacterId: action.target_character_id},
				});
			}
		}

		if (characterIds.length) {
			await client.query(`DELETE FROM hub.character_leases WHERE character_id = ANY($1::uuid[])`, [characterIds]);
		}
		const detached = await client.query(`
			UPDATE hub.characters
			SET campaign_id = NULL, client_import_id = NULL, revision = revision + 1, updated_at = now()
			WHERE id = ANY($1::uuid[])
			RETURNING id, revision
		`, [characterIds]);

		const workspaces = await client.query(`SELECT id FROM hub.dm_workspaces WHERE campaign_id = $1 AND owner_membership_id = $2 FOR UPDATE`, [campaignId, membership.id]);
		if (workspaces.rowCount) {
			const workspaceIds = workspaces.rows.map(row => row.id);
			await client.query(`DELETE FROM hub.dm_workspace_leases WHERE workspace_id = ANY($1::uuid[])`, [workspaceIds]);
			await client.query(`UPDATE hub.dm_workspaces SET archived_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])`, [workspaceIds]);
		}

		const membershipResult = await client.query(`
			UPDATE hub.memberships
			SET status = $2, updated_at = now()
			WHERE id = $1
			RETURNING id, campaign_id, account_id, role, status
		`, [membership.id, status]);
		const membershipNxt = getMembership(membershipResult.rows[0]);
		for (const character of detached.rows) {
			await this._pAppendEvent({
				client,
				campaignId,
				actorAccountId,
				type: "character.moved_out",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: Number(character.revision),
				payload: {
					targetCampaignId: null,
					reason: "membership_lifecycle",
					characterNameSnapshot: characterNameSnapshotById.get(character.id),
				},
			});
		}
		await this._pAppendAudit({
			client,
			campaignId,
			actorAccountId,
			action: `membership.${status}`,
			targetType: "membership",
			targetId: membership.id,
			details: {accountId: membership.accountId, detachedCharacterIds: characterIds},
		});
		await this._pAppendEvent({
			client,
			campaignId,
			actorAccountId,
			type: `membership.${status}`,
			aggregateType: "membership",
			aggregateId: membership.id,
			payload: {accountId: membership.accountId, detachedCharacterIds: characterIds, characterNameSnapshots},
		});
		return {membership: membershipNxt, removedAccountId: membership.accountId, detachedCharacterIds: characterIds};
	}

	async pChangeMemberRole ({accountId, campaignId, membershipId, role, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignId]);
			const campaign = (await client.query(`SELECT * FROM hub.campaigns WHERE id = $1 AND status = 'active' FOR UPDATE`, [campaignId])).rows[0];
			if (!campaign) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
			if (campaign.owner_account_id !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can change roles.`, {status: 403});
			const target = (await client.query(`SELECT * FROM hub.memberships WHERE id = $1 AND campaign_id = $2 FOR UPDATE`, [membershipId, campaignId])).rows[0];
			if (!target || target.status !== "active") throw new HubStoreError("MEMBERSHIP_NOT_FOUND", `Membership was not found.`, {status: 404});
			if (target.account_id === campaign.owner_account_id) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Campaign owner role cannot be changed.`, {status: 409});
			const updated = await client.query(`UPDATE hub.memberships SET role = $2, updated_at = now() WHERE id = $1 RETURNING id, campaign_id, account_id, role, status`, [membershipId, role]);
			const membership = getMembership(updated.rows[0]);
			const response = {membership};
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "membership.role_changed", targetType: "membership", targetId: membershipId, details: {role}});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "membership.role_changed", aggregateType: "membership", aggregateId: membershipId, payload: {accountId: membership.accountId, role}});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "membership.role_change", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pRemoveMember ({accountId, campaignId, membershipId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const actor = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm"]});
			const campaign = (await client.query(`SELECT * FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId])).rows[0];
			const target = (await client.query(`SELECT * FROM hub.memberships WHERE id = $1 AND campaign_id = $2 FOR UPDATE`, [membershipId, campaignId])).rows[0];
			if (!target) throw new HubStoreError("MEMBERSHIP_NOT_FOUND", `Membership was not found.`, {status: 404});
			if (target.account_id === campaign.owner_account_id) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Campaign owner cannot be removed.`, {status: 409});
			if (target.status !== "active") {
				const response = {membership: getMembership(target), removedAccountId: target.account_id, detachedCharacterIds: []};
				await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "membership.remove", response});
				await client.query("COMMIT");
				return response;
			}
			if (campaign.owner_account_id !== accountId && (actor.role !== "co_dm" || !["player", "spectator"].includes(target.role))) {
				throw new HubStoreError("FORBIDDEN", `This member cannot be removed by the current role.`, {status: 403});
			}
			const response = await this._pRemoveMembershipLifecycle({client, campaignId, membership: getMembership(target), actorAccountId: accountId, status: "removed"});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "membership.remove", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pLeaveCampaign ({accountId, campaignId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId});
			const campaign = (await client.query(`SELECT * FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId])).rows[0];
			if (campaign.owner_account_id === accountId) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Transfer ownership or archive the campaign before leaving.`, {status: 409});
			const response = await this._pRemoveMembershipLifecycle({client, campaignId, membership, actorAccountId: accountId, status: "left"});
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "membership.leave", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pProposeTransfer ({accountId, campaignId, sourceKind, sourceId, targetKind, targetId, payload, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			for (const id of [sourceId, targetId].sort()) {
				await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [id]);
			}
			const source = await this._pGetTransferContainer({client, campaignId, kind: sourceKind, id: sourceId, actorAccountId: accountId});
			await this._pGetTransferContainer({client, campaignId, kind: targetKind, id: targetId, actorAccountId: accountId});
			if (sourceKind === "character" && source.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can transfer from this character.`, {status: 403});
			if (sourceKind === "party_inventory" && !["dm", "co_dm"].includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Only a DM can transfer from party inventory.`, {status: 403});
			const reserved = removeTransferPayload({container: source.container, payload});
			await source.pWrite(reserved.container);
			const transferId = crypto.randomUUID();
			const inserted = await client.query(`
				INSERT INTO hub.transfers (
					id, campaign_id, actor_account_id,
					source_character_id, source_party_inventory_id,
					target_character_id, target_party_inventory_id,
					status, payload
				) VALUES ($1, $2, $3, $4, $5, $6, $7, 'reserved', $8::jsonb)
				RETURNING *
			`, [
				transferId,
				campaignId,
				accountId,
				sourceKind === "character" ? sourceId : null,
				sourceKind === "party_inventory" ? sourceId : null,
				targetKind === "character" ? targetId : null,
				targetKind === "party_inventory" ? targetId : null,
				JSON.stringify({escrow: reserved.escrow}),
			]);
			const transfer = this._getTransfer(inserted.rows[0]);
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "transfer.reserved", aggregateType: "transfer", aggregateId: transferId, payload: {sourceKind, sourceId, targetKind, targetId}});
			const response = {transfer};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "transfer.propose", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pResolveTransfer ({accountId, campaignId, transferId, decision, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const transferLookup = await client.query(`SELECT * FROM hub.transfers WHERE campaign_id = $1 AND id = $2 AND status = 'reserved'`, [campaignId, transferId]);
			if (!transferLookup.rowCount) throw new HubStoreError("TRANSFER_NOT_FOUND", `Transfer was not found.`, {status: 404});
			const transferPre = this._getTransfer(transferLookup.rows[0]);
			const membership = await this._pGetMembershipForUpdate({client, accountId, campaignId});
			for (const id of [transferPre.sourceId, transferPre.targetId].sort()) await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 2))`, [id]);
			const transferResult = await client.query(`SELECT * FROM hub.transfers WHERE campaign_id = $1 AND id = $2 AND status = 'reserved' FOR UPDATE`, [campaignId, transferId]);
			if (!transferResult.rowCount) throw new HubStoreError("TRANSFER_NOT_FOUND", `Transfer was not found.`, {status: 404});
			const transfer = this._getTransfer(transferResult.rows[0]);
			const target = await this._pGetTransferContainer({client, campaignId, kind: transfer.targetKind, id: transfer.targetId, actorAccountId: accountId});
			const canResolve = transfer.targetKind === "character"
				? target.ownerAccountId === accountId || ["dm", "co_dm"].includes(membership.role)
				: ["dm", "co_dm"].includes(membership.role);
			if (!canResolve) throw new HubStoreError("FORBIDDEN", `Cannot resolve this transfer.`, {status: 403});
			const destination = decision === "accept"
				? target
				: await this._pGetTransferContainer({client, campaignId, kind: transfer.sourceKind, id: transfer.sourceId, actorAccountId: accountId});
			await destination.pWrite(addTransferPayload({container: destination.container, escrow: transfer.payload.escrow, isRestore: decision !== "accept"}));
			const status = decision === "accept" ? "committed" : "rejected";
			const updated = await client.query(`UPDATE hub.transfers SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [transferId, status]);
			const transferNxt = this._getTransfer(updated.rows[0]);
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: `transfer.${status}`, targetType: "transfer", targetId: transferId});
			await this._pAppendEvent({
				client,
				campaignId,
				actorAccountId: accountId,
				type: `transfer.${status}`,
				aggregateType: "transfer",
				aggregateId: transferId,
				payload: {
					sourceKind: transfer.sourceKind,
					sourceId: transfer.sourceId,
					targetKind: transfer.targetKind,
					targetId: transfer.targetId,
				},
			});
			const response = {transfer: transferNxt};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "transfer.resolve", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pListTransfers ({accountId, campaignId}) {
		const membership = await this.pGetMembership({accountId, campaignId});
		if (!membership) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const result = await this._pool.query(`
			SELECT t.*
			FROM hub.transfers t
			LEFT JOIN hub.characters sc ON sc.id = t.source_character_id
			LEFT JOIN hub.characters tc ON tc.id = t.target_character_id
			WHERE t.campaign_id = $1
				AND ($2::boolean OR t.actor_account_id = $3 OR sc.owner_account_id = $3 OR tc.owner_account_id = $3)
			ORDER BY t.created_at DESC
		`, [campaignId, ["dm", "co_dm"].includes(membership.role), accountId]);
		return result.rows.map(row => this._getTransfer(row));
	}

	async pGetAccountDeletion ({accountId}) {
		const result = await this._pool.query(`
			SELECT status, deletion_requested_at, purge_after
			FROM hub.accounts
			WHERE id = $1
		`, [accountId]);
		if (!result.rowCount) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		return {
			status: result.rows[0].status,
			deletionRequestedAt: result.rows[0].deletion_requested_at,
			purgeAfter: result.rows[0].purge_after,
		};
	}

	async pRequestAccountDeletion ({accountId, idempotencyKey, graceMs = 7 * 24 * 60 * 60 * 1000}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const account = (await client.query(`SELECT * FROM hub.accounts WHERE id = $1 FOR UPDATE`, [accountId])).rows[0];
			if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
			const owned = await client.query(`SELECT id FROM hub.campaigns WHERE owner_account_id = $1 AND status = 'active' ORDER BY id`, [accountId]);
			if (owned.rowCount) {
				throw new HubStoreError("ACCOUNT_OWNS_CAMPAIGN", `Transfer ownership or archive campaigns before deleting the account.`, {
					status: 409,
					details: {campaignIds: owned.rows.map(row => row.id)},
				});
			}
			let deletion;
			if (account.status === "deletion_requested") {
				deletion = {
					status: account.status,
					deletionRequestedAt: account.deletion_requested_at,
					purgeAfter: account.purge_after,
				};
			} else {
				const updated = await client.query(`
					UPDATE hub.accounts
					SET status = 'deletion_requested',
						deletion_requested_at = now(),
						purge_after = now() + ($2::bigint * interval '1 millisecond'),
						updated_at = now()
					WHERE id = $1
					RETURNING status, deletion_requested_at, purge_after
				`, [accountId, graceMs]);
				deletion = {
					status: updated.rows[0].status,
					deletionRequestedAt: updated.rows[0].deletion_requested_at,
					purgeAfter: updated.rows[0].purge_after,
				};
			}
			const sessions = await client.query(`
				UPDATE hub.sessions
				SET revoked_at = COALESCE(revoked_at, now())
				WHERE account_id = $1 AND revoked_at IS NULL
				RETURNING id
			`, [accountId]);
			const revokedSessionIds = sessions.rows.map(row => row.id);
			if (revokedSessionIds.length) {
				await client.query(`DELETE FROM hub.character_leases WHERE session_id = ANY($1::uuid[])`, [revokedSessionIds]);
				await client.query(`DELETE FROM hub.dm_workspace_leases WHERE session_id = ANY($1::uuid[])`, [revokedSessionIds]);
			}
			await this._pAppendAudit({client, actorAccountId: accountId, action: "account.deletion_requested", targetType: "account", targetId: accountId, details: {purgeAfter: deletion.purgeAfter}});
			const response = {deletion, revokedSessionIds};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "account.deletion_request", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pCancelAccountDeletion ({accountId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			const updated = await client.query(`
				UPDATE hub.accounts
				SET status = 'active', deletion_requested_at = NULL, purge_after = NULL, updated_at = now()
				WHERE id = $1 AND status = 'deletion_requested'
				RETURNING status, deletion_requested_at, purge_after
			`, [accountId]);
			if (!updated.rowCount) throw new HubStoreError("ACCOUNT_DELETION_NOT_PENDING", `Account deletion is not pending.`, {status: 409});
			const deletion = {
				status: updated.rows[0].status,
				deletionRequestedAt: updated.rows[0].deletion_requested_at,
				purgeAfter: updated.rows[0].purge_after,
			};
			await this._pAppendAudit({client, actorAccountId: accountId, action: "account.deletion_cancelled", targetType: "account", targetId: accountId});
			const response = {deletion};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "account.deletion_cancel", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pPurgeDueAccounts ({limit = 100} = {}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const accounts = await client.query(`
				SELECT *
				FROM hub.accounts
				WHERE status = 'deletion_requested' AND purge_after <= now()
				ORDER BY purge_after, id
				LIMIT $1
				FOR UPDATE SKIP LOCKED
			`, [limit]);
			const purgedAccountIds = [];
			const blockedAccountIds = [];
			for (const account of accounts.rows) {
				const blockingCampaign = await client.query(`SELECT 1 FROM hub.campaigns WHERE owner_account_id = $1 AND status <> 'archived' LIMIT 1 FOR UPDATE`, [account.id]);
				if (blockingCampaign.rowCount) {
					blockedAccountIds.push(account.id);
					continue;
				}
				const memberships = await client.query(`
					SELECT id, campaign_id, account_id, role, status
					FROM hub.memberships
					WHERE account_id = $1 AND status = 'active'
					ORDER BY campaign_id, id
					FOR UPDATE
				`, [account.id]);
				for (const row of memberships.rows) {
					await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [row.campaign_id]);
					await this._pRemoveMembershipLifecycle({
						client,
						campaignId: row.campaign_id,
						membership: getMembership(row),
						actorAccountId: account.id,
						status: "left",
					});
				}
				await client.query(`
					DELETE FROM hub.pending_actions
					WHERE target_character_id IN (SELECT id FROM hub.characters WHERE owner_account_id = $1)
				`, [account.id]);
				await client.query(`
					DELETE FROM hub.transfers
					WHERE source_character_id IN (SELECT id FROM hub.characters WHERE owner_account_id = $1)
						OR target_character_id IN (SELECT id FROM hub.characters WHERE owner_account_id = $1)
				`, [account.id]);
				await client.query(`DELETE FROM hub.character_leases WHERE character_id IN (SELECT id FROM hub.characters WHERE owner_account_id = $1)`, [account.id]);
				await client.query(`DELETE FROM hub.characters WHERE owner_account_id = $1`, [account.id]);
				await client.query(`DELETE FROM hub.campaigns WHERE owner_account_id = $1 AND status = 'archived'`, [account.id]);
				await this._pAppendAudit({client, actorAccountId: account.id, action: "account.deletion_purged", targetType: "account", targetId: account.id});
				await client.query(`DELETE FROM hub.accounts WHERE id = $1`, [account.id]);
				purgedAccountIds.push(account.id);
			}
			await client.query("COMMIT");
			return {purgedAccountIds, blockedAccountIds};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pExportAccountData ({accountId}) {
		const [account, memberships, campaigns, characters, audit] = await Promise.all([
			this._pool.query(`SELECT id, display_name, status, deletion_requested_at, purge_after, created_at, updated_at FROM hub.accounts WHERE id = $1`, [accountId]),
			this._pool.query(`SELECT id, campaign_id, account_id, role, status, created_at, updated_at FROM hub.memberships WHERE account_id = $1`, [accountId]),
			this._pool.query(`
				SELECT c.*
				FROM hub.campaigns c
				JOIN hub.memberships m ON m.campaign_id = c.id
				WHERE m.account_id = $1
			`, [accountId]),
			this._pool.query(`SELECT * FROM hub.characters WHERE owner_account_id = $1`, [accountId]),
			this._pool.query(`SELECT * FROM hub.audit_entries WHERE actor_account_id = $1 ORDER BY created_at`, [accountId]),
		]);
		if (!account.rowCount) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		return {
			exportedAt: new Date().toISOString(),
			account: getAccount(account.rows[0]),
			memberships: memberships.rows.map(getMembership),
			campaigns: campaigns.rows,
			characters: characters.rows.map(getCharacter),
			auditEntries: audit.rows,
		};
	}

	async pArchiveCampaign ({accountId, campaignId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignId]);
			const campaignResult = await client.query(`SELECT * FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
			const campaign = campaignResult.rows[0];
			if (!campaign || campaign.owner_account_id !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can archive it.`, {status: 403});
			const reserved = await client.query(`SELECT 1 FROM hub.transfers WHERE campaign_id = $1 AND status = 'reserved' LIMIT 1 FOR UPDATE`, [campaignId]);
			if (reserved.rowCount) throw new HubStoreError("CAMPAIGN_BUSY", `Resolve reserved transfers before archiving.`, {status: 409});
			await client.query(`UPDATE hub.pending_actions SET status = 'cancelled', updated_at = now() WHERE campaign_id = $1 AND status = 'proposed'`, [campaignId]);
			await client.query(`DELETE FROM hub.character_leases WHERE character_id IN (SELECT id FROM hub.characters WHERE campaign_id = $1)`, [campaignId]);
			await client.query(`UPDATE hub.characters SET campaign_id = NULL, client_import_id = NULL, revision = revision + 1, updated_at = now() WHERE campaign_id = $1`, [campaignId]);
			const updated = await client.query(`UPDATE hub.campaigns SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *`, [campaignId]);
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "campaign.archived", targetType: "campaign", targetId: campaignId});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "campaign.archived", aggregateType: "campaign", aggregateId: campaignId, payload: {}});
			const response = {campaign: getCampaign(updated.rows[0])};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "campaign.archive", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async pTransferCampaignOwnership ({accountId, campaignId, targetAccountId, idempotencyKey}) {
		const client = await this._pool.connect();
		try {
			await client.query("BEGIN");
			const prior = await this._pLockCommand({client, accountId, idempotencyKey});
			if (prior) {
				await client.query("COMMIT");
				return prior;
			}
			await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignId]);
			const campaignResult = await client.query(`SELECT * FROM hub.campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
			const campaign = campaignResult.rows[0];
			if (!campaign || campaign.owner_account_id !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can transfer ownership.`, {status: 403});
			const target = await this._pGetMembershipForUpdate({client, accountId: targetAccountId, campaignId, roles: ["dm", "co_dm"]});
			const current = await this._pGetMembershipForUpdate({client, accountId, campaignId});
			await client.query(`UPDATE hub.campaigns SET owner_account_id = $2, updated_at = now() WHERE id = $1`, [campaignId, targetAccountId]);
			await client.query(`UPDATE hub.memberships SET role = 'dm', updated_at = now() WHERE id = $1`, [target.id]);
			if (current.id !== target.id) await client.query(`UPDATE hub.memberships SET role = 'co_dm', updated_at = now() WHERE id = $1`, [current.id]);
			await this._pAppendAudit({client, campaignId, actorAccountId: accountId, action: "campaign.ownership_transferred", targetType: "campaign", targetId: campaignId, details: {targetAccountId}});
			await this._pAppendEvent({client, campaignId, actorAccountId: accountId, type: "campaign.ownership_transferred", aggregateType: "campaign", aggregateId: campaignId, payload: {targetAccountId}});
			const response = {campaign: getCampaign({...campaign, owner_account_id: targetAccountId})};
			await this._pSaveReceipt({client, accountId, idempotencyKey, commandType: "campaign.ownership_transfer", response});
			await client.query("COMMIT");
			return response;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
}
