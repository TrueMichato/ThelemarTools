import {HubStoreError} from "./hub-store-error.js";
import {getDerivedStats} from "./character-derived-stats.js";
import {resolveCarryAuthority} from "../../js/hub/hub-carry-authority.js";

/**
 * Authorization-scoped character projections (ADR 0011).
 *
 * This module is the single place a canonical character document is converted into
 * peer-visible data. It never copies a source object because its top-level key happens
 * to be allowed: every catalog field is re-derived into a closed, type-validated view
 * model first, and only then is the owner's sharing policy applied.
 */

export const PROJECTION_CATALOG_VERSION = 1;
export const PROJECTION_POLICY_VERSION = 1;

const MAX_LABEL_LENGTH = 120;
const MAX_COLLECTION_LENGTH = 60;
const MAX_ABILITY_SCORE = 99;
const MAX_AC = 99;
const MAX_HP = 100_000;
const MAX_SPEED = 9_999;
const MAX_SENSE_RANGE = 9_999;
const MAX_EXHAUSTION = 10;
const MAX_QUANTITY = 1_000_000;
const MAX_WEIGHT = 1_000_000;

export const ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
export const MOVEMENT_KEYS = Object.freeze(["walk", "fly", "swim", "climb", "burrow"]);
export const SKILL_RANKS = Object.freeze(["none", "half", "proficient", "expertise"]);

/**
 * Skill key -> governing ability. Mirrors
 * `PartyTrackerCharacterSerializer.SKILL_TO_ABILITY` so a peer profile and the Party
 * Tracker cannot disagree about a character's modifiers.
 */
export const SKILL_TO_ABILITY = Object.freeze({
	athletics: "str",
	acrobatics: "dex",
	sleightOfHand: "dex",
	stealth: "dex",
	arcana: "int",
	history: "int",
	investigation: "int",
	nature: "int",
	religion: "int",
	animalHandling: "wis",
	insight: "wis",
	medicine: "wis",
	perception: "wis",
	survival: "wis",
	deception: "cha",
	intimidation: "cha",
	performance: "cha",
	persuasion: "cha",
	cooking: "wis",
	culture: "wis",
	endurance: "con",
	engineering: "int",
	harvesting: "dex",
	linguistics: "wis",
	might: "str",
});

export const SKILL_KEYS = Object.freeze(Object.keys(SKILL_TO_ABILITY));

export const PROJECTION_FIELD_KEYS = Object.freeze([
	"identity",
	"species",
	"classes",
	"abilities",
	"saves",
	"skills",
	"ac",
	"hp",
	"speed",
	"senses",
	"conditions",
	"diseases",
	"exhaustion",
	"inventorySummary",
	"carrySummary",
]);

const TABLE_PRESET_FIELDS = Object.freeze([
	"identity",
	"species",
	"classes",
	"abilities",
	"saves",
	"skills",
	"ac",
	"hp",
	"speed",
	"senses",
	"conditions",
	"diseases",
	"exhaustion",
]);

export const PROJECTION_PRESETS = Object.freeze({
	table: TABLE_PRESET_FIELDS,
	minimal: Object.freeze(["identity", "species", "classes"]),
	open: PROJECTION_FIELD_KEYS,
	private: Object.freeze([]),
});

export const PROJECTION_PRESET_KEYS = Object.freeze(Object.keys(PROJECTION_PRESETS));
export const PROJECTION_OVERRIDE_MODES = Object.freeze(["share", "hide", "replace"]);

export const DEFAULT_PROJECTION_POLICY = Object.freeze({
	version: PROJECTION_POLICY_VERSION,
	preset: "table",
	overrides: Object.freeze({}),
});

export function getDefaultProjectionPolicy () {
	return {version: PROJECTION_POLICY_VERSION, preset: "table", overrides: {}};
}

/* -------------------------------------------- */
//  Primitive coercion and sanitisation
/* -------------------------------------------- */

const TAG_RE = /<[^>]*>/g;
const UNSAFE_URL_RE = /^(?:javascript|data|vbscript|file):/i;

/** Display labels are plain text: no markup, no control characters, bounded length. */
function toLabel (value, {maxLength = MAX_LABEL_LENGTH} = {}) {
	if (typeof value !== "string") return null;
	const plain = value
		.replace(TAG_RE, " ")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001F\u007F]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!plain) return null;
	return plain.slice(0, maxLength);
}

function toFiniteNumber (value, {min = 0, max, isInteger = false} = {}) {
	const number = Number(value);
	if (!Number.isFinite(number)) return null;
	const bounded = Math.min(max, Math.max(min, number));
	if (!Number.isFinite(bounded)) return null;
	return isInteger ? Math.trunc(bounded) : Math.round(bounded * 100) / 100;
}

function toSafeAssetRef (value) {
	const url = typeof value === "string" ? value.trim() : null;
	if (!url || url.length > 2_000) return null;
	if (UNSAFE_URL_RE.test(url.replace(/\s/g, ""))) return null;
	if (!/^https?:\/\//i.test(url)) return null;
	return {url};
}

function toEntityLabel (value) {
	if (typeof value === "string") {
		const name = toLabel(value);
		return name ? {name} : null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const name = toLabel(value.name);
	if (!name) return null;
	const source = toLabel(value.source, {maxLength: 30});
	return source ? {name, source} : {name};
}

/* -------------------------------------------- */
//  View model derivation
/* -------------------------------------------- */

function getSkillRank (level) {
	if (level >= 2) return "expertise";
	if (level >= 1) return "proficient";
	if (level > 0) return "half";
	return "none";
}

function getInventoryEntries (data) {
	return Array.isArray(data.inventory) ? data.inventory.filter(entry => entry && typeof entry === "object") : [];
}

/**
 * An entry is peer-visible only when its owner explicitly marked it shared. The
 * Character Sheet does not yet write that marker, so this is empty in practice; the
 * field is also hidden under the `table` default. Names are the only item data emitted —
 * never ids, notes, containers, currency or effects.
 */
function isSharedInventoryEntry (entry) {
	return entry.isShared === true || entry.item?.isShared === true;
}

function getItemName (entry) {
	return toLabel(entry.item?.name ?? entry.name);
}

/**
 * Convert a canonical character document into the fixed, type-validated catalog.
 * Every value here is safe to share *if policy allows it*; policy is applied separately.
 */
export function buildCharacterViewModel (characterData, {expectedBasis = undefined} = {}) {
	const data = characterData && typeof characterData === "object" && !Array.isArray(characterData)
		? characterData
		: {};

	// Derived statistics come from the authority the player reads, not from a port of it.
	const derived = getDerivedStats({characterData: data, abilityKeys: ABILITY_KEYS, skillKeys: SKILL_KEYS});
	const abilities = derived?.abilities || Object.fromEntries(ABILITY_KEYS.map(ability => [ability, 10]));

	const identity = {name: toLabel(data.name) || "Unnamed Character"};
	const pronouns = toLabel(data.pronouns, {maxLength: 40});
	if (pronouns) identity.pronouns = pronouns;
	const avatar = toSafeAssetRef(data.avatar ?? data.portrait ?? data.image);
	if (avatar) identity.avatar = avatar;

	const speciesBase = toEntityLabel(data.race);
	const subrace = toLabel(typeof data.subrace === "string" ? data.subrace : data.subrace?.name);
	const species = speciesBase
		? (subrace ? {...speciesBase, name: toLabel(`${speciesBase.name} (${subrace})`)} : speciesBase)
		: null;

	const classes = (Array.isArray(data.classes) ? data.classes : [])
		.slice(0, MAX_COLLECTION_LENGTH)
		.map(cls => {
			const name = toLabel(cls?.name);
			if (!name) return null;
			const source = toLabel(cls?.source, {maxLength: 30});
			const level = toFiniteNumber(cls?.level, {min: 0, max: 20, isInteger: true}) ?? 1;
			return source ? {name, source, level} : {name, level};
		})
		.filter(Boolean);

	const saves = derived?.saves || {};
	const skills = Object.fromEntries(Object.entries(derived?.skills || {})
		.map(([skill, entry]) => [skill, {modifier: entry.modifier, rank: getSkillRank(entry.level)}]));

	let acValue = derived?.ac == null ? null : toFiniteNumber(derived.ac, {min: 0, max: MAX_AC, isInteger: true});
	if (acValue == null) acValue = toFiniteNumber(data.ac, {min: 0, max: MAX_AC, isInteger: true});
	if (acValue == null && data.ac && typeof data.ac === "object") {
		const base = toFiniteNumber(data.ac.base, {min: 0, max: MAX_AC, isInteger: true}) ?? 10;
		const itemBonus = toFiniteNumber(data.ac.itemBonus, {min: -MAX_AC, max: MAX_AC, isInteger: true}) || 0;
		const bonuses = Array.isArray(data.ac.bonuses)
			? data.ac.bonuses.reduce((acc, bonus) => acc + (toFiniteNumber(bonus?.value, {min: -MAX_AC, max: MAX_AC, isInteger: true}) || 0), 0)
			: 0;
		acValue = Math.max(0, Math.min(MAX_AC, base + itemBonus + bonuses));
	}
	const ac = {value: acValue ?? 10};

	const hp = {};
	for (const key of ["current", "max", "temp", "effectiveMax"]) {
		const value = toFiniteNumber(data.hp?.[key], {min: 0, max: MAX_HP});
		if (value != null) hp[key] = value;
	}
	// The applicable maximum only ever rides along with the base maximum, so a projection that
	// withholds the maximum cannot leak it back through the derived value.
	if (hp.max == null) delete hp.effectiveMax;

	const speed = {};
	for (const key of MOVEMENT_KEYS) {
		const value = toFiniteNumber(data.speed?.[key], {min: 0, max: MAX_SPEED});
		if (value != null) speed[key] = value;
	}

	const senses = [];
	if (data.senses && typeof data.senses === "object" && !Array.isArray(data.senses)) {
		for (const [key, value] of Object.entries(data.senses).slice(0, MAX_COLLECTION_LENGTH)) {
			const name = toLabel(key, {maxLength: 40});
			if (!name) continue;
			const range = toFiniteNumber(value, {min: 0, max: MAX_SENSE_RANGE});
			if (!range) continue;
			senses.push({name, range});
		}
	}

	const toDisplayLabels = source => (Array.isArray(source) ? source : [])
		.slice(0, MAX_COLLECTION_LENGTH)
		.map(entry => toLabel(typeof entry === "string" ? entry : entry?.name))
		.filter(Boolean);

	const inventoryEntries = getInventoryEntries(data);
	const inventorySummary = {
		entryCount: Math.min(inventoryEntries.length, Number.MAX_SAFE_INTEGER),
		publicItems: inventoryEntries
			.filter(isSharedInventoryEntry)
			.slice(0, MAX_COLLECTION_LENGTH)
			.map(entry => {
				const name = getItemName(entry);
				if (!name) return null;
				return {name, quantity: toFiniteNumber(entry.quantity, {min: 0, max: MAX_QUANTITY}) ?? 1};
			})
			.filter(Boolean),
	};

	const carrySummary = {};
	// Carry truth is materialised by `CharacterSheetState.toJson()` and validated here; it
	// is never recomputed. The previous `abilities.str * 15 * (powerfulBuild ? 2 : 1)` was a
	// second implementation that knew nothing about the Thelemar passive-Might rule, creature
	// size, flat bonuses, item multipliers or extradimensional containers — so a DM watching
	// the Party Tracker saw a different capacity than the player saw on their own sheet.
	// ADR 0011 requires derived statistics to be read from the authoritative sheet
	// calculation rather than reimplemented.
	//
	// `carried` / `capacity` are deliberately the BODY pair, matching `state`: encumbrance is
	// judged on physical load against physical capacity, so all three describe one thing.
	// Pairing gross weight with body capacity (or either with the bag-inclusive total) would
	// be internally incoherent the moment a Bag of Holding is equipped, and omitting the bag
	// also avoids disclosing that the bearer owns one.
	//
	// When the summary is absent, stale, or unverifiable the whole field is omitted rather
	// than filled with a guess: a consumer must be able to tell "not synced" from
	// "carrying nothing".
	const carryAuthority = resolveCarryAuthority({data, expectedBasis});
	if (carryAuthority) {
		const carried = toFiniteNumber(carryAuthority.bodyLoad, {min: 0, max: MAX_WEIGHT});
		if (carried != null) carrySummary.carried = carried;
		const capacity = toFiniteNumber(carryAuthority.bodyCapacity, {min: 0, max: MAX_WEIGHT});
		if (capacity != null) carrySummary.capacity = capacity;
		// `state` carries the AUTHORITATIVE encumbrance level. Without it a consumer holds two
		// numbers and no way to tier them: it cannot know which rule set produced the capacity
		// (PHB keys its tiers off the Strength score, Thelemar off capacity, and a table may
		// have turned tiers off entirely), so it would have to guess — and the Party Tracker
		// guessed `capacity-only`, silently reporting genuinely encumbered characters as
		// Normal. It also distinguishes `unknown`, where a missing item weight makes the load a
		// lower bound, from a confident reading of the same two numbers.
		const state = toLabel(carryAuthority.status, {maxLength: 40});
		if (state) carrySummary.state = state;
	}

	const exhaustionLabel = typeof data.exhaustion === "string" ? toLabel(data.exhaustion, {maxLength: 40}) : null;
	const exhaustion = exhaustionLabel ?? (toFiniteNumber(data.exhaustion ?? data.exhaustionLevel, {min: 0, max: MAX_EXHAUSTION, isInteger: true}) ?? 0);

	return {
		identity,
		species,
		classes,
		abilities,
		saves,
		skills,
		ac,
		hp,
		speed,
		senses,
		conditions: toDisplayLabels(data.conditions),
		diseases: toDisplayLabels(data.diseases),
		exhaustion,
		inventorySummary,
		// Absent, not empty. `applyProjectionPolicy` skips `undefined`, so an unresolved
		// summary leaves no `carrySummary` key at all — which is what "fresh or absent" has to
		// mean on the wire. An owned `{}` is a third state that reads as "shared but empty",
		// and a consumer cannot tell it apart from a character who shared nothing.
		carrySummary: Object.keys(carrySummary).length ? carrySummary : undefined,
	};
}

/* -------------------------------------------- */
//  Replacement value validation
/* -------------------------------------------- */

function fail (message) {
	throw new HubStoreError("PROJECTION_POLICY_INVALID", message, {status: 422});
}

function assertPlainObject (value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
}

function assertNoUnknownKeys (value, allowed, label) {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) fail(`${label} contains the unsupported property "${key}".`);
	}
}

function assertLabel (value, label, {maxLength = MAX_LABEL_LENGTH} = {}) {
	if (typeof value !== "string") fail(`${label} must be a string.`);
	const clean = toLabel(value, {maxLength});
	if (!clean) fail(`${label} must be non-empty text.`);
	if (clean !== value.trim()) fail(`${label} must be plain text.`);
	return clean;
}

function assertNumber (value, label, {min = 0, max, isInteger = false}) {
	if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number.`);
	if (isInteger && !Number.isInteger(value)) fail(`${label} must be an integer.`);
	if (value < min || value > max) fail(`${label} must be between ${min} and ${max}.`);
	return value;
}

function assertBoundedArray (value, label) {
	if (!Array.isArray(value)) fail(`${label} must be an array.`);
	if (value.length > MAX_COLLECTION_LENGTH) fail(`${label} may contain at most ${MAX_COLLECTION_LENGTH} entries.`);
	return value;
}

function assertKeyedNumberMap (value, keys, label, bounds) {
	assertPlainObject(value, label);
	assertNoUnknownKeys(value, keys, label);
	const out = {};
	for (const [key, entry] of Object.entries(value)) out[key] = assertNumber(entry, `${label}.${key}`, bounds);
	return out;
}

/**
 * Closed schema per catalog field. A `replace` value is emitted verbatim, so it is
 * validated exactly as strictly as a derived value and unknown properties are rejected.
 */
const FIELD_VALIDATORS = Object.freeze({
	identity: value => {
		assertPlainObject(value, "identity");
		assertNoUnknownKeys(value, ["name", "pronouns", "avatar"], "identity");
		const out = {name: assertLabel(value.name, "identity.name")};
		if (value.pronouns !== undefined) out.pronouns = assertLabel(value.pronouns, "identity.pronouns", {maxLength: 40});
		if (value.avatar !== undefined) {
			assertPlainObject(value.avatar, "identity.avatar");
			assertNoUnknownKeys(value.avatar, ["url"], "identity.avatar");
			const avatar = toSafeAssetRef(value.avatar.url);
			if (!avatar) fail(`identity.avatar.url must be an http(s) URL.`);
			out.avatar = avatar;
		}
		return out;
	},
	species: value => {
		if (value === null) return null;
		assertPlainObject(value, "species");
		assertNoUnknownKeys(value, ["name", "source"], "species");
		const out = {name: assertLabel(value.name, "species.name")};
		if (value.source !== undefined) out.source = assertLabel(value.source, "species.source", {maxLength: 30});
		return out;
	},
	classes: value => assertBoundedArray(value, "classes").map((entry, index) => {
		assertPlainObject(entry, `classes[${index}]`);
		assertNoUnknownKeys(entry, ["name", "source", "level"], `classes[${index}]`);
		const out = {name: assertLabel(entry.name, `classes[${index}].name`)};
		if (entry.source !== undefined) out.source = assertLabel(entry.source, `classes[${index}].source`, {maxLength: 30});
		out.level = assertNumber(entry.level, `classes[${index}].level`, {min: 0, max: 20, isInteger: true});
		return out;
	}),
	abilities: value => {
		const out = assertKeyedNumberMap(value, ABILITY_KEYS, "abilities", {min: 1, max: 30, isInteger: true});
		for (const ability of ABILITY_KEYS) if (out[ability] === undefined) fail(`abilities.${ability} is required.`);
		return out;
	},
	saves: value => {
		assertPlainObject(value, "saves");
		assertNoUnknownKeys(value, ABILITY_KEYS, "saves");
		const out = {};
		for (const ability of ABILITY_KEYS) {
			const entry = value[ability];
			if (entry === undefined) fail(`saves.${ability} is required.`);
			assertPlainObject(entry, `saves.${ability}`);
			assertNoUnknownKeys(entry, ["modifier", "proficient"], `saves.${ability}`);
			if (typeof entry.proficient !== "boolean") fail(`saves.${ability}.proficient must be a boolean.`);
			out[ability] = {
				modifier: assertNumber(entry.modifier, `saves.${ability}.modifier`, {min: -99, max: 99, isInteger: true}),
				proficient: entry.proficient,
			};
		}
		return out;
	},
	skills: value => {
		assertPlainObject(value, "skills");
		assertNoUnknownKeys(value, SKILL_KEYS, "skills");
		const out = {};
		for (const [skill, entry] of Object.entries(value)) {
			assertPlainObject(entry, `skills.${skill}`);
			assertNoUnknownKeys(entry, ["modifier", "rank"], `skills.${skill}`);
			if (!SKILL_RANKS.includes(entry.rank)) fail(`skills.${skill}.rank must be one of ${SKILL_RANKS.join(", ")}.`);
			out[skill] = {
				modifier: assertNumber(entry.modifier, `skills.${skill}.modifier`, {min: -99, max: 99, isInteger: true}),
				rank: entry.rank,
			};
		}
		return out;
	},
	ac: value => {
		assertPlainObject(value, "ac");
		assertNoUnknownKeys(value, ["value"], "ac");
		return {value: assertNumber(value.value, "ac.value", {min: 0, max: MAX_AC, isInteger: true})};
	},
	hp: value => {
		assertPlainObject(value, "hp");
		assertNoUnknownKeys(value, ["current", "max", "temp", "state", "effectiveMax"], "hp");
		const out = {};
		for (const key of ["current", "max", "temp", "effectiveMax"]) {
			if (value[key] !== undefined) out[key] = assertNumber(value[key], `hp.${key}`, {min: 0, max: MAX_HP});
		}
		if (out.max === undefined) delete out.effectiveMax;
		if (value.state !== undefined) out.state = assertLabel(value.state, "hp.state", {maxLength: 40});
		if (!Object.keys(out).length) fail(`hp must contain at least one value.`);
		return out;
	},
	speed: value => assertKeyedNumberMap(value, MOVEMENT_KEYS, "speed", {min: 0, max: MAX_SPEED}),
	senses: value => assertBoundedArray(value, "senses").map((entry, index) => {
		assertPlainObject(entry, `senses[${index}]`);
		assertNoUnknownKeys(entry, ["name", "range"], `senses[${index}]`);
		const out = {name: assertLabel(entry.name, `senses[${index}].name`, {maxLength: 40})};
		if (entry.range !== undefined) out.range = assertNumber(entry.range, `senses[${index}].range`, {min: 0, max: MAX_SENSE_RANGE});
		return out;
	}),
	conditions: value => assertBoundedArray(value, "conditions").map((entry, index) => assertLabel(entry, `conditions[${index}]`, {maxLength: 40})),
	diseases: value => assertBoundedArray(value, "diseases").map((entry, index) => assertLabel(entry, `diseases[${index}]`, {maxLength: 40})),
	exhaustion: value => {
		if (typeof value === "string") return assertLabel(value, "exhaustion", {maxLength: 40});
		return assertNumber(value, "exhaustion", {min: 0, max: MAX_EXHAUSTION, isInteger: true});
	},
	inventorySummary: value => {
		assertPlainObject(value, "inventorySummary");
		assertNoUnknownKeys(value, ["entryCount", "publicItems"], "inventorySummary");
		return {
			entryCount: assertNumber(value.entryCount, "inventorySummary.entryCount", {min: 0, max: Number.MAX_SAFE_INTEGER, isInteger: true}),
			publicItems: assertBoundedArray(value.publicItems ?? [], "inventorySummary.publicItems").map((entry, index) => {
				assertPlainObject(entry, `inventorySummary.publicItems[${index}]`);
				assertNoUnknownKeys(entry, ["name", "quantity"], `inventorySummary.publicItems[${index}]`);
				return {
					name: assertLabel(entry.name, `inventorySummary.publicItems[${index}].name`),
					quantity: assertNumber(entry.quantity, `inventorySummary.publicItems[${index}].quantity`, {min: 0, max: MAX_QUANTITY}),
				};
			}),
		};
	},
	carrySummary: value => {
		assertPlainObject(value, "carrySummary");
		assertNoUnknownKeys(value, ["carried", "capacity", "state"], "carrySummary");
		const out = {};
		for (const key of ["carried", "capacity"]) {
			if (value[key] !== undefined) out[key] = assertNumber(value[key], `carrySummary.${key}`, {min: 0, max: MAX_WEIGHT});
		}
		if (value.state !== undefined) out.state = assertLabel(value.state, "carrySummary.state", {maxLength: 40});
		if (!Object.keys(out).length) fail(`carrySummary must contain at least one value.`);
		return out;
	},
});

/* -------------------------------------------- */
//  Policy validation
/* -------------------------------------------- */

/**
 * Validate a persisted or submitted sharing policy. Throws `PROJECTION_POLICY_INVALID`
 * on any deviation; the caller must not commit a rejected policy and must never fall
 * back to a more permissive preset.
 * @returns {{version: number, preset: string, overrides: object}} a normalised copy
 */
export function validateProjectionPolicy (policy) {
	assertPlainObject(policy, "policy");
	assertNoUnknownKeys(policy, ["version", "preset", "overrides"], "policy");
	if (policy.version !== PROJECTION_POLICY_VERSION) fail(`policy.version must be ${PROJECTION_POLICY_VERSION}.`);
	if (!PROJECTION_PRESET_KEYS.includes(policy.preset)) fail(`policy.preset must be one of ${PROJECTION_PRESET_KEYS.join(", ")}.`);

	const overridesRaw = policy.overrides ?? {};
	assertPlainObject(overridesRaw, "policy.overrides");
	assertNoUnknownKeys(overridesRaw, PROJECTION_FIELD_KEYS, "policy.overrides");

	const overrides = {};
	for (const [field, override] of Object.entries(overridesRaw)) {
		assertPlainObject(override, `policy.overrides.${field}`);
		assertNoUnknownKeys(override, ["mode", "value"], `policy.overrides.${field}`);
		if (!PROJECTION_OVERRIDE_MODES.includes(override.mode)) {
			fail(`policy.overrides.${field}.mode must be one of ${PROJECTION_OVERRIDE_MODES.join(", ")}.`);
		}
		if (override.mode === "replace") {
			if (override.value === undefined) fail(`policy.overrides.${field}.value is required for replace.`);
			overrides[field] = {mode: "replace", value: FIELD_VALIDATORS[field](override.value)};
			continue;
		}
		if (override.value !== undefined) fail(`policy.overrides.${field}.value is only valid for replace.`);
		overrides[field] = {mode: override.mode};
	}

	return {version: PROJECTION_POLICY_VERSION, preset: policy.preset, overrides};
}

export function isValidProjectionPolicy (policy) {
	try {
		validateProjectionPolicy(policy);
		return true;
	} catch {
		return false;
	}
}

/* -------------------------------------------- */
//  Policy application
/* -------------------------------------------- */

/**
 * Apply a *validated* policy to a view model.
 * @returns {object} the peer-visible data object; omitted fields are absent, not null
 */
export function applyProjectionPolicy ({viewModel, policy}) {
	const shared = new Set(PROJECTION_PRESETS[policy.preset]);
	const out = {};
	for (const field of PROJECTION_FIELD_KEYS) {
		const override = policy.overrides?.[field];
		if (override?.mode === "hide") continue;
		if (override?.mode === "replace") {
			out[field] = structuredClone(override.value);
			continue;
		}
		if (override?.mode !== "share" && !shared.has(field)) continue;
		const value = viewModel[field];
		if (value === undefined) continue;
		out[field] = structuredClone(value);
	}
	return out;
}

/**
 * The single peer-facing profile for a character revision and projection revision. It is
 * recipient-independent: every non-owner, non-DM peer receives exactly this value.
 *
 * Fails closed — a policy that cannot be validated yields an empty `data`, which is
 * indistinguishable from the `private` preset, so a corrupt policy is not enumerable.
 */
export function computePeerProfile ({character, expectedBasis} = {}) {
	const projectionRevision = Number(character.projectionRevision) || 1;
	const envelope = {
		kind: "peer_profile",
		id: character.id,
		campaignId: character.campaignId,
		revision: Number(character.revision) || 1,
		projectionRevision,
	};
	let policy;
	try {
		policy = validateProjectionPolicy(character.projectionPolicy);
	} catch {
		return {...envelope, data: {}};
	}
	const data = applyProjectionPolicy({viewModel: buildCharacterViewModel(character.data, {expectedBasis}), policy});
	return {
		...envelope,
		...(data.identity && character.targetRef ? {targetRef: character.targetRef} : {}),
		data,
	};
}

/**
 * The owner-only sharing management view: the persisted policy plus the *server-computed*
 * peer profile a real peer fetch would receive. Sharing UI renders this preview rather
 * than deriving one, so a client can never disagree with the authority.
 *
 * When the persisted policy is invalid the owner/DM sees `PROJECTION_POLICY_INVALID`
 * while the preview stays empty — the same value peers receive.
 */
/**
 * The single outcome for a sharing-policy request the requester may not have: a character
 * that does not exist and one owned by somebody else are indistinguishable, and neither
 * confirms an id.
 */
/**
 * Strip the owner's sharing configuration from a canonical character response.
 *
 * Raw policy is never a response field outside the owner's own management endpoint and
 * the `owner_truth` envelope's `policy`. Campaign-scoped lists and DM mutation responses
 * carry the document, so they must not carry another owner's choices with it.
 */
export function stripProjectionPolicy (character) {
	if (!character || typeof character !== "object") return character;
	const {projectionPolicy, ...rest} = character;
	return rest;
}

/**
 * A peer may only target a character whose identity that character's owner shares. The
 * error is deliberately identical to "not found" so a rejected probe cannot enumerate
 * hidden characters.
 */
export function assertPeerTargetable ({character, accountId, role, fnError}) {
	if (character.ownerAccountId === accountId) return;
	if (["dm", "co_dm"].includes(role)) return;
	if (isPeerVisibleIdentity(character)) return;
	throw fnError();
}

export function getPolicyNotAvailableError () {
	return new HubStoreError("PROJECTION_POLICY_NOT_AVAILABLE", `Sharing settings are not available for this character.`, {status: 404});
}

/**
 * @param {object} character
 * @param {?object} expectedBasis The live carry basis. Required for the preview to match what
 *   a peer actually reads: without it `resolveCarryAuthority` fails closed, and the owner is
 *   shown a preview missing the very carry they just chose to share while peers see it.
 */
export function getPolicyManagementResponse (character, {expectedBasis} = {}) {
	const preview = computePeerProfile({character, expectedBasis});
	try {
		return {
			policy: validateProjectionPolicy(character.projectionPolicy),
			projectionRevision: Number(character.projectionRevision) || 1,
			preview,
		};
	} catch (error) {
		return {
			policy: null,
			projectionRevision: Number(character.projectionRevision) || 1,
			preview,
			error: error.code,
		};
	}
}

/**
 * Whether a viewer may learn that `actorAccountId` acted on this character.
 *
 * Stripping payload keys is not enough: a shared event envelope also carries the actor
 * beside the aggregate id, so `character.created` — and the privacy-setting invalidation
 * itself — would otherwise map a hidden character straight back to its named owner.
 *
 * Attribution survives wherever it is independently authorized: the actor sees their own
 * action, the owner and DMs already know, and once identity is peer-visible the roster
 * exposes the same association anyway.
 */
export function canViewCharacterEventActor ({character, accountId, role, actorAccountId}) {
	if (accountId && actorAccountId === accountId) return true;
	if (["dm", "co_dm"].includes(role)) return true;
	// An absent character cannot be shown to have shared its identity. Rows outlive the
	// row they describe — account purge hard-deletes the character while leaving the
	// campaign's domain events — so a missing character fails closed rather than
	// retroactively republishing everything its owner had hidden.
	if (!character) return false;
	if (character.ownerAccountId === accountId) return true;
	return isPeerVisibleIdentity(character);
}

/** Remove actor attribution from one event without disturbing its ordering metadata. */
export function redactEventActor (event) {
	const {actorAccountId, actorDisplayName, ...rest} = event;
	return {...rest, actorAccountId: null};
}

/**
 * Whether a shared character event may be shown to this viewer at all.
 *
 * Redacting the actor is not sufficient on its own. Lifecycle events compose: a hidden
 * character's `character.moved_out` lands immediately before the `membership.left` /
 * `membership.removed` that names the departing member, and the membership event is
 * legitimate roster news that cannot be sanitised away — even without its payload, its
 * aggregate is a membership id a peer can resolve through the member list. Two adjacent
 * rows therefore map the hidden character to its owner and retroactively attribute its
 * whole activity history.
 *
 * So a character whose identity its owner does not share contributes no shared activity
 * rows. Nothing is lost: without the identity those rows could only ever have read
 * "A character updated".
 */
export function canViewSharedCharacterEvent ({character, accountId, role}) {
	if (["dm", "co_dm"].includes(role)) return true;
	// Fails closed when the character is gone: account purge hard-deletes the character
	// but retains the campaign's domain events, and a deleted row cannot demonstrate that
	// its owner ever chose to share an identity.
	if (!character) return false;
	if (character.ownerAccountId === accountId) return true;
	return isPeerVisibleIdentity(character);
}

/** True when peers can see who this character is, and therefore may target it. */export function isPeerVisibleIdentity (character) {
	try {
		const policy = validateProjectionPolicy(character.projectionPolicy);
		const override = policy.overrides?.identity;
		if (override?.mode === "hide") return false;
		if (override?.mode === "replace" || override?.mode === "share") return true;
		return PROJECTION_PRESETS[policy.preset].includes("identity");
	} catch {
		return false;
	}
}

/**
 * Resolve the authorization outcome for one character read.
 * @param {object} options.character canonical character document
 * @param {"owner"|"dm"|"peer"} options.authorizationClass resolved by the store
 * @param {Function} options.fnCopy deep-copy used for canonical documents
 */
/**
 * The validated carry summary a DM is entitled to, independent of the owner's sharing policy.
 *
 * A DM receives canonical truth, so their carry reading must not be routed through
 * `peerPreview`: that is filtered by the owner's policy, and a character who shares nothing
 * would leave the DM Screen with no summary and silently fall back to recomputing capacity
 * from raw inventory — which is precisely the divergent local formula this contract removed.
 *
 * Validated through the same fail-closed resolver, so a stale or malformed block yields
 * `undefined` here exactly as it does for a peer.
 * @returns {?object} `{carried, capacity, state}` or `undefined`.
 */
export function getDmCarrySummary ({character, expectedBasis}) {
	const authority = resolveCarryAuthority({data: character?.data, expectedBasis});
	if (!authority) return undefined;
	const out = {};
	const carried = toFiniteNumber(authority.bodyLoad, {min: 0, max: MAX_WEIGHT});
	if (carried != null) out.carried = carried;
	const capacity = toFiniteNumber(authority.bodyCapacity, {min: 0, max: MAX_WEIGHT});
	if (capacity != null) out.capacity = capacity;
	const state = toLabel(authority.status, {maxLength: 40});
	if (state) out.state = state;
	return Object.keys(out).length ? out : undefined;
}

export function projectCharacterForRequester ({character, authorizationClass, fnCopy = structuredClone, expectedBasis}) {
	if (authorizationClass === "peer") return computePeerProfile({character, expectedBasis});

	const isPolicyValid = isValidProjectionPolicy(character.projectionPolicy);
	// The canonical document is returned without its embedded policy: the owner receives
	// the policy in its own field, and a DM receives the peer preview instead of the
	// owner's raw sharing configuration.
	const {
		projectionPolicy,
		targetRef = null,
		operationWatermark = 0,
		...truth
	} = fnCopy(character);
	const envelope = {
		character: truth,
		projectionRevision: Number(character.projectionRevision) || 1,
		targetRef,
		operationWatermark: Number(operationWatermark) || 0,
		...(isPolicyValid ? {} : {policyError: "PROJECTION_POLICY_INVALID"}),
	};
	if (authorizationClass === "owner") {
		return {
			kind: "owner_truth",
			...envelope,
			policy: isPolicyValid ? validateProjectionPolicy(character.projectionPolicy) : null,
		};
	}
	return {
		kind: "dm_truth",
		...envelope,
		// Policy-independent: a DM's view of carry must not depend on what the owner chose to
		// share with peers.
		carrySummary: getDmCarrySummary({character, expectedBasis}),
		peerPreview: computePeerProfile({character, expectedBasis}),
	};
}
