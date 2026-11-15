import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	cloneEncounterState,
	getEncounterEffectiveMonster,
	getEncounterInitiativeTotal,
} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterModifierForPreset} from "../../js/encounterworkspace/encounterworkspace-effects.js";
import {createEncounterEngine} from "../../js/encounterworkspace/encounterworkspace-engine.js";
import {applyEncounterEffect, saveEncounterEffectDef} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {applyEncounterCondition} from "../../js/encounterworkspace/encounterworkspace-conditions-rules.js";
import {withEncounterBattlefieldEntry} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {withEncounterCustomGroup, withEncounterGroupStack} from "../../js/encounterworkspace/encounterworkspace-groups-v8.js";
import {withEncounterTemplate} from "../../js/encounterworkspace/encounterworkspace-templates.js";
import {withEncounterCombatStatus} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {getMmMonster} from "./encounter-cockpit-fixtures.js";

// A real v7 save, written by the pre-cockpit reducers (fecd582d7^) from Monster Manual Goblins, a Mage and Zombies.
const V7_SAVE = JSON.parse(fs.readFileSync("test/e2e/fixtures/encounter-workspace-v7-save.json", "utf8"));
const STORAGE_KEY = "encounterWorkspaceState_encounterworkspace.html";

const getStorage = initial => {
	const values = new Map(initial === undefined ? [] : [[STORAGE_KEY, structuredClone(initial)]]);
	return {
		values,
		pGetForPage: jest.fn(async (key, {page}) => structuredClone(values.get(`${key}_${page}`))),
		pSetForPage: jest.fn(async (key, value, {page}) => values.set(`${key}_${page}`, structuredClone(value))),
	};
};
const byId = (state, id) => state.instances.find(it => it.id === id);

describe("Encounter Workspace saves across versions and UIs", () => {
	it("opens a real v7 save with HP, conditions, initiative, resources and roll effects intact", async () => {
		expect(V7_SAVE.version).toBe(7);
		const storage = getStorage(V7_SAVE);
		const state = await new EncounterWorkspaceStore({storage}).pLoad();

		expect(state.version).toBe(8);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(state.sourceList).toEqual({name: "Crypt ambush", saveId: "saved-crypt"});
		expect(state.combat).toEqual({status: "active"});
		expect(state.turn).toEqual({round: 1, activeId: "ew-2"});
		expect(state.selectedIds).toEqual(["ew-1", "ew-2", "ew-4", "ew-5", "ew-6"]);
		expect(state.groups).toEqual([{id: "grp-zombies", memberIds: ["ew-5", "ew-6"], sharedTurn: true, initiative: 6}]);
		expect(state.instances.map(it => [it.id, it.hp, it.conditions, it.kind])).toEqual([
			["ew-1", {current: 3, max: 7, temp: 0}, ["prone"], "monster"],
			["ew-2", {current: 7, max: 7, temp: 3}, ["frightened"], "monster"],
			["ew-3", {current: 7, max: 7, temp: 0}, ["frightened"], "monster"],
			["ew-4", {current: 31, max: 40, temp: 0}, [], "monster"],
			["ew-5", {current: 22, max: 22, temp: 0}, ["poisoned"], "monster"],
			["ew-6", {current: 22, max: 22, temp: 0}, [], "monster"],
		]);
		expect(state.instances.map(it => getEncounterInitiativeTotal(state, it))).toEqual([17, 12, 9, 14, 6, 6]);
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(["ew-1", "ew-4", "ew-2", "ew-3", "grp-zombies"]);

		const mage = byId(state, "ew-4");
		expect(mage.resources.concentration).toEqual({active: true, label: "Fly"});
		expect(mage.resources.spellSlots[1]).toEqual({current: 2, max: 4});
		expect(byId(state, "ew-5").resources.abilities).toEqual([{id: "custom:undead-fortitude-uses", name: "Fortitude rerolls", current: 1, max: 2}]);
		expect(getEncounterEffectiveMonster(byId(state, "ew-3")).ac).toEqual([{ac: 17, from: ["shield"]}]);
		expect(getEncounterEffectiveMonster(byId(state, "ew-1")).ac).toEqual(getMmMonster("Goblin").ac);

		// v7 roll effects become v8 effects; area notes and battlefield presets become battlefield entries.
		expect(byId(state, "ew-1").effects).toEqual([expect.objectContaining({id: "fx:v7:mod-bless", name: "Bless", kind: "buff", source: "v7-roll-effect"})]);
		expect(byId(state, "ew-2").effects).toEqual([expect.objectContaining({id: "fx:v7:mod-bless", name: "Bless"})]);
		expect(byId(state, "ew-4").effects).toEqual([expect.objectContaining({id: "fx:v7:mod-bane", name: "Bane", kind: "debuff"})]);
		expect(byId(state, "ew-5").effects).toEqual([]);
		expect(state.battlefield).toEqual([
			expect.objectContaining({id: "bf:v7:note-crypt", rule: "custom", name: "Crypt tremor", note: "On initiative 20 loose stones fall.", scope: "selection", ids: ["ew-4", "ew-5", "ew-6"]}),
			expect.objectContaining({id: "bf:v7:desecrated-dmg", rule: "desecrated-dmg", scope: "selection", ids: ["ew-5", "ew-6"]}),
		]);
		// The v7 arrays stay for the legacy UI.
		state.instances.forEach((it, ix) => {
			expect(it.modifiers).toEqual(V7_SAVE.instances[ix].modifiers);
			expect(it.areaNotes).toEqual(V7_SAVE.instances[ix].areaNotes);
		});

		expect(state).toMatchObject({groupMeta: {}, log: [], savedEffects: []});
		expect(EncounterWorkspaceState.validate(structuredClone(state))).toEqual(state);
	});

	it("keeps cockpit-only fields when the legacy UI edits and saves the encounter, and the cockpit reads them back", async () => {
		// 1. The cockpit opens the v7 save and adds everything only it knows about.
		const storage = getStorage(V7_SAVE);
		const store = new EncounterWorkspaceStore({storage});
		let now = 1000;
		const engine = createEncounterEngine({state: await store.pLoad(), pSave: next => store.pSave(next), now: () => now++});
		await engine.pCommit("Cockpit prep", (draft, {log}) => {
			saveEncounterEffectDef(draft, {name: "Crypt chill", kind: "debuff", mods: [{target: "speed", kind: "flat", value: -10}], duration: 10}, {fnUid: () => "chill"});
			applyEncounterEffect(draft, {targetIds: ["ew-1", "ew-2"], def: "haste", casterId: "ew-4", fnUid: (() => { let ix = 0; return () => `haste-${++ix}`; })(), log});
			applyEncounterEffect(draft, {targetIds: ["ew-3"], def: {name: "Crypt chill", kind: "debuff", mods: [{target: "speed", kind: "flat", value: -10}]}, rounds: 3, fnUid: () => "chill-1", log});
			applyEncounterCondition(draft, {targetIds: ["ew-1"], condition: "restrained", rounds: 2, log});
			Object.assign(byId(draft, "ew-2"), {label: "Snik", note: "Knows the crypt layout", tieOrder: 1});
			Object.assign(byId(draft, "ew-1"), {deathSaveMode: "on", deathSaves: {successes: 1, failures: 2, stable: false, dead: false}});
		});
		await engine.pCommit("Cockpit groups", draft => {
			let next = withEncounterCustomGroup(draft, {ids: ["ew-1", "ew-2", "ew-3"], name: "Goblins"});
			next = withEncounterGroupStack(next, {name: "Goblins", isStacked: true});
			next = withEncounterBattlefieldEntry(next, {rule: "dim-light", scope: "group", group: "Goblins", rounds: 5, note: "Torches gutter"}).state;
			next = withEncounterTemplate(next, {key: "elite", ids: ["ew-6"]}).state;
			return withEncounterCombatStatus(next, "active");
		});
		const cockpit = engine.getState();
		expect(cockpit.savedEffects.map(it => it.name)).toEqual(["Crypt chill"]);
		expect(cockpit.log.length).toBeGreaterThan(0);
		expect(byId(cockpit, "ew-1").effects.find(it => it.key === "haste")).toMatchObject({casterId: "ew-4", concOn: "Haste", rounds: 10});
		expect(byId(cockpit, "ew-4").resources.concentration).toEqual({active: true, label: "Haste"});
		expect(byId(cockpit, "ew-6").templates.map(it => it.key)).toEqual(["elite"]);
		const COCKPIT_ONLY = state => ({
			savedEffects: state.savedEffects,
			groupMeta: state.groupMeta,
			log: state.log,
			combat: state.combat,
			battlefield: state.battlefield,
			instances: state.instances.map(it => ({
				id: it.id,
				kind: it.kind,
				label: it.label,
				note: it.note,
				customGroup: it.customGroup,
				tieOrder: it.tieOrder,
				defeated: it.defeated,
				conditionDetails: it.conditionDetails,
				effects: it.effects,
				deathSaves: it.deathSaves,
				deathSaveMode: it.deathSaveMode,
				templates: it.templates,
			})),
		});
		const expected = COCKPIT_ONLY(cockpit);

		// 2. The legacy UI (?ew=1) loads the same save and runs each of its reducers, saving after every edit.
		const legacyStore = new EncounterWorkspaceStore({storage});
		let legacy = await legacyStore.pLoad();
		const pLegacy = async fn => { legacy = await legacyStore.pSave(fn(legacy)); };
		await pLegacy(s => EncounterWorkspaceState.withTarget(s, {id: "ew-3", isSelected: true}));
		await pLegacy(s => EncounterWorkspaceState.withHp(s, {id: "ew-2", prop: "temp", value: 5}));
		await pLegacy(s => EncounterWorkspaceState.withHpOperation(s, {operation: {mode: "delta", value: -2}, targetIds: ["ew-1"]}).state);
		await pLegacy(s => EncounterWorkspaceState.withTypedDamage(s, {amount: 6, damageType: "fire", source: "magicalAttack", targetIds: ["ew-4"]}).state);
		await pLegacy(s => EncounterWorkspaceState.withConditions(s, {condition: "Blinded", isAdd: true, targetIds: ["ew-3"]}));
		await pLegacy(s => EncounterWorkspaceState.withAreaNote(s, {note: {id: "note-bats", kind: "trait", name: "Bat swarm", description: "Disadvantage on Perception."}, isAdd: true, targetIds: ["ew-1"]}).state);
		await pLegacy(s => EncounterWorkspaceState.withModifier(s, {modifier: getEncounterModifierForPreset("heavy-precipitation-xdmg"), isAdd: true, targetIds: ["ew-2"]}).state);
		await pLegacy(s => EncounterWorkspaceState.withSpellSlots(s, {id: "ew-4", level: 1, current: 1, max: 4}));
		await pLegacy(s => EncounterWorkspaceState.withAbilityUse(s, {id: "ew-5", abilityId: "custom:undead-fortitude-uses", change: -1}));
		await pLegacy(s => EncounterWorkspaceState.withInitiative(s, {id: "ew-3", total: 11}));
		await pLegacy(s => EncounterWorkspaceState.withInitiativeReorder(s, {id: "ew-2", beforeId: "ew-4"}).state);
		await pLegacy(s => EncounterWorkspaceState.withGroupSplit(s, {id: "ew-6"}));
		await pLegacy(s => EncounterWorkspaceState.withGroupRejoin(s, {id: "ew-6", groupId: null}));
		await pLegacy(s => EncounterWorkspaceState.withTurn(s, "next"));
		await pLegacy(s => EncounterWorkspaceState.withStatblockChanges(s, [{id: "ew-1", addOperations: [{id: "op-ac", type: "patch", data: {patch: {set: {ac: [{ac: 16, from: ["shield"]}]}}}}], removeIds: []}]).state);

		// 3. The cockpit (?ew=2) reopens the save.
		const reopened = await new EncounterWorkspaceStore({storage}).pLoad();
		expect(byId(reopened, "ew-2").hp.temp).toBe(5);
		expect(byId(reopened, "ew-1").hp.current).toBe(1);
		expect(byId(reopened, "ew-4").hp.current).toBe(25);
		expect(byId(reopened, "ew-3").conditions).toContain("blinded");
		expect(byId(reopened, "ew-4").resources.spellSlots[1].current).toBe(1);
		expect(byId(reopened, "ew-5").resources.abilities[0].current).toBe(0);
		expect(byId(reopened, "ew-3").initiative).toBe(11);
		expect(getEncounterEffectiveMonster(byId(reopened, "ew-1")).ac).toEqual([{ac: 16, from: ["shield"]}]);
		expect(reopened.turn.activeId).not.toBe("ew-2");

		// Every cockpit-only field survived, except the expected initiative tie-break written by the legacy reorder.
		const actual = COCKPIT_ONLY(reopened);
		expected.instances.forEach((it, ix) => { it.tieOrder = actual.instances[ix].tieOrder; });
		expect(actual).toEqual(expected);
		expect(actual.savedEffects[0]).toMatchObject({key: "saved-chill", name: "Crypt chill", saved: true});
		expect(byId(reopened, "ew-1").conditionDetails.restrained).toEqual(expect.objectContaining({rounds: 2}));
		expect(EncounterWorkspaceState.validate(structuredClone(reopened))).toEqual(reopened);
	});

	it("carries the saved-effects library into the next encounter instead of erasing it", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		let ix = 0;
		const pResolveItem = async () => ({entity: getMmMonster("Goblin")});
		const fnUid = () => `g${++ix}`;
		const first = await store.pReplace({currentState: EncounterWorkspaceState.getEmpty(), exportedSublist: {name: "One", saveId: "one", items: [{h: "goblin_mm", c: 1}]}, pConfirm: async () => true, pResolveItem, fnUid});
		const draft = cloneEncounterState(first);
		saveEncounterEffectDef(draft, {name: "Crypt chill", kind: "debuff", mods: [{target: "speed", kind: "flat", value: -10}]}, {fnUid: () => "x"});
		const withSaved = await store.pSave(draft);
		const second = await store.pReplace({currentState: withSaved, exportedSublist: {name: "Two", saveId: "two", items: [{h: "goblin_mm", c: 2}]}, pConfirm: async () => true, pResolveItem, fnUid});

		expect(second.sourceList.name).toBe("Two");
		expect(second.instances).toHaveLength(2);
		expect(second.savedEffects).toEqual(withSaved.savedEffects);
		expect(second.savedEffects).not.toBe(withSaved.savedEffects);
		expect((await new EncounterWorkspaceStore({storage}).pLoad()).savedEffects.map(it => it.name)).toEqual(["Crypt chill"]);
	});
});
