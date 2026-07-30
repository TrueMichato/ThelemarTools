import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const FEATURES = [
	{
		name: "Favored by the Gods",
		source: "XGE",
		entries: [
			"Starting at 1st level, divine power guards your destiny. If you fail a saving throw or miss with an attack roll, you can roll {@dice 2d4} and add it to the total, possibly changing the outcome. Once you use this feature, you can't use it again until you finish a short or long rest.",
		],
		expected: {max: 1, recharge: "short"},
	},
	{
		name: "Chronal Shift",
		source: "EGW",
		entries: [
			"{@i 2nd-level Chronurgy Magic feature}",
			"You can magically exert limited control over the flow of time around a creature. As a reaction, after you or a creature you can see within 30 feet of you makes an attack roll, an ability check, or a saving throw, you can force the creature to reroll. You make this decision after you see whether the roll succeeds or fails. The target must use the result of the second roll.",
			"You can use this ability twice, and you regain any expended uses when you finish a long rest.",
		],
		expected: {max: 2, recharge: "long"},
	},
	{
		name: "Magical Cunning",
		source: "XPHB",
		entries: [
			"You can perform an esoteric rite for 1 minute. At the end of it, you regain expended Pact Magic spell slots but no more than a number equal to half your maximum (round up). Once you use this feature, you can't do so again until you finish a {@variantrule Long Rest|XPHB}.",
		],
		expected: {max: 1, recharge: "long"},
	},
];

const addEntriesOnlyFeature = (state, feature) => {
	state.addFeature({...feature, description: null});
	return {
		feature: state.getFeatures().find(it => it.name === feature.name),
		resource: state.getResources().find(it => it.name === feature.name),
	};
};

describe("entries-only feature resource fallback", () => {
	it.each(FEATURES)("$name mints the expected linked resource from entries text", ({expected, ...rawFeature}) => {
		const state = new CharacterSheetState();
		const {feature, resource} = addEntriesOnlyFeature(state, rawFeature);

		expect(feature.description).toBeNull();
		expect(feature.uses).toEqual({current: expected.max, ...expected});
		expect(resource).toMatchObject({current: expected.max, ...expected, featureId: feature.id});
	});

	it.each(FEATURES)("$name appears in the canonical Overview and Combat resource set", ({expected, ...rawFeature}) => {
		const state = new CharacterSheetState();
		addEntriesOnlyFeature(state, rawFeature);

		expect(state.getGenericPoolResources()).toEqual(
			expect.arrayContaining([expect.objectContaining({name: rawFeature.name, ...expected})]),
		);
	});

	it("spends a linked use and restores Favored by the Gods on a short rest", () => {
		const state = new CharacterSheetState();
		const {feature, resource} = addEntriesOnlyFeature(state, FEATURES[0]);

		state.setResourceCurrent(resource.id, 0);
		expect(resource.current).toBe(0);
		expect(feature.uses.current).toBe(0);

		state.onShortRest();
		expect(resource.current).toBe(1);
		expect(feature.uses.current).toBe(1);
	});

	it.each(FEATURES.slice(1))("$name waits for a long rest before recovering", ({expected, ...rawFeature}) => {
		const state = new CharacterSheetState();
		const {feature, resource} = addEntriesOnlyFeature(state, rawFeature);

		state.setResourceCurrent(resource.id, 0);
		state.onShortRest();
		expect(resource.current).toBe(0);
		expect(feature.uses.current).toBe(0);

		state.onLongRest();
		expect(resource.current).toBe(expected.max);
		expect(feature.uses.current).toBe(expected.max);
	});

	it("does not mint a resource for a passive entries-only feature", () => {
		const state = new CharacterSheetState();
		const {feature, resource} = addEntriesOnlyFeature(state, {
			name: "Timeless Scholar",
			source: "TST",
			entries: ["You have advantage on Intelligence checks made to recall historical lore."],
		});

		expect(feature.uses).toBeUndefined();
		expect(resource).toBeUndefined();
	});
});
