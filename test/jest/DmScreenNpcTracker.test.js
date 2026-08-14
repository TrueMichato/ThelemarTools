import "../../js/parser.js";
import "../../js/utils.js";
import {
	NpcTrackerSerializer,
	removeNpcTrackerGroup,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js";
import {
	getNpcTrackerDetailModel,
	getNpcTrackerDisplayName,
	getNpcTrackerSignedNumber,
	hasNpcTrackerAttackRoll,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js";
import {getNpcTrackerImportedMonsters} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roster.js";
import {
	getNpcTrackerNpcsForScope,
	getNpcTrackerRollBonus,
	getNpcTrackerRollLabel,
	sortNpcTrackerBatchResults,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerHpInputValue} from "../../js/dmscreen/npctracker/dmscreen-npctracker-hp.js";

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
		npc.groupId = "court";

		const saved = NpcTrackerSerializer.serialize({
			version: 2,
			settings: {selectedId: npc.id, isIncludeAllCreatures: true, isUnsortedCollapsed: true},
			groups: [{id: "court", name: "Town Council", isCollapsed: true}],
			npcs: [npc],
		});
		const restored = NpcTrackerSerializer.deserialize(saved);

		expect(saved.v).toBe(2);
		expect(restored.settings).toEqual({
			selectedId: npc.id,
			isIncludeAllCreatures: true,
			isUnsortedCollapsed: true,
		});
		expect(restored.groups).toEqual([{id: "court", name: "Town Council", isCollapsed: true}]);
		expect(restored.npcs[0]).toMatchObject({
			id: npc.id,
			alias: "Magister Vale",
			groupId: "court",
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

	it("migrates version 1 saves into Unsorted without losing NPC state", () => {
		const restored = NpcTrackerSerializer.deserialize({
			v: 1,
			s: {sel: "legacy", all: true},
			n: [{
				id: "legacy",
				a: "Legacy Mage",
				hp: {c: 9, m: 27, t: 2},
				mon: getMonster(),
				fluff: {entries: ["Preserved lore."]},
			}],
		});

		expect(restored.groups).toEqual([]);
		expect(restored.settings).toEqual({
			selectedId: "legacy",
			isIncludeAllCreatures: true,
			isUnsortedCollapsed: false,
		});
		expect(restored.npcs[0]).toMatchObject({
			id: "legacy",
			alias: "Legacy Mage",
			groupId: null,
			hp: {current: 9, max: 27, temp: 2},
			fluff: {entries: ["Preserved lore."]},
		});
	});

	it("repairs dangling memberships and removes groups without deleting NPCs", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster(), alias: "First"});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster(), alias: "Second"});
		first.groupId = "valid";
		second.groupId = "missing";
		const state = NpcTrackerSerializer.deserialize({
			groups: [{id: "valid", name: "Council"}],
			npcs: [first, second],
		});

		expect(state.npcs.map(npc => npc.groupId)).toEqual(["valid", null]);
		expect(removeNpcTrackerGroup({state, groupId: "valid"})).toBe(true);
		expect(state.groups).toEqual([]);
		expect(state.npcs).toHaveLength(2);
		expect(state.npcs.map(npc => npc.groupId)).toEqual([null, null]);
	});

	it("keeps duplicate monster instances independently assignable", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster()});
		first.groupId = "a";
		second.groupId = "b";
		const restored = NpcTrackerSerializer.deserialize({
			g: [{id: "a", n: "A"}, {id: "b", n: "B"}],
			n: [
				NpcTrackerSerializer.serialize({groups: [{id: "a", name: "A"}], npcs: [first]}).n[0],
				NpcTrackerSerializer.serialize({groups: [{id: "b", name: "B"}], npcs: [second]}).n[0],
			],
		});

		expect(restored.npcs.map(npc => npc.groupId)).toEqual(["a", "b"]);
		expect(restored.npcs[0].id).not.toBe(restored.npcs[1].id);
	});
});

describe("NPC Tracker HP input", () => {
	it("rejects blank and non-numeric values instead of coercing them to zero", () => {
		expect(getNpcTrackerHpInputValue("")).toBeNull();
		expect(getNpcTrackerHpInputValue("   ")).toBeNull();
		expect(getNpcTrackerHpInputValue("not a number")).toBeNull();
		expect(getNpcTrackerHpInputValue("0")).toBe(0);
		expect(getNpcTrackerHpInputValue("-3")).toBe(0);
		expect(getNpcTrackerHpInputValue("12")).toBe(12);
	});
});

describe("NPC Tracker batch rolls", () => {
	it("resolves initiative, abilities, saves, and skills with correct fallbacks", () => {
		const rendererOriginal = globalThis.Renderer;
		globalThis.Renderer = {monster: {getInitiativeBonusNumber: () => 7}};
		const npc = {
			monster: {
				...getMonster(),
				dex: 14,
				wis: 12,
				save: {dex: "+6"},
				skill: {perception: "+4"},
			},
		};

		try {
			expect(getNpcTrackerRollBonus({npc, rollType: "initiative"})).toBe(7);
			expect(getNpcTrackerRollBonus({npc, rollType: "ability", key: "dex"})).toBe(2);
			expect(getNpcTrackerRollBonus({npc, rollType: "save", key: "dex"})).toBe(6);
			expect(getNpcTrackerRollBonus({npc, rollType: "save", key: "wis"})).toBe(1);
			expect(getNpcTrackerRollBonus({npc, rollType: "skill", key: "perception"})).toBe(4);
			expect(getNpcTrackerRollBonus({npc, rollType: "skill", key: "insight"})).toBe(1);
			expect(getNpcTrackerRollLabel({rollType: "save", key: "dex"})).toBe("Dexterity save");
		} finally {
			globalThis.Renderer = rendererOriginal;
		}
	});

	it("resolves all, named-group, and Unsorted scopes in roster order", () => {
		const state = {
			npcs: [
				{id: "a", groupId: "g"},
				{id: "b", groupId: null},
				{id: "c", groupId: "g"},
			],
		};

		expect(getNpcTrackerNpcsForScope({state, scope: {type: "all"}}).map(npc => npc.id)).toEqual(["a", "b", "c"]);
		expect(getNpcTrackerNpcsForScope({state, scope: {type: "group", groupId: "g"}}).map(npc => npc.id)).toEqual(["a", "c"]);
		expect(getNpcTrackerNpcsForScope({state, scope: {type: "unsorted"}}).map(npc => npc.id)).toEqual(["b"]);
	});

	it("sorts initiative totals descending with stable roster-order ties", () => {
		const results = [
			{name: "Bravo", total: 15, order: 1},
			{name: "Alpha", total: 18, order: 0},
			{name: "Charlie", total: 15, order: 2},
		];

		expect(sortNpcTrackerBatchResults({
			results,
			sortKey: "total",
			sortDirection: "desc",
		}).map(it => it.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
		expect(sortNpcTrackerBatchResults({
			results,
			sortKey: "order",
			sortDirection: "asc",
		}).map(it => it.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
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
