/**
 * Character Sheet — Proficiency Picker
 *
 * A single, self-contained autocomplete widget shared by BOTH proficiency
 * editors (the main-sheet "Edit Proficiencies & Languages" modal and the
 * play-mode "Edit Proficiencies" modal) so the two surfaces behave identically.
 *
 * Historically each surface shipped its own broken editor:
 *  - the main sheet built a dropdown but never actually revealed it (the JS
 *    cleared an inline `display` style that just fell back to the stylesheet's
 *    `display:none` default — the `.open`/visibility class was never toggled), and
 *  - play mode was raw comma-separated free text that wrote straight to
 *    `_state._data.*`, bypassing the state adders' normalization.
 *
 * This component fixes both by owning a keyboard-navigable dropdown (↑/↓/Enter/
 * Esc), a filtered suggestion list, a chip list of current entries, and a strict
 * validity gate (`allowFreeText:false` rejects anything that isn't a known
 * option — used for armor, whose tokens must resolve to light/medium/heavy/
 * shields to satisfy `hasArmorProficiency()`).
 *
 * The filtering / validation / commit logic is pure and DOM-independent so it can
 * be unit-tested in the node test environment; only `render()` and its handlers
 * touch the real DOM.
 */

const {Renderer: RendererProfPicker} = /** @type {*} */ (globalThis);

class CharacterSheetProfPicker {
	/**
	 * @param {object} opts
	 * @param {string} [opts.label] Section label shown above the widget.
	 * @param {string[]} opts.suggestions Raw suggestion values (stored form).
	 * @param {() => Array} opts.getCurrent Returns the current stored entries.
	 * @param {(value: *) => void} opts.adder Adds a stored value to state.
	 * @param {(value: *) => void} opts.remover Removes a single stored value.
	 * @param {(value: *) => void} [opts.removerByToken] Removes every stored variant that
	 *        normalizes to the same token as `value` (preferred when present).
	 * @param {(value: *) => string} [opts.normalize] Canonicalises a value to a comparison
	 *        token (e.g. armor light/medium/heavy/shields). When omitted, values are
	 *        compared by lowercased string.
	 * @param {(value: *) => string} [opts.toDisplay] Maps a stored value to a display label.
	 * @param {(value: *) => *} [opts.toToken] Maps a typed/selected value to the form stored
	 *        in state (e.g. armor label → canonical token).
	 * @param {boolean} [opts.allowFreeText=true] When false, only values that match a known
	 *        suggestion (by normalized token) are accepted; arbitrary typed text is rejected.
	 * @param {string} [opts.placeholder]
	 * @param {number} [opts.limit=10] Max suggestions shown at once.
	 * @param {() => void} [opts.onChange] Invoked after any add/remove mutates state.
	 */
	constructor (opts) {
		this._label = opts.label || "";
		this._suggestions = opts.suggestions || [];
		this._getCurrent = opts.getCurrent;
		this._adder = opts.adder;
		this._remover = opts.remover;
		this._removerByToken = opts.removerByToken || null;
		this._normalize = opts.normalize || null;
		this._toDisplay = opts.toDisplay || ((v) => (typeof v === "string" ? v : (v?.full || v?.name || String(v))));
		this._toToken = opts.toToken || ((v) => v);
		this._allowFreeText = opts.allowFreeText !== false;
		this._placeholder = opts.placeholder || "Type to search…";
		this._limit = opts.limit || 10;
		this._onChange = opts.onChange || (() => {});

		// Keyboard-navigation state (index into the last-rendered suggestion list).
		this._highlightIndex = -1;
		this._lastFiltered = [];

		// DOM handles (populated by render()).
		this._elRoot = null;
		this._elInput = null;
		this._elDropdown = null;
		this._elChips = null;
	}

	// ─── Pure logic (DOM-independent, unit-testable) ─────────────────────────

	/** Comparison key for a value: normalized token when available, else lowercased string. */
	_keyOf (value) {
		if (this._normalize) return this._normalize(value);
		return (typeof value === "string" ? value : (value?.name || String(value))).toLowerCase();
	}

	/** Set of comparison keys for the currently-stored entries. */
	_currentKeys () {
		return new Set((this._getCurrent() || []).map(v => this._keyOf(v)));
	}

	/** Set of comparison keys for the known suggestion options. */
	_suggestionKeys () {
		return new Set(this._suggestions.map(s => this._keyOf(s)));
	}

	/**
	 * Suggestions not already present, matching `query` against the display label,
	 * capped at `limit`.
	 * @param {string} [query]
	 * @returns {Array}
	 */
	getFilteredSuggestions (query = "") {
		const currentKeys = this._currentKeys();
		const q = String(query || "").trim().toLowerCase();
		return this._suggestions.filter(s => {
			if (currentKeys.has(this._keyOf(s))) return false;
			if (!q) return true;
			return String(this._toDisplay(s)).toLowerCase().includes(q);
		}).slice(0, this._limit);
	}

	/**
	 * Whether a typed/selected value may be committed. Empty is always rejected.
	 * With `allowFreeText:false`, the value must normalize to a known suggestion.
	 * @param {*} value
	 * @returns {boolean}
	 */
	isAcceptable (value) {
		const raw = typeof value === "string" ? value.trim() : value;
		if (!raw) return false;
		if (this._allowFreeText) return true;
		return this._suggestionKeys().has(this._keyOf(raw));
	}

	/** Whether the value is already stored (so re-adding is a no-op). */
	isDuplicate (value) {
		return this._currentKeys().has(this._keyOf(value));
	}

	/**
	 * Validate and add a value to state. No-ops (returns false) on invalid input
	 * or when the value (trimmed) is already present.
	 * @param {*} value
	 * @returns {boolean} True when committed.
	 */
	commit (value) {
		const raw = typeof value === "string" ? value.trim() : value;
		if (!this.isAcceptable(raw)) return false;
		if (this.isDuplicate(raw)) return false;
		this._adder(this._toToken(raw));
		this._onChange();
		return true;
	}

	/**
	 * Remove a stored entry, collapsing every variant that normalizes to the same
	 * token when a token-aware remover is available.
	 * @param {*} item
	 */
	removeItem (item) {
		if (this._removerByToken) {
			this._removerByToken(item);
		} else if (this._normalize) {
			const key = this._normalize(item);
			(this._getCurrent() || [])
				.filter(i => this._normalize(i) === key)
				.forEach(variant => this._remover(variant));
		} else {
			this._remover(item);
		}
		this._onChange();
	}

	/** Clamp a highlight index into `[-1, len-1]` (−1 = nothing highlighted). */
	static clampHighlight (index, len) {
		if (len <= 0) return -1;
		if (index < 0) return -1;
		if (index > len - 1) return len - 1;
		return index;
	}

	/**
	 * Move the keyboard highlight through the last-rendered suggestion list,
	 * wrapping at both ends. Returns the new index.
	 * @param {number} dir +1 (down) or −1 (up).
	 * @returns {number}
	 */
	moveHighlight (dir) {
		const len = this._lastFiltered.length;
		if (len <= 0) { this._highlightIndex = -1; return -1; }
		let next = this._highlightIndex + dir;
		if (next < 0) next = len - 1;
		else if (next > len - 1) next = 0;
		this._highlightIndex = next;
		return next;
	}

	// ─── DOM layer (browser only) ────────────────────────────────────────────

	/** Hide the dropdown and reset keyboard/ARIA state. Safe before render(). */
	_closeDropdown () {
		this._highlightIndex = -1;
		if (!this._elDropdown) return;
		this._elDropdown.classList.remove("cs-prof-picker__dropdown--open");
		this._elInput?.setAttribute("aria-expanded", "false");
	}

	/**
	 * Build the widget DOM and wire all interactions. Returns the root element.
	 * @returns {HTMLElement}
	 */
	render () {
		const root = document.createElement("div");
		root.className = "cs-prof-picker";

		if (this._label) {
			const lbl = document.createElement("div");
			lbl.className = "cs-prof-picker__label";
			lbl.textContent = this._label;
			root.appendChild(lbl);
		}

		const chips = document.createElement("div");
		chips.className = "cs-prof-picker__chips";
		root.appendChild(chips);

		const inputWrap = document.createElement("div");
		inputWrap.className = "cs-prof-picker__input-wrap";

		const input = document.createElement("input");
		input.type = "text";
		input.className = "cs-prof-picker__input";
		input.placeholder = this._placeholder;
		input.setAttribute("role", "combobox");
		input.setAttribute("aria-autocomplete", "list");
		input.setAttribute("aria-expanded", "false");
		inputWrap.appendChild(input);

		const addBtn = document.createElement("button");
		addBtn.type = "button";
		addBtn.className = "cs-prof-picker__add";
		addBtn.textContent = "Add";
		inputWrap.appendChild(addBtn);

		const dropdown = document.createElement("div");
		dropdown.className = "cs-prof-picker__dropdown";
		dropdown.setAttribute("role", "listbox");
		inputWrap.appendChild(dropdown);

		root.appendChild(inputWrap);

		this._elRoot = root;
		this._elInput = input;
		this._elDropdown = dropdown;
		this._elChips = chips;

		// ── Handlers ──
		const openDropdown = () => this._renderDropdown(input.value);
		const closeDropdown = () => this._closeDropdown();

		const commitFromInput = () => {
			const ok = this.commit(input.value);
			if (ok) {
				input.value = "";
				closeDropdown();
				this._renderChips();
			} else {
				// Reject invalid free-text (e.g. armor that isn't a known token).
				input.classList.add("cs-prof-picker__input--invalid");
				setTimeout(() => input.classList.remove("cs-prof-picker__input--invalid"), 900);
			}
		};

		input.addEventListener("input", () => { this._highlightIndex = -1; this._renderDropdown(input.value); });
		input.addEventListener("focus", openDropdown);
		// Delay so a click on a suggestion registers before the list is torn down.
		input.addEventListener("blur", () => setTimeout(closeDropdown, 150));
		input.addEventListener("keydown", (e) => {
			switch (e.key) {
				case "ArrowDown": e.preventDefault(); this._renderDropdown(input.value); this.moveHighlight(1); this._paintHighlight(); break;
				case "ArrowUp": e.preventDefault(); this._renderDropdown(input.value); this.moveHighlight(-1); this._paintHighlight(); break;
				case "Enter": {
					e.preventDefault();
					const hi = this._highlightIndex;
					if (hi >= 0 && this._lastFiltered[hi] != null) {
						this.commit(this._lastFiltered[hi]);
						input.value = "";
						closeDropdown();
						this._renderChips();
					} else {
						commitFromInput();
					}
					break;
				}
				case "Escape": closeDropdown(); break;
			}
		});
		addBtn.addEventListener("click", commitFromInput);

		this._renderChips();
		return root;
	}

	/** Re-render the chip list of currently-stored entries. */
	_renderChips () {
		const chips = this._elChips;
		if (!chips) return;
		chips.replaceChildren();

		const current = this._getCurrent() || [];
		if (!current.length) {
			const none = document.createElement("span");
			none.className = "cs-prof-picker__none";
			none.textContent = "None";
			chips.appendChild(none);
			return;
		}

		// Dedupe by comparison key so legacy pollution (e.g. "light" AND "Light Armor")
		// collapses to a single chip; removing it removes every stored variant.
		const seen = new Set();
		current.forEach(item => {
			const key = this._keyOf(item);
			if (seen.has(key)) return;
			seen.add(key);

			const rawName = this._toDisplay(item);
			const displayName = RendererProfPicker?.stripTags
				? RendererProfPicker.stripTags(String(rawName))
				: String(rawName);

			const chip = document.createElement("span");
			chip.className = "cs-prof-picker__chip";
			const txt = document.createElement("span");
			txt.className = "cs-prof-picker__chip-text";
			txt.textContent = displayName;
			chip.appendChild(txt);

			const rm = document.createElement("button");
			rm.type = "button";
			rm.className = "cs-prof-picker__chip-remove";
			rm.setAttribute("aria-label", `Remove ${displayName}`);
			rm.title = "Remove";
			rm.textContent = "×";
			rm.addEventListener("click", () => {
				this.removeItem(item);
				this._renderChips();
			});
			chip.appendChild(rm);
			chips.appendChild(chip);
		});
	}

	/** Re-render the suggestion dropdown filtered by `query` and toggle visibility. */
	_renderDropdown (query = "") {
		const dropdown = this._elDropdown;
		if (!dropdown) return;

		const filtered = this.getFilteredSuggestions(query);
		this._lastFiltered = filtered;
		this._highlightIndex = CharacterSheetProfPicker.clampHighlight(this._highlightIndex, filtered.length);

		dropdown.replaceChildren();
		if (!filtered.length) {
			dropdown.classList.remove("cs-prof-picker__dropdown--open");
			this._elInput?.setAttribute("aria-expanded", "false");
			return;
		}

		filtered.forEach((suggestion, i) => {
			const label = String(this._toDisplay(suggestion));
			const item = document.createElement("div");
			item.className = "cs-prof-picker__option";
			item.setAttribute("role", "option");
			item.dataset.index = String(i);
			item.textContent = label;
			// mousedown (not click) so it fires before the input's blur handler.
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.commit(suggestion);
				if (this._elInput) this._elInput.value = "";
				this._closeDropdown();
				this._renderChips();
			});
			item.addEventListener("mousemove", () => { this._highlightIndex = i; this._paintHighlight(); });
			dropdown.appendChild(item);
		});

		dropdown.classList.add("cs-prof-picker__dropdown--open");
		this._elInput?.setAttribute("aria-expanded", "true");
		this._paintHighlight();
	}

	/** Apply the `--active` class to the highlighted option and scroll it into view. */
	_paintHighlight () {
		const dropdown = this._elDropdown;
		if (!dropdown) return;
		const options = dropdown.querySelectorAll(".cs-prof-picker__option");
		options.forEach((el, i) => {
			if (i === this._highlightIndex) {
				el.classList.add("cs-prof-picker__option--active");
				el.scrollIntoView?.({block: "nearest"});
			} else {
				el.classList.remove("cs-prof-picker__option--active");
			}
		});
	}
}

globalThis.CharacterSheetProfPicker = CharacterSheetProfPicker;

export {CharacterSheetProfPicker};
