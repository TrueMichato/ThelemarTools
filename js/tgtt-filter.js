"use strict";

/**
 * TGTT (Traveler's Guide to Thelemar) Filter System
 *
 * Provides:
 * - Priority filtering to prefer TGTT homebrew over official sources when duplicates exist
 * - Spell rarity/legality system for Thelemar campaign setting
 * - Draggable toggle button for enabling/disabling the filter
 */

class TgttFilter {
	static PRIORITY_SOURCE = "TGTT";
	static ICON_PATH = "thelemar_symbol_wip_2_icon.ico";
	static STORAGE_KEY = "tgttFilterState";
	static POSITION_STORAGE_KEY = "tgttFilterButtonPosition";

	// Official sources that have "common" rarity
	static OFFICIAL_SOURCES = new Set([
		"PHB", "PHB'14", "DMG", "MM", "CoS", "EEPC", "EET", "HotDQ", "LMoP", "OotA", "PotA", "RoT", "RoTOS",
		"SCAG", "SKT", "ToA", "TLK", "ToD", "TTP", "TftYP", "TftYP-AtG", "TftYP-DiT", "TftYP-TFoF", "TftYP-THSoT",
		"TftYP-TSC", "TftYP-ToH", "TftYP-WPM", "VGM", "XGE", "OGA", "MTF", "WDH", "WDMM", "GGR", "KKW", "LLK",
		"AZfyT", "GoS", "AI", "OoW", "ESK", "DIP", "HftT", "DC", "SLW", "SDW", "BGDIA", "LR", "AL", "SAC", "ERLW",
		"EFR", "RMBRE", "RMR", "MFF", "AWM", "IMR", "SADS", "EGW", "ToR", "DD", "FS", "US", "MOT", "IDRotF", "TCE",
		"VRGR", "HoL", "RtG", "AitFR", "AitFR-ISF", "AitFR-THP", "AitFR-AVT", "AitFR-DN", "AitFR-FCD", "WBtW",
		"DoD", "MaBJoV", "FTD", "SCC", "SCC-CK", "SCC-HfMT", "SCC-TMM", "SCC-ARiR", "MPMM", "CRCotN", "JttRC",
		"SAiS", "AAG", "BAM", "LoX", "DoSI", "DSotDQ", "KftGV", "BGG", "TDCSR", "PaBTSO", "PAitM", "SatO",
		"ToFW", "MPP", "BMT", "DMTCRG", "QftIS", "VEoR", "XPHB", "XDMG", "XMM", "DrDe", "DrDe-DaS",
		"DrDe-BD", "DrDe-TWoO", "DrDe-FWtVC", "DrDe-TDoN", "DrDe-TFV", "DrDe-BtS", "DrDe-SD", "DrDe-ACfaS",
		"DrDe-DotSC", "HotB", "WttHC", "FRAiF", "FRHoF", "ABH", "NF", "TD", "Screen", "ScreenWildernessKit",
		"ScreenDungeonKit", "ScreenSpelljammer", "XScreen", "HF", "HFFotM", "HFStCM", "PaF", "HFDoMM", "CM",
		"NRH", "NRH-TCMC", "NRH-AVitW", "NRH-ASS", "NRH-CoI", "NRH-TLT", "NRH-AWoL", "NRH-AT", "MGELFT", "VD",
		"SjA", "HAT-TG", "HAT-LMI", "GotSF", "LK", "CoA", "PiP", "DitLCoT", "VNotEE", "LRDT", "UtHftLH",
		"ScoEE", "HBTD", "BQGT", "PHB'24", "EFA", "TGTT",
	]);

	// Source-specific rarity overrides
	/** @type {Record<string, string>} */
	static SOURCES_RARITY_MAP = {
		"TftS": "common",
		"IllR": "common",
		"VSS:PP": "uncommon",
		"HWCS": "common",
		"BoET": "rare",
		"DoDk": "uncommon",
		"GH:PG'24": "rare",
		"GH:PG'14": "rare",
	};

	constructor () {
		/** @type {Record<string, Record<string, string>>} */
		this._filterState = {
			rarity: {common: "ignore", uncommon: "ignore", rare: "ignore"},
			legality: {legal: "ignore", "illegal-i": "ignore", "illegal-ii": "ignore", "illegal-iii": "ignore", "illegal-iv": "ignore"},
		};
		this._isActive = true;
		/** @type {HTMLButtonElement|null} */
		this._button = null;
		/** @type {HTMLStyleElement|null} */
		this._dynamicStyleSheet = null;
		/** @type {ReturnType<typeof setTimeout>|undefined} */
		this._filterTimeout = undefined;
		this._initialized = false;
	}

	// ==================== Public API ====================

	/**
	 * Initialize the TGTT filter system
	 * @param {Object} opts Options
	 * @param {boolean} opts.enableButton Whether to show the toggle button
	 * @param {boolean} opts.enableSpellFilters Whether to enable spell rarity/legality filters
	 */
	async init (opts = {
		enableButton: false,
		enableSpellFilters: false,
	}) {
		if (this._initialized) return;
		this._initialized = true;

		const {enableButton = true, enableSpellFilters = true} = opts;

		this._loadFilterState();
		this._injectStyles();

		this._initHoverInterceptor();

		if (enableButton) {
			this._createButton();
		}

		this._setupObserver();
		this._filterLists();

		if (enableSpellFilters && this._isSpellsPage()) {
			this._tagListItems();
			this._applyFilterCSS();
		}
	}

	/**
	 * Check if the filter is currently active
	 * @returns {boolean}
	 */
	isActive () {
		return this._isActive;
	}

	/**
	 * Toggle the filter state
	 * @param {boolean} [state] Explicit state to set, or toggle if undefined
	 */
	toggle (state) {
		this._isActive = state ?? !this._isActive;
		document.body.classList.toggle("tgtt-filter-active", this._isActive);

		if (this._button) {
			this._button.classList.toggle("active", this._isActive);
		}

		// Reset hover source overrides so they re-evaluate on next hover
		this._resetHoverSources();

		this._updateButtonText();
	}

	/**
	 * Compute spell metadata (rarity and legality) for a spell entity
	 * @param {any} spell The spell entity
	 * @returns {{rarity: string, legality: string}}
	 */
	static computeSpellMetadata (spell) {
		const sourceAbv = Parser.sourceJsonToAbv(spell.source);
		let rarity = "common";
		let legality = "legal";

		// First check source-based defaults
		if (TgttFilter.SOURCES_RARITY_MAP[sourceAbv]) {
			rarity = TgttFilter.SOURCES_RARITY_MAP[sourceAbv];
		} else if (!TgttFilter.OFFICIAL_SOURCES.has(sourceAbv)) {
			rarity = "uncommon";
		}

		// Check subschools for rarity/legality markers (handles "rarity: X" or "(rarity: X)")
		if (spell.subschools) {
			for (const subschool of spell.subschools) {
				const sub = subschool.toLowerCase();
				const rarityMatch = sub.match(/rarity:\s*([^),\s]+)/i);
				const legalityMatch = sub.match(/legality:\s*([^),\s]+)/i);
				if (rarityMatch) rarity = rarityMatch[1].trim();
				if (legalityMatch) legality = legalityMatch[1].trim();
			}
		}

		// Explicit properties take highest priority
		if (spell.tgttRarity) {
			rarity = spell.tgttRarity.toLowerCase();
		}
		if (spell.tgttLegality) {
			legality = spell.tgttLegality.toLowerCase();
		}

		return {rarity, legality};
	}

	/**
	 * Get the filter state for external use
	 * @returns {Record<string, Record<string, string>>}
	 */
	getFilterState () {
		return JSON.parse(JSON.stringify(this._filterState));
	}

	/**
	 * Set filter state for a specific filter type and key
	 * @param {string} filterType "rarity" or "legality"
	 * @param {string} key The filter key
	 * @param {string} state "yes", "no", or "ignore"
	 */
	setFilterState (filterType, key, state) {
		if (this._filterState[filterType] && this._filterState[filterType][key] !== undefined) {
			this._filterState[filterType][key] = state;
			this._saveFilterState();
			this._applyFilterCSS();
		}
	}

	/**
	 * Reset all filters for a type
	 * @param {string} filterType "rarity" or "legality"
	 */
	resetFilters (filterType) {
		if (this._filterState[filterType]) {
			Object.keys(this._filterState[filterType]).forEach(key => {
				this._filterState[filterType][key] = "ignore";
			});
			this._saveFilterState();
			this._applyFilterCSS();
		}
	}

	// ==================== Private Methods ====================

	_isSpellsPage () {
		return window.location.href.includes("spells.html");
	}

	// ==================== Hover Source Priority ====================

	/**
	 * Monkey-patch Renderer.hover.pHandleLinkMouseOver to prefer TGTT entities.
	 * On first hover of each link, checks if TGTT has the entity and, if so,
	 * rewrites the element's data-vet-* attributes to point to the TGTT version.
	 * Falls back to the original source (or XPHB via existing redirect) when
	 * TGTT does not provide the entity.
	 */
	_initHoverInterceptor () {
		if (typeof Renderer === "undefined" || !Renderer?.hover?.pHandleLinkMouseOver) return;

		const self = this;
		const origFn = Renderer.hover.pHandleLinkMouseOver.bind(Renderer.hover);

		Renderer.hover.pHandleLinkMouseOver = async function (evt, ele, opts) {
			if (self._isActive && !opts?.isSpecifiedLinkData) {
				await self._pTryRewriteToTgtt(ele);
			}
			return origFn(evt, ele, opts);
		};
	}

	/**
	 * For a single link element, check whether TGTT provides the entity and,
	 * if so, rewrite its data-vet-* attributes (and href) to point there.
	 */
	/** @param {HTMLElement} ele */
	async _pTryRewriteToTgtt (ele) {
		// Already checked this element
		if (ele.hasAttribute("data-tgtt-hover-checked")) return;

		const page = ele.getAttribute("data-vet-page");
		const source = ele.getAttribute("data-vet-source");
		const hash = ele.getAttribute("data-vet-hash");

		// Nothing to do if already TGTT, or if the element is a special case
		if (!page || !source || !hash) return;
		if (source.toUpperCase() === TgttFilter.PRIORITY_SOURCE) { ele.setAttribute("data-tgtt-hover-checked", "true"); return; }
		if (ele.hasAttribute("data-vet-preload-id") || ele.hasAttribute("data-vet-is-faux-page")) return;

		ele.setAttribute("data-tgtt-hover-checked", "true");

		// Reconstruct a TGTT hash: hashes are "urlified(name)_urlified(source)"
		const parts = UrlUtil.decodeHash(hash);
		if (parts.length < 2) return;

		const tgttHash = UrlUtil.encodeArrayForHash(parts[0], TgttFilter.PRIORITY_SOURCE);

		try {
			const tgttEntity = await DataLoader.pCacheAndGet(page, TgttFilter.PRIORITY_SOURCE, tgttHash);
			if (!tgttEntity) return; // TGTT doesn't have it — keep original

			// Stash originals for restoration on toggle-off
			ele.setAttribute("data-vet-source-original", source);
			ele.setAttribute("data-vet-hash-original", hash);

			// Rewrite to TGTT
			ele.setAttribute("data-vet-source", TgttFilter.PRIORITY_SOURCE);
			ele.setAttribute("data-vet-hash", tgttHash);

			// Also update href so clicking navigates to the TGTT version
			const href = ele.getAttribute("href");
			if (href) {
				const [pagePart] = href.split("#");
				ele.setAttribute("href", `${pagePart}#${tgttHash}`);
				ele.setAttribute("data-vet-href-original", href);
			}
		} catch { /* Silently fall back to original source */ }
	}

	/**
	 * Restore all hover-overridden elements to their original source/hash.
	 * Called on toggle to reset state.
	 */
	_resetHoverSources () {
		document.querySelectorAll("[data-tgtt-hover-checked]").forEach(ele => {
			const origSource = ele.getAttribute("data-vet-source-original");
			const origHash = ele.getAttribute("data-vet-hash-original");
			const origHref = ele.getAttribute("data-vet-href-original");

			if (origSource) ele.setAttribute("data-vet-source", origSource);
			if (origHash) ele.setAttribute("data-vet-hash", origHash);
			if (origHref) ele.setAttribute("href", origHref);

			ele.removeAttribute("data-tgtt-hover-checked");
			ele.removeAttribute("data-vet-source-original");
			ele.removeAttribute("data-vet-hash-original");
			ele.removeAttribute("data-vet-href-original");
		});
	}

	_loadFilterState () {
		try {
			const saved = /** @type {any} */ (StorageUtil).syncGetForPage(TgttFilter.STORAGE_KEY);
			if (saved) {
				Object.assign(this._filterState.rarity, saved.rarity || {});
				Object.assign(this._filterState.legality, saved.legality || {});
			}
		} catch {
			// Silent fail - state will use defaults
		}
	}

	_saveFilterState () {
		try {
			/** @type {any} */ (StorageUtil).syncSetForPage(TgttFilter.STORAGE_KEY, this._filterState);
		} catch {
			// Silent fail
		}
	}

	_loadButtonPosition () {
		try {
			return /** @type {any} */ (StorageUtil).syncGetForPage(TgttFilter.POSITION_STORAGE_KEY);
		} catch {
			return null;
		}
	}

	/** @param {number} x @param {number} y */
	_saveButtonPosition (x, y) {
		try {
			/** @type {any} */ (StorageUtil).syncSetForPage(TgttFilter.POSITION_STORAGE_KEY, {x, y});
		} catch {
			// Silent fail
		}
	}

	_injectStyles () {
		// Main styles are loaded via CSS file, but we need a dynamic stylesheet for filters
		if (!this._dynamicStyleSheet) {
			this._dynamicStyleSheet = document.createElement("style");
			this._dynamicStyleSheet.id = "tgtt-dynamic-filter-styles";
			document.head.appendChild(this._dynamicStyleSheet);
		}
	}

	_createButton () {
		if (document.getElementById("tgtt-toggle-btn")) return;

		const savedPos = this._loadButtonPosition();
		const defaultTop = window.innerHeight - 60;
		const defaultLeft = 20;

		const btn = document.createElement("button");
		btn.id = "tgtt-toggle-btn";
		btn.className = "tgtt-toggle-btn active";
		btn.style.top = `${savedPos?.y ?? defaultTop}px`;
		btn.style.left = `${savedPos?.x ?? defaultLeft}px`;

		// Icon
		const iconImg = document.createElement("img");
		iconImg.id = "tgtt-btn-icon";
		iconImg.className = "tgtt-btn-icon";
		iconImg.src = TgttFilter.ICON_PATH;
		iconImg.alt = "TGTT";

		// Text
		const textSpan = document.createElement("span");
		textSpan.id = "tgtt-btn-text";
		textSpan.className = "tgtt-btn-text";
		textSpan.textContent = "TGTT Filter: ON";

		btn.appendChild(iconImg);
		btn.appendChild(textSpan);

		// Set initial active state
		document.body.classList.add("tgtt-filter-active");
		this._isActive = true;

		// Drag logic
		let isDragging = false;
		let hasMoved = false;
		let offsetX = 0; let offsetY = 0;

		btn.addEventListener("mousedown", (e) => {
			isDragging = true;
			hasMoved = false;
			offsetX = e.clientX - btn.getBoundingClientRect().left;
			offsetY = e.clientY - btn.getBoundingClientRect().top;
		});

		document.addEventListener("mousemove", (e) => {
			if (!isDragging) return;
			hasMoved = true;

			let newX = e.clientX - offsetX;
			let newY = e.clientY - offsetY;

			// Keep on screen
			newX = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newX));
			newY = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newY));

			btn.style.left = `${newX}px`;
			btn.style.top = `${newY}px`;
		});

		document.addEventListener("mouseup", () => {
			if (isDragging && hasMoved) {
				// Save position
				this._saveButtonPosition(
					parseInt(btn.style.left),
					parseInt(btn.style.top),
				);
			}
			isDragging = false;
		});

		// Click logic
		btn.addEventListener("click", () => {
			if (hasMoved) return;
			this.toggle();
		});

		this._button = btn;
		document.body.appendChild(btn);
	}

	_updateButtonText () {
		const textSpan = document.getElementById("tgtt-btn-text");
		if (!textSpan) return;

		const hiddenCount = document.querySelectorAll(".tgtt-duplicate").length;
		let text = this._isActive ? `TGTT Filter: ON (${hiddenCount})` : "TGTT Filter: OFF";

		// Count active filters
		const activeFilters = [
			...Object.values(this._filterState.rarity),
			...Object.values(this._filterState.legality),
		].filter(s => s !== "ignore").length;

		if (activeFilters > 0) {
			text += ` [${activeFilters} filters]`;
		}

		textSpan.textContent = text;
	}

	_filterLists () {
		const listItems = document.querySelectorAll("a.ve-lst__row-border");
		/** @type {Record<string, Array<{element: Element, source: string}>>} */
		const itemsByName = {};

		listItems.forEach(item => {
			const nameEl = item.querySelector(".ve-bold");
			const sourceEl = item.querySelector("[class*='ve-source__']");

			if (nameEl && sourceEl) {
				const name = nameEl.textContent.trim();
				const source = sourceEl.textContent.trim();

				if (!itemsByName[name]) itemsByName[name] = [];
				itemsByName[name].push({element: item, source});
			}
		});

		Object.keys(itemsByName).forEach(name => {
			const group = itemsByName[name];
			const hasPriority = group.some(entry => entry.source.includes(TgttFilter.PRIORITY_SOURCE));

			if (hasPriority) {
				group.forEach(entry => {
					if (!entry.source.includes(TgttFilter.PRIORITY_SOURCE)) {
						entry.element.classList.add("tgtt-duplicate");
						entry.element.classList.remove("tgtt-winner");
					} else {
						entry.element.classList.remove("tgtt-duplicate");
						entry.element.classList.add("tgtt-winner");
					}
				});
			}
		});

		this._updateButtonText();
	}

	_tagListItems () {
		if (!this._isSpellsPage()) return;

		const listItems = document.querySelectorAll("a.ve-lst__row-border");

		// Try to get the spell data list from the page
		const dataList = globalThis.dbg_page?._dataList || [];

		listItems.forEach(item => {
			if (item.hasAttribute("data-tgtt-rarity")) return;

			const sourceEl = item.querySelector("[class*='ve-source__']");
			const nameEl = item.querySelector(".ve-bold");

			if (sourceEl) {
				const sourceText = sourceEl.textContent.trim();
				const spellName = nameEl?.textContent?.trim();

				// Try to find the spell in the data list to get accurate rarity/legality
				let metadata = this._computeMetadataFromSource(sourceText);

				if (spellName && dataList.length > 0) {
					const spell = dataList.find(s => s.name === spellName && Parser.sourceJsonToAbv(s.source) === sourceText);
					if (spell) {
						metadata = this._computeMetadataFromSpell(spell, metadata);
					}
				}

				item.setAttribute("data-tgtt-rarity", metadata.rarity);
				item.setAttribute("data-tgtt-legality", metadata.legality);
			}
		});
	}

	/** @param {any} spell @param {{rarity: string, legality: string}} defaultMetadata */
	_computeMetadataFromSpell (spell, defaultMetadata) {
		let rarity = defaultMetadata.rarity;
		let legality = defaultMetadata.legality;

		// Check subschools for rarity/legality markers (handles "rarity: X" or "(rarity: X)")
		if (spell.subschools) {
			for (const subschool of spell.subschools) {
				const sub = subschool.toLowerCase();
				const rarityMatch = sub.match(/rarity:\s*([^),\s]+)/i);
				const legalityMatch = sub.match(/legality:\s*([^),\s]+)/i);
				if (rarityMatch) rarity = rarityMatch[1].trim();
				if (legalityMatch) legality = legalityMatch[1].trim();
			}
		}

		// Also check if there are explicit tgtt properties
		if (spell.tgttRarity) rarity = spell.tgttRarity.toLowerCase();
		if (spell.tgttLegality) legality = spell.tgttLegality.toLowerCase();

		return {rarity, legality};
	}

	/** @param {string} sourceText */
	_computeMetadataFromSource (sourceText) {
		let rarity = "common";
		let legality = "legal";

		if (TgttFilter.SOURCES_RARITY_MAP[sourceText]) {
			rarity = TgttFilter.SOURCES_RARITY_MAP[sourceText];
		} else if (!TgttFilter.OFFICIAL_SOURCES.has(sourceText)) {
			rarity = "uncommon";
		}

		return {rarity, legality};
	}

	_applyFilterCSS () {
		if (!this._isSpellsPage()) return;
		if (!this._dynamicStyleSheet) return;

		let css = "";

		// Get active (yes) and excluded (no) filters
		const activeRarityFilters = Object.entries(this._filterState.rarity)
			.filter(([_, state]) => state === "yes")
			.map(([key]) => key);

		const excludedRarityFilters = Object.entries(this._filterState.rarity)
			.filter(([_, state]) => state === "no")
			.map(([key]) => key);

		const activeLegalityFilters = Object.entries(this._filterState.legality)
			.filter(([_, state]) => state === "yes")
			.map(([key]) => key);

		const excludedLegalityFilters = Object.entries(this._filterState.legality)
			.filter(([_, state]) => state === "no")
			.map(([key]) => key);

		// If any 'yes' filters are active, hide items that don't match ANY of them (OR logic)
		if (activeRarityFilters.length > 0) {
			const selectors = activeRarityFilters.map(r => `[data-tgtt-rarity="${r}"]`).join(",");
			css += `a.ve-lst__row-border:not(:is(${selectors})) { display: none !important; }\n`;
		}

		// Hide explicitly excluded items
		excludedRarityFilters.forEach(rarity => {
			css += `a.ve-lst__row-border[data-tgtt-rarity="${rarity}"] { display: none !important; }\n`;
		});

		// Same for legality
		if (activeLegalityFilters.length > 0) {
			const selectors = activeLegalityFilters.map(l => `[data-tgtt-legality="${l}"]`).join(",");
			css += `a.ve-lst__row-border:not(:is(${selectors})) { display: none !important; }\n`;
		}

		excludedLegalityFilters.forEach(legality => {
			css += `a.ve-lst__row-border[data-tgtt-legality="${legality}"] { display: none !important; }\n`;
		});

		this._dynamicStyleSheet.textContent = css;
		this._updateButtonText();
	}

	_setupObserver () {
		const observer = new MutationObserver((mutations) => {
			let shouldUpdate = false;
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					shouldUpdate = true;
					break;
				}
			}
			if (shouldUpdate) {
				clearTimeout(this._filterTimeout);
				this._filterTimeout = setTimeout(() => {
					this._filterLists();
					if (this._isSpellsPage()) {
						this._tagListItems();
						this._applyFilterCSS();
					}
				}, 150);
			}
		});

		observer.observe(document.body, {childList: true, subtree: true});
	}
}

// ==================== TGTT Filter UI for Filter Modal ====================

class TgttFilterModalUI {
	/** @param {TgttFilter} tgttFilter */
	constructor (tgttFilter) {
		this._tgttFilter = tgttFilter;
		this._injected = false;
	}

	/**
	 * Initialize the modal UI watcher
	 */
	init () {
		this._watchForFilterModal();
	}

	_watchForFilterModal () {
		const modalObserver = new MutationObserver(() => {
			const isModalOpen = document.body.classList.contains("ve-ui-modal__body-active");
			if (isModalOpen && !this._injected) {
				setTimeout(() => this._injectFilterUI(), 100);
			} else if (!isModalOpen) {
				this._injected = false;
			}
		});

		modalObserver.observe(document.body, {attributes: true, attributeFilter: ["class"]});
	}

	_injectFilterUI () {
		if (!window.location.href.includes("spells.html")) return;
		if (document.querySelector(".tgtt-filter-section")) {
			this._injected = true;
			return;
		}

		const modalScroller = document.querySelector(".ve-ui-modal__scroller");
		if (!modalScroller) return;

		// Create filter sections
		const raritySection = this._createFilterSection("TGTT Rarity", "rarity", [
			{key: "common", label: "Common"},
			{key: "uncommon", label: "Uncommon"},
			{key: "rare", label: "Rare"},
		]);

		const legalitySection = this._createFilterSection("TGTT Legality", "legality", [
			{key: "legal", label: "Legal"},
			{key: "illegal-i", label: "Illegal-I"},
			{key: "illegal-ii", label: "Illegal-II"},
			{key: "illegal-iii", label: "Illegal-III"},
			{key: "illegal-iv", label: "Illegal-IV"},
		]);

		// Find insertion point
		const saveButtons = modalScroller.querySelector(".ve-w-100.ve-flex-vh-center.ve-my-1");
		if (saveButtons) {
			modalScroller.insertBefore(raritySection, saveButtons);
			modalScroller.insertBefore(legalitySection, saveButtons);
		} else {
			modalScroller.appendChild(raritySection);
			modalScroller.appendChild(legalitySection);
		}

		this._updatePillStates();
		this._injected = true;
	}

	/**
	 * @param {string} title
	 * @param {string} filterType
	 * @param {Array<{key: string, label: string}>} options
	 */
	_createFilterSection (title, filterType, options) {
		const filterState = this._tgttFilter.getFilterState();

		const section = document.createElement("div");
		section.className = "tgtt-filter-section";

		section.innerHTML = `
			<div class="ve-fltr__dropdown-divider ve-mb-1"></div>
			<div class="ve-split ve-fltr__h ve-mb-1">
				<div class="ve-fltr__h-text ve-flex-h-center ve-mobile-sm__w-100">
					<span>⚜️ ${title}</span>
				</div>
				<div class="ve-flex-v-center ve-fltr__h-wrp-btns-outer ve-mobile-sm__hidden">
					<div class="ve-btn-group ve-flex-v-center ve-w-100">
						<button class="ve-btn ve-btn-default ve-btn-xs tgtt-reset-btn" data-filter-type="${filterType}">Reset</button>
					</div>
				</div>
			</div>
			<div class="ve-fltr__wrp-pills ve-fltr__container-pills tgtt-pills-container" data-filter-type="${filterType}">
				${options.map(opt => `
					<div class="tgtt-filter-pill" 
						 data-filter-type="${filterType}" 
						 data-filter-key="${opt.key}" 
						 data-state="${filterState[filterType]?.[opt.key] || "ignore"}"
						 title="Click to cycle: Include → Exclude → Ignore">
						${opt.label}
					</div>
				`).join("")}
			</div>
		`;

		// Add click handlers
		section.querySelectorAll(".tgtt-filter-pill").forEach(pill => {
			pill.addEventListener("click", (e) => this._handlePillClick(e));
		});

		section.querySelector(".tgtt-reset-btn")?.addEventListener("click", (e) => this._handleResetClick(e));

		return section;
	}

	/** @param {Event} e */
	_handlePillClick (e) {
		const pill = /** @type {HTMLElement} */ (e.currentTarget);
		const filterType = pill.dataset.filterType;
		const filterKey = pill.dataset.filterKey;
		const currentState = pill.dataset.state;

		// Cycle: ignore -> yes -> no -> ignore
		const nextState = currentState === "ignore" ? "yes"
			: currentState === "yes" ? "no"
				: "ignore";

		pill.dataset.state = nextState;
		if (filterType && filterKey) this._tgttFilter.setFilterState(filterType, filterKey, nextState);
	}

	/** @param {Event} e */
	_handleResetClick (e) {
		const filterType = /** @type {HTMLElement} */ (e.currentTarget).dataset.filterType;
		if (!filterType) return;
		this._tgttFilter.resetFilters(filterType);
		this._updatePillStates();
	}

	_updatePillStates () {
		const filterState = this._tgttFilter.getFilterState();

		document.querySelectorAll(".tgtt-filter-pill").forEach(el => {
			const pill = /** @type {HTMLElement} */ (el);
			const filterType = pill.dataset.filterType;
			const filterKey = pill.dataset.filterKey;
			if (filterType && filterKey && filterState[filterType]?.[filterKey]) {
				pill.dataset.state = filterState[filterType][filterKey];
			}
		});
	}
}

// ==================== Singleton Instance ====================

/** @type {any} */ (globalThis).TgttFilter = TgttFilter;
/** @type {any} */ (globalThis).TgttFilterModalUI = TgttFilterModalUI;

// Auto-initialize if on a supported page
if (typeof window !== "undefined") {
	window.addEventListener("load", () => {
		// Check if TGTT features should be enabled (could check a setting here)
		const tgttFilter = new TgttFilter();
		const tgttFilterUI = new TgttFilterModalUI(tgttFilter);

		tgttFilter.init({
			enableButton: true,
			enableSpellFilters: true,
		});

		tgttFilterUI.init();

		// Expose for debugging
		/** @type {any} */ (globalThis).tgttFilter = tgttFilter;
		/** @type {any} */ (globalThis).tgttFilterUI = tgttFilterUI;
	});
}
