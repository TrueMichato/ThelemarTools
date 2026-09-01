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
	computeActivityGroupRm,
	sumContainerRm,
	computeEffectiveDc,
	classifyTrackingDegree,
	getSkillBonusFromData,
	getToolProfBonusFromData,
	getActivitySkills,
	computeActivityBonus,
	getActivityInteractions,
} from "../../js/dmscreen/dmscreen-journeytracker-consts.js";
import {JourneyTrackerRoot} from "../../js/dmscreen/dmscreen-journeytracker.js";

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
		expect(s.camp.activityGroupRm).toEqual({});
	});
});

/* -------------------------------------------- */
/*  computeActivityGroupRm (Bug 3 J1 core)       */
/* -------------------------------------------- */

describe("computeActivityGroupRm", () => {
	const hideTracks = findAct(JOURNEY_ACTIVITIES, "hideTracks"); // group: succ -1, crit -2, fail 0, critFail +1
	const scout = findAct(JOURNEY_ACTIVITIES, "scout"); // critSuccessPerPlayer: succ -1, crit -1, critFail +1
	const entertain = findAct(JOURNEY_ACTIVITIES, "entertain"); // rmAlways 1 (handled elsewhere), critFail +2
	const dc = 15;
	const slot = (total, critOverride = null) => ({rollNum: total, total, critOverride});

	it("returns 0 when nobody has rolled yet", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(null), slot(null)]})).toBe(0);
	});

	it("applies a completed 2-player group delta ONCE, not per participant (J1 double-count fix)", () => {
		// Both succeed but not all-pass-crit: one 16 (pass), one 10 (fail) → group success → -1 (single, not -2).
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(16), slot(10)]})).toBe(-1);
	});

	it("treats an all-pass group as a critical success (single -2, not -4)", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(16), slot(18)]})).toBe(-2);
	});

	it("treats an all-fail group as a critical failure", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(9), slot(10)]})).toBe(1);
	});

	it("scales a per-player-crit activity (Scout) by participant count on a full crit success", () => {
		// All pass → critSuccess; scout rmOnCritSuccess -1 × 2 players = -2.
		expect(computeActivityGroupRm({actDef: scout, dc, isTotalMode: true, participantSlots: [slot(16), slot(20)]})).toBe(-2);
	});

	it("does not scale Scout on a mixed (non-crit) group success", () => {
		expect(computeActivityGroupRm({actDef: scout, dc, isTotalMode: true, participantSlots: [slot(16), slot(9)]})).toBe(-1);
	});

	it("falls back to the sum of individual rolled deltas while a group is incomplete", () => {
		// 3-player hideTracks, only two rolled (both success -1) → interim -2.
		const three = [slot(16), slot(17), slot(null)];
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: three})).toBe(-2);
	});

	it("collapses the interim value to a single group delta once everyone has rolled", () => {
		// Same three, now all rolled: two pass + one fail → group success → -1 (was interim -2).
		const three = [slot(16), slot(17), slot(9)];
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: three})).toBe(-1);
	});

	it("uses the single-participant individual delta for a solo activity", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(16)]})).toBe(-1);
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(8)]})).toBe(0);
	});

	it("honors a manual crit override only for single-participant activities in total mode", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc, isTotalMode: true, participantSlots: [slot(16, "critSuccess")]})).toBe(-2);
	});

	it("excludes always-on RM (rmAlways) from the group delta", () => {
		// Entertain success → group delta 0 (its +1 rmAlways is applied separately by reconcile).
		expect(computeActivityGroupRm({actDef: entertain, dc, isTotalMode: true, participantSlots: [slot(16)]})).toBe(0);
	});

	it("returns 0 for a null DC or an activity without skills", () => {
		expect(computeActivityGroupRm({actDef: hideTracks, dc: null, isTotalMode: true, participantSlots: [slot(16)]})).toBe(0);
		expect(computeActivityGroupRm({actDef: findAct(JOURNEY_ACTIVITIES, "custom"), dc, isTotalMode: true, participantSlots: [slot(16)]})).toBe(0);
	});
});

/* -------------------------------------------- */
/*  sumContainerRm (Bug 3 J1 — segment trim)     */
/* -------------------------------------------- */

describe("sumContainerRm", () => {
	it("returns 0 for an empty or missing container", () => {
		expect(sumContainerRm(null)).toBe(0);
		expect(sumContainerRm({})).toBe(0);
	});

	it("sums recorded group RM, stealth RM, and per-slot always-on RM", () => {
		const container = {
			activityGroupRm: {hideTracks: -2, entertain: 0},
			stealthGroupRm: -2,
			activities: {
				p1: [{activity: "entertain", _rmAlwaysApplied: 1}],
				p2: [{activity: "hideTracks", _rmAlwaysApplied: 0}, {activity: "entertain", _rmAlwaysApplied: 1}],
			},
		};
		// groups: -2 + 0; stealth: -2; always: 1 + 0 + 1 = 2 → total -2.
		expect(sumContainerRm(container)).toBe(-2);
	});

	it("ignores non-array activity slots defensively", () => {
		expect(sumContainerRm({activityGroupRm: {scout: -1}, activities: {p1: null}})).toBe(-1);
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

/* -------------------------------------------- */
/*  Stateful RM reconciliation (Bug 3 J1/J2/J3)  */
/*  Exercises JourneyTrackerRoot's DOM-free core */
/* -------------------------------------------- */

describe("JourneyTrackerRoot._reconcileRm", () => {
	const makeRoot = () => {
		const board = {doSaveStateDebounced () {}};
		const root = new JourneyTrackerRoot(board, null);
		root._state.rollMode = "total"; // roll input == effective total; no Party Tracker bonus lookup
		root._state.players = [{id: "p1", name: "A"}, {id: "p2", name: "B"}];
		root._state.journey.segments = [root._makeEmptySegment()];
		return root;
	};
	// hideTracks group outcomes: success -1, crit -2, fail 0, critFail +1 (single group delta).
	const setHideTracks = (seg, roll1, roll2) => {
		seg.activities = {
			p1: [{activity: "hideTracks", rollResult: `${roll1}`, skillChoice: null, _critOverride: null}],
			p2: [{activity: "hideTracks", rollResult: `${roll2}`, skillChoice: null, _critOverride: null}],
		};
	};

	it("applies a completed two-player group delta ONCE, not once per participant (J1)", () => {
		const root = makeRoot();
		// 15 passes DC 10, 5 fails → 1/2 pass → group 'success' → -1 (old bug applied -1 twice = -2).
		setHideTracks(root._state.journey.segments[0], 15, 5);
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-1);
		expect(root._state.journey.segments[0].activityGroupRm.hideTracks).toBe(-1);
	});

	it("is idempotent — a second reconcile does not re-apply the delta", () => {
		const root = makeRoot();
		setHideTracks(root._state.journey.segments[0], 15, 5);
		root._reconcileRm();
		root._reconcileRm();
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-1);
	});

	it("nets the difference when a completed group's outcome later changes (no stale RM)", () => {
		const root = makeRoot();
		const seg = root._state.journey.segments[0];
		setHideTracks(seg, 15, 5); // success -1
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-1);
		// Both now fail → group 'critFail' → +1. Net swing from -1 to +1.
		seg.activities.p1[0].rollResult = "3";
		seg.activities.p2[0].rollResult = "4";
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(1);
		expect(seg.activityGroupRm.hideTracks).toBe(1);
	});

	it("drops a group's RM contribution when the activity is cleared", () => {
		const root = makeRoot();
		const seg = root._state.journey.segments[0];
		setHideTracks(seg, 15, 5);
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-1);
		seg.activities.p1[0].activity = "";
		seg.activities.p2[0].activity = "";
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(0);
		expect(seg.activityGroupRm.hideTracks).toBeUndefined();
	});

	it("rebaseline re-syncs the records WITHOUT changing riskModifier (Reset/Manual/load)", () => {
		const root = makeRoot();
		const seg = root._state.journey.segments[0];
		setHideTracks(seg, 15, 5);
		root._state.riskModifier = 99; // a manual absolute value the DM set
		seg.activityGroupRm.hideTracks = 0; // stale/legacy record
		root._reconcileRm({rebaseline: true});
		expect(root._state.riskModifier).toBe(99); // untouched
		expect(seg.activityGroupRm.hideTracks).toBe(-1); // record corrected to computed target
	});

	it("scales Scout critical success by UNIQUE players, not duplicate slots (J1 dedupe)", () => {
		const root = makeRoot();
		const seg = root._state.journey.segments[0];
		// scout critSuccessPerPlayer crit -1 each. p1 has two scout slots, p2 one — all crit-succeed.
		// Unique players = 2 → -2 (a slot-count bug would give -3).
		seg.activities = {
			p1: [
				{activity: "scout", rollResult: "15", skillChoice: null, _critOverride: null},
				{activity: "scout", rollResult: "16", skillChoice: null, _critOverride: null},
			],
			p2: [{activity: "scout", rollResult: "17", skillChoice: null, _critOverride: null}],
		};
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-2);
	});

	it("nets out a departed player's contribution and prunes their slots (syncPartyCharacters path)", () => {
		const root = makeRoot();
		const seg = root._state.journey.segments[0];
		setHideTracks(seg, 15, 5); // -1 while both present
		root._reconcileRm();
		expect(root._state.riskModifier).toBe(-1);
		root._undoPlayerRm(root._state.players[1]); // player B leaves
		// hideTracks now has a single participant (A, rolled 15 ≥ DC) → individual success -1.
		expect(seg.activities.p2).toBeUndefined();
		expect(root._state.riskModifier).toBe(-1);
	});
});

describe("JourneyTrackerRoot._makeEmptyCamp (Bug 3 J3)", () => {
	it("returns a fully-shaped camp incl. siteDescription + encounterResolved", () => {
		const board = {doSaveStateDebounced () {}};
		const root = new JourneyTrackerRoot(board, null);
		const camp = root._makeEmptyCamp();
		expect(camp).toMatchObject({
			campfireActive: false,
			siteDescription: "",
			activities: {},
			activityGroupRm: {},
			guardSlots: [],
			encounterResolved: false,
		});
		// Fresh (non-shared) references.
		expect(camp.guardSlots).not.toBe(root._makeEmptyCamp().guardSlots);
	});
});

describe("JourneyTrackerRoot._migrateRmBookkeeping (orphan pruning)", () => {
	it("prunes activity + stealth slots for players no longer in the roster", () => {
		const board = {doSaveStateDebounced () {}};
		const root = new JourneyTrackerRoot(board, null);
		root._state.players = [{id: "p1", name: "A"}];
		root._state.journey.segments = [root._makeEmptySegment()];
		const seg = root._state.journey.segments[0];
		seg.activities = {
			p1: [{activity: "forage", rollResult: "", skillChoice: null, _rmAlwaysApplied: 0}],
			pGONE: [{activity: "entertain", rollResult: "", skillChoice: null, _rmAlwaysApplied: 1}],
		};
		seg.stealthSlots = [{playerId: "p1"}, {playerId: "pGONE"}];
		root._migrateRmBookkeeping();
		expect(seg.activities.pGONE).toBeUndefined();
		expect(seg.activities.p1).toBeDefined();
		expect(seg.stealthSlots).toEqual([{playerId: "p1"}]);
	});
});

describe("JourneyTrackerRoot campaign projection persistence", () => {
	it("keeps linked campaign participants and their activity references out of the Board blob", () => {
		const root = new JourneyTrackerRoot({doSaveStateDebounced () {}}, null);
		root._state.players = [
			{id: "manual", name: "Manual", isFromPartyTracker: false, isHubProjection: false},
			{id: "linked", name: "Linked", isFromPartyTracker: true, isHubProjection: true},
		];
		root._state.journey.segments = [root._makeEmptySegment()];
		root._state.journey.segments[0].activities = {
			manual: [{activity: "scout"}],
			linked: [{activity: "forage"}],
		};
		root._state.journey.segments[0].stealthSlots = [
			{playerId: "manual"},
			{playerId: "linked"},
		];
		root._state.camp.activities = {
			manual: [{activity: "guard"}],
			linked: [{activity: "cook"}],
		};
		root._state.camp.guardSlots = [
			{playerId: "manual"},
			{playerId: "linked"},
		];

		const saved = root.getSaveableState();
		expect(saved.players).toEqual([
			{id: "manual", name: "Manual", isFromPartyTracker: false, isHubProjection: false},
		]);
		expect(saved.journey.segments[0].activities).toEqual({manual: [{activity: "scout"}]});
		expect(saved.journey.segments[0].stealthSlots).toEqual([{playerId: "manual"}]);
		expect(saved.camp.activities).toEqual({manual: [{activity: "guard"}]});
		expect(saved.camp.guardSlots).toEqual([{playerId: "manual"}]);
	});

	it("removes stale linked participants when campaign projections become empty", () => {
		const saves = [];
		const root = new JourneyTrackerRoot({
			doSaveStateDebounced: () => saves.push(true),
		}, null);
		root._state.players = [
			{id: "manual", name: "Manual", isFromPartyTracker: false},
			{id: "linked", name: "Linked", isFromPartyTracker: true, isHubProjection: true},
		];
		root._state.camp.guardSlots = [{playerId: "linked", rollResult: "12"}];
		root._getPartyTrackerCharacters = () => [];
		root._updateSyncStatus = () => {};
		root._syncSupplyBurnRates = () => {};
		root._reRenderCurrentTab = () => {};

		root.syncPartyCharacters();

		expect(root._state.players).toEqual([{id: "manual", name: "Manual", isFromPartyTracker: false}]);
		expect(root._state.camp.guardSlots).toEqual([]);
		expect(root.getSaveableState().camp.guardSlots).toEqual([]);
		expect(saves).toHaveLength(0);
	});
});
