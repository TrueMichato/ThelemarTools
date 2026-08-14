export const NPC_TRACKER_ROLL_TYPES = [
	{id: "initiative", name: "Initiative"},
	{id: "ability", name: "Ability Check"},
	{id: "save", name: "Saving Throw"},
	{id: "skill", name: "Skill"},
];

export function getNpcTrackerDisplayName (npc) {
	return npc?.alias || npc?.monster?.name || "Unnamed NPC";
}

export function getNpcTrackerSignedNumber (value) {
	const num = Number(value);
	if (!Number.isFinite(num)) return `${value}`;
	return num >= 0 ? `+${num}` : `${num}`;
}

export function getNpcTrackerRollBonus ({npc, rollType, key = null}) {
	const mon = npc?.monster || {};

	switch (rollType) {
		case "initiative": return _getFiniteNumber(Renderer.monster.getInitiativeBonusNumber({mon}), 0);
		case "ability": return _getAbilityModifier(mon, key);
		case "save": return _getFiniteNumber(mon.save?.[key], _getAbilityModifier(mon, key));
		case "skill": return _getFiniteNumber(mon.skill?.[key], _getAbilityModifier(mon, Parser.skillToAbilityAbv(key)));
		default: throw new Error(`Unknown NPC roll type "${rollType}".`);
	}
}

export function getNpcTrackerRollLabel ({rollType, key = null}) {
	switch (rollType) {
		case "initiative": return "Initiative";
		case "ability": return `${Parser.attAbvToFull(key)} check`;
		case "save": return `${Parser.attAbvToFull(key)} save`;
		case "skill": return `${key.toTitleCase()} check`;
		default: throw new Error(`Unknown NPC roll type "${rollType}".`);
	}
}

export function getNpcTrackerNpcsForScope ({state, scope}) {
	if (scope.type === "all") return [...state.npcs];
	if (scope.type === "unsorted") return state.npcs.filter(npc => !npc.groupId);
	if (scope.type === "group") return state.npcs.filter(npc => npc.groupId === scope.groupId);
	throw new Error(`Unknown NPC batch scope "${scope.type}".`);
}

export function sortNpcTrackerBatchResults ({results, sortKey, sortDirection}) {
	const direction = sortDirection === "asc" ? 1 : -1;
	return [...results].sort((a, b) => {
		const primary = sortKey === "order"
			? SortUtil.ascSort(a.order, b.order)
			: sortKey === "name"
				? SortUtil.ascSortLower(a.name, b.name)
				: SortUtil.ascSort(a.total, b.total);
		if (primary) return primary * direction;
		return SortUtil.ascSort(a.order, b.order);
	});
}

export async function pRollNpcTrackerD20 ({npc, label, bonus}) {
	const total = await Renderer.dice.pRoll2(`1d20${getNpcTrackerSignedNumber(bonus)}`, {
		isUser: false,
		name: getNpcTrackerDisplayName(npc),
		label,
	}, {isResultUsed: true});

	if (total == null || total === Renderer.dice._SYMBOL_PARSE_FAILED || !Number.isFinite(Number(total))) return null;
	return {
		total: Number(total),
		die: Number(total) - Number(bonus),
	};
}

function _getAbilityModifier (mon, ability) {
	return typeof mon?.[ability] === "number"
		? Parser.getAbilityModNumber(mon[ability])
		: 0;
}

function _getFiniteNumber (value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}
