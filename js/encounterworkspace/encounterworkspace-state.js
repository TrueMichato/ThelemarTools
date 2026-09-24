import {getNpcTrackerCanonicalConditionName, getNpcTrackerConditionsAfterUpdate} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerHpAfterOperation} from "../dmscreen/npctracker/dmscreen-npctracker-hp.js";
import {
	getEncounterEffectTargets,
	validateEncounterAreaNote,
	validateEncounterModifier,
} from "./encounterworkspace-effects.js";

const STORAGE_KEY = "encounterWorkspaceState";
const PAGE = "encounterworkspace.html";
const VERSION = 4;
const MAX_INSTANCES = 1000;

const copy = value => JSON.parse(JSON.stringify(value));

function freezeSnapshot (value) {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
	Object.values(value).forEach(freezeSnapshot);
	return Object.freeze(value);
}

function getHpDefaults (monster) {
	const average = monster?.hp?.average;
	const max = typeof average === "number" && Number.isFinite(average) && average >= 0 && average <= Number.MAX_SAFE_INTEGER
		? average
		: null;
	return {current: max, max, temp: 0};
}

function isHpValue (value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validateHp (hp) {
	if (!hp || typeof hp !== "object" || !Object.hasOwn(hp, "current") || !Object.hasOwn(hp, "max")
		|| (hp.current != null && !isHpValue(hp.current))
		|| (hp.max != null && !isHpValue(hp.max)) || !isHpValue(hp.temp)) {
		throw new Error("The saved encounter contains invalid hit points. It has not been changed.");
	}
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
		return {version: VERSION, sourceList: null, instances: [], selectedIds: [], omissions: [], turn: {round: 0, activeId: null}};
	}

	static validate (raw) {
		if (!raw || ![1, 2, 3, VERSION].includes(raw.version)) throw new Error("This encounter save has an unsupported version. It has not been changed.");
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
				|| (raw.version >= 2 && (
					!Array.isArray(instance.conditions)
					|| instance.conditions.some(condition => typeof condition !== "string" || !getNpcTrackerCanonicalConditionName(condition))
				))
				|| (raw.version >= 3 && (!Array.isArray(instance.areaNotes) || !Array.isArray(instance.modifiers)))
			) throw new Error("The saved encounter contains an invalid monster instance. It has not been changed.");
			if (raw.version >= 3) {
				for (const [entries, validateEntry] of [
					[instance.areaNotes, validateEncounterAreaNote],
					[instance.modifiers, validateEncounterModifier],
				]) {
					const effectIds = new Set();
					for (const entry of entries) {
						validateEntry(entry);
						if (effectIds.has(entry.id)) throw new Error("The saved encounter contains duplicate area effects. It has not been changed.");
						effectIds.add(entry.id);
					}
				}
			}
			if (raw.version >= 4) {
				validateHp(instance.hp);
				if (instance.initiative !== null && !Number.isSafeInteger(instance.initiative)) {
					throw new Error("The saved encounter contains invalid initiative. It has not been changed.");
				}
			}
			ids.add(instance.id);
		}
		if (
			raw.selectedIds.some(id => !ids.has(id))
			|| new Set(raw.selectedIds).size !== raw.selectedIds.length
			|| raw.omissions.some(it => typeof it?.hash !== "string" || typeof it?.reason !== "string")
		) throw new Error("The saved encounter contains invalid targets or load notices. It has not been changed.");
		if (raw.version >= 4 && (
			!raw.turn
			|| !Number.isSafeInteger(raw.turn.round) || raw.turn.round < 0
			|| (raw.turn.round === 0 ? raw.turn.activeId !== null
				: !ids.has(raw.turn.activeId) || raw.instances.find(it => it.id === raw.turn.activeId)?.initiative == null)
		)) throw new Error("The saved encounter contains an invalid active turn. It has not been changed.");

		const state = copy(raw);
		state.version = VERSION;
		if (raw.version < 4) state.turn = {round: 0, activeId: null};
		state.instances.forEach(instance => {
			instance.conditions = raw.version === 1 ? [] : getNpcTrackerConditionsAfterUpdate({
				conditions: instance.conditions,
				condition: null,
				isAdd: true,
			});
			if (raw.version < 3) {
				instance.areaNotes = [];
				instance.modifiers = [];
			}
			if (raw.version < 4) {
				instance.hp = getHpDefaults(instance.monster);
				instance.initiative = null;
			}
			freezeSnapshot(instance.monster);
		});
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
					conditions: [],
					areaNotes: [],
					modifiers: [],
					hp: getHpDefaults(resolved.entity),
					initiative: null,
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

	static withConditions (state, {condition, isAdd, targetIds = state.selectedIds}) {
		const canonical = getNpcTrackerCanonicalConditionName(condition);
		if (!canonical) throw new Error("Choose a condition.");
		if (!targetIds.length) throw new Error("Select at least one monster.");
		const selected = new Set(targetIds);
		if (state.instances.filter(it => selected.has(it.id)).length !== selected.size) throw new Error("An encounter target no longer exists.");
		return this.validate({
			...state,
			instances: state.instances.map(instance => selected.has(instance.id)
				? {...instance, conditions: getNpcTrackerConditionsAfterUpdate({conditions: instance.conditions, condition: canonical, isAdd})}
				: instance),
		});
	}

	static withAreaNote (state, {note, noteId, isAdd, targetIds = state.selectedIds}) {
		const {eligibleIds} = getEncounterEffectTargets(state, {targetIds});
		if (isAdd) validateEncounterAreaNote(note);
		else if (typeof noteId !== "string" || !noteId) throw new Error("Choose an area note to remove.");
		const selected = new Set(eligibleIds);
		const changedIds = [];
		const next = this.validate({
			...state,
			instances: state.instances.map(instance => {
				if (!selected.has(instance.id)) return instance;
				const existing = instance.areaNotes || [];
				if (isAdd && existing.some(it => it.id === note.id)) throw new Error("This area note ID is already in use.");
				const areaNotes = isAdd ? [...existing, note] : existing.filter(it => it.id !== noteId);
				if (areaNotes.length !== existing.length) changedIds.push(instance.id);
				return {...instance, areaNotes};
			}),
		});
		return {state: next, changedIds};
	}

	static withModifier (state, {modifier, modifierId, isAdd, targetIds = state.selectedIds}) {
		if (isAdd) validateEncounterModifier(modifier);
		else if (typeof modifierId !== "string" || !modifierId) throw new Error("Choose a roll modifier to remove.");
		const {eligibleIds, skippedIds} = getEncounterEffectTargets(state, {
			targetIds,
			presetId: isAdd ? modifier.presetId : null,
		});
		const selected = new Set(eligibleIds);
		const changedIds = [];
		const next = this.validate({
			...state,
			instances: state.instances.map(instance => {
				if (!selected.has(instance.id)) return instance;
				const existing = instance.modifiers || [];
				let modifiers;
				if (isAdd && modifier.presetId) {
					modifiers = [...existing.filter(it => !it.presetId), modifier];
					if (existing.length !== modifiers.length || existing.some(it => it.presetId && it.presetId !== modifier.presetId)) changedIds.push(instance.id);
				} else if (isAdd) {
					if (existing.some(it => it.id === modifier.id)) throw new Error("This roll modifier ID is already in use.");
					modifiers = [...existing, modifier];
					changedIds.push(instance.id);
				} else {
					modifiers = existing.filter(it => it.id !== modifierId);
					if (modifiers.length !== existing.length) changedIds.push(instance.id);
				}
				return {...instance, modifiers};
			}),
		});
		return {state: next, changedIds, skippedIds};
	}

	static withHp (state, {id, prop, value}) {
		if (!["current", "max", "temp"].includes(prop) || (value !== null && !isHpValue(value)) || (prop === "temp" && value === null)) {
			throw new Error("Hit points must be a non-negative number; current and maximum may be left unset.");
		}
		if (!state.instances.some(it => it.id === id)) throw new Error("This encounter target no longer exists.");
		return this.validate({
			...state,
			instances: state.instances.map(instance => instance.id === id
				? {...instance, hp: {...instance.hp, [prop]: value}}
				: instance),
		});
	}

	static withHpOperation (state, {operation, targetIds = state.selectedIds}) {
		const {eligibleIds, skippedIds: missingIds} = getEncounterEffectTargets(state, {targetIds});
		if (!["delta", "set"].includes(operation?.mode) || !Number.isSafeInteger(operation.value)) {
			throw new Error("Choose a valid whole-number HP operation.");
		}
		const selected = new Set(eligibleIds);
		const changedIds = [];
		const snapshots = [];
		const skippedIds = [...missingIds];
		const next = this.validate({
			...state,
			instances: state.instances.map(instance => {
				if (!selected.has(instance.id)) return instance;
				if (instance.hp.max == null || (operation.mode === "delta" && instance.hp.current == null)) {
					skippedIds.push(instance.id);
					return instance;
				}
				const hp = getNpcTrackerHpAfterOperation({hp: instance.hp, operation});
				validateHp(hp);
				if (Object.keys(hp).every(prop => hp[prop] === instance.hp[prop])) return instance;
				changedIds.push(instance.id);
				snapshots.push({id: instance.id, before: {...instance.hp}, after: hp});
				return {...instance, hp};
			}),
		});
		return {state: next, changedIds, skippedIds, snapshots};
	}

	static withHpUndo (state, snapshots) {
		if (!Array.isArray(snapshots) || !snapshots.length) throw new Error("There is no HP operation to undo.");
		const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
		if (byId.size !== snapshots.length || snapshots.some(snapshot => {
			const instance = state.instances.find(it => it.id === snapshot.id);
			return !instance || Object.keys(instance.hp).some(prop => instance.hp[prop] !== snapshot.after?.[prop]);
		})) throw new Error("Hit points changed since this operation; it cannot be undone safely.");
		return this.validate({
			...state,
			instances: state.instances.map(instance => byId.has(instance.id)
				? {...instance, hp: {...byId.get(instance.id).before}}
				: instance),
		});
	}

	static getInitiativeOrder (state) {
		return state.instances.map((instance, order) => ({instance, order}))
			.filter(({instance}) => instance.initiative !== null)
			.sort((a, b) => b.instance.initiative - a.instance.initiative || a.order - b.order)
			.map(({instance}) => instance);
	}

	static withInitiative (state, {id, total}) {
		if (total !== null && !Number.isSafeInteger(total)) throw new Error("Initiative must be a whole number or unset.");
		if (!state.instances.some(it => it.id === id)) throw new Error("This encounter target no longer exists.");
		return this.withInitiativeResults(state, [{id, total}]);
	}

	static withInitiativeResults (state, results) {
		const ids = new Set(state.instances.map(it => it.id));
		const totals = new Map();
		for (const result of results) {
			if (!ids.has(result.id) || totals.has(result.id) || (result.total !== null && !Number.isSafeInteger(result.total))) {
				throw new Error("Initiative results contain an invalid encounter target or total.");
			}
			totals.set(result.id, result.total);
		}
		const turn = totals.get(state.turn.activeId) === null
			? {round: 0, activeId: null}
			: state.turn;
		return this.validate({
			...state,
			turn,
			instances: state.instances.map(instance => totals.has(instance.id)
				? {...instance, initiative: totals.get(instance.id)}
				: instance),
		});
	}

	static withTurn (state, action) {
		if (action === "reset") return this.validate({...state, turn: {round: 0, activeId: null}});
		const order = this.getInitiativeOrder(state);
		if (!order.length) throw new Error("Enter or roll initiative before starting turns.");
		if (action === "start") {
			if (state.turn.round !== 0) throw new Error("Reset turns before starting a new round.");
			return this.validate({...state, turn: {round: 1, activeId: order[0].id}});
		}
		if (action !== "next" || !state.turn.round) throw new Error("Start turns before advancing.");
		const index = order.findIndex(it => it.id === state.turn.activeId);
		if (index < 0) throw new Error("The active monster is no longer in initiative order.");
		const isWrap = index === order.length - 1;
		if (isWrap && !Number.isSafeInteger(state.turn.round + 1)) throw new Error("The round number cannot increase further.");
		return this.validate({
			...state,
			turn: {round: state.turn.round + Number(isWrap), activeId: order[isWrap ? 0 : index + 1].id},
		});
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
