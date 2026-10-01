import {getNpcTrackerCanonicalConditionName, getNpcTrackerConditionsAfterUpdate} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerHpAfterOperation} from "../dmscreen/npctracker/dmscreen-npctracker-hp.js";
import {BestiaryQuickActionsEngine, BestiaryQuickActionsOperationTypes} from "../bestiary/bestiary-quick-actions-engine.js";
import {
	getEncounterEffectTargets,
	getEncounterIsLegacyPresetId,
	getEncounterModifierForPreset,
	validateEncounterAreaNote,
	validateEncounterModifier,
} from "./encounterworkspace-effects.js";
import {getEncounterResourceDefaults, validateEncounterResources} from "./encounterworkspace-resources.js";
import {getEncounterDamageForMonster} from "./encounterworkspace-damage.js";

const STORAGE_KEY = "encounterWorkspaceState";
const PAGE = "encounterworkspace.html";
const VERSION = 7;
const MAX_INSTANCES = 1000;
export const MAX_ENCOUNTER_STATBLOCK_OPERATIONS = 100;
const MAX_OPERATION_SIZE = 200_000;

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

const isRecord = value => value && typeof value === "object" && !Array.isArray(value);

export function validateEncounterStatblockOperations (monster, operations) {
	if (!Array.isArray(operations) || operations.length > MAX_ENCOUNTER_STATBLOCK_OPERATIONS) {
		throw new Error("The saved encounter contains an invalid statblock history. It has not been changed.");
	}
	const ids = new Set();
	for (const operation of operations) {
		let serialized;
		try { serialized = JSON.stringify(operation); } catch { /* Rejected below. */ }
		if (!isRecord(operation) || typeof operation.id !== "string" || !operation.id.trim()
				|| ids.has(operation.id) || !serialized || serialized.length > MAX_OPERATION_SIZE
				|| !Object.values(BestiaryQuickActionsOperationTypes).includes(operation.type)
				|| (operation.type === "patch" && !isRecord(operation.patch ?? operation.data?.patch))
				|| (operation.type === "addEntry" && !isRecord(operation.data?.entry))
				|| (operation.type === "applyAreaTrait" && !isRecord(operation.data?.entry))
				|| (operation.type === "applyItem" && (!isRecord(operation.data) || !isRecord(operation.data.patch)))
				|| (operation.type === "setLegendaryGroup" && !isRecord(operation.legendaryGroup ?? operation.data?.legendaryGroup))) {
			throw new Error("The saved encounter contains an invalid statblock operation. It has not been changed.");
		}
		ids.add(operation.id);
	}
	try {
		BestiaryQuickActionsEngine.applyOperations({monster, operations});
	} catch (e) {
		throw new Error(`The saved encounter contains an invalid statblock edit: ${e.message}. It has not been changed.`, {cause: e});
	}
}

export function getEncounterEffectiveMonster (instance) {
	return instance.statblockOperations?.length
		? BestiaryQuickActionsEngine.applyOperations({monster: instance.monster, operations: instance.statblockOperations})
		: instance.monster;
}

function getStatblockKey (instance) {
	const normalize = value => Array.isArray(value) ? value.map(normalize)
		: isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))
			: value;
	return JSON.stringify(normalize(getEncounterEffectiveMonster(instance)));
}

export function getEncounterViewGroups (state) {
	const byId = new Map(state.instances.map(it => [it.id, it]));
	const claimed = new Set(state.groups.flatMap(it => it.memberIds));
	const excluded = new Set(state.ungroupedIds);
	const groups = [];
	const implicit = new Map();
	const explicit = new Set();
	for (const instance of state.instances) {
		if (claimed.has(instance.id)) {
			const group = state.groups.find(it => it.memberIds.includes(instance.id));
			if (!explicit.has(group.id)) {
				groups.push({...group, isExplicit: true});
				explicit.add(group.id);
			}
			continue;
		}
		if (excluded.has(instance.id)) {
			groups.push({id: `view:${instance.id}`, memberIds: [instance.id], isExplicit: false});
			continue;
		}
		const key = getStatblockKey(instance);
		let group = implicit.get(key);
		if (!group) {
			group = {id: `view:${instance.id}`, memberIds: [], isExplicit: false};
			implicit.set(key, group);
			groups.push(group);
		}
		group.memberIds.push(instance.id);
	}
	return groups.map(group => ({...group, members: group.memberIds.map(id => byId.get(id))}));
}

export function getEncounterSharedGroup (state, id) {
	return state.groups.find(group => group.sharedTurn && (group.id === id || group.memberIds.includes(id)));
}

export function getEncounterCompatibleGroups (state, id) {
	const instance = state.instances.find(it => it.id === id);
	if (!instance) throw new Error("This encounter monster no longer exists.");
	const key = getStatblockKey(instance);
	return state.groups.filter(group => getStatblockKey(state.instances.find(it => it.id === group.memberIds[0])) === key);
}

export function getEncounterInitiativeTotal (state, instance) {
	const group = getEncounterSharedGroup(state, instance.id);
	return group ? group.initiative : instance.initiative;
}

function getTurnAfterGroupRemoval (state, group) {
	if (state.turn.activeId !== group.id) return state.turn;
	const next = group.memberIds.map(id => state.instances.find(it => it.id === id))
		.find(instance => instance?.initiative != null);
	return next ? {...state.turn, activeId: next.id} : {round: 0, activeId: null};
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
		return {version: VERSION, sourceList: null, instances: [], selectedIds: [], omissions: [], groups: [], ungroupedIds: [], turn: {round: 0, activeId: null}};
	}

	static validate (raw) {
		if (!raw || ![1, 2, 3, 4, 5, 6, VERSION].includes(raw.version)) throw new Error("This encounter save has an unsupported version. It has not been changed.");
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
			if (raw.version >= 5) validateEncounterStatblockOperations(instance.monster, instance.statblockOperations);
			if (raw.version >= 7) validateEncounterResources(instance.resources);
			ids.add(instance.id);
		}
		if (
			raw.selectedIds.some(id => !ids.has(id))
			|| new Set(raw.selectedIds).size !== raw.selectedIds.length
			|| raw.omissions.some(it => typeof it?.hash !== "string" || typeof it?.reason !== "string")
		) throw new Error("The saved encounter contains invalid targets or load notices. It has not been changed.");
		if (raw.version >= 6) {
			if (!Array.isArray(raw.groups) || !Array.isArray(raw.ungroupedIds)) {
				throw new Error("The saved encounter contains invalid groups. It has not been changed.");
			}
			const groupIds = new Set();
			const members = new Set();
			for (const group of raw.groups) {
				if (!isRecord(group) || typeof group.id !== "string" || !group.id.trim() || group.id.startsWith("view:")
					|| ids.has(group.id) || groupIds.has(group.id)
					|| !Array.isArray(group.memberIds) || !group.memberIds.length
					|| typeof group.sharedTurn !== "boolean"
					|| (group.sharedTurn ? group.initiative !== null && !Number.isSafeInteger(group.initiative) : group.initiative !== null)
					|| group.memberIds.some(id => !ids.has(id) || members.has(id))
					|| new Set(group.memberIds).size !== group.memberIds.length) {
					throw new Error("The saved encounter contains invalid groups. It has not been changed.");
				}
				const key = getStatblockKey(raw.instances.find(it => it.id === group.memberIds[0]));
				if (group.memberIds.some(id => getStatblockKey(raw.instances.find(it => it.id === id)) !== key)) {
					throw new Error("A saved group contains different effective statblocks. It has not been changed.");
				}
				groupIds.add(group.id);
				group.memberIds.forEach(id => members.add(id));
			}
			if (raw.ungroupedIds.some(id => !ids.has(id) || members.has(id))
				|| new Set(raw.ungroupedIds).size !== raw.ungroupedIds.length) {
				throw new Error("The saved encounter contains invalid split members. It has not been changed.");
			}
		}
		if (raw.version >= 4 && (
			!raw.turn
			|| !Number.isSafeInteger(raw.turn.round) || raw.turn.round < 0
			|| (raw.turn.round === 0 ? raw.turn.activeId !== null
				: raw.version < 6
					? !ids.has(raw.turn.activeId) || raw.instances.find(it => it.id === raw.turn.activeId)?.initiative == null
					: !(raw.groups.some(group => group.sharedTurn && group.id === raw.turn.activeId && group.initiative != null)
						|| (ids.has(raw.turn.activeId)
							&& !raw.groups.some(group => group.sharedTurn && group.memberIds.includes(raw.turn.activeId))
							&& raw.instances.find(it => it.id === raw.turn.activeId)?.initiative != null)))
		)) throw new Error("The saved encounter contains an invalid active turn. It has not been changed.");

		const state = copy(raw);
		state.version = VERSION;
		if (raw.version < 4) state.turn = {round: 0, activeId: null};
		if (raw.version < 6) {
			state.groups = [];
			state.ungroupedIds = [];
		}
		state.instances.forEach(instance => {
			instance.conditions = raw.version === 1 ? [] : getNpcTrackerConditionsAfterUpdate({
				conditions: instance.conditions,
				condition: null,
				isAdd: true,
			});
			if (raw.version < 3) {
				instance.areaNotes = [];
				instance.modifiers = [];
			} else {
				instance.modifiers = instance.modifiers.map(modifier =>
					getEncounterIsLegacyPresetId(modifier.presetId) && !Object.hasOwn(modifier, "source")
						? getEncounterModifierForPreset(modifier.presetId)
						: modifier);
			}
			if (raw.version < 4) {
				instance.hp = getHpDefaults(instance.monster);
				instance.initiative = null;
			}
			if (raw.version < 5) instance.statblockOperations = [];
			if (raw.version < 7) instance.resources = getEncounterResourceDefaults(getEncounterEffectiveMonster(instance));
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
					statblockOperations: [],
					hp: getHpDefaults(resolved.entity),
					initiative: null,
					resources: getEncounterResourceDefaults(resolved.entity),
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

	static withGroup ({state, memberIds, id}) {
		if (!Array.isArray(memberIds) || memberIds.length < 2 || new Set(memberIds).size !== memberIds.length
			|| typeof id !== "string" || !id.trim() || id.startsWith("view:")
			|| state.instances.some(it => it.id === id) || state.groups.some(it => it.id === id)) {
			throw new Error("Choose two or more distinct monsters and a new group ID.");
		}
		const members = memberIds.map(memberId => state.instances.find(it => it.id === memberId));
		if (members.some(it => !it) || members.some(it => state.groups.some(group => group.memberIds.includes(it.id)))
			|| members.some(it => getStatblockKey(it) !== getStatblockKey(members[0]))) {
			throw new Error("Only ungrouped monsters with identical effective statblocks can form a group.");
		}
		return this.validate({
			...state,
			groups: [...state.groups, {id, memberIds, sharedTurn: false, initiative: null}],
			ungroupedIds: state.ungroupedIds.filter(it => !memberIds.includes(it)),
		});
	}

	static withGroupSplit (state, {id}) {
		const instance = state.instances.find(it => it.id === id);
		if (!instance) throw new Error("This encounter monster no longer exists.");
		const group = state.groups.find(it => it.memberIds.includes(id));
		if (!group && state.ungroupedIds.includes(id)) throw new Error("This monster is already split out.");
		const groups = group ? state.groups.flatMap(it => {
			if (it !== group) return [it];
			const memberIds = it.memberIds.filter(memberId => memberId !== id);
			return memberIds.length ? [{...it, memberIds}] : [];
		}) : state.groups;
		const turn = group && group.memberIds.length === 1 ? getTurnAfterGroupRemoval(state, group) : state.turn;
		return this.validate({...state, groups, turn, ungroupedIds: [...state.ungroupedIds, id]});
	}

	static withGroupRejoin (state, {id, groupId = null}) {
		const instance = state.instances.find(it => it.id === id);
		if (!instance || !state.ungroupedIds.includes(id)) throw new Error("This split monster is no longer available.");
		const group = groupId == null ? null : state.groups.find(it => it.id === groupId);
		if (groupId != null && (!group || getStatblockKey(instance) !== getStatblockKey(state.instances.find(it => it.id === group.memberIds[0])))) {
			throw new Error("The selected group has a different effective statblock.");
		}
		return this.validate({
			...state,
			groups: state.groups.map(it => it === group ? {...it, memberIds: [...it.memberIds, id]} : it),
			ungroupedIds: state.ungroupedIds.filter(it => it !== id),
		});
	}

	static withGroupDisband (state, {groupId}) {
		const group = state.groups.find(it => it.id === groupId);
		if (!group) throw new Error("This encounter group no longer exists.");
		return this.validate({
			...state,
			groups: state.groups.filter(it => it !== group),
			ungroupedIds: [...state.ungroupedIds, ...group.memberIds],
			turn: getTurnAfterGroupRemoval(state, group),
		});
	}

	static withSharedTurn (state, {groupId, isShared, total = null}) {
		const group = state.groups.find(it => it.id === groupId);
		if (!group) throw new Error("This encounter group no longer exists.");
		if (isShared && !Number.isSafeInteger(total)) throw new Error("Choose or roll a whole-number group initiative.");
		return this.validate({
			...state,
			groups: state.groups.map(it => it === group ? {...it, sharedTurn: isShared, initiative: isShared ? total : null} : it),
			turn: isShared
				? state.turn.round && group.memberIds.includes(state.turn.activeId)
					? {...state.turn, activeId: group.id}
					: state.turn
				: getTurnAfterGroupRemoval(state, group),
		});
	}

	static withStatblockChanges (state, changes) {
		if (!Array.isArray(changes) || !changes.length) throw new Error("Choose a statblock edit to apply.");
		const byId = new Map();
		for (const change of changes) {
			if (!change?.id || byId.has(change.id) || !state.instances.some(it => it.id === change.id)) {
				throw new Error("A statblock target no longer exists or appears twice.");
			}
			if (!Array.isArray(change.addOperations) || !Array.isArray(change.removeIds)
				|| change.removeIds.some(id => typeof id !== "string")) throw new Error("Choose valid statblock changes.");
			byId.set(change.id, change);
		}
		const changedIds = [];
		const resetHpIds = [];
		const instances = state.instances.map(instance => {
			const change = byId.get(instance.id);
			if (!change) return instance;
			const before = getEncounterEffectiveMonster(instance);
			const prior = instance.statblockOperations || [];
			const removed = new Set(change.removeIds);
			if (removed.size !== change.removeIds.length || change.removeIds.some(id => !prior.some(it => it.id === id))) {
				throw new Error("A statblock operation no longer exists.");
			}
			const operations = [...prior.filter(it => !removed.has(it.id)), ...change.addOperations];
			if (JSON.stringify(operations) === JSON.stringify(prior)) return instance;
			validateEncounterStatblockOperations(instance.monster, operations);
			const after = BestiaryQuickActionsEngine.applyOperations({monster: instance.monster, operations});
			const hpChanged = !Object.is(before.hp?.average, after.hp?.average);
			changedIds.push(instance.id);
			if (hpChanged) resetHpIds.push(instance.id);
			return {
				...instance,
				statblockOperations: operations,
				hp: hpChanged ? {...getHpDefaults(after), temp: instance.hp.temp} : instance.hp,
			};
		});
		const byEffective = new Map(instances.map(it => [it.id, getStatblockKey(it)]));
		const splitIds = [];
		const groups = state.groups.map(group => {
			const anchorId = group.memberIds.find(id => !changedIds.includes(id)) || group.memberIds[0];
			const key = byEffective.get(anchorId);
			const memberIds = group.memberIds.filter(id => {
				if (byEffective.get(id) === key) return true;
				splitIds.push(id);
				return false;
			});
			return {...group, memberIds};
		});
		const next = this.validate({
			...state,
			instances,
			groups,
		});
		return {state: next, changedIds, resetHpIds, splitIds};
	}

	static previewBulkStatblockOperation (state, {operation, targetIds = state.selectedIds}) {
		if (!Array.isArray(targetIds) || !targetIds.length || new Set(targetIds).size !== targetIds.length) {
			throw new Error("Select at least one monster for the bulk statblock edit.");
		}
		const targets = new Set(targetIds);
		if (state.instances.filter(it => targets.has(it.id)).length !== targets.size) throw new Error("An encounter target no longer exists.");
		const legendaryGroup = operation.type === "setLegendaryGroup"
			? operation.legendaryGroup ?? operation.data?.legendaryGroup
			: null;
		const changes = [];
		const skipped = [];
		for (const instance of state.instances) {
			if (!targets.has(instance.id)) continue;
			const current = getEncounterEffectiveMonster(instance);
			let reason = null;
			const typeTags = typeof current.type === "object" && Array.isArray(current.type?.tags)
				? current.type.tags
				: [];
			if (operation.type === "minion" && (
				instance.statblockOperations.some(it => it.type === "minion")
				|| typeTags.some(tag => `${typeof tag === "object" ? tag.tag : tag}`.toLowerCase() === "minion")
				|| (Array.isArray(current.trait) && current.trait.some(it => it.name?.toLowerCase() === "minion"))
			)) reason = "already a minion";
			if (operation.type === "applyAreaTrait" && instance.statblockOperations.some(it =>
				it.type === "applyAreaTrait" && it.sourceUid === operation.sourceUid)) reason = "area trait already applied";
			if (operation.type === "addEntry" && current[operation.data?.section]?.some(it =>
				it.name?.toLowerCase() === operation.data?.entry?.name?.toLowerCase())) reason = "legendary entry already exists";
			if (operation.type === "setLegendaryGroup" && current.legendaryGroup && legendaryGroup
				&& current.legendaryGroup.name === legendaryGroup.name
				&& current.legendaryGroup.source === legendaryGroup.source) reason = "lair group already applied";
			if (reason) {
				skipped.push({id: instance.id, reason});
				continue;
			}
			const removeIds = operation.type === "setLegendaryGroup"
				? instance.statblockOperations.filter(it => it.type === "setLegendaryGroup").map(it => it.id)
				: [];
			try {
				validateEncounterStatblockOperations(instance.monster, [
					...instance.statblockOperations.filter(it => !removeIds.includes(it.id)),
					operation,
				]);
				changes.push({id: instance.id, addOperations: [operation], removeIds});
			} catch (e) {
				skipped.push({id: instance.id, reason: e.message});
			}
		}
		if (!changes.length) return {state, changedIds: [], resetHpIds: [], splitIds: [], skipped};
		return {...this.withStatblockChanges(state, changes), skipped};
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
					const isDesecrated = modifier.presetId.startsWith("desecrated-");
					const replaced = existing.filter(it => it.id === modifier.id || (isDesecrated && it.presetId?.startsWith("desecrated-")));
					modifiers = [...existing.filter(it => !replaced.includes(it)), modifier];
					if (replaced.length !== 1 || replaced[0].id !== modifier.id) changedIds.push(instance.id);
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

	static withSpellSlots (state, {id, level, current, max}) {
		if (!Number.isInteger(level) || level < 1 || level > 9) throw new Error("Choose a spell level from 1 to 9.");
		return this._withResources(state, id, resources => ({
			...resources,
			spellSlots: {...resources.spellSlots, [level]: {current, max}},
		}));
	}

	static withoutSpellSlots (state, {id, level}) {
		if (!Number.isInteger(level) || level < 1 || level > 9) throw new Error("Choose a spell level from 1 to 9.");
		return this._withResources(state, id, resources => {
			if (!Object.hasOwn(resources.spellSlots, level)) throw new Error("This spell level is not tracked.");
			const spellSlots = {...resources.spellSlots};
			delete spellSlots[level];
			return {...resources, spellSlots};
		});
	}

	static withAbility (state, {id, ability}) {
		return this._withResources(state, id, resources => {
			const existing = resources.abilities.findIndex(it => it.id === ability?.id);
			if (existing < 0 && resources.recharges.some(it => it.id === ability?.id)) throw new Error("This resource ID is already in use.");
			const abilities = [...resources.abilities];
			if (existing < 0) abilities.push(ability);
			else abilities[existing] = ability;
			return {...resources, abilities};
		});
	}

	static withoutAbility (state, {id, abilityId}) {
		return this._withResources(state, id, resources => {
			if (!resources.abilities.some(it => it.id === abilityId)) throw new Error("This ability is not tracked.");
			return {...resources, abilities: resources.abilities.filter(it => it.id !== abilityId)};
		});
	}

	static withAbilityUse (state, {id, abilityId, change}) {
		if (change !== -1 && change !== 1) throw new Error("Spend or restore one use at a time.");
		return this._withResources(state, id, resources => {
			const ability = resources.abilities.find(it => it.id === abilityId);
			if (!ability) throw new Error("This ability is not tracked.");
			const current = ability.current + change;
			if (current < 0 || current > ability.max) throw new Error("This ability has no uses to spend or restore.");
			return {...resources, abilities: resources.abilities.map(it => it.id === abilityId ? {...it, current} : it)};
		});
	}

	static withRechargeReady (state, {id, rechargeId, ready}) {
		if (typeof ready !== "boolean") throw new Error("Choose whether the recharge ability is ready.");
		return this._withResources(state, id, resources => {
			if (!resources.recharges.some(it => it.id === rechargeId)) throw new Error("This recharge ability is not tracked.");
			return {...resources, recharges: resources.recharges.map(it => it.id === rechargeId ? {...it, ready} : it)};
		});
	}

	static withConcentration (state, {id, active, label = ""}) {
		if (typeof active !== "boolean" || typeof label !== "string" || label.length > 120
				|| (!active && label)) throw new Error("Choose a valid concentration state and optional effect label.");
		return this._withResources(state, id, resources => ({
			...resources,
			concentration: {active, label},
		}));
	}

	static _withResources (state, id, update) {
		if (!state.instances.some(it => it.id === id)) throw new Error("This encounter monster no longer exists.");
		return this.validate({
			...state,
			instances: state.instances.map(instance => instance.id === id
				? {...instance, resources: update(instance.resources)}
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

	static withTypedDamage (state, {amount, damageType, source, decisions = {}, targetIds = state.selectedIds}) {
		const {eligibleIds} = getEncounterEffectTargets(state, {targetIds});
		if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) throw new Error("Damage defense decisions must be explicit.");
		getEncounterDamageForMonster({amount, damageType, source});
		const selected = new Set(eligibleIds);
		const changedIds = [];
		const skippedIds = [];
		const snapshots = [];
		const results = [];
		const unresolved = [];
		const instances = state.instances.map(instance => {
			if (!selected.has(instance.id)) return instance;
			if (instance.hp.max == null || instance.hp.current == null) {
				skippedIds.push(instance.id);
				return instance;
			}
			const calculation = getEncounterDamageForMonster({
				monster: getEncounterEffectiveMonster(instance),
				amount,
				damageType,
				source,
				decisions: Object.hasOwn(decisions, instance.id) ? decisions[instance.id] : {},
			});
			if (calculation.unresolved.length) {
				unresolved.push(...calculation.unresolved.map(defense => ({id: instance.id, ...defense})));
				return instance;
			}
			const hp = getNpcTrackerHpAfterOperation({
				hp: instance.hp,
				operation: {mode: "delta", value: -calculation.damage},
			});
			validateHp(hp);
			const concentrationDc = instance.resources?.concentration.active && calculation.damage
				? Math.max(10, Math.floor(calculation.damage / 2))
				: null;
			results.push({id: instance.id, damage: calculation.damage, defenses: calculation.defenses, before: {...instance.hp}, after: hp, concentrationDc});
			if (Object.keys(hp).every(prop => hp[prop] === instance.hp[prop])) return instance;
			changedIds.push(instance.id);
			snapshots.push({id: instance.id, before: {...instance.hp}, after: hp});
			return {...instance, hp};
		});
		if (unresolved.length) {
			const error = new Error("Resolve the named conditional defenses before applying damage to any target.");
			error.unresolved = unresolved;
			throw error;
		}
		return {state: this.validate({...state, instances}), changedIds, skippedIds, snapshots, results};
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
		return this.getInitiativeEntries(state)
			.filter(({entry}) => entry.initiative != null)
			.sort((a, b) => b.entry.initiative - a.entry.initiative || a.order - b.order)
			.map(({entry}) => entry);
	}

	static getInitiativeEntries (state) {
		if (!state.instances.length) return [];
		const sharedByMember = new Map(state.groups
			.filter(group => group.sharedTurn)
			.flatMap(group => group.memberIds.map(id => [id, group])));
		const seen = new Set();
		return state.instances.flatMap((instance, order) => {
			const group = sharedByMember.get(instance.id);
			if (group) {
				if (seen.has(group.id)) return [];
				seen.add(group.id);
				return [{entry: {id: group.id, initiative: group.initiative, memberIds: group.memberIds}, order}];
			}
			return [{entry: instance, order}];
		});
	}

	static withInitiativeReorder (state, {id, beforeId = null}) {
		const entries = this.getInitiativeEntries(state);
		const source = entries.find(it => it.entry.id === id)?.entry;
		const order = this.getInitiativeOrder(state);
		if (!source) throw new Error("Choose a monster or shared turn to move.");
		if (beforeId !== null && !order.some(it => it.id === beforeId)) {
			throw new Error("The destination is no longer in turn order.");
		}
		const remaining = order.filter(it => it.id !== id);
		const position = beforeId === id ? order.findIndex(it => it.id === id)
			: beforeId === null ? remaining.length : remaining.findIndex(it => it.id === beforeId);
		if (source.initiative != null && position === order.findIndex(it => it.id === id)) {
			return {state, changes: [], undo: null};
		}
		const left = remaining[position - 1];
		const right = remaining[position];
		const candidate = direction => {
			let total = direction === "left"
				? right ? right.initiative + 1 : left ? Math.max(Number.MIN_SAFE_INTEGER, left.initiative - 1) : 0
				: left ? left.initiative - 1 : right ? Math.min(Number.MAX_SAFE_INTEGER, right.initiative + 1) : 0;
			if (!Number.isSafeInteger(total)) return null;
			const totals = new Map([[id, total]]);
			for (let ix = position + (direction === "left" ? -1 : 0);
				ix >= 0 && ix < remaining.length;
				ix += direction === "left" ? -1 : 1) {
				const entry = remaining[ix];
				if (direction === "left" ? entry.initiative > total : entry.initiative < total) break;
				total += direction === "left" ? 1 : -1;
				if (!Number.isSafeInteger(total)) return null;
				totals.set(entry.id, total);
			}
			return totals;
		};
		const choices = [candidate("left"), candidate("right")].filter(Boolean);
		if (!choices.length) throw new Error("There are no safe whole-number initiative totals for this position.");
		choices.sort((a, b) => {
			if (a.size !== b.size) return a.size - b.size;
			if (source.initiative == null) return 0;
			return Math.abs(a.get(id) - source.initiative) - Math.abs(b.get(id) - source.initiative);
		});
		const totals = choices[0];
		const current = new Map(entries.map(({entry}) => [entry.id, entry.initiative]));
		const changes = [...totals].filter(([entryId, after]) => current.get(entryId) !== after)
			.map(([entryId, after]) => ({id: entryId, before: current.get(entryId), after}));
		const next = this.withInitiativeResults(state, changes.map(({id: entryId, after}) => ({id: entryId, total: after})));
		return {
			state: next,
			changes,
			undo: {changes, after: this.getInitiativeUndoGuard(next)},
		};
	}

	static getInitiativeUndoGuard (state) {
		return {
			turn: {...state.turn},
			groups: state.groups.map(({id, memberIds, sharedTurn, initiative}) => ({id, memberIds: [...memberIds], sharedTurn, initiative})),
			instances: state.instances.map(({id, initiative}) => [id, initiative]),
		};
	}

	static withInitiativeReorderUndo (state, undo) {
		if (!undo?.changes?.length || JSON.stringify(this.getInitiativeUndoGuard(state)) !== JSON.stringify(undo.after)) {
			throw new Error("Initiative, groups or turns changed since the move; it cannot be undone safely.");
		}
		return this.withInitiativeResults(state, undo.changes.map(({id, before}) => ({id, total: before})));
	}

	static withInitiative (state, {id, total}) {
		if (total !== null && !Number.isSafeInteger(total)) throw new Error("Initiative must be a whole number or unset.");
		if (!state.instances.some(it => it.id === id) && !getEncounterSharedGroup(state, id)) throw new Error("This encounter target no longer exists.");
		return this.withInitiativeResults(state, [{id, total}]);
	}

	static withInitiativeResults (state, results) {
		const ids = new Set(state.instances.map(it => it.id));
		const totals = new Map();
		for (const result of results) {
			const shared = getEncounterSharedGroup(state, result.id);
			const id = shared?.id || result.id;
			if ((!ids.has(result.id) && !shared) || totals.has(id)
				|| (result.total !== null && !Number.isSafeInteger(result.total))) {
				throw new Error("Initiative results contain an invalid encounter target or total.");
			}
			totals.set(id, result.total);
		}
		const turn = totals.has(state.turn.activeId) && totals.get(state.turn.activeId) === null
			? {round: 0, activeId: null}
			: state.turn;
		return this.validate({
			...state,
			turn,
			groups: state.groups.map(group => totals.has(group.id) ? {...group, initiative: totals.get(group.id)} : group),
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

	async pReplace ({currentState, exportedSublist, pConfirm, pResolveItem, fnUid, isRequireAllItems = false}) {
		if (currentState.sourceList && !await pConfirm()) return currentState;
		const next = await EncounterWorkspaceState.pFromSavedList({exportedSublist, pResolveItem, fnUid});
		if (isRequireAllItems && (!next.instances.length || next.omissions.length)) {
			throw new Error(next.omissions.length
				? `${next.omissions.length} creature ${next.omissions.length === 1 ? "entry could" : "entries could"} not be brought over (${next.omissions.map(it => `${it.hash}: ${it.reason}`).join("; ")}). Correct the encounter in Bestiary and try again`
				: "The current Bestiary encounter has no usable creatures. Add creatures there and try again");
		}
		return this.pSave(next);
	}
}
