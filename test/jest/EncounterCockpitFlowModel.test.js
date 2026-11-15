import "../../js/parser.js";
import "../../js/utils.js";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterCombatSummary} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {
	FLOW_TIMELINE_ROUNDS,
	getFlowEndModel,
	getFlowGroupNameSuggestion,
	getFlowLogHeight,
	getFlowLogModel,
	getFlowNewIds,
	getFlowPlainText,
	getFlowReorderDir,
	getFlowReorderDrop,
	getFlowReorderStep,
	getFlowReorderText,
	getFlowTimelineModel,
	getFlowTimelineSpans,
} from "../../js/encounterworkspace/cockpit/features/flow-model.js";
import {pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const lane = (id, spans = []) => ({id, label: id, hp: 7, hpMax: 7, ac: 15, conc: null, spans});

describe("Encounter Cockpit flow — timeline", () => {
	it("windows four rounds from the previous round and places the playhead on the active creature", () => {
		const model = getFlowTimelineModel({round: 3, activeId: "b", lanes: [lane("a"), lane("b")]});
		expect(model.r0).toBe(2);
		expect(model.axis.map(it => it.round)).toEqual([2, 3, 4, 5]);
		expect(model.axis.find(it => it.isNow).round).toBe(3);
		// Round 3 is one round past r0 (25%) plus half a round step for index 1 of 2 (12.5%).
		expect(model.nowLeft).toBe(37.5);
		expect(model.lanes.map(it => it.isTurn)).toEqual([false, true]);
		const a = model.lanes[0].dots;
		expect(a.find(it => it.round === 2).isDone).toBe(true);
		expect(a.find(it => it.round === 3).isDone).toBe(true);
		expect(model.lanes[1].dots.find(it => it.round === 3).isNow).toBe(true);
		expect(model.lanes[1].dots.find(it => it.round === 4).isDone).toBe(false);
	});

	it("draws spans from their start to the round they expire, clipping ongoing or long effects", () => {
		const model = getFlowTimelineModel({
			round: 1,
			activeId: "a",
			lanes: [lane("a", [
				{key: "bless", label: "Bless", k: "up", rounds: 1, start: 1},
				{key: "hex", label: "Hex", k: "down", rounds: null, start: 1},
				{key: "long", label: "Long", k: "up", rounds: 10, start: 1},
			])],
		});
		const [bless, hex, long] = model.lanes[0].spans;
		expect(bless).toMatchObject({left: 0, width: 25, isClip: false, bottom: 6});
		expect(hex).toMatchObject({left: 0, width: 100, isClip: true, bottom: 23});
		expect(long.isClip).toBe(true);
		expect(long.width).toBe(100);
		expect(model.lanes[0].minHeight).toBe(38 + 2 * 17 + 6);
	});

	it("keeps very short spans visible and handles an encounter that has not started", () => {
		const model = getFlowTimelineModel({round: 0, activeId: null, lanes: [lane("a", [{key: "x", label: "X", k: "cond", rounds: 0}])]});
		expect(model.nowLeft).toBe(0);
		expect(model.lanes[0].isTurn).toBe(false);
		expect(model.lanes[0].dots.some(it => it.isDone || it.isNow)).toBe(false);
		expect(model.lanes[0].spans[0].width).toBe(3);
		expect(model.roundsShown).toBe(FLOW_TIMELINE_ROUNDS);
	});

	it("turns effects and conditions into spans, without templates or the concentrating condition", () => {
		const instance = {
			effects: [{id: "e1", startRound: 2}],
			conditions: ["poisoned", "concentrating"],
			conditionDetails: {poisoned: {rounds: 3}},
		};
		const spans = getFlowTimelineSpans(instance, {
			round: 3,
			effectItems: [
				{k: "up", label: "Bless", rounds: 4, id: "e1", source: "effect"},
				{k: "tpl", label: "Young", rounds: null, id: "t1", source: "template"},
				{k: "bf", label: "Fog", rounds: null, id: "b1", source: "battlefield"},
			],
		});
		expect(spans.map(it => it.label)).toEqual(["Bless", "Fog", "Poisoned"]);
		expect(spans[0]).toMatchObject({start: 2, rounds: 4, k: "up"});
		expect(spans[1]).toMatchObject({start: 3, rounds: null});
		expect(spans[2]).toMatchObject({k: "cond", rounds: 3});
	});
});

describe("Encounter Cockpit flow — log", () => {
	const log = [
		{id: "1", round: 0, kind: "roll", text: "Initiative 14"},
		{id: "2", round: 1, kind: "turn", text: "Round 1 · Goblin 1's turn"},
		{id: "3", round: 1, kind: "damage", text: "Goblin 1 takes 5 {@damage fire|phb} damage"},
		{id: "4", round: 2, kind: "turn", text: "Round 2 · Goblin 1's turn"},
	];

	it("adds a separator whenever the round changes and strips 5etools tags", () => {
		const model = getFlowLogModel(log);
		expect(model.rows.map(it => it.type)).toEqual(["round", "entry", "round", "entry", "entry", "round", "entry"]);
		expect(model.rows[0].label).toBe("Before combat");
		expect(model.rows[2].label).toBe("Round 1");
		expect(model.rows[4].text).toBe("Goblin 1 takes 5 fire damage");
		expect(model.latest).toEqual({round: 2, kind: "turn", text: "Round 2 · Goblin 1's turn"});
		expect(model.count).toBe(4);
	});

	it("filters by kind but keeps the latest line from the whole log", () => {
		const model = getFlowLogModel(log, {filter: "damage"});
		expect(model.rows.filter(it => it.type === "entry").map(it => it.id)).toEqual(["3"]);
		expect(model.count).toBe(1);
		expect(model.total).toBe(4);
		expect(model.latest.round).toBe(2);
		expect(getFlowLogModel([], {filter: "rolls"})).toEqual({rows: [], count: 0, total: 0, latest: null});
	});

	it("strips tags without a display part and clamps the drawer height", () => {
		expect(getFlowPlainText("Cast {@spell bless} on {@creature goblin|mm|the goblin}{@b}")).toBe("Cast bless on goblin");
		expect(getFlowLogHeight(50, 800)).toBe(120);
		expect(getFlowLogHeight(900, 800)).toBe(480);
		expect(getFlowLogHeight(300, 800)).toBe(300);
	});
});

describe("Encounter Cockpit flow — turn order", () => {
	const order = ["a", "b", "c"];

	it("steps one place earlier or later and refuses to leave the ends", () => {
		expect(getFlowReorderStep(order, "b", -1)).toEqual({id: "b", beforeId: "a"});
		expect(getFlowReorderStep(order, "b", 1)).toEqual({id: "b", beforeId: null});
		expect(getFlowReorderStep(order, "a", 1)).toEqual({id: "a", beforeId: "c"});
		expect(getFlowReorderStep(order, "a", -1)).toBeNull();
		expect(getFlowReorderStep(order, "c", 1)).toBeNull();
		expect(getFlowReorderStep(order, "z", 1)).toBeNull();
	});

	it("turns a drop onto a row into a move, ignoring drops that change nothing", () => {
		expect(getFlowReorderDrop(order, "c", "a")).toEqual({id: "c", beforeId: "a"});
		expect(getFlowReorderDrop(order, "a", "c", {isAfter: true})).toEqual({id: "a", beforeId: null});
		expect(getFlowReorderDrop(order, "a", "b")).toBeNull();
		expect(getFlowReorderDrop(order, "b", "a", {isAfter: true})).toBeNull();
		expect(getFlowReorderDrop(order, "a", "a")).toBeNull();
		expect(getFlowReorderDrop(order, "a", "zz")).toBeNull();
	});

	it("applies to real state and reports the initiative numbers that changed", async () => {
		let state = await pGetCockpitState([["Goblin", 3]]);
		const [a, b, c] = state.instances.map(it => it.id);
		[[a, 15], [b, 12], [c, 8]].forEach(([id, total]) => { state = EncounterWorkspaceState.withInitiative(state, {id, total}); });
		const before = EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
		const move = getFlowReorderStep(before, c, -1);
		const {state: next, changes} = EncounterWorkspaceState.withInitiativeReorder(state, move);
		const after = EncounterWorkspaceState.getInitiativeOrder(next).map(it => it.id);
		expect(after).toEqual([a, c, b]);
		const dir = getFlowReorderDir(before, after, c);
		expect(dir).toBe(-1);
		const labels = new Map([[a, "Goblin 1"], [b, "Goblin 2"], [c, "Goblin 3"]]);
		const text = getFlowReorderText({label: "Goblin 3", entryId: c, changes, labels, dir});
		expect(text).toMatch(/^Goblin 3 moved earlier — initiative 8 → \d+/);
		expect(getFlowReorderText({label: "Goblin 3", entryId: c, changes: [], labels})).toBe("Goblin 3 is already there.");
	});
});

describe("Encounter Cockpit flow — groups and end of combat", () => {
	const getName = it => it.name;

	it("suggests a plural for one kind of creature, otherwise the next free Group n", () => {
		expect(getFlowGroupNameSuggestion([{name: "Goblin"}, {name: "Goblin"}], {getName})).toBe("Goblins");
		expect(getFlowGroupNameSuggestion([{name: "Goblin"}, {name: "Goblin"}], {getName, existing: ["goblins"]})).toBe("Goblins 2");
		expect(getFlowGroupNameSuggestion([{name: "Goblin"}, {name: "Orc"}], {getName, existing: ["Group 1"]})).toBe("Group 2");
		expect(getFlowGroupNameSuggestion([{name: "Wolf"}], {getName, getPlural: () => "Wolves"})).toBe("Wolf");
		expect(getFlowNewIds(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
	});

	it("summarises a real encounter for the end dialog", async () => {
		const state = await pGetCockpitState([["Goblin", 2], ["Orc", 1]]);
		state.instances[0].hp.current = 0;
		state.turn = {round: 3, activeId: state.instances[1].id};
		const labels = new Map(state.instances.map((it, i) => [it.id, `${it.monster.name} ${i + 1}`]));
		const model = getFlowEndModel(getEncounterCombatSummary(state, {labels}));
		expect(model.tiles.map(it => it.value)).toEqual(["3", "1/3", "50"]);
		expect(model.tiles[2].label).toBe("XP total");
		expect(model.defeated[0].text).toBe("Goblin 1 · 50 XP");
		expect(model.remaining).toEqual(["Goblin 2", "Orc 3"]);
		expect(model.foot).toMatch(/no party members/);
		expect(model.canAward).toBe(true);
	});

	it("splits XP across the party", () => {
		const model = getFlowEndModel({name: "Fight", rounds: 2, defeated: [{id: "x", label: "Orc", xp: 100}], remaining: [], xp: 100, unratedCount: 1, party: [{id: "p", label: "Ana", hp: 0, hpMax: 10, down: true}, {id: "q", label: "Bo", hp: 4, hpMax: 9, down: false}], perMember: 50});
		expect(model.tiles[2]).toEqual({key: "xp", label: "XP per player", value: "50"});
		expect(model.foot).toBe("100 XP split 2 ways");
		expect(model.party.map(it => it.text)).toEqual(["Ana · down", "Bo · 4/9 HP"]);
		expect(model.note).toBe("1 defeated creature had no XP value.");
	});
});
