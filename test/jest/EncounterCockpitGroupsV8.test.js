import "../../js/parser.js";
import "../../js/utils.js";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	getEncounterGroupPlural,
	getEncounterGroupsV8,
	rollEncounterGroupInitiative,
	withEncounterAutoGroup,
	withEncounterLoadAutoGroup,
	withEncounterCustomGroup,
	withEncounterGroupInitiative,
	withEncounterGroupRename,
	withEncounterGroupSharedTurn,
	withEncounterGroupStack,
	withEncounterUngroup,
} from "../../js/encounterworkspace/encounterworkspace-groups-v8.js";
import {withEncounterTemplate} from "../../js/encounterworkspace/encounterworkspace-templates.js";
import {byId, getD20Rng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const groupsOf = state => state.instances.map(it => it.customGroup);
const withParty = (state, id) => EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => it.id === id ? {...it, kind: "party", hash: "party:p1", party: {ac: 15, passive: 12, speed: 30, initBonus: 2}} : it)});

describe("Encounter Cockpit groups (v8)", () => {
	it("creates, adds to, renames (moving settings) and ungroups custom groups of mixed creatures", async () => {
		let state = await pGetCockpitState([["Goblin", 2], ["Wolf", 1]]);
		state = withEncounterCustomGroup(state, {ids: ["c1", "c3"], name: " Riders "});
		expect(groupsOf(state)).toEqual(["Riders", null, "Riders"]);
		state = withEncounterCustomGroup(state, {ids: ["c2"], name: "Riders"});
		state = withEncounterGroupStack(state, {name: "Riders", isStacked: true});
		state = withEncounterGroupRename(state, {from: "Riders", to: "Wolf riders"});
		expect(groupsOf(state)).toEqual(["Wolf riders", "Wolf riders", "Wolf riders"]);
		expect(state.groupMeta).toEqual({"Wolf riders": {stack: true}});
		expect(getEncounterGroupsV8(state)).toEqual([{id: "Wolf riders", name: "Wolf riders", kind: "custom", memberIds: ["c1", "c2", "c3"], isStacked: true, sharedInit: null, sharedTurnId: null}]);

		state = withEncounterUngroup(state, {ids: ["c3"]});
		expect(getEncounterGroupsV8(state).map(it => [it.name, it.kind, it.memberIds])).toEqual([["Wolf riders", "custom", ["c1", "c2"]], ["Wolf", "view", ["c3"]]]);
		state = withEncounterUngroup(state, {ids: ["c1", "c2"]});
		expect(state.groupMeta).toEqual({});
		expect(() => withEncounterCustomGroup(state, {ids: ["c1"], name: "c2"})).toThrow("can't be used as a group name");
		expect(() => withEncounterCustomGroup(state, {ids: ["c1"], name: "  "})).toThrow("Give the group a name");
	});

	it("keeps party members in their group when ungrouping", async () => {
		let state = withParty(await pGetCockpitState([["Goblin", 2]]), "c1");
		state = withEncounterCustomGroup(state, {ids: ["c1", "c2"], name: "Mixed"});
		expect(groupsOf(withEncounterUngroup(state, {ids: ["c1", "c2"]}))).toEqual(["Mixed", null]);
	});

	it("auto-groups creatures of the same kind on add, joining an existing group if one already exists", async () => {
		let state = await pGetCockpitState([["Goblin", 3], ["Wolf", 1]]);
		const first = withEncounterAutoGroup(state, ["c1", "c2", "c3", "c4"]);
		expect(first.grouped).toEqual([{name: "Goblins", ids: ["c1", "c2", "c3"]}]);
		state = withEncounterGroupRename(first.state, {from: "Goblins", to: "Ambushers"});

		const more = await pGetCockpitState([["Goblin", 1], ["Wolf", 1]], {prefix: "n"});
		state = EncounterWorkspaceState.validate({...state, instances: [...state.instances, ...more.instances]});
		const second = withEncounterAutoGroup(state, ["n1", "n2"]);
		expect(second.grouped).toEqual([{name: "Ambushers", ids: ["n1"]}, {name: "Wolves", ids: ["c4", "n2"]}]);
		expect(getEncounterGroupPlural("Harpy")).toBe("Harpies");
		expect(getEncounterGroupPlural("Lich")).toBe("Liches");
		expect(withEncounterAutoGroup(await pGetCockpitState([["Goblin", 1]]), ["c1"]).grouped).toEqual([]);
	});

	it("groups a whole loaded encounter by kind once, and a later Ungroup survives the next load", async () => {
		const loaded = withParty(await pGetCockpitState([["Goblin", 3], ["Wolf", 2], ["Bandit Captain", 1]]), "c1");
		const {autoGrouped, ...olderSave} = structuredClone(loaded);
		expect(EncounterWorkspaceState.validate(olderSave).autoGrouped).toBe(false);
		expect(() => EncounterWorkspaceState.validate({...structuredClone(loaded), autoGrouped: "yes"})).toThrow(/group settings/);

		const first = withEncounterLoadAutoGroup(loaded);
		expect(first.grouped).toEqual([{name: "Goblins", ids: ["c2", "c3"]}, {name: "Wolves", ids: ["c4", "c5"]}]);
		expect(groupsOf(first.state)).toEqual([null, "Goblins", "Goblins", "Wolves", "Wolves", null]);
		const saved = EncounterWorkspaceState.validate(structuredClone(first.state));
		expect(saved.autoGrouped).toBe(true);

		const ungrouped = withEncounterUngroup(saved, {ids: ["c4", "c5"]});
		const reloaded = withEncounterLoadAutoGroup(EncounterWorkspaceState.validate(structuredClone(ungrouped)));
		expect(reloaded.grouped).toEqual([]);
		expect(groupsOf(reloaded.state)).toEqual([null, "Goblins", "Goblins", null, null, null]);
	});

	it("sets or rolls one initiative for a whole group, with the best member's bonus and a breakdown", async () => {
		let state = await pGetCockpitState([["Wolf", 1], ["Goblin", 2], ["Bandit Captain", 1]]);
		state = withEncounterCustomGroup(state, {ids: ["c1", "c2", "c3"], name: "Pack"});
		state = EncounterWorkspaceState.withInitiative(state, {id: "c4", total: 14});
		const rolled = rollEncounterGroupInitiative(state, {name: "Pack", rng: getD20Rng(12)});
		expect(rolled.rollerId).toBe("c1");
		expect(rolled.roll.text).toBe("14 (12 +2)");
		expect(rolled.state.instances.map(it => [it.id, it.initiative, it.tieOrder])).toEqual([["c1", 14, 1], ["c2", 14, 2], ["c3", 14, 3], ["c4", 14, 0]]);
		expect(rolled.state.groupMeta.Pack).toEqual({sharedInit: 14});
		expect(EncounterWorkspaceState.getInitiativeOrder(rolled.state).map(it => it.id)).toEqual(["c4", "c1", "c2", "c3"]);

		const set = withEncounterGroupInitiative(state, {name: "Pack", total: 9});
		expect(set.instances.filter(it => it.customGroup === "Pack").map(it => it.initiative)).toEqual([9, 9, 9]);
		expect(() => withEncounterGroupInitiative(state, {name: "Nobody", total: 9})).toThrow("no group called Nobody");
	});

	it("bridges a custom group to one shared turn only when statblocks match", async () => {
		let state = await pGetCockpitState([["Goblin", 2], ["Wolf", 1]]);
		state = withEncounterCustomGroup(state, {ids: ["c1", "c2"], name: "Goblins"});
		state = withEncounterGroupInitiative(state, {name: "Goblins", total: 11});
		state = withEncounterGroupSharedTurn(state, {name: "Goblins", isShared: true});
		expect(state.groups).toEqual([{id: "shared:Goblins", memberIds: ["c1", "c2"], sharedTurn: true, initiative: 11}]);
		expect(getEncounterGroupsV8(state)[0].sharedTurnId).toBe("shared:Goblins");
		// Group initiative now writes one result for the shared turn.
		expect(withEncounterGroupInitiative(state, {name: "Goblins", total: 16}).groups[0].initiative).toBe(16);
		state = withEncounterGroupSharedTurn(state, {name: "Goblins", isShared: false});
		expect(state.groups).toEqual([]);

		state = withEncounterTemplate(state, {key: "elite", ids: ["c1"]}).state;
		expect(() => withEncounterGroupSharedTurn(state, {name: "Goblins", isShared: true, total: 11})).toThrow("can't share one turn");
		expect(byId(state, "c1").customGroup).toBe("Goblins");
	});
});
