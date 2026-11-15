/**
 * P3a — pure (DOM-free) logic behind the `/` command console: parse + resolve targets, the live preview (what will
 * happen to whom, with exact HP after typed damage), the input history, and the grammar cheat-sheet.
 */

import {
	ENCOUNTER_CONDITION_NAMES,
	parseEncounterConsoleCommand,
	resolveEncounterConsoleTargets,
} from "../../encounterworkspace-console-parse.js";
import {getEncounterDamageForMonster} from "../../encounterworkspace-damage.js";
import {getEncounterEffectiveMonster} from "../../encounterworkspace-state.js";
import {getEncounterUsesDeathSaves} from "../../encounterworkspace-deathsaves.js";
import {getEncounterConcentration} from "../../encounterworkspace-fx.js";
import {getCockpitDurationText} from "./act-effect-model.js";
import {getCockpitExtraDefensesGetter} from "../rules.js";
import {getCockpitRollQueryLabel} from "./act-roll-model.js";

export const COCKPIT_CONSOLE_HISTORY_MAX = 30;

/** Compact grammar shown under the console while it has focus. Each example can be clicked to stage it. */
export const COCKPIT_CONSOLE_CHEATSHEET = Object.freeze([
	{group: "HP", items: ["7 fire", "2d6+3 slashing half", "heal 5", "temp 8", "=20"]},
	{group: "Rolls", items: ["save dex 14 8d6 fire half", "save wis 13 frightened", "check stealth adv dc 12", "ds", "init 15"]},
	{group: "Status", items: ["prone 2r", "-prone", "bless 1 min by @mage", "-bless", "conc fly", "drop", "exh 1"]},
	{group: "Targets", items: ["@gob", "@goblin2", "@g1", "@sel", "@all", "@foes", "@turn"]},
]);

const toTitle = text => `${text ?? ""}`.replace(/\b\w/g, it => it.toUpperCase());
const MODE_TEXT = {advantage: " with advantage", disadvantage: " with disadvantage", normal: ""};

/** Effect catalogue for the parser: presets + cover + saved, as {key, label, duration}. */
export function getCockpitConsoleEffects (presets) {
	return presets.map(it => ({key: it.key, label: it.name, duration: it.duration ?? null}));
}

/* -------------------------------------------- History -------------------------------------------- */

/** Adds a line to the history (most recent last), dropping an earlier identical line, capped. */
export function getCockpitConsoleHistoryWith (history, line) {
	const text = `${line ?? ""}`.trim();
	if (!text) return [...history];
	return [...history.filter(it => it !== text), text].slice(-COCKPIT_CONSOLE_HISTORY_MAX);
}

/**
 * Steps through the history. `index` null = editing a fresh line (its text kept in `draft`).
 * dir −1 = older (↑), +1 = newer (↓). Returns {index, text}.
 */
export function getCockpitConsoleHistoryStep ({history, index, draft}, dir) {
	if (!history.length) return {index: null, text: draft};
	if (index == null) {
		if (dir > 0) return {index: null, text: draft};
		return {index: history.length - 1, text: history[history.length - 1]};
	}
	const next = index + dir;
	if (next < 0) return {index: 0, text: history[0]};
	if (next >= history.length) return {index: null, text: draft};
	return {index: next, text: history[next]};
}

/* -------------------------------------------- Parse + targets -------------------------------------------- */

/**
 * Parse a console line and resolve its targets. With no `@` specs the command applies to the dock targets
 * (selection, else the viewed creature). Returns {cmd, ids, what, error}; cmd null for an empty line.
 */
export function getCockpitConsoleCommand (text, {state, conditionNames = ENCOUNTER_CONDITION_NAMES, effects = [], selectedIds = [], activeId = null, viewedId = null, chipGroups = null, dockTargetIds = []}) {
	const cmd = parseEncounterConsoleCommand(text, {conditionNames, effects});
	if (!cmd) return {cmd: null, ids: [], what: "", error: null};
	const opts = {selectedIds, activeId, viewedId, chipGroups};
	let ids = dockTargetIds;
	let what = dockTargetIds.length ? (selectedIds.length ? "selection" : "viewed") : "";
	if (cmd.targets.length) {
		const resolved = resolveEncounterConsoleTargets(state, cmd.targets, opts);
		if (resolved.bad.length) return {cmd, ids: resolved.ids, what: resolved.what, error: `No creature matches ${resolved.bad.map(it => `@${it}`).join(", ")}.`};
		ids = resolved.ids;
		what = resolved.what;
	}
	let casterId = null;
	if (cmd.verb === "effect" && cmd.caster) {
		const caster = resolveEncounterConsoleTargets(state, [cmd.caster], opts);
		if (caster.ids.length !== 1) return {cmd, ids, what, error: caster.ids.length ? `“by ${cmd.caster}” matches ${caster.ids.length} creatures — be more specific.` : `No caster matches “${cmd.caster}”.`};
		casterId = caster.ids[0];
	}
	if (cmd.verb === "error") return {cmd, ids, what, casterId, error: cmd.error};
	if (cmd.verb !== "target" && !ids.length) return {cmd, ids, what, casterId, error: "No targets — select creatures, or name them with @."};
	return {cmd, ids, what, casterId, error: null};
}

/* -------------------------------------------- Preview -------------------------------------------- */

const getHpAfterDamage = (hp, damage) => {
	const temp = Number(hp?.temp) || 0;
	const absorbed = Math.min(temp, damage);
	return {current: Math.max(0, (hp?.current ?? 0) - (damage - absorbed)), temp: temp - absorbed};
};

function getDamageRow (state, instance, {amount, damageType, settings}) {
	if (instance.hp?.current == null) return "HP not set — skipped";
	let damage = amount;
	let note = "";
	if (damageType) {
		const calc = getEncounterDamageForMonster({
			monster: getEncounterEffectiveMonster(instance),
			amount,
			damageType,
			decisions: {},
			extraDefenses: getCockpitExtraDefensesGetter(state, settings)(instance, damageType),
		});
		if (calc.unresolved.length) return `${calc.unresolved[0].defense} ${calc.unresolved[0].note} — you'll be asked`;
		damage = calc.damage;
		note = calc.defenses.immune ? " (immune)" : calc.defenses.resist && calc.defenses.vulnerable ? "" : calc.defenses.resist ? " (resists)" : calc.defenses.vulnerable ? " (vulnerable)" : "";
	}
	const after = getHpAfterDamage(instance.hp, damage);
	return `−${damage}${note} → ${after.current}${after.temp ? ` +${after.temp}` : ""}`;
}

/**
 * What a parsed command will do, before Enter: {title, rows: [{id, label, text}], isRoll}. `amount` overrides
 * dice for previews (dice show as an expression and are only rolled on Enter).
 */
export function getCockpitConsolePreview (parsed, {state, labels, settings = {}, effects = []}) {
	const {cmd, ids, casterId} = parsed;
	if (!cmd || parsed.error) return null;
	const instances = ids.map(id => state.instances.find(it => it.id === id)).filter(Boolean);
	const row = (instance, text) => ({id: instance.id, label: labels.get(instance.id) || instance.id, text});
	const hpText = it => it.hp?.current == null ? "HP not set" : `${it.hp.current}${it.hp.temp ? ` +${it.hp.temp}` : ""}/${it.hp.max}`;
	switch (cmd.verb) {
		case "target":
			return {title: `Select ${parsed.what || "creatures"}`, rows: instances.map(it => row(it, "select")), isRoll: false};
		case "damage": {
			const dice = cmd.expr ? `${cmd.expr}${cmd.crit ? " (crit: dice doubled)" : ""}` : null;
			const fixed = cmd.amount != null ? (cmd.half ? Math.floor(cmd.amount / 2) : cmd.amount) : null;
			const title = `${dice || fixed}${cmd.half && dice ? " halved" : ""} ${cmd.damageType || "untyped"} damage`;
			return {
				title,
				rows: instances.map(it => row(it, fixed == null ? `${hpText(it)} — rolled on Enter` : getDamageRow(state, it, {amount: fixed, damageType: cmd.damageType, settings}))),
				isRoll: false,
			};
		}
		case "heal":
			return {title: `Heal ${cmd.expr || cmd.amount}`, rows: instances.map(it => row(it, it.hp?.current == null ? "HP not set — skipped" : cmd.amount != null ? `+${cmd.amount} → ${Math.min(it.hp.max, Math.max(0, it.hp.current) + cmd.amount)}` : `${hpText(it)} — rolled on Enter`)), isRoll: false};
		case "temp":
			return {title: `${cmd.amount} temp HP`, rows: instances.map(it => row(it, `temp ${Math.max(Number(it.hp?.temp) || 0, cmd.amount)}`)), isRoll: false};
		case "set":
			return {title: `Set HP to ${cmd.amount}`, rows: instances.map(it => row(it, `${it.hp?.current ?? "—"} → ${cmd.amount}`)), isRoll: false};
		case "condition":
			return {title: `${toTitle(cmd.condition)}${cmd.rounds ? ` · ${getCockpitDurationText(cmd.rounds)}` : ""}`, rows: instances.map(it => row(it, it.conditions?.includes(cmd.condition) ? "already has it" : `+ ${cmd.condition}`)), isRoll: false};
		case "effect": {
			const effect = effects.find(it => it.key === cmd.effect);
			const caster = casterId ? labels.get(casterId) : null;
			return {
				title: `${effect?.label || cmd.effect} · ${getCockpitDurationText(cmd.rounds)}${caster ? ` · cast by ${caster}` : ""}`,
				rows: instances.map(it => row(it, (it.effects || []).some(fx => fx.key === cmd.effect) ? "replaces the current one" : `+ ${effect?.label || cmd.effect}`)),
				isRoll: false,
			};
		}
		case "remove": {
			const name = cmd.condition || effects.find(it => it.key === cmd.effect)?.label || cmd.effect;
			const has = it => cmd.condition ? it.conditions?.includes(cmd.condition) : (it.effects || []).some(fx => fx.key === cmd.effect);
			return {title: `End ${toTitle(name)}`, rows: instances.map(it => row(it, has(it) ? `− ${name}` : "doesn't have it")), isRoll: false};
		}
		case "save": {
			const query = {kind: "save", ability: cmd.ability};
			const extras = [
				cmd.dc != null ? `DC ${cmd.dc}` : "no DC",
				cmd.damage ? `${cmd.damage.expr || cmd.damage.amount}${cmd.damageType ? ` ${cmd.damageType}` : ""}${cmd.halfOnSuccess ? " (half on a pass)" : ""}` : null,
				cmd.condition ? `${cmd.condition} on a fail` : null,
			].filter(Boolean).join(" · ");
			return {title: `${getCockpitRollQueryLabel(query)}${MODE_TEXT[cmd.mode] || ""} · ${extras}`, rows: instances.map(it => row(it, it.defeated ? "defeated — skipped" : "rolls")), isRoll: true};
		}
		case "check": {
			const query = {kind: "check", skill: cmd.skill, ability: cmd.ability};
			return {title: `${getCockpitRollQueryLabel(query)}${MODE_TEXT[cmd.mode] || ""}${cmd.dc != null ? ` · DC ${cmd.dc}` : ""}`, rows: instances.map(it => row(it, it.defeated ? "defeated — skipped" : "rolls")), isRoll: true};
		}
		case "deathSave":
			return {title: "Death save", rows: instances.map(it => row(it, getEncounterUsesDeathSaves(it, {monsterDeathSaves: settings.monsterDeathSaves}) && it.deathSaves && !it.deathSaves.stable && !it.deathSaves.dead ? "rolls a d20" : "not making death saves")), isRoll: true};
		case "initiative":
			return {title: `Initiative ${cmd.total}`, rows: instances.map(it => row(it, `→ ${cmd.total}`)), isRoll: false};
		case "dropConcentration":
			return {title: "Drop concentration", rows: instances.map(it => row(it, getEncounterConcentration(it) ? `ends ${getEncounterConcentration(it)}` : "not concentrating")), isRoll: false};
		case "concentration":
			return {title: cmd.spell ? `Concentrate on ${cmd.spell}` : "Drop concentration",
				rows: instances.map(it => {
					const current = getEncounterConcentration(it);
					if (!cmd.spell) return row(it, current ? `ends ${current}` : "not concentrating");
					return row(it, current && current !== cmd.spell ? `switches from ${current} (its effects end)` : `→ ${cmd.spell}`);
				}),
				isRoll: false};
		case "exhaustion":
			return {title: `Exhaustion ${cmd.level}`, rows: instances.map(it => row(it, `→ level ${cmd.level}`)), isRoll: false};
		default:
			return null;
	}
}

/* -------------------------------------------- Execution helpers -------------------------------------------- */

/** A critical hit doubles every die: "2d6+3" → "4d6+3", "d8" → "2d8". */
export function getCockpitCritExpr (expr) {
	return `${expr ?? ""}`.replace(/(\d*)d(\d+)/gi, (_, count, faces) => `${(Number(count) || 1) * 2}d${faces}`);
}

/** The save outcome (for the roll tray) a parsed `save` command carries, or null. */
export function getCockpitConsoleSaveOutcome (cmd) {
	if (cmd?.verb !== "save" || (!cmd.damage && !cmd.condition)) return null;
	return {
		damage: cmd.damage ? {expr: cmd.damage.expr, amount: cmd.damage.amount} : null,
		damageType: cmd.damage ? cmd.damageType || null : null,
		halfOnSuccess: !!cmd.damage && !!cmd.halfOnSuccess,
		condition: cmd.condition || null,
		rounds: cmd.rounds ?? null,
	};
}

/** A @handle for a creature label that the target resolver finds again: "Goblin 2" → "@goblin2". */
export const getCockpitConsoleHandle = label => `@${`${label ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
