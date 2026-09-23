import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {pRollEncounterSelection} from "../../js/encounterworkspace/encounterworkspace-roll.js";
import {getEncounterModifierForPreset} from "../../js/encounterworkspace/encounterworkspace-effects.js";
import {getNpcTrackerConditionPickerModel} from "../../js/dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerConditionRollMeta} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";

const monster = {
	name: "Goblin",
	source: "MM",
	str: 8,
	dex: 14,
	wis: 12,
	save: {dex: "+6"},
	skill: {stealth: "+6"},
};
const getState = ({selectedIds = ["one", "two"], conditions = [[], []], modifiers = [[], []]} = {}) => ({
	instances: [
		{id: "one", monster, conditions: conditions[0], modifiers: modifiers[0]},
		{id: "two", monster, conditions: conditions[1], modifiers: modifiers[1]},
	],
	selectedIds,
});
const skills = [
	{id: "stealth", name: "stealth", label: "Stealth", ability: "dex"},
	{id: "perception", name: "perception", label: "Perception", ability: "wis"},
];

describe("Encounter Workspace rolls", () => {
	it("rolls no dice for zero targets, and only selected IDs for one or duplicate monsters", async () => {
		const roll = jest.fn(async () => ({die: 10, total: 12, mode: "normal", statusText: ""}));
		expect(await pRollEncounterSelection({state: getState({selectedIds: []}), rollType: "ability", key: "dex", pRoll: roll}))
			.toEqual({results: [], failures: []});
		expect(roll).not.toHaveBeenCalled();
		const single = await pRollEncounterSelection({state: getState({selectedIds: ["two"]}), rollType: "ability", key: "dex", pRoll: roll});
		expect(single.results.map(it => [it.id, it.name, it.bonus, it.label])).toEqual([["two", "Goblin #2", 2, "Dexterity check"]]);
		expect(roll).toHaveBeenCalledTimes(1);
		const both = await pRollEncounterSelection({state: getState(), rollType: "ability", key: "dex", pRoll: roll});
		expect(both.results.map(it => it.id)).toEqual(["one", "two"]);
		expect(roll).toHaveBeenCalledTimes(3);
	});

	it("uses explicit saving throw and skill bonuses, falling back to governing abilities", async () => {
		const roll = jest.fn(async ({bonus}) => ({die: 10, total: 10 + bonus, mode: "normal", statusText: ""}));
		const state = getState({selectedIds: ["one"]});
		for (const [rollType, key, expected] of [
			["save", "dex", 6],
			["save", "wis", 1],
			["skill", "stealth", 6],
			["skill", "perception", 1],
		]) {
			const {results} = await pRollEncounterSelection({state, rollType, key, skills, pRoll: roll});
			expect(results[0].bonus).toBe(expected);
			expect(results[0].total).toBe(10 + expected);
		}
	});

	it("does not mistake blank explicit bonuses for a zero modifier", async () => {
		const state = getState({selectedIds: ["one"]});
		state.instances[0].monster = {...monster, save: {wis: ""}, skill: {perception: ""}};
		const roll = jest.fn(async ({bonus}) => ({die: 10, total: 10 + bonus, mode: "normal", statusText: ""}));
		const saving = await pRollEncounterSelection({state, rollType: "save", key: "wis", pRoll: roll});
		const skill = await pRollEncounterSelection({state, rollType: "skill", key: "perception", skills, pRoll: roll});
		expect(saving.results[0].bonus).toBe(1);
		expect(skill.results[0].bonus).toBe(1);
	});

	it("logs every genuine roll through Renderer.dice and reports its advantage source and die", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(17).mockResolvedValueOnce(19);
		try {
			const {results, failures} = await pRollEncounterSelection({
				state: getState({conditions: [["poisoned"], []]}),
				rollType: "ability",
				key: "dex",
				rollMode: "advantage",
			});

			expect(failures).toEqual([]);
			expect(results.map(it => [it.mode, it.die, it.total])).toEqual([["normal", 15, 17], ["advantage", 17, 19]]);
			expect(results[0].statusText).toMatch(/advantage and disadvantage cancel/);
			expect(results[0].statusText).toContain("Poisoned");
			expect(results[0].statusText).toContain("Chosen advantage");
			expect(results[1].statusText).toContain("Chosen advantage");
			expect(dice).toHaveBeenNthCalledWith(1, "1d20+2", expect.objectContaining({name: "Goblin #1", label: expect.stringContaining("Dexterity check")}), {isResultUsed: true});
			expect(dice).toHaveBeenNthCalledWith(2, "2d20dl1+2", expect.objectContaining({name: "Goblin #2"}), {isResultUsed: true});
		} finally {
			dice.mockRestore();
		}
	});

	it("keeps the DMG save-only rule separate from the house check-and-save variant", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(16);
		try {
			const dmg = getState({selectedIds: ["one"], modifiers: [[getEncounterModifierForPreset("desecrated-dmg")], []]});
			const house = getState({selectedIds: ["one"], modifiers: [[getEncounterModifierForPreset("desecrated-house")], []]});
			const roll = async (state, rollType, key) => (await pRollEncounterSelection({state, rollType, key, skills})).results[0];
			expect((await roll(dmg, "ability", "wis")).mode).toBe("normal");
			expect((await roll(dmg, "skill", "perception")).mode).toBe("normal");
			expect((await roll(dmg, "save", "wis")).mode).toBe("advantage");
			expect((await roll(house, "ability", "wis")).mode).toBe("advantage");
			expect((await roll(house, "skill", "perception")).mode).toBe("advantage");
			expect((await roll(house, "save", "wis")).mode).toBe("advantage");
			expect(dice).toHaveBeenNthCalledWith(1, "1d20+1", expect.anything(), {isResultUsed: true});
			expect(dice).toHaveBeenNthCalledWith(2, "1d20+1", expect.anything(), {isResultUsed: true});
			expect(dice).toHaveBeenNthCalledWith(3, "2d20dl1+1", expect.anything(), {isResultUsed: true});
			expect((await roll(house, "skill", "perception")).sourcesText).toContain("house rule");
		} finally {
			dice.mockRestore();
		}
	});

	it("composes signed flat bonuses and named modes with conditions and manual choice", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(15).mockResolvedValueOnce(13);
		const modifier = {id: "custom", name: "Blessed mist", scopes: ["check", "save"], mode: "advantage", bonus: 3};
		const penalty = {id: "penalty", name: "Dark wind", scopes: ["check"], mode: "disadvantage", bonus: -2};
		const state = getState({conditions: [["poisoned"], ["stunned"]], modifiers: [[modifier, penalty], [modifier]]});
		try {
			const first = await pRollEncounterSelection({state: {...state, selectedIds: ["one"]}, rollType: "skill", key: "stealth", skills, rollMode: "advantage"});
			expect(first.results[0]).toMatchObject({mode: "normal", bonus: 7, baseBonus: 6, modifierBonus: 1, die: 8, total: 15});
			expect(first.results[0].sourcesText).toContain("Poisoned");
			expect(first.results[0].sourcesText).toContain("Chosen advantage");
			expect(first.results[0].sourcesText).toContain("Blessed mist");
			expect(first.results[0].sourcesText).toContain("Dark wind -2");
			expect(dice).toHaveBeenNthCalledWith(1, "1d20+7", expect.objectContaining({label: expect.stringContaining("Blessed mist +3")}), {isResultUsed: true});
			const save = await pRollEncounterSelection({state: {...state, selectedIds: ["one"]}, rollType: "save", key: "dex", skills});
			expect(save.results[0]).toMatchObject({mode: "advantage", bonus: 9, modifierBonus: 3, die: 4});
			expect(save.results[0].sourcesText).not.toContain("Dark wind");
			expect(dice).toHaveBeenNthCalledWith(2, "2d20dl1+9", expect.anything(), {isResultUsed: true});
			const failed = await pRollEncounterSelection({state: {...state, selectedIds: ["two"]}, rollType: "save", key: "dex"});
			expect(failed.results[0]).toMatchObject({mode: "autoFail", die: null, total: null});
			expect(failed.results[0].sourcesText).toContain("Stunned");
			expect(dice).toHaveBeenCalledTimes(2);
		} finally {
			dice.mockRestore();
		}
	});

	it("does not alter NPC Manager's default roll effects when encounter extras are absent", () => {
		const npc = {conditions: ["poisoned"]};
		expect(getNpcTrackerConditionRollMeta({npc, rollType: "ability", key: "dex"}))
			.toEqual({mode: "disadvantage", reasons: ["Poisoned"], statusText: "Disadvantage: Poisoned"});
		expect(getNpcTrackerConditionRollMeta({npc, rollType: "ability", key: "dex", additionalEffects: [{mode: "advantage", reason: "Area effect"}]}))
			.toMatchObject({mode: "normal", reasons: ["Area effect", "Poisoned"]});
		expect(() => getNpcTrackerConditionRollMeta({npc, rollType: "save", additionalEffects: [{mode: "autoFail", reason: "Fake"}]}))
			.toThrow(/Additional roll effects/);
	});

	it("applies save disadvantage and automatic failures without fabricating or logging dice", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(12);
		try {
			const {results, failures} = await pRollEncounterSelection({
				state: getState({conditions: [["restrained"], ["stunned"]]}),
				rollType: "save",
				key: "dex",
			});
			expect(failures).toEqual([]);
			expect(results.map(it => [it.mode, it.die, it.total])).toEqual([["disadvantage", 6, 12], ["autoFail", null, null]]);
			expect(results[0].statusText).toContain("Restrained");
			expect(results[1].statusText).toContain("Stunned");
			expect(dice).toHaveBeenCalledTimes(1);
			expect(dice).toHaveBeenCalledWith("2d20dh1+6", expect.anything(), {isResultUsed: true});
		} finally {
			dice.mockRestore();
		}
	});

	it("reports partial failures by instance when dice cancel, return invalid data, or throw", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(11)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(Renderer.dice._SYMBOL_PARSE_FAILED)
			.mockRejectedValueOnce(new Error("Dice unavailable"));
		const state = {
			instances: [1, 2, 3, 4].map(ix => ({id: `${ix}`, monster, conditions: []})),
			selectedIds: ["1", "2", "3", "4"],
		};
		try {
			const {results, failures} = await pRollEncounterSelection({state, rollType: "ability", key: "wis"});
			expect(results.map(it => [it.id, it.total])).toEqual([["1", 11]]);
			expect(failures).toEqual([
				{id: "2", name: "Goblin #2", reason: "Roll cancelled or dice result invalid."},
				{id: "3", name: "Goblin #3", reason: "Roll cancelled or dice result invalid."},
				{id: "4", name: "Goblin #4", reason: "Dice unavailable"},
			]);
			expect(dice).toHaveBeenCalledTimes(4);
		} finally {
			dice.mockRestore();
		}
	});

	it("keeps saved conditions removable when their source is no longer installed", () => {
		expect(getNpcTrackerConditionPickerModel({
			conditions: ["dreambound"],
			conditionCatalog: [{name: "poisoned", label: "Poisoned", source: "PHB"}],
		}).active).toEqual([{name: "dreambound", label: "Dreambound"}]);
	});

	it("does not infer mechanics or fabricate bonuses for an unavailable homebrew skill or condition", async () => {
		const state = getState({selectedIds: ["one"], conditions: [["dreambound"], []]});
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(10);
		const lore = {id: "lore|hb", name: "lore", label: "Lore", ability: null};
		try {
			const noBonus = await pRollEncounterSelection({state, rollType: "skill", key: lore.id, skills: [lore]});
			expect(noBonus.results).toEqual([]);
			expect(noBonus.failures[0].reason).toMatch(/No valid bonus or governing ability/);
			expect(dice).not.toHaveBeenCalled();

			state.instances[0].monster = {...monster, skill: {lore: "+4"}};
			const {results} = await pRollEncounterSelection({state, rollType: "skill", key: lore.id, skills: [lore]});
			expect(results[0]).toMatchObject({bonus: 4, mode: "normal", total: 10});
			expect(dice).toHaveBeenCalledWith("1d20+4", expect.anything(), {isResultUsed: true});
		} finally {
			dice.mockRestore();
		}
	});

	it("rejects invalid roll setup before invoking dice", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2");
		try {
			await expect(pRollEncounterSelection({state: getState(), rollType: "attack", key: "str"})).rejects.toThrow(/Choose an ability/);
			await expect(pRollEncounterSelection({state: getState(), rollType: "save", key: "none"})).rejects.toThrow(/valid ability/);
			await expect(pRollEncounterSelection({state: getState(), rollType: "skill", key: "missing", skills})).rejects.toThrow(/valid ability or skill/);
			expect(dice).not.toHaveBeenCalled();
		} finally {
			dice.mockRestore();
		}
	});
});
