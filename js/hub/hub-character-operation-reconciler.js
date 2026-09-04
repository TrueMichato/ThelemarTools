import {applySemanticOperation, normalizeSemanticOperation, SEMANTIC_OPERATION_KINDS, SEMANTIC_OPERATION_VERSION} from "./hub-semantic-operations.js";
import * as SourceCosts from "./hub-source-costs.js";
import {CHARACTER_OPERATION_LEGS, getOperationLegKey} from "./hub-character-operation-events.js";

export {CHARACTER_OPERATION_LEGS};

// ADR 0012 "Operation-aware Character Sheet rebase". For one applied operation `E` the sheet holds an accepted
// authoritative base `B` and live local state `L`; the server produces `R = E(B)` and the sheet must produce
// `F = E(L)` so the follow-up save is `diff(R, F)`. Neither the DM's effect nor the player's unsaved edit is lost.
//
// Coverage is tracked PER TRACK rather than by one accepted revision, because `pGet` stores a freshly fetched
// canonical document (which may already contain `E`) while returning an older recovery draft that becomes `L`.
// A single accepted-revision fence would then skip `E(L)` and let the stale draft undo the operation.

export const TRACK_DECISION = Object.freeze({
	APPLY: "apply",
	COVERED: "covered",
	RESYNC: "resync",
});

export const RECONCILE_STATUS = Object.freeze({
	APPLIED: "applied",
	BLOCKED: "blocked",
	REJECTED: "rejected",
	RESYNC_REQUIRED: "resync_required",
	SUPPRESSED: "suppressed",
});

export const COVERAGE_VERSION = 2;
const _DEFAULT_APPLIED_ID_LIMIT = 256;
const _SERIALIZED_APPLIED_ID_LIMIT = 64;

/**
 * A bounded, insertion-ordered id set. Eviction is safe because the revision fence is the primary idempotency
 * mechanism: an evicted id redelivered later is still caught by `revision >= resultingCharacterRevision`.
 */
export class BoundedIdSet {
	constructor ({ids = [], limit = _DEFAULT_APPLIED_ID_LIMIT} = {}) {
		this._limit = Math.max(1, limit);
		this._ids = new Set();
		for (const id of ids) this.add(id);
	}

	has (id) { return this._ids.has(id); }

	add (id) {
		if (typeof id !== "string" || !id) return false;
		if (this._ids.has(id)) return false;
		this._ids.add(id);
		while (this._ids.size > this._limit) this._ids.delete(this._ids.values().next().value);
		return true;
	}

	toArray ({limit = _SERIALIZED_APPLIED_ID_LIMIT} = {}) {
		const all = [...this._ids];
		return all.slice(Math.max(0, all.length - limit));
	}

	clone () { return new BoundedIdSet({ids: this._ids, limit: this._limit}); }
}

/**
 * Coverage metadata for one document track.
 * @param revision Canonical character revision this track's content corresponds to, or `null` when unknown.
 * @param acceptedSequence Last campaign event sequence known to be reflected, or `null`.
 * @param appliedOperationLegIds Operation-leg ids already folded into this track.
 * @param appliedOperationIds Legacy protocol-3 operation ids, interpreted as target legs only.
 */
export function createCoverage ({
	revision = null,
	acceptedSequence = null,
	appliedOperationLegIds = [],
	appliedOperationIds = [],
} = {}) {
	const operationLegIds = appliedOperationLegIds instanceof BoundedIdSet
		? appliedOperationLegIds.clone()
		: new BoundedIdSet({ids: Array.isArray(appliedOperationLegIds) ? appliedOperationLegIds : []});
	const legacyOperationIds = appliedOperationIds instanceof BoundedIdSet
		? appliedOperationIds.clone()
		: new BoundedIdSet({ids: Array.isArray(appliedOperationIds) ? appliedOperationIds : []});
	for (const operationId of legacyOperationIds.toArray({limit: Number.MAX_SAFE_INTEGER})) {
		operationLegIds.add(getOperationLegKey({operationId, leg: CHARACTER_OPERATION_LEGS.TARGET}));
	}
	for (const operationLegKey of operationLegIds.toArray({limit: Number.MAX_SAFE_INTEGER})) {
		const targetSuffix = `/${CHARACTER_OPERATION_LEGS.TARGET}`;
		if (operationLegKey.endsWith(targetSuffix)) legacyOperationIds.add(operationLegKey.slice(0, -targetSuffix.length));
	}
	return {
		revision: Number.isInteger(revision) ? revision : null,
		acceptedSequence: Number.isInteger(acceptedSequence) ? acceptedSequence : null,
		appliedOperationLegIds: operationLegIds,
		// Retained additively for protocol-3 recovery blobs. Only target legs may appear here.
		appliedOperationIds: legacyOperationIds,
	};
}

export function cloneCoverage (coverage) {
	return createCoverage({
		revision: coverage?.revision ?? null,
		acceptedSequence: coverage?.acceptedSequence ?? null,
		appliedOperationLegIds: coverage?.appliedOperationLegIds,
		...(!coverage?.appliedOperationLegIds ? {appliedOperationIds: coverage?.appliedOperationIds} : {}),
	});
}

export function serializeCoverage (coverage) {
	return {
		revision: coverage?.revision ?? null,
		acceptedSequence: coverage?.acceptedSequence ?? null,
		appliedOperationLegIds: coverage?.appliedOperationLegIds?.toArray?.() || [],
		appliedOperationIds: coverage?.appliedOperationIds?.toArray?.() || [],
	};
}

export function deserializeCoverage (raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createCoverage();
	return createCoverage({
		revision: raw.revision,
		acceptedSequence: raw.acceptedSequence,
		appliedOperationLegIds: raw.appliedOperationLegIds,
		appliedOperationIds: raw.appliedOperationIds,
	});
}

export function markCoverageOperationLeg (coverage, operationLegKey) {
	if (!coverage || typeof operationLegKey !== "string" || !operationLegKey) return false;
	const isAdded = coverage.appliedOperationLegIds?.add?.(operationLegKey) ?? false;
	const targetSuffix = `/${CHARACTER_OPERATION_LEGS.TARGET}`;
	if (operationLegKey.endsWith(targetSuffix)) {
		coverage.appliedOperationIds?.add?.(operationLegKey.slice(0, -targetSuffix.length));
	}
	return isAdded;
}

/**
 * Decide what a single track must do for an operation resulting in `resultingCharacterRevision`.
 * Unknown coverage never guesses — it demands a resync so a stale draft is neither double-applied nor silently
 * left behind.
 */
export function classifyTrack ({
	coverage,
	operationLegKey = null,
	operationId = null,
	leg = CHARACTER_OPERATION_LEGS.TARGET,
	resultingCharacterRevision,
}) {
	if (!coverage) return TRACK_DECISION.RESYNC;
	const legKey = operationLegKey || getOperationLegKey({operationId, leg});
	if (legKey && coverage.appliedOperationLegIds?.has?.(legKey)) return TRACK_DECISION.COVERED;
	// Coverage created in memory by an older protocol-3 client has target-only ids but no leg set.
	if (leg === CHARACTER_OPERATION_LEGS.TARGET && operationId && coverage.appliedOperationIds?.has?.(operationId)) {
		return TRACK_DECISION.COVERED;
	}
	const revision = coverage.revision;
	if (!Number.isInteger(revision)) return TRACK_DECISION.RESYNC;
	if (revision >= resultingCharacterRevision) return TRACK_DECISION.COVERED;
	if (revision === resultingCharacterRevision - 1) return TRACK_DECISION.APPLY;
	return TRACK_DECISION.RESYNC;
}

/**
 * Strictly validate a delivered operation against the closed catalog. The realtime coordinator only checks the
 * event envelope — it accepts any non-empty `kind` string — so catalog validation must happen here.
 */
export function validateDeliveredOperation (operation) {
	if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
		return {error: {code: "OPERATION_INVALID", message: `Operation payload is required.`}};
	}
	if (!SEMANTIC_OPERATION_KINDS.includes(operation.kind)) {
		return {error: {code: "OPERATION_INVALID", message: `Unsupported semantic operation.`}};
	}
	if (operation.version !== SEMANTIC_OPERATION_VERSION) {
		return {error: {code: "OPERATION_VERSION_UNSUPPORTED", message: `Unsupported semantic operation version.`}};
	}
	try {
		return {
			operation: normalizeSemanticOperation({
				operationId: operation.operationId ?? null,
				targetCharacterId: operation.targetCharacterId,
				kind: operation.kind,
				version: operation.version,
				arguments: operation.arguments,
			}),
		};
	} catch (error) {
		return {error: {code: error?.code || "OPERATION_INVALID", message: error?.message || `Operation is invalid.`}};
	}
}

/**
 * Apply one normalized operation to a document, converting applicator failures into a structured `blocked`
 * outcome rather than letting them escape as raw throws.
 */
export function applyToTrack ({data, operation}) {
	try {
		return {data: applySemanticOperation({data, operation})};
	} catch (error) {
		return {error: {code: error?.code || "OPERATION_STATE_INVALID", message: error?.message || `Operation could not be applied.`}};
	}
}

export function validateDeliveredSourceCost (sourceCost) {
	if (typeof SourceCosts.normalizeSourceCost !== "function") {
		return {error: {code: "SOURCE_COST_UNSUPPORTED", message: `Source-cost reconciliation is unavailable.`}};
	}
	try {
		return {sourceCost: SourceCosts.normalizeSourceCost(sourceCost)};
	} catch (error) {
		return {error: {code: error?.code || "SOURCE_COST_INVALID", message: error?.message || `Source cost is invalid.`}};
	}
}

function _getAppliedSourceCostData (result) {
	if (result && typeof result === "object" && !Array.isArray(result)) {
		if (result.data && typeof result.data === "object") return result.data;
		if (result.document && typeof result.document === "object") return result.document;
	}
	return result;
}

export function applySourceCostToTrack ({data, sourceCost}) {
	if (typeof SourceCosts.applySourceCost !== "function") {
		return {error: {code: "SOURCE_COST_UNSUPPORTED", message: `Source-cost reconciliation is unavailable.`}};
	}
	try {
		const result = SourceCosts.applySourceCost({data, sourceCost});
		const dataNext = _getAppliedSourceCostData(result);
		if (!dataNext || typeof dataNext !== "object" || Array.isArray(dataNext)) {
			return {error: {code: "SOURCE_COST_INVALID", message: `Source-cost applicator returned invalid character data.`}};
		}
		return {data: dataNext};
	} catch (error) {
		return {error: {code: error?.code || "SOURCE_COST_STATE_INVALID", message: error?.message || `Source cost could not be applied.`}};
	}
}

export function applyCombinedToTrack ({data, sourceCost, operation}) {
	const costResult = applySourceCostToTrack({data, sourceCost});
	if (costResult.error) return {...costResult, blockedTransform: CHARACTER_OPERATION_LEGS.SOURCE};
	const operationResult = applyToTrack({data: costResult.data, operation});
	if (operationResult.error) return {...operationResult, blockedTransform: CHARACTER_OPERATION_LEGS.TARGET};
	return operationResult;
}

/**
 * Pure planner for one applied operation across a set of named tracks.
 *
 * @param tracks `{[name]: {data, coverage}}` — every document track that may need `E`.
 * @param operation The delivered (unvalidated) operation payload.
 * @param resultingCharacterRevision The revision the server reached by applying this operation.
 * @param eventId Event identity, for idempotency.
 * @param appliedEventIds Committed event ids.
 * @param appliedOperationIds Committed operation ids.
 * @returns `{status, decisions, staged, error}` — `staged` maps track name to its next data. Nothing is mutated.
 */
export function planAppliedOperation ({
	tracks,
	operation,
	resultingCharacterRevision,
	eventId = null,
	appliedEventIds = null,
	appliedOperationIds = null,
}) {
	return planOperationLeg({
		tracks,
		leg: CHARACTER_OPERATION_LEGS.TARGET,
		operation,
		resultingCharacterRevision,
		eventId,
		appliedEventIds,
		appliedOperationIds,
	});
}

/**
 * Pure ADR 0016 planner for a source, target, or combined operation leg.
 *
 * A blocked plan may expose `prepared` working copies for diagnostics/recovery, but never exposes them as
 * committable `staged` data. Callers must preserve every repository track until all transforms and live adoption
 * succeed.
 */
export function planOperationLeg ({
	tracks,
	leg = CHARACTER_OPERATION_LEGS.TARGET,
	operationId: explicitOperationId = null,
	operationLegKey: explicitOperationLegKey = null,
	operation = null,
	sourceCost = null,
	resultingCharacterRevision,
	eventId = null,
	appliedEventIds = null,
	appliedOperationLegIds = null,
	appliedOperationIds = null,
}) {
	if (!Object.values(CHARACTER_OPERATION_LEGS).includes(leg)) {
		return {status: RECONCILE_STATUS.REJECTED, error: {code: "OPERATION_INVALID", message: `Operation leg is invalid.`}};
	}
	if (!Number.isInteger(resultingCharacterRevision) || resultingCharacterRevision < 0) {
		return {status: RECONCILE_STATUS.REJECTED, error: {code: "OPERATION_INVALID", message: `Resulting character revision is invalid.`}};
	}

	let normalized = null;
	if (leg !== CHARACTER_OPERATION_LEGS.SOURCE) {
		const validated = validateDeliveredOperation(operation);
		if (validated.error) return {status: RECONCILE_STATUS.REJECTED, error: validated.error};
		normalized = validated.operation;
	}
	let normalizedSourceCost = null;
	if (leg !== CHARACTER_OPERATION_LEGS.TARGET) {
		const validated = validateDeliveredSourceCost(sourceCost);
		if (validated.error) return {status: RECONCILE_STATUS.REJECTED, error: validated.error};
		normalizedSourceCost = validated.sourceCost;
	}
	const operationId = explicitOperationId || normalized?.operationId || null;
	if (!operationId || (normalized?.operationId && normalized.operationId !== operationId)) {
		return {status: RECONCILE_STATUS.REJECTED, error: {code: "OPERATION_INVALID", message: `Operation id is invalid.`}};
	}
	const operationLegKey = getOperationLegKey({operationId, leg});
	if (explicitOperationLegKey != null && explicitOperationLegKey !== operationLegKey) {
		return {status: RECONCILE_STATUS.REJECTED, error: {code: "OPERATION_INVALID", message: `Operation leg key is invalid.`}};
	}

	if (eventId && appliedEventIds?.has?.(eventId)) {
		return {status: RECONCILE_STATUS.SUPPRESSED, leg, operation: normalized, operationId, operationLegKey, sourceCost: normalizedSourceCost, decisions: {}};
	}
	if (appliedOperationLegIds?.has?.(operationLegKey)) {
		return {status: RECONCILE_STATUS.SUPPRESSED, leg, operation: normalized, operationId, operationLegKey, sourceCost: normalizedSourceCost, decisions: {}};
	}
	// Legacy global ids are target-only.
	if (leg === CHARACTER_OPERATION_LEGS.TARGET && appliedOperationIds?.has?.(operationId)) {
		return {status: RECONCILE_STATUS.SUPPRESSED, leg, operation: normalized, operationId, operationLegKey, sourceCost: normalizedSourceCost, decisions: {}};
	}

	const decisions = {};
	for (const [name, track] of Object.entries(tracks || {})) {
		if (!track) continue;
		decisions[name] = classifyTrack({
			coverage: track.coverage,
			operationLegKey,
			operationId,
			leg,
			resultingCharacterRevision,
		});
	}

	const names = Object.keys(decisions);
	if (names.some(name => decisions[name] === TRACK_DECISION.RESYNC)) {
		return {status: RECONCILE_STATUS.RESYNC_REQUIRED, leg, operation: normalized, operationId, operationLegKey, sourceCost: normalizedSourceCost, decisions};
	}

	const staged = {};
	for (const name of names) {
		if (decisions[name] !== TRACK_DECISION.APPLY) continue;
		const result = leg === CHARACTER_OPERATION_LEGS.SOURCE
			? applySourceCostToTrack({data: tracks[name].data, sourceCost: normalizedSourceCost})
			: leg === CHARACTER_OPERATION_LEGS.COMBINED
				? applyCombinedToTrack({data: tracks[name].data, sourceCost: normalizedSourceCost, operation: normalized})
				: applyToTrack({data: tracks[name].data, operation: normalized});
		if (result.error) {
			return {
				status: RECONCILE_STATUS.BLOCKED,
				leg,
				operation: normalized,
				operationId,
				operationLegKey,
				sourceCost: normalizedSourceCost,
				decisions,
				error: result.error,
				blockedTrack: name,
				blockedTransform: result.blockedTransform || leg,
				prepared: staged,
			};
		}
		staged[name] = result.data;
	}

	if (!Object.keys(staged).length) {
		return {status: RECONCILE_STATUS.SUPPRESSED, leg, operation: normalized, operationId, operationLegKey, sourceCost: normalizedSourceCost, decisions};
	}

	return {
		status: RECONCILE_STATUS.APPLIED,
		leg,
		operation: normalized,
		operationId,
		operationLegKey,
		sourceCost: normalizedSourceCost,
		decisions,
		staged,
		revisionNext: resultingCharacterRevision,
	};
}

globalThis.HubCharacterOperationReconciler = {
	BoundedIdSet,
	CHARACTER_OPERATION_LEGS,
	COVERAGE_VERSION,
	RECONCILE_STATUS,
	TRACK_DECISION,
	applyCombinedToTrack,
	applySourceCostToTrack,
	applyToTrack,
	classifyTrack,
	cloneCoverage,
	createCoverage,
	deserializeCoverage,
	markCoverageOperationLeg,
	planAppliedOperation,
	planOperationLeg,
	serializeCoverage,
	validateDeliveredOperation,
	validateDeliveredSourceCost,
};
