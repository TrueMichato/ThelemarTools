import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const brew = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const barbarianFeatures = brew.classFeature.filter(it => it.className === "Barbarian" && it.classSource === "TGTT");
const marathoner = () => barbarianFeatures.find(it => it.name === "Marathoner" && it.source === "TGTT");
const oldFeature = () => ({
	...marathoner(),
	name: "Agile Sprinter",
	entries: ["You gain a bonus to Strength ({@skill Athletics}) and Dexterity ({@skill Acrobatics}) checks. The bonus equals your proficiency bonus."],
});

function makeBarbarian (level = 3) {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source: "TGTT", level});
	state.setAbilityBase("con", 14);
	state.addSaveProficiency("con");
	state.setClassFeatureCatalog(barbarianFeatures, [], []);
	return state;
}

function pickSpecialty (state, classLevel, name = "Marathoner") {
	const options = CharacterSheetClassUtils.getFeatureOptionsForLevel(
		barbarianFeatures.filter(it => it.name === "Specialties" && it.level === classLevel),
		classLevel,
		barbarianFeatures,
	);
	expect(options[0].options.some(it => it.name === name)).toBe(true);
	const qb = Object.create(CharacterSheetQuickBuild.prototype);
	qb._state = state;
	qb._page = {
		getClassFeatures: () => barbarianFeatures,
		getOptionalFeatures: () => [],
		getSubclassFeatures: () => [],
	};
	qb._selections = {featureOptions: {
		[`Barbarian_${classLevel}_Specialties`]: [{type: "classFeature", ref: "Marathoner|Barbarian|TGTT|1", name}],
	}};
	qb._getSubclassForClass = () => null;
	qb._applyFeatureOptionsForLevel({
		className: "Barbarian",
		classSource: "TGTT",
		classLevel,
		featureOptions: [{featureName: "Specialties"}],
	});
	state.applyClassFeatureEffects();
}

describe("Marathoner data and specialty lifecycle", () => {
	it("resolves the L1 and higher-level choices to the real TGTT feature and grants only Endurance", () => {
		const state = makeBarbarian(6);
		const before = Object.fromEntries(["endurance", "athletics", "acrobatics", "might"].map(skill => [skill, state.getSkillMod(skill)]));
		pickSpecialty(state, 1);
		expect(state.getFeatures().filter(it => it.name === "Marathoner")).toHaveLength(1);
		expect(state.getSkillMod("endurance") - before.endurance).toBe(state.getProficiencyBonus());
		for (const skill of ["athletics", "acrobatics", "might"]) expect(state.getSkillMod(skill)).toBe(before[skill]);
		expect(state.getMarathonerFeature()).toEqual(expect.objectContaining({name: "Marathoner", source: "TGTT"}));

		const other = makeBarbarian(6);
		pickSpecialty(other, 3);
		expect(other.getFeatures().filter(it => it.name === "Marathoner")).toHaveLength(1);
		expect(other.getMarathonerFeature()).toBeTruthy();
	});

	it("migrates an old source-qualified specialty and all its choice identifiers once without duplicate bonuses", () => {
		const state = makeBarbarian(3);
		const previous = oldFeature();
		expect(previous).toBeTruthy();
		state.addFeature({
			...previous,
			featureType: "Class",
			isFeatureOption: true,
			parentFeature: "Specialties",
			sourceDecisionKey: "Barbarian|TGTT|1|Specialties|0",
			ref: "Agile Sprinter|Barbarian|TGTT|1",
			description: previous.entries.join(" "),
		});
		const before = state.toJson();
		const oldId = before.features.find(it => it.name === "Agile Sprinter").id;
		before.namedModifiers.push(
			{name: "Agile Sprinter", type: "skill:athletics", value: 2, sourceFeatureId: oldId},
			{name: "Agile Sprinter", type: "skill:acrobatics", value: 2, note: "From Agile Sprinter"},
			{id: "manual-athletics", name: "Other Feature", type: "skill:athletics", value: 1},
		);
		before.chosenSubfeatures = [{parent: "Specialties", parentClass: "Barbarian", parentClassSource: "TGTT", level: 1, name: "Agile Sprinter", source: "TGTT"}];
		before.levelHistory = [{
			level: 1,
			class: {name: "Barbarian", source: "TGTT"},
			choices: {
				featureChoices: [{featureName: "Specialties", choice: "Agile Sprinter", source: "TGTT", ref: "Agile Sprinter|Barbarian|TGTT|1"}],
				replayData: {featureChoices: [{name: "Agile Sprinter", source: "TGTT", className: "Barbarian", classSource: "TGTT", parentFeature: "Specialties", ref: "Agile Sprinter|Barbarian|TGTT|1", acquisitionLevel: 1}]},
			},
			decisions: [{type: "featureChoice", className: "Barbarian", classSource: "TGTT", semanticKey: "Barbarian|TGTT|1|Specialties|0", selection: [{name: "Agile Sprinter", source: "TGTT", ref: "Agile Sprinter|Barbarian|TGTT|1"}]}],
		}];
		before.characterBase = {
			v: 1,
			decisions: [
				{
					type: "featureChoice",
					className: "Barbarian",
					classSource: "TGTT",
					sourceKey: "Specialties",
					semanticKey: "Barbarian|TGTT|1|Specialties|0",
					selection: ["Agile Sprinter|Barbarian|TGTT|1"],
				},
			],
		};
		const loaded = makeBarbarian(3);
		loaded.loadFromJson(before);
		loaded.setClassFeatureCatalog(barbarianFeatures, [], []);
		loaded.applyClassFeatureEffects();
		const migrated = loaded.toJson();
		expect(migrated.features.filter(it => it.name === "Marathoner")).toHaveLength(1);
		expect(migrated.features.find(it => it.id === oldId)).toEqual(expect.objectContaining({
			name: "Marathoner",
			source: "TGTT",
			classSource: "TGTT",
			ref: "Marathoner|Barbarian|TGTT|1",
			sourceDecisionKey: "Barbarian|TGTT|1|Specialties|0",
		}));
		expect(migrated.features.some(it => it.name === "Agile Sprinter")).toBe(false);
		expect(migrated.chosenSubfeatures[0].name).toBe("Marathoner");
		expect(migrated.levelHistory[0].choices.featureChoices[0]).toEqual(expect.objectContaining({choice: "Marathoner", ref: "Marathoner|Barbarian|TGTT|1"}));
		expect(migrated.levelHistory[0].choices.replayData.featureChoices[0].name).toBe("Marathoner");
		expect(migrated.levelHistory[0].decisions[0].selection[0].name).toBe("Marathoner");
		expect(migrated.levelHistory[0].decisions[0].semanticKey).toBe("Barbarian|TGTT|1|Specialties|0");
		expect(migrated.characterBase.decisions[0].selection).toEqual(["Marathoner|Barbarian|TGTT|1"]);
		expect(migrated.features.find(it => it.id === oldId).entries).toEqual(marathoner().entries);
		expect(migrated.namedModifiers.some(it => it.sourceFeatureId === oldId && it.type === "skill:athletics")).toBe(false);
		expect(migrated.namedModifiers.some(it => it.name === "Agile Sprinter" && it.type === "skill:acrobatics")).toBe(false);
		expect(migrated.namedModifiers.some(it => it.id === "manual-athletics" && it.type === "skill:athletics")).toBe(true);

		const again = makeBarbarian(3);
		again.loadFromJson(migrated);
		again.setClassFeatureCatalog(barbarianFeatures, [], []);
		again.applyClassFeatureEffects();
		expect(again.getFeatures().filter(it => it.name === "Marathoner")).toHaveLength(1);
		expect(again.toJson().characterBase.decisions[0].selection).toEqual(["Marathoner|Barbarian|TGTT|1"]);
		expect(again.toJson().namedModifiers.some(it => it.name === "Agile Sprinter")).toBe(false);
		expect(loaded.aggregateModifiers("skill:endurance").bonus).toBe(loaded.getProficiencyBonus());
		expect(again.aggregateModifiers("skill:endurance").bonus).toBe(again.getProficiencyBonus());
		for (const skill of ["athletics", "acrobatics", "might"]) expect(loaded.aggregateModifiers(`skill:${skill}`).sources).not.toContain("Agile Sprinter");
	});

	it("does not upgrade a same-named feature or choice from another class/source", () => {
		const state = makeBarbarian();
		const raw = state.toJson();
		raw.features = [
			{name: "Agile Sprinter", source: "PHB", className: "Barbarian", classSource: "PHB", featureType: "Class"},
			{name: "Agile Sprinter", source: "TGTT", className: "Rogue", classSource: "TGTT", featureType: "Class"},
		];
		raw.chosenSubfeatures = [{parent: "Specialties", parentClass: "Rogue", parentClassSource: "TGTT", name: "Agile Sprinter", source: "TGTT"}];
		state.loadFromJson(raw);
		expect(state.getFeatures().map(it => it.name)).toEqual(["Agile Sprinter", "Agile Sprinter"]);
		expect(state._data.chosenSubfeatures[0].name).toBe("Agile Sprinter");
		expect(state.getMarathonerFeature()).toBeNull();
	});
});

describe("Marathoner forced-march resolution", () => {
	it("spends exactly one selected multiclass Hit Die without healing; exhaustion follows only the final failure", () => {
		const state = makeBarbarian(3);
		pickSpecialty(state, 1);
		state.addClass({name: "Wizard", source: "PHB", level: 2});
		state.setHitDice({d12: {current: 0, max: 3}, d6: {current: 2, max: 2}});
		const hp = state.getHp().current;
		const passed = state.resolveForcedMarchSave({dc: 15, initialTotal: 9, rerollTotal: 17, dieType: "d6"});
		expect(passed).toEqual(expect.objectContaining({ok: true, passed: true, dieType: "d6", hitDiceSpent: 1}));
		expect(state.getHitDiceByType().d6.current).toBe(1);
		expect(state.getHitDiceByType().d12.current).toBe(0);
		expect(state.getHp().current).toBe(hp);
		expect(state.getExhaustion()).toBe(0);
		const failed = state.resolveForcedMarchSave({dc: 20, initialTotal: 7, rerollTotal: 8, dieType: "d6"});
		expect(failed).toEqual(expect.objectContaining({ok: true, passed: false, hitDiceSpent: 1, exhaustionGained: 1}));
		expect(state.getExhaustion()).toBe(1);
		expect(state.getHitDiceByType().d6.current).toBe(0);
	});

	it("declining preserves the first result, success costs nothing, and invalid/empty rerolls have no side effects", () => {
		const state = makeBarbarian();
		pickSpecialty(state, 1);
		const before = state.getHitDiceByType().d12.current;
		expect(state.resolveForcedMarchSave({dc: 10, initialTotal: 13})).toEqual(expect.objectContaining({ok: true, passed: true, hitDiceSpent: 0}));
		expect(state.resolveForcedMarchSave({dc: 10, initialTotal: 13, rerollTotal: 7, dieType: "d12"}).ok).toBe(false);
		expect(state.resolveForcedMarchSave({dc: 10, initialTotal: Number.NaN}).ok).toBe(false);
		expect(state.getHitDiceByType().d12.current).toBe(before);
		expect(state.getExhaustion()).toBe(0);
		expect(state.resolveForcedMarchSave({dc: 20, initialTotal: 13})).toEqual(expect.objectContaining({ok: true, passed: false, hitDiceSpent: 0, exhaustionGained: 1}));
		expect(state.getHitDiceByType().d12.current).toBe(before);
		state.setHitDice({d12: {current: 0, max: 3}});
		expect(state.resolveForcedMarchSave({dc: 20, initialTotal: 13, rerollTotal: 25, dieType: "d12"}).ok).toBe(false);
		expect(state.getExhaustion()).toBe(1);
	});
});

let CharacterSheetPage;
let savedWindow;
let savedDocument;
beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	globalThis.window = {addEventListener: () => {}, dispatchEvent: () => {}, location: {search: ""}, matchMedia: () => ({matches: false, addEventListener: () => {}})};
	globalThis.document = {querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {}, body: {classList: {add () {}, remove () {}}}};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { globalThis.window = savedWindow; globalThis.document = savedDocument; });

function makeForcedMarchPage (state, rolls = [3, 19]) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._rollD20 = jest.fn(() => {
		const roll = rolls.shift();
		return {roll, roll1: roll, mode: "normal", thelemar_critBonus: 0};
	});
	page._pPickConditionalModifiers = jest.fn(async () => ({appliedConditionalIds: new Set(), applied: [], cancelled: false}));
	page._pMaybeApplyFortuneIntervention = jest.fn(async ({effectiveRoll}) => ({effectiveRoll, note: ""}));
	page._rollStateDiceBonuses = jest.fn(() => null);
	page._rollModifierDiceBonuses = jest.fn(() => null);
	page.pAnimateD20 = jest.fn(async () => {});
	page._showDiceResult = jest.fn();
	page._renderCharacter = jest.fn();
	page._saveCurrentCharacter = jest.fn(async () => {});
	return page;
}

describe("player-facing forced-march action", () => {
	it("rolls a real-brew Marathoner Endurance skill check with the proficiency bonus", async () => {
		const state = makeBarbarian();
		const baseline = state.getSkillMod("endurance");
		pickSpecialty(state, 1);
		const page = makeForcedMarchPage(state, [10]);
		page._getExhaustionPenalty = () => 0;
		page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
		page._pRollTriggeredFeatDie = async () => null;
		page._pMaybeApplyEfaFlashOfGenius = async () => null;
		page._pMaybeApplyTacticalMind = async () => {};
		const result = await page._rollSkillCheck("endurance", "Endurance", null, "con");
		expect(result.total).toBe(10 + baseline + state.getProficiencyBonus());
		expect(result.breakdown).toContain("Marathoner");
	});

	it("preserves the chosen DC and save modifiers on the reroll and reports the final cost", async () => {
		const state = makeBarbarian();
		pickSpecialty(state, 1);
		expect(state.getMarathonerFeature()).toBeTruthy();
		const page = makeForcedMarchPage(state, [3, 19]);
		page._rollD20.mockImplementationOnce(() => ({roll: 3, roll1: 3, roll2: 2, mode: "advantage", thelemar_critBonus: 0}))
			.mockImplementationOnce(() => ({roll: 19, roll1: 19, roll2: 12, mode: "advantage", thelemar_critBonus: 0}));
		const savedInput = globalThis.InputUiUtil;
		const number = jest.spyOn(savedInput, "pGetUserNumber").mockResolvedValue(15);
		const confirm = jest.spyOn(savedInput, "pGetUserBoolean").mockResolvedValue(true);
		try {
			expect(page._forcedMarchRollPending).toBeFalsy();
			const result = await page._pRollForcedMarch({shiftKey: true});
			expect(number).toHaveBeenCalledTimes(1);
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(result).toEqual(expect.objectContaining({ok: true, passed: true, dc: 15, hitDiceSpent: 1}));
			expect(page._rollD20).toHaveBeenCalledTimes(2);
			expect(page._rollD20.mock.calls[1][0].mode).toBe("advantage");
			expect(page._showDiceResult.mock.lastCall.join(" ")).toMatch(/Forced March.*15.*Hit Die/i);
			expect(page._showDiceResult.mock.lastCall.at(-1)).toMatch(/Original 7 vs DC 15; final 23/);
			expect(state.getHp().current).toBe(0);
			expect(state.getHitDiceByType().d12.current).toBe(2);
			expect(state.getExhaustion()).toBe(0);
		} finally { number.mockRestore(); confirm.mockRestore(); }
	});

	it("keeps conditional and dice bonuses frozen on both rolls, then adds exhaustion only for a final failure", async () => {
		const state = makeBarbarian();
		pickSpecialty(state, 1);
		state.addNamedModifier({name: "March Aid", type: "save:con", value: 2, conditional: "against forced marches", enabled: false});
		const page = makeForcedMarchPage(state, [3, 4]);
		const available = state.aggregateModifiers("save:con").conditionalsAvailable;
		expect(available).toHaveLength(1);
		page._pPickConditionalModifiers.mockResolvedValue({
			appliedConditionalIds: new Set([available[0].id]),
			applied: available,
			cancelled: false,
		});
		page._rollStateDiceBonuses.mockReturnValue({total: 1, breakdownStr: "+ 1 (Bless)"});
		const number = jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValue(15);
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const result = await page._pRollForcedMarch();
			expect(result).toEqual(expect.objectContaining({initialTotal: 10, finalTotal: 11, passed: false, exhaustionGained: 1}));
			expect(page._rollStateDiceBonuses).toHaveBeenCalledTimes(1);
			expect(page._rollD20.mock.calls[1][0].mode).toBe("normal");
			expect(page._showDiceResult.mock.lastCall.join(" ")).toContain("+ 6");
			expect(page._showDiceResult.mock.lastCall.join(" ")).toContain("Bless");
			expect(state.getExhaustion()).toBe(1);
			expect(state.getHitDiceByType().d12.current).toBe(2);
		} finally { number.mockRestore(); confirm.mockRestore(); }
	});

	it("does not spend on DC cancellation; declining or lacking dice finalizes the original failure", async () => {
		const state = makeBarbarian();
		pickSpecialty(state, 1);
		const page = makeForcedMarchPage(state, [3, 4]);
		const number = jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValueOnce(null).mockResolvedValue(15);
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(false);
		try {
			expect(await page._pRollForcedMarch()).toBeUndefined();
			expect(page._rollD20).not.toHaveBeenCalled();
			expect(state.getExhaustion()).toBe(0);
			const before = state.getHitDiceByType().d12.current;
			const declined = await page._pRollForcedMarch();
			expect(declined).toEqual(expect.objectContaining({ok: true, passed: false, hitDiceSpent: 0, exhaustionGained: 1}));
			expect(page._rollD20).toHaveBeenCalledTimes(1);
			expect(state.getHitDiceByType().d12.current).toBe(before);
			state.setHitDice({d12: {current: 0, max: 3}});
			expect(await page._pRollForcedMarch()).toEqual(expect.objectContaining({passed: false, hitDiceSpent: 0, exhaustionGained: 1}));
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(state.getExhaustion()).toBe(2);
		} finally { number.mockRestore(); confirm.mockRestore(); }
	});

	it("spends only the selected multiclass die; cancelling the die picker spends none", async () => {
		const state = makeBarbarian();
		pickSpecialty(state, 1);
		state.addClass({name: "Wizard", source: "PHB", level: 2});
		state.setHitDice({d12: {current: 1, max: 3}, d6: {current: 2, max: 2}});
		const page = makeForcedMarchPage(state, [2, 18, 3]);
		const number = jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValue(15);
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const selected = jest.spyOn(globalThis.InputUiUtil, "pGetUserEnum")
			.mockResolvedValueOnce("d6 (2 remaining)")
			.mockResolvedValueOnce(null);
		try {
			const hp = state.getHp().current;
			expect(await page._pRollForcedMarch()).toEqual(expect.objectContaining({passed: true, dieType: "d6", hitDiceSpent: 1}));
			expect(state.getHitDiceByType().d6.current).toBe(1);
			expect(state.getHitDiceByType().d12.current).toBe(1);
			expect(state.getHp().current).toBe(hp);
			expect(await page._pRollForcedMarch()).toEqual(expect.objectContaining({passed: false, hitDiceSpent: 0, exhaustionGained: 1}));
			expect(page._rollD20).toHaveBeenCalledTimes(3);
			expect(state.getHitDiceByType().d6.current).toBe(1);
			expect(state.getHitDiceByType().d12.current).toBe(1);
			expect(state.getExhaustion()).toBe(1);
			expect(selected).toHaveBeenCalledTimes(2);
		} finally { number.mockRestore(); confirm.mockRestore(); selected.mockRestore(); }
	});

	it("only renders the action for an acquired TGTT Barbarian Marathoner; generic Constitution saves stay separate", () => {
		const state = makeBarbarian();
		const page = makeForcedMarchPage(state);
		let container = globalThis.e_({outer: "<div></div>"});
		globalThis.document.getElementById = () => container;
		page._formatD20BreakdownTooltip = () => "";
		page._formatModWithEffective = () => "+4";
		page._bindActivate = () => {};
		page._rollSavingThrow = jest.fn();
		page._pRollForcedMarch = jest.fn();
		page._renderSavingThrows();
		expect(container.children.some(row => row.outerHTML.includes("charsheet__forced-march-btn"))).toBe(false);
		pickSpecialty(state, 1);
		container = globalThis.e_({outer: "<div></div>"});
		page._renderSavingThrows();
		const button = container.children.find(row => row.outerHTML.includes("charsheet__forced-march-btn"));
		expect(button).toBeTruthy();
		button._handlers.click({shiftKey: true});
		expect(page._pRollForcedMarch).toHaveBeenCalledTimes(1);
		expect(page._rollSavingThrow).not.toHaveBeenCalled();
		state.setSetting("enableTgtt", false);
		container = globalThis.e_({outer: "<div></div>"});
		page._renderSavingThrows();
		expect(container.children.filter(row => row.outerHTML.includes("charsheet__forced-march-btn"))).toHaveLength(0);
	});
});
