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
		const portrait = this._state.getAppearance("portraitUrl");
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

		// Death saves mode when HP = 0
		if (current <= 0) {
			this._renderDeathSaves(hpWrap);
			return;
		}

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

		// Heal/Damage/TempHP buttons
		const btns = this._ce("div", "pm-status__hp-btns", hpWrap);

		const healBtn = this._ce("button", "pm-status__hp-btn pm-status__hp-btn--heal", btns);
		healBtn.textContent = "+";
		healBtn.title = "Heal";
		healBtn.addEventListener("click", () => this._promptHpChange("heal"));

		const dmgBtn = this._ce("button", "pm-status__hp-btn pm-status__hp-btn--damage", btns);
		dmgBtn.textContent = "−";
		dmgBtn.title = "Take Damage";
		dmgBtn.addEventListener("click", () => this._promptHpChange("damage"));

		const tempBtn = this._ce("button", "pm-status__hp-btn pm-status__hp-btn--temp", btns);
		tempBtn.textContent = "🛡";
		tempBtn.title = "Set Temp HP";
		tempBtn.addEventListener("click", () => this._promptTempHp());
	}

	_renderDeathSaves (parent) {
		const ds = this._state.getDeathSaves();
		const wrap = this._ce("div", "pm-death-saves", parent);

		const label = this._ce("div", "pm-death-saves__label", wrap);
		label.textContent = "💀 Death Saves";

		// Successes
		const succRow = this._ce("div", "pm-death-saves__row", wrap);
		const succLabel = this._ce("span", "pm-death-saves__type pm-death-saves__type--success", succRow);
		succLabel.textContent = "✅";
		for (let i = 0; i < 3; i++) {
			const cb = this._ce("span", `pm-death-saves__pip ${i < ds.successes ? "pm-death-saves__pip--filled pm-death-saves__pip--success" : ""}`, succRow);
			cb.textContent = i < ds.successes ? "●" : "○";
			this._makeClickable(cb, `Death save success ${i + 1}`, () => {
				if (i < ds.successes) {
					this._state.setDeathSaveSuccesses(i);
				} else {
					this._state.addDeathSaveSuccess();
				}
				this._logActivity("💀", `Death save: ${this._state.getDeathSaves().successes}/3 successes`);
				this._renderStatusBar();
			});
		}

		// Failures
		const failRow = this._ce("div", "pm-death-saves__row", wrap);
		const failLabel = this._ce("span", "pm-death-saves__type pm-death-saves__type--failure", failRow);
		failLabel.textContent = "❌";
		for (let i = 0; i < 3; i++) {
			const cb = this._ce("span", `pm-death-saves__pip ${i < ds.failures ? "pm-death-saves__pip--filled pm-death-saves__pip--failure" : ""}`, failRow);
			cb.textContent = i < ds.failures ? "●" : "○";
			this._makeClickable(cb, `Death save failure ${i + 1}`, () => {
				if (i < ds.failures) {
					this._state.setDeathSaveFailures(i);
				} else {
					this._state.addDeathSaveFailure();
				}
				this._logActivity("💀", `Death save: ${this._state.getDeathSaves().failures}/3 failures`);
				this._renderStatusBar();
			});
		}

		// Reset + Heal buttons
		const actionRow = this._ce("div", "pm-death-saves__actions", wrap);
		const resetBtn = this._ce("button", "pm-death-saves__btn", actionRow);
		resetBtn.textContent = "🔄 Reset";
		resetBtn.addEventListener("click", () => {
			this._state.resetDeathSaves();
			this._renderStatusBar();
		});

		const healBtn = this._ce("button", "pm-death-saves__btn pm-death-saves__btn--heal", actionRow);
		healBtn.textContent = "💚 Heal";
		healBtn.addEventListener("click", () => this._promptHpChange("heal"));
	}

	_promptTempHp () {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = "🛡️ Set Temporary HP";

		const row = this._ce("div", "pm-modal__row", panel);
		const input = this._ce("input", "pm-modal__input", row);
		input.type = "number";
		input.min = "0";
		input.value = this._state.getTempHp() || "";
		input.placeholder = "Temp HP";

		const info = this._ce("div", "pm-modal__subtitle", panel);
		info.textContent = "Temp HP doesn't stack — the higher value wins.";

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const applyBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		applyBtn.textContent = "Apply";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		const apply = () => {
			const val = parseInt(input.value);
			if (isNaN(val) || val < 0) return;
			const current = this._state.getTempHp();
			// Temp HP doesn't stack — take the higher value
			this._state.setTempHp(Math.max(val, current));
			close();
			this._logActivity("🛡️", `Set temp HP to ${Math.max(val, current)}`);
			this._renderStatusBar();
		};

		applyBtn.addEventListener("click", apply);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") apply();
			if (e.key === "Escape") close();
		});

		document.body.appendChild(overlay);
		input.focus();
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

		// Rest buttons with preview
		this._makeToolBtn(tools, "🏕️ Short Rest", () => this._showRestPreview("short"));
		this._makeToolBtn(tools, "🛏️ Long Rest", () => this._showRestPreview("long"));

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
				this._state.setActiveState(concentrating.id, false);
				this._renderStatusBar();
				this._logActivity("🔮", `Dropped concentration on ${concentrating.name}`);
				JqueryUtil?.doToast?.({type: "info", content: `Dropped concentration on ${concentrating.name || "spell"}`});
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

		// Add condition button
		const addCondBtn = this._ce("span", "pm-status__indicator pm-status__indicator--add-condition", parent);
		addCondBtn.textContent = "➕ Condition";
		this._makeClickable(addCondBtn, "Add a condition", () => this._showAddConditionPicker());

		// Defenses summary (resistances, immunities, vulnerabilities)
		this._renderDefenses(parent);

		// Exhaustion
		const exhaustion = this._state.getExhaustion();
		if (exhaustion > 0) {
			const exh = this._ce("span", "pm-status__indicator pm-status__indicator--exhaustion", parent);
			exh.textContent = `😫 Exhaustion ${exhaustion}`;
		}

		// Combat Round Tracker
		this._renderCombatTracker(parent);
	}

	_renderCombatTracker (parent) {
		const inCombat = this._state.isInCombat();
		const combatRound = this._state.getCombatRound();

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

	// ─── Condition Picker ────────────────────────────────────────

	_showAddConditionPicker () {
		const STANDARD_CONDITIONS = [
			"Blinded", "Charmed", "Deafened", "Frightened", "Grappled",
			"Incapacitated", "Invisible", "Paralyzed", "Petrified",
			"Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
		];

		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = "➕ Add Condition";

		const grid = this._ce("div", "pm-condition-grid", panel);
		const currentConditions = this._state.getConditionNames?.() || [];

		STANDARD_CONDITIONS.forEach(cond => {
			const already = currentConditions.includes(cond);
			const btn = this._ce("button", `pm-condition-grid__btn ${already ? "pm-condition-grid__btn--active" : ""}`, grid);
			btn.textContent = cond;
			btn.disabled = already;
			btn.addEventListener("click", () => {
				this._state.addCondition(cond);
				overlay.remove();
				this._logActivity("⚠️", `Added condition: ${cond}`);
				this._renderStatusBar();
			});
		});

		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", panel);
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.marginTop = "1rem";
		cancelBtn.addEventListener("click", () => overlay.remove());
		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

		document.body.appendChild(overlay);
	}

	// ─── Defenses Summary ────────────────────────────────────────

	_renderDefenses (parent) {
		const resistances = this._state.getResistances();
		const immunities = this._state.getImmunities();
		const vulnerabilities = this._state.getVulnerabilities();

		if (!resistances.length && !immunities.length && !vulnerabilities.length) return;

		const wrap = this._ce("div", "pm-defenses", parent);

		if (immunities.length) {
			immunities.forEach(d => {
				const tag = this._ce("span", "pm-defenses__tag pm-defenses__tag--immune", wrap);
				tag.textContent = `🛡 ${d}`;
				tag.title = `Immune to ${d}`;
			});
		}
		if (resistances.length) {
			resistances.forEach(d => {
				const tag = this._ce("span", "pm-defenses__tag pm-defenses__tag--resist", wrap);
				tag.textContent = `½ ${d}`;
				tag.title = `Resistant to ${d}`;
			});
		}
		if (vulnerabilities.length) {
			vulnerabilities.forEach(d => {
				const tag = this._ce("span", "pm-defenses__tag pm-defenses__tag--vuln", wrap);
				tag.textContent = `×2 ${d}`;
				tag.title = `Vulnerable to ${d}`;
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
		this._renderSenses();
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

	_renderSenses () {
		const senses = this._state.getSenses();
		if (!senses || !Object.keys(senses).length) return;

		const entries = [];
		if (senses.darkvision) entries.push(`👁️ Darkvision ${senses.darkvision}ft`);
		if (senses.blindsight) entries.push(`🔵 Blindsight ${senses.blindsight}ft`);
		if (senses.tremorsense) entries.push(`🟤 Tremorsense ${senses.tremorsense}ft`);
		if (senses.truesight) entries.push(`🟣 Truesight ${senses.truesight}ft`);
		if (!entries.length) return;

		const card = this._makeCard(this._elCharPanel, "👁️", "Senses");
		const row = this._ce("div", "pm-passives", card);
		entries.forEach(text => {
			const cell = this._ce("div", "pm-passive", row);
			cell.textContent = text;
			cell.style.fontSize = "var(--cs-text-sm, 0.875rem)";
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
		this._renderActiveStates();
		this._renderAttacks();
		this._renderSpellsQuick();
		this._renderFeaturesQuick();
		this._renderResources();
	}

	_renderFavoritesBar () {
		const favorites = this._state.getFavorites();
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

	_renderActiveStates () {
		const allStates = this._state.getActiveStates();
		// Filter to show toggleable states the character has access to (not concentration — that's in status bar)
		const toggleable = allStates.filter(s => s.type !== "concentration" && !s.isCondition);
		if (!toggleable.length) return;

		const card = this._makeCard(this._elActionsHub, "🔥", "Active States");
		const grid = this._ce("div", "pm-active-states", card);

		toggleable.forEach(state => {
			const el = this._ce("div", `pm-active-state ${state.active ? "pm-active-state--on" : ""}`, grid);

			const toggle = this._ce("span", "pm-active-state__toggle", el);
			toggle.textContent = state.active ? "🟢" : "⚪";

			const name = this._ce("span", "pm-active-state__name", el);
			name.textContent = state.name || state.type;

			// Duration (if in combat)
			if (state.active && state.roundsRemaining != null && state.roundsRemaining > 0) {
				const dur = this._ce("span", "pm-active-state__duration", el);
				dur.textContent = `${state.roundsRemaining}r`;
			}

			this._makeClickable(el, `${state.active ? "Deactivate" : "Activate"} ${state.name || state.type}`, () => {
				this._state.setActiveState(state.id, !state.active);
				this._logActivity("🔥", `${!state.active ? "Activated" : "Deactivated"} ${state.name || state.type}`);
				// Re-render both status bar (conditions/concentration may change) and actions hub
				this._renderStatusBar();
				this._renderActionsHub();
			});
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

		// Spell DC + Attack Bonus header
		const spellDc = this._state.getSpellDc?.();
		const spellAtk = this._state.getSpellAttackBonus?.();
		if (spellDc || spellAtk) {
			const dcRow = this._ce("div", "pm-spell-stats", card);
			if (spellDc) {
				const dcTag = this._ce("span", "pm-spell-stats__tag", dcRow);
				dcTag.textContent = `DC ${spellDc}`;
			}
			if (spellAtk != null) {
				const atkTag = this._ce("span", "pm-spell-stats__tag", dcRow);
				atkTag.textContent = `${this._fmtMod(spellAtk)} attack`;
			}
		}

		// Spell slot pips
		const slotData = this._state.getSpellSlots();
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
						const cur = this._state.getSpellSlotsCurrent(lvl);
						const max = this._state.getSpellSlotsMax(lvl);
						if (i < cur) {
							this._state.setSpellSlotCurrent(lvl, cur - 1);
						} else {
							this._state.setSpellSlotCurrent(lvl, Math.min(max, cur + 1));
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
		if (spell.ritual) parts.push("🕯️ ritual");
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
					const fresh = this._state.getHitDice();
					const cur = fresh[die];
					if (!cur) return;
					if (i < cur.current) {
						this._state.setHitDice(Object.entries(fresh).map(([d, v]) => ({die: d, current: d === die ? v.current - 1 : v.current, max: v.max})));
					} else {
						this._state.setHitDice(Object.entries(fresh).map(([d, v]) => ({die: d, current: d === die ? Math.min(v.max, v.current + 1) : v.current, max: v.max})));
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
			case "activity": this._renderActivityDrawer(container); break;
		}
	}

	_renderSpellsDrawer (container) {
		const spells = this._state.getSpells();
		if (!spells.length) {
			this._renderEmptyState(container, "✨", "No spells known. Add spells from the Spells tab.");
			return;
		}

		// Search input
		const searchInput = this._ce("input", "pm-drawer-search", container);
		searchInput.type = "text";
		searchInput.placeholder = "🔍 Search spells...";

		const spellsContainer = this._ce("div", null, container);

		const renderFiltered = (filter = "") => {
			spellsContainer.innerHTML = "";
			const lower = filter.toLowerCase();
			const filtered = filter ? spells.filter(s => s.name.toLowerCase().includes(lower)) : spells;

			const byLevel = {};
			filtered.forEach(s => {
				const lvl = s.level ?? 0;
				(byLevel[lvl] = byLevel[lvl] || []).push(s);
			});

			Object.keys(byLevel).sort((a, b) => a - b).forEach(lvl => {
				const header = this._ce("div", "pm-card__header", spellsContainer);
				const title = this._ce("span", "pm-card__title", header);
				title.textContent = lvl === "0" ? "Cantrips" : `Level ${lvl}`;
				const badge = this._ce("span", "pm-card__badge", header);
				badge.textContent = `${byLevel[lvl].length}`;

				byLevel[lvl].forEach(spell => this._renderSpellRow(spellsContainer, spell));
			});

			if (!filtered.length) {
				this._renderEmptyState(spellsContainer, "🔍", `No spells matching "${filter}"`);
			}
		};

		searchInput.addEventListener("input", () => renderFiltered(searchInput.value));
		renderFiltered();
	}

	_renderGearDrawer (container) {
		const items = this._state.getItems();

		// Currency
		const coins = ["cp", "sp", "ep", "gp", "pp"].filter(c => this._state.getCurrency(c) > 0);
		if (coins.length) {
			const currCard = this._makeCard(container, "💰", "Currency");
			const currRow = this._ce("div", "pm-passives", currCard);
			coins.forEach(c => {
				const cell = this._ce("div", "pm-passive", currRow);
				const val = this._ce("span", "pm-passive__value", cell);
				val.textContent = this._state.getCurrency(c);
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
			this._renderEmptyState(container, "🎒", "No items. Add items from the Inventory tab.");
		}
	}

	_renderReferenceDrawer (container) {
		const features = this._state.getFeatures();
		if (!features.length) {
			this._renderEmptyState(container, "📜", "No features yet.");
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
		const entries = [
			{label: "Personality", field: "personality"},
			{label: "Ideals", field: "ideals"},
			{label: "Bonds", field: "bonds"},
			{label: "Flaws", field: "flaws"},
			{label: "Backstory", field: "backstory"},
			{label: "Additional Notes", field: "additional"},
		];

		let hasAny = false;
		entries.forEach(e => {
			const value = this._state.getNote(e.field);
			if (!value) return;
			hasAny = true;
			const card = this._makeCard(container, "📝", e.label);
			const text = this._ce("div", null, card);
			text.style.whiteSpace = "pre-wrap";
			text.style.fontSize = "var(--cs-text-sm, 0.875rem)";
			text.style.color = "var(--cs-text-secondary, #94a3b8)";
			text.textContent = value;
		});

		if (!hasAny) {
			this._renderEmptyState(container, "📝", "No notes. Add notes from the Notes tab.");
		}
	}

	_renderCompanionsDrawer (container) {
		const companions = this._state.getCompanions();
		if (!companions.length) {
			this._renderEmptyState(container, "🐾", "No companions. Add from the Companions tab.");
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
		return this._state.isFavorite(type, id);
	}

	_toggleFavorite (favData) {
		const result = this._state.toggleFavorite(favData);
		if (!result) {
			JqueryUtil?.doToast?.({type: "warning", content: "Maximum 8 favorites. Remove one first."});
			return;
		}
		this._renderFavoritesBar();
		this._renderAttacks();
		this._renderSpellsQuick();
		this._renderFeaturesQuick();
	}

	_removeFavorite (id) {
		if (this._state.removeFavorite(id)) {
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

		// Collect available slot levels at or above spell level
		const available = [];
		for (let lvl = spell.level; lvl <= 9; lvl++) {
			const cur = this._state.getSpellSlotsCurrent(lvl);
			const max = this._state.getSpellSlotsMax(lvl);
			if (max > 0) available.push({level: lvl, current: cur, max});
		}

		if (!available.length || !available.some(s => s.current > 0)) {
			JqueryUtil?.doToast?.({type: "warning", content: `No spell slots available to cast ${spell.name}!`});
			return;
		}

		// If only one level available, cast immediately
		if (available.length === 1 || (available.filter(s => s.current > 0).length === 1)) {
			const slot = available.find(s => s.current > 0);
			if (slot) {
				this._state.setSpellSlotCurrent(slot.level, slot.current - 1);
				this._logActivity("✨", `Cast ${spell.name} (level ${slot.level})`);
				this._renderSpellsQuick();
			}
			return;
		}

		// Show upcast picker inline
		this._showUpcastPicker(spell, available);
	}

	_showUpcastPicker (spell, slots) {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = `✨ Cast ${spell.name}`;

		const desc = this._ce("div", "pm-modal__subtitle", panel);
		desc.textContent = "Choose a spell slot level:";

		const slotRow = this._ce("div", "pm-upcast", panel);

		slots.forEach(slot => {
			const btn = this._ce("button", `pm-upcast__slot ${slot.current <= 0 ? "pm-upcast__slot--empty" : ""}`, slotRow);
			btn.disabled = slot.current <= 0;

			const lvl = this._ce("span", "pm-upcast__level", btn);
			lvl.textContent = slot.level === spell.level ? `${slot.level}st` : `${slot.level}${slot.level === 2 ? "nd" : slot.level === 3 ? "rd" : "th"}`;

			const pips = this._ce("span", "pm-upcast__pips", btn);
			for (let i = 0; i < slot.max; i++) {
				const pip = this._ce("span", `pm-upcast__pip ${i < slot.current ? "pm-upcast__pip--filled" : ""}`, pips);
				pip.textContent = i < slot.current ? "●" : "○";
			}

			if (slot.level > spell.level) {
				const tag = this._ce("span", "pm-upcast__tag", btn);
				tag.textContent = "upcast";
			}

			if (slot.current > 0) {
				btn.addEventListener("click", () => {
					overlay.remove();
					this._state.setSpellSlotCurrent(slot.level, slot.current - 1);
					const label = slot.level === spell.level ? `level ${slot.level}` : `upcast level ${slot.level}`;
					this._logActivity("✨", `Cast ${spell.name} (${label})`);
					this._renderSpellsQuick();
				});
			}
		});

		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", panel);
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.marginTop = "1rem";
		cancelBtn.addEventListener("click", () => overlay.remove());

		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
		document.addEventListener("keydown", function onEsc (e) {
			if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); }
		});

		document.body.appendChild(overlay);
	}

	// ─── HP Flow ────────────────────────────────────────────────

	_promptHpChange (mode) {
		const overlay = this._ce("div", "pm-modal-overlay");

		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = mode === "heal" ? "💚 Heal" : "💔 Take Damage";

		const inputRow = this._ce("div", "pm-modal__row", panel);

		const input = this._ce("input", "pm-modal__input", inputRow);
		input.type = "number";
		input.min = "1";
		input.placeholder = "Amount";

		// Damage type selector (damage mode only)
		let dmgTypeSelect = null;
		let infoRow = null;
		if (mode === "damage") {
			dmgTypeSelect = this._ce("select", "pm-modal__select", inputRow);
			const types = ["—", "acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder", "bludgeoning", "piercing", "slashing"];
			types.forEach(t => {
				const opt = this._ce("option", null, dmgTypeSelect);
				opt.value = t === "—" ? "" : t;
				opt.textContent = t === "—" ? "Type…" : t.charAt(0).toUpperCase() + t.slice(1);
			});

			infoRow = this._ce("div", "pm-modal__info", panel);

			const updateInfo = () => {
				const dtype = dmgTypeSelect.value;
				infoRow.innerHTML = "";
				if (!dtype) return;

				const resistances = this._state.getResistances();
				const immunities = this._state.getImmunities();
				const vulnerabilities = this._state.getVulnerabilities();

				if (immunities.includes(dtype)) {
					const tag = this._ce("span", "pm-modal__tag pm-modal__tag--immune", infoRow);
					tag.textContent = `🛡️ Immune to ${dtype} — 0 damage`;
				} else if (resistances.includes(dtype)) {
					const tag = this._ce("span", "pm-modal__tag pm-modal__tag--resist", infoRow);
					tag.textContent = `🛡️ Resistant to ${dtype} — halved`;
				} else if (vulnerabilities.includes(dtype)) {
					const tag = this._ce("span", "pm-modal__tag pm-modal__tag--vuln", infoRow);
					tag.textContent = `⚠️ Vulnerable to ${dtype} — doubled`;
				}
			};
			dmgTypeSelect.addEventListener("change", updateInfo);
		}

		// Preview row
		const previewRow = this._ce("div", "pm-modal__preview", panel);

		const updatePreview = () => {
			previewRow.innerHTML = "";
			const val = parseInt(input.value);
			if (isNaN(val) || val <= 0) return;

			if (mode === "heal") {
				const current = this._state.getCurrentHp();
				const max = this._state.getMaxHp();
				const healed = Math.min(max - current, val);
				previewRow.textContent = `${current} → ${current + healed} HP (${healed > 0 ? `+${healed}` : "already full"})`;
			} else {
				let effective = val;
				const dtype = dmgTypeSelect?.value || "";
				if (dtype) {
					const immunities = this._state.getImmunities();
					const resistances = this._state.getResistances();
					const vulnerabilities = this._state.getVulnerabilities();
					if (immunities.includes(dtype)) effective = 0;
					else if (resistances.includes(dtype)) effective = Math.floor(val / 2);
					else if (vulnerabilities.includes(dtype)) effective = val * 2;
				}

				const temp = this._state.getTempHp();
				const current = this._state.getCurrentHp();
				let rem = effective;
				const parts = [];
				if (effective !== val) parts.push(`${val} → ${effective} (${effective === 0 ? "immune" : effective < val ? "resistant" : "vulnerable"})`);
				if (temp > 0 && rem > 0) {
					const absorbed = Math.min(temp, rem);
					parts.push(`Temp HP absorbs ${absorbed}`);
					rem -= absorbed;
				}
				if (rem > 0) parts.push(`${current} → ${Math.max(0, current - rem)} HP`);
				else if (effective > 0) parts.push("Fully absorbed by Temp HP");
				else parts.push("No damage taken");
				previewRow.textContent = parts.join(" · ");
			}
		};
		input.addEventListener("input", updatePreview);
		dmgTypeSelect?.addEventListener("change", updatePreview);

		const btnRow = this._ce("div", "pm-modal__buttons", panel);

		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";

		const applyBtn = this._ce("button", `pm-modal__btn pm-modal__btn--${mode}`, btnRow);
		applyBtn.textContent = "Apply";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		const apply = () => {
			const val = parseInt(input.value);
			if (isNaN(val) || val <= 0) return;
			const dtype = dmgTypeSelect?.value || "";
			close();
			this._applyHpChange(mode, val, dtype);
		};

		applyBtn.addEventListener("click", apply);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") apply();
			if (e.key === "Escape") close();
		});

		document.body.appendChild(overlay);
		input.focus();
	}

	_applyHpChange (mode, val, damageType = "") {

		if (mode === "heal") {
			const current = this._state.getCurrentHp();
			const max = this._state.getMaxHp();
			const newHp = Math.min(max, current + val);
			this._state.setCurrentHp(newHp);
			this._logActivity("💚", `Healed ${newHp - current} HP (${current} → ${newHp})`);
		} else {
			// Apply resistance/immunity/vulnerability
			let effective = val;
			if (damageType) {
				const immunities = this._state.getImmunities();
				const resistances = this._state.getResistances();
				const vulnerabilities = this._state.getVulnerabilities();
				if (immunities.includes(damageType)) {
					effective = 0;
					this._logActivity("🛡️", `Immune to ${val} ${damageType} damage`);
					this._renderStatusBar();
					return;
				} else if (resistances.includes(damageType)) {
					effective = Math.floor(val / 2);
				} else if (vulnerabilities.includes(damageType)) {
					effective = val * 2;
				}
			}

			let remaining = effective;
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
				const suffix = effective !== val ? ` (${val} ${damageType} → ${effective} after ${effective < val ? "resistance" : "vulnerability"})` : "";
				this._logActivity("💔", `Took ${effective} damage${suffix} → ${newHp} HP`);
			} else {
				this._logActivity("🛡️", `Temp HP absorbed ${effective} damage`);
			}

			// Concentration auto-check
			if (this._state.isConcentrating?.()) {
				this._doConcentrationCheck(effective);
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
				this._showFocusedSpellPrompt(resultText, dc, bonus, advantage);
				return;
			}

			this._state.breakConcentration?.();
			JqueryUtil.doToast({type: "danger", content: `Concentration broken! ${resultText}`});
			this._logActivity("🔮", `Concentration save: ❌ ${resultText} — concentration broken`);
		}
	}

	_showFocusedSpellPrompt (failText, dc, bonus, advantage) {
		const overlay = this._ce("div", "pm-modal-overlay");

		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title pm-modal__title--danger", panel);
		title.textContent = "🔮 Concentration FAILED";

		const desc = this._ce("div", "pm-modal__subtitle", panel);
		desc.textContent = `${failText}\n\nUse Focused Spell to spend 1 sorcery point and reroll?`;
		desc.style.whiteSpace = "pre-wrap";

		const btnRow = this._ce("div", "pm-modal__buttons", panel);

		const declineBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		declineBtn.textContent = "Break Concentration";

		const rerollBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		rerollBtn.textContent = "🎲 Reroll";

		const close = () => overlay.remove();

		declineBtn.addEventListener("click", () => {
			close();
			this._state.breakConcentration?.();
			JqueryUtil.doToast({type: "danger", content: `Concentration broken! ${failText}`});
			this._logActivity("🔮", `Concentration save: ❌ ${failText} — concentration broken`);
			this._renderStatusBar();
		});

		rerollBtn.addEventListener("click", () => {
			close();
			this._state.useFocusedConcentrationReroll?.();
			let roll1 = this._rollD20();
			let roll2 = advantage ? this._rollD20() : null;
			const naturalRoll = advantage ? Math.max(roll1, roll2) : roll1;
			const total = naturalRoll + bonus;
			const passed = total >= dc;
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
			this._renderStatusBar();
		});

		document.body.appendChild(overlay);
		rerollBtn.focus();
	}

	// ─── Rest Preview ───────────────────────────────────────────

	_showRestPreview (type) {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = type === "short" ? "🏕️ Short Rest Preview" : "🛏️ Long Rest Preview";

		const list = this._ce("div", "pm-rest-preview", panel);

		// HP recovery
		const hp = this._state.getHp();
		if (type === "long") {
			const item = this._ce("div", "pm-rest-preview__item", list);
			item.textContent = `❤️ HP: ${hp.current} → ${hp.max} (full recovery)`;
		} else {
			const item = this._ce("div", "pm-rest-preview__item", list);
			item.textContent = `❤️ HP: ${hp.current}/${hp.max} — spend Hit Dice to heal`;
		}

		// Hit dice recovery (long rest only)
		if (type === "long") {
			const hitDice = this._state.getHitDice();
			const totalLevel = this._state.getTotalLevel();
			const recover = Math.max(1, Math.floor(totalLevel / 2));
			const item = this._ce("div", "pm-rest-preview__item", list);
			item.textContent = `🎲 Hit Dice: Recover ${recover} (half level, min 1)`;
		}

		// Spell slots
		const slotData = this._state.getSpellSlots();
		const hasSlots = Object.keys(slotData).some(k => slotData[k]?.max > 0);
		if (hasSlots && type === "long") {
			const item = this._ce("div", "pm-rest-preview__item", list);
			item.textContent = "✨ Spell Slots: All restored";
		}

		// Class resources
		const resources = this._state.getResources();
		const restorable = resources.filter(r => {
			if (type === "long") return r.current < r.max;
			return r.restsOn === "short" && r.current < r.max;
		});
		restorable.forEach(r => {
			const item = this._ce("div", "pm-rest-preview__item", list);
			item.textContent = `⚡ ${r.name}: ${r.current}/${r.max} → ${r.max}/${r.max}`;
		});

		// Conditions that clear on long rest
		if (type === "long") {
			const conditions = this._state.getConditionNames?.() || [];
			if (conditions.length) {
				const item = this._ce("div", "pm-rest-preview__item pm-rest-preview__item--clear", list);
				item.textContent = `⚠️ Clears: ${conditions.join(", ")}`;
			}
		}

		// Concentration note
		if (this._state.isConcentrating?.()) {
			const item = this._ce("div", "pm-rest-preview__item pm-rest-preview__item--warn", list);
			item.textContent = `🔮 Concentration will end`;
		}

		const btnRow = this._ce("div", "pm-modal__buttons", panel);

		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";

		const confirmBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		confirmBtn.textContent = type === "short" ? "🏕️ Take Short Rest" : "🛏️ Take Long Rest";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		confirmBtn.addEventListener("click", () => {
			close();
			if (type === "short") {
				this._page._rest?._showShortRestDialog?.();
			} else {
				this._page._rest?._showLongRestDialog?.();
			}
			this._logActivity(type === "short" ? "🏕️" : "🛏️", `${type === "short" ? "Short" : "Long"} Rest taken`);
		});

		document.body.appendChild(overlay);
	}

	// ─── Activity Log ───────────────────────────────────────────

	_logActivity (icon, text) {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
		this._activityLog.unshift({time, icon, text});
		if (this._activityLog.length > 100) this._activityLog.length = 100;
		this._renderActivityStrip();
	}

	_renderActivityStrip () {
		if (!this._elActionsHub) return;
		let strip = this._elActionsHub.querySelector(".pm-activity-strip");
		if (!strip) {
			strip = this._ce("div", "pm-activity-strip", this._elActionsHub);
		}
		strip.innerHTML = "";

		const header = this._ce("div", "pm-activity-strip__header", strip);
		const label = this._ce("span", "pm-activity-strip__label", header);
		label.textContent = "📋 Recent Activity";
		const viewAll = this._ce("span", "pm-activity-strip__viewall", header);
		viewAll.textContent = "View all ▸";
		this._makeClickable(viewAll, "View full activity log", () => this._openDrawerByType("activity"));

		const recent = this._activityLog.slice(0, 4);
		recent.forEach(entry => {
			const row = this._ce("div", "pm-activity-strip__entry", strip);
			row.textContent = `${entry.time} ${entry.icon} ${entry.text}`;
		});

		if (!recent.length) {
			const empty = this._ce("div", "pm-activity-strip__empty", strip);
			empty.textContent = "No activity yet";
		}
	}

	_renderActivityDrawer (container) {
		if (!this._activityLog.length) {
			this._renderEmptyState(container, "📋", "No activity logged this session.");
			return;
		}

		const header = this._ce("div", "pm-card__header", container);
		const title = this._ce("span", "pm-card__title", header);
		title.textContent = `📋 Session Activity (${this._activityLog.length})`;

		const exportBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", header);
		exportBtn.textContent = "📋 Copy";
		exportBtn.style.marginLeft = "auto";
		exportBtn.addEventListener("click", () => {
			const md = this._activityLog.map(e => `- ${e.time} ${e.icon} ${e.text}`).join("\n");
			navigator.clipboard?.writeText?.(md).then(() => {
				JqueryUtil?.doToast?.({type: "success", content: "Activity log copied to clipboard!"});
			});
		});

		this._activityLog.forEach(entry => {
			const row = this._ce("div", "pm-activity-entry", container);
			const time = this._ce("span", "pm-activity-entry__time", row);
			time.textContent = entry.time;
			const icon = this._ce("span", "pm-activity-entry__icon", row);
			icon.textContent = entry.icon;
			const text = this._ce("span", "pm-activity-entry__text", row);
			text.textContent = entry.text;
		});
	}

	// ─── Breakdowns ─────────────────────────────────────────────

	_showBreakdown (type) {
		let lines = [];
		if (type === "ac") {
			const breakdown = this._state.getAcBreakdown?.();
			if (breakdown && typeof breakdown === "object") {
				if (breakdown.base) lines.push(`Base: ${breakdown.base}`);
				if (breakdown.armor) lines.push(`Armor: ${breakdown.armor}`);
				if (breakdown.shield) lines.push(`Shield: ${breakdown.shield}`);
				if (breakdown.dexMod !== undefined) lines.push(`DEX: ${this._fmtMod(breakdown.dexMod)}`);
				if (breakdown.bonus) lines.push(`Bonus: ${this._fmtMod(breakdown.bonus)}`);
				lines.push(`Total: ${this._state.getAc()?.total ?? this._state.getAc()}`);
			} else {
				lines.push(`AC: ${this._state.getAc()?.total ?? this._state.getAc()}`);
			}
		} else if (type === "speed") {
			const speed = this._state.getSpeed();
			if (typeof speed === "object") {
				Object.entries(speed).forEach(([k, v]) => { if (v) lines.push(`${k}: ${v}ft`); });
			} else {
				lines.push(`Walk: ${speed}ft`);
			}
		}

		if (!lines.length) return;

		// Show as toast instead of alert
		JqueryUtil?.doToast?.({type: "info", content: lines.join(" · ")});
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

	/** Render a styled empty state message */
	_renderEmptyState (parent, icon, message) {
		const wrap = this._ce("div", "pm-empty", parent);
		const iconEl = this._ce("span", "pm-empty__icon", wrap);
		iconEl.textContent = icon;
		wrap.appendChild(document.createTextNode(message));
	}

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
