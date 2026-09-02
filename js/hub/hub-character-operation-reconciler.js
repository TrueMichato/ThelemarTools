import {applySemanticOperation, normalizeSemanticOperation, SEMANTIC_OPERATION_KINDS, SEMANTIC_OPERATION_VERSION} from "./hub-semantic-operations.js";

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

export const COVERAGE_VERSION = 1;
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
 * @param appliedOperationIds Operation ids already folded into this track.
 */
export function createCoverage ({revision = null, acceptedSequence = null, appliedOperationIds = []} = {}) {
	return {
		revision: Number.isInteger(revision) ? revision : null,
		acceptedSequence: Number.isInteger(acceptedSequence) ? acceptedSequence : null,
		appliedOperationIds: appliedOperationIds instanceof BoundedIdSet
			? appliedOperationIds.clone()
			: new BoundedIdSet({ids: Array.isArray(appliedOperationIds) ? appliedOperationIds : []}),
	};
}

export function cloneCoverage (coverage) {
	return createCoverage({
		revision: coverage?.revision ?? null,
		acceptedSequence: coverage?.acceptedSequence ?? null,
		appliedOperationIds: coverage?.appliedOperationIds,
	});
}

export function serializeCoverage (coverage) {
	return {
		revision: coverage?.revision ?? null,
		acceptedSequence: coverage?.acceptedSequence ?? null,
		appliedOperationIds: coverage?.appliedOperationIds?.toArray?.() || [],
	};
}

export function deserializeCoverage (raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createCoverage();
	return createCoverage({
		revision: raw.revision,
		acceptedSequence: raw.acceptedSequence,
		appliedOperationIds: raw.appliedOperationIds,
	});
}

/**
 * Decide what a single track must do for an operation resulting in `resultingCharacterRevision`.
 * Unknown coverage never guesses — it demands a resync so a stale draft is neither double-applied nor silently
 * left behind.
 */
export function classifyTrack ({coverage, operationId, resultingCharacterRevision}) {
	if (!coverage) return TRACK_DECISION.RESYNC;
	if (operationId && coverage.appliedOperationIds?.has?.(operationId)) return TRACK_DECISION.COVERED;
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
	if (!Number.isInteger(resultingCharacterRevision) || resultingCharacterRevision < 0) {
		return {status: RECONCILE_STATUS.REJECTED, error: {code: "OPERATION_INVALID", message: `Resulting character revision is invalid.`}};
	}

	const validated = validateDeliveredOperation(operation);
	if (validated.error) return {status: RECONCILE_STATUS.REJECTED, error: validated.error};
	const normalized = validated.operation;
	const operationId = normalized.operationId || null;

	if (eventId && appliedEventIds?.has?.(eventId)) return {status: RECONCILE_STATUS.SUPPRESSED, operation: normalized, decisions: {}};
	if (operationId && appliedOperationIds?.has?.(operationId)) return {status: RECONCILE_STATUS.SUPPRESSED, operation: normalized, decisions: {}};

	const decisions = {};
	for (const [name, track] of Object.entries(tracks || {})) {
		if (!track) continue;
		decisions[name] = classifyTrack({
			coverage: track.coverage,
			operationId,
			resultingCharacterRevision,
		});
	}

	const names = Object.keys(decisions);
	if (names.some(name => decisions[name] === TRACK_DECISION.RESYNC)) {
		return {status: RECONCILE_STATUS.RESYNC_REQUIRED, operation: normalized, decisions};
	}

	const staged = {};
	for (const name of names) {
		if (decisions[name] !== TRACK_DECISION.APPLY) continue;
		const result = applyToTrack({data: tracks[name].data, operation: normalized});
		if (result.error) return {status: RECONCILE_STATUS.BLOCKED, operation: normalized, decisions, error: result.error, blockedTrack: name};
		staged[name] = result.data;
	}

	if (!Object.keys(staged).length) return {status: RECONCILE_STATUS.SUPPRESSED, operation: normalized, decisions};

	return {
		status: RECONCILE_STATUS.APPLIED,
		operation: normalized,
		decisions,
		staged,
		revisionNext: resultingCharacterRevision,
	};
}

globalThis.HubCharacterOperationReconciler = {
	BoundedIdSet,
	COVERAGE_VERSION,
	RECONCILE_STATUS,
	TRACK_DECISION,
	applyToTrack,
	classifyTrack,
	cloneCoverage,
	createCoverage,
	deserializeCoverage,
	planAppliedOperation,
	serializeCoverage,
	validateDeliveredOperation,
};
