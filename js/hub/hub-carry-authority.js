/**
 * The single definition of "the authoritative carry summary" and of when it may be trusted.
 *
 * A character document carries two things that could be mistaken for carry truth:
 *
 *   - the raw inputs (`inventory`, `abilities`, `settings`, …), from which capacity CANNOT be
 *     rederived outside the Character Sheet. Capacity depends on passive Might including
 *     passive bonuses, on `projectItemMaterial()` weights gated behind three material
 *     sub-settings, on carry-only active-state size steps, on item-effect carry multipliers,
 *     on equipped extradimensional capacity and on the fill/body split — all of which live
 *     behind `CharacterSheetState` methods. Any server-side attempt to reconstruct them
 *     would be a second, silently divergent implementation wearing the contract's name.
 *   - `data.carry`, materialised deterministically by `CharacterSheetState.toJson()` from the
 *     live calculation. This is the only authoritative value.
 *
 * Resolving that choice here — rather than in the projector — keeps one formula source, in
 * the same way `hub-semantic-hp.js` resolves the applicable maximum hit points.
 *
 * **Freshness is the hard part.** `toJson()` stripping stops a stale block becoming sheet
 * input again, but it does nothing about the saved cloud document: item grants and transfer
 * escrow mutate `data.inventory` on the server while preserving unrelated fields, and
 * campaign rules or brew activation change carry inputs without touching the document at
 * all. This module therefore validates a recorded `basis` against the caller's expected
 * basis and returns `null` on any mismatch, so a summary authored under different rules,
 * a different brew bundle or different carry settings is never presented as current.
 *
 * Returning `null` rather than throwing lets each caller choose its own failure: the
 * projector omits `carrySummary` entirely, and the Party Tracker renders an explicit
 * "not synced" state instead of a confident zero.
 *
 * Browser-safe and dependency-free, so both stores and the projector import it directly.
 */

/** The only schema version this build understands. */
export const CARRY_SCHEMA_VERSION = 1;

/**
 * Settings that can change a carry result. Deliberately a closed list of the inputs the
 * capacity and weight calculations actually read: widening it would churn the digest (and
 * needlessly invalidate summaries) for settings that cannot affect carry.
 */
export const CARRY_RELEVANT_SETTING_KEYS = Object.freeze([
	"enableTgtt",
	"thelemar_carryWeight",
	"thelemar_encumbranceTiers",
	"enableMaterials",
	"materials_weightFromDensity",
	"materials_degradation",
]);

const CARRY_NUMERIC_KEYS = Object.freeze([
	"sourceValue", "thresholdSourceValue", "perPoint", "base", "flatBonus",
	"carryMultiplier", "sizeMultiplier", "bodyCapacity", "externalCapacity", "bagCapacity",
	"grossWeight", "fillableWeight", "bagLoad", "bodyLoad", "total", "pushDragLift",
	"coinWeight", "unknownStackCount", "spareCapacity",
]);

const CARRY_ALLOWED_KEYS = Object.freeze(new Set([
	"schemaVersion", "basis", "rule", "thresholdRuleId", "status", "thresholds",
	"hasExtradimensional", "isCoinWeightCounted", "isIndeterminate", "isCapacityOverridden",
	...CARRY_NUMERIC_KEYS,
]));

const MAX_CARRY_VALUE = 1e9;

function isPlainObject (value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A deterministic digest of the carry-relevant settings.
 *
 * Order-independent and stable across engines because the keys are enumerated from a frozen
 * list rather than from object iteration order, so a client and a server that merged the
 * same effective settings always agree.
 * @param {object} settings Effective (campaign-overlaid) character settings.
 * @returns {string}
 */
export function computeCarrySettingsDigest (settings) {
	const source = isPlainObject(settings) ? settings : {};
	return CARRY_RELEVANT_SETTING_KEYS
		.map(key => `${key}=${source[key] === undefined ? "~" : JSON.stringify(source[key])}`)
		.join("|");
}

/**
 * The basis for a character that belongs to a campaign.
 *
 * `rulesVersionId` and `brewBundleHash` may legitimately be `null` — a campaign with no
 * active rules version or no brew bundle is a real, observed state, not a placeholder. What
 * matters is that the value was OBSERVED: if a DM later activates a rules version, the
 * expected basis becomes a real id, the recorded `null` no longer matches, and the summary
 * correctly falls out of trust.
 * @returns {object}
 */
export function createCampaignCarryBasis ({rulesVersionId = null, brewBundleHash = null, settingsDigest = ""} = {}) {
	return Object.freeze({
		kind: "campaign",
		rulesVersionId: rulesVersionId ?? null,
		brewBundleHash: brewBundleHash ?? null,
		settingsDigest: String(settingsDigest ?? ""),
	});
}

/**
 * The basis for a character that belongs to no campaign, so no overlay or brew bundle can
 * apply. An explicit variant rather than a bag of nulls, so "no campaign" can never be
 * confused with "campaign whose basis we failed to resolve".
 * @returns {object}
 */
export function createDetachedCarryBasis ({settingsDigest = ""} = {}) {
	return Object.freeze({kind: "detached", settingsDigest: String(settingsDigest ?? "")});
}

function isValidBasisShape (basis) {
	if (!isPlainObject(basis)) return false;
	if (typeof basis.settingsDigest !== "string") return false;
	if (basis.kind === "detached") return true;
	if (basis.kind !== "campaign") return false;
	const isNullableString = value => value === null || typeof value === "string";
	return isNullableString(basis.rulesVersionId) && isNullableString(basis.brewBundleHash);
}

/**
 * Whether a recorded basis still describes the world the caller is in.
 *
 * Scalar comparison only — no carry arithmetic is repeated here, which is what keeps the
 * server from becoming a second implementation.
 * @param {object} recorded
 * @param {object} expected
 * @returns {boolean}
 */
export function isCarryBasisCurrent (recorded, expected) {
	if (!isValidBasisShape(recorded) || !isValidBasisShape(expected)) return false;
	if (recorded.kind !== expected.kind) return false;
	if (recorded.settingsDigest !== expected.settingsDigest) return false;
	if (recorded.kind === "detached") return true;
	return recorded.rulesVersionId === expected.rulesVersionId
		&& recorded.brewBundleHash === expected.brewBundleHash;
}

/**
 * Remove any carry authority from a character document, in place-safe fashion.
 *
 * Called at real mutation commit points ONLY — after an item grant changes the inventory,
 * and when a transfer writer commits an escrow reservation, an acceptance, or a
 * reject/cancel/expiry restore. It is deliberately NOT called from document normalization
 * or from container reads: normalization also runs on create and import, where it would
 * delete a perfectly fresh block on first cloud save, and container reads touch both
 * transfer participants, where it would erase the authority of a target that a mere
 * proposal never modified.
 * @param {object} data A character document.
 * @returns {object} The same reference, for call-site convenience.
 */
export function stripCarryAuthority (data) {
	if (isPlainObject(data)) delete data.carry;
	return data;
}

/**
 * Whether a JSON-patch operation writes a plausible carry block.
 *
 * The current Character Sheet emits a `/carry` write on every owner save whose document
 * otherwise changes — even when the summary is byte-identical — so its presence is the
 * signal that the writer understood carry authority. Its absence means an older or
 * third-party client produced the patch, and any pre-existing authority must be dropped
 * rather than silently inherited by a document it no longer describes.
 *
 * This avoids enumerating "carry-relevant paths", which could never be complete: passive
 * Might alone depends on skill proficiency, expertise, class levels, proficiency bonus,
 * named and passive modifiers, feature choices and item-derived modifiers.
 * @param {Array} patches
 * @returns {boolean}
 */
export function hasFreshCarryWrite (patches) {
	if (!Array.isArray(patches)) return false;
	return patches.some(patch => {
		if (!isPlainObject(patch)) return false;
		if (patch.path !== "/carry") return false;
		if (patch.op !== "add" && patch.op !== "replace") return false;
		return isPlainObject(patch.value) && patch.value.schemaVersion === CARRY_SCHEMA_VERSION;
	});
}

/**
 * Force a document-changing patch set to carry a ROOT `/carry` write.
 *
 * The server identifies a carry-aware writer by the presence of a whole-block `/carry` op.
 * The clients, however, build their patches with a RECURSIVE `diffJson`, which never
 * produces one: an unrelated rename emits only `/name`, and an edited summary emits
 * `/carry/bodyLoad`. Both look exactly like an old client, so every ordinary save stripped
 * the authority it was actually carrying and the following save re-added it — the summary
 * oscillated between present and absent instead of simply staying current.
 *
 * Normalising here rather than in the diff keeps `diffJson` a pure structural diff, and
 * keeps the "what does a current client look like?" question answered in one place next to
 * the check that asks it.
 *
 * Nested `/carry/...` ops are collapsed into the single root write so the block is replaced
 * atomically; a reader must never observe a half-updated summary, and a partial op could not
 * be recognised as fresh anyway.
 *
 * @param {{patches: Array, document: object, base?: object}} params `document` is the state
 *   being saved; `base` is the accepted document the patches were diffed against.
 * @returns {Array} The patch list to submit.
 */
export function withRootCarryWrite ({patches, document, base = null} = {}) {
	if (!Array.isArray(patches) || !patches.length) return Array.isArray(patches) ? patches : [];
	// No authority to assert: the server strips nothing, and inventing a write would be a lie.
	if (!isPlainObject(document?.carry)) return patches;

	const rest = patches.filter(patch => {
		const path = patch?.path;
		return path !== "/carry" && !(typeof path === "string" && path.startsWith("/carry/"));
	});
	const op = isPlainObject(base) && Object.hasOwn(base, "carry") ? "replace" : "add";
	return [...rest, {op, path: "/carry", value: document.carry}];
}

/**
 * Validate and return the authoritative carry summary, or `null`.
 *
 * Fails closed on every uncertainty: an absent block, a schema version this build does not
 * understand, an unknown key, a non-finite or out-of-range number, a malformed basis, or a
 * basis that no longer matches the caller's expectation. A caller that cannot supply an
 * expected basis gets `null` rather than an unchecked summary, so "we could not verify
 * freshness" and "the character is unencumbered" can never be confused.
 * @param {{data?: object, expectedBasis?: object}} params
 * @returns {object|null} A frozen summary, or `null` when it cannot be trusted.
 */
export function resolveCarryAuthority ({data, expectedBasis} = {}) {
	if (!isPlainObject(data)) return null;
	const carry = data.carry;
	if (!isPlainObject(carry)) return null;
	if (carry.schemaVersion !== CARRY_SCHEMA_VERSION) return null;

	for (const key of Object.keys(carry)) {
		if (!CARRY_ALLOWED_KEYS.has(key)) return null;
	}

	for (const key of CARRY_NUMERIC_KEYS) {
		const value = carry[key];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_CARRY_VALUE) return null;
	}

	if (typeof carry.status !== "string" || !carry.status) return null;
	if (typeof carry.bodyCapacity !== "number" || typeof carry.bodyLoad !== "number") return null;
	if (!isCarryBasisCurrent(carry.basis, expectedBasis)) return null;

	return Object.freeze({...carry});
}
