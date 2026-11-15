import {
	ENCOUNTER_TGTT_ONLY_CONDITIONS,
	applyEncounterCondition,
	createEncounterConditionsProvider,
	getEncounterConditionCatalog,
	getEncounterConditionContributors,
	getEncounterConditionMechanics,
	getEncounterConditionRule,
	getEncounterExhaustionEffects,
	getEncounterExhaustionLevel,
	removeEncounterCondition,
	setEncounterConditionRounds,
	setEncounterExhaustion,
	tickEncounterDurations,
} from "../../js/encounterworkspace/encounterworkspace-conditions-rules.js";
import {applyEncounterEffect, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getCockpitInstance as get, getCockpitUid, pGetCockpitState} from "./helpers/encounter-cockpit-fixtures.js";

const run = (state, reducer, opts) => withEncounterDraft(state, (draft, {log}) => reducer(draft, {log, ...opts}));
const condition = (state, opts) => run(state, applyEncounterCondition, opts);
const labels = list => list.map(it => it.label);

describe("Encounter cockpit condition rules", () => {
	describe("catalog", () => {
		it.each(["phb", "xphb", "tgtt"])("every %s condition the user can apply has a mechanical effect or a rules note", ruleset => {
			const catalog = getEncounterConditionCatalog(ruleset);
			catalog.forEach(({name, rule}) => {
				expect([name, rule.inactive || rule.custom || false]).toEqual([name, false]);
				expect(getEncounterConditionMechanics(rule).length || rule.note).toBeTruthy();
			});
			// Every 5e condition except the purely narrative ones changes a number.
			catalog.filter(it => it.kind === "condition" && !["charmed", "deafened"].includes(it.name) && !ENCOUNTER_TGTT_ONLY_CONDITIONS.includes(it.name))
				.forEach(({name, rule}) => expect([name, getEncounterConditionMechanics(rule).length > 0]).toEqual([name, true]));
		});

		it("offers the TGTT-only conditions only under the TGTT ruleset", () => {
			const names = ruleset => getEncounterConditionCatalog(ruleset).map(it => it.name);
			expect(names("phb")).not.toContain("slowed");
			expect(names("xphb")).not.toContain("dazed");
			expect(names("tgtt")).toEqual(expect.arrayContaining(ENCOUNTER_TGTT_ONLY_CONDITIONS));
			expect(getEncounterConditionRule("Slowed", "phb")).toMatchObject({inactive: true});
			expect(getEncounterConditionRule("Slowed", "tgtt")).toMatchObject({speedHalf: true, attackedBy: "adv"});
			expect(getEncounterConditionRule("Marked by the Raven")).toMatchObject({custom: true});
		});

		it("uses the 2024 rules under XPHB", () => {
			expect(getEncounterConditionRule("stunned", "phb").speed0).toBe(true);
			expect(getEncounterConditionRule("stunned", "xphb").speed0).toBeUndefined();
			expect(getEncounterConditionRule("grappled", "phb").attack).toBeUndefined();
			expect(getEncounterConditionRule("grappled", "xphb").attack).toBe("dis");
			expect(getEncounterConditionRule("blinded", "xphb")).toBe(getEncounterConditionRule("blinded", "phb"));
		});
	});

	describe("reducers", () => {
		it("Unconscious also knocks the creature prone, and the prone outlasts the unconscious duration", async () => {
			let {state} = condition(await pGetCockpitState(), {targetIds: ["encounter-1"], condition: "Unconscious", rounds: 2, source: "Sleep"});
			let goblin = get(state, "encounter-1");
			expect(goblin.conditions).toEqual(["unconscious", "prone"]);
			expect(goblin.conditionDetails).toEqual({unconscious: {rounds: 2, source: "Sleep"}, prone: {rounds: null, source: "Sleep"}});
			({state} = run(state, tickEncounterDurations));
			let out = run(state, tickEncounterDurations);
			expect(out.result.conditions).toEqual([{instanceId: "encounter-1", condition: "unconscious"}]);
			goblin = get(out.state, "encounter-1");
			expect(goblin.conditions).toEqual(["prone"]);
			expect(goblin.conditionDetails).toEqual({prone: {rounds: null, source: "Sleep"}});
			expect(out.logs.map(it => it[1])).toEqual(["Unconscious ended on Goblin."]);
		});

		it("re-applying a condition updates its duration without duplicating it, and rounds can be typed", async () => {
			let {state} = condition(await pGetCockpitState(), {targetIds: ["encounter-1"], condition: "poisoned", rounds: 10, source: "Dagger"});
			({state} = condition(state, {targetIds: ["encounter-1"], condition: "poisoned", rounds: 3, source: "Other"}));
			expect(get(state, "encounter-1").conditions).toEqual(["poisoned"]);
			expect(get(state, "encounter-1").conditionDetails.poisoned).toEqual({rounds: 3, source: "Dagger"});
			({state} = run(state, setEncounterConditionRounds, {instanceId: "encounter-1", condition: "Poisoned", rounds: "6"}));
			expect(get(state, "encounter-1").conditionDetails.poisoned.rounds).toBe(6);
			({state} = run(state, setEncounterConditionRounds, {instanceId: "encounter-1", condition: "poisoned", rounds: ""}));
			expect(get(state, "encounter-1").conditionDetails.poisoned.rounds).toBeNull();
			expect(() => run(state, setEncounterConditionRounds, {instanceId: "encounter-1", condition: "prone", rounds: 1})).toThrow(/no longer applied/);
		});

		it("an incapacitating condition breaks concentration and removes the spell's linked effects", async () => {
			let {state} = withEncounterDraft(await pGetCockpitState(), draft => applyEncounterEffect(draft, {targetIds: ["encounter-1", "encounter-2"], def: "bless", casterId: "pc-1", fnUid: getCockpitUid()}));
			const out = condition(state, {targetIds: ["pc-1"], condition: "stunned"});
			expect(get(out.state, "pc-1").resources.concentration.active).toBe(false);
			expect(get(out.state, "pc-1").conditions).toEqual(["stunned"]);
			expect(get(out.state, "encounter-1").effects).toEqual([]);
			expect(out.logs[0][1]).toMatch(/Bless ended on 2 creatures .*Vex is stunned/);
			// Non-incapacitating conditions leave it alone.
			({state} = withEncounterDraft(state, draft => applyEncounterCondition(draft, {targetIds: ["pc-1"], condition: "poisoned"})));
			expect(get(state, "pc-1").resources.concentration.label).toBe("Bless");
		});

		it("marks concentration through the 'concentrating' state and removing it ends the linked effects", async () => {
			let {state} = condition(await pGetCockpitState(), {targetIds: ["encounter-1"], condition: "concentrating", label: "Hold Person"});
			expect(get(state, "encounter-1").resources.concentration).toEqual({active: true, label: "Hold Person"});
			expect(get(state, "encounter-1").conditions).toEqual(["concentrating"]);
			({state} = withEncounterDraft(state, draft => applyEncounterEffect(draft, {targetIds: ["encounter-2"], def: "bane", casterId: "encounter-1", fnUid: getCockpitUid()})));
			expect(get(state, "encounter-1").resources.concentration.label).toBe("Bane");
			const out = run(state, removeEncounterCondition, {targetIds: ["encounter-1"], condition: "Concentrating"});
			expect(get(out.state, "encounter-1").conditions).toEqual([]);
			expect(get(out.state, "encounter-1").resources.concentration.active).toBe(false);
			expect(get(out.state, "encounter-2").effects).toEqual([]);
		});

		it("removes conditions and their durations", async () => {
			let {state} = condition(await pGetCockpitState(), {targetIds: ["encounter-1", "encounter-2"], condition: "Frightened", rounds: 3});
			const out = run(state, removeEncounterCondition, {targetIds: ["encounter-1", "encounter-2"], condition: "frightened"});
			expect(out.result).toEqual(["encounter-1", "encounter-2"]);
			expect(get(out.state, "encounter-1").conditionDetails).toEqual({});
			expect(() => condition(state, {targetIds: ["encounter-1"], condition: " "})).toThrow(/Choose a condition/);
		});
	});

	describe("exhaustion", () => {
		it("PHB exhaustion stacks its level effects", () => {
			expect(getEncounterExhaustionEffects(1, "phb")).toMatchObject({checksDis: true, speedHalf: false, attackDis: false});
			expect(getEncounterExhaustionEffects(3, "phb")).toMatchObject({checksDis: true, speedHalf: true, attackDis: true, savesDis: true, hpMaxHalf: false});
			expect(getEncounterExhaustionEffects(5, "phb")).toMatchObject({hpMaxHalf: true, speed0: true, dead: false});
			expect(getEncounterExhaustionEffects(6, "phb").dead).toBe(true);
		});

		it("2024 exhaustion is −2 per level on d20 tests and −5 ft. speed per level", () => {
			expect(getEncounterExhaustionEffects(3, "xphb")).toMatchObject({d20Minus: 6, speedMinus: 15, checksDis: false, dead: false});
		});

		it("TGTT exhaustion is −1 per level on d20 tests and spell DCs, and kills above level 10", () => {
			expect(getEncounterExhaustionEffects(4, "tgtt")).toMatchObject({d20Minus: 4, dcMinus: 4, speedMinus: 0, dead: false});
			expect(getEncounterExhaustionEffects(10, "tgtt").dead).toBe(false);
			expect(getEncounterExhaustionEffects(11, "tgtt").dead).toBe(true);
		});

		it("stores the level on the condition, clamps it, removes at 0 and defeats at the death level", async () => {
			let {state} = run(await pGetCockpitState(), setEncounterExhaustion, {targetIds: ["encounter-1"], level: 2});
			expect(getEncounterExhaustionLevel(get(state, "encounter-1"))).toBe(2);
			expect(get(state, "encounter-1").conditionDetails.exhaustion).toEqual({rounds: null, level: 2});

			const tgtt = run(state, setEncounterExhaustion, {targetIds: ["encounter-1"], level: 8, ruleset: "tgtt"});
			expect(get(tgtt.state, "encounter-1")).toMatchObject({defeated: false, conditionDetails: {exhaustion: {level: 8}}});

			const dead = run(state, setEncounterExhaustion, {targetIds: ["encounter-1"], level: 9});
			expect(get(dead.state, "encounter-1")).toMatchObject({defeated: true, conditionDetails: {exhaustion: {level: 6}}});
			expect(dead.logs.some(([, text]) => /dies of exhaustion \(level 6\)/.test(text))).toBe(true);

			({state} = run(state, setEncounterExhaustion, {targetIds: ["encounter-1"], level: 0}));
			expect(get(state, "encounter-1").conditions).toEqual([]);
			expect(getEncounterExhaustionLevel(get(state, "encounter-1"))).toBe(0);
			expect(() => run(state, setEncounterExhaustion, {targetIds: ["encounter-1"], level: -1})).toThrow(/exhaustion level/);
		});
	});

	describe("roll contributors", () => {
		const pWith = async (id, names, extra = {}) => {
			let state = await pGetCockpitState();
			for (const name of names) ({state} = condition(state, {targetIds: [id], condition: name, ...extra}));
			return state;
		};

		it("Paralyzed auto-fails Str/Dex saves and makes nearby hits critical", async () => {
			const state = await pWith("encounter-2", ["paralyzed"]);
			const goblin = get(state, "encounter-2");
			expect(labels(getEncounterConditionContributors(state, goblin, {kind: "save", ability: "dex"}).autoFail)).toEqual(["Paralyzed"]);
			expect(getEncounterConditionContributors(state, goblin, {kind: "save", ability: "wis"}).autoFail).toEqual([]);
			const attack = getEncounterConditionContributors(state, get(state, "pc-1"), {kind: "attack", targetId: "encounter-2"});
			expect(labels(attack.advantage)).toEqual(["Target paralyzed"]);
			expect(labels(attack.autoCrit)).toEqual(["Hit within 5 ft. is a critical (Paralyzed)"]);
		});

		it("Blinded, Poisoned, Prone and Restrained affect the creature's own attacks", async () => {
			const state = await pWith("encounter-1", ["blinded", "poisoned", "restrained"]);
			const out = getEncounterConditionContributors(state, get(state, "encounter-1"), {kind: "attack"});
			expect(labels(out.disadvantage)).toEqual(["Blinded", "Poisoned", "Restrained"]);
			expect(labels(getEncounterConditionContributors(state, get(state, "encounter-1"), {kind: "save", ability: "dex"}).disadvantage)).toEqual(["Restrained"]);
			const check = getEncounterConditionContributors(state, get(state, "encounter-1"), {kind: "check", skill: "perception"});
			expect(labels(check.disadvantage)).toEqual(["Poisoned"]);
			expect(check.notes.map(it => it.label)).toEqual(["Blinded: Fails ability checks that need sight."]);
		});

		it("an invisible attacker and an invisible target cancel through advantage and disadvantage", async () => {
			let state = await pWith("pc-1", ["invisible"]);
			({state} = condition(state, {targetIds: ["encounter-1"], condition: "invisible"}));
			const out = getEncounterConditionContributors(state, get(state, "pc-1"), {kind: "attack", targetId: "encounter-1"});
			expect(labels(out.advantage)).toEqual(["Invisible"]);
			expect(labels(out.disadvantage)).toEqual(["Target invisible"]);
		});

		it("XPHB incapacitation gives initiative disadvantage; PHB doesn't", async () => {
			const state = await pWith("encounter-1", ["incapacitated"]);
			const goblin = get(state, "encounter-1");
			expect(getEncounterConditionContributors(state, goblin, {kind: "initiative"}, {ruleset: "phb"}).disadvantage).toEqual([]);
			expect(labels(getEncounterConditionContributors(state, goblin, {kind: "initiative"}, {ruleset: "xphb"}).disadvantage)).toEqual(["Incapacitated"]);
		});

		it("TGTT Poisoned imposes disadvantage on concentration saves only under the TGTT rules", async () => {
			const state = await pWith("encounter-1", ["poisoned"]);
			const goblin = get(state, "encounter-1");
			const query = {kind: "save", ability: "con", concentration: true};
			expect(getEncounterConditionContributors(state, goblin, query, {ruleset: "phb"}).disadvantage).toEqual([]);
			expect(labels(createEncounterConditionsProvider({ruleset: "tgtt"})(state, goblin, query).disadvantage)).toEqual(["Poisoned (concentration)"]);
			expect(getEncounterConditionContributors(state, goblin, {kind: "save", ability: "con"}, {ruleset: "tgtt"}).disadvantage).toEqual([]);
		});

		it("TGTT Slowed does nothing until the TGTT rules are on", async () => {
			const state = await pWith("encounter-2", ["slowed"]);
			const query = {kind: "attack", targetId: "encounter-2"};
			expect(getEncounterConditionContributors(state, get(state, "pc-1"), query, {ruleset: "phb"}).advantage).toEqual([]);
			expect(labels(getEncounterConditionContributors(state, get(state, "pc-1"), query, {ruleset: "tgtt"}).advantage)).toEqual(["Target slowed"]);
			expect(labels(getEncounterConditionContributors(state, get(state, "encounter-2"), {kind: "save", ability: "dex"}, {ruleset: "tgtt"}).disadvantage)).toEqual(["Slowed"]);
		});

		it("exhaustion feeds d20 penalties and disadvantage per ruleset", async () => {
			let {state} = run(await pGetCockpitState(), setEncounterExhaustion, {targetIds: ["encounter-1"], level: 3});
			const goblin = get(state, "encounter-1");
			const phb = getEncounterConditionContributors(state, goblin, {kind: "save", ability: "wis"});
			expect(labels(phb.disadvantage)).toEqual(["Exhaustion 3"]);
			expect(phb.bonuses).toEqual([]);
			const xphb = getEncounterConditionContributors(state, goblin, {kind: "attack"}, {ruleset: "xphb"});
			expect(xphb).toMatchObject({disadvantage: [], bonuses: [{label: "Exhaustion 3", value: -6}]});
			expect(getEncounterConditionContributors(state, goblin, {kind: "initiative"}, {ruleset: "tgtt"}).bonuses.map(it => it.value)).toEqual([-3]);
		});
	});
});
