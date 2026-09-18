import {CharacterSheetItemUtils} from "./charactersheet-item-utils.js";
import {CharacterSheetEntityTransfer} from "./charactersheet-entity-transfer.js";

export class CharacterSheetItemTransfer {
	static STORAGE_KEY = "charsheet-item-transfers";
	static CHANNEL_NAME = "charsheet-item-transfers";
	static _MAX_APPLIED_IDS = 100;
	static _transport = new CharacterSheetEntityTransfer({
		storageKey: this.STORAGE_KEY,
		channelName: this.CHANNEL_NAME,
		appliedIdsKey: "_appliedItemTransferIds",
		queueLabel: "item",
		maxAppliedIds: this._MAX_APPLIED_IDS,
		fnValidateQueuePayload: ({item}) => {
			if (!item?.name || !item?.source) throw new Error("The selected item is missing its name or source.");
		},
		fnBuildTransferData: ({item}) => ({
			item: MiscUtil.copyFast(item._compositionRaw || item),
		}),
		fnApplyTransfer: ({transfer, state}) => {
			if (!transfer.item?.name || !transfer.item?.source) throw new Error("Transfer item is missing its name or source.");
			const normalized = CharacterSheetItemUtils.getNormalizedCatalogItem({
				item: transfer.item,
				state,
			});
			state.addItem(normalized, 1, false, false);
		},
	});

	static get _pFallbackLock () {
		return CharacterSheetEntityTransfer._pFallbackLocks.get(this.STORAGE_KEY) || Promise.resolve();
	}

	static set _pFallbackLock (value) {
		CharacterSheetEntityTransfer._pFallbackLocks.set(this.STORAGE_KEY, value);
	}

	static getCharacterLabel (character) {
		return CharacterSheetEntityTransfer.getCharacterLabel(character);
	}

	static async pGetCharacters ({storage = StorageUtil} = {}) {
		return CharacterSheetEntityTransfer.pGetCharacters({storage});
	}

	static async pQueue ({characterId, item, storage = StorageUtil}) {
		return this._transport.pQueue({characterId, payload: {item}, storage});
	}

	static async pApplyPendingToState ({characterId, state, storage = StorageUtil}) {
		return this._transport.pApplyPendingToState({characterId, state, storage});
	}

	static async pAcknowledge ({transferIds, storage = StorageUtil, fnIsValid = null}) {
		return this._transport.pAcknowledge({transferIds, storage, fnIsValid});
	}

	static async pRemoveForCharacters ({characterIds, storage = StorageUtil}) {
		return this._transport.pRemoveForCharacters({characterIds, storage});
	}

	static subscribe (fnOnTransfer) {
		return this._transport.subscribe(fnOnTransfer);
	}

	static async _pGetTransfers ({storage}) {
		return this._transport._pGetTransfers({storage});
	}

	static async _pMutateTransfers ({storage, fnMutate, fnIsValid = null}) {
		return this._transport._pMutateTransfers({storage, fnMutate, fnIsValid});
	}

	static async _pWithLock (fn) {
		return this._transport._pWithLock(fn);
	}

	static _notify ({characterId}) {
		return this._transport._notify({characterId});
	}
}
