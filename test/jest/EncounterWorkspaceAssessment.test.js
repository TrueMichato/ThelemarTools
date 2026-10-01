import fs from "node:fs";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	getEncounterCrEstimate,
	getEncounterCrInferences,
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
	id, removeIds: [], addOperations: [{id: `patch-${id}-${state.instances.find(it => it.id === id).statblockOperations.length}`, ...BestiaryQuickActionsOperations.patch({set})}],
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
	it("derives all four inputs from edited repeatable attacks, not saved CR or award XP", async () => {
		const state = await makeState();
		const attack = {name: "Blade", entries: ["{@atk mw} {@hit +4} to hit, one target. {@h}5 ({@damage 1d6+2}) slashing damage."]};
		const base = patch(state, "goblin-1", {action: [attack]});
		const original = getEncounterCrInferences(base.instances[0]);
		expect(original.values).toEqual({hp: 7, ac: 15, damageOverThreeRounds: 15, attackType: "attack", attackValue: 4});
		expect(original.missing).toEqual([]);
		const edited = patch(base, "goblin-1", {
			"hp.average": 71,
			ac: [{ac: 13}],
			action: [{name: "Blade", entries: ["{@atk mw} {@hit +6} to hit, one target. {@h}5 ({@damage 2d8+3}) slashing damage."]}],
		});
		const inferred = getEncounterCrInferences(edited.instances[0]);
		expect(inferred.values).toEqual({hp: 71, ac: 13, damageOverThreeRounds: 36, attackType: "attack", attackValue: 6});
		expect(inferred.evidence).toEqual(expect.arrayContaining([expect.stringContaining("3-round damage 36")]));
		expect(getEncounterCrEstimate(inferred.values, rows).cr).not.toBe(getEncounterCrEstimate(original.values, rows).cr);
		expect(getEncounterCrReview(edited.instances[0]).effectiveCr).toBe("1/4");
		expect(getEncounterXpSummary(edited.instances)).toEqual({totalXp: 150n, ratedCount: 3, unknownCount: 0});
	});

	it("sums named mixed multiattacks and notes excluded conditional, recharge, legendary, and area mechanics", async () => {
		const state = await makeState();
		const edited = patch(state, "goblin-1", {
			action: [
				{name: "Multiattack", entries: ["The goblin makes three attacks: two with its claws and one with its bite."]},
				{name: "Claw", entries: ["{@atk mw} {@hit +5} to hit. {@h}7 ({@damage 2d4+2}) slashing damage."]},
				{name: "Bite", entries: ["{@atk mw} {@hit +5} to hit. {@h}10 ({@damage 2d6+3}) piercing damage."]},
				{name: "Blast {@recharge 5}", entries: ["{@atk rs} {@hit +7} to hit. {@h}{@damage 10d6} fire damage."]},
			],
			trait: [{name: "Dive Attack", entries: ["If diving, the claw deals an extra {@damage 3d6} damage."]}],
			legendary: [{name: "Wing Attack", entries: ["The goblin deals {@damage 4d6} damage."]}],
			areaTags: ["C"],
		});
		const inference = getEncounterCrInferences(edited.instances[0]);
		expect(inference.values).toEqual({hp: 7, ac: 15, damageOverThreeRounds: 72, attackType: "attack", attackValue: 5});
		expect(inference.exclusions.join(" ")).toMatch(/recharge/);
		expect(inference.exclusions.join(" ")).toMatch(/legendary/);
		expect(inference.exclusions.join(" ")).toMatch(/Traits/);
		expect(inference.evidence.join(" ")).not.toMatch(/Blast|Dive Attack|Wing Attack/);
	});

	it("infers a single-target save DC but leaves ambiguous, conditional and missing inputs to the DM", async () => {
		const state = await makeState();
		const single = patch(state, "goblin-1", {action: [{
			name: "Mind Lance", entries: ["One creature must make a {@dc 16} Wisdom saving throw, taking 12 ({@damage 3d6+2}) psychic damage on a failed save."],
		}]});
		expect(getEncounterCrInferences(single.instances[0]).values).toEqual({
			hp: 7, ac: 15, damageOverThreeRounds: 36, attackType: "save", attackValue: 16,
		});
		const unknown = patch(state, "goblin-1", {
			hp: {special: "varies"},
			ac: [{ac: 13}, {ac: 17, condition: "with shield"}],
			action: [
				{name: "Multiattack", entries: ["The goblin makes two attacks, choosing weapons each time."]},
				{name: "Burst", entries: ["Each creature in a 30-foot cone makes a {@dc 15} Dexterity saving throw, taking {@damage 6d6} fire damage on a failed save."]},
			],
		});
		const inferred = getEncounterCrInferences(unknown.instances[0]);
		expect(inferred.values).toEqual({hp: null, ac: null, damageOverThreeRounds: null, attackType: "attack", attackValue: null});
		expect(inferred.missing).toEqual(["effective HP", "unconditional AC", "three-round damage", "attack bonus or save DC"]);
		expect(inferred.exclusions).toContain("Multiattack sequence needs DM choice");
	});

	it("counts unconditional dice and flat damage together; rejects ungrounded recharge or alternate multiattacks", async () => {
		const state = await makeState();
		const combined = patch(state, "goblin-1", {action: [{
			name: "Blade", entries: ["{@atk mw} {@hit +4} to hit. {@h}3 ({@damage 1d6+2}) slashing damage plus 4 poison damage."],
		}]});
		expect(getEncounterCrInferences(combined.instances[0]).values.damageOverThreeRounds).toBe(27);
		const recharge = patch(state, "goblin-1", {action: [{
			name: "Blade {@recharge 5}", entries: ["{@atk mw} {@hit +4} to hit. {@h}{@damage 4d6} fire damage."],
		}]});
		expect(getEncounterCrInferences(recharge.instances[0]).missing).toEqual(["three-round damage", "attack bonus or save DC"]);
		const alternative = patch(state, "goblin-1", {action: [
			{name: "Multiattack", entries: ["The goblin makes two attacks with its blade, or uses a spell instead."]},
			{name: "Blade", entries: ["{@atk mw} {@hit +4} to hit. {@h}{@damage 1d6+2} slashing damage."]},
		]});
		expect(getEncounterCrInferences(alternative.instances[0]).values.damageOverThreeRounds).toBeNull();
		const conditional = patch(state, "goblin-1", {action: [{
			name: "Bite", entries: ["{@atk mw} {@hit +4} to hit. {@h}5 piercing damage plus 10 poison damage if the target fails a save."],
		}]});
		expect(getEncounterCrInferences(conditional.instances[0]).missing).toContain("three-round damage");
	});

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
