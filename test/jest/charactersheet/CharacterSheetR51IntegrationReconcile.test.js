import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-ui.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("R51 S3xS5 reconciliation — Metamagic Adept single addFeat", () => {
	it("grants +2 sorcery points AND lands 2 metamagic picks in one addFeat, and removeFeat cleans both", () => {
		const state = new CharacterSheetState();
		state.setSetting("enableTgtt", true);
		state.addClass({name: "Sorcerer", source: "PHB", level: 5}); // base 5 sorcery points

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

		// S3: +2 sorcery points on top of the base-5 class pool
		expect(state.getFeatureCalculations().sorceryPoints).toBe(7);
		expect(state.getSorceryPoints()).toEqual({current: 7, max: 7});

		// S5: both metamagic optional-feature picks materialised through addFeature
		const mmFeatures = state.getFeatures()
			.filter(it => it.optionalFeatureTypes?.includes("MM"))
			.map(it => `${it.name}|${it.source}`);
		expect(mmFeatures).toEqual(expect.arrayContaining(["Quickened Spell|TGTT", "Warding Spell|TGTT"]));
		expect(state.getKnownMetamagicKeys()).toEqual(expect.arrayContaining(["quickened", "warding"]));

		// Spend interacts cleanly with the merged pool
		expect(state.useSorceryPoint(3)).toBe(true);
		expect(state.getSorceryPoints()).toEqual({current: 4, max: 7});

		// removeFeat unwinds BOTH the +2 capacity (no refund of spent) and the metamagic features
		state.removeFeat("Metamagic Adept", "TGTT");
		expect(state.getFeatureCalculations().sorceryPoints).toBe(5);
		expect(state.getSorceryPoints()).toEqual({current: 2, max: 5});
		expect(state.getFeatures().some(it => it.optionalFeatureTypes?.includes("MM"))).toBe(false);
		expect(state.getKnownMetamagicKeys()).not.toEqual(expect.arrayContaining(["quickened", "warding"]));
	});
});
