import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getNpcTrackerHpOperation} from "../../js/dmscreen/npctracker/dmscreen-npctracker-hp.js";

const monster = {name: "Goblin", source: "MM", dex: 14, hp: {average: 7, formula: "2d6"}};
const create = async (monsters = [monster, monster]) => {
	let id = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "save-1", items: monsters.map((_, i) => ({h: `${i}`, c: 1}))},
		pResolveItem: async ({h}) => ({entity: monsters[Number(h)]}),
		fnUid: () => `goblin-${++id}`,
	});
};

const getStorage = () => {
	let stored = null;
	return {
		pGetForPage: jest.fn(async () => stored),
		pSetForPage: jest.fn(async (_, value) => { stored = structuredClone(value); }),
	};
};

describe("Encounter Workspace HP and turns", () => {
	it("initializes distinct HP snapshots from finite authored averages, including zero, without inventing unknown HP", async () => {
		const state = await create([monster, {...monster, hp: {average: 0}}, {...monster, hp: {formula: "2d6"}}, {...monster, hp: {average: Infinity}}]);
		expect(state.instances.map(it => it.hp)).toEqual([
			{current: 7, max: 7, temp: 0},
			{current: 0, max: 0, temp: 0},
			{current: null, max: null, temp: 0},
			{current: null, max: null, temp: 0},
		]);
		expect(state.instances.map(it => it.initiative)).toEqual([null, null, null, null]);
		expect(state.turn).toEqual({round: 0, activeId: null});
		expect(Object.isFrozen(state.instances[0].monster.hp)).toBe(true);
	});

	it("parses a single batch dice expression and applies damage to temp before current, with floor-half and healing capped at max", async () => {
		const state = await create();
		const withTemp = EncounterWorkspaceState.withHp(state, {id: "goblin-1", prop: "temp", value: 4});
		const parsed = getNpcTrackerHpOperation({raw: "-5", isHalf: true});
		expect(parsed).toEqual({ok: true, operation: {mode: "delta", value: -2}});
		const {state: damaged, snapshots} = EncounterWorkspaceState.withHpOperation(withTemp, {operation: parsed.operation});
		expect(damaged.instances.map(it => it.hp)).toEqual([
			{current: 7, max: 7, temp: 2},
			{current: 5, max: 7, temp: 0},
		]);
		expect(withTemp.instances.map(it => it.hp.current)).toEqual([7, 7]);
		expect(EncounterWorkspaceState.withHpUndo(damaged, snapshots).instances.map(it => it.hp))
			.toEqual(withTemp.instances.map(it => it.hp));
		const {state: healed} = EncounterWorkspaceState.withHpOperation(damaged, {operation: {mode: "delta", value: 12}});
		expect(healed.instances.map(it => it.hp.current)).toEqual([7, 7]);
		expect(healed.instances[0].hp.temp).toBe(2);
		const set = EncounterWorkspaceState.withHpOperation(healed, {operation: {mode: "set", value: 12}});
		expect(set.state.instances.map(it => it.hp.current)).toEqual([12, 12]);
		expect(getNpcTrackerHpOperation({raw: "7"}).operation).toEqual({mode: "delta", value: -7});
		expect(getNpcTrackerHpOperation({raw: "+3"}).operation).toEqual({mode: "delta", value: 3});
		expect(getNpcTrackerHpOperation({raw: "=4", isHalf: true}).operation).toEqual({mode: "set", value: 4});
	});

	it("skips unset HP with an explicit per-instance report, never treating null as zero", async () => {
		const initial = await create([monster, {...monster, hp: {formula: "unknown"}}]);
		expect(() => EncounterWorkspaceState.withHpOperation(initial, {operation: {mode: "delta", value: -2}, targetIds: []}))
			.toThrow(/Select at least one/);
		const damage = EncounterWorkspaceState.withHpOperation(initial, {operation: {mode: "delta", value: -2}});
		expect(damage.changedIds).toEqual(["goblin-1"]);
		expect(damage.skippedIds).toEqual(["goblin-2"]);
		expect(damage.state.instances.map(it => it.hp.current)).toEqual([5, null]);
		const max = EncounterWorkspaceState.withHp(initial, {id: "goblin-2", prop: "max", value: 9});
		expect(EncounterWorkspaceState.withHpOperation(max, {operation: {mode: "delta", value: 2}}).skippedIds).toEqual(["goblin-2"]);
		expect(EncounterWorkspaceState.withHpOperation(max, {operation: {mode: "set", value: 4}}).state.instances[1].hp)
			.toEqual({current: 4, max: 9, temp: 0});
		expect(initial.instances[1].hp).toEqual({current: null, max: null, temp: 0});
	});

	it("orders tied totals by original roster order, starts explicitly, advances across wrap, and retains the active ID on reorder", async () => {
		const initial = await create([monster, monster, monster]);
		expect(() => EncounterWorkspaceState.withTurn(initial, "start")).toThrow(/Enter or roll initiative/);
		const rolled = EncounterWorkspaceState.withInitiativeResults(initial, [
			{id: "goblin-2", total: 15},
			{id: "goblin-1", total: 15},
		]);
		expect(EncounterWorkspaceState.getInitiativeOrder(rolled).map(it => it.id)).toEqual(["goblin-1", "goblin-2"]);
		expect(rolled.turn).toEqual({round: 0, activeId: null});
		expect(() => EncounterWorkspaceState.withTurn(rolled, "next")).toThrow(/Start turns/);
		let state = EncounterWorkspaceState.withTurn(rolled, "start");
		expect(state.turn).toEqual({round: 1, activeId: "goblin-1"});
		state = EncounterWorkspaceState.withInitiative(state, {id: "goblin-2", total: 22});
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(["goblin-2", "goblin-1"]);
		expect(state.turn).toEqual({round: 1, activeId: "goblin-1"});
		state = EncounterWorkspaceState.withTurn(state, "next");
		expect(state.turn).toEqual({round: 2, activeId: "goblin-2"});
		state = EncounterWorkspaceState.withTurn(state, "next");
		expect(state.turn).toEqual({round: 2, activeId: "goblin-1"});
		const store = new EncounterWorkspaceStore({storage: getStorage()});
		await store.pSave(state);
		expect((await store.pLoad()).turn).toEqual({round: 2, activeId: "goblin-1"});
		expect(EncounterWorkspaceState.withInitiative(state, {id: "goblin-1", total: null}).turn)
			.toEqual({round: 0, activeId: null});
		expect(EncounterWorkspaceState.withTurn(state, "reset").instances.map(it => it.initiative)).toEqual([15, 22, null]);
		const atLimit = EncounterWorkspaceState.validate({...state, turn: {round: Number.MAX_SAFE_INTEGER, activeId: "goblin-1"}});
		expect(() => EncounterWorkspaceState.withTurn(atLimit, "next")).toThrow(/cannot increase/);
	});

	it("migrates v1, v2, and v3 on read without writes, preserving prior selection, conditions, and effects", async () => {
		const initial = await create();
		const withCondition = EncounterWorkspaceState.withConditions(initial, {condition: "poisoned", isAdd: true, targetIds: ["goblin-2"]});
		const {state: withNote} = EncounterWorkspaceState.withAreaNote(withCondition, {
			note: {id: "fog", kind: "trait", name: "Fog", description: "Dim sight"}, isAdd: true,
		});
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		for (const version of [1, 2, 3]) {
			const legacy = structuredClone(withNote);
			legacy.version = version;
			delete legacy.turn;
			legacy.instances.forEach(instance => {
				delete instance.hp;
				delete instance.initiative;
				if (version < 3) { delete instance.areaNotes; delete instance.modifiers; }
				if (version === 1) delete instance.conditions;
			});
			storage.pGetForPage.mockResolvedValueOnce(legacy);
			const migrated = await store.pLoad();
			expect(migrated.version).toBe(6);
			expect(migrated.selectedIds).toEqual(withNote.selectedIds);
			expect(migrated.turn).toEqual({round: 0, activeId: null});
			expect(migrated.instances.map(it => it.hp.current)).toEqual([7, 7]);
			expect(migrated.instances[1].conditions).toEqual(version === 1 ? [] : ["poisoned"]);
			expect(migrated.instances[0].areaNotes).toHaveLength(version === 3 ? 1 : 0);
			expect(Object.isFrozen(migrated.instances[0].monster)).toBe(true);
		}
		expect(storage.pSetForPage).not.toHaveBeenCalled();
	});

	it("rejects malformed v4 HP/turns and keeps original HP, initiative, and undo inputs on failed storage writes", async () => {
		const state = await create();
		for (const invalid of [
			{...state.instances[0].hp, current: -1},
			{...state.instances[0].hp, max: Infinity},
			{...state.instances[0].hp, temp: null},
			{max: 7, temp: 0},
		]) {
			expect(() => EncounterWorkspaceState.validate({
				...state, instances: [{...state.instances[0], hp: invalid}, state.instances[1]],
			})).toThrow(/invalid hit points/);
		}
		expect(() => EncounterWorkspaceState.validate({...state, turn: {round: 1, activeId: "goblin-1"}}))
			.toThrow(/invalid active turn/);
		expect(() => EncounterWorkspaceState.withInitiative(state, {id: "goblin-1", total: 2.5}))
			.toThrow(/whole number/);
		expect(() => EncounterWorkspaceState.withHpUndo(state, [{id: "goblin-1", before: state.instances[0].hp, after: {current: 5, max: 7, temp: 0}}]))
			.toThrow(/changed since/);
		const storage = getStorage();
		storage.pSetForPage.mockRejectedValue(new Error("Storage full"));
		const store = new EncounterWorkspaceStore({storage});
		await expect(store.pSave(EncounterWorkspaceState.withHpOperation(state, {operation: {mode: "delta", value: -3}}).state))
			.rejects.toThrow("Storage full");
		await expect(store.pSave(EncounterWorkspaceState.withInitiative(state, {id: "goblin-1", total: 15})))
			.rejects.toThrow("Storage full");
		expect(state.instances.map(it => [it.hp.current, it.initiative])).toEqual([[7, null], [7, null]]);
		expect(storage.pGetForPage).not.toHaveBeenCalled();
	});
});
