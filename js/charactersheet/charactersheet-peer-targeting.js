import {getProjectionId, getProjectionName, getTargetableProjections} from "../hub/hub-character-view.js";
import {CharacterSheetModal} from "./charactersheet-modal.js";

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

const _getSafeError = error => {
	switch (error?.code) {
		case "NETWORK_UNAVAILABLE": return "Targeting is offline. Reconnect before sending this request.";
		case "PROTOCOL_UPDATE_REQUIRED": return "Reload the page to use campaign targeting.";
		case "CAPABILITY_UNAVAILABLE": return "Campaign targeting is not available right now.";
		case "SOURCE_OR_TARGET_UNAVAILABLE": return "That spell or target is no longer available.";
		case "SOURCE_COST_UNSUPPORTED": return "This casting option cannot be paid atomically yet.";
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
		fnGetRulesVersionId,
		fnGetCapability,
		fnCreateId = () => crypto.randomUUID(),
		fnPickTarget = null,
		fnOnAuthoritativeApplied = null,
	} = {}) {
		this._campaignId = campaignId;
		this._api = api;
		this._root = root;
		this._fnGetCharacterId = fnGetCharacterId;
		this._fnGetRulesVersionId = fnGetRulesVersionId;
		this._fnGetCapability = fnGetCapability;
		this._fnCreateId = fnCreateId;
		this._fnPickTarget = fnPickTarget || (options => this._pPickTarget(options));
		this._fnOnAuthoritativeApplied = fnOnAuthoritativeApplied;
		this._generation = 0;
		this._refreshSequence = 0;
		this._collectionRevision = 0;
		this._characterId = null;
		this._outgoing = new Map();
		this._drafts = new Map();
		this._isLoading = false;
		this._loadError = null;
		this._onFocus = () => {
			if (this._characterId) void this.pRefresh();
		};
		this._onVisibilityChange = () => {
			if (document.visibilityState === "visible" && this._characterId) void this.pRefresh();
		};
	}

	init () {
		if (!this._campaignId || !this._api || !this._fnGetCharacterId || !this._fnGetCapability) return false;
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
		this.deactivate();
		if (!characterId || !this._hasCapability()) return false;
		this._characterId = characterId;
		this._generation++;
		void this.pRefresh();
		return true;
	}

	deactivate () {
		this._generation++;
		this._refreshSequence++;
		this._characterId = null;
		this._outgoing.clear();
		this._drafts.clear();
		this._isLoading = false;
		this._loadError = null;
		this._render();
	}

	onConnectionState (state) {
		if (["access_lost", "closed"].includes(state?.state)) {
			this.deactivate();
			return;
		}
		if (state?.state === "live" && this._fnGetCharacterId?.()) {
			this._characterId = this._fnGetCharacterId();
			void this.pRefresh();
		}
	}

	onRealtimeOperation (event) {
		if (!this._characterId || !event?.operationId) return false;
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
		return this._hasCapability()
			&& this._characterId
			&& String(spell?.name || "").toLowerCase() === "cure wounds"
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

	async pMaybeProposeSpell ({
		spell,
		selectedSlot,
		hasMetamagic = false,
		hasVariantComponent = false,
	} = {}) {
		if (!this.isSupportedSpellCast({spell, selectedSlot, hasMetamagic, hasVariantComponent})) return {handled: false};
		const token = {generation: this._generation, characterId: this._characterId};
		let targets;
		try {
			targets = await this._pLoadTargets();
		} catch (error) {
			if (this._isCurrent(token)) this._showError(_getSafeError(error));
			return {handled: true, proposed: false};
		}
		if (!this._isCurrent(token)) return {handled: true, proposed: false};

		const choice = await this._fnPickTarget({spell, slotLevel: selectedSlot.level, targets});
		if (!this._isCurrent(token) || !choice || choice.kind === "cancel") return {handled: true, proposed: false};
		if (choice.kind === "local") return {handled: false};

		const target = targets.find(it => it.targetRef === choice.targetRef);
		if (!target) return {handled: true, proposed: false};
		const draftKey = `${this._characterId}|${spell.source}|${selectedSlot.level}|${target.targetRef}`;
		const draft = this._drafts.get(draftKey) || {
			commandId: this._fnCreateId(),
			draftKey,
			sourceCharacterId: this._characterId,
			spell,
			slotLevel: selectedSlot.level,
			target,
		};
		this._drafts.set(draftKey, draft);
		const proposed = await this._pSubmitDraft(draft);
		return {handled: true, proposed};
	}

	async pRefresh () {
		if (!this._characterId || !this._hasCapability() || typeof this._api.pListCharacterOutgoingActions !== "function") return false;
		const token = {
			generation: this._generation,
			characterId: this._characterId,
			refreshSequence: ++this._refreshSequence,
			collectionRevision: this._collectionRevision,
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
			if (this._collectionRevision !== token.collectionRevision) {
				isCollectionStale = true;
				return false;
			}
			this._outgoing = new Map((actions || [])
				.map(action => this._normalizeOutgoing(action))
				.filter(Boolean)
				.map(action => [action.actionId, action]));
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
		if (!action?.canCancel || action.isSubmitting) return false;
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
		if (draft.isSubmitting) return false;
		const token = {generation: this._generation, characterId: draft.sourceCharacterId};
		draft.isSubmitting = true;
		draft.error = null;
		draft.errorCode = null;
		this._render();
		try {
			const response = await this._api.pCreatePeerAction({
				campaignId: this._campaignId,
				contractVersion: 1,
				sourceCharacterId: draft.sourceCharacterId,
				sourceEntity: {
					type: "spell",
					uid: `cure wounds|${String(draft.spell.source).toLowerCase()}`,
					version: _SOURCE_VERSIONS.get(draft.spell.source),
				},
				effectTemplateId: "spell.cure-wounds.heal",
				choice: {castLevel: draft.slotLevel},
				targetRef: draft.target.targetRef,
				rulesVersionId: this._fnGetRulesVersionId?.(),
				idempotencyKey: draft.commandId,
			});
			if (!this._isCurrent(token)) return false;
			const action = this._normalizeOutgoing(response?.operation || response, {
				fallback: {
					actionId: response?.operation?.operationId,
					status: response?.operation?.status || "proposed",
					expiresAt: response?.operation?.expiresAt,
					presentation: {
						effectLabel: `Cure Wounds (level ${draft.slotLevel})`,
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
			if (!this._isCurrent(token)) return false;
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
			},
			sourceCostState: value.sourceCostState || (value.status === "applied" ? "consumed" : value.status === "proposed" ? "pending" : "not_consumed"),
			canCancel: value.capabilities?.canCancel === true || value.canCancel === true,
			isSubmitting: false,
			error: null,
			cancelCommandId: null,
		};
	}

	_hasCapability () {
		const capability = this._fnGetCapability?.();
		return capability?.enabled === true
			&& capability.contractVersion === _CAPABILITY.contractVersion
			&& capability.protocolVersion === _CAPABILITY.protocolVersion
			&& capability.operationVersion === _CAPABILITY.operationVersion
			&& capability.templateRegistryVersion === _CAPABILITY.templateRegistryVersion
			&& Array.isArray(capability.resourceKinds)
			&& capability.resourceKinds.includes("spell_slot");
	}

	_isCurrent ({generation, characterId}) {
		return this._generation === generation && this._characterId === characterId;
	}

	_isRefreshCurrent (token) {
		return this._isCurrent(token) && this._refreshSequence === token.refreshSequence;
	}

	_showError (message) {
		this._loadError = message;
		this._render();
	}

	async _pPickTarget ({spell, slotLevel, targets}) {
		return new Promise(resolve => {
			let isResolved = false;
			const doResolve = value => {
				if (isResolved) return;
				isResolved = true;
				resolve(value);
			};
			CharacterSheetModal.pGetShow({
				title: `Target ${spell.name}`,
				isMinHeight0: true,
				isWidth100: true,
				cbClose: () => doResolve({kind: "cancel"}),
			}).then(({eleModalInner, doClose}) => {
				const body = e_({tag: "div", clazz: "charsheet__peer-target-picker cs-adaptive-panel"});
				const help = e_({
					tag: "p",
					clazz: "charsheet__peer-target-help",
					text: `Choose one campaign character for a level ${slotLevel} Cure Wounds request. The target must be within touch range at the table. Hidden hit points and applicability are checked privately when they approve.`,
				});
				const list = e_({tag: "ul", clazz: "charsheet__peer-target-list"});
				for (const target of targets) {
					const row = e_({tag: "button", clazz: "charsheet__peer-target-option"});
					row.type = "button";
					row.setAttribute("aria-label", `Request Cure Wounds for ${target.name}${target.isSelf ? ", your current character" : ""}`);
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

	_focusAction (actionId) {
		const action = [...(this._root?.querySelectorAll?.("[data-hub-action-id]") || [])]
			.find(element => element.dataset.hubActionId === actionId && typeof element.focus === "function");
		action?.focus();
	}

	_render () {
		if (!this._root) return;
		this._root.innerHTML = "";
		this._root.setAttribute("aria-busy", this._isLoading ? "true" : "false");
		this._root.setAttribute("aria-live", "polite");

		if (this._loadError) {
			const error = e_({tag: "div", clazz: "charsheet__peer-action-error", text: this._loadError});
			error.setAttribute("role", "alert");
			this._root.append(error);
		}
		const drafts = [...this._drafts.values()].filter(draft => draft.isSubmitting || draft.error);
		const actions = [...this._outgoing.values()];
		if (drafts.length || actions.length) this._root.append(e_({tag: "h2", clazz: "charsheet__peer-actions-title", text: "Your campaign requests"}));
		for (const draft of drafts) this._root.append(this._getDraftCard(draft));
		for (const action of actions) this._root.append(this._getActionCard(action));
		this._root.hidden = !this._loadError && !drafts.length && !actions.length;
	}

	_getDraftCard (draft) {
		const card = e_({tag: "article", clazz: "charsheet__peer-action"});
		card.append(
			e_({tag: "strong", text: `Cure Wounds → ${draft.target.name}`}),
			e_({tag: "span", text: draft.isSubmitting ? "Sending request… No spell slot has been spent." : draft.error}),
		);
		if (draft.error) {
			const retry = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-primary", text: "Retry"});
			retry.type = "button";
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
		card.append(copy);
		if (action.canCancel && action.status === "proposed") {
			const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-sm ve-btn-default", text: action.isSubmitting ? "Cancelling…" : "Cancel request"});
			cancel.type = "button";
			cancel.disabled = action.isSubmitting;
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
