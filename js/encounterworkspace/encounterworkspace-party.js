import {
	ENCOUNTER_PARTY_HASH_PREFIX,
	EncounterWorkspaceState,
	getEncounterEffectiveMonster,
	getEncounterInstanceV8Defaults,
	getEncounterPartyMonster,
} from "./encounterworkspace-state.js";
import {getEncounterResourceDefaults} from "./encounterworkspace-resources.js";
import {getEncounterMonsterXp} from "./encounterworkspace-assessment.js";
import {getEncounterAbilityMod} from "./encounterworkspace-rollbreakdown.js";

/**
 * Party members, the combat summary / XP award, and "Apply CR".
 * Party members are instances with a `party:` hash, a monster-shaped snapshot from `getEncounterPartyMonster`, and
 * `instance.party = {characterId, ac, passive, speed, initBonus}`. Saved Character Sheet records are raw
 * `CharacterSheetState#toJson()` data; stats are read from them the same way the DM Screen party importer does.
 */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const toInt = (value, fallback) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;

const getSlug = name => `${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";

/** Ability scores as the sheet totals them: base + racial + feature + direct + item bonus, raised by any "set to" scores. */
export function getEncounterCharacterAbilities (character) {
	return Object.fromEntries(ABILITIES.map(ability => {
		let score = toInt(character?.abilities?.[ability], 10)
			+ toInt(character?.abilityBonuses?.[ability], 0)
			+ toInt(character?.customModifiers?.abilityScores?.[ability], 0)
			+ toInt(character?.directAbilityBonuses?.[ability], 0)
			+ toInt(character?.itemAbilityOverrides?.bonus?.[ability], 0);
		for (const fixed of [character?.itemAbilityOverrides?.static?.[ability], character?.customModifiers?.abilityScoreStatic?.[ability]]) {
			if (Number.isFinite(fixed) && fixed > score) score = fixed;
		}
		return [ability, Math.max(1, Math.min(30, score))];
	}));
}

export function getEncounterCharacterLevel (character) {
	const level = (character?.classes || []).reduce((sum, it) => sum + toInt(it?.level, 0), 0);
	return Math.max(1, Math.min(20, level || 1));
}

function getArmorClass (character, dexMod) {
	const ac = character?.ac;
	if (Number.isFinite(ac)) return Math.trunc(ac);
	if (!ac || typeof ac !== "object") return 10 + dexMod;
	let total;
	if (ac.armor) {
		const armorAc = toInt(ac.armor.ac, 10);
		total = ac.armor.type === "heavy" ? armorAc : ac.armor.type === "medium" ? armorAc + Math.min(2, dexMod) : armorAc + dexMod;
	} else {
		total = toInt(ac.base, 10) + dexMod;
	}
	if (ac.shield) total += 2;
	total += toInt(ac.itemBonus, 0) + toInt(character?.customModifiers?.ac, 0);
	for (const bonus of Array.isArray(ac.bonuses) ? ac.bonuses : []) total += toInt(bonus?.value, 0);
	return total;
}

/** "Rogue 5", or "Fighter 3 / Wizard 2" for a multiclass character; "" when the sheet has no classes. */
export function getEncounterCharacterClassLine (character) {
	const classes = (Array.isArray(character?.classes) ? character.classes : []).filter(it => it && `${it.name || ""}`.trim());
	return classes.map(it => `${`${it.name}`.trim()}${toInt(it.level, 0) > 0 ? ` ${toInt(it.level, 0)}` : ""}`).join(" / ");
}

/**
 * Encounter stats from a saved character record. AC, passive Perception and initiative are estimates from the saved
 * data (the sheet recomputes features and equipment live) — `approximate` lists them so the add dialog can let the DM
 * confirm. Pass `derived` (e.g. from a live CharacterSheetState: {ac, initBonus, passive, speed}) to override.
 * Returns {characterId, name, level, classLine, ac, hpMax, hpCurrent, hpTemp, speed, initBonus, passive, abilities, approximate}.
 */
export function getEncounterPartyStatsFromCharacter (character, {derived = {}} = {}) {
	if (!character || typeof character !== "object") throw new Error("This saved character can't be read.");
	const name = `${character.name || ""}`.trim() || "Unnamed Character";
	const abilities = getEncounterCharacterAbilities(character);
	const level = getEncounterCharacterLevel(character);
	const pb = Math.floor((level - 1) / 4) + 2 + toInt(character.customModifiers?.proficiencyBonus, 0);
	const dexMod = getEncounterAbilityMod(abilities.dex);
	const perceptionProf = toInt(character.skillProficiencies?.perception, 0);
	const hpMax = Math.max(1, toInt(character.hp?.max, 1));
	const out = {
		characterId: typeof character.id === "string" && character.id ? character.id : null,
		name,
		level,
		classLine: getEncounterCharacterClassLine(character),
		ac: getArmorClass(character, dexMod),
		hpMax,
		hpCurrent: Math.max(0, Math.min(hpMax, toInt(character.hp?.current, hpMax))),
		hpTemp: Math.max(0, toInt(character.hp?.temp, 0)),
		speed: Math.max(0, toInt(character.speed?.walk, 30) + toInt(character.customModifiers?.speed?.walk, 0)),
		initBonus: dexMod + toInt(character.customModifiers?.initiative, 0),
		passive: 10 + getEncounterAbilityMod(abilities.wis) + pb * Math.max(0, Math.min(2, perceptionProf)) + toInt(character.customModifiers?.skills?.perception, 0),
		abilities,
		approximate: ["ac", "initBonus", "passive"].filter(key => !Number.isSafeInteger(derived[key])),
	};
	for (const key of ["ac", "initBonus", "passive", "speed"]) if (Number.isSafeInteger(derived[key])) out[key] = derived[key];
	return out;
}

/** Saved Character Sheet characters: [{characterId, label, character}] (most recently saved first). */
export async function pGetEncounterSavedCharacters ({storage = globalThis.StorageUtil} = {}) {
	const characters = await storage.pGet("charsheet-characters");
	if (characters == null) return [];
	if (!Array.isArray(characters)) throw new Error("The saved character list is malformed.");
	return characters
		.filter(it => it && typeof it === "object")
		.map(character => {
			const classes = (character.classes || []).filter(it => it?.name);
			const level = getEncounterCharacterLevel(character);
			const name = `${character.name || ""}`.trim() || "Unnamed Character";
			return {characterId: character.id || null, label: classes.length ? `${name} — ${classes.map(it => it.name).join("/")} ${level}` : name, savedAt: toInt(character._savedAt, 0), character};
		})
		.sort((a, b) => b.savedAt - a.savedAt)
		.map(({savedAt, ...rest}) => rest);
}

/**
 * Build a party instance from stats ({name, ac, hpMax, hpCurrent?, hpTemp?, speed, initBonus, passive, characterId?, classLine?}),
 * from a saved character or from manual entry. The hash is `party:<characterId>` or `party:<slug>`; `id` is required.
 */
export function createEncounterPartyInstance ({id, name, ac = 10, hpMax = 1, hpCurrent = null, hpTemp = 0, speed = 30, initBonus = 0, passive = 10, characterId = null, initiative = null, classLine = null}) {
	if (typeof id !== "string" || !id) throw new Error("A party member needs an id.");
	const stats = {ac: toInt(ac, 10), speed: Math.max(0, toInt(speed, 30)), initBonus: toInt(initBonus, 0), passive: toInt(passive, 10)};
	const max = Math.max(1, toInt(hpMax, 1));
	const monster = getEncounterPartyMonster({name, ac: stats.ac, hpMax: max, speed: stats.speed, initBonus: stats.initBonus});
	const hash = `${ENCOUNTER_PARTY_HASH_PREFIX}${characterId || getSlug(monster.name)}`;
	return {
		id,
		hash,
		customHashId: null,
		monster,
		conditions: [],
		areaNotes: [],
		modifiers: [],
		statblockOperations: [],
		hp: {current: hpCurrent == null ? max : Math.max(0, Math.min(max, toInt(hpCurrent, max))), max, temp: Math.max(0, toInt(hpTemp, 0))},
		initiative: Number.isSafeInteger(initiative) ? initiative : null,
		resources: getEncounterResourceDefaults(monster),
		...getEncounterInstanceV8Defaults(hash),
		party: {characterId: characterId || null, ...stats, ...(typeof classLine === "string" && classLine.trim() ? {classLine: classLine.trim()} : {})},
	};
}

/**
 * Add party members (stats objects). A saved character already in the encounter is skipped. New members join the
 * custom group `group` (default "Party"; pass null for none) and aren't selected.
 * Returns {state, addedIds, skipped: [{name, reason}]}.
 */
export function withEncounterPartyMembers (state, {members, fnUid, group = "Party"}) {
	const usedIds = new Set(state.instances.map(it => it.id));
	const usedCharacters = new Set(state.instances.map(it => it.party?.characterId).filter(Boolean));
	const usedHashes = new Set(state.instances.map(it => it.hash));
	const added = [];
	const skipped = [];
	for (const member of members) {
		if (member.characterId && usedCharacters.has(member.characterId)) { skipped.push({name: member.name, reason: "already in the encounter"}); continue; }
		const id = fnUid();
		if (typeof id !== "string" || !id || usedIds.has(id)) throw new Error("Could not create a unique encounter instance.");
		usedIds.add(id);
		let instance = createEncounterPartyInstance({...member, id});
		if (!member.characterId) {
			let hash = instance.hash;
			for (let n = 2; usedHashes.has(hash); ++n) hash = `${instance.hash}-${n}`;
			instance = {...instance, hash};
		}
		usedHashes.add(instance.hash);
		if (member.characterId) usedCharacters.add(member.characterId);
		added.push(group ? {...instance, customGroup: group} : instance);
	}
	return {
		state: EncounterWorkspaceState.validate({...state, instances: [...state.instances, ...added]}),
		addedIds: added.map(it => it.id),
		skipped,
	};
}

/* ----- Combat summary / XP ----- */

export const getEncounterIsDefeated = instance => !!instance.defeated || (instance.kind !== "party" && instance.hp?.max != null && instance.hp.current === 0);

/**
 * Mockup combatSummary: {name, rounds, defeated: [{id, label, xp}], remaining: [label], xp, unratedCount,
 * party: [{id, label, hp, hpMax, down}], perMember}. Pass `labels` (Map id→label) for display names.
 */
export function getEncounterCombatSummary (state, {labels = null} = {}) {
	const label = instance => labels?.get(instance.id) || instance.label || instance.monster.name;
	const foes = state.instances.filter(it => it.kind !== "party");
	const party = state.instances.filter(it => it.kind === "party");
	let unratedCount = 0;
	const defeated = foes.filter(getEncounterIsDefeated).map(instance => {
		const xp = getEncounterMonsterXp(getEncounterEffectiveMonster(instance));
		if (xp == null) unratedCount++;
		return {id: instance.id, label: label(instance), xp: xp ?? 0};
	});
	const xp = defeated.reduce((sum, it) => sum + it.xp, 0);
	return {
		name: state.sourceList?.name || "Encounter",
		rounds: state.turn?.round || 0,
		defeated,
		remaining: foes.filter(it => !getEncounterIsDefeated(it)).map(label),
		xp,
		unratedCount,
		party: party.map(it => ({id: it.id, label: label(it), hp: it.hp.current, hpMax: it.hp.max, down: it.hp.current === 0})),
		perMember: party.length ? Math.floor(xp / party.length) : 0,
	};
}

/** Log line for ending combat (the engine's recipe logs it). */
export function getEncounterCombatEndText (summary, {award = true} = {}) {
	const rounds = `${summary.rounds} round${summary.rounds === 1 ? "" : "s"}`;
	if (!award) return `Combat ended after ${rounds}. No XP awarded.`;
	return `Combat ended after ${rounds}. ${summary.xp} XP awarded${summary.party.length ? ` — ${summary.perMember} each` : ""}.`;
}

export function withEncounterCombatStatus (state, status) {
	return EncounterWorkspaceState.validate({...state, combat: {...state.combat, status}});
}

/** End combat: status "ended" and the summary (with XP when awarding). Returns {state, summary, text}. */
export function withEncounterCombatEnded (state, {award = true, labels = null} = {}) {
	const summary = getEncounterCombatSummary(state, {labels});
	return {state: withEncounterCombatStatus(state, "ended"), summary, text: getEncounterCombatEndText(summary, {award})};
}

/* ----- Apply CR ----- */

export const ENCOUNTER_APPLIED_CR_OPERATION_ID = "apply-cr";

/**
 * Set the listed CR (and so XP) on creatures, e.g. from the assessment estimate. Re-applying replaces the previous
 * value; `withoutEncounterAppliedCr` restores the original. Returns {state, changedIds}.
 */
export function withEncounterAppliedCr (state, {ids = state.selectedIds, cr}) {
	if (!globalThis.Parser?.isValidCr?.(`${cr}`)) throw new Error(`${cr} isn't a valid challenge rating.`);
	const changes = state.instances
		.filter(it => ids.includes(it.id) && it.kind !== "party")
		.map(instance => {
			const previous = instance.statblockOperations.some(it => it.id === ENCOUNTER_APPLIED_CR_OPERATION_ID);
			return {
				id: instance.id,
				removeIds: previous ? [ENCOUNTER_APPLIED_CR_OPERATION_ID] : [],
				addOperations: [{id: ENCOUNTER_APPLIED_CR_OPERATION_ID, type: "patch", data: {patch: {set: {cr: `${cr}`}}}}],
			};
		});
	if (!changes.length) return {state, changedIds: []};
	return {state: EncounterWorkspaceState.withStatblockChanges(state, changes).state, changedIds: changes.map(it => it.id)};
}

export function withoutEncounterAppliedCr (state, {ids = state.selectedIds}) {
	const changes = state.instances
		.filter(it => ids.includes(it.id) && it.statblockOperations.some(op => op.id === ENCOUNTER_APPLIED_CR_OPERATION_ID))
		.map(it => ({id: it.id, removeIds: [ENCOUNTER_APPLIED_CR_OPERATION_ID], addOperations: []}));
	if (!changes.length) return {state, changedIds: []};
	return {state: EncounterWorkspaceState.withStatblockChanges(state, changes).state, changedIds: changes.map(it => it.id)};
}
