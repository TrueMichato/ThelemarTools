import {
	getProjectionId,
	getProjectionView,
	getTargetableProjections,
} from "../hub/hub-character-view.js";
import {getCarryProfile, getCarryStatus} from "../hub/hub-carry-contract.js";
import {
	getInventoryStackWeight,
	getInventoryTransferEligibility,
	getInventoryWeightSummary,
} from "../hub/hub-inventory-contract.js";
import {
	HUB_TRANSFER_REPLAY_WINDOW_MS,
	HubTransferResolutionDrafts,
	isTransferOutcomeUncertain,
	pResolveTransferFromDraft,
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
				else this._scheduleRefresh({party: true});
			}),
			this._realtime.on("membershipChanged", () => {
				if (this._active?.isActivationPending) void this._pActivate(this._active);
				else this._scheduleRefresh({party: true});
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
		return this._role === "player" || DM_ROLES.has(this._role);
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
					text: "Share",
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

	_beginDraft ({kind, entryId, returnToken = null}) {
		if (this._needsAuthoritativeRefresh) {
			this._error = TRANSFER_REFRESH_REQUIRED_MESSAGE;
			this._render();
			return false;
		}
		if (!this._hasTransferAuthority() || this._isSubmitting || this._draft) return false;
		const entry = this._getEntry({kind, entryId});
		if (!entry) return false;
		const container = this._getContainer(kind);
		const {maxQuantity, blockers} = getTransferLimit({container, entry});
		if (!maxQuantity) {
			this._error = getBlockerText({blockers, maxQuantity});
			this._render();
			return false;
		}
		this._draft = {
			kind,
			entryId,
			quantity: 1,
			maxQuantity,
			blockers,
			entryName: getEntryName(entry),
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
		this._announcement = "";
		this._render();
		if (this._root) this._decorateCharacterInventory();
		return true;
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
			party: event.isPartyInventoryAffected === true,
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

	_scheduleRefresh ({character = false, party = false} = {}) {
		if (!this._active?.isOwner) return;
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
			while (
				this._isCurrent(active)
				&& (this._refreshFlags.character || this._refreshFlags.party)
			) {
				const flags = this._refreshFlags;
				this._refreshFlags = {character: false, party: false};
				const tasks = [];
				if (flags.character) {
					tasks.push(this._pReconcileCharacter(active)
						.then(result => ["reconciled", "stale", "unchanged"].includes(result?.status))
						.catch(() => false));
				}
				if (flags.party) tasks.push(this._pRefreshParty(active).catch(() => false));
				if ((await Promise.all(tasks)).some(result => !result)) isSuccessful = false;
			}
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

	async _pRefreshParty (active = this._active) {
		if (!this._isCurrent(active) || !active?.isOwner) return false;
		const fetchToken = Symbol("party-inventory-fetch");
		this._partyFetchToken = fetchToken;
		this._isLoading = true;
		this._render();
		const [partyResult, snapshotResult] = await Promise.allSettled([
			this._api.pGetPartyInventory({campaignId: this._campaignId}),
			this._api.pGetCampaignSnapshot({campaignId: this._campaignId}),
		]);
		if (!this._isCurrent(active) || this._partyFetchToken !== fetchToken) return false;
		const accessError = [partyResult, snapshotResult]
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
		this._partyError = partyResult.status === "rejected"
			? getErrorMessage(partyResult.reason)
			: snapshotResult.status === "rejected"
				? getErrorMessage(snapshotResult.reason)
				: null;
		this._isLoading = false;
		this._render();
		this._decorateCharacterInventory();
		return partyResult.status === "fulfilled" && snapshotResult.status === "fulfilled";
	}

	_pManualRefresh ({errorSource = null} = {}) {
		if (this._manualRefreshPromise) return this._manualRefreshPromise;
		const active = this._active;
		if (!this._isCurrent(active) || !active?.isOwner) return Promise.resolve(false);
		this._manualRefreshPromise = (async () => {
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
			this._refreshNotice = isSuccessful ? "Party stash refreshed." : "";
			if (isSuccessful) this._announce(this._refreshNotice);
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
				this._freshProposalRulesVersionId = this._fnGetRulesVersionId() ?? null;
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
		if (this._reconcileError !== previousError) this._render();
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
		if (!this._root || !this._active?.isOwner) return;
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

		if (this._draft) this._root.append(this._renderComposer());
		this._root.append(createElement("div", {
			className: "sr-only",
			text: this._announcement,
			attrs: {"aria-live": "polite", "aria-atomic": "true", "data-party-inventory-live": ""},
		}));
		this._restoreFocus(focus);
	}

	_renderHeader () {
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
		button.addEventListener("click", () => this._beginDraft({kind: "party_inventory", entryId: entry.id, returnToken: token}));
		row.append(button);
		const blockerText = getBlockerText({blockers, maxQuantity});
		if (blockerText) row.append(createElement("span", {className: "charsheet__party-inventory-row-note", text: blockerText}));
		return row;
	}

	_renderEmpty (message) {
		return createElement("p", {className: "charsheet__party-inventory-empty", text: message});
	}

	_isDraftEditable (draft = this._draft) {
		return !!draft && !draft.transfer && !draft.proposalRequest && !this._needsAuthoritativeRefresh;
	}

	_refreshDraftTransferLimit (draft = this._draft) {
		if (!draft || draft.transfer || draft.proposalRequest) return;
		const {maxQuantity, blockers} = getTransferLimit({
			container: this._getContainer(draft.kind),
			entry: this._getEntry(draft),
		});
		draft.maxQuantity = maxQuantity;
		draft.blockers = blockers;
		if (maxQuantity > 0 && draft.quantity > maxQuantity) draft.quantity = maxQuantity;
	}

	_getPendingAcceptance (draft = this._draft) {
		if (!draft?.transfer) return null;
		return this._transferResolutionDrafts.get({
			campaignId: this._campaignId,
			transferId: draft.transfer.id,
		});
	}

	_renderComposer () {
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
		const title = createElement("h5", {
			text: `${this._isPlayerStashRequest() ? "Request" : "Move"} ${entry ? getEntryName(entry) : this._draft.entryName}`,
		});
		const fields = createElement("div", {className: "charsheet__party-inventory-fields"});

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
			if (!this._isDraftEditable()) return;
			this._draft.quantity = Number(quantity.value);
			this._draft.commandId = getOpaqueToken();
			this._draft.resolutionCommandId = getOpaqueToken();
			this._draft.cancellationCommandId = getOpaqueToken();
			this._draft.transfer = null;
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
			if (!destinationToken && this._draft.destinationKind === "character" && !this._isDraftEditable()) {
				destinationToken = getOpaqueToken();
				destination.append(createElement("option", {
					text: "Original recipient — current campaign view unavailable",
					attrs: {value: destinationToken},
				}));
			}
			destination.value = destinationToken || "party_inventory";
			destination.addEventListener("change", () => {
				if (!this._isDraftEditable()) return;
				const recipient = this._recipientByToken.get(destination.value);
				this._draft.destinationKind = recipient ? "character" : "party_inventory";
				this._draft.recipientId = recipient?.id || null;
				this._draft.commandId = getOpaqueToken();
				this._draft.resolutionCommandId = getOpaqueToken();
				this._draft.cancellationCommandId = getOpaqueToken();
				this._draft.transfer = null;
				this._syncComposerSummary(composer);
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
		composer.append(title, fields);

		const summary = createElement("p", {
			className: "charsheet__party-inventory-confirmation",
			attrs: {id: "charsheet-party-inventory-confirmation"},
		});
		composer.append(summary);
		// Advisory only: the Confirm button is never disabled for weight. Encumbrance is not
		// an enforced rule here (ADR 0015 lists the carry rule as planned with no evaluator),
		// and blocking on it would also let a rejection disclose a peer's hidden load.
		const carryDelta = createElement("p", {
			className: "charsheet__party-inventory-carry-delta",
			attrs: {id: "charsheet-party-inventory-carry-delta", role: "status", "aria-live": "polite"},
		});
		composer.append(carryDelta);
		if (this._draft.blockers.length) {
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
		cancel.addEventListener("click", () => void this._pCancelDraft());
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
											: "Offer transfer",
			attrs: {type: "submit", "data-party-inventory-focus": "submit"},
		});
		actions.append(cancel, submit);
		composer.append(actions);
		composer.addEventListener("submit", event => {
			event.preventDefault();
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
		const rawUnitWeight = Number(entry?.item?.weight);
		const unitWeight = Number(this._fnProjectItemWeight?.(entry?.item) ?? entry?.item?.weight);

		const isMovedWeightKnown = Number.isFinite(unitWeight) && unitWeight >= 0;
		if (!profile || !entry || !Number.isSafeInteger(quantity) || quantity < 1) {
			target.textContent = "";
			return;
		}

		const moved = isMovedWeightKnown ? unitWeight * quantity : null;
		const movedRaw = Number.isFinite(rawUnitWeight) && rawUnitWeight >= 0 ? rawUnitWeight * quantity : null;
		// Moving OUT of the stash adds to this character; moving out of this character removes.
		const signedDelta = this._draft.kind === "party_inventory" ? moved : -moved;
		// Apply the delta to GROSS and FILLABLE weight and let the contract re-derive the
		// split, rather than adding it straight onto `bodyLoad`. With an extradimensional
		// container equipped those are different numbers: 20 lb of stowable gear arriving into
		// a bag with spare capacity leaves the body load unchanged, so the naive sum claimed a
		// 20 lb increase the character would never feel — and, in the other direction, hid the
		// moment the bag fills and the overflow starts landing on the body.
		//
		// A transferable stack is unequipped by definition (the eligibility rules block
		// equipped and attuned items), so it is bag-eligible unless it is itself a weightless
		// container, which cannot be stowed inside itself.
		const isFillable = !entry?.item?.containerCapacity?.weightless;
		const after = moved == null ? null : getCarryProfile({
			capacityOverride: profile.bodyCapacity,
			externalCapacity: profile.externalCapacity,
			grossWeight: Math.max(0, profile.grossWeight + signedDelta),
			fillableWeight: Math.max(0, profile.fillableWeight + (isFillable ? signedDelta : 0)),
			thresholdRuleId: profile.thresholdRuleId,
			thresholdSourceValue: profile.thresholdSourceValue,
			unknownStackCount: profile.unknownStackCount,
		});
		const beforeLevel = getCarryStatus(profile).level;
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
		} else {
			parts.push(`You: currently ${formatWeight(profile.bodyLoad, profile.isIndeterminate)} lb of ${formatNumber(profile.bodyCapacity)} — impact unknown (this stack has no recorded weight)`);
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
		target.textContent = `${parts.join(" · ")}.`;
		target.classList.toggle("charsheet__party-inventory-carry-delta--warn", afterLevel === "over_capacity" && beforeLevel !== "over_capacity");
	}

	_syncComposerSummary (composer) {
		if (!this._draft) return;
		const entry = this._getEntry(this._draft);
		const entryName = entry ? getEntryName(entry) : this._draft.entryName;
		const quantity = Number(this._draft.quantity);
		const isQuantityValid = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= this._draft.maxQuantity;
		const recipient = this._recipients.find(it => it.id === this._draft.recipientId);
		const destination = this._draft.kind === "party_inventory"
			? "this character"
			: this._draft.destinationKind === "party_inventory"
				? "the party stash"
				: recipient?.label || "the original recipient";
		this._syncCarryDelta(composer);
		const summary = composer.querySelector(".charsheet__party-inventory-confirmation");
		const approvalText = this._getApprovalText();
		summary.textContent = isQuantityValid
			? `${quantity} × ${entryName} will move from ${this._draft.kind === "party_inventory" ? "the party stash" : "this character"} to ${destination}.${approvalText ? ` ${approvalText}` : " This move applies immediately under your current authority."}`
			: `Enter a whole-number quantity from 1 to ${this._draft.maxQuantity}.`;
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
		submit.disabled = this._isSubmitting
			|| !isQuantityValid
			|| isAuthorityRefreshRequired
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
					: !isDraftEditable);
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
		if (this._draft.kind === "party_inventory") return "A DM must approve before anything leaves the stash.";
		if (this._draft.destinationKind === "party_inventory") return "A DM must accept before it arrives.";
		return "The recipient must accept before it arrives.";
	}

	_closeDraft () {
		const returnToken = this._draft?.returnToken;
		this._draft = null;
		this._error = this._needsAuthoritativeRefresh ? TRANSFER_REFRESH_REQUIRED_MESSAGE : null;
		this._render();
		if (this._root) this._decorateCharacterInventory();
		if (!returnToken) return;
		const returnButton = document.querySelector(`.charsheet__item-party-move[data-token="${CSS.escape(returnToken)}"]`)
			|| this._root?.querySelector(`[data-party-inventory-focus="stash-${CSS.escape(returnToken)}"]`)
			|| this._root?.querySelector(`[data-party-inventory-focus="refresh"]`);
		returnButton?.focus({preventScroll: true});
	}

	async _pCancelDraft () {
		if (this._isSubmitting || !this._draft || !this._isCurrent()) return false;
		const active = this._active;
		const draft = this._draft;
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
						const terminalMessages = {
							committed: "Transfer complete. Both inventories are up to date.",
							rejected: draft.kind === "party_inventory"
								? "Request was rejected. The party stash was unchanged."
								: "Transfer was rejected. The reserved items were restored.",
							cancelled: draft.kind === "party_inventory"
								? "Request was cancelled. The party stash was unchanged."
								: "Transfer was cancelled. The reserved items were restored.",
							expired: "Transfer expired. The reserved items were restored.",
						};
						const message = terminalMessages[matchedTransfer?.status]
							|| "No matching transfer was found. Latest source and stash balances loaded; inspect the destination before starting another transfer.";
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
				await this._api.pResolveTransfer(draft.pendingResolution);
				isResolutionKnown = true;
				draft.pendingResolution = null;
			} catch (error) {
				if (!isTransferOutcomeUncertain(error)) draft.pendingResolution = null;
				throw error;
			}
			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			if (!await this._pDrainRefresh()) throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			const message = draft.transfer.status === "proposed"
				? "Request cancelled. The party stash was unchanged."
				: "Transfer cancelled. The reserved items were restored.";
			this._isSubmitting = false;
			this._closeDraft();
			this._fnToast?.({type: "success", content: message});
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			draft.needsStatusCheck = true;
			this._error = getErrorMessage(error);
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
		if (draft.proposalRequest && Date.now() >= draft.proposalReplayUntil) {
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
			const entry = this._getEntry(draft);
			const container = this._getContainer(draft.kind);
			const eligibility = getInventoryTransferEligibility({container, entry, quantity: draft.quantity});
			if (!eligibility.isEligible) {
				this._error = getBlockerText({blockers: eligibility.blockers, maxQuantity: eligibility.maxQuantity});
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
					const messages = {
						committed: "Transfer complete. Both inventories are up to date.",
						rejected: draft.kind === "party_inventory"
							? "Request was rejected. The party stash was unchanged."
							: "Transfer was rejected. The reserved items were restored.",
						cancelled: draft.kind === "party_inventory"
							? "Request was cancelled. The party stash was unchanged."
							: "Transfer was cancelled. The reserved items were restored.",
						expired: "Transfer expired. The reserved items were restored.",
					};
					const message = messages[transfer.status];
					if (!message) throw Object.assign(new Error("Transfer is no longer pending"), {code: "TRANSFER_NOT_FOUND"});
					this._refreshFlags.character = true;
					this._refreshFlags.party = true;
					if (!await this._pDrainRefresh()) throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
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
			if (!draft.transfer) {
				const isProposalReplay = !!draft.proposalRequest;
				const isAutoResolve = this._shouldAutoResolve();
				const isRulesPinnedProposal = isAutoResolve && draft.destinationKind === "character";
				if (!draft.proposalRequest) {
					const rulesVersionId = isRulesPinnedProposal
						? draft.proposalRulesVersionId !== undefined
							? draft.proposalRulesVersionId
							: this._freshProposalRulesVersionId !== undefined
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
							items: [{entryId: draft.entryId, quantity: draft.quantity}],
							currency: {},
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

			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			if (!await this._pDrainRefresh()) throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			const terminalMessages = {
				committed: "Transfer complete. Both inventories are up to date.",
				rejected: draft.kind === "party_inventory"
					? "Request was rejected. The party stash was unchanged."
					: "Transfer was rejected. The reserved items were restored.",
				cancelled: draft.kind === "party_inventory"
					? "Request was cancelled. The party stash was unchanged."
					: "Transfer was cancelled. The reserved items were restored.",
				expired: "Transfer expired. The reserved items were restored.",
			};
			const message = terminalMessages[draft.transfer.status]
				|| (draft.transfer.status === "proposed"
					? "Request sent. A DM can approve it from the campaign inbox; the party stash is unchanged until then."
					: draft.destinationKind === "party_inventory"
						? "Transfer reserved. A DM can accept it from the campaign inbox."
						: "Transfer reserved. The recipient can accept it from the campaign inbox.");
			this._isSubmitting = false;
			this._closeDraft();
			this._fnToast?.({type: draft.transfer.status === "committed" ? "success" : "info", content: message});
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (draft.transfer) draft.needsStatusCheck = true;
			this._error = getErrorMessage(error);
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
