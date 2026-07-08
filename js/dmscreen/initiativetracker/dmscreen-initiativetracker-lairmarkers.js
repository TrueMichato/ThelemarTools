/**
 * Pure, DOM-free logic for the initiative tracker's "lair action companion" rows.
 *
 * A row is a "lair marker" when `entity.isLairMarker === true`. Markers represent
 * the DMG "initiative count 20 (loses ties)" lair-action turn for a creature's
 * legendary group. One marker per unique legendary group per tracker; it is
 * shared across all creatures in the encounter that reference the same group.
 *
 * The main entry point, `computeReconcileDiff`, is deliberately synchronous and
 * pure — it takes a snapshot of rows and a pre-populated legendary-group cache
 * and returns the diff to apply. Async loading of legendary groups lives in the
 * tracker itself (see `InitiativeTracker.pReconcileLairMarkers`).
 */
export class InitiativeTrackerLairMarkers {
	/* -------------------------------------------- */
	// region Identity

	/**
	 * Stable hash identifying a legendary group.
	 * @param {?string} name
	 * @param {?string} source
	 * @returns {?string} `null` when either component is missing.
	 */
	static getGroupHash ({name, source}) {
		if (!name || !source) return null;
		return `${name}|${source}`.toLowerCase();
	}

	/**
	 * @param {object} monRow A non-marker row.
	 * @returns {?string} Hash for the row's legendary-group reference, or `null`.
	 */
	static getRowGroupHash (monRow) {
		if (!monRow?.entity || monRow.entity.isLairMarker) return null;
		const {legendaryGroup} = monRow.entity._monLegendaryGroupRef || {};
		if (!legendaryGroup) return null;
		return this.getGroupHash(legendaryGroup);
	}

	/**
	 * @param {?object} legGroup A loaded legendary-group entry.
	 * @returns {boolean} True when the group has any lair/regional/mythic content
	 *   worth tracking at init 20.
	 */
	static hasTrackableContent (legGroup) {
		if (!legGroup) return false;
		return !!(legGroup.lairActions || legGroup.regionalEffects);
	}

	// endregion

	/* -------------------------------------------- */
	// region Diff computation

	/**
	 * Compute the reconciled `rows` array for a tracker given the current row set
	 * and a pre-populated cache of resolved legendary groups.
	 *
	 * The caller is responsible for:
	 *   - Loading legendary groups asynchronously and populating `legGroupCache`
	 *     (a map of `hash -> {legGroup, monLegendaryGroupRef}`).
	 *   - Passing `monsterLegendaryGroupHashByRowId` — a map of `rowId -> hash`
	 *     for every non-marker row that has an eligible legendary group. Rows
	 *     absent from this map are treated as having no group.
	 *   - Only applying the returned diff when it is non-empty (to avoid
	 *     re-entering hooks).
	 *
	 * @param {object} opts
	 * @param {Array<object>} opts.rows Current rows (marker + non-marker).
	 * @param {Map<string, string>} opts.monsterLegendaryGroupHashByRowId
	 * @param {Map<string, {legGroup: object, monName: string}>} opts.legGroupCache
	 * @param {boolean} opts.autoAddEnabled
	 * @param {Set<string>} [opts.dismissedHashes] Hashes the DM has explicitly
	 *   dismissed for this tracker session (shift-delete). Auto-add is skipped
	 *   for these. Manual markers are unaffected.
	 * @param {function(): string} opts.fnMakeId Id factory (`CryptUtil.uid` at
	 *   runtime, deterministic in tests).
	 * @returns {{rowsNxt: Array<object>, changed: boolean, added: Array<object>, removed: Array<object>, refUpdates: Array<{markerId: string, refRowIds: string[]}>}}
	 */
	static computeReconcileDiff (
		{
			rows,
			monsterLegendaryGroupHashByRowId,
			legGroupCache,
			autoAddEnabled,
			dismissedHashes = new Set(),
			fnMakeId,
		},
	) {
		const markerRows = rows.filter(r => r.entity?.isLairMarker);
		const monsterRows = rows.filter(r => !r.entity?.isLairMarker);

		// Group monster row ids by hash
		const monRowIdsByHash = new Map();
		for (const row of monsterRows) {
			const hash = monsterLegendaryGroupHashByRowId.get(row.id);
			if (!hash) continue;
			if (!legGroupCache.has(hash)) continue;
			if (!this.hasTrackableContent(legGroupCache.get(hash)?.legGroup)) continue;
			if (!monRowIdsByHash.has(hash)) monRowIdsByHash.set(hash, []);
			monRowIdsByHash.get(hash).push(row.id);
		}

		const existingMarkerByHash = new Map();
		for (const marker of markerRows) {
			const hash = this.getGroupHash({
				name: marker.entity.legendaryGroupName,
				source: marker.entity.legendaryGroupSource,
			});
			if (!hash) continue;
			existingMarkerByHash.set(hash, marker);
		}

		const added = [];
		const refUpdates = [];
		const rowsNxt = [...rows];

		// Pass 1: for each hash with monster refs, ensure a marker exists and
		//   sync its refRowIds to the current member set.
		for (const [hash, refRowIds] of monRowIdsByHash.entries()) {
			const existing = existingMarkerByHash.get(hash);
			if (existing) {
				const sortedNext = [...refRowIds].sort();
				const sortedPrev = [...(existing.entity.refRowIds || [])].sort();
				if (sortedNext.join("|") !== sortedPrev.join("|")) {
					existing.entity.refRowIds = refRowIds;
					refUpdates.push({markerId: existing.id, refRowIds});
				}
				continue;
			}

			if (!autoAddEnabled) continue;
			if (dismissedHashes.has(hash)) continue;

			const {legGroup, monName} = legGroupCache.get(hash);
			const marker = this._buildAutoMarker({legGroup, monName, refRowIds, fnMakeId});
			added.push(marker);
			rowsNxt.push(marker);
		}

		// Pass 2: for each existing auto marker whose hash has no monster refs
		//   left, remove it. Manual markers are kept but have their refRowIds
		//   cleared.
		const removed = [];
		const rowsNxt2 = [];
		for (const row of rowsNxt) {
			if (!row.entity?.isLairMarker) { rowsNxt2.push(row); continue; }

			const hash = this.getGroupHash({
				name: row.entity.legendaryGroupName,
				source: row.entity.legendaryGroupSource,
			});
			const stillReferenced = hash && monRowIdsByHash.has(hash);

			if (stillReferenced) { rowsNxt2.push(row); continue; }

			if (row.entity.isLairMarkerManual) {
				// Preserve manual marker; clear stale refs
				if ((row.entity.refRowIds || []).length) {
					row.entity.refRowIds = [];
					refUpdates.push({markerId: row.id, refRowIds: []});
				}
				rowsNxt2.push(row);
				continue;
			}

			removed.push(row);
		}

		const changed = added.length > 0 || removed.length > 0 || refUpdates.length > 0;
		return {rowsNxt: rowsNxt2, changed, added, removed, refUpdates};
	}

	// endregion

	/* -------------------------------------------- */
	// region Marker construction

	/**
	 * @param {object} opts
	 * @param {object} opts.legGroup Resolved legendary-group entry.
	 * @param {string} opts.monName Parent monster's display name (first
	 *   creature to trigger the marker).
	 * @param {string[]} opts.refRowIds Ids of creature rows referencing this
	 *   marker.
	 * @param {function(): string} opts.fnMakeId
	 * @returns {{id: string, entity: object}}
	 * @private
	 */
	static _buildAutoMarker ({legGroup, monName, refRowIds, fnMakeId}) {
		return this._buildMarker({legGroup, monName, refRowIds, isManual: false, fnMakeId});
	}

	/**
	 * Public builder — used by the tracker for the right-click "Add Lair
	 * Actions" flow.
	 */
	static buildManualMarker ({legGroup, monName, refRowIds = [], fnMakeId}) {
		return this._buildMarker({legGroup, monName, refRowIds, isManual: true, fnMakeId});
	}

	static _buildMarker ({legGroup, monName, refRowIds, isManual, fnMakeId}) {
		return {
			id: fnMakeId(),
			entity: {
				isActive: false,
				isPlayerVisible: true,
				isLairMarker: true,
				isLairMarkerManual: !!isManual,
				legendaryGroupName: legGroup.name,
				legendaryGroupSource: legGroup.source,
				parentMonsterName: monName || legGroup.name,
				refRowIds: [...refRowIds],

				// `name` intentionally set to the legendary-group name (not the
				//   literal "Lair") so that similar-row hashing keeps each
				//   marker distinct — the tracker groups turn-activation by
				//   `getSimilarRowEntityHash` which hashes on `name`.
				name: legGroup.name,
				displayName: this.getMarkerDisplayName({monName: monName || legGroup.name}),
				customName: null,
				source: null,
				scaledCr: null,
				scaledSummonSpellLevel: null,
				scaledSummonClassLevel: null,
				hpCurrent: null,
				hpMax: null,
				initiative: this.INITIATIVE_LAIR,
				ordinal: 1,
				rowStatColData: [],
				conditions: [],
			},
		};
	}

	static getMarkerDisplayName ({monName}) {
		return `Lair (${monName})`;
	}

	static INITIATIVE_LAIR = 20;

	// endregion
}
