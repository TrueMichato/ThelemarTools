import {readFileSync} from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const official = JSON.parse(readFileSync(new URL("../../../data/class/class-barbarian.json", import.meta.url), "utf8"));
const brew = JSON.parse(readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url), "utf8"));
const xphb = official.class.find(cls => cls.name === "Barbarian" && cls.source === "XPHB");
const tgtt = brew.class.find(cls => cls.name === "Barbarian" && cls.source === "TGTT");
const phb = official.class.find(cls => cls.name === "Barbarian" && cls.source === "PHB");
const registry = official.classFeature;

const getLevelFeatures = (cls, level) => CharacterSheetClassUtils.getLevelFeatures(cls, level, null, registry, []);
const getBrutalFeature = (cls, level) => getLevelFeatures(cls, level)
	.find(feature => feature.name === (level === 9 ? "Brutal Strike" : "Improved Brutal Strike"));
const buildFeature = (cls, level) => CharacterSheetClassUtils.buildFeatureStateObject(getBrutalFeature(cls, level), {
	className: "Barbarian",
	classSource: cls.source,
	level,
});
const getUpgrades = state => state.getFeatures().filter(feature => feature.name === "Improved Brutal Strike");

describe("canonical 2024 Barbarian Brutal Strike feature identities", () => {
	test.each([["XPHB", xphb], ["TGTT", tgtt]])("%s keeps the level-17 improvement distinct from level 13", (source, cls) => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source, level: 17});
		state.addFeature(buildFeature(cls, 13));
		const level17 = getBrutalFeature(cls, 17);
		expect(level17).toMatchObject({name: "Improved Brutal Strike", source: "XPHB", classSource: "XPHB", level: 17});

		const additions = CharacterSheetClassUtils.dedupAndBuildFeatures(
			getLevelFeatures(cls, 17),
			state.getFeatures().filter(feature => feature.className === "Barbarian").map(feature => feature.name.toLowerCase()),
			{className: "Barbarian", classSource: cls.source, level: 17},
		);
		expect(additions).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Improved Brutal Strike", source: "XPHB", classSource: "XPHB", level: 17}),
		]));
		additions.forEach(feature => state.addFeature(feature));
		expect(getUpgrades(state).map(feature => feature.level).sort()).toEqual([13, 17]);
		expect(getUpgrades(state).find(feature => feature.level === 17).description).toContain("two different");
		expect(CharacterSheetClassUtils.mergeEquivalentFeaturesForDisplay(state.getFeatures())
			.filter(feature => feature.name === "Improved Brutal Strike")).toHaveLength(2);
	});

	test.each([["XPHB", xphb], ["TGTT", tgtt]])("%s backfills missing level 17 on load without duplication", (source, cls) => {
		const original = new CharacterSheetState();
		original.addClass({name: "Barbarian", source, level: 17});
		original.addFeature(buildFeature(cls, 13));
		const restored = new CharacterSheetState();
		restored.loadFromJson(original.toJson());
		const options = {
			getClassData: (name, classSource) => name === "Barbarian" && classSource === source ? cls : null,
			classFeatures: registry,
		};
		expect(CharacterSheetClassUtils.reconcileClassFeatures(restored, options).added).toBeGreaterThan(0);
		expect(getUpgrades(restored).map(feature => feature.level).sort()).toEqual([13, 17]);
		expect(CharacterSheetClassUtils.reconcileClassFeatures(restored, options).added).toBe(0);
		expect(getUpgrades(restored)).toHaveLength(2);
	});

	test.each([["XPHB", xphb], ["TGTT", tgtt]])("%s Level Up applies the 17 upgrade after the 13 upgrade", async (source, cls) => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source, level: 16});
		state.addFeature(buildFeature(cls, 13));
		const levelUp = Object.create(CharacterSheetLevelUp.prototype);
		levelUp._state = state;
		levelUp._page = {
			getClassFeatures: () => registry,
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSpells: () => [],
			getFilteredSpellData: () => [],
			filterByAllowedSources: values => values,
			processPendingFeatureChoices: async () => {},
			_spells: {processPendingSpellChoices: async () => {}},
			saveCharacter: async () => {},
			renderCharacter: () => {},
			_updateTabVisibility: () => {},
			showDiceResult: () => {},
		};
		levelUp._selectedFeatureSkillChoices = {};
		levelUp._processFeatSpellChoices = async () => {};
		await levelUp._applyLevelUp({
			classEntry: state.getClasses()[0],
			newLevel: 17,
			asiChoices: {},
			selectedFeat: null,
			selectedSubclass: null,
			selectedSubclassChoice: null,
			selectedOptionalFeatures: {},
			selectedCombatTraditions: null,
			selectedWeaponMasteries: null,
			selectedFeatureOptions: {},
			selectedClassFeatProgression: [],
			selectedExpertise: {},
			selectedLanguages: {},
			languageGrants: [],
			forkedTongueLevelUpPick: null,
			selectedScholarSkill: null,
			selectedSpellbookSpells: [],
			selectedSpellMasterySpells: [],
			selectedSignatureSpells: [],
			selectedKnownSpells: [],
			selectedKnownCantrips: [],
			selectedPreparedSpells: [],
			selectedPreparedCantrips: [],
			stagedSpellSwap: null,
			newFeatures: getLevelFeatures(cls, 17),
			hpMethod: "average",
			classData: cls,
		});
		expect(getUpgrades(state).map(feature => feature.level).sort()).toEqual([13, 17]);
	});

	test.each([["XPHB", xphb], ["TGTT", tgtt]])("%s Quick Build applies the 17 upgrade after the 13 upgrade", async (source, cls) => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source, level: 16});
		state.addFeature(buildFeature(cls, 13));
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = state;
		qb._page = {
			saveCharacter: async () => {},
			renderCharacter: () => {},
			_updateTabVisibility: () => {},
		};
		qb._classAllocations = [];
		qb._fromLevel = 16;
		qb._targetLevel = 17;
		qb._resetSelections();
		qb._levelAnalysis = [{
			characterLevel: 17,
			className: "Barbarian",
			classSource: source,
			classLevel: 17,
			classData: cls,
			features: getLevelFeatures(cls, 17),
			needsSubclass: false,
			hasAsi: false,
			optionalFeatureGains: [],
			featureOptions: [],
			expertiseGrants: [],
			languageGrants: [],
		}];
		qb._getQuickBuildFeatSelectionIssues = () => [];
		await qb._applyQuickBuild();
		expect(getUpgrades(state).map(feature => feature.level).sort()).toEqual([13, 17]);
	});

	test.each([["XPHB", xphb], ["TGTT", tgtt]])("%s shows the three canonical features but no phantom active state", (source, cls) => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source, level: 17});
		for (const level of [9, 13, 17]) state.addFeature(buildFeature(cls, level));
		const names = state.getActivatableFeatures().map(entry => entry.feature.name);
		for (const level of [9, 13, 17]) expect(CharacterSheetState.detectActivatableFeature(buildFeature(cls, level))).toBeNull();
		expect(names).not.toContain("Brutal Strike");
		expect(names).not.toContain("Improved Brutal Strike");
	});

	test("PHB Brutal Critical and unrelated repeated-name wrappers retain their previous behavior", () => {
		expect(getLevelFeatures(phb, 17).some(feature => feature.name === "Improved Brutal Strike")).toBe(false);
		expect(getLevelFeatures(phb, 17).some(feature => feature.name === "Brutal Critical (3 dice)")).toBe(true);
		const repeated = CharacterSheetClassUtils.dedupAndBuildFeatures(
			[{name: "Metamagic", source: "XPHB", level: 10}],
			["metamagic"],
			{className: "Sorcerer", classSource: "XPHB", level: 10},
		);
		expect(repeated).toEqual([]);
	});
});
