/**
 * The single definition of "the applicable maximum" for semantic hit-point operations.
 *
 * ADR 0012 specifies that `hp.heal` "clamps to the applicable maximum". A character document
 * carries two different numbers that could be mistaken for it:
 *
 *   - `hp.max` is the Character Sheet's cached `_calculateMaxHp()` BASE. It deliberately omits
 *     the contributions `getMaxHp()` layers on live — item `maxHpBonus` / `maxHpPerLevel` effects
 *     and psionic body-strain halving — and, in documents written before the maximum was first
 *     recalculated, it can be absent or zero.
 *   - `hp.effectiveMax` is the applicable maximum: exactly the number the sheet shows the player,
 *     materialised deterministically by `CharacterSheetState.toJson()` from `getMaxHp()`.
 *
 * Resolving that choice here — rather than in the server applicator — keeps one formula source and
 * lets the browser apply the identical pure operation to its live state without reimplementing any
 * Character Sheet rules.
 *
 * This module is browser-safe and dependency-free (see `hub-json-patch.js`, which the server stores
 * already import the same way). It returns `null` instead of throwing a domain error so that each
 * caller can raise its own: the server maps `null` to `HubStoreError("OPERATION_STATE_INVALID")`.
 */

function getPositiveIntegerOrNull (value) {
	if (value == null || value === "" || typeof value === "boolean") return null;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > Number.MAX_SAFE_INTEGER) return null;
	return number;
}

/**
 * Resolve the maximum a semantic hit-point operation must clamp against.
 *
 * Prefers the applicable maximum; falls back to the base maximum so documents stored before
 * `hp.effectiveMax` existed keep behaving exactly as they do today. A non-positive maximum is
 * never a legitimate clamp target — returning `null` makes the caller fail visibly instead of
 * silently clamping a heal down to zero hit points.
 * @param {object} hp A character document's `hp` block.
 * @returns {number|null} A positive integer maximum, or `null` when the document cannot supply one.
 */
export function resolveApplicableMaxHp (hp) {
	if (!hp || typeof hp !== "object" || Array.isArray(hp)) return null;
	return getPositiveIntegerOrNull(hp.effectiveMax) ?? getPositiveIntegerOrNull(hp.max);
}

/**
 * The hit-point total after healing, clamped to the applicable maximum.
 *
 * Healing is monotonic by construction: the `Math.max` guard means a heal can only ever raise
 * current hit points. Without it, a character whose current total already exceeds the applicable
 * maximum — psionic body strain halves the maximum without touching the current total — would be
 * silently *damaged* by `Math.min` alone.
 * @param {number} current Current hit points.
 * @param {number} amount Positive heal amount.
 * @param {number} applicableMax Maximum resolved by {@link resolveApplicableMaxHp}.
 * @returns {number}
 */
export function getHealedHp ({current, amount, applicableMax}) {
	return Math.max(current, Math.min(applicableMax, current + amount));
}
