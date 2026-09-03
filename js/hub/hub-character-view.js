/**
 * Client-side reader for ADR 0011 authorization envelopes.
 *
 * Every character read now returns one of three shapes, discriminated by `kind`:
 *
 * - `owner_truth`  — `{character, policy, projectionRevision}`
 * - `dm_truth`     — `{character, peerPreview, projectionRevision}`
 * - `peer_profile` — `{id, campaignId, revision, projectionRevision, data}`
 *
 * A peer profile is a projection, not a character document: its `data` holds the
 * derived catalog, not canonical fields. Reading one as though it were canonical is
 * how privacy leaks and silent misrenders happen, so `getCanonicalCharacter()` throws
 * rather than returning something plausible.
 */

export class HubProjectionScopeError extends Error {
	constructor (kind) {
		super(`Canonical character data is not available for a "${kind}" projection.`);
		this.name = "HubProjectionScopeError";
		this.code = "CHARACTER_PROJECTION_SCOPED";
		this.kind = kind;
	}
}

const ENVELOPE_KINDS = new Set(["owner_truth", "dm_truth", "peer_profile"]);

export function isProjectionEnvelope (value) {
	return !!value && typeof value === "object" && ENVELOPE_KINDS.has(value.kind);
}

export function isCanonicalProjection (projection) {
	return projection?.kind === "owner_truth" || projection?.kind === "dm_truth";
}

/**
 * The canonical character document, for surfaces authorized to edit or inspect truth.
 * @throws {HubProjectionScopeError} when the requester only holds a peer profile
 */
export function getCanonicalCharacter (projection) {
	if (isCanonicalProjection(projection)) return projection.character;
	throw new HubProjectionScopeError(projection?.kind || "unknown");
}

/** The peer-facing profile: the owner's own preview, the DM's preview, or a peer read. */
export function getPeerProfile (projection) {
	if (projection?.kind === "peer_profile") return projection;
	if (projection?.kind === "dm_truth") return projection.peerPreview || null;
	return null;
}

export function getProjectionId (projection) {
	if (projection?.kind === "peer_profile") return projection.id;
	if (projection?.kind) return projection.character?.id || null;
	return projection?.id || null;
}

export function getProjectionRevision (projection) {
	return {
		revision: projection?.kind === "peer_profile" ? projection.revision : projection?.character?.revision,
		projectionRevision: projection?.projectionRevision ?? null,
	};
}

/**
 * A single display view shared by the roster, activity copy, target pickers and Party
 * Tracker, so no consumer has to branch on `kind` itself. Fields the policy withheld are
 * simply absent — callers must render an omission, never a placeholder that implies a
 * value exists.
 */
export function getProjectionView (projection) {
	if (projection?.kind === "peer_profile") return getPeerView(projection);
	// `/api/characters` is owner-scoped and still returns raw documents, so a bare
	// character is treated as truth. Anything with a `kind` must go through the
	// envelope path above.
	const character = projection?.kind ? projection.character : projection;
	if (!character?.data) return {id: projection?.id || null, isTruth: false, name: null, classes: [], hp: null, ac: null, carrySummary: null};
	const data = character.data || {};
	return {
		id: character.id,
		isTruth: true,
		name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
		classes: (Array.isArray(data.classes) ? data.classes : [])
			.filter(cls => cls?.name)
			.map(cls => ({name: cls.name, level: Number(cls.level)})),
		hp: data.hp && typeof data.hp === "object"
			? {current: Number(data.hp.current), max: getViewMaxHp(data.hp)}
			: null,
		ac: getAcValue(data.ac),
		// Truth envelopes carry a server-validated summary alongside the document; the raw
		// `data.carry` block is deliberately NOT read here, because only the server can vouch
		// that it is still current.
		carrySummary: projection?.carrySummary && typeof projection.carrySummary === "object" ? {...projection.carrySummary} : null,
	};
}

function getPeerView (projection) {
	const data = projection.data || {};
	return {
		id: projection.id,
		isTruth: false,
		name: typeof data.identity?.name === "string" ? data.identity.name : null,
		classes: (Array.isArray(data.classes) ? data.classes : []).map(cls => ({name: cls.name, level: Number(cls.level)})),
		hp: data.hp ? {current: Number(data.hp.current), max: getViewMaxHp(data.hp), state: data.hp.state} : null,
		ac: getAcValue(data.ac),
		// Present only when this peer shared it; absent otherwise, so no consumer can infer a
		// withheld carrying load from its shape.
		carrySummary: data.carrySummary && typeof data.carrySummary === "object" ? {...data.carrySummary} : null,
	};
}

/**
 * The maximum to show a reader: the applicable maximum when the document carries one, else the
 * stored base maximum. Prevents a document whose base maximum was never recalculated from being
 * rendered as "HP 25/0", and shows item and strain adjustments the base value omits.
 */
function getViewMaxHp (hp) {
	const effective = Number(hp?.effectiveMax);
	if (Number.isFinite(effective) && effective > 0) return effective;
	return Number(hp?.max);
}

function getAcValue (ac) {
	const value = Number(typeof ac === "object" && ac !== null ? ac.value : ac);
	return Number.isFinite(value) ? value : null;
}

export function getProjectionName (projection, fallback = "Unnamed Character") {
	return getProjectionView(projection).name || fallback;
}

/**
 * The roster summary line. Each segment is omitted rather than defaulted when the policy
 * withheld it, so a peer cannot infer a hidden value from a placeholder.
 */
export function getProjectionSummary (projection) {
	const view = getProjectionView(projection);
	const classes = view.classes
		.map(cls => `${cls.name}${Number.isFinite(cls.level) ? ` ${cls.level}` : ""}`)
		.join(" / ");
	let hp = "";
	if (view.hp?.state) hp = view.hp.state;
	else if (Number.isFinite(view.hp?.current)) {
		hp = `HP ${view.hp.current}${Number.isFinite(view.hp.max) ? `/${view.hp.max}` : ""}`;
	}
	const ac = view.ac == null ? "" : `AC ${view.ac}`;
	return [classes, hp, ac].filter(Boolean).join(" · ") || "Campaign character";
}

/**
 * Peer target lists use peer-visible identity only. A character whose identity the owner
 * hid is absent from the roster metadata and is therefore not peer-targetable.
 */
export function getTargetableProjections ({projections, roster = null}) {
	const list = Array.isArray(projections) ? projections : [];
	if (!Array.isArray(roster)) return list.filter(projection => getProjectionView(projection).name);
	const targetable = new Set(roster.map(entry => entry.characterId));
	return list.filter(projection => targetable.has(getProjectionId(projection)) && getProjectionView(projection).name);
}

/**
 * The owner account id, for owner-scoped surfaces that legitimately hold it — the
 * signed-in player's own character list. A peer profile never carries one, so this
 * returns `null` rather than guessing.
 */
export function getProjectionOwnerAccountId (projection) {
	if (projection?.kind === "peer_profile") return null;
	if (projection?.kind) return projection.character?.ownerAccountId ?? null;
	return projection?.ownerAccountId ?? null;
}

/** Owner attribution comes from roster metadata, never from the character envelope. */
export function getOwnerMembershipId ({roster, characterId}) {
	if (!Array.isArray(roster)) return null;
	return roster.find(entry => entry.characterId === characterId)?.ownerMembershipId || null;
}
