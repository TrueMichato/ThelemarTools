import {getEncounterDisplayLabels} from "./encounterworkspace-massroll.js";
import {ENCOUNTER_SKILL_ABILITIES} from "./encounterworkspace-rollbreakdown.js";

/**
 * Pure grammar for the cockpit console and the HP field. Parsing never touches state; `resolveEncounterConsoleTargets`
 * reads state but never changes it. Execution belongs to the UI layer (P2/P3).
 */

export const ENCOUNTER_DAMAGE_TYPES = Object.freeze([
	"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
]);
export const ENCOUNTER_CONDITION_NAMES = Object.freeze([
	"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
	"petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
]);

const ABILITY_RX = /^(str|dex|con|int|wis|cha)\w*$/;
const DICE_RX = /^(\d*d\d+(?:[+-]\d+)?|\d+)$/;
const DURATION_RX = /(?:^|\s)(\d+)\s*(r|rnds?|rounds?|m|mins?|minutes?|h|hrs?|hours?)\b/;
const MODE_RX = /^(adv\w*|dis\w*)$/;
const ROUNDS_PER = {round: 1, minute: 10, hour: 600};

const getMode = word => !word ? "normal" : /^adv/.test(word) ? "advantage" : "disadvantage";
const getAmountSpec = text => /^\d+$/.test(text) ? {amount: Number(text), expr: null} : {amount: null, expr: text.replace(/\s+/g, "")};

/** "2r", "1 min", "3 hours" → {amount, unit, rounds, rest}; null when the text has no duration. */
export function parseEncounterDuration (text) {
	const match = `${text ?? ""}`.toLowerCase().match(DURATION_RX);
	if (!match) return null;
	const unit = /^r/.test(match[2]) ? "round" : /^m/.test(match[2]) ? "minute" : "hour";
	const amount = Number(match[1]);
	return {amount, unit, rounds: amount * ROUNDS_PER[unit], rest: `${text}`.toLowerCase().replace(match[0], " ").replace(/\s+/g, " ").trim()};
}

/** Exact damage-type word, or (with `isPrefix`) any word starting with the type's first four letters: `pois`, `lightn`. */
export function getEncounterDamageTypeMatch (text, {isPrefix = false} = {}) {
	const words = `${text ?? ""}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
	return ENCOUNTER_DAMAGE_TYPES.find(type => words.some(word => isPrefix
		? word.startsWith(type.slice(0, 4)) && (type.startsWith(word) || word.startsWith(type))
		: word === type)) || null;
}

/**
 * The HP-field grammar: `-12 fire` / `12` (damage), `+5` (heal), `t8` (temp HP), `=20` (set current HP).
 * Dice expressions are allowed for damage and healing (`-2d6+3 fire`). `half` halves damage after rolling.
 * Returns {mode: damage|heal|temp|set, amount, expr, damageType, half, crit} or null when it isn't an HP command.
 */
export function parseEncounterHpCommand (text) {
	const raw = `${text ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
	if (!raw) return null;
	let match = raw.match(/^t(?:emp)?\s*(\d+)$/);
	if (match) return {mode: "temp", amount: Number(match[1]), expr: null, damageType: null, half: false, crit: false};
	if ((match = raw.match(/^=\s*(\d+)$/))) return {mode: "set", amount: Number(match[1]), expr: null, damageType: null, half: false, crit: false};
	if ((match = raw.match(/^\+\s*(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)$/))) {
		return {mode: "heal", ...getAmountSpec(match[1]), damageType: null, half: false, crit: false};
	}
	match = raw.match(/^-?\s*(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)(?:\s+(.*))?$/);
	if (!match) return null;
	let tail = match[2] || "";
	const half = /\bhalf\b/.test(tail);
	const crit = /\bcrit\b/.test(tail);
	tail = tail.replace(/\b(half|crit)\b/g, " ").trim();
	const damageType = tail ? getEncounterDamageTypeMatch(tail, {isPrefix: true}) : null;
	if (tail && !damageType) return null;
	return {mode: "damage", ...getAmountSpec(match[1]), damageType, half, crit};
}

export function matchEncounterConditionName (query, conditionNames = ENCOUNTER_CONDITION_NAMES) {
	const q = `${query ?? ""}`.trim().toLowerCase();
	if (q.length < 3) return null;
	const names = conditionNames.map(it => `${it}`.toLowerCase());
	return names.find(it => it === q) || names.find(it => it.startsWith(q)) || null;
}

/** Effects are `{key, label}` presets (P1a's buff catalogue / saved effects); matched by label or key, exact first. */
export function matchEncounterEffect (query, effects = []) {
	const q = `${query ?? ""}`.trim().toLowerCase();
	if (q.length < 3) return null;
	const slug = q.replace(/\s+/g, "-");
	const label = it => `${it.label ?? it.name ?? ""}`.toLowerCase();
	return effects.find(it => label(it) === q || it.key === q || it.key === slug)
		|| effects.find(it => label(it).startsWith(q) || `${it.key ?? ""}`.startsWith(slug))
		|| (/^(¾|3\/4|three)/.test(q) ? effects.find(it => it.key === "three-quarters-cover") : null)
		|| null;
}

/** A skill (full name, prefix of ≥3 letters, or spaceless) → canonical lowercase skill name. */
export function matchEncounterSkill (query) {
	const q = `${query ?? ""}`.trim().toLowerCase();
	if (q.length < 3) return null;
	const skills = Object.keys(ENCOUNTER_SKILL_ABILITIES);
	const compact = q.replace(/[^a-z]/g, "");
	return skills.find(it => it === q || it.replace(/[^a-z]/g, "") === compact)
		|| skills.find(it => it.startsWith(q) || it.replace(/[^a-z]/g, "").startsWith(compact))
		|| null;
}

function getCheckSpec (word) {
	const ability = word.match(ABILITY_RX)?.[1];
	// "int" or "strength" read as the ability even though "int" prefixes "intimidation"
	if (ability && (word === ability || word === {str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma"}[ability])) {
		return {skill: null, ability};
	}
	const skill = matchEncounterSkill(word);
	if (skill) return {skill, ability: ENCOUNTER_SKILL_ABILITIES[skill]};
	return ability ? {skill: null, ability} : null;
}

const error = (targets, message) => ({verb: "error", targets, error: message});

/**
 * Parse one console line into a command object. `@token` target specs are lifted out first (anywhere in the line);
 * with none, `targets` is empty and the caller uses the selection. Verbs, in priority order:
 *   heal|h|+ <n|dice>            temp|thp <n>              =<n> (set HP)
 *   conc [spell|off]             roll|check|chk|skill <skill|ability> [adv|dis] [dc N]
 *   save|sv <abil> [DC] [adv|dis] [n|dice] [type] [half] [duration] [condition]
 *   ds | death save              init <n>                  drop (concentration)
 *   exh <0-6>                    -x | remove x | end x | unx
 *   <n|dice> [crit] [half] [type]  (damage; `-12 fire` also accepted)
 *   <condition> [duration]       <effect> [duration] [by [@]caster]  (the caster is a target spec, never a target)
 * Returns {verb, targets, ...fields}; unknown input yields {verb: "error", error}.
 */
export function parseEncounterConsoleCommand (text, {conditionNames = ENCOUNTER_CONDITION_NAMES, effects = []} = {}) {
	const source = `${text ?? ""}`.trim();
	const targets = [];
	let caster = null;
	let rest = source.replace(/\s+by\s+@?([^\s@]+)\s*$/i, (_, spec) => { caster = spec.toLowerCase(); return ""; }).replace(/@([^\s@]+)/g, (_, spec) => {
		targets.push(...spec.split(",").map(it => it.trim()).filter(Boolean));
		return " ";
	}).replace(/\s+/g, " ").trim().toLowerCase();
	if (!source) return null;
	if (!rest) return {verb: "target", targets};
	let match;

	if ((match = rest.match(/^(?:heal|h|\+)\s*(\S+)$/)) && DICE_RX.test(match[1])) return {verb: "heal", targets, ...getAmountSpec(match[1])};
	if ((match = rest.match(/^(?:temp|thp|t)\s*(\d+)$/))) return {verb: "temp", targets, amount: Number(match[1])};
	if ((match = rest.match(/^=\s*(\d+)$/))) return {verb: "set", targets, amount: Number(match[1])};

	if ((match = rest.match(/^conc(?:entrat\w*)?(?:\s+(.+))?$/))) {
		const arg = (match[1] || "").trim();
		const isOff = !arg || /^(off|none|drop|end|stop)$/.test(arg);
		return {verb: "concentration", targets, spell: isOff ? null : arg.replace(/\b\w/g, it => it.toUpperCase())};
	}

	if ((match = rest.match(/^(?:roll|check|chk|skill)\s+(.+)$/))) {
		const words = match[1].split(" ");
		let mode = "normal";
		let dc = null;
		const kept = [];
		for (let i = 0; i < words.length; ++i) {
			if (MODE_RX.test(words[i])) mode = getMode(words[i]);
			else if (words[i] === "dc" && /^\d+$/.test(words[i + 1] || "")) dc = Number(words[++i]);
			else if (/^dc\d+$/.test(words[i])) dc = Number(words[i].slice(2));
			else if (/^\d+$/.test(words[i]) && kept.length) dc = Number(words[i]);
			else kept.push(words[i]);
		}
		const spec = getCheckSpec(kept.join(" "));
		if (!spec) return error(targets, `Unknown skill or ability “${kept.join(" ")}”. Try stealth, perception, athletics, dex…`);
		return {verb: "check", targets, ...spec, mode, dc};
	}

	if ((match = rest.match(/^(?:save|sv)\s+(\w+)(.*)$/))) {
		const ability = match[1].match(ABILITY_RX)?.[1];
		if (!ability) return error(targets, "Which save? str, dex, con, int, wis or cha.");
		let tail = ` ${match[2].trim()} `;
		let mode = "normal";
		tail = tail.replace(/\s(adv\w*|dis\w*)(?=\s)/, (_, word) => { mode = getMode(word); return " "; });
		let dc = null;
		tail = tail.replace(/^\s*(?:dc\s*)?(\d+)(?=\s)/, (_, n) => { dc = Number(n); return " "; });
		const duration = parseEncounterDuration(tail);
		if (duration) tail = ` ${duration.rest} `;
		const halfOnSuccess = /\bhalf\b/.test(tail);
		tail = tail.replace(/\bhalf\b/, " ");
		let damage = null;
		tail = tail.replace(/\s(\d*d\d+(?:[+-]\d+)?|\d+)(?=\s)/, (_, expr) => { damage = getAmountSpec(expr); return " "; });
		const damageType = getEncounterDamageTypeMatch(tail);
		if (damageType) tail = tail.replace(damageType, " ");
		const word = tail.trim().split(" ")[0];
		const condition = word ? matchEncounterConditionName(word, conditionNames) : null;
		if (word && !condition) return error(targets, `Unknown condition “${word}”.`);
		return {verb: "save", targets, ability, dc, mode, damage, damageType, halfOnSuccess, condition, rounds: duration?.rounds ?? null};
	}

	if (/^(?:ds|death(?:\s*saves?)?)$/.test(rest)) return {verb: "deathSave", targets};
	if ((match = rest.match(/^init(?:iative)?\s+(-?\d+)$/))) return {verb: "initiative", targets, total: Number(match[1])};
	if (rest === "drop") return {verb: "dropConcentration", targets};
	if ((match = rest.match(/^exh\w*\s*(\d)$/))) return {verb: "exhaustion", targets, level: Math.min(6, Number(match[1]))};

	const hp = rest.match(/^-\s*\d/) ? parseEncounterHpCommand(rest) : null;
	if (hp) return {verb: "damage", targets, amount: hp.amount, expr: hp.expr, damageType: hp.damageType, crit: hp.crit, half: hp.half};

	if ((match = rest.match(/^(?:-|remove\s+|end\s+|un)(.+)$/))) {
		const query = match[1].trim();
		const condition = matchEncounterConditionName(query, conditionNames);
		const effect = condition ? null : matchEncounterEffect(query, effects);
		if (!condition && !effect) return error(targets, `Nothing called “${query}” to remove.`);
		return {verb: "remove", targets, condition, effect: effect?.key ?? null};
	}

	const damage = /^\d/.test(rest) ? parseEncounterHpCommand(rest) : null;
	if (damage) return {verb: "damage", targets, amount: damage.amount, expr: damage.expr, damageType: damage.damageType, crit: damage.crit, half: damage.half};

	const duration = parseEncounterDuration(rest);
	const body = duration ? duration.rest : rest;
	const condition = matchEncounterConditionName(body, conditionNames);
	if (condition) return {verb: "condition", targets, condition, rounds: duration?.rounds ?? null};
	const effect = matchEncounterEffect(body, effects);
	if (effect) return {verb: "effect", targets, effect: effect.key, rounds: duration?.rounds ?? effect.duration ?? null, caster};
	return error(targets, `Didn’t understand “${rest}”. Try 7 fire, heal 5, save dex 12, prone 2r, bless.`);
}

const getCompact = text => `${text}`.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fuzzy match score (lower is better): exact 0, prefix 1, word prefix 2, initials 3, substring 4. */
export function getEncounterTargetScore (query, name) {
	const q = `${query}`.toLowerCase();
	const n = `${name}`.toLowerCase();
	const compact = getCompact(n);
	if (!q) return 9;
	if (compact === q) return 0;
	if (n.startsWith(q) || compact.startsWith(q)) return 1;
	const words = n.split(/[^a-z0-9']+/).filter(Boolean);
	if (words.some(it => it.startsWith(q))) return 2;
	if (q.length >= 2 && words.map(it => it[0]).join("").startsWith(q)) return 3;
	if (q.length >= 3 && compact.includes(q)) return 4;
	return Infinity;
}

function getBest (query, items, getKey = it => it) {
	let best = Infinity;
	let out = [];
	for (const item of items) {
		const score = getEncounterTargetScore(query, getKey(item));
		if (score < best) { best = score; out = [item]; } else if (score === best && score < Infinity) out.push(item);
	}
	if (out.length > 1) {
		const length = Math.min(...out.map(it => getKey(it).length));
		out = out.filter(it => getKey(it).length === length);
	}
	return out;
}

/**
 * Resolve `@` target specs against state. Keywords: sel/selected, all (standing), foes/enemies, party/pcs,
 * turn/me, view, g1..g9 (the n-th entry of `chipGroups`, default custom groups then view groups),
 * a custom group name, "name N" (label number), a party member's name, or a monster name (plural ok).
 * Returns {ids, bad, what}; unresolved specs land in `bad`.
 */
export function resolveEncounterConsoleTargets (state, specs, {selectedIds = state.selectedIds, activeId = state.turn?.activeId ?? null, viewedId = null, chipGroups = null} = {}) {
	const labels = getEncounterDisplayLabels(state);
	const all = state.instances.map(it => ({instance: it, id: it.id, name: it.monster.name, label: labels.get(it.id), group: it.customGroup}));
	const live = all.filter(it => !it.instance.defeated);
	const groupNames = [...new Set(all.map(it => it.group).filter(Boolean))];
	const getChipGroups = () => chipGroups || groupNames.map(name => ({name, ids: live.filter(it => it.group === name).map(it => it.id)}));
	const getActiveIds = () => {
		const group = state.groups.find(it => it.id === activeId);
		return group ? group.memberIds : activeId ? [activeId] : [];
	};
	const getLabelNumber = it => it.label.match(/\s#?(\d+)$/)?.[1] ?? null;

	const resolvePart = raw => {
		const part = `${raw}`.toLowerCase().replace(/^@/, "").trim();
		if (!part) return null;
		switch (part) {
			case "sel": case "selected": return {ids: live.filter(it => selectedIds.includes(it.id)).map(it => it.id), what: "selection"};
			case "all": return {ids: live.map(it => it.id), what: "everyone standing"};
			case "foes": case "enemies": return {ids: live.filter(it => it.instance.kind !== "party").map(it => it.id), what: "all foes"};
			case "party": case "pcs": return {ids: all.filter(it => it.instance.kind === "party").map(it => it.id), what: "the party"};
			case "turn": case "me": return {ids: getActiveIds(), what: "active turn"};
			case "view": return {ids: viewedId ? [viewedId] : [], what: "viewed"};
		}
		const chip = part.match(/^g(\d)$/);
		if (chip) {
			const group = getChipGroups()[Number(chip[1]) - 1];
			return group ? {ids: group.ids, what: group.name} : null;
		}
		const group = groupNames.find(it => it.toLowerCase() === part || getCompact(it) === getCompact(part));
		if (group) return {ids: live.filter(it => it.group === group).map(it => it.id), what: group};
		const numbered = part.match(/^([a-z][a-z' -]*?)\s?#?(\d+)$/);
		if (numbered) {
			const hits = getBest(numbered[1], all.filter(it => getLabelNumber(it) === numbered[2]), it => it.name);
			if (hits.length) return {ids: hits.map(it => it.id), what: hits.map(it => it.label).join(", ")};
		}
		const byLabel = getBest(part, all, it => it.label);
		if (byLabel.length === 1 && getEncounterTargetScore(part, byLabel[0].label) <= 1 && byLabel[0].instance.kind === "party") {
			return {ids: [byLabel[0].id], what: byLabel[0].label};
		}
		const names = [...new Set(all.map(it => it.name))];
		let found = getBest(part, names);
		if (!found.length && part.endsWith("s")) found = getBest(part.slice(0, -1), names);
		if (!found.length) return null;
		const hits = live.filter(it => found.includes(it.name));
		return {ids: hits.map(it => it.id), what: hits.length > 1 ? hits[0].group || `${hits[0].name}s` : hits[0]?.label || found[0]};
	};

	const ids = [];
	const bad = [];
	const whats = [];
	for (const spec of specs.flatMap(it => `${it}`.split(",")).map(it => it.trim()).filter(Boolean)) {
		const resolved = resolvePart(spec);
		if (!resolved?.ids.length) { bad.push(spec); continue; }
		resolved.ids.forEach(id => { if (!ids.includes(id)) ids.push(id); });
		whats.push(resolved.what);
	}
	return {ids, bad, what: whats.join(" + ")};
}
