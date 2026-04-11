import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";
import {DmScreenUtil} from "./dmscreen-util.js";

/* ============================================================================================== */
/*  Constants                                                                                      */
/* ============================================================================================== */

const JOURNEY_ACTIVITIES = [
	{id: "navigate", label: "Navigate", skill: "survival", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Essential navigation activity for journeys without a clear path.",
		successText: "The party continues toward their destination, covering the expected distance.",
		critSuccessText: "Exceptional navigation — the party finds a shortcut or avoids a hazard.",
		failureText: "The party makes no progress or veers off course (adds 1d6 hours to travel time).",
		critFailText: "The party becomes badly lost, potentially entering dangerous territory.",
		restrictionText: "Fast Pace: DC +2. Slow Pace: DC −2."},
	{id: "scout", label: "Scout", skill: "perception", rmOnSuccess: -1, rmOnCritSuccess: -1, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 0, critSuccessPerPlayer: true,
		desc: "Look out for danger along the party's path.",
		successText: "−1 RM. You spot danger early and alert the party.",
		critSuccessText: "−1 RM for every party member taking this activity.",
		failureText: "No effect.",
		critFailText: "+1 RM. You miss something important.",
		restrictionText: "Fast Pace gives Disadvantage. +2 DC to Hide Tracks per scout."},
	{id: "map", label: "Map", skill: "investigation", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Document terrain, create maps, and refine understanding of the region.",
		successText: "The party gains Advantage on their next Navigation check in this area.",
		critSuccessText: "Advantage on all Navigation checks in this area for the rest of the Journey Phase.",
		failureText: "No effect.",
		critFailText: "Misrecorded details — next Navigation check in this area at Disadvantage.",
		restrictionText: "Not possible at Fast Pace."},
	{id: "forage", label: "Forage", skill: "survival", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 0,
		desc: "Gather edible plants, hunt small game, and locate water sources.",
		successText: "Find 1d4 rations (DM may adjust based on biome).",
		critSuccessText: "Find 1d4 + proficiency bonus rations, or locate a rare resource.",
		failureText: "No resources found.",
		critFailText: "+1 RM. You disturb the environment.",
		restrictionText: "Not possible at Fast Pace. +2 DC to Hide Tracks per forager."},
	{id: "hideTracks", label: "Hide Tracks", skill: "stealth", rmOnSuccess: -1, rmOnCritSuccess: -2, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 0,
		desc: "Cover footprints and obscure evidence of passage.",
		successText: "−1 RM.",
		critSuccessText: "−2 RM, and impose Disadvantage on any creature attempting to track the party for 24 hours.",
		failureText: "No effect.",
		critFailText: "+1 RM. You leave obvious clues.",
		restrictionText: "Fast Pace: DC +2. Slow Pace: DC −2. For each ally performing Scout, Forage, or Entertain: DC +2."},
	{id: "entertain", label: "Entertain", skill: "performance", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 2, rmAlways: 1,
		desc: "Tell stories, sing, play instruments, or boost morale. Noise draws attention.",
		successText: "Grant Heroic Inspiration to all allies.",
		critSuccessText: null,
		failureText: "No effect.",
		critFailText: "+2 RM. You make a racket.",
		restrictionText: "Always +1 RM (noise). May prevent stealth-based actions."},
	{id: "track", label: "Track", skill: "survival", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Follow tracks, signs, or magical traces. Replaces Navigation for the segment.",
		successText: "Successfully follow the trail.",
		critSuccessText: null,
		failureText: "Trail is lost; must retry or abandon pursuit.",
		critFailText: null,
		restrictionText: "Normal Pace: Disadvantage. Fast Pace: Not possible."},
	{id: "custom", label: "Custom\u2026", skill: null, rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "A custom activity — set your own name and rules.",
		successText: null, critSuccessText: null, failureText: null, critFailText: null, restrictionText: null},
];

const CAMP_ACTIVITIES = [
	{id: "campfire", label: "Campfire", skill: "survival", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 2, rmAlways: 0,
		desc: "Build and maintain a campfire for warmth, light, safety, and cooking.",
		successText: "A stable fire burns throughout the night, enabling Cook and other fire-dependent activities.",
		critSuccessText: "Exceptionally well-prepared — grants Advantage on Cook checks.",
		failureText: "The fire sputters out after 1 hour unless someone spends another hour fixing it.",
		critFailText: "+2 RM. Excessive smoke or flare; the fire fails.",
		restrictionText: "+1 RM while active (toggle separately). Required for activities needing light."},
	{id: "forage", label: "Forage", skill: "survival", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 1,
		desc: "Search surroundings (within 1 mile) for food, water, herbs, or ingredients.",
		successText: "Find 1d4 rations or gather herbs/ingredients.",
		critSuccessText: "Find 1d4 + proficiency bonus rations or a valuable natural resource.",
		failureText: "No supplies found.",
		critFailText: "+1 RM. You disturb the ecosystem.",
		restrictionText: "+1 RM (leaving camp). May require Campfire to process finds."},
	{id: "cook", label: "Cook", skill: null, rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Prepare a hearty meal using ingredients (1 ration + 1 water per person).",
		successText: "A creature who eats the meal reduces 1 level of Exhaustion (once per Long Rest).",
		critSuccessText: null,
		failureText: "The meal is edible but unimpressive; no benefits.",
		critFailText: "Food is spoiled or badly made. Rations are wasted.",
		restrictionText: "Requires light (typically Campfire). Chef feat may grant improved effects."},
	{id: "pray", label: "Pray", skill: "religion", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Offer devotion, seek guidance, or perform rituals.",
		successText: null, critSuccessText: null, failureText: null, critFailText: null,
		restrictionText: "Each special ritual component (incense, sacrifice, chanting) adds +1 RM."},
	{id: "tend", label: "Tend", skill: "medicine", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Provide care by healing wounds, massaging muscles, or practicing meditation.",
		successText: "Benefits depend on the player's specific actions (DM adjudicates).",
		critSuccessText: null, failureText: null, critFailText: null, restrictionText: null},
	{id: "entertain", label: "Entertain", skill: "performance", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 2, rmAlways: 1,
		desc: "Tell stories, sing, play instruments, or boost morale. Noise draws attention.",
		successText: "Grant Heroic Inspiration to all allies.",
		critSuccessText: null,
		failureText: "No effect.",
		critFailText: "+2 RM. You make a racket.",
		restrictionText: "Always +1 RM (noise). May prevent stealth-based actions."},
	{id: "scout", label: "Scout", skill: "perception", rmOnSuccess: -1, rmOnCritSuccess: -1, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 0,
		desc: "Survey the perimeter, check for tracks, and assess nighttime dangers.",
		successText: "−1 RM.",
		critSuccessText: "−1 RM, and all Guards gain Advantage on perception checks until camp break.",
		failureText: "No effect.",
		critFailText: "+1 RM.",
		restrictionText: "+2 DC to Hide Camp per scout. Can be performed before or after setting camp."},
	{id: "research", label: "Research", skill: null, rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "Study books, experiment with magic, write notes, craft formulas, or practice rituals.",
		successText: null, critSuccessText: null, failureText: null, critFailText: null,
		restrictionText: "Requires light. Some experiments may add RM (DM discretion)."},
	{id: "hideCamp", label: "Hide Camp", skill: "stealth", rmOnSuccess: -1, rmOnCritSuccess: -2, rmOnFail: 0, rmOnCritFail: 1, rmAlways: 0,
		desc: "Camouflage tents, position camp in shadows, reduce fire visibility.",
		successText: "−1 RM.",
		critSuccessText: "−2 RM.",
		failureText: "No effect.",
		critFailText: "+1 RM. You accidentally make the camp more conspicuous.",
		restrictionText: "Campfire present: DC +2. For each Scout/Forage: DC +2. Only at the beginning of a camp sequence."},
	{id: "guard", label: "Guard", skill: "perception", rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 2, rmAlways: 0,
		desc: "Keep watch during camp. Can be taken alongside a light activity.",
		successText: "If a random encounter occurs, the party is not surprised.",
		critSuccessText: "If an encounter occurs, the party gains Advantage on initiative.",
		failureText: "If an encounter occurs, the party is surprised.",
		critFailText: "+2 RM. The guard falls asleep; enemies gain a free round if they attack.",
		restrictionText: "Can be done alongside low-intensity tasks (Banter). Multiple Guards act in shifts."},
	{id: "custom", label: "Custom\u2026", skill: null, rmOnSuccess: 0, rmOnCritSuccess: 0, rmOnFail: 0, rmOnCritFail: 0, rmAlways: 0,
		desc: "A custom activity — set your own name and rules.",
		successText: null, critSuccessText: null, failureText: null, critFailText: null, restrictionText: null},
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
	baseDc: 10,
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

/** Maps activity IDs to tool-proficiency keyword fragments (case-insensitive match against toolProficiencies[]). */
const ACTIVITY_TOOL_KEYWORDS = {
	navigate: ["navigator"],
	map: ["cartographer"],
	cook: ["cook"],
	forage: ["herbalism"],
	tend: ["healer", "herbalism"],
	track: ["navigator"],
	campfire: ["tinker"],
	research: ["calligrapher", "forgery"],
};

const DEFAULT_STATE = () => ({
	tab: 0,
	riskModifier: 0,
	travelPace: "normal",
	rollMode: "raw",
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
		const slots = activities[p.id];
		if (!slots) continue;
		const slotArr = Array.isArray(slots) ? slots : [slots];
		for (const act of slotArr) {
			if (!act?.activity) continue;
			if (!chosen[act.activity]) chosen[act.activity] = [];
			chosen[act.activity].push(p.name);
		}
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
		this._eleHeader = null;
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

		/* Roll mode toggle */
		const isTotal = this._state.rollMode === "total";
		const btnRollMode = ee`<button class="ve-btn ve-btn-xs ${isTotal ? "ve-btn-warning" : "ve-btn-default"}  dm-journey__roll-mode-btn" title="Toggle between entering raw d20 rolls (system adds bonus) or final totals (player already added bonus)">${isTotal ? "Rolls = Total" : "Rolls = d20"}</button>`;
		btnRollMode.onn("click", () => {
			this._state.rollMode = this._state.rollMode === "raw" ? "total" : "raw";
			this._reRenderCurrentTab();
			this._renderHeader_update();
			this._doSave();
		});

		/* Party sync status */
		this._eleSyncStatus = ee`<span class="dm-journey__sync-status"></span>`;
		this._updateSyncStatus();

		const btnAddPlayer = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Add a player manually" aria-label="Add Player"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Player</button>`
			.onn("click", () => this._addManualPlayer());

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
			<div class="dm-journey__sync-section">
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

		card.appendChild(eleHeader);

		/* Body (collapsible): activities → stealth → RM summary → risk roll */
		if (!isCollapsed) {
			ee`<div class="dm-journey__section-title">Activities</div>`.appendTo(card);
			const body = this._renderActivityTable(seg.activities, JOURNEY_ACTIVITIES);
			card.appendChild(body);

			ee`<div class="dm-journey__section-title">Stealth</div>`.appendTo(card);
			const eleStealth = this._renderStealthSlots(seg);
			card.appendChild(eleStealth);

			ee`<div class="dm-journey__section-title">RM Changes</div>`.appendTo(card);
			const eleRmSummary = this._renderRmSummary(seg.activities, seg.stealthSlots, JOURNEY_ACTIVITIES);
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
				<span class="dm-journey__note">(Slow Pace only — success: −1 RM vs DC)</span>
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

		const btnAdd = ee`<button class="ve-btn ve-btn-default ve-btn-xs"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add Stealth</button>`;
		btnAdd.onn("click", () => {
			seg.stealthSlots.push({playerId: "", rollResult: "", _rmApplied: 0});
			this._renderJourney();
			this._doSave();
		});

		wrp.appendChild(wrpRows);
		wrp.appendChild(btnAdd);
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
			/* Undo RM from old slot */
			if (slot._rmApplied) {
				this._setRm(this._state.riskModifier - slot._rmApplied, `Undo stealth RM (slot ${ix + 1})`);
				slot._rmApplied = 0;
			}
			slot.playerId = sel.val();
			slot.rollResult = "";
			this._renderJourney();
			this._doSave();
		});

		/* Stealth bonus */
		const ptChar = ptChars.find(c => c.id === slot.playerId);
		const bonus = ptChar ? JourneyTrackerRoot._getSkillBonusFromData(ptChar, "stealth") : 0;
		const bonusStr = ptChar ? this._fmtBonus(bonus) : "";

		/* DC display */
		const eleDc = ee`<span class="dm-journey__dc-cell" title="Base DC ${baseDc}">${baseDc}</span>`;

		/* Roll input + crit toggle for total mode */
		const iptResult = ee`<input type="number" class="ve-form-control ve-input-xs dm-journey__roll-input" placeholder="${isTotalMode ? "Total" : "d20"}" value="${slot.rollResult || ""}" aria-label="Stealth roll">`;

		const CRIT_CYCLE = [null, "critSuccess", "critFail"];
		const CRIT_LABELS = {null: "\u2014", critSuccess: "\u21D1", critFail: "\u21D3"};
		const CRIT_CLASSES = {null: "dm-journey__crit-toggle--normal", critSuccess: "dm-journey__crit-toggle--crit-pass", critFail: "dm-journey__crit-toggle--crit-fail"};
		const CRIT_TITLES = {null: "Normal result (click to cycle)", critSuccess: "Critical Success (click to cycle)", critFail: "Critical Failure (click to cycle)"};

		const curCrit = slot._critOverride || null;
		const btnCrit = ee`<button class="dm-journey__crit-toggle ${CRIT_CLASSES[curCrit]}" title="${CRIT_TITLES[curCrit]}" type="button" aria-label="Toggle critical result">${CRIT_LABELS[curCrit]}</button>`;
		btnCrit.toggleVe(isTotalMode);
		btnCrit.onn("click", () => {
			const curIdx = CRIT_CYCLE.indexOf(slot._critOverride || null);
			slot._critOverride = CRIT_CYCLE[(curIdx + 1) % CRIT_CYCLE.length];
			this._applyStealthRollRm(slot, ix, bonus, baseDc, isTotalMode, players);
			this._renderJourney();
			this._doSave();
		});

		const eleRollCell = ee`<div class="dm-journey__roll-cell">${iptResult}${btnCrit}</div>`;

		iptResult.onn("change", () => {
			slot.rollResult = iptResult.val()?.trim() || "";
			slot._critOverride = isTotalMode ? (slot._critOverride || null) : null;
			this._applyStealthRollRm(slot, ix, bonus, baseDc, isTotalMode, players);
			this._renderJourney();
			this._doSave();
		});

		/* Result cell */
		const eleResult = ee`<span class="dm-journey__roll-result"></span>`;
		if (slot.rollResult !== "" && slot.rollResult != null) {
			const rollNum = parseInt(slot.rollResult, 10);
			if (!isNaN(rollNum) && slot.playerId) {
				const total = isTotalMode ? rollNum : rollNum + bonus;
				const outcome = this._classifyStealthRoll(rollNum, total, baseDc, isTotalMode, slot._critOverride);

				const ICONS = {critSuccess: "\u2714\u2714", success: "\u2714", fail: "\u2718", critFail: "\u2718\u2718"};
				const CLASSES = {critSuccess: "dm-journey__roll-result--crit-pass", success: "dm-journey__roll-result--pass", fail: "dm-journey__roll-result--fail", critFail: "dm-journey__roll-result--crit-fail"};
				const LABELS = {critSuccess: "Crit!", success: "", fail: "", critFail: "Crit Fail!"};

				eleResult.className = `dm-journey__roll-result ${CLASSES[outcome]}`;
				const parts = [`${ICONS[outcome]} ${total}`];
				if (LABELS[outcome]) parts.push(LABELS[outcome]);
				if (slot._rmApplied) parts.push(`(RM ${slot._rmApplied > 0 ? "+" : ""}${slot._rmApplied})`);
				eleResult.txt(parts.join(" "));
			}
		}

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove stealth slot" aria-label="Remove stealth slot">\u00d7</button>`;
		btnRemove.onn("click", () => {
			if (slot._rmApplied) {
				this._setRm(this._state.riskModifier - slot._rmApplied, `Removed stealth slot ${ix + 1}`);
			}
			seg.stealthSlots.splice(ix, 1);
			this._renderJourney();
			this._doSave();
		});

		return ee`<div class="dm-journey__activity-row">
			${sel}
			<span class="dm-journey__skill-bonus" title="Stealth bonus">${bonusStr}</span>
			${eleDc}
			${eleRollCell}
			${eleResult}
			${btnRemove}
		</div>`;
	}

	/** Classify a stealth roll: check nat 20/1 in d20 mode, or manual override in total mode. */
	_classifyStealthRoll (rollNum, total, dc, isTotalMode, critOverride) {
		const success = total >= dc;
		if (isTotalMode && critOverride) return critOverride;
		if (!isTotalMode) {
			if (rollNum === 20) return success ? "critSuccess" : "success";
			if (rollNum === 1) return !success ? "critFail" : "fail";
		}
		return success ? "success" : "fail";
	}

	/** Apply stealth roll RM effects with crit support. */
	_applyStealthRollRm (slot, ix, bonus, baseDc, isTotalMode, players) {
		/* Undo previous RM */
		if (slot._rmApplied) {
			this._setRm(this._state.riskModifier - slot._rmApplied, `Undo stealth roll (slot ${ix + 1})`);
			slot._rmApplied = 0;
		}

		const rollNum = parseInt(slot.rollResult, 10);
		if (isNaN(rollNum) || !slot.playerId) return;

		const total = isTotalMode ? rollNum : rollNum + bonus;
		const outcome = this._classifyStealthRoll(rollNum, total, baseDc, isTotalMode, slot._critOverride);
		const playerName = players.find(p => p.id === slot.playerId)?.name || "?";
		const logStr = isTotalMode
			? `${playerName} \u2014 Stealth: total ${total} vs DC ${baseDc}`
			: `${playerName} \u2014 Stealth: d20(${rollNum}) ${this._fmtBonus(bonus)} = ${total} vs DC ${baseDc}`;

		const OUTCOME_LABELS = {critSuccess: "Critical Success", success: "Success", fail: "Failure", critFail: "Critical Failure"};
		const RM_MAP = {critSuccess: -2, success: -1, fail: 0, critFail: 2};
		const rmDelta = RM_MAP[outcome];
		slot._rmApplied = rmDelta;

		if (rmDelta) {
			this._setRm(this._state.riskModifier + rmDelta, `Stealth ${OUTCOME_LABELS[outcome]} (${playerName}): ${rmDelta > 0 ? "+" : ""}${rmDelta} RM`);
		}
		this._addLog("activity", `${logStr} \u2192 ${OUTCOME_LABELS[outcome]}${rmDelta ? ` (RM ${rmDelta > 0 ? "+" : ""}${rmDelta})` : ""}`);
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
			onUpdate();
		});

		const iptOverride = ee`<input type="number" class="dm-journey__override-input" placeholder="Override" title="Override total result" value="${segOrCamp.riskRollOverride ?? ""}">`;
		iptOverride.onn("change", () => {
			const v = iptOverride.val()?.trim();
			segOrCamp.riskRollOverride = v === "" ? null : parseInt(v, 10);
			onUpdate();
		});

		return ee`<div class="dm-journey__risk-section">
			<span class="ve-bold">Risk Roll:</span>
			${riskBadge}
			${btnRoll}
			${iptOverride}
		</div>`;
	}

	/* -------------------------------------------- */
	/*  RM Summary (shared)                          */
	/* -------------------------------------------- */

	_renderRmSummary (activities, stealthSlots, activityList) {
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

		/* Gather RM contributions from stealth slots */
		if (stealthSlots) {
			for (const slot of stealthSlots) {
				if (slot._rmApplied) {
					const playerName = players.find(p => p.id === slot.playerId)?.name || "?";
					items.push({label: `Stealth (${playerName})`, value: slot._rmApplied, type: "roll"});
				}
			}
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

		/* Activity table */
		const body = this._renderActivityTable(camp.activities, CAMP_ACTIVITIES);

		/* Guard slots */
		const eleGuard = this._renderGuardSlots();

		/* RM Summary */
		const eleRmSummary = this._renderRmSummary(camp.activities, null, CAMP_ACTIVITIES);

		/* Risk Roll section (shared) */
		const eleRisk = this._renderRiskRollSection(camp, () => { this._renderCamp(); this._doSave(); });

		this._wrpCamp.appendChild(eleCampfire);
		this._wrpCamp.appendChild(btnHideCamp);
		ee`<hr class="dm-journey__camp-section-divider">`.appendTo(this._wrpCamp);
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
			<span>Bonus</span>
			<span>DC</span>
			<span>Roll</span>
			<span>Result</span>
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

			const slots = activities[player.id];
			for (let i = 0; i < slots.length; i++) {
				const act = slots[i];
				const row = this._renderActivityRow(player, act, ptChar, activityList, activities, players, i === 0, i);
				wrp.appendChild(row);
			}

			/* Banter checkbox — shown on last row, spans full width */
			const banterKey = `_bantering_${player.id}`;
			if (activities[banterKey] == null) activities[banterKey] = false;
			const cbxBanter = ee`<input type="checkbox" ${activities[banterKey] ? "checked" : ""} aria-label="Bantering">`;
			cbxBanter.onn("change", () => {
				activities[banterKey] = cbxBanter.prop("checked");
				this._doSave();
			});
			ee`<label class="dm-journey__banter-row">
				${cbxBanter}
				<span>Also Bantering</span>
				<span class="dm-journey__note">(no roll — grants Inspiration Points)</span>
			</label>`.appendTo(wrp);
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

	_renderActivityRow (player, act, ptChar, activityList, activities, allPlayers, isFirstRow = true, slotIndex = 0) {
		const actDef = activityList.find(a => a.id === act.activity);

		/* ---- Activity dropdown ---- */
		const optionsHtml = activityList.map(a => `<option value="${a.id}" ${act.activity === a.id ? "selected" : ""} title="${this._escAttr(a.desc || "")}">${a.label}</option>`).join("");
		const selTitle = actDef?.desc || "";
		const sel = ee`<select class="ve-form-control ve-input-xs dm-journey__activity-sel" aria-label="Activity for ${this._escAttr(player.name)}" title="${this._escAttr(selTitle)}"><option value="">\u2014 None \u2014</option>${optionsHtml}</select>`;
		sel.onn("change", () => {
			const oldDef = activityList.find(a => a.id === act.activity);
			/* Undo all RM applied from this slot */
			const totalUndo = (act._rmAlwaysApplied || 0) + (act._rmRollApplied || 0);
			if (totalUndo) {
				this._setRm(this._state.riskModifier - totalUndo, `Undo ${oldDef?.label || "activity"} (${player.name})`);
			}

			/* Switch to new activity */
			act.activity = sel.val();
			act.rollResult = "";
			act.customName = act.activity === "custom" ? (act.customName || "") : "";
			act._rmAlwaysApplied = 0;
			act._rmRollApplied = 0;
			act._critOverride = null;

			/* Auto-apply rmAlways for the new activity */
			const newDef = activityList.find(a => a.id === act.activity);
			if (newDef?.rmAlways) {
				act._rmAlwaysApplied = newDef.rmAlways;
				this._setRm(this._state.riskModifier + newDef.rmAlways, `${newDef.label} (${player.name}): auto ${newDef.rmAlways > 0 ? "+" : ""}${newDef.rmAlways} RM`);
			}
			this._reRenderCurrentTab();
			this._doSave();
		});

		/* Custom name (shown only when "Custom…" is picked) */
		const isCustom = act.activity === "custom";
		const iptCustom = ee`<input type="text" class="ve-form-control ve-input-xs dm-journey__custom-input" placeholder="Custom activity" value="${this._escAttr(act.customName || "")}">`;
		iptCustom.toggleVe(isCustom);
		iptCustom.onn("change", () => { act.customName = iptCustom.val(); this._doSave(); });

		/* ---- Bonus cell (skill + tool) ---- */
		let bonusStr = "";
		let bonusTitle = "";
		let hasToolProf = false;
		if (ptChar && actDef?.skill) {
			const info = JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef.id, actDef.skill);
			bonusStr = this._fmtBonus(info.total);
			hasToolProf = info.hasToolProf;
			const parts = [`Skill: ${this._fmtBonus(info.skillBonus)}`];
			if (info.hasToolProf) parts.push(`Tool prof: ${info.toolBonus ? `+${info.toolBonus} (included)` : "has tools (already skill-proficient)"}`);
			if (actDef.rmAlways > 0) parts.push(`Auto RM: +${actDef.rmAlways}`);
			else if (actDef.rmOnSuccess < 0) parts.push(`On success: ${actDef.rmOnSuccess} RM`);
			bonusTitle = parts.join(" \u2022 ");
		}

		const eleBonusCell = ee`<span class="dm-journey__skill-bonus" title="${this._escAttr(bonusTitle)}">${bonusStr}</span>`;
		if (hasToolProf) {
			ee`<span class="dm-journey__tool-indicator" title="Has relevant tool proficiency">\uD83D\uDD27</span>`.appendTo(eleBonusCell);
		}

		/* ---- DC cell ---- */
		const {dc, impossible, notes: dcNotes} = act.activity
			? this._getEffectiveDc(act.activity, activityList, activities, allPlayers)
			: {dc: null, impossible: false, notes: []};

		let dcStr = "\u2014";
		let dcCls = "dm-journey__dc-cell";
		if (impossible) {
			dcStr = "N/A";
			dcCls += " dm-journey__dc-cell--impossible";
		} else if (dc != null) {
			dcStr = `${dc}`;
			if (dcNotes.length) dcCls += " dm-journey__dc-cell--modified";
		}
		const dcTitle = impossible ? "Impossible at current pace" : dcNotes.length ? `Base ${this._state.area.baseDc ?? 10}: ${dcNotes.join(", ")}` : "";
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
		btnCrit.toggleVe(isTotalMode && !!actDef?.skill);
		btnCrit.onn("click", () => {
			const curIdx = CRIT_CYCLE.indexOf(act._critOverride || null);
			act._critOverride = CRIT_CYCLE[(curIdx + 1) % CRIT_CYCLE.length];
			/* Re-evaluate RM for this roll with the new crit state */
			this._applyActivityRollRm(act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList);
			this._reRenderCurrentTab();
			this._doSave();
		});

		const eleRollCell = ee`<div class="dm-journey__roll-cell">${iptResult}${btnCrit}</div>`;

		iptResult.onn("change", () => {
			act.rollResult = iptResult.val()?.trim() || "";
			act._critOverride = isTotalMode ? (act._critOverride || null) : null;
			this._applyActivityRollRm(act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList);
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

		return ee`<div class="${rowCls}">
			${eleNameCell}
			${eleActivityCell}
			${eleBonusCell}
			${eleDcCell}
			${eleRollCell}
			${eleResultCell}
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

	/* ---- Activity roll RM evaluation (unified for initial roll and crit cycle) ---- */

	_applyActivityRollRm (act, actDef, player, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList) {
		/* Undo previous roll-based RM */
		if (act._rmRollApplied) {
			this._setRm(this._state.riskModifier - act._rmRollApplied, `Undo roll ${actDef?.label || "?"} (${player.name})`);
			act._rmRollApplied = 0;
		}

		const rawVal = act.rollResult;
		const rollNum = parseInt(rawVal, 10);
		if (isNaN(rollNum) || !actDef?.skill || dc == null || impossible) return;

		const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef.id, actDef.skill) : {total: 0};
		const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
		const outcome = this._classifyActivityRoll(rollNum, total, dc, actDef, isTotalMode, act._critOverride, activities, allPlayers, activityList);

		const logStr = isTotalMode
			? `${player.name} \u2014 ${actDef.label}: total ${total} vs DC ${dc}`
			: `${player.name} \u2014 ${actDef.label}: d20(${rollNum}) ${this._fmtBonus(bonusInfo.total)} = ${total} vs DC ${dc}`;

		let rmDelta = 0;
		const OUTCOME_LABELS = {critSuccess: "Critical Success", success: "Success", fail: "Failure", critFail: "Critical Failure"};
		const label = OUTCOME_LABELS[outcome];

		if (outcome === "critSuccess") {
			if (actDef.critSuccessPerPlayer) {
				/* Scout crit: −1 RM per player taking this activity */
				const count = this._countPlayersWithActivity(actDef.id, activities, allPlayers);
				rmDelta = (actDef.rmOnCritSuccess || 0) * count;
			} else {
				rmDelta = actDef.rmOnCritSuccess ?? actDef.rmOnSuccess ?? 0;
			}
		} else if (outcome === "success") {
			rmDelta = actDef.rmOnSuccess ?? 0;
		} else if (outcome === "critFail") {
			rmDelta = actDef.rmOnCritFail ?? actDef.rmOnFail ?? 0;
		} else {
			rmDelta = actDef.rmOnFail ?? 0;
		}

		act._rmRollApplied = rmDelta;
		if (rmDelta) {
			this._setRm(this._state.riskModifier + rmDelta, `${actDef.label} ${label} (${player.name}): ${rmDelta > 0 ? "+" : ""}${rmDelta} RM`);
		}
		this._addLog("activity", `${logStr} \u2192 ${label}${rmDelta ? ` (RM ${rmDelta > 0 ? "+" : ""}${rmDelta})` : ""}`);
	}

	/** Classify a roll as critSuccess/success/fail/critFail. */
	_classifyActivityRoll (rollNum, total, dc, actDef, isTotalMode, critOverride, activities, allPlayers, activityList) {
		const success = total >= dc;

		/* Total mode: use manual crit override if present */
		if (isTotalMode && critOverride) return critOverride;

		/* d20 mode: auto-detect crits */
		if (!isTotalMode) {
			/* Check for group check (2+ players with same activity) */
			const count = this._countPlayersWithActivity(actDef.id, activities, allPlayers);
			if (count >= 2) {
				/* Group check: all pass = crit success, all fail = crit fail */
				const groupResult = this._evaluateGroupCheck(actDef, activities, allPlayers, dc, activityList);
				if (groupResult) return groupResult;
			} else {
				/* Single player: nat 20 / nat 1 */
				if (rollNum === 20) return success ? "critSuccess" : "success";
				if (rollNum === 1) return !success ? "critFail" : "fail";
			}
		}

		return success ? "success" : "fail";
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

	/** Evaluate a group check: if all rolled and all pass → critSuccess, all fail → critFail, else null. */
	_evaluateGroupCheck (actDef, activities, allPlayers, dc, activityList) {
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

		let allRolled = true;
		let allPass = true;
		let allFail = true;

		for (const {slot, playerId} of relevantSlots) {
			const rollNum = parseInt(slot.rollResult, 10);
			if (isNaN(rollNum)) { allRolled = false; break; }

			const ptChar = this._getPartyTrackerCharacters().find(c => c.id === playerId);
			const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef.id, actDef.skill) : {total: 0};
			const total = isTotalMode ? rollNum : rollNum + bonusInfo.total;
			const success = total >= dc;
			if (success) allFail = false;
			else allPass = false;
		}

		if (!allRolled) return null;
		if (allPass) return "critSuccess";
		if (allFail) return "critFail";
		return null;
	}

	/** Render the result cell based on current activity state. */
	_renderActivityResultCell (act, actDef, ptChar, dc, impossible, isTotalMode, activities, allPlayers, activityList) {
		const eleResultCell = ee`<span class="dm-journey__roll-result"></span>`;

		if (act.rollResult !== "" && act.rollResult != null) {
			const rollNum = parseInt(act.rollResult, 10);
			if (!isNaN(rollNum) && actDef?.skill && dc != null) {
				const bonusInfo = ptChar ? JourneyTrackerRoot._getActivityBonusFromData(ptChar, actDef.id, actDef.skill) : {total: 0};
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
			}
		} else if (act._rmAlwaysApplied) {
			eleResultCell.className = "dm-journey__roll-result dm-journey__rm-auto";
			eleResultCell.txt(`auto RM ${act._rmAlwaysApplied > 0 ? "+" : ""}${act._rmAlwaysApplied}`);
		}

		return eleResultCell;
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

		/* Base DC */
		const iptBaseDc = ee`<input type="number" class="ve-form-control ve-input-xs" min="1" max="30" value="${area.baseDc ?? 10}" style="width: 50px;" aria-label="Base DC">`;
		iptBaseDc.onn("change", () => {
			const val = Math.max(1, Math.min(30, parseInt(iptBaseDc.val(), 10) || 10));
			area.baseDc = val;
			iptBaseDc.val(val);
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
				<label class="ve-bold">Base DC</label>
				<div class="ve-flex-v-center ve-gap-1">
					${iptBaseDc}
					<span class="dm-journey__note">(modified by pace &amp; activity interactions)</span>
				</div>
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
		/* Cascade from top: anything >= intense.min is intense (handles overflow above max) */
		if (total >= ranges.intense.min) return "intense";
		if (total >= ranges.moderate.min) return "moderate";
		if (total >= ranges.mild.min) return "mild";
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

	/**
	 * Undo all RM contributions from a player's activity slots (journey segments + camp).
	 */
	_undoPlayerRm (player) {
		let total = 0;
		/* Journey segments */
		for (const seg of this._state.journey.segments) {
			const slots = seg.activities?.[player.id];
			if (slots) {
				const slotArr = Array.isArray(slots) ? slots : [slots];
				for (const act of slotArr) {
					total += (act._rmAlwaysApplied || 0) + (act._rmRollApplied || 0);
				}
			}
			/* Stealth slots */
			for (const slot of (seg.stealthSlots || [])) {
				if (slot.playerId === player.id) total += (slot._rmApplied || 0);
			}
		}
		/* Camp */
		const campSlots = this._state.camp.activities?.[player.id];
		if (campSlots) {
			const slotArr = Array.isArray(campSlots) ? campSlots : [campSlots];
			for (const campAct of slotArr) {
				total += (campAct._rmAlwaysApplied || 0) + (campAct._rmRollApplied || 0);
			}
		}

		if (total) this._setRm(this._state.riskModifier - total, `Undo all RM from ${player.name}`);
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
	/*  Effective DC                                  */
	/* -------------------------------------------- */

	/**
	 * Computes the effective DC for a given activity, factoring in pace and interaction modifiers.
	 * @returns {{dc: number|null, impossible: boolean, notes: string[]}}
	 *   dc=null means no standard DC (e.g. Banter, Custom).
	 */
	_getEffectiveDc (activityId, activityList, activities, allPlayers) {
		const actDef = activityList.find(a => a.id === activityId);
		if (!actDef?.skill) return {dc: null, impossible: false, notes: []};

		const baseDc = this._state.area.baseDc ?? 10;
		const pace = this._state.travelPace;

		let dc = baseDc;
		let impossible = false;
		const notes = [];

		/* Pace-based modifiers */
		if (activityId === "navigate") {
			if (pace === "fast") { dc += 2; notes.push("+2 fast pace"); }
			if (pace === "slow") { dc -= 2; notes.push("\u22122 slow pace"); }
		}

		/* Hide Tracks / Hide Camp: other loud activities raise DC */
		if (activityId === "hideTracks" || activityId === "hideCamp") {
			let interactionMod = 0;
			const counts = {};
			for (const p of allPlayers) {
				const slots = activities[p.id];
				if (!slots) continue;
				const slotArr = Array.isArray(slots) ? slots : [slots];
				for (const slot of slotArr) {
					const a = slot?.activity;
					if (a === "scout" || a === "forage" || a === "entertain") {
						counts[a] = (counts[a] || 0) + 1;
						interactionMod += 2;
					}
				}
			}
			if (interactionMod) {
				dc += interactionMod;
				const parts = [];
				if (counts.scout) parts.push(`+${counts.scout * 2} scout`);
				if (counts.forage) parts.push(`+${counts.forage * 2} forage`);
				if (counts.entertain) parts.push(`+${counts.entertain * 2} entertain`);
				notes.push(...parts);
			}
			if (pace === "fast") { dc += 2; notes.push("+2 fast pace"); }
			if (pace === "slow") { dc -= 2; notes.push("\u22122 slow pace"); }
		}

		/* Impossible checks */
		if (activityId === "map" && pace === "fast") impossible = true;
		if (activityId === "forage" && pace === "fast" && activityList === JOURNEY_ACTIVITIES) impossible = true;

		return {dc, impossible, notes};
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
			stealthSlots: [],
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
		if (charData.overrides?.skillBonuses?.[skill] != null) return charData.overrides.skillBonuses[skill];
		const ability = SKILL_TO_ABILITY[skill];
		if (!ability) return 0;
		const score = charData.abilities?.[ability] ?? 10;
		const mod = Math.floor((score - 10) / 2);
		const totalLevel = charData.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
		const profBonus = Math.floor((totalLevel - 1) / 4) + 2;
		const profLevel = Number(charData.skillProficiencies?.[skill]) || 0;
		let bonus = mod + (profLevel * profBonus);
		bonus += charData.bonuses?.skills?.[skill] || 0;
		return bonus;
	}

	/**
	 * Returns the proficiency bonus if the character has a tool proficiency relevant to the given activity.
	 * Tool proficiencies are an array of free-text strings; we keyword-match against ACTIVITY_TOOL_KEYWORDS.
	 * Returns 0 if no relevant tool proficiency.
	 */
	static _getToolProfBonusFromData (charData, activityId) {
		const keywords = ACTIVITY_TOOL_KEYWORDS[activityId];
		if (!keywords?.length) return 0;
		const tools = charData.toolProficiencies;
		if (!Array.isArray(tools) || !tools.length) return 0;
		const hasMatch = tools.some(t => {
			const lower = `${t}`.toLowerCase();
			return keywords.some(kw => lower.includes(kw));
		});
		if (!hasMatch) return 0;
		const totalLevel = charData.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
		return Math.floor((totalLevel - 1) / 4) + 2;
	}

	/**
	 * Returns the effective bonus for a character performing a given activity.
	 * Combines skill bonus + tool proficiency bonus (only when skill is not already proficient).
	 */
	static _getActivityBonusFromData (charData, activityId, skill) {
		if (!skill) return {total: 0, skillBonus: 0, toolBonus: 0, hasToolProf: false};
		const skillBonus = JourneyTrackerRoot._getSkillBonusFromData(charData, skill);
		const toolProfBonus = JourneyTrackerRoot._getToolProfBonusFromData(charData, activityId);
		const hasToolProf = toolProfBonus > 0;
		const skillProfLevel = Number(charData.skillProficiencies?.[skill]) || 0;
		/* Only add tool prof to the total if the character isn't already proficient in the skill */
		const effectiveToolBonus = (hasToolProf && skillProfLevel === 0) ? toolProfBonus : 0;
		return {total: skillBonus + effectiveToolBonus, skillBonus, toolBonus: effectiveToolBonus, hasToolProf};
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
			},
			journey: {
				segments: (toLoad.journey?.segments || []).map(seg => ({
					activities: JourneyTrackerRoot._migrateActivities(seg.activities),
					stealthSlots: (seg.stealthSlots || []).map(s => ({...s})),
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
				activities: JourneyTrackerRoot._migrateActivities(toLoad.camp?.activities),
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
			},
			journey: {
				segments: this._state.journey.segments.map(seg => ({
					activities: JourneyTrackerRoot._cloneActivities(seg.activities),
					stealthSlots: (seg.stealthSlots || []).map(s => ({...s})),
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
				activities: JourneyTrackerRoot._cloneActivities(this._state.camp.activities),
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
