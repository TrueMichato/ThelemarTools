/**
 * P4 — pure helpers for the statblock roll feed: every dice link clicked in a statblock becomes a card (attack,
 * save, check, initiative or damage) in the floating tray, so damage can be applied to the selection in one click.
 */

import {ENCOUNTER_DAMAGE_TYPES} from "../../encounterworkspace-damage.js";
import {getEncounterSignedNumber, rollEncounterDice} from "../../encounterworkspace-rollbreakdown.js";

export const COCKPIT_FEED_VISIBLE = 3;
export const COCKPIT_FEED_MAX = 30;
export const COCKPIT_FEED_MULTIPLIERS = Object.freeze([
	{value: 0.5, label: "½", title: "Half damage"},
	{value: 2, label: "×2", title: "Double damage"},
]);

/** The roll-breakdown query for a statblock d20 link (from `getEncounterRollFromPackedDice`). */
export function getCockpitStatblockRollQuery (roll, {attackName = null} = {}) {
	switch (roll?.rollType) {
		case "attack": return {kind: "attack", bonus: roll.baseBonus, attackName};
		case "save": return {kind: "save", ability: roll.key};
		case "ability": return {kind: "check", ability: roll.key};
		case "skill": return {kind: "check", skill: roll.key};
		case "initiative": return {kind: "initiative"};
		default: return null;
	}
}

const DAMAGE_TYPE_RE = new RegExp(`^\\s*\\)?\\s*(?:plus\\s+)?(${ENCOUNTER_DAMAGE_TYPES.join("|")})\\b`, "i");

/**
 * A statblock damage link as {expr, damageType} — `entry` is the parsed `data-packed-dice`, `trailingText` the text
 * right after the link (`) piercing damage`). Null for anything that is not a plain rollable damage expression.
 */
export function getCockpitStatblockDamage (entry, trailingText = "") {
	if (entry?.subType !== "damage" || typeof entry.toRoll !== "string") return null;
	const expr = entry.toRoll.replace(/\s+/g, "");
	try {
		rollEncounterDice(expr, () => 0);
	} catch (e) {
		return null;
	}
	const damageType = `${trailingText ?? ""}`.match(DAMAGE_TYPE_RE)?.[1]?.toLowerCase() || null;
	return {expr, damageType};
}

/** The damage a card would apply after its ½ / ×2 multiplier (rounded down, never negative). */
export const getCockpitFeedAmount = card => Math.max(0, Math.floor((card?.total || 0) * (card?.mult || 1)));

/** "13 (8 +5)" style parts for a d20 card: the kept die then every modifier with its label. */
export function getCockpitFeedD20Parts (roll) {
	return (roll?.parts || []).filter(part => part.value || part.dice).map(part => ({
		text: part.dice ? `+${part.dice}→${part.value}` : getEncounterSignedNumber(part.value),
		label: part.label,
		source: part.source || null,
	}));
}

/** Hit / miss per target for an attack card. targets: [{id, label, ac}]; a nat 20 always hits, a nat 1 always misses. */
export function getCockpitAttackVerdicts (roll, targets) {
	return targets.filter(it => Number.isFinite(it.ac)).map(it => ({
		...it,
		isHit: roll.crit || (!roll.fumble && roll.total >= it.ac),
	}));
}

/** Console line for "Stage in console": `@goblin1,@goblin2 12 fire` (no handle = the console's current target). */
export function getCockpitFeedStageText (card, handles = []) {
	const amount = getCockpitFeedAmount(card);
	return `${handles.length ? `@${handles.map(it => it.replace(/^@/, "")).join(",")} ` : ""}${amount}${card.damageType ? ` ${card.damageType}` : ""}`;
}

/** The roll log line for a card. */
export function getCockpitFeedLogText (card) {
	if (card.kind === "damage") return `${card.who} · ${card.label}: ${card.total}${card.damageType ? ` ${card.damageType}` : ""} damage (${card.expr} → ${card.rolls.join(", ") || card.total})`;
	return `${card.who} · ${card.label}: ${card.roll.text}${card.roll.mode && card.roll.mode !== "normal" ? ` (${card.roll.mode})` : ""}`;
}
