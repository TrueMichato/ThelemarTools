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
const ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
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

const PREPARED_SPELLS_BY_LEVEL = Object.freeze({
	3: ["Healing Word|XPHB", "Ray of Sickness|XPHB"],
	5: ["Flaming Sphere|XPHB", "Melf's Acid Arrow|XPHB"],
	9: ["Gaseous Form|XPHB", "Mass Healing Word|XPHB"],
	13: ["Death Ward|XPHB", "Vitriolic Sphere|XPHB"],
	17: ["Cloudkill|XPHB", "Raise Dead|XPHB"],
});
const INNATE_SPELL_UIDS = ["Lesser Restoration|XPHB", "Tasha's Bubbling Cauldron|XPHB"];

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

function classEntry (level, subclass = ALCHEMIST) {
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

function makeState (level, {subclass = ALCHEMIST, playerPrepared = []} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	playerPrepared.forEach(name => addPlayerPreparedSpell(state, name));
	state.addClass(classEntry(level, subclass));
	return state;
}

function expectedPreparedUids (level) {
	return sorted(Object.entries(PREPARED_SPELLS_BY_LEVEL)
		.filter(([requiredLevel]) => level >= Number(requiredLevel))
		.flatMap(([, uids]) => uids));
}

function alchemistGrants (state) {
	return state.getSpellsKnown().filter(spell => spell.sourceFeature === "Alchemist Spells");
}

function expectExactPreparedGrants (state, level) {
	const grants = alchemistGrants(state);
	const actualUids = grants.map(spellUid);
	expect(sorted(actualUids)).toEqual(expectedPreparedUids(level));
	expect(new Set(actualUids).size).toBe(actualUids.length);
	expect(actualUids).not.toEqual(expect.arrayContaining(INNATE_SPELL_UIDS));
	grants.forEach(spell => {
		expect(spell).toMatchObject({
			source: "XPHB",
			sourceClass: "Artificer",
			alwaysPrepared: true,
			prepared: true,
		});
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
	const state = makeState(startLevel, {subclass: startLevel >= 3 ? ALCHEMIST : null});
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	levelUp._state = state;
	levelUp._page = makePage(state);
	levelUp._selectedFeatureSkillChoices = {};
	levelUp._processFeatSpellChoices = async () => {};

	await levelUp._applyLevelUp({
		classEntry: state.getClasses()[0],
		newLevel: targetLevel,
		asiChoices: {},
		selectedFeat: null,
		selectedSubclass: ALCHEMIST,
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
	quickBuild._selections = {
		subclasses: {"Artificer_EFA": ALCHEMIST},
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
			? {subclass: {name: ALCHEMIST.name, shortName: ALCHEMIST.shortName, source: ALCHEMIST.source}}
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

function makeSharedOwnerClass (subclassSource) {
	return {
		name: "Artificer",
		source: "EFA",
		level: 3,
		subclass: {
			name: "Alchemist",
			shortName: "Alchemist",
			source: subclassSource,
			additionalSpells: [{prepared: {3: ["healing word|xphb"]}}],
		},
	};
}

function makeSharedOwnerState () {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	addPlayerPreparedSpell(state, "Healing Word");
	state._data.classes = [
		makeSharedOwnerClass("EFA"),
		makeSharedOwnerClass("TCE"),
	];
	state.populateSubclassSpells();
	return state;
}

function getSharedOwner (state, subclassSource) {
	const cls = state.getClasses().find(it => it.subclass?.source === subclassSource);
	return state.getSubclassSpellGrantOwner(cls, {sourceFeature: "Alchemist Spells"});
}

beforeAll(() => {
	globalThis.JqueryUtil = globalThis.JqueryUtil || {doToast: () => {}};
});

describe("EFA Alchemist fixed prepared spells", () => {
	test.each([2, 3, 4, 5, 9, 13, 17])("level %i has only the exact cumulative prepared grant set", level => {
		expectExactPreparedGrants(makeState(level), level);
	});

	test("grants do not consume the ordinary Artificer prepared-spell allowance", () => {
		const state = makeState(5, {playerPrepared: ["Cure Wounds"]});
		const card = state.getSpellcastingClassBreakdown().find(it => it.className === "Artificer");

		expect(card).toMatchObject({
			spellsCount: 1,
			spellsGranted: 4,
			spellsMax: EFA_ARTIFICER.preparedSpellsProgression[4],
		});
	});

	test("save/load preserves grants and down-level reconciliation removes locked tiers", () => {
		const original = makeState(17, {playerPrepared: ["Cure Wounds"]});
		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(original.toJson());
		expectExactPreparedGrants(loaded, 17);

		loaded.getClasses()[0].level = 4;
		loaded.applyClassFeatureEffects();
		expectExactPreparedGrants(loaded, 4);
	});

	test.each([3, 9, 17])("Level Up to %i refreshes exact grants", async level => {
		expectExactPreparedGrants(await applyLevelUpTo(level), level);
	});

	test.each([3, 9, 17])("Quick Build to %i refreshes exact grants", async level => {
		expectExactPreparedGrants(await applyQuickBuildTo(level), level);
	});
});

describe("EFA Alchemist exact-owner lifecycle", () => {
	test.each([
		["EFA", "TCE"],
		["TCE", "EFA"],
	])("removing the %s same-label owner preserves the %s owner", (removedSource, keptSource) => {
		const state = makeSharedOwnerState();
		state.removeSubclassSpells(getSharedOwner(state, removedSource));

		const spell = state.getSpellsKnown().find(it => spellUid(it) === "Healing Word|XPHB");
		expect(spell.subclassSpellGrantOwners).toEqual([getSharedOwner(state, keptSource)]);
		expect(spell).toMatchObject({alwaysPrepared: true, prepared: true});
	});

	test("final owner removal restores colliding player metadata", () => {
		const state = makeSharedOwnerState();
		state.removeSubclassSpells(getSharedOwner(state, "EFA"));
		state.removeSubclassSpells(getSharedOwner(state, "TCE"));

		const spell = state.getSpellsKnown().find(it => spellUid(it) === "Healing Word|XPHB");
		expect(spell).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
		expect(spell.subclassSpellGrantOwners).toBeUndefined();
	});

	test("Respec removes only EFA Alchemist grants and restores a player collision", async () => {
		const state = makeState(17, {playerPrepared: ["Healing Word"]});
		await makeRespec(state)._applySubclassChange(
			3,
			{level: 3, class: {name: "Artificer", source: "EFA"}},
			ALCHEMIST,
			ARTILLERIST,
		);

		expect(alchemistGrants(state)).toEqual([]);
		expect(state.getSpellsKnown().find(it => spellUid(it) === "Healing Word|XPHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
	});

	test.each([
		["removeClass", state => state.removeClass("Artificer", "EFA")],
		["setSubclass", state => state.setSubclass("Artificer", subclassSnapshot(ARTILLERIST))],
		["addClass replacement", state => state.addClass(classEntry(17, ARTILLERIST))],
	])("%s cleans the exact ledger owner", (_label, mutate) => {
		const state = makeState(17, {playerPrepared: ["Healing Word"]});
		mutate(state);

		expect(alchemistGrants(state)).toEqual([]);
		expect(state.getSpellsKnown().find(it => spellUid(it) === "Healing Word|XPHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			prepared: true,
			alwaysPrepared: false,
		});
	});

	test("removing the subclass-selection level cleans the exact ledger owner", () => {
		const state = makeState(3, {playerPrepared: ["Healing Word"]});
		for (let level = 1; level <= 3; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Artificer", source: "EFA"},
				classLevel: level,
				choices: level === 3
					? {subclass: {name: "Alchemist", shortName: "Alchemist", source: "EFA"}}
					: {},
				complete: true,
			});
		}

		expect(state.removeClassLastLevel("Artificer", "EFA").success).toBe(true);
		expect(state.getClasses()[0]).toMatchObject({level: 2, subclass: null});
		expect(alchemistGrants(state)).toEqual([]);
		expect(state.getSpellsKnown().find(it => spellUid(it) === "Healing Word|XPHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			prepared: true,
			alwaysPrepared: false,
		});
	});
});
