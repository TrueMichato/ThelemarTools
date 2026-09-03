import {applyJsonPatch, copyJson, diffJson, rebaseJsonChanges} from "./hub-json-patch.js";
import {withRootCarryWrite} from "./hub-carry-authority.js";

export class HubRepositoryError extends Error {
	constructor (code, message, details = {}) {
		super(message);
		this.name = "HubRepositoryError";
		this.code = code;
		this.details = details;
	}
}

function requireString (value, label) {
	if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
}

function getMutationId () {
	if (!globalThis.crypto?.randomUUID) throw new Error(`crypto.randomUUID is required for hub mutation IDs.`);
	return globalThis.crypto.randomUUID();
}

export class LocalCharacterRepository {
	static STORAGE_KEY = "charsheet-characters";
	static _MUTATION_QUEUES = new Map();
	isRescueMirrorEnabled = true;

	constructor ({storage, storageKey = LocalCharacterRepository.STORAGE_KEY}) {
		if (!storage?.pGet || !storage?.pSet) throw new TypeError(`A StorageUtil-compatible backend is required.`);
		this._storage = storage;
		this._storageKey = storageKey;
	}

	async pList () {
		return copyJson(await this._storage.pGet(this._storageKey) || []);
	}

	async pGet ({characterId}) {
		requireString(characterId, "characterId");
		return (await this.pList()).find(character => character.id === characterId) || null;
	}

	async pUpsert ({character}) {
		requireString(character?.id, "character.id");
		return this._pMutate(async () => {
			const characters = await this.pList();
			const ix = characters.findIndex(it => it.id === character.id);
			if (~ix) characters[ix] = copyJson(character);
			else characters.push(copyJson(character));
			await this._storage.pSet(this._storageKey, characters);
			return copyJson(character);
		});
	}

	async pDelete ({characterId}) {
		requireString(characterId, "characterId");
		return !!await this.pDeleteMany({characterIds: [characterId]});
	}

	async pDeleteMany ({characterIds}) {
		if (!Array.isArray(characterIds)) throw new TypeError(`characterIds must be an array.`);
		const ids = new Set(characterIds);
		ids.forEach(characterId => requireString(characterId, "characterId"));
		return this._pMutate(async () => {
			const characters = await this.pList();
			const nxt = characters.filter(character => !ids.has(character.id));
			await this._storage.pSet(this._storageKey, nxt);
			return characters.length - nxt.length;
		});
	}

	async _pMutate (fnMutate) {
		const lockName = `5etools-character-roster::${this._storageKey}`;
		if (globalThis.navigator?.locks?.request) return navigator.locks.request(lockName, fnMutate);

		const prior = this.constructor._MUTATION_QUEUES.get(lockName) || Promise.resolve();
		let doRelease;
		const current = new Promise(resolve => doRelease = resolve);
		this.constructor._MUTATION_QUEUES.set(lockName, current);
		await prior;
		try {
			return await fnMutate();
		} finally {
			doRelease();
			if (this.constructor._MUTATION_QUEUES.get(lockName) === current) {
				this.constructor._MUTATION_QUEUES.delete(lockName);
			}
		}
	}
}

export class HubCharacterMemoryAuthority {
	constructor ({fnNow = () => Date.now(), leaseTtlMs = 30_000} = {}) {
		this._fnNow = fnNow;
		this._leaseTtlMs = leaseTtlMs;
		this._characters = new Map();
		this._leases = new Map();
		this._mutationResults = new Map();
		this._events = [];
		this._outbox = [];
		this._eventSequence = 0;
	}

	_getCharacterOrThrow (characterId) {
		const character = this._characters.get(characterId);
		if (!character) throw new HubRepositoryError("NOT_FOUND", `Character "${characterId}" was not found.`);
		return character;
	}

	_getMutationKey ({characterId, mutationId}) {
		requireString(mutationId, "mutationId");
		return `${characterId}::${mutationId}`;
	}

	_getPriorMutation ({characterId, mutationId}) {
		return this._mutationResults.get(this._getMutationKey({characterId, mutationId}));
	}

	_commitMutation ({character, actorId, mutationId, eventType, payload}) {
		const event = {
			sequence: ++this._eventSequence,
			characterId: character.id,
			campaignId: character.campaignId,
			actorId,
			type: eventType,
			revision: character.revision,
			payload: copyJson(payload),
		};
		const result = {character: copyJson(character), event: copyJson(event)};
		this._events.push(event);
		this._outbox.push({...copyJson(event), status: "pending"});
		this._mutationResults.set(this._getMutationKey({characterId: character.id, mutationId}), result);
		return copyJson(result);
	}

	createCharacter ({characterId, ownerId, campaignId = null, data, mutationId}) {
		requireString(characterId, "characterId");
		requireString(ownerId, "ownerId");
		const prior = this._getPriorMutation({characterId, mutationId});
		if (prior) return copyJson(prior);
		if (this._characters.has(characterId)) throw new HubRepositoryError("ALREADY_EXISTS", `Character "${characterId}" already exists.`);

		const character = {
			id: characterId,
			ownerId,
			campaignId,
			revision: 1,
			data: copyJson(data),
		};
		this._characters.set(characterId, character);
		return this._commitMutation({
			character,
			actorId: ownerId,
			mutationId,
			eventType: "character.created",
			payload: {revision: character.revision},
		});
	}

	getCharacter ({characterId}) {
		return copyJson(this._getCharacterOrThrow(characterId));
	}

	listCharacters ({ownerId = null, campaignId = null} = {}) {
		return [...this._characters.values()]
			.filter(character => ownerId == null || character.ownerId === ownerId)
			.filter(character => campaignId == null || character.campaignId === campaignId)
			.map(copyJson);
	}

	acquireLease ({characterId, sessionId, isTakeover = false}) {
		requireString(sessionId, "sessionId");
		this._getCharacterOrThrow(characterId);
		const now = this._fnNow();
		const current = this._leases.get(characterId);
		const isCurrentActive = current && current.expiresAt > now;

		if (isCurrentActive && current.sessionId !== sessionId && !isTakeover) {
			throw new HubRepositoryError("LEASE_HELD", `Character "${characterId}" is being edited by another session.`, {
				expiresAt: current.expiresAt,
			});
		}

		const isSameHolder = isCurrentActive && current.sessionId === sessionId;
		const lease = {
			characterId,
			sessionId,
			epoch: isSameHolder ? current.epoch : (current?.epoch || 0) + 1,
			expiresAt: now + this._leaseTtlMs,
		};
		this._leases.set(characterId, lease);
		return copyJson(lease);
	}

	renewLease ({characterId, sessionId, leaseEpoch}) {
		const lease = this._getValidatedLease({characterId, sessionId, leaseEpoch});
		lease.expiresAt = this._fnNow() + this._leaseTtlMs;
		return copyJson(lease);
	}

	_getValidatedLease ({characterId, sessionId, leaseEpoch}) {
		const lease = this._leases.get(characterId);
		if (!lease || lease.expiresAt <= this._fnNow()) {
			throw new HubRepositoryError("LEASE_EXPIRED", `The character edit lease has expired.`);
		}
		if (lease.sessionId !== sessionId || lease.epoch !== leaseEpoch) {
			throw new HubRepositoryError("LEASE_FENCED", `This editor no longer owns the character lease.`, {
				currentEpoch: lease.epoch,
			});
		}
		return lease;
	}

	writeCharacterPatch ({
		characterId,
		sessionId,
		leaseEpoch,
		baseRevision,
		patches,
		mutationId,
	}) {
		const prior = this._getPriorMutation({characterId, mutationId});
		if (prior) return copyJson(prior);
		this._getValidatedLease({characterId, sessionId, leaseEpoch});
		const current = this._getCharacterOrThrow(characterId);
		if (current.revision !== baseRevision) {
			throw new HubRepositoryError("REVISION_CONFLICT", `Character revision has changed.`, {
				expected: baseRevision,
				actual: current.revision,
				character: copyJson(current),
			});
		}

		const nxtData = applyJsonPatch(current.data, patches);
		const nxt = {...current, revision: current.revision + 1, data: nxtData};
		this._characters.set(characterId, nxt);
		return this._commitMutation({
			character: nxt,
			actorId: current.ownerId,
			mutationId,
			eventType: "character.patched",
			payload: {patches},
		});
	}

	applyServerPatch ({
		characterId,
		actorId,
		baseRevision,
		patches,
		mutationId,
		eventType,
	}) {
		requireString(actorId, "actorId");
		requireString(eventType, "eventType");
		const prior = this._getPriorMutation({characterId, mutationId});
		if (prior) return copyJson(prior);
		const current = this._getCharacterOrThrow(characterId);
		if (current.revision !== baseRevision) {
			throw new HubRepositoryError("REVISION_CONFLICT", `Character revision has changed.`, {
				expected: baseRevision,
				actual: current.revision,
				character: copyJson(current),
			});
		}

		const nxt = {
			...current,
			revision: current.revision + 1,
			data: applyJsonPatch(current.data, patches),
		};
		this._characters.set(characterId, nxt);
		return this._commitMutation({character: nxt, actorId, mutationId, eventType, payload: {patches}});
	}

	deleteCharacter ({characterId, actorId, mutationId}) {
		requireString(actorId, "actorId");
		const prior = this._getPriorMutation({characterId, mutationId});
		if (prior) return copyJson(prior);
		const current = this._getCharacterOrThrow(characterId);
		const tombstone = {...current, revision: current.revision + 1};
		const result = this._commitMutation({
			character: tombstone,
			actorId,
			mutationId,
			eventType: "character.deleted",
			payload: {},
		});
		this._characters.delete(characterId);
		this._leases.delete(characterId);
		return result;
	}

	getEvents () {
		return copyJson(this._events);
	}

	getOutbox () {
		return copyJson(this._outbox);
	}
}

export class HubCharacterRepository {
	isRescueMirrorEnabled = false;

	constructor ({
		authority,
		sessionId,
		ownerId = null,
		campaignId = null,
		fnGetMutationId = null,
	}) {
		if (!authority) throw new TypeError(`authority is required.`);
		requireString(sessionId, "sessionId");
		if (ownerId != null) requireString(ownerId, "ownerId");
		this._authority = authority;
		this._sessionId = sessionId;
		this._ownerId = ownerId;
		this._campaignId = campaignId;
		this._fnGetMutationId = fnGetMutationId || getMutationId;
		this._pMutationQueue = Promise.resolve();
		this._accepted = new Map();
		this._leases = new Map();
	}

	_getData (character) {
		return {...copyJson(character.data), id: character.id};
	}

	async pList () {
		return this._authority
			.listCharacters({ownerId: this._ownerId, campaignId: this._campaignId})
			.map(character => this._getData(character));
	}

	pGet ({characterId}) {
		const character = this._authority.getCharacter({characterId});
		this._accepted.set(characterId, character);
		return Promise.resolve(this._getData(character));
	}

	pAcquireLease ({characterId, isTakeover = false}) {
		const lease = this._authority.acquireLease({characterId, sessionId: this._sessionId, isTakeover});
		this._leases.set(characterId, lease);
		return Promise.resolve(lease);
	}

	_pRunMutation (fnMutate) {
		const pResult = this._pMutationQueue.then(fnMutate, fnMutate);
		this._pMutationQueue = pResult.catch(() => {});
		return pResult;
	}

	pSaveSnapshot (opts) {
		return this._pRunMutation(() => this._pSaveSnapshot(opts));
	}

	async _pSaveSnapshot ({characterId, snapshot, mutationId}) {
		let accepted = this._accepted.get(characterId);
		if (!accepted) throw new HubRepositoryError("NOT_LOADED", `Load the character before saving.`);
		let lease = this._leases.get(characterId);
		if (!lease) throw new HubRepositoryError("LEASE_REQUIRED", `Acquire the character lease before saving.`);
		try {
			lease = this._authority.renewLease({
				characterId,
				sessionId: this._sessionId,
				leaseEpoch: lease.epoch,
			});
			this._leases.set(characterId, lease);
		} catch (error) {
			if (!(error instanceof HubRepositoryError) || error.code !== "LEASE_EXPIRED") throw error;
			const canonical = this._authority.getCharacter({characterId});
			const rebased = rebaseJsonChanges({base: accepted.data, local: snapshot, remote: canonical.data});
			if (rebased.isConflict) {
				throw new HubRepositoryError("REVISION_CONFLICT", `Character changed while the edit lease was expired.`, {
					actual: canonical.revision,
					character: canonical,
					conflicts: rebased.conflicts,
				});
			}
			lease = this._authority.acquireLease({characterId, sessionId: this._sessionId});
			this._leases.set(characterId, lease);
			this._accepted.set(characterId, canonical);
			accepted = canonical;
			snapshot = rebased.document;
		}
		const patches = withRootCarryWrite({patches: diffJson(accepted.data, snapshot), document: snapshot, base: accepted.data});
		if (!patches.length) return {character: copyJson(accepted), event: null};
		const result = this._authority.writeCharacterPatch({
			characterId,
			sessionId: this._sessionId,
			leaseEpoch: lease.epoch,
			baseRevision: accepted.revision,
			patches,
			mutationId: mutationId || this._fnGetMutationId(),
		});
		this._accepted.set(characterId, result.character);
		return result;
	}

	pUpsert (opts) {
		return this._pRunMutation(() => this._pUpsert(opts));
	}

	async _pUpsert ({character, mutationId = null}) {
		requireString(character?.id, "character.id");
		let accepted = this._accepted.get(character.id);
		if (!accepted) {
			try {
				await this.pGet({characterId: character.id});
				accepted = this._accepted.get(character.id);
			} catch (error) {
				if (!(error instanceof HubRepositoryError) || error.code !== "NOT_FOUND") throw error;
				if (!this._ownerId) throw new HubRepositoryError("OWNER_REQUIRED", `ownerId is required to create a cloud character.`);
				const result = this._authority.createCharacter({
					characterId: character.id,
					ownerId: this._ownerId,
					campaignId: this._campaignId,
					data: copyJson(character),
					mutationId: mutationId || this._fnGetMutationId(),
				});
				this._accepted.set(character.id, result.character);
				return this._getData(result.character);
			}
		}

		if (!this._leases.has(character.id)) await this.pAcquireLease({characterId: character.id});
		const result = await this._pSaveSnapshot({
			characterId: character.id,
			snapshot: character,
			mutationId: mutationId || this._fnGetMutationId(),
		});
		return this._getData(result.character);
	}

	pDelete (opts) {
		return this._pRunMutation(() => this._pDelete(opts));
	}

	async _pDelete ({characterId, mutationId = null}) {
		const result = this._authority.deleteCharacter({
			characterId,
			actorId: this._ownerId || this._sessionId,
			mutationId: mutationId || this._fnGetMutationId(),
		});
		this._accepted.delete(characterId);
		this._leases.delete(characterId);
		return !!result;
	}

	async pDeleteMany ({characterIds}) {
		if (!Array.isArray(characterIds)) throw new TypeError(`characterIds must be an array.`);
		let count = 0;
		for (const characterId of characterIds) {
			if (await this.pDelete({characterId})) count++;
		}
		return count;
	}
}
