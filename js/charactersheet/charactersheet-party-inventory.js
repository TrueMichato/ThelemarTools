import {
	getProjectionId,
	getProjectionView,
	getTargetableProjections,
} from "../hub/hub-character-view.js";
import {
	getInventoryStackWeight,
	getInventoryTransferEligibility,
	getInventoryWeightSummary,
} from "../hub/hub-inventory-contract.js";

const DM_ROLES = new Set(["dm", "co_dm"]);
const MAX_SEEN_EVENT_KEYS = 2_000;

const ERROR_MESSAGES = {
	CHARACTER_BUSY: "This character is busy with another authoritative change. Wait a moment, then try again.",
	FORBIDDEN: "Your campaign role no longer allows this transfer. The inventories are unchanged.",
	IDEMPOTENCY_KEY_REUSED: "This transfer retry no longer matches the original request. Review the summary and try again.",
	NETWORK_UNAVAILABLE: "The Campaign Hub could not be reached. Your last synced stash is still shown; reconnect and retry.",
	TRANSFER_INSUFFICIENT: "The available quantity changed before the transfer completed. Nothing else was moved.",
	TRANSFER_ITEM_LINKED: "That stack is now linked to equipment or another character feature, so it cannot move safely.",
	TRANSFER_NOT_FOUND: "That transfer is no longer waiting. Refresh to see the latest inventories.",
};

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

export function getPartyInventoryRecipients ({projections = [], roster = [], currentCharacterId}) {
	return getTargetableProjections({projections, roster})
		.filter(projection => getProjectionId(projection) !== currentCharacterId)
		.map(projection => {
			const view = getProjectionView(projection);
			return {
				id: getProjectionId(projection),
				label: view.name,
				summary: view.classes.map(cls => `${cls.name}${Number.isFinite(cls.level) ? ` ${cls.level}` : ""}`).join(" / "),
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
		this._error = null;
		this._announcement = "";
		this._connectionState = null;
		this._isLoading = false;
		this._isSubmitting = false;
		this._refreshFlags = {character: false, party: false};
		this._refreshPromise = null;
		this._partyFetchToken = null;
		this._scheduledRefresh = false;
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
			this._realtime.on("projectionInvalidated", () => this._scheduleRefresh({character: true})),
			this._realtime.on("connectionState", state => this._onConnectionState(state)),
		);
	}

	async pAttach ({characterId, generation}) {
		this.detach();
		if (!this._isEnabled || typeof characterId !== "string" || !characterId) return false;
		const active = {characterId, generation, token: Symbol("party-inventory"), isOwner: false};
		this._active = active;

		let projection;
		try {
			projection = await this._api.pGetCharacterProjection({characterId});
		} catch {
			return false;
		}
		if (!this._isCurrent(active) || projection?.kind !== "owner_truth") return false;

		active.isOwner = true;
		this._mount();
		this._bindInventoryUi();
		this._isLoading = true;
		this._render();
		await this._pRefreshParty(active);
		return this._isCurrent(active) && active.isOwner;
	}

	detach () {
		this._active = null;
		this._draft = null;
		this._error = null;
		this._announcement = "";
		this._partyInventory = null;
		this._role = null;
		this._recipients = [];
		this._recipientByToken.clear();
		this._itemByToken.clear();
		this._tokenByItemKey.clear();
		this._seenEventKeys.clear();
		this._refreshFlags = {character: false, party: false};
		this._partyFetchToken = null;
		this._scheduledRefresh = false;
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

	_decorateCharacterInventory () {
		if (!this._active?.isOwner) return;
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
			button.disabled = maxQuantity < 1;
			button.setAttribute("aria-label", maxQuantity
				? `Share ${getEntryName(entry)} with the party`
				: `${getEntryName(entry)} cannot be shared: ${blockers.join(", ")}`);
			button.title = blockerText || `Move this stack to the party stash or pass it to another campaign character`;

			row.querySelector(".charsheet__item-party-note")?.remove();
			if (blockerText) {
				const note = createElement("span", {
					className: "charsheet__item-party-note",
					text: blockerText,
				});
				const details = row.querySelector(".charsheet__item-details") || row.querySelector(".charsheet__item-content");
				details?.append(note);
			}
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
		const entry = this._getEntry({kind, entryId});
		if (!entry) return;
		const container = this._getContainer(kind);
		const {maxQuantity, blockers} = getTransferLimit({container, entry});
		if (!maxQuantity) {
			this._error = getBlockerText({blockers, maxQuantity});
			this._render();
			return;
		}
		this._draft = {
			kind,
			entryId,
			quantity: 1,
			maxQuantity,
			blockers,
			destinationKind: kind === "party_inventory" ? "character" : "party_inventory",
			recipientId: null,
			returnToken,
			commandId: getOpaqueToken(),
			resolutionCommandId: getOpaqueToken(),
			cancellationCommandId: getOpaqueToken(),
			transfer: null,
		};
		this._error = null;
		this._announcement = "";
		this._render();
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
		if (!this._active?.isOwner || event?.campaignId !== this._campaignId) return;
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
		if (!this._active?.isOwner) return;
		this._connectionState = state?.state || null;
		if (state?.state === "live") this._scheduleRefresh({character: true, party: true});
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
		if (this._refreshPromise) {
			const wasSuccessful = await this._refreshPromise;
			if (
				this._isCurrent()
				&& (this._refreshFlags.character || this._refreshFlags.party)
			) return (await this._pDrainRefresh()) && wasSuccessful;
			return wasSuccessful;
		}
		const active = this._active;
		this._refreshPromise = (async () => {
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
		try {
			return await this._refreshPromise;
		} finally {
			this._refreshPromise = null;
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
		this._isLoading = !this._partyInventory;
		this._render();
		const [partyResult, snapshotResult] = await Promise.allSettled([
			this._api.pGetPartyInventory({campaignId: this._campaignId}),
			this._api.pGetCampaignSnapshot({campaignId: this._campaignId}),
		]);
		if (!this._isCurrent(active) || this._partyFetchToken !== fetchToken) return false;

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
			this._recipients = getPartyInventoryRecipients({
				projections: snapshot.characters,
				roster: snapshot.roster,
				currentCharacterId: active.characterId,
			});
			this._rebuildRecipientTokens();
		}
		this._error = partyResult.status === "rejected"
			? getErrorMessage(partyResult.reason)
			: snapshotResult.status === "rejected"
				? getErrorMessage(snapshotResult.reason)
				: null;
		this._isLoading = false;
		this._render();
		this._decorateCharacterInventory();
		return partyResult.status === "fulfilled" && snapshotResult.status === "fulfilled";
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
		if (result.status === "conflict") {
			this._error = "The server inventory overlaps unsaved edits on this sheet. Saving is paused until you choose a recovery version.";
			this._render();
		} else if (result.status === "failed") {
			this._error = "The latest authoritative inventory could not be applied. Your current sheet was preserved; retry the sync.";
			this._render();
		}
		this._decorateCharacterInventory();
		return result;
	}

	_render () {
		if (!this._root || !this._active?.isOwner) return;
		const focus = this._captureFocus();
		this._root.replaceChildren();
		this._root.append(this._renderHeader());

		if (this._error) this._root.append(this._renderError());
		if (["reconnecting", "unavailable"].includes(this._connectionState)) {
			this._root.append(createElement("p", {
				className: "charsheet__party-inventory-connection",
				text: "Reconnecting to the Campaign Hub. Showing the last synced stash.",
				attrs: {role: "status"},
			}));
		}

		if (this._isLoading && !this._partyInventory) this._root.append(this._renderLoading());
		else if (this._partyInventory) this._root.append(this._renderContents());
		else if (!this._error) this._root.append(this._renderEmpty("The party stash is not available yet."));

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
		refresh.addEventListener("click", () => this._scheduleRefresh({character: true, party: true}));
		controls.append(refresh);
		header.append(headingGroup, controls);
		return header;
	}

	_renderError () {
		const error = createElement("div", {
			className: "charsheet__party-inventory-error",
			attrs: {role: "alert"},
		});
		error.append(createElement("span", {text: this._error}));
		const retry = createElement("button", {
			className: "ve-btn ve-btn-xs ve-btn-default",
			text: "Retry",
			attrs: {type: "button", "data-party-inventory-focus": "retry"},
		});
		retry.addEventListener("click", () => {
			this._error = null;
			this._scheduleRefresh({character: true, party: true});
			this._render();
		});
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
		if (DM_ROLES.has(this._role)) {
			const token = this._getItemToken({kind: "party_inventory", entryId: entry.id});
			this._itemByToken.set(token, {kind: "party_inventory", entryId: entry.id});
			const button = createElement("button", {
				className: "ve-btn ve-btn-xs ve-btn-primary",
				text: "Take",
				attrs: {
					type: "button",
					disabled: maxQuantity < 1,
					"aria-label": maxQuantity
						? `Move ${getEntryName(entry)} to this character`
						: `${getEntryName(entry)} cannot move: ${blockers.join(", ")}`,
					title: getBlockerText({blockers, maxQuantity}) || "Move this stack to the open character",
					"data-party-inventory-focus": `stash-${token}`,
				},
			});
			button.addEventListener("click", () => this._beginDraft({kind: "party_inventory", entryId: entry.id, returnToken: token}));
			row.append(button);
		} else {
			row.append(createElement("span", {
				className: "charsheet__party-inventory-role-note",
				text: "DM transfer",
				attrs: {title: "Only a DM or Co-DM can move items out of the shared stash."},
			}));
		}
		const blockerText = getBlockerText({blockers, maxQuantity});
		if (blockerText) row.append(createElement("span", {className: "charsheet__party-inventory-row-note", text: blockerText}));
		return row;
	}

	_renderEmpty (message) {
		return createElement("p", {className: "charsheet__party-inventory-empty", text: message});
	}

	_renderComposer () {
		const entry = this._getEntry(this._draft);
		const composer = createElement("form", {
			className: "charsheet__party-inventory-composer",
			attrs: {"aria-label": "Confirm inventory transfer"},
		});
		const title = createElement("h5", {text: `Move ${getEntryName(entry)}`});
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
				"aria-describedby": "charsheet-party-inventory-confirmation",
				"data-party-inventory-focus": "quantity",
			},
		});
		quantity.addEventListener("input", () => {
			if (this._draft.transfer) return;
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
				attrs: {"data-party-inventory-focus": "destination"},
			});
			destination.append(createElement("option", {text: "Party stash", attrs: {value: "party_inventory"}}));
			for (const [token, recipient] of this._recipientByToken) {
				const summary = recipient.summary ? ` — ${recipient.summary}` : "";
				destination.append(createElement("option", {
					text: `${recipient.label}${summary}`,
					attrs: {value: token},
				}));
			}
			destination.value = this._draft.destinationKind === "party_inventory"
				? "party_inventory"
				: [...this._recipientByToken].find(([, recipient]) => recipient.id === this._draft.recipientId)?.[0] || "party_inventory";
			destination.addEventListener("change", () => {
				if (this._draft.transfer) return;
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
		if (this._draft.blockers.length) {
			composer.append(createElement("p", {
				className: "charsheet__party-inventory-limit-note",
				text: getBlockerText({blockers: this._draft.blockers, maxQuantity: this._draft.maxQuantity}),
			}));
		}
		const actions = createElement("div", {className: "charsheet__party-inventory-composer-actions"});
		const cancel = createElement("button", {
			className: "ve-btn ve-btn-default",
			text: "Cancel",
			attrs: {type: "button", "data-party-inventory-focus": "cancel"},
		});
		cancel.addEventListener("click", () => void this._pCancelDraft());
		const submit = createElement("button", {
			className: "ve-btn ve-btn-primary",
			text: "Confirm transfer",
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

	_syncComposerSummary (composer) {
		if (!this._draft) return;
		const entry = this._getEntry(this._draft);
		const quantity = Number(this._draft.quantity);
		const isQuantityValid = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= this._draft.maxQuantity;
		const recipient = this._recipients.find(it => it.id === this._draft.recipientId);
		const destination = this._draft.kind === "party_inventory"
			? "this character"
			: this._draft.destinationKind === "party_inventory"
				? "the party stash"
				: recipient?.label || "the selected character";
		const summary = composer.querySelector(".charsheet__party-inventory-confirmation");
		summary.textContent = isQuantityValid
			? `${quantity} × ${getEntryName(entry)} will move from ${this._draft.kind === "party_inventory" ? "the party stash" : "this character"} to ${destination}.${this._willRequireApproval() ? " The recipient must accept before it arrives." : ""}`
			: `Enter a whole-number quantity from 1 to ${this._draft.maxQuantity}.`;
		const submit = composer.querySelector("button[type='submit']");
		const isReserved = !!this._draft.transfer;
		submit.disabled = this._isSubmitting
			|| !isQuantityValid
			|| (this._draft.kind === "character" && this._draft.destinationKind === "character" && !recipient);
		for (const control of composer.querySelectorAll("input, select, button")) {
			if (control === submit) continue;
			const isCancel = control.dataset.partyInventoryFocus === "cancel";
			control.disabled = this._isSubmitting || (isReserved && !isCancel);
		}
	}

	_willRequireApproval () {
		return !DM_ROLES.has(this._role);
	}

	_closeDraft () {
		const returnToken = this._draft?.returnToken;
		this._draft = null;
		this._error = null;
		this._render();
		if (!returnToken) return;
		const returnButton = document.querySelector(`.charsheet__item-party-move[data-token="${CSS.escape(returnToken)}"]`)
			|| this._root?.querySelector(`[data-party-inventory-focus="stash-${CSS.escape(returnToken)}"]`);
		returnButton?.focus({preventScroll: true});
	}

	async _pCancelDraft () {
		if (this._isSubmitting || !this._draft || !this._isCurrent()) return false;
		const active = this._active;
		const draft = this._draft;
		if (!draft.transfer) {
			this._closeDraft();
			return true;
		}

		this._isSubmitting = true;
		this._error = null;
		this._render();
		try {
			await this._api.pResolveTransfer({
				campaignId: this._campaignId,
				transferId: draft.transfer.id,
				decision: "reject",
				idempotencyKey: draft.cancellationCommandId,
			});
			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			if (!await this._pDrainRefresh()) throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			const message = "Transfer cancelled. The reserved items were restored.";
			this._isSubmitting = false;
			this._closeDraft();
			this._fnToast?.({type: "success", content: message});
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
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

		this._isSubmitting = true;
		this._error = null;
		this._render();
		try {
			if (draft.kind === "character" && !draft.transfer) {
				const isSaved = await this._fnSaveCharacter?.();
				if (!isSaved) throw Object.assign(new Error("Save failed"), {code: "CHARACTER_BUSY"});
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (!draft.transfer) {
				const targetId = getPartyInventoryTransferTargetId({
					sourceKind: draft.kind,
					destinationKind: draft.destinationKind,
					activeCharacterId: active.characterId,
					recipientId: draft.recipientId,
					partyInventoryId: this._partyInventory.id,
				});
				const result = await this._api.pProposeTransfer({
					campaignId: this._campaignId,
					sourceKind: draft.kind,
					sourceId: draft.kind === "character" ? active.characterId : this._partyInventory.id,
					targetKind: draft.destinationKind,
					targetId,
					payload: {
						items: [{entryId: draft.entryId, quantity: draft.quantity}],
						currency: {},
					},
					idempotencyKey: draft.commandId,
				});
				draft.transfer = result.transfer;
			}
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			if (DM_ROLES.has(this._role)) {
				await this._api.pResolveTransfer({
					campaignId: this._campaignId,
					transferId: draft.transfer.id,
					decision: "accept",
					idempotencyKey: draft.resolutionCommandId,
				});
			}

			this._refreshFlags.character = true;
			this._refreshFlags.party = true;
			if (!await this._pDrainRefresh()) throw Object.assign(new Error("Authoritative refresh failed"), {code: "NETWORK_UNAVAILABLE"});
			if (!this._isCurrent(active) || this._draft !== draft) return false;
			const message = this._willRequireApproval()
				? "Transfer reserved. The recipient can accept it from the campaign inbox."
				: "Transfer complete. Both inventories are up to date.";
			this._isSubmitting = false;
			this._draft = null;
			this._fnToast?.({type: "success", content: message});
			this._render();
			this._announce(message);
			return true;
		} catch (error) {
			if (!this._isCurrent(active) || this._draft !== draft) return false;
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
		const next = this._root?.querySelector(`[data-party-inventory-focus="${CSS.escape(focus.key)}"]`);
		if (!next || next.disabled) return;
		next.focus({preventScroll: true});
		if (focus.selectionStart != null && typeof next.setSelectionRange === "function") {
			next.setSelectionRange(focus.selectionStart, focus.selectionEnd);
		}
	}
}

globalThis.CharacterSheetPartyInventory = CharacterSheetPartyInventory;
