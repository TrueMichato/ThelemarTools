import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TGTT_DATA = JSON.parse(
	readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"),
);

let CharacterSheetPage;
let savedWindow;
let savedDocument;
let savedEe;
let toolCheckModalEe;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	savedEe = globalThis.ee;
	globalThis.ee = (...args) => toolCheckModalEe ? toolCheckModalEe(...args) : savedEe(...args);
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
	globalThis.ee = savedEe;
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

const SPECIALTY_CASES = [
	["Graceful Leap", "skill:acrobatics"],
	["Keen Eye", "skill:perception"],
	["Poison Expert", "tool:poisonerskit"],
	["Practiced Dash", "skill:athletics"],
	["Sense Aura", "skill:investigation"],
	["Shadow Skulk", "skill:stealth"],
	["Skeleton Key", "tool:thievestools"],
];

function getRealSpecialty (name) {
	const feature = TGTT_DATA.classFeature.find(it =>
		it.name === name
		&& it.className === "Rogue"
		&& it.classSource === "TGTT"
		&& it.level === 13,
	);
	if (!feature) throw new Error(`Missing TGTT Rogue Specialty: ${name}`);
	return feature;
}

function getMaterializedSpecialty (name) {
	return CharacterSheetClassUtils.buildFeatureStateObject(getRealSpecialty(name), {
		className: "Rogue",
		classSource: "TGTT",
		level: 13,
		featureType: "Class",
		isFeatureOption: true,
		parentFeature: "Specialties",
	});
}

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

async function openToolCheckModal (state) {
	const page = makeRollPage(state);
	page._skillsData = [
		{name: "Investigation", ability: "int", source: "XPHB"},
		{name: "Perception", ability: "wis", source: "XPHB"},
		{name: "Stealth", ability: "dex", source: "XPHB"},
	];
	page._itemsData = [{
		name: "Thieves' Tools",
		source: "XPHB",
		type: "T",
		entries: [{type: "item", name: "Ability:", entries: ["Dexterity"]}],
		additionalEntries: [{type: "entries", name: "Investigation and Perception", entries: []}],
	}];
	page._renderSkills = jest.fn();
	page._saveCurrentCharacter = jest.fn(async () => {});
	const controls = new Map([
		["#tool-check-tool", globalThis.e_({tag: "select", value: "thievestools"})],
		["#tool-check-ability", globalThis.e_({tag: "select"})],
		["#tool-check-skill", globalThis.e_({tag: "select"})],
		["#tool-check-guidance", globalThis.e_({tag: "div"})],
		["#tool-check-roll", globalThis.e_({tag: "button"})],
		["#tool-check-cancel", globalThis.e_({tag: "button"})],
	]);
	const form = globalThis.e_({tag: "div"});
	form.querySelector = selector => controls.get(selector);
	const modalInner = globalThis.e_({tag: "div"});
	const doClose = jest.fn();
	toolCheckModalEe = (parts, ...values) => {
		form.outerHTML = parts.reduce((html, part, ix) => html + part + (values[ix] ?? ""), "");
		return form;
	};
	const modalSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetShow")
		.mockResolvedValue({eleModalInner: modalInner, doClose});
	try {
		await page._showToolCheckModal();
	} finally {
		toolCheckModalEe = null;
		modalSpy.mockRestore();
	}
	return {page, controls, form, doClose};
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

	test.each(SPECIALTY_CASES)("%s survives real feature materialization", (name, type) => {
		const state = new CharacterSheetState();
		const feature = getMaterializedSpecialty(name);
		if (name === "Shadow Skulk") {
			feature.description = "<p>You can add a <span>d10</span> to your Dexterity (<span>Stealth</span>) checks.</p>";
		}

		expect(state.addFeature(feature)).toBe(true);
		expect(state.aggregateModifiers(type).bonusDiceContributions).toEqual(expect.arrayContaining([
			expect.objectContaining({dice: "d10", source: name}),
		]));
	});

	test("rendered HTML fallback tolerates whitespace around the linked skill name", () => {
		const rendered = "<p>You can add a <span>d10</span> to your Dexterity (<span>Stealth</span>) checks.</p>";
		expect(FeatureModifierParser.parseModifiers(rendered, "Shadow Skulk")).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "skill:stealth", bonusDie: "d10"}),
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

	test("loading a V1-migrated Shadow Skulk save repairs the missing d10 from raw entries", () => {
		const source = new CharacterSheetState();
		const json = source.toJson();
		json.features = [{
			...getMaterializedSpecialty("Shadow Skulk"),
			id: "specialty:shadow-skulk",
			description: "<p>You can add a <span>d10</span> to your Dexterity (<span>Stealth</span>) checks.</p>",
		}];
		json.namedModifiers = [];
		json.migrationFlags = {featureBonusDiceV1: true};

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.aggregateModifiers("skill:stealth").bonusDiceContributions).toEqual([
			expect.objectContaining({dice: "d10", source: "Shadow Skulk"}),
		]);
		expect(restored.toJson().migrationFlags.featureBonusDiceV2).toBe(true);

		const roundTripped = new CharacterSheetState();
		roundTripped.loadFromJson(JSON.parse(JSON.stringify(restored.toJson())));
		expect(roundTripped.aggregateModifiers("skill:stealth").bonusDiceContributions).toHaveLength(1);
	});
});

describe("Rogue Specialty d10 roll integration", () => {
	test("the real Shadow Skulk feature adds its d10 in the main Skills roll path", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		const feature = getMaterializedSpecialty("Shadow Skulk");
		feature.description = "<p>You can add a <span>d10</span> to your Dexterity (<span>Stealth</span>) checks.</p>";
		state.addFeature(feature);
		const page = makeRollPage(state);
		const diceSpy = jest.spyOn(globalThis.Renderer.dice, "parseRandomise2").mockImplementation(expr => expr === "d10" ? 7 : 0);

		const result = await page._rollSkillCheck("stealth", "Stealth", null);

		expect(result.total).toBe(17);
		expect(diceSpy).toHaveBeenCalledWith("d10");
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			17,
			expect.stringMatching(/d10.*Shadow Skulk/i),
			expect.any(String),
			expect.any(String),
		);
	});

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
			expect.stringMatching(/\+d10 from Poison Expert against poison/i),
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
	test.each(["investigation", "stealth"])("the modal saves an unproficient %s skill with tool-only PB and no advantage", async skillKey => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.setAbilityBase("int", 18);
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("perception", 1);
		const {page, controls, form, doClose} = await openToolCheckModal(state);
		const skillEl = controls.get("#tool-check-skill");
		const rollBtn = controls.get("#tool-check-roll");
		const options = skillEl.innerHTML;

		expect(controls.get("#tool-check-ability").value).toBe("dex");
		expect(options).toMatch(/value="investigation"[^<]*suggested[\s\S]*value="perception"[^<]*suggested[\s\S]*value="stealth"/);
		expect(form.outerHTML).toContain("Relevant skill");
		skillEl.value = skillKey;
		skillEl._handlers.change();
		expect(rollBtn.textContent).toBe("Save & Roll");
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "normal", thelemar_critBonus: 0}));

		await rollBtn._handlers.click();

		const key = `thieves'tools+${skillKey}`;
		expect(state.getToolCheckLink(key)).toEqual({
			tool: "Thieves' Tools",
			toolKey: "thievestools",
			skill: skillKey,
		});
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: false}));
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 12, expect.any(String), expect.any(String), expect.any(String),
		);
		expect(state.getSkillBreakdown(key).components.filter(it => it.type === "proficiency")).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).toHaveBeenCalledTimes(1);
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(reloaded.getToolCheckLink(key)?.skill).toBe(skillKey);
		expect(reloaded.getSkillMod(key)).toBe(2);
		expect(reloaded.hasToolSkillAdvantage(key)).toBe(false);
	});

	test("leaving the skill unpaired uses a direct tool roll without saving a custom skill", async () => {
		const state = new CharacterSheetState();
		state.addToolProficiency("Thieves' Tools");
		const {page, controls, doClose} = await openToolCheckModal(state);
		const rollBtn = controls.get("#tool-check-roll");
		page._rollToolCheck = jest.fn(async () => ({total: 12}));

		expect(rollBtn.textContent).toBe("Roll");
		await rollBtn._handlers.click();

		expect(page._rollToolCheck).toHaveBeenCalledWith({toolName: "Thieves' Tools", ability: "dex"});
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(state.getCustomSkills()).toEqual([]);
		expect(doClose).toHaveBeenCalledTimes(1);
	});

	test("the modal grants advantage for a proficient paired skill without stacking two proficiency bonuses", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("perception", 1);
		const {page, controls} = await openToolCheckModal(state);
		const skillEl = controls.get("#tool-check-skill");
		skillEl.value = "perception";
		skillEl._handlers.change();
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "advantage", thelemar_critBonus: 0}));

		await controls.get("#tool-check-roll")._handlers.click();

		const key = "thieves'tools+perception";
		expect(state.hasToolSkillAdvantage(key)).toBe(true);
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: true}));
		expect(state.getSkillMod(key)).toBe(2);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 12, expect.any(String), expect.any(String), expect.any(String),
		);
	});

	test("a tool from a feature can pair with an expert skill even without tool proficiency", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.setSkillProficiency("investigation", 2);
		state.addNamedModifier({name: "Skeleton Key", type: "tool:thievestools", value: 1});
		const {page, controls} = await openToolCheckModal(state);
		controls.get("#tool-check-skill").value = "investigation";
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "normal", thelemar_critBonus: 0}));

		await controls.get("#tool-check-roll")._handlers.click();

		const key = "thieves'tools+investigation";
		expect(state.getEffectiveSkillProficiency(key)).toBe(2);
		expect(state.hasToolSkillAdvantage(key)).toBe(false);
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: false}));
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 15, expect.any(String), expect.any(String), expect.any(String),
		);
	});

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

	test("persisted pair uses the stronger proficiency without stacking and tracks independent changes", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.addCustomSkill("Thieves' Tools + Investigation", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "investigation"},
		});
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		const key = "thieves'tools+investigation";

		expect(reloaded.getSkillMod(key)).toBe(2);
		expect(reloaded.hasToolSkillAdvantage(key)).toBe(false);
		reloaded.setSkillProficiency("investigation", 2);
		expect(reloaded.getEffectiveSkillProficiency(key)).toBe(2);
		expect(reloaded.getSkillMod(key)).toBe(4);
		expect(reloaded.getSkillBreakdown(key).components.filter(it => it.type === "proficiency")).toEqual([
			expect.objectContaining({value: 4}),
		]);
		expect(reloaded.hasToolSkillAdvantage(key)).toBe(true);

		reloaded.removeToolProficiency("Thieves' Tools");
		expect(reloaded.getSkillMod(key)).toBe(4);
		expect(reloaded.hasToolSkillAdvantage(key)).toBe(false);
		const page = makeRollPage(reloaded);
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "normal", thelemar_critBonus: 0}));
		expect((await page._rollSkillCheck(key, "Thieves' Tools + Investigation", null)).total).toBe(14);
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: false}));

		reloaded.setSkillProficiency("investigation", 0);
		expect(reloaded.getSkillMod(key)).toBe(0);
		expect(reloaded.getEffectiveSkillProficiency(key)).toBe(0);
	});

	test("tool expertise wins over regular skill proficiency without adding their bonuses", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state._data._classFeatureToolExpertise = true;
		state.setSkillProficiency("investigation", 1);
		state.addCustomSkill("Thieves' Tools + Investigation", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "investigation"},
		});
		const key = "thieves'tools+investigation";
		const page = makeRollPage(state);

		expect(state.getEffectiveSkillProficiency(key)).toBe(2);
		expect(state.getSkillMod(key)).toBe(4);
		expect(state.hasToolSkillAdvantage(key)).toBe(true);
		expect((await page._rollSkillCheck(key, "Thieves' Tools + Investigation", null)).total).toBe(14);
	});

	test("a paired unproficient skill still receives tool-specific bonuses once", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addToolProficiency("Thieves' Tools");
		state.addNamedModifier({name: "Fine Picks", type: "tool:thievestools", value: 2});
		const {page, controls} = await openToolCheckModal(state);
		controls.get("#tool-check-skill").value = "stealth";

		await controls.get("#tool-check-roll")._handlers.click();

		const key = "thieves'tools+stealth";
		expect(state.getSkillMod(key)).toBe(4);
		expect(state.getSkillBreakdown(key).components).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "tool", name: "Fine Picks", value: 2}),
		]));
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 14, expect.any(String), expect.any(String), expect.any(String),
		);
		expect(state.hasToolSkillAdvantage(key)).toBe(false);
	});

	test("skill suppression removes only the skill side of a paired tool check", () => {
		const state = new CharacterSheetState();
		state.addToolProficiency("Thieves' Tools");
		state.setSkillProficiency("investigation", 2);
		state.addCustomSkill("Thieves' Tools + Investigation", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "investigation"},
		});
		jest.spyOn(state, "_getActiveStrainState").mockReturnValue({loseSkillProficiencies: true});
		const key = "thieves'tools+investigation";

		expect(state.getEffectiveSkillProficiency(key)).toBe(1);
		expect(state.hasToolSkillAdvantage(key)).toBe(false);
		state.removeToolProficiency("Thieves' Tools");
		expect(state.getEffectiveSkillProficiency(key)).toBe(0);
	});

	test("a legacy self-linked tool check cannot recursively project its own proficiency", () => {
		const state = new CharacterSheetState();
		state.addToolProficiency("Thieves' Tools");
		state.addCustomSkill("Thieves' Tools + Investigation", "dex", {
			toolCheck: {tool: "Thieves' Tools", skill: "thieves'tools+investigation"},
		});
		const key = "thieves'tools+investigation";

		expect(state.getEffectiveSkillProficiency(key)).toBe(1);
		expect(state.hasToolSkillAdvantage(key)).toBe(false);
	});

	test("a paired tool check uses skill proficiency when the tool is untrained without granting advantage", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.setSkillProficiency("investigation", 2);
		const page = makeRollPage(state);
		page._rollD20 = jest.fn(() => ({roll: 10, mode: "normal", thelemar_critBonus: 0}));

		const result = await page._rollToolCheck({
			toolName: "Thieves' Tools",
			ability: "dex",
			skillKey: "investigation",
		});

		expect(result.total).toBe(14);
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: false}));
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 14, expect.stringMatching(/skill expertise/), expect.any(String), expect.not.stringMatching(/advantage from both/),
		);
	});

	test("skill proficiency enables a direct tool check's proficiency-gated roll floor", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.setSkillProficiency("investigation", 1);
		state._data.rollFloors = {skill: {all: {minimum: 10, requiresProficiency: true, source: "Reliable Talent"}}};
		const page = makeRollPage(state);
		page._rollD20 = jest.fn(() => ({roll: 2, mode: "normal", thelemar_critBonus: 0}));

		const result = await page._rollToolCheck({
			toolName: "Thieves' Tools",
			ability: "dex",
			skillKey: "investigation",
		});

		expect(result.total).toBe(12);
		expect(page._rollD20).toHaveBeenCalledWith(expect.objectContaining({stateAdvantage: false}));
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String), 12, expect.stringMatching(/skill proficiency/),
			expect.any(String), expect.stringMatching(/Minimum 10 applied/),
		);
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
