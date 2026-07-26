import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";
import {DmScreenUtil} from "./dmscreen-util.js";

/* ============================================================================================== */
/*  Constants + pure rule logic are defined in the DOM-free, unit-tested consts module.            */
/* ============================================================================================== */

import {
	JOURNEY_ACTIVITIES,
	CAMP_ACTIVITIES,
	PACE_OPTIONS,
	WEATHER_PRESETS,
	DEFAULT_WEATHER_TABLE,
	WEATHER_TABLE_PRESETS,
	RANGE_COLORS,
	DEFAULT_AREA,
	SKILL_TO_ABILITY,
	ACTIVITY_TOOL_KEYWORDS,
	DEFAULT_SUPPLIES,
	DEFAULT_STATE,
	TRACKING_TERRAINS,
	TRACKING_DEGREES,
	TRACKING_MODIFIERS,
	classifyRiskRange,
	classifySingleRoll,
	evaluateGroupCheck,
	rmDeltaForOutcome,
	computeActivityGroupRm,
	sumContainerRm,
	computeEffectiveDc,
	classifyTrackingDegree,
	getSkillBonusFromData,
	getToolProfBonusFromData,
	getActivitySkills,
	computeActivityBonus,
	getActivityInteractions,
} from "./dmscreen-journeytracker-consts.js";

/* ============================================================================================== */
/*  Panel entry point                                                                              */
/* ============================================================================================== */

export class JourneyTracker extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-journey__root dm__panel-bg dm__data-anchor"></div>`;
		this._comp = new JourneyTrackerRoot(board, wrpPanel);
		this._comp.setStateFrom(state || {});
		this._comp.render(wrpPanel);
		return wrpPanel;
	}

	getState () {
		return this._comp?.getSaveableState();
	}

	onBoardEvent ({type}) {
		if (type === "partyTrackerUpdate") {
			this._comp?.syncPartyCharacters();
		}
	}
}

/* ============================================================================================== */
/*  Root component                                                                                 */
/* ============================================================================================== */

/** Exported for unit testing of the DOM-free RM-reconciliation core (constructor touches no DOM). */
export class JourneyTrackerRoot {
	constructor (board, wrpPanel) {
		this._board = board;
		this._wrpPanel = wrpPanel;

		this._state = DEFAULT_STATE();

		/* Cached DOM references */
		this._eleRmValue = null;
		this._eleRmBadge = null;
		this._eleSyncStatus = null;
		this._eleHeader = null;
		this._wrpTabs = null;
		this._wrpJourney = null;
		this._wrpCamp = null;
		this._wrpArea = null;
		this._wrpLog = null;
		this._wrpTimeline = null;
		this._eleWeatherBadge = null;
	}

	/* -------------------------------------------- */
	/*  Render                                       */
	/* -------------------------------------------- */

	render (eleParent) {
		eleParent.innerHTML = "";
		this._ensureSegments();

		/* --- Header --- */
		const eleHeader = this._renderHeader();

		/* --- Tab bar --- */
		const tabBar = this._renderTabBar();

		/* --- Tab content areas --- */
		this._wrpJourney = ee`<div class="dm-journey__tab-content"></div>`;
		this._wrpCamp = ee`<div class="dm-journey__tab-content"></div>`;
		this._wrpArea = ee`<div class="dm-journey__tab-content"></div>`;
		this._wrpLog = ee`<div class="dm-journey__tab-content"></div>`;
		this._wrpTimeline = ee`<div class="dm-journey__tab-content"></div>`;

		this._renderJourney();
		this._renderCamp();
		this._renderArea();
		this._renderLog();
		this._renderTimeline();
		this._updateTabVisibility();

		/* Sync party on initial render */
		this._doInitialPartySync();

		ee`<div class="ve-flex-col ve-w-100 ve-h-100">
			${eleHeader}
			${tabBar}
			<div class="dm-journey__body">
				${this._wrpJourney}
				${this._wrpCamp}
				${this._wrpArea}
				${this._wrpLog}
				${this._wrpTimeline}
			</div>
		</div>`.appendTo(eleParent);
	}

	_doInitialPartySync () {
		try {
			const ptChars = this._getPartyTrackerCharacters();
			if (!ptChars.length) return;
			if (this._state.players.some(p => p.isFromPartyTracker)) return;

			for (const ptChar of ptChars) {
				this._state.players.push({
					id: ptChar.id,
					name: ptChar.name || "Unnamed",
					isFromPartyTracker: true,
				});
			}
			this._addLog("party-sync", `Initial sync: added ${ptChars.length} character(s) from Party Tracker`);
			this._updateSyncStatus();
			this._reRenderCurrentTab();
		} catch { /* Party Tracker may not be loaded yet */ }
	}

	/* -------------------------------------------- */
	/*  Header                                       */
	/* -------------------------------------------- */

	_renderHeader () {
		/* RM display */
		this._eleRmValue = ee`<input type="number" class="dm-journey__rm-input" value="${this._state.riskModifier}" title="Risk Modifier — type a value or use +/− buttons" aria-label="Risk Modifier">`;
		this._eleRmValue.onn("change", () => {
			const val = parseInt(this._eleRmValue.val(), 10);
			if (Number.isNaN(val)) { this._eleRmValue.val(this._state.riskModifier); return; }
			this._setRm(val, "Manual set");
			/* Re-baseline derived bookkeeping so future edits apply as deltas from the manual value. */
			this._reconcileRm({rebaseline: true});
			this._reRenderCurrentTab();
			this._doSave();
		});

		this._eleRmBadge = ee`<span class="dm-journey__rm-badge" aria-live="polite"></span>`;
		this._updateRmBadge();

		const btnMinus = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__rm-btn" title="−1 Risk" aria-label="Decrease Risk Modifier">\u2212</button>`
			.onn("click", () => this._setRm(this._state.riskModifier - 1, "Manual −1"));

		const btnPlus = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__rm-btn" title="+1 Risk" aria-label="Increase Risk Modifier">+</button>`
			.onn("click", () => this._setRm(this._state.riskModifier + 1, "Manual +1"));

		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Reset RM to 0" aria-label="Reset Risk Modifier">Reset</button>`
			.onn("click", () => {
				this._setRm(0, "Reset");
				/* Re-baseline derived bookkeeping so a later activity edit doesn't re-add old RM. */
				this._reconcileRm({rebaseline: true});
				this._reRenderCurrentTab();
				this._doSave();
			});

		/* Pace */
		const elePace = this._renderPaceSelector();

		/* Weather indicator + roll button */
		this._eleWeatherBadge = ee`<span class="dm-journey__weather-header-badge"></span>`;
		this._updateWeatherBadge();

		const btnRollWeather = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__weather-roll-btn" title="Roll random weather from area weather table" aria-label="Roll Weather">\uD83C\uDFB2</button>`;
		btnRollWeather.onn("click", () => this._rollWeather());

		/* Roll mode toggle */
		const isTotal = this._state.rollMode === "total";
		const btnRollMode = ee`<button class="ve-btn ve-btn-xs ${isTotal ? "ve-btn-warning" : "ve-btn-default"}  dm-journey__roll-mode-btn" title="Toggle between entering raw d20 rolls (system adds bonus) or final totals (player already added bonus)">${isTotal ? "Rolls = Total" : "Rolls = d20"}</button>`;
		btnRollMode.onn("click", () => {
			this._state.rollMode = this._state.rollMode === "raw" ? "total" : "raw";
			this._reconcileRm({reason: "Roll mode changed"});
			this._reRenderCurrentTab();
			this._renderHeader_update();
			this._doSave();
		});

		/* Party sync status */
		this._eleSyncStatus = ee`<span class="dm-journey__sync-status"></span>`;
		this._updateSyncStatus();

		const btnAddPlayer = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Add a player manually" aria-label="Add Player"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Player</button>`
			.onn("click", () => this._addManualPlayer());

		const btnNewDay = ee`<button class="ve-btn ve-btn-warning ve-btn-xs" title="Reset RM, clear all activities, and start a new day" aria-label="New Day">New Day</button>`;
		btnNewDay.onn("click", () => {
			if (!confirm("Start a new day? This resets RM, clears all activities, and logs the event.")) return;
			this._doNewDay();
		});

		this._eleHeader = ee`<div class="dm-journey__header">
			<div class="dm-journey__rm-section">
				<span class="dm-journey__rm-label">RM</span>
				${this._eleRmBadge}
				${btnMinus}
				${this._eleRmValue}
				${btnPlus}
				${btnReset}
			</div>
			${elePace}
			${this._eleWeatherBadge}
			${btnRollWeather}
			<div class="dm-journey__sync-section">
				${btnNewDay}
				${btnRollMode}
				${this._eleSyncStatus}
				${btnAddPlayer}
			</div>
		</div>`;
		return this._eleHeader;
	}

	_renderHeader_update () {
		if (!this._eleHeader) return;
		const btn = this._eleHeader.querySelector(".dm-journey__roll-mode-btn");
		if (!btn) return;
		const isTotal = this._state.rollMode === "total";
		btn.textContent = isTotal ? "Rolls = Total" : "Rolls = d20";
		btn.className = `ve-btn ve-btn-xs ${isTotal ? "ve-btn-warning" : "ve-btn-default"} dm-journey__roll-mode-btn`;
	}

	_renderPaceSelector () {
		const wrp = ee`<div class="dm-journey__pace-section"></div>`;
		const eleDetails = ee`<div class="dm-journey__pace-details"></div>`;

		const renderDetails = () => {
			eleDetails.innerHTML = "";
			const pace = PACE_OPTIONS.find(p => p.id === this._state.travelPace) || PACE_OPTIONS[1];
			const rows = [
				["Speed", pace.moveMult],
				["Nav DC", pace.navDc > 0 ? `+${pace.navDc}` : `${pace.navDc}`],
				["Stealth", pace.stealth],
				["Passive Perc.", pace.passivePerc],
				["Activities", pace.activities],
			];
			for (const [k, v] of rows) {
				ee`<div class="dm-journey__pace-detail-row"><span class="dm-journey__pace-detail-key">${k}</span><span class="dm-journey__pace-detail-val">${v}</span></div>`.appendTo(eleDetails);
			}
		};

		const eleRadios = ee`<div class="dm-journey__pace-radios"></div>`;
		for (const pace of PACE_OPTIONS) {
			const radio = ee`<input type="radio" name="dm-journey-pace" value="${pace.id}" ${this._state.travelPace === pace.id ? "checked" : ""}>`;
			radio.onn("change", () => {
				this._state.travelPace = pace.id;
				renderDetails();
				/* Pace changes DCs (navigate/scout) and gates stealth RM (J2) — recompute all RM. */
				this._reconcileRm({reason: `Pace \u2192 ${pace.label}`});
				this._reRenderCurrentTab();
				this._doSave();
			});
			ee`<label class="dm-journey__pace-label" title="${pace.tips}">
				${radio}
				<span>${pace.label}</span>
			</label>`.appendTo(eleRadios);
		}

		eleRadios.appendTo(wrp);
		eleDetails.appendTo(wrp);
		renderDetails();
		return wrp;
	}

	/* -------------------------------------------- */
	/*  Tab bar                                      */
	/* -------------------------------------------- */

	_renderTabBar () {
		const tabs = [
			{ix: 0, label: "Journey"},
			{ix: 1, label: "Camp"},
			{ix: 2, label: "Area Config"},
			{ix: 3, label: "Log"},
			{ix: 4, label: "📅 Timeline"},
		];

		this._wrpTabs = ee`<div class="dm-journey__tab-bar"></div>`;
		for (const tab of tabs) {
			const btn = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__tab-btn ${this._state.tab === tab.ix ? "ve-active" : ""}" data-tab="${tab.ix}">${tab.label}</button>`;
			btn.onn("click", () => {
				this._state.tab = tab.ix;
				this._updateTabVisibility();
				this._doSave();
			});
			btn.appendTo(this._wrpTabs);
		}

		return this._wrpTabs;
	}

	_updateTabVisibility () {
		if (!this._wrpTabs) return;

		/* Tab buttons */
		const btns = this._wrpTabs.querySelectorAll(".dm-journey__tab-btn");
		btns.forEach(btn => {
			const ix = parseInt(btn.dataset.tab, 10);
			btn.classList.toggle("ve-active", ix === this._state.tab);
		});

		/* Tab content */
		const tabMap = [this._wrpJourney, this._wrpCamp, this._wrpArea, this._wrpLog, this._wrpTimeline];
		tabMap.forEach((wrp, ix) => {
			if (wrp) wrp.style.display = ix === this._state.tab ? "" : "none";
		});
	}

	/* -------------------------------------------- */
	/*  Supply Tracker                               */
	/* -------------------------------------------- */

	_renderSupplies () {
		const supplies = this._state.supplies;
		const wrp = ee`<div class="dm-journey__supply-section"></div>`;

		/* Header row: title + toggle + add button */
		const cbxAuto = ee`<input type="checkbox" ${supplies.autoDeplete ? "checked" : ""} title="Automatically consume supplies on New Day">`;
		cbxAuto.onn("change", () => {
			supplies.autoDeplete = cbxAuto.prop("checked");
			this._doSave();
		});

		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" title="Add custom supply"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span></button>`;
		btnAdd.onn("click", () => {
			supplies.items.push({id: CryptUtil.uid(), name: "", count: 0, dailyBurn: 0, unit: "", isDefault: false});
			this._renderJourney();
			this._doSave();
		});

		ee`<div class="dm-journey__supply-header">
			<span class="dm-journey__supply-title">Supplies</span>
			<label class="dm-journey__supply-auto-label" title="Auto-deplete on New Day">
				${cbxAuto}
				<span>Auto</span>
			</label>
			${btnAdd}
		</div>`.appendTo(wrp);

		/* Summary line */
		const summaryParts = [];
		for (const item of supplies.items) {
			if (!item.name || item.count <= 0) continue;
			const daysLeft = item.dailyBurn > 0 ? Math.floor(item.count / item.dailyBurn) : null;
			if (daysLeft != null) {
				summaryParts.push({text: `${item.name}: ${item.count} (${daysLeft}d)`, days: daysLeft});
			} else {
				summaryParts.push({text: `${item.name}: ${item.count}`, days: Infinity});
			}
		}
		if (summaryParts.length) {
			const minDays = Math.min(...summaryParts.map(s => s.days));
			const summaryCls = minDays <= 1 ? "dm-journey__supply-summary--red"
				: minDays <= 3 ? "dm-journey__supply-summary--yellow"
					: "dm-journey__supply-summary--green";
			ee`<div class="dm-journey__supply-summary ${summaryCls}">${summaryParts.map(s => s.text).join(" \u00b7 ")}</div>`.appendTo(wrp);
		}

		/* Item rows */
		const wrpItems = ee`<div class="dm-journey__supply-items"></div>`;
		for (const item of supplies.items) {
			const eleRow = this._renderSupplyRow(item);
			wrpItems.appendChild(eleRow);
		}
		wrp.appendChild(wrpItems);

		return wrp;
	}

	_renderSupplyRow (item) {
		const daysLeft = item.dailyBurn > 0 && item.count > 0 ? Math.floor(item.count / item.dailyBurn) : null;
		const colorCls = daysLeft == null ? ""
			: daysLeft <= 1 ? "dm-journey__supply-count--red"
				: daysLeft <= 3 ? "dm-journey__supply-count--yellow"
					: "dm-journey__supply-count--green";

		const iptName = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__supply-name" placeholder="Name" value="${this._escAttr(item.name)}" aria-label="Supply name">`;
		iptName.onn("change", () => {
			item.name = iptName.val()?.trim() || "";
			this._renderJourney();
			this._doSave();
		});

		const iptCount = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__supply-count-input ${colorCls}" min="0" value="${item.count}" aria-label="Supply count">`;
		iptCount.onn("change", () => {
			item.count = Math.max(0, parseInt(iptCount.val(), 10) || 0);
			this._renderJourney();
			this._doSave();
		});

		const iptBurn = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__supply-burn-input" min="0" value="${item.dailyBurn}" title="Daily consumption rate" aria-label="Daily burn">`;
		iptBurn.onn("change", () => {
			item.dailyBurn = Math.max(0, parseInt(iptBurn.val(), 10) || 0);
			this._renderJourney();
			this._doSave();
		});

		const btnMinus = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" title="Remove 1">\u2212</button>`;
		btnMinus.onn("click", () => {
			item.count = Math.max(0, item.count - 1);
			this._renderJourney();
			this._doSave();
		});

		const btnPlus = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" title="Add 1">+</button>`;
		btnPlus.onn("click", () => {
			item.count += 1;
			this._renderJourney();
			this._doSave();
		});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs dm-journey__supply-remove" title="Remove supply">\u00d7</button>`;
		btnRemove.onn("click", () => {
			this._state.supplies.items = this._state.supplies.items.filter(i => i.id !== item.id);
			this._renderJourney();
			this._doSave();
		});

		/* Days remaining indicator */
		let eleDays = "";
		if (daysLeft != null) {
			eleDays = ee`<span class="dm-journey__supply-days ${colorCls}" title="${daysLeft} days remaining">${daysLeft}d</span>`;
		}

		const row = ee`<div class="dm-journey__supply-row">
			${iptName}
			<div class="dm-journey__supply-controls">
				${btnMinus}
				${iptCount}
				${btnPlus}
			</div>
			<span class="dm-journey__supply-burn-label">/day:</span>
			${iptBurn}
			${eleDays}
			${btnRemove}
		</div>`;

		return row;
	}

	/** Add foraged rations to supply tracker. */
	_addForagedRations (amount) {
		if (amount <= 0) return;
		const rations = this._state.supplies.items.find(i => i.name.toLowerCase() === "rations");
		if (rations) {
			rations.count += amount;
		} else {
			this._state.supplies.items.push({id: CryptUtil.uid(), name: "Rations", count: amount, dailyBurn: 0, unit: "days", isDefault: false});
		}
		this._addLog("supplies", `Foraged: +${amount} rations`);
		this._doSave();
	}

	/** Update default dailyBurn for rations/water to match party size. */
	_syncSupplyBurnRates () {
		const partySize = this._state.players.length;
		for (const item of this._state.supplies.items) {
			if (!item.isDefault) continue;
			const lc = item.name.toLowerCase();
			if (lc === "rations" || lc === "water") {
				if (item.dailyBurn === 0 || item._autoBurn !== false) {
					item.dailyBurn = partySize;
				}
			}
		}
	}

	/* -------------------------------------------- */
	/*  Weather System                               */
	/* -------------------------------------------- */

	_updateWeatherBadge () {
		if (!this._eleWeatherBadge) return;
		const w = this._state.weather;
		const preset = this._getWeatherPreset(w.current);
		const parts = [preset.icon, preset.label];
		if (preset.dcMod) parts.push(`(DC ${preset.dcMod > 0 ? "+" : ""}${preset.dcMod})`);
		if (preset.rmMod) parts.push(`(RM ${preset.rmMod > 0 ? "+" : ""}${preset.rmMod})`);
		this._eleWeatherBadge.textContent = parts.join(" ");
		const effectsTitle = preset.effects.length ? preset.effects.join("\n") : "No special effects";
		this._eleWeatherBadge.setAttribute("title", effectsTitle);
	}

	_renderWeatherSection () {
		const w = this._state.weather;
		const wrp = ee`<div class="dm-journey__weather-config"></div>`;

		/* ---- Current weather selector + roll button ---- */
		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__weather-select" aria-label="Current weather"></select>`;
		for (const [key, preset] of Object.entries(this._getAllWeatherTypes())) {
			const opt = ee`<option value="${key}" ${w.current === key ? "selected" : ""}>${preset.icon} ${preset.label}</option>`;
			sel.appendChild(opt);
		}
		sel.onn("change", () => {
			const oldWeather = w.current;
			w.current = sel.val();
			const preset = this._getWeatherPreset(w.current);
			if (preset && oldWeather !== w.current) {
				const notes = [preset.label];
				if (preset.dcMod) notes.push(`DC ${preset.dcMod > 0 ? "+" : ""}${preset.dcMod}`);
				if (preset.rmMod) notes.push(`RM ${preset.rmMod > 0 ? "+" : ""}${preset.rmMod}`);
				this._addLog("weather", `Weather changed to ${notes.join(", ")}`);
			}
			this._updateWeatherBadge();
			this._applyWeatherPaceRestriction();
			this._reconcileRm({reason: "Weather changed"});
			this._reRenderCurrentTab();
			this._doSave();
		});

		const btnRoll = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll random weather from table">\uD83C\uDFB2 Roll</button>`;
		btnRoll.onn("click", () => this._rollWeather());

		/* Per-segment toggle */
		const cbxPerSeg = ee`<input type="checkbox" ${w.perSegment ? "checked" : ""}>`;
		cbxPerSeg.onn("change", () => {
			w.perSegment = cbxPerSeg.prop("checked");
			this._reconcileRm({reason: "Per-segment weather toggled"});
			this._renderArea();
			this._renderJourney();
			this._doSave();
		});

		ee`<div class="dm-journey__weather-row">
			<span class="dm-journey__label">Weather:</span>
			${sel}
			${btnRoll}
			<label class="dm-journey__weather-perseg-label">
				${cbxPerSeg}
				<span>Per-segment</span>
			</label>
		</div>`.appendTo(wrp);

		/* Per-segment selectors */
		if (w.perSegment) {
			const area = this._state.area;
			while (w.segmentWeather.length < area.numSegments) w.segmentWeather.push(w.current);
			w.segmentWeather.length = area.numSegments;

			for (let i = 0; i < area.numSegments; i++) {
				const segSel = ee`<select class="ve-form-control ve-input-xs dm-journey__weather-select" aria-label="Weather for ${area.segmentNames[i] || `Segment ${i + 1}`}"></select>`;
				for (const [key, preset] of Object.entries(this._getAllWeatherTypes())) {
					const opt = ee`<option value="${key}" ${w.segmentWeather[i] === key ? "selected" : ""}>${preset.icon} ${preset.label}</option>`;
					segSel.appendChild(opt);
				}
				const idx = i;
				segSel.onn("change", () => {
					w.segmentWeather[idx] = segSel.val();
					this._reconcileRm({reason: "Segment weather changed"});
					this._renderJourney();
					this._doSave();
				});
				ee`<div class="dm-journey__weather-row dm-journey__weather-row--segment">
					<span class="dm-journey__label">${this._escHtml(area.segmentNames[i] || `Segment ${i + 1}`)}:</span>
					${segSel}
				</div>`.appendTo(wrp);
			}
		}

		/* Effects summary */
		const preset = this._getWeatherPreset(w.current);
		if (preset.effects.length) {
			const eleEffects = ee`<div class="dm-journey__weather-effects"></div>`;
			for (const effect of preset.effects) {
				ee`<div class="dm-journey__weather-effect">\u2022 ${this._escHtml(effect)}</div>`.appendTo(eleEffects);
			}
			wrp.appendChild(eleEffects);
		}

		/* ---- Weather Table (probabilities for rolling) ---- */
		wrp.appendChild(this._renderWeatherTable());

		/* ---- Custom Weather Types ---- */
		wrp.appendChild(this._renderCustomWeatherTypes());

		return wrp;
	}

	_renderWeatherTable () {
		const area = this._state.area;
		if (!area.weatherTable) area.weatherTable = DEFAULT_WEATHER_TABLE();
		const table = area.weatherTable;

		const wrp = ee`<div class="dm-journey__wtable-section"></div>`;

		/* Header with area preset selector */
		const selPreset = ee`<select class="ve-form-control ve-input-xs dm-journey__wtable-preset-select" aria-label="Area weather preset"></select>`;
		ee`<option value="">— Apply Preset —</option>`.appendTo(selPreset);
		for (const [key, p] of Object.entries(WEATHER_TABLE_PRESETS)) {
			ee`<option value="${key}">${p.label}</option>`.appendTo(selPreset);
		}
		selPreset.onn("change", () => {
			const key = selPreset.val();
			if (!key) return;
			const preset = WEATHER_TABLE_PRESETS[key];
			if (!preset) return;
			area.weatherTable = preset.table.map(e => ({...e}));
			this._renderArea();
			this._doSave();
		});

		ee`<div class="dm-journey__wtable-header">
			<span class="dm-journey__wtable-title">Weather Table</span>
			${selPreset}
		</div>`.appendTo(wrp);

		/* Calculate total weight for percentage display */
		const totalWeight = table.reduce((sum, e) => sum + e.weight, 0) || 1;

		/* Table rows */
		const wrpRows = ee`<div class="dm-journey__wtable-rows"></div>`;
		const allTypes = this._getAllWeatherTypes();

		for (let i = 0; i < table.length; i++) {
			const entry = table[i];
			const typeInfo = allTypes[entry.weatherKey];
			if (!typeInfo) continue;

			const pct = Math.round((entry.weight / totalWeight) * 100);

			const iptWeight = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__wtable-weight" min="0" max="20" value="${entry.weight}" aria-label="Weight for ${typeInfo.label}">`;
			const eleBar = ee`<div class="dm-journey__wtable-bar" style="width: ${pct}%"></div>`;
			const elePct = ee`<span class="dm-journey__wtable-pct">${pct}%</span>`;

			const idx = i;
			iptWeight.onn("change", () => {
				table[idx].weight = Math.max(0, Math.min(20, parseInt(iptWeight.val(), 10) || 0));
				this._renderArea();
				this._doSave();
			});

			const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xs dm-journey__wtable-remove" title="Remove from table">\u00d7</button>`;
			btnRemove.onn("click", () => {
				table.splice(idx, 1);
				this._renderArea();
				this._doSave();
			});

			ee`<div class="dm-journey__wtable-row">
				<span class="dm-journey__wtable-icon">${typeInfo.icon}</span>
				<span class="dm-journey__wtable-label">${typeInfo.label}</span>
				${iptWeight}
				<div class="dm-journey__wtable-bar-wrap">${eleBar}</div>
				${elePct}
				${btnRemove}
			</div>`.appendTo(wrpRows);
		}
		wrp.appendChild(wrpRows);

		/* Add weather type to table */
		const tableKeys = new Set(table.map(e => e.weatherKey));
		const missingTypes = Object.entries(allTypes).filter(([k]) => !tableKeys.has(k));

		if (missingTypes.length) {
			const selAdd = ee`<select class="ve-form-control ve-input-xs dm-journey__wtable-add-select" aria-label="Add weather type to table"></select>`;
			ee`<option value="">+ Add type\u2026</option>`.appendTo(selAdd);
			for (const [key, typeInfo] of missingTypes) {
				ee`<option value="${key}">${typeInfo.icon} ${typeInfo.label}</option>`.appendTo(selAdd);
			}
			selAdd.onn("change", () => {
				const key = selAdd.val();
				if (!key) return;
				table.push({weatherKey: key, weight: 1});
				this._renderArea();
				this._doSave();
			});
			ee`<div class="dm-journey__wtable-add">${selAdd}</div>`.appendTo(wrp);
		}

		return wrp;
	}

	_renderCustomWeatherTypes () {
		const w = this._state.weather;
		if (!w.customTypes) w.customTypes = [];

		const wrp = ee`<div class="dm-journey__wcustom-section"></div>`;

		ee`<div class="dm-journey__wcustom-header">
			<span class="dm-journey__wcustom-title">Custom Weather Types</span>
		</div>`.appendTo(wrp);

		/* Existing custom types */
		for (let i = 0; i < w.customTypes.length; i++) {
			wrp.appendChild(this._renderCustomWeatherRow(i));
		}

		/* Add new custom type */
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs">+ New Weather Type</button>`;
		btnAdd.onn("click", () => {
			const key = `custom_${CryptUtil.uid()}`;
			w.customTypes.push({
				key,
				label: "New Weather",
				icon: "\u2753",
				dcMod: 0,
				rmMod: 0,
				paceRestrict: null,
				effects: [],
			});
			this._renderArea();
			this._doSave();
		});
		ee`<div class="dm-journey__wcustom-add">${btnAdd}</div>`.appendTo(wrp);

		return wrp;
	}

	_renderCustomWeatherRow (index) {
		const ct = this._state.weather.customTypes[index];
		const row = ee`<div class="dm-journey__wcustom-row"></div>`;

		/* Icon */
		const iptIcon = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__wcustom-icon" value="${this._escAttr(ct.icon)}" placeholder="\u2753" aria-label="Icon" maxlength="4">`;
		iptIcon.onn("change", () => {
			ct.icon = iptIcon.val() || "\u2753";
			this._renderArea();
			this._doSave();
		});

		/* Name */
		const iptName = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__wcustom-name" value="${this._escAttr(ct.label)}" placeholder="Weather name" aria-label="Weather name">`;
		iptName.onn("change", () => {
			ct.label = iptName.val() || "Custom Weather";
			this._renderArea();
			this._doSave();
		});

		/* DC Mod */
		const iptDc = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__wcustom-num" value="${ct.dcMod}" min="-5" max="10" aria-label="DC modifier">`;
		iptDc.onn("change", () => {
			ct.dcMod = parseInt(iptDc.val(), 10) || 0;
			this._reconcileRm({reason: `Custom weather DC (${ct.label})`});
			this._doSave();
		});

		/* RM Mod */
		const iptRm = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__wcustom-num" value="${ct.rmMod}" min="-5" max="10" aria-label="RM modifier">`;
		iptRm.onn("change", () => {
			ct.rmMod = parseInt(iptRm.val(), 10) || 0;
			this._doSave();
		});

		/* Pace restriction */
		const selPace = ee`<select class="ve-form-control ve-input-xs dm-journey__wcustom-pace" aria-label="Pace restriction"></select>`;
		ee`<option value="" ${ct.paceRestrict == null ? "selected" : ""}>None</option>`.appendTo(selPace);
		ee`<option value="slow" ${ct.paceRestrict === "slow" ? "selected" : ""}>Force Slow</option>`.appendTo(selPace);
		selPace.onn("change", () => {
			ct.paceRestrict = selPace.val() || null;
			this._doSave();
		});

		/* Effects (comma-separated) */
		const effectsStr = (ct.effects || []).join(", ");
		const iptEffects = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__wcustom-effects" value="${this._escAttr(effectsStr)}" placeholder="Effects (comma-separated)" aria-label="Effects">`;
		iptEffects.onn("change", () => {
			ct.effects = iptEffects.val().split(",").map(s => s.trim()).filter(Boolean);
			this._doSave();
		});

		/* Delete */
		const btnDel = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Delete custom weather type">\u2716</button>`;
		btnDel.onn("click", () => {
			if (!confirm(`Delete "${ct.label}"? This removes it from the weather table too.`)) return;
			/* Remove from weather table */
			const table = this._state.area.weatherTable || [];
			const tableIdx = table.findIndex(e => e.weatherKey === ct.key);
			if (tableIdx >= 0) table.splice(tableIdx, 1);
			/* Reset current weather if it was this type */
			if (this._state.weather.current === ct.key) this._state.weather.current = "clear";
			this._state.weather.customTypes.splice(index, 1);
			this._reconcileRm({reason: `Deleted weather (${ct.label})`});
			this._updateWeatherBadge();
			this._renderArea();
			this._doSave();
		});

		ee`<div class="dm-journey__wcustom-fields">
			<div class="dm-journey__wcustom-row-top">
				${iptIcon}
				${iptName}
				<span class="dm-journey__wcustom-label">DC:</span>
				${iptDc}
				<span class="dm-journey__wcustom-label">RM:</span>
				${iptRm}
				${selPace}
				${btnDel}
			</div>
			<div class="dm-journey__wcustom-row-bottom">
				${iptEffects}
			</div>
		</div>`.appendTo(row);

		return row;
	}

	/** Enforce pace restriction if weather requires slow pace. */
	_applyWeatherPaceRestriction () {
		const w = this._state.weather;
		const preset = this._getWeatherPreset(w.current);
		if (preset?.paceRestrict === "slow" && this._state.travelPace !== "slow") {
			this._state.travelPace = "slow";
			this._addLog("weather", `Pace forced to Slow by ${preset.label}`);
		}
	}

	/** Get a weather preset by key, checking custom types first, then built-in. */
	_getWeatherPreset (key) {
		if (!key) return WEATHER_PRESETS.clear;
		const custom = (this._state.weather.customTypes || []).find(ct => ct.key === key);
		if (custom) return custom;
		return WEATHER_PRESETS[key] || WEATHER_PRESETS.clear;
	}

	/** Get all weather types: built-in merged with custom. */
	_getAllWeatherTypes () {
		const types = {...WEATHER_PRESETS};
		for (const ct of this._state.weather.customTypes || []) {
			types[ct.key] = ct;
		}
		return types;
	}

	/** Roll random weather from the area's weather table. */
	_rollWeather () {
		const table = this._state.area.weatherTable || DEFAULT_WEATHER_TABLE();
		const allTypes = this._getAllWeatherTypes();
		/* Filter to entries with positive weight and valid type */
		const validEntries = table.filter(e => e.weight > 0 && allTypes[e.weatherKey]);
		if (!validEntries.length) return;

		const totalWeight = validEntries.reduce((sum, e) => sum + e.weight, 0);
		if (totalWeight <= 0) return;

		let roll = Math.random() * totalWeight;
		let picked = validEntries[0].weatherKey;
		for (const entry of validEntries) {
			roll -= entry.weight;
			if (roll <= 0) {
				picked = entry.weatherKey;
				break;
			}
		}

		const oldWeather = this._state.weather.current;
		this._state.weather.current = picked;
		const preset = this._getWeatherPreset(picked);
		const notes = [preset.label];
		if (preset.dcMod) notes.push(`DC ${preset.dcMod > 0 ? "+" : ""}${preset.dcMod}`);
		if (preset.rmMod) notes.push(`RM ${preset.rmMod > 0 ? "+" : ""}${preset.rmMod}`);
		this._addLog("weather", `\uD83C\uDFB2 Weather rolled: ${notes.join(", ")}`);

		this._updateWeatherBadge();
		this._applyWeatherPaceRestriction();
		this._reconcileRm({reason: "Weather rolled"});
		this._reRenderCurrentTab();
		this._doSave();
	}

	/* -------------------------------------------- */
	/*  Journey Tab                                  */
	/* -------------------------------------------- */

	_renderJourney () {
		if (!this._wrpJourney) return;
		this._wrpJourney.innerHTML = "";

		/* Supply tracker section */
		const eleSupplies = this._renderSupplies();
		this._wrpJourney.appendChild(eleSupplies);

		const area = this._state.area;
		const segments = this._state.journey.segments;

		for (let i = 0; i < area.numSegments; i++) {
			const segName = area.segmentNames[i] || `Segment ${i + 1}`;
			const seg = segments[i] || (segments[i] = this._makeEmptySegment());
			const eleSegment = this._renderSegmentCard(segName, seg, i);
			this._wrpJourney.appendChild(eleSegment);
		}
	}

	_renderSegmentCard (name, seg, ix) {
		const isCollapsed = seg._collapsed || false;
		if (!seg.stealthSlots) seg.stealthSlots = [];

		const card = ee`<div class="dm-journey__segment-card"></div>`;

		/* Header — just toggle + name */
		const btnToggle = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__collapse-btn" aria-label="Toggle segment">${isCollapsed ? "\u25B6" : "\u25BC"}</button>`;
		btnToggle.onn("click", () => {
			seg._collapsed = !seg._collapsed;
			this._renderJourney();
			this._doSave();
		});

		const eleHeader = ee`<div class="dm-journey__segment-header">
			${btnToggle}
			<span class="dm-journey__segment-name">${name}</span>
		</div>`;

		/* Per-segment weather badge */
		const segWeather = this._getWeatherForSegment(ix);
		const segPreset = this._getWeatherPreset(segWeather);
		if (segPreset && segWeather !== "clear") {
			const weatherTitle = [segPreset.label, ...(segPreset.dcMod ? [`DC ${segPreset.dcMod > 0 ? "+" : ""}${segPreset.dcMod}`] : []), ...segPreset.effects].join(" \u2022 ");
			ee`<span class="dm-journey__weather-badge" title="${this._escAttr(weatherTitle)}">${segPreset.icon}</span>`.appendTo(eleHeader);
		}

		card.appendChild(eleHeader);

		/* Body (collapsible): activities → stealth → RM summary → risk roll */
		if (!isCollapsed) {
			ee`<div class="dm-journey__section-title">Activities</div>`.appendTo(card);
			const body = this._renderActivityTable(seg.activities, JOURNEY_ACTIVITIES, ix);
			card.appendChild(body);

			ee`<div class="dm-journey__section-title">Stealth</div>`.appendTo(card);
			const eleStealth = this._renderStealthSlots(seg);
			card.appendChild(eleStealth);

			ee`<div class="dm-journey__section-title">RM Changes</div>`.appendTo(card);
			const eleRmSummary = this._renderRmSummary(seg.activities, seg, JOURNEY_ACTIVITIES);
			card.appendChild(eleRmSummary);

			const eleRisk = this._renderRiskRollSection(seg, () => { this._renderJourney(); this._doSave(); });
			card.appendChild(eleRisk);
		}

		return card;
	}

	/* -------------------------------------------- */
	/*  Stealth Slots (Journey)                      */
	/* -------------------------------------------- */

	_renderStealthSlots (seg) {
		const pace = this._state.travelPace;
		const isDisabled = pace !== "slow";

		const wrp = ee`<div class="dm-journey__stealth-section${isDisabled ? " dm-journey__stealth-section--disabled" : ""}">
			<div class="ve-flex-v-center ve-gap-1 ve-mb-1">
				<span class="ve-bold">Stealth</span>
				<span class="dm-journey__note">(Slow Pace only \u2014 always resolved as one Group Check)</span>
			</div>
		</div>`;

		if (isDisabled) {
			ee`<div class="dm-journey__note"><i>Requires Slow Pace.</i></div>`.appendTo(wrp);
			return wrp;
		}

		const wrpRows = ee`<div class="ve-flex-col ve-gap-1"></div>`;

		for (let i = 0; i < seg.stealthSlots.length; i++) {
			const slot = seg.stealthSlots[i];
			const row = this._renderStealthRow(slot, i, seg);
			wrpRows.appendChild(row);
		}

		const btnAdd = ee`<button class="ve-btn ve-btn-default ve-btn-xs"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add Hider</button>`;
		btnAdd.onn("click", () => {
			seg.stealthSlots.push({playerId: "", rollResult: ""});
			this._renderJourney();
			this._doSave();
		});

		wrp.appendChild(wrpRows);
		wrp.appendChild(btnAdd);
		wrp.appendChild(this._renderStealthGroupResult(seg));
		return wrp;
	}

	_renderStealthRow (slot, ix, seg) {
		const players = this._state.players;
		const ptChars = this._getPartyTrackerCharacters();
		const baseDc = this._state.area.baseDc ?? 10;
		const isTotalMode = this._state.rollMode === "total";

		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__player-sel" aria-label="Stealth player">
			<option value="">— Select —</option>
			${players.map(p => `<option value="${this._escAttr(p.id)}" ${slot.playerId === p.id ? "selected" : ""}>${this._escHtml(p.name || "Unnamed")}</option>`).join("")}
		</select>`;
		sel.onn("change", () => {
			slot.playerId = sel.val();
			slot.rollResult = "";
			this._reconcileRm({reason: "Stealth updated"});
			this._renderJourney();
			this._doSave();
		});

		/* Stealth bonus */
		const ptChar = ptChars.find(c => c.id === slot.playerId);
		const bonus = ptChar ? JourneyTrackerRoot._getSkillBonusFromData(ptChar, "stealth") : 0;
		const bonusStr = ptChar ? this._fmtBonus(bonus) : "";

		/* DC display */
		const eleDc = ee`<span class="dm-journey__dc-cell" title="Base DC ${baseDc}">${baseDc}</span>`;

		/* Roll input (individual pass/fail feeds the group check) */
		const iptResult = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__roll-input" placeholder="${isTotalMode ? "Total" : "d20"}" value="${slot.rollResult || ""}" aria-label="Stealth roll">`;
		iptResult.onn("change", () => {
			slot.rollResult = iptResult.val()?.trim() || "";
			this._reconcileRm({reason: "Stealth updated"});
			this._renderJourney();
			this._doSave();
		});

		/* Individual pass/fail (crits only matter to the group as all-pass / all-fail) */
		const eleResult = ee`<span class="dm-journey__roll-result"></span>`;
		if (slot.rollResult !== "" && slot.rollResult != null && slot.playerId) {
			const rollNum = parseInt(slot.rollResult, 10);
			if (!isNaN(rollNum)) {
				const total = isTotalMode ? rollNum : rollNum + bonus;
				const pass = total >= baseDc;
				eleResult.className = `dm-journey__roll-result ${pass ? "dm-journey__roll-result--pass" : "dm-journey__roll-result--fail"}`;
				eleResult.txt(`${pass ? "\u2714" : "\u2718"} ${total}`);
			}
		}

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove hider" aria-label="Remove hider">\u00d7</button>`;
		btnRemove.onn("click", () => {
			seg.stealthSlots.splice(ix, 1);
			this._reconcileRm({reason: "Stealth updated"});
			this._renderJourney();
			this._doSave();
		});

		return ee`<div class="dm-journey__activity-row">
			${sel}
			<span class="dm-journey__skill-bonus" title="Stealth bonus">${bonusStr}</span>
			${eleDc}
			${iptResult}
			${eleResult}
			${btnRemove}
		</div>`;
	}

	/**
	 * Compute the segment's stealth Group Check from all entered hider rolls.
	 * Locked model: all pass → Crit Success (−2 RM); all fail → Crit Failure (+2 RM);
	 * else standard 5e (≥ half pass → Success −1 RM, else Failure 0 RM).
	 */
	_computeStealthGroup (seg) {
		const ptChars = this._getPartyTrackerCharacters();
		const baseDc = this._state.area.baseDc ?? 10;
		const isTotalMode = this._state.rollMode === "total";
		const rolls = [];
		const passResults = [];
		for (const slot of (seg.stealthSlots || [])) {
			if (!slot.playerId) continue;
			const rollNum = parseInt(slot.rollResult, 10);
			if (isNaN(rollNum)) continue;
			const ptChar = ptChars.find(c => c.id === slot.playerId);
			const bonus = ptChar ? JourneyTrackerRoot._getSkillBonusFromData(ptChar, "stealth") : 0;
			const total = isTotalMode ? rollNum : rollNum + bonus;
			const pass = total >= baseDc;
			const name = this._state.players.find(p => p.id === slot.playerId)?.name || "?";
			rolls.push({name, total, pass});
			passResults.push(pass);
		}
		const outcome = evaluateGroupCheck(passResults);
		const RM_MAP = {critSuccess: -2, success: -1, fail: 0, critFail: 2};
		const rmDelta = outcome ? RM_MAP[outcome] : 0;
		return {rolls, outcome, rmDelta, count: passResults.length};
	}

	/** Group-check readout beneath the hider rows. */
	_renderStealthGroupResult (seg) {
		const {rolls, outcome, rmDelta, count} = this._computeStealthGroup(seg);
		const wrp = ee`<div class="dm-journey__stealth-group"></div>`;
		if (!count) {
			ee`<span class="dm-journey__note"><i>Enter each hider's Stealth check \u2014 they resolve together as one Group Check.</i></span>`.appendTo(wrp);
			return wrp;
		}
		const passes = rolls.filter(r => r.pass).length;
		const LABELS = {critSuccess: "Critical Success", success: "Success", fail: "Failure", critFail: "Critical Failure"};
		const CLS = {
			critSuccess: "dm-journey__group-badge--crit-pass",
			success: "dm-journey__group-badge--pass",
			fail: "dm-journey__group-badge--fail",
			critFail: "dm-journey__group-badge--crit-fail",
		};
		ee`<span class="ve-bold">Group Check:</span>`.appendTo(wrp);
		ee`<span class="dm-journey__group-badge ${CLS[outcome]}">${LABELS[outcome]}</span>`.appendTo(wrp);
		ee`<span class="dm-journey__note">${passes}/${count} passed \u00b7 RM ${rmDelta > 0 ? "+" : ""}${rmDelta}</span>`.appendTo(wrp);
		return wrp;
	}

	/* -------------------------------------------- */
	/*  Risk Roll Section (shared)                   */
	/* -------------------------------------------- */

	_renderRiskRollSection (segOrCamp, onUpdate) {
		const riskBadge = this._renderRiskBadge(segOrCamp);

		const btnRoll = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Roll d12 + RM">Roll Risk</button>`;
		btnRoll.onn("click", () => {
			const result = this._doRiskRoll();
			segOrCamp.riskRoll = result.die;
			segOrCamp.riskRollTotal = result.total;
			segOrCamp.riskRollOverride = null;
			segOrCamp.rmAtRoll = this._state.riskModifier;
			segOrCamp.encounterResolved = false;
			onUpdate();
		});

		const iptOverride = ee`<input type="number" class="dm-journey__override-input" placeholder="Override" title="Override total result" value="${segOrCamp.riskRollOverride ?? ""}">`;
		iptOverride.onn("change", () => {
			const v = iptOverride.val()?.trim();
			segOrCamp.riskRollOverride = v === "" ? null : parseInt(v, 10);
			segOrCamp.encounterResolved = false;
			onUpdate();
		});

		const wrp = ee`<div class="dm-journey__risk-section">
			<span class="ve-bold">Risk Roll:</span>
			${riskBadge}
			${btnRoll}
			${iptOverride}
		</div>`;

		/* Threshold visualization + Intense-encounter RM reset. */
		if (segOrCamp.riskRoll != null) {
			this._renderRiskThresholdBar(segOrCamp).appendTo(wrp);

			const effectiveTotal = segOrCamp.riskRollOverride ?? segOrCamp.riskRollTotal;
			const range = this._classifyRoll(effectiveTotal);
			if (range === "intense") this._renderIntenseReset(segOrCamp, onUpdate).appendTo(wrp);
		}

		return wrp;
	}

	/** Horizontal bar showing the Empty/Mild/Moderate/Intense spans with the rolled total marked. */
	_renderRiskThresholdBar (segOrCamp) {
		const ranges = this._state.area.riskRanges;
		const mildMin = ranges.mild?.min ?? 1;
		const modMin = ranges.moderate?.min ?? 5;
		const intMin = ranges.intense?.min ?? 11;
		const effectiveTotal = segOrCamp.riskRollOverride ?? segOrCamp.riskRollTotal;
		const activeRange = this._classifyRoll(effectiveTotal);

		const spans = [
			{key: "empty", label: "Empty", lo: 0, hi: mildMin - 1},
			{key: "mild", label: "Mild", lo: mildMin, hi: modMin - 1},
			{key: "moderate", label: "Moderate", lo: modMin, hi: intMin - 1},
			{key: "intense", label: "Intense", lo: intMin, hi: null},
		];

		const bar = ee`<div class="dm-journey__risk-bar" role="img" aria-label="Risk range: ${activeRange}"></div>`;
		for (const span of spans) {
			const colorInfo = RANGE_COLORS[span.key];
			const rangeLbl = span.hi == null ? `${span.lo}+` : (span.lo >= span.hi ? `${span.hi}` : `${span.lo}\u2013${span.hi}`);
			const isActive = span.key === activeRange;
			const cell = ee`<div class="dm-journey__risk-bar-cell ${colorInfo.cls} ${isActive ? "dm-journey__risk-bar-cell--active" : ""}" title="${colorInfo.label}: ${rangeLbl}">
				<span class="dm-journey__risk-bar-label">${span.label}</span>
				<span class="dm-journey__risk-bar-range">${rangeLbl}</span>
			</div>`;
			if (isActive) ee`<span class="dm-journey__risk-bar-marker" title="Rolled ${effectiveTotal}">\u25b2 ${effectiveTotal}</span>`.appendTo(cell);
			cell.appendTo(bar);
		}
		return bar;
	}

	/** DM control to mark an Intense-Range encounter resolved and reset RM to 0 (rules). */
	_renderIntenseReset (segOrCamp, onUpdate) {
		if (segOrCamp.encounterResolved) {
			return ee`<div class="dm-journey__intense-reset dm-journey__intense-reset--done">
				<span class="dm-journey__note">\u2713 Intense encounter resolved \u2014 RM was reset to 0.</span>
			</div>`;
		}
		const btn = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="After resolving the encounter, the Risk Modifier resets to 0">Encounter resolved \u2192 reset RM to 0</button>`;
		btn.onn("click", () => {
			segOrCamp.encounterResolved = true;
			this._setRm(0, "Intense-Range encounter resolved");
			/* Re-baseline derived bookkeeping so a later activity edit doesn't re-add old RM. */
			this._reconcileRm({rebaseline: true});
			onUpdate();
		});
		return ee`<div class="dm-journey__intense-reset">
			<span class="dm-journey__note">\u26a0 Intense Range \u2014 an encounter occurs. After it resolves, reset RM.</span>
			${btn}
		</div>`;
	}

	/* -------------------------------------------- */
	/*  RM Summary (shared)                          */
	/* -------------------------------------------- */

	_renderRmSummary (activities, seg, activityList) {
		const players = this._state.players;
		const items = [];

		/* Gather RM contributions from activity slots */
		for (const player of players) {
			const slots = activities[player.id];
			if (!slots) continue;
			const slotArr = Array.isArray(slots) ? slots : [slots];
			for (const act of slotArr) {
				const actDef = activityList.find(a => a.id === act.activity);
				if (!actDef) continue;

				if (act._rmAlwaysApplied) {
					items.push({label: `${actDef.label} (${player.name})`, value: act._rmAlwaysApplied, type: "auto"});
				}
				if (act._rmRollApplied) {
					items.push({label: `${actDef.label} roll (${player.name})`, value: act._rmRollApplied, type: "roll"});
				}
			}
		}

		/* Stealth resolves as a single Group Check contribution. */
		if (seg && seg.stealthGroupRm) {
			const grp = this._computeStealthGroup(seg);
			const LABELS = {critSuccess: "Crit Success", success: "Success", fail: "Failure", critFail: "Crit Failure"};
			const label = grp.outcome ? `Stealth Group (${LABELS[grp.outcome]})` : "Stealth Group";
			items.push({label, value: seg.stealthGroupRm, type: "roll"});
		}

		const totalRm = items.reduce((sum, it) => sum + it.value, 0);
		const wrp = ee`<div class="dm-journey__rm-summary"></div>`;

		if (!items.length) {
			ee`<span class="dm-journey__note"><i>No RM changes from activities.</i></span>`.appendTo(wrp);
			return wrp;
		}

		ee`<span class="ve-bold">Activity RM:</span>`.appendTo(wrp);
		for (const item of items) {
			const sign = item.value > 0 ? "+" : "";
			let chipCls = "dm-journey__rm-chip";
			if (item.type === "auto") chipCls += " dm-journey__rm-chip--auto";
			else if (item.value < 0) chipCls += " dm-journey__rm-chip--negative";
			else chipCls += " dm-journey__rm-chip--positive";
			ee`<span class="${chipCls}" title="${this._escAttr(item.label)}">${sign}${item.value} ${this._escHtml(item.label)}</span>`.appendTo(wrp);
		}
		ee`<span class="ve-bold">= ${totalRm >= 0 ? "+" : ""}${totalRm}</span>`.appendTo(wrp);

		return wrp;
	}

	/* -------------------------------------------- */
	/*  Camp Tab                                     */
	/* -------------------------------------------- */

	_renderCamp () {
		if (!this._wrpCamp) return;
		this._wrpCamp.innerHTML = "";

		const camp = this._state.camp;

		/* Campfire toggle */
		const cbxCampfire = ee`<input type="checkbox" ${camp.campfireActive ? "checked" : ""} aria-label="Toggle Campfire">`;
		cbxCampfire.onn("change", () => {
			const wasActive = camp.campfireActive;
			camp.campfireActive = cbxCampfire.prop("checked");
			if (camp.campfireActive && !wasActive) {
				this._setRm(this._state.riskModifier + 1, "Campfire lit (+1)");
			} else if (!camp.campfireActive && wasActive) {
				this._setRm(this._state.riskModifier - 1, "Campfire extinguished (−1)");
			}
			/* Campfire also shifts the Hide Camp DC (+2) → recompute camp activity group RM. */
			this._reconcileRm({reason: "Campfire toggled"});
			this._renderCamp();
			this._doSave();
		});

		const eleCampfire = ee`<label class="dm-journey__campfire-toggle">
			${cbxCampfire}
			<span>Campfire Active</span>
			<span class="dm-journey__note">(+1 RM while active; +2 to Hide Camp DC)</span>
		</label>`;

		/* Site description (Setup) */
		const txtSite = ee`<textarea class="ve-form-control dm-journey__site-desc" rows="2" placeholder="Describe the campsite — cover, terrain, water, defensibility, hazards…" aria-label="Campsite description"></textarea>`;
		txtSite.val(camp.siteDescription || "");
		txtSite.onn("change", () => { camp.siteDescription = txtSite.val() || ""; this._doSave(); });

		/* Concealment guidance for Hide Camp */
		const eleConceal = ee`<div class="dm-journey__conceal-note dm-journey__note"></div>`;
		eleConceal.txt(camp.campfireActive
			? "Hide Camp: DC +2 while a campfire burns. Assign the Hide Camp activity below to conceal the site."
			: "Hide Camp: assign the Hide Camp activity below to conceal the site (Survival or Stealth).");

		/* Activity table (Rest) */
		const body = this._renderActivityTable(camp.activities, CAMP_ACTIVITIES);

		/* Guard slots */
		const eleGuard = this._renderGuardSlots();

		/* RM Summary */
		const eleRmSummary = this._renderRmSummary(camp.activities, null, CAMP_ACTIVITIES);

		/* Risk Roll section (shared) */
		const eleRisk = this._renderRiskRollSection(camp, () => { this._renderCamp(); this._doSave(); });

		/* ==================== Setup phase ==================== */
		ee`<div class="dm-journey__phase-header">\ud83c\udfd5\ufe0f Setup</div>`.appendTo(this._wrpCamp);
		ee`<div class="dm-journey__section-title">Select Site</div>`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(txtSite);
		this._wrpCamp.appendChild(eleCampfire);
		this._wrpCamp.appendChild(eleConceal);

		/* ==================== Rest phase ==================== */
		ee`<div class="dm-journey__phase-header">\ud83c\udf19 Rest</div>`.appendTo(this._wrpCamp);
		ee`<div class="dm-journey__section-title">Activities</div>`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(body);
		ee`<hr class="dm-journey__camp-section-divider">`.appendTo(this._wrpCamp);
		ee`<div class="dm-journey__section-title">Guard Watches</div>`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(eleGuard);
		ee`<hr class="dm-journey__camp-section-divider">`.appendTo(this._wrpCamp);
		ee`<div class="dm-journey__section-title">RM Changes</div>`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(eleRmSummary);
		ee`<hr class="dm-journey__camp-section-divider">`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(eleRisk);
	}

	_renderGuardSlots () {
		const camp = this._state.camp;
		if (!camp.guardSlots) camp.guardSlots = [];

		const wrp = ee`<div class="dm-journey__guard-section">
			<div class="ve-flex-v-center ve-gap-1 ve-mb-1">
				<span class="ve-bold">Guard Watches</span>
				<span class="dm-journey__note">(can overlap another activity)</span>
			</div>
		</div>`;

		const wrpRows = ee`<div class="ve-flex-col ve-gap-1"></div>`;

		for (let i = 0; i < camp.guardSlots.length; i++) {
			const slot = camp.guardSlots[i];
			const row = this._renderGuardRow(slot, i);
			wrpRows.appendChild(row);
		}

		const btnAdd = ee`<button class="ve-btn ve-btn-default ve-btn-xs"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add Guard</button>`;
		btnAdd.onn("click", () => {
			camp.guardSlots.push({playerId: "", rollResult: ""});
			this._renderCamp();
			this._doSave();
		});

		wrp.appendChild(wrpRows);
		wrp.appendChild(btnAdd);
		return wrp;
	}

	_renderGuardRow (slot, ix) {
		const players = this._state.players;
		const ptChars = this._getPartyTrackerCharacters();

		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__player-sel" aria-label="Guard player">
			<option value="">— Select —</option>
			${players.map(p => `<option value="${this._escAttr(p.id)}" ${slot.playerId === p.id ? "selected" : ""}>${this._escHtml(p.name || "Unnamed")}</option>`).join("")}
		</select>`;
		sel.onn("change", () => {
			slot.playerId = sel.val();
			this._renderCamp();
			this._doSave();
		});

		/* Show perception bonus */
		const ptChar = ptChars.find(c => c.id === slot.playerId);
		const bonus = ptChar ? this._fmtBonus(JourneyTrackerRoot._getSkillBonusFromData(ptChar, "perception")) : "";

		const iptResult = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__roll-input" placeholder="Roll" value="${this._escAttr(slot.rollResult || "")}" aria-label="Guard roll result">`;
		iptResult.onn("change", () => {
			slot.rollResult = iptResult.val();
			this._doSave();
		});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove guard" aria-label="Remove guard">\u00d7</button>`;
		btnRemove.onn("click", () => {
			this._state.camp.guardSlots.splice(ix, 1);
			this._renderCamp();
			this._doSave();
		});

		return ee`<div class="dm-journey__activity-row">
			${sel}
			<span class="dm-journey__skill-bonus" title="Perception bonus">${bonus}</span>
			${iptResult}
			${btnRemove}
		</div>`;
	}

	/* -------------------------------------------- */
	/*  Shared: Activity Table                       */
	/* -------------------------------------------- */

	_renderActivityTable (activities, activityList, segmentIndex) {
		const players = this._state.players;
		const ptChars = this._getPartyTrackerCharacters();

		const wrp = ee`<div class="dm-journey__activity-table"></div>`;

		if (!players.length) {
			ee`<div class="dm-journey__empty-msg"><i>No players. Open a Party Tracker panel or add players manually.</i></div>`.appendTo(wrp);
			return wrp;
		}

		/* Header row */
		ee`<div class="dm-journey__activity-row dm-journey__activity-row--header">
			<span>Player</span>
			<span>Activity</span>
			<span>Bonus</span>
			<span>DC</span>
			<span>Roll</span>
			<span>Result</span>
			<span title="Also Bantering — grants Inspiration Points">Ban.</span>
		</div>`.appendTo(wrp);

		for (const player of players) {
			const ptChar = ptChars.find(c => c.id === player.id);
			const numActions = ptChar?.journeyActions ?? 1;

			/* Ensure activities[playerId] is an array with the right number of slots */
			if (!activities[player.id]) activities[player.id] = [];
			if (!Array.isArray(activities[player.id])) activities[player.id] = [activities[player.id]];
			while (activities[player.id].length < numActions) activities[player.id].push({activity: "", rollResult: "", customName: "", _rmAlwaysApplied: 0, _rmRollApplied: 0});
			/* Trim excess (but only empty trailing slots) */
			while (activities[player.id].length > numActions && !activities[player.id].at(-1)?.activity) activities[player.id].pop();

			const banterKey = `_bantering_${player.id}`;
			if (activities[banterKey] == null) activities[banterKey] = false;

			const slots = activities[player.id];
			for (let i = 0; i < slots.length; i++) {
				const act = slots[i];
				const row = this._renderActivityRow(player, act, ptChar, activityList, activities, players, i === 0, i, banterKey, segmentIndex);
				wrp.appendChild(row);
			}
		}

		/* Activity interaction notes */
		const notes = getActivityInteractions(activities, players, {isCamp: activityList === CAMP_ACTIVITIES, pace: this._state.travelPace});
		if (notes.length) {
			const wrpNotes = ee`<div class="dm-journey__interaction-notes"></div>`;
			ee`<div class="dm-journey__interaction-header">Activity Interactions</div>`.appendTo(wrpNotes);
			for (const note of notes) {
				ee`<div class="dm-journey__interaction-note">${this._escHtml(note)}</div>`.appendTo(wrpNotes);
			}
			wrp.appendChild(wrpNotes);
		}

		return wrp;
	}

	_renderActivityRow (player, act, ptChar, activityList, activities, allPlayers, isFirstRow = true, slotIndex = 0, banterKey = null, segmentIndex = undefined) {
		const actDef = activityList.find(a => a.id === act.activity);

		/* ---- Activity dropdown ---- */
		const optionsHtml = activityList.map(a => `<option value="${a.id}" ${act.activity === a.id ? "selected" : ""} title="${this._escAttr(a.desc || "")}">${a.label}</option>`).join("");
		const selTitle = actDef?.desc || "";
		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__activity-sel" aria-label="Activity for ${this._escAttr(player.name)}" title="${this._escAttr(selTitle)}"><option value="">\u2014 None \u2014</option>${optionsHtml}</select>`;
		sel.onn("change", () => {
			/* Switch to the new activity; RM is recomputed wholesale by _reconcileRm (no manual undo). */
			act.activity = sel.val();
			act.rollResult = "";
			act.customName = act.activity === "custom" ? (act.customName || "") : "";
			act._critOverride = null;
			this._reconcileRm({reason: `Activity changed (${player.name})`});
			this._reRenderCurrentTab();
			this._doSave();
		});

		/* Custom name (shown only when "Custom…" is picked) */
		const isCustom = act.activity === "custom";
		const iptCustom = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__custom-input" placeholder="Custom activity" value="${this._escAttr(act.customName || "")}">`;
		iptCustom.toggleVe(isCustom);
		iptCustom.onn("change", () => { act.customName = iptCustom.val(); this._doSave(); });

		/* ---- Bonus cell (skill + tool) ---- */
		const allowedSkills = getActivitySkills(actDef);
		let bonusStr = "";
		let bonusTitle = "";
		let hasToolProf = false;
		let chosenSkill = null;
		if (ptChar && allowedSkills.length) {
			const info = JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, act.skillChoice);
			bonusStr = this._fmtBonus(info.total);
			hasToolProf = info.hasToolProf;
			chosenSkill = info.skill;
			const parts = [`Skill (${this._fmtSkillName(info.skill)}): ${this._fmtBonus(info.skillBonus)}`];
			if (info.hasToolProf) parts.push(`Tool prof: ${info.toolBonus ? `+${info.toolBonus} (included)` : "has tools (already skill-proficient)"}`);
			if (actDef.rmAlways > 0) parts.push(`Auto RM: +${actDef.rmAlways}`);
			else if (actDef.rmOnSuccess < 0) parts.push(`On success: ${actDef.rmOnSuccess} RM`);
			bonusTitle = parts.join(" \u2022 ");
		}

		const eleBonusCell = ee`<span class="dm-journey__skill-bonus" title="${this._escAttr(bonusTitle)}">${bonusStr}</span>`;
		if (hasToolProf) {
			ee`<span class="dm-journey__tool-indicator" title="Has relevant tool proficiency">\uD83D\uDD27</span>`.appendTo(eleBonusCell);
		}
		/* Multi-skill activities: offer a per-slot skill override (default: auto best). */
		if (allowedSkills.length > 1) {
			const optsHtml = allowedSkills.map(sk => `<option value="${sk}" ${act.skillChoice === sk ? "selected" : ""}>${this._fmtSkillName(sk)}</option>`).join("");
			const selSkill = ee`<select class="ve-form-control ve-input-xxs dm-journey__skill-choice" aria-label="Skill for ${this._escAttr(actDef.label)}" title="Skill used (auto-picks the best by default)"><option value="" ${!act.skillChoice ? "selected" : ""}>Auto${chosenSkill ? ` (${this._fmtSkillName(chosenSkill)})` : ""}</option>${optsHtml}</select>`;
			selSkill.onn("change", () => {
				act.skillChoice = selSkill.val() || null;
				this._reconcileRm({reason: `Skill changed (${player.name})`});
				this._reRenderCurrentTab();
				this._doSave();
			});
			selSkill.appendTo(eleBonusCell);
		}

		/* ---- DC cell ---- */
		const {dc, impossible, notes: dcNotes} = act.activity
			? this._getEffectiveDc(act.activity, activityList, activities, allPlayers, segmentIndex)
			: {dc: null, impossible: false, notes: []};

		let dcStr = "\u2014";
		let dcCls = "dm-journey__dc-cell";
		if (impossible) {
			dcStr = "N/A";
			dcCls += " dm-journey__dc-cell--impossible";
		} else if (actDef?.isTracking) {
			dcStr = `${this._getTrackTerrainDc(act)}`;
			dcCls += " dm-journey__dc-cell--modified";
		} else if (dc != null) {
			dcStr = `${dc}`;
			if (dcNotes.length) dcCls += " dm-journey__dc-cell--modified";
		}
		const dcTitle = impossible
			? "Impossible at current pace"
			: actDef?.isTracking
				? "Terrain DC (set below) — Soft 10 / Common 15 / Hard 20 / Barren 25"
				: dcNotes.length ? `Base ${this._state.area.baseDc ?? 10}: ${dcNotes.join(", ")}` : "";
		const eleDcCell = ee`<span class="${dcCls}" title="${this._escAttr(dcTitle)}">${dcStr}</span>`;

		/* ---- Roll input + crit cycle button ---- */
		const isTotalMode = this._state.rollMode === "total";
		const iptResult = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__roll-input" placeholder="${isTotalMode ? "Total" : "d20"}" value="${act.rollResult || ""}" aria-label="Roll for ${this._escAttr(player.name)}">`;

		/* Crit cycle button (total mode) — cycles: null → critSuccess → critFail → null */
		const CRIT_CYCLE = [null, "critSuccess", "critFail"];
		const CRIT_LABELS = {null: "\u2014", critSuccess: "\u21D1", critFail: "\u21D3"};
		const CRIT_CLASSES = {null: "dm-journey__crit-toggle--normal", critSuccess: "dm-journey__crit-toggle--crit-pass", critFail: "dm-journey__crit-toggle--crit-fail"};
		const CRIT_TITLES = {null: "Normal result (click to cycle)", critSuccess: "Critical Success (click to cycle)", critFail: "Critical Failure (click to cycle)"};

		const curCrit = act._critOverride || null;
		const btnCrit = ee`<button class="dm-journey__crit-toggle ${CRIT_CLASSES[curCrit]}" title="${CRIT_TITLES[curCrit]}" type="button" aria-label="Toggle critical result">${CRIT_LABELS[curCrit]}</button>`;
		btnCrit.toggleVe(isTotalMode && allowedSkills.length > 0);
		btnCrit.onn("click", () => {
			const curIdx = CRIT_CYCLE.indexOf(act._critOverride || null);
			act._critOverride = CRIT_CYCLE[(curIdx + 1) % CRIT_CYCLE.length];
			/* Re-evaluate RM for this roll with the new crit state. */
			this._logActivityRoll(act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList);
			this._reconcileRm({reason: `Crit toggle ${actDef?.label || "activity"} (${player.name})`});
			this._reRenderCurrentTab();
			this._doSave();
		});

		const eleRollCell = ee`<div class="dm-journey__roll-cell">${iptResult}${btnCrit}</div>`;

		iptResult.onn("change", () => {
			act.rollResult = iptResult.val()?.trim() || "";
			act._critOverride = isTotalMode ? (act._critOverride || null) : null;
			this._logActivityRoll(act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList);
			this._reconcileRm({reason: `${player.name} rolled ${actDef?.label || "activity"}`});
			this._reRenderCurrentTab();
			this._doSave();
		});

		/* ---- Result cell ---- */
		const eleResultCell = this._renderActivityResultCell(act, actDef, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList);

		/* ---- Player name + remove button ---- */
		let eleNameCell;
		if (isFirstRow) {
			eleNameCell = ee`<span class="dm-journey__player-name" title="${this._escAttr(player.name)}">${this._escHtml(player.name || "Unnamed")}</span>`;
			if (!player.isFromPartyTracker) {
				const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs dm-journey__remove-player" title="Remove ${this._escAttr(player.name)}" aria-label="Remove ${this._escAttr(player.name)}">\u00d7</button>`;
				btnRemove.onn("click", () => {
					this._undoPlayerRm(player);
					this._state.players = this._state.players.filter(p => p.id !== player.id);
					this._addLog("party-sync", `Removed player: ${player.name}`);
					this._updateSyncStatus();
					this._reRenderCurrentTab();
					this._doSave();
				});
				eleNameCell.appendChild(btnRemove);
			}
		} else {
			eleNameCell = ee`<span class="dm-journey__player-name dm-journey__note">\u21B3</span>`;
		}

		/* Row class — add impossible highlight */
		const rowCls = `dm-journey__activity-row${impossible ? " dm-journey__activity-row--impossible" : ""}`;

		/* Activity info popover (full system doc) */
		let eleInfoBtn = "";
		if (actDef) {
			const popover = this._renderActivityPopover(actDef);
			eleInfoBtn = ee`<button class="dm-journey__info-btn" aria-label="Activity info" type="button">\u2139</button>`;
			eleInfoBtn.onn("mouseenter", () => popover.classList.add("dm-journey__popover--visible"));
			eleInfoBtn.onn("mouseleave", () => popover.classList.remove("dm-journey__popover--visible"));
			eleInfoBtn.appendChild(popover);
		}

		const eleActivityCell = ee`<div class="dm-journey__activity-cell">
			${sel}${iptCustom}
			${eleInfoBtn}
		</div>`;

		/* ---- Banter cell (column 7) ---- */
		let eleBanterCell;
		if (isFirstRow && banterKey) {
			const cbxBanter = ee`<input type="checkbox" ${activities[banterKey] ? "checked" : ""} aria-label="Bantering" title="Also Bantering — grants Inspiration Points">`;
			cbxBanter.onn("change", () => {
				activities[banterKey] = cbxBanter.prop("checked");
				this._doSave();
			});
			eleBanterCell = ee`<span class="dm-journey__banter-cell">${cbxBanter}</span>`;
		} else {
			eleBanterCell = ee`<span class="dm-journey__banter-cell"></span>`;
		}

		return ee`<div class="${rowCls}">
			${eleNameCell}
			${eleActivityCell}
			${eleBonusCell}
			${eleDcCell}
			${eleRollCell}
			${eleResultCell}
			${eleBanterCell}
		</div>`;
	}

	/* ---- Popover with full activity description ---- */

	_renderActivityPopover (actDef) {
		const lines = [];
		if (actDef.desc) lines.push(`<div class="dm-journey__popover-desc">${this._escHtml(actDef.desc)}</div>`);
		if (actDef.skill) lines.push(`<div class="dm-journey__popover-skill">Skill: ${this._escHtml(actDef.skill)}</div>`);

		const outcomes = [];
		if (actDef.successText) outcomes.push(`<div class="dm-journey__popover-outcome"><span class="dm-journey__popover-outcome-label dm-journey__popover-outcome-label--pass">Success:</span> ${this._escHtml(actDef.successText)}</div>`);
		if (actDef.critSuccessText) outcomes.push(`<div class="dm-journey__popover-outcome"><span class="dm-journey__popover-outcome-label dm-journey__popover-outcome-label--crit-pass">Crit Success:</span> ${this._escHtml(actDef.critSuccessText)}</div>`);
		if (actDef.failureText) outcomes.push(`<div class="dm-journey__popover-outcome"><span class="dm-journey__popover-outcome-label dm-journey__popover-outcome-label--fail">Failure:</span> ${this._escHtml(actDef.failureText)}</div>`);
		if (actDef.critFailText) outcomes.push(`<div class="dm-journey__popover-outcome"><span class="dm-journey__popover-outcome-label dm-journey__popover-outcome-label--crit-fail">Crit Failure:</span> ${this._escHtml(actDef.critFailText)}</div>`);
		if (outcomes.length) lines.push(`<div class="dm-journey__popover-outcomes">${outcomes.join("")}</div>`);

		if (actDef.restrictionText) lines.push(`<div class="dm-journey__popover-restriction"><span class="ve-bold">Restrictions:</span> ${this._escHtml(actDef.restrictionText)}</div>`);

		return ee`<div class="dm-journey__popover">
			<div class="dm-journey__popover-title">${this._escHtml(actDef.label)}</div>
			${lines.join("")}
		</div>`;
	}

	/* ---- Activity roll logging (RM itself is handled centrally by _reconcileRm) ---- */

	/**
	 * Append a per-roll entry to the activity log describing the individual result. RM changes are
	 * NOT applied here — {@link _reconcileRm} is the single authority for derived Risk Modifier — so
	 * this only records the roll and flags a successful forage.
	 */
	_logActivityRoll (act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList) {
		const rollNum = parseInt(act.rollResult, 10);
		if (isNaN(rollNum) || !getActivitySkills(actDef).length || dc == null || impossible) return;

		const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, act.skillChoice) : {total: 0};
		const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
		const outcome = this._classifyActivityRoll(rollNum, total, dc, actDef, isTotalMode, act._critOverride, activities, allPlayers, activityList);

		const logStr = isTotalMode
			? `${player.name} \u2014 ${actDef.label}: total ${total} vs DC ${dc}`
			: `${player.name} \u2014 ${actDef.label}: d20(${rollNum}) ${this._fmtBonus(bonusInfo.total)} = ${total} vs DC ${dc}`;

		const OUTCOME_LABELS = {critSuccess: "Critical Success", success: "Success", fail: "Failure", critFail: "Critical Failure"};
		this._addLog("activity", `${logStr} \u2192 ${OUTCOME_LABELS[outcome]}`);

		/* Forage success: flag that rations may be gained (DM enters the amount from the result cell). */
		if (actDef.id === "forage" && (outcome === "success" || outcome === "critSuccess")) act._forageLogged = true;
	}

	/** Classify a roll as critSuccess/success/fail/critFail. */
	_classifyActivityRoll (rollNum, total, dc, actDef, isTotalMode, critOverride, activities, allPlayers, activityList) {
		/* Total mode: use manual crit override if present */
		if (isTotalMode && critOverride) return critOverride;

		/* Group check (2+ players with the same activity) — resolved as one group outcome. */
		const count = this._countPlayersWithActivity(actDef.id, activities, allPlayers);
		if (count >= 2) {
			const groupResult = this._evaluateGroupCheck(actDef, activities, allPlayers, dc);
			if (groupResult) return groupResult;
			/* Not everyone has rolled yet — fall back to this player's individual result. */
		}

		return classifySingleRoll({rollNum, total, dc, isTotalMode});
	}

	/** Count how many activity slots across all players have the given activity. */
	_countPlayersWithActivity (activityId, activities, allPlayers) {
		let count = 0;
		for (const p of allPlayers) {
			const slots = activities[p.id];
			if (!slots) continue;
			const arr = Array.isArray(slots) ? slots : [slots];
			for (const s of arr) {
				if (s?.activity === activityId) count++;
			}
		}
		return count;
	}

	/**
	 * Evaluate a group check for an activity. Returns null until every participating slot has a roll;
	 * once all have rolled, delegates to the locked `evaluateGroupCheck` model (all pass → critSuccess,
	 * all fail → critFail, otherwise standard 5e ≥-half success).
	 */
	_evaluateGroupCheck (actDef, activities, allPlayers, dc) {
		const isTotalMode = this._state.rollMode === "total";
		const relevantSlots = [];
		for (const p of allPlayers) {
			const slots = activities[p.id];
			if (!slots) continue;
			const arr = Array.isArray(slots) ? slots : [slots];
			for (const s of arr) {
				if (s?.activity === actDef.id) relevantSlots.push({slot: s, playerId: p.id});
			}
		}
		if (relevantSlots.length < 2) return null;

		const passResults = [];
		for (const {slot, playerId} of relevantSlots) {
			const rollNum = parseInt(slot.rollResult, 10);
			if (isNaN(rollNum)) return null; /* wait until everyone has rolled */

			const ptChar = this._getPartyTrackerCharacters().find(c => c.id === playerId);
			const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, slot.skillChoice) : {total: 0};
			const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
			passResults.push(total >= dc);
		}

		return evaluateGroupCheck(passResults);
	}

	/** Render the result cell based on current activity state. */
	_renderActivityResultCell (act, actDef, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList) {
		/* Track uses its own terrain-DC + Degrees-of-Success panel. */
		if (actDef?.isTracking) {
			if (impossible) {
				const cell = ee`<span class="dm-journey__roll-result dm-journey__roll-result--fail"></span>`;
				cell.txt("Not possible at Fast pace");
				return cell;
			}
			return this._renderTrackResult(act, actDef, ptChar, isTotalMode);
		}

		const eleResultCell = ee`<span class="dm-journey__roll-result"></span>`;

		if (act.rollResult !== "" && act.rollResult != null) {
			const rollNum = parseInt(act.rollResult, 10);
			if (!isNaN(rollNum) && getActivitySkills(actDef).length && dc != null) {
				const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, act.skillChoice) : {total: 0};
				const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
				const outcome = this._classifyActivityRoll(rollNum, total, dc, actDef, isTotalMode, act._critOverride, activities, allPlayers, activityList);

				const ICONS = {critSuccess: "\u2714\u2714", success: "\u2714", fail: "\u2718", critFail: "\u2718\u2718"};
				const CLASSES = {critSuccess: "dm-journey__roll-result--crit-pass", success: "dm-journey__roll-result--pass", fail: "dm-journey__roll-result--fail", critFail: "dm-journey__roll-result--crit-fail"};
				const LABELS = {critSuccess: "Crit!", success: "", fail: "", critFail: "Crit Fail!"};

				eleResultCell.className = `dm-journey__roll-result ${CLASSES[outcome]}`;
				const resultParts = [`${ICONS[outcome]} ${total}`];
				if (LABELS[outcome]) resultParts.push(LABELS[outcome]);
				if (act._rmRollApplied) resultParts.push(`(RM ${act._rmRollApplied > 0 ? "+" : ""}${act._rmRollApplied})`);
				if (act._rmAlwaysApplied) resultParts.push(`(auto ${act._rmAlwaysApplied > 0 ? "+" : ""}${act._rmAlwaysApplied})`);
				eleResultCell.txt(resultParts.join(" "));

				/* Forage success: add rations button */
				if (actDef.id === "forage" && (outcome === "success" || outcome === "critSuccess")) {
					const btnAddRations = ee`<button class="ve-btn ve-btn-success ve-btn-xxs dm-journey__supply-forage-btn" title="Add foraged rations to supplies">+\uD83C\uDF56</button>`;
					btnAddRations.onn("click", () => {
						const amount = parseInt(prompt("Rations found (e.g. 1d4 = roll result):"), 10);
						if (!isNaN(amount) && amount > 0) {
							this._addForagedRations(amount);
							this._renderJourney();
						}
					});
					eleResultCell.appendChild(btnAddRations);
				}
			}
		} else if (act._rmAlwaysApplied) {
			eleResultCell.className = "dm-journey__roll-result dm-journey__rm-auto";
			eleResultCell.txt(`auto RM ${act._rmAlwaysApplied > 0 ? "+" : ""}${act._rmAlwaysApplied}`);
		}

		return eleResultCell;
	}

	/* -------------------------------------------- */
	/*  Track sub-system (system-neutral)            */
	/* -------------------------------------------- */

	_getTrackTerrainDc (act) {
		const key = act?.trackTerrain || "common";
		const terrain = TRACKING_TERRAINS.find(t => t.key === key) || TRACKING_TERRAINS[1];
		return terrain.dc;
	}

	/** Interactive Track panel: terrain-DC picker + advisory modifiers + Degrees of Success. */
	_renderTrackResult (act, actDef, ptChar, isTotalMode) {
		const wrp = ee`<span class="dm-journey__roll-result dm-journey__track-result"></span>`;

		/* Terrain DC picker (sets the base DC for the check). */
		const terrainKey = act.trackTerrain || "common";
		const selTerrain = ee`<select class="ve-form-control ve-input-xxs dm-journey__track-terrain" aria-label="Track terrain" title="Terrain difficulty sets the base DC">
			${TRACKING_TERRAINS.map(t => `<option value="${t.key}" ${terrainKey === t.key ? "selected" : ""} title="${this._escAttr(t.examples)}">${this._escHtml(t.label)} (DC ${t.dc})</option>`).join("")}
		</select>`;
		selTerrain.onn("change", () => {
			act.trackTerrain = selTerrain.val();
			this._reRenderCurrentTab();
			this._doSave();
		});
		selTerrain.appendTo(wrp);

		/* Advisory circumstance modifiers (DM adjudicates manually). */
		const infoBtn = ee`<button class="dm-journey__info-btn" type="button" aria-label="Tracking circumstance modifiers">\u2139</button>`;
		const pop = ee`<div class="dm-journey__popover dm-journey__track-popover">
			<div class="dm-journey__popover-title">Circumstance Modifiers (DM adjudicates)</div>
			<ul class="dm-journey__track-mods">${TRACKING_MODIFIERS.map(m => `<li>${this._escHtml(m.label)}</li>`).join("")}</ul>
		</div>`;
		infoBtn.onn("mouseenter", () => pop.classList.add("dm-journey__popover--visible"));
		infoBtn.onn("mouseleave", () => pop.classList.remove("dm-journey__popover--visible"));
		infoBtn.appendChild(pop);
		infoBtn.appendTo(wrp);

		/* Degree of success from the entered roll. */
		if (act.rollResult !== "" && act.rollResult != null) {
			const rollNum = parseInt(act.rollResult, 10);
			if (!isNaN(rollNum)) {
				const dc = this._getTrackTerrainDc(act);
				const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, act.skillChoice) : {total: 0};
				const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
				const degree = classifyTrackingDegree(total, dc);
				const DEG_CLS = {
					master: "dm-journey__track-degree--master",
					expert: "dm-journey__track-degree--expert",
					solid: "dm-journey__track-degree--solid",
					path: "dm-journey__track-degree--path",
					lost: "dm-journey__track-degree--lost",
				};
				ee`<span class="dm-journey__track-degree ${DEG_CLS[degree.key]}" title="${this._escAttr(degree.info)}">${total} vs DC ${dc} \u2014 ${this._escHtml(degree.label)}: ${this._escHtml(degree.title)}</span>`.appendTo(wrp);
			}
		}

		/* Pace restriction note (Fast = impossible is handled upstream). */
		if (this._state.travelPace === "normal") {
			ee`<span class="dm-journey__note">Disadvantage (Normal pace)</span>`.appendTo(wrp);
		}

		return wrp;
	}

	_renderArea () {
		if (!this._wrpArea) return;
		this._wrpArea.innerHTML = "";

		const area = this._state.area;

		/* Area name */
		const iptName = ee`<input type="text" class="ve-form-control dm-journey__area-name-input" placeholder="Area name (e.g. Dead Forest)" value="${this._escAttr(area.areaName)}" aria-label="Area name">`;
		iptName.onn("change", () => {
			area.areaName = iptName.val();
			this._doSave();
		});

		/* Number of segments */
		const iptSegCount = ee`<input type="number" class="ve-form-control ve-input-xs" min="1" max="6" value="${area.numSegments}" style="width: 50px;" aria-label="Number of travel segments">`;

		/* Base DC */
		const iptBaseDc = ee`<input type="number" class="ve-form-control ve-input-xs" min="1" max="30" value="${area.baseDc ?? 10}" style="width: 50px;" aria-label="Base DC">`;
		iptBaseDc.onn("change", () => {
			const val = Math.max(1, Math.min(30, parseInt(iptBaseDc.val(), 10) || 10));
			area.baseDc = val;
			iptBaseDc.val(val);
			this._reconcileRm({reason: "Base DC changed"});
			this._reRenderCurrentTab();
			this._doSave();
		});
		iptSegCount.onn("change", () => {
			const val = Math.max(1, Math.min(6, parseInt(iptSegCount.val(), 10) || 3));
			area.numSegments = val;
			iptSegCount.val(val);
			/* Adjust segment names array */
			while (area.segmentNames.length < val) area.segmentNames.push(`Segment ${area.segmentNames.length + 1}`);
			area.segmentNames.length = val;
			this._ensureSegments();
			this._renderArea();
			this._renderJourney();
			this._doSave();
		});

		/* Segment names */
		const wrpSegNames = ee`<div class="ve-flex-col ve-gap-1 ve-mb-2"></div>`;
		for (let i = 0; i < area.numSegments; i++) {
			const iptSeg = ee`<input type="text" class="ve-form-control ve-input-xs" value="${this._escAttr(area.segmentNames[i] || "")}" placeholder="Segment ${i + 1}" aria-label="Segment ${i + 1} name">`;
			iptSeg.onn("change", () => {
				area.segmentNames[i] = iptSeg.val();
				this._renderJourney();
				this._doSave();
			});
			ee`<div class="ve-flex-v-center ve-gap-1">
				<span class="dm-journey__label">Segment ${i + 1}:</span>
				${iptSeg}
			</div>`.appendTo(wrpSegNames);
		}

		/* Risk ranges */
		const wrpRanges = this._renderRiskRangeEditor();

		/* Buttons */
		const btnReset = ee`<button class="ve-btn ve-btn-default ve-btn-sm">Reset Defaults</button>`;
		btnReset.onn("click", () => {
			if (!confirm("Reset area configuration to defaults?")) return;
			this._state.area = DEFAULT_AREA();
			this._ensureSegments();
			this._renderArea();
			this._renderJourney();
			this._doSave();
		});

		/* Weather config */
		const eleWeather = this._renderWeatherSection();

		ee`<div class="ve-flex-col ve-gap-2 ve-p-2">
			<div>
				<label class="ve-bold">Area Name</label>
				${iptName}
			</div>
			<div>
				<label class="ve-bold">Base DC</label>
				<div class="ve-flex-v-center ve-gap-1">
					${iptBaseDc}
					<span class="dm-journey__note">(modified by pace, weather &amp; activity interactions)</span>
				</div>
			</div>
			<div>
				<label class="ve-bold">Weather</label>
				${eleWeather}
			</div>
			<div>
				<label class="ve-bold">Travel Segments</label>
				<div class="ve-flex-v-center ve-gap-1 ve-mb-1">
					<span>Count:</span> ${iptSegCount}
				</div>
				${wrpSegNames}
			</div>
			<div>
				<label class="ve-bold">Risk Ranges</label>
				${wrpRanges}
			</div>
			<div class="ve-flex ve-gap-2">
				${btnReset}
			</div>
		</div>`.appendTo(this._wrpArea);
	}

	_renderRiskRangeEditor () {
		const ranges = this._state.area.riskRanges;
		const wrp = ee`<div class="ve-flex-col ve-gap-1"></div>`;

		for (const [key, colorInfo] of [["mild", RANGE_COLORS.mild], ["moderate", RANGE_COLORS.moderate], ["intense", RANGE_COLORS.intense]]) {
			const range = ranges[key];

			const iptMin = ee`<input type="number" class="ve-form-control ve-input-xs" style="width: 50px;" value="${range.min}" aria-label="${colorInfo.label} minimum">`;
			const iptMax = ee`<input type="number" class="ve-form-control ve-input-xs" style="width: 50px;" value="${range.max}" aria-label="${colorInfo.label} maximum">`;

			const onUpdate = () => {
				range.min = parseInt(iptMin.val(), 10) || 0;
				range.max = parseInt(iptMax.val(), 10) || 0;
				this._doSave();
			};
			iptMin.onn("change", onUpdate);
			iptMax.onn("change", onUpdate);

			ee`<div class="ve-flex-v-center ve-gap-1">
				<span class="dm-journey__range-label ${colorInfo.cls}" style="min-width: 70px;">${colorInfo.label}</span>
				${iptMin}
				<span>to</span>
				${iptMax}
			</div>`.appendTo(wrp);
		}

		ee`<div class="dm-journey__note ve-mt-1"><i>Rolls below Mild min are "Empty" (no encounter).</i></div>`.appendTo(wrp);

		return wrp;
	}

	/* -------------------------------------------- */
	/*  Log Tab                                      */
	/* -------------------------------------------- */

	_renderLog () {
		if (!this._wrpLog) return;
		this._wrpLog.innerHTML = "";

		const log = this._state.log;

		const wrpBtns = ee`<div class="ve-flex ve-gap-1 ve-mb-2"></div>`;

		const btnAddNote = ee`<button class="ve-btn ve-btn-primary ve-btn-xs"><span class="glyphicon glyphicon-pencil" aria-hidden="true"></span> Add Note</button>`;
		btnAddNote.onn("click", () => {
			const note = prompt("Enter a note:");
			if (note == null || !note.trim()) return;
			this._addLog("note", note.trim());
			this._renderLog();
			this._doSave();
		});

		const btnClear = ee`<button class="ve-btn ve-btn-danger ve-btn-xs">Clear Log</button>`;
		btnClear.onn("click", () => {
			if (!confirm("Clear all log entries?")) return;
			this._state.log = [];
			this._renderLog();
			this._doSave();
		});

		wrpBtns.appendChild(btnAddNote);
		wrpBtns.appendChild(btnClear);
		this._wrpLog.appendChild(wrpBtns);

		const wrpEntries = ee`<div class="dm-journey__log-entries"></div>`;

		if (!log.length) {
			ee`<div class="dm-journey__empty-msg"><i>No log entries yet.</i></div>`.appendTo(wrpEntries);
		} else {
			/* Newest first */
			for (let i = log.length - 1; i >= 0; i--) {
				const entry = log[i];
				const eleEntry = this._renderLogEntry(entry);
				wrpEntries.appendChild(eleEntry);
			}
		}

		this._wrpLog.appendChild(wrpEntries);
	}

	_renderLogEntry (entry) {
		const typeClass = `dm-journey__log-entry--${entry.type}`;
		const timeStr = this._fmtTimestamp(entry.timestamp);

		return ee`<div class="dm-journey__log-entry ${typeClass}">
			<span class="dm-journey__log-time">${timeStr}</span>
			<span class="dm-journey__log-msg">${this._escHtml(entry.message)}</span>
		</div>`;
	}

	/* -------------------------------------------- */
	/*  Risk Roll                                    */
	/* -------------------------------------------- */

	_doRiskRoll () {
		const die = Math.ceil(Math.random() * 12);
		const total = die + this._state.riskModifier;
		const range = this._classifyRoll(total);
		const rangeLabel = RANGE_COLORS[range]?.label || "Empty";

		this._addLog("risk-roll", `Risk Roll: d12(${die}) + RM(${this._state.riskModifier}) = ${total} \u2192 ${rangeLabel}`);

		return {die, total, range};
	}

	_classifyRoll (total) {
		return classifyRiskRange(total, this._state.area.riskRanges);
	}

	_renderRiskBadge (segOrCamp) {
		if (segOrCamp.riskRoll == null) return ee`<span class="dm-journey__badge dm-journey__badge--none">—</span>`;

		const effectiveTotal = segOrCamp.riskRollOverride ?? segOrCamp.riskRollTotal;
		const range = this._classifyRoll(effectiveTotal);
		const colorInfo = RANGE_COLORS[range];

		const overrideNote = segOrCamp.riskRollOverride != null ? " (override)" : "";
		const dieStr = `d12(${segOrCamp.riskRoll}) + RM(${segOrCamp.rmAtRoll}) = ${segOrCamp.riskRollTotal}`;

		return ee`<span class="dm-journey__badge ${colorInfo.cls}" title="${dieStr}${overrideNote}">
			${effectiveTotal} \u2014 ${colorInfo.label}
		</span>`;
	}

	/* -------------------------------------------- */
	/*  Risk Modifier                                */
	/* -------------------------------------------- */

	_setRm (newVal, reason) {
		const old = this._state.riskModifier;
		if (newVal === old) return;
		this._state.riskModifier = newVal;
		this._addLog("rm-change", `RM: ${old} \u2192 ${newVal} (${reason})`);
		this._updateRmDisplay();
		this._doSave();
	}

	/**
	 * Remove a player from all activity + stealth group checks, netting out every derived RM
	 * contribution they were part of. Works by neutralising the player's activity slots (activity →
	 * none) and dropping them from stealth, then running the central {@link _reconcileRm}, which
	 * recomputes each affected group without them. Finally the emptied slot data is discarded.
	 * (The caller removes the player from the roster.)
	 */
	_undoPlayerRm (player) {
		const neutralise = (container) => {
			const slots = container?.activities?.[player.id];
			if (!Array.isArray(slots)) return;
			for (const slot of slots) {
				if (!slot || typeof slot !== "object") continue;
				slot.activity = "";
				slot.rollResult = "";
				slot._critOverride = null;
			}
		};

		for (const seg of this._state.journey.segments) {
			seg.stealthSlots = (seg.stealthSlots || []).filter(slot => slot.playerId !== player.id);
			neutralise(seg);
		}
		neutralise(this._state.camp);

		this._reconcileRm({reason: `Removed ${player.name}`});

		/* Discard the now-empty slot data so it doesn't linger as an orphan in saved state. */
		for (const seg of this._state.journey.segments) { if (seg.activities) delete seg.activities[player.id]; }
		if (this._state.camp.activities) delete this._state.camp.activities[player.id];
	}

	/**
	 * Single source of truth for all *derived* Risk-Modifier contributions — activity group-check
	 * roll RM, per-slot always-on RM, and stealth group checks — across every journey segment and the
	 * camp. Each source's correct value is recomputed and net-diffed against its previously-recorded
	 * contribution, then one aggregate {@link _setRm} is applied. This makes RM idempotent and immune
	 * to the double-count / stale-value bugs of the old per-slot imperative apply/undo (Bug 3 J1/J2).
	 *
	 * @param {object}  [opts]
	 * @param {boolean} [opts.rebaseline]  When true, records are re-synced to their computed values
	 *   WITHOUT changing `riskModifier` — used on load and after a manual RM override (Reset / Manual
	 *   set / Intense reset) so subsequent edits apply as relative deltas from the manual base.
	 * @param {string}  [opts.reason]      Log reason for the aggregate change.
	 */
	_reconcileRm ({rebaseline = false, reason = "Recalculated activity RM"} = {}) {
		const netRef = {net: 0};

		this._state.journey.segments.forEach((seg, i) => {
			this._reconcileContainer(seg, JOURNEY_ACTIVITIES, i, rebaseline, netRef);
			/* Stealth group check only contributes at Slow pace (J2: zero-and-keep otherwise). */
			const prevStealth = seg.stealthGroupRm || 0;
			const targetStealth = this._state.travelPace === "slow" ? this._computeStealthGroup(seg).rmDelta : 0;
			if (!rebaseline) netRef.net += targetStealth - prevStealth;
			seg.stealthGroupRm = targetStealth;
		});

		this._reconcileContainer(this._state.camp, CAMP_ACTIVITIES, undefined, rebaseline, netRef);

		if (!rebaseline && netRef.net) this._setRm(this._state.riskModifier + netRef.net, reason);
	}

	/**
	 * Reconcile one activity container (a journey segment or the camp). Updates the container's
	 * `activityGroupRm` map (roll RM, keyed by activity id) and each slot's `_rmAlwaysApplied`
	 * (always-on RM), refreshes the display-only `_rmRollApplied` mirror, and accumulates the net RM
	 * change into `netRef.net`.
	 */
	_reconcileContainer (container, activityList, segmentIndex, rebaseline, netRef) {
		if (!container) return;
		const activities = container.activities || (container.activities = {});
		container.activityGroupRm = container.activityGroupRm || {};
		const allPlayers = this._state.players;

		/* Group slots by activity id; reset display mirrors; reconcile per-slot always-on RM. */
		const byActivity = {};
		for (const p of allPlayers) {
			const slots = activities[p.id];
			if (!Array.isArray(slots)) continue;
			for (const slot of slots) {
				if (!slot || typeof slot !== "object") continue;
				slot._rmRollApplied = 0; /* display mirror — recomputed below */

				const adef = activityList.find(a => a.id === slot.activity);
				const targetAlways = adef?.rmAlways || 0;
				const prevAlways = slot._rmAlwaysApplied || 0;
				if (!rebaseline) netRef.net += targetAlways - prevAlways;
				slot._rmAlwaysApplied = targetAlways;

				if (slot.activity) (byActivity[slot.activity] = byActivity[slot.activity] || []).push({slot, playerId: p.id});
			}
		}

		/* Reconcile each present activity group's roll RM. */
		for (const [activityId, entries] of Object.entries(byActivity)) {
			const target = this._computeGroupRmForActivity(activityId, entries, activityList, activities, allPlayers, segmentIndex);
			const prev = container.activityGroupRm[activityId] || 0;
			if (!rebaseline) netRef.net += target - prev;
			container.activityGroupRm[activityId] = target;

			/* Display mirror: show the whole group's RM once, on the first rolled participant. */
			const owner = entries.find(e => !Number.isNaN(parseInt(e.slot.rollResult, 10)));
			if (owner) owner.slot._rmRollApplied = target;
		}

		/* Drop stale map entries for activities no longer present in the container. */
		for (const activityId of Object.keys(container.activityGroupRm)) {
			if (byActivity[activityId]) continue;
			const prev = container.activityGroupRm[activityId] || 0;
			if (!rebaseline) netRef.net -= prev;
			delete container.activityGroupRm[activityId];
		}
	}

	/** Build the pure participant-slot list for an activity group and delegate to computeActivityGroupRm. */
	_computeGroupRmForActivity (activityId, entries, activityList, activities, allPlayers, segmentIndex) {
		const actDef = activityList.find(a => a.id === activityId);
		if (!actDef) return 0;
		const {dc, impossible} = this._getEffectiveDc(activityId, activityList, activities, allPlayers, segmentIndex);
		if (dc == null || impossible) return 0;

		/* Group-check participants are unique PLAYERS, not slots — collapse a player's multiple slots of
		 * the same activity to one entry (prefer a rolled slot) so Scout/crit scaling counts players. */
		const byPlayer = new Map();
		for (const e of entries) {
			const existing = byPlayer.get(e.playerId);
			const eRolled = !Number.isNaN(parseInt(e.slot.rollResult, 10));
			if (!existing) { byPlayer.set(e.playerId, e); continue; }
			const existingRolled = !Number.isNaN(parseInt(existing.slot.rollResult, 10));
			if (eRolled && !existingRolled) byPlayer.set(e.playerId, e);
		}

		const isTotalMode = this._state.rollMode === "total";
		const ptChars = this._getPartyTrackerCharacters();
		const participantSlots = [...byPlayer.values()].map(({slot, playerId}) => {
			const rollNum = parseInt(slot.rollResult, 10);
			if (Number.isNaN(rollNum)) return {rollNum: null, total: null, critOverride: null};
			const ptChar = ptChars.find(c => c.id === playerId);
			const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef, slot.skillChoice) : {total: 0};
			const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
			return {rollNum, total, critOverride: slot._critOverride || null};
		});

		return computeActivityGroupRm({actDef, dc, isTotalMode, participantSlots});
	}

	/** A fresh, fully-shaped camp object (used by New Day and camp resets). */
	_makeEmptyCamp () {
		return {
			campfireActive: false,
			siteDescription: "",
			activities: {},
			activityGroupRm: {},
			guardSlots: [],
			riskRoll: null,
			riskRollTotal: null,
			riskRollOverride: null,
			rmAtRoll: 0,
			encounterResolved: false,
		};
	}

	/**
	 * On load, re-sync the derived-RM bookkeeping (per-container `activityGroupRm` maps + per-slot
	 * `_rmAlwaysApplied` / `_rmRollApplied` mirrors) to the values the current activity data implies,
	 * WITHOUT rewriting the DM's saved `riskModifier`. A legacy save carrying the old double-count
	 * keeps its saved RM (self-heals on the next New Day full reset); new edits net-diff from the
	 * corrected baseline so they never double-count again.
	 */
	_migrateRmBookkeeping () {
		/* Prune orphan slot data for players no longer in the roster. `_reconcileContainer` only
		 * iterates roster players, but `sumContainerRm` (used on segment trim) counts every slot —
		 * a lingering orphan `_rmAlwaysApplied` would otherwise be subtracted without ever having been
		 * reconciled in. Removing them keeps the two views of a container's RM consistent. */
		const rosterIds = new Set(this._state.players.map(p => p.id));
		const pruneContainer = (container) => {
			if (!container?.activities) return;
			for (const pid of Object.keys(container.activities)) {
				if (!rosterIds.has(pid)) delete container.activities[pid];
			}
		};
		for (const seg of this._state.journey.segments) {
			seg.activityGroupRm = seg.activityGroupRm || {};
			if (Array.isArray(seg.stealthSlots)) seg.stealthSlots = seg.stealthSlots.filter(s => rosterIds.has(s.playerId));
			pruneContainer(seg);
		}
		this._state.camp.activityGroupRm = this._state.camp.activityGroupRm || {};
		pruneContainer(this._state.camp);
		this._reconcileRm({rebaseline: true});
	}

	_updateRmDisplay () {
		if (this._eleRmValue) {
			this._eleRmValue.val(this._state.riskModifier);
		}
		this._updateRmBadge();
	}

	_updateRmBadge () {
		if (!this._eleRmBadge) return;
		const rm = this._state.riskModifier;
		this._eleRmBadge.txt(rm >= 0 ? `+${rm}` : `${rm}`);
		this._eleRmBadge.className = "dm-journey__rm-badge";
		/* Documented scale: ≤2 low (green) · 3–6 mid (yellow) · ≥7 high (red). */
		if (rm <= 2) this._eleRmBadge.classList.add("dm-journey__rm-badge--low");
		else if (rm <= 6) this._eleRmBadge.classList.add("dm-journey__rm-badge--mid");
		else this._eleRmBadge.classList.add("dm-journey__rm-badge--high");
	}

	/* -------------------------------------------- */
	/*  Party Integration                            */
	/* -------------------------------------------- */

	syncPartyCharacters () {
		const ptChars = this._getPartyTrackerCharacters();

		if (!ptChars.length) {
			this._updateSyncStatus();
			return;
		}

		const existingIds = new Set(this._state.players.filter(p => p.isFromPartyTracker).map(p => p.id));
		const ptIds = new Set(ptChars.map(c => c.id));

		/* Add new PT characters */
		const added = [];
		for (const ptChar of ptChars) {
			if (!ptChar?.id) continue;
			if (!existingIds.has(ptChar.id)) {
				this._state.players.push({
					id: ptChar.id,
					name: ptChar.name || "Unnamed",
					isFromPartyTracker: true,
				});
				added.push(ptChar.name || "Unnamed");
			} else {
				/* Update name if changed */
				const existing = this._state.players.find(p => p.id === ptChar.id);
				if (existing) existing.name = ptChar.name || "Unnamed";
			}
		}

		/* Remove departed PT characters: net out their RM contributions BEFORE dropping them from
		 * the roster (reconcile needs the roster to still include them to zero their groups). */
		const removed = [];
		const departed = this._state.players.filter(p => p.isFromPartyTracker && !ptIds.has(p.id));
		for (const p of departed) {
			removed.push(p.name);
			this._undoPlayerRm(p);
		}
		if (departed.length) {
			const departedIds = new Set(departed.map(p => p.id));
			this._state.players = this._state.players.filter(p => !departedIds.has(p.id));
		}

		/* Recompute derived RM for name/bonus changes on the remaining synced characters. */
		this._reconcileRm({reason: "Party sync"});

		/* Log sync */
		const parts = [];
		if (added.length) parts.push(`added ${added.join(", ")}`);
		if (removed.length) parts.push(`removed ${removed.join(", ")}`);
		if (parts.length) {
			this._addLog("party-sync", `Party synced: ${parts.join("; ")}`);
		}

		this._updateSyncStatus();
		this._syncSupplyBurnRates();
		this._reRenderCurrentTab();
		this._doSave();
	}

	_getPartyTrackerCharacters () {
		try {
			return DmScreenUtil.getPartyTrackerCharacters({board: this._board}) || [];
		} catch {
			return [];
		}
	}

	_updateSyncStatus () {
		if (!this._eleSyncStatus) return;
		const ptChars = this._getPartyTrackerCharacters();
		if (ptChars.length) {
			this._eleSyncStatus.txt(`Synced (${ptChars.length} chars)`);
			this._eleSyncStatus.className = "dm-journey__sync-status dm-journey__sync-status--active";
		} else {
			this._eleSyncStatus.txt("Manual mode");
			this._eleSyncStatus.className = "dm-journey__sync-status dm-journey__sync-status--manual";
		}
	}

	_addManualPlayer () {
		const name = prompt("Player/character name:");
		if (name == null || !name.trim()) return;
		this._state.players.push({
			id: CryptUtil.uid(),
			name: name.trim(),
			isFromPartyTracker: false,
		});
		this._addLog("party-sync", `Manually added player: ${name.trim()}`);
		this._reRenderCurrentTab();
		this._doSave();
	}

	/* -------------------------------------------- */
	/*  Timeline Tab                                 */
	/* -------------------------------------------- */

	_renderTimeline () {
		if (!this._wrpTimeline) return;
		this._wrpTimeline.innerHTML = "";

		const tl = this._state.timeline;

		/* Journey name + start date */
		const iptName = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__timeline-name" placeholder="Journey name (optional)" value="${this._escAttr(tl.journeyName)}" aria-label="Journey name">`;
		iptName.onn("change", () => {
			tl.journeyName = iptName.val()?.trim() || "";
			this._doSave();
		});

		const iptDate = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__timeline-date" placeholder="Start date (optional)" value="${this._escAttr(tl.startDate)}" aria-label="Start date">`;
		iptDate.onn("change", () => {
			tl.startDate = iptDate.val()?.trim() || "";
			this._doSave();
		});

		ee`<div class="dm-journey__timeline-header">
			<div class="dm-journey__timeline-field">
				<span class="dm-journey__label">Journey:</span>
				${iptName}
			</div>
			<div class="dm-journey__timeline-field">
				<span class="dm-journey__label">Started:</span>
				${iptDate}
			</div>
		</div>`.appendTo(this._wrpTimeline);

		/* Running totals */
		if (tl.days.length) {
			const totalDays = tl.days.length;
			const totalEncounters = tl.days.reduce((sum, d) => {
				const encounterCount = d.riskRollResults?.filter(r => r.range && r.range !== "empty").length || 0;
				return sum + encounterCount;
			}, 0);
			const avgRm = Math.round(tl.days.reduce((sum, d) => sum + (d.rmEnd ?? 0), 0) / totalDays * 10) / 10;

			ee`<div class="dm-journey__timeline-totals">
				<span>Days: <strong>${totalDays}</strong></span>
				<span>\u00b7</span>
				<span>Risk Rolls: <strong>${totalEncounters}</strong></span>
				<span>\u00b7</span>
				<span>Avg RM: <strong>${avgRm}</strong></span>
				<span>\u00b7</span>
				<span>Current: <strong>Day ${tl.currentDayIndex + 1}</strong></span>
			</div>`.appendTo(this._wrpTimeline);
		}

		/* Current day indicator */
		ee`<div class="dm-journey__timeline-current">
			<span class="dm-journey__timeline-current-badge">\ud83d\udcc5 Day ${tl.currentDayIndex + 1} (in progress)</span>
			<span class="dm-journey__note">${this._getWeatherPreset(this._state.weather.current)?.icon || ""} ${this._getWeatherPreset(this._state.weather.current)?.label || ""} \u00b7 ${this._state.travelPace} pace \u00b7 RM: ${this._state.riskModifier}</span>
		</div>`.appendTo(this._wrpTimeline);

		/* Day cards (reverse chronological) */
		if (!tl.days.length) {
			ee`<div class="dm-journey__empty-msg"><i>No days recorded yet. Click "New Day" to complete a day and record it here.</i></div>`.appendTo(this._wrpTimeline);
		} else {
			for (let i = tl.days.length - 1; i >= 0; i--) {
				const day = tl.days[i];
				const eleCard = this._renderTimelineDayCard(day, i);
				this._wrpTimeline.appendChild(eleCard);
			}
		}

		/* Copy Timeline button */
		if (tl.days.length) {
			const btnCopy = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__timeline-copy" title="Copy timeline as markdown to clipboard">\ud83d\udccb Copy Timeline</button>`;
			btnCopy.onn("click", () => {
				const md = this._buildTimelineMarkdown();
				navigator.clipboard.writeText(md).then(
					() => JqueryUtil.doToast({content: "Timeline copied to clipboard!", type: "success"}),
					() => JqueryUtil.doToast({content: "Failed to copy.", type: "danger"}),
				);
			});
			this._wrpTimeline.appendChild(btnCopy);
		}
	}

	_renderTimelineDayCard (day, index) {
		const weatherPreset = this._getWeatherPreset(day.weather);
		const isCollapsed = day._collapsed || false;

		const card = ee`<div class="dm-journey__timeline-card"></div>`;

		/* Header */
		const btnToggle = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" aria-label="Toggle day">${isCollapsed ? "\u25B6" : "\u25BC"}</button>`;
		btnToggle.onn("click", () => {
			day._collapsed = !day._collapsed;
			this._renderTimeline();
			this._doSave();
		});

		const header = ee`<div class="dm-journey__timeline-card-header">
			${btnToggle}
			<span class="dm-journey__timeline-day-label">Day ${day.dayNumber}</span>
			<span class="dm-journey__timeline-day-weather">${weatherPreset.icon} ${weatherPreset.label}</span>
			<span class="dm-journey__timeline-day-pace">${day.pace} pace</span>
			<span class="dm-journey__timeline-day-rm">RM: ${day.rmStart ?? 0} \u2192 ${day.rmEnd ?? 0}</span>
		</div>`;
		card.appendChild(header);

		if (!isCollapsed) {
			/* Risk rolls */
			if (day.riskRollResults?.length) {
				const rollParts = day.riskRollResults.map(r => {
					const rangeLabel = r.range ? RANGE_COLORS[r.range]?.label || r.range : "\u2014";
					return `${r.segment}: ${r.total ?? "\u2014"} (${rangeLabel})`;
				});
				ee`<div class="dm-journey__timeline-card-row">
					<span class="dm-journey__label">Risk Rolls:</span>
					<span>${rollParts.join(" \u00b7 ")}</span>
				</div>`.appendTo(card);
			}

			/* Supplies */
			const supParts = [];
			if (day.suppliesConsumed) {
				for (const [name, amount] of Object.entries(day.suppliesConsumed)) {
					if (amount) supParts.push(`\u2212${amount} ${name.toLowerCase()}`);
				}
			}
			if (day.suppliesGained) {
				for (const [name, amount] of Object.entries(day.suppliesGained)) {
					if (amount) supParts.push(`+${amount} ${name.toLowerCase()}`);
				}
			}
			if (supParts.length) {
				ee`<div class="dm-journey__timeline-card-row">
					<span class="dm-journey__label">Supplies:</span>
					<span>${supParts.join(", ")}</span>
				</div>`.appendTo(card);
			}

			/* Notes */
			const iptNotes = ee`<textarea class="ve-form-control ve-input-xs dm-journey__timeline-notes" placeholder="Notes for this day..." rows="2">${this._escHtml(day.notes || "")}</textarea>`;
			iptNotes.onn("change", () => {
				day.notes = iptNotes.val() || "";
				this._doSave();
			});
			ee`<div class="dm-journey__timeline-card-row">
				<span class="dm-journey__label">Notes:</span>
				${iptNotes}
			</div>`.appendTo(card);
		}

		return card;
	}

	_buildTimelineMarkdown () {
		const tl = this._state.timeline;
		const lines = [];
		if (tl.journeyName) lines.push(`# ${tl.journeyName}`);
		else lines.push("# Journey Timeline");
		if (tl.startDate) lines.push(`*Started: ${tl.startDate}*`);
		lines.push("");

		for (const day of tl.days) {
			const weatherPreset = this._getWeatherPreset(day.weather);
			lines.push(`## Day ${day.dayNumber} — ${weatherPreset.label} — ${day.pace} pace`);
			lines.push(`- RM: ${day.rmStart ?? 0} → ${day.rmEnd ?? 0}`);

			if (day.riskRollResults?.length) {
				const parts = day.riskRollResults.map(r => `${r.segment}: ${r.total ?? "—"} (${r.range || "—"})`);
				lines.push(`- Risk: ${parts.join(" · ")}`);
			}

			const supParts = [];
			if (day.suppliesConsumed) {
				for (const [name, amount] of Object.entries(day.suppliesConsumed)) {
					if (amount) supParts.push(`-${amount} ${name}`);
				}
			}
			if (day.suppliesGained) {
				for (const [name, amount] of Object.entries(day.suppliesGained)) {
					if (amount) supParts.push(`+${amount} ${name}`);
				}
			}
			if (supParts.length) lines.push(`- Supplies: ${supParts.join(", ")}`);
			if (day.notes) lines.push(`- Notes: ${day.notes}`);
			lines.push("");
		}

		return lines.join("\n");
	}

	/* -------------------------------------------- */
	/*  Log                                          */
	/* -------------------------------------------- */

	_addLog (type, message) {
		this._state.log.push({
			timestamp: new Date().toISOString(),
			type,
			message,
		});
		/* If log tab is visible, re-render it */
		if (this._state.tab === 3) this._renderLog();
	}

	/* -------------------------------------------- */
	/*  New Day                                      */
	/* -------------------------------------------- */

	_doNewDay () {
		const areaName = this._state.area.areaName || "Unknown Area";

		/* Auto-deplete supplies */
		if (this._state.supplies.autoDeplete) {
			const consumed = [];
			const warnings = [];
			const isExtremeHeat = this._state.weather.current === "extremeHeat";
			if (isExtremeHeat) this._addLog("weather", "\u26A0 Extreme Heat: water consumption doubled");
			for (const item of this._state.supplies.items) {
				if (item.dailyBurn > 0 && item.count > 0) {
					let burn = item.dailyBurn;
					/* Extreme Heat doubles water consumption */
					if (isExtremeHeat && item.name.toLowerCase() === "water") burn *= 2;
					burn = Math.min(item.count, burn);
					item.count = Math.max(0, item.count - burn);
					consumed.push(`${burn} ${item.name.toLowerCase()}`);
					if (item.count === 0) warnings.push(`\u26A0 Out of ${item.name}!`);
				}
			}
			if (consumed.length) this._addLog("supplies", `Supplies consumed: ${consumed.join(", ")}`);
			for (const w of warnings) this._addLog("supplies", w);
		}

		/* Snapshot current day for timeline */
		const dayNumber = this._state.timeline.currentDayIndex + 1;
		const riskRollResults = this._state.journey.segments.map((seg, i) => {
			const segName = this._state.area.segmentNames[i] || `Segment ${i + 1}`;
			const total = seg.riskRollTotal ?? seg.riskRoll;
			let range = null;
			if (total != null) {
				const ranges = this._state.area.riskRanges;
				if (total >= (ranges.intense?.min ?? 11)) range = "intense";
				else if (total >= (ranges.moderate?.min ?? 5)) range = "moderate";
				else if (total >= (ranges.mild?.min ?? 1)) range = "mild";
				else range = "empty";
			}
			return {segment: segName, total, range};
		});

		const suppliesConsumed = {};
		const suppliesGained = {};
		for (const item of this._state.supplies.items) {
			if (item.dailyBurn > 0) suppliesConsumed[item.name] = item.dailyBurn;
		}

		this._state.timeline.days.push({
			dayNumber,
			weather: this._state.weather.current,
			pace: this._state.travelPace,
			segments: this._state.area.numSegments,
			riskRollResults,
			rmStart: 0,
			rmEnd: this._state.riskModifier,
			suppliesConsumed,
			suppliesGained,
			notes: "",
		});
		this._state.timeline.currentDayIndex = dayNumber;

		this._state.riskModifier = 0;
		this._state.journey.segments = [];
		this._state.camp = this._makeEmptyCamp();
		this._ensureSegments();
		this._addLog("reset", `Day ${dayNumber} completed. Starting Day ${dayNumber + 1} in ${areaName}`);
		this._updateRmDisplay();
		this._renderJourney();
		this._renderCamp();
		this._renderLog();
		this._renderTimeline();
		this._doSave();
	}

	/* -------------------------------------------- */
	/*  Effective DC                                  */
	/* -------------------------------------------- */

	/**
	 * Computes the effective DC for a given activity, factoring in pace and interaction modifiers.
	 * @returns {{dc: number|null, impossible: boolean, notes: string[]}}
	 *   dc=null means no standard DC (e.g. Banter, Custom).
	 */
	_getEffectiveDc (activityId, activityList, activities, allPlayers, segmentIndex) {
		const actDef = activityList.find(a => a.id === activityId);
		const weatherKey = this._getWeatherForSegment(segmentIndex);
		return computeEffectiveDc({
			activityId,
			actDef,
			activities,
			allPlayers,
			pace: this._state.travelPace,
			baseDc: this._state.area.baseDc ?? 10,
			weatherKey,
			weatherPreset: this._getWeatherPreset(weatherKey),
			campfireActive: !!this._state.camp?.campfireActive,
			isCamp: activityList === CAMP_ACTIVITIES,
		});
	}

	/* -------------------------------------------- */
	/*  Helpers                                      */
	/* -------------------------------------------- */

	_ensureSegments () {
		const num = this._state.area.numSegments;
		while (this._state.journey.segments.length < num) {
			this._state.journey.segments.push(this._makeEmptySegment());
		}
		if (this._state.journey.segments.length > num) {
			/* Subtract the RM contributions of the segments about to be dropped BEFORE truncating —
			 * reconcile only sees surviving segments, so trimmed ones must be netted out here. */
			const removed = this._state.journey.segments.slice(num);
			let total = 0;
			for (const seg of removed) total += sumContainerRm(seg);
			this._state.journey.segments.length = num;
			if (total) this._setRm(this._state.riskModifier - total, "Segments trimmed");
			/* Re-sync bookkeeping baselines for the survivors (no RM change expected). */
			this._reconcileRm({rebaseline: true});
		}
	}

	/** Get the weather key for a given segment (or the global weather). */
	_getWeatherForSegment (segmentIndex) {
		const w = this._state.weather;
		if (w.perSegment && segmentIndex != null && w.segmentWeather[segmentIndex]) {
			return w.segmentWeather[segmentIndex];
		}
		return w.current || "clear";
	}

	_makeEmptySegment () {
		return {
			activities: {},
			activityGroupRm: {},
			stealthSlots: [],
			stealthGroupRm: 0,
			riskRoll: null,
			riskRollTotal: null,
			riskRollOverride: null,
			rmAtRoll: 0,
			encounterResolved: false,
			_collapsed: false,
		};
	}

	_reRenderCurrentTab () {
		switch (this._state.tab) {
			case 0: this._renderJourney(); break;
			case 1: this._renderCamp(); break;
			case 2: this._renderArea(); break;
			case 3: this._renderLog(); break;
			case 4: this._renderTimeline(); break;
		}
	}

	_doSave () {
		this._board.doSaveStateDebounced();
	}

	_fmtBonus (n) {
		if (n == null) return "";
		return n >= 0 ? `+${n}` : `${n}`;
	}

	/** Human-friendly skill name (e.g. "sleightOfHand" → "Sleight of Hand"). */
	_fmtSkillName (skill) {
		if (!skill) return "\u2014";
		const spaced = `${skill}`.replace(/([a-z])([A-Z])/g, "$1 $2");
		return spaced.charAt(0).toUpperCase() + spaced.slice(1);
	}

	_fmtTimestamp (isoStr) {
		try {
			const d = new Date(isoStr);
			const now = new Date();
			const diffMs = now - d;
			const diffMin = Math.floor(diffMs / 60000);
			if (diffMin < 1) return "just now";
			if (diffMin < 60) return `${diffMin}m ago`;
			const diffHr = Math.floor(diffMin / 60);
			if (diffHr < 24) return `${diffHr}h ago`;
			return d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
		} catch {
			return isoStr;
		}
	}

	/**
	 * Migrate activities from old single-object format to array format.
	 * Old: activities[playerId] = {activity, rollResult, ...}
	 * New: activities[playerId] = [{activity, rollResult, ...}, ...]
	 */
	static _migrateActivities (activities) {
		if (!activities) return {};
		const out = {};
		for (const [id, val] of Object.entries(activities)) {
			out[id] = Array.isArray(val) ? val.map(s => ({...s})) : [{...val}];
		}
		return out;
	}

	/** Deep-clone activities map (array format). */
	static _cloneActivities (activities) {
		if (!activities) return {};
		const out = {};
		for (const [id, val] of Object.entries(activities)) {
			out[id] = (Array.isArray(val) ? val : [val]).map(s => ({...s}));
		}
		return out;
	}

	static _getSkillBonusFromData (charData, skill) {
		return getSkillBonusFromData(charData, skill);
	}

	static _getToolProfBonusFromData (charData, activityId) {
		return getToolProfBonusFromData(charData, activityId);
	}

	/**
	 * Returns the effective bonus for a character performing a given activity, auto-selecting the
	 * character's best allowed skill (or `skillChoice`, when the DM has overridden it), and folding in
	 * a relevant tool proficiency. Delegates to the pure `computeActivityBonus`.
	 * @param {object} charData Party-tracker character data.
	 * @param {object} actDef Activity definition (must include `id` + `skill`/`skills`).
	 * @param {string|null} skillChoice Optional forced skill.
	 * @returns {{total:number, skillBonus:number, toolBonus:number, hasToolProf:boolean, skill:string|null}}
	 */
	static _getActivityBonusFromData (charData, actDef, skillChoice = null) {
		return computeActivityBonus(charData, actDef, {skillChoice});
	}

	_escHtml (str) {
		if (str == null) return "";
		return `${str}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	_escAttr (str) {
		return this._escHtml(str);
	}

	/* -------------------------------------------- */
	/*  State Persistence                            */
	/* -------------------------------------------- */

	setStateFrom (toLoad) {
		if (!toLoad || !Object.keys(toLoad).length) {
			this._state = DEFAULT_STATE();
			return;
		}

		this._state = {
			tab: toLoad.tab ?? 0,
			riskModifier: toLoad.riskModifier ?? 0,
			travelPace: toLoad.travelPace || "normal",
			rollMode: toLoad.rollMode || "raw",
			players: (toLoad.players || []).map(p => ({
				id: p.id || CryptUtil.uid(),
				name: p.name || "",
				isFromPartyTracker: !!p.isFromPartyTracker,
			})),
			area: {
				areaName: toLoad.area?.areaName || "",
				baseDc: toLoad.area?.baseDc ?? 10,
				numSegments: toLoad.area?.numSegments ?? 3,
				segmentNames: toLoad.area?.segmentNames?.slice() || ["Morning", "Midday", "Afternoon"],
				riskRanges: {
					mild: {...(toLoad.area?.riskRanges?.mild || {min: 1, max: 4})},
					moderate: {...(toLoad.area?.riskRanges?.moderate || {min: 5, max: 10})},
					intense: {...(toLoad.area?.riskRanges?.intense || {min: 11, max: 12})},
				},
				weatherTable: (toLoad.area?.weatherTable || DEFAULT_WEATHER_TABLE()).map(e => ({...e})),
			},
			journey: {
				segments: (toLoad.journey?.segments || []).map(seg => ({
					activities: JourneyTrackerRoot._migrateActivities(seg.activities),
					activityGroupRm: {...(seg.activityGroupRm || {})},
					stealthSlots: (seg.stealthSlots || []).map(s => ({...s})),
					stealthGroupRm: seg.stealthGroupRm ?? 0,
					riskRoll: seg.riskRoll ?? null,
					riskRollTotal: seg.riskRollTotal ?? null,
					riskRollOverride: seg.riskRollOverride ?? null,
					rmAtRoll: seg.rmAtRoll ?? 0,
					encounterResolved: seg.encounterResolved ?? false,
					_collapsed: seg._collapsed || false,
				})),
			},
			camp: {
				campfireActive: toLoad.camp?.campfireActive || false,
				siteDescription: toLoad.camp?.siteDescription || "",
				activities: JourneyTrackerRoot._migrateActivities(toLoad.camp?.activities),
				activityGroupRm: {...(toLoad.camp?.activityGroupRm || {})},
				guardSlots: (toLoad.camp?.guardSlots || []).map(s => ({...s})),
				riskRoll: toLoad.camp?.riskRoll ?? null,
				riskRollTotal: toLoad.camp?.riskRollTotal ?? null,
				riskRollOverride: toLoad.camp?.riskRollOverride ?? null,
				rmAtRoll: toLoad.camp?.rmAtRoll ?? 0,
				encounterResolved: toLoad.camp?.encounterResolved ?? false,
			},
			log: (toLoad.log || []).map(e => ({...e})),
			weather: {
				current: toLoad.weather?.current || "clear",
				perSegment: !!toLoad.weather?.perSegment,
				segmentWeather: (toLoad.weather?.segmentWeather || []).slice(),
				customTypes: (toLoad.weather?.customTypes || []).map(ct => ({
					key: ct.key || `custom_${CryptUtil.uid()}`,
					label: ct.label || "Custom",
					icon: ct.icon || "\u2753",
					dcMod: ct.dcMod ?? 0,
					rmMod: ct.rmMod ?? 0,
					paceRestrict: ct.paceRestrict || null,
					effects: (ct.effects || []).slice(),
				})),
			},
			supplies: {
				items: (toLoad.supplies?.items || DEFAULT_SUPPLIES()).map(item => ({
					id: item.id || CryptUtil.uid(),
					name: item.name || "",
					count: item.count ?? 0,
					dailyBurn: item.dailyBurn ?? 0,
					unit: item.unit || "",
					isDefault: !!item.isDefault,
				})),
				autoDeplete: toLoad.supplies?.autoDeplete ?? true,
			},
			timeline: {
				days: (toLoad.timeline?.days || []).map(d => ({...d})),
				currentDayIndex: toLoad.timeline?.currentDayIndex ?? 0,
				journeyName: toLoad.timeline?.journeyName || "",
				startDate: toLoad.timeline?.startDate || "",
			},
		};

		this._migrateRmBookkeeping();
	}

	getSaveableState () {
		return {
			tab: this._state.tab,
			riskModifier: this._state.riskModifier,
			travelPace: this._state.travelPace,
			rollMode: this._state.rollMode,
			players: this._state.players.map(p => ({...p})),
			area: {
				areaName: this._state.area.areaName,
				baseDc: this._state.area.baseDc ?? 10,
				numSegments: this._state.area.numSegments,
				segmentNames: [...this._state.area.segmentNames],
				riskRanges: {
					mild: {...this._state.area.riskRanges.mild},
					moderate: {...this._state.area.riskRanges.moderate},
					intense: {...this._state.area.riskRanges.intense},
				},
				weatherTable: (this._state.area.weatherTable || []).map(e => ({...e})),
			},
			journey: {
				segments: this._state.journey.segments.map(seg => ({
					activities: JourneyTrackerRoot._cloneActivities(seg.activities),
					activityGroupRm: {...(seg.activityGroupRm || {})},
					stealthSlots: (seg.stealthSlots || []).map(s => ({...s})),
					stealthGroupRm: seg.stealthGroupRm ?? 0,
					riskRoll: seg.riskRoll,
					riskRollTotal: seg.riskRollTotal,
					riskRollOverride: seg.riskRollOverride,
					rmAtRoll: seg.rmAtRoll,
					encounterResolved: seg.encounterResolved ?? false,
					_collapsed: seg._collapsed || false,
				})),
			},
			camp: {
				campfireActive: this._state.camp.campfireActive,
				siteDescription: this._state.camp.siteDescription || "",
				activities: JourneyTrackerRoot._cloneActivities(this._state.camp.activities),
				activityGroupRm: {...(this._state.camp.activityGroupRm || {})},
				guardSlots: this._state.camp.guardSlots.map(s => ({...s})),
				riskRoll: this._state.camp.riskRoll,
				riskRollTotal: this._state.camp.riskRollTotal,
				riskRollOverride: this._state.camp.riskRollOverride,
				rmAtRoll: this._state.camp.rmAtRoll,
				encounterResolved: this._state.camp.encounterResolved ?? false,
			},
			log: this._state.log.map(e => ({...e})),
			weather: {
				current: this._state.weather.current,
				perSegment: this._state.weather.perSegment,
				segmentWeather: [...this._state.weather.segmentWeather],
				customTypes: (this._state.weather.customTypes || []).map(ct => ({...ct, effects: [...(ct.effects || [])]})),
			},
			supplies: {
				items: this._state.supplies.items.map(item => ({...item})),
				autoDeplete: this._state.supplies.autoDeplete,
			},
			timeline: {
				days: this._state.timeline.days.map(d => ({...d})),
				currentDayIndex: this._state.timeline.currentDayIndex,
				journeyName: this._state.timeline.journeyName,
				startDate: this._state.timeline.startDate,
			},
		};
	}

	/* -------------------------------------------- */
	/*  Public accessors                             */
	/* -------------------------------------------- */

	getCharacters () {
		return this._state.players;
	}
}
