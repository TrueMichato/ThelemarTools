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
				? (
					!_isRecord(payload.sourceEntity)
					|| typeof payload.effectTemplateId !== "string"
					|| !payload.effectTemplateId
					|| !Object.hasOwn(payload, "choice")
					|| typeof payload.expiresAt !== "string"
					|| !payload.expiresAt
				)
				: typeof payload.reason !== "string" || !payload.reason
		)
	) return null;
	return {
		operationId: payload.operationId,
		payload: expectedStatus === "proposed"
			? {
				operationId: payload.operationId,
				targetCharacterId: payload.targetCharacterId,
				status: payload.status,
				sourceEntity: structuredClone(payload.sourceEntity),
				effectTemplateId: payload.effectTemplateId,
				choice: structuredClone(payload.choice),
				sourceDisplaySnapshot: structuredClone(payload.sourceDisplaySnapshot),
				targetDisplaySnapshot: structuredClone(payload.targetDisplaySnapshot),
				effectDisplaySnapshot: structuredClone(payload.effectDisplaySnapshot),
				expiresAt: payload.expiresAt,
			}
			: {
				operationId: payload.operationId,
				targetCharacterId: payload.targetCharacterId,
				status: payload.status,
				reason: payload.reason,
				sourceDisplaySnapshot: structuredClone(payload.sourceDisplaySnapshot),
				targetDisplaySnapshot: structuredClone(payload.targetDisplaySnapshot),
				effectDisplaySnapshot: structuredClone(payload.effectDisplaySnapshot),
			},
		targetCharacterId: payload.targetCharacterId,
		status: expectedStatus,
	};
}
