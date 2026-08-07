/**
 * Class-level featProgression feat picks — e.g. the 2024/TGTT Ranger's "Fighting Style"
 * feat granted at level 2 via a class-level `featProgression` entry.
 *
 * Covers `CharacterSheetClassUtils.getClassFeatProgressionGains`, which surfaces the picks
 * that the level-up / builder / quickbuild / respec flows turn into a category-filtered feat
 * picker. Epic Boon (category "EB") is intentionally excluded because it is handled by the
 * dedicated ASI / Epic Boon flow.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

const RANGER_CLASS_DATA = {
	name: "Ranger",
	source: "TGTT",
	featProgression: [
		{name: "Fighting Style", category: ["FS", "FS:R"], progression: {"2": 1}},
		{name: "Epic Boon", category: ["EB"], progression: {"19": 1}},
	],
};

describe("CharacterSheetClassUtils.getClassFeatProgressionGains", () => {
	it("returns [] when the class has no featProgression", () => {
		expect(ClassUtils.getClassFeatProgressionGains({name: "X"}, 1, 2)).toEqual([]);
		expect(ClassUtils.getClassFeatProgressionGains({featProgression: null}, 1, 2)).toEqual([]);
		expect(ClassUtils.getClassFeatProgressionGains(null, 1, 2)).toEqual([]);
	});

	it("surfaces the Fighting Style pick when leveling 1 -> 2", () => {
		const gains = ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 1, 2);
		expect(gains).toEqual([
			{progressionName: "Fighting Style", category: ["FS", "FS:R"], count: 1},
		]);
	});

	it("excludes Epic Boon (category EB) even at level 19", () => {
		const gains = ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 18, 19);
		expect(gains).toEqual([]);
	});

	it("includes a level-2 pick when building straight to level 6 (prevLevel 0)", () => {
		const gains = ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 0, 6);
		expect(gains).toEqual([
			{progressionName: "Fighting Style", category: ["FS", "FS:R"], count: 1},
		]);
	});

	it("does NOT re-prompt when leveling past the grant level (2 -> 3)", () => {
		const gains = ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 2, 3);
		expect(gains).toEqual([]);
	});

	it("does NOT re-prompt when leveling 5 -> 6 (grant was at level 2)", () => {
		const gains = ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 5, 6);
		expect(gains).toEqual([]);
	});

	it("returns [] when newLevel <= prevLevel", () => {
		expect(ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 2, 2)).toEqual([]);
		expect(ClassUtils.getClassFeatProgressionGains(RANGER_CLASS_DATA, 3, 2)).toEqual([]);
	});

	it("sums multiple grant levels within a single range", () => {
		const classData = {
			featProgression: [
				{name: "Fighting Style", category: ["FS"], progression: {"2": 1, "6": 1}},
			],
		};
		expect(ClassUtils.getClassFeatProgressionGains(classData, 0, 6)).toEqual([
			{progressionName: "Fighting Style", category: ["FS"], count: 2},
		]);
		expect(ClassUtils.getClassFeatProgressionGains(classData, 2, 6)).toEqual([
			{progressionName: "Fighting Style", category: ["FS"], count: 1},
		]);
	});

	it("supports array-form progression maps", () => {
		const classData = {
			// index 1 == level 2
			featProgression: [
				{name: "Fighting Style", category: ["FS:R"], progression: [0, 1]},
			],
		};
		expect(ClassUtils.getClassFeatProgressionGains(classData, 1, 2)).toEqual([
			{progressionName: "Fighting Style", category: ["FS:R"], count: 1},
		]);
	});

	it("accepts a selected ability for a class-granted feat choice", () => {
		const resilient = {
			name: "Resilient",
			source: "XPHB",
			ability: [{choose: {from: Parser.ABIL_ABVS, amount: 1}}],
			_featChoices: {ability: "wis"},
		};
		expect(ClassUtils.isFeatChoiceSpecComplete(resilient)).toBe(true);
	});
});

// ===========================================================================
// XPHB Fighter surfaces Fighting Style at level 1 (builder path: prevLevel 0).
// ===========================================================================
describe("getClassFeatProgressionGains — XPHB Fighter L1", () => {
	const FIGHTER_XPHB = {
		name: "Fighter",
		source: "XPHB",
		featProgression: [
			{name: "Fighting Style", category: ["FS"], progression: {"1": 1}},
			{name: "Epic Boon", category: ["EB"], progression: {"19": 1}},
		],
	};

	it("surfaces the Fighting Style pick when building straight to level 1", () => {
		expect(ClassUtils.getClassFeatProgressionGains(FIGHTER_XPHB, 0, 1)).toEqual([
			{progressionName: "Fighting Style", category: ["FS"], count: 1},
		]);
	});

	it("does NOT re-prompt when leveling 1 -> 2", () => {
		expect(ClassUtils.getClassFeatProgressionGains(FIGHTER_XPHB, 1, 2)).toEqual([]);
	});

	it("still excludes the Epic Boon at level 19", () => {
		expect(ClassUtils.getClassFeatProgressionGains(FIGHTER_XPHB, 18, 19)).toEqual([]);
	});
});

// ===========================================================================
// filterFeatsByCategory — the picker pool filter shared by all flows.
// ===========================================================================
describe("filterFeatsByCategory", () => {
	const FEATS = [
		{name: "Archery", source: "XPHB", category: "FS"},
		{name: "Defense", source: "XPHB", category: "FS"},
		{name: "Druidic Warrior", source: "XPHB", category: "FS"},
		{name: "Alert", source: "XPHB", category: "G"},
		{name: "Boon of Combat Prowess", source: "XPHB", category: "EB"},
	];

	it("returns only Fighting Style feats for category FS", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["FS"]).map(f => f.name).sort();
		expect(out).toEqual(["Archery", "Defense", "Druidic Warrior"]);
	});

	it("does not surface General or Epic Boon feats for category FS", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["FS"]).map(f => f.name);
		expect(out).not.toContain("Alert");
		expect(out).not.toContain("Boon of Combat Prowess");
	});
});

// ===========================================================================
// addFeat persists the classFeatProgression provenance tag so the four flows
// can identify, clean up, and respec class-granted feats later.
// ===========================================================================
describe("addFeat — classFeatProgression provenance", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("stores the provenance metadata on the persisted feat", () => {
		state.addClass({name: "Fighter", source: "XPHB", level: 1});
		const added = state.addFeat(
			{name: "Defense", source: "XPHB"},
			{classFeatProgression: {className: "Fighter", classSource: "XPHB", level: 1, progressionName: "Fighting Style"}},
		);
		expect(added).toBeTruthy();
		const feat = state.getFeats().find(f => f.name === "Defense");
		expect(feat).toBeDefined();
		expect(feat.classFeatProgression).toEqual({
			className: "Fighter",
			classSource: "XPHB",
			level: 1,
			progressionName: "Fighting Style",
		});
	});

	it("does not add the provenance tag for an ordinary feat", () => {
		state.addClass({name: "Fighter", source: "XPHB", level: 4});
		state.addFeat({name: "Alert", source: "XPHB"});
		const feat = state.getFeats().find(f => f.name === "Alert");
		expect(feat).toBeDefined();
		expect(feat.classFeatProgression).toBeUndefined();
	});
});
