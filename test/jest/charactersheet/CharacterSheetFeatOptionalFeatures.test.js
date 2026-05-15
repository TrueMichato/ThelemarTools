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
});
