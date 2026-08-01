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

const getOldSave = (features, resources = []) => ({
	...new CharacterSheetState().toJson(),
	features,
	resources,
});

const getOldEntriesOnlyFeatures = () => FEATURES.map(({expected, ...feature}, ix) => ({
	id: `old-feature-${ix}`,
	...feature,
	description: null,
	featureType: "Class",
}));

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

describe("entries-only feature resource save migration", () => {
	it("mints all missing resources from an old save and exposes the canonical Overview and Combat set", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(getOldSave(getOldEntriesOnlyFeatures()));

		for (const {name, expected} of FEATURES) {
			const feature = state.getFeatures().find(it => it.name === name);
			const resource = state.getGenericPoolResources().find(it => it.name === name);
			expect(feature.description).toBeNull();
			expect(feature.uses).toEqual({current: expected.max, ...expected});
			expect(resource).toMatchObject({current: expected.max, ...expected, featureId: feature.id});
		}
	});

	it("preserves a spent Chronal Shift feature and linked resource across repeated loads", () => {
		const {expected, ...chronalShift} = FEATURES[1];
		const feature = {
			id: "old-chronal-shift",
			...chronalShift,
			description: null,
			featureType: "Class",
			uses: {current: 1, ...expected},
		};
		const resource = {
			id: "old-chronal-shift-resource",
			name: chronalShift.name,
			current: 1,
			...expected,
			featureId: feature.id,
		};
		const oldSave = getOldSave([feature], [resource]);
		const state = new CharacterSheetState();

		state.loadFromJson(oldSave);
		state.loadFromJson(oldSave);

		expect(state.getFeature(chronalShift.name).uses).toEqual({current: 1, ...expected});
		expect(state.getResources().filter(it => it.name === chronalShift.name)).toEqual([
			expect.objectContaining({current: 1, ...expected, featureId: feature.id}),
		]);
	});

	it("does not double-add migrated resources when the same old save is loaded twice", () => {
		const oldSave = getOldSave(getOldEntriesOnlyFeatures());
		const state = new CharacterSheetState();

		state.loadFromJson(oldSave);
		state.loadFromJson(oldSave);

		for (const {name} of FEATURES) {
			expect(state.getResources().filter(it => it.name === name)).toHaveLength(1);
		}
		expect(state.getResources()).toHaveLength(FEATURES.length);
	});

	it("does not double-add resources after the migrated character is saved and reloaded", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(getOldSave(getOldEntriesOnlyFeatures()));

		state.loadFromJson(state.toJson());

		for (const {name} of FEATURES) {
			expect(state.getResources().filter(it => it.name === name)).toHaveLength(1);
		}
		expect(state.getResources()).toHaveLength(FEATURES.length);
	});
});

// ==========================================================================
// (R47) A limited-use feature with a POPULATED description is classified as an
// activatable ability (the real saved shape — Chronurgy's Chronal Shift, a Divine
// Soul's Favored by the Gods, a 2024 Warlock's Magical Cunning all carry rendered
// description HTML mentioning "as a reaction" / "once you use this feature"). The
// earlier fallback fixtures used `description: null`, which does NOT trip the
// ability classifier, so they never reproduced the in-browser bug where these
// pools vanished from BOTH the Overview and Combat resource trackers. These tests
// pin the real scenario: a classified ability MUST still surface in the pool.
// ==========================================================================
describe("classified limited-use abilities surface in the generic resource pool", () => {
	const REAL = [
		{
			name: "Chronal Shift",
			source: "EGW",
			description: "<p>As a reaction, after you or a creature you can see within 30 feet of you makes an attack roll, an ability check, or a saving throw, you can force the creature to reroll. You can use this ability twice, and you regain any expended uses when you finish a long rest.</p>",
			expected: {max: 2, recharge: "long"},
		},
		{
			name: "Favored by the Gods",
			source: "XGE",
			description: "<p>If you fail a saving throw or miss with an attack roll, you can roll 2d4 and add it to the total. Once you use this feature, you can't use it again until you finish a short or long rest.</p>",
			expected: {max: 1, recharge: "short"},
		},
	];

	it.each(REAL)("$name is classified as an ability AND kept in getGenericPoolResources()", ({expected, ...rawFeature}) => {
		const state = new CharacterSheetState();
		state.addFeature({...rawFeature});
		const feature = state.getFeatures().find(it => it.name === rawFeature.name);

		// Self-validate: this is the real ability-classified path, not the description:null path.
		const info = CharacterSheetState.detectActivatableFeature(feature);
		expect(CharacterSheetState.isActivatableAbilityEntry({feature, activationInfo: info, interactionMode: info?.interactionMode})).toBe(true);

		expect(state.getGenericPoolResources()).toEqual(
			expect.arrayContaining([expect.objectContaining({name: rawFeature.name, featureId: feature.id})]),
		);
	});

	it("spending the pool row stays in sync with the linked feature uses (no drift)", () => {
		const state = new CharacterSheetState();
		state.addFeature({...REAL[0]});
		const feature = state.getFeatures().find(it => it.name === "Chronal Shift");
		const resource = state.getResources().find(it => it.name === "Chronal Shift");

		// Spend from the resource-tracker side.
		state.setResourceCurrent(resource.id, resource.current - 1);
		expect(state.getFeature("Chronal Shift").uses.current).toBe(1);
		expect(state.getGenericPoolResources().find(r => r.name === "Chronal Shift").current).toBe(1);

		// Spend from the feature-card (Features-tab) side.
		state.setFeatureUses(feature.id, 0);
		expect(state.getResources().find(r => r.id === resource.id).current).toBe(0);
		expect(state.getGenericPoolResources().find(r => r.name === "Chronal Shift").current).toBe(0);
	});
});
