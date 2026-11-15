/**
 * P3b — DOM-free view models for prep mode: tabs, bestiary search ranking, add-creature instances, quick-edit
 * validation and patches, the manual party-member form, battlefield form validation and effect rows.
 */

export const PREP_TABS = [
	{id: "creature", label: "Creature"},
	{id: "fx", label: "Effects"},
	{id: "area", label: "Battlefield"},
	{id: "items", label: "Items"},
	{id: "add", label: "Add"},
];

export const PREP_WHY = {
	creature: "Changes <b>who it is</b> — numbers, statblock, templates, CR. Permanent for this fight; nothing counts down.",
	fx: "Something <b>on</b> a creature for a while — spells, buffs, cover, custom bonuses. Counts down and ends.",
	area: "<b>Where</b> the fight happens — terrain, light, weather, hallowed ground, the lair. Applies to everyone in it, a group, or the selected.",
	items: "Magic items a creature <b>carries</b> — their traits and actions are added to its statblock.",
	add: "Bring more monsters or party members into the fight.",
};

export const PREP_CREATURE_SUBS = [
	{id: "edit", label: "Quick edit"},
	{id: "sb", label: "Statblock"},
	{id: "tpl", label: "Templates"},
	{id: "legendary", label: "Legendary"},
	{id: "traits", label: "Habitat traits"},
	{id: "cr", label: "Challenge rating"},
];

export const PREP_MAX_INSTANCES = 1000;
export const PREP_MAX_QUANTITY = 20;
export const PREP_QUICK_EDIT_OPERATION_ID = "ewc-quick-edit";

/** The tab after/before `tab` (dir +1 / -1), wrapping around. */
export function getNextPrepTab (tab, dir) {
	const ix = Math.max(0, PREP_TABS.findIndex(it => it.id === tab));
	return PREP_TABS[(ix + (dir < 0 ? -1 : 1) + PREP_TABS.length) % PREP_TABS.length].id;
}

/* -------------------------------------------- Monsters -------------------------------------------- */

export function getPrepMonsterType (mon) {
	const type = typeof mon?.type === "string" ? mon.type : mon?.type?.type;
	if (typeof type === "string") return type.toLowerCase();
	if (type && typeof type === "object" && Array.isArray(type.choose)) return type.choose.join("/").toLowerCase();
	return "";
}

export function getPrepCrText (mon) {
	const cr = typeof mon?.cr === "string" ? mon.cr : mon?.cr?.cr;
	return typeof cr === "string" ? cr : "";
}

/** "1/8" → 0.125, "5" → 5; anything else → null. */
export function getPrepCrNumber (cr) {
	const text = `${cr ?? ""}`.trim();
	const frac = /^(\d+)\/(\d+)$/.exec(text);
	if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
	if (!/^\d+(\.\d+)?$/.test(text)) return null;
	return Number(text);
}

export function fmtPrepCr (cr) {
	return ({"1/8": "⅛", "1/4": "¼", "1/2": "½"})[cr] || cr || "—";
}

export const PREP_CR_BANDS = [
	{id: "", label: "Any CR"},
	{id: "0-0.5", label: "CR 0–½", min: 0, max: 0.5},
	{id: "1-2", label: "CR 1–2", min: 1, max: 2},
	{id: "3-5", label: "CR 3–5", min: 3, max: 5},
	{id: "6-10", label: "CR 6–10", min: 6, max: 10},
	{id: "11+", label: "CR 11+", min: 11, max: Infinity},
];

/** Distinct base creature types across the bestiary, sorted ("celestial/fiend" counts as both). */
export function getPrepMonsterTypes (monsters) {
	return [...new Set(monsters.flatMap(mon => getPrepMonsterType(mon).split("/")).filter(Boolean))].sort();
}

/** 0 exact · 1 prefix · 2 word prefix · 3 substring · 4 type match · null no match. */
function getPrepSearchScore (mon, q) {
	if (!q) return 0;
	const name = `${mon.name || ""}`.toLowerCase();
	if (name === q) return 0;
	if (name.startsWith(q)) return 1;
	if (name.split(/[\s,()'-]+/).some(word => word.startsWith(q))) return 2;
	if (name.includes(q)) return 3;
	if (getPrepMonsterType(mon).includes(q)) return 4;
	return null;
}

/**
 * Ranks the full bestiary for the add dialog: exact > prefix > word prefix > substring > type, then by name.
 * Returns {rows: [{mon, score}], total} (total = matches before `limit`).
 */
export function searchPrepBestiary (monsters, {q = "", band = "", type = "", limit = 80} = {}) {
	const query = `${q}`.trim().toLowerCase();
	const crBand = PREP_CR_BANDS.find(it => it.id === band && it.id);
	const matches = [];
	for (const mon of monsters) {
		if (!mon?.name) continue;
		if (type && !getPrepMonsterType(mon).split("/").includes(type)) continue;
		if (crBand) {
			const cr = getPrepCrNumber(getPrepCrText(mon));
			if (cr == null || cr < crBand.min || cr > crBand.max) continue;
		}
		const score = getPrepSearchScore(mon, query);
		if (score == null) continue;
		matches.push({mon, score});
	}
	matches.sort((a, b) => a.score - b.score
		|| `${a.mon.name}`.localeCompare(`${b.mon.name}`)
		|| `${a.mon.source}`.localeCompare(`${b.mon.source}`));
	return {rows: matches.slice(0, limit), total: matches.length};
}

export function clampPrepQuantity (value) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return 1;
	return Math.max(1, Math.min(PREP_MAX_QUANTITY, n));
}

/** Starting HP for a new creature: the listed average, or a roll of its formula (falls back to the average). */
export function getPrepAddHp (mon, {hpMode = "average", fnRoll = null} = {}) {
	const average = mon?.hp?.average;
	const avg = typeof average === "number" && Number.isFinite(average) && average >= 0 ? Math.round(average) : null;
	let max = avg;
	if (hpMode === "rolled" && fnRoll && typeof mon?.hp?.formula === "string") {
		const rolled = Number(fnRoll(mon.hp.formula));
		if (Number.isFinite(rolled)) max = Math.max(1, Math.round(rolled));
	}
	return {current: max, max, temp: 0};
}

/** How many more creatures fit before the encounter cap; throws when `qty` doesn't. */
export function assertPrepRoom (state, qty) {
	const free = PREP_MAX_INSTANCES - state.instances.length;
	if (qty > free) throw new Error(free > 0 ? `Only ${free} more creature${free === 1 ? "" : "s"} fit in this encounter.` : "This encounter is full.");
	return free;
}

/** Distinct monster kinds already in the fight (for "+1 X"): [{hash, name, instanceId, count}]. */
export function getPrepKinds (state, {labels = null} = {}) {
	const byHash = new Map();
	for (const instance of state.instances) {
		if (instance.kind === "party" || !instance.monster?.name) continue;
		const prev = byHash.get(instance.hash);
		if (prev) { prev.count++; continue; }
		byHash.set(instance.hash, {hash: instance.hash, name: instance.monster.name, instanceId: instance.id, count: 1, label: labels?.get(instance.id) || instance.monster.name});
	}
	return [...byHash.values()];
}

/* -------------------------------------------- Quick edit -------------------------------------------- */

const QUICK_FIELDS = [
	{key: "hpMax", label: "Max HP", min: 1, max: 99999},
	{key: "ac", label: "AC", min: 0, max: 50},
	{key: "speed", label: "Speed", min: 0, max: 999},
	{key: "initBonus", label: "Init bonus", min: -20, max: 30},
];

function getAcNumber (ac) {
	const first = Array.isArray(ac) ? ac[0] : ac;
	if (typeof first === "number") return first;
	if (typeof first?.ac === "number") return first.ac;
	return null;
}

function getWalkSpeed (speed) {
	if (typeof speed === "number") return speed;
	const walk = speed?.walk;
	if (typeof walk === "number") return walk;
	if (typeof walk?.number === "number") return walk.number;
	return null;
}

function getAbilityMod (score) {
	return typeof score === "number" ? Math.floor((score - 10) / 2) : null;
}

function getInitBonus (mon) {
	if (typeof mon?.initiative === "number") return mon.initiative;
	if (typeof mon?.initiative?.initiative === "number") return mon.initiative.initiative;
	return getAbilityMod(mon?.dex);
}

/** The current quick-edit numbers for one creature (its effective statblock). */
export function getPrepQuickEditCurrent (instance, effective = instance.monster) {
	if (instance.kind === "party" && instance.party) {
		return {name: instance.label || instance.monster?.name || "", hpMax: instance.hp?.max ?? null, ac: instance.party.ac, speed: instance.party.speed, initBonus: instance.party.initBonus};
	}
	return {
		name: instance.label || effective?.name || "",
		hpMax: typeof effective?.hp?.average === "number" ? effective.hp.average : instance.hp?.max ?? null,
		ac: getAcNumber(effective?.ac),
		speed: getWalkSpeed(effective?.speed),
		initBonus: getInitBonus(effective),
	};
}

/**
 * Validates quick-edit text inputs; blank = unchanged. Returns {values: {name?, hpMax?, ...}, errors: {key: text}, isEmpty}.
 * `name` is only honoured for a single target.
 */
export function validatePrepQuickEdit (raw = {}, {isSingle = true} = {}) {
	const values = {};
	const errors = {};
	if (isSingle && raw.name != null && `${raw.name}`.trim() !== "") {
		const name = `${raw.name}`.trim();
		if (name.length > 120) errors.name = "Keep the name under 120 characters.";
		else values.name = name;
	}
	for (const field of QUICK_FIELDS) {
		const text = `${raw[field.key] ?? ""}`.trim();
		if (!text) continue;
		if (!/^[+-]?\d+$/.test(text)) { errors[field.key] = `${field.label} must be a whole number.`; continue; }
		const n = Number(text);
		if (n < field.min || n > field.max) { errors[field.key] = `${field.label} must be ${field.min}–${field.max}.`; continue; }
		values[field.key] = n;
	}
	return {values, errors, isEmpty: !Object.keys(values).length};
}

const fmtSigned = n => n == null ? "—" : n >= 0 ? `+${n}` : `${n}`;
const QUICK_FMT = {name: v => v || "—", hpMax: v => v ?? "—", ac: v => v ?? "—", speed: v => v == null ? "—" : `${v} ft.`, initBonus: fmtSigned};
const QUICK_LABELS = {name: "Name", hpMax: "Max HP", ac: "AC", speed: "Speed", initBonus: "Init"};

/** Per-target preview lines: [{id, label, changes: [{key, label, before, after}]}]; unchanged fields are dropped. */
export function getPrepQuickEditDiff (targets, values) {
	return targets.map(({id, label, current}) => ({
		id,
		label,
		changes: Object.keys(values)
			.filter(key => current[key] !== values[key])
			.map(key => ({key, label: QUICK_LABELS[key], before: `${QUICK_FMT[key](current[key])}`, after: `${QUICK_FMT[key](values[key])}`})),
	}));
}

/** Structured patch `set` for a monster's quick edit (merged by the caller into its single quick-edit operation). */
export function getPrepQuickEditSet (effective, values) {
	const set = {};
	if (values.hpMax != null) set.hp = {average: values.hpMax, formula: `${values.hpMax}d1`};
	if (values.ac != null) {
		const list = Array.isArray(effective?.ac) ? effective.ac : [];
		const first = list[0];
		set.ac = first && typeof first === "object" ? [{...first, ac: values.ac}, ...list.slice(1)] : [values.ac, ...list.slice(1)];
	}
	if (values.speed != null) {
		if (effective?.speed && typeof effective.speed === "object") set["speed.walk"] = values.speed;
		else set.speed = {walk: values.speed};
	}
	if (values.initBonus != null) {
		if (effective?.initiative && typeof effective.initiative === "object") set["initiative.initiative"] = values.initBonus;
		else set.initiative = values.initBonus;
	}
	return set;
}

/**
 * The statblock change for one monster: replaces its previous quick-edit operation (merging the earlier fields)
 * so repeated edits stay one undoable operation. Returns a `withStatblockChanges` change, or null if nothing to set.
 */
export function getPrepQuickEditChange (instance, effective, values) {
	const set = getPrepQuickEditSet(effective, values);
	if (!Object.keys(set).length) return null;
	const prior = (instance.statblockOperations || []).find(it => it.id === PREP_QUICK_EDIT_OPERATION_ID);
	const priorSet = prior?.data?.patch?.set || {};
	const merged = {...priorSet};
	for (const [path, value] of Object.entries(set)) {
		const [root, child] = path.split(".");
		if (child && merged[root] && typeof merged[root] === "object") { merged[root] = {...merged[root], [child]: value}; continue; }
		if (!child) Object.keys(merged).filter(key => key.startsWith(`${root}.`)).forEach(key => delete merged[key]);
		merged[path] = value;
	}
	return {
		id: instance.id,
		removeIds: prior ? [prior.id] : [],
		addOperations: [{id: PREP_QUICK_EDIT_OPERATION_ID, type: "patch", data: {patch: {set: merged}}}],
	};
}

/* -------------------------------------------- Party -------------------------------------------- */

/** The manual party member form → a member for `withEncounterPartyMembers`, or {error}. */
export function validatePrepManualPc ({name, ac, hp, init, passive} = {}) {
	const nm = `${name ?? ""}`.trim();
	if (!nm) return {error: "Name the party member."};
	const nums = {ac: [ac, 0, 40, "AC"], hpMax: [hp, 1, 9999, "HP"], initBonus: [init, -10, 20, "Init"], passive: [passive, 0, 40, "Passive"]};
	const member = {name: nm, speed: 30};
	for (const [key, [raw, min, max, label]] of Object.entries(nums)) {
		const text = `${raw ?? ""}`.trim();
		if (!/^[+-]?\d+$/.test(text)) return {error: `${label} must be a whole number.`};
		const n = Number(text);
		if (n < min || n > max) return {error: `${label} must be ${min}–${max}.`};
		member[key] = n;
	}
	return {member};
}

/* -------------------------------------------- Durations / effects -------------------------------------------- */

/** "" → until removed (null); a whole number ≥ 1 → rounds. Returns {rounds} or {error}. */
export function parsePrepRounds (text) {
	const t = `${text ?? ""}`.trim();
	if (!t || t === "∞") return {rounds: null};
	if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 1e6) return {error: "Rounds must be a whole number of at least 1 — or blank for until removed."};
	return {rounds: Number(t)};
}

/**
 * The effects and conditions currently on `ids` (all creatures when null), for the Effects tab:
 * [{instanceId, label, kind: "fx"|"cond", key, effectId?, name, rounds, casterLabel, effect?}].
 */
export function getPrepCurrentEffectRows (state, ids = null, {labels = null} = {}) {
	const only = ids ? new Set(ids) : null;
	const labelOf = id => labels?.get(id) || state.instances.find(it => it.id === id)?.monster?.name || id;
	const rows = [];
	for (const instance of state.instances) {
		if (only && !only.has(instance.id)) continue;
		for (const fx of instance.effects || []) {
			rows.push({instanceId: instance.id, label: labelOf(instance.id), kind: "fx", key: `${instance.id}|${fx.id}`, effectId: fx.id, name: fx.name, rounds: fx.rounds ?? null, casterLabel: fx.casterId ? labelOf(fx.casterId) : null, effect: fx});
		}
		for (const name of instance.conditions || []) {
			rows.push({instanceId: instance.id, label: labelOf(instance.id), kind: "cond", key: `${instance.id}|cond:${name}`, name, rounds: instance.conditionDetails?.[name]?.rounds ?? null, casterLabel: null});
		}
	}
	return rows;
}

/* -------------------------------------------- Battlefield -------------------------------------------- */

/**
 * The battlefield form → args for `withEncounterBattlefieldEntry`, or {error}.
 * draft: {rule, name, scope, group, rounds, note, casterId}; `selectedIds` for the "Selected" scope.
 */
export function getPrepBattlefieldArgs (draft, {selectedIds = [], groupNames = []} = {}) {
	if (!draft?.rule) return {error: "Choose a battlefield rule."};
	const scope = draft.scope || "all";
	if (draft.rule === "custom" && !`${draft.name ?? ""}`.trim()) return {error: "Name the reminder."};
	if (scope === "selection" && !selectedIds.length) return {error: "Select creatures first."};
	const group = scope === "group" ? draft.group || groupNames[0] || null : null;
	if (scope === "group" && !group) return {error: "Choose a group."};
	const rounds = parsePrepRounds(draft.rounds);
	if (rounds.error) return {error: rounds.error};
	const args = {rule: draft.rule, scope, rounds: rounds.rounds, note: `${draft.note ?? ""}`.trim(), casterId: draft.casterId || null};
	const name = `${draft.name ?? ""}`.trim();
	if (name) args.name = name;
	if (scope === "group") args.group = group;
	if (scope === "selection") args.ids = [...selectedIds];
	return {args};
}

/* -------------------------------------------- Challenge rating -------------------------------------------- */

const CR_FIELDS = [
	{key: "hp", label: "HP"},
	{key: "ac", label: "AC"},
	{key: "damageOverThreeRounds", label: "damage over 3 rounds"},
	{key: "attackValue", label: "attack bonus"},
];

/**
 * CR estimate inputs: the inferred values (`getEncounterCrInferences().values`), a plain single AC the inference
 * skips, then the DM's typed overrides (blank = keep). Returns {values, missing: [{key, label}]}.
 */
export function getPrepCrAssumptions (inferred, effective, overrides = {}) {
	const values = {...inferred};
	if (values.ac == null && Array.isArray(effective?.ac) && effective.ac.length === 1) {
		const ac = getAcNumber(effective.ac);
		if (Number.isSafeInteger(ac) && ac >= 0 && ac <= 40) values.ac = ac;
	}
	for (const {key} of CR_FIELDS) {
		const text = `${overrides[key] ?? ""}`.trim();
		if (/^[+-]?\d+$/.test(text)) values[key] = Number(text);
	}
	const missing = CR_FIELDS
		.filter(({key}) => values[key] == null)
		.map(({key, label}) => ({key, label: key === "attackValue" && values.attackType === "save" ? "save DC" : label}));
	return {values, missing};
}

/**
 * Loaded habitat/area traits (each with `_areaName`) grouped by environment for the Creature → Habitat traits
 * catalogue: [{area, traits}] in first-seen order, traits by name. Traits without a name or source are dropped.
 */
export function getPrepAreaTraitGroups (traits) {
	const groups = new Map();
	(traits || []).forEach(trait => {
		if (!trait?.name || !trait?.source) return;
		const area = `${trait._areaName || "Environment"}`.trim() || "Environment";
		if (!groups.has(area)) groups.set(area, []);
		groups.get(area).push(trait);
	});
	return [...groups]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([area, list]) => ({area, traits: list.sort((a, b) => a.name.localeCompare(b.name))}));
}
