import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetSimulacrum} from "../../../js/charactersheet/charactersheet-simulacrum.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {addEventListener () {}, getElementById () { return null; }, querySelector () { return null; }, querySelectorAll () { return []; }};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};
await import("../../../js/charactersheet/charactersheet.js");

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;
const Page = globalThis.CharacterSheetPage;
const copy = value => JSON.parse(JSON.stringify(value));
const spellData = source => JSON.parse(fs.readFileSync(`data/spells/spells-${source.toLowerCase()}.json`, "utf8")).spell.find(row => row.name === "Simulacrum");
const deferred = () => {
	let resolve;
	const promise = new Promise(fn => { resolve = fn; });
	return {promise, resolve};
};

function makeHarness (source = "PHB") {
	const state = new State();
	state.setId("creator");
	state.setName("Original");
	state.addClass({name: "Wizard", source, level: 13, spellcastingAbility: "int"});
	state.setSpellcastingAbility("int");
	state.setAbilityBase("int", 18);
	state.recalculateHp({syncCurrent: true});
	state.addSpell({...spellData(source), sourceClass: "Wizard", sourceClassSource: source}, true);
	state.setCurrency("gp", 5000);
	state.addItem({id: "ruby", name: "Powdered Ruby", source: "PHB", value: 150000}, 2);
	const page = Object.create(Page.prototype);
	Object.assign(page, {
		_state: state,
		_currentCharacterId: "creator",
		_characterLoadGeneration: 1,
		_saveCurrentCharacter: jest.fn(async () => true),
		saveCharacter: jest.fn(async () => true),
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_renderActiveStates: jest.fn(),
		_updateAllCalculations: jest.fn(),
		_renderCompanions: jest.fn(),
		_updateSaveIndicator: jest.fn(),
		_updateCharacterDropdown: jest.fn(),
		_setCharacterUrl: jest.fn(),
	});
	const spells = Object.create(Spells.prototype);
	Object.assign(spells, {
		_state: state,
		_page: page,
		_allSpells: [spellData(source)],
		renderSlots: jest.fn(),
		_refreshSorceryPointUI: jest.fn(),
	});
	page._spells = spells;
	const id = state.getSpells().find(row => row.name === "Simulacrum").id;
	return {state, page, spells, id, cast: options => spells._castSpell(id, {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}, ...options})};
}

function addCopy (state, source = "PHB") {
	const result = state.prepareSimulacrumSnapshot({spellSource: source});
	expect(result.ok).toBe(true);
	return state.addCompanion(result.companionData);
}

function prepare (page, source) {
	const state = page.getState();
	const result = state.prepareSimulacrumSnapshot({spellSource: source});
	if (!result.ok) throw new Error(result.message);
	return {
		companionData: result.companionData,
		context: {state, data: state._data, generation: page._characterLoadGeneration, characterId: page._currentCharacterId},
		replacedActorIds: state.getCompanions().filter(row => row.actorSnapshot?.kind === "simulacrum"
			&& row.actorSnapshot.creatorActorId === state._data.id && row.actorSnapshot.lifecycle === "active").map(row => row.actorSnapshot.actorId),
	};
}

let preview;
beforeEach(() => {
	preview = jest.spyOn(CharacterSheetSimulacrum, "pPrepareCreation").mockImplementation(async ({ownerPage, spellSource}) => prepare(ownerPage, spellSource));
	jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("Shared Simulacrum creation transaction", () => {
	it.each(["PHB", "XPHB"])("creates a saved item-free, full-pool %s actor from the real spell, State and exporter", async source => {
		const {state, page, cast} = makeHarness(source);
		state.setConcentration({name: "Haste", source: "PHB", level: 3});
		const concentration = copy(state.getConcentration());
		const globalState = globalThis.__csState;
		const result = await cast();
		expect(result).toMatchObject({ok: true, committed: true, spellUid: `Simulacrum|${source}`, slotLevel: 7});
		expect(result.postCastFailed).toBeUndefined();
		expect(preview).toHaveBeenCalledWith({ownerPage: page, spellSource: source});
		expect(state.getSpellSlotsCurrent(7)).toBe(0);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(1);
		expect(state.getTotalGold()).toBe(5000);
		const companion = state.getCompanion(result.companionId);
		expect(companion.actorSnapshot).toMatchObject({spell: {source}, lifecycle: "active", creatorActorId: "creator"});
		expect(companion.statblock.type).toEqual({type: "construct"});
		const actor = state.hydrateCompanionActor(result.companionId).actor;
		expect(actor.getInventory()).toEqual([]);
		expect(actor.getSpellSlotsCurrent(7)).toBe(1);
		expect(actor.getMaxHp()).toBe(Math.floor(state.getMaxHp() / 2));
		expect(state.getConcentration()).toEqual(concentration);
		expect(globalThis.__csState).toBe(globalState);
		expect(page._saveCurrentCharacter).toHaveBeenCalledWith({isReturnStatus: true, expectedCharacterId: "creator", expectedLoadGeneration: 1});
		expect(page.saveCharacter).not.toHaveBeenCalled();
		const reopened = new State();
		reopened.loadFromJson(state.toJson());
		expect(reopened.getCompanion(result.companionId).actorSnapshot).toEqual(companion.actorSnapshot);
	});

	it("preview cancellation leaves previous copies, slots, ruby and currency intact", async () => {
		const {state, page, cast} = makeHarness();
		addCopy(state);
		const before = copy(state._data);
		preview.mockResolvedValue(null);
		await cast();
		expect(state._data).toEqual(before);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("replaces only the same creator and cleans exact owned effects/summons, preserving unrelated concentration", async () => {
		const {state, cast} = makeHarness();
		const oldId = addCopy(state);
		const oldActorId = state.getCompanion(oldId).actorSnapshot.actorId;
		const otherId = addCopy(state);
		state.getCompanion(otherId).actorSnapshot.creatorActorId = "another-creator";
		state.setConcentration({name: "Haste", source: "PHB", level: 3});
		const owned = state.addActiveState("custom", {name: "Copy's Bless", sourceFeatureId: "copy-bless", effectOwnerId: oldActorId, concentration: true, customEffects: []});
		const unrelated = state.addActiveState("custom", {name: "Unrelated Gift", sourceFeatureId: "unrelated-gift", effectOwnerId: "another-actor", customEffects: []});
		const summon = state.addCompanion({name: "Copy's summon", creatorActorId: oldActorId});
		state.getCompanion(summon).creatorActorId = oldActorId;
		const result = await cast();
		expect(result.committed).toBe(true);
		expect(state.getCompanion(oldId).actorSnapshot.lifecycle).toBe("destroyed");
		expect(state.getCompanion(oldId).destructionReason).toBe("replaced");
		expect(state.getCompanion(otherId).actorSnapshot.lifecycle).toBe("active");
		expect(state.getCompanion(summon)).toBeFalsy();
		expect(state.getActiveStates().some(row => row.id === owned)).toBe(false);
		expect(state.getActiveStates().some(row => row.id === unrelated)).toBe(true);
		expect(state.getConcentration().spellName).toBe("Haste");
	});

	it("late result cancellation spends nothing and preserves concurrent notes/currency/resources", async () => {
		const {state, spells, cast} = makeHarness();
		const old = addCopy(state);
		state.setSorceryPoints({current: 4, max: 4});
		state.addResource({id: "unrelated-pool", name: "Unrelated", current: 3, max: 3});
		spells._resolveMetamagicChoice = jest.fn(async () => ({metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}}));
		spells._showCastResult = jest.fn(async () => {
			expect(state.getSpellSlotsCurrent(7)).toBe(1);
			expect(state.getSorceryPoints().current).toBe(4);
			state.setNote("backstory", "Concurrent note");
			state.setCurrency("gp", 4990);
			state.setResourceCurrent("unrelated-pool", 2);
			return {cancelled: true};
		});
		await cast();
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getSorceryPoints().current).toBe(4);
		expect(state.getCompanion(old).actorSnapshot.lifecycle).toBe("active");
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
		expect(state.getNote("backstory")).toBe("Concurrent note");
		expect(state.getTotalGold()).toBe(4990);
		expect(state.getResources().find(row => row.id === "unrelated-pool").current).toBe(2);
	});

	it("cancelling the late material choice spends nothing and never replaces or publishes", async () => {
		const {state, page, spells, cast} = makeHarness();
		const old = addCopy(state);
		state.addItem({id: "ruby2", name: "Ruby Dust", source: "PHB", value: 150000});
		const material = jest.spyOn(spells, "_pPromptConsumeComponentChoice").mockResolvedValue(null);
		const published = jest.spyOn(spells, "_pPublishCommittedSpellCast");
		await cast();
		expect(material).toHaveBeenCalledTimes(1);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getCompanion(old).actorSnapshot.lifecycle).toBe("active");
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(published).not.toHaveBeenCalled();
	});

	it.each(["Gold Crown", "Snow", "Hair", "Powdered Sapphire"])("rejects valuable %s as the named ruby component", async name => {
		const {state, page, cast} = makeHarness();
		state.removeItem("ruby");
		state.addItem({id: "wrong-component", name, source: "PHB", value: 200000});
		await cast();
		expect(state.getCompanions()).toHaveLength(0);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("manual bookkeeping opt-out does not demand ruby or charge a second 1500 gp", async () => {
		const {state, cast} = makeHarness();
		state.removeItem("ruby");
		state._data.settings.ignoreSpellcastingRestrictions = true;
		expect(await cast()).toMatchObject({ok: true, committed: true});
		expect(state.getTotalGold()).toBe(5000);
		expect(state.getInventory()).toHaveLength(0);
	});

	it("uses the chosen upcast slot, not the available base-level slot", async () => {
		const {state, cast} = makeHarness();
		state.setSpellSlots(8, 1, 1);
		expect(await cast({decision: {slotLevel: 8, skipComponentPrompt: true}})).toMatchObject({committed: true, slotLevel: 8});
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getSpellSlotsCurrent(8)).toBe(0);
	});

	it("spends selected metamagic once and does not invent an action cost for a 12-hour spell", async () => {
		const {state, spells, cast} = makeHarness();
		state.setSorceryPoints({current: 4, max: 4});
		state._data.inCombat = true;
		const economy = copy(state._data.actionEconomyUsage);
		spells._resolveMetamagicChoice = jest.fn(async () => ({metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}}));
		expect(await cast()).toMatchObject({committed: true});
		expect(state.getSorceryPoints().current).toBe(3);
		expect(state._data.actionEconomyUsage).toEqual(economy);
		expect(state.getSpellSlotsCurrent(7)).toBe(0);
	});

	it("refuses failed metamagic payment without spending slot/material or replacing an old copy", async () => {
		const {state, spells, cast} = makeHarness();
		const old = addCopy(state);
		state.setSorceryPoints({current: 0, max: 4});
		spells._resolveMetamagicChoice = jest.fn(async () => ({metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}}));
		await cast();
		expect(state.getCompanion(old).actorSnapshot.lifecycle).toBe("active");
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
		expect(state.getSorceryPoints().current).toBe(0);
	});

	it("does not bypass missing catalog data or an explicitly underpriced ruby", async () => {
		const {state, page, spells, cast} = makeHarness();
		state._data.inventory.find(row => row.id === "ruby").item.value = 149999;
		await cast();
		expect(state.getCompanions()).toHaveLength(0);
		state._data.inventory.find(row => row.id === "ruby").item.value = 150000;
		spells._allSpells = [];
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("rechecks the selected component after its asynchronous picker and preserves concurrent inventory changes", async () => {
		const {state, spells, cast} = makeHarness();
		state.addItem({id: "ruby2", name: "Ruby Dust", source: "PHB", value: 150000});
		jest.spyOn(spells, "_pPromptConsumeComponentChoice").mockImplementation(async ({candidates}) => {
			const chosen = candidates.find(row => row.id === "ruby2");
			state.removeItem("ruby2");
			state.setNote("backstory", "Component was traded away");
			return chosen;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanions()).toHaveLength(0);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby")).toMatchObject({quantity: 2});
		expect(state.getNote("backstory")).toBe("Component was traded away");
	});

	it("guards an owner switch from the late material picker before spending any component or slot", async () => {
		const {state, page, spells, cast} = makeHarness();
		state.addItem({id: "ruby2", name: "Ruby Dust", source: "PHB", value: 150000});
		jest.spyOn(spells, "_pPromptConsumeComponentChoice").mockImplementation(async ({candidates}) => {
			page._characterLoadGeneration++;
			return candidates[0];
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory()).toHaveLength(2);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("uses and consumes a genuinely selected variant component instead of charging ruby too", async () => {
		const {state, spells, cast} = makeHarness();
		state.removeItem("ruby");
		state.addItem({id: "variant", name: "Special snow", source: "Ar8", variantComponent: {spellEffects: [{match: {spell: "simulacrum|phb"}, effects: [{type: "noSlot"}]}]}}, 2);
		spells._resolveVariantComponentChoice = jest.fn(async () => ({variantComponent: {itemId: "variant", effects: [{type: "noSlot"}]}}));
		expect(await cast()).toMatchObject({committed: true});
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "variant").quantity).toBe(1);
		expect(state.getTotalGold()).toBe(5000);
	});

	it("does not waive ruby just because an unselected variant is in the inventory", async () => {
		const {state, cast} = makeHarness();
		state.removeItem("ruby");
		state.addItem({id: "variant", name: "Special snow", source: "Ar8", variantComponent: {spellEffects: [{match: {spell: "simulacrum|phb"}, effects: [{type: "noSlot"}]}]}});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanions()).toHaveLength(0);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory()).toHaveLength(1);
	});

	it("rejects duplicate simultaneous casts while the first preview is open", async () => {
		const {state, page, cast} = makeHarness();
		const pending = deferred();
		preview.mockImplementationOnce(async ({ownerPage, spellSource}) => {
			const prepared = prepare(ownerPage, spellSource);
			await pending.promise;
			return prepared;
		});
		const first = cast();
		expect(await cast()).toMatchObject({ok: false, committed: false});
		pending.resolve();
		expect(await first).toMatchObject({ok: true, committed: true});
		expect(state.getCompanions()).toHaveLength(1);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
	});

	it.each(["state", "data", "generation", "selection"])("guards stale %s after preview without charging either character", async kind => {
		const {state, page, cast} = makeHarness();
		const originalData = state._data;
		preview.mockImplementationOnce(async ({ownerPage, spellSource}) => {
			const prepared = prepare(ownerPage, spellSource);
			if (kind === "state") page._state = new State();
			if (kind === "data") state.loadFromJson({...copy(originalData), name: "Newly loaded"});
			if (kind === "generation") page._characterLoadGeneration++;
			if (kind === "selection") page._currentCharacterId = "someone-else";
			return prepared;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(originalData.spellcasting.spellSlots[7].current).toBe(1);
		expect(originalData.inventory.find(row => row.id === "ruby").quantity).toBe(2);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("does not pay on a new load of the same State object after the result prompt", async () => {
		const {state, page, spells, cast} = makeHarness();
		const original = state._data;
		spells._showCastResult = jest.fn(async () => {
			state.loadFromJson({...copy(original), id: "new-owner", name: "New owner"});
			state.setSpellSlots(7, 3, 2);
			page._currentCharacterId = "new-owner";
			page._characterLoadGeneration++;
			return {cancelled: false};
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(original.spellcasting.spellSlots[7].current).toBe(1);
		expect(state.getSpellSlotsCurrent(7)).toBe(2);
		expect(state.getCompanions()).toHaveLength(0);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("fails on projection during replacement and restores the old actor, ruby and chosen slot", async () => {
		const {state, spells, cast} = makeHarness();
		const oldId = addCopy(state);
		const old = copy(state.getCompanion(oldId));
		spells._showCastResult = jest.fn(async () => {
			jest.spyOn(CharacterSheetNpcExporter, "convertStateToMonster").mockImplementation(() => { throw new Error("Projection failed"); });
			return {cancelled: false};
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanions()).toEqual([old]);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
	});

	it("save failure restores exact replacement-owned writes while preserving concurrent currency, notes and same-pool spending", async () => {
		const {state, page, spells, cast} = makeHarness();
		const oldId = addCopy(state);
		const old = copy(state.getCompanion(oldId));
		state.setSorceryPoints({current: 4, max: 4});
		spells._resolveMetamagicChoice = jest.fn(async () => ({metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}}));
		page._pRestoreFailedSimulacrumCreation = jest.fn(async () => {});
		page._saveCurrentCharacter.mockImplementation(async () => {
			state.setNote("backstory", "Keep this newer note");
			state.setCurrency("gp", 4800);
			state.useSorceryPoint(1);
			state.setItemQuantity("ruby", 4);
			state.addCompanion({name: "Concurrent Familiar"});
			return false;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanion(oldId)).toEqual(old);
		expect(state.getCompanions().map(row => row.name)).toEqual([old.name, "Concurrent Familiar"]);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(5);
		expect(state.getSorceryPoints().current).toBe(3);
		expect(state.getTotalGold()).toBe(4800);
		expect(state.getNote("backstory")).toBe("Keep this newer note");
	});

	it("restores destroyed copies and exact owned effects after failed persistence", async () => {
		const {state, page, cast} = makeHarness();
		const oldId = addCopy(state);
		const actorId = state.getCompanion(oldId).actorSnapshot.actorId;
		const owned = state.addActiveState("custom", {name: "Copy's Bless", sourceFeatureId: "copy-bless", effectOwnerId: actorId, customEffects: [{type: "save:all", value: 1}]});
		const summon = state.addCompanion({name: "Copy's summon"});
		state.getCompanion(summon).creatorActorId = actorId;
		const before = copy(state._data);
		page._pRestoreFailedSimulacrumCreation = jest.fn(async () => {});
		page._saveCurrentCharacter.mockResolvedValue(false);
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanion(oldId)).toEqual(before.companions.find(row => row.id === oldId));
		expect(state.getCompanion(summon)).toEqual(before.companions.find(row => row.id === summon));
		expect(state.getActiveStates().find(row => row.id === owned)).toEqual(before.activeStates.find(row => row.id === owned));
	});

	it("restores the last ruby inventory row on failure and does not overfill a concurrently recovered metamagic pool", async () => {
		const {state, page, spells, cast} = makeHarness();
		state.setItemQuantity("ruby", 1);
		state.setSorceryPoints({current: 4, max: 4});
		spells._resolveMetamagicChoice = jest.fn(async () => ({metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}}));
		page._pRestoreFailedSimulacrumCreation = jest.fn(async () => {});
		page._saveCurrentCharacter.mockImplementation(async () => {
			expect(state.getInventory()).toHaveLength(0);
			state.setSorceryPoints({current: 4, max: 4});
			return false;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getInventory()).toHaveLength(1);
		expect(state.getInventory()[0]).toMatchObject({id: "ruby", quantity: 1, item: {name: "Powdered Ruby", value: 150000}});
		expect(state.getSorceryPoints()).toMatchObject({current: 4, max: 4});
	});

	it("surfaces compensation failures without an unhandled rejection or retaining the creation lock", async () => {
		const {state, page, cast} = makeHarness();
		page._saveCurrentCharacter.mockResolvedValue(false);
		page._pRestoreFailedSimulacrumCreation = jest.fn(async () => { throw new Error("Canonical recovery failed"); });
		expect(await cast()).toMatchObject({ok: false, committed: false, rollbackFailed: true});
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getCompanions()).toHaveLength(0);
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringMatching(/rollback needs attention.*Export a backup/)}));
		page._saveCurrentCharacter.mockResolvedValue(true);
		expect(await cast()).toMatchObject({ok: true, committed: true});
	});

	it.each([false, {ok: false}, undefined])("requires an affirmative guarded save status (%j)", async status => {
		const {state, page, cast} = makeHarness();
		page._saveCurrentCharacter.mockResolvedValue(status);
		page._pRestoreFailedSimulacrumCreation = jest.fn(async () => {});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanions()).toHaveLength(0);
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
	});

	it("rejects a replacement set changed after preview instead of silently destroying an unpreviewed copy", async () => {
		const {state, spells, cast} = makeHarness();
		spells._showCastResult = jest.fn(async () => {
			addCopy(state);
			return {cancelled: false};
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getCompanions()).toHaveLength(1);
		expect(state.getCompanions()[0].actorSnapshot.lifecycle).toBe("active");
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(2);
	});

	it("does not publish or refresh creation until guarded persistence settles", async () => {
		const {page, spells, cast} = makeHarness();
		const entered = deferred();
		const finish = deferred();
		page._saveCurrentCharacter.mockImplementation(async () => { entered.resolve(); return finish.promise; });
		const publish = jest.spyOn(spells, "_pPublishCommittedSpellCast");
		const pending = cast();
		await entered.promise;
		expect(publish).not.toHaveBeenCalled();
		expect(page._renderCompanions).not.toHaveBeenCalled();
		finish.resolve(true);
		expect(await pending).toMatchObject({ok: true, committed: true});
		expect(publish).toHaveBeenCalledTimes(1);
		expect(page._renderCompanions).toHaveBeenCalledTimes(1);
	});

	it("reports a post-persistence publication error as committed rather than refunding a saved duplicate", async () => {
		const {state, spells, cast} = makeHarness();
		jest.spyOn(spells, "_pPublishCommittedSpellCast").mockRejectedValue(new Error("Subscriber failed"));
		const result = await cast();
		expect(result).toMatchObject({ok: true, committed: true, postCastFailed: true});
		expect(state.getCompanion(result.companionId).actorSnapshot.lifecycle).toBe("active");
		expect(state.getSpellSlotsCurrent(7)).toBe(0);
		expect(state.getInventory().find(row => row.id === "ruby").quantity).toBe(1);
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringMatching(/was saved.*post-cast update failed/)}));
	});

	it("explicitly refuses Gambler delayed/failed creation before spending or rolling a receipt", async () => {
		const {state, spells, cast} = makeHarness();
		state.isTgttGamblerSpell = () => true;
		const realCalculations = state.getFeatureCalculations.bind(state);
		state.getFeatureCalculations = () => ({...realCalculations(), hasGamblerSpellcasting: true});
		const create = jest.spyOn(state, "createGamblerCastResolution");
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(create).not.toHaveBeenCalled();
		expect(state.getSpellSlotsCurrent(7)).toBe(1);
		expect(spells._state.getCompanions()).toHaveLength(0);
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringMatching(/Gambler.*not automated/)}));
	});

	it.each(["PHB", "XPHB"])("blocks a hydrated %s Construct's self-copy without entering the player preview", async source => {
		const {state, spells, cast} = makeHarness(source);
		spells._state = state.hydrateCompanionActor(addCopy(state, source)).actor;
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(preview).not.toHaveBeenCalled();
	});

	it("Play Mode delegates only Simulacrum to the same creation/cost engine", async () => {
		const {state, page} = makeHarness();
		const play = Object.create(CharacterSheetPlayMode.prototype);
		play._page = page;
		play._state = state;
		const route = jest.spyOn(page._spells, "_castSpell");
		const result = await play._castSpell(state.getSpells()[0]);
		expect(result).toMatchObject({ok: true, committed: true});
		expect(route).toHaveBeenCalledTimes(1);
		expect(state.getSpellSlotsCurrent(7)).toBe(0);
	});
});

describe("Real Page persistence and Simulacrum compensation", () => {
	let roster;
	let sync;
	const installStorage = () => {
		roster = [];
		sync = new Map();
		for (const [key, fn] of Object.entries({
			pGet: async key => key === "charsheet-characters" ? copy(roster) : null,
			pSet: async (key, value) => { if (key === "charsheet-characters") roster = copy(value); },
			syncGet: key => sync.has(key) ? copy(sync.get(key)) : null,
			syncSet: (key, value) => sync.set(key, copy(value)),
			syncRemove: key => sync.delete(key),
		})) {
			if (StorageUtil[key]) jest.spyOn(StorageUtil, key).mockImplementation(fn);
			else StorageUtil[key] = jest.fn(fn);
		}
	};
	const beginRepair = () => {
		const harness = makeHarness();
		const {state, page} = harness;
		const id = addCopy(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setHp(hydrated.actor.getHp().current - 3);
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		roster.push(state.toJson());
		const context = CharacterSheetSimulacrum._captureOwner(page);
		const before = CharacterSheetSimulacrum._captureRepairFields(state, id);
		const receipt = state.repairSimulacrum(id, {amount: 3, laboratoryConfirmed: true});
		expect(receipt).toMatchObject({ok: true, actualHp: 3, costGp: 300});
		const after = CharacterSheetSimulacrum._captureRepairFields(state, id);
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		return {...harness, id, context, before, after, receipt};
	};

	it("keeps terminal Simulacrum records visible for statblock inspection and dismissal", () => {
		const {state, page} = makeHarness();
		const id = addCopy(state);
		expect(state.destroySimulacrum(id).ok).toBe(true);
		const unrelatedId = state.addCompanion({name: "Hidden ordinary companion", active: false});
		const visible = page.getFeatureCompanionLifecycleSurfaceCompanions();
		expect(visible.map(row => row.id)).toContain(id);
		expect(visible.map(row => row.id)).not.toContain(unrelatedId);
	});

	it("compensates a paid repair written before switching owners without touching the new owner", async () => {
		installStorage();
		const {page, id, context, before, after, receipt} = beginRepair();
		const normalWrite = StorageUtil.pSet.getMockImplementation();
		const other = new State();
		other.setId("other");
		other.setCurrency("gp", 55);
		jest.spyOn(StorageUtil, "pSet").mockImplementationOnce(async (...args) => {
			await normalWrite(...args);
			page._state = other;
			page._currentCharacterId = "other";
			page._characterLoadGeneration++;
		});
		await expect(CharacterSheetSimulacrum._pSave(page, context)).rejects.toThrow("could not be saved");
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt);
		expect(roster[0].companions.find(row => row.id === id)).toEqual(before.companion);
		expect(roster[0].currency).toEqual(before.currency);
		expect(page._readActiveCharacterMirror("creator")).toBeNull();
		expect(other.getTotalGold()).toBe(55);
		expect(other.getCompanions()).toEqual([]);
	});

	it("does not refund an unapplied canonical repair just because the existing companion ID is present", async () => {
		installStorage();
		const {page, id, context, before, after, receipt} = beginRepair();
		jest.spyOn(StorageUtil, "pSet").mockRejectedValue(new Error("Disk unavailable"));
		await expect(CharacterSheetSimulacrum._pSave(page, context)).rejects.toThrow("could not be saved");
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt);
		expect(roster[0].companions.find(row => row.id === id)).toEqual(before.companion);
		expect(roster[0].currency).toEqual(before.currency);
		const mirror = page._readActiveCharacterMirror("creator");
		expect(mirror.companions.find(row => row.id === id)).toEqual(before.companion);
		expect(mirror.currency).toEqual(before.currency);
	});

	it("reverses only the paid repair in newer persisted actor pools, damage, currency and notes", async () => {
		installStorage();
		const {state, page, id, context, before, after, receipt} = beginRepair();
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setHp(hydrated.actor.getHp().current - 2);
		hydrated.actor.useSpellSlot(1);
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		state.setCurrency("gp", state.getCurrency().gp - 7);
		state.setNote("backstory", "Keep newer note");
		roster[0] = state.toJson();
		page._writeActiveCharacterMirror(page._stampCharacterSnapshot(state.toJson()));
		page._state = new State();
		page._currentCharacterId = "other";
		page._characterLoadGeneration++;
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt);
		const saved = roster[0].companions.find(row => row.id === id);
		expect(saved.hp.current).toBe(before.companion.hp.current - 2);
		expect(saved.actorSnapshot.state.spellcasting.spellSlots[1].current).toBe(3);
		expect(roster[0].currency.gp).toBe(before.currency.gp - 7);
		expect(roster[0].notes.backstory).toBe("Keep newer note");
	});

	it("does not mistake an unrelated canonical actor revision for the failed repair's write", async () => {
		installStorage();
		const {state, page, id, context, before, after, receipt} = beginRepair();
		const canonical = state._createDetachedActorState(roster[0]);
		const hydrated = canonical.hydrateCompanionActor(id);
		hydrated.actor.useSpellSlot(1);
		expect(canonical.commitCompanionActor(id, hydrated).ok).toBe(true);
		roster[0] = canonical.toJson();
		expect(roster[0].companions[0].actorSnapshot.revision).toBe(after.companion.actorSnapshot.revision);
		page._state = new State();
		page._currentCharacterId = "other";
		page._characterLoadGeneration++;
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt);
		expect(roster[0].companions[0].hp.current).toBe(before.companion.hp.current);
		expect(roster[0].companions[0].actorSnapshot.state.spellcasting.spellSlots[1].current).toBe(3);
		expect(roster[0].currency).toEqual(before.currency);
	});

	it("preserves repair write identity through normal character reload", () => {
		installStorage();
		const {state, id, receipt} = beginRepair();
		const loaded = new State({isDetached: true});
		loaded.loadFromJson(state.toJson());
		expect(loaded.getCompanion(id).repairTransactionId).toBe(receipt.transactionId);
	});

	it("surfaces a conflicting newer paid repair instead of refunding or overwriting its saved state", async () => {
		installStorage();
		const {state, page, id, context, before, after, receipt} = beginRepair();
		const canonical = state._createDetachedActorState(roster[0]);
		expect(canonical.repairSimulacrum(id, {amount: 3, laboratoryConfirmed: true}).ok).toBe(true);
		roster[0] = canonical.toJson();
		const saved = copy(roster[0]);
		page._state = new State();
		page._currentCharacterId = "other";
		page._characterLoadGeneration++;
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await expect(CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt))
			.rejects.toThrow("newer paid repair");
		expect(roster[0]).toEqual(saved);
	});

	it("does not promote an older compensated rescue mirror over newer canonical actor changes", async () => {
		installStorage();
		const {state, page, id, context, before, after, receipt} = beginRepair();
		page._writeActiveCharacterMirror({...state.toJson(), _savedAt: 10, _saveRevision: "older"});
		const canonical = state._createDetachedActorState(state.toJson());
		const hydrated = canonical.hydrateCompanionActor(id);
		hydrated.actor.useSpellSlot(1);
		hydrated.actor.setHp(hydrated.actor.getHp().current - 2);
		expect(canonical.commitCompanionActor(id, hydrated).ok).toBe(true);
		canonical.setCurrency("gp", canonical.getCurrency().gp - 7);
		canonical.setNote("backstory", "Newer canonical note");
		roster[0] = {...canonical.toJson(), _savedAt: 20};
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt);
		expect(roster[0].companions[0].hp.current).toBe(before.companion.hp.current - 2);
		expect(roster[0].companions[0].actorSnapshot.state.spellcasting.spellSlots[1].current).toBe(3);
		expect(roster[0].currency.gp).toBe(before.currency.gp - 7);
		expect(roster[0].notes.backstory).toBe("Newer canonical note");
	});

	it("does not publish an in-memory rollback mirror before detecting a newer paid-repair conflict", async () => {
		installStorage();
		const {state, page, id, context, before, after, receipt} = beginRepair();
		page._writeActiveCharacterMirror({...state.toJson(), _savedAt: 10, _saveRevision: "older"});
		const originalMirror = page._readActiveCharacterMirror("creator");
		const canonical = state._createDetachedActorState(roster[0]);
		expect(canonical.repairSimulacrum(id, {amount: 3, laboratoryConfirmed: true}).ok).toBe(true);
		roster[0] = {...canonical.toJson(), _savedAt: 20};
		CharacterSheetSimulacrum._restoreRepairFields(context, before, after, receipt);
		await expect(CharacterSheetSimulacrum._pPersistRepairRollback(page, context, before, after, receipt))
			.rejects.toThrow("newer paid repair");
		expect(page._readActiveCharacterMirror("creator")).toEqual(originalMirror);
	});

	it("persists actual costs, terminal old record and new item-free actor through the real guarded Page writer", async () => {
		installStorage();
		const {state, page, cast} = makeHarness();
		const old = addCopy(state);
		roster.push(state.toJson());
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		const result = await cast();
		expect(result).toMatchObject({ok: true, committed: true});
		expect(roster).toHaveLength(1);
		expect(roster[0].spellcasting.spellSlots[7].current).toBe(0);
		expect(roster[0].inventory.find(row => row.id === "ruby").quantity).toBe(1);
		expect(roster[0].companions.find(row => row.id === old).actorSnapshot.lifecycle).toBe("destroyed");
		expect(roster[0].companions.find(row => row.id === result.companionId).actorSnapshot.state.inventory).toEqual([]);
		expect(sync.size).toBe(0);
	});

	it("repairs a failed-save rescue mirror instead of reloading a free duplicate with refunded costs", async () => {
		installStorage();
		const {state, page, cast} = makeHarness();
		const oldId = addCopy(state);
		roster.push(state.toJson());
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		jest.spyOn(StorageUtil, "pSet").mockRejectedValue(new Error("Disk unavailable"));
		expect(await cast()).toMatchObject({ok: false, committed: false});
		const mirror = page._readActiveCharacterMirror("creator");
		expect(mirror.companions).toHaveLength(1);
		expect(mirror.companions[0].id).toBe(oldId);
		expect(mirror.companions[0].actorSnapshot.lifecycle).toBe("active");
		expect(mirror.spellcasting.spellSlots[7].current).toBe(1);
		expect(mirror.inventory.find(row => row.id === "ruby").quantity).toBe(2);
		expect(state.getCompanions()).toHaveLength(1);
	});

	it("compensates a switch during the actual async write on the old persisted owner only", async () => {
		installStorage();
		const {state, page, cast} = makeHarness();
		const oldId = addCopy(state);
		roster.push(state.toJson());
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		const normalWrite = StorageUtil.pSet.getMockImplementation();
		let other;
		jest.spyOn(StorageUtil, "pSet").mockImplementationOnce(async (...args) => {
			await normalWrite(...args);
			other = new State();
			other.setId("other");
			other.setName("Other character");
			other.setNote("backstory", "Keep other");
			other.setSpellSlots(7, 3, 2);
			page._state = other;
			page._currentCharacterId = "other";
			page._characterLoadGeneration++;
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(roster[0].companions).toHaveLength(1);
		expect(roster[0].companions[0]).toMatchObject({id: oldId, actorSnapshot: {lifecycle: "active"}});
		expect(roster[0].spellcasting.spellSlots[7].current).toBe(1);
		expect(roster[0].inventory.find(row => row.id === "ruby").quantity).toBe(2);
		expect(other.getSpellSlotsCurrent(7)).toBe(2);
		expect(other.getNote("backstory")).toBe("Keep other");
		expect(other.getCompanions()).toHaveLength(0);
	});

	it("preserves newer same-owner notes/currency in the compensation mirror when the actual write fails", async () => {
		installStorage();
		const {state, page, cast} = makeHarness();
		roster.push(state.toJson());
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		jest.spyOn(StorageUtil, "pSet").mockImplementation(async () => {
			state.setNote("backstory", "Newer save-time note");
			state.setCurrency("gp", 4100);
			throw new Error("Disk unavailable");
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		const mirror = page._readActiveCharacterMirror("creator");
		expect(mirror.notes.backstory).toBe("Newer save-time note");
		expect(mirror.currency.gp).toBe(4100);
		expect(mirror.companions).toHaveLength(0);
		expect(mirror.spellcasting.spellSlots[7].current).toBe(1);
		expect(mirror.inventory.find(row => row.id === "ruby").quantity).toBe(2);
	});

	it("never overwrites a newer same-ID reload mirror while compensating an in-flight save", async () => {
		installStorage();
		const {state, page, cast} = makeHarness();
		roster.push(state.toJson());
		page._saveCurrentCharacter = Page.prototype._saveCurrentCharacter;
		const normalWrite = StorageUtil.pSet.getMockImplementation();
		jest.spyOn(StorageUtil, "pSet").mockImplementationOnce(async (...args) => {
			await normalWrite(...args);
			const fresh = new State();
			fresh.setId("creator");
			fresh.setName("New imported version");
			fresh.setNote("backstory", "New imported note");
			fresh.setCurrency("gp", 55);
			state.loadFromJson(fresh.toJson());
			page._characterLoadGeneration++;
			page._writeActiveCharacterMirror(page._stampCharacterSnapshot(state.toJson()));
		});
		expect(await cast()).toMatchObject({ok: false, committed: false});
		expect(state.getName()).toBe("New imported version");
		expect(state.getTotalGold()).toBe(55);
		expect(state.getNote("backstory")).toBe("New imported note");
		expect(roster[0].name).toBe("New imported version");
		expect(roster[0].currency.gp).toBe(55);
		expect(roster[0].companions).toHaveLength(0);
	});
});
