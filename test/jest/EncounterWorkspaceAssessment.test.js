import fs from "node:fs";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	getEncounterCrEstimate,
	getEncounterCrReview,
	getEncounterMonsterXp,
	getEncounterXpSummary,
} from "../../js/encounterworkspace/encounterworkspace-assessment.js";

const rows = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
const monster = {
	name: "Goblin",
	source: "MM",
	cr: "1/4",
	hp: {average: 7, formula: "2d6"},
	ac: [{ac: 15}],
	action: [{name: "Blade", entries: ["{@damage 1d6+2}"]}],
};

const makeState = async () => {
	let id = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Test encounter", saveId: "test", items: [{h: "goblin_mm", c: 3}]},
		pResolveItem: async () => ({entity: monster}),
		fnUid: () => `goblin-${++id}`,
	});
};

const patch = (state, id, set) => EncounterWorkspaceState.withStatblockChanges(state, [{
	id, removeIds: [], addOperations: [{id: `patch-${id}`, ...BestiaryQuickActionsOperations.patch({set})}],
}]).state;

describe("Encounter Workspace award XP", () => {
	it("counts effective transformed monsters individually and restores their totals after reload", async () => {
		const original = await makeState();
		expect(getEncounterXpSummary(original.instances)).toEqual({totalXp: 150n, ratedCount: 3, unknownCount: 0});
		const changed = EncounterWorkspaceState.withStatblockChanges(original, [{
			id: "goblin-1", removeIds: [], addOperations: [{id: "minion", ...BestiaryQuickActionsOperations.minion()}],
		}]).state;
		const edited = patch(changed, "goblin-2", {cr: {cr: "0", xp: 0}});
		expect(edited.instances.map(it => getEncounterMonsterXp(it.monster))).toEqual([50, 50, 50]);
		expect(edited.instances.map(it => getEncounterMonsterXp(getEncounterEffectiveMonster(it)))).toEqual([10, 0, 50]);
		expect(getEncounterXpSummary(edited.instances)).toEqual({totalXp: 60n, ratedCount: 3, unknownCount: 0});
		const storage = new Map();
		const store = new EncounterWorkspaceStore({storage: {
			pSetForPage: async (key, value) => storage.set(key, value),
			pGetForPage: async key => storage.get(key),
		}});
		await store.pSave(edited);
		expect(getEncounterXpSummary((await store.pLoad()).instances)).toEqual({totalXp: 60n, ratedCount: 3, unknownCount: 0});
	});

	it("keeps custom XP and CR 0 (including zero XP) separate from missing, invalid and overflow values", () => {
		expect(getEncounterMonsterXp({cr: "0"})).toBe(10);
		expect(getEncounterMonsterXp({cr: {cr: "0", xp: 0}})).toBe(0);
		expect(getEncounterMonsterXp({cr: {cr: "Unknown", xp: 123}})).toBe(123);
		for (const cr of ["Unknown", "99", null, {cr: "1/4", xp: -1}, {cr: "1/4", xp: "50"}, {cr: "1/4", xp: null}]) {
			expect(getEncounterMonsterXp({cr})).toBeNull();
		}
		const instances = [
			{monster: {cr: {cr: "Unknown", xp: Number.MAX_SAFE_INTEGER}}, statblockOperations: []},
			{monster: {cr: {cr: "Unknown", xp: Number.MAX_SAFE_INTEGER}}, statblockOperations: []},
			{monster: {cr: "Unknown"}, statblockOperations: []},
		];
		expect(getEncounterXpSummary(instances)).toEqual({
			totalXp: 2n * BigInt(Number.MAX_SAFE_INTEGER), ratedCount: 2, unknownCount: 1,
		});
	});
});

describe("Encounter Workspace guided 2014 CR assessment", () => {
	it("compares original and effective mechanics, separates text notes, and exposes transformation review", async () => {
		const state = await makeState();
		const edited = patch(state, "goblin-1", {
			"hp.average": 71,
			cr: {cr: "2", xp: 0},
			trait: [{name: "Stone Hide", entries: ["Hard to hurt."]}],
			legendaryGroup: {name: "The Cave", source: "MM"},
		});
		edited.instances[0].areaNotes = [{id: "note", kind: "lair", name: "Fog", description: "Text only"}];
		const review = getEncounterCrReview(edited.instances[0]);
		expect(review).toMatchObject({
			baselineCr: "1/4",
			effectiveCr: "2",
			baselineHp: 7,
			effectiveHp: 71,
			changes: expect.arrayContaining(["CR / XP", "HP", "Traits", "Lair-action group"]),
			changeDetails: expect.arrayContaining(["Traits (Stone Hide)", "Lair-action group (The Cave)"]),
			areaNotes: ["Lair note: Fog"],
			manualReview: [],
		});
	});

	it("flags mechanical area traits and lair groups for DM review without assigning them a numeric bonus", async () => {
		const state = await makeState();
		const area = EncounterWorkspaceState.withStatblockChanges(state, [{
			id: "goblin-1",
			removeIds: [],
			addOperations: [{
				id: "mist",
				...BestiaryQuickActionsOperations.applyAreaTrait({
					trait: {name: "Choking Mist", source: "MM"},
					area: "Cavern",
					entry: {name: "Choking Mist", entries: ["The mist deals damage at the DM's discretion."]},
				}),
			}],
		}]).state;
		const withLair = EncounterWorkspaceState.withStatblockChanges(area, [{
			id: "goblin-1",
			removeIds: [],
			addOperations: [{
				id: "lair",
				...BestiaryQuickActionsOperations.setLegendaryGroup({
					name: "Cavern", source: "MM", lairActions: ["The walls shake."],
				}),
			}],
		}]).state;
		const review = getEncounterCrReview(withLair.instances[0]);
		expect(review.changes).toEqual(expect.arrayContaining(["Traits", "Lair-action group"]));
		expect(review.effectiveCr).toBe(review.baselineCr);
		expect(getEncounterXpSummary(withLair.instances)).toEqual({totalXp: 150n, ratedCount: 3, unknownCount: 0});
	});

	it("uses the 2014 HP/AC and three-round damage/attack or save DC rows without inferring a trait bonus", () => {
		const baseline = getEncounterCrEstimate({hp: 7, ac: 15, damageOverThreeRounds: 12, attackValue: 4, attackType: "attack"}, rows);
		expect(baseline).toEqual({cr: "1/4", defensiveCr: "1/4", offensiveCr: "1/4", dpr: 4});
		const withExtraDamage = getEncounterCrEstimate({hp: 7, ac: 15, damageOverThreeRounds: 120, attackValue: 6, attackType: "attack"}, rows);
		expect(withExtraDamage).toMatchObject({cr: "3", defensiveCr: "1/4", offensiveCr: "6", dpr: 40});
		expect(getEncounterCrEstimate({hp: 1, ac: 13, damageOverThreeRounds: 0, attackValue: 13, attackType: "save"}, rows))
			.toEqual({cr: "0", defensiveCr: "0", offensiveCr: "0", dpr: 0});
		expect(getEncounterCrEstimate({hp: 760, ac: 19, damageOverThreeRounds: 0, attackValue: 3, attackType: "attack"}, rows).defensiveCr)
			.toBe("29");
	});

	it("rejects absent, fractional, out-of-range or malformed assumptions rather than claiming a CR", () => {
		const valid = {hp: 7, ac: 15, damageOverThreeRounds: 12, attackValue: 4, attackType: "attack"};
		for (const [field, value] of [
			["hp", NaN], ["hp", 0], ["hp", 851], ["ac", 14.5],
			["damageOverThreeRounds", -1], ["damageOverThreeRounds", 961],
			["attackValue", Infinity], ["attackType", "unknown"],
		]) {
			expect(() => getEncounterCrEstimate({...valid, [field]: value}, rows)).toThrow();
		}
		expect(() => getEncounterCrEstimate(valid, [])).toThrow(/reference table/);
	});
});
