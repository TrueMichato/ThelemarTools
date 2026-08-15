import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;

describe("CS-BUG-017 recurring feature-choice respec", () => {
	test("replaces only the selected acquisition-level instance and updates replayData", async () => {
		const features = [
			{id: "early", name: "Divine Sentinel", source: "TGTT", className: "Paladin", level: 3, isFeatureOption: true, parentFeature: "Specialties"},
			{id: "later", name: "Divine Sentinel", source: "TGTT", className: "Paladin", level: 5, isFeatureOption: true, parentFeature: "Specialties"},
		];
		const history = {
			level: 5,
			class: {name: "Paladin", source: "TGTT"},
			choices: {
				featureChoices: [{
					featureName: "Specialties",
					choice: "Divine Sentinel",
					source: "TGTT",
					acquisitionLevel: 5,
					ref: "Divine Sentinel|Paladin|TGTT|3",
				}],
				replayData: {featureChoices: [{
					name: "Divine Sentinel",
					source: "TGTT",
					type: "classFeature",
					parentFeature: "Specialties",
					acquisitionLevel: 5,
					definitionLevel: 3,
				}]},
			},
		};
		const state = {
			getFeatures: jest.fn(() => features),
			getLevelHistory: jest.fn(() => [
				{level: 1, class: history.class},
				{level: 2, class: history.class},
				{level: 3, class: history.class},
				{level: 4, class: history.class},
				history,
			]),
			removeFeature: jest.fn(),
			removeModifiersByName: jest.fn(),
			addFeature: jest.fn(),
			addNamedModifier: jest.fn(),
			updateLevelChoice: jest.fn(),
			applyClassFeatureEffects: jest.fn(),
			calculateSpellSlots: jest.fn(),
		};
		const classFeatures = [{
			name: "Mounted Warden",
			source: "TGTT",
			className: "Paladin",
			level: 3,
			entries: ["Mounted rules."],
		}];
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = state;
		respec._page = {
			getClassFeatures: () => classFeatures,
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
		};
		respec._recalcHpPreservingHealing = jest.fn();

		await respec._applyFeatureChoiceChange(5, history, 0, history.choices.featureChoices[0], {
			name: "Mounted Warden",
			source: "TGTT",
			className: "Paladin",
			level: 3,
			type: "classFeature",
			ref: "Mounted Warden|Paladin|TGTT|3",
		});

		expect(state.removeFeature).toHaveBeenCalledWith("later");
		expect(state.removeFeature).not.toHaveBeenCalledWith("early");
		expect(state.addFeature).toHaveBeenCalledWith(expect.objectContaining({
			name: "Mounted Warden",
			level: 5,
			definitionLevel: 3,
			acquisitionLevel: 5,
		}));
		expect(state.updateLevelChoice).toHaveBeenCalledWith(5, expect.objectContaining({
			featureChoices: [expect.objectContaining({choice: "Mounted Warden", acquisitionLevel: 5})],
			replayData: expect.objectContaining({
				featureChoices: [expect.objectContaining({name: "Mounted Warden", acquisitionLevel: 5})],
			}),
		}));
	});
});

describe("CharacterSheetRespec optional features", () => {
	/** Create a minimal respec instance with mocked dependencies */
	function makeRespec (overrides = {}) {
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = overrides.state || {
			getFeatures: () => [],
			getLevelHistory: () => [],
		};
		respec._page = overrides.page || {
			getOptionalFeatures: () => [],
			getClassFeatures: () => [],
			getClasses: () => [],
			filterByAllowedSources: (arr) => arr,
		};
		respec._$timeline = null;
		respec._$legacyBadge = null;
		return respec;
	}

	describe("_getEditableChoices includes optionalFeatures", () => {
		test("metamagic choices appear as editable", () => {
			const respec = makeRespec();
			const history = {
				level: 3,
				class: {name: "Sorcerer", source: "PHB"},
				choices: {
					optionalFeatures: [
						{name: "Quickened Spell", source: "PHB", type: "MM"},
						{name: "Twinned Spell", source: "PHB", type: "MM"},
					],
				},
			};

			const editable = respec._getEditableChoices(3, history);

			const optEdit = editable.find(e => e.type === "optionalFeatures");
			expect(optEdit).toBeDefined();
			expect(optEdit.label).toBe("Metamagic Options");
			expect(optEdit.current).toBe("Quickened Spell, Twinned Spell");
			expect(optEdit.featureTypeKey).toBe("MM");
			expect(optEdit.count).toBe(2);
		});

		test("eldritch invocations appear as editable", () => {
			const respec = makeRespec();
			const history = {
				level: 2,
				class: {name: "Warlock", source: "PHB"},
				choices: {
					optionalFeatures: [
						{name: "Agonizing Blast", source: "PHB", type: "EI"},
						{name: "Repelling Blast", source: "PHB", type: "EI"},
					],
				},
			};

			const editable = respec._getEditableChoices(2, history);

			const optEdit = editable.find(e => e.type === "optionalFeatures");
			expect(optEdit).toBeDefined();
			expect(optEdit.label).toBe("Eldritch Invocations");
			expect(optEdit.featureTypeKey).toBe("EI");
			expect(optEdit.count).toBe(2);
		});

		test("multiple feature types at same level produce separate entries", () => {
			const respec = makeRespec();
			const history = {
				level: 5,
				class: {name: "TestClass", source: "HB"},
				choices: {
					optionalFeatures: [
						{name: "Quickened Spell", source: "PHB", type: "MM"},
						{name: "Agonizing Blast", source: "PHB", type: "EI"},
					],
				},
			};

			const editable = respec._getEditableChoices(5, history);

			const optEdits = editable.filter(e => e.type === "optionalFeatures");
			expect(optEdits).toHaveLength(2);
			const mmEdit = optEdits.find(e => e.featureTypeKey === "MM");
			const eiEdit = optEdits.find(e => e.featureTypeKey === "EI");
			expect(mmEdit.label).toBe("Metamagic Options");
			expect(eiEdit.label).toBe("Eldritch Invocations");
		});

		test("empty optionalFeatures does not add editable entry", () => {
			const respec = makeRespec();
			const history = {
				level: 3,
				class: {name: "Sorcerer", source: "PHB"},
				choices: {
					optionalFeatures: [],
				},
			};

			const editable = respec._getEditableChoices(3, history);
			expect(editable.find(e => e.type === "optionalFeatures")).toBeUndefined();
		});

		test("no optionalFeatures key does not add editable entry", () => {
			const respec = makeRespec();
			const history = {
				level: 3,
				class: {name: "Sorcerer", source: "PHB"},
				choices: {},
			};

			const editable = respec._getEditableChoices(3, history);
			expect(editable.find(e => e.type === "optionalFeatures")).toBeUndefined();
		});

		test("optional features coexist with ASI and feat choices", () => {
			const respec = makeRespec();
			const history = {
				level: 4,
				class: {name: "Sorcerer", source: "PHB"},
				choices: {
					asi: {cha: 2},
					feat: {name: "War Caster", source: "PHB"},
					optionalFeatures: [
						{name: "Careful Spell", source: "PHB", type: "MM"},
					],
				},
			};

			const editable = respec._getEditableChoices(4, history);
			expect(editable.find(e => e.type === "asi")).toBeDefined();
			expect(editable.find(e => e.type === "feat")).toBeDefined();
			expect(editable.find(e => e.type === "optionalFeatures")).toBeDefined();
		});
	});

	describe("_getOptionalFeatureTypeLabel", () => {
		test("returns correct label for known types", () => {
			expect(CharacterSheetRespec._getOptionalFeatureTypeLabel("MM")).toBe("Metamagic Options");
			expect(CharacterSheetRespec._getOptionalFeatureTypeLabel("EI")).toBe("Eldritch Invocations");
			expect(CharacterSheetRespec._getOptionalFeatureTypeLabel("PB")).toBe("Pact Boons");
		});

		test("returns fallback for unknown types", () => {
			expect(CharacterSheetRespec._getOptionalFeatureTypeLabel("ZZ")).toBe("Optional Features (ZZ)");
		});
	});
});
