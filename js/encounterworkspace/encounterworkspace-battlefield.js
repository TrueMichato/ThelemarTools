import {EncounterWorkspaceState, getEncounterEffectiveMonster, getEncounterViewGroups} from "./encounterworkspace-state.js";
import {ENCOUNTER_ROLL_PRESETS, getEncounterIsUndead, getEncounterPresetCitation} from "./encounterworkspace-effects.js";
import {getEncounterAttackOptions, getEncounterNormalizedSkill} from "./encounterworkspace-rollbreakdown.js";

/**
 * The Battlefield: encounter-wide rules (state `battlefield[]`) — light, cover, terrain, weather & hazards, lair actions
 * and reminders — scoped to everyone, a group, or chosen creatures. Every rule has one display name (used by prep and
 * the battlefield strip alike) and a short description for hovers. `getEncounterBattlefieldContributors` is a
 * roll-contributor provider `(state, instance, query) → partial`.
 */

export const ENCOUNTER_BATTLEFIELD_CATEGORIES = Object.freeze({
	light: "Light & vision",
	cover: "Cover",
	terrain: "Terrain",
	weather: "Weather & hazards",
	ground: "Hallowed & desecrated ground",
	lair: "Lair",
	reminder: "Reminders",
});

const getPresetRule = (presetId, extra) => {
	const preset = ENCOUNTER_ROLL_PRESETS.find(it => it.presetId === presetId);
	return {rule: presetId, name: preset.name, description: preset.description, source: preset.source, page: preset.page, citation: getEncounterPresetCitation(preset), ...extra};
};

export const ENCOUNTER_BATTLEFIELD_RULES = Object.freeze([
	{rule: "dim-light",
		name: "Dim light",
		category: "light",
		sight: "dim",
		source: "PHB",
		page: 183,
		description: "Lightly obscured: disadvantage on sight-based Perception. Darkvision, blindsight, truesight and tremorsense are unaffected."},
	{rule: "darkness",
		name: "Darkness",
		category: "light",
		sight: "dark",
		source: "PHB",
		page: 183,
		description: "Heavily obscured: Blinded without darkvision, blindsight, truesight or tremorsense. Darkvision treats it as dim light."},
	{rule: "magical-darkness",
		name: "Magical darkness",
		category: "light",
		sight: "magical",
		source: "PHB",
		page: 230,
		description: "Darkvision can't see through it. Only blindsight or truesight see; everyone else is Blinded."},
	{rule: "fog",
		name: "Heavy fog",
		category: "light",
		sight: "fog",
		source: "PHB",
		page: 183,
		description: "Heavily obscured by fog or dense foliage: Blinded unless the creature has blindsight."},
	{rule: "half-cover",
		name: "Half cover",
		category: "cover",
		ac: 2,
		dexSave: 2,
		replaces: ["three-quarters-cover", "total-cover"],
		source: "PHB",
		page: 196,
		description: "+2 to AC and Dexterity saving throws."},
	{rule: "three-quarters-cover",
		name: "Three-quarters cover",
		category: "cover",
		ac: 5,
		dexSave: 5,
		replaces: ["half-cover", "total-cover"],
		source: "PHB",
		page: 196,
		description: "+5 to AC and Dexterity saving throws."},
	{rule: "total-cover",
		name: "Total cover",
		category: "cover",
		replaces: ["half-cover", "three-quarters-cover"],
		source: "PHB",
		page: 196,
		description: "Can't be targeted directly by an attack or a spell, though an area of effect can still reach it."},
	{rule: "difficult-terrain",
		name: "Difficult terrain",
		category: "terrain",
		speedMultiplier: 0.5,
		source: "PHB",
		page: 182,
		description: "Every foot of movement costs 1 extra foot, so speed is effectively halved."},
	{rule: "underwater",
		name: "Underwater",
		category: "terrain",
		source: "PHB",
		page: 198,
		description: "Melee weapon attacks have disadvantage without a swim speed (daggers, javelins, shortswords, spears and tridents excepted). Ranged weapon attacks miss beyond normal range and have disadvantage within it. Fully immersed creatures resist fire."},
	getPresetRule("heavy-precipitation-xdmg", {category: "weather", name: "Heavy precipitation"}),
	getPresetRule("blizzard-idrotf", {category: "weather", name: "Blizzard"}),
	{rule: "strong-wind",
		name: "Strong wind",
		category: "weather",
		source: "DMG",
		page: 110,
		description: "Disadvantage on ranged weapon attacks and on Perception checks that rely on hearing. Extinguishes open flames; flying creatures must land at the end of their turn or fall."},
	{rule: "extreme-cold",
		name: "Extreme cold",
		category: "weather",
		source: "DMG",
		page: 110,
		description: "Each hour exposed: DC 10 Constitution save or gain a level of exhaustion. Cold resistance or immunity, or cold-weather gear, succeeds automatically."},
	{rule: "extreme-heat",
		name: "Extreme heat",
		category: "weather",
		source: "DMG",
		page: 110,
		description: "Each hour without water: Constitution save (DC 5, +1 per further hour) or gain a level of exhaustion. Disadvantage in medium or heavy armor or heavy clothing; fire resistance or immunity succeeds automatically."},
	getPresetRule("desecrated-dmg", {category: "ground", name: "Desecrated ground", replaces: ["desecrated-house"]}),
	getPresetRule("desecrated-house", {category: "ground", name: "Desecrated ground (house rule)", replaces: ["desecrated-dmg"]}),
	{rule: "lair-actions",
		name: "Lair actions",
		category: "lair",
		initiative: 20,
		source: "MM",
		page: 11,
		description: "On initiative count 20 (losing initiative ties), the lair takes a lair action. It can't use the same one two rounds in a row."},
	{rule: "custom",
		name: "Reminder",
		category: "reminder",
		source: null,
		page: null,
		description: "A note with no mechanics."},
].map(rule => Object.freeze({citation: rule.source ? `${rule.source}${rule.page ? ` p. ${rule.page}` : ""}` : null, ...rule})));

const RULES_BY_ID = new Map(ENCOUNTER_BATTLEFIELD_RULES.map(it => [it.rule, it]));

export function getEncounterBattlefieldRule (rule) {
	return RULES_BY_ID.get(rule) || null;
}

/** One name for an entry everywhere it is shown: its own name for reminders, otherwise the catalogue name. */
export function getEncounterBattlefieldDisplayName (entry) {
	const rule = getEncounterBattlefieldRule(entry.rule);
	return !rule || entry.rule === "custom" ? entry.name || rule?.name || entry.rule : rule.name;
}

export function getEncounterBattlefieldScopeText (state, entry, {labels = null} = {}) {
	if (entry.scope === "all") return "Everyone";
	if (entry.scope === "group") return entry.group.startsWith("view:") ? "Group" : entry.group;
	const names = entry.ids.map(id => labels?.get(id) || state.instances.find(it => it.id === id)?.monster.name).filter(Boolean);
	return names.length ? names.join(", ") : "Nobody";
}

/** Hover card content: {title, description, citation, note, scope, rounds}. */
export function getEncounterBattlefieldHover (state, entry, opts) {
	const rule = getEncounterBattlefieldRule(entry.rule);
	return {
		title: getEncounterBattlefieldDisplayName(entry),
		description: rule?.description || "",
		citation: rule?.citation || null,
		note: entry.note || "",
		scope: getEncounterBattlefieldScopeText(state, entry, opts),
		rounds: entry.rounds ?? null,
	};
}

export function getEncounterBattlefieldRulesByCategory () {
	return Object.entries(ENCOUNTER_BATTLEFIELD_CATEGORIES).map(([category, name]) => ({category, name, rules: ENCOUNTER_BATTLEFIELD_RULES.filter(it => it.category === category)}));
}

const getScopeKey = entry => `${entry.scope}|${entry.group ?? ""}|${[...entry.ids].sort().join(",")}`;

function getNextId (state, rule) {
	const ids = new Set(state.battlefield.map(it => it.id));
	let n = 1;
	while (ids.has(`bf:${rule}:${n}`)) ++n;
	return `bf:${rule}:${n}`;
}

/**
 * Add a battlefield entry. `scope` is "all", "group" (`group` = custom group name, explicit group id or view group id)
 * or "selection" (`ids`). Adding a rule removes any rule it `replaces` with the same scope (e.g. half → ¾ cover).
 * `casterId` makes a timed entry tick at the start of that creature's turn instead of at each new round.
 * Returns {state, entry, replaced}.
 */
export function withEncounterBattlefieldEntry (state, {rule, name = null, scope = "all", group = null, ids = [], rounds = null, note = "", casterId = null, id = null}) {
	const catalogue = getEncounterBattlefieldRule(rule);
	if (!catalogue) throw new Error(`Unknown battlefield rule: ${rule}.`);
	if (rule === "custom" && !`${name ?? ""}`.trim()) throw new Error("Name the reminder.");
	if (scope === "selection" && !ids.length) throw new Error("Choose who this applies to.");
	if (rule === "lair-actions" && state.battlefield.some(it => it.rule === "lair-actions")) throw new Error("This encounter already has lair actions.");
	const entry = {
		id: id || getNextId(state, rule),
		rule,
		name: rule === "custom" ? `${name}`.trim() : catalogue.name,
		scope,
		...(scope === "group" ? {group} : {}),
		ids: scope === "selection" ? [...new Set(ids)] : [],
		rounds,
		note,
		...(casterId ? {casterId} : {}),
	};
	const key = getScopeKey(entry);
	const replaced = state.battlefield.filter(it => catalogue.replaces?.includes(it.rule) && getScopeKey(it) === key);
	const next = EncounterWorkspaceState.validate({...state, battlefield: [...state.battlefield.filter(it => !replaced.includes(it)), entry]});
	return {state: next, entry, replaced};
}

export function withoutEncounterBattlefieldEntry (state, id) {
	if (!state.battlefield.some(it => it.id === id)) throw new Error("This battlefield effect no longer exists.");
	return EncounterWorkspaceState.validate({...state, battlefield: state.battlefield.filter(it => it.id !== id)});
}

/** Patch an entry's name (reminders only), scope, group, ids, rounds or note. */
export function withEncounterBattlefieldEntryUpdate (state, id, patch) {
	const entry = state.battlefield.find(it => it.id === id);
	if (!entry) throw new Error("This battlefield effect no longer exists.");
	const allowed = ["scope", "group", "ids", "rounds", "note", "casterId", ...(entry.rule === "custom" ? ["name"] : [])];
	const next = {...entry, ...Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)))};
	if (next.scope !== "group") delete next.group;
	if (next.scope !== "selection") next.ids = [];
	return EncounterWorkspaceState.validate({...state, battlefield: state.battlefield.map(it => it === entry ? next : it)});
}

export function getEncounterBattlefieldEntryAppliesTo (state, entry, instance) {
	if (entry.scope === "all") return true;
	if (entry.scope === "selection") return entry.ids.includes(instance.id);
	if (instance.customGroup && instance.customGroup === entry.group) return true;
	if (state.groups.some(it => it.id === entry.group && it.memberIds.includes(instance.id))) return true;
	return entry.group.startsWith("view:") && getEncounterViewGroups(state).some(it => it.id === entry.group && it.memberIds.includes(instance.id));
}

export function getEncounterBattlefieldTargets (state, entry) {
	return state.instances.filter(it => getEncounterBattlefieldEntryAppliesTo(state, entry, it)).map(it => it.id);
}

export function getEncounterBattlefieldEntriesFor (state, instance) {
	return state.battlefield.filter(entry => getEncounterBattlefieldEntryAppliesTo(state, entry, instance));
}

/** Special senses from the (effective) statblock, e.g. {darkvision: 60, blindsight: 10}. */
export function getEncounterSenses (monster) {
	const out = {};
	for (const sense of monster?.senses || []) {
		const match = `${sense}`.match(/(darkvision|blindsight|truesight|tremorsense)\D*(\d+)/i);
		if (match) out[match[1].toLowerCase()] = Math.max(out[match[1].toLowerCase()] || 0, Number(match[2]));
	}
	return out;
}

const SIGHT_RANK = {normal: 0, dim: 1, blinded: 2};

function getSightForRule (senses, sight) {
	const has = key => (senses[key] || 0) > 0;
	const seer = ["blindsight", "truesight", "tremorsense"].find(has);
	switch (sight) {
		case "dim": return has("darkvision") || seer ? {status: "normal", why: `sees normally (${has("darkvision") ? "darkvision" : seer})`} : {status: "dim", why: "lightly obscured"};
		case "dark": return seer ? {status: "normal", why: `sees by ${seer}`} : has("darkvision") ? {status: "dim", why: "darkvision treats it as dim light"} : {status: "blinded", why: "no darkvision"};
		case "magical": {
			const sense = ["blindsight", "truesight"].find(has);
			return sense ? {status: "normal", why: `sees by ${sense}`} : {status: "blinded", why: has("darkvision") ? "darkvision can't pierce it" : "can't see"};
		}
		case "fog": return has("blindsight") ? {status: "normal", why: "sees by blindsight"} : {status: "blinded", why: "heavily obscured"};
		default: return {status: "normal", why: ""};
	}
}

/**
 * How well a creature sees given the light/obscurement entries that cover it and its senses.
 * Returns {status: normal|dim|blinded, entry, name, why, entries: [{entry, name, status, why}]} — the worst one wins.
 */
export function getEncounterSight (state, instance) {
	const senses = getEncounterSenses(getEncounterEffectiveMonster(instance));
	const entries = getEncounterBattlefieldEntriesFor(state, instance)
		.map(entry => ({entry, rule: getEncounterBattlefieldRule(entry.rule)}))
		.filter(it => it.rule?.sight)
		.map(({entry, rule}) => ({entry, name: getEncounterBattlefieldDisplayName(entry), ...getSightForRule(senses, rule.sight)}));
	const worst = entries.reduce((best, it) => !best || SIGHT_RANK[it.status] > SIGHT_RANK[best.status] ? it : best, null);
	return {status: worst?.status || "normal", entry: worst?.entry || null, name: worst?.name || null, why: worst?.why || "", entries, senses};
}

const getIsSave = (query, ability) => query.kind === "save" && query.ability === ability;
const getIsSkill = (query, skill) => query.kind === "check" && getEncounterNormalizedSkill(query.skill) === skill;

/**
 * Roll-contributor provider. Query kinds: attack ({attackName | attack, ranged, spell, targetId}), save ({ability}),
 * check ({ability, skill}), initiative, ac. A blinded attacker has disadvantage; attacks against a creature that
 * can't see have advantage (pass `query.targetId`).
 */
export function getEncounterBattlefieldContributors (state, instance, query = {}) {
	const out = {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
	const monster = getEncounterEffectiveMonster(instance);
	const isWeaponAttack = query.kind === "attack" && !query.spell;
	const attack = query.attack ?? (isWeaponAttack && query.attackName ? getEncounterAttackOptions(monster).find(it => it.name.toLowerCase() === `${query.attackName}`.toLowerCase()) : null);
	const isRanged = query.ranged ?? attack?.ranged ?? false;
	for (const entry of getEncounterBattlefieldEntriesFor(state, instance)) {
		const rule = getEncounterBattlefieldRule(entry.rule);
		if (!rule) continue;
		const name = getEncounterBattlefieldDisplayName(entry);
		const source = `battlefield:${entry.id}`;
		const tag = {label: name, source};
		switch (entry.rule) {
			case "half-cover":
			case "three-quarters-cover":
				if (query.kind === "ac") out.bonuses.push({...tag, value: rule.ac});
				if (getIsSave(query, "dex")) out.bonuses.push({...tag, value: rule.dexSave});
				break;
			case "total-cover":
				if (query.kind === "ac" || query.kind === "save") out.notes.push({label: `${name}: can't be targeted directly`, source});
				break;
			case "heavy-precipitation-xdmg":
				if (getIsSkill(query, "perception")) out.disadvantage.push(tag);
				break;
			case "blizzard-idrotf":
				if (isWeaponAttack && isRanged) out.disadvantage.push(tag);
				break;
			case "strong-wind":
				if (isWeaponAttack && isRanged) out.disadvantage.push(tag);
				if (getIsSkill(query, "perception")) out.notes.push({label: `${name}: disadvantage if relying on hearing`, source});
				break;
			case "underwater":
				if (isWeaponAttack && isRanged) out.disadvantage.push({label: `${name} (beyond normal range: miss)`, source});
				else if (isWeaponAttack && !monster.speed?.swim) out.notes.push({label: `${name}: disadvantage unless dagger, javelin, shortsword, spear or trident`, source});
				break;
			case "desecrated-dmg":
				if (query.kind === "save" && getEncounterIsUndead(monster)) out.advantage.push(tag);
				break;
			case "desecrated-house":
				if (["save", "check", "initiative"].includes(query.kind) && getEncounterIsUndead(monster)) out.advantage.push(tag);
				break;
			case "extreme-cold":
			case "extreme-heat":
				if (getIsSave(query, "con")) out.notes.push({label: `${name}: hourly exposure save`, source});
				break;
		}
	}

	const sight = getEncounterSight(state, instance);
	const sightTag = {label: `Blinded (${sight.name})`, source: sight.entry ? `battlefield:${sight.entry.id}` : null};
	if (sight.status === "blinded") {
		if (query.kind === "attack") out.disadvantage.push(sightTag);
		if (getIsSkill(query, "perception")) {
			out.disadvantage.push(sightTag);
			out.notes.push({label: `${sight.name}: checks that rely only on sight fail`, source: sightTag.source});
		}
	} else if (sight.status === "dim" && getIsSkill(query, "perception")) {
		out.disadvantage.push({label: `${sight.name} (${sight.why})`, source: sightTag.source});
	}
	if (query.kind === "attack" && query.targetId) {
		const target = state.instances.find(it => it.id === query.targetId);
		const targetSight = target ? getEncounterSight(state, target) : null;
		if (targetSight?.status === "blinded") {
			out.advantage.push({label: `Target can't see (${targetSight.name})`, source: `battlefield:${targetSight.entry.id}`});
		}
	}
	return out;
}

/** Turn-order rows the battlefield adds (lair actions on 20, losing ties). */
export function getEncounterBattlefieldTurnRows (state) {
	return state.battlefield.filter(it => it.rule === "lair-actions")
		.map(entry => ({entryId: entry.id, name: getEncounterBattlefieldDisplayName(entry), initiative: getEncounterBattlefieldRule("lair-actions").initiative, losesTies: true}));
}

/**
 * Tick timed entries on a turn change. Entries with a `casterId` tick when that creature's turn starts; the rest tick
 * when a new round starts. Entries reaching 0 rounds are removed. Returns {state, ticked: ids, expired: entries}.
 */
export function withEncounterBattlefieldTick (state, {previousTurn, nextTurn = state.turn}) {
	const isNewRound = (nextTurn?.round || 0) > (previousTurn?.round || 0);
	const ticked = [];
	const expired = [];
	const battlefield = state.battlefield.flatMap(entry => {
		if (entry.rounds == null) return [entry];
		const isDue = entry.casterId ? entry.casterId === nextTurn?.activeId && nextTurn !== previousTurn && nextTurn?.activeId !== previousTurn?.activeId : isNewRound;
		if (!isDue) return [entry];
		ticked.push(entry.id);
		const rounds = entry.rounds - 1;
		if (rounds <= 0) { expired.push(entry); return []; }
		return [{...entry, rounds}];
	});
	return {state: ticked.length ? EncounterWorkspaceState.validate({...state, battlefield}) : state, ticked, expired};
}
