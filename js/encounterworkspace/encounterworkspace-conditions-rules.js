import {getNpcTrackerCanonicalConditionName} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {
	endEncounterConcentration,
	getEncounterConcentration,
	getEncounterNormalizedRounds,
	startEncounterConcentration,
	tickEncounterEffectDurations,
} from "./encounterworkspace-fx.js";

/*
 * Mechanical condition rules for the encounter cockpit (PHB 2014, XPHB 2024 and TGTT), as pure data plus draft
 * reducers and a roll-contributor provider. No DOM.
 *
 * Rule fields:
 *   attack / attackedBy: "adv" | "dis"      checks: "adv" | "dis"      saves: {str: "adv" | "dis" | "autoFail", …}
 *   speed0 / speedHalf                     incap (breaks concentration)  resistAll (damage)    immune: [damage types]
 *   initAdv / initDis                      concDis (concentration saves at disadvantage)
 *   autoCritWithin5 (hits from within 5 ft. are critical)               adds: [conditions applied alongside]
 *   exhaustion: "phb" | "xphb" | "tgtt"    note: reminder that can't be automated
 * Every condition the user can pick from `getEncounterConditionCatalog` has at least one mechanic or a note.
 */

const SD = Object.freeze({str: "autoFail", dex: "autoFail"});

export const ENCOUNTER_PHB_CONDITION_RULES = {
	blinded: {attack: "dis", attackedBy: "adv", note: "Fails ability checks that need sight."},
	charmed: {note: "Can't attack the charmer; the charmer has advantage on social checks against it."},
	deafened: {note: "Fails ability checks that need hearing."},
	frightened: {attack: "dis", checks: "dis", note: "Only while the source of fear is in sight; can't move closer to it."},
	grappled: {speed0: true, note: "Ends if the grappler is incapacitated or it is moved out of reach."},
	incapacitated: {incap: true, note: "No actions or reactions."},
	invisible: {attack: "adv", attackedBy: "dis", note: "Heavily obscured for hiding; location can still be detected."},
	paralyzed: {incap: true, speed0: true, saves: SD, attackedBy: "adv", autoCritWithin5: true, note: "Can't move or speak; hits from within 5 ft. are critical."},
	petrified: {incap: true, speed0: true, saves: SD, attackedBy: "adv", resistAll: true, immune: ["poison"], note: "Resistance to all damage; immune to poison and disease."},
	poisoned: {attack: "dis", checks: "dis"},
	prone: {attack: "dis", attackedBy: "adv", note: "Attacks from within 5 ft. have advantage; ranged attacks have disadvantage instead. Standing costs half its speed."},
	restrained: {speed0: true, attack: "dis", attackedBy: "adv", saves: {dex: "dis"}},
	stunned: {incap: true, speed0: true, saves: SD, attackedBy: "adv", note: "Can speak only falteringly."},
	unconscious: {incap: true, speed0: true, saves: SD, attackedBy: "adv", autoCritWithin5: true, adds: ["prone"], note: "Drops what it holds and falls prone; hits from within 5 ft. are critical."},
	exhaustion: {exhaustion: "phb"},
	concentrating: {note: "Damage forces a CON save (DC 10 or half the damage); incapacitation ends it."},
	dodging: {attackedBy: "dis", saves: {dex: "adv"}, note: "Lost if incapacitated or its speed drops to 0."},
	hidden: {attack: "adv", attackedBy: "dis", note: "Revealed when it attacks or makes noise."},
};

/** 2024 rules: differences from the PHB table. */
export const ENCOUNTER_XPHB_CONDITION_RULES = {
	exhaustion: {exhaustion: "xphb"},
	grappled: {speed0: true, attack: "dis", note: "Disadvantage on attacks against anyone but the grappler."},
	incapacitated: {incap: true, initDis: true, note: "No actions, bonus actions or reactions; can't speak."},
	invisible: {attack: "adv", attackedBy: "dis", initAdv: true, note: "Not affected by effects that need sight unless the source can see it."},
	petrified: {incap: true, initDis: true, speed0: true, saves: SD, attackedBy: "adv", resistAll: true, immune: ["poison"], note: "Resistance to all damage; immune to the Poisoned condition."},
	paralyzed: {...ENCOUNTER_PHB_CONDITION_RULES.paralyzed, initDis: true},
	unconscious: {...ENCOUNTER_PHB_CONDITION_RULES.unconscious, initDis: true},
	stunned: {incap: true, initDis: true, saves: SD, attackedBy: "adv", note: "Incapacitated; no bonus actions or reactions."},
};

/** Traveler's Guide to Thelemar: only used when the TGTT ruleset is active. */
export const ENCOUNTER_TGTT_CONDITION_RULES = {
	exhaustion: {exhaustion: "tgtt"},
	incapacitated: {incap: true, initDis: true, note: "No actions, reactions or speech."},
	slowed: {speedHalf: true, attackedBy: "adv", saves: {dex: "dis"}, note: "Every foot of movement costs 1 extra foot."},
	hidden: {attack: "adv", attackedBy: "dis", note: "Unseen; its location may still be deduced."},
	invisible: {attack: "adv", attackedBy: "dis", note: "Hidden from creatures that rely on sight."},
	undetected: {note: "Location unknown (must be Hidden); may grant advantage on initiative when surprising."},
	petrified: {incap: true, initDis: true, speed0: true, saves: SD, attackedBy: "adv", resistAll: true, immune: ["poison"], note: "Immune to the Poisoned condition."},
	stunned: {incap: true, initDis: true, speed0: true, saves: SD, attackedBy: "adv", note: "Speaks only falteringly."},
	dazed: {note: "Move or one action, not both; no bonus action or reaction."},
	choked: {note: "Verbal spells need a concentration check first; holds its breath for half as long."},
	grappled: {speed0: true, attack: "dis", note: "Attack disadvantage is against anyone but the grappler; somatic spells need a concentration check."},
	restrained: {speed0: true, attack: "dis", attackedBy: "adv", saves: {dex: "dis"}, note: "Somatic spells are automatically disrupted."},
	poisoned: {attack: "dis", checks: "dis", concDis: true},
	frightened: {attack: "dis", checks: "dis", note: "Verbal spells need a concentration check first."},
	prone: {attack: "dis", attackedBy: "adv", note: "Ranged attacks against it have disadvantage; being knocked prone forces a concentration check."},
};

export const ENCOUNTER_TGTT_ONLY_CONDITIONS = ["slowed", "undetected", "dazed", "choked"];
const BASE_CONDITIONS = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];
const STATES = ["concentrating", "dodging", "hidden"];

/** Exhaustion level at which the creature dies, per ruleset. TGTT: "you die if your exhaustion level exceeds 10". */
export const ENCOUNTER_EXHAUSTION_DEATH_LEVEL = {phb: 6, xphb: 6, tgtt: 11};

const noopLog = () => {};
const getName = instance => instance.label || instance.monster?.name || instance.id;
const canonical = name => getNpcTrackerCanonicalConditionName(name);
const titleCase = name => name.replace(/\b\w/g, it => it.toUpperCase());

/** The mechanical rule for a condition under a ruleset. TGTT-only conditions are inert outside the TGTT ruleset. */
export function getEncounterConditionRule (name, ruleset = "phb") {
	const key = canonical(name);
	if (!key) return {};
	if (ruleset === "tgtt" && ENCOUNTER_TGTT_CONDITION_RULES[key]) return ENCOUNTER_TGTT_CONDITION_RULES[key];
	if (ruleset === "xphb" && ENCOUNTER_XPHB_CONDITION_RULES[key]) return ENCOUNTER_XPHB_CONDITION_RULES[key];
	if (ENCOUNTER_PHB_CONDITION_RULES[key]) return ENCOUNTER_PHB_CONDITION_RULES[key];
	if (ENCOUNTER_TGTT_ONLY_CONDITIONS.includes(key)) return {inactive: true, note: "TGTT condition — no automated effect unless the TGTT rules are on."};
	return {custom: true, note: "Custom condition — no automated effect."};
}

/** Conditions and states the user can apply under a ruleset, each with its rule. */
export function getEncounterConditionCatalog (ruleset = "phb") {
	const names = [...BASE_CONDITIONS, ...ruleset === "tgtt" ? ENCOUNTER_TGTT_ONLY_CONDITIONS : [], ...STATES];
	return names.map(name => ({
		name,
		label: titleCase(name),
		kind: STATES.includes(name) ? "state" : "condition",
		rule: getEncounterConditionRule(name, ruleset),
	}));
}

/** Mechanics that a rule automates (for "does this condition do anything" checks and UI badges). */
export function getEncounterConditionMechanics (rule) {
	return ["attack", "attackedBy", "checks", "saves", "speed0", "speedHalf", "incap", "resistAll", "immune", "initAdv", "initDis", "concDis", "autoCritWithin5", "exhaustion"]
		.filter(key => rule?.[key]);
}

/* -------------------------------------------- Exhaustion -------------------------------------------- */

export function getEncounterExhaustionLevel (instance) {
	if (!(instance?.conditions || []).map(canonical).includes("exhaustion")) return 0;
	const level = Number(instance.conditionDetails?.exhaustion?.level);
	return Number.isSafeInteger(level) && level > 0 ? level : 1;
}

/** What an exhaustion level does under a ruleset. */
export function getEncounterExhaustionEffects (level, ruleset = "phb") {
	const mode = getEncounterConditionRule("exhaustion", ruleset).exhaustion;
	const out = {level, mode, d20Minus: 0, dcMinus: 0, speedMinus: 0, checksDis: false, attackDis: false, savesDis: false, speedHalf: false, speed0: false, hpMaxHalf: false, dead: false};
	if (!level) return out;
	out.dead = level >= ENCOUNTER_EXHAUSTION_DEATH_LEVEL[mode];
	if (mode === "phb") {
		out.checksDis = level >= 1;
		out.speedHalf = level >= 2;
		out.attackDis = out.savesDis = level >= 3;
		out.hpMaxHalf = level >= 4;
		out.speed0 = level >= 5;
	} else if (mode === "xphb") {
		out.d20Minus = 2 * level;
		out.speedMinus = 5 * level;
	} else {
		out.d20Minus = level;
		out.dcMinus = level;
	}
	return out;
}

/* -------------------------------------------- Draft reducers -------------------------------------------- */

function getInstance (draft, id) {
	const instance = draft.instances.find(it => it.id === id);
	if (!instance) throw new Error("This encounter creature no longer exists.");
	return instance;
}

function getTargets (draft, targetIds) {
	const ids = [...new Set([].concat(targetIds ?? draft.selectedIds ?? []).filter(Boolean))];
	if (!ids.length) throw new Error("Select at least one creature.");
	return ids.map(id => getInstance(draft, id));
}

function addOne (draft, instance, name, {rounds, level, source, label, ruleset, log}) {
	if (name === "concentrating") {
		startEncounterConcentration(draft, instance.id, label || getEncounterConcentration(instance) || "Concentration", {log});
	} else {
		const isNew = !instance.conditions.includes(name);
		if (isNew) instance.conditions.push(name);
		const details = {rounds: null, ...instance.conditionDetails[name]};
		if (rounds !== undefined) details.rounds = getEncounterNormalizedRounds(rounds);
		if (source != null && isNew) details.source = source;
		if (name === "exhaustion") details.level = Math.max(1, Math.round(Number(level ?? details.level ?? 1)) || 1);
		instance.conditionDetails = {...instance.conditionDetails, [name]: details};
	}
	const rule = getEncounterConditionRule(name, ruleset);
	// Chained conditions outlast their cause (Prone stays after waking), so they don't inherit the duration.
	(rule.adds || []).forEach(extra => { if (!instance.conditions.includes(extra)) addOne(draft, instance, extra, {source, ruleset, log}); });
	if (rule.incap && getEncounterConcentration(instance)) endEncounterConcentration(draft, instance.id, {reason: `is ${name}`, log});
	if (name === "exhaustion") {
		const effects = getEncounterExhaustionEffects(getEncounterExhaustionLevel(instance), ruleset);
		if (effects.dead && !instance.defeated) {
			instance.defeated = true;
			log("effect", `${getName(instance)} dies of exhaustion (level ${effects.level}).`, {target: instance.id});
		}
	}
}

/**
 * Applies a condition to the targets with its chained rules: Unconscious also adds Prone; any incapacitating
 * condition ends concentration (and its linked effects); "concentrating" starts concentration on `label`.
 * Re-applying keeps the condition and updates rounds/level when given.
 */
export function applyEncounterCondition (draft, {targetIds, condition, rounds, level, source = null, label = null, ruleset = "phb", log = noopLog} = {}) {
	const name = canonical(condition);
	if (!name) throw new Error("Choose a condition.");
	const targets = getTargets(draft, targetIds);
	targets.forEach(instance => addOne(draft, instance, name, {rounds, level, source, label, ruleset, log}));
	log("effect", `${titleCase(name)}${name === "exhaustion" && level ? ` ${level}` : ""}${rounds ? ` (${rounds} rnd)` : ""} → ${targets.map(getName).join(", ")}`, {targets: targets.map(it => it.id)});
	return targets.map(it => it.id);
}

/** Removes a condition. Removing "concentrating" ends concentration and every effect linked to it. */
export function removeEncounterCondition (draft, {targetIds, condition, log = noopLog} = {}) {
	const name = canonical(condition);
	if (!name) throw new Error("Choose a condition.");
	const changed = [];
	getTargets(draft, targetIds).forEach(instance => {
		if (name === "concentrating" && getEncounterConcentration(instance)) endEncounterConcentration(draft, instance.id, {reason: "dropped concentration", log});
		if (!instance.conditions.includes(name)) return;
		instance.conditions = instance.conditions.filter(it => it !== name);
		const {[name]: _, ...rest} = instance.conditionDetails;
		instance.conditionDetails = rest;
		changed.push(instance.id);
	});
	if (changed.length) log("effect", `${titleCase(name)} removed from ${changed.map(id => getName(getInstance(draft, id))).join(", ")}.`);
	return changed;
}

/** Sets the exhaustion level; 0 removes the condition. Reaching the ruleset's death level marks the creature defeated. */
export function setEncounterExhaustion (draft, {targetIds, level, ruleset = "phb", log = noopLog} = {}) {
	const n = Math.round(Number(level));
	if (!Number.isSafeInteger(n) || n < 0) throw new Error("Choose an exhaustion level.");
	const max = ENCOUNTER_EXHAUSTION_DEATH_LEVEL[getEncounterConditionRule("exhaustion", ruleset).exhaustion];
	if (!n) return removeEncounterCondition(draft, {targetIds, condition: "exhaustion", log});
	return applyEncounterCondition(draft, {targetIds, condition: "exhaustion", level: Math.min(n, max), ruleset, log});
}

/** Edits a condition's remaining rounds (null/"" = until removed). */
export function setEncounterConditionRounds (draft, {instanceId, condition, rounds}) {
	const instance = getInstance(draft, instanceId);
	const name = canonical(condition);
	if (!instance.conditions.includes(name)) throw new Error("This condition is no longer applied.");
	instance.conditionDetails = {...instance.conditionDetails, [name]: {...instance.conditionDetails[name], rounds: getEncounterNormalizedRounds(rounds)}};
	return instance.conditionDetails[name];
}

/** Counts down timed conditions by one round and removes expired ones. Returns [{instanceId, condition}]. */
export function tickEncounterConditionDurations (draft, {ids = null, log = noopLog} = {}) {
	const only = ids ? new Set(ids) : null;
	const ended = [];
	draft.instances.forEach(instance => {
		if (only && !only.has(instance.id)) return;
		Object.entries(instance.conditionDetails || {}).forEach(([name, details]) => {
			if (details?.rounds == null || !instance.conditions.includes(name)) return;
			const rounds = Math.max(0, details.rounds - 1);
			if (rounds > 0) {
				instance.conditionDetails = {...instance.conditionDetails, [name]: {...details, rounds}};
				return;
			}
			removeEncounterCondition(draft, {targetIds: [instance.id], condition: name});
			ended.push({instanceId: instance.id, condition: name});
			log("effect", `${titleCase(name)} ended on ${getName(instance)}.`, {target: instance.id});
		});
	});
	return ended;
}

/** Round-wrap tick for both conditions and effects (mockup `tickDurations`). */
export function tickEncounterDurations (draft, {ids = null, log = noopLog} = {}) {
	return {
		conditions: tickEncounterConditionDurations(draft, {ids, log}),
		effects: tickEncounterEffectDurations(draft, {ids, log}),
	};
}

/* -------------------------------------------- Roll contributors -------------------------------------------- */

const getRules = (instance, ruleset) => [...new Set((instance?.conditions || []).map(canonical).filter(Boolean))]
	.map(name => ({name, label: titleCase(name), source: `condition:${name}`, rule: getEncounterConditionRule(name, ruleset)}));

function addMode (out, mode, entry) {
	if (mode === "adv") out.advantage.push(entry);
	else if (mode === "dis") out.disadvantage.push(entry);
	else if (mode === "autoFail") out.autoFail.push(entry);
}

function addExhaustion (out, instance, ruleset, isDis) {
	const effects = getEncounterExhaustionEffects(getEncounterExhaustionLevel(instance), ruleset);
	if (!effects.level) return;
	const entry = {label: `Exhaustion ${effects.level}`, source: "condition:exhaustion"};
	if (isDis(effects)) out.disadvantage.push(entry);
	if (effects.d20Minus) out.bonuses.push({...entry, value: -effects.d20Minus});
}

/** Roll contributors from an instance's conditions (and, for attacks, the target's conditions). */
export function getEncounterConditionContributors (state, instance, query, {ruleset = "phb"} = {}) {
	const out = {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
	const rules = getRules(instance, ruleset);
	const withNote = (entry, rule) => { if (rule.note) out.notes.push({label: `${entry.label}: ${rule.note}`, source: entry.source}); };
	switch (query.kind) {
		case "attack": {
			rules.forEach(({rule, ...entry}) => { if (rule.attack) { addMode(out, rule.attack, entry); withNote(entry, rule); } });
			addExhaustion(out, instance, ruleset, it => it.attackDis);
			const target = query.targetId ? state.instances.find(it => it.id === query.targetId) : null;
			getRules(target, ruleset).forEach(({rule, ...entry}) => {
				const targetEntry = {...entry, label: `Target ${entry.label.toLowerCase()}`};
				if (rule.attackedBy) { addMode(out, rule.attackedBy, targetEntry); withNote(targetEntry, rule); }
				if (rule.autoCritWithin5) out.autoCrit.push({label: `Hit within 5 ft. is a critical (${entry.label})`, source: entry.source});
			});
			break;
		}
		case "save": {
			rules.forEach(({rule, ...entry}) => {
				const mode = query.ability && rule.saves?.[query.ability];
				if (mode) addMode(out, mode, entry);
				if (query.concentration && rule.concDis) out.disadvantage.push({...entry, label: `${entry.label} (concentration)`});
			});
			addExhaustion(out, instance, ruleset, it => it.savesDis);
			break;
		}
		case "check": {
			rules.forEach(({rule, ...entry}) => { if (rule.checks) { addMode(out, rule.checks, entry); withNote(entry, rule); } });
			rules.filter(({name}) => name === "blinded" || name === "deafened")
				.forEach(({rule, ...entry}) => withNote(entry, rule));
			addExhaustion(out, instance, ruleset, it => it.checksDis);
			break;
		}
		case "initiative": {
			rules.forEach(({rule, ...entry}) => {
				if (rule.initAdv) out.advantage.push(entry);
				if (rule.initDis) out.disadvantage.push(entry);
			});
			addExhaustion(out, instance, ruleset, () => false);
			break;
		}
		default: break;
	}
	return out;
}

/** Provider factory for `getEncounterContributors`: binds the ruleset. */
export function createEncounterConditionsProvider ({ruleset = "phb"} = {}) {
	return (state, instance, query) => getEncounterConditionContributors(state, instance, query, {ruleset});
}
