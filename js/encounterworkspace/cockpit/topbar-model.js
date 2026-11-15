/**
 * Pure logic behind the cockpit top bar and ⋯ menu: the difficulty badge (rated with the Encounter Builder's own
 * party budgets), recharge rolls at the start of a turn, and which creatures "Re-roll foe initiative" touches.
 */

import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../encounterworkspace-state.js";
import {getEncounterMonsterXp} from "../encounterworkspace-assessment.js";
import {getEncounterIsDefeated} from "../encounterworkspace-party.js";
import {EncounterPartyMetaClassic} from "../../encounterbuilder/partymeta/encounter-partymeta-classic.js";
import {EncounterPartyMetaOne} from "../../encounterbuilder/partymeta/encounter-partymeta-one.js";
import {EncounterPartyPlayerMeta} from "../../encounterbuilder/encounterbuilder-models-other.js";

/* ----- Difficulty ----- */

const TIER_CLASSES = {
	trivial: "is-easy",
	easy: "is-easy",
	low: "is-easy",
	medium: "is-medium",
	moderate: "is-medium",
	hard: "is-hard",
	high: "is-hard",
	deadly: "is-deadly",
	absurd: "is-deadly",
};

/** The 2024 rules ("xphb") rate with the 2024 DMG budgets; PHB 2014 and Thelemar use the 2014 DMG's. */
export const getCockpitDifficultyEdition = ruleset => ruleset === "xphb" ? "one" : "classic";

const isFoe = instance => instance.kind !== "party";

/**
 * Party levels for the difficulty rating. Members linked to a saved character use its level (`levelsByCharacterId`);
 * the others are assumed to be at the average of the known levels. With no known level there is no rating.
 * Returns {levels: number[], assumedCount, unknownCount}.
 */
export function getCockpitPartyLevels (state, levelsByCharacterId = new Map()) {
	const party = state.instances.filter(it => it.kind === "party");
	const known = party.map(it => levelsByCharacterId.get(it.party?.characterId)).filter(Number.isInteger);
	if (!known.length) return {levels: [], assumedCount: 0, unknownCount: party.length};
	const assumed = Math.max(1, Math.min(20, Math.round(known.reduce((a, b) => a + b, 0) / known.length)));
	return {levels: [...known, ...Array(party.length - known.length).fill(assumed)], assumedCount: party.length - known.length, unknownCount: 0};
}

/**
 * Everything the badge and its popover show. The rating covers the foes still in the fight; Total XP is everyone
 * the encounter started with, Earned the defeated ones.
 */
export function getCockpitDifficulty (state, {ruleset = "phb", levelsByCharacterId = new Map(), labels = null} = {}) {
	const foes = state.instances.filter(isFoe);
	const party = state.instances.filter(it => it.kind === "party");
	const label = it => labels?.get(it.id) || it.label || getEncounterEffectiveMonster(it).name;
	const rows = foes.map(instance => {
		const monster = getEncounterEffectiveMonster(instance);
		const xp = getEncounterMonsterXp(monster);
		return {id: instance.id, label: label(instance), xp, cr: xp == null ? null : Parser.crToNumber(monster.cr, {isDefaultNull: true}), isDefeated: getEncounterIsDefeated(instance)};
	});
	const sum = list => list.reduce((total, it) => total + (it.xp ?? 0), 0);
	const remaining = rows.filter(it => !it.isDefeated);
	const defeated = rows.filter(it => it.isDefeated).map(({id, label, xp}) => ({id, label, xp: xp ?? 0}));
	const totalXp = sum(rows);
	const out = {
		tier: null,
		word: null,
		cls: null,
		edition: getCockpitDifficultyEdition(ruleset),
		remainingXp: sum(remaining),
		adjustedXp: null,
		totalXp,
		earnedXp: sum(defeated),
		unratedCount: rows.filter(it => it.xp == null).length,
		foeCount: foes.length,
		remainingCount: remaining.length,
		partyCount: party.length,
		assumedLevelCount: 0,
		perMember: party.length ? Math.floor(totalXp / party.length) : 0,
		defeated,
		reason: null,
	};
	const {levels, assumedCount} = getCockpitPartyLevels(state, levelsByCharacterId);
	out.assumedLevelCount = assumedCount;
	if (!party.length) return {...out, reason: "no-party"};
	if (!levels.length) return {...out, reason: "no-levels"};
	const rated = remaining.filter(it => it.cr != null);
	if (!rated.length) return {...out, reason: remaining.length ? "unrated" : "no-foes"};

	const Meta = out.edition === "one" ? EncounterPartyMetaOne : EncounterPartyMetaClassic;
	const meta = new Meta(levels.map(level => new EncounterPartyPlayerMeta({level, count: 1})));
	const spend = meta.getEncounterSpendInfo(rated.map(it => ({getCrNumber: () => it.cr, getCount: () => 1, getXp: () => it.xp})));
	const tier = meta.getEncounterTier(spend);
	if (!TIER_CLASSES[tier]) return {...out, reason: "unrated"};
	return {...out, tier, word: tier.toTitleCase(), cls: TIER_CLASSES[tier], adjustedXp: spend.adjustedSpend};
}

/** Accessible name for the badge, e.g. "Difficulty Deadly, 2,900 XP; 450 XP earned so far". */
export function getCockpitDifficultyAriaLabel (diff) {
	const xp = `${diff.remainingXp.toLocaleString()} XP`;
	return `${diff.word ? `Difficulty ${diff.word}, ` : "Encounter XP: "}${xp}; ${diff.earnedXp.toLocaleString()} XP earned so far`;
}

/* ----- Recharge at the start of a turn ----- */

/** The spent recharge abilities of whoever's turn it is (every member of a shared-turn group): [{id, recharge}]. */
export function getCockpitTurnRecharges (state) {
	const activeId = state.turn?.activeId;
	if (!state.turn?.round || !activeId) return [];
	const group = state.groups.find(it => it.sharedTurn && (it.id === activeId || it.memberIds.includes(activeId)));
	const memberIds = group ? group.memberIds : [activeId];
	return memberIds.flatMap(id => {
		const instance = state.instances.find(it => it.id === id);
		if (!instance || getEncounterIsDefeated(instance)) return [];
		return (instance.resources?.recharges || []).filter(it => !it.ready).map(recharge => ({id, recharge}));
	});
}

/**
 * Apply recharge d6 results ([{id, rechargeId, roll}]) — a roll at or above the ability's minimum makes it ready —
 * and log one line per creature. Returns {state, readyCount}.
 */
export function withCockpitRechargeRolls (state, rolls, {labels = null, log = null} = {}) {
	let next = state;
	let readyCount = 0;
	const lines = new Map();
	for (const {id, rechargeId, roll} of rolls) {
		const instance = next.instances.find(it => it.id === id);
		const recharge = instance?.resources?.recharges.find(it => it.id === rechargeId);
		if (!recharge || recharge.ready || !Number.isInteger(roll) || roll < 1 || roll > 6) continue;
		const isReady = roll >= recharge.min;
		if (isReady) {
			next = EncounterWorkspaceState.withRechargeReady(next, {id, rechargeId, ready: true});
			readyCount++;
		}
		const name = labels?.get(id) || getEncounterEffectiveMonster(instance).name;
		if (!lines.has(id)) lines.set(id, {name, parts: []});
		lines.get(id).parts.push(`${recharge.name} ${isReady ? "recharged" : "still spent"} (rolled ${roll}, needs ${recharge.min}+)`);
	}
	lines.forEach(({name, parts}) => log?.("resource", `${name}: ${parts.join("; ")}.`));
	return {state: next, readyCount};
}

/* ----- Re-roll foe initiative ----- */

/** Every foe still in the fight (party members roll their own). */
export const getCockpitFoeIds = state => state.instances.filter(it => isFoe(it) && !getEncounterIsDefeated(it)).map(it => it.id);

export const COCKPIT_ROLL_MODES = [
	{id: "normal", label: "Normal", title: "Re-roll foe initiative"},
	{id: "advantage", label: "Adv", title: "Re-roll foe initiative with advantage"},
	{id: "disadvantage", label: "Dis", title: "Re-roll foe initiative with disadvantage"},
];

export const getCockpitRerollToast = rollMode => `Foe initiative re-rolled${rollMode === "normal" ? "" : ` with ${rollMode}`}.`;
