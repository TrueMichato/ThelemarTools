import "../../js/parser.js";
import "../../js/utils.js";
import {
	JOURNEY_ACTIVITIES,
	CAMP_ACTIVITIES,
	PACE_OPTIONS,
	TRACKING_TERRAINS,
	TRACKING_DEGREES,
	DEFAULT_STATE,
	classifyRiskRange,
	classifySingleRoll,
	evaluateGroupCheck,
	rmDeltaForOutcome,
	computeEffectiveDc,
	classifyTrackingDegree,
	getSkillBonusFromData,
	getToolProfBonusFromData,
	getActivitySkills,
	computeActivityBonus,
	getActivityInteractions,
} from "../../js/dmscreen/dmscreen-journeytracker-consts.js";

const findAct = (list, id) => list.find(a => a.id === id);

/* -------------------------------------------- */
/*  Data-shape sanity                            */
/* -------------------------------------------- */

describe("Journey Tracker constants", () => {
	it("exposes the journey activities from the rules", () => {
		const ids = JOURNEY_ACTIVITIES.map(a => a.id);
		expect(ids).toEqual(expect.arrayContaining(["navigate", "scout", "map", "forage", "hideTracks", "entertain", "track"]));
	});

	it("gives every activity a skills array (with legacy single skill preserved)", () => {
		for (const act of [...JOURNEY_ACTIVITIES, ...CAMP_ACTIVITIES]) {
			expect(Array.isArray(getActivitySkills(act))).toBe(true);
		}
	});

	it("marks dual-skill activities with more than one option", () => {
		expect(getActivitySkills(findAct(JOURNEY_ACTIVITIES, "scout"))).toEqual(expect.arrayContaining(["perception", "survival"]));
		expect(getActivitySkills(findAct(JOURNEY_ACTIVITIES, "forage")).length).toBeGreaterThan(1);
		expect(getActivitySkills(findAct(JOURNEY_ACTIVITIES, "hideTracks")).length).toBeGreaterThan(1);
	});

	it("provides three travel paces with descriptive fields", () => {
		expect(PACE_OPTIONS.map(p => p.id)).toEqual(["slow", "normal", "fast"]);
		for (const p of PACE_OPTIONS) {
			expect(typeof p.moveMult).toBe("string");
			expect(typeof p.passivePerc).toBe("string");
		}
	});

	it("provides tracking terrains with ascending DCs", () => {
		const dcs = TRACKING_TERRAINS.map(t => t.dc);
		expect(dcs).toEqual([10, 15, 20, 25]);
	});

	it("DEFAULT_STATE seeds new serialized fields with backward-compatible defaults", () => {
		const s = DEFAULT_STATE();
		expect(s.camp.siteDescription).toBe("");
		expect(s.camp.encounterResolved ?? false).toBe(false);
	});
});

/* -------------------------------------------- */
/*  classifyRiskRange                            */
/* -------------------------------------------- */

describe("classifyRiskRange", () => {
	const ranges = {mild: {min: 1}, moderate: {min: 5}, intense: {min: 11}};

	it("returns empty below the mild threshold", () => {
		expect(classifyRiskRange(0, ranges)).toBe("empty");
	});

	it("classifies mild / moderate / intense at their thresholds", () => {
		expect(classifyRiskRange(1, ranges)).toBe("mild");
		expect(classifyRiskRange(4, ranges)).toBe("mild");
		expect(classifyRiskRange(5, ranges)).toBe("moderate");
		expect(classifyRiskRange(10, ranges)).toBe("moderate");
		expect(classifyRiskRange(11, ranges)).toBe("intense");
	});

	it("cascades above the intense max", () => {
		expect(classifyRiskRange(99, ranges)).toBe("intense");
	});

	it("falls back to defaults when ranges omitted", () => {
		expect(classifyRiskRange(11)).toBe("intense");
		expect(classifyRiskRange(0)).toBe("empty");
	});
});

/* -------------------------------------------- */
/*  classifySingleRoll                           */
/* -------------------------------------------- */

describe("classifySingleRoll", () => {
	it("passes / fails on total vs dc in total mode", () => {
		expect(classifySingleRoll({rollNum: 5, total: 15, dc: 15, isTotalMode: true})).toBe("success");
		expect(classifySingleRoll({rollNum: 5, total: 14, dc: 15, isTotalMode: true})).toBe("fail");
	});

	it("upgrades a natural 20 to critSuccess when the total also meets the DC", () => {
		expect(classifySingleRoll({rollNum: 20, total: 25, dc: 15})).toBe("critSuccess");
	});

	it("a natural 20 that misses the DC is only a success", () => {
		expect(classifySingleRoll({rollNum: 20, total: 12, dc: 30})).toBe("success");
	});

	it("downgrades a natural 1 to critFail when the total also misses the DC", () => {
		expect(classifySingleRoll({rollNum: 1, total: 5, dc: 15})).toBe("critFail");
	});

	it("a natural 1 that meets the DC is only a fail", () => {
		expect(classifySingleRoll({rollNum: 1, total: 25, dc: 5})).toBe("fail");
	});

	it("ignores nat 20/1 crit upgrades in total mode", () => {
		expect(classifySingleRoll({rollNum: 20, total: 5, dc: 15, isTotalMode: true})).toBe("fail");
		expect(classifySingleRoll({rollNum: 1, total: 25, dc: 15, isTotalMode: true})).toBe("success");
	});
});

/* -------------------------------------------- */
/*  evaluateGroupCheck (locked model)            */
/* -------------------------------------------- */

describe("evaluateGroupCheck", () => {
	it("returns null for an empty group", () => {
		expect(evaluateGroupCheck([])).toBeNull();
		expect(evaluateGroupCheck(null)).toBeNull();
	});

	it("all pass → critSuccess", () => {
		expect(evaluateGroupCheck([true, true, true])).toBe("critSuccess");
	});

	it("all fail → critFail", () => {
		expect(evaluateGroupCheck([false, false])).toBe("critFail");
	});

	it("half or more succeed → success (standard 5e)", () => {
		expect(evaluateGroupCheck([true, true, false])).toBe("success");
		expect(evaluateGroupCheck([true, false])).toBe("success"); // 1 of 2 ≥ ceil(2/2)=1
	});

	it("fewer than half succeed → fail", () => {
		expect(evaluateGroupCheck([true, false, false])).toBe("fail");
		expect(evaluateGroupCheck([true, false, false, false])).toBe("fail");
	});
});

/* -------------------------------------------- */
/*  rmDeltaForOutcome                            */
/* -------------------------------------------- */

describe("rmDeltaForOutcome", () => {
	const scout = findAct(JOURNEY_ACTIVITIES, "scout");

	it("returns the success/fail deltas", () => {
		expect(rmDeltaForOutcome(scout, "success")).toBe(-1);
		expect(rmDeltaForOutcome(scout, "critFail")).toBe(1);
	});

	it("scales scout critSuccess per participating player", () => {
		expect(rmDeltaForOutcome(scout, "critSuccess", {perPlayerCount: 3})).toBe(-3);
	});

	it("falls back to success delta when no crit-success delta defined", () => {
		const act = {rmOnSuccess: -2};
		expect(rmDeltaForOutcome(act, "critSuccess")).toBe(-2);
	});

	it("returns 0 for an unknown outcome or missing def", () => {
		expect(rmDeltaForOutcome(scout, "weird")).toBe(0);
		expect(rmDeltaForOutcome(null, "success")).toBe(0);
	});
});

/* -------------------------------------------- */
/*  computeEffectiveDc                           */
/* -------------------------------------------- */

describe("computeEffectiveDc", () => {
	const navigate = findAct(JOURNEY_ACTIVITIES, "navigate");
	const track = findAct(JOURNEY_ACTIVITIES, "track");
	const hideCamp = findAct(CAMP_ACTIVITIES, "hideCamp");

	it("applies navigate pace modifiers", () => {
		expect(computeEffectiveDc({activityId: "navigate", actDef: navigate, pace: "fast", baseDc: 12}).dc).toBe(14);
		expect(computeEffectiveDc({activityId: "navigate", actDef: navigate, pace: "slow", baseDc: 12}).dc).toBe(10);
	});

	it("marks map impossible at fast pace", () => {
		const map = findAct(JOURNEY_ACTIVITIES, "map");
		expect(computeEffectiveDc({activityId: "map", actDef: map, pace: "fast", baseDc: 10}).impossible).toBe(true);
	});

	it("adds +2 to Hide Camp DC when a campfire is active", () => {
		const noFire = computeEffectiveDc({activityId: "hideCamp", actDef: hideCamp, pace: "normal", baseDc: 10, isCamp: true, campfireActive: false});
		const withFire = computeEffectiveDc({activityId: "hideCamp", actDef: hideCamp, pace: "normal", baseDc: 10, isCamp: true, campfireActive: true});
		expect(withFire.dc - noFire.dc).toBe(2);
		expect(withFire.notes).toEqual(expect.arrayContaining(["+2 campfire"]));
	});

	it("returns pace restriction for the tracking activity without a numeric DC", () => {
		expect(computeEffectiveDc({activityId: "track", actDef: track, pace: "fast"}).impossible).toBe(true);
		expect(computeEffectiveDc({activityId: "track", actDef: track, pace: "normal"}).dc).toBeNull();
		expect(computeEffectiveDc({activityId: "track", actDef: track, pace: "normal"}).notes.length).toBeGreaterThan(0);
	});
});

/* -------------------------------------------- */
/*  classifyTrackingDegree                       */
/* -------------------------------------------- */

describe("classifyTrackingDegree", () => {
	it("maps margins to the five degrees of success", () => {
		expect(classifyTrackingDegree(10, 25).key).toBe("lost"); // margin -15
		expect(classifyTrackingDegree(15, 15).key).toBe("path"); // margin 0
		expect(classifyTrackingDegree(20, 15).key).toBe("solid"); // margin 5
		expect(classifyTrackingDegree(25, 15).key).toBe("expert"); // margin 10
		expect(classifyTrackingDegree(30, 15).key).toBe("master"); // margin 15
	});

	it("always returns a degree object", () => {
		expect(classifyTrackingDegree(-100, 15)).toBeDefined();
		expect(TRACKING_DEGREES.map(d => d.key)).toContain(classifyTrackingDegree(5, 5).key);
	});
});

/* -------------------------------------------- */
/*  Character bonus helpers                       */
/* -------------------------------------------- */

describe("character bonus helpers", () => {
	const char = {
		abilities: {str: 10, dex: 14, con: 12, int: 8, wis: 16, cha: 10},
		classes: [{level: 5}], // prof +3
		skillProficiencies: {perception: 1, survival: 0},
		toolProficiencies: ["Cartographer's Tools"],
	};

	it("computes a skill bonus from ability mod + proficiency", () => {
		// wis 16 → +3 mod, proficient → +3 prof = +6
		expect(getSkillBonusFromData(char, "perception")).toBe(6);
		// survival not proficient → +3 (wis mod only)
		expect(getSkillBonusFromData(char, "survival")).toBe(3);
	});

	it("honors a skill-bonus override", () => {
		expect(getSkillBonusFromData({overrides: {skillBonuses: {perception: 99}}}, "perception")).toBe(99);
	});

	it("grants tool proficiency bonus only on keyword match", () => {
		expect(getToolProfBonusFromData(char, "map")).toBe(3); // cartographer matches map
		expect(getToolProfBonusFromData(char, "forage")).toBe(0);
	});

	it("picks the best allowed skill for a dual-skill activity", () => {
		const scout = findAct(JOURNEY_ACTIVITIES, "scout");
		const res = computeActivityBonus(char, scout);
		expect(res.skill).toBe("perception"); // +6 beats survival +3
		expect(res.total).toBe(6);
	});

	it("respects an explicit skill choice override", () => {
		const scout = findAct(JOURNEY_ACTIVITIES, "scout");
		const res = computeActivityBonus(char, scout, {skillChoice: "survival"});
		expect(res.skill).toBe("survival");
		expect(res.total).toBe(3);
	});

	it("adds tool bonus only when not skill-proficient", () => {
		const map = findAct(JOURNEY_ACTIVITIES, "map");
		const res = computeActivityBonus(char, map); // investigation (int 8 → -1), not proficient, cartographer tool +3
		expect(res.hasToolProf).toBe(true);
		expect(res.toolBonus).toBe(3);
		expect(res.total).toBe(2); // -1 + 3
	});
});

/* -------------------------------------------- */
/*  getActivityInteractions                      */
/* -------------------------------------------- */

describe("getActivityInteractions", () => {
	const players = [{id: "p1", name: "Aria"}, {id: "p2", name: "Bok"}];

	it("notes Scout advantage on slow pace and disadvantage on fast pace", () => {
		const acts = {p1: [{activity: "scout"}]};
		expect(getActivityInteractions(acts, players, {pace: "slow"})).toEqual(expect.arrayContaining([expect.stringContaining("Advantage")]));
		expect(getActivityInteractions(acts, players, {pace: "fast"})).toEqual(expect.arrayContaining([expect.stringContaining("Disadvantage")]));
	});

	it("notes Hide Tracks DC bumps from scouts", () => {
		const acts = {p1: [{activity: "scout"}], p2: [{activity: "hideTracks"}]};
		const notes = getActivityInteractions(acts, players, {pace: "normal"});
		expect(notes.some(n => n.includes("Hide Tracks DC"))).toBe(true);
	});

	it("flags impossible activities at fast pace", () => {
		const acts = {p1: [{activity: "map"}]};
		expect(getActivityInteractions(acts, players, {pace: "fast"})).toEqual(expect.arrayContaining([expect.stringContaining("NOT possible")]));
	});
});
