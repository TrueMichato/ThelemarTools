import {jest} from "@jest/globals";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterResourceDefaults, getEncounterResourceSummary} from "../../js/encounterworkspace/encounterworkspace-resources.js";

const monster = {
	name: "Arcane Dragon",
	source: "MM",
	hp: {average: 100, formula: "10d10 + 45"},
	spellcasting: [{spells: {"1": {slots: 4}, "3": {slots: 2}}, daily: {"1": ["{@spell lightning bolt}"], "1e": ["{@spell shield}"]}}],
	trait: [
		{name: "Legendary Resistance (3/Day, or 4/Day in Lair)", entries: ["The dragon succeeds instead."]},
		{name: "Ambiguous Cure", entries: ["The dragon may use this ability on each turn."]},
	],
	action: [
		{name: "Breath {@recharge 5}", entries: ["Deal damage."]},
		{name: "Enslave (2/Day)", entries: ["Enslave a target."]},
	],
	legendary: [{name: "Tail Attack", entries: ["The dragon attacks."]}],
	specialEquipment: [{name: "Amber Wand", charges: 5}],
};

const create = async (source = monster) => {
	let id = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Dragons", saveId: "saved", items: [{h: "dragon_mm", c: 2}]},
		pResolveItem: async () => ({entity: source}),
		fnUid: () => `dragon-${++id}`,
	});
};

const getStore = () => {
	let saved;
	const storage = {
		pGetForPage: jest.fn(async () => saved),
		pSetForPage: jest.fn(async (_, value) => { saved = structuredClone(value); }),
	};
	return {storage, store: new EncounterWorkspaceStore({storage})};
};

describe("Encounter Workspace combat resources", () => {
	it("extracts only explicit counts, excluding implied legendary uses and daily spells", () => {
		const resources = getEncounterResourceDefaults(monster);
		expect(resources.spellSlots).toEqual({"1": {current: 4, max: 4}, "3": {current: 2, max: 2}});
		expect(resources.abilities.map(({id, name, max}) => ({id, name, max}))).toEqual([
			{id: "auto:ability:trait:0", name: "Legendary Resistance (3/Day, or 4/Day in Lair)", max: 3},
			{id: "auto:ability:action:1", name: "Enslave (2/Day)", max: 2},
			{id: "auto:equipment:0", name: "Amber Wand", max: 5},
		]);
		expect(resources.recharges).toEqual([{id: "auto:recharge:action:0", name: "Breath", min: 5, ready: true}]);
		expect(resources.concentration).toEqual({active: false, label: ""});
		expect(getEncounterResourceSummary(resources)).toBe("L1 slots 4/4 · L3 slots 2/2 · Legendary Resistance (3/Day, or 4/Day in Lair) 3/3 · +3 more");
		expect(getEncounterResourceDefaults({
			...monster,
			legendaryActions: 4,
			spellcasting: [{spells: {"1": {slots: "4"}, "10": {slots: 3}}}],
		}).abilities.find(it => it.id === "auto:legendary-actions"))
			.toEqual({id: "auto:legendary-actions", name: "Legendary Actions", current: 4, max: 4});
		expect(getEncounterResourceDefaults({...monster, legendaryHeader: ["The dragon can take 2 legendary actions, choosing below."]})
			.abilities.find(it => it.id === "auto:legendary-actions").max).toBe(2);
		expect(getEncounterResourceDefaults({...monster, legendaryActions: "3", trait: [{name: "Legendary Resistance", entries: ["It can do this three times per day."]}]})
			.abilities.some(it => it.name.startsWith("Legendary"))).toBe(false);
		expect(getEncounterResourceDefaults({
			...monster,
			trait: [{name: "Special Equipment", entries: ["The jade staff has 7 charges. The rumored staff may have charges."]}],
		}).abilities.at(-1)).toEqual({id: "auto:equipment-trait:0:0", name: "jade staff", current: 7, max: 7});
	});

	it("keeps identical instances independent while spending, restoring, editing and removing counters", async () => {
		const original = await create();
		let state = EncounterWorkspaceState.withSpellSlots(original, {id: "dragon-1", level: 1, current: 3, max: 4});
		state = EncounterWorkspaceState.withAbilityUse(state, {id: "dragon-1", abilityId: "auto:ability:action:1", change: -1});
		state = EncounterWorkspaceState.withRechargeReady(state, {id: "dragon-1", rechargeId: "auto:recharge:action:0", ready: false});
		state = EncounterWorkspaceState.withConcentration(state, {id: "dragon-1", active: true, label: "Haste"});
		state = EncounterWorkspaceState.withAbility(state, {id: "dragon-1", ability: {id: "manual:1", name: "Shield charm", current: 1, max: 2}});
		state = EncounterWorkspaceState.withAbilityUse(state, {id: "dragon-1", abilityId: "manual:1", change: 1});
		expect(state.instances[0].resources.abilities.find(it => it.id === "manual:1").current).toBe(2);
		expect(() => EncounterWorkspaceState.withAbilityUse(state, {id: "dragon-1", abilityId: "manual:1", change: 1})).toThrow(/no uses/);
		expect(state.instances[1].resources).toEqual(original.instances[1].resources);
		expect(original.instances[0].resources).toEqual(original.instances[1].resources);
		const {store} = getStore();
		await store.pSave(state);
		const loaded = await store.pLoad();
		expect(loaded.instances[0].resources).toEqual(state.instances[0].resources);
		expect(loaded.instances[1].resources).toEqual(original.instances[1].resources);
		state = EncounterWorkspaceState.withAbility(state, {id: "dragon-1", ability: {id: "manual:1", name: "Shield charm", current: 1, max: 3}});
		state = EncounterWorkspaceState.withoutAbility(state, {id: "dragon-1", abilityId: "manual:1"});
		state = EncounterWorkspaceState.withoutSpellSlots(state, {id: "dragon-1", level: 3});
		expect(state.instances[0].resources.abilities.some(it => it.id === "manual:1")).toBe(false);
		expect(state.instances[0].resources.spellSlots["3"]).toBeUndefined();
	});

	it("migrates versions 1 through 6 in memory from effective statblocks, with no writes", async () => {
		const state = await create();
		const {store, storage} = getStore();
		for (const version of [1, 2, 3, 4, 5, 6]) {
			const raw = structuredClone(state);
			raw.version = version;
			delete raw.instances[0].resources;
			delete raw.instances[1].resources;
			if (version < 6) { delete raw.groups; delete raw.ungroupedIds; }
			if (version < 5) raw.instances.forEach(it => { delete it.statblockOperations; });
			if (version < 4) {
				delete raw.turn;
				raw.instances.forEach(it => { delete it.hp; delete it.initiative; });
			}
			if (version < 3) raw.instances.forEach(it => { delete it.areaNotes; delete it.modifiers; });
			if (version < 2) raw.instances.forEach(it => { delete it.conditions; });
			storage.pGetForPage.mockResolvedValueOnce(raw);
			const migrated = await store.pLoad();
			expect(migrated.version).toBe(7);
			expect(migrated.instances.map(it => it.resources)).toEqual(state.instances.map(it => it.resources));
		}
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		const legacy = structuredClone(state);
		legacy.version = 6;
		delete legacy.instances[0].resources;
		delete legacy.instances[1].resources;
		legacy.instances[0].statblockOperations = [{id: "slots", ...BestiaryQuickActionsOperations.patch({set: {"spellcasting.0.spells.1.slots": 2}})}];
		storage.pGetForPage.mockResolvedValueOnce(legacy);
		const loaded = await store.pLoad();
		expect(loaded.instances[0].resources.spellSlots["1"].max).toBe(2);
		expect(loaded.instances[1].resources.spellSlots["1"].max).toBe(4);
	});

	it("rejects every malformed v7 field and invalid mutations without changing stored data", async () => {
		const state = await create();
		const {store, storage} = getStore();
		const base = state.instances[0].resources;
		for (const resources of [
			null,
			{...base, concentration: {active: "yes", label: ""}},
			{...base, concentration: {active: false, label: "Haste"}},
			{...base, spellSlots: {"1": {current: -1, max: 4}}},
			{...base, spellSlots: {"1": {current: 5, max: 4}}},
			{...base, spellSlots: {"0": {current: 1, max: 1}}},
			{...base, spellSlots: {"1": {current: 1.5, max: 4}}},
			{...base, spellSlots: {"1": {current: 1, max: 4, unexpected: true}}},
			{...base, abilities: [...base.abilities, base.abilities[0]]},
			{...base, abilities: [{id: "x", name: "   ", current: 1, max: 1}]},
			{...base, abilities: [{id: "x", name: "Power", current: Infinity, max: 3}]},
			{...base, recharges: [{id: "x", name: "Breath", min: 1, ready: true}]},
			{...base, recharges: [{id: "x", name: "Breath", min: 5, ready: 1}]},
			{...base, abilities: Array.from({length: 201}, (_, index) => ({id: `x${index}`, name: "Aura", current: 1, max: 1}))},
			{...base, unknown: true},
		]) {
			await expect(store.pSave({...state, instances: [{...state.instances[0], resources}, state.instances[1]]}))
				.rejects.toThrow(/invalid combat resources/);
		}
		expect(() => EncounterWorkspaceState.withSpellSlots(state, {id: "dragon-1", level: 1, current: 5, max: 4})).toThrow();
		expect(() => EncounterWorkspaceState.withAbilityUse(state, {id: "missing", abilityId: "manual", change: -1})).toThrow();
		expect(() => EncounterWorkspaceState.withConcentration(state, {id: "dragon-1", active: false, label: "Haste"})).toThrow();
		expect(storage.pSetForPage).not.toHaveBeenCalled();
	});

	it("preserves spent uses through transformations and leaves source data untouched", async () => {
		const state = await create();
		const spent = EncounterWorkspaceState.withAbilityUse(state, {id: "dragon-1", abilityId: "auto:ability:trait:0", change: -1});
		const concentrated = EncounterWorkspaceState.withConcentration(spent, {id: "dragon-1", active: true, label: "Haste"});
		const {state: edited} = EncounterWorkspaceState.withStatblockChanges(concentrated, [{
			id: "dragon-1",
			removeIds: [],
			addOperations: [{id: "change-actions", ...BestiaryQuickActionsOperations.patch({set: {legendaryActions: 5}})}],
		}]);
		expect(edited.instances[0].resources).toEqual(concentrated.instances[0].resources);
		expect(edited.instances[1].resources).toEqual(state.instances[1].resources);
		expect(edited.instances[0].monster.legendaryActions).toBeUndefined();
		const {store} = getStore();
		await store.pSave(edited);
		expect((await store.pLoad()).instances[0].resources).toEqual(edited.instances[0].resources);
	});

	it("does not automatically refill or spend resources when turns or initiative change", async () => {
		const state = await create();
		const spent = EncounterWorkspaceState.withAbilityUse(state, {id: "dragon-1", abilityId: "auto:ability:trait:0", change: -1});
		const slots = EncounterWorkspaceState.withSpellSlots(spent, {id: "dragon-1", level: 1, current: 2, max: 4});
		let next = EncounterWorkspaceState.withInitiativeResults(slots, [{id: "dragon-1", total: 15}, {id: "dragon-2", total: 10}]);
		next = EncounterWorkspaceState.withTurn(next, "start");
		next = EncounterWorkspaceState.withTurn(next, "next");
		next = EncounterWorkspaceState.withTurn(next, "next");
		next = EncounterWorkspaceState.withTurn(next, "reset");
		expect(next.instances.map(it => it.resources)).toEqual(slots.instances.map(it => it.resources));
	});

	it("does not publish resources when persistence fails", async () => {
		const state = await create();
		const {store, storage} = getStore();
		storage.pSetForPage.mockRejectedValue(new Error("Storage full"));
		const next = EncounterWorkspaceState.withSpellSlots(state, {id: "dragon-1", level: 1, current: 3, max: 4});
		await expect(store.pSave(next)).rejects.toThrow("Storage full");
		expect(state.instances[0].resources.spellSlots["1"].current).toBe(4);
		expect(state.instances[1].resources.spellSlots["1"].current).toBe(4);
	});
});
