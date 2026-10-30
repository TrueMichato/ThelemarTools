import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import {CharacterSheetSpellMaterials as Materials} from "../../../js/charactersheet/charactersheet-spell-materials.js";
import {CharacterSheetItemUtils} from "../../../js/charactersheet/charactersheet-item-utils.js";

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;
const data = JSON.parse(fs.readFileSync("data/spells/spells-xphb.json", "utf8")).spell;
globalThis.document ||= {addEventListener () {}, getElementById () { return null; }, querySelector () { return null; }, querySelectorAll () { return []; }};

function harness (name = "Continual Flame", level = null) {
	const spell = {...data.find(row => row.name === name), ...(level != null ? {level} : {})};
	const state = new State();
	state.setId("caster");
	state.addClass({name: "Wizard", source: "XPHB", level: 15, spellcastingAbility: "int"});
	state.addSpell({...spell, sourceClass: "Wizard", sourceClassSource: "XPHB"}, true);
	state.calculateSpellSlots();
	const page = {getState: () => state, saveCharacter: jest.fn(), renderCharacter: jest.fn(), _renderQuickSpells: jest.fn()};
	const spells = Object.assign(Object.create(Spells.prototype), {_state: state, _page: page, _allSpells: [spell], renderSlots: jest.fn(), _updateConcentrationUI: jest.fn(), _refreshSorceryPointUI: jest.fn()});
	const permission = jest.spyOn(spells, "_pConfirmMaterialPermission").mockResolvedValue(false);
	return {
		state,
		spell,
		page,
		spells,
		permission,
		cast: () => spells._castSpell(state.getSpells()[0].id, {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}}),
		add: (item, quantity = 1) => state.addItem({...CharacterSheetItemUtils.getNormalizedCatalogItem({item, state}), quantity}),
	};
}

afterEach(() => jest.restoreAllMocks());

describe("production cast material resolution", () => {
	it("cancels missing materials before costs/effects and offers an explicitly DM-labelled per-cast override", async () => {
		const {state, cast, permission, page} = harness();
		const before = state.toJson();
		await cast();
		expect(state.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(permission).toHaveBeenCalledWith(expect.objectContaining({
			title: "Continual Flame — Missing Materials",
			textYes: "Override for this cast (DM permission required)",
			textNo: "Cancel",
		}));
	});

	it("charges a real slot but creates no inventory/payment fiction, and asks again on the next cast", async () => {
		const {state, cast, permission, spell} = harness();
		permission.mockResolvedValueOnce(true);
		const before = state.getSpellSlotsCurrent(spell.level);
		await cast();
		expect(state.getSpellSlotsCurrent(spell.level)).toBe(before - 1);
		expect(state.getInventory()).toEqual([]);
		expect(state.getSettings().ignoreSpellcastingRestrictions).toBeFalsy();
		permission.mockClear();
		await cast();
		expect(permission).toHaveBeenCalledTimes(1);
		expect(state.getSpellSlotsCurrent(spell.level)).toBe(before - 1);
	});

	it("normalizes catalog supplies into real consumable inventory rows and leaves reusable supplies alone", async () => {
		for (const name of ["Continual Flame", "Identify"]) {
			const {state, spell, cast, add, permission} = harness(name);
			for (const item of Materials.buildCatalog([spell])) add(item, 2);
			const before = state.getInventory().map(row => ({id: row.id, quantity: row.quantity}));
			await cast();
			expect(permission).not.toHaveBeenCalled();
			for (const row of before) expect(state.getInventory().find(item => item.id === row.id)?.quantity).toBe(name === "Identify" ? 2 : 1);
		}
	});

	it("overrides only Clone's missing reusable vessel, still consuming owned diamond preparation", async () => {
		const {state, spell, cast, add, permission} = harness("Clone");
		const diamond = Materials.buildCatalog([spell]).find(item => item.value === 100000);
		add(diamond);
		permission.mockResolvedValue(true);
		await cast();
		expect(permission).toHaveBeenCalledTimes(1);
		expect(permission.mock.calls[0][0].htmlDescription).toContain("Sealable Clone Vessel");
		expect(state.getInventory()).toEqual([]);
		expect(state.getSpellSlotsCurrent(8)).toBe(0);
	});

	it("does not grant material permission around incapacitation or armor restrictions", async () => {
		const {state, cast, permission, spell} = harness();
		state.addCondition("Incapacitated");
		permission.mockResolvedValue(true);
		const before = state.getSpellSlotsCurrent(spell.level);
		await cast();
		expect(permission).not.toHaveBeenCalled();
		expect(state.getSpellSlotsCurrent(spell.level)).toBe(before);
	});

	it("cancels a multi-candidate consumable choice before spending a slot or deleting either item", async () => {
		const {state, cast, add, spell, spells} = harness();
		const item = Materials.buildCatalog([spell])[0];
		add(item);
		add({...item, name: "Inherited Powdered Ruby", source: "Custom"});
		jest.spyOn(spells, "_pPromptConsumeComponentChoice").mockResolvedValue(null);
		const before = state.toJson();
		await cast();
		expect(state.toJson()).toEqual(before);
	});

	it("validates all selected rows before mutating any component in a compound cast", async () => {
		const {state, spell, add, spells} = harness("Legend Lore");
		const items = Materials.buildCatalog([spell]);
		for (const item of items) add(item, 4);
		const context = spells._createMaterialContext();
		const prepared = await spells._pConsumeMaterialComponent({spell, spellData: spell, materialContext: context, isPrepareOnly: true, isRequired: true});
		const incense = state.getInventory().find(row => row.item.value === 25000);
		state.removeItem(incense.id);
		expect(() => prepared.commit()).toThrow("no longer available");
		expect(state.getInventory()).toMatchObject([{quantity: 4, item: {value: 5000}}]);
	});

	it("uses only the detached actor's supplies callback and never consumes player inventory", async () => {
		const {state, spell, spells, permission} = harness();
		const owner = new State();
		owner.addItem({name: "Powdered Ruby", value: 5000, source: "PHB"});
		const before = owner.toJson();
		spells._page.pConfirmSpellSupplies = jest.fn(async () => true);
		expect(await spells._pHandleCastingConstraints(spell, spell, null, {enforceMaterial: true})).toBe(true);
		expect(await spells._pConsumeMaterialComponent({spell, spellData: spell})).toMatchObject({supplied: true});
		expect(permission).not.toHaveBeenCalled();
		expect(state.getInventory()).toEqual([]);
		expect(owner.toJson()).toEqual(before);
	});

	it("refunds payment when a chosen material disappears during the actual result flow", async () => {
		const {state, spell, cast, add, spells, page} = harness();
		add(Materials.buildCatalog([spell])[0]);
		const slots = state.getSpellSlotsCurrent(spell.level);
		const show = spells._showCastResult.bind(spells);
		jest.spyOn(spells, "_showCastResult").mockImplementation(async (...args) => {
			const result = await show(...args);
			state.removeItem(state.getInventory()[0].id);
			return result;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getSpellSlotsCurrent(spell.level)).toBe(slots);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it.each(["state", "data"])("refunds only the captured actor when the %s binding changes during results", async binding => {
		const {state, spell, cast, add, spells, page} = harness();
		add(Materials.buildCatalog([spell])[0]);
		const ownerData = state._data;
		const slots = state.getSpellSlotsCurrent(spell.level);
		const other = new State();
		other.setId("other");
		const before = other.toJson();
		jest.spyOn(spells, "_showCastResult").mockImplementation(async () => {
			if (binding === "state") spells._state = other;
			else state._data = other._data;
			return {cancelled: false};
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(ownerData.spellcasting.spellSlots[spell.level].current).toBe(slots);
		expect(ownerData.inventory).toHaveLength(1);
		expect(other.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it.each(["state", "data"])("refunds cantrip metamagic only to the paid %s binding", async binding => {
		const {state, spell, cast, add, spells, page} = harness("Continual Flame", 0);
		state.setSorceryPoints({current: 3, max: 3});
		add(Materials.buildCatalog([spell])[0]);
		const ownerData = state._data;
		const other = new State();
		const before = other.toJson();
		jest.spyOn(spells, "_resolveMetamagicChoice").mockResolvedValue({metamagic: {id: "subtle", cost: 1}});
		jest.spyOn(spells, "_showCastResult").mockImplementation(async () => {
			if (binding === "state") spells._state = other;
			else state._data = other._data;
			return {cancelled: false};
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(ownerData.resources.find(row => row.name === "Sorcery Points").current).toBe(3);
		expect(ownerData.inventory).toHaveLength(1);
		expect(other.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it.each([
		["pCastItemSpell", "_pCastItemSpell"],
		["pCastFeatureSpellGrant", "_pCastFeatureSpellGrant"],
		["_castSpellAsRitual", "_pCastSpellAsRitual"],
		["_castInnateSpell", "_pCastInnateSpell"],
	])("surfaces stale material context explicitly at the %s entry point", async (entry, operation) => {
		const {spells, state} = harness();
		const context = spells._createMaterialContext();
		jest.spyOn(spells, operation).mockImplementation(async () => {
			spells._state = new State();
			spells._assertMaterialContext(context);
		});
		const toast = jest.spyOn(JqueryUtil, "doToast");
		await spells[entry]("test");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "warning", content: expect.stringContaining("character changed")}));
		expect(state.getInventory()).toEqual([]);
	});
});
