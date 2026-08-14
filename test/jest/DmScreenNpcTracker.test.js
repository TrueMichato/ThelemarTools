import "../../js/parser.js";
import "../../js/utils.js";
import {NpcTrackerSerializer} from "../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js";
import {
	getNpcTrackerDetailModel,
	getNpcTrackerDisplayName,
	getNpcTrackerSignedNumber,
	hasNpcTrackerAttackRoll,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js";
import {getNpcTrackerImportedMonsters} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roster.js";

const getMonster = () => ({
	name: "Court Mage",
	source: "TST",
	isNpc: true,
	hp: {average: 27, formula: "6d8"},
	str: 9,
	dex: 14,
	con: 10,
	int: 17,
	wis: 12,
	cha: 13,
	save: {int: "+5"},
	skill: {arcana: "+5", history: "+5"},
	trait: [{name: "Courtier", entries: ["The mage knows court protocol."]}],
	spellcasting: [{name: "Spellcasting", type: "spellcasting", will: ["{@spell mage hand}"]}],
	action: [
		{name: "Dagger", entries: ["{@atk mw} {@hit +4} to hit."]},
		{name: "Command", entries: ["An ally moves."]},
	],
});

describe("NPC Tracker serialization", () => {
	it("round-trips complete snapshots and mutable instance state", () => {
		const monster = getMonster();
		const npc = NpcTrackerSerializer.createNpc({
			monster,
			fluff: {entries: ["A patient adviser."]},
			alias: "Magister Vale",
		});
		npc.hp.current = 11;
		npc.hp.temp = 4;

		const saved = NpcTrackerSerializer.serialize({
			version: 1,
			settings: {selectedId: npc.id, isIncludeAllCreatures: true},
			npcs: [npc],
		});
		const restored = NpcTrackerSerializer.deserialize(saved);

		expect(saved.v).toBe(1);
		expect(restored.settings).toEqual({selectedId: npc.id, isIncludeAllCreatures: true});
		expect(restored.npcs[0]).toMatchObject({
			id: npc.id,
			alias: "Magister Vale",
			hp: {current: 11, max: 27, temp: 4},
			monster,
			fluff: {entries: ["A patient adviser."]},
		});
	});

	it("keeps duplicate creatures independent and repairs invalid selection", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster()});
		first.hp.current = 2;

		const restored = NpcTrackerSerializer.deserialize({
			s: {sel: "missing"},
			n: [
				NpcTrackerSerializer.serialize({settings: {selectedId: first.id}, npcs: [first]}).n[0],
				NpcTrackerSerializer.serialize({settings: {selectedId: second.id}, npcs: [second]}).n[0],
			],
		});

		expect(first.id).not.toBe(second.id);
		expect(restored.npcs.map(it => it.hp.current)).toEqual([2, 27]);
		expect(restored.settings.selectedId).toBe(first.id);
	});

	it("defaults malformed or empty state safely", () => {
		expect(NpcTrackerSerializer.deserialize(null)).toEqual(NpcTrackerSerializer.getDefaultState());
		expect(NpcTrackerSerializer.deserialize({n: [{mon: {name: "Missing source"}}]}).npcs).toEqual([]);
	});
});

describe("NPC Tracker detail model", () => {
	it("selects roleplay, spellcasting, lore, and attack-roll content", () => {
		const model = getNpcTrackerDetailModel(getMonster(), {fluff: {entries: ["A patient adviser."]}});

		expect(model.abilities).toHaveLength(6);
		expect(model.saves).toEqual([{ability: "int", bonus: "+5"}]);
		expect(model.skills).toHaveLength(2);
		expect(model.traits[0].name).toBe("Courtier");
		expect(model.spellcasting[0].name).toBe("Spellcasting");
		expect(model.attacks.map(it => it.name)).toEqual(["Dagger"]);
		expect(model.fluffEntries).toEqual(["A patient adviser."]);
	});

	it("recognizes attacks and formats roll/display labels", () => {
		expect(hasNpcTrackerAttackRoll({entries: ["{@atk rs} {@hit +7}"]})).toBe(true);
		expect(hasNpcTrackerAttackRoll({entries: ["The NPC speaks."]})).toBe(false);
		expect(getNpcTrackerSignedNumber("+5")).toBe("+5");
		expect(getNpcTrackerSignedNumber(-2)).toBe("-2");
		expect(getNpcTrackerDisplayName({alias: "Vale", monster: {name: "Mage"}})).toBe("Vale");
	});
});

describe("NPC Tracker JSON import", () => {
	it("accepts direct monsters and bestiary wrappers", () => {
		expect(getNpcTrackerImportedMonsters(getMonster())).toHaveLength(1);
		expect(getNpcTrackerImportedMonsters(JSON.stringify({monster: [getMonster(), getMonster()]}))).toHaveLength(2);
	});

	it("rejects invalid payloads with actionable errors", () => {
		expect(() => getNpcTrackerImportedMonsters("{}")).toThrow("does not contain");
		expect(() => getNpcTrackerImportedMonsters({monster: [{name: "No Source"}]})).toThrow("name and source");
	});
});
