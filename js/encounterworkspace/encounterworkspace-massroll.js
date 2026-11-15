import {EncounterWorkspaceState, getEncounterSharedGroup} from "./encounterworkspace-state.js";
import {getEncounterInstanceLabels} from "./encounterworkspace-roll.js";
import {
	ENCOUNTER_ABILITIES,
	getEncounterNormalizedSkill,
	getEncounterRollBreakdown,
	rollEncounterDice,
} from "./encounterworkspace-rollbreakdown.js";

/**
 * Rolls many creatures at once (saves, checks, initiative) and applies the outcomes through the state reducers,
 * so typed damage always goes through `getEncounterDamageForMonster` (resist / immune / vulnerable).
 */

export function getEncounterDisplayLabels (state) {
	const labels = getEncounterInstanceLabels(state.instances);
	return new Map(state.instances.map(it => [it.id, it.label || labels.get(it.id)]));
}

function getTargets (state, ids, {includeDefeated = false} = {}) {
	if (!Array.isArray(ids) || !ids.length) throw new Error("Select at least one creature.");
	const byId = new Map(state.instances.map(it => [it.id, it]));
	const seen = new Set();
	const targets = [];
	const skipped = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		const instance = byId.get(id);
		if (!instance) skipped.push({id, reason: "missing"});
		else if (instance.defeated && !includeDefeated) skipped.push({id, reason: "defeated"});
		else targets.push(instance);
	}
	return {targets, skipped};
}

function rollMany ({state, ids, query, rng, forcedMode, forcedLabel, getContributors, includeDefeated}) {
	const {targets, skipped} = getTargets(state, ids, {includeDefeated});
	const labels = getEncounterDisplayLabels(state);
	const results = targets.map(instance => {
		const roll = getEncounterRollBreakdown({instance, query, rng, forcedMode, forcedLabel, getContributors});
		return {id: instance.id, label: labels.get(instance.id), roll, total: roll.total, success: roll.success};
	});
	return {query, dc: query.dc ?? null, results, skipped};
}

/**
 * Rolls a saving throw for every target (defeated creatures are skipped).
 * @returns {{query, dc, results: Array<{id, label, roll, total, success}>, skipped: Array<{id, reason}>}}
 */
export function rollEncounterSaves ({state, ids = state.selectedIds, ability, dc = null, rng = Math.random, forcedMode = null, forcedLabel, getContributors = null, includeDefeated = false}) {
	if (!ENCOUNTER_ABILITIES.includes(ability)) throw new Error("Which save? str, dex, con, int, wis or cha.");
	if (dc != null && (!Number.isSafeInteger(dc) || dc < 0)) throw new Error("The save DC must be a whole number.");
	return rollMany({state, ids, query: {kind: "save", ability, dc}, rng, forcedMode, forcedLabel, getContributors, includeDefeated});
}

/** Rolls a skill check (`skill`) or a raw ability check (`ability`) for every target. */
export function rollEncounterChecks ({state, ids = state.selectedIds, skill = null, ability = null, dc = null, rng = Math.random, forcedMode = null, forcedLabel, getContributors = null, includeDefeated = false}) {
	const normalized = skill == null ? null : getEncounterNormalizedSkill(skill);
	if (skill != null && !normalized) throw new Error(`Unknown skill: ${skill}.`);
	if (!normalized && !ENCOUNTER_ABILITIES.includes(ability)) throw new Error("Choose a skill or an ability for the check.");
	if (dc != null && (!Number.isSafeInteger(dc) || dc < 0)) throw new Error("The check DC must be a whole number.");
	const query = normalized ? {kind: "check", skill: normalized, dc} : {kind: "check", ability, dc};
	return rollMany({state, ids, query, rng, forcedMode, forcedLabel, getContributors, includeDefeated});
}

const getResults = rolled => Array.isArray(rolled) ? rolled : rolled?.results || [];

/** Ids that failed against the DC ("select those who failed"). */
export const getEncounterFailedIds = rolled => getResults(rolled).filter(it => it.success === false).map(it => it.id);
export const getEncounterPassedIds = rolled => getResults(rolled).filter(it => it.success === true).map(it => it.id);

/** Sorts results best-first, breaking ties by the higher modifier. */
export const getEncounterSortedRollResults = rolled => [...getResults(rolled)].sort((a, b) => b.total - a.total || b.roll.modifier - a.roll.modifier);

export function getEncounterRolledAmount (amount, rng = Math.random) {
	if (Number.isSafeInteger(amount)) {
		if (amount < 0) throw new Error("Damage must not be negative.");
		return {amount, roll: null};
	}
	const roll = rollEncounterDice(amount, rng);
	return {amount: Math.max(0, roll.total), roll};
}

function getUntypedResults (before, after, ids) {
	const prior = new Map(before.instances.map(it => [it.id, it.hp]));
	return after.instances.filter(it => ids.includes(it.id)).map(it => ({
		id: it.id,
		damage: (prior.get(it.id).current ?? 0) + (prior.get(it.id).temp ?? 0) - (it.hp.current ?? 0) - (it.hp.temp ?? 0),
		defenses: {immune: false, resist: false, vulnerable: false},
		before: {...prior.get(it.id)},
		after: {...it.hp},
	}));
}

/**
 * Applies the same damage to every target. Typed damage uses resist / immune / vulnerability; untyped damage does not.
 * Conditional defenses that need a ruling throw with `error.unresolved` (pass `decisions[id][key] = bool` to retry).
 */
export function applyEncounterDamage (state, {ids = state.selectedIds, amount, damageType = null, source = "unspecified", decisions = {}}) {
	if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Enter a non-negative whole-number damage amount.");
	if (damageType) {
		const out = EncounterWorkspaceState.withTypedDamage(state, {amount, damageType, source, decisions, targetIds: ids});
		return {state: out.state, results: out.results, snapshots: out.snapshots, skippedIds: out.skippedIds};
	}
	const out = EncounterWorkspaceState.withHpOperation(state, {operation: {mode: "delta", value: -amount}, targetIds: ids});
	return {state: out.state, results: getUntypedResults(state, out.state, out.changedIds), snapshots: out.snapshots, skippedIds: out.skippedIds};
}

const getIsMinion = instance => (instance.templates || []).some(it => it.key === "minion");

/**
 * Applies a mass save's outcome: failures take full damage and gain `conditionOnFail`; successes take half
 * (rounded down) when `halfOnSuccess`, otherwise nothing. Minions take no damage on a success (Flee, Mortals!).
 * @returns {{state, damage: Array, snapshots: Array, conditionIds: string[], previousState}}
 */
export function applyEncounterSaveOutcome (state, rolled, {amount = 0, damageType = null, halfOnSuccess = false, conditionOnFail = null, rounds = null, source = "unspecified", decisions = {}} = {}) {
	const results = getResults(rolled);
	if (results.some(it => it.success == null)) throw new Error("Set a save DC before applying outcomes.");
	if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Enter a non-negative whole-number damage amount.");
	if (rounds != null && (!Number.isSafeInteger(rounds) || rounds < 0)) throw new Error("Condition rounds must be a whole number.");
	const live = new Set(state.instances.map(it => it.id));
	const failedIds = getEncounterFailedIds(results).filter(id => live.has(id));
	const passedIds = getEncounterPassedIds(results).filter(id => live.has(id));
	const byId = new Map(state.instances.map(it => [it.id, it]));
	const halfIds = halfOnSuccess ? passedIds.filter(id => !getIsMinion(byId.get(id))) : [];
	const batches = [[failedIds, amount], [halfIds, Math.floor(amount / 2)]].filter(([ids, value]) => ids.length && value > 0);

	let next = state;
	const damage = [];
	const snapshots = [];
	for (const [ids, value] of batches) {
		const out = applyEncounterDamage(next, {ids, amount: value, damageType, source, decisions});
		next = out.state;
		damage.push(...out.results);
		snapshots.push(...out.snapshots);
	}

	let conditionIds = [];
	if (conditionOnFail && failedIds.length) {
		next = EncounterWorkspaceState.withConditions(next, {condition: conditionOnFail, isAdd: true, targetIds: failedIds});
		const key = `${conditionOnFail}`.trim().toLowerCase();
		const failed = new Set(failedIds);
		next = EncounterWorkspaceState.validate({
			...next,
			instances: next.instances.map(it => failed.has(it.id)
				? {...it, conditionDetails: {...it.conditionDetails, [key]: {rounds}}}
				: it),
		});
		conditionIds = failedIds;
	}
	return {state: next, damage, snapshots, conditionIds, previousState: state};
}

/**
 * Rolls initiative for each target; members of a shared-turn group roll once for the group.
 * @returns {{results: Array<{id, memberIds, label, roll, total}>, skipped}}
 */
export function rollEncounterInitiatives ({state, ids = state.instances.map(it => it.id), rng = Math.random, forcedMode = null, forcedLabel, getContributors = null, includeDefeated = false}) {
	const {targets, skipped} = getTargets(state, ids, {includeDefeated});
	const labels = getEncounterDisplayLabels(state);
	const seenGroups = new Set();
	const results = [];
	for (const instance of targets) {
		const shared = getEncounterSharedGroup(state, instance.id);
		if (shared && seenGroups.has(shared.id)) continue;
		if (shared) seenGroups.add(shared.id);
		const roll = getEncounterRollBreakdown({instance, query: {kind: "initiative"}, rng, forcedMode, forcedLabel, getContributors});
		results.push({
			id: shared?.id || instance.id,
			memberIds: shared ? [...shared.memberIds] : [instance.id],
			label: shared ? `${labels.get(instance.id).replace(/ #\d+$/, "")} (group)` : labels.get(instance.id),
			roll,
			total: roll.total,
		});
	}
	return {results, skipped};
}

/** Stores rolled (or typed) initiative totals; shared groups are written once. */
export function withEncounterInitiativeRolls (state, rolled) {
	return EncounterWorkspaceState.withInitiativeResults(state, getResults(rolled).map(it => ({id: it.id, total: it.total})));
}
