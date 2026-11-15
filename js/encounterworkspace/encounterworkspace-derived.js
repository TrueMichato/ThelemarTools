import {getEncounterEffectiveMonster} from "./encounterworkspace-state.js";
import {
	ENCOUNTER_ABILITIES,
	ENCOUNTER_SKILL_ABILITIES,
	encounterEffectsProvider,
	getEncounterAbilityMod,
	getEncounterBaseAc,
	getEncounterConcentration,
	getEncounterNormalizedMod,
} from "./encounterworkspace-fx.js";
import {
	createEncounterConditionsProvider,
	getEncounterConditionRule,
	getEncounterExhaustionEffects,
	getEncounterExhaustionLevel,
} from "./encounterworkspace-conditions-rules.js";
import {getEncounterDeathSaveStatus, getEncounterUsesDeathSaves} from "./encounterworkspace-deathsaves.js";
import {getNpcTrackerCanonicalConditionName} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";

/*
 * Derived numbers for one creature (mockup `derived()`): effective AC, save/check/attack/initiative modifiers,
 * speed and the advantage/disadvantage sources behind each — from instance effects, conditions and any injected
 * roll-contributor providers (battlefield, templates…). Pure, no DOM.
 *
 * Contributors (shared contract): {bonuses: [{label, value, source}], advantage, disadvantage, autoFail, autoCrit,
 * notes} where each list holds {label, source}. A provider is `(state, instance, query) => partial contributors`.
 */

const LISTS = ["bonuses", "advantage", "disadvantage", "autoFail", "autoCrit", "notes"];

export function getEmptyEncounterContributors () {
	return {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
}

/** Concatenates partial contributor objects (missing lists are fine; null/undefined entries are skipped). */
export function mergeEncounterContributors (list) {
	const out = getEmptyEncounterContributors();
	(list || []).forEach(part => {
		if (!part) return;
		LISTS.forEach(key => { if (Array.isArray(part[key])) out[key].push(...part[key]); });
	});
	return out;
}

/**
 * Every contributor for a roll: instance effects + conditions (ruleset-aware) + extra providers.
 * `query`: {kind: "attack" | "save" | "check" | "damage" | "ac" | "initiative" | "speed", ability?, skill?, targetId?,
 * concentration?}. A provider that throws is skipped and reported as a note so one bad module can't break rolls.
 */
export function getEncounterContributors (state, instance, query, providers = [], {ruleset = "phb"} = {}) {
	const all = [encounterEffectsProvider, createEncounterConditionsProvider({ruleset}), ...providers || []];
	return mergeEncounterContributors(all.map(provider => {
		try {
			return provider(state, instance, query);
		} catch (e) {
			return {notes: [{label: `A modifier source failed: ${e.message}`, source: "error"}]};
		}
	}));
}

const isDice = value => typeof value === "string" && /d/i.test(value);

/**
 * Collapses contributors onto a base modifier: flat bonuses summed into `total`, dice listed separately,
 * advantage/disadvantage resolved to a roll mode (both → normal, `cancelled` true).
 */
export function summarizeEncounterContributors (contributors, base = 0) {
	const c = mergeEncounterContributors([contributors]);
	const flat = c.bonuses.filter(it => !isDice(it.value)).reduce((sum, it) => sum + (Number(it.value) || 0), 0);
	const dice = c.bonuses.filter(it => isDice(it.value)).map(it => `${it.value}`.replace(/^\+/, ""));
	const hasAdv = c.advantage.length > 0;
	const hasDis = c.disadvantage.length > 0;
	return {
		base,
		flat,
		dice,
		total: base + flat,
		mode: hasAdv && !hasDis ? "adv" : hasDis && !hasAdv ? "dis" : "normal",
		cancelled: hasAdv && hasDis,
		advantage: c.advantage,
		disadvantage: c.disadvantage,
		autoFail: c.autoFail,
		autoCrit: c.autoCrit,
		notes: c.notes,
		bonuses: c.bonuses,
	};
}

/* -------------------------------------------- Base numbers -------------------------------------------- */

const parseBonus = value => {
	const n = Number.parseInt(`${value ?? ""}`.replace(/\s+/g, ""), 10);
	return Number.isFinite(n) ? n : null;
};

export function getEncounterSaveBase (monster, ability) {
	return parseBonus(monster?.save?.[ability]) ?? getEncounterAbilityMod(monster?.[ability]);
}

export function getEncounterCheckBase (monster, abilityOrSkill) {
	if (ENCOUNTER_ABILITIES.includes(abilityOrSkill)) return getEncounterAbilityMod(monster?.[abilityOrSkill]);
	const skill = `${abilityOrSkill || ""}`.toLowerCase();
	return parseBonus(monster?.skill?.[skill]) ?? getEncounterAbilityMod(monster?.[ENCOUNTER_SKILL_ABILITIES[skill] || "wis"]);
}

export function getEncounterInitiativeBase (instance, monster) {
	if (instance.kind === "party" && Number.isSafeInteger(instance.party?.initBonus)) return instance.party.initBonus;
	const bonus = globalThis.Renderer?.monster?.getInitiativeBonusNumber?.({mon: monster});
	return Number.isSafeInteger(bonus) ? bonus : getEncounterAbilityMod(monster?.dex);
}

export function getEncounterBaseSpeed (instance, monster) {
	if (instance.kind === "party" && Number.isSafeInteger(instance.party?.speed)) return instance.party.speed;
	const walk = monster?.speed?.walk;
	const value = typeof walk === "object" ? walk?.number : walk;
	return Number.isFinite(value) ? value : 0;
}

/* -------------------------------------------- Derived summary -------------------------------------------- */

const getConditionRules = (instance, ruleset) => [...new Set((instance.conditions || []).map(getNpcTrackerCanonicalConditionName).filter(Boolean))]
	.map(name => ({name, rule: getEncounterConditionRule(name, ruleset)}));

function getSpeed (state, instance, monster, {providers, ruleset, conditions, exhaustion}) {
	const base = getEncounterBaseSpeed(instance, monster);
	const reasons = [];
	let walk = base;
	(instance.effects || []).forEach(effect => (effect.mods || []).map(getEncounterNormalizedMod).forEach(mod => {
		if (mod.target !== "speed" || mod.kind !== "mult") return;
		walk = Math.floor(walk * Number(mod.value));
		reasons.push({label: effect.name, source: `effect:${effect.id}`, text: `×${mod.value}`});
	}));
	getEncounterContributors(state, instance, {kind: "speed"}, providers, {ruleset}).bonuses.forEach(it => {
		const value = Number(it.value) || 0;
		walk += value;
		reasons.push({label: it.label, source: it.source, text: `${value >= 0 ? "+" : "−"}${Math.abs(value)} ft.`});
	});
	if (exhaustion.speedMinus) {
		walk -= exhaustion.speedMinus;
		reasons.push({label: `Exhaustion ${exhaustion.level}`, source: "condition:exhaustion", text: `−${exhaustion.speedMinus} ft.`});
	}
	const half = conditions.filter(it => it.rule.speedHalf).map(it => it.name).concat(exhaustion.speedHalf ? [`exhaustion ${exhaustion.level}`] : []);
	if (half.length) {
		walk = Math.floor(walk / 2);
		reasons.push({label: half.join(", "), source: "condition", text: "half"});
	}
	const zero = conditions.filter(it => it.rule.speed0).map(it => it.name).concat(exhaustion.speed0 ? [`exhaustion ${exhaustion.level}`] : []);
	if (zero.length) {
		walk = 0;
		reasons.push({label: zero.join(", "), source: "condition", text: "0"});
	}
	return {base, walk: Math.max(0, walk), reasons};
}

/**
 * Everything the cockpit shows for a creature's numbers, with reasons:
 *   ac {value, base, breakdown}, saves {str: summary…}, check (plain ability check), checkFor(abilityOrSkill),
 *   attack, attacked (what attackers get), initiative, damageDice, speed {base, walk, reasons}, resist/immune/
 *   vulnerable (from effects), resistAll, incapacitated, bloodied, concentration {label, disadvantage}, exhaustion,
 *   spellDcDelta, notes, deathSaves {uses, status, value}.
 * `providers` are extra roll-contributor providers; `ruleset` and `monsterDeathSaves` come from cockpit settings.
 */
export function getEncounterDerived (state, instance, {providers = [], ruleset = "phb", monsterDeathSaves = false} = {}) {
	const monster = getEncounterEffectiveMonster(instance);
	const contrib = query => getEncounterContributors(state, instance, query, providers, {ruleset});
	const conditions = getConditionRules(instance, ruleset);
	const exhaustion = getEncounterExhaustionEffects(getEncounterExhaustionLevel(instance), ruleset);

	const acBase = getEncounterBaseAc(instance, monster);
	const acBonuses = contrib({kind: "ac"}).bonuses.filter(it => !isDice(it.value));
	const ac = {value: acBase + acBonuses.reduce((sum, it) => sum + Number(it.value), 0), base: acBase, breakdown: acBonuses};

	const saves = Object.fromEntries(ENCOUNTER_ABILITIES.map(ab => [ab, summarizeEncounterContributors(contrib({kind: "save", ability: ab}), getEncounterSaveBase(monster, ab))]));
	const checkFor = abilityOrSkill => {
		const isAbility = ENCOUNTER_ABILITIES.includes(abilityOrSkill);
		const query = isAbility ? {kind: "check", ability: abilityOrSkill} : {kind: "check", skill: `${abilityOrSkill}`.toLowerCase()};
		return summarizeEncounterContributors(contrib(query), getEncounterCheckBase(monster, abilityOrSkill));
	};

	// What attackers get against this creature: its conditions' and effects' "attacked" side only.
	const attackedParts = [];
	conditions.forEach(({name, rule}) => {
		const entry = {label: name.replace(/\b\w/g, it => it.toUpperCase()), source: `condition:${name}`};
		if (rule.attackedBy === "adv") attackedParts.push({advantage: [entry]});
		if (rule.attackedBy === "dis") attackedParts.push({disadvantage: [entry]});
		if (rule.autoCritWithin5) attackedParts.push({autoCrit: [{...entry, label: `Hit within 5 ft. is a critical (${entry.label})`}]});
	});
	(instance.effects || []).forEach(effect => (effect.mods || []).forEach(mod => {
		if (mod.target !== "attacked") return;
		const entry = {label: effect.name, source: `effect:${effect.id}`};
		attackedParts.push(mod.kind === "adv" ? {advantage: [entry]} : mod.kind === "dis" ? {disadvantage: [entry]} : null);
	}));

	const damage = contrib({kind: "damage"});
	const concentrationLabel = getEncounterConcentration(instance);
	const concentrationSave = summarizeEncounterContributors(contrib({kind: "save", ability: "con", concentration: true}), getEncounterSaveBase(monster, "con"));
	const effects = instance.effects || [];
	const notes = mergeEncounterContributors([
		{notes: conditions.filter(it => it.rule.note).map(({name, rule}) => ({label: `${name.replace(/\b\w/g, it => it.toUpperCase())}: ${rule.note}`, source: `condition:${name}`}))},
		{notes: effects.filter(it => it.note).map(it => ({label: `${it.name}: ${it.note}`, source: `effect:${it.id}`}))},
	]).notes;

	return {
		ruleset,
		ac,
		saves,
		check: summarizeEncounterContributors(contrib({kind: "check"}), 0),
		checkFor,
		attack: summarizeEncounterContributors(contrib({kind: "attack"}), 0),
		attackAgainst: targetId => summarizeEncounterContributors(contrib({kind: "attack", targetId}), 0),
		attacked: summarizeEncounterContributors(mergeEncounterContributors(attackedParts), 0),
		initiative: summarizeEncounterContributors(contrib({kind: "initiative"}), getEncounterInitiativeBase(instance, monster)),
		damageDice: damage.bonuses.map(it => typeof it.value === "number" ? `${it.value >= 0 ? "+" : ""}${it.value}` : `${it.value}`),
		damage: summarizeEncounterContributors(damage, 0),
		speed: getSpeed(state, instance, monster, {providers, ruleset, conditions, exhaustion}),
		resist: [...new Set(effects.flatMap(it => it.resist || []))],
		immune: [...new Set([...effects.flatMap(it => it.immune || []), ...conditions.flatMap(it => it.rule.immune || [])])],
		vulnerable: [...new Set(effects.flatMap(it => it.vulnerable || []))],
		resistAll: conditions.filter(it => it.rule.resistAll).map(it => it.name),
		incapacitated: conditions.filter(it => it.rule.incap).map(it => it.name),
		bloodied: instance.hp.current > 0 && instance.hp.current <= Math.floor(instance.hp.max / 2),
		concentration: concentrationLabel ? {
			label: concentrationLabel,
			save: concentrationSave,
			disadvantage: concentrationSave.disadvantage.filter(it => /concentration/.test(it.label)),
		} : null,
		exhaustion,
		spellDcDelta: -exhaustion.dcMinus,
		notes,
		deathSaves: {
			uses: getEncounterUsesDeathSaves(instance, {monsterDeathSaves}),
			status: getEncounterDeathSaveStatus(instance),
			value: instance.deathSaves ? {...instance.deathSaves} : null,
		},
	};
}

/**
 * Applies effect/condition damage adjustments (on top of the statblock's own resistances, which the damage module
 * handles): immune → 0; resistant or Petrified → half; vulnerable → double. Returns {amount, notes}.
 */
export function getEncounterDerivedDamage (derived, amount, damageType) {
	let value = Math.max(0, Math.floor(Number(amount) || 0));
	const notes = [];
	if (!damageType) return {amount: value, notes};
	if (derived.immune.includes(damageType)) return {amount: 0, notes: ["immune"]};
	if (derived.resist.includes(damageType) || derived.resistAll.length) {
		value = Math.floor(value / 2);
		notes.push("resisted");
	}
	if (derived.vulnerable.includes(damageType)) {
		value *= 2;
		notes.push("vulnerable");
	}
	return {amount: value, notes};
}
