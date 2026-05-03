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

		// Speed (use getSpeed("walk") for number, not getSpeed() which returns formatted string)
		const walkSpeed = this._state.getSpeed("walk") || 30;
		this._renderVitalChip(wrap, "🏃", `${walkSpeed}ft`, "Speed", () => this._showBreakdown("speed"));

		// Additional speed types (fly, swim, climb, burrow)
		const speedTypes = [
			{type: "fly", icon: "🦅", label: "Fly"},
			{type: "swim", icon: "🏊", label: "Swim"},
			{type: "climb", icon: "🧗", label: "Climb"},
			{type: "burrow", icon: "🕳️", label: "Burrow"},
		];
		speedTypes.forEach(({type, icon, label}) => {
			const val = this._state.getSpeed?.(type);
			if (val && val > 0) {
				this._renderVitalChip(wrap, icon, `${val}ft`, label);
			}
		});

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

		// Rest buttons (Phase A3: delegate directly to rest module's full dialogs)
		this._makeToolBtn(tools, "🏕️ Short Rest", () => this._doShortRest());
		this._makeToolBtn(tools, "🛏️ Long Rest", () => this._doLongRest());

		this._ce("div", "pm-status__divider", tools);

		// Drawers
		this._makeToolBtn(tools, "📖 Spells", () => this._openDrawerByType("spells"));
		this._makeToolBtn(tools, "🎒 Gear", () => this._openDrawerByType("gear"));
		this._makeToolBtn(tools, "📜 Reference", () => this._openDrawerByType("reference"));
		this._makeToolBtn(tools, "📝 Notes", () => this._openDrawerByType("notes"));
		if (this._state.getCompanions().length) {
			this._makeToolBtn(tools, "🐾 Companions", () => this._openDrawerByType("companions"));
		}

		this._ce("div", "pm-status__divider", tools);

		// Phase C1: Extended toolbar
		this._makeToolBtn(tools, "🗒 Stickies", () => this._toggleStickyNotesOverlay());
		this._makeToolBtn(tools, "🎯 Modifiers", () => this._openDrawerByType("modifiers"));
		this._makeToolBtn(tools, "⚙️ Settings", () => this._openDrawerByType("settings"));
		this._makeToolBtn(tools, "📋 Roll Log", () => this._openDrawerByType("activity"));

		this._ce("div", "pm-status__divider", tools);

		// Export / Import
		this._makeToolBtn(tools, "💾 Export", () => this._exportCharacter());
		const importBtn = this._makeToolBtn(tools, "📥 Import", () => this._elImportInput?.click());
		const importInput = this._ce("input", null, tools);
		importInput.type = "file";
		importInput.accept = ".json";
		importInput.style.display = "none";
		this._elImportInput = importInput;
		importInput.addEventListener("change", async (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				this._state.loadFromJson(JSON.parse(text));
				this.render();
				JqueryUtil?.doToast?.({type: "success", content: `Imported ${file.name}`});
				this._logActivity("📥", `Imported character from ${file.name}`);
			} catch (err) {
				JqueryUtil?.doToast?.({type: "danger", content: `Import failed: ${err.message}`});
			}
			importInput.value = "";
		});

		// NPC Export (only if exporter available)
		if (this._page._export) {
			this._makeToolBtn(tools, "🐉 NPC Export", () => this._page._export._showNpcExportDialog?.());
		}

		this._makeToolBtn(tools, "🖨️ Print", () => window.print());

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
		const concentrating = activeStates.find(s => s.stateTypeId === "concentration" && s.active);
		if (concentrating) {
			const conc = this._ce("span", "pm-status__indicator pm-status__indicator--concentration", parent);
			conc.textContent = `🔮 Concentrating: ${concentrating.name || "Spell"}`;
			this._makeClickable(conc, `End concentration on ${concentrating.name || "spell"}`, () => {
				this._state.deactivateState("concentration");
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

			// Condition tooltip
			const condDesc = CharacterSheetPlayMode.CONDITION_DESCRIPTIONS[condName];
			if (condDesc) el.title = `${condName}: ${condDesc}`;

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
		const conditionImmunities = this._state.getConditionImmunities?.() || [];

		STANDARD_CONDITIONS.forEach(cond => {
			const already = currentConditions.includes(cond);
			const immune = conditionImmunities.includes(cond.toLowerCase());
			const btn = this._ce("button", `pm-condition-grid__btn ${already ? "pm-condition-grid__btn--active" : ""} ${immune ? "pm-condition-grid__btn--immune" : ""}`, grid);
			btn.textContent = immune ? `${cond} (immune)` : cond;
			btn.disabled = already || immune;
			if (!already && !immune) {
				btn.addEventListener("click", () => {
					this._state.addCondition(cond);
					overlay.remove();
					this._logActivity("⚠️", `Added condition: ${cond}`);
					this._renderStatusBar();
				});
			}
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
		const condImmunities = this._state.getConditionImmunities?.() || [];

		if (!resistances.length && !immunities.length && !vulnerabilities.length && !condImmunities.length) return;

		const wrap = this._ce("div", "pm-defenses", parent);

		if (immunities.length) {
			immunities.forEach(d => {
				const tag = this._ce("span", "pm-defenses__tag pm-defenses__tag--immune", wrap);
				tag.textContent = `🛡 ${d}`;
				tag.title = `Immune to ${d} damage`;
			});
		}
		if (condImmunities.length) {
			condImmunities.forEach(c => {
				const tag = this._ce("span", "pm-defenses__tag pm-defenses__tag--cond-immune", wrap);
				tag.textContent = `🚫 ${c}`;
				tag.title = `Immune to ${c} condition`;
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
		this._renderCombatMethods();
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
		const toggleable = allStates.filter(s => s.stateTypeId !== "concentration");
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
				this._state.toggleActiveState(state.id);
				this._logActivity("🔥", `${!state.active ? "Activated" : "Deactivated"} ${state.name || state.type}`);
				// Re-render both status bar (conditions/concentration may change) and actions hub
				this._renderStatusBar();
				this._renderActionsHub();
			});
		});
	}

	_renderCombatMethods () {
		const settings = this._state.getSettings?.() || {};
		if (!settings.enableTgtt) return;

		const methods = this._state.getCombatMethods?.() || [];
		if (!methods.length) return;

		const staminaCur = this._state.getStaminaCurrent?.() || 0;
		const staminaMax = this._state.getStaminaMax?.() || 0;

		const card = this._makeCard(this._elActionsHub, "⚔️", "Combat Methods");

		// Stamina display
		if (staminaMax > 0) {
			const staminaRow = this._ce("div", "pm-resource", card);
			const staminaName = this._ce("span", "pm-resource__name", staminaRow);
			staminaName.textContent = "Stamina";
			const staminaPips = this._ce("div", "pm-resource__pips", staminaRow);
			for (let i = 0; i < staminaMax; i++) {
				const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < staminaCur ? "filled" : "empty"}`, staminaPips);
				pip.style.color = i < staminaCur ? "var(--cs-accent-amber, #f59e0b)" : "";
				this._makeClickable(pip, `Stamina ${i + 1} (${i < staminaCur ? "spend" : "restore"})`, () => {
					const cur = this._state.getStaminaCurrent?.() || 0;
					if (i < cur) {
						this._state.setStaminaCurrent(cur - 1);
					} else {
						this._state.setStaminaCurrent(Math.min(staminaMax, cur + 1));
					}
					this._renderCombatMethods();
				});
			}
		}

		// Methods list
		methods.forEach(method => {
			const row = this._ce("div", "pm-feature", card);
			const name = this._ce("span", "pm-feature__name", row);
			name.textContent = method.name;

			if (method.staminaCost > 0) {
				const cost = this._ce("span", "pm-card__badge", row);
				cost.textContent = `${method.staminaCost} SP`;
			}

			const useBtn = this._ce("button", "pm-feature__use-btn", row);
			useBtn.textContent = "Use";
			const canUse = staminaCur >= (method.staminaCost || 0);
			if (!canUse) useBtn.classList.add("pm-feature__use-btn--disabled");
			useBtn.disabled = !canUse;
			useBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (method.staminaCost > 0) {
					const cur = this._state.getStaminaCurrent?.() || 0;
					if (cur < method.staminaCost) return;
					this._state.setStaminaCurrent(cur - method.staminaCost);
				}
				this._logActivity("⚔️", `Used ${method.name}${method.staminaCost ? ` (${method.staminaCost} stamina)` : ""}`);
				this._renderCombatMethods();
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

		if (!attacks.length) {
			// Still show card with + Add Attack button even if no attacks
		}

		const card = this._makeCard(this._elActionsHub, "⚔️", "Attacks");

		// Phase A5: "+ Add Attack" button in card header
		const cardHeader = card.querySelector(".pm-card__header");
		if (cardHeader) {
			const addBtn = this._ce("button", "pm-card__action-btn", cardHeader);
			addBtn.textContent = "+ Add";
			addBtn.title = "Add a custom attack";
			addBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._showAttackModal(null, () => {
					// Re-render attacks section
					const existing = this._elActionsHub.querySelector(".pm-card");
					// Simpler: just re-render the whole actions hub
					this._renderActionsHub();
				});
			});
		}

		const customAttackIds = new Set(this._state.getAttacks().map(a => a.id));

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

			// Attack range
			if (attack.range) {
				const range = this._ce("span", "pm-attack__range", row);
				range.textContent = attack.range;
			}

			// Weapon mastery badge (XPHB 2024)
			const masteries = this._state.getWeaponMasteries();
			const masteryKey = `${attack.name}|${attack.source || ""}`;
			const hasMastery = masteries.some(m => m === masteryKey || m.split("|")[0] === attack.name);
			if (hasMastery && attack.masteryProperty) {
				const masteryTag = this._ce("span", "pm-attack__mastery", row);
				masteryTag.textContent = attack.masteryProperty;
			}

			// Note button (B3)
			const attackId = attack.id || attack.name;
			const attackNote = this._state.getAttackNote?.(attackId);
			const noteBtn = this._ce("button", `pm-note-btn${attackNote ? " pm-note-btn--active" : ""}`, row);
			noteBtn.textContent = "📝";
			noteBtn.title = attackNote ? `Note: ${attackNote.slice(0, 60)}${attackNote.length > 60 ? "…" : ""}` : "Add note";
			noteBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._showEntityNoteModal("attack", attackId, attack.name, () => this._renderAttacks());
			});

			// Phase A5: edit/delete buttons for user-created attacks (not auto-generated)
			const isCustom = customAttackIds.has(attack.id);
			if (isCustom) {
				const editBtn = this._ce("button", "pm-attack__crud-btn pm-attack__edit-btn", row);
				editBtn.textContent = "✏️";
				editBtn.title = "Edit attack";
				editBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					this._showAttackModal(attack, () => this._renderActionsHub());
				});

				const delBtn = this._ce("button", "pm-attack__crud-btn pm-attack__del-btn", row);
				delBtn.textContent = "🗑";
				delBtn.title = "Delete attack";
				delBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					this._showConfirmModal(`Delete attack "${attack.name}"?`, () => {
						this._state.removeAttack(attack.id);
						this._logActivity("🗑", `Deleted attack: ${attack.name}`);
						this._renderActionsHub();
					});
				});
			}

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

			row.addEventListener("click", (e) => {
				this._page._rollAttack(attack, e);
				this._logActivity(attack.isMelee ? "🗡️" : "🏹", `Attacked with ${attack.name}`);
			});
			row.setAttribute("role", "button");
			row.setAttribute("tabindex", "0");
			row.setAttribute("aria-label", `Roll attack: ${attack.name}, ${this._fmtMod(totalBonus)} to hit, ${dmgStr} damage`);
			row.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this._page._rollAttack(attack, e);
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
		const spellDcData = this._state.getSpellDcBreakdown?.();
		const spellDc = spellDcData?.total;
		const spellAtk = this._state.getSpellAttackBonus?.();
		if (spellDc || spellAtk != null) {
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

		// Pact Magic slots (Warlock)
		const pact = this._state.getPactSlots();
		if (pact.max > 0) {
			const pactRow = this._ce("div", "pm-slots", card);
			const pactWrap = this._ce("div", "pm-slots__level", pactRow);
			const pactLabel = this._ce("span", "pm-slots__label pm-slots__label--pact", pactWrap);
			pactLabel.textContent = `Pact (${pact.level})`;
			const pactPips = this._ce("div", "pm-slots__pips", pactWrap);

			for (let i = 0; i < pact.max; i++) {
				const pip = this._ce("span", `pm-slots__pip pm-slots__pip--${i < pact.current ? "filled" : "empty"}`, pactPips);
				pip.style.color = i < pact.current ? "var(--cs-accent-amethyst, #a855f7)" : "";
				this._makeClickable(pip, `Pact slot ${i + 1} (${i < pact.current ? "use" : "restore"})`, () => {
					const cur = this._state.getPactSlots();
					if (i < cur.current) {
						this._state.setPactSlotsCurrent(cur.current - 1);
					} else {
						this._state.setPactSlotsCurrent(Math.min(cur.max, cur.current + 1));
					}
					this._renderSpellsQuick();
				});
			}
		}

		// Cantrips
		const cantrips = spells.filter(s => s.level === 0);
		if (cantrips.length) {
			const cantripHeader = this._ce("div", "pm-card__header", card);
			const cantripTitle = this._ce("span", "pm-card__badge", cantripHeader);
			cantripTitle.textContent = `Cantrips (${cantrips.length})`;

			cantrips.slice(0, 8).forEach(spell => this._renderSpellRow(card, spell));

			if (cantrips.length > 8) {
				const more = this._ce("div", "pm-expander", card);
				more.textContent = `▸ Show all ${cantrips.length} cantrips...`;
				this._makeClickable(more, `Show all ${cantrips.length} cantrips`, () => this._openDrawerByType("spells"));
			}
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

	_renderSpellRow (parent, spell, {showPreparedToggle = false} = {}) {
		const wrapper = this._ce("div", "pm-spell-wrapper", parent);
		const row = this._ce("div", "pm-spell", wrapper);

		// Prepared toggle (for drawer only)
		if (showPreparedToggle && spell.level > 0 && !spell.alwaysPrepared) {
			const prepCb = this._ce("span", `pm-spell__prep ${spell.prepared ? "pm-spell__prep--active" : ""}`, row);
			prepCb.textContent = spell.prepared ? "✅" : "⬜";
			prepCb.title = spell.prepared ? "Unprepare" : "Prepare";
			this._makeClickable(prepCb, `${spell.prepared ? "Unprepare" : "Prepare"} ${spell.name}`, (e) => {
				e.stopPropagation();
				this._state.setSpellPrepared?.(spell.id, !spell.prepared);
				this._openDrawerByType("spells"); // re-render drawer
			});
		} else if (showPreparedToggle && spell.alwaysPrepared) {
			const prepBadge = this._ce("span", "pm-spell__prep pm-spell__prep--always", row);
			prepBadge.textContent = "🔒";
			prepBadge.title = "Always prepared";
		}

		const name = this._ce("span", "pm-spell__name", row);
		name.textContent = spell.name;

		const lvl = this._ce("span", "pm-spell__level", row);
		lvl.textContent = spell.level === 0 ? "C" : `L${spell.level}`;

		const meta = this._ce("span", "pm-spell__meta", row);
		const parts = [];
		if (spell.time) parts.push(spell.time);
		else if (spell.castingTime) parts.push(spell.castingTime);
		if (spell.school) parts.push(spell.school);
		if (spell.concentration) parts.push("conc.");
		if (spell.ritual) parts.push("🕯️");
		meta.textContent = parts.join(" · ");

		// Info button → full spell info modal (B1)
		const infoBtn = this._ce("button", "pm-spell__info", row);
		infoBtn.textContent = "ℹ️";
		infoBtn.title = "Spell details";
		infoBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showSpellInfoModal(spell, {showPreparedToggle});
		});

		// Note button (B3)
		const spellNote = this._state.getSpellNote?.(spell.id);
		const noteBtn = this._ce("button", `pm-note-btn${spellNote ? " pm-note-btn--active" : ""}`, row);
		noteBtn.textContent = "📝";
		noteBtn.title = spellNote ? `Note: ${spellNote.slice(0, 60)}${spellNote.length > 60 ? "…" : ""}` : "Add note";
		noteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showEntityNoteModal("spell", spell.id, spell.name, () => {
				this._renderSpellsQuick();
				if (this._openDrawer === "spells") this._openDrawerByType("spells");
			});
		});

		if (spell.level > 0) {
			const castBtn = this._ce("button", "pm-spell__cast", row);
			castBtn.textContent = "Cast";
			castBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._castSpell(spell);
			});

			// Ritual cast button (no slot cost)
			if (spell.ritual) {
				const ritualBtn = this._ce("button", "pm-spell__cast pm-spell__cast--ritual", row);
				ritualBtn.textContent = "🕯️";
				ritualBtn.title = "Cast as Ritual (no slot)";
				ritualBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (spell.concentration && this._state.isConcentrating?.()) {
						this._promptConcentrationBreak(spell, () => {
							if (spell.concentration) this._state.setConcentration?.({name: spell.name, level: spell.level});
							this._logActivity("🕯️", `Cast ${spell.name} as ritual (no slot)`);
							this._renderStatusBar();
						});
					} else {
						if (spell.concentration) this._state.setConcentration?.({name: spell.name, level: spell.level});
						this._logActivity("🕯️", `Cast ${spell.name} as ritual (no slot)`);
						this._renderStatusBar();
					}
				});
			}
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
						const featureId = feature.id || feature.name;
						if (i < feature.uses.current) {
							this._state.setFeatureUses?.(featureId, feature.uses.current - 1);
						} else {
							this._state.setFeatureUses?.(featureId, Math.min(feature.uses.max, feature.uses.current + 1));
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
					this._state.useFeature?.(feature.id || feature.name);
					this._renderFeaturesQuick();
					this._logActivity("⚡", `Used ${feature.name}`);
				});
			} else if (feature.uses?.max > 0) {
				const useBtn = this._ce("button", "pm-feature__use-btn pm-feature__use-btn--disabled", row);
				useBtn.textContent = "Used";
			}

			// Note button (B3)
			const featureId = feature.id || feature.name;
			const featureNote = this._state.getFeatureNote?.(featureId);
			const featureNoteBtn = this._ce("button", `pm-note-btn${featureNote ? " pm-note-btn--active" : ""}`, row);
			featureNoteBtn.textContent = "📝";
			featureNoteBtn.title = featureNote ? `Note: ${featureNote.slice(0, 60)}${featureNote.length > 60 ? "…" : ""}` : "Add note";
			featureNoteBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._showEntityNoteModal("feature", featureId, feature.name, () => this._renderFeaturesQuick());
			});

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

		// Custom abilities (homebrew)
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const actionableCustom = customAbilities.filter(a => (a.uses?.max > 0) || a.toggleable);
		if (actionableCustom.length) {
			actionableCustom.forEach(ability => {
				const row = this._ce("div", "pm-feature", card);

				if (ability.toggleable) {
					const toggle = this._ce("span", `pm-active-state__toggle`, row);
					toggle.textContent = ability.active ? "🟢" : "⚪";
					this._makeClickable(toggle, `${ability.active ? "Deactivate" : "Activate"} ${ability.name}`, (e) => {
						e.stopPropagation();
						ability.active = !ability.active;
						this._logActivity(ability.icon || "✨", `${ability.active ? "Activated" : "Deactivated"} ${ability.name}`);
						this._renderFeaturesQuick();
						this._renderStatusBar();
					});
				}

				const name = this._ce("span", "pm-feature__name", row);
				name.textContent = `${ability.icon || "✨"} ${ability.name}`;

				if (ability.uses?.max > 0 && ability.uses?.current > 0) {
					const useBtn = this._ce("button", "pm-feature__use-btn", row);
					useBtn.textContent = "Use";
					useBtn.addEventListener("click", (e) => {
						e.stopPropagation();
						this._state.useFeature?.(ability.id || ability.name);
						this._renderFeaturesQuick();
						this._logActivity(ability.icon || "✨", `Used ${ability.name}`);
					});
				}
			});
		}
	}

	_renderResources () {
		const hitDice = this._state.getHitDice();
		const resources = this._state.getResources();
		const sp = this._state.getSorceryPoints();
		const hasSp = sp.max > 0;
		const settings = this._state.getSettings?.() || {};
		const hasTgtt = settings.enableTgtt;
		const staminaMax = hasTgtt ? (this._state.getStaminaMax?.() || 0) : 0;

		if (!hitDice.length && !resources.length && !hasSp && !staminaMax) return;

		const card = this._makeCard(this._elActionsHub, "🎲", "Resources");
		const list = this._ce("div", "pm-resources", card);

		// Sorcery points
		if (hasSp) {
			const row = this._ce("div", "pm-resource", list);
			const name = this._ce("span", "pm-resource__name", row);
			name.textContent = "Sorcery Points";
			if (sp.max <= 20) {
				const pips = this._ce("div", "pm-resource__pips", row);
				for (let i = 0; i < sp.max; i++) {
					const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < sp.current ? "filled" : "empty"}`, pips);
					pip.style.color = i < sp.current ? "var(--cs-accent-amethyst, #a855f7)" : "";
					this._makeClickable(pip, `Sorcery Point ${i + 1}`, () => {
						const cur = this._state.getSorceryPoints();
						if (i < cur.current) {
							this._state.setSorceryPoints({current: cur.current - 1, max: cur.max});
						} else {
							this._state.setSorceryPoints({current: Math.min(cur.max, cur.current + 1), max: cur.max});
						}
						this._renderResources();
					});
				}
			} else {
				const text = this._ce("span", "pm-resource__text", row);
				text.textContent = `${sp.current}/${sp.max}`;
			}
		}

		// TGTT Stamina
		if (staminaMax > 0) {
			const staminaCur = this._state.getStaminaCurrent?.() || 0;
			const row = this._ce("div", "pm-resource", list);
			const name = this._ce("span", "pm-resource__name", row);
			name.textContent = "⚔️ Stamina";
			const pips = this._ce("div", "pm-resource__pips", row);
			for (let i = 0; i < staminaMax; i++) {
				const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < staminaCur ? "filled" : "empty"}`, pips);
				pip.style.color = i < staminaCur ? "var(--cs-accent-amber, #f59e0b)" : "";
				this._makeClickable(pip, `Stamina ${i + 1} (${i < staminaCur ? "spend" : "restore"})`, () => {
					const cur = this._state.getStaminaCurrent?.() || 0;
					if (i < cur) {
						this._state.setStaminaCurrent(cur - 1);
					} else {
						this._state.setStaminaCurrent(Math.min(staminaMax, cur + 1));
					}
					this._renderResources();
				});
			}
		}

		// Hit dice (getHitDice returns array [{type, die, current, max, className}])
		hitDice.forEach(hd => {
			if (!hd || hd.max <= 0) return;
			const row = this._ce("div", "pm-resource", list);
			const name = this._ce("span", "pm-resource__name", row);
			name.textContent = `Hit Dice (${hd.type})`;
			const pips = this._ce("div", "pm-resource__pips", row);

			for (let i = 0; i < hd.max; i++) {
				const pip = this._ce("span", `pm-resource__pip pm-resource__pip--${i < hd.current ? "filled" : "empty"}`, pips);
				const hdType = hd.type;
				this._makeClickable(pip, `Hit Die ${hd.type} ${i + 1} (${i < hd.current ? "use" : "restore"})`, () => {
					const fresh = this._state.getHitDice();
					const target = fresh.find(h => h.type === hdType);
					if (!target) return;
					if (i < target.current) {
						target.current--;
					} else {
						target.current = Math.min(target.max, target.current + 1);
					}
					this._state.setHitDice(fresh);
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
					const resId = res.id;
					this._makeClickable(pip, `${res.name} use ${i + 1} (${i < res.current ? "expend" : "restore"})`, () => {
						const fresh = this._state.getResources().find(r => r.id === resId);
						if (!fresh) return;
						const newVal = i < fresh.current ? fresh.current - 1 : Math.min(fresh.max, fresh.current + 1);
						this._state.setResourceCurrent?.(resId, newVal);
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
			modifiers: "🎯 Active Modifiers",
			settings: "⚙️ Settings",
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
			case "modifiers": this._renderModifiersDrawer(container); break;
			case "settings": this._renderSettingsDrawer(container); break;
		}
	}

	_renderSpellsDrawer (container) {
		// Phase A4: "+ Add Spell" button in header area
		const headerActions = this._ce("div", "pm-drawer-actions", container);
		const addSpellBtn = this._ce("button", "pm-drawer-actions__btn", headerActions);
		addSpellBtn.textContent = "+ Add Spell";
		addSpellBtn.title = "Open spell picker to add a spell";
		addSpellBtn.addEventListener("click", async () => {
			if (this._page._spells?._showSpellPicker) {
				await this._page._spells._showSpellPicker();
				this._openDrawerByType("spells");
			} else {
				document.getElementById("charsheet-btn-add-spell")?.click();
			}
		});

		const spells = this._state.getSpells();
		if (!spells.length) {
			this._renderEmptyState(container, "✨", "No spells known. Add spells using the button above.");
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

				byLevel[lvl].forEach(spell => this._renderSpellRow(spellsContainer, spell, {showPreparedToggle: true}));
			});

			if (!filtered.length) {
				this._renderEmptyState(spellsContainer, "🔍", `No spells matching "${filter}"`);
			}
		};

		searchInput.addEventListener("input", () => renderFiltered(searchInput.value));
		renderFiltered();
	}

	_renderGearDrawer (container) {
		// Phase A4: "+ Add Item" button in header area
		const headerActions = this._ce("div", "pm-drawer-actions", container);
		const addItemBtn = this._ce("button", "pm-drawer-actions__btn", headerActions);
		addItemBtn.textContent = "+ Add Item";
		addItemBtn.title = "Open item picker to add an item";
		addItemBtn.addEventListener("click", async () => {
			if (this._page._inventory?._showItemPicker) {
				await this._page._inventory._showItemPicker();
				this._openDrawerByType("gear");
			} else {
				document.getElementById("charsheet-btn-add-item")?.click();
			}
		});

		const items = this._state.getItems();

		// Attunement summary
		const attunedItems = this._state.getAttunedItems?.() || [];
		if (attunedItems.length) {
			const attCard = this._makeCard(container, "✨", `Attuned (${attunedItems.length}/3)`);
			attunedItems.forEach(item => {
				const row = this._ce("div", "pm-skill", attCard);
				const name = this._ce("span", "pm-skill__name", row);
				name.textContent = item.name;
			});
		}

		// Currency (editable)
		const allCoins = ["cp", "sp", "ep", "gp", "pp"];
		const currCard = this._makeCard(container, "💰", "Currency");
		const currRow = this._ce("div", "pm-passives", currCard);
		allCoins.forEach(c => {
			const cell = this._ce("div", "pm-passive", currRow);
			const input = this._ce("input", "pm-currency-input", cell);
			input.type = "number";
			input.min = "0";
			input.value = this._state.getCurrency(c) || 0;
			input.style.cssText = "width:50px;text-align:center;padding:2px 4px;border-radius:4px;border:1px solid var(--cs-border,#334155);background:var(--cs-bg-card,#0f172a);color:var(--cs-text-primary,#f1f5f9);font-size:0.9rem;";
			input.addEventListener("change", () => {
				const val = parseInt(input.value) || 0;
				this._state.setCurrency(c, Math.max(0, val));
				input.value = this._state.getCurrency(c);
			});
			const lbl = this._ce("span", "pm-passive__label", cell);
			lbl.textContent = c.toUpperCase();
		});

		// Carrying capacity
		const totalWeight = this._state.getTotalWeight?.();
		const capacity = this._state.getCarryingCapacity?.();
		if (capacity > 0) {
			const capRow = this._ce("div", "pm-carry-capacity", currCard);
			const pct = Math.min(100, (totalWeight / capacity) * 100);
			const encLevel = this._state.getEncumbranceLevel?.();
			capRow.textContent = `⚖️ ${Math.round(totalWeight)}/${capacity} lbs${encLevel ? ` (${encLevel})` : ""}`;
			if (pct > 100) capRow.style.color = "var(--cs-danger, #ef4444)";
			else if (pct > 66) capRow.style.color = "var(--cs-accent-amber, #f59e0b)";
		}

		// Equipped items (interactive)
		const equipped = items.filter(i => i.equipped);
		if (equipped.length) {
			const eqCard = this._makeCard(container, "⚔️", `Equipped (${equipped.length})`);
			equipped.forEach(item => this._renderItemRow(eqCard, item));
		}

		// All items (interactive)
		if (items.length) {
			const allCard = this._makeCard(container, "🎒", `All Items (${items.length})`);
			items.slice(0, 50).forEach(item => this._renderItemRow(allCard, item));
		} else {
			this._renderEmptyState(container, "🎒", "No items. Add items from the Inventory tab.");
		}
	}

	_renderItemRow (parent, item) {
		const row = this._ce("div", "pm-item", parent);

		// Equip toggle
		const equipBtn = this._ce("span", `pm-item__toggle ${item.equipped ? "pm-item__toggle--active" : ""}`, row);
		equipBtn.textContent = item.equipped ? "🛡️" : "⚪";
		equipBtn.title = item.equipped ? "Unequip" : "Equip";
		this._makeClickable(equipBtn, `${item.equipped ? "Unequip" : "Equip"} ${item.name}`, (e) => {
			e.stopPropagation();
			this._state.setItemEquipped?.(item.id, !item.equipped);
			this._openDrawerByType("gear");
		});

		// Name
		const name = this._ce("span", "pm-item__name", row);
		name.textContent = item.name;

		// Meta badges
		const metaWrap = this._ce("span", "pm-item__meta", row);

		// Attunement toggle (if item supports it)
		if (item.reqAttune || item.attuned) {
			const attuneBtn = this._ce("span", `pm-item__attune ${item.attuned ? "pm-item__attune--active" : ""}`, metaWrap);
			attuneBtn.textContent = item.attuned ? "✨" : "◇";
			attuneBtn.title = item.attuned ? "Unattune" : "Attune";
			this._makeClickable(attuneBtn, `${item.attuned ? "Unattune" : "Attune"} ${item.name}`, (e) => {
				e.stopPropagation();
				this._state.setItemAttuned?.(item.id, !item.attuned);
				this._openDrawerByType("gear");
			});
		}

		// Charges
		if (item.charges?.max > 0) {
			const charges = this._ce("span", "pm-item__charges", metaWrap);
			charges.textContent = `${item.charges.current}/${item.charges.max}`;
			charges.title = "Click to use charge";
			this._makeClickable(charges, `Use charge on ${item.name} (${item.charges.current} remaining)`, (e) => {
				e.stopPropagation();
				if (item.charges.current > 0) {
					this._state.useItemCharge?.(item.id);
					this._logActivity("⚡", `Used charge on ${item.name}`);
					this._openDrawerByType("gear");
				}
			});
		}

		// Quantity
		if (item.quantity > 1) {
			const qty = this._ce("span", "pm-item__qty", metaWrap);
			qty.textContent = `×${item.quantity}`;
		}

		// Consumable use button (potions, scrolls)
		if (item.consumable || item.type === "P" || item.type === "SC") {
			const useBtn = this._ce("button", "pm-item__use-btn", row);
			useBtn.textContent = "Use";
			useBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._state.consumeItem?.(item.id);
				this._logActivity("🧪", `Used ${item.name}`);
				this._openDrawerByType("gear");
			});
		}

		// Info button → item info modal (B2)
		const itemInfoBtn = this._ce("button", "pm-item__info-btn", row);
		itemInfoBtn.textContent = "ℹ️";
		itemInfoBtn.title = "Item details";
		itemInfoBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showItemInfoModal(item);
		});

		// Note button (B3)
		const itemNote = this._state.getItemNote?.(item.id);
		const itemNoteBtn = this._ce("button", `pm-note-btn${itemNote ? " pm-note-btn--active" : ""}`, row);
		itemNoteBtn.textContent = "📝";
		itemNoteBtn.title = itemNote ? `Note: ${itemNote.slice(0, 60)}${itemNote.length > 60 ? "…" : ""}` : "Add note";
		itemNoteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showEntityNoteModal("item", item.id, item.name, () => this._openDrawerByType("gear"));
		});
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
				const row = this._ce("div", "pm-feature pm-feature--expandable", card);
				const header = this._ce("div", "pm-feature__header", row);
				const name = this._ce("span", "pm-feature__name", header);
				name.textContent = f.name;
				if (f.uses?.max > 0) {
					const uses = this._ce("span", "pm-card__badge", header);
					uses.textContent = `${f.uses.current}/${f.uses.max}`;
				}

				// Note button (B3)
				const refFeatureId = f.id || f.name;
				const refNote = this._state.getFeatureNote?.(refFeatureId);
				const refNoteBtn = this._ce("button", `pm-note-btn${refNote ? " pm-note-btn--active" : ""}`, header);
				refNoteBtn.textContent = "📝";
				refNoteBtn.title = refNote ? `Note: ${refNote.slice(0, 60)}${refNote.length > 60 ? "…" : ""}` : "Add note";
				refNoteBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					this._showEntityNoteModal("feature", refFeatureId, f.name, () => this._openDrawerByType("reference"));
				});

				// Expandable description (rendered with Renderer for @tags and entries)
				if (f.description || f.entries) {
					const desc = this._ce("div", "pm-feature__desc", row);
					desc.style.display = "none";

					// Render entries with Renderer on first expand (lazy)
					let rendered = false;
					this._makeClickable(header, `Toggle description for ${f.name}`, () => {
						const showing = desc.style.display !== "none";
						if (!rendered && !showing) {
							if (f.entries) {
								this._renderEntries(desc, f.entries);
							} else if (f.description) {
								desc.textContent = f.description;
							}
							rendered = true;
						}
						desc.style.display = showing ? "none" : "block";
						row.classList.toggle("pm-feature--expanded", !showing);
					});
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

			// ── Interactive controls (B4) ────────────────────────────
			const controls = this._ce("div", "pm-companion__controls", card);

			// Heal button
			const healBtn = this._ce("button", "pm-companion__ctrl-btn pm-companion__ctrl-btn--heal", controls);
			healBtn.textContent = "💚 Heal";
			healBtn.title = "Heal companion";
			healBtn.addEventListener("click", () => this._promptCompanionHpChange(comp, "heal", container));

			// Damage button
			const dmgBtn = this._ce("button", "pm-companion__ctrl-btn pm-companion__ctrl-btn--damage", controls);
			dmgBtn.textContent = "💔 Damage";
			dmgBtn.title = "Damage companion";
			dmgBtn.addEventListener("click", () => this._promptCompanionHpChange(comp, "damage", container));

			// Statblock button
			const statblockBtn = this._ce("button", "pm-companion__ctrl-btn", controls);
			statblockBtn.textContent = "📊 Statblock";
			statblockBtn.title = "View full statblock";
			statblockBtn.addEventListener("click", () => this._showCompanionStatblockModal(comp));

			// Note button (B3)
			const compNote = this._state.getCompanionNote?.(comp.id);
			const compNoteBtn = this._ce("button", `pm-companion__ctrl-btn pm-note-btn${compNote ? " pm-note-btn--active" : ""}`, controls);
			compNoteBtn.textContent = "📝 Note";
			compNoteBtn.title = compNote ? `Note: ${compNote.slice(0, 60)}${compNote.length > 60 ? "…" : ""}` : "Add note";
			compNoteBtn.addEventListener("click", () => this._showEntityNoteModal("companion", comp.id, comp.name || "Companion", () => this._openDrawerByType("companions")));

			// Dismiss button
			const dismissBtn = this._ce("button", "pm-companion__ctrl-btn pm-companion__ctrl-btn--dismiss", controls);
			dismissBtn.textContent = "❌ Dismiss";
			dismissBtn.title = "Remove this companion";
			dismissBtn.addEventListener("click", () => {
				if (!confirm(`Remove ${comp.name || "this companion"}?`)) return;
				this._state.removeCompanion(comp.id);
				this._logActivity("🐾", `Dismissed ${comp.name || "companion"}`);
				this._openDrawerByType("companions");
			});

			// ── HP inline edit ──────────────────────────────────────
			if (comp.hp?.max) {
				const hpRow = this._ce("div", "pm-companion__hp-row", card);
				const hpLabel = this._ce("span", "pm-companion__hp-label", hpRow);
				hpLabel.textContent = "HP";

				const hpInput = this._ce("input", "pm-companion__hp-input", hpRow);
				hpInput.type = "number";
				hpInput.min = "0";
				hpInput.max = String(comp.hp.max);
				hpInput.value = String(comp.hp.current ?? comp.hp.max);
				hpInput.setAttribute("aria-label", `${comp.name || "Companion"} current HP`);
				hpInput.addEventListener("change", () => {
					const val = parseInt(hpInput.value);
					if (!isNaN(val)) {
						this._state.setCompanionHp(comp.id, val);
						this._logActivity("🐾", `${comp.name} HP → ${val}/${comp.hp.max}`);
					}
				});

				const hpMax = this._ce("span", "pm-companion__hp-max", hpRow);
				hpMax.textContent = `/ ${comp.hp.max}`;

				// HP bar
				const hpBarWrap = this._ce("div", "pm-companion__hp-bar-wrap", card);
				const pct = comp.hp.max > 0 ? Math.max(0, Math.min(100, ((comp.hp.current ?? comp.hp.max) / comp.hp.max) * 100)) : 0;
				const hpBarFill = this._ce("div", "pm-companion__hp-bar-fill", hpBarWrap);
				hpBarFill.style.width = `${pct}%`;
				if (pct <= 25) hpBarFill.classList.add("pm-companion__hp-bar-fill--critical");
				else if (pct <= 50) hpBarFill.classList.add("pm-companion__hp-bar-fill--bloodied");
			}

			// ── Stats row ───────────────────────────────────────────
			const stats = this._ce("div", "pm-passives", card);
			if (comp.ac) {
				const acCell = this._ce("div", "pm-passive", stats);
				const acVal = this._ce("span", "pm-passive__value", acCell);
				acVal.textContent = comp.ac;
				const acLbl = this._ce("span", "pm-passive__label", acCell);
				acLbl.textContent = "AC";
			}
			if (comp.speed) {
				const spdCell = this._ce("div", "pm-passive", stats);
				const spdVal = this._ce("span", "pm-passive__value", spdCell);
				const walkSpeed = typeof comp.speed === "object" ? (comp.speed.walk || 0) : comp.speed;
				spdVal.textContent = `${walkSpeed}ft`;
				const spdLbl = this._ce("span", "pm-passive__label", spdCell);
				spdLbl.textContent = "Speed";

				if (typeof comp.speed === "object") {
					["fly", "swim", "climb", "burrow"].forEach(type => {
						if (comp.speed[type] > 0) {
							const extraCell = this._ce("div", "pm-passive", stats);
							const extraVal = this._ce("span", "pm-passive__value", extraCell);
							extraVal.textContent = `${comp.speed[type]}ft`;
							const extraLbl = this._ce("span", "pm-passive__label", extraCell);
							extraLbl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
						}
					});
				}
			}

			// Type
			if (comp.type) {
				const type = this._ce("div", null, card);
				type.style.fontSize = "var(--cs-text-sm, 0.875rem)";
				type.style.color = "var(--cs-text-secondary, #94a3b8)";
				type.textContent = comp.type;
			}

			// Existing note preview
			if (compNote) {
				const notePreview = this._ce("div", "pm-companion__note-preview", card);
				notePreview.textContent = `📝 ${compNote.slice(0, 100)}${compNote.length > 100 ? "…" : ""}`;
			}

			// Actions (5etools entries format: [{name, entries}])
			const actions = comp.actions || comp.attacks || [];
			if (actions.length) {
				const actHeader = this._ce("div", "pm-card__header", card);
				const actTitle = this._ce("span", "pm-card__badge", actHeader);
				actTitle.textContent = `Actions (${actions.length})`;

				actions.forEach(action => {
					const row = this._ce("div", "pm-feature pm-feature--expandable", card);
					const header = this._ce("div", "pm-feature__header", row);
					const name = this._ce("span", "pm-feature__name", header);
					name.textContent = action.name;

					if (action.entries) {
						const desc = this._ce("div", "pm-feature__desc", row);
						desc.style.display = "none";

						let rendered = false;
						this._makeClickable(header, `Toggle ${action.name} description`, () => {
							const showing = desc.style.display !== "none";
							if (!rendered && !showing) {
								this._renderEntries(desc, action.entries);
								rendered = true;
							}
							desc.style.display = showing ? "none" : "block";
							row.classList.toggle("pm-feature--expanded", !showing);
						});
					}
				});
			}

			// Reactions
			if (comp.reactions?.length) {
				const reactHeader = this._ce("div", "pm-card__header", card);
				const reactTitle = this._ce("span", "pm-card__badge", reactHeader);
				reactTitle.textContent = `Reactions (${comp.reactions.length})`;

				comp.reactions.forEach(reaction => {
					const row = this._ce("div", "pm-feature pm-feature--expandable", card);
					const header = this._ce("div", "pm-feature__header", row);
					const name = this._ce("span", "pm-feature__name", header);
					name.textContent = reaction.name;

					if (reaction.entries) {
						const desc = this._ce("div", "pm-feature__desc", row);
						desc.style.display = "none";
						let rendered = false;
						this._makeClickable(header, `Toggle ${reaction.name} description`, () => {
							const showing = desc.style.display !== "none";
							if (!rendered && !showing) {
								this._renderEntries(desc, reaction.entries);
								rendered = true;
							}
							desc.style.display = showing ? "none" : "block";
							row.classList.toggle("pm-feature--expanded", !showing);
						});
					}
				});
			}
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
			this._page._rollAttack(fav.ref, null);
			this._logActivity(fav.icon, `Attacked with ${fav.name}`);
		} else if (fav.type === "spell" && fav.ref) {
			this._castSpell(fav.ref);
		} else if (fav.type === "feature" && fav.ref) {
			this._state.useFeature?.(fav.ref.id || fav.ref.name);
			this.render();
			this._logActivity("⚡", `Used ${fav.name}`);
		}
	}

	// ─── Spell Casting ──────────────────────────────────────────

	_castSpell (spell) {
		if (spell.level === 0) {
			// Cantrip concentration check
			if (spell.concentration && this._state.isConcentrating?.()) {
				this._promptConcentrationBreak(spell, () => {
					this._state.setConcentration?.({name: spell.name, level: 0});
					this._logActivity("✨", `Cast ${spell.name} (cantrip, concentration)`);
					this._renderStatusBar();
				});
				return;
			}
			if (spell.concentration) {
				this._state.setConcentration?.({name: spell.name, level: 0});
			}
			this._logActivity("✨", `Cast ${spell.name} (cantrip)`);
			if (spell.concentration) this._renderStatusBar();
			return;
		}

		// Collect available slot levels at or above spell level
		const available = [];
		for (let lvl = spell.level; lvl <= 9; lvl++) {
			const cur = this._state.getSpellSlotsCurrent(lvl);
			const max = this._state.getSpellSlotsMax(lvl);
			if (max > 0) available.push({level: lvl, current: cur, max});
		}

		// Also check Pact Magic slots
		const pact = this._state.getPactSlots();
		if (pact.max > 0 && pact.level >= spell.level && pact.current > 0) {
			available.push({level: pact.level, current: pact.current, max: pact.max, isPact: true});
		}

		if (!available.length || !available.some(s => s.current > 0)) {
			JqueryUtil?.doToast?.({type: "warning", content: `No spell slots available to cast ${spell.name}!`});
			return;
		}

		// If only one slot source, cast immediately
		const usable = available.filter(s => s.current > 0);
		if (usable.length === 1) {
			this._executeCast(spell, usable[0]);
			return;
		}

		// Show upcast picker inline
		this._showUpcastPicker(spell, available);
	}

	_executeCast (spell, slot) {
		// Concentration check before casting
		if (spell.concentration && this._state.isConcentrating?.()) {
			this._promptConcentrationBreak(spell, () => {
				this._doExecuteCast(spell, slot);
			});
			return;
		}
		this._doExecuteCast(spell, slot);
	}

	_doExecuteCast (spell, slot) {
		if (slot.isPact) {
			this._state.setPactSlotsCurrent(slot.current - 1);
		} else {
			this._state.setSpellSlotCurrent(slot.level, slot.current - 1);
		}

		// Set concentration
		if (spell.concentration) {
			this._state.setConcentration?.({name: spell.name, level: slot.level});
		}

		const slotLabel = slot.isPact ? `pact slot (lvl ${slot.level})` : (slot.level === spell.level ? `level ${slot.level}` : `upcast level ${slot.level}`);
		this._logActivity("✨", `Cast ${spell.name} (${slotLabel})`);
		this._renderSpellsQuick();
		this._renderStatusBar();
	}

	_promptConcentrationBreak (newSpell, onConfirm) {
		const concentrating = this._state.getActiveStates().find(s => s.stateTypeId === "concentration" && s.active);
		const currentName = concentrating?.name || "a spell";

		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = "🔮 Already Concentrating";

		const desc = this._ce("div", "pm-modal__subtitle", panel);
		desc.textContent = `You are concentrating on ${currentName}. Casting ${newSpell.name} will break concentration.`;

		const btnRow = this._ce("div", "pm-modal__buttons", panel);

		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Keep Concentration";

		const castBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		castBtn.textContent = "Cast & Break";

		cancelBtn.addEventListener("click", () => overlay.remove());
		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

		castBtn.addEventListener("click", () => {
			overlay.remove();
			this._state.breakConcentration?.();
			this._logActivity("🔮", `Broke concentration on ${currentName}`);
			onConfirm();
		});

		document.body.appendChild(overlay);
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
			const ordinal = slot.level === 1 ? "1st" : slot.level === 2 ? "2nd" : slot.level === 3 ? "3rd" : `${slot.level}th`;
			lvl.textContent = slot.isPact ? `Pact (${ordinal})` : ordinal;

			const pips = this._ce("span", "pm-upcast__pips", btn);
			for (let i = 0; i < slot.max; i++) {
				const pip = this._ce("span", `pm-upcast__pip ${i < slot.current ? "pm-upcast__pip--filled" : ""}`, pips);
				pip.textContent = i < slot.current ? "●" : "○";
			}

			if (slot.level > spell.level && !slot.isPact) {
				const tag = this._ce("span", "pm-upcast__tag", btn);
				tag.textContent = "upcast";
			}

			if (slot.current > 0) {
				btn.addEventListener("click", () => {
					overlay.remove();
					this._executeCast(spell, slot);
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

	// ─── Rest Handlers ──────────────────────────────────────────

	/** Phase A3: Delegate directly to full rest dialogs (no extra preview step). */
	_doShortRest () {
		if (this._page._rest?._showShortRestDialog) {
			this._page._rest._showShortRestDialog();
			this._logActivity("🏕️", "Short Rest started");
		} else {
			// Fallback if rest module unavailable
			this._showRestPreview("short");
		}
	}

	_doLongRest () {
		if (this._page._rest?._showLongRestDialog) {
			this._page._rest._showLongRestDialog();
			this._logActivity("🛏️", "Long Rest started");
		} else {
			// Fallback if rest module unavailable
			this._showRestPreview("long");
		}
	}

	// ─── Rest Preview (legacy fallback) ─────────────────────────

	// ─── Phase B1: Spell Info Modal ─────────────────────────────

	_showSpellInfoModal (spell, {showPreparedToggle = false} = {}) {
		const SCHOOL_NAMES = {A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation"};
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal pm-modal--info", overlay);

		// Title + source
		const titleRow = this._ce("div", "pm-modal__title-row", panel);
		const title = this._ce("div", "pm-modal__title", titleRow);
		title.textContent = spell.name;
		if (spell.source) {
			const src = this._ce("span", "pm-modal__source-badge", titleRow);
			src.textContent = spell.source;
		}

		// Badges: concentration / ritual
		const badges = this._ce("div", "pm-modal__badges", panel);
		if (spell.concentration) {
			const conc = this._ce("span", "pm-modal__badge pm-modal__badge--conc", badges);
			conc.textContent = "🔮 Concentration";
		}
		if (spell.ritual) {
			const rit = this._ce("span", "pm-modal__badge pm-modal__badge--ritual", badges);
			rit.textContent = "🕯️ Ritual";
		}

		// Chips row
		const chips = this._ce("div", "pm-modal__chips", panel);
		const levelText = spell.level === 0 ? "Cantrip" : `Level ${spell.level}`;
		this._makeChip(chips, levelText);
		if (spell.school) this._makeChip(chips, SCHOOL_NAMES[spell.school] || spell.school);
		if (spell.time) this._makeChip(chips, `⏱ ${spell.time}`);
		else if (spell.castingTime) this._makeChip(chips, `⏱ ${spell.castingTime}`);
		if (spell.range) this._makeChip(chips, `🎯 ${spell.range}`);
		if (spell.duration) this._makeChip(chips, spell.concentration ? `🔮 ${spell.duration}` : `⌛ ${spell.duration}`);
		if (spell.components) this._makeChip(chips, `📦 ${typeof spell.components === "object" ? Object.keys(spell.components).map(k => k.toUpperCase()).join(", ") : spell.components}`);

		// Classes
		if (spell.classes?.length) {
			const classRow = this._ce("div", "pm-modal__section", panel);
			const classLabel = this._ce("div", "pm-modal__section-title", classRow);
			classLabel.textContent = "Classes";
			const classBody = this._ce("div", "pm-modal__section-body", classRow);
			classBody.textContent = Array.isArray(spell.classes)
				? spell.classes.map(c => (typeof c === "string" ? c : c.name || c)).join(", ")
				: String(spell.classes);
		}

		// Scrollable description body
		const body = this._ce("div", "pm-modal__scroll-body", panel);
		if (spell.entries) {
			this._renderEntries(body, spell.entries);
		} else if (spell.description) {
			const text = this._ce("div", "pm-rendered-content", body);
			text.textContent = spell.description;
		}

		// At Higher Levels
		if (spell.entriesHigherLevel) {
			const hlSection = this._ce("div", "pm-modal__section pm-modal__section--higher", body);
			const hlLabel = this._ce("div", "pm-modal__section-title", hlSection);
			hlLabel.textContent = "At Higher Levels";
			this._renderEntries(hlSection, spell.entriesHigherLevel);
		}

		// Material components detail
		if (typeof spell.components === "object" && typeof spell.components?.m === "string") {
			const matSection = this._ce("div", "pm-modal__section", body);
			const matLabel = this._ce("div", "pm-modal__section-title", matSection);
			matLabel.textContent = "Material";
			const matBody = this._ce("div", "pm-modal__section-body", matSection);
			matBody.textContent = spell.components.m;
		}

		// Footer buttons
		const btnRow = this._ce("div", "pm-modal__buttons pm-modal__buttons--wrap", panel);
		if (spell.level > 0) {
			const castBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
			castBtn.textContent = "✨ Cast";
			castBtn.addEventListener("click", () => { overlay.remove(); this._castSpell(spell); });
		}
		if (spell.ritual) {
			const ritualBtn = this._ce("button", "pm-modal__btn pm-modal__btn--ritual", btnRow);
			ritualBtn.textContent = "🕯️ Ritual";
			ritualBtn.title = "Cast as Ritual (no slot)";
			ritualBtn.addEventListener("click", () => {
				overlay.remove();
				if (spell.concentration && this._state.isConcentrating?.()) {
					this._promptConcentrationBreak(spell, () => {
						if (spell.concentration) this._state.setConcentration?.({name: spell.name, level: spell.level});
						this._logActivity("🕯️", `Cast ${spell.name} as ritual (no slot)`);
						this._renderStatusBar();
					});
				} else {
					if (spell.concentration) this._state.setConcentration?.({name: spell.name, level: spell.level});
					this._logActivity("🕯️", `Cast ${spell.name} as ritual (no slot)`);
					this._renderStatusBar();
				}
			});
		}
		if (showPreparedToggle && spell.level > 0 && !spell.alwaysPrepared) {
			const prepBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
			prepBtn.textContent = spell.prepared ? "⬜ Unprepare" : "✅ Prepare";
			prepBtn.addEventListener("click", () => {
				this._state.setSpellPrepared?.(spell.id, !spell.prepared);
				overlay.remove();
				this._openDrawerByType("spells");
			});
		}
		const favBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		favBtn.textContent = this._isFavorite("spell", spell.name) ? "⭐ Unfav" : "⭐ Fav";
		favBtn.addEventListener("click", () => {
			this._toggleFavorite({id: `spell:${spell.name}`, type: "spell", name: spell.name, icon: "✨", detail: spell.level === 0 ? "Cantrip" : `Level ${spell.level}`, ref: spell});
			overlay.remove();
		});
		const noteBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		noteBtn.textContent = "📝 Note";
		noteBtn.addEventListener("click", () => {
			overlay.remove();
			this._showEntityNoteModal("spell", spell.id, spell.name, () => {
				this._renderSpellsQuick();
				if (this._openDrawer === "spells") this._openDrawerByType("spells");
			});
		});
		const closeBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		closeBtn.textContent = "Close";
		closeBtn.addEventListener("click", () => overlay.remove());

		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
		document.addEventListener("keydown", function esc (e) {
			if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
		});
		document.body.appendChild(overlay);
	}

	// ─── Phase B2: Item Info Modal ───────────────────────────────

	_showItemInfoModal (item) {
		const ITEM_TYPE_NAMES = {M: "Melee Weapon", R: "Ranged Weapon", A: "Ammunition", LA: "Light Armor", MA: "Medium Armor", HA: "Heavy Armor", S: "Shield", SCF: "Spellcasting Focus", G: "Gear", P: "Potion", RD: "Rod", RG: "Ring", SC: "Scroll", WD: "Wand", ST: "Staff", W: "Wondrous Item"};
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal pm-modal--info", overlay);

		// Title + rarity badge
		const titleRow = this._ce("div", "pm-modal__title-row", panel);
		const title = this._ce("div", "pm-modal__title", titleRow);
		title.textContent = item.name;
		if (item.rarity && item.rarity !== "none") {
			const rar = this._ce("span", `pm-modal__rarity-badge pm-modal__rarity-badge--${item.rarity.toLowerCase().replace(/\s+/g, "-")}`, titleRow);
			rar.textContent = item.rarity;
		}

		// Chips
		const chips = this._ce("div", "pm-modal__chips", panel);
		if (item.type) this._makeChip(chips, ITEM_TYPE_NAMES[item.type] || item.type);
		if (item.weight) this._makeChip(chips, `⚖️ ${item.weight} lb`);
		if (item.value) {
			const gp = item.value / 100;
			this._makeChip(chips, `💰 ${Number.isInteger(gp) ? `${gp} gp` : `${(item.value / 10).toFixed(1)} sp`}`);
		}

		// Properties
		const props = item.property || item.properties || [];
		const PROP_NAMES = {F: "Finesse", L: "Light", T: "Thrown", H: "Heavy", V: "Versatile", A: "Ammunition", R: "Reach", S: "Special", "2H": "Two-Handed"};
		if (props.length) {
			const propChips = this._ce("div", "pm-modal__chips", panel);
			props.forEach(p => {
				const pName = typeof p === "string" ? (PROP_NAMES[p] || p.split("|")[0]) : String(p);
				this._makeChip(propChips, pName, "pm-modal__chip--prop");
			});
		}

		// Attunement note
		if (item.reqAttune || item.attunement) {
			const attuneNote = this._ce("div", "pm-modal__subtitle", panel);
			attuneNote.textContent = `✨ ${typeof item.reqAttune === "string" ? item.reqAttune : (item.attunement || "Requires attunement")}`;
		}

		// Charges
		if (item.charges?.max > 0) {
			const chargeSection = this._ce("div", "pm-modal__section", panel);
			const chargeLabel = this._ce("div", "pm-modal__section-title", chargeSection);
			chargeLabel.textContent = `Charges: ${item.charges.current}/${item.charges.max}`;
			const chargeControls = this._ce("div", "pm-item__charge-controls", chargeSection);

			const useChargeBtn = this._ce("button", "pm-modal__btn pm-modal__btn--damage", chargeControls);
			useChargeBtn.textContent = "− Use";
			useChargeBtn.disabled = item.charges.current <= 0;
			useChargeBtn.addEventListener("click", () => {
				if (item.charges.current > 0) {
					this._state.useItemCharge?.(item.id);
					this._logActivity("⚡", `Used charge on ${item.name}`);
					overlay.remove();
					this._openDrawerByType("gear");
				}
			});
			const restoreBtn = this._ce("button", "pm-modal__btn pm-modal__btn--heal", chargeControls);
			restoreBtn.textContent = "+ Restore";
			restoreBtn.disabled = item.charges.current >= item.charges.max;
			restoreBtn.addEventListener("click", () => {
				this._state.setItemCharges?.(item.id, Math.min(item.charges.max, item.charges.current + 1));
				overlay.remove();
				this._openDrawerByType("gear");
			});
			const setRow = this._ce("div", "pm-item__charge-set-row", chargeSection);
			const setInput = this._ce("input", "pm-modal__input pm-item__charge-set-input", setRow);
			setInput.type = "number";
			setInput.min = "0";
			setInput.max = String(item.charges.max);
			setInput.placeholder = "Set charges…";
			const setBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", setRow);
			setBtn.textContent = "Set";
			setBtn.addEventListener("click", () => {
				const val = parseInt(setInput.value);
				if (!isNaN(val)) {
					this._state.setItemCharges?.(item.id, Math.max(0, Math.min(item.charges.max, val)));
					overlay.remove();
					this._openDrawerByType("gear");
				}
			});
		}

		// Quantity
		const qtySection = this._ce("div", "pm-modal__section", panel);
		const qtyLabel = this._ce("div", "pm-modal__section-title", qtySection);
		qtyLabel.textContent = "Quantity";
		const qtyRow = this._ce("div", "pm-item__qty-row", qtySection);
		const qtyMinus = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", qtyRow);
		qtyMinus.textContent = "−";
		const qtyInput = this._ce("input", "pm-modal__input pm-item__qty-input", qtyRow);
		qtyInput.type = "number";
		qtyInput.min = "0";
		qtyInput.value = String(item.quantity ?? 1);
		const qtyPlus = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", qtyRow);
		qtyPlus.textContent = "+";
		const applyQty = (delta) => {
			const next = Math.max(0, (parseInt(qtyInput.value) || 0) + delta);
			qtyInput.value = String(next);
			this._state.setItemQuantity?.(item.id, next);
		};
		qtyMinus.addEventListener("click", () => applyQty(-1));
		qtyPlus.addEventListener("click", () => applyQty(1));

		// Equipped / Attuned toggles
		const toggleRow = this._ce("div", "pm-item__toggle-row", panel);
		if (item.weapon || item.armor || item.type === "S" || item.type === "LA" || item.type === "MA" || item.type === "HA") {
			const equipToggle = this._ce("button", `pm-modal__btn ${item.equipped ? "pm-modal__btn--confirm" : "pm-modal__btn--cancel"}`, toggleRow);
			equipToggle.textContent = item.equipped ? "🛡️ Equipped" : "⚪ Unequipped";
			equipToggle.addEventListener("click", () => {
				this._state.setItemEquipped?.(item.id, !item.equipped);
				overlay.remove();
				this._openDrawerByType("gear");
			});
		}
		if (item.reqAttune || item.attuned) {
			const attuneToggle = this._ce("button", `pm-modal__btn ${item.attuned ? "pm-modal__btn--confirm" : "pm-modal__btn--cancel"}`, toggleRow);
			attuneToggle.textContent = item.attuned ? "✨ Attuned" : "◇ Unattuned";
			attuneToggle.addEventListener("click", () => {
				this._state.setItemAttuned?.(item.id, !item.attuned);
				overlay.remove();
				this._openDrawerByType("gear");
			});
		}

		// Description
		if (item.entries?.length || item.description) {
			const descSection = this._ce("div", "pm-modal__scroll-body", panel);
			if (item.entries?.length) this._renderEntries(descSection, item.entries);
			else { const t = this._ce("div", "pm-rendered-content", descSection); t.textContent = item.description; }
		}

		// Footer buttons
		const btnRow = this._ce("div", "pm-modal__buttons pm-modal__buttons--wrap", panel);
		if (item.consumable || item.type === "P" || item.type === "SC") {
			const useBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
			useBtn.textContent = item.type === "P" ? "🧪 Drink" : item.type === "SC" ? "📜 Cast" : "Use";
			useBtn.addEventListener("click", () => {
				this._state.consumeItem?.(item.id);
				this._logActivity("🧪", `Used ${item.name}`);
				overlay.remove();
				this._openDrawerByType("gear");
			});
		}
		const noteBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		noteBtn.textContent = "📝 Note";
		noteBtn.addEventListener("click", () => {
			overlay.remove();
			this._showEntityNoteModal("item", item.id, item.name, () => this._openDrawerByType("gear"));
		});
		const removeBtn = this._ce("button", "pm-modal__btn pm-modal__btn--damage", btnRow);
		removeBtn.textContent = "🗑️ Remove";
		removeBtn.addEventListener("click", () => {
			if (!confirm(`Remove ${item.name} from inventory?`)) return;
			this._state.removeItem?.(item.id);
			overlay.remove();
			this._openDrawerByType("gear");
		});
		const closeBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		closeBtn.textContent = "Close";
		closeBtn.addEventListener("click", () => overlay.remove());

		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
		document.addEventListener("keydown", function esc (e) {
			if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
		});
		document.body.appendChild(overlay);
	}

	// ─── Phase B3: Entity Note Modal (shared helper) ─────────────

	_showEntityNoteModal (entityType, entityId, name, onSave) {
		const getters = {
			spell: () => this._state.getSpellNote?.(entityId),
			item: () => this._state.getItemNote?.(entityId),
			attack: () => this._state.getAttackNote?.(entityId),
			feature: () => this._state.getFeatureNote?.(entityId),
			feat: () => this._state.getFeatNote?.(entityId),
			companion: () => this._state.getCompanionNote?.(entityId),
		};
		const setters = {
			spell: (note) => this._state.updateSpellNote?.(entityId, note),
			item: (note) => this._state.updateItemNote?.(entityId, note),
			attack: (note) => this._state.updateAttackNote?.(entityId, note),
			feature: (note) => this._state.updateFeatureNote?.(entityId, note),
			feat: (note) => this._state.updateFeatNote?.(entityId, note),
			companion: (note) => this._state.updateCompanionNote?.(entityId, note),
		};
		const currentNote = (getters[entityType] || getters["feature"])?.() || "";

		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = `📝 Note: ${name}`;

		const textarea = this._ce("textarea", "pm-note-modal__textarea", panel);
		textarea.value = currentNote;
		textarea.placeholder = "Write a note…";
		textarea.rows = 5;

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const saveBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		saveBtn.textContent = "Save";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		const save = () => {
			(setters[entityType] || setters["feature"])?.(textarea.value.trim());
			close();
			onSave?.();
		};
		saveBtn.addEventListener("click", save);
		textarea.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

		document.body.appendChild(overlay);
		textarea.focus();
	}

	// ─── Phase B4: Companion HP prompts and Statblock modal ──────

	_promptCompanionHpChange (comp, mode, container) {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = mode === "heal" ? `💚 Heal ${comp.name}` : `💔 Damage ${comp.name}`;

		const row = this._ce("div", "pm-modal__row", panel);
		const input = this._ce("input", "pm-modal__input", row);
		input.type = "number";
		input.min = "1";
		input.placeholder = "Amount";

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const applyBtn = this._ce("button", `pm-modal__btn pm-modal__btn--${mode}`, btnRow);
		applyBtn.textContent = mode === "heal" ? "Heal" : "Apply";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		const apply = () => {
			const val = parseInt(input.value);
			if (isNaN(val) || val <= 0) return;
			const curHp = comp.hp?.current ?? comp.hp?.max ?? 0;
			if (mode === "heal") {
				const newHp = Math.min(comp.hp?.max ?? curHp, curHp + val);
				this._state.setCompanionHp(comp.id, newHp);
				this._logActivity("💚", `Healed ${comp.name} ${val} HP (${curHp} → ${newHp})`);
			} else {
				const result = this._state.damageCompanion(comp.id, val);
				const suffix = result?.tempAbsorbed > 0 ? ` (${result.tempAbsorbed} absorbed)` : "";
				if (result?.droppedToZero) {
					this._logActivity("💀", `${comp.name} dropped to 0 HP${suffix}`);
				} else {
					const hpLost = result?.hpLost ?? val;
					const remaining = result?.remaining ?? Math.max(0, curHp - val);
					this._logActivity("💔", `${comp.name} took ${hpLost} damage → ${remaining} HP${suffix}`);
				}
			}
			close();
			this._openDrawerByType("companions");
		};
		applyBtn.addEventListener("click", apply);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") close(); });

		document.body.appendChild(overlay);
		input.focus();
	}

	_showCompanionStatblockModal (comp) {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal pm-modal--statblock", overlay);

		const titleRow = this._ce("div", "pm-modal__title-row", panel);
		const title = this._ce("div", "pm-modal__title", titleRow);
		title.textContent = comp.name || "Companion";
		if (comp.type) {
			const typeEl = this._ce("span", "pm-modal__source-badge", titleRow);
			typeEl.textContent = comp.type;
		}

		const body = this._ce("div", "pm-modal__scroll-body", panel);

		// Core stats row
		const stats = this._ce("div", "pm-statblock__stats", body);
		const statCells = [];
		if (comp.hp?.max != null) statCells.push(["HP", `${comp.hp.current ?? comp.hp.max}/${comp.hp.max}${(comp.hp.temp > 0) ? `+${comp.hp.temp}` : ""}`]);
		if (comp.ac != null) statCells.push(["AC", String(comp.ac)]);
		if (comp.speed != null) {
			const walk = typeof comp.speed === "object" ? (comp.speed.walk || 0) : comp.speed;
			statCells.push(["Speed", `${walk}ft`]);
		}
		statCells.forEach(([lbl, val]) => {
			const cell = this._ce("div", "pm-statblock__stat-cell", stats);
			const v = this._ce("span", "pm-statblock__stat-val", cell);
			v.textContent = val;
			const l = this._ce("span", "pm-statblock__stat-label", cell);
			l.textContent = lbl;
		});

		// Ability scores
		const abData = comp.abilities || comp;
		const ABILITIES_LIST = ["str", "dex", "con", "int", "wis", "cha"];
		const hasAbilities = ABILITIES_LIST.some(ab => abData[ab] != null);
		if (hasAbilities) {
			const abRow = this._ce("div", "pm-statblock__abilities", body);
			ABILITIES_LIST.forEach(ab => {
				const score = abData[ab];
				if (score == null) return;
				const mod = Math.floor((score - 10) / 2);
				const cell = this._ce("div", "pm-statblock__ability-cell", abRow);
				const abLabel = this._ce("div", "pm-statblock__ability-label", cell);
				abLabel.textContent = ab.toUpperCase();
				const abScore = this._ce("div", "pm-statblock__ability-score", cell);
				abScore.textContent = score;
				const abMod = this._ce("div", "pm-statblock__ability-mod", cell);
				abMod.textContent = this._fmtMod(mod);
			});
		}

		// Entries
		if (comp.entries?.length) {
			this._renderEntries(body, comp.entries);
		}

		// Actions
		const actions = comp.actions || comp.attacks || [];
		if (actions.length) {
			const actHead = this._ce("div", "pm-statblock__section-header", body);
			actHead.textContent = "Actions";
			actions.forEach(action => {
				const actionRow = this._ce("div", "pm-statblock__action", body);
				const aName = this._ce("strong", null, actionRow);
				aName.textContent = `${action.name}. `;
				if (action.entries) this._renderEntries(actionRow, action.entries);
			});
		}

		// Reactions
		if (comp.reactions?.length) {
			const reactHead = this._ce("div", "pm-statblock__section-header", body);
			reactHead.textContent = "Reactions";
			comp.reactions.forEach(reaction => {
				const reactionRow = this._ce("div", "pm-statblock__action", body);
				const rName = this._ce("strong", null, reactionRow);
				rName.textContent = `${reaction.name}. `;
				if (reaction.entries) this._renderEntries(reactionRow, reaction.entries);
			});
		}

		// Note
		const note = this._state.getCompanionNote?.(comp.id);
		if (note) {
			const noteSection = this._ce("div", "pm-modal__section", body);
			const noteLabel = this._ce("div", "pm-modal__section-title", noteSection);
			noteLabel.textContent = "Note";
			const noteBody = this._ce("div", "pm-modal__section-body", noteSection);
			noteBody.style.whiteSpace = "pre-wrap";
			noteBody.textContent = note;
		}

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const noteBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		noteBtn.textContent = "📝 Note";
		noteBtn.addEventListener("click", () => {
			overlay.remove();
			this._showEntityNoteModal("companion", comp.id, comp.name || "Companion", () => this._openDrawerByType("companions"));
		});
		const closeBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		closeBtn.textContent = "Close";
		closeBtn.addEventListener("click", () => overlay.remove());

		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
		document.addEventListener("keydown", function esc (e) {
			if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
		});
		document.body.appendChild(overlay);
	}

	/** Build a chip element for modal chip rows */
	_makeChip (parent, text, extraClass = "") {
		const chip = this._ce("span", `pm-modal__chip${extraClass ? ` ${extraClass}` : ""}`, parent);
		chip.textContent = text;
		return chip;
	}

	// ─── Rest Preview (legacy fallback) ─────────────────────────

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
			return (r.recharge === "short" || r.recharge === "short rest") && r.current < r.max;
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

	/** Render 5etools entries/description as HTML using the global Renderer */
	_renderEntries (parent, entries) {
		if (!entries) return;
		try {
			const toRender = Array.isArray(entries) ? {type: "entries", entries} : entries;
			const html = Renderer.get().render(toRender);
			if (html) {
				const wrap = this._ce("div", "pm-rendered-content", parent);
				wrap.innerHTML = html;
				return wrap;
			}
		} catch (e) {
			// Fallback: if Renderer fails, show as plain text
			const text = Array.isArray(entries) ? entries.filter(e => typeof e === "string").join("\n") : String(entries);
			if (text) {
				const wrap = this._ce("div", "pm-rendered-content", parent);
				wrap.textContent = text;
				return wrap;
			}
		}
		return null;
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

	// ─── Phase A1: Named Modifiers Drawer ───────────────────────

	_renderModifiersDrawer (container) {
		const mods = this._state.getNamedModifiers();
		const userMods = mods.filter(m => !m.sourceFeatureId && !m.sourceType);
		const featureMods = mods.filter(m => m.sourceFeatureId || m.sourceType);

		// Add button
		const headerActions = this._ce("div", "pm-drawer-actions", container);
		const addBtn = this._ce("button", "pm-drawer-actions__btn", headerActions);
		addBtn.textContent = "+ Add Modifier";
		addBtn.addEventListener("click", () => this._showModifierModal(null));

		// User-created modifiers
		if (userMods.length) {
			const card = this._makeCard(container, "🎯", `Custom Modifiers (${userMods.length})`);
			userMods.forEach(mod => this._renderModifierRow(card, mod, true));
		} else {
			this._renderEmptyState(container, "🎯", "No custom modifiers. Click + Add Modifier to create one.");
		}

		// Feature/item-sourced modifiers (read-only display)
		if (featureMods.length) {
			const card = this._makeCard(container, "✨", `Feature Modifiers (${featureMods.length})`);
			const note = this._ce("div", "pm-modifier__note", card);
			note.textContent = "These are granted by features/items and cannot be manually edited.";
			featureMods.slice(0, 30).forEach(mod => this._renderModifierRow(card, mod, false));
		}
	}

	_renderModifierRow (parent, mod, allowEdit) {
		const row = this._ce("div", `pm-modifier${mod.enabled ? "" : " pm-modifier--disabled"}`, parent);

		// Toggle
		const toggleBtn = this._ce("button", `pm-modifier__toggle${mod.enabled ? " pm-modifier__toggle--on" : ""}`, row);
		toggleBtn.textContent = mod.enabled ? "✓" : "○";
		toggleBtn.title = mod.enabled ? "Enabled — click to disable" : "Disabled — click to enable";
		toggleBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const newState = this._state.toggleNamedModifier(mod.id);
			this._logActivity("🎯", `${newState ? "Enabled" : "Disabled"} modifier: ${mod.name}`);
			this._openDrawerByType("modifiers");
		});

		// Name & details
		const info = this._ce("div", "pm-modifier__info", row);
		const nameEl = this._ce("span", "pm-modifier__name", info);
		nameEl.textContent = mod.name;

		const details = this._ce("span", "pm-modifier__details", info);
		const valStr = mod.value > 0 ? `+${mod.value}` : `${mod.value}`;
		const condStr = mod.conditional ? ` (${this._state.formatConditionalText?.(mod) || mod.conditional})` : "";
		details.textContent = `${valStr} to ${mod.type}${condStr}`;

		if (!allowEdit) return;

		// Edit
		const editBtn = this._ce("button", "pm-modifier__btn", row);
		editBtn.textContent = "✏️";
		editBtn.title = "Edit modifier";
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showModifierModal(mod);
		});

		// Delete
		const delBtn = this._ce("button", "pm-modifier__btn pm-modifier__btn--del", row);
		delBtn.textContent = "🗑";
		delBtn.title = "Delete modifier";
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showConfirmModal(`Delete modifier "${mod.name}"?`, () => {
				this._state.removeNamedModifier(mod.id);
				this._logActivity("🗑", `Deleted modifier: ${mod.name}`);
				this._openDrawerByType("modifiers");
			});
		});
	}

	_showModifierModal (existing) {
		const isEdit = !!existing;
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const title = this._ce("div", "pm-modal__title", panel);
		title.textContent = isEdit ? "✏️ Edit Modifier" : "🎯 Add Modifier";

		// Name
		const nameRow = this._ce("div", "pm-modal__row", panel);
		const nameLbl = this._ce("label", "pm-modal__label", nameRow);
		nameLbl.textContent = "Name";
		const nameInput = this._ce("input", "pm-modal__input", nameRow);
		nameInput.placeholder = "e.g. Bless, Bane, Aid…";
		nameInput.value = existing?.name || "";

		// Type (scope)
		const typeRow = this._ce("div", "pm-modal__row", panel);
		const typeLbl = this._ce("label", "pm-modal__label", typeRow);
		typeLbl.textContent = "Affects";
		const typeSelect = this._ce("select", "pm-modal__select", typeRow);
		const MODIFIER_SCOPES = [
			["ac", "Armor Class"],
			["initiative", "Initiative"],
			["attack", "All Attacks"],
			["attack:melee", "Melee Attacks"],
			["attack:ranged", "Ranged Attacks"],
			["attack:spell", "Spell Attacks"],
			["damage", "All Damage"],
			["spellDc", "Spell Save DC"],
			["spellAttack", "Spell Attack Bonus"],
			["save:all", "All Saving Throws"],
			["save:str", "STR Saves"],
			["save:dex", "DEX Saves"],
			["save:con", "CON Saves"],
			["save:int", "INT Saves"],
			["save:wis", "WIS Saves"],
			["save:cha", "CHA Saves"],
			["check:all", "All Ability Checks"],
			["check:str", "STR Checks"],
			["check:dex", "DEX Checks"],
			["check:con", "CON Checks"],
			["check:int", "INT Checks"],
			["check:wis", "WIS Checks"],
			["check:cha", "CHA Checks"],
			["skill:all", "All Skills"],
			["skill:athletics", "Athletics"],
			["skill:acrobatics", "Acrobatics"],
			["skill:stealth", "Stealth"],
			["skill:perception", "Perception"],
			["skill:insight", "Insight"],
			["skill:persuasion", "Persuasion"],
			["skill:deception", "Deception"],
			["skill:intimidation", "Intimidation"],
			["skill:history", "History"],
			["skill:arcana", "Arcana"],
			["skill:nature", "Nature"],
			["skill:religion", "Religion"],
			["skill:investigation", "Investigation"],
			["skill:medicine", "Medicine"],
			["skill:animalhandling", "Animal Handling"],
			["skill:survival", "Survival"],
			["skill:performance", "Performance"],
			["skill:sleightofhand", "Sleight of Hand"],
			["d20:all", "All d20 Rolls"],
			["hp", "Max HP"],
			["proficiencyBonus", "Proficiency Bonus"],
			["deathSave", "Death Saves"],
		];
		MODIFIER_SCOPES.forEach(([val, label]) => {
			const opt = this._ce("option", null, typeSelect);
			opt.value = val;
			opt.textContent = label;
		});
		if (existing?.type) typeSelect.value = existing.type;

		// Value
		const valRow = this._ce("div", "pm-modal__row", panel);
		const valLbl = this._ce("label", "pm-modal__label", valRow);
		valLbl.textContent = "Bonus (numeric)";
		const valInput = this._ce("input", "pm-modal__input", valRow);
		valInput.type = "number";
		valInput.placeholder = "e.g. 1, -2, 4";
		valInput.value = existing?.value ?? "1";

		// Enabled
		const enabledRow = this._ce("div", "pm-modal__row pm-modal__row--check", panel);
		const enabledCheck = this._ce("input", null, enabledRow);
		enabledCheck.type = "checkbox";
		enabledCheck.checked = existing?.enabled !== false;
		const enabledLbl = this._ce("label", null, enabledRow);
		enabledLbl.textContent = " Active now";

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const saveBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		saveBtn.textContent = isEdit ? "💾 Save" : "➕ Add";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		saveBtn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			if (!name) { nameInput.focus(); return; }
			const value = parseInt(valInput.value) || 0;
			const type = typeSelect.value;
			const enabled = enabledCheck.checked;

			if (isEdit) {
				this._state.updateNamedModifier(existing.id, {name, type, value, enabled});
				this._logActivity("✏️", `Updated modifier: ${name}`);
			} else {
				this._state.addNamedModifier({name, type, value, enabled});
				this._logActivity("🎯", `Added modifier: ${name} (${value >= 0 ? "+" : ""}${value} to ${type})`);
			}
			close();
			this._openDrawerByType("modifiers");
		});

		document.body.appendChild(overlay);
		nameInput.focus();
	}

	// ─── Phase A2: Sticky Notes Overlay ─────────────────────────

	_toggleStickyNotesOverlay () {
		let overlay = document.getElementById("pm-sticky-overlay");
		if (overlay) {
			overlay.classList.toggle("pm-sticky-overlay--hidden");
			return;
		}
		// First open: create the overlay container
		overlay = this._ce("div", "pm-sticky-overlay");
		overlay.id = "pm-sticky-overlay";
		this._elRoot.appendChild(overlay);

		// Render existing notes
		const notes = this._state.getStickyNotes("playmode");
		notes.forEach(note => this._renderStickyNote(overlay, note));

		// Show "new note" fab
		const fab = this._ce("button", "pm-sticky-fab");
		fab.textContent = "＋ Sticky";
		fab.title = "Add a new sticky note";
		fab.addEventListener("click", () => {
			const id = this._state.addStickyNote({
				title: "Note",
				content: "",
				tab: "playmode",
				position: {x: 80 + Math.random() * 200, y: 120 + Math.random() * 100},
				color: "yellow",
			});
			const note = this._state.getStickyNote(id);
			this._renderStickyNote(overlay, note);
			this._logActivity("🗒", "Added sticky note");
		});
		overlay.appendChild(fab);
	}

	_renderStickyNote (overlayEl, note) {
		const COLORS = {yellow: "#fef08a", pink: "#fbcfe8", blue: "#bfdbfe", green: "#bbf7d0", purple: "#e9d5ff"};
		const existing = overlayEl.querySelector(`[data-note-id="${note.id}"]`);
		if (existing) existing.remove();

		const el = this._ce("div", "pm-sticky");
		el.dataset.noteId = note.id;
		el.style.background = COLORS[note.color] || COLORS.yellow;
		if (note.position) {
			el.style.left = `${note.position.x}px`;
			el.style.top = `${note.position.y}px`;
		}

		// Title bar (drag handle)
		const titleBar = this._ce("div", "pm-sticky__title-bar", el);
		titleBar.setAttribute("aria-label", "Drag to move note");

		const titleInput = this._ce("input", "pm-sticky__title-input", titleBar);
		titleInput.value = note.title || "Note";
		titleInput.addEventListener("blur", () => {
			this._state.updateStickyNote(note.id, {title: titleInput.value});
		});
		titleInput.addEventListener("click", (e) => e.stopPropagation());

		// Color picker
		const colorPicker = this._ce("select", "pm-sticky__color-picker", titleBar);
		Object.entries(COLORS).forEach(([name]) => {
			const opt = this._ce("option", null, colorPicker);
			opt.value = name;
			opt.textContent = name;
		});
		colorPicker.value = note.color || "yellow";
		colorPicker.addEventListener("change", (e) => {
			e.stopPropagation();
			this._state.updateStickyNote(note.id, {color: colorPicker.value});
			el.style.background = COLORS[colorPicker.value] || COLORS.yellow;
		});

		// Delete
		const delBtn = this._ce("button", "pm-sticky__del", titleBar);
		delBtn.textContent = "✕";
		delBtn.title = "Delete note";
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._state.removeStickyNote(note.id);
			el.remove();
			this._logActivity("🗒", `Deleted sticky note: ${note.title || "Note"}`);
		});

		// Content area
		const content = this._ce("textarea", "pm-sticky__content", el);
		content.value = note.content || "";
		content.placeholder = "Write something…";
		content.addEventListener("blur", () => {
			this._state.updateStickyNote(note.id, {content: content.value});
		});
		content.addEventListener("click", (e) => e.stopPropagation());

		// Drag to reposition
		let dragging = false, dragOffX = 0, dragOffY = 0;
		titleBar.addEventListener("mousedown", (e) => {
			if (e.target === titleInput || e.target === colorPicker || e.target === delBtn) return;
			dragging = true;
			const rect = el.getBoundingClientRect();
			dragOffX = e.clientX - rect.left;
			dragOffY = e.clientY - rect.top;
			el.style.zIndex = "9999";
			e.preventDefault();
		});
		document.addEventListener("mousemove", (e) => {
			if (!dragging) return;
			const parentRect = overlayEl.getBoundingClientRect();
			const x = Math.max(0, e.clientX - parentRect.left - dragOffX);
			const y = Math.max(0, e.clientY - parentRect.top - dragOffY);
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
		});
		document.addEventListener("mouseup", () => {
			if (!dragging) return;
			dragging = false;
			el.style.zIndex = "";
			const x = parseFloat(el.style.left) || 0;
			const y = parseFloat(el.style.top) || 0;
			this._state.updateStickyNote(note.id, {position: {x, y}});
		});

		overlayEl.insertBefore(el, overlayEl.querySelector(".pm-sticky-fab"));
	}

	// ─── Phase A5: Custom Attack Modal ──────────────────────────

	_showAttackModal (existing, onSave) {
		const isEdit = !!existing;
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const titleEl = this._ce("div", "pm-modal__title", panel);
		titleEl.textContent = isEdit ? "✏️ Edit Attack" : "⚔️ Add Custom Attack";

		const row = (label) => {
			const r = this._ce("div", "pm-modal__row", panel);
			const lbl = this._ce("label", "pm-modal__label", r);
			lbl.textContent = label;
			return r;
		};

		// Name
		const nameRow = row("Name");
		const nameInput = this._ce("input", "pm-modal__input", nameRow);
		nameInput.placeholder = "e.g. Longsword, Sneak Attack…";
		nameInput.value = existing?.name || "";

		// Melee / Ranged
		const typeRow = row("Type");
		const meleeBtn = this._ce("button", "pm-attack-type-btn pm-attack-type-btn--active", typeRow);
		meleeBtn.textContent = "🗡️ Melee";
		const rangedBtn = this._ce("button", "pm-attack-type-btn", typeRow);
		rangedBtn.textContent = "🏹 Ranged";
		let isMelee = existing?.isMelee !== false;
		const updateTypeButtons = () => {
			meleeBtn.classList.toggle("pm-attack-type-btn--active", isMelee);
			rangedBtn.classList.toggle("pm-attack-type-btn--active", !isMelee);
		};
		updateTypeButtons();
		meleeBtn.addEventListener("click", () => { isMelee = true; updateTypeButtons(); });
		rangedBtn.addEventListener("click", () => { isMelee = false; updateTypeButtons(); });

		// Ability mod
		const abilRow = row("Ability Mod");
		const abilSelect = this._ce("select", "pm-modal__select", abilRow);
		["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
			const opt = this._ce("option", null, abilSelect);
			opt.value = abl;
			opt.textContent = abl.toUpperCase();
		});
		abilSelect.value = existing?.abilityMod || (isMelee ? "str" : "dex");

		// Attack bonus
		const atkRow = row("Attack Bonus");
		const atkInput = this._ce("input", "pm-modal__input", atkRow);
		atkInput.type = "number";
		atkInput.value = existing?.attackBonus ?? 0;

		// Damage formula
		const dmgRow = row("Damage");
		const dmgInput = this._ce("input", "pm-modal__input", dmgRow);
		dmgInput.placeholder = "e.g. 1d8, 2d6+1d4";
		dmgInput.value = existing?.damage || "1d6";

		// Damage type
		const dmgTypeRow = row("Damage Type");
		const dmgTypeSelect = this._ce("select", "pm-modal__select", dmgTypeRow);
		["slashing", "piercing", "bludgeoning", "fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "force", "psychic"].forEach(t => {
			const opt = this._ce("option", null, dmgTypeSelect);
			opt.value = t;
			opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
		});
		dmgTypeSelect.value = existing?.damageType || "slashing";

		// Damage bonus
		const dmgBonRow = row("Damage Bonus");
		const dmgBonInput = this._ce("input", "pm-modal__input", dmgBonRow);
		dmgBonInput.type = "number";
		dmgBonInput.value = existing?.damageBonus ?? 0;

		// Range
		const rangeRow = row("Range");
		const rangeInput = this._ce("input", "pm-modal__input", rangeRow);
		rangeInput.placeholder = "e.g. 5 ft., 80/320 ft.";
		rangeInput.value = existing?.range || (isMelee ? "5 ft." : "80/320 ft.");

		// Properties
		const propRow = row("Properties");
		const propInput = this._ce("input", "pm-modal__input", propRow);
		propInput.placeholder = "e.g. Versatile, Thrown";
		propInput.value = existing?.properties || "";

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const saveBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		saveBtn.textContent = isEdit ? "💾 Save" : "➕ Add Attack";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

		saveBtn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			if (!name) { nameInput.focus(); return; }

			const attackData = {
				name,
				isMelee,
				abilityMod: abilSelect.value,
				attackBonus: parseInt(atkInput.value) || 0,
				damage: dmgInput.value.trim() || "1d6",
				damageType: dmgTypeSelect.value,
				damageBonus: parseInt(dmgBonInput.value) || 0,
				range: rangeInput.value.trim() || (isMelee ? "5 ft." : "80/320 ft."),
				properties: propInput.value.trim(),
			};

			if (isEdit) {
				this._state.updateAttack({...existing, ...attackData});
				this._logActivity("✏️", `Updated attack: ${name}`);
			} else {
				const id = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
				this._state.addAttack({id, ...attackData});
				this._logActivity("⚔️", `Added custom attack: ${name}`);
			}

			close();
			onSave?.();
		});

		document.body.appendChild(overlay);
		nameInput.focus();
	}

	// ─── Phase C2: Settings Drawer ───────────────────────────────

	_renderSettingsDrawer (container) {
		const settings = this._state.getSettings?.() || {};

		const makeSection = (title, items) => {
			const card = this._makeCard(container, null, title);
			items.forEach(({key, label, type, options, value, onChange}) => {
				const row = this._ce("div", "pm-settings__row", card);
				const lbl = this._ce("label", "pm-settings__label", row);
				lbl.textContent = label;

				if (type === "toggle") {
					const cb = this._ce("input", "pm-settings__toggle", row);
					cb.type = "checkbox";
					cb.checked = !!value;
					cb.addEventListener("change", () => {
						onChange?.(cb.checked);
						this._state.setSetting(key, cb.checked);
					});
				} else if (type === "select") {
					const sel = this._ce("select", "pm-settings__select", row);
					(options || []).forEach(([val, txt]) => {
						const opt = this._ce("option", null, sel);
						opt.value = val;
						opt.textContent = txt;
					});
					sel.value = value || "";
					sel.addEventListener("change", () => {
						onChange?.(sel.value);
						this._state.setSetting(key, sel.value);
					});
				}
			});
			return card;
		};

		// Exhaustion rules
		makeSection("📜 Ruleset", [
			{
				key: "exhaustionRules",
				label: "Exhaustion Rules",
				type: "select",
				value: settings.exhaustionRules || "2024",
				options: [
					["2024", "2024 (One D&D)"],
					["2014", "2014 (Classic)"],
					["thelemar", "Thelemar Homebrew"],
				],
				onChange: (v) => this._state.setExhaustionRules?.(v),
			},
		]);

		// TGTT Homebrew
		makeSection("🐉 TGTT Homebrew", [
			{
				key: "enableTgtt",
				label: "Enable Thelemar Homebrew",
				type: "toggle",
				value: settings.enableTgtt,
				onChange: (v) => { this._renderSettingsDrawer(container); },
			},
			...(settings.enableTgtt ? [
				{key: "tgttCarry", label: "TGTT Carry Capacity", type: "toggle", value: settings.tgttCarry},
				{key: "tgttJumping", label: "TGTT Jumping Rules", type: "toggle", value: settings.tgttJumping},
				{key: "tgttLinguistics", label: "TGTT Linguistics", type: "toggle", value: settings.tgttLinguistics},
				{key: "tgttCriticalRolls", label: "TGTT Critical Rolls", type: "toggle", value: settings.tgttCriticalRolls},
			] : []),
		]);

		// Display
		makeSection("🖥️ Display", [
			{
				key: "showAllOptFeatureVersions",
				label: "Show All Optional Feature Versions",
				type: "toggle",
				value: settings.showAllOptFeatureVersions,
			},
		]);

		// Save/Load helpers
		const utilCard = this._makeCard(container, "💾", "Save / Load");
		const saveBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", utilCard);
		saveBtn.textContent = "💾 Export Character";
		saveBtn.addEventListener("click", () => this._exportCharacter());

		const charName = this._state.getName?.() || "character";
		const info = this._ce("div", "pm-settings__info", utilCard);
		info.textContent = `Character: ${charName} — Save to export a backup.`;
	}

	// ─── Phase C1: Export Helper ────────────────────────────────

	_exportCharacter () {
		try {
			const json = this._state.toJson();
			const name = (this._state.getName?.() || "character").replace(/[^a-z0-9_-]/gi, "_");
			const blob = new Blob([JSON.stringify(json, null, 2)], {type: "application/json"});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${name}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			this._logActivity("💾", `Exported character: ${name}.json`);
			JqueryUtil?.doToast?.({type: "success", content: `Exported ${name}.json`});
		} catch (err) {
			JqueryUtil?.doToast?.({type: "danger", content: `Export failed: ${err.message}`});
		}
	}

	// ─── Confirm Modal Helper ────────────────────────────────────

	_showConfirmModal (message, onConfirm) {
		const overlay = this._ce("div", "pm-modal-overlay");
		const panel = this._ce("div", "pm-modal", overlay);

		const msg = this._ce("div", "pm-modal__subtitle", panel);
		msg.textContent = message;

		const btnRow = this._ce("div", "pm-modal__buttons", panel);
		const cancelBtn = this._ce("button", "pm-modal__btn pm-modal__btn--cancel", btnRow);
		cancelBtn.textContent = "Cancel";
		const confirmBtn = this._ce("button", "pm-modal__btn pm-modal__btn--confirm", btnRow);
		confirmBtn.textContent = "Confirm";

		const close = () => overlay.remove();
		cancelBtn.addEventListener("click", close);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
		confirmBtn.addEventListener("click", () => { close(); onConfirm(); });

		document.body.appendChild(overlay);
		confirmBtn.focus();
	}

}

CharacterSheetPlayMode.CONDITION_DESCRIPTIONS = {
	Blinded: "Can't see. Auto-fail checks requiring sight. Attacks have disadvantage; attacks against have advantage.",
	Charmed: "Can't attack the charmer. Charmer has advantage on social checks against you.",
	Deafened: "Can't hear. Auto-fail checks requiring hearing.",
	Frightened: "Disadvantage on ability checks and attacks while source of fear is in line of sight. Can't willingly move closer.",
	Grappled: "Speed becomes 0. Ends if grappler is incapacitated or you're moved out of reach.",
	Incapacitated: "Can't take actions or reactions.",
	Invisible: "Impossible to see without magic/special sense. Attacks against have disadvantage; your attacks have advantage.",
	Paralyzed: "Incapacitated. Can't move or speak. Auto-fail STR/DEX saves. Attacks against have advantage. Hits within 5ft are crits.",
	Petrified: "Transformed to stone. Incapacitated, can't move/speak, unaware. Attacks against have advantage. Auto-fail STR/DEX saves. Resistant to all damage. Immune to poison/disease.",
	Poisoned: "Disadvantage on attack rolls and ability checks.",
	Prone: "Can only crawl. Disadvantage on attacks. Melee attacks against have advantage; ranged have disadvantage. Stand up costs half movement.",
	Restrained: "Speed becomes 0. Attacks have disadvantage; attacks against have advantage. Disadvantage on DEX saves.",
	Stunned: "Incapacitated. Can't move. Speak only falteringly. Auto-fail STR/DEX saves. Attacks against have advantage.",
	Unconscious: "Incapacitated. Can't move or speak. Unaware. Drop what you're holding, fall prone. Auto-fail STR/DEX saves. Attacks have advantage. Hits within 5ft are crits.",
	Exhaustion: "Cumulative levels: 1=disadvantage on checks, 2=speed halved, 3=disadvantage on attacks/saves, 4=HP max halved, 5=speed 0, 6=death.",
};
