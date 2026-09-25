import {getNpcTrackerCanonicalConditionName} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getEncounterInstanceLabels} from "./encounterworkspace-roll.js";
import {getEncounterEffectiveMonster} from "./encounterworkspace-state.js";

const STORAGE_KEY = "encounterWorkspaceInitiativeHandoffV1";
const LOCK_NAME = "encounterWorkspaceInitiativeHandoffV1";
const VERSION = 1;
const MAX_ENTRIES = 1000;

const copy = value => JSON.parse(JSON.stringify(value));
const isHpValue = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function getEncounterHandoffSnapshot ({state, id = CryptUtil.uid(), createdAt = new Date().toISOString()}) {
	if (!state?.sourceList) throw new Error("Choose a saved Bestiary list before queuing an encounter.");
	const selected = new Set(state.selectedIds);
	const instances = state.instances.filter(it => selected.has(it.id));
	if (!instances.length) throw new Error("Select at least one monster before queuing an encounter.");
	if (instances.length !== selected.size) throw new Error("Some selected monsters no longer exist; refresh the encounter.");
	const labels = getEncounterInstanceLabels(state.instances);
	const unrolled = instances.filter(it => !Number.isSafeInteger(it.initiative));
	if (unrolled.length) throw new Error(`Enter or roll initiative for ${unrolled.map(it => labels.get(it.id)).join(", ")} before queuing.`);

	return validateEncounterHandoffSnapshot({
		version: VERSION,
		id,
		createdAt,
		source: {name: state.sourceList.name, saveId: state.sourceList.saveId},
		entries: instances.map(it => ({
			instanceId: it.id,
			alias: labels.get(it.id),
			monster: copy(getEncounterEffectiveMonster(it)),
			hp: {...it.hp},
			conditions: [...it.conditions],
			initiative: it.initiative,
		})),
	});
}

export function validateEncounterHandoffSnapshot (raw) {
	if (!raw || raw.version !== VERSION) throw new Error("The queued encounter has an unsupported version. It was not changed.");
	if (
		typeof raw.id !== "string" || !raw.id.trim()
		|| typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))
		|| typeof raw.source?.name !== "string" || !raw.source.name.trim()
		|| typeof raw.source.saveId !== "string"
		|| !Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > MAX_ENTRIES
	) throw new Error("The queued encounter is incomplete. It was not changed.");

	const ids = new Set();
	for (const entry of raw.entries) {
		const hp = entry?.hp;
		if (
			typeof entry?.instanceId !== "string" || !entry.instanceId.trim() || ids.has(entry.instanceId)
			|| typeof entry.alias !== "string" || !entry.alias.trim()
			|| !entry.monster || Array.isArray(entry.monster) || typeof entry.monster !== "object"
			|| typeof entry.monster.name !== "string" || !entry.monster.name.trim()
			|| typeof entry.monster.source !== "string" || !entry.monster.source.trim()
			|| !hp || !Object.hasOwn(hp, "current") || !Object.hasOwn(hp, "max")
			|| (hp.current !== null && !isHpValue(hp.current))
			|| (hp.max !== null && !isHpValue(hp.max))
			|| !isHpValue(hp.temp)
			|| !Number.isSafeInteger(entry.initiative)
			|| !Array.isArray(entry.conditions)
			|| entry.conditions.some(condition => typeof condition !== "string" || !condition.trim()
				|| getNpcTrackerCanonicalConditionName(condition) !== condition)
			|| new Set(entry.conditions).size !== entry.conditions.length
		) throw new Error("The queued encounter contains an invalid monster, HP, condition, or initiative. It was not changed.");
		ids.add(entry.instanceId);
	}
	return copy(raw);
}

export function isEncounterHandoffImportedInBoardSave ({saved, id}) {
	return Object.values(saved?.sls || {}).some(slot =>
		[...(slot?.ps || []), ...(slot?.ex || [])].some(panel =>
			panel?.s?.ih?.includes(id) || panel?.a?.some(tab => tab?.s?.ih?.includes(id)),
		),
	);
}

export class EncounterWorkspaceHandoffStore {
	constructor ({storage = StorageUtil, locks = globalThis.navigator?.locks} = {}) {
		this._storage = storage;
		this._locks = locks;
	}

	async pRead () {
		const raw = await this._storage.pGet(STORAGE_KEY);
		return raw == null ? null : validateEncounterHandoffSnapshot(raw);
	}

	async pGetCorruptRecoveryToken () {
		const raw = await this._storage.pGet(STORAGE_KEY);
		if (raw == null) return null;
		try {
			validateEncounterHandoffSnapshot(raw);
			return null;
		} catch {
			return JSON.stringify(raw);
		}
	}

	async _pWithLock (fn) {
		if (!this._locks?.request) throw new Error("This browser cannot safely coordinate handoffs across tabs. Use a browser with Web Locks; the queue was not changed.");
		if (await this._storage.pIsAsyncFake?.()) throw new Error("Persistent browser storage is unavailable. The queue cannot survive a reload.");
		return this._locks.request(LOCK_NAME, {mode: "exclusive"}, fn);
	}

	async pQueue ({snapshot, pConfirmReplace}) {
		const valid = validateEncounterHandoffSnapshot(snapshot);
		return this._pWithLock(async () => {
			const pending = await this.pRead();
			if (pending?.id === valid.id) throw new Error("The queued encounter ID is already in use. Refresh before replacing it.");
			if (pending && !await pConfirmReplace(pending)) return {ok: false, reason: "cancelled"};
			await this._storage.pSet(STORAGE_KEY, valid);
			if ((await this.pRead())?.id !== valid.id) throw new Error("Could not verify the queued encounter. Check the pending handoff before retrying.");
			return {ok: true, snapshot: valid};
		});
	}

	async pClear ({expectedId}) {
		return this._pWithLock(async () => {
			const pending = await this.pRead();
			if (!pending || pending.id !== expectedId) throw new Error("The queued encounter changed in another tab. Refresh before clearing it.");
			await this._storage.pRemove(STORAGE_KEY);
			if (await this.pRead()) throw new Error("The queued encounter could not be cleared. Refresh before retrying.");
			return {ok: true};
		});
	}

	async pClearCorrupt ({expectedToken}) {
		return this._pWithLock(async () => {
			const raw = await this._storage.pGet(STORAGE_KEY);
			if (raw == null || JSON.stringify(raw) !== expectedToken) {
				throw new Error("The damaged queue changed in another tab. Refresh before clearing it.");
			}
			let isValid = true;
			try {
				validateEncounterHandoffSnapshot(raw);
			} catch { isValid = false; }
			if (isValid) throw new Error("The queue is now readable. Refresh it before clearing.");
			await this._storage.pRemove(STORAGE_KEY);
			if (await this._storage.pGet(STORAGE_KEY) != null) throw new Error("The damaged queue could not be cleared.");
			return {ok: true};
		});
	}

	async pImport ({expectedId, pAppend}) {
		return this._pWithLock(async () => {
			const pending = await this.pRead();
			if (!pending || pending.id !== expectedId) throw new Error("The queued encounter changed in another tab. Refresh before importing it.");
			const result = await pAppend(pending);
			if (!result.ok) return result;
			await this._storage.pRemove(STORAGE_KEY);
			if (await this.pRead()) throw new Error("Tracker rows were saved, but the queued encounter could not be cleared. Do not import it again.");
			return result;
		});
	}
}
