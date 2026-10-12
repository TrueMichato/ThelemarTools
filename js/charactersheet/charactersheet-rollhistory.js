/**
 * Character Sheet Roll History
 * Local session log, or owner-scoped retained campaign rolls with exact-command recovery.
 */
import {HUB_ROLL_HISTORY_CONTRACT_VERSION, isValidRollHistoryEvent, projectRollHistoryEvent} from "../hub/hub-roll-history.js";
import {HUB_COMMAND_REPLAY_WINDOW_MS} from "../hub/hub-api-client.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_} = /** @type {*} */ (globalThis);

export const HUB_ROLL_VISIBILITY_CHOICES = Object.freeze([
	Object.freeze({value: "all_members", label: "Everyone in the campaign"}),
	Object.freeze({value: "actor_and_dm", label: "Only me and DMs"}),
]);

export class CharacterSheetRollHistory {
	static MAX_ROLLS = 200;
	static DEFAULT_HUB_VISIBILITY = "all_members";

	static ROLL_TYPES = {
		ATTACK: {label: "Attack", color: "#dc3545"},
		SPELL_ATTACK: {label: "Spell Attack", color: "#e65100"},
		DAMAGE: {label: "Damage", color: "#8b0000"},
		SPELL_DAMAGE: {label: "Spell Damage", color: "#8b0000"},
		SAVE: {label: "Saving Throw", color: "#1976d2"},
		SPELL_DC: {label: "Spell Save DC", color: "#1565c0"},
		SKILL: {label: "Skill Check", color: "#7b1fa2"},
		ABILITY: {label: "Ability Check", color: "#00838f"},
		INITIATIVE: {label: "Initiative", color: "#f9a825"},
		DEATH_SAVE: {label: "Death Save", color: "#757575"},
		HEALING: {label: "Healing", color: "#2e7d32"},
		SPELL_HEALING: {label: "Spell Healing", color: "#2e7d32"},
		HIT_DIE: {label: "Hit Die", color: "#388e3c"},
		OTHER: {label: "Roll", color: "#546e7a"},
	};

	constructor (page, {recoveryStorage} = {}) {
		this._page = page;
		this._rolls = [];
		this._panelEl = null;
		this._listEl = null;
		this._hubVisibilitySelect = null;
		this._isOpen = false;
		this._unreadCount = 0;
		this._hubScope = null;
		this._hubGeneration = 0;
		this._hubReadGeneration = 0;
		this._hubReadAbort = null;
		this._hubHistoryError = "";
		this._hubRecoveryError = "";
		this._isHubLoading = false;
		this._isHubConnected = false;
		this._isHubAuthorityInvalid = false;
		this._isHubAuthorityRefreshRequired = false;
		this._pendingHubRolls = new Map();
		this._hubEvents = new Map();
		this._hubLocalRolls = [];
		try {
			this._recoveryStorage = recoveryStorage === undefined ? globalThis.sessionStorage || null : recoveryStorage;
		} catch (error) {
			this._recoveryStorage = null;
			this._hubRecoveryError = `Roll recovery storage is unavailable: ${error.message}`;
		}
		if (typeof document !== "undefined") this._buildPanel();
	}

	/**
	 * Add a roll to the history log.
	 * @param {object} roll
	 * @param {string} roll.title - Display title (e.g. "Attack: Longsword", "Spell Attack: Fireball")
	 * @param {number|string} roll.total - Final total value
	 * @param {string} [roll.breakdown] - Dice breakdown text (e.g. "1d20 (14) + 5")
	 * @param {string} [roll.resultClass] - CSS class for coloring (e.g. "text-danger" for crit)
	 * @param {string} [roll.resultNote] - Extra note (e.g. "Critical Hit!")
	 */
	addRoll ({title, total, breakdown = "", resultClass = "", resultNote = ""}) {
		if (this._page?.isCurrentCharacterReadOnly?.()) return;
		const rollType = this._deriveRollType(title);
		const roll = {
			timestamp: Date.now(),
			title,
			total,
			breakdown,
			resultClass,
			resultNote,
			rollType,
		};
		if (this._isCampaign()) {
			this._addHubRoll(roll);
		} else {
			this._rolls.unshift(roll);
			this._rolls.length = Math.min(this._rolls.length, CharacterSheetRollHistory.MAX_ROLLS);
		}

		// Track unread rolls only while the panel is closed; opening the log marks them as seen.
		if (!this._isOpen) {
			this._unreadCount = Math.min(this._unreadCount + 1, CharacterSheetRollHistory.MAX_ROLLS);
		}

		this._updateBadge();

		if (this._isOpen) {
			this._renderList();
		}
	}

	_isCampaign () { return this._page?._isHubCharacter === true || !!this._page?._hubRollLogAdapter; }

	async activateHubScope ({accountId, campaignId, characterId, isEnabled}) {
		this.resetCharacterScopeUi();
		if (this._page?.isCurrentCharacterReadOnly?.()) {
			this._hubHistoryError = "Personal Roll History is unavailable while inspecting another owner's character.";
			this._renderList();
			return false;
		}
		if (!isEnabled || !accountId || !campaignId || !characterId) {
			this._hubHistoryError = "Retained Roll History is unavailable on this server. Reload after the server is updated.";
			this._renderList();
			return false;
		}
		this._hubScope = {accountId, campaignId, characterId};
		this._hubStorageKey = `hub-roll-recovery:${accountId}:${campaignId}:${characterId}`;
		this._loadHubRecovery();
		this._syncHubRows();
		return this.pRefreshHubHistory();
	}

	_isHubScopeCurrent (scope, generation) {
		return this._hubScope === scope && this._hubGeneration === generation
			&& this._page?._currentCharacterId === scope.characterId
			&& !this._page?.isCurrentCharacterReadOnly?.();
	}

	_loadHubRecovery () {
		try {
			const raw = this._recoveryStorage?.getItem(this._hubStorageKey);
			if (!raw) return;
			if (raw.length > 512_000) throw new Error("Saved roll recovery exceeds its size limit.");
			const saved = JSON.parse(raw);
			if (saved.version !== 1 || !Array.isArray(saved.rolls) || saved.rolls.length > 200) throw new Error("Saved roll recovery has an unsupported shape.");
			for (const pending of saved.rolls) {
				const command = pending?.command;
				if (
					!command || command.campaignId !== this._hubScope.campaignId || command.characterId !== this._hubScope.characterId
					|| typeof command.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.idempotencyKey)
					|| typeof command.total !== "number" || !Number.isFinite(command.total)
					|| typeof command.formula !== "string" || !command.formula || command.formula.length > 200
					|| !Number.isFinite(command.retryUntil) || !Number.isFinite(pending.timestamp)
					|| pending.timestamp > Date.now() + 5_000 || command.retryUntil < pending.timestamp
					|| command.retryUntil > pending.timestamp + HUB_COMMAND_REPLAY_WINDOW_MS + 5_000
					|| pending.commandId !== command.idempotencyKey
					|| this._pendingHubRolls.has(command.idempotencyKey)
					|| !["all_members", "actor_and_dm"].includes(command.visibility)
					|| (command.context !== null && (typeof command.context !== "string" || command.context.length > 100))
					|| typeof command.detail !== "object" || command.detail === null
					|| Array.isArray(command.detail)
					|| Object.keys(command).some(key => !["campaignId", "characterId", "idempotencyKey", "formula", "total", "context", "visibility", "detail", "retryUntil"].includes(key))
					|| Object.keys(command.detail).some(key => !["title", "breakdown", "resultClass", "resultNote"].includes(key))
					|| Object.values(command.detail).some(value => typeof value !== "string" || value.length > 200)
				) throw new Error("Saved roll recovery is invalid.");
				Object.freeze(command.detail);
				Object.freeze(command);
				this._pendingHubRolls.set(command.idempotencyKey, {
					command,
					commandId: command.idempotencyKey,
					timestamp: pending.timestamp,
					title: command.detail.title || command.formula,
					total: command.total,
					breakdown: command.detail.breakdown || command.formula,
					resultClass: command.detail.resultClass || "",
					resultNote: command.detail.resultNote || "",
					rollType: this._deriveRollType(command.detail.title || command.context),
					syncState: "unconfirmed",
					syncError: "A previous send has an unconfirmed outcome. Check server history before retrying.",
				});
			}
		} catch (error) {
			this._pendingHubRolls.clear();
			this._hubRecoveryError = `${error.message} New sends are blocked to protect unresolved rolls.`;
		}
	}

	_persistHubRecovery () {
		if (!this._recoveryStorage) {
			this._hubRecoveryError = "Roll recovery storage is unavailable. New sends are blocked to prevent losing uncertain outcomes on reload.";
			return false;
		}
		try {
			if (this._pendingHubRolls.size) {
				const raw = JSON.stringify({version: 1, rolls: [...this._pendingHubRolls.values()]});
				if (raw.length > 512_000) throw new Error("Roll recovery storage is full.");
				this._recoveryStorage.setItem(this._hubStorageKey, raw);
			} else this._recoveryStorage.removeItem(this._hubStorageKey);
			return true;
		} catch (error) {
			this._hubRecoveryError = `${error.message} Unresolved rolls remain on this device; new sends are blocked.`;
			return false;
		}
	}

	_addHubRoll (roll) {
		let command;
		try {
			if (!this._hubScope) throw new Error(this._hubHistoryError || "Retained Roll History is not ready.");
			if (!this._isHubConnected || globalThis.navigator?.onLine === false) throw new Error("Offline: this roll stays on this device and will not be sent automatically.");
			if (this._isHubAuthorityInvalid) throw new Error("Campaign permissions changed. Refresh history before sending another roll.");
			if (this._hubRecoveryError) throw new Error(this._hubRecoveryError);
			if (this._pendingHubRolls.size >= 200) throw new Error("Resolve the outstanding roll sends before sending more.");
			command = this._page._hubRollLogAdapter.createCommand({
				formula: roll.breakdown || roll.title,
				total: roll.total,
				context: roll.rollType.toLowerCase(),
				visibility: this._getHubRollVisibility(),
				detail: {title: roll.title, breakdown: roll.breakdown, resultClass: roll.resultClass, resultNote: roll.resultNote},
			});
		} catch (error) {
			this._hubLocalRolls.unshift({...roll, syncState: "unsynced", syncError: error.message});
			this._hubLocalRolls.length = Math.min(this._hubLocalRolls.length, 200);
			this._syncHubRows();
			return;
		}
		const pending = {...roll, command, commandId: command.idempotencyKey, syncState: "sending", syncError: ""};
		this._pendingHubRolls.set(command.idempotencyKey, pending);
		if (!this._persistHubRecovery()) {
			this._pendingHubRolls.delete(command.idempotencyKey);
			this._hubLocalRolls.unshift({...roll, syncState: "unsynced", syncError: this._hubRecoveryError});
			this._hubLocalRolls.length = Math.min(this._hubLocalRolls.length, 200);
		} else void this._pSendHubRoll(pending);
		this._syncHubRows();
	}

	async _pSendHubRoll (pending) {
		const scope = this._hubScope;
		const generation = this._hubGeneration;
		pending.syncState = "sending";
		pending.syncError = "";
		this._syncHubRows();
		try {
			const response = await this._page._hubRollLogAdapter.pLogCommand(pending.command);
			if (!this._isHubScopeCurrent(scope, generation)) return false;
			if (!this.receiveHubRoll(response?.event)) throw new Error("The roll response could not be confirmed. Check server history before retrying.");
			return true;
		} catch (error) {
			if (!this._isHubScopeCurrent(scope, generation) || !this._pendingHubRolls.has(pending.commandId)) return false;
			if (this._handleHubReadAccessError(error)) return false;
			pending.syncState = "unconfirmed";
			pending.syncError = "Send outcome unconfirmed. Check server history and retry the same roll; do not roll again to resend it.";
			this._persistHubRecovery();
			this._syncHubRows();
			return false;
		}
	}

	_matchesPendingHubRoll (event) {
		const command = this._pendingHubRolls.get(event.payload?.actorCommandId)?.command;
		if (!command) return true;
		const projected = projectRollHistoryEvent(event);
		return projected.payload.formula === command.formula
			&& projected.payload.total === command.total
			&& projected.payload.context === (command.context || "")
			&& projected.visibility === command.visibility
			&& ["title", "breakdown", "resultClass", "resultNote"].every(key => projected.payload.detail[key] === (command.detail[key] || ""));
	}

	receiveHubRoll (event) {
		if (!this._hubScope || !this._isHubScopeCurrent(this._hubScope, this._hubGeneration) || !isValidRollHistoryEvent(event, this._hubScope)) return false;
		if (this._isHubAuthorityInvalid) {
			this._isHubAuthorityRefreshRequired = true;
			return false;
		}
		if (!this._matchesPendingHubRoll(event)) return false;
		const projected = projectRollHistoryEvent(event);
		const isNew = !this._hubEvents.has(projected.id);
		const pending = this._pendingHubRolls.get(projected.payload.actorCommandId);
		this._hubEvents.set(projected.id, projected);
		if (pending) {
			this._pendingHubRolls.delete(pending.commandId);
			this._persistHubRecovery();
		} else if (isNew && !this._isOpen) this._unreadCount = Math.min(this._unreadCount + 1, 200);
		this._syncHubRows();
		return true;
	}

	_validateHubHistory (page) {
		if (
			page?.contractVersion !== HUB_ROLL_HISTORY_CONTRACT_VERSION
			|| !Array.isArray(page.events) || page.events.length > 200
			|| !Number.isSafeInteger(page.highWaterSequence) || page.highWaterSequence < 0
			|| typeof page.history?.hasMore !== "boolean"
			|| !Number.isSafeInteger(page.history.scannedBackThroughSequence) || page.history.scannedBackThroughSequence < 1
			|| page.events.some(event => !isValidRollHistoryEvent(event, this._hubScope) || event.sequence > page.highWaterSequence)
			|| page.events.some(event => !this._matchesPendingHubRoll(event))
			|| new Set(page.events.map(event => event.id)).size !== page.events.length
			|| page.events.some((event, i) => i > 0 && event.sequence <= page.events[i - 1].sequence)
		) throw new Error("The server returned unsupported Roll History. Reload after the server is updated.");
		return page;
	}

	async pRefreshHubHistory () {
		if (!this._hubScope) return false;
		const scope = this._hubScope;
		const generation = this._hubGeneration;
		const readGeneration = ++this._hubReadGeneration;
		this._hubReadAbort?.abort();
		const abort = new AbortController();
		this._hubReadAbort = abort;
		this._isHubLoading = true;
		this._renderList();
		try {
			const page = await this._page._hubRollLogAdapter.pListHistory({signal: abort.signal});
			if (!this._isHubScopeCurrent(scope, generation) || readGeneration !== this._hubReadGeneration) return false;
			this._validateHubHistory(page);
			for (const [id, event] of this._hubEvents) {
				if (event.sequence <= page.highWaterSequence) this._hubEvents.delete(id);
			}
			for (const event of page.events) {
				this._hubEvents.set(event.id, projectRollHistoryEvent(event));
				if (this._pendingHubRolls.delete(event.payload.actorCommandId)) this._persistHubRecovery();
			}
			this._isHubAuthorityInvalid = false;
			this._hubHistoryError = "";
			this._syncHubRows();
			return true;
		} catch (error) {
			if (!this._isHubScopeCurrent(scope, generation) || readGeneration !== this._hubReadGeneration) return false;
			if (!this._handleHubReadAccessError(error)) this._hubHistoryError = `${error.message || "Roll History could not be loaded."} Refresh history to try again; existing sends are unchanged.`;
			return false;
		} finally {
			if (this._isHubScopeCurrent(scope, generation) && readGeneration === this._hubReadGeneration) {
				this._isHubLoading = false;
				this._renderList();
				if (!this._isHubAuthorityInvalid && this._isHubAuthorityRefreshRequired) {
					this._isHubAuthorityRefreshRequired = false;
					void this.pRefreshHubHistory();
				}
			}
		}
	}

	async pRetryHubRoll (commandId) {
		const pending = this._pendingHubRolls.get(commandId);
		if (!pending || !this._hubScope || this._isHubAuthorityInvalid || ["sending", "checking"].includes(pending.syncState)) return false;
		const scope = this._hubScope;
		const generation = this._hubGeneration;
		pending.syncState = "checking";
		this._syncHubRows();
		try {
			const page = await this._page._hubRollLogAdapter.pListHistory({commandId});
			if (!this._isHubScopeCurrent(scope, generation)) return false;
			if (!this._pendingHubRolls.has(commandId)) return true;
			this._validateHubHistory(page);
			if (page.events.some(event => event.payload.actorCommandId !== commandId) || page.history.hasMore) throw new Error("Roll reconciliation is incomplete.");
			if (page.events.length) {
				for (const event of page.events) {
					if (!this.receiveHubRoll(event)) throw new Error("The committed roll does not match the attempted command. Its outcome remains unconfirmed.");
				}
				return true;
			}
			if (!this._isHubConnected || Date.now() >= pending.command.retryUntil) throw new Error("No committed roll was found, but it cannot be safely resent now. Its outcome remains unconfirmed.");
			return await this._pSendHubRoll(pending);
		} catch (error) {
			if (!this._isHubScopeCurrent(scope, generation) || !this._pendingHubRolls.has(commandId)) return false;
			if (this._handleHubReadAccessError(error)) return false;
			pending.syncState = "unconfirmed";
			pending.syncError = error.message;
			this._persistHubRecovery();
			this._syncHubRows();
			return false;
		}
	}

	_handleHubReadAccessError (error) {
		if (!["AUTH_REQUIRED", "CAMPAIGN_NOT_FOUND", "CHARACTER_NOT_FOUND", "ACCOUNT_DELETION_PENDING", "FORBIDDEN"].includes(error?.code)) return false;
		this.onHubConnectionState({state: "access_lost"});
		return true;
	}

	onHubAuthorityChanged () {
		if (!this._hubScope) return;
		this._hubGeneration++;
		this._hubReadAbort?.abort();
		this._isHubLoading = false;
		this._isHubAuthorityInvalid = true;
		this._hubEvents.clear();
		this._hubHistoryError = "Campaign permissions changed. Retained Roll History is concealed until refreshed.";
		for (const pending of this._pendingHubRolls.values()) {
			pending.syncState = "unconfirmed";
			pending.syncError = "Campaign permissions changed. Refresh history before checking this roll.";
		}
		this._syncHubRows();
		void this.pRefreshHubHistory();
	}

	onHubConnectionState ({state}) {
		if (!this._isCampaign()) return;
		if (state === "access_lost") {
			let recoveryError = "";
			try {
				if (this._hubStorageKey) this._recoveryStorage?.removeItem(this._hubStorageKey);
			} catch (error) {
				recoveryError = `Could not clear roll recovery: ${error.message}`;
			}
			this.resetCharacterScopeUi();
			this._hubRecoveryError = recoveryError;
			this._hubHistoryError = "Campaign access ended. Personal Roll History is concealed.";
			this._renderList();
			return;
		}
		this._isHubConnected = state === "live";
		if (state === "live") void this.pRefreshHubHistory();
		else {
			this._hubGeneration++;
			this._hubReadAbort?.abort();
			this._isHubLoading = false;
			for (const pending of this._pendingHubRolls.values()) {
				pending.syncState = "unconfirmed";
				pending.syncError = "Connection interrupted. Check server history before retrying this roll.";
			}
			this._syncHubRows();
		}
		this._renderList();
	}

	_syncHubRows () {
		const events = [...this._hubEvents.values()].sort((a, b) => b.sequence - a.sequence).slice(0, 200);
		this._hubEvents = new Map(events.map(event => [event.id, event]));
		const rows = events.map(event => ({
			eventId: event.id,
			commandId: event.payload.actorCommandId,
			sequence: event.sequence,
			timestamp: new Date(event.createdAt).getTime(),
			title: event.payload.detail.title || event.payload.formula,
			total: event.payload.total,
			breakdown: event.payload.detail.breakdown || event.payload.formula,
			resultClass: event.payload.detail.resultClass,
			resultNote: event.payload.detail.resultNote,
			rollType: this._deriveRollType(event.payload.detail.title || event.payload.context),
			syncState: "synced",
		}));
		this._rolls = [...this._pendingHubRolls.values(), ...this._hubLocalRolls].sort((a, b) => b.timestamp - a.timestamp).concat(rows);
		this._updateBadge();
		this._renderList();
	}

	/**
	 * Derive a roll type key from the title string.
	 */
	_deriveRollType (title) {
		if (!title) return "OTHER";
		const t = title.toLowerCase();

		if (t.includes("death save")) return "DEATH_SAVE";
		if (t.includes("spell attack")) return "SPELL_ATTACK";
		if (t.includes("spell save") || t.includes("spell dc")) return "SPELL_DC";
		if (t.includes("spell damage")) return "SPELL_DAMAGE";
		if (t.includes("spell healing")) return "SPELL_HEALING";
		if (t.includes("attack")) return "ATTACK";
		if (t.includes("damage")) return "DAMAGE";
		if (t.includes("saving throw") || t.includes("save")) return "SAVE";
		if (t.includes("initiative")) return "INITIATIVE";
		if (t.includes("healing") || t.includes("hit die") || t.includes("hit dice")) return "HIT_DIE";
		if (t.includes("check") || t.includes("ability")) return "ABILITY";

		// Skill names (e.g. "Perception", "Athletics")
		const skillNames = ["acrobatics", "animal handling", "arcana", "athletics", "deception",
			"history", "insight", "intimidation", "investigation", "medicine", "nature",
			"perception", "performance", "persuasion", "religion", "sleight of hand",
			"stealth", "survival"];
		if (skillNames.some(s => t.includes(s))) return "SKILL";

		return "OTHER";
	}

	/**
	 * Get roll count (for testing).
	 */
	getRollCount () { return this._rolls.length; }

	/**
	 * Get all rolls (for testing).
	 */
	getRolls () { return [...this._rolls]; }

	_getHubRollVisibility () {
		const saved = this._page?._state?.getSettings?.()?.hubRollVisibility;
		return HUB_ROLL_VISIBILITY_CHOICES.some(choice => choice.value === saved)
			? saved
			: CharacterSheetRollHistory.DEFAULT_HUB_VISIBILITY;
	}

	_setHubRollVisibility (visibility) {
		if (!HUB_ROLL_VISIBILITY_CHOICES.some(choice => choice.value === visibility)) return false;
		if (!this._page?._state?.setSetting?.("hubRollVisibility", visibility)) return false;
		this._page._saveCurrentCharacter?.();
		return true;
	}

	syncFromActiveCharacter () {
		const visibility = this._getHubRollVisibility();
		if (this._hubVisibilitySelect) this._hubVisibilitySelect.value = visibility;
		return visibility;
	}

	/**
	 * Clear all roll history.
	 */
	clear () {
		if (this._isCampaign()) return false;
		this._rolls = [];
		this._unreadCount = 0;
		this._updateBadge();
		this._renderList();
	}

	resetCharacterScopeUi () {
		this._hubGeneration++;
		this._hubReadAbort?.abort();
		this._hubScope = null;
		this._hubStorageKey = null;
		this._isHubConnected = false;
		this._isHubLoading = false;
		this._isHubAuthorityInvalid = false;
		this._isHubAuthorityRefreshRequired = false;
		this._hubHistoryError = "";
		this._hubRecoveryError = "";
		this._pendingHubRolls.clear();
		this._hubEvents.clear();
		this._hubLocalRolls = [];
		this._isOpen = false;
		this._rolls = [];
		this._unreadCount = 0;
		this._panelEl?.classList.remove("charsheet__roll-history--open");
		if (this._panelEl) this._panelEl.inert = true;
		this._updateBadge();
		this._renderList();
	}

	/**
	 * Toggle the side panel open/closed.
	 */
	toggle () {
		this._isOpen = !this._isOpen;
		if (this._panelEl) {
			this._panelEl.classList.toggle("charsheet__roll-history--open", this._isOpen);
			if (!this._isOpen && this._panelEl.contains(document.activeElement)) document.getElementById("charsheet-btn-rolllog")?.focus();
			this._panelEl.inert = !this._isOpen;
		}
		// Opening the log means the user has seen the rolls — clear the unread badge.
		if (this._isOpen) {
			this._unreadCount = 0;
			if (this._listEl) this._renderList();
		}
		this._updateBadge();
	}

	/**
	 * Build the side panel DOM (appended to body once).
	 */
	_buildPanel () {
		// Panel
		const panel = e_({tag: "div", clazz: "charsheet__roll-history"});
		panel.setAttribute("role", "region");
		panel.setAttribute("aria-label", "Roll History");
		panel.addEventListener("keydown", event => {
			if (event.key !== "Escape" || !this._isOpen) return;
			event.preventDefault();
			event.stopPropagation();
			this.toggle();
		});

		// Header
		const header = e_({tag: "div", clazz: "charsheet__roll-history-header"});
		header.innerHTML = `<span class="charsheet__roll-history-title">📜 Roll History</span>`;

		const controls = e_({tag: "div", clazz: "charsheet__roll-history-controls"});

		const btnClear = e_({tag: "button", clazz: "charsheet__roll-history-btn", title: "Clear all", txt: "🗑️"});
		btnClear.type = "button";
		btnClear.addEventListener("click", () => this.clear());

		const btnClose = e_({tag: "button", clazz: "charsheet__roll-history-btn", title: "Close", txt: "✕"});
		btnClose.type = "button";
		btnClose.setAttribute("aria-label", "Close Roll History");
		btnClose.addEventListener("click", () => this.toggle());

		if (!this._isCampaign()) controls.append(btnClear);
		if (this._isCampaign()) {
			const btnRefresh = e_({tag: "button", clazz: "charsheet__roll-history-btn", txt: "Refresh", title: "Refresh server Roll History"});
			btnRefresh.type = "button";
			btnRefresh.addEventListener("click", () => { void this.pRefreshHubHistory(); });
			this._hubRefreshButton = btnRefresh;
			controls.append(btnRefresh);
		}
		controls.append(btnClose);
		header.append(controls);

		const visibility = this._isCampaign() ? this._buildHubVisibilityControl() : null;
		this._hubVisibilityRoot = visibility;

		// Scrollable list
		const list = e_({tag: "div", clazz: "charsheet__roll-history-list"});
		this._listEl = list;

		panel.append(header);
		if (visibility) panel.append(visibility);
		if (this._isCampaign()) {
			this._hubRetentionRoot = e_({tag: "p", clazz: "charsheet__roll-history-retention", txt: "Your latest 200 authorized rolls are retained on the server and shared across your devices. Outstanding sends appear separately; server history cannot be cleared here."});
			panel.append(this._hubRetentionRoot);
		}
		panel.append(list);

		this._panelEl = e_({tag: "div", clazz: "charsheet__roll-history-wrapper"});
		this._panelEl.inert = true;
		this._panelEl.append(panel);

		document.body.append(this._panelEl);

		this._renderList();
	}

	_buildHubVisibilityControl () {
		const root = e_({tag: "div", clazz: "charsheet__roll-history-visibility"});
		const label = e_({tag: "label", clazz: "charsheet__roll-history-visibility-label"});
		label.setAttribute("for", "charsheet-roll-history-visibility");
		label.textContent = "Share new campaign rolls with";
		const select = e_({tag: "select", clazz: "charsheet__roll-history-visibility-select"});
		select.id = "charsheet-roll-history-visibility";
		select.setAttribute("aria-describedby", "charsheet-roll-history-visibility-hint");
		for (const choice of HUB_ROLL_VISIBILITY_CHOICES) {
			const option = e_({tag: "option", txt: choice.label});
			option.value = choice.value;
			select.append(option);
		}
		this._hubVisibilitySelect = select;
		this.syncFromActiveCharacter();
		select.addEventListener("change", () => {
			if (this._setHubRollVisibility(select.value)) return;
			select.value = this._getHubRollVisibility();
		});
		const hint = e_({
			tag: "span",
			clazz: "charsheet__roll-history-visibility-hint",
			txt: "DMs includes co-DMs. This affects future rolls only.",
		});
		hint.id = "charsheet-roll-history-visibility-hint";
		root.append(label, select, hint);
		return root;
	}

	/**
	 * Re-render the roll list.
	 */
	_renderList () {
		if (!this._listEl) return;
		const active = document.activeElement;
		const focusedCommandId = this._listEl.contains(active) ? active.closest("[data-roll-command-id]")?.dataset.rollCommandId : null;
		this._listEl.innerHTML = "";
		if (this._hubVisibilityRoot) this._hubVisibilityRoot.hidden = this._page?.isCurrentCharacterReadOnly?.() === true;
		if (this._hubRetentionRoot) this._hubRetentionRoot.hidden = this._page?.isCurrentCharacterReadOnly?.() === true;
		if (this._hubVisibilitySelect) this._hubVisibilitySelect.disabled = !this._hubScope || !this._isHubConnected;
		if (this._hubRefreshButton) this._hubRefreshButton.disabled = !this._hubScope || this._isHubLoading;
		const message = this._hubRecoveryError || this._hubHistoryError || (this._isHubLoading ? "Loading your server Roll History..." : "");
		if (message) {
			const status = e_({tag: "p", clazz: "charsheet__roll-history-status", txt: message});
			status.setAttribute("role", this._hubHistoryError || this._hubRecoveryError ? "alert" : "status");
			this._listEl.append(status);
		}

		if (this._rolls.length === 0) {
			if (!message) this._listEl.append(e_({tag: "div", clazz: "charsheet__roll-history-empty", txt: "No rolls yet — make a roll to see it here"}));
			return;
		}

		for (const roll of this._rolls) {
			this._listEl.append(this._buildRollEntry(roll));
		}
		if (focusedCommandId) {
			const entry = [...this._listEl.querySelectorAll("[data-roll-command-id]")].find(element => element.dataset.rollCommandId === focusedCommandId);
			if (entry) (entry.querySelector("button") || entry).focus({preventScroll: true});
			else this._hubRefreshButton?.focus({preventScroll: true});
		}
	}

	/**
	 * Build a single roll entry element.
	 */
	_buildRollEntry (roll) {
		const typeInfo = CharacterSheetRollHistory.ROLL_TYPES[roll.rollType] || CharacterSheetRollHistory.ROLL_TYPES.OTHER;

		const isCrit = roll.resultClass?.includes("text-success") || roll.resultNote?.toLowerCase().includes("critical hit");
		const isFumble = roll.resultClass?.includes("text-danger") || roll.resultNote?.toLowerCase().includes("critical miss");

		let highlightClass = "";
		if (isCrit) highlightClass = " charsheet__roll-history-entry--crit";
		if (isFumble) highlightClass = " charsheet__roll-history-entry--fumble";

		const noteHtml = roll.resultNote ? `<div class="charsheet__roll-history-entry-note">${this._escapeHtml(roll.resultNote)}</div>` : "";
		const breakdownText = this._stripHtml(roll.breakdown);

		const entry = e_({outer: `
			<div class="charsheet__roll-history-entry${highlightClass}" style="--roll-color: ${typeInfo.color}">
				<div class="charsheet__roll-history-entry-header">
					<span class="charsheet__roll-history-entry-type">${typeInfo.label}</span>
					<span class="charsheet__roll-history-entry-time">${this._formatTimestamp(roll.timestamp)}</span>
				</div>
				<div class="charsheet__roll-history-entry-body">
					<span class="charsheet__roll-history-entry-title">${this._escapeHtml(roll.title)}</span>
					<span class="charsheet__roll-history-entry-total">${this._escapeHtml(`${roll.total}`)}</span>
				</div>
				${breakdownText ? `<div class="charsheet__roll-history-entry-breakdown">${this._escapeHtml(breakdownText)}</div>` : ""}
				${noteHtml}
			</div>
		`});
		if (roll.syncState) {
			const labels = {synced: "Synced", sending: "Sending...", checking: "Checking server history...", unsynced: "Unsynced — only on this device", unconfirmed: "Outcome unconfirmed"};
			entry.dataset.rollSyncState = roll.syncState;
			if (roll.eventId) entry.dataset.rollEventId = roll.eventId;
			if (roll.commandId) {
				entry.dataset.rollCommandId = roll.commandId;
				entry.tabIndex = -1;
			}
			const status = e_({tag: "div", clazz: "charsheet__roll-history-sync", txt: labels[roll.syncState]});
			status.setAttribute("role", "status");
			entry.append(status);
			if (roll.syncError) entry.append(e_({tag: "p", clazz: "charsheet__roll-history-sync-error", txt: roll.syncError}));
			if (roll.commandId && roll.syncState === "unconfirmed") {
				const retry = e_({tag: "button", clazz: "charsheet__roll-history-btn", txt: "Check history / Retry"});
				retry.type = "button";
				retry.disabled = this._isHubAuthorityInvalid === true;
				retry.addEventListener("click", () => { void this.pRetryHubRoll(roll.commandId); });
				entry.append(retry);
			}
		}
		return entry;
	}

	/**
	 * Update the badge count on the toggle button.
	 */
	_updateBadge () {
		if (typeof document === "undefined") return;
		document.getElementById("charsheet-btn-rolllog")?.setAttribute("aria-expanded", String(this._isOpen));
		const badge = document.getElementById("charsheet-rolllog-badge");
		if (!badge) return;
		if (this._unreadCount > 0) {
			badge.textContent = String(this._unreadCount);
			badge.style.display = "";
		} else {
			badge.style.display = "none";
		}
	}

	/**
	 * Format a timestamp as relative time (e.g. "2m ago", "just now").
	 */
	_formatTimestamp (ts) {
		return CharacterSheetRollHistory.formatRelativeTime(ts);
	}

	/**
	 * Static helper for formatting relative time.
	 */
	static formatRelativeTime (ts) {
		const diff = Date.now() - ts;
		if (diff < 10_000) return "just now";
		if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	/**
	 * Escape HTML to prevent XSS.
	 */
	_escapeHtml (str) {
		if (!str) return "";
		return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/**
	 * Strip HTML tags for plain-text display.
	 */
	_stripHtml (str) {
		if (!str) return "";
		return str.replace(/<[^>]*>/g, "");
	}
}

globalThis.CharacterSheetRollHistory = CharacterSheetRollHistory;
