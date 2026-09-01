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

	async _pRequest (path, {method = "GET", body = null, isMutation = false, idempotencyKey = null} = {}) {
		const headers = {accept: "application/json", "x-hub-protocol-version": "2"};
		if (body != null) headers["content-type"] = "application/json";
		if (isMutation) {
			if (!this._csrfToken) throw new HubApiError({code: "CSRF_NOT_READY", status: 0});
			headers["x-csrf-token"] = this._csrfToken;
			headers["idempotency-key"] = idempotencyKey || crypto.randomUUID();
		}
		let response;
		try {
			response = await this._fnFetch(path, {
				method,
				credentials: "same-origin",
				headers,
				body: body == null ? undefined : JSON.stringify(body),
			});
		} catch (error) {
			if (error instanceof HubApiError) throw error;
			throw new HubApiError({
				code: "NETWORK_UNAVAILABLE",
				status: 0,
				cause: error,
			});
		}
		const data = response.status === 204 ? null : await response.json().catch(() => null);
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

	async pGetSession () {
		const session = await this._pRequest("/api/session");
		this._csrfToken = session?.signedIn ? session.csrfToken : null;
		return session;
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

	async pGetCampaign ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}`)).campaign;
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

	async pGetCampaignContext ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/context`)).context;
	}

	async pGetCampaignCompatibility ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/compatibility`)).compatibility;
	}

	async pGetCampaignSnapshot ({campaignId}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/snapshot`)).snapshot;
	}

	async pListEvents ({campaignId, afterSequence = 0, limit = 200}) {
		return (await this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/events?afterSequence=${afterSequence}&limit=${limit}`)).events;
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

	async pGetCharacter ({characterId}) {
		return (await this._pRequest(`/api/characters/${encodeURIComponent(characterId)}`)).character;
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

	async pCreateStructuredAction ({campaignId, targetCharacterId, effect, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`, {
			method: "POST", body: {targetCharacterId, effect}, isMutation: true, idempotencyKey,
		});
	}

	async pResolveStructuredAction ({campaignId, actionId, decision, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions/${encodeURIComponent(actionId)}/resolve`, {
			method: "POST", body: {decision}, isMutation: true, idempotencyKey,
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
