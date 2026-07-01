/**
 * sourceFeature values assigned to player-chosen spells by the Builder, LevelUp, and QuickBuild flows.
 * Spells with these labels count against known/prepared limits; orphans (sourceFeature == null) and
 * feature-granted spells (subclass / racial / innate) do NOT.
 *
 * Canonical definition lives on `CharacterSheetClassUtils.PLAYER_CHOSEN_SPELL_FEATURES`. The local
 * alias is kept for back-compat with any consumers that imported it from this module.
 */
const {e_, ee} = /** @type {*} */ (globalThis);

const PLAYER_CHOSEN_SPELL_FEATURES = /** @type {*} */ (globalThis).CharacterSheetClassUtils?.PLAYER_CHOSEN_SPELL_FEATURES
	|| new Set(["Spells Known", "Cantrips Known", "Wizard Spellbook", "Prepared Spells", "Spells Prepared"]);

/**
 * Character Sheet Spells Manager
 * Handles spell slots, known spells, prepared spells, and casting
 */
class CharacterSheetSpells {
	/**
	 * Returns true if the spell was chosen by the player (counts against known/prepared limit).
	 * Returns false for feature-granted spells AND for orphans (sourceFeature == null) — orphans
	 * are surfaced separately in the "Other Cantrips" / "Other Spells" group.
	 *
	 * Thin wrapper over `CharacterSheetClassUtils.isPlayerChosenSpell` (kept for back-compat).
	 */
	static isPlayerChosenSpell (spell) {
		const ClassUtils = /** @type {*} */ (globalThis).CharacterSheetClassUtils;
		if (ClassUtils?.isPlayerChosenSpell) return ClassUtils.isPlayerChosenSpell(spell);
		// Fallback for environments where ClassUtils hasn't loaded yet.
		if (!spell || !spell.sourceFeature) return false;
		return PLAYER_CHOSEN_SPELL_FEATURES.has(spell.sourceFeature);
	}

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
		this._renderMetamagic();
		if (this._page._combat) this._page._combat.renderCombatMetamagic();
	}

	_renderMetamagic () {
		CharacterSheetCombat.renderMetamagicDashboard(
			this._state,
			this._page,
			"#charsheet-spells-metamagic",
			"#charsheet-spells-metamagic-section",
			"#charsheet-spells-metamagic-sp",
			{isSorceryPointEditable: true},
		);
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
	applyThelemarSpellRarity (spells) {
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
		return officialPrefixes.some(prefix => source === prefix || source.startsWith(`${prefix}-`));
	}

	_initEventListeners () {
		// Spell slot pip clicks — toggles a slot between used/available.
		// Left-click leftmost-available pip → marks used (spends slot).
		// Left-click rightmost-used pip → marks available (refunds slot).
		// Supports both standard slots (data-spell-level="N") and Warlock pact
		// slots (data-spell-level="pact"). See CharacterSheet bug 6.2.
		document.addEventListener("click", (/** @type {*} */ e) => {
			const pip = e.target.closest(".charsheet__spell-slot-pip");
			if (!pip) return;
			const levelContainer = pip.closest("[data-spell-level]");
			if (!levelContainer) return;
			const rawLevel = levelContainer.dataset.spellLevel;
			const level = rawLevel === "pact" ? "pact" : parseInt(rawLevel);
			if (level !== "pact" && Number.isNaN(level)) return;
			this._toggleSlot(level, pip);
		});

		// Add spell button
		document.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.closest("#charsheet-btn-add-spell, #charsheet-add-spell")) this._showSpellPicker();
		});

		// Spell filter
		document.addEventListener("input", (/** @type {*} */ e) => {
			if (!e.target.matches("#charsheet-spell-search")) return;
			this._spellFilter = e.target.value.toLowerCase();
			this._renderSpellList();
		});

		// Level filter
		document.addEventListener("change", (/** @type {*} */ e) => {
			if (!e.target.matches("#charsheet-spell-level-filter")) return;
			this._spellLevelFilter = e.target.value;
			this._renderSpellList();
		});

		// Cast spell button = quick auto-cast: no "Choose Slot Level" / component / metamagic
		// prompts. Mirrors the right-click "⚡ Cast" entry — auto-selects a base-level slot
		// (cantrips at level 0). The chained slot→metamagic modal is reserved for the explicit
		// "Cast w/ Metamagic" button below.
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-cast");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._castSpell(spellId, {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}});
		});

		// Cast w/ Metamagic button (offers the active-metamagic picker before casting — the one
		// path that legitimately needs slot/upcast + metamagic selection, plus the optional
		// Feywild Shard discharge toggle when a shard is attuned)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-cast-metamagic");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._castSpell(spellId, {withMetamagic: true});
		});

		// Cast as ritual button (for unprepared spells in spellbook)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-cast-ritual");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._castSpellAsRitual(spellId);
		});

		// Right-click (desktop) cast-options context menu on a spell row.
		// Long-press (mobile) routes through charactersheet-mobile.js → _openSpellCastMenu.
		document.addEventListener("contextmenu", (/** @type {*} */ e) => {
			const item = e.target.closest(".charsheet__spell-item");
			if (!item) return;
			// Let normal context menus work on real links (open spell reference, etc.).
			if (e.target.closest("a")) return;
			const spellId = item.dataset.spellId;
			if (!spellId) return;
			this._openSpellCastMenu(spellId, e);
		});

		// Remove spell button
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-remove");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._removeSpell(spellId);
		});

		// Swap Divine Soul affinity spell (restricted to Cleric list)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-swap-affinity");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			const spell = this._state.getSpells().find(s => (s.id || `${s.name}|${s.source}`) === spellId);
			if (spell) this._pSwapDivineSoulAffinity(spell);
		});

		// Toggle prepared
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-prepared");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._togglePrepared(spellId);
		});

		// Spell info button
		document.addEventListener("click", (/** @type {*} */ e) => {
			const btn = e.target.closest(".charsheet__spell-info");
			if (!btn) return;
			const spellId = btn.closest(".charsheet__spell-item").dataset.spellId;
			this._showSpellInfo(spellId);
		});

		// Spell note button
		document.addEventListener("click", (/** @type {*} */ e) => {
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

		// Open Gambling Table modal (can be triggered from features panel, spell UI, or toast button)
		document.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.closest(".btn-open-gambling-table")) this._openGamblingTableModal();
		});
	}

	_toggleSlot (level, pip) {
		const USED_CLS = "charsheet__spell-slot-pip--used";
		const isUsed = pip.classList.contains(USED_CLS);
		const isPact = level === "pact";

		// Compute new current count from state (single source of truth).
		// renderSlots() below will rebuild pip visuals from the new state.
		if (isUsed) {
			// Restore a slot
			if (isPact) {
				const slots = this._state.getPactSlots();
				if (!slots) return;
				this._state.setPactSlotsCurrent(Math.min(slots.max, (slots.current ?? 0) + 1));
			} else {
				const max = this._state.getSpellSlotsMax(level);
				const cur = this._state.getSpellSlotsCurrent(level);
				if (cur >= max) return;
				this._state.setSpellSlots(level, max, cur + 1);
			}
		} else {
			// Spend a slot
			if (isPact) {
				const slots = this._state.getPactSlots();
				if (!slots || slots.current <= 0) return;
				this._state.setPactSlotsCurrent(slots.current - 1);
			} else {
				const max = this._state.getSpellSlotsMax(level);
				const cur = this._state.getSpellSlotsCurrent(level);
				if (cur <= 0) return;
				this._state.setSpellSlots(level, max, cur - 1);
			}
		}

		// Refresh the slots panel + overview so pip visuals and any
		// numeric "current/max" labels stay in sync with the new state.
		if (typeof this.renderSlots === "function") this.renderSlots();
		if (typeof this._page?._renderQuickSpells === "function") this._page._renderQuickSpells();

		this._page.saveCharacter();
	}

	async _showSpellPicker (targetClass = null) {
		const classes = this._state.getClasses();
		if (!classes || !classes.length) {
			JqueryUtil.doToast({type: "warning", content: "Add a class to your character first."});
			return;
		}

		// For multiclass: let user pick which class to add spells for
		let characterClass;
		if (targetClass) {
			// Class-scoped add (e.g. clicking a per-class count chip): use it directly.
			characterClass = targetClass;
		} else if (classes.length > 1) {
			// Filter to caster classes only — include subclass casters (Eldritch
			// Knight, Arcane Trickster, Gambler, Architect of Ruin) via the state
			// resolver so the global picker matches the per-class cards.
			const casterClasses = classes.filter(cls => {
				if (this._state.getSpellcastingAbilityForClass?.(cls)) return true;
				if (cls.casterProgression) return true;
				const casterNames = ["Bard", "Cleric", "Druid", "Sorcerer", "Wizard", "Warlock", "Paladin", "Ranger", "Artificer"];
				return casterNames.includes(cls.name);
			});

			if (!casterClasses.length) {
				JqueryUtil.doToast({type: "warning", content: "No spellcasting classes found."});
				return;
			}

			if (casterClasses.length === 1) {
				characterClass = casterClasses[0];
			} else {
				// Show class selection
				const selectedIndex = await InputUiUtil.pGetUserEnum({
					title: "Select Class for Spell List",
					values: casterClasses.map(c => `${c.name}${c.subclass?.name ? ` (${c.subclass.name})` : ""} (Level ${c.level})`),
				});
				if (selectedIndex == null) return;
				characterClass = casterClasses[selectedIndex];
			}
		} else {
			characterClass = classes[0];
		}

		// Filter by level
		const characterLevel = this._state.getTotalLevel();
		const maxSpellLevel = this._getMaxSpellLevel(characterClass, characterLevel);

		// The picker pool is the FULL source-filtered spell list (level-capped),
		// NOT a single-class subset. Previously the pool was pre-restricted to the
		// character's own class BEFORE the modal opened, which made the modal's
		// class/subclass filter purely decorative — it could only ever NARROW
		// within that one class, never broaden. So selecting "All Classes" (or any
		// other class) could never surface a spell that wasn't already on the
		// character's class list (e.g. Healing Word for a Wizard), and a homebrew
		// spell with no class list at all was invisible everywhere.
		//
		// Now the pool is broad and the modal's filter does the gating: the default
		// filter selection is the character's own class(es)/subclass(es), so the
		// DEFAULT view still shows exactly that class's available spells (including
		// subclass-EXPANDED lists), while checking other classes / "All Classes"
		// genuinely broadens. See `_buildPickerOwnClassConfigs` +
		// the authoritative own-class fallback in the modal's `renderList`.
		const filteredSpells = this._page.getFilteredSpellData();
		const availableSpells = filteredSpells
			.filter(spell => spell.level <= maxSpellLevel)
			.sort((a, b) => {
				if (a.level !== b.level) return a.level - b.level;
				return a.name.localeCompare(b.name);
			});

		const ownClassConfigs = this._buildPickerOwnClassConfigs();

		// Show modal using UiUtil. The resolved class is authoritative for
		// attribution so every add flow stamps the correct sourceClass.
		await this._pShowSpellPickerModal(availableSpells, {targetClass: characterClass, ownClassConfigs});
	}

	/**
	 * Build authoritative spell-availability configs for EACH of the character's
	 * own classes, for the spell picker's class filter.
	 *
	 * The picker pool is the full spell list (so the class filter can broaden),
	 * but the character's OWN class(es) must still surface subclass-EXPANDED
	 * spells that are not present on a spell's raw `classes.fromClassList`
	 * (Divine Soul → Cleric list, Chronurgy → EGW list, etc.). These configs are
	 * fed to `CharacterSheetClassUtils.spellIsAvailableForClass` as an
	 * authoritative fallback for own-class membership in the modal's filter.
	 *
	 * `className` is the spell-LIST class name (Gambler's Rogue subclass casts
	 * from the Warlock list), matching the default `selectedClasses` entries.
	 *
	 * @returns {Array<{className:string, classSource:string, subclass:*, subclassChoice:*, additionalClassNames:string[], includeCoreSpellsForHomebrew:boolean}>}
	 */
	_buildPickerOwnClassConfigs () {
		const settings = this._state.getSettings?.() || {};
		const includeCoreSpells = settings.includeCoreSpellsForHomebrew !== false; // Default true
		const classes = this._state.getClasses?.() || [];
		return classes.map(cls => {
			const isGambler = cls.subclass?.name === "Gambler";
			const className = isGambler ? "Warlock" : cls.name;
			const classSource = cls.source;
			const isNonStandardSource = classSource && !["PHB", "XPHB", "TCE", "XGE", "TGTT"].includes(classSource);
			// Resolve the (possibly shallow) stored subclass ref to the full object
			// so `additionalSpells` / expanded-list blocks are available.
			const classData = this._page.getClasses?.()?.find(c => c.name === cls.name && c.source === cls.source);
			const subclass = CharacterSheetClassUtils.resolveFullSubclass(cls.subclass, classData);
			const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
				className: cls.name,
				subclass,
				subclassChoice: cls.subclassChoice,
			});
			return {
				className,
				classSource,
				subclass,
				subclassChoice: cls.subclassChoice,
				additionalClassNames,
				includeCoreSpellsForHomebrew: includeCoreSpells && isNonStandardSource,
			};
		});
	}

	_getMaxSpellLevel (classInfo, characterLevel) {
		// Get the per-class level (not total character level) for spell level limits
		const classLevel = this._state.getClassLevel(classInfo.name) || characterLevel;

		// Use the class's casterProgression field if available (handles homebrew correctly)
		const casterProg = classInfo.casterProgression;
		if (casterProg) {
			return CharacterSheetClassUtils.getMaxSpellLevelFromProgression(casterProg, classLevel);
		}

		// Fallback: hardcoded class name lookup for classes without casterProgression field
		const fullCasters = ["Bard", "Cleric", "Druid", "Sorcerer", "Wizard"];
		const halfCasters = ["Paladin", "Ranger", "Artificer"];
		const thirdCasters = ["Eldritch Knight", "Arcane Trickster", "Gambler", "Architect of Ruin"];

		const className = classInfo.name;
		const subclassName = classInfo.subclass?.name;

		// Warlock has special progression - pact magic up to 5th, plus Mystic Arcanum
		if (className === "Warlock") {
			if (classLevel >= 17) return 9;
			if (classLevel >= 15) return 8;
			if (classLevel >= 13) return 7;
			if (classLevel >= 11) return 6;
			if (classLevel >= 9) return 5;
			if (classLevel >= 7) return 4;
			if (classLevel >= 5) return 3;
			if (classLevel >= 3) return 2;
			if (classLevel >= 1) return 1;
			return 0;
		}

		let casterLevel = classLevel;

		if (fullCasters.includes(className)) {
			// Full caster: use full level
		} else if (halfCasters.includes(className)) {
			casterLevel = Math.floor(classLevel / 2);
		} else if (thirdCasters.includes(subclassName)) {
			casterLevel = Math.floor(classLevel / 3);
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

	async _pShowSpellPickerModal (spells, {targetClass = null, ownClassConfigs = []} = {}) {
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
			const breakdown = this._state.getSpellcastingClassBreakdown?.() || [];
			if (!breakdown.length) {
				statusBar.style.display = "none";
				return;
			}

			statusBar.innerHTML = "";

			// One compact summary per caster class. The class currently being added
			// for (targetClass) is emphasised. No known/prepared or edition labels —
			// just each class's spell + cantrip counts.
			breakdown.forEach(card => {
				const isTarget = !!targetClass && card.className === targetClass.name && (card.classSource || null) === (targetClass.source || null);

				const spellsStr = card.spellsMax == null ? `${card.spellsCount}` : `${card.spellsCount}/${card.spellsMax}`;
				const spellsOver = card.spellsMax != null && card.spellsCount > card.spellsMax;
				const grantedStr = card.spellsGranted > 0 ? ` <span class="ve-muted ve-small">+${card.spellsGranted}</span>` : "";

				let cantripsBit = "";
				if ((card.cantripsMax || 0) > 0 || (card.cantripsCount || 0) > 0) {
					const cantripsOver = card.cantripsCount > card.cantripsMax;
					cantripsBit = ` <span class="ve-muted">•</span> <span class="${cantripsOver ? "text-danger" : ""}" title="Cantrips">⭐ ${card.cantripsCount}/${card.cantripsMax}</span>`;
				}

				statusBar.append(e_({outer: `
					<div style="display: flex; align-items: center; gap: 6px;${isTarget ? " font-weight: bold;" : ""}" title="${(card.abilityLabel || "").qq()} • Save DC ${card.saveDc} • Attack +${card.attackBonus}">
						<span style="color: ${isTarget ? "#60a5fa" : "inherit"};">${(card.displayName || card.className || "").qq()}:</span>
						<span class="${spellsOver ? "text-danger" : ""}">📖 ${spellsStr}</span>${grantedStr}${cantripsBit}
					</div>
				`}));
			});

			// Gambler: offer an inline roll when the scoped class hasn't rolled yet.
			const gamblerCard = breakdown.find(c => c.isRolledPrepared);
			if (gamblerCard && this._state.getGamblerPreparedCount() == null) {
				const dice = gamblerCard.preparedDice || "2d4";
				const wrapper = e_({outer: `
					<div style="display: flex; align-items: center; gap: 6px;">
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__gambler-roll-btn-inline">\u{1F3B2} Roll ${dice}</button>
						<span class="ve-muted ve-small">(not yet rolled)</span>
					</div>
				`});
				statusBar.append(wrapper);
				wrapper.querySelector(".charsheet__gambler-roll-btn-inline").addEventListener("click", () => {
					if (this._state.getGamblerPreparedCount() != null) {
						JqueryUtil.doToast({content: "Already rolled for today \u2014 take a long rest to roll again.", type: "warning"});
						return;
					}
					const rollDetails = this._state.rollGamblerPreparedSpells();
					if (rollDetails) {
						JqueryUtil.doToast(/** @type {*} */ ({
							content: `\u{1F3B2} Gambler: Rolled ${rollDetails.dice} = (${rollDetails.rolls.join(" + ")}) = ${rollDetails.total} spells prepared`,
							type: "success",
							autoHideTime: 5000,
						}));
						updateStatusBar();
						this._renderSpellcastingStats();
						this._page.saveCharacter();
					}
				});
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
			const officialPriority = ["TGTT", "PHB", "XGE", "TCE", "FTD", "XPHB"];
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
		const search = e_({tag: "input", attr: {type: "text", placeholder: "🔍 Search spells by name..."}, clazz: "ve-form-control"});
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
		// Map class names, substituting the spell list class for Gambler (Rogue→Warlock)
		const characterClassNames = characterClasses.map(c => {
			if (c.subclass?.name === "Gambler") return "Warlock";
			return c.name;
		});
		// Phase 9 (Bug 7.1 follow-up): `c.subclass` is an object (`{name, source, ...}`),
		// so the previous `${c.subclass}` coerced to `"[object Object]"` and produced
		// keys like `"Sorcerer: [object Object]"`. That never matched the picker's
		// `${className}: ${subclass.name}` keys, so the character's actual subclass
		// was never auto-checked and any spell only granted via that subclass list
		// (e.g. Guidance for Divine Soul, Gift of Alacrity for Chronurgy) was hidden
		// behind a "No Expanded Lists" default.
		const characterSubclassNames = characterClasses
			.filter(c => c.subclass && (c.subclass.name || typeof c.subclass === "string"))
			.map(c => `${c.name}: ${typeof c.subclass === "string" ? c.subclass : c.subclass.name}`);

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

		classBtn.addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			positionDropdown(classDropdownMenu, classBtn);
			classDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			levelDropdownMenu?.classList.remove("open");
			schoolDropdownMenu?.classList.remove("open");
			sourceDropdownMenu?.classList.remove("open");
			rarityDropdownMenu?.classList.remove("open");
			legalityDropdownMenu?.classList.remove("open");
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

		classDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());

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

			subclassBtn.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				positionDropdown(subclassDropdownMenu, subclassBtn);
				subclassDropdownMenu.classList.toggle("open");
				// Close other dropdowns
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu?.classList.remove("open");
				schoolDropdownMenu?.classList.remove("open");
				sourceDropdownMenu?.classList.remove("open");
				rarityDropdownMenu?.classList.remove("open");
				legalityDropdownMenu?.classList.remove("open");
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

			subclassDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
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

		levelBtn.addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			positionDropdown(levelDropdownMenu, levelBtn);
			levelDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
			rarityDropdownMenu?.classList.remove("open");
			legalityDropdownMenu?.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
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

		schoolBtn.addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			positionDropdown(schoolDropdownMenu, schoolBtn);
			schoolDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
			rarityDropdownMenu?.classList.remove("open");
			legalityDropdownMenu?.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
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

		// Collect unique subschools from spells, split into rarity/legality/other
		const allSubschools = [...new Set(spells.flatMap(s => s.subschools || []))].sort();
		const rarityValues = allSubschools.filter(s => s.startsWith("rarity:")).map(s => s.slice(7));
		const legalityValues = allSubschools.filter(s => s.startsWith("legality:")).map(s => s.slice(9));
		const otherSubschools = allSubschools.filter(s => !s.startsWith("rarity:") && !s.startsWith("legality:"));

		// Rarity multi-select filter
		let selectedRarities = new Set();
		let rarityDropdown = null;
		let rarityDropdownMenu = null;

		if (rarityValues.length > 0) {
			rarityDropdown = e_({outer: `
				<div class="charsheet__source-multiselect charsheet__subschool-multiselect">
					<button class="charsheet__source-multiselect-btn">
						<span class="charsheet__source-multiselect-icon">💎</span>
						<span class="charsheet__source-multiselect-text">All Rarities</span>
						<span class="charsheet__source-multiselect-arrow">▼</span>
					</button>
					<div class="charsheet__source-multiselect-dropdown charsheet__subschool-dropdown">
						<div class="charsheet__source-multiselect-actions">
							<button class="charsheet__source-action-btn" data-action="all">Select All</button>
							<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
						</div>
						<div class="charsheet__source-multiselect-list">
							${rarityValues.map(r => `
								<label class="charsheet__source-multiselect-item">
									<input type="checkbox" value="rarity:${r}" checked>
									<span class="charsheet__source-multiselect-check">✓</span>
									<span class="charsheet__source-multiselect-label">${r.toTitleCase()}</span>
								</label>
							`).join("")}
						</div>
					</div>
				</div>
			`});
			filterRow.append(rarityDropdown);

			rarityDropdownMenu = rarityDropdown.querySelector(".charsheet__source-multiselect-dropdown");
			const rarityBtn = rarityDropdown.querySelector(".charsheet__source-multiselect-btn");
			const rarityText = rarityDropdown.querySelector(".charsheet__source-multiselect-text");

			rarityBtn.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				positionDropdown(rarityDropdownMenu, rarityBtn);
				rarityDropdownMenu.classList.toggle("open");
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu.classList.remove("open");
				schoolDropdownMenu.classList.remove("open");
				legalityDropdownMenu?.classList.remove("open");
				subschoolDropdownMenu?.classList.remove("open");
				sourceDropdownMenu.classList.remove("open");
			});

			const updateRarityText = () => {
				const checked = rarityDropdown.querySelectorAll("input:checked");
				if (checked.length === 0) {
					rarityText.textContent = "No Rarities";
					selectedRarities = new Set(["__NONE__"]);
				} else if (checked.length === rarityValues.length) {
					rarityText.textContent = "All Rarities";
					selectedRarities = new Set();
				} else if (checked.length === 1) {
					rarityText.textContent = checked[0]?.value.split(":")[1]?.toTitleCase();
					selectedRarities = new Set(Array.from(checked).map(el => el.value));
				} else {
					rarityText.textContent = `${checked.length} Rarities`;
					selectedRarities = new Set(Array.from(checked).map(el => el.value));
				}
				renderList();
			};

			rarityDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateRarityText));
			rarityDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
				rarityDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
				updateRarityText();
			});
			rarityDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
				rarityDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
				updateRarityText();
			});

			rarityDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
		}

		// Legality multi-select filter
		let selectedLegalities = new Set();
		let legalityDropdown = null;
		let legalityDropdownMenu = null;

		if (legalityValues.length > 0) {
			legalityDropdown = e_({outer: `
				<div class="charsheet__source-multiselect charsheet__subschool-multiselect">
					<button class="charsheet__source-multiselect-btn">
						<span class="charsheet__source-multiselect-icon">⚖️</span>
						<span class="charsheet__source-multiselect-text">All Legalities</span>
						<span class="charsheet__source-multiselect-arrow">▼</span>
					</button>
					<div class="charsheet__source-multiselect-dropdown charsheet__subschool-dropdown">
						<div class="charsheet__source-multiselect-actions">
							<button class="charsheet__source-action-btn" data-action="all">Select All</button>
							<button class="charsheet__source-action-btn" data-action="none">Clear All</button>
						</div>
						<div class="charsheet__source-multiselect-list">
							${legalityValues.map(l => `
								<label class="charsheet__source-multiselect-item">
									<input type="checkbox" value="legality:${l}" checked>
									<span class="charsheet__source-multiselect-check">✓</span>
									<span class="charsheet__source-multiselect-label">${l.toTitleCase()}</span>
								</label>
							`).join("")}
						</div>
					</div>
				</div>
			`});
			filterRow.append(legalityDropdown);

			legalityDropdownMenu = legalityDropdown.querySelector(".charsheet__source-multiselect-dropdown");
			const legalityBtn = legalityDropdown.querySelector(".charsheet__source-multiselect-btn");
			const legalityText = legalityDropdown.querySelector(".charsheet__source-multiselect-text");

			legalityBtn.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				positionDropdown(legalityDropdownMenu, legalityBtn);
				legalityDropdownMenu.classList.toggle("open");
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu.classList.remove("open");
				schoolDropdownMenu.classList.remove("open");
				rarityDropdownMenu?.classList.remove("open");
				subschoolDropdownMenu?.classList.remove("open");
				sourceDropdownMenu.classList.remove("open");
			});

			const updateLegalityText = () => {
				const checked = legalityDropdown.querySelectorAll("input:checked");
				if (checked.length === 0) {
					legalityText.textContent = "No Legalities";
					selectedLegalities = new Set(["__NONE__"]);
				} else if (checked.length === legalityValues.length) {
					legalityText.textContent = "All Legalities";
					selectedLegalities = new Set();
				} else if (checked.length === 1) {
					legalityText.textContent = checked[0]?.value.split(":")[1]?.toTitleCase();
					selectedLegalities = new Set(Array.from(checked).map(el => el.value));
				} else {
					legalityText.textContent = `${checked.length} Legalities`;
					selectedLegalities = new Set(Array.from(checked).map(el => el.value));
				}
				renderList();
			};

			legalityDropdown.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", updateLegalityText));
			legalityDropdown.querySelector("[data-action=all]").addEventListener("click", () => {
				legalityDropdown.querySelectorAll("input").forEach(el => { el.checked = true; });
				updateLegalityText();
			});
			legalityDropdown.querySelector("[data-action=none]").addEventListener("click", () => {
				legalityDropdown.querySelectorAll("input").forEach(el => { el.checked = false; });
				updateLegalityText();
			});

			legalityDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
		}

		// Multi-select subschool/tags filter (only for non-rarity/non-legality subschools)
		let selectedSubschools = new Set(); // Empty = all (no filter)
		let subschoolDropdown = null;
		let subschoolDropdownMenu = null;

		if (otherSubschools.length > 0) {
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
							${otherSubschools.map(sub => `
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

			subschoolBtn.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				positionDropdown(subschoolDropdownMenu, subschoolBtn);
				subschoolDropdownMenu.classList.toggle("open");
				// Close other dropdowns
				classDropdownMenu.classList.remove("open");
				levelDropdownMenu.classList.remove("open");
				schoolDropdownMenu.classList.remove("open");
				rarityDropdownMenu?.classList.remove("open");
				legalityDropdownMenu?.classList.remove("open");
				sourceDropdownMenu.classList.remove("open");
			});

			const updateSubschoolText = () => {
				const checked = subschoolDropdown.querySelectorAll("input:checked");
				if (checked.length === 0) {
					subschoolText.textContent = "No Tags";
					selectedSubschools = new Set(["__NONE__"]);
				} else if (checked.length === otherSubschools.length) {
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

			subschoolDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
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

		sourceBtn.addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			positionDropdown(sourceDropdownMenu, sourceBtn);
			sourceDropdownMenu.classList.toggle("open");
			// Close other dropdowns
			classDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			rarityDropdownMenu?.classList.remove("open");
			legalityDropdownMenu?.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
		});

		// Close all dropdowns when clicking outside
		document.addEventListener("click", () => {
			classDropdownMenu.classList.remove("open");
			sourceDropdownMenu.classList.remove("open");
			levelDropdownMenu.classList.remove("open");
			schoolDropdownMenu.classList.remove("open");
			rarityDropdownMenu?.classList.remove("open");
			legalityDropdownMenu?.classList.remove("open");
			subschoolDropdownMenu?.classList.remove("open");
		});
		sourceDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
		levelDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());
		schoolDropdownMenu.addEventListener("click", (/** @type {*} */ e) => e.stopPropagation());

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
			const official = ["PHB", "XGE", "TCE", "FTD", "XPHB", "XDMG", "TGTT"];
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
			this.classList.toggle("ve-active");
			renderList();
		});
		concBtn.addEventListener("click", function () {
			filterConcentration = !filterConcentration;
			this.classList.toggle("ve-active");
			renderList();
		});
		verbalBtn.addEventListener("click", function () {
			filterVerbal = !filterVerbal;
			this.classList.toggle("ve-active");
			renderList();
		});
		somaticBtn.addEventListener("click", function () {
			filterSomatic = !filterSomatic;
			this.classList.toggle("ve-active");
			renderList();
		});
		materialBtn.addEventListener("click", function () {
			filterMaterial = !filterMaterial;
			this.classList.toggle("ve-active");
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
				try { _classListCache.set(key, Renderer.spell.getCombinedClasses(spell, "fromClassList") || []); } catch (e) { _classListCache.set(key, spell.classes?.fromClassList || []); }
			}
			return _classListCache.get(key);
		};
		const getCachedSubclassList = (spell) => {
			const key = `${spell.name}|${spell.source}`;
			if (!_subclassListCache.has(key)) {
				try { _subclassListCache.set(key, Renderer.spell.getCombinedClasses(spell, "fromSubclass") || []); } catch (e) { _subclassListCache.set(key, []); }
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

				// Check class filter (if classes are selected). Fast path = raw
				// class-list membership; authoritative own-class fallback covers
				// subclass-EXPANDED lists. See spellMatchesPickerClassFilter (F9).
				const passesClassFilter = CharacterSheetClassUtils.spellMatchesPickerClassFilter(spell, selectedClasses, ownClassConfigs, spellClasses);
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
				// Rarity filter
				if (selectedRarities.has("__NONE__")) return false;
				if (selectedRarities.size > 0) {
					const spellSubs = spell.subschools || [];
					if (!spellSubs.some(sub => selectedRarities.has(sub))) return false;
				}
				// Legality filter
				if (selectedLegalities.has("__NONE__")) return false;
				if (selectedLegalities.size > 0) {
					const spellSubs = spell.subschools || [];
					if (!spellSubs.some(sub => selectedLegalities.has(sub))) return false;
				}
				// Multi-select subschool/tags filter (other tags)
				if (selectedSubschools.has("__NONE__")) return false;
				if (selectedSubschools.size > 0) {
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

					// Bug 7 Phase 5: use getSpellHoverLink so rarity/legality subschools
					// (e.g. TGTT-tagged spells) surface in the picker hover. Falls back
					// to the standard hover for spells with no charsheet-specific
					// metadata, so it's safe for every spell.
					const spellLink = this._page?.getSpellHoverLink
						? this._page.getSpellHoverLink(spell.name, spell.source, spell, null)
						: (this._page?.getHoverLink ? this._page.getHoverLink(UrlUtil.PG_SPELLS, spell.name, spell.source) : spell.name);

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
						item.querySelector(".spell-picker-add").addEventListener("click", (/** @type {*} */ e) => {
							e.stopPropagation();
							this._addSpell(spell, {targetClass});
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

		// Compute passive metamagic modifications
		const modStats = this._state.getModifiedSpellStats?.(spell);

		const rangeDisplay = modStats?.range?.changed
			? `${this._getRange(spell)} <span class="charsheet__metamagic-mod">(${modStats.range.modified})</span>`
			: this._getRange(spell);
		const durationDisplay = modStats?.duration?.changed
			? `${this._getDuration(spell)} <span class="charsheet__metamagic-mod">(${modStats.duration.modified})</span>`
			: this._getDuration(spell);

		const metamagicNotesHtml = modStats?.notes?.length
			? `<div class="charsheet__metamagic-mod ve-small mt-1">${modStats.notes.join(" · ")}</div>`
			: "";

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
					<div><strong>Range:</strong> ${rangeDisplay}</div>
					<div><strong>Components:</strong> ${components.join(", ")}</div>
					<div><strong>Duration:</strong> ${durationDisplay}</div>
					${metamagicNotesHtml}
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
	 * @returns {{canAdd: boolean, warning?: string, isOverLimit?: boolean}}
	 */
	_checkSpellLimits (spell, {targetClass = null} = {}) {
		const info = this._state.getSpellcastingInfo();
		if (!info) return {canAdd: true};

		const isCantrip = spell.level === 0;

		// Class-scoped check: when we know which class the spell is for, compare
		// against that class card's own count/cap rather than an aggregate.
		if (targetClass && this._state.getSpellcastingClassBreakdown) {
			const card = this._state.getSpellcastingClassBreakdown()
				.find(c => c.className === targetClass.name && (c.classSource || null) === (targetClass.source || null));
			if (card) {
				if (isCantrip) {
					if (card.cantripsMax > 0 && card.cantripsCount >= card.cantripsMax) {
						return {canAdd: true, warning: `${card.displayName} already has ${card.cantripsCount}/${card.cantripsMax} cantrips. Adding more exceeds the class limit.`};
					}
					return {canAdd: true};
				}
				if (card.isRolledPrepared && this._state.getGamblerPreparedCount() == null) {
					return {canAdd: true, warning: `\u{1F3B2} You haven't rolled for prepared spells yet. Roll in the Spells tab or take a long rest. The spell will be added unprepared.`};
				}
				// Spellbook (Wizard) has no fixed cap — no warning.
				if (card.spellsMax != null && card.spellsCount >= card.spellsMax) {
					return {canAdd: true, isOverLimit: true, warning: `${card.displayName} already has ${card.spellsCount}/${card.spellsMax} spells. Adding more exceeds the class limit. Consider removing one first.`};
				}
				return {canAdd: true};
			}
		}

		// Check cantrip limits
		if (isCantrip && info.cantripsKnown) {
			const allCantrips = this._state.getCantripsKnown();
			const {count: currentCount} = CharacterSheetClassUtils.countPlayerChosenCantrips(allCantrips);
			if (currentCount >= info.cantripsKnown) {
				return {
					canAdd: true, // Still allow, but warn
					warning: `You already have ${currentCount}/${info.cantripsKnown} cantrips. Adding more exceeds your class limit.`,
				};
			}
		}

		// Check Gambler rolled prepared limit (soft limit — adding to spell list, not preparing)
		if (!isCantrip && info.isRolledPrepared) {
			const rolledMax = this._state.getGamblerPreparedCount();
			if (rolledMax == null) {
				return {
					canAdd: true,
					warning: `\u{1F3B2} You haven't rolled for prepared spells yet. Roll in the Spells tab or take a long rest. The spell will be added unprepared.`,
				};
			}
		}

		// Check spells known limits for known casters
		if (!isCantrip && info.type === "known") {
			const spells = this._state.getSpells();
			const leveledSpells = spells.filter(s => s.level > 0 && CharacterSheetClassUtils.isPlayerChosenSpell(s));
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
			const leveledSpells = spells.filter(s => s.level > 0 && CharacterSheetClassUtils.isPlayerChosenSpell(s));
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

	_addSpell (spell, {targetClass = null} = {}) {
		// Check limits and warn if over (scoped to the target class when known)
		const limitCheck = this._checkSpellLimits(spell, {targetClass});
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

		// Resolve canonical {sourceFeature, sourceClass, sourceSubclass} to stamp so
		// the spell counts toward the right class card (instead of landing in the
		// "Other" orphan group). When the add flow knows the target class
		// (per-class card or the multiclass picker prompt), that class is
		// authoritative; otherwise a heuristic picks the best class.
		const classes = this._state.getClasses();
		const spellcastingInfo = this._state.getSpellcastingInfo();
		const attribution = CharacterSheetClassUtils.pickAddedSpellAttribution({spell, info: spellcastingInfo, classes, targetClass});

		// Spellbook membership follows the resolved target class, not "has any
		// Wizard" — otherwise a Cleric spell in a Wizard/Cleric would be wrongly
		// flagged as a spellbook entry.
		const isWizardTarget = (attribution.sourceClass && /^wizard$/i.test(attribution.sourceClass))
			|| attribution.sourceFeature === "Wizard Spellbook";

		this._state.addSpell({
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			prepared: spell.level === 0, // Cantrips are always prepared
			ritual: isRitual,
			concentration: isConcentration,
			inSpellbook: isWizardTarget && spell.level > 0,
			castingTime: this._getCastingTime(spell),
			range: this._getRange(spell),
			components: this._getComponents(spell),
			duration: this._getDuration(spell),
			subschools: spell.subschools || [], // Include rarity/legality tags
			...(attribution.sourceFeature ? {sourceFeature: attribution.sourceFeature} : {}),
			...(attribution.sourceClass ? {sourceClass: attribution.sourceClass} : {}),
			...(attribution.sourceSubclass ? {sourceSubclass: attribution.sourceSubclass} : {}),
		});

		this._renderSpellList();
		this._renderSpellcastingStats();
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

	async _castSpell (spellId, {withMetamagic, decision = null} = {}) {
		// Metamagic prompt runs unless the caller explicitly opts out (withMetamagic === false).
		// Default (undefined) preserves legacy behaviour for callers that pass only a spellId
		// (combat / overview / favourites quick-cast surfaces).
		const shouldPromptMetamagic = withMetamagic !== false;
		// When the player explicitly chose "Cast w/ Metamagic" (withMetamagic === true),
		// always show the picker — even if every known metamagic is currently unavailable
		// (e.g. not enough sorcery points) — so they get an explanation rather than a
		// silent normal cast. Legacy/auto prompts (undefined) keep the quiet early-return.
		const isExplicitMetamagic = withMetamagic === true;
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
			const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Break Concentration?",
				htmlDescription: `You are currently concentrating on <strong>${currentConc?.spellName || "a spell"}</strong>. Casting <strong>${spell.name}</strong> will break that concentration.`,
				textYes: "Cast and break concentration",
				textNo: "Cancel",
			}));
			if (!confirmed) return;
			this._state.breakConcentration?.();
		}

		// Cantrips don't use slots
		if (spell.level === 0) {
			const activeMetamagicChoice = await this._resolveMetamagicChoice({spell, spellData, slotLevel: 0, isExplicit: isExplicitMetamagic, shouldPrompt: shouldPromptMetamagic, decision});
			if (activeMetamagicChoice?.cancelled) return;
			if (!await this._pHandleCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null, {enforceMaterial: true})) return;
			if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
				return;
			}
			if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

			// Variant spell component selection (cantrips)
			const variantComponentChoice = await this._resolveVariantComponentChoice({spell, spellData, decision});
			if (variantComponentChoice?.cancelled) return;
			if (variantComponentChoice?.variantComponent) {
				for (const id of (variantComponentChoice.variantComponent.itemIds || [variantComponentChoice.variantComponent.itemId])) {
					this._state.consumeVariantComponent(id);
				}
			}

			const castMeta = this._getNormalizedCastMeta({
				spell,
				spellData,
				slotLevel: 0,
				castMeta: {
					...(activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : {}),
					...(variantComponentChoice?.variantComponent ? {variantComponent: variantComponentChoice.variantComponent} : {}),
					...(activeMetamagicChoice?.feywildShard ? {feywildShard: true} : {}),
				},
			});

			await this._showCastResult(spell, 0, false, false, castMeta);
			await this._pConsumeMaterialComponent({spell, spellData, decision, variantUsed: !!variantComponentChoice?.variantComponent});
			// Set concentration for concentration cantrips (rare but possible)
			const vcRemovesConc0 = castMeta.variantComponent?.effects?.some(e => e.type === "removeConcentration");
			if (requiresConcentration && !vcRemovesConc0) {
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

			// If no slots available, auto-ritual; if slots available, ask — unless the cast
			// came from the context menu, which resolves the ritual choice up front
			// (decision.castAsRitual: false = the plain "Cast" item; the menu has a separate
			// "Cast as Ritual" entry that routes through _castSpellAsRitual).
			let castAsRitual = !hasSlots;
			if (hasSlots) {
				if (decision && decision.castAsRitual != null) {
					castAsRitual = decision.castAsRitual;
				} else {
					castAsRitual = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
						title: "Cast as Ritual?",
						htmlDescription: `<strong>${spell.name}</strong> has the ritual tag. You can cast it as a ritual (no spell slot used, but casting takes 10 extra minutes).`,
						textYes: "🔮 Cast as Ritual (no slot)",
						textNo: "⚡ Cast Normally (use slot)",
					}));
				}
			}

			if (castAsRitual) {
				const activeMetamagicChoice = await this._resolveMetamagicChoice({spell, spellData, slotLevel: spell.level, isExplicit: isExplicitMetamagic, shouldPrompt: shouldPromptMetamagic, decision});
				if (activeMetamagicChoice?.cancelled) return;
				if (!await this._pHandleCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null, {enforceMaterial: true})) return;
				if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
					JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
					return;
				}
				if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

				// Variant spell component selection (ritual)
				const variantComponentChoice = await this._resolveVariantComponentChoice({spell, spellData, decision});
				if (variantComponentChoice?.cancelled) return;
				if (variantComponentChoice?.variantComponent) {
					for (const id of (variantComponentChoice.variantComponent.itemIds || [variantComponentChoice.variantComponent.itemId])) {
						this._state.consumeVariantComponent(id);
					}
				}

				const castMeta = this._getNormalizedCastMeta({
					spell,
					spellData,
					slotLevel: spell.level,
					castMeta: {
						...(activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : {}),
						...(variantComponentChoice?.variantComponent ? {variantComponent: variantComponentChoice.variantComponent} : {}),
						...(activeMetamagicChoice?.feywildShard ? {feywildShard: true} : {}),
					},
				});

				// Ritual cast: no slot consumed
				await this._showCastResult(spell, spell.level, false, true, castMeta); // ritual = true
				await this._pConsumeMaterialComponent({spell, spellData, decision, variantUsed: !!variantComponentChoice?.variantComponent});
				const vcRemovesConcR = castMeta.variantComponent?.effects?.some(e => e.type === "removeConcentration");
				if (requiresConcentration && !vcRemovesConcR) {
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

		// No-slot cast resources (e.g. Star Map → Guiding Bolt). These let the
		// player spend a feature resource instead of a spell slot. They are
		// first-class cast options unified with the slot options below.
		const noSlotOptions = (this._state.getNoSlotCastResourcesForSpell?.(spell) || []).map(r => ({
			isNoSlotResource: true,
			resourceId: r.resourceId,
			resourceName: r.name,
			level: r.castLevel,
			isPact: false,
			label: `${r.name} — cast at level ${r.castLevel}, no slot (${r.current}/${r.max})`,
		}));

		// Unified cast options: no-slot resources first, then pact/leveled slots.
		const castOptions = [...noSlotOptions, ...availableSlotLevels];

		if (castOptions.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No spell slots available!"});
			return;
		}

		// If only one option, auto-select; otherwise show picker (or honor a pre-resolved
		// upcast choice from the cast-options context menu — revalidated against current slots).
		let selectedSlot;
		if (decision && decision.slotLevel != null) {
			selectedSlot = castOptions.find(s => !s.isNoSlotResource && !s.isPact && s.level === decision.slotLevel)
				|| castOptions.find(s => s.level === decision.slotLevel);
			if (!selectedSlot) {
				JqueryUtil.doToast({type: "warning", content: `No level ${decision.slotLevel} slot available.`});
				return;
			}
		} else if ((decision && decision.autoSlot) || !isExplicitMetamagic) {
			// Quick auto-cast (left-click, combat/overview/favourites quick-cast, and the
			// context-menu "⚡ Cast" entry): pick a slot WITHOUT prompting — prefer a
			// base-level slot/pact, else the first available option. The "Choose Slot Level"
			// modal below is reserved for the explicit "Cast w/ Metamagic" path, which
			// legitimately needs slot + upcast selection alongside the metamagic picker.
			selectedSlot = castOptions.find(s => s.level === spell.level) || castOptions[0];
		} else if (castOptions.length === 1) {
			selectedSlot = castOptions[0];
		} else {
			const chosenIdx = await InputUiUtil.pGetUserEnum({
				title: `Cast ${spell.name} — Choose Slot Level`,
				htmlDescription: `<div><strong>${spell.name}</strong> is a level ${spell.level} spell. Choose which spell slot to use:</div>`,
				values: castOptions.map(s => s.label),
				fnDisplay: v => v,
				isResolveItem: true,
			});
			if (chosenIdx == null) return; // User cancelled
			selectedSlot = castOptions.find(s => s.label === chosenIdx);
			if (!selectedSlot) return;
		}

		const activeMetamagicChoice = await this._resolveMetamagicChoice({spell, spellData, slotLevel: selectedSlot.level, isExplicit: isExplicitMetamagic, shouldPrompt: shouldPromptMetamagic, decision});
		if (activeMetamagicChoice?.cancelled) return;
		if (!await this._pHandleCastingConstraints(spell, spellData, activeMetamagicChoice?.metamagic || null, {enforceMaterial: true})) return;
		if (activeMetamagicChoice?.metamagic && !this._state.useSorceryPoint(activeMetamagicChoice.metamagic.cost)) {
			JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points for that metamagic."});
			return;
		}
		if (activeMetamagicChoice?.metamagic) this._refreshSorceryPointUI();

		// Variant spell component selection
		const variantComponentChoice = await this._resolveVariantComponentChoice({spell, spellData, decision});
		if (variantComponentChoice?.cancelled) return;

		const castMeta = this._getNormalizedCastMeta({
			spell,
			spellData,
			slotLevel: selectedSlot.level,
			castMeta: {
				...(activeMetamagicChoice?.metamagic ? {appliedMetamagic: activeMetamagicChoice.metamagic} : {}),
				...(variantComponentChoice?.variantComponent ? {variantComponent: variantComponentChoice.variantComponent} : {}),
				...(activeMetamagicChoice?.feywildShard ? {feywildShard: true} : {}),
			},
		});

		// Handle variant component slot modifications (noSlot / lowerSlot)
		let skipSlotConsumption = false;
		if (variantComponentChoice?.variantComponent) {
			const vcEffects = variantComponentChoice.variantComponent.effects;
			if (vcEffects.some(e => e.type === "noSlot")) {
				skipSlotConsumption = true;
			} else {
				const lowerSlotEffect = vcEffects.find(e => e.type === "lowerSlot");
				if (lowerSlotEffect && !selectedSlot.isNoSlotResource) {
					const reducedLevel = Math.max(1, selectedSlot.level - (lowerSlotEffect.reduction || 1));
					if (reducedLevel < selectedSlot.level) {
						selectedSlot = {...selectedSlot, level: reducedLevel};
					}
				}
			}
			// Consume the component(s)
			for (const id of (variantComponentChoice.variantComponent.itemIds || [variantComponentChoice.variantComponent.itemId])) {
				this._state.consumeVariantComponent(id);
			}
		}

		// Consume the selected slot (or no-slot resource).
		// A no-slot resource (e.g. Star Map) is the player's chosen cast vehicle,
		// so it is always spent — a variant component's "noSlot" effect waives
		// spell *slots*, not feature resources.
		if (selectedSlot.isNoSlotResource) {
			const res = this._state.getResources().find(r => r.id === selectedSlot.resourceId);
			if (!res || (res.current || 0) <= 0) {
				JqueryUtil.doToast({type: "warning", content: `No ${selectedSlot.resourceName || "resource"} charges remaining.`});
				return;
			}
			this._state.setResourceCurrent(selectedSlot.resourceId, res.current - 1);
		} else if (!skipSlotConsumption) {
			if (selectedSlot.isPact) {
				this._state.setPactSlotsCurrent(pactSlots.current - 1);
			} else {
				const current = this._state.getSpellSlotsCurrent(selectedSlot.level);
				this._state.setSpellSlots(selectedSlot.level, this._state.getSpellSlotsMax(selectedSlot.level), current - 1);
			}
		}

		const castResult = await this._showCastResult(
			spell,
			selectedSlot.level,
			selectedSlot.isPact,
			false,
			castMeta,
		);

		// If user cancelled (e.g. target selection), refund the slot / resource
		if (castResult?.cancelled) {
			// Refund any sorcery points spent on metamagic for this cast.
			// setSorceryPoints takes an object — passing a bare number would set
			// BOTH current and max, corrupting the pool's max on a non-full refund.
			if (activeMetamagicChoice?.metamagic?.cost) {
				const sp = this._state.getSorceryPoints();
				this._state.setSorceryPoints({current: Math.min(sp.max, sp.current + activeMetamagicChoice.metamagic.cost), max: sp.max});
				this._refreshSorceryPointUI();
			}
			if (selectedSlot.isNoSlotResource) {
				const res = this._state.getResources().find(r => r.id === selectedSlot.resourceId);
				if (res) this._state.setResourceCurrent(selectedSlot.resourceId, (res.current || 0) + 1);
			} else if (!skipSlotConsumption) {
				if (selectedSlot.isPact) {
					// getPactSlots() returns the live object, so `pactSlots.current`
					// was already decremented by the spend above — read it fresh and +1.
					const slots = this._state.getPactSlots();
					this._state.setPactSlotsCurrent((slots.current ?? 0) + 1);
				} else {
					const current = this._state.getSpellSlotsCurrent(selectedSlot.level);
					this._state.setSpellSlots(selectedSlot.level, this._state.getSpellSlotsMax(selectedSlot.level), current + 1);
				}
			}
			return;
		}

		// Set concentration if spell requires it
		const vcRemovesConcN = castMeta.variantComponent?.effects?.some(e => e.type === "removeConcentration");
		if (requiresConcentration && !vcRemovesConcN) {
			this._state.setConcentration?.({name: spell.name, level: selectedSlot.level, appliedMetamagic: castMeta?.appliedMetamagic || null});
			this._updateConcentrationUI();
		}

		// Cast is committed (not cancelled / refunded) — consume any gold-cost material component.
		await this._pConsumeMaterialComponent({spell, spellData, decision, variantUsed: !!variantComponentChoice?.variantComponent});

		this.renderSlots();
		this._page._renderQuickSpells(); // Update overview spell slots
		if (selectedSlot.isNoSlotResource) this._page._renderResources?.(); // Refresh resource tracker (e.g. Star Map)
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
			const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Break Concentration?",
				htmlDescription: `You are currently concentrating on <strong>${currentConc?.spellName || "a spell"}</strong>. Casting <strong>${spell.name}</strong> as a ritual will break that concentration.`,
				textYes: "Cast and break concentration",
				textNo: "Cancel",
			}));
			if (!confirmed) return;
			this._state.breakConcentration?.();
		}

		// Cast as ritual — no slot consumed
		if (!await this._pHandleCastingConstraints(spell, spellData, null, {enforceMaterial: true})) return;
		await this._showCastResult(spell, spell.level, false, true);
		await this._pConsumeMaterialComponent({spell, spellData, variantUsed: false});

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
	 * Process casting constraints: block if hard-blocked, confirm if soft-check required.
	 * @param {object} spell - The spell being cast
	 * @param {object} spellData - Full spell data
	 * @param {object|null} appliedMetamagic - Active metamagic
	 * @returns {Promise<boolean>} true if casting should proceed, false if blocked/cancelled
	 */
	async _pHandleCastingConstraints (spell, spellData, appliedMetamagic = null, opts = {}) {
		const {block, checks} = this._checkCastingConstraints(spell, spellData, appliedMetamagic, opts);
		if (block) {
			JqueryUtil.doToast({type: "warning", content: block});
			return false;
		}
		if (checks.length) {
			const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Condition Check Required",
				htmlDescription: `<div class="mb-2">Casting <strong>${spell.name}</strong> requires passing a check:</div>
					<ul class="mb-2">${checks.map(c => `<li>${c}</li>`).join("")}</ul>
					<div>Did you pass the required check(s)?</div>`,
				textYes: "Yes — cast the spell",
				textNo: "No — cancel",
			}));
			if (!confirmed) return false;
		}
		return true;
	}

	/**
	 * Check for conditions/effects that prevent spellcasting
	 * @param {object} spell - The spell being cast (from character's spell list)
	 * @param {object} spellData - Full spell data from the spells database
	 * @param {object|null} appliedMetamagic - Active metamagic chosen for this cast
	 * @param {object} [opts]
	 * @param {boolean} [opts.enforceMaterial] - When true, also gate on material components
	 *        (gold-cost item possessed / spellcasting focus or pouch for no-cost materials).
	 *        Off by default so innate / item-granted casting (which ignores material
	 *        components) is never blocked.
	 * @returns {{block: string|null, checks: string[]}} block = hard block message, checks = conditions requiring confirmation
	 */
	_checkCastingConstraints (spell, spellData, appliedMetamagic = null, opts = {}) {
		// Advanced opt-in escape hatch: when enabled, skip every condition/component
		// casting gate (incapacitated, verbal/somatic banned-or-check, wild shape).
		// This intentionally does NOT affect slot/sorcery-point/charge spending or
		// concentration bookkeeping — those are handled in `_castSpell`, not here.
		if (this._state.getSettings?.()?.ignoreSpellcastingRestrictions) {
			return {block: null, checks: []};
		}

		// Check for incapacitation via active effects (covers all conditions with incapacitated flag)
		if (this._state.isIncapacitated?.()) {
			// Find which condition(s) are causing it for a clear message
			const conditions = this._state.getConditionNames?.() || [];
			const incapNames = ["Incapacitated", "Paralyzed", "Petrified", "Stunned", "Unconscious"];
			const active = conditions.find(c => incapNames.includes(c)) || "incapacitated";
			return {block: `Cannot cast spells while ${active.toLowerCase()}!`, checks: []};
		}

		// Get spell components
		const components = spellData?.components || spell.components || {};
		const isSubtleSpell = appliedMetamagic?.key === "subtle";
		const hasVerbal = !isSubtleSpell && components.v;
		const hasSomatic = !isSubtleSpell && components.s;

		// Aggregate casting constraints from all active conditions
		const constraints = this._state.getCastingConstraints?.() || {verbal: [], somatic: []};
		const checks = [];

		// Verbal component constraints
		if (hasVerbal) {
			const banned = constraints.verbal.find(c => c.value === "banned");
			if (banned) {
				return {block: `Cannot cast ${spell.name} — spell has verbal components and you are ${banned.conditionName.toLowerCase()}!`, checks: []};
			}
			const check = constraints.verbal.find(c => c.value === "check");
			if (check) {
				checks.push(`${check.conditionName}: verbal spells require a concentration check to cast`);
			}
		}

		// Somatic component constraints
		if (hasSomatic) {
			const banned = constraints.somatic.find(c => c.value === "banned");
			if (banned) {
				return {block: `Cannot cast ${spell.name} — spell has somatic components and you are ${banned.conditionName.toLowerCase()}!`, checks: []};
			}
			const check = constraints.somatic.find(c => c.value === "check");
			if (check) {
				checks.push(`${check.conditionName}: somatic spells require a concentration check to cast`);
			}
		}

		// Material component requirement (only when the caller opts in — i.e. normal/ritual
		// slot/cantrip casting, never innate/item casting which ignores materials).
		if (opts.enforceMaterial) {
			const matBlock = this._getMaterialComponentBlock(spell, spellData);
			if (matBlock) return {block: matBlock, checks: []};
		}

		// Check for Wild Shape (can't cast most spells while transformed)
		const activeStates = this._state.getActiveStates?.() || [];
		const wildShapeState = activeStates.find(s =>
			s.name?.toLowerCase().includes("wild shape") && s.active,
		);
		if (wildShapeState) {
			const hasBeastSpells = this._state.getFeatures?.()?.some(f =>
				f.name?.toLowerCase().includes("beast spells"),
			);
			if (!hasBeastSpells) {
				// Allow but warn - user can decide
			}
		}

		// All checks passed (may have soft checks that need confirmation)
		return {block: null, checks};
	}

	/**
	 * Compute a hard-block message if a spell's MATERIAL component requirement can't
	 * be met, else null. Implements the three enforcement rules:
	 *
	 *   1. Gold-cost material → the character must possess a qualifying item
	 *      (consumed on cast when the component is consumed — handled separately).
	 *   2. No-cost material → the character needs a spellcasting focus / component
	 *      pouch, or a feature that substitutes one (Spellsword Technique, War
	 *      Caster, Star Map, Gambler's Spellcasting).
	 *   3. A matching variant spell component supersedes 1 & 2 entirely.
	 *
	 * @param {object} spell
	 * @param {object} spellData
	 * @returns {string|null}
	 */
	/**
	 * A short human label naming the spellcasting focus (or component pouch /
	 * substitution feature) used to satisfy a spell's no-cost material component,
	 * for display in the cast-result readout. Returns null when the spell has no
	 * focus-satisfiable material component, a variant component was used instead,
	 * or no focus is possessed.
	 *
	 * @param {object} spell
	 * @param {object} spellData
	 * @param {object} [opts]
	 * @param {boolean} [opts.variantUsed] A variant spell component was used (it shows its own line).
	 * @returns {string|null}
	 */
	_getSpellFocusNote (spell, spellData, {variantUsed = false} = {}) {
		if (variantUsed) return null;
		const info = this._state.getSpellMaterialComponentInfo?.(spellData)
			|| this._state.getSpellMaterialComponentInfo?.(spell);
		// Only a no-cost (focus-satisfiable) material component is "cast using a focus";
		// gold-cost components use the consumed item, not a focus.
		if (!info || !info.requiresFocus) return null;
		const focus = this._state.getSpellcastingFocusStatus?.();
		if (!focus?.ok) return null;
		if (!focus.itemName) return focus.source; // feature-only (e.g. Star Map)
		// Avoid redundant "(component pouch)" when the item name already says it.
		const showSource = focus.source && !focus.itemName.toLowerCase().includes(focus.source.toLowerCase());
		return showSource ? `${focus.itemName} (${focus.source})` : focus.itemName;
	}

	_getMaterialComponentBlock (spell, spellData) {
		const info = this._state.getSpellMaterialComponentInfo?.(spellData)
			|| this._state.getSpellMaterialComponentInfo?.(spell);
		if (!info) return null;

		// Rule 3: a matching variant component the player owns waives the requirement.
		if ((this._state.getMatchingVariantComponents?.(spell, spellData) || []).length) return null;

		if (info.requiresFocus) {
			const focus = this._state.getSpellcastingFocusStatus?.() || {ok: false};
			if (focus.ok) return null;
			return `Cannot cast ${spell.name} — its material components require a spellcasting focus or component pouch (none equipped). Equip one, or enable "Ignore spellcasting restrictions" in settings.`;
		}

		// Gold-cost component: the character must possess a qualifying item.
		const candidates = this._state.getGoldComponentCandidates?.(info.cost, info.text) || [];
		if (candidates.length) return null;
		const gp = Math.floor(info.cost / 100);
		return `Cannot cast ${spell.name} — requires a material component worth at least ${gp} gp${info.consume ? " (consumed by the spell)" : ""} that you don't have. Add it to your inventory, or enable "Ignore spellcasting restrictions" in settings.`;
	}

	/**
	 * Consume a gold-cost material component on a committed cast, when the spell
	 * consumes it. No-op when: the escape-hatch setting is on, the material has no
	 * gold cost (a focus covers it), the component isn't consumed, or a variant
	 * component was used in its place.
	 *
	 * Consumption is deliberately CONSERVATIVE — it must never silently destroy a
	 * valuable the player didn't intend to spend:
	 *   - A single inventory item whose NAME matches the component (e.g. a literal
	 *     "Diamond" for Revivify) is unambiguous and consumed directly.
	 *   - Anything else — multiple name matches, or a "value-only" match where no
	 *     item names the component but something is merely worth enough — ALWAYS
	 *     prompts the player to choose which item (if any) to spend, with an
	 *     explicit "keep them / track manually" option. This holds even on a
	 *     quick-cast: a wrong-item destruction is worse than a one-tap prompt.
	 *
	 * @param {object} args
	 * @param {object} args.spell
	 * @param {object} args.spellData
	 * @param {object|null} [args.decision]
	 * @param {boolean} [args.variantUsed]
	 * @returns {Promise<{consumed: (null|{id:string, name:string, value:number})}>}
	 */
	async _pConsumeMaterialComponent ({spell, spellData, decision = null, variantUsed = false}) {
		if (variantUsed) return {consumed: null};
		if (this._state.getSettings?.()?.ignoreSpellcastingRestrictions) return {consumed: null};

		const info = this._state.getSpellMaterialComponentInfo?.(spellData)
			|| this._state.getSpellMaterialComponentInfo?.(spell);
		if (!info || info.requiresFocus || !info.consume) return {consumed: null};

		const candidates = this._state.getGoldComponentCandidates?.(info.cost, info.text) || [];
		if (!candidates.length) return {consumed: null}; // the gate should have blocked; be safe

		// Every candidate is a name match now (value-only items are not accepted as
		// "the component"). Consume a single unambiguous match directly; prompt only
		// when the player genuinely owns several valid components, or the consume is
		// optional — never auto-destroy something the player didn't choose.
		const isOptional = info.consume === "optional";

		let chosen;
		if (!isOptional && candidates.length === 1) {
			chosen = candidates[0];
		} else {
			chosen = await this._pPromptConsumeComponentChoice({
				spell,
				cost: info.cost,
				candidates,
				isOptional,
			});
			if (!chosen) return {consumed: null};
		}

		this._state.consumeItem(chosen.id);
		const gpStr = chosen.value ? ` (${Math.floor(chosen.value / 100)} gp)` : "";
		JqueryUtil.doToast({type: "info", content: `Consumed ${chosen.name}${gpStr} casting ${spell.name}.`});
		return {consumed: {id: chosen.id, name: chosen.name, value: chosen.value}};
	}

	/**
	 * Prompt the player to pick which inventory item to consume as a spell's
	 * gold-cost material component (or to keep them all and track it manually).
	 * Only reached when the player owns several valid (name-matched) components, or
	 * the consume is optional — a single unambiguous component is spent without a
	 * prompt.
	 *
	 * @param {object} args
	 * @param {object} args.spell
	 * @param {number} args.cost Required component value, in copper.
	 * @param {Array<{id:string, name:string, value:number}>} args.candidates
	 * @param {boolean} args.isOptional The spell only optionally consumes the component.
	 * @returns {Promise<(null|{id:string, name:string, value:number})>} The chosen item, or null to keep all.
	 */
	async _pPromptConsumeComponentChoice ({spell, cost, candidates, isOptional}) {
		const labelOf = c => `${c.name}${c.value ? ` (${Math.floor(c.value / 100)} gp)` : ""}`;
		const nm = (typeof Renderer !== "undefined" && Renderer.stripTags) ? Renderer.stripTags(spell.name) : spell.name;

		// A single candidate reads more clearly as a yes/no confirmation than a
		// one-row dropdown (only reached here when the consume is optional).
		if (candidates.length === 1) {
			const c = candidates[0];
			const why = isOptional
				? `<strong>${nm}</strong> can consume a material component for a lasting effect.`
				: `<strong>${nm}</strong> consumes <strong>${c.name}</strong>.`;
			const ok = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: `${spell.name} — Consume Component?`,
				htmlDescription: `<div class="ve-mb-2">${why} Consume <strong>${labelOf(c)}</strong>?</div>`,
				textYes: "Consume it",
				textNo: "Keep it",
			}));
			return ok ? c : null;
		}

		const note = isOptional
			? `Casting <strong>${nm}</strong> can optionally consume a material component. Choose one to spend, or keep them all.`
			: `Casting <strong>${nm}</strong> consumes a material component, and you own more than one that qualifies. Choose which to spend.`;

		const picked = await InputUiUtil.pGetUserEnum(/** @type {*} */ ({
			title: `${spell.name} — Consume Component`,
			values: candidates,
			isResolveItem: true,
			isAllowNull: true,
			elePost: ee`<p class="ve-muted ve-small ve-mt-2 ve-mb-0">${note}</p>`,
			fnDisplay: (c, ix) => (ix === -1 || c == null) ? "Keep them all — I'll track it manually" : labelOf(c),
		}));
		// null = cancelled / "keep all"; a symbol = skipped → all mean "don't consume".
		return (picked && typeof picked !== "symbol") ? picked : null;
	}

	async _showCastResult (spell, slotLevel = null, isPactSlot = false, isRitual = false, castMeta = null) {
		// Delegate to the enhanced spell effects handler
		return this._handleSpellEffects(spell, slotLevel, isPactSlot, isRitual, castMeta);
	}

	/**
	 * Show the active-metamagic picker for a cast.
	 *
	 * Phase (Round 11): replaced the `InputUiUtil.pGetUserEnum` dropdown with a
	 * modal of directly-clickable options. Each available metamagic is its own
	 * row (hover-link name + sorcery-point cost + inline description) that the
	 * player clicks to pick. A "Cast without metamagic" row and a "Cancel"
	 * button round out the choices; unavailable options are listed (muted, with
	 * reasons) so the player understands why they can't be used.
	 *
	 * @param {object} opts
	 * @param {object} opts.spell
	 * @param {object} [opts.spellData]
	 * @param {number} [opts.slotLevel]
	 * @param {boolean} [opts.isExplicit] When true (player clicked "Cast w/ Metamagic"),
	 *        show the modal even if no metamagic is currently available, so the reason is
	 *        explained rather than silently casting normally.
	 * @returns {Promise<{cancelled: boolean, metamagic: object|null}>}
	 */
	/**
	 * Resolve the metamagic choice for a cast. When the cast-options context menu has
	 * pre-selected a metamagic (`decision.metamagic`), revalidate it is still castable at
	 * the ACTUAL slot level before applying (guards against a stale menu / changed SP) —
	 * never under-charges. Otherwise falls back to the interactive picker (or none).
	 * @returns {Promise<{cancelled: boolean, metamagic: (object|null)}>}
	 */
	async _resolveMetamagicChoice ({spell, spellData, slotLevel, isExplicit = false, shouldPrompt = true, decision = null}) {
		if (decision && Object.prototype.hasOwnProperty.call(decision, "metamagic")) {
			if (!decision.metamagic) return {cancelled: false, metamagic: null};
			const options = this._state.getCastableActiveMetamagics?.({spell, spellData, slotLevel}) || [];
			const match = options.find(o => o.key === decision.metamagic.key && o.isAvailable);
			if (!match) {
				JqueryUtil.doToast({type: "warning", content: `${decision.metamagic.name || "That metamagic"} is not available for this cast.`});
				return {cancelled: true, metamagic: null};
			}
			return {cancelled: false, metamagic: match, feywildShard: !!decision.feywildShard};
		}
		if (!shouldPrompt) return {cancelled: false, metamagic: null};
		return this._pChooseActiveMetamagic({spell, spellData, slotLevel, isExplicit});
	}

	/**
	 * Resolve the variant-component choice. One-click cast-options menu entries pass
	 * `decision.skipComponentPrompt` to bypass the (multi-select) component picker; the
	 * dedicated "Cast with components…" entry leaves it enabled.
	 * @returns {Promise<{cancelled: boolean, variantComponent: (object|null)}>}
	 */
	async _resolveVariantComponentChoice ({spell, spellData, decision = null}) {
		if (decision && decision.skipComponentPrompt) return {cancelled: false, variantComponent: null};
		return this._pChooseVariantComponent({spell, spellData});
	}

	/* -------------------------------------------------------------------------- */
	/* Cast-options context menu (right-click desktop / long-press mobile)         */
	/* -------------------------------------------------------------------------- */

	/**
	 * Build the list of concrete, one-click cast choices for a spell — the data behind the
	 * right-click / long-press cast menu. Each item resolves to a `_castSpell(...)` call
	 * with a pre-resolved `decision` so NO further chained prompts are needed (slot level,
	 * metamagic and components are decided up front). Availability is re-checked at execution
	 * time inside `_castSpell`, so a stale menu can never overspend.
	 * @returns {Array<{label: string, sublabel?: string, onSelect: Function}>}
	 */
	_buildCastOptionItems (spell, spellData) {
		const items = [];
		const spellId = spell.id;
		const isCantrip = spell.level === 0;

		// Blade cantrips: the weapon ✨ button is the primary action; the menu only offers
		// the standalone secondary/movement damage roll.
		const channelInfo = isCantrip ? CharacterSheetSpells.getWeaponChannelCantripInfo(spellData) : null;
		if (channelInfo) {
			const channel = this.getWeaponChannelCantripForCharacter(spell, spellData);
			const secLabel = channel?.secondaryLabel || "secondary damage";
			items.push({
				label: `⚔ Roll ${secLabel}`,
				sublabel: "On-hit damage rides your weapon attack (use the ✨ button by your weapon)",
				onSelect: () => this._castSpell(spellId, {withMetamagic: false, decision: {skipComponentPrompt: true}}),
			});
			return items;
		}

		// Basic cast (no metamagic, no component/ritual/slot prompt → a true one-click cast).
		// `autoSlot` picks a base-level slot without prompting; `castAsRitual:false` skips the
		// ritual prompt (the menu has a dedicated ritual entry below).
		const baseDecision = isCantrip
			? {skipComponentPrompt: true}
			: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true};
		items.push({
			label: isCantrip ? "⚡ Cast" : `⚡ Cast (level ${spell.level})`,
			onSelect: () => this._castSpell(spellId, {withMetamagic: false, decision: {...baseDecision}}),
		});

		// Upcast options — one per available higher slot level.
		if (!isCantrip) {
			for (let lvl = spell.level + 1; lvl <= 9; lvl++) {
				const current = this._state.getSpellSlotsCurrent?.(lvl) || 0;
				if (current <= 0) continue;
				items.push({
					label: `⬆ Upcast to level ${lvl}`,
					sublabel: `${current} slot${current === 1 ? "" : "s"} remaining`,
					onSelect: () => this._castSpell(spellId, {withMetamagic: false, decision: {slotLevel: lvl, castAsRitual: false, skipComponentPrompt: true}}),
				});
			}
		}

		// Metamagic — one entry per currently-available active metamagic (at base level).
		// Feywild Shard (TCE): when attuned, a metamagic cast of a leveled spell can also
		// discharge the shard to roll a PHB Wild Magic Surge — surfaced as a metamagic-gated
		// variant (never on a plain cast), mirroring the toggle in the metamagic picker modal.
		const isFeywildShardAttuned = !isCantrip && (this._state.getAttunedItems?.() || []).some(it => (it?.item?.name || it?.name) === "Feywild Shard");
		const metamagics = this._state.getCastableActiveMetamagics?.({spell, spellData, slotLevel: isCantrip ? 0 : spell.level}) || [];
		const availableMm = metamagics.filter(m => m.isAvailable);
		for (const meta of availableMm) {
			items.push({
				label: `🌀 ${meta.name}`,
				sublabel: `${meta.cost} SP`,
				onSelect: () => this._castSpell(spellId, {decision: {...baseDecision, metamagic: {key: meta.key, name: meta.name, cost: meta.cost}}}),
			});
			if (isFeywildShardAttuned) {
				items.push({
					label: `🌀 ${meta.name} + ✨ Feywild Shard`,
					sublabel: `${meta.cost} SP · discharge shard (Wild Magic Surge)`,
					onSelect: () => this._castSpell(spellId, {decision: {...baseDecision, metamagic: {key: meta.key, name: meta.name, cost: meta.cost}, feywildShard: true}}),
				});
			}
		}
		// Upcast+metamagic combos and unavailable-reason display fall back to the full picker.
		if (metamagics.length) {
			items.push({
				label: "🌀 Cast with Metamagic…",
				sublabel: "Choose metamagic (supports upcast combos)",
				onSelect: () => this._castSpell(spellId, {withMetamagic: true}),
			});
		}

		// Ritual.
		if (this._state.canCastAsRitual?.(spell)) {
			items.push({
				label: "🔮 Cast as Ritual",
				sublabel: "No slot, +10 min casting time",
				onSelect: () => this._castSpellAsRitual(spellId),
			});
		}

		// Variant components (kept as a multi-select picker entry, not flattened).
		const hasComponents = (this._state.getMatchingVariantComponents?.(spell, spellData) || []).length > 0;
		if (hasComponents) {
			items.push({
				label: "🧪 Cast with components…",
				sublabel: "Choose variant spell components",
				onSelect: () => this._castSpell(spellId, {withMetamagic: false}),
			});
		}

		return items;
	}

	/**
	 * Open the cast-options menu for a spell id near a pointer event. Shared entry point for
	 * the desktop right-click handler and the mobile long-press handler.
	 */
	_openSpellCastMenu (spellId, event) {
		const spell = this._state.getSpells().find(s => s.id === spellId);
		if (!spell) return;
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);
		const items = this._buildCastOptionItems(spell, spellData);
		if (!items.length) return;
		this._showCastOptionsMenu(event, `Cast ${spell.name}`, items);
	}

	/**
	 * SELF-CONTAINED generic context-menu helper (FLAGGED for merge — new local helper).
	 * Renders a fixed-position popup of `{label, sublabel, disabled, onSelect}` items near
	 * the pointer, dismissed on outside-click / Escape. Mirrors the DOM/positioning pattern
	 * of charactersheet.js `_showSkillAbilityMenu` (and reuses its `.charsheet__ability-menu`
	 * base class) but is parameterised by an item list. Kept local to the spells module to
	 * avoid cross-module coupling.
	 */
	_showCastOptionsMenu (event, title, items) {
		if (event) {
			event.preventDefault?.();
			event.stopPropagation?.();
		}
		// Tear down any previously-open cast menu (and its document listeners) before opening
		// a new one, so stale click/keydown handlers can't accumulate.
		this._activeCastMenuCleanup?.();
		this._activeCastMenuCleanup = null;
		document.querySelector(".charsheet__cast-menu")?.remove();
		if (!items || !items.length) return;

		const menu = e_({outer: `<div class="charsheet__cast-menu charsheet__ability-menu"></div>`});

		let closeMenu;
		let onKey;
		const cleanup = () => {
			menu.remove();
			document.removeEventListener("click", closeMenu);
			document.removeEventListener("keydown", onKey);
			if (this._activeCastMenuCleanup === cleanup) this._activeCastMenuCleanup = null;
		};
		this._activeCastMenuCleanup = cleanup;
		closeMenu = (e) => { if (!(/** @type {*} */ (e.target)).closest?.(".charsheet__cast-menu")) cleanup(); };
		onKey = (e) => { if (e.key === "Escape") cleanup(); };

		if (title) menu.append(e_({outer: `<div class="charsheet__cast-menu-title ve-muted ve-small">${title}</div>`}));

		items.forEach(item => {
			const optionEl = e_({outer: `
				<div class="charsheet__cast-menu-option charsheet__ability-menu-option ${item.disabled ? "charsheet__cast-menu-option--disabled" : ""}">
					<span class="charsheet__cast-menu-label">${item.label}</span>
					${item.sublabel ? `<span class="charsheet__cast-menu-sublabel ve-muted ve-small ve-block">${item.sublabel}</span>` : ""}
				</div>
			`});
			if (!item.disabled) {
				optionEl.addEventListener("click", (e) => {
					e.stopPropagation();
					cleanup();
					item.onSelect?.();
				});
			}
			menu.append(optionEl);
		});

		const clientX = event?.clientX ?? (window.innerWidth / 2);
		const clientY = event?.clientY ?? (window.innerHeight / 2);
		Object.assign(menu.style, {position: "fixed", left: `${clientX}px`, top: `${clientY}px`, zIndex: 10000});
		document.body.append(menu);

		// Clamp into the viewport.
		const rect = menu.getBoundingClientRect();
		if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 8)}px`;
		if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 8)}px`;

		setTimeout(() => {
			document.addEventListener("click", closeMenu);
			document.addEventListener("keydown", onKey);
		}, 10);
	}

	async _pChooseActiveMetamagic ({spell, spellData, slotLevel, isExplicit = false}) {
		const metamagicOptions = this._state.getCastableActiveMetamagics?.({spell, spellData, slotLevel}) || [];
		if (!metamagicOptions.length) return {cancelled: false, metamagic: null};

		const availableOptions = metamagicOptions.filter(it => it.isAvailable);
		// No available options: for auto prompts, quietly proceed with a normal cast.
		// For an explicit metamagic cast, fall through and show the modal (with the
		// unavailable reasons) so the player understands why nothing can be applied.
		if (!availableOptions.length && !isExplicit) return {cancelled: false, metamagic: null};

		const unavailableOptions = metamagicOptions.filter(it => !it.isAvailable);

		let result = {cancelled: true, metamagic: null};
		let resolveOuter;
		const pResult = new Promise(resolve => { resolveOuter = resolve; });

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Cast ${spell.name} — Metamagic`,
			isMinHeight0: true,
			cbClose: () => resolveOuter(result),
		});

		modalInner.appendChild(e_({tag: "div",
			clazz: "mb-2",
			html: `Select an active metamagic for this cast. You currently have <strong>${this._state.getSorceryPoints().current}</strong> sorcery points.`,
		}));

		// Feywild Shard (TCE): a metamagic cast of a leveled spell can also discharge an
		// attuned shard to roll a PHB Wild Magic Surge. Opt-in only — and only honoured when
		// a metamagic is actually applied (the "Cast without metamagic" row ignores it).
		const isFeywildShardAttuned = slotLevel > 0 && (this._state.getAttunedItems?.() || []).some(it => (it?.item?.name || it?.name) === "Feywild Shard");
		let feywildToggle = null;
		if (isFeywildShardAttuned) {
			const feywildWrap = e_({tag: "label",
				clazz: "ve-flex-v-center mb-2 charsheet__mm-picker-feywild",
				html: `<input type="checkbox" class="mr-2"><span>✨ Discharge <strong>Feywild Shard</strong> — roll a Wild Magic Surge (only with an applied metamagic)</span>`,
			});
			feywildToggle = feywildWrap.querySelector("input[type=checkbox]");
			modalInner.appendChild(feywildWrap);
		}

		const optionList = e_({tag: "div", clazz: "charsheet__mm-picker-options ve-flex-col"});

		// Clickable metamagic rows
		availableOptions.forEach(meta => {
			const row = e_({
				tag: "button",
				clazz: "ve-btn ve-btn-default charsheet__mm-picker-option ve-text-left mb-1",
				html: `
					<span class="charsheet__mm-picker-option-head split-v-center">
						<span class="charsheet__mm-picker-reference-name bold">${this._getMetamagicHoverLink(meta)}</span>
						<span class="charsheet__mm-picker-reference-cost ml-2">${meta.cost} SP</span>
					</span>
					${meta.description ? `<span class="charsheet__mm-picker-reference-desc ve-muted ve-small ve-block">${meta.description}</span>` : ""}
				`,
			});
			row.dataset.metamagicKey = meta.key;
			row.addEventListener("click", () => { result = {cancelled: false, metamagic: meta, ...(feywildToggle ? {feywildShard: !!feywildToggle.checked} : {})}; doClose(true); });
			optionList.appendChild(row);
		});

		// "No metamagic" row
		const rowNone = e_({
			tag: "button",
			clazz: "ve-btn ve-btn-primary charsheet__mm-picker-option charsheet__mm-picker-option--none mb-1",
			text: "Cast without metamagic",
		});
		rowNone.dataset.mmAction = "none";
		rowNone.addEventListener("click", () => { result = {cancelled: false, metamagic: null}; doClose(true); });
		optionList.appendChild(rowNone);

		modalInner.appendChild(optionList);

		// Unavailable options (informational)
		if (unavailableOptions.length) {
			const eleUnavail = e_({tag: "div",
				clazz: "mt-2 ve-small ve-muted charsheet__mm-picker-unavailable",
				html: `<strong>Unavailable:</strong><br>${unavailableOptions.map(it => `${it.name}: ${it.unavailableReason}`).join("<br>")}`,
			});
			eleUnavail.dataset.mmSection = "unavailable";
			modalInner.appendChild(eleUnavail);
		}

		// Cancel
		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-2 charsheet__mm-picker-cancel", text: "Cancel"});
		btnCancel.dataset.mmAction = "cancel";
		btnCancel.addEventListener("click", () => { result = {cancelled: true, metamagic: null}; doClose(false); });
		modalInner.appendChild(btnCancel);

		return pResult;
	}

	_getMetamagicHoverLink (meta) {
		if (!meta?.name || typeof this._page?.getHoverLink !== "function") return meta?.name || "";

		try {
			const optFeature = this._getMetamagicOptionalFeature(meta);
			return this._page.getHoverLink(globalThis.UrlUtil?.PG_OPT_FEATURES || "optionalfeatures.html", optFeature.name, optFeature.source, null, meta.name);
		} catch (e) {
			return meta.name;
		}
	}

	_getMetamagicOptionalFeature (meta) {
		const fallbackSource = meta.source || "TGTT";
		const typeSuffix = meta.type === "passive" ? "Passive" : meta.type === "active" ? "Active" : null;
		const tgttName = typeSuffix ? `${meta.name} (${typeSuffix})` : meta.name;
		const allOptFeatures = this._page?.getOptionalFeatures?.() || this._page?._optionalFeaturesData || [];

		const exactTgtt = allOptFeatures.find(it => it.name === tgttName && (it.source || "").toUpperCase() === "TGTT");
		if (exactTgtt) return {name: exactTgtt.name, source: exactTgtt.source};

		const exactSource = allOptFeatures.find(it => it.name === tgttName && (!fallbackSource || (it.source || "").toUpperCase() === fallbackSource.toUpperCase()));
		if (exactSource) return {name: exactSource.name, source: exactSource.source};

		if (typeSuffix) return {name: tgttName, source: "TGTT"};

		const source = typeof this._page?.resolveOptionalFeatureSource === "function"
			? this._page.resolveOptionalFeatureSource(meta.name, [meta.source, "TGTT", globalThis.Parser?.SRC_XPHB, globalThis.Parser?.SRC_PHB])
			: fallbackSource;
		return {name: meta.name, source};
	}

	// region Variant Spell Components

	/**
	 * Offer the player a choice of variant spell components from their inventory that match the spell being cast.
	 * Supports selecting multiple components — effects are merged into one object.
	 * If multiple components are selected, `variantComponent.componentCount` > 1 triggers Wild Magic surge.
	 * @param {object} opts
	 * @param {object} opts.spell - {name, source, level} from the character's spell list
	 * @param {object} [opts.spellData] - Full spell data from the database
	 * @returns {Promise<{cancelled: boolean, variantComponent: object|null}>}
	 *   variantComponent: {itemIds, itemName, effects, componentCount} or null
	 */
	async _pChooseVariantComponent ({spell, spellData = null}) {
		const matches = this._state.getMatchingVariantComponents(spell, spellData);
		if (!matches.length) return {cancelled: false, variantComponent: null};

		const selected = [];
		let remaining = [...matches];

		// Loop: pick one component at a time, offer to add more if available
		while (remaining.length > 0) {
			const labels = [`${selected.length ? "Done — no more components" : "None — cast normally"}`];
			const matchMap = [];
			for (const {invItem, spellEffect} of remaining) {
				const qty = invItem.quantity || 1;
				const effectSummary = (spellEffect.effects || [])
					.map(eff => this._getVariantEffectLabel(eff))
					.filter(Boolean)
					.join(", ");
				const desc = spellEffect.description || effectSummary || "Enhanced casting";
				labels.push(`🧪 ${invItem.item.name} (×${qty}) — ${desc}`);
				matchMap.push({invItem, spellEffect});
			}

			const selectedNames = selected.map(s => s.itemName).join(", ");
			const alreadySelected = selected.length
				? `<br><span class="text-success">Selected: ${selectedNames}</span>`
				: "";
			const wildMagicWarning = selected.length >= 1
				? `<br><span class="text-warning">⚠ Adding another component risks a Wild Magic surge!</span>`
				: remaining.length > 1
					? `<br><span class="text-muted">Multiple components available — using 2+ on one spell risks a Wild Magic surge.</span>`
					: "";

			const choice = await InputUiUtil.pGetUserEnum({
				title: `${spell.name} — Variant Component${selected.length ? ` (${selected.length} selected)` : ""}`,
				htmlDescription: `<div>You have variant spell components that can enhance this spell. Using a component consumes it.${alreadySelected}${wildMagicWarning}</div>`,
				values: labels,
				fnDisplay: v => v,
				isResolveItem: true,
			});

			if (choice == null) return {cancelled: true, variantComponent: null};
			if (choice === labels[0]) break; // "None" or "Done"

			const idx = labels.indexOf(choice) - 1;
			if (idx < 0 || idx >= matchMap.length) break;

			const pick = matchMap[idx];
			selected.push({
				itemId: pick.invItem.id,
				itemName: pick.invItem.item.name,
				effects: pick.spellEffect.effects || [],
			});

			// Remove from remaining so the same component can't be picked twice
			remaining = remaining.filter((_, i) => i !== idx);

			// If only one was selected and there are more available, loop continues
			// If no more remain, break automatically
			if (!remaining.length) break;
		}

		if (!selected.length) return {cancelled: false, variantComponent: null};

		// Merge all selected components into one variantComponent object
		const mergedEffects = selected.flatMap(s => s.effects);
		const mergedNames = selected.map(s => s.itemName).join(" + ");
		return {
			cancelled: false,
			variantComponent: {
				itemIds: selected.map(s => s.itemId),
				itemId: selected[0].itemId, // backward compat: first component ID
				itemName: mergedNames,
				effects: mergedEffects,
				componentCount: selected.length,
			},
		};
	}

	/**
	 * Get a human-readable label for a variant component effect.
	 * @param {object} effect - A single effect from spellEffect.effects
	 * @returns {string}
	 */
	_getVariantEffectLabel (effect) {
		switch (effect.type) {
			case "bonusDamage": return `+${effect.dice || "?"} ${effect.damageType || ""} damage`;
			case "bonusDice": return `+${effect.count || 1} damage dice`;
			case "dieSizeIncrease": return `die size +${effect.steps || 1}${effect.maxDie ? ` (max ${effect.maxDie})` : ""}`;
			case "maximizeDamage": return "maximize damage dice";
			case "noSlot": return "no spell slot consumed";
			case "lowerSlot": return `cast ${effect.reduction || 1} level${(effect.reduction || 1) > 1 ? "s" : ""} lower`;
			case "saveDcMod": return `save DC ${(effect.mod || 0) > 0 ? "+" : ""}${effect.mod || 0}`;
			case "saveDisadvantage": return `${effect.ability || ""} save at disadvantage`;
			case "condition": return `applies ${effect.condition || "?"}${effect.duration ? ` for ${effect.duration}` : ""}`;
			case "removeConcentration": return "no concentration required";
			case "acOverride": return `AC becomes ${effect.formula || "?"}`;
			case "resistance": return `grants ${(effect.types || []).join(", ")} resistance`;
			case "immunity": return `grants ${(effect.types || []).join(", ")} immunity`;
			case "speedOverride": return `${effect.speedType || "speed"} becomes ${effect.value || "?"} ft.`;
			case "speedFallRate": return `fall rate ${effect.rate || "?"} ft./round`;
			case "additionalTargets": return `+${effect.count || 1} additional target${(effect.count || 1) > 1 ? "s" : ""}`;
			case "areaChange": return `area: ${effect.description || "?"}`;
			case "rangeChange": return `range: ${effect.value || "?"}${effect.unit ? ` ${effect.unit}` : ""}`;
			case "grantAttack": return `grants ${effect.attackName || "attack"}${effect.attackDamage ? ` (${effect.attackDamage} ${effect.attackDamageType || ""})` : ""}`;
			case "text": return effect.text || "";
			default: return effect.type;
		}
	}

	/**
	 * Apply variant component effects to the spell cast and return display notes.
	 * Mutates damageResult and effectsApplied in place where appropriate.
	 * @param {object} opts
	 * @param {Array} opts.effects - The variant component effect objects
	 * @param {object|null} opts.damageResult - The current damage result (mutable)
	 * @param {object} opts.spell - The spell being cast
	 * @param {object|null} opts.spellData - Full spell data
	 * @param {Array<string>} opts.effectsApplied - Array to push applied effect strings into
	 * @returns {Array<string>} Notes to display in the cast toast
	 */
	_applyVariantComponentEffects ({effects, damageResult, spell, spellData, effectsApplied}) {
		const notes = [];

		for (const effect of effects) {
			switch (effect.type) {
				case "bonusDamage": {
					const dmgType = effect.damageType || damageResult?.damageType || "";
					const diceExpr = effect.dice || "0";
					notes.push(`🧪 +${diceExpr} ${dmgType} damage (variant component)`);
					break;
				}

				case "bonusDice": {
					notes.push(`🧪 +${effect.count || 1} bonus damage dice (variant component)`);
					break;
				}

				case "dieSizeIncrease": {
					const stepNote = effect.maxDie ? ` (max ${effect.maxDie})` : "";
					notes.push(`🧪 Damage die size +${effect.steps || 1} step${(effect.steps || 1) > 1 ? "s" : ""}${stepNote} (variant component)`);
					break;
				}

				case "maximizeDamage": {
					notes.push(`🧪 Damage dice maximized (variant component)`);
					break;
				}

				// noSlot and lowerSlot handled in _castSpell before slot consumption
				case "noSlot":
					notes.push(`🧪 No spell slot consumed (variant component)`);
					break;

				case "lowerSlot": {
					const red = effect.reduction || 1;
					notes.push(`🧪 Spell slot reduced by ${red} level${red > 1 ? "s" : ""} (variant component)`);
					break;
				}

				// saveDcMod and saveDisadvantage handled in save DC calculation above
				case "saveDcMod":
				case "saveDisadvantage":
					break;

				case "condition": {
					const condName = effect.condition || "a condition";
					const condDur = effect.duration ? ` for ${effect.duration}` : "";
					effectsApplied.push(`🧪 ${condName}${condDur} (variant component)`);
					break;
				}

				case "removeConcentration":
					notes.push(`🧪 Concentration removed (variant component)`);
					break;

				case "acOverride":
					notes.push(`🧪 AC becomes ${effect.formula || effect.value || "?"} (variant component)`);
					break;

				case "resistance":
					notes.push(`🧪 Grants ${(effect.types || []).join(", ") || "?"} resistance (variant component)`);
					break;

				case "immunity":
					notes.push(`🧪 Grants ${(effect.types || []).join(", ") || "?"} immunity (variant component)`);
					break;

				case "speedOverride":
					notes.push(`🧪 ${effect.speedType || "Speed"} becomes ${effect.value || "?"} ft. (variant component)`);
					break;

				case "speedFallRate":
					notes.push(`🧪 Fall rate ${effect.rate || "?"} ft./round (variant component)`);
					break;

				case "additionalTargets":
					notes.push(`🧪 +${effect.count || 1} additional target${(effect.count || 1) > 1 ? "s" : ""} (variant component)`);
					break;

				case "areaChange":
					notes.push(`🧪 Area changed: ${effect.description || "?"} (variant component)`);
					break;

				case "rangeChange":
					notes.push(`🧪 Range changed: ${effect.value || "?"}${effect.unit ? ` ${effect.unit}` : ""} (variant component)`);
					break;

				case "grantAttack": {
					const atkName = effect.attackName || "Variant Attack";
					const atkDmg = effect.attackDamage ? ` (${effect.attackDamage} ${effect.attackDamageType || ""})` : "";
					const atkDur = effect.attackDuration ? ` for ${effect.attackDuration}` : "";
					notes.push(`🧪 Granted attack: ${atkName}${atkDmg}${atkDur}`);
					// Actual attack creation handled by caller after effects
					break;
				}

				case "text":
					notes.push(`🧪 ${effect.text || ""}`);
					break;

				default:
					notes.push(`🧪 ${effect.type} (variant component)`);
					break;
			}
		}

		return notes;
	}

	/**
	 * Roll a Wild Magic surge check triggered by using multiple variant components on one spell.
	 * Surge probability increases with the number of components used.
	 * @param {number} componentCount - Number of variant components used (2+)
	 * @returns {{roll: number, threshold: number, surged: boolean, effect: string|null}}
	 */
	_rollVariantWildMagicSurge (componentCount) {
		// Threshold: 2 components = surge on 1-2, 3 = 1-4, etc. (2^(n-1) on d20)
		const threshold = Math.min(20, Math.pow(2, componentCount - 1));
		const roll = RollerUtil.randomise(20);
		const surged = roll <= threshold;

		if (!surged) return {roll, threshold, surged, effect: null};

		// Roll on the Wild Magic Surge table (d100)
		const surgeRoll = RollerUtil.randomise(100);
		const effect = CharacterSheetSpells._VARIANT_WILD_MAGIC_TABLE.find(
			e => surgeRoll >= e.min && surgeRoll <= e.max,
		)?.effect || "The DM determines a random magical effect.";

		return /** @type {*} */ ({roll, threshold, surged, effect, surgeRoll});
	}

	/**
	 * Roll on the 2014 PHB Wild Magic Surge table (d100). Used by the Feywild Shard
	 * (TCE) item, which lets an attuned sorcerer roll on this table when casting a
	 * spell of 1st level or higher. This is the *real* PHB surge table — distinct
	 * from `_VARIANT_WILD_MAGIC_TABLE`, which is the homebrew variant-component table.
	 * @returns {{roll: number, effect: string}}
	 */
	_rollPhbWildMagicSurge () {
		const roll = RollerUtil.randomise(100);
		const effect = CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE.find(
			e => roll >= e.min && roll <= e.max,
		)?.effect || "The DM determines a random magical effect.";
		return {roll, effect};
	}

	// endregion

	/**
	 * @param {*} [opts]
	 */
	async _pMaybeApplySeekingSpell (opts = {}) {
		const {spell, attackRoll = 0, attackTotal = 0, castMeta = null} = opts;
		if (castMeta?.appliedMetamagic?.key !== "seeking") return castMeta;

		const shouldReroll = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
			title: "Seeking Spell",
			htmlDescription: `<div><strong>${spell?.name || "This spell"}</strong> rolled <strong>${attackTotal}</strong> to hit. If the spell attack missed, you can use Seeking Spell to reroll the d20 once.</div>`,
			textYes: "Reroll Missed Attack",
			textNo: "Keep Original Roll",
		}));

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
		let offerApplyToSelf = null;

		// Roll history tracking for spell components
		const _rollMeta = {attack: null, dc: null};

		// Check for touch spell delivery via familiar
		if (spellData) {
			metamagicNotes = this._getCastMetamagicNotes({spellData, castMeta: normalizedCastMeta});

			const isTouchSpell = normalizedCastMeta.rangeMeta?.effectiveDistanceType === "touch"
				|| spellData.range?.distance?.type === "touch";
			if (isTouchSpell) {
				const activeFamiliar = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR)
					?.find(f => f.active !== false);

				if (activeFamiliar && !activeFamiliar.usedReaction) {
					const deliverViaFamiliar = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
						title: "Touch Spell Delivery",
						htmlDescription: `<strong>${spell.name}</strong> is a touch spell. Your familiar <strong>${activeFamiliar.customName || activeFamiliar.name}</strong> can deliver the touch for you (using its Reaction).`,
						textYes: "🐾 Deliver via Familiar",
						textNo: "✋ Touch Directly",
					}));

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
			const profBonus = this._state.getProficiencyBonus();
			const exhaustionDcPenalty = this._state._getExhaustionDcPenalty?.() || 0;

			// Gambler spellcasting: roll modifier dice fresh each cast instead of static ability mod.
			// This is a per-spell mode — only Gambler-sourced spells roll dice; a Wizard or
			// Cleric spell on the same character uses its own class ability.
			const calcs = this._state.getFeatureCalculations?.();
			const isGamblerSpell = spell?.sourceClass === "Gambler" || spell?.sourceSubclass === "Gambler";
			const isGamblerCast = isGamblerSpell && calcs?.hasGamblerSpellcasting;
			let spellcastingMod;
			let gamblerModRoll = null;
			if (isGamblerCast && calcs.gamblerModifierDice) {
				const rollTotal = Renderer.dice.parseRandomise2(calcs.gamblerModifierDice);
				gamblerModRoll = {total: rollTotal, dice: calcs.gamblerModifierDice};
				spellcastingMod = rollTotal;
			} else {
				// Route to the casting class's ability for this specific spell.
				const castingAbility = this._state.getSpellcastingAbilityForSpell?.(spell)
					|| this._state.getSpellcastingAbility()
					|| "int";
				spellcastingMod = this._state.getAbilityMod(castingAbility);
			}

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
				// Animate the spell-attack d20 (lands on the resolved roll).
				await this._page.pAnimateDiceSpec?.({groups: [{sides: 20, values: [finalRoll]}]});
				const aimedText = aimedBonus ? ` + ${aimedBonus.total} aimed` : "";
				const seekingText = normalizedCastMeta.attackMeta?.seekingRerollUsed
					? ` <span class="ve-muted">(rerolled from ${normalizedCastMeta.attackMeta.originalRoll})</span>`
					: "";
				const gamblerAttackNote = gamblerModRoll ? ` <span class="ve-muted">(🎲 ${gamblerModRoll.dice}: ${gamblerModRoll.total})</span>` : "";
				attackInfo = `<br>Spell Attack: ${finalRoll} + ${attackBonus}${aimedText} = <strong>${finalRoll + totalAttackBonus}</strong>${seekingText}${gamblerAttackNote}`;
				_rollMeta.attack = {total: finalRoll + totalAttackBonus, breakdown: `1d20 (${finalRoll}) + ${attackBonus}${aimedText}`};
			}

			// Check for save DC
			if (spellData.savingThrow) {
				let saveDC = 8 + spellcastingMod + profBonus - exhaustionDcPenalty;

				// Apply variant component save DC modifier
				const vcSaveDcMod = normalizedCastMeta.variantComponent?.effects?.find(e => e.type === "saveDcMod");
				const vcDcModVal = vcSaveDcMod?.mod || 0;
				if (vcDcModVal) saveDC += vcDcModVal;

				const vcSaveDisadv = normalizedCastMeta.variantComponent?.effects?.some(e => e.type === "saveDisadvantage");
				let saveNote = "";
				if (normalizedCastMeta.saveMeta?.firstTargetDisadvantage) {
					saveNote = "; first target rolls at disadvantage";
				} else if (vcSaveDisadv) {
					saveNote = "; target saves at disadvantage (🧪)";
				}
				const gamblerDcNote = gamblerModRoll ? ` <span class="ve-muted">(🎲 ${gamblerModRoll.dice}: ${gamblerModRoll.total})</span>` : "";
				const vcDcNote = vcDcModVal ? ` <span class="text-info">(🧪 ${vcDcModVal > 0 ? "+" : ""}${vcDcModVal} DC)</span>` : "";
				attackInfo += `<br>Save DC: <strong>${saveDC}</strong> (${spellData.savingThrow.join("/")} save${saveNote})${gamblerDcNote}${vcDcNote}`;
				_rollMeta.dc = {total: saveDC, breakdown: `8 + ${spellcastingMod} + ${profBonus}${exhaustionDcPenalty ? ` - ${exhaustionDcPenalty}` : ""}${vcDcModVal ? ` + ${vcDcModVal} (component)` : ""} (${spellData.savingThrow.join("/")})`};
			}

			// Parse spell effects to determine what the spell does
			const effects = CharacterSheetState.parseSpellEffects(spellData);
			const targetInfo = {
				...CharacterSheetState.getValidTargets(spellData),
				...(normalizedCastMeta.targetingMeta || {}),
			};

			// Determine if we should ask for a target
			const selfTargetMode = CharacterSheetSpells.resolveSelfTargetingMode(targetInfo, effects);

			// Apply-to-self is now a POST-cast, non-blocking affordance (see toast below)
			// instead of a blocking pre-roll target prompt. Beneficial, non-self-only spells
			// resolve immediately; the player opts into applying the effect to themselves via
			// a bright button in the result toast (which rolls/applies the payload ONCE).
			if (selfTargetMode === "offer") {
				offerApplyToSelf = {spell, spellData, effects, slotLevel};
				// Informational only — do NOT pre-roll healing here (apply-to-self rolls once
				// on click, so the applied amount always matches what is shown).
				damageInfo = this._describeBeneficialEffects(effects);
			} else if (selfTargetMode === "auto") {
				// Self-only spells automatically target self
				effectsApplied = await this._applySpellEffectsToSelf(spell, spellData, effects, slotLevel);
			} else {
				// Damage or other effects targeting enemies
				damageResult = this._rollSpellDamage(spellData, slotLevel, spell.level, appliedMetamagic, spell);
				damageInfo = damageResult?.text || "";

				// Roll healing if spell heals but targets others by default (like Mass Cure Wounds)
				if (!damageInfo) {
					const healAbility = this._state.getSpellcastingAbilityForSpell?.(spell) || this._state.getSpellcastingAbility() || "int";
					damageInfo = this._rollSpellHealing(spellData, slotLevel, spell.level, healAbility);
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

			// Apply variant component damage/combat effects
			if (normalizedCastMeta.variantComponent?.effects?.length) {
				const vcNotes = this._applyVariantComponentEffects({
					effects: normalizedCastMeta.variantComponent.effects,
					damageResult,
					spell,
					spellData,
					effectsApplied,
				});
				if (vcNotes.length) metamagicNotes.push(...vcNotes);

				// Create temporary attacks from grantAttack effects
				for (const eff of normalizedCastMeta.variantComponent.effects) {
					if (eff.type !== "grantAttack") continue;
					this._state.addTemporaryAttack({
						name: eff.attackName || `${spell.name} Attack`,
						isMelee: eff.attackIsMelee !== false,
						abilityMod: eff.attackAbility || "spellcasting",
						damage: eff.attackDamage || "1d6",
						damageType: eff.attackDamageType || "force",
						range: eff.attackRange || "5 ft",
						properties: eff.attackProperties || [],
						sourceSpell: spell.name,
						sourceDuration: eff.attackDuration || "concentration",
						sourceComponent: normalizedCastMeta.variantComponent.itemName,
					});
				}
			}
		}

		// Wild Magic surge check: using 2+ variant components on one spell
		let wildMagicSurgeResult = null;
		if (normalizedCastMeta.variantComponent?.componentCount > 1) {
			wildMagicSurgeResult = this._rollVariantWildMagicSurge(normalizedCastMeta.variantComponent.componentCount);
		}

		// Feywild Shard (TCE): casting a leveled spell while attuned rolls on the 2014
		// PHB Wild Magic Surge table. The spell still resolves normally; this is purely
		// an additional surge roll reported in the result toast.
		let feywildSurgeResult = null;
		if (normalizedCastMeta.feywildShard && (slotLevel || spell.level) > 0) {
			feywildSurgeResult = this._rollPhbWildMagicSurge();
		}

		// Build the toast message
		let toastContent = `Cast ${spell.name}${upcast}${slotType}`;
		if (normalizedCastMeta.appliedMetamagic) {
			toastContent += `<br><span class="ve-muted">Metamagic: ${normalizedCastMeta.appliedMetamagic.name} (-${normalizedCastMeta.appliedMetamagic.cost} SP)</span>`;
		}

		// Show variant component usage
		if (normalizedCastMeta.variantComponent) {
			toastContent += `<br><span class="text-info">🧪 Component: ${normalizedCastMeta.variantComponent.itemName}</span>`;
		}

		// Detail the spellcasting focus (or component pouch / substitution) used to
		// satisfy a no-cost material component.
		const focusNote = this._getSpellFocusNote(spell, spellData, {variantUsed: !!normalizedCastMeta.variantComponent});
		if (focusNote) {
			toastContent += `<br><span class="text-info">🔮 Focus: ${focusNote}</span>`;
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

		// Non-blocking "apply to self" affordance for beneficial, non-self-only spells.
		if (offerApplyToSelf) {
			toastContent += `<br><button class="ve-btn ve-btn-xs ve-btn-primary btn-apply-to-self mt-1" type="button">✨ Apply ${spell.name} to Self</button>`;
		}

		// Wild Magic surge result from multi-component usage
		if (wildMagicSurgeResult) {
			if (wildMagicSurgeResult.surged) {
				toastContent += `<br><span class="text-danger">🌀 <strong>Wild Magic Surge!</strong> Rolled ${wildMagicSurgeResult.roll} (needed ≤${wildMagicSurgeResult.threshold})</span>`;
				toastContent += `<br><span class="text-warning">⚡ ${wildMagicSurgeResult.effect}</span>`;
			} else {
				toastContent += `<br><span class="text-muted">🌀 Wild Magic check: ${wildMagicSurgeResult.roll} (safe — needed ≤${wildMagicSurgeResult.threshold})</span>`;
			}
		}

		// Feywild Shard surge result (2014 PHB Wild Magic Surge table)
		if (feywildSurgeResult) {
			toastContent += `<br><span class="text-danger">🌀 <strong>Feywild Shard — Wild Magic Surge!</strong> Rolled ${feywildSurgeResult.roll}</span>`;
			toastContent += `<br><span class="text-warning">⚡ ${feywildSurgeResult.effect}</span>`;
		}

		// Gambler's Folly - automatic bet roll on spell cast (TGTT Gambler subclass)
		const gamblerFollyResult = await this._handleGamblerFolly(spell, slotLevel);
		let hasGamblerFolly = false;
		if (gamblerFollyResult) {
			toastContent += gamblerFollyResult.html;
			hasGamblerFolly = true;
		}

		// Log spell roll components to roll history
		if (this._page._rollHistory) {
			if (_rollMeta.attack) this._page._rollHistory.addRoll({title: `Spell Attack: ${spell.name}`, total: _rollMeta.attack.total, breakdown: _rollMeta.attack.breakdown});
			if (_rollMeta.dc) this._page._rollHistory.addRoll({title: `Spell Save DC: ${spell.name}`, total: _rollMeta.dc.total, breakdown: _rollMeta.dc.breakdown});
			if (damageResult?.total != null) this._page._rollHistory.addRoll({title: `Spell Damage: ${spell.name}`, total: damageResult.total, breakdown: `${damageResult.dice} ${damageResult.damageType || ""}`});
			if (damageInfo && !damageResult && damageInfo.includes("Healing")) {
				const healMatch = damageInfo.match(/<strong>(\d+)<\/strong>/);
				if (healMatch) this._page._rollHistory.addRoll({title: `Spell Healing: ${spell.name}`, total: parseInt(healMatch[1]), breakdown: damageInfo.replace(/<[^>]*>/g, "").replace(/^\s*Healing:\s*/, "").trim()});
			}
			if (gamblerFollyResult) {
				this._page._rollHistory.addRoll({title: `Gambler's Folly: ${spell.name}`, total: gamblerFollyResult.roll, breakdown: `d${gamblerFollyResult.die}: ${gamblerFollyResult.roll} \u2014 ${gamblerFollyResult.won ? "Won" : "Lost"}`});
			}
			if (feywildSurgeResult) {
				this._page._rollHistory.addRoll({title: `Feywild Shard — Wild Magic Surge: ${spell.name}`, total: feywildSurgeResult.roll, breakdown: `d100: ${feywildSurgeResult.roll} \u2014 ${feywildSurgeResult.effect}`});
			}
		}

		const toastEl = e_({tag: "span", html: toastContent});

		// Attach direct click handler for Gambling Table button (stopPropagation prevents toast close)
		const gamblerBtn = toastEl.querySelector(".btn-open-gambling-table");
		if (gamblerBtn) {
			gamblerBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this._openGamblingTableModal();
			});
		}

		// Wire the non-blocking "apply to self" button — rolls/applies the payload ONCE.
		const applyToSelfBtn = toastEl.querySelector(".btn-apply-to-self");
		if (applyToSelfBtn && offerApplyToSelf) {
			// Replace any still-visible apply-to-self toast from a previous cast so rapid casts
			// don't pile up a stack of competing "Apply to Self" prompts (the latest cast wins).
			this._replacePriorApplyToSelfToast(toastEl);
			applyToSelfBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				if (applyToSelfBtn.disabled) return;
				applyToSelfBtn.disabled = true;
				const applied = await this._applySpellEffectsToSelf(
					offerApplyToSelf.spell,
					offerApplyToSelf.spellData,
					offerApplyToSelf.effects,
					offerApplyToSelf.slotLevel,
				);
				applyToSelfBtn.textContent = applied.length ? "✓ Applied to Self" : "✓ Done";
				this._page._renderActiveStates?.();
				this._page._combat?.renderCombatStates?.();
				this._page._renderHp?.();
				if (applied.length) {
					JqueryUtil.doToast(/** @type {*} */ ({type: "success", content: `✨ Applied to self: ${applied.join(", ")}`}));
				}
			});
		}

		JqueryUtil.doToast(/** @type {*} */ ({
			type: "success",
			content: toastEl,
			...(hasGamblerFolly || offerApplyToSelf ? {autoHideTime: 12000} : {}),
		}));

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
	 * @returns {Promise<*>} - HTML/details object to append to toast, or null if not applicable
	 */
	async _handleGamblerFolly (spell, slotLevel) {
		const calcs = this._state.getFeatureCalculations?.();
		if (!calcs?.hasGamblerFolly) return null;

		// Only trigger on leveled spells (cantrips don't trigger)
		if (!spell.level || spell.level === 0) return null;

		const result = this._state.rollGamblerBet(slotLevel);
		if (!result) return null;

		let html = `<br><hr class="hr-1"><span class="text-warning">\u{1F3B2} <b>Gambler's Folly:</b></span>`;
		html += `<br>Bet Roll: <b>${result.roll}</b> on d${result.die}`;

		if (result.won) {
			html += ` \u2014 <span class="text-success"><b>Won!</b> \u2713</span>`;
		} else {
			html += ` \u2014 <span class="text-danger"><b>Lost!</b> Roll d100 on Gambling Table</span>`;

			// Check if auto-roll is enabled
			const autoRoll = this._state.getGamblerAutoRollTable?.();
			if (autoRoll) {
				const tableResult = this._state.rollGamblingTable();
				if (tableResult) {
					html += `<br><span class="text-info">\u{1F3B0} <b>d100:</b> ${tableResult.roll}</span>`;
					html += `<br>${tableResult.effect}`;
				}
			} else {
				// Button opens gambling table modal — handler attached after element creation (not inline)
				html += `<br><button class="btn btn-xs btn-outline-info mt-1 btn-open-gambling-table" style="font-weight: 600;">\u{1F3B0} Open Gambling Table</button>`;
			}
		}

		return {html, roll: result.roll, die: result.die, won: result.won};
	}

	/**
	 * Open the Gambling Table modal for manual d100 rolls or reference
	 * Used by Gambler's Folly, Extra Luck, Master of Fortune (TGTT)
	 */
	async _openGamblingTableModal () {
		const table = CharacterSheetState.GAMBLER_GAMBLING_TABLE;
		if (!table || !table.length) return;

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "\u{1F3B0} Gambling Table",
			isMinHeight0: true,
			isWidth100: true,
		});

		// Roll button and result display
		const rollSection = e_({outer: `
			<div class="ve-flex-v-center mb-3 p-2" style="gap: 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px;">
				<button class="btn btn-sm btn-warning btn-gambler-modal-roll" style="font-weight: 600; min-width: 120px;">\u{1F3B2} Roll d100</button>
				<div class="gambler-roll-result" style="font-size: 1.05em; line-height: 1.4;"></div>
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
				let resultHtml = `<span style="font-size: 1.3em; font-weight: 700; color: var(--rgb-name--accent);">d100: ${result.roll}</span>`;
				if (hasMasterOfFortune && result.secondRoll) {
					resultHtml += ` <span style="font-size: 1.1em;">/ ${result.secondRoll}</span>`;
					resultHtml += `<br><span class="text-info ve-small">\u{1F3B2} Master of Fortune: Choose which result to use</span>`;
				}
				resultHtml += `<br><span class="text-warning" style="font-style: italic;">${result.effect}</span>`;
				resultDisplay.innerHTML = resultHtml;

				// Highlight the result row in the table and scroll to it
				tableBody.querySelectorAll("tr.table-warning").forEach(el => { el.classList.remove("table-warning"); el.style.removeProperty("background"); });
				const matchRow = tableBody.querySelector(`tr[data-roll="${result.roll}"]`);
				if (matchRow) {
					matchRow.classList.add("table-warning");
					matchRow.style.background = "rgba(245, 158, 11, 0.2)";
					matchRow.scrollIntoView({behavior: "smooth", block: "center"});
				}
			}
		});

		// Last roll display
		const lastRoll = this._state.getGamblerLastTableRoll?.();
		if (lastRoll) {
			resultDisplay.innerHTML = `<span class="text-muted">Last roll: ${lastRoll.roll} \u2014 ${lastRoll.effect}</span>`;
		}

		// Search filter
		const searchRow = e_({outer: `
			<div class="mb-2">
				<input type="text" class="ve-form-control ve-input-sm" placeholder="Filter table..." style="max-width: 300px;">
			</div>
		`});
		modalInner.append(searchRow);

		const searchInput = searchRow.querySelector("input");

		// Table
		const tableContainer = e_({outer: `
			<div style="max-height: 450px; overflow-y: auto; border: 1px solid var(--rgb-border-grey); border-radius: 6px;">
				<table class="table table-striped table-hover table-sm mb-0" style="font-size: 0.85em; line-height: 1.4;">
					<thead style="position: sticky; top: 0; background: var(--rgb-bg); z-index: 1; border-bottom: 2px solid var(--rgb-border-grey);">
						<tr>
							<th class="text-center" style="width: 55px; padding: 6px 4px; font-weight: 700;">d100</th>
							<th style="padding: 6px 8px; font-weight: 700;">Effect</th>
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
				const row = e_({outer: `<tr data-roll="${roll}" style="cursor: default;"><td class="text-center" style="padding: 4px; vertical-align: top; color: var(--rgb-name--accent); font-weight: 600;">${roll}</td><td style="padding: 4px 8px;">${effect}</td></tr>`});
				tableBody.append(row);
			});
		};

		renderTable();

		searchInput.addEventListener("input", (/** @type {*} */ e) => {
			renderTable(e.target.value);
		});

		// Auto-roll setting toggle
		const autoRollEnabled = this._state.getGamblerAutoRollTable?.();
		const settingRow = e_({outer: `
			<div class="mt-3 p-2" style="font-size: 0.85em; border-top: 1px solid var(--rgb-border-grey);">
				<label class="ve-flex-v-center" style="gap: 6px; cursor: pointer;">
					<input type="checkbox" ${autoRollEnabled ? "checked" : ""}>
					<span class="ve-muted">Auto-roll d100 when bet is lost (shows result in spell cast toast)</span>
				</label>
			</div>
		`});
		modalInner.append(settingRow);

		settingRow.querySelector("input").addEventListener("change", (/** @type {*} */ e) => {
			this._state.setGamblerAutoRollTable?.(e.target.checked);
		});
	}

	/**
	 * Handle special triggers for specific spells like Find Familiar
	 */
	async _handleSpecialSpellTriggers (spell) {
		const spellNameLower = spell.name.toLowerCase();

		// Find Familiar - show familiar picker (with Pact of the Chain expansion if applicable)
		if (spellNameLower === "find familiar") {
			const calculations = this._state?.getFeatureCalculations?.() || {};
			await this._pShowFamiliarPicker(/** @type {*} */ ({
				pactCreatureNames: calculations.pactOfTheChainCreatures || [],
			}));
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
		} else if (spell.name.toLowerCase() === "conjure celestial") {
			// Conjure Celestial: CR 4 at 7th, CR 5 at 9th
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
			zIndex: 100,
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
		const search = e_({outer: `<input type="text" class="ve-form-control" placeholder="Search creatures..." style="flex: 1;">`});
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

				// Get icon for this creature (token image with emoji fallback)
				const creatureIconHtml = CharacterSheetClassUtils.getCompanionIconHtml(creature, "lg");

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
							${creatureIconHtml}
							<div class="ve-flex-col" style="flex: 1;">
								<div class="bold" style="font-size: 1.05em;">${nameDisplay}</div>
								<span class="ve-muted ve-small">CR ${crDisplay} · ${Parser.sourceJsonToAbv(creature.source)}</span>
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
	 * Get emoji for a creature based on its type/name.
	 * Delegates to the centralized utility in CharacterSheetClassUtils.
	 */
	_getCreatureEmoji (creature) {
		const type = typeof creature.type === "string" ? creature.type : creature.type?.type;
		return CharacterSheetClassUtils.getCreatureEmoji(creature.name, type);
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
	 * @param {*} [opts] - Options
	 *   - `isWildCompanion` (boolean): If true, familiar is summoned as Fey (Wild Companion)
	 *   - `pactCreatureNames` (string[]): Additional creature names from Pact of the Chain
	 */
	async _pShowFamiliarPicker (opts = {}) {
		const {isWildCompanion = false, pactCreatureNames = []} = opts;

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

		// Pact of the Chain — additional creatures (any type/CR/size)
		const pactCreatureNamesLower = new Set(pactCreatureNames.map(n => n.toLowerCase()));
		const pactFamiliars = pactCreatureNamesLower.size > 0
			? bestiaryData.filter(creature => pactCreatureNamesLower.has(creature.name.toLowerCase()))
			: [];
		pactFamiliars.sort((a, b) => a.name.localeCompare(b.name));

		// Sort alphabetically
		familiars.sort((a, b) => a.name.localeCompare(b.name));

		// Check for Animal Accomplice improved familiar info
		const calculations = this._state?.getFeatureCalculations?.() || {};

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
			zIndex: 100,
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
		const search = e_({outer: `<input type="text" class="ve-form-control" placeholder="Search familiars..." style="flex: 1;">`});
		searchContainer.append(search);

		// Animal Accomplice improved familiar banner
		if (calculations.hasImprovedFamiliar) {
			modalInner.insertAdjacentHTML("beforeend", `
				<div style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;">
					<div class="ve-flex ve-flex-v-center" style="gap: 8px;">
						<span style="font-size: 1.3em;">✨</span>
						<div>
							<div class="bold ve-small">Improved Familiar</div>
							<div class="ve-muted ve-small">Your familiar gains enhanced stats: HP = ${calculations.familiarMaxHp}, INT = ${calculations.familiarIntelligence}, Prof Bonus = +${calculations.familiarProfBonus}</div>
						</div>
					</div>
				</div>
			`);
		}

		// Custom familiar form (hidden initially)
		const customFormWrap = e_({outer: `<div style="display: none;"></div>`});
		modalInner.append(customFormWrap);

		const SKILL_LIST = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
			"History", "Insight", "Intimidation", "Investigation", "Medicine",
			"Nature", "Perception", "Performance", "Persuasion", "Religion",
			"Sleight of Hand", "Stealth", "Survival",
		];

		customFormWrap.innerHTML = `
			<div style="margin-bottom: 12px;">
				<button class="ve-btn ve-btn-xs ve-btn-default btn-back-to-list" style="gap: 4px;">← Back to list</button>
			</div>
			<div style="display: flex; flex-direction: column; gap: 14px;">
				<!-- Template selector -->
				<div style="background: rgba(var(--rgb-bg-text), 0.04); border-radius: 8px; padding: 10px 12px;">
					<label class="ve-small ve-muted mb-1" style="display: block;">Base on existing creature (optional)</label>
					<div class="ve-flex ve-flex-v-center" style="gap: 8px;">
						<select class="ve-form-control custom-fam-template" style="flex: 1;">
							<option value="">— Start from scratch —</option>
							${familiars.map(f => `<option value="${f.name}|${f.source}">${f.name} (${Parser.sourceJsonToAbv(f.source)})</option>`).join("")}
						</select>
						<button class="ve-btn ve-btn-xs ve-btn-primary btn-apply-template" title="Apply template">Apply</button>
					</div>
				</div>

				<!-- Basic info -->
				<div style="display: flex; gap: 12px; align-items: end;">
					<div style="flex: 2;">
						<label class="ve-small ve-muted">Name *</label>
						<input type="text" class="ve-form-control custom-fam-name" placeholder="e.g. Whiskers, Shadow, Archimedes...">
					</div>
					<div style="flex: 1;">
						<label class="ve-small ve-muted">Creature Type</label>
						<select class="ve-form-control custom-fam-type">
							<option value="beast">Beast</option>
							<option value="celestial">Celestial</option>
							<option value="fey">Fey</option>
							<option value="fiend">Fiend</option>
						</select>
					</div>
				</div>

				<!-- Combat stats -->
				<div>
					<div class="ve-small bold ve-muted mb-1">Combat Stats</div>
					<div style="display: flex; gap: 12px;">
						<div style="flex: 1;">
							<label class="ve-small ve-muted">HP</label>
							<input type="number" class="ve-form-control custom-fam-hp" value="1" min="1">
						</div>
						<div style="flex: 1;">
							<label class="ve-small ve-muted">AC</label>
							<input type="number" class="ve-form-control custom-fam-ac" value="10" min="1">
						</div>
						<div style="flex: 1;">
							<label class="ve-small ve-muted">Walk (ft)</label>
							<input type="number" class="ve-form-control custom-fam-speed" value="30" min="0" step="5">
						</div>
						<div style="flex: 1;">
							<label class="ve-small ve-muted">Fly (ft)</label>
							<input type="number" class="ve-form-control custom-fam-fly" value="0" min="0" step="5">
						</div>
						<div style="flex: 1;">
							<label class="ve-small ve-muted">Swim (ft)</label>
							<input type="number" class="ve-form-control custom-fam-swim" value="0" min="0" step="5">
						</div>
					</div>
				</div>

				<!-- Advanced stats (collapsible) -->
				<details class="custom-fam-advanced">
					<summary class="ve-small bold ve-muted" style="cursor: pointer; user-select: none; padding: 4px 0;">
						▶ Advanced Stats (Ability Scores & Skills)
					</summary>
					<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
						<!-- Ability Scores -->
						<div>
							<div class="ve-small ve-muted mb-1">Ability Scores</div>
							<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">
								${Parser.ABIL_ABVS.map(abv => `
									<div class="ve-flex-col ve-text-center">
										<label class="ve-small bold" style="text-transform: uppercase;">${abv}</label>
										<input type="number" class="ve-form-control custom-fam-abil-${abv}" value="10" min="1" max="30" style="text-align: center;">
									</div>
								`).join("")}
							</div>
						</div>

						<!-- Skill Proficiencies -->
						<div>
							<div class="ve-small ve-muted mb-1">Skill Proficiencies <span class="ve-muted">(check to grant proficiency)</span></div>
							<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 12px; font-size: 0.9em;">
								${SKILL_LIST.map(skill => {
		const key = skill.toLowerCase().replace(/\s+/g, "");
		return `<label class="ve-flex ve-flex-v-center" style="gap: 6px; cursor: pointer;">
										<input type="checkbox" class="custom-fam-skill" data-skill="${key}">
										<span>${skill}</span>
									</label>`;
	}).join("")}
							</div>
						</div>
					</div>
				</details>

				<div class="ve-flex-h-right" style="gap: 8px; margin-top: 4px;">
					<button class="ve-btn ve-btn-default btn-custom-fam-cancel">Cancel</button>
					<button class="ve-btn ve-btn-primary btn-custom-fam-create">
						🐾 Summon Custom Familiar
					</button>
				</div>
			</div>
		`;

		// Familiars grid
		const list = e_({outer: `<div class="charsheet__familiar-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; max-height: 450px; overflow-y: auto; padding: 4px;"></div>`});
		modalInner.append(list);

		// --- Helper: populate form from a bestiary creature ---
		const populateFormFromCreature = (creature) => {
			const form = customFormWrap;
			form.querySelector(".custom-fam-name").value = creature.name || "";

			// HP
			const hp = creature.hp?.average || (typeof creature.hp === "number" ? creature.hp : 1);
			form.querySelector(".custom-fam-hp").value = hp;

			// AC
			const ac = Array.isArray(creature.ac) ? (creature.ac[0]?.ac ?? creature.ac[0]) : (creature.ac || 10);
			form.querySelector(".custom-fam-ac").value = ac;

			// Speeds
			const spd = creature.speed || {};
			form.querySelector(".custom-fam-speed").value = (typeof spd === "number" ? spd : spd.walk) || 0;
			form.querySelector(".custom-fam-fly").value = spd.fly || 0;
			form.querySelector(".custom-fam-swim").value = spd.swim || 0;

			// Creature type
			const cType = typeof creature.type === "string" ? creature.type : creature.type?.type || "beast";
			const typeSelect = form.querySelector(".custom-fam-type");
			if ([...typeSelect.options].some(o => o.value === cType)) typeSelect.value = cType;

			// Ability scores
			for (const abv of Parser.ABIL_ABVS) {
				form.querySelector(`.custom-fam-abil-${abv}`).value = creature[abv] || 10;
			}

			// Skill proficiencies
			form.querySelectorAll(".custom-fam-skill").forEach(cb => { cb.checked = false; });
			if (creature.skill) {
				for (const skill of Object.keys(creature.skill)) {
					const key = skill.toLowerCase().replace(/\s+/g, "");
					const cb = form.querySelector(`.custom-fam-skill[data-skill="${key}"]`);
					if (cb) cb.checked = true;
				}
			}

			// Auto-open advanced section if creature has non-default abilities or skills
			const hasNonDefaultAbilities = Parser.ABIL_ABVS.some(abv => (creature[abv] || 10) !== 10);
			const hasSkills = creature.skill && Object.keys(creature.skill).length > 0;
			if (hasNonDefaultAbilities || hasSkills) {
				form.querySelector(".custom-fam-advanced").open = true;
			}
		};

		// Wire up template selector
		customFormWrap.querySelector(".btn-apply-template").addEventListener("click", () => {
			const val = customFormWrap.querySelector(".custom-fam-template").value;
			if (!val) {
				// Reset to defaults
				customFormWrap.querySelector(".custom-fam-name").value = "";
				customFormWrap.querySelector(".custom-fam-hp").value = "1";
				customFormWrap.querySelector(".custom-fam-ac").value = "10";
				customFormWrap.querySelector(".custom-fam-speed").value = "30";
				customFormWrap.querySelector(".custom-fam-fly").value = "0";
				customFormWrap.querySelector(".custom-fam-swim").value = "0";
				customFormWrap.querySelector(".custom-fam-type").value = "beast";
				for (const abv of Parser.ABIL_ABVS) customFormWrap.querySelector(`.custom-fam-abil-${abv}`).value = "10";
				customFormWrap.querySelectorAll(".custom-fam-skill").forEach(cb => { cb.checked = false; });
				return;
			}
			const [name, source] = val.split("|");
			const creature = familiars.find(f => f.name === name && f.source === source);
			if (creature) populateFormFromCreature(creature);
		});

		// Wire up custom form toggle
		const showCustomForm = (templateCreature) => {
			customFormWrap.style.display = "";
			searchContainer.style.display = "none";
			list.style.display = "none";
			if (templateCreature) populateFormFromCreature(templateCreature);
			customFormWrap.querySelector(".custom-fam-name").focus();
		};
		const hideCustomForm = () => {
			customFormWrap.style.display = "none";
			searchContainer.style.display = "";
			list.style.display = "";
		};

		customFormWrap.querySelector(".btn-back-to-list").addEventListener("click", hideCustomForm);
		customFormWrap.querySelector(".btn-custom-fam-cancel").addEventListener("click", doClose);
		customFormWrap.querySelector(".btn-custom-fam-create").addEventListener("click", async () => {
			const name = customFormWrap.querySelector(".custom-fam-name").value?.trim();
			if (!name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter a name for your familiar."});
				return;
			}
			const hp = parseInt(customFormWrap.querySelector(".custom-fam-hp").value) || 1;
			const ac = parseInt(customFormWrap.querySelector(".custom-fam-ac").value) || 10;
			const walkSpeed = parseInt(customFormWrap.querySelector(".custom-fam-speed").value) || 0;
			const flySpeed = parseInt(customFormWrap.querySelector(".custom-fam-fly").value) || 0;
			const swimSpeed = parseInt(customFormWrap.querySelector(".custom-fam-swim").value) || 0;
			const creatureType = customFormWrap.querySelector(".custom-fam-type").value || "beast";

			// Ability scores
			const abilities = {};
			for (const abv of Parser.ABIL_ABVS) {
				abilities[abv] = parseInt(customFormWrap.querySelector(`.custom-fam-abil-${abv}`).value) || 10;
			}

			// Skill proficiencies
			const skillProficiencies = {};
			customFormWrap.querySelectorAll(".custom-fam-skill:checked").forEach(cb => {
				skillProficiencies[cb.dataset.skill] = 1;
			});

			await this._selectFamiliar(
				{name, isCustom: true, hp, ac, speed: {walk: walkSpeed, fly: flySpeed, swim: swimSpeed}, creatureType, abilities, skillProficiencies},
				{isWildCompanion},
			);
			doClose();
		});

		const renderList = (filter = "") => {
			list.innerHTML = "";

			// "Create Custom" card at the top
			const customCard = e_({outer: `
				<div class="charsheet__familiar-card" style="
					border: 2px dashed var(--rgb-border-grey-muted);
					border-radius: 10px;
					padding: 12px;
					cursor: pointer;
					transition: all 0.2s ease;
					background: rgba(var(--rgb-bg-text), 0.02);
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: center;
					min-height: 100px;
					gap: 8px;
				">
					<span style="font-size: 2em; opacity: 0.6;">➕</span>
					<div class="bold" style="font-size: 0.95em; opacity: 0.8;">Create Custom Familiar</div>
					<div class="ve-muted ve-small ve-text-center">Define your own familiar with custom stats</div>
				</div>
			`});
			list.append(customCard);
			customCard.addEventListener("click", () => showCustomForm());
			customCard.addEventListener("mouseenter", function () {
				Object.assign(this.style, {
					borderColor: "var(--rgb-link)",
					background: "rgba(var(--rgb-link-rgb), 0.08)",
					transform: "translateY(-2px)",
					boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
				});
			});
			customCard.addEventListener("mouseleave", function () {
				Object.assign(this.style, {
					borderColor: "var(--rgb-border-grey-muted)",
					background: "rgba(var(--rgb-bg-text), 0.02)",
					transform: "translateY(0)",
					boxShadow: "none",
				});
			});

			const filteredFamiliars = familiars.filter(f =>
				f.name.toLowerCase().includes(filter.toLowerCase()),
			);

			// Pact of the Chain creatures
			const filteredPactFamiliars = pactFamiliars.filter(f =>
				f.name.toLowerCase().includes(filter.toLowerCase()),
			);

			if (filteredFamiliars.length === 0 && filteredPactFamiliars.length === 0) {
				list.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-text-center py-3" style="grid-column: 1 / -1;">No familiars match your search</div>`);
				return;
			}

			// Helper: build a creature card element
			const buildCreatureCard = (creature) => {
				const hp = creature.hp?.average || creature.hp || "?";
				const ac = Array.isArray(creature.ac) ? creature.ac[0]?.ac || creature.ac[0] : creature.ac;
				const speeds = this._formatCreatureSpeeds(creature.speed);
				const creatureIconHtml = CharacterSheetClassUtils.getCompanionIconHtml(creature, "lg");
				const primarySense = creature.senses?.[0] || "Normal vision";
				const crStr = creature.cr?.cr ?? creature.cr ?? "?";
				const creatureTypeStr = typeof creature.type === "string" ? creature.type : creature.type?.type || "beast";

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
							${creatureIconHtml}
							<div class="ve-flex-col" style="flex: 1;">
								<div class="bold" style="font-size: 1.05em;">${nameDisplay}</div>
								<span class="ve-muted ve-small">${Parser.sourceJsonToAbv(creature.source)} · CR ${crStr} · ${creatureTypeStr}</span>
							</div>
						</div>
						<div class="charsheet__familiar-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 0.85em;">
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">\ud83d\udee1\ufe0f</span>
								<span>AC ${ac}</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px;">
								<span style="opacity: 0.7;">\u2764\ufe0f</span>
								<span>${hp} HP</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px; grid-column: 1 / -1;">
								<span style="opacity: 0.7;">\ud83d\udc5f</span>
								<span class="ve-small">${speeds}</span>
							</div>
							<div class="ve-flex ve-flex-v-center" style="gap: 4px; grid-column: 1 / -1;">
								<span style="opacity: 0.7;">\ud83d\udc41\ufe0f</span>
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

				card.addEventListener("click", async (evt) => {
					if (evt.target.closest("a")?.length) return;
					await this._selectFamiliar(creature, {isWildCompanion});
					doClose();
				});

				return card;
			};

			// Render standard familiars
			filteredFamiliars.forEach(creature => list.append(buildCreatureCard(creature)));

			// Render Pact of the Chain section
			if (filteredPactFamiliars.length > 0) {
				list.insertAdjacentHTML("beforeend", `
					<div style="grid-column: 1 / -1; border-top: 1px solid var(--rgb-border-grey-muted); margin: 8px 0; padding-top: 8px;">
						<div class="ve-flex ve-flex-v-center" style="gap: 6px;">
							<span style="font-size: 1.1em;">\ud83d\udd17</span>
							<span class="bold ve-small" style="text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">Pact of the Chain</span>
						</div>
					</div>
				`);
				filteredPactFamiliars.forEach(creature => list.append(buildCreatureCard(creature)));
			}
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
	 * Select a familiar and add it to companions.
	 * Accepts a bestiary creature object, or a custom familiar object with `isCustom: true`.
	 * @param {Object} creature - The bestiary creature data, or custom familiar data
	 * @param {*} [opts] - Options
	 *   - `isWildCompanion` (boolean): If true, familiar is summoned as Fey (Wild Companion)
	 */
	async _selectFamiliar (creature, opts = {}) {
		const {isWildCompanion = false} = opts;

		// Remove any existing familiars first (you can only have one)
		const existingFamiliars = this._state.getCompanionsByType?.(CharacterSheetState.COMPANION_TYPES.FAMILIAR) || [];
		existingFamiliars.forEach(f => this._state.removeCompanion?.(f.id));

		// Determine origin and creature type
		const calculations = this._state?.getFeatureCalculations?.() || {};
		const isPactCreature = calculations.hasPactOfTheChain && calculations.pactOfTheChainCreatures?.some(
			n => n.toLowerCase() === creature.name?.toLowerCase(),
		);
		let origin;
		if (isWildCompanion) origin = "Wild Companion";
		else if (isPactCreature) origin = "Pact of the Chain";
		else origin = "Find Familiar";
		const creatureType = isWildCompanion ? "fey" : (creature.creatureType || "beast");

		let companionId;
		if (creature.isCustom) {
			// Custom familiar — use addCompanion directly
			const speed = creature.speed && typeof creature.speed === "object"
				? creature.speed
				: {walk: creature.speed || 30};
			const abilities = creature.abilities || {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
			companionId = this._state.addCompanion?.({
				name: creature.name,
				type: CharacterSheetState.COMPANION_TYPES.FAMILIAR,
				origin: `${origin} (Custom)`,
				creatureType,
				ac: creature.ac,
				hp: {max: creature.hp, current: creature.hp},
				speed,
				abilities,
				skillProficiencies: creature.skillProficiencies || {},
			});
		} else {
			// Bestiary creature — use addCompanionFromBestiary
			companionId = this._state.addCompanionFromBestiary?.(
				creature,
				CharacterSheetState.COMPANION_TYPES.FAMILIAR,
				origin,
				{creatureTypeOverride: creatureType},
			);
		}

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
	/**
	 * Decide how a beneficial spell's self-targeting is handled post-cast (pure — no
	 * rolling or side effects):
	 *  - "offer": non-self-only beneficial spell → show the opt-in "Apply to Self" toast button.
	 *  - "auto":  self-only spell → apply to self automatically.
	 *  - "none":  neither (damage / enemy-targeted / no beneficial payload).
	 * @returns {"offer"|"auto"|"none"}
	 */
	static resolveSelfTargetingMode (targetInfo, effects) {
		const hasBeneficial = !!(
			effects?.healing
			|| effects?.buffs?.length > 0
			|| effects?.tempHp
			|| effects?.conditions?.length > 0
			|| effects?.registryEffects?.length > 0
		);
		if (!targetInfo?.selfOnly && hasBeneficial) return "offer";
		if (targetInfo?.selfOnly) return "auto";
		return "none";
	}

	/**
	 * Replace any still-visible "Apply to Self" toast from a previous cast with the newly
	 * created one, so rapid back-to-back casts don't stack competing opt-in prompts. Removes
	 * the prior toast's `.toast` ancestor (if still in the DOM) and tracks the new node.
	 * Self-contained and DOM-light so it can be unit-tested with fake elements.
	 */
	_replacePriorApplyToSelfToast (newToastEl) {
		const prior = this._activeApplyToSelfToastEl;
		if (prior && prior !== newToastEl) {
			const priorToast = prior.closest?.(".toast");
			if (priorToast) priorToast.remove();
		}
		this._activeApplyToSelfToastEl = newToastEl || null;
	}

	/**
	 * Build a compact, informational summary of a beneficial spell's effects for the
	 * result toast — WITHOUT rolling any dice (the apply-to-self button rolls once on
	 * click, so the applied amount always matches what is then shown).
	 * @returns {string}
	 */
	_describeBeneficialEffects (effects) {
		const parts = [];
		if (effects.healing) {
			const healDice = effects.healing.dice || "healing";
			parts.push(`Heal ${healDice}${effects.healing.addModifier ? " + mod" : ""}`);
		}
		if (effects.tempHp) parts.push(`+${effects.tempHp.amount} temp HP`);
		if (effects.buffs?.length) {
			for (const buff of effects.buffs) {
				if (buff.target === "ac") parts.push(`+${buff.value} AC`);
				else if (buff.type === "rollBonus") parts.push(`+${buff.dice} to rolls`);
			}
		}
		if (effects.conditions?.length) {
			parts.push(effects.conditions.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", "));
		}
		const concentration = effects.concentration ? ` <span class="text-warning">⚠ Concentration</span>` : "";
		if (!parts.length) return `<br><span class="ve-muted">Beneficial spell — apply to yourself or another creature.</span>${concentration}`;
		return `<br><span class="ve-muted">Effects: ${parts.join(", ")}</span>${concentration}`;
	}

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
		const castingAbility = this._state.getSpellcastingAbilityForSpell?.(spell) || this._state.getSpellcastingAbility() || "int";
		const spellcastingMod = this._state.getAbilityMod(castingAbility);

		// Apply healing
		if (effects.healing) {
			const healingResult = CharacterSheetState.calculateSpellHealing(spellData, slotLevel || spell.level, this._state, castingAbility);
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
		} else if ((effects.buffs?.length > 0 || effects.registryEffects?.length > 0 || effects.duration) && conditionsToApply.length === 0) {
			// For buff spells that DON'T grant conditions, apply the parsed buff effects
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

	/**
	 * @returns {*}
	 */
	/**
	 * Roll a dice expression (e.g. "8d6", "1d4 + 1", "2d10 - 1") returning both
	 * the total and the per-die values grouped by die size — so the dice
	 * animation can show the ACTUAL dice rolled rather than a single d20.
	 *
	 * @param {string} diceStr
	 * @param {object} [opts]
	 * @param {boolean} [opts.maximize] - Treat every die as its max face (e.g. Overcharged).
	 * @param {number} [opts.diceMultiplier] - Repeat the dice term N times (e.g. Magic
	 *   Missile's dart count). The flat modifier is also multiplied (per-dart bonus).
	 * @returns {{total:number, groups:Array<{sides:number, values:number[]}>, modifier:number}}
	 */
	_rollDamageDiceDetailed (diceStr, {maximize = false, diceMultiplier = 1} = {}) {
		const groups = [];
		const m = String(diceStr || "").match(/(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?/i);
		if (!m) {
			let total = 0;
			try { total = Renderer.dice.parseRandomise2(diceStr) || 0; } catch (e) { total = 0; }
			return {total, groups, modifier: 0};
		}
		const mult = Math.max(1, Number(diceMultiplier) || 1);
		const numDice = parseInt(m[1], 10) * mult;
		const sides = parseInt(m[2], 10);
		const perTermMod = m[4] ? parseInt(m[4], 10) * (m[3] === "-" ? -1 : 1) : 0;
		const modifier = perTermMod * mult;

		const values = [];
		let diceTotal = 0;
		for (let i = 0; i < numDice; ++i) {
			const r = maximize ? sides : (this._page.rollDice?.(1, sides) ?? (Math.floor(Math.random() * sides) + 1));
			values.push(r);
			diceTotal += r;
		}
		if (values.length) groups.push({sides, values});
		return {total: diceTotal + modifier, groups, modifier};
	}

	/**
	 * Detect "projectile" spells (Magic Missile and homebrew clones) that fire a
	 * fixed number of auto-hitting darts/missiles, each dealing the SAME dice,
	 * with one extra projectile per slot level above the base level. Returns the
	 * resolved projectile count and per-projectile dice, or null for normal spells.
	 *
	 * @param {object} spellData
	 * @param {string} baseDice - The `{@damage …}` expression for a single projectile.
	 * @param {number} slotLevel
	 * @param {number} baseLevel
	 * @returns {{count:number, perDartDice:string}|null}
	 */
	_getProjectileSpellInfo (spellData, baseDice, slotLevel, baseLevel) {
		const entries = JSON.stringify(spellData?.entries || []);
		// Must describe darts/missiles/projectiles to qualify (keeps this generic
		// without misfiring on ray/beam spells that need attack rolls).
		const projMatch = entries.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.]{0,40}?\b(darts?|missiles?|projectiles?)\b/i);
		if (!projMatch) return null;

		const WORD_TO_NUM = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10};
		const raw = projMatch[1].toLowerCase();
		const baseCount = WORD_TO_NUM[raw] || parseInt(raw, 10);
		if (!Number.isFinite(baseCount) || baseCount < 1) return null;

		// Confirm the spell adds projectiles when upcast (e.g. "one more dart for
		// each slot level above 1st"). If not, treat the base count as fixed.
		const higher = JSON.stringify(spellData?.entriesHigherLevel || []);
		const scalesPerLevel = /more\s+(?:darts?|missiles?|projectiles?)/i.test(higher)
			|| /(?:darts?|missiles?|projectiles?)[^.]{0,40}?(?:each|per)\s+slot\s+level/i.test(higher);

		const levelsAbove = (Number.isFinite(slotLevel) && Number.isFinite(baseLevel) && slotLevel > baseLevel)
			? slotLevel - baseLevel
			: 0;
		const count = baseCount + (scalesPerLevel ? levelsAbove : 0);
		return {count, perDartDice: baseDice};
	}

	_rollSpellDamage (spellData, slotLevel, baseLevel, appliedMetamagic = null, spell = null) {
		// Weapon-channel cantrips (Booming/Green-Flame Blade) cast on their own roll ONLY
		// the secondary/movement damage; the on-hit damage rides the weapon attack instead.
		const channel = this.getWeaponChannelCantripForCharacter(spell, spellData);
		if (channel) return this._rollWeaponChannelSecondary(spellData, channel, appliedMetamagic);

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

		// Magic Missile & projectile clones: N auto-hitting darts, each dealing
		// the same dice (e.g. 3 × (1d4 + 1) at L1, +1 dart per slot level above base).
		const projectile = this._getProjectileSpellInfo(spellData, baseDice, slotLevel, baseLevel);

		// Roll the damage
		try {
			const isOvercharged = appliedMetamagic?.key === "overcharged";
			const detail = this._rollDamageDiceDetailed(baseDice, {
				maximize: isOvercharged,
				diceMultiplier: projectile ? projectile.count : 1,
			});
			const spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
			const total = detail.total + spellDamageBonus;
			const damageType = damageTypes[0] || "damage";
			const bonusStr = spellDamageBonus ? ` + ${spellDamageBonus} item` : "";
			const metamagicLabel = isOvercharged ? " maximized" : "";
			const diceLabel = projectile ? `${projectile.count}× ${baseDice}` : baseDice;

			// Animate the actual dice that were rolled.
			void this._page.pAnimateDamageDice?.(detail.groups);

			return {
				text: `<br>Damage: <strong>${total}</strong> ${damageType} (${diceLabel}${bonusStr}${metamagicLabel})`,
				total,
				dice: diceLabel,
				damageType,
			};
		} catch (e) {
			return null;
		}
	}

	/**
	 * @returns {*}
	 */
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
			const detail = this._rollDamageDiceDetailed(dice, {maximize: isOvercharged});
			const spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
			const total = detail.total + spellDamageBonus;
			const damageTypes = spellData.damageInflict || [];
			const damageType = damageTypes[0] || "damage";
			const bonusStr = spellDamageBonus ? ` + ${spellDamageBonus} item` : "";
			const metamagicLabel = isOvercharged ? " maximized" : "";

			// Animate the actual dice that were rolled.
			void this._page.pAnimateDamageDice?.(detail.groups);

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

	/* -------------------------------------------------------------------------- */
	/* Weapon-channel cantrips (Booming Blade / Green-Flame Blade)                 */
	/* -------------------------------------------------------------------------- */

	/**
	 * Detect a "weapon-channel" cantrip — one you cast by making a melee weapon attack
	 * that carries the spell (Booming Blade, Green-Flame Blade, SCAG/homebrew clones).
	 *
	 * The split is data-driven from `scalingLevelDice` labels so it generalises beyond
	 * the two PHB/TCE cantrips:
	 *   - the component whose label reads "…on hit" rides the weapon's *damage* roll
	 *     (the on-hit extra damage; absent below level 5, so 0 at low levels), and
	 *   - the remaining component is the secondary / movement damage that is rolled when
	 *     the spell is "cast" on its own (Booming Blade's move trigger, Green-Flame's
	 *     splash to a second creature).
	 *
	 * @param {object} spellData Full spell data (NOT the lightweight character spell).
	 * @returns {null | {
	 *   onHitScaling: (object|null),
	 *   secondaryScaling: object,
	 *   secondaryLabel: string,
	 *   onHitDamageType: string,
	 *   secondaryDamageType: string,
	 * }}
	 */
	static getWeaponChannelCantripInfo (spellData) {
		if (!spellData) return null;
		if (spellData.level !== 0) return null;
		const scalings = Array.isArray(spellData.scalingLevelDice) ? spellData.scalingLevelDice : null;
		if (!scalings || scalings.length < 2) return null;

		// Must actually be cast via a melee weapon attack ("…make a melee attack with it…").
		const entryText = (spellData.entries || [])
			.filter(e => typeof e === "string")
			.join(" ")
			.toLowerCase();
		if (!/melee attack with it/.test(entryText)) return null;

		const onHitScaling = scalings.find(s => /on\s+(?:a\s+)?hit/i.test(s.label || "")) || null;
		// Secondary = the first component that is NOT the on-hit one.
		const secondaryScaling = scalings.find(s => s !== onHitScaling) || null;
		if (!secondaryScaling?.scaling) return null;

		const damageInflict = spellData.damageInflict || [];
		const typeFromLabel = (label) => {
			const m = String(label || "").match(/\b(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)\b/i);
			return m ? m[1].toLowerCase() : null;
		};

		return {
			onHitScaling,
			secondaryScaling,
			secondaryLabel: secondaryScaling.label || "secondary damage",
			onHitDamageType: typeFromLabel(onHitScaling?.label) || damageInflict[0] || "force",
			secondaryDamageType: typeFromLabel(secondaryScaling.label) || damageInflict[0] || "force",
		};
	}

	/**
	 * Resolve a `scalingLevelDice` scaling map to the dice string for a character level.
	 * Returns `null` when the character is below the lowest keyed level (e.g. the on-hit
	 * component of a blade cantrip is absent before level 5).
	 * @param {object} scalingMap e.g. {"1": "1d8", "5": "2d8"}
	 * @param {number} characterLevel
	 * @returns {string|null}
	 */
	static resolveScalingDiceForLevel (scalingMap, characterLevel) {
		if (!scalingMap) return null;
		const levels = Object.keys(scalingMap).map(Number).sort((a, b) => a - b);
		let dice = null;
		for (const lvl of levels) {
			if (characterLevel >= lvl) dice = scalingMap[lvl];
		}
		return dice;
	}

	/**
	 * Substitute the `{{spellcasting_mod}}` template in a scaling dice string with a number,
	 * collapsing it to a clean dice expression (e.g. "1d8 + {{spellcasting_mod}}" → "1d8 + 3",
	 * bare "{{spellcasting_mod}}" → "3"). Negative/zero mods are handled.
	 * @param {string} diceStr
	 * @param {number} mod
	 * @returns {string}
	 */
	static applySpellcastingModTemplate (diceStr, mod) {
		if (typeof diceStr !== "string") return diceStr;
		if (!diceStr.includes("{{spellcasting_mod}}")) return diceStr;
		// Bare template (e.g. Green-Flame Blade at low levels): just the modifier.
		if (diceStr.trim() === "{{spellcasting_mod}}") return String(mod);
		// "1d8 + {{spellcasting_mod}}" → strip the "+ template" and append a signed mod.
		const base = diceStr.replace(/\s*\+\s*\{\{spellcasting_mod\}\}\s*/g, "").trim();
		if (mod === 0) return base;
		return `${base} ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}`;
	}

	/**
	 * Instance wrapper that resolves a blade cantrip's split for the CURRENT character —
	 * computing concrete dice strings (with `{{spellcasting_mod}}` substituted) for the
	 * on-hit rider and the secondary/movement damage at the character's level.
	 * @param {object} spell Lightweight character spell (for ability routing).
	 * @param {object} spellData Full spell data.
	 * @returns {null | {
	 *   onHitDice: (string|null), onHitDamageType: string,
	 *   secondaryDice: (string|null), secondaryDamageType: string, secondaryLabel: string,
	 * }}
	 */
	getWeaponChannelCantripForCharacter (spell, spellData) {
		const info = CharacterSheetSpells.getWeaponChannelCantripInfo(spellData);
		if (!info) return null;

		const characterLevel = this._state.getTotalLevel();
		const castingAbility = (spell && this._state.getSpellcastingAbilityForSpell?.(spell))
			|| this._state.getSpellcastingAbility()
			|| "int";
		const spellcastingMod = this._state.getAbilityMod(castingAbility);

		const onHitRaw = info.onHitScaling
			? CharacterSheetSpells.resolveScalingDiceForLevel(info.onHitScaling.scaling, characterLevel)
			: null;
		const secondaryRaw = CharacterSheetSpells.resolveScalingDiceForLevel(info.secondaryScaling.scaling, characterLevel);

		return {
			onHitDice: onHitRaw ? CharacterSheetSpells.applySpellcastingModTemplate(onHitRaw, spellcastingMod) : null,
			onHitDamageType: info.onHitDamageType,
			secondaryDice: secondaryRaw != null ? CharacterSheetSpells.applySpellcastingModTemplate(secondaryRaw, spellcastingMod) : null,
			secondaryDamageType: info.secondaryDamageType,
			secondaryLabel: info.secondaryLabel,
		};
	}

	/**
	 * Roll the secondary/movement damage of a weapon-channel cantrip cast on its own.
	 * (For Booming Blade this is the damage when the target moves; for Green-Flame Blade
	 * the splash to a second creature.) Returns `null`/empty when there is no secondary
	 * damage at the character's level (e.g. nothing to roll).
	 * @returns {*}
	 */
	_rollWeaponChannelSecondary (spellData, channel, appliedMetamagic = null) {
		if (!channel?.secondaryDice) {
			return {
				text: `<br><span class="ve-muted">On-hit damage rides your weapon attack — use the ✨ button by your weapon.</span>`,
				total: 0,
				dice: "",
				damageType: channel?.secondaryDamageType || "damage",
				isWeaponChannel: true,
			};
		}
		try {
			const isOvercharged = appliedMetamagic?.key === "overcharged";
			const detail = this._rollDamageDiceDetailed(channel.secondaryDice, {maximize: isOvercharged});
			const spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
			const total = detail.total + spellDamageBonus;
			const bonusStr = spellDamageBonus ? ` + ${spellDamageBonus} item` : "";
			const metamagicLabel = isOvercharged ? " maximized" : "";

			void this._page.pAnimateDamageDice?.(detail.groups);

			return {
				text: `<br>${channel.secondaryLabel}: <strong>${total}</strong> ${channel.secondaryDamageType} (${channel.secondaryDice}${bonusStr}${metamagicLabel})`
					+ `<br><span class="ve-muted">On-hit damage rides your weapon attack — use the ✨ button by your weapon.</span>`,
				total,
				dice: channel.secondaryDice,
				damageType: channel.secondaryDamageType,
				isWeaponChannel: true,
			};
		} catch (e) {
			return null;
		}
	}

	/**
	 * List the character's KNOWN weapon-channel cantrips (Booming/Green-Flame Blade and
	 * clones), each paired with its full spell data. Used by the combat tab to offer a
	 * per-weapon "channel" button.
	 * @returns {Array<{spell: object, spellData: object}>}
	 */
	getKnownWeaponChannelCantrips () {
		const spells = this._state.getSpells?.() || [];
		const out = [];
		for (const spell of spells) {
			if (spell.level !== 0) continue;
			const spellData = this._allSpells?.find(s => s.name === spell.name && s.source === spell.source);
			if (!spellData) continue;
			if (CharacterSheetSpells.getWeaponChannelCantripInfo(spellData)) out.push({spell, spellData});
		}
		return out;
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
	 * @returns {Promise<*>} Modified damage result with new type, or null if unchanged
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
	 * @returns {Promise<*>} Modified damage result with rerolled dice, or null if unchanged
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
		// Only applies to point-range spells (not self-range or AoE-from-self like cone/cube/line)
		if (tuned.includes("distant") && spellData?.range?.type === "point") {
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

	_rollSpellHealing (spellData, slotLevel, baseLevel, abilityOverride = null) {
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
		const healingAbility = abilityOverride || this._state.getSpellcastingAbility() || "int";
		const spellcastingMod = this._state.getAbilityMod(healingAbility);

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

		// When preparing (not unpreparing), enforce Gambler's rolled limit. This
		// keys on the SPELL being Gambler-attributed (sourceClass/sourceSubclass)
		// so it works in multiclass too, where getSpellcastingInfo() collapses to
		// aggregate info and drops isRolledPrepared. Legacy single-class Gambler
		// spells may be unstamped, so fall back to the character-wide flag when the
		// character is a single-class rolled-prepared caster.
		if (!spell.prepared) {
			const info = this._state.getSpellcastingInfo();
			const isGamblerSpell = spell.sourceClass === "Gambler"
				|| spell.sourceSubclass === "Gambler"
				|| (info?.isRolledPrepared && !info?.isMulticlass);
			if (isGamblerSpell) {
				const rolledMax = this._state.getGamblerPreparedCount();
				if (rolledMax == null) {
					JqueryUtil.doToast({
						type: "warning",
						content: "\u{1F3B2} Roll for prepared spells first! Use the Roll button on the Gambler card, or take a long rest.",
					});
					return;
				}
				const currentPrepared = this._state.getGamblerCurrentPreparedCount();
				if (currentPrepared >= rolledMax) {
					JqueryUtil.doToast({
						type: "warning",
						content: `\u{1F3B2} Gambler limit reached: ${currentPrepared}/${rolledMax} spells prepared (rolled ${rolledMax} for today). Unprepare a spell first, or take a long rest to roll again.`,
					});
					return;
				}
			}
		}

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

		// Delegate to shared method that handles metamagic display
		await this._showSpellInfoFromData(spellData);
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

	/**
	 * Render the Spell Scribing Adept spellbook section.
	 * Shows all scribed spells with memorize/remove controls and a "Scribe New Spell" button.
	 */
	_renderScribingSpellbook (container) {
		const calcs = this._state.getFeatureCalculations();
		if (!calcs.hasSpellScribingAdept) return;

		const spellbook = this._state.getScribingSpellbook();
		const memorized = this._state.getScribingMemorizedSpell();
		const maxLevel = this._state.getScribingMaxSpellLevel();
		const scribingClass = this._state.getScribingClass();

		const section = e_({outer: `<div class="charsheet__spell-section mb-3" style="border: 1px solid var(--cs-border); border-radius: 8px; padding: 12px;"></div>`});

		// Header
		section.insertAdjacentHTML("beforeend", `
			<div class="ve-flex-v-center mb-2">
				<span class="ve-bold">📖 Scribing Spellbook</span>
				<span class="ve-small ve-muted ml-2">(${scribingClass} • max level ${maxLevel})</span>
			</div>
		`);

		if (memorized) {
			section.insertAdjacentHTML("beforeend", `
				<div class="ve-small mb-2" style="color: var(--cs-success);">⭐ Memorized: <strong>${memorized.name}</strong> (Level ${memorized.level})</div>
			`);
		} else {
			section.insertAdjacentHTML("beforeend", `
				<div class="ve-small ve-muted mb-2">No spell memorized — take a long rest to memorize one</div>
			`);
		}

		// Spell list
		if (spellbook.length) {
			const list = e_({outer: `<div></div>`});
			spellbook.forEach(spell => {
				const isMemo = memorized && spell.id === memorized.id;
				const tooHigh = spell.level > maxLevel;
				const school = Parser.spSchoolAbvToFull?.(spell.school) || "";
				const spellNameRendered = Renderer.get().render(`{@spell ${spell.name}|${spell.source}}`);

				const row = e_({outer: `
					<div class="ve-flex-v-center p-1 ${tooHigh ? "ve-muted" : ""}" style="border-bottom: 1px solid var(--cs-border-faint, rgba(0,0,0,0.1));">
						<div class="ve-flex-col ve-flex-1">
							<div>${isMemo ? "⭐ " : ""}${spellNameRendered}</div>
							<div class="ve-small ve-muted">Level ${spell.level} ${school}</div>
						</div>
						<div class="ve-flex gap-1">
						</div>
					</div>
				`});

				const btnContainer = row.querySelector(".ve-flex.gap-1");

				// Memorize button (only from Spells tab — not long rest, but as convenience)
				if (!isMemo && !tooHigh) {
					const btnMemo = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", txt: "📖 Memorize"});
					btnMemo.addEventListener("click", () => {
						this._state.setScribingMemorizedSpell(spell.id);
						this._renderSpellList();
						this._page.saveCharacter();
						JqueryUtil.doToast({type: "success", content: `📖 Memorized: ${spell.name}`});
					});
					btnContainer.append(btnMemo);
				}
				if (isMemo) {
					const btnClear = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-warning", txt: "Clear"});
					btnClear.addEventListener("click", () => {
						this._state.clearScribingMemorizedSpell();
						this._renderSpellList();
						this._page.saveCharacter();
						JqueryUtil.doToast({type: "info", content: "📖 Cleared memorized spell"});
					});
					btnContainer.append(btnClear);
				}

				// Remove from spellbook
				const btnRemove = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-danger", txt: "×"});
				btnRemove.title = "Remove from spellbook";
				btnRemove.addEventListener("click", () => {
					if (!confirm(`Remove ${spell.name} from your scribing spellbook?`)) return;
					this._state.removeScribingSpell(spell.id);
					this._renderSpellList();
					this._page.saveCharacter();
				});
				btnContainer.append(btnRemove);

				list.append(row);
			});
			section.append(list);
		} else {
			section.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">No spells in spellbook yet</p>`);
		}

		// "Scribe New Spell" button
		const btnScribe = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-primary mt-2", txt: "📝 Scribe New Spell"});
		btnScribe.addEventListener("click", async () => {
			await this._pShowScribeNewSpellPicker();
		});
		section.append(btnScribe);

		container.append(section);
	}

	_renderSpellList () {
		const container = document.getElementById("charsheet-spell-lists");
		if (!container) return;

		container.innerHTML = "";

		// Render innate spells first (from features/feats)
		this._renderInnateSpells(container);

		// Render scribing spellbook section (Spell Scribing Adept)
		this._renderScribingSpellbook(container);

		let spells = this._state.getSpells();
		// Apply Thelemar rarity to stored spells (for backwards compatibility and display)
		spells = this.applyThelemarSpellRarity(spells);

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

		// Keep the cantrip/known/prepared counters in sync with the list. The
		// spell list and tracking box read the same underlying data, so every
		// add/remove/prepare path that re-renders the list must also refresh the
		// counters (otherwise e.g. charsheet-cantrips-current goes stale until a
		// full reload). _renderSpellTrackingUI does not call back into this
		// method, so there's no recursion.
		this._renderSpellTrackingUI();
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

		// Cantrips: partition into attributed (counted toward cap) vs orphans (rendered
		// separately in "Other Cantrips" group, NOT counted). Replace grouped[0] with the
		// attributed-only list so the level-0 group reflects the canonical count.
		let orphanCantrips = [];
		if (spellcastingInfo && spellcastingInfo.cantripsKnown > 0) {
			const allCantrips = grouped[0].spells;
			const {attributed, orphans, count} = (() => {
				const partition = CharacterSheetClassUtils.partitionCantripsByAttribution(allCantrips);
				const c = CharacterSheetClassUtils.countPlayerChosenCantrips(allCantrips);
				return {attributed: [...partition.attributed, ...partition.featureGranted], orphans: partition.orphan, count: c.count};
			})();
			orphanCantrips = orphans;
			grouped[0].spells = attributed;
			const limit = spellcastingInfo.cantripsKnown;
			const colorClass = count > limit ? "text-danger" : (count === limit ? "text-success" : "");
			grouped[0].name = `Class Cantrips <span class="ve-small ve-muted">(${count}/${limit})</span>`;
			if (count > limit) {
				grouped[0].name = `Class Cantrips <span class="ve-small ${colorClass}" title="You have more cantrips than your class level allows">(${count}/${limit}) <span class="glyphicon glyphicon-alert"></span></span>`;
			}
		}

		// Render each group. Orphan cantrips are appended immediately after the level-0
		// group so users see them next to the rest of their cantrips, not at the bottom.
		Object.entries(grouped).forEach(([level, group]) => {
			if (!group.spells.length) {
				if (level === "0") this._appendOrphanCantripsGroup(container, orphanCantrips);
				return;
			}

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

			if (level === "0") this._appendOrphanCantripsGroup(container, orphanCantrips);
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

		// Render cantrips first (always "prepared"); split attributed vs orphan so the
		// header count is canonical and orphans appear in their own group right next to
		// the regular class cantrips, not buried at the bottom of the spell list.
		let orphanCantrips = [];
		if (cantrips.length) {
			let cantripsToRender = cantrips;
			let cantripsHeader = "Class Cantrips";
			if (spellcastingInfo && spellcastingInfo.cantripsKnown > 0) {
				const partition = CharacterSheetClassUtils.partitionCantripsByAttribution(cantrips);
				const {count} = CharacterSheetClassUtils.countPlayerChosenCantrips(cantrips);
				orphanCantrips = partition.orphan;
				cantripsToRender = [...partition.attributed, ...partition.featureGranted];
				const limit = spellcastingInfo.cantripsKnown;
				const colorClass = count > limit ? "text-danger" : (count === limit ? "text-success" : "");
				cantripsHeader = `Class Cantrips <span class="ve-small ${colorClass}">(${count}/${limit})</span>`;
			}

			if (cantripsToRender.length) {
				const cantripsGroup = e_({outer: `
					<div class="charsheet__spell-group">
						<h5 class="charsheet__spell-group-header">${cantripsHeader}</h5>
						<div class="charsheet__spell-group-list"></div>
					</div>
				`});

				const list = cantripsGroup.querySelector(".charsheet__spell-group-list");
				cantripsToRender.sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
					list.append(this._renderSpellItem(spell));
				});
				container.append(cantripsGroup);
			}
		}

		// Orphan cantrips appear directly under the Class Cantrips group, before the
		// Prepared / Spellbook sections, so they're scannable side-by-side.
		this._appendOrphanCantripsGroup(container, orphanCantrips);

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
	 * Render orphan cantrips (no sourceFeature) in a separate "Other Cantrips" group
	 * so they're visible & actionable without inflating the X/Y cantrip cap.
	 * Orphans typically come from legacy saves or the manual Add-Spell flow before
	 * source attribution existed.
	 */
	_appendOrphanCantripsGroup (container, orphanCantrips) {
		if (!orphanCantrips?.length) return;
		const group = e_({outer: `
			<div class="charsheet__spell-group charsheet__spell-group--orphan">
				<h5 class="charsheet__spell-group-header" title="These cantrips have no class attribution and do not count toward your cantrip cap. They were likely added manually or imported from an older save.">
					Other Cantrips
					<span class="ve-small ve-muted ml-1">(unattributed — does not count toward cap)</span>
				</h5>
				<div class="charsheet__spell-group-list"></div>
			</div>
		`});
		const list = group.querySelector(".charsheet__spell-group-list");
		orphanCantrips.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(spell => {
			list.append(this._renderSpellItem(spell));
		});
		container.append(group);
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
	 * Resolve a spell's own save DC + attack bonus from its (possibly per-spell) casting
	 * ability. Works even when the character has no spellcasting class — e.g. a Hochling
	 * whose only cantrip is the racial Divine Spark cantrip cast with a chosen WIS/INT/CHA.
	 * Returns null when no ability can be attributed (so callers omit the badge).
	 * @param {*} spell
	 * @returns {{ability:string, saveDc:(number|null), attackBonus:(number|null)}|null}
	 */
	_getSpellAbilityStats (spell) {
		const ability = this._state.getSpellcastingAbilityForSpell?.(spell);
		if (!ability) return null;
		const saveDc = this._state.getSpellSaveDcForAbility?.(ability);
		const attackBonus = this._state.getSpellAttackBonusForAbility?.(ability);
		if (saveDc == null && attackBonus == null) return null;
		return {ability, saveDc, attackBonus};
	}

	/**
	 * Build the inline "Save DC N · +M to hit" badge for a spell, from its own casting
	 * ability. Returns "" when no ability can be attributed.
	 * @param {*} spell
	 * @returns {string}
	 */
	_renderSpellDcAttackBadge (spell) {
		const stats = this._getSpellAbilityStats(spell);
		if (!stats) return "";
		const parts = [];
		if (stats.saveDc != null) parts.push(`Save DC ${stats.saveDc}`);
		if (stats.attackBonus != null) parts.push(`${stats.attackBonus >= 0 ? "+" : ""}${stats.attackBonus} to hit`);
		if (!parts.length) return "";
		const abilityFull = (typeof Parser !== "undefined" && Parser.attAbvToFull) ? Parser.attAbvToFull(stats.ability) : stats.ability;
		return `<span class="charsheet__spell-item-dc ve-muted ve-small" title="Spell save DC / attack bonus (${abilityFull})">${parts.join(" \u00b7 ")}</span>`;
	}

	/**
	 * Render a single innate spell item
	 */
	_renderInnateSpellItem (spell) {
		const spellId = spell.id;

		// Bug 7 Phase 5: prefer getSpellHoverLink so innate-spell rows on the
		// sheet show rarity/legality badges (e.g. TGTT-tagged innates).
		const spellData = this._allSpells?.find(s => s.name === spell.name && s.source === spell.source);
		let spellLink = spell.name;
		try {
			if (this._page?.getSpellHoverLink) {
				spellLink = this._page.getSpellHoverLink(
					spell.name,
					spell.source || Parser.SRC_XPHB,
					spellData || null,
					spell,
				);
			} else if (this._page?.getHoverLink) {
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

		const dcBadge = this._renderSpellDcAttackBadge(spell);

		const item = e_({outer: `
			<div class="charsheet__spell-item charsheet__spell-item--innate" data-innate-spell-id="${spellId}">
				<div class="charsheet__spell-item-main">
					<span class="charsheet__spell-item-name">${spellLink}</span>
					${sourceInfo}
					${dcBadge ? `<div class="charsheet__spell-item-details ve-muted ve-small">${dcBadge}</div>` : ""}
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

		// Bind cast button (only present for non-at-will spells)
		const btnCast = item.querySelector(".charsheet__innate-cast");
		if (btnCast) {
			btnCast.addEventListener("click", () => {
				this._castInnateSpell(spellId);
			});
		}

		// Bind pip clicks to restore uses (only present for spells with usage tracking)
		const elPip = item.querySelector(".charsheet__innate-pip");
		if (elPip) {
			elPip.addEventListener("click", (/** @type {*} */ e) => {
				const pip = e.currentTarget;
				if (pip.classList.contains("used")) {
					// Restore one use
					spell.uses.current = Math.min(spell.uses.current + 1, spell.uses.max);
					this._renderSpellList();
				}
			});
		}

		return item;
	}

	/**
	 * Cast an innate spell (use one charge)
	 */
	async _castInnateSpell (spellId) {
		const spell = this._state.getInnateSpells().find(s => s.id === spellId);
		if (!spell) return;

		// Get full spell data for constraint checks
		const spellData = this._allSpells.find(s => s.name === spell.name && s.source === spell.source);

		// Check for conditions that prevent spellcasting
		if (!await this._pHandleCastingConstraints(spell, spellData)) return;

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

	/**
	 * Resolve the human-readable SOURCE of a spell for the source badge.
	 * Generic acquisition-method labels ("Spells Known", "Prepared Spells", …) are NOT a
	 * meaningful source — they describe how the spell was picked, not where it came from —
	 * so when `sourceFeature` is one of those we prefer the owning class/subclass name. A
	 * specific feature name (e.g. a subclass feature that grants a spell) is kept as-is.
	 * Fallback order: specific feature → feat → class → subclass → item → generic label → "Manual".
	 * @param {*} spell
	 * @returns {string}
	 */
	_getSpellSourceLabel (spell) {
		const sf = spell.sourceFeature;
		const sfIsGeneric = sf && PLAYER_CHOSEN_SPELL_FEATURES.has(sf);
		if (sf && !sfIsGeneric) return sf;
		return spell.fromFeat
			|| spell.sourceClass
			|| spell.sourceSubclass
			|| spell.sourceItem
			|| spell.itemName
			|| sf
			|| "Manual";
	}

	/**
	 * Resolve the spellcasting model ("known" | "prepared" | ...) of the class that owns a
	 * spell, subclass-aware. Reuses the state classifier (which itself routes through the
	 * shared getClassSpellcastingModel resolver and handles Gambler/EK/AT specials), so the
	 * Prepare button only appears for spells owned by a genuinely prepared caster.
	 * @param {*} spell
	 * @returns {string|null} The owner's spellcasting type, or null when the owner can't be resolved
	 */
	_resolveOwnerSpellcastingType (spell) {
		const classes = this._state.getClasses?.() || [];
		if (!classes.length) return null;
		const sc = spell.sourceClass;
		const ssc = spell.sourceSubclass;
		const owner = classes.find(c =>
			(sc && (c.name === sc || c.subclass?.name === sc))
			|| (ssc && (c.subclass?.name === ssc || c.name === ssc)));
		if (!owner) return null;
		return this._state._getClassSpellcastingInfo?.(owner)?.type || null;
	}

	/**
	 * Decide whether the per-spell "Prepare" toggle should render. Only prepared casters get
	 * to prepare/unprepare; known casters (Bard/Ranger/Sorcerer/Warlock, EK/AT) do not, even
	 * if a legacy save stamped the spell prepared. Cantrips and always-prepared spells never
	 * show the toggle. Spells whose owner can't be resolved (feat/item/race/orphan) fall back
	 * to the legacy prepared flags so older saves keep working.
	 * @param {*} spell
	 * @returns {boolean}
	 */
	_shouldShowPrepareToggle (spell) {
		if (spell.level === 0 || spell.alwaysPrepared) return false;
		const ownerType = this._resolveOwnerSpellcastingType(spell);
		if (ownerType === "known") return false;
		if (ownerType === "prepared") return true;
		// Unknown owner: rescue legacy prepared spells (feat/item/race/orphan attribution).
		return spell.prepared === true || spell.sourceFeature === "Prepared Spells";
	}

	_renderSpellItem (spell, showPrepareHint = false) {
		const schoolFull = spell.school ? Parser.spSchoolAbvToFull(spell.school) : "";
		const isPrepared = spell.prepared;
		const isCantrip = spell.level === 0;
		const isAlwaysPrepared = spell.alwaysPrepared;
		const sourceFeature = spell.sourceFeature;
		// Ensure spell has a valid ID
		const spellId = spell.id || `${spell.name}|${spell.source}`;

		// Look up full spell data for metamagic and hover
		const spellData = this._allSpells?.find(s => s.name === spell.name && s.source === spell.source);
		const modStats = this._state.getModifiedSpellStats?.(spellData);

		// Create hover link — uses custom predefined hover with metamagic + rarity/legality
		let spellLink = spell.name;
		try {
			if (this._page?.getSpellHoverLink) {
				spellLink = this._page.getSpellHoverLink(
					spell.name,
					spell.source || Parser.SRC_XPHB,
					spellData,
					spell,
				);
			} else if (this._page?.getHoverLink) {
				spellLink = this._page.getHoverLink(
					UrlUtil.PG_SPELLS,
					spell.name,
					spell.source || Parser.SRC_XPHB,
				);
			}
		} catch (e) {
			// Fall back to plain name
		}

		// Build spell details line — apply tuned passive metamagic stat overrides
		const detailParts = [];
		let metamagicNotes = [];

		if (spell.castingTime) detailParts.push(spell.castingTime);

		if (modStats?.range?.changed) {
			detailParts.push(modStats.range.modified);
		} else if (spell.range) {
			detailParts.push(spell.range);
		}

		if (modStats?.duration?.changed) {
			detailParts.push(modStats.duration.modified);
		} else if (spell.duration) {
			detailParts.push(spell.duration);
		}

		if (spell.components) detailParts.push(spell.components);
		if (modStats?.notes?.length) metamagicNotes = modStats.notes;
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

		// Determine preparation button state and text. Only prepared casters can prepare;
		// known casters never show the toggle (see _shouldShowPrepareToggle).
		let prepButtonHtml = "";
		if (!isCantrip && isAlwaysPrepared) {
			// Always prepared spells (from domain, subclass features, etc.) can't be unprepared
			const featureSource = sourceFeature || "class feature";
			prepButtonHtml = `
				<span class="ve-btn ve-btn-xs ve-btn-warning charsheet__spell-always-prepared" title="Always prepared from ${featureSource}">
					<span class="glyphicon glyphicon-star mr-1"></span>Always
				</span>
			`;
		} else if (this._shouldShowPrepareToggle(spell)) {
			// Normal prepared toggle
			prepButtonHtml = `
				<button class="ve-btn ve-btn-xs ${isPrepared ? "ve-btn-primary" : "ve-btn-default"} charsheet__spell-prepared" title="Toggle Prepared">
					<span class="glyphicon glyphicon-book mr-1"></span>${isPrepared ? "Prepared" : "Prepare"}
				</button>
			`;
		}

		// Build source badge: show where the spell comes from (feature / feat / class /
		// subclass / item), with a sensible fallback chain ending in "Manual".
		const sourceLabel = this._getSpellSourceLabel(spell);
		const sourceBadge = sourceLabel
			? `<span class="badge badge-warning charsheet__spell-source-badge" title="Source: ${sourceLabel}">${this._truncateFeatureName(sourceLabel)}</span>`
			: "";

		// Bug #13: surface a spell's own save DC / attack bonus when it carries an explicit
		// per-spell casting ability (e.g. the Hochling Divine Spark racial cantrip cast with
		// a chosen WIS/INT/CHA). Gated to the override case so ordinary class spell cards —
		// which already show DC/attack on their per-class breakdown card — are left untouched.
		const dcBadge = (spell.spellcastingAbility && Parser.ABIL_ABVS?.includes(spell.spellcastingAbility))
			? this._renderSpellDcAttackBadge(spell)
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

		// Cast buttons. Metamagic-capable characters get a dedicated "Cast w/ Metamagic"
		// button so the plain "Cast" can skip the picker entirely. Visibility keys off
		// whether the character knows any active metamagic (SP-stable — no flicker as
		// sorcery points change); per-spell applicability/affordability is surfaced in the
		// picker itself.
		const hasActiveMetamagic = (this._state.getCastableActiveMetamagics?.({spell, spellData, slotLevel: spell.level}) || []).length > 0;
		let castButtonsHtml = `
			<button class="ve-btn ve-btn-xs ve-btn-success charsheet__spell-cast" title="Cast Spell">
				<span class="glyphicon glyphicon-flash mr-1"></span>Cast
			</button>
		`;
		if (hasActiveMetamagic) {
			castButtonsHtml += `
				<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__spell-cast-metamagic" title="Cast with an active Metamagic option">
					<span class="glyphicon glyphicon-fire mr-1"></span>Cast w/ Metamagic
				</button>
			`;
		}

		const el = e_({outer: `
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
					${dcBadge ? `<div class="charsheet__spell-item-details ve-muted ve-small">${dcBadge}</div>` : ""}
					${metamagicNotes.length ? `<div class="charsheet__spell-item-details charsheet__metamagic-mod ve-small">${metamagicNotes.join(" · ")}</div>` : ""}
					${spell.isDivineSoulAffinity ? `<div class="charsheet__spell-item-details ve-muted ve-small"><span class="glyphicon glyphicon-info-sign mr-1"></span>Divine Soul affinity spell — may be swapped for another Cleric spell.</div>` : ""}
				</div>
				<div class="charsheet__spell-item-actions">
					${prepButtonHtml}
					${ritualButtonHtml}
					${castButtonsHtml}
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
					` : spell.isDivineSoulAffinity ? `
						<button class="ve-btn ve-btn-xs ve-btn-info charsheet__spell-swap-affinity" title="Swap this Divine Soul spell for another Cleric spell">
							<span class="glyphicon glyphicon-refresh mr-1"></span>Swap
						</button>
					` : `
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__spell-remove" title="Cannot remove feature spells" disabled>
							<span class="glyphicon glyphicon-lock mr-1"></span>Locked
						</button>
					`}
				</div>
			</div>
		`});

		// Star (favourite) toggle — appended to the spell's action area so users
		// can pin spells to the Overview Favourites section. Re-render the spell
		// list on toggle so the star badge reflects the new state without a tab switch.
		if (typeof this._page?._renderFavouriteStar === "function") {
			const star = this._page._renderFavouriteStar("spell", spell, {onToggle: () => this._renderSpellList()});
			if (star) {
				const actions = el.querySelector(".charsheet__spell-item-actions");
				if (actions) actions.append(star);
			}
		}

		return el;
	}

	/**
	 * Truncate a feature name for badge display
	 */
	_truncateFeatureName (name) {
		if (!name) return "";
		if (name.length <= 12) return name;
		return `${name.substring(0, 10)}…`;
	}

	render () {
		// Calculate spell slots based on class/level before rendering
		this._state.calculateSpellSlots();

		this.renderSlots();
		this._renderSpellList();
		this._renderSpellcastingStats();
	}

	/**
	 * Orchestrate the Spells-tab header: the per-class spellcasting cards plus
	 * the metamagic section. The cards themselves (ability / save DC / spell
	 * attack / spell + cantrip counts) are owned by _renderSpellTrackingUI so
	 * that the lighter call sites (after add/remove, Gambler roll) refresh the
	 * full block consistently.
	 */
	_renderSpellcastingStats () {
		this._renderSpellTrackingUI();
		this._renderMetamagic();
	}

	/**
	 * Render one spellcasting card per caster class into #charsheet-spellcasting-stats.
	 *
	 * Each card shows the class's own spellcasting ability, spell save DC and
	 * spell attack modifier, plus a "{displayName} Spells" and (when relevant)
	 * "{displayName} Cantrips" count. Counts are player-chosen vs the class cap,
	 * with feature-granted spells surfaced as "+N granted". The primary (first)
	 * card carries the legacy #charsheet-spell-ability/-dc/-attack ids for
	 * back-compat; every card uses the .charsheet__spell-ability/-dc/-attack
	 * classes. Clicking a count opens a class-scoped Add-Spell modal.
	 */
	_renderSpellTrackingUI () {
		const container = document.getElementById("charsheet-spellcasting-stats");
		if (!container) return;
		container.innerHTML = "";

		const breakdown = this._state.getSpellcastingClassBreakdown?.() || [];
		if (!breakdown.length) {
			container.style.display = "none";
			return;
		}
		container.style.display = "";

		const calcs = this._state.getFeatureCalculations?.() || {};
		breakdown.forEach((card, idx) => {
			container.append(this._buildSpellClassCard(card, idx === 0, calcs));
		});

		// Surface any spells/cantrips that aren't attributed to a class card so
		// legacy or mis-stamped data is never silently lost.
		const other = this._state.getUnattributedSpellCounts?.() || {spellsCount: 0, cantripsCount: 0};
		if (other.spellsCount > 0 || other.cantripsCount > 0) {
			const parts = [];
			if (other.spellsCount > 0) parts.push(`${other.spellsCount} spell${other.spellsCount === 1 ? "" : "s"}`);
			if (other.cantripsCount > 0) parts.push(`${other.cantripsCount} cantrip${other.cantripsCount === 1 ? "" : "s"}`);
			container.append(e_({outer: `
				<div class="charsheet__spell-class-card charsheet__spell-class-card--other" title="These spells aren't attributed to any class. Re-add them from a class card to track them.">
					<div class="charsheet__spell-class-card-header">
						<span class="charsheet__spell-class-card-title">Other</span>
					</div>
					<div class="charsheet__spell-class-card-counts">
						<span class="ve-muted ve-small">${parts.join(" • ")} unattributed</span>
					</div>
				</div>
			`}));
		}
	}

	/**
	 * Build a single per-class spellcasting card element.
	 * @param {object} card - One entry from getSpellcastingClassBreakdown()
	 * @param {boolean} isPrimary - Whether this is the first card (gets legacy ids)
	 * @param {object} calcs - getFeatureCalculations() snapshot (for Gambler dice)
	 * @returns {HTMLElement}
	 */
	_buildSpellClassCard (card, isPrimary, calcs) {
		const prof = this._state.getProficiencyBonus();
		const mod = this._state.getAbilityMod(card.ability);

		const itemBonuses = this._state.getItemBonuses?.() || {};
		const spellAttackBonus = itemBonuses.spellAttack || 0;
		const spellDcBonus = itemBonuses.spellSaveDc || 0;
		const customSpellAttack = this._state._data?.customModifiers?.spellAttack || 0;
		const customSpellDc = this._state._data?.customModifiers?.spellDc || 0;

		// Phase-1 doctrine: exhaustion is roll-only, not applied to display.
		const canonicalAttack = mod + prof;
		const effectiveAttack = canonicalAttack + spellAttackBonus + customSpellAttack;
		const canonicalDc = 8 + mod + prof;
		const effectiveDc = canonicalDc + spellDcBonus + customSpellDc;

		const idAttr = (base) => isPrimary ? ` id="charsheet-spell-${base}"` : "";

		const cardEl = e_({outer: `
			<div class="charsheet__spell-class-card" data-class-name="${(card.className || "").escapeQuotes()}" data-class-source="${(card.classSource || "").escapeQuotes()}">
				<div class="charsheet__spell-class-card-header">
					<span class="charsheet__spell-class-card-title">${(card.displayName || card.className || "").qq()}</span>
					<span class="charsheet__spell-ability charsheet__spell-class-card-ability"${idAttr("ability")} title="Spellcasting ability">${card.abilityLabel || ""}</span>
				</div>
				<div class="charsheet__spell-class-card-stats">
					<div class="charsheet__spell-stat">
						<span class="charsheet__spell-stat-label">Save DC</span>
						<span class="charsheet__spell-dc charsheet__spell-stat-value"${idAttr("dc")}>—</span>
					</div>
					<div class="charsheet__spell-stat">
						<span class="charsheet__spell-stat-label">Spell Attack</span>
						<span class="charsheet__spell-attack charsheet__spell-stat-value"${idAttr("attack")}>—</span>
					</div>
				</div>
				<div class="charsheet__spell-class-card-counts"></div>
			</div>
		`});

		const dcEl = cardEl.querySelector(".charsheet__spell-dc");
		const atkEl = cardEl.querySelector(".charsheet__spell-attack");

		if (card.isRolledPrepared) {
			// Gambler: DC/attack are rolled per cast (dice instead of a static mod).
			const dice = calcs.gamblerModifierDice || card.preparedDice || "1d4";
			const dcStatic = spellDcBonus + customSpellDc;
			const dcBonusStr = dcStatic > 0 ? ` + ${dcStatic}` : (dcStatic < 0 ? ` - ${Math.abs(dcStatic)}` : "");
			dcEl.textContent = `${8 + prof} + ${dice}${dcBonusStr}`;
			const atkStatic = spellAttackBonus + customSpellAttack;
			const atkBonusStr = atkStatic > 0 ? ` + ${atkStatic}` : (atkStatic < 0 ? ` - ${Math.abs(atkStatic)}` : "");
			atkEl.textContent = `+${prof} + ${dice}${atkBonusStr}`;
		} else {
			const dcOut = this._page._formatModWithEffective(canonicalDc, effectiveDc, {kind: "plain", titleEffective: "Effective spell save DC (with item/custom mods)"});
			const atkOut = this._page._formatModWithEffective(canonicalAttack, effectiveAttack, {kind: "mod", titleEffective: "Effective spell attack (with item/custom mods)"});
			if (canonicalDc === effectiveDc) dcEl.textContent = dcOut; else dcEl.innerHTML = dcOut;
			if (canonicalAttack === effectiveAttack) atkEl.textContent = atkOut; else atkEl.innerHTML = atkOut;

			// #3b: make the per-class spell-attack value a discoverable quick-roll.
			// Rolls THIS class's specific bonus, so multiclass casters (whose combined
			// Combat-tab badge can't pick one value) still get a working roll here.
			this._applySpellsTabAttackAffordance(atkEl, card.displayName || card.className, effectiveAttack);
		}

		// Count chips (Spells, then Cantrips). Clicking opens a class-scoped picker.
		const countsRow = cardEl.querySelector(".charsheet__spell-class-card-counts");
		countsRow.append(this._buildSpellCountChip({
			card,
			kind: "spells",
			label: `${card.displayName || card.className} Spells`,
			count: card.spellsCount,
			max: card.spellsMax,
			granted: card.spellsGranted,
		}));

		const showCantrips = (card.cantripsMax || 0) > 0 || (card.cantripsCount || 0) > 0 || (card.cantripsGranted || 0) > 0;
		if (showCantrips) {
			countsRow.append(this._buildSpellCountChip({
				card,
				kind: "cantrips",
				label: `${card.displayName || card.className} Cantrips`,
				count: card.cantripsCount,
				max: card.cantripsMax,
				granted: card.cantripsGranted,
			}));
		}

		// Gambler: roll-for-prepared control lives on the card.
		if (card.isRolledPrepared) this._appendGamblerRollControl(cardEl, card);

		return cardEl;
	}

	/**
	 * Make a Spells-tab per-class spell-attack value a discoverable quick-roll
	 * (button semantics + click/keyboard), rolling `d20 + bonus` through the
	 * shared animated dispatch. No-op when the bonus is not a finite number.
	 * @param {HTMLElement|null} el - The `.charsheet__spell-attack` element.
	 * @param {string} className - Display name for the roll title.
	 * @param {number} bonus - The (effective) flat spell-attack bonus to roll.
	 */
	_applySpellsTabAttackAffordance (el, className, bonus) {
		if (!el || !Number.isFinite(bonus)) return;
		el.classList.add("charsheet__spell-attack--clickable");
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		el.style.cursor = "pointer";
		const baseTitle = el.title && !el.title.includes("Roll spell attack") ? `${el.title} • ` : "";
		el.title = `${baseTitle}Roll spell attack (Shift = Advantage, Ctrl = Disadvantage)`;

		const handler = (event) => this._rollSpellsTabAttack(event, className, bonus);
		el.addEventListener("click", handler);
		el.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				handler(event);
			}
		});
	}

	/**
	 * Roll a Spells-tab spell attack for a specific class's flat bonus. Mirrors
	 * the Combat-tab badge roll (advantage/disadvantage from active states +
	 * shift/ctrl, crit/fumble notes) and routes through the shared animation.
	 * @param {*} event
	 * @param {string} className
	 * @param {number} bonus
	 */
	_rollSpellsTabAttack (event, className, bonus) {
		if (!Number.isFinite(bonus)) return;

		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack:spell")
			|| this._state.hasAdvantageFromStates?.("attack");
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack:spell")
			|| this._state.hasDisadvantageFromStates?.("attack");
		let stateMode;
		if (hasAdvantage && !hasDisadvantage) stateMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) stateMode = "disadvantage";

		const stateAttackBonus = (this._state.getBonusFromStates?.("attack") || 0)
			+ (this._state.getBonusFromStates?.("attack:spell") || 0);
		const totalBonus = bonus + stateAttackBonus;

		// Spell attacks ARE attacks: pass isAttack so any Nat1/Nat20 check/save rule
		// does not leak into the breakdown.
		const rollResult = this._page.rollD20({event, mode: stateMode, isAttack: true});
		const total = rollResult.roll + totalBonus;

		const critRange = this._state.getCriticalRange?.() || 20;
		let resultClass = "";
		let resultNote = "";
		if (rollResult.roll >= critRange) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Critical Hit!";
		} else if (rollResult.roll === 1) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Critical Miss!";
		}

		const modeLabel = this._page.getModeLabel?.(rollResult.mode) || "";
		void this._page.pAnimateD20?.(rollResult);
		this._page.showDiceResult({
			title: `${className ? `${className} ` : ""}Spell Attack${modeLabel}`,
			roll: rollResult.roll,
			modifier: totalBonus,
			total,
			resultClass,
			resultNote,
			subtitle: this._page.formatD20Breakdown(rollResult, totalBonus),
		});
	}

	/**
	 * Build a clickable spell/cantrip count chip. `max === null` renders a
	 * capless count (Wizard spellbook). Opens a class-scoped Add-Spell modal.
	 * @param {object} opts
	 * @returns {HTMLElement}
	 */
	_buildSpellCountChip ({card, kind, label, count, max, granted}) {
		const hasCap = max !== null && max !== undefined;
		const isOver = hasCap && count > max;
		const valueStr = hasCap ? `${count}/${max}` : `${count}`;
		const grantedStr = granted > 0 ? `<span class="charsheet__spell-count-granted" title="Feature-granted (e.g. subclass) — does not count toward your limit">+${granted} granted</span>` : "";
		const capHint = !hasCap ? `<span class="ve-muted ve-small">spells</span>` : "";

		const chip = e_({outer: `
			<button type="button" class="charsheet__spell-count-chip${isOver ? " charsheet__spell-count-chip--over" : ""}" data-kind="${kind}" title="Add ${kind === "cantrips" ? "cantrips" : "spells"} for ${(card.displayName || card.className || "").qq()}">
				<span class="charsheet__spell-count-label">${label.qq()}</span>
				<span class="charsheet__spell-count-value">${valueStr} ${capHint}</span>
				${grantedStr}
			</button>
		`});

		chip.addEventListener("click", () => {
			const classEntry = (this._state.getClasses() || []).find(c => c.name === card.className && (c.source || null) === (card.classSource || null));
			this._showSpellPicker(classEntry || null);
		});

		return chip;
	}

	/**
	 * Append the Gambler "roll for prepared count" control to a card. Mirrors the
	 * previous behaviour but lives inline on the per-class card.
	 */
	_appendGamblerRollControl (cardEl, card) {
		const rolledMax = this._state.getGamblerPreparedCount();
		const note = e_({tag: "div", clazz: "charsheet__spell-class-card-gambler ve-small"});

		if (rolledMax != null) {
			const rollDetails = this._state.getGamblerPreparedRollDetails?.();
			note.textContent = rollDetails
				? `\u{1F3B2} Rolled ${rollDetails.dice}: (${rollDetails.rolls.join(" + ")}) = ${rollDetails.total} prepared today`
				: `\u{1F3B2} Rolled ${rolledMax} prepared today`;
		} else {
			const dice = card.preparedDice || "2d4";
			const rollBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-primary">\u{1F3B2} Roll ${dice}</button>`});
			note.append(rollBtn);
			note.append(document.createTextNode(" Not yet rolled — roll after a long rest"));
			rollBtn.addEventListener("click", () => {
				if (this._state.getGamblerPreparedCount() != null) {
					JqueryUtil.doToast({content: "Already rolled for today — take a long rest to roll again.", type: "warning"});
					return;
				}
				const rollDetails = this._state.rollGamblerPreparedSpells();
				if (rollDetails) {
					JqueryUtil.doToast(/** @type {*} */ ({
						content: `\u{1F3B2} Gambler: Rolled ${rollDetails.dice} = (${rollDetails.rolls.join(" + ")}) = ${rollDetails.total} spells prepared`,
						type: "success",
						autoHideTime: 5000,
					}));
					this._renderSpellTrackingUI();
					this._page.saveCharacter();
				}
			});
		}
		cardEl.append(note);
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

		// Get filtered spells with rarity/legality tags
		const filteredSpells = this._page.getFilteredSpellData();
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
		const search = e_({outer: `<input type="text" class="ve-form-control form-control--minimal mb-2" placeholder="Search spells...">`});
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
					item.addEventListener("click", (/** @type {*} */ e) => {
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
	 * Show a spell picker to scribe a new spell into the scribing spellbook.
	 * Filtered to the chosen class's spell list, up to the max scribing level.
	 * Shows cost info (50 gp/level, 2 hr/level).
	 */
	async _pShowScribeNewSpellPicker () {
		let scribingClass = this._state.getScribingClass();

		// The feat may have been taken via a path that didn't trigger the
		// "pick a scribing class" choice (e.g. Origin Feat in builder, an old
		// save predating the choices flow, etc.). Recover gracefully by
		// prompting the user for the class now, rather than silently no-op'ing.
		if (!scribingClass) {
			const SUPPORTED_CLASSES = ["Bard", "Sorcerer", "Warlock"];
			const characterClasses = (this._state.getClasses?.() || []).map(c => c.name);
			const eligible = SUPPORTED_CLASSES.filter(n => characterClasses.includes(n));

			if (eligible.length === 0) {
				JqueryUtil.doToast({
					type: "danger",
					content: "Spell Scribing Adept requires at least one level in Bard, Sorcerer, or Warlock.",
				});
				return;
			}

			if (eligible.length === 1) {
				scribingClass = eligible[0];
			} else {
				const choice = await InputUiUtil.pGetUserEnum({
					title: "Spell Scribing Adept — Choose Class",
					htmlDescription: `<div>Choose which spell list to scribe from. Scribed spells use this class's spell list at up to half your level in that class (rounded up).</div>`,
					values: eligible,
					fnDisplay: v => v,
					isResolveItem: true,
				});
				if (choice == null) return; // user cancelled
				scribingClass = choice;
			}

			this._state.setScribingClass(scribingClass);
			this._page.saveCharacter();
		}

		const maxLevel = this._state.getScribingMaxSpellLevel();
		const allSpells = this._page.getFilteredSpellData() || this._page.getSpells() || [];
		const existingIds = new Set(this._state.getScribingSpellbook().map(s => `${s.name}|${s.source}`));

		const spell = await this._pShowScribingSpellPicker({
			title: "📝 Scribe New Spell",
			className: scribingClass,
			maxLevel,
			allSpells,
			existingIds,
		});

		if (!spell) return;

		const decision = await this._pConfirmScribingCost(spell);
		if (!decision || decision === "cancel") return;

		if (decision === "pay") {
			const cost = spell.level * 50;
			const result = this._state.deductGold(cost);
			if (!result.success) {
				JqueryUtil.doToast({type: "danger", content: result.error || "Could not deduct cost."});
				return;
			}
			// Refresh currency widgets so the new gold total appears immediately.
			// Mirrors charactersheet-upgrades.js post-deductGold pattern.
			this._page._renderCurrency?.();
			this._page._inventory?.render?.();
		}

		this._state.addScribingSpell(spell);
		this._renderSpellList();
		this._page.saveCharacter();
		const cost = spell.level * 50;
		const hours = spell.level * 2;
		const costNote = decision === "pay" ? `${cost} gp deducted` : "cost ignored";
		JqueryUtil.doToast({type: "success", content: `📝 Scribed: ${spell.name} (${costNote}, ${hours} hrs)`});
	}

	/**
	 * Three-way confirmation modal for scribing a spell (TGTT Spell Scribing Adept).
	 *
	 * The feat documents a cost of 50 gp × spell level plus 2 hours per level.
	 * Players may want to:
	 *   - Pay the cost and scribe (the canonical flow);
	 *   - Skip the cost and scribe anyway (downtime narrative variants, DM
	 *     fiat, characters with free access via story arcs);
	 *   - Cancel entirely.
	 *
	 * "Pay" is disabled when the character can't afford the cost — the modal
	 * still offers "Skip cost" and "Cancel" so the player isn't trapped.
	 *
	 * Phase 7.3a: Replaced `InputUiUtil.pGetUserEnum` (dropdown) with explicit
	 * buttons so players can pick the action with a single click.
	 *
	 * Returns one of `"pay"`, `"skip"`, or `"cancel"`. Resolves to `"cancel"`
	 * on dismissal.
	 *
	 * @param {{name: string, level: number}} spell
	 * @returns {Promise<"pay"|"skip"|"cancel">}
	 */
	async _pConfirmScribingCost (spell) {
		const cost = spell.level * 50;
		const hours = spell.level * 2;
		const totalGp = this._state.getTotalGold();
		const canAfford = totalGp >= cost;

		let result = "cancel";
		let resolveOuter;
		const pResult = new Promise(resolve => { resolveOuter = resolve; });

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "📝 Scribe Spell",
			isMinHeight0: true,
			cbClose: () => resolveOuter(result),
		});

		modalInner.appendChild(e_({tag: "div",
			html: `
			<p>Scribing <strong>${spell.name}</strong> (level ${spell.level}) into your spellbook.</p>
			<ul class="mb-2">
				<li><strong>Cost:</strong> ${cost} gp (50 gp × ${spell.level})</li>
				<li><strong>Time:</strong> ${hours} hours (2 hours × ${spell.level})</li>
			</ul>
			<p class="ve-muted ve-small mb-3">You have <strong>${totalGp.toFixed(2)} gp</strong> available${canAfford ? "" : ` — not enough to pay`}.</p>
		`}));

		const btnRow = e_({
			tag: "div",
			style: "display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;",
		});

		const btnPay = e_({
			tag: "button",
			clazz: `ve-btn ve-btn-primary${canAfford ? "" : " disabled"}`,
			text: canAfford ? `💰 Pay ${cost} gp & Scribe` : `Pay ${cost} gp (insufficient)`,
		});
		if (canAfford) {
			btnPay.addEventListener("click", () => { result = "pay"; doClose(true); });
		} else {
			btnPay.setAttribute("disabled", "disabled");
			btnPay.setAttribute("title", `Need ${(cost - totalGp).toFixed(2)} more gp`);
		}

		const btnSkip = e_({
			tag: "button",
			clazz: "ve-btn ve-btn-default",
			text: "Skip cost (scribe anyway)",
		});
		btnSkip.addEventListener("click", () => { result = "skip"; doClose(true); });

		const btnCancel = e_({
			tag: "button",
			clazz: "ve-btn ve-btn-default",
			text: "Cancel",
		});
		btnCancel.addEventListener("click", () => { result = "cancel"; doClose(false); });

		btnRow.appendChild(btnPay);
		btnRow.appendChild(btnSkip);
		btnRow.appendChild(btnCancel);
		modalInner.appendChild(btnRow);

		return pResult;
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

		// Process pending scribing spellbook picks (Spell Scribing Adept)
		await this.processScribingSpellPicks();
	}

	/**
	 * Process pending scribing spellbook picks for Spell Scribing Adept.
	 * Shows a spell picker for each remaining pick, filtering to the chosen class's spell list
	 * at 1st level (initial picks) or up to max scribing level (later scribing).
	 */
	async processScribingSpellPicks () {
		let remaining = this._state.getPendingScribingPicks();
		if (!remaining) return;

		const scribingClass = this._state.getScribingClass();
		if (!scribingClass) return;

		const maxLevel = 1; // Initial picks are always 1st-level
		const allSpells = this._page.getFilteredSpellData() || this._page.getSpells() || [];
		const existingBook = this._state.getScribingSpellbook();
		const existingIds = new Set(existingBook.map(s => `${s.name}|${s.source}`));

		while (remaining > 0) {
			const spell = await this._pShowScribingSpellPicker({
				title: `Scribing Spellbook: Choose Spell (${remaining} remaining)`,
				className: scribingClass,
				maxLevel,
				allSpells,
				existingIds,
			});

			if (!spell) break; // User cancelled

			this._state.addScribingSpell(spell);
			existingIds.add(`${spell.name}|${spell.source}`);
			remaining--;
			this._state.setPendingScribingPicks(remaining);
		}

		if (remaining === 0) {
			this._state.setPendingScribingPicks(0);
			this._renderSpellList();
			this._page.saveCharacter();
		}
	}

	/**
	 * Open a picker to swap a Divine Soul Sorcerer's affinity (always-prepared)
	 * spell for another spell from the granted Cleric list. The candidate pool is
	 * restricted to spells on the Cleric list at the affinity spell's level (the
	 * affinity grant is a level-1 spell), matching the rules allowance to change
	 * only this one always-prepared spell, and only for a Cleric spell.
	 * @param {object} affinitySpell - The current affinity spell entry
	 */
	async _pSwapDivineSoulAffinity (affinitySpell) {
		const className = affinitySpell.sourceClass || "Sorcerer";
		const classEntry = (this._state.getClasses?.() || []).find(c => c.name === className);
		if (!classEntry || !CharacterSheetClassUtils.isDivineSoulSubclass(classEntry.subclass)) return;

		const classDataForSubclass = this._page?.getClasses?.()?.find(c => c.name === classEntry.name && c.source === classEntry.source);
		const subclass = CharacterSheetClassUtils.resolveFullSubclass(classEntry.subclass, classDataForSubclass);

		// Restriction source: the subclass's granted/expanded spell list (Cleric).
		const grantedClasses = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className,
			subclass,
			subclassChoice: classEntry.subclassChoice,
		});
		if (!grantedClasses?.length) return;

		const affinityLevel = affinitySpell.level ?? 1;
		const currentId = `${(affinitySpell.name || "").toLowerCase()}|${(affinitySpell.source || Parser.SRC_PHB).toLowerCase()}`;

		const candidates = (this._allSpells || [])
			.filter(s => {
				if (s.level !== affinityLevel) return false;
				const sId = `${s.name.toLowerCase()}|${(s.source || "").toLowerCase()}`;
				if (sId === currentId) return false;
				return grantedClasses.some(cn => CharacterSheetClassUtils.spellIsForClass(s, cn));
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		const chosen = await this._pPickSwapSpell({
			title: "Swap Divine Soul Spell",
			prompt: `Choose a <strong>Cleric spell</strong> (level ${affinityLevel}) to replace <em>${affinitySpell.name}</em> as your Divine Soul affinity spell:`,
			spells: candidates,
		});
		if (!chosen) return;

		const ok = this._state.swapDivineSoulAffinitySpell(className, {
			name: chosen.name,
			source: chosen.source,
			level: chosen.level,
		});
		if (!ok) return;

		this._renderSpellList();
		this._page?.saveCharacter?.();
	}

	/**
	 * Generic single-spell picker modal used by the Divine Soul swap flow.
	 * @param {object} opts - {title, prompt, spells}
	 * @returns {Promise<object|null>} Selected spell or null
	 */
	async _pPickSwapSpell ({title, prompt, spells}) {
		return new Promise((resolve) => {
			(async () => {
				const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
					title,
					isMinHeight0: true,
					zIndex: 10002,
					cbClose: () => resolve(null),
				});

				modalInner.insertAdjacentHTML("beforeend", `<p class="mb-2">${prompt}</p>`);

				const search = e_({outer: `<input type="text" class="ve-form-control form-control--minimal mb-2" placeholder="Search spells...">`});
				modalInner.append(search);

				const list = e_({outer: `<div style="max-height: 350px; overflow-y: auto;"></div>`});
				modalInner.append(list);

				const renderList = (filter = "") => {
					list.innerHTML = "";
					const filtered = filter
						? spells.filter(s => s.name.toLowerCase().includes(filter))
						: spells;

					if (!filtered.length) {
						list.insertAdjacentHTML("beforeend", `<p class="ve-muted text-center py-2">No matching spells</p>`);
						return;
					}

					filtered.forEach(spell => {
						const school = Parser.spSchoolAbvToFull?.(spell.school) || spell.school;
						const spellNameRendered = Renderer.get().render(`{@spell ${spell.name}|${spell.source}}`);
						const item = e_({outer: `
							<div class="ve-flex-v-center p-2 clickable spell-choice-item" style="border-bottom: 1px solid var(--cs-border);">
								<div class="ve-flex-col ve-flex-1">
									<div>${spellNameRendered}</div>
									<div class="ve-small ve-muted">Level ${spell.level} ${school}</div>
								</div>
								<button class="ve-btn ve-btn-primary ve-btn-xs">Select</button>
							</div>
						`});
						item.querySelector("button").addEventListener("click", () => {
							resolve(spell);
							doClose();
						});
						list.append(item);
					});
				};

				search.addEventListener("input", (/** @type {*} */ e) => renderList(e.target.value.toLowerCase()));
				renderList();

				const cancelBtn = e_({outer: `<button class="ve-btn ve-btn-default mt-2">Cancel</button>`});
				cancelBtn.addEventListener("click", () => { resolve(null); doClose(); });
				modalInner.append(cancelBtn);
			})();
		});
	}

	/**
	 * Build the scribable-spell pool for Spell Scribing Adept.
	 *
	 * Generic over expanded/granted spell lists: a Divine Soul Sorcerer's
	 * Cleric-list access (and any other subclass that expands a class's list)
	 * is honoured because we delegate the "is this spell available to the
	 * class?" decision to `CharacterSheetClassUtils.spellIsAvailableForClass`,
	 * which already aggregates the base class list, the subclass list, and the
	 * expanded class lists from `getAdditionalSpellListClasses`.
	 *
	 * @param {object} opts
	 * @param {Array} opts.allSpells - Full spell pool to filter
	 * @param {string} opts.className - Scribing class (Bard/Sorcerer/Warlock)
	 * @param {string} [opts.classSource] - Scribing class source
	 * @param {object} [opts.subclass] - Resolved subclass object (full, with additionalSpells)
	 * @param {object} [opts.subclassChoice] - Subclass sub-choice (e.g. Divine Soul affinity)
	 * @param {number} opts.maxLevel - Maximum scribable spell level
	 * @param {Set<string>} opts.existingIds - `name|source` ids already scribed
	 * @returns {Array} Filtered + sorted scribable spells
	 */
	static getScribableSpells ({allSpells, className, classSource, subclass, subclassChoice, maxLevel, existingIds}) {
		const existing = existingIds || new Set();
		return (allSpells || []).filter(spell => {
			if (spell.level < 1 || spell.level > maxLevel) return false;
			if (existing.has(`${spell.name}|${spell.source}`)) return false;
			return CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
				className,
				classSource,
				subclass,
				subclassChoice,
			});
		}).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
	}

	/**
	 * Show a spell picker modal filtered for the scribing spellbook.
	 * @param {object} opts - {title, className, maxLevel, allSpells, existingIds}
	 * @returns {Promise<object|null>} - Selected spell or null if cancelled
	 */
	async _pShowScribingSpellPicker ({title, className, maxLevel, allSpells, existingIds}) {
		// Resolve the scribing class's stored entry so we can honour its subclass
		// and any expanded/granted spell lists (e.g. Divine Soul Sorcerer → Cleric)
		// when building the scribable pool. Resolve the (possibly shallow) stored
		// subclass ref to its full object so `additionalSpells` is available.
		const classEntry = (this._state.getClasses?.() || []).find(c => c.name === className);
		const classDataForSubclass = classEntry
			? this._page?.getClasses?.()?.find(c => c.name === classEntry.name && c.source === classEntry.source)
			: null;
		const subclass = classEntry?.subclass
			? CharacterSheetClassUtils.resolveFullSubclass(classEntry.subclass, classDataForSubclass)
			: null;

		// Filter spells: available to the class (base list + subclass + expanded
		// lists), level range, not already in scribing spellbook.
		const classSpells = CharacterSheetSpells.getScribableSpells({
			allSpells,
			className,
			classSource: classEntry?.source,
			subclass,
			subclassChoice: classEntry?.subclassChoice,
			maxLevel,
			existingIds,
		});

		return new Promise((resolve) => {
			(async () => {
				const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
					title,
					isMinHeight0: true,
					zIndex: 10002,
					cbClose: () => resolve(null),
				});

				modalInner.insertAdjacentHTML("beforeend", `<p class="mb-2">Select a <strong>${className} spell</strong> (level 1–${maxLevel}) for your scribing spellbook:</p>`);

				const search = e_({outer: `<input type="text" class="ve-form-control form-control--minimal mb-2" placeholder="Search spells...">`});
				modalInner.append(search);

				const list = e_({outer: `<div style="max-height: 350px; overflow-y: auto;"></div>`});
				modalInner.append(list);

				const renderList = (filter = "") => {
					list.innerHTML = "";
					const filtered = filter
						? classSpells.filter(s => s.name.toLowerCase().includes(filter))
						: classSpells;

					if (!filtered.length) {
						list.insertAdjacentHTML("beforeend", `<p class="ve-muted text-center py-2">No matching spells</p>`);
						return;
					}

					filtered.forEach(spell => {
						const school = Parser.spSchoolAbvToFull?.(spell.school) || spell.school;
						const spellNameRendered = Renderer.get().render(`{@spell ${spell.name}|${spell.source}}`);
						const item = e_({outer: `
							<div class="ve-flex-v-center p-2 clickable spell-choice-item" style="border-bottom: 1px solid var(--cs-border);">
								<div class="ve-flex-col ve-flex-1">
									<div>${spellNameRendered}</div>
									<div class="ve-small ve-muted">Level ${spell.level} ${school}</div>
								</div>
								<button class="ve-btn ve-btn-primary ve-btn-xs">Select</button>
							</div>
						`});
						item.querySelector("button").addEventListener("click", () => {
							// Bug 5.4 Phase 5: resolve BEFORE doClose so cbClose's
							// resolve(null) becomes a no-op. doClose() invokes the
							// modal's cbClose synchronously (inside an async function),
							// which races and wins if we call doClose first.
							resolve(spell);
							doClose();
						});
						list.append(item);
					});
				};

				search.addEventListener("input", (/** @type {*} */ e) => renderList(e.target.value.toLowerCase()));
				renderList();

				const cancelBtn = e_({outer: `<button class="ve-btn ve-btn-default mt-2">Cancel</button>`});
				cancelBtn.addEventListener("click", () => { resolve(null); doClose(); });
				modalInner.append(cancelBtn);
			})();
		});
	}
	// #endregion
}

/**
 * Wild Magic Surge table for variant component overuse (d100).
 * Based on PHB Wild Magic Surge table, adapted for variant component context.
 */
CharacterSheetSpells._VARIANT_WILD_MAGIC_TABLE = [
	{min: 1, max: 4, effect: "The component explodes — you take 1d6 force damage."},
	{min: 5, max: 8, effect: "You cast Faerie Fire centered on yourself (no concentration, 1 minute)."},
	{min: 9, max: 12, effect: "All variant components in your inventory glow faintly for 1 hour — no effect."},
	{min: 13, max: 16, effect: "You are frightened of the nearest creature until the end of your next turn."},
	{min: 17, max: 20, effect: "You regain 1 expended spell slot of the lowest level available."},
	{min: 21, max: 24, effect: "Your skin turns a vibrant color (DM's choice) for 24 hours."},
	{min: 25, max: 28, effect: "A spectral eye appears above you for 1 minute — you can't be hidden."},
	{min: 29, max: 32, effect: "You teleport up to 30 feet to an unoccupied space you can see."},
	{min: 33, max: 36, effect: "The spell's damage type changes to a random type (DM rolls d10)."},
	{min: 37, max: 40, effect: "You are invisible until the start of your next turn or until you attack/cast."},
	{min: 41, max: 44, effect: "Flowers sprout in a 10-ft radius around you. Difficult terrain for 1 minute."},
	{min: 45, max: 48, effect: "The component's effect is doubled (DM adjudicates)."},
	{min: 49, max: 52, effect: "You emit bright light in a 30-ft radius for 1 minute."},
	{min: 53, max: 56, effect: "1d6 gems worth 10 gp each appear at your feet."},
	{min: 57, max: 60, effect: "The next spell you cast within 1 minute costs no spell slot."},
	{min: 61, max: 64, effect: "You shrink by one size category for 1 minute."},
	{min: 65, max: 68, effect: "All creatures within 10 ft take 1d4 lightning damage."},
	{min: 69, max: 72, effect: "You regain 2d10 hit points."},
	{min: 73, max: 76, effect: "Your voice echoes magically for 10 minutes — you have advantage on Intimidation checks."},
	{min: 77, max: 80, effect: "The component is not consumed — it reappears in your inventory."},
	{min: 81, max: 84, effect: "A 10-ft-radius fog cloud appears centered on you (lasts 1 minute, no concentration)."},
	{min: 85, max: 88, effect: "You gain resistance to the spell's damage type until the end of your next turn."},
	{min: 89, max: 92, effect: "A random creature within 30 ft is polymorphed into a sheep for 1 round (DM's choice)."},
	{min: 93, max: 96, effect: "Your spell slot expenditure is refunded, but the component is still consumed."},
	{min: 97, max: 100, effect: "The DM determines a unique magical effect appropriate to the situation."},
];

/**
 * The 2014 Player's Handbook Wild Magic Surge table (d100), transcribed from
 * `data/class/class-sorcerer.json` (Wild Magic origin). Tags are stripped to plain
 * text for toast display. This is the canonical PHB surge table referenced as
 * `{@table Wild Magic Surge|PHB}` and is used by the Feywild Shard (TCE) item.
 *
 * NOTE: This is intentionally separate from `_VARIANT_WILD_MAGIC_TABLE`, which is a
 * homebrew table for variant-component overuse and is NOT the PHB surge table.
 */
CharacterSheetSpells.PHB_WILD_MAGIC_SURGE_TABLE = [
	{min: 1, max: 2, effect: "Roll on this table at the start of each of your turns for the next minute, ignoring this result on subsequent rolls."},
	{min: 3, max: 4, effect: "For the next minute, you can see any invisible creature if you have line of sight to it."},
	{min: 5, max: 6, effect: "A modron chosen and controlled by the DM appears in an unoccupied space within 5 feet of you, then disappears 1 minute later."},
	{min: 7, max: 8, effect: "You cast fireball as a 3rd-level spell centered on yourself."},
	{min: 9, max: 10, effect: "You cast magic missile as a 5th-level spell."},
	{min: 11, max: 12, effect: "Roll a d10. Your height changes by a number of inches equal to the roll. If the roll is odd, you shrink. If the roll is even, you grow."},
	{min: 13, max: 14, effect: "You cast confusion centered on yourself."},
	{min: 15, max: 16, effect: "For the next minute, you regain 5 hit points at the start of each of your turns."},
	{min: 17, max: 18, effect: "You grow a long beard made of feathers that remains until you sneeze, at which point the feathers explode out from your face."},
	{min: 19, max: 20, effect: "You cast grease centered on yourself."},
	{min: 21, max: 22, effect: "Creatures have disadvantage on saving throws against the next spell you cast in the next minute that involves a saving throw."},
	{min: 23, max: 24, effect: "Your skin turns a vibrant shade of blue. A remove curse spell can end this effect."},
	{min: 25, max: 26, effect: "An eye appears on your forehead for the next minute. During that time, you have advantage on Wisdom (Perception) checks that rely on sight."},
	{min: 27, max: 28, effect: "For the next minute, all your spells with a casting time of 1 action have a casting time of 1 bonus action."},
	{min: 29, max: 30, effect: "You teleport up to 60 feet to an unoccupied space of your choice that you can see."},
	{min: 31, max: 32, effect: "You are transported to the Astral Plane until the end of your next turn, after which time you return to the space you previously occupied or the nearest unoccupied space if that space is occupied."},
	{min: 33, max: 34, effect: "Maximize the damage of the next damaging spell you cast within the next minute."},
	{min: 35, max: 36, effect: "Roll a d10. Your age changes by a number of years equal to the roll. If the roll is odd, you get younger (minimum 1 year old). If the roll is even, you get older."},
	{min: 37, max: 38, effect: "1d6 flumphs controlled by the DM appear in unoccupied spaces within 60 feet of you and are frightened of you. They vanish after 1 minute."},
	{min: 39, max: 40, effect: "You regain 2d10 hit points."},
	{min: 41, max: 42, effect: "You turn into a potted plant until the start of your next turn. While a plant, you are incapacitated and have vulnerability to all damage. If you drop to 0 hit points, your pot breaks, and your form reverts."},
	{min: 43, max: 44, effect: "For the next minute, you can teleport up to 20 feet as a bonus action on each of your turns."},
	{min: 45, max: 46, effect: "You cast levitate on yourself."},
	{min: 47, max: 48, effect: "A unicorn controlled by the DM appears in a space within 5 feet of you, then disappears 1 minute later."},
	{min: 49, max: 50, effect: "You can't speak for the next minute. Whenever you try, pink bubbles float out of your mouth."},
	{min: 51, max: 52, effect: "A spectral shield hovers near you for the next minute, granting you a +2 bonus to AC and immunity to magic missile."},
	{min: 53, max: 54, effect: "You are immune to being intoxicated by alcohol for the next 5d6 days."},
	{min: 55, max: 56, effect: "Your hair falls out but grows back within 24 hours."},
	{min: 57, max: 58, effect: "For the next minute, any flammable object you touch that isn't being worn or carried by another creature bursts into flame."},
	{min: 59, max: 60, effect: "You regain your lowest-level expended spell slot."},
	{min: 61, max: 62, effect: "For the next minute, you must shout when you speak."},
	{min: 63, max: 64, effect: "You cast fog cloud centered on yourself."},
	{min: 65, max: 66, effect: "Up to three creatures you choose within 30 feet of you take 4d10 lightning damage."},
	{min: 67, max: 68, effect: "You are frightened by the nearest creature until the end of your next turn."},
	{min: 69, max: 70, effect: "Each creature within 30 feet of you becomes invisible for the next minute. The invisibility ends on a creature when it attacks or casts a spell."},
	{min: 71, max: 72, effect: "You gain resistance to all damage for the next minute."},
	{min: 73, max: 74, effect: "A random creature within 60 feet of you becomes poisoned for 1d4 hours."},
	{min: 75, max: 76, effect: "You glow with bright light in a 30-foot radius for the next minute. Any creature that ends its turn within 5 feet of you is blinded until the end of its next turn."},
	{min: 77, max: 78, effect: "You cast polymorph on yourself. If you fail the saving throw, you turn into a sheep for the spell's duration."},
	{min: 79, max: 80, effect: "Illusory butterflies and flower petals flutter in the air within 10 feet of you for the next minute."},
	{min: 81, max: 82, effect: "You can take one additional action immediately."},
	{min: 83, max: 84, effect: "Each creature within 30 feet of you takes 1d10 necrotic damage. You regain hit points equal to the sum of the necrotic damage dealt."},
	{min: 85, max: 86, effect: "You cast mirror image."},
	{min: 87, max: 88, effect: "You cast fly on a random creature within 60 feet of you."},
	{min: 89, max: 90, effect: "You become invisible for the next minute. During that time, other creatures can't hear you. The invisibility ends if you attack or cast a spell."},
	{min: 91, max: 92, effect: "If you die within the next minute, you immediately come back to life as if by the reincarnate spell."},
	{min: 93, max: 94, effect: "Your size increases by one size category for the next minute."},
	{min: 95, max: 96, effect: "You and all creatures within 30 feet of you gain vulnerability to piercing damage for the next minute."},
	{min: 97, max: 98, effect: "You are surrounded by faint, ethereal music for the next minute."},
	{min: 99, max: 100, effect: "You regain all expended sorcery points."},
];

globalThis.CharacterSheetSpells = CharacterSheetSpells;

export {CharacterSheetSpells};
