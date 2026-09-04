import {getPendingEffectPresentation} from "./hub-effect-presentation.js";

export const CHARACTER_OPERATION_EVENT_TYPES = Object.freeze([
	"character.operation.proposed",
	"character.operation.source_cost_consumed",
	"character.operation.applied",
	"character.operation.rejected",
	"character.operation.cancelled",
	"character.operation.expired",
	"character.operation.failed",
]);

export const CHARACTER_OPERATION_EVENT_TYPE_SET = new Set(CHARACTER_OPERATION_EVENT_TYPES);

export const CHARACTER_OPERATION_LEGS = Object.freeze({
	SOURCE: "source",
	TARGET: "target",
	COMBINED: "combined",
});

const _TERMINAL_STATUSES = new Map([
	["character.operation.rejected", "rejected"],
	["character.operation.cancelled", "cancelled"],
	["character.operation.expired", "expired"],
	["character.operation.failed", "failed"],
]);

const _isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);

export function getOperationLegKey ({operationId, leg}) {
	if (typeof operationId !== "string" || !operationId) return null;
	if (!Object.values(CHARACTER_OPERATION_LEGS).includes(leg)) return null;
	return `${operationId}/${leg}`;
}

export function getCharacterOperationRouting (event) {
	if (!CHARACTER_OPERATION_EVENT_TYPE_SET.has(event?.type)) return null;

	if (event.type === "character.operation.source_cost_consumed") {
		const payload = event.payload;
		if (
			event.aggregateType !== "character"
			|| typeof event.aggregateId !== "string"
			|| !event.aggregateId
			|| typeof payload?.operationId !== "string"
			|| !payload.operationId
			|| payload.leg !== CHARACTER_OPERATION_LEGS.SOURCE
			|| !_isRecord(payload.sourceCost)
			|| !Number.isInteger(payload.resultingSourceCharacterRevision)
			|| payload.resultingSourceCharacterRevision < 0
			|| event.aggregateRevision !== payload.resultingSourceCharacterRevision
		) return null;
		const operationLegKey = getOperationLegKey({
			operationId: payload.operationId,
			leg: CHARACTER_OPERATION_LEGS.SOURCE,
		});
		return {
			characterId: event.aggregateId,
			leg: CHARACTER_OPERATION_LEGS.SOURCE,
			operationId: payload.operationId,
			operationLegKey,
			payload: {
				leg: CHARACTER_OPERATION_LEGS.SOURCE,
				sourceCost: structuredClone(payload.sourceCost),
				resultingCharacterRevision: payload.resultingSourceCharacterRevision,
				resultingSourceCharacterRevision: payload.resultingSourceCharacterRevision,
			},
			// Kept as a compatibility routing alias while sheet consumers migrate from ADR 0012.
			targetCharacterId: event.aggregateId,
			status: "applied",
		};
	}

	if (event.type === "character.operation.applied") {
		const leg = event.payload?.leg ?? CHARACTER_OPERATION_LEGS.TARGET;
		const operation = event.payload?.operation;
		if (
			event.aggregateType !== "character"
			|| ![CHARACTER_OPERATION_LEGS.TARGET, CHARACTER_OPERATION_LEGS.COMBINED].includes(leg)
			|| typeof operation?.operationId !== "string"
			|| !operation.operationId
			|| typeof operation.kind !== "string"
			|| !operation.kind
			|| operation.version !== 1
			|| typeof operation.targetCharacterId !== "string"
			|| !operation.targetCharacterId
			|| !_isRecord(operation.arguments)
			|| event.aggregateId !== operation.targetCharacterId
			|| event.aggregateRevision !== event.payload?.resultingCharacterRevision
			|| (leg === CHARACTER_OPERATION_LEGS.COMBINED && !_isRecord(event.payload?.sourceCost))
		) return null;
		const operationLegKey = getOperationLegKey({operationId: operation.operationId, leg});
		return {
			characterId: operation.targetCharacterId,
			leg,
			operationId: operation.operationId,
			operationLegKey,
			payload: {
				leg,
				operation: {
					operationId: operation.operationId,
					kind: operation.kind,
					version: operation.version,
					targetCharacterId: operation.targetCharacterId,
					arguments: structuredClone(operation.arguments),
				},
				...(leg === CHARACTER_OPERATION_LEGS.COMBINED
					? {sourceCost: structuredClone(event.payload.sourceCost)}
					: {}),
				resultingCharacterRevision: event.payload.resultingCharacterRevision,
			},
			targetCharacterId: operation.targetCharacterId,
			status: "applied",
		};
	}

	const payload = event.payload;
	const expectedStatus = event.type === "character.operation.proposed"
		? "proposed"
		: _TERMINAL_STATUSES.get(event.type);
	const isUnscopedCostBearingProposal = expectedStatus === "proposed"
		&& payload?.contractVersion === 1
		&& payload?.targetCharacterId == null
		&& payload?.sourceDisplaySnapshot == null;
	const isUnscopedTerminal = expectedStatus !== "proposed"
		&& payload?.targetCharacterId == null
		&& payload?.sourceDisplaySnapshot == null;
	const isUnscoped = isUnscopedCostBearingProposal || isUnscopedTerminal;
	if (
		event.aggregateType !== "semantic_operation"
		|| typeof payload?.operationId !== "string"
		|| !payload.operationId
		|| event.aggregateId !== payload.operationId
		|| (!isUnscoped && (typeof payload.targetCharacterId !== "string" || !payload.targetCharacterId))
		|| payload.status !== expectedStatus
		|| (!isUnscoped && !_isRecord(payload.sourceDisplaySnapshot))
		|| !_isRecord(payload.targetDisplaySnapshot)
		|| !_isRecord(payload.effectDisplaySnapshot)
		|| (
			expectedStatus === "proposed"
				? typeof payload.expiresAt !== "string" || !payload.expiresAt
				: typeof payload.reason !== "string" || !payload.reason
		)
		|| (expectedStatus === "failed" && payload.reason !== "unavailable")
	) return null;
	if (isUnscopedCostBearingProposal) {
		return {
			characterId: null,
			leg: null,
			operationId: payload.operationId,
			operationLegKey: null,
			payload: {contractVersion: 1},
			targetCharacterId: null,
			status: "proposed",
		};
	}
	const pendingAction = expectedStatus === "proposed"
		? getPendingEffectPresentation({
			operationId: payload.operationId,
			status: payload.status,
			sourceDisplaySnapshot: payload.sourceDisplaySnapshot,
			effectDisplaySnapshot: payload.effectDisplaySnapshot,
			effectOutcomeLabel: payload.effectOutcomeLabel,
			expiresAt: payload.expiresAt,
		})
		: null;
	if (expectedStatus === "proposed" && !pendingAction) return null;
	return {
		characterId: payload.targetCharacterId,
		leg: null,
		operationId: payload.operationId,
		operationLegKey: null,
		payload: expectedStatus === "proposed"
			? {
				...pendingAction,
				capabilities: {canApprove: true, canReject: true},
			}
			: {
				actionId: payload.operationId,
				status: payload.status,
				reason: payload.reason,
			},
		targetCharacterId: payload.targetCharacterId,
		status: expectedStatus,
	};
}
