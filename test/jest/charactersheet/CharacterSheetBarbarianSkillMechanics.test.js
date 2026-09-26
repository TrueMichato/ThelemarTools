import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureChoiceParser = globalThis.FeatureChoiceParser;
const FeatureModifierParser = globalThis.FeatureModifierParser;
const core = JSON.parse(fs.readFileSync(new URL("../../../data/class/class-barbarian.json", import.meta.url), "utf8"));
const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url), "utf8"));
const primal = core.classFeature.find(feature => feature.name === "Primal Knowledge" && feature.source === "XPHB");
const optionalPrimal = core.classFeature.find(feature => feature.name === "Primal Knowledge" && feature.source === "TCE");
let CharacterSheetPage;

beforeAll(async () => {
	const previousWindow = globalThis.window;
	const previousDocument = globalThis.document;
	globalThis.window = {addEventListener: () => {}, location: {search: ""}};
	globalThis.document = {querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {}};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
	globalThis.window = previousWindow;
	globalThis.document = previousDocument;
});

function createBarbarian (source = "XPHB", level = 3) {
	const state = new CharacterSheetState();
	state.setClassCatalog([...core.class, ...brew.class]);
	state.setClassFeatureCatalog([...core.classFeature, ...brew.classFeature], brew.subclassFeature);
	state.addClass({name: "Barbarian", source, level});
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 10);
	state.setAbilityBase("wis", 14);
	state.setAbilityBase("cha", 8);
	return state;
}

function grantPrimal (state) {
	state.addFeature({...primal, featureType: "Class", description: primal.entries.join(" ")});
	return state.getFeatures().find(feature => feature.name === "Primal Knowledge" && feature.source === "XPHB");
}

function makeRollPage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._getExhaustionPenalty = () => 0;
	page._rollD20 = jest.fn(() => ({roll: 10, mode: "normal", thelemar_critBonus: 0}));
	page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
	page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
	page._pMaybeApplyTacticalMind = async () => {};
	page._pMaybeApplyBloodPrice = async () => {};
	page.pAnimateD20 = async () => {};
	page._showDiceResult = jest.fn();
	return page;
}

describe("XPHB Primal Knowledge skill choice", () => {
	test("uses the XPHB Barbarian level-1 skill list and grants one new proficiency", () => {
		const state = createBarbarian();
		state.setSkillProficiency("athletics", 1);
		expect(FeatureChoiceParser.extractChoices(primal).skillChoices).toHaveLength(1);
		const feature = grantPrimal(state);
		const choices = state.getPendingFeatureChoices().filter(choice => choice.kind === "skill");
		expect(choices).toHaveLength(1);
		expect(choices[0].featureId).toBe(feature.id);
		expect(choices[0].options.slice().sort()).toEqual(
			["animalhandling", "intimidation", "nature", "perception", "survival"].sort(),
		);
		expect(state.getSkillProficiency("survival")).toBe(0);
		expect(state.fulfillFeatureChoice(choices[0].id, "survival")).toBe(true);
		expect(state.getSkillProficiency("survival")).toBe(1);
		expect(state.getSkillMod("survival")).toBe(4);
		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state.getPendingFeatureChoices()).toHaveLength(0);
		state.addFeature({...primal, featureType: "Class", description: primal.entries.join(" ")});
		expect(state.getPendingFeatureChoices()).toHaveLength(0);
	});

	test("rejects an already-known or off-list selection without consuming the choice", () => {
		const state = createBarbarian();
		state.setSkillProficiency("athletics", 1);
		grantPrimal(state);
		const [choice] = state.getPendingFeatureChoices();
		expect(choice.options).not.toContain("athletics");
		expect(state.fulfillFeatureChoice(choice.id, "athletics")).toBe(false);
		expect(state.fulfillFeatureChoice(choice.id, "stealth")).toBe(false);
		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state.getSkillProficiency("stealth")).toBe(0);
		expect(state.getPendingFeatureChoices()).toHaveLength(1);
	});

	test("TGTT ownership includes Endurance and Might despite the XPHB feature reference", () => {
		const state = createBarbarian("TGTT");
		grantPrimal(state);
		const [choice] = state.getPendingFeatureChoices();
		expect(choice.options.slice().sort()).toEqual(
			["animalhandling", "athletics", "endurance", "intimidation", "might", "nature", "perception", "survival"].sort(),
		);
		expect(state.fulfillFeatureChoice(choice.id, "endurance")).toBe(true);
		expect(state.getSkillProficiency("endurance")).toBe(1);
		expect(state.getSkillProficiency("might")).toBe(0);
	});

	test("the shared sheet picker consumes the queued level-three decision and rerenders", async () => {
		const state = createBarbarian("TGTT");
		state.setSkillProficiency("animalhandling", 1);
		grantPrimal(state);
		const page = makeRollPage(state);
		page.getFilteredSpellData = () => [];
		page._pPickFeatureChoice = jest.fn(async choice => choice.options[0]);
		page.saveCharacter = jest.fn(async () => {});
		page.renderCharacter = jest.fn();
		expect(await page.processPendingFeatureChoices()).toBe(true);
		expect(page._pPickFeatureChoice).toHaveBeenCalledWith(expect.objectContaining({
			featureName: "Primal Knowledge",
			kind: "skill",
			count: 1,
			options: expect.not.arrayContaining(["animalhandling"]),
		}));
		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state.getPendingFeatureChoices()).toHaveLength(0);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});

	test("a final untrained class skill remains selectable without upgrading known skills", () => {
		const state = createBarbarian();
		for (const skill of ["animalhandling", "athletics", "intimidation", "nature", "perception"]) {
			state.setSkillProficiency(skill, 1);
		}
		grantPrimal(state);
		const [choice] = state.getPendingFeatureChoices();
		expect(choice.options).toEqual(["survival"]);
		expect(state.fulfillFeatureChoice(choice.id, "survival")).toBe(true);
		expect(state.getSkillProficiency("survival")).toBe(1);
		expect(state.getSkillProficiency("athletics")).toBe(1);
	});

	test("an exhausted class skill list stays unresolved rather than claiming a duplicate", () => {
		const state = createBarbarian();
		for (const skill of ["animalhandling", "athletics", "intimidation", "nature", "perception", "survival"]) {
			state.setSkillProficiency(skill, 1);
		}
		grantPrimal(state);
		const [choice] = state.getPendingFeatureChoices();
		expect(choice).toMatchObject({kind: "skill", fromClassSkillList: true});
		expect(state.fulfillFeatureChoice(choice.id, "animalhandling")).toBe(false);
		expect(state.getPendingFeatureChoices()).toHaveLength(1);
	});

	test("a deferred skill choice survives save/load and grants exactly the later pick", () => {
		const state = createBarbarian("TGTT");
		state.setSkillProficiency("animalhandling", 1);
		grantPrimal(state);
		const loaded = new CharacterSheetState();
		loaded.setClassCatalog([...core.class, ...brew.class]);
		loaded.loadFromJson(state.toJson());
		const [choice] = loaded.getPendingFeatureChoices();
		expect(choice).toMatchObject({fromClassSkillList: true, count: 1});
		expect(choice.options).not.toContain("animalhandling");
		expect(loaded.fulfillFeatureChoice(choice.id, "might")).toBe(true);
		expect(loaded.getSkillProficiency("might")).toBe(1);
		loaded.loadFromJson(loaded.toJson());
		expect(loaded.getPendingFeatureChoices()).toHaveLength(0);
		expect(loaded.getSkillProficiency("might")).toBe(1);
	});

	test.each([
		["XPHB", core.class, ["animalhandling", "athletics", "intimidation", "nature", "perception", "survival"], "perception"],
		["TGTT", brew.class, ["animalhandling", "athletics", "endurance", "intimidation", "might", "nature", "perception", "survival"], "endurance"],
	])("%s old save reconciles the owning class skill choice without a preloaded catalog", (source, classes, options, selected) => {
		const original = new CharacterSheetState();
		original.addClass({name: "Barbarian", source, level: 3});
		const state = new CharacterSheetState();
		state.loadFromJson(original.toJson());
		expect(state.getFeatures()).toHaveLength(0);
		expect(state._classCatalog || []).toHaveLength(0);
		const classData = classes.find(cls => cls.name === "Barbarian" && cls.source === source);
		const reconcile = () => globalThis.CharacterSheetClassUtils.reconcileClassFeatures(state, {
			getClassData: (name, classSource) => name === "Barbarian" && classSource === source ? classData : null,
			classFeatures: [...core.classFeature, ...brew.classFeature],
		});
		expect(reconcile().added).toBeGreaterThan(0);
		const choices = state.getPendingFeatureChoices().filter(choice => choice.featureName === "Primal Knowledge");
		expect(choices).toHaveLength(1);
		expect(choices[0].options.slice().sort()).toEqual(options.slice().sort());
		expect(state.fulfillFeatureChoice(choices[0].id, selected)).toBe(true);
		expect(state.getSkillProficiency(selected)).toBe(1);
		expect(reconcile().added).toBe(0);
		expect(state.getPendingFeatureChoices()).toHaveLength(0);
		expect(state.getSkillProficiency(selected)).toBe(1);
	});

	test("reconciliation refreshes only the owning class entry when a partial catalog is installed", () => {
		const state = createBarbarian("TGTT");
		const owner = brew.class.find(cls => cls.name === "Barbarian" && cls.source === "TGTT");
		const unrelated = core.class.find(cls => cls.name === "Barbarian" && cls.source === "PHB");
		state.setClassCatalog([unrelated, {...owner, startingProficiencies: {skills: []}}]);
		expect(globalThis.CharacterSheetClassUtils.reconcileClassFeatures(state, {
			getClassData: (name, source) => name === "Barbarian" && source === "TGTT" ? owner : null,
			classFeatures: [...core.classFeature, ...brew.classFeature],
		}).added).toBeGreaterThan(0);
		expect(state._classCatalog[0]).toBe(unrelated);
		expect(state._classCatalog[1]).toBe(owner);
		const [choice] = state.getPendingFeatureChoices().filter(entry => entry.featureName === "Primal Knowledge");
		expect(choice.options).toContain("endurance");
		expect(choice.options).toContain("might");
	});

	test("reconciliation does not borrow another class's list when owner data lacks skills", () => {
		const state = createBarbarian("XPHB");
		const owner = core.class.find(cls => cls.name === "Barbarian" && cls.source === "XPHB");
		state.setClassCatalog([core.class.find(cls => cls.name === "Barbarian" && cls.source === "PHB")]);
		expect(() => globalThis.CharacterSheetClassUtils.reconcileClassFeatures(state, {
			getClassData: () => ({...owner, startingProficiencies: {skills: []}}),
			classFeatures: core.classFeature,
		})).toThrow("Cannot resolve level-1 Barbarian skill list for Primal Knowledge (XPHB)");
	});
});

describe("XPHB Primal Knowledge conditional Strength checks", () => {
	test("the parser marks only five swaps as Rage-gated, not all ability checks", () => {
		const swaps = FeatureModifierParser.parseModifiers(primal.entries.join(" "), primal.name)
			.filter(mod => mod.type.startsWith("abilitySwap:"));
		expect(swaps.map(mod => mod.type).sort()).toEqual([
			"abilitySwap:acrobatics", "abilitySwap:intimidation", "abilitySwap:perception",
			"abilitySwap:stealth", "abilitySwap:survival",
		]);
		expect(swaps.every(mod => mod.newAbility === "str" && mod.requiresStateTypeId === "rage")).toBe(true);
	});

	test("skill row, actual roll and Rage advantage follow the selected ability immediately", async () => {
		const state = createBarbarian("TGTT");
		grantPrimal(state);
		const page = makeRollPage(state);
		const ordinary = {acrobatics: 0, intimidation: -1, perception: 2, stealth: 0, survival: 2};
		for (const [skill, mod] of Object.entries(ordinary)) {
			expect(state.getSkillMod(skill)).toBe(mod);
			expect(state.getSkillBreakdown(skill).total).toBe(mod);
		}
		expect((await page._rollSkillCheck("stealth", "Stealth", null)).total).toBe(10);
		expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(false);

		state.activateState("rage");
		for (const skill of Object.keys(ordinary)) {
			expect(state.getSkillAbility(skill)).toBe("str");
			expect(state.getSkillMod(skill)).toBe(4);
			expect(state.getSkillBreakdown(skill)).toMatchObject({ability: "str", total: 4});
			expect((await page._rollSkillCheck(skill, skill, null)).total).toBe(14);
			expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(true);
		}
		expect(state.getSkillBreakdown("acrobatics")).toMatchObject({canonical: 0, total: 4});
		expect(state.getSkillBreakdown("acrobatics").components).toContainEqual(
			expect.objectContaining({name: expect.stringContaining("Primal Knowledge"), value: 4, isCanonical: false}),
		);
		expect(state.getSkillAbility("persuasion")).toBe("cha");
		expect(state.getSkillMod("persuasion")).toBe(-1);
		expect(state.getSkillAbility("athletics")).toBe("str");
		state.deactivateState("rage");
		expect(state.getSkillAbility("stealth")).toBe("dex");
		expect(state.getSkillMod("stealth")).toBe(0);
		expect((await page._rollSkillCheck("stealth", "Stealth", null)).total).toBe(10);
		expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(false);
	});

	test("player-favorable swaps respect stronger base scores, manual pins and one-roll overrides", () => {
		const state = createBarbarian();
		grantPrimal(state);
		state.setAbilityBase("dex", 20);
		state.activateState("rage");
		expect(state.getSkillAbility("acrobatics")).toBe("dex");
		expect(state.getSkillMod("acrobatics")).toBe(5);
		state.setAbilityBase("dex", 12);
		state.setSkillAbilityOverride("acrobatics", "dex");
		expect(state.getSkillAbility("acrobatics")).toBe("dex");
		expect(state.getSkillModWithAbility("acrobatics", "str")).toBe(4);
		state.clearSkillAbilityOverride("acrobatics");
		expect(state.getSkillAbility("acrobatics")).toBe("str");
	});

	test("an always-on swap still competes fairly with the Rage-only candidate", () => {
		const state = createBarbarian();
		grantPrimal(state);
		state.setAbilityBase("int", 20);
		state.addNamedModifier({name: "Other training", type: "abilitySwap:perception", newAbility: "int"});
		expect(state.getSkillAbility("perception")).toBe("int");
		state.activateState("rage");
		expect(state.getSkillAbility("perception")).toBe("int");
		expect(state.getSkillMod("perception")).toBe(5);
		state.setAbilityBase("int", 10);
		expect(state.getSkillAbility("perception")).toBe("str");
		expect(state.getSkillBreakdown("perception")).toMatchObject({canonical: 2, total: 4});
		state.deactivateState("rage");
		expect(state.getSkillAbility("perception")).toBe("wis");
	});

	test("an explicit ability on the actual skill roll overrides the Rage swap and its advantage", async () => {
		const state = createBarbarian();
		grantPrimal(state);
		state.activateState("rage");
		const page = makeRollPage(state);
		expect((await page._rollSkillCheck("acrobatics", "Acrobatics", null, "dex")).total).toBe(10);
		expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(false);
		expect((await page._rollSkillCheck("acrobatics", "Acrobatics", null)).total).toBe(14);
		expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(true);
		state.addActiveState("custom", {
			name: "Acrobatics training",
			customEffects: [{type: "advantage", target: "skill:acrobatics"}],
		});
		expect((await page._rollSkillCheck("acrobatics", "Acrobatics", null, "dex")).total).toBe(10);
		expect(page._rollD20.mock.lastCall[0].stateAdvantage).toBe(true);
	});

	test("overlapping specialty and Primal Knowledge do not double-grant Intimidation", () => {
		const state = createBarbarian("TGTT");
		const mark = brew.classFeature.find(feature => feature.name === "Mark of the Wilderness" && feature.classSource === "TGTT");
		state.addFeature({...mark, featureType: "Class", description: mark.entries.join(" ")});
		grantPrimal(state);
		const withoutRage = state.getSkillMod("intimidation");
		expect(withoutRage).toBe(4 + state.getProficiencyBonus());
		state.activateState("rage");
		expect(state.getSkillMod("intimidation")).toBe(withoutRage);
		expect(state.getSkillMod("persuasion")).toBe(4);
		state.deactivateState("rage");
		expect(state.getSkillMod("intimidation")).toBe(withoutRage);
	});

	test("save/load migration preserves Rage gating, idempotence and feature removal", () => {
		const state = createBarbarian();
		const feature = grantPrimal(state);
		const choice = state.getPendingFeatureChoices()[0];
		state.fulfillFeatureChoice(choice.id, "perception");
		const save = state.toJson();
		save.namedModifiers = save.namedModifiers.filter(mod => mod.sourceFeatureId !== feature.id);
		const loaded = new CharacterSheetState();
		loaded.setClassCatalog([...core.class, ...brew.class]);
		loaded.loadFromJson(save);
		const owned = () => loaded._data.namedModifiers.filter(mod => mod.sourceFeatureId === feature.id && mod.type.startsWith("abilitySwap:"));
		expect(owned()).toHaveLength(5);
		expect(owned().every(mod => mod.requiresStateTypeId === "rage")).toBe(true);
		expect(loaded.getSkillProficiency("perception")).toBe(1);
		expect(loaded.getPendingFeatureChoices()).toHaveLength(0);
		expect(loaded.getSkillAbility("stealth")).toBe("dex");
		loaded.activateState("rage");
		expect(loaded.getSkillAbility("stealth")).toBe("str");
		loaded.deactivateState("rage");
		loaded.loadFromJson(loaded.toJson());
		expect(owned()).toHaveLength(5);
		loaded.removeFeature(feature.id);
		expect(owned()).toHaveLength(0);
		expect(loaded.getSkillProficiency("perception")).toBe(0);
	});

	test("PHB/TCE optional Primal Knowledge and level-two Barbarians do not inherit the XPHB swap", () => {
		const phb = createBarbarian("PHB");
		phb.addFeature({...optionalPrimal, featureType: "Class", description: optionalPrimal.entries.join(" ")});
		phb.activateState("rage");
		expect(phb.getSkillAbility("stealth")).toBe("dex");
		expect(phb.getSkillMod("stealth")).toBe(0);
		expect(phb._data.namedModifiers.filter(mod => mod.type.startsWith("abilitySwap:"))).toEqual([]);
		const levelTwo = createBarbarian("XPHB", 2);
		levelTwo.activateState("rage");
		expect(levelTwo.getSkillAbility("stealth")).toBe("dex");
		expect(levelTwo.getPendingFeatureChoices()).toHaveLength(0);
	});
});
