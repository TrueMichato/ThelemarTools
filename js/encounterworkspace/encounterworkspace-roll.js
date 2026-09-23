import {
	getNpcTrackerRollBonus,
	getNpcTrackerRollLabel,
	pRollNpcTrackerD20,
} from "../dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerMonsterSkillMeta} from "../dmscreen/npctracker/dmscreen-npctracker-data.js";

export const ENCOUNTER_ROLL_TYPES = [
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
	state, rollType, key, rollMode = "normal", skills = [], pRoll = pRollNpcTrackerD20,
}) {
	if (!ENCOUNTER_ROLL_TYPES.some(it => it.id === rollType)) throw new Error("Choose an ability check, saving throw, or skill check.");
	if (!["normal", "advantage", "disadvantage"].includes(rollMode)) throw new Error("Choose a valid roll mode.");
	const skill = rollType === "skill" ? skills.find(it => it.id === key) : null;
	if (rollType === "skill" ? !skill : !Parser.ABIL_ABVS.includes(key)) throw new Error("Choose a valid ability or skill.");
	const label = getNpcTrackerRollLabel({rollType, key, skill});
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
			const bonus = getNpcTrackerRollBonus({npc, rollType, key, skill});
			const rolled = await pRoll({npc, label, bonus, rollType, key: rollType === "skill" ? skill.ability : key, rollMode});
			if (!rolled || (rolled.mode !== "autoFail" && rolled.mode !== "unavailable" && (!Number.isFinite(rolled.total) || !Number.isFinite(rolled.die)))) {
				failures.push({id: instance.id, name, reason: "Roll cancelled or dice result invalid."});
				continue;
			}
			results.push({id: instance.id, name, label, bonus, ...rolled});
		} catch (e) {
			failures.push({id: instance.id, name, reason: String(e?.message || e)});
		}
	}

	return {results, failures};
}
