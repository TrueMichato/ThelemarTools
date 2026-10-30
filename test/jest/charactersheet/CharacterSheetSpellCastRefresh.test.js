import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";
import {CharacterSheetSpellMaterials as Materials} from "../../../js/charactersheet/charactersheet-spell-materials.js";
import {CharacterSheetItemUtils} from "../../../js/charactersheet/charactersheet-item-utils.js";

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;
const shield = JSON.parse(fs.readFileSync("data/spells/spells-xphb.json", "utf8")).spell.find(row => row.name === "Shield");
const spellData = JSON.parse(fs.readFileSync("data/spells/spells-xphb.json", "utf8")).spell;

globalThis.document ||= {addEventListener () {}, getElementById () { return null; }, querySelector () { return null; }, querySelectorAll () { return []; }};

function playCaster (name = "Shield", classData = {name: "Wizard", source: "XPHB", level: 3, spellcastingAbility: "int"}) {
	const state = new State();
	state.setId("play-caster");
	state.addClass(classData);
	const spell = spellData.find(row => row.name === name);
	state.addSpell({...spell, ritual: !!spell.meta?.ritual, inSpellbook: true, sourceClass: classData.name, sourceClassSource: classData.source}, true);
	state.calculateSpellSlots();
	const page = {getState: () => state, saveCharacter: jest.fn(), renderCharacter: jest.fn(), _renderQuickSpells: jest.fn()};
	page._spells = Object.assign(Object.create(Spells.prototype), {_state: state, _page: page, _allSpells: [spell], renderSlots: jest.fn(), _updateConcentrationUI: jest.fn()});
	const play = new CharacterSheetPlayMode(page);
	return {state, spell, page, play, cast: slot => play._executeCast(state.getSpells()[0], slot)};
}

afterEach(() => jest.restoreAllMocks());

describe("successful spell cast refresh", () => {
	it("updates the visible projection on normal Shield Cast, without requiring a feature trigger", async () => {
		const state = new State();
		state.setId("caster");
		state.addClass({name: "Wizard", source: "XPHB", level: 3, spellcastingAbility: "int"});
		state.addSpell({...shield, sourceClass: "Wizard", sourceClassSource: "XPHB"}, true);
		state.calculateSpellSlots();
		const before = state.getAc();
		let visibleAc = before;
		const page = {
			getState: () => state,
			saveCharacter: jest.fn(),
			renderCharacter: jest.fn(() => { visibleAc = state.getAc(); }),
			_renderQuickSpells: jest.fn(),
		};
		const spells = Object.assign(Object.create(Spells.prototype), {
			_state: state, _page: page, _allSpells: [shield], renderSlots: jest.fn(),
		});
		await spells._castSpell(state.getSpells()[0].id, {withMetamagic: false, decision: {autoSlot: true, skipComponentPrompt: true}});
		expect(state.getAc()).toBe(before + 5);
		expect(visibleAc).toBe(before + 5);
		expect(state.getAcBreakdown().total).toBe(visibleAc);
		expect(state.getSpellSlotsCurrent(1)).toBe(3);
		state.startCombat();
		state.advanceRound();
		page.renderCharacter();
		expect(state.getAc()).toBe(before);
		expect(visibleAc).toBe(before);
	});

	it("refreshes only the detached adapter, without needing a player render API", async () => {
		const state = new State();
		state.addClass({name: "Wizard", source: "XPHB", level: 3});
		state.addSpell(shield, true);
		state.calculateSpellSlots();
		const render = jest.fn();
		const page = {saveCharacter: jest.fn(), _renderCharacter: render, _renderQuickSpells: jest.fn()};
		const spells = Object.assign(Object.create(Spells.prototype), {_state: state, _page: page, _allSpells: [shield], renderSlots: jest.fn()});
		const before = state.getAc();
		await spells._castSpell(state.getSpells()[0].id, {withMetamagic: false, decision: {autoSlot: true, skipComponentPrompt: true}});
		expect(state.getAc()).toBe(before + 5);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])("applies real Play Mode Shield with the selected ordinary/pact vehicle (pact=%s), charged once", async isPact => {
		const {state, cast, page} = playCaster();
		state.setPactSlots({current: 2, max: 2, level: 2});
		const ac = state.getAc();
		const ordinary = state.getSpellSlotsCurrent(2);
		await cast({level: 2, current: 2, max: 2, isPact});
		expect(state.getAc()).toBe(ac + 5);
		expect(state.getAcBreakdown().total).toBe(ac + 5);
		expect(state.getPactSlots().current).toBe(isPact ? 1 : 2);
		expect(state.getSpellSlotsCurrent(2)).toBe(ordinary - (isPact ? 0 : 1));
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(page.saveCharacter).toHaveBeenCalled();
	});

	it("keeps Play Mode material permission default-off, invocation-scoped, and normally charged", async () => {
		const {state, cast, page} = playCaster("Continual Flame");
		const permission = jest.spyOn(page._spells, "_pConfirmMaterialPermission").mockResolvedValue(false);
		const before = state.toJson();
		await cast({level: 2});
		expect(state.toJson()).toEqual(before);
		permission.mockResolvedValueOnce(true);
		await cast({level: 2});
		expect(state.getSpellSlotsCurrent(2)).toBe(1);
		expect(state.getInventory()).toEqual([]);
		await cast({level: 2});
		expect(state.getSpellSlotsCurrent(2)).toBe(1);
		expect(permission).toHaveBeenCalledTimes(3);
	});

	it("preserves Play Mode ritual choice without spending a slot or reusable supply", async () => {
		const {state, spell, play} = playCaster("Identify", {name: "Wizard", source: "PHB", level: 3, spellcastingAbility: "int"});
		for (const item of Materials.buildCatalog([spell])) state.addItem(CharacterSheetItemUtils.getNormalizedCatalogItem({item, state}));
		const before = state.getSpellSlotsCurrent(1);
		jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		await play._castSpell(state.getSpells()[0]);
		expect(InputUiUtil.pGetUserBoolean).toHaveBeenCalledWith(expect.objectContaining({title: "Cast as Ritual?"}));
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(state.getInventory()).toHaveLength(1);
	});

	it("offers no-slot resources through the canonical chooser, including a no-spend Cancel", async () => {
		const {state, play, page} = playCaster("Guiding Bolt", {
			name: "Druid",
			source: "PHB",
			level: 3,
			spellcastingAbility: "wis",
			subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
		});
		if (!state.getResource("Star Map")) state.addResource({name: "Star Map", current: 2, max: 2});
		const learned = state.getSpells()[0];
		expect(state.getNoSlotCastResourcesForSpell(learned)).toHaveLength(1);
		jest.spyOn(page._spells, "_showCastResult").mockResolvedValue({cancelled: false});
		const chooser = jest.spyOn(InputUiUtil, "pGetUserEnum").mockResolvedValueOnce(null);
		const before = state.toJson();
		await play._castSpell(learned);
		expect(state.toJson()).toEqual(before);
		chooser.mockImplementationOnce(async ({values}) => values.find(value => value.startsWith("Star Map")));
		await play._castSpell(learned);
		expect(state.getResource("Star Map").current).toBe(1);
		expect(state.getSpellSlotsCurrent(1)).toBe(4);
	});
});
