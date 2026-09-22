import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const ARMORER = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Armorer"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const ARTILLERIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Artillerist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);

const ARMORER_SPELLS_BY_LEVEL = Object.freeze({
	3: ["Magic Missile|XPHB", "Thunderwave|XPHB"],
	5: ["Mirror Image|XPHB", "Shatter|XPHB"],
	9: ["Hypnotic Pattern|XPHB", "Lightning Bolt|XPHB"],
	13: ["Fire Shield|XPHB", "Greater Invisibility|XPHB"],
	17: ["Passwall|XPHB", "Wall of Force|XPHB"],
});

const copy = value => JSON.parse(JSON.stringify(value));
const spellUid = spell => `${spell.name}|${spell.source}`;
const sorted = values => [...values].sort((a, b) => a.localeCompare(b));

function subclassSnapshot (subclass) {
	return {
		name: subclass.name,
		shortName: subclass.shortName,
		source: subclass.source,
		casterProgression: subclass.casterProgression,
		spellcastingAbility: subclass.spellcastingAbility,
		additionalSpells: copy(subclass.additionalSpells),
	};
}

function classEntry (level, subclass = ARMORER) {
	return {
		name: EFA_ARTIFICER.name,
		source: EFA_ARTIFICER.source,
		level,
		spellcastingAbility: EFA_ARTIFICER.spellcastingAbility,
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: subclass ? subclassSnapshot(subclass) : null,
	};
}

function findXphbSpell (name) {
	const spell = XPHB_SPELLS.find(it => it.name === name && it.source === "XPHB");
	if (!spell) throw new Error(`Missing XPHB spell fixture: ${name}`);
	return spell;
}

function addPlayerPreparedSpell (state, name) {
	const spell = findXphbSpell(name);
	state.addSpell({
		name: spell.name,
		source: spell.source,
		level: spell.level,
		school: spell.school,
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
	}, true);
}

function makeState (level, {subclass = ARMORER, playerPrepared = []} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	playerPrepared.forEach(name => addPlayerPreparedSpell(state, name));
	state.addClass(classEntry(level, subclass));
	return state;
}

function expectedArmorerUids (level) {
	return sorted(Object.entries(ARMORER_SPELLS_BY_LEVEL)
		.filter(([requiredLevel]) => level >= Number(requiredLevel))
		.flatMap(([, uids]) => uids));
}

function armorerGrants (state) {
	return state.getSpellsKnown().filter(spell => spell.sourceFeature === "Armorer Spells");
}

function expectExactArmorerGrants (state, level) {
	const grants = armorerGrants(state);
	const actualUids = grants.map(spellUid);
	expect(sorted(actualUids)).toEqual(expectedArmorerUids(level));
	expect(new Set(actualUids).size).toBe(actualUids.length);
	grants.forEach(spell => {
		expect(spell.source).toBe("XPHB");
		expect(spell.sourceClass).toBe("Artificer");
		expect(spell.alwaysPrepared).toBe(true);
		expect(spell.prepared).toBe(true);
		expect(CharacterSheetClassUtils.isPlayerChosenSpell(spell)).toBe(false);
	});
}

function makePage (state) {
	return {
		_classFeatures: [],
		_subclassFeatures: [],
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSpells: () => XPHB_SPELLS,
		getFilteredSpellData: () => XPHB_SPELLS,
		filterByAllowedSources: values => values,
		processPendingFeatureChoices: async () => {},
		_spells: {processPendingSpellChoices: async () => {}},
		saveCharacter: async () => {},
		renderCharacter: () => {},
		_updateTabVisibility: () => {},
		showDiceResult: () => {},
	};
}

async function applyLevelUpTo (targetLevel) {
	const startLevel = targetLevel - 1;
	const state = makeState(startLevel, {subclass: startLevel >= 3 ? ARMORER : null});
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	levelUp._state = state;
	levelUp._page = makePage(state);
	levelUp._selectedFeatureSkillChoices = {};
	levelUp._processFeatSpellChoices = async () => {};

	const classRef = state.getClasses()[0];
	await levelUp._applyLevelUp({
		classEntry: classRef,
		newLevel: targetLevel,
		asiChoices: {},
		selectedFeat: null,
		selectedSubclass: ARMORER,
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
		newFeatures: [],
		hpMethod: "average",
		classData: EFA_ARTIFICER,
	});
	return state;
}

function quickBuildSelections () {
	return {
		subclasses: {"Artificer_EFA": ARMORER},
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
		weaponMasteries: null,
		_combatTraditions: null,
		_subclassChoiceTraditions: null,
	};
}

async function applyQuickBuildTo (targetLevel) {
	const state = makeState(2, {subclass: null});
	const quickBuild = Object.create(CharacterSheetQuickBuild.prototype);
	quickBuild._state = state;
	quickBuild._page = makePage(state);
	quickBuild._fromLevel = 2;
	quickBuild._targetLevel = targetLevel;
	quickBuild._classAllocations = [{
		className: "Artificer",
		classSource: "EFA",
		classData: EFA_ARTIFICER,
	}];
	quickBuild._selections = quickBuildSelections();
	quickBuild._levelAnalysis = Array.from({length: targetLevel - 2}, (_, ix) => {
		const classLevel = ix + 3;
		return {
			characterLevel: classLevel,
			className: "Artificer",
			classSource: "EFA",
			classLevel,
			classData: EFA_ARTIFICER,
			features: [],
			needsSubclass: classLevel === 3,
			hasAsi: false,
			optionalFeatureGains: [],
			featureOptions: [],
			classFeatProgressionGains: [],
			expertiseGrants: [],
			languageGrants: [],
			isScholarLevel: false,
		};
	});
	quickBuild._getQuickBuildFeatSelectionIssues = () => [];
	quickBuild._buildHistoryEntry = analysis => ({
		level: analysis.characterLevel,
		class: {name: analysis.className, source: analysis.classSource},
		classLevel: analysis.classLevel,
		choices: analysis.needsSubclass
			? {subclass: {name: ARMORER.name, shortName: ARMORER.shortName, source: ARMORER.source}}
			: {},
		complete: true,
	});

	await quickBuild._applyQuickBuildInner();
	return state;
}

function makeRespec (state) {
	const respec = Object.create(CharacterSheetRespec.prototype);
	respec._state = state;
	respec._page = makePage(state);
	respec._$timeline = null;
	respec._$legacyBadge = null;
	return respec;
}

beforeAll(() => {
	globalThis.JqueryUtil = globalThis.JqueryUtil || {doToast: () => {}};
});

describe("EFA Armorer published always-prepared spells", () => {
	test.each([2, 3, 4, 5, 9, 13, 17])("level %i has the exact cumulative XPHB grant set", level => {
		const state = makeState(level);
		expectExactArmorerGrants(state, level);
	});

	test("granted spells do not consume the normal prepared-spell allowance", () => {
		const state = makeState(5, {playerPrepared: ["Cure Wounds"]});
		const card = state.getSpellcastingClassBreakdown().find(it => it.className === "Artificer");

		expect(card.spellsCount).toBe(1);
		expect(card.spellsGranted).toBe(4);
		expect(card.spellsMax).toBe(EFA_ARTIFICER.preparedSpellsProgression[4]);
		expect(state.getSpellsKnown().find(spell => spell.name === "Cure Wounds")).toMatchObject({
			source: "XPHB",
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
		});
	});

	test("save/load preserves exact grants, source identity, and Extra Attack", () => {
		const original = makeState(17, {playerPrepared: ["Cure Wounds"]});
		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(original.toJson());

		expectExactArmorerGrants(loaded, 17);
		expect(loaded.getSpellsKnown().find(spell => spell.name === "Cure Wounds")).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
		});
		expect(loaded.getFeatureCalculations()).toMatchObject({
			hasExtraAttack: true,
			attackCount: 2,
			attacksPerAction: 2,
		});
	});

	test("reconciling a lower Artificer level removes no-longer-unlocked grants", () => {
		const state = makeState(5);
		state.getClasses()[0].level = 4;
		state.applyClassFeatureEffects();

		expectExactArmorerGrants(state, 4);
	});
});

describe("EFA Armorer progression surfaces", () => {
	test.each([3, 4, 5, 9, 13, 17])("Level Up to %i refreshes the exact grant set", async level => {
		const state = await applyLevelUpTo(level);
		expectExactArmorerGrants(state, level);
	});

	test.each([3, 4, 5, 9, 13, 17])("Quick Build to %i refreshes the exact grant set", async level => {
		const state = await applyQuickBuildTo(level);
		expectExactArmorerGrants(state, level);
	});
});

describe("EFA Armorer respec and Extra Attack isolation", () => {
	test("respec grants Armorer spells and restores a colliding player spell after switching away", async () => {
		const state = makeState(17, {
			subclass: ARTILLERIST,
			playerPrepared: ["Magic Missile"],
		});
		const history = {level: 3, class: {name: "Artificer", source: "EFA"}};

		expect(state.getFeatureCalculations().attackCount).toBe(1);
		await makeRespec(state)._applySubclassChange(3, history, ARTILLERIST, ARMORER);
		expectExactArmorerGrants(state, 17);
		expect(state.getFeatureCalculations().attackCount).toBe(2);

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(state.toJson());
		await makeRespec(loaded)._applySubclassChange(3, history, ARMORER, ARTILLERIST);

		const magicMissile = loaded.getSpellsKnown().find(spell => spellUid(spell) === "Magic Missile|XPHB");
		expect(magicMissile).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
		expect(armorerGrants(loaded)).toEqual([]);
		expect(loaded.getFeatureCalculations().attackCount).toBe(1);
	});

	test("duplicate Extra Attack materialization never produces a third attack", () => {
		const state = makeState(5);
		state._data.features.push(
			{name: "Extra Attack", source: "EFA", className: "Artificer", subclassName: "Armorer", level: 5},
			{name: "Extra Attack", source: "EFA", className: "Artificer", subclassName: "Armorer", level: 5},
		);

		const calculations = state.getFeatureCalculations();
		expect(calculations.hasExtraAttack).toBe(true);
		expect(calculations.attackCount).toBe(2);
		expect(state.getNumberOfAttacks()).toBe(2);
	});
});
