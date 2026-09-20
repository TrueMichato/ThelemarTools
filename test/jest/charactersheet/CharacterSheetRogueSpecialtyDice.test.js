import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

let CharacterSheetPage;
let savedWindow;
let savedDocument;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
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
	globalThis.Renderer.dice ||= {};
	globalThis.Renderer.dice.parseRandomise2 ||= () => 0;
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

const SPECIALTY_TEXT = {
	gracefulLeap: "You can add a {@dice d10} to your Dexterity ({@skill Acrobatics}) checks.",
	keenEye: "You can add a {@dice d10} to your Wisdom ({@skill Perception}) checks.",
	poisonExpert: "You can add a {@dice d10} to checks made with a poisoner's kit and on saving throws against poison.",
	practicedDash: "You can add a {@dice d10} to your Strength ({@skill Athletics}) checks.",
	senseAura: "You can add a {@dice d10} to your Intelligence ({@skill Investigation}) checks.",
	shadowSkulk: "You can add a {@dice d10} to your Dexterity ({@skill Stealth}) checks.",
	skeletonKey: "You can add a {@dice d10} to checks made with thieves' tools.",
};

const FULL_SPECIALTY_TEXT = {
	gracefulLeap: `${SPECIALTY_TEXT.gracefulLeap} As a bonus action, you can jump up to half your speed horizontally or up to 10 feet vertically. Any opportunity attacks provoked by this jump are made with disadvantage.`,
	keenEye: `${SPECIALTY_TEXT.keenEye} You don't have disadvantage on Perception checks in lightly obscured areas. If you have darkvision, you see in darkness as if it were bright light.`,
	poisonExpert: `${SPECIALTY_TEXT.poisonExpert} You are immune to the effects of one poison of your choice.`,
	practicedDash: `${SPECIALTY_TEXT.practicedDash} When you take the Dash action, you ignore difficult terrain and don't fall on slippery surfaces.`,
	senseAura: `${SPECIALTY_TEXT.senseAura} You can use an Intelligence ({@skill Investigation}) check to find magical traps. You can also spend 10 minutes to sense if an object or creature within sight is magical.`,
	shadowSkulk: `${SPECIALTY_TEXT.shadowSkulk} You also gain a passive Dexterity ({@skill Stealth}) score of 10 + your Dexterity modifier + your proficiency bonus.`,
	skeletonKey: `${SPECIALTY_TEXT.skeletonKey} When you successfully pick a lock, you can alter it to open with a key you possess (in addition or instead of the original keys).`,
};

function addParsedModifiers (state, text, source) {
	for (const modifier of FeatureModifierParser.parseModifiers(text, source)) {
		state.addNamedModifier({
			...modifier,
			name: modifier.note || source,
			sourceFeatureId: `test:${source}`,
			sourceType: "classFeature",
		});
	}
}

function makeRollPage (state, {conditional = false} = {}) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._getExhaustionPenalty = () => 0;
	page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
	page._pPickConditionalModifiers = jest.fn(async ({conditionalsAvailable}) => {
		if (!conditional) return {appliedConditionalIds: new Set(), applied: [], cancelled: false};
		return {
			appliedConditionalIds: new Set(conditionalsAvailable.map(it => it.id)),
			applied: conditionalsAvailable,
			cancelled: false,
		};
	});
	page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
	page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
	page._pMaybeApplyTacticalMind = async () => {};
	page._pMaybeApplyBloodPrice = async () => {};
	page.pAnimateD20 = async () => {};
	page._showDiceResult = jest.fn();
	return page;
}

describe("Rogue Specialty d10 parsing", () => {
	test.each([
		["Graceful Leap", SPECIALTY_TEXT.gracefulLeap, "skill:acrobatics"],
		["Keen Eye", SPECIALTY_TEXT.keenEye, "skill:perception"],
		["Practiced Dash", SPECIALTY_TEXT.practicedDash, "skill:athletics"],
		["Sense Aura", SPECIALTY_TEXT.senseAura, "skill:investigation"],
		["Shadow Skulk", SPECIALTY_TEXT.shadowSkulk, "skill:stealth"],
	])("%s targets the correct skill", (name, text, type) => {
		expect(FeatureModifierParser.parseModifiers(text, name)).toEqual(expect.arrayContaining([
			expect.objectContaining({type, bonusDie: "d10"}),
		]));
	});

	test("Skeleton Key targets the canonical thieves' tools key", () => {
		expect(FeatureModifierParser.parseModifiers(SPECIALTY_TEXT.skeletonKey, "Skeleton Key")).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "tool:thievestools", bonusDie: "d10"}),
		]));
	});

	test("Poison Expert emits separate tool and conditional save dice", () => {
		const modifiers = FeatureModifierParser.parseModifiers(SPECIALTY_TEXT.poisonExpert, "Poison Expert");
		expect(modifiers).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "tool:poisonerskit", bonusDie: "d10"}),
			expect.objectContaining({
				type: "save:all",
				bonusDie: "d10",
				conditional: expect.stringMatching(/poison/i),
			}),
		]));
	});

	test("feature ingestion preserves the parsed bonus die and tool name", () => {
		const state = new CharacterSheetState();
		state._processFeatureModifiers({
			name: "Skeleton Key",
			source: "TGTT",
			description: SPECIALTY_TEXT.skeletonKey,
		}, "specialty:skeleton-key");

		expect(state.aggregateModifiers("tool:thievestools").bonusDiceContributions).toEqual([
			expect.objectContaining({
				dice: "d10",
				source: "Skeleton Key",
			}),
		]);
		expect(state.getToolModifierTargets()).toEqual([
			expect.objectContaining({
				toolKey: "thievestools",
				name: "thieves' tools",
			}),
		]);
	});

	test.each([
		["Graceful Leap", FULL_SPECIALTY_TEXT.gracefulLeap, "skill:acrobatics"],
		["Keen Eye", FULL_SPECIALTY_TEXT.keenEye, "skill:perception"],
		["Poison Expert", FULL_SPECIALTY_TEXT.poisonExpert, "tool:poisonerskit"],
		["Practiced Dash", FULL_SPECIALTY_TEXT.practicedDash, "skill:athletics"],
		["Sense Aura", FULL_SPECIALTY_TEXT.senseAura, "skill:investigation"],
		["Shadow Skulk", FULL_SPECIALTY_TEXT.shadowSkulk, "skill:stealth"],
		["Skeleton Key", FULL_SPECIALTY_TEXT.skeletonKey, "tool:thievestools"],
	])("%s keeps its d10 when the complete feature prose is parsed", (name, text, type) => {
		expect(FeatureModifierParser.parseModifiers(text, name)).toEqual(expect.arrayContaining([
			expect.objectContaining({type, bonusDie: "d10"}),
		]));
	});

	test("loading a legacy Specialty save restores dice metadata and removes a stale tool target", () => {
		const source = new CharacterSheetState();
		const json = source.toJson();
		json.features = [{
			id: "specialty:skeleton-key",
			name: "Skeleton Key",
			source: "TGTT",
			description: FULL_SPECIALTY_TEXT.skeletonKey,
		}];
		json.namedModifiers = [{
			id: "legacy-tool",
			name: "Skeleton Key",
			type: "tool:thieves",
			value: 0,
			note: "From Skeleton Key",
			enabled: true,
			sourceFeatureId: "specialty:skeleton-key",
		}];

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.aggregateModifiers("tool:thievestools").bonusDiceContributions).toEqual([
			expect.objectContaining({dice: "d10", source: "Skeleton Key"}),
		]);
		expect(restored.getNamedModifiers().some(mod => mod.type === "tool:thieves")).toBe(false);
	});

	test("loading a legacy skill Specialty save enriches the existing modifier in place", () => {
		const source = new CharacterSheetState();
		const json = source.toJson();
		json.features = [{
			id: "specialty:graceful-leap",
			name: "Graceful Leap",
			source: "TGTT",
			description: FULL_SPECIALTY_TEXT.gracefulLeap,
		}];
		json.namedModifiers = [{
			id: "legacy-skill",
			name: "Graceful Leap",
			type: "skill:acrobatics",
			value: 0,
			note: "From Graceful Leap",
			enabled: true,
			sourceFeatureId: "specialty:graceful-leap",
		}];

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.getNamedModifiers().filter(mod => mod.sourceFeatureId === "specialty:graceful-leap")).toEqual([
			expect.objectContaining({
				id: "legacy-skill",
				type: "skill:acrobatics",
				bonusDie: "d10",
			}),
		]);
	});
});

describe("Rogue Specialty d10 roll integration", () => {
	test("a skill Specialty adds its d10 to the total and named breakdown", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		addParsedModifiers(state, SPECIALTY_TEXT.gracefulLeap, "Graceful Leap");
		const page = makeRollPage(state);
		const diceSpy = jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "d10" ? 7 : 0);

		const result = await page._rollSkillCheck("acrobatics", "Acrobatics", null);

		expect(result.total).toBe(17);
		expect(diceSpy).toHaveBeenCalledWith("d10");
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			17,
			expect.stringMatching(/d10.*Graceful Leap/i),
			expect.any(String),
			expect.any(String),
		);
	});

	test("Poison Expert's save die is opt-in and rolls exactly once when selected", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("con", 10);
		addParsedModifiers(state, SPECIALTY_TEXT.poisonExpert, "Poison Expert");
		const probe = state.aggregateModifiers("save:con");
		expect(probe.conditionalsAvailable).toEqual([
			expect.objectContaining({name: "Poison Expert", bonusDie: "d10"}),
		]);

		const page = makeRollPage(state, {conditional: true});
		const diceSpy = jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "d10" ? 6 : 0);
		await page._rollSavingThrow("con", null);

		expect(diceSpy).toHaveBeenCalledTimes(1);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			16,
			expect.stringMatching(/d10.*Poison Expert/i),
			expect.any(String),
			expect.stringMatching(/Poison Expert.*d10/i),
		);
	});

	test("distinct same-die sources stack while one shared modifier is not double-counted", () => {
		const state = new CharacterSheetState();
		state.addNamedModifier({name: "First d10", type: "d20:all", value: 0, bonusDie: "d10"});
		state.addNamedModifier({name: "Second d10", type: "skill:acrobatics", value: 0, bonusDie: "d10"});

		const skill = state.aggregateModifiers("skill:acrobatics");
		const check = state.aggregateModifiers("check:dex");
		const merged = CharacterSheetPage._mergeModifierDiceContributions(skill, check);

		expect(merged).toEqual([
			expect.objectContaining({dice: "d10", source: "First d10"}),
			expect.objectContaining({dice: "d10", source: "Second d10"}),
		]);
	});

	test("a symbolic martial bonus die resolves before rolling", () => {
		const state = new CharacterSheetState();
		state.addNamedModifier({name: "Martial Focus", type: "check:dex", value: 0, bonusDie: "martial"});
		jest.spyOn(state, "getFeatureCalculations").mockReturnValue({martialArtsDie: "1d8"});
		const page = makeRollPage(state);
		const diceSpy = jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "1d8" ? 5 : null);

		const result = page._rollModifierDiceBonuses(state.aggregateModifiers("check:dex"));

		expect(diceSpy).toHaveBeenCalledWith("1d8");
		expect(result).toEqual(expect.objectContaining({total: 5}));
		expect(result.breakdownStr).toMatch(/1d8 Martial Focus/);
	});
});

describe("linked tool custom skills", () => {
	test("derive proficiency and advantage from the live tool and paired skill", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "TGTT", level: 13});
		state.addToolProficiency("Navigator's Tools");
		state.setSkillProficiency("survival", 1);

		expect(state.addCustomSkill("Navigator's Tools + Survival", "wis", {
			toolCheck: {tool: "Navigator's Tools", skill: "survival"},
		})).toBe(true);
		state._data.rollFloors = {skill: {all: {minimum: 10, requiresProficiency: true, source: "Reliable Talent"}}};

		const key = "navigator'stools+survival";
		expect(state.getEffectiveSkillProficiency(key)).toBe(1);
		expect(state.hasToolSkillAdvantage(key)).toBe(true);
		expect(state.aggregateModifiers(`skill:${key}`).minimum).toBe(10);

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(reloaded.getToolCheckLink(key)).toEqual({
			tool: "Navigator's Tools",
			toolKey: "navigatorstools",
			skill: "survival",
		});
		expect(reloaded.hasToolSkillAdvantage(key)).toBe(true);
	});

	test("a linked check rolls its tool Specialty die and gains advantage from both proficiencies", async () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "TGTT", level: 13});
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("sleightofhand", 1);
		addParsedModifiers(state, SPECIALTY_TEXT.skeletonKey, "Skeleton Key");
		state.addCustomSkill("Thieves' Tools + Sleight of Hand", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "sleightofhand"},
		});
		const page = makeRollPage(state);
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "advantage", thelemar_critBonus: 0}));
		jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "d10" ? 8 : 0);

		const result = await page._rollSkillCheck("thieves'tools+sleightofhand", "Thieves' Tools + Sleight of Hand", null);

		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: true}));
		expect(result.total).toBe(23);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			23,
			expect.stringMatching(/d10.*Skeleton Key/i),
			expect.any(String),
			expect.any(String),
		);
	});

	test("a direct tool check uses tool proficiency, paired-skill advantage, and its Specialty die", async () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "TGTT", level: 13});
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("sleightofhand", 1);
		state._data.rollFloors = {skill: {all: {minimum: 10, requiresProficiency: true, source: "Reliable Talent"}}};
		addParsedModifiers(state, SPECIALTY_TEXT.skeletonKey, "Skeleton Key");
		const page = makeRollPage(state);
		page._rollD20 = jest.fn(() => ({roll: 4, mode: "advantage", thelemar_critBonus: 0}));
		jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "d10" ? 8 : 0);

		const result = await page._rollToolCheck({
			toolName: "Thieves' Tools",
			ability: "dex",
			skillKey: "sleightofhand",
		});

		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: true}));
		expect(result.total).toBe(23);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.stringMatching(/Thieves' Tools Check/),
			23,
			expect.stringMatching(/tool proficiency.*d10.*Skeleton Key/i),
			expect.any(String),
			expect.stringMatching(/advantage from both proficiencies.*Minimum 10 applied/is),
		);
	});

	test("a direct tool check honors ability-check roll floors", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.addNamedModifier({name: "Steady Hands", type: "check:dex", value: 0, setMinimum: 12});
		const page = makeRollPage(state);
		page._rollD20 = jest.fn(() => ({roll: 4, mode: "normal", thelemar_critBonus: 0}));

		const result = await page._rollToolCheck({
			toolName: "Thieves' Tools",
			ability: "dex",
		});

		expect(result.total).toBe(14);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			14,
			expect.any(String),
			expect.any(String),
			expect.stringMatching(/Minimum 12 applied/),
		);
	});

	test("linked tool flat bonuses stay identical between display, breakdown, passive, and roll", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("sleightofhand", 1);
		state.addCustomSkill("Thieves' Tools + Sleight of Hand", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "sleightofhand"},
		});
		state.addNamedModifier({name: "Fine Picks", type: "tool:thievestools", value: 2});
		const key = "thieves'tools+sleightofhand";
		const page = makeRollPage(state);

		expect(state.getSkillMod(key)).toBe(4);
		expect(state.getSkillBreakdown(key)).toEqual(expect.objectContaining({
			total: 4,
			components: expect.arrayContaining([
				expect.objectContaining({type: "tool", name: "Fine Picks", value: 2}),
			]),
		}));
		expect(state.getPassiveScore(key)).toBe(14);

		const result = await page._rollSkillCheck(key, "Thieves' Tools + Sleight of Hand", null);
		expect(result.total).toBe(14);
	});

	test("an existing same-name custom skill can be upgraded to a linked tool check", () => {
		const state = new CharacterSheetState();
		state.addCustomSkill("Thieves' Tools + Sleight of Hand", "int");

		expect(state.setCustomSkillToolCheck("Thieves' Tools + Sleight of Hand", {
			tool: "Thieves' Tools",
			skill: "sleightofhand",
		})).toBe(true);
		expect(state.getToolCheckLink("thieves'tools+sleightofhand")).toEqual({
			tool: "Thieves' Tools",
			toolKey: "thievestools",
			skill: "sleightofhand",
		});
	});

	test("tool metadata prefers the 2024 ability and prioritizes XGE skill headings", () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = new CharacterSheetState();
		page._skillsData = [
			{name: "Investigation", ability: "int", source: "XPHB"},
			{name: "Perception", ability: "wis", source: "XPHB"},
			{name: "Stealth", ability: "dex", source: "XPHB"},
		];
		page._itemsData = [
			{
				name: "Thieves' Tools",
				source: "PHB",
				type: "T",
				additionalEntries: [
					{type: "entries", name: "Investigation and Perception", entries: ["Find traps."]},
				],
			},
			{
				name: "Thieves' Tools",
				source: "XPHB",
				type: "T|XPHB",
				entries: [
					{type: "list", items: [{type: "item", name: "Ability:", entries: ["Dexterity"]}]},
				],
			},
		];

		const metadata = page._getToolCheckMetadata("Thieves' Tools");
		expect(metadata.defaultAbility).toBe("dex");
		expect(metadata.suggestedSkills.map(skill => skill.name)).toEqual(["Investigation", "Perception"]);
	});
});
