import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationSchemaErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const source = name => structuredClone(mm.find(it => it.name === name && it.source === "MM"));
const ids = ["catalog:dracolich|mm", "catalog:skeleton|dmg", "catalog:zombie|dmg", "catalog:skeletal wyrmling|ar8"];
const resolve = (id, automationVersion = 2, data = catalog) => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races: []}), id, automationVersion});
const target = (baseCreature, id = "one", operations = []) => ({id, label: id, baseCreature, operations});
const batchFor = (id, subject, inputs, extra = {}) => {
	const resolved = resolve(id);
	return previewCreatureTransformationTargets({targets: [subject], resolved, automationInputs: {[subject.id]: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extra});
};
const save = batch => createCreatureTransformationChanges({batch, targets: batch.targets}).map(change => ({...change, addOperations: change.addOperations.map(operation => ({...operation, id: `m6-${change.id}`}))}));
const result = batch => {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
};
const die = (number, faces) => ({number, faces});
const ability = (kind, token, attribute, proficiency, fixed = 0, dice) => ({paragraph: 0, kind, token, mode: "ability", ability: attribute, proficiency, fixed, ...dice ? {dice} : {}});
const fixed = (kind, token, value, dice) => ({paragraph: 0, kind, token, mode: "fixed", value, ...dice ? {dice} : {}});
const bind = (name, numbers, section = "action", source = "MM") => ({section, match: {name, source}, mode: "bind", numbers});
const keep = (name, section = "action", source = "MM") => ({section, match: {name, source}, mode: "retain"});
const armor = (kind, base, dexterity, extra = {}) => ({mode: "recalculate", alternatives: [{kind, base, dexterity, shield: 0, fixed: 0, ...extra}]});
const scoutBindings = () => ({proficiencyBonus: 2,
	armor: armor("worn", 11, "full"),
	entries: ["Shortsword", "Longbow"].map((name, index) => bind(name, [
		ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, die(1, index ? 8 : 6)),
	]))});
const bugbearBindings = () => ({
	proficiencyBonus: 2,
	armor: armor("worn", 12, "capped", {shield: 2, maxDex: 2}),
	entries: [
		bind("Morningstar", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, die(2, 8))]),
		bind("Javelin", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, die(2, 6)), ability("damage", 1, "str", 0, 0, die(1, 6))]),
		bind("Surprise Attack", [fixed("damage", 0, 0, die(2, 6))], "trait"),
	],
});
const dracInputs = creature => ({reanimation: {age: "adult",
	trueDragon: true,
	shadowDragon: false,
	physiology: (creature.trait || []).map(entry => ({match: {name: entry.name, source: entry.source || creature.source}, mode: entry.name === "Amphibious" && (entry.source || creature.source) === "MM" ? "remove" : "retain"})),
	lair: {mode: "retain"}}});
const wyrmInputs = creature => ({reanimation: {wyrmling: true,
	donor: {name: creature.name, source: creature.source},
	breaths: (creature.action || []).filter(entry => /\bbreath\b/i.test(entry.name)).map(entry => ({section: "action", match: {name: entry.name, source: entry.source || creature.source}, mode: "remove"}))},
bindings: {proficiencyBonus: 2,
	armor: armor("natural", 15, "full"),
	entries: [bind("Bite", [
		ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, die(1, 10)),
	])]},
});
const schema = read("schema/site/creature-transformation.json");
const validateLeaf = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledReanimation"});
const walk = (value, predicate) => !value || typeof value !== "object" ? [] : [...predicate(value) ? [value] : [], ...Object.values(value).flatMap(part => walk(part, predicate))];
const groupBaseline = group => Object.fromEntries(["name", "source", "page", "lairActions", "regionalEffects", "mythicEncounter"]
	.filter(key => Object.hasOwn(group, key)).map(key => [key, structuredClone(group[key])]));
const retainedDonorInputs = creature => {
	const sections = ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"];
	const inputs = wyrmInputs(creature);
	inputs.bindings = {proficiencyBonus: 2,
		armor: {mode: "retain"},
		entries: sections.flatMap(section => (creature[section] || [])
			.filter(entry => !inputs.reanimation.breaths.some(choice => choice.section === section && choice.match.name === entry.name))
			.map(entry => keep(entry.name, section, entry.source || creature.source)))};
	return inputs;
};

describe("M6 actual reanimation source producers", () => {
	it("independently anchors DMG additive NPC features and the MM retention/physiology source contract", () => {
		const table = walk(read("data/book/book-dmg.json"), value => value.caption === "NPC Features")[0];
		expect(table.rows.find(row => row[0] === "Skeleton")).toEqual(["Skeleton", "+2 Dex, -4 Int, -4 Cha",
			"Vulnerable to bludgeoning damage, immune to poison damage and {@condition exhaustion}, can't be poisoned, darkvision 60 ft., can't speak but understands the languages it knew in life"]);
		expect(table.rows.find(row => row[0] === "Zombie")).toEqual(["Zombie", "+1 Str, +2 Con, -6 Int, -4 Wis, -4 Cha",
			"Undead Fortitude, immune to poison damage, can't be poisoned, darkvision 60 ft., can't speak but understands the languages it knew in life"]);
		const template = walk(read("data/bestiary/fluff-bestiary-mm.json"), value => value.name === "Dracolich Template")[0];
		expect(template.entries[0]).toMatch(/ancient or adult true dragon/);
		expect(template.entries[1]).toMatch(/retains its statistics/);
		expect(template.entries[1]).toMatch(/loses any trait, such as Amphibious, that assumes a living physiology/);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});

	it("Skeleton applies DMG deltas, all defenses, speech and dependent numbers, never fixed MM Skeleton stats", () => {
		const creature = source("Scout");
		const batch = batchFor(ids[1], target(creature), {reanimation: {}, bindings: scoutBindings()});
		const out = result(batch);
		expect(out).toMatchObject({
			name: "Scout",
			source: "MM",
			type: {type: "undead", tags: ["any race"]},
			alignment: ["A"],
			str: 11,
			dex: 16,
			con: 12,
			int: 7,
			wis: 13,
			cha: 7,
			hp: creature.hp,
			skill: {nature: "+2", perception: "+5", stealth: "+7", survival: "+5"},
			passive: 15,
			ac: [{ac: 14, from: creature.ac[0].from}],
			immune: ["poison"],
			vulnerable: ["bludgeoning"],
			conditionImmune: ["exhaustion", "poisoned"],
			senses: ["darkvision 60 ft."],
			languages: ["understands any one language (usually Common) but can't speak"],
		});
		expect(out.action[1].entries[0]).toContain("{@hit 5}");
		expect(out.action[1].entries[0]).toContain("6 ({@damage 1d6 + 3})");
		expect(out.action[2].entries[0]).toContain("7 ({@damage 1d8 + 3})");
		expect(out.action[0]).toEqual(creature.action[0]);
		expect(out.trait).toEqual(creature.trait);
		for (const field of ["speed", "size", "cr", "gear", "profBonus", "pbNote"]) expect(out[field]).toEqual(creature[field]);
		const raw = compileCreatureTransformation({resolved: resolve(ids[1]), current: creature, inputs: {reanimation: {}, bindings: scoutBindings()}});
		expect(validateLeaf(raw)).toBe(true);
		expect(normalizeCreatureTransformation(raw)).toEqual(batch.previews[0].preview.resolved);
		expect(batch.previews[0].preview.manualReview.map(it => it.field)).toEqual(["cr"]);
	});

	it("Zombie computes CON exactly once, retains Brute/equipment/alignment and makes Undead Fortitude fully usable", () => {
		const creature = source("Bugbear");
		const out = result(batchFor(ids[2], target(creature), {reanimation: {}, bindings: bugbearBindings()}));
		expect(out).toMatchObject({
			type: {type: "undead", tags: ["goblinoid"]},
			str: 16,
			dex: 14,
			con: 15,
			int: 2,
			wis: 7,
			cha: 5,
			hp: {average: 32, formula: "5d8 + 10"},
			ac: creature.ac,
			alignment: creature.alignment,
			skill: {stealth: "+6", survival: "+0"},
			passive: 8,
			immune: ["poison"],
			conditionImmune: ["poisoned"],
			senses: ["darkvision 60 ft."],
			languages: ["understands Common, Goblin but can't speak"],
		});
		expect(out).not.toHaveProperty("vulnerable");
		expect(out.conditionImmune).not.toContain("exhaustion");
		expect(out.action[0].entries[0]).toContain("{@hit 5}");
		expect(out.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(out.action[1].entries[0]).toContain("10 ({@damage 2d6 + 3})");
		expect(out.action[1].entries[0]).toContain("6 ({@damage 1d6 + 3})");
		expect(out.trait.slice(0, 2)).toEqual(creature.trait);
		const fortitude = out.trait.find(it => it.name === "Undead Fortitude");
		expect(fortitude.source).toBe("DMG");
		expect(fortitude.entries[0]).toMatch(/damage.*reduce.*0 hit points.*Constitution saving throw.*DC 5 \+ the damage taken.*radiant.*critical hit.*success.*1 hit point instead/i);
		const originalRule = source("Zombie").trait.find(it => it.name === "Undead Fortitude").entries[0];
		for (const clause of [/Constitution saving throw/, /5 \+ the damage taken/, /radiant/, /critical hit/, /success/, /1 hit point instead/]) expect(originalRule).toMatch(clause);
		for (const field of ["speed", "size", "cr", "gear", "profBonus", "pbNote"]) expect(out[field]).toEqual(creature[field]);
	});

	it("reconciles spell DCs and Drow structured tags while retaining innate uses and source-fixed poison riders", () => {
		const creature = source("Drow");
		const bindings = {proficiencyBonus: 2,
			armor: armor("worn", 13, "capped", {maxDex: 2}),
			entries: [
				bind("Shortsword", [ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, die(1, 6))]),
				bind("Hand Crossbow", [ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, die(1, 6)), fixed("dc", 0, 13)]),
				bind("Innate Spellcasting", [ability("dc", 0, "cha", 1, 8)], "spellcasting"),
			]};
		const out = result(batchFor(ids[2], target(creature), {reanimation: {}, bindings}));
		expect(out.type.tags).toEqual(creature.type.tags);
		expect(out.spellcasting[0].headerEntries[0]).toContain("{@dc 9}");
		expect(out.spellcasting[0].daily).toEqual(creature.spellcasting[0].daily);
		expect(out.action).toEqual(creature.action);
		expect(out.trait.slice(0, 2)).toEqual(creature.trait);
		expect(out.alignment).toEqual(creature.alignment);
	});

	it("Dracolich removes actual Amphibious|MM and selected additional physiology, with all defenses and retained chassis", () => {
		const creature = source("Adult Bronze Dragon");
		creature.type = {type: "dragon", tags: ["bronze"]};
		creature.trait.push({name: "Living Metabolism", source: "HB", entries: ["This living body requires food."]},
			{name: "Amphibious", source: "HB", entries: ["An unrelated source-qualified aura."]});
		const inputs = dracInputs(creature);
		inputs.reanimation.physiology.find(it => it.match.name === "Living Metabolism").mode = "remove";
		const batch = batchFor(ids[0], target(creature), inputs);
		const out = result(batch);
		expect(out.type).toEqual({type: "undead", tags: ["bronze"]});
		expect(out.trait.some(it => it.name === "Amphibious" && !it.source)).toBe(false);
		expect(out.trait).toContainEqual(creature.trait.at(-1));
		expect(out.trait.some(it => it.name === "Living Metabolism")).toBe(false);
		expect(out.trait).toContainEqual(creature.trait[1]);
		expect(out.trait.find(it => it.name === "Magic Resistance")).toMatchObject({source: "MM", entries: ["The dracolich has advantage on saving throws against spells and other magical effects."]});
		expect(out.trait.find(it => it.name === "Undead Nature").entries[0]).toMatch(/no air, food, drink, or sleep/);
		expect(out.trait.find(it => it.name === "Spirit Gem").entries[0]).toMatch(/body is destroyed.*same plane.*another dragon's corpse.*gem touches it.*new dracolich.*another plane.*afterlife/);
		expect(out.resist).toContain("necrotic");
		expect(out.immune).toEqual(expect.arrayContaining(["lightning", "poison"]));
		expect(out.conditionImmune).toEqual(expect.arrayContaining(["charmed", "frightened", "paralyzed", "poisoned", "exhaustion"]));
		for (const field of Object.keys(creature).filter(key => !["type", "trait", "resist", "immune", "conditionImmune"].includes(key))) expect(out[field]).toEqual(creature[field]);
		expect(batch.previews[0].preview.resolved.changes.filter(it => it.type === "removeEntry").map(it => it.match)).toEqual([
			{name: "Amphibious", source: "MM"}, {name: "Living Metabolism", source: "HB"},
		]);
	});

	it("blocks omitted or partial lair baselines for the actual Bronze reference instead of deleting its sourced regional rules", () => {
		const creature = source("Adult Bronze Dragon");
		const rawGroup = read("data/bestiary/legendarygroups.json").legendaryGroup.find(it => it.name === "Bronze Dragon" && it.source === "MM");
		expect(creature.legendaryGroup).toEqual({name: "Bronze Dragon", source: "MM"});
		expect(rawGroup.regionalEffects).toHaveLength(4);
		const complete = groupBaseline(rawGroup);
		for (const baseline of [
			{...creature.legendaryGroup},
			{...complete, regionalEffects: []},
			{...complete, regionalEffects: complete.regionalEffects.slice(0, 3)},
			Object.fromEntries(Object.entries(complete).filter(([key]) => key !== "lairActions")),
		]) {
			const inputs = dracInputs(creature);
			inputs.reanimation.lair = {mode: "replace", baseline, actions: []};
			const batch = batchFor(ids[0], target(creature), inputs, {legendaryGroups: [rawGroup]});
			expect(batch.previews).toEqual([]);
			expect(batch.skipped[0].reason).toMatch(/complete.*baseline|baseline.*(?:complete|actual|disagrees)/i);
		}
		const inputs = dracInputs(creature);
		inputs.reanimation.lair = {mode: "replace", baseline: complete, actions: []};
		for (const legendaryGroups of [[], [{name: "Unknown", source: "MM"}], [{...creature.legendaryGroup}], [rawGroup, structuredClone(rawGroup)]]) {
			const batch = batchFor(ids[0], target(creature), inputs, {legendaryGroups});
			expect(batch.previews).toEqual([]);
			expect(batch.skipped[0].reason).toMatch(/resolve.*complete.*Bronze Dragon\|MM/i);
		}
		expect(result(batchFor(ids[0], target(creature), dracInputs(creature))).legendaryGroup).toEqual(creature.legendaryGroup);
	});

	it("executes complete source-resolved lair replacement and freezes regional/mythic/source metadata through both saved consumers", async () => {
		const creature = source("Adult Bronze Dragon");
		const rawGroup = read("data/bestiary/legendarygroups.json").legendaryGroup.find(it => it.name === "Bronze Dragon" && it.source === "MM");
		const baseline = groupBaseline(rawGroup);
		for (const actions of [[], baseline.lairActions.slice(0, 1), [{type: "entries", name: "Inherited Lair", entries: ["On initiative count 20 (losing ties), extinguish nonmagical flames within 60 feet."]}]]) {
			const legendaryGroups = [structuredClone(rawGroup)];
			const inputs = dracInputs(creature);
			inputs.reanimation.lair = {mode: "replace", baseline: structuredClone(baseline), actions};
			const batch = batchFor(ids[0], target(creature), inputs, {legendaryGroups});
			const out = result(batch);
			expect(out.legendaryGroup.lairActions).toEqual(actions);
			expect(out.legendaryGroup.regionalEffects).toEqual(baseline.regionalEffects);
			expect(DataUtil.monster.getLegendaryGroup(out)).toEqual(out.legendaryGroup);
			expect(out.legendaryGroup.regionalEffects).toEqual(expect.arrayContaining([expect.objectContaining({source: "FTD"})]));
			const operation = JSON.parse(JSON.stringify(save(batch)[0].addOperations[0]));
			const registry = new BestiaryQuickActionsRegistry();
			const operationId = registry.addOperation({creature, operation});
			let state = await EncounterWorkspaceState.pFromSavedList({
				exportedSublist: {name: "M6 lair", saveId: "lair", items: [{h: "bronze_mm", c: 1}]},
				pResolveItem: async () => ({entity: creature}),
				fnUid: () => "one",
			});
			const values = new Map();
			const store = new EncounterWorkspaceStore({storage: {pGetForPage: async key => values.get(key), pSetForPage: async (key, value) => values.set(key, JSON.parse(JSON.stringify(value)))}});
			const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async change => { state = await store.pSave(change.state); }});
			await adapter.addOperation({operation});
			const bytes = JSON.stringify(adapter.getOperations());
			legendaryGroups[0].regionalEffects.length = 0;
			expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, legendaryGroups})).toThrow(/stale|baseline/i);
			legendaryGroups.length = 0;
			inputs.reanimation.lair.baseline.regionalEffects.length = 0;
			inputs.reanimation.lair.actions = [];
			state = await store.pLoad();
			expect(JSON.stringify(adapter.getOperations())).toBe(bytes);
			expect(adapter.getCreature()).toEqual(out);
			expect(registry.getCreature({creature})).toEqual(out);
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: [operation]})).toEqual(out);
			await adapter.removeOperation({operationId: operation.id});
			registry.removeOperation({creature, operationId});
			expect(adapter.getCreature()).toEqual(creature);
			expect(registry.getCreature({creature})).toEqual(creature);
			expect(validateLeaf(compileCreatureTransformation({resolved: resolve(ids[0]),
				current: creature,
				legendaryGroups: [rawGroup],
				inputs: {
					reanimation: {...dracInputs(creature).reanimation, lair: {mode: "replace", baseline, actions}},
				}}))).toBe(true);
		}
		const inline = structuredClone(creature);
		inline.legendaryGroup = {...baseline, mythicEncounter: [{type: "entries", name: "Retained mythic context", source: "HB", entries: ["The existing encounter rule remains."]}]};
		const inputs = dracInputs(inline);
		inputs.reanimation.lair = {mode: "replace", baseline: structuredClone(inline.legendaryGroup), actions: []};
		const out = result(batchFor(ids[0], target(inline), inputs));
		expect(out.legendaryGroup.mythicEncounter).toEqual(inline.legendaryGroup.mythicEncounter);
		const inlineOperation = JSON.parse(JSON.stringify(save(batchFor(ids[0], target(inline), inputs))[0].addOperations[0]));
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: inline, operations: [inlineOperation]})).toEqual(out);
		delete inputs.reanimation.lair.baseline.mythicEncounter;
		expect(batchFor(ids[0], target(inline), inputs).previews).toEqual([]);
	});

	it("Ar8 Gold donor retains identity/chassis, changes exact scores and HP once, loses every shared breath mode and speech", () => {
		const creature = source("Gold Dragon Wyrmling");
		const out = result(batchFor(ids[3], target(creature), wyrmInputs(creature)));
		expect(out).toMatchObject({
			name: creature.name,
			source: "MM",
			type: "undead",
			str: 19,
			dex: 12,
			con: 19,
			int: 12,
			wis: 10,
			cha: 14,
			hp: {average: 68, formula: "8d8 + 32"},
			ac: [{ac: 16, from: ["natural armor"]}],
			save: {dex: "+3", con: "+6", wis: "+2", cha: "+4"},
			skill: {perception: "+4", stealth: "+3"},
			passive: 14,
			immune: ["fire", "poison"],
			conditionImmune: ["poisoned"],
			languages: ["understands Draconic but can't speak"],
		});
		expect(out.action).toEqual([creature.action[0]]);
		expect(out.trait).toEqual(creature.trait);
		for (const field of ["alignment", "size", "speed", "senses", "cr", "gear"]) expect(out[field]).toEqual(creature[field]);
		expect(out.hp.average - creature.hp.average).toBe(8);
	});

	it.each([
		["XMM", "bestiary-xmm.json", "Gold Dragon Wyrmling"],
		["FTD", "bestiary-ftd.json", "Amethyst Dragon Wyrmling"],
	])("rejects retained actual %s donor breaths and removes their complete sourced actions without excluding the donor edition", (sourceId, file, name) => {
		const creature = read(`data/bestiary/${file}`).monster.find(it => it.name === name && it.source === sourceId);
		const inputs = retainedDonorInputs(creature);
		const breaths = inputs.reanimation.breaths;
		expect(breaths.length).toBe(sourceId === "XMM" ? 2 : 1);
		for (const breath of breaths) {
			const retained = structuredClone(inputs);
			retained.reanimation.breaths.find(choice => choice.match.name === breath.match.name).mode = "retain";
			retained.bindings.entries.push(keep(breath.match.name, breath.section, breath.match.source));
			const batch = batchFor(ids[3], target(creature), retained);
			expect(batch.previews).toEqual([]);
			expect(batch.skipped[0].reason).toMatch(/breath.*must be removed/i);
			expect(batch.skipped[0].reason).toContain(`${breath.match.name}|${sourceId}`);
		}
		const batch = batchFor(ids[3], target(creature), inputs);
		const out = result(batch);
		expect(out.action).toEqual(creature.action.filter(entry => !breaths.some(choice => choice.match.name === entry.name)));
		expect(out.source).toBe(sourceId);
		expect(out.type.type || out.type).toBe("undead");
		expect(out.hp).toEqual(sourceId === "XMM" ? {average: 68, formula: "8d8 + 32"} : {average: 85, formula: "10d8 + 40"});
		expect(out.spellcasting).toEqual(creature.spellcasting);
		const operation = JSON.parse(JSON.stringify(save(batch)[0].addOperations[0]));
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: [operation]})).toEqual(out);
	});

	it("distinguishes actual homebrew breath mechanics from a genuinely ambiguous same-name non-breath and isolates targets", () => {
		const creature = source("Gold Dragon Wyrmling");
		creature.source = "HB";
		creature.trait.push({name: "Fire Breath {@recharge 5}", source: "OTHER", entries: ["The dragon's skin glows like embers; this grants no breath weapon."]});
		const inputs = retainedDonorInputs(creature);
		inputs.reanimation.breaths.push({section: "trait", match: {name: "Fire Breath {@recharge 5}", source: "OTHER"}, mode: "retain"});
		const retained = structuredClone(inputs);
		retained.reanimation.breaths[0].mode = "retain";
		retained.bindings.entries.push(keep(creature.action[1].name, "action", "HB"));
		const resolved = resolve(ids[3]);
		const targets = [target(creature, "invalid"), target(creature, "valid")];
		const batch = previewCreatureTransformationTargets({targets, resolved, automationInputs: {invalid: retained, valid: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
		expect(batch.skipped.map(it => it.id)).toEqual(["invalid"]);
		expect(batch.skipped[0].reason).toMatch(/breath.*must be removed/i);
		expect(batch.previews.map(it => it.id)).toEqual(["valid"]);
		expect(batch.previews[0].preview.proposed.trait).toContainEqual(creature.trait.at(-1));
		expect(batch.previews[0].preview.proposed.action).toEqual([creature.action[0]]);
		const wrongSource = structuredClone(inputs);
		wrongSource.reanimation.breaths[0].match.source = "MM";
		expect(batchFor(ids[3], target(creature), wrongSource).previews).toEqual([]);
	});

	it("removes all individually sourced breaths across sections and requires an executed decision for an ambiguous breath entry", () => {
		const creature = source("Gold Dragon Wyrmling");
		creature.action.push({name: "Secondary Breath", source: "HB", entries: ["A second breath weapon."]});
		creature.bonus = [{name: "Breath Weapon", source: "HB", entries: ["Another breath weapon."]}];
		const inputs = wyrmInputs(creature);
		expect(batchFor(ids[3], target(creature), inputs).skipped[0].reason).toMatch(/bonus Breath Weapon\|HB/);
		inputs.reanimation.breaths.push({section: "bonus", match: {name: "Breath Weapon", source: "HB"}, mode: "remove"});
		const out = result(batchFor(ids[3], target(creature), inputs));
		expect(out.action).toEqual([creature.action[0]]);
		expect(out.bonus).toEqual([]);
	});

	it("preserves nonstandard HP/save/skill/passive residuals and stronger senses without double-counting CON", () => {
		const creature = source("Bugbear");
		creature.hp = {average: 34, formula: "5d8 + 12"};
		creature.save = {con: "+9", wis: "+7"};
		creature.skill.perception = "+10";
		creature.passive = 24;
		creature.senses = ["darkvision 120 ft.", "blindsight 10 ft."];
		const out = result(batchFor(ids[2], target(creature), {reanimation: {}, bindings: bugbearBindings()}));
		expect(out.hp).toEqual({average: 39, formula: "5d8 + 17"});
		expect(out.save).toEqual({con: "+10", wis: "+5"});
		expect(out.skill.perception).toBe("+8");
		expect(out.passive).toBe(22);
		expect(out.senses).toEqual(creature.senses);
	});

	it("blocks precise unanswered, ineligible, duplicate and unsupported choices instead of producing partial effects", () => {
		const drac = source("Adult Bronze Dragon");
		for (const modify of [
			inputs => { delete inputs.reanimation.age; },
			inputs => { inputs.reanimation.physiology.pop(); },
			inputs => { inputs.reanimation.physiology[0].mode = "retain"; },
			inputs => { inputs.reanimation.physiology.push(structuredClone(inputs.reanimation.physiology[0])); },
			inputs => { inputs.reanimation.lair = {mode: "remove"}; },
			inputs => { inputs.reanimation.trueDragon = false; },
			inputs => { inputs.reanimation.shadowDragon = true; },
			inputs => { inputs.reanimation.age = "young"; },
		]) {
			const inputs = dracInputs(drac);
			modify(inputs);
			const batch = batchFor(ids[0], target(drac), inputs);
			expect(batch.previews).toEqual([]);
			expect(batch.skipped[0].reason).toMatch(/age|Classify|Amphibious|lair|dragon|physiology/i);
		}
		const duplicate = structuredClone(drac);
		duplicate.trait.push(structuredClone(duplicate.trait[0]));
		expect(batchFor(ids[0], target(duplicate), dracInputs(duplicate)).previews).toEqual([]);
		for (const source of ["MM", "BEG"]) {
			const shadow = structuredClone(drac);
			shadow.trait.push({name: "Living Shadow", source, entries: ["The body has become a shadow."]});
			expect(batchFor(ids[0], target(shadow), dracInputs(shadow)).skipped[0].reason).toMatch(/shadow dragon/);
		}
		const unrelated = structuredClone(drac);
		unrelated.trait.push({name: "Living Shadow", source: "HB", entries: ["A similarly named unrelated trait."]});
		expect(result(batchFor(ids[0], target(unrelated), dracInputs(unrelated))).trait).toContainEqual(unrelated.trait.at(-1));
		const wyrm = source("Gold Dragon Wyrmling");
		for (const modify of [
			inputs => { inputs.reanimation.wyrmling = false; },
			inputs => { inputs.reanimation.donor.source = "XMM"; },
			inputs => { inputs.reanimation.donor.name = "Red Dragon Wyrmling"; },
			inputs => { inputs.reanimation.breaths[0].mode = "retain"; },
			inputs => { inputs.reanimation.breaths = []; },
			inputs => { inputs.hp = {mode: "constitution", bonusPerHitDie: 1}; },
		]) {
			const inputs = wyrmInputs(wyrm);
			modify(inputs);
			expect(batchFor(ids[3], target(wyrm), inputs).previews).toEqual([]);
		}
		expect(batchFor(ids[1], target(source("Scout")), {reanimation: {alignment: ["L", "E"]}, bindings: scoutBindings()}).previews).toEqual([]);
		expect(batchFor(ids[2], target(source("Bugbear")), {reanimation: {}}).skipped[0].reason).toMatch(/bindings/);
		const injected = {reanimation: {}, bindings: {...bugbearBindings(), current: source("Scout")}};
		expect(batchFor(ids[2], target(source("Bugbear")), injected).previews).toEqual([]);
		expect(batchFor(ids[1], target(source("Scout")), {reanimation: {}, bindings: scoutBindings(), hp: {mode: "override", value: {average: 99, formula: "3d8 + 86"}}}).skipped[0].reason).toMatch(/retain.*HP/);
		const nonDragon = source("Scout");
		expect(batchFor(ids[0], target(nonDragon), dracInputs(nonDragon)).previews).toEqual([]);
		const lowerSource = source("Gold Dragon Wyrmling");
		lowerSource.action[1].source = "mm";
		const retainedBreath = wyrmInputs(lowerSource);
		retainedBreath.reanimation.breaths[0].mode = "retain";
		expect(batchFor(ids[3], target(lowerSource), retainedBreath).skipped[0].reason).toMatch(/must be removed/);
	});

	it("requires an explicit HP answer for a special CON chassis and retains the actual NPC proficiency", () => {
		const creature = source("Bugbear");
		creature.hp = {special: "Depends on the encounter"};
		creature.profBonus = 4;
		creature.pbNote = "+4";
		expect(batchFor(ids[2], target(creature), {reanimation: {}, bindings: bugbearBindings()}).skipped[0].reason).toMatch(/HP|hit points/i);
		const bindings = bugbearBindings();
		bindings.proficiencyBonus = 4;
		for (const entry of bindings.entries) {
			for (const number of entry.numbers) if (number.kind === "hit") number.fixed = -2;
		}
		const out = result(batchFor(ids[2], target(creature), {reanimation: {}, bindings, hp: {mode: "override", value: {average: 32, formula: "5d8 + 10"}}}));
		expect(out.hp).toEqual({average: 32, formula: "5d8 + 10"});
		expect(out.profBonus).toBe(4);
		expect(out.pbNote).toBe("+4");
		expect(out.action[0].entries[0]).toContain("{@hit 5}");
	});

	it.each(ids)("freezes %s through real Registry and Encounter adapter/Store replay, corruption failure and removal", async id => {
		const creature = source(id === ids[0] ? "Adult Bronze Dragon" : id === ids[1] ? "Scout" : id === ids[2] ? "Bugbear" : "Gold Dragon Wyrmling");
		const inputs = id === ids[0] ? dracInputs(creature) : id === ids[3] ? wyrmInputs(creature) : {reanimation: {}, bindings: id === ids[1] ? scoutBindings() : bugbearBindings()};
		const live = structuredClone(catalog);
		const resolved = resolve(id, 2, live);
		const subject = target(creature);
		const batch = batchFor(id, subject, inputs, {resolved});
		const expected = result(batch);
		const operation = JSON.parse(JSON.stringify(save(batch)[0].addOperations[0]));
		const raw = compileCreatureTransformation({resolved, current: creature, inputs});
		expect(validateLeaf(raw)).toBe(true);
		expect(validateLeaf.errors).toBeNull();
		const registry = new BestiaryQuickActionsRegistry();
		const operationId = registry.addOperation({creature, operation});
		expect(registry.getCreature({creature})).toEqual(expected);
		let state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: {name: "M6", saveId: "reanimation", items: [{h: "subject_mm", c: 1}]},
			pResolveItem: async () => ({entity: creature}),
			fnUid: () => "one",
		});
		const values = new Map();
		const store = new EncounterWorkspaceStore({storage: {pGetForPage: async key => values.get(key), pSetForPage: async (key, value) => values.set(key, JSON.parse(JSON.stringify(value)))}});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async change => { state = await store.pSave(change.state); }});
		await adapter.addOperation({operation});
		const bytes = JSON.stringify(adapter.getOperations());
		live.creatureTransformation.length = 0;
		resolved.automation = {profile: "removed-live-source"};
		inputs.reanimation = {changed: true};
		state = await store.pLoad();
		expect(JSON.stringify(adapter.getOperations())).toBe(bytes);
		expect(adapter.getCreature()).toEqual(expected);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: JSON.parse(bytes)})).toEqual(expected);
		const corrupt = JSON.parse(bytes);
		corrupt[0].data.resolved.changes[0].value.tags = ["corrupted"];
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: corrupt})).toThrow(/changed/i);
		await expect(adapter.addOperation({operation: corrupt[0]})).rejects.toThrow();
		expect(JSON.stringify(adapter.getOperations())).toBe(bytes);
		await adapter.removeOperation({operationId: operation.id});
		state = await store.pLoad();
		expect(adapter.getCreature()).toEqual(creature);
		registry.removeOperation({creature, operationId});
		expect(registry.getCreature({creature})).toEqual(creature);
	});

	it("uses actual prior history, isolates mixed-target failures and keeps all reanimation writes one coherent conflict group", () => {
		const creature = source("Scout");
		const prior = save(batchFor(ids[1], target(creature), {reanimation: {}, bindings: scoutBindings()}))[0].addOperations;
		const targets = [target(creature, "historical", prior), target(creature, "valid"), target({...creature, hp: {special: "custom"}}, "special")];
		const resolved = resolve(ids[1]);
		const inputs = Object.fromEntries(targets.map(subject => [subject.id, {reanimation: {}, bindings: scoutBindings()}]));
		inputs.special.bindings.entries = [];
		const first = previewCreatureTransformationTargets({targets, resolved, automationInputs: inputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
		expect(first.previews.map(it => it.id)).toEqual(["historical", "valid"]);
		expect(first.skipped.map(it => it.id)).toEqual(["special"]);
		expect(first.previews[0].preview.conflicts.some(it => it.path === "dex")).toBe(true);
		const decisions = {historical: Object.fromEntries(first.previews[0].preview.conflicts.map(it => [it.path, "incoming"]))};
		const accepted = previewCreatureTransformationTargets({targets, resolved, automationInputs: inputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions: decisions});
		expect(accepted.previews[0].preview.proposed.dex).toBe(18);
		expect(accepted.previews[1].preview.proposed.dex).toBe(16);
		expect(createCreatureTransformationChanges({batch: accepted, targets, conflictDecisions: decisions}).map(it => it.id)).toEqual(["historical", "valid"]);
		const mixed = structuredClone(decisions);
		mixed.historical.dex = "existing";
		const blocked = previewCreatureTransformationTargets({targets, resolved, automationInputs: inputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions: mixed});
		expect(blocked.skipped.find(it => it.id === "historical").reason).toMatch(/one conflict winner/);
		const retained = {historical: Object.fromEntries(first.previews[0].preview.conflicts.map(it => [it.path, "existing"]))};
		const existing = previewCreatureTransformationTargets({targets, resolved, automationInputs: inputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions: retained});
		expect(existing.previews[0].preview.proposed).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: prior}));
	});

	it("keeps consent, input/history staleness and per-target storage gates; strict snapshots cannot inject other family mechanics", () => {
		const subject = target(source("Scout"));
		const inputs = {reanimation: {}, bindings: scoutBindings()};
		const batch = batchFor(ids[1], subject, inputs);
		expect(() => save({...batch, targets: [{...subject, baseCreature: {...subject.baseCreature, dex: 15}}]})).toThrow();
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, automationInputs: {one: {...inputs, hp: {mode: "retain"}}}})).toThrow(/stale/);
		expect(() => batchFor(ids[1], subject, inputs, {acknowledgedPrerequisites: []})).toThrow(/prerequisite/);
		expect(batchFor(ids[1], subject, inputs, {dmApproved: false}).previews).toEqual([]);
		expect(batchFor(ids[1], subject, inputs, {validateOperation: () => { throw new Error("storage limit"); }}).skipped[0].reason).toMatch(/storage limit/);
		const concrete = compileCreatureTransformation({resolved: resolve(ids[1]), current: subject.baseCreature, inputs});
		for (const mutate of [
			value => { value.identity.source = "XDMG"; },
			value => { value.changes.push({op: "setReanimationType", value: {type: "undead"}}); },
			value => { value.changes.push({op: "setReanimationLair", value: {name: "Other", source: "HB"}}); },
			value => { value.changes.find(it => it.op === "setReanimationLanguages").value.patch = {}; },
			value => { value.changes.find(it => it.op === "setReanimationLanguages").value.languages = ["Common"]; },
			value => { value.changes = value.changes.filter(it => it.op !== "grantVulnerability"); },
			value => { value.selectedOptions["automation-reanimation"] = ["zombie|dmg:m6"]; },
		]) {
			const invalid = structuredClone(concrete);
			mutate(invalid);
			expect(() => normalizeCreatureTransformation(invalid)).toThrow();
		}
		const drac = source("Adult Bronze Dragon");
		const fullDrac = compileCreatureTransformation({resolved: resolve(ids[0]), current: drac, inputs: dracInputs(drac)});
		fullDrac.changes = fullDrac.changes.filter(step => step.op !== "removeEntry");
		expect(() => normalizeCreatureTransformation(fullDrac)).toThrow();
		for (const step of [
			{op: "setReanimationType", value: {type: "undead"}},
			{op: "setReanimationLanguages", value: {languages: ["can't speak"], languageTags: ["CS"]}},
			{op: "setReanimationLair", value: {name: "Closed", source: "MM", lairActions: []}},
		]) {
			const legacy = resolve(ids[0], 1);
			legacy.changes.push(step);
			expect(() => normalizeCreatureTransformation(legacy)).toThrow(/version-2/);
			const invalid = structuredClone(concrete);
			invalid.id = "catalog:half-dragon|mm";
			invalid.identity = {name: "Half-Dragon", source: "MM"};
			expect(() => normalizeCreatureTransformation(invalid)).toThrow();
		}
		for (const id of [ids[1], ids[3]]) {
			const invalid = structuredClone(catalog);
			const recipe = invalid.creatureTransformation.find(it => `catalog:${it.name.toLowerCase()}|${it.source.toLowerCase()}` === id);
			recipe.source = "OTHER";
			expect(() => getCreatureTransformationCandidates({catalog: invalid, races: []})).toThrow();
			expect([...getCreatureTransformationSchemaErrors({data: invalid, filePath: "bad"}), ...getCreatureTransformationIdentityErrors({data: invalid, filePath: "bad"})]).not.toEqual([]);
		}
	});

	it("preserves all default/unversioned, M1/M2 historical output, unrelated recipes and Species", () => {
		const originalCatalog = structuredClone(catalog);
		originalCatalog.creatureTransformation.forEach(recipe => delete recipe.automation);
		for (const id of ids) {
			expect(resolve(id, 1)).toEqual(resolve(id, 1, originalCatalog));
			const creature = source(id === ids[0] ? "Adult Bronze Dragon" : id === ids[3] ? "Gold Dragon Wyrmling" : "Scout");
			const legacy = batchFor(id, target(creature), {}, {resolved: resolve(id, 1)});
			const operation = JSON.parse(JSON.stringify(save(legacy)[0].addOperations[0]));
			const out = result(legacy);
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: [operation]})).toEqual(out);
			expect(operation.data.resolved).not.toHaveProperty("version");
			if (id === ids[0]) expect(out.trait).toEqual(creature.trait);
			if (id === ids[3]) expect(out.languages).toEqual(creature.languages);
		}
		const drac = source("Adult Bronze Dragon");
		const oldM1 = compileCreatureTransformation({resolved: resolve(ids[0]), current: drac, inputs: {age: "adult", trueDragon: true, shadowDragon: false, physiology: "amphibious-only", lairActions: "retain"}});
		expect(oldM1.selectedOptions["automation-physiology"]).toEqual(["amphibious-only"]);
		expect(oldM1.changes.filter(it => it.op === "addEntry")).toHaveLength(2);
		const oldM2 = compileCreatureTransformation({resolved: resolve(ids[2]), current: source("Bugbear")});
		expect(oldM2.selectedOptions).toEqual({"automation-numerics": ["zombie-dmg-m2a"]});
		expect(oldM2.changes.some(it => it.entry?.name === "Undead Fortitude")).toBe(false);
		const races = [{name: "Control Species", source: "TST", size: ["M"], speed: 30, ability: [{dex: 2}]}];
		const before = getCreatureTransformationCandidates({catalog: originalCatalog, races});
		const after = getCreatureTransformationCandidates({catalog, races});
		for (const candidate of before) {
			const current = structuredClone(after.find(it => it.id === candidate.id));
			delete current.automation;
			expect(current).toEqual(candidate);
		}
		expect(() => resolveCreatureTransformation({candidates: after, id: "race:control species|tst", automationVersion: 2})).toThrow(/species/);
	});
});
