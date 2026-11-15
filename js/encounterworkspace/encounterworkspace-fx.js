import {getNpcTrackerCanonicalConditionName} from "../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {EncounterWorkspaceState, cloneEncounterState} from "./encounterworkspace-state.js";

/*
 * Instance effects (buffs, debuffs, items, cover) for the encounter cockpit — pure rules, no DOM.
 *
 * An effect lives on `instance.effects[]`:
 *   {id, key, name, kind, mods: [{target, kind, value, skill?, addDex?}], rounds, totalRounds, startRound,
 *    casterId, concOn, conc, spell: {name, source} | null, note, resist: [], immune: [], vulnerable: [], cover, source}
 * `rounds` is the remaining duration (null = until removed). A concentration effect cast by a creature carries
 * `casterId` + `concOn` (the caster's concentration label); when the caster's concentration ends or switches,
 * every effect linked to the old label is removed from every creature.
 *
 * Reducers named `apply*` / `remove*` / `set*` / `tick*` / `start*` / `end*` mutate a draft (the engine's pCommit
 * recipe draft) and take an optional `log(kind, text, extra)`. `withEncounterDraft` runs any of them on an immutable
 * state and validates the result.
 */

export const ENCOUNTER_ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
export const ENCOUNTER_ABILITY_NAMES = Object.freeze({str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"});
export const ENCOUNTER_SKILL_ABILITIES = Object.freeze({
	"acrobatics": "dex",
	"animal handling": "wis",
	"arcana": "int",
	"athletics": "str",
	"deception": "cha",
	"history": "int",
	"insight": "wis",
	"intimidation": "cha",
	"investigation": "int",
	"medicine": "wis",
	"nature": "int",
	"perception": "wis",
	"performance": "cha",
	"persuasion": "cha",
	"religion": "int",
	"sleight of hand": "dex",
	"stealth": "dex",
	"survival": "wis",
});

const D20_KINDS = ["flat", "dice", "adv", "dis", "autoFail"];
/** Everything a custom effect modifier can target, with the kinds that make sense for it. */
export const ENCOUNTER_MOD_TARGETS = [
	{value: "ac", label: "AC", kinds: ["flat", "set"]},
	{value: "attack", label: "Attack rolls", kinds: D20_KINDS.filter(it => it !== "autoFail")},
	{value: "attacked", label: "Attacks against it", kinds: ["adv", "dis"]},
	{value: "saves", label: "All saves", kinds: D20_KINDS},
	...ENCOUNTER_ABILITIES.map(ab => ({value: `save:${ab}`, label: `${ab.toUpperCase()} save`, kinds: D20_KINDS})),
	{value: "checks", label: "Ability checks", kinds: D20_KINDS},
	...ENCOUNTER_ABILITIES.map(ab => ({value: `check:${ab}`, label: `${ab.toUpperCase()} checks`, kinds: D20_KINDS})),
	{value: "skill", label: "A skill…", kinds: D20_KINDS},
	{value: "damage", label: "Damage", kinds: ["flat", "dice"]},
	{value: "speed", label: "Speed", kinds: ["flat", "mult"]},
	{value: "init", label: "Initiative", kinds: D20_KINDS.filter(it => it !== "autoFail")},
];
export const ENCOUNTER_MOD_KINDS = [
	{value: "flat", label: "+N / −N"},
	{value: "dice", label: "Dice (+1d4)"},
	{value: "adv", label: "Advantage"},
	{value: "dis", label: "Disadvantage"},
	{value: "autoFail", label: "Auto-fail"},
	{value: "set", label: "Set base (+ DEX)"},
	{value: "mult", label: "Multiply"},
];
const MOD_TARGET_BY_VALUE = new Map(ENCOUNTER_MOD_TARGETS.map(it => [it.value, it]));

export const ENCOUNTER_DUR_UNITS = {round: 1, min: 10, hour: 600};
export const ENCOUNTER_EFFECT_KINDS = ["buff", "debuff", "item", "cover", "custom"];

const spellPreset = (key, name, kind, mods, {duration, conc = true, spell = key.replace(/-/g, " "), note = "", ...rest} = {}) => ({
	key, name, kind, mods, duration, conc, spell, note, resist: [], immune: [], vulnerable: [], cover: false, ...rest,
});

/** Common buffs and debuffs linked to the real spells. Durations in rounds (1 min = 10 rounds). */
export const ENCOUNTER_BUFF_PRESETS = [
	spellPreset("bless", "Bless", "buff", [{target: "attack", kind: "dice", value: "1d4"}, {target: "saves", kind: "dice", value: "1d4"}], {duration: 10}),
	spellPreset("bane", "Bane", "debuff", [{target: "attack", kind: "dice", value: "-1d4"}, {target: "saves", kind: "dice", value: "-1d4"}], {duration: 10}),
	spellPreset("shield-of-faith", "Shield of Faith", "buff", [{target: "ac", kind: "flat", value: 2}], {duration: 100}),
	spellPreset("haste", "Haste", "buff", [
		{target: "ac", kind: "flat", value: 2},
		{target: "speed", kind: "mult", value: 2},
		{target: "save:dex", kind: "adv", value: ""},
	], {duration: 10, note: "One extra limited action each turn; lethargic for a turn when it ends."}),
	spellPreset("slow", "Slow", "debuff", [
		{target: "ac", kind: "flat", value: -2},
		{target: "save:dex", kind: "flat", value: -2},
		{target: "speed", kind: "mult", value: 0.5},
	], {duration: 10, note: "No reactions; an action or a bonus action, not both."}),
	spellPreset("faerie-fire", "Faerie Fire", "debuff", [{target: "attacked", kind: "adv", value: ""}], {duration: 10, note: "Can't benefit from being invisible."}),
	spellPreset("hex", "Hex", "debuff", [], {duration: 600, note: "+1d6 necrotic from the hexer; disadvantage on checks with one chosen ability."}),
	spellPreset("hunters-mark", "Hunter's Mark", "debuff", [], {duration: 600, spell: "hunter's mark", note: "+1d6 force/weapon damage from the marker."}),
	spellPreset("leadership", "Leadership die", "buff", [{target: "attack", kind: "dice", value: "1d4"}, {target: "saves", kind: "dice", value: "1d4"}], {duration: 10, conc: false, spell: null}),
	spellPreset("enlarge", "Enlarge", "buff", [
		{target: "damage", kind: "dice", value: "1d4"},
		{target: "save:str", kind: "adv", value: ""},
		{target: "check:str", kind: "adv", value: ""},
	], {duration: 10, spell: "enlarge/reduce", note: "Size increases by one category."}),
	spellPreset("mage-armor", "Mage Armor", "buff", [{target: "ac", kind: "set", value: 13, addDex: true}], {duration: 4800, conc: false}),
	spellPreset("resist-fire", "Fire resistance", "buff", [], {duration: 600, spell: "protection from energy", resist: ["fire"]}),
];

/** Cover is a premade effect, not a battlefield rule: +AC and +DEX saves until removed. */
export const ENCOUNTER_COVER_PRESETS = [
	{key: "half-cover", name: "Half cover", kind: "cover", mods: [{target: "ac", kind: "flat", value: 2}, {target: "save:dex", kind: "flat", value: 2}], duration: null, conc: false, spell: null, note: "", resist: [], immune: [], vulnerable: [], cover: true},
	{key: "three-quarters-cover", name: "Three-quarters cover", kind: "cover", mods: [{target: "ac", kind: "flat", value: 5}, {target: "save:dex", kind: "flat", value: 5}], duration: null, conc: false, spell: null, note: "", resist: [], immune: [], vulnerable: [], cover: true},
];

const noopLog = () => {};
const defaultUid = () => globalThis.CryptUtil?.uid?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const isDiceString = value => /^[+-]?\s*\d*d\d+(\s*[+-]\s*\d+)?$/i.test(`${value}`.trim());
const getInstanceName = instance => instance.label || instance.monster?.name || instance.id;

/* -------------------------------------------- Durations -------------------------------------------- */

/** Converts an amount in a unit (round / min / hour / until) to rounds; `until` (or no amount) = until removed. */
export function toEncounterRounds (amount, unit = "round") {
	if (unit === "until" || amount == null || amount === "") return null;
	const n = Number(amount);
	if (!Number.isFinite(n)) throw new Error("Enter a duration in rounds, minutes or hours.");
	return Math.max(1, Math.round(n * (ENCOUNTER_DUR_UNITS[unit] || 1)));
}

export function fmtEncounterDuration (rounds) {
	if (rounds == null) return "until removed";
	const r = `${rounds} round${rounds === 1 ? "" : "s"}`;
	if (rounds && rounds % 600 === 0) return `${r} · ${rounds / 600} h`;
	if (rounds && rounds % 10 === 0) return `${r} · ${rounds / 10} min`;
	return r;
}

/** An edited duration: null/"" = until removed, otherwise a whole number of rounds ≥ 1. */
export function getEncounterNormalizedRounds (rounds) {
	if (rounds == null || rounds === "") return null;
	const n = Number(rounds);
	if (!Number.isFinite(n)) throw new Error("Enter a duration in rounds.");
	return Math.max(1, Math.round(n));
}

/* -------------------------------------------- Mods -------------------------------------------- */

/** v7 roll-effect scopes, as migrated into v8 effect mods. */
const V7_TARGET_ALIASES = {save: "saves", check: "checks", initiative: "init"};

/**
 * Canonical mod: v7-migrated targets (`save`/`check`/`initiative`) get their v8 names and `bonus` mods become
 * `flat` (numbers) or `dice` (dice strings). A v7 `skill` mod without a skill applies to every skill check.
 */
export function getEncounterNormalizedMod (mod) {
	if (!mod) return mod;
	const out = V7_TARGET_ALIASES[mod.target] ? {...mod, target: V7_TARGET_ALIASES[mod.target]} : mod;
	if (out.kind !== "bonus") return out;
	const value = typeof out.value === "number" ? out.value : `${out.value}`.trim();
	if (typeof value === "number" || /^[+-]?\d+$/.test(value)) return {...out, kind: "flat", value: Number(value)};
	return {...out, kind: "dice", value};
}

export function validateEncounterMod (raw) {
	const mod = getEncounterNormalizedMod(raw);
	const target = MOD_TARGET_BY_VALUE.get(mod?.target);
	if (!target) throw new Error("Choose what the modifier affects.");
	if (!target.kinds.includes(mod.kind)) throw new Error(`${target.label} can't take a ${mod.kind} modifier.`);
	if (mod.target === "skill" && !Object.hasOwn(ENCOUNTER_SKILL_ABILITIES, `${mod.skill || ""}`.toLowerCase())) throw new Error("Choose a skill.");
	if (["flat", "set"].includes(mod.kind) && !Number.isSafeInteger(Number(mod.value))) throw new Error("Enter a whole-number modifier.");
	if (mod.kind === "mult" && !(Number(mod.value) > 0)) throw new Error("Enter a positive multiplier.");
	if (mod.kind === "dice" && !isDiceString(mod.value)) throw new Error("Enter dice like 1d4 or -1d6.");
	return {
		target: mod.target,
		kind: mod.kind,
		value: ["flat", "set", "mult"].includes(mod.kind) ? Number(mod.value) : mod.kind === "dice" ? `${mod.value}`.replace(/\s+/g, "") : "",
		...mod.target === "skill" ? {skill: mod.skill.toLowerCase()} : {},
		...mod.kind === "set" ? {addDex: !!mod.addDex} : {},
	};
}

/* -------------------------------------------- Presets / definitions -------------------------------------------- */

/** All addable definitions: spell presets, cover, then the encounter's saved custom effects. */
export function getEncounterEffectPresets (state) {
	return [...ENCOUNTER_BUFF_PRESETS, ...ENCOUNTER_COVER_PRESETS, ...(state?.savedEffects || [])];
}

export function getEncounterEffectPreset (state, key) {
	return getEncounterEffectPresets(state).find(it => it.key === key) || null;
}

/** The spell a preset links to, as a {name, source} hover key for the active ruleset (2024 rules use XPHB). */
export function getEncounterPresetSpellRef (def, {ruleset = "phb"} = {}) {
	if (def?.spell && typeof def.spell === "object") return {...def.spell};
	if (!def?.spell) return null;
	return {name: def.spell, source: ruleset === "xphb" ? "XPHB" : "PHB"};
}

function getDefinition (state, def) {
	const resolved = typeof def === "string" ? getEncounterEffectPreset(state, def) : def;
	if (!resolved || typeof resolved !== "object") throw new Error("Choose an effect.");
	const name = `${resolved.name ?? resolved.label ?? ""}`.trim();
	if (!name) throw new Error("Name the effect.");
	return {...resolved, name};
}

/** Builds an effect for one creature from a preset, saved effect or custom definition. */
export function makeEncounterEffect (def, {id, round = 0, rounds, casterId = null, concOn = null, ruleset = "phb"} = {}) {
	const duration = rounds !== undefined ? getEncounterNormalizedRounds(rounds) : getEncounterNormalizedRounds(def.duration);
	return {
		id,
		key: def.key || "custom",
		name: def.name,
		kind: ENCOUNTER_EFFECT_KINDS.includes(def.kind) ? def.kind : "custom",
		mods: (def.mods || []).map(validateEncounterMod),
		rounds: duration,
		totalRounds: duration,
		startRound: round || 0,
		casterId,
		concOn,
		conc: !!def.conc,
		spell: getEncounterPresetSpellRef(def, {ruleset}),
		note: def.note || "",
		resist: [...def.resist || []],
		immune: [...def.immune || []],
		vulnerable: [...def.vulnerable || []],
		cover: !!def.cover,
		source: def.saved ? "saved" : def.key && def.key !== "custom" ? "preset" : "custom",
	};
}

/* -------------------------------------------- Draft helpers -------------------------------------------- */

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

function addConditionRaw (instance, name, details = {}) {
	if (!instance.conditions.includes(name)) instance.conditions.push(name);
	instance.conditionDetails = {...instance.conditionDetails, [name]: {rounds: null, ...instance.conditionDetails?.[name], ...details}};
}

function removeConditionRaw (instance, name) {
	instance.conditions = instance.conditions.filter(it => getNpcTrackerCanonicalConditionName(it) !== name);
	if (instance.conditionDetails && Object.hasOwn(instance.conditionDetails, name)) {
		const {[name]: _, ...rest} = instance.conditionDetails;
		instance.conditionDetails = rest;
	}
}

/**
 * Runs draft reducers on an immutable state: clone → recipe(draft, {log}) → validate.
 * Returns {state, result, logs: [[kind, text, extra]]}. The engine's pCommit does the same for live edits.
 */
export function withEncounterDraft (state, recipe) {
	const draft = cloneEncounterState(state);
	const logs = [];
	const result = recipe(draft, {log: (kind, text, extra) => logs.push([kind, text, extra])});
	return {state: EncounterWorkspaceState.validate(draft), result, logs};
}

/* -------------------------------------------- Concentration -------------------------------------------- */

/** CON save DC to keep concentration after taking damage; null when no damage was taken. */
export function getEncounterConcentrationDc (damage) {
	const n = Math.floor(Number(damage));
	return n > 0 ? Math.max(10, Math.floor(n / 2)) : null;
}

export function getEncounterConcentration (instance) {
	const conc = instance?.resources?.concentration;
	return conc?.active ? conc.label || "Concentration" : null;
}

/** Creatures carrying effects linked to the caster's current concentration. */
export function getEncounterConcentrationTargets (state, casterId) {
	const caster = state.instances.find(it => it.id === casterId);
	const label = getEncounterConcentration(caster);
	if (!label) return [];
	return state.instances.filter(it => (it.effects || []).some(fx => fx.casterId === casterId && fx.concOn === label)).map(it => it.id);
}

/**
 * Ends a caster's concentration and removes every effect it was holding up, on all creatures.
 * Returns {spell, ended: [instance ids that lost an effect]}.
 */
export function endEncounterConcentration (draft, casterId, {reason = "dropped concentration", log = noopLog} = {}) {
	const caster = getInstance(draft, casterId);
	const spell = getEncounterConcentration(caster);
	if (!spell) {
		removeConditionRaw(caster, "concentrating");
		return {spell: null, ended: []};
	}
	const ended = [];
	draft.instances.forEach(target => {
		const before = target.effects.length;
		target.effects = target.effects.filter(fx => !(fx.casterId === casterId && fx.concOn === spell));
		if (target.effects.length !== before) ended.push(target.id);
	});
	caster.resources = {...caster.resources, concentration: {active: false, label: ""}};
	removeConditionRaw(caster, "concentrating");
	const names = ended.map(id => getInstanceName(getInstance(draft, id)));
	log("effect", ended.length
		? `${spell} ended on ${ended.length} creature${ended.length > 1 ? "s" : ""} (${names.join(", ")}) — ${getInstanceName(caster)} ${reason}.`
		: `${getInstanceName(caster)} stopped concentrating on ${spell} (${reason}).`, {target: casterId, spell, ended});
	return {spell, ended};
}

/**
 * Starts (or switches) concentration. Switching ends the previous spell and its linked effects everywhere.
 * Re-starting the same label is a no-op. Returns the previous concentration's {spell, ended}.
 */
export function startEncounterConcentration (draft, casterId, label, {log = noopLog} = {}) {
	const caster = getInstance(draft, casterId);
	const next = `${label ?? ""}`.trim().slice(0, 120) || "Concentration";
	if (getEncounterConcentration(caster) === next) {
		addConditionRaw(caster, "concentrating");
		return {spell: null, ended: []};
	}
	const previous = endEncounterConcentration(draft, casterId, {reason: `switched to ${next}`, log});
	caster.resources = {...caster.resources, concentration: {active: true, label: next}};
	addConditionRaw(caster, "concentrating");
	log("effect", `${getInstanceName(caster)} is concentrating on ${next}.`, {target: casterId, spell: next});
	return previous;
}

/* -------------------------------------------- Effects -------------------------------------------- */

/**
 * Adds an effect to each target. A preset replaces an existing effect with the same key (custom effects stack).
 * With a `casterId` on a concentration effect the caster starts concentrating on it, which ends whatever it
 * concentrated on before. Returns {effectIds: {[instanceId]: effectId}, ended}.
 */
export function applyEncounterEffect (draft, {targetIds, def, rounds, casterId = null, ruleset = "phb", fnUid = defaultUid, log = noopLog} = {}) {
	const definition = getDefinition(draft, def);
	const targets = getTargets(draft, targetIds);
	const caster = casterId ? getInstance(draft, casterId) : null;
	let ended = {spell: null, ended: []};
	const concOn = caster && definition.conc ? definition.name.slice(0, 120) : null;
	if (concOn) ended = startEncounterConcentration(draft, casterId, concOn, {log});
	const effectIds = {};
	const isStacking = !definition.key || definition.key === "custom";
	targets.forEach(target => {
		if (!isStacking) target.effects = target.effects.filter(fx => fx.key !== definition.key);
		const id = `fx:${fnUid()}`;
		target.effects.push(makeEncounterEffect(definition, {id, round: draft.turn?.round, rounds, casterId: caster?.id ?? null, concOn, ruleset}));
		effectIds[target.id] = id;
	});
	log("effect", `${definition.name} → ${targets.map(getInstanceName).join(", ")}${caster ? ` (${getInstanceName(caster)}${concOn ? ", concentrating" : ""})` : ""}`, {targets: targets.map(it => it.id)});
	return {effectIds, ended};
}

/** Removes effects by id or key from the targets (all creatures when omitted). Returns removed {instanceId, effectId} pairs. */
export function removeEncounterEffect (draft, {targetIds = null, effectId = null, key = null, log = noopLog} = {}) {
	if (!effectId && !key) throw new Error("Choose an effect to remove.");
	const targets = targetIds == null ? draft.instances : getTargets(draft, targetIds);
	const removed = [];
	targets.forEach(target => {
		target.effects = target.effects.filter(fx => {
			const isMatch = (effectId && fx.id === effectId) || (key && fx.key === key);
			if (isMatch) removed.push({instanceId: target.id, effectId: fx.id, name: fx.name});
			return !isMatch;
		});
	});
	if (removed.length) log("effect", `${removed[0].name} removed from ${removed.map(it => getInstanceName(getInstance(draft, it.instanceId))).join(", ")}.`);
	return removed;
}

/** Edits an effect in place (name, kind, mods, note, rounds, resist/immune/vulnerable). */
export function updateEncounterEffect (draft, {instanceId, effectId, patch = {}}) {
	const instance = getInstance(draft, instanceId);
	const effect = instance.effects.find(it => it.id === effectId);
	if (!effect) throw new Error("This effect no longer exists.");
	if (patch.name !== undefined) {
		if (!`${patch.name}`.trim()) throw new Error("Name the effect.");
		effect.name = `${patch.name}`.trim();
	}
	if (patch.kind !== undefined) effect.kind = ENCOUNTER_EFFECT_KINDS.includes(patch.kind) ? patch.kind : "custom";
	if (patch.mods !== undefined) effect.mods = patch.mods.map(validateEncounterMod);
	if (patch.note !== undefined) effect.note = `${patch.note}`;
	["resist", "immune", "vulnerable"].forEach(prop => { if (patch[prop] !== undefined) effect[prop] = [...patch[prop]]; });
	if (patch.rounds !== undefined) setEncounterEffectRounds(draft, {instanceId, effectId, rounds: patch.rounds});
	return effect;
}

/** Sets an effect's remaining duration (null/"" = until removed); raises the total so progress bars stay sane. */
export function setEncounterEffectRounds (draft, {instanceId, effectId, rounds}) {
	const effect = getInstance(draft, instanceId).effects.find(it => it.id === effectId);
	if (!effect) throw new Error("This effect no longer exists.");
	effect.rounds = getEncounterNormalizedRounds(rounds);
	if (effect.rounds == null) effect.totalRounds = null;
	else if (effect.totalRounds == null || effect.totalRounds < effect.rounds) effect.totalRounds = effect.rounds;
	return effect;
}

/**
 * Counts down every timed effect by one round (call on round wrap) and removes the expired ones.
 * Returns [{instanceId, effectId, name}] of ended effects.
 */
export function tickEncounterEffectDurations (draft, {ids = null, log = noopLog} = {}) {
	const only = ids ? new Set(ids) : null;
	const ended = [];
	draft.instances.forEach(instance => {
		if (only && !only.has(instance.id)) return;
		instance.effects = instance.effects.filter(fx => {
			if (fx.rounds == null) return true;
			fx.rounds = Math.max(0, fx.rounds - 1);
			if (fx.rounds > 0) return true;
			ended.push({instanceId: instance.id, effectId: fx.id, name: fx.name});
			log("effect", `${fx.name} ended on ${getInstanceName(instance)}.`, {target: instance.id});
			return false;
		});
	});
	return ended;
}

/* -------------------------------------------- Saved custom effects -------------------------------------------- */

/** Saves a custom effect definition for reuse; one per name (re-saving a name replaces it). Returns the saved entry. */
export function saveEncounterEffectDef (draft, def, {fnUid = defaultUid} = {}) {
	const definition = getDefinition(draft, def);
	const saved = {
		key: `saved-${fnUid()}`,
		name: definition.name,
		kind: ENCOUNTER_EFFECT_KINDS.includes(definition.kind) ? definition.kind : "custom",
		mods: (definition.mods || []).map(validateEncounterMod),
		duration: getEncounterNormalizedRounds(definition.duration),
		conc: !!definition.conc,
		spell: definition.spell ?? null,
		note: definition.note || "",
		resist: [...definition.resist || []],
		immune: [...definition.immune || []],
		vulnerable: [...definition.vulnerable || []],
		cover: !!definition.cover,
		saved: true,
	};
	const name = saved.name.toLowerCase();
	draft.savedEffects = [...(draft.savedEffects || []).filter(it => it.name.toLowerCase() !== name), saved];
	return saved;
}

export function deleteEncounterSavedEffect (draft, key) {
	const before = (draft.savedEffects || []).length;
	draft.savedEffects = (draft.savedEffects || []).filter(it => it.key !== key);
	return draft.savedEffects.length !== before;
}

/* -------------------------------------------- Roll contributors -------------------------------------------- */

/** Ability modifier from a score; a missing or unreadable score counts as 10. */
export function getEncounterAbilityMod (score) {
	const value = typeof score === "string" && score.trim() ? Number(score) : score;
	return Math.floor(((Number.isFinite(value) ? value : 10) - 10) / 2);
}

/** Base AC before effects, with where it comes from: party members use their tracked AC, monsters their first statblock AC. */
export function getEncounterBaseAcInfo (instance, monster = instance?.monster) {
	if (instance?.kind === "party" && Number.isSafeInteger(instance.party?.ac)) return {value: instance.party.ac, from: []};
	const first = Array.isArray(monster?.ac) ? monster.ac[0] : monster?.ac;
	if (Number.isFinite(first)) return {value: first, from: []};
	if (first && Number.isFinite(first.ac)) return {value: first.ac, from: (first.from || []).map(it => `${it}`.replace(/\{@[a-z]+\s+([^}|]+)[^}]*\}/gi, "$1"))};
	if (Number.isFinite(first?.special)) return {value: first.special, from: []};
	return {value: 10, from: []};
}

export function getEncounterBaseAc (instance, monster = instance?.monster) {
	return getEncounterBaseAcInfo(instance, monster).value;
}

const getEffectMods = instance => (instance.effects || []).flatMap(effect => (effect.mods || []).map(mod => ({effect, mod: getEncounterNormalizedMod(mod)})));
const getEffectEntry = effect => ({label: effect.name, source: `effect:${effect.id}`});

function getModMatcher (query) {
	const ability = query.ability || (query.skill ? ENCOUNTER_SKILL_ABILITIES[query.skill.toLowerCase()] : null);
	switch (query.kind) {
		case "attack": return mod => mod.target === "attack";
		case "save": return mod => mod.target === "saves" || (ability && mod.target === `save:${ability}`);
		case "check": return mod => mod.target === "checks" || (ability && mod.target === `check:${ability}`)
			|| (query.skill && mod.target === "skill" && (!mod.skill || mod.skill === query.skill.toLowerCase()));
		case "initiative": return mod => mod.target === "init";
		case "damage": return mod => mod.target === "damage";
		case "speed": return mod => mod.target === "speed" && mod.kind === "flat";
		default: return () => false;
	}
}

function addModContribution (out, effect, mod) {
	const entry = getEffectEntry(effect);
	if (mod.kind === "flat") out.bonuses.push({...entry, value: Number(mod.value)});
	else if (mod.kind === "dice") out.bonuses.push({...entry, value: `${mod.value}`});
	else if (mod.kind === "adv") out.advantage.push(entry);
	else if (mod.kind === "dis") out.disadvantage.push(entry);
	else if (mod.kind === "autoFail") out.autoFail.push(entry);
}

/**
 * Roll-contributor provider for instance effects: `(state, instance, query) => contributors`.
 * Attacks with a `targetId` also pick up the target's "attacks against it" modifiers.
 */
export function encounterEffectsProvider (state, instance, query) {
	const out = {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
	if (query.kind === "ac") {
		const base = getEncounterBaseAc(instance);
		const dexMod = getEncounterAbilityMod(instance.monster?.dex);
		const sets = getEffectMods(instance).filter(({mod}) => mod.target === "ac" && mod.kind === "set")
			.map(({effect, mod}) => ({effect, value: Number(mod.value) + (mod.addDex ? dexMod : 0)}))
			.sort((a, b) => b.value - a.value);
		if (sets[0] && sets[0].value > base) out.bonuses.push({...getEffectEntry(sets[0].effect), label: `${sets[0].effect.name} (AC ${sets[0].value})`, value: sets[0].value - base});
		getEffectMods(instance).filter(({mod}) => mod.target === "ac" && mod.kind === "flat")
			.forEach(({effect, mod}) => out.bonuses.push({...getEffectEntry(effect), value: Number(mod.value)}));
		return out;
	}
	const isMatch = getModMatcher(query);
	getEffectMods(instance).filter(({mod}) => isMatch(mod)).forEach(({effect, mod}) => addModContribution(out, effect, mod));
	if (query.kind === "attack" && query.targetId) {
		const target = state.instances.find(it => it.id === query.targetId);
		getEffectMods(target || {}).filter(({mod}) => mod.target === "attacked").forEach(({effect, mod}) => {
			const entry = {label: `${effect.name} (target)`, source: `effect:${effect.id}`};
			if (mod.kind === "adv") out.advantage.push(entry);
			else if (mod.kind === "dis") out.disadvantage.push(entry);
		});
	}
	return out;
}
