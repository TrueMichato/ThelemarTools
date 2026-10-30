import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {addEventListener () {}, getElementById () { return null; }, querySelector () { return null; }, querySelectorAll () { return []; }};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};
globalThis.Renderer.dice ||= {parseRandomise2: () => 1};
await import("../../../js/charactersheet/charactersheet.js");
const State = globalThis.CharacterSheetState;
const Page = globalThis.CharacterSheetPage;
const Spells = globalThis.CharacterSheetSpells;

function harness () {
	expect(typeof Page.prototype.pGetConcentrationCheck).toBe("function");
	const state = new State();
	state.addClass({name: "Wizard", source: "XPHB", level: 5});
	state.setAbilityBase("con", 14);
	state.addCondition({name: "Frightened", source: "TGTT"});
	const spell = {name: "Command", source: "XPHB", level: 1, components: {v: true}, duration: [{type: "instant"}]};
	state.addSpell(spell, true);
	state.rollD20 = jest.fn(() => 6);
	state.addNamedModifier({id: "conditional-first", name: "First", type: "concentration", value: 0, bonusDie: "1d4", advantage: true, conditional: "When the DM permits first", enabled: true});
	state.addNamedModifier({id: "conditional-second", name: "Second", type: "concentration", value: 0, bonusDie: "1d4", disadvantage: true, conditional: "When the DM permits second", enabled: true});
	const page = Object.assign(Object.create(Page.prototype), {
		_state: state,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
		_renderQuickSpells: jest.fn(),
		pAnimateD20: jest.fn(async () => {}),
		_rollHistory: {addRoll: jest.fn()},
		_showDiceResult: jest.fn(),
	});
	const actual = jest.spyOn(page, "pGetConcentrationCheck");
	const picker = jest.spyOn(page, "_pPickConditionalModifiers");
	const spells = Object.assign(Object.create(Spells.prototype), {
		_state: state,
		_page: page,
		_allSpells: [spell],
		renderSlots: jest.fn(),
		_showCastResult: jest.fn(async () => ({cancelled: false})),
	});
	return {state, page, actual, picker, spells, cast: () => spells._castSpell(state.getSpells()[0].id, {withMetamagic: false, decision: {autoSlot: true, skipComponentPrompt: true}})};
}

afterEach(() => jest.restoreAllMocks());

it("canonical Cast uses the Page picker and recompute once, retaining equal dice from distinct sources", async () => {
	const {state, page, actual, picker, spells, cast} = harness();
	picker.mockImplementation(async ({conditionalsAvailable}) => ({cancelled: false, appliedConditionalIds: new Set(conditionalsAvailable.map(row => row.id))}));
	const dice = jest.spyOn(Renderer.dice, "parseRandomise2").mockReturnValue(3);
	const before = state.getSpellSlotsCurrent(1);
	await cast();
	expect(page._showDiceResult).toHaveBeenCalledWith(expect.stringContaining("Concentration"), 14, expect.stringMatching(/First.*Second/), "", expect.stringMatching(/Sources:.*First.*Second/));
	expect(actual).toHaveBeenCalledTimes(1);
	expect(picker).toHaveBeenCalledTimes(1);
	expect(dice).toHaveBeenCalledTimes(2);
	expect(state.rollD20).toHaveBeenCalledTimes(1);
	expect(page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({mode: "normal", roll: 6}));
	expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	expect(state.getSpellSlotsCurrent(1)).toBe(before - 1);
});

it("picker Cancel aborts canonical Cast without fallback, dice, history, effects or expenditure", async () => {
	const {state, page, actual, picker, spells, cast} = harness();
	picker.mockResolvedValue({cancelled: true, appliedConditionalIds: new Set()});
	const before = state.toJson();
	const dice = jest.spyOn(Renderer.dice, "parseRandomise2");
	await cast();
	expect(state.rollD20).not.toHaveBeenCalled();
	expect(actual).toHaveBeenCalledTimes(1);
	expect(picker).toHaveBeenCalledTimes(1);
	expect(dice).not.toHaveBeenCalled();
	expect(page._showDiceResult).not.toHaveBeenCalled();
	expect(page._rollHistory.addRoll).not.toHaveBeenCalled();
	expect(spells._showCastResult).not.toHaveBeenCalled();
	expect(state.toJson()).toEqual(before);
});
