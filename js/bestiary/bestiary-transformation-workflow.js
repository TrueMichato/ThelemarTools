import {BestiaryQuickActionsUtil} from "./bestiary-quick-actions-engine.js";
import {normalizeCreatureTransformation} from "./bestiary-transformation-catalog-adapter.js";
import {compileCreatureTransformation} from "../creature-transformations.js";
import {selectFrozenCreatureTransformation} from "../creature-transformation-forms.js";
import {BestiaryCreatureTransformation} from "./bestiary-creature-transformation.js";
import {compileCreatureTransformationInputs, freezeCreatureTransformationInputs, proposeCreatureTransformationResidual} from "./bestiary-transformation-inputs.js";
import {getLycanthropeProfile} from "../creature-transformation-lycanthrope.js";
import {compileCreatureTransformationSourceEstimate, compileCreatureTransformationSourceInputs, SOURCE_ESTIMATE_MODE} from "./bestiary-transformation-source-inputs.js";

const SKIPPABLE_CODES = new Set([
	"CREATURE_TRANSFORMATION_INELIGIBLE",
	"CREATURE_TRANSFORMATION_ENTRY_MATCH",
	"CREATURE_TRANSFORMATION_DAMAGE_MISSING",
	"CREATURE_TRANSFORMATION_TOO_LARGE",
	"CREATURE_TRANSFORMATION_NO_EFFECT",
	"CREATURE_TRANSFORMATION_INPUT_REQUIRED",
]);

function compileTarget ({target, resolved, automationInputs, legendaryGroups}) {
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
	if (automationInputs[target.id]?.sourceEstimate) {
		return normalizeCreatureTransformation(compileCreatureTransformationSourceEstimate({
			target, resolved, ...automationInputs[target.id].sourceEstimate, proficiencyContext: getProficiencyContext({target, current}), legendaryGroups,
		}));
	}
	return normalizeCreatureTransformation(compileCreatureTransformation({
		resolved,
		current,
		chassisSource: target.baseCreature.source,
		inputs: automationInputs[target.id],
		proficiencyContext: automationInputs[target.id]?.cr ? getProficiencyContext({target, current}) : null,
		legendaryGroups,
		...(resolved.version === 2 && (getLycanthropeProfile(resolved.id) || (resolved.id === "catalog:vampire|mm" && resolved.selectedOptions.outcome?.[0] === "vampire"))
			? {baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: target.baseCreature, operations: target.operations})} : {}),
	}));
}

function getProficiencyContext ({target, current}) {
	const {priorWrites} = BestiaryQuickActionsUtil._getReplayState({baseCreature: target.baseCreature, operations: target.operations});
	const numericPath = path => /^(?:str|dex|con|int|wis|cha|hp|ac|passive|profBonus|pbNote|cr|save\.[a-z]+|skill\.[a-z ]+|(?:trait|action|bonus|reaction|legendary|spellcasting):.+)$/.test(path);
	let owner = null;
	for (const [index, operation] of (target.operations || []).entries()) {
		if (operation.type === "applyCreatureTransformation") {
			const {resolved, integrity, approvedConflicts, conflictDecisions} = operation.data;
			const setter = resolved.changes.find(it => it.type === "setProficiencyBonus");
			if (!setter) continue;
			const grouped = !!resolved.estimation || (resolved.version === 2 && resolved.id === "catalog:zombie|dmg");
			const operationId = operation.id || `${resolved.id}@${index}`;
			const writes = priorWrites.filter(it => it.operationKey === integrity && it.operationId === operationId);
			if (grouped && approvedConflicts.some(it => numericPath(it.path) && conflictDecisions[it.path] === "existing")
				&& !writes.some(it => numericPath(it.path))) {
				// Removal can eliminate a formerly retained conflict. Check the actual replay prefix,
				// not only the old saved decision, before attributing a same-value PB setter.
				const actual = BestiaryQuickActionsUtil.previewCreatureTransformation({
					baseCreature: target.baseCreature,
					operations: target.operations.slice(0, index),
					resolved,
					acknowledgedPrerequisites: operation.data.acknowledgedPrerequisites,
					dmApproved: operation.data.dmApproved,
				});
				if (actual.conflicts.some(it => numericPath(it.path) && conflictDecisions[it.path] === "existing")) continue;
			}
			const receipt = resolved.changes.find(it => it.type === "setChallengeRating")?.receipt;
			if (writes.filter(it => ["profBonus", "pbNote"].includes(it.path)).some(it => it.after !== (it.path === "profBonus" ? setter.value : `+${setter.value}`))) {
				throw new Error("Validated PB writes disagree with the frozen numeric setter.");
			}
			owner = {ownership: receipt?.proficiency.source === "derived-cr" ? "derived" : "explicit", index, integrity, value: setter.value};
			continue;
		}
		const patch = operation.data?.patch ?? operation.patch;
		if (patch) {
			const set = Object.hasOwn(patch, "set") || Object.hasOwn(patch, "remove") ? patch.set || {} : patch;
			const paths = [...Object.keys(set), ...patch.remove || []];
			if (paths.some(path => /^(?:profBonus|pbNote)(?:\.|$)/.test(path))) {
				owner = {ownership: "explicit", index, integrity: null, value: current.profBonus ?? Number(current.pbNote)};
			}
		}
		if (owner && !["patch", "addEntry", "removeEntry", "setLegendaryGroup"].includes(operation.type)) {
			owner = {ownership: "ambiguous", index, integrity: null, value: current.profBonus ?? Number(current.pbNote)};
		}
	}
	if (owner && current.profBonus === undefined && current.pbNote === undefined) return null;
	return owner;
}

export function proposeCreatureTransformationTargetResidual ({target, ...options}) {
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
	return proposeCreatureTransformationResidual({...options, target, proficiencyContext: getProficiencyContext({target, current})});
}

function getEligibilityDetail (creature, rules, dmApproved) {
	const type = typeof creature.type === "string" ? creature.type : creature.type?.type;
	const cr = typeof creature.cr === "object" ? creature.cr?.cr : creature.cr;
	const crNumber = typeof cr === "string" && cr.includes("/")
		? Number(cr.split("/")[0]) / Number(cr.split("/")[1]) : Number(cr);
	const reasons = [];
	for (const rule of rules) {
		if (rule.types && !rule.types.some(it => it.toLowerCase() === `${type || ""}`.toLowerCase())) reasons.push(`requires type ${rule.types.join(" or ")}; current type ${type || "unknown"}`);
		if (rule.sizes && !rule.sizes.some(it => creature.size?.includes(it))) reasons.push(`requires size ${rule.sizes.join(" or ")}; current size ${creature.size?.join(", ") || "unknown"}`);
		if (rule.minCr != null && (!Number.isFinite(crNumber) || crNumber < rule.minCr)) reasons.push(`requires CR at least ${rule.minCr}; current CR ${cr ?? "unknown"}`);
		if (rule.maxCr != null && (!Number.isFinite(crNumber) || crNumber > rule.maxCr)) reasons.push(`requires CR at most ${rule.maxCr}; current CR ${cr ?? "unknown"}`);
		if (rule.minInt != null && !(creature.int >= rule.minInt)) reasons.push(`requires Intelligence at least ${rule.minInt}; current ${creature.int ?? "unknown"}`);
		if (rule.maxInt != null && !(creature.int <= rule.maxInt)) reasons.push(`requires Intelligence at most ${rule.maxInt}; current ${creature.int ?? "unknown"}`);
		if (rule.requiresTrait && !(creature.trait || []).some(it => it.name?.toLowerCase() === rule.requiresTrait.toLowerCase())) reasons.push(`requires trait ${rule.requiresTrait}`);
		if (rule.dmApproval && !dmApproved) reasons.push("requires explicit DM approval");
	}
	return reasons.join("; ");
}

export function previewCreatureTransformationTargets ({targets, resolved, automationInputs = {}, guidedAnswers, crTable, generation, acknowledgedPrerequisites = [], dmApproved = false, conflictDecisions = {}, validateOperation = null, legendaryGroups}) {
	if (!Array.isArray(targets) || !targets.length || new Set(targets.map(it => it.id)).size !== targets.length) {
		throw new Error("Choose at least one distinct monster to transform.");
	}
	const staged = Object.hasOwn(resolved, "automation");
	const guided = guidedAnswers !== undefined;
	if (guided && (!guidedAnswers || typeof guidedAnswers !== "object" || Array.isArray(guidedAnswers)
		|| Object.keys(guidedAnswers).some(id => !targets.some(target => target.id === id)) || Object.keys(automationInputs).length)) throw new Error("Guided answers must be keyed by selected target ID, without separate automation inputs.");
	if (Object.hasOwn(resolved, "version") && !staged) throw new Error("Resolve the pending staged profile before previewing targets; a concrete snapshot cannot be reused as a batch recipe.");
	const recipe = staged ? structuredClone(resolved) : normalizeCreatureTransformation(resolved);
	if (staged && (!automationInputs || typeof automationInputs !== "object" || Array.isArray(automationInputs)
		|| Object.keys(automationInputs).some(id => !targets.some(target => target.id === id)))) throw new Error("Automation inputs must be keyed by selected target ID.");
	const previews = [];
	const skipped = [];
	const guidedModels = [];
	if (guided) automationInputs = {};
	for (const target of targets) {
		try {
			if (guided) {
				const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
				const compiler = guidedAnswers[target.id]?.mode === SOURCE_ESTIMATE_MODE ? compileCreatureTransformationSourceInputs : compileCreatureTransformationInputs;
				const model = compiler({target, resolved: recipe, answers: guidedAnswers[target.id], table: crTable, proficiencyContext: getProficiencyContext({target, current}), legendaryGroups});
				guidedModels.push(model);
				if (model.status !== "ready") {
					skipped.push({id: target.id, label: target.label, status: model.status, reason: model.requirements.map(it => it.reason).join("; "), requirements: model.requirements});
					continue;
				}
				automationInputs[target.id] = model.automationInputs;
			}
			const options = {
				baseCreature: target.baseCreature,
				operations: target.operations,
				resolved: staged ? compileTarget({target, resolved: recipe, automationInputs, legendaryGroups}) : recipe,
				acknowledgedPrerequisites,
				dmApproved,
				conflictDecisions: conflictDecisions[target.id] || {},
			};
			const preview = BestiaryQuickActionsUtil.previewCreatureTransformation(options);
			if (validateOperation) {
				// Temporary winners validate storage limits only; unresolved choices remain for the DM.
				const preflightDecisions = Object.fromEntries(preview.conflicts.map(({path}) => [path, conflictDecisions[target.id]?.[path] || "incoming"]));
				const preflight = preview.canApply ? preview : BestiaryQuickActionsUtil.previewCreatureTransformation({...options, conflictDecisions: preflightDecisions});
				const operation = BestiaryQuickActionsUtil.createCreatureTransformationOperation({
					baseCreature: target.baseCreature,
					operations: target.operations,
					preview: preflight,
					conflictDecisions: preflightDecisions,
				});
				try { validateOperation({target, operation}); } catch (e) {
					if (!(e instanceof Error)) throw e;
					skipped.push({id: target.id, label: target.label, reason: e.message});
					continue;
				}
			}
			previews.push({id: target.id, label: target.label, preview});
		} catch (e) {
			if (!SKIPPABLE_CODES.has(e.code)) throw e;
			const reason = e.code === "CREATURE_TRANSFORMATION_INELIGIBLE"
				? getEligibilityDetail(BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations}), recipe.eligibility, dmApproved)
				: "";
			skipped.push({id: target.id, label: target.label, reason: reason ? `${e.message} ${reason}.` : e.message});
		}
	}
	const batch = {targets: structuredClone(targets), resolved: recipe, previews, skipped, ...(staged ? {automationInputs: structuredClone(automationInputs)} : {})};
	if (staged && legendaryGroups !== undefined) batch.legendaryGroups = structuredClone(legendaryGroups);
	if (!guided) return batch;
	return freezeCreatureTransformationInputs({...batch,
		guidedModels,
		guidedAnswers: structuredClone(guidedAnswers),
		crTable: structuredClone(crTable),
		generation: structuredClone(generation),
		conflictDecisions: structuredClone(conflictDecisions)});
}

export function createCreatureTransformationChanges ({batch, targets, conflictDecisions = {}, resolved = batch.resolved, automationInputs = batch.automationInputs,
	guidedAnswers = batch.guidedAnswers, crTable = batch.crTable, generation = batch.generation, legendaryGroups = batch.legendaryGroups}) {
	if (JSON.stringify(batch.targets) !== JSON.stringify(targets)) throw new Error("Transformation preview is stale: the selection or a target history changed. Preview again.");
	if (Object.hasOwn(batch, "guidedAnswers")) {
		if (JSON.stringify(batch.guidedAnswers) !== JSON.stringify(guidedAnswers) || JSON.stringify(batch.crTable) !== JSON.stringify(crTable)
			|| JSON.stringify(batch.generation) !== JSON.stringify(generation) || JSON.stringify(batch.resolved) !== JSON.stringify(resolved)
			|| JSON.stringify(batch.conflictDecisions) !== JSON.stringify(conflictDecisions)) throw new Error("Transformation preview is stale: raw guided answers, table, candidate, generation or conflict winners changed. Preview again.");
		for (const {id} of batch.previews) {
			const target = targets.find(it => it.id === id);
			const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
			const compiler = guidedAnswers[id]?.mode === SOURCE_ESTIMATE_MODE ? compileCreatureTransformationSourceInputs : compileCreatureTransformationInputs;
			const model = compiler({target, resolved, answers: guidedAnswers[id], table: crTable, proficiencyContext: getProficiencyContext({target, current}), legendaryGroups});
			if (model.status !== "ready" || JSON.stringify(model.automationInputs) !== JSON.stringify(automationInputs[id])) throw new Error("Transformation preview is stale: guided target inputs changed. Preview again.");
		}
	}
	if (Object.hasOwn(batch, "automationInputs") && JSON.stringify(batch.automationInputs) !== JSON.stringify(automationInputs)) throw new Error("Transformation preview is stale: the target input answers changed. Preview again.");
	if (JSON.stringify(batch.legendaryGroups) !== JSON.stringify(legendaryGroups)) throw new Error("Transformation preview is stale: the resolved legendary groups changed. Preview again.");
	if (batch.previews.some(({preview}) => !preview.canApply)) throw new Error("Choose a winner for every conflicting statblock field before applying.");
	return batch.previews.map(({id, preview}) => {
		const target = targets.find(it => it.id === id);
		if (Object.hasOwn(batch, "automationInputs")) {
			const compiled = compileTarget({target, resolved, automationInputs, legendaryGroups});
			if (JSON.stringify(compiled) !== JSON.stringify(preview.resolved)) throw new Error("Transformation preview is stale: the staged profile or target inputs changed. Preview again.");
		}
		const operation = BestiaryQuickActionsUtil.createCreatureTransformationOperation({
			baseCreature: target.baseCreature,
			operations: target.operations,
			preview,
			conflictDecisions: conflictDecisions[id] || {},
		});
		return {id, addOperations: [operation], removeIds: []};
	});
}

export function previewCreatureTransformationForm ({target, operationId, formId, conflictDecisions = {}, validateChange = null}) {
	// Validate the current complete history before locating/replacing its frozen owner.
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
	const index = target.operations.findIndex(it => it.id === operationId);
	const owner = target.operations[index];
	if (index < 0 || owner.type !== "applyCreatureTransformation" || !owner.data.resolved.frozenForms) throw new Error("Choose an existing frozen transformation form owner.");
	const resolved = selectFrozenCreatureTransformation({resolved: owner.data.resolved, formId});
	if (formId === owner.data.resolved.frozenForms.activeForm) {
		return {target: structuredClone(target), operationId, formId, conflictDecisions: structuredClone(conflictDecisions), noChange: true, canApply: false, current, proposed: current, diff: {fields: [], entries: []}};
	}
	const prefix = target.operations.slice(0, index);
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({
		baseCreature: target.baseCreature,
		operations: prefix,
		resolved,
		acknowledgedPrerequisites: owner.data.acknowledgedPrerequisites,
		dmApproved: owner.data.dmApproved,
		conflictDecisions,
	});
	const batch = {target: structuredClone(target), operationId, formId, conflictDecisions: structuredClone(conflictDecisions), noChange: false, canApply: preview.canApply, preview, current, proposed: null, diff: null};
	if (!preview.canApply) return batch;
	const operation = {...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: target.baseCreature, operations: prefix, preview, conflictDecisions}), id: operationId};
	const change = {id: target.id, addOperations: [], removeIds: [], replaceOperation: {operationId, expectedIntegrity: owner.data.integrity, operation}};
	const operations = BestiaryQuickActionsUtil.replaceCreatureTransformationOperation({...change, baseCreature: target.baseCreature, operations: target.operations});
	// Downstream saved decisions are revalidated, never rewritten for the new form.
	const proposed = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations});
	if (validateChange) validateChange({target, change, operations});
	return {...batch, proposed, diff: BestiaryCreatureTransformation.getDiff(current, proposed), change};
}

export function createCreatureTransformationFormChanges ({batch, target, operationId = batch.operationId, formId = batch.formId, conflictDecisions = batch.conflictDecisions}) {
	if (JSON.stringify(batch.target) !== JSON.stringify(target) || operationId !== batch.operationId || formId !== batch.formId
		|| JSON.stringify(conflictDecisions) !== JSON.stringify(batch.conflictDecisions)) throw new Error("Form preview is stale: the owner, form, answers or target history changed. Preview again.");
	const current = previewCreatureTransformationForm({target, operationId, formId, conflictDecisions});
	if (JSON.stringify(current) !== JSON.stringify(batch)) throw new Error("Form preview is stale or has been changed. Preview again.");
	if (current.noChange) return [];
	if (!current.canApply) throw new Error("Choose every conflict winner before switching forms.");
	return [current.change];
}
