import {
	getNpcTrackerRollBonus,
	getNpcTrackerConditionRollMeta,
	getNpcTrackerRollLabel,
	getNpcTrackerSignedNumber,
	pRollNpcTrackerD20,
} from "../dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerMonsterSkillMeta} from "../dmscreen/npctracker/dmscreen-npctracker-data.js";
import {
	getEncounterModifierAppliesToRoll,
	getEncounterPreset,
	getEncounterPresetCitation,
} from "./encounterworkspace-effects.js";
import {getEncounterEffectiveMonster} from "./encounterworkspace-state.js";

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

const pConfirmRollContext = ({question, source}) => InputUiUtil.pGetUserBoolean({
	title: "Roll effect context",
	htmlDescription: `${source}: ${question}`,
	textYes: "Yes, apply",
	textNo: "No, skip",
});

export function getEncounterRollFromPackedDice (entry) {
	if (entry?.subType !== "d20") return null;
	const context = entry.context || {};
	const rollType = {
		abilityCheck: "ability",
		savingThrow: "save",
		skillCheck: "skill",
		initiative: "initiative",
		hit: "attack",
	}[context.type];
	if (!rollType) return {unsupported: "This d20 link has no recognized check, save, initiative, or attack context. Roll effects were not applied."};
	if (["ability", "save"].includes(rollType) && !Parser.ABIL_ABVS.includes(context.ability)) {
		return {unsupported: "This d20 link has no known ability; roll effects were not applied."};
	}
	if (rollType === "skill" && (typeof context.skill !== "string" || !context.skill.trim())) {
		return {unsupported: "This skill link has no identifiable skill; roll effects were not applied."};
	}
	const match = typeof entry.toRoll === "string" && /^\s*1d20\s*([+-]\s*\d+)?\s*$/i.exec(entry.toRoll);
	const bonus = match ? Number((match[1] || "0").replace(/\s/g, "")) : NaN;
	if (!Number.isSafeInteger(bonus)) {
		return {unsupported: "This d20 link has a dynamic or compound bonus; roll effects cannot safely be applied. Use the normal dice link instead."};
	}
	const key = rollType === "skill" ? context.skill.trim().toLowerCase() : rollType === "attack" ? "Attack roll" : rollType === "initiative" ? "dex" : context.ability;
	const label = rollType === "skill" ? `${context.skill.trim()} check` : rollType === "attack" ? "Attack roll" : rollType === "initiative"
		? "Initiative (Dexterity check)" : getNpcTrackerRollLabel({rollType, key});
	return {rollType, key, label, baseBonus: bonus};
}

export async function pRollEncounterInstance ({
	instance, name, rollType, key, label, skill = null, rollMode = "normal",
	baseBonus = getNpcTrackerRollBonus({npc: {monster: getEncounterEffectiveMonster(instance)}, rollType, key, skill}),
	pRoll = pRollNpcTrackerD20, pConfirmContext = pConfirmRollContext,
}) {
	const monster = getEncounterEffectiveMonster(instance);
	const npc = {monster, conditions: [...(instance.conditions || [])], alias: name};
	const npcRollType = rollType === "initiative" ? "ability" : rollType;
	const npcKey = rollType === "skill" ? skill?.ability : key;
	const conditionMeta = getNpcTrackerConditionRollMeta({npc, rollType: npcRollType, key: npcKey});
	if (["autoFail", "unavailable"].includes(conditionMeta.mode)) {
		const rolled = await pRoll({npc, label, bonus: baseBonus, rollType: npcRollType, key: npcKey});
		if (rolled?.mode !== conditionMeta.mode) throw new Error("A condition prevented this roll, but the dice result did not reflect it.");
		return {id: instance.id, name, label, bonus: baseBonus, baseBonus, modifierBonus: 0, ...rolled, sourcesText: rolled.statusText};
	}
	for (const [condition, question] of [
		["frightened", "Is the source of this creature's fear in sight?"],
		["invisible", "Can the attack target NOT see this invisible creature?"],
	]) {
		if (!npc.conditions.includes(condition)
			|| (condition === "frightened" && !["ability", "skill", "initiative", "attack"].includes(rollType))
			|| (condition === "invisible" && rollType !== "attack")) continue;
		const applies = await pConfirmContext({question, source: condition, name});
		if (applies == null) throw new Error(`Context confirmation cancelled for ${condition}; no die was rolled.`);
		if (!applies) npc.conditions = npc.conditions.filter(it => it !== condition);
	}
	const modifiers = [];
	for (const modifier of instance.modifiers || []) {
		if (!getEncounterModifierAppliesToRoll(modifier, {rollType, key})) continue;
		if (modifier.presetId) {
			const preset = getEncounterPreset(modifier.presetId);
			if (preset.contextQuestion) {
				const applies = await pConfirmContext({question: preset.contextQuestion, source: getEncounterPresetCitation(preset), name});
				if (applies == null) throw new Error(`Context confirmation cancelled for ${preset.name}; no die was rolled.`);
				if (!applies) continue;
			}
		}
		modifiers.push(modifier);
	}
	const modifierBonus = modifiers.reduce((total, it) => total + it.bonus, 0);
	const bonus = baseBonus + modifierBonus;
	if (!Number.isSafeInteger(modifierBonus) || !Number.isFinite(bonus) || ((modifiers.length || rollType === "initiative") && !Number.isSafeInteger(bonus))) {
		throw new Error("Combined roll bonus exceeds precise whole-number range.");
	}
	const sourceName = modifier => modifier.presetId
		? `${modifier.name} (${getEncounterPresetCitation(getEncounterPreset(modifier.presetId))})`
		: modifier.name;
	const bonusSources = modifiers.filter(it => it.bonus !== 0).map(it => `${sourceName(it)} ${getNpcTrackerSignedNumber(it.bonus)}`);
	const additionalEffects = modifiers.filter(it => it.mode !== "normal").map(it => ({mode: it.mode, reason: sourceName(it)}));
	const initiativeMode = monster.initiative?.advantageMode;
	if (rollType === "initiative" && ["adv", "dis"].includes(initiativeMode)) {
		additionalEffects.push({mode: initiativeMode === "adv" ? "advantage" : "disadvantage", reason: "Monster initiative"});
	}
	const diceLabel = bonusSources.length ? `${label} \u2014 ${bonusSources.join(", ")}` : label;
	const rolled = await pRoll({
		npc,
		label: diceLabel,
		bonus,
		rollType: npcRollType,
		key: npcKey,
		rollMode,
		additionalEffects,
	});
	if (!rolled || (rollType === "initiative"
		? !Number.isSafeInteger(rolled.total) || !Number.isSafeInteger(rolled.die)
		: rolled.mode !== "autoFail" && rolled.mode !== "unavailable" && (!Number.isFinite(rolled.total) || !Number.isFinite(rolled.die)))) {
		throw new Error("Roll cancelled or dice result invalid.");
	}
	return {id: instance.id, name, label, bonus, baseBonus, modifierBonus, ...rolled, sourcesText: [rolled.statusText, ...bonusSources].filter(Boolean).join(" \u00b7 ")};
}

export async function pRollEncounterSelection ({
	state, rollType, key = rollType === "initiative" ? "dex" : null, rollMode = "normal", skills = [], pRoll = pRollNpcTrackerD20, pConfirmContext = pConfirmRollContext,
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
			const monster = getEncounterEffectiveMonster(instance);
			if (skill && !skill.ability) {
				const explicit = getNpcTrackerMonsterSkillMeta({monster, skill})?.bonus;
				if (explicit == null || `${explicit}`.trim() === "" || !Number.isFinite(Number(explicit))) {
					throw new Error(`No valid bonus or governing ability is available for ${skill.label}.`);
				}
			}
			if (rollType === "initiative" && !Number.isSafeInteger(Renderer.monster.getInitiativeBonusNumber({mon: monster}))) {
				throw new Error("No valid initiative bonus is available for this monster.");
			}
			results.push(await pRollEncounterInstance({
				instance, name, rollType, key, label, skill, rollMode, pRoll, pConfirmContext,
			}));
		} catch (e) {
			failures.push({id: instance.id, name, reason: String(e?.message || e)});
		}
	}

	return {results, failures};
}
