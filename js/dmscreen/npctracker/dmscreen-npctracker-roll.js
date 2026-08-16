import {
	getNpcTrackerMonsterSkillMeta,
	getNpcTrackerSkillKeyMeta,
	getNpcTrackerNormalizedSkillName,
} from "./dmscreen-npctracker-data.js";

export const NPC_TRACKER_ROLL_TYPES = [
	{id: "initiative", name: "Initiative"},
	{id: "ability", name: "Ability Check"},
	{id: "save", name: "Saving Throw"},
	{id: "skill", name: "Skill"},
];

const _CONDITION_ROLL_EFFECTS = {
	poisoned: [
		{mode: "disadvantage", rollTypes: ["ability", "skill", "attack"], reason: "Poisoned"},
	],
	frightened: [
		{mode: "disadvantage", rollTypes: ["ability", "skill", "attack"], reason: "Frightened (source in sight)"},
	],
	blinded: [
		{mode: "disadvantage", rollTypes: ["attack"], reason: "Blinded"},
	],
	restrained: [
		{mode: "disadvantage", rollTypes: ["attack"], reason: "Restrained"},
		{mode: "disadvantage", rollTypes: ["save"], keys: ["dex"], reason: "Restrained"},
	],
	prone: [
		{mode: "disadvantage", rollTypes: ["attack"], reason: "Prone"},
	],
	invisible: [
		{mode: "advantage", rollTypes: ["attack"], reason: "Invisible"},
	],
	paralyzed: [
		{mode: "unavailable", rollTypes: ["attack"], reason: "Paralyzed"},
		{mode: "autoFail", rollTypes: ["save"], keys: ["str", "dex"], reason: "Paralyzed"},
	],
	stunned: [
		{mode: "unavailable", rollTypes: ["attack"], reason: "Stunned"},
		{mode: "autoFail", rollTypes: ["save"], keys: ["str", "dex"], reason: "Stunned"},
	],
	unconscious: [
		{mode: "unavailable", rollTypes: ["attack"], reason: "Unconscious"},
		{mode: "autoFail", rollTypes: ["save"], keys: ["str", "dex"], reason: "Unconscious"},
	],
	petrified: [
		{mode: "unavailable", rollTypes: ["attack"], reason: "Petrified"},
		{mode: "autoFail", rollTypes: ["save"], keys: ["str", "dex"], reason: "Petrified"},
	],
	incapacitated: [
		{mode: "unavailable", rollTypes: ["attack"], reason: "Incapacitated"},
	],
};

export function getNpcTrackerDisplayName (npc) {
	return npc?.alias || npc?.monster?.name || "Unnamed NPC";
}

export function getNpcTrackerSignedNumber (value) {
	const num = Number(value);
	if (!Number.isFinite(num)) return `${value}`;
	return num >= 0 ? `+${num}` : `${num}`;
}

export function getNpcTrackerRollBonus ({npc, rollType, key = null, skill = null}) {
	const mon = npc?.monster || {};

	switch (rollType) {
		case "initiative": return _getFiniteNumber(Renderer.monster.getInitiativeBonusNumber({mon}), 0);
		case "ability": return _getAbilityModifier(mon, key);
		case "save": return _getFiniteNumber(mon.save?.[key], _getAbilityModifier(mon, key));
		case "skill": {
			const skillMeta = skill || _getLegacySkillMeta(key);
			const explicit = getNpcTrackerMonsterSkillMeta({monster: mon, skill: skillMeta});
			if (explicit) {
				return _getFiniteNumber(
					explicit.bonus,
					skillMeta.ability ? _getAbilityModifier(mon, skillMeta.ability) : 0,
				);
			}
			return skillMeta.ability ? _getAbilityModifier(mon, skillMeta.ability) : 0;
		}
		default: throw new Error(`Unknown NPC roll type "${rollType}".`);
	}
}

export function getNpcTrackerRollLabel ({rollType, key = null, skill = null}) {
	switch (rollType) {
		case "initiative": return "Initiative";
		case "ability": return `${Parser.attAbvToFull(key)} check`;
		case "save": return `${Parser.attAbvToFull(key)} save`;
		case "skill": return `${skill?.label || getNpcTrackerSkillKeyMeta(key).name.toTitleCase()} check`;
		case "attack": return key || "Attack roll";
		default: throw new Error(`Unknown NPC roll type "${rollType}".`);
	}
}

export function getNpcTrackerConditionRollMeta ({npc, rollType, key = null}) {
	const effects = (npc?.conditions || [])
		.flatMap(condition => (_CONDITION_ROLL_EFFECTS[`${condition}`.trim().toLowerCase()] || [])
			.filter(effect => effect.rollTypes.includes(rollType) && (!effect.keys || effect.keys.includes(key))));
	const unavailable = effects.filter(effect => effect.mode === "unavailable");
	if (unavailable.length) return _getConditionMeta({mode: "unavailable", effects: unavailable});
	const autoFail = effects.filter(effect => effect.mode === "autoFail");
	if (autoFail.length) return _getConditionMeta({mode: "autoFail", effects: autoFail});

	const advantages = effects.filter(effect => effect.mode === "advantage");
	const disadvantages = effects.filter(effect => effect.mode === "disadvantage");
	if (advantages.length && disadvantages.length) {
		return {
			mode: "normal",
			reasons: [...new Set([...advantages, ...disadvantages].map(effect => effect.reason))],
			statusText: `Normal (advantage and disadvantage cancel: ${[...new Set([...advantages, ...disadvantages].map(effect => effect.reason))].join(", ")})`,
		};
	}
	if (advantages.length) return _getConditionMeta({mode: "advantage", effects: advantages});
	if (disadvantages.length) return _getConditionMeta({mode: "disadvantage", effects: disadvantages});
	return {mode: "normal", reasons: [], statusText: ""};
}

export function getNpcTrackerNpcsForScope ({state, scope}) {
	if (scope.type === "all") return [...state.npcs];
	if (scope.type === "unsorted") return state.npcs.filter(npc => !npc.groupId);
	if (scope.type === "group") return state.npcs.filter(npc => npc.groupId === scope.groupId);
	throw new Error(`Unknown NPC batch scope "${scope.type}".`);
}

export function getNpcTrackerInitiativeHandoff ({state, batch}) {
	if (!batch || batch.isRolling || batch.rollType !== "initiative") {
		return {ok: false, message: "Complete an initiative batch before sending it."};
	}

	const npcs = getNpcTrackerNpcsForScope({state, scope: batch.scope})
		.filter(npc => batch.selectedNpcIds.has(npc.id));
	if (!npcs.length) return {ok: false, message: "Select at least one NPC."};

	const resultsByNpcId = new Map(batch.results.map(result => [result.npcId, result]));
	if (npcs.some(npc => !Number.isFinite(resultsByNpcId.get(npc.id)?.total))) {
		return {ok: false, message: "Roll initiative for every selected NPC before sending it."};
	}

	return {
		ok: true,
		entries: npcs.map(npc => ({
			npcId: npc.id,
			alias: npc.alias,
			monster: npc.monster,
			hp: {...npc.hp},
			conditions: [...npc.conditions],
			initiative: resultsByNpcId.get(npc.id).total,
		})),
	};
}

export function sortNpcTrackerBatchResults ({results, sortKey, sortDirection}) {
	const direction = sortDirection === "asc" ? 1 : -1;
	return [...results].sort((a, b) => {
		const primary = sortKey === "order"
			? SortUtil.ascSort(a.order, b.order)
			: sortKey === "name"
				? SortUtil.ascSortLower(a.name, b.name)
				: SortUtil.ascSort(a.total ?? Number.NEGATIVE_INFINITY, b.total ?? Number.NEGATIVE_INFINITY);
		if (primary) return primary * direction;
		return SortUtil.ascSort(a.order, b.order);
	});
}

export async function pRollNpcTrackerD20 ({npc, label, bonus, rollType = null, key = null}) {
	const conditionMeta = rollType
		? getNpcTrackerConditionRollMeta({npc, rollType, key})
		: {mode: "normal", reasons: [], statusText: ""};
	if (conditionMeta.mode === "unavailable") return {...conditionMeta, total: null, die: null};
	if (conditionMeta.mode === "autoFail") return {...conditionMeta, total: null, die: null};

	const d20 = conditionMeta.mode === "advantage"
		? "2d20dl1"
		: conditionMeta.mode === "disadvantage"
			? "2d20dh1"
			: "1d20";
	const rollLabel = conditionMeta.statusText ? `${label} \u2014 ${conditionMeta.statusText}` : label;
	const total = await Renderer.dice.pRoll2(`${d20}${getNpcTrackerSignedNumber(bonus)}`, {
		isUser: false,
		name: getNpcTrackerDisplayName(npc),
		label: rollLabel,
	}, {isResultUsed: true});

	if (total == null || total === Renderer.dice._SYMBOL_PARSE_FAILED || !Number.isFinite(Number(total))) return null;
	return {
		...conditionMeta,
		total: Number(total),
		die: Number(total) - Number(bonus),
	};
}

function _getConditionMeta ({mode, effects}) {
	const reasons = [...new Set(effects.map(effect => effect.reason))];
	const modeLabel = {
		advantage: "Advantage",
		disadvantage: "Disadvantage",
		autoFail: "Automatic failure",
		unavailable: "Unavailable",
	}[mode];
	return {
		mode,
		reasons,
		statusText: `${modeLabel}: ${reasons.join(", ")}`,
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

function _getLegacySkillMeta (key) {
	const {name, source} = getNpcTrackerSkillKeyMeta(key);
	const parserName = Object.keys(Parser.SKILL_TO_ATB_ABV)
		.find(it => getNpcTrackerNormalizedSkillName(it) === getNpcTrackerNormalizedSkillName(name));
	return {
		name,
		source,
		label: name.toTitleCase(),
		ability: parserName ? Parser.SKILL_TO_ATB_ABV[parserName] : null,
	};
}
