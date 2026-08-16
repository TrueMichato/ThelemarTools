import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-dataloader.js";
import "../../../js/render.js";
import "../../../js/render-dice.js";
import "../../../js/utils-ui.js";
import {jest} from "@jest/globals";
import {getNpcTrackerAllSkillsModel} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js";
import {
	getNpcTrackerConditionRollMeta,
	getNpcTrackerRollBonus,
} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {
	getNpcTrackerConditionPickerModel,
	getNpcTrackerConditionHoverMeta,
	getNpcTrackerConditionsAfterUpdate,
} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {NpcTrackerSerializer} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js";
import {
	getNpcTrackerConditionSourceRank,
	getNpcTrackerSkillDescriptors,
	pGetNpcTrackerReferenceData,
	resetNpcTrackerReferenceDataCache,
} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-data.js";

const getMonster = () => ({
	name: "Watch Sergeant",
	source: "TST",
	hp: {average: 18, formula: "4d8"},
	str: 14,
	dex: 8,
	con: 12,
	int: 10,
	wis: 15,
	cha: 11,
	skill: {
		athletics: "+4",
		perception: "+5",
	},
});

describe("NPC Manager all-skill rolls", () => {
	it("surfaces every standard skill and falls back to its governing ability", () => {
		const monster = getMonster();
		const skills = getNpcTrackerAllSkillsModel(monster);

		expect(skills).toHaveLength(Object.keys(Parser.SKILL_TO_ATB_ABV).length);
		expect(skills.map(({skill}) => skill)).toEqual(Object.keys(Parser.SKILL_TO_ATB_ABV));
		expect(skills.find(({skill}) => skill === "perception")).toMatchObject({
			ability: "wis",
			bonus: 5,
			isProficient: true,
		});
		expect(skills.find(({skill}) => skill === "insight")).toMatchObject({
			ability: "wis",
			bonus: 2,
			isProficient: false,
		});
		expect(getNpcTrackerRollBonus({
			npc: {monster},
			rollType: "skill",
			key: "stealth",
		})).toBe(-1);
	});

	it("includes a homebrew skill and uses its governing ability", () => {
		const monster = getMonster();
		const skills = getNpcTrackerAllSkillsModel(monster, {
			skillCatalog: [
				...getNpcTrackerSkillDescriptors(),
				{id: "culture|tgtt", name: "Culture", label: "Culture", source: "TGTT", ability: "wis"},
			],
		});
		const culture = skills.find(({name}) => name === "Culture");

		expect(culture).toMatchObject({
			label: "Culture",
			ability: "wis",
			bonus: 2,
			isProficient: false,
		});
	});

	it("uses exact UID bonuses and supports flat lore skills", () => {
		const monster = {
			...getMonster(),
			skill: {
				...getMonster().skill,
				"Culture|TGTT": "+6",
				"Ancient Engines|HB": "+7",
			},
		};
		const skillCatalog = [
			{id: "culture|tgtt", name: "Culture", label: "Culture", source: "TGTT", ability: "wis"},
		];
		const skills = getNpcTrackerAllSkillsModel(monster, {skillCatalog});
		const culture = skills.find(({name}) => name === "Culture");
		const lore = skills.find(({name}) => name === "Ancient Engines");

		expect(culture).toMatchObject({bonus: 6, ability: "wis", isProficient: true});
		expect(lore).toMatchObject({bonus: 7, ability: null, isProficient: true});
		expect(getNpcTrackerRollBonus({
			npc: {monster: {...monster, skill: {}}},
			rollType: "skill",
			skill: lore,
		})).toBe(0);
	});

	it("resolves a batch-selected homebrew skill descriptor by UID", () => {
		const monster = {
			...getMonster(),
			skill: {"Culture|TGTT": "+6"},
		};
		const skills = getNpcTrackerSkillDescriptors({
			skillCatalog: [{name: "Culture", label: "Culture", source: "TGTT", ability: "wis"}],
			monsters: [monster],
		});
		const selected = skills.find(it => it.id === "culture|tgtt");

		expect(selected).toBeDefined();
		expect(getNpcTrackerRollBonus({
			npc: {monster},
			rollType: "skill",
			key: selected.id,
			skill: selected,
		})).toBe(6);
	});
});

describe("NPC Manager direct conditions", () => {
	it("uses the shared canonical mutation path and survives serialization", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getMonster()});
		npc.conditions = getNpcTrackerConditionsAfterUpdate({
			conditions: npc.conditions,
			condition: " Poisoned ",
			isAdd: true,
		});
		npc.conditions = getNpcTrackerConditionsAfterUpdate({
			conditions: npc.conditions,
			condition: "prone",
			isAdd: true,
		});
		npc.conditions = getNpcTrackerConditionsAfterUpdate({
			conditions: npc.conditions,
			condition: "poisoned",
			isAdd: false,
		});

		const restored = NpcTrackerSerializer.deserialize(NpcTrackerSerializer.serialize({
			settings: {selectedId: npc.id},
			npcs: [npc],
		}));

		expect(restored.npcs[0].conditions).toEqual(["prone"]);
		expect(getNpcTrackerConditionsAfterUpdate({
			conditions: restored.npcs[0].conditions,
			condition: "PRONE",
			isAdd: true,
		})).toEqual(["prone"]);
	});

	it("preserves a homebrew condition without a loaded catalog", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getMonster()});
		npc.conditions = getNpcTrackerConditionsAfterUpdate({
			conditions: [],
			condition: "  Dreambound  ",
			isAdd: true,
		});

		const restored = NpcTrackerSerializer.deserialize(NpcTrackerSerializer.serialize({
			settings: {selectedId: npc.id},
			npcs: [npc],
		}));

		expect(restored.npcs[0].conditions).toEqual(["dreambound"]);
	});

	it("includes homebrew conditions in picker models", () => {
		const picker = getNpcTrackerConditionPickerModel({
			conditions: ["poisoned"],
			conditionCatalog: [
				{name: "poisoned", label: "Poisoned"},
				{name: "dreambound", label: "Dreambound"},
			],
		});

		expect(picker.available).toContainEqual(expect.objectContaining({name: "dreambound"}));
	});

	it("resolves homebrew condition hovers and leaves custom chips safe", () => {
		const catalog = [{name: "dreambound", label: "Dreambound", source: "HB"}];
		expect(getNpcTrackerConditionHoverMeta("dreambound", {conditionCatalog: catalog})).toMatchObject({source: "HB"});
		expect(getNpcTrackerConditionHoverMeta("unlisted", {conditionCatalog: catalog})).toBeNull();
	});

	it("reports mechanical roll state without applying unknown homebrew rules", () => {
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["frightened"]},
			rollType: "ability",
			key: "wis",
		})).toMatchObject({mode: "disadvantage"});
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["dreambound"]},
			rollType: "ability",
			key: "wis",
		})).toMatchObject({mode: "normal"});
	});
});

describe("NPC Manager reference data", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		resetNpcTrackerReferenceDataCache();
	});

	it("merges installed-brew conditions and skills into the catalogs", async () => {
		jest.spyOn(DataLoader, "pCacheAndGetAllSite").mockImplementation(async page => page === "skill"
			? [{__prop: "skill", name: "Perception", source: "PHB", ability: "wis"}]
			: [{__prop: "condition", name: "Poisoned", source: "PHB"}]);
		jest.spyOn(DataLoader, "pCacheAndGetAllBrew").mockImplementation(async page => page === "skill"
			? [{__prop: "skill", name: "Culture", source: "TGTT", ability: "wis"}]
			: [{__prop: "condition", name: "Dreambound", source: "HB"}]);

		const referenceData = await pGetNpcTrackerReferenceData();

		expect(referenceData.conditions).toContainEqual(expect.objectContaining({
			name: "dreambound",
			label: "Dreambound",
			source: "HB",
		}));
		expect(referenceData.skills).toContainEqual(expect.objectContaining({
			name: "Culture",
			ability: "wis",
			source: "TGTT",
		}));
	});

	it("prefers TGTT-family conditions, then XPHB, over legacy and fallback entries", async () => {
		jest.spyOn(DataLoader, "pCacheAndGetAllSite").mockImplementation(async page => page === "skill"
			? []
			: [
				{__prop: "condition", name: "Frightened", source: "PHB"},
				{__prop: "condition", name: "Frightened", source: "XPHB"},
				{__prop: "condition", name: "Poisoned", source: "PHB"},
				{__prop: "condition", name: "Poisoned", source: "XPHB"},
			]);
		jest.spyOn(DataLoader, "pCacheAndGetAllBrew").mockImplementation(async page => page === "skill"
			? []
			: [{__prop: "condition", name: "Frightened", source: "TGTT-TEST"}]);

		const referenceData = await pGetNpcTrackerReferenceData();

		expect(referenceData.conditions.find(it => it.name === "frightened")).toMatchObject({
			label: "Frightened",
			source: "TGTT-TEST",
		});
		expect(referenceData.conditions.find(it => it.name === "poisoned")).toMatchObject({
			label: "Poisoned",
			source: "XPHB",
		});
		expect(getNpcTrackerConditionSourceRank("TGTT")).toBeGreaterThan(getNpcTrackerConditionSourceRank("XPHB"));
		expect(getNpcTrackerConditionSourceRank("XPHB")).toBeGreaterThan(getNpcTrackerConditionSourceRank("HB"));
		expect(getNpcTrackerConditionSourceRank("HB")).toBeGreaterThan(getNpcTrackerConditionSourceRank("PHB"));
		expect(getNpcTrackerConditionSourceRank("PHB")).toBeGreaterThan(getNpcTrackerConditionSourceRank(null));
	});

	it("lets same-name homebrew beat PHB while retaining custom conditions", async () => {
		jest.spyOn(DataLoader, "pCacheAndGetAllSite").mockImplementation(async page => page === "skill"
			? []
			: [{__prop: "condition", name: "Dazed", source: "PHB"}]);
		jest.spyOn(DataLoader, "pCacheAndGetAllBrew").mockImplementation(async page => page === "skill"
			? []
			: [
				{__prop: "condition", name: "Dazed", source: "HB"},
				{__prop: "condition", name: "Dreambound", source: "HB"},
			]);

		const referenceData = await pGetNpcTrackerReferenceData();

		expect(referenceData.conditions.find(it => it.name === "dazed")).toMatchObject({source: "HB"});
		expect(referenceData.conditions.find(it => it.name === "dreambound")).toMatchObject({source: "HB"});
	});
});
