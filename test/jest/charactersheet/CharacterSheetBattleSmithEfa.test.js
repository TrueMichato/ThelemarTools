import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetCompanionRules = globalThis.CharacterSheetCompanionRules;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const SPELL_DATA = [
	...JSON.parse(readFileSync(resolve(__dirname, "../../../data/spells/spells-phb.json"), "utf8")).spell,
	...JSON.parse(readFileSync(resolve(__dirname, "../../../data/spells/spells-xphb.json"), "utf8")).spell,
];

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const TCE_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "TCE");
const EFA_BATTLE_SMITH = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Battle Smith"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const TCE_BATTLE_SMITH = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Battle Smith"
	&& sc.source === "TCE"
	&& sc.className === "Artificer"
	&& sc.classSource === "TCE",
);
const EFA_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);

const EFA_SPELLS_BY_LEVEL = Object.freeze({
	3: ["Heroism|XPHB", "Shield|XPHB"],
	5: ["Shining Smite|XPHB", "Warding Bond|XPHB"],
	9: ["Aura of Vitality|XPHB", "Conjure Barrage|XPHB"],
	13: ["Aura of Purity|XPHB", "Fire Shield|XPHB"],
	17: ["Banishing Smite|XPHB", "Mass Cure Wounds|XPHB"],
});

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
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

function classEntry ({
	classData = EFA_ARTIFICER,
	level,
	subclass = EFA_BATTLE_SMITH,
} = {}) {
	return {
		name: classData.name,
		source: classData.source,
		level,
		spellcastingAbility: classData.spellcastingAbility,
		casterProgression: classData.casterProgression,
		preparedSpellsProgression: copy(classData.preparedSpellsProgression),
		cantripProgression: copy(classData.cantripProgression),
		subclass: subclass ? subclassSnapshot(subclass) : null,
	};
}

function findSpell (name, source = "XPHB") {
	const spell = SPELL_DATA.find(it => it.name === name && it.source === source);
	if (!spell) throw new Error(`Missing spell fixture: ${name}|${source}`);
	return spell;
}

function addPlayerPreparedSpell (state, name, source = "XPHB") {
	const spell = findSpell(name, source);
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

function makeState ({
	level,
	classData = EFA_ARTIFICER,
	subclass = EFA_BATTLE_SMITH,
	playerPrepared = [],
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(SPELL_DATA);
	playerPrepared.forEach(name => addPlayerPreparedSpell(state, name));
	state.addClass(classEntry({classData, level, subclass}));
	return state;
}

function expectedEfaSpellUids (level) {
	return sorted(Object.entries(EFA_SPELLS_BY_LEVEL)
		.filter(([requiredLevel]) => level >= Number(requiredLevel))
		.flatMap(([, uids]) => uids));
}

function battleSmithGrants (state, source = "XPHB") {
	return state.getSpellsKnown().filter(spell =>
		spell.sourceFeature === "Battle Smith Spells"
		&& spell.source === source,
	);
}

function expectExactEfaGrants (state, level) {
	const grants = battleSmithGrants(state);
	const actualUids = grants.map(spellUid);
	expect(sorted(actualUids)).toEqual(expectedEfaSpellUids(level));
	expect(new Set(actualUids).size).toBe(actualUids.length);
	grants.forEach(spell => {
		expect(spell.sourceClass).toBe("Artificer");
		expect(spell.alwaysPrepared).toBe(true);
		expect(spell.prepared).toBe(true);
		expect(CharacterSheetClassUtils.isPlayerChosenSpell(spell)).toBe(false);
		expect(spell.subclassSpellGrantOwners).toContainEqual(expect.objectContaining({
			key: "artificer|efa|battle smith|efa",
			sourceFeature: "Battle Smith Spells",
		}));
	});
}

function makePage (state, {classes = [EFA_ARTIFICER]} = {}) {
	return {
		_classFeatures: [],
		_subclassFeatures: [],
		getState: () => state,
		getClasses: () => classes,
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSpells: () => SPELL_DATA,
		getFilteredSpellData: () => SPELL_DATA,
		filterByAllowedSources: values => values,
		processPendingFeatureChoices: async () => {},
		_spells: {processPendingSpellChoices: async () => {}},
		saveCharacter: async () => {},
		renderCharacter: () => {},
		_updateTabVisibility: () => {},
		showDiceResult: () => {},
	};
}

function makeBuilder (state) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder.resetSelections();
	builder._state = state;
	builder._page = makePage(state);
	builder._currentStep = 3;
	builder._selectedClass = {
		name: EFA_ARTIFICER.name,
		source: EFA_ARTIFICER.source,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
	};
	builder._selectedSubclass = EFA_BATTLE_SMITH;
	return builder;
}

async function applyLevelUpTo (targetLevel, state = null) {
	const startLevel = targetLevel - 1;
	state ||= makeState({
		level: startLevel,
		subclass: startLevel >= 3 ? EFA_BATTLE_SMITH : null,
	});
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	levelUp._state = state;
	levelUp._page = makePage(state);
	levelUp._selectedFeatureSkillChoices = {};
	levelUp._processFeatSpellChoices = async () => {};

	const classRef = state.getClasses().find(cls => cls.name === "Artificer" && cls.source === "EFA");
	await levelUp._applyLevelUp({
		classEntry: classRef,
		newLevel: targetLevel,
		asiChoices: {},
		selectedFeat: null,
		selectedSubclass: EFA_BATTLE_SMITH,
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
		subclasses: {"Artificer_EFA": EFA_BATTLE_SMITH},
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

async function applyQuickBuildTo (targetLevel, state = null) {
	state ||= makeState({level: 2, subclass: null});
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
			? {subclass: {name: EFA_BATTLE_SMITH.name, shortName: EFA_BATTLE_SMITH.shortName, source: EFA_BATTLE_SMITH.source}}
			: {},
		complete: true,
	});

	await quickBuild._applyQuickBuildInner();
	return state;
}

function makeRespec (state) {
	const respec = Object.create(CharacterSheetRespec.prototype);
	respec._state = state;
	respec._page = makePage(state, {classes: [EFA_ARTIFICER, TCE_ARTIFICER]});
	respec._$timeline = null;
	respec._$legacyBadge = null;
	return respec;
}

function makeCoexistingState ({efaLevel = 3, tceLevel = 3} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(SPELL_DATA);
	state._data.classes = [
		classEntry({level: efaLevel}),
		classEntry({classData: TCE_ARTIFICER, level: tceLevel, subclass: TCE_BATTLE_SMITH}),
	];
	state.populateSubclassSpells();
	return state;
}

beforeAll(() => {
	globalThis.JqueryUtil = globalThis.JqueryUtil || {doToast: () => {}};
});

describe("EFA Battle Smith authoritative passive contract", () => {
	test("uses the exact published XPHB spell table", () => {
		expect(EFA_BATTLE_SMITH.additionalSpells).toEqual([{
			prepared: {
				3: ["heroism|xphb", "shield|xphb"],
				5: ["shining smite|xphb", "warding bond|xphb"],
				9: ["aura of vitality|xphb", "conjure barrage|xphb"],
				13: ["aura of purity|xphb", "fire shield|xphb"],
				17: ["banishing smite|xphb", "mass cure wounds|xphb"],
			},
		}]);
	});

	test.each([2, 3, 4, 5, 9, 13, 17])("level %i has the exact cumulative always-prepared set", level => {
		expectExactEfaGrants(makeState({level}), level);
	});

	test("level 3 publishes source-qualified ownership, fixed proficiencies, and no defender formulas", () => {
		const state = makeState({level: 3});
		const calculations = state.getFeatureCalculations();

		expect(CharacterSheetState.EFA_BATTLE_SMITH_SUBCLASS_UID).toBe("Battle Smith|Artificer|EFA|EFA");
		expect(CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS).toEqual({
			TOOLS_OF_THE_TRADE: "Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA",
			BATTLE_READY: "Battle Ready|Artificer|EFA|Battle Smith|EFA|3|EFA",
			STEEL_DEFENDER: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA",
			EXTRA_ATTACK: "Extra Attack|Artificer|EFA|Battle Smith|EFA|5|EFA",
			ARCANE_JOLT: "Arcane Jolt|Artificer|EFA|Battle Smith|EFA|9|EFA",
			IMPROVED_DEFENDER: "Improved Defender|Artificer|EFA|Battle Smith|EFA|15|EFA",
		});
		expect(calculations).toMatchObject({
			hasEfaBattleSmithToolsOfTheTrade: true,
			efaBattleSmithToolsOfTheTradeFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.TOOLS_OF_THE_TRADE,
			hasEfaBattleReady: true,
			efaBattleReadyFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			efaBattleReadyAttackAbility: "int",
			efaBattleReadyWeaponRequirement: "magic",
			hasEfaSteelDefenderGrant: true,
			efaSteelDefenderFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.STEEL_DEFENDER,
		});
		expect(CharacterSheetCompanionRules.getDescriptor(calculations.efaSteelDefenderFeatureUid)?.identity)
			.toMatchObject({
				classUid: "Artificer|EFA",
				subclassUid: "Battle Smith|Artificer|EFA|EFA",
				featureUid: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3",
			});
		expect(calculations).not.toHaveProperty("hasBattleReady");
		expect(calculations).not.toHaveProperty("hasSteelDefender");
		expect(calculations).not.toHaveProperty("steelDefenderHp");
		expect(calculations).not.toHaveProperty("steelDefenderAc");
		expect(calculations).not.toHaveProperty("steelDefenderAcBonus");
		expect(calculations).not.toHaveProperty("steelDefenderRendDamage");
		expect(calculations).not.toHaveProperty("steelDefenderRepair");
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(state.getWeaponProficiencies()).toContain("Martial Weapons");
	});

	test("martial-weapon proficiency reaches the canonical attack calculation", () => {
		const state = makeState({level: 3});
		state.setAbilityBase("str", 10);
		const attack = state.updateAttackFromWeapon({
			name: "Longsword",
			source: "XPHB",
			type: "M",
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			property: [],
		});

		expect(attack.abilityMod).toBe("str");
		expect(attack.attackBonus).toBe(state.getProficiencyBonus());
	});

	test("Battle Ready exposes eligibility metadata without applying the blocked Intelligence substitution", () => {
		const state = makeState({level: 3});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("int", 18);
		state.addFeature({
			name: "Battle Ready",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			subclassName: "Battle Smith",
			subclassSource: "EFA",
			level: 3,
			featureType: "Subclass Feature",
		});
		state.applyClassFeatureEffects();

		const calculations = state.getFeatureCalculations();
		expect(calculations).toMatchObject({
			hasEfaBattleReady: true,
			efaBattleReadyAttackAbility: "int",
			efaBattleReadyWeaponRequirement: "magic",
			efaBattleReadyAttackMod: 4,
		});
		expect(state._data._classFeatureAttackAbilities).toEqual([]);
		const attack = state.updateAttackFromWeapon({
			name: "Replicated Longsword",
			source: "EFA",
			type: "M",
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			property: [],
			magical: true,
			rarity: "rare",
		});
		expect(attack.abilityMod).toBe("str");
		expect(attack.attackBonus).toBe(state.getProficiencyBonus());
	});

	test("fixed grants use canonical teardown and preserve pre-existing proficiency", () => {
		const granted = makeState({level: 3});
		granted.setSubclass("Artificer", subclassSnapshot(EFA_ALCHEMIST));
		expect(granted.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(granted.getWeaponProficiencies()).not.toContain("Martial Weapons");

		const preExisting = new CharacterSheetState();
		preExisting.setSpellData(SPELL_DATA);
		preExisting.addToolProficiency("Smith's Tools");
		preExisting.addWeaponProficiency("Martial Weapons");
		preExisting.addClass(classEntry({level: 3}));
		preExisting.setSubclass("Artificer", subclassSnapshot(EFA_ALCHEMIST));
		expect(preExisting.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(preExisting.getWeaponProficiencies()).toContain("Martial Weapons");
	});

	test.each([
		{level: 4, expected: {hasExtraAttack: undefined, hasEfaArcaneJolt: undefined, hasEfaImprovedDefender: undefined}},
		{level: 5, expected: {hasExtraAttack: true, attacksPerAction: 2}},
		{level: 9, expected: {hasEfaArcaneJolt: true, efaArcaneJoltDamage: "2d6", efaArcaneJoltHealing: "2d6", efaArcaneJoltUses: 4}},
		{level: 15, expected: {hasEfaImprovedDefender: true, efaArcaneJoltDamage: "4d6", efaImprovedDefenderDeflectAttackDamageDice: "1d4", efaImprovedDefenderDeflectAttackDamageBonus: 4}},
	])("level $level publishes only unlocked passive metadata", ({level, expected}) => {
		const state = makeState({level});
		state.setAbilityBase("int", 18);
		const calculations = state.getFeatureCalculations();
		Object.entries(expected).forEach(([key, value]) => expect(calculations[key]).toBe(value));
		if (level >= 15) {
			expect(calculations.efaImprovedDefenderFeatureUid).toBe(CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.IMPROVED_DEFENDER);
			expect(calculations.efaImprovedDefenderArcaneJoltDice).toBe("4d6");
			expect(calculations.efaImprovedDefenderDeflectAttackDamageType).toBe("force");
			expect(calculations).not.toHaveProperty("steelDefenderAcBonus");
		}
		if (level >= 5) expect(calculations.attackCount).toBe(2);
	});

	test("Arcane Jolt uses have the published minimum of one", () => {
		const state = makeState({level: 9});
		state.setAbilityBase("int", 6);
		expect(state.getFeatureCalculations().efaArcaneJoltUses).toBe(1);
	});

	test("strict full-source dispatch excludes other EFA subclasses and preserves TCE Battle Smith", () => {
		const efaAlchemist = makeState({level: 15, subclass: EFA_ALCHEMIST}).getFeatureCalculations();
		expect(efaAlchemist.hasEfaBattleReady).not.toBe(true);
		expect(efaAlchemist.hasEfaSteelDefenderGrant).not.toBe(true);
		expect(efaAlchemist.hasEfaArcaneJolt).not.toBe(true);

		for (const mismatched of [
			makeState({level: 15, classData: EFA_ARTIFICER, subclass: TCE_BATTLE_SMITH}),
			makeState({level: 15, classData: TCE_ARTIFICER, subclass: EFA_BATTLE_SMITH}),
		]) {
			const calculations = mismatched.getFeatureCalculations();
			expect(calculations.hasEfaBattleReady).not.toBe(true);
			expect(calculations.hasEfaSteelDefenderGrant).not.toBe(true);
			expect(calculations.hasEfaArcaneJolt).not.toBe(true);
			expect(calculations.hasBattleReady).not.toBe(true);
			expect(calculations.hasSteelDefender).not.toBe(true);
			expect(calculations.hasArcaneJolt).not.toBe(true);
			expect(calculations.craftingTimeModifiers || []).toEqual([]);
		}

		const tce = makeState({
			level: 15,
			classData: TCE_ARTIFICER,
			subclass: TCE_BATTLE_SMITH,
		});
		tce.setAbilityBase("int", 18);
		const tceCalculations = tce.getFeatureCalculations();
		expect(tceCalculations).toMatchObject({
			hasBattleReady: true,
			hasSteelDefender: true,
			steelDefenderHp: 81,
			steelDefenderAc: 17,
			steelDefenderAcBonus: 2,
			arcaneJoltDamage: "4d6",
			arcaneJoltUses: 4,
		});
	});
});

describe("EFA Battle Smith spell ledger and progression surfaces", () => {
	test("grants do not consume the normal prepared-spell allowance", () => {
		const state = makeState({level: 5, playerPrepared: ["Cure Wounds"]});
		const card = state.getSpellcastingClassBreakdown().find(it => it.className === "Artificer");

		expect(card.spellsCount).toBe(1);
		expect(card.spellsGranted).toBe(4);
		expect(card.spellsMax).toBe(EFA_ARTIFICER.preparedSpellsProgression[4]);
	});

	test("save/load preserves exact grants and lower-level reconciliation removes locked spells", () => {
		const original = makeState({level: 17, playerPrepared: ["Cure Wounds"]});
		const loaded = new CharacterSheetState();
		loaded.setSpellData(SPELL_DATA);
		loaded.loadFromJson(original.toJson());
		expectExactEfaGrants(loaded, 17);

		loaded.getClasses()[0].level = 4;
		loaded.applyClassFeatureEffects();
		expectExactEfaGrants(loaded, 4);
		expect(loaded.getSpellsKnown().find(spell => spell.name === "Cure Wounds")).toMatchObject({
			sourceFeature: "Prepared Spells",
			prepared: true,
		});
	});

	test("Builder preserves the exact subclass payload used by the spell ledger", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DATA);
		const builder = makeBuilder(state);
		builder._applyCurrentStep();

		const cls = state.getClasses()[0];
		expect(cls).toMatchObject({
			name: "Artificer",
			source: "EFA",
			subclass: {
				name: "Battle Smith",
				source: "EFA",
				additionalSpells: EFA_BATTLE_SMITH.additionalSpells,
			},
		});
		cls.level = 3;
		state.applyClassFeatureEffects();
		expectExactEfaGrants(state, 3);
	});

	test.each([3, 5, 9, 13, 17])("Level Up to %i refreshes the exact grant set", async level => {
		expectExactEfaGrants(await applyLevelUpTo(level), level);
	});

	test.each([3, 5, 9, 13, 17])("Quick Build to %i refreshes the exact grant set", async level => {
		expectExactEfaGrants(await applyQuickBuildTo(level), level);
	});

	test("EFA/TCE coexistence retains exact owner/source identities", () => {
		const state = makeCoexistingState();
		const efaClass = state.getClasses().find(cls => cls.source === "EFA");
		const tceClass = state.getClasses().find(cls => cls.source === "TCE");
		const efaOwner = state.getSubclassSpellGrantOwner(efaClass, {sourceFeature: "Battle Smith Spells"});
		const tceOwner = state.getSubclassSpellGrantOwner(tceClass, {sourceFeature: "Battle Smith Spells"});

		expect(efaOwner.key).toBe("artificer|efa|battle smith|efa");
		expect(tceOwner.key).toBe("artificer|tce|battle smith|tce");
		expect(sorted(battleSmithGrants(state, "XPHB").map(spellUid))).toEqual(expectedEfaSpellUids(3));
		expect(sorted(battleSmithGrants(state, "PHB").map(spellUid))).toEqual([
			"Heroism|PHB",
			"Shield|PHB",
		]);

		state.removeSubclassSpells(efaOwner);
		expect(battleSmithGrants(state, "XPHB")).toEqual([]);
		expect(sorted(battleSmithGrants(state, "PHB").map(spellUid))).toEqual([
			"Heroism|PHB",
			"Shield|PHB",
		]);
	});

	test("Level Up and Quick Build preserve a coexisting TCE owner's spells", async () => {
		const levelState = makeCoexistingState({efaLevel: 2, tceLevel: 3});
		levelState.removeSubclassSpells(levelState.getSubclassSpellGrantOwner(
			levelState.getClasses().find(cls => cls.source === "EFA"),
			{sourceFeature: "Battle Smith Spells"},
		));
		await applyLevelUpTo(3, levelState);
		expectExactEfaGrants(levelState, 3);
		expect(sorted(battleSmithGrants(levelState, "PHB").map(spellUid))).toEqual(["Heroism|PHB", "Shield|PHB"]);

		const quickState = makeCoexistingState({efaLevel: 2, tceLevel: 3});
		quickState.removeSubclassSpells(quickState.getSubclassSpellGrantOwner(
			quickState.getClasses().find(cls => cls.source === "EFA"),
			{sourceFeature: "Battle Smith Spells"},
		));
		await applyQuickBuildTo(3, quickState);
		expectExactEfaGrants(quickState, 3);
		expect(sorted(battleSmithGrants(quickState, "PHB").map(spellUid))).toEqual(["Heroism|PHB", "Shield|PHB"]);
	});

	test("Respec removes only the exact EFA owner and leaves TCE Battle Smith intact", async () => {
		const state = makeCoexistingState();
		await makeRespec(state)._applySubclassChange(
			3,
			{level: 3, class: {name: "Artificer", source: "EFA"}},
			EFA_BATTLE_SMITH,
			EFA_ALCHEMIST,
		);

		expect(battleSmithGrants(state, "XPHB")).toEqual([]);
		expect(sorted(battleSmithGrants(state, "PHB").map(spellUid))).toEqual(["Heroism|PHB", "Shield|PHB"]);
		expect(state.getClasses().find(cls => cls.source === "EFA").subclass.name).toBe("Alchemist");
		expect(state.getClasses().find(cls => cls.source === "TCE").subclass.name).toBe("Battle Smith");
	});
});
