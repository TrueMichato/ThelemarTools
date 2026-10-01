import fs from "node:fs";

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/utils-config.js";
import "../../../js/utils-dataloader.js";

import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
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
	it("derives Fairy flight from the effective walking speed and prints the armor restriction after save and reload", () => {
		const fairy = raw.race.find(it => it.name === "Fairy" && it.source === "MPMM");
		const candidates = candidatesFor([fairy]);
		const candidate = candidates.find(it => it.id === "race:fairy|mpmm");
		expect(candidate.changes).toContainEqual({op: "grantRelativeSpeed", mode: "fly", relativeTo: "walk", condition: "noMediumOrHeavyArmor"});
		const recipe = resolve(candidates, candidate.id, {spells: [candidate.optionGroups.find(it => it.id === "spells").options[0].id]});
		const base = {...monster, speed: {walk: 45}};
		const draft = preview(recipe, base);
		expect(draft.proposed.speed).toEqual({walk: 45, fly: {number: 45, condition: "while not wearing medium or heavy armor"}});
		expect(draft.writes).toEqual(expect.arrayContaining([expect.objectContaining({path: "speed.fly", after: draft.proposed.speed.fly})]));
		expect(Parser.getSpeedString(draft.proposed, {styleHint: "classic"})).toMatch(/fly 45 ft\. while not wearing medium or heavy armor/i);
		expect(base.speed).toEqual({walk: 45});
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: base, operation: save(recipe, base)});
		const reloaded = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify(registry.getOperations({creature: base})))});
		expect(reloaded.speed).toEqual(draft.proposed.speed);
		expect(Parser.getSpeedString(reloaded, {styleHint: "classic"})).toContain("while not wearing medium or heavy armor");
	});

	it("grants unconditional swimming after earlier walking changes without copying a race's 30-foot default", () => {
		const lizardfolk = raw.race.find(it => it.name === "Lizardfolk" && it.source === "MPMM");
		const recipe = resolve(candidatesFor([lizardfolk]), "race:lizardfolk|mpmm");
		expect(recipe.changes).toContainEqual({type: "grantRelativeSpeed", mode: "swim", relativeTo: "walk"});
		const faster = {...monster, speed: {walk: 50}};
		expect(preview(recipe, faster).proposed.speed).toEqual({walk: 50, swim: 50});
		const walking = {...recipe, kind: "catalog", id: "catalog:stride|hbr", eligibility: [{}], changes: [{type: "grantSpeed", mode: "walk", feet: 55}]};
		const walkOperation = save(walking);
		const draft = preview(recipe, monster, [walkOperation]);
		expect(draft.proposed.speed).toEqual({walk: 55, swim: 55});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: JSON.parse(JSON.stringify([walkOperation, save(recipe, monster, [walkOperation])]))}).speed).toEqual(draft.proposed.speed);
	});

	it("accepts a single unconditional top-level trait but refuses a movement-only no-op", () => {
		const textOnly = {name: "Cliff Kin", source: "HBR", speed: 30, entries: [{type: "entries", name: "Climbing", entries: ["You have a climbing speed equal to your walking speed."]}]};
		const climber = resolve(candidatesFor([textOnly]), "race:cliff kin|hbr");
		expect(climber.changes).toContainEqual({type: "grantRelativeSpeed", mode: "climb", relativeTo: "walk"});
		expect(preview(climber, {...monster, speed: {walk: 40}}).proposed.speed).toEqual({walk: 40, climb: 40});
		const unchanged = {name: "Unchanged Swimmer", source: "HBR", speed: {walk: 30, swim: true}};
		const recipe = resolve(candidatesFor([unchanged]), "race:unchanged swimmer|hbr");
		expect(recipe.changes).toContainEqual({type: "grantRelativeSpeed", mode: "swim", relativeTo: "walk"});
		expect(() => preview(recipe, {...monster, speed: {walk: 30, swim: 30}})).toThrow(/no executable change/i);
		expect(() => preview({...recipe, changes: [{type: "grantRelativeSpeed", mode: "swim", relativeTo: "walk"}]}, {...monster, speed: {walk: {number: 30, condition: "at night"}}})).toThrow(/unconditional walking speed/i);
		expect(() => preview(recipe, {...monster, speed: {walk: 30, swim: {number: 20, condition: "underwater"}}})).toThrow(/structured swim speed/i);
	});

	it("retains unrestricted flight when adding conditional flight", () => {
		const fairy = raw.race.find(it => it.name === "Fairy" && it.source === "MPMM");
		const candidates = candidatesFor([fairy]);
		const candidate = candidates.find(it => it.id === "race:fairy|mpmm");
		const recipe = resolve(candidates, candidate.id, {spells: [candidate.optionGroups.find(it => it.id === "spells").options[0].id]});
		const base = {...monster, speed: {walk: 45, fly: 20}};
		const draft = preview(recipe, base);
		expect(draft.proposed.speed).toEqual({walk: 45, fly: 20, alternate: {fly: [{number: 45, condition: "while not wearing medium or heavy armor"}]}});
		expect(Parser.getSpeedString(draft.proposed, {styleHint: "classic"})).toMatch(/fly 20 ft\./i);
		expect(Parser.getSpeedString(draft.proposed, {styleHint: "classic"})).toMatch(/fly 45 ft\. while not wearing medium or heavy armor/i);
		const first = save(recipe, base);
		const newWalk = {...recipe, kind: "catalog", id: "catalog:fast|hbr", eligibility: [{}], changes: [{type: "grantSpeed", mode: "walk", feet: 55}]};
		const walkOperation = save(newWalk, base);
		const pending = preview(recipe, base, [walkOperation]);
		expect(pending.proposed.speed.fly).toBe(20);
		expect(pending.proposed.speed.alternate.fly[0].number).toBe(55);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [first]}).speed).toEqual(draft.proposed.speed);
	});

	it("requires a conflict winner when an earlier operation granted the same conditional mode", () => {
		const fairy = raw.race.find(it => it.name === "Fairy" && it.source === "MPMM");
		const candidates = candidatesFor([fairy]);
		const candidate = candidates.find(it => it.id === "race:fairy|mpmm");
		const recipe = resolve(candidates, candidate.id, {spells: [candidate.optionGroups.find(it => it.id === "spells").options[0].id]});
		const earlyFlight = {
			...recipe,
			kind: "catalog",
			id: "catalog:early flight|hbr",
			eligibility: [{}],
			changes: [{type: "grantRelativeSpeed", mode: "fly", relativeTo: "walk", condition: "noMediumOrHeavyArmor"}],
		};
		const fasterWalk = {...earlyFlight, id: "catalog:fast walk|hbr", changes: [{type: "grantSpeed", mode: "walk", feet: 55}]};
		const first = save(earlyFlight);
		const second = save(fasterWalk, monster, [first]);
		const pending = preview(recipe, monster, [first, second]);
		expect(pending.conflicts).toEqual([expect.objectContaining({path: "speed.fly", existing: {number: 30, condition: "while not wearing medium or heavy armor"}, incoming: {number: 55, condition: "while not wearing medium or heavy armor"}})]);
		expect(() => BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: monster, operations: [first, second], preview: pending})).toThrow(/unresolved conflicts/i);
		const decision = {"speed.fly": "incoming"};
		const chosen = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: monster, operations: [first, second], resolved: recipe, dmApproved: true, conflictDecisions: decision});
		const operation = BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: monster, operations: [first, second], preview: chosen, conflictDecisions: decision});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: JSON.parse(JSON.stringify([first, second, operation]))}).speed.fly.number).toBe(55);
	});

	it("does not grant nested options, later-level or temporary movement, or unknown armor restrictions", () => {
		const simic = raw.race.find(it => it.name === "Simic Hybrid" && it.source === "GGR");
		const hadozee = raw.race.find(it => it.name === "Hadozee" && it.source === "AAG");
		const aasimar = raw.race.find(it => it.name === "Aasimar" && it.source === "MPMM");
		const dragonborn = raw.race.find(it => it.name === "Dragonborn (Gem)" && it.source === "FTD");
		const unknown = {
			name: "Restricted Flyer",
			source: "HBR",
			speed: {walk: 30, fly: true},
			entries: [{type: "entries", name: "Flight", entries: ["You have a flying speed equal to your walking speed. You can fly only while concentrating."]}],
		};
		const vague = {name: "Vague Flyer", source: "HBR", speed: {walk: 30, fly: true}, entries: [{type: "entries", name: "Wings", entries: ["You may fly only while it is dark."]}]};
		const candidates = candidatesFor([simic, hadozee, aasimar, dragonborn, unknown, vague]);
		for (const id of ["race:simic hybrid|ggr", "race:aasimar|mpmm", "race:dragonborn (gem)|ftd", "race:restricted flyer|hbr"]) {
			const candidate = candidates.find(it => it.id === id);
			expect(candidate.changes).not.toContainEqual(expect.objectContaining({op: "grantRelativeSpeed", mode: "fly"}));
		}
		expect(candidates.find(it => it.id === "race:simic hybrid|ggr").changes).not.toContainEqual(expect.objectContaining({op: "grantRelativeSpeed", mode: "climb"}));
		expect(candidates.find(it => it.id === "race:simic hybrid|ggr").changes).not.toContainEqual(expect.objectContaining({op: "grantRelativeSpeed", mode: "swim"}));
		expect(candidates.find(it => it.id === "race:hadozee|aag").changes).toContainEqual({op: "grantRelativeSpeed", mode: "climb", relativeTo: "walk"});
		expect(candidates.find(it => it.id === "race:hadozee|aag").changes).not.toContainEqual(expect.objectContaining({op: "grantRelativeSpeed", mode: "fly"}));
		expect(candidates.find(it => it.id === "race:restricted flyer|hbr").manualReview).toContainEqual(expect.objectContaining({field: "traits", reason: expect.stringMatching(/fly speed/)}));
		expect(candidates.find(it => it.id === "race:vague flyer|hbr").changes).not.toContainEqual(expect.objectContaining({op: "grantRelativeSpeed", mode: "fly"}));
	});

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
