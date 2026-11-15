import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	getCockpitConditionPressed,
	getCockpitDockTargetIds,
	getCockpitExhaustionLevel,
	getCockpitGroupChips,
	getCockpitHpState,
	getCockpitInstanceLabels,
	getCockpitPrevTurn,
	getCockpitRailOrder,
	getCockpitSelectionAfterClick,
	getCockpitSelectionAfterGroupToggle,
	getCockpitStepId,
	getCockpitTally,
	parseCockpitAmount,
	parseCockpitRounds,
} from "../../js/encounterworkspace/cockpit/model.js";

describe("Encounter cockpit shell model", () => {
	describe("selection", () => {
		const orderIds = ["a", "b", "c", "d"];

		test("toggle adds and removes one creature and moves the anchor", () => {
			expect(getCockpitSelectionAfterClick({selectedIds: ["a"], orderIds, clickedId: "c"})).toEqual({selectedIds: ["a", "c"], anchorId: "c"});
			expect(getCockpitSelectionAfterClick({selectedIds: ["a", "c"], orderIds, clickedId: "a"})).toEqual({selectedIds: ["c"], anchorId: "a"});
		});

		test("shift-range selects the span from the anchor in rail order, keeping what was already selected", () => {
			expect(getCockpitSelectionAfterClick({selectedIds: ["a"], orderIds, clickedId: "d", anchorId: "b", mode: "range"}))
				.toEqual({selectedIds: ["a", "b", "c", "d"], anchorId: "b"});
			// Range upward from the anchor works the same way.
			expect(getCockpitSelectionAfterClick({selectedIds: [], orderIds, clickedId: "a", anchorId: "c", mode: "range"}).selectedIds)
				.toEqual(["a", "b", "c"]);
		});

		test("shift-range with a stale anchor falls back to a toggle", () => {
			expect(getCockpitSelectionAfterClick({selectedIds: [], orderIds, clickedId: "b", anchorId: "gone", mode: "range"}))
				.toEqual({selectedIds: ["b"], anchorId: "b"});
		});

		test("a group chip selects its members, and a second click unselects only them", () => {
			const selected = getCockpitSelectionAfterGroupToggle({selectedIds: ["x"], memberIds: ["a", "b"]});
			expect(selected).toEqual(["x", "a", "b"]);
			expect(getCockpitSelectionAfterGroupToggle({selectedIds: selected, memberIds: ["a", "b"]})).toEqual(["x"]);
			// Partially selected group: the click completes it rather than clearing it.
			expect(getCockpitSelectionAfterGroupToggle({selectedIds: ["a"], memberIds: ["a", "b"]})).toEqual(["a", "b"]);
		});

		test("the dock acts on the live selection, otherwise on the viewed creature", () => {
			expect(getCockpitDockTargetIds({selectedIds: ["b", "gone"], viewedId: "a", instanceIds: ["a", "b"]}))
				.toEqual({ids: ["b"], isSelection: true});
			expect(getCockpitDockTargetIds({selectedIds: ["gone"], viewedId: "a", instanceIds: ["a", "b"]}))
				.toEqual({ids: ["a"], isSelection: false});
			expect(getCockpitDockTargetIds({selectedIds: [], viewedId: "gone", instanceIds: ["a"]}))
				.toEqual({ids: [], isSelection: false});
		});
	});

	describe("turn order", () => {
		test("previous turn steps back, wraps to the last creature of the previous round, and never goes below round 1", () => {
			const orderIds = ["a", "b", "c"];
			expect(getCockpitPrevTurn({turn: {round: 2, activeId: "b"}, orderIds})).toEqual({round: 2, activeId: "a"});
			expect(getCockpitPrevTurn({turn: {round: 2, activeId: "a"}, orderIds})).toEqual({round: 1, activeId: "c"});
			expect(getCockpitPrevTurn({turn: {round: 1, activeId: "a"}, orderIds})).toBeNull();
			expect(getCockpitPrevTurn({turn: {round: 0, activeId: null}, orderIds})).toBeNull();
			// The active creature was removed: fall back to the top of the order.
			expect(getCockpitPrevTurn({turn: {round: 3, activeId: "gone"}, orderIds})).toEqual({round: 3, activeId: "a"});
		});

		test("rail order is highest initiative first; creatures without initiative keep roster order at the bottom", () => {
			const instances = [{id: "a", init: null}, {id: "b", init: 12}, {id: "c", init: 18}, {id: "d", init: null}, {id: "e", init: 12}];
			expect(getCockpitRailOrder({instances, initiativeOf: it => it.init})).toEqual(["c", "b", "e", "a", "d"]);
		});

		test("rail ties follow the turn order's tieOrder, so a group given one initiative stays adjacent", () => {
			const state = {
				instances: [
					{id: "g1", initiative: 16, tieOrder: 1},
					{id: "pc", initiative: 16, tieOrder: 0},
					{id: "g2", initiative: 16, tieOrder: 2},
				],
				groups: [],
			};
			const turnOrder = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
			expect(turnOrder).toEqual(["pc", "g1", "g2"]);
			expect(getCockpitRailOrder({instances: state.instances, initiativeOf: it => it.initiative})).toEqual(turnOrder);
		});

		test("J/K stepping wraps around and starts from an end when nothing is viewed", () => {
			expect(getCockpitStepId(["a", "b", "c"], "c", 1)).toBe("a");
			expect(getCockpitStepId(["a", "b", "c"], "a", -1)).toBe("c");
			expect(getCockpitStepId(["a", "b", "c"], null, -1)).toBe("c");
			expect(getCockpitStepId([], "a", 1)).toBeNull();
		});
	});

	describe("rail rows", () => {
		test("duplicate names are numbered, unique names are not, and an explicit label wins", () => {
			const mk = (id, name, label) => ({id, label, monster: {name}});
			const labels = getCockpitInstanceLabels([mk("1", "Goblin"), mk("2", "Mage"), mk("3", "Goblin"), mk("4", "Goblin", "Boss")]);
			expect([...labels.values()]).toEqual(["Goblin 1", "Mage", "Goblin 2", "Boss"]);
		});

		test("HP state bands match the bar colours", () => {
			expect(getCockpitHpState({current: 10, max: 10}).cls).toBe("is-ok");
			expect(getCockpitHpState({current: 6, max: 10}).cls).toBe("is-hurt");
			expect(getCockpitHpState({current: 5, max: 10}).cls).toBe("is-bloodied");
			expect(getCockpitHpState({current: -3, max: 10})).toEqual({cls: "is-down", word: "Down", fraction: 0});
			expect(getCockpitHpState({current: 5, max: 0}).cls).toBe("is-unknown");
		});

		test("the tally counts per bucket, leaves battlefield-wide effects to the strip, and flags the soonest expiry", () => {
			const tally = getCockpitTally([
				{k: "up", rounds: 3},
				{k: "up", rounds: null},
				{k: "down", rounds: 1},
				{k: "bf", wide: true, rounds: 0},
				{k: "tpl"},
			]);
			expect(tally.parts.map(it => it.text)).toEqual(["▲2", "▼1", "✦", "⏱1r"]);
			expect(tally.parts.at(-1).isSoon).toBe(true);
			expect(tally.count).toBe(4);
			expect(tally.words).toContain("2 buffs");
			expect(getCockpitTally([{k: "bf", wide: true}])).toBeNull();
		});

		test("group chips: custom groups win over shared statblocks, and singletons get no chip", () => {
			const instances = [
				{id: "g1", monster: {name: "Goblin"}},
				{id: "g2", monster: {name: "Goblin"}},
				{id: "g3", monster: {name: "Goblin"}, customGroup: "Flankers"},
				{id: "w1", monster: {name: "Wolf"}, customGroup: "Flankers"},
				{id: "m1", monster: {name: "Mage"}},
			];
			const viewGroups = [{id: "v-gob", memberIds: ["g1", "g2", "g3"]}, {id: "v-wolf", memberIds: ["w1"]}, {id: "v-mage", memberIds: ["m1"]}];
			expect(getCockpitGroupChips({instances, viewGroups})).toEqual([
				{key: "v-gob", name: "Goblin", memberIds: ["g1", "g2"]},
				{key: "custom:Flankers", name: "Flankers", memberIds: ["g3", "w1"]},
			]);
		});
	});

	describe("dock inputs", () => {
		test("amount accepts whole numbers and dice, and explains anything else", () => {
			expect(parseCockpitAmount(" 12 ")).toEqual({ok: true, kind: "fixed", value: 12});
			expect(parseCockpitAmount("2D6 + 3")).toEqual({ok: true, kind: "dice", expr: "2d6+3"});
			expect(parseCockpitAmount("d8-1")).toEqual({ok: true, kind: "dice", expr: "d8-1"});
			expect(parseCockpitAmount("").ok).toBe(false);
			expect(parseCockpitAmount("nc").ok).toBe(false);
			expect(parseCockpitAmount("-4").ok).toBe(false);
			expect(parseCockpitAmount("99999999999999999999").message).toMatch(/too large/);
		});

		test("condition rounds: blank means until removed; zero and fractions are rejected", () => {
			expect(parseCockpitRounds("")).toEqual({ok: true, rounds: null});
			expect(parseCockpitRounds("3")).toEqual({ok: true, rounds: 3});
			expect(parseCockpitRounds("0").ok).toBe(false);
			expect(parseCockpitRounds("1.5").ok).toBe(false);
		});

		test("condition toggles report mixed when only some targets have the condition", () => {
			expect(getCockpitConditionPressed([["Prone"], ["prone "]], "prone")).toBe("true");
			expect(getCockpitConditionPressed([["Prone"], []], "Prone")).toBe("mixed");
			expect(getCockpitConditionPressed([[], []], "Prone")).toBe("false");
		});

		test("exhaustion level comes from conditionDetails, defaults to 1, and is 0 without the condition", () => {
			expect(getCockpitExhaustionLevel({conditions: ["Exhaustion"], conditionDetails: {exhaustion: {level: 3}}})).toBe(3);
			expect(getCockpitExhaustionLevel({conditions: ["exhaustion"]})).toBe(1);
			expect(getCockpitExhaustionLevel({conditions: [], conditionDetails: {exhaustion: {level: 3}}})).toBe(0);
		});
	});
});
