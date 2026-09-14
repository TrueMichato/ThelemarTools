import {HubApiClient} from "./hub-api-client.js";
import {applyJsonPatch, diffJson, rebaseJsonChanges} from "./hub-json-patch.js";
import {withRootCarryWrite} from "./hub-carry-authority.js";
import {HubBroadcastSync} from "./hub-broadcast-sync.js";
import {CHARACTER_OPERATION_LEGS, getCharacterOperationRouting, getOperationLegKey} from "./hub-character-operation-events.js";
import {
	BoundedIdSet,
	COVERAGE_VERSION,
	RECONCILE_STATUS,
	TRACK_DECISION,
	createCoverage,
	deserializeCoverage,
	markCoverageOperationLeg,
	planOperationLeg,
	serializeCoverage,
} from "./hub-character-operation-reconciler.js";

const _PENDING_RESYNC_LIMIT = 64;
const _RESYNC_PAGE_LIMIT = 200;
const _RESYNC_MAX_PAGES = 50;
const _RECOVERY_COMMAND_QUEUE_VERSION = 2;
const _RECOVERY_COMMAND_QUEUE_LEGACY_VERSION = 1;
const _RECOVERY_COMMAND_QUEUE_LIMIT = 32;
const _RECOVERY_COMMAND_QUEUE_MAX_BYTES = 3_500_000;
const _RECOVERY_COMMAND_TRACK_PREFIX = "recoveryCommand";

export class HubHttpCharacterRepository {
	isRescueMirrorEnabled = false;

	constructor ({
		campaignId = null,
		api = new HubApiClient(),
		broadcastSync = null,
		fnGetRulesVersionId = () => null,
	}) {
		if (campaignId != null && (typeof campaignId !== "string" || !campaignId)) throw new TypeError(`campaignId must be a non-empty string or null.`);
		this._campaignId = campaignId;
		this._api = api;
		this._fnGetRulesVersionId = fnGetRulesVersionId;
		this._scopeKey = campaignId || "detached";
		this._broadcastSync = broadcastSync || (
			!campaignId || typeof BroadcastChannel === "undefined"
				? null
				: new HubBroadcastSync({campaignId})
		);
		this._session = null;
		this._pSession = null;
		this._accepted = new Map();
		this._canonicalIds = new Map();
		this._recoveryOnlyIds = new Set();
		this._leases = new Map();
		this._conflicts = new Map();
		this._pMutationQueue = Promise.resolve();
		this._pendingWrites = 0;
		this._recoveryStorage = globalThis.sessionStorage || null;
		this._recoveryVersions = new Map();
		this._failedWrites = new Map();
		this._latestSubmitted = new Map();
		this._recoveredBases = new Map();
		this._recoveryCommandQueues = new Map();
		// Operation-aware reconciliation state (ADR 0012). Coverage is per track because a freshly fetched
		// canonical document and the recovery draft returned alongside it can sit at different revisions.
		this._coverage = new Map();
		this._appliedEventIds = new Map();
		this._appliedOperationLegIds = new Map();
		this._pendingResync = new Map();
		this._resyncInFlight = new Set();
		this._realtimeCursors = new Map();
		this._saveBlocks = new Map();
		this._operationConflicts = new Map();
		// Separate from `_conflicts` on purpose: a live conflict must receive the same operation transform, but
		// must NOT gate `pUpsert` the way a stored overlap conflict does.
		this._liveConflicts = new Map();
	}

	async _pEnsureSession () {
		if (!this._session) {
			this._pSession ||= Promise.resolve(this._api.pGetSession())
				.then(session => this._session = session)
				.finally(() => this._pSession = null);
			await this._pSession;
		}
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

	_getOperationWatermark (characterId, character = null) {
		const candidates = [
			character?.operationWatermark,
			this._realtimeCursors.get(characterId)?.operationWatermark,
		].filter(Number.isInteger);
		return candidates.length ? Math.max(...candidates) : null;
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
		return this._pRunMutation(async () => {
			const characters = (await this._api.pListCharacters({campaignId: this._campaignId}))
				.filter(character => this._campaignId || character.campaignId == null);
			const out = [];
			const listedIds = new Set();
			const accountId = this._session?.account?.id || null;
			for (const character of characters) {
				this._accepted.set(character.id, character);
				listedIds.add(character.id);
				let recovery = null;
				const isOwner = !!accountId && character.ownerAccountId === accountId;
				if (isOwner && character.clientImportId && character.clientImportId !== character.id) {
					recovery = this.getPendingRecovery(character.clientImportId);
					if (recovery) this._migrateCharacterIdentity({fromId: character.clientImportId, toId: character.id});
				}
				recovery ||= isOwner ? this.getPendingRecovery(character.id) : null;
				out.push(recovery ? {...structuredClone(recovery), id: character.id} : this._getData(character));
			}

			for (const characterId of this._getOwnedRecoveryOnlyCharacterIds()) {
				if (listedIds.has(characterId) || this._canonicalIds.has(characterId)) continue;
				const recovery = this.getPendingRecovery(characterId);
				if (!recovery) continue;
				this._recoveryOnlyIds.add(characterId);
				listedIds.add(characterId);
				out.push({...structuredClone(recovery), id: characterId});
			}
			return out;
		});
	}

	async pGet ({characterId}) {
		await this._pEnsureSession();
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		if (this._recoveryOnlyIds.has(canonicalId)) {
			const recovery = this._failedWrites.get(canonicalId) || this.getPendingRecovery(canonicalId);
			if (recovery) {
				const book = this._getCoverageBook(canonicalId);
				book.live = this._cloneTrackCoverage(book.failedWrite);
				return {...structuredClone(recovery), id: canonicalId};
			}
			this._recoveryOnlyIds.delete(canonicalId);
		}
		const character = await this._api.pGetCharacter({characterId: canonicalId});
		this._assertCharacterScope(character);
		this._accepted.set(canonicalId, character);
		const book = this._getCoverageBook(canonicalId);
		book.acceptedOperationLegIds = new BoundedIdSet();
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
			acceptedSequence: this._getOperationWatermark(canonicalId, character),
		});
		return this._getData(character);
	}

	_cloneTrackCoverage (coverage) {
		return createCoverage({
			revision: coverage?.revision ?? null,
			acceptedSequence: coverage?.acceptedSequence ?? null,
			appliedOperationLegIds: coverage?.appliedOperationLegIds,
			...(!coverage?.appliedOperationLegIds ? {appliedOperationIds: coverage?.appliedOperationIds} : {}),
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

	/**
	 * Rebase an authoritative document mutation (for example, inventory escrow) into every
	 * local track. Unlike a projection invalidation, this updates accepted truth and live state
	 * together; unlike a reload, it preserves disjoint edits made while the sheet was open.
	 */
	async pReconcileAuthoritativeCharacter ({
		characterId,
		fnGetLiveData = null,
		fnAdoptLive = null,
		fnIsCurrent = () => true,
	} = {}) {
		if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId is required.`);
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		return this._pRunMutation(async () => {
			if (!fnIsCurrent()) return {status: "fenced"};
			await this._pEnsureSession();
			const canonical = await this._api.pGetCharacter({characterId: canonicalId});
			this._assertCharacterScope(canonical);
			if (!fnIsCurrent()) return {status: "fenced"};

			const accepted = this._accepted.get(canonicalId);
			if (!accepted) return {status: "unavailable"};
			if (canonical.revision < accepted.revision) return {status: "stale"};
			if (canonical.revision === accepted.revision && !diffJson(accepted.data, canonical.data).length) return {status: "unchanged"};

			this._rebaseConflictForAuthoritative({
				store: this._conflicts,
				canonicalId,
				accepted,
				canonical,
			});
			this._rebaseConflictForAuthoritative({
				store: this._liveConflicts,
				canonicalId,
				accepted,
				canonical,
			});
			const liveData = fnGetLiveData?.();
			const existingConflict = this._conflicts.get(canonicalId);
			if (existingConflict) {
				return {status: "conflict", conflicts: structuredClone(existingConflict.conflicts)};
			}

			const book = this._getCoverageBook(canonicalId);
			const staged = {};
			const conflicts = [];
			const authoritativeDiscarded = {};
			const stageRebase = (name, local) => {
				if (local === undefined) return;
				const rebased = this._rebaseAuthoritativeCandidate({base: accepted.data, local, remote: canonical.data});
				if (rebased.isConflict) conflicts.push(...rebased.conflicts.map(conflict => ({track: name, ...conflict})));
				if (rebased.isConflict) authoritativeDiscarded[name] = structuredClone(local);
				staged[name] = rebased.document;
			};
			stageRebase("live", liveData);
			if (this._latestSubmitted.has(canonicalId)) stageRebase("latestSubmitted", this._latestSubmitted.get(canonicalId));
			const recoveryQueueEntry = this._getRecoveryCommandQueueEntry(canonicalId);
			if (recoveryQueueEntry?.queue.length) {
				for (const [index, command] of recoveryQueueEntry.queue.entries()) {
					stageRebase(this._getRecoveryCommandTrackName({index, part: "base"}), command.submittedBase);
					stageRebase(this._getRecoveryCommandTrackName({index, part: "snapshot"}), command.submittedSnapshot);
				}
			} else if (this._failedWrites.has(canonicalId)) {
				stageRebase("failedWrite", this._failedWrites.get(canonicalId));
			}

			const recoveryQueueNxt = this._getRecoveryQueueFromAuthoritativeRebase({canonicalId, canonical, staged});
			let stagedRecoveryQueue = null;
			if (recoveryQueueNxt) {
				try {
					stagedRecoveryQueue = this._stageRecoveryCommandQueue({
						characterId: canonicalId,
						queue: recoveryQueueNxt,
					});
				} catch (error) {
					this._setSaveBlock(canonicalId, {
						reason: "recovery_storage_failed",
						code: error.code || "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
						message: error.message || `Cloud character recovery storage failed.`,
					});
					return {status: "failed", error: {code: error.code, message: error.message}};
				}
			}

			if (conflicts.length) {
				const latestRecoverySnapshotName = recoveryQueueEntry?.queue.length
					? this._getRecoveryCommandTrackName({index: recoveryQueueEntry.queue.length - 1, part: "snapshot"})
					: null;
				const local = staged.live
					|| liveData
					|| this._latestSubmitted.get(canonicalId)
					|| (latestRecoverySnapshotName ? staged[latestRecoverySnapshotName] : null)
					|| this._failedWrites.get(canonicalId)
					|| accepted.data;
				const recovery = {
					base: structuredClone(accepted.data),
					local: structuredClone(local),
					server: structuredClone(canonical.data),
					serverDocument: structuredClone(canonical),
					conflicts,
					coverage: {
						base: serializeCoverage(this._getAcceptedCoverage(canonicalId)),
						local: serializeCoverage(book.live),
						server: serializeCoverage(createCoverage({revision: canonical.revision, acceptedSequence: this._getOperationWatermark(canonicalId, canonical)})),
					},
					authoritativeDiscarded,
				};
				if (stagedRecoveryQueue) this._commitStagedRecoveryCommandQueue(stagedRecoveryQueue);
				this._conflicts.set(canonicalId, recovery);
				return {status: "conflict", conflicts: structuredClone(conflicts)};
			}

			if (Object.hasOwn(staged, "live") && typeof fnAdoptLive === "function") {
				try {
					fnAdoptLive(structuredClone(staged.live));
				} catch (error) {
					this._rollbackStagedRecoveryCommandQueue(stagedRecoveryQueue);
					return {status: "failed", error: {code: "LIVE_ADOPTION_FAILED", message: error?.message}};
				}
			}

			if (stagedRecoveryQueue) this._commitStagedRecoveryCommandQueue(stagedRecoveryQueue);
			this._accepted.set(canonicalId, canonical);
			const acceptedSequence = this._getOperationWatermark(canonicalId, canonical);
			book.live = createCoverage({
				revision: canonical.revision,
				acceptedSequence,
				appliedOperationLegIds: book.live.appliedOperationLegIds,
			});
			if (Object.hasOwn(staged, "latestSubmitted")) {
				this._latestSubmitted.set(canonicalId, staged.latestSubmitted);
				book.latestSubmitted = createCoverage({
					revision: canonical.revision,
					acceptedSequence,
					appliedOperationLegIds: book.latestSubmitted.appliedOperationLegIds,
				});
			}

			if (Object.hasOwn(staged, "failedWrite")) {
				this._failedWrites.set(canonicalId, {...staged.failedWrite, id: canonicalId});
				this._recoveredBases.set(canonicalId, structuredClone(canonical.data));
				book.failedWrite = createCoverage({
					revision: canonical.revision,
					acceptedSequence,
					appliedOperationLegIds: book.failedWrite.appliedOperationLegIds,
				});
				book.recoveredBase = this._cloneTrackCoverage(book.failedWrite);
			}
			if (!stagedRecoveryQueue) this._writeRecoveryCoverage(canonicalId);
			this._clearRecoveryStorageSaveBlock(canonicalId);
			return {
				status: "reconciled",
				revision: canonical.revision,
				liveNext: Object.hasOwn(staged, "live") ? structuredClone(staged.live) : undefined,
			};
		});
	}

	_rebaseAuthoritativeCandidate ({base, local, remote}) {
		const withoutDerivedCarry = document => {
			if (!document || typeof document !== "object" || Array.isArray(document)) return document;
			const out = {...document};
			delete out.carry;
			return out;
		};
		// Carry is a one-way Character Sheet projection, not editable character state. Server-side
		// inventory mutations deliberately remove it, while the live sheet may independently
		// recompute it as data finishes loading; those concurrent derived changes must not block
		// adoption of the authoritative inventory that the next serialization will summarize.
		const rebased = rebaseJsonChanges({
			base: withoutDerivedCarry(base),
			local: withoutDerivedCarry(local),
			remote: withoutDerivedCarry(remote),
		});
		if (!rebased.isConflict) return rebased;
		const conflictingPaths = new Set(rebased.conflicts.map(conflict => conflict.localPath));
		// A recovery choice may reapply disjoint local edits, but must never overwrite
		// authoritative escrow changes at an overlapping path.
		return {
			...rebased,
			document: applyJsonPatch(remote, rebased.patches.filter(patch => !conflictingPaths.has(patch.path))),
		};
	}

	_rebaseConflictForAuthoritative ({store, canonicalId, accepted, canonical}) {
		const conflict = store.get(canonicalId);
		if (!conflict) return;
		const next = {
			...conflict,
			server: structuredClone(canonical.data),
			serverDocument: structuredClone(canonical),
			coverage: {...(conflict.coverage || {})},
			authoritativeDiscarded: {...(conflict.authoritativeDiscarded || {})},
		};
		for (const key of ["base", "local"]) {
			const rebased = this._rebaseAuthoritativeCandidate({
				base: accepted.data,
				local: conflict[key],
				remote: canonical.data,
			});
			next[key] = rebased.document;
			if (rebased.isConflict) next.authoritativeDiscarded[key] = structuredClone(conflict[key]);
			const coverage = this._getConflictCoverage(conflict, key);
			coverage.revision = canonical.revision;
			next.coverage[key] = serializeCoverage(coverage);
		}
		const serverCoverage = this._getConflictCoverage(conflict, "server");
		serverCoverage.revision = canonical.revision;
		next.coverage.server = serializeCoverage(serverCoverage);
		const rebased = rebaseJsonChanges({base: next.base, local: next.local, remote: next.server});
		next.conflicts = rebased.conflicts;
		next.isResolved = !rebased.isConflict;
		store.set(canonicalId, next);
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
				acceptedOperationLegIds: new BoundedIdSet(),
			};
			this._coverage.set(characterId, book);
		}
		return book;
	}

	_getAppliedIds (characterId) {
		let events = this._appliedEventIds.get(characterId);
		if (!events) this._appliedEventIds.set(characterId, events = new BoundedIdSet());
		let operationLegs = this._appliedOperationLegIds.get(characterId);
		if (!operationLegs) this._appliedOperationLegIds.set(characterId, operationLegs = new BoundedIdSet());
		return {events, operationLegs};
	}

	_getAcceptedCoverage (characterId) {
		const accepted = this._accepted.get(characterId);
		if (!accepted) return createCoverage();
		return createCoverage({
			revision: Number.isInteger(accepted.revision) ? accepted.revision : null,
			acceptedSequence: this._getOperationWatermark(characterId, accepted),
			appliedOperationLegIds: this._getCoverageBook(characterId).acceptedOperationLegIds,
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
		const previous = this._realtimeCursors.get(canonicalId) || {};
		const maxKnown = (left, right) => {
			const values = [left, right].filter(Number.isInteger);
			return values.length ? Math.max(...values) : null;
		};
		this._realtimeCursors.set(canonicalId, {
			lastSequence: maxKnown(previous.lastSequence, lastSequence),
			revision: maxKnown(previous.revision, revision),
			projectionRevision: maxKnown(previous.projectionRevision, projectionRevision),
			operationWatermark: maxKnown(previous.operationWatermark, operationWatermark),
		});
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

	_clearRecoveryStorageSaveBlock (characterId) {
		if (this._saveBlocks.get(characterId)?.reason === "recovery_storage_failed") this._clearSaveBlock(characterId);
	}

	_recordOperationConflict ({canonicalId, plan, eventId, sequence, liveData, resultingCharacterRevision}) {
		const accepted = this._accepted.get(canonicalId);
		const serverData = plan.prepared?.accepted
			|| (plan.decisions?.accepted === TRACK_DECISION.COVERED ? accepted?.data : null);
		const isSourceConflict = plan.blockedTransform === CHARACTER_OPERATION_LEGS.SOURCE;
		const recovery = {
			kind: isSourceConflict ? "source_resource_conflict" : "operation_live_conflict",
			operationId: plan.operationId,
			operationLegKey: plan.operationLegKey,
			leg: plan.leg,
			eventId,
			sequence,
			resultingCharacterRevision,
			base: accepted ? structuredClone(accepted.data) : null,
			local: liveData === undefined ? null : structuredClone(liveData),
			server: serverData == null ? null : structuredClone(serverData),
			serverDocument: accepted && serverData != null
				? {...structuredClone(accepted), data: structuredClone(serverData), revision: resultingCharacterRevision}
				: null,
			envelope: {
				eventId,
				sequence,
				leg: plan.leg,
				operationId: plan.operationId,
				operation: plan.operation ? structuredClone(plan.operation) : null,
				sourceCost: plan.sourceCost ? structuredClone(plan.sourceCost) : null,
				resultingCharacterRevision,
			},
			error: structuredClone(plan.error),
		};
		this._operationConflicts.set(canonicalId, recovery);
		this._setSaveBlock(canonicalId, {
			reason: recovery.kind,
			code: isSourceConflict ? "SOURCE_COST_LOCAL_CONFLICT" : "OPERATION_LIVE_CONFLICT",
			message: isSourceConflict
				? `The source cost was consumed remotely, but the local draft already spent that resource. Reload canonical truth or export the local draft before resolving it.`
				: `The operation was applied remotely, but it cannot be applied safely to the local draft. Reload canonical truth or export the local draft before resolving it.`,
		});
	}

	getOperationConflictRecovery (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const recovery = this._operationConflicts.get(canonicalId);
		return recovery ? structuredClone(recovery) : null;
	}

	/**
	 * Forget every reconciliation-scoped structure for a character. Called on teardown paths (switch, detach,
	 * archive, access loss) so pending envelopes and coverage cannot outlive the subscription that produced them.
	 */
	clearRealtimeReconciliation ({characterId} = {}) {
		if (characterId == null) {
			this._coverage.clear();
			this._appliedEventIds.clear();
			this._appliedOperationLegIds.clear();
			this._pendingResync.clear();
			this._resyncInFlight.clear();
			this._realtimeCursors.clear();
			this._saveBlocks.clear();
			this._liveConflicts.clear();
			this._operationConflicts.clear();
			return true;
		}
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		for (const map of [this._coverage, this._appliedEventIds, this._appliedOperationLegIds, this._pendingResync, this._realtimeCursors, this._saveBlocks, this._liveConflicts, this._operationConflicts]) {
			map.delete(canonicalId);
		}
		this._resyncInFlight.delete(canonicalId);
		return true;
	}

	_getConflictCoverage (recovery, key) {
		const coverage = recovery?.coverage?.[key];
		return coverage ? deserializeCoverage(serializeCoverage(coverage)) : createCoverage();
	}

	_addRecoveryQueueTracks ({canonicalId, tracks}) {
		const entry = this._getRecoveryCommandQueueEntry(canonicalId);
		for (const [index, command] of (entry?.queue || []).entries()) {
			tracks[this._getRecoveryCommandTrackName({index, part: "base"})] = {
				data: command.submittedBase,
				coverage: command.submittedBaseCoverage,
			};
			tracks[this._getRecoveryCommandTrackName({index, part: "snapshot"})] = {
				data: command.submittedSnapshot,
				coverage: command.submittedSnapshotCoverage,
			};
		}
		return entry;
	}

	_getRecoveryQueueFromPlan ({canonicalId, plan, sequence}) {
		const entry = this._getRecoveryCommandQueueEntry(canonicalId);
		if (!entry?.queue.length) return null;
		const revision = plan.revisionNext;
		const operationLegKey = plan.operationLegKey;
		const getTrack = ({command, index, part}) => {
			const name = this._getRecoveryCommandTrackName({index, part});
			const hasStaged = Object.hasOwn(plan.staged, name);
			const data = hasStaged ? plan.staged[name] : command[part === "base" ? "submittedBase" : "submittedSnapshot"];
			const coverageKey = part === "base" ? "submittedBaseCoverage" : "submittedSnapshotCoverage";
			const coverage = this._cloneTrackCoverage(command[coverageKey]);
			if (hasStaged) {
				coverage.revision = Math.max(Number.isInteger(coverage.revision) ? coverage.revision : 0, revision);
				markCoverageOperationLeg(coverage, operationLegKey);
				if (Number.isInteger(sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, sequence);
			} else if (plan.decisions[name] === TRACK_DECISION.COVERED) {
				markCoverageOperationLeg(coverage, operationLegKey);
				if (Number.isInteger(sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, sequence);
			}
			return {data: structuredClone(data), coverage};
		};
		return entry.queue.map((command, index) => {
			const base = getTrack({command, index, part: "base"});
			const snapshot = getTrack({command, index, part: "snapshot"});
			return {
				...command,
				submittedBase: base.data,
				submittedBaseCoverage: base.coverage,
				submittedSnapshot: snapshot.data,
				submittedSnapshotCoverage: snapshot.coverage,
			};
		});
	}

	_getRecoveryQueueFromWorkingSet ({canonicalId, working}) {
		const entry = this._getRecoveryCommandQueueEntry(canonicalId);
		if (!entry?.queue.length) return null;
		return entry.queue.map((command, index) => {
			const base = working[this._getRecoveryCommandTrackName({index, part: "base"})];
			const snapshot = working[this._getRecoveryCommandTrackName({index, part: "snapshot"})];
			return {
				...command,
				submittedBase: structuredClone(base.data),
				submittedBaseCoverage: this._cloneTrackCoverage(base.coverage),
				submittedSnapshot: structuredClone(snapshot.data),
				submittedSnapshotCoverage: this._cloneTrackCoverage(snapshot.coverage),
			};
		});
	}

	_getRecoveryQueueFromAuthoritativeRebase ({canonicalId, canonical, staged}) {
		const entry = this._getRecoveryCommandQueueEntry(canonicalId);
		if (!entry?.queue.length) return null;
		const acceptedSequence = this._getOperationWatermark(canonicalId, canonical);
		const getTrack = ({command, index, part}) => {
			const name = this._getRecoveryCommandTrackName({index, part});
			const coverageKey = part === "base" ? "submittedBaseCoverage" : "submittedSnapshotCoverage";
			return {
				data: structuredClone(Object.hasOwn(staged, name)
					? staged[name]
					: command[part === "base" ? "submittedBase" : "submittedSnapshot"]),
				coverage: createCoverage({
					revision: canonical.revision,
					acceptedSequence,
					appliedOperationLegIds: command[coverageKey].appliedOperationLegIds,
				}),
			};
		};
		return entry.queue.map((command, index) => {
			const base = getTrack({command, index, part: "base"});
			const snapshot = getTrack({command, index, part: "snapshot"});
			return {
				...command,
				submittedBase: base.data,
				submittedBaseCoverage: base.coverage,
				submittedSnapshot: snapshot.data,
				submittedSnapshotCoverage: snapshot.coverage,
			};
		});
	}

	_buildReconciliationTracks ({canonicalId, liveData}) {
		const book = this._getCoverageBook(canonicalId);
		const tracks = {};
		const accepted = this._accepted.get(canonicalId);
		if (accepted) tracks.accepted = {data: accepted.data, coverage: this._getAcceptedCoverage(canonicalId)};
		if (liveData !== undefined) tracks.live = {data: liveData, coverage: book.live};
		if (this._latestSubmitted.has(canonicalId)) tracks.latestSubmitted = {data: this._latestSubmitted.get(canonicalId), coverage: book.latestSubmitted};
		if (this._recoveredBases.has(canonicalId)) tracks.recoveredBase = {data: this._recoveredBases.get(canonicalId), coverage: book.recoveredBase};
		const recoveryQueueEntry = this._addRecoveryQueueTracks({canonicalId, tracks});
		if (!recoveryQueueEntry?.queue.length && this._failedWrites.has(canonicalId)) {
			tracks.failedWrite = {data: this._failedWrites.get(canonicalId), coverage: book.failedWrite};
		}
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
	applyRealtimeOperation ({
		characterId,
		leg = CHARACTER_OPERATION_LEGS.TARGET,
		operationId = null,
		operationLegKey = null,
		operation = null,
		sourceCost = null,
		resultingCharacterRevision,
		eventId = null,
		sequence = null,
		liveData,
		fnAdoptLive = null,
	}) {
		if (typeof characterId !== "string" || !characterId) throw new TypeError(`characterId is required.`);
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const {events: appliedEventIds, operationLegs: appliedOperationLegIds} = this._getAppliedIds(canonicalId);

		const plan = planOperationLeg({
			tracks: this._buildReconciliationTracks({canonicalId, liveData}),
			leg,
			operationId,
			operationLegKey,
			operation,
			sourceCost,
			resultingCharacterRevision,
			eventId,
			appliedEventIds,
			appliedOperationLegIds,
		});

		if (plan.status === RECONCILE_STATUS.RESYNC_REQUIRED) {
			this._queuePendingResync({
				canonicalId,
				envelope: {
					eventId,
					sequence,
					leg,
					operationId: plan.operationId || operationId || operation?.operationId,
					operation,
					sourceCost,
					resultingCharacterRevision,
				},
			});
			return {status: plan.status, decisions: plan.decisions};
		}
		if (plan.status === RECONCILE_STATUS.REJECTED || plan.status === RECONCILE_STATUS.BLOCKED) {
			const isCanonicalPrepared = plan.decisions?.accepted === TRACK_DECISION.COVERED
				|| Object.hasOwn(plan.prepared || {}, "accepted");
			if (plan.status === RECONCILE_STATUS.BLOCKED && isCanonicalPrepared && plan.blockedTrack !== "accepted") {
				this._recordOperationConflict({
					canonicalId,
					plan,
					eventId,
					sequence,
					liveData,
					resultingCharacterRevision,
				});
				return {status: plan.status, error: plan.error, decisions: plan.decisions, recovery: this.getOperationConflictRecovery(canonicalId)};
			}
			this._setSaveBlock(canonicalId, {
				reason: plan.status,
				code: plan.error?.code || "OPERATION_INVALID",
				message: plan.error?.message || `The effect could not be applied.`,
			});
			return {status: plan.status, error: plan.error, decisions: plan.decisions};
		}
		if (plan.status === RECONCILE_STATUS.SUPPRESSED) {
			this._commitAppliedIds({
				canonicalId,
				eventId,
				operationLegKey: plan.operationLegKey,
				sequence,
			});
			return {status: plan.status, decisions: plan.decisions};
		}

		const recoveryQueueNxt = this._getRecoveryQueueFromPlan({canonicalId, plan, sequence});
		let stagedRecoveryQueue = null;
		if (recoveryQueueNxt) {
			try {
				stagedRecoveryQueue = this._stageRecoveryCommandQueue({
					characterId: canonicalId,
					queue: recoveryQueueNxt,
				});
			} catch (error) {
				this._setSaveBlock(canonicalId, {
					reason: "recovery_storage_failed",
					code: error.code || "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
					message: error.message || `Cloud character recovery storage failed.`,
				});
				return {status: RECONCILE_STATUS.BLOCKED, error: {code: error.code, message: error.message}, decisions: plan.decisions};
			}
		}

		// ADOPT LIVE — the only externally visible step inside the transaction.
		if (Object.hasOwn(plan.staged, "live") && typeof fnAdoptLive === "function") {
			try {
				fnAdoptLive(structuredClone(plan.staged.live));
			} catch (error) {
				this._rollbackStagedRecoveryCommandQueue(stagedRecoveryQueue);
				return {status: RECONCILE_STATUS.BLOCKED, error: {code: "LIVE_ADOPTION_FAILED", message: error?.message || `Live state could not be updated.`}, decisions: plan.decisions};
			}
		}

		if (stagedRecoveryQueue) this._commitStagedRecoveryCommandQueue(stagedRecoveryQueue);
		this._commitReconciliation({canonicalId, plan, eventId, sequence, isRecoveryQueueCommitted: !!stagedRecoveryQueue});
		return {
			status: RECONCILE_STATUS.APPLIED,
			decisions: plan.decisions,
			liveNext: Object.hasOwn(plan.staged, "live") ? structuredClone(plan.staged.live) : undefined,
			acceptedNext: Object.hasOwn(plan.staged, "accepted") ? structuredClone(plan.staged.accepted) : undefined,
			revisionNext: plan.revisionNext,
		};
	}

	_commitReconciliation ({canonicalId, plan, eventId, sequence, isRecoveryQueueCommitted = false}) {
		const book = this._getCoverageBook(canonicalId);
		const operationLegKey = plan.operationLegKey;
		const revision = plan.revisionNext;
		const staged = plan.staged;

		if (Object.hasOwn(staged, "accepted")) {
			const accepted = this._accepted.get(canonicalId);
			this._accepted.set(canonicalId, {...accepted, data: staged.accepted, revision});
			book.acceptedOperationLegIds.add(operationLegKey);
		} else if (plan.decisions.accepted === TRACK_DECISION.COVERED) {
			book.acceptedOperationLegIds.add(operationLegKey);
		}
		const advance = (coverage, hasStaged) => {
			if (!hasStaged && !Number.isInteger(coverage.revision)) return;
			coverage.revision = Math.max(Number.isInteger(coverage.revision) ? coverage.revision : 0, revision);
			markCoverageOperationLeg(coverage, operationLegKey);
			if (Number.isInteger(sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, sequence);
		};
		const markCovered = coverage => {
			markCoverageOperationLeg(coverage, operationLegKey);
			if (Number.isInteger(sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, sequence);
		};
		if (Object.hasOwn(staged, "live")) advance(book.live, true);
		else if (plan.decisions.live === TRACK_DECISION.COVERED) markCovered(book.live);
		if (Object.hasOwn(staged, "latestSubmitted")) {
			this._latestSubmitted.set(canonicalId, staged.latestSubmitted);
			advance(book.latestSubmitted, true);
		} else if (plan.decisions.latestSubmitted === TRACK_DECISION.COVERED) markCovered(book.latestSubmitted);
		if (Object.hasOwn(staged, "recoveredBase")) {
			this._recoveredBases.set(canonicalId, staged.recoveredBase);
			advance(book.recoveredBase, true);
		} else if (plan.decisions.recoveredBase === TRACK_DECISION.COVERED) markCovered(book.recoveredBase);
		if (Object.hasOwn(staged, "failedWrite")) {
			this._failedWrites.set(canonicalId, {...staged.failedWrite, id: canonicalId});
			advance(book.failedWrite, true);
		} else if (plan.decisions.failedWrite === TRACK_DECISION.COVERED) markCovered(book.failedWrite);

		this._commitConflictReconciliation({canonicalId, plan, revision, operationLegKey, sequence});
		if (!isRecoveryQueueCommitted) this._writeRecoveryCoverage(canonicalId);
		if (this._operationConflicts.get(canonicalId)?.operationLegKey === operationLegKey) {
			this._operationConflicts.delete(canonicalId);
			this._clearSaveBlock(canonicalId);
		}
		this._clearRecoveryStorageSaveBlock(canonicalId);
		this._commitAppliedIds({canonicalId, eventId, operationLegKey, sequence});
	}

	/**
	 * Conflict candidates are transformed individually, never uniformly: the revision-conflict and lease paths
	 * already refetch canonical truth containing the operation, so re-applying it there would double-count. Once
	 * the surviving candidates agree, the overlap is recomputed — an overlap that existed only because of the
	 * operation disappears, while genuinely conflicting owner edits remain.
	 */
	_commitConflictReconciliation ({canonicalId, plan, revision, operationLegKey, sequence}) {
		this._commitOneConflictRecord({store: this._conflicts, prefix: "conflict", canonicalId, plan, revision, operationLegKey, sequence, isClearOnResolve: true});
		this._commitOneConflictRecord({store: this._liveConflicts, prefix: "liveConflict", canonicalId, plan, revision, operationLegKey, sequence, isClearOnResolve: false});
	}

	_commitOneConflictRecord ({store, prefix, canonicalId, plan, revision, operationLegKey, sequence, isClearOnResolve}) {
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
			markCoverageOperationLeg(coverage, operationLegKey);
			if (Number.isInteger(sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, sequence);
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

	_commitAppliedIds ({canonicalId, eventId, operationLegKey, sequence = null}) {
		const {events, operationLegs} = this._getAppliedIds(canonicalId);
		if (eventId) events.add(eventId);
		if (operationLegKey) operationLegs.add(operationLegKey);
		if (Number.isInteger(sequence)) {
			const cursor = this._realtimeCursors.get(canonicalId) || {};
			this._realtimeCursors.set(canonicalId, {...cursor, operationWatermark: Math.max(cursor.operationWatermark || 0, sequence)});
		}
	}

	_queuePendingResync ({canonicalId, envelope}) {
		const pending = this._pendingResync.get(canonicalId) || [];
		if (envelope.eventId && pending.some(it => it.eventId === envelope.eventId)) return;
		const operationLegKey = getOperationLegKey({
			operationId: envelope.operationId || envelope.operation?.operationId,
			leg: envelope.leg || CHARACTER_OPERATION_LEGS.TARGET,
		});
		if (operationLegKey && pending.some(it => getOperationLegKey({
			operationId: it.operationId || it.operation?.operationId,
			leg: it.leg || CHARACTER_OPERATION_LEGS.TARGET,
		}) === operationLegKey)) return;
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
		// Current cloud command queues require durable storage; legacy recovery remains best-effort and
		// degrades the next reload to unknown coverage, forcing a resync rather than a silent double-apply.
		const key = `hub-character-recovery:${this._scopeKey}:${canonicalId}`;
		const queueEntry = this._getRecoveryCommandQueueEntry(canonicalId);
		const failedWrite = this._failedWrites.get(canonicalId);
		if (queueEntry?.queue.length) {
			this._persistRecoveryCommandQueue(canonicalId, {
				queue: queueEntry.queue,
				isRequired: true,
			});
			return;
		}
		try {
			const raw = this._recoveryStorage?.getItem(key);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (!parsed?.snapshot) return;
			const book = this._getCoverageBook(canonicalId);
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
				const routing = getCharacterOperationRouting(event);
				if (!routing || routing.status !== "applied") continue;
				operations.push({
					eventId: event.id,
					sequence: event.sequence,
					characterId: routing.characterId,
					leg: routing.leg,
					operationId: routing.operationId,
					operationLegKey: routing.operationLegKey,
					operation: routing.payload.operation,
					sourceCost: routing.payload.sourceCost,
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
					if (entry.characterId === canonicalId) known.set(entry.operationLegKey, entry);
				}
				for (const envelope of pending) {
					const operationLegKey = getOperationLegKey({
						operationId: envelope.operationId || envelope.operation?.operationId,
						leg: envelope.leg || CHARACTER_OPERATION_LEGS.TARGET,
					});
					if (operationLegKey && !known.has(operationLegKey)) known.set(operationLegKey, {...envelope, operationLegKey});
				}
				const ordered = [...known.values()].sort((a, b) => (
					a.resultingCharacterRevision - b.resultingCharacterRevision
					|| (a.sequence || 0) - (b.sequence || 0)
				));

				if (!history.isComplete && ordered.length < pending.length) {
					this._setSaveBlock(canonicalId, {
						reason: "resync_unavailable",
						code: "OPERATION_HISTORY_UNAVAILABLE",
						message: `Campaign effect history is no longer available. Reload this character, or export your local copy.`,
					});
					return {status: "history_unavailable"};
				}

				// Canonical truth is exact and already reflects every operation up to its revision; the dirty
				// tracks only need the ones they are missing. The whole batch is planned against working copies
				// first, adopted into live state once, and only then committed — a partial commit would advance
				// coverage past data the sheet never received, and every later replay would then be suppressed.
				const working = this._buildResyncWorkingSet({
					canonicalId,
					canonical,
					liveData: fnGetLiveData ? fnGetLiveData() : undefined,
				});
				const plan = this._planResyncBatch({canonicalId, working, ordered});
				if (plan.status !== "planned") {
					this._setSaveBlock(canonicalId, {
						reason: "resync_unavailable",
						code: plan.error?.code || "OPERATION_HISTORY_UNAVAILABLE",
						message: `Campaign effect history is no longer available. Reload this character, or export your local copy.`,
					});
					return {status: "history_unavailable"};
				}

				const recoveryQueueNxt = this._getRecoveryQueueFromWorkingSet({canonicalId, working});
				let stagedRecoveryQueue = null;
				if (recoveryQueueNxt) {
					try {
						stagedRecoveryQueue = this._stageRecoveryCommandQueue({
							characterId: canonicalId,
							queue: recoveryQueueNxt,
						});
					} catch (error) {
						this._setSaveBlock(canonicalId, {
							reason: "recovery_storage_failed",
							code: error.code || "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
							message: error.message || `Cloud character recovery storage failed.`,
						});
						return {status: "failed", error: {code: error.code, message: error.message}};
					}
				}

				const liveNext = working.live?.data;
				const isLiveChanged = !!plan.applied.length && liveNext !== undefined;
				if (isLiveChanged && typeof fnAdoptLive === "function") {
					try {
						fnAdoptLive(structuredClone(liveNext));
					} catch (error) {
						this._rollbackStagedRecoveryCommandQueue(stagedRecoveryQueue);
						// Nothing has been committed yet, so a retry replays the identical batch.
						return {status: "failed", error: {code: "LIVE_ADOPTION_FAILED", message: error?.message}};
					}
				}

				if (stagedRecoveryQueue) this._commitStagedRecoveryCommandQueue(stagedRecoveryQueue);
				this._commitResyncBatch({canonicalId, canonical, plan, isRecoveryQueueCommitted: !!stagedRecoveryQueue});
				this._pendingResync.delete(canonicalId);
				this._clearSaveBlock(canonicalId);
				return {
					status: "recovered",
					appliedCount: plan.applied.length,
					appliedOperations: plan.applied.filter(entry => entry.operation).map(entry => structuredClone(entry.operation)),
					appliedLegs: plan.applied.map(entry => ({
						leg: entry.leg,
						operationId: entry.operationId,
						operationLegKey: entry.operationLegKey,
					})),
					appliedEffects: plan.applied
						.filter(entry => entry.appliedEffect)
						.map(entry => structuredClone(entry.appliedEffect)),
					liveNext: isLiveChanged ? structuredClone(liveNext) : undefined,
				};
			});
		} finally {
			this._resyncInFlight.delete(canonicalId);
		}
	}

	/** Working copies of every track a resync may advance. Nothing here is repository state yet. */
	_buildResyncWorkingSet ({canonicalId, canonical, liveData}) {
		const book = this._getCoverageBook(canonicalId);
		const acceptedSequence = this._getOperationWatermark(canonicalId, canonical);
		const working = {
			accepted: {
				data: structuredClone(canonical.data),
				coverage: createCoverage({revision: canonical.revision, acceptedSequence}),
			},
		};
		if (liveData !== undefined) working.live = {data: structuredClone(liveData), coverage: this._cloneTrackCoverage(book.live)};
		for (const [name, map, coverageKey] of [
			["latestSubmitted", this._latestSubmitted, "latestSubmitted"],
			["recoveredBase", this._recoveredBases, "recoveredBase"],
			["failedWrite", this._failedWrites, "failedWrite"],
		]) {
			if (!map.has(canonicalId)) continue;
			working[name] = {data: structuredClone(map.get(canonicalId)), coverage: this._cloneTrackCoverage(book[coverageKey])};
		}
		const recoveryQueueEntry = this._getRecoveryCommandQueueEntry(canonicalId);
		for (const [index, command] of (recoveryQueueEntry?.queue || []).entries()) {
			working[this._getRecoveryCommandTrackName({index, part: "base"})] = {
				data: structuredClone(command.submittedBase),
				coverage: this._cloneTrackCoverage(command.submittedBaseCoverage),
			};
			working[this._getRecoveryCommandTrackName({index, part: "snapshot"})] = {
				data: structuredClone(command.submittedSnapshot),
				coverage: this._cloneTrackCoverage(command.submittedSnapshotCoverage),
			};
		}
		for (const [store, prefix] of [[this._conflicts, "conflict"], [this._liveConflicts, "liveConflict"]]) {
			const conflict = store.get(canonicalId);
			if (!conflict) continue;
			for (const key of ["base", "local", "server"]) {
				working[`${prefix}${key[0].toUpperCase()}${key.slice(1)}`] = {
					data: structuredClone(conflict[key]),
					coverage: this._getConflictCoverage(conflict, key),
				};
			}
		}
		return working;
	}

	/**
	 * Replay the ordered batch across the working set without touching repository state.
	 *
	 * Returning a failure here leaves every track, id set and recovery record exactly as it was, so a retry
	 * replays the identical batch instead of finding the earlier operations already marked as covered.
	 */
	_planResyncBatch ({canonicalId, working, ordered}) {
		const {events, operationLegs} = this._getAppliedIds(canonicalId);
		const workingEvents = events.clone();
		const workingOperationLegs = operationLegs.clone();
		const applied = [];

		for (const entry of ordered) {
			const liveBefore = working.live ? structuredClone(working.live.data) : null;
			const plan = planOperationLeg({
				tracks: working,
				leg: entry.leg || CHARACTER_OPERATION_LEGS.TARGET,
				operationId: entry.operationId || entry.operation?.operationId,
				operation: entry.operation,
				sourceCost: entry.sourceCost,
				resultingCharacterRevision: entry.resultingCharacterRevision,
				eventId: entry.eventId,
				appliedEventIds: workingEvents,
				appliedOperationLegIds: workingOperationLegs,
			});
			if (plan.status !== RECONCILE_STATUS.APPLIED && plan.status !== RECONCILE_STATUS.SUPPRESSED) {
				return {status: plan.status, error: plan.error};
			}
			const operationLegKey = plan.operationLegKey;
			if (plan.status === RECONCILE_STATUS.APPLIED) {
				for (const [name, next] of Object.entries(plan.staged)) {
					working[name].data = next;
					const coverage = working[name].coverage;
					coverage.revision = Math.max(Number.isInteger(coverage.revision) ? coverage.revision : 0, plan.revisionNext);
					markCoverageOperationLeg(coverage, operationLegKey);
					if (Number.isInteger(entry.sequence)) coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, entry.sequence);
				}
				for (const [name, decision] of Object.entries(plan.decisions)) {
					if (decision !== TRACK_DECISION.COVERED) continue;
					markCoverageOperationLeg(working[name].coverage, operationLegKey);
					if (Number.isInteger(entry.sequence)) {
						working[name].coverage.acceptedSequence = Math.max(working[name].coverage.acceptedSequence || 0, entry.sequence);
					}
				}
				applied.push({
					...entry,
					leg: plan.leg,
					operationId: plan.operationId,
					operationLegKey,
					...(Object.hasOwn(plan.staged, "live")
						&& plan.operation
						? {
							appliedEffect: {
								operation: structuredClone(entry.operation),
								beforeData: liveBefore,
								afterData: structuredClone(plan.staged.live),
							},
						}
						: {}),
				});
			}
			if (entry.eventId) workingEvents.add(entry.eventId);
			if (operationLegKey) workingOperationLegs.add(operationLegKey);
		}
		return {status: "planned", working, workingEvents, workingOperationLegs, applied};
	}

	/** Publish a fully planned and already-adopted batch. */
	_commitResyncBatch ({canonicalId, canonical, plan, isRecoveryQueueCommitted = false}) {
		const book = this._getCoverageBook(canonicalId);
		const working = plan.working;

		this._accepted.set(canonicalId, {...canonical, data: working.accepted.data, revision: canonical.revision});
		book.acceptedOperationLegIds = working.accepted.coverage.appliedOperationLegIds;
		if (working.live) book.live = working.live.coverage;
		for (const [name, map, coverageKey] of [
			["latestSubmitted", this._latestSubmitted, "latestSubmitted"],
			["recoveredBase", this._recoveredBases, "recoveredBase"],
		]) {
			if (!working[name]) continue;
			map.set(canonicalId, working[name].data);
			book[coverageKey] = working[name].coverage;
		}
		if (working.failedWrite) {
			this._failedWrites.set(canonicalId, {...working.failedWrite.data, id: canonicalId});
			book.failedWrite = working.failedWrite.coverage;
		}
		this._commitResyncConflict({store: this._conflicts, prefix: "conflict", canonicalId, working, isClearOnResolve: true});
		this._commitResyncConflict({store: this._liveConflicts, prefix: "liveConflict", canonicalId, working, isClearOnResolve: false});

		this._appliedEventIds.set(canonicalId, plan.workingEvents);
		this._appliedOperationLegIds.set(canonicalId, plan.workingOperationLegs);

		const sequences = plan.applied.map(entry => entry.sequence).filter(Number.isInteger);
		if (sequences.length) {
			const cursor = this._realtimeCursors.get(canonicalId) || {};
			this._realtimeCursors.set(canonicalId, {...cursor, operationWatermark: Math.max(cursor.operationWatermark || 0, ...sequences)});
		}
		if (!isRecoveryQueueCommitted) this._writeRecoveryCoverage(canonicalId);
	}

	_commitResyncConflict ({store, prefix, canonicalId, working, isClearOnResolve}) {
		const conflict = store.get(canonicalId);
		if (!conflict) return;
		const next = {...conflict, coverage: {...(conflict.coverage || {})}};
		for (const key of ["base", "local", "server"]) {
			const track = working[`${prefix}${key[0].toUpperCase()}${key.slice(1)}`];
			if (!track) continue;
			next[key] = track.data;
			next.coverage[key] = serializeCoverage(track.coverage);
		}
		const serverTrack = working[`${prefix}Server`];
		if (serverTrack && next.serverDocument) {
			// The resolvable document seeds accepted truth directly, so its revision must describe the data it
			// now holds. The server track's own coverage is that invariant: it records exactly which operations
			// were folded in, which is not necessarily the fetched canonical revision.
			const revision = serverTrack.coverage?.revision;
			next.serverDocument = {
				...next.serverDocument,
				data: serverTrack.data,
				...(Number.isInteger(revision) ? {revision} : {}),
			};
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
		const acceptedSequence = this._getOperationWatermark(canonicalId, accepted);
		book.live = createCoverage({revision: accepted.revision, acceptedSequence, appliedOperationLegIds: book.live.appliedOperationLegIds});
		book.latestSubmitted = createCoverage({revision: accepted.revision, acceptedSequence, appliedOperationLegIds: book.latestSubmitted.appliedOperationLegIds});
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
		const queueEntry = this._getRecoveryCommandQueueEntry(fromId);
		const stagedQueue = queueEntry?.queue.length
			? this._stageRecoveryCommandQueue({
				characterId: fromId,
				queue: queueEntry.queue,
				isRequired: true,
				storageId: toId,
			})
			: null;
		const oldKey = this._getRecoveryStorageKey(fromId);
		const newKey = this._getRecoveryStorageKey(toId);
		let stagedRaw = null;
		if (!stagedQueue && this._recoveryStorage) {
			try {
				const oldRaw = this._recoveryStorage.getItem(oldKey);
				if (oldRaw != null) {
					stagedRaw = {
						oldRaw,
						newRaw: this._recoveryStorage.getItem(newKey),
					};
					this._recoveryStorage.setItem(newKey, oldRaw);
					this._recoveryStorage.removeItem(oldKey);
				}
			} catch (cause) {
				if (stagedRaw) {
					try {
						this._recoveryStorage.setItem(oldKey, stagedRaw.oldRaw);
						if (stagedRaw.newRaw == null) this._recoveryStorage.removeItem(newKey);
						else this._recoveryStorage.setItem(newKey, stagedRaw.newRaw);
					} catch {
						// The original durability error is the actionable failure.
					}
				}
				throw this._getRecoveryStorageError({
					code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
					message: `Cloud character recovery identity could not be stored safely.`,
					cause,
				});
			}
		}

		this._canonicalIds.set(fromId, toId);
		this._recoveryOnlyIds.delete(fromId);
		this._recoveryOnlyIds.delete(toId);
		for (const map of [this._failedWrites, this._latestSubmitted, this._recoveredBases]) {
			if (!map.has(fromId)) continue;
			map.set(toId, map.get(fromId));
			map.delete(fromId);
		}
		for (const map of [this._coverage, this._appliedEventIds, this._appliedOperationLegIds, this._pendingResync, this._realtimeCursors, this._saveBlocks, this._liveConflicts, this._operationConflicts]) {
			if (!map.has(fromId)) continue;
			map.set(toId, map.get(fromId));
			map.delete(fromId);
		}
		if (this._resyncInFlight.delete(fromId)) this._resyncInFlight.add(toId);
		if (stagedQueue) {
			this._commitStagedRecoveryCommandQueue(stagedQueue);
			this._recoveryVersions.delete(oldKey);
			return;
		}
		if (this._recoveryVersions.has(oldKey)) {
			this._recoveryVersions.set(newKey, this._recoveryVersions.get(oldKey));
			this._recoveryVersions.delete(oldKey);
		}
	}

	_getRecoveryStoragePrefix () {
		return `hub-character-recovery:${this._scopeKey}:`;
	}

	_getRecoveryStorageKey (characterId) {
		return `${this._getRecoveryStoragePrefix()}${characterId}`;
	}

	_getOwnedRecoveryOnlyCharacterIds () {
		const accountId = this._session?.account?.id;
		if (!accountId || !this._recoveryStorage || typeof this._recoveryStorage.key !== "function") return [];
		const prefix = this._getRecoveryStoragePrefix();
		const out = [];
		for (let i = 0; i < this._recoveryStorage.length; ++i) {
			const key = this._recoveryStorage.key(i);
			if (!key?.startsWith(prefix)) continue;
			try {
				const parsed = JSON.parse(this._recoveryStorage.getItem(key));
				const characterId = key.slice(prefix.length);
				if (parsed?.ownerAccountId !== accountId || parsed?.clientImportId !== characterId) continue;
				out.push(characterId);
			} catch {
				// Invalid recovery blobs are ignored by the same fail-closed rule as getPendingRecovery.
			}
		}
		return out;
	}

	_getRecoveryCommandQueueEntry (characterId) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		for (const key of new Set([characterId, canonicalId])) {
			if (this._recoveryCommandQueues.has(key)) return {key, queue: this._recoveryCommandQueues.get(key)};
		}
		return null;
	}

	_areSameCommandKeys (left, right) {
		return left?.create === right?.create && left?.patch === right?.patch;
	}

	_isSameCommandPayload (command, {snapshot, activity}) {
		return JSON.stringify(command?.submittedSnapshot) === JSON.stringify(snapshot)
			&& JSON.stringify(command?.submittedActivity ?? null) === JSON.stringify(activity ?? null);
	}

	_getRecoveryCommandTrackName ({index, part}) {
		return `${_RECOVERY_COMMAND_TRACK_PREFIX}:${index}:${part}`;
	}

	_getRecoveryStorageError ({code, message, cause = null}) {
		const error = new Error(message);
		error.code = code;
		if (cause) error.cause = cause;
		return error;
	}

	_getRecoveryQueuePayload ({queue, version}) {
		if (queue.length > _RECOVERY_COMMAND_QUEUE_LIMIT) {
			throw this._getRecoveryStorageError({
				code: "CHARACTER_RECOVERY_LIMIT",
				message: `Too many cloud character changes are waiting to save. Wait for the current save to finish, then retry.`,
			});
		}
		const first = queue[0];
		let previousSnapshot = structuredClone(first.submittedBase);
		let previousCoverage = this._cloneTrackCoverage(first.submittedBaseCoverage);
		const commands = queue.map(command => {
			if (diffJson(previousSnapshot, command.submittedBase).length
				|| JSON.stringify(serializeCoverage(previousCoverage)) !== JSON.stringify(serializeCoverage(command.submittedBaseCoverage))) {
				throw this._getRecoveryStorageError({
					code: "CHARACTER_RECOVERY_INTEGRITY",
					message: `Cloud character recovery history is inconsistent. Reload or export the character before retrying.`,
				});
			}
			const out = {
				patches: diffJson(command.submittedBase, command.submittedSnapshot),
				activity: structuredClone(command.submittedActivity),
				commandKeys: {...command.commandKeys},
				state: command.state,
				snapshotCoverage: serializeCoverage(command.submittedSnapshotCoverage),
			};
			previousSnapshot = structuredClone(command.submittedSnapshot);
			previousCoverage = this._cloneTrackCoverage(command.submittedSnapshotCoverage);
			return out;
		});
		const payload = {
			version,
			queueVersion: _RECOVERY_COMMAND_QUEUE_VERSION,
			...(this._session?.account?.id ? {ownerAccountId: this._session.account.id} : {}),
			...(first.requestedId ? {clientImportId: first.requestedId} : {}),
			base: structuredClone(first.submittedBase),
			baseCoverage: serializeCoverage(first.submittedBaseCoverage),
			commands,
		};
		const raw = JSON.stringify(payload);
		const byteLength = new TextEncoder().encode(raw).byteLength;
		if (byteLength > _RECOVERY_COMMAND_QUEUE_MAX_BYTES) {
			throw this._getRecoveryStorageError({
				code: "CHARACTER_RECOVERY_LIMIT",
				message: `Cloud character recovery is full. Wait for the current save to finish, then retry.`,
			});
		}
		return raw;
	}

	_hydrateRecoveryCommand ({characterId, raw}) {
		const isCoverageKnown = [1, COVERAGE_VERSION].includes(raw.coverageVersion) && !!raw.coverage;
		return {
			requestedId: characterId,
			submittedSnapshot: structuredClone(raw.snapshot),
			submittedActivity: structuredClone(raw.activity ?? null),
			submittedBase: structuredClone(raw.base ?? null),
			submittedBaseCoverage: isCoverageKnown ? deserializeCoverage(raw.coverage.base) : createCoverage(),
			submittedSnapshotCoverage: isCoverageKnown ? deserializeCoverage(raw.coverage.snapshot) : createCoverage(),
			commandKeys: {...raw.commandKeys},
			state: ["failed", "conflict"].includes(raw.state) ? raw.state : "pending",
		};
	}

	_hydrateCompactRecoveryQueue ({characterId, parsed}) {
		if (!Array.isArray(parsed.commands) || !parsed.commands.length || parsed.commands.length > _RECOVERY_COMMAND_QUEUE_LIMIT) return null;
		let base = structuredClone(parsed.base ?? null);
		let baseCoverage = deserializeCoverage(parsed.baseCoverage);
		const queue = [];
		for (const raw of parsed.commands) {
			if (!Array.isArray(raw?.patches) || !raw?.commandKeys?.create || !raw?.commandKeys?.patch) return null;
			const snapshot = applyJsonPatch(base, raw.patches);
			const snapshotCoverage = deserializeCoverage(raw.snapshotCoverage);
			queue.push({
				requestedId: characterId,
				submittedSnapshot: structuredClone(snapshot),
				submittedActivity: structuredClone(raw.activity ?? null),
				submittedBase: structuredClone(base),
				submittedBaseCoverage: this._cloneTrackCoverage(baseCoverage),
				submittedSnapshotCoverage: this._cloneTrackCoverage(snapshotCoverage),
				commandKeys: {...raw.commandKeys},
				state: ["failed", "conflict"].includes(raw.state) ? raw.state : "pending",
			});
			base = structuredClone(snapshot);
			baseCoverage = this._cloneTrackCoverage(snapshotCoverage);
		}
		return queue;
	}

	_stageRecoveryCommandQueue ({characterId, queue, isRequired = queue.length > 0, storageId = null}) {
		const canonicalId = storageId || this._canonicalIds.get(characterId) || characterId;
		const entry = this._getRecoveryCommandQueueEntry(characterId);
		const key = storageId || entry?.key || canonicalId;
		const recoveryKeys = [...new Set([
			this._getRecoveryStorageKey(characterId),
			this._getRecoveryStorageKey(this._canonicalIds.get(characterId) || characterId),
			this._getRecoveryStorageKey(canonicalId),
			this._getRecoveryStorageKey(entry?.key || key),
			this._getRecoveryStorageKey(key),
		])];
		const recoveryKey = this._getRecoveryStorageKey(key);
		const version = (this._recoveryVersions.get(recoveryKey) || 0) + 1;
		const nextRaw = queue.length ? this._getRecoveryQueuePayload({queue, version}) : null;
		if (!this._recoveryStorage) {
			if (isRequired) {
				throw this._getRecoveryStorageError({
					code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
					message: `This cloud character change cannot be saved safely because browser recovery storage is unavailable.`,
				});
			}
			return {characterId, canonicalId, key, queue, recoveryKey, recoveryKeys, version, isStored: false, previous: new Map()};
		}

		let previous;
		try {
			previous = new Map(recoveryKeys.map(storageKey => [storageKey, this._recoveryStorage.getItem(storageKey)]));
			for (const storageKey of recoveryKeys) {
				if (storageKey === recoveryKey && nextRaw != null) this._recoveryStorage.setItem(storageKey, nextRaw);
				else this._recoveryStorage.removeItem(storageKey);
			}
		} catch (cause) {
			for (const [storageKey, raw] of previous || []) {
				try {
					if (raw == null) this._recoveryStorage.removeItem(storageKey);
					else this._recoveryStorage.setItem(storageKey, raw);
				} catch {
					// The original durability error is the actionable failure.
				}
			}
			if (isRequired) {
				throw this._getRecoveryStorageError({
					code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
					message: `This cloud character change cannot be saved safely because browser recovery storage is full or unavailable.`,
					cause,
				});
			}
			return {characterId, canonicalId, key, queue, recoveryKey, recoveryKeys, version, isStored: false, previous};
		}
		return {characterId, canonicalId, key, queue, recoveryKey, recoveryKeys, version, isStored: true, previous};
	}

	_rollbackStagedRecoveryCommandQueue (staged) {
		if (!staged?.isStored || !this._recoveryStorage) return;
		for (const [storageKey, raw] of staged.previous) {
			try {
				if (raw == null) this._recoveryStorage.removeItem(storageKey);
				else this._recoveryStorage.setItem(storageKey, raw);
			} catch {
				this._setSaveBlock(staged.canonicalId, {
					reason: "recovery_storage_failed",
					code: "CHARACTER_RECOVERY_STORAGE_UNAVAILABLE",
					message: `Cloud character recovery storage failed. Reload or export this character before continuing.`,
				});
			}
		}
	}

	_commitStagedRecoveryCommandQueue (staged) {
		const {characterId, canonicalId, key, queue, recoveryKey, recoveryKeys, version, isStored} = staged;
		this._recoveryCommandQueues.delete(characterId);
		this._recoveryCommandQueues.delete(canonicalId);
		this._recoveryCommandQueues.delete(key);
		if (!queue.length) {
			this._failedWrites.delete(characterId);
			this._failedWrites.delete(canonicalId);
			this._failedWrites.delete(key);
			this._recoveredBases.delete(characterId);
			this._recoveredBases.delete(canonicalId);
			this._recoveredBases.delete(key);
			this._getCoverageBook(canonicalId).failedWrite = createCoverage();
			for (const storageKey of recoveryKeys) this._recoveryVersions.delete(storageKey);
			return;
		}
		this._recoveryCommandQueues.set(key, queue);
		const latest = queue.at(-1);
		this._failedWrites.set(key, {...structuredClone(latest.submittedSnapshot), id: key});
		this._getCoverageBook(key).failedWrite = this._cloneTrackCoverage(latest.submittedSnapshotCoverage);
		if (isStored) this._recoveryVersions.set(recoveryKey, version);
	}

	_commitRecoveryCommandQueueInMemory ({characterId, queue}) {
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const entry = this._getRecoveryCommandQueueEntry(characterId);
		const key = entry?.key || canonicalId;
		this._commitStagedRecoveryCommandQueue({
			characterId,
			canonicalId,
			key,
			queue,
			recoveryKey: `hub-character-recovery:${this._scopeKey}:${key}`,
			recoveryKeys: [...new Set([
				`hub-character-recovery:${this._scopeKey}:${characterId}`,
				`hub-character-recovery:${this._scopeKey}:${canonicalId}`,
				`hub-character-recovery:${this._scopeKey}:${key}`,
			])],
			version: this._recoveryVersions.get(`hub-character-recovery:${this._scopeKey}:${key}`) || 0,
			isStored: false,
		});
	}

	_persistRecoveryCommandQueue (characterId, {queue = null, isRequired} = {}) {
		const entry = this._getRecoveryCommandQueueEntry(characterId);
		const queueNxt = queue || entry?.queue || [];
		const staged = this._stageRecoveryCommandQueue({
			characterId,
			queue: queueNxt,
			...(isRequired == null ? {} : {isRequired}),
		});
		this._commitStagedRecoveryCommandQueue({...staged, characterId});
		return staged;
	}

	async _pExecuteUpsertCommand (command) {
		const {
			requestedId,
			submittedSnapshot,
			submittedActivity,
			commandKeys,
			submittedBase,
			submittedBaseCoverage,
			submittedSnapshotCoverage,
		} = command;
		const canonicalId = this._canonicalIds.get(requestedId) || requestedId;
		if (canonicalId !== requestedId) {
			this._migrateCharacterIdentity({fromId: requestedId, toId: canonicalId});
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
			}
			if (!accepted) {
				const created = await this._api.pCreateCharacter({
					clientImportId: requestedId,
					campaignId: this._campaignId,
					data: this._getSnapshotData(characterNxt),
					rulesVersionId: this._fnGetRulesVersionId(),
					idempotencyKey: commandKeys.create,
				});
				this._canonicalIds.set(requestedId, created.character.id);
				this._migrateCharacterIdentity({fromId: requestedId, toId: created.character.id});
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
		// A recursive diff never emits a whole-block `/carry` op, which is the only signal
		// the server accepts as "this writer understands carry authority". Without this
		// normalisation an ordinary save strips the summary it is actually carrying.
		const patches = withRootCarryWrite({patches: diffJson(accepted.data, desired), document: desired, base: accepted.data});
		if (!patches.length && !submittedActivity) {
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
				activity: submittedActivity,
				rulesVersionId: this._fnGetRulesVersionId(),
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
						server: serializeCoverage(createCoverage({revision: canonical.revision, acceptedSequence: this._getOperationWatermark(canonicalId, canonical)})),
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
						server: serializeCoverage(createCoverage({revision: canonical.revision, acceptedSequence: this._getOperationWatermark(canonicalId, canonical)})),
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
				patches: withRootCarryWrite({
					patches: diffJson(canonical.data, rebased.document),
					document: rebased.document,
					base: canonical.data,
				}),
				activity: submittedActivity,
				rulesVersionId: this._fnGetRulesVersionId(),
				idempotencyKey: commandKeys.patch,
			});
		}
		this._accepted.set(canonicalId, result.character);
		this._syncCoverageToAccepted(canonicalId);
		return this._getData(result.character);
	}

	async _pDrainRecoveryCommandQueue ({characterId, throughCommandKeys}) {
		let lastResult = null;
		while (true) {
			const entry = this._getRecoveryCommandQueueEntry(characterId);
			if (!entry?.queue.length) {
				const canonicalId = this._canonicalIds.get(characterId) || characterId;
				const accepted = this._accepted.get(canonicalId);
				return lastResult || (accepted ? this._getData(accepted) : null);
			}
			if (!entry.queue.some(command => this._areSameCommandKeys(command.commandKeys, throughCommandKeys))) {
				const canonicalId = this._canonicalIds.get(characterId) || characterId;
				const accepted = this._accepted.get(canonicalId);
				return lastResult || (accepted ? this._getData(accepted) : null);
			}

			const command = entry.queue[0];
			const isRecoveryReplay = command.state === "failed";
			try {
				lastResult = await this._pExecuteUpsertCommand(command);
			} catch (error) {
				const currentEntry = this._getRecoveryCommandQueueEntry(characterId);
				const queueNxt = (currentEntry?.queue || entry.queue).map((it, index) => index
					? it
					: {...it, state: error?.code === "CHARACTER_CONFLICT" ? "conflict" : "failed"});
				if (error?.code === "CHARACTER_CONFLICT") {
					const canonicalId = this._canonicalIds.get(characterId) || characterId;
					const recovery = this._conflicts.get(canonicalId);
					const latest = queueNxt.at(-1);
					if (recovery && latest) recovery.local = structuredClone(latest.submittedSnapshot);
				}
				try {
					this._persistRecoveryCommandQueue(characterId, {
						queue: queueNxt,
						isRequired: true,
					});
				} catch (storageError) {
					this._commitRecoveryCommandQueueInMemory({characterId, queue: queueNxt});
					throw storageError;
				}
				throw error;
			}

			const committedEntry = this._getRecoveryCommandQueueEntry(characterId);
			const committed = committedEntry?.queue[0];
			if (!committed || !this._areSameCommandKeys(committed.commandKeys, command.commandKeys)) {
				throw new Error(`Character recovery command queue changed during serialized commit.`);
			}
			const queueNxt = committedEntry.queue.slice(1);
			const isTargetCommitted = this._areSameCommandKeys(command.commandKeys, throughCommandKeys);
			const canonicalId = this._canonicalIds.get(characterId) || characterId;
			const accepted = this._accepted.get(canonicalId);
			const next = queueNxt[0];
			if (next && accepted && isRecoveryReplay) {
				queueNxt[0] = {
					...next,
					requestedId: canonicalId,
					submittedBase: structuredClone(accepted.data),
					submittedBaseCoverage: this._cloneTrackCoverage(this._getAcceptedCoverage(canonicalId)),
					state: "pending",
				};
			}
			try {
				this._persistRecoveryCommandQueue(characterId, {
					queue: queueNxt,
					isRequired: queueNxt.length > 0,
				});
			} catch (storageError) {
				const retryQueue = committedEntry.queue.map((it, index) => index ? it : {...it, state: "failed"});
				this._commitRecoveryCommandQueueInMemory({characterId, queue: retryQueue});
				throw storageError;
			}
			if (isTargetCommitted) return lastResult;
		}
	}

	pUpsert ({character, activity = null}) {
		if (this._session?.signedIn) return this._pUpsertAfterSession({character, activity});
		return this._pEnsureSession().then(() => this._pUpsertAfterSession({character, activity}));
	}

	_pUpsertAfterSession ({character, activity = null}) {
		const saveBlock = this.getSaveBlock(character?.id);
		if (saveBlock) {
			const error = new Error(saveBlock.message || `Character saving is paused until reconciliation completes.`);
			error.code = saveBlock.code || "CHARACTER_RECONCILIATION_BLOCKED";
			error.saveBlock = saveBlock;
			return Promise.reject(error);
		}
		const requestedId = character.id;
		const canonicalAtCall = this._canonicalIds.get(requestedId) || requestedId;
		const submittedSnapshot = this._getSnapshotData(character);
		const submittedActivity = activity == null ? null : structuredClone(activity);
		const bookAtCall = this._getCoverageBook(canonicalAtCall);
		const submittedSnapshotCoverage = this._cloneTrackCoverage(bookAtCall.live);
		let queueEntry = this._getRecoveryCommandQueueEntry(requestedId);
		if (!queueEntry) {
			const queue = [];
			this._recoveryCommandQueues.set(canonicalAtCall, queue);
			queueEntry = {key: canonicalAtCall, queue};
		}
		const retryCommand = queueEntry.queue[0]?.state === "failed"
			&& this._isSameCommandPayload(queueEntry.queue[0], {snapshot: submittedSnapshot, activity: submittedActivity})
			? queueEntry.queue[0]
			: null;
		let command = retryCommand;
		if (!command) {
			const latestQueued = queueEntry.queue.at(-1);
			const recoveredBase = latestQueued ? null : this._recoveredBases.get(requestedId);
			const submittedBase = structuredClone(
				recoveredBase
				|| latestQueued?.submittedSnapshot
				|| (this._pendingWrites > 0 ? this._latestSubmitted.get(requestedId) : null)
				|| this._accepted.get(canonicalAtCall)?.data
				|| this._latestSubmitted.get(requestedId)
				|| null,
			);
			const submittedBaseCoverage = this._cloneTrackCoverage(
				recoveredBase ? bookAtCall.recoveredBase
					: latestQueued ? latestQueued.submittedSnapshotCoverage
						: (this._pendingWrites > 0 && this._latestSubmitted.get(requestedId)) ? bookAtCall.latestSubmitted
							: this._accepted.get(canonicalAtCall)?.data ? this._getAcceptedCoverage(canonicalAtCall)
								: bookAtCall.latestSubmitted,
			);
			command = {
				requestedId,
				submittedSnapshot,
				submittedActivity,
				commandKeys: {create: crypto.randomUUID(), patch: crypto.randomUUID()},
				submittedBase,
				submittedBaseCoverage,
				submittedSnapshotCoverage,
				state: "pending",
			};
		}
		const queueNxt = command === retryCommand ? queueEntry.queue : [...queueEntry.queue, command];
		try {
			this._persistRecoveryCommandQueue(requestedId, {
				queue: queueNxt,
				isRequired: true,
			});
		} catch (error) {
			return Promise.reject(error);
		}
		this._recoveredBases.delete(requestedId);
		bookAtCall.recoveredBase = createCoverage();
		this._latestSubmitted.set(requestedId, structuredClone(submittedSnapshot));
		bookAtCall.latestSubmitted = this._cloneTrackCoverage(submittedSnapshotCoverage);
		this._pendingWrites++;
		const pResult = this._pRunMutation(() => this._pDrainRecoveryCommandQueue({
			characterId: requestedId,
			throughCommandKeys: command.commandKeys,
		}));
		return pResult
			.finally(() => this._pendingWrites--);
	}

	hasPendingWrites () {
		return this._pendingWrites > 0
			|| this._conflicts.size > 0
			|| this._failedWrites.size > 0
			|| this._operationConflicts.size > 0;
	}

	getPendingRecovery (characterId) {
		try {
			const canonicalId = this._canonicalIds.get(characterId) || characterId;
			const recoveryKeys = [...new Set([
				`hub-character-recovery:${this._scopeKey}:${characterId}`,
				`hub-character-recovery:${this._scopeKey}:${canonicalId}`,
			])];
			const recoveryKey = recoveryKeys.find(key => this._recoveryStorage?.getItem(key));
			const raw = recoveryKey ? this._recoveryStorage?.getItem(recoveryKey) : null;
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			let queue = null;
			if (parsed.queueVersion === _RECOVERY_COMMAND_QUEUE_VERSION) {
				queue = this._hydrateCompactRecoveryQueue({characterId: canonicalId, parsed});
			} else if (parsed.queueVersion === _RECOVERY_COMMAND_QUEUE_LEGACY_VERSION) {
				if (!Array.isArray(parsed.commands)
					|| !parsed.commands.length
					|| parsed.commands.some(command => !command?.snapshot || !command?.commandKeys?.create || !command?.commandKeys?.patch)) return null;
				queue = parsed.commands.map(command => this._hydrateRecoveryCommand({characterId: canonicalId, raw: command}));
			}
			if (queue?.length) {
				if (queue[0].state === "pending") queue[0].state = "failed";
				this._recoveryCommandQueues.set(canonicalId, queue);
				if (Number.isInteger(parsed.version)) this._recoveryVersions.set(recoveryKey, parsed.version);
				const latest = queue.at(-1);
				const book = this._getCoverageBook(canonicalId);
				book.failedWrite = this._cloneTrackCoverage(latest.submittedSnapshotCoverage);
				this._failedWrites.set(canonicalId, {...structuredClone(latest.submittedSnapshot), id: canonicalId});
				return structuredClone(latest.submittedSnapshot);
			}
			if (parsed.snapshot) {
				const book = this._getCoverageBook(canonicalId);
				// A blob written before coverage metadata existed cannot prove which operations it already
				// reflects. It is still honoured as a draft, but its unknown coverage forces a resync rather than
				// a guess in either direction.
				const isCoverageKnown = [1, COVERAGE_VERSION].includes(parsed.coverageVersion) && !!parsed.coverage;
				book.recoveredBase = isCoverageKnown ? deserializeCoverage(parsed.coverage.base) : createCoverage();
				book.failedWrite = isCoverageKnown ? deserializeCoverage(parsed.coverage.snapshot) : createCoverage();
				if (parsed.base) {
					this._recoveredBases.set(characterId, parsed.base);
				}
				if (parsed.commandKeys) {
					const command = this._hydrateRecoveryCommand({
						characterId: canonicalId,
						raw: {
							base: parsed.base ?? null,
							snapshot: parsed.snapshot,
							activity: parsed.activity ?? null,
							commandKeys: parsed.commandKeys,
							state: "failed",
							coverageVersion: parsed.coverageVersion,
							coverage: parsed.coverage,
						},
					});
					this._recoveryCommandQueues.set(canonicalId, [command]);
				}
				this._failedWrites.set(canonicalId, {...structuredClone(parsed.snapshot), id: canonicalId});
				return structuredClone(parsed.snapshot);
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
		const canonicalId = this._canonicalIds.get(characterId) || characterId;
		const recovery = this._conflicts.get(canonicalId);
		if (!recovery) return null;
		if (choice === "server") {
			return this._pRunMutation(async () => {
				const queueEntry = this._getRecoveryCommandQueueEntry(canonicalId);
				this._persistRecoveryCommandQueue(canonicalId, {queue: [], isRequired: !!queueEntry?.queue.length});
				this._conflicts.delete(canonicalId);
				this._adoptServerConflictResolution({canonicalId, recovery});
				return this._getData(recovery.serverDocument);
			});
		}
		if (choice !== "local") throw new TypeError(`Conflict choice must be "local" or "server".`);
		const queueEntry = this._getRecoveryCommandQueueEntry(characterId);
		if (!queueEntry?.queue.length) {
			await this.pAcquireLease({characterId, isTakeover: true});
			this._conflicts.delete(characterId);
			this._accepted.set(characterId, recovery.serverDocument);
			this._syncCoverageToAccepted(characterId);
			return this.pUpsert({character: {...structuredClone(recovery.local), id: characterId}});
		}
		return this._pRunMutation(async () => {
			await this.pAcquireLease({characterId, isTakeover: true});
			const serverCoverage = this._getAcceptedCoverage(characterId);
			serverCoverage.revision = recovery.serverDocument.revision;
			const serverSequence = this._getOperationWatermark(characterId, recovery.serverDocument);
			if (Number.isInteger(serverSequence)) serverCoverage.acceptedSequence = serverSequence;
			const queueNxt = queueEntry.queue.map((command, index) => index
				? command
				: {
					...command,
					submittedBase: structuredClone(recovery.serverDocument.data),
					submittedBaseCoverage: serverCoverage,
					state: "pending",
				});
			const last = queueNxt.at(-1);
			this._persistRecoveryCommandQueue(characterId, {
				queue: queueNxt,
				isRequired: true,
			});
			this._conflicts.delete(characterId);
			this._accepted.set(characterId, recovery.serverDocument);
			this._syncCoverageToAccepted(characterId);
			return this._pDrainRecoveryCommandQueue({
				characterId,
				throughCommandKeys: last.commandKeys,
			});
		});
	}

	_adoptServerConflictResolution ({canonicalId, recovery}) {
		const serverDocument = structuredClone(recovery.serverDocument);
		this._accepted.set(canonicalId, serverDocument);
		this._latestSubmitted.set(canonicalId, structuredClone(serverDocument.data));
		this._recoveredBases.delete(canonicalId);
		const book = this._getCoverageBook(canonicalId);
		const coverage = recovery.coverage?.server
			? deserializeCoverage(recovery.coverage.server)
			: createCoverage();
		coverage.revision = serverDocument.revision;
		const acceptedSequence = this._getOperationWatermark(canonicalId, serverDocument);
		if (Number.isInteger(acceptedSequence)) {
			coverage.acceptedSequence = Math.max(coverage.acceptedSequence || 0, acceptedSequence);
		}
		book.acceptedOperationLegIds = coverage.appliedOperationLegIds.clone();
		book.live = this._cloneTrackCoverage(coverage);
		book.latestSubmitted = this._cloneTrackCoverage(coverage);
		book.recoveredBase = createCoverage();
		book.failedWrite = createCoverage();
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
