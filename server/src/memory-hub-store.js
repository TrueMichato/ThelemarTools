import crypto from "node:crypto";
import {applyJsonPatch} from "../../js/hub/hub-json-patch.js";
import {HubStoreError} from "./hub-store-error.js";
import {canViewEvent, projectCharacterForPlayer} from "./projections.js";
import {
	addTransferPayload,
	applyStructuredEffect,
	normalizeCharacterInventory,
	normalizeCurrency,
	removeTransferPayload,
	STRUCTURED_EFFECT_TYPES,
} from "./hub-actions.js";
import {validateCloudCharacterData, validateCloudValue} from "./cloud-data-validation.js";

function copy (value) {
	return value === undefined ? undefined : structuredClone(value);
}

export class MemoryHubStore {
	constructor ({fnNow = () => new Date()} = {}) {
		this._fnNow = fnNow;
		this._accounts = new Map();
		this._identityToAccount = new Map();
		this._sessions = new Map();
		this._campaigns = new Map();
		this._memberships = new Map();
		this._audit = [];
		this._events = [];
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
		this._transfers = new Map();
	}

	async pCheckHealth () {
		return true;
	}

	async pUpsertOAuthAccount ({provider, providerSubject, displayName}) {
		const identityKey = `${provider}::${providerSubject}`;
		let accountId = this._identityToAccount.get(identityKey);
		if (!accountId) {
			accountId = crypto.randomUUID();
			this._accounts.set(accountId, {
				id: accountId,
				displayName,
				status: "active",
				createdAt: this._fnNow().toISOString(),
			});
			this._identityToAccount.set(identityKey, accountId);
		} else {
			this._accounts.get(accountId).displayName = displayName;
		}
		return copy(this._accounts.get(accountId));
	}

	async pCreateSession ({accountId, tokenHash, expiresAt, userAgent = null}) {
		if (!this._accounts.has(accountId)) throw new Error(`Unknown account.`);
		const session = {
			id: crypto.randomUUID(),
			accountId,
			tokenHash,
			userAgent,
			expiresAt: expiresAt.toISOString(),
			revokedAt: null,
		};
		this._sessions.set(tokenHash, session);
		return copy(session);
	}

	async pGetSessionByTokenHash ({tokenHash}) {
		const session = this._sessions.get(tokenHash);
		if (!session || session.revokedAt || new Date(session.expiresAt) <= this._fnNow()) return null;
		const account = this._accounts.get(session.accountId);
		if (!account || account.status !== "active") return null;
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

	async pCreateCampaign ({accountId, name, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
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

	_setReceipt ({accountId, idempotencyKey, response}) {
		const normalized = this._normalizeIdempotencyKey(idempotencyKey);
		this._commandReceipts.set(`${accountId}::${normalized.key}`, {
			requestHash: normalized.requestHash,
			response: copy(response),
		});
		return copy(response);
	}

	_normalizeIdempotencyKey (idempotencyKey) {
		if (idempotencyKey && typeof idempotencyKey === "object") return idempotencyKey;
		const key = `${idempotencyKey}`;
		return {key, requestHash: crypto.createHash("sha256").update(key).digest("hex")};
	}

	_appendEvent ({campaignId, actorAccountId, type, aggregateType, aggregateId, aggregateRevision = null, visibility = "all_members", visibleAccountIds = null, payload = {}}) {
		const campaign = this._campaigns.get(campaignId);
		const sequence = this._events.filter(event => event.campaignId === campaignId).length + 1;
		const event = {
			id: crypto.randomUUID(),
			campaignId,
			sequence,
			type,
			actorAccountId,
			aggregateType,
			aggregateId,
			aggregateRevision,
			visibility,
			visibleAccountIds: copy(visibleAccountIds),
			payload: copy(payload),
			createdAt: this._fnNow().toISOString(),
		};
		this._events.push(event);
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

	async pCreateInvite ({accountId, campaignId, role, tokenHash, expiresAt, maxUses, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
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
		return this._setReceipt({accountId, idempotencyKey, response: {invite}});
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

	_getCharacterOrThrow (characterId) {
		const character = this._characters.get(characterId);
		if (!character || character.status !== "active") {
			throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		}
		return character;
	}

	_assertCharacterRead ({accountId, character}) {
		if (character.ownerAccountId === accountId) return "owner";
		if (!character.campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const membership = this._getMembership({accountId, campaignId: character.campaignId});
		if (["dm", "co_dm"].includes(membership.role)) return "dm";
		throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
	}

	async pListCharacters ({accountId, campaignId = null}) {
		if (campaignId) this._getMembership({accountId, campaignId});
		return [...this._characters.values()]
			.filter(it => it.status === "active")
			.filter(it => campaignId ? it.campaignId === campaignId : it.ownerAccountId === accountId)
			.filter(it => {
				if (it.ownerAccountId === accountId) return true;
				const membership = this._memberships.get(`${it.campaignId}::${accountId}`);
				return ["dm", "co_dm"].includes(membership?.role) && membership.status === "active";
			})
			.map(copy);
	}

	async pGetCharacter ({accountId, characterId}) {
		const character = this._getCharacterOrThrow(characterId);
		this._assertCharacterRead({accountId, character});
		return copy(character);
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
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		if (campaignId) this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const imported = [...this._characters.values()].find(it =>
			it.ownerAccountId === accountId
			&& it.clientImportId === clientImportId
			&& it.campaignId === campaignId,
		);
		if (imported) {
			if (imported.status === "archived") {
				imported.status = "active";
				imported.campaignId = campaignId;
				imported.data = normalizeCharacterInventory(data);
				imported.schemaVersion = schemaVersion;
				imported.revision++;
				imported.updatedAt = this._fnNow().toISOString();
				this._appendAudit({campaignId, actorAccountId: accountId, action: "character.reactivated", targetType: "character", targetId: imported.id});
				if (campaignId) {
					this._appendEvent({campaignId, actorAccountId: accountId, type: "character.reactivated", aggregateType: "character", aggregateId: imported.id, aggregateRevision: imported.revision, payload: {}});
				}
			}
			return this._setReceipt({accountId, idempotencyKey, response: {character: imported}});
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
				payload: {ownerAccountId: accountId},
			});
		}
		return this._setReceipt({accountId, idempotencyKey, response: {character}});
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

	async pPatchCharacter ({
		accountId,
		sessionId,
		characterId,
		baseRevision,
		leaseEpoch,
		patches,
		idempotencyKey,
	}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can edit this character.`, {status: 403});
		if (character.campaignId) this._getMembership({accountId, campaignId: character.campaignId, roles: ["dm", "co_dm", "player"]});
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
		const data = applyJsonPatch(character.data, patches);
		validateCloudCharacterData(data);
		character.data = data;
		character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		if (character.campaignId) {
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
			this._appendEvent({
				campaignId: character.campaignId,
				actorAccountId: accountId,
				type: "character.projection.updated",
				aggregateType: "character",
				aggregateId: character.id,
				aggregateRevision: character.revision,
				payload: {character: projectCharacterForPlayer(character)},
			});
		}
		return this._setReceipt({accountId, idempotencyKey, response: {character}});
	}

	async pCloneCharacter ({accountId, characterId, campaignId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const source = this._getCharacterOrThrow(characterId);
		if (source.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can clone this character.`, {status: 403});
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const clone = {
			...copy(source),
			id: crypto.randomUUID(),
			campaignId,
			clonedFromCharacterId: source.id,
			clientImportId: null,
			revision: 1,
			leaseEpoch: 0,
			data: {...copy(source.data), id: undefined, name: `${source.data.name || "Character"} (Copy)`},
			createdAt: this._fnNow().toISOString(),
			updatedAt: this._fnNow().toISOString(),
		};
		delete clone.data.id;
		this._characters.set(clone.id, clone);
		this._appendAudit({campaignId, actorAccountId: accountId, action: "character.cloned", targetType: "character", targetId: clone.id, details: {sourceCharacterId: source.id}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "character.created", aggregateType: "character", aggregateId: clone.id, aggregateRevision: 1, payload: {clonedFromCharacterId: source.id}});
		return this._setReceipt({accountId, idempotencyKey, response: {character: clone}});
	}

	async pMoveCharacter ({accountId, characterId, campaignId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can move this character.`, {status: 403});
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const lease = this._characterLeases.get(characterId);
		if (lease && new Date(lease.expiresAt) > this._fnNow()) {
			throw new HubStoreError("LEASE_HELD", `Release the active character editor before moving.`, {status: 409});
		}
		this._cancelIncomingForCharacter({character});
		if ([...this._transfers.values()].some(it => it.status === "reserved" && it.sourceKind === "character" && it.sourceId === characterId)) {
			throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before moving.`, {status: 409});
		}
		const sourceCampaignId = character.campaignId;
		character.campaignId = campaignId;
		character.clientImportId = null;
		character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: "character.moved", targetType: "character", targetId: character.id, details: {sourceCampaignId}});
		if (sourceCampaignId && sourceCampaignId !== campaignId) {
			this._appendEvent({campaignId: sourceCampaignId, actorAccountId: accountId, type: "character.moved_out", aggregateType: "character", aggregateId: character.id, aggregateRevision: character.revision, payload: {targetCampaignId: campaignId}});
		}
		this._appendEvent({campaignId, actorAccountId: accountId, type: "character.moved", aggregateType: "character", aggregateId: character.id, aggregateRevision: character.revision, payload: {sourceCampaignId}});
		return this._setReceipt({accountId, idempotencyKey, response: {character}});
	}

	async pArchiveCharacter ({accountId, characterId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const character = this._getCharacterOrThrow(characterId);
		if (character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can archive this character.`, {status: 403});
		this._cancelIncomingForCharacter({character});
		if ([...this._transfers.values()].some(it => it.status === "reserved" && it.sourceKind === "character" && it.sourceId === characterId)) {
			throw new HubStoreError("CHARACTER_BUSY", `Resolve outgoing transfers before archiving.`, {status: 409});
		}
		character.status = "archived";
		character.revision++;
		character.updatedAt = this._fnNow().toISOString();
		this._characterLeases.delete(characterId);
		this._appendAudit({campaignId: character.campaignId, actorAccountId: accountId, action: "character.archived", targetType: "character", targetId: character.id});
		if (character.campaignId) {
			this._appendEvent({campaignId: character.campaignId, actorAccountId: accountId, type: "character.archived", aggregateType: "character", aggregateId: character.id, aggregateRevision: character.revision});
		}
		return this._setReceipt({accountId, idempotencyKey, response: {ok: true}});
	}

	async pGetCampaignContext ({accountId, campaignId}) {
		this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		const campaign = this._campaigns.get(campaignId);
		const brew = campaign.activeBrewBundleVersionId
			? this._brewVersions.get(campaign.activeBrewBundleVersionId)
			: null;
		const rules = campaign.activeRulesVersionId
			? this._rulesVersions.get(campaign.activeRulesVersionId)
			: null;
		return {
			campaignId,
			brewBundle: copy(brew),
			rulesVersion: copy(rules),
		};
	}

	async pCreateBrewBundleVersion ({accountId, campaignId, contentHash, content, manifest, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
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
		this._rulesVersions.set(rulesVersion.id, rulesVersion);
		this._appendAudit({campaignId, actorAccountId: accountId, action: "rules.created", targetType: "rules_version", targetId: rulesVersion.id});
		return this._setReceipt({accountId, idempotencyKey, response: {rulesVersion}});
	}

	async pActivateRulesVersion ({accountId, campaignId, rulesVersionId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const rulesVersion = this._rulesVersions.get(rulesVersionId);
		if (!rulesVersion || rulesVersion.campaignId !== campaignId) throw new HubStoreError("RULES_NOT_FOUND", `Rules version was not found.`, {status: 404});
		this._campaigns.get(campaignId).activeRulesVersionId = rulesVersionId;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "rules.activated", targetType: "rules_version", targetId: rulesVersionId});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "rules.activated", aggregateType: "rules_version", aggregateId: rulesVersionId, payload: {version: rulesVersion.version}});
		return this._setReceipt({accountId, idempotencyKey, response: {rulesVersion}});
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
		const characters = [...this._characters.values()]
			.filter(character => character.campaignId === campaignId && character.status === "active")
			.map(character => {
				if (character.ownerAccountId === accountId || ["dm", "co_dm"].includes(membership.role)) return copy(character);
				return projectCharacterForPlayer(character);
			});
		return {
			campaign: copy(this._campaigns.get(campaignId)),
			membership: copy(membership),
			characters,
			lastSequence: Math.max(0, ...this._events.filter(event => event.campaignId === campaignId).map(event => event.sequence)),
		};
	}

	async pListVisibleEvents ({accountId, campaignId, afterSequence = 0, limit = 500}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return this._events
			.filter(event => event.campaignId === campaignId && event.sequence > afterSequence)
			.filter(event => canViewEvent({event, accountId, role: membership.role}))
			.slice(0, limit)
			.map(copy);
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

	async pCreateStructuredAction ({accountId, campaignId, targetCharacterId, effect, idempotencyKey}) {
		validateCloudValue(effect, {label: "Structured effect"});
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const target = this._getCharacterOrThrow(targetCharacterId);
		if (target.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		if (!STRUCTURED_EFFECT_TYPES.includes(effect?.type)) throw new HubStoreError("ACTION_INVALID", `Unsupported structured effect.`);
		const action = {
			id: crypto.randomUUID(),
			campaignId,
			actorAccountId: accountId,
			targetCharacterId,
			actionType: "structured_effect",
			status: "proposed",
			payload: {effect: copy(effect)},
			expiresAt: null,
			createdAt: this._fnNow().toISOString(),
		};
		this._pendingActions.set(action.id, action);
		this._appendEvent({campaignId, actorAccountId: accountId, type: "action.proposed", aggregateType: "pending_action", aggregateId: action.id, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, target.ownerAccountId])], payload: {targetCharacterId, effect}});
		return this._setReceipt({accountId, idempotencyKey, response: {action}});
	}

	async pResolveStructuredAction ({accountId, campaignId, actionId, decision, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const action = this._pendingActions.get(actionId);
		if (!action || action.campaignId !== campaignId || action.status !== "proposed") throw new HubStoreError("ACTION_NOT_FOUND", `Pending action was not found.`, {status: 404});
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const target = this._getCharacterOrThrow(action.targetCharacterId);
		if (target.ownerAccountId !== accountId && !["dm", "co_dm"].includes(membership.role)) {
			throw new HubStoreError("FORBIDDEN", `Only the target owner or DM can resolve this action.`, {status: 403});
		}
		if (decision === "accept") {
			const data = applyStructuredEffect({data: target.data, effect: action.payload.effect});
			validateCloudCharacterData(data);
			target.data = data;
			target.revision++;
			action.status = "applied";
		} else action.status = "rejected";
		action.resolvedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: `action.${action.status}`, targetType: "pending_action", targetId: action.id});
		this._appendEvent({campaignId, actorAccountId: accountId, type: `action.${action.status}`, aggregateType: "pending_action", aggregateId: action.id, visibility: "explicit_accounts", visibleAccountIds: [...new Set([action.actorAccountId, target.ownerAccountId])], payload: {targetCharacterId: target.id, effect: action.payload.effect, characterRevision: target.revision}});
		return this._setReceipt({accountId, idempotencyKey, response: {action, character: target}});
	}

	async pListPendingActions ({accountId, campaignId}) {
		const membership = this._getMembership({accountId, campaignId, isRequireActiveCampaign: false});
		return [...this._pendingActions.values()]
			.filter(action => action.campaignId === campaignId)
			.filter(action => {
				if (["dm", "co_dm"].includes(membership.role) || action.actorAccountId === accountId) return true;
				return this._characters.get(action.targetCharacterId)?.ownerAccountId === accountId;
			})
			.map(copy);
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
		character.data = data;
		character.revision++;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "xp.granted", targetType: "character", targetId: characterId, details: {amount, reason}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "xp.granted", aggregateType: "character", aggregateId: characterId, aggregateRevision: character.revision, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, character.ownerAccountId])], payload: {amount, reason, xp: character.data.xp}});
		return this._setReceipt({accountId, idempotencyKey, response: {character}});
	}

	async pGrantItem ({accountId, campaignId, characterId, item, quantity = 1, idempotencyKey}) {
		validateCloudValue(item, {label: "Granted item"});
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		this._getMembership({accountId, campaignId, roles: ["dm", "co_dm"]});
		const character = this._getCharacterOrThrow(characterId);
		if (character.campaignId !== campaignId) throw new HubStoreError("CHARACTER_NOT_FOUND", `Character was not found.`, {status: 404});
		const data = normalizeCharacterInventory(character.data);
		const entry = {id: crypto.randomUUID(), item: copy(item), quantity: Math.max(1, Math.floor(quantity))};
		data.inventory.push(entry);
		validateCloudCharacterData(data);
		character.data = data;
		character.revision++;
		this._appendAudit({campaignId, actorAccountId: accountId, action: "item.granted", targetType: "character", targetId: characterId, details: {entryId: entry.id, quantity: entry.quantity}});
		this._appendEvent({campaignId, actorAccountId: accountId, type: "item.granted", aggregateType: "character", aggregateId: characterId, aggregateRevision: character.revision, visibility: "explicit_accounts", visibleAccountIds: [...new Set([accountId, character.ownerAccountId])], payload: {entry}});
		return this._setReceipt({accountId, idempotencyKey, response: {character, entry}});
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

	_setTransferContainer ({holder, container}) {
		if (holder._character) {
			validateCloudCharacterData(container);
			holder._character.data = container;
			holder._character.revision++;
		} else {
			holder._party.inventory = container.inventory;
			holder._party.currency = container.currency;
			holder._party.revision++;
		}
	}

	async pProposeTransfer ({accountId, campaignId, sourceKind, sourceId, targetKind, targetId, payload, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const membership = this._getMembership({accountId, campaignId, roles: ["dm", "co_dm", "player"]});
		const source = this._getTransferContainer({kind: sourceKind, id: sourceId, campaignId});
		this._getTransferContainer({kind: targetKind, id: targetId, campaignId});
		if (sourceKind === "character" && source._character.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the owner can transfer from this character.`, {status: 403});
		if (sourceKind === "party_inventory" && !["dm", "co_dm"].includes(membership.role)) throw new HubStoreError("FORBIDDEN", `Only a DM can transfer from party inventory.`, {status: 403});
		const {container, escrow} = removeTransferPayload({container: source.container, payload});
		this._setTransferContainer({holder: source, container});
		const transfer = {
			id: crypto.randomUUID(),
			campaignId,
			actorAccountId: accountId,
			sourceKind,
			sourceId,
			targetKind,
			targetId,
			status: "reserved",
			payload: {escrow},
			createdAt: this._fnNow().toISOString(),
		};
		this._transfers.set(transfer.id, transfer);
		this._appendEvent({campaignId, actorAccountId: accountId, type: "transfer.reserved", aggregateType: "transfer", aggregateId: transfer.id, payload: {sourceKind, sourceId, targetKind, targetId}});
		return this._setReceipt({accountId, idempotencyKey, response: {transfer}});
	}

	async pResolveTransfer ({accountId, campaignId, transferId, decision, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const membership = this._getMembership({accountId, campaignId});
		const transfer = this._transfers.get(transferId);
		if (!transfer || transfer.campaignId !== campaignId || transfer.status !== "reserved") throw new HubStoreError("TRANSFER_NOT_FOUND", `Transfer was not found.`, {status: 404});
		const target = this._getTransferContainer({kind: transfer.targetKind, id: transfer.targetId, campaignId});
		const canResolve = transfer.targetKind === "character"
			? target._character.ownerAccountId === accountId || ["dm", "co_dm"].includes(membership.role)
			: ["dm", "co_dm"].includes(membership.role);
		if (!canResolve) throw new HubStoreError("FORBIDDEN", `Cannot resolve this transfer.`, {status: 403});
		const destination = decision === "accept"
			? target
			: this._getTransferContainer({kind: transfer.sourceKind, id: transfer.sourceId, campaignId});
		this._setTransferContainer({
			holder: destination,
			container: addTransferPayload({container: destination.container, escrow: transfer.payload.escrow, isRestore: decision !== "accept"}),
		});
		transfer.status = decision === "accept" ? "committed" : "rejected";
		transfer.resolvedAt = this._fnNow().toISOString();
		this._appendAudit({campaignId, actorAccountId: accountId, action: `transfer.${transfer.status}`, targetType: "transfer", targetId: transfer.id});
		this._appendEvent({campaignId, actorAccountId: accountId, type: `transfer.${transfer.status}`, aggregateType: "transfer", aggregateId: transfer.id, payload: {sourceId: transfer.sourceId, targetId: transfer.targetId}});
		return this._setReceipt({accountId, idempotencyKey, response: {transfer}});
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
			.map(copy);
	}

	_cancelIncomingForCharacter ({character}) {
		for (const action of this._pendingActions.values()) {
			if (action.targetCharacterId === character.id && action.status === "proposed") action.status = "cancelled";
		}
		for (const transfer of this._transfers.values()) {
			if (transfer.status !== "reserved" || transfer.targetKind !== "character" || transfer.targetId !== character.id) continue;
			const source = this._getTransferContainer({kind: transfer.sourceKind, id: transfer.sourceId, campaignId: transfer.campaignId});
			this._setTransferContainer({
				holder: source,
				container: addTransferPayload({container: source.container, escrow: transfer.payload.escrow, isRestore: true}),
			});
			transfer.status = "cancelled";
			transfer.resolvedAt = this._fnNow().toISOString();
			this._appendEvent({campaignId: transfer.campaignId, actorAccountId: character.ownerAccountId, type: "transfer.cancelled", aggregateType: "transfer", aggregateId: transfer.id, payload: {reason: "target_lifecycle_change"}});
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

	async pExportAccountData ({accountId}) {
		const account = this._accounts.get(accountId);
		if (!account) throw new HubStoreError("ACCOUNT_NOT_FOUND", `Account was not found.`, {status: 404});
		const memberships = [...this._memberships.values()].filter(it => it.accountId === accountId);
		const campaignIds = new Set(memberships.map(it => it.campaignId));
		return {
			exportedAt: this._fnNow().toISOString(),
			account: copy(account),
			memberships: copy(memberships),
			campaigns: [...campaignIds].map(id => copy(this._campaigns.get(id))),
			characters: [...this._characters.values()].filter(it => it.ownerAccountId === accountId).map(copy),
			auditEntries: this._audit.filter(it => it.actorAccountId === accountId).map(copy),
		};
	}

	async pArchiveCampaign ({accountId, campaignId, idempotencyKey}) {
		const prior = this._getReceipt({accountId, idempotencyKey});
		if (prior) return prior;
		const campaign = this._campaigns.get(campaignId);
		if (!campaign || campaign.ownerAccountId !== accountId) throw new HubStoreError("FORBIDDEN", `Only the campaign owner can archive it.`, {status: 403});
		if ([...this._transfers.values()].some(it => it.campaignId === campaignId && it.status === "reserved")) {
			throw new HubStoreError("CAMPAIGN_BUSY", `Resolve reserved transfers before archiving.`, {status: 409});
		}
		campaign.status = "archived";
		for (const action of this._pendingActions.values()) {
			if (action.campaignId === campaignId && action.status === "proposed") action.status = "cancelled";
		}
		for (const character of this._characters.values()) {
			if (character.campaignId !== campaignId) continue;
			character.campaignId = null;
			character.revision++;
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
