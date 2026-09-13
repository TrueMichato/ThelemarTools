import {
	ABILITY_CHOICES,
	MOVEMENT_CHOICES,
	PROJECTION_FIELD_KEYS,
	SKILL_CHOICES,
	SKILL_RANK_CHOICES,
} from "./hub-character-projection-contract.js";

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
const ABILITY_LABELS = new Map(ABILITY_CHOICES.map(choice => [choice.value, choice.label.slice(0, 3).toUpperCase()]));
const MOVEMENT_LABELS = new Map(MOVEMENT_CHOICES.map(choice => [choice.value, choice.label]));
const SKILL_LABELS = new Map(SKILL_CHOICES.map(choice => [choice.value, choice.label]));
const SKILL_RANK_LABELS = new Map(SKILL_RANK_CHOICES.map(choice => [choice.value, choice.label]));

export const PROJECTION_FIELD_LABELS = Object.freeze({
	identity: "Name and portrait",
	species: "Species",
	classes: "Classes",
	abilities: "Ability scores",
	saves: "Saving throws",
	skills: "Skills",
	ac: "Armour class",
	hp: "Hit points",
	speed: "Speed",
	senses: "Senses",
	conditions: "Conditions",
	diseases: "Diseases",
	exhaustion: "Exhaustion",
	inventorySummary: "Inventory summary",
	carrySummary: "Carried weight",
});

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

export function getProjectionFieldLabel (field) {
	return PROJECTION_FIELD_LABELS[field] || field;
}

/**
 * Field-aware reading rows for a server-issued peer profile. Hidden fields stay absent;
 * this helper formats authorized data but never derives or widens it.
 */
export function getProjectionProfileRows (projection) {
	const profile = getPeerProfile(projection);
	const data = profile?.data || {};
	return PROJECTION_FIELD_KEYS
		.filter(field => Object.hasOwn(data, field))
		.map(field => ({
			field,
			label: getProjectionFieldLabel(field),
			value: describeProjectionFieldValue(field, data[field]),
		}));
}

export function getOmittedProjectionFieldLabels (projection) {
	const profile = getPeerProfile(projection);
	const data = profile?.data || {};
	return PROJECTION_FIELD_KEYS
		.filter(field => !Object.hasOwn(data, field))
		.map(getProjectionFieldLabel);
}

export function describeProjectionFieldValue (field, value) {
	if (value == null) return "None";
	switch (field) {
		case "identity": return [
			value.name,
			value.pronouns,
			value.avatar?.url ? "Portrait shared" : null,
		].filter(Boolean).join(" · ") || "Unnamed";
		case "species": return formatNamedEntry(value);
		case "classes": return formatList(value, entry => {
			const name = formatNamedEntry(entry);
			return `${name}${Number.isFinite(Number(entry?.level)) ? ` ${Number(entry.level)}` : ""}`;
		});
		case "abilities": return formatKeyedValues(value, ABILITY_CHOICES, entry => formatNumber(entry));
		case "saves": return formatKeyedValues(value, ABILITY_CHOICES, entry => {
			const modifier = formatModifier(entry?.modifier);
			return `${modifier}${entry?.proficient ? " (proficient)" : ""}`;
		});
		case "skills": return formatKeyedValues(value, SKILL_CHOICES, entry => {
			const rank = SKILL_RANK_LABELS.get(entry?.rank);
			return [formatModifier(entry?.modifier), rank].filter(Boolean).join(" · ");
		});
		case "ac": return formatNumber(value?.value);
		case "hp": {
			const hp = Number.isFinite(Number(value?.current))
				? `${formatNumber(value.current)}${Number.isFinite(Number(value.max)) ? `/${formatNumber(value.max)}` : ""} HP`
				: null;
			const temp = Number(value?.temp) > 0 ? `${formatNumber(value.temp)} temporary` : null;
			return [hp, temp, value?.state].filter(Boolean).join(" · ") || "None";
		}
		case "speed": return formatKeyedValues(value, MOVEMENT_CHOICES, entry => `${formatNumber(entry)} ft.`);
		case "senses": return formatList(value, entry => `${entry?.name || "Sense"}${Number.isFinite(Number(entry?.range)) ? ` ${formatNumber(entry.range)} ft.` : ""}`);
		case "conditions":
		case "diseases": return formatList(value, entry => `${entry}`);
		case "exhaustion": return typeof value === "number" ? `Level ${formatNumber(value)}` : `${value}`;
		case "inventorySummary": {
			const count = Number(value?.entryCount);
			const summary = Number.isFinite(count) ? `${count} ${count === 1 ? "entry" : "entries"}` : null;
			const items = formatList(value?.publicItems, entry => `${entry?.name || "Item"}${Number.isFinite(Number(entry?.quantity)) ? ` ×${formatNumber(entry.quantity)}` : ""}`);
			return [summary, items !== "None" ? items : null].filter(Boolean).join(" · ") || "None";
		}
		case "carrySummary": {
			const carried = Number.isFinite(Number(value?.carried))
				? `${value.isIndeterminate ? "At least " : ""}${formatNumber(value.carried)} lb.`
				: null;
			const capacity = Number.isFinite(Number(value?.capacity)) ? `${formatNumber(value.capacity)} lb. capacity` : null;
			return [carried, capacity, formatCodeLabel(value?.state)].filter(Boolean).join(" · ") || "None";
		}
		default: return describeProjectionValue(value);
	}
}

function formatKeyedValues (value, choices, fnValue) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "None";
	const parts = choices
		.filter(choice => Object.hasOwn(value, choice.value))
		.map(choice => {
			const rendered = fnValue(value[choice.value]);
			if (!rendered) return null;
			const label = ABILITY_LABELS.get(choice.value) || MOVEMENT_LABELS.get(choice.value) || SKILL_LABELS.get(choice.value) || choice.label;
			return `${label} ${rendered}`;
		})
		.filter(Boolean);
	return parts.join(" · ") || "None";
}

function formatList (value, fnEntry) {
	if (!Array.isArray(value) || !value.length) return "None";
	return value.map(fnEntry).filter(Boolean).join(", ") || "None";
}

function formatNamedEntry (value) {
	if (!value) return "None";
	if (typeof value === "string") return value;
	return `${value.name || "Unnamed"}${value.source ? ` (${value.source})` : ""}`;
}

function formatModifier (value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "";
	return number >= 0 ? `+${number}` : `${number}`;
}

function formatNumber (value) {
	const number = Number(value);
	return Number.isFinite(number) ? `${number}` : "";
}

function formatCodeLabel (value) {
	if (typeof value !== "string" || !value.trim()) return "";
	const words = value.replaceAll("_", " ");
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function describeProjectionValue (value) {
	if (value == null) return "None";
	if (Array.isArray(value)) return formatList(value, entry => describeProjectionValue(entry));
	if (typeof value === "object") {
		return Object.entries(value)
			.map(([key, entry]) => `${formatCodeLabel(key)}: ${describeProjectionValue(entry)}`)
			.join(" · ");
	}
	return `${value}`;
}
