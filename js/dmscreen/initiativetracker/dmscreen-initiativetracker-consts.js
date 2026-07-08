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
	 * Non-combatant marker rows (lair actions, environmental effects, future
	 * fog / hazard markers) are present in the initiative order but should be
	 * excluded from combat operations — no HP editing, no condition rolls,
	 * no bulk-select surfacing.
	 *
	 * Extend this check when new marker flags are introduced.
	 *
	 * Currently recognises:
	 *   - `entity.isLairMarker` — automatic lair-action rows (tracker #1234)
	 */
	static isNonCombatantRow (row) {
		return !!row?.entity?.isLairMarker;
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
