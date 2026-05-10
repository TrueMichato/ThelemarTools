/**
 * CharacterSheetRespec - Handles level history display and choice editing
 * Allows players to view and modify choices made during level-up
 */
class CharacterSheetRespec {
	constructor ({page, state}) {
		this._page = page;
		this._state = state;

		this._timeline = null;
		this._legacyBadge = null;
		this._container = null;
	}

	/**
	 * Initialize the respec module and bind to DOM elements
	 */
	init () {
		this._container = document.getElementById("charsheet-level-history");
		this._timeline = document.getElementById("charsheet-level-timeline");
		this._legacyBadge = document.getElementById("charsheet-legacy-badge");

		if (!this._container) {
			// eslint-disable-next-line no-console
			console.warn("[Respec] Level history container not found");
			return;
		}

		// Initial render
		this.render();
	}

	/**
	 * Render the level history timeline
	 */
	render () {
		if (!this._timeline) return;

		const totalLevel = this._state.getTotalLevel();

		// No levels yet - tab visibility handles showing/hiding
		if (totalLevel === 0) {
			this._timeline.innerHTML = "";
			this._timeline.append(e_({outer: `<p class="charsheet__respec-empty">No levels yet. Complete character creation in the Builder tab.</p>`}));
			return;
		}

		// Show legacy badge if applicable
		const isLegacy = this._state.isLegacyCharacter();
		this._legacyBadge.classList.toggle("ve-hidden", !isLegacy);

		// Build timeline entries
		const levelHistory = this._state.getLevelHistory();
		const historyByLevel = new Map(levelHistory.map(h => [h.level, h]));

		this._timeline.innerHTML = "";

		for (let level = 1; level <= totalLevel; level++) {
			const history = historyByLevel.get(level);
			const entry = this._renderLevelEntry(level, history, level === totalLevel);
			this._timeline.append(entry);
		}
	}

	/**
	 * Render a single level entry in the timeline
	 * @param {number} level - Character level
	 * @param {object|null} history - History entry or null for legacy
	 * @param {boolean} isCurrent - Whether this is the current level
	 * @returns {HTMLElement} The entry element
	 */
	_renderLevelEntry (level, history, isCurrent) {
		const isLegacy = !history;
		const classes = this._state.getClasses();

		// Determine which class this level was in
		let levelClass = null;
		if (history?.class) {
			levelClass = history.class;
		} else {
			// For legacy, infer from current class levels
			// This is approximate - we just show the first class
			levelClass = classes[0] ? {name: classes[0].name, source: classes[0].source} : null;
		}

		const entryClasses = [
			"charsheet__level-entry",
			isLegacy ? "charsheet__level-entry--legacy" : "",
			isCurrent ? "charsheet__level-entry--current" : "",
		].filter(Boolean).join(" ");

		const entry = e_({tag: "div", clazz: entryClasses});
		entry.dataset.level = level;

		const card = e_({tag: "div", clazz: "charsheet__level-entry-card"});

		// Header with class name and edit button
		const header = e_({tag: "div", clazz: "charsheet__level-entry-header"});

		const className = levelClass?.name || "Unknown";
		const classInfo = e_({outer: `
			<div class="charsheet__level-entry-class">
				<span class="charsheet__level-entry-class-name">${className}</span>
				<span class="charsheet__level-entry-class-level">Level ${level}</span>
			</div>
		`});

		// Edit button - disabled for legacy entries
		const editBtn = e_({outer: `
			<button class="charsheet__level-entry-edit" title="${isLegacy ? "Cannot edit legacy level - level history not recorded" : "Edit choices for this level"}">
				<span class="glyphicon glyphicon-pencil"></span>
			</button>
		`});

		if (isLegacy) {
			editBtn.disabled = true;
		} else {
			editBtn.addEventListener("click", () => this._onEditLevel(level, history));
		}

		const headerActions = e_({tag: "div", clazz: "charsheet__level-entry-actions"});
		headerActions.append(editBtn);

		// Remove button - only on current (last) level, non-legacy, and level > 1
		if (isCurrent && !isLegacy && level > 1) {
			const removeBtn = e_({outer: `
				<button class="charsheet__level-entry-remove" title="Remove this level">
					<span class="glyphicon glyphicon-minus"></span>
				</button>
			`});
			removeBtn.addEventListener("click", () => this._onRemoveLevel(level, history));
			headerActions.append(removeBtn);
		}

		header.append(classInfo, headerActions);
		card.append(header);

		// Show race/background grants at level 1
		if (level === 1) {
			const grants = this._renderRaceBackgroundGrants(history);
			if (grants) card.append(grants);
		}

		// Choices summary
		const choices = e_({tag: "div", clazz: "charsheet__level-entry-choices"});

		if (history?.choices && Object.keys(history.choices).length > 0) {
			// ASI choice
			if (history.choices.asi) {
				const asiText = Object.entries(history.choices.asi)
					.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`)
					.join(", ");
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--asi">
						<span class="charsheet__level-choice-icon">📈</span>
						${asiText}
					</span>
				`}));
			}

			// Feat choice
			if (history.choices.feat) {
				const featPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feat">
						<span class="charsheet__level-choice-icon">⭐</span>
						<span class="respec-hover-slot"></span>
					</span>
				`});
				CharacterSheetRespec._setHoverLink(featPill.querySelector(".respec-hover-slot"), UrlUtil.PG_FEATS, history.choices.feat.name, history.choices.feat.source);
				choices.append(featPill);
			}

			// Subclass choice
			if (history.choices.subclass) {
				const subPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--subclass">
						<span class="charsheet__level-choice-icon">🎭</span>
						<span class="respec-hover-slot"></span>
					</span>
				`});
				CharacterSheetRespec._setHoverLink(subPill.querySelector(".respec-hover-slot"), UrlUtil.PG_CLASSES, history.choices.subclass.name, history.choices.subclass.source);
				choices.append(subPill);
			}

			// Skills chosen
			if (history.choices.skills?.length > 0) {
				const skillText = history.choices.skills.slice(0, 3).join(", ");
				const more = history.choices.skills.length > 3 ? ` +${history.choices.skills.length - 3} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--skill">
						<span class="charsheet__level-choice-icon">🎯</span>
						${skillText}${more}
					</span>
				`}));
			}

			// Feature choices (specialties, fighting styles, etc.)
			if (history.choices.featureChoices?.length > 0) {
				history.choices.featureChoices.forEach(fc => {
					const fcPill = e_({outer: `
						<span class="charsheet__level-choice charsheet__level-choice--feature">
							<span class="charsheet__level-choice-icon">✦</span>
							<span class="respec-hover-slot"></span>
						</span>
					`});
					CharacterSheetRespec._setHoverLink(fcPill.querySelector(".respec-hover-slot"), UrlUtil.PG_OPT_FEATURES, fc.choice, fc.source);
					choices.append(fcPill);
				});
			}

			// Optional features (invocations, metamagic, combat methods, etc.)
			if (history.choices.optionalFeatures?.length > 0) {
				history.choices.optionalFeatures.forEach(of => {
					const ofPill = e_({outer: `
						<span class="charsheet__level-choice charsheet__level-choice--feature">
							<span class="charsheet__level-choice-icon">✧</span>
							<span class="respec-hover-slot"></span>
						</span>
					`});
					const page = of.type?.startsWith("CTM:") ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					CharacterSheetRespec._setHoverLink(ofPill.querySelector(".respec-hover-slot"), page, of.name, of.source);
					choices.append(ofPill);
				});
			}

			// Expertise choices
			if (history.choices.expertise?.length > 0) {
				const expertiseText = history.choices.expertise.map(e => e.toTitleCase()).slice(0, 3).join(", ");
				const more = history.choices.expertise.length > 3 ? ` +${history.choices.expertise.length - 3} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--expertise">
						<span class="charsheet__level-choice-icon">🔥</span>
						Expertise: ${expertiseText}${more}
					</span>
				`}));
			}

			// Combat traditions
			if (history.choices.combatTraditions?.length > 0) {
				const tradPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feature">
						<span class="charsheet__level-choice-icon">⚔️</span>
						Traditions: <span class="respec-hover-slots"></span>
					</span>
				`});
				const slotsEl = tradPill.querySelector(".respec-hover-slots");
				history.choices.combatTraditions.forEach((code, i) => {
					if (i > 0) slotsEl.append(document.createTextNode(", "));
					const tradName = CharacterSheetClassUtils.getTraditionName?.(code) || code;
					const slot = e_({tag: "span", clazz: "respec-hover-slot"});
					CharacterSheetRespec._setHoverLink(slot, UrlUtil.PG_VARIANTRULES, "Combat Traditions", Parser.SRC_TGTT || "TGTT", null, tradName);
					slotsEl.append(slot);
				});
				choices.append(tradPill);
			}

			// Weapon masteries
			if (history.choices.weaponMasteries?.length > 0) {
				const masteryPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feature">
						<span class="charsheet__level-choice-icon">🗡️</span>
						Masteries: <span class="respec-hover-slots"></span>
					</span>
				`});
				const slotsEl = masteryPill.querySelector(".respec-hover-slots");
				history.choices.weaponMasteries.forEach((m, i) => {
					if (i > 0) slotsEl.append(document.createTextNode(", "));
					const [name, source] = m.split("|");
					const slot = e_({tag: "span", clazz: "respec-hover-slot"});
					CharacterSheetRespec._setHoverLink(slot, UrlUtil.PG_ITEMS, name, source);
					slotsEl.append(slot);
				});
				choices.append(masteryPill);
			}

			// Language choices
			if (history.choices.languages?.length > 0) {
				const langText = history.choices.languages.map(l => l.language).join(", ");
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--language">
						<span class="charsheet__level-choice-icon">🗣️</span>
						${langText}
					</span>
				`}));
			}

			// Scholar skill (knowledge domain, sage, etc.)
			if (history.choices.scholarSkill) {
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--scholar">
						<span class="charsheet__level-choice-icon">📚</span>
						Scholar: ${history.choices.scholarSkill.toTitleCase()}
					</span>
				`}));
			}

			// Spellbook spells (wizard)
			if (history.choices.spellbookSpells?.length > 0) {
				const spellText = history.choices.spellbookSpells.map(s => s.name).slice(0, 2).join(", ");
				const more = history.choices.spellbookSpells.length > 2 ? ` +${history.choices.spellbookSpells.length - 2} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--spells">
						<span class="charsheet__level-choice-icon">📜</span>
						Spellbook: ${spellText}${more}
					</span>
				`}));
			}
		} else if (isLegacy) {
			choices.append(e_({outer: `<span class="charsheet__level-entry-empty">No history recorded (legacy character)</span>`}));
		} else {
			choices.append(e_({outer: `<span class="charsheet__level-entry-empty">No choices at this level</span>`}));
		}

		card.append(choices);
		entry.append(card);

		return entry;
	}

	/**
	 * Handle remove button click for the last level
	 * @param {number} level - The level to remove
	 * @param {object} history - The history entry
	 */
	async _onRemoveLevel (level, history) {
		const preview = this._state.getRemoveLastLevelPreview();
		if (!preview) {
			JqueryUtil.doToast({type: "warning", content: "Cannot remove this level."});
			return;
		}
		await this._showRemoveLevelModal(preview);
	}

	/**
	 * Show a confirmation modal for removing the last level
	 * @param {object} preview - The preview object from getRemoveLastLevelPreview()
	 */
	async _showRemoveLevelModal (preview) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Remove Level ${preview.level}?`,
			isMinHeight0: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-modal"});

		content.append(e_({outer: `<p>This will remove <b>${preview.className}</b> level ${preview.classLevel} and the following:</p>`}));

		// Build removal summary
		const items = [];

		if (preview.features.length) {
			items.push(`Features: ${preview.features.map(f => f.name).join(", ")}`);
		}
		if (preview.feat) {
			items.push(`Feat: ${preview.feat.name}`);
		}
		if (preview.asi) {
			const asiParts = Object.entries(preview.asi)
				.filter(([, v]) => v)
				.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`);
			if (asiParts.length) items.push(`ASI: ${asiParts.join(", ")}`);
		}
		if (preview.optionalFeatures.length) {
			items.push(`Optional Features: ${preview.optionalFeatures.map(f => f.name).join(", ")}`);
		}
		if (preview.featureChoices?.length) {
			items.push(`Feature Choices: ${preview.featureChoices.map(f => f.name).join(", ")}`);
		}
		if (preview.spells.length) {
			items.push(`Spells: ${preview.spells.map(s => s.name).join(", ")}`);
		}
		if (preview.expertise.length) {
			items.push(`Expertise: ${preview.expertise.map(s => s.toTitleCase()).join(", ")}`);
		}
		if (preview.languages.length) {
			items.push(`Languages: ${preview.languages.join(", ")}`);
		}
		if (preview.combatTraditions.length) {
			items.push(`Combat Traditions: ${preview.combatTraditions.join(", ")}`);
		}
		if (preview.weaponMasteries.length) {
			items.push(`Weapon Masteries: ${preview.weaponMasteries.map(m => m.split("|")[0]).join(", ")}`);
		}

		if (items.length) {
			const list = e_({tag: "ul", clazz: "mb-2"});
			items.forEach(item => list.append(e_({tag: "li", html: item})));
			content.append(list);
		} else {
			content.append(e_({outer: `<p class="ve-muted ve-small">No tracked choices to remove.</p>`}));
		}

		if (preview.willRemoveSubclass) {
			content.append(e_({outer: `<div class="ve-alert ve-alert--warning mb-2"><b>\u26a0 Warning:</b> Your <b>${preview.subclassName}</b> subclass will be removed along with all its features.</div>`}));
		}

		if (preview.willRemoveClass) {
			content.append(e_({outer: `<div class="ve-alert ve-alert--warning mb-2"><b>\u26a0 Warning:</b> Your <b>${preview.className}</b> class will be removed entirely.</div>`}));
		}

		// Buttons
		const btnRow = e_({tag: "div", clazz: "ve-flex-v-center ve-flex-h-right mt-3"});

		const btnRemove = e_({tag: "button", clazz: "ve-btn ve-btn-danger mr-2", txt: "Remove Level"});
		btnRemove.addEventListener("click", () => {
			const result = this._state.removeLastLevel();
			if (result.success) {
				doClose();
				this._page.renderCharacter();
				this._page.saveCharacter();
				this.render();
				JqueryUtil.doToast({type: "success", content: `Removed ${preview.className} level ${preview.classLevel}.`});
			} else {
				JqueryUtil.doToast({type: "danger", content: result.reason});
			}
		});

		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		btnCancel.addEventListener("click", () => doClose());

		btnRow.append(btnRemove, btnCancel);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Handle edit button click for a level
	 * @param {number} level - The level to edit
	 * @param {object} history - The history entry
	 */
	async _onEditLevel (level, history) {
		if (!history) return;

		// Determine what can be edited at this level
		const editableChoices = this._getEditableChoices(level, history);

		if (editableChoices.length === 0) {
			JqueryUtil.doToast({type: "info", content: "No editable choices at this level."});
			return;
		}

		// Show edit modal
		await this._showEditModal(level, history, editableChoices);
	}

	/**
	 * Render a read-only summary of race and background grants for the level 1 card.
	 * @returns {HTMLElement|null} The grants element, or null if no race/background set
	 */
	_renderRaceBackgroundGrants (history) {
		const race = this._state.getRace();
		const background = this._state.getBackground();

		if (!race && !background) return null;

		const grants = e_({tag: "div", clazz: "charsheet__level-entry-grants mt-1 mb-1"});
		const raceUserChoices = history?.choices?.raceUserChoices || {};
		const bgUserChoices = history?.choices?.backgroundUserChoices || {};

		// Race grants
		if (race) {
			const raceName = this._state.getRaceName() || race.name;
			const raceGrants = e_({tag: "div", clazz: "charsheet__level-grants-section"});
			raceGrants.append(e_({outer: `<div class="ve-small ve-bold">🧬 ${raceName}</div>`}));

			const items = [];

			// Speed
			if (race.speed) {
				const speed = typeof race.speed === "number" ? race.speed : race.speed.walk;
				if (speed) items.push(`Speed ${speed} ft.`);
				if (typeof race.speed === "object") {
					["fly", "swim", "climb", "burrow"].forEach(t => {
						if (race.speed[t]) items.push(`${t.toTitleCase()} ${race.speed[t]} ft.`);
					});
				}
			}

			// Darkvision
			if (race.darkvision) items.push(`Darkvision ${race.darkvision} ft.`);

			// Size
			if (race.size?.length) {
				const sizeMap = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
				items.push(race.size.map(s => sizeMap[s] || s).join("/"));
			}

			// Resistances
			if (race.resist?.length) {
				const resists = race.resist.filter(r => typeof r === "string");
				if (resists.length) items.push(`Resist: ${resists.join(", ")}`);
			}

			// Skill proficiencies — fixed + user-chosen
			const raceSkills = [];
			if (race.skillProficiencies?.length) {
				race.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(s => {
						if (s !== "any" && s !== "choose") raceSkills.push(s.toTitleCase());
					});
				});
			}
			if (raceUserChoices.selectedSkills?.length) {
				raceUserChoices.selectedSkills.forEach(s => raceSkills.push(s));
			}
			if (raceSkills.length) items.push(`Skills: ${raceSkills.join(", ")}`);

			// Language proficiencies — fixed + user-chosen
			const raceLangs = [];
			if (race.languageProficiencies?.length) {
				race.languageProficiencies.forEach(lp => {
					Object.keys(lp).forEach(l => {
						if (l !== "anyStandard" && l !== "any" && l !== "choose") raceLangs.push(l.toTitleCase());
					});
				});
			}
			if (raceUserChoices.selectedLanguages) {
				Object.values(raceUserChoices.selectedLanguages).forEach(arr => {
					if (Array.isArray(arr)) arr.forEach(l => raceLangs.push(l));
				});
			}
			if (raceLangs.length) items.push(`Languages: ${raceLangs.join(", ")}`);

			// Tool proficiencies — user-chosen
			if (raceUserChoices.selectedTools?.length) {
				items.push(`Tools: ${raceUserChoices.selectedTools.join(", ")}`);
			}

			// Ability bonuses — fixed + user-chosen
			const raceBonusParts = [];
			if (race.ability) {
				race.ability.forEach(abiSet => {
					Object.entries(abiSet).forEach(([abi, bonus]) => {
						if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
							raceBonusParts.push(`${Parser.attAbvToFull(abi)} +${bonus}`);
						}
					});
				});
			}
			if (raceUserChoices.selectedAbilityChoices) {
				Object.entries(raceUserChoices.selectedAbilityChoices).forEach(([key, value]) => {
					if (!key.includes("_weight") && value && Parser.ABIL_ABVS.includes(value)) {
						const bonus = raceUserChoices.selectedAbilityChoices[`${key}_weight`] || 0;
						if (bonus) raceBonusParts.push(`${Parser.attAbvToFull(value)} +${bonus}`);
					}
				});
			}
			if (raceBonusParts.length) items.push(`ASI: ${raceBonusParts.join(", ")}`);

			if (items.length) {
				raceGrants.append(e_({outer: `<div class="ve-small ve-muted ml-2">${items.join(" · ")}</div>`}));
			}

			grants.append(raceGrants);
		}

		// Background grants
		if (background) {
			const bgGrants = e_({tag: "div", clazz: "charsheet__level-grants-section mt-1"});
			bgGrants.append(e_({outer: `<div class="ve-small ve-bold">📜 ${background.name}</div>`}));

			const items = [];

			// Skill proficiencies
			if (background.skillProficiencies?.length) {
				const skills = [];
				background.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(s => {
						if (s !== "any" && s !== "choose") skills.push(s.toTitleCase());
					});
				});
				if (skills.length) items.push(`Skills: ${skills.join(", ")}`);
			}

			// Tool proficiencies — fixed + user-chosen
			const bgTools = [];
			if (background.toolProficiencies?.length) {
				background.toolProficiencies.forEach(tp => {
					Object.keys(tp).forEach(t => {
						if (t !== "any" && t !== "choose" && t !== "anyArtisansTool" && t !== "anyMusicalInstrument") bgTools.push(t.toTitleCase());
					});
				});
			}
			if (bgUserChoices.selectedTools?.length) {
				bgUserChoices.selectedTools.forEach(c => {
					if (typeof c === "string") bgTools.push(c);
					else if (c.tool) bgTools.push(c.tool);
				});
			}
			if (bgTools.length) items.push(`Tools: ${bgTools.join(", ")}`);

			// Language proficiencies — fixed + user-chosen
			const bgLangs = [];
			if (background.languageProficiencies?.length) {
				background.languageProficiencies.forEach(lp => {
					Object.keys(lp).forEach(l => {
						if (l !== "anyStandard" && l !== "any" && l !== "choose") bgLangs.push(l.toTitleCase());
					});
				});
			}
			if (bgUserChoices.selectedLanguages?.length) {
				bgUserChoices.selectedLanguages.forEach(c => {
					if (typeof c === "string") bgLangs.push(c);
					else if (c.language) bgLangs.push(c.language);
				});
			}
			if (bgLangs.length) items.push(`Languages: ${bgLangs.join(", ")}`);

			// Ability bonuses — fixed + user-chosen
			const bgBonusParts = [];
			if (background.ability) {
				background.ability.forEach(abiSet => {
					Object.entries(abiSet).forEach(([abi, bonus]) => {
						if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
							bgBonusParts.push(`${Parser.attAbvToFull(abi)} +${bonus}`);
						}
					});
				});
			}
			if (bgUserChoices.selectedAbilityBonuses) {
				Object.entries(bgUserChoices.selectedAbilityBonuses).forEach(([key, value]) => {
					if (!key.includes("_weight") && value && Parser.ABIL_ABVS.includes(value)) {
						const bonus = bgUserChoices.selectedAbilityBonuses[`${key}_weight`] || 0;
						if (bonus) bgBonusParts.push(`${Parser.attAbvToFull(value)} +${bonus}`);
					}
				});
			}
			if (bgBonusParts.length) items.push(`ASI: ${bgBonusParts.join(", ")}`);

			// Starting equipment
			if (background.startingEquipment?.length) {
				items.push("Starting Equipment");
			}

			if (items.length) {
				bgGrants.append(e_({outer: `<div class="ve-small ve-muted ml-2">${items.join(" · ")}</div>`}));
			}

			grants.append(bgGrants);
		}

		return grants;
	}

	/**
	 * Get list of editable choices for a level
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @returns {Array} Array of {type, label, current} objects
	 */
	_getEditableChoices (level, history) {
		const editable = [];

		// Race is editable at level 1 (with cascade warning)
		if (level === 1 && history.choices?.race) {
			const raceName = this._state.getRaceName() || history.choices.race.name;
			editable.push({
				type: "race",
				label: "Species",
				current: raceName,
				hasCascade: true,
			});
		}

		// Background is editable at level 1 (with cascade warning)
		if (level === 1 && history.choices?.background) {
			editable.push({
				type: "background",
				label: "Background",
				current: history.choices.background.name,
				hasCascade: true,
			});
		}

		// ASI is editable (separate from feat for Thelemar rule support)
		if (history.choices?.asi) {
			const asiDesc = Parser.ABIL_ABVS
				.filter(abl => history.choices.asi[abl])
				.map(abl => `${Parser.attAbvToFull(abl)} +${history.choices.asi[abl]}`)
				.join(", ") || "None";
			editable.push({
				type: "asi",
				label: "Ability Score Improvement",
				current: asiDesc,
			});
		}

		// Feat is editable (separate from ASI)
		if (history.choices?.feat) {
			editable.push({
				type: "feat",
				label: "Feat",
				current: history.choices.feat,
			});
		}

		// Feature choices are editable (fight styles, specialties, Warden, etc.)
		if (history.choices?.featureChoices && history.choices.featureChoices.length > 0) {
			history.choices.featureChoices.forEach((fc, idx) => {
				editable.push({
					type: "featureChoice",
					label: fc.featureName,
					current: fc.choice,
					index: idx,
				});
			});
		}

		// Subclass is editable (with cascade warning)
		if (history.choices?.subclass) {
			editable.push({
				type: "subclass",
				label: "Subclass",
				current: history.choices.subclass,
				hasCascade: true,
			});
		}

		if (history.choices?.combatTraditions?.length > 0) {
			editable.push({
				type: "combatTraditions",
				label: "Combat Traditions",
				current: history.choices.combatTraditions.join(", "),
			});
		}

		if (history.choices?.weaponMasteries?.length > 0) {
			editable.push({
				type: "weaponMasteries",
				label: "Weapon Masteries",
				current: history.choices.weaponMasteries.map(m => m.split("|")[0]).join(", "),
			});
		}

		// Optional features (metamagic, invocations, etc.) are editable
		if (history.choices?.optionalFeatures?.length > 0) {
			// Group by feature type for a cleaner edit UI
			const byType = {};
			for (const of of history.choices.optionalFeatures) {
				const key = of.type || "other";
				(byType[key] = byType[key] || []).push(of);
			}
			for (const [typeKey, features] of Object.entries(byType)) {
				const isCTM = typeKey.startsWith("CTM:");
				const label = CharacterSheetRespec._getOptionalFeatureTypeLabel(typeKey);
				editable.push({
					type: isCTM ? "combatMethods" : "optionalFeatures",
					label,
					current: features.map(f => f.name).join(", "),
					featureTypeKey: typeKey,
					count: features.length,
				});
			}
		}

		// Note: Skills and other level 1 choices are typically not editable
		// as they would require extensive recalculation

		return editable;
	}

	/**
	 * Show the edit modal for a level's choices
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Array} editableChoices - Editable choices
	 */
	async _showEditModal (level, history, editableChoices) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Edit Level ${level} Choices`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-modal"});

		// Show current choices
		content.append(e_({outer: `<h4>Current Choices</h4>`}));

		const choicesList = e_({tag: "div", clazz: "charsheet__respec-choices-list"});
		editableChoices.forEach(choice => {
			const currentText = typeof choice.current === "object"
				? (choice.current.name || JSON.stringify(choice.current))
				: String(choice.current);

			const choiceRow = e_({outer: `
				<div class="charsheet__respec-choice-row">
					<span class="charsheet__respec-choice-label">${choice.label}:</span>
					<span class="charsheet__respec-choice-current">${currentText}</span>
					${choice.hasCascade ? `<span class="charsheet__respec-choice-warning" title="Changing this will remove dependent features">\u26a0\ufe0f</span>` : ""}
				</div>
			`});

			const editBtn = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", txt: "Change"});
			editBtn.addEventListener("click", () => this._editChoice(level, history, choice, doClose));
			choiceRow.append(editBtn);

			choicesList.append(choiceRow);
		});
		content.append(choicesList);

		// Close button
		const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary mt-3", txt: "Close"});
		closeBtn.addEventListener("click", () => doClose());
		content.append(closeBtn);

		modalInner.append(content);
	}

	/**
	 * Edit a specific choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The choice to edit
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editChoice (level, history, choice, closeParentModal) {
		switch (choice.type) {
			case "race":
				await this._editRace(level, history, closeParentModal);
				break;
			case "background":
				await this._editBackground(level, history, closeParentModal);
				break;
			case "asi":
				await this._editAsi(level, history, closeParentModal);
				break;
			case "feat":
				await this._editFeat(level, history, closeParentModal);
				break;
			case "featureChoice":
				await this._editFeatureChoice(level, history, choice, closeParentModal);
				break;
			case "subclass":
				await this._editSubclass(level, history, closeParentModal);
				break;
			case "combatTraditions":
				await this._editCombatTraditions(level, history, closeParentModal);
				break;
			case "weaponMasteries":
				await this._editWeaponMasteries(level, history, closeParentModal);
				break;
			case "combatMethods":
				await this._editCombatMethods(level, history, choice, closeParentModal);
				break;
			case "optionalFeatures":
				await this._editOptionalFeatures(level, history, choice, closeParentModal);
				break;
			default:
				JqueryUtil.doToast({type: "warning", content: "Editing this choice type is not yet implemented."});
		}
	}

	async _editCombatTraditions (level, history, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change Level ${level} Combat Traditions`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const classData = this._page.getClasses()?.find(c => c.name === history.class?.name && c.source === history.class?.source);

		// Extract CTM feature types from class optional feature progression
		const classAllowedTypes = [];
		if (classData?.optionalfeatureProgression) {
			for (const prog of classData.optionalfeatureProgression) {
				if (prog.featureType?.some(ft => ft.startsWith("CTM:"))) {
					classAllowedTypes.push(...prog.featureType.filter(ft => ft.startsWith("CTM:")));
				}
			}
		}
		let allTraditions = CharacterSheetClassUtils.getAvailableTraditionsForClass(
			this._page.getOptionalFeatures() || [],
			classAllowedTypes,
			classData?.name || history.class?.name,
			this._page.getClassFeatures() || [],
		);
		// If no traditions found from class data, show all traditions as fallback
		if (!allTraditions.length) {
			allTraditions = CharacterSheetClassUtils.getAllTraditions();
		}

		const classFeatures = this._page.getClassFeatures() || [];
		const maxTraditions = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
			classData,
			classFeatures,
			defaultCount: Math.max(1, history.choices?.combatTraditions?.length || 2),
		});
		const requiredTraditions = Math.min(maxTraditions, allTraditions.length || maxTraditions);

		let selectedTraditions = [...(history.choices?.combatTraditions || [])];

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose up to ${requiredTraditions} traditions for this level history entry.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-tradition-count">${selectedTraditions.length}</span>/${requiredTraditions}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {display: "flex", flexWrap: "wrap", gap: "8px"});
		modalInner.append(list);
		allTraditions.forEach(trad => {
			const isSelected = selectedTraditions.includes(trad.code);
			const desc = CharacterSheetClassUtils.getTraditionDescription?.(trad.code) || "";
			const label = e_({outer: `
				<label style="display:flex; align-items:center; cursor:pointer; padding:4px 8px; border:1px solid var(--rgb-border-grey); border-radius:4px; ${isSelected ? "background: var(--rgb-bg-highlight);" : ""}" title="${desc}">
					<input type="checkbox" value="${trad.code}" ${isSelected ? "checked" : ""} style="margin-right:6px;">
					<span class="respec-trad-name"></span>
					<span class="ve-small text-muted ml-1">(${trad.code})</span>
				</label>
			`});

			// Add hover link for the tradition name
			const tradNameEl = label.querySelector(".respec-trad-name");
			try {
				const tradLink = CharacterSheetPage.getHoverLink(
					UrlUtil.PG_VARIANTRULES,
					"Combat Traditions",
					Parser.SRC_TGTT || "TGTT",
					null,
					trad.name,
				);
				if (typeof tradLink === "string") tradNameEl.innerHTML = tradLink;
				else tradNameEl.append(tradLink);
			} catch (e) {
				tradNameEl.textContent = trad.name;
			}

			label.querySelector("input").addEventListener("change", (evt) => {
				if (evt.target.checked) {
					if (selectedTraditions.length < requiredTraditions) {
						selectedTraditions.push(trad.code);
						label.style.background = "var(--rgb-bg-highlight)";
					} else {
						evt.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredTraditions} combat traditions.`});
					}
				} else {
					selectedTraditions = selectedTraditions.filter(t => t !== trad.code);
					label.style.background = "";
				}
				document.getElementById("respec-tradition-count").textContent = selectedTraditions.length;
			});

			list.append(label);
		});

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedTraditions.length !== requiredTraditions) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredTraditions} traditions.`});
				return;
			}

			const didUpdate = this._state.updateLevelChoice(level, {combatTraditions: [...selectedTraditions]});
			if (!didUpdate) {
				JqueryUtil.doToast({type: "danger", content: "Failed to update level history entry."});
				return;
			}
			this._page.replayHistoryMartialChoices();

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} combat traditions.`});
		});
	}

	/**
	 * Edit combat methods — dedicated flow with tradition grouping and degree filtering.
	 * Modeled on LevelUp's _renderMethodsForLevelUp.
	 */
	async _editCombatMethods (level, history, choice, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change Combat Methods (Level ${level})`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const featureTypeKey = choice.featureTypeKey;
		const featureTypes = featureTypeKey.split("_");
		const requiredCount = choice.count;

		// Get class data and compute filtering params
		const classData = this._page.getClasses()?.find(c => c.name === history.class?.name && c.source === history.class?.source);

		// Get existing optional features from state
		const existingOptFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");

		// Get known traditions
		const knownTraditions = CharacterSheetClassUtils.getKnownCombatTraditions(existingOptFeatures, this._state);
		const maxDegree = CharacterSheetClassUtils.getMaxMethodDegree(classData, level);

		// Merge combat method entities into the pool
		const allOptFeaturesRaw = this._page.filterByAllowedSources?.(this._page.getOptionalFeatures() || []) || [];
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
		const allMethods = [...allOptFeaturesRaw, ...combatMethodEntities];

		// Filter to methods in known traditions at valid degree
		const availableMethods = allMethods.filter(opt => {
			if (!CharacterSheetClassUtils.isCombatMethod(opt)) return false;
			const degree = CharacterSheetClassUtils.getMethodDegree(opt);
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
			return degree > 0 && degree <= maxDegree && tradCode && knownTraditions.includes(tradCode);
		});

		// Deduplicate by edition priority
		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const filteredMethods = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition?.(availableMethods, {showAll}) || availableMethods;

		// Current selections for this type at this level
		const currentSelections = (history.choices.optionalFeatures || []).filter(of => of.type === featureTypeKey);
		const currentNames = new Set(currentSelections.map(s => s.name));

		// Already-known methods from OTHER levels
		const existingFromOtherLevels = new Set();
		for (const entry of this._state.getLevelHistory()) {
			if (entry.level === level) continue;
			for (const of of (entry.choices?.optionalFeatures || [])) {
				if (of.type === featureTypeKey) existingFromOtherLevels.add(of.name);
			}
		}

		// Mark methods
		const processedMethods = filteredMethods.map(opt => ({
			...opt,
			_alreadyKnown: existingFromOtherLevels.has(opt.name) && !currentNames.has(opt.name),
			_degree: CharacterSheetClassUtils.getMethodDegree(opt),
			_tradition: CharacterSheetClassUtils.getMethodTraditionCode(opt),
		}));

		let selectedNames = new Set(currentNames);

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose ${requiredCount} combat method${requiredCount > 1 ? "s" : ""} for this level.</p>
			<p class="ve-small ve-muted mb-2">Max degree: ${maxDegree}${CharacterSheetClassUtils.getOrdinalSuffix?.(maxDegree) || ""} | Traditions: ${knownTraditions.map(t => CharacterSheetClassUtils.getTraditionName(t)).join(", ")}</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-cm-count">${selectedNames.size}</span>/${requiredCount}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {maxHeight: "60vh", overflowY: "auto", border: "1px solid var(--rgb-border-grey)", borderRadius: "4px", padding: "0.5rem"});

		// Group by tradition
		const methodsByTradition = new Map();
		for (const method of processedMethods) {
			const trad = method._tradition;
			if (!methodsByTradition.has(trad)) methodsByTradition.set(trad, []);
			methodsByTradition.get(trad).push(method);
		}

		for (const tradCode of knownTraditions) {
			const methods = methodsByTradition.get(tradCode) || [];
			if (methods.length === 0) continue;

			const tradGroup = e_({outer: `<div class="mb-2"><p class="ve-small mb-1"><strong>${CharacterSheetClassUtils.getTraditionName(tradCode)}</strong></p></div>`});

			methods.sort((a, b) => a._degree - b._degree || a.name.localeCompare(b.name)).forEach(method => {
				const isDisabled = method._alreadyKnown;
				const isSelected = selectedNames.has(method.name);
				const knownBadge = isDisabled ? `<span class="badge badge-secondary ml-1">Known</span>` : "";

				const item = e_({outer: `
					<label style="display:flex; align-items:center; cursor:${isDisabled ? "not-allowed" : "pointer"}; padding:6px 8px; border-bottom:1px solid var(--rgb-border-grey); ${isSelected ? "background: var(--rgb-bg-highlight);" : ""} ${isDisabled ? "opacity:0.5;" : ""}">
						<input type="checkbox" ${isSelected ? "checked" : ""} ${isDisabled ? "disabled" : ""} style="margin-right:8px;">
						<span>
							<span class="respec-hover-slot"></span>
							${knownBadge}
							<span class="ve-muted ve-small ml-1">(${method._degree}${CharacterSheetClassUtils.getOrdinalSuffix?.(method._degree) || ""} degree)</span>
						</span>
					</label>
				`});

				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_COMBAT_METHODS, method.name, method.source);

				if (!isDisabled) {
					item.querySelector("input").addEventListener("change", (evt) => {
						if (evt.target.checked) {
							if (selectedNames.size < requiredCount) {
								selectedNames.add(method.name);
								item.style.background = "var(--rgb-bg-highlight)";
							} else {
								evt.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredCount} combat methods.`});
							}
						} else {
							selectedNames.delete(method.name);
							item.style.background = "";
						}
						document.getElementById("respec-cm-count").textContent = selectedNames.size;
					});
				}

				tradGroup.append(item);
			});

			list.append(tradGroup);
		}

		if ([...list.children].length === 0) {
			list.insertAdjacentHTML("beforeend", `<div class="ve-muted">No combat methods available. Check that traditions are set.</div>`);
		}

		modalInner.append(list);

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedNames.size !== requiredCount) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredCount} combat methods.`});
				return;
			}

			// Build new selections from the full method objects
			const matchingOptions = filteredMethods.filter(opt => CharacterSheetClassUtils.isCombatMethod(opt));
			const newSelections = matchingOptions
				.filter(opt => selectedNames.has(opt.name))
				.map(opt => ({name: opt.name, source: opt.source, type: featureTypeKey}));

			// Remove old method features from state
			for (const old of currentSelections) {
				const stateFeature = existingOptFeatures.find(f =>
					f.name === old.name && f.featureType === "Optional Feature"
					&& (f.optionalFeatureTypes || []).some(ft => featureTypes.includes(ft)),
				);
				if (stateFeature) this._state.removeFeature(stateFeature.id);
			}

			// Add new method features to state
			for (const sel of newSelections) {
				const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
				if (fullOpt) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(fullOpt, {
						className: history.class?.name,
						classSource: history.class?.source,
						level,
						featureType: "Optional Feature",
						optionalFeatureTypes: featureTypes,
					}));
				}
			}

			// Update history — replace optionalFeatures of this type, keep others
			const otherTypeFeatures = (history.choices.optionalFeatures || []).filter(of => of.type !== featureTypeKey);
			const updatedOptionalFeatures = [...otherTypeFeatures, ...newSelections];

			// Also update replayData snapshots
			const newReplaySnapshots = newSelections.map(sel => {
				const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
				return fullOpt
					? CharacterSheetClassUtils.buildHistoryFeatureSnapshot(fullOpt, {type: featureTypeKey})
					: sel;
			});
			const otherTypeReplay = (history.choices.replayData?.optionalFeatures || [])
				.filter(snap => {
					const snapType = snap.type || snap.optionalFeatureTypes?.join("_");
					return snapType !== featureTypeKey;
				});

			this._state.updateLevelChoice(level, {
				optionalFeatures: updatedOptionalFeatures,
				replayData: {
					...(history.choices.replayData || {}),
					optionalFeatures: [...otherTypeReplay, ...newReplaySnapshots],
				},
			});

			this._page.replayHistoryMartialChoices();

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: "Updated combat methods."});
		});
	}

	async _editWeaponMasteries (level, history, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change Level ${level} Weapon Masteries`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const globalMaxMasteries = Math.max(1, this._page.getMaxWeaponMasteries?.() || 1);
		const requiredMasteries = Math.max(
			1,
			history.choices?.weaponMasteries?.length || Math.min(globalMaxMasteries, this._state.getWeaponMasteries().length || 1),
		);
		let selectedMasteries = [...(history.choices?.weaponMasteries || [])];

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose up to ${requiredMasteries} weapon masteries for this level history entry.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-mastery-count">${selectedMasteries.length}</span>/${requiredMasteries}</div>
		</div>`}));

		const weaponsWithMastery = (this._page.getItems() || []).filter(item => {
			if (!item._isBaseItem) return false;
			if (!item.weaponCategory && !["M", "R", "S"].includes(item.type)) return false;
			return item.mastery?.length > 0;
		});

		const simpleWeapons = weaponsWithMastery
			.filter(w => w.weaponCategory === "simple" || w.type === "S")
			.sort((a, b) => a.name.localeCompare(b.name));

		const martialWeapons = weaponsWithMastery
			.filter(w => w.weaponCategory === "martial" || w.type === "M")
			.sort((a, b) => a.name.localeCompare(b.name));

		const renderWeaponGroup = (weapons, groupName) => {
			if (!weapons.length) return;

			const group = e_({outer: `<div class="mb-3"><strong>${groupName}:</strong></div>`});
			const checkboxes = e_({tag: "div"});
			Object.assign(checkboxes.style, {display: "flex", flexWrap: "wrap", gap: "8px"});

			weapons.forEach(weapon => {
				const weaponKey = `${weapon.name}|${weapon.source}`;
				const isSelected = selectedMasteries.includes(weaponKey);
				const label = e_({outer: `
					<label style="display:flex; align-items:center; cursor:pointer; padding:4px 8px; border:1px solid var(--rgb-border-grey); border-radius:4px; ${isSelected ? "background: var(--rgb-bg-highlight);" : ""}">
						<input type="checkbox" value="${weaponKey}" ${isSelected ? "checked" : ""} style="margin-right:6px;">
						<span class="respec-weapon-name"></span>
					</label>
				`});

				// Add hover link for the weapon name
				const weaponNameEl = label.querySelector(".respec-weapon-name");
				try {
					const weaponLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEMS, weapon.name, weapon.source);
					if (typeof weaponLink === "string") weaponNameEl.innerHTML = weaponLink;
					else weaponNameEl.append(weaponLink);
				} catch (e) {
					weaponNameEl.textContent = weapon.name;
				}

				label.querySelector("input").addEventListener("change", (evt) => {
					if (evt.target.checked) {
						if (selectedMasteries.length < requiredMasteries) {
							selectedMasteries.push(weaponKey);
							label.style.background = "var(--rgb-bg-highlight)";
						} else {
							evt.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredMasteries} weapon masteries.`});
						}
					} else {
						selectedMasteries = selectedMasteries.filter(m => m !== weaponKey);
						label.style.background = "";
					}
					document.getElementById("respec-mastery-count").textContent = selectedMasteries.length;
				});

				checkboxes.append(label);
			});

			group.append(checkboxes);
			modalInner.append(group);
		};

		renderWeaponGroup(simpleWeapons, "Simple Weapons");
		renderWeaponGroup(martialWeapons, "Martial Weapons");

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedMasteries.length !== requiredMasteries) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredMasteries} weapon masteries.`});
				return;
			}

			const didUpdate = this._state.updateLevelChoice(level, {weaponMasteries: [...selectedMasteries]});
			if (!didUpdate) {
				JqueryUtil.doToast({type: "danger", content: "Failed to update level history entry."});
				return;
			}
			this._page.replayHistoryMartialChoices();

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} weapon masteries.`});
		});
	}

	/**
	 * Edit optional feature choices (metamagic, invocations, etc.)
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The editable choice descriptor with featureTypeKey and count
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editOptionalFeatures (level, history, choice, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change ${choice.label}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const featureTypeKey = choice.featureTypeKey;
		const requiredCount = choice.count;

		// Get all available optional features of this type
		const allOptFeaturesRaw = this._page.filterByAllowedSources(this._page.getOptionalFeatures() || []);

		// Merge combat method entities for CTM types
		if (featureTypeKey.startsWith("CTM:")) {
			const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
			allOptFeaturesRaw.push(...combatMethodEntities);
		}

		const classData = this._page.getClasses()?.find(c =>
			c.name === history.class?.name && c.source === history.class?.source,
		);
		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const allOptFeatures = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(allOptFeaturesRaw, {showAll});

		// Filter to matching feature type
		const featureTypes = featureTypeKey.split("_");
		const matchingOptions = allOptFeatures.filter(opt => {
			return opt.featureType?.some(ft => featureTypes.some(progType => ft === progType || ft.startsWith(progType)));
		});

		// Current selections for this type
		const currentSelections = (history.choices.optionalFeatures || [])
			.filter(of => of.type === featureTypeKey);
		const currentNames = new Set(currentSelections.map(s => s.name));

		// Get all existing optional features from ALL levels (to filter already-known from other levels)
		const existingFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");
		const existingFromOtherLevels = new Set();
		const allHistory = this._state.getLevelHistory();
		for (const entry of allHistory) {
			if (entry.level === level) continue;
			for (const of of (entry.choices?.optionalFeatures || [])) {
				if (of.type === featureTypeKey) existingFromOtherLevels.add(of.name);
			}
		}

		let selectedNames = new Set(currentNames);

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose ${requiredCount} ${choice.label.toLowerCase()} for this level.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-optfeat-count">${selectedNames.size}</span>/${requiredCount}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {maxHeight: "60vh", overflowY: "auto", border: "1px solid var(--rgb-border-grey)", borderRadius: "4px", padding: "0.5rem"});

		matchingOptions
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach(opt => {
				const isCurrentLevel = currentNames.has(opt.name);
				const isOtherLevel = existingFromOtherLevels.has(opt.name);
				const isSelected = selectedNames.has(opt.name);

				const item = e_({outer: `
					<label style="display:flex; align-items:center; cursor:pointer; padding:6px 8px; border-bottom:1px solid var(--rgb-border-grey); ${isSelected ? "background: var(--rgb-bg-highlight);" : ""} ${isOtherLevel && !isCurrentLevel ? "opacity:0.5;" : ""}">
						<input type="checkbox" ${isSelected ? "checked" : ""} ${isOtherLevel && !isCurrentLevel ? "disabled" : ""} style="margin-right:8px;">
						<span>
							<strong class="respec-opt-name"></strong>
							${opt.source ? `<span class="text-muted ve-small ml-1">[${Parser.sourceJsonToAbv(opt.source)}]</span>` : ""}
							${isOtherLevel && !isCurrentLevel ? `<span class="text-muted ve-small ml-1">(known from another level)</span>` : ""}
						</span>
					</label>
				`});

				// Add hover link for the feature name
				const nameEl = item.querySelector(".respec-opt-name");
				try {
					const isCM = CharacterSheetClassUtils.isCombatMethod(opt);
					const page = isCM ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					const link = CharacterSheetPage.getHoverLink(page, opt.name, opt.source);
					if (typeof link === "string") nameEl.innerHTML = link;
					else nameEl.append(link);
				} catch (e) {
					nameEl.textContent = opt.name;
				}

				item.querySelector("input").addEventListener("change", (evt) => {
					if (evt.target.checked) {
						if (selectedNames.size < requiredCount) {
							selectedNames.add(opt.name);
							item.style.background = "var(--rgb-bg-highlight)";
						} else {
							evt.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredCount} ${choice.label.toLowerCase()}.`});
						}
					} else {
						selectedNames.delete(opt.name);
						item.style.background = "";
					}
					document.getElementById("respec-optfeat-count").textContent = selectedNames.size;
				});

				list.append(item);
			});

		modalInner.append(list);

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedNames.size !== requiredCount) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredCount} ${choice.label.toLowerCase()}.`});
				return;
			}

			// Build new optional feature entries
			const newSelections = matchingOptions
				.filter(opt => selectedNames.has(opt.name))
				.map(opt => ({name: opt.name, source: opt.source, type: featureTypeKey}));

			// Remove old features from state for this type at this level
			for (const old of currentSelections) {
				const stateFeature = existingFeatures.find(f =>
					f.name === old.name && f.featureType === "Optional Feature"
					&& (f.optionalFeatureTypes || []).some(ft => featureTypes.includes(ft)),
				);
				if (stateFeature) this._state.removeFeature(stateFeature.id);
			}

			// Add new features to state
			for (const sel of newSelections) {
				const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
				if (fullOpt) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(fullOpt, {
						className: history.class?.name,
						classSource: history.class?.source,
						level,
						featureType: "Optional Feature",
						optionalFeatureTypes: featureTypes,
					}));
				}
			}

			// Update history entry — replace optionalFeatures of this type, keep others
			const otherTypeFeatures = (history.choices.optionalFeatures || []).filter(of => of.type !== featureTypeKey);
			const updatedOptionalFeatures = [...otherTypeFeatures, ...newSelections];

			// Also update replayData snapshots for this type
			const newReplaySnapshots = newSelections.map(sel => {
				const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
				return fullOpt
					? CharacterSheetClassUtils.buildHistoryFeatureSnapshot(fullOpt, {type: featureTypeKey})
					: sel;
			});
			const otherTypeReplay = (history.choices.replayData?.optionalFeatures || [])
				.filter(snap => {
					const snapType = snap.type || snap.optionalFeatureTypes?.join("_");
					return snapType !== featureTypeKey;
				});

			this._state.updateLevelChoice(level, {
				optionalFeatures: updatedOptionalFeatures,
				replayData: {
					...(history.choices.replayData || {}),
					optionalFeatures: [...otherTypeReplay, ...newReplaySnapshots],
				},
			});

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Updated ${choice.label}.`});
		});
	}

	/**
	 * Set an element's content to a hoverable link, falling back to plain text on error.
	 * @param {HTMLElement} el - The element to populate
	 * @param {string} page - The hover page (e.g. UrlUtil.PG_FEATS)
	 * @param {string} name - The entity name
	 * @param {string} source - The entity source
	 * @param {string|null} [hash] - Optional custom hash
	 * @param {string|null} [displayName] - Optional display name override
	 */
	static _setHoverLink (el, page, name, source, hash = null, displayName = null) {
		if (!name) { el.textContent = "Unknown"; return; }
		try {
			const link = CharacterSheetPage.getHoverLink(page, name, source, hash, displayName);
			if (typeof link === "string") el.innerHTML = link;
			else el.append(link);
		} catch (e) {
			el.textContent = displayName || name;
		}
	}

	/**
	 * Get a human-readable label for an optional feature type code.
	 * @param {string} typeKey - e.g. "MM", "EI", "PB"
	 * @returns {string} Human-readable label
	 */
	static _getOptionalFeatureTypeLabel (typeKey) {
		const typeNames = {
			"EI": "Eldritch Invocations",
			"MM": "Metamagic Options",
			"MV:B": "Battle Master Maneuvers",
			"AS": "Arcane Shot Options",
			"ED": "Elemental Disciplines",
			"PB": "Pact Boons",
			"AI": "Artificer Infusions",
			"RN": "Rune Knight Runes",
		};
		if (typeNames[typeKey]) return typeNames[typeKey];
		if (typeKey.startsWith("CTM:")) return "Combat Methods";
		return `Optional Features (${typeKey})`;
	}

	/**
	 * Edit ASI choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editAsi (level, history, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change Level ${level} Ability Score Improvement`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-asi-modal"});
		content.append(e_({outer: `<h4>Allocate Points (2 points total)</h4>`}));

		const asiState = {...(history.choices?.asi || {})};
		let pointsRemaining = 2 - Object.values(asiState).reduce((sum, v) => sum + v, 0);

		const pointsDisplay = e_({outer: `<div class="charsheet__respec-points-remaining">Points Remaining: <strong>${pointsRemaining}</strong></div>`});
		content.append(pointsDisplay);

		const asiGrid = e_({tag: "div", clazz: "charsheet__respec-asi-grid"});
		Parser.ABIL_ABVS.forEach(abl => {
			const currentBonus = asiState[abl] || 0;
			const baseScore = this._state.getAbilityBase(abl) - (history.choices?.asi?.[abl] || 0);
			const row = e_({outer: `
				<div class="charsheet__respec-asi-row">
					<span class="charsheet__respec-asi-name">${Parser.attAbvToFull(abl)}</span>
					<span class="charsheet__respec-asi-base">${baseScore}</span>
					<div class="charsheet__respec-asi-controls">
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__respec-asi-minus" data-abl="${abl}">-</button>
						<span class="charsheet__respec-asi-bonus" data-abl="${abl}">${currentBonus > 0 ? `+${currentBonus}` : "0"}</span>
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__respec-asi-plus" data-abl="${abl}">+</button>
					</div>
					<span class="charsheet__respec-asi-total">${baseScore + currentBonus}</span>
				</div>
			`});
			asiGrid.append(row);
		});
		content.append(asiGrid);

		// Wire up ASI controls
		content.addEventListener("click", (e) => {
			const plusBtn = e.target.closest(".charsheet__respec-asi-plus");
			if (plusBtn) {
				const abl = plusBtn.dataset.abl;
				const current = asiState[abl] || 0;
				const baseScore = this._state.getAbilityBase(abl) - (history.choices?.asi?.[abl] || 0);
				if (pointsRemaining > 0 && current < 2 && baseScore + current < 20) {
					asiState[abl] = current + 1;
					pointsRemaining--;
					this._updateAsiDisplay(content, asiState, pointsRemaining, pointsDisplay, history);
				}
				return;
			}

			const minusBtn = e.target.closest(".charsheet__respec-asi-minus");
			if (minusBtn) {
				const abl = minusBtn.dataset.abl;
				const current = asiState[abl] || 0;
				if (current > 0) {
					asiState[abl] = current - 1;
					if (asiState[abl] === 0) delete asiState[abl];
					pointsRemaining++;
					this._updateAsiDisplay(content, asiState, pointsRemaining, pointsDisplay, history);
				}
			}
		});

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (pointsRemaining !== 0) {
				JqueryUtil.doToast({type: "warning", content: "Please allocate all 2 points."});
				return;
			}
			await this._applyAsiChange(level, history, asiState);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} ASI.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Edit feat choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editFeat (level, history, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change Level ${level} Feat`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const currentFeat = history.choices?.feat;
		const content = e_({tag: "div", clazz: "charsheet__respec-feat-modal"});

		content.append(e_({outer: `<h4>Select New Feat</h4>`}));
		content.append(e_({outer: `<p class="text-muted mb-2">Current: <strong>${currentFeat?.name || "None"}</strong></p>`}));

		// Feat filter
		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search feats...";
		searchRow.append(searchInput);
		content.append(searchRow);

		// Feat list container
		const featList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		content.append(featList);

		// Load feats
		const feats = this._page._levelUp?._feats || [];
		let selectedFeat = null;

		const renderFeats = (filter = "") => {
			featList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = feats.filter(f => {
				if (!f.name.toLowerCase().includes(filterLower)) return false;
				return true;
			}).slice(0, 50); // Limit for performance

			if (filtered.length === 0) {
				featList.append(e_({outer: `<p class="text-muted">No feats found.</p>`}));
				return;
			}

			filtered.forEach(feat => {
				const isCurrent = currentFeat && feat.name === currentFeat.name && feat.source === currentFeat.source;
				const isSelected = selectedFeat && feat.name === selectedFeat.name && feat.source === selectedFeat.source;
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<span class="respec-hover-slot"></span>
						<span class="text-muted">${Parser.sourceJsonToAbv(feat.source)}</span>
					</div>
				`});
				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_FEATS, feat.name, feat.source);
				item.addEventListener("click", () => {
					selectedFeat = feat;
					featList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");
				});
				featList.append(item);
			});
		};

		renderFeats();

		searchInput.addEventListener("input", () => {
			renderFeats(searchInput.value);
		});

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedFeat) {
				JqueryUtil.doToast({type: "warning", content: "Please select a feat."});
				return;
			}

			await this._applyFeatChange(level, history, selectedFeat);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Changed feat to ${selectedFeat.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Edit feature choice (fighting style, specialty, warden, etc.)
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The choice info (includes label, current, index)
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editFeatureChoice (level, history, choice, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change ${choice.label}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const currentChoice = history.choices.featureChoices[choice.index];
		const content = e_({tag: "div", clazz: "charsheet__respec-feature-modal"});

		content.append(e_({outer: `<p class="text-muted mb-2">Current: <strong>${currentChoice.choice}</strong></p>`}));

		// Get available options for this feature
		const parentFeatureName = currentChoice.featureName;
		const classFeatures = this._page.getClassFeatures();

		// Find the parent feature that defines the options
		const parentFeature = classFeatures.find(f =>
			f.name === parentFeatureName
			&& f.className === history.class.name,
		);

		if (!parentFeature) {
			content.append(e_({outer: `<p class="text-danger">Could not find parent feature "${parentFeatureName}" to load options.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Get options from the parent feature (static ClassUtils method — extracted from LevelUp)
		const optionGroups = CharacterSheetClassUtils.findFeatureOptions(parentFeature, level, classFeatures);

		if (!optionGroups.length || !optionGroups[0].options?.length) {
			content.append(e_({outer: `<p class="text-danger">No alternative options found for this feature.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Get existing features to filter already-chosen options
		const existingFeatures = this._state.getFeatures();
		const existingFeatureNames = new Set(existingFeatures.map(f => f.name));

		// Filter to options not already chosen (except current)
		const availableOptions = optionGroups[0].options.filter(opt => {
			if (opt.name === currentChoice.choice) return true; // Always show current
			return !existingFeatureNames.has(opt.name);
		});

		content.append(e_({outer: `<h5>Select New ${choice.label}</h5>`}));

		// Option list
		const optionList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedOption = null;

		availableOptions.forEach(opt => {
			const isCurrent = opt.name === currentChoice.choice;
			const item = e_({outer: `
				<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""}">
					<span class="respec-hover-slot"></span>
					${opt.source ? `<span class="text-muted">${Parser.sourceJsonToAbv(opt.source)}</span>` : ""}
				</div>
			`});

			// Add hover link — determine page from option type
			const nameEl = item.querySelector(".respec-hover-slot");
			if (opt.type === "classFeature" && opt.ref) {
				const parts = opt.ref.split("|");
				const featureSource = parts[2] || opt.source || history.class?.source;
				try {
					const hash = UrlUtil.encodeArrayForHash(parts[0], parts[1], parts[2], parts[3], featureSource);
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
					nameEl.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${opt.name}</a>`;
				} catch (e) {
					nameEl.textContent = opt.name;
				}
			} else if (opt.source) {
				const page = CharacterSheetClassUtils.isCombatMethod?.(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
				CharacterSheetRespec._setHoverLink(nameEl, page, opt.name, opt.source);
			} else {
				nameEl.textContent = opt.name;
			}

			item.addEventListener("click", () => {
				selectedOption = opt;
				optionList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
				item.classList.add("charsheet__respec-feat-selected");
			});

			optionList.append(item);
		});

		content.append(optionList);

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedOption) {
				JqueryUtil.doToast({type: "warning", content: "Please select an option."});
				return;
			}

			if (selectedOption.name === currentChoice.choice) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			await this._applyFeatureChoiceChange(level, history, choice.index, currentChoice, selectedOption);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Changed ${choice.label} to ${selectedOption.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Apply feature choice change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {number} choiceIndex - Index in featureChoices array
	 * @param {object} oldChoice - The old choice {featureName, choice, source}
	 * @param {object} newOption - The new option to apply
	 */
	async _applyFeatureChoiceChange (level, history, choiceIndex, oldChoice, newOption) {
		// Remove old feature using proper API
		const features = this._state.getFeatures();
		const oldFeature = features.find(f =>
			f.name === oldChoice.choice && f.parentFeature === oldChoice.featureName,
		);
		if (oldFeature) {
			this._state.removeFeature(oldFeature.id);
		} else {
			// Fallback: remove orphaned modifiers by name if feature lookup failed
			this._state.removeModifiersByName(oldChoice.choice);
		}

		// Add new feature
		const classFeatures = this._page.getClassFeatures();
		let fullFeature = null;

		if (newOption.type === "classFeature" && newOption.ref) {
			const parts = newOption.ref.split("|");
			fullFeature = classFeatures.find(f =>
				f.name === parts[0]
				&& f.className === parts[1]
				&& f.source === parts[2],
			);
		}

		this._state.addFeature({
			name: newOption.name,
			source: newOption.source || fullFeature?.source || history.class.source,
			level: newOption.level || level,
			className: newOption.className || history.class.name,
			classSource: history.class.source,
			featureType: "Class",
			entries: fullFeature?.entries,
			description: fullFeature?.entries ? Renderer.get().render({entries: fullFeature.entries}) : "",
			isFeatureOption: true,
			parentFeature: oldChoice.featureName,
		});

		// Apply specialty auto-effects for the new feature (passive bonuses, PB skill bonuses, etc.)
		const autoEffects = CharacterSheetClassUtils.parseFeatureAutoEffects(
			newOption,
			classFeatures,
			{resolvedData: fullFeature},
		);
		autoEffects.forEach(effect => {
			this._state.addNamedModifier({
				name: newOption.name,
				type: effect.type,
				value: effect.value,
				note: effect.note || `From specialty: ${newOption.name}`,
				enabled: true,
			});
		});

		// Update history
		const updatedFeatureChoices = [...history.choices.featureChoices];
		updatedFeatureChoices[choiceIndex] = {
			featureName: oldChoice.featureName,
			choice: newOption.name,
			source: newOption.source,
		};

		this._state.updateLevelChoice(level, {
			featureChoices: updatedFeatureChoices,
		});

		// Recalculate derived values after the swap
		this._state.applyClassFeatureEffects();
		this._state.calculateSpellSlots();
	}

	/**
	 * Update ASI display after change
	 */
	_updateAsiDisplay (section, asiState, pointsRemaining, pointsDisplay, history) {
		pointsDisplay.innerHTML = `Points Remaining: <strong>${pointsRemaining}</strong>`;
		pointsDisplay.classList.toggle("text-danger", pointsRemaining < 0);
		pointsDisplay.classList.toggle("text-success", pointsRemaining === 0);

		Parser.ABIL_ABVS.forEach(abl => {
			const bonus = asiState[abl] || 0;
			const baseScore = this._state.getAbilityBase(abl) - (history.choices?.asi?.[abl] || 0);
			const bonusEl = section.querySelector(`.charsheet__respec-asi-bonus[data-abl="${abl}"]`);
			if (bonusEl) bonusEl.textContent = bonus > 0 ? `+${bonus}` : "0";
			const totalEl = section.querySelector(`.charsheet__respec-asi-row:has([data-abl="${abl}"]) .charsheet__respec-asi-total`);
			if (totalEl) totalEl.textContent = baseScore + bonus;
		});
	}

	/**
	 * Apply ASI change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} newAsi - New ASI allocation
	 */
	async _applyAsiChange (level, history, newAsi) {
		const oldAsi = history.choices?.asi || {};

		// Revert old ASI bonuses
		Object.entries(oldAsi).forEach(([abl, bonus]) => {
			const current = this._state.getAbilityBase(abl);
			this._state.setAbilityBase(abl, current - bonus);
		});

		// Apply new ASI bonuses
		Object.entries(newAsi).forEach(([abl, bonus]) => {
			const current = this._state.getAbilityBase(abl);
			this._state.setAbilityBase(abl, Math.min(20, current + bonus));
		});

		// Update history - only update ASI, preserve feat (Thelemar rule support)
		this._state.updateLevelChoice(level, {
			asi: newAsi,
		});

		// Update the ASI tracking feature
		const features = this._state.getFeatures();
		const asiFeature = features.find(f => f.isAsiChoice && f.level === level);
		if (asiFeature) {
			const increases = Object.entries(newAsi)
				.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`)
				.join(", ");
			asiFeature.description = `<p><strong>Ability Score Increases:</strong> ${increases}</p>`;
		}
	}

	/**
	 * Apply feat change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} newFeat - The new feat
	 */
	async _applyFeatChange (level, history, newFeat) {
		const oldFeat = history.choices?.feat;

		// Remove old feat from features
		if (oldFeat) {
			let features = this._state.getFeatures();
			features = features.filter(f => !(f.name === oldFeat.name && f.source === oldFeat.source && f.level === level));
			this._state._character.features = features;

			// Remove old feat bonuses (simplified - full implementation would need to track all feat effects)
			// This needs expansion to handle all feat types properly
		}

		// Add new feat to features
		const feature = {
			name: newFeat.name,
			source: newFeat.source,
			description: Renderer.get().render({entries: newFeat.entries || []}),
			level: level,
			featureType: "Feat",
		};
		const features = this._state.getFeatures();
		features.push(feature);

		// Apply new feat bonuses (simplified)
		if (newFeat.ability) {
			// Handle ability score increases from feat
			newFeat.ability.forEach(abilityOption => {
				let applied = false;
				if (abilityOption.choose) {
					// Needs UI for choosing - skip for now
				} else {
					Parser.ABIL_ABVS.forEach(abl => {
						if (abilityOption[abl] && !applied) {
							const current = this._state.getAbilityBase(abl);
							this._state.setAbilityBase(abl, Math.min(20, current + abilityOption[abl]));
							applied = true;
						}
					});
				}
			});
		}

		// Update history - only update feat, preserve ASI (Thelemar rule support)
		this._state.updateLevelChoice(level, {
			feat: {
				name: newFeat.name,
				source: newFeat.source,
			},
		});
	}

	/**
	 * Edit subclass choice - shows cascade warning and handles feature removal
	 * @param {number} level - The level where subclass was chosen
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editSubclass (level, history, closeParentModal) {
		const currentSubclass = history.choices?.subclass;
		if (!currentSubclass) {
			JqueryUtil.doToast({type: "warning", content: "No subclass found at this level."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Change ${history.class.name} Subclass`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		// Show current subclass
		content.append(e_({outer: `<p class="text-muted mb-2">Current Subclass: <strong>${currentSubclass.name}</strong></p>`}));

		// Get available subclasses for this class
		const classes = this._page.getClasses();
		const classData = classes.find(c => c.name === history.class.name && c.source === history.class.source);

		if (!classData?.subclasses?.length) {
			content.append(e_({outer: `<p class="text-danger">Could not find subclass options for ${history.class.name}.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Filter subclasses by allowed sources
		let availableSubclasses = classData.subclasses;
		if (this._page.filterByAllowedSources) {
			availableSubclasses = this._page.filterByAllowedSources(availableSubclasses);
		}

		// Calculate what will be removed
		const featuresToRemove = this._getSubclassFeatures(currentSubclass);
		const willRemoveCount = featuresToRemove.length;

		// Show cascade warning
		if (willRemoveCount > 0) {
			const warning = e_({outer: `
				<div class="charsheet__respec-cascade-warning">
					<h5><span class="text-warning">\u26a0\ufe0f</span> Features to be removed (${willRemoveCount}):</h5>
					<ul class="charsheet__respec-cascade-list"></ul>
				</div>
			`});
			const warningList = warning.querySelector(".charsheet__respec-cascade-list");
			featuresToRemove.slice(0, 10).forEach(f => {
				warningList.append(e_({outer: `<li>${f.name} <span class="text-muted">(Level ${f.level})</span></li>`}));
			});
			if (willRemoveCount > 10) {
				warningList.append(e_({outer: `<li class="text-muted">...and ${willRemoveCount - 10} more</li>`}));
			}
			content.append(warning);
		}

		// Subclass selection
		content.append(e_({outer: `<h5>Select New Subclass</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search subclasses...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const subclassList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedSubclass = null;

		const renderSubclasses = (filter = "") => {
			subclassList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = availableSubclasses.filter(sc => {
				if (!sc.name.toLowerCase().includes(filterLower)) return false;
				return true;
			}).slice(0, 30);

			if (filtered.length === 0) {
				subclassList.append(e_({outer: `<p class="text-muted">No subclasses found.</p>`}));
				return;
			}

			filtered.forEach(subclass => {
				const isCurrent = subclass.name === currentSubclass.name && subclass.source === currentSubclass.source;
				const isSelected = selectedSubclass && subclass.name === selectedSubclass.name && subclass.source === selectedSubclass.source;
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<span class="respec-hover-slot"></span>
						<span class="text-muted">${Parser.sourceJsonToAbv(subclass.source)}</span>
					</div>
				`});
				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_CLASSES, subclass.name, subclass.source);
				item.addEventListener("click", () => {
					selectedSubclass = subclass;
					subclassList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");
				});
				subclassList.append(item);
			});
		};

		renderSubclasses();

		searchInput.addEventListener("input", () => {
			renderSubclasses(searchInput.value);
		});

		content.append(subclassList);

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Subclass"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedSubclass) {
				JqueryUtil.doToast({type: "warning", content: "Please select a subclass."});
				return;
			}

			if (selectedSubclass.name === currentSubclass.name && selectedSubclass.source === currentSubclass.source) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			// Confirm cascade removal
			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Confirm Subclass Change",
				htmlDescription: `<p>This will remove <strong>${willRemoveCount}</strong> features from your character and add all features from <strong>${selectedSubclass.name}</strong> up to your current level.</p><p>Are you sure?</p>`,
				textYes: "Change Subclass",
				textNo: "Cancel",
			});

			if (!confirmed) return;

			await this._applySubclassChange(level, history, currentSubclass, selectedSubclass);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Changed subclass to ${selectedSubclass.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Get all features that belong to a specific subclass
	 * @param {object} subclass - The subclass {name, shortName, source}
	 * @returns {Array} Array of features to remove
	 */
	_getSubclassFeatures (subclass) {
		const features = this._state.getFeatures();
		return features.filter(f => {
			// Check if feature is explicitly a subclass feature
			if (f.isSubclassFeature) {
				// Match by subclass name or short name
				if (f.subclassName === subclass.name || f.subclassShortName === subclass.shortName) {
					return true;
				}
			}
			// Check if feature has subclass source matching
			if (f.subclassSource === subclass.source && f.subclassShortName === subclass.shortName) {
				return true;
			}
			return false;
		});
	}

	/**
	 * Apply subclass change - removes old features and adds new ones
	 * @param {number} level - The level where subclass was chosen
	 * @param {object} history - The history entry
	 * @param {object} oldSubclass - The old subclass
	 * @param {object} newSubclass - The new subclass
	 */
	async _applySubclassChange (level, history, oldSubclass, newSubclass) {
		// Get current total level for this class
		const classes = this._state.getClasses();
		const classEntry = classes.find(c => c.name === history.class.name);
		const classLevel = classEntry?.level || 1;

		// Remove old subclass features using proper API
		const featuresToRemove = this._getSubclassFeatures(oldSubclass);
		featuresToRemove.forEach(f => {
			this._state.removeFeature(f.id);
		});

		// Update class entry with new subclass
		if (classEntry) {
			classEntry.subclass = {
				name: newSubclass.name,
				shortName: newSubclass.shortName,
				source: newSubclass.source,
				casterProgression: newSubclass.casterProgression,
				spellcastingAbility: newSubclass.spellcastingAbility,
				additionalSpells: newSubclass.additionalSpells,
			};
		}

		// Get new subclass features up to current level
		const subclassFeatures = this._page.getSubclassFeatures?.() || [];
		const newFeatures = subclassFeatures.filter(f => {
			if (f.subclassShortName !== newSubclass.shortName) return false;
			if (f.subclassSource !== newSubclass.source) return false;
			if (f.className !== history.class.name) return false;
			if (f.level > classLevel) return false;
			return true;
		});

		// Add new subclass features
		newFeatures.forEach(f => {
			this._state.addFeature({
				name: f.name,
				source: f.source,
				level: f.level,
				className: f.className,
				classSource: f.classSource,
				subclassName: newSubclass.name,
				subclassShortName: newSubclass.shortName,
				subclassSource: newSubclass.source,
				featureType: "Subclass",
				entries: f.entries,
				description: f.entries ? Renderer.get().render({entries: f.entries}) : "",
				isSubclassFeature: true,
			});
		});

		// Update all level history entries that had the old subclass
		const levelHistory = this._state.getLevelHistory();
		levelHistory.forEach(entry => {
			if (entry.choices?.subclass?.name === oldSubclass.name) {
				this._state.updateLevelChoice(entry.level, {
					subclass: {
						name: newSubclass.name,
						shortName: newSubclass.shortName,
						source: newSubclass.source,
					},
				});
			}
		});
	}

	// region Race/Background Respec

	async _editRace (level, history, closeParentModal) {
		const races = this._page.filterByAllowedSources(this._page.getRaces());

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Change Species",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		const currentRaceName = this._state.getRaceName();
		content.append(e_({outer: `<p class="text-muted mb-2">Current Species: <strong>${Renderer.stripTags(currentRaceName || "Unknown")}</strong></p>`}));

		content.append(e_({outer: `
			<div class="charsheet__respec-cascade-warning">
				<h5><span class="text-warning">\u26a0\ufe0f</span> Species Change Impact</h5>
				<p class="ve-small">Changing species will replace all racial traits (speed, darkvision, resistances, languages, skills, proficiencies) and recalculate ability score bonuses.</p>
			</div>
		`}));

		content.append(e_({outer: `<h5>Select New Species</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search species...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const raceList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedRace = null;
		let currentPickers = [];
		let choicesPanel;
		let fnUpdateApplyState;

		const renderRaces = (filter = "") => {
			raceList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = races
				.filter(r => !r._isBaseRace)
				.filter(r => !filter || r.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 50);

			if (filtered.length === 0) {
				raceList.append(e_({outer: `<p class="text-muted">No species found.</p>`}));
				return;
			}

			const currentRace = this._state.getRace();
			filtered.forEach(race => {
				const isCurrent = race.name === currentRace?.name && race.source === currentRace?.source;
				const isSelected = selectedRace?.name === race.name && selectedRace?.source === race.source;
				const displayName = Renderer.stripTags(race.name);
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<strong>${displayName}</strong>
						<span class="text-muted">${Parser.sourceJsonToAbv(race.source)}</span>
					</div>
				`});
				item.addEventListener("click", () => {
					selectedRace = race;
					raceList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");

					// Render choice pickers for the selected race
					if (choicesPanel) {
						choicesPanel.innerHTML = "";
						currentPickers = [];
						const langPicker = this._renderLanguageChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (langPicker) currentPickers.push(langPicker);
						const skillPicker = this._renderSkillChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (skillPicker) currentPickers.push(skillPicker);
						const toolPicker = this._renderToolChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (toolPicker) currentPickers.push(toolPicker);
						const abiPicker = this._renderAbilityChoicePickers(choicesPanel, race, "rc", () => fnUpdateApplyState?.());
						if (abiPicker) currentPickers.push(abiPicker);
					}
					fnUpdateApplyState?.();
				});
				raceList.append(item);
			});
		};

		renderRaces();
		searchInput.addEventListener("input", () => renderRaces(searchInput.value));
		content.append(raceList);

		choicesPanel = e_({tag: "div", clazz: "charsheet__respec-choices-panel mt-2"});
		content.append(choicesPanel);

		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Species"});

		fnUpdateApplyState = () => {
			applyBtn.disabled = !selectedRace || currentPickers.some(p => !p.isComplete());
		};

		applyBtn.addEventListener("click", async () => {
			if (!selectedRace) {
				JqueryUtil.doToast({type: "warning", content: "Please select a species."});
				return;
			}

			if (currentPickers.some(p => !p.isComplete())) {
				JqueryUtil.doToast({type: "warning", content: "Please complete all choices."});
				return;
			}

			const currentRace = this._state.getRace();
			if (selectedRace.name === currentRace?.name && selectedRace.source === currentRace?.source) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Confirm Species Change",
				htmlDescription: `<p>This will replace all racial traits from <strong>${Renderer.stripTags(currentRaceName)}</strong> with traits from <strong>${Renderer.stripTags(selectedRace.name)}</strong>.</p><p>Are you sure?</p>`,
				textYes: "Change Species",
				textNo: "Cancel",
			});

			if (!confirmed) return;

			const userChoices = {};
			currentPickers.forEach(p => {
				if (p.type === "language") userChoices.selectedLanguages = p.getSelections();
				else if (p.type === "skill") userChoices.selectedSkills = p.getSelections();
				else if (p.type === "tool") userChoices.selectedTools = p.getSelections();
				else if (p.type === "ability") userChoices.selectedAbilityChoices = p.getSelections();
			});

			this._applyRaceChange(history, selectedRace, userChoices);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Changed species to ${Renderer.stripTags(selectedRace.name)}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);
		modalInner.append(content);
	}

	async _editBackground (level, history, closeParentModal) {
		const backgrounds = this._page.filterByAllowedSources(this._page.getBackgrounds());

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Change Background",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		const currentBgName = this._state.getBackgroundName() || "Unknown";
		content.append(e_({outer: `<p class="text-muted mb-2">Current Background: <strong>${Renderer.stripTags(currentBgName)}</strong></p>`}));

		content.append(e_({outer: `
			<div class="charsheet__respec-cascade-warning">
				<h5><span class="text-warning">\u26a0\ufe0f</span> Background Change Impact</h5>
				<p class="ve-small">Changing background will replace background skills, tools, languages, features, and may recalculate ability score bonuses.</p>
			</div>
		`}));

		content.append(e_({outer: `<h5>Select New Background</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search backgrounds...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const bgList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedBg = null;
		let currentPickers = [];
		let choicesPanel;
		let fnUpdateApplyState;

		const renderBgs = (filter = "") => {
			bgList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = backgrounds
				.filter(bg => !filter || bg.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 50);

			if (filtered.length === 0) {
				bgList.append(e_({outer: `<p class="text-muted">No backgrounds found.</p>`}));
				return;
			}

			const currentBg = this._state.getBackground();
			filtered.forEach(bg => {
				const isCurrent = bg.name === currentBg?.name && bg.source === currentBg?.source;
				const isSelected = selectedBg?.name === bg.name && selectedBg?.source === bg.source;
				const displayName = Renderer.stripTags(bg.name);
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<strong>${displayName}</strong>
						<span class="text-muted">${Parser.sourceJsonToAbv(bg.source)}</span>
					</div>
				`});
				item.addEventListener("click", () => {
					selectedBg = bg;
					bgList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");

					// Render choice pickers for the selected background
					if (choicesPanel) {
						choicesPanel.innerHTML = "";
						currentPickers = [];
						const langPicker = this._renderLanguageChoicePickers(choicesPanel, bg, () => fnUpdateApplyState?.());
						if (langPicker) currentPickers.push(langPicker);
						const toolPicker = this._renderToolChoicePickers(choicesPanel, bg, () => fnUpdateApplyState?.());
						if (toolPicker) currentPickers.push(toolPicker);
						const abiPicker = this._renderAbilityChoicePickers(choicesPanel, bg, "bg", () => fnUpdateApplyState?.());
						if (abiPicker) currentPickers.push(abiPicker);
					}
					fnUpdateApplyState?.();
				});
				bgList.append(item);
			});
		};

		renderBgs();
		searchInput.addEventListener("input", () => renderBgs(searchInput.value));
		content.append(bgList);

		choicesPanel = e_({tag: "div", clazz: "charsheet__respec-choices-panel mt-2"});
		content.append(choicesPanel);

		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Background"});

		fnUpdateApplyState = () => {
			applyBtn.disabled = !selectedBg || currentPickers.some(p => !p.isComplete());
		};

		applyBtn.addEventListener("click", async () => {
			if (!selectedBg) {
				JqueryUtil.doToast({type: "warning", content: "Please select a background."});
				return;
			}

			if (currentPickers.some(p => !p.isComplete())) {
				JqueryUtil.doToast({type: "warning", content: "Please complete all choices."});
				return;
			}

			const currentBg = this._state.getBackground();
			if (selectedBg.name === currentBg?.name && selectedBg.source === currentBg?.source) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			const confirmed = await InputUiUtil.pGetUserBoolean({
				title: "Confirm Background Change",
				htmlDescription: `<p>This will replace all background traits from <strong>${Renderer.stripTags(currentBgName)}</strong> with traits from <strong>${Renderer.stripTags(selectedBg.name)}</strong>.</p><p>Are you sure?</p>`,
				textYes: "Change Background",
				textNo: "Cancel",
			});

			if (!confirmed) return;

			const userChoices = {};
			currentPickers.forEach(p => {
				if (p.type === "language") userChoices.selectedLanguages = p.getSelections();
				else if (p.type === "tool") userChoices.selectedTools = p.getSelections();
				else if (p.type === "ability") userChoices.selectedAbilityBonuses = p.getSelections();
			});

			this._applyBackgroundChange(history, selectedBg, userChoices);

			doClose();
			closeParentModal();
			this.render();
			this._page.renderCharacter();
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Changed background to ${Renderer.stripTags(selectedBg.name)}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);
		modalInner.append(content);
	}

	/**
	 * Clear old race grants and apply new race traits.
	 * Mirrors the builder's _applyRacialTraits pattern.
	 */
	_applyRaceChange (history, newRace, userChoices = {}) {
		const oldRace = this._state.getRace();
		const oldSubrace = this._state.getSubrace();
		const oldUserChoices = history.choices?.raceUserChoices || {};

		// --- CLEAR OLD RACE GRANTS ---

		// Remove race/subrace features
		const features = this._state.getFeatures();
		features
			.filter(f => f.featureType === "Species" || f.featureType === "Subrace" || f.featureType === "Race")
			.forEach(f => this._state.removeFeature(f.id));

		// Reset speed
		this._state.setSpeed("walk", 30);
		["fly", "swim", "climb", "burrow"].forEach(t => this._state.setSpeed(t, 0));

		// Remove race-sourced named modifiers (e.g., equalToWalk speeds)
		const namedMods = this._state.getNamedModifiers();
		namedMods.filter(m => m.sourceType === "race").forEach(m => this._state.removeNamedModifier(m.id));

		// Reset senses
		this._state.setSense("darkvision", 0);

		// Clear ability bonuses (will be reapplied for both race and background)
		Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));

		// Clear old racial languages
		this._clearLanguagesFromData(oldRace);
		this._clearLanguagesFromData(oldSubrace);
		this._clearUserChosenLanguages(oldUserChoices);

		// Clear old racial skills
		this._clearSkillsFromData(oldRace);
		this._clearSkillsFromData(oldSubrace);
		this._clearUserChosenSkills(oldUserChoices);

		// Clear old racial resistances
		this._clearResistancesFromData(oldRace);
		this._clearResistancesFromData(oldSubrace);

		// Clear old racial proficiencies
		this._clearProficienciesFromData(oldRace, oldSubrace);
		if (oldUserChoices.selectedTools?.length) {
			oldUserChoices.selectedTools.forEach(tool => this._state.removeToolProficiency(tool.toTitleCase()));
		}

		// --- APPLY NEW RACE GRANTS ---

		// Determine subrace from merged race data
		const newSubrace = newRace._baseName ? null : null;
		this._state.setRace(newRace, newSubrace);

		// Speed
		this._applySpeedFromRaceData(newRace);

		// Senses
		if (newRace.darkvision) this._state.setSense("darkvision", newRace.darkvision);

		// Fixed languages
		this._applyFixedLanguages(newRace);

		// Fixed skills
		this._applyFixedSkills(newRace);

		// Resistances
		if (newRace.resist) {
			newRace.resist.forEach(r => {
				if (typeof r === "string") this._state.addResistance(r);
			});
		}

		// Fixed ability bonuses
		if (newRace.ability) {
			newRace.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Armor, weapon, tool proficiencies
		this._applyProficienciesFromData(newRace);

		// Race features (entries)
		if (newRace.entries) {
			newRace.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{...entry, source: entry.source || newRace.source},
						{featureType: "Species"},
					));
				}
			});
		}

		// Reapply background ability bonuses (since we reset all to 0)
		this._reapplyBackgroundAbilityBonuses(history);

		// Apply user-chosen languages
		if (userChoices.selectedLanguages) {
			Object.values(userChoices.selectedLanguages).forEach(langs => {
				if (Array.isArray(langs)) langs.forEach(lang => this._state.addLanguage(lang));
			});
		}

		// Apply user-chosen skills
		if (userChoices.selectedSkills?.length) {
			userChoices.selectedSkills.forEach(skill => {
				this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 1);
			});
		}

		// Apply user-chosen tools
		if (userChoices.selectedTools?.length) {
			userChoices.selectedTools.forEach(tool => {
				this._state.addToolProficiency(tool);
			});
		}

		// Apply user-chosen ability bonuses
		if (userChoices.selectedAbilityChoices) {
			Object.entries(userChoices.selectedAbilityChoices).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = userChoices.selectedAbilityChoices[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}

		// Update level history
		this._state.updateLevelChoice(1, {
			race: {
				name: newRace.name,
				source: newRace.source,
			},
			raceUserChoices: userChoices,
		});
	}

	/**
	 * Clear old background grants and apply new background traits.
	 * Mirrors the builder's _applyBackgroundFeatures pattern.
	 */
	_applyBackgroundChange (history, newBg, userChoices = {}) {
		const oldBg = this._state.getBackground();
		const oldUserChoices = history.choices?.backgroundUserChoices || {};

		// --- CLEAR OLD BACKGROUND GRANTS ---

		// Remove background features
		const features = this._state.getFeatures();
		features
			.filter(f => f.featureType === "Background")
			.forEach(f => this._state.removeFeature(f.id));

		// Clear old background ability bonuses (reset all, will reapply race + new bg)
		Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));

		// Clear old background skills
		this._clearSkillsFromData(oldBg);

		// Clear old background tools
		this._clearToolsFromData(oldBg);
		if (oldUserChoices.selectedTools?.length) {
			oldUserChoices.selectedTools.forEach(c => {
				if (c.tool) this._state.removeToolProficiency(c.tool.toTitleCase());
			});
		}

		// Clear old background languages
		this._clearLanguagesFromData(oldBg);
		if (oldUserChoices.selectedLanguages?.length) {
			oldUserChoices.selectedLanguages.forEach(c => {
				if (c.language) this._state.removeLanguage(c.language);
			});
		}

		// --- APPLY NEW BACKGROUND GRANTS ---

		this._state.setBackground(newBg);

		// Skills
		this._applyFixedSkills(newBg);

		// Tools
		this._applyFixedTools(newBg);

		// Languages
		this._applyFixedLanguages(newBg);

		// Features
		if (newBg.entries) {
			newBg.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{...entry, source: entry.source || newBg.source},
						{featureType: "Background"},
					));
				}
			});
		}

		// Reapply racial ability bonuses (since we reset all to 0)
		this._reapplyRacialAbilityBonuses(history);

		// Reapply newly-selected background ability bonuses
		// For 2024 backgrounds with ability choices, apply fixed bonuses only
		if (newBg.ability) {
			newBg.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Apply user-chosen languages
		if (userChoices.selectedLanguages?.length) {
			userChoices.selectedLanguages.forEach(lang => {
				this._state.addLanguage(lang);
			});
		}

		// Apply user-chosen tools
		if (userChoices.selectedTools?.length) {
			userChoices.selectedTools.forEach(tool => {
				this._state.addToolProficiency(tool);
			});
		}

		// Apply user-chosen ability bonuses
		if (userChoices.selectedAbilityBonuses) {
			Object.entries(userChoices.selectedAbilityBonuses).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = userChoices.selectedAbilityBonuses[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}

		// Update level history — convert to storage format
		const storedUserChoices = {};
		if (userChoices.selectedLanguages?.length) {
			storedUserChoices.selectedLanguages = userChoices.selectedLanguages.map(l => ({language: l}));
		}
		if (userChoices.selectedTools?.length) {
			storedUserChoices.selectedTools = userChoices.selectedTools.map(t => ({tool: t}));
		}
		if (userChoices.selectedAbilityBonuses) {
			storedUserChoices.selectedAbilityBonuses = userChoices.selectedAbilityBonuses;
		}

		this._state.updateLevelChoice(1, {
			background: {
				name: newBg.name,
				source: newBg.source,
			},
			backgroundUserChoices: storedUserChoices,
		});
	}

	// region Choice Picker Helpers

	/**
	 * Render language choice pickers for "anyStandard", "any", or "choose" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderLanguageChoicePickers (container, data, onUpdate) {
		if (!data?.languageProficiencies) return null;

		const langGroups = this._page.getLanguageOptionsGrouped();
		const standardLangs = langGroups.standard || [];
		const allLangs = [
			...(langGroups.standard || []),
			...(langGroups.exotic || []),
			...(langGroups.secret || []),
			...(langGroups.homebrew || []),
		];

		const selections = {}; // {profIdx: [lang|null, ...]}
		let totalRequired = 0;
		let hasAny = false;

		data.languageProficiencies.forEach((langProf, profIdx) => {
			if (!selections[profIdx]) selections[profIdx] = [];

			const addDropdowns = (count, options, noun) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Language:</strong> Choose ${count} ${noun}${count > 1 ? "s" : ""}:</p>`}));
				for (let i = 0; i < count; i++) {
					const idx = selections[profIdx].length;
					selections[profIdx].push(null);
					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Language --</option></select>`});
					options.forEach(lang => selectEl.append(e_({outer: `<option value="${lang}">${lang}</option>`})));
					selectEl.addEventListener("change", () => {
						selections[profIdx][idx] = selectEl.value || null;
						onUpdate();
					});
					container.append(selectEl);
				}
			};

			if (langProf.anyStandard) {
				addDropdowns(typeof langProf.anyStandard === "number" ? langProf.anyStandard : 1, standardLangs, "standard language");
			}
			if (langProf.any) {
				addDropdowns(typeof langProf.any === "number" ? langProf.any : 1, allLangs, "language");
			}
			if (langProf.choose) {
				const from = (langProf.choose.from || []).map(l => l.split("|")[0].toTitleCase());
				addDropdowns(langProf.choose.count || 1, from, "language");
			}
		});

		if (!hasAny) return null;

		return {
			type: "language",
			getSelections: () => {
				const result = {};
				Object.entries(selections).forEach(([profIdx, langs]) => {
					result[profIdx] = langs.filter(l => l);
				});
				return result;
			},
			isComplete: () => {
				let filled = 0;
				Object.values(selections).forEach(arr => arr.forEach(v => { if (v) filled++; }));
				return filled >= totalRequired;
			},
		};
	}

	/**
	 * Render skill choice pickers for "any" or "choose" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderSkillChoicePickers (container, data, onUpdate) {
		if (!data?.skillProficiencies) return null;

		const allSkillNames = Parser.SKILL_TO_ATB_ABV
			? Object.keys(Parser.SKILL_TO_ATB_ABV).map(s => s.toTitleCase())
			: [];

		const selected = [];
		let totalRequired = 0;
		let hasAny = false;

		data.skillProficiencies.forEach(skillProf => {
			const addCheckboxes = (count, options, label) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Skills:</strong> ${label}</p>`}));
				const checkboxContainer = e_({tag: "div", clazz: "charsheet__respec-skill-checkboxes mb-1"});
				options.forEach(skill => {
					const lbl = e_({outer: `<label class="mr-3 mb-1"><input type="checkbox" value="${skill}"> ${skill}</label>`});
					lbl.querySelector("input").addEventListener("change", (evt) => {
						if (evt.target.checked) {
							if (selected.length < totalRequired) {
								selected.push(skill);
							} else {
								evt.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${totalRequired} skill${totalRequired > 1 ? "s" : ""}.`});
							}
						} else {
							const idx = selected.indexOf(skill);
							if (idx >= 0) selected.splice(idx, 1);
						}
						onUpdate();
					});
					checkboxContainer.append(lbl);
				});
				container.append(checkboxContainer);
			};

			if (skillProf.any) {
				const count = typeof skillProf.any === "number" ? skillProf.any : 1;
				addCheckboxes(count, allSkillNames, `Choose any ${count} skill${count > 1 ? "s" : ""}:`);
			}
			if (skillProf.choose) {
				const count = skillProf.choose.count || 1;
				const from = (skillProf.choose.from || []).map(s => s.split("|")[0].toTitleCase());
				addCheckboxes(count, from, `Choose ${count} skill${count > 1 ? "s" : ""}:`);
			}
		});

		if (!hasAny) return null;

		return {
			type: "skill",
			getSelections: () => [...selected],
			isComplete: () => selected.length >= totalRequired,
		};
	}

	/**
	 * Render tool choice pickers for "any", "choose", "anyArtisansTool", "anyMusicalInstrument" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderToolChoicePickers (container, data, onUpdate) {
		if (!data?.toolProficiencies) return null;

		const artisanTools = [
			"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
			"Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
			"Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
			"Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
			"Potter's Tools", "Smith's Tools", "Tinker's Tools",
			"Weaver's Tools", "Woodcarver's Tools",
		];
		const musicalInstruments = [
			"Bagpipes", "Drum", "Dulcimer", "Flute", "Horn",
			"Lute", "Lyre", "Pan Flute", "Shawm", "Viol",
		];
		const allTools = [
			...artisanTools, "Disguise Kit", "Forgery Kit", "Herbalism Kit",
			...musicalInstruments, "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools",
		].sort();

		const selected = [];
		let totalRequired = 0;
		let hasAny = false;

		data.toolProficiencies.forEach(toolProf => {
			const addDropdowns = (count, options, label) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Tools:</strong> ${label}</p>`}));
				for (let i = 0; i < count; i++) {
					const idx = selected.length;
					selected.push(null);
					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Tool --</option></select>`});
					options.forEach(tool => selectEl.append(e_({outer: `<option value="${tool}">${tool}</option>`})));
					selectEl.addEventListener("change", () => {
						selected[idx] = selectEl.value || null;
						onUpdate();
					});
					container.append(selectEl);
				}
			};

			if (toolProf.any) {
				const count = typeof toolProf.any === "number" ? toolProf.any : 1;
				addDropdowns(count, allTools, `Choose ${count} tool${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.anyArtisansTool) {
				const count = typeof toolProf.anyArtisansTool === "number" ? toolProf.anyArtisansTool : 1;
				addDropdowns(count, artisanTools, `Choose ${count} artisan's tool${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.anyMusicalInstrument) {
				const count = typeof toolProf.anyMusicalInstrument === "number" ? toolProf.anyMusicalInstrument : 1;
				addDropdowns(count, musicalInstruments, `Choose ${count} musical instrument${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.choose) {
				const from = (toolProf.choose.from || []).map(t => t.toTitleCase());
				addDropdowns(toolProf.choose.count || 1, from, `Choose ${toolProf.choose.count || 1} tool${(toolProf.choose.count || 1) > 1 ? "s" : ""}:`);
			}
		});

		if (!hasAny) return null;

		return {
			type: "tool",
			getSelections: () => selected.filter(t => t),
			isComplete: () => selected.filter(t => t).length >= totalRequired,
		};
	}

	/**
	 * Render ability score choice pickers for "choose" entries in ability data.
	 * @param {string} prefix - "rc" for race choices, "bg" for background choices
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderAbilityChoicePickers (container, data, prefix, onUpdate) {
		if (!data?.ability) return null;

		// Collect ability sets that require choices
		const chooseSets = data.ability.filter(abiSet => abiSet.choose);
		if (!chooseSets.length) return null;

		const selections = {};
		let activeSetIdx = 0;

		// Helper: render pickers for a single ability set
		const renderAbiSet = (choose, pickersContainer) => {
			pickersContainer.innerHTML = "";
			// Clear previous selections
			Object.keys(selections).forEach(k => delete selections[k]);

			const abilities = choose.from || choose.weighted?.from || Parser.ABIL_ABVS;

			if (choose.weighted) {
				const weights = choose.weighted.weights || [2, 1];
				const asiContainer = e_({tag: "div", clazz: "charsheet__respec-asi-choices mb-1"});

				weights.forEach((weight, idx) => {
					const key = `${prefix}_${idx}`;
					selections[key] = null;
					selections[`${key}_weight`] = weight;

					const row = e_({tag: "div", clazz: "ve-flex-v-center mb-1"});
					row.append(e_({outer: `<span class="mr-2">+${weight}:</span>`}));

					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${idx}"><option value="">-- Select --</option></select>`});
					abilities.forEach(ab => {
						selectEl.append(e_({outer: `<option value="${ab}">${Parser.attAbvToFull(ab)}</option>`}));
					});

					selectEl.addEventListener("change", () => {
						selections[key] = selectEl.value || null;
						// Cross-disable: prevent same ability in multiple dropdowns
						[...asiContainer.querySelectorAll("select")].forEach(sel => {
							const selIdx = parseInt(sel.dataset.asiIdx);
							if (selIdx !== idx) {
								[...sel.querySelectorAll("option")].forEach(opt => {
									if (!opt.value) return;
									const isUsedElsewhere = Object.entries(selections)
										.some(([k, v]) => !k.includes("_weight") && k !== `${prefix}_${selIdx}` && v === opt.value);
									opt.disabled = isUsedElsewhere;
								});
							}
						});
						onUpdate();
					});

					row.append(selectEl);
					asiContainer.append(row);
				});

				pickersContainer.append(asiContainer);
			} else if (choose.count) {
				const amount = choose.amount || 1;
				const count = choose.count;
				const asiContainer = e_({tag: "div", clazz: "charsheet__respec-asi-choices mb-1"});

				for (let i = 0; i < count; i++) {
					const key = `${prefix}_${i}`;
					selections[key] = null;
					selections[`${key}_weight`] = amount;

					const row = e_({tag: "div", clazz: "ve-flex-v-center mb-1"});
					row.append(e_({outer: `<span class="mr-2">+${amount}:</span>`}));

					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${i}"><option value="">-- Select --</option></select>`});
					abilities.forEach(ab => {
						selectEl.append(e_({outer: `<option value="${ab}">${Parser.attAbvToFull(ab)}</option>`}));
					});

					selectEl.addEventListener("change", () => {
						selections[key] = selectEl.value || null;
						// Cross-disable
						[...asiContainer.querySelectorAll("select")].forEach(sel => {
							const selIdx = parseInt(sel.dataset.asiIdx);
							if (selIdx !== i) {
								[...sel.querySelectorAll("option")].forEach(opt => {
									if (!opt.value) return;
									const isUsedElsewhere = Object.entries(selections)
										.some(([k, v]) => !k.includes("_weight") && k !== `${prefix}_${selIdx}` && v === opt.value);
									opt.disabled = isUsedElsewhere;
								});
							}
						});
						onUpdate();
					});

					row.append(selectEl);
					asiContainer.append(row);
				}

				pickersContainer.append(asiContainer);
			}
		};

		// Build the label describing what the set gives
		const describeSet = (choose) => {
			if (choose.weighted) {
				const weights = choose.weighted.weights || [2, 1];
				return weights.map(w => `+${w}`).join("/");
			}
			if (choose.count) {
				const amount = choose.amount || 1;
				return Array(choose.count).fill(`+${amount}`).join("/");
			}
			return "Choose";
		};

		container.append(e_({outer: `<p class="ve-small mb-1"><strong>Ability Scores:</strong></p>`}));

		const pickersContainer = e_({tag: "div"});

		// Single set: render directly
		if (chooseSets.length === 1) {
			renderAbiSet(chooseSets[0].choose, pickersContainer);
		} else {
			// Multiple sets are alternatives — let user pick which option
			const optionRow = e_({tag: "div", clazz: "mb-1"});
			chooseSets.forEach((abiSet, setIdx) => {
				const label = describeSet(abiSet.choose);
				const radioLbl = e_({outer: `<label class="mr-3"><input type="radio" name="${prefix}-asi-option" value="${setIdx}" ${setIdx === 0 ? "checked" : ""}> Option ${setIdx + 1}: ${label}</label>`});
				radioLbl.querySelector("input").addEventListener("change", () => {
					activeSetIdx = setIdx;
					renderAbiSet(chooseSets[setIdx].choose, pickersContainer);
					onUpdate();
				});
				optionRow.append(radioLbl);
			});
			container.append(optionRow);

			// Render the first option by default
			renderAbiSet(chooseSets[0].choose, pickersContainer);
		}

		container.append(pickersContainer);

		return {
			type: "ability",
			getSelections: () => ({...selections}),
			isComplete: () => {
				const totalRequired = Object.keys(selections).filter(k => !k.includes("_weight")).length;
				let filled = 0;
				Object.entries(selections).forEach(([key, val]) => {
					if (!key.includes("_weight") && val) filled++;
				});
				return totalRequired > 0 && filled >= totalRequired;
			},
		};
	}

	// endregion

	// region Clear/Apply Helpers

	_clearLanguagesFromData (data) {
		if (!data?.languageProficiencies) return;
		data.languageProficiencies.forEach(lp => {
			Object.keys(lp).forEach(lang => {
				if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
				this._state.removeLanguage(lang.toTitleCase());
			});
		});
	}

	_clearUserChosenLanguages (userChoices) {
		if (userChoices.selectedLanguages) {
			Object.values(userChoices.selectedLanguages).forEach(langArray => {
				if (Array.isArray(langArray)) langArray.forEach(l => this._state.removeLanguage(l.toTitleCase()));
			});
		}
		if (userChoices.selectedSubraceLanguages?.length) {
			userChoices.selectedSubraceLanguages.forEach(l => this._state.removeLanguage(l.toTitleCase()));
		}
		if (userChoices.tashasLanguageReplacements?.length) {
			userChoices.tashasLanguageReplacements.forEach(l => {
				if (l) this._state.removeLanguage(l.toTitleCase());
			});
		}
	}

	_clearSkillsFromData (data) {
		if (!data?.skillProficiencies) return;
		data.skillProficiencies.forEach(sp => {
			Object.keys(sp).forEach(skill => {
				if (skill !== "any" && skill !== "choose") {
					this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 0);
				}
			});
		});
	}

	_clearUserChosenSkills (userChoices) {
		if (userChoices.selectedSkills?.length) {
			userChoices.selectedSkills.forEach(skill => {
				this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 0);
			});
		}
		if (userChoices.tashasSkillReplacements?.length) {
			userChoices.tashasSkillReplacements.forEach(skill => {
				if (skill) this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 0);
			});
		}
	}

	_clearResistancesFromData (data) {
		if (!data?.resist) return;
		data.resist.forEach(r => {
			if (typeof r === "string") this._state.removeResistance(r);
		});
	}

	_clearProficienciesFromData (race, subrace) {
		for (const data of [race, subrace]) {
			if (!data) continue;
			if (data.armorProficiencies) {
				data.armorProficiencies.forEach(ap => {
					Object.keys(ap).forEach(a => this._state.removeArmorProficiency(a.toTitleCase()));
				});
			}
			if (data.weaponProficiencies) {
				data.weaponProficiencies.forEach(wp => {
					Object.keys(wp).forEach(w => this._state.removeWeaponProficiency(w.toTitleCase()));
				});
			}
			if (data.toolProficiencies) {
				data.toolProficiencies.forEach(tp => {
					Object.keys(tp).forEach(t => {
						if (t !== "any" && t !== "choose") this._state.removeToolProficiency(t.toTitleCase());
					});
				});
			}
		}
	}

	_clearToolsFromData (data) {
		if (!data?.toolProficiencies) return;
		data.toolProficiencies.forEach(tp => {
			Object.entries(tp).forEach(([key, value]) => {
				if (key !== "choose" && key !== "any" && key !== "anyArtisansTool" && key !== "anyMusicalInstrument" && value === true) {
					this._state.removeToolProficiency(key.toTitleCase());
				}
			});
		});
	}

	_applySpeedFromRaceData (race) {
		if (!race.speed) return;
		if (typeof race.speed === "number") {
			this._state.setSpeed("walk", race.speed);
		} else {
			if (race.speed.walk) this._state.setSpeed("walk", race.speed.walk);
			["fly", "swim", "climb", "burrow"].forEach(speedType => {
				const speedValue = race.speed[speedType];
				if (speedValue === true) {
					this._state.addNamedModifier({
						name: `${race.name} ${speedType.charAt(0).toUpperCase() + speedType.slice(1)} Speed`,
						type: `speed:${speedType}`,
						value: 0,
						equalToWalk: true,
						sourceType: "race",
						enabled: true,
					});
				} else if (typeof speedValue === "number" && speedValue > 0) {
					this._state.setSpeed(speedType, speedValue);
				}
			});
		}
	}

	_applyFixedLanguages (data) {
		if (!data?.languageProficiencies) return;
		data.languageProficiencies.forEach(langProf => {
			Object.keys(langProf).forEach(lang => {
				if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
				this._state.addLanguage(lang.toTitleCase());
			});
		});
	}

	_applyFixedSkills (data) {
		if (!data?.skillProficiencies) return;
		data.skillProficiencies.forEach(skillProf => {
			Object.keys(skillProf).forEach(skill => {
				if (skill !== "any" && skill !== "choose") {
					this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 1);
				}
			});
		});
	}

	_applyFixedTools (data) {
		if (!data?.toolProficiencies) return;
		data.toolProficiencies.forEach(toolSet => {
			Object.entries(toolSet).forEach(([key, value]) => {
				if (key !== "choose" && key !== "any" && key !== "anyArtisansTool" && key !== "anyMusicalInstrument" && value === true) {
					this._state.addToolProficiency(key.toTitleCase());
				}
			});
		});
	}

	_applyProficienciesFromData (data) {
		if (data.armorProficiencies) {
			data.armorProficiencies.forEach(ap => {
				Object.keys(ap).forEach(a => this._state.addArmorProficiency(a.toTitleCase()));
			});
		}
		if (data.weaponProficiencies) {
			data.weaponProficiencies.forEach(wp => {
				Object.keys(wp).forEach(w => this._state.addWeaponProficiency(w.toTitleCase()));
			});
		}
		if (data.toolProficiencies) {
			data.toolProficiencies.forEach(tp => {
				Object.keys(tp).forEach(t => {
					if (t !== "any" && t !== "choose") this._state.addToolProficiency(t.toTitleCase());
				});
			});
		}
	}

	/**
	 * Reapply racial ability bonuses after they were cleared (e.g., when background changes).
	 * Uses the race data stored on state to derive fixed bonuses.
	 */
	_reapplyRacialAbilityBonuses (history) {
		const race = this._state.getRace();
		if (race?.ability) {
			race.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Also reapply user-chosen racial ability bonuses from history
		const raceUserChoices = history?.choices?.raceUserChoices;
		if (raceUserChoices?.selectedAbilityChoices) {
			Object.entries(raceUserChoices.selectedAbilityChoices).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = raceUserChoices.selectedAbilityChoices[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}
	}

	/**
	 * Reapply background ability bonuses after they were cleared (e.g., when race changes).
	 * Uses stored user choices from level history.
	 */
	_reapplyBackgroundAbilityBonuses (history) {
		const bgUserChoices = history.choices?.backgroundUserChoices;
		if (!bgUserChoices?.selectedAbilityBonuses) return;
		Object.entries(bgUserChoices.selectedAbilityBonuses).forEach(([key, value]) => {
			if (key.startsWith("bg_") && !key.includes("weight") && value) {
				const weightKey = `${key}_weight`;
				const bonus = bgUserChoices.selectedAbilityBonuses[weightKey] || 0;
				if (bonus && Parser.ABIL_ABVS.includes(value)) {
					const current = this._state.getAbilityBonus(value) || 0;
					this._state.setAbilityBonus(value, current + bonus);
				}
			}
		});
		// Also apply fixed background ability bonuses from the background data itself
		const bg = this._state.getBackground();
		if (bg?.ability) {
			bg.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}
	}

	// endregion
}

// Export for use in charactersheet.js
globalThis.CharacterSheetRespec = CharacterSheetRespec;
