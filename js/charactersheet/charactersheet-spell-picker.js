/**
 * Character Sheet Spell Picker
 * Reusable spell selection UI used by both LevelUp and QuickBuild modules.
 * Single source of truth for all spell-picking UIs (known spells, cantrips, wizard spellbook).
 */

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee} = /** @type {*} */ (globalThis);

class CharacterSheetSpellPicker {
	// ==========================================
	// Progress Header & Summary Panel Helpers
	// ==========================================

	/**
	 * Create a sticky progress header showing spell/cantrip counts with color coding.
	 * @private
	 */
	static _renderProgressHeader ({spellCount, cantripCount, selectedSpells, selectedCantrips, isWizard = false}) {
		const header = e_({tag: "div", clazz: "charsheet__spell-picker-header"});

		if (spellCount > 0) {
			header.append(e_({outer: `
				<div class="charsheet__spell-picker-counter">
					<span class="charsheet__spell-picker-counter-icon">${isWizard ? "📖" : "📜"}</span>
					<span class="charsheet__spell-picker-counter-label">${isWizard ? "Spellbook" : "Spells"}:</span>
					<span class="charsheet__spell-picker-counter-value spell-counter-value">
						<span class="spell-count-current">${selectedSpells?.length || 0}</span>/<span class="spell-count-max">${spellCount}</span>
					</span>
				</div>
			`}));
		}

		if (cantripCount > 0) {
			header.append(e_({outer: `
				<div class="charsheet__spell-picker-counter">
					<span class="charsheet__spell-picker-counter-icon">⭐</span>
					<span class="charsheet__spell-picker-counter-label">Cantrips:</span>
					<span class="charsheet__spell-picker-counter-value cantrip-counter-value">
						<span class="cantrip-count-current">${selectedCantrips?.length || 0}</span>/<span class="cantrip-count-max">${cantripCount}</span>
					</span>
				</div>
			`}));
		}

		if (spellCount > 0 || cantripCount > 0) {
			header.append(e_({outer: `
				<div class="charsheet__spell-picker-skip-hint ve-muted ve-small" style="margin-top: 2px; font-style: italic;">
					You can skip this and choose spells later on the Spells tab.
				</div>
			`}));
		}

		return header;
	}

	/**
	 * Update progress header color states based on current counts.
	 * @private
	 */
	static _updateProgressHeader ({header, spellCount, cantripCount, selectedSpells, selectedCantrips}) {
		if (spellCount > 0) {
			const spellValue = header.querySelector(".spell-counter-value");
			header.querySelector(".spell-count-current").textContent = selectedSpells.length;
			spellValue.classList.remove("charsheet__spell-picker-counter-value--complete", "charsheet__spell-picker-counter-value--over");
			if (selectedSpells.length === spellCount) {
				spellValue.classList.add("charsheet__spell-picker-counter-value--complete");
			} else if (selectedSpells.length > spellCount) {
				spellValue.classList.add("charsheet__spell-picker-counter-value--over");
			}
		}

		if (cantripCount > 0) {
			const cantripValue = header.querySelector(".cantrip-counter-value");
			header.querySelector(".cantrip-count-current").textContent = selectedCantrips.length;
			cantripValue.classList.remove("charsheet__spell-picker-counter-value--complete", "charsheet__spell-picker-counter-value--over");
			if (selectedCantrips.length === cantripCount) {
				cantripValue.classList.add("charsheet__spell-picker-counter-value--complete");
			} else if (selectedCantrips.length > cantripCount) {
				cantripValue.classList.add("charsheet__spell-picker-counter-value--over");
			}
		}
	}

	/**
	 * Create a collapsible summary panel showing selected spells as dismissible chips.
	 * @private
	 */
	static _renderSummaryPanel ({selectedSpells, selectedCantrips, spellCount, cantripCount, onRemove}) {
		const totalSelected = (selectedSpells?.length || 0) + (selectedCantrips?.length || 0);

		const panel = e_({outer: `
			<div class="charsheet__spell-picker-summary">
				<div class="charsheet__spell-picker-summary-header">
					<span class="charsheet__spell-picker-summary-toggle">
						<span class="charsheet__spell-picker-summary-chevron">▶</span>
						<span class="charsheet__spell-picker-summary-title">Selected Spells</span>
						<span class="charsheet__spell-picker-summary-badge">${totalSelected}</span>
					</span>
				</div>
				<div class="charsheet__spell-picker-summary-body" style="display: none;">
					<div class="charsheet__spell-picker-chips"></div>
				</div>
			</div>
		`});

		const toggle = panel.querySelector(".charsheet__spell-picker-summary-toggle");
		const body = panel.querySelector(".charsheet__spell-picker-summary-body");
		const chevron = panel.querySelector(".charsheet__spell-picker-summary-chevron");

		toggle.addEventListener("click", () => {
			const isExpanded = body.style.display !== "none";
			body.style.display = isExpanded ? "none" : "";
			chevron.classList.toggle("charsheet__spell-picker-summary-chevron--expanded", !isExpanded);
		});

		return panel;
	}

	/**
	 * Update the summary panel with current selections.
	 * @private
	 */
	static _updateSummaryPanel ({panel, selectedSpells, selectedCantrips, spellCount, cantripCount, onRemove}) {
		const chips = panel.querySelector(".charsheet__spell-picker-chips");
		const badge = panel.querySelector(".charsheet__spell-picker-summary-badge");
		const totalSelected = (selectedSpells?.length || 0) + (selectedCantrips?.length || 0);

		badge.textContent = totalSelected;
		chips.innerHTML = "";

		if (totalSelected === 0) {
			chips.append(e_({outer: `<span class="charsheet__spell-picker-chips-empty">No spells selected yet</span>`}));
			return;
		}

		// Render cantrip chips
		if (selectedCantrips?.length > 0) {
			const cantripGroup = e_({tag: "div", clazz: "charsheet__spell-picker-chip-group"});
			cantripGroup.append(e_({outer: `<span class="charsheet__spell-picker-chip-group-label">Cantrips:</span>`}));
			const cantripChips = e_({tag: "div", clazz: "charsheet__spell-picker-chip-list"});

			selectedCantrips.forEach(spell => {
				const chip = e_({outer: `
					<span class="charsheet__spell-picker-chip charsheet__spell-picker-chip--cantrip">
						<span class="charsheet__spell-picker-chip-name">${spell.name}</span>
						<button class="charsheet__spell-picker-chip-remove" title="Remove ${spell.name}">×</button>
					</span>
				`});
				chip.querySelector(".charsheet__spell-picker-chip-remove").addEventListener("click", (e) => {
					e.stopPropagation();
					onRemove(spell, true);
				});
				cantripChips.append(chip);
			});

			cantripGroup.append(cantripChips);
			chips.append(cantripGroup);
		}

		// Render spell chips grouped by level
		if (selectedSpells?.length > 0) {
			const byLevel = {};
			selectedSpells.forEach(spell => {
				if (!byLevel[spell.level]) byLevel[spell.level] = [];
				byLevel[spell.level].push(spell);
			});

			Object.keys(byLevel).sort((a, b) => Number(a) - Number(b)).forEach(level => {
				const group = e_({tag: "div", clazz: "charsheet__spell-picker-chip-group"});
				group.append(e_({outer: `<span class="charsheet__spell-picker-chip-group-label">Level ${level}:</span>`}));
				const chipList = e_({tag: "div", clazz: "charsheet__spell-picker-chip-list"});

				byLevel[level].forEach(spell => {
					const chip = e_({outer: `
						<span class="charsheet__spell-picker-chip">
							<span class="charsheet__spell-picker-chip-name">${spell.name}</span>
							<button class="charsheet__spell-picker-chip-remove" title="Remove ${spell.name}">×</button>
						</span>
					`});
					chip.querySelector(".charsheet__spell-picker-chip-remove").addEventListener("click", (e) => {
						e.stopPropagation();
						onRemove(spell, false);
					});
					chipList.append(chip);
				});

				group.append(chipList);
				chips.append(group);
			});
		}
	}

	// ==========================================
	// Public Render Methods
	// ==========================================

	/**
	 * Render a known-spell + cantrip selection picker.
	 *
	 * @param {Object} opts
	 * @param {string} opts.className - Class name (e.g. "Sorcerer")
	 * @param {string} opts.classSource - Class source (e.g. "XPHB")
	 * @param {number} opts.spellCount - Number of leveled spells to pick
	 * @param {number} opts.cantripCount - Number of cantrips to pick
	 * @param {number} opts.maxSpellLevel - Max spell level available
	 * @param {Array} opts.allSpells - All spells from the page (pre-source-filtered)
	 * @param {Set<string>} opts.knownSpellIds - Set of "name|source" strings already known
	 * @param {Function} opts.onSelect - Callback(spells[], cantrips[]) on selection change
	 * @param {Function} [opts.getHoverLink] - Optional hover link builder (page, name, source) => html
	 * @param {Array} [opts.preSelectedSpells] - Pre-selected leveled spells
	 * @param {Array} [opts.preSelectedCantrips] - Pre-selected cantrips
	 * @param {Array} [opts.additionalClassNames] - Additional class names whose spell lists to include (e.g. ["Cleric"] for Divine Soul)
	 * @param {string} [opts.subclass] - Subclass short name (used for spell-source filtering, e.g. Divine Soul)
	 * @returns {HTMLElement} The section element
	 */
	static renderKnownSpellPicker (opts) {
		const {
			className,
			classSource,
			spellCount,
			cantripCount,
			maxSpellLevel,
			allSpells,
			knownSpellIds = new Set(),
			onSelect,
			getHoverLink,
			preSelectedSpells = [],
			preSelectedCantrips = [],
			additionalClassNames = [],
			subclass,
		} = opts;

		const totalCount = spellCount + cantripCount;
		const parts = [];
		if (spellCount > 0) parts.push(`${spellCount} spell${spellCount !== 1 ? "s" : ""} (up to level ${maxSpellLevel})`);
		if (cantripCount > 0) parts.push(`${cantripCount} cantrip${cantripCount !== 1 ? "s" : ""}`);

		const section = e_({outer: `
			<div class="charsheet__levelup-section charsheet__spell-picker-container">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-fire"></span> Spells Known
				</h5>
				<p class="ve-small">Choose ${parts.join(" and ")} for your ${className}:</p>
				<div class="charsheet__spell-picker-progress-area"></div>
				<div class="charsheet__spell-picker-selection"></div>
			</div>
		`});

		const progressArea = section.querySelector(".charsheet__spell-picker-progress-area");
		const selectedSpells = [...preSelectedSpells];
		const selectedCantrips = [...preSelectedCantrips];

		// Render progress header
		const progressHeader = CharacterSheetSpellPicker._renderProgressHeader({
			spellCount,
			cantripCount,
			selectedSpells,
			selectedCantrips,
		});
		progressArea.append(progressHeader);

		// Handler for removing spells from summary panel
		const handleRemove = (spell, isCantrip) => {
			const targetArr = isCantrip ? selectedCantrips : selectedSpells;
			const spellId = `${spell.name}|${spell.source}`;
			const idx = targetArr.findIndex(s => `${s.name}|${s.source}` === spellId);
			if (idx >= 0) {
				targetArr.splice(idx, 1);
				fireCallback();
				renderSpellList();
			}
		};

		// Render summary panel
		const summaryPanel = CharacterSheetSpellPicker._renderSummaryPanel({
			selectedSpells,
			selectedCantrips,
			spellCount,
			cantripCount,
			onRemove: handleRemove,
		});
		progressArea.append(summaryPanel);

		// Filter to class spells using Renderer API with fallback
		const classSpells = allSpells.filter(spell => {
			if (cantripCount > 0 && spellCount > 0) {
				if (spell.level > maxSpellLevel) return false;
			} else if (cantripCount > 0) {
				if (spell.level !== 0) return false;
			} else {
				if (spell.level < 1 || spell.level > maxSpellLevel) return false;
			}
			return CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
				className,
				subclass,
				additionalClassNames,
			});
		}).sort((a, b) => {
			if (a.level !== b.level) return a.level - b.level;
			return a.name.localeCompare(b.name);
		});

		// Collect unique schools for filters
		const schools = [...new Set(classSpells.map(s => s.school).filter(Boolean))].sort();

		// Two-column layout: left = filters + list, right = spell preview
		const selectionGrid = section.querySelector(".charsheet__spell-picker-selection");
		const listPane = e_({tag: "div", clazz: "charsheet__spell-picker-list-pane"});
		const previewPane = e_({outer: `
			<div class="charsheet__spell-picker-preview">
				<div class="charsheet__spell-picker-preview-placeholder">Select a spell to see details</div>
			</div>
		`});
		selectionGrid.append(listPane, previewPane);

		// Build filter row
		const filterRow = e_({tag: "div", clazz: "charsheet__spell-picker-filters"});
		listPane.append(filterRow);

		const search = e_({tag: "input", clazz: "ve-form-control form-control--minimal charsheet__spell-picker-search"});
		search.type = "text";
		search.placeholder = "🔍 Search spells...";
		filterRow.append(search);

		const filterSelects = e_({tag: "div", clazz: "charsheet__spell-picker-filter-selects"});
		filterRow.append(filterSelects);

		const levelOptions = [];
		if (cantripCount > 0) levelOptions.push({value: "0", label: "Cantrips"});
		for (let i = 1; i <= maxSpellLevel; i++) levelOptions.push({value: i.toString(), label: `Level ${i}`});
		const levelFilter = e_({outer: `
			<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 90px;">
				<option value="">All Levels</option>
				${levelOptions.map(l => `<option value="${l.value}">${l.label}</option>`).join("")}
			</select>
		`});
		filterSelects.append(levelFilter);

		const schoolFilter = e_({outer: `
			<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
				<option value="">All Schools</option>
				${schools.map(s => `<option value="${s}">${CharacterSheetClassUtils.getSchoolEmoji(s)} ${Parser.spSchoolAbvToFull(s)}</option>`).join("")}
			</select>
		`});
		filterSelects.append(schoolFilter);

		const rarities = CharacterSheetSpellPicker._extractSubschoolTagValues(classSpells, "rarity");
		const legalities = CharacterSheetSpellPicker._extractSubschoolTagValues(classSpells, "legality");

		let rarityFilter = null;
		if (rarities.length) {
			rarityFilter = e_({outer: `
				<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
					<option value="">All Rarities</option>
					${rarities.map(r => `<option value="${r}">${(/** @type {*} */ (r)).toTitleCase()}</option>`).join("")}
				</select>
			`});
			filterSelects.append(rarityFilter);
		}

		let legalityFilter = null;
		if (legalities.length) {
			legalityFilter = e_({outer: `
				<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
					<option value="">All Legalities</option>
					${legalities.map(l => `<option value="${l}">${(/** @type {*} */ (l)).toTitleCase()}</option>`).join("")}
				</select>
			`});
			filterSelects.append(legalityFilter);
		}

		const ritualFilter = e_({outer: `<label class="ve-flex-v-center ve-small" style="cursor: pointer; white-space: nowrap;"><input type="checkbox" class="mr-1"> 🔮 Ritual</label>`});
		const concFilter = e_({outer: `<label class="ve-flex-v-center ve-small" style="cursor: pointer; white-space: nowrap;"><input type="checkbox" class="mr-1"> ⏳ Conc.</label>`});
		filterSelects.append(ritualFilter, concFilter);

		const spellList = e_({tag: "div", clazz: "charsheet__spell-picker-list-content"});
		listPane.append(spellList);

		const fireCallback = () => {
			CharacterSheetSpellPicker._updateProgressHeader({
				header: progressHeader,
				spellCount,
				cantripCount,
				selectedSpells,
				selectedCantrips,
			});
			CharacterSheetSpellPicker._updateSummaryPanel({
				panel: summaryPanel,
				selectedSpells,
				selectedCantrips,
				spellCount,
				cantripCount,
				onRemove: handleRemove,
			});
			onSelect([...selectedSpells], [...selectedCantrips]);
		};

		const renderSpellList = () => {
			spellList.innerHTML = "";

			const searchText = search.value?.toLowerCase() || "";
			const levelVal = levelFilter.value;
			const schoolVal = schoolFilter.value;
			const onlyRitual = ritualFilter.querySelector("input").checked;
			const onlyConc = concFilter.querySelector("input").checked;
			const rarityVal = rarityFilter?.value || "";
			const legalityVal = legalityFilter?.value || "";

			const filtered = classSpells.filter(spell => {
				if (searchText && !spell.name.toLowerCase().includes(searchText)) return false;
				if (levelVal !== "" && levelVal !== undefined && spell.level !== parseInt(levelVal)) return false;
				if (schoolVal && spell.school !== schoolVal) return false;
				if (onlyRitual && !CharacterSheetClassUtils.spellIsRitual(spell)) return false;
				if (onlyConc && !CharacterSheetClassUtils.spellIsConcentration(spell)) return false;
				if (rarityVal && !(spell.subschools || []).includes(`rarity:${rarityVal}`)) return false;
				if (legalityVal && !(spell.subschools || []).includes(`legality:${legalityVal}`)) return false;
				return true;
			});

			if (!filtered.length) {
				spellList.append(e_({outer: `<p class="ve-muted text-center py-2">No spells match your filters</p>`}));
				return;
			}

			CharacterSheetSpellPicker._renderGroupedSpellList({
				container: spellList,
				spells: filtered,
				knownSpellIds,
				selectedSpells,
				selectedCantrips,
				spellCount,
				cantripCount,
				getHoverLink,
				previewPane,
				onToggle: (spell) => {
					const isCantrip = spell.level === 0;
					const targetArr = isCantrip ? selectedCantrips : selectedSpells;
					const maxCount = isCantrip ? cantripCount : spellCount;
					const typeLabel = isCantrip ? "cantrips" : "spells";
					const spellId = `${spell.name}|${spell.source}`;
					const idx = targetArr.findIndex(s => `${s.name}|${s.source}` === spellId);

					if (idx >= 0) {
						targetArr.splice(idx, 1);
					} else if (targetArr.length < maxCount) {
						targetArr.push(spell);
					} else {
						JqueryUtil.doToast({type: "warning", content: `You can only select ${maxCount} ${typeLabel}.`});
						return;
					}

					fireCallback();
					renderSpellList();
				},
			});
		};

		search.addEventListener("input", renderSpellList);
		levelFilter.addEventListener("change", renderSpellList);
		schoolFilter.addEventListener("change", renderSpellList);
		if (rarityFilter) rarityFilter.addEventListener("change", renderSpellList);
		if (legalityFilter) legalityFilter.addEventListener("change", renderSpellList);
		ritualFilter.querySelector("input").addEventListener("change", renderSpellList);
		concFilter.querySelector("input").addEventListener("change", renderSpellList);

		// Initialize header and summary if pre-selections exist
		if (selectedSpells.length || selectedCantrips.length) {
			CharacterSheetSpellPicker._updateProgressHeader({
				header: progressHeader,
				spellCount,
				cantripCount,
				selectedSpells,
				selectedCantrips,
			});
			CharacterSheetSpellPicker._updateSummaryPanel({
				panel: summaryPanel,
				selectedSpells,
				selectedCantrips,
				spellCount,
				cantripCount,
				onRemove: handleRemove,
			});
		}

		renderSpellList();

		return section;
	}

	/**
	 * Render a wizard spellbook spell selection picker.
	 *
	 * @param {Object} opts
	 * @param {number} opts.spellCount - Number of spells to select
	 * @param {number} opts.maxSpellLevel - Maximum spell level the wizard can learn
	 * @param {Array} opts.allSpells - All spells from the page (pre-source-filtered)
	 * @param {Set<string>} opts.knownSpellIds - Set of "name|source" strings already in spellbook
	 * @param {Function} opts.onSelect - Callback(spells[]) on selection change
	 * @param {Function} [opts.getHoverLink] - Optional hover link builder
	 * @param {Array} [opts.preSelectedSpells] - Pre-selected spells
	 * @param {string} [opts.className] - Class name (for display / spell-source filtering)
	 * @param {string} [opts.subclass] - Subclass short name (for display / spell-source filtering)
	 * @returns {HTMLElement} The section element
	 */
	static renderWizardSpellbookPicker (opts) {
		const {
			spellCount,
			maxSpellLevel,
			allSpells,
			knownSpellIds = new Set(),
			onSelect,
			getHoverLink,
			preSelectedSpells = [],
			className,
			subclass,
			subclassChoice,
			additionalClassNames = [],
		} = opts;

		const section = e_({outer: `
			<div class="charsheet__levelup-section charsheet__spell-picker-container">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-book"></span> Spellbook
				</h5>
				<p class="ve-small">Choose ${spellCount} wizard spells (up to level ${maxSpellLevel}) to add to your spellbook:</p>
				<div class="charsheet__spell-picker-progress-area"></div>
				<div class="charsheet__spell-picker-selection"></div>
			</div>
		`});

		const progressArea = section.querySelector(".charsheet__spell-picker-progress-area");
		const selectedSpells = [...preSelectedSpells];

		const progressHeader = CharacterSheetSpellPicker._renderProgressHeader({
			spellCount,
			cantripCount: 0,
			selectedSpells,
			selectedCantrips: [],
			isWizard: true,
		});
		progressArea.append(progressHeader);

		const handleRemove = (spell) => {
			const spellId = `${spell.name}|${spell.source}`;
			const idx = selectedSpells.findIndex(s => `${s.name}|${s.source}` === spellId);
			if (idx >= 0) {
				selectedSpells.splice(idx, 1);
				fireCallback();
				renderSpellList();
			}
		};

		const summaryPanel = CharacterSheetSpellPicker._renderSummaryPanel({
			selectedSpells,
			selectedCantrips: [],
			spellCount,
			cantripCount: 0,
			onRemove: handleRemove,
		});
		progressArea.append(summaryPanel);

		const wizardSpells = allSpells.filter(spell => {
			const isClassSpell = CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
				className: className || "Wizard",
				subclass,
				subclassChoice,
				additionalClassNames,
			});
			return isClassSpell && spell.level >= 1 && spell.level <= maxSpellLevel;
		}).sort((a, b) => {
			if (a.level !== b.level) return a.level - b.level;
			return a.name.localeCompare(b.name);
		});

		const schools = [...new Set(wizardSpells.map(s => s.school).filter(Boolean))].sort();

		// Two-column layout
		const selectionGrid = section.querySelector(".charsheet__spell-picker-selection");
		const listPane = e_({tag: "div", clazz: "charsheet__spell-picker-list-pane"});
		const previewPane = e_({outer: `
			<div class="charsheet__spell-picker-preview">
				<div class="charsheet__spell-picker-preview-placeholder">Select a spell to see details</div>
			</div>
		`});
		selectionGrid.append(listPane, previewPane);

		const filterRow = e_({tag: "div", clazz: "charsheet__spell-picker-filters"});
		listPane.append(filterRow);

		const search = e_({tag: "input", clazz: "ve-form-control form-control--minimal charsheet__spell-picker-search"});
		search.type = "text";
		search.placeholder = "🔍 Search spells...";
		filterRow.append(search);

		const filterSelects = e_({tag: "div", clazz: "charsheet__spell-picker-filter-selects"});
		filterRow.append(filterSelects);

		const levelOptions = [];
		for (let i = 1; i <= maxSpellLevel; i++) levelOptions.push({value: i.toString(), label: `Level ${i}`});
		const levelFilter = e_({outer: `
			<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 90px;">
				<option value="">All Levels</option>
				${levelOptions.map(l => `<option value="${l.value}">${l.label}</option>`).join("")}
			</select>
		`});
		filterSelects.append(levelFilter);

		const schoolFilter = e_({outer: `
			<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
				<option value="">All Schools</option>
				${schools.map(s => `<option value="${s}">${CharacterSheetClassUtils.getSchoolEmoji(s)} ${Parser.spSchoolAbvToFull(s)}</option>`).join("")}
			</select>
		`});
		filterSelects.append(schoolFilter);

		const rarities = CharacterSheetSpellPicker._extractSubschoolTagValues(wizardSpells, "rarity");
		const legalities = CharacterSheetSpellPicker._extractSubschoolTagValues(wizardSpells, "legality");

		let rarityFilter = null;
		if (rarities.length) {
			rarityFilter = e_({outer: `
				<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
					<option value="">All Rarities</option>
					${rarities.map(r => `<option value="${r}">${(/** @type {*} */ (r)).toTitleCase()}</option>`).join("")}
				</select>
			`});
			filterSelects.append(rarityFilter);
		}

		let legalityFilter = null;
		if (legalities.length) {
			legalityFilter = e_({outer: `
				<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
					<option value="">All Legalities</option>
					${legalities.map(l => `<option value="${l}">${(/** @type {*} */ (l)).toTitleCase()}</option>`).join("")}
				</select>
			`});
			filterSelects.append(legalityFilter);
		}

		const ritualFilter = e_({outer: `<label class="ve-flex-v-center ve-small" style="cursor: pointer; white-space: nowrap;"><input type="checkbox" class="mr-1"> 🔮 Ritual</label>`});
		const concFilter = e_({outer: `<label class="ve-flex-v-center ve-small" style="cursor: pointer; white-space: nowrap;"><input type="checkbox" class="mr-1"> ⏳ Conc.</label>`});
		filterSelects.append(ritualFilter, concFilter);

		const spellList = e_({tag: "div", clazz: "charsheet__spell-picker-list-content"});
		listPane.append(spellList);

		const fireCallback = () => {
			CharacterSheetSpellPicker._updateProgressHeader({
				header: progressHeader,
				spellCount,
				cantripCount: 0,
				selectedSpells,
				selectedCantrips: [],
			});
			CharacterSheetSpellPicker._updateSummaryPanel({
				panel: summaryPanel,
				selectedSpells,
				selectedCantrips: [],
				spellCount,
				cantripCount: 0,
				onRemove: handleRemove,
			});
			onSelect([...selectedSpells]);
		};

		const renderSpellList = () => {
			spellList.innerHTML = "";

			const searchText = search.value?.toLowerCase() || "";
			const levelVal = levelFilter.value;
			const schoolVal = schoolFilter.value;
			const onlyRitual = ritualFilter.querySelector("input").checked;
			const onlyConc = concFilter.querySelector("input").checked;
			const rarityVal = rarityFilter?.value || "";
			const legalityVal = legalityFilter?.value || "";

			const filtered = wizardSpells.filter(spell => {
				if (searchText && !spell.name.toLowerCase().includes(searchText)) return false;
				if (levelVal && spell.level !== parseInt(levelVal)) return false;
				if (schoolVal && spell.school !== schoolVal) return false;
				if (onlyRitual && !CharacterSheetClassUtils.spellIsRitual(spell)) return false;
				if (onlyConc && !CharacterSheetClassUtils.spellIsConcentration(spell)) return false;
				if (rarityVal && !(spell.subschools || []).includes(`rarity:${rarityVal}`)) return false;
				if (legalityVal && !(spell.subschools || []).includes(`legality:${legalityVal}`)) return false;
				return true;
			});

			if (!filtered.length) {
				spellList.append(e_({outer: `<p class="ve-muted text-center py-2">No spells match your filters</p>`}));
				return;
			}

			CharacterSheetSpellPicker._renderGroupedSpellList({
				container: spellList,
				spells: filtered,
				knownSpellIds,
				selectedSpells,
				selectedCantrips: null,
				spellCount,
				cantripCount: 0,
				getHoverLink,
				previewPane,
				onToggle: (spell) => {
					const spellId = `${spell.name}|${spell.source}`;
					const idx = selectedSpells.findIndex(s => `${s.name}|${s.source}` === spellId);

					if (idx >= 0) {
						selectedSpells.splice(idx, 1);
					} else if (selectedSpells.length < spellCount) {
						selectedSpells.push(spell);
					} else {
						JqueryUtil.doToast({type: "warning", content: `You can only select ${spellCount} spells.`});
						return;
					}

					fireCallback();
					renderSpellList();
				},
			});
		};

		search.addEventListener("input", renderSpellList);
		levelFilter.addEventListener("change", renderSpellList);
		schoolFilter.addEventListener("change", renderSpellList);
		if (rarityFilter) rarityFilter.addEventListener("change", renderSpellList);
		if (legalityFilter) legalityFilter.addEventListener("change", renderSpellList);
		ritualFilter.querySelector("input").addEventListener("change", renderSpellList);
		concFilter.querySelector("input").addEventListener("change", renderSpellList);

		if (selectedSpells.length) {
			CharacterSheetSpellPicker._updateProgressHeader({
				header: progressHeader,
				spellCount,
				cantripCount: 0,
				selectedSpells,
				selectedCantrips: [],
			});
			CharacterSheetSpellPicker._updateSummaryPanel({
				panel: summaryPanel,
				selectedSpells,
				selectedCantrips: [],
				spellCount,
				cantripCount: 0,
				onRemove: handleRemove,
			});
		}

		renderSpellList();

		return section;
	}

	// ==========================================
	// Spell Info Modal
	// ==========================================

	/**
	 * Show spell info in a modal.
	 * @param {Object} spell - Spell data object
	 */
	static async showSpellInfoModal (spell) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: spell.name,
			isMinHeight0: true,
			zIndex: 10002,
		});

		const levelSchool = spell.level === 0
			? `${Parser.spSchoolAbvToFull(spell.school)} cantrip`
			: `${Parser.spLevelToFull(spell.level)}-level ${Parser.spSchoolAbvToFull(spell.school).toLowerCase()}`;

		modalInner.append(e_({outer: `<p class="ve-muted"><em>${levelSchool}</em></p>`}));

		const infoLines = [];
		if (spell.time?.length) {
			const time = spell.time[0];
			infoLines.push(`<strong>Casting Time:</strong> ${time.number} ${time.unit}`);
		}
		if (spell.range) {
			let rangeStr = "";
			const range = spell.range;
			if (range.type === "point") {
				if (range.distance?.type === "self") rangeStr = "Self";
				else if (range.distance?.type === "touch") rangeStr = "Touch";
				else rangeStr = `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
			} else {
				rangeStr = range.type || "";
			}
			infoLines.push(`<strong>Range:</strong> ${rangeStr}`);
		}
		if (spell.components) {
			infoLines.push(`<strong>Components:</strong> ${CharacterSheetClassUtils.getSpellComponents(spell)}`);
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

		modalInner.append(e_({outer: `<div class="mb-2">${infoLines.join("<br>")}</div>`}));

		if (spell.entries) {
			modalInner.append(e_({outer: `<div class="rd__b">${Renderer.get().render({type: "entries", entries: spell.entries})}</div>`}));
		}

		if (spell.entriesHigherLevel) {
			modalInner.append(e_({outer: `<div class="rd__b mt-2"><strong>At Higher Levels.</strong> ${Renderer.get().render({type: "entries", entries: spell.entriesHigherLevel})}</div>`}));
		}

		const closeRow = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		closeRow.querySelector("button").addEventListener("click", () => doClose(false));
		modalInner.append(closeRow);
	}

	// ==========================================
	// Private Render Helpers
	// ==========================================

	/**
	 * Extract unique tag values from spell subschools matching a given prefix.
	 * E.g. prefix "rarity" extracts ["common", "uncommon"] from subschools ["rarity:common", "rarity:uncommon"].
	 * @param {Array} spells - Array of spell objects
	 * @param {string} prefix - Tag prefix to match (e.g. "rarity", "legality")
	 * @returns {string[]} Sorted unique tag values
	 * @private
	 */
	static _extractSubschoolTagValues (spells, prefix) {
		const values = new Set();
		for (const spell of spells) {
			if (!spell.subschools?.length) continue;
			for (const sub of spell.subschools) {
				if (sub.startsWith(`${prefix}:`)) {
					values.add(sub.slice(prefix.length + 1));
				}
			}
		}
		return [...values].sort();
	}

	/**
	 * Render a grouped-by-level spell list into a container.
	 * Shared rendering logic used by all pickers.
	 * @private
	 */
	static _renderGroupedSpellList ({container, spells, knownSpellIds, selectedSpells, selectedCantrips, spellCount, cantripCount, getHoverLink, previewPane, onToggle}) {
		const byLevel = {};
		spells.forEach(spell => {
			if (!byLevel[spell.level]) byLevel[spell.level] = [];
			byLevel[spell.level].push(spell);
		});

		Object.keys(byLevel).sort((a, b) => Number(a) - Number(b)).forEach(level => {
			const levelNum = parseInt(level);
			const levelEmoji = levelNum === 0
				? "🔮"
				: (["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"][levelNum - 1] || "📜");
			const levelLabel = levelNum === 0 ? "Cantrips" : `Level ${level}`;

			const levelSection = e_({tag: "div", clazz: "charsheet__spell-picker-section"});
			container.append(levelSection);
			levelSection.append(e_({outer: `<div class="charsheet__spell-picker-section-title">${levelEmoji} ${levelLabel} <span style="opacity: 0.6;">(${byLevel[level].length})</span></div>`}));

			byLevel[level].forEach(spell => {
				const spellId = `${spell.name}|${spell.source}`;
				const isKnown = knownSpellIds.has(spellId);
				const isCantrip = spell.level === 0;
				const isSelected = isCantrip && selectedCantrips
					? selectedCantrips.some(s => `${s.name}|${s.source}` === spellId)
					: selectedSpells.some(s => `${s.name}|${s.source}` === spellId);

				const schoolEmoji = CharacterSheetClassUtils.getSchoolEmoji(spell.school);

				const isConcentration = CharacterSheetClassUtils.spellIsConcentration(spell);
				const isRitual = CharacterSheetClassUtils.spellIsRitual(spell);

				const tagParts = [];
				if (isRitual) tagParts.push("🔮");
				if (isConcentration) tagParts.push("⏳");
				const tagsStr = tagParts.length ? ` ${tagParts.join(" ")}` : "";

				const selectedClass = isSelected ? " charsheet__spell-picker-item--selected" : "";
				const knownClass = isKnown ? " charsheet__spell-picker-item--known" : "";

				const item = e_({outer: `
					<div class="charsheet__spell-picker-item${selectedClass}${knownClass}">
						<div class="charsheet__spell-picker-item-info">
							<span class="charsheet__spell-picker-item-icon">${schoolEmoji}</span>
							<span class="charsheet__spell-picker-item-name"></span>
							<span class="charsheet__spell-picker-item-tags">${tagsStr}</span>
							<span class="charsheet__spell-picker-item-source">${Parser.sourceJsonToAbv(spell.source)}</span>
						</div>
						${isKnown
		? `<span class="charsheet__spell-picker-item-badge charsheet__spell-picker-item-badge--known">✓ Known</span>`
		: isSelected
			? `<button class="ve-btn ve-btn-danger ve-btn-xs spell-toggle">✓</button>`
			: `<button class="ve-btn ve-btn-primary ve-btn-xs spell-toggle">+</button>`
}
					</div>
				`});

				// Add spell name with hover link
				const nameEl = item.querySelector(".charsheet__spell-picker-item-name");
				try {
					if (getHoverLink) {
						const hoverLink = getHoverLink(UrlUtil.PG_SPELLS, spell.name, spell.source || Parser.SRC_XPHB);
						nameEl.innerHTML = hoverLink;
					} else {
						nameEl.textContent = spell.name;
					}
				} catch (e) {
					nameEl.textContent = spell.name;
				}

				if (!isKnown) {
					item.querySelector(".spell-toggle")?.addEventListener("click", (e) => {
						e.stopPropagation();
						onToggle(spell);
					});
				}

				// Click on row → show preview (not on button or link)
				item.addEventListener("click", (e) => {
					if (e.target.matches("button") || e.target.closest("a")) return;
					if (previewPane) {
						CharacterSheetSpellPicker._renderSpellPreview(previewPane, spell);
						// Highlight active preview row
						container.querySelectorAll(".charsheet__spell-picker-item--previewing").forEach(el => el.classList.remove("charsheet__spell-picker-item--previewing"));
						item.classList.add("charsheet__spell-picker-item--previewing");
					} else {
						CharacterSheetSpellPicker.showSpellInfoModal(spell);
					}
				});

				levelSection.append(item);
			});
		});
	}
	/**
	 * Render spell details into the preview pane.
	 * @param {HTMLElement} previewPane - The preview container element
	 * @param {Object} spell - Spell data object
	 * @private
	 */
	static _renderSpellPreview (previewPane, spell) {
		previewPane.innerHTML = "";

		const levelSchool = spell.level === 0
			? `${Parser.spSchoolAbvToFull(spell.school)} cantrip`
			: `${Parser.spLevelToFull(spell.level)}-level ${Parser.spSchoolAbvToFull(spell.school).toLowerCase()}`;

		const header = e_({outer: `
			<div class="charsheet__spell-picker-preview-header">
				<div class="charsheet__spell-picker-preview-name">${spell.name}</div>
				<div class="charsheet__spell-picker-preview-school">${levelSchool}</div>
			</div>
		`});
		previewPane.append(header);

		const infoLines = [];
		if (spell.time?.length) {
			const time = spell.time[0];
			infoLines.push(`<strong>Casting Time:</strong> ${time.number} ${time.unit}`);
		}
		if (spell.range) {
			let rangeStr = "";
			const range = spell.range;
			if (range.type === "point") {
				if (range.distance?.type === "self") rangeStr = "Self";
				else if (range.distance?.type === "touch") rangeStr = "Touch";
				else rangeStr = `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
			} else {
				rangeStr = range.type || "";
			}
			infoLines.push(`<strong>Range:</strong> ${rangeStr}`);
		}
		if (spell.components) {
			infoLines.push(`<strong>Components:</strong> ${CharacterSheetClassUtils.getSpellComponents(spell)}`);
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

		if (infoLines.length) {
			previewPane.append(e_({outer: `<div class="charsheet__spell-picker-preview-info">${infoLines.join("<br>")}</div>`}));
		}

		if (spell.entries) {
			try {
				previewPane.append(e_({outer: `<div class="rd__b charsheet__spell-picker-preview-body">${Renderer.get().render({type: "entries", entries: spell.entries})}</div>`}));
			} catch (e) {
				// Renderer may not be available in all contexts
			}
		}

		if (spell.entriesHigherLevel) {
			try {
				previewPane.append(e_({outer: `<div class="rd__b charsheet__spell-picker-preview-body"><strong>At Higher Levels.</strong> ${Renderer.get().render({type: "entries", entries: spell.entriesHigherLevel})}</div>`}));
			} catch (e) {
				// Renderer may not be available
			}
		}
	}
}

// Export
export {CharacterSheetSpellPicker};
globalThis.CharacterSheetSpellPicker = CharacterSheetSpellPicker;
