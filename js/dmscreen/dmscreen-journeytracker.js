import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";
import {DmScreenUtil} from "./dmscreen-util.js";

/* ============================================================================================== */
/*  Constants                                                                                      */
/* ============================================================================================== */

const JOURNEY_ACTIVITIES = [
	{id: "navigate", label: "Navigate", skill: "survival", rmOnSuccess: 0, rmAlways: 0},
	{id: "scout", label: "Scout", skill: "perception", rmOnSuccess: -1, rmAlways: 0},
	{id: "map", label: "Map", skill: "investigation", rmOnSuccess: 0, rmAlways: 0},
	{id: "forage", label: "Forage", skill: "survival", rmOnSuccess: 0, rmAlways: 0},
	{id: "hideTracks", label: "Hide Tracks", skill: "stealth", rmOnSuccess: -1, rmAlways: 0},
	{id: "entertain", label: "Entertain", skill: "performance", rmOnSuccess: 0, rmAlways: 1},
	{id: "banter", label: "Banter", skill: null, rmOnSuccess: 0, rmAlways: 0},
	{id: "stealth", label: "Stealth", skill: "stealth", rmOnSuccess: -1, rmAlways: 0},
	{id: "track", label: "Track", skill: "survival", rmOnSuccess: 0, rmAlways: 0},
	{id: "custom", label: "Custom\u2026", skill: null, rmOnSuccess: 0, rmAlways: 0},
];

const CAMP_ACTIVITIES = [
	{id: "campfire", label: "Campfire", skill: "survival", rmOnSuccess: 0, rmAlways: 0},
	{id: "forage", label: "Forage", skill: "survival", rmOnSuccess: 0, rmAlways: 1},
	{id: "cook", label: "Cook", skill: null, rmOnSuccess: 0, rmAlways: 0},
	{id: "pray", label: "Pray", skill: "religion", rmOnSuccess: 0, rmAlways: 0},
	{id: "tend", label: "Tend", skill: "medicine", rmOnSuccess: 0, rmAlways: 0},
	{id: "entertain", label: "Entertain", skill: "performance", rmOnSuccess: 0, rmAlways: 1},
	{id: "scout", label: "Scout", skill: "perception", rmOnSuccess: -1, rmAlways: 0},
	{id: "research", label: "Research", skill: null, rmOnSuccess: 0, rmAlways: 0},
	{id: "hideCamp", label: "Hide Camp", skill: "stealth", rmOnSuccess: -1, rmAlways: 0},
	{id: "banter", label: "Banter", skill: null, rmOnSuccess: 0, rmAlways: 0},
	{id: "guard", label: "Guard", skill: "perception", rmOnSuccess: 0, rmAlways: 0},
	{id: "custom", label: "Custom\u2026", skill: null, rmOnSuccess: 0, rmAlways: 0},
];

const PACE_OPTIONS = [
	{id: "slow", label: "Slow", tips: "2/3 speed · Nav DC \u22122 · Stealth possible · +5 Passive Perception"},
	{id: "normal", label: "Normal", tips: "Standard speed · Area Nav DC · No stealth"},
	{id: "fast", label: "Fast", tips: "1.3\u00d7 speed · Nav DC +2 · No stealth · Disadv. Scout · No Map/Forage"},
];

const RANGE_COLORS = {
	empty: {cls: "dm-journey__badge--empty", label: "Empty"},
	mild: {cls: "dm-journey__badge--mild", label: "Mild"},
	moderate: {cls: "dm-journey__badge--moderate", label: "Moderate"},
	intense: {cls: "dm-journey__badge--intense", label: "Intense"},
};

const DEFAULT_AREA = () => ({
	areaName: "",
	numSegments: 3,
	segmentNames: ["Morning", "Midday", "Afternoon"],
	riskRanges: {
		mild: {min: 1, max: 4},
		moderate: {min: 5, max: 10},
		intense: {min: 11, max: 12},
	},
});

const SKILL_TO_ABILITY = {
	athletics: "str", acrobatics: "dex", sleightOfHand: "dex", stealth: "dex",
	arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
	animalHandling: "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
	deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
};

const DEFAULT_STATE = () => ({
	tab: 0,
	riskModifier: 0,
	travelPace: "normal",
	players: [],
	area: DEFAULT_AREA(),
	journey: {segments: []},
	camp: {
		campfireActive: false,
		hideCampAttempted: false,
		activities: {},
		guardSlots: [],
		riskRoll: null,
		riskRollTotal: null,
		riskRollOverride: null,
		rmAtRoll: 0,
	},
	log: [],
});

/* ============================================================================================== */
/*  Activity interaction analysis                                                                  */
/* ============================================================================================== */

function _getActivityInteractions (activities, allPlayers, activityList, pace) {
	const notes = [];
	const chosen = {};
	for (const p of allPlayers) {
		const act = activities[p.id];
		if (!act?.activity) continue;
		if (!chosen[act.activity]) chosen[act.activity] = [];
		chosen[act.activity].push(p.name);
	}

	const scoutCount = (chosen.scout || []).length;
	const forageCount = (chosen.forage || []).length;
	const entertainCount = (chosen.entertain || []).length;

	/* Hide Tracks / Hide Camp DC modifiers from loud activities */
	if (chosen.hideTracks?.length || chosen.hideCamp?.length) {
		const key = chosen.hideTracks?.length ? "hideTracks" : "hideCamp";
		const label = key === "hideTracks" ? "Hide Tracks" : "Hide Camp";
		const dcParts = [];
		if (scoutCount) dcParts.push(`+${scoutCount * 2} (${scoutCount} Scout)`);
		if (forageCount) dcParts.push(`+${forageCount * 2} (${forageCount} Forage)`);
		if (entertainCount) dcParts.push(`+${entertainCount * 2} (${entertainCount} Entertain)`);
		if (pace === "fast") dcParts.push("+2 (Fast Pace)");
		if (pace === "slow") dcParts.push("\u22122 (Slow Pace)");
		if (dcParts.length) notes.push(`${label} DC: ${dcParts.join(", ")}`);
	}

	/* Scout at fast pace — disadvantage */
	if (chosen.scout?.length && pace === "fast") {
		notes.push("Scout: Disadvantage (Fast Pace)");
	}

	/* Entertain always adds RM */
	if (chosen.entertain?.length) {
		notes.push(`Entertain: always +${chosen.entertain.length} RM (noise)`);
	}

	/* Camp Forage always adds RM */
	if (chosen.forage?.length && activityList === CAMP_ACTIVITIES) {
		notes.push(`Forage (Camp): +${chosen.forage.length} RM (leaving camp)`);
	}

	/* Fast pace restrictions */
	if (pace === "fast") {
		if (chosen.map?.length) notes.push("Map: NOT possible at Fast Pace!");
		if (chosen.forage?.length && activityList === JOURNEY_ACTIVITIES) notes.push("Forage: NOT possible at Fast Pace!");
	}

	/* Stealth only at slow */
	if (chosen.stealth?.length && pace !== "slow") {
		notes.push("Stealth: only possible at Slow Pace!");
	}

	/* Navigate DC from pace */
	if (chosen.navigate?.length) {
		if (pace === "fast") notes.push("Navigate: DC +2 (Fast Pace)");
		if (pace === "slow") notes.push("Navigate: DC \u22122 (Slow Pace)");
	}

	return notes;
}

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

class JourneyTrackerRoot {
	constructor (board, wrpPanel) {
		this._board = board;
		this._wrpPanel = wrpPanel;

		this._state = DEFAULT_STATE();

		/* Cached DOM references */
		this._eleRmValue = null;
		this._eleRmBadge = null;
		this._eleSyncStatus = null;
		this._wrpTabs = null;
		this._wrpJourney = null;
		this._wrpCamp = null;
		this._wrpArea = null;
		this._wrpLog = null;
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

		this._renderJourney();
		this._renderCamp();
		this._renderArea();
		this._renderLog();
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
		});

		this._eleRmBadge = ee`<span class="dm-journey__rm-badge" aria-live="polite"></span>`;
		this._updateRmBadge();

		const btnMinus = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__rm-btn" title="−1 Risk" aria-label="Decrease Risk Modifier">\u2212</button>`
			.onn("click", () => this._setRm(this._state.riskModifier - 1, "Manual −1"));

		const btnPlus = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__rm-btn" title="+1 Risk" aria-label="Increase Risk Modifier">+</button>`
			.onn("click", () => this._setRm(this._state.riskModifier + 1, "Manual +1"));

		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Reset RM to 0" aria-label="Reset Risk Modifier">Reset</button>`
			.onn("click", () => this._setRm(0, "Reset"));

		/* Pace */
		const elePace = this._renderPaceSelector();

		/* Party sync status */
		this._eleSyncStatus = ee`<span class="dm-journey__sync-status"></span>`;
		this._updateSyncStatus();

		const btnAddPlayer = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Add a player manually" aria-label="Add Player"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Player</button>`
			.onn("click", () => this._addManualPlayer());

		return ee`<div class="dm-journey__header">
			<div class="dm-journey__rm-section">
				<span class="dm-journey__rm-label">RM</span>
				${this._eleRmBadge}
				${btnMinus}
				${this._eleRmValue}
				${btnPlus}
				${btnReset}
			</div>
			${elePace}
			<div class="dm-journey__sync-section">
				${this._eleSyncStatus}
				${btnAddPlayer}
			</div>
		</div>`;
	}

	_renderPaceSelector () {
		const wrp = ee`<div class="dm-journey__pace-section"></div>`;
		for (const pace of PACE_OPTIONS) {
			const radio = ee`<input type="radio" name="dm-journey-pace" value="${pace.id}" ${this._state.travelPace === pace.id ? "checked" : ""}>`;
			radio.onn("change", () => {
				this._state.travelPace = pace.id;
				this._reRenderCurrentTab();
				this._doSave();
			});
			ee`<label class="dm-journey__pace-label" title="${pace.tips}">
				${radio}
				<span>${pace.label}</span>
			</label>`.appendTo(wrp);
		}
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
		const tabMap = [this._wrpJourney, this._wrpCamp, this._wrpArea, this._wrpLog];
		tabMap.forEach((wrp, ix) => {
			if (wrp) wrp.style.display = ix === this._state.tab ? "" : "none";
		});
	}

	/* -------------------------------------------- */
	/*  Journey Tab                                  */
	/* -------------------------------------------- */

	_renderJourney () {
		if (!this._wrpJourney) return;
		this._wrpJourney.innerHTML = "";

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

		const card = ee`<div class="dm-journey__segment-card"></div>`;

		/* Header */
		const btnToggle = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-journey__collapse-btn" aria-label="Toggle segment">${isCollapsed ? "\u25B6" : "\u25BC"}</button>`;
		btnToggle.onn("click", () => {
			seg._collapsed = !seg._collapsed;
			this._renderJourney();
			this._doSave();
		});

		const riskBadge = this._renderRiskBadge(seg);

		const btnRoll = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Roll d12 + RM">Roll Risk</button>`;
		btnRoll.onn("click", () => {
			const result = this._doRiskRoll();
			seg.riskRoll = result.die;
			seg.riskRollTotal = result.total;
			seg.riskRollOverride = null;
			seg.rmAtRoll = this._state.riskModifier;
			this._renderJourney();
			this._doSave();
		});

		const iptOverride = ee`<input type="number" class="dm-journey__override-input" placeholder="Override" title="Override total result" value="${seg.riskRollOverride ?? ""}">`;
		iptOverride.onn("change", () => {
			const v = iptOverride.val()?.trim();
			seg.riskRollOverride = v === "" ? null : parseInt(v, 10);
			this._renderJourney();
			this._doSave();
		});

		const eleHeader = ee`<div class="dm-journey__segment-header">
			${btnToggle}
			<span class="dm-journey__segment-name">${name}</span>
			<div class="ve-flex-v-center ve-gap-1 ve-ml-auto">
				${riskBadge}
				${btnRoll}
				${iptOverride}
			</div>
		</div>`;

		card.appendChild(eleHeader);

		/* Body (collapsible) */
		if (!isCollapsed) {
			const body = this._renderActivityTable(seg.activities, JOURNEY_ACTIVITIES);
			card.appendChild(body);
		}

		return card;
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
			this._renderCamp();
			this._doSave();
		});

		const eleCampfire = ee`<label class="dm-journey__campfire-toggle">
			${cbxCampfire}
			<span>Campfire Active</span>
			<span class="dm-journey__note">(+1 RM while active)</span>
		</label>`;

		/* Hide Camp */
		const btnHideCamp = ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${camp.hideCampAttempted ? "disabled" : ""}>
			${camp.hideCampAttempted ? "Hide Camp (attempted)" : "Attempt Hide Camp"}
		</button>`;
		btnHideCamp.onn("click", () => {
			if (camp.hideCampAttempted) return;
			camp.hideCampAttempted = true;
			this._renderCamp();
			this._doSave();
		});

		/* Risk Roll section */
		const riskBadge = this._renderRiskBadge(camp);

		const btnRoll = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Roll d12 + RM for camp">Roll Risk</button>`;
		btnRoll.onn("click", () => {
			const result = this._doRiskRoll();
			camp.riskRoll = result.die;
			camp.riskRollTotal = result.total;
			camp.riskRollOverride = null;
			camp.rmAtRoll = this._state.riskModifier;
			this._renderCamp();
			this._doSave();
		});

		const iptOverride = ee`<input type="number" class="dm-journey__override-input" placeholder="Override" title="Override total result" value="${camp.riskRollOverride ?? ""}">`;
		iptOverride.onn("change", () => {
			const v = iptOverride.val()?.trim();
			camp.riskRollOverride = v === "" ? null : parseInt(v, 10);
			this._renderCamp();
			this._doSave();
		});

		const eleRiskRow = ee`<div class="dm-journey__risk-row">
			<span class="ve-bold">Camp Risk Roll:</span>
			${riskBadge}
			${btnRoll}
			${iptOverride}
		</div>`;

		/* Activity table */
		const body = this._renderActivityTable(camp.activities, CAMP_ACTIVITIES);

		/* Guard slots */
		const eleGuard = this._renderGuardSlots();

		this._wrpCamp.appendChild(eleCampfire);
		this._wrpCamp.appendChild(btnHideCamp);
		ee`<hr class="ve-hr-1">`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(body);
		ee`<hr class="ve-hr-1">`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(eleGuard);
		ee`<hr class="ve-hr-1">`.appendTo(this._wrpCamp);
		this._wrpCamp.appendChild(eleRiskRow);
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

	_renderActivityTable (activities, activityList) {
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
			<span>Mod</span>
			<span>Roll</span>
			<span>RM</span>
		</div>`.appendTo(wrp);

		for (const player of players) {
			if (!activities[player.id]) activities[player.id] = {activity: "", rollResult: "", customName: ""};
			const act = activities[player.id];
			const ptChar = ptChars.find(c => c.id === player.id);

			const row = this._renderActivityRow(player, act, ptChar, activityList);
			wrp.appendChild(row);
		}

		/* Activity interaction notes */
		const notes = _getActivityInteractions(activities, players, activityList, this._state.travelPace);
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

	_renderActivityRow (player, act, ptChar, activityList) {
		/* Activity dropdown — build options as HTML string */
		const optionsHtml = activityList.map(a => `<option value="${a.id}" ${act.activity === a.id ? "selected" : ""}>${a.label}</option>`).join("");
		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__activity-sel" aria-label="Activity for ${this._escAttr(player.name)}"><option value="">\u2014 None \u2014</option>${optionsHtml}</select>`;
		sel.onn("change", () => {
			act.activity = sel.val();
			this._reRenderCurrentTab();
			this._doSave();
		});

		/* Custom name input (only when custom is selected) */
		const isCustom = act.activity === "custom";
		const iptCustom = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__custom-input" placeholder="Custom activity" value="${this._escAttr(act.customName || "")}">`;
		iptCustom.toggleVe(isCustom);
		iptCustom.onn("change", () => {
			act.customName = iptCustom.val();
			this._doSave();
		});

		/* Skill modifier + RM effect indicator */
		const actDef = activityList.find(a => a.id === act.activity);
		let bonusStr = "";
		if (ptChar && actDef?.skill) {
			bonusStr = this._fmtBonus(JourneyTrackerRoot._getSkillBonusFromData(ptChar, actDef.skill));
		}

		let rmHint = "";
		if (actDef) {
			if (actDef.rmAlways > 0) rmHint = `(auto +${actDef.rmAlways})`;
			else if (actDef.rmOnSuccess < 0) rmHint = "(\u22121 on success)";
		}

		/* Roll result */
		const iptResult = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__roll-input" placeholder="Roll" value="${this._escAttr(act.rollResult || "")}" aria-label="Roll result for ${this._escAttr(player.name)}">`;
		iptResult.onn("change", () => {
			act.rollResult = iptResult.val();
			this._doSave();
		});

		/* Quick RM adjust buttons */
		const wrpRm = ee`<span class="dm-journey__quick-rm"></span>`;
		if (actDef && act.activity) {
			const btnMinus = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="\u22121 RM">\u22121</button>`;
			btnMinus.onn("click", () => this._setRm(this._state.riskModifier - 1, `${actDef.label} (${player.name}): \u22121`));
			const btnPlus = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="+1 RM">+1</button>`;
			btnPlus.onn("click", () => this._setRm(this._state.riskModifier + 1, `${actDef.label} (${player.name}): +1`));
			wrpRm.appendChild(btnMinus);
			wrpRm.appendChild(btnPlus);
		}

		/* Player name cell + remove button for manual players */
		const eleNameCell = ee`<span class="dm-journey__player-name" title="${this._escAttr(player.name)}">${this._escHtml(player.name || "Unnamed")}</span>`;
		if (!player.isFromPartyTracker) {
			const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs dm-journey__remove-player" title="Remove ${this._escAttr(player.name)}" aria-label="Remove ${this._escAttr(player.name)}">\u00d7</button>`;
			btnRemove.onn("click", () => {
				this._state.players = this._state.players.filter(p => p.id !== player.id);
				this._addLog("party-sync", `Removed player: ${player.name}`);
				this._updateSyncStatus();
				this._reRenderCurrentTab();
				this._doSave();
			});
			eleNameCell.appendChild(btnRemove);
		}

		/* Skill + RM hint cell */
		const eleSkillCell = ee`<span class="dm-journey__skill-bonus" title="Skill modifier">${bonusStr}</span>`;
		if (rmHint) {
			ee`<span class="dm-journey__rm-hint">${rmHint}</span>`.appendTo(eleSkillCell);
		}

		return ee`<div class="dm-journey__activity-row">
			${eleNameCell}
			<div class="ve-flex-v-center ve-gap-1">${sel}${iptCustom}</div>
			${eleSkillCell}
			${iptResult}
			${wrpRm}
		</div>`;
	}

	/* -------------------------------------------- */
	/*  Area Config Tab                              */
	/* -------------------------------------------- */

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

		const btnNewDay = ee`<button class="ve-btn ve-btn-warning ve-btn-sm">New Day</button>`;
		btnNewDay.onn("click", () => {
			if (!confirm("Start a new day? This resets RM, clears all activities, and logs the event.")) return;
			this._doNewDay();
		});

		ee`<div class="ve-flex-col ve-gap-2 ve-p-2">
			<div>
				<label class="ve-bold">Area Name</label>
				${iptName}
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
				${btnNewDay}
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
		const ranges = this._state.area.riskRanges;
		if (total >= ranges.intense.min && total <= ranges.intense.max) return "intense";
		if (total >= ranges.moderate.min && total <= ranges.moderate.max) return "moderate";
		if (total >= ranges.mild.min && total <= ranges.mild.max) return "mild";
		return "empty";
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
		if (rm <= 0) this._eleRmBadge.classList.add("dm-journey__rm-badge--low");
		else if (rm <= 2) this._eleRmBadge.classList.add("dm-journey__rm-badge--mid");
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

		/* Remove departed PT characters */
		const removed = [];
		this._state.players = this._state.players.filter(p => {
			if (!p.isFromPartyTracker) return true;
			if (ptIds.has(p.id)) return true;
			removed.push(p.name);
			return false;
		});

		/* Log sync */
		const parts = [];
		if (added.length) parts.push(`added ${added.join(", ")}`);
		if (removed.length) parts.push(`removed ${removed.join(", ")}`);
		if (parts.length) {
			this._addLog("party-sync", `Party synced: ${parts.join("; ")}`);
		}

		this._updateSyncStatus();
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
		this._state.riskModifier = 0;
		this._state.journey.segments = [];
		this._state.camp = {
			campfireActive: false,
			hideCampAttempted: false,
			activities: {},
			guardSlots: [],
			riskRoll: null,
			riskRollTotal: null,
			riskRollOverride: null,
			rmAtRoll: 0,
		};
		this._ensureSegments();
		this._addLog("reset", `New day started in ${areaName}`);
		this._updateRmDisplay();
		this._renderJourney();
		this._renderCamp();
		this._renderLog();
		this._doSave();
	}

	/* -------------------------------------------- */
	/*  Helpers                                      */
	/* -------------------------------------------- */

	_ensureSegments () {
		const num = this._state.area.numSegments;
		while (this._state.journey.segments.length < num) {
			this._state.journey.segments.push(this._makeEmptySegment());
		}
		this._state.journey.segments.length = num;
	}

	_makeEmptySegment () {
		return {
			activities: {},
			riskRoll: null,
			riskRollTotal: null,
			riskRollOverride: null,
			rmAtRoll: 0,
			_collapsed: false,
		};
	}

	_reRenderCurrentTab () {
		switch (this._state.tab) {
			case 0: this._renderJourney(); break;
			case 1: this._renderCamp(); break;
			case 2: this._renderArea(); break;
			case 3: this._renderLog(); break;
		}
	}

	_doSave () {
		this._board.doSaveStateDebounced();
	}

	_fmtBonus (n) {
		if (n == null) return "";
		return n >= 0 ? `+${n}` : `${n}`;
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

	static _getSkillBonusFromData (charData, skill) {
		if (charData.overrides?.skillBonuses?.[skill] != null) return charData.overrides.skillBonuses[skill];
		const ability = SKILL_TO_ABILITY[skill];
		if (!ability) return 0;
		const score = charData.abilities?.[ability] ?? 10;
		const mod = Math.floor((score - 10) / 2);
		const totalLevel = charData.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
		const profBonus = Math.floor((totalLevel - 1) / 4) + 2;
		const profLevel = charData.skillProficiencies?.[skill] || 0;
		let bonus = mod + (profLevel * profBonus);
		bonus += charData.bonuses?.skills?.[skill] || 0;
		return bonus;
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
			players: (toLoad.players || []).map(p => ({
				id: p.id || CryptUtil.uid(),
				name: p.name || "",
				isFromPartyTracker: !!p.isFromPartyTracker,
			})),
			area: {
				areaName: toLoad.area?.areaName || "",
				numSegments: toLoad.area?.numSegments ?? 3,
				segmentNames: toLoad.area?.segmentNames?.slice() || ["Morning", "Midday", "Afternoon"],
				riskRanges: {
					mild: {...(toLoad.area?.riskRanges?.mild || {min: 1, max: 4})},
					moderate: {...(toLoad.area?.riskRanges?.moderate || {min: 5, max: 10})},
					intense: {...(toLoad.area?.riskRanges?.intense || {min: 11, max: 12})},
				},
			},
			journey: {
				segments: (toLoad.journey?.segments || []).map(seg => ({
					activities: {...(seg.activities || {})},
					riskRoll: seg.riskRoll ?? null,
					riskRollTotal: seg.riskRollTotal ?? null,
					riskRollOverride: seg.riskRollOverride ?? null,
					rmAtRoll: seg.rmAtRoll ?? 0,
					_collapsed: seg._collapsed || false,
				})),
			},
			camp: {
				campfireActive: toLoad.camp?.campfireActive || false,
				hideCampAttempted: toLoad.camp?.hideCampAttempted || false,
				activities: {...(toLoad.camp?.activities || {})},
				guardSlots: (toLoad.camp?.guardSlots || []).map(s => ({...s})),
				riskRoll: toLoad.camp?.riskRoll ?? null,
				riskRollTotal: toLoad.camp?.riskRollTotal ?? null,
				riskRollOverride: toLoad.camp?.riskRollOverride ?? null,
				rmAtRoll: toLoad.camp?.rmAtRoll ?? 0,
			},
			log: (toLoad.log || []).map(e => ({...e})),
		};
	}

	getSaveableState () {
		return {
			tab: this._state.tab,
			riskModifier: this._state.riskModifier,
			travelPace: this._state.travelPace,
			players: this._state.players.map(p => ({...p})),
			area: {
				areaName: this._state.area.areaName,
				numSegments: this._state.area.numSegments,
				segmentNames: [...this._state.area.segmentNames],
				riskRanges: {
					mild: {...this._state.area.riskRanges.mild},
					moderate: {...this._state.area.riskRanges.moderate},
					intense: {...this._state.area.riskRanges.intense},
				},
			},
			journey: {
				segments: this._state.journey.segments.map(seg => ({
					activities: {...seg.activities},
					riskRoll: seg.riskRoll,
					riskRollTotal: seg.riskRollTotal,
					riskRollOverride: seg.riskRollOverride,
					rmAtRoll: seg.rmAtRoll,
					_collapsed: seg._collapsed || false,
				})),
			},
			camp: {
				campfireActive: this._state.camp.campfireActive,
				hideCampAttempted: this._state.camp.hideCampAttempted,
				activities: {...this._state.camp.activities},
				guardSlots: this._state.camp.guardSlots.map(s => ({...s})),
				riskRoll: this._state.camp.riskRoll,
				riskRollTotal: this._state.camp.riskRollTotal,
				riskRollOverride: this._state.camp.riskRollOverride,
				rmAtRoll: this._state.camp.rmAtRoll,
			},
			log: this._state.log.map(e => ({...e})),
		};
	}

	/* -------------------------------------------- */
	/*  Public accessors                             */
	/* -------------------------------------------- */

	getCharacters () {
		return this._state.players;
	}
}
