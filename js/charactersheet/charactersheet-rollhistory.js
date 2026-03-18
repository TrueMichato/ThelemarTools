/**
 * Character Sheet Roll History
 * In-memory log of all dice rolls, displayed in a sliding side panel.
 * Session-only — not persisted; lost on page reload.
 */
export class CharacterSheetRollHistory {
	static MAX_ROLLS = 200;

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

	constructor (page) {
		this._page = page;
		this._rolls = [];
		this._panelEl = null;
		this._listEl = null;
		this._isOpen = false;
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
		const rollType = this._deriveRollType(title);

		this._rolls.unshift({
			timestamp: Date.now(),
			title,
			total,
			breakdown,
			resultClass,
			resultNote,
			rollType,
		});

		if (this._rolls.length > CharacterSheetRollHistory.MAX_ROLLS) {
			this._rolls.length = CharacterSheetRollHistory.MAX_ROLLS;
		}

		this._updateBadge();

		if (this._isOpen) {
			this._renderList();
		}
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

	/**
	 * Clear all roll history.
	 */
	clear () {
		this._rolls = [];
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
		}
		if (this._isOpen && this._listEl) {
			this._renderList();
		}
	}

	/**
	 * Build the side panel DOM (appended to body once).
	 */
	_buildPanel () {
		// Panel
		const panel = e_({tag: "div", clazz: "charsheet__roll-history"});

		// Header
		const header = e_({tag: "div", clazz: "charsheet__roll-history-header"});
		header.innerHTML = `<span class="charsheet__roll-history-title">📜 Roll History</span>`;

		const controls = e_({tag: "div", clazz: "charsheet__roll-history-controls"});

		const btnClear = e_({tag: "button", clazz: "charsheet__roll-history-btn", title: "Clear all", txt: "🗑️"});
		btnClear.addEventListener("click", () => this.clear());

		const btnClose = e_({tag: "button", clazz: "charsheet__roll-history-btn", title: "Close", txt: "✕"});
		btnClose.addEventListener("click", () => this.toggle());

		controls.append(btnClear, btnClose);
		header.append(controls);

		// Scrollable list
		const list = e_({tag: "div", clazz: "charsheet__roll-history-list"});
		this._listEl = list;

		panel.append(header, list);

		this._panelEl = e_({tag: "div", clazz: "charsheet__roll-history-wrapper"});
		this._panelEl.append(panel);

		document.body.append(this._panelEl);

		this._renderList();
	}

	/**
	 * Re-render the roll list.
	 */
	_renderList () {
		if (!this._listEl) return;
		this._listEl.innerHTML = "";

		if (this._rolls.length === 0) {
			this._listEl.innerHTML = `<div class="charsheet__roll-history-empty">No rolls yet — make a roll to see it here</div>`;
			return;
		}

		for (const roll of this._rolls) {
			this._listEl.append(this._buildRollEntry(roll));
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
					<span class="charsheet__roll-history-entry-total">${roll.total}</span>
				</div>
				${breakdownText ? `<div class="charsheet__roll-history-entry-breakdown">${this._escapeHtml(breakdownText)}</div>` : ""}
				${noteHtml}
			</div>
		`});

		return entry;
	}

	/**
	 * Update the badge count on the toggle button.
	 */
	_updateBadge () {
		if (typeof document === "undefined") return;
		const badge = document.getElementById("charsheet-rolllog-badge");
		if (!badge) return;
		if (this._rolls.length > 0) {
			badge.textContent = this._rolls.length;
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
