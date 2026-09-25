import {getEncounterEffectiveMonster, getEncounterInitiativeTotal, getEncounterViewGroups} from "./encounterworkspace-state.js";
import {getEncounterInstanceLabels} from "./encounterworkspace-roll.js";

export const ENCOUNTER_ROSTER_SORTS = Object.freeze(["source", "initiative", "hp", "hpPercent", "name", "cr", "status"]);
export const ENCOUNTER_ROSTER_FILTERS = Object.freeze(["all", "conditioned", "bloodied", "defeated", "unrolled"]);

const getCr = monster => {
	const raw = monster.cr;
	const cr = typeof raw === "object" ? raw?.cr : raw;
	if (cr == null || cr === "Unknown" || cr === "—") return null;
	if (typeof cr === "string" && cr.includes("/")) {
		const [numerator, denominator] = cr.split("/").map(Number);
		const value = numerator / denominator;
		return Number.isFinite(value) ? value : null;
	}
	const value = Number(cr);
	return Number.isFinite(value) ? value : null;
};

const getStatus = instance => instance.hp.current === 0 ? 0
	: instance.conditions.length ? 1
		: instance.hp.current != null && instance.hp.max > 0 && instance.hp.current < instance.hp.max ? 2
			: 3;

const compareOptional = (left, right, {descending = false} = {}) =>
	left == null ? (right == null ? 0 : 1)
		: right == null ? -1
			: (left - right) * (descending ? -1 : 1);

export function getEncounterRosterView ({state, query = "", sort = "source", filter = "all"}) {
	if (!ENCOUNTER_ROSTER_SORTS.includes(sort) || !ENCOUNTER_ROSTER_FILTERS.includes(filter)) {
		throw new Error("Choose a supported roster sort and filter.");
	}
	const labels = getEncounterInstanceLabels(state.instances);
	const effectiveById = new Map(state.instances.map(instance => [instance.id, getEncounterEffectiveMonster(instance)]));
	const displayNames = new Map(state.instances.map(instance => {
		const effective = effectiveById.get(instance.id);
		return [instance.id, effective._displayName || effective.name];
	}));
	const displayLabels = new Map(state.instances.map(instance => {
		const name = displayNames.get(instance.id);
		const originalName = instance.monster._displayName || instance.monster.name;
		return [instance.id, name === originalName ? labels.get(instance.id) : `${name} (${labels.get(instance.id)})`];
	}));
	const search = query.trim().toLocaleLowerCase();
	const indexed = new Map(state.instances.map((instance, index) => [instance.id, index]));
	const matches = instance => {
		const hp = instance.hp;
		if ((filter === "conditioned" && !instance.conditions.length)
			|| (filter === "bloodied" && !(hp.current != null && hp.max > 0 && hp.current < hp.max / 2 && hp.current > 0))
			|| (filter === "defeated" && hp.current !== 0)
			|| (filter === "unrolled" && getEncounterInitiativeTotal(state, instance) != null)) return false;
		if (!search) return true;
		const effective = effectiveById.get(instance.id);
		return [labels.get(instance.id), displayNames.get(instance.id), effective.name, effective.source, effective.cr?.cr ?? effective.cr, ...instance.conditions]
			.some(value => String(value ?? "").toLocaleLowerCase().includes(search));
	};
	const compare = (a, b) => {
		let result = 0;
		switch (sort) {
			case "initiative": result = compareOptional(getEncounterInitiativeTotal(state, a), getEncounterInitiativeTotal(state, b), {descending: true}); break;
			case "hp": result = compareOptional(a.hp.current, b.hp.current); break;
			case "hpPercent": result = compareOptional(
				a.hp.current == null || !a.hp.max ? null : a.hp.current / a.hp.max,
				b.hp.current == null || !b.hp.max ? null : b.hp.current / b.hp.max,
			); break;
			case "name": result = displayNames.get(a.id).localeCompare(displayNames.get(b.id)); break;
			case "cr": result = compareOptional(getCr(effectiveById.get(a.id)), getCr(effectiveById.get(b.id)), {descending: true}); break;
			case "status": result = getStatus(a) - getStatus(b); break;
			default: break;
		}
		return result || indexed.get(a.id) - indexed.get(b.id);
	};
	const groups = getEncounterViewGroups(state);
	const visible = groups.map(group => ({
		...group,
		visibleMembers: group.members.filter(matches).sort(compare),
	})).filter(group => group.visibleMembers.length);
	if (sort !== "source") visible.sort((a, b) => compare(a.visibleMembers[0], b.visibleMembers[0]));
	return {groups: visible, labels, displayLabels, visibleIds: visible.flatMap(group => group.visibleMembers.map(it => it.id))};
}
