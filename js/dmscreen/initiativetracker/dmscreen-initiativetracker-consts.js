export class InitiativeTrackerConst {
	static SORT_ORDER_ALPHA = "ALPHA";
	static SORT_ORDER_NUM = "NUMBER";

	static SORT_DIR_ASC = "ASC";
	static SORT_DIR_DESC = "DESC";

	static DIR_FORWARDS = 1;
	static DIR_BACKWARDS = -1;
	static DIR_NEUTRAL = 0;
}

/**
 * Row-schema helpers shared across initiative-tracker features. Any feature
 * that operates on "combatant" rows (multi-select HP, bulk conditions, sort
 * modes that care about turn order, etc.) should route through these
 * predicates so new marker types compose without touching every feature.
 */
export class InitiativeTrackerRowUtil {
	/**
	 * Allow-list of boolean flag names on `row.entity` that mark a row as a
	 * non-combatant (lair actions, environmental effects, future hazards /
	 * fog / timers, etc.). New marker types opt out of combat operations by
	 * adding one entry here — no changes required in any feature that
	 * consumes `isNonCombatantRow`.
	 *
	 * Contract for new marker types: use a `is*Marker` naming convention so
	 * the flag itself is self-documenting when it appears in serialised state.
	 *
	 * Canonical entries:
	 *   - `isLairMarker` — automatic lair-action rows (tracker #1141, branch
	 *     `truemichato-auto-lair-actions`; canonical namespace declared in
	 *     `js/dmscreen/initiativetracker/dmscreen-initiativetracker-lairmarkers.js`).
	 */
	static NON_COMBATANT_FLAGS = [
		"isLairMarker",
	];

	/**
	 * True when the row represents any kind of non-combatant marker.
	 * Features that shouldn't operate on markers (bulk HP, condition apply,
	 * etc.) should filter with this predicate rather than checking any
	 * individual flag directly.
	 */
	static isNonCombatantRow (row) {
		const entity = row?.entity;
		if (!entity) return false;
		for (const flag of InitiativeTrackerRowUtil.NON_COMBATANT_FLAGS) {
			if (entity[flag]) return true;
		}
		return false;
	}

	/** Inverse of `isNonCombatantRow`. */
	static isCombatantRow (row) {
		return !InitiativeTrackerRowUtil.isNonCombatantRow(row);
	}

	/**
	 * 5e "damage on save = half damage" rule: halve the magnitude, round down.
	 * Sign is preserved so it works uniformly for healing halves too.
	 * PHB p.196: "half as much damage on a successful one". Rulebook rounds
	 * down (PHB p.7 "Rounding Numbers"). Minimum stays at 0 — 5e does not
	 * apply the "minimum 1" rule to save-for-half (that rule is for damage
	 * resistance/vulnerability doubling, not for saves).
	 */
	static getHalvedDelta (delta) {
		if (!Number.isFinite(delta) || delta === 0) return 0;
		const sign = delta < 0 ? -1 : 1;
		const halved = Math.floor(Math.abs(delta) / 2) * sign;
		// Normalise `-0` -> `0` so consumers doing strict equality (or Object.is
		// checks in tests) don't trip over the signed-zero artifact.
		return halved === 0 ? 0 : halved;
	}
}
