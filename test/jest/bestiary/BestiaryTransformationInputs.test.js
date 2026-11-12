import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {compileCreatureTransformationInputs, inspectCreatureTransformationInputs, pLoadCreatureTransformationInputTable, proposeCreatureTransformationResidual} from "../../../js/bestiary/bestiary-transformation-inputs.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets, proposeCreatureTransformationTargetResidual} from "../../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../../js/encounterworkspace/encounterworkspace-quick-actions.js";

const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const monsters = JSON.parse(fs.readFileSync("data/bestiary/bestiary-mm.json", "utf8")).monster;
const source = name => structuredClone(monsters.find(it => it.name === name && it.source === "MM"));
const table = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
const candidates = getCreatureTransformationCandidates({catalog, races: []});
const staged = (id = "catalog:zombie|dmg") => resolveCreatureTransformation({candidates, id, automationVersion: 2});
const target = (id = "one", baseCreature = source("Bugbear"), operations = []) => ({id, label: id, baseCreature, operations});
const control = (model, kind, predicate = () => true) => model.controls.find(it => it.kind === kind && predicate(it));
const token = (model, name, kind, index = 0) => control(model, "token", it => it.selector.name === name && it.selector.kind === kind && it.selector.token === index);
const patch = (id, set) => ({id, type: "patch", data: {patch: {set}}});
const defense = () => ({expectedCr: "1",
	hpBoundary: null,
	acIndex: 0,
	acAdjustment: 0,
	hpAdjustment: 0,
	resistance: "none",
	vulnerability: false,
	regeneration: 0,
	note: "Selected armor; poison immunity alone gives no multiplier. Reviewed all features: no additional effective HP/AC adjustment or regeneration."});

function answersFor (subject = target(), resolved = staged()) {
	const model = inspectCreatureTransformationInputs({target: subject, resolved});
	const controls = {};
	controls[control(model, "armor").id] = {mode: "retain", reason: "Zombie leaves Dexterity and equipment unchanged."};
	for (const item of model.controls.filter(it => it.kind === "token")) {
		const {kind, name} = item.selector;
		controls[item.id] = name === "Surprise Attack"
			? {mode: "fixed", value: 0, reason: "Source-fixed conditional rider."}
			: {mode: "ability", ability: "str", proficiency: kind === "hit" ? 1 : 0, fixed: 0, reason: "Reviewed STR weapon and PB contribution; no additional residual."};
	}
	for (const item of model.controls.filter(it => it.kind === "proficiency")) {
		controls[item.id] = {
			multiplier: item.selector.name === "stealth" ? 2 : 1, reason: "Reviewed the source proficiency/expertise, not inferred from the total.",
		};
	}
	controls[control(model, "cr").id] = {
		defense: defense(),
		routines: [{id: "morningstar",
			rows: [{tokenId: token(model, "Morningstar", "damage").id, counts: [1, 1, 1], targets: [1, 1, 1], timing: "normal", reason: "One Morningstar each round."}],
			accuracy: token(model, "Morningstar", "hit").id,
			mixedReason: "STR attack is the sole selected accuracy measure.",
			note: "Reviewed melee alternative."}],
		routine: "highest-damage",
		review: {confirmed: true, reason: "All relevant effects and complete alternatives deliberately reviewed."},
		override: null,
		zeroXp: false,
		proficiencyAnswer: null,
		coverage: model.entries.map(entry => ({entryId: entry.id,
			decision: entry.match.name === "Morningstar" ? "represented" : "excluded",
			reason: entry.match.name === "Brute" ? "Extra die is already baked into weapon damage." : "Reviewed exclusion from this complete routine; no surprise or javelin uses."})),
	};
	return {targetKey: model.targetKey, controls};
}
const crAnswer = (answers, subject = target()) => answers.controls[control(inspectCreatureTransformationInputs({target: subject, resolved: staged()}), "cr").id];
const preview = (subjects = [target()], guidedAnswers = Object.fromEntries(subjects.map(it => [it.id, answersFor(it)])), extras = {}) => {
	const resolved = staged();
	return previewCreatureTransformationTargets({targets: subjects,
		resolved,
		guidedAnswers,
		crTable: table,
		generation: 1,
		acknowledgedPrerequisites: resolved.prerequisites,
		dmApproved: true,
		...extras});
};
const save = (batch, conflictDecisions = {}) => createCreatureTransformationChanges({batch, targets: batch.targets, conflictDecisions})
	.map(edit => ({...edit, addOperations: edit.addOperations.map(operation => ({...operation, id: "guided-owner"}))}));
const incoming = (subjects, answers) => {
	const pending = preview(subjects, answers);
	const conflictDecisions = Object.fromEntries(pending.previews.map(it => [it.id, Object.fromEntries(it.preview.conflicts.map(({path}) => [path, "incoming"]))]));
	return {batch: preview(subjects, answers, {conflictDecisions}), conflictDecisions};
};

describe("M4b DOM-free representative input/composer boundary", () => {
	it("proposes unaccepted Bugbear residuals only after explicit ability/PB selection and adopts without external arithmetic", () => {
		const subject = target();
		const model = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
		const tokenId = token(model, "Morningstar", "hit").id;
		const propose = (ability, proficiency) => proposeCreatureTransformationTargetResidual({target: subject, resolved: staged(), tokenId, ability, proficiency});
		expect(propose("str", 1)).toMatchObject({targetId: "one", sourceUid: "bugbear|mm", tokenId, observed: 4, abilityModifier: 2, fixed: 0, accepted: false, pb: {before: 2, source: "derived-cr"}});
		expect(propose("wis", 1).fixed).toBe(2);
		const proposal = propose("str", 2);
		expect(proposal.fixed).toBe(-2);
		const answers = answersFor(subject);
		answers.controls[tokenId] = {mode: "ability", ability: "str", proficiency: 2, proposal, adopted: true, reason: "Explicitly reviewed this selected model and its negative residual."};
		const batch = preview([subject], {one: answers});
		expect(batch.skipped).toEqual([]);
		expect(batch.automationInputs.one.bindings.entries.find(it => it.match.name === "Morningstar").numbers[0]).toMatchObject({fixed: -2, proficiency: 2});
		expect(batch.previews[0].preview.proposed.action[0].entries[0]).toContain("{@hit 5}");
		expect(answers.controls[token(model, "Surprise Attack", "damage").id]).toMatchObject({mode: "fixed", value: 0});
	});

	it("rejects unadopted, stale, wrong-target and wrong-token proposals even when their residual numbers agree", () => {
		const subject = target();
		const model = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
		const tokenId = token(model, "Morningstar", "hit").id;
		const other = target("two");
		const otherModel = inspectCreatureTransformationInputs({target: other, resolved: staged()});
		const propose = (target, tokenId) => proposeCreatureTransformationTargetResidual({target, resolved: staged(), tokenId, ability: "str", proficiency: 1});
		const proposal = propose(subject, tokenId);
		const answers = answersFor(subject);
		const answer = {mode: "ability", ability: "str", proficiency: 1, proposal, adopted: false, reason: "Needs explicit adoption."};
		answers.controls[tokenId] = answer;
		expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/Deliberately adopt/);
		answer.adopted = true;
		answer.reason = "";
		expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/reason/);
		answer.reason = "Reviewed.";
		for (const bad of [propose(other, token(otherModel, "Morningstar", "hit").id), propose(subject, token(model, "Javelin", "hit").id)]) {
			answer.proposal = bad;
			expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/residual proposal is stale/);
		}
		const changed = target("one", source("Bugbear"), [patch("same-value", {str: 15})]);
		const refreshed = answersFor(changed);
		refreshed.controls[tokenId] = {...answer, proposal};
		expect(preview([changed], {one: refreshed}).skipped[0].reason).toMatch(/residual proposal is stale/);
		expect(() => propose(other, tokenId)).toThrow(/exact target/);
	});

	it("does not require ordinary PB for a zero-multiplier residual and preserves authoritative generated/authored ownership otherwise", () => {
		const unknown = target("unknown", {...source("Bugbear"), cr: "Unknown"});
		const model = inspectCreatureTransformationInputs({target: unknown, resolved: staged()});
		const options = {target: unknown, resolved: staged(), tokenId: token(model, "Morningstar", "damage").id, ability: "str", proficiency: 0};
		expect(proposeCreatureTransformationResidual(options)).toMatchObject({fixed: 0, pb: null, accepted: false});
		expect(() => proposeCreatureTransformationResidual({...options, proficiency: 1})).toThrow(/canonical current CR/);
		const first = save(preview())[0].addOperations[0];
		for (const authored of [false, true]) {
			const subject = target("one", source("Bugbear"), [first, ...authored ? [patch("authored", {profBonus: 2, pbNote: "+2"})] : []]);
			const current = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
			const selected = {target: subject, resolved: staged(), tokenId: token(current, "Morningstar", "hit").id, ability: "str", proficiency: 1};
			expect(proposeCreatureTransformationTargetResidual(selected).pb).toMatchObject({source: authored ? "source-profBonus" : "derived-cr", history: {ownership: authored ? "explicit" : "derived"}});
			if (authored) expect(() => proposeCreatureTransformationTargetResidual({...selected, proficiencyAnswer: {mode: "derived", value: 2, reason: "Cannot discard known authored PB."}})).toThrow(/Known authored PB/);
		}
	});

	it("composes real Bugbear Morningstar at post-ability damage 12, never original damage 11", () => {
		const batch = preview();
		expect(batch.skipped).toEqual([]);
		const assumptions = batch.automationInputs.one.cr.assumptions;
		expect(assumptions.routines[0]).toMatchObject({rounds: [{value: 12, proficiency: 0}, {value: 12, proficiency: 0}, {value: 12, proficiency: 0}],
			accuracy: {kind: "attack", value: 5, proficiency: 1}});
		expect(batch.previews[0].preview.proposed).toMatchObject({str: 16, con: 15, hp: {average: 32, formula: "5d8 + 10"}, cr: {cr: "1", xp: 200}});
		expect(batch.previews[0].preview.proposed.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(batch.guidedModels[0].estimate.receipt).toMatchObject({damagePerRound: 12, accuracy: 5, proficiency: {source: "derived-cr", before: 2}});
		const facts = batch.guidedModels[0];
		expect(facts.facts.hitPoints).toMatchObject({dice: {number: 5, faces: 8, bonus: 5}, residual: 0});
		expect(facts.facts.ac[0].from).toEqual(["{@item hide armor|phb}", "{@item shield|phb}"]);
		expect(facts.entries.find(it => it.match.name === "Surprise Attack").tokens[0]).toMatchObject({dice: {number: 2, faces: 6}, average: 7});
		expect(facts.entries.find(it => it.match.name === "Javelin").tokens.filter(it => it.kind === "damage")).toHaveLength(2);
	});

	it("separates alternatives, schedules conditional riders, counts targets, rounds per token and uses donor coefficient zero", () => {
		const subject = target();
		const answers = answersFor(subject);
		const model = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
		const cr = crAnswer(answers);
		const routine = cr.routines[0];
		routine.rows.push({tokenId: token(model, "Surprise Attack", "damage").id, counts: [1, 0, 0], targets: [2, 1, 1], timing: "conditional", reason: "Adjudicated surprise rider in round one, two targets only."});
		cr.coverage.find(it => it.entryId === model.entries.find(it => it.match.name === "Surprise Attack").id).decision = "represented";
		cr.coverage.find(it => it.entryId === model.entries.find(it => it.match.name === "Javelin").id).decision = "represented";
		cr.routines.push({...structuredClone(routine), id: "ranged", rows: [{...routine.rows[0], tokenId: token(model, "Javelin", "damage", 1).id, targets: [2, 2, 2]}]});
		const batch = preview([subject], {one: answers});
		expect(batch.skipped).toEqual([]);
		expect(batch.automationInputs.one.cr.assumptions.routines.map(it => it.rounds.map(round => round.value))).toEqual([[26, 12, 12], [12, 12, 12]]);
		expect(batch.guidedModels[0].estimate.receipt.damagePerRound).toBe(16);
		// Reviewed PB-linked damage uses the same post-ability values, with one coefficient per selected use.
		answers.controls[token(model, "Morningstar", "damage").id] = {mode: "ability", ability: "str", proficiency: 1, fixed: -2, reason: "Explicit numeric binding fixture, not a new source policy."};
		cr.routines = [routine];
		const linked = preview([subject], {one: answers});
		expect(linked.automationInputs.one.cr.assumptions.routines[0].rounds).toEqual([{value: 26, proficiency: 1}, {value: 12, proficiency: 1}, {value: 12, proficiency: 1}]);
	});

	it.each([
		cr => { cr.routines = []; },
		cr => { cr.routines = Array.from({length: 13}, (_, i) => ({...cr.routines[0], id: `routine-${i}`})); },
		cr => { cr.routines[0].rows = Array.from({length: 25}, () => cr.routines[0].rows[0]); },
		cr => { cr.routines[0].rows[0].counts = [1, 1]; },
		cr => { cr.routines[0].rows[0].counts[0] = 21; },
		cr => { cr.routines[0].rows[0].targets[0] = 101; },
		cr => { cr.routines[0].rows[0].targets[0] = 0; },
		cr => { cr.routines[0].rows[0].tokenId = "unknown-source-token"; },
		cr => { cr.routines[0].mixedReason = ""; },
		cr => { cr.review.confirmed = false; },
		cr => { cr.defense.note = ""; },
		cr => { cr.routines[0].rows[0].counts = [20, 20, 20]; cr.routines[0].rows[0].targets = [100, 100, 100]; },
		cr => { cr.routines.push({...structuredClone(cr.routines[0]), id: "tied"}); },
	])("keeps missing/unsupported composition unresolved without a zero-valued fallback %#", change => {
		const answers = answersFor();
		change(crAnswer(answers));
		const batch = preview([target()], {one: answers});
		expect(batch.previews).toEqual([]);
		expect(batch.skipped[0].requirements[0]).toMatchObject({targetId: "one", control: expect.any(String), selector: expect.anything(), reason: expect.any(String)});
		expect(save(batch)).toEqual([]);
	});

	it("accepts bounded fixed adjudications, selected ties, separate override/estimate and explicit CR0 zero-XP", () => {
		const answers = answersFor();
		const cr = crAnswer(answers);
		cr.routines[0].rows = [{fixed: {value: 12, source: {name: "Reviewed damage", source: "MM"}, reason: "Explicit per-use adjudication."}, counts: [1, 1, 1], targets: [1, 1, 1], timing: "limited-use", reason: "One adjudicated use each round."}];
		cr.routines.push({...structuredClone(cr.routines[0]), id: "equal"});
		cr.routine = "equal";
		cr.override = {cr: "5", reason: "Deliberate DM override; estimate remains independently visible."};
		let batch = preview([target()], {one: answers});
		expect(batch.skipped).toEqual([]);
		expect(batch.guidedModels[0].estimate).toMatchObject({value: {cr: "5", xp: 1800}, receipt: {estimatedCr: "1", routineId: "equal", proficiency: {after: 3}}});
		cr.override = {cr: "0", reason: "Adjudicated harmless encounter."};
		cr.zeroXp = true;
		batch = preview([target()], {one: answers});
		expect(batch.guidedModels[0].estimate.value).toEqual({cr: "0", xp: 0});
		cr.override.cr = "5";
		expect(preview([target()], {one: answers}).skipped[0].reason).toMatch(/only.*CR of 0/);
	});

	it.each([760, 805])("retains the exact %i HP overlap policy through the real producer", hp => {
		const subject = target("one", {...source("Bugbear"), hp: {average: hp - 1, formula: `1d8 + ${hp - 5}`}});
		const answers = answersFor(subject);
		const cr = crAnswer(answers, subject);
		expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/boundary policy/);
		cr.override = {cr: "15", reason: "Explicit override isolates the overlap decision from possible multiple PB fixed points."};
		cr.defense.hpBoundary = "lower";
		const lower = preview([subject], {one: answers}).guidedModels[0].estimate.receipt;
		cr.defense.hpBoundary = "higher";
		const higher = preview([subject], {one: answers}).guidedModels[0].estimate.receipt;
		expect(lower.effectiveHp).toBe(hp);
		expect(Number(higher.defensiveCr)).toBe(Number(lower.defensiveCr) + 1);
	});

	it("requires answers and isolates mixed targets, custom HP/PB, stale source identities and retained unsupported tokens", () => {
		const one = target();
		const two = target("two");
		expect(preview([one], {}).skipped[0].requirements[0].control).toBe("answers");
		const mixed = preview([one, two], {one: answersFor(one), two: answersFor(one)});
		expect(mixed.previews.map(it => it.id)).toEqual(["one"]);
		for (const changed of [
			{hp: {special: "custom"}}, {hp: {average: 99, formula: "5d8 + 5"}}, {profBonus: 2, pbNote: "+3"}, {pbNote: "+2 conditional"}, {action: {}},
		]) expect(preview([target("one", {...source("Bugbear"), ...changed})], {}).skipped[0].status).toBe("blocked");
		const malformed = answersFor();
		malformed.controls[control(inspectCreatureTransformationInputs({target: one, resolved: staged()}), "cr").id] = null;
		expect(preview([one], {one: malformed}).skipped[0].reason).toMatch(/not a null/);
		const altered = target("one", {...source("Bugbear"), source: "TST"});
		expect(preview([altered], {one: answersFor()}).skipped[0].reason).toMatch(/stale/);
		const unsupported = source("Bugbear");
		unsupported.action[0].entries[0] = "{@hit 4} to hit. 99 ({@damage 2d8 + 2}) damage.";
		const subject = target("one", unsupported);
		const answers = answersFor(subject);
		const model = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
		const entry = model.entries.find(it => it.match.name === "Morningstar");
		for (const item of entry.tokens) delete answers.controls[item.id];
		answers.controls[entry.id] = {mode: "retain", reason: "Custom printed average is deliberately retained."};
		expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/supported observed damage token/);
	});

	it("keeps raw-only changed explanations, generation, table, candidate, winners and histories outside prior approval", () => {
		const answers = answersFor();
		const batch = preview([target()], {one: answers});
		const changed = structuredClone(answers);
		const model = inspectCreatureTransformationInputs({target: target(), resolved: staged()});
		changed.controls[control(model, "armor").id].reason = "A different explicit explanation, identical compiled leaves and totals.";
		expect(compileCreatureTransformationInputs({target: target(), resolved: staged(), answers: changed, table}).automationInputs).toEqual(batch.automationInputs.one);
		for (const extra of [
			{guidedAnswers: {one: changed}}, {generation: 2}, {crTable: table.slice(1)}, {resolved: {...staged(), manualReview: []}}, {conflictDecisions: {one: {con: "incoming"}}},
			{targets: [target("one", source("Bugbear"), [patch("same", {str: 15})])]},
		]) expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, ...extra})).toThrow(/stale/);
		expect(() => { batch.guidedAnswers.one.controls[control(model, "armor").id].reason = "mutation"; }).toThrow(TypeError);
		expect(() => { batch.automationInputs.one.cr.assumptions.routines[0].rounds[0].value = 11; }).toThrow(TypeError);
		const scheduled = structuredClone(answers);
		crAnswer(scheduled).routines[0].rows.push({fixed: {value: 0, source: {name: "Reviewed harmless rider", source: "MM"}, reason: "Explicit zero damage."},
			counts: [1, 0, 0],
			targets: [1, 1, 1],
			timing: "conditional",
			reason: "Round-one-only harmless rider."});
		const scheduledBatch = preview([target()], {one: scheduled});
		crAnswer(scheduled).routines[0].rows[1].counts = [0, 1, 0];
		const rescheduled = compileCreatureTransformationInputs({target: target(), resolved: staged(), answers: scheduled, table});
		expect(rescheduled.automationInputs.cr.assumptions.routines[0].rounds).toEqual(scheduledBatch.automationInputs.one.cr.assumptions.routines[0].rounds);
		expect(() => createCreatureTransformationChanges({batch: scheduledBatch, targets: scheduledBatch.targets, guidedAnswers: {one: scheduled}})).toThrow(/raw guided answers/);
	});

	it("blocks clipped per-token PB arithmetic instead of using an incorrect linear coefficient", () => {
		const base = source("Bugbear");
		base.action[0].entries[0] = "{@hit 4} to hit. 0 ({@damage 1d2 - 3}) damage.";
		const subject = target("one", base);
		const answers = answersFor(subject);
		const model = inspectCreatureTransformationInputs({target: subject, resolved: staged()});
		answers.controls[token(model, "Morningstar", "damage").id] = {mode: "ability", ability: "str", proficiency: 2, fixed: -9, reason: "Explicit zero-clipping arithmetic control."};
		expect(preview([subject], {one: answers}).skipped[0].reason).toMatch(/per-token zero-floor/);
	});

	it("preserves validated generated PB ownership and later same-value authored PB through real current-history inputs", () => {
		const first = save(preview())[0].addOperations[0];
		for (const authored of [false, true]) {
			const subject = target("one", source("Bugbear"), [first, ...authored ? [patch("authored", {profBonus: 2, pbNote: "+2"})] : []]);
			const answers = answersFor(subject);
			crAnswer(answers, subject).override = {cr: "5", reason: "Second estimate crosses ordinary PB while honoring actual history ownership."};
			const {batch} = incoming([subject], {one: answers});
			expect(batch.skipped).toEqual([]);
			expect(batch.previews[0].preview.proposed.profBonus).toBe(authored ? 2 : 3);
			expect(batch.guidedModels[0].estimate.receipt.proficiency).toMatchObject({source: authored ? "source-profBonus" : "derived-cr", history: {ownership: authored ? "explicit" : "derived"}});
		}
	});

	it("does not turn projection-only conflict winners or provisional consent into actual approval", () => {
		const first = save(preview())[0].addOperations[0];
		const subject = target("one", source("Bugbear"), [first]);
		const answers = answersFor(subject);
		const pending = preview([subject], {one: answers});
		expect(pending.guidedModels[0].projection.con).toBe(17);
		expect(pending.previews[0].preview.canApply).toBe(false);
		expect(() => save(pending)).toThrow(/winner/);
		const decisions = {one: Object.fromEntries(pending.previews[0].preview.conflicts.map(it => [it.path, "existing"]))};
		const retained = preview([subject], {one: answers}, {conflictDecisions: decisions});
		expect(retained.previews[0].preview.proposed.con).toBe(15);
		expect(preview([target()], {one: answersFor()}, {dmApproved: false}).previews).toEqual([]);
	});

	it("saves only frozen concrete leaves/receipts through Registry and Encounter adapter/store, then replays/removes without live inputs", async () => {
		const rows = structuredClone(table);
		const recipe = staged();
		const batch = preview([target()], {one: answersFor()}, {resolved: recipe, crTable: rows});
		const edit = save(batch)[0];
		const expected = batch.previews[0].preview.proposed;
		rows.length = 0;
		recipe.automation.hitPoints = "changed after save";
		expect(JSON.stringify(edit)).not.toMatch(/targetKey|tokenId|guidedAnswers|"rows"|"automation":/);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: source("Bugbear"), ...edit});
		expect(registry.getCreature({creature: source("Bugbear")})).toEqual(expected);
		registry.applyChanges({creature: source("Bugbear"), addOperations: [], removeIds: ["guided-owner"]});
		expect(registry.getCreature({creature: source("Bugbear")})).toEqual(source("Bugbear"));
		let state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "Guided", saveId: "guided", items: [{h: "bugbear_mm", c: 1}]}, pResolveItem: async () => ({entity: source("Bugbear")}), fnUid: () => "one"});
		const values = new Map();
		const store = new EncounterWorkspaceStore({storage: {pGetForPage: async key => values.get(key), pSetForPage: async (key, value) => values.set(key, JSON.parse(JSON.stringify(value)))}});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async result => { state = await store.pSave(result.state); }});
		await adapter.applyChanges(edit);
		state = await store.pLoad();
		expect(adapter.getCreature()).toEqual(expected);
		await adapter.removeOperation({operationId: "guided-owner"});
		state = await store.pLoad();
		expect(adapter.getCreature()).toEqual(source("Bugbear"));
	});

	it("loads actual DataUtil-annotated CR rows into real guided readiness without changing cached rows", async () => {
		const cached = {cr: table.map(row => ({...row}))};
		DataUtil._mutAddProps(cached);
		expect(cached.cr.every(row => Object.hasOwn(row, "__prop") && row.__prop === "cr")).toBe(true);
		const original = JSON.stringify(cached);
		const loaded = await pLoadCreatureTransformationInputTable({requested: true, dataUtil: {loadJSON: async () => cached}});
		const batch = preview([target()], {one: answersFor()}, {crTable: loaded});
		expect(batch.skipped).toEqual([]);
		expect(batch.guidedModels[0].estimate.receipt).toMatchObject({estimatedCr: "1", damagePerRound: 12, accuracy: 5});
		expect(batch.previews[0].preview.proposed).toMatchObject({hp: {average: 32}, cr: {cr: "1", xp: 200}});
		expect(batch).toEqual(preview());
		expect(loaded).toEqual(table);
		expect(loaded).not.toBe(cached.cr);
		loaded.forEach((row, i) => { expect(row).not.toBe(cached.cr[i]); });
		expect(JSON.stringify(cached)).toBe(original);
	});

	it.each([
		["wrong transport owner", {__prop: "monster"}],
		["unknown row property", {_unexpected: true}],
		["noncanonical numeric data", {ac: -1}],
	])("keeps %s visible to the unchanged strict estimator", async (label, invalid) => {
		const cached = {cr: table.map(row => ({...row}))};
		DataUtil._mutAddProps(cached);
		Object.assign(cached.cr[0], invalid);
		const original = JSON.stringify(cached);
		const loaded = await pLoadCreatureTransformationInputTable({requested: true, dataUtil: {loadJSON: async () => cached}});
		const batch = preview([target()], {one: answersFor()}, {crTable: loaded});
		expect(batch.previews).toEqual([]);
		expect(batch.skipped[0].reason).toMatch(/invalid, missing, reordered or noncanonical row/);
		expect(JSON.stringify(cached)).toBe(original);
	});

	it("keeps Dracolich confirmations narrow, never infers age, and rejects legacy/unsupported guided identities", async () => {
		const resolved = staged("catalog:dracolich|mm");
		const subject = target("dragon", source("Adult Green Dragon"));
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		const values = {age: "adult", trueDragon: true, shadowDragon: false, physiology: "amphibious-only", lairActions: "retain"};
		const answers = {targetKey: model.targetKey, controls: Object.fromEntries(model.controls.map(it => [it.id, {value: values[it.selector]}]))};
		expect(compileCreatureTransformationInputs({target: subject, resolved, answers}).status).toBe("ready");
		delete answers.controls[control(model, "confirmation", it => it.selector === "age").id];
		expect(compileCreatureTransformationInputs({target: subject, resolved, answers}).requirements[0].selector).toBe("age");
		answers.controls[control(model, "confirmation", it => it.selector === "age").id] = {value: "young"};
		expect(compileCreatureTransformationInputs({target: subject, resolved, answers}).status).toBe("ineligible");
		answers.controls[control(model, "confirmation", it => it.selector === "age").id] = {value: "adult"};
		answers.controls[control(model, "confirmation", it => it.selector === "physiology").id] = {value: "other-living-traits"};
		expect(compileCreatureTransformationInputs({target: subject, resolved, answers}).requirements[0].reason).toMatch(/only Amphibious removal/);
		const legacy = resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg"});
		expect(preview([target()], {one: answersFor()}, {resolved: legacy}).skipped[0].status).toBe("unsupported");
		const dataUtil = {loadJSON: jest.fn(async () => ({cr: table}))};
		expect(await pLoadCreatureTransformationInputTable({requested: false, dataUtil})).toBeNull();
		expect(dataUtil.loadJSON).not.toHaveBeenCalled();
		expect(await pLoadCreatureTransformationInputTable({requested: true, dataUtil})).toEqual(table);
		expect(dataUtil.loadJSON).toHaveBeenCalledWith("data/msbcr.json");
		dataUtil.loadJSON.mockRejectedValueOnce(new Error("Source unavailable"));
		await expect(pLoadCreatureTransformationInputTable({requested: true, dataUtil})).rejects.toThrow("Source unavailable");
		const broken = staged();
		broken.automation.hitPoints = "not-a-supported-profile";
		expect(() => preview([target()], {one: answersFor()}, {resolved: broken})).toThrow();
	});

	it("binds actual existing Drow innate headers while retaining fixed poison DC and spell uses, without granting new spells", () => {
		const subject = target("drow", source("Drow"));
		const resolved = staged();
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		const controls = {[control(model, "armor").id]: {mode: "retain", reason: "Unchanged Dexterity and chain shirt."},
			[control(model, "proficiencyBonus").id]: {value: 2, reason: "Explicit reviewed current source PB for this M2-only binding."}};
		for (const item of model.controls.filter(it => it.kind === "token")) {
			controls[item.id] = item.selector.kind === "dc" && item.selector.section !== "spellcasting"
				? {mode: "fixed", value: 13, reason: "Source-fixed poison."}
				: {mode: "ability",
					ability: item.selector.section === "spellcasting" ? "cha" : "dex",
					proficiency: item.selector.kind === "damage" ? 0 : 1,
					fixed: item.selector.kind === "dc" ? 8 : 0,
					reason: "Explicit reviewed header/weapon binding."};
		}
		const batch = preview([subject], {drow: {targetKey: model.targetKey, controls}});
		expect(batch.skipped).toEqual([]);
		const proposed = batch.previews[0].preview.proposed;
		expect(proposed.spellcasting[0].headerEntries[0]).toContain("{@dc 9}");
		expect(proposed.spellcasting[0].daily).toEqual(subject.baseCreature.spellcasting[0].daily);
		expect(proposed.action[1].entries[0]).toContain("{@dc 13}");
		expect(batch.previews[0].preview.resolved.changes.some(it => it.type === "addInnateSpellcasting")).toBe(false);
		expect(model.suggestions).toContainEqual(expect.objectContaining({kind: "castingAbility", value: "cha", accepted: false}));
	});
});
