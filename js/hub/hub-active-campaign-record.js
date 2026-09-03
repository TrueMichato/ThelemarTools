/**
 * Pure record algebra for the device-scoped active campaign selection (ADR 0013).
 *
 * This module is intentionally free of I/O, DOM, and network access so it can be reused by the
 * lightweight Hub shells without pulling in `js/utils.js` or any heavy dependency.
 */

export const ACTIVE_CAMPAIGN_SCHEMA_VERSION = 1;
export const ACTIVE_CAMPAIGN_STORAGE_KEY = "hub.activeCampaign.v1";
export const ACTIVE_CAMPAIGN_CHANNEL_NAME = "hub:active-campaign:v1";
export const ACTIVE_CAMPAIGN_WRITE_LOCK = "hub:active-campaign-write:v1";
export const ACTIVE_CAMPAIGN_MAX_BYTES = 1024;

export const ACTIVE_CAMPAIGN_STATE_SELECTED = "selected";
export const ACTIVE_CAMPAIGN_STATE_CLEARED = "cleared";

/**
 * Why a selection was cleared.
 *
 * This is part of the **durable** record rather than transient message metadata. A pinned host
 * defers teardown for an unrelated access loss but must never defer it for a logout, and a
 * transient signal cannot carry that safely: the `storage` fallback has no payload to attach it
 * to, and whichever of the two delivery paths arrives second is discarded by the strict-greater
 * convergence guard.
 *
 * An absent or unrecognised cause is treated as a logout by every consumer, so the failure mode is
 * closed: a record written by an older client, or one whose cause was lost, tears down.
 */
export const CLEAR_CAUSE_LOGOUT = "logout";
export const CLEAR_CAUSE_ACCESS_LOSS = "access_loss";
export const CLEAR_CAUSE_SELECTION = "selection";
export const CLEAR_CAUSES = Object.freeze([CLEAR_CAUSE_LOGOUT, CLEAR_CAUSE_ACCESS_LOSS, CLEAR_CAUSE_SELECTION]);
const _CLEAR_CAUSE_SET = new Set(CLEAR_CAUSES);

/** Deferring teardown is only safe for a cause we positively recognise as non-logout. */
export function isDeferrableClearCause (cause) {
	return cause === CLEAR_CAUSE_ACCESS_LOSS || cause === CLEAR_CAUSE_SELECTION;
}

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _ENCODER = typeof TextEncoder === "undefined" ? null : new TextEncoder();

/** Byte length, so a multibyte payload cannot slip past the cap on UTF-16 code units. */
function _byteLength (value) {
	return _ENCODER ? _ENCODER.encode(value).byteLength : value.length;
}

/** Opaque identifiers must pass the same validation the API paths use. */
export function isActiveCampaignUuid (value) {
	return typeof value === "string" && _UUID_RE.test(value);
}

function _isSafeCount (value) {
	return Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);
}

/**
 * Parse a durable record. Returns `null` for anything malformed, oversized, or from an unknown
 * schema version; callers treat `null` as "no selection" and evict the stored value.
 */
export function parseActiveCampaignRecord (raw) {
	if (typeof raw !== "string" || !raw) return null;
	// Guard before parsing so a hostile oversized value is never materialised.
	if (_byteLength(raw) > ACTIVE_CAMPAIGN_MAX_BYTES) return null;

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	if (parsed.schemaVersion !== ACTIVE_CAMPAIGN_SCHEMA_VERSION) return null;
	if (!isActiveCampaignUuid(parsed.accountId)) return null;
	if (!isActiveCampaignUuid(parsed.writerId)) return null;
	if (!_isSafeCount(parsed.revision)) return null;
	if (!_isSafeCount(parsed.updatedAt)) return null;

	if (parsed.state === ACTIVE_CAMPAIGN_STATE_SELECTED) {
		if (!isActiveCampaignUuid(parsed.campaignId)) return null;
	} else if (parsed.state === ACTIVE_CAMPAIGN_STATE_CLEARED) {
		// A tombstone is durable and ordered; it must not smuggle a campaign id.
		if (parsed.campaignId !== null) return null;
	} else return null;

	const isCleared = parsed.state === ACTIVE_CAMPAIGN_STATE_CLEARED;
	return {
		schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION,
		accountId: parsed.accountId,
		campaignId: isCleared ? null : parsed.campaignId,
		state: parsed.state,
		// An unrecognised or absent cause degrades to `logout`, which is the safe default.
		cause: isCleared ? (_CLEAR_CAUSE_SET.has(parsed.cause) ? parsed.cause : CLEAR_CAUSE_LOGOUT) : null,
		revision: parsed.revision,
		updatedAt: parsed.updatedAt,
		writerId: parsed.writerId,
	};
}

export function serializeActiveCampaignRecord (record) {
	const isCleared = record.state === ACTIVE_CAMPAIGN_STATE_CLEARED;
	const serialized = JSON.stringify({
		schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION,
		accountId: record.accountId,
		campaignId: isCleared ? null : record.campaignId,
		state: record.state,
		...(isCleared ? {cause: _CLEAR_CAUSE_SET.has(record.cause) ? record.cause : CLEAR_CAUSE_LOGOUT} : {}),
		revision: record.revision,
		updatedAt: record.updatedAt,
		writerId: record.writerId,
	});
	if (_byteLength(serialized) > ACTIVE_CAMPAIGN_MAX_BYTES) throw new RangeError(`Active campaign record exceeds ${ACTIVE_CAMPAIGN_MAX_BYTES} bytes.`);
	return serialized;
}

function _makeRecord ({accountId, campaignId, state, cause, revision, updatedAt, writerId}) {
	if (!isActiveCampaignUuid(accountId)) throw new TypeError(`accountId must be a UUID.`);
	if (!isActiveCampaignUuid(writerId)) throw new TypeError(`writerId must be a UUID.`);
	if (!_isSafeCount(revision)) throw new TypeError(`revision must be a non-negative integer.`);
	if (!_isSafeCount(updatedAt)) throw new TypeError(`updatedAt must be a non-negative integer.`);
	return {schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION, accountId, campaignId, state, cause, revision, updatedAt, writerId};
}

export function makeSelectedRecord ({accountId, campaignId, revision, updatedAt, writerId}) {
	if (!isActiveCampaignUuid(campaignId)) throw new TypeError(`campaignId must be a UUID.`);
	return _makeRecord({accountId, campaignId, state: ACTIVE_CAMPAIGN_STATE_SELECTED, cause: null, revision, updatedAt, writerId});
}

export function makeClearedRecord ({accountId, revision, updatedAt, writerId, cause = CLEAR_CAUSE_LOGOUT}) {
	return _makeRecord({
		accountId,
		campaignId: null,
		state: ACTIVE_CAMPAIGN_STATE_CLEARED,
		cause: _CLEAR_CAUSE_SET.has(cause) ? cause : CLEAR_CAUSE_LOGOUT,
		revision,
		updatedAt,
		writerId,
	});
}

export function isSameAccount (a, b) {
	return !!a && !!b && a.accountId === b.accountId;
}

/**
 * Total order over records of a single account: `revision`, then state precedence (a clear
 * tombstone outranks a selection at the same revision), then `updatedAt`, then `writerId`.
 *
 * Records from different accounts are deliberately incomparable — a selection must never become
 * active because storage was written while signed into another account.
 */
export function compareActiveCampaignRecords (a, b) {
	if (!isSameAccount(a, b)) throw new TypeError(`Records are comparable only when their accountId matches.`);
	if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1;
	if (a.state !== b.state) return a.state === ACTIVE_CAMPAIGN_STATE_CLEARED ? 1 : -1;
	if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
	if (a.writerId !== b.writerId) return a.writerId < b.writerId ? -1 : 1;
	return 0;
}

/** Greatest of two records, tolerating `null` and cross-account pairs (the candidate loses). */
export function pickGreaterActiveCampaignRecord (current, candidate) {
	if (!candidate) return current || null;
	if (!current) return candidate;
	if (!isSameAccount(current, candidate)) return current;
	return compareActiveCampaignRecords(candidate, current) > 0 ? candidate : current;
}

export function isStrictlyGreaterActiveCampaignRecord (candidate, current) {
	if (!candidate) return false;
	if (!current) return true;
	if (!isSameAccount(current, candidate)) return false;
	return compareActiveCampaignRecords(candidate, current) > 0;
}

/** Stable identity used to suppress duplicate broadcasts of one logical record. */
export function getActiveCampaignRecordKey (record) {
	if (!record) return null;
	return `${record.accountId}|${record.state}|${record.cause || ""}|${record.campaignId || ""}|${record.revision}|${record.updatedAt}|${record.writerId}`;
}
