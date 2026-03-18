/**
 * Character Sheet Spells Manager
 * Handles spell slots, known spells, prepared spells, and casting
 */
class CharacterSheetSpells {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allSpells = [];
		this._filteredSpells = [];
		this._spellFilter = "";
		this._spellLevelFilter = "all";

		this._init();
	}

	_refreshSorceryPointUI () {
		if (typeof this._page._renderResources === "function") this._page._renderResources();
		if (typeof this._page._renderOverviewMetamagic === "function") this._page._renderOverviewMetamagic();
		if (this._page._combat) this._page._combat.renderCombatMetamagic();
	}

	_init () {
		this._initEventListeners();
	}

	setSpells (spells) {
		this._allSpells = spells;
		this._filteredSpells = spells;
	}

	// ========================================================================
	// Thelemar Spell Rarity/Legality System
	// ========================================================================
	// Override map: Set homebrew sources to a specific rarity
	// Format: { "SourceAbbrev": "uncommon" }
	// Available rarities: common, uncommon, rare, very-rare, legendary
	static HOMEBREW_RARITY_OVERRIDES = {
		// Example: "MyHomebrew": "rare",
		// Add your homebrew sources here with their desired rarity
	};

	/**
	 * Apply Thelemar rarity/legality tags to spells if the setting is enabled
	 * - Official sources: Legal + Common (unless spell has explicit tags)
	 * - Homebrew sources: Legal + Uncommon (unless spell has explicit tags)
	 * - Explicit spell tags always take precedence
	 * @param {Array} spells - Array of spell objects
	 * @returns {Array} Spells with rarity/legality applied
	 */
	_applyThelemarSpellRarity (spells) {
		// Check if the setting is enabled (defaults to true if not explicitly set to false)
		const settings = this._state.getSettings() || {};
		if (settings.thelemar_spellRarity === false) {
			return spells;
		}

		return spells.map(spell => {
			// Check if spell already has rarity or legality tags
			const existingSubschools = spell.subschools || [];
			const hasRarity = existingSubschools.some(s => s.includes("rarity:"));
			const hasLegality = existingSubschools.some(s => s.includes("legality:"));

			// If spell already has both tags, don't modify
			if (hasRarity && hasLegality) {
				return spell;
			}

			// Determine if source is official or homebrew
			const isOfficial = this._isOfficialSource(spell.source);
			const newSubschools = [...existingSubschools];

			// Apply legality if not already present
			if (!hasLegality) {
				newSubschools.push("legality:legal");
			}

			// Apply rarity if not already present
			if (!hasRarity) {
				if (isOfficial) {
					newSubschools.push("rarity:common");
				} else {
					// Check for homebrew-specific rarity override
					const overrideRarity = CharacterSheetSpells.HOMEBREW_RARITY_OVERRIDES[spell.source];
					if (overrideRarity) {
						newSubschools.push(`rarity:${overrideRarity}`);
					} else {
						newSubschools.push("rarity:uncommon");
					}
				}
			}

			// Return modified spell (don't mutate original)
			return {
				...spell,
				subschools: newSubschools,
			};
		});
	}

	/**
	 * Determine if a source is official (WotC published content)
	 * @param {string} source - Source abbreviation
	 * @returns {boolean} True if official source
	 */
	_isOfficialSource (source) {
		// Use SourceUtil if available
		if (typeof SourceUtil !== "undefined") {
			const filterGroup = SourceUtil.getFilterGroup(source);
			// Standard and Partnered are considered official
			return filterGroup === SourceUtil.FILTER_GROUP_STANDARD
				|| filterGroup === SourceUtil.FILTER_GROUP_PARTNERED;
		}

		// Fallback: check against known official sources
		const officialPrefixes = ["PHB", "XGE", "TCE", "FTD", "XPHB", "MM", "DMG", "SCAG", "VGM", "MTF", "GGR", "AI", "EGW", "MOT", "TCE", "FTD", "SCC", "WBtW", "SJA", "DSotDQ", "BGG", "PAitM", "BMT", "MPMoM", "VEoR", "PHB2024", "DMG2024", "MM2024"];
		return officialPrefixes.some(prefix => source === prefix || source.startsWith(prefix + "-"));
	}

	_initEventListeners () {
		// Spell slot pip clicks
		document.addEventListener("click", (e) => {
			const pip = e.target.closest(".charsheet__slot-pip");
			if (!pip) return;
			const level = parseInt(pip.closest("[data-spell-level]").dataset.spellLevel);
			this._toggleSlot(level, pip);
		});

		// Add spell button
		document.addEventListener("click", (e) => {
			if (e.target.closest("#charsheet-btn-add-spell, #charsheet-add-spell")) this._showSpellPicker();
		});

		// Spell filter
		document.addEventListener("input", (e) => {
			if (!e.target.matches("#charsheet-spell-search")) return;
			this._spellFilter = e.target.value.toLowerCase();
			this._renderSpellList();
		});

		// Level filter
		document.addEventListener("change", (e) => {
			if (!e.target.matches("#charsheet-spell-level-filter")) return;
			this._spellLevelFilter = e.target.value;
			this._renderSpellList();
		});

		// Cast spell button
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-cast");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._castSpell(spellId);
		});

		// Cast as ritual button (for unprepared spells in spellbook)
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-cast-ritual");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._castSpellAsRitual(spellId);
		});

		// Remove spell button
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-remove");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._removeSpell(spellId);
		});

		// Toggle prepared
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-prepared");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._togglePrepared(spellId);
		});

		// Spell info button
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-info");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._showSpellInfo(spellId);
		});

		// Spell note button
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".charsheet__spell-note");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			const spell = this._state.getSpells().find(s => (s.id || `${s.name}|${s.source}`) === spellId);
			if (!spell) return;
			const renderFn = () => this._renderSpellList();
			this._page.getNotes()?.showNoteModal(
				"spell",
				spellId,
				spell.name,
				renderFn,
			);
		});

		// Gambler's Folly - manual d100 roll button in toast
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".btn-gambler-table-roll");
			if (!btn) return;
			btn.disabled = true;
			const tableResult = this._state.rollGamblingTable();
			if (tableResult) {
				const result = e_({outer: `<span class="text-info"><br>🎰 <b>d100:</b> ${tableResult.roll}<br>${tableResult.effect}</span>`});
				btn.after(result);
				btn.remove();
			}
		});

		// Open Gambling Table modal (can be triggered from features panel or spell UI)
		document.addEventListener("click", (e) => {
			if (e.target.closest(".btn-open-gambling-table")) this._openGamblingTableModal();
		});
	}

	_toggleSlot (level, pip) {
		const isUsed = pip.classList.contains("used");
		const container = pip.closest("[data-spell-level]");
		const pips = [...container.querySelectorAll(".charsheet__slot-pip")];

		if (isUsed) {
			// Restore a slot (rightmost used pip)
			const usedPips = pips.filter(p => p.classList.contains("used"));
			if (usedPips.length > 0) {
				usedPips[usedPips.length - 1].classList.remove("used");
				const newCurrent = this._state.getSpellSlotsCurrent(level) + 1;
				this._state.setSpellSlots(level, this._state.getSpellSlotsMax(level), newCurrent);
			}
		} else {
			// Use a slot (leftmost available pip)
			const availablePips = pips.filter(p => !p.classList.contains("used"));
			if (availablePips.length > 0) {
				availablePips[0].classList.add("used");
				const newCurrent = this._state.getSpellSlotsCurrent(level) - 1;
				this._state.setSpellSlots(level, this._state.getSpellSlotsMax(level), newCurrent);
			}
		}

		this._page.saveCharacter();
	}

	async _showSpellPicker () {
		const classes = this._state.getClasses();
		if (!classes) {
			JqueryUtil.doToast({type: "warning", content: "Add a class to your character first."});
			return;
		}

		// Get class spell list, filtered by allowed sources
		const characterClass = classes[0];
		const className = characterClass.name;
		const classSource = characterClass.source;
		const filteredSpells = this._page.filterByAllowedSources(this._allSpells);

		// Check if we should include core spell lists for homebrew classes
		const settings = this._state.getSettings?.() || {};
		const includeCoreSpells = settings.includeCoreSpellsForHomebrew !== false; // Default true

		// Determine if this is a non-standard source (homebrew/third-party)
		const isNonStandardSource = classSource && !["PHB", "XPHB", "TCE", "XGE"].includes(classSource);

		const classSpells = filteredSpells.filter(spell => {
			// Use Renderer.spell.getCombinedClasses to get properly merged class data
			const fromClassList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
			if (!fromClassList?.length) return false;

			// Check if spell is on this class's list
			const matchesExact = fromClassList.some(c => c.name.toLowerCase() === className.toLowerCase());
			if (matchesExact) return true;

			// For homebrew/third-party classes: also include spells from the equivalent core class
			// if the setting is enabled
			if (includeCoreSpells && isNonStandardSource) {
				// Check if any PHB/XPHB class with the same name has this spell
				const matchesCore = fromClassList.some(c =>
					c.name.toLowerCase() === className.toLowerCase()
					&& ["PHB", "XPHB"].includes(c.source),
				);
				if (matchesCore) return true;
			}

			return false;
		});

		// Filter by level
		const characterLevel = this._state.getTotalLevel();
		const maxSpellLevel = this._getMaxSpellLevel(classes[0], characterLevel);

		const availableSpells = classSpells
			.filter(spell => spell.level <= maxSpellLevel)
			.sort((a, b) => {
				if (a.level !== b.level) return a.level - b.level;
				return a.name.localeCompare(b.name);
			});

		// Show modal using UiUtil
		await this._pShowSpellPickerModal(availableSpells);
	}

	_getMaxSpellLevel (classInfo, characterLevel) {
		// Full casters
		const fullCasters = ["Bard", "Cleric", "Druid", "Sorcerer", "Wizard"];
		// Half casters
		const halfCasters = ["Paladin", "Ranger", "Artificer"];
		// Third casters
		const thirdCasters = ["Eldritch Knight", "Arcane Trickster"];

		const className = classInfo.name;
		const subclassName = classInfo.subclass?.name;

		// Warlock has special progression - pact magic up to 5th, plus Mystic Arcanum
		if (className === "Warlock") {
			// Mystic Arcanum grants access to higher level spells
			if (characterLevel >= 17) return 9;
			if (characterLevel >= 15) return 8;
			if (characterLevel >= 13) return 7;
			if (characterLevel >= 11) return 6;
			// Pact Magic maxes at 5th level spells at level 9
			if (characterLevel >= 9) return 5;
			if (characterLevel >= 7) return 4;
			if (characterLevel >= 5) return 3;
			if (characterLevel >= 3) return 2;
			if (characterLevel >= 1) return 1;
			return 0;
		}

		let casterLevel = characterLevel;

		if (fullCasters.includes(className)) {
			// Full caster: use full level
		} else if (halfCasters.includes(className)) {
			casterLevel = Math.floor(characterLevel / 2);
		} else if (thirdCasters.includes(subclassName)) {
			casterLevel = Math.floor(characterLevel / 3);
		} else {
			return 0; // Non-caster
		}

		// Convert caster level to max spell level
		if (casterLevel >= 17) return 9;
		if (casterLevel >= 15) return 8;
		if (casterLevel >= 13) return 7;
		if (casterLevel >= 11) return 6;
		if (casterLevel >= 9) return 5;
		if (casterLevel >= 7) return 4;
		if (casterLevel >= 5) return 3;
		if (casterLevel >= 3) return 2;
		if (casterLevel >= 1) return 1;
		return 0;
	}

	async _pShowSpellPickerModal (spells) {
		// Apply Thelemar spell rarity/legality if enabled
		spells = this._applyThelemarSpellRarity(spells);

		const knownSpellIds = this._state.getSpells().map(s => `${s.name}|${s.source}`);

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "✨ Add Spell",
			isMinHeight0: true,
			isWidth100: true,
		});

		// Spell tracking status bar - shows cantrips and spells known/prepared
		const statusBar = e_({tag: "div", clazz: "charsheet__modal-status-bar", style: "display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 12px; background: rgba(var(--rgb-bg-text), 0.05); border-radius: 6px; margin-bottom: 12px; font-size: 0.85em;"});
		modalInner.append(statusBar);

		const updateStatusBar = () => {
			const info = this._state.getSpellcastingInfo();
			if (!info) {
				statusBar.style.display = "none";
				return;
			}

			statusBar.innerHTML = "";

			// Cantrips
			if (info.cantripsKnown) {
				const allCantrips = this._state.getCantripsKnown();
				const count = allCantrips.filter(c => !c.sourceFeature).length;
				const limit = info.cantripsKnown;
				const colorClass = count > limit ? "text-danger" : (count === limit ? "text-success" : "");
				const icon = count > limit ? `<span class="glyphicon glyphicon-alert mr-1"></span>` : "⭐ ";

				statusBar.append(e_({outer: `
					<div style="display: flex; align-items: center; gap: 6px;">
						<span style="color: #2dd4bf;">${icon}Cantrips:</span>
						<span class="bold ${colorClass}">${count}/${limit}</span>
					</div>
				`}));
			}

			// Leveled spells
			const spells = this._state.getSpells();
			const leveledSpells = spells.filter(s => s.level > 0);
			const preparedSpells = leveledSpells.filter(s => s.prepared || s.alwaysPrepared);
			// Count spells that aren't from features (manual selections)
			const manualLeveledSpells = leveledSpells.filter(s => !s.sourceFeature);

			// For multiclass with per-class breakdown, show each class separately
			if (info.isMulticlass && info.byClass?.length > 1) {
				this._renderMulticlassStatusBar(statusBar, info, manualLeveledSpells, preparedSpells);
			} else if (info.type === "known") {
				const currentKnown = manualLeveledSpells.length;
				const maxKnown = info.spellsKnownMax || info.max;
				const colorClass = currentKnown > maxKnown ? "text-danger" : (currentKnown === maxKnown ? "text-success" : "");
				const icon = currentKnown > maxKnown ? `<span class="glyphicon glyphicon-alert mr-1"></span>` : "📖 ";

				statusBar.append(e_({outer: `
					<div style="display: flex; align-items: center; gap: 6px;">
						<span style="color: #60a5fa;">${icon}Spells Known:</span>
						<span class="bold ${colorClass}">${currentKnown}/${maxKnown}</span>
						<span class="ve-muted ve-small" title="Known spells are permanent choices. You can swap one spell when you level up.">(permanent)</span>
					</div>
				`}));
			} else if (info.type === "prepared") {
				const currentPrepared = preparedSpells.length;
				const maxPrepared = info.preparedMax || info.max;
				const colorClass = currentPrepared > maxPrepared ? "text-danger" : (currentPrepared === maxPrepared ? "text-success" : "");
				const icon = currentPrepared > maxPrepared ? `<span class="glyphicon glyphicon-alert mr-1"></span>` : (info.is2024 ? "✨ " : "📚 ");
				const editionLabel = info.is2024 ? "2024" : "2014";

				statusBar.append(e_({outer: `
					<div style="display: flex; align-items: center; gap: 6px;">
						<span style="color: ${info.is2024 ? "#fbbf24" : "#a78bfa"};">${icon}Prepared:</span>
						<span class="bold ${colorClass}">${currentPrepared}/${maxPrepared}</span>
						<span class="ve-muted ve-small" title="Prepared spells can be changed after a long rest.">(${editionLabel} rules)</span>
					</div>
				`}));
			}

			statusBar.style.display = "";
		};
		updateStatusBar();

		// All available schools
		const schools = [...new Set(spells.map(s => s.school).filter(Boolean))].sort();

		// Get priority sources for sorting
		const prioritySources = this._state.getPrioritySources() || [];

		// Unique sources from spells - priority sources first, then official, then alphabetical
		const uniqueSources = [...new Set(spells.map(s => s.source))].sort((a, b) => {
			// Priority sources come first
			const aIsPriority = prioritySources.includes(a);
			const bIsPriority = prioritySources.includes(b);
			if (aIsPriority && !bIsPriority) return -1;
			if (!aIsPriority && bIsPriority) return 1;
			if (aIsPriority && bIsPriority) {
				// Both priority, sort by their order in the priority array
				return prioritySources.indexOf(a) - prioritySources.indexOf(b);
			}

			// Then official sources
			const officialPriority = ["PHB", "XGE", "TCE", "FTD", "XPHB"];
			const aIdx = officialPriority.indexOf(a);
			const bIdx = officialPriority.indexOf(b);
			if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
			if (aIdx !== -1) return -1;
			if (bIdx !== -1) return 1;
			return a.localeCompare(b);
		});

		// Intro text
		modalInner.append(e_({outer: `
			<p class="ve-small ve-muted mb-3">
				Browse and add spells to your character. Click a spell to view details, or click <strong>+ Add</strong> to add it directly.
			</p>
		`}));

		// Build enhanced filter UI - single row with source pushed to right
		const filterRow = e_({tag: "div", clazz: "charsheet__modal-filter-row"});
		modalInner.append(filterRow);

		// Helper function to position dropdown towards center of modal
		const positionDropdown = (dropdown, btn) => {
			const btnRect = btn.getBoundingClientRect();
			const modalRect = modalInner.getBoundingClientRect();
			const btnCenterX = btnRect.left + btnRect.width / 2;
			const modalCenterX = modalRect.left + modalRect.width / 2;

			// If button is to the left of center, open dropdown to the right
			// If button is to the right of center, open dropdown to the left
			if (btnCenterX < modalCenterX) {
				dropdown.classList.add("open-right");
				dropdown.classList.remove("open-left");
			} else {
				dropdown.classList.remove("open-right");
				dropdown.classList.add("open-left");
			}
		};

		// Search input with icon
		const searchWrapper = e_({tag: "div", clazz: "charsheet__modal-search"});
		filterRow.append(searchWrapper);
		const search = e_({tag: "input", attr: {type: "text", placeholder: "🔍 Search spells by name..."}, clazz: "form-control"});
		searchWrapper.append(search);

		// Get all unique classes and subclasses from spells for the filters
		// Use Renderer.spell.getCombinedClasses to get properly merged class/subclass data
		const allSpellClasses = new Set(); // Class names only
		const allSpellSubclasses = new Map(); // Map of "ClassName: SubclassName" -> Set of sources
		spells.forEach(spell => {
			// Get combined class list (includes _tmpClasses populated by Renderer.spell)
			const fromClassList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
			if (fromClassList?.length) {
				fromClassList.forEach(c => {
					allSpellClasses.add(c.name);
				});
			}
			// Get combined subclass list (includes _tmpClasses populated by Renderer.spell)
			const fromSubclass = Renderer.spell.getCombinedClasses(spell, "fromSubclass");
			if (fromSubclass?.length) {
				fromSubclass.forEach(sc => {
					const key = `${sc.class.name}: ${sc.subclass.name}`;
					if (!allSpellSubclasses.has(key)) {
						allSpellSubclasses.set(key, new Set());
					}
					allSpellSubclasses.get(key).add(sc.subclass.source);
				});
			}
		});

		// Get character's classes and subclasses for default filtering
		const characterClasses = this._state.getClasses();
		const characterClassNames = characterClasses.map(c => c.name);
		const characterSubclassNames = characterClasses
			.filter(c => c.subclass)
			.map(c => `${c.name}: ${c.subclass}`);

		// Sort class names - character classes first, then alphabetically
		const sortedClassNames = [...allSpellClasses].sort((a, b) => {
			const aIsChar = characterClassNames.includes(a);
			const bIsChar = characterClassNames.includes(b);
			if (aIsChar && !bIsChar) return -1;
			if (!aIsChar && bIsChar) return 1;
			return a.localeCompare(b);
		});

		// Show ALL subclasses that have spell lists, but highlight player's class's subclasses
		// Sort: player's subclass first, then player's class's other subclasses, then rest alphabetically
		const sortedSubclassNames = [...allSpellSubclasses.keys()].sort((a, b) => {
			const [aClass] = a.split(": ");
			const [bClass] = b.split(": ");
			const aIsCharSubclass = characterSubclassNames.includes(a);
			const bIsCharSubclass = characterSubclassNames.includes(b);
			const aIsCharClass = characterClassNames.includes(aClass);
			const bIsCharClass = characterClassNames.includes(bClass);

			// Player's actual subclass first
			if (aIsCharSubclass && !bIsCharSubclass) return -1;
			if (!aIsCharSubclass && bIsCharSubclass) return 1;
			// Then player's class's other subclasses
			if (aIsCharClass && !bIsCharClass) return -1;
			if (!aIsCharClass && bIsCharClass) return 1;
			// Then alphabetically by class, then subclass
			if (aClass !== bClass) return aClass.localeCompare(bClass);
			const [, aSub] = a.split(": ");
			const [, bSub] = b.split(": ");
			return aSub.localeCompare(bSub);
		});

		// ===== CLASS FILTER =====
		let selectedClasses = new Set(characterClassNames.length > 0 ? characterClassNames : []); // Default to character's classes
		const classDropdown = e_({outer: `
			<div class="charsheet__source-multiselect charsheet__class-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">⚔️</span>
					<span class="charsheet__source-multiselect-text">${characterClassNames.length > 0 ? characterClassNames.join(", ") : "All Classes"}</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown charsheet__class-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">All Classes</button>
						<button class="charsheet__source-action-btn" data-action="myclass">My Classes</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear</button>
					</div>
					<div class="charsheet__source-multiselect-list">
						${sortedClassNames.map(className => {
		const isCharClass = characterClassNames.includes(className);
		const defaultChecked = isCharClass || characterClassNames.length === 0;
		return `
								<label class="charsheet__source-multiselect-item${isCharClass ? " charsheet__source-multiselect-item--highlight" : ""}">
									<input type="checkbox" value="${className}"${defaultChecked ? " checked" : ""}>
									<span class="charsheet__source-multiselect-check">✓</span>
									<span class="charsheet__source-multiselect-label">${className}${isCharClass ? " ★" : ""}</span>
								</label>
							`;
	}).join("")}
					</div>
				</div>
			</div>
		`});
		filterRow.append(classDropdown);

		// Class dropdown behavior
		const classBtn = classDropdown.querySelector(".charsheet__source-multiselect-btn");
		const classDropdownMenu = classDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const classText = classDropdown.querySelector(".charsheet__source-multiselect-text");

		classBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(classDropdownMenu, classBtn);
			classDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			levelDropdownMenu?.classList.remove("open");
			schoolDropdownMenu?.classList.remove("open");
			sourceDropdownMenu?.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
			subclassDropdownMenu?.classList.remove("open");
		});

		const updateClassText = () => {
			const checked = classDropdown.querySelectorAll("input:checked");
			if (checked.length === 0) {
				classText.textContent = "No Classes";
				selectedClasses = new Set(["__NONE__"]);
			} else if (checked.length === sortedClassNames.length) {
				classText.textContent = "All Classes";
				selectedClasses = new Set(); // Empty = all
			} else if (checked.length <= 2) {
				classText.textContent = Array.from(checked).map(el => el.value).join(", ");
				selectedClasses = new Set(Array.from(checked).map(el => el.value));
			} else {
				classText.textContent = `${checked.length} Classes`;
				selectedClasses = new Set(Array.from(checked).map(el => el.value));
			}
			renderList();
		};

		classDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateClassText));
		classDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			classDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateClassText();
		});
		classDropdown.querySelector("[data-action=myclass]").addEventListener("click", () => {
			classDropdown.querySelectorAll("input").forEach(el => {
				const val = el.value;
				const isCharClass = characterClassNames.includes(val);
				el.checked = isCharClass;
			});
			updateClassText();
		});
		classDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			classDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateClassText();
		});

		classDropdownMenu.addEventListener("click", (e) => e.stopPropagation());

		// ===== SUBCLASS FILTER (SEPARATE) =====
		// Calculate which subclasses will be checked by default (same logic as the HTML)
		const defaultCheckedSubclasses = sortedSubclassNames.filter(subclassName => {
			const isCharSubclass = characterSubclassNames.includes(subclassName);
			const [className] = subclassName.split(": ");
			const isCharClass = characterClassNames.includes(className);
			return isCharSubclass || (characterSubclassNames.length === 0 && isCharClass);
		});
		// If all would be checked, use empty set (= all). Otherwise use the specific ones.
		let selectedSubclasses = defaultCheckedSubclasses.length === sortedSubclassNames.length
			? new Set()
			: new Set(defaultCheckedSubclasses.length > 0 ? defaultCheckedSubclasses : ["__NONE__"]);
		const subclassDropdown = sortedSubclassNames.length > 0 ? e_({outer: `
			<div class="charsheet__source-multiselect charsheet__subclass-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">📚</span>
					<span class="charsheet__source-multiselect-text">${
	defaultCheckedSubclasses.length === sortedSubclassNames.length
		? "All Expanded Lists"
		: defaultCheckedSubclasses.length === 0
			? "No Expanded Lists"
			: defaultCheckedSubclasses.length === 1
				? defaultCheckedSubclasses[0].split(": ")[1]
				: `${defaultCheckedSubclasses.length} Expanded Lists`
}</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown charsheet__subclass-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">All Expanded</button>
						<button class="charsheet__source-action-btn" data-action="mysubclass">My Subclass</button>
						<button class="charsheet__source-action-btn" data-action="none">None</button>
					</div>
					<div class="charsheet__source-multiselect-list" style="max-height: 300px;">
						<div class="charsheet__source-multiselect-hint">Subclasses that add extra spells:</div>
						${sortedSubclassNames.map(subclassName => {
		const isCharSubclass = characterSubclassNames.includes(subclassName);
		const [className, subName] = subclassName.split(": ");
		const isCharClass = characterClassNames.includes(className);
		// Default checked: player's actual subclass, or all if player has no subclass
		const defaultChecked = isCharSubclass || (characterSubclassNames.length === 0 && isCharClass);
		return `
								<label class="charsheet__source-multiselect-item${isCharSubclass ? " charsheet__source-multiselect-item--highlight" : isCharClass ? " charsheet__source-multiselect-item--related" : ""}">
									<input type="checkbox" value="${subclassName}"${defaultChecked ? " checked" : ""}>
									<span class="charsheet__source-multiselect-check">✓</span>
									<span class="charsheet__source-multiselect-label">
										<span class="ve-muted">${className}:</span> ${subName}${isCharSubclass ? " ★" : ""}
									</span>
								</label>
							`;
	}).join("")}
					</div>
				</div>
			</div>
		`}) : null;
		if (subclassDropdown) filterRow.append(subclassDropdown);

		// Subclass dropdown behavior
		let subclassDropdownMenu = null;
		const subclassText = subclassDropdown?.querySelector(".charsheet__source-multiselect-text");

		if (subclassDropdown) {
			const subclassBtn = subclassDropdown.querySelector(".charsheet__source-multiselect-btn");
			subclassDropdownMenu = subclassDropdown.querySelector(".charsheet__source-multiselect-dropdown");

			subclassBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				positionDropdown(subclassDropdownMenu, subclassBtn);
				subclassDropdownMenu.classList.toggle("open");
				// Close other dropdowns
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu?.classList.remove("open");
				schoolDropdownMenu?.classList.remove("open");
				sourceDropdownMenu?.classList.remove("open");
				subschoolDropdownMenu?.classList.remove("open");
			});

			const updateSubclassText = () => {
				const checked = subclassDropdown.querySelectorAll("input:checked");
				if (checked.length === 0) {
					subclassText.textContent = "No Expanded Lists";
					selectedSubclasses = new Set(["__NONE__"]);
				} else if (checked.length === sortedSubclassNames.length) {
					subclassText.textContent = "All Expanded Lists";
					selectedSubclasses = new Set(); // Empty = all
				} else if (checked.length === 1) {
					const val = checked[0]?.value;
					const [, subName] = val.split(": ");
					subclassText.textContent = subName;
					selectedSubclasses = new Set(Array.from(checked).map(el => el.value));
				} else {
					subclassText.textContent = `${checked.length} Expanded Lists`;
					selectedSubclasses = new Set(Array.from(checked).map(el => el.value));
				}
				renderList();
			};

			subclassDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateSubclassText));
			subclassDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
				subclassDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
				updateSubclassText();
			});
			subclassDropdown.querySelector("[data-action=mysubclass]").addEventListener("click", () => {
				subclassDropdown.querySelectorAll("input").forEach(el => {
					const val = el.value;
					const isCharSubclass = characterSubclassNames.includes(val);
					el.checked = isCharSubclass;
				});
				updateSubclassText();
			});
			subclassDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
				subclassDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
				updateSubclassText();
			});

			subclassDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
		}

		// Multi-select level filter
		let selectedLevels = new Set(); // Empty = all levels
		const levelOptions = [
			{value: "0", label: "⭐ Cantrips"},
			{value: "1", label: "1️⃣ Level 1"},
			{value: "2", label: "2️⃣ Level 2"},
			{value: "3", label: "3️⃣ Level 3"},
			{value: "4", label: "4️⃣ Level 4"},
			{value: "5", label: "5️⃣ Level 5"},
			{value: "6", label: "6️⃣ Level 6"},
			{value: "7", label: "7️⃣ Level 7"},
			{value: "8", label: "8️⃣ Level 8"},
			{value: "9", label: "9️⃣ Level 9"},
		];

		const levelDropdown = e_({outer: `
			<div class="charsheet__source-multiselect charsheet__level-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">📊</span>
					<span class="charsheet__source-multiselect-text">All Levels</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown charsheet__level-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">Select All</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
					</div>
					<div class="charsheet__source-multiselect-list">
						${levelOptions.map(l => `
							<label class="charsheet__source-multiselect-item">
								<input type="checkbox" value="${l.value}" checked>
								<span class="charsheet__source-multiselect-check">✓</span>
								<span class="charsheet__source-multiselect-label">${l.label}</span>
							</label>
						`).join("")}
					</div>
				</div>
			</div>
		`});
		filterRow.append(levelDropdown);

		// Level dropdown behavior
		const levelBtn = levelDropdown.querySelector(".charsheet__source-multiselect-btn");
		const levelDropdownMenu = levelDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const levelText = levelDropdown.querySelector(".charsheet__source-multiselect-text");

		levelBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(levelDropdownMenu, levelBtn);
			levelDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
		});

		const updateLevelText = () => {
			const checked = levelDropdown.querySelectorAll("input:checked");
			if (checked.length === 0) {
				levelText.textContent = "No Levels";
				selectedLevels = new Set(["__NONE__"]);
			} else if (checked.length === levelOptions.length) {
				levelText.textContent = "All Levels";
				selectedLevels = new Set();
			} else if (checked.length === 1) {
				const val = checked[0]?.value;
				levelText.textContent = val === "0" ? "Cantrips" : `Level ${val}`;
				selectedLevels = new Set(Array.from(checked).map(el => el.value));
			} else {
				levelText.textContent = `${checked.length} Levels`;
				selectedLevels = new Set(Array.from(checked).map(el => el.value));
			}
			renderList();
		};

		levelDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateLevelText));
		levelDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			levelDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateLevelText();
		});
		levelDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			levelDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateLevelText();
		});

		// Multi-select school filter
		let selectedSchools = new Set(); // Empty = all schools
		const schoolDropdown = e_({outer: `
			<div class="charsheet__source-multiselect charsheet__school-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">🎓</span>
					<span class="charsheet__source-multiselect-text">All Schools</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown charsheet__school-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">Select All</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
					</div>
					<div class="charsheet__source-multiselect-list">
						${schools.map(s => `
							<label class="charsheet__source-multiselect-item">
								<input type="checkbox" value="${s}" checked>
								<span class="charsheet__source-multiselect-check">✓</span>
								<span class="charsheet__source-multiselect-label">${this._getSchoolEmoji(s)} ${Parser.spSchoolAbvToFull(s)}</span>
							</label>
						`).join("")}
					</div>
				</div>
			</div>
		`});
		filterRow.append(schoolDropdown);

		// School dropdown behavior
		const schoolBtn = schoolDropdown.querySelector(".charsheet__source-multiselect-btn");
		const schoolDropdownMenu = schoolDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const schoolText = schoolDropdown.querySelector(".charsheet__source-multiselect-text");

		schoolBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(schoolDropdownMenu, schoolBtn);
			schoolDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
		});

		const updateSchoolText = () => {
			const checked = schoolDropdown.querySelectorAll("input:checked");
			if (checked.length === 0) {
				schoolText.textContent = "No Schools";
				selectedSchools = new Set(["__NONE__"]);
			} else if (checked.length === schools.length) {
				schoolText.textContent = "All Schools";
				selectedSchools = new Set();
			} else if (checked.length === 1) {
				schoolText.textContent = Parser.spSchoolAbvToFull(checked[0]?.value);
				selectedSchools = new Set(Array.from(checked).map(el => el.value));
			} else {
				schoolText.textContent = `${checked.length} Schools`;
				selectedSchools = new Set(Array.from(checked).map(el => el.value));
			}
			renderList();
		};

		schoolDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateSchoolText));
		schoolDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			schoolDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateSchoolText();
		});
		schoolDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			schoolDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateSchoolText();
		});

		// Collect unique subschools from spells
		const allSubschools = [...new Set(spells.flatMap(s => s.subschools || []))].sort();

		// Multi-select subschool filter (only show if there are subschools)
		let selectedSubschools = new Set(); // Empty = all (no filter)
		let subschoolDropdown = null;
		let subschoolDropdownMenu = null;

		if (allSubschools.length > 0) {
			// Parse subschool into display name
			const formatSubschool = (sub) => {
				// Subschools are in format "category:value" like "rarity:common" or "legality:illegal-I"
				const parts = sub.split(":");
				if (parts.length === 2) {
					return `${parts[0].toTitleCase()}: ${parts[1].toTitleCase()}`;
				}
				return sub.toTitleCase();
			};

			subschoolDropdown = e_({outer: `
				<div class="charsheet__source-multiselect charsheet__subschool-multiselect">
					<button class="charsheet__source-multiselect-btn">
						<span class="charsheet__source-multiselect-icon">🏷️</span>
						<span class="charsheet__source-multiselect-text">All Tags</span>
						<span class="charsheet__source-multiselect-arrow">▼</span>
					</button>
					<div class="charsheet__source-multiselect-dropdown charsheet__subschool-dropdown">
						<div class="charsheet__source-multiselect-actions">
							<button class="charsheet__source-action-btn" data-action="all">Select All</button>
							<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
						</div>
						<div class="charsheet__source-multiselect-list">
							${allSubschools.map(sub => `
								<label class="charsheet__source-multiselect-item">
									<input type="checkbox" value="${sub}" checked>
									<span class="charsheet__source-multiselect-check">✓</span>
									<span class="charsheet__source-multiselect-label">${formatSubschool(sub)}</span>
								</label>
							`).join("")}
						</div>
					</div>
				</div>
			`});
			filterRow.append(subschoolDropdown);

			subschoolDropdownMenu = subschoolDropdown.querySelector(".charsheet__source-multiselect-dropdown");
			const subschoolBtn = subschoolDropdown.querySelector(".charsheet__source-multiselect-btn");
			const subschoolText = subschoolDropdown.querySelector(".charsheet__source-multiselect-text");

			subschoolBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				positionDropdown(subschoolDropdownMenu, subschoolBtn);
				subschoolDropdownMenu.classList.toggle("open");
				// Close other dropdowns
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu.classList.remove("open");
				schoolDropdownMenu.classList.remove("open");
				sourceDropdownMenu.classList.remove("open");
			});

			const updateSubschoolText = () => {
				const checked = subschoolDropdown.querySelectorAll("input:checked");
				if (checked.length === 0) {
					subschoolText.textContent = "No Tags";
					selectedSubschools = new Set(["__NONE__"]);
				} else if (checked.length === allSubschools.length) {
					subschoolText.textContent = "All Tags";
					selectedSubschools = new Set();
				} else if (checked.length === 1) {
					subschoolText.textContent = formatSubschool(checked[0]?.value);
					selectedSubschools = new Set(Array.from(checked).map(el => el.value));
				} else {
					subschoolText.textContent = `${checked.length} Tags`;
					selectedSubschools = new Set(Array.from(checked).map(el => el.value));
				}
				renderList();
			};

			subschoolDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateSubschoolText));
			subschoolDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
				subschoolDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
				updateSubschoolText();
			});
			subschoolDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
				subschoolDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
				updateSubschoolText();
			});

			subschoolDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
		}

		// Multi-select source filter (positioned on the right)
		let selectedSources = new Set(); // Empty = all sources
		const sourceDropdown = e_({outer: `
			<div class="charsheet__source-multiselect charsheet__source-multiselect--right">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">📖</span>
					<span class="charsheet__source-multiselect-text">All Sources</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">Select All</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
						<button class="charsheet__source-action-btn" data-action="official">Official Only</button>
					</div>
					<div class="charsheet__source-multiselect-list">
						${uniqueSources.map(s => `
							<label class="charsheet__source-multiselect-item">
								<input type="checkbox" value="${s}" checked>
								<span class="charsheet__source-multiselect-check">✓</span>
								<span class="charsheet__source-multiselect-label">${Parser.sourceJsonToAbv(s)}</span>
								<span class="charsheet__source-multiselect-full">${Parser.sourceJsonToFull(s)}</span>
							</label>
						`).join("")}
					</div>
				</div>
			</div>
		`});
		filterRow.append(sourceDropdown);

		// Source dropdown toggle behavior
		const sourceBtn = sourceDropdown.querySelector(".charsheet__source-multiselect-btn");
		const sourceDropdownMenu = sourceDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const sourceText = sourceDropdown.querySelector(".charsheet__source-multiselect-text");

		sourceBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(sourceDropdownMenu, sourceBtn);
			sourceDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
		});

		// Close all dropdowns when clicking outside
		document.addEventListener("click", () => {
			classDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
		});
		sourceDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
		levelDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
		schoolDropdownMenu.addEventListener("click", (e) => e.stopPropagation());

		// Update source text based on selection
		const updateSourceText = () => {
			const checked = sourceDropdown.querySelectorAll("input:checked");
			if (checked.length === 0) {
				sourceText.textContent = "No Sources";
				selectedSources = new Set(["__NONE__"]); // Special marker
			} else if (checked.length === uniqueSources.length) {
				sourceText.textContent = "All Sources";
				selectedSources = new Set(); // Empty = all
			} else if (checked.length <= 2) {
				sourceText.textContent = Array.from(checked).map(el => Parser.sourceJsonToAbv(el.value)).join(", ");
				selectedSources = new Set(Array.from(checked).map(el => el.value));
			} else {
				sourceText.textContent = `${checked.length} Sources`;
				selectedSources = new Set(Array.from(checked).map(el => el.value));
			}
			renderList();
		};

		// Checkbox change handler
		sourceDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateSourceText));

		// Action buttons
		sourceDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			sourceDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateSourceText();
		});
		sourceDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			sourceDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateSourceText();
		});
		sourceDropdown.querySelector("[data-action=official]").addEventListener("click", () => {
			const official = ["PHB", "XGE", "TCE", "FTD", "XPHB", "XDMG"];
			sourceDropdown.querySelectorAll("input").forEach(el => {
				el.checked = official.includes(el.value);
			});
			updateSourceText();
		});

		// Quick filter buttons row
		const quickFilters = e_({outer: `<div class="charsheet__modal-quick-filters"></div>`});
		modalInner.append(quickFilters);

		let filterRitual = false;
		let filterConcentration = false;
		let filterVerbal = false;
		let filterSomatic = false;
		let filterMaterial = false;

		const ritualBtn = e_({outer: `<span class="charsheet__modal-filter-btn" role="button" tabindex="0">🔮 Ritual</span>`});

		quickFilters.append(ritualBtn);
		const concBtn = e_({outer: `<span class="charsheet__modal-filter-btn" role="button" tabindex="0">⏳ Concentration</span>`});
		quickFilters.append(concBtn);
		const verbalBtn = e_({outer: `<span class="charsheet__modal-filter-btn" role="button" tabindex="0">🗣️ Verbal</span>`});
		quickFilters.append(verbalBtn);
		const somaticBtn = e_({outer: `<span class="charsheet__modal-filter-btn" role="button" tabindex="0">✋ Somatic</span>`});
		quickFilters.append(somaticBtn);
		const materialBtn = e_({outer: `<span class="charsheet__modal-filter-btn" role="button" tabindex="0">💎 Material</span>`});
		quickFilters.append(materialBtn);

		// Set up click handlers immediately after creation
		ritualBtn.addEventListener("click", function () {
			filterRitual = !filterRitual;
			this.classList.toggle("active");
			renderList();
		});
		concBtn.addEventListener("click", function () {
			filterConcentration = !filterConcentration;
			this.classList.toggle("active");
			renderList();
		});
		verbalBtn.addEventListener("click", function () {
			filterVerbal = !filterVerbal;
			this.classList.toggle("active");
			renderList();
		});
		somaticBtn.addEventListener("click", function () {
			filterSomatic = !filterSomatic;
			this.classList.toggle("active");
			renderList();
		});
		materialBtn.addEventListener("click", function () {
			filterMaterial = !filterMaterial;
			this.classList.toggle("active");
			renderList();
		});

		// Results count
		const resultsCount = e_({outer: `<div class="charsheet__modal-results-count"></div>`});
		modalInner.append(resultsCount);

		// Spell list
		const list = e_({outer: `<div class="charsheet__modal-list"></div>`});
		modalInner.append(list);

		// Cache getCombinedClasses results per spell to avoid expensive recalculation on every filter
		const _classListCache = new Map();
		const _subclassListCache = new Map();
		const getCachedClassList = (spell) => {
			const key = `${spell.name}|${spell.source}`;
			if (!_classListCache.has(key)) {
				try { _classListCache.set(key, Renderer.spell.getCombinedClasses(spell, "fromClassList") || []); }
				catch (e) { _classListCache.set(key, spell.classes?.fromClassList || []); }
			}
			return _classListCache.get(key);
		};
		const getCachedSubclassList = (spell) => {
			const key = `${spell.name}|${spell.source}`;
			if (!_subclassListCache.has(key)) {
				try { _subclassListCache.set(key, Renderer.spell.getCombinedClasses(spell, "fromSubclass") || []); }
				catch (e) { _subclassListCache.set(key, []); }
			}
			return _subclassListCache.get(key);
		};

		const renderList = () => {
			list.innerHTML = "";

			const searchTerm = search.value.toLowerCase();

			const filtered = spells.filter(spell => {
				if (searchTerm && !spell.name.toLowerCase().includes(searchTerm)) return false;
				// Class filter (separate from subclass)
				if (selectedClasses.has("__NONE__") && selectedSubclasses.has("__NONE__")) return false;

				// Get spell's class and subclass sources using cached getCombinedClasses
				const fromClassList = getCachedClassList(spell);
				const fromSubclass = getCachedSubclassList(spell);
				const spellClasses = fromClassList?.map(c => c.name) || [];
				const spellSubclasses = fromSubclass?.map(sc => `${sc.class.name}: ${sc.subclass.name}`) || [];

				// Check class filter (if classes are selected)
				const passesClassFilter = selectedClasses.size === 0 || spellClasses.some(c => selectedClasses.has(c));
				// Check subclass filter (if subclasses are selected)
				const passesSubclassFilter = selectedSubclasses.size === 0 || spellSubclasses.some(sc => selectedSubclasses.has(sc));

				// Spell passes if it matches EITHER the class filter OR the subclass filter (union)
				if (!passesClassFilter && !passesSubclassFilter) return false;

				// Multi-select level filter
				if (selectedLevels.has("__NONE__")) return false;
				if (selectedLevels.size > 0 && !selectedLevels.has(String(spell.level))) return false;
				// Multi-select school filter
				if (selectedSchools.has("__NONE__")) return false;
				if (selectedSchools.size > 0 && !selectedSchools.has(spell.school)) return false;
				// Multi-select subschool filter
				if (selectedSubschools.has("__NONE__")) return false;
				if (selectedSubschools.size > 0) {
					// Spell must have at least one of the selected subschools
					const spellSubschools = spell.subschools || [];
					if (spellSubschools.length === 0 || !spellSubschools.some(sub => selectedSubschools.has(sub))) return false;
				}
				// Multi-select source filter
				if (selectedSources.has("__NONE__")) return false; // No sources selected
				if (selectedSources.size > 0 && !selectedSources.has(spell.source)) return false;
				// Ritual is stored in spell.meta.ritual
				if (filterRitual && !spell.meta?.ritual) return false;
				// Concentration is stored in spell.duration[].concentration
				if (filterConcentration && !spell.duration?.some?.(d => d.concentration)) return false;
				if (filterVerbal && (!spell.components?.v)) return false;
				if (filterSomatic && (!spell.components?.s)) return false;
				if (filterMaterial && (!spell.components?.m)) return false;
				return true;
			});

			const totalCount = filtered.length;
			const renderCap = 100;
			const capped = filtered.slice(0, renderCap);

			const knownCount = filtered.filter(s => knownSpellIds.includes(`${s.name}|${s.source}`)).length;
			resultsCount.innerHTML = `<span>${totalCount} spell${totalCount !== 1 ? "s" : ""} found</span>${totalCount > renderCap ? `<span class="ml-2" style="opacity: 0.7;">(showing first ${renderCap})</span>` : ""}${knownCount > 0 ? `<span class="ml-2" style="color: var(--cs-success);">(${knownCount} already known)</span>` : ""}`;

			if (!filtered) {
				list.innerHTML = `
					<div class="charsheet__modal-empty">
						<div class="charsheet__modal-empty-icon">📖</div>
						<div class="charsheet__modal-empty-text">No spells match your filters.<br>Try adjusting your search or filters.</div>
					</div>
				`;
				return;
			}

			// Group by level
			const grouped = {};
			capped.forEach(spell => {
				const level = spell.level === 0 ? "Cantrips" : `Level ${spell.level}`;
				if (!grouped[level]) grouped[level] = [];
				grouped[level].push(spell);
			});

			Object.entries(grouped).sort((a, b) => {
				if (a[0] === "Cantrips") return -1;
				if (b[0] === "Cantrips") return 1;
				return parseInt(a[0].split(" ")[1]) - parseInt(b[0].split(" ")[1]);
			}).forEach(([level, levelSpells]) => {
				const section = e_({outer: `<div class="charsheet__modal-section"></div>`});
				list.append(section);
				const levelEmoji = level === "Cantrips" ? "⭐" : ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"][parseInt(level.split(" ")[1]) - 1] || "📜";
				section.append(e_({outer: `<div class="charsheet__modal-section-title">${levelEmoji} ${level} <span style="opacity: 0.6;">(${levelSpells.length})</span></div>`}));

				levelSpells.forEach(spell => {
					const spellId = `${spell.name}|${spell.source}`;
					const isKnown = knownSpellIds.includes(spellId);
					const school = Parser.spSchoolAbvToFull(spell.school);

					// Build component string
					const components = [];
					if (spell.components?.v) components.push("V");
					if (spell.components?.s) components.push("S");
					if (spell.components?.m) components.push("M");
					const componentStr = components.join(", ");

					// Build tags string
					const tagParts = [];
					if (spell.ritual) tagParts.push("🔮");
					if (spell.concentration) tagParts.push("⏳");
					const tagsStr = tagParts.length ? ` ${tagParts.join(" ")}` : "";

					// Build subschool string
					let subschoolStr = "";
					if (spell.subschools && spell.subschools.length > 0) {
						const formatSubschool = (sub) => {
							const parts = sub.split(":");
							if (parts.length === 2) {
								return `${parts[1].toTitleCase()}`;
							}
							return sub.toTitleCase();
						};
						subschoolStr = ` • 🏷️ ${spell.subschools.map(formatSubschool).join(", ")}`;
					}

					const spellLink = this._page?.getHoverLink ? this._page.getHoverLink(UrlUtil.PG_SPELLS, spell.name, spell.source) : spell.name;

					const item = e_({outer: `
						<div class="charsheet__modal-list-item ${isKnown ? "ve-muted" : ""}">
							<div class="charsheet__modal-list-item-icon">${this._getSchoolEmoji(spell.school)}</div>
							<div class="charsheet__modal-list-item-content">
								<div class="charsheet__modal-list-item-title">${spellLink}${tagsStr}</div>
								<div class="charsheet__modal-list-item-subtitle">${school} • ${componentStr || "No components"} • ${Parser.sourceJsonToAbv(spell.source)}${subschoolStr}</div>
							</div>
							${isKnown
		? `<span class="charsheet__modal-list-item-badge charsheet__modal-list-item-badge--known">✓ Known</span>`
		: `<button class="ve-btn ve-btn-primary ve-btn-xs spell-picker-add">+ Add</button>`
}
						</div>
					`});

					if (!isKnown) {
						item.querySelector(".spell-picker-add").addEventListener("click", (e) => {
							e.stopPropagation();
							this._addSpell(spell);
							knownSpellIds.push(spellId);
							item.classList.add("ve-muted");
							{ const _btn = item.querySelector(".spell-picker-add"); const _badge = e_({outer: `<span class="charsheet__modal-list-item-badge charsheet__modal-list-item-badge--known">✓ Known</span>`}); _btn.replaceWith(_badge); }
							JqueryUtil.doToast({type: "success", content: `Added ${spell.name} to your spellbook!`});
							updateStatusBar();
						});

						// Click row to show info
						item.addEventListener("click", () => this._showSpellInfoFromData(spell));
					}

					section.append(item);
				});
			});
		};

		search.addEventListener("input", MiscUtil.debounce(renderList, 150));
		// Level, school, and source filters are handled by checkbox change events above

		// Initial render
		renderList();

		// Focus search on open
		setTimeout(() => search.focus(), 100);

		// Close button
		{ const _cl = ee`<div class="charsheet__modal-footer">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`; modalInner.append(_cl); _cl.querySelector("button").addEventListener("click", () => doClose(false)); }
	}

	_getSchoolEmoji (school) {
		const schoolEmojis = {
			"A": "✨", // Abjuration
			"C": "🌀", // Conjuration
			"D": "👁️", // Divination
			"E": "💫", // Enchantment
			"V": "🔥", // Evocation
			"I": "🎭", // Illusion
			"N": "💀", // Necromancy
			"T": "🔄", // Transmutation
		};
		return schoolEmojis[school] || "📜";
	}

	async _showSpellInfoFromData (spell) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: spell.name,
			isMinHeight0: true,
			zIndex: 10002, // Above Quick Build overlay (9999) and toasts (10001)
		});

		const school = Parser.spSchoolAbvToFull(spell.school);
		const level = spell.level === 0 ? "Cantrip" : `Level ${spell.level}`;

		// Build component string
		const components = [];
		if (spell.components?.v) components.push("V");
		if (spell.components?.s) components.push("S");
		if (spell.components?.m) {
			const mStr = typeof spell.components.m === "string" ? spell.components.m : spell.components.m.text || "M";
			components.push(`M (${mStr})`);
		}

		const content = e_({outer: `
			<div class="charsheet__spell-info-modal">
				<div class="ve-flex gap-2 mb-2">
					<span class="charsheet__modal-list-item-badge">${level}</span>
					<span class="charsheet__modal-list-item-badge">${school}</span>
					${spell.ritual ? `<span class="charsheet__modal-list-item-badge">🔮 Ritual</span>` : ""}
					${spell.concentration ? `<span class="charsheet__modal-list-item-badge">⏳ Concentration</span>` : ""}
				</div>
				<div class="ve-small mb-3">
					<div><strong>Casting Time:</strong> ${this._getCastingTime(spell)}</div>
					<div><strong>Range:</strong> ${this._getRange(spell)}</div>
					<div><strong>Components:</strong> ${components.join(", ")}</div>
					<div><strong>Duration:</strong> ${this._getDuration(spell)}</div>
				</div>
				<hr>
				<div class="rd__b">${Renderer.get().render({entries: spell.entries || []})}</div>
				${spell.entriesHigherLevel ? `
					<hr>
					<div class="rd__b"><strong>At Higher Levels.</strong> ${Renderer.get().render({entries: spell.entriesHigherLevel})}</div>
				` : ""}
			</div>
		`});
		modalInner.append(content);

		{ const _cl = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`; modalInner.append(_cl); _cl.querySelector("button").addEventListener("click", () => doClose(false)); }
	}

	/**
	 * Check if adding a spell would exceed limits for known casters
	 * @returns {{canAdd: boolean, warning?: string}}
	 */
	_checkSpellLimits (spell) {
		const info = this._state.getSpellcastingInfo();
		if (!info) return {canAdd: true};

		const isCantrip = spell.level === 0;

		// Check cantrip limits
		if (isCantrip && info.cantripsKnown) {
			const allCantrips = this._state.getCantripsKnown();
			const currentCount = allCantrips.filter(c => !c.sourceFeature).length;
			if (currentCount >= info.cantripsKnown) {
				return {
					canAdd: true, // Still allow, but warn
					warning: `You already have ${currentCount}/${info.cantripsKnown} cantrips. Adding more exceeds your class limit.`,
				};
			}
		}

		// Check spells known limits for known casters
		if (!isCantrip && info.type === "known") {
			const spells = this._state.getSpells();
			const leveledSpells = spells.filter(s => s.level > 0 && !s.sourceFeature);
			const maxKnown = info.spellsKnownMax || info.max;
			if (leveledSpells.length >= maxKnown) {
				return {
					canAdd: true, // Still allow, but warn
					warning: `You already have ${leveledSpells.length}/${maxKnown} spells known. Adding more exceeds your class limit. Consider removing a spell first.`,
					isOverLimit: true,
				};
			}
		}

		// For multiclass with known casters, check combined limit
		if (!isCantrip && info.isMulticlass && info.byClass?.some(c => c.type === "known")) {
			const spells = this._state.getSpells();
			const leveledSpells = spells.filter(s => s.level > 0 && !s.sourceFeature);
			const knownClasses = info.byClass.filter(c => c.type === "known");
			const totalKnownMax = knownClasses.reduce((sum, c) => sum + (c.spellsKnownMax || c.max || 0), 0);
			if (leveledSpells.length >= totalKnownMax) {
				const classNames = knownClasses.map(c => c.className).join("/");
				return {
					canAdd: true,
					warning: `Your ${classNames} spells known limit (${totalKnownMax}) is reached. Adding more exceeds your limit.`,
					isOverLimit: true,
				};
			}
		}

		return {canAdd: true};
	}

	_addSpell (spell) {

		// Check limits and warn if over
		const limitCheck = this._checkSpellLimits(spell);
		if (limitCheck.warning) {
			JqueryUtil.doToast({
				type: limitCheck.isOverLimit ? "warning" : "info",
				content: limitCheck.warning,
			});
		}

		// Detect concentration from duration array (raw spell data format)
		const isConcentration = spell.concentration || spell.duration?.some?.(d => d.concentration) || false;
		// Detect ritual from meta object (raw spell data format)
		const isRitual = spell.ritual || spell.meta?.ritual || false;

		this._state.addSpell({
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			prepared: spell.level === 0, // Cantrips are always prepared
			ritual: isRitual,
			concentration: isConcentration,
			castingTime: this._getCastingTime(spell),
			range: this._getRange(spell),
			components: this._getComponents(spell),
			duration: this._getDuration(spell),
			subschools: spell.subschools || [], // Include rarity/legality tags
		});


		this._renderSpellList();
		// Update combat spells tab (cantrips are auto-prepared)
		if (this._page._combat) {
			this._page._combat.renderCombatSpells();
		}
		this._page.saveCharacter();
	}

	_getCastingTime (spell) {
		if (!spell.time?.length) return "";
		const time = spell.time[0];
		return `${time.number} ${time.unit}`;
	}

	_getRange (spell) {
		if (!spell.range) return "";
		const range = spell.range;
		if (range.type === "point") {
			if (range.distance?.type === "self") return "Self";
			if (range.distance?.type === "touch") return "Touch";
			return `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
		}
		return range.type || "";
	}

	_getComponents (spell) {
		if (!spell.components) return "";
		const parts = [];
		if (spell.components.v) parts.push("V");
		if (spell.components.s) parts.push("S");
		if (spell.components.m) {
			const mat = typeof spell.components.m === "string" ? spell.components.m : spell.components.m.text;
			parts.push(`M (${mat})`);
		}
		return parts.join(", ");
	}

	_getDuration (spell) {
		if (!spell.duration?.length) return "";
		const dur = spell.duration[0];
		if (dur.type === "instant") return "Instantaneous";
		if (dur.type === "permanent") return "Permanent";
		if (dur.concentration) {
			return `Concentration, up to ${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
		}
		return `${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
	}

	async _castSpell (spellId) {
		const spells = this._state.getSpells();
		const spell = spells.find(s => s.id === spellId);
		if (!spell) return;

		// Get full spell data for component/constraint checks
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);

		// Check if spell requires concentration - use spellData (authoritative source)
		// Do NOT use spell.concentration as it may have been set incorrectly by migrations
		// that didn't account for different spell versions (e.g., PHB vs XPHB)
		const requiresConcentration = spellData?.duration?.some?.(d => d.concentration);

		// If concentrating on another spell, ask to break concentration first
		if (requiresConcentration && this._state.isConcentrating?.()) {
			const currentConc = this._state.getConcentration?.();
			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Break Concentration?",
				htmlDescription: `You are currently concentrating on <strong>${currentConc?.spellName || "a spell"}</strong>. Casting <strong>${spell.name}</strong> will break that concentration.`,
				textYes: "Cast and break concentration",
				textNo: "Cancel",
			});
			if (!confirmed) return;
			this._state.breakConcentration?.();
		}

		// Cantrips don't use slots
		if (spell.level === 0) {
			const activeMetamagicChoice = await this._pChooseActiveMetamagic({spell, spellData, slotLevel: 0});
			if (activeMetamagicChoice?.cancelled) return;
			const castingConstraint = this._checkCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null);
			if (castingConstraint) {
				JqueryUtil.doToast({type: "warning", content: castingConstraint});
				return;
			}
			if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
				return;
			}
			if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

			const castMeta = this._getNormalizedCastMeta({
				spell,
				spellData,
				slotLevel: 0,
				castMeta: activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : null,
			});

			await this._showCastResult(spell, 0, false, false, castMeta);
			// Set concentration for concentration cantrips (rare but possible)
			if (requiresConcentration) {
				this._state.setConcentration?.({name: spell.name, level: 0, appliedMetamagic: castMeta?.appliedMetamagic || null});
				this._updateConcentrationUI();
			}
			this._page.saveCharacter();
			return;
		}

		// Check if spell can be cast as a ritual (no slot needed, +10 min casting time)
		const canRitual = this._state.canCastAsRitual?.(spell);
		if (canRitual) {
			// Check if there ARE slots available — if so, offer choice
			let hasSlots = false;
			const pactSlots = this._state.getPactSlots();
			if (pactSlots && pactSlots.current > 0 && spell.level <= pactSlots.level) hasSlots = true;
			if (!hasSlots) {
				for (let lvl = spell.level; lvl <= 9; lvl++) {
					if (this._state.getSpellSlotsCurrent(lvl) > 0) { hasSlots = true; break; }
				}
			}

			// If no slots available, auto-ritual; if slots available, ask
			let castAsRitual = !hasSlots;
			if (hasSlots) {
				castAsRitual = await InputUiUtil.pGetUserBoolean({
					title: "Cast as Ritual?",
					htmlDescription: `<strong>${spell.name}</strong> has the ritual tag. You can cast it as a ritual (no spell slot used, but casting takes 10 extra minutes).`,
					textYes: "🔮 Cast as Ritual (no slot)",
					textNo: "⚡ Cast Normally (use slot)",
				});
			}

			if (castAsRitual) {
				const activeMetamagicChoice = await this._pChooseActiveMetamagic({spell, spellData, slotLevel: spell.level});
				if (activeMetamagicChoice?.cancelled) return;
				const castingConstraint = this._checkCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null);
				if (castingConstraint) {
					JqueryUtil.doToast({type: "warning", content: castingConstraint});
					return;
				}
				if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
					JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
					return;
				}
				if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

				const castMeta = this._getNormalizedCastMeta({
					spell,
					spellData,
					slotLevel: spell.level,
					castMeta: activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : null,
				});

				// Ritual cast: no slot consumed
				await this._showCastResult(spell, spell.level, false, true, castMeta); // ritual = true
				if (requiresConcentration) {
					this._state.setConcentration?.({name: spell.name, level: spell.level, appliedMetamagic: castMeta?.appliedMetamagic || null});
					this._updateConcentrationUI();
				}
				this._page.saveCharacter();
				return;
			}
			// Otherwise fall through to normal slot-consuming cast
		}

		// Check pact slots first (they recharge on short rest, so use them preferentially)
		const pactSlots = this._state.getPactSlots();
		const hasPactSlot = pactSlots && pactSlots.current > 0 && spell.level <= pactSlots.level;

		// Collect all available slot levels for upcasting
		const availableSlotLevels = [];
		if (hasPactSlot) {
			availableSlotLevels.push({level: pactSlots.level, isPact: true, label: `Level ${pactSlots.level} (Pact slot, ${pactSlots.current} remaining)`});
		}
		for (let lvl = spell.level; lvl <= 9; lvl++) {
			const current = this._state.getSpellSlotsCurrent(lvl);
			if (current > 0) {
				// Don't duplicate pact slot level if already listed
				const upcastLabel = lvl > spell.level ? " — upcast" : "";
				availableSlotLevels.push({level: lvl, isPact: false, label: `Level ${lvl} (${current} remaining)${upcastLabel}`});
			}
		}

		if (availableSlotLevels.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No spell slots available!"});
			return;
		}

		// If only one option (or only base-level), auto-select; otherwise show picker
		let selectedSlot;
		if (availableSlotLevels.length === 1) {
			selectedSlot = availableSlotLevels[0];
		} else {
			const chosenIdx = await InputUiUtil.pGetUserEnum({
				title: `Cast ${spell.name} — Choose Slot Level`,
				htmlDescription: `<div><strong>${spell.name}</strong> is a level ${spell.level} spell. Choose which spell slot to use:</div>`,
				values: availableSlotLevels.map(s => s.label),
				fnDisplay: v => v,
				isResolveItem: true,
			});
			if (chosenIdx == null) return; // User cancelled
			selectedSlot = availableSlotLevels.find(s => s.label === chosenIdx);
			if (!selectedSlot) return;
		}

		const activeMetamagicChoice = await this._pChooseActiveMetamagic({spell, spellData, slotLevel: selectedSlot.level});
		if (activeMetamagicChoice?.cancelled) return;
		const castingConstraint = this._checkCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null);
		if (castingConstraint) {
			JqueryUtil.doToast({type: "warning", content: castingConstraint});
			return;
		}
		if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
			JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
			return;
		}
		if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

		const castMeta = this._getNormalizedCastMeta({
			spell,
			spellData,
			slotLevel: selectedSlot.level,
			castMeta: activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : null,
		});

		// Consume the selected slot
		if (selectedSlot.isPact) {
			this._state.setPactSlotsCurrent(pactSlots.current - 1);
		} else {
			const current = this._state.getSpellSlotsCurrent(selectedSlot.level);
			this._state.setSpellSlots(selectedSlot.level, this._state.getSpellSlotsMax(selectedSlot.level), current - 1);
		}

		await this._showCastResult(
			spell,
			selectedSlot.level,
			selectedSlot.isPact,
			false,
			castMeta,
		);

		// Set concentration if spell requires it
		if (requiresConcentration) {
			this._state.setConcentration?.({name: spell.name, level: selectedSlot.level, appliedMetamagic: castMeta?.appliedMetamagic || null});
			this._updateConcentrationUI();
		}

		this.renderSlots();
		this._page._renderQuickSpells(); // Update overview spell slots
		this._page.saveCharacter();
	}

	/**
	 * Cast a spell as a ritual (no slot consumed, +10 min casting time).
	 * Used for unprepared Wizard spellbook spells with ritual tag.
	 * @param {string} spellId - The spell ID
	 */
	async _castSpellAsRitual (spellId) {
		const spells = this._state.getSpells();
		const spell = spells.find(s => s.id === spellId);
		if (!spell) return;

		if (!this._state.canCastAsRitual?.(spell)) {
			JqueryUtil.doToast({type: "warning", content: "This spell cannot be cast as a ritual."});
			return;
		}

		// Check concentration
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);
		const requiresConcentration = spell.concentration || spellData?.duration?.some?.(d => d.concentration);

		if (requiresConcentration && this._state.isConcentrating?.()) {
			const currentConc = this._state.getConcentration?.();
			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Break Concentration?",
				htmlDescription: `You are currently concentrating on <strong>${currentConc?.spellName || "a spell"}</strong>. Casting <strong>${spell.name}</strong> as a ritual will break that concentration.`,
				textYes: "Cast and break concentration",
				textNo: "Cancel",
			});
			if (!confirmed) return;
			this._state.breakConcentration?.();
		}

		// Cast as ritual — no slot consumed
		await this._showCastResult(spell, spell.level, false, true);

		if (requiresConcentration) {
			this._state.setConcentration?.(spell.name, spell.level);
			this._updateConcentrationUI();
		}

		this._page.saveCharacter();
	}

	/**
	 * Update concentration UI in combat tab and overview
	 */
	_updateConcentrationUI () {
		// Update combat tab states
		this._page._combat?.renderCombatStates?.();
		this._page._combat?.renderCombatEffects?.();
		// Update overview active states
		this._page._renderActiveStates?.();
	}

	/**
	 * Check for conditions/effects that prevent spellcasting
	 * @param {object} spell - The spell being cast (from character's spell list)
	 * @param {object} spellData - Full spell data from the spells database
	 * @param {object|null} appliedMetamagic - Active metamagic chosen for this cast
	 * @returns {string|null} Error message if casting is prevented, null if allowed
	 */
	_checkCastingConstraints (spell, spellData, appliedMetamagic = null) {
		// Check for conditions that completely prevent actions (thus spellcasting)
		const incapacitatingConditions = ["Incapacitated", "Paralyzed", "Petrified", "Stunned", "Unconscious"];
		for (const condition of incapacitatingConditions) {
			if (this._state.hasCondition?.(condition)) {
				return `Cannot cast spells while ${condition.toLowerCase()}!`;
			}
		}

		// Get spell components
		const components = spellData?.components || spell.components || {};
		const isSubtleSpell = appliedMetamagic?.key === "subtle";
		const hasVerbal = !isSubtleSpell && components.v;
		const hasSomatic = !isSubtleSpell && components.s;
		const hasMaterial = components.m;

		// Check if character is in a Silence effect (custom condition/active state)
		// Also check for conditions that prevent speaking
		if (hasVerbal) {
			if (this._state.hasCondition?.("Silenced")) {
				return `Cannot cast ${spell.name} - spell has verbal components and you are silenced!`;
			}
			// Some conditions prevent speech indirectly (already covered by incapacitated check above)
		}

		// Check for restrained affecting somatic components (doesn't actually prevent casting in RAW)
		// Restrained only affects movement and attack rolls, not spellcasting directly
		// But some DMs rule it affects somatic components - could add optional check here

		// Check if hands are full/occupied for somatic components (if we track this)
		// This would require tracking what the character is holding
		// For now, we skip this check as it requires more state tracking

		// Check for material component availability (if we track components)
		// This would require an inventory check for specific components
		// Spellcasting focus typically substitutes for non-consumed components
		// For now, we assume the character has access to required materials

		// Check for Wild Shape (can't cast most spells while transformed)
		// Would need to check if character has active Wild Shape state
		const activeStates = this._state.getActiveStates?.() || [];
		const wildShapeState = activeStates.find(s =>
			s.name?.toLowerCase().includes("wild shape") && s.active,
		);
		if (wildShapeState) {
			// Note: Some druids can cast spells in Wild Shape (e.g., Moon Druid at high levels)
			// For now, show a warning but allow casting - DM can rule
			// Could add a feature check for Beast Spells here
			const hasBeastSpells = this._state.getFeatures?.()?.some(f =>
				f.name?.toLowerCase().includes("beast spells"),
			);
			if (!hasBeastSpells) {
				// Allow but warn - user can decide
			}
		}

		// All checks passed
		return null;
	}

	async _showCastResult (spell, slotLevel = null, isPactSlot = false, isRitual = false, castMeta = null) {
		// Delegate to the enhanced spell effects handler
		await this._handleSpellEffects(spell, slotLevel, isPactSlot, isRitual, castMeta);
	}

	async _pChooseActiveMetamagic ({spell, spellData, slotLevel}) {
		const metamagicOptions = this._state.getCastableActiveMetamagics?.({spell, spellData, slotLevel}) || [];
		if (!metamagicOptions.length) return {cancelled: false, metamagic: null};

		const availableOptions = metamagicOptions.filter(it => it.isAvailable);
		if (!availableOptions.length) return {cancelled: false, metamagic: null};

		const unavailableOptions = metamagicOptions.filter(it => !it.isAvailable);
		const labels = ["Cast without metamagic", ...availableOptions.map(it => `${it.name} (${it.cost} SP)`)];
		const unavailableHtml = unavailableOptions.length
			? `<div class="mt-2 ve-small ve-muted"><strong>Unavailable:</strong><br>${unavailableOptions.map(it => `${it.name}: ${it.unavailableReason}`).join("<br>")}</div>`
			: "";

		const choice = await InputUiUtil.pGetUserEnum({
			title: `Cast ${spell.name} — Metamagic`,
			htmlDescription: `<div>Select an active metamagic for this cast. You currently have <strong>${this._state.getSorceryPoints().current}</strong> sorcery points.</div>${unavailableHtml}`,
			values: labels,
			fnDisplay: v => v,
			isResolveItem: true,
		});

		if (choice == null) return {cancelled: true, metamagic: null};
		if (choice === labels[0]) return {cancelled: false, metamagic: null};

		const metamagic = availableOptions.find(it => `${it.name} (${it.cost} SP)` === choice) || null;
		return {cancelled: false, metamagic};
	}

	async _pMaybeApplySeekingSpell ({spell, attackRoll = 0, attackTotal = 0, castMeta = null} = {}) {
		if (castMeta?.appliedMetamagic?.key !== "seeking") return castMeta;

		const shouldReroll = await InputUiUtil.pGetUserBoolean({
			title: "Seeking Spell",
			htmlDescription: `<div><strong>${spell?.name || "This spell"}</strong> rolled <strong>${attackTotal}</strong> to hit. If the spell attack missed, you can use Seeking Spell to reroll the d20 once.</div>`,
			textYes: "Reroll Missed Attack",
			textNo: "Keep Original Roll",
		});

		if (!shouldReroll) return castMeta;

		const rerollResult = this._page.rollD20({isAttack: true});
		const rerolledRoll = rerollResult?.roll ?? attackRoll;

		return {
			...(castMeta || {}),
			attackMeta: {
				...(castMeta?.attackMeta || {}),
				seekingRerollUsed: true,
				originalRoll: attackRoll,
				rerolledRoll,
			},
		};
	}

	_getNormalizedCastMeta ({spell = null, spellData = null, slotLevel = null, castMeta = null} = {}) {
		const normalized = {
			...(castMeta || {}),
			appliedMetamagic: castMeta?.appliedMetamagic || null,
		};

		if (!spellData || !normalized.appliedMetamagic) return normalized;

		switch (normalized.appliedMetamagic.key) {
			case "bestowed":
				if (spellData.range?.distance?.type === "self") {
					normalized.rangeMeta = {
						originalLabel: normalized.rangeMeta?.originalLabel || this._getRange(spellData),
						effectiveLabel: normalized.rangeMeta?.effectiveLabel || "Touch",
						effectiveDistanceType: normalized.rangeMeta?.effectiveDistanceType || "touch",
					};
					normalized.targetingMeta = {
						...(normalized.targetingMeta || {}),
						selfOnly: false,
						canTargetSelf: true,
						canTargetAlly: true,
					};
				}
				break;

			case "heightened":
				if (spellData.savingThrow?.length) {
					normalized.saveMeta = {
						...(normalized.saveMeta || {}),
						firstTargetDisadvantage: true,
					};
				}
				break;

			default:
				break;
		}

		return normalized;
	}

	_getCastMetamagicNotes ({spellData = null, castMeta = null} = {}) {
		const appliedMetamagic = castMeta?.appliedMetamagic || null;
		if (!appliedMetamagic) return [];

		switch (appliedMetamagic.key) {
			case "quickened":
				return ["Quickened Spell cast this spell as a bonus action"];

			case "subtle": {
				const components = spellData?.components || {};
				const removedParts = [];
				if (components.v) removedParts.push("verbal");
				if (components.s) removedParts.push("somatic");
				if (!removedParts.length) return ["Subtle Spell applied"];
				return [`Subtle Spell removed ${removedParts.join(" and ")} components`];
			}

			case "bestowed":
				return [`Bestowed Spell changed range from ${castMeta?.rangeMeta?.originalLabel || "Self"} to ${castMeta?.rangeMeta?.effectiveLabel || "Touch"} for this cast`];

			case "heightened":
				return castMeta?.saveMeta?.firstTargetDisadvantage
					? ["Heightened Spell gives the first target disadvantage on its initial save"]
					: [];

			case "seeking":
				return castMeta?.attackMeta?.seekingRerollUsed
					? [`Seeking Spell rerolled the missed spell attack from ${castMeta.attackMeta.originalRoll} to ${castMeta.attackMeta.rerolledRoll}`]
					: [];

			case "aimed":
				return ["Aimed Spell added 1d6 to the spell attack roll"];

			default:
				return [];
		}
	}

	/**
	 * Enhanced spell effects handler with target selection and effect application
	 */
	async _handleSpellEffects (spell, slotLevel = null, isPactSlot = false, isRitual = false, castMeta = null) {
		const upcast = slotLevel && slotLevel > spell.level ? ` (at level ${slotLevel})` : "";
		const slotType = isPactSlot ? " [Pact Slot]" : (isRitual ? " [Ritual]" : "");

		// Check for spell attack or save DC
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);
		const normalizedCastMeta = this._getNormalizedCastMeta({spell, spellData, slotLevel, castMeta});
		const appliedMetamagic = normalizedCastMeta.appliedMetamagic || null;
		let attackInfo = "";
		let damageInfo = "";
		let damageResult = null;
		let effectsApplied = [];
		let metamagicNotes = [];
		let deliveredViaFamiliar = false;

		// Check for touch spell delivery via familiar
		if (spellData) {
			metamagicNotes = this._getCastMetamagicNotes({spellData, castMeta: normalizedCastMeta});

			const isTouchSpell = normalizedCastMeta.rangeMeta?.effectiveDistanceType === "touch"
				|| spellData.range?.distance?.type === "touch";
			if (isTouchSpell) {
				const activeFamiliar = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR)
					?.find(f => f.active !== false);

				if (activeFamiliar && !activeFamiliar.usedReaction) {
					const deliverViaFamiliar = await InputUiUtil.pGetUserBoolean({
						title: "Touch Spell Delivery",
						htmlDescription: `<strong>${spell.name}</strong> is a touch spell. Your familiar <strong>${activeFamiliar.customName || activeFamiliar.name}</strong> can deliver the touch for you (using its Reaction).`,
						textYes: "🐾 Deliver via Familiar",
						textNo: "✋ Touch Directly",
					});

					if (deliverViaFamiliar) {
						deliveredViaFamiliar = true;
						// Use familiar's reaction
						this._state.updateCompanion?.(activeFamiliar.id, {usedReaction: true});
						this._page._saveCurrentCharacter?.();
						this._page._renderCompanions?.();
					}
				}
			}
		}

		if (spellData) {
			const spellcastingMod = this._state.getAbilityMod(this._state.getSpellcastingAbility() || "int");
			const profBonus = this._state.getProficiencyBonus();
			const exhaustionDcPenalty = this._state._getExhaustionDcPenalty?.() || 0;

			// Check if spell attack
			if (spellData.entries?.some(e => typeof e === "string" && e.toLowerCase().includes("spell attack"))) {
				const attackBonus = spellcastingMod + profBonus;
				const aimedBonus = appliedMetamagic?.key === "aimed"
					? this._rollMetamagicAimedBonus()
					: null;
				// Spell attacks are attacks, so use isAttack: true (no Thelemar crit bonus)
				const rollResult = this._page.rollD20({isAttack: true});
				const initialRoll = rollResult.roll;
				const totalAttackBonus = attackBonus + (aimedBonus?.total || 0);
				const seekingCastMeta = await this._pMaybeApplySeekingSpell({
					spell,
					attackRoll: initialRoll,
					attackTotal: initialRoll + totalAttackBonus,
					castMeta: normalizedCastMeta,
				});
				if (seekingCastMeta !== normalizedCastMeta) {
					normalizedCastMeta.attackMeta = seekingCastMeta.attackMeta;
					metamagicNotes = this._getCastMetamagicNotes({spellData, castMeta: normalizedCastMeta});
				}
				const finalRoll = normalizedCastMeta.attackMeta?.seekingRerollUsed
					? normalizedCastMeta.attackMeta.rerolledRoll
					: initialRoll;
				const aimedText = aimedBonus ? ` + ${aimedBonus.total} aimed` : "";
				const seekingText = normalizedCastMeta.attackMeta?.seekingRerollUsed
					? ` <span class="ve-muted">(rerolled from ${normalizedCastMeta.attackMeta.originalRoll})</span>`
					: "";
				attackInfo = `<br>Spell Attack: ${finalRoll} + ${attackBonus}${aimedText} = <strong>${finalRoll + totalAttackBonus}</strong>${seekingText}`;
			}

			// Check for save DC
			if (spellData.savingThrow) {
				const saveDC = 8 + spellcastingMod + profBonus - exhaustionDcPenalty;
				const saveNote = normalizedCastMeta.saveMeta?.firstTargetDisadvantage
					? "; first target rolls at disadvantage"
					: "";
				attackInfo += `<br>Save DC: <strong>${saveDC}</strong> (${spellData.savingThrow.join("/")} save${saveNote})`;
			}

			// Parse spell effects to determine what the spell does
			const effects = CharacterSheetState.parseSpellEffects(spellData);
			const targetInfo = {
				...CharacterSheetState.getValidTargets(spellData),
				...(normalizedCastMeta.targetingMeta || {}),
			};

			// Determine if we should ask for a target
			const needsTargetSelection = !targetInfo.selfOnly && (
				effects.healing
				|| effects.buffs?.length > 0
				|| effects.tempHp
				|| effects.conditions?.length > 0
				|| effects.registryEffects?.length > 0
			);

			// Handle target selection for beneficial effects
			if (needsTargetSelection) {
				const targetChoice = await this._promptSpellTarget(spell, spellData, effects, targetInfo);

				if (targetChoice === "self") {
					effectsApplied = await this._applySpellEffectsToSelf(spell, spellData, effects, slotLevel);
				} else if (targetChoice === "other") {
					// For others, just show the roll results - we can't track their HP
					damageInfo = this._rollSpellHealing(spellData, slotLevel, spell.level)
						|| ((damageResult = this._rollSpellDamage(spellData, slotLevel, spell.level, appliedMetamagic))?.text || "");
				}
				// If cancelled, still show the basic cast info
			} else if (targetInfo.selfOnly) {
				// Self-only spells automatically target self
				effectsApplied = await this._applySpellEffectsToSelf(spell, spellData, effects, slotLevel);
			} else {
				// Damage or other effects targeting enemies
				damageResult = this._rollSpellDamage(spellData, slotLevel, spell.level, appliedMetamagic);
				damageInfo = damageResult?.text || "";

				// Roll healing if spell heals but targets others by default (like Mass Cure Wounds)
				if (!damageInfo) {
					damageInfo = this._rollSpellHealing(spellData, slotLevel, spell.level);
				}
			}

			// Apply tuned passive metamagic effects
			const tunedPassiveNotes = this._getTunedPassiveNotes({spellData, damageResult});
			metamagicNotes.push(...tunedPassiveNotes);

			// Transmuted Spell: prompt to change damage type
			if (damageResult?.damageType && this._state.isMetamagicTuned?.("transmuted")) {
				const transmutedResult = await this._pMaybeApplyTransmutedDamage(damageResult);
				if (transmutedResult) {
					metamagicNotes.push(`Transmuted Spell changed ${transmutedResult.originalDamageType} → ${transmutedResult.damageType} damage`);
					damageResult = transmutedResult;
					damageInfo = transmutedResult.text;
				}
			}

			// Empowered Spell: prompt to reroll damage dice
			if (damageResult?.dice && this._state.isMetamagicTuned?.("empowered")) {
				const empoweredResult = await this._pMaybeApplyEmpoweredReroll(damageResult);
				if (empoweredResult) {
					metamagicNotes.push(`Empowered Spell rerolled ${empoweredResult.rerolledCount} damage ${empoweredResult.rerolledCount === 1 ? "die" : "dice"} (${empoweredResult.originalTotal} → ${empoweredResult.total})`);
					damageResult = empoweredResult;
					damageInfo = empoweredResult.text;
				}
			}

			if (appliedMetamagic?.key === "vampiric" && damageResult?.total > 0) {
				const hp = this._state.getHp();
				const healed = Math.max(0, Math.min(hp.max - hp.current, damageResult.total));
				if (healed > 0) {
					this._state.setHp(hp.current + healed, hp.max, hp.temp);
					effectsApplied.push(`Vampiric Spell healed ${healed} HP`);
				}
			}
		}

		// Build the toast message
		let toastContent = `Cast ${spell.name}${upcast}${slotType}`;
		if (normalizedCastMeta.appliedMetamagic) {
			toastContent += `<br><span class="ve-muted">Metamagic: ${normalizedCastMeta.appliedMetamagic.name} (-${normalizedCastMeta.appliedMetamagic.cost} SP)</span>`;
		}

		if (deliveredViaFamiliar) {
			toastContent += `<br><span class="text-info">🐾 Delivered via familiar (used familiar's Reaction)</span>`;
		}

		toastContent += `${attackInfo}${damageInfo}`;

		if (effectsApplied.length > 0) {
			toastContent += `<br><span class="text-success">✓ Applied: ${effectsApplied.join(", ")}</span>`;
		}

		if (metamagicNotes.length > 0) {
			toastContent += `<br><span class="text-info">${metamagicNotes.join("<br>")}</span>`;
		}

		// Gambler's Folly - automatic bet roll on spell cast (TGTT Gambler subclass)
		const gamblerFollyResult = await this._handleGamblerFolly(spell, slotLevel);
		if (gamblerFollyResult) {
			toastContent += gamblerFollyResult;
		}

		JqueryUtil.doToast({
			type: "success",
			content: toastContent,
		});

		// Update UI to show new active states
		if (effectsApplied.length > 0) {
			this._page._renderActiveStates?.();
			this._page._combat?.renderCombatStates?.();
			this._page._renderHp?.();
		}

		// Check for special spell triggers (Find Familiar, etc.)
		await this._handleSpecialSpellTriggers(spell);
	}

	/**
	 * Handle Gambler's Folly automatic bet on spell cast (TGTT Gambler subclass)
	 * @param {object} spell - The spell being cast
	 * @param {number} slotLevel - The slot level used
	 * @returns {string|null} - HTML string to append to toast, or null if not applicable
	 */
	async _handleGamblerFolly (spell, slotLevel) {
		const calcs = this._state.getFeatureCalculations?.();
		if (!calcs?.hasGamblerFolly) return null;

		// Only trigger on leveled spells (cantrips don't trigger)
		if (!spell.level || spell.level === 0) return null;

		const result = this._state.rollGamblerBet(slotLevel);
		if (!result) return null;

		let html = `<br><hr class="hr-1"><span class="text-warning">🎲 <b>Gambler's Folly:</b></span>`;
		html += `<br>Bet Roll: <b>${result.roll}</b> on d${result.die}`;

		if (result.won) {
			html += ` — <span class="text-success"><b>Won!</b> ✓</span>`;
		} else {
			html += ` — <span class="text-danger"><b>Lost!</b> Roll d100 on Gambling Table</span>`;

			// Check if auto-roll is enabled
			const autoRoll = this._state.getGamblerAutoRollTable?.();
			if (autoRoll) {
				const tableResult = this._state.rollGamblingTable();
				if (tableResult) {
					html += `<br><span class="text-info">🎰 <b>d100:</b> ${tableResult.roll}</span>`;
					html += `<br>${tableResult.effect}`;
				}
			} else {
				// Show button to roll manually
				html += `<br><button class="btn btn-xs btn-warning mt-1 btn-gambler-table-roll">🎰 Roll d100</button>`;
			}
		}

		return html;
	}

	/**
	 * Open the Gambling Table modal for manual d100 rolls or reference
	 * Used by Gambler's Folly, Extra Luck, Master of Fortune (TGTT)
	 */
	async _openGamblingTableModal () {
		const table = CharacterSheetState.GAMBLER_GAMBLING_TABLE;
		if (!table || !table.length) return;

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🎰 Gambling Table",
			isMinHeight0: true,
			isWidth100: true,
		});

		// Roll button and result display
		const rollSection = e_({outer: `
			<div class="flex-v-center mb-3" style="gap: 12px;">
				<button class="btn btn-primary btn-gambler-modal-roll">🎲 Roll d100</button>
				<div class="gambler-roll-result" style="font-size: 1.1em;"></div>
			</div>
		`});
		modalInner.append(rollSection);

		const resultDisplay = rollSection.querySelector(".gambler-roll-result");

		// Check for Master of Fortune (roll twice, choose result)
		const calcs = this._state.getFeatureCalculations?.();
		const hasMasterOfFortune = calcs?.hasMasterOfFortune;

		rollSection.querySelector(".btn-gambler-modal-roll").addEventListener("click", () => {
			const result = this._state.rollGamblingTable();
			if (result) {
				let resultHtml = `<b>d100:</b> ${result.roll}`;
				if (hasMasterOfFortune && result.secondRoll) {
					resultHtml += ` / ${result.secondRoll}`;
					resultHtml += `<br><span class="text-info">Master of Fortune: Choose which result to use</span>`;
				}
				resultHtml += `<br><span class="text-warning">${result.effect}</span>`;
				resultDisplay.innerHTML = resultHtml;

				// Highlight the result row in the table
				tableBody.querySelectorAll("tr.table-warning").forEach(el => el.classList.remove("table-warning"));
				tableBody.querySelector(`tr[data-roll="${result.roll}"]`)?.classList.add("table-warning");
			}
		});

		// Last roll display
		const lastRoll = this._state.getGamblerLastTableRoll?.();
		if (lastRoll) {
			resultDisplay.innerHTML = `<span class="text-muted">Last roll: ${lastRoll.roll} — ${lastRoll.effect}</span>`;
		}

		// Search filter
		const searchRow = e_({outer: `
			<div class="mb-2">
				<input type="text" class="form-control form-control-sm" placeholder="Filter table..." style="max-width: 300px;">
			</div>
		`});
		modalInner.append(searchRow);

		const searchInput = searchRow.querySelector("input");

		// Table
		const tableContainer = e_({outer: `
			<div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--rgb-border-grey); border-radius: 4px;">
				<table class="table table-striped table-hover table-sm mb-0" style="font-size: 0.85em;">
					<thead style="position: sticky; top: 0; background: var(--rgb-bg); z-index: 1;">
						<tr>
							<th style="width: 60px;">d100</th>
							<th>Effect</th>
						</tr>
					</thead>
					<tbody></tbody>
				</table>
			</div>
		`});
		modalInner.append(tableContainer);

		const tableBody = tableContainer.querySelector("tbody");

		// Render all 100 rows
		const renderTable = (filter = "") => {
			tableBody.innerHTML = "";
			const filterLower = filter.toLowerCase();
			table.forEach((effect, idx) => {
				const roll = idx + 1;
				if (filter && !effect.toLowerCase().includes(filterLower) && !String(roll).includes(filter)) {
					return;
				}
				const row = e_({outer: `<tr data-roll="${roll}"><td class="text-center"><b>${roll}</b></td><td>${effect}</td></tr>`});
				tableBody.append(row);
			});
		};

		renderTable();

		searchInput.addEventListener("input", (e) => {
			renderTable(e.target.value);
		});

		// Auto-roll setting toggle
		const autoRollEnabled = this._state.getGamblerAutoRollTable?.();
		const settingRow = e_({outer: `
			<div class="mt-3 text-muted" style="font-size: 0.85em;">
				<label class="flex-v-center" style="gap: 6px; cursor: pointer;">
					<input type="checkbox" ${autoRollEnabled ? "checked" : ""}>
					<span>Auto-roll d100 when bet is lost</span>
				</label>
			</div>
		`});
		modalInner.append(settingRow);

		settingRow.querySelector("input").addEventListener("change", (e) => {
			this._state.setGamblerAutoRollTable?.(e.target.checked);
		});
	}

	/**
	 * Handle special triggers for specific spells like Find Familiar
	 */
	async _handleSpecialSpellTriggers (spell) {
		const spellNameLower = spell.name.toLowerCase();

		// Find Familiar - show familiar picker
		if (spellNameLower === "find familiar") {
			await this._pShowFamiliarPicker();
			return;
		}

		// Find Steed - show mount picker
		if (spellNameLower === "find steed") {
			if (this._page?._onFindSteed) {
				await this._page._onFindSteed(false);
			}
			return;
		}

		// Find Greater Steed - show greater mount picker
		if (spellNameLower === "find greater steed") {
			if (this._page?._onFindSteed) {
				await this._page._onFindSteed(true);
			}
			return;
		}

		// Summon spells - create concentration-linked summon
		const summonSpells = {
			"summon beast": {type: "beast", forms: ["Bestial Spirit (Land)", "Bestial Spirit (Sea)", "Bestial Spirit (Sky)"]},
			"summon celestial": {type: "celestial", forms: ["Celestial Spirit (Avenger)", "Celestial Spirit (Defender)"]},
			"summon construct": {type: "construct", forms: ["Construct Spirit (Clay)", "Construct Spirit (Metal)", "Construct Spirit (Stone)"]},
			"summon elemental": {type: "elemental", forms: ["Elemental Spirit (Air)", "Elemental Spirit (Earth)", "Elemental Spirit (Fire)", "Elemental Spirit (Water)"]},
			"summon fey": {type: "fey", forms: ["Fey Spirit (Fuming)", "Fey Spirit (Mirthful)", "Fey Spirit (Tricksy)"]},
			"summon fiend": {type: "fiend", forms: ["Fiendish Spirit (Demon)", "Fiendish Spirit (Devil)", "Fiendish Spirit (Yugoloth)"]},
			"summon shadowspawn": {type: "undead", forms: ["Shadow Spirit (Fear)", "Shadow Spirit (Despair)", "Shadow Spirit (Fury)"]},
			"summon undead": {type: "undead", forms: ["Undead Spirit (Ghostly)", "Undead Spirit (Putrid)", "Undead Spirit (Skeletal)"]},
			"summon aberration": {type: "aberration", forms: ["Aberrant Spirit (Beholderkin)", "Aberrant Spirit (Slaad)", "Aberrant Spirit (Star Spawn)"]},
			"summon draconic spirit": {type: "dragon", forms: ["Draconic Spirit (Chromatic)", "Draconic Spirit (Metallic)", "Draconic Spirit (Gem)"]},
		};

		const summonInfo = summonSpells[spellNameLower];
		if (summonInfo) {
			await this._pShowSummonPicker(spell, summonInfo);
			return;
		}

		// Conjure spells (PHB 2014 versions summon actual creatures from bestiary)
		// Note: XPHB 2024 versions are effect-based spells, not creature summons
		const conjureSpellConfig = {
			"conjure animals": {type: "beast", level: 3, multiCreature: true},
			"conjure minor elementals": {type: "elemental", level: 4, multiCreature: true},
			"conjure woodland beings": {type: "fey", level: 4, multiCreature: true},
			"conjure fey": {type: ["fey", "beast"], level: 6, multiCreature: false, crBase: 6},
			"conjure elemental": {type: "elemental", level: 5, multiCreature: false, crBase: 5},
			"conjure celestial": {type: "celestial", level: 7, multiCreature: false, crBase: 4},
		};

		const conjureConfig = conjureSpellConfig[spellNameLower];
		if (conjureConfig) {
			// Only show picker for PHB (2014) versions - XPHB versions are effect spells
			if (spell.source === "PHB") {
				await this._pShowConjurePicker(spell, conjureConfig);
			} else {
				// XPHB versions are effect-based spells, not creature summons
				// No special handling needed - concentration tracking already works
			}
		}
	}

	/**
	 * Show summon spell picker (for Summon Beast, Summon Celestial, etc.)
	 */
	async _pShowSummonPicker (spell, summonInfo) {
		const slotLevel = spell.level || 2; // Minimum level for summon spells
		const pb = this._state.getProficiencyBonus?.() || 2;
		const spellMod = this._state.getAbilityMod?.(this._state.getSpellcastingAbility?.() || "int") || 0;

		// Choose form
		const chosenForm = await InputUiUtil.pGetUserEnum({
			title: `${spell.name} - Choose Form`,
			htmlDescription: `<div>Select the spirit form to summon:</div>`,
			values: summonInfo.forms,
			isResolveItem: true,
		});
		if (!chosenForm) return;

		// Base stats scale with spell level
		const hp = 30 + (10 * (slotLevel - 2)); // Scales by 10 HP per level above 2nd
		const ac = 11 + slotLevel;
		const attackBonus = pb + spellMod;
		const damage = `1d8 + ${3 + slotLevel}`;

		// Dismiss any existing concentration-linked companions
		const existingSummons = this._state.getActiveCompanions?.()?.filter(c => c.concentrationLinked) || [];
		for (const summon of existingSummons) {
			this._state.removeCompanion?.(summon.id);
		}

		// Create the summon
		this._state.addCompanion?.({
			name: chosenForm,
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: spell.name,
			creatureType: summonInfo.type,
			size: "M",
			ac,
			hp: {max: hp, current: hp},
			speed: this._getSummonSpeed(summonInfo.type, chosenForm),
			abilities: {str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14},
			senses: ["darkvision 60 ft."],
			passive: 10 + pb,
			actions: [
				{name: "Multiattack", entries: [`The spirit makes a number of attacks equal to half this spell's level (rounded down).`]},
				{name: "Attack", entries: [`Melee/Ranged Attack: +${attackBonus} to hit, reach 5 ft. or range 60 ft. Hit: ${damage} damage of a type matching the spirit.`]},
			],
			profBonus: pb,
			concentrationLinked: true, // IMPORTANT: Will be dismissed when concentration breaks
		});

		this._page?._saveCurrentCharacter?.();
		this._page?._renderCompanions?.();
		JqueryUtil.doToast({type: "success", content: `Summoned ${chosenForm}! (HP: ${hp}, AC: ${ac}) - Requires concentration.`});
	}

	/**
	 * Get speed for summoned spirits by type
	 */
	_getSummonSpeed (type, form) {
		const speeds = {walk: 30};

		// Add fly speed for certain types/forms
		if (type === "celestial" || form.includes("Sky") || form.includes("Air")) {
			speeds.fly = 40;
		}
		// Add swim speed for aquatic forms
		if (form.includes("Sea") || form.includes("Water")) {
			speeds.swim = 40;
		}
		// Ghostly undead fly
		if (form.includes("Ghostly")) {
			speeds.fly = 40;
			speeds.walk = 0;
		}

		return speeds;
	}

	/**
	 * Show conjure spell picker for PHB 2014 conjure spells
	 * @param {object} spell - The spell being cast
	 * @param {object} config - Configuration for the spell {type, level, multiCreature, crBase}
	 */
	async _pShowConjurePicker (spell, config) {
		const slotLevel = spell.level || config.level;

		// Dismiss any existing concentration-linked companions
		const existingSummons = this._state.getActiveCompanions?.()?.filter(c => c.concentrationLinked) || [];
		for (const summon of existingSummons) {
			this._state.removeCompanion?.(summon.id);
		}

		if (config.multiCreature) {
			// Multi-creature conjure spells (Conjure Animals, Minor Elementals, Woodland Beings)
			await this._pShowMultiConjurePicker(spell, config, slotLevel);
		} else {
			// Single-creature conjure spells (Conjure Fey, Elemental, Celestial)
			await this._pShowSingleConjurePicker(spell, config, slotLevel);
		}
	}

	/**
	 * Show picker for multi-creature conjure spells (Conjure Animals, etc.)
	 */
	async _pShowMultiConjurePicker (spell, config, slotLevel) {
		// Calculate slot multiplier for scaling
		let slotMultiplier = 1;
		if (config.level === 3) {
			// Conjure Animals: 5th=2×, 7th=3×, 9th=4×
			if (slotLevel >= 9) slotMultiplier = 4;
			else if (slotLevel >= 7) slotMultiplier = 3;
			else if (slotLevel >= 5) slotMultiplier = 2;
		} else if (config.level === 4) {
			// Conjure Minor Elementals / Woodland Beings: 6th=2×, 8th=3×
			if (slotLevel >= 8) slotMultiplier = 3;
			else if (slotLevel >= 6) slotMultiplier = 2;
		}

		// Options: 1×CR2, 2×CR1, 4×CR½, 8×CR¼
		const options = [
			{count: 1 * slotMultiplier, maxCR: 2, label: `${1 * slotMultiplier}× CR 2 or lower`},
			{count: 2 * slotMultiplier, maxCR: 1, label: `${2 * slotMultiplier}× CR 1 or lower`},
			{count: 4 * slotMultiplier, maxCR: 0.5, label: `${4 * slotMultiplier}× CR ½ or lower`},
			{count: 8 * slotMultiplier, maxCR: 0.25, label: `${8 * slotMultiplier}× CR ¼ or lower`},
		];

		// Choose option
		const chosenOption = await InputUiUtil.pGetUserEnum({
			title: `${spell.name}`,
			htmlDescription: `<div>Select how many creatures to conjure:</div>`,
			values: options.map(o => o.label),
			isResolveItem: true,
		});
		if (chosenOption == null) return;

		const option = options.find(o => o.label === chosenOption);
		if (!option) return;

		// Show creature picker
		await this._pShowConjureCreaturePicker(spell, config.type, option.maxCR, option.count);
	}

	/**
	 * Show picker for single-creature conjure spells (Conjure Fey, Elemental, Celestial)
	 */
	async _pShowSingleConjurePicker (spell, config, slotLevel) {
		// Calculate max CR based on spell level
		let maxCR = config.crBase;

		// Conjure Fey/Elemental: +1 CR per slot level above base
		if (spell.name.toLowerCase() === "conjure fey" || spell.name.toLowerCase() === "conjure elemental") {
			maxCR = config.crBase + (slotLevel - config.level);
		}
		// Conjure Celestial: CR 4 at 7th, CR 5 at 9th
		else if (spell.name.toLowerCase() === "conjure celestial") {
			maxCR = slotLevel >= 9 ? 5 : 4;
		}

		// Show creature picker
		await this._pShowConjureCreaturePicker(spell, config.type, maxCR, 1);
	}

	/**
	 * Show creature picker for conjure spells
	 * @param {object} spell - The spell being cast
	 * @param {string|string[]} creatureType - Type(s) to filter for
	 * @param {number} maxCR - Maximum CR allowed
	 * @param {number} count - Number of creatures to conjure
	 */
	async _pShowConjureCreaturePicker (spell, creatureType, maxCR, count) {
		// Load bestiary data
		const bestiaryData = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY);

		// Normalize creature type to array
		const types = Array.isArray(creatureType) ? creatureType : [creatureType];

		// Helper to parse CR value
		const parseCR = (cr) => {
			if (cr == null) return null;
			if (typeof cr === "number") return cr;
			if (typeof cr === "string") {
				if (cr === "1/8") return 0.125;
				if (cr === "1/4") return 0.25;
				if (cr === "1/2") return 0.5;
				return parseFloat(cr);
			}
			if (cr.cr != null) return parseCR(cr.cr);
			return null;
		};

		// Filter creatures by type and CR
		const validCreatures = bestiaryData.filter(creature => {
			// Check type
			const cType = typeof creature.type === "string" ? creature.type : creature.type?.type;
			if (!types.includes(cType)) return false;

			// Check CR
			const cr = parseCR(creature.cr);
			if (cr == null || cr > maxCR) return false;

			// Exclude swarms
			if (creature.type?.swarmSize || creature.name?.toLowerCase().includes("swarm")) return false;

			return true;
		});

		// Sort by CR (descending) then name
		validCreatures.sort((a, b) => {
			const crA = parseCR(a.cr) || 0;
			const crB = parseCR(b.cr) || 0;
			if (crA !== crB) return crB - crA;
			return a.name.localeCompare(b.name);
		});

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `✨ ${spell.name} - Choose Creature`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const typeLabel = types.join("/");
		const crLabel = maxCR === 0.25 ? "¼" : maxCR === 0.5 ? "½" : maxCR;

		modalInner.insertAdjacentHTML("beforeend", `
			<div class="charsheet__conjure-picker-header mb-3" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1)); border-radius: 8px; padding: 12px;">
				<div class="ve-flex ve-flex-v-center" style="gap: 10px;">
					<span style="font-size: 2em;">✨</span>
					<div>
						<div class="bold" style="font-size: 1.1em;">Conjure ${count}× ${typeLabel} (CR ${crLabel} or lower)</div>
						<div class="ve-muted ve-small">Select a creature to conjure. ${count > 1 ? `All ${count} will be the same type.` : ""}</div>
					</div>
				</div>
			</div>
		`);

		// Search filter
		const searchContainer = e_({outer: `<div class="ve-flex ve-flex-v-center mb-3" style="gap: 8px;"></div>`});
		modalInner.append(searchContainer);
		searchContainer.insertAdjacentHTML("beforeend", `<span style="font-size: 1.2em;">🔍</span>`);
		const search = e_({outer: `<input type="text" class="form-control" placeholder="Search creatures..." style="flex: 1;">`});
		searchContainer.append(search);

		// Creatures grid
		const list = e_({outer: `<div class="charsheet__conjure-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; max-height: 450px; overflow-y: auto; padding: 4px;"></div>`});
		modalInner.append(list);

		const renderList = (filter = "") => {
			list.innerHTML = "";
			const filteredCreatures = validCreatures.filter(c =>
				c.name.toLowerCase().includes(filter.toLowerCase()),
			);

			if (filteredCreatures.length === 0) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3" style="grid-column: 1 / -1;">No creatures match your search</div>`);
				return;
			}

			filteredCreatures.forEach(creature => {
				const hp = creature.hp?.average || creature.hp || "?";
				const ac = Array.isArray(creature.ac) ? creature.ac[0]?.ac || creature.ac[0] : creature.ac;
				const cr = creature.cr?.cr || creature.cr;
				const crDisplay = cr === 0.125 ? "⅛" : cr === 0.25 ? "¼" : cr === 0.5 ? "½" : cr;
				const speeds = this._formatCreatureSpeeds(creature.speed);

				// Get emoji based on creature type/name
				const emoji = this._getCreatureEmoji(creature);

				// Build hover link
				let nameDisplay;
				try {
					const hash = UrlUtil.encodeForHash([creature.name, creature.source].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: creature.source, hash});
					nameDisplay = `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs} class="charsheet__conjure-name">${creature.name}</a>`;
				} catch (e) {
					nameDisplay = `<span class="charsheet__conjure-name">${creature.name}</span>`;
				}

				const card = e_({outer: `
					<div class="charsheet__conjure-card" style="
						border: 2px solid var(--rgb-border-grey-muted);
						border-radius: 10px;
						padding: 12px;
						cursor: pointer;
						transition: all 0.2s ease;
						background: rgba(var(--rgb-bg-text), 0.02);
						position: relative;
					">
						<div class="ve-flex ve-flex-v-center mb-2" style="gap: 8px;">
							<span style="font-size: 1.8em;">${emoji}</span>
							<div class="ve-flex-col" style="flex: 1;">
								<div class="bold" style="font-size: 1.05em;">${nameDisplay}</div>
								<span class="ve-muted ve-small">CR ${crDisplay}</span>
							</div>
						</div>
						<div class="charsheet__conjure-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 0.85em;">
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">🛡️</span>
								<span>AC ${ac}</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">❤️</span>
								<span>${hp} HP</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px; grid-column: 1 / -1;">
								<span style="opacity: 0.7;">👟</span>
								<span class="ve-small">${speeds}</span>
							</div>
						</div>
						<button class="ve-btn ve-btn-xs ve-btn-primary btn-select-conjure" style="
							position: absolute;
							bottom: 8px;
							right: 8px;
							opacity: 0;
							transition: opacity 0.2s;
						">Summon</button>
					</div>
				`});

				list.append(card);

				// Hover effects
				card.addEventListener("mouseenter", function () {
					Object.assign(this.style, {
						borderColor: "var(--rgb-link)",
						background: "rgba(var(--rgb-link-rgb), 0.08)",
						transform: "translateY(-2px)",
						boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
					});
					this.querySelector(".btn-select-conjure").style.opacity = "1";
				});
				card.addEventListener("mouseleave", function () {
					Object.assign(this.style, {
						borderColor: "var(--rgb-border-grey-muted)",
						background: "rgba(var(--rgb-bg-text), 0.02)",
						transform: "translateY(0)",
						boxShadow: "none",
					});
					this.querySelector(".btn-select-conjure").style.opacity = "0";
				});

				const selectCreature = async () => {
					await this._createConjuredCreatures(creature, count, spell);
					doClose();
				};

				card.querySelector(".btn-select-conjure").addEventListener("click", async (evt) => {
					evt.stopPropagation();
					await selectCreature();
				});

				card.addEventListener("click", async (evt) => {
					if (evt.target.closest("a").length) return;
					await selectCreature();
				});
			});
		};

		search.addEventListener("input", () => renderList(search.value));
		renderList();
	}

	/**
	 * Get emoji for a creature based on its type/name
	 */
	_getCreatureEmoji (creature) {
		const name = creature.name.toLowerCase();
		const type = typeof creature.type === "string" ? creature.type : creature.type?.type;

		const nameEmojis = {
			wolf: "🐺", bear: "🐻", elk: "🦌", boar: "🐗", lion: "🦁", tiger: "🐅",
			panther: "🐆", ape: "🦍", eagle: "🦅", hawk: "🦅", owl: "🦉", raven: "🐦‍⬛",
			bat: "🦇", snake: "🐍", spider: "🕷️", scorpion: "🦂", rat: "🐀",
			cat: "🐱", dog: "🐕", horse: "🐴", deer: "🦌", frog: "🐸", toad: "🐸",
			crocodile: "🐊", shark: "🦈", octopus: "🐙", crab: "🦀", fish: "🐟",
			pixie: "🧚", sprite: "🧚", dryad: "🌳", satyr: "🐐", unicorn: "🦄",
			fire: "🔥", air: "💨", water: "💧", earth: "🗿", ice: "❄️", magma: "🌋",
			angel: "👼", celestial: "✨", couatl: "🐍", pegasus: "🐴",
		};

		for (const [key, emoji] of Object.entries(nameEmojis)) {
			if (name.includes(key)) return emoji;
		}

		// Fallback by type
		const typeEmojis = {
			beast: "🐾", fey: "🧚", elemental: "✨", celestial: "👼",
		};
		return typeEmojis[type] || "🐾";
	}

	/**
	 * Create conjured creatures and add them as a grouped companion
	 */
	async _createConjuredCreatures (creature, count, spell) {
		const hp = creature.hp?.average || creature.hp || 1;
		const ac = Array.isArray(creature.ac) ? creature.ac[0]?.ac || creature.ac[0] : creature.ac;
		const cr = creature.cr?.cr || creature.cr;
		const crDisplay = cr === 0.125 ? "⅛" : cr === 0.25 ? "¼" : cr === 0.5 ? "½" : cr;

		// Create HP array for individual tracking
		const hpArray = [];
		for (let i = 0; i < count; i++) {
			hpArray.push({current: hp, max: hp});
		}

		// Parse speed
		const speed = {walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0};
		if (creature.speed) {
			if (typeof creature.speed === "number") {
				speed.walk = creature.speed;
			} else {
				speed.walk = creature.speed.walk || 0;
				speed.fly = creature.speed.fly || 0;
				speed.swim = creature.speed.swim || 0;
				speed.climb = creature.speed.climb || 0;
				speed.burrow = creature.speed.burrow || 0;
			}
		}

		// Parse creature type
		const creatureType = typeof creature.type === "string" ? creature.type : (creature.type?.type || "beast");

		// Parse size
		const size = Array.isArray(creature.size) ? creature.size[0] : creature.size || "M";

		// Generate group ID
		const groupId = `conjure_${CryptUtil.uid()}`;

		// Add as grouped companion
		this._state.addCompanion?.({
			name: creature.name,
			source: creature.source,
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: spell.name,
			creatureType,
			size,
			ac,
			hp: {max: hp, current: hp}, // Base HP for display
			hpArray, // Individual HP tracking
			count,
			groupId,
			speed,
			abilities: {
				str: creature.str || 10,
				dex: creature.dex || 10,
				con: creature.con || 10,
				int: creature.int || 10,
				wis: creature.wis || 10,
				cha: creature.cha || 10,
			},
			senses: creature.senses || [],
			passive: creature.passive || 10,
			traits: creature.trait || [],
			actions: creature.action || [],
			reactions: creature.reaction || [],
			profBonus: this._state.getProficiencyBonus?.() || 2,
			concentrationLinked: true,
		});

		this._page?._saveCurrentCharacter?.();
		this._page?._renderCompanions?.();

		const creatureLabel = count > 1 ? `${count}× ${creature.name}` : creature.name;
		JqueryUtil.doToast({
			type: "success",
			content: `✨ Conjured ${creatureLabel} (CR ${crDisplay})! Requires concentration.`,
		});
	}

	/**
	 * Show familiar picker modal for Find Familiar spell
	 * @param {Object} opts - Options
	 * @param {boolean} opts.isWildCompanion - If true, familiar is summoned as Fey (Wild Companion)
	 */
	async _pShowFamiliarPicker (opts = {}) {
		const {isWildCompanion = false} = opts;

		// Load bestiary data
		const bestiaryData = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY);

		// Standard familiars from Find Familiar spell: CR 0 Tiny beasts
		// XPHB lists: Bat, Cat, Frog, Hawk, Lizard, Octopus, Owl, Rat, Raven, Spider, Weasel
		const standardFamiliarNames = new Set([
			"bat", "cat", "frog", "hawk", "lizard", "octopus", "owl", "rat", "raven", "spider", "weasel",
		]);

		// Filter for valid familiars: CR 0, Tiny beasts with familiar flag or in standard list
		const familiars = bestiaryData.filter(creature => {
			// Must be a beast
			if (creature.type !== "beast" && creature.type?.type !== "beast") return false;

			// Must be CR 0
			if (creature.cr !== "0" && creature.cr?.cr !== "0") return false;

			// Must be Tiny
			const size = Array.isArray(creature.size) ? creature.size[0] : creature.size;
			if (size !== "T") return false;

			// Accept if it has familiar flag or is in the standard list
			return creature.familiar || standardFamiliarNames.has(creature.name.toLowerCase());
		});

		// Sort alphabetically
		familiars.sort((a, b) => a.name.localeCompare(b.name));

		const modalTitle = isWildCompanion ? "🧚 Wild Companion" : "🐾 Choose Your Familiar";
		const headerEmoji = isWildCompanion ? "🧚" : "🦉";
		const headerTitle = isWildCompanion ? "Choose Your Wild Companion" : "Choose Your Familiar";
		const headerDesc = isWildCompanion
			? "Select a form for your Fey familiar. Cost: 1 Wild Shape use or spell slot."
			: "Select a beast to serve you. Your familiar appears within 10 feet.";

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: modalTitle,
			isMinHeight0: true,
			isWidth100: true,
		});

		modalInner.insertAdjacentHTML("beforeend", `
			<div class="charsheet__familiar-picker-header mb-3" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1)); border-radius: 8px; padding: 12px;">
				<div class="ve-flex ve-flex-v-center" style="gap: 10px;">
					<span style="font-size: 2em;">${headerEmoji}</span>
					<div>
						<div class="bold" style="font-size: 1.1em;">${headerTitle}</div>
						<div class="ve-muted ve-small">${headerDesc}</div>
					</div>
				</div>
			</div>
		`);

		// Search filter with icon
		const searchContainer = e_({outer: `<div class="ve-flex ve-flex-v-center mb-3" style="gap: 8px;"></div>`});
		modalInner.append(searchContainer);
		searchContainer.insertAdjacentHTML("beforeend", `<span style="font-size: 1.2em;">🔍</span>`);
		const search = e_({outer: `<input type="text" class="form-control" placeholder="Search familiars..." style="flex: 1;">`});
		searchContainer.append(search);

		// Familiars grid
		const list = e_({outer: `<div class="charsheet__familiar-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; max-height: 450px; overflow-y: auto; padding: 4px;"></div>`});
		modalInner.append(list);

		const renderList = (filter = "") => {
			list.innerHTML = "";
			const filteredFamiliars = familiars.filter(f =>
				f.name.toLowerCase().includes(filter.toLowerCase()),
			);

			if (filteredFamiliars.length === 0) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3" style="grid-column: 1 / -1;">No familiars match your search</div>`);
				return;
			}

			filteredFamiliars.forEach(creature => {
				const hp = creature.hp?.average || creature.hp || "?";
				const ac = Array.isArray(creature.ac) ? creature.ac[0]?.ac || creature.ac[0] : creature.ac;
				const speeds = this._formatCreatureSpeeds(creature.speed);
				
				// Get a fitting emoji for this creature
				const creatureEmojis = {
					bat: "🦇", cat: "🐱", frog: "🐸", hawk: "🦅", lizard: "🦎",
					octopus: "🐙", owl: "🦉", rat: "🐀", raven: "🐦‍⬛", spider: "🕷️",
					weasel: "🦨", snake: "🐍", crab: "🦀", fish: "🐟", seahorse: "🐴",
				};
				const emoji = creatureEmojis[creature.name.toLowerCase()] || "🐾";
				
				// Get primary sense
				const primarySense = creature.senses?.[0] || "Normal vision";

				// Build hover link for the creature
				let nameDisplay;
				try {
					const hash = UrlUtil.encodeForHash([creature.name, creature.source].join(HASH_LIST_SEP));
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: creature.source, hash});
					nameDisplay = `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs} class="charsheet__familiar-name">${creature.name}</a>`;
				} catch (e) {
					nameDisplay = `<span class="charsheet__familiar-name">${creature.name}</span>`;
				}

				const card = e_({outer: `
					<div class="charsheet__familiar-card" style="
						border: 2px solid var(--rgb-border-grey-muted);
						border-radius: 10px;
						padding: 12px;
						cursor: pointer;
						transition: all 0.2s ease;
						background: rgba(var(--rgb-bg-text), 0.02);
						position: relative;
					">
						<div class="ve-flex ve-flex-v-center mb-2" style="gap: 8px;">
							<span style="font-size: 1.8em;">${emoji}</span>
							<div class="bold" style="font-size: 1.05em;">${nameDisplay}</div>
						</div>
						<div class="charsheet__familiar-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 0.85em;">
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">🛡️</span>
								<span>AC ${ac}</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">❤️</span>
								<span>${hp} HP</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px; grid-column: 1 / -1;">
								<span style="opacity: 0.7;">👟</span>
								<span class="ve-small">${speeds}</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px; grid-column: 1 / -1;">
								<span style="opacity: 0.7;">👁️</span>
								<span class="ve-small ve-muted">${primarySense}</span>
							</div>
						</div>
						<button class="ve-btn ve-btn-xs ve-btn-primary btn-select-familiar" style="
							position: absolute;
							bottom: 8px;
							right: 8px;
							opacity: 0;
							transition: opacity 0.2s;
						">Select</button>
					</div>
				`});

				list.append(card);

				// Hover effects
				card.addEventListener("mouseenter", function () {
					Object.assign(this.style, {
						borderColor: "var(--rgb-link)",
						background: "rgba(var(--rgb-link-rgb), 0.08)",
						transform: "translateY(-2px)",
						boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
					});
					this.querySelector(".btn-select-familiar").style.opacity = "1";
				});
				card.addEventListener("mouseleave", function () {
					Object.assign(this.style, {
						borderColor: "var(--rgb-border-grey-muted)",
						background: "rgba(var(--rgb-bg-text), 0.02)",
						transform: "translateY(0)",
						boxShadow: "none",
					});
					this.querySelector(".btn-select-familiar").style.opacity = "0";
				});

				card.querySelector(".btn-select-familiar").addEventListener("click", async (evt) => {
					evt.stopPropagation();
					await this._selectFamiliar(creature, {isWildCompanion});
					doClose();
				});

				// Clicking the card also selects
				card.addEventListener("click", async (evt) => {
					if (evt.target.closest("a").length) return; // Don't select if clicking hover link
					await this._selectFamiliar(creature, {isWildCompanion});
					doClose();
				});
			});
		};

		search.addEventListener("input", () => renderList(search.value));
		renderList();
	}

	/**
	 * Format creature speeds for display
	 */
	_formatCreatureSpeeds (speed) {
		if (!speed) return "—";
		const parts = [];
		if (speed.walk) parts.push(`${speed.walk} ft.`);
		if (speed.fly) parts.push(`fly ${speed.fly} ft.`);
		if (speed.swim) parts.push(`swim ${speed.swim} ft.`);
		if (speed.climb) parts.push(`climb ${speed.climb} ft.`);
		if (speed.burrow) parts.push(`burrow ${speed.burrow} ft.`);
		return parts.length > 0 ? parts.join(", ") : "—";
	}

	/**
	 * Select a familiar and add it to companions
	 * @param {Object} creature - The bestiary creature data
	 * @param {Object} opts - Options
	 * @param {boolean} opts.isWildCompanion - If true, familiar is summoned as Fey (Wild Companion)
	 */
	async _selectFamiliar (creature, opts = {}) {
		const {isWildCompanion = false} = opts;

		// Remove any existing familiars first (you can only have one)
		const existingFamiliars = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR) || [];
		existingFamiliars.forEach(f => this._state.removeCompanion?.(f.id));

		// Determine origin and creature type
		const origin = isWildCompanion ? "Wild Companion" : "Find Familiar";
		const creatureType = isWildCompanion ? "fey" : "beast";

		// Add the new familiar
		const companionId = this._state.addCompanionFromBestiary?.(
			creature,
			CharacterSheetState.COMPANION_TYPES.FAMILIAR,
			origin,
			{creatureTypeOverride: creatureType}, // Pass type override
		);

		// Update the creature type if Wild Companion
		if (companionId && isWildCompanion) {
			const companion = this._state.getCompanion?.(companionId);
			if (companion) {
				companion.creatureType = "fey";
			}
		}

		if (companionId) {
			const emoji = isWildCompanion ? "🧚" : "🐾";
			const typeStr = isWildCompanion ? " (Fey)" : "";
			JqueryUtil.doToast({
				type: "success",
				content: `${emoji} ${creature.name}${typeStr} appears as your familiar!`,
			});

			// Update companions UI
			this._page._renderCompanions?.();
		}

		this._page.saveCharacter();
	}

	/**
	 * Prompt user to select a target for the spell
	 */
	async _promptSpellTarget (spell, spellData, effects, targetInfo) {
		const effectDescriptions = [];

		if (effects.healing) {
			const healDice = effects.healing.dice || "healing";
			effectDescriptions.push(`Heal (${healDice}${effects.healing.addModifier ? " + modifier" : ""})`);
		}
		if (effects.tempHp) {
			effectDescriptions.push(`Gain ${effects.tempHp.amount} temporary HP`);
		}
		if (effects.buffs?.length > 0) {
			for (const buff of effects.buffs) {
				if (buff.target === "ac") {
					effectDescriptions.push(`+${buff.value} AC`);
				} else if (buff.type === "rollBonus") {
					effectDescriptions.push(`+${buff.dice} to attacks/saves`);
				}
			}
		}
		if (effects.conditions?.length > 0) {
			// For beneficial conditions (like from buff spells on self)
			effectDescriptions.push(`Apply: ${effects.conditions.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")}`);
		}

		const effectsText = effectDescriptions.length > 0
			? `<div class="mt-2"><strong>Effects:</strong> ${effectDescriptions.join(", ")}</div>`
			: "";

		const durationText = effects.duration
			? `<div class="ve-muted ve-small">Duration: ${effects.duration.amount || "Until ended"} ${effects.duration.unit || ""}</div>`
			: "";

		const concentrationText = effects.concentration
			? `<div class="text-warning ve-small">⚠ Requires Concentration</div>`
			: "";

		return InputUiUtil.pGetUserEnum({
			title: `${spell.name} - Choose Target`,
			htmlDescription: `
				<div>Who is the target of this spell?</div>
				${effectsText}
				${durationText}
				${concentrationText}
			`,
			values: ["Self", "Another creature"],
			fnDisplay: v => v,
			isResolveItem: true,
		}).then(result => {
			if (result == null) return null;
			return result === "Self" ? "self" : "other";
		});
	}

	/**
	 * Apply spell effects to self and return list of applied effects
	 */
	async _applySpellEffectsToSelf (spell, spellData, effects, slotLevel) {
		const appliedEffects = [];
		const spellcastingMod = this._state.getAbilityMod(this._state.getSpellcastingAbility() || "int");

		// Apply healing
		if (effects.healing) {
			const healingResult = CharacterSheetState.calculateSpellHealing(spellData, slotLevel || spell.level, this._state);
			const healAmount = healingResult.total || 0;

			if (healAmount > 0) {
				const hp = this._state.getHp();
				const newHp = Math.min(hp.max, hp.current + healAmount);
				const actualHealing = newHp - hp.current;
				this._state.setHp(newHp, hp.max); // Fixed: setHp(current, max)
				appliedEffects.push(`Healed ${actualHealing} HP`);
			}
		}

		// Apply temporary HP
		if (effects.tempHp) {
			let tempHpAmount = effects.tempHp.amount;

			// Handle upcast scaling for temp HP
			if (slotLevel && spellData.level && slotLevel > spellData.level && spellData.entriesHigherLevel) {
				const text = JSON.stringify(spellData.entriesHigherLevel).toLowerCase();
				if (text.includes("temporary hit points")) {
					const scaleMatch = text.match(/increase(?:s)?\s*by\s*(\d+)/);
					if (scaleMatch) {
						tempHpAmount += parseInt(scaleMatch[1]) * (slotLevel - spellData.level);
					}
				}
			}

			this._state.setTempHp(tempHpAmount);
			appliedEffects.push(`+${tempHpAmount} temp HP`);
		}

		// Check if spell grants conditions - if so, apply the condition itself
		// The condition system already handles the mechanical effects
		const conditionsToApply = [];
		if (effects.conditions?.length > 0) {
			// Determine which conditions can be self-targeted (beneficial conditions)
			const hostileConditions = ["blinded", "charmed", "deafened", "frightened", "grappled",
				"paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];

			for (const condition of effects.conditions) {
				const conditionLower = condition.toLowerCase();
				// Only apply non-hostile conditions to self
				// "invisible" is a beneficial condition when cast on self
				if (!hostileConditions.includes(conditionLower)) {
					const conditionName = condition.charAt(0).toUpperCase() + condition.slice(1);
					this._state.addCondition(conditionName);
					conditionsToApply.push(conditionName);
					appliedEffects.push(`${conditionName} condition applied`);
				}
			}
		}

		// For condition-granting spells, create an active state to track duration/concentration
		// but DON'T add customEffects (the condition itself provides the effects)
		if (conditionsToApply.length > 0 && (effects.duration || effects.concentration)) {
			this._state.addActiveState("custom", {
				name: spell.name,
				icon: effects.concentration ? "🔮" : "✨",
				description: `Grants: ${conditionsToApply.join(", ")}`,
				sourceFeatureId: `spell_${spell.name}_${Date.now()}`,
				customEffects: [], // Empty - condition provides the effects
				isSpellEffect: true,
				spellSource: spell.source || spellData?.source || Parser.SRC_XPHB,
				concentration: effects.concentration || false,
				duration: effects.duration,
				grantsConditions: conditionsToApply, // Track which conditions this spell grants
			});
		}
		// For buff spells that DON'T grant conditions, apply the parsed buff effects
		else if ((effects.buffs?.length > 0 || effects.registryEffects?.length > 0 || effects.duration) && conditionsToApply.length === 0) {
			// Prefer registry effects when available (more reliable); fall back to parsed buffs
			let customEffects;
			if (effects.registryEffects?.length > 0) {
				customEffects = effects.registryEffects.map(re => ({...re}));
			} else {
				customEffects = (effects.buffs || []).map(buff => {
					// Map parseBuffs output to proper effect format
					if (buff.type === "rollBonus") {
						return {type: "rollBonus", dice: buff.dice, target: buff.applies?.[0] || "attack"};
					}
					if (buff.type === "rollPenalty") {
						return {type: "rollPenalty", dice: buff.dice, target: buff.applies?.[0] || "attack"};
					}
					if (buff.type === "extraDamage") {
						return {type: "extraDamage", dice: buff.dice, damageType: buff.damageType || ""};
					}
					if (buff.type === "resistance") {
						return {type: "resistance", target: `damage:${buff.damageType}`};
					}
					if (buff.type === "advantage") {
						return {type: "advantage", target: buff.target};
					}
					if (buff.type === "formula") {
						return {type: "setAc", baseAc: buff.baseAc, addDex: buff.addDex};
					}
					if (buff.type === "minimum") {
						return {type: "minAc", value: buff.minAc};
					}
					if (buff.type === "multiplier" && buff.target === "speed") {
						return {type: "speedMultiplier", value: buff.value};
					}
					if (buff.type === "bonus" && buff.target === "speed") {
						return {type: "bonus", target: "speed", value: buff.value};
					}
					// Default: numeric bonus
					return {type: "bonus", target: buff.target, value: buff.value};
				});
			}

			// Use activateState to trigger side effects like _applyTempHpFromState
			const stateId = this._state.activateState("custom", {
				name: spell.name,
				icon: effects.concentration ? "🔮" : "✨",
				description: `Spell effect: ${spell.name}`,
				sourceFeatureId: `spell_${spell.name}_${Date.now()}`,
				customEffects,
				isSpellEffect: true,
				spellSource: spell.source || spellData?.source || Parser.SRC_XPHB,
				concentration: effects.concentration || false,
				duration: effects.duration,
			});

			// Build description of applied effects
			const buffDescriptions = [];
			for (const eff of customEffects) {
				if (eff.target === "ac" && eff.type === "bonus") buffDescriptions.push(`+${eff.value} AC`);
				else if (eff.type === "setAc") buffDescriptions.push(`AC = ${eff.baseAc} + DEX`);
				else if (eff.type === "minAc") buffDescriptions.push(`AC minimum ${eff.value}`);
				else if (eff.type === "rollBonus") buffDescriptions.push(`+${eff.dice} to ${eff.target} rolls`);
				else if (eff.type === "rollPenalty") buffDescriptions.push(`-${eff.dice} penalty`);
				else if (eff.type === "extraDamage") buffDescriptions.push(`+${eff.dice} ${eff.damageType} damage`);
				else if (eff.type === "resistance") buffDescriptions.push(`Resistance: ${eff.target.replace("damage:", "")}`);
				else if (eff.type === "advantage") buffDescriptions.push(`Advantage on ${eff.target}`);
				else if (eff.type === "speedMultiplier") buffDescriptions.push(`Speed ×${eff.value}`);
				else if (eff.type === "bonus" && eff.target === "speed") buffDescriptions.push(`+${eff.value} ft speed`);
				else if (eff.type === "bonus") buffDescriptions.push(`+${eff.value} ${eff.target}`);
			}
			if (buffDescriptions.length > 0) {
				appliedEffects.push(buffDescriptions.join(", "));
			} else if (stateId) {
				appliedEffects.push(`${spell.name} active`);
			}
		}

		// Save character after applying effects
		this._page.saveCharacter();

		return appliedEffects;
	}

	_rollSpellDamage (spellData, slotLevel, baseLevel, appliedMetamagic = null) {
		// Check for cantrip scaling
		if (spellData.scalingLevelDice) {
			return this._rollCantripDamage(spellData, appliedMetamagic);
		}

		// Look for damage dice in spell entries
		const damageTypes = spellData.damageInflict || [];
		const entries = JSON.stringify(spellData.entries || []);

		// Find damage dice patterns like {@damage 8d6}
		const damageMatch = entries.match(/\{@damage\s+([^}]+)\}/);
		if (!damageMatch) return "";

		let baseDice = damageMatch[1];

		// Handle upcast damage
		if (slotLevel && slotLevel > baseLevel && spellData.entriesHigherLevel) {
			const higherStr = JSON.stringify(spellData.entriesHigherLevel);
			// Look for scaledamage pattern: {@scaledamage 8d6|3-9|1d6}
			const scaleMatch = higherStr.match(/\{@scaledamage\s+[^|]+\|[^|]+\|([^}]+)\}/);
			if (scaleMatch) {
				const extraDice = scaleMatch[1];
				const levelsAbove = slotLevel - baseLevel;
				// Parse the extra dice and multiply by levels above
				const diceMatch = extraDice.match(/(\d+)d(\d+)/);
				if (diceMatch) {
					const numDice = parseInt(diceMatch[1]) * levelsAbove;
					const diceSize = diceMatch[2];
					// Add extra dice to base
					const baseMatch = baseDice.match(/(\d+)d(\d+)/);
					if (baseMatch && baseMatch[2] === diceSize) {
						baseDice = `${parseInt(baseMatch[1]) + numDice}d${diceSize}`;
					}
				}
			}
		}

		// Roll the damage
		try {
			const isOvercharged = appliedMetamagic?.key === "overcharged";
			const baseDamage = isOvercharged
				? this._getMaximizedDiceTotal(baseDice)
				: Renderer.dice.parseRandomise2(baseDice);
			const spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
			const total = baseDamage + spellDamageBonus;
			const damageType = damageTypes[0] || "damage";
			const bonusStr = spellDamageBonus ? ` + ${spellDamageBonus} item` : "";
			const metamagicLabel = isOvercharged ? " maximized" : "";
			return {
				text: `<br>Damage: <strong>${total}</strong> ${damageType} (${baseDice}${bonusStr}${metamagicLabel})`,
				total,
				dice: baseDice,
				damageType,
			};
		} catch (e) {
			return null;
		}
	}

	_rollCantripDamage (spellData, appliedMetamagic = null) {
		const characterLevel = this._state.getTotalLevel();
		const scaling = Array.isArray(spellData.scalingLevelDice)
			? spellData.scalingLevelDice[0]
			: spellData.scalingLevelDice;

		if (!scaling?.scaling) return "";

		// Find the appropriate dice for character level
		let dice = "1d8"; // fallback
		const levels = Object.keys(scaling.scaling).map(Number).sort((a, b) => a - b);
		for (const lvl of levels) {
			if (characterLevel >= lvl) {
				dice = scaling.scaling[lvl];
			}
		}

		try {
			const isOvercharged = appliedMetamagic?.key === "overcharged";
			const baseDamage = isOvercharged
				? this._getMaximizedDiceTotal(dice)
				: Renderer.dice.parseRandomise2(dice);
			const spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
			const total = baseDamage + spellDamageBonus;
			const damageTypes = spellData.damageInflict || [];
			const damageType = damageTypes[0] || "damage";
			const bonusStr = spellDamageBonus ? ` + ${spellDamageBonus} item` : "";
			const metamagicLabel = isOvercharged ? " maximized" : "";
			return {
				text: `<br>Damage: <strong>${total}</strong> ${damageType} (${dice}${bonusStr}${metamagicLabel})`,
				total,
				dice,
				damageType,
			};
		} catch (e) {
			return null;
		}
	}

	_getMaximizedDiceTotal (diceExpression) {
		if (!diceExpression || typeof diceExpression !== "string") return 0;
		const cleaned = diceExpression.replace(/\s+/g, "");
		const match = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
		if (!match) return Renderer.dice.parseRandomise2(diceExpression);

		const [, countRaw, sizeRaw, modifierRaw] = match;
		const count = Number(countRaw);
		const size = Number(sizeRaw);
		const modifier = modifierRaw ? Number(modifierRaw) : 0;
		return (count * size) + modifier;
	}

	_rollMetamagicAimedBonus () {
		const total = Renderer.dice.parseRandomise2("1d6");
		return {dice: "1d6", total};
	}

	/**
	 * Prompt the user to change damage type via Transmuted Spell (tuned passive).
	 * @param {object} damageResult - Damage result from _rollSpellDamage/_rollCantripDamage
	 * @returns {object|null} Modified damage result with new type, or null if unchanged
	 */
	async _pMaybeApplyTransmutedDamage (damageResult) {
		if (!damageResult?.damageType) return null;

		const transmutableTypes = ["acid", "cold", "fire", "lightning", "poison", "thunder"];
		const otherTypes = transmutableTypes.filter(t => t !== damageResult.damageType);
		if (!otherTypes.length) return null;

		const keepLabel = `Keep ${damageResult.damageType}`;
		const values = [keepLabel, ...otherTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1))];

		const choice = await InputUiUtil.pGetUserEnum({
			title: "Transmuted Spell",
			htmlDescription: `<div>Transmuted Spell is tuned. Change <strong>${damageResult.damageType}</strong> damage to another type?</div>`,
			values,
			fnDisplay: v => v,
			isResolveItem: true,
		});

		if (choice == null || choice === keepLabel) return null;

		const newType = choice.toLowerCase();
		return {
			...damageResult,
			damageType: newType,
			text: damageResult.text.replace(damageResult.damageType, newType),
			transmuted: true,
			originalDamageType: damageResult.damageType,
		};
	}

	/**
	 * Prompt the user to reroll damage dice via Empowered Spell (tuned passive).
	 * The sorcerer can reroll up to CHA modifier damage dice and must use the new rolls.
	 * @param {object} damageResult - Damage result from _rollSpellDamage/_rollCantripDamage
	 * @returns {object|null} Modified damage result with rerolled dice, or null if unchanged
	 */
	async _pMaybeApplyEmpoweredReroll (damageResult) {
		if (!damageResult?.dice) return null;

		const chaMod = Math.max(1, this._state.getAbilityMod("cha"));
		const diceMatch = damageResult.dice.match(/^(\d+)d(\d+)$/);
		if (!diceMatch) return null;

		const numDice = Number(diceMatch[1]);
		const diceSize = Number(diceMatch[2]);
		const maxReroll = Math.min(chaMod, numDice);

		const rerollCount = await InputUiUtil.pGetUserEnum({
			title: "Empowered Spell",
			htmlDescription: `<div>Empowered Spell is tuned. Reroll up to <strong>${maxReroll}</strong> damage ${maxReroll === 1 ? "die" : "dice"} (CHA mod).<br>Current damage: <strong>${damageResult.total}</strong> (${damageResult.dice}${damageResult.damageType ? ` ${damageResult.damageType}` : ""})</div>`,
			values: ["Keep current", ...Array.from({length: maxReroll}, (_, i) => `Reroll ${i + 1} ${(i + 1) === 1 ? "die" : "dice"}`)],
			fnDisplay: v => v,
			isResolveItem: true,
		});

		if (rerollCount == null || rerollCount === "Keep current") return null;

		const countToReroll = Number(rerollCount.match(/\d+/)[0]);
		const keptCount = numDice - countToReroll;

		// Calculate kept dice portion (proportional from original total)
		const avgPerDie = damageResult.total / numDice;
		const keptTotal = Math.round(avgPerDie * keptCount);

		// Roll new dice
		let rerolledTotal = 0;
		for (let i = 0; i < countToReroll; i++) {
			rerolledTotal += Renderer.dice.parseRandomise2(`1d${diceSize}`);
		}

		const newTotal = keptTotal + rerolledTotal;
		const modifier = damageResult.text.match(/\+\s*(\d+)/)?.[1];
		const totalWithMod = modifier ? newTotal + Number(modifier) : newTotal;
		const originalTotal = damageResult.total;

		return {
			...damageResult,
			total: totalWithMod,
			originalTotal,
			rerolledCount: countToReroll,
			text: damageResult.text
				.replace(/\d+(?=<\/strong>)/, String(totalWithMod))
				.replace(/(\(.*?\))/, `(${damageResult.dice}, rerolled ${countToReroll})`),
		};
	}

	/**
	 * Generate informational notes for tuned passive metamagics that affect the current spell.
	 * These are non-interactive — just annotations in the cast toast.
	 * @param {object} opts
	 * @param {object} opts.spellData - Full spell data from _allSpells
	 * @param {object|null} opts.damageResult - Damage roll result if applicable
	 * @returns {string[]} Array of note strings to append to metamagicNotes
	 */
	_getTunedPassiveNotes ({spellData, damageResult}) {
		const notes = [];
		if (!this._state.getTunedMetamagics?.()?.length) return notes;

		const tuned = this._state.getTunedMetamagics();

		// Careful Spell: chosen creatures auto-succeed on saves
		if (tuned.includes("careful") && spellData?.savingThrow?.length) {
			const chaMod = Math.max(1, this._state.getAbilityMod("cha"));
			notes.push(`Careful Spell: up to ${chaMod} creature${chaMod > 1 ? "s" : ""} you choose auto-succeed on the ${spellData.savingThrow.join("/")} save`);
		}

		// Distant Spell: double range or make touch → 30ft
		if (tuned.includes("distant") && spellData?.range) {
			const rangeType = spellData.range?.distance?.type;
			if (rangeType === "touch") {
				notes.push("Distant Spell: range changed from Touch to 30 feet");
			} else if (rangeType === "feet" && spellData.range?.distance?.amount) {
				const doubled = spellData.range.distance.amount * 2;
				notes.push(`Distant Spell: range doubled to ${doubled} feet`);
			}
		}

		// Extended Spell: double duration (max 24h)
		if (tuned.includes("extended") && spellData?.duration?.length) {
			const dur = spellData.duration[0];
			if (dur.duration?.amount && dur.duration?.type) {
				const durationMinutes = this._getDurationInMinutes(dur);
				const doubled = durationMinutes * 2;
				const maxMinutes = 24 * 60;
				const capped = Math.min(doubled, maxMinutes);
				const displayDuration = this._formatDurationMinutes(capped);
				notes.push(`Extended Spell: duration doubled to ${displayDuration}${capped === maxMinutes ? " (24h cap)" : ""}`);
			}
		}

		// Resonant Spell: dispel/counterspell attempts have disadvantage
		if (tuned.includes("resonant")) {
			notes.push("Resonant Spell: dispel/counterspell attempts against this spell have disadvantage");
		}

		// Split Spell: split AoE between two points (10ft+ areas only)
		if (tuned.includes("split")) {
			const aoeSize = this._getSpellAreaSize(spellData);
			if (aoeSize >= 10) {
				notes.push(`Split Spell: AoE can be split between two points within range`);
			}
		}

		// Supple Spell: adjust AoE by ± half (10ft+ areas only)
		if (tuned.includes("supple")) {
			const aoeSize = this._getSpellAreaSize(spellData);
			if (aoeSize >= 10) {
				const half = Math.floor(aoeSize / 2);
				notes.push(`Supple Spell: AoE can be adjusted by ±${half} feet (${aoeSize - half}ft to ${aoeSize + half}ft)`);
			}
		}

		return notes;
	}

	/**
	 * Convert a duration object to minutes for comparison.
	 */
	_getDurationInMinutes (dur) {
		const amount = dur.duration?.amount || 0;
		switch (dur.duration?.type) {
			case "round": return amount / 10; // ~6 seconds
			case "minute": return amount;
			case "hour": return amount * 60;
			case "day": return amount * 60 * 24;
			default: return amount;
		}
	}

	/**
	 * Format a duration in minutes back into a human-readable string.
	 */
	_formatDurationMinutes (minutes) {
		if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} day${minutes / (60 * 24) > 1 ? "s" : ""}`;
		if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes / 60 > 1 ? "s" : ""}`;
		return `${minutes} minute${minutes > 1 ? "s" : ""}`;
	}

	/**
	 * Extract the AoE size of a spell in feet.
	 * Checks range.type for area (cone, sphere, etc.) then falls back to parsing entries.
	 * @param {object} spellData - Full spell data
	 * @returns {number} AoE size in feet, or 0 if not an AoE spell
	 */
	_getSpellAreaSize (spellData) {
		// Check structured range (e.g., {type: "cone", distance: {type: "feet", amount: 60}})
		if (spellData?.range?.type && !["point", "special"].includes(spellData.range.type)) {
			return spellData.range.distance?.amount || 0;
		}

		// Fall back to parsing entries for "N-foot radius/cube/cone/sphere/line" patterns
		const entriesStr = JSON.stringify(spellData?.entries || []);
		const aoeMatch = entriesStr.match(/(\d+)-foot[- ](?:radius|cube|cone|sphere|line|emanation|cylinder)/i);
		return aoeMatch ? Number(aoeMatch[1]) : 0;
	}

	_rollSpellHealing (spellData, slotLevel, baseLevel) {
		const entries = JSON.stringify(spellData.entries || []);
		const entriesLower = entries.toLowerCase();

		// Only match actual healing spells - look for "regain" or "restore" with "hit points"
		// This avoids false positives like Sleep which mentions "hit points" but isn't healing
		const isHealing = (entriesLower.includes("regain") && entriesLower.includes("hit point"))
			|| (entriesLower.includes("restore") && entriesLower.includes("hit point"))
			|| entriesLower.includes("healing")
			|| spellData.miscTags?.includes("HL"); // HL = Healing tag

		if (!isHealing) {
			return "";
		}

		// Find dice pattern
		const healMatch = entries.match(/\{@dice\s+([^}]+)\}/) || entries.match(/\{@damage\s+([^}]+)\}/);
		if (!healMatch) return "";

		let baseDice = healMatch[1];
		const spellcastingMod = this._state.getAbilityMod(this._state.getSpellcastingAbility() || "int");

		// Handle upcast healing
		if (slotLevel && slotLevel > baseLevel && spellData.entriesHigherLevel) {
			const higherStr = JSON.stringify(spellData.entriesHigherLevel);
			const scaleMatch = higherStr.match(/\{@scaledice\s+[^|]+\|[^|]+\|([^}|]+)/);
			if (scaleMatch) {
				const extraDice = scaleMatch[1];
				const levelsAbove = slotLevel - baseLevel;
				const diceMatch = extraDice.match(/(\d+)d(\d+)/);
				if (diceMatch) {
					const numDice = parseInt(diceMatch[1]) * levelsAbove;
					const diceSize = diceMatch[2];
					const baseMatch = baseDice.match(/(\d+)d(\d+)/);
					if (baseMatch && baseMatch[2] === diceSize) {
						baseDice = `${parseInt(baseMatch[1]) + numDice}d${diceSize}`;
					}
				}
			}
		}

		try {
			const diceTotal = Renderer.dice.parseRandomise2(baseDice);
			const total = diceTotal + spellcastingMod;
			return `<br>Healing: <strong>${total}</strong> HP (${baseDice} + ${spellcastingMod})`;
		} catch (e) {
			return "";
		}
	}

	_removeSpell (spellId) {
		this._state.removeSpell(spellId);
		this._renderSpellList();
		// Update combat spells tab
		if (this._page._combat) {
			this._page._combat.renderCombatSpells();
		}
		this._page.saveCharacter();
	}

	_togglePrepared (spellId) {
		const spells = this._state.getSpells();
		const spell = spells.find(s => s.id === spellId);
		if (!spell || spell.level === 0) return; // Can't unprepare cantrips

		// Use state method to persist the change
		this._state.setSpellPrepared(spellId, !spell.prepared);
		this._renderSpellList();
		this._renderSpellcastingStats(); // Update prepared count
		// Update combat spells tab
		if (this._page._combat) {
			this._page._combat.renderCombatSpells();
		}
		this._page.saveCharacter();
	}

	async _showSpellInfo (spellId) {
		const spells = this._state.getSpells();
		const spell = spells.find(s => s.id === spellId);
		if (!spell) return;

		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);
		if (!spellData) return;

		// Show spell details using UiUtil modal
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: spellData.name,
			isMinHeight0: true,
		});

		const content = Renderer.get().render({type: "entries", entries: spellData.entries || []});
		const higherLevel = spellData.entriesHigherLevel
			? `<p><strong>At Higher Levels.</strong> ${Renderer.get().render({type: "entries", entries: spellData.entriesHigherLevel})}</p>`
			: "";

		modalInner.insertAdjacentHTML("beforeend", `<div class="rd__b">${content}${higherLevel}</div>`);

		{ const _cl = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`; modalInner.append(_cl); _cl.querySelector("button").addEventListener("click", () => doClose(false)); }
	}

	// #region Rendering
	renderSlots () {
		const container = document.getElementById("charsheet-spell-slots");
		if (!container) return;

		container.innerHTML = "";

		// Debug: Log all slot maxes
		const allSlots = {};
		for (let i = 1; i <= 9; i++) allSlots[i] = this._state.getSpellSlotsMax(i);

		let slotsRendered = 0;
		for (let level = 1; level <= 9; level++) {
			const max = this._state.getSpellSlotsMax(level);
			if (max <= 0) continue;

			slotsRendered++;
			const current = this._state.getSpellSlotsCurrent(level);

			// Build pips HTML - filled = available, empty = used
			// Show first 'current' pips as filled (available), rest as empty (used)
			let pipsHtml = "";
			for (let i = 0; i < max; i++) {
				const isAvailable = i < current; // First 'current' slots are available (filled)
				pipsHtml += `<span class="charsheet__spell-slot-pip ${isAvailable ? "" : "charsheet__spell-slot-pip--used"}" style="display: inline-block; width: 18px; height: 18px; border: 2px solid #337ab7; border-radius: 50%; margin: 2px; ${isAvailable ? "background: #337ab7;" : "background: transparent;"}"></span>`;
			}

			const row = e_({outer: `
				<div class="charsheet__spell-slot-level" data-spell-level="${level}">
					<div class="charsheet__spell-slot-level-label">Level ${level}</div>
					<div class="charsheet__spell-slot-pips" style="display: flex; gap: 4px; margin-top: 4px;">
						${pipsHtml}
					</div>
				</div>
			`});


			container.append(row);
		}

		// Render Warlock Pact Slots
		const pactSlots = this._state.getPactSlots();
		if (pactSlots && pactSlots.max > 0) {
			slotsRendered++;

			// Build pips - filled = available, empty = used
			let pactPipsHtml = "";
			for (let i = 0; i < pactSlots.max; i++) {
				const isAvailable = i < pactSlots.current;
				pactPipsHtml += `<span class="charsheet__spell-slot-pip charsheet__spell-slot-pip--pact ${isAvailable ? "" : "charsheet__spell-slot-pip--used"}" data-pact-slot="true" style="display: inline-block; width: 18px; height: 18px; border: 2px solid #9b59b6; border-radius: 50%; margin: 2px; ${isAvailable ? "background: #9b59b6;" : "background: transparent;"}"></span>`;
			}

			const pactRow = e_({outer: `
				<div class="charsheet__spell-slot-level charsheet__spell-slot-level--pact" data-spell-level="pact" style="border-color: #9b59b6;">
					<div class="charsheet__spell-slot-level-label" style="color: #9b59b6;">Pact (Lvl ${pactSlots.level})</div>
					<div class="charsheet__spell-slot-pips" style="display: flex; gap: 4px; margin-top: 4px;">
						${pactPipsHtml}
					</div>
				</div>
			`});

			container.append(pactRow);
		}


		// Show if no slots
		if (!container.children.length) {
			container.insertAdjacentHTML("beforeend", `<p class="ve-muted">No spell slots available</p>`);
		}
	}

	_renderSpellList () {
		const container = document.getElementById("charsheet-spell-lists");
		if (!container) return;

		container.innerHTML = "";

		// Render innate spells first (from features/feats)
		this._renderInnateSpells(container);

		let spells = this._state.getSpells();
		// Apply Thelemar rarity to stored spells (for backwards compatibility and display)
		spells = this._applyThelemarSpellRarity(spells);

		// Check if this character has a spellbook-style caster (Wizard)
		const classes = this._state.getClasses() || [];
		const hasSpellbook = classes.some(c => c.name === "Wizard");
		const spellcastingInfo = this._state.getSpellcastingInfo();

		// Apply filters
		let filtered = spells;
		if (this._spellFilter) {
			filtered = filtered.filter(s => s.name.toLowerCase().includes(this._spellFilter));
		}
		if (this._spellLevelFilter !== "all") {
			filtered = filtered.filter(s => s.level === parseInt(this._spellLevelFilter));
		}

		// For spellbook casters, separate prepared vs unprepared spells
		if (hasSpellbook && filtered.some(s => s.level > 0)) {
			this._renderSpellbookLayout(container, filtered, spellcastingInfo);
		} else {
			// Standard layout for known casters
			this._renderStandardSpellLayout(container, filtered, spellcastingInfo);
		}

		const innateSpells = this._state.getInnateSpells();
		if (!filtered.length && !innateSpells.length) {
			container.insertAdjacentHTML("beforeend", `<p class="ve-muted text-center">No spells</p>`);
		}
	}

	/**
	 * Render standard spell layout - grouped by level
	 */
	_renderStandardSpellLayout (container, spells, spellcastingInfo) {
		// Group by level
		const grouped = {
			0: {name: "Cantrips", spells: []},
			1: {name: "1st Level", spells: []},
			2: {name: "2nd Level", spells: []},
			3: {name: "3rd Level", spells: []},
			4: {name: "4th Level", spells: []},
			5: {name: "5th Level", spells: []},
			6: {name: "6th Level", spells: []},
			7: {name: "7th Level", spells: []},
			8: {name: "8th Level", spells: []},
			9: {name: "9th Level", spells: []},
		};

		spells.forEach(spell => {
			if (grouped[spell.level]) {
				grouped[spell.level].spells.push(spell);
			}
		});

		// Update Cantrips header with count
		if (spellcastingInfo && spellcastingInfo.cantripsKnown > 0) {
			const allCantrips = this._state.getCantripsKnown();
			const count = allCantrips.filter(c => !c.sourceFeature).length;
			const limit = spellcastingInfo.cantripsKnown;
			const colorClass = count > limit ? "text-danger" : (count === limit ? "text-success" : "");
			grouped[0].name = `Cantrips <span class="ve-small ve-muted">(${count}/${limit})</span>`;
			if (count > limit) {
				grouped[0].name = `Cantrips <span class="ve-small ${colorClass}" title="You have more cantrips than your class level allows">(${count}/${limit}) <span class="glyphicon glyphicon-alert"></span></span>`;
			}
		}

		// Render each group
		Object.entries(grouped).forEach(([level, group]) => {
			if (!group.spells.length) return;

			const groupEl = e_({outer: `
				<div class="charsheet__spell-group">
					<h5 class="charsheet__spell-group-header">${group.name}</h5>
					<div class="charsheet__spell-group-list"></div>
				</div>
			`});

			const list = groupEl.querySelector(".charsheet__spell-group-list");

			group.spells.sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
				const item = this._renderSpellItem(spell);
				list.append(item);
			});

			container.append(groupEl);
		});
	}

	/**
	 * Render spellbook layout - separates prepared spells from unprepared (for Wizards)
	 */
	_renderSpellbookLayout (container, spells, spellcastingInfo) {
		const cantrips = spells.filter(s => s.level === 0);
		const leveledSpells = spells.filter(s => s.level > 0);
		const preparedSpells = leveledSpells.filter(s => s.prepared || s.alwaysPrepared);
		const unpreparedSpells = leveledSpells.filter(s => !s.prepared && !s.alwaysPrepared);

		// Calculate prepared limits
		const currentPrepared = preparedSpells.length;
		const maxPrepared = spellcastingInfo?.preparedMax || spellcastingInfo?.max || 0;
		const preparedColorClass = currentPrepared > maxPrepared ? "text-danger" : (currentPrepared === maxPrepared ? "text-success" : "");

		// Render cantrips first (always "prepared")
		if (cantrips.length) {
			let cantripsHeader = "Cantrips";
			if (spellcastingInfo && spellcastingInfo.cantripsKnown > 0) {
				const allCantrips = this._state.getCantripsKnown();
				const count = allCantrips.filter(c => !c.sourceFeature).length;
				const limit = spellcastingInfo.cantripsKnown;
				const colorClass = count > limit ? "text-danger" : (count === limit ? "text-success" : "");
				cantripsHeader = `Cantrips <span class="ve-small ${colorClass}">(${count}/${limit})</span>`;
			}

			const cantripsGroup = e_({outer: `
				<div class="charsheet__spell-group">
					<h5 class="charsheet__spell-group-header">${cantripsHeader}</h5>
					<div class="charsheet__spell-group-list"></div>
				</div>
			`});

			const list = cantripsGroup.querySelector(".charsheet__spell-group-list");
			cantrips.sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
				list.append(this._renderSpellItem(spell));
			});
			container.append(cantripsGroup);
		}

		// Render PREPARED spells section
		const preparedSection = e_({outer: `
			<div class="charsheet__spell-section charsheet__spell-section--prepared">
				<h4 class="charsheet__spell-section-header">
					<span class="charsheet__spell-section-icon">📖</span>
					Prepared Spells
					<span class="ve-small ${preparedColorClass} ml-2">(${currentPrepared}/${maxPrepared})</span>
				</h4>
				<div class="charsheet__spell-section-content" id="charsheet-prepared-spells-content"></div>
			</div>
		`});

		const preparedContent = preparedSection.querySelector("#charsheet-prepared-spells-content");

		if (preparedSpells.length) {
			// Group prepared spells by level
			const groupedPrepared = this._groupSpellsByLevel(preparedSpells);
			this._renderGroupedSpells(preparedContent, groupedPrepared);
		} else {
			preparedContent.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-text-center py-2">No spells prepared. Prepare spells from your spellbook below.</p>`);
		}

		container.append(preparedSection);

		// Render SPELLBOOK section (unprepared spells)
		const totalInSpellbook = leveledSpells.length;
		const spellbookSection = e_({outer: `
			<div class="charsheet__spell-section charsheet__spell-section--spellbook">
				<h4 class="charsheet__spell-section-header">
					<span class="charsheet__spell-section-icon">📚</span>
					Spellbook
					<span class="ve-small ve-muted ml-2">(${totalInSpellbook} spells total)</span>
				</h4>
				<div class="charsheet__spell-section-content" id="charsheet-spellbook-content"></div>
			</div>
		`});

		const spellbookContent = spellbookSection.querySelector("#charsheet-spellbook-content");

		if (unpreparedSpells.length) {
			// Group unprepared spells by level
			const groupedUnprepared = this._groupSpellsByLevel(unpreparedSpells);
			this._renderGroupedSpells(spellbookContent, groupedUnprepared, true); // true = show prepare button
		} else if (preparedSpells.length) {
			spellbookContent.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-text-center py-2">All spellbook spells are currently prepared!</p>`);
		} else {
			spellbookContent.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-text-center py-2">No spells in spellbook. Add spells using the + button above.</p>`);
		}

		container.append(spellbookSection);
	}

	/**
	 * Group spells by level into an object
	 */
	_groupSpellsByLevel (spells) {
		const grouped = {};
		spells.forEach(spell => {
			if (!grouped[spell.level]) {
				grouped[spell.level] = [];
			}
			grouped[spell.level].push(spell);
		});
		return grouped;
	}

	/**
	 * Render grouped spells into a container
	 */
	_renderGroupedSpells (container, groupedSpells, showPrepareHint = false) {
		const levelNames = {
			1: "1st Level",
			2: "2nd Level",
			3: "3rd Level",
			4: "4th Level",
			5: "5th Level",
			6: "6th Level",
			7: "7th Level",
			8: "8th Level",
			9: "9th Level",
		};

		Object.entries(groupedSpells).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([level, spells]) => {
			const group = e_({outer: `
				<div class="charsheet__spell-group charsheet__spell-group--compact">
					<h5 class="charsheet__spell-group-header charsheet__spell-group-header--small">${levelNames[level] || `Level ${level}`}</h5>
					<div class="charsheet__spell-group-list"></div>
				</div>
			`});

			const list = group.querySelector(".charsheet__spell-group-list");
			spells.sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
				const item = this._renderSpellItem(spell, showPrepareHint);
				list.append(item);
			});

			container.append(group);
		});
	}

	/**
	 * Render innate spells section (from features/feats)
	 */
	_renderInnateSpells (container) {
		const innateSpells = this._state.getInnateSpells();
		if (!innateSpells) return;

		// Apply filter
		let filtered = innateSpells;
		if (this._spellFilter) {
			filtered = filtered.filter(s => s.name.toLowerCase().includes(this._spellFilter));
		}

		if (!filtered) return;

		const group = e_({outer: `
			<div class="charsheet__spell-group charsheet__spell-group--innate">
				<h5 class="charsheet__spell-group-header">
					<span class="glyphicon glyphicon-star text-warning mr-1"></span>
					Innate Spellcasting
				</h5>
				<div class="charsheet__spell-group-list"></div>
			</div>
		`});

		const list = group.querySelector(".charsheet__spell-group-list");

		filtered.sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
			const item = this._renderInnateSpellItem(spell);
			list.append(item);
		});

		container.append(group);
	}

	/**
	 * Render a single innate spell item
	 */
	_renderInnateSpellItem (spell) {
		const spellId = spell.id;

		// Create hover link for spell name
		let spellLink = spell.name;
		try {
			if (this._page?.getHoverLink) {
				spellLink = this._page.getHoverLink(
					UrlUtil.PG_SPELLS,
					spell.name,
					spell.source || Parser.SRC_XPHB,
				);
			}
		} catch (e) {
			// Fall back to plain name
		}

		// Build usage info
		let usageInfo;
		if (spell.atWill) {
			usageInfo = "<span class=\"badge badge-success\">At Will</span>";
		} else if (spell.uses) {
			// Build pips: filled = available, empty (used class) = spent
			const pipsHtml = Array.from({length: spell.uses.max}, (_, i) =>
				`<span class="charsheet__innate-pip ${i < spell.uses.current ? "" : "used"}" data-spell-id="${spellId}"></span>`,
			).join("");
			usageInfo = `<span class="charsheet__innate-uses">${pipsHtml}</span>`;
		} else {
			usageInfo = "<span class=\"badge badge-secondary\">1/day</span>";
		}

		const sourceInfo = spell.sourceFeature
			? `<span class="ve-muted ve-small">(${spell.sourceFeature})</span>`
			: "";

		const item = e_({outer: `
			<div class="charsheet__spell-item charsheet__spell-item--innate" data-innate-spell-id="${spellId}">
				<div class="charsheet__spell-item-main">
					<span class="charsheet__spell-item-name">${spellLink}</span>
					${sourceInfo}
				</div>
				<div class="charsheet__spell-item-actions">
					${usageInfo}
					${!spell.atWill ? `
						<button class="ve-btn ve-btn-sm ve-btn-primary charsheet__innate-cast" title="Cast">
							<span class="glyphicon glyphicon-flash"></span>
						</button>
					` : ""}
					<button class="ve-btn ve-btn-sm ve-btn-default charsheet__spell-info" title="Info">
						<span class="glyphicon glyphicon-info-sign"></span>
					</button>
				</div>
			</div>
		`});

		// Bind cast button
		item.querySelector(".charsheet__innate-cast").addEventListener("click", () => {
			this._castInnateSpell(spellId);
		});

		// Bind pip clicks to restore uses
		item.querySelector(".charsheet__innate-pip").addEventListener("click", (e) => {
			const pip = e.currentTarget;
			if (pip.classList.contains("used")) {
				// Restore one use
				spell.uses.current = Math.min(spell.uses.current + 1, spell.uses.max);
				this._renderSpellList();
			}
		});

		return item;
	}

	/**
	 * Cast an innate spell (use one charge)
	 */
	_castInnateSpell (spellId) {
		const spell = this._state.getInnateSpells().find(s => s.id === spellId);
		if (!spell) return;

		// Get full spell data for constraint checks
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);

		// Check for conditions that prevent spellcasting
		const castingConstraint = this._checkCastingConstraints(spell, spellData);
		if (castingConstraint) {
			JqueryUtil.doToast({type: "warning", content: castingConstraint});
			return;
		}

		if (spell.atWill) {
			// At-will spells can always be cast
			JqueryUtil.doToast({type: "success", content: `Cast ${spell.name} (at will)`});
			return;
		}

		if (!spell.uses || spell.uses.current <= 0) {
			JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${spell.name}`});
			return;
		}

		this._state.useInnateSpell(spellId);
		JqueryUtil.doToast({type: "success", content: `Cast ${spell.name} (${spell.uses.current}/${spell.uses.max} remaining)`});
		this._renderSpellList();
	}

	_renderSpellItem (spell) {
		const schoolFull = spell.school ? Parser.spSchoolAbvToFull(spell.school) : "";
		const isPrepared = spell.prepared;
		const isCantrip = spell.level === 0;
		const isAlwaysPrepared = spell.alwaysPrepared;
		const sourceFeature = spell.sourceFeature;
		// Ensure spell has a valid ID
		const spellId = spell.id || `${spell.name}|${spell.source}`;

		// Create hover link for spell name
		let spellLink = spell.name;
		try {
			if (this._page?.getHoverLink) {
				spellLink = this._page.getHoverLink(
					UrlUtil.PG_SPELLS,
					spell.name,
					spell.source || Parser.SRC_XPHB,
				);
			}
		} catch (e) {
			// Fall back to plain name
		}

		// Build spell details line
		const detailParts = [];
		if (spell.castingTime) detailParts.push(spell.castingTime);
		if (spell.range) detailParts.push(spell.range);
		if (spell.duration) detailParts.push(spell.duration);
		if (spell.components) detailParts.push(spell.components);
		const detailsLine = detailParts.join(" · ");

		// Build rarity/legality inline text from subschools (if stored)
		const rarityParts = (spell.subschools || [])
			.map(ss => {
				if (ss.includes("legality:")) {
					const legality = ss.replace("legality:", "");
					const color = legality === "legal" ? "var(--cs-success, #10b981)" : (legality === "restricted" ? "var(--cs-warning, #f59e0b)" : "var(--cs-danger, #ef4444)");
					return `<span class="charsheet__spell-rarity-tag" style="color: ${color}; font-weight: 600;" title="Thelemar legality">[${legality}]</span>`;
				}
				if (ss.includes("rarity:")) {
					const rarity = ss.replace("rarity:", "");
					const color = rarity === "common" ? "var(--cs-text-muted, #9ca3af)" : (rarity === "uncommon" ? "var(--cs-primary, #6366f1)" : (rarity === "rare" ? "var(--cs-accent, #8b5cf6)" : "var(--cs-warning, #f59e0b)"));
					return `<span class="charsheet__spell-rarity-tag" style="color: ${color}; font-weight: 600;" title="Thelemar rarity">[${rarity}]</span>`;
				}
				return null;
			})
			.filter(Boolean)
			.join(" ");

		// Combine details line with rarity tags
		const fullDetailsLine = rarityParts
			? (detailsLine ? `${detailsLine} · ${rarityParts}` : rarityParts)
			: detailsLine;

		// Determine preparation button state and text
		let prepButtonHtml = "";
		if (!isCantrip) {
			if (isAlwaysPrepared) {
				// Always prepared spells (from domain, subclass features, etc.) can't be unprepared
				const featureSource = sourceFeature || "class feature";
				prepButtonHtml = `
					<span class="ve-btn ve-btn-xs ve-btn-warning charsheet__spell-always-prepared" title="Always prepared from ${featureSource}">
						<span class="glyphicon glyphicon-star mr-1"></span>Always
					</span>
				`;
			} else {
				// Normal prepared toggle
				prepButtonHtml = `
					<button class="ve-btn ve-btn-xs ${isPrepared ? "ve-btn-primary" : "ve-btn-default"} charsheet__spell-prepared" title="Toggle Prepared">
						<span class="glyphicon glyphicon-book mr-1"></span>${isPrepared ? "Prepared" : "Prepare"}
					</button>
				`;
			}
		}

		// Build source badge if from a feature
		const sourceBadge = sourceFeature
			? `<span class="badge badge-warning charsheet__spell-source-badge" title="From: ${sourceFeature}">${this._truncateFeatureName(sourceFeature)}</span>`
			: "";

		// Determine if spell can be cast as ritual (show ritual button when not prepared but ritual-eligible)
		let ritualButtonHtml = "";
		if (!isCantrip && spell.ritual && !isPrepared && !isAlwaysPrepared) {
			// Check if character can ritual-cast this spell (e.g., Wizard with unprepared spellbook ritual)
			if (this._state.canCastAsRitual?.(spell)) {
				ritualButtonHtml = `
					<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__spell-cast-ritual" title="Cast as Ritual (no slot, +10 min)">
						<span class="mr-1">🔮</span>Ritual
					</button>
				`;
			}
		}

		return e_({outer: `
			<div class="charsheet__spell-item ${isPrepared || isAlwaysPrepared ? "prepared" : ""} ${isAlwaysPrepared ? "always-prepared" : ""}" data-spell-id="${spellId}">
				<div class="charsheet__spell-item-main">
					<div class="charsheet__spell-item-header">
						<span class="charsheet__spell-item-name">${spellLink}</span>
						<span class="charsheet__spell-item-meta">
							${schoolFull ? `<span class="badge badge-secondary">${schoolFull}</span>` : ""}
							${spell.concentration ? `<span class="badge badge-info" title="Concentration">C</span>` : ""}
							${spell.ritual ? `<span class="badge badge-success" title="Ritual">R</span>` : ""}
							${sourceBadge}
						</span>
					</div>
					${fullDetailsLine ? `<div class="charsheet__spell-item-details ve-muted ve-small">${fullDetailsLine}</div>` : ""}
				</div>
				<div class="charsheet__spell-item-actions">
					${prepButtonHtml}
					${ritualButtonHtml}
					<button class="ve-btn ve-btn-xs ve-btn-success charsheet__spell-cast" title="Cast Spell">
						<span class="glyphicon glyphicon-flash mr-1"></span>Cast
					</button>
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__spell-info" title="Spell Info">
						<span class="glyphicon glyphicon-info-sign mr-1"></span>Info
					</button>
					<button class="ve-btn ve-btn-xs ${this._state.getSpellNote?.(spellId) ? "ve-btn-warning" : "ve-btn-default"} charsheet__spell-note" title="${this._state.getSpellNote?.(spellId) ? "Edit Note" : "Add Note"}">
						<span class="glyphicon glyphicon-comment"></span>
					</button>
					${!isAlwaysPrepared ? `
						<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__spell-remove" title="Remove Spell">
							<span class="glyphicon glyphicon-trash mr-1"></span>Remove
						</button>
					` : `
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__spell-remove" title="Cannot remove feature spells" disabled>
							<span class="glyphicon glyphicon-lock mr-1"></span>Locked
						</button>
					`}
				</div>
			</div>
		`});
	}

	/**
	 * Truncate a feature name for badge display
	 */
	_truncateFeatureName (name) {
		if (!name) return "";
		if (name.length <= 12) return name;
		return `${name.substring(0, 10)}…`;
	}

	/**
	 * Render multiclass status bar showing per-class spell tracking
	 */
	_renderMulticlassStatusBar (statusBar, info, manualLeveledSpells, preparedSpells) {
		// Add a multiclass indicator
		statusBar.insertAdjacentHTML("beforeend", `
			<div style="display: flex; align-items: center; gap: 6px; padding-right: 8px; border-right: 1px solid rgba(var(--rgb-bg-text), 0.2);">
				<span class="ve-muted ve-small">⚔️ Multiclass</span>
			</div>
		`);

		// Show each class's spell tracking separately
		for (const classInfo of info.byClass) {
			if (classInfo.type === "known") {
				// For known casters, they need to track their own spells known limit
				// In D&D, each class tracks its own spells known separately
				const maxKnown = classInfo.spellsKnownMax || classInfo.max;
				// Note: In a real implementation, we'd need to track which spells belong to which class
				// For now, show the limit per class
				const icon = "📖 ";
				statusBar.insertAdjacentHTML("beforeend", `
					<div style="display: flex; align-items: center; gap: 4px;" title="${classInfo.className}: Spells known are permanent. Can swap 1 on level up.">
						<span style="color: #60a5fa;">${icon}${classInfo.className}:</span>
						<span class="ve-muted ve-small">max ${maxKnown} known</span>
					</div>
				`);
			} else if (classInfo.type === "prepared") {
				const maxPrepared = classInfo.preparedMax || classInfo.max;
				const icon = classInfo.is2024 ? "✨ " : "📚 ";
				const color = classInfo.is2024 ? "#fbbf24" : "#a78bfa";
				statusBar.insertAdjacentHTML("beforeend", `
					<div style="display: flex; align-items: center; gap: 4px;" title="${classInfo.className}: Can prepare from full class spell list after long rest.">
						<span style="color: ${color};">${icon}${classInfo.className}:</span>
						<span class="ve-muted ve-small">max ${maxPrepared} prepared</span>
					</div>
				`);
			}
		}

		// Show totals
		const totalManual = manualLeveledSpells.length;
		const totalPrepared = preparedSpells.length;
		const totalMax = info.max;

		statusBar.insertAdjacentHTML("beforeend", `
			<div style="display: flex; align-items: center; gap: 6px; padding-left: 8px; border-left: 1px solid rgba(var(--rgb-bg-text), 0.2);">
				<span class="ve-muted">Total:</span>
				<span class="bold">${totalManual} spells</span>
				<span class="ve-muted ve-small">(${totalPrepared} prepared)</span>
			</div>
		`);
	}

	render () {
		// Calculate spell slots based on class/level before rendering
		this._state.calculateSpellSlots();

		this.renderSlots();
		this._renderSpellList();
		this._renderSpellcastingStats();

	}

	_renderSpellcastingStats () {
		// Get spellcasting ability from class
		const classes = this._state.getClasses();
		if (!classes) {
			document.getElementById("charsheet-spell-ability").textContent = "—";
			document.getElementById("charsheet-spell-dc").textContent = "—";
			document.getElementById("charsheet-spell-attack").textContent = "—";
			document.getElementById("charsheet-spell-tracking").style.display = "none";
			return;
		}

		// Get spellcasting ability - first spellcasting class
		const spellcastingAbilityMap = {
			"Bard": "cha",
			"Cleric": "wis",
			"Druid": "wis",
			"Paladin": "cha",
			"Ranger": "wis",
			"Sorcerer": "cha",
			"Warlock": "cha",
			"Wizard": "int",
			"Artificer": "int",
		};

		// Check if character has Gambler spellcasting (TGTT Rogue subclass)
		const calcs = this._state.getFeatureCalculations();
		const hasGamblerSpellcasting = calcs.hasGamblerSpellcasting;

		let ability = null;
		for (const cls of classes) {
			if (spellcastingAbilityMap[cls.name]) {
				ability = spellcastingAbilityMap[cls.name];
				break;
			}
		}

		if (!ability) {
			document.getElementById("charsheet-spell-ability").textContent = "—";
			document.getElementById("charsheet-spell-dc").textContent = "—";
			document.getElementById("charsheet-spell-attack").textContent = "—";
			document.getElementById("charsheet-spell-tracking").style.display = "none";
			return;
		}

		const mod = this._state.getAbilityMod(ability);
		const prof = this._state.getProficiencyBonus();

		// Get item bonuses for spell attack and DC
		const itemBonuses = this._state.getItemBonuses?.() || {};
		const spellAttackBonus = itemBonuses.spellAttack || 0;
		const spellDcBonus = itemBonuses.spellSaveDc || 0;

		// Get exhaustion DC penalty (Thelemar rules only)
		const exhaustionDcPenalty = this._state._getExhaustionDcPenalty?.() || 0;

		const attackBonus = mod + prof + spellAttackBonus;
		const saveDC = 8 + mod + prof + spellDcBonus - exhaustionDcPenalty;
		const abilityFull = {
			"str": "Strength",
			"dex": "Dexterity",
			"con": "Constitution",
			"int": "Intelligence",
			"wis": "Wisdom",
			"cha": "Charisma",
		}[ability] || ability.toUpperCase();

		// Gambler spellcasting: show formula with roll buttons instead of static values
		if (hasGamblerSpellcasting) {
			document.getElementById("charsheet-spell-ability").textContent = "Gambler (Cha)";
			
			// Build formula strings with item/exhaustion bonuses
			const dcBase = 8 + prof;
			const dcBonusStr = spellDcBonus > 0 ? ` + ${spellDcBonus}` : (spellDcBonus < 0 ? ` - ${Math.abs(spellDcBonus)}` : "");
			const dcPenaltyStr = exhaustionDcPenalty > 0 ? ` - ${exhaustionDcPenalty}` : "";
			const gamblerDcFormula = `${dcBase} + ${calcs.gamblerModifierDice}${dcBonusStr}${dcPenaltyStr}`;
			
			const attackBonusStr = spellAttackBonus > 0 ? ` + ${spellAttackBonus}` : (spellAttackBonus < 0 ? ` - ${Math.abs(spellAttackBonus)}` : "");
			const gamblerAttackFormula = `+${prof} + ${calcs.gamblerModifierDice}${attackBonusStr}`;

			// Create clickable DC display with roll button
			const dcElement = document.getElementById("charsheet-spell-dc");
			dcElement.innerHTML = `
				<span class="charsheet__gambler-formula" title="Roll ${calcs.gamblerModifierDice} per cast">
					${gamblerDcFormula}
					<button class="charsheet__gambler-roll-btn btn btn-xs btn-default ml-1" type="button" title="Roll DC">
						🎲
					</button>
				</span>
			`;
			dcElement.querySelector(".charsheet__gambler-roll-btn").addEventListener("click", (evt) => {
				evt.stopPropagation();
				this._rollGamblerModifier("DC", dcBase + spellDcBonus - exhaustionDcPenalty, calcs.gamblerModifierDice);
			});

			// Create clickable attack display with roll button
			const attackElement = document.getElementById("charsheet-spell-attack");
			attackElement.innerHTML = `
				<span class="charsheet__gambler-formula" title="Roll ${calcs.gamblerModifierDice} per cast">
					${gamblerAttackFormula}
					<button class="charsheet__gambler-roll-btn btn btn-xs btn-default ml-1" type="button" title="Roll Attack">
						🎲
					</button>
				</span>
			`;
			attackElement.querySelector(".charsheet__gambler-roll-btn").addEventListener("click", (evt) => {
				evt.stopPropagation();
				this._rollGamblerModifier("Attack", prof + spellAttackBonus, calcs.gamblerModifierDice);
			});
		} else {
			document.getElementById("charsheet-spell-ability").textContent = abilityFull;
			document.getElementById("charsheet-spell-dc").textContent = saveDC;
			document.getElementById("charsheet-spell-attack").textContent = `+${attackBonus}`;
		}

		// Display spell tracking using the new enhanced UI
		this._renderSpellTrackingUI();
	}

	/**
	 * Roll Gambler modifier dice and display result in toast
	 * @param {string} type - "DC" or "Attack"
	 * @param {number} baseValue - Base value (DC base or attack bonus)
	 * @param {string} diceStr - Dice string like "1d6" or "2d4"
	 */
	_rollGamblerModifier (type, baseValue, diceStr) {
		const match = diceStr.match(/(\d+)d(\d+)/);
		if (!match) return;

		const count = parseInt(match[1]);
		const sides = parseInt(match[2]);

		// Roll each die
		const rolls = [];
		for (let i = 0; i < count; i++) {
			rolls.push(Math.floor(Math.random() * sides) + 1);
		}
		const rollTotal = rolls.reduce((sum, r) => sum + r, 0);
		const total = baseValue + rollTotal;

		// Build display text
		const rollsDisplay = rolls.join(" + ");
		const message = type === "DC"
			? `🎲 Spell Save DC: ${baseValue} + (${rollsDisplay}) = <strong>${total}</strong>`
			: `🎲 Spell Attack: +${baseValue} + (${rollsDisplay}) = <strong>+${total}</strong>`;

		// Show as toast notification
		JqueryUtil.doToast({
			content: message,
			type: "info",
			autoHideTime: 5000,
		});
	}

	/**
	 * Render the spell tracking UI based on caster type (known vs prepared, 2014 vs 2024)
	 */
	_renderSpellTrackingUI () {
		const spellcastingInfo = this._state.getSpellcastingInfo();
		const trackingContainer = document.getElementById("charsheet-spell-tracking");

		// Hide all tracking boxes by default
		for (const id of ["charsheet-known-caster-info", "charsheet-prepared-caster-info-2014", "charsheet-prepared-caster-info-2024", "charsheet-cantrips-info", "charsheet-gambler-caster-info"]) {
			const el = document.getElementById(id);
			if (el) el.style.display = "none";
		}

		// Check for Gambler spellcasting (TGTT Rogue subclass)
		const calcs = this._state.getFeatureCalculations();
		if (calcs.hasGamblerSpellcasting) {
			this._renderGamblerSpellTrackingUI(calcs);
			return;
		}

		if (!spellcastingInfo) {
			trackingContainer.style.display = "none";
			return;
		}

		trackingContainer.style.display = "";

		const spells = this._state.getSpells();
		const leveledSpells = spells.filter(s => s.level > 0);
		const allCantrips = this._state.getCantripsKnown();
		const preparedSpells = leveledSpells.filter(s => s.prepared || s.alwaysPrepared);
		// Manual spells = those not from features (count against limit)
		const manualLeveledSpells = leveledSpells.filter(s => !s.sourceFeature);

		// Cantrips count (excluding feature-granted ones)
		const cantripsChosen = allCantrips.filter(c => !c.sourceFeature).length;
		const cantripsMax = spellcastingInfo.cantripsKnown || 0;

		// Show cantrips info if the class has cantrips
		if (cantripsMax > 0) {
			const cantripsInfo = document.getElementById("charsheet-cantrips-info"); cantripsInfo.style.display = "";
			document.getElementById("charsheet-cantrips-current").textContent = cantripsChosen;
			document.getElementById("charsheet-cantrips-max").textContent = cantripsMax;

			// Handle over-limit state
			const countEl = cantripsInfo.querySelector(".charsheet__spell-tracking-count");
			if (cantripsChosen > cantripsMax) {
				countEl.classList.add("charsheet__spell-tracking-count--over");
				cantripsInfo.classList.add("charsheet__spell-tracking-box--over");
			} else {
				countEl.classList.remove("charsheet__spell-tracking-count--over");
				cantripsInfo.classList.remove("charsheet__spell-tracking-box--over");
			}
		}

		// Determine which spell tracking box to show based on caster type
		if (spellcastingInfo.type === "known") {
			// Known caster (2014 Bard, Sorcerer, Warlock, Ranger, EK, AT)
			const knownInfo = document.getElementById("charsheet-known-caster-info"); knownInfo.style.display = "";
			// Only count manual spells (not from features) against the limit
			const currentKnown = manualLeveledSpells.length;
			const maxKnown = spellcastingInfo.spellsKnownMax || spellcastingInfo.max;

			document.getElementById("charsheet-spells-known-current").textContent = currentKnown;
			document.getElementById("charsheet-spells-known-max").textContent = maxKnown;

			// Handle over-limit state
			const countEl = knownInfo.querySelector(".charsheet__spell-tracking-count");
			if (currentKnown > maxKnown) {
				countEl.classList.add("charsheet__spell-tracking-count--over");
				knownInfo.classList.add("charsheet__spell-tracking-box--over");
			} else {
				countEl.classList.remove("charsheet__spell-tracking-count--over");
				knownInfo.classList.remove("charsheet__spell-tracking-box--over");
			}
		} else if (spellcastingInfo.type === "prepared") {
			// Prepared caster - check if 2024 or 2014
			const is2024 = spellcastingInfo.is2024;
			const currentPrepared = preparedSpells.length;
			const maxPrepared = spellcastingInfo.preparedMax || spellcastingInfo.max;

			if (is2024) {
				const preparedInfo = document.getElementById("charsheet-prepared-caster-info-2024"); preparedInfo.style.display = "";
				document.getElementById("charsheet-spells-prepared-current-2024").textContent = currentPrepared;
				document.getElementById("charsheet-spells-prepared-max-2024").textContent = maxPrepared;

				const countEl = preparedInfo.querySelector(".charsheet__spell-tracking-count");
				if (currentPrepared > maxPrepared) {
					countEl.classList.add("charsheet__spell-tracking-count--over");
					preparedInfo.classList.add("charsheet__spell-tracking-box--over");
				} else {
					countEl.classList.remove("charsheet__spell-tracking-count--over");
					preparedInfo.classList.remove("charsheet__spell-tracking-box--over");
				}
			} else {
				const preparedInfo = document.getElementById("charsheet-prepared-caster-info-2014"); preparedInfo.style.display = "";
				document.getElementById("charsheet-spells-prepared-current-2014").textContent = currentPrepared;
				document.getElementById("charsheet-spells-prepared-max-2014").textContent = maxPrepared;

				const countEl = preparedInfo.querySelector(".charsheet__spell-tracking-count");
				if (currentPrepared > maxPrepared) {
					countEl.classList.add("charsheet__spell-tracking-count--over");
					preparedInfo.classList.add("charsheet__spell-tracking-box--over");
				} else {
					countEl.classList.remove("charsheet__spell-tracking-count--over");
					preparedInfo.classList.remove("charsheet__spell-tracking-box--over");
				}
			}
		} else if (spellcastingInfo.type === "mixed" && spellcastingInfo.isMulticlass) {
			// Multiclass with mixed caster types - show both relevant boxes
			// This is a complex case, show a simplified combined view
			const hasKnown = spellcastingInfo.byClass?.some(c => c.type === "known");
			const hasPrepared = spellcastingInfo.byClass?.some(c => c.type === "prepared");

			if (hasKnown) {
				const knownInfo = document.getElementById("charsheet-known-caster-info"); knownInfo.style.display = "";
				const knownClasses = spellcastingInfo.byClass.filter(c => c.type === "known");
				const totalKnownMax = knownClasses.reduce((sum, c) => sum + (c.spellsKnownMax || c.max || 0), 0);
				// For multiclass, only count manual spells against limit
				document.getElementById("charsheet-spells-known-current").textContent = manualLeveledSpells.length;
				document.getElementById("charsheet-spells-known-max").textContent = totalKnownMax;

				// Update hint for multiclass
				knownInfo.querySelector(".charsheet__spell-tracking-hint").textContent = 
					`From: ${knownClasses.map(c => c.className).join(", ")}`;
			}

			if (hasPrepared) {
				const preparedInfo = document.getElementById("charsheet-prepared-caster-info-2014"); preparedInfo.style.display = "";
				const preparedClasses = spellcastingInfo.byClass.filter(c => c.type === "prepared");
				const totalPreparedMax = preparedClasses.reduce((sum, c) => sum + (c.preparedMax || c.max || 0), 0);
				document.getElementById("charsheet-spells-prepared-current-2014").textContent = preparedSpells.length;
				document.getElementById("charsheet-spells-prepared-max-2014").textContent = totalPreparedMax;

				// Update hint for multiclass
				preparedInfo.querySelector(".charsheet__spell-tracking-hint").textContent = 
					`From: ${preparedClasses.map(c => c.className).join(", ")}`;
			}
		}
	}

	/**
	 * Render Gambler-specific spell tracking UI with rolled prepared count.
	 * Gambler prepares spells by rolling 2d4 (3d6 at L13) each day.
	 * @param {object} calcs - Feature calculations from state
	 */
	_renderGamblerSpellTrackingUI (calcs) {
		const trackingContainer = document.getElementById("charsheet-spell-tracking"); trackingContainer.style.display = "";
		
		// Get or create Gambler-specific tracking box
		let gamblerInfo = document.getElementById("charsheet-gambler-caster-info");
		if (!gamblerInfo) {
			// Create the Gambler tracking box dynamically if not in HTML
			gamblerInfo = e_({outer: `
				<div id="charsheet-gambler-caster-info" class="charsheet__spell-tracking-box charsheet__spell-tracking-box--gambler">
					<div class="charsheet__spell-tracking-header">
						<span class="charsheet__spell-tracking-icon">🎲</span>
						<span class="charsheet__spell-tracking-title">Gambler Spells</span>
						<span class="charsheet__spell-tracking-badge" title="Gambler (TGTT) - Roll for prepared spells each day">TGTT</span>
					</div>
					<div class="charsheet__spell-tracking-body">
						<div class="charsheet__spell-tracking-count charsheet__gambler-prepared-display">
							<span id="charsheet-gambler-prepared-current">0</span>
							<span class="charsheet__spell-tracking-separator">/</span>
							<span id="charsheet-gambler-prepared-max">—</span>
						</div>
						<div class="charsheet__spell-tracking-hint" id="charsheet-gambler-hint">Roll for spells after long rest</div>
						<button id="charsheet-gambler-roll-prepared-btn" class="btn btn-sm btn-primary mt-2" style="display: none;">
							🎲 Roll ${calcs.gamblerSpellsPreparedDice}
						</button>
					</div>
				</div>
			`});
			trackingContainer.append(gamblerInfo);
		}

		gamblerInfo.style.display = "";

		// Get Gambler prepared spell state
		const currentPrepared = this._state.getGamblerCurrentPreparedCount();
		const rolledMax = this._state.getGamblerPreparedCount();
		const rollDetails = this._state.getGamblerPreparedRollDetails();

		// Update current count
		document.getElementById("charsheet-gambler-prepared-current").textContent = currentPrepared;

		// Update max display and hint based on rolled state
		const maxDisplay = document.getElementById("charsheet-gambler-prepared-max");
		const hint = document.getElementById("charsheet-gambler-hint");
		const rollBtn = document.getElementById("charsheet-gambler-roll-prepared-btn");

		if (rolledMax !== null) {
			// Already rolled - show the rolled value
			maxDisplay.textContent = rolledMax;
			if (rollDetails) {
				hint.innerHTML = `Rolled <strong>${rollDetails.dice}</strong>: (${rollDetails.rolls.join(" + ")}) = ${rollDetails.total}`;
			} else {
				hint.textContent = `Rolled ${rolledMax} for today`;
			}
			rollBtn.style.display = "none";

			// Show "Manage Prepared" button
			let manageBtn = document.getElementById("charsheet-gambler-manage-prepared-btn");
			if (!manageBtn) {
				manageBtn = e_({outer: `<button id="charsheet-gambler-manage-prepared-btn" class="btn btn-sm btn-outline-primary mt-2">📜 Manage Prepared Spells</button>`});
				rollBtn.after(manageBtn);
			}
			manageBtn.style.display = "";
			manageBtn.addEventListener("click", () => this._openGamblerSpellPicker(calcs, rolledMax));

			// Check for over-limit
			const countEl = gamblerInfo.querySelector(".charsheet__spell-tracking-count");
			if (currentPrepared > rolledMax) {
				countEl.classList.add("charsheet__spell-tracking-count--over");
				gamblerInfo.classList.add("charsheet__spell-tracking-box--over");
			} else {
				countEl.classList.remove("charsheet__spell-tracking-count--over");
				gamblerInfo.classList.remove("charsheet__spell-tracking-box--over");
			}
		} else {
			// Not rolled yet - show dice formula and roll button
			maxDisplay.innerHTML = `<span class="ve-muted">${calcs.gamblerSpellsPreparedDice}</span>`;
			hint.textContent = "Roll for prepared spells after long rest";
			rollBtn.textContent = `🎲 Roll ${calcs.gamblerSpellsPreparedDice}`;
			rollBtn.style.display = "";
			rollBtn.addEventListener("click", () => this._onGamblerRollPrepared(calcs));
			
			// Hide manage button if present
			document.getElementById("charsheet-gambler-manage-prepared-btn").style.display = "none";
		}

		// Also show cantrips for Gambler
		const allCantrips = this._state.getCantripsKnown();
		const gamblerCantrips = allCantrips.filter(c => c.sourceClass === "Gambler" || c.sourceSubclass === "Gambler");
		if (calcs.gamblerCantripsKnown > 0) {
			const cantripsInfo = document.getElementById("charsheet-cantrips-info"); cantripsInfo.style.display = "";
			document.getElementById("charsheet-cantrips-current").textContent = gamblerCantrips.length;
			document.getElementById("charsheet-cantrips-max").textContent = calcs.gamblerCantripsKnown;
		}
	}

	/**
	 * Handle click on Gambler "Roll Prepared Spells" button
	 * @param {object} calcs - Feature calculations
	 */
	_onGamblerRollPrepared (calcs) {
		const rollDetails = this._state.rollGamblerPreparedSpells();
		if (!rollDetails) return;

		// Show toast with roll result
		JqueryUtil.doToast({
			content: `🎲 Gambler Prepared Spells: Rolled ${rollDetails.dice} = (${rollDetails.rolls.join(" + ")}) = <strong>${rollDetails.total}</strong> spells`,
			type: "success",
			autoHideTime: 5000,
		});

		// Re-render the tracking UI to reflect the new state
		this._renderGamblerSpellTrackingUI(calcs);

		// Open spell picker immediately after rolling
		const rolledMax = this._state.getGamblerPreparedCount();
		if (rolledMax > 0) {
			this._openGamblerSpellPicker(calcs, rolledMax);
		}
	}

	/**
	 * Open a spell picker for Gambler to select prepared spells.
	 * Filters to Warlock spell list only and enforces rolled maximum.
	 * @param {object} calcs - Feature calculations
	 * @param {number} maxPrepared - Maximum number of spells to prepare (rolled value)
	 */
	async _openGamblerSpellPicker (calcs, maxPrepared) {
		// Get Gambler's max spell level based on 1/3 caster progression
		const gamblerLevel = this._state.getClasses().find(c => c.subclass?.name === "Gambler")?.level || 3;
		const thirdCasterLevel = Math.floor(gamblerLevel / 3);
		const maxSpellLevel = thirdCasterLevel >= 10 ? 4 : (thirdCasterLevel >= 7 ? 3 : (thirdCasterLevel >= 4 ? 2 : 1));

		// Get currently prepared Gambler spells
		const currentPrepared = this._state.getSpells()
			.filter(s => (s.sourceClass === "Gambler" || s.sourceSubclass === "Gambler") && s.prepared && s.level > 0)
			.map(s => ({name: s.name, source: s.source}));

		// Filter spells to Warlock list
		const allSpells = this._allSpells || await this._pLoadAllSpells();
		const warlockSpells = allSpells.filter(spell => {
			// Must be on Warlock spell list
			const fromClassList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
			const isWarlockSpell = fromClassList?.some(c => c.name === "Warlock");
			if (!isWarlockSpell) return false;

			// Must be within Gambler's spell level limit
			if (spell.level < 1 || spell.level > maxSpellLevel) return false;

			return true;
		});

		// Build modal content
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Gambler: Select Prepared Spells (${maxPrepared} max)`,
			isWidth100: true,
			isHeight100: true,
			isUncappedHeight: true,
			cbClose: () => {
				// Re-render tracking UI when modal closes
				this._renderGamblerSpellTrackingUI(calcs);
			},
		});

		// Track selected spells
		let selectedSpells = [...currentPrepared];

		// Progress header
		const header = e_({outer: `
			<div class="charsheet__spell-picker-header mb-3">
				<div class="charsheet__spell-picker-counter">
					<span class="charsheet__spell-picker-counter-icon">🎲</span>
					<span class="charsheet__spell-picker-counter-label">Gambler Spells:</span>
					<span class="charsheet__spell-picker-counter-value spell-counter-value">
						<span class="spell-count-current">${selectedSpells.length}</span>/<span class="spell-count-max">${maxPrepared}</span>
					</span>
				</div>
				<div class="ve-muted ve-small ml-auto">Warlock spell list only • Max level ${maxSpellLevel}</div>
			</div>
		`});
		modalInner.append(header);

		const updateHeader = () => {
			header.querySelector(".spell-count-current").textContent = selectedSpells.length;
			const valueEl = header.querySelector(".spell-counter-value");
			valueEl.classList.remove("charsheet__spell-picker-counter-value--complete", "charsheet__spell-picker-counter-value--over");
			if (selectedSpells.length === maxPrepared) {
				valueEl.classList.add("charsheet__spell-picker-counter-value--complete");
			} else if (selectedSpells.length > maxPrepared) {
				valueEl.classList.add("charsheet__spell-picker-counter-value--over");
			}
		};

		// Filter controls
		const filterRow = e_({outer: `<div class="ve-flex ve-flex-wrap gap-2 mb-3"></div>`});
		modalInner.append(filterRow);

		// Level filter
		const levelFilter = e_({outer: `
			<select class="form-control form-control-sm" style="width: auto;">
				<option value="">All Levels</option>
				${Array.from({length: maxSpellLevel}, (_, i) => `<option value="${i + 1}">Level ${i + 1}</option>`).join("")}
			</select>
		`});
		filterRow.append(levelFilter);

		// Search filter
		const searchInput = e_({outer: `<input type="text" class="form-control form-control-sm" placeholder="Search spells..." style="flex: 1; min-width: 150px;">`});
		filterRow.append(searchInput);

		// Spell list container
		const spellList = e_({outer: `<div class="charsheet__spell-picker-list" style="max-height: 400px; overflow-y: auto;"></div>`});
		modalInner.append(spellList);

		// Render spell list
		const renderSpells = () => {
			spellList.innerHTML = "";
			const levelFilter = levelFilter.value ? parseInt(levelFilter.value) : null;
			const searchFilter = searchInput.value.toLowerCase().trim();

			const filteredSpells = warlockSpells.filter(spell => {
				if (levelFilter && spell.level !== levelFilter) return false;
				if (searchFilter && !spell.name.toLowerCase().includes(searchFilter)) return false;
				return true;
			}).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

			if (!filteredSpells) {
				spellList.insertAdjacentHTML("beforeend", `<p class="ve-muted text-center py-3">No spells match your filters</p>`);
				return;
			}

			// Group by level
			const byLevel = {};
			filteredSpells.forEach(spell => {
				if (!byLevel[spell.level]) byLevel[spell.level] = [];
				byLevel[spell.level].push(spell);
			});

			Object.keys(byLevel).sort((a, b) => a - b).forEach(level => {
				spellList.insertAdjacentHTML("beforeend", `<h6 class="charsheet__spell-group-header--small mt-2 mb-1">Level ${level}</h6>`);

				byLevel[level].forEach(spell => {
					const isSelected = selectedSpells.some(s => s.name === spell.name && s.source === spell.source);
					const canSelect = selectedSpells.length < maxPrepared || isSelected;

					const row = e_({outer: `
						<div class="charsheet__spell-picker-row ${isSelected ? "charsheet__spell-picker-row--selected" : ""} ${!canSelect ? "charsheet__spell-picker-row--disabled" : ""}">
							<div class="charsheet__spell-picker-checkbox">
								<input type="checkbox" ${isSelected ? "checked" : ""} ${!canSelect ? "disabled" : ""}>
							</div>
							<div class="charsheet__spell-picker-info">
								<span class="charsheet__spell-picker-name">${spell.name}</span>
								<span class="charsheet__spell-picker-meta ve-muted ve-small">${Parser.spSchoolAbvToFull(spell.school)} • ${spell.source}</span>
							</div>
						</div>
					`});

					spellList.append(row);

					row.querySelector("input").addEventListener("change", function () {
						const isNowSelected = this.checked;
						if (isNowSelected) {
							if (selectedSpells.length >= maxPrepared) {
								this.checked = false;
								JqueryUtil.doToast({
									content: `Cannot prepare more than ${maxPrepared} spells (rolled limit)`,
									type: "warning",
								});
								return;
							}
							selectedSpells.push({name: spell.name, source: spell.source});
							row.classList.add("charsheet__spell-picker-row--selected");
						} else {
							selectedSpells = selectedSpells.filter(s => !(s.name === spell.name && s.source === spell.source));
							row.classList.remove("charsheet__spell-picker-row--selected");
						}
						updateHeader();
						renderSpells(); // Re-render to update disabled states
					});

					row.addEventListener("click", (evt) => {
						if (evt.target.matches("input")) return;
						const checkbox = row.querySelector("input");
						if (!checkbox.disabled) {
							checkbox.checked = !checkbox.checked;
							checkbox.dispatchEvent(new Event("change"));
						}
					});
				});
			});
		};

		levelFilter.addEventListener("change", renderSpells);
		searchInput.addEventListener("input", renderSpells);
		renderSpells();

		// Confirm button
		const btnConfirm = e_({outer: `<button class="btn btn-primary mt-3">Confirm Selection</button>`});
		modalInner.append(btnConfirm);
		btnConfirm.addEventListener("click", () => {
			// Clear old Gambler prepared spells
			this._state.getSpells()
				.filter(s => (s.sourceClass === "Gambler" || s.sourceSubclass === "Gambler") && s.level > 0)
				.forEach(s => {
					this._state.setSpellPrepared(s.name, s.source, false);
				});

			// Set new selections as prepared
			selectedSpells.forEach(s => {
				// Find if spell already exists in known list
				const existing = this._state.getSpells().find(sp => sp.name === s.name && sp.source === s.source);
				if (existing) {
					this._state.setSpellPrepared(s.name, s.source, true);
				} else {
					// Add spell to known list with Gambler source
					const spellData = warlockSpells.find(sp => sp.name === s.name && sp.source === s.source);
					if (spellData) {
						this._state.addSpell({
							name: spellData.name,
							source: spellData.source,
							level: spellData.level,
							school: spellData.school,
							prepared: true,
							sourceClass: "Gambler",
							sourceSubclass: "Gambler",
						});
					}
				}
			});

			JqueryUtil.doToast({
				content: `Prepared ${selectedSpells.length} Gambler spell${selectedSpells.length !== 1 ? "s" : ""}`,
				type: "success",
			});

			doClose();
			this._renderSpellList();
		});
	}
	// #endregion

	// #region Filtered Spell Picker (for feat/feature spell choices)
	/**
	 * Parse a spell filter string like "level=1|school=E;D" or "level=0|class=Sorcerer"
	 * @param {string} filterString - The filter string from additionalSpells choose property
	 * @returns {object} Parsed filter criteria
	 */
	_parseSpellFilter (filterString) {
		const criteria = {
			level: null,
			schools: [],
			classes: [],
			exclude: [], // List of spell names to exclude (lowercase)
		};

		if (!filterString) return criteria;

		const parts = filterString.split("|");
		parts.forEach(part => {
			const [key, value] = part.split("=");
			if (!key || !value) return;

			switch (key.toLowerCase()) {
				case "level":
					criteria.level = parseInt(value);
					break;
				case "school":
					// Schools are separated by ; and use abbreviations (E=Enchantment, D=Divination, etc.)
					criteria.schools = value.split(";").map(s => s.trim().toUpperCase());
					break;
				case "class":
					criteria.classes = value.split(";").map(c => c.trim().toLowerCase());
					break;
				case "exclude":
					// Spell names to exclude, separated by ;
					criteria.exclude = value.split(";").map(s => s.trim().toLowerCase());
					break;
			}
		});

		return criteria;
	}

	/**
	 * Filter spells based on parsed criteria
	 */
	_filterSpellsByCriteria (spells, criteria) {
		return spells.filter(spell => {
			// Level filter
			if (criteria.level !== null && spell.level !== criteria.level) return false;

			// School filter (use abbreviations)
			if (criteria.schools.length > 0) {
				const spellSchool = spell.school?.toUpperCase() || "";
				if (!criteria.schools.includes(spellSchool)) return false;
			}

			// Class filter
			if (criteria.classes.length > 0) {
				const spellClasses = spell.classes?.fromClassList?.map(c => c.name.toLowerCase()) || [];
				const hasMatchingClass = criteria.classes.some(cls => spellClasses.includes(cls));
				if (!hasMatchingClass) return false;
			}

			// Exclusion filter - exclude specific spells by name
			if (criteria.exclude?.length > 0) {
				const spellNameLower = spell.name?.toLowerCase() || "";
				if (criteria.exclude.includes(spellNameLower)) return false;
			}

			return true;
		});
	}

	/**
	 * Get human-readable description of filter criteria
	 */
	_getFilterDescription (criteria) {
		const parts = [];

		if (criteria.level !== null) {
			parts.push(criteria.level === 0 ? "Cantrip" : `Level ${criteria.level}`);
		}

		if (criteria.schools.length > 0) {
			const schoolNames = criteria.schools.map(s => ({
				"A": "Abjuration",
				"C": "Conjuration",
				"D": "Divination",
				"E": "Enchantment",
				"V": "Evocation",
				"I": "Illusion",
				"N": "Necromancy",
				"T": "Transmutation",
			})[s] || s).join(" or ");
			parts.push(schoolNames);
		}

		if (criteria.classes.length > 0) {
			parts.push(`from ${criteria.classes.map(c => c.toTitleCase()).join(" or ")} spell list`);
		}

		return parts.join(" ") || "Any spell";
	}

	/**
	 * Show a spell picker modal filtered for a specific choice (e.g., from Fey Touched feat)
	 * @param {object} choice - The pending spell choice object from state
	 * @param {function} onSelect - Callback when spell is selected
	 */
	async showFilteredSpellPicker (choice, onSelect) {
		const criteria = this._parseSpellFilter(choice.filter);
		const filterDescription = this._getFilterDescription(criteria);

		// Get filtered spells
		const filteredSpells = this._page.filterByAllowedSources(this._allSpells);
		const matchingSpells = this._filterSpellsByCriteria(filteredSpells, criteria)
			.sort((a, b) => a.name.localeCompare(b.name));

		if (!matchingSpells) {
			JqueryUtil.doToast({type: "warning", content: `No spells found matching: ${filterDescription}`});
			return;
		}

		// Get spells already known to mark them
		const knownSpellIds = [
			...this._state.getSpells().map(s => `${s.name}|${s.source}`),
			...this._state.getInnateSpells().map(s => `${s.name}|${s.source}`),
		];

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Choose Spell: ${choice.featureName}`,
			isMinHeight0: true,
			zIndex: 10002, // Above QuickBuild/LevelUp modals
		});

		// Description
		modalInner.insertAdjacentHTML("beforeend", `<p class="mb-2">Select a <strong>${filterDescription}</strong> spell:</p>`);

		// Search
		const search = e_({outer: `<input type="text" class="form-control form-control--minimal mb-2" placeholder="Search spells...">`});
		modalInner.append(search);

		// Spell list
		const list = e_({outer: `<div class="spell-choice-list" style="max-height: 350px; overflow-y: auto;"></div>`});
		modalInner.append(list);

		const renderList = (filter = "") => {
			list.innerHTML = "";

			const filtered = filter
				? matchingSpells.filter(s => s.name.toLowerCase().includes(filter))
				: matchingSpells;

			if (!filtered) {
				list.insertAdjacentHTML("beforeend", `<p class="ve-muted text-center py-2">No spells found</p>`);
				return;
			}

			filtered.forEach(spell => {
				const spellId = `${spell.name}|${spell.source}`;
				const isKnown = knownSpellIds.includes(spellId);
				const school = Parser.spSchoolAbvToFull(spell.school);

				// Render spell name with hover capability
				const spellNameRendered = Renderer.get().render(`{@spell ${spell.name}|${spell.source}}`);

				const item = e_({outer: `
					<div class="ve-flex-v-center p-2 clickable spell-choice-item ${isKnown ? "ve-muted" : ""}" 
						 style="border-bottom: 1px solid var(--rgb-border-grey);">
						<div class="ve-flex-col" style="flex: 1;">
							<span class="bold spell-name-hover">${spellNameRendered}</span>
							<span class="ve-small ve-muted">${school}${spell.ritual ? " (ritual)" : ""} • ${Parser.sourceJsonToAbv(spell.source)}</span>
						</div>
						${isKnown
		? `<span class="ve-muted ve-small">Already known</span>`
		: `<button class="ve-btn ve-btn-primary ve-btn-xs spell-choice-select">Select</button>`
}
					</div>
				`});

				if (!isKnown) {
					item.querySelector(".spell-choice-select").addEventListener("click", () => {
						onSelect(spell);
						doClose(true);
						JqueryUtil.doToast({type: "success", content: `Selected ${spell.name} for ${choice.featureName}`});
					});

					// Show spell info on item click (not on button)
					item.addEventListener("click", (e) => {
						if (!e.target.matches("button")) {
							this._showSpellInfoModal(spell);
						}
					});
				}

				list.append(item);
			});
		};

		search.addEventListener("input", () => renderList(search.value.toLowerCase()));
		renderList();

		// Cancel button
		{ const _cl = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Cancel</button>
		</div>`; modalInner.append(_cl); _cl.querySelector("button").addEventListener("click", () => doClose(false)); }
	}

	/**
	 * Show spell info in a modal
	 */
	async _showSpellInfoModal (spell) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: spell.name,
			isMinHeight0: true,
			zIndex: 10003, // Above spell picker modal (10002)
		});

		const levelSchool = spell.level === 0
			? `${Parser.spSchoolAbvToFull(spell.school)} cantrip`
			: `${Parser.spLevelToFull(spell.level)}-level ${Parser.spSchoolAbvToFull(spell.school).toLowerCase()}`;

		modalInner.insertAdjacentHTML("beforeend", `<p class="ve-muted"><em>${levelSchool}</em></p>`);

		// Basic info
		const infoLines = [];
		if (spell.time?.length) {
			const time = spell.time[0];
			infoLines.push(`<strong>Casting Time:</strong> ${time.number} ${time.unit}`);
		}
		if (spell.range) {
			const rangeStr = spell.range.distance?.type === "self" ? "Self"
				: spell.range.distance?.type === "touch" ? "Touch"
					: `${spell.range.distance?.amount || ""} ${spell.range.distance?.type || ""}`.trim();
			infoLines.push(`<strong>Range:</strong> ${rangeStr}`);
		}
		if (spell.components) {
			const parts = [];
			if (spell.components.v) parts.push("V");
			if (spell.components.s) parts.push("S");
			if (spell.components.m) {
				const mText = typeof spell.components.m === "string" ? spell.components.m : spell.components.m?.text || "";
				parts.push(mText ? `M (${mText})` : "M");
			}
			infoLines.push(`<strong>Components:</strong> ${parts.join(", ")}`);
		}
		if (spell.duration?.length) {
			const dur = spell.duration[0];
			let durStr = "Instantaneous";
			if (dur.type === "timed") {
				durStr = dur.concentration
					? `Concentration, up to ${dur.duration.amount} ${dur.duration.type}`
					: `${dur.duration.amount} ${dur.duration.type}`;
			} else if (dur.type === "permanent") {
				durStr = "Until dispelled";
			}
			infoLines.push(`<strong>Duration:</strong> ${durStr}`);
		}

		modalInner.insertAdjacentHTML("beforeend", `<div class="mb-2">${infoLines.join("<br>")}</div>`);

		// Spell description
		if (spell.entries) {
			modalInner.insertAdjacentHTML("beforeend", `<div class="rd__b">${Renderer.get().render({type: "entries", entries: spell.entries})}</div>`);
		}

		{ const _cl = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`; modalInner.append(_cl); _cl.querySelector("button").addEventListener("click", () => doClose(false)); }
	}

	/**
	 * Process all pending spell choices, showing the picker for each
	 */
	async processPendingSpellChoices () {
		const pendingChoices = this._state.getPendingSpellChoices();
		if (!pendingChoices) return;

		for (const choice of pendingChoices) {
			await this.showFilteredSpellPicker(choice, (spell) => {
				this._state.fulfillSpellChoice(choice.id, spell);
				this._renderSpellList();
				this._page.saveCharacter();
			});
		}
	}
	// #endregion
}

globalThis.CharacterSheetSpells = CharacterSheetSpells;

export {CharacterSheetSpells};
