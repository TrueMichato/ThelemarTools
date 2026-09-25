import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {
	getEncounterRollFromPackedDice,
	pRollEncounterInstance,
	pRollEncounterSelection,
} from "../../js/encounterworkspace/encounterworkspace-roll.js";
import {ENCOUNTER_ROLL_PRESETS, getEncounterModifierForPreset} from "../../js/encounterworkspace/encounterworkspace-effects.js";
import {getNpcTrackerConditionPickerModel} from "../../js/dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerConditionRollMeta} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";

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
	groups: [],
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

	it("rolls initiative as a Dexterity check with explicit bonus, check modifiers, conditions and authored advantage", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(17).mockResolvedValueOnce(19);
		const state = getState({
			conditions: [["poisoned"], []],
			modifiers: [[{id: "mist", name: "Blessed mist", scopes: ["check"], mode: "advantage", bonus: 2}], []],
		});
		state.instances[0].monster = {...monster, initiative: 4};
		state.instances[1].monster = {...monster, initiative: {initiative: 5, advantageMode: "adv"}};
		try {
			const {results, failures} = await pRollEncounterSelection({state, rollType: "initiative"});
			expect(failures).toEqual([]);
			expect(results.map(it => [it.baseBonus, it.bonus, it.mode, it.total]))
				.toEqual([[4, 6, "normal", 17], [5, 5, "advantage", 19]]);
			expect(results[0].sourcesText).toContain("Poisoned");
			expect(results[0].sourcesText).toContain("Blessed mist +2");
			expect(results[1].sourcesText).toContain("Monster initiative");
			expect(dice).toHaveBeenNthCalledWith(1, "1d20+6", expect.objectContaining({
				name: "Goblin #1", label: expect.stringContaining("Initiative (Dexterity check)"),
			}), {isResultUsed: true});
			expect(dice).toHaveBeenNthCalledWith(2, "2d20dl1+5", expect.objectContaining({name: "Goblin #2"}), {isResultUsed: true});
		} finally {
			dice.mockRestore();
		}
	});

	it("leaves prior initiative intact on cancelled or invalid dice and reports per-instance failures", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(16).mockResolvedValueOnce(null);
		const state = getState();
		state.instances[0].initiative = 3;
		state.instances[1].initiative = 12;
		try {
			const {results, failures} = await pRollEncounterSelection({state, rollType: "initiative"});
			expect(results.map(it => it.id)).toEqual(["one"]);
			expect(failures).toEqual([{id: "two", name: "Goblin #2", reason: "Roll cancelled or dice result invalid."}]);
			const initial = {
				...EncounterWorkspaceState.getEmpty(),
				instances: state.instances.map(it => ({
					...it, hash: "goblin_mm", areaNotes: [], statblockOperations: [], hp: {current: 7, max: 7, temp: 0},
				})),
				selectedIds: state.selectedIds,
			};
			const saved = EncounterWorkspaceState.withInitiativeResults(initial, results.map(({id, total}) => ({id, total})));
			expect(saved.instances.map(it => it.initiative)).toEqual([16, 12]);
			expect(await pRollEncounterSelection({
				state: {...state, selectedIds: ["two"]},
				rollType: "initiative",
				pRoll: async () => ({mode: "autoFail", total: null, die: null}),
			})).toMatchObject({results: [], failures: [{id: "two"}]});
		} finally {
			dice.mockRestore();
		}
	});

	it("does not invent an initiative bonus for monsters without a Dexterity score or valid explicit bonus", async () => {
		const state = getState({selectedIds: ["one"]});
		state.instances[0].monster = {name: "Unknown", source: "TST"};
		const roll = jest.fn();
		const {results, failures} = await pRollEncounterSelection({state, rollType: "initiative", pRoll: roll});
		expect(results).toEqual([]);
		expect(failures).toEqual([{id: "one", name: "Unknown #1", reason: "No valid initiative bonus is available for this monster."}]);
		expect(roll).not.toHaveBeenCalled();
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
			await expect(pRollEncounterSelection({state: getState(), rollType: "attack", key: "str"})).rejects.toThrow(/ability check/);
			await expect(pRollEncounterSelection({state: getState(), rollType: "initiative", key: "wis"})).rejects.toThrow(/valid ability/);
			await expect(pRollEncounterSelection({state: getState(), rollType: "save", key: "none"})).rejects.toThrow(/valid ability/);
			await expect(pRollEncounterSelection({state: getState(), rollType: "skill", key: "missing", skills})).rejects.toThrow(/valid ability or skill/);
			expect(dice).not.toHaveBeenCalled();
		} finally {
			dice.mockRestore();
		}
	});

	it("classifies only explicitly contextualized statblock d20 rolls with exact bonuses", () => {
		expect(getEncounterRollFromPackedDice({subType: "d20", context: {type: "hit"}, toRoll: "1d20+4"}))
			.toMatchObject({rollType: "attack", baseBonus: 4});
		expect(getEncounterRollFromPackedDice({subType: "d20", context: {type: "skillCheck", skill: "Perception"}, toRoll: "1d20 - 2"}))
			.toMatchObject({rollType: "skill", key: "perception", baseBonus: -2});
		expect(getEncounterRollFromPackedDice({subType: "d20", context: {type: "savingThrow", ability: "dex"}, toRoll: "1d20+6"}))
			.toMatchObject({rollType: "save", key: "dex", baseBonus: 6});
		expect(getEncounterRollFromPackedDice({subType: "d20", context: {type: "initiative"}, toRoll: "1d20+3"}))
			.toMatchObject({rollType: "initiative", baseBonus: 3});
		expect(getEncounterRollFromPackedDice({subType: "damage", toRoll: "1d20+4"})).toBeNull();
		expect(getEncounterRollFromPackedDice({toRoll: "1d6", successThresh: 5})).toBeNull();
		expect(getEncounterRollFromPackedDice({subType: "d20", toRoll: "1d20+4"}).unsupported).toMatch(/no recognized/);
		expect(getEncounterRollFromPackedDice({subType: "d20", context: {type: "hit"}, toRoll: "1d20+PB"}).unsupported).toMatch(/dynamic/);
	});

	it("applies source-cited skill and initiative presets only to eligible rolls, asking for unknown context", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(16);
		const pConfirmContext = jest.fn(async () => true);
		const state = getState({selectedIds: ["one"],
			modifiers: [[
				getEncounterModifierForPreset("heavy-precipitation-xdmg"),
				getEncounterModifierForPreset("ioun-dark-blue-rhomboid"),
			], []]});
		try {
			const perception = await pRollEncounterSelection({
				state, rollType: "skill", key: "perception", skills, pConfirmContext,
			});
			expect(perception.results[0]).toMatchObject({mode: "normal", total: 16});
			expect(perception.results[0].sourcesText).toContain("XDMG p. 69 (2024)");
			expect(perception.results[0].sourcesText).toContain("MECIounStones p. 18");
			expect(dice).toHaveBeenCalledWith("1d20+1", expect.objectContaining({
				label: expect.stringContaining("advantage and disadvantage cancel"),
			}), {isResultUsed: true});
			expect(pConfirmContext).toHaveBeenCalledTimes(2);
			const initiative = await pRollEncounterSelection({state, rollType: "initiative", pConfirmContext});
			expect(initiative.results[0]).toMatchObject({mode: "advantage"});
			expect(dice).toHaveBeenLastCalledWith("2d20dl1+2", expect.anything(), {isResultUsed: true});
			expect(pConfirmContext).toHaveBeenCalledTimes(3);
			const dex = await pRollEncounterSelection({state, rollType: "ability", key: "dex", pConfirmContext});
			expect(dex.results[0].mode).toBe("normal");
			expect(pConfirmContext).toHaveBeenCalledTimes(3);
			expect(ENCOUNTER_ROLL_PRESETS.find(it => it.presetId === "ioun-dark-blue-rhomboid")).toMatchObject({
				source: "MECIounStones", page: 18,
			});
		} finally {
			dice.mockRestore();
		}
	});

	it("prompts for conditional attack context, keeps flat bonuses, and prioritizes condition auto-fail", async () => {
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(21);
		const pConfirmContext = jest.fn(async () => true);
		const instance = {
			id: "one",
			monster,
			conditions: ["poisoned"],
			modifiers: [
				getEncounterModifierForPreset("blizzard-idrotf"),
				{id: "strike", name: "Rally", scopes: ["attack"], mode: "advantage", bonus: 3},
			],
		};
		try {
			const attack = await pRollEncounterInstance({instance, name: "Goblin #1", rollType: "attack", key: "Attack roll", label: "Attack roll", baseBonus: 4, pConfirmContext});
			expect(attack).toMatchObject({bonus: 7, modifierBonus: 3, mode: "normal", total: 21});
			expect(attack.sourcesText).toContain("IDRotF p. 10 (2014)");
			expect(attack.sourcesText).toContain("Rally +3");
			expect(dice).toHaveBeenCalledWith("1d20+7", expect.objectContaining({
				name: "Goblin #1", label: expect.stringContaining("Blizzard"),
			}), {isResultUsed: true});
			expect(pConfirmContext).toHaveBeenCalledWith(expect.objectContaining({question: expect.stringContaining("ranged weapon")}));
			instance.conditions = ["stunned"];
			const failed = await pRollEncounterInstance({
				instance, name: "Goblin #1", rollType: "save", key: "dex", label: "Dexterity save", baseBonus: 4, pConfirmContext,
			});
			expect(failed).toMatchObject({mode: "autoFail", total: null});
			expect(dice).toHaveBeenCalledTimes(1);
			pConfirmContext.mockClear();
			const blockedAttack = await pRollEncounterInstance({
				instance, name: "Goblin #1", rollType: "attack", key: "Attack roll", label: "Attack roll", baseBonus: 4, pConfirmContext,
			});
			expect(blockedAttack).toMatchObject({mode: "unavailable", total: null});
			expect(pConfirmContext).not.toHaveBeenCalled();
			await expect(pRollEncounterInstance({
				instance,
				name: "Goblin #1",
				rollType: "attack",
				key: "Attack roll",
				label: "Attack roll",
				baseBonus: 4,
				pConfirmContext: async () => null,
			})).resolves.toMatchObject({mode: "unavailable"});
			instance.conditions = [];
			await expect(pRollEncounterInstance({
				instance,
				name: "Goblin #1",
				rollType: "attack",
				key: "Attack roll",
				label: "Attack roll",
				baseBonus: 4,
				pConfirmContext: async () => null,
			})).rejects.toThrow(/Context confirmation cancelled/);
			expect(dice).toHaveBeenCalledTimes(1);
		} finally {
			dice.mockRestore();
		}
	});
});
