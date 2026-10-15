import {
	getProjectionId,
	getProjectionView,
	getTargetableProjections,
} from "../hub/hub-character-view.js";
import {getCarryProfile, getCarryStatus, getCoinWeight} from "../hub/hub-carry-contract.js";
import {
	getInventoryStackWeight,
	getInventoryTransferStatusMessage,
	getInventoryTransferEligibility,
	getInventoryWeightSummary,
} from "../hub/hub-inventory-contract.js";
import {
	HUB_TRANSFER_REPLAY_WINDOW_MS,
	HubTransferResolutionDrafts,
	isTransferOutcomeUncertain,
	pResolveTransferFromDraft,
	pResolveTransferAndRefresh,
} from "../hub/hub-api-client.js";

const DM_ROLES = new Set(["dm", "co_dm"]);
const CURRENCY_TYPES = ["cp", "sp", "ep", "gp", "pp"];
const MAX_SEEN_EVENT_KEYS = 2_000;
const TERMINAL_ACCESS_ERROR_CODES = new Set([
	"AUTH_REQUIRED",
	"CAMPAIGN_NOT_FOUND",
	"CHARACTER_CAMPAIGN_MISMATCH",
	"CHARACTER_NOT_FOUND",
	"FORBIDDEN",
]);

const ERROR_MESSAGES = {
	CHARACTER_BUSY: "This character is busy with another authoritative change. Wait a moment, then try again.",
	FORBIDDEN: "Your campaign role no longer allows this transfer. The inventories are unchanged.",
	IDEMPOTENCY_KEY_REUSED: "This transfer retry no longer matches the original request. Review the summary and try again.",
	IDEMPOTENCY_WINDOW_EXPIRED: "This transfer retry is too old to replay safely. Refresh this character and inspect the destination before starting another transfer.",
	NETWORK_UNAVAILABLE: "The Campaign Hub could not be reached. Your last synced stash is still shown; reconnect and retry.",
	TRANSFER_INSUFFICIENT: "The available quantity changed before the transfer completed. Nothing else was moved.",
	TRANSFER_ITEM_LINKED: "That stack is now linked to equipment or another character feature, so it cannot move safely.",
	TRANSFER_NOT_FOUND: "That transfer is no longer waiting. Refresh to see the latest inventories.",
};
const TRANSFER_REFRESH_REQUIRED_MESSAGE = "The latest character and party stash balances could not be loaded. Retry the refresh before sending another transfer.";
const TRANSFER_AUTHORITY_RECHECK_MESSAGE = "Transfer acknowledged. Rechecking current campaign authority and balances; no new decision has been sent.";

let fallbackTokenId = 0;

function getOpaqueToken () {
	return globalThis.crypto?.randomUUID?.() || `opaque-${++fallbackTokenId}`;
}

function getEntryName (entry) {
	return `${entry?.item?.name || "Unnamed item"}`.trim() || "Unnamed item";
}

function getQuantity (entry) {
	const quantity = Number(entry?.quantity);
	return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
}

function formatNumber (value) {
	return new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
}

/**
 * A weight, marked `≥` when the figure is only a lower bound.
 *
 * A load containing a stack of unknown weight is not the number we can add up; it is at least
 * that number. Printing it bare states a precision we do not have — and the omission is least
 * visible exactly where it matters most, since a lower bound that already exceeds capacity
 * still reads as a settled, exact reading.
 * @param {number} value
 * @param {boolean} isLowerBound
 * @returns {string}
 */
function formatWeight (value, isLowerBound) {
	return `${isLowerBound ? "≥" : ""}${formatNumber(value)}`;
}

function getTransferLimit ({container, entry}) {
	const quantity = getQuantity(entry);
	if (!quantity) return {maxQuantity: 0, blockers: ["invalid available quantity"]};
	const whole = getInventoryTransferEligibility({container, entry, quantity});
	return {
		maxQuantity: whole.isEligible ? quantity : whole.maxQuantity,
		blockers: whole.blockers,
	};
}

function getBlockerText ({blockers, maxQuantity}) {
	if (!blockers?.length) return "";
	const reason = blockers.join(", ");
	return maxQuantity > 0
		? `Share up to ${maxQuantity}; the rest must stay (${reason}).`
		: `Can't share this stack: ${reason}.`;
}

function getCurrencySummary (currency = {}) {
	const labels = ["pp", "gp", "ep", "sp", "cp"]
		.map(type => {
			const amount = Number(currency?.[type]);
			return Number.isSafeInteger(amount) && amount > 0 ? `${formatNumber(amount)} ${type.toUpperCase()}` : null;
		})
		.filter(Boolean);
	return labels.join(" · ") || "No shared currency";
}

function getErrorMessage (error) {
	return ERROR_MESSAGES[error?.code]
		|| "The latest party inventory could not be loaded. Your inventories are unchanged; retry when the connection is available.";
}

function getComparableTransferPayload (payload = {}) {
	const value = payload.request || payload.escrow || payload;
	const items = (value.items || [])
		.map(item => ({
			entryId: item.entryId || item.id,
			quantity: Number(item.quantity),
		}))
		.sort((a, b) => `${a.entryId}`.localeCompare(`${b.entryId}`) || a.quantity - b.quantity);
	const currency = Object.fromEntries(CURRENCY_TYPES.map(type => [type, Number(value.currency?.[type]) || 0]));
	return JSON.stringify({items, currency});
}

function isProjectedTransferMatch ({transfer, request}) {
	if (
		!transfer
		|| transfer.sourceKind !== request.sourceKind
		|| transfer.targetKind !== request.targetKind
		|| (transfer.sourceId && transfer.sourceId !== request.sourceId)
		|| (transfer.targetId && transfer.targetId !== request.targetId)
	) return false;
	return getComparableTransferPayload(transfer.payload) === getComparableTransferPayload(request.payload);
}

function createElement (tag, {className = "", text = "", attrs = {}} = {}) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text) element.textContent = text;
	for (const [name, value] of Object.entries(attrs)) {
		if (value == null || value === false) continue;
		if (value === true) element.setAttribute(name, "");
		else element.setAttribute(name, `${value}`);
	}
	return element;
}

export function getPartyInventoryStashAction (role) {
	if (DM_ROLES.has(role)) return "take";
	if (role === "player") return "request";
	return null;
}

export function getPartyInventoryRecipients ({projections = [], roster = [], currentCharacterId}) {
	return getTargetableProjections({projections, roster})
		.filter(projection => getProjectionId(projection) !== currentCharacterId)
		.map(projection => {
			const view = getProjectionView(projection);
			// Preserve the recipient's carry ONLY when they chose to share it. It is absent
			// from the projection otherwise, so nothing here can reconstruct a withheld load —
			// the transfer preview simply says nothing about that character, which is what
			// ADR 0011 requires of any peer-facing carry surface.
			const carry = view.carrySummary;
			const isShared = !!carry && Number.isFinite(Number(carry.carried)) && Number.isFinite(Number(carry.capacity));
			return {
				id: getProjectionId(projection),
				label: view.name,
				summary: view.classes.map(cls => `${cls.name}${Number.isFinite(cls.level) ? ` ${cls.level}` : ""}`).join(" / "),
				isOwned: projection.kind === "owner_truth",
				carry: isShared
					? {
						carried: Number(carry.carried),
						capacity: Number(carry.capacity),
						state: typeof carry.state === "string" ? carry.state : null,
						// Independent of `state`: an over-capacity recipient can still be a lower
						// bound, and dropping this rendered their weight as exact.
						isIndeterminate: carry.isIndeterminate === true || carry.state === "unknown",
					}
					: null,
			};
		})
		.filter(recipient => recipient.id && recipient.label)
		.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function getPartyInventoryTransferTargetId ({
	sourceKind,
	destinationKind,
	activeCharacterId,
	recipientId,
	partyInventoryId,
}) {
	if (destinationKind === "party_inventory") return partyInventoryId;
	return sourceKind === "party_inventory" ? activeCharacterId : recipientId;
}

/**
 * Authoritative party-stash UI for an owned cloud character. It never mutates either
 * inventory directly: every move is proposed through transfer escrow, then canonical
 * character truth is reconciled through the cloud repository.
 */
export class CharacterSheetPartyInventory {
	constructor ({
		campaignId,
		api,
		repository,
		realtime = null,
		fnGetCharacterData,
		fnAdoptCharacterData,
		fnSaveCharacter,
		fnIsCurrentCharacter,
		fnGetRulesVersionId = () => null,
		fnRefreshCampaignContext = null,
		fnGetCarryProfile = null,
		fnProjectItemWeight = null,
		fnToast = detail => globalThis.JqueryUtil?.doToast?.(detail),
	}) {
		this._campaignId = campaignId;
		this._api = api;
		this._repository = repository;
		this._realtime = realtime;
		this._fnGetCharacterData = fnGetCharacterData;
		this._fnAdoptCharacterData = fnAdoptCharacterData;
		this._fnSaveCharacter = fnSaveCharacter;
		this._fnIsCurrentCharacter = fnIsCurrentCharacter;
		this._fnGetRulesVersionId = fnGetRulesVersionId;
		this._fnRefreshCampaignContext = fnRefreshCampaignContext;
		this._transferResolutionDrafts = new HubTransferResolutionDrafts({fnCreateKey: getOpaqueToken});
		// Supplies the live carry profile so a transfer can be previewed against the same
		// calculation the carry bar uses. Optional: without it the preview simply omits the
		// carry line rather than guessing at capacity.
		this._fnGetCarryProfile = fnGetCarryProfile;
		// Projects an item's effective weight through the sheet's material rules.
		this._fnProjectItemWeight = fnProjectItemWeight;
		this._fnToast = fnToast;

		this._isEnabled = typeof campaignId === "string"
			&& !!campaignId
			&& !!api
			&& typeof repository?.pReconcileAuthoritativeCharacter === "function";
		this._active = null;
		this._root = null;
		this._incomingRoot = null;
		this._incomingTransfers = [];
		this._incomingStatuses = new Map();
		this._incomingError = null;
		this._incomingOutcomeWarning = null;
		this._incomingUnconfirmed = null;
		this._incomingBusyTransferId = null;
		this._incomingButtonRefs = new WeakMap();
		this._outgoingTransfers = [];
		this._outgoingStatuses = new Map();
		this._isAuthorityPending = false;
		this._partyInventory = null;
		this._role = null;
		this._recipients = [];
		this._recipientByToken = new Map();
		this._itemByToken = new Map();
		this._tokenByItemKey = new Map();
		this._draft = null;
		this._needsAuthoritativeRefresh = false;
		this._needsFreshProposalRules = false;
		this._freshProposalRulesVersionId = undefined;
		this._error = null;
		this._reconcileError = null;
		this._partyError = null;
		this._announcement = "";
		this._refreshNotice = "";
		this._connectionState = null;
		this._isLoading = false;
		this._isSubmitting = false;
		this._refreshFlags = {character: false, party: false};
		this._refreshPromise = null;
		this._manualRefreshPromise = null;
		this._partyFetchToken = null;
		this._projectionVisibilityEpoch = 0;
		this._scheduledRefresh = false;
		this._activationRetryTimer = null;
		this._seenEventKeys = new Set();
		this._inventoryObserver = null;
		this._isDecorateScheduled = false;
		this._isDocumentListenerBound = false;
		this._unsubscribers = [];
		this._boundDocumentClick = event => this._onDocumentClick(event);

		if (this._isEnabled) this._bindRealtime();
	}

	_bindRealtime () {
		if (!this._realtime?.on) return;
		this._unsubscribers.push(
			this._realtime.on("inventoryTransfer", event => this._onInventoryTransfer(event)),
			this._realtime.on("projectionInvalidated", () => {
				if (this._active?.isActivationPending) void this._pActivate(this._active);
				else this._onVisibilityChanged();
			}),
			this._realtime.on("membershipChanged", () => {
				if (this._active?.isActivationPending) void this._pActivate(this._active);
				else this._onVisibilityChanged({isAuthorityChanged: true});
			}),
			this._realtime.on("connectionState", state => this._onConnectionState(state)),
		);
	}

	async pAttach ({characterId, generation}) {
		this.detach();
		if (!this._isEnabled || typeof characterId !== "string" || !characterId) return false;
		const active = {
			characterId,
			generation,
			token: Symbol("party-inventory"),
			isOwner: false,
			isActivationPending: true,
			activationPromise: null,
			needsActivationRetry: false,
		};
		this._active = active;
		return this._pActivate(active);
	}

	isAttachedTo ({characterId, generation = null}) {
		return !!this._active
			&& this._active.characterId === characterId
			&& (generation == null || this._active.generation === generation);
	}

	async _pActivate (active) {
		if (!this._isCurrent(active)) return false;
		if (active.activationPromise) {
			active.needsActivationRetry = true;
			return active.activationPromise;
		}
		const promise = (async () => {
			let projection;
			try {
				projection = await this._api.pGetCharacterProjection({characterId: active.characterId});
			} catch (error) {
				if (TERMINAL_ACCESS_ERROR_CODES.has(error?.code) && this._isCurrent(active)) this.detach();
				else this._scheduleActivationRetry(active);
				return false;
			}
			if (!this._isCurrent(active)) return false;
			if (projection?.kind !== "owner_truth") {
				this.detach();
				return false;
			}

			active.isOwner = true;
			active.isActivationPending = false;
			this._clearActivationRetry();
			this._mount();
			this._bindInventoryUi();
			this._isLoading = true;
			this._render();
			this._refreshFlags = {character: true, party: true};
			await this._pDrainRefresh();
			return this._isCurrent(active) && active.isOwner;
		})();
		active.activationPromise = promise;
		try {
			return await promise;
		} finally {
			if (active.activationPromise === promise) active.activationPromise = null;
			if (this._isCurrent(active) && active.isActivationPending && active.needsActivationRetry) {
				active.needsActivationRetry = false;
				queueMicrotask(() => void this._pActivate(active));
			}
		}
	}

	detach () {
		this._clearActivationRetry();
		this._active = null;
		this._draft = null;
		this._needsAuthoritativeRefresh = false;
		this._needsFreshProposalRules = false;
		this._freshProposalRulesVersionId = undefined;
		this._error = null;
		this._reconcileError = null;
		this._partyError = null;
		this._announcement = "";
		this._refreshNotice = "";
		this._partyInventory = null;
		this._role = null;
		this._recipients = [];
		this._recipientByToken.clear();
		this._itemByToken.clear();
		this._tokenByItemKey.clear();
		this._seenEventKeys.clear();
		this._refreshFlags = {character: false, party: false};
		this._refreshPromise = null;
		this._manualRefreshPromise = null;
		this._partyFetchToken = null;
		this._scheduledRefresh = false;
		this._connectionState = null;
		this._isLoading = false;
		this._isSubmitting = false;
		this._inventoryObserver?.disconnect();
		this._inventoryObserver = null;
		if (this._isDocumentListenerBound && typeof document !== "undefined") document.removeEventListener("click", this._boundDocumentClick);
		this._isDocumentListenerBound = false;
		if (typeof document !== "undefined") {
			document.querySelectorAll(".charsheet__item-party-move, .charsheet__item-party-note").forEach(element => element.remove());
		}
		this._root?.remove();
		this._root = null;
		this._incomingRoot?.remove();
		this._incomingRoot = null;
		this._incomingTransfers = [];
		this._incomingStatuses.clear();
		this._incomingError = null;
		this._incomingOutcomeWarning = null;
		this._incomingUnconfirmed = null;
		this._incomingBusyTransferId = null;
		this._outgoingTransfers = [];
		this._outgoingStatuses.clear();
		this._isAuthorityPending = false;
	}

	_clearActivationRetry () {
		if (this._activationRetryTimer == null) return;
		clearTimeout(this._activationRetryTimer);
		this._activationRetryTimer = null;
	}

	_scheduleActivationRetry (active) {
		if (!this._isCurrent(active) || !active.isActivationPending || this._activationRetryTimer != null) return;
		active.activationRetryCount = (active.activationRetryCount || 0) + 1;
		const delay = Math.min(1_000 * (2 ** (active.activationRetryCount - 1)), 30_000);
		this._activationRetryTimer = setTimeout(() => {
			this._activationRetryTimer = null;
			if (this._isCurrent(active) && active.isActivationPending) void this._pActivate(active);
		}, delay);
		this._activationRetryTimer?.unref?.();
	}

	destroy () {
		this.detach();
		for (const unsubscribe of this._unsubscribers) unsubscribe();
		this._unsubscribers = [];
	}

	_isCurrent (active = this._active) {
		return !!active
			&& active === this._active
			&& this._fnIsCurrentCharacter?.({
				characterId: active.characterId,
				generation: active.generation,
			}) !== false;
	}

	_mount () {
		if (this._root?.isConnected) return;
		const equipmentList = document.getElementById("charsheet-inventory-list");
		const equipmentSection = equipmentList?.closest(".charsheet__section--inventory");
		if (!equipmentSection) return;
		this._ensureStylesheet();
		this._root = createElement("section", {
			className: "charsheet__section charsheet__party-inventory",
			attrs: {
				"aria-labelledby": "charsheet-party-inventory-title",
				"data-charsheet-party-inventory": "",
				tabindex: -1,
			},
		});
		equipmentSection.insertAdjacentElement("afterend", this._root);
		const campaignBanner = document.getElementById("charsheet-hub-effects");
		if (campaignBanner) {
			this._incomingRoot = createElement("section", {
				className: "charsheet__incoming-transfers",
				attrs: {
					"aria-label": "Incoming inventory transfers",
					"aria-live": "polite",
					"data-charsheet-incoming-transfers": "",
					role: "region",
					hidden: true,
					tabindex: -1,
				},
			});
			campaignBanner.insertAdjacentElement("afterend", this._incomingRoot);
		}
	}

	_ensureStylesheet () {
		if (document.querySelector("link[data-charsheet-party-inventory-style]")) return;
		const link = createElement("link", {
			attrs: {
				rel: "stylesheet",
				href: "css/charactersheet-party-inventory.css",
				"data-charsheet-party-inventory-style": "",
			},
		});
		document.head.append(link);
	}

	_bindInventoryUi () {
		if (!this._isDocumentListenerBound) {
			document.addEventListener("click", this._boundDocumentClick);
			this._isDocumentListenerBound = true;
		}
		const inventoryList = document.getElementById("charsheet-inventory-list");
		if (inventoryList && typeof MutationObserver !== "undefined") {
			this._inventoryObserver = new MutationObserver(() => this._scheduleDecorateCharacterInventory());
			this._inventoryObserver.observe(inventoryList, {childList: true, subtree: true});
		}
		this._decorateCharacterInventory();
	}

	_scheduleDecorateCharacterInventory () {
		if (this._isDecorateScheduled || !this._active?.isOwner) return;
		this._isDecorateScheduled = true;
		queueMicrotask(() => {
			this._isDecorateScheduled = false;
			if (this._isCurrent()) this._decorateCharacterInventory();
		});
	}

	_getItemToken ({kind, entryId}) {
		const key = `${kind}:${entryId}`;
		let token = this._tokenByItemKey.get(key);
		if (!token) {
			token = getOpaqueToken();
			this._tokenByItemKey.set(key, token);
		}
		return token;
	}

	_hasTransferAuthority () {
		return !this._isAuthorityPending && (this._role === "player" || DM_ROLES.has(this._role));
	}

	_decorateCharacterInventory () {
		if (!this._active?.isOwner) return;
		if (!this._hasTransferAuthority()) {
			document.querySelectorAll("#charsheet-inventory-list .charsheet__item-party-move, #charsheet-inventory-list .charsheet__item-party-note")
				.forEach(element => element.remove());
			return;
		}
		const data = this._fnGetCharacterData?.() || {};
		const container = {
			...data,
			inventory: Array.isArray(data.inventory) ? data.inventory : [],
		};
		const entries = new Map(container.inventory.map(entry => [entry.id, entry]));
		for (const row of document.querySelectorAll("#charsheet-inventory-list .charsheet__item[data-item-id]")) {
			const entry = entries.get(row.dataset.itemId);
			const actions = row.querySelector(".charsheet__item-actions");
			if (!entry || !actions) continue;
			const {maxQuantity, blockers} = getTransferLimit({container, entry});
			const blockerText = getBlockerText({blockers, maxQuantity});
			const token = this._getItemToken({kind: "character", entryId: entry.id});
			this._itemByToken.set(token, {kind: "character", entryId: entry.id});

			let button = actions.querySelector(".charsheet__item-party-move");
			if (!button) {
				button = createElement("button", {
					className: "ve-btn ve-btn-xs ve-btn-default charsheet__item-party-move",
					text: "Share...",
					attrs: {type: "button"},
				});
				actions.append(button);
			}
			button.dataset.token = token;
			button.disabled = maxQuantity < 1 || !!this._draft || this._needsAuthoritativeRefresh || this._isSubmitting;
			button.setAttribute("aria-label", maxQuantity
				? `Share ${getEntryName(entry)} with the party`
				: `${getEntryName(entry)} cannot be shared: ${blockers.join(", ")}`);
			button.title = blockerText || `Move this stack to the party stash or pass it to another campaign character`;

			const existingNote = row.querySelector(".charsheet__item-party-note");
			if (!blockerText) existingNote?.remove();
			else if (!existingNote) {
				const note = createElement("span", {
					className: "charsheet__item-party-note",
					text: blockerText,
				});
				const details = row.querySelector(".charsheet__item-details") || row.querySelector(".charsheet__item-content");
				details?.append(note);
			} else if (existingNote.textContent !== blockerText) existingNote.textContent = blockerText;
		}
	}

	_onDocumentClick (event) {
		const button = event.target.closest?.(".charsheet__item-party-move");
		if (!button || !this._isCurrent() || button.disabled) return;
		const source = this._itemByToken.get(button.dataset.token);
		if (!source || source.kind !== "character") return;
		this._beginDraft({...source, returnToken: button.dataset.token});
	}

	_beginDraft ({kind, entryId = null, returnToken = null}) {
		if (!this._isCurrent() || !this._active?.isOwner) return false;
		if (this._needsAuthoritativeRefresh) {
			this._error = TRANSFER_REFRESH_REQUIRED_MESSAGE;
			this._render();
			return false;
		}
		if (!this._hasTransferAuthority() || this._isSubmitting || this._draft) return false;
		const entry = this._getEntry({kind, entryId});
		if (entryId && !entry) return false;
		const container = this._getContainer(kind);
		const {maxQuantity, blockers} = entry ? getTransferLimit({container, entry}) : {maxQuantity: 0, blockers: []};
		if (entry && !maxQuantity) {
			this._error = getBlockerText({blockers, maxQuantity});
			this._render();
			return false;
		}
		this._draft = {
			kind,
			entryId,
			entryFingerprint: entry ? JSON.stringify(entry.item) : null,
			quantity: 1,
			currency: {},
			maxQuantity,
			blockers,
			entryName: entry ? getEntryName(entry) : "Currency",
			destinationKind: kind === "party_inventory" ? "character" : "party_inventory",
			recipientId: null,
			returnToken,
			commandId: getOpaqueToken(),
			resolutionCommandId: getOpaqueToken(),
			cancellationCommandId: getOpaqueToken(),
			transfer: null,
			needsStatusCheck: false,
			pendingResolution: null,
		};
		this._error = null;
		this._announcement = "Choose quantity, currency and destination below. No item has moved yet.";
		this._render();
		if (this._root) this._decorateCharacterInventory();
		if (kind === "character" && returnToken) {
			const quantity = this._root?.querySelector(`[data-party-inventory-focus="${entry ? "quantity" : "currency-cp"}"]`);
			quantity?.focus({preventScroll: true});
			quantity?.scrollIntoView({block: "center"});
		}
		return true;
	}

	_canEditDraft (draft, active) {
		const canRetainLocalEdits = this._isAuthorityPending && !!this._partyInventory
			&& (this._role === "player" || DM_ROLES.has(this._role));
		return this._draft === draft && this._isCurrent(active) && active?.isOwner
			&& (this._hasTransferAuthority() || canRetainLocalEdits)
			&& !this._isSubmitting && this._isDraftEditable(draft);
	}

	_rotateDraftCommands () {
		this._draft.commandId = getOpaqueToken();
		this._draft.resolutionCommandId = getOpaqueToken();
		this._draft.cancellationCommandId = getOpaqueToken();
	}

	_getDraftIntent () {
		return this._draft.kind === "party_inventory" ? "request"
			: this._draft.destinationKind === "character" ? "pass" : "deposit";
	}

	_setDraftIntent (intent) {
		if (!this._canEditDraft(this._draft, this._active) || intent === this._getDraftIntent()) return false;
		if (!["deposit", "request", "pass"].includes(intent)) return false;
		Object.assign(this._draft, {
			kind: intent === "request" ? "party_inventory" : "character",
			destinationKind: intent === "deposit" ? "party_inventory" : "character",
			recipientId: null,
			entryId: null,
			entryFingerprint: null,
			entryName: "Currency",
			quantity: 1,
			currency: {},
			maxQuantity: 0,
			blockers: [],
			returnToken: null,
		});
		this._rotateDraftCommands();
		this._announcement = "Transfer direction changed. Choose the contents again; nothing has moved.";
		this._render();
		return true;
	}

	_getDraftValidation (draft = this._draft) {
		const container = this._getContainer(draft.kind);
		const entry = this._getEntry(draft);
		let itemError = null;
		if (draft.entryId) {
			if (!entry || (draft.entryFingerprint != null && draft.entryFingerprint !== JSON.stringify(entry.item))) {
				itemError = "The selected stack changed or is no longer available. Choose the stack again before sending.";
			} else {
				const eligibility = getInventoryTransferEligibility({container, entry, quantity: Number(draft.quantity)});
				if (!eligibility.isEligible) itemError = getBlockerText(eligibility);
			}
		}
		const currency = Object.fromEntries(CURRENCY_TYPES.map(type => [type, Number(draft.currency?.[type] ?? 0)]));
		const currencyError = CURRENCY_TYPES.some(type =>
			!Number.isSafeInteger(currency[type]) || currency[type] < 0
			|| currency[type] > (Number(container.currency?.[type]) || 0))
			? "Enter whole coin amounts within the source balances. Denominations are not exchanged automatically."
			: null;
		const emptyError = !draft.entryId && !CURRENCY_TYPES.some(type => currency[type] > 0)
			? "Choose an eligible item or enter at least one coin."
			: null;
		return {error: itemError || currencyError || emptyError, currency};
	}

	_getContainer (kind) {
		if (kind === "party_inventory") return this._partyInventory || {inventory: [], currency: {}};
		const data = this._fnGetCharacterData?.() || {};
		return {...data, inventory: Array.isArray(data.inventory) ? data.inventory : []};
	}

	_getEntry ({kind, entryId}) {
		return this._getContainer(kind).inventory?.find(entry => entry.id === entryId) || null;
	}

	_onInventoryTransfer (event) {
		if (!this._active || event?.campaignId !== this._campaignId) return;
		if (!this._active.isOwner) return;
		const key = event.eventId || `${event.type}:${event.sequence}`;
		if (this._seenEventKeys.has(key)) return;
		this._seenEventKeys.add(key);
		if (this._seenEventKeys.size > MAX_SEEN_EVENT_KEYS) this._seenEventKeys.delete(this._seenEventKeys.values().next().value);
		this._scheduleRefresh({
			character: event.isCurrentCharacterAffected === true,
			party: event.isPartyInventoryAffected === true
				|| (event.isCurrentCharacterAffected === true && event.type?.startsWith("transfer.")),
		});
	}

	_onConnectionState (state) {
		if (!this._active) return;
		this._connectionState = state?.state || null;
		if (state?.state === "access_lost") {
			this.detach();
			return;
		}
		if (!this._active.isOwner) {
			if (state?.state === "live" && this._active.isActivationPending) void this._pActivate(this._active);
			return;
		}
		if (state?.state === "live") this._scheduleRefresh({party: true});
		else if (["reconnecting", "unavailable"].includes(state?.state)) this._render();
	}

	_onVisibilityChanged ({isAuthorityChanged = false} = {}) {
		if (!this._active?.isOwner) return;
		this._projectionVisibilityEpoch++;
		this._partyFetchToken = null;
		this._isAuthorityPending = true;
		if (this._draft?.awaitingAuthorityRefresh) this._draft.needsStatusCheck = true;
		this._recipients = [];
		this._recipientByToken.clear();
		this._outgoingTransfers = [];
		if (isAuthorityChanged) {
			this._partyInventory = null;
			this._itemByToken.clear();
			this._outgoingStatuses.clear();
			if (this._isDraftEditable()) this._draft = null;
			this._refreshNotice = "";
			this._announcement = "";
		}
		this._incomingTransfers = [];
		this._incomingError = "Rechecking incoming transfer visibility...";
		this._render();
		this._scheduleRefresh({party: true});
	}

	_scheduleRefresh ({character = false, party = false} = {}) {
		if (!this._active?.isOwner) return;
		if (this._draft?.awaitingAuthorityRefresh) {
			character = true;
			party = true;
		}
		this._refreshFlags.character ||= character;
		this._refreshFlags.party ||= party;
		if (this._scheduledRefresh) return;
		this._scheduledRefresh = true;
		queueMicrotask(() => {
			this._scheduledRefresh = false;
			void this._pDrainRefresh();
		});
	}

	async _pDrainRefresh () {
		const active = this._active;
		const existingRefresh = this._refreshPromise;
		if (existingRefresh?.active === active) {
			const wasSuccessful = await existingRefresh.promise;
			if (
				this._isCurrent(active)
				&& (this._refreshFlags.character || this._refreshFlags.party)
			) return (await this._pDrainRefresh()) && wasSuccessful;
			return wasSuccessful;
		}
		const refresh = {active, promise: null};
		refresh.promise = (async () => {
			let isSuccessful = true;
			let hasCharacterRefresh = false;
			while (
				this._isCurrent(active)
				&& (this._refreshFlags.character || this._refreshFlags.party)
			) {
				const flags = this._refreshFlags;
				this._refreshFlags = {character: false, party: false};
				const tasks = [];
				if (flags.character) {
					tasks.push(this._pReconcileCharacter(active)
						.then(result => {
							const isReconciled = ["reconciled", "stale", "unchanged"].includes(result?.status);
							hasCharacterRefresh ||= isReconciled;
							return isReconciled;
						})
						.catch(() => false));
				}
				if (flags.party) tasks.push(this._pRefreshParty(active).catch(() => false));
				if ((await Promise.all(tasks)).some(result => !result)) isSuccessful = false;
			}
			if (isSuccessful && hasCharacterRefresh) this._settleAcknowledgedAuthorityDraft(active);
			return isSuccessful;
		})();
		this._refreshPromise = refresh;
		try {
			return await refresh.promise;
		} finally {
			if (this._refreshPromise === refresh) this._refreshPromise = null;
			if (
				this._isCurrent(active)
				&& (this._refreshFlags.character || this._refreshFlags.party)
			) this._scheduleRefresh();
		}
	}

	_settleAcknowledgedAuthorityDraft (active) {
		const draft = this._draft;
		if (!this._isCurrent(active) || !this._hasTransferAuthority() || this._isSubmitting
			|| !draft?.awaitingAuthorityRefresh || !draft.transfer || draft.needsStatusCheck
			|| draft.pendingResolution || this._getPendingAcceptance(draft)
			|| this._needsAuthoritativeRefresh || this._partyError || this._reconcileError) return;
		const message = getInventoryTransferStatusMessage({
			status: draft.transfer.status,
			sourceKind: draft.kind,
			targetKind: draft.destinationKind,
			isRefreshed: true,
		});
		this._closeDraft();
		this._fnToast?.({type: draft.transfer.status === "committed" ? "success" : "info", content: message});
		this._announce(message);
	}

	async _pAwaitAcknowledgedTransferAuthority ({active, draft, visibilityEpoch}) {
		if (!this._isAuthorityPending) return;
		this._markAcknowledgedAuthorityRefresh(draft);
		this._render();
		if (!await this._pRefreshAfterTransfer({active, visibilityEpoch})) {
			throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
		}
	}

	_markAcknowledgedAuthorityRefresh (draft) {
		draft.awaitingAuthorityRefresh = !draft.proposalRequest?.isAutoResolved;
		draft.needsStatusCheck = true;
		this._error = TRANSFER_AUTHORITY_RECHECK_MESSAGE;
	}

	_deferAcknowledgedAuthorityDraft (draft) {
		this._markAcknowledgedAuthorityRefresh(draft);
		this._scheduleRefresh({character: true, party: true});
		this._isSubmitting = false;
		this._render();
	}

	async _pRefreshAfterTransfer ({active, visibilityEpoch}) {
		this._refreshFlags.character = true;
		this._refreshFlags.party = true;
		let isRefreshed = await this._pDrainRefresh();
		if (!isRefreshed
			&& this._isCurrent(active)
			&& active.isOwner
			&& this._hasTransferAuthority()
			&& this._projectionVisibilityEpoch !== visibilityEpoch
			&& !this._partyError
			&& !this._reconcileError) {
			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			isRefreshed = await this._pDrainRefresh();
		}
		return isRefreshed;
	}

	async _pRefreshParty (active = this._active) {
		if (!this._isCurrent(active) || !active?.isOwner) return false;
		const fetchToken = Symbol("party-inventory-fetch");
		this._partyFetchToken = fetchToken;
		this._isLoading = true;
		this._render();
		const [partyResult, snapshotResult, transfersResult] = await Promise.allSettled([
			this._api.pGetPartyInventory({campaignId: this._campaignId}),
			this._api.pGetCampaignSnapshot({campaignId: this._campaignId}),
			Promise.resolve().then(() => this._api.pListTransfers({campaignId: this._campaignId})),
		]);
		if (!this._isCurrent(active) || this._partyFetchToken !== fetchToken) return false;
		const accessError = [partyResult, snapshotResult, transfersResult]
			.find(result => result.status === "rejected" && TERMINAL_ACCESS_ERROR_CODES.has(result.reason?.code));
		if (accessError) {
			this.detach();
			return false;
		}

		const snapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
		const currentProjection = snapshot?.characters?.find(projection => getProjectionId(projection) === active.characterId);
		if (snapshot && currentProjection?.kind !== "owner_truth") {
			active.isOwner = false;
			this.detach();
			return false;
		}
		if (partyResult.status === "fulfilled") this._partyInventory = partyResult.value;
		if (snapshot) {
			this._role = snapshot.membership?.role || null;
			this._isAuthorityPending = false;
			if (!this._hasTransferAuthority()) {
				if (this._isDraftEditable() || this._needsAuthoritativeRefresh) {
					this._draft = null;
					this._error = null;
					this._announcement = "Party transfers are read-only for your current campaign role.";
				} else if (this._draft?.transfer) {
					this._draft.needsStatusCheck = true;
				}
			}
			this._recipients = getPartyInventoryRecipients({
				projections: snapshot.characters,
				roster: snapshot.roster,
				currentCharacterId: active.characterId,
			});
			this._rebuildRecipientTokens();
		}
		const isTransferListValid = transfersResult.status === "fulfilled"
			&& Array.isArray(transfersResult.value)
			&& transfersResult.value.every(transfer => transfer && typeof transfer.id === "string"
				&& typeof transfer.status === "string");
		if (isTransferListValid && partyResult.status === "fulfilled" && snapshot) {
			if (this._draft?.awaitingAuthorityRefresh && this._draft.transfer) {
				const current = transfersResult.value.find(transfer => transfer.id === this._draft.transfer.id);
				this._draft.needsStatusCheck = !current;
				if (current) {
					this._draft.transfer = current;
				}
			}
			const outgoing = transfersResult.value.filter(transfer => transfer.actorCommandId
				&& ((transfer.sourceKind === "character" && transfer.sourceId === active.characterId)
					|| (transfer.sourceKind === "party_inventory" && transfer.targetId === active.characterId)));
			const completed = outgoing.filter(transfer =>
				["proposed", "reserved"].includes(this._outgoingStatuses.get(transfer.id))
				&& ["committed", "rejected", "cancelled", "expired"].includes(transfer.status));
			this._outgoingStatuses = new Map(outgoing.map(transfer => [transfer.id, transfer.status]));
			this._outgoingTransfers = outgoing.filter(transfer => ["proposed", "reserved"].includes(transfer.status));
			if (completed.length && !this._isSubmitting) {
				this._scheduleRefresh({character: true});
				this._refreshNotice = completed.map(transfer => getInventoryTransferStatusMessage({
					status: transfer.status,
					sourceKind: transfer.sourceKind,
					targetKind: transfer.targetKind,
				})).join(" ");
				this._announcement = this._refreshNotice;
			}
			const incoming = transfersResult.value.filter(transfer =>
				transfer.targetKind === "character" && transfer.targetId === active.characterId);
			const autoCancelled = incoming.filter(transfer =>
				transfer.status === "cancelled"
				&& transfer.payload?.cancellationReason === "source_insufficient"
				&& this._incomingStatuses.get(transfer.id) === "proposed");
			this._incomingStatuses = new Map(incoming.map(transfer => [transfer.id, transfer.status]));
			this._incomingTransfers = incoming.filter(transfer => transfer.status === "reserved");
			this._incomingError = null;
			let isDraftAutoCancelled = false;
			if (!this._isSubmitting && this._draft?.kind === "party_inventory" && this._draft.transfer?.status === "proposed") {
				const current = transfersResult.value.find(transfer => transfer.id === this._draft.transfer.id);
				if (current?.status === "cancelled" && current.payload?.cancellationReason === "source_insufficient") {
					this._draft = null;
					this._error = null;
					isDraftAutoCancelled = true;
				}
			}
			if (autoCancelled.length || isDraftAutoCancelled) {
				const count = Math.max(autoCancelled.length, 1);
				this._refreshNotice = count === 1
					? "Your stash request is no longer available after another transfer used its contents. Nothing moved to this character."
					: `${count} stash requests are no longer available after another transfer used their contents. Nothing moved to this character.`;
				this._announcement = this._refreshNotice;
				this._fnToast?.({type: "warning", content: this._refreshNotice});
			}
		} else {
			this._outgoingTransfers = [];
			this._incomingTransfers = [];
			this._incomingStatuses.clear();
			this._incomingError = "Incoming transfer status could not be verified. Refresh before responding.";
		}
		this._partyError = partyResult.status === "rejected"
			? getErrorMessage(partyResult.reason)
			: snapshotResult.status === "rejected"
				? getErrorMessage(snapshotResult.reason)
				: transfersResult.status === "rejected"
					? getErrorMessage(transfersResult.reason)
					: isTransferListValid ? null : "The incoming transfer response is invalid. Refresh before responding.";
		this._isLoading = false;
		this._render();
		this._decorateCharacterInventory();
		return partyResult.status === "fulfilled" && snapshotResult.status === "fulfilled"
			&& isTransferListValid;
	}

	_pManualRefresh ({errorSource = null} = {}) {
		if (this._manualRefreshPromise) return this._manualRefreshPromise;
		const active = this._active;
		if (!this._isCurrent(active) || !active?.isOwner) return Promise.resolve(false);
		this._manualRefreshPromise = (async () => {
			const pendingRefresh = this._refreshPromise?.active === active
				? this._refreshPromise.promise
				: null;
			if (pendingRefresh) await pendingRefresh;
			if (!this._isCurrent(active) || !active.isOwner) return false;
			if (errorSource === "reconcile") this._reconcileError = null;
			else if (errorSource === "party") this._partyError = null;
			else if (errorSource === "action") this._error = null;
			this._refreshNotice = errorSource ? "Retrying party stash sync..." : "Refreshing party stash...";
			this._isLoading = true;
			this._render();
			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			let isSuccessful = await this._pDrainRefresh();
			if (!this._isCurrent(active)) return false;
			if (this._needsAuthoritativeRefresh) {
				if (isSuccessful && this._needsFreshProposalRules) {
					this._error = null;
					isSuccessful = await this._pRefreshProposalRules(active);
					if (!this._isCurrent(active)) return false;
				}
				if (!isSuccessful) this._error ||= TRANSFER_REFRESH_REQUIRED_MESSAGE;
				else {
					this._needsAuthoritativeRefresh = false;
					this._refreshDraftTransferLimit();
					this._error = null;
				}
			}
			let isIncomingConfirmed = false;
			if (isSuccessful && this._incomingUnconfirmed) {
				const {transferId, decision} = this._incomingUnconfirmed;
				isIncomingConfirmed = this._confirmIncomingOutcome({transferId, decision, isRecovered: true});
				if (!isIncomingConfirmed && this._incomingStatuses.get(transferId) !== "reserved") {
					this._incomingUnconfirmed = null;
					this._incomingOutcomeWarning = "The transfer has a different or unavailable final status. Inspect the latest balances before acting again.";
				}
			}
			this._refreshNotice = isSuccessful
				? isIncomingConfirmed ? "Transfer outcome confirmed from latest balances." : "Party stash refreshed."
				: "";
			if (isSuccessful && !isIncomingConfirmed) this._announce(this._refreshNotice);
			this._render();
			return isSuccessful;
		})().finally(() => {
			this._manualRefreshPromise = null;
		});
		return this._manualRefreshPromise;
	}

	async _pRefreshProposalRules (active = this._active) {
		if (!this._needsFreshProposalRules) return true;
		try {
			if (this._fnRefreshCampaignContext) {
				const isRefreshed = await this._fnRefreshCampaignContext();
				if (!this._isCurrent(active) || !isRefreshed) return false;
				this._freshProposalRulesVersionId = undefined;
			} else {
				const latestContext = await this._api.pGetCampaignContext({campaignId: this._campaignId});
				if (!this._isCurrent(active)) return false;
				this._freshProposalRulesVersionId = latestContext?.rulesVersion?.id ?? null;
			}
			this._needsFreshProposalRules = false;
			return true;
		} catch (error) {
			this._error = `${getErrorMessage(error)} ${TRANSFER_REFRESH_REQUIRED_MESSAGE}`;
			return false;
		}
	}

	_rebuildRecipientTokens () {
		const previousById = new Map([...this._recipientByToken].map(([token, recipient]) => [recipient.id, token]));
		this._recipientByToken.clear();
		for (const recipient of this._recipients) {
			const token = previousById.get(recipient.id) || getOpaqueToken();
			this._recipientByToken.set(token, recipient);
		}
	}

	async _pReconcileCharacter (active = this._active) {
		if (!this._isCurrent(active)) return {status: "fenced"};
		const result = await this._repository.pReconcileAuthoritativeCharacter({
			characterId: active.characterId,
			fnGetLiveData: () => this._fnGetCharacterData?.(),
			fnAdoptLive: data => this._fnAdoptCharacterData?.(data),
			fnIsCurrent: () => this._isCurrent(active),
		});
		if (!this._isCurrent(active)) return {status: "fenced"};
		const previousError = this._reconcileError;
		if (result.status === "conflict") this._reconcileError = "The server inventory overlaps unsaved edits on this sheet. Saving is paused until you choose a recovery version.";
		else if (result.status === "failed") this._reconcileError = "The latest authoritative inventory could not be applied. Your current sheet was preserved; retry the sync.";
		else if (["reconciled", "stale", "unchanged"].includes(result.status)) this._reconcileError = null;
		if (this._reconcileError !== previousError || this._draft) this._render();
		this._decorateCharacterInventory();
		return result;
	}

	_getVisibleError () {
		if (this._reconcileError) return {source: "reconcile", message: this._reconcileError};
		if (this._error) return {source: "action", message: this._error};
		if (this._partyError) return {source: "party", message: this._partyError};
		return null;
	}

	_render () {
		if (!this._root || !this._active?.isOwner || !this._isCurrent()) return;
		this._refreshDraftTransferLimit();
		const focus = this._captureFocus();
		const visibleError = this._getVisibleError();
		this._root.replaceChildren();
		this._root.append(this._renderHeader());

		if (visibleError) this._root.append(this._renderError(visibleError));
		if (["reconnecting", "unavailable"].includes(this._connectionState)) {
			this._root.append(createElement("p", {
				className: "charsheet__party-inventory-connection",
				text: "Reconnecting to the Campaign Hub. Showing the last synced stash.",
				attrs: {role: "status"},
			}));
		}
		if (this._refreshNotice) {
			this._root.append(createElement("p", {
				className: "charsheet__party-inventory-refresh-status",
				text: this._refreshNotice,
				attrs: {role: "status"},
			}));
		}

		if (this._isLoading && !this._partyInventory) this._root.append(this._renderLoading());
		else if (this._partyInventory) this._root.append(this._renderContents());
		else if (!visibleError) this._root.append(this._renderEmpty("The party stash is not available yet."));

		if (this._draft && (!this._isAuthorityPending || this._partyInventory)) this._root.append(this._renderComposer());
		if (this._outgoingTransfers.length) this._root.append(this._renderOutgoingTransfers());
		this._root.append(createElement("div", {
			className: "sr-only",
			text: this._announcement,
			attrs: {"aria-live": "polite", "aria-atomic": "true", "data-party-inventory-live": ""},
		}));
		this._renderIncomingTransfers();
		this._restoreFocus(focus);
	}

	_renderIncomingTransfers () {
		const root = this._incomingRoot;
		if (!root) return;
		const focusedRef = root.contains(document.activeElement)
			? this._incomingButtonRefs.get(document.activeElement)
			: null;
		const nextButtons = new Map();
		root.replaceChildren();
		root.hidden = !this._incomingTransfers.length && !this._incomingError
			&& !this._incomingOutcomeWarning && !this._incomingUnconfirmed;
		if (root.hidden) return;
		root.setAttribute("aria-busy", this._incomingBusyTransferId ? "true" : "false");
		const title = createElement("h4", {text: "Incoming inventory transfers"});
		root.append(title);
		if (this._incomingOutcomeWarning) {
			root.append(createElement("p", {text: this._incomingOutcomeWarning, attrs: {role: "alert"}}));
		}
		if (this._incomingError) {
			if (this._incomingError !== this._incomingOutcomeWarning) {
				root.append(createElement("p", {text: this._incomingError, attrs: {role: "alert"}}));
			}
		}
		if (this._incomingError || this._incomingUnconfirmed) {
			const refresh = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-default",
				text: "Refresh transfer status",
				attrs: {type: "button", disabled: this._isLoading},
			});
			refresh.addEventListener("click", () => void this._pManualRefresh({errorSource: "party"}));
			root.append(refresh);
		}
		if (this._incomingOutcomeWarning && !this._incomingUnconfirmed && !this._incomingTransfers.length) {
			const dismiss = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-default",
				text: "Dismiss status",
				attrs: {type: "button"},
			});
			dismiss.addEventListener("click", () => {
				this._incomingOutcomeWarning = null;
				this._render();
			});
			root.append(dismiss);
		}
		for (const transfer of this._incomingTransfers) {
			const row = createElement("div", {className: "charsheet__incoming-transfer"});
			const escrow = transfer.payload?.escrow;
			const items = escrow?.items?.map(entry =>
				`${entry.quantity} × ${entry.item?.name || "item"}${entry.item?.source ? ` · ${entry.item.source}` : ""}`) || [];
			const currency = CURRENCY_TYPES.filter(type => Number(escrow?.currency?.[type]) > 0)
				.map(type => `${escrow.currency[type]} ${type.toUpperCase()}`);
			const contents = [...items, ...currency].join(" + ");
			const source = transfer.sourceDisplaySnapshot?.displayName || "A campaign character";
			row.append(createElement("p", {
				text: contents
					? `${source} offers ${contents}. Nothing enters your inventory until you accept.`
					: "An incoming transfer has no verifiable item details. Open the Campaign Hub inbox before responding.",
			}));
			if (contents && !this._incomingError) {
				const controls = createElement("div", {className: "charsheet__incoming-transfer-actions"});
				const existing = this._transferResolutionDrafts.get({campaignId: this._campaignId, transferId: transfer.id});
				for (const [decision, label] of [["accept", "Accept"], ["reject", "Reject"]]) {
					if (existing && existing.decision !== decision) continue;
					const button = createElement("button", {
						className: decision === "accept" ? "ve-btn ve-btn-primary" : "ve-btn ve-btn-default",
						text: existing ? `Retry ${label.toLowerCase()}` : label,
						attrs: {
							type: "button",
							"aria-label": `${existing ? "Retry " : ""}${label} transfer`,
							disabled: !!this._incomingBusyTransferId || !this._hasTransferAuthority()
								|| (existing && !this._transferResolutionDrafts.isReplayable(existing)),
						},
					});
					button.addEventListener("click", () => void this._pResolveIncomingTransfer({
						transferId: transfer.id,
						decision,
					}));
					const ref = `${transfer.id}:${decision}`;
					this._incomingButtonRefs.set(button, ref);
					nextButtons.set(ref, button);
					controls.append(button);
				}
				row.append(controls);
			}
			root.append(row);
		}
		if (focusedRef) {
			const next = nextButtons.get(focusedRef);
			if (next && !next.disabled) next.focus({preventScroll: true});
			else root.focus({preventScroll: true});
		}
	}

	_confirmIncomingOutcome ({transferId, decision, isRecovered = false}) {
		if (this._incomingStatuses.get(transferId) !== (decision === "accept" ? "committed" : "rejected")) return false;
		this._incomingError = null;
		this._incomingOutcomeWarning = null;
		this._incomingUnconfirmed = null;
		const message = isRecovered
			? `Transfer ${decision === "accept" ? "accepted" : "rejected"}; latest balances confirmed after refresh.`
			: decision === "accept" ? "Transfer accepted." : "Transfer rejected.";
		this._fnToast?.({type: "success", content: message});
		this._announce(message);
		return true;
	}

	async _pResolveIncomingTransfer ({transferId, decision}) {
		const active = this._active;
		const isCurrent = () => this._isCurrent(active) && active.isOwner && this._hasTransferAuthority();
		if (!isCurrent()
			|| this._incomingBusyTransferId || this._incomingError
			|| !this._incomingTransfers.some(transfer => transfer.id === transferId)) return false;
		const existing = this._transferResolutionDrafts.get({campaignId: this._campaignId, transferId});
		if (existing && existing.decision !== decision) return false;
		this._incomingBusyTransferId = transferId;
		this._render();
		try {
			const outcome = await pResolveTransferAndRefresh({
				pResolve: () => pResolveTransferFromDraft({
					drafts: this._transferResolutionDrafts,
					campaignId: this._campaignId,
					transferId,
					decision,
					pGetRulesVersionId: async () => {
						const context = await this._api.pGetCampaignContext({campaignId: this._campaignId});
						if (!isCurrent()) throw Object.assign(new Error("Character access changed."), {code: "FORBIDDEN"});
						return context.rulesVersion?.id || null;
					},
					pResolve: request => {
						if (!isCurrent()) throw Object.assign(new Error("Character access changed."), {code: "FORBIDDEN"});
						return this._api.pResolveTransfer(request);
					},
				}),
				pRefresh: async () => {
					if (!isCurrent()) return false;
					this._refreshFlags.character = true;
					this._refreshFlags.party = true;
					return this._pDrainRefresh();
				},
			});
			if (!this._isCurrent(active)) return false;
			const expectedStatus = decision === "accept" ? "committed" : "rejected";
			const isResolved = ["resolved_refreshed", "resolution_failed_refreshed"].includes(outcome.state);
			let isRefreshCurrent = outcome.refreshResult === true;
			if (isResolved && (!isRefreshCurrent || this._incomingStatuses.get(transferId) !== expectedStatus)) {
				this._refreshFlags.character = true;
				this._refreshFlags.party = true;
				isRefreshCurrent = await this._pDrainRefresh();
				if (!this._isCurrent(active)) return false;
			}
			if (isResolved && isRefreshCurrent && this._incomingStatuses.get(transferId) === expectedStatus) {
				this._confirmIncomingOutcome({
					transferId,
					decision,
					isRecovered: outcome.state === "resolution_failed_refreshed",
				});
				return true;
			}
			this._incomingError = outcome.state === "resolution_failed_refreshed"
				? getErrorMessage(outcome.resolutionError)
				: outcome.state === "resolved_refresh_failed"
					? "The decision was sent, but its latest status could not be loaded. Refresh before responding again."
					: "Transfer outcome is not confirmed. Refresh its status before retrying the same decision.";
			this._incomingOutcomeWarning = this._incomingError;
			this._incomingUnconfirmed = {transferId, decision};
			return false;
		} finally {
			if (this._isCurrent(active)) {
				this._incomingBusyTransferId = null;
				this._render();
			}
		}
	}

	_renderHeader () {
		const active = this._active;
		const header = createElement("div", {className: "charsheet__party-inventory-header"});
		const headingGroup = createElement("div");
		const title = createElement("h4", {
			className: "charsheet__section-title mb-0",
			text: "Party Stash",
			attrs: {id: "charsheet-party-inventory-title"},
		});
		const caption = createElement("p", {
			className: "charsheet__party-inventory-caption",
			text: "Shared campaign gear, synchronized with the authoritative server inventory.",
		});
		headingGroup.append(title, caption);
		const controls = createElement("div", {className: "charsheet__party-inventory-header-controls"});
		if (this._hasTransferAuthority()) {
			const share = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-default",
				text: "Share items or currency",
				attrs: {
					type: "button",
					disabled: !!this._draft || this._needsAuthoritativeRefresh || this._isSubmitting,
					"data-party-inventory-focus": "share",
				},
			});
			share.addEventListener("click", () => {
				if (!this._isCurrent(active)) return;
				if (this._beginDraft({kind: "character"})) {
					const focus = this._root?.querySelector("[data-party-inventory-focus=\"item\"]");
					focus?.focus({preventScroll: true});
					focus?.scrollIntoView({block: "center"});
				}
			});
			controls.append(share);
		}
		if (this._partyInventory) {
			controls.append(createElement("span", {
				className: "charsheet__party-inventory-sync",
				text: this._connectionState === "live" ? "Live" : "Synced",
				attrs: {"aria-label": this._connectionState === "live" ? "Party stash connected live" : "Party stash synchronized"},
			}));
		}
		const refresh = createElement("button", {
			className: "ve-btn ve-btn-xs ve-btn-default",
			text: this._isLoading ? "Refreshing..." : "Refresh",
			attrs: {
				type: "button",
				disabled: this._isLoading,
				"data-party-inventory-focus": "refresh",
			},
		});
		refresh.addEventListener("click", () => void this._pManualRefresh());
		controls.append(refresh);
		header.append(headingGroup, controls);
		return header;
	}

	_renderError ({source, message}) {
		const error = createElement("div", {
			className: "charsheet__party-inventory-error",
			attrs: {role: "alert"},
		});
		error.append(createElement("span", {text: message}));
		const retry = createElement("button", {
			className: "ve-btn ve-btn-xs ve-btn-default",
			text: this._isLoading ? "Retrying..." : "Retry",
			attrs: {
				type: "button",
				disabled: this._isLoading,
				"data-party-inventory-focus": "retry",
			},
		});
		retry.addEventListener("click", () => void this._pManualRefresh({errorSource: source}));
		error.append(retry);
		return error;
	}

	_renderLoading () {
		const loading = createElement("div", {
			className: "charsheet__party-inventory-loading",
			attrs: {role: "status", "aria-label": "Loading party stash"},
		});
		for (let i = 0; i < 3; ++i) loading.append(createElement("span"));
		loading.append(createElement("span", {className: "sr-only", text: "Loading party stash..."}));
		return loading;
	}

	_renderContents () {
		const active = this._active;
		const contents = createElement("div");
		const summary = createElement("div", {className: "charsheet__party-inventory-summary"});
		const weight = getInventoryWeightSummary(this._partyInventory.inventory);
		const knownWeight = `${formatNumber(weight.knownWeight)} lb`;
		const unknownWeight = weight.unknownStackCount
			? ` · ${weight.unknownStackCount} stack${weight.unknownStackCount === 1 ? "" : "s"} with unknown weight`
			: "";
		summary.append(
			createElement("span", {
				text: `${this._partyInventory.inventory.length} stack${this._partyInventory.inventory.length === 1 ? "" : "s"} · ${knownWeight}${unknownWeight}`,
			}),
			createElement("span", {text: getCurrencySummary(this._partyInventory.currency)}),
		);
		contents.append(summary);
		if (getPartyInventoryStashAction(this._role) && this._hasTransferAuthority()) {
			const requestCurrency = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-default",
				text: this._role === "player" ? "Request currency" : "Move stash currency",
				attrs: {
					type: "button",
					disabled: !!this._draft || this._needsAuthoritativeRefresh || this._isSubmitting,
					"data-party-inventory-focus": "stash-currency",
				},
			});
			requestCurrency.addEventListener("click", () => {
				if (!this._isCurrent(active)) return;
				if (!this._beginDraft({kind: "party_inventory"})) return;
				const focus = this._root?.querySelector("[data-party-inventory-focus=\"currency-cp\"]");
				focus?.focus({preventScroll: true});
				focus?.scrollIntoView({block: "center"});
			});
			contents.append(requestCurrency);
		}

		if (!this._partyInventory.inventory.length) {
			contents.append(this._renderEmpty("Nothing is stored here yet. Share an eligible stack from your equipment to start the stash."));
			return contents;
		}

		const list = createElement("div", {
			className: "charsheet__party-inventory-list",
			attrs: {role: "list", "aria-label": "Party stash item stacks"},
		});
		for (const entry of this._partyInventory.inventory) list.append(this._renderPartyEntry(entry));
		contents.append(list);
		return contents;
	}

	_renderPartyEntry (entry) {
		const active = this._active;
		const row = createElement("div", {className: "charsheet__party-inventory-row", attrs: {role: "listitem"}});
		const main = createElement("div", {className: "charsheet__party-inventory-row-main"});
		main.append(createElement("strong", {text: getEntryName(entry)}));
		const metadata = [
			entry.item?.source,
			entry.item?.rarity,
			getInventoryStackWeight(entry) == null ? null : `${formatNumber(getInventoryStackWeight(entry))} lb`,
		].filter(Boolean);
		if (metadata.length) main.append(createElement("span", {text: metadata.join(" · ")}));
		const quantity = createElement("span", {
			className: "charsheet__party-inventory-quantity",
			text: `×${formatNumber(entry.quantity)}`,
			attrs: {"aria-label": `Quantity ${entry.quantity}`},
		});
		row.append(main, quantity);

		const {maxQuantity, blockers} = getTransferLimit({container: this._partyInventory, entry});
		const stashAction = getPartyInventoryStashAction(this._role);
		const isDm = stashAction === "take";
		if (!stashAction) {
			row.append(createElement("span", {
				className: "charsheet__party-inventory-row-note",
				text: "The party stash is read-only for your current campaign role.",
			}));
			return row;
		}
		const token = this._getItemToken({kind: "party_inventory", entryId: entry.id});
		this._itemByToken.set(token, {kind: "party_inventory", entryId: entry.id});
		const button = createElement("button", {
			className: `ve-btn ve-btn-xs ${isDm ? "ve-btn-primary" : "ve-btn-default"}`,
			text: isDm ? "Take" : "Request",
			attrs: {
				type: "button",
				disabled: maxQuantity < 1 || !!this._draft || this._needsAuthoritativeRefresh || this._isSubmitting,
				"aria-label": maxQuantity
					? isDm
						? `Move ${getEntryName(entry)} to this character`
						: `Request ${getEntryName(entry)} for this character`
					: `${getEntryName(entry)} cannot move: ${blockers.join(", ")}`,
				title: getBlockerText({blockers, maxQuantity})
					|| (isDm
						? "Move this stack to the open character with DM authority"
						: "Ask a DM to move this stack to the open character"),
				"data-party-inventory-focus": `stash-${token}`,
			},
		});
		button.addEventListener("click", () => {
			if (this._isCurrent(active)) this._beginDraft({kind: "party_inventory", entryId: entry.id, returnToken: token});
		});
		row.append(button);
		const blockerText = getBlockerText({blockers, maxQuantity});
		if (blockerText) row.append(createElement("span", {className: "charsheet__party-inventory-row-note", text: blockerText}));
		return row;
	}

	_renderEmpty (message) {
		return createElement("p", {className: "charsheet__party-inventory-empty", text: message});
	}

	_renderOutgoingTransfers () {
		const section = createElement("div", {className: "charsheet__party-inventory-outgoing"});
		section.append(createElement("h5", {text: "Waiting for approval"}));
		const active = this._active;
		for (const transfer of this._outgoingTransfers) {
			const row = createElement("div", {className: "charsheet__incoming-transfer"});
			const payload = transfer.payload?.escrow || transfer.payload?.preview || transfer.payload?.request || {};
			const items = (payload.items || []).map(entry =>
				`${entry.quantity} × ${entry.item?.name || "item"}`);
			const coins = CURRENCY_TYPES.filter(type => Number(payload.currency?.[type]) > 0)
				.map(type => `${formatNumber(payload.currency[type])} ${type.toUpperCase()}`);
			const source = transfer.sourceKind === "party_inventory" ? "Party stash" : "This character";
			const destination = transfer.targetKind === "party_inventory" ? "Party stash"
				: transfer.targetId === active.characterId ? "This character"
					: transfer.targetDisplaySnapshot?.displayName || "Campaign character";
			row.append(createElement("p", {text: `${source} → ${destination}: ${[...items, ...coins].join(" + ") || "Inventory transfer"}.`}));
			row.append(createElement("p", {
				text: `${getInventoryTransferStatusMessage({
					status: transfer.status,
					sourceKind: transfer.sourceKind,
					targetKind: transfer.targetKind,
				})} ${transfer.status === "proposed"
					? "Cancellation or rejection leaves the stash unchanged."
					: "Cancellation or rejection restores the reserved items and currency to the source."}`,
			}));
			const cancel = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-default",
				text: transfer.status === "proposed" ? "Cancel request" : "Cancel offer",
				attrs: {
					type: "button",
					disabled: !!this._draft || this._isSubmitting || !this._hasTransferAuthority(),
					"data-party-inventory-focus": `cancel-outgoing-${transfer.id}`,
				},
			});
			cancel.addEventListener("click", () => {
				if (!this._isCurrent(active) || !this._hasTransferAuthority() || this._draft
					|| !this._outgoingTransfers.includes(transfer)) return;
				this._draft = {
					kind: transfer.sourceKind,
					destinationKind: transfer.targetKind,
					entryName: items.join(" + ") || "Currency",
					quantity: 1,
					maxQuantity: 1,
					blockers: [],
					currency: payload.currency || {},
					transfer,
					commandId: transfer.actorCommandId,
					cancellationCommandId: getOpaqueToken(),
					needsStatusCheck: false,
				};
				void this._pCancelDraft();
			});
			row.append(cancel);
			section.append(row);
		}
		return section;
	}

	_isDraftEditable (draft = this._draft) {
		return !!draft && !draft.transfer && !draft.proposalRequest && !this._needsAuthoritativeRefresh;
	}

	_refreshDraftTransferLimit (draft = this._draft) {
		if (!draft || draft.transfer || draft.proposalRequest || !draft.entryId) return;
		const {maxQuantity, blockers} = getTransferLimit({
			container: this._getContainer(draft.kind),
			entry: this._getEntry(draft),
		});
		draft.maxQuantity = maxQuantity;
		draft.blockers = blockers;
	}

	_getPendingAcceptance (draft = this._draft) {
		if (!draft?.transfer) return null;
		return this._transferResolutionDrafts.get({
			campaignId: this._campaignId,
			transferId: draft.transfer.id,
		});
	}

	_renderComposer () {
		const draft = this._draft;
		const active = this._active;
		const entry = this._getEntry(this._draft);
		const isProposalFrozen = !!this._draft.proposalRequest && !this._draft.transfer;
		const isProposalReplayExpired = isProposalFrozen && Date.now() >= this._draft.proposalReplayUntil;
		const isAuthorityRefreshRequired = this._needsAuthoritativeRefresh;
		const pendingAcceptance = this._getPendingAcceptance();
		const isStatusCheckRequired = !!this._draft.transfer
			&& !!this._draft.needsStatusCheck
			&& !this._draft.pendingResolution
			&& !pendingAcceptance;
		const isReadOnlyRecovery = !this._hasTransferAuthority()
			&& (isProposalFrozen || isStatusCheckRequired || !!pendingAcceptance || !!this._draft.pendingResolution);
		const composer = createElement("form", {
			className: "charsheet__party-inventory-composer",
			attrs: {
				"aria-label": "Confirm inventory transfer",
				"aria-busy": this._isSubmitting,
				tabindex: -1,
				"data-party-inventory-focus": "composer",
			},
		});
		const title = createElement("h5", {text: "Share items & currency"});
		const fields = createElement("div", {className: "charsheet__party-inventory-fields"});
		const intentField = createElement("label");
		intentField.append(createElement("span", {text: "Action"}));
		const intent = createElement("select", {
			className: "ve-form-control",
			attrs: {"data-party-inventory-focus": "intent"},
		});
		for (const [value, text] of [
			["deposit", "Deposit — this character → party stash"],
			["request", this._role === "player" ? "Request — party stash → this character" : "Move — party stash → this character"],
			["pass", "Pass — this character → another character"],
		]) intent.append(createElement("option", {text, attrs: {value}}));
		intent.value = this._getDraftIntent();
		intent.addEventListener("change", () => {
			if (this._canEditDraft(draft, active)) this._setDraftIntent(intent.value);
		});
		intentField.append(intent);
		fields.append(intentField);

		const source = createElement("div", {className: "charsheet__party-inventory-fixed-destination"});
		source.append(
			createElement("span", {text: "From"}),
			createElement("strong", {text: draft.kind === "party_inventory" ? "Party stash" : "This character"}),
		);
		fields.append(source);
		const itemField = createElement("label");
		itemField.append(createElement("span", {text: "Item (optional)"}));
		const item = createElement("select", {
			className: "ve-form-control",
			attrs: {"data-party-inventory-focus": "item"},
		});
		item.append(createElement("option", {text: "Currency only — no item", attrs: {value: ""}}));
		const container = this._getContainer(draft.kind);
		for (const candidate of container.inventory) {
			const {maxQuantity} = getTransferLimit({container, entry: candidate});
			if (!maxQuantity && candidate.id !== draft.entryId) continue;
			const token = this._getItemToken({kind: draft.kind, entryId: candidate.id});
			this._itemByToken.set(token, {kind: draft.kind, entryId: candidate.id});
			item.append(createElement("option", {
				text: `${getEntryName(candidate)} — ${maxQuantity} available${maxQuantity ? "" : " (cannot move)"}`,
				attrs: {value: token},
			}));
		}
		if (draft.entryId && !entry) {
			item.append(createElement("option", {text: "Selected stack unavailable — choose again", attrs: {value: "unavailable"}}));
		}
		item.value = draft.entryId
			? entry ? this._getItemToken({kind: draft.kind, entryId: draft.entryId}) : "unavailable"
			: "";
		item.addEventListener("change", () => {
			if (!this._canEditDraft(draft, active)) return;
			const selected = this._itemByToken.get(item.value);
			const next = selected?.kind === draft.kind ? this._getEntry(selected) : null;
			draft.entryId = next?.id || null;
			draft.entryFingerprint = next ? JSON.stringify(next.item) : null;
			draft.entryName = next ? getEntryName(next) : "Currency";
			draft.quantity = 1;
			draft.maxQuantity = 0;
			draft.blockers = [];
			this._rotateDraftCommands();
			this._render();
		});
		itemField.append(item);
		fields.append(itemField);

		const quantityField = createElement("label");
		quantityField.append(createElement("span", {text: "Quantity"}));
		const quantity = createElement("input", {
			className: "ve-form-control",
			attrs: {
				type: "number",
				inputmode: "numeric",
				min: 1,
				max: this._draft.maxQuantity,
				step: 1,
				value: this._draft.quantity,
				required: true,
				disabled: isProposalFrozen,
				"aria-describedby": "charsheet-party-inventory-confirmation",
				"data-party-inventory-focus": "quantity",
			},
		});
		quantity.addEventListener("input", () => {
			if (!this._canEditDraft(draft, active)) return;
			this._draft.quantity = quantity.value;
			this._rotateDraftCommands();
			this._syncComposerSummary(composer);
		});
		quantityField.append(quantity);
		fields.append(quantityField);

		if (this._draft.kind === "character") {
			const destinationField = createElement("label");
			destinationField.append(createElement("span", {text: "Destination"}));
			const destination = createElement("select", {
				className: "ve-form-control",
				attrs: {
					disabled: isProposalFrozen,
					"data-party-inventory-focus": "destination",
				},
			});
			destination.append(createElement("option", {text: "Party stash", attrs: {value: "party_inventory"}}));
			for (const [token, recipient] of this._recipientByToken) {
				const summary = recipient.summary ? ` — ${recipient.summary}` : "";
				destination.append(createElement("option", {
					text: `${recipient.label}${summary}`,
					attrs: {value: token},
				}));
			}
			let destinationToken = this._draft.destinationKind === "party_inventory"
				? "party_inventory"
				: [...this._recipientByToken].find(([, recipient]) => recipient.id === this._draft.recipientId)?.[0];
			if (!destinationToken && this._draft.destinationKind === "character") {
				destinationToken = "unavailable";
				destination.append(createElement("option", {
					text: this._draft.recipientId
						? "Original recipient — current campaign view unavailable"
						: "Choose a recipient",
					attrs: {value: destinationToken},
				}));
			}
			destination.value = destinationToken || "party_inventory";
			destination.addEventListener("change", () => {
				if (!this._canEditDraft(draft, active) || destination.value === "unavailable") return;
				const recipient = this._recipientByToken.get(destination.value);
				this._draft.destinationKind = recipient ? "character" : "party_inventory";
				this._draft.recipientId = recipient?.id || null;
				this._rotateDraftCommands();
				intent.value = this._getDraftIntent();
				this._render();
			});
			destinationField.append(destination);
			fields.append(destinationField);
		} else {
			const destination = createElement("div", {className: "charsheet__party-inventory-fixed-destination"});
			destination.append(
				createElement("span", {text: "Destination"}),
				createElement("strong", {text: "This character"}),
			);
			fields.append(destination);
		}
		const currencyFields = createElement("div", {className: "charsheet__party-inventory-fields charsheet__party-inventory-currency"});
		for (const type of CURRENCY_TYPES) {
			const available = Number(container.currency?.[type]) || 0;
			const label = createElement("label");
			label.append(createElement("span", {text: `${type.toUpperCase()} — ${formatNumber(available)} available`}));
			const input = createElement("input", {
				className: "ve-form-control",
				attrs: {
					type: "number",
					inputmode: "numeric",
					min: 0,
					max: available,
					step: 1,
					value: draft.currency?.[type] ?? 0,
					"aria-label": `${type.toUpperCase()} to ${this._getDraftIntent()}`,
					"aria-describedby": "charsheet-party-inventory-confirmation",
					"data-party-inventory-focus": `currency-${type}`,
				},
			});
			input.addEventListener("input", () => {
				if (!this._canEditDraft(draft, active)) return;
				(draft.currency ||= {})[type] = input.value;
				this._rotateDraftCommands();
				this._syncComposerSummary(composer);
			});
			label.append(input);
			currencyFields.append(label);
		}
		composer.append(title, fields, currencyFields);

		const summary = createElement("p", {
			className: "charsheet__party-inventory-confirmation",
			attrs: {id: "charsheet-party-inventory-confirmation"},
		});
		composer.append(summary);
		// Advisory only: this preview cannot infer a peer's unshared load or replace server
		// authority. Weight alone never disables the submit button.
		const carryDelta = createElement("p", {
			className: "charsheet__party-inventory-carry-delta",
			attrs: {id: "charsheet-party-inventory-carry-delta", role: "status", "aria-live": "polite"},
		});
		composer.append(carryDelta);
		if (this._draft.blockers?.length) {
			composer.append(createElement("p", {
				className: "charsheet__party-inventory-limit-note",
				text: getBlockerText({blockers: this._draft.blockers, maxQuantity: this._draft.maxQuantity}),
			}));
		}
		const actions = createElement("div", {className: "charsheet__party-inventory-composer-actions"});
		const isCancellationUncertain = this._draft.pendingResolution?.decision === "reject";
		const cancel = createElement("button", {
			className: "ve-btn ve-btn-default",
			text: pendingAcceptance
				? "Acceptance pending"
				: isStatusCheckRequired
					? "Status pending"
					: isProposalReplayExpired
						? "Refresh and close"
						: isCancellationUncertain
							? "Retry cancellation"
							: "Cancel",
			attrs: {
				type: "button",
				disabled: !!pendingAcceptance || isStatusCheckRequired || (isProposalFrozen && !isProposalReplayExpired),
				title: pendingAcceptance
					? "Retry or check the pending acceptance before cancelling."
					: isStatusCheckRequired
						? "Check the authoritative transfer status before cancelling."
						: null,
				"data-party-inventory-focus": "cancel",
			},
		});
		cancel.addEventListener("click", () => {
			if (this._draft === draft && this._isCurrent(active)) void this._pCancelDraft();
		});
		const submit = createElement("button", {
			className: "ve-btn ve-btn-primary",
			text: isReadOnlyRecovery
				? "Recover transfer status"
				: isAuthorityRefreshRequired
					? "Refresh required"
					: isCancellationUncertain
						? "Check transfer status"
						: pendingAcceptance
							? this._draft.needsStatusCheck ? "Check acceptance status" : "Retry acceptance"
							: isStatusCheckRequired
								? "Check transfer status"
								: isProposalReplayExpired
									? "Refresh latest balances"
									: this._isPlayerStashRequest()
										? "Send request"
										: this._shouldAutoResolve()
											? "Move now"
											: this._getDraftIntent() === "deposit" ? "Deposit" : "Pass",
			attrs: {type: "submit", "data-party-inventory-focus": "submit"},
		});
		actions.append(cancel, submit);
		composer.append(actions);
		composer.addEventListener("submit", event => {
			event.preventDefault();
			if (this._draft !== draft || !this._isCurrent(active)) return;
			void this._pSubmitDraft();
		});
		this._syncComposerSummary(composer);
		return composer;
	}

	/**
	 * Show what the proposed move does to this character's carried load, and to the stash.
	 *
	 * Only the acting character and the shared stash are described. A recipient's load is
	 * shown solely when that peer has chosen to share `carrySummary`; it is never derived
	 * from a difference, because ADR 0011 forbids hidden item truth being inferred from
	 * transfer previews or encumbrance warnings.
	 * @param {HTMLElement} composer
	 */
	_syncCarryDelta (composer) {
		const target = composer.querySelector(".charsheet__party-inventory-carry-delta");
		if (!target || !this._draft) return;
		const profile = this._fnGetCarryProfile?.();
		const entry = this._getEntry(this._draft);
		const quantity = Number(this._draft.quantity);
		// The MATERIAL-PROJECTED weight, not the stored one: a mithril breastplate does not
		// weigh what its steel base entry says, and the carry bar has always counted the
		// projected figure. Falls back to the raw value for the party stash, whose plain
		// documents have no sheet context to project through.
		// TWO weights, because two different systems own them. The acting sheet applies material
		// projection (a mithril breastplate does not weigh its steel entry), while the party
		// stash is a plain document whose authoritative summary sums the RAW stored weight.
		// Using one figure for both made the previewed stash total disagree with the number the
		// next refresh would show.
		const rawUnitWeight = entry ? Number(entry.item?.weight) : 0;
		const unitWeight = entry ? Number(this._fnProjectItemWeight?.(entry.item) ?? entry.item?.weight) : 0;

		const isMovedWeightKnown = Number.isFinite(unitWeight) && unitWeight >= 0;
		if (!Number.isSafeInteger(quantity) || quantity < 1) {
			target.textContent = profile
				? `You: currently ${formatWeight(profile.bodyLoad, profile.isIndeterminate)} lb of ${formatNumber(profile.bodyCapacity)} — enter a valid quantity to preview the move.`
				: "This character: current carried weight and capacity unavailable.";
			return;
		}

		const moved = isMovedWeightKnown ? unitWeight * quantity : null;
		const movedRaw = Number.isFinite(rawUnitWeight) && rawUnitWeight >= 0 ? rawUnitWeight * quantity : null;
		const coinWeight = getCoinWeight(this._draft.currency);
		const countedCoinWeight = profile?.isCoinWeightCounted ? coinWeight : 0;
		// Moving OUT of the stash adds to this character; moving out of this character removes.
		const direction = this._draft.kind === "party_inventory" ? 1 : -1;
		const signedDelta = direction * moved;
		// Apply the delta to GROSS and FILLABLE weight and let the contract re-derive the
		// split, rather than adding it straight onto `bodyLoad`. With an extradimensional
		// container equipped those are different numbers: 20 lb of stowable gear arriving into
		// a bag with spare capacity leaves the body load unchanged, so the naive sum claimed a
		// 20 lb increase the character would never feel — and, in the other direction, hid the
		// moment the bag fills and the overflow starts landing on the body.
		//
		// A partial transfer can leave a linked/equipped source copy behind. Its departing
		// weight must come from the source's current body/bag split, not a guessed spare copy.
		const isFillable = !(this._draft.kind === "character" && entry?.equipped)
			&& !entry?.item?.containerCapacity?.weightless;
		const after = moved == null || !profile ? null : getCarryProfile({
			capacityOverride: profile.bodyCapacity,
			externalCapacity: profile.externalCapacity,
			grossWeight: Math.max(0, profile.grossWeight + signedDelta + direction * countedCoinWeight),
			fillableWeight: Math.max(0, profile.fillableWeight + (isFillable ? signedDelta : 0)),
			thresholdRuleId: profile.thresholdRuleId,
			thresholdSourceValue: profile.thresholdSourceValue,
			unknownStackCount: profile.unknownStackCount,
		});
		const beforeLevel = profile ? getCarryStatus(profile).level : null;
		const afterLevel = after ? getCarryStatus(after).level : null;
		const label = level => ({
			over_capacity: "Over capacity",
			heavily_encumbered: "Heavily encumbered",
			encumbered: "Encumbered",
			unknown: "Unknown",
			normal: "Normal",
		}[level] || level);

		// Each side is marked from ITS OWN profile: the before and after states are separately
		// derived and need not share indeterminacy. The status itself is never softened — a
		// known lower bound that already exceeds capacity is genuinely over capacity, and
		// downgrading that truthful verdict would trade one inaccuracy for another.
		// Each line is rendered with its own truthfulness rather than suppressing the whole
		// message: an unweighed stack makes the ACTOR's consequence unknowable, but the stash's
		// own totals remain perfectly reportable, and its uncertainty can even DECREASE if that
		// unweighed stack is what leaves.
		const parts = [];
		if (after) {
			parts.push(`You: ${formatWeight(profile.bodyLoad, profile.isIndeterminate)} → ${formatWeight(after.bodyLoad, after.isIndeterminate)} lb of ${formatNumber(profile.bodyCapacity)}`);
			parts.push(beforeLevel === afterLevel ? label(afterLevel) : `${label(beforeLevel)} → ${label(afterLevel)}`);
		} else if (profile) {
			parts.push(`You: currently ${formatWeight(profile.bodyLoad, profile.isIndeterminate)} lb of ${formatNumber(profile.bodyCapacity)} — impact unknown (this stack has no recorded weight)`);
		} else parts.push("This character: current carried weight and capacity unavailable");
		if (coinWeight > 0) {
			parts.push(`Coins: ${formatNumber(coinWeight)} lb${profile
				? profile.isCoinWeightCounted ? " counted in your carry" : " not counted by your current carry rules"
				: " — carry impact unavailable"}`);
		}

		// The recipient's consequence.
		//
		// Their CURRENT carry is shown when they share it, but never an after-value: this sheet
		// holds nothing target-authoritative. The projected weight is this character's material
		// projection, the recipient may have their own extradimensional container absorbing the
		// arrival entirely, and their tier rule is not knowable from two numbers. Adding the
		// delta produced confident fabrications — a target whose body load genuinely stays at 10
		// was warned as "10 → 30, over capacity". A truthful current reading plus an explicit
		// "impact not shown" is worth more than a precise-looking guess, and the alternative
		// would also mean inferring hidden truth about another character.
		if (this._draft.kind === "character" && this._draft.destinationKind === "character") {
			const recipient = this._recipients.find(it => it.id === this._draft.recipientId);
			if (recipient?.carry) {
				parts.push(`${recipient.label}: currently ${formatWeight(recipient.carry.carried, recipient.carry.isIndeterminate)} lb of ${formatNumber(recipient.carry.capacity)} — impact not shown (their carry is calculated on their own sheet)`);
			} else if (recipient) {
				// Explicit, and deliberately uninformative: "not shared" must not be inferable
				// as any particular load, and silence would read as "no effect".
				parts.push(`${recipient.label}: carry not shared`);
			}
		}

		// Stash arithmetic uses the RAW stored weight, matching `getInventoryWeightSummary`,
		// which is what the authoritative stash refresh will report a moment later.
		const stash = getInventoryWeightSummary(this._partyInventory?.inventory || []);
		if (this._draft.kind === "party_inventory" || this._draft.destinationKind === "party_inventory") {
			const isFromStash = this._draft.kind === "party_inventory";
			// An unweighed stack contributes nothing to the KNOWN total, so moving one leaves
			// that number untouched — but it does move the uncertainty, and the whole-stack case
			// can make the stash exact again when the last unweighed stack departs.
			const isWholeStack = quantity >= (Number(entry?.quantity) || 0);
			const stashAfterKnown = movedRaw == null
				? stash.knownWeight
				: Math.max(0, isFromStash ? stash.knownWeight - movedRaw : stash.knownWeight + movedRaw);
			let unknownAfter = stash.unknownStackCount;
			if (movedRaw == null) {
				if (isFromStash) unknownAfter = isWholeStack ? Math.max(0, unknownAfter - 1) : unknownAfter;
				else unknownAfter += 1;
			}
			parts.push(`Stash: ${formatWeight(stash.knownWeight, stash.unknownStackCount > 0)} → ${formatWeight(stashAfterKnown, unknownAfter > 0)} lb`);
		}
		if (this._draft.transfer || this._draft.proposalRequest) {
			target.textContent = `${[
				profile ? `You: currently ${formatWeight(profile.bodyLoad, profile.isIndeterminate)} lb of ${formatNumber(profile.bodyCapacity)}` : null,
				...parts.filter(part => !part.includes(" → ") && !part.startsWith("You:")),
				"Move impact is not previewed again while a sent transfer is being recovered",
			].filter(Boolean).join(" · ")}.`;
		} else target.textContent = `${parts.join(" · ")}.`;
		target.classList.toggle("charsheet__party-inventory-carry-delta--warn", afterLevel === "over_capacity" && beforeLevel !== "over_capacity");
	}

	_syncComposerSummary (composer) {
		if (!this._draft) return;
		const draft = this._draft;
		const entry = this._getEntry(this._draft);
		const isSent = !!draft.transfer || !!draft.proposalRequest;
		const entryName = !isSent && entry ? getEntryName(entry) : this._draft.entryName;
		const quantity = Number(this._draft.quantity);
		const validation = this._getDraftValidation();
		const recipient = this._recipients.find(it => it.id === this._draft.recipientId);
		const destination = this._draft.kind === "party_inventory"
			? "this character"
			: this._draft.destinationKind === "party_inventory"
				? "the party stash"
				: recipient?.label || "the original recipient";
		this._syncCarryDelta(composer);
		const summary = composer.querySelector(".charsheet__party-inventory-confirmation");
		const approvalText = this._getApprovalText();
		const contents = [
			draft.entryId ? `${quantity} × ${entryName}` : null,
			...CURRENCY_TYPES.filter(type => Number(draft.currency?.[type]) > 0)
				.map(type => `${formatNumber(Number(draft.currency[type]))} ${type.toUpperCase()}`),
		].filter(Boolean).join(" + ");
		summary.textContent = draft.transfer
			? `${getInventoryTransferStatusMessage({
				status: draft.transfer.status,
				sourceKind: draft.kind,
				targetKind: draft.destinationKind,
			})}${draft.needsStatusCheck ? " Check the latest status and balances before another decision." : ""}`
			: draft.proposalRequest
				? `Destination: ${destination}. This exact transfer was sent; its outcome is not confirmed. Retry the same command or refresh its status, not a new transfer.`
				: validation.error || `${contents} will move from ${draft.kind === "party_inventory" ? "the party stash" : "this character"} to ${destination}.${approvalText ? ` ${approvalText}` : " This move applies immediately under your current authority."}`;
		const submit = composer.querySelector("button[type='submit']");
		const isDraftEditable = this._isDraftEditable();
		const isProposalFrozen = !!this._draft.proposalRequest && !this._draft.transfer;
		const isProposalReplayExpired = isProposalFrozen && Date.now() >= this._draft.proposalReplayUntil;
		const isAuthorityRefreshRequired = this._needsAuthoritativeRefresh;
		const pendingAcceptance = this._getPendingAcceptance();
		const isStatusCheckRequired = !!this._draft.transfer
			&& !!this._draft.needsStatusCheck
			&& !this._draft.pendingResolution
			&& !pendingAcceptance;
		if (!isSent && !validation.error && !isAuthorityRefreshRequired && !this._isAuthorityPending) {
			submit.textContent = this._isPlayerStashRequest() ? "Send request"
				: this._shouldAutoResolve() ? "Move now"
					: this._getDraftIntent() === "deposit" ? "Deposit" : "Pass";
		}
		submit.disabled = this._isSubmitting
			|| (!isSent && !!validation.error)
			|| isAuthorityRefreshRequired
			|| this._isAuthorityPending
			|| (!isSent && ["reconnecting", "unavailable"].includes(this._connectionState))
			|| (!this._hasTransferAuthority() && !(isProposalFrozen || isStatusCheckRequired || !!pendingAcceptance || !!this._draft.pendingResolution))
			|| (
				isDraftEditable
				&& this._draft.kind === "character"
				&& this._draft.destinationKind === "character"
				&& !recipient
			);
		for (const control of composer.querySelectorAll("input, select, button")) {
			if (control === submit) continue;
			const isCancel = control.dataset.partyInventoryFocus === "cancel";
			control.disabled = this._isSubmitting
				|| (isCancel
					? (isProposalFrozen && !isProposalReplayExpired) || !!pendingAcceptance || isStatusCheckRequired
					: !this._canEditDraft(draft, this._active)
						|| (control.dataset.partyInventoryFocus === "quantity" && !draft.entryId));
		}
	}

	_willRequireApproval () {
		return !this._shouldAutoResolve();
	}

	_isPlayerStashRequest () {
		return this._draft?.kind === "party_inventory" && this._role === "player";
	}

	_shouldAutoResolve () {
		if (!this._draft) return false;
		if (this._draft.proposalRequest?.isAutoResolved != null) return this._draft.proposalRequest.isAutoResolved;
		if (DM_ROLES.has(this._role)) return true;
		if (this._draft.kind === "party_inventory" || this._draft.destinationKind === "party_inventory") return false;
		return this._recipients.some(recipient => recipient.id === this._draft.recipientId && recipient.isOwned);
	}

	_getApprovalText () {
		if (!this._willRequireApproval()) return "";
		if (this._draft.kind === "party_inventory") return "A DM must approve before anything leaves the stash. Cancellation or rejection leaves the stash unchanged.";
		if (this._draft.destinationKind === "party_inventory") return "A DM must accept before it arrives. Items and currency are reserved now; cancellation or rejection restores them to this character.";
		return "The recipient must accept before it arrives. Items and currency are reserved now; cancellation or rejection restores them to this character.";
	}

	_closeDraft () {
		const returnToken = this._draft?.returnToken;
		const returnFocusKey = this._draft?.kind === "party_inventory" ? "stash-currency" : "share";
		this._draft = null;
		this._error = this._needsAuthoritativeRefresh ? TRANSFER_REFRESH_REQUIRED_MESSAGE : null;
		this._render();
		if (this._root) this._decorateCharacterInventory();
		if (typeof document === "undefined") return;
		const returnButton = (returnToken
			? document.querySelector(`.charsheet__item-party-move[data-token="${CSS.escape(returnToken)}"]`)
				|| this._root?.querySelector(`[data-party-inventory-focus="stash-${CSS.escape(returnToken)}"]`)
			: this._root?.querySelector(`[data-party-inventory-focus="${returnFocusKey}"]`))
			|| this._root?.querySelector(`[data-party-inventory-focus="refresh"]`);
		returnButton?.focus({preventScroll: true});
	}

	_getCancellationMessage (draft) {
		if (!["rejected", "cancelled"].includes(draft.transfer?.status)) {
			return getInventoryTransferStatusMessage({
				status: draft.transfer.status,
				sourceKind: draft.kind,
				targetKind: draft.destinationKind,
			});
		}
		return draft.kind === "party_inventory"
			? "Request cancelled. The party stash was unchanged."
			: "Transfer cancelled. The reserved items and currency were restored.";
	}

	async _pCancelDraft () {
		if (this._isSubmitting || !this._draft || !this._isCurrent()) return false;
		const active = this._active;
		const draft = this._draft;
		const visibilityEpoch = this._projectionVisibilityEpoch;
		if (draft.transfer && ["committed", "rejected", "cancelled", "expired"].includes(draft.transfer.status)) {
			draft.needsStatusCheck = true;
			return this._pSubmitDraft();
		}
		if (this._isAuthorityPending && (draft.transfer || draft.proposalRequest)) return false;
		if (!draft.transfer) {
			if (draft.proposalRequest) {
				if (Date.now() >= draft.proposalReplayUntil) {
					this._isSubmitting = true;
					this._error = null;
					this._render();
					try {
						const transfers = await this._api.pListTransfers({campaignId: this._campaignId});
						if (!this._isCurrent(active) || this._draft !== draft) return false;
						const exactTransfer = transfers.find(transfer => transfer.actorCommandId === draft.proposalRequest.idempotencyKey);
						const legacyMatches = exactTransfer
							? []
							: transfers.filter(transfer => !transfer.actorCommandId
								&& ["proposed", "reserved"].includes(transfer.status)
								&& isProjectedTransferMatch({transfer, request: draft.proposalRequest}));
						this._refreshFlags.character = true;
						this._refreshFlags.party = true;
						if (!await this._pDrainRefresh()) {
							this._error = "The transfer retry expired, and the latest transfer state or inventories could not be loaded. Reconnect and try the refresh again.";
							this._render();
							return false;
						}
						if (!this._isCurrent(active) || this._draft !== draft) return false;
						if (!exactTransfer && legacyMatches.length > 1) {
							this._error = "Multiple matching pending transfers were found. This request remains locked to prevent a duplicate; resolve the pending transfers in Campaign Hub.";
							this._announce(this._error);
							this._render();
							return false;
						}
						const matchedTransfer = exactTransfer || legacyMatches[0];
						if (matchedTransfer && ["proposed", "reserved"].includes(matchedTransfer.status)) {
							draft.transfer = matchedTransfer;
							draft.needsStatusCheck = false;
							this._error = "The transfer was found and is still pending. Cancel it explicitly to withdraw it, or leave it for approval.";
							this._announce(this._error);
							this._render();
							return false;
						}
						this._isSubmitting = false;
						this._closeDraft();
						const message = matchedTransfer
							? getInventoryTransferStatusMessage({
								status: matchedTransfer.status,
								sourceKind: draft.kind,
								targetKind: draft.destinationKind,
								isRefreshed: true,
							})
							: "No matching transfer was found. Latest source and stash balances loaded; inspect the destination before starting another transfer.";
						this._fnToast?.({type: matchedTransfer?.status === "committed" ? "success" : "info", content: message});
						this._announce(message);
						return true;
					} finally {
						if (this._draft === draft) {
							this._isSubmitting = false;
							this._render();
						}
					}
				}
				this._error = "The transfer outcome is not yet confirmed. Retry the transfer before closing it.";
				this._render();
				return false;
			}
			this._closeDraft();
			return true;
		}
		const pendingAcceptance = this._getPendingAcceptance(draft);
		if (pendingAcceptance) {
			draft.needsStatusCheck = true;
			this._error = "The acceptance outcome is not yet confirmed. Retry acceptance or check its status before cancelling.";
			this._render();
			return false;
		}
		if (draft.needsStatusCheck && !draft.pendingResolution) {
			this._error = "The cancellation result must be reconciled before another cancellation can be sent. Check the transfer status first.";
			this._render();
			return false;
		}

		this._isSubmitting = true;
		this._error = null;
		this._render();
		let isResolutionKnown = false;
		try {
			if (!draft.pendingResolution) {
				draft.pendingResolution = {
					campaignId: this._campaignId,
					transferId: draft.transfer.id,
					decision: "reject",
					idempotencyKey: draft.cancellationCommandId,
					replayUntil: Date.now() + HUB_TRANSFER_REPLAY_WINDOW_MS,
				};
			}
			if (Date.now() >= draft.pendingResolution.replayUntil) {
				draft.needsStatusCheck = true;
				this._error = "This cancellation retry is too old to replay safely. Check the transfer status before acting again.";
				return false;
			}
			try {
				const resolved = await this._api.pResolveTransfer(draft.pendingResolution);
				if (!this._isCurrent(active) || this._draft !== draft) return false;
				isResolutionKnown = true;
				draft.transfer = resolved?.transfer || {...draft.transfer, status: "rejected"};
				draft.pendingResolution = null;
			} catch (error) {
				if (!isTransferOutcomeUncertain(error)) draft.pendingResolution = null;
				throw error;
			}
			if (!await this._pRefreshAfterTransfer({active, visibilityEpoch})) {
				throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			const message = this._getCancellationMessage(draft);
			this._isSubmitting = false;
			this._closeDraft();
			this._fnToast?.({type: "success", content: message});
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			draft.needsStatusCheck = true;
			this._error = isResolutionKnown
				? `${this._getCancellationMessage(draft)} ${TRANSFER_REFRESH_REQUIRED_MESSAGE}`
				: draft.pendingResolution
					? "Cancellation outcome is not confirmed. Retry the same cancellation or check transfer status before acting again."
					: getErrorMessage(error);
			this._render();
			return false;
		} finally {
			if (this._draft === draft) {
				this._isSubmitting = false;
				this._render();
			}
		}
	}

	async _pSubmitDraft () {
		if (this._isSubmitting || !this._draft || !this._isCurrent()) return false;
		const active = this._active;
		const draft = this._draft;
		const visibilityEpoch = this._projectionVisibilityEpoch;
		if (this._isAuthorityPending) {
			this._error = "Campaign authority is being rechecked. Wait for the current campaign view before sending.";
			this._render();
			return false;
		}
		if (!draft.transfer && !draft.proposalRequest && ["reconnecting", "unavailable"].includes(this._connectionState)) {
			this._error = "Reconnect before sending a transfer. This draft has not been sent.";
			this._render();
			return false;
		}
		if (!this._hasTransferAuthority() && draft.transfer && !draft.needsStatusCheck && !draft.pendingResolution && !this._getPendingAcceptance(draft)) {
			draft.needsStatusCheck = true;
		}
		const isReadOnlyRecovery = !this._hasTransferAuthority()
			&& (!!draft.proposalRequest || !!draft.needsStatusCheck || !!draft.pendingResolution || !!this._getPendingAcceptance(draft));
		if (!this._hasTransferAuthority() && !isReadOnlyRecovery) {
			this._error = "Party transfers are read-only for your current campaign role.";
			this._render();
			return false;
		}
		if (this._needsAuthoritativeRefresh) {
			this._error = TRANSFER_REFRESH_REQUIRED_MESSAGE;
			this._render();
			return false;
		}
		if (this._needsFreshProposalRules) {
			this._needsAuthoritativeRefresh = true;
			this._error = TRANSFER_REFRESH_REQUIRED_MESSAGE;
			this._render();
			return false;
		}
		const isPartyEndpoint = draft.kind === "party_inventory" || draft.destinationKind === "party_inventory";
		if (!draft.transfer && draft.proposalRequest && Date.now() >= draft.proposalReplayUntil) {
			return this._pCancelDraft();
		}
		if (draft.pendingResolution?.decision === "reject" && !draft.needsStatusCheck) {
			this._error = "The cancellation outcome is not yet confirmed. Retry cancellation or check its status again later.";
			this._render();
			return false;
		}
		if (isPartyEndpoint && !this._partyInventory?.id) {
			this._error = "The party stash is unavailable. Retry the stash refresh before transferring this item.";
			this._render();
			return false;
		}
		if (!draft.transfer && !draft.proposalRequest) {
			const validation = this._getDraftValidation(draft);
			if (validation.error) {
				this._error = validation.error;
				this._render();
				return false;
			}
			if (
				draft.kind === "character"
				&& draft.destinationKind === "character"
				&& !this._recipients.some(recipient => recipient.id === draft.recipientId)
			) {
				this._error = "That recipient is no longer available. Choose another destination.";
				this._render();
				return false;
			}
		}

		this._isSubmitting = true;
		this._error = null;
		this._render();
		try {
			if (draft.transfer && draft.needsStatusCheck) {
				const transfers = await this._api.pListTransfers({campaignId: this._campaignId});
				if (!this._isCurrent(active) || this._draft !== draft) return false;
				const transfer = transfers.find(it => it.id === draft.transfer.id);
				if (!transfer) throw Object.assign(new Error("Transfer was not found"), {code: "TRANSFER_NOT_FOUND"});
				draft.transfer = transfer;
				draft.needsStatusCheck = false;
				const isPending = ["proposed", "reserved"].includes(transfer.status);
				const acceptanceRequest = this._transferResolutionDrafts.get({
					campaignId: this._campaignId,
					transferId: transfer.id,
				});
				const isAcceptanceExpired = acceptanceRequest && !this._transferResolutionDrafts.isReplayable(acceptanceRequest);
				this._transferResolutionDrafts.reconcilePending({
					campaignId: this._campaignId,
					pendingTransferIds: isPending ? [transfer.id] : [],
				});
				if (!isPending) {
					const message = getInventoryTransferStatusMessage({
						status: transfer.status,
						sourceKind: draft.kind,
						targetKind: draft.destinationKind,
						isRefreshed: true,
					});
					if (!await this._pRefreshAfterTransfer({active, visibilityEpoch})) {
						throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
					}
					if (!this._isCurrent(active) || this._draft !== draft) return false;
					this._isSubmitting = false;
					this._closeDraft();
					this._fnToast?.({type: transfer.status === "committed" ? "success" : "info", content: message});
					this._announce(message);
					return true;
				}
				if (
					draft.proposalRequest?.isAutoResolved
					&& (draft.needsFreshAcceptance || isAcceptanceExpired)
				) {
					const latestContext = await this._api.pGetCampaignContext({campaignId: this._campaignId});
					if (!this._isCurrent(active) || this._draft !== draft) return false;
					draft.acceptanceRulesVersionId = latestContext?.rulesVersion?.id || null;
					draft.resolutionCommandId = getOpaqueToken();
					draft.needsFreshAcceptance = false;
				}
				if (draft.pendingResolution?.decision === "reject") {
					if (Date.now() >= draft.pendingResolution.replayUntil) {
						draft.cancellationCommandId = getOpaqueToken();
						draft.pendingResolution = {
							campaignId: this._campaignId,
							transferId: draft.transfer.id,
							decision: "reject",
							idempotencyKey: draft.cancellationCommandId,
							replayUntil: Date.now() + HUB_TRANSFER_REPLAY_WINDOW_MS,
						};
					}
					this._error = "The cancellation outcome is not yet confirmed. Retry cancellation; acceptance remains unavailable.";
					this._isSubmitting = false;
					this._render();
					return false;
				}
				if (this._isAuthorityPending) await this._pAwaitAcknowledgedTransferAuthority({active, draft, visibilityEpoch});
				if (!this._isCurrent(active) || this._draft !== draft) return false;
				if (this._isAuthorityPending) {
					this._deferAcknowledgedAuthorityDraft(draft);
					return false;
				}
				if (!this._hasTransferAuthority() && !acceptanceRequest) {
					this._error = "Your campaign role is read-only. The transfer is still pending, so no new decision was sent.";
					this._isSubmitting = false;
					this._render();
					return false;
				}
			}
			if (draft.kind === "character" && !draft.transfer && !draft.proposalRequest) {
				const isSaved = await this._fnSaveCharacter?.();
				if (!isSaved) throw Object.assign(new Error("Save failed"), {code: "CHARACTER_BUSY"});
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (!draft.transfer && !draft.proposalRequest) {
				const validation = this._getDraftValidation(draft);
				if (!this._hasTransferAuthority() || validation.error
					|| (draft.destinationKind === "character" && draft.kind === "character"
						&& !this._recipients.some(recipient => recipient.id === draft.recipientId))) {
					this._error = validation.error || "The transfer authority or recipient changed while saving. Review the current destination before sending.";
					return false;
				}
			}
			if (!draft.transfer) {
				const isProposalReplay = !!draft.proposalRequest;
				const isAutoResolve = this._shouldAutoResolve();
				const isRulesPinnedProposal = isAutoResolve && draft.destinationKind === "character";
				if (!draft.proposalRequest) {
					if (["reconnecting", "unavailable"].includes(this._connectionState)) {
						this._error = "Reconnect before sending a transfer. This draft has not been sent.";
						return false;
					}
					const rulesVersionId = isRulesPinnedProposal
						? this._freshProposalRulesVersionId !== undefined
							? this._freshProposalRulesVersionId
							: this._fnGetRulesVersionId()
						: undefined;
					if (isRulesPinnedProposal) this._freshProposalRulesVersionId = undefined;
					const targetId = getPartyInventoryTransferTargetId({
						sourceKind: draft.kind,
						destinationKind: draft.destinationKind,
						activeCharacterId: active.characterId,
						recipientId: draft.recipientId,
						partyInventoryId: this._partyInventory?.id,
					});
					draft.proposalRequest = {
						campaignId: this._campaignId,
						sourceKind: draft.kind,
						sourceId: draft.kind === "character" ? active.characterId : this._partyInventory.id,
						targetKind: draft.destinationKind,
						targetId,
						payload: {
							items: draft.entryId ? [{entryId: draft.entryId, quantity: Number(draft.quantity)}] : [],
							currency: Object.fromEntries(Object.entries(this._getDraftValidation(draft).currency)
								.filter(([, amount]) => amount > 0)),
						},
						...(rulesVersionId === undefined ? {} : {rulesVersionId}),
						idempotencyKey: draft.commandId,
						isAutoResolved: isAutoResolve,
					};
					draft.proposalReplayUntil = Date.now() + HUB_TRANSFER_REPLAY_WINDOW_MS;
				}
				let result;
				try {
					result = await this._api.pProposeTransfer(draft.proposalRequest);
				} catch (error) {
					if (!isTransferOutcomeUncertain(error)) {
						draft.proposalRequest = null;
						draft.proposalReplayUntil = null;
						this._needsAuthoritativeRefresh = true;
						if (error?.code === "RULES_VERSION_STALE") {
							this._needsFreshProposalRules = true;
							this._freshProposalRulesVersionId = undefined;
							draft.commandId = getOpaqueToken();
							draft.resolutionCommandId = getOpaqueToken();
							draft.cancellationCommandId = getOpaqueToken();
						}
						this._refreshFlags.character = true;
						this._refreshFlags.party = true;
						let isRefreshed = await this._pDrainRefresh();
						if (isRefreshed && this._needsFreshProposalRules) isRefreshed = await this._pRefreshProposalRules(active);
						if (!this._isCurrent(active) || this._draft !== draft) return false;
						if (!isRefreshed) {
							this._error ||= `${getErrorMessage(error)} ${TRANSFER_REFRESH_REQUIRED_MESSAGE}`;
							this._render();
							return false;
						}
						this._needsAuthoritativeRefresh = false;
						this._refreshDraftTransferLimit(draft);
					}
					throw error;
				}
				draft.transfer = result.transfer;
				if (isProposalReplay) {
					const transfers = await this._api.pListTransfers({campaignId: this._campaignId});
					if (!this._isCurrent(active) || this._draft !== draft) return false;
					const currentTransfer = transfers.find(it => it.id === draft.transfer.id);
					if (!currentTransfer) throw Object.assign(new Error("Transfer was not found"), {code: "TRANSFER_NOT_FOUND"});
					draft.transfer = currentTransfer;
				}
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (this._isAuthorityPending) await this._pAwaitAcknowledgedTransferAuthority({active, draft, visibilityEpoch});
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (this._isAuthorityPending) {
				this._deferAcknowledgedAuthorityDraft(draft);
				return false;
			}
			if (
				!this._hasTransferAuthority()
				&& ["proposed", "reserved"].includes(draft.transfer.status)
				&& !this._getPendingAcceptance(draft)
			) {
				draft.needsStatusCheck = true;
				this._error = "Your campaign role is read-only. The transfer is still pending, so no new decision was sent.";
				this._isSubmitting = false;
				this._render();
				return false;
			}
			if (draft.proposalRequest?.isAutoResolved && ["proposed", "reserved"].includes(draft.transfer.status)) {
				let resolved;
				try {
					resolved = await pResolveTransferFromDraft({
						drafts: this._transferResolutionDrafts,
						campaignId: this._campaignId,
						transferId: draft.transfer.id,
						idempotencyKey: draft.resolutionCommandId,
						pGetRulesVersionId: async () => draft.acceptanceRulesVersionId !== undefined
							? draft.acceptanceRulesVersionId
							: draft.proposalRequest?.rulesVersionId ?? null,
						pResolve: request => this._api.pResolveTransfer(request),
					});
				} catch (error) {
					if (error?.code === "RULES_VERSION_STALE") draft.needsFreshAcceptance = true;
					throw error;
				}
				draft.transfer = resolved.transfer;
			}

			if (!await this._pRefreshAfterTransfer({active, visibilityEpoch})) {
				throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (this._isAuthorityPending) {
				this._deferAcknowledgedAuthorityDraft(draft);
				return false;
			}
			if (draft.awaitingAuthorityRefresh && draft.needsStatusCheck) {
				this._error = "Transfer acknowledged, but its latest status could not be verified. Refresh before another decision.";
				return false;
			}
			const message = getInventoryTransferStatusMessage({
				status: draft.transfer.status,
				sourceKind: draft.kind,
				targetKind: draft.destinationKind,
				isRefreshed: true,
			});
			this._isSubmitting = false;
			this._closeDraft();
			this._fnToast?.({type: draft.transfer.status === "committed" ? "success" : "info", content: message});
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (draft.transfer) draft.needsStatusCheck = true;
			this._error = ["committed", "rejected", "cancelled", "expired"].includes(draft.transfer?.status)
				? `${getInventoryTransferStatusMessage({
					status: draft.transfer.status,
					sourceKind: draft.kind,
					targetKind: draft.destinationKind,
				})} ${TRANSFER_REFRESH_REQUIRED_MESSAGE}`
				: draft.proposalRequest && !draft.transfer && isTransferOutcomeUncertain(error)
					? "Transfer outcome is not yet confirmed. Retry this exact transfer to recover its status; do not start a new transfer."
					: getErrorMessage(error);
			this._render();
			return false;
		} finally {
			if (this._draft === draft) {
				this._isSubmitting = false;
				this._render();
			}
		}
	}

	_announce (message) {
		this._announcement = message;
		const live = this._root?.querySelector("[data-party-inventory-live]");
		if (live) live.textContent = message;
	}

	_captureFocus () {
		const active = document.activeElement;
		if (!this._root?.contains(active)) return null;
		if (active === this._root) return {isRoot: true};
		const key = active.dataset?.partyInventoryFocus;
		if (!key) return null;
		return {
			key,
			selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
			selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
		};
	}

	_restoreFocus (focus) {
		if (!focus) return;
		const next = focus.key
			? this._root?.querySelector(`[data-party-inventory-focus="${CSS.escape(focus.key)}"]`)
			: null;
		const target = next && !next.disabled
			? next
			: this._root?.querySelector(`[data-party-inventory-focus="composer"]`) || this._root;
		if (!target) return;
		target.focus({preventScroll: true});
		if (target === next && focus.selectionStart != null && typeof next.setSelectionRange === "function") {
			next.setSelectionRange(focus.selectionStart, focus.selectionEnd);
		}
	}
}

globalThis.CharacterSheetPartyInventory = CharacterSheetPartyInventory;
