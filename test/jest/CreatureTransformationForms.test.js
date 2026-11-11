import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {compileCreatureTransformationStats} from "../../js/creature-transformation-stats.js";
import {estimateCreatureTransformationCr} from "../../js/creature-transformation-cr.js";
import {assertFrozenCreatureTransformation, createFrozenCreatureTransformation} from "../../js/creature-transformation-forms.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsOperations, BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationFormChanges, previewCreatureTransformationForm} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors} from "../util-creature-transformation-schema.js";

const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const table = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
const schema = JSON.parse(fs.readFileSync("schema/site/creature-transformation.json", "utf8"));
const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/frozenFormResolved"});
const monster = () => ({
	name: "Frozen form kernel fixture",
	source: "MM",
	type: "humanoid",
	size: ["M"],
	cr: "1",
	hp: {average: 33, formula: "6d8 + 6"},
	ac: [13],
	profBonus: 2,
	str: 15,
	dex: 12,
	con: 12,
	int: 10,
	wis: 10,
	cha: 8,
	save: {con: "+3"},
	skill: {perception: "+2"},
	passive: 12,
	action: [{name: "Claw", entries: ["{@hit +4} to hit. 5 ({@damage 1d6 + 2}) slashing damage."]}],
});
const pending = () => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:zombie|dmg", automationVersion: 2,
});
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});

// Kernel-only synthetic profiles, NOT source-defined Zombie forms or a new catalog producer.
function kernelLeaf (current, {str, con, ac, cr}) {
	const root = compileCreatureTransformation({resolved: pending(), current});
	const rating = estimateCreatureTransformationCr({
		current: {...current, hp: {average: con === 14 ? 39 : 45}, ac: [ac]},
		table,
		assumptions: {
			defense: {expectedCr: "1", hpBoundary: null, acIndex: 0, acAdjustment: 0, hpAdjustment: 0, resistance: "none", vulnerability: false, regeneration: 0, note: "Kernel defense fixture."},
			routines: [{id: "kernel", rounds: [8, 8, 8].map(value => ({value, proficiency: 0})), accuracy: {kind: "attack", value: 4, proficiency: 1}, note: "Kernel routine fixture."}],
			routine: "kernel",
			review: "Synthetic kernel fixture, not authored family rules.",
			override: {cr, reason: "Kernel fixture override."},
			zeroXp: false,
			proficiencyAnswer: null,
		},
	});
	const stats = compileCreatureTransformationStats({current, abilities: {str, con}, hp: {mode: "constitution"}});
	return {
		...root,
		selectedOptions: {"automation-numerics": ["zombie-dmg-m2a"], "automation-bindings": ["zombie-dmg-m2b"], "automation-cr": ["zombie-dmg-m3"]},
		changes: [
			...root.changes.filter(step => !["setAbility", "setHitPoints", "setSaveBonus", "setSkillBonus", "setPassivePerception"].includes(step.op)),
			...stats, {op: "setProficiencyBonus", value: rating.receipt.proficiency.after},
			{op: "setArmorClass", value: [ac]},
			{op: "setEntryNumbers", section: "action", match: {name: "Claw", source: "MM"}, entries: [`{@hit +${str === 16 ? 5 : 6}} to hit. ${str === 16 ? 6 : 7} ({@damage 1d6 + ${str === 16 ? 3 : 4}}) slashing damage. Kernel rider ${ac}.`]},
			rating,
		],
	};
}

function bundle (baseCreature, operations = [], activeForm = "test-a") {
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature, operations});
	return createFrozenCreatureTransformation({
		activeForm,
		baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature, operations}),
		profiles: [
			{id: "test-a", label: "Kernel fixture A", resolved: kernelLeaf(current, {str: 16, con: 14, ac: 14, cr: "2"})},
			{id: "test-b", label: "Kernel fixture B", resolved: kernelLeaf(current, {str: 18, con: 16, ac: 17, cr: "5"})},
		],
	});
}

function operation (baseCreature, operations = [], resolved = normalizeCreatureTransformation(bundle(baseCreature, operations)), id = "form-owner", winner = "incoming") {
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature, operations, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
	const conflictDecisions = Object.fromEntries(preview.conflicts.map(it => [it.path, winner]));
	const chosen = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature, operations, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions});
	return {id, ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature, operations, preview: chosen, conflictDecisions})};
}

function withdrawalOwner (baseCreature) {
	const resolved = bundle(baseCreature);
	const leaf = kernelLeaf(baseCreature, {str: baseCreature.str, con: 16, ac: 17, cr: "5"});
	leaf.changes = leaf.changes.filter(it => it.op !== "setAbility" || it.ability !== "str");
	leaf.changes.find(it => it.op === "setEntryNumbers").entries = structuredClone(baseCreature.action[0].entries);
	resolved.frozenForms.profiles[1].resolved = leaf;
	return operation(baseCreature, [], normalizeCreatureTransformation(resolved));
}

const target = (baseCreature, operations) => ({id: "one", label: "Kernel target", baseCreature, operations});
function switchForm (baseCreature, operations, formId) {
	const current = target(baseCreature, operations);
	const first = previewCreatureTransformationForm({target: current, operationId: "form-owner", formId});
	const conflictDecisions = Object.fromEntries((first.preview?.conflicts || []).map(it => [it.path, "incoming"]));
	const batch = previewCreatureTransformationForm({target: current, operationId: "form-owner", formId, conflictDecisions});
	return {batch, changes: createCreatureTransformationFormChanges({batch, target: current})};
}

async function encounter (baseCreature) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Kernel fixtures", saveId: "kernel", items: [{h: "kernel_mm", c: 2}]},
		pResolveItem: async () => ({entity: baseCreature}),
		fnUid: () => ++ix === 1 ? "one" : "two",
	});
}

function persistence (initial) {
	let state = initial;
	const values = new Map();
	const storage = {pGetForPage: jest.fn(async key => values.get(key)), pSetForPage: jest.fn(async (key, value) => values.set(key, JSON.parse(JSON.stringify(value))))};
	const store = new EncounterWorkspaceStore({storage});
	const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async result => { state = await store.pSave(result.state); }});
	return {adapter, store, storage, state: () => state, reload: async () => { state = await store.pLoad(); }};
}

describe("frozen transformation form kernel (no source-defined family forms)", () => {
	it("keeps the schema/runtime closed, finite, nonrecursive and exact on the active same-root projection", () => {
		const resolved = bundle(monster());
		validate(resolved);
		expect(validate.errors).toBeNull();
		expect(() => assertFrozenCreatureTransformation(normalizeCreatureTransformation(resolved))).not.toThrow();
		const cases = [
			value => { value.frozenForms.extra = true; },
			value => { value.frozenForms.version = 2; },
			value => { value.frozenForms.baseline.path = "arbitrary"; },
			value => { value.frozenForms.baseline.key = "not-a-key"; },
			value => { value.frozenForms.baseline.key = 12345678; },
			value => { value.frozenForms.profiles.length = 1; },
			value => { value.frozenForms.profiles = Array.from({length: 9}, (_, ix) => ({...value.frozenForms.profiles[0], id: `test-${ix}`})); },
			value => { value.frozenForms.profiles[1].resolved.frozenForms = value.frozenForms; },
			value => { value.frozenForms.profiles[1].resolved.automation = {profile: "zombie-numerics"}; },
			value => { value.frozenForms.profiles[1].resolved.changes[0].expression = "1+2"; },
			value => { value.frozenForms.profiles[1].resolved.changes.push({op: "grantSpell", spell: "light|phb", source: "PHB", usage: "will"}); },
			value => { value.frozenForms.profiles[1].resolved.kind = "race"; },
		];
		for (const change of cases) {
			const bad = structuredClone(resolved);
			change(bad);
			// Avoid handing the deliberately cyclic case to AJV.
			if (bad.frozenForms.profiles[1]?.resolved.frozenForms !== bad.frozenForms) expect(validate(bad)).toBe(false);
			expect(() => assertFrozenCreatureTransformation(bad)).toThrow();
		}
		for (const change of [
			value => { value.frozenForms.activeForm = "missing"; },
			value => { value.frozenForms.profiles[1].id = "test-a"; },
			value => { value.frozenForms.profiles[1].resolved.identity.source = "TST"; },
			value => { value.frozenForms.profiles[1].resolved.prerequisites.push("Other consent"); },
			value => { value.changes = structuredClone(value.changes); value.changes.find(step => step.op === "setArmorClass").value = [20]; },
		]) {
			const bad = structuredClone(resolved);
			change(bad);
			expect(() => assertFrozenCreatureTransformation(bad)).toThrow();
		}
		const getter = jest.fn(() => 1);
		const unsafe = structuredClone(resolved);
		Object.defineProperty(unsafe.frozenForms, "hidden", {get: getter, enumerable: true});
		expect(() => normalizeCreatureTransformation(unsafe)).toThrow(/accessor/);
		expect(getter).not.toHaveBeenCalled();
	});

	it("switches A/B/A at the actual Registry boundary without stacking, moving its owner or rewriting suffix bytes", () => {
		const base = monster();
		const registry = new BestiaryQuickActionsRegistry();
		const prefix = patch("prefix", {languages: ["Common"]});
		const owner = operation(base, [prefix]);
		const suffix = patch("suffix", {wis: 19});
		registry.applyChanges({creature: base, addOperations: [prefix, owner, suffix]});
		const first = registry.getCreature({creature: base});
		const notify = jest.fn();
		registry.subscribe(notify);
		for (const formId of ["test-b", "test-a", "test-b", "test-a"]) {
			const prior = registry.getOperations({creature: base});
			const {batch, changes} = switchForm(base, prior, formId);
			registry.applyChanges({creature: base, ...changes[0]});
			const history = registry.getOperations({creature: base});
			expect(history.map(it => it.id)).toEqual(["prefix", "form-owner", "suffix"]);
			expect(JSON.stringify(history[0])).toBe(JSON.stringify(prefix));
			expect(JSON.stringify(history[2])).toBe(JSON.stringify(suffix));
			expect(registry.getCreature({creature: base})).toEqual(batch.proposed);
			expect(registry.getCreature({creature: base})).toMatchObject({
				str: formId === "test-a" ? 16 : 18,
				con: formId === "test-a" ? 14 : 16,
				hp: {average: formId === "test-a" ? 39 : 45},
				ac: [formId === "test-a" ? 14 : 17],
				wis: 19,
				cr: {cr: formId === "test-a" ? "2" : "5", xp: formId === "test-a" ? 450 : 1800},
			});
			expect(registry.getCreature({creature: base}).action[0].entries[0].match(/Kernel rider/g)).toHaveLength(1);
		}
		expect(registry.getCreature({creature: base})).toEqual(first);
		expect(notify).toHaveBeenCalledTimes(4);
		const unchanged = switchForm(base, registry.getOperations({creature: base}), "test-a");
		expect(unchanged.batch).toMatchObject({noChange: true, canApply: false, diff: {fields: [], entries: []}});
		expect(unchanged.changes).toEqual([]);
		registry.removeOperation({creature: base, operationId: owner.id});
		expect(registry.getCreature({creature: base})).toEqual({...base, languages: ["Common"], wis: 19});
	});

	it("reaches Encounter adapter -> state -> real Store save/load; preserves HP/temp/group consequences and saves no-op zero times", async () => {
		const base = monster();
		let initial = await encounter(base);
		initial = EncounterWorkspaceState.withHp(initial, {id: "one", prop: "temp", value: 4});
		initial = EncounterWorkspaceState.withGroup({state: initial, memberIds: ["one", "two"], id: "kernel-group"});
		const saved = persistence(initial);
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		await saved.adapter.addOperation({operation: operation(base)});
		expect(saved.state().instances[0].hp).toEqual({current: 39, max: 39, temp: 4});
		const grouped = JSON.stringify(saved.state().groups);
		const first = saved.adapter.getCreature();
		await saved.adapter.addOperation({operation: patch("suffix", {wis: 19})});
		for (const formId of ["test-b", "test-a"]) {
			const {changes, batch} = switchForm(base, saved.adapter.getOperations(), formId);
			await saved.adapter.applyChanges(changes[0]);
			await saved.reload();
			expect(saved.adapter.getCreature()).toEqual(batch.proposed);
			expect(saved.adapter.getOperations().map(it => it.id)).toEqual(["form-owner", "suffix"]);
			expect(saved.state().instances[0].hp).toEqual({current: formId === "test-a" ? 39 : 45, max: formId === "test-a" ? 39 : 45, temp: 4});
			expect(JSON.stringify(saved.state().groups)).toBe(grouped);
			expect(saved.state().instances[1].monster).toEqual(base);
		}
		expect(saved.adapter.getCreature()).toEqual({...first, wis: 19});
		const calls = saved.storage.pSetForPage.mock.calls.length;
		const owner = saved.adapter.getOperations()[0];
		await expect(saved.adapter.applyChanges({replaceOperation: {operationId: owner.id, expectedIntegrity: owner.data.integrity, operation: owner}})).resolves.toBeNull();
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(calls);
		expect(notify).toHaveBeenCalledTimes(calls);
		await saved.adapter.removeOperation({operationId: owner.id});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual({...base, wis: 19});
		expect(saved.state().instances[0].hp).toEqual({current: 33, max: 33, temp: 4});
	});

	it("keeps prior owner/state/HP/groups/notifications on failed save, retries once, and labels a saved refresh failure", async () => {
		const base = monster();
		let initial = await encounter(base);
		const owner = operation(base);
		initial = EncounterWorkspaceState.withStatblockChanges(initial, ["one", "two"].map(id => ({id, addOperations: [structuredClone(owner)], removeIds: []}))).state;
		initial = EncounterWorkspaceState.withGroup({state: initial, memberIds: ["one", "two"], id: "same-form"});
		const saved = persistence(initial);
		await saved.store.pSave(initial);
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		const before = saved.state();
		const {changes} = switchForm(base, saved.adapter.getOperations(), "test-b");
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
		await expect(saved.adapter.applyChanges(changes[0])).rejects.toThrow("Storage full");
		expect(saved.state()).toBe(before);
		expect(notify).not.toHaveBeenCalled();
		await saved.adapter.applyChanges(changes[0]);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(3);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(saved.state().groups[0].memberIds).toEqual(["two"]);
		saved.adapter.subscribe(() => { throw new Error("Refresh unavailable"); });
		const back = switchForm(base, saved.adapter.getOperations(), "test-a");
		await expect(saved.adapter.applyChanges(back.changes[0])).rejects.toMatchObject({isEncounterStatblockSaved: true, message: expect.stringMatching(/was saved.*refresh/i)});
		await saved.reload();
		expect(saved.adapter.getCreature().con).toBe(14);
	});

	it("blocks changed downstream saved conflicts atomically in preview and both real consumers instead of resigning receipts", async () => {
		const base = monster();
		const owner = operation(base);
		const resolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "con", value: 20}], manualReview: []};
		const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: [owner], resolved, conflictDecisions: {con: "incoming"}});
		const later = {id: "later", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: [owner], preview, conflictDecisions: {con: "incoming"}})};
		expect(() => switchForm(base, [owner, later], "test-b")).toThrow(/Conflict.*changed/);
		const change = switchForm(base, [owner], "test-b").changes[0];
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [owner, later]});
		expect(() => registry.applyChanges({creature: base, ...change})).toThrow(/Conflict.*changed/);
		expect(registry.getOperations({creature: base})).toEqual([owner, later]);
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [owner, later]});
		const before = saved.state();
		await expect(saved.adapter.applyChanges(change)).rejects.toThrow(/Conflict.*changed/);
		expect(saved.state()).toBe(before);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(1);
	});

	it.each(["Registry", "Encounter"])("blocks a disappearing approved STR conflict at the actual %s boundary", async consumer => {
		const base = monster();
		const owner = withdrawalOwner(base);
		const resolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 20}], manualReview: []};
		const later = operation(base, [owner], resolved, "later", "existing");
		expect(later.data.conflictDecisions).toEqual({str: "existing"});
		expect(later.data.approvedConflicts).toEqual([expect.objectContaining({path: "str", existing: 16, incoming: 20})]);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [owner, later]}).str).toBe(16);
		const change = switchForm(base, [owner], "test-b").changes[0];
		const notify = jest.fn();
		if (consumer === "Registry") {
			const registry = new BestiaryQuickActionsRegistry();
			registry.applyChanges({creature: base, addOperations: [owner, later]});
			registry.subscribe(notify);
			const before = registry.getCreature({creature: base});
			expect(() => registry.applyChanges({creature: base, ...change})).toThrow(/conflict.*changed/i);
			expect(registry.getOperations({creature: base})).toEqual([owner, later]);
			expect(registry.getCreature({creature: base})).toEqual(before);
		} else {
			const saved = persistence(await encounter(base));
			await saved.adapter.applyChanges({addOperations: [owner, later]});
			saved.adapter.subscribe(notify);
			const before = saved.state();
			await expect(saved.adapter.applyChanges(change)).rejects.toThrow(/conflict.*changed/i);
			expect(saved.state()).toBe(before);
			expect(saved.adapter.getOperations()).toEqual([owner, later]);
			expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(1);
			await saved.reload();
			expect(saved.adapter.getCreature().str).toBe(16);
		}
		expect(notify).not.toHaveBeenCalled();
		expect(() => switchForm(base, [owner, later], "test-b")).toThrow(/conflict.*changed/i);
	});

	it("allows an optional STR setter to be withdrawn when no downstream conflict depends on it", async () => {
		const base = monster();
		const owner = withdrawalOwner(base);
		const resolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "wis", value: 19}], manualReview: []};
		const suffix = operation(base, [owner], resolved, "suffix");
		expect(suffix.data.approvedConflicts).toEqual([]);
		const {changes, batch} = switchForm(base, [owner, suffix], "test-b");
		expect(batch.proposed).toMatchObject({str: base.str, con: 16, ac: [17], hp: {average: 45}, action: base.action, wis: 19});
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [owner, suffix]});
		registry.applyChanges({creature: base, ...changes[0]});
		expect(registry.getCreature({creature: base})).toEqual(batch.proposed);
		expect(registry.getOperations({creature: base})[1]).toEqual(suffix);
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [owner, suffix]});
		await saved.adapter.applyChanges(changes[0]);
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual(batch.proposed);
		expect(saved.adapter.getOperations().map(it => it.id)).toEqual(["form-owner", "suffix"]);
		expect(saved.adapter.getOperations()[1]).toEqual(suffix);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(2);
	});

	it("preserves ordinary non-envelope replay/removal when a saved retained winner loses its prior writer", async () => {
		const base = monster();
		const owner = operation(base, [], normalizeCreatureTransformation(kernelLeaf(base, {str: 16, con: 14, ac: 14, cr: "2"})));
		const resolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 20}], manualReview: []};
		const later = operation(base, [owner], resolved, "later", "existing");
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [owner, later]});
		expect(registry.getCreature({creature: base}).str).toBe(16);
		registry.removeOperation({creature: base, operationId: owner.id});
		expect(registry.getCreature({creature: base}).str).toBe(20);
		expect(registry.getOperations({creature: base})).toEqual([later]);
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [owner, later]});
		expect(saved.adapter.getCreature().str).toBe(16);
		await saved.adapter.removeOperation({operationId: owner.id});
		await saved.reload();
		expect(saved.adapter.getCreature().str).toBe(20);
		expect(saved.adapter.getOperations()).toEqual([later]);
	});

	it("keeps all frozen-form dependent numeric conflicts unresolved/retained/incoming together", () => {
		const base = monster();
		const priorRecipe = {id: "catalog:prior|tst", kind: "catalog", identity: {name: "Prior", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "con", value: 18}, {type: "setAbility", ability: "str", value: 19}], manualReview: []};
		const prior = operation(base, [], priorRecipe, "prior");
		const owner = operation(base, [prior]);
		const current = target(base, [prior, owner]);
		const pending = previewCreatureTransformationForm({target: current, operationId: owner.id, formId: "test-b"});
		expect(pending.canApply).toBe(false);
		expect(pending.proposed).toBeNull();
		expect(() => createCreatureTransformationFormChanges({batch: pending, target: current})).toThrow(/every conflict winner/);
		expect(() => previewCreatureTransformationForm({target: current, operationId: owner.id, formId: "test-b", conflictDecisions: {str: "incoming", con: "existing"}})).toThrow(/one conflict winner/);
		const retained = previewCreatureTransformationForm({target: current, operationId: owner.id, formId: "test-b", conflictDecisions: {str: "existing", con: "existing"}});
		expect(retained.proposed).toMatchObject({str: 19, con: 18, ac: base.ac, hp: base.hp, action: base.action});
		const incoming = switchForm(base, current.operations, "test-b");
		const operations = BestiaryQuickActionsUtil.replaceCreatureTransformationOperation({...incoming.changes[0], baseCreature: base, operations: current.operations});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations})).toEqual(incoming.batch.proposed);
		expect(incoming.batch.proposed).toMatchObject({str: 18, con: 16, ac: [17], cr: {cr: "5", xp: 1800}});
	});

	it("fences stale histories/forms/owner/baseline/source, immutable profile sets and raw rather than finalized baselines", () => {
		const base = monster();
		const area = {id: "area", ...BestiaryQuickActionsOperations.applyAreaTrait({entry: {name: "PB fixture", entries: ["DC 10 plus PB."]}})};
		const owner = operation(base, [area]);
		expect(owner.data.resolved.frozenForms.baseline).not.toEqual(BestiaryCreatureTransformation.getBaseline({original: base, current: BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [area]})}));
		const {batch, changes} = switchForm(base, [area, owner], "test-b");
		expect(() => createCreatureTransformationFormChanges({batch, target: target(base, [owner])})).toThrow(/stale/);
		expect(() => createCreatureTransformationFormChanges({batch, target: batch.target, formId: "test-a"})).toThrow(/stale/);
		const bad = structuredClone(batch);
		bad.change.replaceOperation.operation.data.resolved.changes[0].value = "beast";
		expect(() => createCreatureTransformationFormChanges({batch: bad, target: batch.target})).toThrow(/stale/);
		expect(() => BestiaryQuickActionsUtil.replaceCreatureTransformationOperation({baseCreature: base, operations: [area, owner], replaceOperation: {...changes[0].replaceOperation, expectedIntegrity: "00000000"}})).toThrow(/owner changed/);
		const mutated = structuredClone(changes[0].replaceOperation);
		mutated.operation.data.resolved.frozenForms.profiles[0].label += " rewritten";
		expect(() => BestiaryQuickActionsUtil.replaceCreatureTransformationOperation({baseCreature: base, operations: [area, owner], replaceOperation: mutated})).toThrow(/immutable/);
		for (const extra of [{addOperations: [patch("extra", {wis: 18})]}, {removeIds: [area.id]}, {replaceOperation: false}]) {
			expect(() => BestiaryQuickActionsUtil.replaceCreatureTransformationOperation({baseCreature: base, operations: [area, owner], replaceOperation: changes[0].replaceOperation, ...extra})).toThrow(/one form replacement/);
		}
		const validateChange = jest.fn(({operations}) => expect(operations.map(it => it.id)).toEqual(["area", "form-owner"]));
		previewCreatureTransformationForm({target: batch.target, operationId: owner.id, formId: "test-b", validateChange});
		expect(validateChange).toHaveBeenCalledTimes(1);
		expect(() => previewCreatureTransformationForm({target: batch.target, operationId: owner.id, formId: "test-b", validateChange: () => { throw new Error("Resulting history storage limit"); }})).toThrow(/storage limit/);
		for (const history of [[owner], [patch("changed-prefix", {dex: 18}), owner]]) {
			expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: history})).toThrow(/pre-template history changed/);
		}
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "TST"}, operations: [area, owner]})).toThrow(/another creature/);
		const wrong = normalizeCreatureTransformation(bundle(base));
		wrong.frozenForms.baseline.sourceUid = "other|mm";
		expect(() => operation(base, [], wrong)).toThrow(/pre-template history changed/);
	});

	it("replays inactive frozen profiles after catalogs/tables disappear and rejects tampering before executing", () => {
		const base = monster();
		const saved = JSON.parse(JSON.stringify(operation(base)));
		const expected = switchForm(base, [saved], "test-b").batch.proposed;
		const removed = catalog.creatureTransformation.splice(0);
		const rows = table.splice(0);
		try {
			const {changes} = switchForm(base, [saved], "test-b");
			const registry = new BestiaryQuickActionsRegistry();
			registry.addOperation({creature: base, operation: saved});
			registry.applyChanges({creature: base, ...changes[0]});
			expect(registry.getCreature({creature: base})).toEqual(expected);
			for (const change of [
				op => { op.data.resolved.frozenForms.profiles[1].resolved.changes.find(it => it.type === "setAbility").value = 30; },
				op => { op.data.resolved.frozenForms.activeForm = "test-b"; },
				op => { op.data.resolved.frozenForms.baseline.key = "00000000"; },
				op => { op.data.resolved.identity.source = "TST"; },
			]) {
				const bad = structuredClone(saved);
				change(bad);
				expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [bad]})).toThrow(/changed|another creature/);
			}
		} finally {
			catalog.creatureTransformation.push(...removed);
			table.push(...rows);
		}
	});

	it("replaces Encounter slot 100 at count 100, rejects append 101 and oversized payloads without a Registry global cap", async () => {
		const base = monster();
		const prefix = Array.from({length: 99}, (_, ix) => patch(`prefix-${ix}`, {languages: ["Common"]}));
		const owner = operation(base, prefix);
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [...prefix, owner]});
		const change = switchForm(base, saved.adapter.getOperations(), "test-b").changes[0];
		const checked = EncounterWorkspaceState.withStatblockChanges(saved.state(), [{...change, operations: saved.adapter.getOperations().slice(1)}]);
		expect(checked.state.instances[0].statblockOperations).toHaveLength(100);
		await saved.adapter.applyChanges(change);
		expect(saved.adapter.getOperations()).toHaveLength(100);
		expect(saved.adapter.getOperations()[99].id).toBe(owner.id);
		await expect(saved.adapter.addOperation({operation: patch("101", {wis: 18})})).rejects.toThrow(/invalid statblock history/);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [...prefix, owner, patch("101", {wis: 18})]});
		registry.applyChanges({creature: base, ...switchForm(base, registry.getOperations({creature: base}), "test-b").changes[0]});
		expect(registry.getOperations({creature: base})).toHaveLength(101);
		const large = normalizeCreatureTransformation(bundle(base));
		const reason = "x".repeat(90_000);
		large.frozenForms.profiles[1].resolved.manualReview.push({field: "other", reason}, {field: "other", reason});
		expect(() => operation(base, [], large)).toThrow(/size budget/);
		const tooLarge = structuredClone(change);
		tooLarge.replaceOperation.operation.id = "x".repeat(200_001);
		await expect(saved.adapter.applyChanges(tooLarge)).rejects.toThrow();
		expect(saved.adapter.getOperations()).toHaveLength(100);
	});

	it("enforces the exact full transformation byte boundary in Registry and Encounter without inflating either budget", async () => {
		const base = monster();
		const small = operation(base);
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const limit = BestiaryCreatureTransformation.MAX_OPERATION_BYTES;
		const atLimit = {...small, id: "x".repeat(limit - bytes(small) + small.id.length)};
		expect(bytes(atLimit)).toBe(limit);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: base, operation: atLimit});
		const saved = persistence(await encounter(base));
		await saved.adapter.addOperation({operation: atLimit});
		const before = saved.state();
		const tooLarge = {...atLimit, id: `${atLimit.id}x`};
		expect(bytes(tooLarge)).toBe(limit + 1);
		const other = new BestiaryQuickActionsRegistry();
		expect(() => other.addOperation({creature: base, operation: tooLarge})).toThrow(/size budget/);
		expect(other.getOperations({creature: base})).toEqual([]);
		await expect(saved.adapter.applyChanges({removeIds: [atLimit.id], addOperations: [tooLarge]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(before);
		const wrapperOversized = {...small, id: "x".repeat(200_001)};
		await expect(saved.adapter.applyChanges({removeIds: [atLimit.id], addOperations: [wrapperOversized]})).rejects.toThrow(/invalid statblock operation/);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(1);
	});

	it("preserves consent, candidate/schema isolation, default legacy output and old baseline-free removal", () => {
		const base = monster();
		const raw = bundle(base);
		const resolved = normalizeCreatureTransformation(raw);
		expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved})).toThrow(/prerequisites|eligibility/);
		const candidates = getCreatureTransformationCandidates({catalog, races: []});
		const legacy = resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg"});
		expect(legacy).not.toHaveProperty("version");
		expect(legacy).not.toHaveProperty("frozenForms");
		const prefix = patch("prefix", {languages: ["Common"]});
		const leaf = normalizeCreatureTransformation(compileCreatureTransformation({resolved: pending(), current: base}));
		const old = operation(base, [prefix], leaf);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [old]}).con).toBe(14);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});
});
