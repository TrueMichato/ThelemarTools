import {applyEncounterCondition, removeEncounterCondition} from "./encounterworkspace-conditions-rules.js";
import {endEncounterConcentration, getEncounterConcentration} from "./encounterworkspace-fx.js";

/*
 * Death saving throws for the encounter cockpit — pure draft reducers, no DOM.
 *
 * `instance.deathSaves` is null (not dying) or {successes 0–3, failures 0–3, stable, dead}.
 * Who rolls them: party members by default; monsters only when `monsterDeathSaves` (an encounter setting passed in by
 * the caller) is on, or per creature via `instance.deathSaveMode` ("on" / "off" overrides; "default" follows the rule).
 * HP itself is changed by the engine's damage/heal reducers; call `applyEncounterDeathSaveDamage` after damage and
 * `applyEncounterHealing` instead of a plain heal so the dying state stays consistent.
 */

const noopLog = () => {};
const getName = instance => instance.label || instance.monster?.name || instance.id;
export const ENCOUNTER_ZERO_HP_SOURCE = "0 HP";

function getInstance (draft, id) {
	const instance = draft.instances.find(it => it.id === id);
	if (!instance) throw new Error("This encounter creature no longer exists.");
	return instance;
}

const emptySaves = () => ({successes: 0, failures: 0, stable: false, dead: false});

/** Whether a creature makes death saves instead of dropping dead at 0 HP. */
export function getEncounterUsesDeathSaves (instance, {monsterDeathSaves = false} = {}) {
	if (instance?.deathSaveMode === "on") return true;
	if (instance?.deathSaveMode === "off") return false;
	return instance?.kind === "party" || !!monsterDeathSaves;
}

/** "dying" | "stable" | "dead" | null — for badges and row styling. */
export function getEncounterDeathSaveStatus (instance) {
	const ds = instance?.deathSaves;
	if (!ds) return null;
	if (ds.dead) return "dead";
	if (ds.stable) return "stable";
	return "dying";
}

function removeZeroHpUnconscious (draft, instance) {
	if (instance.conditionDetails?.unconscious?.source !== ENCOUNTER_ZERO_HP_SOURCE) return;
	removeEncounterCondition(draft, {targetIds: [instance.id], condition: "unconscious"});
}

/**
 * Applies the dying rules after `damage` has already been subtracted from HP (engine damage reducer first).
 * `hpBefore` is current HP before the hit; `damage` is the damage left after temp HP (it may exceed `hpBefore` —
 * the overflow is what counts towards massive damage).
 * - Dropping to 0 ends concentration. With death saves: massive damage (leftover ≥ max HP) kills outright, else the
 *   creature starts dying (Unconscious + Prone, source "0 HP"). Without death saves it is defeated.
 * - Damage while already at 0 adds a failure (two on a critical hit) and ends stability; three failures kill.
 * Returns {outcome: "down" | "dead" | "defeated" | "failure" | null, deathSaves}.
 */
export function applyEncounterDeathSaveDamage (draft, {id, damage, hpBefore, isCrit = false, monsterDeathSaves = false, ruleset = "phb", log = noopLog} = {}) {
	const instance = getInstance(draft, id);
	const dealt = Math.max(0, Math.floor(Number(damage) || 0));
	if (!dealt || instance.hp.current > 0) return {outcome: null, deathSaves: instance.deathSaves};
	const usesSaves = getEncounterUsesDeathSaves(instance, {monsterDeathSaves});

	if (hpBefore > 0) {
		if (getEncounterConcentration(instance)) endEncounterConcentration(draft, id, {reason: "dropped to 0 HP", log});
		if (!usesSaves) {
			instance.defeated = true;
			log("damage", `${getName(instance)} is defeated.`, {target: id});
			return {outcome: "defeated", deathSaves: instance.deathSaves};
		}
		if (dealt - hpBefore >= instance.hp.max) {
			instance.deathSaves = {successes: 0, failures: 3, stable: false, dead: true};
			instance.defeated = true;
			log("damage", `${getName(instance)} is killed outright by massive damage.`, {target: id});
			return {outcome: "dead", deathSaves: {...instance.deathSaves}};
		}
		instance.deathSaves = emptySaves();
		instance.defeated = false;
		applyEncounterCondition(draft, {targetIds: [id], condition: "unconscious", source: ENCOUNTER_ZERO_HP_SOURCE, ruleset});
		log("damage", `${getName(instance)} drops to 0 HP and is dying.`, {target: id});
		return {outcome: "down", deathSaves: {...instance.deathSaves}};
	}

	if (!usesSaves || !instance.deathSaves || instance.deathSaves.dead) return {outcome: null, deathSaves: instance.deathSaves};
	const ds = instance.deathSaves;
	const count = isCrit ? 2 : 1;
	ds.failures = Math.min(3, ds.failures + count);
	ds.stable = false;
	if (ds.failures >= 3) {
		ds.dead = true;
		instance.defeated = true;
	}
	log("save", `${getName(instance)} takes damage at 0 HP: ${count} death-save failure${count > 1 ? "s" : ""}${ds.dead ? " — dies" : ""}.`, {target: id});
	return {outcome: ds.dead ? "dead" : "failure", deathSaves: {...ds}};
}

/** One death saving throw from a d20 result: nat 20 → 1 HP and conscious; nat 1 → two failures; 10+ succeeds. */
export function rollEncounterDeathSave (draft, {id, d20, log = noopLog} = {}) {
	const instance = getInstance(draft, id);
	const n = Math.round(Number(d20));
	if (!Number.isSafeInteger(n) || n < 1 || n > 20) throw new Error("A death save needs a d20 result from 1 to 20.");
	const ds = instance.deathSaves;
	if (!ds || ds.dead || ds.stable) return null;
	let text;
	if (n === 20) {
		instance.hp = {...instance.hp, current: 1};
		instance.deathSaves = null;
		instance.defeated = false;
		removeZeroHpUnconscious(draft, instance);
		text = "nat 20 — regains 1 HP and is conscious";
	} else {
		if (n === 1) {
			ds.failures = Math.min(3, ds.failures + 2);
			text = "nat 1 — two failures";
		} else if (n >= 10) {
			ds.successes = Math.min(3, ds.successes + 1);
			text = "success";
		} else {
			ds.failures = Math.min(3, ds.failures + 1);
			text = "failure";
		}
		if (ds.failures >= 3) {
			ds.dead = true;
			instance.defeated = true;
			text += " — dies";
		} else if (ds.successes >= 3) {
			ds.stable = true;
			text += " — stable";
		}
	}
	log("save", `${getName(instance)} death save: ${n} (${text}).`, {target: id, deathSave: {n, text}});
	return {n, text, deathSaves: instance.deathSaves && {...instance.deathSaves}};
}

/**
 * Sets successes or failures to `count` (0–3) without rolling — the clickable pips. 3 failures → dead (defeated);
 * 3 successes → stable; clearing back below 3 failures revives a creature that is still at 0 HP and dying.
 */
export function markEncounterDeathSave (draft, {id, kind, count, monsterDeathSaves = false, log = noopLog} = {}) {
	const instance = getInstance(draft, id);
	if (!getEncounterUsesDeathSaves(instance, {monsterDeathSaves})) throw new Error(`${getName(instance)} doesn't make death saves.`);
	const key = kind === "s" || kind === "successes" ? "successes" : kind === "f" || kind === "failures" ? "failures" : null;
	if (!key) throw new Error("Choose successes or failures.");
	const n = Math.max(0, Math.min(3, Math.round(Number(count) || 0)));
	const ds = instance.deathSaves = {...emptySaves(), ...instance.deathSaves};
	ds[key] = n;
	ds.dead = ds.failures >= 3;
	ds.stable = !ds.dead && ds.successes >= 3;
	if (ds.dead) instance.defeated = true;
	else if (instance.hp.current === 0) instance.defeated = false;
	log("save", `${getName(instance)} death saves marked: ${ds.successes}✓ ${ds.failures}✗${ds.dead ? " — dead" : ds.stable ? " — stable" : ""}.`, {target: id});
	return {...ds};
}

/** The count a pip click sets: clicking the highest filled pip clears it, any other pip fills up to it. */
export function getEncounterDeathSavePipCount (current, index) {
	return current === index + 1 ? index : index + 1;
}

/**
 * Heals a creature (capped at max HP). A dead creature can't be healed this way. Healing above 0 HP ends dying:
 * death saves are cleared, the creature is back in the fight and the "0 HP" Unconscious is removed (Prone stays).
 * Returns {healed, hp}.
 */
export function applyEncounterHealing (draft, {id, amount, log = noopLog} = {}) {
	const instance = getInstance(draft, id);
	const n = Math.max(0, Math.floor(Number(amount) || 0));
	if (instance.deathSaves?.dead || !n) return {healed: 0, hp: instance.hp.current};
	const before = instance.hp.current;
	instance.hp = {...instance.hp, current: Math.min(instance.hp.max, before + n)};
	if (instance.hp.current > 0) {
		instance.defeated = false;
		if (instance.deathSaves) instance.deathSaves = null;
		removeZeroHpUnconscious(draft, instance);
	}
	const healed = instance.hp.current - before;
	log("heal", `${getName(instance)} +${healed} HP.`, {target: id});
	return {healed, hp: instance.hp.current};
}

/** Stabilizes a dying creature (Spare the Dying, a Medicine check): stops death saves without restoring HP. */
export function stabilizeEncounterCreature (draft, {id, log = noopLog} = {}) {
	const instance = getInstance(draft, id);
	if (!instance.deathSaves || instance.deathSaves.dead) return null;
	instance.deathSaves = {...instance.deathSaves, stable: true};
	log("save", `${getName(instance)} is stable.`, {target: id});
	return {...instance.deathSaves};
}
