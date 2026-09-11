import {CharacterSheetItemUtils} from "./charactersheet-item-utils.js";

export class CharacterSheetItemTransfer {
	static STORAGE_KEY = "charsheet-item-transfers";
	static CHANNEL_NAME = "charsheet-item-transfers";
	static _MAX_APPLIED_IDS = 100;
	static _pFallbackLock = Promise.resolve();

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

	static async pQueue ({characterId, item, storage = StorageUtil}) {
		if (!characterId) throw new Error("Choose a character.");
		if (!item?.name || !item?.source) throw new Error("The selected item is missing its name or source.");

		const transfer = {
			id: CryptUtil.uid(),
			characterId,
			item: MiscUtil.copyFast(item._compositionRaw || item),
			createdAt: Date.now(),
		};

		await this._pWithLock(async () => {
			const characters = await this.pGetCharacters({storage});
			if (!characters.some(character => character?.id === characterId)) {
				throw new Error("That character no longer exists.");
			}

			const transfers = await this._pGetTransfers({storage});
			await storage.pSet(this.STORAGE_KEY, [...transfers, transfer]);
		});
		this._notify({characterId});
		return MiscUtil.copyFast(transfer);
	}

	static async pApplyPendingToState ({characterId, state, storage = StorageUtil}) {
		if (!characterId || !state) return {applied: [], acknowledgeIds: [], failed: []};
		const transfers = await this._pGetTransfers({storage});
		const pending = transfers.filter(transfer => transfer?.characterId === characterId);
		if (!pending.length) return {applied: [], acknowledgeIds: [], failed: []};

		const appliedIds = new Set(Array.isArray(state._data?._appliedItemTransferIds)
			? state._data._appliedItemTransferIds
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
				if (!transfer.item?.name || !transfer.item?.source) throw new Error("Transfer item is missing its name or source.");
				const normalized = CharacterSheetItemUtils.getNormalizedCatalogItem({
					item: transfer.item,
					state,
				});
				state.addItem(normalized, 1, false, false);
				appliedIds.add(transfer.id);
				acknowledgeIds.push(transfer.id);
				applied.push(transfer);
			} catch (error) {
				state.loadFromJson(snapshot);
				failed.push({transfer, error});
			}
		}

		state._data._appliedItemTransferIds = [...appliedIds].slice(-this._MAX_APPLIED_IDS);
		return {
			applied,
			acknowledgeIds,
			failed,
		};
	}

	static async pAcknowledge ({transferIds, storage = StorageUtil}) {
		const ids = new Set(transferIds || []);
		if (!ids.size) return;
		await this._pMutateTransfers({
			storage,
			fnMutate: transfers => transfers.filter(transfer => !ids.has(transfer?.id)),
		});
	}

	static async pRemoveForCharacters ({characterIds, storage = StorageUtil}) {
		const ids = new Set(characterIds || []);
		if (!ids.size) return;
		await this._pMutateTransfers({
			storage,
			fnMutate: transfers => transfers.filter(transfer => !ids.has(transfer?.characterId)),
		});
	}

	static subscribe (fnOnTransfer) {
		if (typeof BroadcastChannel === "undefined") return () => {};
		const channel = new BroadcastChannel(this.CHANNEL_NAME);
		channel.addEventListener("message", event => {
			if (event.data?.type !== "queued") return;
			fnOnTransfer(event.data);
		});
		return () => channel.close();
	}

	static async _pGetTransfers ({storage}) {
		const transfers = await storage.pGet(this.STORAGE_KEY);
		if (transfers == null) return [];
		if (!Array.isArray(transfers)) throw new Error("The item transfer queue is malformed.");
		return transfers;
	}

	static async _pMutateTransfers ({storage, fnMutate}) {
		return this._pWithLock(async () => {
			const transfers = await this._pGetTransfers({storage});
			const next = fnMutate(transfers);
			await storage.pSet(this.STORAGE_KEY, next);
			return next;
		});
	}

	static async _pWithLock (fn) {
		if (globalThis.navigator?.locks?.request) {
			return navigator.locks.request(this.STORAGE_KEY, fn);
		}

		const previous = this._pFallbackLock;
		let unlock;
		this._pFallbackLock = new Promise(resolve => { unlock = resolve; });
		await previous;
		try {
			return await fn();
		} finally {
			unlock();
		}
	}

	static _notify ({characterId}) {
		if (typeof BroadcastChannel === "undefined") return;
		const channel = new BroadcastChannel(this.CHANNEL_NAME);
		channel.postMessage({type: "queued", characterId});
		channel.close();
	}
}
