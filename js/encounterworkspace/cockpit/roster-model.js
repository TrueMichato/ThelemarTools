/**
 * Pure helpers for the rail's two views (A6 mockup "roster"): the Initiative view, where a stacked custom group
 * collapses into one "Goblins ×5" row, and the Groups view, where creatures sit under their group's header.
 */
import {getCockpitHpState} from "./model.js";

export const COCKPIT_ROSTER_VIEWS = ["init", "groups"];
export const COCKPIT_ROSTER_SORTS = [
	{id: "init", label: "Initiative"},
	{id: "name", label: "Name"},
	{id: "hp", label: "Lowest HP"},
];

/**
 * Initiative-view items, in order: {type: "row", id} | {type: "stack", name, ids} | {type: "stackHead", name, count}.
 * A stacked custom group becomes one item when it has 2+ live members that act back to back (defeated creatures in
 * between don't break the run). An expanded stack gets a header before its first member so it can be collapsed again.
 * @param orderIds Initiative order.
 * @param byId Map id → instance.
 * @param groups `getEncounterGroupsV8` rows.
 * @param stackOpen Set of expanded group names.
 */
export function getCockpitRailItems ({orderIds = [], byId, groups = [], stackOpen = new Set()}) {
	const stacked = new Set(groups.filter(it => it.kind === "custom" && it.isStacked).map(it => it.name));
	const live = orderIds.filter(id => byId.get(id) && !byId.get(id).defeated);
	const liveIx = new Map(live.map((id, ix) => [id, ix]));
	const out = [];
	const done = new Set();
	for (const id of orderIds) {
		const instance = byId.get(id);
		if (!instance || done.has(id)) continue;
		const name = instance.customGroup;
		if (!instance.defeated && name && stacked.has(name)) {
			const members = live.filter(it => byId.get(it).customGroup === name);
			if (members.length > 1 && members[0] === id) {
				const pos = members.map(it => liveIx.get(it));
				const isAdjacent = pos.every((p, ix) => p === pos[0] + ix);
				if (!stackOpen.has(name) && isAdjacent) {
					members.forEach(it => done.add(it));
					out.push({type: "stack", name, ids: members});
					continue;
				}
				if (stackOpen.has(name)) out.push({type: "stackHead", name, count: members.length});
			}
		}
		out.push({type: "row", id});
	}
	return out;
}

/** Case-insensitive find over a creature's label, statblock name and group. Blank matches everything. */
export function isCockpitRosterMatch (query, {label = "", instance = null, sectionName = ""} = {}) {
	const q = `${query || ""}`.trim().toLowerCase();
	if (!q) return true;
	return [label, instance?.monster?.name, instance?.monster?._displayName, sectionName]
		.some(it => it && `${it}`.toLowerCase().includes(q));
}

function getSortValue (instance, sort, label) {
	if (sort === "name") return `${label || ""}`.toLowerCase();
	if (sort === "hp") {
		const {fraction} = getCockpitHpState(instance.hp);
		return fraction == null ? Infinity : fraction;
	}
	return 0;
}

/**
 * Groups-view sections: custom groups and the party members outside any group ("Party"), first-seen in initiative
 * order, then "Ungrouped" last. Each: {key, name, kind: "custom"|"party"|"ungrouped", group (v8 row or null), ids, total}.
 * `ids` is filtered by `query` (a group whose name matches keeps every member) and sorted by `sort`
 * ("init" keeps initiative order; "name" by label; "hp" most hurt first). Sections with no match are dropped.
 */
export function getCockpitRosterSections ({orderIds = [], byId, groups = [], labels = new Map(), query = "", sort = "init"}) {
	const customByName = new Map(groups.filter(it => it.kind === "custom").map(it => [it.name, it]));
	const sections = new Map();
	const add = (key, init, id) => {
		if (!sections.has(key)) sections.set(key, {...init, key, ids: []});
		sections.get(key).ids.push(id);
	};
	for (const id of orderIds) {
		const instance = byId.get(id);
		if (!instance) continue;
		const name = instance.customGroup;
		if (name) add(`custom:${name}`, {name, kind: "custom", group: customByName.get(name) || null}, id);
		else if (instance.kind === "party") {
			if (customByName.has("Party")) add("custom:Party", {name: "Party", kind: "custom", group: customByName.get("Party")}, id);
			else add("party", {name: "Party", kind: "party", group: null}, id);
		}
	}
	for (const id of orderIds) {
		const instance = byId.get(id);
		if (instance && !instance.customGroup && instance.kind !== "party") add("ungrouped", {name: "Ungrouped", kind: "ungrouped", group: null}, id);
	}
	const orderIx = new Map(orderIds.map((id, ix) => [id, ix]));
	return [...sections.values()].map(section => {
		const total = section.ids.length;
		const isNameMatch = section.kind !== "ungrouped" && isCockpitRosterMatch(query, {sectionName: section.name});
		let ids = isNameMatch ? section.ids : section.ids.filter(id => isCockpitRosterMatch(query, {label: labels.get(id), instance: byId.get(id)}));
		if (sort === "name" || sort === "hp") {
			ids = [...ids].sort((a, b) => {
				const va = getSortValue(byId.get(a), sort, labels.get(a));
				const vb = getSortValue(byId.get(b), sort, labels.get(b));
				if (va < vb) return -1;
				if (va > vb) return 1;
				return orderIx.get(a) - orderIx.get(b);
			});
		}
		return {...section, ids, total};
	}).filter(it => it.ids.length);
}

/**
 * Totals for a stacked row: summed hit points, the members' distinct ACs and initiatives ("…" when they differ), and
 * one mini bar per member. `getAc(instance)` and `getInit(instance)` resolve the displayed values.
 */
export function getCockpitStackSummary (instances, {getAc = () => null, getInit = () => null, getLabel = it => it.id} = {}) {
	let hp = 0;
	let hpMax = 0;
	let isHpKnown = false;
	const minis = instances.map(instance => {
		const current = Number(instance.hp?.current);
		const max = Number(instance.hp?.max);
		if (Number.isFinite(current) && Number.isFinite(max)) {
			hp += Math.max(0, current);
			hpMax += max;
			isHpKnown = true;
		}
		const state = getCockpitHpState(instance.hp);
		return {id: instance.id, label: getLabel(instance), current: instance.hp?.current ?? null, max: instance.hp?.max ?? null, fraction: state.fraction, cls: state.cls};
	});
	const acs = [...new Set(instances.map(getAc).filter(it => it != null))];
	const inits = [...new Set(instances.map(getInit))];
	return {
		hp: isHpKnown ? hp : null,
		hpMax: isHpKnown ? hpMax : null,
		acs,
		init: inits.length === 1 ? inits[0] : "…",
		isInitMixed: inits.length > 1,
		minis,
	};
}
