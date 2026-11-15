import {getCockpitGroupChips} from "../../js/encounterworkspace/cockpit/model.js";
import {
	getCockpitRailItems,
	getCockpitRosterSections,
	getCockpitStackSummary,
	isCockpitRosterMatch,
} from "../../js/encounterworkspace/cockpit/roster-model.js";

const mk = (id, extra = {}) => ({id, monster: {name: extra.name || "Goblin"}, hp: {current: 7, max: 7}, ...extra});

describe("Encounter cockpit roster model", () => {
	const instances = [
		mk("g1", {customGroup: "Goblins"}),
		mk("g2", {customGroup: "Goblins", hp: {current: 3, max: 7}}),
		mk("g3", {customGroup: "Goblins"}),
		mk("w1", {name: "Wolf", customGroup: "Flankers"}),
		mk("m1", {name: "Mage", hp: {current: 20, max: 40}}),
		mk("p1", {name: "Ayla", kind: "party", hp: {current: 30, max: 30}}),
	];
	const byId = new Map(instances.map(it => [it.id, it]));
	const groups = [
		{id: "custom:Goblins", name: "Goblins", kind: "custom", memberIds: ["g1", "g2", "g3"], isStacked: true},
		{id: "custom:Flankers", name: "Flankers", kind: "custom", memberIds: ["w1"], isStacked: false},
	];

	describe("initiative-view stacking", () => {
		test("a stacked group acting back to back collapses into one item at its first member", () => {
			expect(getCockpitRailItems({orderIds: ["p1", "g1", "g2", "g3", "m1"], byId, groups})).toEqual([
				{type: "row", id: "p1"},
				{type: "stack", name: "Goblins", ids: ["g1", "g2", "g3"]},
				{type: "row", id: "m1"},
			]);
		});

		test("an expanded stack shows every member under a collapse header", () => {
			expect(getCockpitRailItems({orderIds: ["g1", "g2", "g3"], byId, groups, stackOpen: new Set(["Goblins"])})).toEqual([
				{type: "stackHead", name: "Goblins", count: 3},
				{type: "row", id: "g1"},
				{type: "row", id: "g2"},
				{type: "row", id: "g3"},
			]);
		});

		test("members split by another creature, unstacked groups, and the defeated stay as rows", () => {
			expect(getCockpitRailItems({orderIds: ["g1", "m1", "g2", "g3"], byId, groups}).map(it => it.type)).toEqual(["row", "row", "row", "row"]);
			const unstacked = groups.map(it => ({...it, isStacked: false}));
			expect(getCockpitRailItems({orderIds: ["g1", "g2", "g3"], byId, groups: unstacked}).map(it => it.type)).toEqual(["row", "row", "row"]);
			const byIdDown = new Map(byId);
			byIdDown.set("g2", {...byId.get("g2"), defeated: true});
			expect(getCockpitRailItems({orderIds: ["g1", "g2", "g3"], byId: byIdDown, groups})).toEqual([
				{type: "stack", name: "Goblins", ids: ["g1", "g3"]},
				{type: "row", id: "g2"},
			]);
		});

		test("a stack needs two live members", () => {
			const byIdDown = new Map(byId);
			["g2", "g3"].forEach(id => byIdDown.set(id, {...byId.get(id), defeated: true}));
			expect(getCockpitRailItems({orderIds: ["g1", "g2", "g3"], byId: byIdDown, groups}).map(it => it.type)).toEqual(["row", "row", "row"]);
		});
	});

	describe("groups-view sections", () => {
		const orderIds = ["p1", "g1", "w1", "g2", "m1", "g3"];
		const labels = new Map([["g1", "Goblin 1"], ["g2", "Goblin 2"], ["g3", "Goblin 3"], ["w1", "Wolf"], ["m1", "Mage"], ["p1", "Ayla"]]);

		test("groups and the party in first-seen order, then Ungrouped last", () => {
			const sections = getCockpitRosterSections({orderIds, byId, groups, labels});
			expect(sections.map(it => [it.name, it.kind, it.ids])).toEqual([
				["Party", "party", ["p1"]],
				["Goblins", "custom", ["g1", "g2", "g3"]],
				["Flankers", "custom", ["w1"]],
				["Ungrouped", "ungrouped", ["m1"]],
			]);
			expect(sections[1].group).toBe(groups[0]);
		});

		test("find keeps a whole group when its name matches, otherwise only matching creatures", () => {
			expect(getCockpitRosterSections({orderIds, byId, groups, labels, query: "flank"}).map(it => it.ids)).toEqual([["w1"]]);
			const sections = getCockpitRosterSections({orderIds, byId, groups, labels, query: "goblin 2"});
			expect(sections.map(it => [it.name, it.ids, it.total])).toEqual([["Goblins", ["g2"], 3]]);
			expect(getCockpitRosterSections({orderIds, byId, groups, labels, query: "nobody"})).toEqual([]);
		});

		test("sort by name or lowest HP within each section", () => {
			const byName = getCockpitRosterSections({orderIds: ["g3", "g1", "g2"], byId, groups, labels, sort: "name"});
			expect(byName[0].ids).toEqual(["g1", "g2", "g3"]);
			const byHp = getCockpitRosterSections({orderIds: ["g1", "g2", "g3"], byId, groups, labels, sort: "hp"});
			expect(byHp[0].ids).toEqual(["g2", "g1", "g3"]);
		});

		test("matches statblock names as well as labels", () => {
			expect(isCockpitRosterMatch("wolf", {label: "Rex", instance: byId.get("w1")})).toBe(true);
			expect(isCockpitRosterMatch("  ", {label: "Rex"})).toBe(true);
			expect(isCockpitRosterMatch("orc", {label: "Rex", instance: byId.get("w1")})).toBe(false);
		});
	});

	test("stack summary sums HP and reports mixed AC and initiative", () => {
		const members = ["g1", "g2", "g3"].map(id => byId.get(id));
		const summary = getCockpitStackSummary(members, {getAc: it => (it.id === "g3" ? 13 : 15), getInit: () => 12, getLabel: it => it.id});
		expect(summary).toMatchObject({hp: 17, hpMax: 21, acs: [15, 13], init: 12, isInitMixed: false});
		expect(summary.minis.map(it => it.cls)).toEqual(["is-ok", "is-bloodied", "is-ok"]);
		const mixed = getCockpitStackSummary(members, {getInit: it => (it.id === "g1" ? 9 : 12)});
		expect(mixed).toMatchObject({init: "…", isInitMixed: true, acs: []});
		expect(getCockpitStackSummary([mk("x", {hp: null})]).hp).toBeNull();
	});

	describe("party chip", () => {
		const viewGroups = list => list.map(it => ({id: `v-${it.id}`, memberIds: [it.id]}));

		test("two or more party members get a leading Party chip", () => {
			const list = [mk("p1", {kind: "party"}), mk("p2", {kind: "party", name: "Bo"}), mk("g1"), mk("g2")];
			const chips = getCockpitGroupChips({instances: list, viewGroups: [{id: "v-p1", memberIds: ["p1"]}, {id: "v-p2", memberIds: ["p2"]}, {id: "v-g", memberIds: ["g1", "g2"]}]});
			expect(chips.map(it => [it.key, it.name, it.memberIds])).toEqual([
				["party", "Party", ["p1", "p2"]],
				["v-g", "Goblin", ["g1", "g2"]],
			]);
		});

		test("reuses a custom group that holds exactly the party instead of duplicating it", () => {
			const list = [mk("g1", {customGroup: "Goblins"}), mk("g2", {customGroup: "Goblins"}), mk("p1", {kind: "party", customGroup: "Party"}), mk("p2", {kind: "party", customGroup: "Party"})];
			expect(getCockpitGroupChips({instances: list, viewGroups: viewGroups(list)}).map(it => it.key)).toEqual(["custom:Party", "custom:Goblins"]);
		});

		test("a lone party member gets no chip", () => {
			const list = [mk("p1", {kind: "party"}), mk("m1")];
			expect(getCockpitGroupChips({instances: list, viewGroups: viewGroups(list)})).toEqual([]);
		});
	});
});
