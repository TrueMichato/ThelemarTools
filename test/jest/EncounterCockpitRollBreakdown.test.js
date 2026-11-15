import {
	combineEncounterContributorPartials,
	getEncounterAcBreakdown,
	getEncounterAttackOptions,
	getEncounterContributorGetter,
	getEncounterDamageRollBreakdown,
	getEncounterInitiativeBonus,
	getEncounterProficiencyBonus,
	getEncounterRollBreakdown,
	getEncounterRollMode,
	getEncounterRollModifier,
	rollEncounterDice,
} from "../../js/encounterworkspace/encounterworkspace-rollbreakdown.js";
import {byId, getD20Rng, getMmMonster, getSequenceRng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

describe("Encounter Cockpit roll breakdown", () => {
	it("names the natural roll and every statblock bonus on a real skill check", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const roll = getEncounterRollBreakdown({instance: byId(state, "c1"), query: {kind: "check", skill: "stealth"}, rng: getD20Rng(13)});
		expect(roll.natural).toBe(13);
		expect(roll.parts.map(it => [it.label, it.value])).toEqual([["DEX mod", 2], ["Expertise", 4]]);
		expect(roll).toMatchObject({total: 19, text: "19 (13 +2 +4)", mode: "normal", crit: false});
	});

	it("uses listed save proficiency and falls back to the ability mod", async () => {
		const state = await pGetCockpitState([["Bandit Captain", 1]]);
		const instance = byId(state, "c1");
		const dex = getEncounterRollBreakdown({instance, query: {kind: "save", ability: "dex", dc: 15}, rng: getD20Rng(10)});
		expect(dex.parts.map(it => it.label)).toEqual(["DEX mod", "Proficiency"]);
		expect(dex).toMatchObject({total: 15, success: true});
		const con = getEncounterRollBreakdown({instance, query: {kind: "save", ability: "con", dc: 15}, rng: getD20Rng(10)});
		expect(con).toMatchObject({total: 12, text: "12 (10 +2)", success: false});
	});

	it("rolls contributor dice bonuses and labels them with the rolled value", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const getContributors = () => ({bonuses: [{label: "Bless", value: "1d4", source: "effect:bless"}, {label: "Elite", value: 2, source: "template:elite"}]});
		const roll = getEncounterRollBreakdown({
			instance: byId(state, "c1"),
			query: {kind: "attack", attackName: "Scimitar"},
			rng: getSequenceRng(0.6, 0.5),
			getContributors,
		});
		expect(roll.natural).toBe(13);
		expect(roll.parts.map(it => it.text)).toEqual(["DEX mod +2", "Proficiency +2", "Bless 1d4→3", "Elite +2"]);
		expect(roll).toMatchObject({total: 22, text: "22 (13 +2 +2 +3 +2)"});
	});

	it("cancels advantage and disadvantage from any number of sources and records forced modes", async () => {
		expect(getEncounterRollMode({advantage: [{label: "Bless"}], forcedMode: "dis"})).toMatchObject({mode: "normal", cancelled: true});
		expect(getEncounterRollMode({advantage: [{label: "A"}, {label: "B"}], disadvantage: []})).toMatchObject({mode: "advantage", cancelled: false});
		const state = await pGetCockpitState([["Goblin", 1]]);
		const roll = getEncounterRollBreakdown({
			instance: byId(state, "c1"),
			query: {kind: "save", ability: "wis"},
			rng: getD20Rng(4, 17),
			forcedMode: "adv",
			getContributors: () => ({advantage: [{label: "Desecrated Ground", source: "battlefield"}]}),
		});
		expect(roll).toMatchObject({mode: "advantage", natural: 17, rolls: [4, 17]});
		expect(roll.advantage.map(it => it.label)).toEqual(["Desecrated Ground", "Shift/Ctrl"]);
	});

	it("marks auto-fail saves as failures regardless of the total", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const roll = getEncounterRollBreakdown({
			instance: byId(state, "c1"),
			query: {kind: "save", ability: "dex", dc: 5},
			rng: getD20Rng(20),
			getContributors: () => ({autoFail: [{label: "Paralyzed", source: "condition:paralyzed"}]}),
		});
		expect(roll).toMatchObject({autoFail: true, success: false, total: 22});
	});

	it("doubles dice, not flat bonuses, on a critical damage roll", () => {
		const damage = getEncounterDamageRollBreakdown({expr: "1d6+2", damageType: "slashing", crit: true, rng: getSequenceRng(0.5, 0.99)});
		expect(damage.parts[0]).toMatchObject({dice: "2d6+2", rolls: [4, 6], value: 12});
		expect(damage).toMatchObject({total: 12, crit: true, damageType: "slashing"});
		expect(rollEncounterDice("2d6 - 1", getSequenceRng(0, 0)).total).toBe(1);
		expect(() => rollEncounterDice("fire")).toThrow("Cannot roll");
	});

	it("explains AC with flat contributors and notes dice that cannot apply", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const ac = getEncounterAcBreakdown({
			instance: byId(state, "c1"),
			getContributors: () => ({bonuses: [{label: "Half cover", value: 2}, {label: "Elite", value: 2}, {label: "Odd", value: "1d4"}]}),
		});
		expect(ac).toMatchObject({base: 15, total: 19, text: "19 (15 +2 +2)"});
		expect(ac.baseFrom).toEqual(["leather armor", "shield"]);
		expect(ac.notes).toEqual(["Odd (1d4) does not change AC"]);
	});

	it("reads initiative, proficiency and attack options from real statblocks", () => {
		const goblin = getMmMonster("Goblin");
		expect(getEncounterInitiativeBonus(goblin)).toBe(2);
		expect(getEncounterInitiativeBonus({...goblin, initiative: {proficiency: 1}})).toBe(4);
		expect(getEncounterProficiencyBonus({cr: "17"})).toBe(6);
		const attacks = getEncounterAttackOptions(goblin);
		expect(attacks.map(it => [it.name, it.bonus, it.melee, it.ranged])).toEqual([["Scimitar", 4, true, false], ["Shortbow", 4, false, true]]);
		expect(attacks[0].damage).toEqual([{expr: "1d6+2", damageType: "slashing"}]);
	});

	it("merges providers into one getter and previews modifiers without rolling", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const getContributors = getEncounterContributorGetter(state, [
			() => ({bonuses: [{label: "Elite", value: 2}]}),
			() => [{disadvantage: [{label: "Dim light"}]}, null],
		]);
		const preview = getEncounterRollModifier({instance: byId(state, "c1"), query: {kind: "check", skill: "perception"}, getContributors});
		expect(preview).toMatchObject({modifier: 1, mode: "disadvantage"});
		expect(preview.parts.map(it => it.label)).toEqual(["WIS mod", "Elite"]);
		expect(combineEncounterContributorPartials([{notes: ["a"]}, [{notes: "b"}]]).notes).toEqual(["a", "b"]);
	});
});
