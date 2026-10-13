import {getProjectionId, getProjectionName, getTargetableProjections} from "../hub/hub-character-view.js";
import {isTransferOutcomeUncertain} from "../hub/hub-api-client.js";
import {CharacterSheetModal} from "./charactersheet-modal.js";
import {getMultiTargetResultDelivery, hasMultiTargetOperationsCapability, MULTI_TARGET_OPERATION_LIVE_STATUSES, MULTI_TARGET_OPERATION_TERMINAL_STATUSES, resolveReviewedMultiTargetSpell} from "../hub/hub-multi-target-operations.js";
import {resolveReviewedHealingWordSpell} from "../hub/hub-healing-word-spells.js";
import {isReviewedLayOnHandsFeature, resolveReviewedLayOnHands} from "../hub/hub-lay-on-hands.js";

const {e_} = /** @type {*} */ (globalThis);

const _CAPABILITY = Object.freeze({
	contractVersion: 1,
	protocolVersion: 4,
	operationVersion: 1,
	templateRegistryVersion: "peer-effects-v1",
});

const _SOURCE_VERSIONS = new Map([
	["PHB", "phb-2014-v1"],
	["XPHB", "xphb-2024-v1"],
]);

const _STATUSES = new Set(["proposed", "applied", "rejected", "cancelled", "expired", "failed"]);
const _TERMINAL_STATUSES = new Set([..._STATUSES].filter(status => status !== "proposed"));
const _ACCESS_LOSS_CODES = new Set(["AUTH_REQUIRED", "CAMPAIGN_NOT_FOUND", "CHARACTER_NOT_FOUND", "FORBIDDEN"]);
const _NON_ROTATABLE_PROPOSAL_REJECTION_CODES = new Set(["IDEMPOTENCY_KEY_REUSED"]);

const _isDefinitiveProposalRejection = error => typeof error?.code === "string"
	&& !_NON_ROTATABLE_PROPOSAL_REJECTION_CODES.has(error.code)
	&& !isTransferOutcomeUncertain(error);

const _getSafeError = error => {
	switch (error?.code) {
		case "NETWORK_UNAVAILABLE": return "Targeting is offline. Reconnect before sending this request.";
		case "POLICY_VERSION_STALE": return "Campaign rules changed. Rechecking targeting before you start a new request.";
		case "PROTOCOL_UPDATE_REQUIRED": return "Reload the page to use campaign targeting.";
		case "CAPABILITY_UNAVAILABLE": return "Campaign targeting is not available right now.";
		case "SOURCE_OR_TARGET_UNAVAILABLE": return "That spell or target is no longer available.";
		case "SOURCE_COST_UNSUPPORTED": return "This casting option cannot be paid atomically yet.";
		case "FINALIZATION_SELECTION_INVALID": return "The selected subset changed. Refresh requests and choose currently approved candidates.";
		case "IDEMPOTENCY_KEY_REUSED": return "This request changed while retrying. Start a new cast.";
		default: return "The campaign request could not be sent. Retry without spending the spell slot.";
	}
};

export class CharacterSheetPeerTargeting {
	constructor ({
		campaignId,
		api,
		root = null,
		fnGetCharacterId,
		fnIsOwner,
		fnGetRulesVersionId,
		fnGetCapability,
		fnGetMultiTargetCapability = () => null,
		fnResolveMultiTargetSpell = resolveReviewedMultiTargetSpell,
		fnPickTargets = null,
		fnGetAuthorityVersion = () => null,
		fnRefreshCampaignContext = null,
		fnCreateId = () => crypto.randomUUID(),
		fnPickTarget = null,
		fnOnAuthoritativeApplied = null,
	} = {}) {
		this._campaignId = campaignId;
		this._api = api;
		this._root = root;
		this._fnGetCharacterId = fnGetCharacterId;
		this._fnIsOwner = fnIsOwner;
		this._fnGetRulesVersionId = fnGetRulesVersionId;
		this._fnGetCapability = fnGetCapability;
		this._fnGetMultiTargetCapability = fnGetMultiTargetCapability;
		this._fnResolveMultiTargetSpell = fnResolveMultiTargetSpell;
		this._fnPickTargets = fnPickTargets || (options => this._pPickTargets(options));
		this._fnGetAuthorityVersion = fnGetAuthorityVersion;
		this._fnRefreshCampaignContext = fnRefreshCampaignContext;
		this._fnCreateId = fnCreateId;
		this._fnPickTarget = fnPickTarget || (options => this._pPickTarget(options));
		this._fnOnAuthoritativeApplied = fnOnAuthoritativeApplied;
		this._generation = 0;
		this._refreshSequence = 0;
		this._collectionRevision = 0;
		this._characterId = null;
		this._membershipRole = null;
		this._authorityVersion = null;
		this._outgoing = new Map();
		this._drafts = new Map();
		this._multiSourceCommands = new Map();
		this._isSuspended = false;
		this._isAuthorityRevalidating = false;
		this._isLoading = false;
		this._loadError = null;
		this._definitiveRecoveryPromise = null;
		this._cancelTargetPicker = null;
		this._onFocus = () => {
			if (this._characterId && !this._isSuspended) void this.pRefresh();
		};
		this._onVisibilityChange = () => {
			if (document.visibilityState === "visible" && this._characterId && !this._isSuspended) void this.pRefresh();
		};
	}

	init () {
		if (!this._campaignId || !this._api || !this._fnGetCharacterId || !this._fnIsOwner || !this._fnGetCapability) return false;
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

	activate ({characterId, membershipRole}) {
		if (!characterId || membershipRole !== "player" || !this._hasOwnerAuthority() || !this._hasAnyCapability()) {
			this.deactivate();
			return false;
		}
		if (this._isSuspended && this._characterId === characterId) {
			this._membershipRole = membershipRole;
			this._authorityVersion = this._fnGetAuthorityVersion();
			this._isSuspended = false;
			this._loadError = null;
			this._render();
			void this.pRefresh();
			return true;
		}
		this.deactivate();
		this._characterId = characterId;
		this._membershipRole = membershipRole;
		this._authorityVersion = this._fnGetAuthorityVersion();
		this._generation++;
		void this.pRefresh();
		return true;
	}

	suspend () {
		if (!this._characterId) return false;
		this._cancelTargetPicker?.();
		this._isSuspended = true;
		this._isAuthorityRevalidating = true;
		this._generation++;
		for (const draft of this._drafts.values()) {
			if (!draft.isMulti) draft.target = {...draft.target, name: "Campaign character"};
			if (draft.isMulti) {
				draft.isSubmitting = false;
				draft.error = "Reconnect before retrying the original request.";
			}
		}
		for (const action of this._outgoing.values()) {
			if (action.isMulti) action.isSubmitting = false;
		}
		this._refreshSequence++;
		this._isLoading = false;
		this._loadError = null;
		this._render();
		return true;
	}

	deactivate () {
		this._cancelTargetPicker?.();
		this._generation++;
		this._refreshSequence++;
		this._characterId = null;
		this._membershipRole = null;
		this._outgoing.clear();
		this._drafts.clear();
		this._multiSourceCommands.clear();
		this._isSuspended = false;
		this._isAuthorityRevalidating = false;
		this._isLoading = false;
		this._loadError = null;
		this._definitiveRecoveryPromise = null;
		this._render();
	}

	onConnectionState (state) {
		if (["access_lost", "closed"].includes(state?.state)) {
			this.deactivate();
			return;
		}
		if (!this._hasOwnerAuthority()) {
			this.deactivate();
			return;
		}
		if (state?.state === "reconnecting") {
			this.suspend();
			return;
		}
		if (state?.state === "live" && this._fnGetCharacterId?.()) {
			if (this._isSuspended || !this._characterId || this._membershipRole !== "player") return;
			void this.pRefresh();
		}
	}

	onRealtimeOperation (event) {
		if (!this._hasOwnerAuthority()) {
			this.deactivate();
			return false;
		}
		if (!this._characterId || !event?.operationId) return false;
		if (event.type?.startsWith("character.multi_operation.") || this._outgoing.get(event.operationId)?.isMulti) {
			void this.pRefresh();
			return true;
		}
		const current = this._outgoing.get(event.operationId);
		if (!current && event.status === "proposed") return false;
		if (current) {
			current.status = event.status;
			current.sourceCostState = event.status === "applied" ? "consumed" : "not_consumed";
			current.canCancel = event.status === "proposed";
			current.isSubmitting = false;
			current.error = null;
			this._collectionRevision++;
			this._render();
		}
		if (_TERMINAL_STATUSES.has(event.status)) void this.pRefresh();
		return !!current;
	}

	isSupportedSpellCast ({spell, selectedSlot, hasMetamagic = false, hasVariantComponent = false} = {}) {
		return this._hasOwnerAuthority()
			&& !this._isSuspended
			&& this._hasCapability()
			&& this._characterId
			&& this._membershipRole === "player"
			&& this._isSupportedSpellShape({spell, selectedSlot, hasMetamagic, hasVariantComponent});
	}

	isSupportedHealingFeature ({feature} = {}) {
		return this._hasOwnerAuthority() && !!this._characterId && this._membershipRole === "player"
			&& isReviewedLayOnHandsFeature(feature)
			&& (this._hasCapability("feature_use") || this._isSuspended || this._isAuthorityRevalidating);
	}

	async pMaybeProposeHealingFeature ({feature, amount} = {}) {
		if (!this.isSupportedHealingFeature({feature})) return {handled: false};
		if (this._isAuthorityRevalidating && !this._isSuspended && this._hasCapability("feature_use")) {
			const token = {generation: this._generation, characterId: this._characterId};
			if (!await this.pRefresh() || !this._isCurrent(token)) return {handled: true, proposed: false};
		}
		if (this._isSuspended || this._isAuthorityRevalidating || this._hasDraftAwaitingAuthoritativeReconciliation()) {
			this._showError("Campaign healing is reconnecting or reconciling an earlier request. Wait before spending Lay on Hands points.");
			return {handled: true, proposed: false};
		}
		const descriptor = resolveReviewedLayOnHands({feature, amount});
		if (!descriptor) {
			this._showError("Choose a positive, integral Lay on Hands healing amount.");
			return {handled: true, proposed: false};
		}
		const token = {generation: this._generation, characterId: this._characterId};
		let targets;
		try {
			targets = await this._pLoadTargets();
		} catch (error) {
			if (this._isCurrent(token)) this._showError(_getSafeError(error));
			return {handled: true, proposed: false};
		}
		if (!this._isCurrent(token) || !this._hasCapability("feature_use")) return {handled: true, proposed: false};
		const picked = await this._fnPickTarget({spell: feature, slotLevel: null, targets, tableRules: descriptor.tableRules});
		if (!this._isCurrent(token) || !this._hasCapability("feature_use") || !picked || picked.kind === "cancel") return {handled: true, proposed: false};
		if (picked.kind === "local") return {handled: false, local: true};
		const target = targets.find(entry => entry.targetRef === picked.targetRef);
		if (!target) {
			this._showError("The selected healing target is no longer available.");
			return {handled: true, proposed: false};
		}
		const draftKey = `${this._characterId}|${descriptor.sourceEntity.uid}|${amount}|${target.targetRef}`;
		let draft = this._drafts.get(draftKey);
		if (!draft) {
			const commandId = this._fnCreateId();
			draft = {
				commandId,
				draftKey,
				sourceCharacterId: this._characterId,
				spell: feature,
				slotLevel: null,
				isFeature: true,
				tableRules: descriptor.tableRules,
				target,
				request: this._getProposalRequest({commandId, sourceCharacterId: this._characterId, spell: feature, targetRef: target.targetRef, descriptor}),
			};
		}
		this._drafts.set(draftKey, draft);
		return {handled: true, proposed: await this._pSubmitDraft(draft)};
	}

	async pMaybeProposeSpell ({
		spell,
		selectedSlot,
		hasMetamagic = false,
		hasVariantComponent = false,
	} = {}) {
		const descriptor = this._fnResolveMultiTargetSpell({spell, selectedSlot, hasMetamagic, hasVariantComponent});
		const isSupportedSpellShape = this._isSupportedSpellShape({spell, selectedSlot, hasMetamagic, hasVariantComponent});
		if (
			this._isAuthorityRevalidating && !this._isSuspended
			&& ((descriptor && this._hasMultiCapability()) || (isSupportedSpellShape && this._hasCapability()))
		) {
			const token = {generation: this._generation, characterId: this._characterId};
			if (!await this.pRefresh() || !this._isCurrent(token)) return {handled: true, proposed: false};
		}
		if (descriptor && this._hasMultiCapability()) {
			return this._pMaybeProposeMultiTarget({descriptor, spell, selectedSlot});
		}
		if (
			(this._isSuspended || this._isAuthorityRevalidating)
			&& this._characterId
			&& (isSupportedSpellShape || descriptor)
		) {
			this._showError(`Campaign targeting is reconnecting. Wait for the campaign context to refresh before casting ${spell.name}.`);
			return {handled: true, proposed: false};
		}
		if (
			this._characterId
			&& this._membershipRole === "player"
			&& isSupportedSpellShape
			&& this._hasDraftAwaitingAuthoritativeReconciliation()
		) {
			this._showError(`Campaign targeting is reconciling a rejected request. Reconnect before starting another ${spell.name} request.`);
			return {handled: true, proposed: false};
		}
		if (!this.isSupportedSpellCast({spell, selectedSlot, hasMetamagic, hasVariantComponent})) return {handled: false};
		const token = {generation: this._generation, characterId: this._characterId};
		let targets;
		try {
			targets = await this._pLoadTargets();
		} catch (error) {
			if (this._isCurrent(token)) this._showError(_getSafeError(error));
			return {handled: true, proposed: false};
		}
		if (!this._isCurrent(token) || this._isSuspended) return {handled: true, proposed: false};

		const choice = await this._fnPickTarget({spell, slotLevel: selectedSlot.level, targets});
		if (!this._isCurrent(token) || this._isSuspended || !choice || choice.kind === "cancel") return {handled: true, proposed: false};
		if (choice.kind === "local") return {handled: false};

		const target = targets.find(it => it.targetRef === choice.targetRef);
		if (!target) return {handled: true, proposed: false};
		const draftKey = `${this._characterId}|${spell.name}|${spell.source}|${selectedSlot.level}|${target.targetRef}`;
		let draft = this._drafts.get(draftKey);
		if (!draft) {
			const commandId = this._fnCreateId();
			draft = {
				commandId,
				draftKey,
				sourceCharacterId: this._characterId,
				spell,
				slotLevel: selectedSlot.level,
				target,
				request: this._getProposalRequest({
					commandId,
					sourceCharacterId: this._characterId,
					spell,
					slotLevel: selectedSlot.level,
					targetRef: target.targetRef,
				}),
			};
		}
		this._drafts.set(draftKey, draft);
		const proposed = await this._pSubmitDraft(draft);
		return {handled: true, proposed};
	}

	async pRefresh () {
		if (!this._hasOwnerAuthority()) {
			if (this._characterId) this.deactivate();
			return false;
		}
		if (this._hasDraftAwaitingAuthoritativeReconciliation()) return this._pRecoverDefinitiveProposalRejections();
		return this._pRefreshOutgoingActions();
	}

	async _pRefreshOutgoingActions () {
		if (
			!this._hasOwnerAuthority()
			|| this._isSuspended
			|| !this._characterId
			|| !this._hasAnyCapability()
			|| typeof this._api.pListCharacterOutgoingActions !== "function"
		) return false;
		const token = {
			generation: this._generation,
			characterId: this._characterId,
			refreshSequence: ++this._refreshSequence,
			collectionRevision: this._collectionRevision,
			isMulti: this._hasMultiCapability(),
		};
		let isCollectionStale = false;
		this._isLoading = true;
		this._loadError = null;
		this._render();
		try {
			const actions = await this._api.pListCharacterOutgoingActions({
				campaignId: this._campaignId,
				characterId: this._characterId,
			});
			if (!this._isRefreshCurrent(token)) return false;
			const multi = [];
			if (this._hasMultiCapability()) {
				let cursor = null;
				const seenCursors = new Set();
				do {
					const page = await this._api.pListMultiTargetOutgoing({campaignId: this._campaignId, limit: 100, ...(cursor ? {cursor} : {})});
					if (!this._isRefreshCurrent(token)) return false;
					multi.push(...(page?.operations || []));
					cursor = page?.nextCursor ?? null;
					if (cursor && seenCursors.has(cursor)) throw Object.assign(new Error("Repeated outgoing cursor."), {code: "RESPONSE_INVALID"});
					if (cursor) seenCursors.add(cursor);
				} while (cursor);
				for (const operationId of this._multiSourceCommands.keys()) {
					if (multi.some(operation => operation.operationId === operationId)) continue;
					const detail = await this._api.pGetMultiTargetOperation({campaignId: this._campaignId, operationId});
					if (!this._isRefreshCurrent(token)) return false;
					if (detail?.operation?.sourceCharacterId !== token.characterId) throw Object.assign(new Error("Operation authorization changed."), {code: "ACTION_NOT_FOUND"});
					multi.push(detail.operation);
				}
				for (const operation of multi) {
					if (operation.sourceCharacterId !== token.characterId) continue;
					await this._pAdoptMultiResult(operation, token);
					if (!this._isRefreshCurrent(token)) return false;
				}
			}
			if (this._collectionRevision !== token.collectionRevision) {
				isCollectionStale = true;
				return false;
			}
			const outgoing = (actions || [])
				.map(action => this._normalizeOutgoing(action))
				.filter(Boolean)
				.concat(multi.filter(operation => operation.sourceCharacterId === token.characterId).map(operation => this._normalizeMultiOutgoing(operation)).filter(Boolean));
			this._outgoing = new Map(outgoing.map(action => [action.actionId, action]));
			this._isAuthorityRevalidating = false;
			return true;
		} catch (error) {
			if (!this._isRefreshCurrent(token)) return false;
			if (this._collectionRevision !== token.collectionRevision) {
				isCollectionStale = true;
				return false;
			}
			if (_ACCESS_LOSS_CODES.has(error?.code)) {
				this.deactivate();
				return false;
			}
			this._loadError = _getSafeError(error);
			return false;
		} finally {
			if (this._isRefreshCurrent(token)) {
				this._isLoading = false;
				this._render();
				if (isCollectionStale) void this.pRefresh();
			}
		}
	}

	async pCancel ({actionId}) {
		const action = this._outgoing.get(actionId);
		if (action?.isMulti) return this._pResolveMultiSource({actionId, kind: "cancel"});
		if (this._isSuspended || !action?.canCancel || action.isSubmitting) return false;
		const token = {generation: this._generation, characterId: this._characterId};
		action.isSubmitting = true;
		action.error = null;
		this._render();
		try {
			const response = await this._api.pResolveStructuredAction({
				campaignId: this._campaignId,
				actionId,
				decision: "cancel",
				contractVersion: 1,
				idempotencyKey: action.cancelCommandId ||= this._fnCreateId(),
			});
			if (!this._isCurrent(token)) return false;
			const status = response?.operation?.status || "cancelled";
			const sourceResult = response?.operation?.sourceResult;
			if (status === "applied" && sourceResult) {
				await this._fnOnAuthoritativeApplied?.({
					actionId,
					characterId: token.characterId,
					eventId: sourceResult.appliedEventId,
					sequence: response?.watermarks?.find(watermark => watermark.characterId === token.characterId)?.sequence,
					resultingCharacterRevision: sourceResult.resultingSourceCharacterRevision,
					leg: sourceResult.leg || "source",
					sourceCost: sourceResult.sourceCost,
					...(sourceResult.leg === "combined"
						? {operation: response?.operation?.operation}
						: {}),
				});
			}
			if (!this._isCurrent(token)) return false;
			const currentAction = this._outgoing.get(actionId);
			if (!currentAction) return true;
			currentAction.status = status;
			currentAction.sourceCostState = status === "applied" ? "consumed" : "not_consumed";
			currentAction.canCancel = false;
			currentAction.isSubmitting = false;
			this._collectionRevision++;
			this._render();
			this._focusAction(actionId);
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) return false;
			const currentAction = this._outgoing.get(actionId);
			if (!currentAction) return false;
			currentAction.isSubmitting = false;
			currentAction.error = _getSafeError(error);
			this._render();
			this._focusAction(actionId);
			return false;
		}
	}

	async _pLoadTargets () {
		const response = await this._api.pListCampaignCharacterProjections({campaignId: this._campaignId});
		const roster = Array.isArray(response?.roster) ? response.roster : [];
		const targetRefs = new Map(roster
			.filter(entry => typeof entry?.characterId === "string" && typeof entry?.targetRef === "string")
			.map(entry => [entry.characterId, entry.targetRef]));
		return getTargetableProjections({projections: response?.projections, roster})
			.map(projection => ({
				characterId: getProjectionId(projection),
				name: getProjectionName(projection),
				targetRef: targetRefs.get(getProjectionId(projection)),
				isSelf: getProjectionId(projection) === this._characterId,
			}))
			.filter(target => target.characterId && target.targetRef && target.name)
			.sort((a, b) => a.name.localeCompare(b.name) || a.characterId.localeCompare(b.characterId));
	}

	async _pSubmitDraft (draft) {
		if (draft.isMulti) return this._pSubmitMultiDraft(draft);
		if (draft.isFeature && !this._hasCapability("feature_use")) {
			this._showError("Campaign feature targeting is unavailable. Lay on Hands points have not been spent.");
			return false;
		}
		if (this._isSuspended || draft.isSubmitting || draft.isAwaitingAuthoritativeReconciliation) return false;
		const token = {generation: this._generation, characterId: draft.sourceCharacterId};
		draft.isSubmitting = true;
		draft.error = null;
		draft.errorCode = null;
		this._render();
		try {
			const response = await this._api.pCreatePeerAction(draft.request);
			if (!this._isCurrent(token)) return false;
			const action = this._normalizeOutgoing(response?.operation || response, {
				fallback: {
					actionId: response?.operation?.operationId,
					status: response?.operation?.status || "proposed",
					expiresAt: response?.operation?.expiresAt,
					presentation: {
						effectLabel: draft.isFeature ? draft.spell.name : `${draft.spell.name} (level ${draft.slotLevel})`,
						targetName: draft.target.name,
						outcomeLabel: "Healing is rolled once and applied after approval.",
					},
					sourceCostState: "pending",
					canCancel: true,
				},
			});
			if (!action) throw Object.assign(new Error("Invalid proposal response."), {code: "RESPONSE_INVALID"});
			this._outgoing.set(action.actionId, action);
			this._collectionRevision++;
			this._drafts.delete(draft.draftKey);
			this._render();
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) {
				if (this._isSuspended && this._characterId === token.characterId && this._drafts.get(draft.draftKey) === draft) {
					draft.isSubmitting = false;
					draft.error = _getSafeError(error);
					draft.errorCode = error?.code;
				}
				return false;
			}
			if (_ACCESS_LOSS_CODES.has(error?.code)) {
				this.deactivate();
				return false;
			}
			if (_isDefinitiveProposalRejection(error)) {
				draft.isAwaitingAuthoritativeReconciliation = true;
				draft.isSubmitting = false;
				draft.error = _getSafeError(error);
				draft.errorCode = error.code;
				this._render();
				await this._pRecoverDefinitiveProposalRejections();
				return false;
			}
			draft.isSubmitting = false;
			draft.error = _getSafeError(error);
			draft.errorCode = typeof error?.code === "string" ? error.code.slice(0, 80) : "REQUEST_FAILED";
			this._render();
			return false;
		}
	}

	_normalizeOutgoing (action, {fallback = null} = {}) {
		const value = {...fallback, ...action};
		const actionId = value.actionId || value.operationId;
		if (typeof actionId !== "string" || !actionId || !_STATUSES.has(value.status)) return null;
		const presentation = value.presentation || {};
		return {
			actionId,
			status: value.status,
			expiresAt: value.expiresAt || null,
			presentation: {
				effectLabel: String(presentation.effectLabel || value.effectDisplaySnapshot?.label || "Campaign effect").slice(0, 120),
				targetName: String(presentation.targetName || value.targetDisplaySnapshot?.name || "Campaign character").slice(0, 120),
				outcomeLabel: String(presentation.outcomeLabel || value.effectDisplaySnapshot?.outcomeLabel || "Awaiting approval").slice(0, 160),
				tableRules: typeof presentation.tableRules === "string" ? presentation.tableRules.slice(0, 500) : null,
			},
			sourceCostState: value.sourceCostState || (value.status === "applied" ? "consumed" : value.status === "proposed" ? "pending" : "not_consumed"),
			canCancel: value.capabilities?.canCancel === true || value.canCancel === true,
			isSubmitting: false,
			error: null,
			cancelCommandId: null,
		};
	}

	_hasCapability (resourceKind = "spell_slot") {
		const capability = this._fnGetCapability?.();
		return capability?.enabled === true
			&& capability.contractVersion === _CAPABILITY.contractVersion
			&& capability.protocolVersion === _CAPABILITY.protocolVersion
			&& capability.operationVersion === _CAPABILITY.operationVersion
			&& capability.templateRegistryVersion === _CAPABILITY.templateRegistryVersion
			&& Array.isArray(capability.resourceKinds)
			&& capability.resourceKinds.includes(resourceKind);
	}

	_hasOwnerAuthority () {
		return this._fnIsOwner?.() === true;
	}

	_hasMultiCapability () {
		return hasMultiTargetOperationsCapability(this._fnGetMultiTargetCapability());
	}

	_hasAnyCapability () {
		return this._hasCapability() || this._hasCapability("feature_use") || this._hasMultiCapability();
	}

	async _pMaybeProposeMultiTarget ({descriptor, spell, selectedSlot}) {
		if (!this._characterId || this._membershipRole !== "player" || !this._hasOwnerAuthority()) return {handled: false};
		if (this._isSuspended || this._isAuthorityRevalidating || this._hasDraftAwaitingAuthoritativeReconciliation()) {
			this._showError("Reconnect and verify campaign requests before sending another request. No source cost has been spent.");
			return {handled: true, proposed: false};
		}
		const token = {generation: this._generation, characterId: this._characterId, isMulti: true};
		try {
			const targets = await this._pLoadTargets();
			if (!this._isCurrent(token)) return {handled: true, proposed: false};
			const maxTargets = Math.min(descriptor.maxTargets || 8, 8);
			const picked = await this._fnPickTargets({spell, slotLevel: selectedSlot?.level, targets, maxTargets, tableRules: descriptor.tableRules});
			if (!this._isCurrent(token) || !picked || picked.kind === "cancel") return {handled: true, proposed: false};
			if (picked.kind === "local") return {handled: false};
			const refs = picked.targetRefs;
			const selected = Array.isArray(refs) ? refs.map(ref => targets.find(target => target.targetRef === ref)) : [];
			if (!selected.length || selected.length > maxTargets || selected.some(target => !target) || new Set(selected.map(target => target.characterId)).size !== selected.length) {
				this._showError(`Choose between one and ${maxTargets} different campaign characters.`);
				return {handled: true, proposed: false};
			}
			if (!descriptor?.sourceEntity?.uid || !descriptor.sourceEntity.version || !descriptor.effectTemplateId || !descriptor.choice || typeof descriptor.choice !== "object" || Array.isArray(descriptor.choice)) {
				this._showError("This effect has no reviewed campaign descriptor. No source cost has been spent.");
				return {handled: true, proposed: false};
			}
			const freeze = value => {
				if (value && typeof value === "object") {
					for (const child of Object.values(value)) freeze(child);
					Object.freeze(value);
				}
				return value;
			};
			const draftKey = `multi:${token.characterId}:${JSON.stringify([descriptor, refs])}`;
			let draft = this._drafts.get(draftKey);
			if (!draft) {
				const commandId = this._fnCreateId();
				draft = {
					isMulti: true,
					commandId,
					draftKey,
					sourceCharacterId: token.characterId,
					target: {name: `${selected.length} selected characters`},
					spell,
					request: freeze({
						campaignId: this._campaignId,
						contractVersion: 1,
						sourceCharacterId: token.characterId,
						sourceEntity: structuredClone(descriptor.sourceEntity),
						effectTemplateId: descriptor.effectTemplateId,
						choice: structuredClone(descriptor.choice),
						targetRefs: [...refs],
						rulesVersionId: this._fnGetRulesVersionId(),
						idempotencyKey: commandId,
					}),
				};
				this._drafts.set(draftKey, draft);
			}
			return {handled: true, proposed: await this._pSubmitDraft(draft), isMulti: true};
		} catch (error) {
			if (this._isCurrent(token)) {
				if (_ACCESS_LOSS_CODES.has(error?.code)) this.deactivate();
				else this._showError(_getSafeError(error));
			}
			return {handled: true, proposed: false};
		}
	}

	async _pSubmitMultiDraft (draft) {
		const token = {generation: this._generation, characterId: draft.sourceCharacterId, isMulti: true};
		if (!this._isCurrent(token) || this._isAuthorityRevalidating || draft.isSubmitting || draft.isAwaitingAuthoritativeReconciliation) return false;
		draft.isSubmitting = true;
		draft.error = null;
		this._render();
		try {
			const receipt = await this._api.pCreateMultiTargetOperation(draft.request);
			if (!this._isCurrent(token)) return false;
			const operationId = receipt?.operation?.operationId;
			if (typeof operationId !== "string" || !operationId) throw Object.assign(new Error("Invalid command receipt."), {code: "RESPONSE_INVALID"});
			// An exact retry acknowledges the original command, not current readiness.
			const detail = await this._api.pGetMultiTargetOperation({campaignId: this._campaignId, operationId});
			if (!this._isCurrent(token)) return false;
			const action = this._normalizeMultiOutgoing(detail?.operation);
			if (!action || detail.operation.sourceCharacterId !== token.characterId) throw Object.assign(new Error("Invalid operation detail."), {code: "RESPONSE_INVALID"});
			await this._pAdoptMultiResult(detail.operation, token);
			if (!this._isCurrent(token)) return false;
			this._outgoing.set(action.actionId, action);
			this._drafts.delete(draft.draftKey);
			this._collectionRevision++;
			this._render();
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) return false;
			draft.isSubmitting = false;
			draft.error = _getSafeError(error);
			if (_ACCESS_LOSS_CODES.has(error?.code)) this.deactivate();
			else {
				this._render();
				if (_isDefinitiveProposalRejection(error) && !["RESPONSE_INVALID"].includes(error.code)) {
					draft.isAwaitingAuthoritativeReconciliation = true;
					await this._pRecoverDefinitiveProposalRejections();
				}
			}
			return false;
		}
	}

	_normalizeMultiOutgoing (operation) {
		if (!operation?.operationId || ![...MULTI_TARGET_OPERATION_LIVE_STATUSES, ...MULTI_TARGET_OPERATION_TERMINAL_STATUSES].includes(operation.status)) return null;
		const current = this._outgoing.get(operation.operationId);
		const command = this._multiSourceCommands.get(operation.operationId) ?? current?.command ?? null;
		const targets = (operation.targets || []).map(target => ({
			invitationId: target.invitationId,
			status: target.status,
			name: String(target.presentation?.targetName || "Campaign character unavailable").slice(0, 120),
		}));
		const approvedIds = new Set(targets.filter(target => ["approved", "approved_by_source"].includes(target.status)).map(target => target.invitationId));
		return {
			isMulti: true,
			actionId: operation.operationId,
			status: operation.status,
			presentation: {
				effectLabel: String(operation.presentation?.effectLabel || "Campaign effect").slice(0, 120),
				targetName: `${targets.length} candidate characters`,
				outcomeLabel: "Owners respond independently. Finalization applies your selected approved subset atomically.",
				tableRules: typeof operation.presentation?.tableRules === "string" ? operation.presentation.tableRules.slice(0, 500) : null,
			},
			targets,
			selectedInvitationIds: current?.selectedInvitationIds
				? new Set([...current.selectedInvitationIds].filter(id => approvedIds.has(id)))
				: approvedIds,
			sourceCostState: operation.status === "applied" ? "consumed" : command && MULTI_TARGET_OPERATION_LIVE_STATUSES.includes(operation.status) ? "unconfirmed" : "not_consumed",
			canCancel: operation.capabilities?.canCancel === true,
			canFinalize: operation.capabilities?.canFinalize === true,
			isSubmitting: current?.isSubmitting === true,
			error: current?.error ?? null,
			command,
		};
	}

	async _pAdoptMultiResult (operation, token) {
		if (!this._isCurrent(token)) return false;
		const delivery = getMultiTargetResultDelivery({operationId: operation.operationId, result: operation.sourceResult, characterId: token.characterId});
		if (!delivery) return false;
		return this._fnOnAuthoritativeApplied?.(delivery);
	}

	async pFinalize ({actionId, selectedInvitationIds}) {
		return this._pResolveMultiSource({actionId, kind: "finalize", selectedInvitationIds});
	}

	async _pResolveMultiSource ({actionId, kind, selectedInvitationIds}) {
		const action = this._outgoing.get(actionId);
		const token = {generation: this._generation, characterId: this._characterId, isMulti: true};
		if (!action?.isMulti || !this._isCurrent(token) || this._isAuthorityRevalidating || action.isSubmitting) return false;
		if (action.command && action.command.kind !== kind) return false;
		action.isSubmitting = true;
		action.error = null;
		this._render();
		try {
			if (!action.command) {
				const fresh = await this._api.pGetMultiTargetOperation({campaignId: this._campaignId, operationId: actionId});
				if (!this._isCurrent(token)) return false;
				const operation = fresh?.operation;
				const ids = selectedInvitationIds ?? [...action.selectedInvitationIds];
				if (operation?.sourceCharacterId !== token.characterId || (kind === "cancel" ? operation.capabilities?.canCancel !== true : operation.status !== "awaiting_source_selection" || operation.capabilities?.canFinalize !== true)) {
					throw Object.assign(new Error("This operation is no longer ready."), {code: "ACTION_NOT_FOUND"});
				}
				if (kind === "finalize" && (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => !operation.targets.some(target => target.invitationId === id && ["approved", "approved_by_source"].includes(target.status))))) {
					throw Object.assign(new Error("Choose an approved subset."), {code: "FINALIZATION_SELECTION_INVALID"});
				}
				action.command = {
					kind,
					request: Object.freeze({
						campaignId: this._campaignId,
						operationId: actionId,
						idempotencyKey: this._fnCreateId(),
						...(kind === "finalize" ? {selectedInvitationIds: Object.freeze([...ids])} : {}),
					}),
				};
				this._multiSourceCommands.set(actionId, action.command);
			}
			action.sourceCostState = "unconfirmed";
			this._render();
			const receipt = await (kind === "cancel"
				? this._api.pCancelMultiTargetOperation(action.command.request)
				: this._api.pFinalizeMultiTargetOperation(action.command.request));
			if (!this._isCurrent(token)) return false;
			if (receipt?.operation?.operationId !== actionId) throw Object.assign(new Error("Invalid receipt."), {code: "RESPONSE_INVALID"});
			await this._pAdoptMultiResult(receipt.operation, token);
			if (!this._isCurrent(token)) return false;
			const fresh = await this._api.pGetMultiTargetOperation({campaignId: this._campaignId, operationId: actionId});
			if (!this._isCurrent(token)) return false;
			await this._pAdoptMultiResult(fresh.operation, token);
			if (!this._isCurrent(token)) return false;
			const normalized = this._normalizeMultiOutgoing(fresh.operation);
			if (!normalized) throw Object.assign(new Error("Invalid detail."), {code: "RESPONSE_INVALID"});
			normalized.isSubmitting = false;
			normalized.command = null;
			this._multiSourceCommands.delete(actionId);
			normalized.error = null;
			this._outgoing.set(actionId, normalized);
			this._collectionRevision++;
			this._render();
			this._focusAction(actionId);
			return true;
		} catch (error) {
			if (!this._isCurrent(token)) return false;
			if (_ACCESS_LOSS_CODES.has(error?.code)) this.deactivate();
			else {
				const current = this._outgoing.get(actionId);
				if (current) {
					current.isSubmitting = false;
					current.error = isTransferOutcomeUncertain(error) || error?.code === "RESPONSE_INVALID"
						? "The command response is unconfirmed; it may already have committed. Check refreshed status, or retry the exact original request."
						: _getSafeError(error);
					// Only a definitive rejection permits a new selection/key, after authoritative refresh.
					if (_isDefinitiveProposalRejection(error) && error?.code !== "RESPONSE_INVALID") {
						current.command = null;
						this._multiSourceCommands.delete(actionId);
					}
				}
				this._render();
				this._focusAction(actionId);
				void this.pRefresh();
			}
			return false;
		}
	}

	_isSupportedSpellShape ({spell, selectedSlot, hasMetamagic = false, hasVariantComponent = false} = {}) {
		const reviewed = resolveReviewedHealingWordSpell({spell, selectedSlot, hasMetamagic, hasVariantComponent});
		if (reviewed?.maxTargets === 1) return true;
		return String(spell?.name || "").toLowerCase() === "cure wounds"
			&& _SOURCE_VERSIONS.has(spell?.source)
			&& Number.isInteger(selectedSlot?.level)
			&& selectedSlot.level >= Math.max(1, Number(spell?.level) || 1)
			&& selectedSlot.level <= 9
			&& !selectedSlot.isPact
			&& !selectedSlot.isNoSlotResource
			&& !selectedSlot.isWizardCapstone
			&& !hasMetamagic
			&& !hasVariantComponent;
	}

	_hasDraftAwaitingAuthoritativeReconciliation () {
		return [...this._drafts.values()].some(draft => draft.isAwaitingAuthoritativeReconciliation);
	}

	_pRecoverDefinitiveProposalRejections () {
		if (this._definitiveRecoveryPromise) return this._definitiveRecoveryPromise;
		if (!this._hasDraftAwaitingAuthoritativeReconciliation()) return Promise.resolve(true);
		const token = {generation: this._generation, characterId: this._characterId};
		const promise = (async () => {
			const isOutgoingReconciled = await this._pRefreshOutgoingActions();
			if (!this._isCurrent(token)) return false;
			if (!isOutgoingReconciled) {
				this._setDefinitiveRecoveryError();
				return false;
			}
			let isContextReconciled = false;
			try {
				isContextReconciled = await this._fnRefreshCampaignContext?.() === true;
			} catch {
				isContextReconciled = false;
			}
			if (!this._isCurrent({...token, generation: this._generation})) return false;
			if (!isContextReconciled) {
				this._setDefinitiveRecoveryError();
				return false;
			}
			this._retireDraftsAwaitingAuthoritativeReconciliation();
			this._render();
			return true;
		})();
		const recoveryPromise = promise.finally(() => {
			if (this._definitiveRecoveryPromise === recoveryPromise) this._definitiveRecoveryPromise = null;
		});
		this._definitiveRecoveryPromise = recoveryPromise;
		return recoveryPromise;
	}

	_setDefinitiveRecoveryError () {
		for (const draft of this._drafts.values()) {
			if (!draft.isAwaitingAuthoritativeReconciliation) continue;
			draft.isSubmitting = false;
			draft.error = "Campaign targeting could not verify the latest authoritative state. Reconnect before starting a new request.";
		}
		this._render();
	}

	_retireDraftsAwaitingAuthoritativeReconciliation () {
		for (const [draftKey, draft] of this._drafts.entries()) {
			if (draft.isAwaitingAuthoritativeReconciliation) this._drafts.delete(draftKey);
		}
	}

	_getProposalRequest ({commandId, sourceCharacterId, spell, slotLevel, targetRef, descriptor = null}) {
		const reviewed = descriptor || resolveReviewedHealingWordSpell({spell, selectedSlot: {level: slotLevel}});
		const sourceEntity = reviewed?.sourceEntity || Object.freeze({
			type: "spell",
			uid: `cure wounds|${String(spell.source).toLowerCase()}`,
			version: _SOURCE_VERSIONS.get(spell.source),
		});
		const choice = Object.freeze(reviewed?.choice ? {...reviewed.choice} : {castLevel: slotLevel});
		return Object.freeze({
			campaignId: this._campaignId,
			contractVersion: 1,
			sourceCharacterId,
			sourceEntity,
			effectTemplateId: reviewed?.effectTemplateId || "spell.cure-wounds.heal",
			choice,
			targetRef,
			rulesVersionId: this._fnGetRulesVersionId?.(),
			idempotencyKey: commandId,
		});
	}

	_isCurrent ({generation, characterId, isMulti = false}) {
		return this._generation === generation && this._characterId === characterId
			&& !this._isSuspended && this._hasOwnerAuthority()
			&& this._fnGetCharacterId() === characterId && this._hasAnyCapability()
			&& (!isMulti || this._hasMultiCapability())
			&& this._authorityVersion === this._fnGetAuthorityVersion();
	}

	_isRefreshCurrent (token) {
		return this._isCurrent(token) && this._refreshSequence === token.refreshSequence;
	}

	_showError (message) {
		this._loadError = message;
		this._render();
	}

	async _pPickTarget ({spell, slotLevel, targets, tableRules = null}) {
		return new Promise(resolve => {
			let isResolved = false;
			let closePicker = null;
			const cancelPicker = () => {
				doResolve({kind: "cancel"});
				closePicker?.(false);
			};
			const doResolve = value => {
				if (isResolved) return;
				isResolved = true;
				if (this._cancelTargetPicker === cancelPicker) this._cancelTargetPicker = null;
				resolve(value);
			};
			this._cancelTargetPicker = cancelPicker;
			CharacterSheetModal.pGetShow({
				title: `Target ${spell.name}`,
				isMinHeight0: true,
				isWidth100: true,
				cbClose: () => doResolve({kind: "cancel"}),
				cbCharacterScopeTeardown: () => doResolve({kind: "cancel"}),
			}).then(({eleModalInner, doClose}) => {
				closePicker = doClose;
				if (isResolved) { doClose(false); return; }
				const body = e_({tag: "div", clazz: "charsheet__peer-target-picker cs-adaptive-panel"});
				const help = e_({
					tag: "p",
					clazz: "charsheet__peer-target-help",
					text: tableRules || resolveReviewedHealingWordSpell({spell, selectedSlot: {level: slotLevel}})?.tableRules
						|| `Choose one campaign character for a level ${slotLevel} Cure Wounds request. The target must be within touch range at the table. Hidden hit points and applicability are checked privately when they approve.`,
				});
				const list = e_({tag: "ul", clazz: "charsheet__peer-target-list"});
				for (const target of targets) {
					const row = e_({tag: "button", clazz: "charsheet__peer-target-option"});
					row.type = "button";
					row.setAttribute("aria-label", `Request ${spell.name} for ${target.name}${target.isSelf ? ", your current character" : ""}`);
					row.append(
						e_({tag: "strong", text: target.name}),
						e_({tag: "span", text: target.isSelf ? "Your character · approval still required" : "Campaign character · owner approval required"}),
					);
					row.addEventListener("click", () => {
						doResolve({kind: "target", targetRef: target.targetRef});
						doClose(true);
					});
					const item = e_({tag: "li"});
					item.append(row);
					list.append(item);
				}
				if (!targets.length) {
					const empty = e_({tag: "p", clazz: "charsheet__peer-target-empty", text: "No privacy-visible campaign characters are currently eligible targets."});
					empty.setAttribute("role", "status");
					list.append(empty);
				}
				const controls = e_({tag: "div", clazz: "charsheet__peer-target-controls"});
				const local = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: "Resolve locally"});
				local.type = "button";
				local.addEventListener("click", () => {
					doResolve({kind: "local"});
					doClose(true);
				});
				const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: "Cancel"});
				cancel.type = "button";
				cancel.addEventListener("click", () => {
					doResolve({kind: "cancel"});
					doClose(false);
				});
				controls.append(local, cancel);
				body.append(help, list, controls);
				eleModalInner.append(body);
				list.querySelector("button")?.focus();
			});
		});
	}

	async _pPickTargets ({spell, targets, maxTargets = 8, tableRules = null}) {
		return new Promise(resolve => {
			let resolved = false;
			let closePicker = null;
			const cancelPicker = () => {
				finish({kind: "cancel"});
				closePicker?.(false);
			};
			const finish = value => {
				if (resolved) return;
				resolved = true;
				if (this._cancelTargetPicker === cancelPicker) this._cancelTargetPicker = null;
				resolve(value);
			};
			this._cancelTargetPicker = cancelPicker;
			CharacterSheetModal.pGetShow({
				title: `Target ${spell.name}`,
				isMinHeight0: true,
				isWidth100: true,
				cbClose: () => finish({kind: "cancel"}),
				cbCharacterScopeTeardown: () => finish({kind: "cancel"}),
			}).then(({eleModalInner, doClose}) => {
				closePicker = doClose;
				if (resolved) { doClose(false); return; }
				const body = e_({tag: "div", clazz: "charsheet__peer-target-picker cs-adaptive-panel"});
				body.append(e_({tag: "p", text: `Choose 1–${maxTargets} different characters. No cost is reserved or spent while owners respond. Your own candidates are auto-approved; you may deselect them before finalizing.`}));
				if (tableRules) body.append(e_({tag: "p", text: tableRules}));
				const selected = new Set();
				const list = e_({tag: "ul", clazz: "charsheet__peer-target-list"});
				const send = e_({tag: "button", clazz: "ve-btn ve-btn-primary", text: "Send requests"});
				send.type = "button";
				send.disabled = true;
				for (const target of targets) {
					const checkbox = e_({tag: "input"});
					checkbox.type = "checkbox";
					checkbox.dataset.hubTargetRef = target.targetRef;
					checkbox.addEventListener("change", () => {
						if (checkbox.checked && selected.size >= maxTargets) checkbox.checked = false;
						if (checkbox.checked) selected.add(target.targetRef);
						else selected.delete(target.targetRef);
						send.disabled = selected.size < 1;
					});
					const label = e_({tag: "label", clazz: "charsheet__peer-target-option"});
					label.append(checkbox, e_({tag: "span", text: `${target.name}${target.isSelf ? " · Current character" : ""}`}));
					const row = e_({tag: "li"});
					row.append(label);
					list.append(row);
				}
				send.addEventListener("click", () => {
					finish({kind: "targets", targetRefs: [...selected]});
					doClose(true);
				});
				const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: "Cancel"});
				cancel.type = "button";
				cancel.addEventListener("click", () => { finish({kind: "cancel"}); doClose(false); });
				const controls = e_({tag: "div", clazz: "charsheet__peer-target-controls"});
				if (tableRules) {
					const local = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: "Resolve locally"});
					local.type = "button";
					local.addEventListener("click", () => { finish({kind: "local"}); doClose(true); });
					controls.append(local);
				}
				controls.append(send, cancel);
				body.append(list, controls);
				eleModalInner.append(body);
				list.querySelector("input")?.focus();
			});
		});
	}

	_focusAction (actionId, invitationId = null) {
		const action = [...(this._root?.querySelectorAll?.("[data-hub-action-id]") || [])]
			.find(element => element.dataset.hubActionId === actionId && typeof element.focus === "function");
		const checkbox = invitationId && [...(action?.querySelectorAll?.("[data-hub-invitation-id]") || [])]
			.find(element => element.dataset.hubInvitationId === invitationId);
		(checkbox || action)?.focus();
	}

	_render () {
		if (!this._root) return;
		this._root.innerHTML = "";
		this._root.setAttribute("aria-busy", this._isLoading ? "true" : "false");
		this._root.setAttribute("aria-live", "polite");
		if (this._isSuspended || this._isAuthorityRevalidating) {
			this._root.append(e_({tag: "p", text: "Campaign targeting is reconnecting. Requests keep their original identities; wait for authorized context before continuing."}));
			if (!this._isSuspended) {
				const refresh = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-default", text: "Refresh requests"});
				refresh.type = "button";
				refresh.disabled = this._isLoading;
				refresh.addEventListener("click", () => void this.pRefresh());
				this._root.append(refresh);
				if (this._loadError) this._root.append(e_({tag: "p", text: this._loadError, attrs: {role: "alert"}}));
			}
			this._root.hidden = false;
			return;
		}

		if (this._loadError) {
			const error = e_({tag: "div", clazz: "charsheet__peer-action-error", text: this._loadError});
			error.setAttribute("role", "alert");
			this._root.append(error);
		}
		const drafts = [...this._drafts.values()].filter(draft => draft.isSubmitting || draft.error);
		const actions = [...this._outgoing.values()];
		if (drafts.length || actions.length) {
			this._root.append(e_({tag: "h2", clazz: "charsheet__peer-actions-title", text: "Your campaign requests"}));
			const refresh = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-default", text: "Refresh requests"});
			refresh.type = "button";
			refresh.disabled = this._isLoading;
			refresh.addEventListener("click", () => void this.pRefresh());
			this._root.append(refresh);
		}
		for (const draft of drafts) this._root.append(this._getDraftCard(draft));
		for (const action of actions) this._root.append(this._getActionCard(action));
		this._root.hidden = !this._loadError && !drafts.length && !actions.length;
	}

	_getDraftCard (draft) {
		const card = e_({tag: "article", clazz: "charsheet__peer-action"});
		let statusText = draft.error;
		const cost = draft.isFeature ? "Lay on Hands points" : "spell slot";
		if (draft.isSubmitting) statusText = `Sending request… No ${cost} ${draft.isFeature ? "have" : "has"} been spent.`;
		if (draft.isAwaitingAuthoritativeReconciliation) statusText = draft.error;
		if (this._isSuspended) statusText = `Reconnecting… This request keeps its original identity. No ${cost} ${draft.isFeature ? "have" : "has"} been spent.`;
		card.append(
			e_({tag: "strong", text: `${draft.spell.name} → ${draft.target.name}`}),
			e_({tag: "span", text: statusText}),
		);
		const reviewed = resolveReviewedHealingWordSpell({spell: draft.spell, selectedSlot: {level: draft.slotLevel}});
		if (draft.tableRules || reviewed?.tableRules) card.append(e_({tag: "span", text: draft.tableRules || reviewed.tableRules}));
		if (draft.error && !draft.isAwaitingAuthoritativeReconciliation) {
			const retry = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-primary", text: "Retry"});
			retry.type = "button";
			retry.disabled = this._isSuspended;
			retry.addEventListener("click", () => void this._pSubmitDraft(draft));
			card.append(retry);
		}
		return card;
	}

	_getActionCard (action) {
		const card = e_({tag: "article", clazz: "charsheet__peer-action"});
		card.classList.add(`charsheet__peer-action--${action.status}`);
		card.tabIndex = -1;
		card.dataset.hubActionId = action.actionId;
		const copy = e_({tag: "div", clazz: "charsheet__peer-action-copy"});
		copy.append(
			e_({tag: "strong", text: `${action.presentation.effectLabel} → ${action.presentation.targetName}`}),
			e_({tag: "span", text: action.presentation.outcomeLabel}),
			e_({tag: "span", clazz: "charsheet__peer-action-state", text: `${action.status.replaceAll("_", " ")} · source cost ${action.sourceCostState.replaceAll("_", " ")}`}),
		);
		if (action.presentation.tableRules) copy.append(e_({tag: "span", text: action.presentation.tableRules}));
		card.append(copy);
		if (action.isMulti) {
			for (const target of action.targets) {
				const row = e_({tag: "label", clazz: "charsheet__peer-target-option"});
				const approved = ["approved", "approved_by_source"].includes(target.status);
				if (action.canFinalize && approved) {
					const checkbox = e_({tag: "input"});
					checkbox.type = "checkbox";
					checkbox.dataset.hubInvitationId = target.invitationId;
					checkbox.checked = action.selectedInvitationIds.has(target.invitationId);
					checkbox.disabled = this._isSuspended || action.isSubmitting || !!action.command;
					checkbox.addEventListener("change", () => {
						if (checkbox.checked) action.selectedInvitationIds.add(target.invitationId);
						else action.selectedInvitationIds.delete(target.invitationId);
						this._render();
						this._focusAction(action.actionId, target.invitationId);
					});
					row.append(checkbox);
				}
				row.append(e_({tag: "span", text: `${target.name} · ${target.status.replaceAll("_", " ")}`}));
				card.append(row);
			}
			if (action.canFinalize || action.command?.kind === "finalize") {
				const finalize = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-primary", text: action.command ? "Retry exact finalization" : "Finalize selected effects"});
				finalize.type = "button";
				finalize.disabled = this._isSuspended || action.isSubmitting || (!action.command && !action.targets.some(target => action.selectedInvitationIds.has(target.invitationId) && ["approved", "approved_by_source"].includes(target.status)));
				finalize.addEventListener("click", () => void this.pFinalize({actionId: action.actionId}));
				card.append(finalize);
			}
		}
		if ((action.canCancel && (action.status === "proposed" || action.isMulti)) || action.command?.kind === "cancel") {
			const cancel = e_({
				tag: "button",
				clazz: "ve-btn ve-btn-sm ve-btn-default",
				text: this._isSuspended ? "Reconnect to cancel" : action.isSubmitting ? "Cancelling…" : "Cancel request",
			});
			cancel.type = "button";
			cancel.disabled = this._isSuspended || action.isSubmitting || (action.command && action.command.kind !== "cancel");
			cancel.dataset.hubActionId = action.actionId;
			cancel.setAttribute("aria-label", `Cancel ${action.presentation.effectLabel} request for ${action.presentation.targetName}`);
			cancel.addEventListener("click", () => void this.pCancel({actionId: action.actionId}));
			card.append(cancel);
		}
		if (action.error) {
			const error = e_({tag: "span", clazz: "charsheet__peer-action-error", text: action.error});
			error.setAttribute("role", "alert");
			card.append(error);
		}
		return card;
	}
}

globalThis.CharacterSheetPeerTargeting = CharacterSheetPeerTargeting;
