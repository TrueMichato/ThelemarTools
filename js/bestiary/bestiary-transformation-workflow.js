import {BestiaryQuickActionsUtil} from "./bestiary-quick-actions-engine.js";
import {normalizeCreatureTransformation} from "./bestiary-transformation-catalog-adapter.js";

const SKIPPABLE_CODES = new Set([
	"CREATURE_TRANSFORMATION_INELIGIBLE",
	"CREATURE_TRANSFORMATION_ENTRY_MATCH",
	"CREATURE_TRANSFORMATION_DAMAGE_MISSING",
	"CREATURE_TRANSFORMATION_TOO_LARGE",
	"CREATURE_TRANSFORMATION_NO_EFFECT",
]);

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

export function previewCreatureTransformationTargets ({targets, resolved, acknowledgedPrerequisites = [], dmApproved = false, conflictDecisions = {}, validateOperation = null}) {
	if (!Array.isArray(targets) || !targets.length || new Set(targets.map(it => it.id)).size !== targets.length) {
		throw new Error("Choose at least one distinct monster to transform.");
	}
	const recipe = normalizeCreatureTransformation(resolved);
	const previews = [];
	const skipped = [];
	for (const target of targets) {
		try {
			const options = {
				baseCreature: target.baseCreature,
				operations: target.operations,
				resolved: recipe,
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
	return {targets: structuredClone(targets), resolved: recipe, previews, skipped};
}

export function createCreatureTransformationChanges ({batch, targets, conflictDecisions = {}}) {
	if (JSON.stringify(batch.targets) !== JSON.stringify(targets)) throw new Error("Transformation preview is stale: the selection or a target history changed. Preview again.");
	if (batch.previews.some(({preview}) => !preview.canApply)) throw new Error("Choose a winner for every conflicting statblock field before applying.");
	return batch.previews.map(({id, preview}) => {
		const target = targets.find(it => it.id === id);
		const operation = BestiaryQuickActionsUtil.createCreatureTransformationOperation({
			baseCreature: target.baseCreature,
			operations: target.operations,
			preview,
			conflictDecisions: conflictDecisions[id] || {},
		});
		return {id, addOperations: [operation], removeIds: []};
	});
}
