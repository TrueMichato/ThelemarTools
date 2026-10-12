import {getAppliedEffectNotice} from "../hub/hub-effect-presentation.js";
import {getMultiTargetResultDelivery, hasMultiTargetOperationsCapability} from "../hub/hub-multi-target-operations.js";
import {getCampaignCharacterSheetUrl} from "../hub/hub-character-sheet-routes.js";

const {e_} = /** @type {*} */ (globalThis);

const _NOTICE_LIFETIME_MS = 15_000;
const _MAX_NOTICES = 3;
const _MAX_PERSISTENT_NOTICES = 3;
const _MAX_ERROR_LENGTH = 160;
const _CAPABILITY_LOSS_CODES = new Set([
	"AUTH_REQUIRED",
	"CAMPAIGN_NOT_FOUND",
	"CHARACTER_CAMPAIGN_MISMATCH",
	"CHARACTER_NOT_FOUND",
	"FORBIDDEN",
]);

const _getSafeErrorMessage = error => {
	switch (error?.code) {
		case "ACTION_NOT_FOUND": return "This request is no longer pending. Refreshing the list…";
		case "ACTION_EXPIRED": return "This request expired before it could be resolved.";
		case "FORBIDDEN": return "You are no longer authorized to resolve this request.";
		case "AUTH_REQUIRED": return "Your Campaign Hub session ended. Sign in again to continue.";
		default: return "The Campaign Hub could not resolve this request. Try again.";
	}
};

export class CharacterSheetHubEffects {
	constructor ({
		campaignId,
		api,
		root,
		fnCreateId = () => crypto.randomUUID(),
		fnSetTimeout = (fn, ms) => setTimeout(fn, ms),
		fnClearTimeout = timer => clearTimeout(timer),
		fnOnAuthoritativeApproval = null,
		fnGetMultiTargetCapability = () => null,
		fnGetCharacterId = null,
		fnIsOwner = null,
		fnGetAuthorityVersion = () => null,
	} = {}) {
		this._campaignId = campaignId;
		this._api = api;
		this._root = root;
		this._fnCreateId = fnCreateId;
		this._fnSetTimeout = fnSetTimeout;
		this._fnClearTimeout = fnClearTimeout;
		this._fnOnAuthoritativeApproval = fnOnAuthoritativeApproval;
		this._fnGetMultiTargetCapability = fnGetMultiTargetCapability;
		this._fnGetCharacterId = fnGetCharacterId;
		this._fnIsOwner = fnIsOwner;
		this._fnGetAuthorityVersion = fnGetAuthorityVersion;
		this._authorityVersion = null;
		this._generation = 0;
		this._collectionRevision = 0;
		this._characterId = null;
		this._isAuthorized = false;
		this._isCapabilityRevoked = false;
		this._isLoading = false;
		this._loadError = null;
		this._actions = new Map();
		this._notices = new Map();
		this._seenAppliedOperationIds = new Set();
		this._noticeTimers = new Map();
		this._commandIds = new Map();
		this._multiCommands = new Map();
		this._pRefreshActive = null;
		this._onFocus = () => {
			if (this._characterId) void this.pRefresh();
		};
		this._onVisibilityChange = () => {
			if (document.visibilityState === "visible" && this._characterId) void this.pRefresh();
		};
	}

	init () {
		if (!this._root || !this._api || !this._campaignId) return false;
		window.addEventListener("focus", this._onFocus);
		document.addEventListener("visibilitychange", this._onVisibilityChange);
		this._render();
		return true;
	}

	destroy () {
		this.deactivate();
		window.removeEventListener("focus", this._onFocus);
		document.removeEventListener("visibilitychange", this._onVisibilityChange);
	}

	activate ({characterId}) {
		if (characterId && this._characterId === characterId && this._isCapabilityRevoked) {
			this._authorityVersion = this._fnGetAuthorityVersion();
			this._isCapabilityRevoked = false;
			void this.pRefresh();
			return true;
		}
		this.deactivate();
		if (!characterId || !this._api || !this._campaignId) return false;
		this._generation++;
		this._collectionRevision = 0;
		this._characterId = characterId;
		this._authorityVersion = this._fnGetAuthorityVersion();
		this._isCapabilityRevoked = false;
		void this.pRefresh();
		return true;
	}

	deactivate () {
		this._generation++;
		this._collectionRevision = 0;
		this._characterId = null;
		this._isAuthorized = false;
		this._isCapabilityRevoked = false;
		this._isLoading = false;
		this._loadError = null;
		this._actions.clear();
		this._notices.clear();
		this._seenAppliedOperationIds.clear();
		this._commandIds.clear();
		this._multiCommands.clear();
		for (const timer of this._noticeTimers.values()) this._fnClearTimeout(timer);
		this._noticeTimers.clear();
		this._pRefreshActive = null;
		this._render();
	}

	async pRefresh () {
		if (!this._characterId || this._isCapabilityRevoked) return false;
		if (!this._isCurrent({generation: this._generation, characterId: this._characterId})) {
			this._revokeApprovalCapability();
			return false;
		}
		if (this._pRefreshActive) return this._pRefreshActive;
		const token = {
			generation: this._generation,
			characterId: this._characterId,
			collectionRevision: this._collectionRevision,
		};
		this._isLoading = true;
		this._loadError = null;
		this._renderApprovals();
		let isCollectionStale = false;

		const promise = this._api.pListCharacterPendingActions({
			campaignId: this._campaignId,
			characterId: token.characterId,
		})
			.then(async actions => {
				if (!this._isCurrent(token)) return false;
				const multiActions = [];
				if (this._hasMultiCapability()) {
					let cursor = null;
					const seenCursors = new Set();
					const invitations = [];
					do {
						const page = await this._api.pListMultiTargetInbox({campaignId: this._campaignId, mode: "recovery", limit: 100, ...(cursor ? {cursor} : {})});
						if (!this._isCurrent(token)) return false;
						invitations.push(...(page?.invitations || []));
						cursor = page?.nextCursor ?? null;
						if (cursor && seenCursors.has(cursor)) throw Object.assign(new Error("Repeated inbox cursor."), {code: "RESPONSE_INVALID"});
						if (cursor) seenCursors.add(cursor);
					} while (cursor);
					const owned = await this._pLoadOwnedCharacters(token);
					if (!this._isCurrent(token)) return false;
					for (const invitation of invitations) {
						const normalized = this._normalizeMultiInvitation(invitation, owned);
						if (!normalized) continue;
						if (normalized.ownedCharacterId === token.characterId && invitation.result) {
							const delivery = getMultiTargetResultDelivery({operationId: invitation.operationId, result: invitation.result, characterId: token.characterId});
							if (delivery) await this._fnOnAuthoritativeApproval?.(delivery);
							if (!this._isCurrent(token)) return false;
						}
						multiActions.push(normalized);
					}
				}
				if (!this._isCurrent(token)) return false;
				if (this._collectionRevision !== token.collectionRevision) {
					isCollectionStale = true;
					return false;
				}
				this._isAuthorized = true;
				this._actions = new Map((actions || [])
					.map(action => this._getNormalizedActionWithTransientState(action))
					.filter(Boolean)
					.concat(multiActions)
					.map(action => [action.actionId, action]));
				return true;
			})
			.catch(error => {
				if (!this._isCurrent(token)) return false;
				if (this._collectionRevision !== token.collectionRevision) {
					isCollectionStale = true;
					return false;
				}
				this._isAuthorized = false;
				this._actions.clear();
				if (_CAPABILITY_LOSS_CODES.has(error?.code)) {
					this._loadError = null;
					return false;
				}
				this._loadError = _getSafeErrorMessage(error).slice(0, _MAX_ERROR_LENGTH);
				return false;
			})
			.finally(() => {
				if (this._pRefreshActive !== promise) return;
				this._isLoading = false;
				this._pRefreshActive = null;
				if (this._characterId !== token.characterId) return;
				this._renderApprovals();
				if (!this._isCapabilityRevoked && isCollectionStale && this._isCurrent(token)) void this.pRefresh();
			});
		this._pRefreshActive = promise;
		return promise;
	}

	onConnectionState (state) {
		if (["access_lost", "closed"].includes(state?.state)) {
			this._revokeApprovalCapability();
			return;
		}
		if (state?.state === "reconnecting") {
			this._revokeApprovalCapability();
			return;
		}
		if (state?.state === "live" && this._characterId) {
			this._authorityVersion = this._fnGetAuthorityVersion();
			this._isCapabilityRevoked = false;
			void this.pRefresh();
		}
	}

	suspend () {
		return this._revokeApprovalCapability();
	}

	onRealtimeOperation (event) {
		if (event?.type?.startsWith("character.multi_operation.")) {
			if (!this._characterId || this._isCapabilityRevoked) return false;
			this._collectionRevision++;
			void this.pRefresh();
			return true;
		}
		if (!this._characterId || (event?.targetCharacterId != null && event.targetCharacterId !== this._characterId)) return false;
		if (event.status === "proposed") {
			if (event.targetCharacterId == null) {
				this._collectionRevision++;
				void this.pRefresh();
				return true;
			}
			if (!this._isAuthorized) {
				this._collectionRevision++;
				void this.pRefresh();
				return true;
			}
			const action = this._getNormalizedActionWithTransientState(event.payload);
			if (!action) return false;
			this._actions.set(action.actionId, action);
			this._collectionRevision++;
			this._renderApprovals();
			return true;
		}
		if (["rejected", "cancelled", "expired", "failed"].includes(event.status)) {
			const didDelete = this._actions.delete(event.operationId);
			if (didDelete) {
				this._collectionRevision++;
				this._renderApprovals();
			}
			return didDelete;
		}
		return false;
	}

	onApplied ({operation, legId = null, changed = true, beforeData = null, afterData = null}) {
		const coverageKey = legId ? `${operation?.operationId}/${legId}` : operation?.operationId;
		if (
			!operation?.operationId
			|| operation.targetCharacterId !== this._characterId
			|| this._seenAppliedOperationIds.has(coverageKey)
		) return false;
		if (this._actions.delete(operation.operationId)) this._collectionRevision++;
		this._commandIds.delete(`${operation.operationId}:accept`);
		this._commandIds.delete(`${operation.operationId}:reject`);
		this._removeNotice(`error:${operation.operationId}`);
		const notice = getAppliedEffectNotice({operation, changed, beforeData, afterData});
		if (!notice) {
			this._renderApprovals();
			return false;
		}
		this._seenAppliedOperationIds.add(coverageKey);
		this._addNotice({...notice, id: coverageKey, kind: "success"});
		this._renderApprovals();
		return true;
	}

	onApplicationError ({operationId}) {
		if (!operationId) return false;
		const action = this._actions.get(operationId);
		if (action) {
			action.decisionState = "recovery";
			action.error = "Approved, but the effect could not be adopted safely. Saving is paused while recovery is required.";
		}
		this._addNotice({
			id: `error:${operationId}`,
			kind: "error",
			message: "A campaign effect could not be applied safely. Saving is paused until the character is recovered.",
			isPersistent: true,
		});
		this._renderApprovals();
		return true;
	}

	onAuthoritativeCoverage ({operationId}) {
		if (!operationId) return false;
		const didDelete = this._actions.delete(operationId);
		this._commandIds.delete(`${operationId}:accept`);
		this._commandIds.delete(`${operationId}:reject`);
		this._removeNotice(`error:${operationId}`);
		if (didDelete) {
			this._collectionRevision++;
			this._renderApprovals();
		}
		return didDelete;
	}

	async pResolve ({actionId, decision}) {
		if (!this._characterId || !this._isAuthorized || !["accept", "reject"].includes(decision)) return false;
		const action = this._actions.get(actionId);
		if (action?.isMulti) return this._pResolveMultiInvitation({action, decision});
		if (!action || action.decisionState === "submitting" || action.decisionState === "waiting") return false;
		const token = {generation: this._generation, characterId: this._characterId};
		const commandKey = `${actionId}:${decision}`;
		const commandId = this._commandIds.get(commandKey) || this._fnCreateId();
		this._commandIds.set(commandKey, commandId);
		action.decisionState = "submitting";
		action.decision = decision;
		action.error = null;
		this._renderApprovals();

		try {
			const response = await this._api.pResolveStructuredAction({
				campaignId: this._campaignId,
				actionId,
				decision,
				contractVersion: action.contractVersion,
				idempotencyKey: commandId,
			});
			const status = response?.operation?.status;
			if (!this._isCurrent(token)) return false;
			if (!this._actions.has(actionId) && status !== "applied") return false;
			if (status === "applied") {
				const sourceResult = response?.operation?.sourceResult;
				const leg = response?.operation?.leg || sourceResult?.leg || "target";
				const sequence = response?.watermarks?.find(watermark => watermark.characterId === token.characterId)?.sequence ??
					response?.operationWatermark;
				await this._fnOnAuthoritativeApproval?.({
					actionId,
					characterId: token.characterId,
					eventId: leg === "source" ? sourceResult?.appliedEventId : response?.operation?.appliedEventId,
					sequence,
					operation: response?.operation?.operation,
					resultingCharacterRevision: leg === "source"
						? sourceResult?.resultingSourceCharacterRevision
						: response?.operation?.resultingCharacterRevision,
					leg,
					sourceCost: sourceResult?.sourceCost,
				});
				if (!this._isCurrent(token)) return false;
				const currentAction = this._actions.get(actionId);
				if (!currentAction) return true;
				// A successful inline adoption removes the action through `onApplied`. A revision gap leaves it
				// waiting while the same repository path performs its ordered history resync.
				if (currentAction.decisionState === "submitting") {
					currentAction.decisionState = "waiting";
					currentAction.error = null;
				}
			} else if (["rejected", "cancelled", "expired", "failed"].includes(status)) {
				this._actions.delete(actionId);
				this._collectionRevision++;
				this._commandIds.delete(commandKey);
			} else {
				throw Object.assign(new Error("Unexpected action response."), {code: "UNEXPECTED_RESPONSE"});
			}
			this._renderApprovals();
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) return false;
			const currentAction = this._actions.get(actionId);
			if (!currentAction) return false;
			if (_CAPABILITY_LOSS_CODES.has(error?.code)) {
				this._revokeApprovalCapability();
				return false;
			}
			if (currentAction.decisionState !== "submitting" || currentAction.decision !== decision) return false;
			currentAction.decisionState = null;
			currentAction.decision = null;
			currentAction.error = _getSafeErrorMessage(error).slice(0, _MAX_ERROR_LENGTH);
			this._renderApprovals();
			if (error?.code === "ACTION_NOT_FOUND") void this.pRefresh();
			return false;
		}
	}

	_isCurrent ({generation, characterId}) {
		return this._generation === generation && this._characterId === characterId
			&& (!this._fnGetCharacterId || this._fnGetCharacterId() === characterId)
			&& (!this._fnIsOwner || this._fnIsOwner() === true)
			&& this._authorityVersion === this._fnGetAuthorityVersion();
	}

	_hasMultiCapability () {
		return hasMultiTargetOperationsCapability(this._fnGetMultiTargetCapability())
			&& (!this._fnIsOwner || this._fnIsOwner() === true);
	}

	async _pLoadOwnedCharacters (token) {
		const response = await this._api.pListCampaignCharacterProjections({campaignId: this._campaignId});
		if (!this._isCurrent(token)) return new Map();
		const owned = new Map();
		for (const projection of response?.projections || []) {
			if (projection.kind !== "owner_truth" || typeof projection.targetRef !== "string" || typeof projection.character?.id !== "string") continue;
			if (owned.has(projection.targetRef)) throw Object.assign(new Error("Ambiguous owned target reference."), {code: "RESPONSE_INVALID"});
			owned.set(projection.targetRef, projection.character.id);
		}
		return owned;
	}

	_normalizeMultiInvitation (invitation, owned) {
		if (!invitation?.operationId || !invitation.invitationId || typeof invitation.presentation?.effectLabel !== "string") return null;
		const actionId = `multi:${invitation.operationId}:${invitation.invitationId}`;
		const current = this._actions.get(actionId);
		const characterId = owned.get(invitation.targetRef) ?? null;
		return {
			isMulti: true,
			actionId,
			operationId: invitation.operationId,
			invitationId: invitation.invitationId,
			targetRef: invitation.targetRef ?? null,
			ownedCharacterId: characterId,
			status: invitation.status,
			presentation: {
				sourceName: String(invitation.presentation.sourceName || "A party member").slice(0, 120),
				effectLabel: invitation.presentation.effectLabel.slice(0, 120),
				outcomeLabel: String(invitation.presentation.outcomeLabel || "Review campaign effect").slice(0, 120),
				targetName: String(invitation.presentation.targetName || "Your campaign character").slice(0, 120),
			},
			capabilities: {canApprove: invitation.capabilities?.canApprove === true, canReject: invitation.capabilities?.canReject === true},
			decisionState: current?.decisionState ?? null,
			error: current?.error ?? null,
		};
	}

	async _pResolveMultiInvitation ({action, decision}) {
		const token = {generation: this._generation, characterId: this._characterId};
		if (!this._isCurrent(token) || !this._hasMultiCapability() || this._isCapabilityRevoked || action.status !== "pending"
			|| action.ownedCharacterId !== token.characterId || action.decisionState === "submitting"
			|| action.capabilities[decision === "accept" ? "canApprove" : "canReject"] !== true) return false;
		const apiDecision = decision === "accept" ? "approve" : "reject";
		const existing = this._multiCommands.get(action.actionId);
		if (existing && existing.decision !== apiDecision) return false;
		action.decisionState = "submitting";
		action.decision = decision;
		action.error = null;
		this._renderApprovals();
		try {
			const owned = await this._pLoadOwnedCharacters(token);
			if (!this._isCurrent(token) || !this._hasMultiCapability()) return false;
			if (owned.get(action.targetRef) !== token.characterId) {
				throw Object.assign(new Error("Owned target identity changed."), {code: "ACTION_NOT_FOUND"});
			}
			let request = existing;
			if (!request) {
				request = Object.freeze({
					campaignId: this._campaignId,
					operationId: action.operationId,
					invitationId: action.invitationId,
					decision: apiDecision,
					idempotencyKey: this._fnCreateId(),
				});
				this._multiCommands.set(action.actionId, request);
			}
			const response = await this._api.pRespondMultiTargetInvitation(request);
			if (!this._isCurrent(token) || !this._hasMultiCapability()) return false;
			if (response?.operation?.operationId !== action.operationId || response?.invitation?.invitationId !== action.invitationId) {
				throw Object.assign(new Error("Invalid invitation receipt."), {code: "RESPONSE_INVALID"});
			}
			// Approval is consent, not effect application. Recovery reads supply current workflow/result truth.
			this._multiCommands.delete(action.actionId);
			action.decisionState = null;
			this._collectionRevision++;
			await this.pRefresh();
			if (!this._isCurrent(token)) return false;
			this._focusMultiInvitation(action.actionId);
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) return false;
			if (_CAPABILITY_LOSS_CODES.has(error?.code)) this._revokeApprovalCapability();
			else {
				action.decisionState = null;
				action.error = _getSafeErrorMessage(error).slice(0, _MAX_ERROR_LENGTH);
				this._renderApprovals();
				this._focusMultiInvitation(action.actionId);
				if (error?.code === "ACTION_NOT_FOUND") void this.pRefresh();
			}
			return false;
		}
	}

	_focusMultiInvitation (actionId) {
		const card = [...(this._approvalsRoot?.querySelectorAll?.("[data-hub-action-id]") || [])].find(element => element.dataset.hubActionId === actionId);
		(card || document.getElementById?.("charsheet-ipt-hp-current"))?.focus({preventScroll: true});
	}

	_revokeApprovalCapability () {
		if (!this._characterId) return false;
		const didChange = this._isAuthorized || this._actions.size || this._loadError;
		this._generation++;
		this._isAuthorized = false;
		this._isCapabilityRevoked = true;
		this._actions.clear();
		this._loadError = null;
		this._collectionRevision++;
		this._isLoading = false;
		this._pRefreshActive = null;
		this._renderApprovals();
		return !!didChange;
	}

	_getNormalizedAction (action) {
		if (
			typeof action?.actionId !== "string"
			|| !action.actionId
			|| action.status !== "proposed"
			|| action.capabilities?.canApprove !== true
			|| action.capabilities?.canReject !== true
			|| typeof action.presentation?.sourceName !== "string"
			|| typeof action.presentation?.effectLabel !== "string"
		) return null;
		return {
			actionId: action.actionId,
			contractVersion: action.contractVersion === 1 ? 1 : null,
			status: "proposed",
			expiresAt: typeof action.expiresAt === "string" ? action.expiresAt : null,
			presentation: {
				sourceName: action.presentation.sourceName.slice(0, 120),
				effectLabel: action.presentation.effectLabel.slice(0, 120),
				outcomeLabel: typeof action.presentation.outcomeLabel === "string"
					? action.presentation.outcomeLabel.slice(0, 120)
					: "Review campaign effect",
			},
			capabilities: {canApprove: true, canReject: true},
			decisionState: null,
			error: null,
		};
	}

	_getNormalizedActionWithTransientState (action) {
		const normalized = this._getNormalizedAction(action);
		if (!normalized) return null;
		const current = this._actions.get(normalized.actionId);
		if (!current) return normalized;
		return {
			...normalized,
			decisionState: current.decisionState ?? null,
			decision: current.decision ?? null,
			error: current.error ?? null,
		};
	}

	_addNotice (notice) {
		if (!notice?.id || this._notices.has(notice.id)) return false;
		this._notices.set(notice.id, notice);
		const transientIds = [...this._notices.values()].filter(it => !it.isPersistent).map(it => it.id);
		while (transientIds.length > _MAX_NOTICES) {
			const oldestId = transientIds.shift();
			this._removeNotice(oldestId);
		}
		const persistentIds = [...this._notices.values()].filter(it => it.isPersistent).map(it => it.id);
		while (persistentIds.length > _MAX_PERSISTENT_NOTICES) {
			const oldestId = persistentIds.shift();
			this._removeNotice(oldestId);
		}
		if (!notice.isPersistent) {
			this._noticeTimers.set(notice.id, this._fnSetTimeout(() => {
				this._removeNotice(notice.id);
				this._renderNotices();
			}, _NOTICE_LIFETIME_MS));
		}
		this._renderNotices();
		return true;
	}

	_removeNotice (noticeId) {
		const timer = this._noticeTimers.get(noticeId);
		if (timer) this._fnClearTimeout(timer);
		this._noticeTimers.delete(noticeId);
		return this._notices.delete(noticeId);
	}

	_render () {
		if (!this._root) return;
		this._root.innerHTML = "";
		this._noticesRoot = e_({tag: "div", clazz: "charsheet__hub-effect-notices"});
		this._noticesRoot.setAttribute("role", "status");
		this._noticesRoot.setAttribute("aria-live", "polite");
		this._noticesRoot.setAttribute("aria-atomic", "false");
		this._approvalsRoot = e_({tag: "section", clazz: "charsheet__hub-approvals"});
		this._approvalsRoot.setAttribute("aria-label", "Pending campaign effect approvals");
		this._root.append(this._noticesRoot, this._approvalsRoot);
		this._renderNotices();
		this._renderApprovals();
	}

	_renderNotices () {
		if (!this._noticesRoot) return;
		const focusedNoticeId = document.activeElement?.dataset?.hubNoticeId || null;
		this._noticesRoot.innerHTML = "";
		for (const notice of this._notices.values()) {
			const row = e_({
				tag: "div",
				clazz: `charsheet__hub-effect-notice charsheet__hub-effect-notice--${notice.kind}`,
			});
			const text = e_({tag: "span", clazz: "charsheet__hub-effect-notice-text", text: notice.message});
			const dismiss = e_({tag: "button", clazz: "charsheet__hub-effect-dismiss", text: "×"});
			dismiss.type = "button";
			dismiss.dataset.hubNoticeId = notice.id;
			dismiss.setAttribute("aria-label", "Dismiss campaign effect notification");
			dismiss.addEventListener("click", () => {
				this._removeNotice(notice.id);
				this._renderNotices();
			});
			row.append(text, dismiss);
			this._noticesRoot.append(row);
		}
		if (focusedNoticeId) {
			const selector = `[data-hub-notice-id="${CSS.escape(focusedNoticeId)}"]`;
			const focusTarget = this._noticesRoot.querySelector(selector)
				|| this._noticesRoot.querySelector("button")
				|| this._approvalsRoot?.querySelector("button:not(:disabled)")
				|| document.getElementById?.("charsheet-ipt-hp-current");
			focusTarget?.focus({preventScroll: true});
		}
		this._updateRootVisibility();
	}

	_renderApprovals () {
		if (!this._approvalsRoot) return;
		const focusedActionId = document.activeElement?.dataset?.hubActionId || null;
		const focusedDecision = document.activeElement?.dataset?.hubDecision || null;
		this._approvalsRoot.innerHTML = "";
		this._approvalsRoot.setAttribute("aria-busy", this._isLoading ? "true" : "false");

		if (this._loadError && this._characterId) {
			const error = e_({tag: "div", clazz: "charsheet__hub-approval-error", text: this._loadError});
			error.setAttribute("role", "alert");
			const retry = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", text: "Retry"});
			retry.type = "button";
			retry.addEventListener("click", () => void this.pRefresh());
			error.append(retry);
			this._approvalsRoot.append(error);
		}

		if (this._actions.size) {
			const heading = e_({tag: "h2", clazz: "charsheet__hub-approvals-title", text: [...this._actions.values()].some(action => action.isMulti) ? "Requests for your characters" : "Campaign effect requests"});
			this._approvalsRoot.append(heading);
		}
		for (const action of this._actions.values()) this._approvalsRoot.append(this._getApprovalCard(action));

		if (focusedActionId && focusedDecision) {
			const actionSelector = `[data-hub-action-id="${CSS.escape(focusedActionId)}"]`;
			const decisionControl = this._approvalsRoot
				.querySelector(`button${actionSelector}[data-hub-decision="${focusedDecision}"]`);
			const focusTarget = decisionControl && !decisionControl.disabled
				? decisionControl
				: this._approvalsRoot.querySelector(`article${actionSelector}`)
					|| this._approvalsRoot.querySelector("button:not(:disabled)")
					|| this._noticesRoot?.querySelector("button")
					|| document.getElementById?.("charsheet-ipt-hp-current");
			focusTarget?.focus({preventScroll: true});
		}
		this._updateRootVisibility();
	}

	_getApprovalCard (action) {
		const card = e_({tag: "article", clazz: "charsheet__hub-approval"});
		card.tabIndex = -1;
		card.dataset.hubActionId = action.actionId;
		if (action.decision) card.dataset.hubDecision = action.decision;
		const copy = e_({tag: "div", clazz: "charsheet__hub-approval-copy"});
		copy.append(
			e_({tag: "strong", clazz: "charsheet__hub-approval-effect", text: action.presentation.effectLabel}),
			e_({tag: "span", clazz: "charsheet__hub-approval-outcome", text: action.presentation.outcomeLabel}),
			e_({tag: "span", clazz: "charsheet__hub-approval-source", text: `From ${action.presentation.sourceName}`}),
		);
		const controls = e_({tag: "div", clazz: "charsheet__hub-approval-controls"});
		const isBusy = ["submitting", "waiting", "recovery"].includes(action.decisionState);
		if (action.isMulti) {
			const isCurrent = action.ownedCharacterId === this._characterId;
			copy.append(e_({tag: "span", text: `For ${action.presentation.targetName} · ${isCurrent ? "this character" : action.ownedCharacterId ? "another owned character" : "owned identity not verified"} · ${action.status.replaceAll("_", " ")}`}));
			if (!isCurrent) {
				if (action.ownedCharacterId) {
					const open = e_({tag: "a", clazz: "ve-btn ve-btn-sm ve-btn-default", text: "Open character to respond"});
					open.href = getCampaignCharacterSheetUrl({characterId: action.ownedCharacterId, campaignId: this._campaignId});
					controls.append(open);
				} else copy.append(e_({tag: "span", text: "Exact owned identity is unavailable. Refresh before responding."}));
			}
		}
		for (const [decision, label, clazz] of [
			["accept", "Approve", "ve-btn-primary"],
			["reject", "Reject", "ve-btn-default"],
		]) {
			if (action.isMulti && (action.ownedCharacterId !== this._characterId || action.status !== "pending" || action.capabilities[decision === "accept" ? "canApprove" : "canReject"] !== true)) continue;
			const button = e_({tag: "button", clazz: `ve-btn ve-btn-sm ${clazz}`, text: label});
			button.type = "button";
			button.disabled = isBusy || (action.isMulti && this._multiCommands.has(action.actionId) && this._multiCommands.get(action.actionId).decision !== (decision === "accept" ? "approve" : "reject"));
			button.dataset.hubActionId = action.actionId;
			button.dataset.hubDecision = decision;
			button.setAttribute("aria-label", `${label} ${action.presentation.effectLabel}: ${action.presentation.outcomeLabel} from ${action.presentation.sourceName}`);
			button.addEventListener("click", () => void this.pResolve({actionId: action.actionId, decision}));
			controls.append(button);
		}
		card.append(copy, controls);
		if (action.decisionState === "submitting") {
			card.append(e_({
				tag: "span",
				clazz: "charsheet__hub-approval-state",
				text: action.decision === "accept" ? "Approving…" : "Rejecting…",
			}));
		} else if (action.decisionState === "waiting") {
			card.append(e_({tag: "span", clazz: "charsheet__hub-approval-state", text: "Approved. Applying authoritative update…"}));
		}
		if (action.error) {
			const error = e_({tag: "span", clazz: "charsheet__hub-approval-item-error", text: action.error});
			error.setAttribute("role", "alert");
			card.append(error);
		}
		return card;
	}

	_updateRootVisibility () {
		if (!this._root) return;
		this._root.hidden = !this._notices.size && !this._actions.size && !this._loadError;
	}
}

globalThis.CharacterSheetHubEffects = CharacterSheetHubEffects;
