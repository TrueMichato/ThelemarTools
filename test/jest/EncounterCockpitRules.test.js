import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {applyEncounterEffect, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {applyEncounterCondition} from "../../js/encounterworkspace/encounterworkspace-conditions-rules.js";
import {withEncounterBattlefieldEntry} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {
	getCockpitEffectItems,
	getCockpitExtraDefensesGetter,
	getCockpitShellDerived,
	withCockpitTurnAdvanced,
} from "../../js/encounterworkspace/cockpit/rules.js";
import {byId, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const settings = {ruleset: "phb", monsterDeathSaves: false};
let uid = 0;
const fnUid = () => `fx${++uid}`;
const withEffect = (state, opts) => withEncounterDraft(state, (draft, {log}) => applyEncounterEffect(draft, {fnUid, log, ...opts})).state;
const withCondition = (state, opts) => withEncounterDraft(state, (draft, {log}) => applyEncounterCondition(draft, {ruleset: "phb", log, ...opts})).state;

describe("Encounter Cockpit rules wiring", () => {
	it("leaves an untouched creature's shell numbers to the statblock", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const shell = getCockpitShellDerived(state, byId(state, "c1"), settings);
		expect(shell.derived).toBeTruthy();
		expect(shell).not.toHaveProperty("ac");
		expect(shell).not.toHaveProperty("speedText");
		expect(shell).not.toHaveProperty("notes");
	});

	it("shows effect AC and speed, with reasons, and condition notes", async () => {
		let state = await pGetCockpitState([["Goblin", 1]]);
		state = withEffect(state, {targetIds: ["c1"], def: "shield-of-faith"});
		state = withEffect(state, {targetIds: ["c1"], def: "haste"});
		state = withCondition(state, {targetIds: ["c1"], condition: "restrained"});
		const shell = getCockpitShellDerived(state, byId(state, "c1"), settings);
		expect(shell.ac).toBe(15 + 2 + 2);
		expect(shell.acReasons).toEqual(expect.arrayContaining(["Shield of Faith +2", "Haste +2"]));
		// Restrained wins over Haste: speed 0.
		expect(shell.speedText).toMatch(/^0 ft\./);
		expect(shell.notes.some(it => /Attacks against it have advantage/.test(it))).toBe(true);
		expect(shell.notes).toContain("Its attacks have disadvantage");
	});

	it("lists battlefield entries that reach a creature alongside its own effects", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withEffect(state, {targetIds: ["c1"], def: "bless"});
		({state} = withEncounterBattlefieldEntry(state, {rule: "darkness"}));
		({state} = withEncounterBattlefieldEntry(state, {rule: "half-cover", scope: "selection", ids: ["c2"]}));

		const c1 = getCockpitEffectItems(state, byId(state, "c1"));
		expect(c1.map(it => it.label)).toEqual(["Bless", "Darkness"]);
		const field = c1.find(it => it.source === "battlefield");
		expect(field).toMatchObject({k: "bf", wide: true});
		expect(field.hoverEntry).toMatchObject({type: "entries", name: "Darkness"});
		expect(field.hoverEntry.entries.length).toBeGreaterThan(0);

		expect(getCockpitEffectItems(state, byId(state, "c2")).map(it => [it.label, it.wide])).toEqual([["Darkness", true], ["Half cover", false]]);
	});

	it("halves damage once when an effect and the statblock both resist", async () => {
		let state = await pGetCockpitState([["Shadow", 1], ["Goblin", 1]]);
		const resistFire = {name: "Fire ward", resist: ["fire"], mods: []};
		state = withEffect(state, {targetIds: ["c1", "c2"], def: resistFire});
		const shadowHp = byId(state, "c1").hp.current;
		const goblinHp = byId(state, "c2").hp.current;

		const {state: next} = EncounterWorkspaceState.withTypedDamage(state, {
			amount: 6,
			damageType: "fire",
			source: "magicalAttack",
			targetIds: ["c1", "c2"],
			getExtraDefenses: getCockpitExtraDefensesGetter(state, settings),
		});
		expect(shadowHp - byId(next, "c1").hp.current).toBe(3);
		expect(goblinHp - byId(next, "c2").hp.current).toBe(3);

		const {state: plain} = EncounterWorkspaceState.withTypedDamage(state, {amount: 6, damageType: "fire", source: "magicalAttack", targetIds: ["c2"]});
		expect(goblinHp - byId(plain, "c2").hp.current).toBe(6);
	});

	it("ticks timed effects and conditions only when the round wraps, and ticks the battlefield", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = {...state, instances: state.instances.map((it, ix) => ({...it, initiative: 20 - ix}))};
		state = withEffect(state, {targetIds: ["c1"], def: "bless", rounds: 2});
		state = withCondition(state, {targetIds: ["c2"], condition: "frightened", rounds: 1});
		({state} = withEncounterBattlefieldEntry(state, {rule: "fog", rounds: 1}));
		state = EncounterWorkspaceState.withTurn(state, "start");
		const order = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);

		// Mirrors the engine's pCommit: the recipe gets a clone and its return value is the next state.
		const advance = before => {
			const logs = [];
			const next = withCockpitTurnAdvanced(
				EncounterWorkspaceState.withTurn(structuredClone(before), "next"),
				{previousTurn: before.turn, log: (kind, text) => logs.push({kind, text})},
			);
			return {state: EncounterWorkspaceState.validate(next), logs};
		};

		let step = advance(state);
		expect(step.state.turn).toEqual({round: 1, activeId: order[1]});
		expect(byId(step.state, "c1").effects[0].rounds).toBe(2);
		expect(byId(step.state, "c2").conditions).toContain("frightened");

		step = advance(step.state);
		expect(step.state.turn).toEqual({round: 2, activeId: order[0]});
		expect(byId(step.state, "c1").effects[0].rounds).toBe(1);
		expect(byId(step.state, "c2").conditions).not.toContain("frightened");
		expect(step.state.battlefield.map(it => it.rule)).not.toContain("fog");
		expect(step.logs.map(it => it.text).join("\n")).toMatch(/Fog.*ended/i);
	});

	it("steps the turn back without wrapping past the first turn", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = {...state, instances: state.instances.map((it, ix) => ({...it, initiative: 20 - ix}))};
		state = EncounterWorkspaceState.withTurn(state, "start");
		const order = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
		expect(() => EncounterWorkspaceState.withTurn(state, "prev")).toThrow(/first turn/);
		state = EncounterWorkspaceState.withTurn(EncounterWorkspaceState.withTurn(state, "next"), "next");
		expect(state.turn).toEqual({round: 2, activeId: order[0]});
		expect(EncounterWorkspaceState.withTurn(state, "prev").turn).toEqual({round: 1, activeId: order[1]});
	});
});
