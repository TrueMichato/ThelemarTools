/**
 * Pure helpers for the stage's statblock affordances: roll-chip kinds, effect-modified numbers, the active-effects
 * delta line, "held by" links, statblock tags, reminders and Revive. No DOM here — the stage feature and the PC card
 * render these.
 */

import {ENCOUNTER_ABILITIES} from "../encounterworkspace-fx.js";
import {removeEncounterCondition} from "../encounterworkspace-conditions-rules.js";
import {ENCOUNTER_ZERO_HP_SOURCE} from "../encounterworkspace-deathsaves.js";
import {
	getEncounterBattlefieldDisplayName,
	getEncounterBattlefieldEntriesFor,
	getEncounterBattlefieldRule,
} from "../encounterworkspace-battlefield.js";

export const COCKPIT_HINT_STORAGE_KEY = "ewc-hint-off";

/** Native-style signed number ("+3", "-1") — matches the statblock's own text. */
export const getCockpitSigned = n => `${n < 0 ? "-" : "+"}${Math.abs(n)}`;

const signedDice = value => {
	const text = `${value}`.trim();
	return /^[-−]/.test(text) ? `−${text.replace(/^[-−]\s*/, "")}` : `+${text.replace(/^\+\s*/, "")}`;
};

const MODE_WORD = {adv: "adv", dis: "dis"};

/**
 * The chip style for a statblock dice link (`entry` = parsed `data-packed-dice`):
 * "hit" | "save" | "init" (boxed), "dmg" (red-tinted), "skill" (dotted: skills and ability checks), "dice" (anything else).
 */
export function getCockpitRollChipKind (entry) {
	const type = entry?.context?.type;
	if (type === "hit") return "hit";
	if (type === "savingThrow") return "save";
	if (type === "skillCheck" || type === "abilityCheck") return "skill";
	if (type === "initiative") return "init";
	if (entry?.subType === "damage") return "dmg";
	return "dice";
}

const getLabels = list => (list || []).map(it => it.label).filter(Boolean);

/**
 * How effects change one statblock number. `base` is the statblock's own bonus; `summary` a
 * `summarizeEncounterContributors` result (derived.attack or derived.saves[ab]).
 * Returns {text, isChanged, title, marks: [{cls, text, title}]} — `text` is the modified bonus.
 */
export function getCockpitRollChange ({base, summary, label = "roll"}) {
	const flat = Number(summary?.flat) || 0;
	const value = base + flat;
	const marks = [];
	const autoFail = getLabels(summary?.autoFail);
	if (autoFail.length) marks.push({cls: "is-fail", text: "✗ auto", title: `Automatically fails (${autoFail.join(", ")})`});
	if (MODE_WORD[summary?.mode]) {
		const from = getLabels(summary.mode === "adv" ? summary.advantage : summary.disadvantage);
		marks.push({cls: `is-${summary.mode}`, text: MODE_WORD[summary.mode], title: `${summary.mode === "adv" ? "Advantage" : "Disadvantage"}${from.length ? ` (${from.join(", ")})` : ""}`});
	}
	(summary?.dice || []).forEach(dice => marks.push({cls: "is-plus", text: signedDice(dice), title: `${signedDice(dice)} to the roll`}));
	const isChanged = flat !== 0 || marks.length > 0;
	if (!isChanged) return {text: getCockpitSigned(base), isChanged, title: null, marks};
	const reasons = (summary?.bonuses || []).map(it => `${it.label} ${typeof it.value === "number" ? getCockpitSigned(it.value) : signedDice(it.value)}`);
	const extra = [...reasons, ...marks.filter(it => it.cls !== "is-plus").map(it => it.title)];
	return {
		text: getCockpitSigned(value),
		isChanged,
		title: `Roll ${label} — base ${getCockpitSigned(base)} → ${getCockpitSigned(value)}${(summary?.dice || []).map(it => ` ${signedDice(it)}`).join("")}${extra.length ? ` (${extra.join("; ")})` : ""}`,
		marks,
	};
}

const ABILITY_WORD = "strength|dexterity|constitution|intelligence|wisdom|charisma";

/**
 * "wis" for the save a "DC 15" asks for: the ability named just after it ("DC 15 Wisdom saving throw") or, in 2024
 * statblocks, just before it ("Wisdom Saving Throw: DC 15"). Null when none is named nearby.
 */
export function getCockpitDcAbility (trailingText, leadingText = "") {
	const name = `${trailingText ?? ""}`.slice(0, 40).match(new RegExp(`^[^.;]*?\\b(${ABILITY_WORD})\\b`, "i"))?.[1]
		|| `${leadingText ?? ""}`.slice(-48).match(new RegExp(`\\b(${ABILITY_WORD})\\s+saving\\s+throw\\s*:?\\s*(?:DC\\s*)?$`, "i"))?.[1];
	return name ? name.slice(0, 3).toLowerCase() : null;
}

/** True when the text before a DC makes it a spell save DC (so spell-DC changes apply). */
export function getCockpitIsSpellDc (leadingText) {
	return /spell\s+save(?:\s+DC)?(?:\s+is)?(?:\s+DC)?$/i.test(`${leadingText ?? ""}`.trim());
}

/**
 * The active-effects delta line for a creature from its `getEncounterDerived` result:
 * [{text, from?, to?}] — e.g. {text: "AC", from: "15", to: "17"}, {text: "attacks +1d4"}, {text: "STR save ✗ auto"}.
 */
export function getCockpitStageDeltas (derived) {
	if (!derived) return [];
	const out = [];
	if (derived.ac && derived.ac.value !== derived.ac.base) out.push({text: "AC", from: `${derived.ac.base}`, to: `${derived.ac.value}`});
	if (derived.speed && derived.speed.walk !== derived.speed.base) out.push({text: "Speed", from: `${derived.speed.base}`, to: `${derived.speed.walk} ft.`});
	const attack = derived.attack;
	if (attack) {
		if (attack.flat) out.push({text: `attacks ${getCockpitSigned(attack.flat)}`});
		if (attack.dice?.length) out.push({text: `attacks ${attack.dice.map(signedDice).join(" ")}`});
		if (MODE_WORD[attack.mode]) out.push({text: `attacks ${MODE_WORD[attack.mode]}`});
	}
	if (MODE_WORD[derived.attacked?.mode]) out.push({text: `attacks against it ${MODE_WORD[derived.attacked.mode]}`});
	if (MODE_WORD[derived.check?.mode]) out.push({text: `ability checks ${MODE_WORD[derived.check.mode]}`});
	const saves = ENCOUNTER_ABILITIES.map(ab => {
		const save = derived.saves?.[ab];
		if (!save) return null;
		if (save.autoFail?.length) return "✗ auto";
		return [save.flat ? getCockpitSigned(save.flat) : "", ...(save.dice || []).map(signedDice), MODE_WORD[save.mode] || ""].filter(Boolean).join(" ") || null;
	});
	// Bless, Bane and the like touch every save alike: one "all saves" entry instead of six.
	if (saves[0] && saves.every(it => it === saves[0])) out.push({text: `all saves ${saves[0]}`});
	else saves.forEach((it, ix) => { if (it) out.push({text: `${ENCOUNTER_ABILITIES[ix].toUpperCase()} save ${it}`}); });
	if (derived.spellDcDelta) out.push({text: `spell save DC ${getCockpitSigned(derived.spellDcDelta)}`});
	return out;
}

/** Plain-text form of the delta line (titles, logs, tests). */
export function getCockpitStageDeltaText (deltas) {
	return deltas.map(it => it.from != null ? `${it.text} ${it.from} → ${it.to}` : it.text).join(" · ");
}

/** Effects on a creature held up by someone else's concentration: [{effectId, casterId, label}]. */
export function getCockpitHeldBy (instance) {
	return (instance?.effects || [])
		.filter(fx => fx.casterId && fx.concOn && fx.casterId !== instance.id)
		.map(fx => ({effectId: fx.id, casterId: fx.casterId, label: fx.concOn || fx.name}));
}

/**
 * Tags shown next to the statblock name: templates (⟳), items (✦), transformations and other edits (✎).
 * Returns [{kind: "tpl"|"item"|"transformed"|"edited", text, title}].
 */
export function getCockpitStatblockTags (instance) {
	const out = [];
	const ops = instance?.statblockOperations || [];
	const templateOpIds = new Set((instance?.templates || []).flatMap(it => it.operationIds || []));
	(instance?.templates || []).forEach(tpl => out.push({kind: "tpl", text: `⟳ ${tpl.name}`, title: `Template: ${tpl.name}`}));
	ops.forEach(op => {
		if (op.type === "applyItem" && op.data?.item?.name) out.push({kind: "item", text: `✦ ${op.data.item.name}`, title: `Item applied: ${op.data.item.name}`});
		else if (op.type === "applyCreatureTransformation") {
			const name = op.data?.resolved?.identity?.name;
			out.push({kind: "transformed", text: "⟳ transformed", title: name ? `Transformed: ${name}` : "Transformed"});
		}
	});
	const edits = ops.filter(op => !templateOpIds.has(op.id) && op.type !== "applyItem" && op.type !== "applyCreatureTransformation");
	if (edits.length) out.push({kind: "edited", text: "✎ edited", title: `${edits.length} statblock edit${edits.length === 1 ? "" : "s"}`});
	return out;
}

/** Lair and reminder entries on the battlefield that reach this creature: [{id, name, note}]. */
export function getCockpitReminders (state, instance) {
	if (!state || !instance) return [];
	return getEncounterBattlefieldEntriesFor(state, instance)
		.filter(entry => ["lair", "reminder"].includes(getEncounterBattlefieldRule(entry.rule)?.category))
		.map(entry => ({id: entry.id, name: getEncounterBattlefieldDisplayName(entry), note: `${entry.note || ""}`.trim(), rounds: entry.rounds ?? null}));
}

/**
 * Brings a defeated creature back into the fight: not defeated, no death saves, at least 1 HP, and the "0 HP"
 * Unconscious removed (Prone stays — standing up costs movement). Returns true when anything changed.
 */
export function withCockpitRevived (draft, id, {log = () => {}, name = null} = {}) {
	const instance = draft.instances.find(it => it.id === id);
	if (!instance) throw new Error("That creature is no longer in the encounter.");
	if (!instance.defeated && !instance.deathSaves && instance.hp.current > 0) return false;
	instance.defeated = false;
	instance.deathSaves = null;
	if (!(instance.hp.current > 0)) instance.hp = {...instance.hp, current: Math.min(1, instance.hp.max)};
	if (instance.conditionDetails?.unconscious?.source === ENCOUNTER_ZERO_HP_SOURCE) removeEncounterCondition(draft, {targetIds: [id], condition: "unconscious"});
	log("heal", `${name || instance.label || instance.monster?.name || "The creature"} is back in the fight.`, {target: id});
	return true;
}
