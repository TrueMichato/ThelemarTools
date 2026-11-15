/**
 * Rules wiring for the Lantern Cockpit: one place that turns the rules modules (effects, conditions, death saves,
 * battlefield, templates) into what the shell shows and into the extra steps each committed action needs.
 *
 * Every number has ONE contributor path: `getEncounterDerived` / `getEncounterContributors` always include the effects
 * and conditions providers, and `getCockpitRuleProviders()` adds the rest (battlefield, templates). Never pass the
 * effects or conditions providers in again — that would count them twice.
 */

import {getEncounterContributors, getEncounterDerived} from "../encounterworkspace-derived.js";
import {tickEncounterDurations} from "../encounterworkspace-conditions-rules.js";
import {
	getEncounterBattlefieldContributors,
	getEncounterBattlefieldDisplayName,
	getEncounterBattlefieldEntriesFor,
	getEncounterBattlefieldHover,
	withEncounterBattlefieldTick,
} from "../encounterworkspace-battlefield.js";
import {getEncounterTemplateContributors} from "../encounterworkspace-templates.js";
import {getCockpitInstanceEffectItems} from "./model.js";

const RULE_PROVIDERS = Object.freeze([getEncounterBattlefieldContributors, getEncounterTemplateContributors]);

/** Extra roll-contributor providers beyond the effects and conditions that `getEncounterDerived` always includes. */
export function getCockpitRuleProviders () {
	return [...RULE_PROVIDERS];
}

export function getCockpitRuleOptions (settings = {}) {
	return {providers: getCockpitRuleProviders(), ruleset: settings.ruleset || "phb", monsterDeathSaves: !!settings.monsterDeathSaves};
}

/** `getContributors(instance, query)` for the roll-breakdown and mass-roll modules, with every source included once. */
export function getCockpitContributorGetter (state, settings = {}) {
	const {providers, ruleset} = getCockpitRuleOptions(settings);
	return (instance, query) => getEncounterContributors(state, instance, query, providers, {ruleset});
}

const signed = n => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;

/**
 * Shell-facing derived numbers: {ac, acReasons, speedText, notes, saves, derived}. `derived` is the full
 * `getEncounterDerived` result for features that need more (dock tabs, death-save pips, concentration markers).
 */
export function getCockpitShellDerived (state, instance, settings = {}) {
	if (!instance) return {};
	const derived = getEncounterDerived(state, instance, getCockpitRuleOptions(settings));
	const out = {derived, saves: derived.saves};
	if (derived.ac.breakdown.length) {
		out.ac = derived.ac.value;
		out.acReasons = derived.ac.breakdown.map(it => `${it.label} ${signed(Number(it.value))}`);
	}
	if (derived.speed.walk !== derived.speed.base) {
		out.speedText = `${derived.speed.walk} ft. (${derived.speed.reasons.map(it => `${it.label} ${it.text}`).join(", ")})`;
	}
	const notes = [
		...derived.notes.map(it => it.label),
		derived.attacked.mode === "adv" ? `Attacks against it have advantage (${derived.attacked.advantage.map(it => it.label).join(", ")})` : null,
		derived.attacked.mode === "dis" ? `Attacks against it have disadvantage (${derived.attacked.disadvantage.map(it => it.label).join(", ")})` : null,
		derived.attack.mode === "adv" ? "Its attacks have advantage" : null,
		derived.attack.mode === "dis" ? "Its attacks have disadvantage" : null,
		derived.incapacitated.length ? `Incapacitated (${derived.incapacitated.join(", ")})` : null,
		derived.spellDcDelta ? `Spell save DC ${signed(derived.spellDcDelta)}` : null,
	].filter(Boolean);
	if (notes.length) out.notes = [...new Set(notes)];
	return out;
}

/** Rail and statblock pills: the creature's effects and templates, plus every battlefield entry that reaches it. */
export function getCockpitEffectItems (state, instance) {
	const own = getCockpitInstanceEffectItems(instance);
	const field = getEncounterBattlefieldEntriesFor(state, instance).map(entry => {
		const hover = getEncounterBattlefieldHover(state, entry);
		return {
			k: "bf",
			label: getEncounterBattlefieldDisplayName(entry),
			rounds: entry.rounds ?? null,
			id: entry.id,
			source: "battlefield",
			wide: entry.scope === "all",
			hoverEntry: {
				type: "entries",
				name: hover.title,
				entries: [hover.description, hover.note, `Applies to: ${hover.scope}`, hover.rounds != null ? `${hover.rounds} round${hover.rounds === 1 ? "" : "s"} left` : null].filter(Boolean),
			},
		};
	});
	return [...own, ...field];
}

/** Damage defenses granted by effects and conditions, for `withTypedDamage({getExtraDefenses})`. */
export function getCockpitExtraDefensesGetter (state, settings = {}) {
	return (instance, damageType) => {
		const derived = getEncounterDerived(state, instance, getCockpitRuleOptions(settings));
		return {
			immune: derived.immune.includes(damageType),
			resist: derived.resist.includes(damageType) || derived.resistAll.length > 0,
			vulnerable: derived.vulnerable.includes(damageType),
		};
	};
}

/**
 * Everything that happens because the turn moved forward, inside the same commit: timed conditions and effects
 * count down when the round wraps, and battlefield entries tick (on their caster's turn, or on the round wrap).
 * `draft` already holds the new turn; `previousTurn` is the turn before. Returns the next state.
 */
export function withCockpitTurnAdvanced (draft, {previousTurn, log}) {
	if ((draft.turn?.round || 0) > (previousTurn?.round || 0) && previousTurn?.round) tickEncounterDurations(draft, {log});
	const {state, expired} = withEncounterBattlefieldTick(draft, {previousTurn, nextTurn: draft.turn});
	expired.forEach(entry => log?.("effect", `${getEncounterBattlefieldDisplayName(entry)} ended.`));
	return state;
}
