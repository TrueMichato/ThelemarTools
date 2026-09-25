import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-ui.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterRosterView} from "../../js/encounterworkspace/encounterworkspace-view.js";

const make = async (monsters = [
	{name: "Goblin", source: "MM", cr: "1/4", hp: {average: 7}},
	{name: "Goblin", source: "MM", cr: "1/4", hp: {average: 7}},
	{name: "Owlbear", source: "MM", cr: "3", hp: {average: 59}},
	{name: "Shade", source: "HB", cr: "Unknown", hp: {}},
]) => {
	let index = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", items: monsters.map((_, ix) => ({h: `${ix}`}))},
		pResolveItem: async ({h}) => ({entity: monsters[Number(h)]}),
		fnUid: () => `id-${++index}`,
	});
};

const rows = (state, sort, filter = "all", query = "") =>
	getEncounterRosterView({state, sort, filter, query}).visibleIds;

describe("Encounter roster projection", () => {
	it("sorts stable duplicate names and ties, keeps missing HP and initiative last, and never changes canonical turns", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withHp(state, {id: "id-1", prop: "current", value: 3});
		state = EncounterWorkspaceState.withHp(state, {id: "id-3", prop: "current", value: 0});
		state = EncounterWorkspaceState.withInitiativeResults(state, [
			{id: "id-1", total: 12}, {id: "id-2", total: 12}, {id: "id-3", total: 20},
		]);
		state = EncounterWorkspaceState.withConditions(state, {condition: "poisoned", isAdd: true, targetIds: ["id-2"]});
		state = EncounterWorkspaceState.withTurn(state, "start");
		const before = structuredClone(state);
		const order = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
		expect(rows(state, "source")).toEqual(["id-1", "id-2", "id-3", "id-4"]);
		expect(rows(state, "initiative")).toEqual(["id-3", "id-1", "id-2", "id-4"]);
		expect(rows(state, "hp")).toEqual(["id-3", "id-1", "id-2", "id-4"]);
		expect(rows(state, "hpPercent")).toEqual(["id-3", "id-1", "id-2", "id-4"]);
		expect(rows(state, "cr")).toEqual(["id-3", "id-1", "id-2", "id-4"]);
		expect(rows(state, "status")).toEqual(["id-3", "id-2", "id-1", "id-4"]);
		expect(rows(state, "name")).toEqual(["id-1", "id-2", "id-3", "id-4"]);
		expect(state).toEqual(before);
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(order);
		expect(state.turn).toEqual({round: 1, activeId: "id-3"});
	});

	it("filters visible members without changing group membership, targets or shared-turn identity", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withConditions(state, {condition: "poisoned", isAdd: true, targetIds: ["id-2"]});
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["id-1", "id-2"], id: "patrol"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "patrol", isShared: true, total: 16});
		state = EncounterWorkspaceState.withTurn(state, "start");
		const before = structuredClone(state);
		const visible = getEncounterRosterView({state, sort: "status", filter: "conditioned", query: "Goblin"});
		expect(visible.visibleIds).toEqual(["id-2"]);
		expect(visible.groups[0]).toMatchObject({id: "patrol", memberIds: ["id-1", "id-2"]});
		expect(rows(state, "source", "unrolled")).toEqual(["id-3", "id-4"]);
		expect(rows(state, "source", "all", "HB")).toEqual(["id-4"]);
		expect(rows(state, "source", "all", "missing")).toEqual([]);
		expect(state).toEqual(before);
		expect(state.selectedIds).toEqual(["id-1", "id-2", "id-3", "id-4"]);
		expect(state.turn).toEqual({round: 1, activeId: "patrol"});
		expect(() => getEncounterRosterView({state, sort: "wrong"})).toThrow(/supported roster sort/);
	});

	it("shows and sorts an effective Quick Edit name while retaining its original numbered identity and turn order", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withInitiativeResults(state, [
			{id: "id-1", total: 20}, {id: "id-2", total: 9}, {id: "id-3", total: 9},
		]);
		state = EncounterWorkspaceState.withTurn(state, "start");
		state = EncounterWorkspaceState.withStatblockChanges(state, [{
			id: "id-2",
			addOperations: [{id: "rename", ...BestiaryQuickActionsOperations.patch({set: {name: "Acolyte"}})}],
			removeIds: [],
		}]).state;
		const before = structuredClone(state);
		const turnOrder = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
		const view = getEncounterRosterView({state, sort: "name"});
		expect(getEncounterEffectiveMonster(state.instances[1]).name).toBe("Acolyte");
		expect(state.instances[1].monster.name).toBe("Goblin");
		expect(view.visibleIds).toEqual(["id-2", "id-1", "id-3", "id-4"]);
		expect(view.displayLabels.get("id-2")).toBe("Acolyte (Goblin #2)");
		expect(view.labels.get("id-2")).toBe("Goblin #2");
		expect(getEncounterRosterView({state, query: "Acolyte"}).visibleIds).toEqual(["id-2"]);
		expect(rows(state, "source")).toEqual(["id-1", "id-2", "id-3", "id-4"]);
		expect(state).toEqual(before);
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(turnOrder);
		expect(state.turn).toEqual({round: 1, activeId: "id-1"});
	});

	it("places non-numeric fractional CR after known values rather than treating it as a sortable number", async () => {
		const state = await make([
			{name: "Mystery", source: "HB", cr: "A/2", hp: {}},
			{name: "Goblin", source: "MM", cr: "1/4", hp: {average: 7}},
			{name: "Owlbear", source: "MM", cr: "3", hp: {average: 59}},
		]);
		expect(rows(state, "cr")).toEqual(["id-3", "id-2", "id-1"]);
	});
});
