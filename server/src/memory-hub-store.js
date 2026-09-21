import crypto from "node:crypto";
import {applyJsonPatch} from "../../js/hub/hub-json-patch.js";
import {hasFreshCarryWrite, stripCarryAuthority} from "../../js/hub/hub-carry-authority.js";
import {getExpectedCarryBasis} from "./carry-basis.js";
import {getPendingEffectPresentation} from "../../js/hub/hub-effect-presentation.js";
import {HubStoreError} from "./hub-store-error.js";
import {normalizeCharacterPatchActivity} from "./hub-spell-activity.js";
import {canViewEvent} from "./projections.js";
import {
	computePeerProfile,
	getDefaultProjectionPolicy,
	getPolicyManagementResponse,
	getPolicyNotAvailableError,
	assertPeerTargetable,
	canViewCharacterEventActor,
	canViewSharedCharacterProjection,
	canViewSharedCharacterEvent,
	redactEventActor,
	stripProjectionPolicy,
	isPeerVisibleIdentity,
	projectCharacterForRequester,
	validateProjectionPolicy,
} from "./character-projection.js";
import {
	addAwardedEntryToCharacter,
	addTransferPayload,
	applySemanticOperation,
	applySemanticOperationWithResult,
	getItemAwardIdempotencyKey,
	getItemAwardTotalQuantity,
	getSafeItemSummary,
	isDirectTransferAuthority,
	normalizeItemAwardRequest,
	normalizeItemAwardQuantity,
	normalizeCharacterInventory,
	normalizeCurrency,
	normalizeSafeItemSummary,
	normalizeSemanticOperation,
	orderTransfersForLifecycleCancellation,
	prepareTransferRequest,
	removeTransferPayload,
} from "./hub-actions.js";
import {validateCloudCharacterData, validateCloudValue} from "./cloud-data-validation.js";
import {
	CAMPAIGN_RULES_SCHEMA_VERSION,
	getPublicCampaignRulesVersion,
	normalizeCampaignRulesPolicyForStorage,
	validateCampaignBrewBundle,
} from "./campaign-content.js";
import {
	assertCharacterCampaignContentMutation,
	assertCampaignContentPolicyCatalog,
	assertCampaignContentPolicyVersion,
	assertNewCharacterCampaignContent,
	pGetCampaignContentCatalog,
	pGetCampaignContentEnforcement,
} from "./campaign-content-policy.js";
import {
	assertCampaignRuleWriteFence,
	prepareCampaignTransitionData,
} from "./campaign-rule-authority.js";
import {
	createCharacterDisplayNameSnapshot,
	enrichEventPayload,
	getTransferCharacterDisplaySnapshot,
	projectTransferForViewer,
	redactActorCommandEventForViewer,
	redactTransferEventForViewer,
} from "./hub-event-snapshots.js";
import {createSemanticOperationRegistry} from "./semantic-operation-registry.js";
import {
	applySourceCost,
	hasSourceCostBindingChanged,
	isPeerSourceCostsProtocolVersion,
	PEER_SOURCE_COSTS_CONTRACT_VERSION,
	PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION,
} from "../../js/hub/hub-source-costs.js";
import {
	createPeerSourceCostsGate,
	getPeerSourceCostFailureForViewer,
	getPeerSourceCostActionSummary,
	getPeerSourceCostsCampaignCapability,
	getPeerSourceCostsRulesPin,
	getPeerSourceCostState,
	getPrivateAcceptanceFailureCode,
	isCanonicalEqual,
	isPeerSourceCostsPinCurrent,
} from "./peer-source-cost-authority.js";
import {
	assertMultiTargetCandidateRefs,
	assertMultiTargetProtocol,
	assertUniqueResolvedTargets,
	assertUniqueSelection,
	createMultiTargetOperationsGate,
	getMultiTargetCursor,
	getMultiTargetLegAudience,
	getMultiTargetOperationSummary,
	getMultiTargetOperationsCampaignCapability,
	getMultiTargetSourceAudience,
	isMultiTargetLiveStatus,
	isMultiTargetResponseTerminal,
	MULTI_TARGET_COLLECTION_TTL_MS,
	MULTI_TARGET_OPERATION_TTL_MS,
	MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
	MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
	MULTI_TARGET_PAGE_LIMIT,
	parseMultiTargetCursor,
} from "./multi-target-operation-authority.js";
import {
	getAccountDisplayName,
	getExternalIdentityKey,
	normalizeExternalIdentity,
} from "./external-identity.js";
import {
	normalizeItemAwardResolution,
	resolveItemAwardAuthority,
} from "./item-award-catalog.js";
import {
	ACCOUNT_ENTITLEMENT_NAMES,
	CAMPAIGN_CREATE_ENTITLEMENT,
	isFreshReauthentication,
	isAccountEntitlementName,
	PLATFORM_OPERATE_ENTITLEMENT,
	redactEntitlementAuditForAccount,
	redactEntitlementForAccount,
} from "./account-entitlements.js";
import {getIdentityUnlinkBlock} from "./account-identities.js";

function copy (value) {
	return value === undefined ? undefined : structuredClone(value);
}

export class MemoryHubStore {
	constructor ({
		fnNow = () => new Date(),
		semanticOperationRegistry = createSemanticOperationRegistry(),
		semanticProposalTtlMs = 24 * 60 * 60 * 1_000,
		peerSourceCostsEnabled = false,
		multiTargetOperationsEnabled = false,
		multiTargetCollectionTtlMs = MULTI_TARGET_COLLECTION_TTL_MS,
		multiTargetOperationTtlMs = MULTI_TARGET_OPERATION_TTL_MS,
		fnResolveAwardItem = resolveItemAwardAuthority,
		isAccountEntitlementsEnabled = false,
		fnBeforeSensitiveCommit = null,
		fnTestResolveStructuredActionFault = null,
	} = {}) {
		this._fnNow = fnNow;
		this._semanticOperationRegistry = semanticOperationRegistry;
		this._semanticProposalTtlMs = semanticProposalTtlMs;
		this._isPeerSourceCostsEnabled = createPeerSourceCostsGate(peerSourceCostsEnabled);
		this._isMultiTargetOperationsEnabled = createMultiTargetOperationsGate(multiTargetOperationsEnabled);
		this._multiTargetCollectionTtlMs = multiTargetCollectionTtlMs;
		this._multiTargetOperationTtlMs = multiTargetOperationTtlMs;
		this._fnResolveAwardItem = fnResolveAwardItem;
		this._isAccountEntitlementsEnabled = isAccountEntitlementsEnabled;
		this._fnBeforeSensitiveCommit = fnBeforeSensitiveCommit;
		this._fnTestResolveStructuredActionFault = fnTestResolveStructuredActionFault;
		this._accounts = new Map();
		this._accountEntitlements = new Map();
		this._identityToAccount = new Map();
		this._externalIdentities = new Map();
		this._sessions = new Map();
		this._oauthTransactions = new Map();
		this._inviteContexts = new Map();
		this._campaigns = new Map();
		this._memberships = new Map();
		this._audit = [];
		this._events = [];
		this._campaignEvents = new Map();
		this._outbox = [];
		this._commandReceipts = new Map();
		this._invites = new Map();
		this._characters = new Map();
		this._characterLeases = new Map();
		this._brewVersions = new Map();
		this._rulesVersions = new Map();
		this._dmWorkspaces = new Map();
		this._dmWorkspaceLeases = new Map();
		this._partyInventories = new Map();
		this._pendingActions = new Map();
		this._semanticOperations = new Map();
		this._semanticOperationCommands = new Map();
		this._semanticOperationTargets = new Map();
		this._semanticOperationFinalizations = new Map();
		this._semanticMultiTargetUsage = null;
		this._multiTargetCampaignUsage = new Set();
		this._transfers = new Map();
		this._operationalRuns = [];
		this._memoryLocks = new Map();
	}

	setAccountEntitlementsEnabled (isEnabled) {
		this._isAccountEntitlementsEnabled = !!isEnabled;
	}

	_getActiveEntitlement ({accountId, entitlementName}) {
		return [...this._accountEntitlements.values()].find(entitlement => (
			entitlement.accountId === accountId
			&& entitlement.entitlementName === entitlementName
			&& !entitlement.revokedAt
		)) || null;
	}

	_getActiveEntitlementNames (accountId) {
		return ACCOUNT_ENTITLEMENT_NAMES.filter(entitlementName => this._getActiveEntitlement({accountId, entitlementName}));
	}

	_getAccountEntitlementSummary (accountId) {
		const account = this._accounts.get(accountId);
		if (!account || account.status === "deleted") return null;
		return {
			id: account.id,
			displayName: account.displayName,
			status: account.status,
			entitlements: this._getActiveEntitlementNames(account.id),
		};
	}

	_assertActiveOperator (accountId) {
		const account = this._accounts.get(accountId);
		if (
			account?.status !== "active"
			|| !this._getActiveEntitlement({accountId, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
		) throw new HubStoreError("NOT_FOUND", `Resource was not found.`, {status: 404});
		return account;
	}

	_assertFreshReauthentication ({accountId, sessionId}) {
		const session = [...this._sessions.values()].find(current => (
			current.id === sessionId
			&& current.accountId === accountId
			&& !current.revokedAt
			&& new Date(current.expiresAt) > this._fnNow()
		));
		if (
			!session
			|| !session.authenticatedViaIdentityId
			|| this._externalIdentities.get(session.authenticatedViaIdentityId)?.accountId !== accountId
			|| !isFreshReauthentication({
				recentReauthenticatedAt: session.recentReauthenticatedAt,
				now: this._fnNow(),
			})
		) throw new HubStoreError("REAUTHENTICATION_REQUIRED", `Recent reauthentication is required.`, {status: 403});
		return session;
	}

	async _pBeforeSensitiveCommit () {
		await this._fnBeforeSensitiveCommit?.();
	}

	async _pWithMemoryLock ({key, fn}) {
		const previous = this._memoryLocks.get(key) || Promise.resolve();
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const tail = previous.then(() => gate);
		this._memoryLocks.set(key, tail);
		await previous;
		try {
			return await fn();
		} finally {
			release();
			if (this._memoryLocks.get(key) === tail) this._memoryLocks.delete(key);
		}
	}

	async _pWithMemoryLocks ({keys, fn}) {
		const ordered = [...new Set(keys)].sort();
		const run = index => index >= ordered.length
			? fn()
			: this._pWithMemoryLock({key: ordered[index], fn: () => run(index + 1)});
		return run(0);
	}

	async _pWithSensitiveCommandLocks ({accountId, idempotencyKey, fn}) {
		const {key} = this._normalizeIdempotencyKey(idempotencyKey);
		return this._pWithMemoryLock({
			key: `idempotency:${accountId}:${key}`,
			fn: () => this._pWithMemoryLock({key: "operator-namespace", fn}),
		});
	}

	_setCharacterData ({character, data}) {
		for (const operation of this._semanticOperations.values()) {
			if (
				!(
					operation.status === "proposed"
					|| (operation.targetSetVersion === 1 && isMultiTargetLiveStatus(operation.status))
				)
				|| operation.sourceCharacterId !== character.id
				|| !operation.sourceCost
				|| operation.sourceCostInvalidated
			) continue;
			if (hasSourceCostBindingChanged({
				beforeData: character.data,
				afterData: data,
				sourceCost: operation.sourceCost,
			})) operation.sourceCostInvalidated = true;
		}
		character.data = data;
	}

	async pCheckHealth () {
		return true;
	}

	async pGetOperationalMetrics () {
		const now = this._fnNow();
		const last = [...this._operationalRuns].reverse().find(run => run.status === "succeeded");
		return {
			outboxPending: this._outbox.filter(entry => ["pending", "publishing", "failed"].includes(entry.status)).length,
			outboxFailed: this._outbox.filter(entry => entry.status === "failed").length,
			outboxOldestAgeSeconds: 0,
			activeSessions: [...this._sessions.values()].filter(session => !session.revokedAt && new Date(session.expiresAt) > now).length,
			expiredReceipts: 0,
			expiredOAuthTransactions: [...this._oauthTransactions.values()]
				.filter(transaction => {
					const context = transaction.inviteContextId == null
						? null
						: this._inviteContexts.get(transaction.inviteContextId);
					return (
						new Date(transaction.expiresAt) <= now
						|| (
							transaction.consumedAt
							&& context
							&& (context.consumedAt || new Date(context.expiresAt) <= now)
						)
					);
				})
				.length,
			expiredInviteContexts: [...this._inviteContexts.values()]
				.filter(context => context.consumedAt || new Date(context.expiresAt) <= now)
				.length,
			deletionDueAccounts: [...this._accounts.values()].filter(account => account.status === "deletion_requested" && new Date(account.purgeAfter) <= now).length,
			lastMaintenanceAgeSeconds: last ? Math.max(0, (now - new Date(last.completedAt)) / 1000) : -1,
			lastBackupAgeSeconds: -1,
			lastRestoreDrillAgeSeconds: -1,
		};
	}

	async pRunMaintenance ({batchSize = 1_000} = {}) {
		const now = this._fnNow();
		const result = {
			skipped: false,
			commandReceipts: 0,
			publishedOutbox: 0,
			sessions: 0,
			oauthTransactions: await this.pDeleteExpiredOAuthTransactions({limit: batchSize}),
			inviteContexts: await this.pDeleteExpiredInviteContexts({limit: batchSize}),
			invites: await this.pDeleteExpiredInvites({limit: batchSize}),
			leases: {characterLeases: 0, workspaceLeases: 0},
			multiTargetOperations: await this.pExpireMultiTargetOperations({
				limit: Math.min(batchSize, MULTI_TARGET_PAGE_LIMIT),
			}),
			multiTargetHistory: await this.pCleanupMultiTargetHistory({
				limit: Math.min(batchSize, MULTI_TARGET_PAGE_LIMIT),
			}),
			accounts: await this.pPurgeDueAccounts({limit: Math.min(batchSize, 100)}),
		};
		for (const [hash, session] of [...this._sessions]) {
			if (
				new Date(session.expiresAt) < new Date(now.getTime() - 30 * 86_400_000)
				|| (session.revokedAt && new Date(session.revokedAt) < new Date(now.getTime() - 30 * 86_400_000))
			) {
				this._sessions.delete(hash);
				result.sessions++;
			}
		}
		this._operationalRuns.push({status: "succeeded", completedAt: now.toISOString(), details: copy(result)});
		return result;
	}

	_resolveOAuthAccount (rawIdentity) {
		const identity = normalizeExternalIdentity(rawIdentity);
		const identityKey = getExternalIdentityKey(identity);
		const now = this._fnNow().toISOString();
		let accountId = this._identityToAccount.get(identityKey);
		let externalIdentity;
		if (!accountId) {
			accountId = crypto.randomUUID();
			this._accounts.set(accountId, {
				id: accountId,
				displayName: getAccountDisplayName(identity),
				status: "active",
				deletionRequestedAt: null,
				purgeAfter: null,
				createdAt: now,
			});
			this._identityToAccount.set(identityKey, accountId);
			externalIdentity = {
				id: crypto.randomUUID(),
				accountId,
				provider: identity.provider,
				subject: identity.subject,
				handle: identity.handle,
				displayName: identity.displayName,
				createdAt: now,
				updatedAt: now,
				lastAuthenticatedAt: now,
			};
			this._externalIdentities.set(externalIdentity.id, externalIdentity);
		} else {
			externalIdentity = [...this._externalIdentities.values()]
				.find(it => getExternalIdentityKey(it) === identityKey);
			externalIdentity.handle = identity.handle;
			externalIdentity.displayName = identity.displayName;
			externalIdentity.updatedAt = now;
			externalIdentity.lastAuthenticatedAt = now;
		}
		return {
			account: this._accounts.get(accountId),
			identity: externalIdentity,
		};
	}

	async pUpsertOAuthAccount ({provider, providerSubject, displayName, login = null, handle = null}) {
		const resolved = this._resolveOAuthAccount({
			provider,
			subject: providerSubject,
			displayName,
			handle: handle ?? login,
		});
		return copy(resolved.account);
	}

	async pCompleteOAuthSignIn ({
		identity,
		tokenHash,
		expiresAt,
		userAgent = null,
		priorSessionId = null,
		oauthTransactionId = null,
		isNewAccountAdmissionEnabled = false,
	}) {
		if (this._sessions.has(tokenHash)) throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
		const normalizedIdentity = normalizeExternalIdentity(identity);
		const identityKey = getExternalIdentityKey(normalizedIdentity);
		const existingAccountId = this._identityToAccount.get(identityKey);
		const transaction = oauthTransactionId == null ? null : this._oauthTransactions.get(oauthTransactionId);
		if (
			oauthTransactionId != null
			&& (
				!transaction
				|| transaction.provider !== normalizedIdentity.provider
				|| transaction.operation !== "sign_in"
				|| !transaction.consumedAt
			)
		) throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
		const inviteContext = transaction?.inviteContextId == null
			? null
			: this._inviteContexts.get(transaction.inviteContextId);
		const invite = inviteContext == null ? null : [...this._invites.values()].find(it => it.id === inviteContext.inviteId);
		const existingInviteMembership = invite && existingAccountId
			? this._memberships.get(`${invite.campaignId}::${existingAccountId}`)
			: null;
		const hasInviteContext = transaction?.inviteContextId != null;
		const isInviteValid = !!(
			transaction
			&& transaction.operation === "sign_in"
			&& transaction.provider === normalizedIdentity.provider
			&& transaction.consumedAt
			&& inviteContext
			&& !inviteContext.consumedAt
			&& new Date(inviteContext.expiresAt) > this._fnNow()
			&& invite
			&& !invite.revokedAt
			&& new Date(invite.expiresAt) > this._fnNow()
			&& (invite.useCount < invite.maxUses || existingInviteMembership?.status === "active")
			&& this._campaigns.get(invite.campaignId)?.status === "active"
		);
		if (hasInviteContext && !isInviteValid) {
			throw new HubStoreError("INVITE_ADMISSION_INVALID", `Invite admission is unavailable.`, {status: 403});
		}
		if (!existingAccountId && !isInviteValid) {
			throw new HubStoreError("INVITE_ADMISSION_REQUIRED", `Invite admission is required.`, {status: 403});
		}
		if (!existingAccountId && !isNewAccountAdmissionEnabled) {
			throw new HubStoreError("INVITE_ADMISSION_UNAVAILABLE", `Invite admission is unavailable.`, {status: 403});
		}
		const existingAccount = existingAccountId ? this._accounts.get(existingAccountId) : null;
		if (existingAccount && !["active", "deletion_requested"].includes(existingAccount.status)) {
			throw new HubStoreError("ACCOUNT_UNAVAILABLE", `Account is unavailable.`, {status: 403});
		}
		if (existingAccount?.status === "deletion_requested" && isInviteValid) {
			throw new HubStoreError("INVITE_ADMISSION_INVALID", `Invite admission is unavailable.`, {status: 403});
		}
		const isNewAccount = !existingAccountId;
		const resolved = this._resolveOAuthAccount(normalizedIdentity);
		const session = await this.pCreateSession({
			accountId: resolved.account.id,
			tokenHash,
			expiresAt,
			userAgent,
			authenticatedViaIdentityId: resolved.identity.id,
			recentReauthenticatedAt: resolved.account.status === "deletion_requested" ? this._fnNow() : null,
		});
		if (isNewAccount) {
			this._appendAudit({
				actorAccountId: resolved.account.id,
				action: "account.created",
				targetType: "account",
				targetId: resolved.account.id,
				details: {admission: "campaign_invite"},
			});
		}
		let membership = null;
		if (isInviteValid) {
			const membershipKey = `${invite.campaignId}::${resolved.account.id}`;
			const existingMembership = this._memberships.get(membershipKey);
			if (existingMembership?.status === "active") {
				membership = existingMembership;
			} else {
				membership = {
					id: existingMembership?.id || crypto.randomUUID(),
					campaignId: invite.campaignId,
					accountId: resolved.account.id,
					role: invite.role,
					status: "active",
				};
				this._memberships.set(membershipKey, membership);
				invite.useCount++;
				this._appendAudit({
					campaignId: invite.campaignId,
					actorAccountId: resolved.account.id,
					action: "invite.redeemed",
					targetType: "membership",
					targetId: membership.id,
					details: {inviteId: invite.id, admission: true},
				});
				this._appendEvent({
					campaignId: invite.campaignId,
					actorAccountId: resolved.account.id,
					type: "membership.joined",
					aggregateType: "membership",
					aggregateId: membership.id,
					payload: {accountId: resolved.account.id, role: membership.role},
				});
			}
			inviteContext.consumedAt = this._fnNow().toISOString();
			inviteContext.completedAccountId = resolved.account.id;
			inviteContext.completedSessionId = session.id;
			inviteContext.completedMembershipId = membership.id;
		}
		const revokedSessionIds = [];
		if (priorSessionId && await this.pRevokeSession({sessionId: priorSessionId})) revokedSessionIds.push(priorSessionId);
		return copy({
			account: resolved.account,
			identity: resolved.identity,
			session,
			membership,
			revokedSessionIds,
		});
	}

	async pCompleteOAuthReauthentication ({
		identity,
		tokenHash,
		expiresAt,
		userAgent = null,
		currentSessionId,
		oauthTransactionId,
	}) {
		if (this._sessions.has(tokenHash)) throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
		const normalizedIdentity = normalizeExternalIdentity(identity);
		const getAuthority = () => {
			const transaction = this._oauthTransactions.get(oauthTransactionId);
			const currentSession = [...this._sessions.values()].find(session => session.id === currentSessionId);
			const externalIdentity = [...this._externalIdentities.values()].find(candidate => (
				candidate.provider === normalizedIdentity.provider
				&& candidate.subject === normalizedIdentity.subject
			));
			const account = transaction == null ? null : this._accounts.get(transaction.initiatingAccountId);
			if (
				!transaction
				|| transaction.operation !== "reauthenticate"
				|| transaction.provider !== normalizedIdentity.provider
				|| !transaction.consumedAt
				|| new Date(transaction.expiresAt) <= this._fnNow()
				|| transaction.initiatingSessionId !== currentSessionId
				|| !currentSession
				|| currentSession.revokedAt
				|| new Date(currentSession.expiresAt) <= this._fnNow()
				|| currentSession.accountId !== transaction.initiatingAccountId
				|| !externalIdentity
				|| externalIdentity.accountId !== transaction.initiatingAccountId
				|| !account
				|| !["active", "deletion_requested"].includes(account.status)
			) throw new HubStoreError("REAUTHENTICATION_FAILED", `Reauthentication failed.`, {status: 403});
			return {account, currentSession, externalIdentity};
		};
		getAuthority();
		await this._pBeforeSensitiveCommit();
		const {account, currentSession, externalIdentity} = getAuthority();
		if (this._sessions.has(tokenHash)) throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
		const now = this._fnNow();
		const session = {
			id: crypto.randomUUID(),
			accountId: account.id,
			tokenHash,
			userAgent,
			createdAt: now.toISOString(),
			lastSeenAt: now.toISOString(),
			expiresAt,
			revokedAt: null,
			authenticatedViaIdentityId: externalIdentity.id,
			recentReauthenticatedAt: now.toISOString(),
		};
		session.expiresAt = session.expiresAt.toISOString();
		this._sessions.set(tokenHash, session);
		externalIdentity.handle = normalizedIdentity.handle;
		externalIdentity.displayName = normalizedIdentity.displayName;
		externalIdentity.updatedAt = now.toISOString();
		externalIdentity.lastAuthenticatedAt = now.toISOString();
		currentSession.revokedAt = now.toISOString();
		for (const [characterId, lease] of this._characterLeases) {
			if (lease.sessionId === currentSessionId) this._characterLeases.delete(characterId);
		}
		for (const [workspaceId, lease] of this._dmWorkspaceLeases) {
			if (lease.sessionId === currentSessionId) this._dmWorkspaceLeases.delete(workspaceId);
		}
		return copy({
			account,
			identity: externalIdentity,
			session,
			revokedSessionIds: [currentSessionId],
		});
	}

	async pCreateOAuthLinkTransaction ({
		accountId,
		sessionId,
		transaction,
		idempotencyKey,
	}) {
		const expiresAt = transaction?.expiresAt;
		if (
			!(expiresAt instanceof Date)
			|| expiresAt <= this._fnNow()
			|| expiresAt > new Date(this._fnNow().getTime() + 5 * 60_000)
		) throw new TypeError(`OAuth link transaction expiry must be within five minutes.`);
		const {key} = this._normalizeIdempotencyKey(idempotencyKey);
		return this._pWithMemoryLock({
			key: `idempotency:${accountId}:${key}`,
			fn: () => this._pWithMemoryLock({
				key: `account:${accountId}`,
				fn: async () => {
					const prior = this._getReceipt({accountId, idempotencyKey});
					if (prior) {
						const existing = this._oauthTransactions.get(prior.transactionId);
						if (!existing || existing.consumedAt || new Date(existing.expiresAt) <= this._fnNow()) {
							throw new HubStoreError("IDEMPOTENCY_RESULT_GONE", `The prior link intent is no longer available.`, {status: 410});
						}
						return {transaction: copy(existing)};
					}
					const account = this._accounts.get(accountId);
					if (account?.status !== "active") {
						throw new HubStoreError("ACCOUNT_UNAVAILABLE", `Account is unavailable.`, {status: 403});
					}
					this._assertFreshReauthentication({accountId, sessionId});
					const created = await this.pCreateOAuthTransaction({
						...transaction,
						operation: "link",
						initiatingAccountId: accountId,
						initiatingSessionId: sessionId,
					});
					try {
						await this._pBeforeSensitiveCommit();
						this._assertFreshReauthentication({accountId, sessionId});
						this._setReceipt({
							accountId,
							idempotencyKey,
							response: {transactionId: created.id},
						});
						return {transaction: created};
					} catch (error) {
						this._oauthTransactions.delete(created.id);
						throw error;
					}
				},
			}),
		});
	}

	async pCompleteOAuthLink ({
		identity,
		tokenHash,
		expiresAt,
		userAgent = null,
		currentAccountId,
		currentSessionId,
		oauthTransactionId,
		availableProviders,
	}) {
		const normalizedIdentity = normalizeExternalIdentity(identity);
		const transaction = this._oauthTransactions.get(oauthTransactionId);
		const accountId = transaction?.initiatingAccountId;
		if (!accountId || accountId !== currentAccountId) {
			throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
		}
		const idempotencyKey = {
			key: oauthTransactionId,
			requestHash: crypto.createHash("sha256")
				.update(JSON.stringify({provider: normalizedIdentity.provider, subject: normalizedIdentity.subject}))
				.digest("hex"),
		};
		return this._pWithMemoryLock({
			key: `idempotency:${accountId}:${oauthTransactionId}`,
			fn: () => this._pWithMemoryLock({
				key: `account:${accountId}`,
				fn: () => this._pWithMemoryLock({
					key: `identity:${getExternalIdentityKey(normalizedIdentity)}`,
					fn: async () => {
						const prior = this._getReceipt({accountId, idempotencyKey});
						if (prior) return prior;
						if (this._sessions.has(tokenHash)) {
							throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
						}
						const currentTransaction = this._oauthTransactions.get(oauthTransactionId);
						const account = this._accounts.get(accountId);
						const currentSession = [...this._sessions.values()].find(session => session.id === currentSessionId);
						if (
							!currentTransaction
						|| currentTransaction.operation !== "link"
						|| currentTransaction.provider !== normalizedIdentity.provider
						|| !currentTransaction.consumedAt
						|| new Date(currentTransaction.expiresAt) <= this._fnNow()
						|| currentTransaction.initiatingAccountId !== accountId
						|| currentTransaction.initiatingSessionId !== currentSessionId
						|| account?.status !== "active"
						|| !availableProviders.includes(normalizedIdentity.provider)
						|| !currentSession
						|| currentSession.accountId !== accountId
						) throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
						this._assertFreshReauthentication({accountId, sessionId: currentSessionId});
						const identityKey = getExternalIdentityKey(normalizedIdentity);
						const ownerAccountId = this._identityToAccount.get(identityKey);
						if (ownerAccountId && ownerAccountId !== accountId) {
							throw new HubStoreError("IDENTITY_ALREADY_LINKED", `Identity is already linked.`, {status: 409});
						}
						let externalIdentity = [...this._externalIdentities.values()]
							.find(candidate => getExternalIdentityKey(candidate) === identityKey);
						const isNewIdentity = !externalIdentity;
						await this._pBeforeSensitiveCommit();
						this._assertFreshReauthentication({accountId, sessionId: currentSessionId});
						if (!availableProviders.includes(normalizedIdentity.provider)) {
							throw new HubStoreError("AUTH_PROVIDER_UNAVAILABLE", `Authentication provider is unavailable.`, {status: 503});
						}
						const now = this._fnNow().toISOString();
						if (isNewIdentity) {
							externalIdentity = {
								id: crypto.randomUUID(),
								accountId,
								provider: normalizedIdentity.provider,
								subject: normalizedIdentity.subject,
								handle: normalizedIdentity.handle,
								displayName: normalizedIdentity.displayName,
								createdAt: now,
								updatedAt: now,
								lastAuthenticatedAt: now,
							};
							this._externalIdentities.set(externalIdentity.id, externalIdentity);
							this._identityToAccount.set(identityKey, accountId);
							this._appendAudit({
								actorAccountId: accountId,
								action: "identity.linked",
								targetType: "external_identity",
								targetId: externalIdentity.id,
								details: {provider: externalIdentity.provider},
							});
						} else {
							externalIdentity.handle = normalizedIdentity.handle;
							externalIdentity.displayName = normalizedIdentity.displayName;
							externalIdentity.updatedAt = now;
							externalIdentity.lastAuthenticatedAt = now;
						}
						const revokedSessionIds = [];
						for (const session of this._sessions.values()) {
							if (session.accountId !== accountId || session.revokedAt) continue;
							await this.pRevokeSession({sessionId: session.id});
							revokedSessionIds.push(session.id);
						}
						const session = await this.pCreateSession({
							accountId,
							tokenHash,
							expiresAt,
							userAgent,
							authenticatedViaIdentityId: externalIdentity.id,
							recentReauthenticatedAt: this._fnNow(),
						});
						return this._setReceipt({
							accountId,
							idempotencyKey,
							commandType: "identity.link",
							response: {
								account,
								identity: externalIdentity,
								session,
								revokedSessionIds,
							},
						});
					},
				}),
			}),
		});
	}

	async pUnlinkExternalIdentity ({
		accountId,
		currentSessionId,
		identityId,
		tokenHash,
		expiresAt,
		userAgent = null,
		idempotencyKey,
		retentionRequiredProviders,
		availableProviders,
	}) {
		const {key} = this._normalizeIdempotencyKey(idempotencyKey);
		return this._pWithMemoryLock({
			key: `idempotency:${accountId}:${key}`,
			fn: () => this._pWithMemoryLock({
				key: `account:${accountId}`,
				fn: async () => {
					const prior = this._getReceipt({accountId, idempotencyKey});
					if (prior) return prior;
					if (this._sessions.has(tokenHash)) {
						throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
					}
					const account = this._accounts.get(accountId);
					const session = [...this._sessions.values()]
						.find(candidate => candidate.id === currentSessionId && candidate.accountId === accountId);
					const identities = [...this._externalIdentities.values()]
						.filter(candidate => candidate.accountId === accountId);
					const identity = identities.find(candidate => candidate.id === identityId);
					if (!identity) {
						throw new HubStoreError("IDENTITY_NOT_FOUND", `Identity was not found.`, {status: 404});
					}
					this._assertFreshReauthentication({accountId, sessionId: currentSessionId});
					const blocked = getIdentityUnlinkBlock({
						accountStatus: account?.status,
						identities,
						identityId,
						reauthenticatedIdentityId: session.authenticatedViaIdentityId,
						retentionRequiredProviders,
						availableProviders,
					});
					if (blocked) {
						const status = blocked === "ACCOUNT_LIFECYCLE_BLOCKED" ? 403 : 409;
						throw new HubStoreError(blocked, `Identity cannot be unlinked.`, {status});
					}
					await this._pBeforeSensitiveCommit();
					this._assertFreshReauthentication({accountId, sessionId: currentSessionId});
					const currentIdentities = [...this._externalIdentities.values()]
						.filter(candidate => candidate.accountId === accountId);
					const currentBlocked = getIdentityUnlinkBlock({
						accountStatus: this._accounts.get(accountId)?.status,
						identities: currentIdentities,
						identityId,
						reauthenticatedIdentityId: session.authenticatedViaIdentityId,
						retentionRequiredProviders,
						availableProviders,
					});
					if (currentBlocked) {
						const status = currentBlocked === "IDENTITY_NOT_FOUND" ? 404 : currentBlocked === "ACCOUNT_LIFECYCLE_BLOCKED" ? 403 : 409;
						throw new HubStoreError(currentBlocked, `Identity cannot be unlinked.`, {status});
					}
					this._appendAudit({
						actorAccountId: accountId,
						action: "identity.unlinked",
						targetType: "external_identity",
						targetId: identity.id,
						details: {provider: identity.provider},
					});
					for (const accountSession of this._sessions.values()) {
						if (accountSession.authenticatedViaIdentityId !== identity.id) continue;
						accountSession.authenticatedViaIdentityId = null;
						accountSession.recentReauthenticatedAt = null;
					}
					this._externalIdentities.delete(identity.id);
					this._identityToAccount.delete(getExternalIdentityKey(identity));
					const revokedSessionIds = [];
					for (const accountSession of this._sessions.values()) {
						if (accountSession.accountId !== accountId || accountSession.revokedAt) continue;
						await this.pRevokeSession({sessionId: accountSession.id});
						revokedSessionIds.push(accountSession.id);
					}
					const replacementSession = await this.pCreateSession({
						accountId,
						tokenHash,
						expiresAt,
						userAgent,
						authenticatedViaIdentityId: session.authenticatedViaIdentityId,
						recentReauthenticatedAt: this._fnNow(),
					});
					const remainingIdentities = [...this._externalIdentities.values()]
						.filter(candidate => candidate.accountId === accountId)
						.sort((a, b) => `${a.createdAt}`.localeCompare(`${b.createdAt}`) || a.id.localeCompare(b.id))
						.map(({subject: _subject, accountId: _accountId, ...candidate}) => copy(candidate));
					return this._setReceipt({
						accountId,
						idempotencyKey,
						commandType: "identity.unlink",
						response: {
							ok: true,
							unlinkedIdentityId: identity.id,
							unlinkedProvider: identity.provider,
							session: replacementSession,
							revokedSessionIds,
							identities: remainingIdentities,
							otherDevicesSignedOut: revokedSessionIds.some(id => id !== currentSessionId),
						},
					});
				},
			}),
		});
	}

	async pListExternalIdentities ({accountId}) {
		if (!this._accounts.has(accountId)) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		return [...this._externalIdentities.values()]
			.filter(identity => identity.accountId === accountId)
			.sort((a, b) => `${a.createdAt}`.localeCompare(`${b.createdAt}`) || a.id.localeCompare(b.id))
			.map(copy);
	}

	async pGetCompletedOAuthLink ({oauthTransactionId, provider, redirectUri}) {
		const transaction = this._oauthTransactions.get(oauthTransactionId);
		if (
			!transaction
			|| transaction.operation !== "link"
			|| transaction.provider !== provider
			|| transaction.redirectUri !== redirectUri
			|| !transaction.consumedAt
			|| new Date(transaction.expiresAt) <= this._fnNow()
		) return null;
		const receipt = this._commandReceipts.get(`${transaction.initiatingAccountId}::${oauthTransactionId}`);
		if (receipt?.commandType !== "identity.link") return null;
		const session = [...this._sessions.values()].find(candidate => (
			candidate.id === receipt.response?.session?.id
			&& !candidate.revokedAt
			&& new Date(candidate.expiresAt) > this._fnNow()
		));
		if (!session) return null;
		return copy({...receipt.response, returnTo: transaction.returnTo});
	}

	async pGetIdentityUnlinkRecovery ({tokenHash, idempotencyKey}) {
		const session = this._sessions.get(tokenHash);
		if (!session || !session.revokedAt || new Date(session.expiresAt) <= this._fnNow()) return null;
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		const receipt = this._commandReceipts.get(`${session.accountId}::${normalized.key}`);
		if (
			!receipt
			|| receipt.commandType !== "identity.unlink"
			|| receipt.requestHash !== normalized.requestHash
			|| !receipt.response?.revokedSessionIds?.includes(session.id)
		) return null;
		const replacementSession = [...this._sessions.values()].find(candidate => (
			candidate.id === receipt.response.session?.id
			&& candidate.accountId === session.accountId
			&& !candidate.revokedAt
			&& new Date(candidate.expiresAt) > this._fnNow()
		));
		const account = this._accounts.get(session.accountId);
		if (!replacementSession || account?.status !== "active") return null;
		return copy({account, session, replacementSession});
	}

	async pCreateOAuthTransaction ({
		id,
		stateHash,
		provider,
		operation,
		initiatingAccountId = null,
		initiatingSessionId = null,
		redirectUri,
		returnTo,
		pkceVerifier = null,
		oidcNonce = null,
		inviteContextId = null,
		expiresAt = null,
		ttlSeconds = null,
	}) {
		const now = this._fnNow();
		const resolvedExpiresAt = ttlSeconds == null
			? expiresAt
			: new Date(now.getTime() + ttlSeconds * 1_000);
		const isSignIn = operation === "sign_in";
		const hasBinding = initiatingAccountId != null && initiatingSessionId != null;
		if (
			(expiresAt != null && ttlSeconds != null)
			|| typeof id !== "string"
			|| !/^[0-9a-f-]{36}$/i.test(id)
			|| typeof stateHash !== "string"
			|| !/^[0-9a-f]{64}$/.test(stateHash)
			|| typeof provider !== "string"
			|| !/^[a-z][a-z0-9-]{0,31}$/.test(provider)
			|| !["sign_in", "reauthenticate", "link"].includes(operation)
			|| (isSignIn ? hasBinding || initiatingAccountId != null || initiatingSessionId != null : !hasBinding)
			|| typeof redirectUri !== "string"
			|| !/^https?:\/\//.test(redirectUri)
			|| redirectUri.length > 2_048
			|| typeof returnTo !== "string"
			|| !returnTo.startsWith("/")
			|| returnTo.startsWith("//")
			|| returnTo.length > 2_048
			|| (ttlSeconds != null && (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600))
			|| !(resolvedExpiresAt instanceof Date)
			|| resolvedExpiresAt <= now
			|| resolvedExpiresAt > new Date(now.getTime() + 10 * 60 * 1_000)
			|| (pkceVerifier != null && (typeof pkceVerifier !== "string" || pkceVerifier.length < 43 || pkceVerifier.length > 128))
			|| (oidcNonce != null && (typeof oidcNonce !== "string" || oidcNonce.length < 32 || oidcNonce.length > 255))
			|| (inviteContextId != null && !this._inviteContexts.has(inviteContextId))
		) throw new TypeError(`Invalid OAuth transaction.`);
		if ([...this._oauthTransactions.values()].some(transaction => transaction.stateHash === stateHash)) {
			throw new HubStoreError("OAUTH_STATE_CONFLICT", `OAuth transaction could not be created.`, {status: 409});
		}
		if (
			inviteContextId != null
			&& [...this._oauthTransactions.values()].some(transaction => transaction.inviteContextId === inviteContextId)
		) {
			throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
		}
		if (hasBinding) {
			const session = [...this._sessions.values()]
				.find(it => it.id === initiatingSessionId && it.accountId === initiatingAccountId);
			if (
				!session
				|| session.revokedAt
				|| new Date(session.expiresAt) <= now
				|| !(
					this._accounts.get(initiatingAccountId)?.status === "active"
					|| (
						operation === "reauthenticate"
						&& this._accounts.get(initiatingAccountId)?.status === "deletion_requested"
					)
				)
			) throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
		}
		const transaction = {
			id,
			stateHash,
			provider,
			operation,
			initiatingAccountId,
			initiatingSessionId,
			redirectUri,
			returnTo,
			pkceVerifier,
			oidcNonce,
			inviteContextId,
			authorizationStartedAt: now.toISOString(),
			expiresAt: resolvedExpiresAt.toISOString(),
			consumedAt: null,
			completedAccountId: null,
			completedSessionId: null,
			completedMembershipId: null,
			createdAt: now.toISOString(),
		};
		this._oauthTransactions.set(id, transaction);
		return copy(transaction);
	}

	async pCreateInviteOAuthTransaction ({
		transaction,
		inviteTokenHash,
		retryTokenHash,
		contextTtlSeconds,
	}) {
		const invite = this._invites.get(inviteTokenHash);
		const now = this._fnNow();
		if (
			!invite
			|| invite.revokedAt
			|| new Date(invite.expiresAt) <= now
			|| invite.useCount >= invite.maxUses
			|| this._campaigns.get(invite.campaignId)?.status !== "active"
			|| !Number.isInteger(contextTtlSeconds)
			|| contextTtlSeconds < 1
			|| contextTtlSeconds > 300
			|| typeof retryTokenHash !== "string"
			|| !/^[0-9a-f]{64}$/.test(retryTokenHash)
			|| [...this._inviteContexts.values()].some(context => context.retryTokenHash === retryTokenHash)
		) throw new HubStoreError("INVITE_ADMISSION_INVALID", `Invite admission is unavailable.`, {status: 403});
		const contextId = crypto.randomUUID();
		const context = {
			id: contextId,
			inviteId: invite.id,
			retryTokenHash,
			expiresAt: new Date(Math.min(
				now.getTime() + contextTtlSeconds * 1_000,
				new Date(invite.expiresAt).getTime(),
			)).toISOString(),
			consumedAt: null,
			createdAt: now.toISOString(),
		};
		this._inviteContexts.set(contextId, context);
		try {
			return await this.pCreateOAuthTransaction({...transaction, inviteContextId: contextId});
		} catch (error) {
			this._inviteContexts.delete(contextId);
			throw error;
		}
	}

	async pRetryInviteOAuthTransaction ({
		transaction,
		retryTokenHash,
		nextRetryTokenHash,
		contextTtlSeconds,
		browserTransactionIds = [],
	}) {
		const priorContext = [...this._inviteContexts.values()].find(context => context.retryTokenHash === retryTokenHash);
		const priorTransaction = priorContext == null
			? null
			: [...this._oauthTransactions.values()].find(current => current.inviteContextId === priorContext.id);
		const invite = priorContext == null ? null : [...this._invites.values()].find(current => current.id === priorContext.inviteId);
		if (
			!priorContext
			|| priorContext.consumedAt
			|| new Date(priorContext.expiresAt) <= this._fnNow()
			|| !priorTransaction
			|| !browserTransactionIds.includes(priorTransaction.id)
			|| priorTransaction.provider !== transaction.provider
			|| !invite
			|| invite.revokedAt
			|| new Date(invite.expiresAt) <= this._fnNow()
			|| invite.useCount >= invite.maxUses
			|| this._campaigns.get(invite.campaignId)?.status !== "active"
			|| !Number.isInteger(contextTtlSeconds)
			|| contextTtlSeconds < 1
			|| contextTtlSeconds > 300
			|| !/^[0-9a-f]{64}$/.test(nextRetryTokenHash)
			|| [...this._inviteContexts.values()].some(context => context.retryTokenHash === nextRetryTokenHash)
		) throw new HubStoreError("INVITE_ADMISSION_INVALID", `Invite admission is unavailable.`, {status: 403});
		this._oauthTransactions.delete(priorTransaction.id);
		this._inviteContexts.delete(priorContext.id);
		const contextId = crypto.randomUUID();
		this._inviteContexts.set(contextId, {
			id: contextId,
			inviteId: invite.id,
			retryTokenHash: nextRetryTokenHash,
			expiresAt: new Date(Math.min(
				this._fnNow().getTime() + contextTtlSeconds * 1_000,
				new Date(invite.expiresAt).getTime(),
			)).toISOString(),
			consumedAt: null,
			completedAccountId: null,
			completedSessionId: null,
			completedMembershipId: null,
			createdAt: this._fnNow().toISOString(),
		});
		try {
			return {
				transaction: await this.pCreateOAuthTransaction({...transaction, inviteContextId: contextId}),
				replacedTransactionId: priorTransaction.id,
			};
		} catch (error) {
			this._inviteContexts.delete(contextId);
			this._inviteContexts.set(priorContext.id, priorContext);
			this._oauthTransactions.set(priorTransaction.id, priorTransaction);
			throw error;
		}
	}

	async pConsumeOAuthTransaction ({
		id,
		stateHash,
		provider,
		operation,
		redirectUri,
	}) {
		const transaction = this._oauthTransactions.get(id);
		const expectedHash = Buffer.from(transaction?.stateHash || "", "utf8");
		const actualHash = Buffer.from(stateHash || "", "utf8");
		const isHashMatch = expectedHash.length === actualHash.length
			&& expectedHash.length > 0
			&& crypto.timingSafeEqual(expectedHash, actualHash);
		if (
			!transaction
			|| transaction.consumedAt
			|| new Date(transaction.expiresAt) <= this._fnNow()
			|| !isHashMatch
			|| transaction.provider !== provider
			|| (operation != null && transaction.operation !== operation)
			|| transaction.redirectUri !== redirectUri
		) throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
		const consumed = copy(transaction);
		transaction.stateHash = null;
		transaction.pkceVerifier = null;
		transaction.oidcNonce = null;
		transaction.consumedAt = this._fnNow().toISOString();
		return consumed;
	}

	async pDeleteExpiredOAuthTransactions ({limit = 1_000} = {}) {
		const expired = [...this._oauthTransactions.values()]
			.filter(transaction => {
				const context = transaction.inviteContextId == null
					? null
					: this._inviteContexts.get(transaction.inviteContextId);
				return (
					new Date(transaction.expiresAt) <= this._fnNow()
					|| (
						transaction.consumedAt
						&& context
						&& (context.consumedAt || new Date(context.expiresAt) <= this._fnNow())
					)
				);
			})
			.sort((a, b) => `${a.expiresAt}`.localeCompare(`${b.expiresAt}`) || a.id.localeCompare(b.id))
			.slice(0, limit);
		expired.forEach(transaction => this._oauthTransactions.delete(transaction.id));
		return expired.length;
	}

	async pDeleteExpiredInviteContexts ({limit = 1_000} = {}) {
		const expired = [...this._inviteContexts.values()]
			.filter(context => new Date(context.expiresAt) <= this._fnNow() || context.consumedAt)
			.sort((a, b) => `${a.expiresAt}`.localeCompare(`${b.expiresAt}`) || a.id.localeCompare(b.id))
			.slice(0, limit);
		for (const context of expired) {
			for (const transaction of this._oauthTransactions.values()) {
				if (transaction.inviteContextId === context.id) this._oauthTransactions.delete(transaction.id);
			}
			this._inviteContexts.delete(context.id);
		}
		return expired.length;
	}

	async pDeleteExpiredInvites ({limit = 1_000, retentionDays = 30} = {}) {
		const cutoff = new Date(this._fnNow().getTime() - retentionDays * 86_400_000);
		const expired = [...this._invites.values()]
			.filter(invite => (
				new Date(invite.expiresAt) < cutoff
				|| (invite.revokedAt && new Date(invite.revokedAt) < cutoff)
			))
			.sort((a, b) => `${a.revokedAt || a.expiresAt}`.localeCompare(`${b.revokedAt || b.expiresAt}`) || a.id.localeCompare(b.id))
			.slice(0, limit);
		for (const invite of expired) this._deleteInvite(invite);
		return expired.length;
	}

	_deleteInvite (invite) {
		this._invites.delete(invite.tokenHash);
		for (const context of [...this._inviteContexts.values()]) {
			if (context.inviteId !== invite.id) continue;
			for (const transaction of [...this._oauthTransactions.values()]) {
				if (transaction.inviteContextId === context.id) this._oauthTransactions.delete(transaction.id);
			}
			this._inviteContexts.delete(context.id);
		}
	}

	async pCreateSession ({
		accountId,
		tokenHash,
		expiresAt,
		userAgent = null,
		authenticatedViaIdentityId = null,
		recentReauthenticatedAt = null,
	}) {
		if (!this._accounts.has(accountId)) throw new Error(`Unknown account.`);
		if (this._sessions.has(tokenHash)) throw new HubStoreError("SESSION_TOKEN_CONFLICT", `Session could not be created.`, {status: 409});
		if (authenticatedViaIdentityId != null && this._externalIdentities.get(authenticatedViaIdentityId)?.accountId !== accountId) {
			throw new HubStoreError("IDENTITY_NOT_FOUND", `Identity was not found.`, {status: 404});
		}
		const session = {
			id: crypto.randomUUID(),
			accountId,
			tokenHash,
			userAgent,
			createdAt: this._fnNow().toISOString(),
			lastSeenAt: this._fnNow().toISOString(),
			expiresAt: expiresAt.toISOString(),
			revokedAt: null,
			authenticatedViaIdentityId,
			recentReauthenticatedAt: recentReauthenticatedAt?.toISOString?.() ?? recentReauthenticatedAt,
		};
		this._sessions.set(tokenHash, session);
		return copy(session);
	}

	async pGetSessionByTokenHash ({tokenHash}) {
		const session = this._sessions.get(tokenHash);
		if (!session || session.revokedAt || new Date(session.expiresAt) <= this._fnNow()) return null;
		const account = this._accounts.get(session.accountId);
		if (!account || !["active", "deletion_requested"].includes(account.status)) return null;
		session.lastSeenAt = this._fnNow().toISOString();
		return {session: copy(session), account: copy(account)};
	}

	async pGetSessionById ({sessionId}) {
		const session = [...this._sessions.values()].find(it => it.id === sessionId);
		if (!session) return null;
		return this.pGetSessionByTokenHash({tokenHash: session.tokenHash});
	}

	async pRevokeSession ({sessionId}) {
		const session = [...this._sessions.values()].find(it => it.id === sessionId);
		if (!session) return false;
		session.revokedAt = this._fnNow().toISOString();
		for (const [characterId, lease] of this._characterLeases) {
			if (lease.sessionId === sessionId) this._characterLeases.delete(characterId);
		}
		for (const [workspaceId, lease] of this._dmWorkspaceLeases) {
			if (lease.sessionId === sessionId) this._dmWorkspaceLeases.delete(workspaceId);
		}
		return true;
	}

	async pListSessions ({accountId, currentSessionId = null}) {
		if (!this._accounts.has(accountId)) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		return [...this._sessions.values()]
			.filter(session => session.accountId === accountId)
			.map(session => ({
				id: session.id,
				accountId,
				userAgent: session.userAgent,
				createdAt: session.createdAt,
				lastSeenAt: session.lastSeenAt,
				expiresAt: session.expiresAt,
				revokedAt: session.revokedAt,
				authenticatedViaIdentityId: session.authenticatedViaIdentityId,
				recentReauthenticatedAt: session.recentReauthenticatedAt,
				isCurrent: session.id === currentSessionId,
			}))
			.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`));
	}

	async pRevokeAccountSession ({accountId, sessionId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const session = [...this._sessions.values()].find(it => it.id === sessionId && it.accountId === accountId);
		if (!session) throw new HubStoreError("SESSION_NOT_FOUND", `Session was not found.`, {status: 404});
		await this.pRevokeSession({sessionId});
		this._appendAudit({actorAccountId: accountId, action: "session.revoked", targetType: "session", targetId: sessionId});
		return this._setReceipt({accountId, idempotencyKey, response: {ok: true, revokedSessionIds: [sessionId]}});
	}

	async pRevokeOtherSessions ({accountId, currentSessionId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const revokedSessionIds = [];
		for (const session of this._sessions.values()) {
			if (session.accountId !== accountId || session.id === currentSessionId || session.revokedAt) continue;
			await this.pRevokeSession({sessionId: session.id});
			revokedSessionIds.push(session.id);
		}
		this._appendAudit({actorAccountId: accountId, action: "session.revoked_others", targetType: "account", targetId: accountId, details: {count: revokedSessionIds.length}});
		return this._setReceipt({accountId, idempotencyKey, response: {ok: true, revokedSessionIds}});
	}

	async pGetOwnEntitlements ({accountId}) {
		if (this._accounts.get(accountId)?.status !== "active") return [];
		return this._getActiveEntitlementNames(accountId);
	}

	async pHasActivePlatformOperator () {
		return [...this._accounts.values()].some(account => (
			account.status === "active"
			&& this._getActiveEntitlement({accountId: account.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
		));
	}

	async pReconcileConfiguredOperatorEntitlements ({accountIds, onWarning = null}) {
		return this._pWithMemoryLock({
			key: "operator-namespace",
			fn: () => this._pReconcileConfiguredOperatorEntitlements({accountIds, onWarning}),
		});
	}

	async _pReconcileConfiguredOperatorEntitlements ({accountIds, onWarning = null}) {
		const warnings = [];
		const granted = [];
		for (const accountId of accountIds) {
			const account = this._accounts.get(accountId);
			if (!account || account.status !== "active") {
				const warning = {code: "CONFIGURED_OPERATOR_ACCOUNT_NOT_FOUND", accountId};
				warnings.push(warning);
				onWarning?.(warning);
				continue;
			}
			for (const entitlementName of [CAMPAIGN_CREATE_ENTITLEMENT, PLATFORM_OPERATE_ENTITLEMENT]) {
				if (this._getActiveEntitlement({accountId, entitlementName})) continue;
				const now = this._fnNow().toISOString();
				const entitlement = {
					id: crypto.randomUUID(),
					accountId,
					entitlementName,
					source: "configured_operator",
					grantedByAccountId: null,
					revokedByAccountId: null,
					grantedAt: now,
					revokedAt: null,
					createdAt: now,
					updatedAt: now,
				};
				this._accountEntitlements.set(entitlement.id, entitlement);
				this._appendAudit({
					actorAccountId: null,
					action: "account.entitlement.granted",
					targetType: "account_entitlement",
					targetId: entitlement.id,
					details: {targetAccountId: accountId, entitlementName, source: entitlement.source},
				});
				granted.push(copy(entitlement));
			}
		}
		return {granted, warnings};
	}

	async pListAccountEntitlements ({accountId, sessionId, targetAccountId}) {
		return this._pWithMemoryLock({
			key: "operator-namespace",
			fn: () => this._pListAccountEntitlements({accountId, sessionId, targetAccountId}),
		});
	}

	async _pListAccountEntitlements ({accountId, sessionId, targetAccountId}) {
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		const target = this._accounts.get(targetAccountId);
		if (!target || target.status === "deleted") {
			throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		}

		await this._pBeforeSensitiveCommit();
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		return {
			account: {id: target.id, displayName: target.displayName, status: target.status},
			entitlements: [...this._accountEntitlements.values()]
				.filter(entitlement => entitlement.accountId === targetAccountId)
				.sort((a, b) => `${a.grantedAt}`.localeCompare(`${b.grantedAt}`) || a.id.localeCompare(b.id))
				.map(copy),
		};
	}

	async pListOperatorAccounts ({accountId, sessionId}) {
		return this._pWithMemoryLock({
			key: "operator-namespace",
			fn: () => this._pListOperatorAccounts({accountId, sessionId}),
		});
	}

	async _pListOperatorAccounts ({accountId, sessionId}) {
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		await this._pBeforeSensitiveCommit();
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		return [...this._accounts.values()]
			.filter(account => account.status !== "deleted")
			.sort((a, b) => `${a.displayName}`.localeCompare(`${b.displayName}`) || a.id.localeCompare(b.id))
			.map(account => this._getAccountEntitlementSummary(account.id));
	}

	async pGrantAccountEntitlement ({
		accountId,
		sessionId,
		targetAccountId,
		entitlementName,
		idempotencyKey,
	}) {
		return this._pWithSensitiveCommandLocks({
			accountId,
			idempotencyKey,
			fn: () => this._pGrantAccountEntitlement({
				accountId,
				sessionId,
				targetAccountId,
				entitlementName,
				idempotencyKey,
			}),
		});
	}

	async _pGrantAccountEntitlement ({
		accountId,
		sessionId,
		targetAccountId,
		entitlementName,
		idempotencyKey,
	}) {
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		if (!isAccountEntitlementName(entitlementName)) {
			throw new HubStoreError("INVALID_ENTITLEMENT", `Account entitlement is invalid.`, {status: 400});
		}
		const prior = this._getReceipt({accountId, idempotencyKey});
		const target = this._accounts.get(targetAccountId);
		if (!target || target.status === "deleted") {
			throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		}
		if (prior) {
			return prior;
		}
		await this._pBeforeSensitiveCommit();
		const concurrentPrior = this._getReceipt({accountId, idempotencyKey});
		if (concurrentPrior) return concurrentPrior;
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		let entitlement = this._getActiveEntitlement({accountId: targetAccountId, entitlementName});
		let changed = false;
		if (!entitlement) {
			const now = this._fnNow().toISOString();
			entitlement = {
				id: crypto.randomUUID(),
				accountId: targetAccountId,
				entitlementName,
				source: "operator",
				grantedByAccountId: accountId,
				revokedByAccountId: null,
				grantedAt: now,
				revokedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			this._accountEntitlements.set(entitlement.id, entitlement);
			this._appendAudit({
				actorAccountId: accountId,
				action: "account.entitlement.granted",
				targetType: "account_entitlement",
				targetId: entitlement.id,
				details: {targetAccountId, entitlementName, source: entitlement.source},
			});
			changed = true;
		}
		return this._setReceipt({
			accountId,
			idempotencyKey,
			response: {
				account: this._getAccountEntitlementSummary(targetAccountId),
				changed,
			},
		});
	}

	async pRevokeAccountEntitlement ({
		accountId,
		sessionId,
		targetAccountId,
		entitlementName,
		idempotencyKey,
	}) {
		return this._pWithSensitiveCommandLocks({
			accountId,
			idempotencyKey,
			fn: () => this._pRevokeAccountEntitlement({
				accountId,
				sessionId,
				targetAccountId,
				entitlementName,
				idempotencyKey,
			}),
		});
	}

	async _pRevokeAccountEntitlement ({
		accountId,
		sessionId,
		targetAccountId,
		entitlementName,
		idempotencyKey,
	}) {
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		if (!isAccountEntitlementName(entitlementName)) {
			throw new HubStoreError("INVALID_ENTITLEMENT", `Account entitlement is invalid.`, {status: 400});
		}
		const prior = this._getReceipt({accountId, idempotencyKey});
		const target = this._accounts.get(targetAccountId);
		if (!target || target.status === "deleted") {
			throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		}
		if (prior) {
			return prior;
		}
		const entitlement = this._getActiveEntitlement({accountId: targetAccountId, entitlementName});
		if (
			entitlement
			&& entitlementName === PLATFORM_OPERATE_ENTITLEMENT
			&& target.status === "active"
			&& [...this._accounts.values()].filter(account => (
				account.status === "active"
				&& this._getActiveEntitlement({accountId: account.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
			)).length <= 1
		) throw new HubStoreError("LAST_OPERATOR_PROTECTED", `The final platform operator cannot be removed.`, {status: 409});
		await this._pBeforeSensitiveCommit();
		const concurrentPrior = this._getReceipt({accountId, idempotencyKey});
		if (concurrentPrior) return concurrentPrior;
		this._assertActiveOperator(accountId);
		this._assertFreshReauthentication({accountId, sessionId});
		let changed = false;
		if (entitlement && !entitlement.revokedAt) {
			if (
				entitlementName === PLATFORM_OPERATE_ENTITLEMENT
				&& target.status === "active"
				&& [...this._accounts.values()].filter(account => (
					account.status === "active"
						&& this._getActiveEntitlement({accountId: account.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
				)).length <= 1
			) throw new HubStoreError("LAST_OPERATOR_PROTECTED", `The final platform operator cannot be removed.`, {status: 409});
			const now = this._fnNow().toISOString();
			entitlement.revokedAt = now;
			entitlement.revokedByAccountId = accountId;
			entitlement.updatedAt = now;
			this._appendAudit({
				actorAccountId: accountId,
				action: "account.entitlement.revoked",
				targetType: "account_entitlement",
				targetId: entitlement.id,
				details: {targetAccountId, entitlementName},
			});
			changed = true;
		}
		return this._setReceipt({
			accountId,
			idempotencyKey,
			response: {
				account: this._getAccountEntitlementSummary(targetAccountId),
				changed,
			},
		});
	}

	async pCreateCampaign ({accountId, name, idempotencyKey}) {
		if (!this._isAccountEntitlementsEnabled) {
			return this._pCreateCampaign({accountId, name, idempotencyKey});
		}
		return this._pWithSensitiveCommandLocks({
			accountId,
			idempotencyKey,
			fn: () => this._pCreateCampaign({accountId, name, idempotencyKey}),
		});
	}

	async _pCreateCampaign ({accountId, name, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		if (
			this._isAccountEntitlementsEnabled
			&& !this._getActiveEntitlement({accountId, entitlementName: CAMPAIGN_CREATE_ENTITLEMENT})
		) {
			throw new HubStoreError("CAMPAIGN_CREATE_NOT_ENTITLED", `Account cannot create campaigns.`, {status: 403});
		}
		const campaign = {
			id: crypto.randomUUID(),
			ownerAccountId: accountId,
			name,
			status: "active",
			createdAt: this._fnNow().toISOString(),
			activeBrewBundleVersionId: null,
			activeRulesVersionId: null,
		};
		const membership = {
			id: crypto.randomUUID(),
			campaignId: campaign.id,
			accountId,
			role: "dm",
			status: "active",
		};
		this._campaigns.set(campaign.id, campaign);
		this._memberships.set(`${campaign.id}::${accountId}`, membership);
		this._audit.push({
			id: crypto.randomUUID(),
			campaignId: campaign.id,
			actorAccountId: accountId,
			action: "campaign.created",
			targetType: "campaign",
			targetId: campaign.id,
			createdAt: this._fnNow().toISOString(),
		});
		const event = {
			id: crypto.randomUUID(),
			campaignId: campaign.id,
			sequence: 1,
			type: "campaign.created",
			actorAccountId: accountId,
			aggregateType: "campaign",
			aggregateId: campaign.id,
			aggregateRevision: null,
			visibility: "all_members",
			payload: {name},
		};
		this._events.push(event);
		this._campaignEvents.set(campaign.id, [event]);
		this._outbox.push({id: this._outbox.length + 1, eventId: event.id, campaignId: campaign.id, status: "pending"});
		const response = {campaign: copy(campaign), membership: copy(membership)};
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pListCampaigns ({accountId}) {
		return [...this._memberships.values()]
			.filter(membership => membership.accountId === accountId && membership.status === "active")
			.map(membership => ({
				...copy(this._campaigns.get(membership.campaignId)),
				role: membership.role,
				membershipId: membership.id,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async pGetCampaign ({accountId, campaignId}) {
		const membership = this._memberships.get(`${campaignId}::${accountId}`);
		if (!membership || membership.status !== "active") return null;
		return {
			...copy(this._campaigns.get(campaignId)),
			role: membership.role,
			membershipId: membership.id,
		};
	}

	async pGetMembership ({accountId, campaignId}) {
		const membership = this._memberships.get(`${campaignId}::${accountId}`);
		return copy(membership?.status === "active" ? membership : null);
	}

	_getMembership ({accountId, campaignId, roles = null, isRequireActiveCampaign = true}) {
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || (isRequireActiveCampaign && campaign.status !== "active")) {
			throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		}
		const membership = this._memberships.get(`${campaignId}::${accountId}`);
		if (!membership || membership.status !== "active") {
			throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		}
		if (roles && !roles.includes(membership.role)) {
			throw new HubStoreError("FORBIDDEN", `This campaign role cannot perform that action.`, {status: 403});
		}
		return membership;
	}

	_getReceipt ({accountId, idempotencyKey}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		const receipt = this._commandReceipts.get(`${accountId}::${normalized.key}`);
		if (!receipt) return null;
		if (receipt.requestHash !== normalized.requestHash) {
			throw new HubStoreError("IDEMPOTENCY_KEY_REUSED", `Idempotency key was reused with a different request.`, {status: 409});
		}
		return copy(receipt.response);
	}

	_setReceipt ({accountId, idempotencyKey, commandType = null, response}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		this._commandReceipts.set(`${accountId}::${normalized.key}`, {
			requestHash: normalized.requestHash,
			commandType,
			response: copy(response),
		});
		return copy(response);
	}

	_projectTransferResponseForViewer ({response, accountId, membership}) {
		if (!response?.transfer) return copy(response);
		const canonical = this._transfers.get(response.transfer.id);
		const transfer = canonical
			? {
				...copy(response.transfer),
				actorAccountId: canonical.actorAccountId,
				actorCommandId: canonical.actorCommandId,
				sourceId: canonical.sourceId,
				targetId: canonical.targetId,
			}
			: copy(response.transfer);
		return {
			...copy(response),
			transfer: projectTransferForViewer({
				transfer,
				accountId,
				role: membership.role,
				getCharacterOwnerId: characterId => this._characters.get(characterId)?.ownerAccountId,
			}),
		};
	}

	_normalizeIdempotencyKey (idempotencyKey) {
		if (idempotencyKey && typeof idempotencyKey === "object") return idempotencyKey;
		const key = `${idempotencyKey}`;
		return {key, requestHash: crypto.createHash("sha256").update(key).digest("hex")};
	}

	_getCampaignEvents (campaignId) {
		if (!this._campaignEvents.has(campaignId)) {
			this._campaignEvents.set(campaignId, this._events.filter(event => event.campaignId === campaignId));
		}
		return this._campaignEvents.get(campaignId);
	}

	_getCampaignLastSequence (campaignId) {
		return this._getCampaignEvents(campaignId).at(-1)?.sequence || 0;
	}

	_appendEvent ({eventId = crypto.randomUUID(), campaignId, actorAccountId, type, aggregateType, aggregateId, aggregateRevision = null, visibility = "all_members", visibleAccountIds = null, payload = {}}) {
		const campaign = this._campaigns.get(campaignId);
		const campaignEvents = this._getCampaignEvents(campaignId);
		const sequence = (campaignEvents.at(-1)?.sequence || 0) + 1;
		const eventPayload = enrichEventPayload({
			payload,
			type,
			visibility,
			aggregateType,
			aggregateId,
			getCharacterById: characterId => {
				const character = this._characters.get(characterId);
				return character?.campaignId === campaignId ? character : null;
			},
		});
		const event = {
			id: eventId,
			campaignId,
			sequence,
			type,
			actorAccountId,
			aggregateType,
			aggregateId,
			aggregateRevision,
			visibility,
			visibleAccountIds: copy(visibleAccountIds),
			payload: copy(eventPayload),
			createdAt: this._fnNow().toISOString(),
		};
		this._events.push(event);
		campaignEvents.push(event);
		this._outbox.push({id: this._outbox.length + 1, eventId: event.id, campaignId, status: "pending"});
		if (campaign) campaign.nextEventSequence = sequence + 1;
		return event;
	}

	_appendAudit ({campaignId = null, actorAccountId, action, targetType, targetId, details = {}}) {
		this._audit.push({
			id: crypto.randomUUID(),
			campaignId,
			actorAccountId,
			action,
			targetType,
			targetId,
			details: copy(details),
			createdAt: this._fnNow().toISOString(),
		});
	}

	async pListMembers ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return [...this._memberships.values()]
			.filter(it => it.campaignId === campaignId && it.status === "active")
			.map(it => ({
				...copy(it),
				displayName: this._accounts.get(it.accountId)?.displayName || "Unknown",
			}))
			.sort((a, b) => a.displayName.localeCompare(b.displayName));
	}

	async pListInvites ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"], isRequireActiveCampaign: false});
		return [...this._invites.values()]
			.filter(invite => invite.campaignId === campaignId)
			.map(({tokenHash: _tokenHash, ...invite}) => copy(invite))
			.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`));
	}

	async pRevokeInvite ({accountId, campaignId, inviteId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const invite = [...this._invites.values()].find(it => it.id === inviteId && it.campaignId === campaignId);
		if (!invite) throw new HubStoreError("INVITE_NOT_FOUND", `Invite was not found.`, {status: 404});
		invite.revokedAt ||= this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: "invite.revoked", targetType: "invite", targetId: inviteId});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "invite.revoked", aggregateType: "invite", aggregateId: inviteId, visibility: "dm_only", payload: {}});
		const {tokenHash: _tokenHash, ...safeInvite} = invite;
		return this._setReceipt({accountId, idempotencyKey, response: {invite: copy(safeInvite)}});
	}

	async pCreateInvite ({accountId, campaignId, role, tokenHash, expiresAt, maxUses, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) {
			const invite = [...this._invites.values()].find(current => current.id === prior.invite?.id);
			if (!invite) {
				throw new HubStoreError("INVITE_TOKEN_RECOVERY_UNAVAILABLE", `Invite token cannot be recovered.`, {status: 409});
			}
			return {...prior, inviteTokenHash: invite.tokenHash};
		}
		if (this._invites.has(tokenHash)) {
			throw new HubStoreError("INVITE_TOKEN_CONFLICT", `Invite could not be created.`, {status: 409});
		}
		const actorMembership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const invite = {
			id: crypto.randomUUID(),
			campaignId,
			createdByMembershipId: actorMembership.id,
			tokenHash,
			role,
			maxUses,
			useCount: 0,
			expiresAt: expiresAt.toISOString(),
			revokedAt: null,
			createdAt: this._fnNow().toISOString(),
		};
		this._invites.set(tokenHash, invite);
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "invite.created",
			targetType: "invite",
			targetId: invite.id,
			details: {role, maxUses},
		});
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "invite.created",
			aggregateType: "invite",
			aggregateId: invite.id,
			visibility: "dm_only",
			payload: {role, expiresAt: invite.expiresAt},
		});
		const {tokenHash: _tokenHash, ...safeInvite} = invite;
		const response = this._setReceipt({accountId, idempotencyKey, response: {invite: safeInvite}});
		return {...response, inviteTokenHash: tokenHash};
	}

	async pRedeemInvite ({accountId, tokenHash, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const invite = this._invites.get(tokenHash);
		if (!invite || invite.revokedAt || new Date(invite.expiresAt) <= this._fnNow() || invite.useCount >= invite.maxUses) {
			throw new HubStoreError("INVITE_INVALID", `Invite is invalid or expired.`, {status: 404});
		}
		if (this._campaigns.get(invite.campaignId)?.status !== "active") throw new HubStoreError("INVITE_INVALID", `Invite is invalid or expired.`, {status: 404});
		const existing = this._memberships.get(`${invite.campaignId}::${accountId}`);
		if (existing?.status === "active") {
			return this._setReceipt({accountId, idempotencyKey, response: {membership: existing}});
		}
		const membership = {
			id: existing?.id || crypto.randomUUID(),
			campaignId: invite.campaignId,
			accountId,
			role: invite.role,
			status: "active",
		};
		this._memberships.set(`${invite.campaignId}::${accountId}`, membership);
		invite.useCount++;
		this._appendAudit({
			campaignId: invite.campaignId,
			actorAccountId: accountId,
			action: "invite.redeemed",
			targetType: "membership",
			targetId: membership.id,
			details: {inviteId: invite.id},
		});
		this._appendEvent({
			campaignId: invite.campaignId,
			actorAccountId: accountId,
			type: "membership.joined",
			aggregateType: "membership",
			aggregateId: membership.id,
			payload: {accountId, role: membership.role},
		});
		return this._setReceipt({accountId, idempotencyKey, response: {membership}});
	}

	_getMembershipById ({campaignId, membershipId}) {
		const membership = [...this._memberships.values()].find(it => it.id === membershipId && it.campaignId === campaignId);
		if (!membership) throw new HubStoreError("MEMBERSHIP_NOT_FOUND", `Membership was not found.`, {status: 404});
		return membership;
	}

	async pChangeMemberRole ({accountId, campaignId, membershipId, role, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.status !== "active") throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		if (campaign.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can change roles.`, {status: 403});
		const membership = this._getMembershipById({campaignId, membershipId});
		if (membership.accountId === campaign.ownerAccountId) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Campaign owner role cannot be changed.`, {status: 409});
		if (membership.status !== "active") throw new HubStoreError("MEMBERSHIP_NOT_FOUND", `Membership was not found.`, {status: 404});
		if (role === "spectator") {
			const ownedCharacterIds = new Set([...this._characters.values()]
				.filter(character => character.campaignId === campaignId && character.ownerAccountId === membership.accountId)
				.map(character => character.id));
			this._cancelTransfersForLifecycle({
				campaignId,
				affectedAccountId: membership.accountId,
				characterIds: ownedCharacterIds,
				actorAccountId: accountId,
				reason: "membership_role_changed",
			});
			for (const operation of this._semanticOperations.values()) {
				if (operation.campaignId !== campaignId) continue;
				if (operation.targetSetVersion === 1) {
					this._cancelMultiTargetOperationForLifecycle({
						operation,
						actorAccountId: accountId,
						affectedCharacterIds: ownedCharacterIds,
						affectedAccountId: membership.accountId,
					});
					continue;
				}
				if (
					operation.status === "proposed"
					&& (
						operation.originActorAccountId === membership.accountId
						|| ownedCharacterIds.has(operation.sourceCharacterId)
						|| ownedCharacterIds.has(operation.targetCharacterId)
					)
				) {
					this._cancelSemanticOperationForLifecycle({operation, actorAccountId: accountId});
				}
			}
		}
		membership.role = role;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "membership.role_changed", targetType: "membership", targetId: membershipId, details: {role}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "membership.role_changed", aggregateType: "membership", aggregateId: membershipId, payload: {accountId: membership.accountId, role}});
		return this._setReceipt({accountId, idempotencyKey, response: {membership: copy(membership)}});
	}

	_prepareTransferLifecycleCancellations ({transfers}) {
		const stagedBySource = new Map();
		return transfers.map(transfer => {
			let restore = null;
			if (transfer.status === "reserved") {
				const sourceKey = `${transfer.sourceKind}::${transfer.sourceId}`;
				const staged = stagedBySource.get(sourceKey);
				let holder = staged?.holder;
				let sourceContainer = staged?.container;
				if (!holder) {
					if (transfer.sourceKind === "party_inventory") {
						const party = this._partyInventories.get(transfer.campaignId);
						if (!party || party.id !== transfer.sourceId) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Party inventory was not found.`, {status: 404});
						holder = {_party: party};
						sourceContainer = copy(party);
					} else {
						const character = this._getCharacterOrThrow(transfer.sourceId);
						if (character.campaignId !== transfer.campaignId) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Character was not found.`, {status: 404});
						holder = {_character: character};
						sourceContainer = normalizeCharacterInventory(copy(character.data));
					}
				}
				let container = addTransferPayload({
					container: sourceContainer,
					escrow: transfer.payload.escrow,
					isRestore: true,
				});
				if (holder._character) {
					stripCarryAuthority(container);
					validateCloudCharacterData(container);
				}
				restore = {holder, container};
				stagedBySource.set(sourceKey, restore);
			}
			return {
				transfer,
				restore,
				targetOwnerAccountId: transfer.targetKind === "character"
					? this._characters.get(transfer.targetId)?.ownerAccountId
					: null,
			};
		});
	}

	_applyTransferLifecycleCancellations ({prepared, actorAccountId, reason}) {
		for (const {transfer, restore, targetOwnerAccountId} of prepared) {
			if (restore) this._setTransferContainer({...restore, actorAccountId});
			transfer.status = "cancelled";
			transfer.resolvedAt = this._fnNow().toISOString();
			this._appendEvent({
				campaignId: transfer.campaignId,
				actorAccountId,
				type: "transfer.cancelled",
				aggregateType: "transfer",
				aggregateId: transfer.id,
				visibility: "explicit_accounts",
				visibleAccountIds: [...new Set([transfer.actorAccountId, targetOwnerAccountId].filter(Boolean))],
				payload: {
					reason,
					sourceKind: transfer.sourceKind,
					sourceId: transfer.sourceId,
					targetKind: transfer.targetKind,
					targetId: transfer.targetId,
				},
			});
		}
	}

	_cancelTransferBatchForLifecycle ({transfers, actorAccountId, reason}) {
		const active = transfers.filter(transfer => ["proposed", "reserved"].includes(transfer.status));
		if (!active.length) return;
		const prepared = this._prepareTransferLifecycleCancellations({
			transfers: orderTransfersForLifecycleCancellation(active),
		});
		this._applyTransferLifecycleCancellations({prepared, actorAccountId, reason});
	}

	_cancelTransferForLifecycle ({transfer, actorAccountId, reason}) {
		this._cancelTransferBatchForLifecycle({transfers: [transfer], actorAccountId, reason});
	}

	_cancelTransfersForLifecycle ({campaignId, affectedAccountId, characterIds, actorAccountId, reason}) {
		const transfers = [...this._transfers.values()].filter(transfer => {
			if (transfer.campaignId !== campaignId || !["proposed", "reserved"].includes(transfer.status)) return false;
			return transfer.actorAccountId === affectedAccountId
				|| (transfer.sourceKind === "character" && characterIds.has(transfer.sourceId))
				|| (transfer.targetKind === "character" && characterIds.has(transfer.targetId));
		});
		this._cancelTransferBatchForLifecycle({transfers, actorAccountId, reason});
	}

	_removeMembershipLifecycle ({campaign, membership, actorAccountId, status}) {
		const characterIds = [...this._characters.values()]
			.filter(character => character.ownerAccountId === membership.accountId && character.campaignId === campaign.id)
			.map(character => character.id);
		const characterIdSet = new Set(characterIds);
		this._cancelTransfersForLifecycle({
			campaignId: campaign.id,
			affectedAccountId: membership.accountId,
			characterIds: characterIdSet,
			actorAccountId,
			reason: "membership_lifecycle",
		});
		for (const operation of this._semanticOperations.values()) {
			if (operation.campaignId !== campaign.id) continue;
			if (operation.targetSetVersion === 1) {
				this._cancelMultiTargetOperationForLifecycle({
					operation,
					actorAccountId,
					affectedCharacterIds: characterIdSet,
					affectedAccountId: membership.accountId,
				});
				continue;
			}
			if (operation.status !== "proposed") continue;
			if (
				operation.originActorAccountId === membership.accountId
				|| characterIdSet.has(operation.sourceCharacterId)
				|| characterIdSet.has(operation.targetCharacterId)
			) {
				this._cancelSemanticOperationForLifecycle({operation, actorAccountId});
			}
		}
		for (const action of this._pendingActions.values()) {
			if (action.campaignId !== campaign.id || action.status !== "proposed") continue;
			const target = this._characters.get(action.targetCharacterId);
			if (action.actorAccountId !== membership.accountId && target?.ownerAccountId !== membership.accountId) continue;
			action.status = "cancelled";
			action.resolvedAt = this._fnNow().toISOString();
			this._appendEvent({
				campaignId: campaign.id,
				actorAccountId,
				type: "action.cancelled",
				aggregateType: "pending_action",
				aggregateId: action.id,
				visibility: "explicit_accounts",
				visibleAccountIds: [...new Set([action.actorAccountId, target?.ownerAccountId].filter(Boolean))],
				payload: {reason: "membership_lifecycle", targetCharacterId: action.targetCharacterId},
			});
		}
		const characterNameSnapshots = characterIds
			.map(characterId => {
				const character = this._characters.get(characterId);
				return character
					? {characterId, ...createCharacterDisplayNameSnapshot(character.data?.name)}
					: null;
			})
			.filter(Boolean);
		for (const characterId of characterIds) {
			const character = this._characters.get(characterId);
			const characterNameSnapshot = createCharacterDisplayNameSnapshot(character.data?.name);
			this._characterLeases.delete(characterId);
			character.campaignId = null;
			character.targetRef = crypto.randomUUID();
			character.operationWatermark = 0;
			character.clientImportId = null;
			character.revision++;
			character.updatedAt = this._fnNow().toISOString();
			this._appendEvent({
				campaignId: campaign.id,
				actorAccountId,
				type: "character.moved_out",
				aggregateType: "character",
				aggregateId: characterId,
				aggregateRevision: character.revision,
				payload: {targetCampaignId: null, reason: "membership_lifecycle", characterNameSnapshot},
			});
		}
		const workspace = [...this._dmWorkspaces.values()].find(it => it.ownerMembershipId === membership.id);
		if (workspace) {
			workspace.archivedAt = this._fnNow().toISOString();
			this._dmWorkspaceLeases.delete(workspace.id);
		}
		membership.status = status;
		membership.updatedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId: campaign.id, actorAccountId, action: `membership.${status}`, targetType: "membership", targetId: membership.id, details: {accountId: membership.accountId, detachedCharacterIds: characterIds}});
		this._appendEvent({
			campaignId: campaign.id,
			actorAccountId,
			type: `membership.${status}`,
			aggregateType: "membership",
			aggregateId: membership.id,
			payload: {accountId: membership.accountId, detachedCharacterIds: characterIds, characterNameSnapshots},
		});
		return {membership: copy(membership), removedAccountId: membership.accountId, detachedCharacterIds: characterIds};
	}

	async pRemoveMember ({accountId, campaignId, membershipId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.status !== "active") throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		const actor = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const target = this._getMembershipById({campaignId, membershipId});
		if (target.accountId === campaign.ownerAccountId) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Campaign owner cannot be removed.`, {status: 409});
		if (target.status !== "active") {
			return this._setReceipt({accountId, idempotencyKey, response: {membership: copy(target), removedAccountId: target.accountId, detachedCharacterIds: []}});
		}
		if (campaign.ownerAccountId !== accountId && (actor.role !== "co_dm" || !["player", "spectator"].includes(target.role))) {
			throw new HubStoreError("FORBIDDEN", `This member cannot be removed by the current role.`, {status: 403});
		}
		return this._setReceipt({accountId, idempotencyKey, response: this._removeMembershipLifecycle({campaign, membership: target, actorAccountId: accountId, status: "removed"})});
	}

	async pLeaveCampaign ({accountId, campaignId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.status !== "active") throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		if (campaign.ownerAccountId === accountId) throw new HubStoreError("MEMBERSHIP_OWNER_PROTECTED", `Transfer ownership or archive the campaign before leaving.`, {status: 409});
		const membership = this._getMembership({accountId, campaignId});
		return this._setReceipt({accountId, idempotencyKey, response: this._removeMembershipLifecycle({campaign, membership, actorAccountId: accountId, status: "left"})});
	}

	/**
	 * Targeting is authorized on the server, not filtered in the browser: a peer may only
	 * target a character whose owner shares its identity. The rejection is the same
	 * "not found" a non-existent character produces, so a probe cannot enumerate hidden
	 * characters.
	 */
	_assertTargetable ({character, accountId, role}) {
		assertPeerTargetable({
			character,
			accountId,
			role,
			fnError: () => new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404}),
		});
	}

	_getCharacterOrThrow (characterId) {
		const character = this._characters.get(characterId);
		if (!character || character.status !== "active") {
			throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		}
		return character;
	}

	_assertCharacterRead ({accountId, character}) {
		return this._getCharacterAuthorizationClass({accountId, character});
	}

	/**
	 * Resolve the ADR 0011 authorization class for one character read. Checks run in the
	 * documented order: ownership, then DM/co-DM, then any other active member.
	 * @returns {"owner"|"dm"|"peer"}
	 */
	_getCharacterAuthorizationClass ({accountId, character}) {
		if (character.ownerAccountId === accountId) return "owner";
		if (!character.campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const membership = this._getMembership({accountId, campaignId: character.campaignId});
		return ["dm", "co_dm"].includes(membership.role) ? "dm" : "peer";
	}

	/**
	 * The single commit path for any mutation that can change a projected catalog field.
	 * Bumps the aggregate revision and emits exactly one metadata-only invalidation, so a
	 * new mutation cannot silently leave peers holding stale data.
	 *
	 * Callers that only change the sharing policy pass `isRevisionBump: false`.
	 */
	_commitCharacterMutation ({
		character,
		actorAccountId,
		isRevisionBump = true,
		projectionInvalidationVisibleAccountIds = null,
	}) {
		if (isRevisionBump) character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		return this._appendCharacterProjectionInvalidation({
			character,
			actorAccountId,
			visibleAccountIds: projectionInvalidationVisibleAccountIds,
		});
	}

	_appendCharacterProjectionInvalidation ({
		character,
		actorAccountId,
		visibleAccountIds = null,
	}) {
		if (!character?.campaignId) return null;
		visibleAccountIds ??= [...this._memberships.values()]
			.filter(membership => membership.campaignId === character.campaignId && membership.status === "active")
			.filter(membership => canViewSharedCharacterProjection({
				character,
				accountId: membership.accountId,
				role: membership.role,
			}))
			.map(membership => membership.accountId);
		return this._appendEvent({
			campaignId: character.campaignId,
			actorAccountId,
			type: "character.projection.invalidated",
			aggregateType: "campaign",
			aggregateId: character.campaignId,
			aggregateRevision: null,
			visibility: "explicit_accounts",
			visibleAccountIds,
			payload: {},
		});
	}

	_getProjectionInvalidationRecipients ({character}) {
		if (!character?.campaignId) return [];
		return [...this._memberships.values()]
			.filter(membership => membership.campaignId === character.campaignId && membership.status === "active")
			.filter(membership => canViewSharedCharacterProjection({
				character,
				accountId: membership.accountId,
				role: membership.role,
			}))
			.map(membership => membership.accountId);
	}

	async pListCharacters ({accountId, campaignId = null}) {
		if (campaignId) this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return [...this._characters.values()]
			.filter(it => it.status === "active")
			.filter(it => campaignId ? it.campaignId === campaignId : it.ownerAccountId === accountId)
			.filter(it => {
				if (it.ownerAccountId === accountId) return true;
				const membership = this._memberships.get(`${it.campaignId}::${accountId}`);
				return ["dm", "co_dm"].includes(membership?.role) && membership.status === "active";
			})
			.map(character => stripProjectionPolicy(copy(character)));
	}

	async pGetCharacter ({accountId, characterId}) {
		const character = this._getCharacterOrThrow(characterId);
		const authorizationClass = this._getCharacterAuthorizationClass({accountId, character});
		return projectCharacterForRequester({
			character,
			authorizationClass,
			fnCopy: copy,
			expectedBasis: this._getExpectedCarryBasis(character),
		});
	}

	/**
	 * The carry basis that is live for this character right now.
	 *
	 * Resolved from the campaign's active rules version and brew bundle, which change carry
	 * inputs without ever touching the character document. Identical in the single-character
	 * read and the campaign list so a character cannot appear fresh in one and stale in the
	 * other.
	 * @param {object} character
	 * @returns {object}
	 */
	_getExpectedCarryBasis (character) {
		const campaign = character.campaignId ? this._campaigns.get(character.campaignId) : null;
		const rulesVersion = campaign?.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		const brewBundle = campaign?.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		return getExpectedCarryBasis({character, campaign, rulesVersion, brewBundle});
	}

	async _pGetCampaignContentEnforcement (campaignId) {
		while (true) {
			const campaign = campaignId ? this._campaigns.get(campaignId) : null;
			const rulesVersionId = campaign?.activeRulesVersionId || null;
			const brewBundleVersionId = campaign?.activeBrewBundleVersionId || null;
			const rulesVersion = rulesVersionId ? this._rulesVersions.get(rulesVersionId) : null;
			const brewBundle = brewBundleVersionId ? this._brewVersions.get(brewBundleVersionId) : null;
			const enforcement = await pGetCampaignContentEnforcement({rulesVersion, brewBundle});
			const current = campaignId ? this._campaigns.get(campaignId) : null;
			if (
				(current?.activeRulesVersionId || null) === rulesVersionId
				&& (current?.activeBrewBundleVersionId || null) === brewBundleVersionId
			) {
				return {
					...enforcement,
					activeBrewBundleVersionId: brewBundleVersionId,
					brewBundle,
				};
			}
		}
	}

	async _pGetCampaignContentCatalog ({brewBundle = null} = {}) {
		return pGetCampaignContentCatalog({brewBundle});
	}

	async pListCampaignCharacterProjections ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const characters = [...this._characters.values()]
			.filter(character => character.campaignId === campaignId && character.status === "active")
			.sort((a, b) => `${a.data?.name || ""}`.toLowerCase().localeCompare(`${b.data?.name || ""}`.toLowerCase()) || a.id.localeCompare(b.id));
		return {
			projections: characters.map(character => this._projectOne({accountId, membership, character})),
			roster: this._getCampaignRoster({membership, characters}),
		};
	}

	/**
	 * Project one character, isolating failures. A character whose persisted policy cannot
	 * be validated yields the fail-closed empty peer result rather than aborting the batch
	 * or leaking truth to the rest of it.
	 */
	_projectOne ({accountId, membership, character}) {
		const authorizationClass = character.ownerAccountId === accountId
			? "owner"
			: (["dm", "co_dm"].includes(membership.role) ? "dm" : "peer");
		const expectedBasis = this._getExpectedCarryBasis(character);
		try {
			return projectCharacterForRequester({character, authorizationClass, fnCopy: copy, expectedBasis});
		} catch {
			return computePeerProfile({character: {...character, projectionPolicy: null}, expectedBasis});
		}
	}

	/**
	 * Owner attribution is campaign-roster metadata, never a character projection field:
	 * it carries a membership id rather than an account id, and it is emitted only while
	 * the character's identity is peer-visible under its own sharing policy.
	 */
	_getCampaignRoster ({membership, characters}) {
		const isDm = ["dm", "co_dm"].includes(membership.role);
		return characters
			.filter(character => isDm
				|| character.ownerAccountId === membership.accountId
				|| isPeerVisibleIdentity(character))
			.map(character => {
				const ownerMembership = this._memberships.get(`${character.campaignId}::${character.ownerAccountId}`);
				return {
					characterId: character.id,
					...(ownerMembership?.status === "active"
						&& ownerMembership.role === "player"
						&& character.targetRef
						? {targetRef: character.targetRef}
						: {}),
					ownerMembershipId: ownerMembership?.id || null,
				};
			});
	}

	async pGetProjectionPolicy ({accountId, characterId}) {
		const owned = this._getOwnedCharacterOrThrow({accountId, characterId});
		return getPolicyManagementResponse(owned, {expectedBasis: this._getExpectedCarryBasis(owned)});
	}

	/**
	 * Resolve a character the requester owns. Missing and unauthorized share one outcome
	 * so this endpoint cannot be used to probe which character ids exist.
	 */
	_getOwnedCharacterOrThrow ({accountId, characterId}) {
		const character = this._characters.get(characterId);
		if (!character || character.status !== "active" || character.ownerAccountId !== accountId) throw getPolicyNotAvailableError();
		return character;
	}

	async pSetProjectionPolicy ({accountId, characterId, policy, expectedProjectionRevision, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const character = this._getOwnedCharacterOrThrow({accountId, characterId});
		if (character.projectionRevision !== expectedProjectionRevision) {
			throw new HubStoreError("PROJECTION_POLICY_CONFLICT", `Sharing settings changed on another device.`, {
				status: 409,
				details: getPolicyManagementResponse(character, {expectedBasis: this._getExpectedCarryBasis(character)}),
			});
		}
		// Validate before any mutation so a rejected write leaves the last valid policy intact.
		const validated = validateProjectionPolicy(policy);
		const previousProjectionPolicy = structuredClone(character.projectionPolicy);
		character.projectionPolicy = validated;
		character.projectionRevision++;
		const projectionInvalidationVisibleAccountIds = [...this._memberships.values()]
			.filter(membership => membership.campaignId === character.campaignId && membership.status === "active")
			.filter(membership => (
				canViewSharedCharacterProjection({
					character: {...character, projectionPolicy: previousProjectionPolicy},
					accountId: membership.accountId,
					role: membership.role,
				})
				|| canViewSharedCharacterProjection({
					character,
					accountId: membership.accountId,
					role: membership.role,
				})
			))
			.map(membership => membership.accountId);
		this._commitCharacterMutation({
			character,
			actorAccountId: accountId,
			isRevisionBump: false,
			projectionInvalidationVisibleAccountIds,
		});
		this._appendAudit({
			campaignId: character.campaignId,
			actorAccountId: accountId,
			action: "character.projection_policy.updated",
			targetType: "character",
			targetId: character.id,
		});
		return this._setReceipt({accountId, idempotencyKey, response: getPolicyManagementResponse(character, {expectedBasis: this._getExpectedCarryBasis(character)})});
	}

	async pCreateCharacter ({
		accountId,
		campaignId = null,
		data,
		schemaVersion,
		clientImportId,
		rulesVersionId = null,
		idempotencyKey,
		protocolVersion = null,
	}) {
		validateCloudCharacterData(data);
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		if (campaignId) this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		let imported = [...this._characters.values()].find(it =>
			it.ownerAccountId === accountId
			&& it.clientImportId === clientImportId
			&& it.campaignId === campaignId,
		);
		if (imported?.status === "active") {
			return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(imported)}});
		}
		if (campaignId) {
			const enforcement = await this._pGetCampaignContentEnforcement(campaignId);
			const resumedPrior = this._getReceipt({accountId, idempotencyKey});
			if (resumedPrior) return resumedPrior;
			this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			imported = [...this._characters.values()].find(it =>
				it.ownerAccountId === accountId
				&& it.clientImportId === clientImportId
				&& it.campaignId === campaignId,
			);
			if (imported?.status === "active") {
				return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(imported)}});
			}
			assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
			assertNewCharacterCampaignContent({
				...enforcement,
				character: data,
				rulesVersionId: enforcement.activeRulesVersionId,
			});
		}
		const campaign = campaignId ? this._campaigns.get(campaignId) : null;
		const rulesVersion = campaign?.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		if (data?.carry) assertCampaignRuleWriteFence({rulesVersion, data, protocolVersion});
		if (imported) {
			if (imported.status === "archived") {
				imported.status = "active";
				imported.campaignId = campaignId;
				imported.targetRef = crypto.randomUUID();
				this._setCharacterData({character: imported, data: normalizeCharacterInventory(data)});
				imported.schemaVersion = schemaVersion;
				imported.revision++;
				imported.updatedAt = this._fnNow().toISOString();
				this._appendAudit({campaignId, actorAccountId: accountId, action: "character.reactivated", targetType: "character", targetId: imported.id});
				if (campaignId) {
					this._appendEvent({campaignId, actorAccountId: accountId, type: "character.reactivated", aggregateType: "character", aggregateId: imported.id, aggregateRevision: imported.revision, payload: {}});
					// Reactivation replaces the document wholesale, so peers must refetch.
					this._commitCharacterMutation({character: imported, actorAccountId: accountId, isRevisionBump: false});
				}
			}
			return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(imported)}});
		}
		const character = {
			id: crypto.randomUUID(),
			ownerAccountId: accountId,
			campaignId,
			clonedFromCharacterId: [...this._characters.values()].find(it =>
				it.ownerAccountId === accountId
				&& it.clientImportId === clientImportId
				&& it.campaignId !== campaignId,
			)?.id || null,
			clientImportId,
			status: "active",
			schemaVersion,
			revision: 1,
			leaseEpoch: 0,
			targetRef: crypto.randomUUID(),
			operationWatermark: 0,
			projectionPolicy: getDefaultProjectionPolicy(),
			projectionRevision: 1,
			data: normalizeCharacterInventory(data),
			createdAt: this._fnNow().toISOString(),
			updatedAt: this._fnNow().toISOString(),
		};
		this._characters.set(character.id, character);
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "character.created",
			targetType: "character",
			targetId: character.id,
		});
		if (campaignId) {
			this._appendEvent({
				campaignId,
				actorAccountId: accountId,
				type: "character.created",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				// Owner association is roster metadata, not a shared event payload.
				payload: {},
			});
		}
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character)}});
	}

	async pAcquireCharacterLease ({accountId, sessionId, characterId, isTakeover = false, ttlMs = 30_000}) {
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
		if (character.campaignId) this._getMembership({accountId, campaignId: character.campaignId, roles: ["dm", "co_dm", "player"]});
		const current = this._characterLeases.get(characterId);
		const now = this._fnNow();
		const isActive = current && new Date(current.expiresAt) > now;
		if (isActive && current.sessionId !== sessionId && !isTakeover) {
			throw new HubStoreError("LEASE_HELD", `Character is being edited by another device.`, {
				status: 409,
				details: {expiresAt: current.expiresAt},
			});
		}
		const isSame = isActive && current.sessionId === sessionId;
		if (!isSame) character.leaseEpoch++;
		const lease = {
			characterId,
			sessionId,
			epoch: character.leaseEpoch,
			expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
		};
		this._characterLeases.set(characterId, lease);
		return copy(lease);
	}

	async pReleaseCharacterLease ({accountId, sessionId, characterId, leaseEpoch, expiresAt}) {
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can release this character editor.`, {status: 403});
		const lease = this._characterLeases.get(characterId);
		if (!lease) return {released: false};
		if (new Date(lease.expiresAt) <= this._fnNow()) {
			this._characterLeases.delete(characterId);
			return {released: false};
		}
		if (lease.sessionId !== sessionId) {
			throw new HubStoreError("LEASE_HELD", `Character is being edited by another device.`, {
				status: 409,
				details: {expiresAt: lease.expiresAt},
			});
		}
		if (lease.epoch !== leaseEpoch || lease.expiresAt !== new Date(expiresAt).toISOString()) return {released: false};
		this._characterLeases.delete(characterId);
		return {released: true};
	}

	async pPatchCharacter ({
		accountId,
		sessionId,
		characterId,
		baseRevision,
		leaseEpoch,
		patches,
		activity = null,
		rulesVersionId = null,
		idempotencyKey,
		protocolVersion = null,
	}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		let character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
		const enforcedCampaignId = character.campaignId;
		if (enforcedCampaignId) this._getMembership({accountId, campaignId: enforcedCampaignId, roles: ["dm", "co_dm", "player"]});
		const enforcement = enforcedCampaignId
			? await this._pGetCampaignContentEnforcement(enforcedCampaignId)
			: null;
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
		if (enforcedCampaignId) {
			this._getMembership({accountId, campaignId: enforcedCampaignId, roles: ["dm", "co_dm", "player"]});
			if (character.campaignId !== enforcedCampaignId) throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		}
		const lease = this._characterLeases.get(characterId);
		if (!lease || new Date(lease.expiresAt) <= this._fnNow()) {
			throw new HubStoreError("LEASE_EXPIRED", `Character edit lease expired.`, {status: 409});
		}
		if (lease.sessionId !== sessionId || lease.epoch !== leaseEpoch) {
			throw new HubStoreError("LEASE_FENCED", `This device no longer holds the character lease.`, {status: 409});
		}
		if (character.revision !== baseRevision) {
			throw new HubStoreError("REVISION_CONFLICT", `Character revision changed.`, {
				status: 409,
				details: {revision: character.revision, character: copy(character)},
			});
		}
		const normalizedActivity = normalizeCharacterPatchActivity(activity);
		const isDocumentMutation = !!patches?.length;
		if (!isDocumentMutation && !normalizedActivity) {
			return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character)}});
		}
		const data = applyJsonPatch(character.data, patches);
		// The current sheet writes a fresh `/carry` on every save whose document otherwise
		// changes, so its ABSENCE identifies a writer that does not understand carry
		// authority. Enumerating "carry-relevant paths" instead could never be complete —
		// passive Might alone depends on skills, expertise, class levels, proficiency bonus,
		// named modifiers, feature choices and item-derived modifiers — so any allowlist
		// would silently go stale as inputs are added.
		if (patches?.length && !hasFreshCarryWrite(patches)) stripCarryAuthority(data);
		const campaign = character.campaignId ? this._campaigns.get(character.campaignId) : null;
		const rulesVersion = campaign?.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		if (data?.carry) assertCampaignRuleWriteFence({rulesVersion, data, protocolVersion});
		validateCloudCharacterData(data);
		if (enforcement) {
			assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
			assertCharacterCampaignContentMutation({
				...enforcement,
				before: character.data,
				after: data,
				rulesVersionId: enforcement.activeRulesVersionId,
			});
		}
		if (isDocumentMutation) {
			this._setCharacterData({character, data});
			character.revision++;
		}
		if (character.campaignId && isDocumentMutation) {
			this._appendEvent({
				campaignId: character.campaignId,
				actorAccountId: accountId,
				type: "character.patched",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				visibility: "actor_and_dm",
				payload: {patches},
			});
		}
		if (character.campaignId && normalizedActivity) {
			const {type, ...payload} = normalizedActivity;
			this._appendAudit({
				campaignId: character.campaignId,
				actorAccountId: accountId,
				action: type,
				targetType: "character",
				targetId: character.id,
				details: normalizedActivity,
			});
			this._appendEvent({
				campaignId: character.campaignId,
				actorAccountId: accountId,
				type,
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				visibility: "all_members",
				payload,
			});
		}
		if (isDocumentMutation) this._commitCharacterMutation({character, actorAccountId: accountId, isRevisionBump: false});
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character)}});
	}

	async pCloneCharacter ({accountId, characterId, campaignId, rulesVersionId = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		let source = this._getCharacterOrThrow(characterId);
		if (source.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can clone this character.`, {status: 403});
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const enforcement = await this._pGetCampaignContentEnforcement(campaignId);
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		source = this._getCharacterOrThrow(characterId);
		if (source.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can clone this character.`, {status: 403});
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
		assertNewCharacterCampaignContent({
			...enforcement,
			character: source.data,
			rulesVersionId: enforcement.activeRulesVersionId,
		});
		const destination = this._campaigns.get(campaignId);
		const destinationRulesVersion = destination?.activeRulesVersionId
			? this._rulesVersions.get(destination.activeRulesVersionId)
			: null;
		const destinationBrewBundle = destination?.activeBrewBundleVersionId
			? this._brewVersions.get(destination.activeBrewBundleVersionId)
			: null;
		const destinationData = prepareCampaignTransitionData({
			data: source.data,
			rulesVersion: destinationRulesVersion,
			brewBundleHash: destinationBrewBundle?.contentHash ?? null,
		});
		const clone = {
			...copy(source),
			id: crypto.randomUUID(),
			campaignId,
			clonedFromCharacterId: source.id,
			clientImportId: null,
			revision: 1,
			leaseEpoch: 0,
			targetRef: crypto.randomUUID(),
			operationWatermark: 0,
			// The owner's sharing choice follows their copy; the revision restarts because
			// this is a new aggregate.
			projectionRevision: 1,
			data: {...destinationData, id: undefined, name: `${source.data.name || "Character"} (Copy)`},
			createdAt: this._fnNow().toISOString(),
			updatedAt: this._fnNow().toISOString(),
		};
		delete clone.data.id;
		this._characters.set(clone.id, clone);
		this._appendAudit({campaignId, actorAccountId: accountId, action: "character.cloned", targetType: "character", targetId: clone.id, details: {sourceCharacterId: source.id}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "character.created", aggregateType: "character", aggregateId: clone.id, aggregateRevision: 1, payload: {clonedFromCharacterId: source.id}});
		this._appendCharacterProjectionInvalidation({character: clone, actorAccountId: accountId});
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(clone)}});
	}

	async pMoveCharacter ({accountId, characterId, campaignId, rulesVersionId = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		let character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can move this character.`, {status: 403});
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		if (character.campaignId !== campaignId) {
			const enforcement = await this._pGetCampaignContentEnforcement(campaignId);
			const resumedPrior = this._getReceipt({accountId, idempotencyKey});
			if (resumedPrior) return resumedPrior;
			character = this._getCharacterOrThrow(characterId);
			if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can move this character.`, {status: 403});
			this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
			assertNewCharacterCampaignContent({
				...enforcement,
				character: character.data,
				rulesVersionId: enforcement.activeRulesVersionId,
			});
		}
		const lease = this._characterLeases.get(characterId);
		if (lease && new Date(lease.expiresAt) > this._fnNow()) {
			throw new HubStoreError("LEASE_HELD", `Release the active character editor before moving.`, {status: 409});
		}
		if ([...this._transfers.values()].some(it => it.status === "reserved" && it.sourceKind === "character" && it.sourceId === characterId)) {
			throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before moving.`, {status: 409});
		}
		const destination = this._campaigns.get(campaignId);
		const destinationRulesVersion = destination?.activeRulesVersionId
			? this._rulesVersions.get(destination.activeRulesVersionId)
			: null;
		const destinationBrewBundle = destination?.activeBrewBundleVersionId
			? this._brewVersions.get(destination.activeBrewBundleVersionId)
			: null;
		const destinationData = prepareCampaignTransitionData({
			data: character.data,
			rulesVersion: destinationRulesVersion,
			brewBundleHash: destinationBrewBundle?.contentHash ?? null,
		});
		this._cancelIncomingForCharacter({character});
		for (const operation of this._semanticOperations.values()) {
			if (operation.targetSetVersion === 1) {
				this._cancelMultiTargetOperationForLifecycle({
					operation,
					actorAccountId: accountId,
					affectedCharacterIds: new Set([characterId]),
				});
				continue;
			}
			if (
				operation.status === "proposed"
				&& [operation.sourceCharacterId, operation.targetCharacterId].includes(characterId)
			) {
				this._cancelSemanticOperationForLifecycle({operation, actorAccountId: accountId});
			}
		}
		const sourceCampaignId = character.campaignId;
		const sourceProjectionCharacter = copy(character);
		const characterNameSnapshot = createCharacterDisplayNameSnapshot(character.data?.name);
		character.campaignId = campaignId;
		character.data = normalizeCharacterInventory(destinationData);
		character.targetRef = crypto.randomUUID();
		if (sourceCampaignId !== campaignId) character.operationWatermark = 0;
		character.clientImportId = null;
		character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: "character.moved", targetType: "character", targetId: character.id, details: {sourceCampaignId}});
		if (sourceCampaignId && sourceCampaignId !== campaignId) {
			this._appendEvent({
				campaignId: sourceCampaignId,
				actorAccountId: accountId,
				type: "character.moved_out",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				payload: {targetCampaignId: campaignId, characterNameSnapshot},
			});
		}
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "character.moved",
			aggregateType: "character",
			aggregateId: character.id,
			aggregateRevision: character.revision,
			payload: {sourceCampaignId, characterNameSnapshot},
		});
		if (sourceCampaignId && sourceCampaignId !== campaignId) {
			this._appendCharacterProjectionInvalidation({
				character: sourceProjectionCharacter,
				actorAccountId: accountId,
			});
		}
		this._appendCharacterProjectionInvalidation({character, actorAccountId: accountId});
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character)}});
	}

	async pArchiveCharacter ({accountId, characterId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can archive this character.`, {status: 403});
		if ([...this._transfers.values()].some(it => it.status === "reserved" && it.sourceKind === "character" && it.sourceId === characterId)) {
			throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before archiving.`, {status: 409});
		}
		this._cancelIncomingForCharacter({character});
		for (const operation of this._semanticOperations.values()) {
			if (operation.targetSetVersion === 1) {
				this._cancelMultiTargetOperationForLifecycle({
					operation,
					actorAccountId: accountId,
					affectedCharacterIds: new Set([characterId]),
				});
				continue;
			}
			if (
				operation.status === "proposed"
				&& [operation.sourceCharacterId, operation.targetCharacterId].includes(characterId)
			) {
				this._cancelSemanticOperationForLifecycle({operation, actorAccountId: accountId});
			}
		}
		const projectionCharacter = copy(character);
		character.status = "archived";
		character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		this._characterLeases.delete(characterId);
		this._appendAudit({campaignId: character.campaignId, actorAccountId: accountId, action: "character.archived", targetType: "character", targetId: character.id});
		if (character.campaignId) {
			this._appendEvent({campaignId: character.campaignId, actorAccountId: accountId, type: "character.archived", aggregateType: "character", aggregateId: character.id, aggregateRevision: character.revision});
			this._appendCharacterProjectionInvalidation({
				character: projectionCharacter,
				actorAccountId: accountId,
			});
		}
		return this._setReceipt({accountId, idempotencyKey, response: {ok: true}});
	}

	async pGetCampaignContext ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const campaign = this._campaigns.get(campaignId);
		const brew = campaign.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		const rules = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		return {
			campaignId,
			membership: {role: membership.role},
			brewBundle: copy(brew),
			rulesVersion: getPublicCampaignRulesVersion(copy(rules)),
			capabilities: {
				peerSourceCosts: getPeerSourceCostsCampaignCapability({
					isEnabled: campaign.status === "active"
						&& Boolean(rules)
						&& this._isPeerSourceCostsEnabled(campaignId),
				}),
				multiTargetOperations: getMultiTargetOperationsCampaignCapability({
					isEnabled: campaign.status === "active"
						&& Boolean(rules)
						&& this._isMultiTargetOperationsEnabled(campaignId),
				}),
			},
		};
	}

	async pGetPeerSourceCostsCapability ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const campaign = this._campaigns.get(campaignId);
		return getPeerSourceCostsCampaignCapability({
			isEnabled: campaign?.status === "active"
				&& Boolean(campaign.activeRulesVersionId)
				&& this._isPeerSourceCostsEnabled(campaignId),
		});
	}

	async pCampaignRequiresProtocol4 ({campaignId}) {
		return [...this._semanticOperations.values()].some(operation =>
			operation.campaignId === campaignId && operation.sourceCost != null,
		);
	}

	async pGetMultiTargetOperationsCapability ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const campaign = this._campaigns.get(campaignId);
		return getMultiTargetOperationsCampaignCapability({
			isEnabled: campaign?.status === "active"
				&& Boolean(campaign.activeRulesVersionId)
				&& this._isMultiTargetOperationsEnabled(campaignId),
		});
	}

	async pCampaignRequiresProtocol6 ({campaignId}) {
		return this._multiTargetCampaignUsage.has(campaignId);
	}

	async pGetCampaignCompatibility ({accountId, campaignId}) {
		const context = await this.pGetCampaignContext({accountId, campaignId});
		return {
			campaignId,
			brewBundle: context.brewBundle
				? {
					id: context.brewBundle.id,
					version: context.brewBundle.version,
					contentHash: context.brewBundle.contentHash,
					documentCount: context.brewBundle.manifest?.documentCount || 0,
				}
				: null,
			rulesVersion: context.rulesVersion
				? {
					id: context.rulesVersion.id,
					version: context.rulesVersion.version,
					rules: copy(context.rulesVersion.rules),
				}
				: null,
		};
	}

	async pCreateBrewBundleVersion ({accountId, campaignId, contentHash, content, manifest, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		validateCampaignBrewBundle(content);
		await this._pGetCampaignContentCatalog({brewBundle: {content}});
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const existing = [...this._brewVersions.values()].find(it => it.campaignId === campaignId && it.contentHash === contentHash);
		if (existing) return this._setReceipt({accountId, idempotencyKey, response: {brewBundle: existing}});
		const version = Math.max(0, ...[...this._brewVersions.values()].filter(it => it.campaignId === campaignId).map(it => it.version)) + 1;
		const brewBundle = {
			id: crypto.randomUUID(),
			campaignId,
			version,
			contentHash,
			content: copy(content),
			manifest: copy(manifest),
			createdAt: this._fnNow().toISOString(),
		};
		this._brewVersions.set(brewBundle.id, brewBundle);
		this._appendAudit({campaignId, actorAccountId: accountId, action: "brew.created", targetType: "brew_bundle_version", targetId: brewBundle.id});
		return this._setReceipt({accountId, idempotencyKey, response: {brewBundle}});
	}

	async pActivateBrewBundleVersion ({accountId, campaignId, brewBundleId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const brewBundle = this._brewVersions.get(brewBundleId);
		if (!brewBundle || brewBundle.campaignId !== campaignId) throw new HubStoreError("BREW_NOT_FOUND", `Brew bundle was not found.`, {status: 404});
		validateCampaignBrewBundle(brewBundle.content);
		await this._pGetCampaignContentCatalog({brewBundle});
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		this._campaigns.get(campaignId).activeBrewBundleVersionId = brewBundleId;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "brew.activated", targetType: "brew_bundle_version", targetId: brewBundleId});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "brew.activated", aggregateType: "brew_bundle_version", aggregateId: brewBundleId, payload: {contentHash: brewBundle.contentHash, version: brewBundle.version}});
		return this._setReceipt({accountId, idempotencyKey, response: {brewBundle}});
	}

	async pCreateRulesVersion ({accountId, campaignId, schemaVersion, rules, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const version = Math.max(0, ...[...this._rulesVersions.values()].filter(it => it.campaignId === campaignId).map(it => it.version)) + 1;
		const rulesVersion = {
			id: crypto.randomUUID(),
			campaignId,
			version,
			schemaVersion,
			rules: copy(rules),
			createdAt: this._fnNow().toISOString(),
		};
		const response = {rulesVersion: getPublicCampaignRulesVersion(rulesVersion, {isIncludePolicy: true})};
		this._rulesVersions.set(rulesVersion.id, rulesVersion);
		this._appendAudit({campaignId, actorAccountId: accountId, action: "rules.created", targetType: "rules_version", targetId: rulesVersion.id});
		return this._setReceipt({
			accountId,
			idempotencyKey,
			response,
		});
	}

	async pActivateRulesVersion ({accountId, campaignId, rulesVersionId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const rulesVersion = this._rulesVersions.get(rulesVersionId);
		if (!rulesVersion || rulesVersion.campaignId !== campaignId) throw new HubStoreError("RULES_NOT_FOUND", `Rules version was not found.`, {status: 404});
		const activeRulesVersion = this._campaigns.get(campaignId).activeRulesVersionId
			? this._rulesVersions.get(this._campaigns.get(campaignId).activeRulesVersionId)
			: null;
		if (
			rulesVersion.schemaVersion !== CAMPAIGN_RULES_SCHEMA_VERSION
			|| (activeRulesVersion && activeRulesVersion.schemaVersion !== CAMPAIGN_RULES_SCHEMA_VERSION)
		) {
			throw new HubStoreError("RULES_POLICY_REQUIRED", `Use the version-fenced campaign policy activation endpoint.`, {status: 409});
		}
		const response = {rulesVersion: getPublicCampaignRulesVersion(rulesVersion, {isIncludePolicy: true})};
		this._campaigns.get(campaignId).activeRulesVersionId = rulesVersionId;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "rules.activated", targetType: "rules_version", targetId: rulesVersionId});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "rules.activated", aggregateType: "rules_version", aggregateId: rulesVersionId, payload: {version: rulesVersion.version}});
		return this._setReceipt({
			accountId,
			idempotencyKey,
			response,
		});
	}

	async pGetRulesPolicyManagement ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"], isRequireActiveCampaign: false});
		const campaign = this._campaigns.get(campaignId);
		const versions = [...this._rulesVersions.values()]
			.filter(version => version.campaignId === campaignId)
			.sort((a, b) => b.version - a.version)
			.map(version => getPublicCampaignRulesVersion(version, {isIncludePolicy: true}));
		return {
			campaignId,
			activeRulesVersionId: campaign.activeRulesVersionId,
			versions,
		};
	}

	async pCreateAndActivateRulesPolicy ({
		accountId,
		campaignId,
		policy,
		expectedActiveRulesVersionId,
		idempotencyKey,
	}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const campaign = this._campaigns.get(campaignId);
		if (campaign.activeRulesVersionId !== expectedActiveRulesVersionId) {
			throw new HubStoreError("RULES_VERSION_STALE", `Campaign rules changed before this policy was activated.`, {
				status: 409,
				details: {activeRulesVersionId: campaign.activeRulesVersionId},
			});
		}
		const brewBundle = campaign.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		const brewBundleVersionId = campaign.activeBrewBundleVersionId || null;
		const normalizedPolicy = normalizeCampaignRulesPolicyForStorage(policy);
		assertCampaignContentPolicyCatalog({
			policy: normalizedPolicy,
			contentCatalog: await this._pGetCampaignContentCatalog({brewBundle}),
		});
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		if (campaign.activeRulesVersionId !== expectedActiveRulesVersionId) {
			throw new HubStoreError("RULES_VERSION_STALE", `Campaign rules changed before this policy was activated.`, {
				status: 409,
				details: {activeRulesVersionId: campaign.activeRulesVersionId},
			});
		}
		if ((campaign.activeBrewBundleVersionId || null) !== brewBundleVersionId) {
			throw new HubStoreError("BREW_VERSION_STALE", `Campaign homebrew changed before this policy was activated.`, {
				status: 409,
				details: {activeBrewBundleVersionId: campaign.activeBrewBundleVersionId || null},
			});
		}
		const previousRulesVersion = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		const version = Math.max(
			0,
			...[...this._rulesVersions.values()]
				.filter(it => it.campaignId === campaignId)
				.map(it => it.version),
		) + 1;
		const rulesVersion = {
			id: crypto.randomUUID(),
			campaignId,
			version,
			schemaVersion: normalizedPolicy.schemaVersion,
			rules: copy(normalizedPolicy),
			createdAt: this._fnNow().toISOString(),
		};
		this._rulesVersions.set(rulesVersion.id, rulesVersion);
		campaign.activeRulesVersionId = rulesVersion.id;
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "rules.created",
			targetType: "rules_version",
			targetId: rulesVersion.id,
			details: {schemaVersion: normalizedPolicy.schemaVersion, catalogVersion: normalizedPolicy.catalogVersion},
		});
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "rules.activated",
			targetType: "rules_version",
			targetId: rulesVersion.id,
			details: {previousRulesVersionId: previousRulesVersion?.id || null},
		});
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "rules.activated",
			aggregateType: "rules_version",
			aggregateId: rulesVersion.id,
			payload: {
				version: rulesVersion.version,
				previousVersion: previousRulesVersion?.version || null,
				schemaVersion: normalizedPolicy.schemaVersion,
				catalogVersion: normalizedPolicy.catalogVersion,
				operation: "publish",
			},
		});
		const response = {
			rulesVersion: getPublicCampaignRulesVersion(rulesVersion, {isIncludePolicy: true}),
			previousRulesVersionId: previousRulesVersion?.id || null,
		};
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pActivateRulesPolicyVersion ({
		accountId,
		campaignId,
		rulesVersionId,
		expectedActiveRulesVersionId,
		idempotencyKey,
	}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const campaign = this._campaigns.get(campaignId);
		if (campaign.activeRulesVersionId !== expectedActiveRulesVersionId) {
			throw new HubStoreError("RULES_VERSION_STALE", `Campaign rules changed before this rollback was activated.`, {
				status: 409,
				details: {activeRulesVersionId: campaign.activeRulesVersionId},
			});
		}
		const target = this._rulesVersions.get(rulesVersionId);
		if (!target || target.campaignId !== campaignId) {
			throw new HubStoreError("RULES_NOT_FOUND", `Rules version was not found.`, {status: 404});
		}
		if (target.id === campaign.activeRulesVersionId) {
			throw new HubStoreError("RULES_ALREADY_ACTIVE", `That rules version is already active.`, {status: 409});
		}
		// Reading through the adapter proves the target remains compatible before activation.
		getPublicCampaignRulesVersion(target, {isIncludePolicy: true});
		const previous = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		campaign.activeRulesVersionId = target.id;
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "rules.rollback_activated",
			targetType: "rules_version",
			targetId: target.id,
			details: {previousRulesVersionId: previous?.id || null},
		});
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "rules.activated",
			aggregateType: "rules_version",
			aggregateId: target.id,
			payload: {
				version: target.version,
				previousVersion: previous?.version || null,
				schemaVersion: target.schemaVersion,
				catalogVersion: getPublicCampaignRulesVersion(target).catalogVersion,
				operation: "rollback",
			},
		});
		const response = {
			rulesVersion: getPublicCampaignRulesVersion(target, {isIncludePolicy: true}),
			previousRulesVersionId: previous?.id || null,
		};
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pGetOrCreateDmWorkspace ({accountId, campaignId, defaultState}) {
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const key = `${campaignId}::${membership.id}`;
		let workspace = this._dmWorkspaces.get(key);
		if (!workspace) {
			workspace = {
				id: crypto.randomUUID(),
				campaignId,
				ownerMembershipId: membership.id,
				schemaVersion: 1,
				revision: 1,
				leaseEpoch: 0,
				state: copy(defaultState),
			};
			this._dmWorkspaces.set(key, workspace);
			this._appendAudit({campaignId, actorAccountId: accountId, action: "dm_workspace.created", targetType: "dm_workspace", targetId: workspace.id});
		}
		workspace.archivedAt = null;
		return copy(workspace);
	}

	async pAcquireDmWorkspaceLease ({accountId, sessionId, campaignId, workspaceId, isTakeover = false, ttlMs = 30_000}) {
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const workspace = this._dmWorkspaces.get(`${campaignId}::${membership.id}`);
		if (!workspace || workspace.id !== workspaceId) throw new HubStoreError("WORKSPACE_NOT_FOUND", `DM workspace was not found.`, {status: 404});
		const current = this._dmWorkspaceLeases.get(workspaceId);
		const now = this._fnNow();
		const isActive = current && new Date(current.expiresAt) > now;
		if (isActive && current.sessionId !== sessionId && !isTakeover) throw new HubStoreError("LEASE_HELD", `DM workspace is being edited on another device.`, {status: 409});
		const isSame = isActive && current.sessionId === sessionId;
		if (!isSame) workspace.leaseEpoch++;
		const lease = {workspaceId, sessionId, epoch: workspace.leaseEpoch, expiresAt: new Date(now.getTime() + ttlMs).toISOString()};
		this._dmWorkspaceLeases.set(workspaceId, lease);
		return copy(lease);
	}

	async pWriteDmWorkspace ({accountId, sessionId, campaignId, workspaceId, baseRevision, leaseEpoch, state, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const workspace = this._dmWorkspaces.get(`${campaignId}::${membership.id}`);
		if (!workspace || workspace.id !== workspaceId) throw new HubStoreError("WORKSPACE_NOT_FOUND", `DM workspace was not found.`, {status: 404});
		const lease = this._dmWorkspaceLeases.get(workspaceId);
		if (!lease || new Date(lease.expiresAt) <= this._fnNow()) throw new HubStoreError("LEASE_EXPIRED", `DM workspace lease expired.`, {status: 409});
		if (lease.sessionId !== sessionId || lease.epoch !== leaseEpoch) throw new HubStoreError("LEASE_FENCED", `This device no longer holds the DM workspace lease.`, {status: 409});
		if (workspace.revision !== baseRevision) throw new HubStoreError("REVISION_CONFLICT", `DM workspace revision changed.`, {status: 409, details: {workspace: copy(workspace)}});
		workspace.state = copy(state);
		workspace.revision++;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "dm_workspace.updated", targetType: "dm_workspace", targetId: workspaceId});
		return this._setReceipt({accountId, idempotencyKey, response: {workspace}});
	}

	async pGetCampaignSnapshot ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const active = [...this._characters.values()]
			.filter(character => character.campaignId === campaignId && character.status === "active");
		return {
			campaign: copy(this._campaigns.get(campaignId)),
			membership: copy(membership),
			characters: active.map(character => this._projectOne({accountId, membership, character})),
			roster: this._getCampaignRoster({membership, characters: active}),
			lastSequence: this._getCampaignLastSequence(campaignId),
		};
	}

	/**
	 * The realtime resync cursor: campaign, membership, the ids/revisions needed to
	 * invalidate client caches, and the sequence. Deliberately carries no character
	 * document or peer profile — those come from the scoped HTTP projector.
	 */
	async pGetCampaignCursor ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return {
			cursor: {
				campaignId,
				lastSequence: this._getCampaignLastSequence(campaignId),
			},
			campaign: copy(this._campaigns.get(campaignId)),
			membership: copy(membership),
			characterRefs: [...this._characters.values()]
				.filter(character => character.campaignId === campaignId && character.status === "active")
				.map(character => ({
					id: character.id,
					revision: character.revision,
					projectionRevision: character.projectionRevision,
					...(["dm", "co_dm"].includes(membership.role) || character.ownerAccountId === accountId
						? {operationWatermark: character.operationWatermark || 0}
						: {}),
				})),
		};
	}

	async pListVisibleEvents ({accountId, campaignId, afterSequence = 0, limit = 500}) {
		return (await this.pListVisibleEventPage({accountId, campaignId, afterSequence, limit})).events;
	}

	async pListVisibleEventPage ({accountId, campaignId, afterSequence = 0, beforeSequence = null, limit = 500}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const campaignEvents = this._getCampaignEvents(campaignId);
		if (beforeSequence != null) {
			const rawLimit = Math.min(2_000, Math.max(200, limit * 25));
			const candidates = [];
			for (let index = campaignEvents.length - 1; index >= 0; --index) {
				if (campaignEvents[index].sequence >= beforeSequence) continue;
				candidates.push(campaignEvents[index]);
				if (candidates.length > rawLimit) break;
			}
			const scanned = candidates.slice(0, rawLimit);
			const visible = [];
			let scannedCount = 0;
			for (const event of scanned) {
				scannedCount++;
				if (!canViewEvent({event, accountId, role: membership.role})) continue;
				const redacted = this.redactEventForViewer({
					event: {
						...copy(event),
						...(this._accounts.get(event.actorAccountId)?.displayName
							? {actorDisplayName: this._accounts.get(event.actorAccountId).displayName}
							: {}),
					},
					accountId,
					role: membership.role,
				});
				if (!redacted) continue;
				visible.push(redacted);
				if (visible.length >= limit) break;
			}
			const considered = scanned.slice(0, scannedCount);
			return {
				events: visible.reverse(),
				history: {
					scannedBackThroughSequence: considered.at(-1)?.sequence ?? beforeSequence,
					hasMore: candidates.length > considered.length,
				},
			};
		}
		let lower = 0;
		let upper = campaignEvents.length;
		while (lower < upper) {
			const middle = Math.floor((lower + upper) / 2);
			if (campaignEvents[middle].sequence <= afterSequence) lower = middle + 1;
			else upper = middle;
		}
		const candidates = [];
		for (let index = lower; index < campaignEvents.length; ++index) {
			candidates.push(campaignEvents[index]);
			if (candidates.length > limit) break;
		}
		const scanned = candidates.slice(0, limit);
		const events = scanned
			.filter(event => canViewEvent({event, accountId, role: membership.role}))
			.map(event => this.redactEventForViewer({
				event: {
					...copy(event),
					...(this._accounts.get(event.actorAccountId)?.displayName
						? {actorDisplayName: this._accounts.get(event.actorAccountId).displayName}
						: {}),
				},
				accountId,
				role: membership.role,
			}))
			.filter(Boolean);
		return {
			events,
			replay: {
				scannedThroughSequence: scanned.at(-1)?.sequence ?? afterSequence,
				hasMore: candidates.length > limit,
			},
		};
	}

	/**
	 * Apply ADR 0011 actor redaction to one already visibility-filtered event. Shared and
	 * live fanout both route through this, so the socket cannot expose an association the
	 * HTTP read hides.
	 */
	redactEventForViewer ({event, accountId, role}) {
		event = redactActorCommandEventForViewer({event, accountId});
		const transferEvent = redactTransferEventForViewer({
			event,
			accountId,
			role,
			getCharacterOwnerId: characterId => this._characters.get(characterId)?.ownerAccountId,
		});
		if (transferEvent !== event) return transferEvent;
		if (
			event.type === "character.projection.invalidated"
			&& event.visibility === "explicit_accounts"
		) {
			const sanitized = {...event, visibleAccountIds: null};
			if (["dm", "co_dm"].includes(role) || event.actorAccountId === accountId) return sanitized;
			return redactEventActor(sanitized);
		}
		if (
			event.type.startsWith("character.multi_operation.")
			&& event.visibility === "explicit_accounts"
		) {
			const operation = this._semanticOperations.get(event.payload?.operationId || event.aggregateId);
			const target = event.payload?.invitationId
				? this._getMultiTargetByInvitation({
					operationId: operation?.id,
					invitationId: event.payload.invitationId,
				})
				: null;
			const sanitized = {...event, visibleAccountIds: null, payload: copy(event.payload)};
			const sourceOwnerAccountId = sanitized.payload?._sourceOwnerAccountId ??
				operation?.originActorAccountId;
			const targetOwnerAccountId = sanitized.payload?._targetOwnerAccountId ??
				target?.targetOwnerAccountIdAtProposal;
			delete sanitized.payload._sourceOwnerAccountId;
			delete sanitized.payload._targetOwnerAccountId;
			if (
				event.type === "character.multi_operation.target_applied"
				&& !["dm", "co_dm"].includes(role)
				&& (
					sourceOwnerAccountId === accountId
					|| targetOwnerAccountId !== accountId
				)
			) {
				delete sanitized.payload.changed;
				delete sanitized.payload.resultingCharacterRevision;
				if (sanitized.payload.operation) {
					sanitized.payload.operation = {...sanitized.payload.operation};
					delete sanitized.payload.operation.targetCharacterId;
				}
				sanitized.aggregateType = "semantic_operation";
				sanitized.aggregateId = operation?.id || sanitized.payload.operationId;
				sanitized.aggregateRevision = null;
			}
			return sanitized;
		}
		if (event.visibility !== "all_members" || event.aggregateType !== "character") return event;
		const character = this._characters.get(event.aggregateId) || null;
		// A hidden character contributes no shared rows at all, so no adjacent membership
		// event can be composed with one to recover the owner association.
		if (!canViewSharedCharacterEvent({character, accountId, role})) return null;
		return canViewCharacterEventActor({character, accountId, role, actorAccountId: event.actorAccountId})
			? event
			: redactEventActor(event);
	}

	async pLogRoll ({accountId, campaignId, characterId = null, visibility, payload, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		if (characterId) {
			const character = this._getCharacterOrThrow(characterId);
			if (character.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			if (character.ownerAccountId !== accountId) {
				const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
				if (!["dm", "co_dm"].includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Cannot log a roll for this character.`, {status: 403});
			}
		}
		const event = this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "roll.logged",
			aggregateType: characterId ? "character" : "campaign",
			aggregateId: characterId || campaignId,
			visibility,
			payload,
		});
		return this._setReceipt({accountId, idempotencyKey, response: {event}});
	}

	_assertSemanticSession ({accountId, sessionId}) {
		const account = this._accounts.get(accountId);
		const session = [...this._sessions.values()].find(it => it.id === sessionId && it.accountId === accountId);
		if (!account || account.status !== "active" || !session || session.revokedAt || new Date(session.expiresAt) <= this._fnNow()) {
			throw new HubStoreError("AUTH_REQUIRED", `The authenticated session is unavailable.`, {status: 401});
		}
	}

	_getSemanticCommand ({accountId, commandId, idempotencyKey}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		if (normalized.key !== commandId) throw new HubStoreError("IDEMPOTENCY_KEY_REUSED", `Command and idempotency identities differ.`, {status: 409});
		const prior = this._semanticOperationCommands.get(commandId);
		if (!prior) return null;
		if (prior.actorAccountId !== accountId || prior.requestHash !== normalized.requestHash) {
			throw new HubStoreError("IDEMPOTENCY_KEY_REUSED", `Command identity was reused with a different request.`, {status: 409});
		}
		return copy(prior.response);
	}

	_setSemanticCommand ({accountId, commandId, operationId, commandType, idempotencyKey, response, eventIds}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		this._semanticOperationCommands.set(commandId, {
			commandId,
			operationId,
			actorAccountId: accountId,
			commandType,
			requestHash: normalized.requestHash,
			response: copy(response),
			eventIds: [...eventIds],
			createdAt: this._fnNow().toISOString(),
		});
		return copy(response);
	}

	_getSemanticOperationView (operation, {accountId = null, role = null, source = null, target = null} = {}) {
		const snapshots = {
			sourceDisplaySnapshot: copy(operation.sourceDisplaySnapshot),
			targetDisplaySnapshot: copy(operation.targetDisplaySnapshot),
			effectDisplaySnapshot: copy(operation.effectDisplaySnapshot),
		};
		const out = {
			operationId: operation.id,
			status: operation.status,
			targetCharacterId: operation.targetCharacterId,
			version: operation.version,
			expiresAt: operation.expiresAt,
			resultingCharacterRevision: operation.resultingCharacterRevision,
			resultingTargetCharacterRevision: operation.resultingCharacterRevision,
			...snapshots,
			...(operation.changed === false ? {changed: false} : {}),
		};
		if (operation.sourceCost) {
			const sourceOwnerAccountId = source?.ownerAccountId ?? operation.originActorAccountId;
			const targetOwnerAccountId = target?.ownerAccountId ?? operation.targetOwnerAccountIdAtProposal;
			const canViewSource = accountId === sourceOwnerAccountId || ["dm", "co_dm"].includes(role);
			out.sourceCostState = getPeerSourceCostState(operation.status);
			out.templateRegistryVersion = operation.templateRegistryVersion;
			if (canViewSource) {
				out.sourceResult = {
					sourceCharacterId: operation.sourceCharacterId,
					sourceCost: copy(operation.sourceCost),
					resultingSourceCharacterRevision: operation.resultingSourceCharacterRevision,
				};
				if (operation.status === "applied") {
					const sourceLeg = operation.sourceCharacterId === operation.targetCharacterId ? "combined" : "source";
					out.sourceResult.leg = sourceLeg;
					out.sourceResult.operationLegKey = `${operation.id}/${sourceLeg}`;
					out.sourceResult.appliedEventId = operation.sourceCostEventId ?? operation.appliedEventId;
				}
				out.sourceEntity = copy(operation.sourceEntity);
				out.effectTemplateId = operation.effectTemplateId;
				out.choice = copy(operation.choice);
				out.sourceRevisionObserved = operation.sourceRevisionObserved;
				out.targetRevisionObserved = operation.targetRevisionObserved;
				out.rulesPin = copy(operation.rulesPin);
			}
			Object.assign(out, getPeerSourceCostActionSummary(operation, {
				canCancel: accountId === operation.originActorAccountId || ["dm", "co_dm"].includes(role),
			}));
			const failureCode = getPeerSourceCostFailureForViewer({
				operation,
				accountId,
				role,
				sourceOwnerAccountId,
				targetOwnerAccountId,
			});
			if (failureCode) out.failureCode = failureCode;
			if (operation.status === "applied") {
				out.leg = operation.sourceCharacterId === operation.targetCharacterId ? "combined" : "target";
				out.operationLegKey = `${operation.id}/${out.leg}`;
			}
		}
		if (operation.sourceEntity) {
			if (!operation.sourceCost) {
				Object.assign(out, {
					sourceEntity: copy(operation.sourceEntity),
					effectTemplateId: operation.effectTemplateId,
					choice: copy(operation.choice),
				});
			}
		}
		if (operation.status === "applied") {
			out.appliedEventId = operation.appliedEventId;
			out.operation = {
				operationId: operation.id,
				kind: operation.kind,
				version: operation.version,
				targetCharacterId: operation.targetCharacterId,
				arguments: copy(operation.arguments),
			};
		}
		return out;
	}

	_getSemanticRecipients ({operation, target}) {
		return [...new Set([
			operation.originActorAccountId,
			operation.targetOwnerAccountIdAtProposal ?? target?.ownerAccountId,
			...this._getSemanticDmAccountIds(operation.campaignId),
		].filter(Boolean))];
	}

	_getSemanticDmAccountIds (campaignId) {
		return [...this._memberships.values()]
			.filter(membership => membership.campaignId === campaignId
				&& membership.status === "active"
				&& ["dm", "co_dm"].includes(membership.role))
			.map(membership => membership.accountId);
	}

	_getSourceCostRecipients ({operation, source}) {
		return [...new Set([
			source?.ownerAccountId ?? operation.originActorAccountId,
			...this._getSemanticDmAccountIds(operation.campaignId),
		].filter(Boolean))];
	}

	_getSemanticLifecyclePayload (operation) {
		const payload = {
			operationId: operation.id,
			status: operation.status,
			reason: "unavailable",
			targetDisplaySnapshot: copy(operation.targetDisplaySnapshot),
			effectDisplaySnapshot: copy(operation.effectDisplaySnapshot),
		};
		if (!operation.sourceCost) {
			payload.targetCharacterId = operation.targetCharacterId;
			payload.sourceDisplaySnapshot = copy(operation.sourceDisplaySnapshot);
		}
		return payload;
	}

	_cancelSemanticOperationForLifecycle ({operation, actorAccountId}) {
		if (operation.status !== "proposed") return;
		const target = this._characters.get(operation.targetCharacterId);
		operation.status = "cancelled";
		operation.updatedAt = this._fnNow().toISOString();
		operation.resolvedAt = operation.updatedAt;
		operation.terminalReason = "unavailable";
		this._appendAudit({
			campaignId: operation.campaignId,
			actorAccountId,
			action: "character.operation.cancelled",
			targetType: "semantic_operation",
			targetId: operation.id,
			details: {reason: "lifecycle"},
		});
		const event = this._appendEvent({
			campaignId: operation.campaignId,
			actorAccountId,
			type: "character.operation.cancelled",
			aggregateType: "semantic_operation",
			aggregateId: operation.id,
			visibility: "explicit_accounts",
			visibleAccountIds: this._getSemanticRecipients({operation, target}),
			payload: this._getSemanticLifecyclePayload(operation),
		});
		operation.terminalEventId = event.id;
	}

	_expireSemanticOperations ({campaignId}) {
		const now = this._fnNow();
		for (const operation of this._semanticOperations.values()) {
			if (operation.targetSetVersion === 1) continue;
			if (
				operation.campaignId !== campaignId
				|| operation.status !== "proposed"
				|| new Date(operation.expiresAt) > now
			) continue;
			const target = this._characters.get(operation.targetCharacterId);
			operation.status = "expired";
			operation.updatedAt = now.toISOString();
			operation.resolvedAt = now.toISOString();
			operation.terminalReason = "unavailable";
			this._appendAudit({
				campaignId,
				actorAccountId: null,
				action: "character.operation.expired",
				targetType: "semantic_operation",
				targetId: operation.id,
			});
			const event = this._appendEvent({
				campaignId,
				actorAccountId: null,
				type: "character.operation.expired",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: this._getSemanticRecipients({operation, target}),
				payload: this._getSemanticLifecyclePayload(operation),
			});
			operation.terminalEventId = event.id;
		}
	}

	async pCreateStructuredAction ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		targetCharacterId = null,
		operation: submittedOperation = null,
		sourceCharacterId = null,
		sourceEntity = null,
		effectTemplateId = null,
		choice = null,
		targetRef = null,
		contractVersion = null,
		rulesVersionId = null,
		protocolVersion = null,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player", "spectator"]});
		const operationId = crypto.randomUUID();
		const now = this._fnNow();

		if (submittedOperation) {
			if (!["dm", "co_dm"].includes(membership.role)) {
				throw new HubStoreError("OPERATION_FORBIDDEN", `Generic semantic operations require a DM role.`, {status: 403});
			}
			const target = this._getCharacterOrThrow(targetCharacterId);
			if (target.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			const normalized = normalizeSemanticOperation({
				...submittedOperation,
				operationId,
				targetCharacterId,
			});
			const {data, changed} = applySemanticOperationWithResult({data: target.data, operation: normalized});
			validateCloudCharacterData(data);
			const semanticOperation = {
				id: operationId,
				campaignId,
				originActorAccountId: accountId,
				sourceCharacterId: null,
				targetCharacterId,
				status: "applied",
				version: normalized.version,
				kind: normalized.kind,
				arguments: copy(normalized.arguments),
				sourceEntity: null,
				effectTemplateId: null,
				choice: null,
				sourceDisplaySnapshot: null,
				targetDisplaySnapshot: null,
				effectDisplaySnapshot: null,
				resultingCharacterRevision: target.revision + 1,
				...(!changed ? {changed: false} : {}),
				expiresAt: null,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			};
			this._setCharacterData({character: target, data});
			target.revision++;
			target.updatedAt = now.toISOString();
			this._semanticOperations.set(operationId, semanticOperation);
			this._appendAudit({
				campaignId,
				actorAccountId: accountId,
				action: "character.operation.applied",
				targetType: "semantic_operation",
				targetId: operationId,
				details: {kind: normalized.kind, version: normalized.version, changed, resultingCharacterRevision: target.revision},
			});
			const appliedEvent = this._appendEvent({
				campaignId,
				actorAccountId: accountId,
				type: "character.operation.applied",
				aggregateType: "character",
				aggregateId: target.id,
				aggregateRevision: target.revision,
				visibility: "explicit_accounts",
				visibleAccountIds: this._getSemanticRecipients({operation: semanticOperation, target}),
				payload: {
					operation: normalized,
					resultingCharacterRevision: target.revision,
					...(!changed ? {changed: false} : {}),
				},
			});
			semanticOperation.appliedEventId = appliedEvent.id;
			semanticOperation.resolvedAt = now.toISOString();
			target.operationWatermark = appliedEvent.sequence;
			const invalidationEvent = changed
				? this._commitCharacterMutation({character: target, actorAccountId: accountId, isRevisionBump: false})
				: null;
			const response = {
				operation: this._getSemanticOperationView(semanticOperation),
				eventIds: [appliedEvent.id, invalidationEvent?.id].filter(Boolean),
				operationWatermark: target.operationWatermark,
			};
			return this._setSemanticCommand({
				accountId,
				commandId,
				operationId,
				commandType: "create_direct",
				idempotencyKey,
				response,
				eventIds: response.eventIds,
			});
		}

		const isCostBearing = this._semanticOperationRegistry.isCostBearing({sourceEntity, effectTemplateId});
		if (isCostBearing && membership.role !== "player") {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		if (!isCostBearing && membership.role === "spectator") {
			throw new HubStoreError("OPERATION_FORBIDDEN", `Spectators cannot create peer proposals.`, {status: 403});
		}
		const source = this._getCharacterOrThrow(sourceCharacterId);
		if (source.ownerAccountId !== accountId || source.campaignId !== campaignId) {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		const target = [...this._characters.values()].find(character =>
			character.campaignId === campaignId
			&& character.status === "active"
			&& character.targetRef === targetRef,
		);
		if (!target) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		const targetOwnerMembership = this._memberships.get(`${campaignId}::${target.ownerAccountId}`);
		if (isCostBearing && (
			targetOwnerMembership?.status !== "active"
			|| targetOwnerMembership.role !== "player"
		)) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		try {
			this._assertTargetable({character: target, accountId, role: membership.role});
		} catch {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		if (isCostBearing && !isPeerSourceCostsProtocolVersion(protocolVersion)) {
			throw new HubStoreError("PROTOCOL_UPDATE_REQUIRED", `Hub protocol 4 or newer is required.`, {status: 426});
		}
		if (isCostBearing && (
			contractVersion !== PEER_SOURCE_COSTS_CONTRACT_VERSION
			|| !this._isPeerSourceCostsEnabled(campaignId)
		)) throw new HubStoreError("CAPABILITY_UNAVAILABLE", `Peer source costs are unavailable.`, {status: 409});
		if (!isCostBearing && contractVersion != null) {
			throw new HubStoreError("SOURCE_COST_UNSUPPORTED", `The source cost is not supported.`, {status: 409});
		}
		const campaign = this._campaigns.get(campaignId);
		const rulesVersion = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		const brewBundle = campaign.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		const rulesPin = isCostBearing ? getPeerSourceCostsRulesPin({rulesVersion, brewBundle}) : null;
		if (isCostBearing && (!rulesPin || rulesPin.rulesVersionId !== rulesVersionId)) {
			throw new HubStoreError("POLICY_VERSION_STALE", `Campaign rules changed.`, {status: 409});
		}
		const effectResolutionSeed = isCostBearing ? crypto.randomBytes(32).toString("hex") : null;
		const derived = this._semanticOperationRegistry.derive({
			sourceCharacter: source,
			targetCharacter: target,
			targetRef,
			sourceEntity,
			effectTemplateId,
			choice,
			sourceProfile: computePeerProfile({character: source}),
			targetProfile: computePeerProfile({character: target}),
			operationId,
			effectResolutionSeed,
		});
		const expiresAt = new Date(now.getTime() + this._semanticProposalTtlMs).toISOString();
		const semanticOperation = {
			id: operationId,
			campaignId,
			originActorAccountId: accountId,
			sourceCharacterId: source.id,
			targetCharacterId: target.id,
			targetOwnerAccountIdAtProposal: isCostBearing ? target.ownerAccountId : null,
			targetRef,
			status: "proposed",
			version: derived.operation.version,
			kind: derived.operation.kind,
			arguments: copy(derived.operation.arguments),
			sourceEntity: copy(derived.sourceEntity),
			effectTemplateId: derived.effectTemplateId,
			choice: copy(derived.choice),
			sourceDisplaySnapshot: copy(derived.sourceDisplaySnapshot),
			targetDisplaySnapshot: copy(derived.targetDisplaySnapshot),
			effectDisplaySnapshot: copy(derived.effectDisplaySnapshot),
			sourceCostVersion: derived.sourceCost?.version ?? null,
			sourceCost: copy(derived.sourceCost),
			rulesVersionId: rulesPin?.rulesVersionId ?? null,
			rulesPin: copy(rulesPin),
			templateRegistryVersion: isCostBearing ? PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION : null,
			effectResolutionSeed,
			sourceRevisionObserved: isCostBearing ? source.revision : null,
			sourceCostInvalidated: false,
			targetRevisionObserved: isCostBearing ? target.revision : null,
			resultingSourceCharacterRevision: null,
			sourceCostEventId: null,
			privateFailureCode: null,
			resultingCharacterRevision: null,
			expiresAt,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		};
		this._semanticOperations.set(operationId, semanticOperation);
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "character.operation.proposed",
			targetType: "semantic_operation",
			targetId: operationId,
		});
		const proposedEvent = this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "character.operation.proposed",
			aggregateType: "semantic_operation",
			aggregateId: operationId,
			visibility: "explicit_accounts",
			visibleAccountIds: this._getSemanticRecipients({operation: semanticOperation, target}),
			payload: isCostBearing
				? {
					operationId,
					status: "proposed",
					contractVersion: PEER_SOURCE_COSTS_CONTRACT_VERSION,
					targetDisplaySnapshot: copy(derived.targetDisplaySnapshot),
					effectDisplaySnapshot: copy(derived.effectDisplaySnapshot),
					expiresAt,
				}
				: {
					operationId,
					targetCharacterId: target.id,
					status: "proposed",
					sourceDisplaySnapshot: copy(derived.sourceDisplaySnapshot),
					targetDisplaySnapshot: copy(derived.targetDisplaySnapshot),
					effectDisplaySnapshot: copy(derived.effectDisplaySnapshot),
					effectOutcomeLabel: getPendingEffectPresentation({
						operationId,
						status: "proposed",
						sourceDisplaySnapshot: derived.sourceDisplaySnapshot,
						effectDisplaySnapshot: derived.effectDisplaySnapshot,
						operationKind: derived.operation.kind,
						operationArguments: derived.operation.arguments,
						expiresAt,
					}).presentation.outcomeLabel,
					expiresAt,
				},
		});
		semanticOperation.createdEventId = proposedEvent.id;
		const response = {
			operation: this._getSemanticOperationView(semanticOperation, {
				accountId,
				role: membership.role,
				source,
				target,
			}),
			eventIds: [proposedEvent.id],
		};
		return this._setSemanticCommand({
			accountId,
			commandId,
			operationId,
			commandType: "create_proposal",
			idempotencyKey,
			response,
			eventIds: response.eventIds,
		});
	}

	_getSourceCostAcceptanceSnapshot () {
		return {
			_campaigns: copy(this._campaigns),
			_characters: copy(this._characters),
			_semanticOperations: copy(this._semanticOperations),
			_semanticOperationCommands: copy(this._semanticOperationCommands),
			_semanticOperationTargets: copy(this._semanticOperationTargets),
			_semanticOperationFinalizations: copy(this._semanticOperationFinalizations),
			_semanticMultiTargetUsage: copy(this._semanticMultiTargetUsage),
			_multiTargetCampaignUsage: copy(this._multiTargetCampaignUsage),
			_commandReceipts: copy(this._commandReceipts),
			_events: copy(this._events),
			_campaignEvents: copy(this._campaignEvents),
			_outbox: copy(this._outbox),
			_audit: copy(this._audit),
		};
	}

	_createSourceCostAcceptanceTransactionStore () {
		const baseline = this._getSourceCostAcceptanceSnapshot();
		const transactionStore = Object.create(Object.getPrototypeOf(this));
		Object.assign(transactionStore, this, copy(baseline));
		return {baseline, transactionStore};
	}

	_publishSourceCostAcceptanceMap ({target, source, baseline}) {
		for (const key of baseline.keys()) {
			if (!source.has(key)) target.delete(key);
		}
		for (const [key, sourceValue] of source) {
			if (baseline.has(key) && isCanonicalEqual(sourceValue, baseline.get(key))) continue;
			const targetValue = target.get(key);
			if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
				targetValue.splice(0, targetValue.length, ...sourceValue);
			} else if (
				targetValue
				&& sourceValue
				&& typeof targetValue === "object"
				&& typeof sourceValue === "object"
			) {
				for (const property of Object.keys(targetValue)) delete targetValue[property];
				Object.assign(targetValue, sourceValue);
			} else target.set(key, sourceValue);
		}
	}

	_publishSourceCostAcceptanceTransactionStore ({baseline, transactionStore}) {
		for (const [target, source, previous] of [
			[this._campaigns, transactionStore._campaigns, baseline._campaigns],
			[this._characters, transactionStore._characters, baseline._characters],
			[this._semanticOperations, transactionStore._semanticOperations, baseline._semanticOperations],
			[this._semanticOperationCommands, transactionStore._semanticOperationCommands, baseline._semanticOperationCommands],
			[this._semanticOperationTargets, transactionStore._semanticOperationTargets, baseline._semanticOperationTargets],
			[this._semanticOperationFinalizations, transactionStore._semanticOperationFinalizations, baseline._semanticOperationFinalizations],
			[this._commandReceipts, transactionStore._commandReceipts, baseline._commandReceipts],
		]) this._publishSourceCostAcceptanceMap({target, source, baseline: previous});
		this._semanticMultiTargetUsage = copy(transactionStore._semanticMultiTargetUsage);
		this._multiTargetCampaignUsage = copy(transactionStore._multiTargetCampaignUsage);
		for (const event of transactionStore._events.slice(baseline._events.length)) {
			const campaignEvents = this._getCampaignEvents(event.campaignId);
			this._events.push(event);
			campaignEvents.push(event);
		}
		this._outbox.push(...transactionStore._outbox.slice(baseline._outbox.length));
		this._audit.push(...transactionStore._audit.slice(baseline._audit.length));
	}

	_injectTestResolveStructuredActionFault ({stage, operation}) {
		if (!operation.sourceCost) return;
		this._fnTestResolveStructuredActionFault?.({stage, operationId: operation.id});
	}

	_injectTestMultiTargetFault ({stage, operation, details = null}) {
		if (operation.targetSetVersion !== 1) return;
		this._fnTestResolveStructuredActionFault?.({
			stage: `multi-target:${stage}`,
			operationId: operation.id,
			details,
		});
	}

	async pResolveStructuredAction (args) {
		const operation = this._semanticOperations.get(args.actionId);
		if (args.decision !== "accept" || !operation?.sourceCost) {
			return this._pResolveStructuredActionTransactionBody(args);
		}
		return this._pWithMemoryLock({
			key: "source-cost-acceptance-transaction",
			fn: () => {
				const transaction = this._createSourceCostAcceptanceTransactionStore();
				const {transactionStore} = transaction;
				const response = transactionStore._pResolveStructuredActionTransactionBody(args);
				this._publishSourceCostAcceptanceTransactionStore(transaction);
				return response;
			},
		});
	}

	_pResolveStructuredActionTransactionBody ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		actionId,
		decision,
		contractVersion = null,
		protocolVersion = null,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		if (!["accept", "reject", "cancel"].includes(decision)) {
			throw new HubStoreError("INVALID_REQUEST", `The resolution decision is invalid.`, {status: 400});
		}
		const membership = this._memberships.get(`${campaignId}::${accountId}`);
		const campaign = this._campaigns.get(campaignId);
		if (
			!membership
			|| membership.status !== "active"
			|| !["dm", "co_dm", "player"].includes(membership.role)
			|| campaign?.status !== "active"
		) throw new HubStoreError("ACTION_NOT_FOUND", `Pending operation was not found.`, {status: 404});
		const operation = this._semanticOperations.get(actionId);
		if (!operation || operation.campaignId !== campaignId) throw new HubStoreError("ACTION_NOT_FOUND", `Pending operation was not found.`, {status: 404});
		const source = this._characters.get(operation.sourceCharacterId);
		const target = this._characters.get(operation.targetCharacterId);
		const isDm = ["dm", "co_dm"].includes(membership.role);
		const targetOwnerAccountId = operation.targetOwnerAccountIdAtProposal ?? target?.ownerAccountId;
		const targetOwnerMembership = this._memberships.get(`${campaignId}::${targetOwnerAccountId}`);
		const isTargetOwner = targetOwnerAccountId === accountId;
		const isProposer = operation.originActorAccountId === accountId;
		if (!isDm && !isProposer && !isTargetOwner) throw new HubStoreError("ACTION_NOT_FOUND", `Pending operation was not found.`, {status: 404});
		if (operation.sourceCost && (
			contractVersion !== PEER_SOURCE_COSTS_CONTRACT_VERSION
			|| !isPeerSourceCostsProtocolVersion(protocolVersion)
		)) throw new HubStoreError("PROTOCOL_UPDATE_REQUIRED", `Hub protocol 4 or newer is required.`, {status: 426});
		if (decision === "accept" && (!isTargetOwner || membership.role !== "player")) {
			throw new HubStoreError("OPERATION_FORBIDDEN", `Only an active player target owner may approve.`, {status: 403});
		}
		if (decision === "reject" && !isTargetOwner && !isDm) throw new HubStoreError("OPERATION_FORBIDDEN", `Cannot reject this proposal.`, {status: 403});
		if (decision === "cancel" && !isProposer && !isDm) throw new HubStoreError("OPERATION_FORBIDDEN", `Cannot cancel this proposal.`, {status: 403});
		const commandType = decision;

		if (operation.status !== "proposed") {
			if (!operation.sourceCost) throw new HubStoreError("ACTION_NOT_FOUND", `Pending operation was not found.`, {status: 404});
			const response = {
				operation: this._getSemanticOperationView(operation, {accountId, role: membership.role, source, target}),
				eventIds: [
					operation.sourceCostEventId,
					operation.appliedEventId,
					operation.terminalEventId,
				].filter(Boolean),
				...(operation.status === "applied"
					? {watermarks: this._getSemanticWatermarksForViewer({operation, accountId, role: membership.role, source, target})}
					: {}),
			};
			const responseOut = this._setSemanticCommand({
				accountId,
				commandId,
				operationId: operation.id,
				commandType,
				idempotencyKey,
				response,
				eventIds: response.eventIds,
			});
			this._injectTestResolveStructuredActionFault({stage: "receipt", operation});
			return responseOut;
		}
		if (new Date(operation.expiresAt) <= this._fnNow()) decision = "expire";

		const eventIds = [];
		let privateFailureCode = null;
		let sourceNxtData = null;
		let targetNxtData = null;
		if (decision === "accept") {
			const originMembership = this._memberships.get(`${campaignId}::${operation.originActorAccountId}`);
			const isOriginStillEligible = originMembership?.status === "active"
				&& (!operation.sourceCost || originMembership.role === "player")
				&& (operation.sourceCost
					? targetOwnerMembership?.status === "active" && targetOwnerMembership.role === "player"
					: true)
				&& source?.status === "active"
				&& target?.status === "active"
				&& source.ownerAccountId === operation.originActorAccountId
				&& source.campaignId === campaignId
				&& target.campaignId === campaignId
				&& target.targetRef === operation.targetRef
				&& target.ownerAccountId === targetOwnerAccountId;
			if (!isOriginStillEligible) {
				privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			}
			if (!privateFailureCode) {
				try {
					this._assertTargetable({
						character: target,
						accountId: operation.originActorAccountId,
						role: originMembership.role,
					});
				} catch {
					privateFailureCode = "TARGET_EFFECT_UNAVAILABLE";
				}
			}
			if (operation.sourceCost) {
				const campaign = this._campaigns.get(campaignId);
				const rulesVersion = campaign?.activeRulesVersionId
					? this._rulesVersions.get(campaign.activeRulesVersionId)
					: null;
				const brewBundle = campaign?.activeBrewBundleVersionId
					? this._brewVersions.get(campaign.activeBrewBundleVersionId)
					: null;
				const currentPin = getPeerSourceCostsRulesPin({rulesVersion, brewBundle});
				if (!isPeerSourceCostsPinCurrent({
					operation,
					rulesPin: currentPin,
					isCapabilityEnabled: this._isPeerSourceCostsEnabled(campaignId),
				})) privateFailureCode = "POLICY_VERSION_STALE";
			}
			if (!privateFailureCode && operation.sourceCostInvalidated) {
				privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			}
			if (!privateFailureCode && operation.sourceCost) {
				try {
					this._semanticOperationRegistry.getTemplate({
						sourceEntity: operation.sourceEntity,
						effectTemplateId: operation.effectTemplateId,
					});
				} catch {
					throw new HubStoreError(
						"SOURCE_COST_HANDLER_UNAVAILABLE",
						`The pinned source-cost handler is unavailable.`,
						{status: 503},
					);
				}
			}
			let derived = null;
			if (!privateFailureCode) {
				try {
					derived = this._semanticOperationRegistry.derive({
						sourceCharacter: source,
						targetCharacter: target,
						targetRef: operation.targetRef,
						sourceEntity: operation.sourceEntity,
						effectTemplateId: operation.effectTemplateId,
						choice: operation.choice,
						sourceProfile: computePeerProfile({character: source}),
						targetProfile: computePeerProfile({character: target}),
						operationId: operation.id,
						effectResolutionSeed: operation.effectResolutionSeed,
					});
				} catch (error) {
					if (
						!operation.sourceCost
						&& ["SOURCE_COST_UNSUPPORTED", "SOURCE_OR_TARGET_UNAVAILABLE"].includes(error.code)
					) throw new HubStoreError("PROPOSAL_STALE", `The proposal is no longer applicable.`, {status: 409});
					privateFailureCode = getPrivateAcceptanceFailureCode(error);
					if (!privateFailureCode) throw error;
				}
			}
			const expectedOperation = {
				operationId: operation.id,
				kind: operation.kind,
				version: operation.version,
				targetCharacterId: operation.targetCharacterId,
				arguments: operation.arguments,
			};
			if (
				!privateFailureCode
				&& (
					!isCanonicalEqual(derived.operation, expectedOperation)
					|| (operation.sourceCost && !isCanonicalEqual(derived.sourceCost, operation.sourceCost))
					|| !isCanonicalEqual(derived.sourceEntity, operation.sourceEntity)
					|| derived.effectTemplateId !== operation.effectTemplateId
					|| !isCanonicalEqual(derived.choice, operation.choice)
				)
			) privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			if (!privateFailureCode) {
				try {
					if (operation.sourceCost) {
						sourceNxtData = applySourceCost({data: source.data, sourceCost: operation.sourceCost}).data;
					}
				} catch (error) {
					privateFailureCode = getPrivateAcceptanceFailureCode(error);
					if (!privateFailureCode) throw error;
				}
			}
			if (!privateFailureCode) {
				try {
					const targetBase = source.id === target.id && sourceNxtData ? sourceNxtData : target.data;
					targetNxtData = applySemanticOperation({data: targetBase, operation: derived.operation});
					if (isCanonicalEqual(targetNxtData, targetBase)) {
						throw new HubStoreError("TARGET_EFFECT_UNAVAILABLE", `The target effect is unavailable.`, {status: 409});
					}
					if (source.id === target.id) sourceNxtData = targetNxtData;
					validateCloudCharacterData(targetNxtData);
					if (source.id !== target.id && sourceNxtData) validateCloudCharacterData(sourceNxtData);
				} catch (error) {
					privateFailureCode = getPrivateAcceptanceFailureCode(error, {leg: "target"});
					if (!privateFailureCode) throw error;
				}
			}
			if (privateFailureCode && !operation.sourceCost) {
				throw new HubStoreError("PROPOSAL_STALE", `The proposal is no longer applicable.`, {status: 409});
			}
			if (privateFailureCode) {
				operation.status = "failed";
				operation.privateFailureCode = privateFailureCode;
			} else if (source.id === target.id && operation.sourceCost) {
				this._setCharacterData({character: target, data: targetNxtData});
				target.revision++;
				target.updatedAt = this._fnNow().toISOString();
				operation.status = "applied";
				operation.resultingSourceCharacterRevision = target.revision;
				operation.resultingCharacterRevision = target.revision;
				const combinedEvent = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: "character.operation.applied",
					aggregateType: "character",
					aggregateId: target.id,
					aggregateRevision: target.revision,
					visibility: "explicit_accounts",
					visibleAccountIds: this._getSourceCostRecipients({operation, source}),
					payload: {
						leg: "combined",
						operation: derived.operation,
						sourceCost: copy(operation.sourceCost),
						resultingCharacterRevision: target.revision,
						resultingSourceCharacterRevision: target.revision,
					},
				});
				this._injectTestResolveStructuredActionFault({stage: "combined-event", operation});
				operation.appliedEventId = combinedEvent.id;
				target.operationWatermark = combinedEvent.sequence;
				eventIds.push(combinedEvent.id);
			} else {
				if (sourceNxtData) {
					this._setCharacterData({character: source, data: sourceNxtData});
					source.revision++;
					source.updatedAt = this._fnNow().toISOString();
				}
				this._setCharacterData({character: target, data: targetNxtData});
				target.revision++;
				target.updatedAt = this._fnNow().toISOString();
				operation.status = "applied";
				operation.resultingSourceCharacterRevision = operation.sourceCost ? source.revision : null;
				operation.resultingCharacterRevision = target.revision;
				if (operation.sourceCost) {
					const sourceEvent = this._appendEvent({
						campaignId,
						actorAccountId: accountId,
						type: "character.operation.source_cost_consumed",
						aggregateType: "character",
						aggregateId: source.id,
						aggregateRevision: source.revision,
						visibility: "explicit_accounts",
						visibleAccountIds: this._getSourceCostRecipients({operation, source}),
						payload: {
							operationId: operation.id,
							leg: "source",
							sourceCost: copy(operation.sourceCost),
							resultingSourceCharacterRevision: source.revision,
						},
					});
					this._injectTestResolveStructuredActionFault({stage: "source-event", operation});
					operation.sourceCostEventId = sourceEvent.id;
					source.operationWatermark = sourceEvent.sequence;
					eventIds.push(sourceEvent.id);
				}
				const targetEvent = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: "character.operation.applied",
					aggregateType: "character",
					aggregateId: target.id,
					aggregateRevision: target.revision,
					visibility: "explicit_accounts",
					visibleAccountIds: this._getSemanticRecipients({operation, target}),
					payload: {
						...(operation.sourceCost ? {leg: "target"} : {}),
						operation: derived.operation,
						resultingCharacterRevision: target.revision,
					},
				});
				this._injectTestResolveStructuredActionFault({stage: "target-event", operation});
				operation.appliedEventId = targetEvent.id;
				target.operationWatermark = targetEvent.sequence;
				eventIds.push(targetEvent.id);
			}
			if (operation.status === "applied") {
				const mutatedCharacters = operation.sourceCost ? [source, target] : [target];
				for (const character of [...new Map(mutatedCharacters.map(it => [it.id, it])).values()]
					.sort((left, right) => left.id.localeCompare(right.id))) {
					const invalidation = this._commitCharacterMutation({
						character,
						actorAccountId: accountId,
						isRevisionBump: false,
					});
					this._injectTestResolveStructuredActionFault({stage: "projection-invalidation", operation});
					if (invalidation) eventIds.push(invalidation.id);
				}
			}
		} else {
			operation.status = decision === "reject" ? "rejected" : decision === "cancel" ? "cancelled" : "expired";
		}
		operation.updatedAt = this._fnNow().toISOString();
		operation.resolvedAt = operation.updatedAt;
		this._appendAudit({
			campaignId,
			actorAccountId: decision === "expire" ? null : accountId,
			action: `character.operation.${operation.status}`,
			targetType: "semantic_operation",
			targetId: operation.id,
		});
		this._injectTestResolveStructuredActionFault({stage: "audit", operation});
		if (operation.status !== "applied") {
			const terminalEvent = this._appendEvent({
				campaignId,
				actorAccountId: decision === "expire" ? null : accountId,
				type: `character.operation.${operation.status}`,
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: this._getSemanticRecipients({operation, target}),
				payload: this._getSemanticLifecyclePayload(operation),
			});
			operation.terminalEventId = terminalEvent.id;
			operation.terminalReason = "unavailable";
			eventIds.push(terminalEvent.id);
		}
		const response = {
			operation: this._getSemanticOperationView(operation, {accountId, role: membership.role, source, target}),
			eventIds,
			...(operation.status === "applied"
				? {
					operationWatermark: target.operationWatermark,
					watermarks: this._getSemanticWatermarksForViewer({
						operation,
						accountId,
						role: membership.role,
						source,
						target,
					}),
				}
				: {}),
		};
		const responseOut = this._setSemanticCommand({
			accountId,
			commandId,
			operationId: operation.id,
			commandType,
			idempotencyKey,
			response,
			eventIds: response.eventIds,
		});
		this._injectTestResolveStructuredActionFault({stage: "receipt", operation});
		return responseOut;
	}

	_getMultiTargetKey ({operationId, targetCharacterId}) {
		return `${operationId}::${targetCharacterId}`;
	}

	_getMultiTargetTargets (operationId) {
		return [...this._semanticOperationTargets.values()]
			.filter(target => target.operationId === operationId)
			.sort((left, right) => left.ordinal - right.ordinal);
	}

	_getMultiTargetByInvitation ({operationId, invitationId}) {
		return this._getMultiTargetTargets(operationId)
			.find(target => target.invitationId === invitationId) || null;
	}

	_getMultiTargetOperationView ({operation, accountId, role}) {
		const targets = this._getMultiTargetTargets(operation.id);
		const isDm = ["dm", "co_dm"].includes(role);
		const isSource = operation.originActorAccountId === accountId;
		const isSourceOrDm = isSource || isDm;
		const visibleTargets = (isDm || isSource
			? targets
			: targets.filter(target => target.targetOwnerAccountIdAtProposal === accountId))
			.map(target => ({
				invitationId: target.invitationId,
				status: target.responseState,
				presentation: {
					targetName: target.targetDisplaySnapshot?.identity?.name || "Campaign character",
					effectLabel: operation.effectDisplaySnapshot?.label || "Campaign effect",
				},
				capabilities: {
					canApprove: target.responseState === "pending"
						&& target.targetOwnerAccountIdAtProposal === accountId,
					canReject: target.responseState === "pending"
						&& (target.targetOwnerAccountIdAtProposal === accountId || isDm),
				},
				...((isDm || target.targetOwnerAccountIdAtProposal === accountId) && target.selectionState === "applied"
					? {
						result: {
							changed: target.changed,
							resultingCharacterRevision: target.resultingCharacterRevision,
							legId: target.legId,
							legKind: target.legKind,
							appliedEventId: target.legEventId,
							operation: copy(target.operation),
						},
					}
					: {}),
			}));
		const summary = getMultiTargetOperationSummary({
			operation,
			targets,
			canFinalize: isSource,
			canCancel: isSource || isDm,
		});
		if (!isSourceOrDm) {
			delete summary.candidateCount;
			delete summary.counts;
		}
		const sourceTarget = targets.find(target =>
			target.targetCharacterId === operation.sourceCharacterId
			&& target.selectionState === "applied");
		return {
			...summary,
			sourceCharacterId: isSource || isDm ? operation.sourceCharacterId : undefined,
			...(isSourceOrDm && operation.status === "applied"
				? {
					sourceResult: {
						sourceCharacterId: operation.sourceCharacterId,
						sourceCost: copy(operation.sourceCost),
						resultingSourceCharacterRevision: operation.resultingSourceCharacterRevision,
						appliedEventId: operation.sourceCostEventId,
						legKind: sourceTarget ? "combined" : "source",
						...(sourceTarget
							? {
								legId: sourceTarget.legId,
								operation: copy(sourceTarget.operation),
							}
							: {}),
					},
				}
				: {}),
			targets: visibleTargets,
			finalization: this._semanticOperationFinalizations.get(operation.id)
				? {
					status: this._semanticOperationFinalizations.get(operation.id).resultStatus,
					selectedInvitationIds: isSource || isDm
						? [...this._semanticOperationFinalizations.get(operation.id).selectedInvitationIds]
						: undefined,
				}
				: null,
		};
	}

	_refreshMultiTargetReadiness ({operation, actorAccountId = null}) {
		if (operation.status !== "collecting_responses") return null;
		const targets = this._getMultiTargetTargets(operation.id);
		if (targets.some(target => target.responseState === "pending")) return null;
		operation.status = "awaiting_source_selection";
		operation.readyAt = this._fnNow().toISOString();
		operation.updatedAt = operation.readyAt;
		const event = this._appendEvent({
			campaignId: operation.campaignId,
			actorAccountId,
			type: "character.multi_operation.ready",
			aggregateType: "semantic_operation",
			aggregateId: operation.id,
			visibility: "explicit_accounts",
			visibleAccountIds: getMultiTargetSourceAudience({
				sourceOwnerAccountId: operation.originActorAccountId,
				dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
			}),
			payload: {
				operationId: operation.id,
				status: operation.status,
				approvedCount: targets.filter(target => ["approved", "approved_by_source"].includes(target.responseState)).length,
			},
		});
		operation.readyEventId = event.id;
		return event;
	}

	_expireMultiTargetOperation ({operation, isOperationExpiry = false}) {
		if (!isMultiTargetLiveStatus(operation.status)) return [];
		const now = this._fnNow();
		const eventIds = [];
		for (const target of this._getMultiTargetTargets(operation.id)) {
			if (target.responseState !== "pending") continue;
			target.responseState = "expired";
			target.respondedAt = now.toISOString();
			const event = this._appendEvent({
				campaignId: operation.campaignId,
				actorAccountId: null,
				type: "character.multi_operation.target_responded",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetLegAudience({
					sourceOwnerAccountId: operation.originActorAccountId,
					targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
					dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
				}),
				payload: {
					operationId: operation.id,
					invitationId: target.invitationId,
					status: "expired",
				},
			});
			target.responseEventId = event.id;
			eventIds.push(event.id);
		}
		if (isOperationExpiry || new Date(operation.expiresAt) <= now) {
			operation.status = "expired";
			operation.resolvedAt = now.toISOString();
			operation.updatedAt = operation.resolvedAt;
			const event = this._appendEvent({
				campaignId: operation.campaignId,
				actorAccountId: null,
				type: "character.multi_operation.expired",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetSourceAudience({
					sourceOwnerAccountId: operation.originActorAccountId,
					dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
				}),
				payload: {operationId: operation.id, status: "expired", reason: "unavailable"},
			});
			operation.terminalEventId = event.id;
			eventIds.push(event.id);
		} else {
			const readyEvent = this._refreshMultiTargetReadiness({operation});
			if (readyEvent) eventIds.push(readyEvent.id);
		}
		return eventIds;
	}

	_terminalizeElapsedMultiTarget ({operation}) {
		const now = this._fnNow();
		if (!isMultiTargetLiveStatus(operation.status)) return [];
		if (new Date(operation.expiresAt) <= now) {
			return this._expireMultiTargetOperation({operation, isOperationExpiry: true});
		}
		if (
			operation.status === "collecting_responses"
			&& new Date(operation.collectionClosesAt) <= now
		) return this._expireMultiTargetOperation({operation});
		return [];
	}

	_cancelMultiTargetOperationForLifecycle ({
		operation,
		actorAccountId,
		affectedCharacterIds = new Set(),
		affectedAccountId = null,
		isAll = false,
	}) {
		if (!isMultiTargetLiveStatus(operation.status)) return;
		if (
			isAll
			|| operation.originActorAccountId === affectedAccountId
			|| affectedCharacterIds.has(operation.sourceCharacterId)
		) {
			const now = this._fnNow().toISOString();
			for (const target of this._getMultiTargetTargets(operation.id)) {
				if (!["pending", "approved", "approved_by_source"].includes(target.responseState)) continue;
				const isPending = target.responseState === "pending";
				target.responseState = isPending ? "revoked" : "declined";
				target.selectionState = isPending ? target.selectionState : "declined";
				target.respondedAt = now;
				if (isPending) {
					target.revokedAt = now;
					target.revokeReason = "unavailable";
				}
				const targetEvent = this._appendEvent({
					campaignId: operation.campaignId,
					actorAccountId,
					type: "character.multi_operation.target_responded",
					aggregateType: "semantic_operation",
					aggregateId: operation.id,
					visibility: "explicit_accounts",
					visibleAccountIds: getMultiTargetLegAudience({
						sourceOwnerAccountId: operation.originActorAccountId,
						targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
						dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
					}),
					payload: {
						operationId: operation.id,
						invitationId: target.invitationId,
						status: target.responseState,
						reason: "unavailable",
					},
				});
				target.lifecycleEventId = targetEvent.id;
			}
			operation.status = "cancelled";
			operation.resolvedAt = now;
			operation.updatedAt = operation.resolvedAt;
			const event = this._appendEvent({
				campaignId: operation.campaignId,
				actorAccountId,
				type: "character.multi_operation.cancelled",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetSourceAudience({
					sourceOwnerAccountId: operation.originActorAccountId,
					dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
				}),
				payload: {operationId: operation.id, status: "cancelled", reason: "unavailable"},
			});
			operation.terminalEventId = event.id;
			return;
		}
		for (const target of this._getMultiTargetTargets(operation.id)) {
			if (
				!affectedCharacterIds.has(target.targetCharacterId)
				&& target.targetOwnerAccountIdAtProposal !== affectedAccountId
			) continue;
			if (!["pending", "approved", "approved_by_source"].includes(target.responseState)) continue;
			target.responseState = "revoked";
			target.revokedAt = this._fnNow().toISOString();
			target.respondedAt = target.revokedAt;
			target.revokeReason = "unavailable";
			const event = this._appendEvent({
				campaignId: operation.campaignId,
				actorAccountId,
				type: "character.multi_operation.target_responded",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetLegAudience({
					sourceOwnerAccountId: operation.originActorAccountId,
					targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
					dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
				}),
				payload: {
					operationId: operation.id,
					invitationId: target.invitationId,
					status: "revoked",
					reason: "unavailable",
				},
			});
			target.lifecycleEventId = event.id;
		}
		const targets = this._getMultiTargetTargets(operation.id);
		if (!targets.some(target => ["pending", "approved", "approved_by_source"].includes(target.responseState))) {
			operation.status = "cancelled";
			operation.resolvedAt = this._fnNow().toISOString();
			operation.updatedAt = operation.resolvedAt;
			const event = this._appendEvent({
				campaignId: operation.campaignId,
				actorAccountId,
				type: "character.multi_operation.cancelled",
				aggregateType: "semantic_operation",
				aggregateId: operation.id,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetSourceAudience({
					sourceOwnerAccountId: operation.originActorAccountId,
					dmAccountIds: this._getSemanticDmAccountIds(operation.campaignId),
				}),
				payload: {operationId: operation.id, status: "cancelled", reason: "unavailable"},
			});
			operation.terminalEventId = event.id;
		} else this._refreshMultiTargetReadiness({operation, actorAccountId});
	}

	async pCreateMultiTargetOperation (args) {
		assertMultiTargetProtocol(args);
		const targetRefs = assertMultiTargetCandidateRefs(args.targetRefs);
		const targets = targetRefs.map(targetRef => [...this._characters.values()].find(character =>
			character.campaignId === args.campaignId
			&& character.status === "active"
			&& character.targetRef === targetRef,
		)).filter(Boolean);
		const ownerAccountIds = [...new Set(targets.map(target => target.ownerAccountId))].sort();
		return this._pWithMemoryLocks({
			keys: [
				`1:command:${args.commandId}`,
				...ownerAccountIds.map(accountId => `2:quota:${accountId}`),
				`2:quota:${args.accountId}`,
				`3:campaign:${args.campaignId}`,
				...targets.map(target => `6:character:${target.id}`),
				`6:character:${args.sourceCharacterId}`,
			],
			fn: () => {
				const transaction = this._createSourceCostAcceptanceTransactionStore();
				const response = transaction.transactionStore._pCreateMultiTargetOperationBody(args);
				this._publishSourceCostAcceptanceTransactionStore(transaction);
				return response;
			},
		});
	}

	_pCreateMultiTargetOperationBody ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		sourceCharacterId,
		sourceEntity,
		effectTemplateId,
		choice,
		targetRefs,
		rulesVersionId,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		const membership = this._getMembership({accountId, campaignId, roles: ["player"]});
		const campaign = this._campaigns.get(campaignId);
		if (!this._isMultiTargetOperationsEnabled(campaignId)) {
			throw new HubStoreError("CAPABILITY_UNAVAILABLE", `Multi-target operations are unavailable.`, {status: 409});
		}
		const source = this._getCharacterOrThrow(sourceCharacterId);
		if (
			source.ownerAccountId !== accountId
			|| source.campaignId !== campaignId
			|| source.status !== "active"
		) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		const candidateRefs = assertMultiTargetCandidateRefs(targetRefs);
		const targets = candidateRefs.map(targetRef => [...this._characters.values()].find(character =>
			character.campaignId === campaignId
			&& character.status === "active"
			&& character.targetRef === targetRef,
		));
		if (targets.some(target => !target)) {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		assertUniqueResolvedTargets(targets);
		for (const target of targets) {
			const targetMembership = this._memberships.get(`${campaignId}::${target.ownerAccountId}`);
			if (targetMembership?.status !== "active" || targetMembership.role !== "player") {
				throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
			}
			try {
				this._assertTargetable({character: target, accountId, role: membership.role});
			} catch {
				throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
			}
		}
		const liveOperations = [...this._semanticOperations.values()]
			.filter(operation => operation.targetSetVersion === 1 && isMultiTargetLiveStatus(operation.status));
		if (
			liveOperations.filter(operation => operation.originActorAccountId === accountId).length >= 5
			|| liveOperations.filter(operation => operation.campaignId === campaignId).length >= 50
			|| liveOperations.filter(operation => operation.sourceCharacterId === sourceCharacterId).length >= 3
		) throw new HubStoreError("COLLECTION_LIMIT_REACHED", `The collection limit was reached.`, {status: 409});
		for (const ownerAccountId of new Set(targets.map(target => target.ownerAccountId))) {
			const pending = [...this._semanticOperationTargets.values()].filter(target =>
				target.targetOwnerAccountIdAtProposal === ownerAccountId
				&& target.responseState === "pending"
				&& isMultiTargetLiveStatus(this._semanticOperations.get(target.operationId)?.status),
			).length;
			const additions = targets.filter(target => target.ownerAccountId === ownerAccountId && ownerAccountId !== accountId).length;
			if (pending + additions > 20) {
				throw new HubStoreError("COLLECTION_LIMIT_REACHED", `The collection limit was reached.`, {status: 409});
			}
		}
		const rulesVersion = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		const brewBundle = campaign.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		const rulesPin = getPeerSourceCostsRulesPin({rulesVersion, brewBundle});
		if (!rulesPin || rulesPin.rulesVersionId !== rulesVersionId) {
			throw new HubStoreError("POLICY_VERSION_STALE", `Campaign rules changed.`, {status: 409});
		}
		if (!this._semanticOperationRegistry.isMultiTarget({sourceEntity, effectTemplateId})) {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		const operationId = crypto.randomUUID();
		const effectResolutionSeed = crypto.randomBytes(32).toString("hex");
		const derived = this._semanticOperationRegistry.deriveMultiTarget({
			sourceCharacter: source,
			targetCharacters: targets,
			targetRefs: candidateRefs,
			sourceEntity,
			effectTemplateId,
			choice,
			sourceProfile: computePeerProfile({character: source}),
			targetProfiles: targets.map(target => computePeerProfile({character: target})),
			operationId,
			effectResolutionSeed,
		});
		const now = this._fnNow();
		const operation = {
			id: operationId,
			campaignId,
			originActorAccountId: accountId,
			sourceCharacterId,
			targetCharacterId: null,
			targetSetVersion: 1,
			candidateCount: targets.length,
			status: "collecting_responses",
			version: 1,
			sourceEntity: copy(derived.sourceEntity),
			effectTemplateId: derived.effectTemplateId,
			choice: copy(derived.choice),
			sourceDisplaySnapshot: copy(derived.sourceDisplaySnapshot),
			effectDisplaySnapshot: copy(derived.effectDisplaySnapshot),
			sourceCostVersion: derived.sourceCost.version,
			sourceCost: copy(derived.sourceCost),
			rulesVersionId: rulesPin.rulesVersionId,
			rulesPin: copy(rulesPin),
			templateRegistryVersion: MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
			effectResolutionSeed,
			sourceRevisionObserved: source.revision,
			sourceCostInvalidated: false,
			allowTargetNoOp: derived.allowTargetNoOp,
			collectionClosesAt: new Date(now.getTime() + this._multiTargetCollectionTtlMs).toISOString(),
			expiresAt: new Date(now.getTime() + this._multiTargetOperationTtlMs).toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		};
		this._semanticOperations.set(operationId, operation);
		const dmAccountIds = this._getSemanticDmAccountIds(campaignId);
		const eventIds = [];
		const proposedEvent = this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "character.multi_operation.proposed",
			aggregateType: "semantic_operation",
			aggregateId: operationId,
			visibility: "explicit_accounts",
			visibleAccountIds: getMultiTargetSourceAudience({
				sourceOwnerAccountId: accountId,
				dmAccountIds,
			}),
			payload: {
				operationId,
				status: operation.status,
				candidateCount: targets.length,
				collectionClosesAt: operation.collectionClosesAt,
				expiresAt: operation.expiresAt,
				effectDisplaySnapshot: copy(operation.effectDisplaySnapshot),
			},
		});
		operation.createdEventId = proposedEvent.id;
		eventIds.push(proposedEvent.id);
		for (let index = 0; index < targets.length; ++index) {
			const target = targets[index];
			const derivedTarget = derived.targets[index];
			const row = {
				operationId,
				campaignId,
				targetCharacterId: target.id,
				invitationId: crypto.randomUUID(),
				ordinal: index + 1,
				targetRef: target.targetRef,
				targetOwnerAccountIdAtProposal: target.ownerAccountId,
				targetDisplaySnapshot: copy(derivedTarget.targetDisplaySnapshot),
				operation: copy(derivedTarget.operation),
				targetRevisionObserved: target.revision,
				responseState: target.ownerAccountId === accountId ? "approved_by_source" : "pending",
				responseActorAccountId: target.ownerAccountId === accountId ? accountId : null,
				respondedAt: target.ownerAccountId === accountId ? now.toISOString() : null,
				selectionState: "unselected",
				selectionIndex: null,
				changed: null,
				resultingCharacterRevision: null,
				legId: null,
				legKind: null,
				legEventId: null,
			};
			this._semanticOperationTargets.set(this._getMultiTargetKey(row), row);
			const invitationEvent = this._appendEvent({
				campaignId,
				actorAccountId: accountId,
				type: "character.multi_operation.target_requested",
				aggregateType: "semantic_operation",
				aggregateId: operationId,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetLegAudience({
					sourceOwnerAccountId: accountId,
					targetOwnerAccountId: target.ownerAccountId,
					dmAccountIds,
				}),
				payload: {
					operationId,
					invitationId: row.invitationId,
					status: row.responseState,
					effectDisplaySnapshot: copy(operation.effectDisplaySnapshot),
					targetDisplaySnapshot: copy(row.targetDisplaySnapshot),
					collectionClosesAt: operation.collectionClosesAt,
				},
			});
			row.invitationEventId = invitationEvent.id;
			eventIds.push(invitationEvent.id);
		}
		this._semanticMultiTargetUsage ||= {
			firstUsedAt: now.toISOString(),
			firstOperationId: operationId,
		};
		this._multiTargetCampaignUsage.add(campaignId);
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "character.multi_operation.proposed",
			targetType: "semantic_operation",
			targetId: operationId,
			details: {
				contractVersion: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
				candidateCount: targets.length,
				templateRegistryVersion: MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
			},
		});
		const readyEvent = this._refreshMultiTargetReadiness({operation, actorAccountId: accountId});
		if (readyEvent) eventIds.push(readyEvent.id);
		const response = {
			operation: this._getMultiTargetOperationView({
				operation,
				accountId,
				role: membership.role,
			}),
			eventIds,
		};
		return this._setSemanticCommand({
			accountId,
			commandId,
			operationId,
			commandType: "create_multi_target_proposal",
			idempotencyKey,
			response,
			eventIds,
		});
	}

	async pRespondMultiTargetInvitation (args) {
		assertMultiTargetProtocol(args);
		return this._pWithMemoryLocks({
			keys: [
				`1:command:${args.commandId}`,
				`3:campaign:${args.campaignId}`,
				`4:parent:${args.operationId}`,
				`5:invitation:${args.invitationId}`,
			],
			fn: () => {
				const transaction = this._createSourceCostAcceptanceTransactionStore();
				const response = transaction.transactionStore._pRespondMultiTargetInvitationBody(args);
				this._publishSourceCostAcceptanceTransactionStore(transaction);
				return response;
			},
		});
	}

	_pRespondMultiTargetInvitationBody ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		operationId,
		invitationId,
		decision,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		if (!["approve", "reject"].includes(decision)) {
			throw new HubStoreError("INVALID_REQUEST", `The response decision is invalid.`, {status: 400});
		}
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		const operation = this._semanticOperations.get(operationId);
		const target = this._getMultiTargetByInvitation({operationId, invitationId});
		if (
			!operation
			|| operation.campaignId !== campaignId
			|| operation.targetSetVersion !== 1
			|| !target
		) throw new HubStoreError("ACTION_NOT_FOUND", `Invitation was not found.`, {status: 404});
		const elapsedEventIds = this._terminalizeElapsedMultiTarget({operation});
		const isDm = ["dm", "co_dm"].includes(membership.role);
		const isOwner = target.targetOwnerAccountIdAtProposal === accountId;
		if (!isOwner && !isDm) throw new HubStoreError("ACTION_NOT_FOUND", `Invitation was not found.`, {status: 404});
		if (decision === "approve" && (!isOwner || membership.role !== "player")) {
			throw new HubStoreError("OPERATION_FORBIDDEN", `Only the target owner may approve.`, {status: 403});
		}
		if (target.responseState !== "pending") {
			const response = {
				operation: this._getMultiTargetOperationView({operation, accountId, role: membership.role}),
				invitation: this._getMultiTargetOperationView({operation, accountId, role: membership.role})
					.targets.find(it => it.invitationId === invitationId),
				eventIds: [...new Set([
					...elapsedEventIds,
					target.responseEventId,
				].filter(Boolean))],
			};
			return this._setSemanticCommand({
				accountId,
				commandId,
				operationId,
				commandType: "respond_multi_target",
				idempotencyKey,
				response,
				eventIds: response.eventIds,
			});
		}
		target.responseState = decision === "approve" ? "approved" : "rejected";
		target.responseActorAccountId = accountId;
		target.responseCommandId = commandId;
		target.respondedAt = this._fnNow().toISOString();
		const responseEvent = this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "character.multi_operation.target_responded",
			aggregateType: "semantic_operation",
			aggregateId: operationId,
			visibility: "explicit_accounts",
			visibleAccountIds: getMultiTargetLegAudience({
				sourceOwnerAccountId: operation.originActorAccountId,
				targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
				dmAccountIds: this._getSemanticDmAccountIds(campaignId),
			}),
			payload: {
				operationId,
				invitationId,
				status: target.responseState,
			},
		});
		target.responseEventId = responseEvent.id;
		const readyEvent = this._refreshMultiTargetReadiness({operation, actorAccountId: accountId});
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: `character.multi_operation.${target.responseState}`,
			targetType: "semantic_operation",
			targetId: operationId,
		});
		const eventIds = [responseEvent.id, readyEvent?.id].filter(Boolean);
		const response = {
			operation: this._getMultiTargetOperationView({operation, accountId, role: membership.role}),
			invitation: this._getMultiTargetOperationView({operation, accountId, role: membership.role})
				.targets.find(it => it.invitationId === invitationId),
			eventIds,
		};
		return this._setSemanticCommand({
			accountId,
			commandId,
			operationId,
			commandType: "respond_multi_target",
			idempotencyKey,
			response,
			eventIds,
		});
	}

	async pFinalizeMultiTargetOperation (args) {
		assertMultiTargetProtocol(args);
		assertUniqueSelection(args.selectedInvitationIds);
		const operation = this._semanticOperations.get(args.operationId);
		const targets = operation ? this._getMultiTargetTargets(operation.id) : [];
		const selected = new Set(args.selectedInvitationIds);
		const characterIds = [
			operation?.sourceCharacterId,
			...targets.filter(target => selected.has(target.invitationId)).map(target => target.targetCharacterId),
		].filter(Boolean);
		return this._pWithMemoryLocks({
			keys: [
				`1:command:${args.commandId}`,
				`3:campaign:${args.campaignId}`,
				`4:parent:${args.operationId}`,
				...targets.map(target => `5:target:${args.operationId}:${target.targetCharacterId}`),
				...characterIds.map(id => `6:character:${id}`),
			],
			fn: () => {
				const transaction = this._createSourceCostAcceptanceTransactionStore();
				const response = transaction.transactionStore._pFinalizeMultiTargetOperationBody(args);
				this._publishSourceCostAcceptanceTransactionStore(transaction);
				return response;
			},
		});
	}

	_pFinalizeMultiTargetOperationBody ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		operationId,
		selectedInvitationIds,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["player"],
			isRequireActiveCampaign: false,
		});
		const operation = this._semanticOperations.get(operationId);
		if (
			!operation
			|| operation.campaignId !== campaignId
			|| operation.targetSetVersion !== 1
			|| operation.originActorAccountId !== accountId
		) throw new HubStoreError("ACTION_NOT_FOUND", `Operation was not found.`, {status: 404});
		const elapsedEventIds = this._terminalizeElapsedMultiTarget({operation});
		if (operation.status !== "awaiting_source_selection") {
			if (!isMultiTargetLiveStatus(operation.status)) {
				const response = {
					operation: this._getMultiTargetOperationView({operation, accountId, role: membership.role}),
					eventIds: [...new Set([
						...elapsedEventIds,
						operation.sourceCostEventId,
						operation.terminalEventId,
						operation.finalizedEventId,
					].filter(Boolean))],
				};
				return this._setSemanticCommand({
					accountId,
					commandId,
					operationId,
					commandType: "finalize_multi_target",
					idempotencyKey,
					response,
					eventIds: response.eventIds,
				});
			}
			throw new HubStoreError("COLLECTION_NOT_READY", `The operation is still collecting responses.`, {status: 409});
		}
		const orderedSelection = assertUniqueSelection(selectedInvitationIds);
		const targets = this._getMultiTargetTargets(operationId);
		const selectedTargets = orderedSelection.map(invitationId =>
			targets.find(target => target.invitationId === invitationId),
		);
		if (
			selectedTargets.some(target => !target)
			|| selectedTargets.some(target => !["approved", "approved_by_source"].includes(target.responseState))
		) throw new HubStoreError("FINALIZATION_SELECTION_INVALID", `The final selection is invalid.`, {status: 409});
		const now = this._fnNow();
		const eventIds = [...elapsedEventIds];
		if (!orderedSelection.length) {
			for (const target of targets) {
				if (!["approved", "approved_by_source"].includes(target.responseState)) continue;
				target.responseState = "declined";
				target.selectionState = "declined";
				target.respondedAt = now.toISOString();
				const declinedEvent = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: "character.multi_operation.target_responded",
					aggregateType: "semantic_operation",
					aggregateId: operationId,
					visibility: "explicit_accounts",
					visibleAccountIds: getMultiTargetLegAudience({
						sourceOwnerAccountId: accountId,
						targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
						dmAccountIds: this._getSemanticDmAccountIds(campaignId),
					}),
					payload: {
						operationId,
						invitationId: target.invitationId,
						status: "declined",
					},
				});
				target.lifecycleEventId = declinedEvent.id;
				eventIds.push(declinedEvent.id);
			}
			operation.status = "cancelled";
			operation.resolvedAt = now.toISOString();
			operation.updatedAt = operation.resolvedAt;
			const terminal = this._appendEvent({
				campaignId,
				actorAccountId: accountId,
				type: "character.multi_operation.cancelled",
				aggregateType: "semantic_operation",
				aggregateId: operationId,
				visibility: "explicit_accounts",
				visibleAccountIds: getMultiTargetSourceAudience({
					sourceOwnerAccountId: accountId,
					dmAccountIds: this._getSemanticDmAccountIds(campaignId),
				}),
				payload: {operationId, status: "cancelled", reason: "empty_selection"},
			});
			operation.terminalEventId = terminal.id;
			eventIds.push(terminal.id);
			this._semanticOperationFinalizations.set(operationId, {
				operationId,
				commandId,
				actorAccountId: accountId,
				selectedInvitationIds: [],
				resultStatus: "cancelled",
				createdAt: now.toISOString(),
			});
		} else {
			const source = this._characters.get(operation.sourceCharacterId);
			const selectedCharacters = selectedTargets.map(target => this._characters.get(target.targetCharacterId));
			let privateFailureCode = null;
			if (
				!source
				|| source.status !== "active"
				|| source.campaignId !== campaignId
				|| source.ownerAccountId !== accountId
			) privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			const isTargetAuthorityInvalid = selectedCharacters.some((character, index) => {
				const target = selectedTargets[index];
				const targetMembership = character
					? this._memberships.get(`${campaignId}::${character.ownerAccountId}`)
					: null;
				if (
					!character
					|| character.status !== "active"
					|| character.campaignId !== campaignId
					|| character.targetRef !== target.targetRef
					|| character.ownerAccountId !== target.targetOwnerAccountIdAtProposal
					|| targetMembership?.status !== "active"
					|| targetMembership.role !== "player"
				) return true;
				try {
					this._assertTargetable({
						character,
						accountId: operation.originActorAccountId,
						role: "player",
					});
					return false;
				} catch {
					return true;
				}
			});
			if (!privateFailureCode && isTargetAuthorityInvalid) {
				throw new HubStoreError("FINALIZATION_SELECTION_INVALID", `The final selection is invalid.`, {status: 409});
			}
			const campaign = this._campaigns.get(campaignId);
			const rulesVersion = campaign?.activeRulesVersionId
				? this._rulesVersions.get(campaign.activeRulesVersionId)
				: null;
			const brewBundle = campaign?.activeBrewBundleVersionId
				? this._brewVersions.get(campaign.activeBrewBundleVersionId)
				: null;
			const currentPin = getPeerSourceCostsRulesPin({rulesVersion, brewBundle});
			if (
				!privateFailureCode
				&& (
					!this._isMultiTargetOperationsEnabled(campaignId)
					|| operation.templateRegistryVersion !== MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION
					|| !isCanonicalEqual(operation.rulesPin, currentPin)
				)
			) privateFailureCode = "POLICY_VERSION_STALE";
			if (!privateFailureCode && operation.sourceCostInvalidated) {
				privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			}
			let derived;
			if (!privateFailureCode) {
				try {
					derived = this._semanticOperationRegistry.deriveMultiTarget({
						sourceCharacter: source,
						targetCharacters: selectedCharacters,
						targetRefs: selectedTargets.map(target => target.targetRef),
						sourceEntity: operation.sourceEntity,
						effectTemplateId: operation.effectTemplateId,
						choice: operation.choice,
						sourceProfile: computePeerProfile({character: source}),
						targetProfiles: selectedCharacters.map(character => computePeerProfile({character})),
						operationId,
						effectResolutionSeed: operation.effectResolutionSeed,
					});
				} catch (error) {
					privateFailureCode = getPrivateAcceptanceFailureCode(error);
					if (!privateFailureCode) throw error;
				}
			}
			if (
				!privateFailureCode
				&& (
					!isCanonicalEqual(derived.sourceCost, operation.sourceCost)
					|| !isCanonicalEqual(derived.sourceEntity, operation.sourceEntity)
					|| derived.effectTemplateId !== operation.effectTemplateId
					|| !isCanonicalEqual(derived.choice, operation.choice)
					|| derived.targets.some((derivedTarget, index) =>
						!isCanonicalEqual(derivedTarget.operation, selectedTargets[index].operation))
				)
			) privateFailureCode = "SOURCE_COST_UNAVAILABLE";
			const nextDataByCharacterId = new Map();
			const legResults = [];
			if (!privateFailureCode) {
				try {
					const sourceNextData = applySourceCost({
						data: source.data,
						sourceCost: operation.sourceCost,
					}).data;
					validateCloudCharacterData(sourceNextData);
					nextDataByCharacterId.set(
						source.id,
						sourceNextData,
					);
				} catch (error) {
					privateFailureCode = getPrivateAcceptanceFailureCode(error);
					if (!privateFailureCode) throw error;
				}
			}
			if (!privateFailureCode) {
				try {
					for (let index = 0; index < selectedTargets.length; ++index) {
						const target = selectedTargets[index];
						const character = selectedCharacters[index];
						const baseData = nextDataByCharacterId.get(character.id) ?? character.data;
						const result = applySemanticOperationWithResult({
							data: baseData,
							operation: target.operation,
						});
						if (!result.changed && !operation.allowTargetNoOp) {
							throw new HubStoreError("TARGET_EFFECT_UNAVAILABLE", `The target effect is unavailable.`, {status: 409});
						}
						if (result.changed) nextDataByCharacterId.set(character.id, result.data);
						legResults.push({target, character, changed: result.changed});
					}
					for (const [characterId, data] of nextDataByCharacterId) {
						validateCloudCharacterData(data);
						if (!this._characters.has(characterId)) throw new Error(`Missing character.`);
					}
				} catch (error) {
					privateFailureCode = getPrivateAcceptanceFailureCode(error, {leg: "target"});
					if (!privateFailureCode) throw error;
				}
			}
			if (privateFailureCode) {
				operation.status = "failed";
				operation.privateFailureCode = privateFailureCode;
				operation.resolvedAt = now.toISOString();
				operation.updatedAt = operation.resolvedAt;
				const terminal = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: "character.multi_operation.failed",
					aggregateType: "semantic_operation",
					aggregateId: operationId,
					visibility: "explicit_accounts",
					visibleAccountIds: getMultiTargetSourceAudience({
						sourceOwnerAccountId: accountId,
						dmAccountIds: this._getSemanticDmAccountIds(campaignId),
					}),
					payload: {operationId, status: "failed", reason: "unavailable"},
				});
				operation.terminalEventId = terminal.id;
				eventIds.push(terminal.id);
				this._semanticOperationFinalizations.set(operationId, {
					operationId,
					commandId,
					actorAccountId: accountId,
					selectedInvitationIds: orderedSelection,
					resultStatus: "failed",
					createdAt: now.toISOString(),
				});
			} else {
				const changedCharacterIds = [...nextDataByCharacterId.keys()].sort();
				for (const [index, characterId] of changedCharacterIds.entries()) {
					const character = this._characters.get(characterId);
					this._setCharacterData({character, data: nextDataByCharacterId.get(characterId)});
					character.revision++;
					character.updatedAt = now.toISOString();
					this._injectTestMultiTargetFault({
						stage: "character-write",
						operation,
						details: {index, characterId},
					});
				}
				const declinedTargets = [];
				for (const target of targets) {
					const selectedIndex = selectedTargets.indexOf(target);
					if (selectedIndex === -1) {
						if (["approved", "approved_by_source"].includes(target.responseState)) {
							target.responseState = "declined";
							target.selectionState = "declined";
							target.respondedAt = now.toISOString();
							declinedTargets.push(target);
						}
						continue;
					}
					target.selectionIndex = selectedIndex + 1;
					target.selectionState = "applied";
				}
				const sourceIsSelected = selectedTargets.some(target => target.targetCharacterId === source.id);
				const sourceSelectedLeg = sourceIsSelected
					? legResults.find(result => result.target.targetCharacterId === source.id)
					: null;
				const combinedLegId = sourceIsSelected ? crypto.randomUUID() : null;
				const sourceEvent = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: sourceIsSelected
						? "character.multi_operation.target_applied"
						: "character.multi_operation.source_cost_consumed",
					aggregateType: "character",
					aggregateId: source.id,
					aggregateRevision: source.revision,
					visibility: "explicit_accounts",
					visibleAccountIds: getMultiTargetSourceAudience({
						sourceOwnerAccountId: accountId,
						dmAccountIds: this._getSemanticDmAccountIds(campaignId),
					}),
					payload: {
						operationId,
						_sourceOwnerAccountId: accountId,
						_targetOwnerAccountId: source.ownerAccountId,
						leg: sourceIsSelected ? "combined" : "source",
						sourceCost: copy(operation.sourceCost),
						resultingSourceCharacterRevision: source.revision,
						...(sourceSelectedLeg
							? {
								invitationId: sourceSelectedLeg.target.invitationId,
								legId: combinedLegId,
								operation: copy(sourceSelectedLeg.target.operation),
								resultingCharacterRevision: source.revision,
								changed: sourceSelectedLeg.changed,
							}
							: {}),
					},
				});
				operation.sourceCostEventId = sourceEvent.id;
				operation.resultingSourceCharacterRevision = source.revision;
				source.operationWatermark = sourceEvent.sequence;
				eventIds.push(sourceEvent.id);
				this._injectTestMultiTargetFault({stage: "source-event", operation});
				const legResultByTargetId = new Map(
					legResults.map(result => [result.target.targetCharacterId, result]),
				);
				const declinedTargetIds = new Set(declinedTargets.map(target => target.targetCharacterId));
				for (const target of targets) {
					const legResult = legResultByTargetId.get(target.targetCharacterId);
					if (!legResult) {
						if (!declinedTargetIds.has(target.targetCharacterId)) continue;
						const declinedEvent = this._appendEvent({
							campaignId,
							actorAccountId: accountId,
							type: "character.multi_operation.target_responded",
							aggregateType: "semantic_operation",
							aggregateId: operationId,
							visibility: "explicit_accounts",
							visibleAccountIds: getMultiTargetLegAudience({
								sourceOwnerAccountId: accountId,
								targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
								dmAccountIds: this._getSemanticDmAccountIds(campaignId),
							}),
							payload: {
								operationId,
								invitationId: target.invitationId,
								status: "declined",
							},
						});
						target.lifecycleEventId = declinedEvent.id;
						eventIds.push(declinedEvent.id);
						continue;
					}
					const {character, changed} = legResult;
					const isCombined = character.id === source.id;
					if (isCombined) {
						target.changed = changed;
						target.resultingCharacterRevision = source.revision;
						target.legId = combinedLegId;
						target.legKind = "combined";
						target.legEventId = sourceEvent.id;
						continue;
					}
					const event = this._appendEvent({
						campaignId,
						actorAccountId: accountId,
						type: "character.multi_operation.target_applied",
						aggregateType: "character",
						aggregateId: character.id,
						aggregateRevision: changed || isCombined ? character.revision : null,
						visibility: "explicit_accounts",
						visibleAccountIds: getMultiTargetLegAudience({
							sourceOwnerAccountId: accountId,
							targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
							dmAccountIds: this._getSemanticDmAccountIds(campaignId),
						}),
						payload: {
							operationId,
							_sourceOwnerAccountId: accountId,
							_targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,
							invitationId: target.invitationId,
							legId: crypto.randomUUID(),
							leg: "target",
							operation: copy(target.operation),
							...(changed || isCombined ? {resultingCharacterRevision: character.revision} : {}),
							changed,
						},
					});
					target.changed = changed;
					target.resultingCharacterRevision = changed ? character.revision : null;
					target.legId = event.payload.legId;
					target.legKind = event.payload.leg;
					target.legEventId = event.id;
					if (changed) character.operationWatermark = event.sequence;
					eventIds.push(event.id);
					this._injectTestMultiTargetFault({
						stage: "target-event",
						operation,
						details: {ordinal: target.ordinal},
					});
				}
				const finalizedEvent = this._appendEvent({
					campaignId,
					actorAccountId: accountId,
					type: "character.multi_operation.finalized",
					aggregateType: "semantic_operation",
					aggregateId: operationId,
					visibility: "explicit_accounts",
					visibleAccountIds: getMultiTargetSourceAudience({
						sourceOwnerAccountId: accountId,
						dmAccountIds: this._getSemanticDmAccountIds(campaignId),
					}),
					payload: {
						operationId,
						status: "applied",
						selectedCount: selectedTargets.length,
						sourceEventId: sourceEvent.id,
					},
				});
				operation.finalizedEventId = finalizedEvent.id;
				eventIds.push(finalizedEvent.id);
				const invalidationAudience = new Set();
				for (const characterId of changedCharacterIds) {
					const character = this._characters.get(characterId);
					for (const recipient of this._getProjectionInvalidationRecipients({character})) {
						invalidationAudience.add(recipient);
					}
				}
				if (invalidationAudience.size) {
					const invalidation = this._appendEvent({
						campaignId,
						actorAccountId: accountId,
						type: "character.projection.invalidated",
						aggregateType: "campaign",
						aggregateId: campaignId,
						visibility: "explicit_accounts",
						visibleAccountIds: [...invalidationAudience].sort(),
						payload: {},
					});
					eventIds.push(invalidation.id);
					this._injectTestMultiTargetFault({stage: "projection-invalidation", operation});
				}
				operation.status = "applied";
				operation.resolvedAt = now.toISOString();
				operation.updatedAt = operation.resolvedAt;
				this._semanticOperationFinalizations.set(operationId, {
					operationId,
					commandId,
					actorAccountId: accountId,
					selectedInvitationIds: orderedSelection,
					resultStatus: "applied",
					sourceLegEventId: sourceEvent.id,
					createdAt: now.toISOString(),
				});
			}
		}
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: `character.multi_operation.${operation.status}`,
			targetType: "semantic_operation",
			targetId: operationId,
			details: {
				selectedCount: selectedInvitationIds.length,
				contractVersion: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
			},
		});
		this._injectTestMultiTargetFault({stage: "audit", operation});
		const response = {
			operation: this._getMultiTargetOperationView({operation, accountId, role: membership.role}),
			eventIds,
		};
		const responseOut = this._setSemanticCommand({
			accountId,
			commandId,
			operationId,
			commandType: "finalize_multi_target",
			idempotencyKey,
			response,
			eventIds,
		});
		this._injectTestMultiTargetFault({stage: "receipt", operation});
		return responseOut;
	}

	async pCancelMultiTargetOperation (args) {
		assertMultiTargetProtocol(args);
		return this._pWithMemoryLocks({
			keys: [
				`1:command:${args.commandId}`,
				`3:campaign:${args.campaignId}`,
				`4:parent:${args.operationId}`,
			],
			fn: () => {
				const transaction = this._createSourceCostAcceptanceTransactionStore();
				const response = transaction.transactionStore._pCancelMultiTargetOperationBody(args);
				this._publishSourceCostAcceptanceTransactionStore(transaction);
				return response;
			},
		});
	}

	_pCancelMultiTargetOperationBody ({
		accountId,
		sessionId,
		campaignId,
		commandId,
		operationId,
		idempotencyKey,
	}) {
		const prior = this._getSemanticCommand({accountId, commandId, idempotencyKey});
		this._assertSemanticSession({accountId, sessionId});
		if (prior) return prior;
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		const operation = this._semanticOperations.get(operationId);
		if (!operation || operation.campaignId !== campaignId || operation.targetSetVersion !== 1) {
			throw new HubStoreError("ACTION_NOT_FOUND", `Operation was not found.`, {status: 404});
		}
		const isDm = ["dm", "co_dm"].includes(membership.role);
		if (!isDm && operation.originActorAccountId !== accountId) {
			throw new HubStoreError("ACTION_NOT_FOUND", `Operation was not found.`, {status: 404});
		}
		const eventStart = this._events.length;
		this._terminalizeElapsedMultiTarget({operation});
		if (isMultiTargetLiveStatus(operation.status)) {
			this._cancelMultiTargetOperationForLifecycle({
				operation,
				actorAccountId: accountId,
				isAll: true,
			});
			this._appendAudit({
				campaignId,
				actorAccountId: accountId,
				action: "character.multi_operation.cancelled",
				targetType: "semantic_operation",
				targetId: operation.id,
			});
		}
		const eventIds = this._events.slice(eventStart).map(event => event.id);
		const response = {
			operation: this._getMultiTargetOperationView({
				operation,
				accountId,
				role: membership.role,
			}),
			eventIds,
		};
		return this._setSemanticCommand({
			accountId,
			commandId,
			operationId,
			commandType: "cancel_multi_target",
			idempotencyKey,
			response,
			eventIds,
		});
	}

	async pListMultiTargetInbox ({
		accountId,
		campaignId,
		cursor = null,
		limit = MULTI_TARGET_PAGE_LIMIT,
	}) {
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		await this.pExpireMultiTargetOperations({campaignId, limit: MULTI_TARGET_PAGE_LIMIT});
		const after = parseMultiTargetCursor(cursor, 3);
		const rows = [...this._semanticOperationTargets.values()]
			.filter(target => target.campaignId === campaignId)
			.filter(target => ["dm", "co_dm"].includes(membership.role)
				|| target.targetOwnerAccountIdAtProposal === accountId)
			.filter(target => target.responseState === "pending")
			.map(target => ({target, operation: this._semanticOperations.get(target.operationId)}))
			.filter(({operation}) => operation && isMultiTargetLiveStatus(operation.status))
			.sort((left, right) => (
				left.operation.collectionClosesAt.localeCompare(right.operation.collectionClosesAt)
				|| left.operation.id.localeCompare(right.operation.id)
				|| left.target.targetCharacterId.localeCompare(right.target.targetCharacterId)
			))
			.filter(({target, operation}) => !after || [
				operation.collectionClosesAt,
				operation.id,
				target.targetCharacterId,
			].join("\u0000") > after.join("\u0000"));
		const page = rows.slice(0, Math.min(limit, MULTI_TARGET_PAGE_LIMIT));
		return {
			invitations: page.map(({target, operation}) => ({
				operationId: operation.id,
				invitationId: target.invitationId,
				status: target.responseState,
				collectionClosesAt: operation.collectionClosesAt,
				expiresAt: operation.expiresAt,
				presentation: {
					targetName: target.targetDisplaySnapshot?.identity?.name || "Campaign character",
					effectLabel: operation.effectDisplaySnapshot?.label || "Campaign effect",
				},
				capabilities: {canApprove: target.targetOwnerAccountIdAtProposal === accountId, canReject: true},
			})),
			nextCursor: rows.length > page.length && page.length
				? getMultiTargetCursor([
					page.at(-1).operation.collectionClosesAt,
					page.at(-1).operation.id,
					page.at(-1).target.targetCharacterId,
				])
				: null,
		};
	}

	async pListMultiTargetOutgoing ({
		accountId,
		campaignId,
		cursor = null,
		limit = MULTI_TARGET_PAGE_LIMIT,
	}) {
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		await this.pExpireMultiTargetOperations({campaignId, limit: MULTI_TARGET_PAGE_LIMIT});
		const after = parseMultiTargetCursor(cursor, 2);
		const rows = [...this._semanticOperations.values()]
			.filter(operation => operation.campaignId === campaignId && operation.targetSetVersion === 1)
			.filter(operation => ["dm", "co_dm"].includes(membership.role) || operation.originActorAccountId === accountId)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
			.filter(operation => !after || [operation.createdAt, operation.id].join("\u0000") > after.join("\u0000"));
		const page = rows.slice(0, Math.min(limit, MULTI_TARGET_PAGE_LIMIT));
		return {
			operations: page.map(operation => this._getMultiTargetOperationView({
				operation,
				accountId,
				role: membership.role,
			})),
			nextCursor: rows.length > page.length && page.length
				? getMultiTargetCursor([page.at(-1).createdAt, page.at(-1).id])
				: null,
		};
	}

	async pGetMultiTargetOperation ({accountId, campaignId, operationId}) {
		const membership = this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		const operation = this._semanticOperations.get(operationId);
		if (!operation || operation.campaignId !== campaignId || operation.targetSetVersion !== 1) {
			throw new HubStoreError("ACTION_NOT_FOUND", `Operation was not found.`, {status: 404});
		}
		const isParticipant = operation.originActorAccountId === accountId
			|| this._getMultiTargetTargets(operationId)
				.some(target => target.targetOwnerAccountIdAtProposal === accountId);
		if (!isParticipant && !["dm", "co_dm"].includes(membership.role)) {
			throw new HubStoreError("ACTION_NOT_FOUND", `Operation was not found.`, {status: 404});
		}
		this._terminalizeElapsedMultiTarget({operation});
		return {operation: this._getMultiTargetOperationView({operation, accountId, role: membership.role})};
	}

	async pExpireMultiTargetOperations ({campaignId = null, limit = MULTI_TARGET_PAGE_LIMIT} = {}) {
		const due = [...this._semanticOperations.values()]
			.filter(operation => operation.targetSetVersion === 1 && isMultiTargetLiveStatus(operation.status))
			.filter(operation => campaignId == null || operation.campaignId === campaignId)
			.filter(operation => (
				new Date(operation.collectionClosesAt) <= this._fnNow()
				|| new Date(operation.expiresAt) <= this._fnNow()
			))
			.sort((left, right) => left.collectionClosesAt.localeCompare(right.collectionClosesAt) || left.id.localeCompare(right.id))
			.slice(0, Math.min(limit, MULTI_TARGET_PAGE_LIMIT));
		let processed = 0;
		for (const operation of due) {
			await this._pWithMemoryLock({
				key: `4:parent:${operation.id}`,
				fn: () => {
					this._terminalizeElapsedMultiTarget({operation});
					processed++;
				},
			});
		}
		return {processed};
	}

	async pCleanupMultiTargetHistory ({limit = MULTI_TARGET_PAGE_LIMIT} = {}) {
		const cutoff = new Date(this._fnNow().getTime() - 90 * 86_400_000);
		const due = [...this._semanticOperations.values()]
			.filter(operation => (
				operation.targetSetVersion === 1
				&& ["applied", "cancelled", "expired", "failed"].includes(operation.status)
				&& operation.resolvedAt
				&& new Date(operation.resolvedAt) <= cutoff
			))
			.sort((left, right) => left.resolvedAt.localeCompare(right.resolvedAt) || left.id.localeCompare(right.id))
			.slice(0, Math.min(limit, MULTI_TARGET_PAGE_LIMIT));
		let deleted = 0;
		for (const operation of due) {
			const eventIds = new Set(this._events
				.filter(event => event.aggregateId === operation.id || event.payload?.operationId === operation.id)
				.map(event => event.id));
			for (const command of this._semanticOperationCommands.values()) {
				if (command.operationId !== operation.id) continue;
				for (const eventId of command.eventIds) eventIds.add(eventId);
			}
			if (this._outbox.some(entry => eventIds.has(entry.eventId) && entry.status !== "published")) continue;
			for (const [key, target] of this._semanticOperationTargets) {
				if (target.operationId === operation.id) this._semanticOperationTargets.delete(key);
			}
			this._semanticOperationFinalizations.delete(operation.id);
			for (const [key, command] of this._semanticOperationCommands) {
				if (command.operationId === operation.id) this._semanticOperationCommands.delete(key);
			}
			this._semanticOperations.delete(operation.id);
			deleted++;
		}
		return {deleted};
	}

	_getSemanticWatermarksForViewer ({operation, accountId, role, source, target}) {
		const canViewBoth = ["dm", "co_dm"].includes(role) || source?.ownerAccountId === accountId;
		const characters = canViewBoth
			? [...new Map([[source?.id, source], [target?.id, target]]).values()]
			: [target];
		return characters
			.filter(Boolean)
			.map(character => ({characterId: character.id, sequence: character.operationWatermark || 0}))
			.sort((left, right) => left.characterId.localeCompare(right.characterId));
	}

	async pListPendingActions ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		this._expireSemanticOperations({campaignId});
		return [...this._semanticOperations.values()]
			.filter(operation => operation.campaignId === campaignId && operation.status === "proposed")
			.filter(operation => {
				if (["dm", "co_dm"].includes(membership.role) || operation.originActorAccountId === accountId) return true;
				return this._characters.get(operation.targetCharacterId)?.ownerAccountId === accountId;
			})
			.map(operation => this._getSemanticOperationView(operation, {
				accountId,
				role: membership.role,
				source: this._characters.get(operation.sourceCharacterId),
				target: this._characters.get(operation.targetCharacterId),
			}));
	}

	async pListCharacterOutgoingActions ({accountId, campaignId, characterId}) {
		this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		const character = this._characters.get(characterId);
		if (
			!character
			|| character.status !== "active"
			|| character.campaignId !== campaignId
			|| character.ownerAccountId !== accountId
		) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		this._expireSemanticOperations({campaignId});
		return [...this._semanticOperations.values()]
			.filter(operation =>
				operation.campaignId === campaignId
				&& operation.sourceCharacterId === characterId
				&& operation.originActorAccountId === accountId
				&& operation.targetSetVersion == null
				&& operation.sourceCost != null,
			)
			.sort((left, right) => `${right.createdAt}`.localeCompare(`${left.createdAt}`) || left.id.localeCompare(right.id))
			.slice(0, 100)
			.map(operation => getPeerSourceCostActionSummary(operation));
	}

	async pListCharacterPendingActions ({accountId, campaignId, characterId}) {
		this._getMembership({
			accountId,
			campaignId,
			roles: ["dm", "co_dm", "player"],
			isRequireActiveCampaign: false,
		});
		const character = this._getCharacterOrThrow(characterId);
		if (character.campaignId !== campaignId || character.ownerAccountId !== accountId) {
			throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		}
		this._expireSemanticOperations({campaignId});
		return [...this._semanticOperations.values()]
			.filter(operation =>
				operation.campaignId === campaignId
				&& operation.targetCharacterId === characterId
				&& operation.status === "proposed",
			)
			.map(operation => {
				const action = getPendingEffectPresentation({
					operationId: operation.id,
					status: operation.status,
					sourceDisplaySnapshot: operation.sourceDisplaySnapshot,
					effectDisplaySnapshot: operation.effectDisplaySnapshot,
					operationKind: operation.kind,
					operationArguments: operation.arguments,
					expiresAt: operation.expiresAt,
				});
				return action
					? {
						...action,
						...(operation.sourceCost ? {contractVersion: PEER_SOURCE_COSTS_CONTRACT_VERSION} : {}),
						capabilities: {canApprove: true, canReject: true},
					}
					: null;
			})
			.filter(Boolean);
	}

	async pGrantXp ({accountId, campaignId, characterId, amount, reason = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const character = this._getCharacterOrThrow(characterId);
		if (character.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const data = structuredClone(character.data);
		data.xp = Math.max(0, Math.floor(Number(data.xp) || 0) + Math.floor(amount));
		validateCloudCharacterData(data);
		this._setCharacterData({character, data});
		character.revision++;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "xp.granted", targetType: "character", targetId: characterId, details: {amount, reason}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "xp.granted", aggregateType: "character", aggregateId: characterId, aggregateRevision: character.revision, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, character.ownerAccountId])], payload: {amount, reason, xp: character.data.xp}});
		// No projection invalidation: `xp` is not a catalog field, so no peer-visible value
		// can change here. Asserted by HubProjectionCanary.
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character)}});
	}

	async pGrantItem ({accountId, campaignId, characterId, item, quantity = 1, rulesVersionId = null, idempotencyKey}) {
		const normalizedItem = normalizeSafeItemSummary(item);
		normalizeItemAwardQuantity(quantity);
		validateCloudValue(normalizedItem, {label: "Granted item"});
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const enforcement = await this._pGetCampaignContentEnforcement(campaignId);
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) return resumedPrior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		let character = this._getCharacterOrThrow(characterId);
		if (character.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
		const provisionalData = normalizeCharacterInventory(character.data);
		provisionalData.inventory.push({id: crypto.randomUUID(), item: copy(normalizedItem), quantity});
		assertCharacterCampaignContentMutation({
			...enforcement,
			before: character.data,
			after: provisionalData,
			rulesVersionId: enforcement.activeRulesVersionId,
		});
		const resolution = normalizeItemAwardResolution(await this._fnResolveAwardItem({
			sourceKind: "recent",
			item: normalizedItem,
			brewBundle: enforcement.brewBundle,
		}), {sourceKind: "recent"});
		const authoritativeItem = resolution.authoritativeItem;
		validateCloudValue(authoritativeItem, {label: "Granted item"});
		const authoritativeSummary = getSafeItemSummary(authoritativeItem);
		const currentEnforcement = await this._pGetCampaignContentEnforcement(campaignId);
		const replayed = this._getReceipt({accountId, idempotencyKey});
		if (replayed) return replayed;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		if (currentEnforcement.activeBrewBundleVersionId !== enforcement.activeBrewBundleVersionId) {
			throw new HubStoreError("BREW_VERSION_STALE", `Campaign homebrew changed before this item was granted.`, {status: 409});
		}
		assertCampaignContentPolicyVersion({...currentEnforcement, rulesVersionId});
		character = this._getCharacterOrThrow(characterId);
		if (character.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const data = normalizeCharacterInventory(character.data);
		const entry = {id: crypto.randomUUID(), item: copy(authoritativeItem), quantity};
		data.inventory.push(entry);
		assertCharacterCampaignContentMutation({
			...currentEnforcement,
			before: character.data,
			after: data,
			rulesVersionId: currentEnforcement.activeRulesVersionId,
		});
		// The inventory just changed underneath a summary the sheet computed for the previous
		// one, and no sheet is present to recompute it. Drop it: the projection then reports
		// "not synced" until the owner saves, which is the only honest answer.
		stripCarryAuthority(data);
		validateCloudCharacterData(data);
		this._setCharacterData({character, data});
		character.revision++;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "item.granted", targetType: "character", targetId: characterId, details: {entryId: entry.id, quantity: entry.quantity, sourceKind: resolution.sourceKind}});
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: "item.granted",
			aggregateType: "character",
			aggregateId: characterId,
			aggregateRevision: character.revision,
			visibility: "explicit_accounts",
			visibleAccountIds: [...new Set([accountId, character.ownerAccountId])],
			payload: {sourceKind: resolution.sourceKind, entry: {...copy(entry), item: copy(authoritativeSummary)}},
		});
		// A granted item changes the inventory and carry summaries.
		this._commitCharacterMutation({character, actorAccountId: accountId, isRevisionBump: false});
		return this._setReceipt({accountId, idempotencyKey, response: {character: stripProjectionPolicy(character), entry}});
	}

	async pAwardItems ({
		accountId,
		campaignId,
		source,
		targetCharacterIds,
		quantity,
		note = null,
		rulesVersionId = null,
		idempotencyKey,
	}) {
		const request = normalizeItemAwardRequest({source, targetCharacterIds, quantity, note});
		const commandIdempotencyKey = getItemAwardIdempotencyKey({idempotencyKey, campaignId, request});
		const prior = this._getReceipt({accountId, idempotencyKey: commandIdempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		let enforcement = await this._pGetCampaignContentEnforcement(campaignId);
		const resumedPrior = this._getReceipt({accountId, idempotencyKey: commandIdempotencyKey});
		if (resumedPrior) return resumedPrior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});

		const getTargetCharacters = () => request.targetCharacterIds.map(characterId => {
			const character = this._characters.get(characterId);
			const ownerMembership = character
				? this._memberships.get(`${campaignId}::${character.ownerAccountId}`)
				: null;
			if (
				!character
				|| character.status !== "active"
				|| character.campaignId !== campaignId
				|| ownerMembership?.status !== "active"
			) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
			return character;
		});
		let targetCharacters = getTargetCharacters();

		const totalQuantity = getItemAwardTotalQuantity({
			quantity: request.quantity,
			targetCount: targetCharacters.length,
		});
		let item;
		let incomingEntry;
		let resolvedSourceKind = request.source.kind;
		let stagedPartyInventory = null;
		let partyInventoryResponse = null;
		if (request.source.kind === "party_inventory") {
			const partyInventory = this._partyInventories.get(campaignId);
			if (!partyInventory) {
				throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Party inventory entry was not found.`, {status: 404});
			}
			const selected = partyInventory.inventory.find(entry => entry.id === request.source.entryId);
			if (!selected) {
				throw new HubStoreError("ITEM_AWARD_SOURCE_NOT_FOUND", `Party inventory entry was not found.`, {status: 404});
			}
			item = getSafeItemSummary(selected.item);
			const removed = removeTransferPayload({
				container: partyInventory,
				payload: {items: [{entryId: selected.id, quantity: totalQuantity}]},
			});
			incomingEntry = removed.escrow.items[0];
			stagedPartyInventory = {
				...copy(partyInventory),
				inventory: removed.container.inventory,
				currency: removed.container.currency,
				revision: partyInventory.revision + 1,
			};
			partyInventoryResponse = {id: partyInventory.id, revision: stagedPartyInventory.revision};
		} else {
			item = request.source.item;
			assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
			for (const character of targetCharacters) {
				const provisional = addAwardedEntryToCharacter({
					container: character.data,
					incoming: {item, quantity: request.quantity},
				});
				assertCharacterCampaignContentMutation({
					...enforcement,
					before: character.data,
					after: provisional.container,
					rulesVersionId: enforcement.activeRulesVersionId,
				});
			}
			const resolution = normalizeItemAwardResolution(await this._fnResolveAwardItem({
				sourceKind: request.source.kind,
				item,
				brewBundle: enforcement.brewBundle,
			}), {sourceKind: request.source.kind});
			const authoritativeItem = resolution.authoritativeItem;
			resolvedSourceKind = resolution.sourceKind;
			validateCloudValue(authoritativeItem, {label: "Awarded item"});
			item = getSafeItemSummary(authoritativeItem);
			const currentEnforcement = await this._pGetCampaignContentEnforcement(campaignId);
			const replayed = this._getReceipt({accountId, idempotencyKey: commandIdempotencyKey});
			if (replayed) return replayed;
			this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
			if (currentEnforcement.activeBrewBundleVersionId !== enforcement.activeBrewBundleVersionId) {
				throw new HubStoreError("BREW_VERSION_STALE", `Campaign homebrew changed before this item was awarded.`, {status: 409});
			}
			assertCampaignContentPolicyVersion({...currentEnforcement, rulesVersionId});
			enforcement = currentEnforcement;
			targetCharacters = getTargetCharacters();
			incomingEntry = {item: authoritativeItem, quantity: request.quantity};
		}
		validateCloudValue(item, {label: "Awarded item"});
		assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
		const stagedCharacters = targetCharacters.map((character, index) => {
			const added = addAwardedEntryToCharacter({
				container: character.data,
				incoming: {...copy(incomingEntry), quantity: request.quantity},
				isAllowLegacySummaryUpgrade: resolvedSourceKind === "catalog",
			});
			stripCarryAuthority(added.container);
			validateCloudCharacterData(added.container);
			return {
				index,
				character: {
					...copy(character),
					data: added.container,
					revision: character.revision + 1,
					updatedAt: this._fnNow().toISOString(),
				},
				entry: added.entry,
			};
		});
		for (const staged of stagedCharacters) {
			assertCharacterCampaignContentMutation({
				...enforcement,
				before: targetCharacters[staged.index].data,
				after: staged.character.data,
				rulesVersionId: enforcement.activeRulesVersionId,
			});
		}

		const awardId = crypto.randomUUID();
		for (const staged of stagedCharacters) {
			this._setCharacterData({
				character: this._characters.get(staged.character.id),
				data: staged.character.data,
			});
			this._characters.set(staged.character.id, staged.character);
		}
		if (stagedPartyInventory) this._partyInventories.set(campaignId, stagedPartyInventory);

		const response = {
			awardId,
			source: {kind: request.source.kind, item: copy(item)},
			quantity: request.quantity,
			note: request.note,
			targets: stagedCharacters.map(({index, character, entry}) => ({
				index,
				characterId: character.id,
				entryId: entry.id,
				quantity: request.quantity,
				revision: character.revision,
			})),
			...(partyInventoryResponse ? {partyInventory: partyInventoryResponse} : {}),
		};
		this._appendAudit({
			campaignId,
			actorAccountId: accountId,
			action: "item.award_batch",
			targetType: "campaign",
			targetId: campaignId,
			details: {
				awardId,
				sourceKind: resolvedSourceKind,
				item,
				targetCharacterIds: request.targetCharacterIds,
				targetCount: request.targetCharacterIds.length,
				quantity: request.quantity,
				totalQuantity,
				note: request.note,
			},
		});
		for (const {index, character, entry} of stagedCharacters) {
			this._appendEvent({
				campaignId,
				actorAccountId: accountId,
				type: "item.granted",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				visibility: "explicit_accounts",
				visibleAccountIds: [...new Set([accountId, character.ownerAccountId])],
				payload: {
					awardId,
					actorCommandId: commandIdempotencyKey.key,
					index,
					targetCount: stagedCharacters.length,
					sourceKind: resolvedSourceKind,
					note: request.note,
					entry: {id: entry.id, item: copy(item), quantity: request.quantity},
				},
			});
			this._commitCharacterMutation({character, actorAccountId: accountId, isRevisionBump: false});
		}
		if (stagedPartyInventory) {
			this._appendEvent({
				campaignId,
				actorAccountId: null,
				type: "party_inventory.invalidated",
				aggregateType: "campaign",
				aggregateId: campaignId,
				aggregateRevision: stagedPartyInventory.revision,
				payload: {},
			});
		}
		return this._setReceipt({accountId, idempotencyKey: commandIdempotencyKey, response});
	}

	_getPartyInventory (campaignId) {
		let inventory = this._partyInventories.get(campaignId);
		if (!inventory) {
			inventory = {id: crypto.randomUUID(), campaignId, revision: 1, inventory: [], currency: normalizeCurrency()};
			this._partyInventories.set(campaignId, inventory);
		}
		return inventory;
	}

	async pGetPartyInventory ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return copy(this._getPartyInventory(campaignId));
	}

	_getTransferContainer ({kind, id, campaignId}) {
		if (kind === "party_inventory") {
			const party = this._getPartyInventory(campaignId);
			if (party.id !== id) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Party inventory was not found.`, {status: 404});
			return {container: party, _party: party};
		}
		const character = this._getCharacterOrThrow(id);
		if (character.campaignId !== campaignId) throw new HubStoreError("TRANSFER_TARGET_INVALID", `Character was not found.`, {status: 404});
		character.data = normalizeCharacterInventory(character.data);
		return {container: character.data, _character: character};
	}

	/**
	 * Commit a written transfer container.
	 *
	 * This is the ONE place a transfer actually writes a participant, so it is where carry
	 * authority is invalidated: it covers escrow reservation on the source, acceptance on the
	 * destination, and the reject / cancel / expiry restore path. Invalidating in
	 * `_getTransferContainer()` or in `normalizeCharacterInventory()` instead would be wrong
	 * — both also run for containers that are merely READ (a proposal reads the target
	 * without modifying it) and for create/import (which would lose a perfectly fresh block
	 * on first cloud save).
	 * @param {{holder: object, container: object, actorAccountId?: ?string, isCarryAffecting?: boolean}} params
	 */
	_setTransferContainer ({holder, container, actorAccountId = null, isCarryAffecting = true}) {
		if (holder._character) {
			if (isCarryAffecting) stripCarryAuthority(container);
			validateCloudCharacterData(container);
			this._setCharacterData({character: holder._character, data: container});
			holder._character.revision++;
			// Both reserving escrow and resolving a transfer change the inventory and carry
			// summaries of the character on either end.
			this._commitCharacterMutation({character: holder._character, actorAccountId, isRevisionBump: false});
		} else {
			holder._party.inventory = container.inventory;
			holder._party.currency = container.currency;
			holder._party.revision++;
			this._appendEvent({
				campaignId: holder._party.campaignId,
				actorAccountId: null,
				type: "party_inventory.invalidated",
				aggregateType: "campaign",
				aggregateId: holder._party.campaignId,
				payload: {},
			});
		}
	}

	async pProposeTransfer ({accountId, campaignId, sourceKind, sourceId, targetKind, targetId, payload, rulesVersionId = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) {
			const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
			return this._projectTransferResponseForViewer({response: prior, accountId, membership});
		}
		if (sourceKind === targetKind && sourceId === targetId) {
			throw new HubStoreError("TRANSFER_TARGET_INVALID", `Choose a different transfer destination.`, {status: 400});
		}
		const getCurrentState = () => {
			const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
			const source = this._getTransferContainer({kind: sourceKind, id: sourceId, campaignId});
			const target = this._getTransferContainer({kind: targetKind, id: targetId, campaignId});
			if (target._character) this._assertTargetable({character: target._character, accountId, role: membership.role});
			if (sourceKind === "character" && source._character.ownerAccountId !== accountId) {
				throw new HubStoreError("FORBIDDEN", `Only the owner can transfer from this character.`, {status: 403});
			}
			const isDm = ["dm", "co_dm"].includes(membership.role);
			const isPlayerStashRequest = sourceKind === "party_inventory" && !isDm;
			if (
				isPlayerStashRequest
				&& (
					targetKind !== "character"
					|| target._character?.ownerAccountId !== accountId
				)
			) {
				throw new HubStoreError("FORBIDDEN", `Players can only request party inventory for one of their own characters.`, {status: 403});
			}
			return {
				membership,
				source,
				target,
				isPlayerStashRequest,
				isDirectAuthority: isDirectTransferAuthority({
					role: membership.role,
					accountId,
					sourceKind,
					targetKind,
					targetOwnerAccountId: target._character?.ownerAccountId,
				}),
			};
		};
		let current = getCurrentState();
		let enforcement = null;
		if (current.isDirectAuthority && current.target._character) {
			enforcement = await this._pGetCampaignContentEnforcement(campaignId);
			const resumedPrior = this._getReceipt({accountId, idempotencyKey});
			if (resumedPrior) {
				const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
				return this._projectTransferResponseForViewer({response: resumedPrior, accountId, membership});
			}
			current = getCurrentState();
			if (!current.isDirectAuthority) enforcement = null;
		}
		const {
			source,
			target,
			isPlayerStashRequest,
			isDirectAuthority,
		} = current;
		const sourceRevision = source._character?.revision ?? source._party?.revision ?? null;
		const prepared = isPlayerStashRequest
			? prepareTransferRequest({container: source.container, payload})
			: removeTransferPayload({container: source.container, payload});
		let directTargetAfter = null;
		if (isDirectAuthority) {
			directTargetAfter = addTransferPayload({container: target.container, escrow: prepared.escrow});
			if (target._character) {
				assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
				assertCharacterCampaignContentMutation({
					...enforcement,
					before: target.container,
					after: directTargetAfter,
					rulesVersionId: enforcement.activeRulesVersionId,
				});
				validateCloudCharacterData(directTargetAfter);
			}
		}
		if (!isPlayerStashRequest) {
			this._setTransferContainer({holder: source, container: prepared.container, actorAccountId: accountId});
		}
		if (directTargetAfter) {
			this._setTransferContainer({holder: target, container: directTargetAfter, actorAccountId: accountId});
		}
		const transfer = {
			id: crypto.randomUUID(),
			campaignId,
			actorAccountId: accountId,
			actorCommandId: this._normalizeIdempotencyKey(idempotencyKey).key,
			sourceKind,
			sourceId,
			targetKind,
			targetId,
			_sourceRevision: sourceRevision,
			status: isPlayerStashRequest ? "proposed" : isDirectAuthority ? "committed" : "reserved",
			payload: isPlayerStashRequest
				? {request: prepared.request, preview: prepared.preview}
				: {escrow: prepared.escrow},
			createdAt: this._fnNow().toISOString(),
		};
		this._transfers.set(transfer.id, transfer);
		if (isDirectAuthority) {
			transfer.resolvedAt = this._fnNow().toISOString();
			this._appendAudit({campaignId, actorAccountId: accountId, action: "transfer.committed", targetType: "transfer", targetId: transfer.id});
		}
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: `transfer.${transfer.status}`,
			aggregateType: "transfer",
			aggregateId: transfer.id,
			visibility: "explicit_accounts",
			visibleAccountIds: [...new Set([accountId, target._character?.ownerAccountId].filter(Boolean))],
			payload: {sourceKind, sourceId, targetKind, targetId},
		});
		const response = this._projectTransferResponseForViewer({
			response: {transfer},
			accountId,
			membership: current.membership,
		});
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pResolveTransfer ({accountId, campaignId, transferId, decision, rulesVersionId = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) {
			const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
			return this._projectTransferResponseForViewer({response: prior, accountId, membership});
		}
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const transferPre = this._transfers.get(transferId);
		if (!transferPre || transferPre.campaignId !== campaignId || !["proposed", "reserved"].includes(transferPre.status)) throw new HubStoreError("TRANSFER_NOT_FOUND", `Transfer was not found.`, {status: 404});
		const enforcement = decision === "accept" && transferPre.targetKind === "character"
			? await this._pGetCampaignContentEnforcement(campaignId)
			: null;
		const resumedPrior = this._getReceipt({accountId, idempotencyKey});
		if (resumedPrior) {
			const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
			return this._projectTransferResponseForViewer({response: resumedPrior, accountId, membership});
		}
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const transfer = this._transfers.get(transferId);
		if (!transfer || transfer.campaignId !== campaignId || !["proposed", "reserved"].includes(transfer.status)) throw new HubStoreError("TRANSFER_NOT_FOUND", `Transfer was not found.`, {status: 404});
		const target = this._getTransferContainer({kind: transfer.targetKind, id: transfer.targetId, campaignId});
		const isActorCancelling = decision === "reject" && transfer.actorAccountId === accountId;
		const isDm = ["dm", "co_dm"].includes(membership.role);
		const canResolve = transfer.status === "proposed"
			? isActorCancelling || isDm
			: isActorCancelling || (transfer.targetKind === "character"
				? target._character.ownerAccountId === accountId || isDm
				: isDm);
		if (!canResolve) throw new HubStoreError("FORBIDDEN", `Cannot resolve this transfer.`, {status: 403});
		if (transfer.status === "proposed") {
			if (decision === "accept") {
				const source = this._getTransferContainer({kind: transfer.sourceKind, id: transfer.sourceId, campaignId});
				const removed = removeTransferPayload({container: source.container, payload: transfer.payload.request});
				const after = addTransferPayload({container: target.container, escrow: removed.escrow});
				if (target._character) {
					assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
					assertCharacterCampaignContentMutation({
						...enforcement,
						before: target.container,
						after,
						rulesVersionId: enforcement.activeRulesVersionId,
					});
					validateCloudCharacterData(after);
				}
				this._setTransferContainer({holder: source, container: removed.container, actorAccountId: accountId});
				this._setTransferContainer({holder: target, container: after, actorAccountId: accountId});
				transfer.payload = {...transfer.payload, escrow: removed.escrow};
			}
		} else {
			const destination = decision === "accept"
				? target
				: this._getTransferContainer({kind: transfer.sourceKind, id: transfer.sourceId, campaignId});
			const after = addTransferPayload({
				container: destination.container,
				escrow: transfer.payload.escrow,
				isRestore: decision !== "accept",
			});
			if (decision === "accept" && destination._character) {
				assertCampaignContentPolicyVersion({...enforcement, rulesVersionId});
				assertCharacterCampaignContentMutation({
					...enforcement,
					before: destination.container,
					after,
					rulesVersionId: enforcement.activeRulesVersionId,
				});
			}
			this._setTransferContainer({
				holder: destination,
				container: after,
				actorAccountId: accountId,
			});
		}
		transfer.status = decision === "accept" ? "committed" : "rejected";
		transfer.resolvedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: `transfer.${transfer.status}`, targetType: "transfer", targetId: transfer.id});
		this._appendEvent({
			campaignId,
			actorAccountId: accountId,
			type: `transfer.${transfer.status}`,
			aggregateType: "transfer",
			aggregateId: transfer.id,
			visibility: "explicit_accounts",
			visibleAccountIds: [...new Set([transfer.actorAccountId, target._character?.ownerAccountId].filter(Boolean))],
			payload: {
				sourceKind: transfer.sourceKind,
				sourceId: transfer.sourceId,
				targetKind: transfer.targetKind,
				targetId: transfer.targetId,
			},
		});
		const response = this._projectTransferResponseForViewer({
			response: {transfer},
			accountId,
			membership,
		});
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pListTransfers ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return [...this._transfers.values()]
			.filter(transfer => transfer.campaignId === campaignId)
			.filter(transfer => {
				if (["dm", "co_dm"].includes(membership.role) || transfer.actorAccountId === accountId) return true;
				for (const [kind, id] of [[transfer.sourceKind, transfer.sourceId], [transfer.targetKind, transfer.targetId]]) {
					if (kind === "character" && this._characters.get(id)?.ownerAccountId === accountId) return true;
				}
				return false;
			})
			.map(transfer => projectTransferForViewer({
				transfer: copy(transfer),
				accountId,
				role: membership.role,
				getCharacterOwnerId: characterId => this._characters.get(characterId)?.ownerAccountId,
				getCharacterDisplaySnapshot: characterId => {
					const character = this._characters.get(characterId);
					return getTransferCharacterDisplaySnapshot({
						character,
						transferCampaignId: transfer.campaignId,
						viewerAccountId: accountId,
						viewerRole: membership.role,
					});
				},
			}))
			.filter(Boolean);
	}

	async pGetAccountDeletion ({accountId}) {
		const account = this._accounts.get(accountId);
		if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		return {
			status: account.status,
			deletionRequestedAt: account.deletionRequestedAt,
			purgeAfter: account.purgeAfter,
		};
	}

	async pRequestAccountDeletion ({accountId, sessionId = null, idempotencyKey, graceMs = 7 * 24 * 60 * 60 * 1000}) {
		return this._pWithSensitiveCommandLocks({
			accountId,
			idempotencyKey,
			fn: () => this._pRequestAccountDeletion({accountId, sessionId, idempotencyKey, graceMs}),
		});
	}

	async _pRequestAccountDeletion ({accountId, sessionId = null, idempotencyKey, graceMs = 7 * 24 * 60 * 60 * 1000}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		const account = this._accounts.get(accountId);
		if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		if (prior) {
			this._assertFreshReauthentication({accountId, sessionId});
			return prior;
		}
		this._assertFreshReauthentication({accountId, sessionId});
		if (
			this._getActiveEntitlement({accountId, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
			&& [...this._accounts.values()].filter(current => (
				current.status === "active"
				&& this._getActiveEntitlement({accountId: current.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
			)).length <= 1
		) throw new HubStoreError("LAST_OPERATOR_PROTECTED", `The final platform operator cannot request deletion.`, {status: 409});
		const ownedCampaigns = [...this._campaigns.values()].filter(campaign => campaign.ownerAccountId === accountId && campaign.status === "active");
		if (ownedCampaigns.length) {
			throw new HubStoreError("ACCOUNT_OWNS_CAMPAIGN", `Transfer ownership or archive campaigns before deleting the account.`, {
				status: 409,
				details: {campaignIds: ownedCampaigns.map(campaign => campaign.id)},
			});
		}
		await this._pBeforeSensitiveCommit();
		const concurrentPrior = this._getReceipt({accountId, idempotencyKey});
		if (concurrentPrior) return concurrentPrior;
		this._assertFreshReauthentication({accountId, sessionId});
		if (
			this._getActiveEntitlement({accountId, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
			&& [...this._accounts.values()].filter(current => (
				current.status === "active"
				&& this._getActiveEntitlement({accountId: current.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
			)).length <= 1
		) throw new HubStoreError("LAST_OPERATOR_PROTECTED", `The final platform operator cannot request deletion.`, {status: 409});
		if (account.status !== "deletion_requested") {
			const requestedAt = this._fnNow();
			account.status = "deletion_requested";
			account.deletionRequestedAt = requestedAt.toISOString();
			account.purgeAfter = new Date(requestedAt.getTime() + graceMs).toISOString();
		}
		const ownedCharacterIds = new Set(
			[...this._characters.values()]
				.filter(character => character.ownerAccountId === accountId)
				.map(character => character.id),
		);
		for (const operation of this._semanticOperations.values()) {
			if (
				operation.status === "proposed"
				&& (
					operation.originActorAccountId === accountId
					|| ownedCharacterIds.has(operation.sourceCharacterId)
					|| ownedCharacterIds.has(operation.targetCharacterId)
				)
			) {
				this._cancelSemanticOperationForLifecycle({operation, actorAccountId: accountId});
			}
		}
		const revokedSessionIds = [];
		for (const session of this._sessions.values()) {
			if (session.accountId !== accountId || session.revokedAt) continue;
			await this.pRevokeSession({sessionId: session.id});
			revokedSessionIds.push(session.id);
		}
		this._appendAudit({actorAccountId: accountId, action: "account.deletion_requested", targetType: "account", targetId: accountId, details: {purgeAfter: account.purgeAfter}});
		const response = {deletion: await this.pGetAccountDeletion({accountId}), revokedSessionIds};
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pCancelAccountDeletion ({accountId, sessionId = null, idempotencyKey}) {
		return this._pWithSensitiveCommandLocks({
			accountId,
			idempotencyKey,
			fn: () => this._pCancelAccountDeletion({accountId, sessionId, idempotencyKey}),
		});
	}

	async _pCancelAccountDeletion ({accountId, sessionId = null, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		const account = this._accounts.get(accountId);
		if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		if (prior) {
			this._assertFreshReauthentication({accountId, sessionId});
			return prior;
		}
		if (account.status !== "deletion_requested") throw new HubStoreError("ACCOUNT_DELETION_NOT_PENDING", `Account deletion is not pending.`, {status: 409});
		this._assertFreshReauthentication({accountId, sessionId});
		await this._pBeforeSensitiveCommit();
		const concurrentPrior = this._getReceipt({accountId, idempotencyKey});
		if (concurrentPrior) return concurrentPrior;
		this._assertFreshReauthentication({accountId, sessionId});
		account.status = "active";
		account.deletionRequestedAt = null;
		account.purgeAfter = null;
		this._appendAudit({actorAccountId: accountId, action: "account.deletion_cancelled", targetType: "account", targetId: accountId});
		return this._setReceipt({accountId, idempotencyKey, response: {deletion: await this.pGetAccountDeletion({accountId})}});
	}

	_deleteCampaignData (campaignId) {
		this._campaigns.delete(campaignId);
		for (const [key, membership] of this._memberships) if (membership.campaignId === campaignId) this._memberships.delete(key);
		for (const invite of [...this._invites.values()]) if (invite.campaignId === campaignId) this._deleteInvite(invite);
		for (const [key, version] of this._brewVersions) if (version.campaignId === campaignId) this._brewVersions.delete(key);
		for (const [key, version] of this._rulesVersions) if (version.campaignId === campaignId) this._rulesVersions.delete(key);
		for (const [key, workspace] of this._dmWorkspaces) if (workspace.campaignId === campaignId) this._dmWorkspaces.delete(key);
		this._partyInventories.delete(campaignId);
		for (const [key, operation] of this._semanticOperations) {
			if (operation.campaignId === campaignId) this._semanticOperations.delete(key);
		}
		for (const [key, target] of this._semanticOperationTargets) {
			if (target.campaignId === campaignId) this._semanticOperationTargets.delete(key);
		}
		for (const [key] of this._semanticOperationFinalizations) {
			if (!this._semanticOperations.has(key)) this._semanticOperationFinalizations.delete(key);
		}
		for (const [key, command] of this._semanticOperationCommands) {
			if (!this._semanticOperations.has(command.operationId)) this._semanticOperationCommands.delete(key);
		}
		for (const [key, action] of this._pendingActions) if (action.campaignId === campaignId) this._pendingActions.delete(key);
		for (const [key, transfer] of this._transfers) if (transfer.campaignId === campaignId) this._transfers.delete(key);
		const removedEventIds = new Set(this._events.filter(event => event.campaignId === campaignId).map(event => event.id));
		this._events = this._events.filter(event => event.campaignId !== campaignId);
		this._campaignEvents.delete(campaignId);
		this._outbox = this._outbox.filter(entry => !removedEventIds.has(entry.eventId));
		for (const audit of this._audit) if (audit.campaignId === campaignId) audit.campaignId = null;
	}

	async pPurgeDueAccounts ({limit = 100} = {}) {
		if (!this._isAccountEntitlementsEnabled) return this._pPurgeDueAccounts({limit});
		return this._pWithMemoryLock({
			key: "operator-namespace",
			fn: () => this._pPurgeDueAccounts({limit}),
		});
	}

	async _pPurgeDueAccounts ({limit = 100} = {}) {
		const due = [...this._accounts.values()]
			.filter(account => account.status === "deletion_requested" && new Date(account.purgeAfter) <= this._fnNow())
			.slice(0, limit);
		const purgedAccountIds = [];
		const blockedAccountIds = [];
		for (const account of due) {
			if (
				this._isAccountEntitlementsEnabled
				&& this._getActiveEntitlement({accountId: account.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
				&& [...this._accounts.values()].filter(current => (
					current.status === "active"
					&& this._getActiveEntitlement({accountId: current.id, entitlementName: PLATFORM_OPERATE_ENTITLEMENT})
				)).length < 1
			) {
				blockedAccountIds.push(account.id);
				continue;
			}
			if ([...this._campaigns.values()].some(campaign => campaign.ownerAccountId === account.id && campaign.status !== "archived")) {
				blockedAccountIds.push(account.id);
				continue;
			}
			for (const membership of [...this._memberships.values()]) {
				if (membership.accountId !== account.id || membership.status !== "active") continue;
				const campaign = this._campaigns.get(membership.campaignId);
				if (campaign) this._removeMembershipLifecycle({campaign, membership, actorAccountId: account.id, status: "left"});
			}
			const membershipIds = new Set(
				[...this._memberships.values()]
					.filter(membership => membership.accountId === account.id)
					.map(membership => membership.id),
			);
			for (const invite of [...this._invites.values()]) {
				if (membershipIds.has(invite.createdByMembershipId)) this._deleteInvite(invite);
			}
			const ownedCharacterIds = new Set([...this._characters.values()].filter(character => character.ownerAccountId === account.id).map(character => character.id));
			for (const [id, action] of this._pendingActions) if (ownedCharacterIds.has(action.targetCharacterId)) this._pendingActions.delete(id);
			for (const [id, transfer] of this._transfers) {
				if (
					(transfer.sourceKind === "character" && ownedCharacterIds.has(transfer.sourceId))
					|| (transfer.targetKind === "character" && ownedCharacterIds.has(transfer.targetId))
				) this._transfers.delete(id);
			}
			for (const [id, operation] of this._semanticOperations) {
				const ownsMultiTarget = operation.targetSetVersion === 1
					&& this._getMultiTargetTargets(operation.id)
						.some(target => (
							ownedCharacterIds.has(target.targetCharacterId)
							|| target.targetOwnerAccountIdAtProposal === account.id
						));
				if (
					ownedCharacterIds.has(operation.sourceCharacterId)
					|| ownedCharacterIds.has(operation.targetCharacterId)
					|| ownsMultiTarget
				) {
					if (operation.targetSetVersion === 1 && isMultiTargetLiveStatus(operation.status)) {
						this._cancelMultiTargetOperationForLifecycle({
							operation,
							actorAccountId: account.id,
							isAll: true,
						});
						this._appendAudit({
							campaignId: operation.campaignId,
							actorAccountId: account.id,
							action: "character.multi_operation.cancelled",
							targetType: "semantic_operation",
							targetId: operation.id,
							details: {reason: "account_purge"},
						});
					}
					this._semanticOperations.delete(id);
					for (const [key, target] of this._semanticOperationTargets) {
						if (target.operationId === id) this._semanticOperationTargets.delete(key);
					}
					this._semanticOperationFinalizations.delete(id);
				} else if (operation.originActorAccountId === account.id) {
					operation.originActorAccountId = null;
				}
			}
			for (const [id, command] of this._semanticOperationCommands) {
				if (!this._semanticOperations.has(command.operationId)) this._semanticOperationCommands.delete(id);
				else if (command.actorAccountId === account.id) command.actorAccountId = null;
			}
			for (const [id, character] of this._characters) {
				if (character.ownerAccountId !== account.id) continue;
				this._characterLeases.delete(id);
				this._characters.delete(id);
			}
			for (const campaign of [...this._campaigns.values()]) {
				if (campaign.ownerAccountId === account.id && campaign.status === "archived") this._deleteCampaignData(campaign.id);
			}
			for (const [hash, session] of this._sessions) if (session.accountId === account.id) this._sessions.delete(hash);
			for (const [identity, id] of this._identityToAccount) if (id === account.id) this._identityToAccount.delete(identity);
			for (const [id, identity] of this._externalIdentities) if (identity.accountId === account.id) this._externalIdentities.delete(id);
			for (const [id, transaction] of this._oauthTransactions) if (transaction.initiatingAccountId === account.id) this._oauthTransactions.delete(id);
			for (const [key, receipt] of this._commandReceipts) {
				if (key.startsWith(`${account.id}::`) || receipt.response?.account?.id === account.id) {
					this._commandReceipts.delete(key);
				}
			}
			for (const [id, entitlement] of this._accountEntitlements) {
				if (entitlement.accountId === account.id) this._accountEntitlements.delete(id);
				else {
					if (entitlement.grantedByAccountId === account.id) entitlement.grantedByAccountId = null;
					if (entitlement.revokedByAccountId === account.id) entitlement.revokedByAccountId = null;
				}
			}
			for (const [key, membership] of this._memberships) if (membership.accountId === account.id) this._memberships.delete(key);
			for (const action of this._pendingActions.values()) if (action.actorAccountId === account.id) action.actorAccountId = null;
			for (const transfer of this._transfers.values()) if (transfer.actorAccountId === account.id) transfer.actorAccountId = null;
			for (const audit of this._audit) if (audit.actorAccountId === account.id) audit.actorAccountId = null;
			for (const event of this._events) if (event.actorAccountId === account.id) event.actorAccountId = null;
			this._appendAudit({actorAccountId: account.id, action: "account.deletion_purged", targetType: "account", targetId: account.id});
			this._audit[this._audit.length - 1].actorAccountId = null;
			this._accounts.delete(account.id);
			purgedAccountIds.push(account.id);
		}
		return {purgedAccountIds, blockedAccountIds};
	}

	_cancelIncomingForCharacter ({character}) {
		const transfers = [...this._transfers.values()]
			.filter(transfer => ["proposed", "reserved"].includes(transfer.status)
				&& transfer.targetKind === "character"
				&& transfer.targetId === character.id);
		this._cancelTransferBatchForLifecycle({
			transfers,
			actorAccountId: character.ownerAccountId,
			reason: "target_lifecycle_change",
		});
		for (const action of this._pendingActions.values()) {
			if (action.targetCharacterId === character.id && action.status === "proposed") action.status = "cancelled";
		}
	}

	async pClaimOutboxBatch ({limit = 100}) {
		return this._outbox
			.filter(entry => ["pending", "failed"].includes(entry.status))
			.slice(0, limit)
			.map(entry => {
				entry.status = "publishing";
				entry.claimToken = crypto.randomUUID();
				return {
					...copy(entry),
					event: copy(this._events.find(event => event.id === entry.eventId)),
				};
			});
	}

	async pMarkOutboxPublished ({outboxId, claimToken}) {
		const entry = this._outbox.find(it => it.id === outboxId);
		if (entry && (!claimToken || entry.claimToken === claimToken)) entry.status = "published";
	}

	async pMarkOutboxFailed ({outboxId, claimToken, error}) {
		const entry = this._outbox.find(it => it.id === outboxId);
		if (entry && (!claimToken || entry.claimToken === claimToken)) {
			entry.status = "failed";
			entry.lastError = error;
		}
	}

	async pExportAccountData ({accountId, sessionId = null}) {
		const account = this._accounts.get(accountId);
		if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		if (account.status === "deletion_requested") {
			this._assertFreshReauthentication({accountId, sessionId});
		}
		const memberships = [...this._memberships.values()].filter(it => it.accountId === accountId);
		const campaignIds = new Set(memberships.map(it => it.campaignId));
		const entitlementAudits = this._audit.filter(audit => (
			`${audit.action}`.startsWith("account.entitlement.")
			&& audit.details?.targetAccountId === accountId
		));
		const audits = [...new Map(
			[
				...this._audit.filter(it => it.actorAccountId === accountId),
				...entitlementAudits,
			].map(audit => [audit.id, audit]),
		).values()].map(audit => redactEntitlementAuditForAccount({audit: copy(audit), accountId}));
		const multiTargetOperations = [...this._semanticOperations.values()]
			.filter(operation => operation.targetSetVersion === 1)
			.filter(operation => (
				operation.originActorAccountId === accountId
				|| this._getMultiTargetTargets(operation.id)
					.some(target => target.targetOwnerAccountIdAtProposal === accountId)
			))
			.map(operation => {
				const membership = this._memberships.get(`${operation.campaignId}::${accountId}`);
				return this._getMultiTargetOperationView({
					operation,
					accountId,
					role: membership?.status === "active" ? membership.role : "player",
				});
			});
		return {
			exportedAt: this._fnNow().toISOString(),
			account: copy(account),
			externalIdentities: await this.pListExternalIdentities({accountId}),
			sessions: [...this._sessions.values()]
				.filter(it => it.accountId === accountId)
				.map(({tokenHash: _tokenHash, ...session}) => copy(session)),
			memberships: copy(memberships),
			campaigns: [...campaignIds].map(id => copy(this._campaigns.get(id))),
			characters: [...this._characters.values()].filter(it => it.ownerAccountId === accountId).map(copy),
			entitlements: [...this._accountEntitlements.values()]
				.filter(entitlement => entitlement.accountId === accountId)
				.map(entitlement => redactEntitlementForAccount({entitlement: copy(entitlement)})),
			multiTargetOperations: copy(multiTargetOperations),
			auditEntries: audits,
		};
	}

	async pArchiveCampaign ({accountId, campaignId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can archive it.`, {status: 403});
		if (campaign.status !== "active") throw new HubStoreError("CAMPAIGN_NOT_FOUND", `Campaign is unavailable.`, {status: 404});
		if ([...this._transfers.values()].some(it => it.campaignId === campaignId && it.status === "reserved")) {
			throw new HubStoreError("CAMPAIGN_BUSY", `Resolve reserved transfers before archiving.`, {status: 409});
		}
		for (const transfer of this._transfers.values()) {
			if (transfer.campaignId === campaignId && transfer.status === "proposed") {
				this._cancelTransferForLifecycle({transfer, actorAccountId: accountId, reason: "campaign_archived"});
			}
		}
		campaign.status = "archived";
		for (const operation of this._semanticOperations.values()) {
			if (operation.campaignId === campaignId && operation.targetSetVersion === 1) {
				this._cancelMultiTargetOperationForLifecycle({
					operation,
					actorAccountId: accountId,
					isAll: true,
				});
				continue;
			}
			if (operation.campaignId === campaignId && operation.status === "proposed") {
				this._cancelSemanticOperationForLifecycle({operation, actorAccountId: accountId});
			}
		}
		for (const action of this._pendingActions.values()) {
			if (action.campaignId === campaignId && action.status === "proposed") action.status = "cancelled";
		}
		for (const character of this._characters.values()) {
			if (character.campaignId !== campaignId) continue;
			character.campaignId = null;
			character.targetRef = crypto.randomUUID();
			character.operationWatermark = 0;
			character.clientImportId = null;
			character.revision++;
			character.updatedAt = this._fnNow().toISOString();
			this._characterLeases.delete(character.id);
		}
		this._appendAudit({campaignId, actorAccountId: accountId, action: "campaign.archived", targetType: "campaign", targetId: campaignId});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "campaign.archived", aggregateType: "campaign", aggregateId: campaignId, payload: {}});
		const response = {campaign: copy(campaign)};
		return this._setReceipt({accountId, idempotencyKey, response});
	}

	async pTransferCampaignOwnership ({accountId, campaignId, targetAccountId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can transfer ownership.`, {status: 403});
		const target = this._getMembership({accountId: targetAccountId, campaignId, roles: ["dm", "co_dm"]});
		const current = this._getMembership({accountId, campaignId});
		campaign.ownerAccountId = targetAccountId;
		target.role = "dm";
		if (current.id !== target.id) current.role = "co_dm";
		this._appendAudit({campaignId, actorAccountId: accountId, action: "campaign.ownership_transferred", targetType: "campaign", targetId: campaignId, details: {targetAccountId}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "campaign.ownership_transferred", aggregateType: "campaign", aggregateId: campaignId, visibility: "all_members", payload: {targetAccountId}});
		return this._setReceipt({accountId, idempotencyKey, response: {campaign: copy(campaign)}});
	}

	getAuditEntries () {
		return copy(this._audit);
	}

	getDomainEvents () {
		return copy(this._events);
	}

	getOutboxEntries () {
		return copy(this._outbox);
	}
}
