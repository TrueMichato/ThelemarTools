import {
	ENCOUNTER_ZERO_HP_SOURCE,
	applyEncounterDeathSaveDamage,
	applyEncounterHealing,
	getEncounterDeathSavePipCount,
	getEncounterDeathSaveStatus,
	getEncounterUsesDeathSaves,
	markEncounterDeathSave,
	rollEncounterDeathSave,
	stabilizeEncounterCreature,
} from "../../js/encounterworkspace/encounterworkspace-deathsaves.js";
import {applyEncounterEffect, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getCockpitInstance as get, getCockpitUid, pGetCockpitState} from "./helpers/encounter-cockpit-fixtures.js";

const run = (state, reducer, opts) => withEncounterDraft(state, (draft, {log}) => reducer(draft, {log, ...opts}));

/** What the engine's damage reducer does first: temp HP, then current HP (floored at 0). Then the dying rules. */
const hit = (state, id, damage, opts = {}) => withEncounterDraft(state, (draft, {log}) => {
	const instance = get(draft, id);
	const hpBefore = instance.hp.current;
	const fromTemp = Math.min(instance.hp.temp, damage);
	const left = damage - fromTemp;
	instance.hp = {...instance.hp, temp: instance.hp.temp - fromTemp, current: Math.max(0, hpBefore - left)};
	return applyEncounterDeathSaveDamage(draft, {id, damage: left, hpBefore, log, ...opts});
});

const pDowned = async (id = "pc-1", opts) => hit(await pGetCockpitState(), id, id === "pc-1" ? 40 : 10, opts).state;

describe("Encounter cockpit death saves", () => {
	it("players make death saves by default; monsters only when enabled", async () => {
		const state = await pGetCockpitState();
		const goblin = get(state, "encounter-1");
		const vex = get(state, "pc-1");
		expect(getEncounterUsesDeathSaves(vex)).toBe(true);
		expect(getEncounterUsesDeathSaves(goblin)).toBe(false);
		expect(getEncounterUsesDeathSaves(goblin, {monsterDeathSaves: true})).toBe(true);
		expect(getEncounterUsesDeathSaves({...goblin, deathSaveMode: "on"})).toBe(true);
		expect(getEncounterUsesDeathSaves({...goblin, deathSaveMode: "off"}, {monsterDeathSaves: true})).toBe(false);
		expect(getEncounterUsesDeathSaves({...vex, deathSaveMode: "off"})).toBe(false);
	});

	describe("dropping to 0 HP", () => {
		it("a player starts dying: unconscious and prone, saves at 0/0", async () => {
			const out = hit(await pGetCockpitState(), "pc-1", 40);
			expect(out.result).toEqual({outcome: "down", deathSaves: {successes: 0, failures: 0, stable: false, dead: false}});
			const vex = get(out.state, "pc-1");
			expect(vex).toMatchObject({defeated: false, hp: {current: 0}});
			expect(vex.conditions).toEqual(["unconscious", "prone"]);
			expect(vex.conditionDetails.unconscious.source).toBe(ENCOUNTER_ZERO_HP_SOURCE);
			expect(getEncounterDeathSaveStatus(vex)).toBe("dying");
			expect(out.logs.map(it => it[1])).toContain("Vex drops to 0 HP and is dying.");
		});

		it("a monster is defeated unless monster death saves are on", async () => {
			let out = hit(await pGetCockpitState(), "encounter-1", 10);
			expect(out.result.outcome).toBe("defeated");
			expect(get(out.state, "encounter-1")).toMatchObject({defeated: true, deathSaves: null, conditions: []});
			out = hit(await pGetCockpitState(), "encounter-1", 10, {monsterDeathSaves: true});
			expect(out.result.outcome).toBe("down");
			expect(get(out.state, "encounter-1").defeated).toBe(false);
		});

		it("massive damage kills outright", async () => {
			// 33 HP, takes 66: 33 left over = max HP.
			const out = hit(await pGetCockpitState(), "pc-1", 66);
			expect(out.result).toEqual({outcome: "dead", deathSaves: {successes: 0, failures: 3, stable: false, dead: true}});
			expect(get(out.state, "pc-1").defeated).toBe(true);
			expect(getEncounterDeathSaveStatus(get(out.state, "pc-1"))).toBe("dead");
			expect(hit(await pGetCockpitState(), "pc-1", 65).result.outcome).toBe("down");
		});

		it("temp HP that absorbs the hit keeps the creature up", async () => {
			const state = await pGetCockpitState();
			const withTemp = withEncounterDraft(state, draft => { get(draft, "pc-1").hp.temp = 10; }).state;
			const out = hit(withTemp, "pc-1", 8);
			expect(out.result.outcome).toBeNull();
			expect(get(out.state, "pc-1").hp).toEqual({current: 33, max: 33, temp: 2});
		});

		it("dropping to 0 HP ends concentration and its linked effects", async () => {
			let {state} = withEncounterDraft(await pGetCockpitState(), draft => applyEncounterEffect(draft, {targetIds: ["encounter-1"], def: "bless", casterId: "pc-1", fnUid: getCockpitUid()}));
			const out = hit(state, "pc-1", 40);
			expect(get(out.state, "pc-1").resources.concentration.active).toBe(false);
			expect(get(out.state, "pc-1").conditions).not.toContain("concentrating");
			expect(get(out.state, "encounter-1").effects).toEqual([]);
		});

		it("damage at 0 HP adds a failure, two on a critical hit, and three kill", async () => {
			let state = await pDowned();
			let out = hit(state, "pc-1", 3);
			expect(out.result).toMatchObject({outcome: "failure", deathSaves: {failures: 1}});
			out = hit(out.state, "pc-1", 3, {isCrit: true});
			expect(out.result).toEqual({outcome: "dead", deathSaves: {successes: 0, failures: 3, stable: false, dead: true}});
			expect(get(out.state, "pc-1").defeated).toBe(true);
			expect(out.logs[0][1]).toMatch(/2 death-save failures — dies/);
		});

		it("damage at 0 HP ends stability", async () => {
			let {state} = run(await pDowned(), stabilizeEncounterCreature, {id: "pc-1"});
			expect(getEncounterDeathSaveStatus(get(state, "pc-1"))).toBe("stable");
			const out = hit(state, "pc-1", 1);
			expect(get(out.state, "pc-1").deathSaves).toEqual({successes: 0, failures: 1, stable: false, dead: false});
		});
	});

	describe("rolling", () => {
		it("10+ is a success, under 10 a failure, three successes stabilize", async () => {
			let state = await pDowned();
			let out;
			for (const d20 of [10, 4, 15]) ({state, result: out} = run(state, rollEncounterDeathSave, {id: "pc-1", d20}));
			expect(out.text).toBe("success");
			expect(get(state, "pc-1").deathSaves).toEqual({successes: 2, failures: 1, stable: false, dead: false});
			({state, result: out} = run(state, rollEncounterDeathSave, {id: "pc-1", d20: 19}));
			expect(out.text).toBe("success — stable");
			expect(getEncounterDeathSaveStatus(get(state, "pc-1"))).toBe("stable");
			expect(run(state, rollEncounterDeathSave, {id: "pc-1", d20: 12}).result).toBeNull();
		});

		it("a natural 1 counts as two failures", async () => {
			let {state, result} = run(await pDowned(), rollEncounterDeathSave, {id: "pc-1", d20: 1});
			expect(result).toMatchObject({text: "nat 1 — two failures", deathSaves: {failures: 2}});
			({state, result} = run(state, rollEncounterDeathSave, {id: "pc-1", d20: 1}));
			expect(result.text).toBe("nat 1 — two failures — dies");
			expect(get(state, "pc-1")).toMatchObject({defeated: true, deathSaves: {failures: 3, dead: true}});
		});

		it("a natural 20 brings the creature back with 1 HP, still prone", async () => {
			const {state, result, logs} = run(await pDowned(), rollEncounterDeathSave, {id: "pc-1", d20: 20});
			expect(result).toEqual({n: 20, text: "nat 20 — regains 1 HP and is conscious", deathSaves: null});
			const vex = get(state, "pc-1");
			expect(vex).toMatchObject({hp: {current: 1}, deathSaves: null, defeated: false, conditions: ["prone"]});
			expect(logs[0][1]).toBe("Vex death save: 20 (nat 20 — regains 1 HP and is conscious).");
		});

		it("rejects anything that isn't a d20 result", async () => {
			const state = await pDowned();
			[0, 21, "x", 2.6 + 18].forEach(d20 => expect(() => run(state, rollEncounterDeathSave, {id: "pc-1", d20})).toThrow(/d20 result/));
		});
	});

	describe("marking pips without rolling", () => {
		it("sets successes and failures directly, including on a monster with death saves turned on for it", async () => {
			let state = await pDowned();
			({state} = run(state, markEncounterDeathSave, {id: "pc-1", kind: "s", count: 2}));
			({state} = run(state, markEncounterDeathSave, {id: "pc-1", kind: "failures", count: 1}));
			expect(get(state, "pc-1").deathSaves).toEqual({successes: 2, failures: 1, stable: false, dead: false});
			({state} = run(state, markEncounterDeathSave, {id: "pc-1", kind: "s", count: 3}));
			expect(getEncounterDeathSaveStatus(get(state, "pc-1"))).toBe("stable");

			const goblinOn = withEncounterDraft(await pGetCockpitState(), draft => { get(draft, "encounter-1").deathSaveMode = "on"; }).state;
			const out = run(goblinOn, markEncounterDeathSave, {id: "encounter-1", kind: "f", count: 1});
			expect(get(out.state, "encounter-1").deathSaves).toEqual({successes: 0, failures: 1, stable: false, dead: false});
		});

		it("three failures kill and un-marking one revives a creature still at 0 HP", async () => {
			let {state} = run(await pDowned(), markEncounterDeathSave, {id: "pc-1", kind: "f", count: 3});
			expect(get(state, "pc-1")).toMatchObject({defeated: true, deathSaves: {dead: true}});
			({state} = run(state, markEncounterDeathSave, {id: "pc-1", kind: "f", count: getEncounterDeathSavePipCount(3, 2)}));
			expect(get(state, "pc-1")).toMatchObject({defeated: false, deathSaves: {failures: 2, dead: false}});
		});

		it("refuses monsters without death saves and bad pip kinds", async () => {
			const state = await pGetCockpitState();
			expect(() => run(state, markEncounterDeathSave, {id: "encounter-1", kind: "f", count: 1})).toThrow(/doesn't make death saves/);
			expect(run(state, markEncounterDeathSave, {id: "encounter-1", kind: "f", count: 1, monsterDeathSaves: true}).result.failures).toBe(1);
			expect(() => run(state, markEncounterDeathSave, {id: "pc-1", kind: "x", count: 1})).toThrow(/successes or failures/);
		});

		it("clicking the highest filled pip clears it; any other pip fills up to it", () => {
			expect(getEncounterDeathSavePipCount(0, 0)).toBe(1);
			expect(getEncounterDeathSavePipCount(1, 0)).toBe(0);
			expect(getEncounterDeathSavePipCount(1, 2)).toBe(3);
			expect(getEncounterDeathSavePipCount(3, 0)).toBe(1);
			expect(getEncounterDeathSavePipCount(2, 1)).toBe(1);
		});
	});

	describe("healing", () => {
		it("clears death saves and the 0 HP unconsciousness, but the creature stays prone", async () => {
			let state = await pDowned();
			({state} = run(state, rollEncounterDeathSave, {id: "pc-1", d20: 3}));
			const out = run(state, applyEncounterHealing, {id: "pc-1", amount: 7});
			expect(out.result).toEqual({healed: 7, hp: 7});
			expect(get(out.state, "pc-1")).toMatchObject({deathSaves: null, defeated: false, conditions: ["prone"]});
		});

		it("keeps an unconsciousness that came from somewhere else (a Sleep spell)", async () => {
			const state = withEncounterDraft(await pGetCockpitState(), draft => {
				const vex = get(draft, "pc-1");
				vex.hp.current = 5;
				vex.conditions = ["unconscious"];
				vex.conditionDetails = {unconscious: {rounds: 10, source: "Sleep"}};
			}).state;
			const out = run(state, applyEncounterHealing, {id: "pc-1", amount: 3});
			expect(get(out.state, "pc-1").conditions).toEqual(["unconscious"]);
		});

		it("caps at max HP, can't heal the dead, and revives a defeated monster", async () => {
			let out = run(await pGetCockpitState(), applyEncounterHealing, {id: "pc-1", amount: 10});
			expect(out.result).toEqual({healed: 0, hp: 33});
			const dead = hit(await pGetCockpitState(), "pc-1", 70).state;
			expect(run(dead, applyEncounterHealing, {id: "pc-1", amount: 10}).result).toEqual({healed: 0, hp: 0});
			const defeated = hit(await pGetCockpitState(), "encounter-1", 10).state;
			out = run(defeated, applyEncounterHealing, {id: "encounter-1", amount: 4});
			expect(get(out.state, "encounter-1")).toMatchObject({defeated: false, hp: {current: 4}});
		});
	});
});
