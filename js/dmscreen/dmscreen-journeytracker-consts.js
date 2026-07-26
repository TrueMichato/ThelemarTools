/* ==============================================================================================
 * Journey Tracker — constants + pure rule logic.
 *
 * This module is intentionally DOM-free (no `ee`, no rendering) and has no hard import-time
 * dependencies, so the travel/camp/tracking rules can be unit-tested in isolation
 * (see test/jest/DmScreenJourneyTracker.test.js). `CryptUtil` is only referenced at call-time
 * (inside factory functions), mirroring the dmscreen-initiativetracker-consts.js precedent.
 * ============================================================================================== */

/* ---------------------------------------------------------------------------------------------- */
/*  Journey activities                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Activity definitions. `skills` lists every skill the activity may use — the character's best
 * allowed skill is chosen automatically (with a manual override). The legacy single `skill`
 * remains as the default / primary option for backward compatibility.
 */
export const JOURNEY_ACTIVITIES = [
	{id: "navigate",
		label: "Navigate",
		skill: "survival",
		skills: ["survival"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Essential navigation activity for journeys without a clear path.",
		successText: "The party continues toward their destination, covering the expected distance.",
		critSuccessText: "Exceptional navigation — the party finds a shortcut or avoids a hazard.",
		failureText: "The party makes no progress or veers off course (adds 1d6 hours to travel time).",
		critFailText: "The party becomes badly lost, potentially entering dangerous territory.",
		restrictionText: "Fast Pace: DC +2. Slow Pace: DC \u22122."},
	{id: "scout",
		label: "Scout",
		skill: "perception",
		skills: ["perception", "survival"],
		rmOnSuccess: -1,
		rmOnCritSuccess: -1,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 0,
		critSuccessPerPlayer: true,
		desc: "Look out for danger along the party's path.",
		successText: "−1 RM. You spot danger early and alert the party.",
		critSuccessText: "−1 RM for every party member taking this activity.",
		failureText: "No effect.",
		critFailText: "+1 RM. You miss something important.",
		restrictionText: "Perception or Survival. Fast Pace: Disadvantage. Slow Pace: Advantage. +2 DC to Hide Tracks per scout."},
	{id: "map",
		label: "Map",
		skill: "investigation",
		skills: ["investigation"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Document terrain, create maps, and refine understanding of the region.",
		successText: "The party gains Advantage on their next Navigation check in this area.",
		critSuccessText: "Advantage on all Navigation checks in this area for the rest of the Journey Phase.",
		failureText: "No effect.",
		critFailText: "Misrecorded details — next Navigation check in this area at Disadvantage.",
		restrictionText: "Cartographer's Tools or Investigation. Not possible at Fast Pace."},
	{id: "forage",
		label: "Forage",
		skill: "survival",
		skills: ["survival", "nature"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 0,
		desc: "Gather edible plants, hunt small game, and locate water sources.",
		successText: "Find 1d4 rations (DM may adjust based on biome).",
		critSuccessText: "Find 1d4 + proficiency bonus rations, or locate a rare resource.",
		failureText: "No resources found.",
		critFailText: "+1 RM. You disturb the environment.",
		restrictionText: "Survival or Nature. Not possible at Fast Pace. +2 DC to Hide Tracks per forager."},
	{id: "hideTracks",
		label: "Hide Tracks",
		skill: "stealth",
		skills: ["survival", "stealth"],
		rmOnSuccess: -1,
		rmOnCritSuccess: -2,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 0,
		desc: "Cover footprints and obscure evidence of passage.",
		successText: "−1 RM.",
		critSuccessText: "−2 RM, and impose Disadvantage on any creature attempting to track the party for 24 hours.",
		failureText: "No effect.",
		critFailText: "+1 RM. You leave obvious clues.",
		restrictionText: "Survival or Stealth. Fast Pace: DC +2. Slow Pace: DC \u22122. For each ally performing Scout, Forage, or Entertain: DC +2."},
	{id: "entertain",
		label: "Entertain",
		skill: "performance",
		skills: ["performance"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 2,
		rmAlways: 1,
		desc: "Tell stories, sing, play instruments, or boost morale. Noise draws attention.",
		successText: "Grant Heroic Inspiration to all allies.",
		critSuccessText: null,
		failureText: "No effect.",
		critFailText: "+2 RM. You make a racket.",
		restrictionText: "Performance or Musical Instrument. Always +1 RM (noise). May prevent stealth-based actions."},
	{id: "track",
		label: "Track",
		skill: "survival",
		skills: ["survival"],
		isTracking: true,
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Follow tracks, signs, or magical traces. Replaces Navigation for the segment.",
		successText: "Successfully follow the trail (see Degrees of Success).",
		critSuccessText: null,
		failureText: "Trail is lost; must search 10 min (confined) or 1 hr (outdoors) to retry.",
		critFailText: null,
		restrictionText: "Wisdom (Survival) vs terrain DC. Normal Pace: Disadvantage. Fast Pace: Not possible."},
	{id: "custom",
		label: "Custom\u2026",
		skill: null,
		skills: [],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "A custom activity — set your own name and rules.",
		successText: null,
		critSuccessText: null,
		failureText: null,
		critFailText: null,
		restrictionText: null},
];

export const CAMP_ACTIVITIES = [
	{id: "campfire",
		label: "Campfire",
		skill: "survival",
		skills: ["survival", "nature"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 2,
		rmAlways: 0,
		desc: "Build and maintain a campfire for warmth, light, safety, and cooking.",
		successText: "A stable fire burns throughout the night, enabling Cook and other fire-dependent activities.",
		critSuccessText: "Exceptionally well-prepared — grants Advantage on Cook checks.",
		failureText: "The fire sputters out after 1 hour unless someone spends another hour fixing it.",
		critFailText: "+2 RM. Excessive smoke or flare; the fire fails.",
		restrictionText: "Survival or Nature. +1 RM while active (toggle separately). Required for activities needing light."},
	{id: "forage",
		label: "Forage",
		skill: "survival",
		skills: ["survival", "nature"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 1,
		desc: "Search surroundings (within 1 mile) for food, water, herbs, or ingredients.",
		successText: "Find 1d4 rations or gather herbs/ingredients.",
		critSuccessText: "Find 1d4 + proficiency bonus rations or a valuable natural resource.",
		failureText: "No supplies found.",
		critFailText: "+1 RM. You disturb the ecosystem.",
		restrictionText: "Survival or Nature. +1 RM (leaving camp). May require Campfire to process finds."},
	{id: "cook",
		label: "Cook",
		skill: null,
		skills: [],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Prepare a hearty meal using ingredients (1 ration + 1 water per person).",
		successText: "A creature who eats the meal reduces 1 level of Exhaustion (once per Long Rest).",
		critSuccessText: null,
		failureText: "The meal is edible but unimpressive; no benefits.",
		critFailText: "Food is spoiled or badly made. Rations are wasted.",
		restrictionText: "Cook's Utensils. Requires light (typically Campfire). Chef feat may grant improved effects."},
	{id: "pray",
		label: "Pray",
		skill: "religion",
		skills: ["religion"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Offer devotion, seek guidance, or perform rituals.",
		successText: null,
		critSuccessText: null,
		failureText: null,
		critFailText: null,
		restrictionText: "Religion. Each special ritual component (incense, sacrifice, chanting) adds +1 RM."},
	{id: "tend",
		label: "Tend",
		skill: "medicine",
		skills: ["medicine"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Provide care by healing wounds, massaging muscles, or practicing meditation.",
		successText: "Benefits depend on the player's specific actions (DM adjudicates).",
		critSuccessText: null,
		failureText: null,
		critFailText: null,
		restrictionText: "Medicine."},
	{id: "entertain",
		label: "Entertain",
		skill: "performance",
		skills: ["performance"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 2,
		rmAlways: 1,
		desc: "Tell stories, sing, play instruments, or boost morale. Noise draws attention.",
		successText: "Grant Heroic Inspiration to all allies.",
		critSuccessText: null,
		failureText: "No effect.",
		critFailText: "+2 RM. You make a racket.",
		restrictionText: "Performance, Musical Instrument, or Gaming Set. Always +1 RM (noise). May prevent stealth-based actions."},
	{id: "scout",
		label: "Scout",
		skill: "perception",
		skills: ["perception", "survival"],
		rmOnSuccess: -1,
		rmOnCritSuccess: -1,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 0,
		critSuccessPerPlayer: true,
		desc: "Survey the perimeter, check for tracks, and assess nighttime dangers.",
		successText: "−1 RM.",
		critSuccessText: "−1 RM, and all Guards gain Advantage on perception checks until camp break.",
		failureText: "No effect.",
		critFailText: "+1 RM.",
		restrictionText: "Perception or Survival. +2 DC to Hide Camp per scout. Can be performed before or after setting camp."},
	{id: "research",
		label: "Research",
		skill: null,
		skills: ["arcana", "nature", "religion", "investigation"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "Study books, experiment with magic, write notes, craft formulas, or practice rituals.",
		successText: null,
		critSuccessText: null,
		failureText: null,
		critFailText: null,
		restrictionText: "Arcana, Nature, Religion, or Investigation. Requires light. Some experiments may add RM (DM discretion)."},
	{id: "hideCamp",
		label: "Hide Camp",
		skill: "stealth",
		skills: ["survival", "stealth"],
		rmOnSuccess: -1,
		rmOnCritSuccess: -2,
		rmOnFail: 0,
		rmOnCritFail: 1,
		rmAlways: 0,
		desc: "Camouflage tents, position camp in shadows, reduce fire visibility.",
		successText: "−1 RM.",
		critSuccessText: "−2 RM.",
		failureText: "No effect.",
		critFailText: "+1 RM. You accidentally make the camp more conspicuous.",
		restrictionText: "Survival or Stealth. Campfire present: DC +2. For each Scout/Forage: DC +2. Only at the beginning of a camp sequence."},
	{id: "guard",
		label: "Guard",
		skill: "perception",
		skills: ["perception"],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 2,
		rmAlways: 0,
		desc: "Keep watch during camp. Can be taken alongside a light activity.",
		successText: "If a random encounter occurs, the party is not surprised.",
		critSuccessText: "If an encounter occurs, the party gains Advantage on initiative.",
		failureText: "If an encounter occurs, the party is surprised.",
		critFailText: "+2 RM. The guard falls asleep; enemies gain a free round if they attack.",
		restrictionText: "Can be done alongside low-intensity tasks (Banter). Multiple Guards act in shifts."},
	{id: "custom",
		label: "Custom\u2026",
		skill: null,
		skills: [],
		rmOnSuccess: 0,
		rmOnCritSuccess: 0,
		rmOnFail: 0,
		rmOnCritFail: 0,
		rmAlways: 0,
		desc: "A custom activity — set your own name and rules.",
		successText: null,
		critSuccessText: null,
		failureText: null,
		critFailText: null,
		restrictionText: null},
];

/* ---------------------------------------------------------------------------------------------- */
/*  Pace                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export const PACE_OPTIONS = [
	{id: "slow",
		label: "Slow",
		moveMult: "2/3\u00d7",
		navDc: -2,
		stealth: "Possible",
		passivePerc: "+5 / Adv. active",
		activities: "Enables Stealth & Hide Tracks",
		tips: "2/3 speed \u00b7 Nav DC \u22122 \u00b7 Stealth possible \u00b7 +5 Passive Perception"},
	{id: "normal",
		label: "Normal",
		moveMult: "1\u00d7",
		navDc: 0,
		stealth: "No",
		passivePerc: "Normal",
		activities: "Standard action list",
		tips: "Standard speed \u00b7 Area Nav DC \u00b7 No stealth"},
	{id: "fast",
		label: "Fast",
		moveMult: "1.3\u00d7",
		navDc: 2,
		stealth: "No",
		passivePerc: "\u22125 / Disadv. active",
		activities: "Disadv. Scout \u00b7 No Map/Forage/Track",
		tips: "1.3\u00d7 speed \u00b7 Nav DC +2 \u00b7 No stealth \u00b7 Disadv. Scout \u00b7 No Map/Forage"},
];

/* ---------------------------------------------------------------------------------------------- */
/*  Weather                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export const WEATHER_PRESETS = {
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

export const DEFAULT_WEATHER_TABLE = () => [
	{weatherKey: "clear", weight: 3},
	{weatherKey: "overcast", weight: 2},
	{weatherKey: "rain", weight: 2},
	{weatherKey: "heavyRain", weight: 1},
	{weatherKey: "fog", weight: 1},
	{weatherKey: "snow", weight: 1},
	{weatherKey: "wind", weight: 1},
];

export const WEATHER_TABLE_PRESETS = {
	temperate: {label: "Temperate",
		table: [
			{weatherKey: "clear", weight: 3}, {weatherKey: "overcast", weight: 2},
			{weatherKey: "rain", weight: 2}, {weatherKey: "heavyRain", weight: 1},
			{weatherKey: "fog", weight: 1}, {weatherKey: "snow", weight: 1}, {weatherKey: "wind", weight: 1},
		]},
	desert: {label: "Desert",
		table: [
			{weatherKey: "clear", weight: 4}, {weatherKey: "extremeHeat", weight: 3},
			{weatherKey: "wind", weight: 2}, {weatherKey: "overcast", weight: 1},
		]},
	arctic: {label: "Arctic",
		table: [
			{weatherKey: "snow", weight: 3}, {weatherKey: "extremeCold", weight: 3},
			{weatherKey: "blizzard", weight: 2}, {weatherKey: "overcast", weight: 2},
			{weatherKey: "clear", weight: 1}, {weatherKey: "wind", weight: 1},
		]},
	tropical: {label: "Tropical",
		table: [
			{weatherKey: "rain", weight: 3}, {weatherKey: "heavyRain", weight: 2},
			{weatherKey: "extremeHeat", weight: 2}, {weatherKey: "clear", weight: 2},
			{weatherKey: "fog", weight: 1}, {weatherKey: "overcast", weight: 1},
		]},
	coastal: {label: "Coastal",
		table: [
			{weatherKey: "wind", weight: 3}, {weatherKey: "fog", weight: 2},
			{weatherKey: "rain", weight: 2}, {weatherKey: "overcast", weight: 2},
			{weatherKey: "clear", weight: 2}, {weatherKey: "heavyRain", weight: 1},
		]},
	mountain: {label: "Mountain",
		table: [
			{weatherKey: "wind", weight: 3}, {weatherKey: "snow", weight: 2},
			{weatherKey: "fog", weight: 2}, {weatherKey: "clear", weight: 2},
			{weatherKey: "extremeCold", weight: 1}, {weatherKey: "blizzard", weight: 1}, {weatherKey: "rain", weight: 1},
		]},
};

export const RANGE_COLORS = {
	empty: {cls: "dm-journey__badge--empty", label: "Empty"},
	mild: {cls: "dm-journey__badge--mild", label: "Mild"},
	moderate: {cls: "dm-journey__badge--moderate", label: "Moderate"},
	intense: {cls: "dm-journey__badge--intense", label: "Intense"},
};

export const DEFAULT_AREA = () => ({
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

export const SKILL_TO_ABILITY = {
	athletics: "str",
	acrobatics: "dex",
	sleightOfHand: "dex",
	stealth: "dex",
	arcana: "int",
	history: "int",
	investigation: "int",
	nature: "int",
	religion: "int",
	animalHandling: "wis",
	insight: "wis",
	medicine: "wis",
	perception: "wis",
	survival: "wis",
	deception: "cha",
	intimidation: "cha",
	performance: "cha",
	persuasion: "cha",
};

/** Maps activity IDs to tool-proficiency keyword fragments (case-insensitive match against toolProficiencies[]). */
export const ACTIVITY_TOOL_KEYWORDS = {
	navigate: ["navigator"],
	map: ["cartographer"],
	cook: ["cook"],
	forage: ["herbalism"],
	tend: ["healer", "herbalism"],
	track: ["navigator"],
	campfire: ["tinker"],
	research: ["calligrapher", "forgery"],
	entertain: ["instrument", "gaming"],
};

export const DEFAULT_SUPPLIES = () => [
	{id: CryptUtil.uid(), name: "Rations", count: 0, dailyBurn: 0, unit: "days", isDefault: true},
	{id: CryptUtil.uid(), name: "Water", count: 0, dailyBurn: 0, unit: "gallons", isDefault: true},
	{id: CryptUtil.uid(), name: "Torches", count: 0, dailyBurn: 0, unit: "", isDefault: true},
];

export const DEFAULT_STATE = () => ({
	tab: 0,
	riskModifier: 0,
	travelPace: "normal",
	rollMode: "raw",
	players: [],
	area: DEFAULT_AREA(),
	journey: {segments: []},
	camp: {
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

/* ---------------------------------------------------------------------------------------------- */
/*  Tracking sub-system (DMG-style, system-neutral)                                                */
/* ---------------------------------------------------------------------------------------------- */

export const TRACKING_TERRAINS = [
	{key: "soft", label: "Soft Surface", dc: 10, examples: "Fresh snow, thick mud, wet sand"},
	{key: "common", label: "Common Terrain", dc: 15, examples: "Dirt, grass, forest floor, dusty floor"},
	{key: "hard", label: "Hard Surface", dc: 20, examples: "Rocky ground, ice, bare wood floor"},
	{key: "barren", label: "Barren Surface", dc: 25, examples: "Scrubbed stone, flowing water, magic-affected tiles"},
];

/** Degrees of success, evaluated top-down by margin (total − DC). */
export const TRACKING_DEGREES = [
	{key: "master", minMargin: 15, label: "Master", title: "The Unseen", info: "Spot minute details: encumbered? wounded? carrying a rider? Identify specific individuals if you've seen their tracks before."},
	{key: "expert", minMargin: 10, label: "Expert", title: "The Story", info: "Determine the precise time of passage (within 1 hour) and specific species."},
	{key: "solid", minMargin: 5, label: "Solid", title: "The Quarry", info: "Identify creature type, exact number of creatures, and their pace."},
	{key: "path", minMargin: 0, label: "Success", title: "The Path", info: "Find the tracks and follow them for a travel segment. You know the general direction of travel."},
	{key: "lost", minMargin: -Infinity, label: "Lost", title: "Lost", info: "You cannot find the trail. Search 10 minutes (confined) or 1 hour (outdoors) to try again."},
];

/** Advisory circumstance modifiers (DM applies manually). */
export const TRACKING_MODIFIERS = [
	{key: "crowd", label: "Crowd (\u22121 DC per extra creature, max \u22125)"},
	{key: "blood", label: "Blood Trail (\u22125 DC — quarry wounded)"},
	{key: "hiding", label: "Quarry Hiding (DC = their Stealth check, if higher)"},
	{key: "age", label: "Age of Trail (+5 DC per 24h)"},
	{key: "weather", label: "Weather since passage (Disadvantage)"},
	{key: "visibility", label: "Dim light / fog without darkvision (Disadvantage)"},
	{key: "disturbance", label: "Over-tracked area (+5 DC)"},
];

/* ---------------------------------------------------------------------------------------------- */
/*  Pure rule logic                                                                                */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Classify a d12 + RM total into a risk range using the area's configured ranges.
 * Cascades from the top so a total above the intense max is still intense.
 * @returns {"empty"|"mild"|"moderate"|"intense"}
 */
export function classifyRiskRange (total, riskRanges) {
	const ranges = riskRanges || {mild: {min: 1}, moderate: {min: 5}, intense: {min: 11}};
	if (total >= (ranges.intense?.min ?? 11)) return "intense";
	if (total >= (ranges.moderate?.min ?? 5)) return "moderate";
	if (total >= (ranges.mild?.min ?? 1)) return "mild";
	return "empty";
}

/**
 * Classify a single (non-group) skill check.
 * In "raw d20" mode a natural 20/1 upgrades/downgrades to a critical result.
 * @returns {"critSuccess"|"success"|"fail"|"critFail"}
 */
export function classifySingleRoll ({rollNum, total, dc, isTotalMode = false}) {
	const success = total >= dc;
	if (!isTotalMode) {
		if (rollNum === 20) return success ? "critSuccess" : "success";
		if (rollNum === 1) return !success ? "critFail" : "fail";
	}
	return success ? "success" : "fail";
}

/**
 * Evaluate a group check from an array of per-member pass/fail booleans.
 * Locked model: all pass → critSuccess; all fail → critFail; otherwise standard 5e
 * (≥ half of the group succeeds → group success, else group failure).
 * @param {boolean[]} passResults
 * @returns {"critSuccess"|"success"|"fail"|"critFail"|null}
 */
export function evaluateGroupCheck (passResults) {
	const n = passResults?.length || 0;
	if (!n) return null;
	const passes = passResults.filter(Boolean).length;
	if (passes === n) return "critSuccess";
	if (passes === 0) return "critFail";
	return passes >= Math.ceil(n / 2) ? "success" : "fail";
}

/** Map an outcome key to its RM delta for a given activity definition (handles per-player scout crit). */
export function rmDeltaForOutcome (actDef, outcome, {perPlayerCount = 1} = {}) {
	if (!actDef) return 0;
	switch (outcome) {
		case "critSuccess":
			if (actDef.critSuccessPerPlayer) return (actDef.rmOnCritSuccess || 0) * perPlayerCount;
			return actDef.rmOnCritSuccess ?? actDef.rmOnSuccess ?? 0;
		case "success": return actDef.rmOnSuccess ?? 0;
		case "critFail": return actDef.rmOnCritFail ?? actDef.rmOnFail ?? 0;
		case "fail": return actDef.rmOnFail ?? 0;
		default: return 0;
	}
}

/**
 * Compute the net Risk-Modifier contribution for a single activity's participant group, as a pure
 * function of the current rolls. This is the single source of truth for activity *roll* RM — it
 * replaces the old per-slot imperative apply/undo, which double-counted group checks (the group
 * delta was applied once per participant) and went stale (early rollers kept their individual-check
 * RM when a later roll flipped the group outcome).
 *
 * Model:
 *  - No participant has rolled yet → 0.
 *  - 2+ participants, all rolled → ONE group outcome ({@link evaluateGroupCheck}), scaled by the
 *    participant count only for per-player-crit activities (Scout).
 *  - 2+ participants, only some rolled → the sum of each rolled slot's individual outcome delta
 *    (an interim value shown while the group check completes).
 *  - Single participant → that slot's individual outcome delta.
 *
 * Note: crit overrides (total mode) only influence single-participant activities; a completed group
 * check derives its crit purely from all-pass / all-fail, mirroring {@link evaluateGroupCheck}.
 *
 * @param {object}   opts
 * @param {object}   opts.actDef            Activity definition (rm* fields, critSuccessPerPlayer).
 * @param {number|null} opts.dc             Effective DC (null → 0 contribution).
 * @param {boolean} [opts.isTotalMode]      True when rolls are entered as final totals.
 * @param {Array<{rollNum:(number|null), total:(number|null), critOverride:(string|null)}>} [opts.participantSlots]
 * @returns {number} Net RM contribution for this activity group.
 */
export function computeActivityGroupRm ({actDef, dc, isTotalMode = false, participantSlots = []}) {
	if (!actDef || dc == null) return 0;
	if (!getActivitySkills(actDef).length) return 0;

	const rolled = participantSlots.filter(s => s && s.rollNum != null && !Number.isNaN(s.rollNum));
	if (!rolled.length) return 0;

	const singleDelta = (s) => {
		const outcome = (isTotalMode && s.critOverride)
			? s.critOverride
			: classifySingleRoll({rollNum: s.rollNum, total: s.total, dc, isTotalMode});
		return rmDeltaForOutcome(actDef, outcome, {perPlayerCount: 1});
	};

	const count = participantSlots.length;
	if (count >= 2) {
		if (rolled.length === count) {
			const passResults = rolled.map(s => (s.total ?? 0) >= dc);
			const groupOutcome = evaluateGroupCheck(passResults);
			const perPlayerCount = actDef.critSuccessPerPlayer ? count : 1;
			return rmDeltaForOutcome(actDef, groupOutcome, {perPlayerCount});
		}
		return rolled.reduce((sum, s) => sum + singleDelta(s), 0);
	}

	return singleDelta(rolled[0]);
}

/**
 * Sum the total derived Risk-Modifier a single activity container (journey segment or camp) currently
 * contributes: each activity group's recorded roll RM ({@link computeActivityGroupRm} output stored in
 * `activityGroupRm`), the stealth group check (`stealthGroupRm`), and every slot's always-on RM
 * (`_rmAlwaysApplied`). Used to net out a container's RM before it is discarded (e.g. segment trim).
 * Pure: reads only plain state.
 * @param {object} container A segment or camp object.
 * @returns {number}
 */
export function sumContainerRm (container) {
	if (!container) return 0;
	let total = 0;
	for (const v of Object.values(container.activityGroupRm || {})) total += v || 0;
	total += container.stealthGroupRm || 0;
	for (const slots of Object.values(container.activities || {})) {
		if (!Array.isArray(slots)) continue;
		for (const slot of slots) total += (slot && slot._rmAlwaysApplied) || 0;
	}
	return total;
}

/**
 * Compute the effective DC for an activity, factoring pace, weather, and cross-activity interactions.
 * Pure: all inputs are plain data (no DOM / state access).
 * @returns {{dc: number|null, impossible: boolean, notes: string[]}}
 */
export function computeEffectiveDc ({activityId, actDef, activities, allPlayers, pace, baseDc = 10, weatherKey = "clear", weatherPreset = null, campfireActive = false, isCamp = false}) {
	if (!actDef?.skill && !actDef?.skills?.length) return {dc: null, impossible: false, notes: []};

	/* Track uses its own terrain DC — only surface the pace restriction here. */
	if (actDef.isTracking) {
		return {dc: null, impossible: pace === "fast", notes: pace === "normal" ? ["Disadvantage (Normal pace)"] : []};
	}

	let dc = baseDc;
	let impossible = false;
	const notes = [];

	if (weatherPreset?.dcMod) {
		dc += weatherPreset.dcMod;
		notes.push(`${weatherPreset.dcMod > 0 ? "+" : ""}${weatherPreset.dcMod} ${weatherPreset.label}`);
	}

	if (weatherKey === "blizzard" && (activityId === "forage" || activityId === "map")) impossible = true;

	if (activityId === "navigate") {
		if (pace === "fast") { dc += 2; notes.push("+2 fast pace"); }
		if (pace === "slow") { dc -= 2; notes.push("\u22122 slow pace"); }
	}

	if (activityId === "hideTracks" || activityId === "hideCamp") {
		let interactionMod = 0;
		const counts = {};
		for (const p of (allPlayers || [])) {
			const slots = activities?.[p.id];
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
			if (counts.scout) notes.push(`+${counts.scout * 2} scout`);
			if (counts.forage) notes.push(`+${counts.forage * 2} forage`);
			if (counts.entertain) notes.push(`+${counts.entertain * 2} entertain`);
		}
		/* Campfire raises Hide Camp DC by +2. */
		if (activityId === "hideCamp" && campfireActive) { dc += 2; notes.push("+2 campfire"); }
		if (pace === "fast") { dc += 2; notes.push("+2 fast pace"); }
		if (pace === "slow") { dc -= 2; notes.push("\u22122 slow pace"); }
	}

	if (activityId === "map" && pace === "fast") impossible = true;
	if (activityId === "forage" && pace === "fast" && !isCamp) impossible = true;

	return {dc, impossible, notes};
}

/** Classify a tracking result by margin (total − DC). Always returns a degree object. */
export function classifyTrackingDegree (total, dc) {
	const margin = total - dc;
	return TRACKING_DEGREES.find(d => margin >= d.minMargin) || TRACKING_DEGREES[TRACKING_DEGREES.length - 1];
}

/* ---------------------------------------------------------------------------------------------- */
/*  Character-data bonus helpers (operate on the Party Tracker character-data shape)               */
/* ---------------------------------------------------------------------------------------------- */

export function getSkillBonusFromData (charData, skill) {
	if (charData?.overrides?.skillBonuses?.[skill] != null) return charData.overrides.skillBonuses[skill];
	const ability = SKILL_TO_ABILITY[skill];
	if (!ability) return 0;
	const score = charData?.abilities?.[ability] ?? 10;
	const mod = Math.floor((score - 10) / 2);
	const totalLevel = charData?.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
	const profBonus = Math.floor((totalLevel - 1) / 4) + 2;
	const profLevel = Number(charData?.skillProficiencies?.[skill]) || 0;
	let bonus = mod + (profLevel * profBonus);
	bonus += charData?.bonuses?.skills?.[skill] || 0;
	return bonus;
}

/**
 * Returns the proficiency bonus if the character has a tool proficiency relevant to the given
 * activity (keyword match against ACTIVITY_TOOL_KEYWORDS). Returns 0 if none.
 */
export function getToolProfBonusFromData (charData, activityId) {
	const keywords = ACTIVITY_TOOL_KEYWORDS[activityId];
	if (!keywords?.length) return 0;
	const tools = charData?.toolProficiencies;
	if (!Array.isArray(tools) || !tools.length) return 0;
	const hasMatch = tools.some(t => {
		const lower = `${t}`.toLowerCase();
		return keywords.some(kw => lower.includes(kw));
	});
	if (!hasMatch) return 0;
	const totalLevel = charData?.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 1;
	return Math.floor((totalLevel - 1) / 4) + 2;
}

/** The allowed skill options for an activity (falls back to the legacy single `skill`). */
export function getActivitySkills (actDef) {
	if (!actDef) return [];
	if (actDef.skills?.length) return actDef.skills;
	return actDef.skill ? [actDef.skill] : [];
}

/**
 * Returns the effective bonus for a character performing an activity. When the activity allows
 * multiple skills, the character's best allowed skill is chosen (unless `skillChoice` forces one).
 * Combines skill bonus + tool proficiency bonus (tool added only when not already skill-proficient).
 * @returns {{total:number, skillBonus:number, toolBonus:number, hasToolProf:boolean, skill:string|null}}
 */
export function computeActivityBonus (charData, actDef, {skillChoice = null} = {}) {
	const skills = getActivitySkills(actDef);
	if (!skills.length) return {total: 0, skillBonus: 0, toolBonus: 0, hasToolProf: false, skill: null};

	const candidates = (skillChoice && skills.includes(skillChoice)) ? [skillChoice] : skills;

	let best = null;
	for (const skill of candidates) {
		const skillBonus = getSkillBonusFromData(charData, skill);
		if (!best || skillBonus > best.skillBonus) best = {skill, skillBonus};
	}

	const toolProfBonus = getToolProfBonusFromData(charData, actDef.id);
	const hasToolProf = toolProfBonus > 0;
	const skillProfLevel = Number(charData?.skillProficiencies?.[best.skill]) || 0;
	const effectiveToolBonus = (hasToolProf && skillProfLevel === 0) ? toolProfBonus : 0;

	return {
		total: best.skillBonus + effectiveToolBonus,
		skillBonus: best.skillBonus,
		toolBonus: effectiveToolBonus,
		hasToolProf,
		skill: best.skill,
	};
}

/**
 * Cross-activity interaction notes (Hide Tracks/Camp DC bumps, pace restrictions, noise RM, etc.).
 * @returns {string[]}
 */
export function getActivityInteractions (activities, allPlayers, {isCamp = false, pace = "normal"} = {}) {
	const notes = [];
	const chosen = {};
	for (const p of (allPlayers || [])) {
		const slots = activities?.[p.id];
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

	if (chosen.scout?.length && pace === "fast") notes.push("Scout: Disadvantage (Fast Pace)");
	if (chosen.scout?.length && pace === "slow") notes.push("Scout: Advantage (Slow Pace)");

	if (chosen.entertain?.length) notes.push(`Entertain: always +${chosen.entertain.length} RM (noise)`);
	if (chosen.forage?.length && isCamp) notes.push(`Forage (Camp): +${chosen.forage.length} RM (leaving camp)`);

	if (pace === "fast") {
		if (chosen.map?.length) notes.push("Map: NOT possible at Fast Pace!");
		if (chosen.forage?.length && !isCamp) notes.push("Forage: NOT possible at Fast Pace!");
		if (chosen.track?.length) notes.push("Track: NOT possible at Fast Pace!");
	}
	if (chosen.track?.length && pace === "normal") notes.push("Track: Disadvantage (Normal Pace)");

	if (chosen.navigate?.length) {
		if (pace === "fast") notes.push("Navigate: DC +2 (Fast Pace)");
		if (pace === "slow") notes.push("Navigate: DC \u22122 (Slow Pace)");
	}

	return notes;
}
