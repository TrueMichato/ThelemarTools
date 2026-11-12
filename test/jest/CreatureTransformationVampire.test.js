import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {selectFrozenCreatureTransformation} from "../../js/creature-transformation-forms.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsOperations, BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationChanges, createCreatureTransformationFormChanges, previewCreatureTransformationForm, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationSchemaErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const schema = read("schema/site/creature-transformation.json");
const validateForm = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/frozenFormResolved"});
const validateLeaf = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledVampire"});
const resolve = (outcome = "vampire", automationVersion = 2, data = catalog) => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog: data, races: []}), id: "catalog:vampire|mm", selections: {outcome: [outcome]}, automationVersion,
});
const source = name => structuredClone(mm.find(monster => monster.name === name && monster.source === "MM"));
const scout = () => ({...source("Scout"),
	speed: {walk: 30, fly: 50, swim: 15, climb: 12, canHover: false, alternate: {walk: [{number: 40, condition: "while hurrying"}], fly: [60], swim: [20]}},
	languages: ["Common", "Elvish", "telepathy 30 ft."],
	gear: [{item: "longbow|phb", quantity: 1}],
	save: {dex: "+4", con: "+3"},
	resist: ["fire"],
	immune: ["poison"],
	spellcasting: [{name: "Innate Spellcasting", type: "spellcasting", ability: "wis", headerEntries: ["Requires verbal components; spell save {@dc 11}."], will: ["{@spell guidance|PHB}"]}],
});
const target = (baseCreature, operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const retain = (name, section = "action", source = "MM") => ({section, match: {name, source}, mode: "retain"});
const binding = (name, faces) => ({section: "action",
	match: {name, source: "MM"},
	mode: "bind",
	numbers: [
		{paragraph: 0, token: 0, kind: "hit", mode: "ability", ability: "dex", proficiency: 1, fixed: 0},
		{paragraph: 0, token: 0, kind: "damage", mode: "ability", ability: "dex", proficiency: 0, fixed: 0, dice: {number: 1, faces}},
	]});
const decisions = current => ({
	vampire: {adaptation: "sidebar-npc",
		grappleDc: 14,
		legendaryResistance: {mode: "grant"},
		batEntries: ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"].flatMap(section => (current[section] || []).map(entry => ({
			section,
			match: {name: entry.name, source: entry.source || current.source},
			requiresSpeech: section === "spellcasting",
			carriedEquipment: section === "action" ? "unusable" : "not-required",
		})))},
	bindings: {proficiencyBonus: 2,
		armor: {mode: "recalculate", alternatives: [{kind: "worn", base: 11, dexterity: "full", shield: 0, fixed: 0}]},
		entries: [binding("Shortsword", 6), binding("Longbow", 8), ...current.spellcasting ? [retain("Innate Spellcasting", "spellcasting")] : []]},
});
const spawnDecisions = current => ({vampire: {adaptation: "sidebar-npc", grappleDc: 14}, bindings: decisions(current).bindings});
function preview (subject, inputs = decisions(BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: subject.operations})), options = {}) {
	const resolved = options.resolved ?? resolve();
	return previewCreatureTransformationTargets({targets: [subject], resolved, automationInputs: {[subject.id]: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...options});
}
function outcome (batch) {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
}
function operation (batch, id = "vampire-owner", conflictDecisions) {
	const changes = createCreatureTransformationChanges({batch, targets: batch.targets, ...conflictDecisions ? {conflictDecisions} : {}});
	return {...changes[0].addOperations[0], id};
}
function switchForm (subject, formId, options = {}) {
	const batch = previewCreatureTransformationForm({target: subject, operationId: "vampire-owner", formId, ...options});
	return {batch, changes: createCreatureTransformationFormChanges({batch, target: subject})};
}
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
function priorTransformation (baseCreature) {
	const resolved = {id: "catalog:prior|tst",
		kind: "catalog",
		identity: {name: "Prior", source: "TST"},
		provenance: {edition: "classic"},
		eligibility: [],
		prerequisites: [],
		selectedOptions: {},
		changes: [{type: "setAbility", ability: "con", value: 14}, {type: "grantSense", sense: "darkvision", range: 30}],
		manualReview: []};
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature, resolved});
	return {id: "prefix", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature, preview})};
}
const rule = (creature, name, section = "trait") => creature[section]?.find(entry => entry.name === name);
async function encounter (baseCreature) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M8", saveId: "m8", items: [{h: "scout_mm", c: 2}]},
		pResolveItem: async () => ({entity: baseCreature}),
		fnUid: () => ++ix === 1 ? "one" : "two",
	});
}
function persistence (initial) {
	let state = initial;
	const values = new Map();
	const storage = {pGetForPage: jest.fn(async key => values.get(key)), pSetForPage: jest.fn(async (key, value) => values.set(key, JSON.parse(JSON.stringify(value))))};
	const store = new EncounterWorkspaceStore({storage});
	const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async result => { state = await store.pSave(result.state); }});
	return {adapter, store, storage, state: () => state, reload: async () => { state = await store.pLoad(); }};
}
const flatten = value => !value || typeof value !== "object" ? [] : [value, ...Object.values(value).flatMap(flatten)];
const compiled = (base, outcome = "vampire") => compileCreatureTransformation({
	resolved: resolve(outcome),
	current: base,
	inputs: outcome === "spawn" ? spawnDecisions(base) : decisions(base),
	baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base}),
});
function replayCompiled (base, raw, formId) {
	const selected = formId ? selectFrozenCreatureTransformation({resolved: raw, formId}) : raw;
	const resolved = normalizeCreatureTransformation(selected);
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
	expect(preview.canApply).toBe(true);
	const operation = BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview});
	const registry = new BestiaryQuickActionsRegistry();
	registry.addOperation({creature: base, operation});
	const reloaded = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify([operation]))});
	expect(registry.getCreature({creature: base})).toEqual(reloaded);
	return reloaded;
}

describe("M8 source-defined Vampire|MM NPC adaptation", () => {
	it("admits normal closed source snapshots through selection, normalization, preview, operation creation, Registry and JSON replay", () => {
		const base = scout();
		const full = compiled(base);
		for (const formId of ["true", "bat", "mist"]) {
			const out = replayCompiled(base, full, formId);
			expect([out.str, out.dex, out.con]).toEqual([18, 18, 18]);
			expect(out.hp).toEqual({average: 25, formula: "3d8 + 12"});
			expect(out.spellcasting).toEqual(formId === "true" ? base.spellcasting : []);
			if (formId === "mist") expect(out.action).toEqual([]);
		}
		expect(replayCompiled(base, compiled(base, "spawn"))).toMatchObject({str: 18, dex: 18, con: 18, alignment: ["L", "E"]});
	});

	it.each(["true-extra-spell-removal", "bat-missing-declared-spell-removal"])("rejects closed source removal contradiction %s in active and inactive profiles", kind => {
		const base = scout();
		const full = compiled(base);
		if (kind === "true-extra-spell-removal") {
			const leaf = full.frozenForms.profiles[0].resolved;
			leaf.changes.push({op: "removeVampireSpellcasting", match: {name: "Innate Spellcasting", source: "MM"}});
			full.changes = structuredClone(leaf.changes);
		} else {
			const leaf = full.frozenForms.profiles[1].resolved;
			leaf.changes = leaf.changes.filter(step => step.op !== "removeVampireSpellcasting");
		}
		for (const formId of ["true", "bat"]) expect(() => replayCompiled(base, full, formId)).toThrow();
	});

	it.each(["action", "bonus", "reaction", "legendary", "spellcasting"])("rejects closed source mist snapshots missing a required %s removal even while inactive", section => {
		const base = scout();
		for (const field of ["bonus", "reaction", "legendary"]) base[field] = [{name: `Existing ${field}`, source: "TST", entries: ["Move 5 feet."]}];
		const full = compiled(base);
		const mist = full.frozenForms.profiles[2].resolved;
		const name = section === "action" ? "Longbow" : section === "spellcasting" ? "Innate Spellcasting" : `Existing ${section}`;
		mist.changes = mist.changes.filter(step => !((step.op === "removeVampireSpellcasting" ? "spellcasting" : step.op === "removeEntry" ? step.section : null) === section && step.match.name === name));
		for (const formId of ["true", "mist"]) expect(() => replayCompiled(base, full, formId)).toThrow();
	});

	it.each(["spawn", "true", "bat", "mist"])("rejects closed source %s snapshots whose declared physical policy has no concrete setters", form => {
		const base = scout();
		const raw = compiled(base, form === "spawn" ? "spawn" : "vampire");
		const leaf = form === "spawn" ? raw : raw.frozenForms.profiles.find(profile => profile.id === form).resolved;
		leaf.changes = leaf.changes.filter(step => step.op !== "setAbility");
		if (form === "true") raw.changes = structuredClone(leaf.changes);
		for (const formId of form === "spawn" ? [null] : ["true", form]) expect(() => replayCompiled(base, raw, formId)).toThrow();
	});

	it.each(["vampire", "spawn"])("rejects closed source %s projections that lower already-higher target scores to a self-consistent declared minimum", outcome => {
		const base = scout();
		const higher = {...base, str: 24, dex: 22, con: 20};
		const raw = compiled(base, outcome);
		if (raw.frozenForms) raw.frozenForms.baseline = BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: higher});
		expect(() => replayCompiled(higher, raw, outcome === "vampire" ? "true" : null)).toThrow();
	});

	it("anchors the actual MM sidebar, distinct monster rules, forms and creator/resting-place clauses", () => {
		const sidebar = read("data/variantrules.json").variantrule.find(entry => entry.name === "Player Characters as Vampires" && entry.source === "MM");
		expect(sidebar.page).toBe(295);
		expect(sidebar.entries[0]).toMatch(/Strength, Dexterity, and Constitution scores become 18 if they aren't higher/);
		expect(sidebar.entries[0]).toMatch(/8 \+ the vampire's proficiency bonus \+ the vampire's Charisma modifier/);
		const vampire = source("Vampire");
		const spawn = source("Vampire Spawn");
		expect(vampire.page).toBe(297);
		expect(spawn.page).toBe(298);
		expect(rule(vampire, "Legendary Resistance (3/Day)")).toBeDefined();
		expect(rule(vampire, "Shapechanger").entries[1]).toMatch(/wearing transforms with it, but nothing it is carrying does/);
		expect(rule(vampire, "Shapechanger").entries[2]).toMatch(/immune to all nonmagical damage, except/);
		expect(rule(spawn, "Regeneration").entries[0]).toMatch(/regains 10 hit points/);
		expect(rule(spawn, "Vampire Weaknesses").entries[1].items[2].entry).toMatch(/destroyed/);
		expect(rule(vampire, "Vampire Weaknesses").entries[1].items[2].entry).toMatch(/until the stake is removed/);
		const fluff = flatten(read("data/bestiary/fluff-bestiary-mm.json")).find(entry => entry.name === "Born from Death");
		expect(fluff.entries[0]).toMatch(/free-willed when their creator dies/);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});

	it("executes source-granted physical minima, CON once, actual PB/STR attacks and CHA Charm without donor chassis statistics", () => {
		const base = scout();
		const batch = preview(target(base));
		const out = outcome(batch);
		expect(out).toMatchObject({
			name: "Scout",
			source: "MM",
			type: {type: "undead", tags: ["any race", "shapechanger"]},
			alignment: ["L", "E"],
			str: 18,
			dex: 18,
			con: 18,
			int: 11,
			wis: 13,
			cha: 11,
			hp: {average: 25, formula: "3d8 + 12"},
			ac: [{ac: 15, from: base.ac[0].from}],
			save: {dex: "+6", con: "+6"},
			skill: {nature: "+4", perception: "+5", stealth: "+8", survival: "+5"},
			passive: 15,
		});
		expect(rule(out, "Unarmed Strike (Vampire Form Only)", "action").entries[0]).toContain("{@hit 6}");
		expect(rule(out, "Unarmed Strike (Vampire Form Only)", "action").entries[0]).toContain("8 ({@damage 1d8 + 4})");
		expect(rule(out, "Unarmed Strike (Vampire Form Only)", "action").entries[0]).toContain("{@dc 14}");
		expect(rule(out, "Bite (Bat or Vampire Form Only)", "action").entries[0]).toContain("7 ({@damage 1d6 + 4}) piercing damage plus 10 ({@damage 3d6}) necrotic");
		expect(rule(out, "Charm", "action").entries[0]).toContain("{@dc 10}");
		expect(rule(out, "Regeneration").entries[0]).toContain("20 hit points");
		expect(rule(out, "Legendary Resistance (3/Day)")).toBeDefined();
		expect(out.senses).toEqual(["darkvision 120 ft."]);
		expect(out.resist).toContain("fire");
		expect(out.resist).toContain("necrotic");
		for (const type of ["bludgeoning", "piercing", "slashing"]) expect(out.resist).toContainEqual({resist: [type], note: "from nonmagical attacks"});
		for (const field of ["gear", "attachedItems", "size", "speed", "languages", "cr", "profBonus", "pbNote", "legendary", "legendaryGroup", "spellcasting"]) expect(out[field]).toEqual(base[field]);
		expect(rule(out, "Shortsword", "action").entries[0]).toContain("7 ({@damage 1d6 + 4})");
		expect(out.action[0]).toEqual(base.action[0]);
		const raw = compileCreatureTransformation({resolved: resolve(), current: base, inputs: decisions(base), baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base})});
		expect(validateForm(raw)).toBe(true);
		expect(validateForm.errors).toBeNull();
		for (const profile of raw.frozenForms.profiles) expect(validateLeaf(profile.resolved)).toBe(true);
		expect(normalizeCreatureTransformation(raw)).toEqual(batch.previews[0].preview.resolved);
		expect(batch.previews[0].preview.manualReview.map(review => review.field)).toEqual(["cr"]);
	});

	it("executes the approved spawn physical minima and lawful evil, not the example's 16/neutral-evil chassis", () => {
		const base = scout();
		const inputs = spawnDecisions(base);
		const batch = preview(target(base), inputs, {resolved: resolve("spawn")});
		const out = outcome(batch);
		expect(out).toMatchObject({
			name: "Scout",
			source: "MM",
			type: {type: "undead", tags: ["any race"]},
			alignment: ["L", "E"],
			str: 18,
			dex: 18,
			con: 18,
			int: 11,
			wis: 13,
			cha: 11,
			hp: {average: 25, formula: "3d8 + 12"},
			ac: [{ac: 15, from: base.ac[0].from}],
			save: {dex: "+6", con: "+6"},
			skill: {nature: "+4", perception: "+5", stealth: "+8", survival: "+5"},
			passive: 15,
		});
		expect(source("Vampire Spawn")).toMatchObject({str: 16, dex: 16, con: 16, alignment: ["N", "E"]});
		expect(rule(out, "Claws", "action").entries[0]).toContain("{@hit 6}");
		expect(rule(out, "Claws", "action").entries[0]).toContain("9 ({@damage 2d4 + 4}) slashing");
		expect(rule(out, "Claws", "action").entries[0]).toContain("{@dc 14}");
		expect(rule(out, "Shortsword", "action").entries[0]).toContain("7 ({@damage 1d6 + 4})");
		expect(out.senses).toEqual(["darkvision 60 ft."]);
		expect(rule(out, "NPC Vampirism Adaptation").entries.join(" ")).toContain("authored extension");
		for (const field of ["gear", "attachedItems", "size", "speed", "languages", "cr", "profBonus", "pbNote", "spellcasting"]) expect(out[field]).toEqual(base[field]);
		const raw = compileCreatureTransformation({resolved: resolve("spawn"), current: base, inputs});
		expect(raw).not.toHaveProperty("frozenForms");
		expect(validateLeaf(raw)).toBe(true);
		expect(validateLeaf.errors).toBeNull();
		expect(normalizeCreatureTransformation(raw)).toEqual(batch.previews[0].preview.resolved);
		expect(batch.previews[0].preview.manualReview.map(review => review.field)).toEqual(["cr"]);
	});

	it("keeps the spawn outcome's exact rules and never newly grants full-vampire features or forms", () => {
		const base = scout();
		const batch = preview(target(base), spawnDecisions(base), {resolved: resolve("spawn")});
		const out = outcome(batch);
		expect(rule(out, "Regeneration").entries[0]).toContain("10 hit points");
		for (const fragment of ["at least 1", "sunlight", "running water", "Radiant", "holy water", "next turn"]) expect(rule(out, "Regeneration").entries[0]).toContain(fragment);
		const weaknesses = rule(out, "Vampire Weaknesses").entries.join(" ");
		for (const fragment of ["occupant", "20 acid", "ends its turn", "incapacitated", "resting place", "destroys it", "20 radiant", "disadvantage"]) expect(weaknesses).toContain(fragment);
		expect(weaknesses).not.toContain("until the stake is removed");
		const bite = rule(out, "Bite", "action").entries[0];
		expect(bite).toContain("7 ({@damage 1d6 + 4}) piercing damage plus 7 ({@damage 2d6}) necrotic");
		for (const fragment of ["willing", "it has {@condition grappled}", "incapacitated", "restrained", "actually taken", "long rest", "maximum reduced to 0"]) expect(bite).toContain(fragment);
		expect(bite).not.toMatch(/buried|next night|rises/);
		const creator = rule(out, "Creator's Control").entries[0];
		for (const fragment of ["controls this spawn", "death frees its will", "does not make it a true vampire", "voluntarily", "blood", "not a switchable form"]) expect(creator).toContain(fragment);
		expect(rule(out, "Vampiric Multiattack", "action").entries[0]).toContain("at most one");
		for (const name of ["Shapechanger", "Misty Escape", "Legendary Resistance (3/Day)", "Mist Form", "Bat Equipment and Speech"]) expect(rule(out, name)).toBeUndefined();
		for (const name of ["Charm", "Children of the Night (1/Day)", "Unarmed Strike (Vampire Form Only)", "Bite (Bat or Vampire Form Only)"]) expect(rule(out, name, "action")).toBeUndefined();
		expect(out.immune).toEqual(base.immune);
		expect(out.resist).toContain("necrotic");
		for (const type of ["bludgeoning", "piercing", "slashing"]) expect(out.resist).toContainEqual({resist: [type], note: "from nonmagical attacks"});
		const owner = operation(batch);
		for (const form of ["true", "bat", "mist", "vampire"]) expect(() => switchForm(target(base, [owner]), form)).toThrow();
	});

	it("preserves higher spawn scores, HP residuals, stronger senses and existing legendary/lair/mythic capabilities", () => {
		const base = scout();
		Object.assign(base, {str: 24, dex: 20, con: 22, hp: {average: 79, formula: "7d8 + 48"}, senses: ["darkvision 180 ft.", "blindsight 10 ft."]});
		base.trait.push({name: "Legendary Resistance (1/Day)", source: "TST", entries: ["After failing a saving throw, it may succeed instead."]});
		base.legendary = [{name: "Retained Move", source: "TST", entries: ["Move 5 feet."]}];
		base.legendaryGroup = {name: "Existing lair", source: "TST"};
		base.mythic = [{name: "Existing mythic", source: "TST", entries: ["Retained source rules."]}];
		const inputs = spawnDecisions(base);
		inputs.bindings.proficiencyBonus = 4;
		inputs.bindings.armor = {mode: "retain"};
		inputs.bindings.entries = inputs.bindings.entries.map(({section, match}) => ({section, match, mode: "retain"}));
		const out = outcome(preview(target(base), inputs, {resolved: resolve("spawn")}));
		for (const field of ["str", "dex", "con", "hp", "senses", "gear", "speed", "size", "languages", "legendary", "legendaryGroup", "mythic", "spellcasting", "cr"]) expect(out[field]).toEqual(base[field]);
		expect(rule(out, "Claws", "action").entries[0]).toContain("{@hit 11}");
		expect(rule(out, "Claws", "action").entries[0]).toContain("12 ({@damage 2d4 + 7})");
		expect(rule(out, "Bite", "action").entries[0]).toContain("10 ({@damage 1d6 + 7})");
		expect(out.trait.filter(entry => /^Legendary Resistance/.test(entry.name))).toEqual([base.trait[1]]);
	});

	it("persists spawn through actual Registry and Encounter Store with prior owners, coherent conflicts, isolation and removal", async () => {
		const base = scout();
		const prefix = priorTransformation(base);
		const renamed = patch("renamed", {name: "Renamed spawn target", hp: {average: 19, formula: "3d8 + 6"}});
		const subject = target(base, [prefix, renamed]);
		const inputs = spawnDecisions(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: subject.operations}));
		const unresolved = preview(subject, inputs, {resolved: resolve("spawn")});
		expect(unresolved.previews[0].preview.canApply).toBe(false);
		const winners = Object.fromEntries(unresolved.previews[0].preview.conflicts.map(conflict => [conflict.path, "incoming"]));
		const batch = preview(subject, inputs, {resolved: resolve("spawn"), conflictDecisions: {one: winners}});
		const retained = Object.fromEntries(Object.keys(winners).map(key => [key, "existing"]));
		expect(outcome(preview(subject, inputs, {resolved: resolve("spawn"), conflictDecisions: {one: retained}}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: subject.operations}));
		const mixed = preview(subject, inputs, {resolved: resolve("spawn"), conflictDecisions: {one: {...winners, con: "existing"}}});
		expect(mixed.previews).toEqual([]);
		expect(mixed.skipped[0].reason).toMatch(/one conflict winner/);
		const owner = operation(batch, "vampire-owner", {one: winners});
		const suffix = patch("suffix", {wis: 19});
		expect(owner.data.resolved).not.toHaveProperty("frozenForms");
		expect(owner.data.dmApproved).toBe(true);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, renamed, JSON.parse(JSON.stringify(owner)), suffix]});
		expect(registry.getCreature({creature: base})).toMatchObject({name: "Renamed spawn target", str: 18, con: 18, wis: 19, hp: {average: 25, formula: "3d8 + 12"}});
		expect(registry.getOperations({creature: base}).map(item => item.id)).toEqual(["prefix", "renamed", "vampire-owner", "suffix"]);
		expect(JSON.stringify(registry.getOperations({creature: base})[3])).toBe(JSON.stringify(suffix));
		const originalCatalog = catalog.creatureTransformation;
		catalog.creatureTransformation = [];
		try {
			expect(rule(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify([prefix, renamed, owner]))}), "Regeneration").entries[0]).toContain("10 hit points");
		} finally { catalog.creatureTransformation = originalCatalog; }
		let initial = await encounter(base);
		initial = EncounterWorkspaceState.withHp(initial, {id: "one", prop: "temp", value: 3});
		initial = EncounterWorkspaceState.withStatblockChanges(initial, [{id: "one", addOperations: [prefix, renamed], removeIds: []}]).state;
		const saved = persistence(initial);
		await saved.adapter.addOperation({operation: JSON.parse(JSON.stringify(owner))});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual(outcome(batch));
		expect(saved.state().instances[0].hp).toEqual({current: 25, max: 25, temp: 3});
		expect(saved.state().instances[1].monster).toEqual(base);
		const calls = saved.storage.pSetForPage.mock.calls.length;
		await expect(saved.adapter.applyChanges({replaceOperation: {operationId: owner.id, expectedIntegrity: owner.data.integrity, operation: saved.adapter.getOperations()[2]}})).rejects.toThrow(/frozen transformation forms/i);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(calls);
		await saved.adapter.removeOperation({operationId: owner.id});
		await saved.reload();
		expect(saved.adapter.getOperations()).toEqual([prefix, renamed]);
		expect(saved.adapter.getCreature()).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, renamed]}));
		expect(saved.state().instances[0].hp).toEqual({current: 19, max: 19, temp: 3});
		registry.removeOperation({creature: base, operationId: owner.id});
		expect(registry.getCreature({creature: base})).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, renamed, suffix]}));
	});

	it("keeps spawn storage failures atomic and rejects stale answers, source, outcome and form injection", async () => {
		const base = scout();
		const resolved = resolve("spawn");
		const inputs = spawnDecisions(base);
		const batch = preview(target(base), inputs, {resolved});
		const owner = operation(batch);
		const saved = persistence(await encounter(base));
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		const before = saved.state();
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("Spawn save failed"));
		await expect(saved.adapter.addOperation({operation: owner})).rejects.toThrow("Spawn save failed");
		expect(saved.state()).toBe(before);
		expect(saved.adapter.getOperations()).toEqual([]);
		expect(notify).not.toHaveBeenCalled();
		await saved.adapter.addOperation({operation: owner});
		await saved.reload();
		const loaded = saved.state();
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("Spawn removal failed"));
		await expect(saved.adapter.removeOperation({operationId: owner.id})).rejects.toThrow("Spawn removal failed");
		expect(saved.state()).toBe(loaded);
		expect(saved.adapter.getOperations()).toHaveLength(1);
		expect(notify).toHaveBeenCalledTimes(1);
		const changedAnswers = structuredClone(batch.automationInputs);
		changedAnswers.one.vampire.grappleDc++;
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, automationInputs: changedAnswers})).toThrow(/input answers changed/);
		expect(() => createCreatureTransformationChanges({batch, targets: [target(base, [patch("changed", {name: "Changed"})])]})).toThrow(/stale/);
		expect(preview(target(base), inputs, {resolved, dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(base), inputs, {resolved, acknowledgedPrerequisites: []})).toThrow(/prerequisite/i);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "XMM"}, operations: [owner]})).toThrow();
		for (const mutate of [
			value => { value.selectedOptions.outcome = ["vampire"]; },
			value => { value.selectedOptions["automation-vampire-legendary"] = ["grant"]; },
			value => { value.selectedOptions["automation-vampire-bat"] = ["action:Shortsword|MM"]; },
			value => { value.changes.push({type: "grantVampireMistImmunity"}); },
		]) {
			const bad = structuredClone(owner);
			mutate(bad.data.resolved);
			expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [bad]})).toThrow();
			expect(() => normalizeCreatureTransformation(bad.data.resolved)).toThrow();
		}
		const raw = compileCreatureTransformation({resolved, current: base, inputs});
		const bad = {...raw, changes: [...raw.changes, {op: "grantVampireMistImmunity"}]};
		expect(validateLeaf(bad)).toBe(false);
		const full = operation(preview(target(base)));
		const fakeForms = {...owner.data.resolved, frozenForms: full.data.resolved.frozenForms};
		expect(() => normalizeCreatureTransformation(fakeForms)).toThrow();
		const fullRaw = compileCreatureTransformation({resolved: resolve(), current: base, inputs: decisions(base), baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base})});
		expect(validateForm({...raw, frozenForms: fullRaw.frozenForms})).toBe(false);
		await saved.adapter.removeOperation({operationId: owner.id});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual(base);
	});

	it("rejects spawn's unanswered, duplicate, wrong-source and inapplicable full-only choices without partial output", () => {
		const base = scout();
		const resolved = resolve("spawn");
		for (const mutate of [
			input => { input.vampire.grappleDc = undefined; },
			input => { input.vampire.adaptation = "example-spawn"; },
			input => { input.vampire.batEntries = []; },
			input => { input.vampire.legendaryResistance = {mode: "grant"}; },
			input => { input.vampire.forms = ["true", "bat", "mist"]; },
			input => { input.bindings.entries[0].match.source = "XMM"; },
			input => { input.bindings.entries.push(structuredClone(input.bindings.entries[0])); },
			input => { input.bindings.proficiencyBonus = undefined; },
			input => { input.hp = {mode: "retain"}; },
		]) {
			const inputs = spawnDecisions(base);
			mutate(inputs);
			const batch = preview(target(base), inputs, {resolved});
			expect(batch.previews).toEqual([]);
			expect(batch.skipped).toHaveLength(1);
		}
		const collision = scout();
		collision.trait.push({name: "Regeneration", source: "TST", entries: ["Old regeneration."]});
		const inputs = spawnDecisions(collision);
		expect(preview(target(collision), inputs, {resolved}).skipped[0].reason).toMatch(/replaceFeatures/);
		inputs.vampire.replaceFeatures = [{section: "trait", match: {name: "Regeneration", source: "TST"}}];
		expect(outcome(preview(target(collision), inputs, {resolved})).trait.filter(entry => entry.name === "Regeneration")).toEqual([{name: "Regeneration", source: "MM", entries: [expect.stringContaining("10 hit points")]}]);
		inputs.vampire.replaceFeatures[0].match.source = "MM";
		expect(preview(target(collision), inputs, {resolved}).previews).toEqual([]);
		inputs.vampire.replaceFeatures[0].match.source = "TST";
		inputs.vampire.replaceFeatures.push(structuredClone(inputs.vampire.replaceFeatures[0]));
		expect(preview(target(collision), inputs, {resolved}).previews).toEqual([]);
		expect(preview(target({...base, type: "undead"}), spawnDecisions(base), {resolved}).skipped[0].reason).toMatch(/humanoid/);
	});

	it("retains complete conditional combat/death/creator mechanics as usable rules, not a live engine", () => {
		const out = outcome(preview(target(scout())));
		const bite = rule(out, "Bite (Bat or Vampire Form Only)", "action").entries.join(" ");
		for (const fragment of ["willing", "{@condition grappled}", "{@condition incapacitated}", "{@condition restrained}", "actually taken", "long rest", "maximum reduced to 0", "humanoid", "buried in the ground", "next night", "controlled"]) expect(bite).toContain(fragment);
		const charm = rule(out, "Charm", "action").entries.join(" ");
		for (const fragment of ["humanoid", "30 feet", "also see", "not controlled", "companions", "24 hours", "plane", "bonus action"]) expect(charm).toContain(fragment);
		const escape = rule(out, "Misty Escape").entries.join(" ");
		for (const fragment of ["0 hit points", "outside its resting place", "sunlight", "running water", "2 hours", "{@condition paralyzed}", "1 hour", "regains 1"]) expect(escape).toContain(fragment);
		const children = rule(out, "Children of the Night (1/Day)", "action").entries.join(" ");
		for (const fragment of ["sun is down", "{@dice 2d4}", "outdoors", "{@dice 3d6}", "{@dice 1d4}", "spoken commands", "1 hour", "bonus-action"]) expect(children).toContain(fragment);
		expect(rule(out, "Undead Nature").entries.join(" ")).not.toMatch(/food|drink|sleep/);
		expect(rule(out, "Spider Climb").entries[0]).toContain("does not grant a separate climbing speed");
	});

	it("retains higher scores, strong senses, HP residuals and unspecified zero movement instead of importing the example chassis", () => {
		const base = {name: "Veteran target",
			source: "TST",
			size: ["L"],
			type: "humanoid",
			alignment: ["C", "G"],
			cr: {cr: "7", xp: 0},
			str: 24,
			dex: 20,
			con: 22,
			int: 19,
			wis: 17,
			cha: 18,
			ac: [16],
			hp: {average: 79, formula: "7d8 + 48"},
			speed: {walk: 0, burrow: {number: 0, condition: "while restrained"}, swim: 25},
			senses: ["darkvision 180 ft.", "tremorsense 10 ft."],
			gear: [{item: "plate armor|phb", quantity: 1}],
			languages: ["Common"]};
		const inputs = {vampire: {adaptation: "sidebar-npc", grappleDc: 19, legendaryResistance: {mode: "grant"}, batEntries: []},
			bindings: {proficiencyBonus: 4, armor: {mode: "retain"}, entries: []}};
		const batch = preview(target(base), inputs);
		const out = outcome(batch);
		for (const field of ["str", "dex", "con", "int", "wis", "cha", "hp", "ac", "gear", "cr", "senses", "speed", "size"]) expect(out[field]).toEqual(base[field]);
		expect(rule(out, "Bite (Bat or Vampire Form Only)", "action").entries[0]).toContain("{@hit 11}");
		expect(rule(out, "Bite (Bat or Vampire Form Only)", "action").entries[0]).toContain("10 ({@damage 1d6 + 7})");
		expect(rule(out, "Charm", "action").entries[0]).toContain("{@dc 16}");
		const raw = compileCreatureTransformation({resolved: resolve(), current: base, inputs, baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base})});
		expect(validateForm(raw)).toBe(true);
		const mist = switchForm(target(base, [operation(batch)]), "mist").batch.proposed;
		expect(mist.speed).toEqual({walk: 0, burrow: {number: 0, condition: "while restrained"}, swim: 25, fly: 20, canHover: true});
		expect(mist.hp).toEqual({average: 79, formula: "7d8 + 48"});
	});

	it("produces only actual true/bat/mist forms and switches them through Registry without stacking, gear loss or suffix rewrites", () => {
		const base = scout();
		const prefix = patch("prefix", {name: "Renamed scout", str: 20});
		const subject = target(base, [prefix]);
		const first = preview(subject);
		expect(first.previews[0].preview.conflicts).toEqual([]);
		const owner = operation(first);
		const suffix = patch("suffix", {wis: 19});
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, owner, suffix]});
		const original = registry.getCreature({creature: base});
		expect(original.str).toBe(20);
		expect(rule(original, "Bite (Bat or Vampire Form Only)", "action").entries[0]).toContain("{@hit 7}");
		expect(owner.data.resolved.frozenForms.baseline.sourceUid).toBe("scout|mm");
		expect(owner.data.resolved.frozenForms.profiles.map(profile => profile.id)).toEqual(["true", "bat", "mist"]);
		for (const formId of ["bat", "mist", "true", "mist", "true"]) {
			const history = registry.getOperations({creature: base});
			const next = switchForm(target(base, history), formId);
			registry.applyChanges({creature: base, ...next.changes[0]});
			const out = registry.getCreature({creature: base});
			expect(out).toEqual(next.batch.proposed);
			expect(registry.getOperations({creature: base}).map(item => item.id)).toEqual(["prefix", "vampire-owner", "suffix"]);
			expect(JSON.stringify(registry.getOperations({creature: base})[2])).toBe(JSON.stringify(suffix));
			expect(registry.getOperations({creature: base})[1].data.acknowledgedPrerequisites).toEqual(owner.data.acknowledgedPrerequisites);
			expect(registry.getOperations({creature: base})[1].data.dmApproved).toBe(true);
			expect(out.gear).toEqual(base.gear);
			expect(out.attachedItems).toEqual(base.attachedItems);
			expect(out.wis).toBe(19);
			if (formId === "bat") {
				expect(out).toMatchObject({size: ["T"], speed: {walk: 5, fly: 30, swim: 15, climb: 12, alternate: {swim: [20]}}, languages: ["understands Common, Elvish but can't speak", "telepathy 30 ft."]});
				expect(out.speed.alternate.walk).toBeUndefined();
				expect(out.speed.alternate.fly).toBeUndefined();
				expect(out.action.map(entry => entry.name)).toEqual(["Bite (Bat or Vampire Form Only)", "Charm", "Children of the Night (1/Day)"]);
				expect(out.spellcasting).toEqual([]);
				expect(rule(out, "Bat Equipment and Speech").entries[0]).toContain("carried equipment does not");
			} else if (formId === "mist") {
				expect(out).toMatchObject({size: ["M"], speed: {walk: 30, fly: 20, canHover: true, swim: 15, climb: 12}});
				expect(out.action).toEqual([]);
				expect(out.spellcasting).toEqual([]);
				expect(out.immune).toContainEqual({immune: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"], note: "from nonmagical damage, except damage from sunlight", cond: true});
				expect(rule(out, "Mist Form").entries[0]).toContain("Strength, Dexterity, and Constitution");
				expect(rule(out, "Vampire Weaknesses").entries.join(" ")).toContain("20 radiant");
			} else expect(out).toEqual(original);
		}
		expect(() => switchForm(target(base, registry.getOperations({creature: base})), "spawn")).toThrow(/permitted/);
		const same = switchForm(target(base, registry.getOperations({creature: base})), "true");
		expect(same.changes).toEqual([]);
		registry.removeOperation({creature: base, operationId: owner.id});
		expect(registry.getCreature({creature: base})).toEqual({...base, name: "Renamed scout", str: 20, wis: 19});
	});

	it("executes a target's explicit bat equipment decision without inventing a universal carried-weapon prohibition", () => {
		const base = scout();
		const inputs = decisions(base);
		inputs.vampire.batEntries.find(entry => entry.match.name === "Shortsword").carriedEquipment = "usable";
		const owner = operation(preview(target(base), inputs));
		const bat = switchForm(target(base, [owner]), "bat").batch.proposed;
		expect(rule(bat, "Shortsword", "action").entries[0]).toContain("7 ({@damage 1d6 + 4})");
		expect(rule(bat, "Longbow", "action")).toBeUndefined();
		expect(bat.gear).toEqual(base.gear);
		expect(rule(bat, "Bat Equipment and Speech").entries[0]).toContain("not a blanket source prohibition");
		inputs.vampire.batEntries.find(entry => entry.match.name === "Shortsword").carriedEquipment = "assume-unusable";
		expect(preview(target(base), inputs).previews).toEqual([]);
	});

	it("reaches Encounter adapter/State/Store JSON reload, form replacement, target isolation, no-op and removal", async () => {
		const base = scout();
		let initial = await encounter(base);
		initial = EncounterWorkspaceState.withHp(initial, {id: "one", prop: "temp", value: 4});
		const prefix = patch("encounter-prefix", {name: "Renamed Encounter scout"});
		initial = EncounterWorkspaceState.withStatblockChanges(initial, [{id: "one", addOperations: [prefix], removeIds: []}]).state;
		const saved = persistence(initial);
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		const owner = operation(preview(target(base, [prefix])));
		expect(owner.data.resolved.frozenForms.baseline.sourceUid).toBe("scout|mm");
		await saved.adapter.addOperation({operation: JSON.parse(JSON.stringify(owner))});
		await saved.reload();
		expect(saved.state().instances[0].hp).toEqual({current: 25, max: 25, temp: 4});
		const first = saved.adapter.getCreature();
		for (const formId of ["bat", "mist", "true"]) {
			const next = switchForm(target(base, saved.adapter.getOperations()), formId);
			await saved.adapter.applyChanges(next.changes[0]);
			await saved.reload();
			expect(saved.adapter.getCreature()).toEqual(next.batch.proposed);
			expect(saved.state().instances[1].monster).toEqual(base);
			expect(saved.state().instances[0].hp).toEqual({current: 25, max: 25, temp: 4});
		}
		expect(saved.adapter.getCreature()).toEqual(first);
		const calls = saved.storage.pSetForPage.mock.calls.length;
		expect(saved.adapter.getOperations().map(item => item.id)).toEqual(["encounter-prefix", "vampire-owner"]);
		const current = saved.adapter.getOperations()[1];
		await expect(saved.adapter.applyChanges({replaceOperation: {operationId: current.id, expectedIntegrity: current.data.integrity, operation: current}})).resolves.toBeNull();
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(calls);
		await saved.adapter.removeOperation({operationId: owner.id});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual({...base, name: "Renamed Encounter scout"});
		expect(saved.adapter.getOperations()).toEqual([prefix]);
		expect(saved.state().instances[0].hp).toEqual({current: 16, max: 16, temp: 4});
		expect(notify).toHaveBeenCalledTimes(calls + 1);
	});

	it("preserves saved owner/state/groups on a failed form save and retries once through actual Store", async () => {
		const base = scout();
		let initial = await encounter(base);
		const owner = operation(preview(target(base)));
		initial = EncounterWorkspaceState.withStatblockChanges(initial, ["one", "two"].map(id => ({id, addOperations: [owner], removeIds: []}))).state;
		initial = EncounterWorkspaceState.withGroup({state: initial, memberIds: ["one", "two"], id: "same-form"});
		const saved = persistence(initial);
		await saved.store.pSave(initial);
		const before = saved.state();
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		const next = switchForm(target(base, saved.adapter.getOperations()), "bat");
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("M8 storage full"));
		await expect(saved.adapter.applyChanges(next.changes[0])).rejects.toThrow("M8 storage full");
		expect(saved.state()).toBe(before);
		expect(notify).not.toHaveBeenCalled();
		await saved.adapter.applyChanges(next.changes[0]);
		await saved.reload();
		expect(saved.state().groups[0].memberIds).toEqual(["two"]);
		expect(saved.adapter.getCreature().size).toEqual(["T"]);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(3);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("requires exact target answers and rejects unknown, duplicate, wrong-source and ineligible requests without partial success", () => {
		const base = scout();
		const variants = [
			input => { input.extra = true; },
			input => { input.vampire.grappleDc = undefined; },
			input => { input.vampire.grappleDc = -1; },
			input => { input.vampire.adaptation = "donor-stats"; },
			input => { input.vampire.batEntries[0].match.source = "XMM"; },
			input => { input.vampire.batEntries.push(input.vampire.batEntries[0]); },
			input => { input.vampire.batEntries[1] = input.vampire.batEntries[0]; },
			input => { input.bindings.entries.push(retain("Ghost attack")); },
			input => { input.bindings.entries[0].match.source = "XMM"; },
			input => { input.bindings.proficiencyBonus = undefined; },
			input => { input.hp = {mode: "retain"}; },
			input => { input.vampire.baseline = {sourceUid: "scout|mm", key: "00000000"}; },
			input => { input.vampire.replaceFeatures = [{section: "trait", match: {name: "Ghost", source: "MM"}}]; },
		];
		for (const change of variants) {
			const input = decisions(base);
			change(input);
			const batch = preview(target(base), input);
			expect(batch.previews).toEqual([]);
			expect(batch.skipped).toHaveLength(1);
			expect(batch.skipped[0].reason).toMatch(/Vampire:|Statblock bindings:|Numeric reconciliation:/);
		}
		expect(preview(target({...base, type: "undead"}), decisions(base)).skipped[0].reason).toMatch(/humanoid/);
		expect(preview(target({...base, mythic: [{name: "Unsupported power", entries: ["Take an action."]}]}), decisions(base)).skipped[0].reason).toMatch(/mythic/);
		const fullOnlyChoices = preview(target(base), decisions(base), {resolved: resolve("spawn")});
		expect(fullOnlyChoices.previews).toEqual([]);
		expect(fullOnlyChoices.skipped[0].reason).toMatch(/spawn accepts no Legendary Resistance or bat\/form choices/);
		expect(() => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:vampire|mm", selections: {outcome: ["vampire", "spawn"]}, automationVersion: 2})).toThrow();
		const wrong = structuredClone(catalog);
		wrong.creatureTransformation.find(entry => entry.name === "Vampire").source = "XMM";
		expect(getCreatureTransformationSchemaErrors({data: wrong, filePath: "m8"})).not.toEqual([]);
		expect(getCreatureTransformationIdentityErrors({data: wrong, filePath: "m8"})).not.toEqual([]);
		expect(() => getCreatureTransformationCandidates({catalog: wrong, races: []})).toThrow();
		const bulk = previewCreatureTransformationTargets({targets: [target(base), target(base, [], "two")],
			resolved: resolve(),
			automationInputs: {one: decisions(base), two: {...decisions(base), unexpected: true}},
			acknowledgedPrerequisites: resolve().prerequisites,
			dmApproved: true});
		expect(bulk.previews.map(entry => entry.id)).toEqual(["one"]);
		expect(bulk.skipped.map(entry => entry.id)).toEqual(["two"]);
	});

	it("executes exact-source existing-feature replacements instead of stacking regeneration or demanding manual statblock edits", () => {
		const base = scout();
		base.trait.push({name: "Regeneration", source: "TST", entries: ["Regain 5 hit points."]});
		const inputs = decisions(base);
		expect(preview(target(base), inputs).skipped[0].reason).toMatch(/replaceFeatures/);
		inputs.vampire.replaceFeatures = [{section: "trait", match: {name: "Regeneration", source: "TST"}}];
		const batch = preview(target(base), inputs);
		const out = outcome(batch);
		expect(out.trait.filter(entry => entry.name === "Regeneration")).toHaveLength(1);
		expect(rule(out, "Regeneration")).toMatchObject({source: "MM", entries: [expect.stringContaining("20 hit points")]});
		const owner = operation(batch);
		expect(switchForm(target(base, [owner]), "mist").batch.proposed.trait.filter(entry => entry.name === "Regeneration")).toHaveLength(1);
		inputs.vampire.replaceFeatures[0].match.source = "MM";
		expect(preview(target(base), inputs).skipped[0].reason).toMatch(/source-qualified/);
		inputs.vampire.replaceFeatures[0].match.source = "TST";
		inputs.vampire.replaceFeatures.push(structuredClone(inputs.vampire.replaceFeatures[0]));
		expect(preview(target(base), inputs).previews).toEqual([]);
	});

	it("handles existing competing Legendary Resistance with exact retain/replace decisions and never stacks uses or grants legendary actions/lair", () => {
		const base = scout();
		base.trait.push({name: "Legendary Resistance (1/Day)", source: "TST", entries: ["After failing a saving throw, it may succeed instead."]});
		base.legendary = [{name: "Old Move", source: "TST", entries: ["Move 5 feet."]}];
		base.legendaryGroup = {name: "Old lair", source: "TST"};
		const inputs = decisions(base);
		expect(preview(target(base), inputs).skipped[0].reason).toMatch(/Legendary Resistance/);
		inputs.vampire.legendaryResistance = {mode: "retain", match: {name: "Legendary Resistance (1/Day)", source: "TST"}};
		let out = outcome(preview(target(base), inputs));
		expect(out.trait.filter(entry => /^Legendary Resistance/.test(entry.name))).toEqual([base.trait[1]]);
		expect(out.legendary).toEqual(base.legendary);
		expect(out.legendaryGroup).toEqual(base.legendaryGroup);
		inputs.vampire.legendaryResistance = {mode: "replace", matches: [{name: "Legendary Resistance (1/Day)", source: "TST"}]};
		out = outcome(preview(target(base), inputs));
		expect(out.trait.filter(entry => /^Legendary Resistance/.test(entry.name)).map(entry => entry.name)).toEqual(["Legendary Resistance (3/Day)"]);
		inputs.vampire.legendaryResistance.matches[0].source = "MM";
		expect(preview(target(base), inputs).skipped[0].reason).toMatch(/exactly one/);
	});

	it("freezes actual prior histories and all dependent conflict winners; stale source/input/history/profile and form sets block", () => {
		const base = scout();
		const prefix = priorTransformation(base);
		const points = patch("points", {hp: {average: 19, formula: "3d8 + 6"}});
		const subject = target(base, [prefix, points]);
		const inputs = decisions({...base, con: 14, hp: {average: 19, formula: "3d8 + 6"}});
		const unresolved = preview(subject, inputs);
		expect(unresolved.previews[0].preview.canApply).toBe(false);
		const wins = Object.fromEntries(unresolved.previews[0].preview.conflicts.map(conflict => [conflict.path, "incoming"]));
		const batch = preview(subject, inputs, {conflictDecisions: {one: wins}});
		expect(outcome(batch).hp).toEqual({average: 25, formula: "3d8 + 12"});
		const old = Object.fromEntries(Object.keys(wins).map(path => [path, "existing"]));
		expect(outcome(preview(subject, inputs, {conflictDecisions: {one: old}}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, points]}));
		const mixed = {...wins, con: "existing"};
		const incoherent = preview(subject, inputs, {conflictDecisions: {one: mixed}});
		expect(incoherent.previews).toEqual([]);
		expect(incoherent.skipped[0].reason).toMatch(/one conflict winner/);
		const owner = operation(batch, "vampire-owner", {one: wins});
		const reloaded = JSON.parse(JSON.stringify(owner));
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, points, reloaded]})).not.toThrow();
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [reloaded]})).toThrow(/pre-template history changed/);
		expect(() => switchForm(target(base, [prefix, reloaded]), "bat")).toThrow(/pre-template history changed/);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "XMM"}, operations: [prefix, points, reloaded]})).toThrow();
		const changedAnswers = structuredClone(batch.automationInputs);
		changedAnswers.one.vampire.grappleDc++;
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, automationInputs: changedAnswers, conflictDecisions: {one: wins}})).toThrow(/input answers changed/);
		const changedRecipe = structuredClone(batch.resolved);
		changedRecipe.automation.profile = "different";
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, resolved: changedRecipe, conflictDecisions: {one: wins}})).toThrow();
		expect(() => createCreatureTransformationChanges({batch, targets: [target(base)], conflictDecisions: {one: wins}})).toThrow(/stale/);
		const changed = structuredClone(reloaded);
		changed.data.resolved.frozenForms.profiles[1].resolved.changes.find(step => step.type === "setVampireForm").speed.fly = 99;
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, points, changed]})).toThrow();
	});

	it("replays inactive real forms without live catalog/answers and blocks dependent downstream conflicts without resigning suffix receipts", () => {
		const base = scout();
		const owner = operation(preview(target(base)));
		const history = [owner];
		const laterResolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 22}], manualReview: []};
		const first = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: history, resolved: laterResolved, conflictDecisions: {str: "incoming"}});
		const later = {id: "later", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: history, preview: first, conflictDecisions: {str: "incoming"}})};
		// Even a same-value dependency retains its owner's integrity fence.
		expect(() => switchForm(target(base, [owner, later]), "bat")).toThrow(/Conflict context changed/);
		const bindLater = {...laterResolved, changes: [{type: "removeEntry", section: "action", match: {name: "Shortsword", source: "MM"}}]};
		const p = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: history, resolved: bindLater, conflictDecisions: {"action:shortsword|mm": "incoming"}});
		const dependent = {id: "dependent", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: history, preview: p, conflictDecisions: {"action:shortsword|mm": "incoming"}})};
		expect(() => switchForm(target(base, [owner, dependent]), "bat")).toThrow();
		const original = catalog.creatureTransformation;
		catalog.creatureTransformation = [];
		try {
			const saved = JSON.parse(JSON.stringify(owner));
			const mist = switchForm(target(base, [saved]), "mist");
			expect(mist.batch.proposed.speed.fly).toBe(20);
			expect(mist.batch.proposed.action).toEqual([]);
		} finally { catalog.creatureTransformation = original; }
	});

	it("preserves real consent, stale form choices, corrupt payload, operation count and byte limits", async () => {
		const base = scout();
		expect(() => preview(target(base), decisions(base), {dmApproved: false})).not.toThrow();
		expect(preview(target(base), decisions(base), {dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(base), decisions(base), {acknowledgedPrerequisites: []})).toThrow(/prerequisite/i);
		const owner = operation(preview(target(base)));
		const next = switchForm(target(base, [owner]), "bat");
		expect(() => createCreatureTransformationFormChanges({batch: next.batch, target: target(base, [owner]), formId: "mist"})).toThrow(/stale/);
		const bad = structuredClone(owner);
		bad.data.resolved.frozenForms.profiles[1].label = "Changed";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [bad]})).toThrow(/has been changed/);
		const payload = structuredClone(owner.data.resolved);
		payload.frozenForms.profiles[1].id = "spawn";
		expect(() => normalizeCreatureTransformation(payload)).toThrow();
		for (const change of [
			resolved => { resolved.frozenForms.profiles[1].resolved.changes[0].unexpected = true; },
			resolved => { resolved.frozenForms.profiles[0].resolved.changes.push({type: "removeEntry", section: "trait", match: {name: "Keen Hearing and Sight", source: "MM"}}); },
			resolved => { resolved.selectedOptions.outcome = ["spawn"]; },
		]) {
			const invalid = structuredClone(owner.data.resolved);
			change(invalid);
			expect(() => normalizeCreatureTransformation(invalid)).toThrow();
		}
		expect(flatten(owner.data).some(value => Object.hasOwn(value, "automationInputs") || Object.hasOwn(value, "batEntries") || Object.hasOwn(value, "bindings"))).toBe(false);
		const {frozenForms, ...noForms} = owner.data.resolved;
		expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: noForms})).toThrow(/requires its frozen/);
		const saved = persistence(await encounter(base));
		const prefix = Array.from({length: 99}, (_, ix) => patch(`filler-${ix}`, {name: base.name}));
		await saved.adapter.applyChanges({addOperations: [...prefix, owner]});
		const switchAtLimit = switchForm(target(base, saved.adapter.getOperations()), "bat");
		await saved.adapter.applyChanges(switchAtLimit.changes[0]);
		expect(saved.adapter.getOperations()).toHaveLength(100);
		await expect(saved.adapter.addOperation({operation: patch("overflow", {name: "Overflow"})})).rejects.toThrow();
		for (const version of [undefined, 1]) {
			const legacy = normalizeCreatureTransformation(resolve("vampire", 1));
			if (version !== undefined) legacy.version = version;
			legacy.changes = [{type: "setVampireNature", value: {type: "undead"}, alignment: ["L", "E"]}];
			expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: legacy})).toThrow(version === undefined ? /M8 setters require/ : /Invalid compiled/);
		}
	});

	it("enforces the actual 180000-byte source-operation boundary in Registry and Encounter with atomic storage failure", async () => {
		const base = scout();
		const small = operation(preview(target(base)));
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const limit = BestiaryCreatureTransformation.MAX_OPERATION_BYTES;
		const atLimit = {...small, id: "x".repeat(limit - bytes(small) + small.id.length)};
		expect(bytes(atLimit)).toBe(180_000);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: base, operation: atLimit});
		const saved = persistence(await encounter(base));
		await saved.adapter.addOperation({operation: atLimit});
		const before = saved.state();
		const tooLarge = {...atLimit, id: `${atLimit.id}x`};
		expect(bytes(tooLarge)).toBe(180_001);
		expect(() => new BestiaryQuickActionsRegistry().addOperation({creature: base, operation: tooLarge})).toThrow(/size budget/);
		await expect(saved.adapter.applyChanges({removeIds: [atLimit.id], addOperations: [tooLarge]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(before);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(1);
		console.info("M8 boundary selection: actual source producer, operation bytes 180000 accepted/180001 rejected; Encounter 100 operations accepted/101 rejected. Not an exhaustive payload/target matrix.");
	});
});
