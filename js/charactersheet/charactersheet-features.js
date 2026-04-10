/**
 * Character Sheet Features Manager
 * Handles class features, racial traits, feats, and other abilities
 */
class CharacterSheetFeatures {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allFeats = [];
		this._expandedFeatures = new Set();

		this._init();
	}

	_init () {
		this._initEventListeners();
	}

	setFeats (feats) {
		this._allFeats = feats;
	}

	/**
	 * Look up a class feature's description from loaded data
	 */
	_getClassFeatureDescription (feature) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length) return null;

		const match = classFeatures.find(f =>
			f.name === feature.name
			&& f.className === feature.className
			&& f.level === feature.level,
		);

		if (match?.entries) {
			return Renderer.get().render({entries: match.entries});
		}
		return null;
	}

	/**
	 * Look up a subclass feature's description from loaded data
	 */
	_getSubclassFeatureDescription (feature) {
		const subclassFeatures = this._page.getSubclassFeatures();
		if (!subclassFeatures?.length) return null;

		const match = subclassFeatures.find(f =>
			f.name === feature.name
			&& f.className === feature.className
			&& f.subclassShortName === (feature.subclassShortName || feature.subclassName)
			&& f.level === feature.level,
		);

		if (match?.entries) {
			return Renderer.get().render({entries: match.entries});
		}
		return null;
	}

	/**
	 * Look up a feat's description from loaded data
	 */
	_getFeatDescription (feat) {
		const allFeats = this._allFeats;
		if (!allFeats?.length) return null;

		const match = allFeats.find(f =>
			f.name === feat.name
			&& f.source === feat.source,
		);

		if (match?.entries) {
			return Renderer.get().render({type: "entries", entries: match.entries});
		}
		return null;
	}

	/**
	 * Get the description for a feature, looking it up if not stored
	 */
	_getFeatureDescription (feature) {
		// If description is already stored, use it
		if (feature.description) return feature.description;

		// Try to look up the description based on feature type
		if (feature.featureType === "Class" && feature.className) {
			if (feature.isSubclassFeature || feature.subclassName) {
				return this._getSubclassFeatureDescription(feature);
			}
			return this._getClassFeatureDescription(feature);
		}

		return null;
	}

	_initEventListeners () {
		document.addEventListener("click", (e) => {
			// Add feat button
			if (e.target.closest("#charsheet-add-feat")) {
				this._showFeatPicker();
				return;
			}

			// Toggle feature expansion - only on the chevron toggle button
			const featureToggle = e.target.closest(".charsheet__feature-toggle");
			if (featureToggle) {
				e.stopPropagation();
				const feature = featureToggle.closest(".charsheet__feature");
				const featureId = feature?.dataset.featureId;
				this._toggleFeatureExpansion(featureId);
				return;
			}

			// Remove feature
			const featureRemove = e.target.closest(".charsheet__feature-remove");
			if (featureRemove) {
				e.stopPropagation();
				const featureId = featureRemove.closest(".charsheet__feature")?.dataset.featureId;
				this._removeFeature(featureId);
				return;
			}

			// Use feature (for features with limited uses)
			const featureUse = e.target.closest(".charsheet__feature-use");
			if (featureUse) {
				e.stopPropagation();
				const featureId = featureUse.closest(".charsheet__feature")?.dataset.featureId;
				this._useFeature(featureId);
				return;
			}

			// Feature note button
			const featureNote = e.target.closest(".charsheet__feature-note");
			if (featureNote) {
				e.stopPropagation();
				const featureEl = featureNote.closest(".charsheet__feature");
				const featureId = featureEl?.dataset.featureId;
				const feature = this._state.getFeatures().find(f => f.id === featureId);
				if (!feature) return;
				const renderFn = () => this.render();
				this._page.getNotes()?.showNoteModal(
					"feature",
					featureId,
					feature.name,
					renderFn,
				);
				return;
			}

			// Feat note button
			const featNote = e.target.closest(".charsheet__feat-note");
			if (featNote) {
				e.stopPropagation();
				const featEl = featNote.closest(".charsheet__feat");
				const featId = featEl?.dataset.featId;
				const feat = this._state.getFeats().find(f => f.id === featId);
				if (!feat) return;
				const renderFn = () => this.render();
				this._page.getNotes()?.showNoteModal(
					"feat",
					featId,
					feat.name,
					renderFn,
				);
				return;
			}

			// Resource management
			const resourcePip = e.target.closest(".charsheet__resource-pip");
			if (resourcePip) {
				const resourceId = resourcePip.closest(".charsheet__resource")?.dataset.resourceId;
				this._toggleResourcePip(resourceId, resourcePip);
				return;
			}

			// "+X more features" modal trigger
			const summaryMore = e.target.closest(".charsheet__feature-summary-more");
			if (summaryMore) {
				const featureType = summaryMore.dataset.featureType;
				this._pShowMoreFeaturesModal(featureType);
				return;
			}

			// Also toggle on header click, but not if clicking a link
			const featureHeader = e.target.closest(".charsheet__feature-header");
			if (featureHeader) {
				if (e.target.closest("a, button, .charsheet__feature-actions")) return;
				const feature = featureHeader.closest(".charsheet__feature");
				const featureId = feature?.dataset.featureId;
				this._toggleFeatureExpansion(featureId);
			}
		});
	}

	_toggleFeatureExpansion (featureId) {
		const featureEl = document.querySelector(`.charsheet__feature[data-feature-id="${featureId}"]`);
		if (!featureEl) return;
		const body = featureEl.querySelector(".charsheet__feature-body");
		const toggle = featureEl.querySelector(".charsheet__feature-toggle");

		if (this._expandedFeatures.has(featureId)) {
			this._expandedFeatures.delete(featureId);
			body.style.display = "none";
			toggle.classList.remove("glyphicon-chevron-up");
			toggle.classList.add("glyphicon-chevron-down");
		} else {
			this._expandedFeatures.add(featureId);
			body.style.display = "block";
			toggle.classList.remove("glyphicon-chevron-down");
			toggle.classList.add("glyphicon-chevron-up");
		}
	}

	async _showFeatPicker () {
		await this._pShowFeatPickerModal();
	}

	async _pShowFeatPickerModal () {
		const knownFeatNames = this._state.getFeats().map(f => f.name.toLowerCase());

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "🎖️ Add Feat",
			isMinHeight0: true,
			isWidth100: true,
		});

		// Filter feats by allowed sources
		const sourceFilteredFeats = this._page.filterByAllowedSources(this._allFeats);

		// Unique sources from feats
		const uniqueSources = [...new Set(sourceFilteredFeats.map(f => f.source))].sort((a, b) => {
			const priority = ["PHB", "XGE", "TCE", "FTD", "XPHB"];
			const aIdx = priority.indexOf(a);
			const bIdx = priority.indexOf(b);
			if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
			if (aIdx !== -1) return -1;
			if (bIdx !== -1) return 1;
			return a.localeCompare(b);
		});

		// Get unique categories from feats
		const categories = [...new Set(sourceFilteredFeats.map(f => f.category || "General"))].sort();

		// Intro text
		modalInner.append(e_({outer: `
			<p class="ve-small ve-muted mb-3">
				Browse and add feats to your character. Click a feat to view details, or click <strong>+ Add</strong> to add it directly.
			</p>
		`}));

		// Build enhanced filter UI (matching spell picker)
		const filterContainer = e_({tag: "div", clazz: "charsheet__modal-filter"});
		modalInner.append(filterContainer);

		// Helper function to position dropdown towards center of modal
		const positionDropdown = (dropdown, btn) => {
			const btnRect = btn.getBoundingClientRect();
			const modalRect = modalInner.getBoundingClientRect();
			const btnCenterX = btnRect.left + btnRect.width / 2;
			const modalCenterX = modalRect.left + modalRect.width / 2;

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
		filterContainer.append(searchWrapper);
		const search = e_({tag: "input", clazz: "ve-form-control"});
		search.type = "text";
		search.placeholder = "🔍 Search feats by name...";
		searchWrapper.append(search);

		// Category filter
		let selectedCategories = new Set(); // Empty = all
		const categoryDropdown = e_({outer: `
			<div class="charsheet__source-multiselect charsheet__category-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">📂</span>
					<span class="charsheet__source-multiselect-text">All Categories</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">Select All</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
					</div>
					<div class="charsheet__source-multiselect-list">
						${categories.map(c => `
							<label class="charsheet__source-multiselect-item">
								<input type="checkbox" value="${c}" checked>
								<span class="charsheet__source-multiselect-check">✓</span>
								<span class="charsheet__source-multiselect-label">${c}</span>
							</label>
						`).join("")}
					</div>
				</div>
			</div>
		`});
		filterContainer.append(categoryDropdown);

		// Category dropdown behavior
		const categoryBtn = categoryDropdown.querySelector(".charsheet__source-multiselect-btn");
		const categoryDropdownMenu = categoryDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const categoryText = categoryDropdown.querySelector(".charsheet__source-multiselect-text");

		categoryBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(categoryDropdownMenu, categoryBtn);
			categoryDropdownMenu.classList.toggle("open");
			sourceDropdownMenu?.classList.remove("open");
		});

		const updateCategoryText = () => {
			const checked = [...categoryDropdown.querySelectorAll("input:checked")];
			if (checked.length === 0) {
				categoryText.textContent = "No Categories";
				selectedCategories = new Set(["__NONE__"]);
			} else if (checked.length === categories.length) {
				categoryText.textContent = "All Categories";
				selectedCategories = new Set();
			} else if (checked.length <= 2) {
				categoryText.textContent = checked.map(el => el.value).join(", ");
				selectedCategories = new Set(checked.map(el => el.value));
			} else {
				categoryText.textContent = `${checked.length} Categories`;
				selectedCategories = new Set(checked.map(el => el.value));
			}
			renderList();
		};

		categoryDropdown.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", updateCategoryText));
		categoryDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			categoryDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateCategoryText();
		});
		categoryDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			categoryDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateCategoryText();
		});
		categoryDropdownMenu.addEventListener("click", (e) => e.stopPropagation());

		// Spacer to push source filter to the right
		const spacer = e_({tag: "div", clazz: "charsheet__filter-spacer"});
		spacer.style.flex = "1";
		filterContainer.append(spacer);

		// Source filter (on the right)
		let selectedSources = new Set(); // Empty = all
		const sourceDropdown = e_({outer: `
			<div class="charsheet__source-multiselect">
				<button class="charsheet__source-multiselect-btn">
					<span class="charsheet__source-multiselect-icon">📖</span>
					<span class="charsheet__source-multiselect-text">All Sources</span>
					<span class="charsheet__source-multiselect-arrow">▼</span>
				</button>
				<div class="charsheet__source-multiselect-dropdown charsheet__source-dropdown--right">
					<div class="charsheet__source-multiselect-actions">
						<button class="charsheet__source-action-btn" data-action="all">Select All</button>
						<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
						<button class="charsheet__source-action-btn" data-action="official">Official</button>
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
		filterContainer.append(sourceDropdown);

		// Source dropdown behavior
		const sourceBtn = sourceDropdown.querySelector(".charsheet__source-multiselect-btn");
		const sourceDropdownMenu = sourceDropdown.querySelector(".charsheet__source-multiselect-dropdown");
		const sourceText = sourceDropdown.querySelector(".charsheet__source-multiselect-text");

		sourceBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			positionDropdown(sourceDropdownMenu, sourceBtn);
			sourceDropdownMenu.classList.toggle("open");
			categoryDropdownMenu.classList.remove("open");
		});

		const featSourceFilterHandler = () => {
			categoryDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
		};
		document.addEventListener("click", featSourceFilterHandler);
		sourceDropdownMenu.addEventListener("click", (e) => e.stopPropagation());

		const updateSourceText = () => {
			const checked = [...sourceDropdown.querySelectorAll("input:checked")];
			if (checked.length === 0) {
				sourceText.textContent = "No Sources";
				selectedSources = new Set(["__NONE__"]);
			} else if (checked.length === uniqueSources.length) {
				sourceText.textContent = "All Sources";
				selectedSources = new Set();
			} else if (checked.length <= 2) {
				sourceText.textContent = checked.map(el => Parser.sourceJsonToAbv(el.value)).join(", ");
				selectedSources = new Set(checked.map(el => el.value));
			} else {
				sourceText.textContent = `${checked.length} Sources`;
				selectedSources = new Set(checked.map(el => el.value));
			}
			renderList();
		};

		sourceDropdown.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", updateSourceText));
		sourceDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
			sourceDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
			updateSourceText();
		});
		sourceDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
			sourceDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
			updateSourceText();
		});
		sourceDropdown.querySelector("[data-action=official]").addEventListener("click", () => {
			const official = ["PHB", "XGE", "TCE", "FTD", "XPHB"];
			sourceDropdown.querySelectorAll("input").forEach(el => {
				el.checked = official.includes(el.value);
			});
			updateSourceText();
		});

		// Quick filter: Prerequisites
		const quickFilters = e_({tag: "div", clazz: "charsheet__modal-quick-filters"});
		modalInner.append(quickFilters);
		let filterNoPrereq = false;
		const noPrereqBtn = e_({tag: "button", clazz: "charsheet__modal-filter-btn", txt: "🆓 No Prerequisites"});
		quickFilters.append(noPrereqBtn);

		// Results count
		const resultsCount = e_({tag: "div", clazz: "charsheet__modal-results-count"});
		modalInner.append(resultsCount);

		// Feat list
		const list = e_({tag: "div", clazz: "charsheet__modal-list"});
		modalInner.append(list);

		const renderList = () => {
			list.innerHTML = "";
			const searchTerm = search.value.toLowerCase();

			const filtered = sourceFilteredFeats.filter(feat => {
				if (searchTerm && !feat.name.toLowerCase().includes(searchTerm)) return false;
				// Category filter
				if (selectedCategories.has("__NONE__")) return false;
				const featCategory = feat.category || "General";
				if (selectedCategories.size > 0 && !selectedCategories.has(featCategory)) return false;
				// Source filter
				if (selectedSources.has("__NONE__")) return false;
				if (selectedSources.size > 0 && !selectedSources.has(feat.source)) return false;
				// No prereq filter
				if (filterNoPrereq && feat.prerequisite?.length) return false;
				return true;
			});

			const knownCount = filtered.filter(f => knownFeatNames.includes(f.name.toLowerCase())).length;
			resultsCount.innerHTML = `<span>${filtered.length} feat${filtered.length !== 1 ? "s" : ""} found</span>${knownCount > 0 ? `<span class="ml-2" style="color: var(--cs-success);">(${knownCount} already known)</span>` : ""}`;

			if (!filtered.length) {
				list.innerHTML = `
					<div class="charsheet__modal-empty">
						<div class="charsheet__modal-empty-icon">🎖️</div>
						<div class="charsheet__modal-empty-text">No feats match your filters.<br>Try adjusting your search or filters.</div>
					</div>
				`;
				return;
			}

			// Group by category
			const grouped = {};
			filtered.forEach(feat => {
				const category = feat.category || "General";
				if (!grouped[category]) grouped[category] = [];
				grouped[category].push(feat);
			});

			Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).forEach(([category, categoryFeats]) => {
				const section = e_({tag: "div", clazz: "charsheet__modal-section"});
				list.append(section);
				section.append(e_({outer: `<div class="charsheet__modal-section-title">📂 ${category} <span style="opacity: 0.6;">(${categoryFeats.length})</span></div>`}));

				categoryFeats.forEach(feat => {
					const isKnown = knownFeatNames.includes(feat.name.toLowerCase());
					const prereqStr = feat.prerequisite ? this._formatPrerequisite(feat.prerequisite) : "";
					const featLink = this._page?.getHoverLink ? this._page.getHoverLink(UrlUtil.PG_FEATS, feat.name, feat.source) : feat.name;

					const item = e_({outer: `
						<div class="charsheet__modal-list-item ${isKnown ? "ve-muted" : ""}">
							<div class="charsheet__modal-list-item-icon">🎖️</div>
							<div class="charsheet__modal-list-item-content">
								<div class="charsheet__modal-list-item-title">${featLink}</div>
								<div class="charsheet__modal-list-item-subtitle">${prereqStr ? `Prereq: ${prereqStr} • ` : ""}${Parser.sourceJsonToAbv(feat.source)}</div>
							</div>
							${isKnown
		? `<span class="charsheet__modal-list-item-badge charsheet__modal-list-item-badge--known">✓ Known</span>`
		: `<button class="ve-btn ve-btn-primary ve-btn-xs feat-picker-add">+ Add</button>`
}
						</div>
					`});

					if (!isKnown) {
						const addBtn = item.querySelector(".feat-picker-add");
						addBtn.addEventListener("click", async (e) => {
							e.stopPropagation();
							await this._addFeat(feat);
							knownFeatNames.push(feat.name.toLowerCase());
							item.classList.add("ve-muted");
							addBtn.replaceWith(e_({outer: `<span class="charsheet__modal-list-item-badge charsheet__modal-list-item-badge--known">✓ Known</span>`}));
							JqueryUtil.doToast({type: "success", content: `Added ${feat.name}`});
						});

						item.addEventListener("click", (e) => {
							if (!e.target.matches("button")) {
								this._showFeatInfo(feat);
							}
						});
					}

					section.append(item);
				});
			});
		};

		// Toggle quick filter button
		noPrereqBtn.addEventListener("click", () => {
			filterNoPrereq = !filterNoPrereq;
			noPrereqBtn.classList.toggle("active", filterNoPrereq);
			renderList();
		});

		search.addEventListener("input", MiscUtil.debounce(() => renderList(), 150));
		renderList();

		// Close button
		const closeWrapper = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(closeWrapper);
		closeWrapper.querySelector("button").addEventListener("click", () => {
			document.removeEventListener("click", featSourceFilterHandler);
			doClose(false);
		});
	}

	_formatPrerequisite (prereq) {
		if (!prereq?.length) return "";

		return prereq.map(p => {
			const parts = [];
			if (p.ability) {
				p.ability.forEach(a => {
					Object.entries(a).forEach(([abi, score]) => {
						parts.push(`${Parser.attAbvToFull(abi)} ${score}+`);
					});
				});
			}
			if (p.spellcasting) parts.push("Spellcasting");
			if (p.proficiency) {
				p.proficiency.forEach(prof => {
					if (prof.armor) parts.push(`${prof.armor} armor proficiency`);
					if (prof.weapon) parts.push(`${prof.weapon} weapon proficiency`);
				});
			}
			if (p.race) {
				p.race.forEach(r => parts.push(r.name));
			}
			if (p.level) {
				parts.push(`Level ${p.level.level}+`);
			}
			return parts.join(", ");
		}).join("; ");
	}

	async _addFeat (feat) {
		const newFeat = {
			name: feat.name,
			source: feat.source,
			description: feat.entries ? Renderer.get().render({type: "entries", entries: feat.entries}) : "",
			additionalSpells: feat.additionalSpells, // Preserve for spell processing
		};

		// Apply ability score increases
		if (feat.ability) {
			feat.ability.forEach(abiSet => {
				const max = abiSet.max || 20;
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi === "max") return; // Skip the max property itself
					if (Parser.ABIL_ABVS.includes(abi) && typeof bonus === "number") {
						const current = this._state.getAbilityBase(abi);
						this._state.setAbilityBase(abi, Math.min(max, current + bonus));
					}
				});
			});
		}

		this._state.addFeat(newFeat, {allSpells: this._page.getSpells()});
		this.render();
		this._page.saveCharacter();

		// Check for pending spell choices and trigger the picker
		if (this._state.hasPendingSpellChoices()) {
			// Give UI time to update before showing modal
			await MiscUtil.pDelay(100);
			if (this._page._spells) {
				await this._page._spells.processPendingSpellChoices();
				this.render(); // Re-render after spell selection
			}
		}
	}

	async _showFeatInfo (feat) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: feat.name,
			isMinHeight0: true,
		});

		if (feat.prerequisite) {
			modalInner.append(e_({outer: `<p class="ve-muted"><em>Prerequisite: ${this._formatPrerequisite(feat.prerequisite)}</em></p>`}));
		}
		if (feat.entries) {
			modalInner.append(e_({outer: `<div class="rd__b">${Renderer.get().render({type: "entries", entries: feat.entries})}</div>`}));
		}

		const closeWrapper = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(closeWrapper);
		closeWrapper.querySelector("button").addEventListener("click", () => doClose(false));
	}

	/**
	 * Show modal with all features of a given type (Class or Species)
	 * @param {string} featureType - "Class" or "Species"
	 */
	async _pShowMoreFeaturesModal (featureType) {
		const allFeatures = this._state.getFeatures();

		// Get features matching the type
		let features;
		let title;
		if (featureType === "Class") {
			features = allFeatures.filter(f => f.featureType === "Class");
			title = "All Class Features";
		} else if (featureType === "Species") {
			features = allFeatures.filter(f => f.featureType === "Species" || f.featureType === "Subrace" || f.featureType === "Race");
			title = "All Species Features";
		} else {
			return;
		}

		if (!features.length) {
			JqueryUtil.doToast({type: "info", content: `No ${featureType.toLowerCase()} features found.`});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title,
			isMinHeight0: true,
			isWidth100: true,
		});

		// Render each feature
		const list = e_({tag: "div", clazz: "ve-flex-col"});
		features.forEach(feature => {
			const usesStr = feature.uses
				? `<span class="ve-muted ml-2">(${feature.uses.current}/${feature.uses.max} uses)</span>`
				: "";

			const featureEntry = e_({outer: `
				<div class="charsheet__modal-feature-entry py-1 bb-1">
					<div class="ve-flex-v-center">
						<strong>${feature.name}</strong>
						${usesStr}
						${feature.className ? `<span class="ve-muted ml-auto ve-small">${feature.className}${feature.level ? ` L${feature.level}` : ""}</span>` : ""}
					</div>
					${feature.description ? `<div class="ve-small mt-1">${feature.description}</div>` : ""}
				</div>
			`});
			list.append(featureEntry);
		});

		modalInner.append(list);

		const closeWrapper = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(closeWrapper);
		closeWrapper.querySelector("button").addEventListener("click", () => doClose(false));
	}

	_removeFeature (featureId) {
		this._state.removeFeature(featureId);
		this.render();
		this._page.saveCharacter();
	}

	_useFeature (featureId) {
		// For features with limited uses, decrement the use count
		const features = this._state.getFeatures();
		const feature = features.find(f => f.id === featureId);
		if (!feature || !feature.uses) return;

		if (feature.uses.current > 0) {
			// Use state method to persist the change
			this._state.setFeatureUses(featureId, feature.uses.current - 1);
			this.render();
			this._page.saveCharacter();
		} else {
			JqueryUtil.doToast({type: "warning", content: `No uses of ${feature.name} remaining!`});
		}
	}

	_toggleResourcePip (resourceId, pip) {
		const resources = this._state.getResources();
		const resource = resources.find(r => r.id === resourceId);
		if (!resource) return;

		const container = pip.closest(".charsheet__resource");
		const pips = [...container.querySelectorAll(".charsheet__resource-pip")];
		const pipIndex = pips.indexOf(pip);

		let newCurrent;
		if (pip.classList.contains("used")) {
			// Restore this pip and all pips after it
			pips.slice(pipIndex).forEach(p => p.classList.remove("used"));
			newCurrent = resource.max - pipIndex;
		} else {
			// Use this pip and all pips before it
			pips.slice(0, pipIndex + 1).forEach(p => p.classList.add("used"));
			newCurrent = resource.max - pipIndex - 1;
		}

		// Use state method to persist the change
		this._state.setResourceCurrent(resourceId, newCurrent);
		this._page.saveCharacter();
	}

	// #region Rendering
	render () {
		this._renderClassFeatures();
		this._renderRaceFeatures();
		this._renderBackgroundFeatures();
		this._renderFeats();
		this._renderResources();
		this._renderProficiencies();
		this._renderLanguages();
		this._renderFeaturesSummary();
	}

	_renderClassFeatures () {
		const container = document.getElementById("charsheet-class-features");
		if (!container) return;

		container.innerHTML = "";

		const classes = this._state.getClasses();
		const allFeatures = this._state.getFeatures();
		const classNames = classes.map(c => c.name?.toLowerCase()).filter(Boolean);

		// Filter for class features - be lenient for compatibility with old saves
		// Old saves may have features without explicit featureType markers
		const features = allFeatures.filter(f => {
			// Explicitly marked as Class feature
			if (f.featureType === "Class") return true;
			// Optional Features (invocations, metamagic, etc.) are displayed with class features
			if (f.featureType === "Optional Feature") return true;
			// Has className property (primary indicator of a class feature)
			if (f.className) return true;
			// Has classSource property
			if (f.classSource) return true;
			// Has a level property (class features have levels, racial/background don't)
			if (f.level && typeof f.level === "number") return true;
			// Exclude features explicitly marked as other types
			if (f.featureType === "Race" || f.featureType === "Background" || f.featureType === "Feat") return false;
			// For old saves without markers: if we have classes but this feature isn't marked as race/background,
			// and there are no race/background features with this name, treat it as a class feature
			if (classes.length > 0 && !f.featureType) {
				// Check if this might be a known class feature by source containing class name
				if (f.source) {
					const sourceLower = f.source.toLowerCase();
					if (classNames.some(cn => sourceLower.includes(cn))) return true;
				}
				// Default: include unmarked features when character has classes
				// This handles old saves where features weren't typed
				return true;
			}
			return false;
		});

		if (!classes.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">Select a class to see features</div>`}));
			return;
		}

		if (!features.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">No class features yet</div>`}));
			return;
		}

		// Separate regular class features from optional features (invocations, metamagic, etc.)
		const regularFeatures = features.filter(f => f.featureType !== "Optional Feature");
		const optionalFeatures = features.filter(f => f.featureType === "Optional Feature");

		// Separate feature options (like Specialties) from standalone features
		const standaloneFeatures = regularFeatures.filter(f => !f.parentFeature);
		const featureOptions = regularFeatures.filter(f => f.parentFeature);

		// Render standalone class features
		standaloneFeatures.forEach(feature => {
			const featureEl = this._renderFeature(feature);
			container.append(featureEl);
		});

		// Group and render feature options by parentFeature
		if (featureOptions.length > 0) {
			const featureOptionGroups = {};
			featureOptions.forEach(f => {
				const groupKey = f.parentFeature;
				if (!featureOptionGroups[groupKey]) {
					featureOptionGroups[groupKey] = {name: groupKey, features: []};
				}
				featureOptionGroups[groupKey].features.push(f);
			});

			// Render each group
			Object.values(featureOptionGroups).forEach(group => {
				const groupContainer = e_({outer: `
					<div class="charsheet__feature-group mb-3">
						<div class="charsheet__feature-group-header">
							<span class="glyphicon glyphicon-list-alt"></span> ${group.name}
							<span class="badge badge-info">${group.features.length}</span>
						</div>
						<div class="charsheet__feature-group-body"></div>
					</div>
				`});
				const groupBody = groupContainer.querySelector(".charsheet__feature-group-body");

				group.features.forEach(feature => {
					const featureEl = this._renderFeature(feature);
					groupBody.append(featureEl);
				});

				container.append(groupContainer);
			});
		}

		// Group and render optional features by type
		if (optionalFeatures.length > 0) {
			this._renderTgttMetamagicSummary(container, optionalFeatures);

			// Group by optional feature types
			const optFeatureGroups = {};
			optionalFeatures.forEach(f => {
				// Get the group key and name from optionalFeatureTypes
				// For combat methods, use the tradition code as the key (so all AM methods group together)
				let groupKey = f.optionalFeatureTypes?.join("_") || "other";

				// Check if this is a combat method - if so, group by tradition
				const types = f.optionalFeatureTypes || [];
				for (const ft of types) {
					// Match CTM:1AM, CTM:2RC, etc. - extract tradition code
					const ctmMatch = ft.match(/^CTM:\d([A-Z]{2,3})$/);
					if (ctmMatch) {
						groupKey = `CTM:${ctmMatch[1]}`; // Normalize to just "CTM:AM", "CTM:RC", etc.
						break;
					}
					// Also match CTM:AM (tradition-only type)
					const ctmTradMatch = ft.match(/^CTM:([A-Z]{2,3})$/);
					if (ctmTradMatch && !ft.match(/^CTM:\d/)) {
						groupKey = `CTM:${ctmTradMatch[1]}`;
						break;
					}
				}

				const groupName = this._getOptionalFeatureGroupName(f.optionalFeatureTypes);
				if (!optFeatureGroups[groupKey]) {
					optFeatureGroups[groupKey] = {name: groupName, features: []};
				}
				optFeatureGroups[groupKey].features.push(f);
			});

			// Render each group
			Object.values(optFeatureGroups).forEach(group => {
				const groupContainer = e_({outer: `
					<div class="charsheet__feature-group mb-3">
						<div class="charsheet__feature-group-header">
							<span class="glyphicon glyphicon-list-alt"></span> ${group.name}
							<span class="badge badge-info">${group.features.length}</span>
						</div>
						<div class="charsheet__feature-group-body"></div>
					</div>
				`});
				const groupBody = groupContainer.querySelector(".charsheet__feature-group-body");

				group.features.forEach(feature => {
					const featureEl = this._renderFeature(feature);
					groupBody.append(featureEl);
				});

				container.append(groupContainer);
			});
		}
	}

	_renderTgttMetamagicSummary (container, optionalFeatures) {
		const metamagicFeatures = optionalFeatures.filter(feature =>
			(feature.optionalFeatureTypes || []).includes("MM"),
		);
		if (!metamagicFeatures.length) return;

		const knownKeys = new Set(this._state.getKnownMetamagicKeys?.() || []);
		if (!knownKeys.size) return;

		const passiveMetamagics = (this._state.getPassiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));
		const activeMetamagics = (this._state.getActiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));
		const lockedPoints = this._state.getLockedSorceryPoints?.() || 0;
		const effectiveMax = this._state.getEffectiveSorceryPointMax?.() ?? 0;

		const renderCost = (cost) => {
			if (cost === "level") return "spell level";
			if (cost === "halfLevel") return "half spell level";
			return `${cost} SP`;
		};

		const renderList = (items, formatter) => {
			if (!items.length) return `<div class="ve-muted ve-small">None selected yet.</div>`;
			return `
				<div class="ve-flex-col" style="gap: 6px;">
					${items.map(formatter).join("")}
				</div>
			`;
		};

		const passiveHtml = renderList(passiveMetamagics, meta => {
			const canAfford = !meta.tuned && typeof meta.cost === "number" && effectiveMax >= meta.cost;
			const btnLabel = meta.tuned ? "Detune" : "Tune";
			const btnClass = meta.tuned ? "btn-outline-danger" : "btn-outline-success";
			const btnDisabled = !meta.tuned && !canAfford ? "disabled title=\"Not enough effective sorcery points\"" : "";
			return `
				<div class="ve-flex ve-flex-v-center ve-flex-wrap" style="gap: 6px;">
					<span class="bold">${meta.name}</span>
					<span class="ve-muted ve-small">Locks ${renderCost(meta.cost)}</span>
					<button class="btn btn-xs ${btnClass} charsheet__metamagic-tune-btn" data-metamagic-key="${meta.key}" ${btnDisabled}>${btnLabel}</button>
					${meta.tuned ? `<span class="badge badge-success" style="margin-left: 2px;">Tuned</span>` : ""}
				</div>
			`;
		});

		const activeHtml = renderList(activeMetamagics, meta => `
			<div class="ve-flex ve-flex-v-center ve-flex-wrap" style="gap: 6px;">
				<span class="bold">${meta.name}</span>
				<span class="ve-muted ve-small">Cast-time cost: ${renderCost(meta.cost)}</span>
			</div>
		`);

		const summary = e_({outer: `
			<div class="charsheet__feature-group mb-3">
				<div class="charsheet__feature-group-header">
					<span class="glyphicon glyphicon-flash"></span> TGTT Metamagic
					<span class="badge badge-info">${metamagicFeatures.length}</span>
				</div>
				<div class="charsheet__feature-group-body">
					<div class="ve-flex ve-flex-wrap mb-2" style="gap: 12px;">
						<div><span class="bold">Locked Sorcery Points:</span> ${lockedPoints}</div>
						<div><span class="bold">Known Passive:</span> ${passiveMetamagics.length}</div>
						<div><span class="bold">Known Active:</span> ${activeMetamagics.length}</div>
					</div>
					<div class="mb-2">
						<div class="bold mb-1">Passive Loadout</div>
						${passiveHtml}
					</div>
					<div>
						<div class="bold mb-1">Active Cast-Time Options</div>
						${activeHtml}
					</div>
				</div>
			</div>
		`});

		summary.querySelectorAll(".charsheet__metamagic-tune-btn").forEach(btn => {
			btn.addEventListener("click", () => {
				const key = btn.dataset.metamagicKey;
				if (this._state.isMetamagicTuned?.(key)) {
					this._state.detuneMetamagic(key);
				} else {
					if (!this._state.tuneMetamagic(key)) {
						JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points to tune this metamagic."});
						return;
					}
				}
				this._page.saveCharacter?.();
				// Re-render this section
				summary.remove();
				this._renderTgttMetamagicSummary(container, optionalFeatures);
			});
		});

		container.append(summary);
	}

	_renderRaceFeatures () {
		const container = document.getElementById("charsheet-race-features");
		if (!container) return;

		container.innerHTML = "";

		// Include Species, Subrace, and legacy "Race" features
		const features = this._state.getFeatures().filter(f =>
			f.featureType === "Species"
			|| f.featureType === "Subrace"
			|| f.featureType === "Race",
		);
		const race = this._state.getRace();

		if (!race) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">Select a species to see traits</div>`}));
			return;
		}

		if (!features.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">No species traits yet</div>`}));
			return;
		}

		features.forEach(feature => {
			const featureEl = this._renderFeature(feature);
			container.append(featureEl);
		});
	}

	_renderBackgroundFeatures () {
		const container = document.getElementById("charsheet-background-features");
		if (!container) return;

		container.innerHTML = "";

		const features = this._state.getFeatures().filter(f => f.featureType === "Background");
		const background = this._state.getBackground();

		if (!background) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">Select a background to see feature</div>`}));
			return;
		}

		if (!features.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">No background feature yet</div>`}));
			return;
		}

		features.forEach(feature => {
			const featureEl = this._renderFeature(feature);
			container.append(featureEl);
		});
	}

	_renderFeaturesSummary () {
		const container = document.getElementById("charsheet-features-summary");
		if (!container) return;

		container.innerHTML = "";

		const features = this._state.getFeatures();
		const classes = this._state.getClasses();
		const race = this._state.getRace();

		if (!classes.length && !race) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">Build your character to see features</div>`}));
			return;
		}

		if (!features.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">No features yet</div>`}));
			return;
		}

		// Render calculated class statistics (Sneak Attack, Ki DC, etc.) at the top
		this._renderCalculatedStats(container);

		// Helper to create feature link - always display feature name
		const getFeatureHtml = (feature) => {
			let featureNameHtml = feature.name;
			if (this._page?.getHoverLink) {
				try {
					// Species/Race features link to races page - but SHOW THE FEATURE NAME
					if (feature.featureType === "Species" || feature.featureType === "Race" || feature.featureType === "Subrace") {
						const race = this._state.getRace();
						if (race) {
							// Create link that shows feature name but hovers/links to race
							const raceHash = UrlUtil.encodeForHash([race.name, race.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
							const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_RACES, source: race.source || Parser.SRC_XPHB, hash: raceHash});
							featureNameHtml = `<a href="${UrlUtil.PG_RACES}#${raceHash}" ${hoverAttrs}>${feature.name}</a>`;
						}
					// Class/Subclass features
					} else if (feature.source && feature.className) {
						// Determine the actual classSource for hover links
						// Priority: 1. feature.classSource (if valid), 2. feature.source if it's a class source, 3. storedClass.source, 4. fallback
						const storedClass = this._state.getClasses().find(c => c.name?.toLowerCase() === feature.className?.toLowerCase());

						// Check if feature.source looks like a class source (official sources like PHB, XPHB)
						// This handles existing characters where classSource wasn't stored correctly
						const officialClassSources = [Parser.SRC_PHB, Parser.SRC_XPHB, "PHB", "XPHB", "TCE", "XGE"];
						const isOfficialSource = (src) => officialClassSources.includes(src?.toUpperCase?.() || src);

						let actualClassSource = feature.classSource;
						let actualFeatureSource = feature.source;
						// If classSource is not set or is a homebrew source but feature.source is official, use feature.source
						if (!actualClassSource || (!isOfficialSource(actualClassSource) && isOfficialSource(feature.source))) {
							actualClassSource = feature.source;
						}
						// Final fallback to stored class or XPHB
						if (!actualClassSource) {
							actualClassSource = storedClass?.source || Parser.SRC_XPHB;
						}
						// For homebrew classes referencing official features (e.g. TGTT Warlock using XPHB Magical Cunning):
						// if the resolved source is still non-official, look up the feature in loaded class data
						if (!isOfficialSource(actualClassSource) && this._page?.getClassFeatures) {
							try {
								const classFeatures = this._page.getClassFeatures();
								const officialMatch = classFeatures?.find(f =>
									f.name === feature.name
									&& f.className === feature.className
									&& f.level === (feature.level || 1)
									&& isOfficialSource(f.source),
								);
								if (officialMatch) {
									actualClassSource = officialMatch.classSource || officialMatch.source;
									actualFeatureSource = officialMatch.source;
								}
							} catch (e) { /* fall through */ }
						}

						const hashInput = {
							name: feature.name,
							className: feature.className,
							classSource: actualClassSource,
							level: feature.level || 1,
							source: actualFeatureSource,
						};
						if (feature.subclassName) {
							hashInput.subclassShortName = feature.subclassShortName || feature.subclassName;
							hashInput.subclassSource = feature.subclassSource || storedClass?.subclass?.source || feature.source;
						}
						const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES](hashInput);
						featureNameHtml = this._page.getHoverLink(
							UrlUtil.PG_CLASS_SUBCLASS_FEATURES,
							feature.name,
							actualFeatureSource,
							hash,
						);
					// Background features - show feature name but link to background
					} else if (feature.featureType === "Background") {
						const background = this._state.getBackground();
						// Only create hover link for non-custom backgrounds
						if (background && background.source !== "Custom") {
							const bgHash = UrlUtil.encodeForHash([background.name, background.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
							const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BACKGROUNDS, source: background.source || Parser.SRC_XPHB, hash: bgHash});
							featureNameHtml = `<a href="${UrlUtil.PG_BACKGROUNDS}#${bgHash}" ${hoverAttrs}>${feature.name}</a>`;
						}
					}
				} catch (e) {
					// Fall back to plain name
				}
			}
			return featureNameHtml;
		};

		// Define important features - features with limited uses, or key combat/exploration features
		const importantKeywords = [
			"darkvision", "resistance", "advantage", "immunity", "bonus action",
			"reaction", "rage", "sneak attack", "divine sense", "lay on hands",
			"channel divinity", "wild shape", "action surge", "second wind",
			"bardic inspiration", "cunning action", "uncanny dodge", "evasion",
			"metamagic", "sorcery points", "ki", "smite", "spellcasting",
			"fighting style", "extra attack", "eldritch invocation",
			"charge", "aggressive", "natural weapon", "unarmed strike",
			"breath weapon", "fey ancestry", "relentless endurance",
		];

		// Patterns that indicate activatable abilities (action economy)
		const activatablePatterns = [
			/\bas an action\b/i,
			/\buse your action\b/i,
			/\btake the .* action\b/i,
			/\bas a bonus action\b/i,
			/\buse a bonus action\b/i,
			/\bas a reaction\b/i,
			/\buse your reaction\b/i,
			/\bwhen you .* you can\b/i,
			/\bonce per .* rest\b/i,
			/\bonce on each of your turns\b/i,
			/\byou can use this .* a number of times\b/i,
		];

		const isImportantFeature = (feature) => {
			// Exclude features classified as passive — they are not user-activatable
			const nameLowerCheck = feature.name?.toLowerCase() || "";
			const classification = CharacterSheetState?.FEATURE_CLASSIFICATION_OVERRIDES?.[nameLowerCheck];
			if (classification === "passive") return false;

			// Features with limited uses are important
			if (feature.uses && feature.uses.max > 0) return true;
			// Explicitly marked important
			if (feature.important) return true;
			// Key features by name OR description
			const nameLower = feature.name?.toLowerCase() || "";
			const descLower = feature.description?.toLowerCase() || "";

			// Check keyword matches
			if (importantKeywords.some(keyword =>
				nameLower.includes(keyword) || descLower.includes(keyword),
			)) return true;

			// Check activatable patterns (features that require actions/reactions)
			if (activatablePatterns.some(pattern => pattern.test(descLower))) return true;

			return false;
		};

		// Get important features grouped by type
		const importantFeatures = features.filter(isImportantFeature);

		// Group by feature type
		const byType = {
			"Class": [],
			"Species": [],
			"Subrace": [],
			"Background": [],
			"Other": [],
		};

		importantFeatures.forEach(f => {
			const type = f.featureType || "Other";
			if (byType[type]) {
				byType[type].push(f);
			} else {
				byType.Other.push(f);
			}
		});

		let hasContent = false;

		// Render Class features first (most relevant for gameplay)
		if (byType.Class.length) {
			hasContent = true;
			container.append(e_({outer: `<div class="ve-small ve-muted mb-1"><strong>Class</strong></div>`}));
			byType.Class.slice(0, 5).forEach(feature => {
				const usesStr = feature.uses ? ` <span class="ve-muted">(${feature.uses.current}/${feature.uses.max})</span>` : "";
				container.append(e_({outer: `<div class="charsheet__feature-summary-item">${getFeatureHtml(feature)}${usesStr}</div>`}));
			});
			if (byType.Class.length > 5) {
				container.append(e_({outer: `<div class="ve-muted ve-small charsheet__feature-summary-more" data-feature-type="Class">+${byType.Class.length - 5} more class features</div>`}));
			}
		}

		// Then Species/Race features
		const speciesFeatures = [...byType.Species, ...byType.Subrace];
		if (speciesFeatures.length) {
			hasContent = true;
			container.append(e_({outer: `<div class="ve-small ve-muted mb-1 ${byType.Class.length ? "mt-2" : ""}"><strong>Species</strong></div>`}));
			speciesFeatures.slice(0, 3).forEach(feature => {
				container.append(e_({outer: `<div class="charsheet__feature-summary-item">${getFeatureHtml(feature)}</div>`}));
			});
			if (speciesFeatures.length > 3) {
				container.append(e_({outer: `<div class="ve-muted ve-small charsheet__feature-summary-more" data-feature-type="Species">+${speciesFeatures.length - 3} more species features</div>`}));
			}
		}

		// Background features
		if (byType.Background.length) {
			hasContent = true;
			container.append(e_({outer: `<div class="ve-small ve-muted mb-1 mt-2"><strong>Background</strong></div>`}));
			byType.Background.slice(0, 2).forEach(feature => {
				container.append(e_({outer: `<div class="charsheet__feature-summary-item">${getFeatureHtml(feature)}</div>`}));
			});
		}

		// Fallback if no important features found
		if (!hasContent) {
			// Show a representative sample from each type
			const classFeatures = features.filter(f => f.featureType === "Class").slice(0, 3);
			const raceFeatures = features.filter(f => f.featureType === "Species" || f.featureType === "Subrace").slice(0, 2);

			[...classFeatures, ...raceFeatures].forEach(feature => {
				container.append(e_({outer: `<div class="charsheet__feature-summary-item">${getFeatureHtml(feature)}</div>`}));
			});

			if (features.length > 5) {
				container.append(e_({outer: `<div class="ve-muted ve-small text-center">View all ${features.length} features in Features tab</div>`}));
			}
		}
	}

	/**
	 * Render calculated class statistics (Sneak Attack dice, Ki Save DC, etc.)
	 */
	_renderCalculatedStats (container) {
		const calculations = this._state.getFeatureCalculations();
		if (!calculations || Object.keys(calculations).length === 0) return;

		const stats = [];

		// Format each calculation for display
		if (calculations.sneakAttack) {
			stats.push({
				label: "Sneak Attack",
				value: calculations.sneakAttack.dice,
				title: `Average damage: ${calculations.sneakAttack.avgDamage}`,
			});
		}

		if (calculations.kiSaveDc) {
			stats.push({
				label: "Ki Save DC",
				value: calculations.kiSaveDc,
				title: "8 + Proficiency + Wisdom modifier",
			});
		}

		if (calculations.focusSaveDc) {
			stats.push({
				label: "Focus Save DC",
				value: calculations.focusSaveDc,
				title: "8 + Proficiency + Dexterity or Wisdom modifier (highest)",
			});
		}

		if (calculations.martialArtsDie) {
			stats.push({
				label: "Martial Arts",
				value: calculations.martialArtsDie,
				title: "Unarmed strike damage die",
			});
		}

		if (calculations.rageDamage) {
			stats.push({
				label: "Rage Damage",
				value: `+${calculations.rageDamage}`,
				title: "Bonus damage while raging",
			});
		}

		if (calculations.brutalCritical) {
			stats.push({
				label: "Brutal Critical",
				value: `+${calculations.brutalCritical}d`,
				title: "Extra weapon dice on critical hits",
			});
		}

		if (calculations.auraRange) {
			stats.push({
				label: "Aura Range",
				value: `${calculations.auraRange} ft`,
				title: "Range of paladin auras",
			});
		}

		if (calculations.superiorityDie) {
			stats.push({
				label: "Superiority Die",
				value: calculations.superiorityDie,
				title: "Battle Master maneuver die",
			});
		}

		if (calculations.maneuverSaveDc) {
			stats.push({
				label: "Maneuver DC",
				value: calculations.maneuverSaveDc,
				title: "8 + Proficiency + Strength or Dexterity modifier (your choice)",
			});
		}

		if (calculations.bardicInspirationDie) {
			stats.push({
				label: "Bardic Inspiration",
				value: calculations.bardicInspirationDie,
				title: "Bardic Inspiration die",
			});
		}

		if (calculations.eldritchBlastBeams) {
			stats.push({
				label: "Eldritch Blast",
				value: `${calculations.eldritchBlastBeams} beam${calculations.eldritchBlastBeams > 1 ? "s" : ""}`,
				title: "Number of Eldritch Blast beams",
			});
		}

		if (calculations.channelDivinityDc) {
			stats.push({
				label: "Channel Divinity DC",
				value: calculations.channelDivinityDc,
				title: "8 + Proficiency + Wisdom or Charisma modifier",
			});
		}

		if (calculations.wildShapeDc) {
			stats.push({
				label: "Wild Shape DC",
				value: calculations.wildShapeDc,
				title: "8 + Proficiency + Wisdom modifier",
			});
		}

		if (calculations.favoredFoeDamage) {
			stats.push({
				label: "Favored Foe",
				value: calculations.favoredFoeDamage,
				title: "Extra damage against marked creature",
			});
		}

		if (calculations.combatMethodDc) {
			stats.push({
				label: "Combat Method DC",
				value: calculations.combatMethodDc,
				title: "8 + Proficiency + Strength or Dexterity modifier",
			});
		}

		// Only render if we have stats to show
		if (stats.length === 0) return;

		const statsContainer = e_({tag: "div", clazz: "charsheet__calculated-stats mb-2"});
		statsContainer.append(e_({outer: `<div class="ve-small ve-muted mb-1"><strong>Class Statistics</strong></div>`}));

		const statsGrid = e_({tag: "div", clazz: "charsheet__stats-grid"});
		stats.forEach(stat => {
			statsGrid.append(e_({outer: `
				<div class="charsheet__stat-item" title="${stat.title}">
					<span class="charsheet__calc-stat-label">${stat.label}:</span>
					<span class="charsheet__calc-stat-value">${stat.value}</span>
				</div>
			`}));
		});

		statsContainer.append(statsGrid);
		container.append(statsContainer);
	}

	/**
	 * Get a human-readable name for optional feature types
	 */
	_getOptionalFeatureGroupName (featureTypes) {
		if (!featureTypes?.length) return "Other Features";

		// Map of feature type codes to human-readable names
		const typeNames = {
			"EI": "Eldritch Invocations",
			"MM": "Metamagic Options",
			"MV:B": "Battle Master Maneuvers",
			"MV:C2-UA": "Cavalier Maneuvers",
			"AS:V1-UA": "Arcane Shot Options",
			"AS:V2-UA": "Arcane Shot Options",
			"AS": "Arcane Shot Options",
			"OTH": "Other Options",
			"ED": "Elemental Disciplines",
			"PB": "Pact Boons",
			"AI": "Artificer Infusions",
			"FS:F": "Fighter Fighting Styles",
			"FS:P": "Paladin Fighting Styles",
			"FS:R": "Ranger Fighting Styles",
			"FS:B": "Bard Fighting Styles",
			"RN": "Rune Knight Runes",
			"AF": "Alchemist Formulas",
			"DW:C": "Dreamwalker Core Abilities",
			"DW:S": "Dreamwalker Special Abilities",
		};

		// Combat tradition names (Thelemar homebrew)
		const traditionNames = {
			"AM": "Adamant Mountain",
			"AK": "Arcane Knight",
			"BU": "Beast Unity",
			"BZ": "Biting Zephyr",
			"CJ": "Comedic Jabs",
			"EB": "Eldritch Blackguard",
			"GH": "Gallant Heart",
			"MG": "Mirror's Glint",
			"MS": "Mist and Shade",
			"RC": "Rapid Current",
			"RE": "Razor's Edge",
			"SK": "Sanguine Knot",
			"SS": "Spirited Steed",
			"TI": "Tempered Iron",
			"TC": "Tooth and Claw",
			"UW": "Unending Wheel",
			"UH": "Unerring Hawk",
		};

		// Check for Combat Methods (CTM:X patterns) - group by tradition
		for (const ft of featureTypes) {
			const ctmMatch = ft.match(/^CTM:\d([A-Z]{2})$/);
			if (ctmMatch) {
				const tradCode = ctmMatch[1];
				const tradName = traditionNames[tradCode] || tradCode;
				return `Combat Methods: ${tradName}`;
			}
		}

		// Try to find a matching name
		for (const ft of featureTypes) {
			if (typeNames[ft]) return typeNames[ft];
		}

		// Fall back to the raw type names
		return featureTypes.map(ft => ft.replace(/:/g, " ")).join(", ");
	}

	_renderFeature (feature) {
		const isExpanded = this._expandedFeatures.has(feature.id);
		const hasUses = feature.uses && feature.uses.max > 0;

		let featureNameHtml = feature.name;
		if (this._page?.getHoverLink) {
			try {
				// Class/Subclass features - link to the actual class feature page
				if (feature.featureType === "Class" && feature.className) {
					// Determine the actual classSource for hover links
					// Priority: 1. feature.classSource (if valid), 2. feature.source if it's a class source, 3. storedClass.source, 4. fallback
					const storedClass = this._state.getClasses().find(c => c.name?.toLowerCase() === feature.className?.toLowerCase());

					// Check if feature.source looks like a class source (official sources like PHB, XPHB)
					// This handles existing characters where classSource wasn't stored correctly
					const officialClassSources = [Parser.SRC_PHB, Parser.SRC_XPHB, "PHB", "XPHB", "TCE", "XGE"];
					const isOfficialSource = (src) => officialClassSources.includes(src?.toUpperCase?.() || src);

					let actualClassSource = feature.classSource;
					let actualFeatureSource = feature.source || Parser.SRC_XPHB;
					// If classSource is not set or is a homebrew source but feature.source is official, use feature.source
					if (!actualClassSource || (!isOfficialSource(actualClassSource) && isOfficialSource(feature.source))) {
						actualClassSource = feature.source || Parser.SRC_XPHB;
					}
					// Final fallback to stored class or XPHB
					if (!actualClassSource) {
						actualClassSource = storedClass?.source || Parser.SRC_XPHB;
					}
					// For homebrew classes referencing official features (e.g. TGTT Warlock using XPHB Magical Cunning):
					// if the resolved source is still non-official, look up the feature in loaded class data
					if (!isOfficialSource(actualClassSource) && this._page?.getClassFeatures) {
						try {
							const classFeatures = this._page.getClassFeatures();
							const officialMatch = classFeatures?.find(f =>
								f.name === feature.name
								&& f.className === feature.className
								&& f.level === (feature.level || 1)
								&& isOfficialSource(f.source),
							);
							if (officialMatch) {
								actualClassSource = officialMatch.classSource || officialMatch.source;
								actualFeatureSource = officialMatch.source;
							}
						} catch (e) { /* fall through */ }
					}

					const hashInput = {
						name: feature.name,
						className: feature.className,
						classSource: actualClassSource,
						level: feature.level || 1,
						source: actualFeatureSource,
					};
					if (feature.subclassName || feature.isSubclassFeature) {
						hashInput.subclassShortName = feature.subclassShortName || feature.subclassName;
						hashInput.subclassSource = feature.subclassSource || storedClass?.subclass?.source || feature.source || Parser.SRC_XPHB;
					}
					const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES](hashInput);
					featureNameHtml = this._page.getHoverLink(
						UrlUtil.PG_CLASS_SUBCLASS_FEATURES,
						feature.name,
						actualFeatureSource,
						hash,
					);
				// Species/Race features - link to races page with hover
				} else if (feature.featureType === "Species" || feature.featureType === "Race" || feature.featureType === "Subrace") {
					const race = this._state.getRace();
					if (race) {
						// Use getHoverLink but display the feature name
						const raceHash = UrlUtil.encodeForHash([race.name, race.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_RACES, source: race.source || Parser.SRC_XPHB, hash: raceHash});
						featureNameHtml = `<a href="${UrlUtil.PG_RACES}#${raceHash}" ${hoverAttrs}>${feature.name}</a>`;
					}
				// Background features - link to background page with hover
				} else if (feature.featureType === "Background") {
					const background = this._state.getBackground();
					// Only create hover link for non-custom backgrounds
					if (background && background.source !== "Custom") {
						const bgHash = UrlUtil.encodeForHash([background.name, background.source || Parser.SRC_XPHB].join(HASH_LIST_SEP));
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BACKGROUNDS, source: background.source || Parser.SRC_XPHB, hash: bgHash});
						featureNameHtml = `<a href="${UrlUtil.PG_BACKGROUNDS}#${bgHash}" ${hoverAttrs}>${feature.name}</a>`;
					}
				// Optional features (invocations, etc.) - link to optional features page with hover
				} else if (feature.featureType === "Optional Feature") {
					featureNameHtml = this._page.getHoverLink(
						UrlUtil.PG_OPT_FEATURES,
						feature.name,
						feature.source || Parser.SRC_XPHB,
					);
				}
			} catch (e) {
				console.error("[CharSheet Features] Error creating feature link:", e);
				featureNameHtml = feature.name;
			}
		}

		// Get description - look it up if not stored
		const description = this._getFeatureDescription(feature) || "<em class='ve-muted'>No description available</em>";

		// Check if this is the Primal Focus feature (TGTT Ranger)
		const isPrimalFocus = feature.name === "Primal Focus" && feature.classSource === "TGTT";
		let primalFocusHtml = "";
		if (isPrimalFocus && this._state.hasPrimalFocus?.()) {
			const currentMode = this._state.getPrimalFocusMode?.() || "predator";
			const switchesRemaining = this._state.getFocusSwitchesRemaining?.() || 0;
			const switchText = typeof switchesRemaining === "string" ? switchesRemaining : `${switchesRemaining} remaining`;

			primalFocusHtml = `
				<div class="charsheet__primal-focus-controls mt-2 p-2" style="background: var(--bs-body-bg-alt, #f8f9fa); border-radius: 8px; border: 1px solid var(--bs-border-color, #dee2e6);">
					<div class="ve-flex-v-center gap-2 mb-2">
						<strong>Current Focus:</strong>
						<span class="badge ${currentMode === "predator" ? "badge-danger" : "badge-info"}" style="font-size: 1em; padding: 5px 10px;">
							${currentMode === "predator" ? "🎯 Predator" : "🛡️ Prey"}
						</span>
					</div>
					<div class="ve-flex-v-center gap-2 mb-2">
						<em class="ve-muted">Focus Switches: ${switchText}</em>
					</div>
					<div class="ve-flex gap-2">
						<button class="ve-btn ve-btn-sm ${currentMode === "predator" ? "ve-btn-danger" : "ve-btn-outline-danger"} charsheet__primal-focus-btn" data-mode="predator" ${currentMode === "predator" ? "disabled" : ""}>
							🎯 Predator
						</button>
						<button class="ve-btn ve-btn-sm ${currentMode === "prey" ? "ve-btn-info" : "ve-btn-outline-info"} charsheet__primal-focus-btn" data-mode="prey" ${currentMode === "prey" ? "disabled" : ""}>
							🛡️ Prey
						</button>
					</div>
				</div>
			`;
		}

		const featureEl = e_({outer: `
			<div class="charsheet__feature" data-feature-id="${feature.id}">
				<div class="charsheet__feature-header">
					<span class="charsheet__feature-toggle glyphicon ${isExpanded ? "glyphicon-chevron-down" : "glyphicon-chevron-right"}"></span>
					<span class="charsheet__feature-name">${featureNameHtml}</span>
					${feature.level ? `<span class="badge badge-secondary">Lvl ${feature.level}</span>` : ""}
					${hasUses ? `<span class="badge badge-info">${feature.uses.current}/${feature.uses.max}</span>` : ""}
					${isPrimalFocus && this._state.hasPrimalFocus?.() ? `<span class="badge ${this._state.getPrimalFocusMode?.() === "predator" ? "badge-danger" : "badge-info"}">${this._state.getPrimalFocusMode?.() === "predator" ? "🎯" : "🛡️"} ${(this._state.getPrimalFocusMode?.() || "predator").toTitleCase()}</span>` : ""}
					<div class="charsheet__feature-actions">
						${hasUses ? `<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__feature-use" title="Use Feature">Use</button>` : ""}
						<button class="ve-btn ve-btn-xs ${this._state.getFeatureNote?.(feature.id) ? "ve-btn-warning" : "ve-btn-default"} charsheet__feature-note" title="${this._state.getFeatureNote?.(feature.id) ? "Edit Note" : "Add Note"}">
							<span class="glyphicon glyphicon-comment"></span>
						</button>
						<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__feature-remove" title="Remove">
							<span class="glyphicon glyphicon-trash"></span>
						</button>
					</div>
				</div>
				<div class="charsheet__feature-body" style="display: ${isExpanded ? "block" : "none"};">
					${primalFocusHtml}
					${description}
				</div>
			</div>
		`});

		// Add Primal Focus switch button handlers
		if (isPrimalFocus) {
			featureEl.querySelectorAll(".charsheet__primal-focus-btn").forEach(btn => {
				btn.addEventListener("click", () => {
					const targetMode = btn.dataset.mode;
					const currentMode = this._state.getPrimalFocusMode?.();

					if (targetMode === currentMode) return;

					// Try to switch
					const success = this._state.switchPrimalFocus?.();
					if (success) {
						// Re-render features to update UI
						this._page._features?.render?.();
						JqueryUtil.doToast({type: "success", content: `Switched to ${targetMode.toTitleCase()} Focus`});
					} else {
						JqueryUtil.doToast({type: "warning", content: "No focus switches remaining! Rest to regain switches."});
					}
				});
			});
		}

		return featureEl;
	}

	_renderFeats () {
		const container = document.getElementById("charsheet-feats") || document.getElementById("charsheet-feats-list");
		if (!container) return;

		container.innerHTML = "";

		const feats = this._state.getFeats();

		if (!feats.length) {
			container.append(e_({outer: `<div class="ve-muted ve-text-center py-2">No feats selected</div>`}));
			return;
		}

		feats.forEach(feat => {
			const isExpanded = this._expandedFeatures.has(`feat-${feat.id}`);

			// Create hover link for feat name
			let featNameHtml = feat.name;
			if (this._page?.getHoverLink && feat.source) {
				try {
					featNameHtml = this._page.getHoverLink(UrlUtil.PG_FEATS, feat.name, feat.source);
				} catch (e) {
					// Fall back to plain name
				}
			}

			// Get description - look it up if not stored
			const description = feat.description || this._getFeatDescription(feat) || "<em class='ve-muted'>No description available</em>";

			const featEl = e_({outer: `
				<div class="charsheet__feat charsheet__feature" data-feat-id="${feat.id}">
					<div class="charsheet__feat-header charsheet__feature-header">
						<span class="charsheet__feature-toggle glyphicon ${isExpanded ? "glyphicon-chevron-down" : "glyphicon-chevron-right"}"></span>
						<span class="charsheet__feat-name charsheet__feature-name">${featNameHtml}</span>
						<div class="charsheet__feature-actions">
							<button class="ve-btn ve-btn-xs ${this._state.getFeatNote?.(feat.id) ? "ve-btn-warning" : "ve-btn-default"} charsheet__feat-note" title="${this._state.getFeatNote?.(feat.id) ? "Edit Note" : "Add Note"}">
								<span class="glyphicon glyphicon-comment"></span>
							</button>
							<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__feat-remove" data-feat-id="${feat.id}">
								<span class="glyphicon glyphicon-trash"></span>
							</button>
						</div>
					</div>
					<div class="charsheet__feat-body charsheet__feature-body" style="display: ${isExpanded ? "block" : "none"};">
						${description}
					</div>
				</div>
			`});

			// Toggle expansion
			featEl.querySelector(".charsheet__feature-toggle").addEventListener("click", (e) => {
				e.stopPropagation();
				const featKey = `feat-${feat.id}`;
				const isCurrentlyExpanded = this._expandedFeatures.has(featKey);
				if (isCurrentlyExpanded) {
					this._expandedFeatures.delete(featKey);
				} else {
					this._expandedFeatures.add(featKey);
				}
				this.render();
			});

			featEl.querySelector(".charsheet__feat-remove").addEventListener("click", (e) => {
				e.stopPropagation();
				this._state.removeFeat(feat.id);
				this.render();
				this._page.saveCharacter();
			});

			container.append(featEl);
		});
	}

	_renderResources () {
		const container = document.getElementById("charsheet-resources-list");
		if (!container) return;

		container.innerHTML = "";

		const resources = this._state.getResources();

		// Check if character uses the combat methods system (has traditions or methods)
		const usesCombatSystem = this._state.usesCombatSystem?.() || false;

		if (usesCombatSystem) {
			// Ensure stamina is initialized (use public method)
			if (typeof this._state.ensureStaminaInitialized === "function") {
				this._state.ensureStaminaInitialized();
			}

			const staminaMax = this._state.getStaminaMax() || 0;
			const staminaCurrent = this._state.getStaminaCurrent() ?? staminaMax;

			if (staminaMax > 0) {
				const stamina = e_({outer: `
					<div class="charsheet__resource-row" data-resource-id="stamina">
						<span class="charsheet__resource-name">Stamina</span>
						<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(Short)</span>
						<div class="charsheet__resource-uses ml-auto">
							<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__stamina-use-btn" ${staminaCurrent <= 0 ? "disabled" : ""}>Use</button>
							<span class="charsheet__resource-current">${staminaCurrent}</span>
							<span class="charsheet__resource-max">/ ${staminaMax}</span>
							<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__stamina-restore-btn" ${staminaCurrent >= staminaMax ? "disabled" : ""}>+</button>
						</div>
					</div>
				`});

				// Use button - decrease stamina by 1
				stamina.querySelector(".charsheet__stamina-use-btn").addEventListener("click", () => {
					const current = this._state.getStaminaCurrent() || 0;
					if (current > 0) {
						this._state.setStaminaCurrent(current - 1);
						this._renderResources();
						if (this._page?._combat) {
							this._page._combat._updateStaminaDisplay();
						}
					}
				});

				// Restore button - increase stamina by 1
				stamina.querySelector(".charsheet__stamina-restore-btn").addEventListener("click", () => {
					const current = this._state.getStaminaCurrent() || 0;
					const max = this._state.getStaminaMax() || 0;
					if (current < max) {
						this._state.setStaminaCurrent(current + 1);
						this._renderResources();
						if (this._page?._combat) {
							this._page._combat._updateStaminaDisplay();
						}
					}
				});

				container.append(stamina);
			}
		}

		if (!resources.length && !usesCombatSystem) {
			container.append(e_({outer: `<p class="ve-muted text-center">No class resources</p>`}));
			return;
		}

		resources.forEach(resource => {
			const row = e_({outer: `
				<div class="charsheet__resource-row" data-resource-id="${resource.id}">
					<span class="charsheet__resource-name">${resource.name}</span>
					<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(${resource.recharge === "short" ? "Short" : "Long"})</span>
					<div class="charsheet__resource-uses ml-auto">
						<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__resource-use-btn" ${resource.current <= 0 ? "disabled" : ""}>Use</button>
						<span class="charsheet__resource-current">${resource.current}</span>
						<span class="charsheet__resource-max">/ ${resource.max}</span>
						<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__resource-restore-btn" ${resource.current >= resource.max ? "disabled" : ""}>+</button>
					</div>
				</div>
			`});

			// Use button - decrease current by 1
			row.querySelector(".charsheet__resource-use-btn").addEventListener("click", () => {
				if (resource.current > 0) {
					this._state.setResourceCurrent(resource.id, resource.current - 1);
					this._renderResources();
				}
			});

			// Restore button - increase current by 1
			row.querySelector(".charsheet__resource-restore-btn").addEventListener("click", () => {
				if (resource.current < resource.max) {
					this._state.setResourceCurrent(resource.id, resource.current + 1);
					this._renderResources();
				}
			});

			container.append(row);
		});

		// Add limited-use custom abilities
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const limitedAbilities = customAbilities.filter(a => a.mode === "limited");
		
		limitedAbilities.forEach(ability => {
			// Get the uses display (handles both self-contained and linked resources)
			const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
			if (!uses) return;
			
			// Skip if this ability links to an existing resource pool (already shown above)
			if (ability.resourceSource?.type === "linked" && ability.resourceSource?.resourceId !== "stamina") {
				const linkedResource = resources.find(r => r.id === ability.resourceSource.resourceId);
				if (linkedResource) return;
			}
			
			const canUse = this._state.canUseCustomAbility?.(ability.id) ?? uses.current > 0;
			const canRestore = uses.current < uses.max;
			
			const row = e_({outer: `
				<div class="charsheet__resource-row charsheet__resource-row--custom" data-ability-id="${ability.id}">
					<span class="charsheet__resource-icon mr-1">${ability.icon || "⚡"}</span>
					<span class="charsheet__resource-name">${ability.name}</span>
					<span class="charsheet__resource-recharge ve-muted ve-small ml-2">(${uses.recharge === "short" ? "Short" : "Long"})</span>
					<div class="charsheet__resource-uses ml-auto">
						<button class="ve-btn ve-btn-xs ve-btn-danger mr-2 charsheet__ability-use-btn" ${!canUse ? "disabled" : ""}>Use</button>
						<span class="charsheet__resource-current">${uses.current}</span>
						<span class="charsheet__resource-max">/ ${uses.max}</span>
						<button class="ve-btn ve-btn-xs ve-btn-success ml-2 charsheet__ability-restore-btn" ${!canRestore ? "disabled" : ""}>+</button>
					</div>
				</div>
			`});

			row.querySelector(".charsheet__ability-use-btn").addEventListener("click", () => {
				if (this._state.useCustomAbility(ability.id)) {
					this._renderResources();
					if (this._page) {
						this._page._saveCurrentCharacter?.();
						this._page._renderResources?.();
						this._page._renderActiveStates?.();
						this._page._customAbilities?.render?.();
					}
				}
			});

			row.querySelector(".charsheet__ability-restore-btn").addEventListener("click", () => {
				if (this._state.restoreCustomAbilityUse(ability.id)) {
					this._renderResources();
					if (this._page) {
						this._page._saveCurrentCharacter?.();
						this._page._renderResources?.();
						this._page._renderActiveStates?.();
						this._page._customAbilities?.render?.();
					}
				}
			});

			container.append(row);
		});
	}

	_renderProficiencies () {
		// Armor
		const armorProfs = this._state.getArmorProficiencies();
		const armorEl = document.getElementById("charsheet-armor-proficiencies");
		if (armorEl) armorEl.textContent = armorProfs.length ? armorProfs.join(", ") : "None";

		// Weapons
		const weaponProfs = this._state.getWeaponProficiencies();
		const weaponEl = document.getElementById("charsheet-weapon-proficiencies");
		if (weaponEl) weaponEl.textContent = weaponProfs.length ? weaponProfs.join(", ") : "None";

		// Tools
		const toolProfs = this._state.getToolProficiencies();
		const toolEl = document.getElementById("charsheet-tool-proficiencies");
		if (toolEl) {
			if (toolProfs.length) {
				toolEl.innerHTML = this._renderToolProficiencies(toolProfs);
			} else {
				toolEl.textContent = "None";
			}
		}

		// Saving throws
		const saveProfs = this._state.getSaveProficiencies();
		const saveEl = document.getElementById("charsheet-save-proficiencies");
		if (saveEl) saveEl.textContent = saveProfs.length ? saveProfs.map(s => Parser.attAbvToFull(s)).join(", ") : "None";
	}

	/**
	 * Render tool proficiencies with hover links
	 */
	_renderToolProficiencies (tools) {
		return tools.map(tool => {
			// Try to create a hover link for the tool
			try {
				const toolLower = tool.toLowerCase();
				// Use {@item} tag format for proper rendering
				return Renderer.get().render(`{@item ${toolLower}}`);
			} catch (e) {
				// Fallback to plain text if hover fails
				return tool;
			}
		}).join(", ");
	}

	_renderInlineList (list) {
		return list.map(entry => {
			if (!entry) return "";
			const rendered = Renderer.get().render(entry);
			return rendered.replace(/^<p>|<\/p>$/g, "");
		}).filter(Boolean).join(", ");
	}

	_renderLanguages () {
		const languages = this._state.getLanguages();
		const langEl = document.getElementById("charsheet-languages");
		if (langEl) langEl.textContent = languages.length ? languages.join(", ") : "None";
	}
	// #endregion
}

globalThis.CharacterSheetFeatures = CharacterSheetFeatures;

export {CharacterSheetFeatures};
