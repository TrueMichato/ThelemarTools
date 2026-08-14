import {ItemBuilderCore} from "./itembuilder-core.js";

const _STORAGE_KEY = "itemBuilderMakebrewHandoff";
const _VERSION = 1;

const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

export class ItemBuilderHandoff {
	static STORAGE_KEY = _STORAGE_KEY;
	static VERSION = _VERSION;

	static normalizeDraft (draft) {
		const out = ItemBuilderCore.normalizeDraft(draft);
		delete out.item.uniqueId;
		return out;
	}

	static async pStore ({draft, storage = StorageUtil}) {
		const normalized = this.normalizeDraft(draft);
		await storage.pSet(_STORAGE_KEY, {
			version: _VERSION,
			draft: normalized,
		});
		return _copy(normalized);
	}

	static async pConsume ({storage = StorageUtil} = {}) {
		let stored;
		try {
			stored = await storage.pGet(_STORAGE_KEY);
		} catch (error) {
			return {
				status: "error",
				message: `Could not read the Quick Forge handoff: ${error.message}`,
			};
		}

		if (stored == null) return {status: "empty"};

		let result;
		try {
			if (!stored || typeof stored !== "object" || Array.isArray(stored) || !stored.draft || typeof stored.draft !== "object" || Array.isArray(stored.draft)) {
				throw new Error("The stored draft is malformed.");
			}
			if (stored.version !== _VERSION) throw new Error(`Draft version ${stored.version ?? "unknown"} is not supported.`);
			result = {
				status: "success",
				draft: this.normalizeDraft(stored.draft),
			};
		} catch (error) {
			result = {
				status: "error",
				message: `Quick Forge handoff ignored. ${error.message} Return to the DM Screen and try Continue in Makebrew again.`,
			};
		}

		try {
			await storage.pRemove(_STORAGE_KEY);
		} catch (error) {
			return {
				status: "error",
				message: `Could not clear the Quick Forge handoff: ${error.message}`,
			};
		}

		return result;
	}
}
