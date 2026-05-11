/**
 * Character Sheet Level Up
 * Handles level up process including class features, ability score improvements, subclass selection
 */

// Project globals — destructured from globalThis so the TypeScript checkJs
// language service has typed names to reference. Zero runtime impact.
const {e_, ee, Parser, Renderer, JqueryUtil, UiUtil, InputUiUtil, MiscUtil, UrlUtil, CharacterSheetClassUtils} = /** @type {*} */ (globalThis);

class CharacterSheetLevelUp {
	/**
	 * @param {*} page
	 */
	constructor (page) {
		/** @type {*} */ this._page = page;
		/** @type {*} */ this._state = page.getState();
		/** @type {Object<string, *>} */ this._selectedFeatureSkillChoices = {};
		/** @type {*} */ this._selectedClass = null; // For specialty features that require skill/expertise choices
	}

	/**
	 * Show level up dialog for a specific class
	 * @param {?string} [className] - The class to level up (optional, prompts if multiple classes)
	 */
	async showLevelUp (className = null) {
		const classes = this._state.getClasses();

		if (!classes.length) {
			JqueryUtil.doToast({type: "warning", content: "Create a character first before leveling up."});
			return;
		}

		// If character has multiple classes and no class specified, prompt to choose
		let targetClass = null;
		if (className) {
			targetClass = classes.find((/** @type {*} */ c) => c.name === className);
		} else if (classes.length === 1) {
			targetClass = classes[0];
		} else {
			// Prompt user to select which class to level
			const classChoice = await InputUiUtil.pGetUserEnum({
				title: "Level Up",
				fnDisplay: (/** @type {*} */ c) => `${c.name} (Level ${c.level})`,
				values: classes,
				isResolveItem: true,
			});
			if (!classChoice) return;
			targetClass = classChoice;
		}

		if (!targetClass) {
			JqueryUtil.doToast({type: "warning", content: "Class not found."});
			return;
		}

		await this._doLevelUp(targetClass);
	}

	/** @param {*} classEntry */

	async _doLevelUp (/** @type {*} */ classEntry) {
		const classData = this._page.getClasses().find((/** @type {*} */ c) => c.name === classEntry.name && c.source === classEntry.source);
		if (!classData) {
			JqueryUtil.doToast({type: "danger", content: "Class data not found."});
			return;
		}

		const currentLevel = classEntry.level;
		const newLevel = currentLevel + 1;

		if (newLevel > 20) {
			JqueryUtil.doToast({type: "warning", content: "Maximum level (20) reached for this class."});
			return;
		}

		// Check total level cap
		const totalLevel = this._state.getTotalLevel();
		if (totalLevel >= 20) {
			JqueryUtil.doToast({type: "warning", content: "Character has reached maximum total level (20)."});
			return;
		}

		// Look up full subclass data if we have a saved subclass reference
		let fullSubclassData = null;
		if (classEntry.subclass && classData.subclasses) {
			fullSubclassData = classData.subclasses.find((/** @type {*} */ sc) =>
				sc.name === classEntry.subclass.name
				&& (sc.source === classEntry.subclass.source || !classEntry.subclass.source),
			);
		}

		// Get features for the new level
		const newFeatures = CharacterSheetClassUtils.getLevelFeatures(classData, newLevel, fullSubclassData, this._page.getClassFeatures(), this._page.getSubclassFeatures());

		// Check if this level grants an ASI
		const hasAsi = CharacterSheetClassUtils.levelGrantsAsi(classData, newLevel);

		// Check if this level grants a subclass (usually level 3 for most classes)
		const needsSubclass = CharacterSheetClassUtils.levelGrantsSubclass(classData, newLevel) && !classEntry.subclass;

		// Build the level up modal
		await this._pShowLevelUpModal({
			classData,
			classEntry,
			newLevel,
			newFeatures,
			hasAsi,
			needsSubclass,
		});
	}

	/** @param {*} arg */

	async _pShowLevelUpModal ({classData, classEntry, newLevel, newFeatures, hasAsi, needsSubclass}) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `🎉 Level Up: ${classEntry.name} → Level ${newLevel}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			isUncappedHeight: true,
			cbClose: () => document.body.classList.remove("has-levelup-wizard"),
		});

		document.body.classList.add("has-levelup-wizard");

		// ========== STATE TRACKING ==========
		let asiChoices = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		/** @type {*} */ let selectedFeat = null;
		/** @type {*} */ let selectedSubclass = null;
		let selectedSubclassChoice = this._state.getSubclassChoice?.(classEntry.name) || null;
		let hpMethod = "average";
		let currentFeatures = newFeatures;
		/** @type {Object<string, *>} */ let selectedOptionalFeatures = {};
		/** @type {*} */ let selectedCombatTraditions = null;
		/** @type {Object<string, *>} */ let selectedFeatureOptions = {};
		/** @type {*} */ let featureOptionGroups = [];
		this._selectedFeatureSkillChoices = {};
		/** @type {Object<string, *>} */ let selectedExpertise = {};
		let expertiseGrants = CharacterSheetClassUtils.getExpertiseGrantsForLevel(currentFeatures);
		/** @type {Object<string, *>} */ let selectedLanguages = {};
		let languageGrants = CharacterSheetClassUtils.getLanguageGrantsForLevel(currentFeatures);
		/** @type {*} */ let selectedScholarSkill = null;
		/** @type {*} */ let selectedSpellbookSpells = [];
		// Subclass-granted combat traditions (pre-seeded during subclass selection)
		let subclassGrantedTraditionCodes = /** @type {*[]} */ ([]);

		// ========== DETERMINE WHAT SECTIONS ARE NEEDED ==========
		// Thelemar rule: applies at CHARACTER level 4, not per-class level 4 (matters for multiclass).
		// At this point the new class level has not yet been written, so getTotalLevel()+1 = new character level.
		const isBothAsiAndFeat = this._state.shouldGrantBothAsiAndFeat((this._state.getTotalLevel() || 0) + 1);
		const isEpicBoonLevel = newLevel === 19 && (classEntry.source === "XPHB" || classEntry.source === "TGTT");
		const optionalFeatureGains = CharacterSheetClassUtils.getOptionalFeatureGains(classData, classEntry.level, newLevel, this._state);
		featureOptionGroups = CharacterSheetClassUtils.getFeatureOptionsForLevel(currentFeatures, newLevel, this._page.getClassFeatures())
			// Filter out option groups where ALL options are optional features — those are
			// handled by optionalfeatureProgression in the Class Options step (e.g. Metamagic)
			.filter((/** @type {*} */ optGroup) => !optGroup.options.every((/** @type {*} */ opt) => opt.type === "optionalfeature"));

		// Scholar expertise (Wizard XPHB/TGTT level 2)
		const existingScholarExpertise = this._state.getScholarExpertise();
		const isWizard2024 = classEntry.name === "Wizard" && CharacterSheetClassUtils.is2024Source(classEntry.source);
		const needsScholarChoice = isWizard2024 && newLevel === 2 && !existingScholarExpertise;

		// Wizard spellbook
		const isWizard = classEntry.name === "Wizard";
		const wizardSpellCount = 2;
		const maxSpellLevel = Math.min(9, Math.ceil(newLevel / 2));

		// Known-spell caster detection (Sorcerer, Bard, Ranger, Warlock, etc.)
		let knownSpellsGain = 0;
		let knownCantripsGain = 0;
		let knownMaxSpellLevel = 0;
		let isKnownCaster = false;

		const spellsKnownProg = classData.spellsKnownProgression;
		const cantripProg = classData.cantripProgression;
		const casterProg = classData.casterProgression;

		// Fallback tables for 2014 casters
		const spellsKnownTables = {
			"Bard": [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
			"Sorcerer": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
			"Warlock": [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
			"Ranger": [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
		};
		const cantripTables = {
			"Bard": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
			"Sorcerer": [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
			"Warlock": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
		};

		// Check if this is a known-spell caster (NOT wizard, NOT prepared caster)
		if (!isWizard && !classData.preparedSpellsProgression) {
			const prog = spellsKnownProg || (/** @type {*} */ (spellsKnownTables))[classEntry.name];
			if (prog) {
				isKnownCaster = true;
				const currentKnown = prog[newLevel - 2] || 0; // Previous level
				const newKnown = prog[newLevel - 1] || 0;
				knownSpellsGain = Math.max(0, newKnown - currentKnown);

				// Cantrip gains
				const cProg = cantripProg || (/** @type {*} */ (cantripTables))[classEntry.name];
				if (cProg) {
					const currentCantrips = cProg[newLevel - 2] || 0;
					const newCantrips = cProg[newLevel - 1] || 0;
					knownCantripsGain = Math.max(0, newCantrips - currentCantrips);
				}

				// Max spell level based on caster progression
				if (casterProg === "full" || !casterProg) {
					knownMaxSpellLevel = Math.min(9, Math.ceil(newLevel / 2));
				} else if (casterProg === "1/2") {
					knownMaxSpellLevel = Math.min(5, Math.ceil(newLevel / 4));
				} else if (casterProg === "1/3") {
					knownMaxSpellLevel = Math.min(4, Math.ceil(newLevel / 7));
				} else if (casterProg === "pact") {
					knownMaxSpellLevel = Math.min(5, Math.ceil(newLevel / 2));
				} else if (casterProg === "artificer") {
					knownMaxSpellLevel = Math.min(5, Math.ceil(newLevel / 4));
				} else {
					knownMaxSpellLevel = Math.min(9, Math.ceil(newLevel / 2));
				}
			}
		}

		/** @type {*} */ let selectedKnownSpells = [];
		/** @type {*} */ let selectedKnownCantrips = [];

		// Prepared-spell caster detection (XPHB Warlock has preparedSpellsProgression)
		let isPreparedCaster = false;
		let preparedSpellsGain = 0;
		let preparedCantripsGain = 0;
		let preparedMaxSpellLevel = 0;

		if (!isWizard && !isKnownCaster && classData.preparedSpellsProgression) {
			isPreparedCaster = true;
			const prog = classData.preparedSpellsProgression;
			const currentPrepared = prog[newLevel - 2] || 0;
			const newPrepared = prog[newLevel - 1] || 0;
			preparedSpellsGain = Math.max(0, newPrepared - currentPrepared);

			const cProg = cantripProg || (/** @type {*} */ (cantripTables))[classEntry.name];
			if (cProg) {
				const currentCantrips = cProg[newLevel - 2] || 0;
				const newCantrips = cProg[newLevel - 1] || 0;
				preparedCantripsGain = Math.max(0, newCantrips - currentCantrips);
			}

			// Max spell level for pact casters
			if (casterProg === "pact") {
				preparedMaxSpellLevel = Math.min(5, Math.ceil(newLevel / 2));
			} else if (casterProg === "full") {
				preparedMaxSpellLevel = Math.min(9, Math.ceil(newLevel / 2));
			} else if (casterProg === "1/2") {
				preparedMaxSpellLevel = Math.min(5, Math.ceil(newLevel / 4));
			} else {
				preparedMaxSpellLevel = Math.min(9, Math.ceil(newLevel / 2));
			}
		}

		/** @type {*} */ let selectedPreparedSpells = [];
		/** @type {*} */ let selectedPreparedCantrips = [];

		// ========== FILTER ASI FEATURES ==========
		const filterAsiFeatures = (/** @type {*} */ features) => {
			if (!hasAsi) return features;
			const asiFeatureNames = ["ability score improvement", "ability score increase", "asi", "feat"];
			return features.filter((/** @type {*} */ f) => {
				const nameLower = f.name.toLowerCase();
				return !asiFeatureNames.some((/** @type {*} */ asi) => nameLower.includes(asi));
			});
		};

		// ========== BUILD WIZARD LAYOUT ==========
		const wizard = e_({tag: "div", clazz: "charsheet__levelup-wizard"});
		modalInner.append(wizard);

		// ========== SIDEBAR ==========
		const sidebar = e_({tag: "div", clazz: "charsheet__levelup-sidebar"});
		wizard.append(sidebar);

		// Sidebar Header
		sidebar.append(ee`<div class="charsheet__levelup-sidebar-header">
			<div class="level-badge">${newLevel}</div>
			<h4>${classEntry.name}</h4>
		</div>`);

		// Progress Bar
		const progress = e_({outer: `
			<div class="charsheet__levelup-progress">
				<div class="charsheet__levelup-progress-bar">
					<div class="charsheet__levelup-progress-fill" style="width: 0%"></div>
				</div>
				<div class="charsheet__levelup-progress-text">0% complete</div>
			</div>
		`});
		sidebar.append(progress);

		// Summary items container
		const summaryItems = e_({tag: "div", clazz: "charsheet__levelup-summary-items"});
		sidebar.append(summaryItems);

		// ========== MAIN CONTENT ==========
		const main = e_({tag: "div", clazz: "charsheet__levelup-main"});
		wizard.append(main);

		// ========== ACCORDION HELPER ==========
		/** @type {Object<string, *>} */ const accordions = {};
		const createAccordion = (/** @type {*} */ id, /** @type {*} */ icon, /** @type {*} */ title, /** @type {*} */ content, {required = false, startExpanded = false} = {}) => {
			const accordion = e_({outer: `
				<div class="charsheet__levelup-accordion ${startExpanded ? "expanded" : ""}" data-accordion-id="${id}">
					<div class="charsheet__levelup-accordion-header">
						<span class="charsheet__levelup-accordion-icon">${icon}</span>
						<span class="charsheet__levelup-accordion-title">${title}</span>
						<span class="charsheet__levelup-accordion-badge ${required ? "badge-pending" : "badge-info"}">
							${required ? "⚠️ Required" : "ℹ️ Info"}
						</span>
						<span class="charsheet__levelup-accordion-chevron glyphicon glyphicon-chevron-down"></span>
					</div>
					<div class="charsheet__levelup-accordion-body"></div>
				</div>
			`});

			accordion.querySelector(".charsheet__levelup-accordion-body").append(content);
			accordion.querySelector(".charsheet__levelup-accordion-header").addEventListener("click", () => {
				const isExpanded = accordion.classList.contains("expanded");
				// Collapse all others
				main.querySelectorAll(".charsheet__levelup-accordion").forEach((/** @type {*} */ el) => el.classList.remove("expanded"));
				// Toggle this one
				if (!isExpanded) accordion.classList.add("expanded");
				updateActiveSummary(isExpanded ? null : id);
			});

			accordions[id] = {
				el: accordion,
				required,
				setComplete: (/** @type {*} */ complete, /** @type {*} */ summary = "") => {
					const badge = accordion.querySelector(".charsheet__levelup-accordion-badge");
					if (complete) {
						badge.classList.remove("badge-pending", "badge-info");
						badge.classList.add("badge-complete");
						badge.innerHTML = `✓ ${summary || "Done"}`;
						accordion.classList.add("completed");
					} else if (required) {
						badge.classList.remove("badge-complete", "badge-info");
						badge.classList.add("badge-pending");
						badge.innerHTML = "⚠️ Required";
						accordion.classList.remove("completed");
					} else {
						badge.classList.remove("badge-complete", "badge-pending");
						badge.classList.add("badge-info");
						badge.innerHTML = `ℹ️ ${summary || "Info"}`;
						accordion.classList.remove("completed");
					}
					updateProgress();
				},
			};

			return accordion;
		};

		// ========== SUMMARY ITEM HELPER ==========
		/** @type {Object<string, *>} */ const summaryItemEls = {};
		const createSummaryItem = (/** @type {*} */ id, /** @type {*} */ icon, /** @type {*} */ label, {required = false} = {}) => {
			const item = e_({outer: `
				<div class="charsheet__levelup-summary-item ${required ? "warning" : ""}" data-summary-id="${id}">
					<span class="charsheet__levelup-summary-icon ${required ? "status-pending" : "status-info"}">${icon}</span>
					<div class="charsheet__levelup-summary-content">
						<div class="charsheet__levelup-summary-label">${label}</div>
						<div class="charsheet__levelup-summary-value">Not selected</div>
					</div>
				</div>
			`});

			item.addEventListener("click", () => {
				// Expand corresponding accordion
				const accordion = main.querySelector(`[data-accordion-id="${id}"]`);
				if (accordion) {
					main.querySelectorAll(".charsheet__levelup-accordion").forEach((/** @type {*} */ el) => el.classList.remove("expanded"));
					accordion.classList.add("expanded");
					accordion.scrollIntoView({behavior: "smooth", block: "start"});
					updateActiveSummary(id);
				}
			});

			summaryItemEls[id] = {
				el: item,
				required,
				setStatus: (/** @type {*} */ complete, /** @type {*} */ value = "") => {
					const iconEl = item.querySelector(".charsheet__levelup-summary-icon");
					const valueEl = item.querySelector(".charsheet__levelup-summary-value");

					if (complete) {
						item.classList.remove("warning");
						item.classList.add("completed");
						iconEl.classList.remove("status-pending", "status-info");
						iconEl.classList.add("status-complete");
						iconEl.textContent = "✓";
						valueEl.textContent = value || "Done";
					} else if (required) {
						item.classList.remove("completed");
						item.classList.add("warning");
						iconEl.classList.remove("status-complete", "status-info");
						iconEl.classList.add("status-pending");
						iconEl.textContent = "⚠️";
						valueEl.textContent = "Not selected";
					} else {
						item.classList.remove("completed", "warning");
						iconEl.classList.remove("status-complete", "status-pending");
						iconEl.classList.add("status-info");
						iconEl.textContent = icon;
						valueEl.textContent = value || "—";
					}
				},
			};

			return item;
		};

		const updateActiveSummary = (/** @type {*} */ activeId) => {
			summaryItems.querySelectorAll(".charsheet__levelup-summary-item").forEach((/** @type {*} */ el) => el.classList.remove("active"));
			if (activeId) {
				const activeEl = summaryItems.querySelector(`[data-summary-id="${activeId}"]`);
				if (activeEl) activeEl.classList.add("active");
			}
		};

		const updateProgress = () => {
			const requiredIds = Object.keys(summaryItemEls).filter((/** @type {*} */ id) => summaryItemEls[id].required);
			const completedCount = requiredIds.filter((/** @type {*} */ id) => summaryItemEls[id].el.classList.contains("completed")).length;
			const totalRequired = requiredIds.length;
			const percent = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 100;

			progress.querySelector(".charsheet__levelup-progress-fill").style.width = `${percent}%`;
			progress.querySelector(".charsheet__levelup-progress-text").textContent =
				percent === 100 ? "✓ Ready to level up!" : `${percent}% complete`;
		};

		// ========== 1. SUBCLASS SECTION ==========
		if (needsSubclass) {
			summaryItems.append(createSummaryItem("subclass", "📚", classData.subclassTitle || "Subclass", {required: true}));

			const subclassContent = this._renderSubclassSelectionCompact(classData, async (/** @type {*} */ subclass) => {
				selectedSubclass = subclass;
				currentFeatures = CharacterSheetClassUtils.getLevelFeatures(classData, newLevel, subclass, this._page.getClassFeatures(), this._page.getSubclassFeatures());

				// Update dependent sections
				featureOptionGroups = CharacterSheetClassUtils.getFeatureOptionsForLevel(currentFeatures, newLevel, this._page.getClassFeatures())
					.filter((/** @type {*} */ optGroup) => !optGroup.options.every((/** @type {*} */ opt) => opt.type === "optionalfeature"));
				expertiseGrants = CharacterSheetClassUtils.getExpertiseGrantsForLevel(currentFeatures);
				languageGrants = CharacterSheetClassUtils.getLanguageGrantsForLevel(currentFeatures);

				// Detect subclass-granted combat traditions (e.g. Mercy → Sanguine Knot)
				const grantedTraditions = CharacterSheetClassUtils.getSubclassGrantedTraditions(subclass, classEntry.source);
				// Only pre-seed fixed traditions (skip choice-based ones without a code)
				subclassGrantedTraditionCodes = grantedTraditions
					.filter((/** @type {*} */ t) => t.code && !t.choice)
					.map((/** @type {*} */ t) => t.code);
				if (subclassGrantedTraditionCodes.length > 0) {
					// Pre-seed traditions in selectedCombatTraditions
					const existing = selectedCombatTraditions || [];
					const merged = [...new Set([...existing, ...subclassGrantedTraditionCodes])];
					selectedCombatTraditions = merged;
				}

				// Augment optionalFeatureGains with bonus methods from the subclass
				const bonusMethodCount = CharacterSheetClassUtils.getSubclassBonusMethodCount(subclass, classEntry.source);
				if (bonusMethodCount > 0) {
					const ctmGainIdx = optionalFeatureGains.findIndex((/** @type {*} */ g) => g.featureTypes?.some((/** @type {*} */ ft) => ft.startsWith("CTM:")));
					if (ctmGainIdx >= 0) {
						// Existing combat methods gain — add the bonus
						optionalFeatureGains[ctmGainIdx] = {
							...optionalFeatureGains[ctmGainIdx],
							newCount: optionalFeatureGains[ctmGainIdx].newCount + bonusMethodCount,
							totalCount: optionalFeatureGains[ctmGainIdx].totalCount + bonusMethodCount,
							_subclassBonus: bonusMethodCount,
						};
					} else {
						// No base gain at this level — create one for the subclass bonus
						const ctmProg = classData.optionalfeatureProgression?.find(
							(/** @type {*} */ p) => p.featureType?.some((/** @type {*} */ ft) => ft.startsWith("CTM:")),
						);
						if (ctmProg) {
							optionalFeatureGains.push({
								featureTypes: ctmProg.featureType,
								name: ctmProg.name || "Combat Methods",
								currentCount: 0,
								totalCount: bonusMethodCount,
								newCount: bonusMethodCount,
								required: false,
								_subclassBonus: bonusMethodCount,
							});
						}
					}
				}

				// Re-render optional features section if it exists, or create it
				// dynamically if subclass grants bonus methods
				if (optionalFeatureGains.length > 0) {
					// Preserve CTM (combat method) selections across subclass re-renders
					/** @type {Object<string, *>} */ const savedCTM = {};
					for (const [k, v] of Object.entries(selectedOptionalFeatures)) {
						if (k.includes("CTM:")) savedCTM[k] = v;
					}
					selectedOptionalFeatures = {...savedCTM};
					if (accordions.optfeatures) {
						// Re-render existing accordion body
						const body = accordions.optfeatures.el.querySelector(".charsheet__levelup-accordion-body");
						body.innerHTML = "";
						const optContent = this._renderOptionalFeaturesSelection(classData, optionalFeatureGains, createOptFeaturesOnSelect, newLevel, {subclassGrantedTraditionCodes, existingSelections: selectedOptionalFeatures});
						body.append(optContent);
					} else {
						// Create the accordion dynamically (wasn't needed before subclass selection)
						summaryItems.append(createSummaryItem("optfeatures", "✨", "Class Options", {required: true}));
						const optContent = this._renderOptionalFeaturesSelection(classData, optionalFeatureGains, createOptFeaturesOnSelect, newLevel, {subclassGrantedTraditionCodes, existingSelections: selectedOptionalFeatures});
						// Insert after subclass accordion
						const subclassAccordion = accordions.subclass?.el;
						const optAccordion = createAccordion("optfeatures", "✨", "Class Options", optContent, {required: true});
						if (subclassAccordion?.nextSibling) {
							main.insertBefore(optAccordion, subclassAccordion.nextSibling);
						} else {
							main.append(optAccordion);
						}
					}
				}

				// Update summary & accordion
				summaryItemEls.subclass.setStatus(true, subclass.name);
				accordions.subclass.setComplete(true, subclass.shortName || subclass.name);

				// Divine Soul: prompt for affinity immediately so spell picker can include Cleric spells
				if (classEntry.name === "Sorcerer" && CharacterSheetClassUtils.isDivineSoulSubclass(subclass) && !CharacterSheetClassUtils.normalizeDivineSoulAffinity(selectedSubclassChoice)) {
					const affinityOptions = CharacterSheetClassUtils.getDivineSoulAffinityOptions(subclass);
					if (affinityOptions.length) {
						const affinityChoice = await InputUiUtil.pGetUserEnum({
							title: "Divine Soul Affinity",
							values: affinityOptions,
							fnDisplay: (/** @type {*} */ opt) => opt.name,
							isResolveItem: true,
							zIndex: 10002,
							htmlDescription: "<div>Choose the Divine Soul affinity that grants your extra spell and Cleric spell access.</div>",
						});
						if (affinityChoice) {
							selectedSubclassChoice = affinityChoice;
						}
					}
				}

				// Re-render known spells section if it exists (subclass may grant additional spell lists)
				if (accordions.knownspells) {
					const body = accordions.knownspells.el.querySelector(".charsheet__levelup-accordion-body");
					body.innerHTML = "";
					const knownAllSpells = this._page.getFilteredSpellData();
					const knownExistingIds = new Set([
						...(this._state.getSpells?.() || []),
						...(this._state.getCantripsKnown?.() || []),
					].map((/** @type {*} */ s) => `${s.name}|${s.source}`));
					const updatedKnownContent = CharacterSheetSpellPicker.renderKnownSpellPicker(/** @type {*} */ ({
						className: classEntry.name,
						classSource: classEntry.source,
						spellCount: knownSpellsGain,
						cantripCount: knownCantripsGain,
						maxSpellLevel: knownMaxSpellLevel,
						allSpells: knownAllSpells,
						knownSpellIds: knownExistingIds,
						getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
						subclass: selectedSubclass || classEntry.subclass,
						additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
							className: classEntry.name,
							subclass: selectedSubclass || classEntry.subclass,
							subclassChoice: selectedSubclassChoice,
						}),
						onSelect: (/** @type {*} */ spells, /** @type {*} */ cantrips) => {
							selectedKnownSpells = spells;
							selectedKnownCantrips = cantrips;
							// Known spells/cantrips are optional at level-up — always complete.
							const parts = [];
							if (knownSpellsGain > 0) parts.push(`${spells.length}/${knownSpellsGain} spells`);
							if (knownCantripsGain > 0) parts.push(`${cantrips.length}/${knownCantripsGain} cantrips`);
							const allNames = [...cantrips, ...spells].map((/** @type {*} */ s) => s.name).join(", ");
							const summary = allNames || `${parts.join(", ")} — pick later on the Spells tab`;
							summaryItemEls.knownspells.setStatus(true, summary);
							accordions.knownspells.setComplete(true, parts.join(", "));
						},
					}));
					body.append(updatedKnownContent);
					// Clear previous spell selections since the spell list changed,
					// but keep the optional contract: section stays "complete".
					selectedKnownSpells = [];
					selectedKnownCantrips = [];
					const resetParts = [];
					if (knownSpellsGain > 0) resetParts.push(`0/${knownSpellsGain} spells`);
					if (knownCantripsGain > 0) resetParts.push(`0/${knownCantripsGain} cantrips`);
					summaryItemEls.knownspells?.setStatus(true, `${resetParts.join(", ")} — pick later on the Spells tab`);
					accordions.knownspells.setComplete(true, resetParts.join(", "));
				}

				// Update features accordion
				if (accordions.features) {
					const filtered = filterAsiFeatures(currentFeatures);
					const body = accordions.features.el.querySelector(".charsheet__levelup-accordion-body");
					body.innerHTML = "";
					body.append(this._renderFeaturesCompact(filtered));
					accordions.features.setComplete(true, `${filtered.length} feature${filtered.length !== 1 ? "s" : ""}`);
				}

				// Auto-expand next incomplete section
				expandNextIncomplete();
			});

			main.append(createAccordion("subclass", "📚", `Choose ${classData.subclassTitle || "Subclass"}`, subclassContent, {required: true, startExpanded: true}));
		}

		// ========== 2. ASI / FEAT SECTION ==========
		if (hasAsi) {
			const asiLabel = isBothAsiAndFeat ? "ASI + Feat" : isEpicBoonLevel ? "ASI / Epic Boon" : "ASI / Feat";
			summaryItems.append(createSummaryItem("asi", "📈", asiLabel, {required: true}));

			const asiContent = this._renderAsiSelectionCompact(
				(/** @type {*} */ ability, /** @type {*} */ delta) => {
					(/** @type {*} */ (asiChoices))[ability] = ((/** @type {*} */ (asiChoices))[ability] || 0) + delta;
					updateAsiStatus();
				},
				(/** @type {*} */ feat) => {
					selectedFeat = feat;
					updateAsiStatus();
				},
				isBothAsiAndFeat,
				isEpicBoonLevel,
			);

			const updateAsiStatus = () => {
				const totalAsi = Object.values(asiChoices).reduce((/** @type {*} */ sum, /** @type {*} */ v) => sum + v, 0);
				const asiComplete = totalAsi === 2;
				const featComplete = selectedFeat != null;

				let complete = false;
				let summary = "";

				if (isBothAsiAndFeat) {
					complete = asiComplete && featComplete;
					const asiParts = Object.entries(asiChoices).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k.toUpperCase()}`);
					summary = asiComplete && featComplete
						? `${asiParts.join(", ")} + ${selectedFeat.name}`
						: asiComplete ? `${asiParts.join(", ")} (+feat)`
							: featComplete ? `+${selectedFeat.name} (+ASI)` : "Incomplete";
				} else if (featComplete) {
					complete = true;
					summary = selectedFeat.name;
				} else if (asiComplete) {
					complete = true;
					const parts = Object.entries(asiChoices).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k.toUpperCase()}`);
					summary = parts.join(", ");
				}

				summaryItemEls.asi.setStatus(complete, summary);
				accordions.asi.setComplete(complete, summary);
			};

			main.append(createAccordion("asi", "📈", asiLabel, asiContent, {required: true, startExpanded: !needsSubclass}));
		}

		// ========== 3. OPTIONAL FEATURES (Metamagic, Invocations, etc.) ==========
		const updateOptFeaturesStatus = () => {
			if (!summaryItemEls.optfeatures || !accordions.optfeatures) return;
			let allComplete = true;
			const summaries = [];

			for (const gain of optionalFeatureGains) {
				const featureKey = gain.featureTypes.join("_");
				const selected = selectedOptionalFeatures[featureKey] || [];
				if (selected.length < gain.newCount) {
					allComplete = false;
				} else {
					summaries.push(`${selected.length} ${gain.name}`);
				}
			}

			summaryItemEls.optfeatures.setStatus(allComplete, summaries.join(", ") || "Select options");
			accordions.optfeatures.setComplete(allComplete, summaries.join(", "));
		};

		const createOptFeaturesOnSelect = (/** @type {*} */ featureType, /** @type {*} */ features, /** @type {*} */ meta = null) => {
			selectedOptionalFeatures[featureType] = features;
			if (meta?.combatTraditions?.length) selectedCombatTraditions = [...meta.combatTraditions];
			updateOptFeaturesStatus();
		};

		if (optionalFeatureGains.length) {
			summaryItems.append(createSummaryItem("optfeatures", "✨", "Class Options", {required: true}));

			const optContent = this._renderOptionalFeaturesSelection(classData, optionalFeatureGains, createOptFeaturesOnSelect, newLevel);

			main.append(createAccordion("optfeatures", "✨", "Class Options", optContent, {required: true}));
		}

		// ========== 4. FEATURE OPTIONS (Specialties, etc.) ==========
		if (featureOptionGroups.length) {
			summaryItems.append(createSummaryItem("featoptions", "🎯", "Feature Choices", {required: true}));

			const featOptContent = this._renderFeatureOptionsSelection(featureOptionGroups, (/** @type {*} */ featureKey, /** @type {*} */ options) => {
				selectedFeatureOptions[featureKey] = options;
				updateFeatOptionsStatus();
			});

			const updateFeatOptionsStatus = () => {
				let allComplete = true;
				const summaries = [];

				// Count available options (not already chosen)
				const existingFeatures = this._state.getFeatures?.() || [];
				const existingFeatureNames = new Set(existingFeatures.map((/** @type {*} */ f) => f.name));

				for (const optGroup of featureOptionGroups) {
					const featureKey = `${optGroup.featureName}_${optGroup.featureSource || ""}`;
					const selected = selectedFeatureOptions[featureKey] || [];

					const availableCount = optGroup.options.filter((/** @type {*} */ opt) => {
						if (!existingFeatureNames.has(opt.name)) return true;
						if (opt.type === "classFeature" && opt.ref) {
							const parts = opt.ref.split("|");
							const classFeatures = this._page.getClassFeatures();
							const fullOpt = classFeatures.find((/** @type {*} */ f) => f.name === parts[0] && f.className === parts[1] && f.source === parts[2]);
							if (fullOpt?.entries) {
								const text = JSON.stringify(fullOpt.entries).toLowerCase();
								return text.includes("multiple times") || text.includes("chosen again");
							}
						}
						return false;
					}).length;

					const requiredCount = Math.min(optGroup.count, availableCount);
					if (requiredCount > 0 && selected.length < requiredCount) {
						allComplete = false;
					} else if (selected.length > 0) {
						summaries.push(selected.map((/** @type {*} */ o) => o.name).join(", "));
					}
				}

				summaryItemEls.featoptions.setStatus(allComplete, summaries.join("; ") || "Select options");
				accordions.featoptions.setComplete(allComplete, summaries.length ? `${summaries.length} chosen` : "");
			};

			main.append(createAccordion("featoptions", "🎯", "Feature Choices", featOptContent, {required: true}));
		}

		// ========== 5. EXPERTISE ==========
		if (expertiseGrants.length) {
			summaryItems.append(createSummaryItem("expertise", "⭐", "Expertise", {required: true}));

			const expertiseContent = this._renderExpertiseSelectionForLevelUp(expertiseGrants, (/** @type {*} */ featureKey, /** @type {*} */ skills) => {
				selectedExpertise[featureKey] = skills;
				updateExpertiseStatus();
			});

			const updateExpertiseStatus = () => {
				let allComplete = true;
				const allSkills = [];

				for (const grant of expertiseGrants) {
					const selected = selectedExpertise[grant.featureName] || [];
					// Fixed skills are always complete
					if (grant.fixedSkills?.length > 0) {
						allSkills.push(...grant.fixedSkills.map((/** @type {*} */ s) => s.toTitleCase()));
						continue;
					}
					if (selected.length < grant.count) allComplete = false;
					allSkills.push(...selected);
				}

				summaryItemEls.expertise.setStatus(allComplete, allSkills.join(", ") || "Select skills");
				accordions.expertise.setComplete(allComplete, allSkills.join(", "));
			};

			main.append(createAccordion("expertise", "⭐", "Expertise", expertiseContent, {required: true}));

			// Run initial status update for any pre-populated fixed skills
			updateExpertiseStatus();
		}

		// ========== 6. LANGUAGES ==========
		if (languageGrants.length) {
			summaryItems.append(createSummaryItem("languages", "🗣️", "Languages", {required: true}));

			const langContent = this._renderLanguageSelectionForLevelUp(languageGrants, (/** @type {*} */ featureKey, /** @type {*} */ languages) => {
				selectedLanguages[featureKey] = languages;
				updateLanguageStatus();
			});

			const updateLanguageStatus = () => {
				let allComplete = true;
				const allLangs = [];

				for (const grant of languageGrants) {
					const selected = selectedLanguages[grant.featureName] || [];
					if (selected.length < grant.count) allComplete = false;
					allLangs.push(...selected);
				}

				summaryItemEls.languages.setStatus(allComplete, allLangs.join(", ") || "Select languages");
				accordions.languages.setComplete(allComplete, allLangs.join(", "));
			};

			main.append(createAccordion("languages", "🗣️", "Languages", langContent, {required: true}));
		}

		// ========== 7. SCHOLAR EXPERTISE (Wizard) ==========
		if (needsScholarChoice) {
			summaryItems.append(createSummaryItem("scholar", "📖", "Scholar", {required: true}));

			const scholarContent = this._renderScholarExpertiseSelection((/** @type {*} */ skill) => {
				selectedScholarSkill = skill;
				summaryItemEls.scholar.setStatus(true, skill);
				accordions.scholar.setComplete(true, skill);
				expandNextIncomplete();
			});

			main.append(createAccordion("scholar", "📖", "Scholar Expertise", scholarContent, {required: true}));
		}

		// ========== 7b. SPELL SWAP (Known-casters only) ==========
		/** @type {*} */ let stagedSpellSwap = null; // {oldSpell, newSpell}
		const spellSwapCount = CharacterSheetClassUtils.getSpellSwapCount(classEntry.name, classEntry.source, newLevel);
		if (spellSwapCount > 0) {
			summaryItems.append(createSummaryItem("spellswap", "🔄", "Swap Spell", {required: false}));

			const swapContent = this._renderSpellSwapSection({
				classEntry,
				newLevel,
				knownMaxSpellLevel: (() => {
					const cp = classData?.casterProgression;
					if (cp === "pact") return Math.min(5, Math.ceil(newLevel / 2));
					if (cp === "1/2") return Math.min(5, Math.ceil(newLevel / 4));
					if (cp === "1/3") return Math.min(4, Math.ceil(newLevel / 7));
					return Math.min(9, Math.ceil(newLevel / 2));
				})(),
				selectedSubclass: () => selectedSubclass || classEntry.subclass,
				selectedSubclassChoice: () => selectedSubclassChoice,
				onSwap: (/** @type {*} */ oldSpell, /** @type {*} */ newSpell) => {
					stagedSpellSwap = oldSpell && newSpell ? {oldSpell, newSpell} : null;
					const summary = stagedSpellSwap
						? `${oldSpell.name} → ${newSpell.name}`
						: "No swap";
					summaryItemEls.spellswap.setStatus(true, summary);
					accordions.spellswap.setComplete(true, summary);
				},
			});

			main.append(createAccordion("spellswap", "🔄", "Swap Spell (Optional)", swapContent, {required: false}));
		}

		// ========== 8. WIZARD SPELLBOOK ==========
		if (isWizard) {
			summaryItems.append(createSummaryItem("spellbook", "📕", "Spellbook", {required: false}));

			const allSpells = this._page.getFilteredSpellData();
			const knownSpellIds = new Set((this._state.getSpells?.() || []).map((/** @type {*} */ s) => `${s.name}|${s.source}`));

			const spellbookContent = CharacterSheetSpellPicker.renderWizardSpellbookPicker(/** @type {*} */ ({
				spellCount: wizardSpellCount,
				maxSpellLevel,
				allSpells,
				knownSpellIds,
				className: classEntry.name,
				subclass: selectedSubclass || classEntry.subclass,
				getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
				onSelect: (/** @type {*} */ spells) => {
					selectedSpellbookSpells = spells;
					// Spellbook picks are optional at level-up — always report complete
					// so the accordion + summary stop flagging partial selections as red.
					const summary = spells.length > 0 ? spells.map((/** @type {*} */ s) => s.name).join(", ") : "None — pick later on the Spells tab";
					summaryItemEls.spellbook.setStatus(true, summary);
					accordions.spellbook.setComplete(true, `${spells.length}/${wizardSpellCount} spells`);
				},
			}));

			main.append(createAccordion("spellbook", "📕", `Spellbook (+${wizardSpellCount} Spells, optional)`, spellbookContent, {required: false}));
			// Initial state: optional section starts "complete" with no picks.
			summaryItemEls.spellbook.setStatus(true, "None — pick later on the Spells tab");
			accordions.spellbook.setComplete(true, `0/${wizardSpellCount} spells`);
		}

		// ========== 8b. KNOWN SPELLS (Sorcerer, Bard, Ranger, Warlock, etc.) ==========
		if (isKnownCaster && (knownSpellsGain > 0 || knownCantripsGain > 0)) {
			const totalGain = knownSpellsGain + knownCantripsGain;
			summaryItems.append(createSummaryItem("knownspells", "✨", "Spells Known", {required: false}));

			const knownAllSpells = this._page.getFilteredSpellData();
			const knownExistingIds = new Set([
				...(this._state.getSpells?.() || []),
				...(this._state.getCantripsKnown?.() || []),
			].map((/** @type {*} */ s) => `${s.name}|${s.source}`));

			const knownSpellsContent = CharacterSheetSpellPicker.renderKnownSpellPicker(/** @type {*} */ ({
				className: classEntry.name,
				classSource: classEntry.source,
				spellCount: knownSpellsGain,
				cantripCount: knownCantripsGain,
				maxSpellLevel: knownMaxSpellLevel,
				allSpells: knownAllSpells,
				knownSpellIds: knownExistingIds,
				getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
				subclass: selectedSubclass || classEntry.subclass,
				additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
					className: classEntry.name,
					subclass: selectedSubclass || classEntry.subclass,
					subclassChoice: selectedSubclassChoice,
				}),
				onSelect: (/** @type {*} */ spells, /** @type {*} */ cantrips) => {
					selectedKnownSpells = spells;
					selectedKnownCantrips = cantrips;
					// Known spells/cantrips are optional at level-up — always complete.
					const parts = [];
					if (knownSpellsGain > 0) parts.push(`${spells.length}/${knownSpellsGain} spells`);
					if (knownCantripsGain > 0) parts.push(`${cantrips.length}/${knownCantripsGain} cantrips`);
					const allNames = [...cantrips, ...spells].map((/** @type {*} */ s) => s.name).join(", ");
					const summary = allNames || `${parts.join(", ")} — pick later on the Spells tab`;
					summaryItemEls.knownspells.setStatus(true, summary);
					accordions.knownspells.setComplete(true, parts.join(", "));
				},
			}));

			const sectionLabel = [];
			if (knownSpellsGain > 0) sectionLabel.push(`+${knownSpellsGain} Spell${knownSpellsGain !== 1 ? "s" : ""}`);
			if (knownCantripsGain > 0) sectionLabel.push(`+${knownCantripsGain} Cantrip${knownCantripsGain !== 1 ? "s" : ""}`);
			main.append(createAccordion("knownspells", "✨", `Spells Known (${sectionLabel.join(", ")}, optional)`, knownSpellsContent, {required: false}));
			// Initial state: optional section starts "complete" with no picks.
			const knownInitialParts = [];
			if (knownSpellsGain > 0) knownInitialParts.push(`0/${knownSpellsGain} spells`);
			if (knownCantripsGain > 0) knownInitialParts.push(`0/${knownCantripsGain} cantrips`);
			summaryItemEls.knownspells.setStatus(true, `${knownInitialParts.join(", ")} — pick later on the Spells tab`);
			accordions.knownspells.setComplete(true, knownInitialParts.join(", "));
		}

		// ========== 8c. PREPARED SPELLS (XPHB Warlock, etc.) ==========
		if (isPreparedCaster && (preparedSpellsGain > 0 || preparedCantripsGain > 0)) {
			const totalGain = preparedSpellsGain + preparedCantripsGain;
			summaryItems.append(createSummaryItem("preparedspells", "✨", "Prepared Spells", {required: false}));

			const prepAllSpells = this._page.getFilteredSpellData();
			const prepExistingIds = new Set([
				...(this._state.getSpells?.() || []),
				...(this._state.getCantripsKnown?.() || []),
				...(this._state.getPreparedSpells?.() || []),
			].map((/** @type {*} */ s) => `${s.name}|${s.source}`));

			const preparedContent = CharacterSheetSpellPicker.renderKnownSpellPicker(/** @type {*} */ ({
				className: classEntry.name,
				classSource: classEntry.source,
				spellCount: preparedSpellsGain,
				cantripCount: preparedCantripsGain,
				maxSpellLevel: preparedMaxSpellLevel,
				allSpells: prepAllSpells,
				knownSpellIds: prepExistingIds,
				getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
				subclass: selectedSubclass || classEntry.subclass,
				onSelect: (/** @type {*} */ spells, /** @type {*} */ cantrips) => {
					selectedPreparedSpells = spells;
					selectedPreparedCantrips = cantrips;
					// Prepared spells/cantrips are optional at level-up — always complete.
					const parts = [];
					if (preparedSpellsGain > 0) parts.push(`${spells.length}/${preparedSpellsGain} spells`);
					if (preparedCantripsGain > 0) parts.push(`${cantrips.length}/${preparedCantripsGain} cantrips`);
					const allNames = [...cantrips, ...spells].map((/** @type {*} */ s) => s.name).join(", ");
					const summary = allNames || `${parts.join(", ")} — pick later on the Spells tab`;
					summaryItemEls.preparedspells.setStatus(true, summary);
					accordions.preparedspells.setComplete(true, parts.join(", "));
				},
			}));

			const sectionLabel = [];
			if (preparedSpellsGain > 0) sectionLabel.push(`+${preparedSpellsGain} Spell${preparedSpellsGain !== 1 ? "s" : ""}`);
			if (preparedCantripsGain > 0) sectionLabel.push(`+${preparedCantripsGain} Cantrip${preparedCantripsGain !== 1 ? "s" : ""}`);
			main.append(createAccordion("preparedspells", "✨", `Prepared Spells (${sectionLabel.join(", ")}, optional)`, preparedContent, {required: false}));
			// Initial state: optional section starts "complete" with no picks.
			const prepInitialParts = [];
			if (preparedSpellsGain > 0) prepInitialParts.push(`0/${preparedSpellsGain} spells`);
			if (preparedCantripsGain > 0) prepInitialParts.push(`0/${preparedCantripsGain} cantrips`);
			summaryItemEls.preparedspells.setStatus(true, `${prepInitialParts.join(", ")} — pick later on the Spells tab`);
			accordions.preparedspells.setComplete(true, prepInitialParts.join(", "));
		}

		// ========== 9. NEW FEATURES (Info Only) ==========
		const filteredFeatures = filterAsiFeatures(currentFeatures);
		if (filteredFeatures.length) {
			summaryItems.append(createSummaryItem("features", "⭐", "New Features", {required: false}));

			const featuresContent = this._renderFeaturesCompact(filteredFeatures);
			main.append(createAccordion("features", "⭐", `New Features (${filteredFeatures.length})`, featuresContent, {required: false}));

			summaryItemEls.features.setStatus(true, `${filteredFeatures.length} feature${filteredFeatures.length !== 1 ? "s" : ""}`);
			accordions.features.setComplete(true, `${filteredFeatures.length} gained`);
		}

		// ========== 10. HP ==========
		summaryItems.append(createSummaryItem("hp", "❤️", "Hit Points", {required: false}));

		const hitDie = CharacterSheetClassUtils.getClassHitDie(classData);
		const conMod = this._state.getAbilityMod("con");
		const averageHp = Math.ceil(hitDie / 2) + 1 + conMod;

		const hpContent = e_({outer: `
			<div class="charsheet__levelup-hp">
				<label class="ve-flex-v-center">
					<input type="radio" name="hp-method-wizard" value="average" checked class="mr-2" data-testid="levelup-hp-average">
					<span>Take average: <strong>${averageHp}</strong> HP (${Math.ceil(hitDie / 2) + 1} + ${conMod} CON)</span>
				</label>
				<label class="ve-flex-v-center">
					<input type="radio" name="hp-method-wizard" value="roll" class="mr-2" data-testid="levelup-hp-roll">
					<span>Roll: 1d${hitDie} + ${conMod} CON</span>
				</label>
			</div>
		`});

		hpContent.querySelectorAll("input[name=\"hp-method-wizard\"]").forEach((/** @type {*} */ radio) => {
			radio.addEventListener("change", /** @this {*} */ function () {
				hpMethod = (/** @type {*} */ (this)).value;
				summaryItemEls.hp.setStatus(true, hpMethod === "average" ? `+${averageHp} (avg)` : `1d${hitDie}+${conMod}`);
			});
		});

		main.append(createAccordion("hp", "❤️", "Hit Points", hpContent, {required: false}));
		summaryItemEls.hp.setStatus(true, `+${averageHp} (avg)`);
		accordions.hp.setComplete(true, `+${averageHp}`);

		// ========== EXPAND FIRST INCOMPLETE ==========
		const expandNextIncomplete = () => {
			const firstIncomplete = Object.entries(accordions).find(([id, acc]) => acc.required && !acc.el.classList.contains("completed"));
			if (firstIncomplete) {
				main.querySelectorAll(".charsheet__levelup-accordion").forEach((/** @type {*} */ el) => el.classList.remove("expanded"));
				firstIncomplete[1].el.classList.add("expanded");
				updateActiveSummary(firstIncomplete[0]);
			}
		};

		// Initial expand
		if (!needsSubclass) expandNextIncomplete();
		updateProgress();

		// ========== FOOTER BUTTONS ==========
		const footer = ee`
			<div class="ve-flex-v-center ve-flex-h-right mt-3 pt-3" style="border-top: 1px solid var(--rgb-border-grey);">
				<button class="ve-btn ve-btn-default mr-2" data-testid="levelup-cancel">Cancel</button>
				<button class="ve-btn ve-btn-primary ve-btn-lg" data-testid="levelup-finish">
					<span class="glyphicon glyphicon-arrow-up"></span> Level Up to ${newLevel}
				</button>
			</div>
		`;
		modalInner.append(footer);

		footer.querySelector(".ve-btn-default").addEventListener("click", () => doClose(false));
		footer.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			// ========== VALIDATION ==========
			if (needsSubclass && !selectedSubclass) {
				JqueryUtil.doToast({type: "warning", content: "Please select a subclass."});
				const el = accordions.subclass.el;
				el.classList.add("expanded");
				el.scrollIntoView({behavior: "smooth"});
				return;
			}

			const divineSoulSubclass = selectedSubclass || classEntry.subclass;
			if (classEntry.name === "Sorcerer" && CharacterSheetClassUtils.isDivineSoulSubclass(divineSoulSubclass) && !CharacterSheetClassUtils.normalizeDivineSoulAffinity(selectedSubclassChoice)) {
				const affinityOptions = CharacterSheetClassUtils.getDivineSoulAffinityOptions(selectedSubclass);
				if (!affinityOptions.length) {
					JqueryUtil.doToast({type: "warning", content: "This Divine Soul subclass is missing its affinity options."});
					return;
				}

				selectedSubclassChoice = await InputUiUtil.pGetUserEnum({
					title: "Divine Soul Affinity",
					values: affinityOptions,
					fnDisplay: (/** @type {*} */ opt) => opt.name,
					isResolveItem: true,
					zIndex: 10002,
					htmlDescription: "<div>Choose the Divine Soul affinity that grants your extra spell and Cleric spell access.</div>",
				});

				if (!selectedSubclassChoice) return;
			}

			if (hasAsi) {
				const totalAsi = Object.values(asiChoices).reduce((/** @type {*} */ sum, /** @type {*} */ v) => sum + v, 0);
				if (isBothAsiAndFeat) {
					if (totalAsi !== 2) {
						JqueryUtil.doToast({type: "warning", content: "Please allocate all ability score points (2 total)."});
						const el = accordions.asi.el;
						el.classList.add("expanded");
						el.scrollIntoView({behavior: "smooth"});
						return;
					}
					if (!selectedFeat) {
						JqueryUtil.doToast({type: "warning", content: "Please select a feat (Thelemar: ASI + Feat at level 4)."});
						const el = accordions.asi.el;
						el.classList.add("expanded");
						el.scrollIntoView({behavior: "smooth"});
						return;
					}
				} else if (!selectedFeat && totalAsi !== 2) {
					JqueryUtil.doToast({type: "warning", content: "Please allocate all ability score points or select a feat."});
					const el = accordions.asi.el;
					el.classList.add("expanded");
					el.scrollIntoView({behavior: "smooth"});
					return;
				}
			}

			for (const gain of optionalFeatureGains) {
				const featureKey = gain.featureTypes.join("_");
				const selected = selectedOptionalFeatures[featureKey] || [];
				if (selected.length < gain.newCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${gain.newCount} ${gain.name}.`});
					accordions.optfeatures?.el.classList.add("expanded");
					accordions.optfeatures?.el.scrollIntoView({behavior: "smooth"});
					return;
				}
			}

			// Feature options validation
			const existingFeatures = this._state.getFeatures?.() || [];
			const existingFeatureNames = new Set(existingFeatures.map((/** @type {*} */ f) => f.name));

			for (const optGroup of featureOptionGroups) {
				const featureKey = `${optGroup.featureName}_${optGroup.featureSource || ""}`;
				const selected = selectedFeatureOptions[featureKey] || [];

				const availableCount = optGroup.options.filter((/** @type {*} */ opt) => {
					if (!existingFeatureNames.has(opt.name)) return true;
					if (opt.type === "classFeature" && opt.ref) {
						const parts = opt.ref.split("|");
						const classFeatures = this._page.getClassFeatures();
						const fullOpt = classFeatures.find((/** @type {*} */ f) => f.name === parts[0] && f.className === parts[1] && f.source === parts[2]);
						if (fullOpt?.entries) {
							const text = JSON.stringify(fullOpt.entries).toLowerCase();
							return text.includes("multiple times") || text.includes("chosen again");
						}
					}
					return false;
				}).length;

				const requiredCount = Math.min(optGroup.count, availableCount);
				if (requiredCount > 0 && selected.length < requiredCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${requiredCount} option(s) for ${optGroup.featureName}.`});
					accordions.featoptions?.el.classList.add("expanded");
					accordions.featoptions?.el.scrollIntoView({behavior: "smooth"});
					return;
				}
			}

			for (const grant of expertiseGrants) {
				// Skip validation for fixed expertise (auto-populated)
				if (grant.fixedSkills?.length > 0) continue;

				const selected = selectedExpertise[grant.featureName] || [];
				if (selected.length < grant.count) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${grant.count} skill(s) for expertise.`});
					accordions.expertise?.el.classList.add("expanded");
					accordions.expertise?.el.scrollIntoView({behavior: "smooth"});
					return;
				}
			}

			for (const grant of languageGrants) {
				const selected = selectedLanguages[grant.featureName] || [];
				if (selected.length < grant.count) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${grant.count} language(s).`});
					accordions.languages?.el.classList.add("expanded");
					accordions.languages?.el.scrollIntoView({behavior: "smooth"});
					return;
				}
			}

			if (needsScholarChoice && !selectedScholarSkill) {
				JqueryUtil.doToast({type: "warning", content: "Please select a skill for Scholar expertise."});
				accordions.scholar?.el.classList.add("expanded");
				accordions.scholar?.el.scrollIntoView({behavior: "smooth"});
				return;
			}

			// Spell selections are intentionally optional at level-up: whatever the
			// player picked is applied, and any remaining unspent spell/cantrip
			// slots can be filled later from the Spells tab. We deliberately do not
			// gate Apply on under-filled spell pools.

			// ========== APPLY LEVEL UP ==========
			await this._applyLevelUp({
				classEntry,
				newLevel,
				asiChoices,
				selectedFeat,
				selectedSubclass,
				selectedSubclassChoice,
				selectedOptionalFeatures,
				selectedCombatTraditions,
				selectedFeatureOptions,
				selectedExpertise,
				selectedLanguages,
				languageGrants,
				selectedScholarSkill,
				selectedSpellbookSpells,
				selectedKnownSpells,
				selectedKnownCantrips,
				selectedPreparedSpells,
				selectedPreparedCantrips,
				stagedSpellSwap,
				newFeatures: currentFeatures,
				hpMethod,
				classData,
			});

			doClose(true);
		});
	}

	/**
	 * Render compact subclass selection for wizard layout
	 */
	/**
	 * @param {*} classData
	 * @param {*} onSelect
	 */
	_renderSubclassSelectionCompact (/** @type {*} */ classData, /** @type {*} */ onSelect) {
		const allSubclassesRaw = classData.subclasses || [];
		// Apply source filtering
		const allSubclasses = this._page.filterByAllowedSources(allSubclassesRaw);

		const subclassTitle = classData.subclassTitle || "Subclass";
		const container = e_({tag: "div", clazz: "charsheet__levelup-subclasses"});

		// Get class source from classData
		const classSource = classData.source;

		// Group by source affinity
		const primarySubclasses = allSubclasses.filter((/** @type {*} */ sc) => {
			const scClassSource = sc.classSource || Parser.SRC_PHB;
			return scClassSource === classSource
				|| ([Parser.SRC_PHB, Parser.SRC_XPHB].includes(scClassSource)
				&& [Parser.SRC_PHB, Parser.SRC_XPHB].includes(classSource));
		}).sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name));

		const secondarySubclasses = allSubclasses.filter((/** @type {*} */ sc) => {
			const scClassSource = sc.classSource || Parser.SRC_PHB;
			if (scClassSource === classSource) return false;
			if ([Parser.SRC_PHB, Parser.SRC_XPHB].includes(scClassSource)
				&& [Parser.SRC_PHB, Parser.SRC_XPHB].includes(classSource)) return false;
			return true;
		}).sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name));

		// Build source filter options
		const availableSources = [...new Set(allSubclasses.map((/** @type {*} */ sc) => sc.source))].sort();
		const showFilters = allSubclasses.length > 6;

		let selectedSource = "";
		let textFilter = "";

		const filterRow = showFilters ? e_({tag: "div", clazz: "ve-flex gap-2 mb-2"}) : null;
		const searchInput = showFilters
			? e_({outer: `<input type="text" class="ve-form-control ve-input-sm ve-flex-grow" placeholder="Search ${subclassTitle.toLowerCase()}s...">`})
			: null;
		const sourceFilter = showFilters && availableSources.length > 1
			? e_({outer: `
				<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
					<option value="">All Sources</option>
					${availableSources.map((/** @type {*} */ src) => `<option value="${src}">${Parser.sourceJsonToAbv(src)}</option>`).join("")}
				</select>
			`})
			: null;

		if (filterRow) {
			filterRow.append(searchInput);
			if (sourceFilter) filterRow.append(sourceFilter);
		}

		const list = e_({outer: `<div style="max-height: 300px; overflow-y: auto;"></div>`});

		const renderSubclassItem = (/** @type {*} */ subclass) => {
			const option = e_({outer: `
				<div class="charsheet__levelup-option">
					<div class="charsheet__levelup-option-header">
						<input type="radio" name="subclass-choice-wizard" value="${subclass.name}">
						<span class="subclass-name-link"></span>
						<span class="ve-small ve-muted ml-auto">${Parser.sourceJsonToAbv(subclass.source)}</span>
					</div>
				</div>
			`});
			// Add hoverable subclass link
			const subclassLink = CharacterSheetPage.getSubclassHoverLink(subclass);
			const nameSpan = option.querySelector(".subclass-name-link");
			if (typeof subclassLink === "string") nameSpan.innerHTML = subclassLink;
			else nameSpan.append(subclassLink);

			option.addEventListener("click", () => {
				list.querySelectorAll(".charsheet__levelup-option").forEach((/** @type {*} */ el) => el.classList.remove("selected"));
				option.classList.add("selected");
				option.querySelector("input").checked = true;
				onSelect(subclass);
			});

			return option;
		};

		// Track collapse states
		let primaryCollapsed = false;
		let secondaryCollapsed = true; // Start collapsed

		const renderList = () => {
			list.innerHTML = "";
			const filterLower = textFilter.toLowerCase();

			const filterSubclasses = (/** @type {*} */ scs) => scs.filter((/** @type {*} */ sc) => {
				if (selectedSource && sc.source !== selectedSource) return false;
				if (!textFilter) return true;
				return sc.name.toLowerCase().includes(filterLower)
					|| (sc.shortName && sc.shortName.toLowerCase().includes(filterLower));
			});

			const filteredPrimary = filterSubclasses(primarySubclasses);
			const filteredSecondary = filterSubclasses(secondarySubclasses);

			if (filteredPrimary.length === 0 && filteredSecondary.length === 0) {
				list.innerHTML = `<p class="ve-muted text-center py-2">No matching ${subclassTitle.toLowerCase()}s</p>`;
				return;
			}

			// Primary subclasses
			if (filteredPrimary.length > 0) {
				const primaryHeader = e_({outer: `
					<div class="ve-flex-v-center py-2 px-3 mb-2 clickable" 
						style="background: linear-gradient(135deg, rgba(66, 153, 225, 0.15) 0%, rgba(66, 153, 225, 0.05) 100%); border: 1px solid rgba(66, 153, 225, 0.3); border-radius: 6px; user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
						<span class="mr-2" style="transition: transform 0.2s; font-size: 0.9em;">\u25b6</span>
						<span class="ve-bold" style="color: var(--rgb-name-blue);">\ud83c\udfaf ${Parser.sourceJsonToAbv(classSource)} ${subclassTitle}s</span>
						<span class="badge badge-primary ml-auto" style="font-size: 0.75em;">${filteredPrimary.length}</span>
					</div>
				`});
				const primaryContent = e_({outer: `<div class="mb-3 pl-2" style="border-left: 3px solid rgba(66, 153, 225, 0.3);"></div>`});
				filteredPrimary.forEach((/** @type {*} */ sc) => primaryContent.append(renderSubclassItem(sc)));

				primaryHeader.addEventListener("click", () => {
					primaryCollapsed = !primaryCollapsed;
					primaryHeader.querySelector("span").style.transform = primaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
					primaryContent.style.display = primaryCollapsed ? "none" : "";
				});

				// Apply initial state
				primaryHeader.querySelector("span").style.transform = primaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
				primaryContent.style.display = primaryCollapsed ? "none" : "";

				list.append(primaryHeader, primaryContent);
			}

			// Secondary subclasses
			if (filteredSecondary.length > 0) {
				const secondaryHeader = e_({outer: `
					<div class="ve-flex-v-center py-2 px-3 mb-2 clickable" 
						style="background: linear-gradient(135deg, rgba(128, 128, 128, 0.1) 0%, rgba(128, 128, 128, 0.03) 100%); border: 1px solid rgba(128, 128, 128, 0.2); border-radius: 6px; user-select: none;">
						<span class="mr-2" style="transition: transform 0.2s; font-size: 0.9em;">\u25b6</span>
						<span class="ve-bold ve-muted">\ud83d\udcda Other ${subclassTitle}s</span>
						<span class="badge badge-secondary ml-auto" style="font-size: 0.75em;">${filteredSecondary.length}</span>
					</div>
				`});
				const secondaryContent = e_({outer: `<div class="mb-2 pl-2" style="border-left: 3px solid rgba(128, 128, 128, 0.2);"></div>`});
				filteredSecondary.forEach((/** @type {*} */ sc) => secondaryContent.append(renderSubclassItem(sc)));

				secondaryHeader.addEventListener("click", () => {
					secondaryCollapsed = !secondaryCollapsed;
					secondaryHeader.querySelector("span").style.transform = secondaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
					secondaryContent.style.display = secondaryCollapsed ? "none" : "";
				});

				// Apply initial state
				secondaryHeader.querySelector("span").style.transform = secondaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
				secondaryContent.style.display = secondaryCollapsed ? "none" : "";

				list.append(secondaryHeader, secondaryContent);
			}
		};

		if (searchInput) {
			searchInput.addEventListener("input", () => {
				textFilter = searchInput.value;
				renderList();
			});
		}
		if (sourceFilter) {
			sourceFilter.addEventListener("change", () => {
				selectedSource = sourceFilter.value;
				renderList();
			});
		}

		if (filterRow) container.append(filterRow);
		renderList();
		container.append(list);

		return container;
	}

	/**
	 * Render compact ASI selection for wizard layout
	 */
	/**
	 * @param {*} onAsiChange
	 * @param {*} onFeatSelect
	 * @param {*} isBothAsiAndFeat
	 * @param {*} isEpicBoonLevel
	 */
	_renderAsiSelectionCompact (/** @type {*} */ onAsiChange, /** @type {*} */ onFeatSelect, /** @type {*} */ isBothAsiAndFeat, /** @type {*} */ isEpicBoonLevel) {
		const fullSection = this._renderAsiSelection(onAsiChange, onFeatSelect, isBothAsiAndFeat, isEpicBoonLevel);
		const wrapper = e_({outer: `<div class="charsheet__levelup-asi-compact"></div>`});
		[...fullSection.children].forEach((/** @type {*} */ child) => wrapper.append(child));
		return wrapper;
	}

	/**
	 * Render compact features list for wizard layout with hover links
	 */
	/**
	 * @param {*} features
	 */
	_renderFeaturesCompact (/** @type {*} */ features) {
		const container = e_({outer: `<div class="charsheet__levelup-features"></div>`});

		features.forEach((/** @type {*} */ feature) => {
			const featureEl = e_({outer: `
				<div class="charsheet__levelup-feature">
					<div class="charsheet__levelup-feature-header"></div>
					${feature.description ? `<div class="charsheet__levelup-feature-description">${feature.description.substring(0, 150)}${feature.description.length > 150 ? "..." : ""}</div>` : ""}
				</div>
			`});

			// Add feature name with hover link
			const header = featureEl.querySelector(".charsheet__levelup-feature-header");
			try {
				if (this._page?.getHoverLink && feature.source && feature.className) {
					// Use same logic as features tab for proper source handling
					const storedClass = this._state.getClasses().find((/** @type {*} */ c) => c.name?.toLowerCase() === feature.className?.toLowerCase());

					// Check if feature.source looks like a class source (official sources like PHB, XPHB)
					const officialClassSources = [Parser.SRC_PHB, Parser.SRC_XPHB, "PHB", "XPHB", "TCE", "XGE", "TGTT"];
					const isOfficialSource = (/** @type {*} */ src) => officialClassSources.includes(src?.toUpperCase?.() || src);

					let actualClassSource = feature.classSource;
					// If classSource is not set or is a homebrew source but feature.source is official, use feature.source
					if (!actualClassSource || (!isOfficialSource(actualClassSource) && isOfficialSource(feature.source))) {
						actualClassSource = feature.source;
					}
					// Final fallback to stored class or XPHB
					if (!actualClassSource) {
						actualClassSource = storedClass?.source || Parser.SRC_XPHB;
					}

					/** @type {*} */

					const hashInput = {
						name: feature.name,
						className: feature.className,
						classSource: actualClassSource,
						level: feature.level || 1,
						source: feature.source,
					};

					// Add subclass info if this is a subclass feature
					if (feature.subclassName || feature.isSubclassFeature) {
						hashInput.subclassShortName = feature.subclassShortName || feature.subclassName;
						hashInput.subclassSource = feature.subclassSource || storedClass?.subclass?.source || feature.source;
					}

					const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES](hashInput);

					// For subclass features, use subclassSource; for class features, use classSource
					const hoverSource = hashInput.subclassSource || hashInput.classSource;
					const classHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name: feature.className, source: actualClassSource});
					const classHref = `${UrlUtil.PG_CLASSES}#${classHash}`;
					const hoverLink = this._page.getHoverLink(
						UrlUtil.PG_CLASS_SUBCLASS_FEATURES,
						feature.name,
						hoverSource,
						hash,
						/** @type {*} */ (null),
						classHref,
					);
					header.innerHTML = hoverLink;
				} else if (this._page?.getHoverLink && feature.featureType) {
					// Optional feature
					const isCM = CharacterSheetClassUtils.isCombatMethod(feature);
					const hoverLink = this._page.getHoverLink(
						isCM ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES,
						feature.name,
						feature.source || Parser.SRC_XPHB,
					);
					header.innerHTML = hoverLink;
				} else {
					header.textContent = feature.name;
				}
			} catch (e) {
				header.textContent = feature.name;
			}

			container.append(featureEl);
		});

		return container;
	}

	/**

	 * @param {*} classData

	 * @param {*} onSelect

	 */

	_renderSubclassSelection (/** @type {*} */ classData, /** @type {*} */ onSelect) {
		const subclasses = classData.subclasses || [];

		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					📚 Choose ${classData.subclassTitle || "Subclass"}
				</h5>
				<div class="charsheet__levelup-subclasses"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-subclasses");

		subclasses.forEach((/** @type {*} */ subclass) => {
			const option = e_({outer: `
				<div class="charsheet__levelup-option" data-subclass="${subclass.name}">
					<div class="charsheet__levelup-option-header">
						<input type="radio" name="subclass-choice" value="${subclass.name}">
						<strong>${subclass.name}</strong>
						<span class="ve-muted">(${Parser.sourceJsonToAbv(subclass.source)})</span>
					</div>
					<div class="charsheet__levelup-option-description ve-small ve-muted">
						${subclass.shortName || ""}
					</div>
				</div>
			`});

			option.addEventListener("click", () => {
				container.querySelectorAll(".charsheet__levelup-option").forEach((/** @type {*} */ el) => el.classList.remove("selected"));
				option.classList.add("selected");
				option.querySelector("input").checked = true;
				onSelect(subclass);
			});

			container.append(option);
		});

		return section;
	}

	/**

	 * @param {*} onAsiChange

	 * @param {*} onFeatSelect

	 * @param {*} isBothAsiAndFeat

	 * @param {*} isEpicBoonLevel

	 */

	_renderAsiSelection (/** @type {*} */ onAsiChange, /** @type {*} */ onFeatSelect, /** @type {*} */ isBothAsiAndFeat = false, /** @type {*} */ isEpicBoonLevel = false) {
		// When Thelemar rules give both ASI and Feat at level 4
		const sectionTitle = isEpicBoonLevel
			? "📈 Ability Score Improvement / Epic Boon"
			: isBothAsiAndFeat
				? "📈 Ability Score Improvement + Feat (Thelemar)"
				: "📈 Ability Score Improvement";

		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					${sectionTitle}
				</h5>
				${isBothAsiAndFeat ? `
					<div class="alert alert-info ve-small mb-3">
						<strong>🌍 Thelemar Rule:</strong> At level 4, you gain both an ASI <em>and</em> a feat!
					</div>
				` : `
					<div class="charsheet__levelup-asi-choice mb-3">
						<label class="ve-flex-v-center mr-3">
							<input type="radio" name="asi-type" value="asi" checked class="mr-1">
							<span>Increase Ability Scores (+2 total)</span>
						</label>
						<label class="ve-flex-v-center">
							<input type="radio" name="asi-type" value="feat" class="mr-1">
							<span>Take a Feat</span>
						</label>
					</div>
				`}
				<div id="asi-abilities-container"></div>
				<div id="asi-feats-container" style="${isBothAsiAndFeat ? "" : "display: none;"}"></div>
			</div>
		`});

		const abilitiesContainer = section.querySelector("#asi-abilities-container");
		const featsContainer = section.querySelector("#asi-feats-container");

		// Toggle between ASI and Feat (only if not both)
		if (!isBothAsiAndFeat) {
			section.querySelectorAll("input[name=\"asi-type\"]").forEach((/** @type {*} */ radio) => radio.addEventListener("change", (/** @type {*} */ e) => {
				if (e.target.value === "asi") {
					abilitiesContainer.style.display = "";
					featsContainer.style.display = "none";
					onFeatSelect(null);
				} else {
					abilitiesContainer.style.display = "none";
					featsContainer.style.display = "";
				}
			}));
		}

		// Add section labels when both are shown
		if (isBothAsiAndFeat) {
			abilitiesContainer.insertAdjacentHTML("afterbegin", `<h6 class="ve-bold mb-2">📊 Ability Score Increase (+2 points)</h6>`);
			featsContainer.insertAdjacentHTML("afterbegin", `<h6 class="ve-bold mb-2 mt-3">🎭 Select a Feat</h6>`);
		}

		// Ability score selectors
		let pointsRemaining = 2;
		const asiValues = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};

		// Shared state for ASI↔Feat score synchronization (isBothAsiAndFeat mode)
		/** @type {*} */ let _currentSelectedFeat = null;
		/** @type {*} */ let _currentFeatChoices = null; // reference to getFeatChoices() result for current feat

		/**
		 * Compute effective scores including pending ASI and feat ability choices at this level.
		 * Used to keep both sections in sync when isBothAsiAndFeat is true.
		 */
		const _computePendingScores = () => {
			const scores = {};
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				let score = this._state.getAbilityScore(abl) + ((/** @type {*} */ (asiValues))[abl] || 0);
				if (_currentSelectedFeat?._featChoices?.ability === abl && _currentFeatChoices?.ability) {
					score += _currentFeatChoices.ability.amount || 1;
				}
				(/** @type {*} */ (scores))[abl] = Math.min(20, score);
			});
			return scores;
		};

		/**
		 * Update ASI grid "new score" displays to reflect feat ability choice contributions.
		 */
		const _refreshAsiDisplays = () => {
			if (!isBothAsiAndFeat) return;
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				const baseScore = this._state.getAbilityScore(abl);
				let featBonus = 0;
				if (_currentSelectedFeat?._featChoices?.ability === abl && _currentFeatChoices?.ability) {
					featBonus = _currentFeatChoices.ability.amount || 1;
				}
				const newScore = Math.min(20, baseScore + ((/** @type {*} */ (asiValues))[abl] || 0) + featBonus);
				const newEl = abilitiesContainer.querySelector(`#asi-new-${abl}`);
				if (newEl) newEl.textContent = newScore;
			});
		};

		/**
		 * Re-render feat ability choice buttons with current pending scores.
		 * Called when ASI values change to update the score display in feat ability buttons.
		 */
		const _refreshFeatAbilityChoices = () => {
			if (!isBothAsiAndFeat) return;
			if (!_currentSelectedFeat || !_currentFeatChoices?.ability) return;

			const abilityContainer = featsContainer.querySelector(".charsheet__levelup-feat-ability-choices");
			if (!abilityContainer) return;

			// Compute scores with ASI pending (but not feat choice, since we're showing "before feat" scores)
			const pendingScores = {};
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				(/** @type {*} */ (pendingScores))[abl] = this._state.getAbilityScore(abl) + ((/** @type {*} */ (asiValues))[abl] || 0);
			});

			this._renderFeatAbilityButtons(
				_currentSelectedFeat,
				_currentFeatChoices.ability,
				abilityContainer,
				() => { _refreshAsiDisplays(); },
				pendingScores,
			);
		};

		const updatePointsDisplay = () => {
			abilitiesContainer.querySelector(".asi-points-remaining").textContent = pointsRemaining;
		};

		const abilitiesGrid = e_({outer: `
			<div class="charsheet__levelup-asi-grid">
				<div class="ve-text-center mb-2">Points remaining: <strong class="asi-points-remaining">${pointsRemaining}</strong></div>
			</div>
		`});

		Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
			const currentScore = this._state.getAbilityScore(abl);

			const row = e_({outer: `
				<div class="charsheet__levelup-asi-row">
					<span class="charsheet__levelup-asi-name">${Parser.attAbvToFull(abl)}</span>
					<span class="charsheet__levelup-asi-current">${currentScore}</span>
					<button class="ve-btn ve-btn-xs ve-btn-default asi-minus" data-ability="${abl}">−</button>
					<span class="charsheet__levelup-asi-bonus" id="asi-bonus-${abl}">+0</span>
					<button class="ve-btn ve-btn-xs ve-btn-default asi-plus" data-ability="${abl}">+</button>
					<span class="charsheet__levelup-asi-new" id="asi-new-${abl}">${currentScore}</span>
				</div>
			`});

			row.querySelector(".asi-minus").addEventListener("click", () => {
				if ((/** @type {*} */ (asiValues))[abl] <= 0) return;
				(/** @type {*} */ (asiValues))[abl]--;
				pointsRemaining++;
				row.querySelector(`#asi-bonus-${abl}`).textContent = (/** @type {*} */ (asiValues))[abl] > 0 ? `+${(/** @type {*} */ (asiValues))[abl]}` : "+0";
				row.querySelector(`#asi-new-${abl}`).textContent = currentScore + (/** @type {*} */ (asiValues))[abl];
				updatePointsDisplay();
				onAsiChange(abl, -1);
				_refreshFeatAbilityChoices();
				_refreshAsiDisplays();
			});

			row.querySelector(".asi-plus").addEventListener("click", () => {
				if (pointsRemaining <= 0) return;
				if ((/** @type {*} */ (asiValues))[abl] >= 2) return; // Max +2 per ability
				if (currentScore + (/** @type {*} */ (asiValues))[abl] >= 20) return; // Cap at 20
				(/** @type {*} */ (asiValues))[abl]++;
				pointsRemaining--;
				row.querySelector(`#asi-bonus-${abl}`).textContent = `+${(/** @type {*} */ (asiValues))[abl]}`;
				row.querySelector(`#asi-new-${abl}`).textContent = currentScore + (/** @type {*} */ (asiValues))[abl];
				updatePointsDisplay();
				onAsiChange(abl, 1);
				_refreshFeatAbilityChoices();
				_refreshAsiDisplays();
			});

			abilitiesGrid.append(row);
		});

		abilitiesContainer.append(abilitiesGrid);

		// Feats list - filtered by allowed sources
		const feats = this._page.filterByAllowedSources(this._page.getFeats() || []);

		// === Epic Boon section (level 19 for XPHB / TGTT classes) ===
		if (isEpicBoonLevel) {
			const epicBoons = feats.filter((/** @type {*} */ f) => f.category === "EB");
			if (epicBoons.length) {
				const epicSection = e_({outer: `<div class="charsheet__levelup-epic-boons mb-3">
					<h6 class="ve-bold mb-2">🌟 Epic Boons <span class="ve-muted ve-small">(Recommended at level 19)</span></h6>
				</div>`});

				const epicList = e_({outer: `<div class="charsheet__levelup-feats-list" style="max-height: 200px; overflow-y: auto;"></div>`});

				epicBoons.forEach((/** @type {*} */ boon) => {
					// Ability bonus description
					let abilityHint = "";
					if (boon.ability?.length) {
						const ab = boon.ability[0];
						if (ab.choose) {
							abilityHint = ` — +1 to ${ab.choose.from?.map((/** @type {*} */ a) => a.toUpperCase()).join("/") || "ability"} (max ${ab.max || 30})`;
						} else {
							const entries = Object.entries(ab).filter(([k]) => Parser.ABIL_ABVS.includes(k));
							if (entries.length) {
								abilityHint = ` — +${entries[0][1]} ${entries[0][0].toUpperCase()}`;
							}
						}
					}

					// Detect choices (same logic as regular feats)
					const boonChoices = getFeatChoices(boon);
					const hasChoices = boonChoices.skills || boonChoices.languages || boonChoices.ability || boonChoices.tools || boonChoices.expertise || boonChoices.spells;

					const boonEl = e_({outer: `
						<div class="charsheet__levelup-feat-option" data-feat="${boon.name}">
							<input type="radio" name="feat-choice" value="${boon.name}">
							<span class="ve-muted">(${Parser.sourceJsonToAbv(boon.source)})</span>
							${hasChoices ? ` <span class="badge badge-info ml-1" style="font-size: 0.65rem;">has choices</span>` : ""}
							${abilityHint ? `<span class="ve-small text-info">${abilityHint}</span>` : ""}
						</div>
					`});

					// Add hoverable name link (same pattern as regular feats)
					const boonLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_FEATS, boon.name, boon.source);
					const boonNameEl = e_({outer: `<strong></strong>`});
					if (typeof boonLink === "string") boonNameEl.innerHTML = boonLink;
					else boonNameEl.append(boonLink);
					boonEl.querySelector("input").after(boonNameEl);

					boonEl.addEventListener("click", () => {
						// Deselect from both lists
						featsContainer.querySelectorAll(".charsheet__levelup-feat-option").forEach((/** @type {*} */ el) => el.classList.remove("selected"));
						boonEl.classList.add("selected");
						boonEl.querySelector("input").checked = true;

						// Track current feat for ASI↔Feat sync
						_currentSelectedFeat = boon;
						_currentFeatChoices = boonChoices;

						onFeatSelect(boon);

						// Show ability choice UI if boon has choose
						this._renderEpicBoonAbilityChoice(boon, epicSection);

						// Show additional choices UI if boon has skill/spell/tool choices
						if (hasChoices) {
							if (!boon._featChoices) {
								boon._featChoices = {skills: [], languages: [], ability: null, tools: [], expertise: [], spellList: null, cantrips: [], spells: []};
							}
							this._renderFeatChoicesUI(boon, boonChoices, featChoicesContainer, () => { _refreshAsiDisplays(); });
							if (featChoicesContainer.children.length) featChoicesContainer.scrollIntoView({behavior: "smooth", block: "nearest"});
						}
						_refreshAsiDisplays();
					});

					epicList.append(boonEl);
				});

				epicSection.append(epicList);
				featsContainer.append(epicSection);
				featsContainer.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center mb-2">— or choose another feat —</div>`);
			}
		}

		const featSearch = e_({outer: `<input type="text" class="ve-form-control mb-2" placeholder="Search feats...">`});
		const featList = e_({outer: `<div class="charsheet__levelup-feats-list"></div>`});
		const featChoicesContainer = e_({outer: `<div class="charsheet__levelup-feat-choices"></div>`});

		// Helper to detect if feat has choices.
		// Declared as a `function` (not `const` arrow) so it is hoisted
		// to the top of `_renderAsiSelection` — the Epic Boon section
		// (rendered earlier in the function body) needs to call it.
		function getFeatChoices (/** @type {*} */ feat) {
			/** @type {*} */ const choices = {skills: null, languages: null, tools: null, ability: null, expertise: null, spells: null};

			if (feat.skillProficiencies) {
				for (const sp of feat.skillProficiencies) {
					if (sp.choose) {
						choices.skills = {count: sp.choose.count || 1, from: sp.choose.from || Object.keys(Parser.SKILL_TO_ATB_ABV)};
						break;
					}
					if (sp.any) {
						choices.skills = {count: sp.any, from: Object.keys(Parser.SKILL_TO_ATB_ABV)};
						break;
					}
				}
			}

			if (feat.languageProficiencies) {
				for (const lp of feat.languageProficiencies) {
					if (lp.anyStandard) {
						choices.languages = {count: lp.anyStandard, type: "standard"};
						break;
					}
					if (lp.any) {
						choices.languages = {count: lp.any, type: "any"};
						break;
					}
				}
			}

			// Tool proficiency choices
			if (feat.toolProficiencies) {
				for (const tp of feat.toolProficiencies) {
					if (tp.anyArtisansTool && tp.anyMusicalInstrument) {
						// Combined: choose artisan OR instrument (not yet handled — treat as artisan for now)
						choices.tools = {count: tp.anyArtisansTool, type: "artisanOrInstrument"};
						break;
					}
					if (tp.anyArtisansTool) {
						choices.tools = {count: tp.anyArtisansTool, type: "artisan"};
						break;
					}
					if (tp.anyMusicalInstrument) {
						choices.tools = {count: tp.anyMusicalInstrument, type: "instrument"};
						break;
					}
					if (tp.any) {
						choices.tools = {count: tp.any, type: "any"};
						break;
					}
					if (tp.choose) {
						choices.tools = {count: tp.choose.count || 1, from: tp.choose.from || []};
						break;
					}
				}

				// Check for artisan+instrument combo across separate entries (Monk data format)
				if (!choices.tools) {
					const hasArtisan = (/** @type {*} */ toolProfs) => toolProfs.some((/** @type {*} */ tp) => tp.anyArtisansTool);
					const hasInstrument = (/** @type {*} */ toolProfs) => toolProfs.some((/** @type {*} */ tp) => tp.anyMusicalInstrument);
					if (hasArtisan(feat.toolProficiencies) && hasInstrument(feat.toolProficiencies)) {
						choices.tools = {count: 1, type: "artisanOrInstrument"};
					}
				}
			}

			// Expertise choices
			if (feat.expertise) {
				for (const exp of feat.expertise) {
					if (exp.anyProficientSkill) {
						choices.expertise = {count: exp.anyProficientSkill, type: "proficient"};
						break;
					}
					if (exp.choose) {
						choices.expertise = {count: exp.choose.count || 1, from: exp.choose.from || []};
						break;
					}
				}
			}

			if (feat.ability) {
				for (const ab of feat.ability) {
					if (ab.choose) {
						choices.ability = {count: ab.choose.count || 1, amount: ab.choose.amount || 1, from: ab.choose.from || Parser.ABIL_ABVS};
						break;
					}
				}
			}

			// Spell choices from additionalSpells
			if (feat.additionalSpells) {
				/** @type {*} */ const spellChoices = {cantrips: null, spells: null, list: null};

				for (const addSpells of feat.additionalSpells) {
					// Check for list-based spells (Magic Initiate style)
					if (addSpells.name && addSpells.ability) {
						spellChoices.list = {
							name: addSpells.name,
							ability: addSpells.ability,
						};
					}

					// Parse innate/known/prepared for choices
					const parseSpellBlock = (/** @type {*} */ block, /** @type {*} */ target) => {
						if (!block) return;
						for (const [key, val] of Object.entries(block)) {
							if (key === "_" || key === "daily" || key === "rest") {
								const spells = key === "_" ? val : (val["1e"] || val["1"] || Object.values(val)[0] || []);
								if (Array.isArray(spells)) {
									for (const spell of spells) {
										if (typeof spell === "object" && spell.choose && typeof spell.choose === "string") {
											const filter = spell.choose;
											const count = spell.count || 1;
											const maxLevel = filter.match(/level=(\d+)/)?.[1];
											if (maxLevel === "0" || filter.includes("level=0")) {
												spellChoices.cantrips = {count, filter};
											} else {
												spellChoices.spells = {
													count,
													filter,
													innate: target === "innate",
													daily: key === "daily" ? "1" : null,
												};
											}
										}
									}
								}
							}
						}
					};

					parseSpellBlock(addSpells.innate, "innate");
					parseSpellBlock(addSpells.known, "known");
					parseSpellBlock(addSpells.prepared, "prepared");
				}

				if (spellChoices.cantrips || spellChoices.spells || spellChoices.list) {
					choices.spells = spellChoices;
				}
			}

			return choices;
		}

		const renderFeats = (filter = "") => {
			featList.innerHTML = "";
			featChoicesContainer.innerHTML = "";
			const filteredFeats = feats.filter((/** @type {*} */ f) =>
				f.name.toLowerCase().includes(filter.toLowerCase()),
			).slice(0, 50);

			filteredFeats.forEach((/** @type {*} */ feat) => {
				const choices = getFeatChoices(feat);
				const hasChoices = choices.skills || choices.languages || choices.ability || choices.tools || choices.expertise || choices.spells;

				const featEl = e_({outer: `<div class="charsheet__levelup-feat-option" data-feat="${feat.name}"></div>`});
				featEl.insertAdjacentHTML("beforeend", `<input type="radio" name="feat-choice" value="${feat.name}">`);
				const featLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_FEATS, feat.name, feat.source);
				const featNameEl = e_({outer: `<strong></strong>`});
				if (typeof featLink === "string") featNameEl.innerHTML = featLink;
				else featNameEl.append(featLink);
				featEl.append(featNameEl);
				featEl.insertAdjacentHTML("beforeend", ` <span class="ve-muted">(${Parser.sourceJsonToAbv(feat.source)})</span>`);
				if (feat.category) {
					const categoryFull = Parser.featCategoryToFull?.(feat.category) || feat.category;
					featEl.insertAdjacentHTML("beforeend", ` <span class="badge badge-secondary ml-1" style="font-size: 0.6rem;">${categoryFull}</span>`);
				}
				if (hasChoices) featEl.insertAdjacentHTML("beforeend", ` <span class="badge badge-info ml-1" style="font-size: 0.65rem;">has choices</span>`);

				featEl.addEventListener("click", () => {
					// Deselect from all feat lists (including epic boons)
					featsContainer.querySelectorAll(".charsheet__levelup-feat-option").forEach((/** @type {*} */ el) => el.classList.remove("selected"));
					featEl.classList.add("selected");
					featEl.querySelector("input").checked = true;

					// Initialize feat choices storage
					if (!feat._featChoices) {
						feat._featChoices = {skills: [], languages: [], ability: null, tools: [], expertise: [], spellList: null, cantrips: [], spells: [], scribingClass: null};
					}

					// Track current feat for ASI↔Feat sync
					_currentSelectedFeat = feat;
					_currentFeatChoices = choices;

					// Render feat choices UI if needed
					this._renderFeatChoicesUI(feat, choices, featChoicesContainer, () => { _refreshAsiDisplays(); });
					if (featChoicesContainer.children.length) featChoicesContainer.scrollIntoView({behavior: "smooth", block: "nearest"});

					onFeatSelect(feat);
					_refreshAsiDisplays();
				});

				featList.append(featEl);
			});
		};

		featSearch.addEventListener("input", (/** @type {*} */ e) => renderFeats(e.target.value));
		renderFeats();

		featsContainer.append(featSearch, featList, featChoicesContainer);

		return section;
	}

	/**
	 * Render ability score choice UI for Epic Boons with { choose: { from: [...] } }
	 */
	_renderEpicBoonAbilityChoice (/** @type {*} */ boon, /** @type {*} */ parentSection) {
		// Remove any existing ability choice UI
		parentSection.querySelector(".charsheet__epic-boon-ability-choice")?.remove();

		if (!boon.ability?.length) return;

		const ablEntry = boon.ability[0];
		if (!ablEntry.choose) return;

		const options = ablEntry.choose.from || Parser.ABIL_ABVS;
		const amount = ablEntry.choose.amount || 1;
		const max = ablEntry.max || 20;

		const choiceContainer = e_({outer: `<div class="charsheet__epic-boon-ability-choice mt-2 p-2 rounded" style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
			<span class="ve-small ve-bold">Choose ability to increase by +${amount} (max ${max}):</span>
		</div>`});

		const select = e_({outer: `<select class="ve-form-control ve-input-sm mt-1" style="max-width: 200px;"></select>`});
		options.forEach((/** @type {*} */ abl) => {
			const currentScore = this._state.getAbilityScore(abl);
			select.insertAdjacentHTML("beforeend", `<option value="${abl}">${Parser.attAbvToFull(abl)} (currently ${currentScore})</option>`);
		});

		// Store the choice on the boon object so _applyFeatBonuses can use it
		boon._epicBoonAbilityChoice = {ability: options[0], amount, max};
		select.addEventListener("change", (/** @type {*} */ e) => {
			boon._epicBoonAbilityChoice = {ability: e.target.value, amount, max};
		});

		choiceContainer.append(select);
		parentSection.append(choiceContainer);
	}

	/**
	 * Render (or re-render) the feat ability choice buttons into a container.
	 * Extracted to allow ASI↔Feat score synchronization — when ASI values change,
	 * this is called again to update the displayed scores in the buttons.
	 * @param {*} feat - The feat object (must have _featChoices initialized)
	 * @param {*} abilityChoiceSpec - {count, amount, from} from getFeatChoices()
	 * @param {HTMLElement} container - The container element (will have buttons replaced, label preserved)
	 * @param {Function} [onAbilityChange] - Callback fired when selection changes
	 * @param {*} [pendingScores] - Optional pre-computed scores (for QuickBuild running scores)
	 */
	_renderFeatAbilityButtons (/** @type {*} */ feat, /** @type {*} */ abilityChoiceSpec, /** @type {*} */ container, /** @type {*} */ onAbilityChange = null, /** @type {*} */ pendingScores = null) {
		// Remove existing button grid if re-rendering, but preserve the label
		container.querySelector(".charsheet__feat-ability-grid")?.remove();

		const abilityGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1 charsheet__feat-ability-grid"></div>`});

		abilityChoiceSpec.from.forEach((/** @type {*} */ abl) => {
			const isSelected = feat._featChoices.ability === abl;
			const currentScore = pendingScores ? (/** @type {*} */ (pendingScores))[abl] : this._state.getAbilityScore(abl);
			const newScore = Math.min(20, currentScore + (abilityChoiceSpec.amount || 1));

			const btn = e_({outer: `
				<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}">
					${Parser.attAbvToFull(abl)} (${currentScore} → ${newScore})
				</button>
			`});

			btn.addEventListener("click", () => {
				feat._featChoices.ability = isSelected ? null : abl;
				abilityGrid.querySelectorAll(".ve-btn").forEach((/** @type {*} */ el) => { el.classList.remove("ve-btn-primary"); el.classList.add("ve-btn-default"); });
				if (!isSelected) { btn.classList.remove("ve-btn-default"); btn.classList.add("ve-btn-primary"); }
				if (onAbilityChange) onAbilityChange();
			});
			abilityGrid.append(btn);
		});

		container.append(abilityGrid);
	}

	/**
	 * Render feat choices UI for feats with skill/language/ability/tool/expertise/spell selections.
	 * @param {Function} [onAbilityChange] - Optional callback fired when a feat ability score choice changes.
	 *   Used by ASI↔Feat sync to update the ASI grid display.
	 */
	_renderFeatChoicesUI (/** @type {*} */ feat, /** @type {*} */ choices, /** @type {*} */ container, /** @type {*} */ onAbilityChange = null) {
		container.innerHTML = "";

		const hasChoices = choices.skills || choices.languages || choices.ability || choices.tools || choices.expertise || choices.spells;
		if (!hasChoices) return;

		container.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold mb-2 mt-2">Additional Choices for ${feat.name}:</div>`);

		// Spell list choice (for Magic Initiate-style feats)
		if (choices.spells?.list) {
			const listSection = e_({outer: `<div class="mb-2"></div>`});
			listSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose spell list:</label>`);
			const select = e_({outer: `<select class="ve-form-control ve-input-sm mt-1"></select>`});

			const spellLists = ["Arcane", "Divine", "Primal"];
			spellLists.forEach((/** @type {*} */ list) => {
				const isSelected = feat._featChoices.spellList === list;
				select.insertAdjacentHTML("beforeend", `<option value="${list}" ${isSelected ? "selected" : ""}>${list}</option>`);
			});

			select.addEventListener("change", () => {
				feat._featChoices.spellList = select.value;
			});
			if (!feat._featChoices.spellList) {
				feat._featChoices.spellList = spellLists[0];
			}

			listSection.append(select);
			container.append(listSection);
		}

		// Skill choices
		if (choices.skills) {
			const skillSection = e_({outer: `<div class="mb-2"></div>`});
			skillSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.skills.count} skill${choices.skills.count > 1 ? "s" : ""}:</label>`);
			const skillGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			const availableSkills = choices.skills.from.map((/** @type {*} */ s) => s.toLowerCase().replace(/\s+/g, ""));
			const existingSkills = new Set(Object.keys(this._state.getSkillProficiencies?.() || {}).map((/** @type {*} */ s) => s.toLowerCase()));

			const renderSkills = () => {
				skillGrid.innerHTML = "";
				availableSkills.forEach((/** @type {*} */ skill) => {
					const isKnown = existingSkills.has(skill);
					const isSelected = feat._featChoices.skills.includes(skill);
					const displayName = skill.replace(/([A-Z])/g, " $1").trim().toTitleCase();

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
							${isKnown ? "disabled title=\"Already proficient\"" : ""}
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${displayName}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								feat._featChoices.skills = feat._featChoices.skills.filter((/** @type {*} */ s) => s !== skill);
							} else if (feat._featChoices.skills.length < choices.skills.count) {
								feat._featChoices.skills.push(skill);
							}
							renderSkills();
						});
					}
					skillGrid.append(btn);
				});
				skillSection.querySelector(".skill-count").textContent = `${feat._featChoices.skills.length}/${choices.skills.count}`;
			};

			skillSection.append(skillGrid);
			skillSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="skill-count">${feat._featChoices.skills.length}/${choices.skills.count}</span></div>`);
			renderSkills();
			container.append(skillSection);
		}

		// Tool proficiency choices
		if (choices.tools) {
			const toolSection = e_({outer: `<div class="mb-2"></div>`});
			toolSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.tools.count} tool${choices.tools.count > 1 ? "s" : ""}:</label>`);
			const toolGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			// Get tool list - artisan tools, instruments, combined, or from specified list
			let availableTools = [];
			const artisanToolsFallback = ["Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools", "Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies", "Potter's Tools", "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"];
			const musicalInstrumentsFallback = ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan Flute", "Shawm", "Viol"];

			if (choices.tools.type === "artisan") {
				const allTools = this._page.getToolsList() || [];
				availableTools = allTools.filter((/** @type {*} */ t) => t.toolType === "artisan" || (t.name || "").toLowerCase().includes("artisan") || (t.name || "").toLowerCase().includes("tools"));
				if (availableTools.length === 0) {
					availableTools = artisanToolsFallback.map((/** @type {*} */ n) => ({name: n}));
				}
			} else if (choices.tools.type === "instrument") {
				const allTools = this._page.getToolsList() || [];
				availableTools = allTools.filter((/** @type {*} */ t) => t.toolType === "instrument" || (t.name || "").toLowerCase().includes("instrument"));
				if (availableTools.length === 0) {
					availableTools = musicalInstrumentsFallback.map((/** @type {*} */ n) => ({name: n}));
				}
			} else if (choices.tools.type === "artisanOrInstrument") {
				// Combined: both artisan tools and musical instruments
				const allTools = this._page.getToolsList() || [];
				const artisanTools = allTools.filter((/** @type {*} */ t) => t.toolType === "artisan" || (t.name || "").toLowerCase().includes("tools"));
				const instruments = allTools.filter((/** @type {*} */ t) => t.toolType === "instrument" || (t.name || "").toLowerCase().includes("instrument"));
				const artisanList = artisanTools.length > 0 ? artisanTools : artisanToolsFallback.map((/** @type {*} */ n) => ({name: n}));
				const instrumentList = instruments.length > 0 ? instruments : musicalInstrumentsFallback.map((/** @type {*} */ n) => ({name: n}));
				availableTools = [...artisanList, ...instrumentList];
			} else if (choices.tools.from?.length) {
				availableTools = choices.tools.from.map((/** @type {*} */ t) => ({name: t}));
			}

			const existingTools = new Set((this._state.getToolProficiencies?.() || []).map((/** @type {*} */ t) => (typeof t === "string" ? t : t.name || "").toLowerCase()));

			const renderTools = () => {
				toolGrid.innerHTML = "";
				availableTools.forEach((/** @type {*} */ tool) => {
					const toolName = typeof tool === "string" ? tool : tool.name;
					const isKnown = existingTools.has(toolName.toLowerCase());
					const isSelected = feat._featChoices.tools.includes(toolName);

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
							${isKnown ? "disabled title=\"Already proficient\"" : ""}
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${toolName}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								feat._featChoices.tools = feat._featChoices.tools.filter((/** @type {*} */ t) => t !== toolName);
							} else if (feat._featChoices.tools.length < choices.tools.count) {
								feat._featChoices.tools.push(toolName);
							}
							renderTools();
						});
					}
					toolGrid.append(btn);
				});
				toolSection.querySelector(".tool-count").textContent = `${feat._featChoices.tools.length}/${choices.tools.count}`;
			};

			toolSection.append(toolGrid);
			toolSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="tool-count">${feat._featChoices.tools.length}/${choices.tools.count}</span></div>`);
			renderTools();
			container.append(toolSection);
		}

		// Expertise choices
		if (choices.expertise) {
			const expertiseSection = e_({outer: `<div class="mb-2"></div>`});
			expertiseSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.expertise.count} skill${choices.expertise.count > 1 ? "s" : ""} for expertise:</label>`);
			const expertiseGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			// Get proficient skills that don't already have expertise
			const existingProf = Object.keys(this._state.getSkillProficiencies?.() || {});
			const existingExpertise = new Set((this._state.getExpertise?.() || []).map((/** @type {*} */ e) => e.toLowerCase()));
			const availableForExpertise = existingProf.filter((/** @type {*} */ s) => !existingExpertise.has(s.toLowerCase()));

			// Also include skills being added by this feat
			const newFeatSkills = feat._featChoices.skills || [];
			// Include fixed skill proficiencies from the feat itself (e.g., Boon of Skill grants all 18 skills)
			// feat.skillProficiencies is an array of objects like [{athletics: true, acrobatics: true, ...}]
			const fixedFeatSkills = (feat.skillProficiencies || []).flatMap((/** @type {*} */ sp) =>
				Object.entries(sp)
					.filter(([k, v]) => v === true && k !== "choose" && k !== "any")
					.map(([s]) => s.toLowerCase()),
			);

			const renderExpertise = () => {
				expertiseGrid.innerHTML = "";
				[...availableForExpertise, ...newFeatSkills, ...fixedFeatSkills].forEach((/** @type {*} */ skill) => {
					const isSelected = feat._featChoices.expertise.includes(skill);
					const displayName = skill.replace(/([A-Z])/g, " $1").trim().toTitleCase();

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}">
							${displayName}
						</button>
					`});

					btn.addEventListener("click", () => {
						if (isSelected) {
							feat._featChoices.expertise = feat._featChoices.expertise.filter((/** @type {*} */ s) => s !== skill);
						} else if (feat._featChoices.expertise.length < choices.expertise.count) {
							feat._featChoices.expertise.push(skill);
						}
						renderExpertise();
					});
					expertiseGrid.append(btn);
				});
				expertiseSection.querySelector(".expertise-count").textContent = `${feat._featChoices.expertise.length}/${choices.expertise.count}`;
			};

			expertiseSection.append(expertiseGrid);
			expertiseSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="expertise-count">${feat._featChoices.expertise.length}/${choices.expertise.count}</span></div>`);
			renderExpertise();
			container.append(expertiseSection);
		}

		// Language choices
		if (choices.languages) {
			const langSection = e_({outer: `<div class="mb-2"></div>`});
			langSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.languages.count} language${choices.languages.count > 1 ? "s" : ""}:</label>`);

			const existingLangs = new Set((this._state.getLanguages?.() || []).map((/** @type {*} */ l) => l.toLowerCase()));
			const standardLangs = ["common", "dwarvish", "elvish", "giant", "gnomish", "goblin", "halfling", "orc"];
			const exoticLangs = ["abyssal", "celestial", "draconic", "deep speech", "infernal", "primordial", "sylvan", "undercommon"];
			const availableLangs = choices.languages.type === "standard" ? standardLangs : [...standardLangs, ...exoticLangs];

			const langGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			const renderLangs = () => {
				langGrid.innerHTML = "";
				availableLangs.forEach((/** @type {*} */ lang) => {
					const isKnown = existingLangs.has(lang.toLowerCase());
					const isSelected = feat._featChoices.languages.includes(lang);

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
							${isKnown ? "disabled title=\"Already known\"" : ""}
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${lang.toTitleCase()}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								feat._featChoices.languages = feat._featChoices.languages.filter((/** @type {*} */ l) => l !== lang);
							} else if (feat._featChoices.languages.length < choices.languages.count) {
								feat._featChoices.languages.push(lang);
							}
							renderLangs();
						});
					}
					langGrid.append(btn);
				});
				langSection.querySelector(".lang-count").textContent = `${feat._featChoices.languages.length}/${choices.languages.count}`;
			};

			langSection.append(langGrid);
			langSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="lang-count">${feat._featChoices.languages.length}/${choices.languages.count}</span></div>`);
			renderLangs();
			container.append(langSection);
		}

		// Ability score choices
		if (choices.ability) {
			const abilitySection = e_({outer: `<div class="mb-2 charsheet__levelup-feat-ability-choices"></div>`});
			abilitySection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ability to increase by ${choices.ability.amount}:</label>`);

			this._renderFeatAbilityButtons(feat, choices.ability, abilitySection, onAbilityChange);

			container.append(abilitySection);
		}

		// Spell Scribing Adept: class choice (Bard, Sorcerer, or Warlock)
		if (feat.name === "Spell Scribing Adept") {
			const scribingSection = e_({outer: `<div class="mb-2"></div>`});
			scribingSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose class for scribing spellbook:</label>`);
			const radioContainer = e_({outer: `<div class="ve-flex-wrap gap-2 mt-1"></div>`});

			const eligibleClasses = ["Bard", "Sorcerer", "Warlock"];
			const characterClasses = (this._state.getClasses?.() || []).map((/** @type {*} */ c) => c.name);
			const available = eligibleClasses.filter((/** @type {*} */ c) => characterClasses.includes(c));

			if (available.length === 0) {
				radioContainer.insertAdjacentHTML("beforeend", `<span class="ve-muted ve-small">No eligible class (requires Bard, Sorcerer, or Warlock)</span>`);
			} else {
				available.forEach((/** @type {*} */ cls) => {
					const isSelected = feat._featChoices.scribingClass === cls;
					const label = e_({outer: `
						<label class="charsheet__levelup-skill-radio mr-3 mb-1 d-inline-block" style="cursor: pointer;">
							<input type="radio" name="scribing-class-choice" class="mr-1" value="${cls}" ${isSelected ? "checked" : ""}>
							${cls}
						</label>
					`});
					label.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
						if (e.target.checked) feat._featChoices.scribingClass = cls;
					});
					radioContainer.append(label);
				});
				// Default to first available if not set
				if (!feat._featChoices.scribingClass && available.length > 0) {
					feat._featChoices.scribingClass = available[0];
					radioContainer.querySelector("input").checked = true;
				}
			}

			scribingSection.append(radioContainer);
			container.append(scribingSection);
		}

		// Cantrip choices
		if (choices.spells?.cantrips) {
			const cantripSection = e_({outer: `<div class="mb-2"></div>`});
			cantripSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.spells.cantrips.count} cantrip${choices.spells.cantrips.count > 1 ? "s" : ""}:</label>`);

			const cantripList = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			const renderCantrips = () => {
				cantripList.innerHTML = "";
				feat._featChoices.cantrips.forEach((/** @type {*} */ cantrip, /** @type {*} */ idx) => {
					const badge = e_({outer: `<span class="badge badge-primary mr-1">${cantrip.name} <span class="clickable" style="cursor: pointer;">×</span></span>`});
					badge.querySelector(".clickable").addEventListener("click", () => {
						feat._featChoices.cantrips.splice(idx, 1);
						renderCantrips();
					});
					cantripList.append(badge);
				});

				if (feat._featChoices.cantrips.length < choices.spells.cantrips.count) {
					const addBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default">+ Add Cantrip</button>`});
					addBtn.addEventListener("click", async () => {
						await this._showSpellPicker(choices.spells.cantrips.filter, true, (/** @type {*} */ spell) => {
							if (!feat._featChoices.cantrips.find((/** @type {*} */ s) => s.name === spell.name && s.source === spell.source)) {
								feat._featChoices.cantrips.push({name: spell.name, source: spell.source, level: 0});
								renderCantrips();
							}
						});
					});
					cantripList.append(addBtn);
				}
				cantripSection.querySelector(".cantrip-count").textContent = `${feat._featChoices.cantrips.length}/${choices.spells.cantrips.count}`;
			};

			cantripSection.append(cantripList);
			cantripSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="cantrip-count">${feat._featChoices.cantrips.length}/${choices.spells.cantrips.count}</span></div>`);
			renderCantrips();
			container.append(cantripSection);
		}

		// Spell choices
		if (choices.spells?.spells) {
			const spellSection = e_({outer: `<div class="mb-2"></div>`});
			const spellType = choices.spells.spells.innate ? "innate spell" : "spell";
			spellSection.insertAdjacentHTML("beforeend", `<label class="ve-small">Choose ${choices.spells.spells.count} ${spellType}${choices.spells.spells.count > 1 ? "s" : ""}:</label>`);

			const spellList = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

			const renderSpells = () => {
				spellList.innerHTML = "";
				feat._featChoices.spells.forEach((/** @type {*} */ spell, /** @type {*} */ idx) => {
					const badge = e_({outer: `<span class="badge badge-primary mr-1">${spell.name} <span class="clickable" style="cursor: pointer;">×</span></span>`});
					badge.querySelector(".clickable").addEventListener("click", () => {
						feat._featChoices.spells.splice(idx, 1);
						renderSpells();
					});
					spellList.append(badge);
				});

				if (feat._featChoices.spells.length < choices.spells.spells.count) {
					const addBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default">+ Add Spell</button>`});
					addBtn.addEventListener("click", async () => {
						await this._showSpellPicker(choices.spells.spells.filter, false, (/** @type {*} */ spell) => {
							if (!feat._featChoices.spells.find((/** @type {*} */ s) => s.name === spell.name && s.source === spell.source)) {
								feat._featChoices.spells.push({
									name: spell.name,
									source: spell.source,
									level: spell.level,
									innate: choices.spells.spells.innate,
									daily: choices.spells.spells.daily,
								});
								renderSpells();
							}
						});
					});
					spellList.append(addBtn);
				}
				spellSection.querySelector(".spell-count").textContent = `${feat._featChoices.spells.length}/${choices.spells.spells.count}`;
			};

			spellSection.append(spellList);
			spellSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mt-1">Selected: <span class="spell-count">${feat._featChoices.spells.length}/${choices.spells.spells.count}</span></div>`);
			renderSpells();
			container.append(spellSection);
		}
	}

	/**
	 * Show a spell picker modal filtered by the given filter string
	 * @param {string} filterStr - Filter string like "level=0|class=Wizard"
	 * @param {boolean} isCantrip - Whether we're picking cantrips (level 0)
	 * @param {function} onSelect - Callback when spell is selected
	 */
	async _showSpellPicker (/** @type {*} */ filterStr, /** @type {*} */ isCantrip, /** @type {*} */ onSelect) {
		if (!this._page._spells?.showFilteredSpellPicker) {
			JqueryUtil.doToast({type: "warning", content: "Spell picker not available"});
			return;
		}

		const choice = {
			filter: filterStr,
			featureName: isCantrip ? "Feat Cantrip" : "Feat Spell",
		};

		await this._page._spells.showFilteredSpellPicker(choice, onSelect);
	}

	/**

	 * @param {*} features

	 */

	_renderNewFeatures (/** @type {*} */ features) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					⭐ New Features
				</h5>
				<div class="charsheet__levelup-features"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-features");

		features.forEach((/** @type {*} */ feature) => {
			const featureEl = e_({outer: `
				<div class="charsheet__levelup-feature">
					<div class="charsheet__levelup-feature-header">
						<strong>${feature.name}</strong>
					</div>
					<div class="charsheet__levelup-feature-description ve-small">
						${Renderer.get().render({entries: feature.entries || []})}
					</div>
				</div>
			`});
			container.append(featureEl);
		});

		return section;
	}

	/**

	 * @param {*} classData

	 * @param {*} newLevel

	 * @param {*} onMethodChange

	 */

	_renderHpIncrease (/** @type {*} */ classData, /** @type {*} */ newLevel, /** @type {*} */ onMethodChange) {
		const hitDie = CharacterSheetClassUtils.getClassHitDie(classData);
		const conMod = this._state.getAbilityMod("con");
		const averageHp = Math.ceil(hitDie / 2) + 1 + conMod;

		const radioAverage = e_({outer: `<input type="radio" name="hp-method" value="average" checked class="mr-2">`})
			.addEventListener("change", () => onMethodChange?.("average"));
		const radioRoll = e_({outer: `<input type="radio" name="hp-method" value="roll" class="mr-2">`})
			.addEventListener("change", () => onMethodChange?.("roll"));

		const section = ee`
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					❤️ Hit Points
				</h5>
				<div class="charsheet__levelup-hp">
					<label class="ve-flex-v-center mb-2">
						${radioAverage}
						<span>Take average: <strong>${averageHp}</strong> HP (${Math.ceil(hitDie / 2) + 1} + ${conMod} CON)</span>
					</label>
					<label class="ve-flex-v-center">
						${radioRoll}
						<span>Roll: 1d${hitDie} + ${conMod} CON</span>
					</label>
				</div>
			</div>
		`;

		return section;
	}

	/**
	 * Render optional features selection UI for level up
	 * @param {*} classData - The class data
	 * @param {Array<*>} gains - Array of feature gains from _getOptionalFeatureGains
	 * @param {Function} onSelect - Callback(featureType, selectedFeatures)
	 * @param {number} newLevel - The new level for filtering by max degree
	 */
	_renderOptionalFeaturesSelection (/** @type {*} */ classData, /** @type {*} */ gains, /** @type {*} */ onSelect, /** @type {*} */ newLevel, {subclassGrantedTraditionCodes = /** @type {*[]} */ ([]), existingSelections = /** @type {*} */ ({})} = {}) {
		// Filter optional features by allowed sources and deduplicate by edition priority
		const allOptFeaturesRaw = this._page.filterByAllowedSources(this._page.getOptionalFeatures() || []);
		const showAllSetting = this._state.getSettings()?.showAllOptFeatureVersions || false;
		let showAll = showAllSetting;
		let allOptFeatures = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(allOptFeaturesRaw, {showAll});
		const existingOptFeatures = this._state.getFeatures().filter((/** @type {*} */ f) => f.featureType === "Optional Feature");

		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-list-alt"></span> Choose Features
				</h5>
				<label class="charsheet__settings-checkbox-label ve-small ve-muted mb-2" style="cursor: pointer;">
					<input type="checkbox" class="charsheet__opt-show-all-toggle" ${showAll ? "checked" : ""}>
					<span>Show all source versions</span>
				</label>
				<div class="charsheet__levelup-opt-features"></div>
			</div>
		`});

		const toggle = section.querySelector(".charsheet__opt-show-all-toggle");
		const container = section.querySelector(".charsheet__levelup-opt-features");

		const renderFeatures = () => {
			allOptFeatures = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(allOptFeaturesRaw, {showAll});
			container.innerHTML = "";
			this._renderOptFeaturesInContainer(container, classData, gains, onSelect, newLevel, allOptFeatures, existingOptFeatures, {subclassGrantedTraditionCodes, existingSelections});
		};

		toggle.addEventListener("change", (/** @type {*} */ e) => {
			showAll = e.target.checked;
			renderFeatures();
		});

		renderFeatures();
		return section;
	}

	/**

	 * @param {*} container

	 * @param {*} classData

	 * @param {*} gains

	 * @param {*} onSelect

	 * @param {*} newLevel

	 * @param {*} allOptFeatures

	 * @param {*} existingOptFeatures

	 * @param {*} arg

	 */

	_renderOptFeaturesInContainer (/** @type {*} */ container, /** @type {*} */ classData, /** @type {*} */ gains, /** @type {*} */ onSelect, /** @type {*} */ newLevel, /** @type {*} */ allOptFeatures, /** @type {*} */ existingOptFeatures, {subclassGrantedTraditionCodes = /** @type {*[]} */ ([]), existingSelections = /** @type {*} */ ({})} = {}) {
		gains.forEach((/** @type {*} */ gain) => {
			const featureKey = gain.featureTypes.join("_");
			const isCombatMethods = gain.featureTypes.some((/** @type {*} */ ft) => ft.startsWith("CTM:"));

			if (isCombatMethods) {
				// Use special Combat Methods rendering with tradition filtering
				this._renderCombatMethodsLevelUp(container, classData, gain, newLevel, allOptFeatures, existingOptFeatures, onSelect, featureKey, {subclassGrantedTraditionCodes, existingSelections: existingSelections[featureKey] || []});
			} else {
				// Standard optional feature rendering
				this._renderStandardOptionalFeaturesLevelUp(container, gain, allOptFeatures, existingOptFeatures, onSelect, featureKey);
			}
		});
	}

	/**
	 * Render Combat Methods selection during level-up with tradition filtering
	 */
	_renderCombatMethodsLevelUp (/** @type {*} */ container, /** @type {*} */ classData, /** @type {*} */ gain, /** @type {*} */ newLevel, /** @type {*} */ allOptFeatures, /** @type {*} */ existingOptFeatures, /** @type {*} */ onSelect, /** @type {*} */ featureKey, {subclassGrantedTraditionCodes = /** @type {*[]} */ ([]), existingSelections = /** @type {*[]} */ ([])} = {}) {
		const selectedForType = [...existingSelections];

		// Get character's known traditions from existing Combat Methods or state
		let knownTraditions = CharacterSheetClassUtils.getKnownCombatTraditions(existingOptFeatures, this._state);

		// Merge subclass-granted traditions (e.g. Mercy → Sanguine Knot) into known
		if (subclassGrantedTraditionCodes.length > 0) {
			const merged = new Set([...knownTraditions, ...subclassGrantedTraditionCodes]);
			knownTraditions = Array.from(merged);
		}

		// Get max degree for the new level
		const maxDegree = CharacterSheetClassUtils.getMaxMethodDegree(classData, newLevel);

		// Track selected traditions during this level-up (for characters without traditions)
		let tempSelectedTraditions = [...knownTraditions];
		const classFeatures = this._page.getClassFeatures();
		const traditionCount = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
			classData,
			classFeatures,
		});

		// If no traditions set, allow selecting them now (retroactive fix)
		if (knownTraditions.length < traditionCount) {
			// Filter traditions to only those the class has access to
			const classAllowedTypes = gain.featureTypes || [];
			const availableTraditions = CharacterSheetClassUtils.getAvailableTraditionsForClass(allOptFeatures, classAllowedTypes, classData?.name, classFeatures);

			const section = e_({outer: `
				<div class="charsheet__levelup-opt-gain mb-3">
					<p><strong>${gain.name}:</strong></p>
					${CharacterSheetClassUtils.getCombatMethodsSystemSummary()}
					<div class="charsheet__levelup-traditions mb-3">
						<p class="ve-muted ve-small mb-2">You haven't selected Combat Traditions yet. Please choose ${traditionCount} traditions first:</p>
						<div class="charsheet__levelup-tradition-list charsheet__levelup-picker-list"></div>
						<div class="ve-small ve-muted mt-1">Selected: <span class="tradition-count">0</span>/${traditionCount}</div>
					</div>
					<div class="charsheet__levelup-methods-container"></div>
				</div>
			`});

			const traditionList = section.querySelector(".charsheet__levelup-tradition-list");
			const methodsContainer = section.querySelector(".charsheet__levelup-methods-container");

			availableTraditions.forEach((/** @type {*} */ trad) => {
				const desc = CharacterSheetClassUtils.getTraditionDescription(trad.code);

				// Build hoverable tradition name linking to the Combat Traditions variant rule
				let tradNameHtml;
				try {
					tradNameHtml = CharacterSheetPage.getHoverLink(
						UrlUtil.PG_VARIANTRULES,
						"Combat Traditions",
						Parser.SRC_TGTT || "TGTT",
						/** @type {*} */ (null),
						trad.name,
					);
				} catch (e) {
					tradNameHtml = `<strong>${trad.name}</strong>`;
				}

				const item = e_({outer: `
					<label class="charsheet__builder-tradition-item d-block mb-1" style="cursor: pointer;">
						<input type="checkbox" class="mr-2">
						<strong class="tradition-name-slot"></strong>
						<span class="ve-muted ve-small ml-1">(${trad.code})</span>
						${desc ? `<div class="ve-muted ve-small ml-4">${desc}</div>` : ""}
					</label>
				`});
				item.querySelector(".tradition-name-slot").innerHTML = tradNameHtml;

				item.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
					if (e.target.checked) {
						if (tempSelectedTraditions.length < traditionCount) {
							tempSelectedTraditions.push(trad.code);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${traditionCount} traditions.`});
							return;
						}
					} else {
						tempSelectedTraditions = tempSelectedTraditions.filter((/** @type {*} */ t) => t !== trad.code);
						// Remove any selected methods that belonged to the removed tradition
						const removedTrad = trad.code;
						for (let i = selectedForType.length - 1; i >= 0; i--) {
							if (CharacterSheetClassUtils.getMethodTradition(selectedForType[i]) === removedTrad) {
								selectedForType.splice(i, 1);
							}
						}
					}
					section.querySelector(".tradition-count").textContent = tempSelectedTraditions.length;
					onSelect(featureKey, [...selectedForType], {combatTraditions: [...tempSelectedTraditions]});
					// Re-render methods when traditions change
					this._renderMethodsForLevelUp(methodsContainer, classData, gain, newLevel, allOptFeatures, existingOptFeatures, onSelect, featureKey, tempSelectedTraditions, maxDegree, selectedForType);
				});

				traditionList.append(item);
			});

			container.append(section);
			return;
		}

		// Normal flow: has traditions, render methods directly.
		// Wrap in a dedicated sub-container so _renderMethodsForLevelUp's
		// `container.innerHTML = ""` doesn't wipe sibling gain sections
		// (e.g. Battle Tactics rendered earlier in the same parent).
		const methodsWrapper = e_({outer: `<div class="charsheet__levelup-methods-container"></div>`});
		container.append(methodsWrapper);
		this._renderMethodsForLevelUp(methodsWrapper, classData, gain, newLevel, allOptFeatures, existingOptFeatures, onSelect, featureKey, knownTraditions, maxDegree, selectedForType);
	}

	/**
	 * Render the actual method selection list (used by both flows)
	 */
	_renderMethodsForLevelUp (/** @type {*} */ container, /** @type {*} */ classData, /** @type {*} */ gain, /** @type {*} */ newLevel, /** @type {*} */ allOptFeatures, /** @type {*} */ existingOptFeatures, /** @type {*} */ onSelect, /** @type {*} */ featureKey, /** @type {*} */ knownTraditions, /** @type {*} */ maxDegree, /** @type {*} */ selectedForType) {
		container.innerHTML = "";

		if (knownTraditions.length === 0) {
			container.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">Select traditions above to see available methods.</p>`);
			return;
		}

		// Merge combatMethod entities into the available pool
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
		const allMethods = [...allOptFeatures, ...combatMethodEntities];

		// Filter methods by known traditions and max degree
		const availableMethods = allMethods.filter((/** @type {*} */ opt) => {
			if (!CharacterSheetClassUtils.isCombatMethod(opt)) return false;
			const degree = CharacterSheetClassUtils.getMethodDegree(opt);
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
			return degree > 0 && degree <= maxDegree && tradCode && knownTraditions.includes(tradCode);
		});

		// Mark as already known or available
		const processedMethods = availableMethods.map((/** @type {*} */ opt) => {
			const alreadyHas = existingOptFeatures.some(
				(/** @type {*} */ existing) => existing.name === opt.name && existing.source === opt.source,
			);
			return {
				...opt,
				_alreadyKnown: alreadyHas,
				_selectable: !alreadyHas,
				_degree: CharacterSheetClassUtils.getMethodDegree(opt),
				_tradition: CharacterSheetClassUtils.getMethodTraditionCode(opt),
			};
		});

		const gainSection = e_({outer: `
			<div class="charsheet__levelup-opt-gain mb-3">
				<p><strong>${gain.name}:</strong> Choose ${gain.newCount} new method${gain.newCount > 1 ? "s" : ""}</p>
				<p class="ve-small ve-muted">Max degree available: ${maxDegree}${CharacterSheetClassUtils.getOrdinalSuffix(maxDegree)} | Traditions: ${knownTraditions.map((/** @type {*} */ t) => CharacterSheetClassUtils.getTraditionName(t)).join(", ")}</p>
				<div class="charsheet__levelup-opt-list"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="opt-count">${selectedForType.length}</span>/${gain.newCount}</div>
			</div>
		`});

		const list = gainSection.querySelector(".charsheet__levelup-opt-list");

		// Group by tradition
		const methodsByTradition = new Map();
		for (const method of processedMethods) {
			const trad = method._tradition;
			if (!methodsByTradition.has(trad)) {
				methodsByTradition.set(trad, []);
			}
			methodsByTradition.get(trad).push(method);
		}

		// Render grouped by tradition
		for (const tradCode of knownTraditions) {
			const methods = methodsByTradition.get(tradCode) || [];
			if (methods.length === 0) continue;

			const tradGroup = e_({outer: `
				<div class="charsheet__levelup-method-group mb-2">
					<p class="ve-small mb-1"><strong>${CharacterSheetClassUtils.getTraditionName(tradCode)}</strong></p>
				</div>
			`});

			methods.sort((/** @type {*} */ a, /** @type {*} */ b) => a._degree - b._degree || a.name.localeCompare(b.name)).forEach((/** @type {*} */ method) => {
				const isDisabled = !method._selectable;
				const knownBadge = method._alreadyKnown ? `<span class="badge badge-secondary ml-1">Known</span>` : "";
				const isSelected = selectedForType.some((/** @type {*} */ s) => s.name === method.name && s.source === method.source);

				const item = e_({outer: `
					<label class="charsheet__levelup-opt-item d-block mb-1 ml-2${isDisabled ? " charsheet__levelup-opt-item--disabled" : ""}" style="cursor: ${isDisabled ? "not-allowed" : "pointer"}; padding: 0.25rem; border-radius: 4px;${isDisabled ? " opacity: 0.6;" : ""}${isSelected ? " background: var(--rgb-link-opacity-10);" : ""}">
						<input type="checkbox" class="mr-2"${isDisabled ? " disabled" : ""}${isSelected ? " checked" : ""}>
						<span class="opt-name"></span>
						${knownBadge}
						<span class="ve-muted ve-small ml-1">(${method._degree}${CharacterSheetClassUtils.getOrdinalSuffix(method._degree)} degree)</span>
					</label>
				`});

				// Create hoverable link for the method name
				const methodName = item.querySelector(".opt-name");
				try {
					const resolvedSource = this._page.resolveOptionalFeatureSource(method.name, [
						method.source,
						this._selectedClass?.source,
						Parser.SRC_XPHB,
						Parser.SRC_PHB,
					]);
					methodName.innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_COMBAT_METHODS, method.name, resolvedSource);
				} catch (e) {
					methodName.innerHTML = `<strong>${method.name}</strong>`;
				}

				item.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
					if (e.target.checked) {
						if (selectedForType.length < gain.newCount) {
							selectedForType.push(method);
							item.style.background = "var(--rgb-link-opacity-10)";
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${gain.newCount} methods.`});
						}
					} else {
						const idx = selectedForType.findIndex((/** @type {*} */ s) => s.name === method.name && s.source === method.source);
						if (idx >= 0) selectedForType.splice(idx, 1);
						item.style.background = "";
					}
					gainSection.querySelector(".opt-count").textContent = selectedForType.length;
					onSelect(featureKey, [...selectedForType], {combatTraditions: [...knownTraditions]});
				});

				tradGroup.append(item);
			});

			list.append(tradGroup);
		}

		if ([...list.children].length === 0) {
			list.insertAdjacentHTML("beforeend", `<div class="ve-muted">No new methods available at this level.</div>`);
		}

		container.append(gainSection);
	}

	/**
	 * Render standard optional features (non-Combat Methods) during level-up
	 */
	_renderStandardOptionalFeaturesLevelUp (/** @type {*} */ container, /** @type {*} */ gain, /** @type {*} */ allOptFeatures, /** @type {*} */ existingOptFeatures, /** @type {*} */ onSelect, /** @type {*} */ featureKey) {
		/** @type {*[]} */ const selectedForType = [];

		// Build prereq context and delegate to the shared eligibility filter so the
		// builder (level 1) and level-up paths agree on what counts as selectable.
		const prereqContext = {
			classes: this._state.getClasses(),
			totalLevel: this._state.getTotalLevel(),
			existingFeatures: existingOptFeatures,
			cantrips: this._state.getCantripsKnown?.() || [],
			spells: this._state.getSpellsKnown?.() || [],
		};

		const availableOptions = CharacterSheetClassUtils.getEligibleOptionalFeatures(allOptFeatures, {
			featureTypes: gain.featureTypes,
			prereqContext,
			alreadyKnown: existingOptFeatures,
		});

		const gainSection = e_({outer: `
			<div class="charsheet__levelup-opt-gain mb-3">
				<p><strong>${gain.name}:</strong> Choose ${gain.newCount} new option${gain.newCount > 1 ? "s" : ""}</p>
				<div class="charsheet__levelup-opt-list"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="opt-count">0</span>/${gain.newCount}</div>
			</div>
		`});

		const list = gainSection.querySelector(".charsheet__levelup-opt-list");

		const selectableOptions = availableOptions.filter((/** @type {*} */ opt) => opt._selectable);
		if (!selectableOptions.length && !availableOptions.some((/** @type {*} */ opt) => opt._alreadyKnown || !opt._meetsPrereqs)) {
			list.insertAdjacentHTML("beforeend", `<div class="ve-muted">No options available at this level.</div>`);
		} else {
			// Add legend for badges
			const hasKnownOptions = availableOptions.some((/** @type {*} */ opt) => opt._alreadyKnown);
			const hasPrereqOptions = availableOptions.some((/** @type {*} */ opt) => !opt._meetsPrereqs);
			if (hasKnownOptions || hasPrereqOptions) {
				list.insertAdjacentHTML("afterbegin", `
					<div class="ve-small ve-muted mb-2 pb-2" style="border-bottom: 1px solid var(--rgb-border-grey);">
						${hasKnownOptions ? `<span class="badge badge-success mr-1">✓ Known</span> = Already selected` : ""}
						${hasKnownOptions ? `<span class="badge badge-info ml-2 mr-1">↺ Repeatable</span> = Can be taken again` : ""}
						${hasPrereqOptions ? `<span class="badge badge-warning ml-2 mr-1">⚠ Requires</span> = Prerequisites not met` : ""}
					</div>
				`);
			}

			availableOptions.sort((/** @type {*} */ a, /** @type {*} */ b) => {
				// Selectable options first
				if (a._selectable !== b._selectable) return a._selectable ? -1 : 1;
				// Known options before prereq-blocked ones
				if (a._alreadyKnown !== b._alreadyKnown) return a._alreadyKnown ? -1 : 1;
				// Prereq-blocked at the bottom
				if (a._meetsPrereqs !== b._meetsPrereqs) return a._meetsPrereqs ? -1 : 1;
				return a.name.localeCompare(b.name);
			}).forEach((/** @type {*} */ opt) => {
				const isDisabled = !opt._selectable;
				// Show count if taken multiple times
				const knownText = opt._timesKnown > 1 ? `Known ×${opt._timesKnown}` : "Known";
				const knownBadge = opt._alreadyKnown
					? `<span class="badge badge-success ml-1" title="Already selected${opt._timesKnown > 1 ? ` (${opt._timesKnown} times)` : ""}">✓ ${knownText}</span>`
					: "";
				const repeatableBadge = opt._repeatable
					? `<span class="badge badge-info ml-1" title="Can be taken multiple times">↺ Repeatable</span>`
					: "";
				const prereqBadge = !opt._meetsPrereqs && opt._prereqReasons?.length
					? `<span class="badge badge-warning ml-1" title="Requires: ${opt._prereqReasons.join(", ")}">⚠ ${opt._prereqReasons.join(", ")}</span>`
					: "";

				const item = e_({outer: `
					<label class="charsheet__levelup-opt-item d-block mb-1${isDisabled ? " charsheet__levelup-opt-item--disabled" : ""}${opt._alreadyKnown ? " charsheet__levelup-opt-item--known" : ""}" style="cursor: ${isDisabled ? "not-allowed" : "pointer"}; padding: 0.5rem; border-radius: 4px;${isDisabled ? " opacity: 0.5;" : ""}${opt._alreadyKnown && opt._selectable ? " background: rgba(var(--rgb-success-rgb), 0.1); border-left: 3px solid var(--rgb-success);" : ""}${opt._alreadyKnown && !opt._selectable ? " background: rgba(128, 128, 128, 0.1);" : ""}${!opt._meetsPrereqs ? " background: rgba(255, 193, 7, 0.05);" : ""}">
						<input type="checkbox" class="mr-2"${isDisabled ? " disabled" : ""}>
						<span class="opt-name"></span>
						${knownBadge}${repeatableBadge}${prereqBadge}
						<span class="ve-muted ve-small ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>
					</label>
				`});

				// Create hoverable link for the optional feature name
				const optName = item.querySelector(".opt-name");
				try {
					const resolvedSource = this._page.resolveOptionalFeatureSource(opt.name, [
						opt.source,
						this._selectedClass?.source,
						Parser.SRC_XPHB,
						Parser.SRC_PHB,
					]);
					const page = CharacterSheetClassUtils.isCombatMethod(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					optName.innerHTML = CharacterSheetPage.getHoverLink(page, opt.name, resolvedSource);
				} catch (e) {
					optName.innerHTML = `<strong>${opt.name}</strong>`;
				}

				item.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
					if (e.target.checked) {
						if (selectedForType.length < gain.newCount) {
							selectedForType.push(opt);
							item.style.background = "var(--rgb-link-opacity-10)";
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${gain.newCount} ${gain.name}.`});
						}
					} else {
						const idx = selectedForType.findIndex((/** @type {*} */ s) => s.name === opt.name && s.source === opt.source);
						if (idx >= 0) selectedForType.splice(idx, 1);
						item.style.background = "";
					}
					gainSection.querySelector(".opt-count").textContent = selectedForType.length;
					onSelect(featureKey, [...selectedForType]);
				});

				list.append(item);
			});
		}

		container.append(gainSection);
	}

	/**
	 * Render feature options selection UI for level up (for features with embedded type: "options")
	 * @param {Array<*>} optionGroups - Array of {featureName, featureSource, count, options} objects
	 * @param {Function} onSelect - Callback(featureKey, selectedOptions)
	 */
	/**
	 * Analyze a feature's text to detect if it requires a skill/expertise choice.
	 * @param {*} opt - The option object
	 * @returns {*} - { type: "proficiency"|"expertise"|"bonus", count: number, from: "any_proficient"|string[] }
	 */
	_parseFeatureSkillChoice (/** @type {*} */ opt) {
		return CharacterSheetClassUtils.parseFeatureSkillChoice(opt, this._page.getClassFeatures());
	}

	/**
	 * Parse automatic effects from a specialty/feature that don't require user choices.
	 * Examples: "passive Perception increases by 3", "bonus equal to proficiency bonus"
	 * @param {*} opt - The option object with ref, name, type
	 * @returns {Array<*>} Array of effect objects: [{type, value, note}]
	 */
	_parseFeatureAutoEffects (/** @type {*} */ opt) {
		return CharacterSheetClassUtils.parseFeatureAutoEffects(opt, this._page.getClassFeatures());
	}

	/**
	 * Render a skill sub-choice UI below a specialty checkbox (level-up version).
	 * @param {*} choice - From _parseFeatureSkillChoice: {type, count, from}
	 * @param {string} choiceKey - Unique key for storing selections
	 * @returns {*}
	 */
	_renderFeatureSkillSubChoice (/** @type {*} */ choice, /** @type {*} */ choiceKey) {
		const allSkills = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
			"History", "Insight", "Intimidation", "Investigation", "Medicine",
			"Nature", "Perception", "Performance", "Persuasion", "Religion",
			"Sleight of Hand", "Stealth", "Survival",
		];

		let availableSkills;
		if (choice.from === "any_proficient") {
			const proficientSkills = allSkills.filter((/** @type {*} */ s) => {
				const key = s.toLowerCase().replace(/\s+/g, "");
				return this._state?.getSkillProficiency?.(key) > 0;
			});
			availableSkills = proficientSkills.length ? proficientSkills : allSkills;
		} else {
			availableSkills = choice.from;
		}

		const typeLabel = choice.type === "proficiency" ? "Proficiency"
			: choice.type === "expertise" ? "Expertise" : "Bonus";

		if (!this._selectedFeatureSkillChoices[choiceKey]) {
			this._selectedFeatureSkillChoices[choiceKey] = [];
		}

		const wrapper = e_({outer: `
			<div class="charsheet__levelup-feat-skill-sub-choice ml-4 mt-1 mb-1 pl-2" style="border-left: 2px solid var(--rgb-border-grey, #888);">
				<div class="ve-small"><em>Choose ${choice.count} skill${choice.count > 1 ? "s" : ""} for ${typeLabel}:</em></div>
				<div class="charsheet__levelup-feat-skill-checkboxes"></div>
				<div class="ve-small ve-muted">Selected: <span class="feat-skill-count">${this._selectedFeatureSkillChoices[choiceKey].length}</span>/${choice.count}</div>
			</div>
		`});

		const checkboxes = wrapper.querySelector(".charsheet__levelup-feat-skill-checkboxes");

		for (const skill of availableSkills) {
			const isSelected = this._selectedFeatureSkillChoices[choiceKey].includes(skill);
			const label = e_({outer: `
				<label class="mr-2 mb-1" style="display: inline-block; cursor: pointer;">
					<input type="checkbox" value="${skill}" ${isSelected ? "checked" : ""}>
					<span class="ve-small">${skill}</span>
				</label>
			`});

			label.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
				if (e.target.checked) {
					if (this._selectedFeatureSkillChoices[choiceKey].length < choice.count) {
						this._selectedFeatureSkillChoices[choiceKey].push(skill);
					} else {
						e.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${choice.count} skill${choice.count > 1 ? "s" : ""}.`});
					}
				} else {
					this._selectedFeatureSkillChoices[choiceKey] = this._selectedFeatureSkillChoices[choiceKey].filter((/** @type {*} */ s) => s !== skill);
				}
				wrapper.querySelector(".feat-skill-count").textContent = this._selectedFeatureSkillChoices[choiceKey].length;
			});

			checkboxes.append(label);
		}

		return wrapper;
	}

	/**

	 * @param {*} optionGroups

	 * @param {*} onSelect

	 */

	_renderFeatureOptionsSelection (/** @type {*} */ optionGroups, /** @type {*} */ onSelect) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-star"></span> Feature Choices
				</h5>
				<div class="charsheet__levelup-feat-options"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-feat-options");

		optionGroups.forEach((/** @type {*} */ optGroup) => {
			const featureKey = `${optGroup.featureName}_${optGroup.featureSource || ""}`;
			/** @type {*[]} */ const selectedForGroup = [];

			const groupSection = e_({outer: `
				<div class="charsheet__levelup-feat-opt-group mb-3">
					<p><strong>${optGroup.featureName}:</strong> Choose ${optGroup.count}</p>
					<div class="charsheet__levelup-feat-opt-list charsheet__levelup-picker-list"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="feat-opt-count">0</span>/${optGroup.count}</div>
				</div>
			`});

			const list = groupSection.querySelector(".charsheet__levelup-feat-opt-list");

			// Get already-chosen features to filter out duplicates
			const existingFeatures = this._state.getFeatures?.() || [];
			const existingFeatureNames = new Set(existingFeatures.map((/** @type {*} */ f) => f.name));

			if (!optGroup.options.length) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted">No options available.</div>`);
			} else {
				let renderedCount = 0;
				optGroup.options.forEach((/** @type {*} */ opt) => {
					// Check if this option was already chosen (deduplication)
					const isAlreadyChosen = existingFeatureNames.has(opt.name);

					// Check if the feature can be taken multiple times
					let canRepeat = false;
					if (isAlreadyChosen && opt.type === "classFeature" && opt.ref) {
						const parts = opt.ref.split("|");
						const classFeatures = this._page.getClassFeatures();
						const fullOpt = classFeatures.find((/** @type {*} */ f) =>
							f.name === parts[0]
							&& f.className === parts[1]
							&& f.source === parts[2],
						);
						if (fullOpt?.entries) {
							const text = JSON.stringify(fullOpt.entries).toLowerCase();
							canRepeat = text.includes("multiple times") || text.includes("chosen again") || text.includes("retaken");
						}
					}

					// Skip already-chosen non-repeatable features
					if (isAlreadyChosen && !canRepeat) return;

					renderedCount++;
					const item = e_({outer: `
						<label class="charsheet__levelup-feat-opt-item d-block mb-1" style="cursor: pointer; padding: 0.25rem; border-radius: 4px;">
							<input type="checkbox" class="mr-2">
							<span class="feat-opt-name"></span>
							${opt.source ? `<span class="ve-muted ve-small ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>` : ""}
						</label>
					`});

					// Create hoverable link for the option name
					const nameSpan = item.querySelector(".feat-opt-name");
					if (opt.type === "classFeature" && opt.ref) {
						const parts = opt.ref.split("|");
						// Hash format: name, className, classSource, level, featureSource
						const featureSource = parts[2] || opt.source || "TGTT";
						const hash = UrlUtil.encodeArrayForHash(parts[0], parts[1], parts[2], parts[3], featureSource);
						try {
							const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
							nameSpan.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${opt.name}</a>`;
						} catch (e) {
							nameSpan.textContent = opt.name;
						}
					} else if (opt.type === "optionalfeature" && opt.ref) {
						const refParts = opt.ref.split("|");
						const resolvedSource = this._page.resolveOptionalFeatureSource(refParts[0] || opt.name, [
							refParts[1],
							opt.source,
							this._selectedClass?.source,
							Parser.SRC_XPHB,
							Parser.SRC_PHB,
						]);
						try {
							const page = CharacterSheetClassUtils.isCombatMethod(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
							nameSpan.innerHTML = CharacterSheetPage.getHoverLink(page, refParts[0], resolvedSource);
						} catch (e) {
							nameSpan.textContent = opt.name;
						}
					} else {
						nameSpan.textContent = opt.name;
					}

					item.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
						if (e.target.checked) {
							if (selectedForGroup.length < optGroup.count) {
								selectedForGroup.push(opt);
								item.style.background = "var(--rgb-link-opacity-10)";

								// Check if this option requires a skill sub-choice
								const skillChoice = this._parseFeatureSkillChoice(opt);
								if (skillChoice) {
									const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
									const subChoice = this._renderFeatureSkillSubChoice(skillChoice, choiceKey);
									item.after(subChoice);
								}
							} else {
								e.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${optGroup.count} options.`});
							}
						} else {
							const idx = selectedForGroup.findIndex((/** @type {*} */ s) => s.name === opt.name && s.ref === opt.ref);
							if (idx >= 0) selectedForGroup.splice(idx, 1);
							item.style.background = "";

							// Remove skill sub-choice UI
							const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
							delete this._selectedFeatureSkillChoices[choiceKey];
							item.nextElementSibling?.classList.contains("charsheet__levelup-feat-skill-sub-choice") && item.nextElementSibling.remove();
						}
						groupSection.querySelector(".feat-opt-count").textContent = selectedForGroup.length;
						onSelect(featureKey, [...selectedForGroup]);
					});

					list.append(item);
				});

				// If all options were filtered out, show a message
				if (renderedCount === 0) {
					list.insertAdjacentHTML("beforeend", `<div class="ve-muted">All available options have already been chosen.</div>`);
				}
			}

			container.append(groupSection);
		});

		return section;
	}

	/**
	 * Render expertise selection UI for level up
	 * @param {Array<*>} expertiseGrants - Array of {featureName, count, allowTools, toolName, fixedSkills} objects
	 * @param {Function} onSelect - Callback(featureKey, selectedSkills)
	 * @returns {*} The section element
	 */
	_renderExpertiseSelectionForLevelUp (/** @type {*} */ expertiseGrants, /** @type {*} */ onSelect) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-star-empty"></span> Expertise
				</h5>
				<div class="charsheet__levelup-expertise-grants"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-expertise-grants");

		// Get character's current skill proficiencies
		const skillProficiencies = this._state.getSkillProficiencies();
		const existingExpertise = this._state.getExpertise() || [];

		expertiseGrants.forEach((/** @type {*} */ grant) => {
			const featureKey = grant.featureName;

			// Handle fixed expertise (e.g., "expertise in the Performance skill")
			if (grant.fixedSkills?.length > 0) {
				const grantSection = e_({outer: `
					<div class="charsheet__levelup-expertise-grant mb-3">
						<p><strong>${grant.featureName}:</strong> Grants expertise in specific skills:</p>
						<div class="charsheet__levelup-expertise-checkboxes">
							${grant.fixedSkills.map((/** @type {*} */ s) => `<span class="badge badge-info mr-1">${s.toTitleCase()}</span>`).join("")}
						</div>
						<div class="ve-small ve-muted mt-1"><span class="glyphicon glyphicon-ok"></span> Auto-applied</div>
					</div>
				`});
				container.append(grantSection);
				// Immediately report selection
				onSelect(featureKey, [...grant.fixedSkills]);
				return;
			}

			/** @type {*[]} */ const selectedForGrant = [];

			const grantSection = e_({outer: `
				<div class="charsheet__levelup-expertise-grant mb-3">
					<p><strong>${grant.featureName}:</strong> Choose ${grant.count} skill${grant.count > 1 ? "s" : ""} for expertise:</p>
					${grant.allowTools && grant.toolName ? `<p class="ve-small ve-muted">You may also choose ${grant.toolName} if you're proficient with it.</p>` : ""}
					<div class="charsheet__levelup-expertise-checkboxes"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="expertise-count">0</span>/${grant.count}</div>
				</div>
			`});

			const checkboxes = grantSection.querySelector(".charsheet__levelup-expertise-checkboxes");

			// Get eligible skills (proficient but not already expertise)
			// Normalize case for comparison - existingExpertise may be title case
			const existingExpertiseLower = existingExpertise.map((/** @type {*} */ e) => e.toLowerCase());
			const eligibleSkills = Object.keys(skillProficiencies)
				.filter((/** @type {*} */ skill) => skillProficiencies[skill])
				.filter((/** @type {*} */ skill) => !existingExpertiseLower.includes(skill.toLowerCase()))
				.map((/** @type {*} */ skill) => skill.toTitleCase());

			// Optionally add thieves' tools
			if (grant.allowTools && grant.toolName) {
				const toolProficiencies = this._state.getToolProficiencies?.() || [];
				if (toolProficiencies.some((/** @type {*} */ t) => t.toLowerCase().includes("thieves"))) {
					if (!existingExpertise.includes(grant.toolName)) {
						eligibleSkills.push(grant.toolName);
					}
				}
			}

			if (eligibleSkills.length === 0) {
				checkboxes.insertAdjacentHTML("beforeend", `<p class="ve-muted">No eligible skills available (already have expertise in all proficient skills).</p>`);
			} else {
				eligibleSkills.forEach((/** @type {*} */ skill) => {
					const label = e_({outer: `
						<label class="charsheet__levelup-skill-checkbox mr-3 mb-1 d-inline-block" style="cursor: pointer;">
							<input type="checkbox" class="mr-1" value="${skill}">
							${skill}
						</label>
					`});

					label.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
						if (e.target.checked) {
							if (selectedForGrant.length < grant.count) {
								selectedForGrant.push(skill);
							} else {
								e.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${grant.count} skills for expertise.`});
							}
						} else {
							const idx = selectedForGrant.indexOf(skill);
							if (idx >= 0) selectedForGrant.splice(idx, 1);
						}
						grantSection.querySelector(".expertise-count").textContent = selectedForGrant.length;
						onSelect(featureKey, [...selectedForGrant]);
					});

					checkboxes.append(label);
				});
			}

			container.append(grantSection);
		});

		return section;
	}

	/**
	 * Render language selection UI for level up
	 * @param {Array<*>} languageGrants - Array of {featureName, count} objects
	 * @param {Function} onSelect - Callback(featureKey, selectedLanguages)
	 * @returns {*} The section element
	 */
	_renderLanguageSelectionForLevelUp (/** @type {*} */ languageGrants, /** @type {*} */ onSelect) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-comment"></span> Languages
				</h5>
				<div class="charsheet__levelup-language-grants"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-language-grants");

		languageGrants.forEach((/** @type {*} */ grant) => {
			const featureKey = grant.featureName;
			/** @type {*[]} */ const selectedForGrant = [];

			const grantSection = e_({outer: `
				<div class="charsheet__levelup-language-grant mb-3">
					<p><strong>${grant.featureName}:</strong> Choose ${grant.count} language${grant.count > 1 ? "s" : ""}:</p>
					<div class="charsheet__levelup-language-selection"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="lang-count">0</span>/${grant.count}</div>
				</div>
			`});

			const selection = grantSection.querySelector(".charsheet__levelup-language-selection");

			// Display selected languages and add button
			const selectedDisplay = e_({outer: `<div class="ve-flex ve-flex-wrap" style="gap: 8px;"></div>`});
			selection.append(selectedDisplay);
			const addBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary" style="display: inline-flex; align-items: center; gap: 4px;">
				<span class="glyphicon glyphicon-plus"></span> Choose Language
			</button>`});

			const renderSelected = () => {
				selectedDisplay.innerHTML = "";
				selectedForGrant.forEach((/** @type {*} */ lang, /** @type {*} */ idx) => {
					const tag = e_({outer: `
						<span class="badge" style="background: rgba(var(--rgb-link-rgb), 0.15); color: var(--rgb-link); display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 0.9em;">
							🗣️ ${lang}
							<span class="clickable" style="cursor: pointer; opacity: 0.7;" title="Remove">&times;</span>
						</span>
					`});
					tag.querySelector(".clickable").addEventListener("click", () => {
						selectedForGrant.splice(idx, 1);
						renderSelected();
						grantSection.querySelector(".lang-count").textContent = selectedForGrant.length;
						onSelect(featureKey, [...selectedForGrant]);
					});
					selectedDisplay.append(tag);
				});

				// Show add button if more languages can be selected
				if (selectedForGrant.length < grant.count) {
					selectedDisplay.append(addBtn);
				}
			};

			addBtn.addEventListener("click", async () => {
				const result = await this._page.showLanguagePicker?.({
					exclude: selectedForGrant,
					title: grant.featureName,
					count: 1,
				});
				if (result?.length) {
					selectedForGrant.push(...result);
					renderSelected();
					grantSection.querySelector(".lang-count").textContent = selectedForGrant.length;
					onSelect(featureKey, [...selectedForGrant]);
				}
			});

			renderSelected();
			container.append(grantSection);
		});

		return section;
	}

	/**
	 * Render Scholar expertise selection UI for level up (Wizard XPHB level 2)
	 * @param {Function} onSelect - Callback(skill) when a skill is selected
	 * @returns {*} The section element
	 */
	/**
	 * Render the spell swap section for known-casters.
	 * Shows current known spells with a swap button; clicking swap opens an inline picker for replacement.
	 * Only 1 swap allowed per level-up.
	 */
	/** @param {*} arg */
	_renderSpellSwapSection ({classEntry, newLevel, knownMaxSpellLevel, selectedSubclass, selectedSubclassChoice, onSwap}) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span>🔄</span> Swap a Known Spell
				</h5>
				<p class="ve-small ve-muted">You may replace one spell you know with a different spell of the same class. This is optional.</p>
				<div class="charsheet__levelup-spell-swap-list"></div>
				<div class="charsheet__levelup-spell-swap-picker" style="display: none;"></div>
			</div>
		`});

		const listContainer = section.querySelector(".charsheet__levelup-spell-swap-list");
		const pickerContainer = section.querySelector(".charsheet__levelup-spell-swap-picker");

		// Get current known spells (level 1+, not feature-granted)
		const knownSpells = (this._state.getSpellsKnown?.() || [])
			.filter((/** @type {*} */ s) => s.level > 0 && !s.alwaysPrepared && !s.sourceFeature);

		if (knownSpells.length === 0) {
			listContainer.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">No swappable spells known.</p>`);
			return section;
		}

		/** @type {*} */ let activeSwapSpell = null;

		const renderList = () => {
			listContainer.innerHTML = "";
			knownSpells.forEach((/** @type {*} */ spell) => {
				const isSwapped = activeSwapSpell && spell.name === activeSwapSpell.name && spell.source === activeSwapSpell.source;
				const row = e_({outer: `
					<div class="charsheet__levelup-spell-swap-row ${isSwapped ? "charsheet__levelup-spell-swap-row--swapped" : ""}" style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; ${isSwapped ? "text-decoration: line-through; opacity: 0.5;" : ""}">
						<span style="flex: 1;">${spell.name} <span class="ve-muted ve-small">(Level ${spell.level})</span></span>
						${isSwapped
		? `<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__spell-swap-undo" title="Undo swap">Undo</button>`
		: `<button class="ve-btn ve-btn-xs ve-btn-default charsheet__spell-swap-btn" title="Swap this spell">🔄 Swap</button>`
}
					</div>
				`});

				const btn = row.querySelector(".charsheet__spell-swap-btn, .charsheet__spell-swap-undo");
				btn.addEventListener("click", () => {
					if (isSwapped) {
						// Undo
						activeSwapSpell = null;
						pickerContainer.style.display = "none";
						pickerContainer.innerHTML = "";
						onSwap(null, null);
						renderList();
					} else {
						// Start swap — show picker
						activeSwapSpell = spell;
						renderList();
						showReplacementPicker(spell);
					}
				});

				listContainer.append(row);
			});
		};

		const showReplacementPicker = (/** @type {*} */ oldSpell) => {
			pickerContainer.innerHTML = "";
			pickerContainer.style.display = "block";

			const allSpells = this._page.getFilteredSpellData();
			const knownIds = new Set((this._state.getSpells?.() || []).map((/** @type {*} */ s) => `${s.name}|${s.source}`));

			// Resolve current subclass/subclassChoice (may have changed during level-up)
			const currentSubclass = typeof selectedSubclass === "function" ? selectedSubclass() : selectedSubclass;
			const currentSubclassChoice = typeof selectedSubclassChoice === "function" ? selectedSubclassChoice() : selectedSubclassChoice;

			const additionalClasses = CharacterSheetClassUtils.getAdditionalSpellListClasses({
				className: classEntry.name,
				subclass: currentSubclass || classEntry.subclass,
				subclassChoice: currentSubclassChoice,
			});

			// Filter to valid replacements: same class, level 1..maxSpellLevel, not already known
			const validSpells = allSpells.filter((/** @type {*} */ s) => {
				if (s.level < 1 || s.level > knownMaxSpellLevel) return false;
				if (knownIds.has(`${s.name}|${s.source}`)) return false;
				if (CharacterSheetClassUtils.spellIsForClass(s, classEntry.name, {subclass: currentSubclass || classEntry.subclass})) return true;
				if (additionalClasses.some((/** @type {*} */ cn) => CharacterSheetClassUtils.spellIsForClass(s, cn))) return true;
				return false;
			}).sort((/** @type {*} */ a, /** @type {*} */ b) => a.level - b.level || a.name.localeCompare(b.name));

			pickerContainer.insertAdjacentHTML("beforeend", `
				<div style="border-top: 1px solid rgba(var(--rgb-bg-text), 0.15); margin-top: 8px; padding-top: 8px;">
					<p class="ve-small"><strong>Replace ${oldSpell.name}</strong> with:</p>
					<input type="text" class="form-control form-control-sm charsheet__spell-swap-search mb-2" placeholder="Search spells...">
					<div class="charsheet__spell-swap-results" style="max-height: 200px; overflow-y: auto;"></div>
				</div>
			`);

			const searchInput = pickerContainer.querySelector(".charsheet__spell-swap-search");
			const resultsContainer = pickerContainer.querySelector(".charsheet__spell-swap-results");

			const renderResults = (filter = "") => {
				resultsContainer.innerHTML = "";
				const filtered = filter
					? validSpells.filter((/** @type {*} */ s) => s.name.toLowerCase().includes(filter.toLowerCase()))
					: validSpells;

				if (filtered.length === 0) {
					resultsContainer.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">No matching spells found.</p>`);
					return;
				}

				filtered.slice(0, 50).forEach((/** @type {*} */ spell) => {
					const row = e_({outer: `
						<div class="charsheet__spell-swap-result-row" style="display: flex; align-items: center; gap: 8px; padding: 3px 6px; cursor: pointer; border-radius: 3px;" onmouseover="this.style.background='rgba(var(--rgb-bg-text),0.07)'" onmouseout="this.style.background=''">
							<span style="flex: 1;">${spell.name} <span class="ve-muted ve-small">(Lvl ${spell.level})</span></span>
							<button class="ve-btn ve-btn-xs ve-btn-primary">Select</button>
						</div>
					`});

					row.addEventListener("click", () => {
						onSwap(oldSpell, spell);
						pickerContainer.style.display = "none";
						pickerContainer.innerHTML = "";
						renderList();
					});

					resultsContainer.append(row);
				});

				if (filtered.length > 50) {
					resultsContainer.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">Showing first 50 of ${filtered.length} results. Refine your search.</p>`);
				}
			};

			searchInput.addEventListener("input", () => renderResults(searchInput.value));
			renderResults();
			searchInput.focus();
		};

		renderList();
		return section;
	}

	/**

	 * @param {*} onSelect

	 */

	_renderScholarExpertiseSelection (/** @type {*} */ onSelect) {
		const section = e_({outer: `
			<div class="charsheet__levelup-section">
				<h5 class="charsheet__levelup-section-title">
					<span class="glyphicon glyphicon-education"></span> Scholar Expertise
				</h5>
				<p class="ve-small">Choose one skill from the Scholar list to gain expertise (double proficiency bonus):</p>
				<div class="charsheet__levelup-scholar-skills"></div>
			</div>
		`});

		const container = section.querySelector(".charsheet__levelup-scholar-skills");

		// Scholar skill options
		const scholarSkills = ["arcana", "history", "investigation", "medicine", "nature", "religion"];

		// Get character's current skill proficiencies
		const skillProficiencies = this._state.getSkillProficiencies();
		const existingExpertise = this._state.getExpertise() || [];

		// Get only eligible skills (must be proficient, not already expertise)
		const eligibleSkills = scholarSkills.filter((/** @type {*} */ skill) => {
			const isProficient = (skillProficiencies[skill] || 0) >= 1;
			const hasExpertise = existingExpertise.includes(skill);
			return isProficient && !hasExpertise;
		});

		if (eligibleSkills.length === 0) {
			container.insertAdjacentHTML("beforeend", `<p class="ve-muted">No eligible skills. You must be proficient in a Scholar skill (Arcana, History, Investigation, Medicine, Nature, or Religion) without already having expertise in it.</p>`);
		} else {
			let selectedSkill = null;

			eligibleSkills.forEach((/** @type {*} */ skill) => {
				const skillName = skill.toTitleCase();
				const radio = e_({outer: `
					<label class="charsheet__levelup-skill-radio mr-3 mb-1 d-inline-block" style="cursor: pointer;">
						<input type="radio" name="scholar-expertise" class="mr-1" value="${skill}">
						${skillName}
					</label>
				`});

				radio.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
					if (e.target.checked) {
						selectedSkill = skill;
						onSelect(skill);
					}
				});

				container.append(radio);
			});
		}

		return section;
	}

	/** @param {*} arg */

	async _applyLevelUp ({classEntry, newLevel, asiChoices, selectedFeat, selectedSubclass, selectedSubclassChoice, selectedOptionalFeatures, selectedCombatTraditions, selectedFeatureOptions, selectedExpertise, selectedLanguages, languageGrants, selectedScholarSkill, selectedSpellbookSpells, selectedKnownSpells, selectedKnownCantrips, selectedPreparedSpells, selectedPreparedCantrips, stagedSpellSwap, newFeatures, hpMethod, classData}) {
		const prevCombatTraditions = this._state.getCombatTraditions?.() || [];
		const prevWeaponMasteries = this._state.getWeaponMasteries?.() || [];

		// If a subclass was just selected, re-compute features to include actual subclass features
		if (selectedSubclass) {
			// Get the subclass features for this level (replacing placeholders like "Subclass Feature")
			newFeatures = CharacterSheetClassUtils.getLevelFeatures(classData, newLevel, selectedSubclass, this._page.getClassFeatures(), this._page.getSubclassFeatures());
		}

		// Update class level
		const classes = this._state.getClasses();
		const targetClass = classes.find((/** @type {*} */ c) => c.name === classEntry.name && c.source === classEntry.source);
		if (targetClass) {
			targetClass.level = newLevel;
			if (selectedSubclass) {
				// Store subclass info with caster progression for multiclass spell slot calculation
				targetClass.subclass = {
					name: selectedSubclass.name,
					shortName: selectedSubclass.shortName,
					source: selectedSubclass.source,
					casterProgression: selectedSubclass.casterProgression,
					spellcastingAbility: selectedSubclass.spellcastingAbility,
					additionalSpells: selectedSubclass.additionalSpells,
				};
				// Update class-level caster progression if subclass grants spellcasting (like Eldritch Knight)
				if (selectedSubclass.casterProgression && !targetClass.casterProgression) {
					targetClass.casterProgression = selectedSubclass.casterProgression;
					targetClass.spellcastingAbility = selectedSubclass.spellcastingAbility;
				}
			}
			if (selectedSubclassChoice || CharacterSheetClassUtils.isDivineSoulSubclass(targetClass.subclass)) {
				targetClass.subclassChoice = CharacterSheetClassUtils.normalizeDivineSoulAffinity(selectedSubclassChoice);
			}
		}
		this._state.ensureXpMatchesLevel();

		// Update unarmed strike (monk martial arts die progression)
		this._state.ensureUnarmedStrike();

		// Thelemar rule: applies at CHARACTER level 4, not per-class level 4 (matters for multiclass).
		// targetClass.level was just updated above, so getTotalLevel() already reflects the new character level.
		const isBothAsiAndFeat = this._state.shouldGrantBothAsiAndFeat(this._state.getTotalLevel() || 0);

		// Apply ASI and/or feat
		if (isBothAsiAndFeat) {
			// Thelemar rule: Apply BOTH ASI and Feat at level 4
			// Apply ability score increases
			/** @type {*[]} */ const increases = [];
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				if ((/** @type {*} */ (asiChoices))[abl]) {
					const currentBase = this._state.getAbilityBase(abl);
					this._state.setAbilityBase(abl, Math.min(20, currentBase + (/** @type {*} */ (asiChoices))[abl]));
					increases.push(`${Parser.attAbvToFull(abl)} +${(/** @type {*} */ (asiChoices))[abl]}`);
				}
			});

			// Add a tracking feature for the ASI choice
			if (increases.length > 0) {
				const asiFeature = {
					name: "Ability Score Improvement",
					source: classData.source,
					className: classEntry.name,
					classSource: classEntry.source,
					level: newLevel,
					featureType: "Class",
					description: `<p><strong>Ability Score Increases:</strong> ${increases.join(", ")}</p>`,
					isAsiChoice: true,
				};
				this._state.addFeature(asiFeature);
			}

			// Also apply the feat
			if (selectedFeat) {
				this._state.addFeat(selectedFeat, {allSpells: this._page.getSpells()});
				CharacterSheetClassUtils.applyFeatBonuses(this._state, selectedFeat);
				await this._processFeatSpellChoices();
			}
		} else if (selectedFeat) {
			// Normal rules: Feat chosen instead of ASI
			this._state.addFeat(selectedFeat, {allSpells: this._page.getSpells()});
			// Apply feat bonuses if any
			CharacterSheetClassUtils.applyFeatBonuses(this._state, selectedFeat);
			// Process pending spell choices from the feat
			await this._processFeatSpellChoices();
		} else if (asiChoices) {
			// Apply ability score increases
			/** @type {*[]} */ const increases = [];
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				if ((/** @type {*} */ (asiChoices))[abl]) {
					const currentBase = this._state.getAbilityBase(abl);
					this._state.setAbilityBase(abl, Math.min(20, currentBase + (/** @type {*} */ (asiChoices))[abl]));
					increases.push(`${Parser.attAbvToFull(abl)} +${(/** @type {*} */ (asiChoices))[abl]}`);
				}
			});

			// Add a tracking feature for the ASI choice
			if (increases.length > 0) {
				const asiFeature = {
					name: "Ability Score Improvement",
					source: classData.source,
					className: classEntry.name,
					classSource: classEntry.source,
					level: newLevel,
					featureType: "Class",
					description: `<p><strong>Ability Score Increases:</strong> ${increases.join(", ")}</p>`,
					isAsiChoice: true, // Mark as ASI choice for special handling
				};
				this._state.addFeature(asiFeature);
			}
		}

		if (selectedCombatTraditions != null) {
			this._state.setCombatTraditions([...selectedCombatTraditions]);
		}

		// Apply selected optional features (invocations, metamagic, maneuvers, etc.)
		if (selectedOptionalFeatures) {
			Object.entries(selectedOptionalFeatures).forEach(([featureKey, opts]) => {
				// featureKey is like "EI" or "MM" or "CTM:1_CTM:2_..." - the feature types joined
				const featureTypes = featureKey.split("_");
				opts.forEach((/** @type {*} */ opt) => {
					// Use the original feature's featureType if available (e.g., ["CTM:1AM", "CTM:2AM"])
					// This preserves the full type info including tradition codes
					const originalTypes = opt.featureType || featureTypes;

					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
						className: classEntry.name,
						classSource: classEntry.source,
						level: newLevel,
						featureType: "Optional Feature",
						optionalFeatureTypes: originalTypes,
					}));
				});
			});
		}

		// Apply selected feature options (specialties, etc. - features with embedded options)
		if (selectedFeatureOptions) {
			const classFeatures = this._page.getClassFeatures();
			const allOptFeatures = this._page.getOptionalFeatures();
			const subclassFeatures = this._page.getSubclassFeatures() || [];
			const currentSubclass = this._state.getClasses().find((/** @type {*} */ c) => c.name === classEntry.name)?.subclass;
			Object.entries(selectedFeatureOptions).forEach(([featureKey, options]) => {
				options.forEach((/** @type {*} */ opt) => {
					if (opt.type === "classFeature" && opt.ref) {
						// Look up full feature data
						const parts = opt.ref.split("|");
						const fullOpt = classFeatures.find((/** @type {*} */ f) =>
							f.name === parts[0]
							&& f.className === parts[1]
							&& f.source === parts[2],
						);

						this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
							{
								...(fullOpt || {}),
								...opt,
								entries: fullOpt?.entries ?? opt.entries,
							},
							{
								className: opt.className || classEntry.name,
								classSource: classEntry.source,
								level: opt.level || newLevel,
								featureType: "Class",
								isFeatureOption: true,
								parentFeature: featureKey.split("_")[0],
							},
						));

						// Apply any skill sub-choices for this specialty
						const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
						const skillSelections = this._selectedFeatureSkillChoices[choiceKey];
						if (skillSelections?.length) {
							const skillChoice = this._parseFeatureSkillChoice(opt);
							if (skillChoice) {
								skillSelections.forEach((/** @type {*} */ skill) => {
									const skillKey = skill.toLowerCase().replace(/\s+/g, "");
									if (skillChoice.type === "proficiency") {
										this._state.setSkillProficiency(skillKey, 1);
									} else if (skillChoice.type === "expertise") {
										this._state.setSkillProficiency(skillKey, 2);
									} else if (skillChoice.type === "bonus") {
										this._state.addNamedModifier({
											name: `${opt.name} (${skill})`,
											type: `skill:${skillKey}`,
											value: "proficiency",
											note: `From ${opt.name}: bonus equal to proficiency bonus`,
											enabled: true,
										});
									}
								});
							}
						}

						// Apply automatic effects from the specialty (passive bonuses, speed, etc.)
						// Find the feature we just added to link modifiers via sourceFeatureId
						const addedFeature = this._state.getFeatures().find((/** @type {*} */ f) => f.name === opt.name && f.isFeatureOption);
						const autoEffects = this._parseFeatureAutoEffects(opt);
						autoEffects.forEach((/** @type {*} */ effect) => {
							this._state.addNamedModifier({
								name: opt.name,
								type: effect.type,
								value: effect.value,
								note: effect.note || `From specialty: ${opt.name}`,
								enabled: true,
								sourceFeatureId: addedFeature?.id,
							});
						});
					} else if (opt.type === "subclassFeature" && opt.ref) {
						const fullSubFeature = subclassFeatures.find((/** @type {*} */ f) =>
							f.name === opt.name
							&& (f.subclassShortName === currentSubclass?.shortName || f.subclassShortName === opt.subclassShortName),
						);
						this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
							{
								...(fullSubFeature || {}),
								...opt,
								entries: fullSubFeature?.entries ?? opt.entries,
							},
							{
								className: opt.className || classEntry.name,
								classSource: classEntry.source,
								level: opt.level || newLevel,
								featureType: "Class",
								subclassName: currentSubclass?.name,
								subclassShortName: opt.subclassShortName || currentSubclass?.shortName,
								subclassSource: opt.subclassSource || currentSubclass?.source,
								isSubclassFeature: true,
								isFeatureOption: true,
								parentFeature: featureKey.split("_")[0],
							},
						));
					} else if (opt.type === "optionalfeature" && opt.ref) {
						const fullOpt = allOptFeatures.find((/** @type {*} */ f) =>
							f.name === opt.name
							&& (f.source === opt.source || !opt.source),
						);
						this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
							{
								...(fullOpt || {}),
								...opt,
								entries: fullOpt?.entries ?? opt.entries,
							},
							{
								className: classEntry.name,
								classSource: classEntry.source,
								level: newLevel,
								featureType: "Optional Feature",
								isFeatureOption: true,
								parentFeature: featureKey.split("_")[0],
							},
						));
					}
				});
			});
		}

		// Apply selected expertise from features like Deft Explorer Improvement
		if (selectedExpertise) {
			Object.entries(selectedExpertise).forEach(([featureName, skills]) => {
				skills.forEach((/** @type {*} */ skill) => {
					this._state.addExpertise(skill.toLowerCase());
				});
			});
		}

		// Apply Scholar expertise selection (Wizard XPHB level 2)
		if (selectedScholarSkill) {
			this._state.setScholarExpertise(selectedScholarSkill);
		}

		// Apply spell swap (known-casters only)
		if (stagedSpellSwap) {
			const {oldSpell, newSpell} = stagedSpellSwap;
			this._state.removeSpell(oldSpell.id || `${oldSpell.name}|${oldSpell.source}`);
			this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(newSpell, {
				sourceFeature: "Spells Known",
				sourceClass: classEntry.name,
			}));
		}

		// Apply wizard spellbook spell selections
		if (selectedSpellbookSpells && selectedSpellbookSpells.length > 0) {
			selectedSpellbookSpells.forEach((/** @type {*} */ spell) => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Wizard Spellbook",
					sourceClass: "Wizard",
					inSpellbook: true,
				}));
			});
		}

		// Apply known-spell caster spell selections (Sorcerer, Bard, Ranger, Warlock, etc.)
		if (selectedKnownSpells && selectedKnownSpells.length > 0) {
			selectedKnownSpells.forEach((/** @type {*} */ spell) => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Spells Known",
					sourceClass: classEntry.name,
				}));
			});
		}

		// Apply known-spell caster cantrip selections
		if (selectedKnownCantrips && selectedKnownCantrips.length > 0) {
			selectedKnownCantrips.forEach((/** @type {*} */ spell) => {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Spells Known",
					sourceClass: classEntry.name,
				}));
			});
		}

		if (classEntry.name === "Sorcerer") {
			this._state.setSubclassChoice(classEntry.name, selectedSubclassChoice);
			this._state.ensureDivineSoulKnownSpell(classEntry.name);
		}

		// Apply prepared-spell caster spell selections (XPHB Warlock, etc.)
		if (selectedPreparedSpells && selectedPreparedSpells.length > 0) {
			selectedPreparedSpells.forEach((/** @type {*} */ spell) => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Prepared Spells",
					sourceClass: classEntry.name,
					prepared: true,
				}));
			});
		}

		// Apply prepared-spell caster cantrip selections
		if (selectedPreparedCantrips && selectedPreparedCantrips.length > 0) {
			selectedPreparedCantrips.forEach((/** @type {*} */ spell) => {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Prepared Spells",
					sourceClass: classEntry.name,
				}));
			});
		}

		// Apply auto-languages from features like Thieves' Cant (which grants both the language AND a choice)
		if (languageGrants && languageGrants.length > 0) {
			for (const grant of languageGrants) {
				if (grant.autoLanguages?.length > 0) {
					grant.autoLanguages.forEach((/** @type {*} */ lang) => this._state.addLanguage(lang));
				}
			}
		}

		// Apply selected languages from features like Deft Explorer Improvement
		if (selectedLanguages) {
			Object.entries(selectedLanguages).forEach(([featureName, languages]) => {
				languages.forEach((/** @type {*} */ lang) => {
					this._state.addLanguage(lang);
				});
			});
		}

		// Apply HP increase
		let hpIncrease = 0;
		const hitDie = CharacterSheetClassUtils.getClassHitDie(classData);
		const conMod = this._state.getAbilityMod("con");

		if (hpMethod === "roll") {
			const roll = RollerUtil.randomise(hitDie);
			hpIncrease = Math.max(1, roll + conMod);
			this._page.showDiceResult({
				title: "HP Roll",
				total: hpIncrease,
				subtitle: `1d${hitDie} (${roll}) + ${conMod} CON`,
			});
		} else {
			hpIncrease = Math.ceil(hitDie / 2) + 1 + conMod;
		}

		const currentMaxHp = this._state.getMaxHp();
		this._state.setMaxHp(currentMaxHp + hpIncrease);
		// Always fill current HP to new max on level-up
		this._state.setCurrentHp(this._state.getMaxHp());

		// Add new features to character
		// Filter out placeholder features and ASI features (since ASI is handled separately)
		const asiFeatureNames = [
			"ability score improvement",
			"ability score increase",
			"asi",
		];

		// Get existing non-subclass feature names to prevent duplicates (like "Metamagic" at level 3 and 10)
		// Only filter class features, not subclass features (those can have same-named features at different levels)
		const existingClassFeatureNames = this._state.getFeatures()
			.filter((/** @type {*} */ f) => f.className === classEntry.name && !f.subclassName && !f.isSubclassFeature)
			.map((/** @type {*} */ f) => f.name.toLowerCase());

		CharacterSheetClassUtils.dedupAndBuildFeatures(
			newFeatures.filter((/** @type {*} */ f) => {
				if (f.gainSubclassFeature) return false;
				const nameLower = f.name.toLowerCase();
				if (asiFeatureNames.some((/** @type {*} */ asi) => nameLower.includes(asi))) return false;
				if (!f.isSubclassFeature && !f.subclassName && existingClassFeatureNames.includes(nameLower)) return false;
				return true;
			}),
			existingClassFeatureNames,
			{
				className: classEntry.name,
				classSource: classData.source,
				level: newLevel,
			},
		).forEach((/** @type {*} */ feature) => this._state.addFeature(feature));

		// Update hit dice
		CharacterSheetClassUtils.updateHitDice(this._state, classData);

		// Update class resources (Ki Points, Rage, etc.)
		CharacterSheetClassUtils.updateClassResources(this._state, classEntry, newLevel, classData);

		// Update spell slots if applicable
		CharacterSheetClassUtils.updateSpellSlots(this._state, classEntry, newLevel, classData);

		// Check for racial spells at the new character level
		CharacterSheetClassUtils.updateRacialSpells(this._state, this._page);

		// Record level-up choices in history
		const totalLevel = this._state.getTotalLevel();
		/** @type {*} */ const historyEntry = {
			level: totalLevel,
			class: {
				name: classEntry.name,
				source: classEntry.source,
			},
			choices: {},
			complete: true,
			timestamp: Date.now(),
		};

		// Record feat choice (if any)
		if (selectedFeat) {
			historyEntry.choices.feat = {
				name: selectedFeat.name,
				source: selectedFeat.source,
			};
		}

		// Record ASI choice (if any) - separate from feat for Thelemar rule support
		if (asiChoices) {
			/** @type {Object<string, *>} */ const asiData = {};
			Parser.ABIL_ABVS.forEach((/** @type {*} */ abl) => {
				if ((/** @type {*} */ (asiChoices))[abl]) {
					asiData[abl] = (/** @type {*} */ (asiChoices))[abl];
				}
			});
			if (Object.keys(asiData).length > 0) {
				historyEntry.choices.asi = asiData;
			}
		}

		// Record subclass selection
		if (selectedSubclass) {
			historyEntry.choices.subclass = {
				name: selectedSubclass.name,
				shortName: selectedSubclass.shortName,
				source: selectedSubclass.source,
			};
		}
		if (selectedSubclassChoice) {
			historyEntry.choices.subclassChoice = CharacterSheetClassUtils.normalizeDivineSoulAffinity(selectedSubclassChoice);
		}

		// Record optional features (invocations, metamagic, etc.)
		if (selectedOptionalFeatures && Object.keys(selectedOptionalFeatures).length > 0) {
			/** @type {*[]} */ const optFeatures = [];
			/** @type {*[]} */ const optFeatureReplay = [];
			Object.entries(selectedOptionalFeatures).forEach(([key, opts]) => {
				opts.forEach((/** @type {*} */ opt) => {
					optFeatures.push({
						name: opt.name,
						source: opt.source,
						type: key, // e.g., "EI", "MM"
					});
					optFeatureReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
						type: key,
					}));
				});
			});
			if (optFeatures.length > 0) {
				historyEntry.choices.optionalFeatures = optFeatures;
				historyEntry.choices.replayData = historyEntry.choices.replayData || {};
				historyEntry.choices.replayData.optionalFeatures = optFeatureReplay;
			}
		}

		// Record feature options (fighting styles, specialties, etc.)
		if (selectedFeatureOptions && Object.keys(selectedFeatureOptions).length > 0) {
			/** @type {*[]} */ const featureChoices = [];
			/** @type {*[]} */ const featureChoiceReplay = [];
			Object.entries(selectedFeatureOptions).forEach(([featureName, options]) => {
				const parentFeature = featureName.split("_")[0];
				options.forEach((/** @type {*} */ opt) => {
					featureChoices.push({
						featureName: parentFeature,
						choice: opt.name,
						source: opt.source,
					});
					featureChoiceReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
						type: opt.type || "featureOption",
						parentFeature,
					}));
				});
			});
			if (featureChoices.length > 0) {
				historyEntry.choices.featureChoices = featureChoices;
				historyEntry.choices.replayData = historyEntry.choices.replayData || {};
				historyEntry.choices.replayData.featureChoices = featureChoiceReplay;
			}
		}

		// Record expertise choices
		if (selectedExpertise && Object.keys(selectedExpertise).length > 0) {
			/** @type {*[]} */ const expertiseList = [];
			Object.values(selectedExpertise).forEach((/** @type {*} */ skills) => {
				skills.forEach((/** @type {*} */ skill) => expertiseList.push(skill.toLowerCase()));
			});
			if (expertiseList.length > 0) {
				historyEntry.choices.expertise = expertiseList;
			}
		}

		// Record language choices
		if (selectedLanguages && Object.keys(selectedLanguages).length > 0) {
			/** @type {*[]} */ const languagesList = [];
			Object.entries(selectedLanguages).forEach(([featureName, langs]) => {
				langs.forEach((/** @type {*} */ lang) => {
					languagesList.push({
						featureName,
						language: lang,
					});
				});
			});
			if (languagesList.length > 0) {
				historyEntry.choices.languages = languagesList;
			}
		}

		// Record scholar skill choice (Sage/Knowledge domain expertise)
		if (selectedScholarSkill) {
			historyEntry.choices.scholarSkill = selectedScholarSkill;
		}

		// Record spellbook spell choices (Wizard)
		if (selectedSpellbookSpells && selectedSpellbookSpells.length > 0) {
			historyEntry.choices.spellbookSpells = selectedSpellbookSpells.map((/** @type {*} */ spell) => ({
				name: spell.name,
				source: spell.source,
				level: spell.level,
			}));
		}

		// Record spell swap in history
		if (stagedSpellSwap) {
			historyEntry.choices.spellSwap = {
				removed: {name: stagedSpellSwap.oldSpell.name, source: stagedSpellSwap.oldSpell.source},
				added: {name: stagedSpellSwap.newSpell.name, source: stagedSpellSwap.newSpell.source},
			};
		}

		const nextCombatTraditions = this._state.getCombatTraditions?.() || [];
		if (JSON.stringify(prevCombatTraditions) !== JSON.stringify(nextCombatTraditions)) {
			historyEntry.choices.combatTraditions = [...nextCombatTraditions];
		}

		const nextWeaponMasteries = this._state.getWeaponMasteries?.() || [];
		if (JSON.stringify(prevWeaponMasteries) !== JSON.stringify(nextWeaponMasteries)) {
			historyEntry.choices.weaponMasteries = [...nextWeaponMasteries];
		}

		// Record the history entry
		this._state.recordLevelChoice(historyEntry);

		// Save and re-render
		await this._page.saveCharacter();
		this._page.renderCharacter();

		JqueryUtil.doToast({type: "success", content: `Leveled up to ${classEntry.name} ${newLevel}!`});
	}

	/**
	 * Add multiclass to character
	 */
	async showMulticlass () {
		const classes = this._page.getClasses();
		const currentClasses = this._state.getClasses();

		// Filter out classes character already has
		const availableClasses = classes.filter((/** @type {*} */ c) => !currentClasses.some((/** @type {*} */ cc) => cc.name === c.name));

		if (!availableClasses.length) {
			JqueryUtil.doToast({type: "warning", content: "No additional classes available."});
			return;
		}

		// Check total level cap
		const totalLevel = this._state.getTotalLevel();
		if (totalLevel >= 20) {
			JqueryUtil.doToast({type: "warning", content: "Character has reached maximum total level (20)."});
			return;
		}

		// Helper to get primary ability for a class (for multiclass prerequisites)
		const getPrimaryAbility = (/** @type {*} */ classData) => {
			if (!classData.primaryAbility) return null;
			// primaryAbility is an array of ability options
			// Each option is an object like {str: true} or {str: true, dex: true} for "or" choice
			return classData.primaryAbility.map((/** @type {*} */ abilityObj) => {
				return Object.keys(abilityObj).filter((/** @type {*} */ k) => Parser.ABIL_ABVS.includes(k));
			});
		};

		// Check if character meets prerequisites for a class
		// Must have 13+ in new class's primary ability AND current class(es) primary abilities
		const checkPrerequisites = (/** @type {*} */ newClassData) => {
			/** @type {*} */ const result = {met: true, failedAbilities: [], warnings: []};

			// Check new class requirements
			const newClassAbilities = getPrimaryAbility(newClassData);
			if (newClassAbilities) {
				for (const abilityOptions of newClassAbilities) {
					// For "or" choices, need at least one to meet 13
					const meetsRequirement = abilityOptions.some((/** @type {*} */ abl) => this._state.getAbilityScore(abl) >= 13);
					if (!meetsRequirement) {
						result.met = false;
						const abilityNames = abilityOptions.map((/** @type {*} */ a) => Parser.attAbvToFull(a)).join(" or ");
						result.failedAbilities.push(`${newClassData.name} requires ${abilityNames} 13+`);
					}
				}
			}

			// Check current class(es) requirements
			for (const currentCls of currentClasses) {
				const currentClassData = classes.find((/** @type {*} */ c) => c.name === currentCls.name);
				if (currentClassData) {
					const currentAbilities = getPrimaryAbility(currentClassData);
					if (currentAbilities) {
						for (const abilityOptions of currentAbilities) {
							const meetsRequirement = abilityOptions.some((/** @type {*} */ abl) => this._state.getAbilityScore(abl) >= 13);
							if (!meetsRequirement) {
								result.met = false;
								const abilityNames = abilityOptions.map((/** @type {*} */ a) => Parser.attAbvToFull(a)).join(" or ");
								result.failedAbilities.push(`${currentCls.name} requires ${abilityNames} 13+`);
							}
						}
					}
				}
			}

			return result;
		};

		// Format prerequisite display for a class
		const formatPrerequisiteDisplay = (/** @type {*} */ classData) => {
			const abilities = getPrimaryAbility(classData);
			if (!abilities?.length) return null;

			return abilities.map((/** @type {*} */ abilityOptions) => {
				const abilityChecks = abilityOptions.map((/** @type {*} */ abl) => {
					const score = this._state.getAbilityScore(abl);
					const met = score >= 13;
					return {abl, score, met, name: Parser.attAbvToFull(abl)};
				});

				// For "or" choices, at least one needs to be met
				const groupMet = abilityChecks.some((/** @type {*} */ c) => c.met);
				return {abilityChecks, groupMet};
			});
		};

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "📚 Add New Class (Multiclass)",
			isMinHeight0: true,
			isWidth100: true,
		});

		/** @type {*} */ let selectedClass = null;
		/** @type {*} */ let updateConfirmButton = null; // Will be assigned after button is created

		const search = e_({outer: `<input type="text" class="ve-form-control charsheet__modal-search" placeholder="🔍 Search classes...">`});
		const list = e_({outer: `<div class="charsheet__levelup-subclasses" style="max-height: 350px;"></div>`});

		// Selection display showing which class is chosen
		const selectionDisplay = e_({outer: `
			<div class="charsheet__multiclass-selection" style="display: none;">
				<span class="charsheet__multiclass-selection-icon">✅</span>
				<strong>Selected:</strong> <span class="charsheet__multiclass-selection-name"></span>
				<div class="charsheet__multiclass-prereq-status"></div>
			</div>
		`});

		const renderList = (filter = "") => {
			list.innerHTML = "";

			const filtered = availableClasses.filter((/** @type {*} */ c) =>
				c.name.toLowerCase().includes(filter.toLowerCase()),
			);

			if (filtered.length === 0) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted p-2 text-center">No matching classes found</div>`);
				return;
			}

			filtered.forEach((/** @type {*} */ cls) => {
				// Get hit die info
				const hitDie = cls.hd?.faces ? `d${cls.hd.faces}` : "—";
				// Get primary ability if available
				const spellcaster = cls.spellcastingAbility
					? `✨ Spellcaster (${Parser.attAbvToFull(cls.spellcastingAbility)})`
					: "";

				// Get prerequisite info
				const prereqInfo = formatPrerequisiteDisplay(cls);
				let prereqHtml = "";
				if (prereqInfo) {
					const prereqParts = prereqInfo.map((/** @type {*} */ group) => {
						const abilityStrs = group.abilityChecks.map((/** @type {*} */ c) => {
							const icon = c.met ? "✅" : "❌";
							return `${icon} ${c.name} ${c.score}/13`;
						}).join(" or ");
						return abilityStrs;
					});
					prereqHtml = `<div class="charsheet__multiclass-prereq ve-small ve-muted">📋 Prerequisite: ${prereqParts.join(", ")}</div>`;
				}

				const item = ee`
					<div class="charsheet__levelup-option" data-class-name="${cls.name}">
						<div class="charsheet__levelup-option-header">
							<input type="radio" name="multiclass-choice" value="${cls.name}">
							<strong>${cls.name}</strong>
							<span class="ve-muted ml-1">(${Parser.sourceJsonToAbv(cls.source)})</span>
						</div>
						<div class="charsheet__levelup-option-description ve-small">
							<span class="charsheet__class-stat">❤️ Hit Die: ${hitDie}</span>
							${spellcaster ? `<span class="charsheet__class-stat">${spellcaster}</span>` : ""}
						</div>
						${prereqHtml}
					</div>
				`;

				item.addEventListener("click", () => {
					list.querySelectorAll(".charsheet__levelup-option").forEach((/** @type {*} */ el) => el.classList.remove("selected"));
					list.querySelectorAll("input[type='radio']").forEach((/** @type {*} */ el) => el.checked = false);
					item.classList.add("selected");
					item.querySelector("input[type='radio']").checked = true;
					selectedClass = cls;

					// Update selection display
					selectionDisplay.querySelector(".charsheet__multiclass-selection-name").textContent = cls.name;

					// Check and display prerequisite status
					const prereqCheck = checkPrerequisites(cls);
					const prereqStatus = selectionDisplay.querySelector(".charsheet__multiclass-prereq-status");
					if (prereqCheck.met) {
						prereqStatus.innerHTML = `<span class="text-success">✅ Prerequisites met</span>`;
					} else {
						prereqStatus.innerHTML = `<span class="text-danger">❌ ${prereqCheck.failedAbilities.join("; ")}</span>`;
					}
					selectionDisplay.style.display = "";

					// Update confirm button (will be set after button is created)
					if (typeof updateConfirmButton === "function") updateConfirmButton(cls, prereqCheck);
				});

				list.append(item);
			});
		};

		search.addEventListener("input", (/** @type {*} */ e) => renderList(e.target.value));
		renderList();

		const mainContent = ee`<div class="charsheet__multiclass-body">
			<div class="charsheet__modal-info-banner charsheet__modal-info-banner--info">
				<div class="charsheet__modal-info-banner-icon">📚</div>
				<div class="charsheet__modal-info-banner-content">
					<strong>Add a New Class</strong>
					<div class="ve-small">Select a class to multiclass into. You'll start at level 1 in the new class. 
					Make sure your character meets the ability score prerequisites for multiclassing.</div>
				</div>
			</div>
			<div class="charsheet__modal-search-wrapper">
				${search}
				<span class="charsheet__modal-search-count">${availableClasses.length} classes</span>
			</div>
			${list}
			${selectionDisplay}
		</div>`;
		modalInner.append(mainContent);

		// Footer buttons
		const btnCancel = e_({outer: `<button class="ve-btn ve-btn-default">Cancel</button>`});
		btnCancel.addEventListener("click", () => doClose(false));
		const btnConfirm = e_({outer: `<button class="ve-btn ve-btn-primary" disabled><span class="btn-text">Select a Class</span></button>`});

		/** @type {*} */ let currentPrereqCheck = null;

		// Assign update function now that button exists
		updateConfirmButton = (/** @type {*} */ cls, /** @type {*} */ prereqCheck) => {
			currentPrereqCheck = prereqCheck;
			if (cls) {
				const prereqsMet = prereqCheck?.met !== false;
				if (prereqsMet) {
					btnConfirm.querySelector(".btn-text").textContent = `Add ${cls.name} (Level 1)`;
					btnConfirm.classList.remove("ve-btn-warning"); btnConfirm.classList.add("ve-btn-primary");
				} else {
					btnConfirm.querySelector(".btn-text").textContent = `Add ${cls.name} Anyway`;
					btnConfirm.classList.remove("ve-btn-primary"); btnConfirm.classList.add("ve-btn-warning");
				}
				btnConfirm.disabled = false;
			} else {
				btnConfirm.querySelector(".btn-text").textContent = "Select a Class";
				btnConfirm.classList.remove("ve-btn-warning"); btnConfirm.classList.add("ve-btn-primary");
				btnConfirm.disabled = true;
			}
		};

		btnConfirm.addEventListener("click", async () => {
			if (!selectedClass) return;

			// Warn if prerequisites not met
			if (currentPrereqCheck && !currentPrereqCheck.met) {
				const failedList = currentPrereqCheck.failedAbilities.map((/** @type {*} */ a) => `<li>${a}</li>`).join("");
				const confirmAnyway = await InputUiUtil.pGetUserBoolean({
					title: "Multiclass Prerequisites Not Met",
					htmlDescription: `<p>Your character does not meet the multiclass prerequisites:</p>
						<ul>${failedList}</ul>
						<p>The rules require 13+ in the primary ability of both your current class(es) and the new class.</p>
						<p>Add this class anyway?</p>`,
					textYes: "Add Anyway",
					textNo: "Cancel",
				});
				if (!confirmAnyway) return;
			}

			// Close class selection modal
			doClose(true);

			// Check for level 1 choices (optional features, feature options)
			const hasLevel1Choices = await this._showMulticlassChoices(selectedClass);

			// If choices modal was cancelled, don't add the class
			if (hasLevel1Choices === false) {
				JqueryUtil.doToast({type: "info", content: "Multiclass cancelled."});
			}
		});

		modalInner.append(ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnCancel}
			${btnConfirm}
		</div>`);
	}

	/**
	 * Show level 1 choices for multiclassing (Fighting Style, etc.)
	 * Returns true if class was added, false if cancelled
	 */
	async _showMulticlassChoices (/** @type {*} */ selectedClass) {
		// Get level 1 features
		const features = CharacterSheetClassUtils.getLevelFeatures(selectedClass, 1, undefined, this._page.getClassFeatures(), this._page.getSubclassFeatures());

		// Get optional feature gains (Fighting Style, etc.)
		const optionalFeatureGains = CharacterSheetClassUtils.getOptionalFeatureGains(selectedClass, 0, 1, this._state);

		// Get feature options (choices within features)
		const featureOptionGroups = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 1, this._page.getClassFeatures())
			// Filter out option groups where ALL options are optional features — those are
			// handled by optionalfeatureProgression in the Class Options step
			.filter((/** @type {*} */ optGroup) => !optGroup.options.every((/** @type {*} */ opt) => opt.type === "optionalfeature"));

		// Get multiclass skill grant info
		const multiclassSkillGrants = {
			"Bard": {count: 1, from: Object.keys(Parser.SKILL_TO_ATB_ABV)}, // Any skill
			"Ranger": {count: 1, from: ["animal handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"]},
			"Rogue": {count: 1, from: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight of hand", "stealth"]},
		};
		const skillGrant = (/** @type {*} */ (multiclassSkillGrants))[selectedClass.name];

		// Determine spell gains for multiclass level 1
		const isWizardMulticlass = selectedClass.name === "Wizard";
		const isKnownCasterMulticlass = !isWizardMulticlass && !selectedClass.preparedSpellsProgression && selectedClass.spellsKnownProgression;
		const isPreparedCasterMulticlass = !isWizardMulticlass && !isKnownCasterMulticlass && !!selectedClass.preparedSpellsProgression;

		let multiclassSpellGain = 0;
		let multiclassCantripGain = 0;
		const multiclassMaxSpellLevel = 1; // Multiclass level 1 always caps at 1st-level spells

		if (isWizardMulticlass) {
			multiclassSpellGain = 6; // PHB multiclass rule: 6 wizard spells
			multiclassCantripGain = selectedClass.cantripProgression?.[0] || 3;
		} else if (isKnownCasterMulticlass) {
			multiclassSpellGain = selectedClass.spellsKnownProgression[0] || 0;
			multiclassCantripGain = selectedClass.cantripProgression?.[0] || 0;
		} else if (isPreparedCasterMulticlass) {
			multiclassSpellGain = selectedClass.preparedSpellsProgression[0] || 0;
			multiclassCantripGain = selectedClass.cantripProgression?.[0] || 0;
		}

		const hasSpellChoices = multiclassSpellGain > 0 || multiclassCantripGain > 0;

		// If no choices needed, add the class directly
		if (!optionalFeatureGains.length && !featureOptionGroups.length && !skillGrant && !hasSpellChoices) {
			await this._applyMulticlass(selectedClass, features, {}, {}, [], [], []);
			return true;
		}

		// Show choices modal
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `${selectedClass.name} - Level 1 Choices`,
			isMinHeight0: true,
			isWidth100: true,
		});

		/** @type {Object<string, *>} */ let selectedOptionalFeatures = {};
		/** @type {Object<string, *>} */ let selectedFeatureOptions = {};
		/** @type {*[]} */ let selectedSkills = [];
		/** @type {*[]} */ let selectedMulticlassSpells = [];
		/** @type {*[]} */ let selectedMulticlassCantrips = [];

		const content = e_({outer: `<div></div>`});

		// Info about what choices need to be made
		const choicesList = [];
		if (optionalFeatureGains.length) {
			optionalFeatureGains.forEach((/** @type {*} */ g) => choicesList.push(`${g.newCount} ${g.name}`));
		}
		if (featureOptionGroups.length) {
			featureOptionGroups.forEach((/** @type {*} */ g) => choicesList.push(`${g.count} option(s) for ${g.featureName}`));
		}
		if (skillGrant) {
			choicesList.push(`${skillGrant.count} skill proficiency`);
		}
		if (multiclassSpellGain > 0) {
			choicesList.push(`${multiclassSpellGain} spell${multiclassSpellGain !== 1 ? "s" : ""}`);
		}
		if (multiclassCantripGain > 0) {
			choicesList.push(`${multiclassCantripGain} cantrip${multiclassCantripGain !== 1 ? "s" : ""}`);
		}

		content.insertAdjacentHTML("beforeend", `
			<div class="alert alert-info mb-3">
				<strong>🎯 Make Your Choices</strong><br>
				<span class="ve-small">As a level 1 ${selectedClass.name}, you need to select: ${choicesList.join(", ")}</span>
			</div>
		`);

		// Render skill selection for multiclass (if applicable)
		if (skillGrant) {
			const currentSkills = this._state.getSkillProficiencies();
			const availableSkills = skillGrant.from.filter((/** @type {*} */ s) => !currentSkills.includes(s));

			const skillSection = e_({outer: `<div class="charsheet__levelup-section mb-3">
				<h5>🎓 Skill Proficiency</h5>
				<p class="ve-small ve-muted">Select ${skillGrant.count} skill${skillGrant.count > 1 ? "s" : ""} to gain proficiency in:</p>
				<div class="charsheet__skill-choice-list"></div>
			</div>`});

			const skillList = skillSection.querySelector(".charsheet__skill-choice-list");
			availableSkills.forEach((/** @type {*} */ skill) => {
				const skillName = skill.split(" ").map((/** @type {*} */ w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
				const checkbox = e_({outer: `<label class="charsheet__skill-choice-item">
					<input type="checkbox" value="${skill}">
					<span>${skillName}</span>
				</label>`});

				checkbox.querySelector("input").addEventListener("change", /** @this {*} */ function () {
					const isChecked = this.checked;
					const value = this.value;

					if (isChecked) {
						if (selectedSkills.length < skillGrant.count) {
							selectedSkills.push(value);
						} else {
							this.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only select ${skillGrant.count} skill${skillGrant.count > 1 ? "s" : ""}.`});
						}
					} else {
						selectedSkills = selectedSkills.filter((/** @type {*} */ s) => s !== value);
					}
				});

				skillList.append(checkbox);
			});

			content.append(skillSection);
		}

		// Render optional features selection (Fighting Style, etc.)
		if (optionalFeatureGains.length) {
			const optSection = this._renderOptionalFeaturesSelection(selectedClass, optionalFeatureGains, (/** @type {*} */ featureType, /** @type {*} */ featuresList) => {
				selectedOptionalFeatures[featureType] = featuresList;
			}, 1);
			content.append(optSection);
		}

		// Render feature options selection
		if (featureOptionGroups.length) {
			const featOptSection = this._renderFeatureOptionsSelection(featureOptionGroups, (/** @type {*} */ featureKey, /** @type {*} */ options) => {
				selectedFeatureOptions[featureKey] = options;
			});
			content.append(featOptSection);
		}

		// Render spell selection for multiclass casters
		if (hasSpellChoices) {
			const allSpells = this._page.getFilteredSpellData();
			const knownSpellIds = new Set([
				...(this._state.getSpells?.() || []),
				...(this._state.getCantripsKnown?.() || []),
			].map((/** @type {*} */ s) => `${s.name}|${s.source}`));

			if (isWizardMulticlass) {
				const spellbookContent = CharacterSheetSpellPicker.renderWizardSpellbookPicker(/** @type {*} */ ({
					spellCount: multiclassSpellGain,
					maxSpellLevel: multiclassMaxSpellLevel,
					allSpells,
					knownSpellIds,
					className: selectedClass.name,
					subclass: null,
					getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
					cantripCount: multiclassCantripGain,
					onSelect: (/** @type {*} */ spells) => { selectedMulticlassSpells = spells; },
					onSelectCantrips: (/** @type {*} */ cantrips) => { selectedMulticlassCantrips = cantrips; },
				}));
				content.append(spellbookContent);
			} else {
				const spellPickerContent = CharacterSheetSpellPicker.renderKnownSpellPicker(/** @type {*} */ ({
					className: selectedClass.name,
					classSource: selectedClass.source,
					spellCount: multiclassSpellGain,
					cantripCount: multiclassCantripGain,
					maxSpellLevel: multiclassMaxSpellLevel,
					allSpells,
					knownSpellIds,
					getHoverLink: (/** @type {*} */ page, /** @type {*} */ name, /** @type {*} */ source) => CharacterSheetPage.getHoverLink(page, name, source),
					subclass: null,
					additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
						className: selectedClass.name,
						subclass: null,
					}),
					onSelect: (/** @type {*} */ spells, /** @type {*} */ cantrips) => {
						selectedMulticlassSpells = spells;
						selectedMulticlassCantrips = cantrips;
					},
				}));
				content.append(spellPickerContent);
			}
		}

		modalInner.append(content);

		// Footer buttons
		const btnCancel = e_({outer: `<button class="ve-btn ve-btn-default">Cancel</button>`});
		btnCancel.addEventListener("click", () => doClose(false));
		const btnConfirm = e_({outer: `<button class="ve-btn ve-btn-primary">Confirm & Add ${selectedClass.name}</button>`});
		btnConfirm.addEventListener("click", async () => {
			// Validate optional features
			for (const gain of optionalFeatureGains) {
				const featureKey = gain.featureTypes.join("_");
				const selected = selectedOptionalFeatures[featureKey] || [];
				if (selected.length < gain.newCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${gain.newCount} ${gain.name}.`});
					return;
				}
			}

			// Validate feature options
			for (const optGroup of featureOptionGroups) {
				const featureKey = `${optGroup.featureName}_${optGroup.featureSource || ""}`;
				const selected = selectedFeatureOptions[featureKey] || [];
				if (selected.length < optGroup.count) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${optGroup.count} option(s) for ${optGroup.featureName}.`});
					return;
				}
			}

			// Validate skill selections
			if (skillGrant && selectedSkills.length < skillGrant.count) {
				JqueryUtil.doToast({type: "warning", content: `Please select ${skillGrant.count} skill proficiency.`});
				return;
			}

			// Validate spell selections
			if (multiclassSpellGain > 0 && selectedMulticlassSpells.length < multiclassSpellGain) {
				JqueryUtil.doToast({type: "warning", content: `Please select ${multiclassSpellGain} spell${multiclassSpellGain !== 1 ? "s" : ""}.`});
				return;
			}
			if (multiclassCantripGain > 0 && selectedMulticlassCantrips.length < multiclassCantripGain) {
				JqueryUtil.doToast({type: "warning", content: `Please select ${multiclassCantripGain} cantrip${multiclassCantripGain !== 1 ? "s" : ""}.`});
				return;
			}

			// Apply multiclass with selections
			await this._applyMulticlass(selectedClass, features, selectedOptionalFeatures, selectedFeatureOptions, selectedSkills, selectedMulticlassSpells, selectedMulticlassCantrips);

			doClose(true);
		});

		modalInner.append(ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnCancel}
			${btnConfirm}
		</div>`);

		// Wait for modal to close and return result
		return new Promise(resolve => {
			const checkClosed = setInterval(() => {
				if (!modalInner.offsetParent) {
					clearInterval(checkClosed);
					// Check if class was added by looking for it
					const wasAdded = this._state.getClasses().some((/** @type {*} */ c) => c.name === selectedClass.name);
					resolve(wasAdded);
				}
			}, 100);
		});
	}

	/**
	 * Apply multiclass - add class, features, proficiencies, and selected optional features
	 */
	async _applyMulticlass (/** @type {*} */ selectedClass, /** @type {*} */ features, /** @type {*} */ selectedOptionalFeatures, /** @type {*} */ selectedFeatureOptions, /** @type {*} */ selectedSkills = [], /** @type {*} */ selectedSpells = [], /** @type {*} */ selectedCantrips = []) {
		// Add class at level 1 with caster info for multiclass spell slot calculation
		this._state.addClass({
			name: selectedClass.name,
			source: selectedClass.source,
			level: 1,
			subclass: null,
			casterProgression: selectedClass.casterProgression || null,
			spellcastingAbility: selectedClass.spellcastingAbility || null,
			// Spell progression arrays for 2024/TGTT classes
			preparedSpellsProgression: selectedClass.preparedSpellsProgression,
			spellsKnownProgression: selectedClass.spellsKnownProgression,
			cantripProgression: selectedClass.cantripProgression,
		});

		// Add first level features
		features.forEach((/** @type {*} */ f) => {
			this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(f, {
				className: f.className || selectedClass.name,
				classSource: f.classSource || selectedClass.source,
				level: f.level || 1,
				featureType: "Class",
			}));
		});

		// Add selected optional features (Fighting Style, etc.)
		for (const [featureKey, optFeatures] of Object.entries(selectedOptionalFeatures)) {
			for (const optFeat of optFeatures) {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(optFeat, {
					className: selectedClass.name,
					classSource: selectedClass.source,
					level: 1,
					featureType: "Optional Feature",
					optionalFeatureTypes: optFeat.featureType,
				}));
			}
		}

		// Add selected feature options
		for (const [featureKey, options] of Object.entries(selectedFeatureOptions)) {
			const [featureName] = featureKey.split("_");
			for (const option of options) {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(option, {
					className: selectedClass.name,
					classSource: selectedClass.source,
					level: 1,
					featureType: "Class",
					isFeatureOption: true,
					parentFeature: featureName,
				}));

				// Apply any skill sub-choices for this specialty
				const choiceKey = `${featureKey}__${option.name}__${option.ref || ""}`;
				const skillSelections = this._selectedFeatureSkillChoices[choiceKey];
				if (skillSelections?.length) {
					const skillChoice = this._parseFeatureSkillChoice(option);
					if (skillChoice) {
						skillSelections.forEach((/** @type {*} */ skill) => {
							const skillKey = skill.toLowerCase().replace(/\s+/g, "");
							if (skillChoice.type === "proficiency") {
								this._state.setSkillProficiency(skillKey, 1);
							} else if (skillChoice.type === "expertise") {
								this._state.setSkillProficiency(skillKey, 2);
							} else if (skillChoice.type === "bonus") {
								this._state.addNamedModifier({
									name: `${option.name} (${skill})`,
									type: `skill:${skillKey}`,
									value: "proficiency",
									note: `From ${option.name}`,
									enabled: true,
								});
							}
						});
					}
				}
			}
		}

		// Recalculate HP to include the new class level and sync current to max
		this._state.recalculateHp({syncCurrent: true});

		// Add hit die
		CharacterSheetClassUtils.updateHitDice(this._state, selectedClass);

		// Add proficiencies from multiclass (armor/weapons)
		this._applyMulticlassProficiencies(selectedClass);

		// Add selected skill proficiencies
		if (selectedSkills && selectedSkills.length) {
			selectedSkills.forEach((/** @type {*} */ skill) => {
				this._state.addSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""));
			});
		}

		// Add selected spells from multiclass
		if (selectedSpells && selectedSpells.length) {
			const isWizard = selectedClass.name === "Wizard";
			selectedSpells.forEach((/** @type {*} */ spell) => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: isWizard ? "Wizard Spellbook" : (selectedClass.preparedSpellsProgression ? "Prepared Spells" : "Spells Known"),
					sourceClass: selectedClass.name,
					inSpellbook: isWizard,
				}));
			});
		}

		// Add selected cantrips from multiclass
		if (selectedCantrips && selectedCantrips.length) {
			selectedCantrips.forEach((/** @type {*} */ cantrip) => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(cantrip, {
					sourceFeature: "Cantrips Known",
					sourceClass: selectedClass.name,
					isCantrip: true,
				}));
			});
		}

		// Recalculate spell slots for multiclass using the proper multiclass rules
		// This is important even if the new class isn't a caster - it updates
		// the spellcasting info display to show correct multiclass caster level
		this._state.calculateSpellSlots();

		await this._page.saveCharacter();
		this._page.renderCharacter();

		JqueryUtil.doToast({type: "success", content: `Added ${selectedClass.name} to your character!`});
	}

	/** @param {*} classData */

	_applyMulticlassProficiencies (/** @type {*} */ classData) {
		// Simplified multiclass proficiency grants
		const multiclassProfs = {
			"Barbarian": {armor: ["Shields"], weapons: ["Simple weapons", "Martial weapons"]},
			"Bard": {armor: ["Light armor"], skills: 1},
			"Cleric": {armor: ["Light armor", "Medium armor", "Shields"]},
			"Druid": {armor: ["Light armor", "Medium armor", "Shields"]},
			"Fighter": {armor: ["Light armor", "Medium armor", "Shields"], weapons: ["Simple weapons", "Martial weapons"]},
			"Monk": {weapons: ["Simple weapons", "Shortswords"]},
			"Paladin": {armor: ["Light armor", "Medium armor", "Shields"], weapons: ["Simple weapons", "Martial weapons"]},
			"Ranger": {armor: ["Light armor", "Medium armor", "Shields"], weapons: ["Simple weapons", "Martial weapons"], skills: 1},
			"Rogue": {armor: ["Light armor"], skills: 1},
			"Sorcerer": {},
			"Warlock": {armor: ["Light armor"], weapons: ["Simple weapons"]},
			"Wizard": {},
		};

		const profs = (/** @type {*} */ (multiclassProfs))[classData.name] || {};

		if (profs.armor) {
			profs.armor.forEach((/** @type {*} */ a) => this._state.addArmorProficiency(a));
		}
		if (profs.weapons) {
			profs.weapons.forEach((/** @type {*} */ w) => this._state.addWeaponProficiency(w));
		}
		// Skills would need UI selection - skip for now
	}

	/**
	 * Process pending spell choices from a recently added feat
	 */
	async _processFeatSpellChoices () {
		if (!this._state.hasPendingSpellChoices()) return;

		// Give UI time to update before showing modal
		await MiscUtil.pDelay(100);

		if (this._page._spells) {
			await this._page._spells.processPendingSpellChoices();
		}
	}
}

// Export for use in other modules
export {CharacterSheetLevelUp};
globalThis.CharacterSheetLevelUp = CharacterSheetLevelUp;
