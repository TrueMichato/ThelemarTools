/**
 * Character Sheet Spawner — auto-fill
 *
 * The wizards render every choice a player must make. Rather than re-enumerating
 * those option pools (dozens of bespoke lists, each a chance to drift out of sync
 * with what a player actually sees), the spawner lets the wizard render its real
 * controls and then operates them. Selections therefore run the wizard's own
 * handlers, and the option pool is identical by construction.
 *
 * Four control shapes cover the entire wizard surface:
 *   • checkbox groups, located by their `Selected: <n>/<max>` counter
 *   • `<select>`s still sitting on an empty placeholder
 *   • radio groups with nothing chosen
 *   • spell pickers, which use `+` buttons and a `<n>/<max>` header
 *
 * Anything else is, by definition, not a required choice.
 */

class CharacterSheetSpawnAutoFill {
	/**
	 * @param {{root: *, picker: *, report: *, level?: ?number}} opts
	 */
	constructor ({root, picker, report, level = null}) {
		this._root = root;
		this._picker = picker;
		this._report = report;
		this._level = level;
	}

	/**
	 * Fill every unsatisfied control under the root.
	 *
	 * Runs repeatedly because satisfying one group routinely reveals another
	 * (choose a Primal Order → a bonus cantrip appears; choose a subclass → its
	 * feature options appear), and because most controls re-render their
	 * container on change, invalidating element references mid-pass.
	 *
	 * @param {{maxPasses?: number}} [opts]
	 * @returns {number} how many selections were made
	 */
	async run ({maxPasses = 60} = {}) {
		let total = 0;
		for (let pass = 0; pass < maxPasses; ++pass) {
			const made = this._fillCheckboxGroups()
				+ this._fillButtonGrids()
				+ this._fillOptionLists()
				+ this._fillPointPools()
				+ this._fillSpellPickers()
				+ this._fillSelects()
				+ this._fillRadioGroups()
				+ this._fillAddButtons();
			if (!made) {
				this._reportUnmet();
				return total;
			}
			total += made;
			// Several handlers are async (a "+ Add Spell" button opens a picker the
			// prompt layer answers). Yield so those settle before the next scan reads
			// counters that are still mid-update.
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		this._report.warn(`Auto-fill hit its pass limit (${maxPasses}) — some choices may be unfilled`);
		return total;
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Checkbox groups
	// ═══════════════════════════════════════════════════════════════════════

	static _RE_COUNTER = /Selected:\s*(\d+)\s*(?:\/|of)\s*(\d+)/i;

	/**
	 * The innermost elements whose text is a `Selected: n/max` counter. Restricting
	 * to the innermost match stops an enclosing panel being treated as one big group.
	 * @returns {{el: *, current: number, max: number}[]}
	 */
	_findCounters () {
		/** @type {*[]} */ const out = [];
		for (const el of this._root.querySelectorAll("*")) {
			const m = CharacterSheetSpawnAutoFill._RE_COUNTER.exec(el.textContent || "");
			if (!m) continue;
			if ([...el.children].some(child => CharacterSheetSpawnAutoFill._RE_COUNTER.test(child.textContent || ""))) continue;
			if (this._isHidden(el)) continue;
			out.push({el, current: Number(m[1]), max: Number(m[2])});
		}
		return out;
	}

	/**
	 * Walk up from a counter to the smallest ancestor that contains selectable
	 * checkboxes — the group the counter is counting.
	 * @param {*} counterEl
	 * @returns {?{group: *, boxes: *[]}}
	 */
	_findGroupFor (counterEl) {
		let el = counterEl;
		for (let depth = 0; depth < 8 && el; ++depth) {
			el = el.parentElement;
			if (!el || el === this._root.parentElement) break;
			const boxes = [...el.querySelectorAll("input[type='checkbox']")].filter(cb => !cb.disabled && !cb.checked);
			if (boxes.length) return {group: el, boxes};
		}
		return null;
	}

	_fillCheckboxGroups () {
		for (const {el, current, max} of this._findCounters()) {
			if (current >= max) continue;

			const found = this._findGroupFor(el);
			if (!found) continue; // No checkboxes — `_fillAddButtons` covers picker-backed groups.

			const picked = this._picker.pickMany({
				bucket: "options",
				kind: "option",
				key: CharacterSheetSpawnAutoFill._groupLabel(found.group, el),
				level: this._level,
				count: max - current,
				options: found.boxes.map(cb => ({cb, name: CharacterSheetSpawnAutoFill._labelOf(cb)})),
				nameOf: (/** @type {*} */ c) => c.name,
			});
			if (!picked.length) continue;

			for (const {cb} of picked) {
				if (cb.checked || cb.disabled || !cb.isConnected) continue;
				cb.click();
			}
			// Clicking may have re-rendered the group; hand control back to `run`.
			return picked.length;
		}
		return 0;
	}

	/**
	 * Called once the passes stop making progress. Anything still short of its
	 * quota is a genuine gap in the spawner's coverage — flagging it mid-run would
	 * produce false positives, because a group is routinely unfilled on the pass
	 * before the one that fills it.
	 */
	_reportUnmet () {
		for (const {el, current, max} of this._findCounters()) {
			if (current >= max) continue;
			this._report.markUnresolved(`"${CharacterSheetSpawnAutoFill._describe(el)}" needs ${max - current} more selection(s) but offers none`);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Toggle-button grids and picker-backed groups
	// ═══════════════════════════════════════════════════════════════════════

	static _RE_CHOOSE = /choose\s+(\d+)\s+/i;
	// A feat's fixed ability bump renders as "Choose ability to increase by 1:" — a
	// `Choose …` label with NO leading count, so `_RE_CHOOSE` (which demands
	// `choose <digits>`) misses it entirely. That left the ability button unclicked
	// and stalled the ASI step on every 2024 origin/half-feat (Crusher, Slasher,
	// Poisoner, Observant, …), which each grant a mandatory +1. This is scoped tightly
	// to *ability* grids: skill/tool/language sub-choices have their own dedicated
	// picker buckets and must NOT be intercepted here, or their overrides get
	// autofilled out from under them. Such a control is always a single pick; the
	// ability-priority ordering inside `pickMany` then lands the +1 on the most useful
	// score for the class rather than whichever button happens to be first.
	static _RE_CHOOSE_ABILITY = /choose\s+(?:an?\s+)?abilit(?:y|ies)\b/i;

	/**
	 * Feat sub-choices (tools, skills, languages, a fixed ability bump) render as a
	 * grid of toggle buttons — selected ones carry `ve-btn-primary` — under a
	 * `Choose N …:` label. There is no checkbox and no `Selected: n/max` counter to
	 * key off, so the label supplies the count (ability-bump labels omit it and are
	 * always a single pick).
	 */
	_fillButtonGrids () {
		for (const label of this._root.querySelectorAll("label")) {
			const labelTxt = label.textContent || "";
			const m = CharacterSheetSpawnAutoFill._RE_CHOOSE.exec(labelTxt);
			const wantCount = m
				? Number(m[1])
				: (CharacterSheetSpawnAutoFill._RE_CHOOSE_ABILITY.test(labelTxt) ? 1 : null);
			if (wantCount == null || this._isHidden(label)) continue;

			const section = label.parentElement;
			if (!section) continue;

			const buttons = [...section.querySelectorAll("button.ve-btn")]
				.filter(b => !b.disabled && !(b.textContent || "").trim().startsWith("+"));
			if (!buttons.length) continue;

			const selected = buttons.filter(b => b.classList.contains("ve-btn-primary"));
			const need = wantCount - selected.length;
			if (need <= 0) continue;

			const available = buttons.filter(b => !b.classList.contains("ve-btn-primary"));
			if (!available.length) continue;

			const picked = this._picker.pickMany({
				bucket: "options",
				kind: "option",
				key: CharacterSheetSpawnAutoFill._firstLine(label.textContent || ""),
				level: this._level,
				count: need,
				options: available,
				nameOf: (/** @type {*} */ b) => CharacterSheetSpawnAutoFill._firstLine(b.textContent || ""),
			});
			if (!picked.length) continue;

			// The grid re-renders on each toggle, so only the first click is safe.
			picked[0].click();
			return 1;
		}
		return 0;
	}

	/**
	 * Some groups have no inline options at all: they show `Selected: n/max` beside
	 * an "+ Add Cantrip" / "+ Add Spell" button that opens a picker modal. Clicking
	 * the button is enough — the spawner's prompt layer answers the modal.
	 */
	_fillAddButtons () {
		for (const {el, current, max} of this._findCounters()) {
			if (current >= max) continue;
			if (this._findGroupFor(el)) continue; // checkbox group; handled elsewhere

			const section = el.parentElement;
			const addBtn = section
				? [...section.querySelectorAll("button")].find(b => !b.disabled && (b.textContent || "").trim().startsWith("+"))
				: null;
			if (!addBtn) continue; // Reported by `_reportUnmet` once no pass can make progress.

			addBtn.click();
			return 1;
		}
		return 0;
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Quick Build option lists
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Quick Build renders every list of things-to-choose as clickable
	 * `.charsheet__quickbuild-option` rows carrying a `selected` class — subclasses,
	 * feats, invocations, weapon masteries, expertise. How many to take comes from
	 * an `N/M` counter badge in the surrounding section; where there is no counter
	 * the list is a single-select and one pick satisfies it.
	 *
	 * Clicks land on the row rather than its checkbox: the row owns the handler,
	 * and clicking a disabled checkbox would do nothing at all.
	 */
	_fillOptionLists () {
		/** @type {Set<*>} */ const lists = new Set();
		for (const opt of this._root.querySelectorAll(".charsheet__quickbuild-option")) {
			if (opt.parentElement && !this._isHidden(opt)) lists.add(opt.parentElement);
		}

		for (const list of lists) {
			const items = CharacterSheetSpawnAutoFill._optionItems(list);
			const selected = items.filter(it => it.classList.contains("selected"));
			const need = CharacterSheetSpawnAutoFill._neededFor(list, selected.length);
			if (need <= 0) continue;

			const available = items.filter(it => !it.classList.contains("selected") && !CharacterSheetSpawnAutoFill._isOptionLocked(it));
			if (!available.length) continue;

			const picked = this._picker.pickMany({
				bucket: "options",
				kind: "option",
				key: CharacterSheetSpawnAutoFill._sectionLabel(list),
				level: this._level,
				count: need,
				options: available.map(el => ({el, name: CharacterSheetSpawnAutoFill._optionName(el)})),
				nameOf: (/** @type {*} */ o) => o.name,
			});
			if (!picked.length) continue;

			// Each click re-renders the list, so re-find the next pick by name.
			for (const {name} of picked) {
				const el = CharacterSheetSpawnAutoFill._optionItems(list)
					.find(it => !it.classList.contains("selected")
						&& !CharacterSheetSpawnAutoFill._isOptionLocked(it)
						&& CharacterSheetSpawnAutoFill._optionName(it) === name);
				el?.click();
			}
			return picked.length;
		}
		return 0;
	}

	/** @param {*} list */
	static _optionItems (list) {
		return [...list.children].filter(el => el.classList?.contains("charsheet__quickbuild-option"));
	}

	/** @param {*} item */
	static _isOptionLocked (item) {
		if (item.querySelector("input:disabled")) return true;
		return /not-allowed/.test(item.getAttribute("style") || "");
	}

	/** @param {*} item */
	static _optionName (item) {
		const named = item.querySelector(".qb-opt-name, strong, b");
		return CharacterSheetSpawnAutoFill._firstLine(named?.textContent || item.textContent || "");
	}

	static _RE_FRACTION = /^(\d+)\s*\/\s*(\d+)$/;

	/**
	 * How many more rows this list wants. An `N/M` badge near the list is
	 * authoritative; without one the list is single-select.
	 *
	 * @param {*} list
	 * @param {number} selectedCount
	 * @returns {number}
	 */
	static _neededFor (list, selectedCount) {
		let el = list;
		for (let depth = 0; depth < 4 && el; ++depth) {
			el = el.parentElement;
			if (!el) break;
			for (const candidate of el.querySelectorAll("span, small, strong, b, div")) {
				const m = CharacterSheetSpawnAutoFill._RE_FRACTION.exec((candidate.textContent || "").trim());
				if (m) return Number(m[2]) - Number(m[1]);
			}
		}
		return selectedCount > 0 ? 0 : 1;
	}

	/** @param {*} list */
	static _sectionLabel (list) {
		let el = list;
		for (let depth = 0; depth < 4 && el; ++depth) {
			el = el.parentElement;
			const heading = el?.querySelector("h4, h5, h6, label");
			if (heading?.textContent?.trim()) return CharacterSheetSpawnAutoFill._firstLine(heading.textContent);
		}
		return "options";
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Point pools (ASI, point buy)
	// ═══════════════════════════════════════════════════════════════════════

	static _RE_POINTS = /points?\s+remaining:\s*(-?\d+)/i;

	/**
	 * Ability-score improvements and point buy spend a pool through `+` buttons
	 * rather than selecting from a list.
	 *
	 * Exactly one point is spent per call: these controls replace their own DOM on
	 * every click, so any element reference held across a click is detached and
	 * every subsequent read is a lie. Returning after one click makes `run` re-scan
	 * from the root, which is always correct.
	 */
	_fillPointPools () {
		for (const {el, remaining} of this._findPointPools()) {
			if (remaining <= 0) continue;
			const pool = this._findPoolContainer(el);
			if (!pool) continue;

			const buttons = CharacterSheetSpawnAutoFill._incrementButtons(pool);
			if (!buttons.length) continue;

			// An ability already at its cap keeps a live, enabled `+` button that simply
			// does nothing. Spending the slot on it would leave the pool unspent and the
			// wizard unable to advance, so verify the counter actually moved and fall
			// through to the next-best ability when it didn't.
			const picked = this._picker.pickOne({
				bucket: "abilities",
				kind: "abilityIncrease",
				key: CharacterSheetSpawnAutoFill._sectionLabel(pool),
				level: this._level,
				options: buttons,
				nameOf: (/** @type {*} */ b) => CharacterSheetSpawnAutoFill._buttonRowName(b),
				attempt: (/** @type {*} */ b) => {
					const before = this._totalPointsRemaining();
					b.click();
					return this._totalPointsRemaining() < before;
				},
			});
			if (!picked) continue;

			return 1;
		}
		return 0;
	}

	/**
	 * Sum of every visible "Points remaining" counter under the root. Compared across a
	 * click to tell a real spend from a no-op; summing sidesteps the fact that clicking
	 * re-renders (and so detaches) the counter element itself.
	 *
	 * @returns {number}
	 */
	_totalPointsRemaining () {
		return this._findPointPools().reduce((total, {remaining}) => total + remaining, 0);
	}

	/** @returns {{el: *, remaining: number}[]} */
	_findPointPools () {
		/** @type {*[]} */ const out = [];
		for (const el of this._root.querySelectorAll("*")) {
			const m = CharacterSheetSpawnAutoFill._RE_POINTS.exec(el.textContent || "");
			if (!m) continue;
			if ([...el.children].some(child => CharacterSheetSpawnAutoFill._RE_POINTS.test(child.textContent || ""))) continue;
			if (this._isHidden(el)) continue;
			out.push({el, remaining: Number(m[1])});
		}
		return out;
	}

	/** @param {*} counterEl */
	_findPoolContainer (counterEl) {
		let el = counterEl;
		for (let depth = 0; depth < 6 && el; ++depth) {
			el = el.parentElement;
			if (!el) break;
			if (CharacterSheetSpawnAutoFill._incrementButtons(el).length) return el;
		}
		return null;
	}

	/** @param {*} container */
	static _incrementButtons (container) {
		return [...container.querySelectorAll("button")]
			.filter(b => !b.disabled && ((b.textContent || "").trim() === "+" || b.dataset?.action === "increase"));
	}

	/**
	 * A control the wizard has explicitly hidden is not a choice the player is being
	 * asked to make — the abilities step, for example, keeps a "Points remaining"
	 * readout in the DOM with `display: none` unless point buy is selected, and
	 * spending those phantom points corrupts the build.
	 *
	 * Deliberately checks inline/attribute hiding rather than `offsetParent`,
	 * because the spawner renders the wizard while its tab is hidden, which would
	 * make every control look invisible.
	 *
	 * @param {*} el
	 * @returns {boolean}
	 */
	_isHidden (el) {
		let cur = el;
		while (cur && cur !== this._root.parentElement) {
			if (cur.hidden) return true;
			const display = cur.style?.display;
			if (display === "none") return true;
			cur = cur.parentElement;
		}
		return false;
	}

	/** @param {*} button */
	static _buttonRowName (button) {
		if (button.dataset?.abl) return button.dataset.abl;
		return CharacterSheetSpawnAutoFill._firstLine(button.parentElement?.textContent || "");
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Spell pickers
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Spell pickers don't use checkboxes — each spell row carries a `+` button, and
	 * progress lives in a header with `<n>/<max>` counters for spells and cantrips
	 * separately. Selections are made by name so the list can re-render between
	 * clicks (it does, on every toggle) without stale element references.
	 */
	_fillSpellPickers () {
		for (const header of this._root.querySelectorAll(".charsheet__spell-picker-header")) {
			const container = CharacterSheetSpawnAutoFill._pickerContainerOf(header);
			if (!container) continue;
			const isSpellbook = /spellbook/i.test(header.textContent || "");

			for (const [prefix, isCantrip] of [["spell", false], ["cantrip", true]]) {
				const cur = Number(header.querySelector(`.${prefix}-count-current`)?.textContent);
				const max = Number(header.querySelector(`.${prefix}-count-max`)?.textContent);
				if (!Number.isFinite(cur) || !Number.isFinite(max) || cur >= max) continue;

				const options = CharacterSheetSpawnAutoFill._availableSpells(container, isCantrip);
				const picked = this._picker.pickMany({
					bucket: isCantrip ? "cantrips" : (isSpellbook ? "spellbook" : "spells"),
					kind: isCantrip ? "cantrip" : (isSpellbook ? "spellbook" : "spell"),
					level: this._level,
					count: max - cur,
					options,
					nameOf: (/** @type {*} */ o) => o.name,
				});
				if (!picked.length) continue;

				for (const {name} of picked) {
					const row = CharacterSheetSpawnAutoFill._availableSpells(container, isCantrip).find(o => o.name === name);
					row?.el?.querySelector(".spell-toggle")?.click();
				}
				return picked.length;
			}
		}
		return 0;
	}

	/**
	 * @param {*} header
	 * @returns {?*} the nearest ancestor that holds the picker's spell rows
	 */
	static _pickerContainerOf (header) {
		let el = header;
		for (let depth = 0; depth < 6 && el; ++depth) {
			el = el.parentElement;
			if (!el) break;
			if (el.querySelector(".charsheet__spell-picker-item")) return el;
		}
		return null;
	}

	/**
	 * @param {*} container
	 * @param {boolean} isCantrip
	 * @returns {{el: *, name: string}[]}
	 */
	static _availableSpells (container, isCantrip) {
		return [...container.querySelectorAll(".charsheet__spell-picker-item")]
			.filter(el => !el.classList.contains("charsheet__spell-picker-item--selected")
				&& !el.classList.contains("charsheet__spell-picker-item--known")
				&& el.querySelector(".spell-toggle"))
			.filter(el => CharacterSheetSpawnAutoFill._isCantripRow(el) === isCantrip)
			.map(el => ({el, name: (el.querySelector(".charsheet__spell-picker-item-name")?.textContent || "").trim()}))
			.filter(o => o.name);
	}

	/** @param {*} rowEl */
	static _isCantripRow (rowEl) {
		const title = rowEl.closest(".charsheet__spell-picker-section")?.querySelector(".charsheet__spell-picker-section-title");
		return /cantrip/i.test(title?.textContent || "");
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Selects and radios
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Distinguishing an unanswered *choice* from a *filter* matters: both sit on an
	 * empty value, but choosing a value in a filter silently narrows the list the
	 * next pass picks from (a spell picker's "All Levels" filter turned into
	 * "Cantrips" makes the remaining spell slots unfillable).
	 *
	 * The reliable signal is the placeholder text: choices say "-- Select --" /
	 * "Choose a…", filters say "All Levels" / "Any source".
	 */
	static _RE_PLACEHOLDER = /^\s*(-{1,2}|—|select\b|choose\b|pick\b)/i;

	_fillSelects () {
		for (const sel of this._root.querySelectorAll("select")) {
			if (sel.disabled || sel.value !== "" || this._isHidden(sel)) continue;

			const placeholder = [...sel.options].find(o => o.value === "");
			if (placeholder && !CharacterSheetSpawnAutoFill._RE_PLACEHOLDER.test(placeholder.textContent || "")) continue;

			const options = [...sel.options].filter(o => o.value !== "" && !o.disabled);
			if (!options.length) continue;

			const picked = this._picker.pickOne({
				bucket: "options",
				kind: "option",
				key: CharacterSheetSpawnAutoFill._selectLabel(sel),
				level: this._level,
				options,
				nameOf: (/** @type {*} */ o) => (o.textContent || "").trim(),
			});
			if (!picked) continue;

			sel.value = picked.value;
			sel.dispatchEvent(new Event("input", {bubbles: true}));
			sel.dispatchEvent(new Event("change", {bubbles: true}));
			return 1;
		}
		return 0;
	}

	_fillRadioGroups () {
		/** @type {Map<string, *[]>} */ const groups = new Map();
		for (const radio of this._root.querySelectorAll("input[type='radio']")) {
			if (radio.disabled || this._isHidden(radio)) continue;
			const key = radio.name || "(unnamed)";
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(radio);
		}

		for (const [name, radios] of groups) {
			if (radios.some(r => r.checked)) continue;
			const picked = this._picker.pickOne({
				bucket: "options",
				kind: "option",
				key: name,
				level: this._level,
				options: radios,
				nameOf: (/** @type {*} */ r) => CharacterSheetSpawnAutoFill._labelOf(r),
			});
			if (!picked) continue;
			picked.click();
			return 1;
		}
		return 0;
	}

	// ═══════════════════════════════════════════════════════════════════════
	//  Labelling — the names spec overrides are matched against
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * The most specific name for a checkbox/radio option. Markup ranges from
	 * `<label><input value="Stealth"> Stealth</label>` to a multi-line card with a
	 * name, source and description, so prefer the explicit value, then a bolded
	 * name, then the first line of text.
	 *
	 * @param {*} input
	 * @returns {string}
	 */
	static _labelOf (input) {
		const val = input.getAttribute("value");
		if (val && val !== "on") return val;

		const wrap = input.closest("label") || input.parentElement;
		if (!wrap) return "";

		const strong = wrap.querySelector("strong, b, .ve-bold, .bold");
		if (strong?.textContent?.trim()) return strong.textContent.trim();

		return CharacterSheetSpawnAutoFill._firstLine(wrap.textContent || "");
	}

	/** @param {*} sel */
	static _selectLabel (sel) {
		if (sel.id) return sel.id;
		const wrap = sel.closest("label") || sel.parentElement;
		const strong = wrap?.querySelector("strong, b, .ve-bold, .bold");
		if (strong?.textContent?.trim()) return strong.textContent.trim();
		// Subtract the select's own option text, which would otherwise swamp the label.
		const own = (sel.textContent || "").trim();
		const text = (wrap?.textContent || "").replace(own, " ");
		return CharacterSheetSpawnAutoFill._firstLine(text) || "select";
	}

	/**
	 * @param {*} group
	 * @param {*} counterEl
	 */
	static _groupLabel (group, counterEl) {
		const heading = group.querySelector("h4, h5, h6, strong, b, .ve-bold");
		if (heading?.textContent?.trim()) return CharacterSheetSpawnAutoFill._firstLine(heading.textContent);
		return CharacterSheetSpawnAutoFill._describe(counterEl);
	}

	/** @param {*} el */
	static _describe (el) {
		return CharacterSheetSpawnAutoFill._firstLine(el.parentElement?.textContent || el.textContent || "");
	}

	/** @param {string} text */
	static _firstLine (text) {
		return String(text).split("\n").map(s => s.trim()).find(Boolean)?.slice(0, 120) || "";
	}
}

export {CharacterSheetSpawnAutoFill};
globalThis.CharacterSheetSpawnAutoFill = CharacterSheetSpawnAutoFill;
