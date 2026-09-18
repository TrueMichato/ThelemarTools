export class CharacterSheetEntityTransfer {
	static _pFallbackLocks = new Map();

	constructor ({
		storageKey,
		channelName,
		appliedIdsKey,
		queueLabel,
		fnValidateQueuePayload,
		fnBuildTransferData,
		fnApplyTransfer,
		maxAppliedIds = 100,
	}) {
		this.storageKey = storageKey;
		this.channelName = channelName;
		this.appliedIdsKey = appliedIdsKey;
		this.queueLabel = queueLabel;
		this.fnValidateQueuePayload = fnValidateQueuePayload;
		this.fnBuildTransferData = fnBuildTransferData;
		this.fnApplyTransfer = fnApplyTransfer;
		this.maxAppliedIds = maxAppliedIds;
	}

	static getCharacterLabel (character) {
		const name = character?.name || "Unnamed Character";
		const classes = (character?.classes || []).filter(it => it?.name);
		if (!classes.length) return name;
		const totalLevel = classes.reduce((sum, it) => sum + (Number(it.level) || 0), 0);
		return `${name} — ${classes.map(it => it.name).join("/")} ${totalLevel}`;
	}

	static async pGetCharacters ({storage = StorageUtil} = {}) {
		const characters = await storage.pGet("charsheet-characters");
		if (characters == null) return [];
		if (!Array.isArray(characters)) throw new Error("Saved character data is malformed.");
		return characters;
	}

	async pQueue ({characterId, payload, storage = StorageUtil}) {
		if (!characterId) throw new Error("Choose a character.");
		this.fnValidateQueuePayload(payload);

		const transfer = {
			id: CryptUtil.uid(),
			characterId,
			...this.fnBuildTransferData(payload),
			createdAt: Date.now(),
		};

		await this._pWithLock(async () => {
			const characters = await CharacterSheetEntityTransfer.pGetCharacters({storage});
			if (!characters.some(character => character?.id === characterId)) {
				throw new Error("That character no longer exists.");
			}

			const transfers = await this._pGetTransfers({storage});
			await storage.pSet(this.storageKey, [...transfers, transfer]);
		});
		this._notify({characterId});
		return MiscUtil.copyFast(transfer);
	}

	async pApplyPendingToState ({characterId, state, storage = StorageUtil}) {
		if (!characterId || !state) return {applied: [], acknowledgeIds: [], failed: []};
		const transfers = await this._pGetTransfers({storage});
		const pending = transfers.filter(transfer => transfer?.characterId === characterId);
		if (!pending.length) return {applied: [], acknowledgeIds: [], failed: []};

		const appliedIds = new Set(Array.isArray(state._data?.[this.appliedIdsKey])
			? state._data[this.appliedIdsKey]
			: []);
		const applied = [];
		const acknowledgeIds = [];
		const failed = [];

		for (const transfer of pending) {
			if (!transfer?.id) {
				failed.push({transfer, error: new Error("Transfer is missing its ID.")});
				continue;
			}
			if (appliedIds.has(transfer.id)) {
				acknowledgeIds.push(transfer.id);
				continue;
			}

			const snapshot = state.toJson();
			try {
				await this.fnApplyTransfer({transfer, state});
				appliedIds.add(transfer.id);
				acknowledgeIds.push(transfer.id);
				applied.push(transfer);
			} catch (error) {
				state.loadFromJson(snapshot);
				failed.push({transfer, error});
			}
		}

		state._data[this.appliedIdsKey] = [...appliedIds].slice(-this.maxAppliedIds);
		return {
			applied,
			acknowledgeIds,
			failed,
		};
	}

	async pAcknowledge ({transferIds, storage = StorageUtil, fnIsValid = null}) {
		const ids = new Set(transferIds || []);
		if (!ids.size) return true;
		if (fnIsValid && !fnIsValid()) return false;
		return this._pMutateTransfers({
			storage,
			fnMutate: transfers => transfers.filter(transfer => !ids.has(transfer?.id)),
			fnIsValid,
		});
	}

	async pRemoveForCharacters ({characterIds, storage = StorageUtil}) {
		const ids = new Set(characterIds || []);
		if (!ids.size) return;
		await this._pMutateTransfers({
			storage,
			fnMutate: transfers => transfers.filter(transfer => !ids.has(transfer?.characterId)),
		});
	}

	subscribe (fnOnTransfer) {
		if (typeof BroadcastChannel === "undefined") return () => {};
		const channel = new BroadcastChannel(this.channelName);
		channel.addEventListener("message", event => {
			if (event.data?.type !== "queued") return;
			fnOnTransfer(event.data);
		});
		return () => channel.close();
	}

	async _pGetTransfers ({storage}) {
		const transfers = await storage.pGet(this.storageKey);
		if (transfers == null) return [];
		if (!Array.isArray(transfers)) throw new Error(`The ${this.queueLabel} transfer queue is malformed.`);
		return transfers;
	}

	async _pMutateTransfers ({storage, fnMutate, fnIsValid = null}) {
		return this._pWithLock(async () => {
			if (fnIsValid && !fnIsValid()) return false;
			const transfers = await this._pGetTransfers({storage});
			if (fnIsValid && !fnIsValid()) return false;
			const next = fnMutate(transfers);
			await storage.pSet(this.storageKey, next);
			return true;
		});
	}

	async _pWithLock (fn) {
		if (globalThis.navigator?.locks?.request) {
			return navigator.locks.request(this.storageKey, fn);
		}

		const previous = CharacterSheetEntityTransfer._pFallbackLocks.get(this.storageKey) || Promise.resolve();
		let unlock;
		CharacterSheetEntityTransfer._pFallbackLocks.set(this.storageKey, new Promise(resolve => { unlock = resolve; }));
		await previous;
		try {
			return await fn();
		} finally {
			unlock();
		}
	}

	_notify ({characterId}) {
		if (typeof BroadcastChannel === "undefined") return;
		const channel = new BroadcastChannel(this.channelName);
		channel.postMessage({type: "queued", characterId});
		channel.close();
	}
}
