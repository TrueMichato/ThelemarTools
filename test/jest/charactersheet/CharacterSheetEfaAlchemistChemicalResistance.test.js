import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureEffectRegistry = globalThis.FeatureEffectRegistry;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));

const CHEMICAL_MASTERY_UID = "Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA";
const EFA_CHEMICAL_MASTERY = ARTIFICER_DATA.subclassFeature.find(feature =>
	feature.name === "Chemical Mastery"
	&& feature.source === "EFA"
	&& feature.className === "Artificer"
	&& feature.classSource === "EFA"
	&& feature.subclassShortName === "Alchemist"
	&& feature.subclassSource === "EFA"
	&& feature.level === 15,
);
const TCE_CHEMICAL_MASTERY = ARTIFICER_DATA.subclassFeature.find(feature =>
	feature.name === "Chemical Mastery"
	&& feature.source === "TCE"
	&& feature.className === "Artificer"
	&& feature.classSource === "TCE"
	&& feature.subclassShortName === "Alchemist"
	&& feature.subclassSource === "TCE"
	&& feature.level === 15,
);

const copy = value => JSON.parse(JSON.stringify(value));

function classEntry ({
	classSource = "EFA",
	level = 15,
	subclassName = "Alchemist",
	subclassSource = "EFA",
} = {}) {
	return {
		name: "Artificer",
		source: classSource,
		level,
		subclass: subclassName
			? {name: subclassName, shortName: subclassName, source: subclassSource}
			: null,
	};
}

function addFeature (state, feature = EFA_CHEMICAL_MASTERY) {
	state.addFeature({
		...copy(feature),
		featureType: "Subclass Feature",
		isSubclassFeature: true,
	});
	return state.getFeatures().find(it =>
		it.name === feature.name
		&& it.source === feature.source
		&& it.className === feature.className
		&& it.classSource === feature.classSource
		&& it.subclassShortName === feature.subclassShortName
		&& it.subclassSource === feature.subclassSource
		&& it.level === feature.level,
	);
}

function makeState ({
	classSource = "EFA",
	level = 15,
	subclassName = "Alchemist",
	subclassSource = "EFA",
	feature = EFA_CHEMICAL_MASTERY,
} = {}) {
	const state = new CharacterSheetState();
	state.addClass(classEntry({classSource, level, subclassName, subclassSource}));
	const addedFeature = feature ? addFeature(state, feature) : null;
	state.applyClassFeatureEffects();
	return {state, feature: addedFeature};
}

function expectChemicalResistance (state, expected) {
	const defenses = state.getEffectiveDefenses();
	const matcher = expected ? expect.arrayContaining : expect.not.arrayContaining;
	expect(defenses.resistances).toEqual(matcher(["acid", "poison"]));
	expect(defenses.conditionImmunities).toEqual(matcher(["poisoned"]));
}

describe("EFA Alchemist Chemical Resistance", () => {
	test("grants the canonical defenses only for the exact level-15 owner", () => {
		const {state} = makeState();

		expectChemicalResistance(state, true);
		expect(state.getAppliedClassFeatureEffects()).toEqual(expect.arrayContaining([
			"Chemical Mastery|EFA: acid resistance",
			"Chemical Mastery|EFA: poison resistance",
			"Chemical Mastery|EFA: poisoned condition immunity",
		]));
	});

	test("does not grant from a stale level-15 feature when the EFA Artificer is level 14", () => {
		const {state} = makeState({level: 14});

		expectChemicalResistance(state, false);
	});

	test.each([
		["the TCE compatibility subclass", {
			classSource: "EFA",
			subclassSource: "TCE",
			feature: TCE_CHEMICAL_MASTERY,
		}],
		["a non-EFA parent class", {
			classSource: "TCE",
			subclassSource: "EFA",
		}],
		["another EFA subclass", {
			subclassName: "Artillerist",
			subclassSource: "EFA",
		}],
		["forged EFA source on a TCE-owned feature", {
			classSource: "EFA",
			subclassSource: "TCE",
			feature: {...TCE_CHEMICAL_MASTERY, source: "EFA"},
		}],
	])("does not conflate Chemical Mastery with %s", (_label, options) => {
		const {state} = makeState(options);

		expectChemicalResistance(state, false);
		expect(state.getAppliedClassFeatureEffects()).not.toEqual(expect.arrayContaining([
			expect.stringContaining("Chemical Mastery|EFA"),
		]));
	});

	test("keeps TCE lookup separate from the exact EFA registry entry", () => {
		expect(FeatureEffectRegistry.getStoredFeatureEffects(TCE_CHEMICAL_MASTERY)).toEqual([]);
		expect(FeatureEffectRegistry.getStoredFeatureEffects(EFA_CHEMICAL_MASTERY)).toEqual([
			expect.objectContaining({type: "resistance", damageType: "acid", ownerUid: CHEMICAL_MASTERY_UID}),
			expect.objectContaining({type: "resistance", damageType: "poison", ownerUid: CHEMICAL_MASTERY_UID}),
			expect.objectContaining({type: "conditionImmunity", condition: "poisoned", ownerUid: CHEMICAL_MASTERY_UID}),
		]);
	});

	test("round-trips cleanly and remains idempotent across repeated apply and reload", () => {
		const {state} = makeState();
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();
		const exported = state.toJson();

		expect(exported.resistances.filter(it => it === "acid")).toHaveLength(1);
		expect(exported.resistances.filter(it => it === "poison")).toHaveLength(1);
		expect(exported.conditionImmunities.filter(it => it === "poisoned")).toHaveLength(1);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(exported))).not.toBe(false);
		loaded.applyClassFeatureEffects();
		loaded.applyClassFeatureEffects();

		expectChemicalResistance(loaded, true);
		expect(loaded.toJson().resistances.filter(it => it === "acid")).toHaveLength(1);
		expect(loaded.toJson().resistances.filter(it => it === "poison")).toHaveLength(1);
		expect(loaded.toJson().conditionImmunities.filter(it => it === "poisoned")).toHaveLength(1);
		expect(loaded.getClasses()[0]).toEqual(expect.objectContaining(classEntry()));
		expect(loaded.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Chemical Mastery",
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Alchemist",
				subclassSource: "EFA",
				level: 15,
			}),
		]));
	});

	test("reconciles removal, down-level, subclass respec, restoration, and class removal", () => {
		const {state, feature} = makeState();
		expectChemicalResistance(state, true);

		state.removeFeature(feature.id);
		state.applyClassFeatureEffects();
		expectChemicalResistance(state, false);

		addFeature(state);
		state.addClass(classEntry({level: 14}));
		expectChemicalResistance(state, false);

		state.addClass(classEntry({level: 15}));
		expectChemicalResistance(state, true);

		state.setSubclass("Artificer", {name: "Artillerist", shortName: "Artillerist", source: "EFA"});
		expectChemicalResistance(state, false);

		state.setSubclass("Artificer", {name: "Alchemist", shortName: "Alchemist", source: "EFA"});
		expectChemicalResistance(state, true);

		state.setSubclass("Artificer", null);
		expectChemicalResistance(state, false);

		state.setSubclass("Artificer", {name: "Alchemist", shortName: "Alchemist", source: "EFA"});
		expectChemicalResistance(state, true);

		state.removeClass("Artificer", "EFA");
		expectChemicalResistance(state, false);
	});

	test("preserves independent defensive grants whichever source is removed first", () => {
		const {state, feature} = makeState();
		const independentId = state.addCustomAbility({
			name: "Independent Chemical Ward",
			mode: "passive",
			defensiveTraits: {
				resistances: ["acid", "poison"],
				immunities: [],
				vulnerabilities: [],
				conditionImmunities: ["poisoned"],
			},
		});

		state.applyClassFeatureEffects();
		state.removeFeature(feature.id);
		state.applyClassFeatureEffects();
		expectChemicalResistance(state, true);

		const restoredFeature = addFeature(state);
		state.applyClassFeatureEffects();
		state.removeCustomAbility(independentId);
		expectChemicalResistance(state, true);

		state.removeFeature(restoredFeature.id);
		state.applyClassFeatureEffects();
		expectChemicalResistance(state, false);
	});
});
