import {getPendingEffectPresentation} from "./hub-effect-presentation.js";

export const CHARACTER_OPERATION_EVENT_TYPES = Object.freeze([
	"character.operation.proposed",
	"character.operation.applied",
	"character.operation.rejected",
	"character.operation.cancelled",
	"character.operation.expired",
]);

export const CHARACTER_OPERATION_EVENT_TYPE_SET = new Set(CHARACTER_OPERATION_EVENT_TYPES);

const _TERMINAL_STATUSES = new Map([
	["character.operation.rejected", "rejected"],
	["character.operation.cancelled", "cancelled"],
	["character.operation.expired", "expired"],
]);

const _isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);

export function getCharacterOperationRouting (event) {
	if (!CHARACTER_OPERATION_EVENT_TYPE_SET.has(event?.type)) return null;

	if (event.type === "character.operation.applied") {
		const operation = event.payload?.operation;
		if (
			event.aggregateType !== "character"
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
		) return null;
		return {
			operationId: operation.operationId,
			payload: {
				operation: {
					operationId: operation.operationId,
					kind: operation.kind,
					version: operation.version,
					targetCharacterId: operation.targetCharacterId,
					arguments: structuredClone(operation.arguments),
				},
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
	if (
		event.aggregateType !== "semantic_operation"
		|| typeof payload?.operationId !== "string"
		|| !payload.operationId
		|| event.aggregateId !== payload.operationId
		|| typeof payload.targetCharacterId !== "string"
		|| !payload.targetCharacterId
		|| payload.status !== expectedStatus
		|| !_isRecord(payload.sourceDisplaySnapshot)
		|| !_isRecord(payload.targetDisplaySnapshot)
		|| !_isRecord(payload.effectDisplaySnapshot)
		|| (
			expectedStatus === "proposed"
				? typeof payload.expiresAt !== "string" || !payload.expiresAt
				: typeof payload.reason !== "string" || !payload.reason
		)
	) return null;
	const pendingAction = expectedStatus === "proposed"
		? getPendingEffectPresentation({
			operationId: payload.operationId,
			status: payload.status,
			sourceDisplaySnapshot: payload.sourceDisplaySnapshot,
			effectDisplaySnapshot: payload.effectDisplaySnapshot,
			expiresAt: payload.expiresAt,
		})
		: null;
	if (expectedStatus === "proposed" && !pendingAction) return null;
	return {
		operationId: payload.operationId,
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
