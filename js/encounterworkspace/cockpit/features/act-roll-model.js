/**
 * P3a — pure (DOM-free) logic behind the Roll dock tab and the roll tray: the request → query, the tray rows
 * (kept/struck dice, pass/fail), sorting, and the save-outcome plan (full / half / minion-zero / condition-on-fail).
 */

import {ENCOUNTER_ABILITY_NAMES, ENCOUNTER_SKILL_ABILITIES} from "../../encounterworkspace-fx.js";
import {getEncounterRollModifier, getEncounterSignedNumber} from "../../encounterworkspace-rollbreakdown.js";
import {getEncounterPreset, getEncounterPresetCitation} from "../../encounterworkspace-effects.js";

export const COCKPIT_ROLL_KINDS = Object.freeze([
	{value: "save", label: "Save"},
	{value: "check", label: "Check"},
	{value: "skill", label: "Skill"},
]);
export const COCKPIT_ROLL_MODES = Object.freeze([
	{value: "normal", label: "Normal"},
	{value: "advantage", label: "Adv"},
	{value: "disadvantage", label: "Dis"},
]);
export const COCKPIT_TRAY_SORTS = Object.freeze([
	{value: "order", label: "Order"},
	{value: "total", label: "Total"},
	{value: "name", label: "Name"},
]);

const ABILITY_SHORT = ab => `${ab}`.slice(0, 1).toUpperCase() + `${ab}`.slice(1, 3);
const toTitle = text => `${text}`.replace(/\b\w/g, it => it.toUpperCase());

export function getCockpitEmptyRollForm () {
	return {kind: "save", ability: "dex", skill: "perception", mode: "normal", dc: "", damage: "", damageType: null, isHalf: true, condition: "", rounds: ""};
}

/** Shift = advantage, Ctrl/⌘ = disadvantage; otherwise the form's mode. */
export function getCockpitRollModeFromEvent (evt, mode = "normal") {
	if (evt?.shiftKey && !(evt.ctrlKey || evt.metaKey)) return "advantage";
	if ((evt?.ctrlKey || evt?.metaKey) && !evt.shiftKey) return "disadvantage";
	return mode;
}

/** "Dex save", "Str check", "Stealth (Dex)". */
export function getCockpitRollQueryLabel (query) {
	if (!query) return "";
	if (query.kind === "save") return `${ABILITY_SHORT(query.ability)} save`;
	if (query.skill) return `${toTitle(query.skill)} (${ABILITY_SHORT(ENCOUNTER_SKILL_ABILITIES[query.skill] || query.ability)})`;
	return `${ABILITY_SHORT(query.ability)} check`;
}

/**
 * Validate the Roll tab form into a request for rollEncounterSaves / rollEncounterChecks.
 * Returns {ok, request: {kind: "save"|"check", ability, skill, dc, mode}, outcome, title} or {ok: false, message, field}.
 */
export function getCockpitRollRequest (form, {mode = form.mode} = {}) {
	const dcRaw = `${form.dc ?? ""}`.trim();
	let dc = null;
	if (dcRaw) {
		if (!/^\d{1,2}$/.test(dcRaw)) return {ok: false, message: "The DC must be a whole number from 0 to 99.", field: "dc"};
		dc = Number(dcRaw);
	}
	let request;
	if (form.kind === "skill") {
		if (!Object.hasOwn(ENCOUNTER_SKILL_ABILITIES, form.skill)) return {ok: false, message: "Choose a skill.", field: "skill"};
		request = {kind: "check", skill: form.skill, ability: ENCOUNTER_SKILL_ABILITIES[form.skill], dc, mode};
	} else {
		if (!Object.hasOwn(ENCOUNTER_ABILITY_NAMES, form.ability)) return {ok: false, message: "Choose an ability.", field: "ability"};
		request = {kind: form.kind === "save" ? "save" : "check", skill: null, ability: form.ability, dc, mode};
	}
	let outcome = null;
	if (request.kind === "save") {
		const damage = `${form.damage ?? ""}`.trim().replace(/\s+/g, "");
		if (damage && !/^(?:\d+|\d*d\d+(?:[+-]\d+)?)$/i.test(damage)) return {ok: false, message: "Enter damage like 14 or 8d6.", field: "damage"};
		const roundsRaw = `${form.rounds ?? ""}`.trim();
		if (roundsRaw && !/^\d{1,4}$/.test(roundsRaw)) return {ok: false, message: "Condition rounds must be a whole number.", field: "rounds"};
		if ((damage || form.condition) && dc == null) return {ok: false, message: "Set a DC to apply damage or a condition on a fail.", field: "dc"};
		if (damage || form.condition) {
			outcome = {
				damage: damage ? (/d/i.test(damage) ? {expr: damage.toLowerCase(), amount: null} : {expr: null, amount: Number(damage)}) : null,
				damageType: damage ? form.damageType || null : null,
				halfOnSuccess: !!damage && !!form.isHalf,
				condition: form.condition || null,
				rounds: roundsRaw ? Number(roundsRaw) : null,
			};
		}
	}
	const title = `${getCockpitRollQueryLabel(request)}${dc != null ? ` DC ${dc}` : ""}`;
	return {ok: true, request, outcome, title};
}

/** The "Roll" button text: "Roll 3 × Dex save". */
export function getCockpitRollButtonText (request, count) {
	return `Roll ${count} × ${getCockpitRollQueryLabel(request)}`;
}

/** The rollbreakdown query a request rolls. */
export function getCockpitRollQuery (request) {
	if (request.kind === "save") return {kind: "save", ability: request.ability, dc: request.dc};
	return request.skill ? {kind: "check", skill: request.skill, dc: request.dc} : {kind: "check", ability: request.ability, dc: request.dc};
}

/**
 * "Who rolls" preview before rolling: each live target's modifier, dice bonuses and advantage state with the sources
 * that cause it. Rows: {id, label, text: "Dex +2 +1d4", mode, from: "Bless, Prone", isAutoFail, isCancelled, isDefeated}.
 */
export function getCockpitWhoRolls (state, ids, request, {getContributors = null, labels = new Map()} = {}) {
	const byId = new Map(state.instances.map(it => [it.id, it]));
	const query = getCockpitRollQuery(request);
	const short = request.skill ? toTitle(request.skill) : ABILITY_SHORT(request.ability);
	return ids.map(id => byId.get(id)).filter(Boolean).map(instance => {
		const label = labels.get(instance.id) || instance.label || instance.id;
		if (instance.defeated) return {id: instance.id, label, text: "defeated — skipped", mode: "normal", from: "", isAutoFail: false, isCancelled: false, isDefeated: true};
		const preview = getEncounterRollModifier({instance, query, getContributors, forcedMode: request.mode === "normal" ? null : request.mode});
		const dice = preview.dice.map(it => it.dice.startsWith("-") ? `−${it.dice.slice(1)}` : `+${it.dice}`).join(" ");
		const fromList = preview.autoFail ? preview.autoFailFrom : preview.mode === "advantage" ? preview.advantage : preview.mode === "disadvantage" ? preview.disadvantage : [];
		return {
			id: instance.id,
			label,
			text: `${short} ${getEncounterSignedNumber(preview.modifier)}${dice ? ` ${dice}` : ""}`,
			mode: preview.mode,
			from: [...new Set(fromList.map(it => it.label ?? it))].join(", "),
			isAutoFail: !!preview.autoFail,
			isCancelled: !!preview.cancelled,
			isDefeated: false,
		};
	});
}

/* -------------------------------------------- Tray -------------------------------------------- */

const getKeptIndex = (rolls, mode) => {
	if (!rolls || rolls.length < 2) return 0;
	if (mode === "advantage") return rolls[0] >= rolls[1] ? 0 : 1;
	if (mode === "disadvantage") return rolls[0] <= rolls[1] ? 0 : 1;
	return 0;
};

/** One tray row per rolled creature: dice (kept/struck), total, verdict and breakdown lines. */
export function getCockpitTrayRow (result) {
	const roll = result.roll;
	const rolls = roll.rolls?.length ? roll.rolls : [roll.natural];
	const kept = getKeptIndex(rolls, roll.mode);
	return {
		id: result.id,
		label: result.label,
		dice: rolls.map((value, ix) => ({value, isKept: ix === kept})),
		natural: roll.natural,
		total: roll.total,
		success: result.success,
		verdict: result.success == null ? null : result.success ? "pass" : "fail",
		mode: roll.mode,
		isCrit: !!roll.crit,
		isFumble: !!roll.fumble,
		isAutoFail: !!roll.autoFail,
		text: roll.text,
		lines: [
			{label: `d20${rolls.length > 1 ? ` (${roll.mode === "advantage" ? "advantage" : roll.mode === "disadvantage" ? "disadvantage" : "cancelled"})` : ""}`, value: `${roll.natural}`, source: null},
			...(roll.parts || []).map(part => ({label: part.label, value: part.dice ? `${part.dice}→${part.value}` : getEncounterSignedNumber(part.value), source: part.source || null})),
			...(roll.advantage || []).map(it => ({label: `Advantage — ${it.label}`, value: "", source: it.source || null})),
			...(roll.disadvantage || []).map(it => ({label: `Disadvantage — ${it.label}`, value: "", source: it.source || null})),
			...(roll.autoFailFrom || []).map(it => ({label: `Auto-fail — ${it.label ?? it}`, value: "", source: it.source || null})),
			...(roll.notes || []).map(it => ({label: typeof it === "string" ? it : it.label ?? it.text ?? "", value: "", source: it.source || null, isNote: true})),
		],
	};
}

/** Tray rows sorted by initiative order, total (best first) or name. */
export function getCockpitTrayRows (rolled, {sort = "order", orderIds = []} = {}) {
	const rows = (rolled?.results || []).map(getCockpitTrayRow);
	if (sort === "total") return rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
	if (sort === "name") return rows.sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric: true}));
	const pos = new Map(orderIds.map((id, ix) => [id, ix]));
	return rows.sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6));
}

export function getCockpitTrayCounts (rolled) {
	const results = rolled?.results || [];
	return {
		total: results.length,
		passed: results.filter(it => it.success === true).length,
		failed: results.filter(it => it.success === false).length,
		skipped: (rolled?.skipped || []).length,
	};
}

/** "Fireball · 8d6 fire (half on a pass) · Prone on a fail". */
export function getCockpitOutcomeText (outcome) {
	if (!outcome) return "";
	const bits = [];
	if (outcome.damage) {
		const amount = outcome.damage.expr || outcome.damage.amount;
		bits.push(`${amount}${outcome.damageType ? ` ${outcome.damageType}` : ""}${outcome.halfOnSuccess ? " (half on a pass)" : ""}`);
	}
	if (outcome.condition) bits.push(`${toTitle(outcome.condition)} on a fail${outcome.rounds ? ` (${outcome.rounds} rounds)` : ""}`);
	return bits.join(" · ");
}

const getIsMinion = instance => (instance?.templates || []).some(it => it.key === "minion");

/**
 * Steps to apply a save outcome, mirroring applyEncounterSaveOutcome: failed creatures take the full amount and
 * gain the condition; passed creatures take half (rounded down) when halfOnSuccess — minions take none on a pass.
 * Damage is rolled once (the caller passes the rolled `amount`). Returns [{kind: "damage", ids, amount, isHalf} |
 * {kind: "condition", ids, condition, rounds}].
 */
export function getCockpitOutcomeSteps (state, rolled, outcome, {amount = 0} = {}) {
	if (!outcome) return [];
	const results = rolled?.results || [];
	const live = new Map(state.instances.map(it => [it.id, it]));
	const failedIds = results.filter(it => it.success === false && live.has(it.id)).map(it => it.id);
	const passedIds = results.filter(it => it.success === true && live.has(it.id)).map(it => it.id);
	const steps = [];
	if (outcome.damage && amount > 0) {
		if (failedIds.length) steps.push({kind: "damage", ids: failedIds, amount, isHalf: false});
		const halfIds = outcome.halfOnSuccess ? passedIds.filter(id => !getIsMinion(live.get(id))) : [];
		if (halfIds.length && Math.floor(amount / 2) > 0) steps.push({kind: "damage", ids: halfIds, amount: Math.floor(amount / 2), isHalf: true});
	}
	if (outcome.condition && failedIds.length) steps.push({kind: "condition", ids: failedIds, condition: outcome.condition, rounds: outcome.rounds ?? null});
	return steps;
}

/** A plain-text copy of the tray for the log: "Dex save DC 14 — Goblin 1 17 ✓, Goblin 2 9 ✗". */
export function getCockpitTrayLogText (title, rolled) {
	const parts = (rolled?.results || []).map(it => `${it.label} ${it.roll.text}${it.success == null ? "" : it.success ? " ✓" : " ✗"}`);
	return `${title} — ${parts.join(", ")}`;
}

/**
 * The Roll tab's skill chips, filtered by the search box: a name prefix or substring ("perc", "sleight"), or an
 * ability ("dex", "wis") for every skill that uses it. Returns [{skill, label, ability}] in `skills` order.
 */
export function getCockpitSkillMatches (skills, query = "") {
	const q = `${query ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
	const all = skills.map(skill => {
		const ability = ENCOUNTER_SKILL_ABILITIES[skill] || "";
		return {skill, label: toTitle(skill), ability: ability.slice(0, 3)};
	});
	if (!q) return all;
	return all.filter(it => it.skill.includes(q) || it.ability === q || ENCOUNTER_ABILITY_NAMES[ENCOUNTER_SKILL_ABILITIES[it.skill]]?.toLowerCase() === q);
}

/* ------------------------------------------ Roll-time prompt (D41) ------------------------------------------ */

/** Conditions whose roll effect depends on the scene, keyed by condition → the question asked before rolling. */
export const COCKPIT_ROLL_CONDITION_QUESTIONS = Object.freeze({
	frightened: "Is the source of its fear in sight?",
});

const CONTRIBUTOR_LISTS = ["bonuses", "advantage", "disadvantage", "autoFail", "autoCrit"];

/** The scene question behind one contributor `source` on `instance`, or null when the source always applies. */
function getSourceQuestion (state, instance, source) {
	const [kind, ...rest] = `${source || ""}`.split(":");
	const id = rest.join(":");
	if (kind === "condition") {
		const question = COCKPIT_ROLL_CONDITION_QUESTIONS[id];
		return question ? {question, cite: "Condition"} : null;
	}
	const presetId = kind === "battlefield" ? (state.battlefield || []).find(it => it.id === id)?.rule
		: kind === "effect" ? (instance.effects || []).find(it => it.id === id)?.presetId
			: null;
	const preset = presetId ? getEncounterPreset(presetId) : null;
	return preset?.contextQuestion ? {question: preset.contextQuestion, cite: getEncounterPresetCitation(preset)} : null;
}

/**
 * Scene-dependent sources that would change this roll (frightened with its fear source out of sight, heavy rain on
 * a Perception check, …), one question per source with every creature it touches:
 * [{key, question, label, cite, ids, names}]. Only sources that actually contribute to the roll are asked about;
 * defeated creatures (who won't roll) are skipped. `labels` is a Map id → display label.
 */
export function getCockpitRollQuestions ({state, ids, query, getContributors, labels = new Map()}) {
	const byKey = new Map();
	for (const id of ids) {
		const instance = state.instances.find(it => it.id === id);
		if (!instance || instance.defeated) continue;
		const contributors = getContributors(instance, query) || {};
		for (const list of CONTRIBUTOR_LISTS) {
			for (const entry of contributors[list] || []) {
				if (!entry?.source) continue;
				const asked = getSourceQuestion(state, instance, entry.source);
				if (!asked) continue;
				const it = byKey.get(entry.source) || {key: entry.source, question: asked.question, label: entry.label, cite: asked.cite, ids: [], names: []};
				if (!it.ids.includes(id)) {
					it.ids.push(id);
					it.names.push(labels.get(id) || instance.name || id);
				}
				byKey.set(entry.source, it);
			}
		}
	}
	return [...byKey.values()];
}

/**
 * Applies the prompt's answers ({key: "yes"|"no"|"cancel"}): "no" drops that source from every contributor list,
 * "cancel" drops the creatures it touches from the roll. Returns {ids, getContributors} — ids keep their order.
 */
export function getCockpitAnsweredRoll ({ids, questions, answers, getContributors}) {
	const dropped = new Set(questions.filter(it => answers[it.key] === "no").map(it => it.key));
	const cancelled = new Set(questions.filter(it => answers[it.key] === "cancel").flatMap(it => it.ids));
	const answered = !dropped.size ? getContributors : (instance, query) => {
		const contributors = getContributors(instance, query) || {};
		const out = {...contributors};
		for (const list of CONTRIBUTOR_LISTS) {
			if (Array.isArray(contributors[list])) out[list] = contributors[list].filter(it => !dropped.has(it?.source));
		}
		return out;
	};
	return {ids: ids.filter(id => !cancelled.has(id)), getContributors: answered};
}
