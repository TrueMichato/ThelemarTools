import {
	BestiaryQuickActionsEngine,
	BestiaryQuickActionsOperations,
	BestiaryQuickActionsRegistry,
	BestiaryQuickActionsUtil,
} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {BestiaryCreatureTransformation, CreatureTransformationError} from "../../../js/bestiary/bestiary-creature-transformation.js";

const getCreature = () => ({
	name: "Young Brass Dragon",
	source: "MM",
	type: "dragon",
	size: ["L"],
	cr: "6",
	str: 19,
	dex: 10,
	con: 17,
	int: 12,
	wis: 11,
	cha: 15,
	speed: {walk: 40},
	trait: [{name: "Keen Smell", entries: ["The dragon has a keen sense of smell."]}],
	action: [
		{name: "Bite", entries: ["{@atk mw} {@h} {@damage 2d10} piercing damage."]},
		{name: "Fire Breath", entries: ["The target takes {@damage 3d6} fire damage."]},
	],
});

const getRecipe = (id, changes, overrides = {}) => ({
	id: `catalog:${id}|tst`,
	kind: "catalog",
	identity: {name: id, source: "TST"},
	provenance: {edition: "classic", page: 12},
	eligibility: [{types: ["dragon"], minCr: 1}],
	prerequisites: [],
	selectedOptions: {},
	changes,
	manualReview: [],
	...overrides,
});

const preview = (monster, operations, resolved, extras = {}) => BestiaryQuickActionsEngine.previewCreatureTransformation({monster, operations, resolved, ...extras});
const commit = (monster, operations, proposal, conflictDecisions = {}) => BestiaryQuickActionsEngine.createCreatureTransformationOperation({
	monster,
	operations,
	preview: proposal,
	conflictDecisions,
});

describe("resolved creature transformation preview and replay", () => {
	it("requires an explicit winner for each overlapping write, and replays the selected result from saved plain data", () => {
		const monster = getCreature();
		const original = structuredClone(monster);
		const first = commit(monster, [], preview(monster, [], getRecipe("A", [
			{type: "setAbility", ability: "str", value: 22},
			{type: "grantLanguage", value: "Draconic"},
		])));
		first.id = "first";
		const secondRecipe = getRecipe("B", [
			{type: "adjustAbility", ability: "str", amount: 2, floor: 1},
			{type: "grantResistance", value: "fire"},
		]);
		const unchosen = preview(monster, [first], secondRecipe);
		expect(unchosen).toMatchObject({
			original,
			current: {str: 22, languages: ["Draconic"]},
			proposed: {str: 22, resist: ["fire"]},
			canApply: false,
			unresolvedConflicts: [{path: "str", existing: 22, incoming: 24, previousOperationId: "first"}],
			diff: {fields: [{path: "resist", before: null, after: ["fire"]}]},
		});
		expect(() => commit(monster, [first], unchosen)).toThrow(/unresolved conflicts/i);
		const decisions = {str: "incoming"};
		const chosen = preview(monster, [first], secondRecipe, {conflictDecisions: decisions});
		const second = commit(monster, [first], chosen, decisions);
		expect(second.data).toMatchObject({
			resolved: {id: "catalog:B|tst", selectedOptions: {}, provenance: {edition: "classic"}, changes: secondRecipe.changes},
			conflictDecisions: decisions,
			manualReview: [],
		});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: JSON.parse(JSON.stringify([first, second]))})).toMatchObject({
			str: 24,
			languages: ["Draconic"],
			resist: ["fire"],
		});
		expect(monster).toEqual(original);
		expect(secondRecipe).toEqual(getRecipe("B", secondRecipe.changes));

		const keepExisting = {str: "existing"};
		const keepPreview = preview(monster, [first], secondRecipe, {conflictDecisions: keepExisting});
		const keep = commit(monster, [first], keepPreview, keepExisting);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [first, keep]}).str).toBe(22);
	});

	it("retains source-qualified same-name entries, and reports entry additions and removals separately from fields", () => {
		const monster = getCreature();
		monster.trait.push({name: "Shapechange", source: "TST", entries: ["First version."]});
		monster.trait.push({name: "Shapechange", source: "MM", entries: ["Second version."]});
		const resolved = getRecipe("Shape", [
			{type: "removeEntry", section: "trait", match: {name: "Shapechange", source: "TST"}},
			{type: "addEntry", section: "trait", entry: {name: "Shapechange", source: "ABC", entries: ["A third source."]}},
			{type: "replaceEntry", section: "action", match: {name: "Bite", source: "$chassis"}, entry: {name: "Bite", source: "$chassis", entries: ["New bite."]}, onMissing: "error"},
		]);
		const draft = preview(monster, [], resolved);
		expect(draft.canApply).toBe(true);
		expect(draft.diff.entries).toEqual(expect.arrayContaining([
			expect.objectContaining({section: "trait", source: "TST", after: null}),
			expect.objectContaining({section: "trait", source: "ABC", before: null}),
			expect.objectContaining({section: "action", name: "Bite", after: expect.objectContaining({entries: ["New bite."]})}),
		]));
		const applied = BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [commit(monster, [], draft)]});
		expect(applied.trait.filter(it => it.name === "Shapechange").map(it => it.source)).toEqual(["MM", "ABC"]);
		expect(applied.action[0].entries).toEqual(["New bite."]);
		expect(monster.action[0].entries[0]).toContain("piercing");
	});

	it("resolves bounded conditional defenses and exact role-based damage changes without replacing unrelated prose", () => {
		const monster = getCreature();
		const changes = [
			{type: "grantConditionalDefense", kind: "resistance", value: "bludgeoning", when: "nonmagicalUnsilvered"},
			{type: "replaceDamageType", section: "action", match: {role: "breathWeapon", source: "$chassis"}, from: ["fire"], to: "cold", onMissing: "error"},
			{type: "grantSense", sense: "darkvision", range: 60},
			{type: "grantSpeed", mode: "fly", feet: 40},
		];
		const operation = commit(monster, [], preview(monster, [], getRecipe("Cold", changes)));
		const applied = BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [operation]});
		expect(applied.resist).toEqual([{resist: ["bludgeoning"], note: "from nonmagical attacks that aren't silvered"}]);
		expect(applied.action[1].entries).toEqual(["The target takes {@damage 3d6} cold damage."]);
		expect(applied.action[0].entries).toEqual(monster.action[0].entries);
		expect(applied.senses).toEqual(["darkvision 60 ft."]);
		expect(applied.speed).toEqual({walk: 40, fly: 40});
	});

	it("keeps preview-only changes unapplied, re-previews after history removal/reordering and rejects stale commits", () => {
		const monster = getCreature();
		const first = commit(monster, [], preview(monster, [], getRecipe("First", [{type: "setAbility", ability: "str", value: 22}])));
		first.id = "first";
		const secondRecipe = getRecipe("Second", [{type: "setAbility", ability: "str", value: 24}]);
		const pending = preview(monster, [first], secondRecipe);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster}).str).toBe(19);
		expect(() => commit(monster, [first, BestiaryQuickActionsOperations.patch({set: {wis: 14}})], pending, {str: "incoming"})).toThrow(/stale/i);
		const decisions = {str: "incoming"};
		const second = commit(monster, [first], preview(monster, [first], secondRecipe, {conflictDecisions: decisions}), decisions);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: monster, operation: first});
		const secondId = registry.addOperation({creature: monster, operation: second});
		expect(registry.getCreature({creature: monster}).str).toBe(24);
		expect(registry.removeOperation({creature: monster, operationId: first.id})).toBe(true);
		expect(registry.getCreature({creature: monster}).str).toBe(24);
		expect(registry.removeOperation({creature: monster, operationId: secondId})).toBe(true);
		expect(registry.getCreature({creature: monster}).str).toBe(19);
		const rePreviewed = preview(monster, [second], getRecipe("Third", [{type: "setAbility", ability: "str", value: 25}]));
		expect(rePreviewed.conflicts).toHaveLength(1);
		expect(preview(monster, [], secondRecipe).conflicts).toHaveLength(0);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [second, first]})).toThrow(/re-preview the history/i);
		expect(preview(monster, [second], getRecipe("First", [{type: "setAbility", ability: "str", value: 22}])).conflicts).toHaveLength(1);
		const independent = commit(monster, [], preview(monster, [], getRecipe("Independent", [{type: "grantLanguage", value: "Draconic"}])));
		expect(preview(monster, [independent, second], getRecipe("Next", [{type: "grantSense", sense: "darkvision", range: 30}])).canApply).toBe(true);
	});

	it("requires explicit acknowledgement for narrative prerequisites and approval where specified, retaining manual-review flags", () => {
		const monster = getCreature();
		const resolved = getRecipe("Approval", [{type: "minimumAbility", ability: "wis", value: 13}], {
			eligibility: [{types: ["dragon"], dmApproval: true}],
			prerequisites: ["DM confirms the ritual was completed."],
			manualReview: [{field: "hp", reason: "Recalculate hit points for the chosen form."}],
			selectedOptions: {form: ["alternate"]},
		});
		expect(() => preview(monster, [], resolved)).toThrow(/prerequisites/i);
		expect(() => preview(monster, [], resolved, {acknowledgedPrerequisites: resolved.prerequisites})).toThrow(/eligib/i);
		const draft = preview(monster, [], resolved, {acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
		expect(draft.proposed.wis).toBe(13);
		expect(draft.manualReview).toEqual(resolved.manualReview);
		const operation = BestiaryQuickActionsOperations.applyCreatureTransformation({
			baseCreature: monster,
			preview: draft,
			acknowledgedPrerequisites: resolved.prerequisites,
			dmApproved: true,
		});
		expect(operation.data.manualReview).toEqual(resolved.manualReview);
		expect(operation.data.resolved.selectedOptions).toEqual({form: ["alternate"]});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [operation]}).wis).toBe(13);
		expect(() => preview(monster, [], {...resolved, eligibility: [{minInt: 13}], prerequisites: []})).toThrow(/eligib/i);
	});

	it("tracks conflicting named-entry removals and retains harmless no-op writes within a recipe", () => {
		const monster = getCreature();
		const firstRecipe = getRecipe("Added", [
			{type: "addEntry", section: "trait", entry: {name: "Blessed", source: "TST", entries: ["A granted trait."]}},
		]);
		const first = commit(monster, [], preview(monster, [], firstRecipe));
		first.id = "added";
		const resolved = getRecipe("Removed", [
			{type: "removeEntry", section: "trait", match: {name: "Blessed", source: "TST"}},
			{type: "minimumAbility", ability: "str", value: 18},
		]);
		const draft = preview(monster, [first], resolved);
		expect(draft.conflicts).toEqual([expect.objectContaining({path: "trait:blessed|tst", previousOperationId: "added", incoming: null})]);
		const decision = {"trait:blessed|tst": "incoming"};
		const second = commit(monster, [first], preview(monster, [first], resolved, {conflictDecisions: decision}), decision);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [first, second]}).trait).toEqual(monster.trait);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [second]})).toThrow(/matched 0 entries/i);
		const repeated = getRecipe("Repeat", [
			{type: "setAbility", ability: "str", value: 20},
			{type: "adjustAbility", ability: "str", amount: 2, floor: 1},
		]);
		const repeatPreview = preview(monster, [], repeated);
		expect(repeatPreview.proposed.str).toBe(22);
		expect(repeatPreview.writes).toEqual([expect.objectContaining({path: "str", before: 19, after: 22})]);
		expect(repeatPreview.conflicts).toHaveLength(0);
	});

	it("keeps conflict receipts stable when a registry assigns operation IDs after preview", () => {
		const monster = getCreature();
		const first = commit(monster, [], preview(monster, [], getRecipe("A", [{type: "setAbility", ability: "str", value: 20}])));
		const secondRecipe = getRecipe("B", [{type: "setAbility", ability: "str", value: 21}]);
		const chosen = {str: "incoming"};
		const second = commit(monster, [first], preview(monster, [first], secondRecipe, {conflictDecisions: chosen}), chosen);
		const thirdRecipe = getRecipe("C", [{type: "setAbility", ability: "str", value: 22}]);
		const third = commit(monster, [first, second], preview(monster, [first, second], thirdRecipe, {conflictDecisions: chosen}), chosen);
		first.id = "assigned-first";
		second.id = "assigned-second";
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [first, second, third]}).str).toBe(22);
	});

	it("allows only explicitly optional entry replacements, while damage replacement still requires one named match", () => {
		const monster = getCreature();
		delete monster.bonus;
		const optional = getRecipe("Optional", [
			{type: "replaceEntry", section: "action", match: {name: "Healing Touch", source: "$chassis"}, entry: {name: "Healing Touch", source: "TST", entries: ["Replaced."]}, onMissing: "skip"},
			{type: "replaceDamageType", section: "action", match: {role: "bite", source: "$chassis"}, from: ["fire"], to: "cold", onMissing: "skip"},
		]);
		expect(preview(monster, [], optional).proposed).toEqual(monster);
		expect(preview(monster, [], {...optional, changes: [{...optional.changes[0], section: "bonus"}]}).proposed).not.toHaveProperty("bonus");
		expect(() => preview(monster, [], {...optional, changes: [{...optional.changes[0], onMissing: "error"}]})).toThrow(/matched 0 entries/i);
		expect(() => preview(monster, [], {...optional, changes: [{...optional.changes[1], match: {name: "None", source: "$chassis"}}]})).toThrow(/matched 0 entries/i);
		const duplicate = {...monster, action: [...monster.action, structuredClone(monster.action[0])]};
		expect(() => preview(duplicate, [], optional)).toThrow(/matched 2 entries/i);
	});

	it("does not normalize numeric speed on a no-op and rejects nonintegral or overflowing ability scores", () => {
		const monster = {...getCreature(), speed: 30};
		const noOp = preview(monster, [], getRecipe("Noop", [{type: "grantSpeed", mode: "walk", feet: 20}]));
		expect(noOp.proposed.speed).toBe(30);
		expect(noOp.diff.fields).toEqual([]);
		expect(preview(monster, [], getRecipe("Faster", [{type: "grantSpeed", mode: "walk", feet: 40}])).proposed.speed).toBe(40);
		expect(() => preview(monster, [], getRecipe("Fraction", [{type: "setAbility", ability: "str", value: 18.5}]))).toThrow(/safe integer/i);
		expect(() => preview(monster, [], getRecipe("Overflow", [{type: "adjustAbility", ability: "str", amount: Number.MAX_SAFE_INTEGER, floor: 1}]))).toThrow(/invalid str score/i);
	});

	it("rejects unsupported operations, unsafe keys, missing/duplicate selectors, and forged conflict decisions", () => {
		const monster = getCreature();
		const getDraft = changes => preview(monster, [], getRecipe("Negative", changes));
		expect(() => getDraft([{type: "patch", path: "__proto__.foo", value: true}])).toThrow(/unsupported transformation change/i);
		expect(() => getDraft([{type: "setAbility", ability: "constructor", value: 20}])).toThrow(/unsupported ability/i);
		expect(() => getDraft([{type: "removeEntry", section: "action", match: {name: "No Bite", source: "$chassis"}}])).toThrow(/matched 0 entries/i);
		expect(() => getDraft([{type: "addEntry", section: "action", entry: {name: "Bite", source: "MM", entries: ["duplicate"]}}])).toThrow(/duplicate entry/i);
		expect(() => getDraft([{type: "grantConditionalDefense", kind: "immunity", value: "cold", when: "arbitrary prose"}])).toThrow(/unsupported conditional defense/i);
		const duplicate = {...monster, action: [...monster.action, structuredClone(monster.action[0])]};
		expect(() => preview(duplicate, [], getRecipe("Ambiguous", [{type: "removeEntry", section: "action", match: {role: "bite", source: "$chassis"}}]))).toThrow(/matched 2 entries/i);
		const unsafe = getRecipe("Unsafe", [{type: "setType", value: "dragon"}]);
		Object.defineProperty(unsafe.changes[0], "__proto__", {value: {polluted: true}, enumerable: true});
		expect(() => preview(monster, [], unsafe)).toThrow(/unsafe transformation property/i);
		expect({}.polluted).toBeUndefined();
		const first = commit(monster, [], getDraft([{type: "setAbility", ability: "str", value: 22}]));
		const decisions = {str: "incoming"};
		const chosen = preview(monster, [first], getRecipe("Second", [{type: "setAbility", ability: "str", value: 24}]), {conflictDecisions: decisions});
		expect(() => commit(monster, [first], chosen, {str: "wrong"})).toThrow(/invalid winner/i);
		const op = commit(monster, [first], chosen, decisions);
		op.data.conflictDecisions.str = "existing";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [first, op]})).toThrow(CreatureTransformationError);
	});

	it("rejects an oversized serialized recipe instead of exceeding the Encounter operation budget", () => {
		const monster = getCreature();
		const resolved = getRecipe("Large", [], {manualReview: [{field: "other", reason: "x".repeat(BestiaryCreatureTransformation.MAX_OPERATION_BYTES)}]});
		const draft = preview(monster, [], resolved);
		expect(() => commit(monster, [], draft)).toThrow(/size budget/i);
	});
});
