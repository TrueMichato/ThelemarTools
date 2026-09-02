import {HubApiClient} from "./hub-api-client.js";
import {diffJson, rebaseJsonChanges} from "./hub-json-patch.js";
import {HubBroadcastSync} from "./hub-broadcast-sync.js";
import {getCharacterOperationRouting} from "./hub-character-operation-events.js";
import {
	BoundedIdSet,
	COVERAGE_VERSION,
	RECONCILE_STATUS,
	TRACK_DECISION,
	createCoverage,
	deserializeCoverage,
	planAppliedOperation,
	serializeCoverage,
} from "./hub-character-operation-reconciler.js";

const _PENDING_RESYNC_LIMIT = 64;
const _RESYNC_PAGE_LIMIT = 200;
const _RESYNC_MAX_PAGES = 50;

export class HubHttpCharacterRepository {
	isRescueMirrorEnabled = false;

	constructor ({campaignId = null, api = new HubApiClient(), broadcastSync = null}) {
		if (campaignId != null && (typeof campaignId !== "string" || !campaignId)) throw new TypeError(`campaignId must be a non-empty string or null.`);
		this._campaignId = campaignId;
		this._api = api;
		this._scopeKey = campaignId || "detached";
		this._broadcastSync = broadcastSync || (
			!campaignId || typeof BroadcastChannel === "undefined"
				? null
				: new HubBroadcastSync({campaignId})
		);
		this._session = null;
		this._accepted = new Map();
		this._canonicalIds = new Map();
		this._leases = new Map();
		this._conflicts = new Map();
		this._pMutationQueue = Promise.resolve();
		this._pendingWrites = 0;
		this._recoveryStorage = globalThis.sessionStorage || null;
		this._recoveryVersions = new Map();
		this._failedWrites = new Map();
		this._latestSubmitted = new Map();
		this._recoveredBases = new Map();
		this._failedCommands = new Map();
		// Operation-aware reconciliation state (ADR 0012). Coverage is per track because a freshly fetched
		// canonical document and the recovery draft returned alongside it can sit at different revisions.
		this._coverage = new Map();
		this._appliedEventIds = new Map();
		this._appliedOperationIds = new Map();
		this._pendingResync = new Map();
		this._resyncInFlight = new Set();
		this._realtimeCursors = new Map();
		this._saveBlocks = new Map();
		// Separate from `_conflicts` on purpose: a live conflict must receive the same operation transform, but
		// must NOT gate `pUpsert` the way a stored overlap conflict does.
		this._liveConflicts = new Map();
	}

	async _pEnsureSession () {
		this._session ||= await this._api.pGetSession();
		if (!this._session.signedIn) throw new Error(`Sign in to edit campaign characters.`);
	}

	_getData (character) {
		return {...structuredClone(character.data), id: character.id};
	}

	_getSnapshotData (character) {
		const out = structuredClone(character);
		delete out.id;
		return out;
	}

	_assertCharacterScope (character) {
		const campaignId = character.campaignId || null;
		if (campaignId === this._campaignId) return;
		const error = new Error(`Character campaign changed.`);
		error.code = "CHARACTER_CAMPAIGN_MISMATCH";
		error.characterId = character.id;
		error.campaignId = campaignId;
		throw error;
	}

	async pGetCampaignId ({characterId}) {
		await this._pEnsureSession();
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const character = await this._api.pGetCharacter({characterId: canonicalId});
		return character.campaignId || null;
	}

	async pList () {
		await this._pEnsureSession();
		return (await this._api.pListCharacters({campaignId: this._campaignId}))
			.filter(character => this._campaignId || character.campaignId == null)
			.map(character => {
				this._accepted.set(character.id, character);
				return this._getData(character);
			});
	}

	async pGet ({characterId}) {
		await this._pEnsureSession();
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const character = await this._api.pGetCharacter({characterId: canonicalId});
		this._assertCharacterScope(character);
		this._accepted.set(canonicalId, character);
		const book = this._getCoverageBook(canonicalId);
		book.acceptedOperationIds = new BoundedIdSet();
		const recovery = this._failedWrites.get(characterId) || this.getPendingRecovery(characterId);
		if (recovery) {
			this._failedWrites.set(characterId, recovery);
			// The document handed back is an older draft, not the canonical truth just stored above, so the live
			// track keeps its own (possibly unknown) coverage instead of inheriting the fetched revision.
			book.live = this._cloneTrackCoverage(book.failedWrite);
			return {...structuredClone(recovery), id: canonicalId};
		}
		book.live = createCoverage({
			revision: character.revision,
			acceptedSequence: this._realtimeCursors.get(canonicalId)?.operationWatermark ?? null,
		});
		return this._getData(character);
	}

	_cloneTrackCoverage (coverage) {
		return createCoverage({
			revision: coverage?.revision ?? null,
			acceptedSequence: coverage?.acceptedSequence ?? null,
			appliedOperationIds: coverage?.appliedOperationIds,
		});
	}

	async pAcquireLease ({characterId, isTakeover = false}) {
		await this._pEnsureSession();
		const lease = await this._api.pAcquireCharacterLease({characterId, isTakeover});
		this._leases.set(characterId, lease);
		this._broadcastSync?.announceLease({resourceId: characterId, epoch: lease.epoch});
		return lease;
	}

	_pRunMutation (fnMutate) {
		const pResult = this._pMutationQueue.then(fnMutate, fnMutate);
		this._pMutationQueue = pResult.catch(() => {});
		return pResult;
	}

	pEnqueueRealtimeDelivery ({characterId, fnDeliver}) {
		if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId is required.`);
		if (typeof fnDeliver !== "function") throw new TypeError(`fnDeliver is required.`);
		return this._pRunMutation(fnDeliver);
	}

	// #region Operation-aware reconciliation (ADR 0012)

	_getCoverageBook (characterId) {
		let book = this._coverage.get(characterId);
		if (!book) {
			book = {
				live: createCoverage(),
				latestSubmitted: createCoverage(),
				recoveredBase: createCoverage(),
				failedWrite: createCoverage(),
				acceptedOperationIds: new BoundedIdSet(),
			};
			this._coverage.set(characterId, book);
		}
		return book;
	}

	_getAppliedIds (characterId) {
		let events = this._appliedEventIds.get(characterId);
		if (!events) this._appliedEventIds.set(characterId, events = new BoundedIdSet());
		let operations = this._appliedOperationIds.get(characterId);
		if (!operations) this._appliedOperationIds.set(characterId, operations = new BoundedIdSet());
		return {events, operations};
	}

	_getAcceptedCoverage (characterId) {
		const accepted = this._accepted.get(characterId);
		if (!accepted) return createCoverage();
		return createCoverage({
			revision: Number.isInteger(accepted.revision) ? accepted.revision : null,
			acceptedSequence: this._realtimeCursors.get(characterId)?.operationWatermark ?? null,
			appliedOperationIds: this._getCoverageBook(characterId).acceptedOperationIds,
		});
	}

	/**
	 * Record the authoritative cursor for a character. `operationWatermark` is the campaign sequence of the
	 * latest applied operation already reflected in canonical truth, and is the `afterSequence` used when
	 * ordered history has to be replayed to close a coverage gap.
	 */
	recordRealtimeCursor ({characterId, lastSequence = null, revision = null, projectionRevision = null, operationWatermark = null}) {
		if (typeof characterId !== "string" || !characterId) return false;
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		this._realtimeCursors.set(canonicalId, {lastSequence, revision, projectionRevision, operationWatermark});
		return true;
	}

	isSaveBlocked (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		return this._saveBlocks.has(canonicalId);
	}

	getSaveBlock (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const block = this._saveBlocks.get(canonicalId);
		return block ? structuredClone(block) : null;
	}

	_setSaveBlock (characterId, block) {
		this._saveBlocks.set(characterId, block);
	}

	_clearSaveBlock (characterId) {
		this._saveBlocks.delete(characterId);
	}

	/**
	 * Forget every reconciliation-scoped structure for a character. Called on teardown paths (switch, detach,
	 * archive, access loss) so pending envelopes and coverage cannot outlive the subscription that produced them.
	 */
	clearRealtimeReconciliation ({characterId} = {}) {
		if (characterId == null) {
			this._coverage.clear();
			this._appliedEventIds.clear();
			this._appliedOperationIds.clear();
			this._pendingResync.clear();
			this._resyncInFlight.clear();
			this._realtimeCursors.clear();
			this._saveBlocks.clear();
			this._liveConflicts.clear();
			return true;
		}
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		for (const map of [this._coverage, this._appliedEventIds, this._appliedOperationIds, this._pendingResync, this._realtimeCursors, this._saveBlocks, this._liveConflicts]) {
			map.delete(canonicalId);
		}
		this._resyncInFlight.delete(canonicalId);
		return true;
	}

	_getConflictCoverage (recovery, key) {
		const coverage = recovery?.coverage?.[key];
		return coverage ? deserializeCoverage(serializeCoverage(coverage)) : createCoverage();
	}

	_buildReconciliationTracks ({canonicalId, liveData}) {
		const book = this._getCoverageBook(canonicalId);
		const tracks = {};
		const accepted = this._accepted.get(canonicalId);
		if (accepted) tracks.accepted = {data: accepted.data, coverage: this._getAcceptedCoverage(canonicalId)};
		if (liveData !== undefined) tracks.live = {data: liveData, coverage: book.live};
		if (this._latestSubmitted.has(canonicalId)) tracks.latestSubmitted = {data: this._latestSubmitted.get(canonicalId), coverage: book.latestSubmitted};
		if (this._recoveredBases.has(canonicalId)) tracks.recoveredBase = {data: this._recoveredBases.get(canonicalId), coverage: book.recoveredBase};
		if (this._failedWrites.has(canonicalId)) tracks.failedWrite = {data: this._failedWrites.get(canonicalId), coverage: book.failedWrite};
		const conflict = this._conflicts.get(canonicalId);
		if (conflict) {
			tracks.conflictBase = {data: conflict.base, coverage: this._getConflictCoverage(conflict, "base")};
			tracks.conflictLocal = {data: conflict.local, coverage: this._getConflictCoverage(conflict, "local")};
			tracks.conflictServer = {data: conflict.server, coverage: this._getConflictCoverage(conflict, "server")};
		}
		const liveConflict = this._liveConflicts.get(canonicalId);
		if (liveConflict) {
			tracks.liveConflictBase = {data: liveConflict.base, coverage: this._getConflictCoverage(liveConflict, "base")};
			tracks.liveConflictLocal = {data: liveConflict.local, coverage: this._getConflictCoverage(liveConflict, "local")};
			tracks.liveConflictServer = {data: liveConflict.server, coverage: this._getConflictCoverage(liveConflict, "server")};
		}
		return tracks;
	}

	/**
	 * Apply one server-authoritative semantic operation across every document track, in three phases.
	 *
	 * PREPARE computes and validates everything without mutating. ADOPT LIVE hands the live document to the
	 * caller; if adoption throws, the caller restores its own state and this method mutates nothing. Only then
	 * does COMMIT publish the staged tracks, and applied ids are marked last so a failed transition never
	 * suppresses a later retry.
	 *
	 * Intended to be invoked synchronously from inside a realtime delivery so it is serialized against saves.
	 */
	applyRealtimeOperation ({characterId, operation, resultingCharacterRevision, eventId = null, sequence = null, liveData, fnAdoptLive = null}) {
		if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId is required.`);
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const {events: appliedEventIds, operations: appliedOperationIds} = this._getAppliedIds(canonicalId);

		const plan = planAppliedOperation({
			tracks: this._buildReconciliationTracks({canonicalId, liveData}),
			operation,
			resultingCharacterRevision,
			eventId,
			appliedEventIds,
			appliedOperationIds,
		});

		if (plan.status === RECONCILE_STATUS.RESYNC_REQUIRED) {
			this._queuePendingResync({
				canonicalId,
				envelope: {eventId, sequence, operation, resultingCharacterRevision},
			});
			return {status: plan.status, decisions: plan.decisions};
		}
		if (plan.status === RECONCILE_STATUS.REJECTED || plan.status === RECONCILE_STATUS.BLOCKED) {
			this._setSaveBlock(canonicalId, {
				reason: plan.status,
				code: plan.error?.code || "OPERATION_INVALID",
				message: plan.error?.message || `The effect could not be applied.`,
			});
			return {status: plan.status, error: plan.error, decisions: plan.decisions};
		}
		if (plan.status === RECONCILE_STATUS.SUPPRESSED) {
			this._commitAppliedIds({canonicalId, eventId, operationId: plan.operation?.operationId});
			return {status: plan.status, decisions: plan.decisions};
		}

		// ADOPT LIVE — the only externally visible step inside the transaction.
		if (Object.hasOwn(plan.staged, "live") && typeof fnAdoptLive === "function") {
			try {
				fnAdoptLive(structuredClone(plan.staged.live));
			} catch (error) {
				return {status: RECONCILE_STATUS.BLOCKED, error: {code: "LIVE_ADOPTION_FAILED", message: error?.message || `Live state could not be updated.`}, decisions: plan.decisions};
			}
		}

		this._commitReconciliation({canonicalId, plan, eventId, sequence});
		return {
			status: RECONCILE_STATUS.APPLIED,
			decisions: plan.decisions,
			liveNext: Object.hasOwn(plan.staged, "live") ? structuredClone(plan.staged.live) : undefined,
			acceptedNext: Object.hasOwn(plan.staged, "accepted") ? structuredClone(plan.staged.accepted) : undefined,
			revisionNext: plan.revisionNext,
		};
	}

	_commitReconciliation ({canonicalId, plan, eventId, sequence}) {
		const book = this._getCoverageBook(canonicalId);
		const operationId = plan.operation?.operationId || null;
		const revision = plan.revisionNext;
		const staged = plan.staged;

		if (Object.hasOwn(staged, "accepted")) {
			const accepted = this._accepted.get(canonicalId);
			this._accepted.set(canonicalId, {...accepted, data: staged.accepted, revision});
			book.acceptedOperationIds.add(operationId);
		}
		const advance = (coverage, hasStaged) => {
			if (!hasStaged && !Number.isInteger(coverage.revision)) return;
			coverage.revision = Math.max(Number.isInteger(coverage.revision) ? coverage.revision : 0, revision);
			coverage.appliedOperationIds.add(operationId);
		};
		if (Object.hasOwn(staged, "live")) advance(book.live, true);
		if (Object.hasOwn(staged, "latestSubmitted")) {
			this._latestSubmitted.set(canonicalId, staged.latestSubmitted);
			advance(book.latestSubmitted, true);
		}
		if (Object.hasOwn(staged, "recoveredBase")) {
			this._recoveredBases.set(canonicalId, staged.recoveredBase);
			advance(book.recoveredBase, true);
		}
		if (Object.hasOwn(staged, "failedWrite")) {
			this._failedWrites.set(canonicalId, {...staged.failedWrite, id: canonicalId});
			advance(book.failedWrite, true);
		}

		this._commitConflictReconciliation({canonicalId, plan, revision, operationId});
		this._writeRecoveryCoverage(canonicalId);
		if (Number.isInteger(sequence)) {
			const cursor = this._realtimeCursors.get(canonicalId) || {};
			this._realtimeCursors.set(canonicalId, {...cursor, operationWatermark: Math.max(cursor.operationWatermark || 0, sequence)});
		}
		this._commitAppliedIds({canonicalId, eventId, operationId});
	}

	/**
	 * Conflict candidates are transformed individually, never uniformly: the revision-conflict and lease paths
	 * already refetch canonical truth containing the operation, so re-applying it there would double-count. Once
	 * the surviving candidates agree, the overlap is recomputed — an overlap that existed only because of the
	 * operation disappears, while genuinely conflicting owner edits remain.
	 */
	_commitConflictReconciliation ({canonicalId, plan, revision, operationId}) {
		this._commitOneConflictRecord({store: this._conflicts, prefix: "conflict", canonicalId, plan, revision, operationId, isClearOnResolve: true});
		this._commitOneConflictRecord({store: this._liveConflicts, prefix: "liveConflict", canonicalId, plan, revision, operationId, isClearOnResolve: false});
	}

	_commitOneConflictRecord ({store, prefix, canonicalId, plan, revision, operationId, isClearOnResolve}) {
		const conflict = store.get(canonicalId);
		if (!conflict) return;
		const staged = plan.staged;
		const next = {...conflict};
		next.coverage ||= {};
		for (const key of ["base", "local", "server"]) {
			const trackName = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
			const coverage = this._getConflictCoverage(conflict, key);
			if (Object.hasOwn(staged, trackName)) {
				next[key] = staged[trackName];
				coverage.revision = Math.max(Number.isInteger(coverage.revision) ? coverage.revision : 0, revision);
			}
			coverage.appliedOperationIds.add(operationId);
			next.coverage[key] = serializeCoverage(coverage);
		}
		const serverTrack = `${prefix}Server`;
		if (Object.hasOwn(staged, serverTrack) && next.serverDocument) {
			next.serverDocument = {...next.serverDocument, data: staged[serverTrack], revision};
		}

		const rebased = rebaseJsonChanges({base: next.base, local: next.local, remote: next.server});
		if (!rebased.isConflict && isClearOnResolve) {
			store.delete(canonicalId);
			return;
		}
		next.conflicts = rebased.conflicts;
		next.isResolved = !rebased.isConflict;
		store.set(canonicalId, next);
	}

	_commitAppliedIds ({canonicalId, eventId, operationId}) {
		const {events, operations} = this._getAppliedIds(canonicalId);
		if (eventId) events.add(eventId);
		if (operationId) operations.add(operationId);
	}

	_queuePendingResync ({canonicalId, envelope}) {
		const pending = this._pendingResync.get(canonicalId) || [];
		if (envelope.eventId && pending.some(it => it.eventId === envelope.eventId)) return;
		if (pending.length >= _PENDING_RESYNC_LIMIT) {
			this._setSaveBlock(canonicalId, {
				reason: "resync_unavailable",
				code: "OPERATION_HISTORY_UNAVAILABLE",
				message: `Too many unreconciled effects. Reload this character to continue saving.`,
			});
			return;
		}
		pending.push(envelope);
		this._pendingResync.set(canonicalId, pending);
		this._setSaveBlock(canonicalId, {
			reason: "resync_required",
			code: "OPERATION_RESYNC_REQUIRED",
			message: `Catching up with campaign effects…`,
		});
	}

	hasPendingResync (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		return (this._pendingResync.get(canonicalId)?.length || 0) > 0;
	}

	_writeRecoveryCoverage (canonicalId) {
		// Best effort: in-memory coverage stays authoritative for this tab. A failed or partial write only
		// degrades the next reload to unknown coverage, which forces a resync rather than a silent double-apply.
		const key = `hub-character-recovery:${this._scopeKey}:${canonicalId}`;
		try {
			const raw = this._recoveryStorage?.getItem(key);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (!parsed?.snapshot) return;
			const book = this._getCoverageBook(canonicalId);
			const failedWrite = this._failedWrites.get(canonicalId);
			// Persisted coverage may only claim a revision for data this write can advance in the same step.
			// The stored snapshot otherwise belongs to a save still in flight, whose document this repository
			// does not own; advancing its coverage alone would let a reload trust pre-operation data as though
			// the effect were already folded in, and then apply the next effect on top of it.
			if (!failedWrite) {
				delete parsed.coverageVersion;
				delete parsed.coverage;
				this._recoveryStorage?.setItem(key, JSON.stringify(parsed));
				return;
			}
			parsed.snapshot = this._getSnapshotData({...structuredClone(failedWrite), id: canonicalId});
			const recoveredBase = this._recoveredBases.get(canonicalId);
			const coverage = {snapshot: serializeCoverage(book.failedWrite)};
			if (recoveredBase) {
				parsed.base = structuredClone(recoveredBase);
				coverage.base = serializeCoverage(book.recoveredBase);
			} else {
				// The stored rebase base belongs to the submit that failed and no longer receives operations, so
				// it is now behind the snapshot. It is a rebase reference rather than user data: dropping it lets
				// the next save fall back to accepted truth, instead of stranding the character in a resync that
				// only exists to repair a document nothing reads.
				delete parsed.base;
				delete coverage.base;
			}
			parsed.coverageVersion = COVERAGE_VERSION;
			parsed.coverage = coverage;
			this._recoveryStorage?.setItem(key, JSON.stringify(parsed));
		} catch {
			// Recovery-storage coverage is best-effort; see above.
		}
	}

	async _pListOperationHistory ({afterSequence}) {
		const operations = [];
		let cursor = Math.max(0, afterSequence || 0);
		for (let page = 0; page < _RESYNC_MAX_PAGES; ++page) {
			const result = await this._api.pListEventPage({campaignId: this._campaignId, afterSequence: cursor, limit: _RESYNC_PAGE_LIMIT});
			for (const event of result?.events || []) {
				if (event?.type !== "character.operation.applied") continue;
				const routing = getCharacterOperationRouting(event);
				if (!routing) continue;
				operations.push({
					eventId: event.id,
					sequence: event.sequence,
					operation: routing.payload.operation,
					resultingCharacterRevision: routing.payload.resultingCharacterRevision,
					targetCharacterId: routing.targetCharacterId,
				});
			}
			// The scanned marker is authoritative: a page can be short or empty while later visible events exist,
			// so exhaustion must never be inferred from `events.length`.
			const scanned = Number.isInteger(result?.replay?.scannedThroughSequence)
				? result.replay.scannedThroughSequence
				: Number.isInteger(result?.scannedThroughSequence) ? result.scannedThroughSequence : null;
			const hasMore = result?.replay?.hasMore ?? result?.hasMore ?? false;
			if (!hasMore) return {operations, isComplete: true};
			if (!Number.isInteger(scanned) || scanned <= cursor) return {operations, isComplete: false};
			cursor = scanned;
		}
		return {operations, isComplete: false};
	}

	/**
	 * Bring every track forward without a reload when delivery-time evidence was incomplete.
	 *
	 * Scheduled from a microtask *outside* the delivery that produced the gap, so entering the mutation queue
	 * here chains behind that delivery instead of awaiting a task from within itself, which would deadlock.
	 */
	async pRunPendingResync ({characterId, fnGetLiveData = null, fnAdoptLive = null, fnIsCurrent = () => true}) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		if (!this._pendingResync.get(canonicalId)?.length) return {status: "idle"};
		if (this._resyncInFlight.has(canonicalId)) return {status: "in_flight"};
		this._resyncInFlight.add(canonicalId);
		try {
			return await this._pRunMutation(async () => {
				if (!fnIsCurrent()) return {status: "fenced"};
				const pending = this._pendingResync.get(canonicalId) || [];
				if (!pending.length) return {status: "idle"};

				let canonical;
				let history;
				try {
					await this._pEnsureSession();
					canonical = await this._api.pGetCharacter({characterId: canonicalId});
					this._assertCharacterScope(canonical);
					history = await this._pListOperationHistory({afterSequence: this._getResyncFloorSequence(canonicalId)});
				} catch (error) {
					this._setSaveBlock(canonicalId, {
						reason: "resync_failed",
						code: error?.code || "OPERATION_RESYNC_FAILED",
						message: `Could not catch up with campaign effects. Retry, or reload this character.`,
					});
					return {status: "failed", error: {code: error?.code || "OPERATION_RESYNC_FAILED", message: error?.message}};
				}
				if (!fnIsCurrent()) return {status: "fenced"};

				const known = new Map();
				for (const entry of history.operations) {
					if (entry.targetCharacterId === canonicalId) known.set(entry.operation.operationId, entry);
				}
				for (const envelope of pending) {
					const operationId = envelope.operation?.operationId;
					if (operationId && !known.has(operationId)) known.set(operationId, envelope);
				}
				const ordered = [...known.values()].sort((a, b) => a.resultingCharacterRevision - b.resultingCharacterRevision);

				if (!history.isComplete && ordered.length < pending.length) {
					this._setSaveBlock(canonicalId, {
						reason: "resync_unavailable",
						code: "OPERATION_HISTORY_UNAVAILABLE",
						message: `Campaign effect history is no longer available. Reload this character, or export your local copy.`,
					});
					return {status: "history_unavailable"};
				}

				// Canonical truth is exact, so adopt it directly; dirty tracks only need the operations they are
				// missing, replayed in aggregate-revision order.
				this._accepted.set(canonicalId, canonical);
				const book = this._getCoverageBook(canonicalId);
				book.acceptedOperationIds = new BoundedIdSet();

				let liveData = fnGetLiveData ? fnGetLiveData() : undefined;
				let isLiveChanged = false;
				for (const entry of ordered) {
					const result = this.applyRealtimeOperation({
						characterId: canonicalId,
						operation: entry.operation,
						resultingCharacterRevision: entry.resultingCharacterRevision,
						eventId: entry.eventId,
						sequence: entry.sequence,
						liveData,
						fnAdoptLive: null,
					});
					if (result.status === RECONCILE_STATUS.APPLIED && result.liveNext !== undefined) {
						liveData = result.liveNext;
						isLiveChanged = true;
					}
					if (result.status === RECONCILE_STATUS.RESYNC_REQUIRED) {
						this._setSaveBlock(canonicalId, {
							reason: "resync_unavailable",
							code: "OPERATION_HISTORY_UNAVAILABLE",
							message: `Campaign effect history is no longer available. Reload this character, or export your local copy.`,
						});
						return {status: "history_unavailable"};
					}
				}

				if (isLiveChanged && typeof fnAdoptLive === "function") {
					try {
						fnAdoptLive(structuredClone(liveData));
					} catch (error) {
						return {status: "failed", error: {code: "LIVE_ADOPTION_FAILED", message: error?.message}};
					}
				}

				this._pendingResync.delete(canonicalId);
				this._clearSaveBlock(canonicalId);
				return {status: "recovered", appliedCount: ordered.length, liveNext: isLiveChanged ? structuredClone(liveData) : undefined};
			});
		} finally {
			this._resyncInFlight.delete(canonicalId);
		}
	}

	_getResyncFloorSequence (canonicalId) {
		const book = this._getCoverageBook(canonicalId);
		const sequences = [book.live, book.latestSubmitted, book.recoveredBase, book.failedWrite]
			.map(coverage => coverage?.acceptedSequence)
			.filter(Number.isInteger);
		return sequences.length ? Math.max(0, Math.min(...sequences)) : 0;
	}

	/**
	 * After a save settles, the live document has been merged with canonical truth, so every local track
	 * collapses onto the accepted revision.
	 */
	_syncCoverageToAccepted (canonicalId) {
		const accepted = this._accepted.get(canonicalId);
		if (!accepted || !Number.isInteger(accepted.revision)) return;
		const book = this._getCoverageBook(canonicalId);
		const acceptedSequence = this._realtimeCursors.get(canonicalId)?.operationWatermark ?? null;
		book.live = createCoverage({revision: accepted.revision, acceptedSequence, appliedOperationIds: book.live.appliedOperationIds});
		book.latestSubmitted = createCoverage({revision: accepted.revision, acceptedSequence, appliedOperationIds: book.latestSubmitted.appliedOperationIds});
	}

	/**
	 * `CHARACTER_LIVE_CONFLICT` is raised by the Character Sheet rather than stored here, so its captured recovery
	 * would go stale if an operation arrived while the modal was open. Registering it gives the candidates the
	 * same per-track classification and transform as an ordinary overlap conflict.
	 */
	registerLiveConflict ({characterId, recovery}) {
		if (typeof characterId !== "string" || !characterId || !recovery) return false;
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const accepted = this._accepted.get(canonicalId);
		const book = this._getCoverageBook(canonicalId);
		this._liveConflicts.set(canonicalId, {
			base: structuredClone(recovery.base ?? recovery.server),
			local: structuredClone(recovery.local),
			server: structuredClone(recovery.server),
			serverDocument: accepted ? structuredClone(accepted) : null,
			conflicts: structuredClone(recovery.conflicts || []),
			coverage: {
				base: serializeCoverage(book.latestSubmitted),
				local: serializeCoverage(book.live),
				server: serializeCoverage(this._getAcceptedCoverage(canonicalId)),
			},
		});
		return true;
	}

	getLiveConflictRecovery (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const recovery = this._liveConflicts.get(canonicalId);
		return recovery ? structuredClone(recovery) : null;
	}

	clearLiveConflict ({characterId}) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		return this._liveConflicts.delete(canonicalId);
	}

	// #endregion

	_migrateCharacterIdentity ({fromId, toId}) {
		if (fromId === toId) return;
		this._canonicalIds.set(fromId, toId);
		for (const map of [this._failedWrites, this._failedCommands, this._latestSubmitted, this._recoveredBases]) {
			if (!map.has(fromId)) continue;
			map.set(toId, map.get(fromId));
			map.delete(fromId);
		}
		for (const map of [this._coverage, this._appliedEventIds, this._appliedOperationIds, this._pendingResync, this._realtimeCursors, this._saveBlocks, this._liveConflicts]) {
			if (!map.has(fromId)) continue;
			map.set(toId, map.get(fromId));
			map.delete(fromId);
		}
		if (this._resyncInFlight.delete(fromId)) this._resyncInFlight.add(toId);
		const oldKey = `hub-character-recovery:${this._scopeKey}:${fromId}`;
		const newKey = `hub-character-recovery:${this._scopeKey}:${toId}`;
		if (this._recoveryVersions.has(oldKey)) {
			this._recoveryVersions.set(newKey, this._recoveryVersions.get(oldKey));
			this._recoveryVersions.delete(oldKey);
		}
		try {
			const recovery = this._recoveryStorage?.getItem(oldKey);
			if (recovery) this._recoveryStorage?.setItem(newKey, recovery);
			this._recoveryStorage?.removeItem(oldKey);
		} catch {
			// Recovery-storage identity migration is best-effort.
		}
	}

	pUpsert ({character}) {
		let recoveryKey = `hub-character-recovery:${this._scopeKey}:${character.id}`;
		const recoveryVersion = (this._recoveryVersions.get(recoveryKey) || 0) + 1;
		this._recoveryVersions.set(recoveryKey, recoveryVersion);
		const requestedId = character.id;
		const canonicalAtCall = this._canonicalIds.get(requestedId) || requestedId;
		const submittedSnapshot = this._getSnapshotData(character);
		const failedCommand = this._failedCommands.get(requestedId);
		const isSameFailedSnapshot = failedCommand
			&& JSON.stringify(failedCommand.snapshot) === JSON.stringify(submittedSnapshot);
		const commandKeys = isSameFailedSnapshot
			? failedCommand.commandKeys
			: {create: crypto.randomUUID(), patch: crypto.randomUUID()};
		const submittedBase = structuredClone(
			this._recoveredBases.get(requestedId)
			|| (this._pendingWrites > 0 ? this._latestSubmitted.get(requestedId) : null)
			|| this._accepted.get(canonicalAtCall)?.data
			|| this._latestSubmitted.get(requestedId)
			|| null,
		);
		const bookAtCall = this._getCoverageBook(canonicalAtCall);
		// Mirror the precedence used for `submittedBase` so the base's coverage travels with it.
		const submittedBaseCoverage = this._cloneTrackCoverage(
			this._recoveredBases.get(requestedId) ? bookAtCall.recoveredBase
				: (this._pendingWrites > 0 && this._latestSubmitted.get(requestedId)) ? bookAtCall.latestSubmitted
					: this._accepted.get(canonicalAtCall)?.data ? this._getAcceptedCoverage(canonicalAtCall)
						: bookAtCall.latestSubmitted,
		);
		const submittedSnapshotCoverage = this._cloneTrackCoverage(bookAtCall.live);
		this._recoveredBases.delete(requestedId);
		bookAtCall.recoveredBase = createCoverage();
		this._latestSubmitted.set(requestedId, structuredClone(submittedSnapshot));
		bookAtCall.latestSubmitted = this._cloneTrackCoverage(submittedSnapshotCoverage);
		this._pendingWrites++;
		try {
			this._recoveryStorage?.setItem(recoveryKey, JSON.stringify({
				version: recoveryVersion,
				base: submittedBase,
				snapshot: submittedSnapshot,
				commandKeys,
				coverageVersion: COVERAGE_VERSION,
				coverage: {
					base: serializeCoverage(submittedBaseCoverage),
					snapshot: serializeCoverage(submittedSnapshotCoverage),
				},
			}));
		} catch {
			// Recovery storage is best-effort; the in-memory conflict guard remains authoritative.
		}
		const pResult = this._pRunMutation(async () => {
			const canonicalId = this._canonicalIds.get(requestedId) || requestedId;
			if (canonicalId !== requestedId) {
				this._migrateCharacterIdentity({fromId: requestedId, toId: canonicalId});
				recoveryKey = `hub-character-recovery:${this._scopeKey}:${canonicalId}`;
			}
			const characterNxt = {...structuredClone(submittedSnapshot), id: canonicalId};
			const existingConflict = this._conflicts.get(canonicalId);
			if (existingConflict) {
				existingConflict.local = this._getSnapshotData(characterNxt);
				const conflict = new Error(`Character conflict requires explicit resolution.`);
				conflict.code = "CHARACTER_CONFLICT";
				conflict.recovery = structuredClone(existingConflict);
				throw conflict;
			}
			await this._pEnsureSession();
			let accepted = this._accepted.get(canonicalId);
			if (!accepted) {
				try {
					await this.pGet({characterId: canonicalId});
					accepted = this._accepted.get(canonicalId);
				} catch (error) {
					if (error?.code !== "CHARACTER_NOT_FOUND") throw error;
					const created = await this._api.pCreateCharacter({
						clientImportId: requestedId,
						campaignId: this._campaignId,
						data: this._getSnapshotData(characterNxt),
						idempotencyKey: commandKeys.create,
					});
					this._canonicalIds.set(requestedId, created.character.id);
					this._migrateCharacterIdentity({fromId: requestedId, toId: created.character.id});
					recoveryKey = `hub-character-recovery:${this._scopeKey}:${created.character.id}`;
					this._accepted.set(created.character.id, created.character);
					accepted = created.character;
				}
			}
			let desired = this._getSnapshotData(characterNxt);
			if (submittedBase) {
				const submittedRebase = rebaseJsonChanges({
					base: submittedBase,
					local: desired,
					remote: accepted.data,
				});
				if (submittedRebase.isConflict) {
					const recovery = {
						base: submittedBase,
						local: desired,
						server: structuredClone(accepted.data),
						serverDocument: structuredClone(accepted),
						conflicts: submittedRebase.conflicts,
						coverage: {
							base: serializeCoverage(submittedBaseCoverage),
							local: serializeCoverage(submittedSnapshotCoverage),
							server: serializeCoverage(this._getAcceptedCoverage(canonicalId)),
						},
					};
					this._conflicts.set(canonicalId, recovery);
					const conflict = new Error(`Character changed remotely on overlapping fields.`);
					conflict.code = "CHARACTER_CONFLICT";
					conflict.recovery = structuredClone(recovery);
					throw conflict;
				}
				desired = submittedRebase.document;
			}
			const patches = diffJson(accepted.data, desired);
			if (!patches.length) {
				this._syncCoverageToAccepted(canonicalId);
				return this._getData(accepted);
			}
			let result;
			try {
				const lease = await this.pAcquireLease({characterId: canonicalId});
				result = await this._api.pPatchCharacter({
					characterId: canonicalId,
					baseRevision: accepted.revision,
					leaseEpoch: lease.epoch,
					patches,
					idempotencyKey: commandKeys.patch,
				});
			} catch (error) {
				if (["LEASE_HELD", "LEASE_FENCED", "LEASE_EXPIRED"].includes(error?.code)) {
					const canonical = await this._api.pGetCharacter({characterId: canonicalId});
					const recovery = {
						base: structuredClone(accepted.data),
						local: desired,
						server: structuredClone(canonical.data),
						serverDocument: structuredClone(canonical),
						conflicts: [{localPath: "", remotePath: "", reason: error.code}],
						coverage: {
							base: serializeCoverage(this._getAcceptedCoverage(canonicalId)),
							local: serializeCoverage(submittedSnapshotCoverage),
							// Freshly fetched canonical truth already contains any operation up to its revision,
							// so this candidate must never be transformed again.
							server: serializeCoverage(createCoverage({revision: canonical.revision})),
						},
					};
					this._conflicts.set(canonicalId, recovery);
					const conflict = new Error(`Character is being edited on another device.`);
					conflict.code = "CHARACTER_CONFLICT";
					conflict.recovery = structuredClone(recovery);
					throw conflict;
				}
				if (error?.code !== "REVISION_CONFLICT") throw error;
				const canonical = await this._api.pGetCharacter({characterId: canonicalId});
				const rebased = rebaseJsonChanges({
					base: accepted.data,
					local: desired,
					remote: canonical.data,
				});
				if (rebased.isConflict) {
					const recovery = {
						base: structuredClone(accepted.data),
						local: desired,
						server: structuredClone(canonical.data),
						serverDocument: structuredClone(canonical),
						conflicts: rebased.conflicts,
						coverage: {
							base: serializeCoverage(this._getAcceptedCoverage(canonicalId)),
							local: serializeCoverage(submittedSnapshotCoverage),
							// The revision-conflict refetch already reflects the intervening operation.
							server: serializeCoverage(createCoverage({revision: canonical.revision})),
						},
					};
					this._conflicts.set(canonicalId, recovery);
					const conflict = new Error(`Character changed remotely on overlapping fields.`);
					conflict.name = "HubCharacterConflictError";
					conflict.code = "CHARACTER_CONFLICT";
					conflict.recovery = structuredClone(recovery);
					throw conflict;
				}
				this._accepted.set(canonicalId, canonical);
				const leaseNxt = await this.pAcquireLease({characterId: canonicalId});
				result = await this._api.pPatchCharacter({
					characterId: canonicalId,
					baseRevision: canonical.revision,
					leaseEpoch: leaseNxt.epoch,
					patches: diffJson(canonical.data, rebased.document),
					idempotencyKey: commandKeys.patch,
				});
			}
			this._accepted.set(canonicalId, result.character);
			this._syncCoverageToAccepted(canonicalId);
			return this._getData(result.character);
		});
		return pResult
			.then(out => {
				this._failedWrites.delete(requestedId);
				this._failedCommands.delete(requestedId);
				if (this._recoveryVersions.get(recoveryKey) === recoveryVersion) {
					this._recoveryVersions.delete(recoveryKey);
					try {
						this._recoveryStorage?.removeItem(recoveryKey);
					} catch {
						// Recovery storage cleanup is best-effort.
					}
				}
				return out;
			})
			.catch(error => {
				this._failedWrites.set(requestedId, structuredClone(character));
				this._failedCommands.set(requestedId, {snapshot: submittedSnapshot, commandKeys});
				// Keep the in-memory coverage of the recovered snapshot in step with the copy written to recovery
				// storage above. Without this the failed write would carry unknown coverage, and the next campaign
				// effect would classify it as unprovable and cascade into a resync the history can never satisfy.
				bookAtCall.failedWrite = this._cloneTrackCoverage(submittedSnapshotCoverage);
				throw error;
			})
			.finally(() => this._pendingWrites--);
	}

	hasPendingWrites () {
		return this._pendingWrites > 0 || this._conflicts.size > 0 || this._failedWrites.size > 0;
	}

	getPendingRecovery (characterId) {
		try {
			const raw = this._recoveryStorage?.getItem(`hub-character-recovery:${this._scopeKey}:${characterId}`);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (parsed.snapshot) {
				const canonicalId = this._canonicalIds.get(characterId) || characterId;
				const book = this._getCoverageBook(canonicalId);
				// A blob written before coverage metadata existed cannot prove which operations it already
				// reflects. It is still honoured as a draft, but its unknown coverage forces a resync rather than
				// a guess in either direction.
				const isCoverageKnown = parsed.coverageVersion === COVERAGE_VERSION && !!parsed.coverage;
				book.recoveredBase = isCoverageKnown ? deserializeCoverage(parsed.coverage.base) : createCoverage();
				book.failedWrite = isCoverageKnown ? deserializeCoverage(parsed.coverage.snapshot) : createCoverage();
				if (parsed.base) this._recoveredBases.set(characterId, parsed.base);
				if (parsed.commandKeys) this._failedCommands.set(characterId, {snapshot: parsed.snapshot, commandKeys: parsed.commandKeys});
				return parsed.snapshot;
			}
			return parsed.character || parsed;
		} catch {
			return null;
		}
	}

	getConflictRecovery (characterId) {
		const recovery = this._conflicts.get(characterId);
		return recovery ? structuredClone(recovery) : null;
	}

	clearRetryableLeaseConflict ({characterId}) {
		const recovery = this._conflicts.get(characterId);
		const reasons = recovery?.conflicts?.map(conflict => conflict?.reason).filter(Boolean) || [];
		if (!reasons.length || reasons.some(reason => !["LEASE_HELD", "LEASE_FENCED", "LEASE_EXPIRED"].includes(reason))) return false;
		this._conflicts.delete(characterId);
		return true;
	}

	async pResolveConflict ({characterId, choice}) {
		const recovery = this._conflicts.get(characterId);
		if (!recovery) return null;
		if (choice === "server") {
			this._conflicts.delete(characterId);
			this._accepted.set(characterId, recovery.serverDocument);
			this._failedWrites.delete(characterId);
			this._failedCommands.delete(characterId);
			const recoveryKey = `hub-character-recovery:${this._scopeKey}:${characterId}`;
			this._recoveryVersions.delete(recoveryKey);
			try {
				this._recoveryStorage?.removeItem(recoveryKey);
			} catch {
				// Recovery storage cleanup is best-effort.
			}
			return this._getData(recovery.serverDocument);
		}
		if (choice !== "local") throw new TypeError(`Conflict choice must be "local" or "server".`);
		this._conflicts.delete(characterId);
		this._accepted.set(characterId, recovery.serverDocument);
		await this.pAcquireLease({characterId, isTakeover: true});
		return this.pUpsert({character: {...structuredClone(recovery.local), id: characterId}});
	}

	async pDelete ({characterId}) {
		await this._pEnsureSession();
		await this._api.pArchiveCharacter({characterId, idempotencyKey: crypto.randomUUID()});
		this._accepted.delete(characterId);
		this._leases.delete(characterId);
		return true;
	}

	async pReleaseLease ({characterId}) {
		await this._pEnsureSession();
		const result = await this._api.pReleaseCharacterLease({characterId});
		this._leases.delete(characterId);
		return result;
	}

	async pDeleteMany ({characterIds}) {
		let count = 0;
		for (const characterId of characterIds) {
			if (await this.pDelete({characterId})) count++;
		}
		return count;
	}
}
