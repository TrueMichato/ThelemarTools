import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("CharacterSheetQuickBuild _applyQuickBuild", () => {
	test("does not throw when there are no analyzed levels", async () => {
		const originalUpdateRacialSpells = CharacterSheetClassUtils.updateRacialSpells;
		CharacterSheetClassUtils.updateRacialSpells = jest.fn();

		const state = {
			getAbilityMod: jest.fn(() => 2),
			setWeaponMasteries: jest.fn(),
			setCombatTraditions: jest.fn(),
			getCombatTraditions: jest.fn(() => []),
			getWeaponMasteries: jest.fn(() => []),
			recordLevelChoice: jest.fn(),
			updateLevelChoice: jest.fn(() => true),
			addSpell: jest.fn(),
			addCantrip: jest.fn(),
			ensureXpMatchesLevel: jest.fn(),
			applyClassFeatureEffects: jest.fn(),
			calculateSpellSlots: jest.fn(),
			recalculateAllCompanions: jest.fn(),
			recalculateHp: jest.fn(),
		};

		const page = {
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
			_updateTabVisibility: jest.fn(),
		};

		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = state;
		qb._page = page;
		qb._levelAnalysis = [];
		qb._classAllocations = [];
		qb._targetLevel = 1;
		qb._fromLevel = 1;
		qb._selections = {
			subclasses: {},
			asi: {},
			optionalFeatures: {},
			featureOptions: {},
			expertise: {},
			languages: {},
			scholarSkill: null,
			spellbookSpells: [],
			knownSpells: [],
			knownCantrips: [],
			hpMethod: "average",
			hpRolls: {},
			weaponMasteries: [],
			_combatTraditions: [],
		};

		globalThis.JqueryUtil = {
			doToast: jest.fn(),
		};

		await expect(qb._applyQuickBuild()).resolves.toBeUndefined();
		expect(state.recordLevelChoice).not.toHaveBeenCalled();
		expect(page.saveCharacter).toHaveBeenCalled();

		CharacterSheetClassUtils.updateRacialSpells = originalUpdateRacialSpells;
	});

	test("builds spells step after resetting selections for builder quickbuild sorcerers", () => {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {
			getClasses: jest.fn(() => []),
		};
		qb._page = {};
		qb._classAllocations = [{
			className: "Sorcerer",
			classSource: "TGTT",
		}];
		qb._getWeaponMasteryGains = jest.fn(() => ({newSlots: 0}));
		qb._getSubclassForClass = jest.fn(() => null);
		qb._analyzeLevels = jest.fn(() => [{
			className: "Sorcerer",
			classSource: "TGTT",
			classData: {
				name: "Sorcerer",
				source: "TGTT",
				spellcastingAbility: "cha",
				casterProgression: "full",
			},
			needsSubclass: false,
			hasAsi: false,
			optionalFeatureGains: [],
			featureOptions: [],
			expertiseGrants: [],
			languageGrants: [],
			isScholarLevel: false,
			isSpellbookLevel: false,
			isKnownCaster: true,
			knownSpellsGainAtLevel: 1,
			knownCantripsGainAtLevel: 1,
			knownMaxSpellLevel: 1,
			isPreparedCaster: false,
			preparedSpellsGainAtLevel: 0,
			preparedCantripsGainAtLevel: 0,
			preparedMaxSpellLevel: 0,
		}]);

		qb._resetSelections();

		expect(qb._selections.subclassChoices).toEqual({});
		expect(() => qb._buildWizardSteps()).not.toThrow();
		expect(qb._steps.some(step => step.id === "spells")).toBe(true);
	});

	test("showFromBuilder seeds builder subclass state before rendering the wizard", async () => {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		const subclass = {name: "Divine Soul", source: "TGTT"};

		qb._state = {
			getClasses: jest.fn(() => []),
		};
		qb._showWizard = jest.fn(async () => {});

		await qb.showFromBuilder({
			classData: {name: "Sorcerer", source: "TGTT"},
			targetLevel: 3,
			subclass,
			subclassChoice: "Good",
		});

		expect(qb._classAllocations).toHaveLength(1);
		expect(qb._classAllocations[0].subclass).toEqual(subclass);
		expect(qb._selections.subclasses).toEqual({
			Sorcerer_TGTT: subclass,
		});
		expect(qb._selections.subclassChoices).toEqual({
			Sorcerer_TGTT: {key: "good", name: "Good"},
		});
		expect(qb._showWizard).toHaveBeenCalled();
	});
});
