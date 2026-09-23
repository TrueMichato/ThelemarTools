const STORAGE_KEY = "encounterWorkspaceState";
const PAGE = "encounterworkspace.html";
const VERSION = 1;
const MAX_INSTANCES = 1000;

const copy = value => JSON.parse(JSON.stringify(value));

function freezeSnapshot (value) {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
	Object.values(value).forEach(freezeSnapshot);
	return Object.freeze(value);
}

export async function pResolveSavedBestiaryItem (item) {
	const [resolved] = await ListUtil.pGetSublistEntities_fromHover({
		exportedSublist: {items: [item]},
		page: UrlUtil.PG_BESTIARY,
	});
	return resolved || null;
}

export class EncounterWorkspaceState {
	static getEmpty () {
		return {version: VERSION, sourceList: null, instances: [], selectedIds: [], omissions: []};
	}

	static validate (raw) {
		if (!raw || raw.version !== VERSION) throw new Error("This encounter save has an unsupported version. It has not been changed.");
		if (
			(raw.sourceList !== null && (typeof raw.sourceList?.name !== "string" || typeof raw.sourceList?.saveId !== "string"))
			|| !Array.isArray(raw.instances)
			|| !Array.isArray(raw.selectedIds)
			|| !Array.isArray(raw.omissions)
		) throw new Error("The saved encounter is incomplete. It has not been changed.");

		const ids = new Set();
		for (const instance of raw.instances) {
			if (
				typeof instance?.id !== "string" || !instance.id || ids.has(instance.id)
				|| typeof instance.hash !== "string"
				|| (instance.customHashId != null && typeof instance.customHashId !== "string")
				|| typeof instance.monster?.name !== "string"
				|| typeof instance.monster?.source !== "string"
			) throw new Error("The saved encounter contains an invalid monster instance. It has not been changed.");
			ids.add(instance.id);
		}
		if (
			raw.selectedIds.some(id => !ids.has(id))
			|| new Set(raw.selectedIds).size !== raw.selectedIds.length
			|| raw.omissions.some(it => typeof it?.hash !== "string" || typeof it?.reason !== "string")
		) throw new Error("The saved encounter contains invalid targets or load notices. It has not been changed.");

		const state = copy(raw);
		state.instances.forEach(instance => freezeSnapshot(instance.monster));
		return state;
	}

	static async pFromSavedList ({exportedSublist, pResolveItem = pResolveSavedBestiaryItem, fnUid = () => CryptUtil.uid()}) {
		if (typeof exportedSublist?.name !== "string" || !exportedSublist.name.trim()) {
			throw new Error("Choose a named saved Bestiary list.");
		}
		const items = exportedSublist.items ?? [];
		if (!Array.isArray(items)) throw new Error("The saved Bestiary list has an invalid roster.");

		const state = this.getEmpty();
		state.sourceList = {name: exportedSublist.name, saveId: exportedSublist.saveId || ""};
		const usedIds = new Set();

		for (const item of items) {
			const hash = typeof item?.h === "string" ? item.h : "";
			const count = item?.c == null ? 1 : Number(item.c);
			if (!hash || !Number.isSafeInteger(count) || count < 1 || state.instances.length + count > MAX_INSTANCES) {
				state.omissions.push({hash: hash || "(unknown)", reason: !hash ? "Missing creature reference" : `Invalid or unsupported count: ${item.c}`});
				continue;
			}

			let resolved;
			try {
				resolved = await pResolveItem(item);
			} catch (e) {
				state.omissions.push({hash, reason: e.message || "The creature could not be loaded"});
				continue;
			}
			if (!resolved?.entity?.name || !resolved.entity.source) {
				state.omissions.push({hash, reason: "Creature or source not available"});
				continue;
			}

			for (let ix = 0; ix < count; ix++) {
				const id = fnUid();
				if (typeof id !== "string" || !id || usedIds.has(id)) throw new Error("Could not create a unique encounter instance.");
				usedIds.add(id);
				state.instances.push({
					id,
					hash,
					customHashId: item.customHashId || item.customhashid || null,
					monster: freezeSnapshot(copy(resolved.entity)),
				});
				state.selectedIds.push(id);
			}
		}

		return state;
	}

	static withTarget (state, {id, isSelected}) {
		if (!state.instances.some(it => it.id === id)) throw new Error("This encounter target no longer exists.");
		const selectedIds = new Set(state.selectedIds);
		if (isSelected) selectedIds.add(id);
		else selectedIds.delete(id);
		return this.validate({...state, selectedIds: [...selectedIds]});
	}
}

export class EncounterWorkspaceStore {
	constructor ({storage = StorageUtil} = {}) { this._storage = storage; }

	async pLoad () {
		const raw = await this._storage.pGetForPage(STORAGE_KEY, {page: PAGE});
		return raw == null ? EncounterWorkspaceState.getEmpty() : EncounterWorkspaceState.validate(raw);
	}

	async pSave (state) {
		const valid = EncounterWorkspaceState.validate(state);
		await this._storage.pSetForPage(STORAGE_KEY, copy(valid), {page: PAGE});
		return valid;
	}

	async pReplace ({currentState, exportedSublist, pConfirm, pResolveItem, fnUid}) {
		if (currentState.sourceList && !await pConfirm()) return currentState;
		const next = await EncounterWorkspaceState.pFromSavedList({exportedSublist, pResolveItem, fnUid});
		return this.pSave(next);
	}
}
