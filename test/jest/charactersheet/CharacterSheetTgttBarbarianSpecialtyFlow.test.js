import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const FeatureModifierParser = globalThis.FeatureModifierParser;
const brew = JSON.parse(fs.readFileSync(
	new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url),
	"utf8",
));
const skills = JSON.parse(fs.readFileSync(new URL("../../../data/skills.json", import.meta.url), "utf8"));
const catalogs = {classFeatures: brew.classFeature, subclassFeatures: brew.subclassFeature};
let CharacterSheetPage;
let savedWindow;
let savedDocument;
let savedCreate;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	savedCreate = globalThis.e_;
	globalThis.e_ = (...args) => {
		const element = savedCreate(...args);
		element.querySelector = () => savedCreate({});
		return element;
	};
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
	globalThis.e_ = savedCreate;
});

function getOption (name, level) {
	const wrapper = brew.classFeature.find(feature =>
		feature.name === "Specialties"
		&& feature.className === "Barbarian"
		&& feature.classSource === "TGTT"
		&& feature.level === level,
	);
	const groups = CharacterSheetClassUtils.getFeatureOptionsForLevel([wrapper], level, brew.classFeature);
	const option = groups.flatMap(group => group.options).find(item => item.name === name);
	if (!option) throw new Error(`Missing ${name} at Barbarian level ${level}`);
	return option;
}

function createBarbarian () {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source: "TGTT", level: 1});
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 14);
	return state;
}

function selectBuilderOption (state, name) {
	const feature = CharacterSheetClassUtils.materializeFeatureOption(getOption(name, 1), {
		className: "Barbarian",
		classSource: "TGTT",
		acquisitionLevel: 1,
		parentFeature: "Specialties",
		catalogs,
	});
	state.addFeature(feature);
	state.applyClassFeatureEffects();
	return feature;
}

function selectLaterOption (state, name, level) {
	return CharacterSheetClassUtils.replaceStructuredFeatureChoice({
		state,
		characterLevel: level,
		classLevel: level,
		className: "Barbarian",
		classSource: "TGTT",
		parentFeature: "Specialties",
		parentSource: "TGTT",
		newOption: getOption(name, level),
		catalogs,
	});
}

function createBuilder (state, name) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = state;
	builder._selectedClass = {name: "Barbarian", source: "TGTT"};
	builder._selectedFeatureOptions = {Specialties_TGTT: [getOption(name, 1)]};
	builder._selectedFeatureSkillChoices = {};
	builder._page = {
		getClassFeatures: () => brew.classFeature,
		getSubclassFeatures: () => brew.subclassFeature,
		getOptionalFeatures: () => [],
	};
	return builder;
}

function createQuickBuild (state, name, level) {
	const build = Object.create(CharacterSheetQuickBuild.prototype);
	build._state = state;
	build._page = {
		getClassFeatures: () => brew.classFeature,
		getSubclassFeatures: () => brew.subclassFeature,
		getOptionalFeatures: () => [],
	};
	build._getSubclassForClass = () => null;
	build._selections = {featureOptions: {[`Barbarian_${level}_Specialties`]: [getOption(name, level)]}};
	return build;
}

beforeEach(() => {
	// The real Renderer turns {@skill} into HTML links. Unlike the default Jest
	// JSON-stringifying Renderer stub, this exercises the production HTML-to-parser boundary.
	jest.spyOn(Renderer, "get").mockReturnValue({
		render: ({entries}) => `<p>${entries.map(entry => String(entry)
			.replace(/\{@skill\s+([^|}]+)(?:\|[^}]*)?\}/g, "<a href=\"skills.html\">$1</a>"))
			.join("</p><p>")}</p>`,
	});
});

afterEach(() => jest.restoreAllMocks());

describe("TGTT Barbarian selected Specialty flow", () => {
	test("Mark of the Wilderness swaps both Charisma skills but grants PB only to Intimidation", async () => {
		const state = createBarbarian();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("cha", 8);
		expect(state.getSkillMod("persuasion")).toBe(-1);
		selectBuilderOption(state, "Mark of the Wilderness");

		const mark = state.getFeatures().find(feature => feature.name === "Mark of the Wilderness");
		expect(state._data.namedModifiers.filter(mod => mod.sourceFeatureId === mark.id).map(mod => mod.type).sort())
			.toEqual(["abilitySwap:intimidation", "abilitySwap:persuasion", "skill:intimidation"]);
		expect(state.getSkillAbility("persuasion")).toBe("str");
		expect(state.getSkillMod("persuasion")).toBe(4);
		expect(state.getSkillMod("intimidation")).toBe(4 + state.getProficiencyBonus());
		expect(state.getSkillProficiency("persuasion")).toBe(0);

		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._combat = null;
		page._getExhaustionPenalty = () => 0;
		page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
		page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
		page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
		page._pMaybeApplyTacticalMind = async () => {};
		page._pMaybeApplyBloodPrice = async () => {};
		page.pAnimateD20 = async () => {};
		page._showDiceResult = jest.fn();
		expect((await page._rollSkillCheck("persuasion", "Persuasion", null)).total).toBe(14);
		expect((await page._rollSkillCheck("intimidation", "Intimidation", null)).total).toBe(16);

		const legacySave = state.toJson();
		legacySave.namedModifiers = legacySave.namedModifiers.filter(mod => mod.sourceFeatureId !== mark.id || mod.type === "skill:intimidation");
		legacySave.namedModifiers.push({
			id: "legacy-misparsed-charisma",
			name: "Mark of the Wilderness",
			type: "abilitySwap:charisma",
			value: 0,
			newAbility: "str",
			oldAbility: "cha",
			enabled: true,
			sourceFeatureId: mark.id,
		});
		const reloaded = createBarbarian();
		reloaded.loadFromJson(legacySave);
		expect(reloaded._data.namedModifiers.filter(mod => mod.sourceFeatureId === mark.id && mod.type.startsWith("abilitySwap:"))
			.map(mod => mod.type).sort()).toEqual(["abilitySwap:intimidation", "abilitySwap:persuasion"]);
		expect(reloaded.getSkillMod("persuasion")).toBe(4);

		state.removeFeature(mark.id);
		expect(state.getSkillMod("persuasion")).toBe(-1);
		expect(state.getSkillMod("intimidation")).toBe(-1);
	});

	test("Builder and Quick Build install simultaneous choices through their real apply methods", () => {
		const state = createBarbarian();
		createBuilder(state, "Unyielding Might")._applySelectedFeatureOptions();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		createQuickBuild(state, "Lead the Pack", 6)._applyFeatureOptionsForLevel({
			className: "Barbarian",
			classSource: "TGTT",
			characterLevel: 6,
			classLevel: 6,
			featureOptions: [{featureName: "Specialties", featureSource: "TGTT"}],
		});
		state.applyClassFeatureEffects();
		expect(state.getFeatures().filter(feature =>
			["Unyielding Might", "Lead the Pack"].includes(feature.name))).toHaveLength(2);
		expect(["might", "athletics", "acrobatics"].map(skill => state.getSkillMod(skill))).toEqual([5, 5, 5]);
	});

	test("Level Up installs the L6 Specialty alongside an earlier Builder pick", async () => {
		const state = createBarbarian();
		createBuilder(state, "Unyielding Might")._applySelectedFeatureOptions();
		state.addClass({name: "Barbarian", source: "TGTT", level: 5});
		const levelUp = Object.create(CharacterSheetLevelUp.prototype);
		levelUp._state = state;
		levelUp._page = {
			getState: () => state,
			getClasses: () => brew.class,
			getClassFeatures: () => brew.classFeature,
			getSubclassFeatures: () => brew.subclassFeature,
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
			classEntry: state.getClasses().find(cls => cls.name === "Barbarian"),
			newLevel: 6,
			asiChoices: {},
			selectedFeat: null,
			selectedSubclass: null,
			selectedSubclassChoice: null,
			selectedOptionalFeatures: {},
			selectedCombatTraditions: null,
			selectedWeaponMasteries: null,
			selectedFeatureOptions: {Specialties_TGTT: [getOption("Lead the Pack", 6)]},
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
			classData: brew.class.find(cls => cls.name === "Barbarian" && cls.source === "TGTT"),
		});
		expect(["might", "athletics", "acrobatics"].map(skill => state.getSkillMod(skill))).toEqual([5, 5, 5]);
		expect(state.getFeatures().filter(feature => ["Unyielding Might", "Lead the Pack"].includes(feature.name))).toHaveLength(2);
	});

	test("Builder L1 Unyielding Might and later Lead the Pack coexist with exact permanent skill targets", () => {
		const state = createBarbarian();
		selectBuilderOption(state, "Unyielding Might");
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		selectLaterOption(state, "Lead the Pack", 6);

		const might = state.getFeatures().find(feature => feature.name === "Unyielding Might");
		const lead = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		expect(might.entries).toEqual(brew.classFeature.find(feature => feature.name === might.name && feature.source === "TGTT").entries);
		expect(lead.entries).toEqual(brew.classFeature.find(feature => feature.name === lead.name && feature.source === "TGTT").entries);
		expect(might.description).toContain("Might");
		expect(lead.description).toContain("Athletics");
		expect(lead.description).toContain("Acrobatics");
		expect(lead.description).toContain("proficiency bonus for each skill");
		expect(lead.description).toContain("Separately, when your group makes a group");

		const ownerMods = feature => state._data.namedModifiers.filter(mod => mod.sourceFeatureId === feature.id);
		expect(ownerMods(might).map(mod => mod.type)).toEqual(["skill:might"]);
		expect(ownerMods(lead).map(mod => mod.type).sort()).toEqual(["skill:acrobatics", "skill:athletics"]);
		for (const mod of [...ownerMods(might), ...ownerMods(lead)]) {
			expect(mod).toMatchObject({
				enabled: true,
				proficiencyBonus: true,
				sourceType: "classFeature",
			});
			expect(mod.conditional).toBeUndefined();
		}
		expect(["might", "athletics", "acrobatics"].map(skill => state.getSkillMod(skill))).toEqual([5, 5, 5]);
		for (const [skill, owner] of [["might", might], ["athletics", lead], ["acrobatics", lead]]) {
			expect(state.getSkillBreakdown(skill).components).toContainEqual(expect.objectContaining({
				name: owner.name,
				value: 3,
			}));
			expect(state.aggregateModifiers(`skill:${skill}`).conditionalsAvailable).toEqual([]);
		}
	});

	test("a TGTT Specialty left on a PHB Barbarian does not grant TGTT skills", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "PHB", level: 6});
		state.setAbilityBase("str", 14);
		selectBuilderOption(state, "Unyielding Might");
		const feature = state.getFeatures().find(it => it.name === "Unyielding Might");
		expect(state.getSkillMod("might")).toBe(2);
		expect(state.getSkillMod("athletics")).toBe(2);
		expect(state.aggregateModifiers("skill:might").sources).not.toContain("Unyielding Might");
		const save = state.toJson();
		save.namedModifiers.push({
			id: "stale-phb",
			name: "Unyielding Might",
			type: "skill:athletics",
			value: 3,
			enabled: true,
			sourceFeatureId: feature.id,
		});
		const loaded = new CharacterSheetState();
		loaded.setClassFeatureCatalog(brew.classFeature, brew.subclassFeature);
		loaded.loadFromJson(save);
		expect(loaded._data.namedModifiers.some(mod => mod.id === "stale-phb")).toBe(false);
		expect(loaded.getSkillMod("athletics")).toBe(2);
		expect(loaded.getSkillMod("might")).toBe(2);

		const missingOwnerSource = JSON.parse(JSON.stringify(save));
		delete missingOwnerSource.features.find(it => it.id === feature.id).classSource;
		loaded.loadFromJson(missingOwnerSource);
		expect(loaded.getSkillMod("athletics")).toBe(2);
		expect(loaded.getSkillMod("might")).toBe(2);
	});

	test("sheet skill rows and actual skill rolls use each selected Specialty once", async () => {
		const state = createBarbarian();
		selectBuilderOption(state, "Unyielding Might");
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		selectLaterOption(state, "Lead the Pack", 6);
		state.applyClassFeatureEffects();

		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._skillsData = [
			...skills.skill.filter(skill => ["Athletics", "Acrobatics", "Perception"].includes(skill.name)),
			...brew.skill.filter(skill => skill.name === "Might"),
		];
		page._renderLoreSkillsSection = () => {};
		page._getSkillHoverLink = skill => skill.name;
		page._bindActivate = () => {};

		const container = savedCreate({});
		container.classList = {toggle: () => {}};
		const oldGetElementById = globalThis.document.getElementById;
		globalThis.document.getElementById = () => container;
		try {
			page._renderSkills();
		} finally {
			globalThis.document.getElementById = oldGetElementById;
		}
		const row = key => container._children.find(element => element._html?.includes(`data-skill="${key}"`));
		expect(row("might")._html).toContain("Unyielding Might");
		expect(row("athletics")._html).toContain("Lead the Pack");
		expect(row("acrobatics")._html).toContain("Lead the Pack");
		expect(row("perception")._html).not.toContain("Lead the Pack");
		expect(row("athletics")._html).not.toContain("Unyielding Might");
		for (const key of ["might", "athletics", "acrobatics"]) {
			expect(row(key)._html).toContain(">(+5)</span>");
			expect(row(key)._html).toContain(`title="Passive ${key[0].toUpperCase()}${key.slice(1)}: 15"`);
			expect(state.getSkillBreakdown(key).components).toEqual(expect.arrayContaining([
				expect.objectContaining({value: 3}),
			]));
		}

		page._combat = null;
		page._getExhaustionPenalty = () => 0;
		page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
		page._pPickConditionalModifiers = async () => ({appliedConditionalIds: new Set(), applied: [], cancelled: false});
		page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
		page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
		page._pMaybeApplyTacticalMind = async () => {};
		page._pMaybeApplyBloodPrice = async () => {};
		page.pAnimateD20 = async () => {};
		page._showDiceResult = jest.fn();

		for (const [key, label, total, source] of [
			["might", "Might", 15, "Unyielding Might"],
			["athletics", "Athletics", 15, "Lead the Pack"],
			["acrobatics", "Acrobatics", 15, "Lead the Pack"],
			["perception", "Perception", 10, ""],
		]) {
			expect((await page._rollSkillCheck(key, label, null)).total).toBe(total);
			const [, shownTotal, breakdown] = page._showDiceResult.mock.lastCall;
			expect(shownTotal).toBe(total);
			if (source) expect(breakdown).toContain(source);
			else expect(breakdown).not.toMatch(/Unyielding Might|Lead the Pack/);
		}
	});

	test("TGTT Endurance PB prose is scoped to Endurance, not ordinary endurance or other skills", () => {
		const description = "You gain a bonus to Constitution ({@skill Endurance|TGTT}) checks. The bonus equals your proficiency bonus.";
		const positive = FeatureModifierParser.parseModifiers(
			description,
			"TGTT Endurance Training",
		);
		expect(positive).toEqual([expect.objectContaining({
			type: "skill:endurance",
			proficiencyBonus: true,
			conditional: null,
		})]);
		const state = createBarbarian();
		state.setAbilityBase("con", 14);
		state.addFeature({
			name: "TGTT Endurance Training",
			source: "TGTT",
			className: "Barbarian",
			classSource: "TGTT",
			featureType: "Class",
			description,
		});
		expect(state.getSkillMod("endurance")).toBe(2 + state.getProficiencyBonus());
		expect(state.getSkillMod("athletics")).toBe(2);
		expect(state.getSkillMod("might")).toBe(2);
		const owner = state.getFeatures().find(feature => feature.name === "TGTT Endurance Training");
		expect(state._data.namedModifiers.filter(mod => mod.sourceFeatureId === owner.id)).toEqual([expect.objectContaining({
			type: "skill:endurance",
			sourceType: "classFeature",
		})]);
		expect(FeatureModifierParser.parseModifiers(
			"Your endurance might help you withstand a forced march; it is not a bonus to Endurance checks.",
			"Mundane Effort",
		)).toEqual([]);
	});

	test("loading old feature-owned modifiers repairs wrong targets and missing grants without changing manual or foreign modifiers", () => {
		const state = createBarbarian();
		selectBuilderOption(state, "Unyielding Might");
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		selectLaterOption(state, "Lead the Pack", 6);
		const save = state.toJson();
		const might = save.features.find(feature => feature.name === "Unyielding Might" && feature.source === "TGTT");
		const lead = save.features.find(feature => feature.name === "Lead the Pack" && feature.source === "TGTT");
		const staleMight = save.namedModifiers.find(mod => mod.sourceFeatureId === might.id);
		const staleLead = save.namedModifiers.find(mod => mod.sourceFeatureId === lead.id && mod.type === "skill:athletics");
		might.description = "You gain a bonus to Strength ({@skill Athletics}) checks. The bonus equals your proficiency bonus.";
		might.entries = [might.description];
		lead.description = "You gain a bonus to Strength ({@skill Athletics}) checks. The bonus equals your proficiency bonus.";
		lead.entries = [lead.description];
		save.features.push({
			id: "foreign-feature",
			name: "Unyielding Might",
			source: "HB",
			className: "Barbarian",
			classSource: "HB",
			featureType: "Class",
			description: "",
		});
		save.namedModifiers = [
			{...staleMight, type: "skill:athletics", sourceType: undefined},
			{...staleLead, enabled: false, conditional: "when your group checks", sourceType: undefined},
			{id: "manual", name: "Unyielding Might", type: "skill:acrobatics", value: 1, enabled: true},
			{id: "foreign", name: "Unyielding Might", type: "skill:athletics", value: 2, enabled: true, sourceFeatureId: "foreign-feature"},
		];

		const reloaded = new CharacterSheetState();
		reloaded.setClassFeatureCatalog(brew.classFeature, brew.subclassFeature);
		reloaded.loadFromJson(save);
		const owned = feature => reloaded._data.namedModifiers.filter(mod => mod.sourceFeatureId === feature.id);
		expect(owned(might).map(mod => mod.type)).toEqual(["skill:might"]);
		expect(owned(lead).map(mod => mod.type).sort()).toEqual(["skill:acrobatics", "skill:athletics"]);
		expect([...owned(might), ...owned(lead)].every(mod =>
			mod.sourceType === "classFeature" && mod.enabled && mod.proficiencyBonus && !mod.conditional,
		)).toBe(true);
		expect(reloaded._data.namedModifiers).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "manual", type: "skill:acrobatics", value: 1}),
			expect.objectContaining({id: "foreign", type: "skill:athletics", value: 2}),
		]));
		expect(reloaded.getFeatures().find(feature => feature.id === might.id).description).toContain("Might");
		expect(reloaded.getFeatures().find(feature => feature.id === lead.id).description).toContain("Acrobatics");
		expect(["might", "athletics", "acrobatics"].map(skill => reloaded.getSkillMod(skill))).toEqual([5, 7, 6]);

		reloaded.loadFromJson(reloaded.toJson());
		expect(owned(might)).toHaveLength(1);
		expect(owned(lead)).toHaveLength(2);
		expect(reloaded._data.namedModifiers.filter(mod => ["manual", "foreign"].includes(mod.id))).toHaveLength(2);

		// Initial page load may register the brew catalog only during reconciliation.
		const lateCatalog = new CharacterSheetState();
		lateCatalog.loadFromJson(save);
		lateCatalog.setClassFeatureCatalog(brew.classFeature, brew.subclassFeature);
		lateCatalog.applyClassFeatureEffects();
		expect(lateCatalog.getFeatures().find(feature => feature.id === might.id).description).toContain("Might");
		expect(lateCatalog.getFeatures().find(feature => feature.id === lead.id).description).toContain("Acrobatics");
		expect(lateCatalog._data.namedModifiers.filter(mod => mod.sourceFeatureId === might.id).map(mod => mod.type)).toEqual(["skill:might"]);
		expect(lateCatalog._data.namedModifiers.filter(mod => mod.sourceFeatureId === lead.id).map(mod => mod.type).sort())
			.toEqual(["skill:acrobatics", "skill:athletics"]);
		lateCatalog.setClassFeatureCatalog(brew.classFeature, brew.subclassFeature);
		lateCatalog.applyClassFeatureEffects();
		expect(lateCatalog._data.namedModifiers.filter(mod => mod.sourceFeatureId === might.id)).toHaveLength(1);
		expect(lateCatalog._data.namedModifiers.filter(mod => mod.sourceFeatureId === lead.id)).toHaveLength(2);
	});
});
