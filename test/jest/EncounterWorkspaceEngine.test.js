import {jest} from "@jest/globals";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {createEncounterEngine} from "../../js/encounterworkspace/encounterworkspace-engine.js";

const pGetState = async () => {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "list-1", items: [{h: "goblin_mm", c: 2}]},
		pResolveItem: async () => ({entity: {name: "Goblin", source: "MM", cr: "1/4", hp: {average: 7, formula: "2d6"}}}),
		fnUid: () => `encounter-${++ix}`,
	});
};

const getEngine = async (opts = {}) => {
	const pSave = jest.fn(async next => next);
	const onChange = jest.fn();
	let t = 1000;
	const engine = createEncounterEngine({state: await pGetState(), pSave, onChange, now: () => t++, ...opts});
	return {engine, pSave, onChange};
};

const setNote = note => draft => { draft.instances[0].note = note; };

describe("Encounter cockpit engine", () => {
	it("commits through a private draft, validates, saves, then publishes", async () => {
		const {engine, pSave, onChange} = await getEngine();
		const before = engine.getState();
		await engine.pCommit("Note Snik", setNote("Snik"));
		expect(before.instances[0].note).toBe("");
		expect(engine.getState().instances[0].note).toBe("Snik");
		expect(engine.getState().instances[0].monster).toBe(before.instances[0].monster);
		expect(pSave).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(engine.getState(), {type: "commit", label: "Note Snik"});
		expect(engine.getUndoLabel()).toBe("Note Snik");
	});

	it("accepts recipes that return a new state from a legacy reducer", async () => {
		const {engine} = await getEngine();
		await engine.pCommit("Poison", draft => EncounterWorkspaceState.withConditions(draft, {condition: "Poisoned", isAdd: true}));
		expect(engine.getState().instances.map(it => it.conditions)).toEqual([["poisoned"], ["poisoned"]]);
	});

	it("leaves state, history and listeners untouched when a recipe, validation or save fails", async () => {
		const {engine, pSave, onChange} = await getEngine();
		await engine.pCommit("Note", setNote("kept"));
		onChange.mockClear();
		const before = engine.getState();
		await expect(engine.pCommit("Throw", () => { throw new Error("nope"); })).rejects.toThrow("nope");
		await expect(engine.pCommit("Invalid", draft => { draft.combat.status = "paused"; })).rejects.toThrow(/combat status/);
		pSave.mockRejectedValueOnce(new Error("Storage full"));
		await expect(engine.pCommit("Unsaved", setNote("lost"))).rejects.toThrow("Storage full");
		expect(engine.getState()).toBe(before);
		expect(engine.getUndoLabel()).toBe("Note");
		expect(onChange).not.toHaveBeenCalled();
		await engine.pCommit("Still works", setNote("next"));
		expect(engine.getState().instances[0].note).toBe("next");
	});

	it("undoes and redoes whole steps, clearing redo on a new change", async () => {
		const {engine} = await getEngine();
		await engine.pCommit("One", setNote("one"));
		await engine.pCommit("Two", setNote("two"));
		expect(await engine.pUndo()).toBe("Two");
		expect(engine.getState().instances[0].note).toBe("one");
		expect(engine.getRedoLabel()).toBe("Two");
		expect(await engine.pRedo()).toBe("Two");
		expect(engine.getState().instances[0].note).toBe("two");
		await engine.pUndo();
		await engine.pCommit("Three", setNote("three"));
		expect(engine.canRedo()).toBe(false);
		await engine.pUndo();
		await engine.pUndo();
		expect(engine.getState().instances[0].note).toBe("");
		expect(await engine.pUndo()).toBe(null);
	});

	it("keeps the log append-only across undo and records what was undone", async () => {
		const {engine} = await getEngine();
		await engine.pCommit("Hit goblin", (draft, {log}) => {
			draft.instances[0].note = "hit";
			log("damage", "Goblin 1 takes 5 slashing.", {targetIds: ["encounter-1"]});
		});
		await engine.pLog("roll", "Goblin 2 rolls 14 to hit.");
		expect(engine.getUndoLabel()).toBe("Hit goblin");
		await engine.pUndo();
		expect(engine.getState().instances[0].note).toBe("");
		expect(engine.getState().log.map(it => [it.kind, it.text])).toEqual([
			["damage", "Goblin 1 takes 5 slashing."],
			["roll", "Goblin 2 rolls 14 to hit."],
			["undo", "Undid: Hit goblin"],
		]);
		expect(engine.getState().log[0]).toMatchObject({round: 0, targetIds: ["encounter-1"]});
		expect(new Set(engine.getState().log.map(it => it.id)).size).toBe(3);
	});

	it("caps the undo stack", async () => {
		const {engine} = await getEngine({undoLimit: 3});
		for (const n of [1, 2, 3, 4, 5]) await engine.pCommit(`Step ${n}`, setNote(`${n}`));
		for (let i = 0; i < 3; i++) await engine.pUndo();
		expect(engine.canUndo()).toBe(false);
		expect(engine.getState().instances[0].note).toBe("2");
	});

	it("serialises overlapping commits in call order", async () => {
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const pSave = jest.fn(async next => { if (next.instances[0].note === "slow") await gate; return next; });
		const {engine} = await getEngine({pSave});
		const slow = engine.pCommit("Slow", setNote("slow"));
		const fast = engine.pCommit("Fast", draft => { draft.instances[0].note += "+fast"; });
		release();
		await Promise.all([slow, fast]);
		expect(engine.getState().instances[0].note).toBe("slow+fast");
	});

	it("notifies subscribers until they unsubscribe, and replaces outright with cleared history", async () => {
		const {engine} = await getEngine();
		const fn = jest.fn();
		const off = engine.subscribe(fn);
		await engine.pCommit("A", setNote("a"));
		off();
		await engine.pCommit("B", setNote("b"));
		expect(fn).toHaveBeenCalledTimes(1);
		await engine.pReplace(await pGetState());
		expect(engine.canUndo()).toBe(false);
		expect(engine.getState().instances[0].note).toBe("");
	});
});
