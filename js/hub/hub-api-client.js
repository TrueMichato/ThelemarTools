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

export const HUB_TRANSFER_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function isTransferOutcomeUncertain (error) {
	return ["NETWORK_UNAVAILABLE", "REQUEST_ABORTED", "RESPONSE_INVALID"].includes(error?.code) || error?.status >= 500;
}

export class HubTransferRefreshQueue {
	constructor () {
		this._queue = Promise.resolve();
	}

	pRun (fnRefresh) {
		if (typeof fnRefresh !== "function") throw new TypeError(`fnRefresh must be a function.`);
		const pResult = this._queue.then(fnRefresh, fnRefresh);
		this._queue = pResult.catch(() => {});
		return pResult;
	}
}

export class HubTransferResolutionDrafts {
	constructor ({
		fnCreateKey = () => globalThis.crypto.randomUUID(),
		fnNow = () => Date.now(),
		replayWindowMs = HUB_TRANSFER_REPLAY_WINDOW_MS,
	} = {}) {
		this._fnCreateKey = fnCreateKey;
		this._fnNow = fnNow;
		this._replayWindowMs = replayWindowMs;
		this._drafts = new Map();
	}

	_getRef ({campaignId, transferId}) {
		return `${campaignId}\u0000${transferId}`;
	}

	get ({campaignId, transferId}) {
		const draft = this._drafts.get(this._getRef({campaignId, transferId}));
		return draft ? structuredClone(draft) : null;
	}

	stage ({campaignId, transferId, decision, rulesVersionId = null, idempotencyKey = undefined}) {
		const existing = this.get({campaignId, transferId});
		if (existing) return existing;
		const draft = {
			campaignId,
			transferId,
			decision,
			rulesVersionId,
			idempotencyKey: idempotencyKey ?? this._fnCreateKey(),
			replayUntil: this._fnNow() + this._replayWindowMs,
		};
		this._drafts.set(this._getRef({campaignId, transferId}), draft);
		return structuredClone(draft);
	}

	isReplayable (draft) {
		return Number.isFinite(draft?.replayUntil) && this._fnNow() < draft.replayUntil;
	}

	clear ({campaignId, transferId, idempotencyKey}) {
		const ref = this._getRef({campaignId, transferId});
		const draft = this._drafts.get(ref);
		if (draft?.idempotencyKey !== idempotencyKey) return false;
		this._drafts.delete(ref);
		return true;
	}

	reconcilePending ({campaignId, pendingTransferIds}) {
		const pending = new Set(pendingTransferIds);
		const prefix = `${campaignId}\u0000`;
		for (const [ref, draft] of this._drafts.entries()) {
			if (!ref.startsWith(prefix)) continue;
			if (!pending.has(draft.transferId) || !this.isReplayable(draft)) this._drafts.delete(ref);
		}
	}
}

export async function pResolveTransferFromDraft ({
	drafts,
	campaignId,
	transferId,
	decision = "accept",
	idempotencyKey = undefined,
	pGetRulesVersionId = async () => null,
	pResolve,
}) {
	let request = drafts.get({campaignId, transferId});
	if (request && !drafts.isReplayable(request)) {
		throw new HubApiError({code: "IDEMPOTENCY_WINDOW_EXPIRED", status: 0});
	}
	if (request && request.decision !== decision) {
		throw new HubApiError({code: "IDEMPOTENCY_KEY_REUSED", status: 409});
	}
	if (!request) {
		request = drafts.stage({
			campaignId,
			transferId,
			decision,
			rulesVersionId: decision === "accept" ? await pGetRulesVersionId() : null,
			...(idempotencyKey === undefined ? {} : {idempotencyKey}),
		});
	}
	try {
		const result = await pResolve(request);
		drafts.clear({...request});
		return result;
	} catch (error) {
		if (!isTransferOutcomeUncertain(error)) drafts.clear({...request});
		throw error;
	}
}

export class HubTransferProposalDrafts {
	constructor ({
		fnNow = () => Date.now(),
		replayWindowMs = HUB_TRANSFER_REPLAY_WINDOW_MS,
	} = {}) {
		this._fnNow = fnNow;
		this._replayWindowMs = replayWindowMs;
		this._drafts = new Map();
	}

	_getRef ({accountId, campaignId}) {
		return `${accountId}\u0000${campaignId}`;
	}

	get ({accountId, campaignId}) {
		const draft = this._drafts.get(this._getRef({accountId, campaignId}));
		return draft ? structuredClone(draft) : null;
	}

	stage ({accountId, campaignId, request}) {
		const existing = this.get({accountId, campaignId});
		if (existing) return existing;
		const draft = {
			...structuredClone(request),
			replayUntil: this._fnNow() + this._replayWindowMs,
		};
		this._drafts.set(this._getRef({accountId, campaignId}), draft);
		return structuredClone(draft);
	}

	isReplayable (draft) {
		return Number.isFinite(draft?.replayUntil) && this._fnNow() < draft.replayUntil;
	}

	clear ({accountId, campaignId, idempotencyKey}) {
		const ref = this._getRef({accountId, campaignId});
		const draft = this._drafts.get(ref);
		if (draft?.idempotencyKey !== idempotencyKey) return false;
		this._drafts.delete(ref);
		return true;
	}

	static _getComparablePayload (payload = {}) {
		const value = payload.request || payload.escrow || payload;
		const items = (value.items || [])
			.map(item => ({
				entryId: item.entryId || item.id,
				quantity: Number(item.quantity),
			}))
			.sort((a, b) => `${a.entryId}`.localeCompare(`${b.entryId}`) || a.quantity - b.quantity);
		const currency = Object.fromEntries(["pp", "gp", "ep", "sp", "cp"]
			.map(type => [type, Number(value.currency?.[type]) || 0]));
		return JSON.stringify({items, currency});
	}

	static _isProjectedTransferMatch ({transfer, request}) {
		if (
			!transfer
			|| transfer.sourceKind !== request.sourceKind
			|| transfer.targetKind !== request.targetKind
			|| (transfer.sourceId && transfer.sourceId !== request.sourceId)
			|| (transfer.targetId && transfer.targetId !== request.targetId)
		) return false;
		return this._getComparablePayload(transfer.payload) === this._getComparablePayload(request.payload);
	}

	static reconcileExpiredProposal ({proposalRequest, transfers = []}) {
		if (!proposalRequest?.idempotencyKey || !Array.isArray(transfers)) return {state: "ambiguous"};
		const exactMatches = transfers.filter(transfer => transfer.actorCommandId === proposalRequest?.idempotencyKey);
		if (exactMatches.length > 1) return {state: "ambiguous"};
		if (exactMatches.length === 1) {
			const transfer = exactMatches[0];
			return {
				state: ["proposed", "reserved"].includes(transfer.status) ? "pending" : "terminal",
				transfer,
			};
		}

		const legacyMatches = transfers.filter(transfer => !transfer.actorCommandId
			&& ["proposed", "reserved"].includes(transfer.status)
			&& this._isProjectedTransferMatch({transfer, request: proposalRequest}));
		if (legacyMatches.length > 1) return {state: "ambiguous"};
		if (legacyMatches.length === 1) return {state: "pending", transfer: legacyMatches[0], isLegacy: true};
		return {state: "absent"};
	}
}

export async function pResolveTransferAndRefresh ({pResolve, pRefresh}) {
	let resolution;
	try {
		resolution = await pResolve();
	} catch (resolutionError) {
		try {
			return {
				state: "resolution_failed_refreshed",
				resolutionError,
				refreshResult: await pRefresh(),
			};
		} catch (refreshError) {
			return {
				state: "resolution_failed_refresh_failed",
				resolutionError,
				refreshError,
			};
		}
	}

	try {
		return {
			state: "resolved_refreshed",
			resolution,
			refreshResult: await pRefresh(),
		};
	} catch (refreshError) {
		return {
			state: "resolved_refresh_failed",
			resolution,
			refreshError,
		};
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
		const headers = {accept: "application/json", "x-hub-protocol-version": "4"};
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

	async pListEventPage ({campaignId, afterSequence = null, beforeSequence = null, limit = 200}) {
		if (afterSequence != null && beforeSequence != null) throw new TypeError(`Only one event cursor may be supplied.`);
		const cursor = beforeSequence == null
			? `afterSequence=${afterSequence ?? 0}`
			: `beforeSequence=${beforeSequence}`;
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/events?${cursor}&limit=${limit}`);
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

	async pCreateCharacter ({clientImportId, campaignId = null, schemaVersion = 1, data, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest("/api/characters", {
			method: "POST",
			body: {clientImportId, campaignId, schemaVersion, data, ...(rulesVersionId ? {rulesVersionId} : {})},
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

	async pPatchCharacter ({characterId, baseRevision, leaseEpoch, patches, activity = null, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}`, {
			method: "PATCH",
			body: {baseRevision, leaseEpoch, patches, ...(activity ? {activity} : {}), ...(rulesVersionId ? {rulesVersionId} : {})},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pCloneCharacter ({characterId, campaignId, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/clone`, {
			method: "POST",
			body: {campaignId, ...(rulesVersionId ? {rulesVersionId} : {})},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pMoveCharacter ({characterId, campaignId, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest(`/api/characters/${encodeURIComponent(characterId)}/move`, {
			method: "POST",
			body: {
				campaignId,
				...(rulesVersionId == null ? {} : {rulesVersionId}),
			},
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

	async pCreatePeerAction ({campaignId, contractVersion = 1, sourceCharacterId, sourceEntity, effectTemplateId, choice, targetRef, rulesVersionId, idempotencyKey}) {
		const commandId = idempotencyKey || crypto.randomUUID();
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`, {
			method: "POST",
			body: {contractVersion, commandId, sourceCharacterId, sourceEntity, effectTemplateId, choice, targetRef, rulesVersionId},
			isMutation: true,
			idempotencyKey: commandId,
		});
	}

	async pListCharacterOutgoingActions ({campaignId, characterId}) {
		return (await this._pRequest(
			`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/outgoing-actions`,
		)).actions;
	}

	async pResolveStructuredAction ({campaignId, actionId, decision, contractVersion = null, idempotencyKey}) {
		const commandId = idempotencyKey || crypto.randomUUID();
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/actions/${encodeURIComponent(actionId)}/resolve`, {
			method: "POST",
			body: {commandId, decision, ...(contractVersion == null ? {} : {contractVersion})},
			isMutation: true,
			idempotencyKey: commandId,
		});
	}

	async pGrantXp ({campaignId, characterId, amount, reason = null, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/xp-grants`, {
			method: "POST", body: {amount, reason}, isMutation: true, idempotencyKey,
		});
	}

	async pGrantItem ({campaignId, characterId, item, quantity = 1, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}/item-grants`, {
			method: "POST", body: {item, quantity, ...(rulesVersionId ? {rulesVersionId} : {})}, isMutation: true, idempotencyKey,
		});
	}

	async pAwardItems ({campaignId, source, targetCharacterIds, quantity = 1, note = null, rulesVersionId = null, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/item-awards`, {
			method: "POST",
			body: {source, targetCharacterIds, quantity, note, ...(rulesVersionId ? {rulesVersionId} : {})},
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

	async pProposeTransfer ({campaignId, sourceKind, sourceId, targetKind, targetId, payload, rulesVersionId, idempotencyKey}) {
		return this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers`, {
			method: "POST",
			body: {
				sourceKind,
				sourceId,
				targetKind,
				targetId,
				payload,
				...(rulesVersionId === undefined ? {} : {rulesVersionId}),
			},
			isMutation: true,
			idempotencyKey,
		});
	}

	async pResolveTransfer ({campaignId, transferId, decision, rulesVersionId, idempotencyKey}) {
		const pResolve = pin => this._pRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers/${encodeURIComponent(transferId)}/resolve`, {
			method: "POST",
			body: {decision, ...(pin == null ? {} : {rulesVersionId: pin})},
			isMutation: true,
			idempotencyKey,
		});
		if (decision !== "accept") return pResolve(rulesVersionId);
		let pin = rulesVersionId;
		if (pin === undefined) pin = (await this.pGetCampaignContext({campaignId})).rulesVersion?.id || null;
		return pResolve(pin);
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
