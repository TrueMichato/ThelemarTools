import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	matchEncounterSkill,
	parseEncounterConsoleCommand,
	parseEncounterDuration,
	parseEncounterHpCommand,
	resolveEncounterConsoleTargets,
} from "../../js/encounterworkspace/encounterworkspace-console-parse.js";
import {pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const EFFECTS = [{key: "bless", label: "Bless"}, {key: "half-cover", label: "Half cover"}, {key: "three-quarters-cover", label: "Three-quarters cover"}];
const parse = text => parseEncounterConsoleCommand(text, {effects: EFFECTS});

describe("Encounter Cockpit console grammar", () => {
	it("parses the HP-field grammar", () => {
		expect(parseEncounterHpCommand("-12 fire")).toEqual({mode: "damage", amount: 12, expr: null, damageType: "fire", half: false, crit: false});
		expect(parseEncounterHpCommand("12")).toMatchObject({mode: "damage", amount: 12, damageType: null});
		expect(parseEncounterHpCommand("-2d6 + 3 pois half")).toMatchObject({mode: "damage", amount: null, expr: "2d6+3", damageType: "poison", half: true});
		expect(parseEncounterHpCommand("+5")).toMatchObject({mode: "heal", amount: 5});
		expect(parseEncounterHpCommand("+1d8+2")).toMatchObject({mode: "heal", expr: "1d8+2"});
		expect(parseEncounterHpCommand("t8")).toMatchObject({mode: "temp", amount: 8});
		expect(parseEncounterHpCommand("=20")).toMatchObject({mode: "set", amount: 20});
		expect(parseEncounterHpCommand("12 bananas")).toBeNull();
		expect(parseEncounterHpCommand("")).toBeNull();
	});

	it("parses durations in rounds, minutes and hours", () => {
		expect(parseEncounterDuration("prone 2r")).toEqual({amount: 2, unit: "round", rounds: 2, rest: "prone"});
		expect(parseEncounterDuration("bless 1 min")).toMatchObject({rounds: 10, rest: "bless"});
		expect(parseEncounterDuration("1 hour")).toMatchObject({rounds: 600});
		expect(parseEncounterDuration("8 radiant")).toBeNull();
	});

	it("lifts @targets out of the line and parses damage and healing verbs", () => {
		expect(parse("@gob2 7 fire")).toEqual({verb: "damage", targets: ["gob2"], amount: 7, expr: null, damageType: "fire", crit: false, half: false});
		expect(parse("2d6+3 crit slash @g1,@party")).toMatchObject({verb: "damage", targets: ["g1", "party"], expr: "2d6+3", crit: true, damageType: "slashing"});
		expect(parse("-12 cold")).toMatchObject({verb: "damage", amount: 12, damageType: "cold"});
		expect(parse("heal 2d4+2")).toMatchObject({verb: "heal", expr: "2d4+2"});
		expect(parse("+5")).toMatchObject({verb: "heal", amount: 5});
		expect(parse("thp 6")).toMatchObject({verb: "temp", amount: 6});
		expect(parse("=20")).toMatchObject({verb: "set", amount: 20});
		expect(parse("@orc")).toEqual({verb: "target", targets: ["orc"]});
		expect(parse("   ")).toBeNull();
	});

	it("parses saves with DC, mode, damage, half, duration and condition", () => {
		expect(parse("save dex 15 adv 8d6 fire half")).toEqual({
			verb: "save",
			targets: [],
			ability: "dex",
			dc: 15,
			mode: "advantage",
			damage: {amount: null, expr: "8d6"},
			damageType: "fire",
			halfOnSuccess: true,
			condition: null,
			rounds: null,
		});
		expect(parse("sv wisdom 13 frightened 1 min")).toMatchObject({ability: "wis", dc: 13, condition: "frightened", rounds: 10, damage: null});
		expect(parse("save con 12 10 poison poisoned")).toMatchObject({dc: 12, damage: {amount: 10}, damageType: "poison", condition: "poisoned"});
		expect(parse("save luck 10")).toMatchObject({verb: "error", error: expect.stringContaining("Which save")});
	});

	it("parses skill and ability checks, preferring abilities for bare abbreviations", () => {
		expect(parse("roll stealth adv dc 14")).toEqual({verb: "check", targets: [], skill: "stealth", ability: "dex", mode: "advantage", dc: 14});
		expect(parse("check perc dis")).toMatchObject({skill: "perception", ability: "wis", mode: "disadvantage", dc: null});
		expect(parse("skill sleight of hand 12")).toMatchObject({skill: "sleight of hand", dc: 12});
		expect(parse("chk int")).toMatchObject({skill: null, ability: "int"});
		expect(parse("chk intim")).toMatchObject({skill: "intimidation"});
		expect(parse("roll juggling")).toMatchObject({verb: "error"});
		expect(matchEncounterSkill("animalhandling")).toBe("animal handling");
	});

	it("parses concentration, death saves, initiative, drop and exhaustion", () => {
		expect(parse("conc hold person")).toMatchObject({verb: "concentration", spell: "Hold Person"});
		expect(parse("conc off")).toMatchObject({verb: "concentration", spell: null});
		expect(parse("death save")).toMatchObject({verb: "deathSave"});
		expect(parse("init 17")).toMatchObject({verb: "initiative", total: 17});
		expect(parse("drop")).toMatchObject({verb: "dropConcentration"});
		expect(parse("exh 9")).toMatchObject({verb: "exhaustion", level: 6});
	});

	it("parses conditions, effects with casters, and removals", () => {
		expect(parse("prone 2r")).toEqual({verb: "condition", targets: [], condition: "prone", rounds: 2});
		expect(parse("@gob1 restr")).toMatchObject({verb: "condition", condition: "restrained", rounds: null});
		expect(parse("bless 1 min by @cleric")).toMatchObject({verb: "effect", effect: "bless", rounds: 10, targets: [], caster: "cleric"});
		expect(parse("bless by cleric")).toMatchObject({verb: "effect", effect: "bless", caster: "cleric"});
		expect(parse("3/4 cover")).toMatchObject({verb: "effect", effect: "three-quarters-cover"});
		expect(parse("-prone")).toMatchObject({verb: "remove", condition: "prone", effect: null});
		expect(parse("end bless")).toMatchObject({verb: "remove", condition: null, effect: "bless"});
		expect(parse("unpois")).toMatchObject({verb: "remove", condition: "poisoned"});
		expect(parse("dazed")).toMatchObject({verb: "error"});
		expect(parseEncounterConsoleCommand("dazed", {conditionNames: ["dazed"]})).toMatchObject({verb: "condition", condition: "dazed"});
	});

	it("resolves fuzzy targets against real state", async () => {
		let state = await pGetCockpitState([["Goblin", 3], ["Goblin Boss", 1], ["Orc", 1]]);
		state = EncounterWorkspaceState.validate({
			...state,
			instances: state.instances.map(it => it.id === "c3" ? {...it, defeated: true} : ["c4", "c5"].includes(it.id) ? {...it, customGroup: "Raiders", initiative: 10} : it),
			selectedIds: ["c1", "c3"],
			turn: {round: 1, activeId: "c5"},
		});
		const resolve = (...specs) => resolveEncounterConsoleTargets(state, specs);
		expect(resolve("gob2")).toEqual({ids: ["c2"], bad: [], what: "Goblin #2"});
		expect(resolve("goblins").ids).toEqual(["c1", "c2"]);
		expect(resolve("boss").ids).toEqual(["c4"]);
		expect(resolve("raiders")).toEqual({ids: ["c4", "c5"], bad: [], what: "Raiders"});
		expect(resolve("g1").ids).toEqual(["c4", "c5"]);
		expect(resolve("sel").ids).toEqual(["c1"]);
		expect(resolve("all").ids).toEqual(["c1", "c2", "c4", "c5"]);
		expect(resolve("me").ids).toEqual(["c5"]);
		expect(resolve("party").ids).toEqual([]);
		expect(resolve("orc,gob1")).toMatchObject({ids: ["c5", "c1"], what: "Orc #1 + Goblin #1"});
		expect(resolve("dragon", "orc")).toMatchObject({ids: ["c5"], bad: ["dragon"]});
	});
});
