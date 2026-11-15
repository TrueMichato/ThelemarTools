import {getEncounterEffectiveMonster} from "./encounterworkspace-state.js";
import {
	ENCOUNTER_ABILITIES,
	ENCOUNTER_ABILITY_NAMES,
	ENCOUNTER_SKILL_ABILITIES,
	getEncounterAbilityMod,
	getEncounterBaseAc,
	getEncounterBaseAcInfo,
} from "./encounterworkspace-fx.js";

export {ENCOUNTER_ABILITIES, ENCOUNTER_ABILITY_NAMES, ENCOUNTER_SKILL_ABILITIES, getEncounterAbilityMod, getEncounterBaseAc, getEncounterBaseAcInfo};

/**
 * Pure roll maths for the Encounter Cockpit. Every roll reports the natural die and each named bonus
 * (`18 (13 +5)` plus `parts`), so the DM can see why a total is what it is.
 *
 * Contributors follow the shared cockpit contract: `getContributors(instance, query)` returns a partial
 * (or an array of partials) shaped `{bonuses, advantage, disadvantage, autoFail, autoCrit, notes}`.
 */

export const ENCOUNTER_ROLL_KINDS = Object.freeze(["attack", "save", "check", "damage", "ac", "initiative"]);

const EMPTY_PARTIAL = Object.freeze({bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []});

export const getEncounterSignedNumber = value => `${value < 0 ? "-" : "+"}${Math.abs(value)}`;

export function getEncounterCrNumber (cr) {
	const raw = cr && typeof cr === "object" ? cr.cr : cr;
	if (raw == null) return null;
	const text = `${raw}`.trim();
	const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
	if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
	return Number(text);
}

export function getEncounterProficiencyBonus (monster) {
	if (Number.isSafeInteger(monster?.profBonus)) return monster.profBonus;
	const cr = getEncounterCrNumber(monster?.cr);
	return cr == null ? 2 : Math.max(2, Math.ceil(cr / 4) + 1);
}

export function getEncounterNormalizedSkill (skill) {
	const key = `${skill ?? ""}`.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
	return Object.hasOwn(ENCOUNTER_SKILL_ABILITIES, key) ? key : null;
}

function getStatblockNumber (value) {
	if (Number.isFinite(value)) return Math.trunc(value);
	const match = `${value ?? ""}`.trim().match(/^([+-]?)\s*(\d+)/);
	return match ? (match[1] === "-" ? -1 : 1) * Number(match[2]) : null;
}

/** The initiative bonus, following the 5etools `initiative` field (number, `{initiative}` or `{proficiency}`). */
export function getEncounterInitiativeBonus (monster) {
	const dex = getEncounterAbilityMod(monster?.dex);
	const value = monster?.initiative;
	if (Number.isFinite(value)) return Math.trunc(value);
	if (value && typeof value === "object") {
		if (Number.isFinite(value.initiative)) return Math.trunc(value.initiative);
		if (Number.isFinite(value.proficiency)) return dex + value.proficiency * getEncounterProficiencyBonus(monster);
	}
	return dex;
}

function getModeName (mode) {
	if (mode == null || mode === "normal") return "normal";
	if (/^adv/i.test(mode)) return "advantage";
	if (/^dis/i.test(mode)) return "disadvantage";
	throw new Error(`Unknown roll mode: ${mode}.`);
}

/** Combines a forced roll mode (Shift/Ctrl) with contributor sources; any advantage plus any disadvantage cancels (PHB p. 173). */
export function getEncounterRollMode ({advantage = [], disadvantage = [], forcedMode = null, forcedLabel = "Shift/Ctrl"} = {}) {
	const forced = getModeName(forcedMode);
	const adv = [...advantage];
	const dis = [...disadvantage];
	if (forced === "advantage") adv.push({label: forcedLabel, source: "forced"});
	if (forced === "disadvantage") dis.push({label: forcedLabel, source: "forced"});
	return {
		mode: adv.length && !dis.length ? "advantage" : dis.length && !adv.length ? "disadvantage" : "normal",
		advantage: adv,
		disadvantage: dis,
		cancelled: adv.length > 0 && dis.length > 0,
	};
}

const rollDie = (faces, rng) => 1 + Math.floor(Math.min(0.999999999, Math.max(0, rng())) * faces);

/** Rolls a sum of dice and flat terms such as `2d6+3`, `-1d4` or `1d8 + 1d6`. */
export function rollEncounterDice (expr, rng = Math.random, {critical = false} = {}) {
	const text = `${expr ?? ""}`.replace(/\s+/g, "").toLowerCase();
	if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(text)) throw new Error(`Cannot roll “${expr}”.`);
	const terms = [];
	let total = 0;
	for (const [, sign, body] of text.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
		const factor = sign === "-" ? -1 : 1;
		const dice = body.match(/^(\d*)d(\d+)$/);
		if (!dice) {
			terms.push({sign: factor, value: Number(body)});
			total += factor * Number(body);
			continue;
		}
		const count = (dice[1] === "" ? 1 : Number(dice[1])) * (critical ? 2 : 1);
		const faces = Number(dice[2]);
		if (!count || !faces || count > 100) throw new Error(`Cannot roll “${expr}”.`);
		const rolls = Array.from({length: count}, () => rollDie(faces, rng));
		const sum = rolls.reduce((a, b) => a + b, 0);
		terms.push({sign: factor, dice: `${count}d${faces}`, rolls, value: sum});
		total += factor * sum;
	}
	const rolledExpr = terms.map((it, ix) => `${it.sign < 0 ? "-" : ix ? "+" : ""}${it.dice || it.value}`).join("");
	return {expr: rolledExpr, total, terms, rolls: terms.flatMap(it => it.rolls || [])};
}

export function rollEncounterD20 ({mode = "normal", rng = Math.random} = {}) {
	const normalized = getModeName(mode);
	const rolls = normalized === "normal" ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)];
	const natural = normalized === "advantage" ? Math.max(...rolls) : normalized === "disadvantage" ? Math.min(...rolls) : rolls[0];
	return {natural, rolls, mode: normalized};
}

/** Merges contributor partials (single partial, array, or nested arrays) into one partial. */
export function combineEncounterContributorPartials (partials) {
	const out = {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
	const visit = partial => {
		if (!partial) return;
		if (Array.isArray(partial)) return partial.forEach(visit);
		for (const key of Object.keys(out)) {
			const value = partial[key];
			if (value == null) continue;
			out[key].push(...(Array.isArray(value) ? value : [value]));
		}
	};
	visit(partials);
	return out;
}

/** Builds a `getContributors(instance, query)` callback from `(state, instance, query) => partial` providers. */
export function getEncounterContributorGetter (state, providers = []) {
	return (instance, query) => combineEncounterContributorPartials(providers.map(provider => provider(state, instance, query)));
}

const getAbilityPart = (monster, ability) => ({label: `${ability.toUpperCase()} mod`, value: getEncounterAbilityMod(monster?.[ability]), source: "statblock"});

function getProficiencyLabel (remainder, pb, fallback) {
	if (remainder === pb) return "Proficiency";
	if (remainder === 2 * pb) return "Expertise";
	return fallback;
}

/** Parses `{@hit N}` attacks and their `{@damage}` riders from the effective statblock. */
export function getEncounterAttackOptions (monster) {
	const sections = ["action", "bonus", "reaction", "legendary", "mythic"];
	const out = [];
	for (const section of sections) {
		for (const entry of monster?.[section] || []) {
			const text = JSON.stringify(entry?.entries || []);
			const hit = text.match(/\{@hit\s+([+-]?\d+)/);
			if (!hit) continue;
			const atk = text.match(/\{@atkr?\s+([a-z,]+)\}/i)?.[1]?.toLowerCase() || "";
			const damage = [...text.matchAll(/\{@damage\s+([^}|]+)[^}]*\}\)?\s*([a-z]+)?/gi)].map(match => ({
				expr: match[1].replace(/\s+/g, ""),
				damageType: match[2]?.toLowerCase() || null,
			}));
			out.push({
				name: `${entry.name || "Attack"}`.replace(/\{@[a-z]+\s+([^}|]+)[^}]*\}/gi, "$1"),
				section,
				bonus: Number(hit[1]),
				melee: /(^|,)(m|mw|ms)\b/.test(atk) || atk === "m",
				ranged: /(^|,)(r|rw|rs)\b/.test(atk),
				spell: /(ms|rs)/.test(atk),
				damage,
			});
		}
	}
	return out;
}

function getBaseParts (monster, query) {
	const pb = getEncounterProficiencyBonus(monster);
	switch (query.kind) {
		case "save": {
			const ability = query.ability;
			if (!ENCOUNTER_ABILITIES.includes(ability)) throw new Error("Choose a saving throw ability.");
			const base = getAbilityPart(monster, ability);
			const listed = getStatblockNumber(monster?.save?.[ability]);
			if (listed == null || listed === base.value) return [base];
			return [base, {label: getProficiencyLabel(listed - base.value, pb, "Save bonus"), value: listed - base.value, source: "statblock"}];
		}
		case "check": {
			const skill = query.skill == null ? null : getEncounterNormalizedSkill(query.skill);
			if (query.skill != null && !skill) throw new Error(`Unknown skill: ${query.skill}.`);
			const ability = skill ? ENCOUNTER_SKILL_ABILITIES[skill] : query.ability;
			if (!ENCOUNTER_ABILITIES.includes(ability)) throw new Error("Choose a skill or ability for the check.");
			const base = getAbilityPart(monster, ability);
			const listed = skill ? getStatblockNumber(monster?.skill?.[skill]) : null;
			if (listed == null || listed === base.value) return [base];
			return [base, {label: getProficiencyLabel(listed - base.value, pb, "Skill bonus"), value: listed - base.value, source: "statblock"}];
		}
		case "initiative": {
			const base = getAbilityPart(monster, "dex");
			const total = getEncounterInitiativeBonus(monster);
			if (total === base.value) return [base];
			const label = monster?.initiative?.proficiency != null ? getProficiencyLabel(total - base.value, pb, "Initiative bonus") : "Initiative bonus";
			return [base, {label, value: total - base.value, source: "statblock"}];
		}
		case "attack": {
			const attack = query.attack ?? (query.attackName
				? getEncounterAttackOptions(monster).find(it => it.name.toLowerCase() === `${query.attackName}`.toLowerCase())
				: null);
			const bonus = Number.isFinite(query.bonus) ? query.bonus : attack?.bonus;
			if (!Number.isFinite(bonus)) return [];
			const ranged = query.ranged ?? attack?.ranged ?? false;
			for (const ability of ranged ? ["dex", "str"] : ["str", "dex"]) {
				const mod = getEncounterAbilityMod(monster?.[ability]);
				if (mod + pb === bonus) return [getAbilityPart(monster, ability), {label: "Proficiency", value: pb, source: "statblock"}];
			}
			return [{label: attack?.name ? `${attack.name} to hit` : "Attack bonus", value: bonus, source: "statblock"}];
		}
		default: throw new Error(`Unsupported roll kind: ${query.kind}.`);
	}
}

function getBonusPart (bonus, rng, {critical = false} = {}) {
	const label = bonus.label || "Bonus";
	if (Number.isFinite(bonus.value)) {
		return {label, value: Math.trunc(bonus.value), source: bonus.source || "effect", text: `${label} ${getEncounterSignedNumber(Math.trunc(bonus.value))}`};
	}
	const rolled = rollEncounterDice(bonus.value, rng, {critical});
	const dice = rolled.expr.replace(/^\+/, "");
	return {label, value: rolled.total, source: bonus.source || "effect", dice, rolls: rolled.rolls, text: `${label} ${dice}→${rolled.total}`};
}

function getContributorPartial (getContributors, instance, query) {
	return combineEncounterContributorPartials(getContributors ? getContributors(instance, query) : EMPTY_PARTIAL);
}

/** The flat modifier a roll would use before dice bonuses, for previews (no dice are rolled). */
export function getEncounterRollModifier ({instance, query, getContributors = null, forcedMode = null}) {
	const monster = getEncounterEffectiveMonster(instance);
	const partial = getContributorPartial(getContributors, instance, query);
	const parts = getBaseParts(monster, query);
	const flat = partial.bonuses.filter(it => Number.isFinite(it.value));
	const dice = partial.bonuses.filter(it => !Number.isFinite(it.value)).map(it => ({label: it.label, dice: `${it.value}`, source: it.source}));
	const mode = getEncounterRollMode({advantage: partial.advantage, disadvantage: partial.disadvantage, forcedMode});
	return {
		modifier: [...parts, ...flat].reduce((sum, it) => sum + Math.trunc(it.value), 0),
		parts: [...parts, ...flat.map(it => ({label: it.label, value: Math.trunc(it.value), source: it.source || "effect"}))],
		dice,
		...mode,
		autoFail: partial.autoFail.length > 0,
		autoFailFrom: partial.autoFail,
		autoCrit: partial.autoCrit,
		notes: partial.notes,
	};
}

/**
 * Rolls a d20 test for one instance.
 * @param {object} opts
 * @param {object} opts.instance v8 encounter instance
 * @param {{kind: string, ability?: string, skill?: string, targetId?: string, dc?: number, bonus?: number, attackName?: string, ranged?: boolean}} opts.query
 * @param {function} [opts.rng] deterministic source in [0, 1)
 * @param {string} [opts.forcedMode] "adv"/"advantage", "dis"/"disadvantage" or null (Shift/Ctrl)
 * @param {function} [opts.getContributors] `(instance, query) => partial`
 */
export function getEncounterRollBreakdown ({instance, query, rng = Math.random, forcedMode = null, forcedLabel = "Shift/Ctrl", getContributors = null}) {
	if (!instance) throw new Error("This encounter target no longer exists.");
	if (!query || !["attack", "save", "check", "initiative"].includes(query.kind)) throw new Error("Choose an attack, save, check or initiative roll.");
	const monster = getEncounterEffectiveMonster(instance);
	const partial = getContributorPartial(getContributors, instance, query);
	const mode = getEncounterRollMode({advantage: partial.advantage, disadvantage: partial.disadvantage, forcedMode, forcedLabel});
	const d20 = rollEncounterD20({mode: mode.mode, rng});
	const parts = [
		...getBaseParts(monster, query).map(part => ({...part, text: `${part.label} ${getEncounterSignedNumber(part.value)}`})),
		...partial.bonuses.map(bonus => getBonusPart(bonus, rng)),
	];
	const modifier = parts.reduce((sum, part) => sum + part.value, 0);
	const total = d20.natural + modifier;
	const autoFail = partial.autoFail.length > 0;
	const dc = Number.isFinite(query.dc) ? query.dc : null;
	return {
		kind: query.kind,
		natural: d20.natural,
		rolls: d20.rolls,
		...mode,
		parts,
		modifier,
		total,
		text: parts.length ? `${total} (${d20.natural} ${parts.map(part => getEncounterSignedNumber(part.value)).join(" ")})` : `${total}`,
		crit: d20.natural === 20,
		fumble: d20.natural === 1,
		autoFail,
		autoFailFrom: partial.autoFail,
		autoCrit: partial.autoCrit,
		notes: partial.notes,
		dc,
		success: dc == null ? null : !autoFail && total >= dc,
	};
}

/** Rolls damage; a critical hit doubles every die (PHB p. 196), including dice bonuses from contributors. */
export function getEncounterDamageRollBreakdown ({expr, damageType = null, crit = false, rng = Math.random, instance = null, query = {}, getContributors = null, label = "Damage"}) {
	const rolled = rollEncounterDice(expr, rng, {critical: crit});
	const partial = instance ? getContributorPartial(getContributors, instance, {...query, kind: "damage", damageType}) : EMPTY_PARTIAL;
	const parts = [
		{label, value: rolled.total, source: "statblock", dice: rolled.expr, rolls: rolled.rolls, text: `${label} ${rolled.expr}→${rolled.total}`},
		...partial.bonuses.map(bonus => getBonusPart(bonus, rng, {critical: crit})),
	];
	const total = Math.max(0, parts.reduce((sum, part) => sum + part.value, 0));
	return {
		kind: "damage",
		damageType,
		crit,
		parts,
		total,
		text: `${total}${damageType ? ` ${damageType}` : ""} (${parts.map(part => part.text).join(", ")})`,
		notes: partial.notes,
	};
}

/** AC with every flat contributor named (`17 (15 +2)`); dice contributors cannot apply to AC and become notes. */
export function getEncounterAcBreakdown ({instance, getContributors = null, query = {}}) {
	const monster = getEncounterEffectiveMonster(instance);
	const base = getEncounterBaseAcInfo(instance, monster);
	const partial = getContributorPartial(getContributors, instance, {...query, kind: "ac"});
	const bonuses = partial.bonuses.filter(it => Number.isFinite(it.value));
	const parts = bonuses.map(it => ({label: it.label, value: Math.trunc(it.value), source: it.source || "effect", text: `${it.label} ${getEncounterSignedNumber(Math.trunc(it.value))}`}));
	const total = base.value + parts.reduce((sum, it) => sum + it.value, 0);
	return {
		kind: "ac",
		base: base.value,
		baseFrom: base.from,
		parts,
		total,
		text: parts.length ? `${total} (${base.value} ${parts.map(it => getEncounterSignedNumber(it.value)).join(" ")})` : `${total}`,
		notes: [...partial.notes, ...partial.bonuses.filter(it => !Number.isFinite(it.value)).map(it => `${it.label} (${it.value}) does not change AC`)],
	};
}
