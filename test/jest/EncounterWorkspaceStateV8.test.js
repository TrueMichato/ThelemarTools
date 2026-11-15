import {jest} from "@jest/globals";
import {
	EncounterCockpitSettingsStore,
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	MAX_ENCOUNTER_LOG_ENTRIES,
	cloneEncounterState,
	getEncounterPartyMonster,
	getEncounterViewGroups,
} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterModifierForPreset} from "../../js/encounterworkspace/encounterworkspace-effects.js";

const getMonster = (name = "Goblin") => ({
	name,
	source: "MM",
	cr: "1/4",
	hp: {average: 7, formula: "2d6"},
	dex: 14,
	action: [{name: "Scimitar", entries: ["Hit."]}],
});

const pGetState = async (count = 2) => {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "list-1", items: [{h: "goblin_mm", c: count}]},
		pResolveItem: async () => ({entity: getMonster()}),
		fnUid: () => `encounter-${++ix}`,
	});
};

const getStorage = () => {
	const values = new Map();
	return {
		values,
		pGetForPage: jest.fn(async (key, {page}) => values.get(`${key}_${page}`)),
		pSetForPage: jest.fn(async (key, value, {page}) => values.set(`${key}_${page}`, value)),
	};
};

const getV7 = state => {
	const v7 = structuredClone(state);
	v7.version = 7;
	for (const key of ["battlefield", "groupMeta", "log", "savedEffects", "combat"]) delete v7[key];
	v7.instances.forEach(it => {
		for (const key of ["kind", "label", "conditionDetails", "effects", "deathSaves", "deathSaveMode", "defeated", "templates", "note", "customGroup", "tieOrder"]) delete it[key];
	});
	return v7;
};

describe("Encounter Workspace state v8", () => {
	it("creates new encounters with the v8 fields and an untouched v7 shape", async () => {
		const state = await pGetState();
		expect(state.version).toBe(8);
		expect(state).toMatchObject({battlefield: [], groupMeta: {}, log: [], savedEffects: [], combat: {status: "setup"}});
		expect(state.instances[0]).toMatchObject({
			kind: "monster",
			label: null,
			conditionDetails: {},
			effects: [],
			deathSaves: null,
			deathSaveMode: "default",
			defeated: false,
			templates: [],
			note: "",
			customGroup: null,
			tieOrder: 0,
			areaNotes: [],
			modifiers: [],
		});
	});

	it("migrates a v7 save in memory, converting area notes and battlefield presets but keeping the v7 arrays", async () => {
		let state = await pGetState();
		({state} = EncounterWorkspaceState.withAreaNote(state, {note: {id: "n1", kind: "lair", name: "Rumbling cave", description: "Rocks fall on 20."}, isAdd: true}));
		({state} = EncounterWorkspaceState.withModifier(state, {modifier: getEncounterModifierForPreset("heavy-precipitation-xdmg"), isAdd: true, targetIds: ["encounter-1"]}));
		({state} = EncounterWorkspaceState.withModifier(state, {modifier: {id: "m1", name: "Inspired", scopes: ["save"], mode: "advantage", bonus: 2}, isAdd: true, targetIds: ["encounter-2"]}));
		state = EncounterWorkspaceState.withConditions(state, {condition: "Prone", isAdd: true});
		state = {...state, instances: state.instances.map((it, ix) => ({...it, initiative: 15 - ix})), turn: {round: 2, activeId: "encounter-1"}};
		const v7 = getV7(state);
		const storage = getStorage();
		storage.values.set("encounterWorkspaceState_encounterworkspace.html", v7);

		const loaded = await new EncounterWorkspaceStore({storage}).pLoad();
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(loaded.version).toBe(8);
		expect(loaded.combat).toEqual({status: "active"});
		expect(loaded.instances[0].areaNotes).toEqual(v7.instances[0].areaNotes);
		expect(loaded.instances[0].modifiers).toEqual(v7.instances[0].modifiers);
		expect(loaded.battlefield).toEqual([
			expect.objectContaining({rule: "custom", name: "Rumbling cave", note: "Rocks fall on 20.", scope: "selection", ids: ["encounter-1", "encounter-2"]}),
			expect.objectContaining({rule: "heavy-precipitation-xdmg", scope: "selection", ids: ["encounter-1"]}),
		]);
		expect(loaded.instances[0].effects).toEqual([]);
		expect(loaded.instances[1].effects).toEqual([expect.objectContaining({
			name: "Inspired",
			kind: "buff",
			mods: [{target: "save", kind: "adv", value: ""}, {target: "save", kind: "bonus", value: 2}],
			source: "v7-roll-effect",
		})]);
	});

	it("migrates every older version to v8 and round-trips the result unchanged", async () => {
		const state = await pGetState();
		for (const version of [1, 2, 3, 4, 5, 6, 7]) {
			const raw = getV7(state);
			raw.version = version;
			const migrated = EncounterWorkspaceState.validate(raw);
			expect(migrated.version).toBe(8);
			expect(migrated.instances.map(it => it.kind)).toEqual(["monster", "monster"]);
			expect(EncounterWorkspaceState.validate(structuredClone(migrated))).toEqual(migrated);
		}
	});

	it("keeps v8 fields through the legacy reducers and prunes details for cleared conditions", async () => {
		let state = await pGetState();
		state = EncounterWorkspaceState.withConditions(state, {condition: "Poisoned", isAdd: true});
		state = EncounterWorkspaceState.validate({
			...state,
			battlefield: [{id: "bf1", rule: "dim-light", name: "Dim light", scope: "all", ids: []}],
			instances: state.instances.map(it => ({...it, label: "Snik", note: "Fled once", conditionDetails: {poisoned: {rounds: 3}}, effects: [{id: "fx1", key: "bless", name: "Bless", kind: "buff", mods: [{target: "save", kind: "bonus", value: "1d4"}], rounds: 10}]})),
		});
		const {state: hurt} = EncounterWorkspaceState.withHpOperation(state, {operation: {mode: "delta", value: -3}});
		expect(hurt.instances[0].hp.current).toBe(4);
		expect(hurt.instances[0]).toMatchObject({label: "Snik", note: "Fled once", conditionDetails: {poisoned: {rounds: 3}}});
		expect(hurt.instances[0].effects[0].name).toBe("Bless");
		expect(hurt.battlefield[0].name).toBe("Dim light");

		const cured = EncounterWorkspaceState.withConditions(state, {condition: "poisoned", isAdd: false});
		expect(cured.instances[0].conditionDetails).toEqual({});
	});

	it("accepts party members only with a party hash and complete party details", async () => {
		const state = await pGetState(1);
		const party = {
			...state.instances[0],
			id: "pc-1",
			hash: "party:vex",
			kind: "party",
			monster: getEncounterPartyMonster({name: "Vex", ac: 15, hpMax: 33, initBonus: 4}),
			party: {characterId: null, ac: 15, passive: 14, speed: 30, initBonus: 4},
			hp: {current: 33, max: 33, temp: 0},
			resources: {spellSlots: {}, abilities: [], recharges: [], concentration: {active: false, label: ""}},
		};
		const withParty = EncounterWorkspaceState.validate({...state, instances: [...state.instances, party]});
		expect(withParty.instances[1].monster).toMatchObject({name: "Vex", source: "PARTY", dex: 18});
		expect(getEncounterViewGroups(withParty).length).toBe(2);
		expect(() => EncounterWorkspaceState.validate({...state, instances: [...state.instances, {...party, hash: "vex_mm"}]})).toThrow(/creature kinds/);
		expect(() => EncounterWorkspaceState.validate({...state, instances: [...state.instances, {...party, party: {ac: 15}}]})).toThrow(/party members/);
	});

	it("rejects malformed v8 fields instead of silently erasing them", async () => {
		const state = await pGetState(1);
		const bad = [
			[{instances: [{...state.instances[0], effects: [{id: "a", name: "A", mods: []}, {id: "a", name: "B", mods: []}]}]}, /effects/],
			[{instances: [{...state.instances[0], deathSaves: {successes: 4, failures: 0, stable: false, dead: false}}]}, /death saves/],
			[{instances: [{...state.instances[0], deathSaveMode: "sometimes"}]}, /death saves/],
			[{battlefield: [{id: "b", rule: "fog", name: "Fog", scope: "group", ids: []}]}, /battlefield/],
			[{combat: {status: "paused"}}, /combat status/],
			[{log: [{kind: "roll"}]}, /log entries/],
		];
		for (const [patch, error] of bad) expect(() => EncounterWorkspaceState.validate({...state, ...patch})).toThrow(error);
	});

	it("caps the log and prunes selection-scoped battlefield ids for creatures that are gone", async () => {
		const state = await pGetState(1);
		const log = Array.from({length: MAX_ENCOUNTER_LOG_ENTRIES + 25}, (_, ix) => ({id: `l${ix}`, kind: "note", text: `${ix}`}));
		const out = EncounterWorkspaceState.validate({...state, log, battlefield: [{id: "b", rule: "fog", name: "Fog", scope: "selection", ids: ["encounter-1", "gone"]}]});
		expect(out.log).toHaveLength(MAX_ENCOUNTER_LOG_ENTRIES);
		expect(out.log[0].text).toBe("25");
		expect(out.battlefield[0].ids).toEqual(["encounter-1"]);
	});

	it("clones without copying or freezing anything the caller still owns", async () => {
		const state = await pGetState(1);
		const clone = cloneEncounterState(state);
		expect(clone.instances[0].monster).toBe(state.instances[0].monster);
		expect(clone.instances[0]).not.toBe(state.instances[0]);
		const loose = {...state, instances: [{...state.instances[0], monster: getMonster()}]};
		const validated = EncounterWorkspaceState.validate(loose);
		expect(Object.isFrozen(loose.instances[0].monster)).toBe(false);
		expect(Object.isFrozen(validated.instances[0].monster)).toBe(true);
	});
});

describe("Encounter cockpit settings", () => {
	it("defaults, persists and validates independently of the legacy settings", async () => {
		const storage = getStorage();
		const store = new EncounterCockpitSettingsStore({storage});
		expect(await store.pLoad()).toEqual({ruleset: "phb", monsterDeathSaves: false});
		expect(await store.pSave({ruleset: "tgtt", monsterDeathSaves: true})).toEqual({ruleset: "tgtt", monsterDeathSaves: true});
		expect(storage.pSetForPage).toHaveBeenCalledWith("encounterCockpitSettings", {ruleset: "tgtt", monsterDeathSaves: true}, {page: "encounterworkspace.html"});
		expect(await store.pLoad()).toEqual({ruleset: "tgtt", monsterDeathSaves: true});
		await expect(store.pSave({ruleset: "4e", monsterDeathSaves: true})).rejects.toThrow(/invalid/);
	});
});
