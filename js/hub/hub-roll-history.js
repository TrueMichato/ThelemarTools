export const HUB_ROLL_HISTORY_CONTRACT_VERSION = 1;
export const HUB_ROLL_HISTORY_LIMIT = 200;
export const HUB_CAPABILITY_ROLL_HISTORY = "character.roll_history.v1";

const text = (value, limit) => typeof value === "string" ? value.slice(0, limit) : "";

export function projectRollHistoryEvent (event) {
	return {
		id: event.id,
		campaignId: event.campaignId,
		sequence: event.sequence,
		type: "roll.logged",
		actorAccountId: event.actorAccountId,
		aggregateType: "character",
		aggregateId: event.aggregateId,
		createdAt: event.createdAt,
		visibility: event.visibility,
		payload: {
			formula: text(event.payload?.formula, 200),
			total: event.payload?.total,
			context: text(event.payload?.context, 100),
			...(typeof event.payload?.actorCommandId === "string" ? {actorCommandId: text(event.payload.actorCommandId, 200)} : {}),
			detail: {
				title: text(event.payload?.detail?.title, 200),
				breakdown: text(event.payload?.detail?.breakdown, 200),
				resultClass: text(event.payload?.detail?.resultClass, 100),
				resultNote: text(event.payload?.detail?.resultNote, 200),
			},
		},
	};
}

export function isOwnCharacterRoll (event, {campaignId, characterId, accountId}) {
	return event?.type === "roll.logged"
		&& event.campaignId === campaignId
		&& event.aggregateType === "character"
		&& event.aggregateId === characterId
		&& event.actorAccountId === accountId;
}

export function isValidRollHistoryEvent (event, scope) {
	return isOwnCharacterRoll(event, scope)
		&& typeof event.id === "string"
		&& !!event.id
		&& Number.isSafeInteger(event.sequence)
		&& event.sequence > 0
		&& Number.isFinite(new Date(event.createdAt).getTime())
		&& typeof event.payload?.total === "number"
		&& Number.isFinite(event.payload.total)
		&& typeof event.payload?.formula === "string";
}
