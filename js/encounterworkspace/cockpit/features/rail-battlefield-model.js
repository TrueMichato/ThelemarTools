/**
 * DOM-free helpers for the rail's battlefield extras: where the lair-actions row sits in initiative and when a turn
 * change passes initiative count 20.
 */

export const RAIL_LAIR_INITIATIVE = 20;

const getInit = value => Number.isFinite(value) ? value : -Infinity;

/**
 * Where the lair row goes among rail rows (in turn order, `inits[i]` the row's initiative or null): before the
 * first row strictly below `initiative` (lair actions lose ties), else after the last row. -1 when there are no rows.
 */
export function getRailLairIndex (inits, {initiative = RAIL_LAIR_INITIATIVE} = {}) {
	if (!inits?.length) return -1;
	const ix = inits.findIndex(it => getInit(it) < initiative);
	return ix < 0 ? inits.length : ix;
}

/**
 * Whether moving the turn forward from `before` to `after` ({round, init}) passes the lair's count (20, losing ties):
 * in the same round when going from ≥20 to <20; on a new round when the old round ended at ≥20 (the lair came last)
 * or the new one starts below 20 (the lair comes first). Going back never counts.
 */
export function getIsRailLairTurnCrossed (before, after, {initiative = RAIL_LAIR_INITIATIVE} = {}) {
	const roundBefore = before?.round || 0;
	const roundAfter = after?.round || 0;
	if (!roundAfter) return false;
	const initBefore = getInit(before?.init);
	const initAfter = getInit(after?.init);
	if (roundAfter > roundBefore) return !roundBefore ? initAfter < initiative : initBefore >= initiative || initAfter < initiative;
	if (roundAfter < roundBefore) return false;
	return initBefore >= initiative && initAfter < initiative;
}
