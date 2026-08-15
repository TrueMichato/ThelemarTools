import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/render-dice.js";
import "../../../js/utils-ui.js";
import {getNpcTrackerAllSkillsModel} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js";
import {getNpcTrackerRollBonus} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerConditionsAfterUpdate} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {NpcTrackerSerializer} from "../../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js";

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
});
