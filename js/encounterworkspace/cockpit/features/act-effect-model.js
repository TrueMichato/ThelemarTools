/**
 * P3a — pure (DOM-free) logic behind the Fx dock tab and the custom effect builder: typed durations, builder
 * validation, defense toggles, effect summaries, the concentration-switch warning and the "active on" list.
 */

import {
	ENCOUNTER_EFFECT_KINDS,
	ENCOUNTER_MOD_KINDS,
	ENCOUNTER_MOD_TARGETS,
	ENCOUNTER_SKILL_ABILITIES,
	getEncounterConcentration,
	getEncounterConcentrationTargets,
	validateEncounterMod,
} from "../../encounterworkspace-fx.js";

export const COCKPIT_DURATION_UNITS = Object.freeze([
	{value: "round", label: "rounds", short: "r"},
	{value: "min", label: "minutes", short: "min"},
	{value: "hour", label: "hours", short: "h"},
	{value: "until", label: "until removed", short: ""},
]);

export const COCKPIT_DEFENSE_LISTS = Object.freeze([
	{value: "resist", label: "Resist"},
	{value: "immune", label: "Immune"},
	{value: "vulnerable", label: "Vulnerable"},
]);

const UNIT_ALIASES = [
	[/^(?:r|rd|rds|rnd|rnds|rounds?)$/, "round"],
	[/^(?:m|min|mins|minutes?)$/, "min"],
	[/^(?:h|hr|hrs|hours?)$/, "hour"],
];
const ROUNDS_PER = {round: 1, min: 10, hour: 600};

/** Best-fitting display unit for a duration in rounds: 600 → 1 hour, 10 → 1 min, 3 → 3 rounds, null → until removed. */
export function getCockpitDurationParts (rounds) {
	if (rounds == null) return {amount: "", unit: "until"};
	if (rounds % 600 === 0) return {amount: `${rounds / 600}`, unit: "hour"};
	if (rounds % 10 === 0) return {amount: `${rounds / 10}`, unit: "min"};
	return {amount: `${rounds}`, unit: "round"};
}

/** Compact duration: "3 rounds", "1 min", "8 h", "until removed". */
export function getCockpitDurationText (rounds) {
	if (rounds == null) return "until removed";
	const {amount, unit} = getCockpitDurationParts(rounds);
	if (unit === "hour") return `${amount} h`;
	if (unit === "min") return `${amount} min`;
	return `${amount} round${amount === "1" ? "" : "s"}`;
}

/**
 * A duration typed by hand. The amount may carry its own unit ("1 min", "10r", "8h", "until"), which wins over the
 * unit select. Returns {ok, rounds, unit, text, message}; rounds null = until removed.
 */
export function getCockpitDurationRounds ({amount = "", unit = "round"} = {}) {
	const raw = `${amount ?? ""}`.trim().toLowerCase();
	if (unit === "until" && !raw) return {ok: true, rounds: null, unit: "until", text: getCockpitDurationText(null)};
	if (!raw || /^(?:until|∞|-|none|permanent|perm)$/.test(raw)) return {ok: true, rounds: null, unit: "until", text: getCockpitDurationText(null)};
	const match = raw.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
	if (!match) return {ok: false, message: "Enter a number of rounds, minutes or hours — e.g. 10, 1 min, 8 h."};
	let unitOut = unit === "until" ? "round" : unit;
	if (match[2]) {
		const alias = UNIT_ALIASES.find(([rx]) => rx.test(match[2]));
		if (!alias) return {ok: false, message: `Unknown unit “${match[2]}” — use rounds, min or h.`};
		unitOut = alias[1];
	}
	const n = Number(match[1]);
	if (!(n > 0)) return {ok: false, message: "A duration must be more than zero (or choose “until removed”)."};
	const rounds = Math.max(1, Math.round(n * (ROUNDS_PER[unitOut] || 1)));
	if (rounds > 144000) return {ok: false, message: "That duration is too long — use “until removed”."};
	return {ok: true, rounds, unit: unitOut, text: getCockpitDurationText(rounds)};
}

/** Rounds plus their table time, for the Fx readout: "3 rounds", "10 rounds · 1 min", "4800 rounds · 8 h". */
export function getCockpitDurationReadout (rounds) {
	if (rounds == null) return "until removed";
	const head = `${rounds} round${rounds === 1 ? "" : "s"}`;
	if (rounds < 10) return head;
	const trim = n => `${Number(n.toFixed(1))}`;
	if (rounds >= 600) return `${head} · ${trim(rounds / 600)} h`;
	return `${head} · ${trim(rounds / 10)} min`;
}

/** A typed duration as the stepper / unit select show it: "1 min" typed over rounds → {amount: "1", unit: "min"}. */
export function getCockpitDurationNormalized ({amount = "", unit = "round"} = {}) {
	const parsed = getCockpitDurationRounds({amount, unit});
	if (!parsed.ok) return {amount, unit};
	if (parsed.rounds == null) return {amount: "", unit: "until"};
	return {amount: `${Number((parsed.rounds / (ROUNDS_PER[parsed.unit] || 1)).toFixed(2))}`, unit: parsed.unit};
}

/**
 * The Fx duration stepper: one more / fewer of the unit the DM is working in (a typed "1 min" steps minutes). Never
 * below 1; stepping from "until removed" (or an unreadable value) starts again at 1 of the unit.
 */
export function getCockpitDurationStep ({amount = "", unit = "round"} = {}, delta) {
	const parsed = getCockpitDurationRounds({amount, unit});
	if (!parsed.ok || parsed.rounds == null) return {amount: "1", unit: unit === "until" ? "round" : unit};
	const n = Math.round(parsed.rounds / (ROUNDS_PER[parsed.unit] || 1));
	return {amount: `${Math.max(1, n + delta)}`, unit: parsed.unit};
}

/* -------------------------------------------- Mods -------------------------------------------- */

const TARGET_BY_VALUE = new Map(ENCOUNTER_MOD_TARGETS.map(it => [it.value, it]));
const KIND_LABEL = new Map(ENCOUNTER_MOD_KINDS.map(it => [it.value, it.label]));

/** Groups for the "Affects" select, so a targeted mod (Dex saves only, one skill…) is easy to find. */
export function getCockpitModTargetGroups () {
	const group = (label, rx) => ({label, targets: ENCOUNTER_MOD_TARGETS.filter(it => rx.test(it.value))});
	return [
		group("Defense", /^(?:ac|attacked)$/),
		group("Attacks & damage", /^(?:attack|damage)$/),
		group("Saving throws", /^saves?(?::|$)/),
		group("Checks & skills", /^(?:checks?(?::|$)|skill$)/),
		group("Movement & initiative", /^(?:speed|init)$/),
	];
}

export function getCockpitModKinds (target) {
	return (TARGET_BY_VALUE.get(target)?.kinds || []).map(value => ({value, label: KIND_LABEL.get(value) || value}));
}

const DEFAULT_VALUE = {flat: "1", dice: "1d4", set: "13", mult: "2"};

/** A fresh modifier row for a target; keeps the previous kind/value when the new target allows it. */
export function getCockpitModForTarget (target, prev = null) {
	const kinds = TARGET_BY_VALUE.get(target)?.kinds || [];
	const kind = prev && kinds.includes(prev.kind) ? prev.kind : kinds[0] || "flat";
	const value = prev && prev.kind === kind ? prev.value : DEFAULT_VALUE[kind] ?? "";
	return {target, kind, value, skill: target === "skill" ? prev?.skill || "perception" : "", addDex: kind === "set" ? prev?.addDex ?? true : false};
}

export const COCKPIT_SKILLS = Object.freeze(Object.keys(ENCOUNTER_SKILL_ABILITIES));

const signed = value => {
	const s = `${value}`.trim();
	if (typeof value === "number") return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
	return /^[+-]/.test(s) ? s.replace(/^-/, "−") : `+${s}`;
};

/** "AC +2", "DEX save adv", "Stealth −1d4", "Speed ×2", "AC 13 + DEX". */
export function getCockpitModText (mod) {
	const target = mod.target === "skill" ? `${mod.skill || "skill"}`.replace(/\b\w/g, it => it.toUpperCase()) : TARGET_BY_VALUE.get(mod.target)?.label || mod.target;
	switch (mod.kind) {
		case "flat": case "dice": return `${target} ${signed(mod.value)}`;
		case "adv": return `${target}: advantage`;
		case "dis": return `${target}: disadvantage`;
		case "autoFail": return `${target}: auto-fail`;
		case "set": return `${target} ${mod.value}${mod.addDex ? " + DEX" : ""}`;
		case "mult": return `${target} ×${mod.value}`;
		default: return `${target} ${mod.kind || ""} ${mod.value ?? ""}`.trim();
	}
}

/** One line describing what an effect does: "AC +2 · DEX save +2 · resist fire · 1 min". */
export function getCockpitEffectSummary (def, {rounds} = {}) {
	const bits = (def.mods || []).map(getCockpitModText);
	if (def.resist?.length) bits.push(`resist ${def.resist.join(", ")}`);
	if (def.immune?.length) bits.push(`immune ${def.immune.join(", ")}`);
	if (def.vulnerable?.length) bits.push(`vulnerable ${def.vulnerable.join(", ")}`);
	if (def.note) bits.push(def.note);
	const duration = rounds !== undefined ? rounds : def.duration;
	bits.push(getCockpitDurationText(duration ?? null));
	if (def.conc) bits.push("concentration");
	return bits.join(" · ");
}

/* -------------------------------------------- Builder form -------------------------------------------- */

export function getCockpitEmptyEffectForm (initial = {}) {
	const duration = initial.duration !== undefined ? getCockpitDurationParts(initial.duration) : {amount: "1", unit: "min"};
	return {
		name: initial.name || "",
		kind: ENCOUNTER_EFFECT_KINDS.includes(initial.kind) ? initial.kind : "buff",
		mods: (initial.mods || []).map(it => ({...getCockpitModForTarget(it.target, it), ...it, value: `${it.value ?? ""}`})),
		resist: [...initial.resist || []],
		immune: [...initial.immune || []],
		vulnerable: [...initial.vulnerable || []],
		conc: !!initial.conc,
		note: initial.note || "",
		durationAmount: duration.amount,
		durationUnit: duration.unit,
		isAllTypes: false,
	};
}

/** Toggle a damage type in one defense list; a type lives in at most one list (pressing it again clears it). */
export function getCockpitFormWithDefense (form, list, type) {
	const has = (form[list] || []).includes(type);
	const out = {...form};
	COCKPIT_DEFENSE_LISTS.forEach(({value}) => { out[value] = (form[value] || []).filter(it => it !== type); });
	if (!has) out[list] = [...out[list], type];
	return out;
}

/** Which list a damage type is in, if any. */
export function getCockpitDefenseOf (form, type) {
	return COCKPIT_DEFENSE_LISTS.find(({value}) => (form[value] || []).includes(type))?.value || null;
}

/**
 * Validate the builder form into an effect definition for `applyEncounterEffect` / `saveEncounterEffectDef`.
 * Returns {ok: true, def} or {ok: false, message, field} where field is "name" | "duration" | `mod-${index}`.
 * The def has no `key`, so applied copies stack (custom effects never replace each other).
 */
export function getCockpitEffectDef (form) {
	const name = `${form.name ?? ""}`.trim().replace(/\s+/g, " ");
	if (!name) return {ok: false, message: "Name the effect.", field: "name"};
	if (name.length > 60) return {ok: false, message: "Keep the name under 60 characters.", field: "name"};
	const mods = [];
	for (const [ix, raw] of (form.mods || []).entries()) {
		try {
			mods.push(validateEncounterMod({...raw, value: `${raw.value ?? ""}`.trim()}));
		} catch (e) {
			return {ok: false, message: `Modifier ${ix + 1}: ${e.message}`, field: `mod-${ix}`};
		}
	}
	const duration = getCockpitDurationRounds({amount: form.durationAmount, unit: form.durationUnit});
	if (!duration.ok) return {ok: false, message: duration.message, field: "duration"};
	return {
		ok: true,
		def: {
			name,
			kind: ENCOUNTER_EFFECT_KINDS.includes(form.kind) ? form.kind : "custom",
			mods,
			resist: [...form.resist || []],
			immune: [...form.immune || []],
			vulnerable: [...form.vulnerable || []],
			conc: !!form.conc,
			spell: null,
			note: `${form.note ?? ""}`.trim(),
			cover: false,
			duration: duration.rounds,
		},
	};
}

/* -------------------------------------------- Fx tab -------------------------------------------- */

/** The Fx tab's effect groups: spell presets, cover, saved custom effects. */
export function getCockpitFxGroups (presets) {
	const groups = [
		{id: "spells", label: "Spells & features", items: presets.filter(it => !it.cover && !it.saved)},
		{id: "cover", label: "Cover", items: presets.filter(it => it.cover && !it.saved)},
		{id: "saved", label: "Saved", items: presets.filter(it => it.saved)},
	];
	return groups.filter(it => it.items.length || it.id === "saved");
}

/** Caster options: nobody, the active turn, then every standing creature. value "" = nobody, "@turn" = active turn. */
export function getCockpitCasterOptions (state, {labels, activeId}) {
	const out = [{value: "", label: "Nobody"}];
	if (activeId && state.instances.some(it => it.id === activeId)) out.push({value: "@turn", label: `Active turn — ${labels.get(activeId)}`});
	state.instances.filter(it => !it.defeated).forEach(it => out.push({value: it.id, label: labels.get(it.id) || it.id}));
	return out;
}

export function getCockpitCasterId (value, {activeId}) {
	if (!value) return null;
	if (value === "@turn") return activeId || null;
	return value;
}

/**
 * Switching concentration ends the old spell everywhere. Returns null when nothing ends, otherwise
 * {casterLabel, current, next, count, text}.
 */
export function getCockpitConcentrationWarning (state, {casterId, def, labels}) {
	if (!casterId || !def?.conc) return null;
	const caster = state.instances.find(it => it.id === casterId);
	const current = getEncounterConcentration(caster);
	const next = `${def.name}`.slice(0, 120);
	if (!current || current === next) return null;
	const count = getEncounterConcentrationTargets(state, casterId).length;
	const casterLabel = labels.get(casterId) || casterId;
	const ends = count ? `ends ${current} on ${count} creature${count === 1 ? "" : "s"}` : `ends ${current}`;
	return {casterLabel, current, next, count, text: `${casterLabel} is concentrating on ${current}. Casting ${next} ${ends}.`};
}

/**
 * Effects active on the targets, grouped by preset key (custom effects by name): [{groupKey, key, name, conc,
 * casterId, rounds, entries: [{instanceId, effectId, effect}], label}] sorted by name.
 */
export function getCockpitActiveEffects (state, targetIds, {labels}) {
	const groups = new Map();
	state.instances.filter(it => targetIds.includes(it.id)).forEach(instance => {
		(instance.effects || []).forEach(effect => {
			const groupKey = effect.key && effect.key !== "custom" ? `key:${effect.key}` : `name:${effect.name.toLowerCase()}`;
			if (!groups.has(groupKey)) groups.set(groupKey, {groupKey, key: effect.key || "custom", name: effect.name, conc: !!effect.concOn, casterId: effect.casterId || null, rounds: effect.rounds ?? null, entries: []});
			const group = groups.get(groupKey);
			group.entries.push({instanceId: instance.id, effectId: effect.id, effect});
			if (effect.rounds != null && (group.rounds == null || effect.rounds < group.rounds)) group.rounds = effect.rounds;
		});
	});
	return [...groups.values()]
		.map(it => ({...it, label: it.entries.length === targetIds.length ? (targetIds.length === 1 ? "" : "all") : it.entries.map(e => labels.get(e.instanceId)).join(", ")}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when every target already carries this preset key. */
export function getCockpitIsPresetOnAll (state, targetIds, key) {
	if (!targetIds.length || !key) return false;
	return state.instances.filter(it => targetIds.includes(it.id)).every(it => (it.effects || []).some(fx => fx.key === key));
}
