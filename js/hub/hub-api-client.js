import {isCanonicalProjection} from "./hub-character-view.js";

export class HubApiError extends Error {
	constructor ({code, status, message = null, details = null, cause = null}) {
		super(message || code || `Hub request failed.`);
		this.name = "HubApiError";
		this.code = code || "REQUEST_FAILED";
		this.status = status;
		this.details = details;
		this.cause = cause;
	}
}

export class HubApiClient {
	constructor ({fnFetch = null} = {}) {
		this._fnFetch = fnFetch || globalThis.fetch.bind(globalThis);
		this._csrfToken = null;
	}

	static _isAbort (error, signal) {
		return signal?.aborted || error?.name === "AbortError" || error?.code === 20;
	}

	async _pRequest (path, {method = "GET", body = null, isMutation = false, idempotencyKey = null, signal = null} = {}) {
		const headers = {accept: "application/json", "x-hub-protocol-version": "3"};
		if (body != null) headers["content-type"] = "application/json";
		if (isMutation) {
			if (!this._csrfToken) throw new HubApiError({code: "CSRF_NOT_READY", status: 0});
			headers["x-csrf-token"] = this._csrfToken;
			headers["idempotency-key"] = idempotencyKey || crypto.randomUUID();
		}
		if (signal?.aborted) throw new HubApiError({code: "REQUEST_ABORTED", status: 0});
		let response;
		try {
			response = await this._fnFetch(path, {
				method,
				credentials: "same-origin",
				headers,
				body: body == null ? undefined : JSON.stringify(body),
				signal: signal || undefined,
			});
		} catch (error) {
			if (error instanceof HubApiError) throw error;
			// A cancellation is not evidence of connectivity loss, so it must never be reported as
			// `NETWORK_UNAVAILABLE` — that code makes callers retain state on an "offline" path.
			throw new HubApiError({
				code: HubApiClient._isAbort(error, signal) ? "REQUEST_ABORTED" : "NETWORK_UNAVAILABLE",
				status: 0,
				cause: error,
			});
		}
		// The body read is a second cancellation point: aborting mid-stream rejects here, not above.
		let data = null;
		if (response.status !== 204) {
			try {
				data = await response.json();
			} catch (error) {
				if (HubApiClient._isAbort(error, signal)) throw new HubApiError({code: "REQUEST_ABORTED", status: 0, cause: error});
				data = null;
			}
		}
		if (signal?.aborted) throw new HubApiError({code: "REQUEST_ABORTED", status: 0});
		if (!response.ok) {
			throw new HubApiError({
				code: data?.error || "REQUEST_FAILED",
				status: response.status,
				details: data?.details || null,
			});
		}
		if (response.status !== 204 && data == null) {
			throw new HubApiError({
				code: "RESPONSE_INVALID",
				status: response.status,
			});
		}
		return data;
	}

	async pGetSession ({signal = null} = {}) {
		const session = await this._pRequest("/api/session", {signal});
		this._csrfToken = session?.signedIn ? session.csrfToken : null;
		return session;
	}

	async pGetMeta ({signal = null} = {}) {
		return this._pRequest("/api/meta", {signal});
	}

	async pListCampaigns () {
		return (await this._pRequest("/api/campaigns")).campaigns;
	}

	async pListSessions () {
		return (await this._pRequest("/api/account/sessions")).sessions;
	}

	async pRevokeSession ({sessionId, idempotencyKey}) {
		return this._pRequest(`/api/account/sessions/${encodeURIComponent(sessionId)}/revoke`, {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pRevokeOtherSessions ({idempotencyKey}) {
		return this._pRequest("/api/account/sessions/revoke-others", {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetAccountDeletion () {
		return (await this._pRequest("/api/account/deletion")).deletion;
	}

	async pRequestAccountDeletion ({idempotencyKey}) {
		return this._pRequest("/api/account/deletion/request", {
			method: "POST",
			body: {confirmation: "DELETE"},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCancelAccountDeletion ({idempotencyKey}) {
		return this._pRequest("/api/account/deletion/cancel", {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetCampaign ({campaignId, signal = null}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}`, {signal})).campaign;
	}

	async pListMembers ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/members`)).members;
	}

	async pChangeMemberRole ({campaignId, membershipId, role, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(membershipId)}`, {
			method: "PATCH",
			body: {role},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pRemoveMember ({campaignId, membershipId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(membershipId)}`, {
			method: "DELETE",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pLeaveCampaign ({campaignId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/leave`, {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetCampaignContext ({campaignId, signal = null}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/context`, {signal})).context;
	}

	async pGetCampaignCompatibility ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/compatibility`)).compatibility;
	}

	async pGetCampaignSnapshot ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/snapshot`)).snapshot;
	}

	async pListEvents ({campaignId, afterSequence = 0, limit = 200}) {
		return (await this.pListEventPage({campaignId, afterSequence, limit})).events;
	}

	async pListEventPage ({campaignId, afterSequence = 0, limit = 200}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/events?afterSequence=${afterSequence}&limit=${limit}`);
	}

	async pLogRoll ({campaignId, characterId = null, formula, total, context = null, visibility = "all_members", detail = {}, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rolls`, {
			method: "POST",
			body: {characterId, formula, total, context, visibility, detail},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCreateCampaign ({name, idempotencyKey}) {
		return this._pRequest("/api/campaigns", {
			method: "POST",
			body: {name},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCreateInvite ({campaignId, role, expiresInHours = 168, maxUses = 1, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/invites`, {
			method: "POST",
			body: {role, expiresInHours, maxUses},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pListInvites ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/invites`)).invites;
	}

	async pRevokeInvite ({campaignId, inviteId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/invites/${encodeURIComponent(inviteId)}/revoke`, {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pRedeemInvite ({token, idempotencyKey}) {
		return this._pRequest("/api/invites/redeem", {
			method: "POST",
			body: {token},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pListCharacters ({campaignId = null} = {}) {
		const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
		return (await this._pRequest(`/api/characters${query}`)).characters;
	}

	/** The raw ADR 0011 authorization envelope: `owner_truth`, `dm_truth` or `peer_profile`. */
	async pGetCharacterProjection ({characterId}) {
		return (await this._pRequest(`/api/characters/${encodeURIComponent(characterId)}`)).projection;
	}

	/**
	 * The canonical character document, for owner/DM surfaces only. Throws rather than
	 * degrading when the requester holds a peer profile, so a projection can never be
	 * mistaken for truth.
	 */
	async pGetCharacter ({characterId}) {
		const projection = await this.pGetCharacterProjection({characterId});
		if (!isCanonicalProjection(projection)) {
			throw new HubApiError({code: "CHARACTER_PROJECTION_SCOPED", status: 403});
		}
		return projection.character;
	}

	async pListCampaignCharacterProjections ({campaignId}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/character-projections`);
	}

	async pGetProjectionPolicy ({characterId}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/projection-policy`);
	}

	async pSetProjectionPolicy ({characterId, policy, expectedProjectionRevision, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/projection-policy`, {
			method: "PUT",
			body: {policy, expectedProjectionRevision},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCreateCharacter ({clientImportId, campaignId = null, schemaVersion = 1, data, idempotencyKey}) {
		return this._pRequest("/api/characters", {
			method: "POST",
			body: {clientImportId, campaignId, schemaVersion, data},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pAcquireCharacterLease ({characterId, isTakeover = false}) {
		return (await this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/lease`, {
			method: "POST",
			body: {takeover: isTakeover},
			isMutation: true,
		})).lease;
	}

	async pReleaseCharacterLease ({characterId}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/lease/release`, {
			method: "POST",
			body: {},
			isMutation: true,
		});
	}

	async pPatchCharacter ({characterId, baseRevision, leaseEpoch, patches, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}`, {
			method: "PATCH",
			body: {baseRevision, leaseEpoch, patches},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCloneCharacter ({characterId, campaignId, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/clone`, {
			method: "POST",
			body: {campaignId},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pMoveCharacter ({characterId, campaignId, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/move`, {
			method: "POST",
			body: {campaignId},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pArchiveCharacter ({characterId, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}`, {
			method: "DELETE",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCreateBrewBundleVersion ({campaignId, brewDocs, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/brew-versions`, {
			method: "POST",
			body: {brewDocs},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pActivateBrewBundleVersion ({campaignId, versionId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/brew-versions/${encodeURIComponent(versionId)}/activate`, {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCreateRulesVersion ({campaignId, rules, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-versions`, {
			method: "POST",
			body: {rules},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pActivateRulesVersion ({campaignId, versionId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-versions/${encodeURIComponent(versionId)}/activate`, {
			method: "POST",
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetRulesPolicyManagement ({campaignId}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`);
	}

	async pPublishRulesPolicy ({campaignId, policy, expectedActiveRulesVersionId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`, {
			method: "POST",
			body: {policy, expectedActiveRulesVersionId},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pActivateRulesPolicyVersion ({campaignId, rulesVersionId, expectedActiveRulesVersionId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy/activate`, {
			method: "POST",
			body: {rulesVersionId, expectedActiveRulesVersionId},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetDmWorkspace ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/dm-workspace`)).workspace;
	}

	async pAcquireDmWorkspaceLease ({campaignId, workspaceId, isTakeover = false}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/dm-workspace/${encodeURIComponent(workspaceId)}/lease`, {
			method: "POST",
			body: {takeover: isTakeover},
			isMutation: true,
		})).lease;
	}

	async pWriteDmWorkspace ({campaignId, workspaceId, baseRevision, leaseEpoch, state, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/dm-workspace/${encodeURIComponent(workspaceId)}`, {
			method: "PUT",
			body: {baseRevision, leaseEpoch, state},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pListPendingActions ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`)).actions;
	}

	async pListCharacterPendingActions ({campaignId, characterId}) {
		return (await this._pRequest(
			`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/pending-actions`,
		)).actions;
	}

	async pCreateStructuredAction ({campaignId, targetCharacterId, operation, idempotencyKey}) {
		const commandId = idempotencyKey || crypto.randomUUID();
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`, {
			method: "POST",
			body: {commandId, targetCharacterId, operation},
			isMutation: true,
			idempotencyKey: commandId,
		});
	}

	async pCreatePeerAction ({campaignId, sourceCharacterId, sourceEntity, effectTemplateId, choice, targetRef, idempotencyKey}) {
		const commandId = idempotencyKey || crypto.randomUUID();
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`, {
			method: "POST",
			body: {commandId, sourceCharacterId, sourceEntity, effectTemplateId, choice, targetRef},
			isMutation: true,
			idempotencyKey: commandId,
		});
	}

	async pResolveStructuredAction ({campaignId, actionId, decision, idempotencyKey}) {
		const commandId = idempotencyKey || crypto.randomUUID();
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions/${encodeURIComponent(actionId)}/resolve`, {
			method: "POST",
			body: {commandId, decision},
			isMutation: true,
			idempotencyKey: commandId,
		});
	}

	async pGrantXp ({campaignId, characterId, amount, reason = null, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/xp-grants`, {
			method: "POST", body: {amount, reason}, isMutation: true, idempotencyKey,
		});
	}

	async pGrantItem ({campaignId, characterId, item, quantity = 1, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/item-grants`, {
			method: "POST", body: {item, quantity}, isMutation: true, idempotencyKey,
		});
	}

	async pAwardItems ({campaignId, source, targetCharacterIds, quantity = 1, note = null, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/item-awards`, {
			method: "POST",
			body: {source, targetCharacterIds, quantity, note},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pGetPartyInventory ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/party-inventory`)).partyInventory;
	}

	async pListTransfers ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers`)).transfers;
	}

	async pProposeTransfer ({campaignId, sourceKind, sourceId, targetKind, targetId, payload, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers`, {
			method: "POST", body: {sourceKind, sourceId, targetKind, targetId, payload}, isMutation: true, idempotencyKey,
		});
	}

	async pResolveTransfer ({campaignId, transferId, decision, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers/${encodeURIComponent(transferId)}/resolve`, {
			method: "POST", body: {decision}, isMutation: true, idempotencyKey,
		});
	}

	async pLogout () {
		const out = await this._pRequest("/api/logout", {method: "POST", isMutation: true});
		this._csrfToken = null;
		return out;
	}

	async pExportAccountData () {
		return this._pRequest("/api/account/export");
	}

	async pArchiveCampaign ({campaignId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/archive`, {
			method: "POST", isMutation: true, idempotencyKey,
		});
	}

	async pTransferCampaignOwnership ({campaignId, targetAccountId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfer-ownership`, {
			method: "POST", body: {targetAccountId}, isMutation: true, idempotencyKey,
		});
	}
}
