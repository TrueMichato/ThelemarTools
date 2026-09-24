import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

describe("CS-BUG-017 recurring feature-choice respec", () => {
	test("replaces only the selected acquisition-level instance and updates replayData", async () => {
		const state = new CharacterSheetState();
		state._data.classes = [{name: "Paladin", source: "TGTT", level: 5}];
		state._data.features = [
			{id: "early", name: "Divine Sentinel", source: "TGTT", className: "Paladin", classSource: "TGTT", level: 3, acquisitionLevel: 3, isFeatureOption: true, parentFeature: "Specialties"},
			{id: "later", name: "Divine Sentinel", source: "TGTT", className: "Paladin", classSource: "TGTT", level: 5, acquisitionLevel: 5, definitionLevel: 3, isFeatureOption: true, parentFeature: "Specialties"},
		];
		state.recordLevelChoice({
			level: 5,
			class: {name: "Paladin", source: "TGTT"},
			classLevel: 5,
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
			complete: true,
		});
		const history = state.getLevelHistoryEntry(5);
		const classFeatures = [{
			name: "Mounted Warden",
			source: "TGTT",
			className: "Paladin",
			level: 3,
			entries: ["Mounted rules."],
		}];
		state.setClassFeatureCatalog(classFeatures, [], []);
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

		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "early", name: "Divine Sentinel", acquisitionLevel: 3}),
			expect.objectContaining({
				name: "Mounted Warden",
				level: 5,
				definitionLevel: 3,
				acquisitionLevel: 5,
			}),
		]));
		expect(state.getFeatures()).not.toEqual(expect.arrayContaining([
			expect.objectContaining({id: "later"}),
		]));
		expect(state.getChosenSubfeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				parent: "Specialties",
				name: "Mounted Warden",
				level: 5,
			}),
		]));
		expect(state.getLevelHistoryEntry(5).choices).toEqual(expect.objectContaining({
			featureChoices: [expect.objectContaining({choice: "Mounted Warden", acquisitionLevel: 5})],
			replayData: expect.objectContaining({
				featureChoices: [expect.objectContaining({
					name: "Mounted Warden",
					acquisitionLevel: 5,
				})],
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

		test("a manifest-owned skipped slot is editable even without a legacy history row", () => {
			const decision = {
				id: "jester-act-5",
				type: "optionalFeatures",
				label: "Jester's Acts",
				characterLevel: 5,
				sourceKey: "JA|Jester's Acts|TGTT",
				count: 1,
				selection: null,
				status: "missing",
			};
			const respec = makeRespec();
			respec._engine = {manifest: {decisions: [decision]}};
			const history = {
				level: 5,
				class: {name: "Bard", source: "TGTT"},
				choices: {},
			};

			const editable = respec._getEditableChoices(5, history);

			expect(editable).toEqual([
				expect.objectContaining({
					type: "optionalFeatures",
					label: "Jester's Acts",
					current: "Not selected",
					featureTypeKey: "JA",
					count: 1,
					decision,
				}),
			]);
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
