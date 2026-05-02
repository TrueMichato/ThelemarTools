/**
 * Character Sheet — Play Mode
 * Intent-based alternative UI for active D&D gameplay.
 * Organizes by what players DO (attack, cast, check) rather than data type (abilities, spells, inventory).
 *
 * This module reads from the same CharacterSheetState and delegates all rolls/actions
 * to existing CharacterSheetPage methods. It creates NO duplicate state.
 */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_NAMES = {str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA"};

const STANDARD_SKILLS = [
	{key: "acrobatics", name: "Acrobatics", ability: "dex"},
	{key: "animalhandling", name: "Animal Handling", ability: "wis"},
	{key: "arcana", name: "Arcana", ability: "int"},
	{key: "athletics", name: "Athletics", ability: "str"},
	{key: "deception", name: "Deception", ability: "cha"},
	{key: "history", name: "History", ability: "int"},
	{key: "insight", name: "Insight", ability: "wis"},
	{key: "intimidation", name: "Intimidation", ability: "cha"},
	{key: "investigation", name: "Investigation", ability: "int"},
	{key: "medicine", name: "Medicine", ability: "wis"},
	{key: "nature", name: "Nature", ability: "int"},
	{key: "perception", name: "Perception", ability: "wis"},
	{key: "performance", name: "Performance", ability: "cha"},
	{key: "persuasion", name: "Persuasion", ability: "cha"},
	{key: "religion", name: "Religion", ability: "int"},
	{key: "sleightofhand", name: "Sleight of Hand", ability: "dex"},
	{key: "stealth", name: "Stealth", ability: "dex"},
	{key: "survival", name: "Survival", ability: "wis"},
];

export class CharacterSheetPlayMode {
	constructor (page) {
		this._page = page;
		this._state = page.getState();

		// UI state (not persisted — resets on load)
		this._actionEconomy = {action: true, bonus: true, reaction: true, movement: true};
		this._expandedSections = {skills: false};
		this._openDrawer = null; // "spells" | "gear" | "reference" | "notes" | "companions" | null
		this._activityLog = []; // [{time, icon, text}]

		// DOM references (set on init)
		this._elRoot = null;
		this._elStatusBar = null;
		this._elCharPanel = null;
		this._elActionsHub = null;
		this._elDrawerBackdrop = null;
		this._elDrawer = null;
	}

	// ─── Lifecycle ──────────────────────────────────────────────

	init () {
		this._elRoot = document.getElementById("charsheet-play-mode");
		if (!this._elRoot) return;

		this._buildLayout();
		this._bindKeyboard();

		// Only render if we're currently in play mode
		if (this._state.getViewMode?.() === "play") {
			this.render();
		}
	}

	/**
	 * Full re-render — call after character load, level up, or major state change.
	 */
	render () {
		if (!this._elRoot) return;
		this._renderStatusBar();
		this._renderCharacterPanel();
		this._renderActionsHub();
	}

	/**
	 * Toggle between play mode and full sheet mode.
	 */
	toggle () {
		const container = document.querySelector(".charsheet-page");
		if (!container) return;

		const isPlay = container.classList.contains("charsheet--play-mode");
		if (isPlay) {
			container.classList.remove("charsheet--play-mode");
			this._state.setViewMode?.("full");
			this._closeDrawer();
		} else {
			container.classList.add("charsheet--play-mode");
			this._state.setViewMode?.("play");
			this.render();
		}

		this._updateToggleButton(!isPlay);
	}

	/**
	 * Activate play mode programmatically (e.g., on load if saved state is "play").
	 */
	activate () {
		const container = document.querySelector(".charsheet-page");
		if (!container) return;
		container.classList.add("charsheet--play-mode");
		this._updateToggleButton(true);
		this.render();
	}

	/**
	 * Deactivate play mode programmatically.
	 */
	deactivate () {
		const container = document.querySelector(".charsheet-page");
		if (!container) return;
		container.classList.remove("charsheet--play-mode");
		this._updateToggleButton(false);
		this._closeDrawer();
	}

	// ─── Layout Scaffold ────────────────────────────────────────

	_buildLayout () {
		this._elRoot.innerHTML = "";

		// Status bar
		this._elStatusBar = this._ce("div", "pm-status", this._elRoot);

		// Main 2-zone layout
		const main = this._ce("div", "pm-main", this._elRoot);
		this._elCharPanel = this._ce("div", "pm-character", main);
		this._elActionsHub = this._ce("div", "pm-actions", main);

		// Drawer system
		this._elDrawerBackdrop = this._ce("div", "pm-drawer-backdrop", this._elRoot);
		this._elDrawerBackdrop.addEventListener("click", () => this._closeDrawer());

		this._elDrawer = this._ce("div", "pm-drawer", this._elRoot);
	}

	// ─── Status Bar ─────────────────────────────────────────────

	_renderStatusBar () {
		if (!this._elStatusBar) return;
		this._elStatusBar.innerHTML = "";

		// Primary row: identity + vitals + tools
		const row1 = this._ce("div", "pm-status__row pm-status__row--primary", this._elStatusBar);
		this._renderIdentity(row1);
		this._renderVitals(row1);
		this._renderStatusTools(row1);

		// Secondary row: indicators
		const row2 = this._ce("div", "pm-status__row pm-status__row--secondary", this._elStatusBar);
		this._renderIndicators(row2);
	}

	_renderIdentity (parent) {
		const wrap = this._ce("div", "pm-status__identity", parent);

		// Portrait
		const portrait = this._state._data?.appearance?.portraitUrl;
		if (portrait) {
			const img = this._ce("img", "pm-status__portrait", wrap);
			img.src = portrait;
			img.alt = "Portrait";
		} else {
			const ph = this._ce("div", "pm-status__portrait-placeholder", wrap);
			ph.textContent = "👤";
		}

		// Name + class/level
		const info = this._ce("div", null, wrap);
		const name = this._ce("span", "pm-status__name", info);
		name.textContent = this._state.getName() || "Unnamed";

		const classLvl = this._ce("div", "pm-status__class-level", info);
		const classes = this._state.getClasses();
		const raceName = this._state.getRaceName();
		const totalLevel = this._state.getTotalLevel();
		const parts = [];
		if (totalLevel > 0) parts.push(`Lvl ${totalLevel}`);
		if (raceName) parts.push(raceName);
		if (classes.length) parts.push(this._state.getClassSummary());
		classLvl.textContent = parts.join(" · ");
	}

	_renderVitals (parent) {
		const wrap = this._ce("div", "pm-status__vitals", parent);

		// HP bar
		this._renderHpBar(wrap);

		// AC
		const ac = this._state.getAc();
		this._renderVitalChip(wrap, "🛡️", ac.total ?? ac, "AC", () => this._showBreakdown("ac"));

		// Initiative
		const init = this._state.getInitiativeBreakdown();
		this._renderVitalChip(wrap, "⚡", this._fmtMod(init.total), "Init", (e) => this._page._rollInitiative(e));

		// Speed
		const speed = this._state.getSpeed();
		const walkSpeed = typeof speed === "object" ? speed.walk : speed;
		this._renderVitalChip(wrap, "🏃", `${walkSpeed || 30}ft`, "Speed", () => this._showBreakdown("speed"));

		// Prof bonus
		const prof = this._state.getProficiencyBonus();
		this._renderVitalChip(wrap, "🎯", `+${prof}`, "Prof");
	}

	_renderHpBar (parent) {
		const hpWrap = this._ce("div", "pm-status__hp", parent);

		const hpInfo = this._state.getHp();
		const current = hpInfo.current;
		const max = hpInfo.max;
		const temp = hpInfo.temp;
		const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;

		const bar = this._ce("div", "pm-status__hp-bar", hpWrap);

		const fill = this._ce("div", "pm-status__hp-fill", bar);
		fill.style.width = `${pct}%`;
		if (pct <= 25) fill.classList.add("pm-status__hp-fill--critical");
		else if (pct <= 50) fill.classList.add("pm-status__hp-fill--bloodied");

		if (temp > 0) {
			const tempBar = this._ce("div", "pm-status__hp-temp", bar);
			const tempPct = max > 0 ? Math.min(100, (temp / max) * 100) : 0;
			tempBar.style.width = `${tempPct}%`;
		}

		const text = this._ce("span", "pm-status__hp-text", bar);
		text.textContent = temp > 0 ? `${current}+${temp}/${max}` : `${current}/${max}`;

		// Heal/Damage buttons
		const btns = this._ce("div", "pm-status__hp-btns", hpWrap);

		const healBtn = this._ce("button", "pm-status__hp-btn pm-status__hp-btn--heal", btns);
		healBtn.textContent = "+";
		healBtn.title = "Heal";
		healBtn.addEventListener("click", () => this._promptHpChange("heal"));

		const dmgBtn = this._ce("button", "pm-status__hp-btn pm-status__hp-btn--damage", btns);
		dmgBtn.textContent = "−";
		dmgBtn.title = "Take Damage";
		dmgBtn.addEventListener("click", () => this._promptHpChange("damage"));
	}

	_renderVitalChip (parent, icon, value, label, onClick) {
		const chip = this._ce("div", "pm-status__vital", parent);
		const elIcon = this._ce("span", "pm-status__vital-icon", chip);
		elIcon.textContent = icon;
		const elVal = this._ce("span", "pm-status__vital-value", chip);
		elVal.textContent = value;
		const elLabel = this._ce("span", "pm-status__vital-label", chip);
		elLabel.textContent = label;
		if (onClick) {
			chip.style.cursor = "pointer";
			this._makeClickable(chip, `Roll ${label}`, onClick);
		}
	}

	_renderStatusTools (parent) {
		const tools = this._ce("div", "pm-status__tools", parent);

		// Rest buttons
		this._makeToolBtn(tools, "🏕️ Short Rest", () => this._page._rest?.doShortRest?.());
		this._makeToolBtn(tools, "🛏️ Long Rest", () => this._page._rest?.doLongRest?.());

		this._ce("div", "pm-status__divider", tools);

		// Drawers
		this._makeToolBtn(tools, "📖 Spells", () => this._openDrawerByType("spells"));
		this._makeToolBtn(tools, "🎒 Gear", () => this._openDrawerByType("gear"));
		this._makeToolBtn(tools, "📜 Reference", () => this._openDrawerByType("reference"));
		this._makeToolBtn(tools, "📝 Notes", () => this._openDrawerByType("notes"));

		this._ce("div", "pm-status__divider", tools);

		// Full sheet toggle
		const fullBtn = this._makeToolBtn(tools, "📊 Full Sheet", () => this.toggle());
		fullBtn.classList.add("pm-status__tool-btn--primary");
	}

	_renderIndicators (parent) {
		// Inspiration
		const inspired = this._state.hasInspiration();
		const inspBtn = this._ce("span", `pm-status__indicator pm-status__indicator--inspiration${inspired ? " active" : ""}`, parent);
		inspBtn.textContent = `⭐ ${inspired ? "Inspired" : "Inspiration"}`;
		inspBtn.setAttribute("aria-pressed", inspired ? "true" : "false");
		this._makeClickable(inspBtn, `Toggle inspiration (${inspired ? "active" : "inactive"})`, () => {
			this._state.toggleInspiration();
			this._renderStatusBar();
			this._logActivity("⭐", inspired ? "Lost inspiration" : "Gained inspiration");
		});

		// Concentration
		const activeStates = this._state.getActiveStates();
		const concentrating = activeStates.find(s => s.type === "concentration" && s.active);
		if (concentrating) {
			const conc = this._ce("span", "pm-status__indicator pm-status__indicator--concentration", parent);
			conc.textContent = `🔮 Concentrating: ${concentrating.name || "Spell"}`;
			this._makeClickable(conc, `End concentration on ${concentrating.name || "spell"}`, () => {
				if (confirm(`End concentration on ${concentrating.name || "spell"}?`)) {
					this._state.setActiveState(concentrating.id, false);
					this._renderStatusBar();
					this._logActivity("🔮", `Dropped concentration on ${concentrating.name}`);
				}
			});
		}

		// Conditions
		const conditions = this._state.getConditions();
		conditions.forEach(cond => {
			const condName = cond.name || cond;
			const el = this._ce("span", "pm-status__indicator pm-status__indicator--condition", parent);

			// Check if condition has duration from active states
			const activeStates = this._state.getActiveStates();
			const linkedState = activeStates.find(s => s.active && s.grantsConditions?.includes(condName));
			const roundsLeft = linkedState?.roundsRemaining;

			let labelText = `⚠️ ${condName}`;
			if (roundsLeft != null && roundsLeft > 0) {
				const durSpan = document.createElement("span");
				durSpan.className = "pm-status__indicator-duration";
				durSpan.textContent = `${roundsLeft}r`;
				el.textContent = labelText + " ";
				el.appendChild(durSpan);
				if (roundsLeft <= 1) el.classList.add("pm-status__indicator--expiring");
			} else {
				el.textContent = labelText;
			}

			this._makeClickable(el, `Remove condition: ${condName}`, () => {
				this._state.removeCondition?.(condName);
				this._renderStatusBar();
				this._logActivity("⚠️", `Removed condition: ${condName}`);
			});
		});

		// Exhaustion
		const exhaustion = this._state._data?.exhaustion || 0;
		if (exhaustion > 0) {
			const exh = this._ce("span", "pm-status__indicator pm-status__indicator--exhaustion", parent);
			exh.textContent = `😫 Exhaustion ${exhaustion}`;
		}

		// Combat Round Tracker
		this._renderCombatTracker(parent);
	}

	_renderCombatTracker (parent) {
		const inCombat = this._state._data?.inCombat;
		const combatRound = this._state._data?.combatRound || 0;

		const tracker = this._ce("div", "pm-combat-tracker", parent);

		if (inCombat) {
			const roundLabel = this._ce("span", "pm-combat-tracker__round", tracker);
			roundLabel.textContent = `⚔️ Round ${combatRound}`;

			const nextBtn = this._ce("button", "pm-combat-tracker__btn pm-combat-tracker__btn--next", tracker);
			nextBtn.textContent = "Next Round ▸";
			nextBtn.setAttribute("aria-label", `Advance to round ${combatRound + 1}`);
			nextBtn.addEventListener("click", () => {
				const expired = this._state.advanceRound?.() || [];
				if (expired.length > 0) {
					const names = expired.map(e => e.name || "Effect").join(", ");
					JqueryUtil.doToast({type: "info", content: `Expired: ${names}`});
					this._logActivity("⏱️", `Round ${combatRound + 1} — expired: ${names}`);
				} else {
					this._logActivity("⏱️", `Round ${combatRound + 1}`);
				}
				this._renderStatusBar();
			});

			const endBtn = this._ce("button", "pm-combat-tracker__btn pm-combat-tracker__btn--end", tracker);
			endBtn.textContent = "End Combat";
			endBtn.setAttribute("aria-label", "End combat encounter");
			endBtn.addEventListener("click", () => {
				this._state.endCombat?.();
				this._logActivity("🏁", "Combat ended");
				this._renderStatusBar();
			});
		} else {
			const startBtn = this._ce("button", "pm-combat-tracker__btn pm-combat-tracker__btn--start", tracker);
			startBtn.textContent = "⚔️ Start Combat";
			startBtn.setAttribute("aria-label", "Start combat encounter");
			startBtn.addEventListener("click", () => {
				this._state.startCombat?.();
				this._logActivity("⚔️", "Combat started");
				this._renderStatusBar();
			});
		}
	}

	// ─── Character Panel (Left Sidebar) ─────────────────────────

	_renderCharacterPanel () {
		if (!this._elCharPanel) return;
		this._elCharPanel.innerHTML = "";

		this._renderAbilities();
		this._renderSaves();
		this._renderPassives();
		this._renderSkills();
		this._renderProficiencies();
	}

	_renderAbilities () {
		const card = this._makeCard(this._elCharPanel, "💪", "Abilities");
		const grid = this._ce("div", "pm-abilities", card);

		ABILITIES.forEach(abl => {
			const score = this._state.getAbilityScore(abl);
			const mod = this._state.getAbilityMod(abl);

			const row = this._ce("div", "pm-ability", grid);
			const elName = this._ce("span", "pm-ability__name", row);
			elName.textContent = ABILITY_NAMES[abl];
			const elScore = this._ce("span", "pm-ability__score", row);
			elScore.textContent = score;
			const elMod = this._ce("span", "pm-ability__mod", row);
			elMod.textContent = this._fmtMod(mod);

			this._makeClickable(row, `Roll ${ABILITY_NAMES[abl]} check`, (e) => this._page._rollAbilityCheck(abl, e));
		});
	}

	_renderSaves () {
		const saveProficiencies = this._state.getSaveProficiencies();
		const card = this._makeCard(this._elCharPanel, "🛡️", "Saves");
		const grid = this._ce("div", "pm-saves", card);

		ABILITIES.forEach(abl => {
			const mod = this._state.getSaveMod(abl);
			const proficient = saveProficiencies.includes(abl);

			const row = this._ce("div", `pm-save${proficient ? " pm-save--proficient" : ""}`, grid);
			const dot = this._ce("span", "pm-save__prof-dot", row);
			dot.title = proficient ? "Proficient" : "Not proficient";
			const elName = this._ce("span", "pm-save__name", row);
			elName.textContent = ABILITY_NAMES[abl];
			const elMod = this._ce("span", "pm-save__mod", row);
			elMod.textContent = this._fmtMod(mod);

			this._makeClickable(row, `Roll ${ABILITY_NAMES[abl]} saving throw`, (e) => this._page._rollSavingThrow(abl, e));
		});
	}

	_renderPassives () {
		const card = this._makeCard(this._elCharPanel, "👁️", "Passives");
		const row = this._ce("div", "pm-passives", card);

		const passives = [
			{icon: "👁️", label: "Perc", value: this._state.getPassivePerception()},
			{icon: "🔍", label: "Inv", value: this._state.getPassiveInvestigation()},
			{icon: "🧠", label: "Ins", value: this._state.getPassiveInsight()},
		];

		passives.forEach(p => {
			const cell = this._ce("div", "pm-passive", row);
			const elIcon = this._ce("span", "pm-passive__icon", cell);
			elIcon.textContent = p.icon;
			const elVal = this._ce("span", "pm-passive__value", cell);
			elVal.textContent = p.value;
			const elLabel = this._ce("span", "pm-passive__label", cell);
			elLabel.textContent = p.label;
		});
	}

	_renderSkills () {
		const card = this._makeCard(this._elCharPanel, "📋", "Skills");
		const list = this._ce("div", "pm-skills__list", card);

		// Build skill list from the page's skills data
		const skillsList = this._page.getSkillsList?.() || STANDARD_SKILLS;
		const expanded = this._expandedSections.skills;

		// Separate proficient vs non-proficient
		const proficient = [];
		const nonProficient = [];
		skillsList.forEach(skill => {
			const key = skill.key || skill.name.toLowerCase().replace(/\s+/g, "");
			const profLevel = this._state.getSkillProficiency(key);
			if (profLevel >= 1) {
				proficient.push({...skill, key, profLevel});
			} else {
				nonProficient.push({...skill, key, profLevel: 0});
			}
		});

		// Always show proficient skills
		proficient.forEach(s => this._renderSkillRow(list, s));

		// Show non-proficient only when expanded
		if (expanded) {
			nonProficient.forEach(s => this._renderSkillRow(list, s));
		}

		// Expander
		if (nonProficient.length > 0) {
			const expander = this._ce("div", `pm-expander${expanded ? " pm-expander--open" : ""}`, card);
			const arrow = this._ce("span", "pm-expander__arrow", expander);
			arrow.textContent = "▾";
			const txt = document.createTextNode(expanded ? " Hide non-proficient" : ` Show all ${proficient.length + nonProficient.length} skills`);
			expander.appendChild(txt);
			this._makeClickable(expander, expanded ? "Hide non-proficient skills" : "Show all skills", () => {
				this._expandedSections.skills = !this._expandedSections.skills;
				this._renderSkills();
			});
		}
	}

	_renderSkillRow (parent, skill) {
		const mod = this._state.getSkillMod(skill.key);
		const ability = skill.ability || this._state.getSkillAbility?.(skill.key) || "";

		let cls = "pm-skill";
		if (skill.profLevel >= 2) cls += " pm-skill--expertise";
		else if (skill.profLevel >= 1) cls += " pm-skill--proficient";

		const row = this._ce("div", cls, parent);
		this._ce("span", "pm-skill__prof-dot", row);
		const elName = this._ce("span", "pm-skill__name", row);
		elName.textContent = skill.name;
		const elAbility = this._ce("span", "pm-skill__ability", row);
		elAbility.textContent = ability.toUpperCase?.() || "";
		const elMod = this._ce("span", "pm-skill__mod", row);
		elMod.textContent = this._fmtMod(mod);

		this._makeClickable(row, `Roll ${skill.name} (${ability.toUpperCase?.() || "?"})`, (e) => this._page._rollSkillCheck(skill.key, skill.name, e));
	}

	_renderProficiencies () {
		const profs = this._state.getProficiencies();
		const card = this._makeCard(this._elCharPanel, "🔰", "Proficiencies");
		const list = this._ce("div", "pm-profs__list", card);

		const entries = [
			{label: "Armor", value: profs.armor},
			{label: "Weapon", value: profs.weapons},
			{label: "Tools", value: profs.tools},
			{label: "Lang", value: profs.languages},
		];

		entries.forEach(e => {
			if (!e.value?.length) return;
			const row = this._ce("div", "pm-prof", list);
			const lbl = this._ce("span", "pm-prof__label", row);
			lbl.textContent = e.label;
			const val = this._ce("span", "pm-prof__value", row);
			val.textContent = e.value.map(v => typeof v === "string" ? v : v.name).join(", ");
		});
	}

	// ─── Actions Hub (Main Content) ─────────────────────────────

	_renderActionsHub () {
		if (!this._elActionsHub) return;
		this._elActionsHub.innerHTML = "";

		this._renderFavoritesBar();
		this._renderActionEconomy();
		this._renderAttacks();
		this._renderSpellsQuick();
		this._renderFeaturesQuick();
		this._renderResources();
	}

	_renderFavoritesBar () {
		const favorites = this._state._data?.favorites || [];
		const card = this._makeCard(this._elActionsHub, "⭐", "Favorites");

		if (!favorites.length) {
			const empty = this._ce("div", "pm-favorites pm-favorites--empty", card);
			empty.textContent = "⭐ Star attacks, spells, or abilities to pin them here";
			return;
		}

		const bar = this._ce("div", "pm-favorites", card);
		favorites.forEach(fav => {
			const el = this._ce("div", "pm-favorite", bar);
			const icon = this._ce("span", "pm-favorite__icon", el);
			icon.textContent = fav.icon || "⚡";
			const name = this._ce("span", "pm-favorite__name", el);
			name.textContent = fav.name;
			if (fav.detail) {
				const detail = this._ce("span", "pm-favorite__detail", el);
				detail.textContent = fav.detail;
			}

			this._makeClickable(el, `Use favorite: ${fav.name}`, () => this._useFavorite(fav));

			// Right-click to remove
			el.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this._removeFavorite(fav.id);
			});
		});
	}

	_renderActionEconomy () {
		const card = this._makeCard(this._elActionsHub, "⏱️", "Your Turn");
		const row = this._ce("div", "pm-economy", card);

		const slots = [
			{key: "action", label: "Action", icon: "⚔️"},
			{key: "bonus", label: "Bonus", icon: "⚡"},
			{key: "reaction", label: "Reaction", icon: "🔄"},
		];

		slots.forEach(slot => {
			const avail = this._actionEconomy[slot.key];
			const el = this._ce("div", `pm-economy__slot pm-economy__slot--${avail ? "available" : "used"}`, row);
			el.textContent = `${slot.icon} ${slot.label}`;
			this._makeClickable(el, `${avail ? "Use" : "Restore"} ${slot.label}`, () => {
				this._actionEconomy[slot.key] = !this._actionEconomy[slot.key];
				this._renderActionEconomy();
			});
		});

		// Movement
		const speed = this._state.getSpeed();
		const walkSpeed = typeof speed === "object" ? speed.walk : speed;
		const mvEl = this._ce("div", `pm-economy__slot pm-economy__slot--${this._actionEconomy.movement ? "available" : "used"}`, row);
		mvEl.textContent = `🏃 ${walkSpeed || 30}ft`;
		this._makeClickable(mvEl, `${this._actionEconomy.movement ? "Use" : "Restore"} Movement`, () => {
			this._actionEconomy.movement = !this._actionEconomy.movement;
			this._renderActionEconomy();
		});

		// Reset
		const reset = this._ce("span", "pm-economy__reset", row);
		reset.textContent = "↺ Reset turn";
		this._makeClickable(reset, "Reset turn (restore all actions)", () => {
			this._actionEconomy = {action: true, bonus: true, reaction: true, movement: true};
			this._renderActionEconomy();
			this._logActivity("⏱️", "New turn started");
		});
	}

	_renderAttacks () {
		// Get all attacks (configured + auto from equipped weapons)
		let attacks = [...this._state.getAttacks()];

		// Add equipped weapon auto-attacks
		const items = this._state.getItems();
		const equippedWeapons = items.filter(i => i.weapon && i.equipped);
		equippedWeapons.forEach(weapon => {
			if (attacks.find(a => a.name === weapon.name)) return;

			const props = weapon.property || weapon.properties || [];
			const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith?.("A|") || p.startsWith?.("T|"));
			const hasFinesse = props.some(p => p === "F" || p.startsWith?.("F|"));
			const abilityMod = isRanged ? "dex" : ((hasFinesse && this._state.getAbilityMod("dex") >= this._state.getAbilityMod("str")) ? "dex" : "str");
			const attackBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
			const damageBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);
			const baseDamageDie = weapon.dmg1 || "1d6";
			const baseDamageType = weapon.dmgType ? Parser.dmgTypeToFull?.(weapon.dmgType) : "slashing";

			attacks.push({
				id: `auto_${weapon.id}`,
				name: weapon.name,
				source: weapon.source,
				isMelee: !isRanged,
				abilityMod,
				attackBonus,
				damage: baseDamageDie,
				damageType: baseDamageType,
				damageBonus,
				range: weapon.range || (isRanged ? "80/320 ft." : "5 ft."),
			});
		});

		if (!attacks.length) return;

		const card = this._makeCard(this._elActionsHub, "⚔️", "Attacks");

		attacks.forEach(attack => {
			const abilityMod = this._state.getAbilityMod(attack.abilityMod || "str");
			const profBonus = this._state.getProficiencyBonus();
			const totalBonus = abilityMod + profBonus + (attack.attackBonus || 0);
			const totalDmgBonus = abilityMod + (attack.damageBonus || 0);
			const dmgStr = totalDmgBonus >= 0 ? `${attack.damage}+${totalDmgBonus}` : `${attack.damage}${totalDmgBonus}`;

			const row = this._ce("div", "pm-attack", card);

			const icon = this._ce("span", "pm-attack__icon", row);
			icon.textContent = attack.isMelee ? "🗡️" : "🏹";
			const name = this._ce("span", "pm-attack__name", row);
			name.textContent = attack.name;
			const bonus = this._ce("span", "pm-attack__bonus", row);
			bonus.textContent = this._fmtMod(totalBonus);
			const dmg = this._ce("span", "pm-attack__damage", row);
			dmg.textContent = dmgStr;
			const type = this._ce("span", "pm-attack__type", row);
			type.textContent = attack.damageType || "";

			// Star for favorites
			const star = this._ce("span", "pm-attack__star", row);
			const isFav = this._isFavorite("attack", attack.id || attack.name);
			star.textContent = "⭐";
			if (isFav) star.classList.add("pm-attack__star--active");
			this._makeClickable(star, `${isFav ? "Remove" : "Add"} ${attack.name} favorite`, (e) => {
				e.stopPropagation();
				this._toggleFavorite({
					id: `attack:${attack.id || attack.name}`,
					type: "attack",
					name: attack.name,
					icon: attack.isMelee ? "🗡️" : "🏹",
					detail: this._fmtMod(totalBonus),
					ref: attack,
				});
			});

			row.addEventListener("click", () => {
				this._page._rollAttack(attack);
				this._logActivity(attack.isMelee ? "🗡️" : "🏹", `Attacked with ${attack.name}`);
			});
			row.setAttribute("role", "button");
			row.setAttribute("tabindex", "0");
			row.setAttribute("aria-label", `Roll attack: ${attack.name}, ${this._fmtMod(totalBonus)} to hit, ${dmgStr} damage`);
			row.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this._page._rollAttack(attack);
					this._logActivity(attack.isMelee ? "🗡️" : "🏹", `Attacked with ${attack.name}`);
				}
			});
		});
	}

	_renderSpellsQuick () {
		const spells = this._state.getSpells();
		if (!spells.length) return;

		const card = this._makeCard(this._elActionsHub, "✨", "Spells");

		// Spell slot pips
		const slotData = this._state._data?.spellcasting?.spellSlots || {};
		const hasSlots = Object.keys(slotData).some(k => (slotData[k]?.max || 0) > 0);
		if (hasSlots) {
			const slotsRow = this._ce("div", "pm-slots", card);
			for (let lvl = 1; lvl <= 9; lvl++) {
				const slot = slotData[lvl];
				if (!slot || slot.max <= 0) continue;

				const levelWrap = this._ce("div", "pm-slots__level", slotsRow);
				const label = this._ce("span", "pm-slots__label", levelWrap);
				label.textContent = `${lvl}`;
				const pips = this._ce("div", "pm-slots__pips", levelWrap);

				for (let i = 0; i < slot.max; i++) {
					const pip = this._ce("span", `pm-slots__pip pm-slots__pip--${i < slot.current ? "filled" : "empty"}`, pips);
					this._makeClickable(pip, `Level ${lvl} spell slot ${i + 1} (${i < slot.current ? "use" : "restore"})`, () => {
						if (i < slot.current) {
							this._state._data.spellcasting.spellSlots[lvl].current--;
						} else {
							this._state._data.spellcasting.spellSlots[lvl].current = Math.min(slot.max, slot.current + 1);
						}
						this._renderSpellsQuick();
					});
				}
			}
		}

		// Cantrips
		const cantrips = spells.filter(s => s.level === 0);
		if (cantrips.length) {
			const cantripHeader = this._ce("div", "pm-card__header", card);
			const cantripTitle = this._ce("span", "pm-card__badge", cantripHeader);
			cantripTitle.textContent = `Cantrips (${cantrips.length})`;

			cantrips.slice(0, 8).forEach(spell => this._renderSpellRow(card, spell));
		}

		// Prepared / known spells
		const prepared = spells.filter(s => s.level > 0 && (s.prepared || s.alwaysPrepared));
		if (prepared.length) {
			const prepHeader = this._ce("div", "pm-card__header", card);
			const prepTitle = this._ce("span", "pm-card__badge", prepHeader);
			prepTitle.textContent = `Prepared (${prepared.length})`;

			prepared.slice(0, 10).forEach(spell => this._renderSpellRow(card, spell));

			if (prepared.length > 10) {
				const more = this._ce("div", "pm-expander", card);
				more.textContent = `▸ Show all ${prepared.length} prepared...`;
				this._makeClickable(more, `Show all ${prepared.length} prepared spells`, () => this._openDrawerByType("spells"));
			}
		}
	}

	_renderSpellRow (parent, spell) {
		const row = this._ce("div", "pm-spell", parent);
		const name = this._ce("span", "pm-spell__name", row);
		name.textContent = spell.name;

		const lvl = this._ce("span", "pm-spell__level", row);
		lvl.textContent = spell.level === 0 ? "C" : `L${spell.level}`;

		const meta = this._ce("span", "pm-spell__meta", row);
		const parts = [];
		if (spell.school) parts.push(spell.school);
		if (spell.concentration) parts.push("conc.");
		meta.textContent = parts.join(" · ");

		if (spell.level > 0) {
			const castBtn = this._ce("button", "pm-spell__cast", row);
			castBtn.textContent = "Cast";
			castBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._castSpell(spell);
			});
		}

		// Star for favorites
		const star = this._ce("span", "pm-spell__star", row);
		const isFav = this._isFavorite("spell", spell.name);
		star.textContent = "⭐";
		if (isFav) star.classList.add("pm-spell__star--active");
		this._makeClickable(star, `${isFav ? "Remove" : "Add"} ${spell.name} favorite`, (e) => {
			e.stopPropagation();
			this._toggleFavorite({
				id: `spell:${spell.name}`,
				type: "spell",
				name: spell.name,
				icon: "✨",
				detail: spell.level === 0 ? "Cantrip" : `Level ${spell.level}`,
				ref: spell,
			});
		});
	}

	_renderFeaturesQuick () {
		const features = this._state.getFeatures();
		// Show features that have limited uses (actionable ones)
		const actionable = features.filter(f => f.uses && f.uses.max > 0);
		if (!actionable.length) return;

		const card = this._makeCard(this._elActionsHub, "⚡", "Abilities & Features");

		actionable.slice(0, 12).forEach(feature => {
			const row = this._ce("div", "pm-feature", card);

			// Use pips
			if (feature.uses && feature.uses.max > 0 && feature.uses.max <= 10) {
				const pips = this._ce("div", "pm-feature__pips", row);
				for (let i = 0; i < feature.uses.max; i++) {
					const pip = this._ce("span", `pm-feature__pip pm-feature__pip--${i < feature.uses.current ? "filled" : "empty"}`, pips);
					this._makeClickable(pip, `${feature.name} use ${i + 1} (${i < feature.uses.current ? "expend" : "restore"})`, (e) => {
						e.stopPropagation();
						if (i < feature.uses.current) {
							feature.uses.current--;
						} else {
							feature.uses.current = Math.min(feature.uses.max, feature.uses.current + 1);
						}
						this._renderFeaturesQuick();
					});
				}
			}

			const name = this._ce("span", "pm-feature__name", row);
			name.textContent = feature.name;

			// Use button
			if (feature.uses?.current > 0) {
				const useBtn = this._ce("button", "pm-feature__use-btn", row);
				useBtn.textContent = "Use";
				useBtn.setAttribute("aria-label", `Use ${feature.name} (${feature.uses.current} remaining)`);
				useBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (feature.uses.current > 0) {
						feature.uses.current--;
						this._renderFeaturesQuick();
						this._logActivity("⚡", `Used ${feature.name}`);
					}
				});
			} else if (feature.uses?.max > 0) {
				const useBtn = this._ce("button", "pm-feature__use-btn pm-feature__use-btn--disabled", row);
				useBtn.textContent = "Used";
			}

			// Star for favorites
			const star = this._ce("span", "pm-feature__star", row);
			const isFav = this._isFavorite("feature", feature.id || feature.name);
			star.textContent = "⭐";
			if (isFav) star.classList.add("pm-feature__star--active");
			this._makeClickable(star, `${isFav ? "Remove" : "Add"} ${feature.name} favorite`, (e) => {
				e.stopPropagation();
				this._toggleFavorite({
					id: `feature:${feature.id || feature.name}`,
					type: "feature",
					name: feature.name,
					icon: "⚡",
					detail: `${feature.uses?.current ?? "∞"}/${feature.uses?.max ?? "∞"}`,
					ref: feature,
				});
			});
		});

		if (actionable.length > 12) {
			const more = this._ce("div", "pm-expander", card);
			more.textContent = `▸ Show all ${actionable.length} features...`;
			this._makeClickable(more, `Show all ${actionable.length} features`, () => this._openDrawerByType("reference"));
		}
	}

	_renderResources () {
		const hitDice = this._state.getHitDice();
		const resources = this._state.getResources();
		if (!Object.keys(hitDice).length && !resources.length) return;

		const card = this._makeCard(this._elActionsHub, "🎲", "Resources");
		const list = this._ce("div", "pm-resources", card);

		// Hit dice
		Object.entries(hitDice).forEach(([die, data]) => {
			if (!data || data.max <= 0) return;
			const row = this._ce("div", "pm-resource", list);
			const name = this._ce("span", "pm-resource__name", row);
			name.textContent = `Hit Dice (${die})`;
			const pips = this._ce("div", "pm-resource__pips", row);

			for (let i = 0; i < data.max; i++) {
				const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < data.current ? "filled" : "empty"}`, pips);
				this._makeClickable(pip, `Hit Die ${die} ${i + 1} (${i < data.current ? "use" : "restore"})`, () => {
					if (i < data.current) {
						this._state._data.hitDice[die].current--;
					} else {
						this._state._data.hitDice[die].current = Math.min(data.max, data.current + 1);
					}
					this._renderResources();
				});
			}
		});

		// Class resources
		resources.forEach(res => {
			if (!res.max || res.max <= 0) return;
			const row = this._ce("div", "pm-resource", list);
			const name = this._ce("span", "pm-resource__name", row);
			name.textContent = res.name;

			if (res.max <= 20) {
				const pips = this._ce("div", "pm-resource__pips", row);
				for (let i = 0; i < res.max; i++) {
					const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < res.current ? "filled" : "empty"}`, pips);
					this._makeClickable(pip, `${res.name} use ${i + 1} (${i < res.current ? "expend" : "restore"})`, () => {
						if (i < res.current) res.current--;
						else res.current = Math.min(res.max, res.current + 1);
						this._renderResources();
					});
				}
			} else {
				const text = this._ce("span", "pm-resource__text", row);
				text.textContent = `${res.current}/${res.max}`;
			}
		});
	}

	// ─── Drawer System ──────────────────────────────────────────

	_openDrawerByType (type) {
		if (this._openDrawer === type) {
			this._closeDrawer();
			return;
		}
		this._openDrawer = type;

		const drawerTitles = {
			spells: "📖 Spell Book",
			gear: "🎒 Inventory",
			reference: "📜 Features & Reference",
			notes: "📝 Notes",
			companions: "🐾 Companions",
		};

		this._elDrawerBackdrop.classList.add("pm-drawer-backdrop--open");
		this._elDrawer.classList.add("pm-drawer--open");
		this._elDrawer.setAttribute("role", "dialog");
		this._elDrawer.setAttribute("aria-modal", "true");

		this._elDrawer.innerHTML = "";

		// Header
		const header = this._ce("div", "pm-drawer__header", this._elDrawer);
		const titleId = `pm-drawer-title-${type}`;
		const title = this._ce("span", "pm-drawer__title", header);
		title.id = titleId;
		title.textContent = drawerTitles[type] || type;
		this._elDrawer.setAttribute("aria-labelledby", titleId);
		const closeBtn = this._ce("button", "pm-drawer__close", header);
		closeBtn.textContent = "✕";
		closeBtn.setAttribute("aria-label", "Close drawer");
		closeBtn.addEventListener("click", () => this._closeDrawer());
		closeBtn.focus();

		// Content
		const content = this._ce("div", "pm-drawer__content", this._elDrawer);
		this._renderDrawerContent(type, content);
	}

	_closeDrawer () {
		this._openDrawer = null;
		this._elDrawerBackdrop?.classList.remove("pm-drawer-backdrop--open");
		this._elDrawer?.classList.remove("pm-drawer--open");
		this._elDrawer?.removeAttribute("role");
		this._elDrawer?.removeAttribute("aria-modal");
		this._elDrawer?.removeAttribute("aria-labelledby");
	}

	_renderDrawerContent (type, container) {
		switch (type) {
			case "spells": this._renderSpellsDrawer(container); break;
			case "gear": this._renderGearDrawer(container); break;
			case "reference": this._renderReferenceDrawer(container); break;
			case "notes": this._renderNotesDrawer(container); break;
			case "companions": this._renderCompanionsDrawer(container); break;
		}
	}

	_renderSpellsDrawer (container) {
		const spells = this._state.getSpells();
		if (!spells.length) {
			container.innerHTML = `<div class="pm-empty"><span class="pm-empty__icon">✨</span>No spells known. Add spells from the Spells tab.</div>`;
			return;
		}

		// Group by level
		const byLevel = {};
		spells.forEach(s => {
			const lvl = s.level ?? 0;
			(byLevel[lvl] = byLevel[lvl] || []).push(s);
		});

		Object.keys(byLevel).sort((a, b) => a - b).forEach(lvl => {
			const header = this._ce("div", "pm-card__header", container);
			const title = this._ce("span", "pm-card__title", header);
			title.textContent = lvl === "0" ? "Cantrips" : `Level ${lvl}`;
			const badge = this._ce("span", "pm-card__badge", header);
			badge.textContent = `${byLevel[lvl].length}`;

			byLevel[lvl].forEach(spell => this._renderSpellRow(container, spell));
		});
	}

	_renderGearDrawer (container) {
		const items = this._state.getItems();

		// Currency
		const currency = this._state._data?.currency || {};
		const coins = ["cp", "sp", "ep", "gp", "pp"].filter(c => currency[c] > 0);
		if (coins.length) {
			const currCard = this._makeCard(container, "💰", "Currency");
			const currRow = this._ce("div", "pm-passives", currCard);
			coins.forEach(c => {
				const cell = this._ce("div", "pm-passive", currRow);
				const val = this._ce("span", "pm-passive__value", cell);
				val.textContent = currency[c];
				const lbl = this._ce("span", "pm-passive__label", cell);
				lbl.textContent = c.toUpperCase();
			});
		}

		// Equipped items
		const equipped = items.filter(i => i.equipped);
		if (equipped.length) {
			const eqCard = this._makeCard(container, "⚔️", "Equipped");
			equipped.forEach(item => {
				const row = this._ce("div", "pm-attack", eqCard);
				const name = this._ce("span", "pm-attack__name", row);
				name.textContent = item.name;
				if (item.quantity > 1) {
					const qty = this._ce("span", "pm-attack__type", row);
					qty.textContent = `×${item.quantity}`;
				}
			});
		}

		// All items
		if (items.length) {
			const allCard = this._makeCard(container, "🎒", `All Items (${items.length})`);
			items.slice(0, 50).forEach(item => {
				const row = this._ce("div", "pm-skill", allCard);
				const name = this._ce("span", "pm-skill__name", row);
				name.textContent = item.name;
				if (item.quantity > 1) {
					const qty = this._ce("span", "pm-skill__mod", row);
					qty.textContent = `×${item.quantity}`;
				}
			});
		} else {
			container.innerHTML += `<div class="pm-empty"><span class="pm-empty__icon">🎒</span>No items. Add items from the Inventory tab.</div>`;
		}
	}

	_renderReferenceDrawer (container) {
		const features = this._state.getFeatures();
		if (!features.length) {
			container.innerHTML = `<div class="pm-empty"><span class="pm-empty__icon">📜</span>No features yet.</div>`;
			return;
		}

		// Group by source (class, race, background, feat)
		const grouped = {};
		features.forEach(f => {
			const src = f.source || f.sourceClass || "Other";
			(grouped[src] = grouped[src] || []).push(f);
		});

		Object.entries(grouped).forEach(([source, feats]) => {
			const card = this._makeCard(container, "📜", source);
			feats.forEach(f => {
				const row = this._ce("div", "pm-feature", card);
				const name = this._ce("span", "pm-feature__name", row);
				name.textContent = f.name;
				if (f.uses?.max > 0) {
					const uses = this._ce("span", "pm-card__badge", row);
					uses.textContent = `${f.uses.current}/${f.uses.max}`;
				}
			});
		});
	}

	_renderNotesDrawer (container) {
		const notes = this._state._data?.notes || {};
		const entries = [
			{label: "Personality", value: notes.personality},
			{label: "Ideals", value: notes.ideals},
			{label: "Bonds", value: notes.bonds},
			{label: "Flaws", value: notes.flaws},
			{label: "Backstory", value: notes.backstory},
			{label: "Additional Notes", value: notes.additional},
		];

		entries.forEach(e => {
			if (!e.value) return;
			const card = this._makeCard(container, "📝", e.label);
			const text = this._ce("div", null, card);
			text.style.whiteSpace = "pre-wrap";
			text.style.fontSize = "var(--cs-text-sm, 0.875rem)";
			text.style.color = "var(--cs-text-secondary, #94a3b8)";
			text.textContent = e.value;
		});

		if (!entries.some(e => e.value)) {
			container.innerHTML = `<div class="pm-empty"><span class="pm-empty__icon">📝</span>No notes. Add notes from the Notes tab.</div>`;
		}
	}

	_renderCompanionsDrawer (container) {
		const companions = this._state._data?.companions || [];
		if (!companions.length) {
			container.innerHTML = `<div class="pm-empty"><span class="pm-empty__icon">🐾</span>No companions. Add from the Companions tab.</div>`;
			return;
		}

		companions.forEach(comp => {
			const card = this._makeCard(container, "🐾", comp.name || "Companion");
			const text = this._ce("div", null, card);
			text.style.fontSize = "var(--cs-text-sm, 0.875rem)";
			text.style.color = "var(--cs-text-secondary, #94a3b8)";
			text.textContent = comp.type || "";
		});
	}

	// ─── Favorites System ───────────────────────────────────────

	_isFavorite (type, id) {
		const favorites = this._state._data?.favorites || [];
		return favorites.some(f => f.id === `${type}:${id}`);
	}

	_toggleFavorite (favData) {
		if (!this._state._data.favorites) this._state._data.favorites = [];
		const idx = this._state._data.favorites.findIndex(f => f.id === favData.id);
		if (idx >= 0) {
			this._state._data.favorites.splice(idx, 1);
		} else {
			if (this._state._data.favorites.length >= 8) {
				JqueryUtil?.doToast?.({type: "warning", content: "Maximum 8 favorites. Remove one first."});
				return;
			}
			this._state._data.favorites.push(favData);
		}
		this._renderFavoritesBar();
		// Also re-render the section that contains the star to update its state
		this._renderAttacks();
		this._renderSpellsQuick();
		this._renderFeaturesQuick();
	}

	_removeFavorite (id) {
		if (!this._state._data.favorites) return;
		const idx = this._state._data.favorites.findIndex(f => f.id === id);
		if (idx >= 0) {
			this._state._data.favorites.splice(idx, 1);
			this.render();
		}
	}

	_useFavorite (fav) {
		if (fav.type === "attack" && fav.ref) {
			this._page._rollAttack(fav.ref);
			this._logActivity(fav.icon, `Attacked with ${fav.name}`);
		} else if (fav.type === "spell" && fav.ref) {
			this._castSpell(fav.ref);
		} else if (fav.type === "feature" && fav.ref) {
			if (fav.ref.uses?.current > 0) {
				fav.ref.uses.current--;
				this.render();
				this._logActivity("⚡", `Used ${fav.name}`);
			}
		}
	}

	// ─── Spell Casting ──────────────────────────────────────────

	_castSpell (spell) {
		if (spell.level === 0) {
			this._logActivity("✨", `Cast ${spell.name} (cantrip)`);
			return;
		}

		// Find the lowest available slot at or above spell level
		const slotData = this._state._data?.spellcasting?.spellSlots || {};
		let usedLevel = null;
		for (let lvl = spell.level; lvl <= 9; lvl++) {
			const slot = slotData[lvl];
			if (slot && slot.current > 0) {
				slot.current--;
				usedLevel = lvl;
				break;
			}
		}

		if (usedLevel !== null) {
			this._logActivity("✨", `Cast ${spell.name} (${usedLevel === spell.level ? `level ${usedLevel}` : `upcast to level ${usedLevel}`})`);
			this._renderSpellsQuick();
		} else {
			JqueryUtil?.doToast?.({type: "warning", content: `No spell slots available to cast ${spell.name}!`});
		}
	}

	// ─── HP Flow ────────────────────────────────────────────────

	_promptHpChange (mode) {
		const amount = prompt(mode === "heal" ? "Heal amount:" : "Damage amount:");
		if (!amount) return;
		const val = parseInt(amount);
		if (isNaN(val) || val <= 0) return;

		if (mode === "heal") {
			const current = this._state.getCurrentHp();
			const max = this._state.getMaxHp();
			const newHp = Math.min(max, current + val);
			this._state.setCurrentHp(newHp);
			this._logActivity("💚", `Healed ${newHp - current} HP (${current} → ${newHp})`);
		} else {
			let remaining = val;
			const temp = this._state.getTempHp();

			// Absorb with temp HP first
			if (temp > 0) {
				const absorbed = Math.min(temp, remaining);
				this._state.setTempHp(temp - absorbed);
				remaining -= absorbed;
			}

			if (remaining > 0) {
				const current = this._state.getCurrentHp();
				const newHp = Math.max(0, current - remaining);
				this._state.setCurrentHp(newHp);
				this._logActivity("💔", `Took ${val} damage → ${newHp} HP`);
			} else {
				this._logActivity("🛡️", `Temp HP absorbed ${val} damage`);
			}

			// Concentration auto-check
			if (this._state.isConcentrating?.()) {
				this._doConcentrationCheck(val);
			}
		}

		this._renderStatusBar();
	}

	/**
	 * Perform a concentration save after taking damage.
	 * Shows inline result panel and handles break/success.
	 */
	_doConcentrationCheck (damage) {
		const checkInfo = this._state.makeConcentrationCheck?.(damage);
		if (!checkInfo) return;

		const {dc, bonus, advantage} = checkInfo;
		let roll1 = this._rollD20();
		let roll2 = advantage ? this._rollD20() : null;
		let naturalRoll = advantage ? Math.max(roll1, roll2) : roll1;
		let total = naturalRoll + bonus;
		let passed = total >= dc;

		// Build result description
		const rollDesc = advantage
			? `d20(${roll1}, ${roll2}) → ${naturalRoll}`
			: `d20(${naturalRoll})`;
		const resultText = `${rollDesc} + ${bonus} = ${total} vs DC ${dc}`;

		if (passed) {
			JqueryUtil.doToast({type: "success", content: `Concentration saved! ${resultText}`});
			this._logActivity("🔮", `Concentration save: ✅ ${resultText}`);
		} else {
			// Check for Focused Spell (Sorcerer metamagic) reroll
			if (this._state.canUseFocusedConcentrationReroll?.()) {
				const useReroll = confirm(
					`Concentration FAILED (${resultText}).\n\nUse Focused Spell (Sorcerer) to spend 1 sorcery point and reroll?`,
				);
				if (useReroll) {
					this._state.useFocusedConcentrationReroll?.();
					roll1 = this._rollD20();
					roll2 = advantage ? this._rollD20() : null;
					naturalRoll = advantage ? Math.max(roll1, roll2) : roll1;
					total = naturalRoll + bonus;
					passed = total >= dc;
					const rerollDesc = advantage
						? `d20(${roll1}, ${roll2}) → ${naturalRoll}`
						: `d20(${naturalRoll})`;
					const rerollText = `${rerollDesc} + ${bonus} = ${total} vs DC ${dc}`;

					if (passed) {
						JqueryUtil.doToast({type: "success", content: `Focused Spell reroll saved! ${rerollText}`});
						this._logActivity("🔮", `Concentration reroll: ✅ ${rerollText}`);
					} else {
						this._state.breakConcentration?.();
						JqueryUtil.doToast({type: "danger", content: `Concentration broken! ${rerollText}`});
						this._logActivity("🔮", `Concentration reroll: ❌ ${rerollText} — concentration broken`);
					}
					return;
				}
			}

			this._state.breakConcentration?.();
			JqueryUtil.doToast({type: "danger", content: `Concentration broken! ${resultText}`});
			this._logActivity("🔮", `Concentration save: ❌ ${resultText} — concentration broken`);
		}
	}

	// ─── Activity Log ───────────────────────────────────────────

	_logActivity (icon, text) {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
		this._activityLog.unshift({time, icon, text});
		if (this._activityLog.length > 50) this._activityLog.length = 50;
	}

	// ─── Breakdowns ─────────────────────────────────────────────

	_showBreakdown (type) {
		let info;
		if (type === "ac") {
			const ac = this._state.getAc();
			info = typeof ac === "object" ? JSON.stringify(ac, null, 2) : `AC: ${ac}`;
		} else if (type === "speed") {
			const speed = this._state.getSpeed();
			info = typeof speed === "object" ? Object.entries(speed).map(([k, v]) => `${k}: ${v}ft`).join(", ") : `Speed: ${speed}ft`;
		}
		if (info) alert(info);
	}

	// ─── Keyboard ───────────────────────────────────────────────

	_bindKeyboard () {
		document.addEventListener("keydown", (e) => {
			// Ctrl+Shift+P to toggle play mode
			if (e.ctrlKey && e.shiftKey && e.key === "P") {
				e.preventDefault();
				this.toggle();
			}
			// Escape to close drawer
			if (e.key === "Escape" && this._openDrawer) {
				this._closeDrawer();
			}
		});
	}

	// ─── Helpers ────────────────────────────────────────────────

	_updateToggleButton (isPlayMode) {
		const btn = document.getElementById("charsheet-btn-playmode");
		if (!btn) return;
		btn.classList.toggle("pm-toggle-btn--active", isPlayMode);
		btn.title = isPlayMode ? "Switch to Full Sheet" : "Switch to Play Mode";
	}

	_fmtMod (n) {
		return n >= 0 ? `+${n}` : `${n}`;
	}

	/** Convenience: create element, set className, append to parent */
	_ce (tag, className, parent) {
		const el = document.createElement(tag);
		if (className) el.className = className;
		if (parent) parent.appendChild(el);
		return el;
	}

	/**
	 * Make an element clickable with full accessibility support.
	 * Sets role="button", tabindex="0", aria-label, wires click + Enter/Space.
	 */
	_makeClickable (el, label, handler) {
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		if (label) el.setAttribute("aria-label", label);
		el.addEventListener("click", handler);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				handler(e);
			}
		});
		return el;
	}

	/** Build a card section with icon + title */
	_makeCard (parent, icon, title) {
		const card = this._ce("div", "pm-card", parent);
		const header = this._ce("div", "pm-card__header", card);
		const titleEl = this._ce("span", "pm-card__title", header);
		if (icon) {
			const iconEl = this._ce("span", "pm-card__title-icon", titleEl);
			iconEl.textContent = icon;
		}
		titleEl.appendChild(document.createTextNode(` ${title}`));
		return card;
	}

	/** Create a toolbar button */
	_makeToolBtn (parent, label, onClick) {
		const btn = this._ce("button", "pm-status__tool-btn", parent);
		btn.textContent = label;
		btn.addEventListener("click", onClick);
		return btn;
	}

	/** Simple d20 roll */
	_rollD20 () {
		return Math.floor(Math.random() * 20) + 1;
	}
}
