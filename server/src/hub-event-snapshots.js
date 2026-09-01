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
const UNENRICHED_EVENT_TYPES = new Set(["character.projection.invalidated"]);

export function enrichEventPayload ({payload = {}, aggregateType, aggregateId, getCharacterById, type = null}) {
	if (UNENRICHED_EVENT_TYPES.has(type)) return payload && typeof payload === "object" ? {...payload} : {};
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
