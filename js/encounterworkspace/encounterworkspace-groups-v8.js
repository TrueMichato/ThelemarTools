import {EncounterWorkspaceState, getEncounterEffectiveMonster, getEncounterSharedGroup, getEncounterViewGroups} from "./encounterworkspace-state.js";
import {getEncounterInitiativeBonus, getEncounterRollBreakdown} from "./encounterworkspace-rollbreakdown.js";

/**
 * Cockpit groups (v8). Two layers coexist:
 * - Custom groups: a named label on each instance (`instance.customGroup`), with per-group settings in
 *   `state.groupMeta[name]` ({stack, sharedInit}). Any creatures may share a custom group, statblocks may differ, and
 *   every member keeps its own turn. Group initiative gives them all the same total so they act back to back.
 * - Shared turns: the existing explicit `state.groups` (`withGroup` / `withSharedTurn`), where members act as one
 *   initiative entry. That needs identical effective statblocks; `withEncounterGroupSharedTurn` bridges the two.
 */

const normalizeName = name => typeof name === "string" ? name.trim() : "";

function getValidName (state, name) {
	const out = normalizeName(name);
	if (!out) throw new Error("Give the group a name.");
	if (out.startsWith("view:") || state.instances.some(it => it.id === out) || state.groups.some(it => it.id === out)) {
		throw new Error(`"${out}" can't be used as a group name.`);
	}
	return out;
}

function withoutUnusedGroupMeta (state) {
	const used = new Set(state.instances.map(it => it.customGroup).filter(Boolean));
	return Object.fromEntries(Object.entries(state.groupMeta).filter(([name]) => used.has(name)));
}

function withCustomGroups (state, groupById) {
	const next = {...state, instances: state.instances.map(it => groupById.has(it.id) ? {...it, customGroup: groupById.get(it.id)} : it)};
	return EncounterWorkspaceState.validate({...next, groupMeta: withoutUnusedGroupMeta(next)});
}

/** English plural for an auto-group name ("Goblin" → "Goblins", "Harpy" → "Harpies", "Lich" → "Liches"). */
export function getEncounterGroupPlural (name) {
	if (/(?:s|x|z|ch|sh)$/i.test(name)) return /s$/i.test(name) ? name : `${name}es`;
	if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
	if (/[lr]f$/i.test(name)) return `${name.slice(0, -1)}ves`;
	return `${name}s`;
}

export function getEncounterCustomGroupNames (state) {
	return [...new Set(state.instances.map(it => it.customGroup).filter(Boolean))];
}

export function getEncounterGroupMembers (state, name) {
	return state.instances.filter(it => it.customGroup === name);
}

export function getEncounterGroupMeta (state, name) {
	return state.groupMeta[name] || {};
}

/**
 * Display groups in roster order: custom groups first-seen, then the remaining creatures in their implicit view groups
 * (identical statblocks). Rows: {id, name, kind: "custom"|"view", memberIds, isStacked, sharedInit, sharedTurnId}.
 * `sharedTurnId` is the explicit shared-turn group that holds every member, if any.
 */
export function getEncounterGroupsV8 (state) {
	const rows = [];
	const seen = new Set();
	const viewGroups = getEncounterViewGroups(state);
	const getSharedTurnId = memberIds => {
		const shared = getEncounterSharedGroup(state, memberIds[0]);
		return shared && memberIds.every(id => shared.memberIds.includes(id)) ? shared.id : null;
	};
	for (const instance of state.instances) {
		if (instance.customGroup) {
			if (seen.has(`custom:${instance.customGroup}`)) continue;
			seen.add(`custom:${instance.customGroup}`);
			const memberIds = getEncounterGroupMembers(state, instance.customGroup).map(it => it.id);
			const meta = getEncounterGroupMeta(state, instance.customGroup);
			rows.push({id: instance.customGroup, name: instance.customGroup, kind: "custom", memberIds, isStacked: !!meta.stack, sharedInit: meta.sharedInit ?? null, sharedTurnId: getSharedTurnId(memberIds)});
			continue;
		}
		const view = viewGroups.find(it => it.memberIds.includes(instance.id));
		if (seen.has(view.id)) continue;
		seen.add(view.id);
		const memberIds = view.memberIds.filter(id => !state.instances.find(it => it.id === id).customGroup);
		const monster = getEncounterEffectiveMonster(instance);
		rows.push({id: view.id, name: memberIds.length > 1 ? getEncounterGroupPlural(monster.name) : monster.name, kind: "view", memberIds, isStacked: false, sharedInit: null, sharedTurnId: getSharedTurnId(memberIds)});
	}
	return rows;
}

/** Create a custom group, or add creatures to an existing one (same call). */
export function withEncounterCustomGroup (state, {ids = state.selectedIds, name}) {
	const groupName = getValidName(state, name);
	if (!ids.length || ids.some(id => !state.instances.some(it => it.id === id))) throw new Error("Choose creatures to group.");
	return withCustomGroups(state, new Map(ids.map(id => [id, groupName])));
}

export const withEncounterAddToGroup = withEncounterCustomGroup;

/** Rename a custom group (merging into `to` if it already exists); its settings move with it. */
export function withEncounterGroupRename (state, {from, to}) {
	const target = getValidName(state, to);
	if (!getEncounterGroupMembers(state, from).length) throw new Error(`There's no group called ${from}.`);
	if (target === from) return state;
	const groupMeta = {...state.groupMeta};
	if (groupMeta[from]) {
		groupMeta[target] = {...groupMeta[from], ...(groupMeta[target] || {})};
		delete groupMeta[from];
	}
	return EncounterWorkspaceState.validate({
		...state,
		groupMeta,
		instances: state.instances.map(it => it.customGroup === from ? {...it, customGroup: target} : it),
	});
}

/** Remove creatures from their custom groups. Party members stay in theirs (as in the mockup). */
export function withEncounterUngroup (state, {ids = state.selectedIds}) {
	const groupById = new Map(state.instances.filter(it => ids.includes(it.id) && it.kind !== "party" && it.customGroup).map(it => [it.id, null]));
	return groupById.size ? withCustomGroups(state, groupById) : state;
}

/**
 * Auto-group newly added monsters with the same kind (name + source). If an ungrouped same-kind creature already shares
 * a custom group, new ones join it; otherwise two or more same-kind ungrouped monsters form "<Name>s".
 * Returns {state, grouped: [{name, ids}]}.
 */
export function withEncounterAutoGroup (state, newIds) {
	const getKind = instance => {
		const monster = instance.monster;
		return `${monster.name}|${monster.source}`.toLowerCase();
	};
	const groupById = new Map();
	const grouped = new Map();
	const kinds = [...new Set(state.instances.filter(it => newIds.includes(it.id) && it.kind !== "party" && !it.customGroup).map(getKind))];
	for (const kind of kinds) {
		const sameKind = state.instances.filter(it => it.kind !== "party" && getKind(it) === kind);
		const fresh = sameKind.filter(it => newIds.includes(it.id) && !it.customGroup);
		const existing = sameKind.find(it => !newIds.includes(it.id) && it.customGroup)?.customGroup;
		let name = existing;
		let members = fresh;
		if (!name) {
			members = sameKind.filter(it => !it.customGroup);
			if (members.length < 2) continue;
			name = getEncounterGroupPlural(sameKind[0].monster.name);
			if (state.instances.some(it => it.id === name)) name = `${name} group`;
		}
		members.forEach(it => groupById.set(it.id, name));
		grouped.set(name, [...(grouped.get(name) || []), ...members.map(it => it.id)]);
	}
	if (!groupById.size) return {state, grouped: []};
	return {state: withCustomGroups(state, groupById), grouped: [...grouped].map(([name, ids]) => ({name, ids}))};
}

/** Persisted UI preference: show the group as one stacked row. */
export function withEncounterGroupStack (state, {name, isStacked}) {
	if (!getEncounterGroupMembers(state, name).length) throw new Error(`There's no group called ${name}.`);
	return EncounterWorkspaceState.validate({...state, groupMeta: {...state.groupMeta, [name]: {...getEncounterGroupMeta(state, name), stack: !!isStacked}}});
}

/**
 * Give every member of a custom group the same initiative so they act back to back. Members already sharing an
 * explicit turn get one result for that turn. Members are placed after anyone else already on that total (tieOrder).
 */
export function withEncounterGroupInitiative (state, {name, total}) {
	if (!Number.isSafeInteger(total)) throw new Error("Group initiative must be a whole number.");
	const members = getEncounterGroupMembers(state, name);
	if (!members.length) throw new Error(`There's no group called ${name}.`);
	const results = new Map();
	for (const member of members) results.set(getEncounterSharedGroup(state, member.id)?.id || member.id, {id: member.id, total});
	let next = EncounterWorkspaceState.withInitiativeResults(state, [...results.values()]);
	const othersOnTotal = next.instances.filter(it => it.customGroup !== name && it.initiative === total).length;
	const memberIds = members.map(it => it.id);
	next = {
		...next,
		instances: next.instances.map(it => memberIds.includes(it.id) ? {...it, tieOrder: othersOnTotal + memberIds.indexOf(it.id)} : it),
		groupMeta: {...next.groupMeta, [name]: {...getEncounterGroupMeta(next, name), sharedInit: total}},
	};
	return EncounterWorkspaceState.validate(next);
}

/**
 * Roll initiative once for a whole custom group: one d20 + the best member's initiative bonus (mockup rule), with the
 * roll breakdown of that member (so contributors and adv/dis apply). Returns {state, roll, memberIds, rollerId}.
 */
export function rollEncounterGroupInitiative (state, {name, rng = Math.random, forcedMode = null, forcedLabel = null, getContributors = null}) {
	const members = getEncounterGroupMembers(state, name);
	if (!members.length) throw new Error(`There's no group called ${name}.`);
	const roller = members.reduce((best, it) => getEncounterInitiativeBonus(getEncounterEffectiveMonster(it)) > getEncounterInitiativeBonus(getEncounterEffectiveMonster(best)) ? it : best);
	const roll = getEncounterRollBreakdown({instance: roller, query: {kind: "initiative"}, rng, forcedMode, forcedLabel, getContributors});
	return {
		state: withEncounterGroupInitiative(state, {name, total: roll.total}),
		roll,
		memberIds: members.map(it => it.id),
		rollerId: roller.id,
	};
}

/**
 * Turn a custom group into (or out of) one shared turn via the explicit-group reducers. Only possible when every member
 * has an identical effective statblock and isn't in another explicit group; throws a readable error otherwise.
 */
export function withEncounterGroupSharedTurn (state, {name, isShared, total = null}) {
	const members = getEncounterGroupMembers(state, name);
	if (!members.length) throw new Error(`There's no group called ${name}.`);
	const memberIds = members.map(it => it.id);
	const existing = state.groups.find(group => memberIds.length === group.memberIds.length && memberIds.every(id => group.memberIds.includes(id)));
	if (!isShared) {
		if (!existing) return state;
		return EncounterWorkspaceState.withGroupDisband(state, {groupId: existing.id});
	}
	const initiative = total ?? getEncounterGroupMeta(state, name).sharedInit ?? members.find(it => it.initiative != null)?.initiative ?? null;
	if (!Number.isSafeInteger(initiative)) throw new Error("Set or roll the group's initiative first.");
	let next = state;
	let groupId = existing?.id;
	if (!existing) {
		// Rejoin split-out members first so the explicit group can claim them.
		next = {...next, ungroupedIds: next.ungroupedIds.filter(id => !memberIds.includes(id))};
		groupId = `shared:${name}`;
		for (let n = 2; next.groups.some(it => it.id === groupId) || next.instances.some(it => it.id === groupId); ++n) groupId = `shared:${name}:${n}`;
		try {
			next = EncounterWorkspaceState.withGroup({state: next, memberIds, id: groupId});
		} catch {
			throw new Error(`${name} can't share one turn: its creatures have different statblocks or are already in another shared group. Use group initiative instead.`);
		}
	}
	next = EncounterWorkspaceState.withSharedTurn(next, {groupId, isShared: true, total: initiative});
	return EncounterWorkspaceState.validate({...next, groupMeta: {...next.groupMeta, [name]: {...getEncounterGroupMeta(next, name), sharedInit: initiative}}});
}
