import {HubApiClient} from "./hub-api-client.js";
import {diffJson, rebaseJsonChanges} from "./hub-json-patch.js";
import {HubBroadcastSync} from "./hub-broadcast-sync.js";

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
		const recovery = this._failedWrites.get(characterId) || this.getPendingRecovery(characterId);
		if (recovery) {
			this._failedWrites.set(characterId, recovery);
			return {...structuredClone(recovery), id: canonicalId};
		}
		return this._getData(character);
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

	_migrateCharacterIdentity ({fromId, toId}) {
		if (fromId === toId) return;
		this._canonicalIds.set(fromId, toId);
		for (const map of [this._failedWrites, this._failedCommands, this._latestSubmitted, this._recoveredBases]) {
			if (!map.has(fromId)) continue;
			map.set(toId, map.get(fromId));
			map.delete(fromId);
		}
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
		this._recoveredBases.delete(requestedId);
		this._latestSubmitted.set(requestedId, structuredClone(submittedSnapshot));
		this._pendingWrites++;
		try {
			this._recoveryStorage?.setItem(recoveryKey, JSON.stringify({
				version: recoveryVersion,
				base: submittedBase,
				snapshot: submittedSnapshot,
				commandKeys,
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
			if (!patches.length) return this._getData(accepted);
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
