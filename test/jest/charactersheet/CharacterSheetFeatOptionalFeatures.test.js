import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-ui.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetState feat optional features", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("adds feat-granted optional feature picks as removable optional features", () => {
		state.addFeat({
			name: "Dreamer",
			source: "TGTT",
			choices: {
				optionalFeaturePicks: [
					{
						name: "Dreambend",
						source: "TGTT",
						featureTypes: ["DW:C"],
						description: "<p>Dreambend description.</p>",
					},
				],
			},
		});

		const feat = state.getFeats().find(it => it.name === "Dreamer");
		expect(feat).toBeTruthy();

		const feature = state.getFeatures().find(it => it.name === "Dreambend");
		expect(feature).toBeTruthy();
		expect(feature.featureType).toBe("Optional Feature");
		expect(feature.optionalFeatureTypes).toEqual(["DW:C"]);
		expect(feature.sourceFeatId).toBe(feat.id);
		expect(feature.sourceFeatName).toBe("Dreamer");

		state.removeFeat("Dreamer", "TGTT");
		expect(state.getFeatures().some(it => it.name === "Dreambend")).toBe(false);
	});

	it("tracks TGTT metamagic picks from feats through known metamagic helpers", () => {
		state.setSetting("enableTgtt", true);

		state.addFeat({
			name: "Metamagic Adept",
			source: "TGTT",
			choices: {
				optionalFeaturePicks: [
					{name: "Quickened Spell", source: "TGTT", featureTypes: ["MM"]},
					{name: "Warding Spell", source: "TGTT", featureTypes: ["MM"]},
				],
			},
		});

		expect(state.getKnownMetamagicKeys()).toEqual(expect.arrayContaining(["quickened", "warding"]));
		expect(state.getFeatures().filter(it => it.optionalFeatureTypes?.includes("MM")).map(it => `${it.name}|${it.source}`)).toEqual(
			expect.arrayContaining(["Quickened Spell|TGTT", "Warding Spell|TGTT"]),
		);
	});

	it("keeps PHB metamagic names out of TGTT known-metamagic keys when TGTT feat support is enabled", () => {
		state.setSetting("enableTgtt", true);

		state.addFeat({
			name: "Metamagic Adept",
			source: "PHB",
			choices: {
				optionalFeaturePicks: [
					{name: "Careful Spell", source: "PHB", featureTypes: ["MM"]},
				],
			},
		});

		expect(state.getFeatures().some(it => it.name === "Careful Spell" && it.source === "PHB")).toBe(true);
		expect(state.getKnownMetamagicKeys()).not.toContain("careful");
	});
});

describe("CharacterSheetClassUtils.filterOptFeaturesForTgttMetamagic", () => {
	const ClassUtils = globalThis.CharacterSheetClassUtils;

	const PHB_QUICKENED = {name: "Quickened Spell", source: "PHB", featureType: ["MM"]};
	const PHB_DISTANT = {name: "Distant Spell", source: "PHB", featureType: ["MM"]};
	const TGTT_QUICKENED = {name: "Quickened Spell", source: "TGTT", featureType: ["MM"]};
	const TGTT_WARDING = {name: "Warding Spell", source: "TGTT", featureType: ["MM"]};
	const PHB_INVOCATION = {name: "Agonizing Blast", source: "PHB", featureType: ["EI"]};
	const TGTT_TRADITION = {name: "Some Combat Method", source: "TGTT", featureType: ["CTM:EE"]};

	const POOL = [PHB_QUICKENED, PHB_DISTANT, TGTT_QUICKENED, TGTT_WARDING, PHB_INVOCATION, TGTT_TRADITION];

	it("strips non-TGTT MM features when enableTgtt is on", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: true});
		const mmEntries = filtered.filter(it => it.featureType?.includes("MM"));
		expect(mmEntries.map(it => `${it.name}|${it.source}`)).toEqual([
			"Quickened Spell|TGTT",
			"Warding Spell|TGTT",
		]);
	});

	it("leaves non-MM optional features untouched when enableTgtt is on", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: true});
		expect(filtered).toContain(PHB_INVOCATION);
		expect(filtered).toContain(TGTT_TRADITION);
	});

	it("returns the input untouched when enableTgtt is off", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: false});
		expect(filtered).toBe(POOL);
	});

	it("handles empty / nullish input", () => {
		expect(ClassUtils.filterOptFeaturesForTgttMetamagic([], {enableTgtt: true})).toEqual([]);
		expect(ClassUtils.filterOptFeaturesForTgttMetamagic(null, {enableTgtt: true})).toBeFalsy();
	});

	it("strips non-TGTT MM features when classSource is TGTT even with enableTgtt off (Bug 6)", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: false, classSource: "TGTT"});
		const mmEntries = filtered.filter(it => it.featureType?.includes("MM"));
		expect(mmEntries.map(it => `${it.name}|${it.source}`)).toEqual([
			"Quickened Spell|TGTT",
			"Warding Spell|TGTT",
		]);
	});

	it("is case-insensitive on classSource", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: false, classSource: "tgtt"});
		const mmEntries = filtered.filter(it => it.featureType?.includes("MM"));
		expect(mmEntries.map(it => it.source)).toEqual(["TGTT", "TGTT"]);
	});

	it("leaves the input untouched when classSource is a non-TGTT source and enableTgtt is off", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {enableTgtt: false, classSource: "PHB"});
		expect(filtered).toBe(POOL);
	});

	it("still filters when classSource is TGTT regardless of nullish/empty enableTgtt opts", () => {
		const filtered = ClassUtils.filterOptFeaturesForTgttMetamagic(POOL, {classSource: "TGTT"});
		const mmEntries = filtered.filter(it => it.featureType?.includes("MM"));
		expect(mmEntries.map(it => it.source)).toEqual(["TGTT", "TGTT"]);
	});
});

describe("CharacterSheetClassUtils.getOptFeatureFeatProgressionPicks (Bug 8)", () => {
	const ClassUtils = globalThis.CharacterSheetClassUtils;

	it("returns empty array for an opt-feature without featProgression", () => {
		expect(ClassUtils.getOptFeatureFeatProgressionPicks({name: "X"}, 1)).toEqual([]);
		expect(ClassUtils.getOptFeatureFeatProgressionPicks({featProgression: null}, 1)).toEqual([]);
	});

	it("returns picks for an opt-feature with `*` progression (e.g. Lessons of the First Ones)", () => {
		const opt = {
			name: "Lessons of the First Ones",
			featProgression: [
				{name: "Origin Feat", category: ["O"], progression: {"*": 1}},
			],
		};
		const picks = ClassUtils.getOptFeatureFeatProgressionPicks(opt, 1);
		expect(picks).toEqual([{progressionName: "Origin Feat", category: ["O"], count: 1}]);

		// _timesKnown=1 means this is the second pick — `*` still applies
		const picks2 = ClassUtils.getOptFeatureFeatProgressionPicks(opt, 2);
		expect(picks2).toEqual([{progressionName: "Origin Feat", category: ["O"], count: 1}]);
	});

	it("respects numeric progression keys over `*` when both are absent for the request", () => {
		const opt = {
			featProgression: [
				{name: "Feat A", category: ["G"], progression: {"1": 1, "3": 2}},
			],
		};
		expect(ClassUtils.getOptFeatureFeatProgressionPicks(opt, 1)).toEqual([
			{progressionName: "Feat A", category: ["G"], count: 1},
		]);
		expect(ClassUtils.getOptFeatureFeatProgressionPicks(opt, 2)).toEqual([]);
		expect(ClassUtils.getOptFeatureFeatProgressionPicks(opt, 3)).toEqual([
			{progressionName: "Feat A", category: ["G"], count: 2},
		]);
	});

	it("prefers `*` over numeric keys when both are present", () => {
		const opt = {
			featProgression: [
				{name: "Feat", category: ["O"], progression: {"*": 1, "1": 2}},
			],
		};
		expect(ClassUtils.getOptFeatureFeatProgressionPicks(opt, 1)).toEqual([
			{progressionName: "Feat", category: ["O"], count: 1},
		]);
	});
});

describe("CharacterSheetClassUtils.filterFeatsByCategory (Bug 8)", () => {
	const ClassUtils = globalThis.CharacterSheetClassUtils;

	const FEATS = [
		{name: "Origin Feat A", category: "O"},
		{name: "General Feat A", category: "G"},
		{name: "Fighting Style (Generic)", category: "FS"},
		{name: "Defense", category: "FS:P"},
		{name: "Epic Boon", category: "EB:foo"},
		{name: "No Category", source: "TGTT"},
	];

	it("returns all feats when categories is empty/null", () => {
		expect(ClassUtils.filterFeatsByCategory(FEATS, [])).toEqual(FEATS);
		expect(ClassUtils.filterFeatsByCategory(FEATS, null)).toEqual(FEATS);
	});

	it("matches exact category", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["O"]);
		expect(out.map(f => f.name)).toEqual(["Origin Feat A"]);
	});

	it("matches subtype: FS includes FS:P (Bug 8 subtype-aware filter)", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["FS"]);
		expect(out.map(f => f.name)).toEqual(expect.arrayContaining(["Fighting Style (Generic)", "Defense"]));
	});

	it("matches multiple categories (union)", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["O", "G"]);
		expect(out.map(f => f.name)).toEqual(expect.arrayContaining(["Origin Feat A", "General Feat A"]));
	});

	it("excludes uncategorized feats from category filters", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["O"]);
		expect(out.some(f => f.name === "No Category")).toBe(false);
	});

	it("matches `EB` subtype via colon prefix", () => {
		const out = ClassUtils.filterFeatsByCategory(FEATS, ["EB"]);
		expect(out.map(f => f.name)).toEqual(["Epic Boon"]);
	});
});

describe("CharacterSheetClassUtils.buildFeatChoicesSpec & isFeatChoiceSpecComplete (Bug 8)", () => {
	const ClassUtils = globalThis.CharacterSheetClassUtils;

	it("returns a defensive empty spec when ctx is missing (no crash)", () => {
		const feat = {name: "X", source: "TGTT", skillProficiencies: [{any: 1}]};
		const spec = ClassUtils.buildFeatChoicesSpec(feat, {});
		expect(spec).toBeTruthy();
		// no crash is the success condition; skill choices may or may not populate without page ctx
	});

	it("isFeatChoiceSpecComplete returns true when no _featChoices needed", () => {
		// Origin feat: categorized → no synthesized General +1 ASI to fill
		const feat = {name: "Plain Feat", source: "TGTT", category: "O"};
		expect(ClassUtils.isFeatChoiceSpecComplete(feat)).toBe(true);
	});

	it("isFeatChoiceSpecComplete returns false when _featChoices has unfilled skill picks", () => {
		const feat = {
			name: "Skill Feat",
			source: "TGTT",
			category: "O",
			skillProficiencies: [{any: 2}],
			_featChoices: {skills: [], languages: [], ability: null, tools: [], expertise: [], spellList: null, cantrips: [], spells: [], scribingClass: null, optionalFeatures: []},
		};
		// Spec requires 2 skills picked; none yet
		expect(ClassUtils.isFeatChoiceSpecComplete(feat, null, {state: new globalThis.CharacterSheetState(), page: {getOptionalFeatures: () => []}})).toBe(false);

		feat._featChoices.skills = ["Athletics", "Acrobatics"];
		expect(ClassUtils.isFeatChoiceSpecComplete(feat, null, {state: new globalThis.CharacterSheetState(), page: {getOptionalFeatures: () => []}})).toBe(true);
	});
});

describe("CharacterSheetState linkedToOptFeature cascade (Bug 8)", () => {
	let state;

	beforeEach(() => {
		state = new globalThis.CharacterSheetState();
	});

	it("removes a feat linked to an optional feature by id when the feature is removed", () => {
		// Simulate a Warlock picking "Lessons of the First Ones" which granted an Origin Feat.
		const optId = "opt-abc-123";
		state.addFeature({
			id: optId,
			name: "Lessons of the First Ones",
			source: "XPHB",
			featureType: "Optional Feature",
		});
		state.addFeat({
			name: "Magic Initiate",
			source: "XPHB",
		}, {linkedToOptFeature: {id: optId, name: "Lessons of the First Ones", source: "XPHB"}});

		expect(state.getFeats().some(f => f.name === "Magic Initiate")).toBe(true);

		state.removeFeature("Lessons of the First Ones", "XPHB");

		expect(state.getFeats().some(f => f.name === "Magic Initiate")).toBe(false);
	});

	it("falls back to name+source match when id is missing (legacy save compatibility)", () => {
		state.addFeature({
			name: "Some Invocation",
			source: "TGTT",
			featureType: "Optional Feature",
		});
		state.addFeat({
			name: "Tough",
			source: "XPHB",
		}, {linkedToOptFeature: {name: "Some Invocation", source: "TGTT"}});

		expect(state.getFeats().some(f => f.name === "Tough")).toBe(true);

		state.removeFeature("Some Invocation", "TGTT");
		expect(state.getFeats().some(f => f.name === "Tough")).toBe(false);
	});
});
