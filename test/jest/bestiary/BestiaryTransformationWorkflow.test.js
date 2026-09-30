import fs from "node:fs";
import {jest} from "@jest/globals";
import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, MAX_ENCOUNTER_STATBLOCK_OPERATIONS, getEncounterEffectiveMonster, validateEncounterStatblockOperations} from "../../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterHandoffSnapshot} from "../../../js/encounterworkspace/encounterworkspace-handoff.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../../../data/creature-transformations.json", import.meta.url), "utf8"));
const monster = {
	name: "Goblin",
	source: "MM",
	type: "humanoid",
	size: ["S"],
	cr: "1/4",
	hp: {average: 7, formula: "2d6"},
	ac: [{ac: 15}],
	speed: {walk: 30},
	str: 8,
	dex: 14,
	con: 10,
	int: 10,
	wis: 8,
	cha: 8,
	action: [{name: "Bite", entries: ["{@atk mw} {@damage 1d4} piercing damage."]}],
};
const candidates = getCreatureTransformationCandidates({catalog, races: [], getVersions: () => []});
const resolve = (id, selections = {}) => resolveCreatureTransformation({candidates, id, selections});
const target = (id, baseCreature = monster, operations = []) => ({id, label: `Goblin ${id}`, baseCreature, operations});
const ready = (targets, recipe, extras = {}) => previewCreatureTransformationTargets({
	targets,
	resolved: recipe,
	acknowledgedPrerequisites: recipe.prerequisites,
	dmApproved: true,
	...extras,
});
let nextOperationId = 0;
const changes = (batch, decisions = {}) => createCreatureTransformationChanges({
	batch, targets: batch.targets, conflictDecisions: decisions,
}).map((change, ix) => ({
	...change,
	addOperations: change.addOperations.map(operation => ({...operation, id: `recipe-${++nextOperationId}-${ix}`})),
}));
const makeState = ({selectedIds = ["one", "two"], creatures = [monster, monster]} = {}) => EncounterWorkspaceState.validate({
	version: 6,
	sourceList: {name: "Encounter", saveId: "test"},
	instances: creatures.map((creature, ix) => ({
		id: ix ? "two" : "one",
		hash: "goblin_mm",
		monster: creature,
		hp: {current: creature.hp.average, max: creature.hp.average, temp: ix ? 0 : 3},
		initiative: ix ? 10 : 15,
		conditions: [],
		areaNotes: [],
		modifiers: [],
		statblockOperations: [],
	})),
	selectedIds,
	omissions: [],
	groups: [],
	ungroupedIds: [],
	turn: {round: 0, activeId: null},
});

describe("catalog-to-replay transformation adapter", () => {
	it("normalizes every published base and selected option step without losing provenance or manual-review items", () => {
		const seen = new Set();
		for (const candidate of candidates) {
			const required = Object.fromEntries(candidate.optionGroups.filter(it => it.required).map(it => [it.id, [it.options[0].id]]));
			const variants = [required];
			for (const group of candidate.optionGroups) {
				for (const option of group.options) {
					const selected = {...required, [group.id]: [option.id]};
					if (group.appliesTo) selected[group.appliesTo.group] = [group.appliesTo.option];
					variants.push(selected);
				}
			}
			for (const selections of variants) {
				const resolved = resolve(candidate.id, selections);
				const normalized = normalizeCreatureTransformation(resolved);
				expect(normalized).toEqual({...resolved, changes: resolved.changes.map(({op, ...fields}) => ({type: op, ...fields}))});
				expect(normalized.manualReview).toEqual(resolved.manualReview);
				normalized.changes.forEach(it => seen.add(it.type));
				expect(resolved.changes.every(it => Object.hasOwn(it, "op"))).toBe(true);
			}
		}
		expect(seen).toEqual(new Set([
			"setType", "setAbility", "minimumAbility", "maximumAbility", "adjustAbility", "scaleAbility",
			"grantResistance", "grantImmunity", "grantVulnerability", "grantConditionImmunity",
			"grantSense", "grantLanguage", "grantConditionalDefense", "addEntry", "removeEntry",
			"replaceEntry", "replaceDamageType",
		]));
	});

	it("rejects unsupported and malformed complete step shapes rather than dropping edits", () => {
		const recipe = resolve("catalog:skeleton|dmg");
		for (const bad of [
			{op: "grantResistance", value: "fire", extra: "ignored"},
			{op: "grantVulnerability", value: "plasma"},
			{op: "replaceEntry", section: "action", match: {role: "bite", source: "$chassis"}, entry: {name: "Bite", source: "MM", entries: []}, onMissing: "skip"},
			{op: "grantSpeed", mode: "fly", feet: -1},
			{op: "arbitraryPatch", path: "hp.average", value: 100},
		]) expect(() => normalizeCreatureTransformation({...recipe, changes: [bad]})).toThrow(/unsupported catalog transformation step/i);
	});

	it("uses the exact race/species and version IDs and carries grants without pretending prose is executable", () => {
		const races = [
			{name: "Skeleton", source: "BREW", speed: {walk: 0}, vulnerable: ["bludgeoning"], entries: ["Narrative ability"]},
			{name: "Skeleton", source: "UA", darkvision: 120, _versions: [{name: "Skeleton"}]},
		];
		const raceCandidates = getCreatureTransformationCandidates({catalog, races, getVersions: () => [{name: "Skeleton", source: "UA", darkvision: 60}]});
		const base = resolveCreatureTransformation({candidates: raceCandidates, id: "race:skeleton|brew"});
		expect(normalizeCreatureTransformation(base).changes).toEqual(expect.arrayContaining([
			{type: "grantSpeed", mode: "walk", feet: 0},
			{type: "grantVulnerability", value: "bludgeoning"},
		]));
		expect(base.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "traits", reason: expect.stringContaining("not executable")})]));
		const version = resolveCreatureTransformation({candidates: raceCandidates, id: "race:skeleton|ua~v:skeleton|ua:1"});
		expect(version.changes).toEqual(expect.arrayContaining([{op: "grantSense", sense: "darkvision", range: 60}]));
		expect(() => resolveCreatureTransformation({candidates: raceCandidates, id: "race:skeleton|missing"})).toThrow(/unavailable/i);
		expect(ready([target("one")], base).previews[0].preview.proposed.vulnerable).toContain("bludgeoning");
	});
});

describe("stacked and bulk encounter transformations", () => {
	it("requires a per-field winner, retains true before/after statblocks and replays the selected mechanics", () => {
		const skeleton = resolve("catalog:skeleton|dmg");
		const zombie = resolve("catalog:zombie|dmg");
		const first = ready([target("one")], skeleton);
		expect(first.previews[0].preview).toMatchObject({
			current: {type: "humanoid", int: 10},
			proposed: {type: "undead", int: 6, vulnerable: ["bludgeoning"]},
			diff: {fields: expect.arrayContaining([expect.objectContaining({path: "int", before: 10, after: 6})])},
		});
		const [step] = changes(first);
		const pending = ready([target("one", monster, step.addOperations)], zombie);
		expect(pending.previews[0].preview.unresolvedConflicts.map(it => it.path)).toEqual(expect.arrayContaining(["int", "cha"]));
		expect(() => changes(pending)).toThrow(/winner/i);
		const decisions = {one: Object.fromEntries(pending.previews[0].preview.conflicts.map(({path}) => [path, "incoming"]))};
		const approved = ready(pending.targets, zombie, {conflictDecisions: decisions});
		const [second] = changes(approved, decisions);
		const effective = BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [...step.addOperations, ...second.addOperations]});
		expect(effective).toMatchObject({type: "undead", int: 1, vulnerable: ["bludgeoning"]});
		expect(monster.type).toBe("humanoid");
	});

	it("keeps the selected option's eligibility conjunctive and optional missing bite genuinely optional", () => {
		const half = resolve("catalog:half-dragon|mm", {ancestry: ["red"], size: ["huge"]});
		expect(ready([target("one")], half).skipped).toEqual([expect.objectContaining({reason: expect.stringMatching(/eligibility/i)})]);
		const dragon = {...monster,
			name: "Young Red Dragon",
			type: "dragon",
			size: ["L"],
			cr: "6",
			action: [{name: "Fire Breath", entries: ["{@damage 2d6} fire damage."]}]};
		const shadow = resolve("catalog:shadow dragon|mm");
		const batch = ready([target("dragon", dragon)], shadow);
		expect(batch.previews).toHaveLength(1);
		expect(batch.previews[0].preview.proposed.action[0].entries[0]).toContain("necrotic damage");
	});

	it("resolves bulk conflicts per target without requiring a decision on an unchanged target", () => {
		const skeleton = resolve("catalog:skeleton|dmg");
		const zombie = resolve("catalog:zombie|dmg");
		const first = changes(ready([target("one")], skeleton));
		const state = EncounterWorkspaceState.withStatblockChanges(makeState(), first).state;
		const targets = state.instances.map(instance => target(instance.id, instance.monster, instance.statblockOperations));
		const pending = ready(targets, zombie);
		expect(pending.previews.map(it => [it.id, it.preview.conflicts.length])).toEqual([["one", expect.any(Number)], ["two", 0]]);
		expect(pending.previews[0].preview.conflicts.length).toBeGreaterThan(0);
		expect(() => changes(pending)).toThrow(/winner/i);
		const decisions = {one: Object.fromEntries(pending.previews[0].preview.conflicts.map(({path}) => [path, "incoming"]))};
		const approved = ready(targets, zombie, {conflictDecisions: decisions});
		const second = changes(approved, decisions);
		expect(second.map(it => it.addOperations[0].data.conflictDecisions)).toEqual([decisions.one, {}]);
		const result = EncounterWorkspaceState.withStatblockChanges(state, second);
		expect(result.changedIds).toEqual(["one", "two"]);
		expect(result.state.instances.map(it => getEncounterEffectiveMonster(it).int)).toEqual([1, 4]);
		expect(result.state.instances[0].monster.int).toBe(10);
	});

	it("skips a capped target before bulk apply and persists the other eligible transformation in one save", async () => {
		const initial = makeState();
		const fullHistory = Array.from({length: 100}, (_, ix) => ({
			id: `prior-${ix}`,
			type: "patch",
			data: {patch: {set: {dex: 14}}},
		}));
		const state = EncounterWorkspaceState.validate({
			...initial,
			instances: initial.instances.map((instance, ix) => ({
				...instance,
				statblockOperations: ix ? [] : fullHistory,
			})),
		});
		const targets = state.instances.map(instance => target(instance.id, instance.monster, instance.statblockOperations));
		const skeleton = resolve("catalog:skeleton|dmg");
		const prior = ready(targets, skeleton);
		expect(prior.previews).toHaveLength(2);
		expect(() => EncounterWorkspaceState.withStatblockChanges(state, changes(prior))).toThrow(/invalid statblock history/i);
		const batch = ready(targets, skeleton, {
			validateOperation: ({target: item, operation}) => {
				if (item.operations.length >= MAX_ENCOUNTER_STATBLOCK_OPERATIONS) {
					throw new Error(`This monster has reached the ${MAX_ENCOUNTER_STATBLOCK_OPERATIONS}-operation statblock history limit.`);
				}
				validateEncounterStatblockOperations(item.baseCreature, [...item.operations, {...operation, id: "preview-next"}]);
			},
		});
		expect(batch.skipped).toEqual([{id: "one", label: "Goblin one", reason: expect.stringMatching(/100-operation statblock history limit/i)}]);
		expect(batch.previews.map(it => it.id)).toEqual(["two"]);
		const result = EncounterWorkspaceState.withStatblockChanges(state, changes(batch));
		expect(result.changedIds).toEqual(["two"]);
		expect(result.state.instances[0].statblockOperations).toHaveLength(100);
		expect(result.state.instances.map(it => getEncounterEffectiveMonster(it).type)).toEqual(["humanoid", "undead"]);
		const {EncounterWorkspaceStore} = await import("../../../js/encounterworkspace/encounterworkspace-state.js");
		const save = jest.fn(async () => {});
		await new EncounterWorkspaceStore({storage: {pSetForPage: save}}).pSave(result.state);
		expect(save).toHaveBeenCalledTimes(1);
		expect(state.instances[1].statblockOperations).toHaveLength(0);
	});

	it("names an oversized transformation as a skip before it can be saved", () => {
		const recipe = resolve("catalog:skeleton|dmg");
		const oversized = {...recipe, manualReview: [{field: "other", reason: "x".repeat(90_000)}]};
		const batch = ready([target("one")], oversized, {validateOperation: () => {}});
		expect(batch.previews).toHaveLength(0);
		expect(batch.skipped).toEqual([{id: "one", label: "Goblin one", reason: expect.stringMatching(/operation size budget/i)}]);
	});

	it("skips only ineligible targets, fences selection and history, and commits one effective operation per eligible instance", () => {
		const undead = {...monster, type: "undead"};
		const state = makeState({creatures: [monster, undead]});
		const recipe = resolve("catalog:lycanthropy|mm", {form: ["werebear"]});
		const targets = state.instances.map(instance => target(instance.id, instance.monster));
		const batch = ready(targets, recipe);
		expect(batch.skipped).toEqual([{id: "two", label: "Goblin two", reason: expect.stringMatching(/eligibility/i)}]);
		expect(batch.previews.map(it => it.id)).toEqual(["one"]);
		expect(() => createCreatureTransformationChanges({batch, targets: targets.slice(0, 1)})).toThrow(/stale/i);
		expect(() => createCreatureTransformationChanges({batch, targets: [{...targets[0], operations: [{id: "extra"}]}, targets[1]]})).toThrow(/stale/i);
		const result = EncounterWorkspaceState.withStatblockChanges(state, changes(batch));
		expect(result.changedIds).toEqual(["one"]);
		expect(result.state.instances.map(it => getEncounterEffectiveMonster(it).str)).toEqual([19, 8]);
		expect(result.state.instances[0].monster.str).toBe(8);
		const handoff = getEncounterHandoffSnapshot({state: result.state, id: "handoff", createdAt: "2026-01-01T00:00:00Z"});
		expect(handoff.version).toBe(1);
		expect(handoff.entries[0].monster.str).toBe(19);
	});

	it("previews HP resets and shared-turn splits and leaves saved encounter unchanged on an atomic write failure", async () => {
		let state = makeState();
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["one", "two"], id: "pair"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "pair", isShared: true, total: 14});
		const before = structuredClone(state);
		const recipe = resolve("catalog:skeleton|dmg");
		const batch = ready([target("one")], recipe);
		const [change] = changes(batch);
		change.addOperations.unshift({id: "hp-first", type: "patch", data: {patch: {set: {"hp.average": 11}}}});
		const result = EncounterWorkspaceState.withStatblockChanges(state, [change]);
		expect(result).toMatchObject({changedIds: ["one"], resetHpIds: ["one"], splitIds: ["one"]});
		expect(result.state.instances[0].hp).toEqual({current: 11, max: 11, temp: 3});
		expect(result.state.instances[0].initiative).toBe(15);
		expect(result.state.groups[0]).toMatchObject({memberIds: ["two"], sharedTurn: true, initiative: 14});
		const {EncounterWorkspaceStore} = await import("../../../js/encounterworkspace/encounterworkspace-state.js");
		const save = jest.fn(async () => { throw new Error("Storage full"); });
		await expect(new EncounterWorkspaceStore({storage: {pSetForPage: save}}).pSave(result.state)).rejects.toThrow("Storage full");
		expect(save).toHaveBeenCalledTimes(1);
		expect(state).toEqual(before);
	});
});
