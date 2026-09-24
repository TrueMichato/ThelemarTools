import {
	getNpcTrackerRollBonus,
	getNpcTrackerRollLabel,
	getNpcTrackerSignedNumber,
	pRollNpcTrackerD20,
} from "../dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerMonsterSkillMeta} from "../dmscreen/npctracker/dmscreen-npctracker-data.js";

export const ENCOUNTER_ROLL_TYPES = [
	{id: "initiative", name: "Initiative"},
	{id: "ability", name: "Ability check"},
	{id: "save", name: "Saving throw"},
	{id: "skill", name: "Skill check"},
];

export function getEncounterInstanceLabels (instances) {
	const ordinals = new Map();
	return new Map(instances.map(instance => {
		const name = instance.monster._displayName || instance.monster.name;
		const key = `${name}|${instance.monster.source}|${instance.customHashId || ""}`;
		const ordinal = (ordinals.get(key) || 0) + 1;
		ordinals.set(key, ordinal);
		return [instance.id, `${name} #${ordinal}`];
	}));
}

export async function pRollEncounterSelection ({
	state, rollType, key = rollType === "initiative" ? "dex" : null, rollMode = "normal", skills = [], pRoll = pRollNpcTrackerD20,
}) {
	if (!ENCOUNTER_ROLL_TYPES.some(it => it.id === rollType)) throw new Error("Choose initiative, an ability check, saving throw, or skill check.");
	if (!["normal", "advantage", "disadvantage"].includes(rollMode)) throw new Error("Choose a valid roll mode.");
	const skill = rollType === "skill" ? skills.find(it => it.id === key) : null;
	if (rollType === "initiative" ? key !== "dex" : rollType === "skill" ? !skill : !Parser.ABIL_ABVS.includes(key)) {
		throw new Error("Choose a valid ability or skill.");
	}
	const label = rollType === "initiative" ? "Initiative (Dexterity check)" : getNpcTrackerRollLabel({rollType, key, skill});
	const names = getEncounterInstanceLabels(state.instances);
	const selected = new Set(state.selectedIds);
	const results = [];
	const failures = [];

	for (const instance of state.instances) {
		if (!selected.has(instance.id)) continue;
		const name = names.get(instance.id);
		try {
			const npc = {monster: instance.monster, conditions: instance.conditions, alias: name};
			if (skill && !skill.ability) {
				const explicit = getNpcTrackerMonsterSkillMeta({monster: instance.monster, skill})?.bonus;
				if (explicit == null || `${explicit}`.trim() === "" || !Number.isFinite(Number(explicit))) {
					throw new Error(`No valid bonus or governing ability is available for ${skill.label}.`);
				}
			}
			if (rollType === "initiative" && !Number.isSafeInteger(Renderer.monster.getInitiativeBonusNumber({mon: instance.monster}))) {
				throw new Error("No valid initiative bonus is available for this monster.");
			}
			const baseBonus = getNpcTrackerRollBonus({npc, rollType, key, skill});
			const scope = rollType === "save" ? "save" : "check";
			const modifiers = (instance.modifiers || []).filter(it => it.scopes.includes(scope));
			const modifierBonus = modifiers.reduce((total, it) => total + it.bonus, 0);
			const bonus = baseBonus + modifierBonus;
			if (!Number.isSafeInteger(modifierBonus) || !Number.isFinite(bonus) || ((modifiers.length || rollType === "initiative") && !Number.isSafeInteger(bonus))) {
				throw new Error("Combined roll bonus exceeds precise whole-number range.");
			}
			const bonusSources = modifiers.filter(it => it.bonus !== 0).map(it => `${it.name} ${getNpcTrackerSignedNumber(it.bonus)}`);
			const additionalEffects = [
				...modifiers.filter(it => it.mode !== "normal").map(it => ({mode: it.mode, reason: it.name})),
			];
			const initiativeMode = instance.monster.initiative?.advantageMode;
			if (rollType === "initiative" && ["adv", "dis"].includes(initiativeMode)) {
				additionalEffects.push({mode: initiativeMode === "adv" ? "advantage" : "disadvantage", reason: "Monster initiative"});
			}
			const diceLabel = bonusSources.length ? `${label} \u2014 ${bonusSources.join(", ")}` : label;
			const rolled = await pRoll({
				npc,
				label: diceLabel,
				bonus,
				rollType: rollType === "initiative" ? "ability" : rollType,
				key: rollType === "skill" ? skill.ability : key,
				rollMode,
				additionalEffects,
			});
			if (!rolled || (rollType === "initiative"
				? !Number.isSafeInteger(rolled.total) || !Number.isSafeInteger(rolled.die)
				: rolled.mode !== "autoFail" && rolled.mode !== "unavailable" && (!Number.isFinite(rolled.total) || !Number.isFinite(rolled.die)))) {
				failures.push({id: instance.id, name, reason: "Roll cancelled or dice result invalid."});
				continue;
			}
			results.push({
				id: instance.id,
				name,
				label,
				bonus,
				baseBonus,
				modifierBonus,
				...rolled,
				sourcesText: [rolled.statusText, ...bonusSources].filter(Boolean).join(" \u00b7 "),
			});
		} catch (e) {
			failures.push({id: instance.id, name, reason: String(e?.message || e)});
		}
	}

	return {results, failures};
}
