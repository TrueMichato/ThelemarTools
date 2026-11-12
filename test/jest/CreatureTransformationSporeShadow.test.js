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
import {getCreatureTransformationCorpusErrors, getCreatureTransformationSchemaErrors, getCreatureTransformationIdentityErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const source = name => structuredClone(mm.find(it => it.name === name && it.source === "MM"));
const sporeId = "catalog:spore servant|mm";
const shadowIds = ["catalog:shadow dragon|mm", "catalog:shadow dragon|beg"];
const resolve = (id, automationVersion = 2, data = catalog) => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races: []}), id, automationVersion});
const target = (baseCreature, id = "one", operations = []) => ({id, label: id, baseCreature, operations});
const shadow = (pb = 6) => ({shadow: {trueDragon: true, shadowfell: "years", proficiencyBonus: pb, stealth: {proficiency: 1, residual: 0}, lair: {mode: "retain"}}});
const batchFor = (id, creature, inputs, extra = {}) => {
	const resolved = resolve(id);
	return previewCreatureTransformationTargets({targets: [target(creature)], resolved, automationInputs: {one: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extra});
};
const result = batch => {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
};
const save = batch => createCreatureTransformationChanges({batch, targets: batch.targets}).map(change => ({...change, addOperations: change.addOperations.map(operation => ({...operation, id: `m7-${change.id}`}))}));
const schema = read("schema/site/creature-transformation.json");
const validate = new Ajv({strict: false}).compile({$defs: schema.$defs, $ref: "#/$defs/compiledSporeShadow"});
const baseline = group => Object.fromEntries(["name", "source", "page", "lairActions", "regionalEffects", "mythicEncounter"].filter(key => Object.hasOwn(group, key)).map(key => [key, structuredClone(group[key])]));
const walk = (value, predicate) => !value || typeof value !== "object" ? [] : [...predicate(value) ? [value] : [], ...Object.values(value).flatMap(part => walk(part, predicate))];
const equipment = (name, isEquipment, token = 1) => ({section: "action", match: {name, source: "MM"}, paragraph: 0, token, equipment: isEquipment});
const attack = (name, text, source = "MM") => ({name, source, entries: [text]});
const spore = (creature, extra = {}) => ({spore: {bindings: {entries: ["action", "bonus", "reaction", "legendary"].flatMap(section => (creature[section] || [])
	.filter(entry => /\{@atk mw(?:,rw)?}/.test(JSON.stringify(entry.entries)) && /\b(?:bludgeoning|piercing|slashing) damage/.test(JSON.stringify(entry.entries)))
	.map(entry => ({section, match: {name: entry.name, source: entry.source || creature.source}, mode: "retain"})))},
...extra}});

describe("M7 source-qualified Spore Servant and independent Shadow profiles", () => {
	it("anchors the actual MM clauses and validates all three exact staged catalog identities", () => {
		const fluff = read("data/bestiary/fluff-bestiary-mm.json");
		const spore = fluff.monsterFluff.find(it => it.name === "Quaggoth Spore Servant");
		const clauses = walk(spore, value => value.type === "entries" && value.name);
		expect(clauses.map(it => it.name)).toEqual(["Retained Characteristics", "Lost Characteristics", "Type", "Alignment", "Speed", "Ability Scores", "Senses", "Condition Immunities", "Languages", "Attacks"]);
		expect(clauses.find(it => it.name === "Speed").entries[0]).toMatch(/all.*10 feet.*minimum of 5/);
		expect(clauses.find(it => it.name === "Lost Characteristics").entries[0]).toMatch(/unless.*piece of equipment/);
		const shadowRule = walk(fluff, value => value.name === "Shadow Dragon Template")[0];
		expect(shadowRule.entries[1]).toMatch(/retains its statistics.*lair actions/);
		expect(walk(shadowRule, value => value.name === "New Action: Shadow Breath")[0].entries[0]).toMatch(/Any damage-dealing breath.*humanoid.*dies.*undead shadow.*immediately after.*under the dragon's control/);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
		for (const [id, profile] of [[sporeId, "spore-servant"], [shadowIds[0], "shadow-dragon-mm"], [shadowIds[1], "shadow-dragon-beg"]]) {
			expect(resolve(id).automation).toEqual({version: 2, profile, rollout: "staged"});
			expect(resolve(id, 1)).not.toHaveProperty("automation");
			const bad = structuredClone(catalog);
			bad.creatureTransformation.find(it => it.automation?.profile === profile).source = "OTHER";
			expect(() => getCreatureTransformationCandidates({catalog: bad, races: []})).toThrow();
			expect([...getCreatureTransformationSchemaErrors({data: bad, filePath: "bad"}), ...getCreatureTransformationIdentityErrors({data: bad, filePath: "bad"})]).not.toEqual([]);
		}
	});

	it("Spore removes only lost characteristics, reduces every speed with the five-foot floor, and keeps chassis/equipment/defenses", () => {
		const creature = source("Scout");
		Object.assign(creature, {save: {dex: "+4", wis: "+3"},
			alignmentPrefix: "Typically ",
			senses: ["darkvision 120 ft.", "truesight 60 ft."],
			senseTags: ["D", "U"],
			speed: {walk: 30, climb: 10, swim: 5, burrow: 0, fly: {number: 20, condition: "while airborne"}, canHover: true, alternate: {fly: [{number: 40, condition: "in wind"}]}},
			languages: ["Common", "telepathy 120 ft."],
			immune: ["fire"],
			resist: ["cold"],
			vulnerable: ["thunder"],
			conditionImmune: ["poisoned"],
			gear: ["shortsword|phb"],
			profBonus: 4,
			pbNote: "+4"});
		const batch = batchFor(sporeId, creature, spore(creature));
		const out = result(batch);
		expect(out).toMatchObject({type: "plant",
			alignment: ["U"],
			alignmentPrefix: "",
			int: 2,
			wis: 6,
			cha: 1,
			passive: 8,
			senses: ["blindsight 30 ft. (blind beyond this radius)"],
			senseTags: ["B"],
			languages: [],
			languageTags: ["CS"],
			speed: {walk: 20, climb: 5, swim: 5, burrow: 5, fly: {number: 10, condition: "while airborne"}, canHover: true, alternate: {fly: [{number: 30, condition: "in wind"}]}}});
		expect(out).not.toHaveProperty("save");
		expect(out).not.toHaveProperty("skill");
		expect(out.trait.map(it => it.name)).toEqual(["Limited Blindsight", "Rapport Orders"]);
		expect(out.trait[1].entries[0]).toMatch(/rapport spores.*most powerful myconid/);
		expect(out.conditionImmune).toEqual(["poisoned", "blinded", "charmed", "frightened", "paralyzed"]);
		expect(out.action.map(it => it.name)).toEqual(["Multiattack", "Shortsword"]);
		expect(out.action[0].entries).toEqual(["The servant makes two melee weapon attacks."]);
		expect(out.action[1]).toEqual(creature.action[1]);
		for (const key of ["ac", "hp", "str", "dex", "con", "size", "immune", "resist", "vulnerable", "gear", "profBonus", "pbNote", "cr"]) expect(out[key]).toEqual(creature[key]);
		expect(batch.previews[0].preview.writes.map(it => it.path)).toEqual(expect.arrayContaining(["save.dex", "save.wis", "skill.stealth", "trait:keen hearing and sight|mm", "action:longbow|mm"]));
	});

	it("Spore removes innate spellcasting and all old special traits, not their source-independent physical chassis", () => {
		const creature = source("Drow");
		const out = result(batchFor(sporeId, creature, spore(creature)));
		expect(out.spellcasting).toEqual([]);
		expect(out.trait.map(it => it.name)).toEqual(["Limited Blindsight", "Rapport Orders"]);
		expect(out.action).toEqual([creature.action[0]]);
		expect(out.type).toBe("plant");
		expect(out.ac).toEqual(creature.ac);
		expect(out.hp).toEqual(creature.hp);
		const quaggoth = source("Quaggoth");
		const servant = result(batchFor(sporeId, quaggoth, spore(quaggoth)));
		expect(servant.action[1]).toEqual(quaggoth.action[1]);
		expect(servant.action[0].entries).toEqual(["The servant makes two attacks: two with its claw."]);
		expect(servant.trait.some(it => it.name === "Wounded Fury")).toBe(false);
	});

	it("Spore executes equipment exceptions per damage component and removes natural poison riders without losing the permitted bite", () => {
		const spider = source("Giant Spider");
		expect(batchFor(sporeId, spider, {spore: {}}).skipped[0].reason).toMatch(/paragraph 0 damage token 1/);
		const natural = result(batchFor(sporeId, spider, spore(spider, {equipmentDamage: [equipment("Bite", false)]})));
		expect(natural.action).toHaveLength(1);
		expect(natural.action[0].entries).toEqual(["{@atk mw} {@hit 5} to hit, reach 5 ft., one creature. {@h}7 ({@damage 1d8 + 3}) piercing damage."]);
		const armed = source("Scout");
		armed.action[1].entries[0] = armed.action[1].entries[0].replace("piercing damage.", "piercing damage plus 3 ({@damage 1d6}) fire damage plus 4 ({@damage 1d8}) cold damage.");
		const mixed = result(batchFor(sporeId, armed, spore(armed, {equipmentDamage: [equipment("Shortsword", true), equipment("Shortsword", false, 2)]})));
		expect(mixed.action[1].entries[0]).toContain("plus 3 ({@damage 1d6}) fire damage.");
		expect(mixed.action[1].entries[0]).not.toContain("cold");
		const retained = result(batchFor(sporeId, spider, spore(spider, {equipmentDamage: [equipment("Bite", true)]})));
		expect(retained.action[0]).toEqual(spider.action[0]);
		expect(retained.action.map(it => it.name)).not.toContain("Web {@recharge 5}");
	});

	it("Spore composes component removals with terminal-rider cleanup without resurrecting rejected damage", () => {
		for (const firstType of ["fire", "cold"]) {
			const creature = source("Scout");
			creature.action = [attack("Shortsword", `{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage plus 3 ({@damage 1d6}) ${firstType} damage plus 4 ({@damage 1d8}) cold damage, and the target must succeed on a {@dc 12} Constitution saving throw, taking 3 ({@damage 1d6}) poison damage on a failed save.`)];
			const inputs = spore(creature, {equipmentDamage: [equipment("Shortsword", false, 1), equipment("Shortsword", true, 2), equipment("Shortsword", false, 3)]});
			const batch = batchFor(sporeId, creature, inputs);
			const out = result(batch);
			expect(out.action).toEqual([attack("Shortsword", "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage plus 4 ({@damage 1d8}) cold damage.")]);
			const operation = JSON.parse(JSON.stringify(save(batch)[0].addOperations[0]));
			delete inputs.spore;
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: [operation]})).toEqual(out);
		}
	});

	it("Spore blocks an inseparable terminal rider rather than deleting an equipment component inside it", () => {
		const creature = source("Scout");
		creature.action = [attack("Shortsword", "{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage, and the target must succeed on a {@dc 12} Constitution saving throw, taking 3 ({@damage 1d6}) fire damage followed by 4 ({@damage 1d8}) cold damage on a failed save.")];
		const blocked = batchFor(sporeId, creature, spore(creature, {equipmentDamage: [equipment("Shortsword", true, 1), equipment("Shortsword", false, 2)]}));
		expect(blocked.previews).toEqual([]);
		expect(blocked.skipped[0].reason).toMatch(/Shortsword\|MM.*terminal.*equipment|terminal.*equipment.*Shortsword\|MM/i);
		const removable = result(batchFor(sporeId, creature, spore(creature, {equipmentDamage: [equipment("Shortsword", false, 1), equipment("Shortsword", false, 2)]})));
		expect(removable.action[0].entries).toEqual(["{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage."]);
	});

	it("Spore blocks compound damage classification, including untagged physical alternatives", () => {
		for (const [rule, decisions] of [["5 fire or piercing damage.", []], ["5 ({@damage 1d6 + 2}) piercing damage plus 3 ({@damage 1d6}) fire or cold damage.", [equipment("Shortsword", true, 1)]]]) {
			const creature = source("Scout");
			creature.action = [attack("Shortsword", `{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}${rule}`)];
			const blocked = batchFor(sporeId, creature, spore(creature, {equipmentDamage: decisions}));
			expect(blocked.previews).toEqual([]);
			expect(blocked.skipped[0].reason).toMatch(/compound.*damage.*action Shortsword\|MM.*paragraph 0/i);
		}
	});

	it.each(shadowIds.flatMap(id => ["bite", "breath"].map(role => [id, role])))("%s blocks compound %s types instead of converting only their last type", (id, role) => {
		for (const types of ["fire or cold", "fire or force", "fire, cold, or lightning"]) {
			const creature = source(role === "bite" ? "Adult Red Dragon" : "Gold Dragon Wyrmling");
			if (role === "bite") creature.action[1].entries[0] = creature.action[1].entries[0].replace("fire damage", `${types} damage`);
			else creature.action[1].entries[1].items[0].entry = creature.action[1].entries[1].items[0].entry.replace("fire damage", `${types} damage`);
			const blocked = batchFor(id, creature, shadow(role === "bite" ? 6 : 2));
			expect(blocked.previews).toEqual([]);
			expect(blocked.skipped[0].reason).toMatch(/compound.*damage.*action (Bite|Breath Weapons \{@recharge 5})\|MM/i);
		}
	});

	it.each(shadowIds)("%s rejects partial compound types in concrete bite and breath snapshots", id => {
		const creature = source("Adult Red Dragon");
		const compiled = compileCreatureTransformation({resolved: resolve(id), current: creature, inputs: shadow()});
		for (const name of ["Bite", "Fire Breath {@recharge 5}"]) {
			const partial = structuredClone(compiled);
			const entry = partial.changes.find(step => step.op === "replaceEntry" && step.match.name === name).entry;
			entry.entries[0] = entry.entries[0].replace("necrotic damage", "fire or necrotic damage");
			expect(() => normalizeCreatureTransformation(partial)).toThrow();
		}
	});

	it("Spore removes baked-in MM Brute and ranged alternatives, but not ungranted extra damage or valid melee attacks", () => {
		const bugbear = source("Bugbear");
		const out = result(batchFor(sporeId, bugbear, spore(bugbear)));
		expect(out.action[0].entries[0]).toContain("6 ({@damage 1d8 + 2}) piercing damage");
		expect(out.action[1].entries[0]).toBe("{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage.");
		const ogre = source("Ogre");
		const servant = result(batchFor(sporeId, ogre, spore(ogre)));
		expect(servant.action[0]).toEqual(ogre.action[0]);
		expect(servant.action[1].entries[0]).toContain("11 ({@damage 2d6 + 4})");
		expect(servant.action[1].entries[0]).not.toContain("range");
	});

	it.each(["M", "L"])("Spore adds the source fallback only without another damage attack (%s size)", size => {
		const creature = source("Scout");
		creature.size = [size];
		creature.str = 16;
		creature.action = [creature.action[2]];
		const out = result(batchFor(sporeId, creature, {spore: {proficiencyBonus: 2}}));
		expect(out.action).toEqual([{name: "Unarmed Strike",
			source: "MM",
			entries: [
				`{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}${size === "L" ? 8 : 5} ({@damage ${size === "L" ? 2 : 1}d4 + 3}) bludgeoning damage.`,
			]}]);
		expect(batchFor(sporeId, creature, {spore: {}}).skipped[0].reason).toMatch(/proficiencyBonus/);
	});

	it("Spore cleans Multiattack references to removed actions without adding attacks or retaining special actions", () => {
		const creature = source("Scout");
		creature.action = [
			attack("Multiattack", "The creature makes three attacks: one with its bite and two with its claws."),
			attack("Bite", "{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}7 ({@damage 2d6}) fire damage."),
			attack("Claw", "{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}7 ({@damage 2d6}) slashing damage."),
		];
		creature.bonus = [attack("Roar", "Creatures must flee.")];
		creature.reaction = [attack("Claw", creature.action[2].entries[0], "HB")];
		const out = result(batchFor(sporeId, creature, spore(creature)));
		expect(out.action.map(it => it.name)).toEqual(["Multiattack", "Claw"]);
		expect(out.action[0].entries[0]).toBe("The servant makes two attacks: two with its claw.");
		expect(out.bonus).toEqual([]);
		expect(out.reaction).toEqual(creature.reaction);
	});

	it("Spore reconciles an explicitly bound mental melee attack after losing mental scores, without altering physical chassis numbers", () => {
		const creature = source("Scout");
		creature.cha = 16;
		creature.action = [attack("Mindblade", "{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}7 ({@damage 1d8 + 3}) slashing damage.")];
		const inputs = {spore: {bindings: {proficiencyBonus: 2,
			entries: [{section: "action",
				match: {name: "Mindblade", source: "MM"},
				mode: "bind",
				numbers: [
					{paragraph: 0, token: 0, kind: "hit", mode: "ability", ability: "cha", proficiency: 1, fixed: 0},
					{paragraph: 0, token: 0, kind: "damage", mode: "ability", ability: "cha", proficiency: 0, fixed: 0, dice: {number: 1, faces: 8}},
				]}]}}};
		const out = result(batchFor(sporeId, creature, inputs));
		expect(out.action[0].entries[0]).toBe("{@atk mw} {@hit -3} to hit, reach 5 ft., one target. {@h}0 ({@damage 1d8 - 5}) slashing damage.");
		expect(out.hp).toEqual(creature.hp);
		expect(out.ac).toEqual(creature.ac);
		expect(batchFor(sporeId, creature, {spore: {}}).skipped[0].reason).toMatch(/mental attack abilities/);
	});

	it("keeps source identity in ambiguous renamed breath decisions and isolates a different-source same-name entry", () => {
		const creature = source("Gold Dragon Wyrmling");
		creature.action[1].name = "Exhalation {@recharge 5}";
		creature.action.push(attack("Bite", "An unrelated HB aura, not a bite attack.", "HB"));
		const inputs = shadow(2);
		expect(batchFor(shadowIds[1], creature, inputs).skipped[0].reason).toMatch(/Classify ambiguous.*Exhalation/);
		inputs.shadow.attacks = [
			{section: "action", match: {name: "Exhalation {@recharge 5}", source: "MM"}, role: "breath"},
			{section: "action", match: {name: "Bite", source: "HB"}, role: "other"},
		];
		const out = result(batchFor(shadowIds[1], creature, inputs));
		expect(out.action.at(-1)).toEqual(creature.action.at(-1));
		expect(out.action[1].entries[1].items[0].entry).toMatch(/necrotic damage.*humanoid/);
		inputs.shadow.attacks.push(inputs.shadow.attacks[0]);
		expect(batchFor(shadowIds[1], creature, inputs).skipped[0].reason).toMatch(/Duplicate/);
	});

	it("Spore blocks unsupported source-dependent mechanics instead of deleting or weakening them speculatively", () => {
		const creature = source("Scout");
		creature.action[0].entries[0] = "While raging, the scout makes two attacks: one with its shortsword and one with its longbow.";
		expect(batchFor(sporeId, creature, spore(creature)).skipped[0].reason).toMatch(/actual per-attack counts/);
		creature.action = [attack("Unusual Attack", "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 piercing damage.")];
		expect(batchFor(sporeId, creature, spore(creature)).skipped[0].reason).toMatch(/untagged or indirect melee capability/);
	});

	it.each(shadowIds)("%s independently executes complete traits, expertise, bite and lethal breath while retaining unrelated statistics", id => {
		const creature = source("Adult Red Dragon");
		const out = result(batchFor(id, creature, shadow()));
		expect(out.skill).toEqual({perception: "+13", stealth: "+12"});
		expect(out.resist).toContain("necrotic");
		const conditional = out.resist.find(it => typeof it === "object");
		expect(conditional.resist).not.toEqual(expect.arrayContaining(["force", "psychic", "radiant"]));
		expect(conditional.note).toMatch(/dim light or darkness/);
		const templateSource = id.endsWith("|mm") ? "MM" : "BEG";
		expect(out.trait.slice(-3).map(it => [it.name, it.source])).toEqual([["Living Shadow", templateSource], ["Shadow Stealth", templateSource], ["Sunlight Sensitivity", templateSource]]);
		expect(out.trait.at(-3).entries[0]).toMatch(/dim light or darkness.*force, psychic, and radiant/);
		expect(out.trait.at(-2).entries[0]).toMatch(/dim light or darkness.*Hide.*bonus action/);
		expect(out.trait.at(-1).entries[0]).toMatch(/sunlight.*attack rolls.*Wisdom.*Perception.*sight/);
		expect(out.action[1].entries[0]).toBe("{@atk mw} {@hit 14} to hit, reach 10 ft., one target. {@h}19 ({@damage 2d10 + 8}) piercing damage plus 7 ({@damage 2d6}) necrotic damage.");
		const breath = out.action.at(-1).entries[0];
		expect(breath).toMatch(/60-foot cone.*dc 21.*63.*18d6.*necrotic damage.*half as much/);
		expect(breath).toMatch(/humanoid.*0 hit points.*dies.*undead.*shadow\|MM.*corpse.*under the dragon's control.*immediately after the dragon.*initiative/i);
		for (const key of Object.keys(creature).filter(key => !["skill", "resist", "trait", "action"].includes(key))) expect(out[key]).toEqual(creature[key]);
		for (const index of [0, 2, 3, 4]) expect(out.action[index]).toEqual(creature.action[index]);
		expect(out.legendary).toEqual(creature.legendary);
		expect(out.legendaryGroup).toEqual(creature.legendaryGroup);
	});

	it.each(shadowIds)("%s preserves shared recharge, metallic nondamaging alternatives, all damage types and bite negatives", id => {
		const creature = source("Gold Dragon Wyrmling");
		const out = result(batchFor(id, creature, shadow(2)));
		expect(out.skill.stealth).toBe("+6");
		expect(out.action[0]).toEqual(creature.action[0]);
		expect(out.action[1].name).toBe("Breath Weapons {@recharge 5}");
		expect(out.action[1].entries[1].items[0].entry).toMatch(/4d10.*necrotic damage.*humanoid/);
		expect(out.action[1].entries[1].items[1]).toEqual(creature.action[1].entries[1].items[1]);
		for (const type of ["force", "psychic", "radiant", "thunder", "slashing"]) {
			const gem = source("Gold Dragon Wyrmling");
			gem.action[0].entries[0] += ` It also deals 4 ({@damage 1d8}) ${type} damage.`;
			gem.action[1].entries[1].items[0].entry = gem.action[1].entries[1].items[0].entry.replace(/fire damage/, `${type} damage`);
			const transformed = result(batchFor(id, gem, shadow(2)));
			expect(transformed.action[0]).toEqual(gem.action[0]);
			expect(transformed.action[1].entries[1].items[0].entry).toMatch(/necrotic damage.*humanoid/);
		}
	});

	it.each(shadowIds)("%s attaches every lethal-breath consequence only to the damaging mode", id => {
		const creature = source("Gold Dragon Wyrmling");
		const out = result(batchFor(id, creature, shadow(2)));
		const modes = out.action[1].entries[1].items;
		expect(modes[0].entry).toMatch(/humanoid.*0 hit points.*dies/i);
		expect(modes[0].entry).toMatch(/undead.*shadow\|MM.*rises from the corpse.*under the dragon's control.*immediately after the dragon.*initiative/i);
		expect(modes[1]).toEqual(creature.action[1].entries[1].items[1]);
		expect(modes[1].entry).not.toMatch(/humanoid|shadow\|MM|dies/);
	});

	it.each(shadowIds)("%s binds actual PB, authored Stealth residuals and no preexisting proficiency without inferring from CR", id => {
		const creature = source("Adult Bronze Dragon");
		creature.profBonus = 7;
		creature.pbNote = "+7";
		creature.skill.stealth = "+10";
		const inputs = shadow(7);
		inputs.shadow.stealth.residual = 3;
		const out = result(batchFor(id, creature, inputs));
		expect(out.skill.stealth).toBe("+17");
		expect(out.profBonus).toBe(7);
		expect(out.cr).toEqual(creature.cr);
		const none = source("Adult Bronze Dragon");
		delete none.skill.stealth;
		const noProficiency = shadow(5);
		noProficiency.shadow.stealth.proficiency = 0;
		expect(result(batchFor(id, none, noProficiency)).skill.stealth).toBe("+10");
		const already = source("Adult Bronze Dragon");
		already.skill.stealth = "+10";
		const expert = shadow(5);
		expert.shadow.stealth.proficiency = 2;
		expect(result(batchFor(id, already, expert)).skill.stealth).toBe("+10");
	});

	it.each(shadowIds)("%s executes source-discretionary lair loss/inheritance against the complete effective source baseline", id => {
		const creature = source("Adult Bronze Dragon");
		const raw = read("data/bestiary/legendarygroups.json").legendaryGroup.find(it => it.name === "Bronze Dragon" && it.source === "MM");
		expect(raw.regionalEffects).toHaveLength(4);
		const inputs = shadow(5);
		inputs.shadow.lair = {mode: "replace", baseline: baseline(raw), actions: []};
		const out = result(batchFor(id, creature, inputs, {legendaryGroups: [raw]}));
		expect(out.legendaryGroup).toEqual({...baseline(raw), lairActions: []});
		expect(out.legendaryGroup.regionalEffects).toEqual(expect.arrayContaining([expect.objectContaining({source: "FTD"})]));
		expect(out.legendary).toEqual(creature.legendary);
		expect(DataUtil.monster.getLegendaryGroup(out)).toEqual(out.legendaryGroup);
		for (const context of [undefined, [], [creature.legendaryGroup], [raw, raw]]) expect(batchFor(id, creature, inputs, {legendaryGroups: context}).skipped[0].reason).toMatch(/complete.*legendary group/);
		for (const partial of [{...baseline(raw), regionalEffects: []}, {...baseline(raw), regionalEffects: raw.regionalEffects.slice(0, 3)}]) {
			const invalid = structuredClone(inputs);
			invalid.shadow.lair.baseline = partial;
			expect(batchFor(id, creature, invalid, {legendaryGroups: [raw]}).skipped[0].reason).toMatch(/complete actual.*baseline/);
		}
		const inline = structuredClone(creature);
		inline.legendaryGroup = {...baseline(raw), mythicEncounter: ["Retained existing mythic encounter rules."]};
		inputs.shadow.lair.baseline = baseline(inline.legendaryGroup);
		inputs.shadow.lair.actions = [{type: "entries", name: "Inherited darkness", entries: ["On initiative count 20 (losing ties), extinguish nonmagical flames within 60 feet."]}];
		const inherited = result(batchFor(id, inline, inputs));
		expect(inherited.legendaryGroup.mythicEncounter).toEqual(inline.legendaryGroup.mythicEncounter);
		expect(inherited.legendaryGroup.lairActions).toEqual(inputs.shadow.lair.actions);
	});

	it("blocks precise missing, unknown, duplicate and inapplicable choices instead of success-shaped partial profiles", () => {
		const spider = source("Giant Spider");
		for (const decisions of [[], [equipment("Unknown", false)], [equipment("Bite", false), equipment("Bite", false)], [equipment("Bite", false, 0)]]) {
			expect(batchFor(sporeId, spider, {spore: {equipmentDamage: decisions}}).previews).toEqual([]);
		}
		for (const inputs of [{}, {spore: {unknown: true}}, {spore: {proficiencyBonus: 2}}, {spore: {}, cr: {}}]) expect(batchFor(sporeId, source("Scout"), inputs).previews).toEqual([]);
		for (const [field, value] of [["size", ["H"]], ["type", "undead"], ["speed", {walk: true}]]) {
			const creature = source("Scout");
			creature[field] = value;
			expect(batchFor(sporeId, creature, {spore: {}}).previews).toEqual([]);
		}
		for (const id of [sporeId, ...shadowIds]) {
			const creature = source(id === sporeId ? "Scout" : "Adult Red Dragon");
			creature.action = [null];
			const blocked = batchFor(id, creature, id === sporeId ? {spore: {}} : shadow());
			expect(blocked.skipped[0].reason).toMatch(/action needs concrete entries/);
		}
		for (const mutate of [
			it => { delete it.shadow.proficiencyBonus; },
			it => { it.shadow.stealth.proficiency = 2; },
			it => { it.shadow.trueDragon = false; },
			it => { it.shadow.shadowfell = "brief"; },
			it => { it.shadow.lair = {mode: "remove-legendary"}; },
			it => { it.shadow.attacks = [{section: "action", match: {name: "Bite", source: "MM"}, role: "other"}]; },
			it => { it.shadow.attacks = [{section: "action", match: {name: "Unknown", source: "MM"}, role: "breath"}]; },
		]) {
			const inputs = shadow();
			mutate(inputs);
			expect(batchFor(shadowIds[0], source("Adult Red Dragon"), inputs).previews).toEqual([]);
		}
	});

	it.each([sporeId, ...shadowIds])("freezes %s through real Registry and Encounter preview/operation/JSON Store replay/removal", async id => {
		const creature = source(id === sporeId ? "Drow" : "Adult Bronze Dragon");
		const inputs = id === sporeId ? spore(creature) : shadow(5);
		const rawGroup = read("data/bestiary/legendarygroups.json").legendaryGroup.find(it => it.name === "Bronze Dragon" && it.source === "MM");
		const groups = [structuredClone(rawGroup)];
		if (id !== sporeId) inputs.shadow.lair = {mode: "replace", baseline: baseline(rawGroup), actions: []};
		const live = structuredClone(catalog);
		const resolved = resolve(id, 2, live);
		const batch = batchFor(id, creature, inputs, {resolved, legendaryGroups: groups});
		const out = result(batch);
		const concrete = compileCreatureTransformation({resolved, current: creature, inputs, legendaryGroups: groups});
		expect(validate(concrete)).toBe(true);
		expect(validate.errors).toBeNull();
		const operation = JSON.parse(JSON.stringify(save(batch)[0].addOperations[0]));
		const registry = new BestiaryQuickActionsRegistry();
		const operationId = registry.addOperation({creature, operation});
		let state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: {name: "M7", saveId: "spore-shadow", items: [{h: "subject_mm", c: 1}]},
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
		groups[0].regionalEffects.length = 0;
		groups.length = 0;
		delete inputs.shadow;
		delete inputs.spore;
		state = await store.pLoad();
		expect(JSON.stringify(adapter.getOperations())).toBe(bytes);
		expect(adapter.getCreature()).toEqual(out);
		expect(registry.getCreature({creature})).toEqual(out);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: JSON.parse(bytes)})).toEqual(out);
		const corrupt = JSON.parse(bytes);
		corrupt[0].data.resolved.changes[0].type = "setReanimationType";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: corrupt})).toThrow();
		await expect(adapter.addOperation({operation: corrupt[0]})).rejects.toThrow();
		expect(JSON.stringify(adapter.getOperations())).toBe(bytes);
		await adapter.removeOperation({operationId: operation.id});
		state = await store.pLoad();
		expect(adapter.getCreature()).toEqual(creature);
		registry.removeOperation({creature, operationId});
		expect(registry.getCreature({creature})).toEqual(creature);
	});

	it("uses actual prior history, isolates failed targets and keeps all source-dependent conflicts coherent", () => {
		const creature = source("Adult Red Dragon");
		const skeleton = resolve("catalog:skeleton|dmg");
		const historical = batchFor(skeleton.id, creature, {reanimation: {}, bindings: {armor: {mode: "retain"}, entries: ["trait", "action", "legendary"].flatMap(section => (creature[section] || []).map(entry => ({section, match: {name: entry.name, source: creature.source}, mode: "retain"})))}}, {resolved: skeleton});
		const prior = save(historical)[0].addOperations;
		prior.push({id: "restore-dragon", type: "patch", data: {patch: {type: "dragon"}}});
		const targets = [target(creature, "historical", prior), target(creature, "plain"), target({...creature, type: "undead"}, "ineligible")];
		const resolved = resolve(shadowIds[0]);
		const inputs = Object.fromEntries(targets.map(it => [it.id, shadow()]));
		const options = {targets, resolved, automationInputs: inputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true};
		const initial = previewCreatureTransformationTargets(options);
		expect(initial.previews.map(it => it.id)).toEqual(["historical", "plain"]);
		expect(initial.skipped.map(it => it.id)).toEqual(["ineligible"]);
		expect(initial.previews[0].preview.conflicts.some(it => it.path === "skill.stealth")).toBe(true);
		const incoming = {historical: Object.fromEntries(initial.previews[0].preview.conflicts.map(it => [it.path, "incoming"]))};
		const accepted = previewCreatureTransformationTargets({...options, conflictDecisions: incoming});
		expect(accepted.previews[0].preview.proposed.skill.stealth).toBe("+13");
		expect(accepted.previews[1].preview.proposed.skill.stealth).toBe("+12");
		const existing = {historical: Object.fromEntries(initial.previews[0].preview.conflicts.map(it => [it.path, "existing"]))};
		const retained = previewCreatureTransformationTargets({...options, conflictDecisions: existing});
		expect(retained.previews[0].preview.proposed).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: creature, operations: prior}));
		const saved = createCreatureTransformationChanges({batch: accepted, targets, conflictDecisions: incoming});
		expect(saved.map(it => it.id)).toEqual(["historical", "plain"]);
	});

	it("Spore deletion paths conflict with actual prior save/skill writes and forbid mixed dependent winners", () => {
		const creature = source("Scout");
		const priorBatch = batchFor("catalog:skeleton|dmg", creature, {reanimation: {}, bindings: {armor: {mode: "retain"}, entries: creature.action.slice(1).map(entry => ({section: "action", match: {name: entry.name, source: "MM"}, mode: "retain"}))}});
		const prior = save(priorBatch)[0].addOperations;
		prior.push({id: "restore-living-type", type: "patch", data: {patch: {type: creature.type}}});
		const targets = [target(creature, "one", prior)];
		const resolved = resolve(sporeId);
		const options = {targets, resolved, automationInputs: {one: spore(creature)}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true};
		const first = previewCreatureTransformationTargets(options);
		const conflicts = first.previews[0].preview.conflicts;
		expect(conflicts.map(it => it.path)).toEqual(expect.arrayContaining(["skill.stealth", "int", "cha"]));
		const incoming = {one: Object.fromEntries(conflicts.map(it => [it.path, "incoming"]))};
		const accepted = previewCreatureTransformationTargets({...options, conflictDecisions: incoming});
		expect(accepted.previews[0].preview.proposed).not.toHaveProperty("skill");
		const mixed = structuredClone(incoming);
		mixed.one["skill.stealth"] = "existing";
		expect(previewCreatureTransformationTargets({...options, conflictDecisions: mixed}).skipped[0].reason).toMatch(/one conflict winner/);
	});

	it("fences stale inputs/source context/history, consent, storage failures, legacy setter injection and other families", () => {
		const creature = source("Adult Bronze Dragon");
		const inputs = shadow(5);
		const batch = batchFor(shadowIds[0], creature, inputs);
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, automationInputs: {one: shadow(6)}})).toThrow(/stale/);
		expect(() => createCreatureTransformationChanges({batch, targets: [target({...creature, dex: 14})]})).toThrow(/stale/);
		expect(() => batchFor(shadowIds[0], creature, inputs, {acknowledgedPrerequisites: []})).toThrow(/prerequisite/);
		expect(batchFor(shadowIds[0], creature, inputs, {dmApproved: false}).previews).toEqual([]);
		expect(batchFor(shadowIds[0], creature, inputs, {validateOperation: () => { throw new Error("storage ceiling"); }}).skipped[0].reason).toMatch(/storage ceiling/);
		const invalid = compileCreatureTransformation({resolved: resolve(shadowIds[0]), current: creature, inputs});
		invalid.changes.push({op: "setSporeCharacteristics", speed: {walk: 20}});
		expect(validate(invalid)).toBe(false);
		expect(() => normalizeCreatureTransformation(invalid)).toThrow();
		const noDeath = compileCreatureTransformation({resolved: resolve(shadowIds[0]), current: creature, inputs});
		noDeath.changes.find(step => step.op === "replaceEntry").entry.entries[1].items[0].entry = "Each creature takes 66 ({@damage 12d10}) necrotic damage.";
		expect(() => normalizeCreatureTransformation(noDeath)).toThrow();
		const noTraitLoss = compileCreatureTransformation({resolved: resolve(sporeId), current: source("Scout"), inputs: spore(source("Scout"))});
		noTraitLoss.changes = noTraitLoss.changes.filter(step => step.op !== "removeEntry");
		expect(() => normalizeCreatureTransformation(noTraitLoss)).toThrow();
		const noBreath = compileCreatureTransformation({resolved: resolve(shadowIds[0]), current: creature, inputs});
		noBreath.changes = noBreath.changes.filter(step => step.op !== "replaceEntry");
		expect(() => normalizeCreatureTransformation(noBreath)).toThrow();
		const noFallback = compileCreatureTransformation({resolved: resolve(sporeId), current: {...source("Scout"), action: []}, inputs: {spore: {proficiencyBonus: 2}}});
		noFallback.changes = noFallback.changes.filter(step => step.entry?.name !== "Unarmed Strike");
		expect(() => normalizeCreatureTransformation(noFallback)).toThrow();
		for (const speed of [{walk: 0}, {canHover: true}, {walk: 20, alternate: {teleport: [20]}}]) {
			const badSpeed = compileCreatureTransformation({resolved: resolve(sporeId), current: source("Scout"), inputs: spore(source("Scout"))});
			badSpeed.changes[0].speed = speed;
			expect(validate(badSpeed)).toBe(false);
			expect(() => normalizeCreatureTransformation(badSpeed)).toThrow();
		}
		const legacy = resolve(shadowIds[0], 1);
		legacy.changes.push({op: "setShadowLair", value: {name: "Other", source: "MM", lairActions: []}});
		expect(() => normalizeCreatureTransformation(legacy)).toThrow(/version-2/);
		const raw = read("data/bestiary/legendarygroups.json").legendaryGroup.find(it => it.name === "Bronze Dragon" && it.source === "MM");
		inputs.shadow.lair = {mode: "replace", baseline: baseline(raw), actions: []};
		const withContext = batchFor(shadowIds[0], creature, inputs, {legendaryGroups: [raw]});
		expect(() => createCreatureTransformationChanges({batch: withContext, targets: withContext.targets, legendaryGroups: []})).toThrow(/stale/);
	});
});
