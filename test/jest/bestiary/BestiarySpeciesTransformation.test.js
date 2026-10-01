import fs from "node:fs";

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/utils-config.js";
import "../../../js/utils-dataloader.js";

import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {previewCreatureTransformationTargets} from "../../../js/bestiary/bestiary-transformation-workflow.js";

const catalog = {creatureTransformation: []};
const raw = JSON.parse(fs.readFileSync(new URL("../../../data/races.json", import.meta.url), "utf8"));
const monster = {
	name: "Goblin",
	source: "MM",
	size: ["S"],
	type: "humanoid",
	cr: "1/4",
	str: 8,
	dex: 14,
	con: 10,
	int: 10,
	wis: 8,
	cha: 8,
	ac: [{ac: 15}],
	hp: {average: 7, formula: "2d6"},
	speed: {walk: 30},
	action: [{name: "Scimitar", entries: ["{@atk mw} {@hit +4} to hit. {@h}{@damage 1d6 + 2} slashing damage."]}],
};
const candidatesFor = races => getCreatureTransformationCandidates({
	catalog,
	races,
	getVersions: race => DataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
});
const resolve = (candidates, id, selections = {}) => normalizeCreatureTransformation(resolveCreatureTransformation({candidates, id, selections}));
const preview = (resolved, base = monster, operations = []) => BestiaryQuickActionsUtil.previewCreatureTransformation({
	baseCreature: base, operations, resolved, dmApproved: true,
});
const save = (resolved, base = monster, operations = []) => {
	const draft = preview(resolved, base, operations);
	return BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations, preview: draft});
};

describe("species mechanics on a retained encounter chassis", () => {
	it("applies classic fixed stats and source-qualified High Elf traits while leaving attacks and HP unchanged", () => {
		const elf = raw.race.find(it => it.name === "Elf" && it.source === "PHB");
		const high = raw.subrace.find(it => it.name === "High" && it.raceName === "Elf" && it.raceSource === "PHB");
		const merged = DataUtil.race.getPostProcessedSiteJson({race: [elf], subrace: [high]}, {isAddBaseRaces: true}).race;
		const recipe = resolve(candidatesFor(merged), "race:elf (high)|phb");
		const draft = preview(recipe);
		expect(draft.proposed).toMatchObject({
			size: ["M"],
			type: "humanoid",
			dex: 16,
			int: 11,
			hp: monster.hp,
			ac: monster.ac,
			action: monster.action,
			speed: monster.speed,
			languages: expect.arrayContaining(["Common", "Elvish"]),
			senses: ["darkvision 60 ft."],
		});
		expect(draft.proposed.trait).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fey Ancestry", source: "PHB"}),
			expect.objectContaining({name: "Elf Weapon Training", source: "PHB"}),
		]));
		expect(draft.proposed.skill).toBeUndefined();
		expect(recipe.manualReview).toContainEqual(expect.objectContaining({field: "traits", reason: expect.stringMatching(/roll|proficiency/i)}));
		expect(recipe.manualReview).toContainEqual(expect.objectContaining({field: "spellcasting", reason: expect.stringMatching(/choose/i)}));
		const operation = save(recipe);
		const effective = BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: JSON.parse(JSON.stringify([operation]))});
		expect(effective.dex).toBe(16);
		expect(effective.trait.find(it => it.name === "Fey Ancestry")?.entries).toEqual(draft.proposed.trait.find(it => it.name === "Fey Ancestry")?.entries);
		expect(monster.dex).toBe(14);
	});

	it("keeps 2024 dragonborn versions separate, preserves a nested Breath Weapon, and does not fabricate level-5 flight", () => {
		const dragonborn = raw.race.find(it => it.name === "Dragonborn" && it.source === "XPHB");
		const candidates = candidatesFor([dragonborn]);
		const red = resolve(candidates, "race:dragonborn (red)|xphb~v:dragonborn|xphb:8");
		const draft = preview(red);
		expect(draft.proposed).toMatchObject({size: ["M"], resist: ["fire"], hp: monster.hp, action: monster.action});
		const breath = draft.proposed.trait.find(it => it.name === "Breath Weapon");
		expect(breath.source).toBe("XPHB");
		expect(breath.entries.some(it => typeof it === "string" && /fire damage/i.test(it))).toBe(true);
		expect(draft.proposed.speed.fly).toBeUndefined();
		expect(red.manualReview).toContainEqual(expect.objectContaining({field: "characterLevel"}));
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [save(red)]}).trait).toEqual(draft.proposed.trait);
	});

	it("requires a real 2024 Elf spell tradition and casting ability without granting later-level spells", () => {
		const elf = raw.race.find(it => it.name === "Elf" && it.source === "XPHB");
		const candidates = candidatesFor([elf]);
		const candidate = candidates.find(it => it.id === "race:elf|xphb");
		const group = candidate.optionGroups.find(it => it.id === "spells");
		expect(group.required).toBe(true);
		expect(group.options).toHaveLength(9);
		expect(() => resolve(candidates, candidate.id)).toThrow("Invalid selection");
		const drow = group.options.find(it => it.name === "Drow (CHA)");
		const recipe = resolve(candidates, candidate.id, {spells: [drow.id]});
		const draft = preview(recipe);
		expect(draft.proposed.spellcasting).toEqual(expect.arrayContaining([
			expect.objectContaining({will: ["{@spell dancing lights|xphb}"]}),
		]));
		expect(JSON.stringify(draft.proposed.spellcasting)).not.toContain("faerie fire");
		expect(recipe.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "characterLevel", reason: expect.stringMatching(/level 3/i)})]));
	});

	it("offers explicit finite ability, size, language, defense, and spellcasting-ability choices for homebrew", () => {
		const brew = {
			name: "Ember Kin",
			source: "HBR",
			size: ["S", "M"],
			ability: [{cha: 2, choose: {from: ["str", "wis"], count: 1}}],
			blindsight: 30,
			languageProficiencies: [{common: true, choose: {from: ["draconic", "primordial"], count: 1}}],
			resist: [{choose: {from: ["cold", "fire"], count: 1}}],
			additionalSpells: [{ability: {choose: ["int", "cha"]}, known: {"1": ["light#c"]}, innate: {"_": {daily: {"1": ["burning hands|phb"]}}, "3": {daily: {"1": ["fireball|phb"]}}}}],
			entries: [{type: "entries", name: "Ancient Flame", entries: ["The kin shines.", {type: "list", items: [{type: "item", name: "Glow", entry: "It sheds dim light."}]}]}],
		};
		const candidates = candidatesFor([brew]);
		const entry = candidates.find(it => it.id === "race:ember kin|hbr");
		expect(entry.optionGroups.map(it => it.id)).toEqual(["size", "ability", "resist", "languages", "spells"]);
		const selected = Object.fromEntries(entry.optionGroups.map(it => [it.id, [it.options.at(-1).id]]));
		const recipe = resolve(candidates, entry.id, selected);
		expect(recipe.changes).toEqual(expect.arrayContaining([{type: "adjustAbility", ability: "cha", amount: 2, floor: 1}]));
		const draft = preview(recipe);
		expect(draft.proposed).toMatchObject({size: ["M"], cha: 10, wis: 9, languages: expect.arrayContaining(["Common", "Primordial"]), resist: ["fire"], senses: ["blindsight 30 ft."]});
		expect(draft.proposed.trait[0].entries[1]).toEqual(brew.entries[0].entries[1]);
		expect(draft.proposed.spellcasting).toEqual(expect.arrayContaining([
			expect.objectContaining({daily: {"1e": ["{@spell burning hands|phb}"]}}),
			expect.objectContaining({will: ["{@spell light|phb}"]}),
		]));
		expect(draft.proposed.spellcasting.some(it => JSON.stringify(it).includes("fireball"))).toBe(false);
		expect(recipe.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "spellcasting", reason: expect.stringMatching(/level 3/i)})]));
		const applied = BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: JSON.parse(JSON.stringify([save(recipe)]))});
		expect(applied.spellcasting).toEqual(draft.proposed.spellcasting);
	});

	it("casts prepared cantrips at will and flags non-concrete spell usages and abilities", () => {
		const candidates = candidatesFor([
			{name: "Twilight Kin",
				source: "HBR",
				additionalSpells: [{
					ability: "cha",
					prepared: {"_": ["light#c"]},
					known: {"_": {_: ["detect magic|phb"], rest: {"1": ["shield|phb"]}}},
					innate: {"_": {will: {choose: ["fire bolt|phb"]}}},
				}]},
			{name: "Unclear Mage",
				source: "HBR",
				additionalSpells: [{
					ability: {choose: ["cha"], conditional: true},
					innate: {"_": {will: ["light|phb"]}},
				}]},
		]);
		const twilight = resolve(candidates, "race:twilight kin|hbr");
		expect(twilight.changes).toEqual(expect.arrayContaining([{type: "grantSpell", spell: "light|phb", source: "HBR", usage: "will", ability: "cha"}]));
		expect(twilight.manualReview).toEqual(expect.arrayContaining([
			expect.objectContaining({field: "spellcasting", reason: expect.stringMatching(/additional known spell usage/)}),
			expect.objectContaining({field: "spellcasting", reason: expect.stringMatching(/non-concrete innate at-will/)}),
		]));
		expect(JSON.stringify(preview(twilight).proposed.spellcasting)).not.toContain("fire bolt");
		const unclear = resolve(candidates, "race:unclear mage|hbr");
		expect(unclear.changes).not.toEqual(expect.arrayContaining([expect.objectContaining({type: "grantSpell"})]));
		expect(unclear.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "spellcasting", reason: expect.stringMatching(/ability/)})]));
	});

	it("marks unsupported nested and choice data, and refuses a species with no executable change", () => {
		const unsupported = {name: "Unresolved Kin", source: "HBR", creatureTypes: ["humanoid"], size: ["T", "X"], entries: [{type: "script", name: "Unsafe", entries: ["no"]}]};
		const candidates = candidatesFor([unsupported]);
		const recipe = resolve(candidates, "race:unresolved kin|hbr");
		expect(recipe.manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "traits", reason: expect.stringMatching(/Unsafe/)})]));
		const same = {...monster, type: "humanoid", size: ["S"]};
		expect(() => preview(recipe, same)).toThrow(/no executable change/i);
		const batch = previewCreatureTransformationTargets({targets: [{id: "one", label: "Goblin", baseCreature: same, operations: []}], resolved: resolveCreatureTransformation({candidates, id: "race:unresolved kin|hbr"}), dmApproved: true});
		expect(batch.previews).toHaveLength(0);
		expect(batch.skipped[0].reason).toMatch(/no executable change/i);
		const legacy = BestiaryCreatureTransformation.preview({
			original: same, current: same, resolved: recipe, dmApproved: true, allowLegacyNoEffect: true,
		});
		expect(legacy.writes).toEqual([]);
		expect(() => BestiaryCreatureTransformation.createOperation({preview: legacy, currentPreview: legacy})).toThrow(/no executable change/i);
	});

	it("rejects malformed nested traits and spells, preserves old operations, conflicts and stale previews", () => {
		const invalid = {id: "race:bad|hbr", kind: "race", identity: {name: "Bad", source: "HBR"}, provenance: {edition: "unverified"}, eligibility: [{dmApproval: true}], prerequisites: [], selectedOptions: {}, manualReview: [], changes: [{type: "addEntry", section: "trait", entry: {name: "Unsafe", source: "HBR", entries: [{type: "script", text: "bad"}]}}]};
		expect(() => BestiaryCreatureTransformation.preview({original: monster, current: monster, resolved: invalid, dmApproved: true})).toThrow(/entry|unsupported/i);
		expect(() => normalizeCreatureTransformation({...invalid, changes: [{op: "grantSpell", spell: "{@spell fireball}", source: "HBR", usage: "will"}]})).toThrow(/unsupported/i);
		const old = {type: "setAbility", ability: "str", value: 12};
		const previous = {...invalid, kind: "catalog", id: "catalog:old|hbr", changes: [old]};
		const prior = save(previous);
		prior.id = "old";
		const race = resolve(candidatesFor([{name: "Stone Kin", source: "HBR", size: ["M"], ability: [{str: 2}]}]), "race:stone kin|hbr");
		const pending = preview(race, monster, [prior]);
		expect(pending.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({path: "str"})]));
		const decisions = Object.fromEntries(pending.conflicts.map(it => [it.path, "incoming"]));
		const approved = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: monster, operations: [prior], resolved: race, dmApproved: true, conflictDecisions: decisions});
		const op = BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: monster, operations: [prior], preview: approved, conflictDecisions: decisions});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [prior, op]}).str).toBe(14);
		expect(() => BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: monster, operations: [], preview: approved, conflictDecisions: decisions})).toThrow(/non-conflicting|stale/i);
	});
});
