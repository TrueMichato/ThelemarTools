const MAX_SNAPSHOT_LENGTH = 80;

export const HUB_EVENT_SNAPSHOT_VERSION = 1;

function sanitizeCharacterDisplayName (value) {
	if (typeof value !== "string") return "";
	return value
		.replace(/<[^>]*>/g, "")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_SNAPSHOT_LENGTH);
}

export function createCharacterDisplayNameSnapshot (value) {
	return {
		version: HUB_EVENT_SNAPSHOT_VERSION,
		displayName: sanitizeCharacterDisplayName(value) || "A character",
	};
}

function getSnapshotName (snapshot) {
	if (!snapshot || snapshot.version !== HUB_EVENT_SNAPSHOT_VERSION) return "";
	return sanitizeCharacterDisplayName(snapshot.displayName || snapshot.name);
}

/**
 * Event types whose payload must stay metadata-only. ADR 0011 forbids a projection
 * invalidation from carrying any character field or display text, so it is never
 * enriched with a name snapshot — the name is exactly the kind of value a sharing policy
 * may be hiding.
 */
const UNENRICHED_EVENT_TYPES = new Set([
	"character.projection.invalidated",
	"character.operation.proposed",
	"character.operation.applied",
	"character.operation.rejected",
	"character.operation.cancelled",
	"character.operation.expired",
	"party_inventory.invalidated",
	"transfer.reserved",
	"transfer.committed",
	"transfer.rejected",
	"transfer.cancelled",
	"transfer.expired",
]);

/**
 * Payload keys that carry a canonical character name or an owner association. A durable
 * event is never re-written, so a name captured here would survive an owner later
 * choosing a narrower sharing policy — the policy could not retract it. Shared rows
 * therefore carry none of these and derive their labels from the *current* peer-visible
 * projection at render time; targeted rows may keep them because their audience is
 * already authorized for that character.
 */
const SHARED_FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
	"characterNameSnapshot",
	"characterNameSnapshots",
	"targetCharacterNameSnapshot",
	"sourceCharacterNameSnapshot",
	"ownerAccountId",
	// Maps a departing member to the characters they owned, which is the same owner
	// association the roster suppresses for a hidden character.
	"detachedCharacterIds",
]);

export function stripSharedCharacterIdentity (payload) {
	const out = {...(payload && typeof payload === "object" ? payload : {})};
	for (const key of SHARED_FORBIDDEN_PAYLOAD_KEYS) delete out[key];
	return out;
}

export function enrichEventPayload ({payload = {}, aggregateType, aggregateId, getCharacterById, type = null, visibility = "all_members"}) {
	if (UNENRICHED_EVENT_TYPES.has(type)) return payload && typeof payload === "object" ? {...payload} : {};
	// A shared event reaches every member, including peers the owner shares nothing with,
	// so it is stripped rather than enriched.
	if (visibility === "all_members") return stripSharedCharacterIdentity(payload);
	const sourcePayload = payload && typeof payload === "object" ? payload : {};
	const enriched = {...sourcePayload};
	const addSnapshot = (key, id) => {
		const existingName = getSnapshotName(enriched[key]);
		if (existingName) {
			enriched[key] = createCharacterDisplayNameSnapshot(existingName);
			return;
		}
		const character = id && getCharacterById?.(id);
		if (!character) return;
		enriched[key] = createCharacterDisplayNameSnapshot(character.data?.name);
	};
	if (aggregateType === "character") addSnapshot("characterNameSnapshot", aggregateId);
	if (sourcePayload.targetCharacterId) addSnapshot("targetCharacterNameSnapshot", sourcePayload.targetCharacterId);
	if (sourcePayload.targetKind === "character" && sourcePayload.targetId) addSnapshot("targetCharacterNameSnapshot", sourcePayload.targetId);
	if (sourcePayload.sourceKind === "character" && sourcePayload.sourceId) addSnapshot("sourceCharacterNameSnapshot", sourcePayload.sourceId);
	if (Array.isArray(sourcePayload.detachedCharacterIds)) {
		const existingSnapshots = new Map(
			(Array.isArray(sourcePayload.characterNameSnapshots) ? sourcePayload.characterNameSnapshots : [])
				.map(snapshot => [snapshot?.characterId, getSnapshotName(snapshot)])
				.filter(([, name]) => name),
		);
		const snapshots = sourcePayload.detachedCharacterIds.map(characterId => {
			const existingName = existingSnapshots.get(characterId);
			if (existingName) return {characterId, ...createCharacterDisplayNameSnapshot(existingName)};
			const character = getCharacterById?.(characterId);
			return character
				? {characterId, ...createCharacterDisplayNameSnapshot(character.data?.name)}
				: null;
		}).filter(Boolean);
		if (snapshots.length) enriched.characterNameSnapshots = snapshots;
	}
	return enriched;
}

export function redactTransferEventForViewer ({event, accountId, role, getCharacterOwnerId}) {
	if (
		!event
		|| event.aggregateType !== "transfer"
		|| !`${event.type || ""}`.startsWith("transfer.")
		|| ["dm", "co_dm"].includes(role)
	) return event;

	const payload = {...(event.payload || {})};
	const ownsSource = payload.sourceKind === "character"
		&& getCharacterOwnerId?.(payload.sourceId) === accountId;
	const ownsTarget = payload.targetKind === "character"
		&& getCharacterOwnerId?.(payload.targetId) === accountId;
	const isExplicitRecipient = event.visibility === "explicit_accounts"
		&& event.visibleAccountIds?.includes(accountId);
	if (!ownsSource && !ownsTarget && !isExplicitRecipient) return null;

	if (!ownsSource) {
		delete payload.sourceId;
		delete payload.sourceCharacterNameSnapshot;
	}
	if (!ownsTarget) {
		delete payload.targetId;
		delete payload.targetCharacterNameSnapshot;
	}
	if (payload.sourceKind === "party_inventory") delete payload.sourceId;
	if (payload.targetKind === "party_inventory") delete payload.targetId;

	const out = {
		...event,
		payload,
		visibleAccountIds: null,
	};
	if (event.actorAccountId !== accountId) {
		out.actorAccountId = null;
		delete out.actorDisplayName;
	}
	return out;
}
