import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetModal = globalThis.CharacterSheetModal;
const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetQuickBuild _applyQuickBuild", () => {
	test("does not throw when there are no analyzed levels", async () => {
		const originalUpdateRacialSpells = CharacterSheetClassUtils.updateRacialSpells;
		CharacterSheetClassUtils.updateRacialSpells = jest.fn();

		const state = {
			getAbilityMod: jest.fn(() => 2),
			setWeaponMasteries: jest.fn(),
			setCombatTraditions: jest.fn(),
			mergeCombatTraditions: jest.fn(),
			getCombatTraditions: jest.fn(() => []),
			getWeaponMasteries: jest.fn(() => []),
			recordLevelChoice: jest.fn(),
			updateLevelChoice: jest.fn(() => true),
			addSpell: jest.fn(),
			addCantrip: jest.fn(),
			setSpellMasterySpells: jest.fn(),
			setSignatureSpells: jest.fn(),
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
			classFeatProgression: {},
			expertise: {},
			languages: {},
			scholarSkill: null,
			spellbookSpells: [],
			spellMasterySpells: [{name: "Shield", source: "PHB", level: 1}, {name: "Misty Step", source: "PHB", level: 2}],
			signatureSpells: [{name: "Fireball", source: "PHB", level: 3}, {name: "Counterspell", source: "PHB", level: 3}],
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
		expect(state.setSpellMasterySpells).toHaveBeenCalledWith(qb._selections.spellMasterySpells);
		expect(state.setSignatureSpells).toHaveBeenCalledWith(qb._selections.signatureSpells);
		expect(page.saveCharacter).toHaveBeenCalled();

		CharacterSheetClassUtils.updateRacialSpells = originalUpdateRacialSpells;
	});

	test("does not continue saving or rendering after its originating character is replaced", async () => {
		const originalUpdateRacialSpells = CharacterSheetClassUtils.updateRacialSpells;
		CharacterSheetClassUtils.updateRacialSpells = jest.fn();
		let resolveSpellChoices;
		const spellChoices = new Promise(resolve => resolveSpellChoices = resolve);
		const state = {
			getAbilityMod: jest.fn(() => 2),
			setWeaponMasteries: jest.fn(),
			mergeCombatTraditions: jest.fn(),
			getCombatTraditions: jest.fn(() => []),
			getWeaponMasteries: jest.fn(() => []),
			recordLevelChoice: jest.fn(),
			updateLevelChoice: jest.fn(() => true),
			addSpell: jest.fn(),
			addCantrip: jest.fn(),
			setSpellMasterySpells: jest.fn(),
			setSignatureSpells: jest.fn(),
			ensureXpMatchesLevel: jest.fn(),
			applyClassFeatureEffects: jest.fn(),
			calculateSpellSlots: jest.fn(),
			recalculateAllCompanions: jest.fn(),
			recalculateHp: jest.fn(),
			setClassFeatureCatalog: jest.fn(),
			reconcileSubclassFeatureEntries: jest.fn(),
			getFeatures: jest.fn(() => []),
		};
		const page = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_spells: {processPendingSpellChoices: jest.fn(() => spellChoices)},
			getFilteredSpellData: jest.fn(() => []),
			getOptionalFeatures: jest.fn(() => []),
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
			_updateTabVisibility: jest.fn(),
		};
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		Object.assign(qb, {
			_state: state,
			_page: page,
			_levelAnalysis: [],
			_classAllocations: [],
			_targetLevel: 1,
			_fromLevel: 1,
			_selections: {
				subclasses: {},
				asi: {},
				optionalFeatures: {},
				featureOptions: {},
				expertise: {},
				languages: {},
				scholarSkill: null,
				spellbookSpells: [],
				spellMasterySpells: [],
				signatureSpells: [],
				knownSpells: [],
				knownCantrips: [],
				preparedSpells: [],
				preparedCantrips: [],
				hpMethod: "average",
				hpRolls: {},
				weaponMasteries: [],
				_combatTraditions: [],
			},
		});
		globalThis.JqueryUtil = {doToast: jest.fn()};

		const pending = qb._applyQuickBuild();
		await Promise.resolve();
		expect(page._spells.processPendingSpellChoices).toHaveBeenCalledTimes(1);
		page._currentCharacterId = "character-b";
		page._characterLoadGeneration++;
		resolveSpellChoices();

		await expect(pending).resolves.toBe(false);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
		expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalled();
		CharacterSheetClassUtils.updateRacialSpells = originalUpdateRacialSpells;
	});

	test("does not leak non-empty Quick Build mutations when the character scope changes during choices", async () => {
		const originalUpdateRacialSpells = CharacterSheetClassUtils.updateRacialSpells;
		const originalUpdateRacialFeatures = CharacterSheetClassUtils.updateRacialFeatures;
		CharacterSheetClassUtils.updateRacialSpells = jest.fn();
		CharacterSheetClassUtils.updateRacialFeatures = jest.fn();
		let resolveSpellChoices;
		const spellChoices = new Promise(resolve => resolveSpellChoices = resolve);
		const state = new CharacterSheetState();
		const targetState = new CharacterSheetState();
		targetState.addClass({name: "Rogue", source: "PHB", level: 3});
		const targetJson = targetState.toJson();
		const classData = {
			name: "Fighter",
			source: "PHB",
			hd: {number: 1, faces: 10},
			classFeatures: [],
		};
		const page = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_state: state,
			_classFeatures: [],
			_subclassFeatures: [],
			_spells: {
				_state: state,
				processPendingSpellChoices: jest.fn(() => spellChoices),
			},
			getFilteredSpellData: jest.fn(() => []),
			getOptionalFeatures: jest.fn(() => []),
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
			_updateTabVisibility: jest.fn(),
		};
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		Object.assign(qb, {
			_state: state,
			_page: page,
			_levelAnalysis: [{
				characterLevel: 1,
				className: "Fighter",
				classSource: "PHB",
				classLevel: 1,
				classData,
				features: [],
				needsSubclass: false,
				hasAsi: false,
				optionalFeatureGains: [],
				featureOptions: [],
				classFeatProgressionGains: [],
				expertiseGrants: [],
				languageGrants: [],
				isScholarLevel: false,
				weaponMasteryCount: 0,
			}],
			_classAllocations: [{className: "Fighter", classSource: "PHB", classData}],
			_targetLevel: 1,
			_fromLevel: 0,
			_selections: {
				subclasses: {},
				subclassChoices: {},
				asi: {},
				optionalFeatures: {},
				featureOptions: {},
				classFeatProgression: {},
				expertise: {},
				languages: {},
				scholarSkill: null,
				spellbookSpells: [],
				spellMasterySpells: [],
				signatureSpells: [],
				knownSpells: [],
				knownCantrips: [],
				preparedSpells: [],
				preparedCantrips: [],
				hpMethod: "average",
				hpRolls: {},
				weaponMasteries: [],
				_combatTraditions: [],
				_subclassChoiceTraditions: [],
			},
		});
		page._quickBuild = qb;
		globalThis.JqueryUtil = {doToast: jest.fn()};

		try {
			const pending = qb._applyQuickBuild();
			await Promise.resolve();
			await Promise.resolve();
			expect(page._spells.processPendingSpellChoices).toHaveBeenCalledTimes(1);
			expect(page._quickBuild).toBe(qb);
			expect(qb._state).toBe(state);
			expect(qb._page).toBe(page);
			page._currentCharacterId = "character-b";
			page._characterLoadGeneration++;
			page._state.loadFromJson(targetJson);
			resolveSpellChoices();

			await expect(pending).resolves.toBe(false);
			expect(page._state).toBe(state);
			expect(state.getClasses()).toEqual([
				expect.objectContaining({name: "Rogue", source: "PHB", level: 3}),
			]);
			expect(state.getClasses()).not.toEqual(expect.arrayContaining([
				expect.objectContaining({name: "Fighter"}),
			]));
			expect(globalThis.__csState).toBe(state);
			expect(page.saveCharacter).not.toHaveBeenCalled();
			expect(page.renderCharacter).not.toHaveBeenCalled();
		} finally {
			resolveSpellChoices?.();
			CharacterSheetClassUtils.updateRacialSpells = originalUpdateRacialSpells;
			CharacterSheetClassUtils.updateRacialFeatures = originalUpdateRacialFeatures;
		}
	});

	test("same-character authoritative adoption cancels a stale staged Quick Build", async () => {
		const state = new CharacterSheetState();
		state.setName("Before Quick Build");
		const page = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_characterDocumentGeneration: 0,
			_currentCharacterAccess: "owner",
			_state: state,
			_spells: null,
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
			_updateTabVisibility: jest.fn(),
		};
		let releaseChoice;
		const choiceGate = new Promise(resolve => releaseChoice = resolve);
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		Object.assign(qb, {
			_state: state,
			_page: page,
			_applyQuickBuildInner: jest.fn(async function () {
				this._state.setName("Staged Quick Build");
				await choiceGate;
				return true;
			}),
		});
		const characterScope = CharacterSheetModal.getCharacterScopeSnapshot(page);

		const pending = qb._pApplyQuickBuildStaged(characterScope);
		await Promise.resolve();
		state.setName("Authoritative Realtime Effect");
		page._characterDocumentGeneration++;
		releaseChoice();

		await expect(pending).resolves.toBe(false);
		expect(state.getName()).toBe("Authoritative Realtime Effect");
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
	});

	test("character-scope teardown cancels a pending choice and clears the apply lock", async () => {
		const originalUpdateRacialSpells = CharacterSheetClassUtils.updateRacialSpells;
		const originalUiUtil = globalThis.UiUtil;
		CharacterSheetClassUtils.updateRacialSpells = jest.fn();
		globalThis.UiUtil = {
			pGetShowModal: async ({cbClose}) => ({
				eleModalInner: {},
				doClose: value => cbClose?.(value),
			}),
		};

		const state = {
			getAbilityMod: jest.fn(() => 2),
			setWeaponMasteries: jest.fn(),
			mergeCombatTraditions: jest.fn(),
			getCombatTraditions: jest.fn(() => []),
			getWeaponMasteries: jest.fn(() => []),
			recordLevelChoice: jest.fn(),
			updateLevelChoice: jest.fn(() => true),
			addSpell: jest.fn(),
			addCantrip: jest.fn(),
			setSpellMasterySpells: jest.fn(),
			setSignatureSpells: jest.fn(),
			ensureXpMatchesLevel: jest.fn(),
			applyClassFeatureEffects: jest.fn(),
			calculateSpellSlots: jest.fn(),
			recalculateAllCompanions: jest.fn(),
			recalculateHp: jest.fn(),
			setClassFeatureCatalog: jest.fn(),
			reconcileSubclassFeatureEntries: jest.fn(),
			getFeatures: jest.fn(() => []),
		};
		const page = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			getFilteredSpellData: jest.fn(() => []),
			getOptionalFeatures: jest.fn(() => []),
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
			_updateTabVisibility: jest.fn(),
		};
		page._spells = {
			processPendingSpellChoices: jest.fn(async () => {
				let resolveChoice;
				const pChoice = new Promise(resolve => { resolveChoice = resolve; });
				await CharacterSheetModal.pGetShow({
					title: "Pending spell choice",
					cbClose: resolveChoice,
					cbCharacterScopeTeardown: resolveChoice,
				});
				return pChoice;
			}),
		};
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		Object.assign(qb, {
			_state: state,
			_page: page,
			_levelAnalysis: [],
			_classAllocations: [],
			_targetLevel: 1,
			_fromLevel: 1,
			_selections: {
				subclasses: {},
				asi: {},
				optionalFeatures: {},
				featureOptions: {},
				expertise: {},
				languages: {},
				scholarSkill: null,
				spellbookSpells: [],
				spellMasterySpells: [],
				signatureSpells: [],
				knownSpells: [],
				knownCantrips: [],
				preparedSpells: [],
				preparedCantrips: [],
				hpMethod: "average",
				hpRolls: {},
				weaponMasteries: [],
				_combatTraditions: [],
			},
		});
		globalThis.JqueryUtil = {doToast: jest.fn()};
		CharacterSheetModal.bindCharacterSheet(page);

		try {
			const pending = qb._applyQuickBuild();
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(page._spells.processPendingSpellChoices).toHaveBeenCalledTimes(1);
			expect(qb._isApplying).toBe(true);

			page._currentCharacterId = "character-b";
			page._characterLoadGeneration++;
			await CharacterSheetModal.closeCharacterScopeModals();

			await expect(pending).resolves.toBe(false);
			expect(qb._isApplying).toBe(false);
			expect(page.saveCharacter).not.toHaveBeenCalled();
			expect(page.renderCharacter).not.toHaveBeenCalled();
		} finally {
			CharacterSheetModal.bindCharacterSheet(null);
			CharacterSheetClassUtils.updateRacialSpells = originalUpdateRacialSpells;
			globalThis.UiUtil = originalUiUtil;
		}
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
