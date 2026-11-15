import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "./encounterworkspace-state.js";
import {BestiaryQuickActionsOperations} from "../bestiary/bestiary-quick-actions-engine.js";
import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../creature-transformations.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../bestiary/bestiary-transformation-workflow.js";

/**
 * Creature templates stored in `instance.templates` — never timeline effects.
 * - Elite / Weak: ±2 to attack rolls, AC and save DCs (via the roll-contributor provider, labelled "Elite +2"), and
 *   double / half hit points (via a removable statblock patch).
 * - Minion: the Flee, Mortals! minion conversion statblock operation.
 * - Legendary: tracked Legendary Actions (3) and Legendary Resistance (3/Day) uses.
 * - Creature-type templates (Zombie, Skeleton, Vampire, Half-Dragon…): the creature-transformation catalogue, applied
 *   through the same workflow as the bestiary/legacy workspace editor.
 * Every template records the statblock operation and ability ids it added, so removing it undoes exactly those.
 */

export const ENCOUNTER_TEMPLATES = Object.freeze([
	{key: "elite",
		name: "Elite",
		kind: "tier",
		delta: 2,
		hpMultiplier: 2,
		excludes: ["weak", "minion"],
		description: "+2 to AC, attack rolls and save DCs; double hit points."},
	{key: "weak",
		name: "Weak",
		kind: "tier",
		delta: -2,
		hpMultiplier: 0.5,
		excludes: ["elite", "minion"],
		description: "−2 to AC, attack rolls and save DCs; half hit points."},
	{key: "minion",
		name: "Minion",
		kind: "statblock",
		excludes: ["elite", "weak"],
		source: "Flee, Mortals!",
		description: "Flee, Mortals! minion: damage from an attack or failed save drops it to 0 HP; other damage kills it only if it meets its HP maximum. Takes no damage on a successful save."},
	{key: "legendary",
		name: "Legendary",
		kind: "resources",
		excludes: [],
		description: "Can take 3 legendary actions per round (regained at the start of its turn) and has Legendary Resistance (3/Day)."},
].map(it => Object.freeze(it)));

const TEMPLATES_BY_KEY = new Map(ENCOUNTER_TEMPLATES.map(it => [it.key, it]));
const LEGENDARY_ABILITIES = [
	{id: "template:legendary:actions", name: "Legendary Actions", current: 3, max: 3},
	{id: "template:legendary:resistance", name: "Legendary Resistance (3/Day)", current: 3, max: 3},
];

export const getEncounterCreatureTypeTemplateKey = catalogId => `type:${catalogId}`;

export function getEncounterTemplate (key) {
	return TEMPLATES_BY_KEY.get(key) || null;
}

export function getEncounterInstanceTemplates (instance) {
	return instance?.templates || [];
}

export function getEncounterHasTemplate (instance, key) {
	return getEncounterInstanceTemplates(instance).some(it => it.key === key);
}

/** Display chips for a creature: [{key, name, description}] (never shown on the effects timeline). */
export function getEncounterTemplateChips (instance) {
	return getEncounterInstanceTemplates(instance).map(it => ({
		key: it.key,
		name: it.name,
		description: getEncounterTemplate(it.key)?.description || it.description || "",
	}));
}

/** The summed tier delta (Elite +2 / Weak −2) for attack rolls, AC and save DCs. */
export function getEncounterTemplateDelta (instance) {
	return getEncounterInstanceTemplates(instance).reduce((sum, it) => sum + (getEncounterTemplate(it.key)?.delta || 0), 0);
}

/** Save DCs printed in the statblock should be raised/lowered by this much. */
export function getEncounterTemplateDcDelta (instance) {
	return getEncounterTemplateDelta(instance);
}

/** Roll-contributor provider: Elite/Weak adjust attack rolls and AC. */
export function getEncounterTemplateContributors (state, instance, query = {}) {
	const out = {bonuses: [], advantage: [], disadvantage: [], autoFail: [], autoCrit: [], notes: []};
	if (!["attack", "ac"].includes(query.kind)) return out;
	for (const template of getEncounterInstanceTemplates(instance)) {
		const catalogue = getEncounterTemplate(template.key);
		if (catalogue?.delta) out.bonuses.push({label: catalogue.name, value: catalogue.delta, source: `template:${template.key}`});
	}
	return out;
}

function getUniqueOperationId (instance, base, used) {
	const ids = new Set([...instance.statblockOperations.map(it => it.id), ...used]);
	let id = base;
	for (let n = 2; ids.has(id); ++n) id = `${base}:${n}`;
	used.add(id);
	return id;
}

/** Keep damage taken (and temp HP) when a template changes maximum HP. */
function withPreservedDamage (state, beforeById, changedIds) {
	if (!changedIds.length) return state;
	return EncounterWorkspaceState.validate({
		...state,
		instances: state.instances.map(instance => {
			const before = beforeById.get(instance.id);
			if (!changedIds.includes(instance.id) || !before || before.max == null || before.current == null || instance.hp.max == null) return instance;
			const damage = Math.max(0, before.max - before.current);
			return {...instance, hp: {...instance.hp, current: Math.max(0, instance.hp.max - damage), temp: before.temp}};
		}),
	});
}

function getRecordRemoval (instance, record) {
	const present = new Set(instance.statblockOperations.map(it => it.id));
	return (record.operationIds || []).filter(id => present.has(id));
}

function withoutAbilities (state, id, abilityIds = []) {
	const instance = state.instances.find(it => it.id === id);
	return abilityIds
		.filter(abilityId => instance.resources.abilities.some(it => it.id === abilityId))
		.reduce((next, abilityId) => EncounterWorkspaceState.withoutAbility(next, {id, abilityId}), state);
}

function withTemplateRecords (state, recordsById) {
	return EncounterWorkspaceState.validate({
		...state,
		instances: state.instances.map(instance => recordsById.has(instance.id) ? {...instance, templates: recordsById.get(instance.id)} : instance),
	});
}

function getSkipReason (instance, template) {
	if (instance.kind === "party") return "party members can't take creature templates";
	if (getEncounterHasTemplate(instance, template.key)) return `already ${template.name}`;
	const monster = getEncounterEffectiveMonster(instance);
	if (template.key === "minion") {
		const tags = Array.isArray(monster.type?.tags) ? monster.type.tags : [];
		if (instance.statblockOperations.some(it => it.type === "minion")
			|| tags.some(tag => `${tag?.tag ?? tag}`.toLowerCase() === "minion")
			|| (monster.trait || []).some(it => `${it?.name}`.toLowerCase() === "minion")) return "already a minion";
	}
	if (template.key === "legendary" && (monster.legendary?.length || instance.resources.abilities.some(it => it.id === "auto:legendary-actions"))) return "already legendary";
	if (template.hpMultiplier && !Number.isFinite(monster.hp?.average)) return "has no fixed hit points";
	return null;
}

/**
 * Remove templates (by key) from creatures, undoing exactly the operations and abilities each added.
 * Returns {state, removedIds, resetHpIds, splitIds}.
 */
export function withoutEncounterTemplate (state, {key, ids = state.selectedIds}) {
	const targets = state.instances.filter(it => ids.includes(it.id) && getEncounterHasTemplate(it, key));
	if (!targets.length) return {state, removedIds: [], resetHpIds: [], splitIds: []};
	const hpBefore = new Map(targets.map(it => [it.id, it.hp]));
	let next = state;
	for (const instance of targets) {
		const record = instance.templates.find(it => it.key === key);
		next = withoutAbilities(next, instance.id, record.abilityIds);
	}
	const changes = targets
		.map(instance => ({id: instance.id, addOperations: [], removeIds: getRecordRemoval(instance, instance.templates.find(it => it.key === key))}))
		.filter(it => it.removeIds.length);
	let resetHpIds = [];
	let splitIds = [];
	if (changes.length) {
		const result = EncounterWorkspaceState.withStatblockChanges(next, changes);
		({resetHpIds, splitIds} = result);
		next = withPreservedDamage(result.state, hpBefore, resetHpIds);
	}
	next = withTemplateRecords(next, new Map(targets.map(it => [it.id, next.instances.find(x => x.id === it.id).templates.filter(t => t.key !== key)])));
	return {state: next, removedIds: targets.map(it => it.id), resetHpIds, splitIds};
}

/**
 * Apply Elite / Weak / Minion / Legendary to creatures. A template that excludes another (Elite ↔ Weak ↔ Minion)
 * replaces it. Returns {state, appliedIds, replaced: [{id, key}], skipped: [{id, reason}], resetHpIds, splitIds}.
 */
export function withEncounterTemplate (state, {key, ids = state.selectedIds}) {
	const template = getEncounterTemplate(key);
	if (!template) throw new Error(`Unknown template: ${key}.`);
	const skipped = [];
	const replaced = [];
	let next = state;
	const eligible = [];
	for (const id of ids) {
		const instance = next.instances.find(it => it.id === id);
		if (!instance) { skipped.push({id, reason: "no longer in the encounter"}); continue; }
		const reason = getSkipReason(instance, template);
		if (reason) { skipped.push({id, reason}); continue; }
		eligible.push(id);
	}
	for (const excluded of template.excludes) {
		const holders = eligible.filter(id => getEncounterHasTemplate(next.instances.find(it => it.id === id), excluded));
		if (!holders.length) continue;
		next = withoutEncounterTemplate(next, {key: excluded, ids: holders}).state;
		holders.forEach(id => replaced.push({id, key: excluded}));
	}

	const records = new Map();
	let resetHpIds = [];
	let splitIds = [];
	const appliedIds = [];
	if (template.kind === "resources") {
		for (const id of eligible) {
			next = LEGENDARY_ABILITIES.reduce((acc, ability) => EncounterWorkspaceState.withAbility(acc, {id, ability}), next);
			records.set(id, {key, name: template.name, kind: template.kind, operationIds: [], abilityIds: LEGENDARY_ABILITIES.map(it => it.id)});
			appliedIds.push(id);
		}
	} else {
		const changes = [];
		for (const id of eligible) {
			const instance = next.instances.find(it => it.id === id);
			const used = new Set();
			let operation;
			if (template.kind === "tier") {
				const average = getEncounterEffectiveMonster(instance).hp.average;
				operation = BestiaryQuickActionsOperations.patch({set: {hp: {average: Math.max(1, Math.floor(average * template.hpMultiplier))}}});
			} else {
				operation = BestiaryQuickActionsOperations.minion();
			}
			operation = {...operation, id: getUniqueOperationId(instance, `template:${key}`, used)};
			try {
				EncounterWorkspaceState.withStatblockChanges(next, [{id, addOperations: [operation], removeIds: []}]);
			} catch (e) {
				skipped.push({id, reason: e.message});
				continue;
			}
			changes.push({id, addOperations: [operation], removeIds: []});
			records.set(id, {key, name: template.name, kind: template.kind, operationIds: [operation.id], abilityIds: []});
			appliedIds.push(id);
		}
		if (changes.length) {
			const hpBefore = new Map(next.instances.map(it => [it.id, it.hp]));
			const result = EncounterWorkspaceState.withStatblockChanges(next, changes);
			({resetHpIds, splitIds} = result);
			next = withPreservedDamage(result.state, hpBefore, resetHpIds);
		}
	}
	next = withTemplateRecords(next, new Map([...records].map(([id, record]) => [id, [...next.instances.find(it => it.id === id).templates, record]])));
	return {state: next, appliedIds, replaced, skipped, resetHpIds, splitIds};
}

/* ----- Creature-type templates (creature-transformation catalogue) ----- */

/** The catalogue as template options: [{key, catalogId, name, source, edition, prerequisites, optionGroups}]. */
export function getEncounterCreatureTypeTemplateOptions ({catalog, races = []}) {
	return getCreatureTransformationCandidates({catalog, races}).map(candidate => ({
		key: getEncounterCreatureTypeTemplateKey(candidate.id),
		catalogId: candidate.id,
		name: candidate.identity?.name || candidate.name,
		source: candidate.identity?.source || candidate.source,
		edition: candidate.provenance?.edition || null,
		prerequisites: candidate.prerequisites,
		optionGroups: candidate.optionGroups.map(group => ({id: group.id, selection: group.selection, options: group.options.map(it => ({id: it.id, name: it.name || it.id}))})),
	}));
}

/** Targets in the shape the transformation workflow/editor expects. */
export function getEncounterTransformationTargets (state, ids = state.selectedIds) {
	const labels = new Map(state.instances.map((it, ix) => [it.id, it.label || `${it.monster.name} (${ix + 1})`]));
	return state.instances.filter(it => ids.includes(it.id) && it.kind !== "party").map(it => ({
		id: it.id,
		label: labels.get(it.id),
		baseCreature: it.monster,
		operations: it.statblockOperations,
	}));
}

/**
 * Preview a creature-type template headlessly. Templates whose automation needs guided inputs report them in
 * `batch.skipped`; those must go through the transformation editor, whose `pApply(changes)` feeds
 * `withEncounterCreatureTypeTemplate`. Returns {key, name, resolved, batch}.
 */
export function previewEncounterCreatureTypeTemplate (state, {catalog, races = [], catalogId, ids = state.selectedIds, selections = {}, automationVersion = 2, automationInputs = {}, conflictDecisions = {}}) {
	const candidates = getCreatureTransformationCandidates({catalog, races});
	const resolved = resolveCreatureTransformation({candidates, id: catalogId, selections, automationVersion});
	const batch = previewCreatureTransformationTargets({
		targets: getEncounterTransformationTargets(state, ids),
		resolved,
		automationInputs,
		conflictDecisions,
		acknowledgedPrerequisites: resolved.prerequisites,
		dmApproved: true,
	});
	const candidate = candidates.find(it => it.id === catalogId);
	return {key: getEncounterCreatureTypeTemplateKey(catalogId), name: candidate?.identity?.name || catalogId, resolved, batch};
}

/**
 * Commit a creature-type template. Pass either `changes` ([{id, addOperations, removeIds?, replaceOperation?}] — the
 * transformation editor's pApply payload) or a previewed `batch`. Operation ids are assigned here and recorded in the
 * template so removal undoes them. Returns {state, appliedIds, resetHpIds, splitIds}.
 */
export function withEncounterCreatureTypeTemplate (state, {catalogId, name, changes = null, batch = null, conflictDecisions = {}}) {
	const key = getEncounterCreatureTypeTemplateKey(catalogId);
	const pending = changes || createCreatureTransformationChanges({batch, targets: batch.targets, conflictDecisions});
	if (!pending.length) throw new Error("This template didn't apply to any of the chosen creatures.");
	const records = new Map();
	const resolved = pending.map(change => {
		const instance = state.instances.find(it => it.id === change.id);
		if (!instance) throw new Error("A template target no longer exists.");
		if (getEncounterHasTemplate(instance, key)) throw new Error(`${instance.monster.name} already has the ${name} template.`);
		const used = new Set();
		const addOperations = change.addOperations.map(operation => ({...operation, id: getUniqueOperationId(instance, key, used)}));
		records.set(instance.id, {key, name, kind: "creatureType", catalogId, operationIds: addOperations.map(it => it.id), abilityIds: []});
		return {...change, removeIds: change.removeIds || [], addOperations};
	});
	const hpBefore = new Map(state.instances.map(it => [it.id, it.hp]));
	const result = EncounterWorkspaceState.withStatblockChanges(state, resolved);
	let next = withPreservedDamage(result.state, hpBefore, result.resetHpIds);
	next = withTemplateRecords(next, new Map([...records].map(([id, record]) => [id, [...next.instances.find(it => it.id === id).templates, record]])));
	return {state: next, appliedIds: [...records.keys()], resetHpIds: result.resetHpIds, splitIds: result.splitIds};
}
