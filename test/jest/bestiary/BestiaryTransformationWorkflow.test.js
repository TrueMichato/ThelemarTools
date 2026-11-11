import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
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

describe("staged M2a Zombie numerical boundary", () => {
	const monsters = JSON.parse(fs.readFileSync(new URL("../../../data/bestiary/bestiary-mm.json", import.meta.url), "utf8")).monster;
	const scout = monsters.find(it => it.name === "Scout" && it.source === "MM");
	const knight = monsters.find(it => it.name === "Knight" && it.source === "MM");
	const staged = () => resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
	const stage = (targets, extras = {}) => ready(targets, staged(), extras);

	it("reconciles the actual sourced CON and mental changes without applying another monster's chassis or later milestones", () => {
		const source = JSON.parse(fs.readFileSync(new URL("../../../data/book/book-dmg.json", import.meta.url), "utf8"));
		const rows = [];
		const visit = value => {
			if (!value || typeof value !== "object") return;
			if (value.caption === "NPC Features") rows.push(...value.rows);
			Object.values(value).forEach(part => typeof part === "object" && visit(part));
		};
		visit(source);
		expect(rows.find(row => row[0] === "Zombie")[1]).toBe("+1 Str, +2 Con, -6 Int, -4 Wis, -4 Cha");
		const batch = stage([target("one", scout), target("two", knight)]);
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed).toMatchObject({
			str: 12,
			con: 14,
			int: 5,
			wis: 9,
			cha: 7,
			hp: {average: 19, formula: "3d8 + 6"},
			skill: {nature: "+1", perception: "+3", stealth: "+6", survival: "+3"},
			passive: 13,
		});
		expect(batch.previews[1].preview.proposed).toMatchObject({
			con: 16, hp: {average: 60, formula: "8d8 + 24"}, save: {con: "+5", wis: "+0"}, passive: 8,
		});
		for (const {id, preview} of batch.previews) {
			const source = id === "one" ? scout : knight;
			for (const field of ["ac", "action", "bonus", "reaction", "legendary", "spellcasting", "cr", "profBonus", "languages"]) expect(preview.proposed[field]).toEqual(source[field]);
			expect(preview.manualReview).toContainEqual(expect.objectContaining({reason: expect.stringMatching(/Numeric-only stage.*not complete Zombie/i)}));
			expect(preview.manualReview.some(it => it.field === "ac" || it.field === "attacks")).toBe(true);
			expect(preview.proposed.trait?.some(it => it.name === "Undead Fortitude") || false).toBe(false);
		}
	});

	it("compiles from each target's actual history and freezes concrete numeric replay through save and removal", () => {
		const prior = [{id: "prior-con", type: "patch", data: {patch: {set: {con: 16, hp: {average: 22, formula: "3d8 + 9"}}}}}];
		const targets = [target("one", scout, prior), target("two", knight)];
		const localCatalog = structuredClone(catalog);
		const localCandidates = getCreatureTransformationCandidates({catalog: localCatalog, races: []});
		const recipe = resolveCreatureTransformation({candidates: localCandidates, id: "catalog:zombie|dmg", automationVersion: 2});
		const batch = ready(targets, recipe);
		const edits = changes(batch);
		const expected = batch.previews.map(it => it.preview.proposed);
		expect(expected[0]).toMatchObject({con: 18, hp: {average: 25, formula: "3d8 + 12"}});
		expect(expected[1]).toMatchObject({con: 16, hp: {average: 60, formula: "8d8 + 24"}});
		const operations = JSON.parse(JSON.stringify([...prior, ...edits[0].addOperations]));
		expect(operations[1].data.resolved).not.toHaveProperty("automation");
		expect(operations[1].data.resolved.changes).toContainEqual({type: "setHitPoints", value: {average: 25, formula: "3d8 + 12"}});
		expect(operations[1].data.resolved.changes.some(it => it.type === "adjustAbility")).toBe(false);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: scout, operations})).toEqual(expected[0]);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: scout, operation: prior[0]});
		const id = registry.addOperation({creature: scout, operation: operations[1]});
		expect(registry.getCreature({creature: scout})).toEqual(expected[0]);
		registry.removeOperation({creature: scout, operationId: id});
		expect(registry.getCreature({creature: scout})).toMatchObject({con: 16, hp: {average: 22, formula: "3d8 + 9"}});
		let state = makeState({creatures: [scout, knight]});
		state = EncounterWorkspaceState.withStatblockChanges(state, [{id: "one", addOperations: prior, removeIds: []}]).state;
		state = EncounterWorkspaceState.withStatblockChanges(state, edits).state;
		const saved = JSON.stringify(state);
		localCatalog.creatureTransformation.length = 0;
		localCandidates.length = 0;
		recipe.automation.hitPoints = "changed";
		const reloaded = EncounterWorkspaceState.validate(JSON.parse(saved));
		expect(reloaded.instances.map(it => getEncounterEffectiveMonster(it))).toEqual(expected);
		const removed = EncounterWorkspaceState.withStatblockChanges(reloaded, edits.map(it => ({id: it.id, addOperations: [], removeIds: it.addOperations.map(op => op.id)}))).state;
		expect(removed.instances.map(it => getEncounterEffectiveMonster(it))).toEqual([BestiaryQuickActionsUtil.applyOperations({baseCreature: scout, operations: prior}), knight]);
		expect(() => createCreatureTransformationChanges({batch, targets: [{...targets[0], operations: []}, targets[1]]})).toThrow(/stale/i);
	});

	it.each([
		[{hp: {special: "variable"}}, /HP needs/],
		[{hp: {average: 20, formula: "3d8 + 3"}}, /average disagrees/],
		[{skill: {perception: "+5 + PB"}}, /skill.perception/],
		[{con: 29}, /output score/],
		[{passive: "15 + PB"}, /Passive Perception/],
	])("skips unsupported arithmetic %# explicitly with no partial operation and no cross-target leakage", (patch, reason) => {
		const batch = stage([target("one", {...scout, ...patch}), target("two", knight)]);
		expect(batch.previews.map(it => it.id)).toEqual(["two"]);
		expect(batch.skipped).toEqual([expect.objectContaining({id: "one", reason: expect.stringMatching(reason)})]);
		expect(changes(batch).map(it => it.id)).toEqual(["two"]);
	});

	it("treats dependent numerical conflicts as one coherent unit and retains old consent, storage and stale-input guards", () => {
		const priorRecipe = {...resolve("catalog:zombie|dmg"), eligibility: [], changes: [{op: "setAbility", ability: "con", value: 16}]};
		const starting = {...scout, hp: {average: 22, formula: "3d8 + 9"}};
		const prior = changes(ready([target("one", starting)], priorRecipe))[0].addOperations;
		const targets = [target("one", starting, prior)];
		const pending = stage(targets);
		expect(pending.previews[0].preview.conflicts.map(it => it.path)).toEqual(["con"]);
		expect(pending.previews[0].preview.proposed).toMatchObject({con: 16, hp: starting.hp, wis: scout.wis, passive: scout.passive});
		expect(() => changes(pending)).toThrow(/winner/i);
		const incoming = stage(targets, {conflictDecisions: {one: {con: "incoming"}}});
		expect(incoming.previews[0].preview.proposed).toMatchObject({con: 18, hp: {average: 25, formula: "3d8 + 12"}});
		expect(changes(incoming, {one: {con: "incoming"}})).toHaveLength(1);
		const retained = stage(targets, {conflictDecisions: {one: {con: "existing"}}});
		expect(retained.previews[0].preview.proposed).toMatchObject({con: 16, hp: starting.hp, wis: scout.wis, passive: scout.passive});
		const retainedOp = changes(retained, {one: {con: "existing"}})[0].addOperations[0];
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: starting, operations: [...prior, retainedOp]})).toEqual(retained.previews[0].preview.proposed);
		const bothRecipe = {...priorRecipe, changes: [...priorRecipe.changes, {op: "setAbility", ability: "wis", value: 11}]};
		const bothPrior = changes(ready([target("one", starting)], bothRecipe))[0].addOperations;
		const mixed = stage([target("one", starting, bothPrior)], {conflictDecisions: {one: {con: "existing", wis: "incoming"}}});
		expect(mixed.previews).toEqual([]);
		expect(mixed.skipped[0].reason).toMatch(/one conflict winner/);
		expect(changes(mixed)).toEqual([]);
		const noConsent = ready([target("one", scout)], staged(), {dmApproved: false});
		expect(noConsent.previews).toEqual([]);
		expect(noConsent.skipped[0].reason).toMatch(/DM approval/i);
		const capped = stage([target("one", scout)], {validateOperation: () => { throw new Error("Target storage limit."); }});
		expect(capped.previews).toEqual([]);
		const batch = stage([target("one", scout)]);
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, automationInputs: {one: {proficiencyBonus: 3}}})).toThrow(/stale.*input/i);
		expect(() => ready([target("one", scout)], batch.previews[0].preview.resolved)).toThrow(/snapshot/i);
		const saved = changes(batch)[0].addOperations[0];
		saved.data.resolved.changes.find(it => it.type === "setHitPoints").value.average++;
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: scout, operations: [saved]})).toThrow(/changed/i);
	});

	it("retains frozen pre-M2a Zombie operations verbatim rather than silently upgrading their numbers", () => {
		const batch = ready([target("one", scout)], resolve("catalog:zombie|dmg"));
		const saved = JSON.parse(JSON.stringify(changes(batch)[0].addOperations[0]));
		const result = BestiaryQuickActionsUtil.applyOperations({baseCreature: scout, operations: [saved]});
		expect(saved.data.resolved).not.toHaveProperty("version");
		expect(saved.data.resolved.changes.some(it => it.type === "setHitPoints")).toBe(false);
		expect(result.con).toBe(14);
		expect(result.hp).toEqual(scout.hp);
		expect(result.skill).toEqual(scout.skill);
		expect(result.passive).toBe(scout.passive);
	});
});

describe("staged Dracolich compilation", () => {
	const dragons = JSON.parse(fs.readFileSync(new URL("../../../data/bestiary/bestiary-mm.json", import.meta.url), "utf8")).monster;
	const green = dragons.find(it => it.name === "Adult Green Dragon" && it.source === "MM");
	const blue = dragons.find(it => it.name === "Adult Blue Dragon" && it.source === "MM");
	const inputs = {age: "adult", trueDragon: true, shadowDragon: false, physiology: "amphibious-only", lairActions: "retain"};
	const resolveStaged = () => resolveCreatureTransformation({candidates, id: "catalog:dracolich|mm", automationVersion: 2});
	const stage = (targets, extras = {}) => ready(targets, resolveStaged(), {
		automationInputs: Object.fromEntries(targets.map(it => [it.id, {...inputs}])),
		...extras,
	});

	it("compiles actual source-granted rules and retains the real adult dragon chassis", () => {
		const batch = stage([target("one", green), target("two", blue)]);
		expect(batch.skipped).toEqual([]);
		expect(batch.previews).toHaveLength(2);
		for (const {id, preview} of batch.previews) {
			const original = id === "one" ? green : blue;
			expect(preview.proposed.trait).toContainEqual({
				name: "Magic Resistance", source: "MM", entries: ["The dracolich has advantage on saving throws against spells and other magical effects."],
			});
			expect(preview.proposed.trait).toContainEqual({
				name: "Undead Nature", source: "MM", entries: ["The dracolich needs no air, food, drink, or sleep."],
			});
			expect(preview.proposed).toMatchObject({
				type: "undead",
				resist: expect.arrayContaining(["necrotic"]),
				immune: expect.arrayContaining(["poison"]),
				conditionImmune: expect.arrayContaining(["charmed", "frightened", "paralyzed", "poisoned", "exhaustion"]),
				hp: original.hp,
				ac: original.ac,
				action: original.action,
				legendary: original.legendary,
			});
			expect(preview.proposed.immune).toEqual(expect.arrayContaining(original.immune));
			expect(preview.proposed.legendaryGroup).toEqual(original.legendaryGroup);
			expect(preview.proposed.cr).toEqual(original.cr);
		}
	});

	it("removes only the target's actual Amphibious trait without leaking removals to another dragon", () => {
		const batch = stage([target("one", green), target("two", blue)]);
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed.trait.some(it => it.name === "Amphibious")).toBe(false);
		expect(batch.previews[0].preview.diff.entries).toContainEqual(expect.objectContaining({name: "Amphibious", after: null}));
		expect(batch.previews[1].preview.diff.entries.filter(it => it.after === null)).toEqual([]);
		expect(batch.previews[0].preview.proposed.trait).toContainEqual(green.trait.find(it => it.name === "Legendary Resistance (3/Day)"));
		expect(green.trait.some(it => it.name === "Amphibious")).toBe(true);
	});

	it("freezes concrete operations through Bestiary replay, Encounter JSON reload and actual operation removal", () => {
		const localCatalog = structuredClone(catalog);
		const localCandidates = getCreatureTransformationCandidates({catalog: localCatalog, races: []});
		const recipe = resolveCreatureTransformation({candidates: localCandidates, id: "catalog:dracolich|mm", automationVersion: 2});
		const targets = [target("one", green), target("two", blue)];
		const batch = ready(targets, recipe, {automationInputs: {one: {...inputs}, two: {...inputs}}});
		const edits = changes(batch);
		const expected = batch.previews.map(it => it.preview.proposed);
		for (const edit of edits) {
			const operation = edit.addOperations[0];
			expect(operation.data.resolved.version).toBe(2);
			expect(operation.data.resolved).not.toHaveProperty("automation");
			expect(operation.data.resolved).not.toHaveProperty("profile");
			expect(operation.data.resolved.selectedOptions["automation-nature"]).toEqual(["true-dragon", "not-shadow"]);
			expect(() => validateEncounterStatblockOperations(targets.find(it => it.id === edit.id).baseCreature, edit.addOperations)).not.toThrow();
		}
		const state = makeState({creatures: [green, blue]});
		const applied = EncounterWorkspaceState.withStatblockChanges(state, edits).state;
		const json = JSON.stringify(applied);
		recipe.automation.changes[0].entry.entries[0] = "Changed after save.";
		localCandidates.find(it => it.id === recipe.id).automation.changes[0].entry.entries[0] = "Changed in live catalog.";
		localCandidates.length = 0;
		localCatalog.creatureTransformation.length = 0;
		const reloaded = EncounterWorkspaceState.validate(JSON.parse(json));
		expect(reloaded.instances.map(it => getEncounterEffectiveMonster(it))).toEqual(expected);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: green, operations: JSON.parse(JSON.stringify(edits[0].addOperations))})).toEqual(expected[0]);
		const registry = new BestiaryQuickActionsRegistry();
		const operationId = registry.addOperation({creature: green, operation: JSON.parse(JSON.stringify(edits[0].addOperations[0]))});
		expect(registry.getCreature({creature: green})).toEqual(expected[0]);
		expect(registry.removeOperation({creature: green, operationId})).toBe(true);
		expect(registry.getCreature({creature: green})).toEqual(green);
		const removed = EncounterWorkspaceState.withStatblockChanges(reloaded, edits.map(it => ({
			id: it.id, addOperations: [], removeIds: it.addOperations.map(operation => operation.id),
		}))).state;
		expect(removed.instances.map(it => getEncounterEffectiveMonster(it))).toEqual([green, blue]);
		expect(state.instances.every(it => it.statblockOperations.length === 0)).toBe(true);
	});

	it.each([
		["missing confirmations", {}, green, /confirm/i],
		["young dragon", {...inputs, age: "young"}, dragons.find(it => it.name === "Young Red Dragon" && it.source === "MM"), /adult or ancient/i],
		["non-true dragon", {...inputs, trueDragon: false}, dragons.find(it => it.name === "Dragon Turtle" && it.source === "MM"), /true dragon/i],
		["shadow dragon", {...inputs, shadowDragon: true}, blue, /shadow dragon/i],
		["additional physiology", {...inputs, physiology: "additional"}, green, /physiology/i],
		["changed lair", {...inputs, lairActions: "change"}, green, /lair/i],
		["non-dragon chassis", inputs, monster, /living true dragon/i],
	])("does not save a partial success for %s", (_label, decisions, creature, reason) => {
		const batch = stage([target("one", creature)], {automationInputs: {one: decisions}});
		expect(batch.previews).toEqual([]);
		expect(batch.skipped).toEqual([expect.objectContaining({id: "one", reason: expect.stringMatching(reason)})]);
		expect(changes(batch)).toEqual([]);
	});

	it("uses actual prior history for eligibility and rejects ambiguous source-qualified physiology", () => {
		const shadow = changes(ready([target("one", green)], resolve("catalog:shadow dragon|mm")))[0].addOperations;
		const ambiguous = structuredClone(green);
		ambiguous.trait.push({...ambiguous.trait.find(it => it.name === "Amphibious"), source: "TST"});
		const batch = stage([target("one", green, shadow), target("two", ambiguous), target("three", blue)]);
		expect(batch.previews.map(it => it.id)).toEqual(["three"]);
		expect(batch.skipped).toEqual([
			expect.objectContaining({id: "one", reason: expect.stringMatching(/shadow dragon/i)}),
			expect.objectContaining({id: "two", reason: expect.stringMatching(/multiple traits/i)}),
		]);
		expect(changes(batch).map(it => it.id)).toEqual(["three"]);
	});

	it("compiles from current traits with original-chassis source semantics and accepts explicit ancient eligibility", () => {
		const current = structuredClone(green);
		current.source = "TST";
		current.type = {type: "dragon", tags: ["original-tag"]};
		const prior = [{id: "prior-source", type: "patch", data: {patch: {set: {source: current.source, type: current.type}}}}];
		const batch = stage([target("one", green, prior)]);
		const compiled = batch.previews[0].preview.resolved;
		expect(compiled.changes).toContainEqual({type: "removeEntry", section: "trait", match: {name: "Amphibious", source: "MM"}});
		expect(batch.previews[0].preview.proposed.type).toBe("undead");
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: green, operations: [...prior, ...changes(batch)[0].addOperations]})).toEqual(batch.previews[0].preview.proposed);
		const ancient = dragons.find(it => it.name === "Ancient Blue Dragon" && it.source === "MM");
		const ancientBatch = stage([target("one", ancient)], {automationInputs: {one: {...inputs, age: "ancient"}}});
		expect(ancientBatch.previews[0].preview.resolved.selectedOptions["automation-age"]).toEqual(["ancient"]);
		expect(ancientBatch.previews[0].preview.proposed.type).toBe("undead");
	});

	it("fences staged source/decision/history changes and requires real consent", () => {
		const targets = [target("one", green)];
		const recipe = resolveStaged();
		expect(() => ready(targets, recipe, {automationInputs: {one: inputs}, acknowledgedPrerequisites: []})).toThrow(/prerequisite/i);
		const unapproved = ready(targets, recipe, {automationInputs: {one: inputs}, dmApproved: false});
		expect(unapproved.previews).toEqual([]);
		expect(unapproved.skipped[0].reason).toMatch(/DM approval/i);
		expect(changes(unapproved)).toEqual([]);
		expect(() => normalizeCreatureTransformation(recipe)).toThrow(/compiled/i);
		const batch = stage(targets);
		expect(() => ready(targets, batch.previews[0].preview.resolved)).toThrow(/snapshot/i);
		const changedRecipe = structuredClone(recipe);
		changedRecipe.automation.changes[0].entry.entries[0] = "Changed source rule.";
		expect(() => createCreatureTransformationChanges({batch, targets, resolved: changedRecipe})).toThrow(/stale/i);
		expect(() => createCreatureTransformationChanges({batch, targets, automationInputs: {one: {...inputs, age: "ancient"}}})).toThrow(/stale/i);
		expect(() => createCreatureTransformationChanges({batch, targets: [{...targets[0], operations: [{id: "new-history"}]}]})).toThrow(/stale/i);
	});

	it("retains conflict decisions and target-specific storage preflight for staged operations", () => {
		const starting = {...green, type: "beast"};
		const priorRecipe = {...resolve("catalog:dracolich|mm"),
			id: "catalog:prior-type|tst",
			identity: {name: "Prior Type", source: "TST"},
			eligibility: [],
			changes: [{op: "setType", value: "dragon"}]};
		const prior = changes(ready([target("one", starting)], priorRecipe))[0].addOperations;
		const targets = [target("one", starting, prior), target("two", blue)];
		const pending = stage(targets);
		expect(pending.previews[0].preview.conflicts).toHaveLength(1);
		expect(() => changes(pending)).toThrow(/winner/i);
		const decisions = {one: Object.fromEntries(pending.previews[0].preview.conflicts.map(({path}) => [path, "incoming"]))};
		const approved = stage(targets, {conflictDecisions: decisions});
		const approvedEdits = changes(approved, decisions);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: starting, operations: [...prior, ...approvedEdits[0].addOperations]})).toEqual(approved.previews[0].preview.proposed);
		const capped = stage(targets, {
			conflictDecisions: decisions,
			validateOperation: ({target: item, operation}) => {
				if (item.id === "one") throw new Error("Target storage limit.");
				validateEncounterStatblockOperations(item.baseCreature, [{...operation, id: "preflight"}]);
			},
		});
		expect(capped.skipped).toEqual([expect.objectContaining({id: "one", reason: "Target storage limit."})]);
		expect(changes(capped, decisions).map(it => it.id)).toEqual(["two"]);
	});

	it("rejects malformed concrete-v2 profiles and tampered saved data while leaving unexpected failures hard", () => {
		const batch = stage([target("one", green)]);
		const compiled = batch.previews[0].preview.resolved;
		for (const changed of [
			{...compiled, version: 3},
			{...compiled, version: "2"},
			{...compiled, identity: {...compiled.identity, source: "TST"}},
			{...compiled, automation: resolveStaged().automation},
			{...compiled, selectedOptions: {}},
			{...compiled, changes: compiled.changes.filter(it => it.type !== "addEntry")},
			{...compiled, changes: [...compiled.changes, {type: "adjustAbility", ability: "str", amount: 1, floor: 1}]},
			{...compiled, changes: [...compiled.changes, {type: "setHitPoints", value: {average: 1, formula: "1d8"}}]},
		]) {
			expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({
				baseCreature: green, operations: [], resolved: changed, acknowledgedPrerequisites: changed.prerequisites, dmApproved: true,
			})).toThrow();
		}
		const operation = changes(batch)[0].addOperations[0];
		for (const mutate of [
			saved => saved.data.resolved.version = 3,
			saved => saved.data.resolved.selectedOptions["automation-age"][0] = "ancient",
			saved => saved.data.resolved.changes.find(it => it.type === "addEntry").entry.entries[0] = "Tampered rule.",
			saved => saved.data.sourceUid = "another dragon|mm",
		]) {
			const saved = structuredClone(operation);
			mutate(saved);
			expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: green, operations: [saved]})).toThrow(/changed|another creature/i);
		}
		const fault = jest.spyOn(BestiaryQuickActionsUtil, "applyOperations").mockImplementation(() => { throw new TypeError("Unexpected compiler dependency failure"); });
		try {
			expect(() => stage([target("one", green)])).toThrow("Unexpected compiler dependency failure");
		} finally { fault.mockRestore(); }
	});

	it("leaves old incomplete Dracolich and breathless Half-Dragon operations unchanged on reload", () => {
		const dracolich = ready([target("one", green)], resolve("catalog:dracolich|mm"));
		const halfDragon = ready([target("two", monster)], resolve("catalog:half-dragon|mm", {ancestry: ["red"], size: ["large-or-smaller"]}));
		for (const [batch, original] of [[dracolich, green], [halfDragon, monster]]) {
			const operation = changes(batch)[0].addOperations[0];
			expect(operation.data.resolved).not.toHaveProperty("version");
			expect(operation.data.resolved).not.toHaveProperty("automation");
			const restored = BestiaryQuickActionsUtil.applyOperations({baseCreature: original, operations: [JSON.parse(JSON.stringify(operation))]});
			expect(restored).toEqual(batch.previews[0].preview.proposed);
			expect(restored.trait?.some(it => it.name === "Magic Resistance") || false).toBe(false);
			if (original === green) expect(restored.trait.some(it => it.name === "Amphibious")).toBe(true);
			else expect(restored.action).toEqual(original.action);
		}
	});
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
		expect(base.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "traits", reason: expect.stringContaining("not added")})]));
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
