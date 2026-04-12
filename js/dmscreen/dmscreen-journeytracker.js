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

const WEATHER_PRESETS = {
	clear: {label: "Clear", dcMod: 0, rmMod: 0, icon: "\u2600\uFE0F", paceRestrict: null, effects: []},
	overcast: {label: "Overcast", dcMod: 0, rmMod: 0, icon: "\u2601\uFE0F", paceRestrict: null, effects: []},
	rain: {label: "Rain", dcMod: 2, rmMod: 0, icon: "\uD83C\uDF27\uFE0F", paceRestrict: null, effects: ["Disadvantage on Perception (sight)", "Extinguishes open flames"]},
	heavyRain: {label: "Heavy Rain", dcMod: 3, rmMod: 1, icon: "\u26C8\uFE0F", paceRestrict: null, effects: ["Heavily obscured beyond 100ft", "Disadvantage on Perception", "\u22122 Navigation"]},
	fog: {label: "Fog", dcMod: 2, rmMod: 0, icon: "\uD83C\uDF2B\uFE0F", paceRestrict: null, effects: ["Heavily obscured beyond 30ft", "Disadvantage on Scout"]},
	snow: {label: "Snow", dcMod: 2, rmMod: 0, icon: "\u2744\uFE0F", paceRestrict: "slow", effects: ["Difficult terrain", "Tracks visible (+2 Track, \u22122 Hide Tracks)"]},
	blizzard: {label: "Blizzard", dcMod: 5, rmMod: 2, icon: "\uD83C\uDF28\uFE0F", paceRestrict: "slow", effects: ["Heavily obscured", "Extreme Cold exposure", "No Forage/Map"]},
	extremeHeat: {label: "Extreme Heat", dcMod: 2, rmMod: 0, icon: "\uD83D\uDD25", paceRestrict: null, effects: ["CON save DC 10+1/hour or 1 exhaustion", "Water consumption doubled"]},
	extremeCold: {label: "Extreme Cold", dcMod: 2, rmMod: 0, icon: "\uD83E\uDD76", paceRestrict: null, effects: ["CON save DC 10+1/hour or 1 exhaustion without cold resistance"]},
	wind: {label: "Strong Wind", dcMod: 1, rmMod: 0, icon: "\uD83D\uDCA8", paceRestrict: null, effects: ["Disadvantage on ranged attacks", "Disadvantage on Perception (hearing)"]},
};

const DEFAULT_WEATHER_TABLE = () => [
	{weatherKey: "clear", weight: 3},
	{weatherKey: "overcast", weight: 2},
	{weatherKey: "rain", weight: 2},
	{weatherKey: "heavyRain", weight: 1},
	{weatherKey: "fog", weight: 1},
	{weatherKey: "snow", weight: 1},
	{weatherKey: "wind", weight: 1},
];

const WEATHER_TABLE_PRESETS = {
	temperate: {label: "Temperate", table: [
		{weatherKey: "clear", weight: 3}, {weatherKey: "overcast", weight: 2},
		{weatherKey: "rain", weight: 2}, {weatherKey: "heavyRain", weight: 1},
		{weatherKey: "fog", weight: 1}, {weatherKey: "snow", weight: 1}, {weatherKey: "wind", weight: 1},
	]},
	desert: {label: "Desert", table: [
		{weatherKey: "clear", weight: 4}, {weatherKey: "extremeHeat", weight: 3},
		{weatherKey: "wind", weight: 2}, {weatherKey: "overcast", weight: 1},
	]},
	arctic: {label: "Arctic", table: [
		{weatherKey: "snow", weight: 3}, {weatherKey: "extremeCold", weight: 3},
		{weatherKey: "blizzard", weight: 2}, {weatherKey: "overcast", weight: 2},
		{weatherKey: "clear", weight: 1}, {weatherKey: "wind", weight: 1},
	]},
	tropical: {label: "Tropical", table: [
		{weatherKey: "rain", weight: 3}, {weatherKey: "heavyRain", weight: 2},
		{weatherKey: "extremeHeat", weight: 2}, {weatherKey: "clear", weight: 2},
		{weatherKey: "fog", weight: 1}, {weatherKey: "overcast", weight: 1},
	]},
	coastal: {label: "Coastal", table: [
		{weatherKey: "wind", weight: 3}, {weatherKey: "fog", weight: 2},
		{weatherKey: "rain", weight: 2}, {weatherKey: "overcast", weight: 2},
		{weatherKey: "clear", weight: 2}, {weatherKey: "heavyRain", weight: 1},
	]},
	mountain: {label: "Mountain", table: [
		{weatherKey: "wind", weight: 3}, {weatherKey: "snow", weight: 2},
		{weatherKey: "fog", weight: 2}, {weatherKey: "clear", weight: 2},
		{weatherKey: "extremeCold", weight: 1}, {weatherKey: "blizzard", weight: 1}, {weatherKey: "rain", weight: 1},
	]},
};

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
	weatherTable: DEFAULT_WEATHER_TABLE(),
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

const DEFAULT_SUPPLIES = () => [
	{id: CryptUtil.uid(), name: "Rations", count: 0, dailyBurn: 0, unit: "days", isDefault: true},
	{id: CryptUtil.uid(), name: "Water", count: 0, dailyBurn: 0, unit: "gallons", isDefault: true},
	{id: CryptUtil.uid(), name: "Torches", count: 0, dailyBurn: 0, unit: "", isDefault: true},
];

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
		activities: {},
		guardSlots: [],
		riskRoll: null,
		riskRollTotal: null,
		riskRollOverride: null,
		rmAtRoll: 0,
	},
	weather: {
		current: "clear",
		perSegment: false,
		segmentWeather: [],
		customTypes: [],
	},
	supplies: {
		items: DEFAULT_SUPPLIES(),
		autoDeplete: true,
	},
	timeline: {
		days: [],
		currentDayIndex: 0,
		journeyName: "",
		startDate: "",
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
			this._reRenderCurrentTab();
			this._doSave();
		});

		const btnRoll = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll random weather from table">\uD83C\uDFB2 Roll</button>`;
		btnRoll.onn("click", () => this._rollWeather());

		/* Per-segment toggle */
		const cbxPerSeg = ee`<input type="checkbox" ${w.perSegment ? "checked" : ""}>`;
		cbxPerSeg.onn("change", () => {
			w.perSegment = cbxPerSeg.prop("checked");
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

		/* Activity table */
		const body = this._renderActivityTable(camp.activities, CAMP_ACTIVITIES);

		/* Guard slots */
		const eleGuard = this._renderGuardSlots();

		/* RM Summary */
		const eleRmSummary = this._renderRmSummary(camp.activities, null, CAMP_ACTIVITIES);

		/* Risk Roll section (shared) */
		const eleRisk = this._renderRiskRollSection(camp, () => { this._renderCamp(); this._doSave(); });

		this._wrpCamp.appendChild(eleCampfire);
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

	_renderActivityRow (player, act, ptChar, activityList, activities, allPlayers, isFirstRow = true, slotIndex = 0, banterKey = null, segmentIndex = undefined) {
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
			? this._getEffectiveDc(act.activity, activityList, activities, allPlayers, segmentIndex)
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

		/* Forage success: track that rations were gained (DM enters amount manually or we note it) */
		if (actDef.id === "forage" && (outcome === "success" || outcome === "critSuccess")) {
			if (!act._forageLogged) {
				act._forageLogged = true;
				/* Don't auto-add a random amount — let the result cell prompt the DM */
			}
		}
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
		this._state.camp = {
			campfireActive: false,
			activities: {},
			guardSlots: [],
			riskRoll: null,
			riskRollTotal: null,
			riskRollOverride: null,
			rmAtRoll: 0,
		};
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
		if (!actDef?.skill) return {dc: null, impossible: false, notes: []};

		const baseDc = this._state.area.baseDc ?? 10;
		const pace = this._state.travelPace;

		let dc = baseDc;
		let impossible = false;
		const notes = [];

		/* Weather DC modifier */
		const weather = this._getWeatherForSegment(segmentIndex);
		const weatherPreset = this._getWeatherPreset(weather);
		if (weatherPreset?.dcMod) {
			dc += weatherPreset.dcMod;
			notes.push(`${weatherPreset.dcMod > 0 ? "+" : ""}${weatherPreset.dcMod} ${weatherPreset.label}`);
		}

		/* Blizzard: no Forage/Map */
		if (weather === "blizzard" && (activityId === "forage" || activityId === "map")) {
			impossible = true;
		}

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
				weatherTable: (toLoad.area?.weatherTable || DEFAULT_WEATHER_TABLE()).map(e => ({...e})),
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
				activities: JourneyTrackerRoot._migrateActivities(toLoad.camp?.activities),
				guardSlots: (toLoad.camp?.guardSlots || []).map(s => ({...s})),
				riskRoll: toLoad.camp?.riskRoll ?? null,
				riskRollTotal: toLoad.camp?.riskRollTotal ?? null,
				riskRollOverride: toLoad.camp?.riskRollOverride ?? null,
				rmAtRoll: toLoad.camp?.rmAtRoll ?? 0,
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
				activities: JourneyTrackerRoot._cloneActivities(this._state.camp.activities),
				guardSlots: this._state.camp.guardSlots.map(s => ({...s})),
				riskRoll: this._state.camp.riskRoll,
				riskRollTotal: this._state.camp.riskRollTotal,
				riskRollOverride: this._state.camp.riskRollOverride,
				rmAtRoll: this._state.camp.rmAtRoll,
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
