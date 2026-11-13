import fs from "node:fs";
import childProcess from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {observeCreatureTransformationBindings} from "../../js/creature-transformation-bindings.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsOperations, BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {compileCreatureTransformationInputs, inspectCreatureTransformationInputs} from "../../js/bestiary/bestiary-transformation-inputs.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationSchemaErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const schema = read("schema/site/creature-transformation.json");
const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledUndead"});
const source = name => structuredClone(mm.find(monster => monster.name === name && monster.source === "MM"));
const target = (baseCreature = source("Tyrannosaurus Rex"), operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const find = (out, name, section = "trait") => out[section]?.find(entry => entry.name === name);
const rules = (out, name, section = "trait") => JSON.stringify(find(out, name, section));
const pending = (category = "skeletal", selections = {}, version = 2, data = catalog) => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog: data, races: []}),
	id: "catalog:undead|scre",
	selections: {category: [category], ...selections},
	automationVersion: version,
});
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
const previousConfig = globalThis.VetoolsConfig;
const previousPrerelease = globalThis.PrereleaseUtil;
const previousBrew = globalThis.BrewUtil2;
beforeAll(() => {
	globalThis.VetoolsConfig = {get: () => "classic"};
	globalThis.PrereleaseUtil = globalThis.BrewUtil2 = {hasSourceJson: () => false};
});
afterAll(() => {
	globalThis.VetoolsConfig = previousConfig;
	globalThis.PrereleaseUtil = previousPrerelease;
	globalThis.BrewUtil2 = previousBrew;
});

// These fixture declarations deliberately choose Strength for weapon hit/first
// damage, the authored casting ability for spells, and source-fixed other riders.
function bindings (base) {
	return {armor: {mode: "retain"},
		entries: observeCreatureTransformationBindings({current: base}).filter(entry => entry.needsBinding).map(entry => ({
			section: entry.section,
			match: entry.match,
			mode: "bind",
			numbers: entry.tokens.map(token => {
				const ability = entry.section === "spellcasting" ? entry.entry.ability : ["hit", "damage"].includes(token.kind) && /\{@atk [^}]*w}/.test(JSON.stringify(entry.entry.entries)) && (token.kind === "hit" || token.token === 0) ? "str" : undefined;
				const proficiency = token.kind === "damage" ? 0 : 1;
				const pb = base.profBonus ?? Parser.crToPb(base.cr?.cr ?? base.cr);
				return {paragraph: token.paragraph,
					kind: token.kind,
					token: token.token,
					...ability ? {mode: "ability", ability, proficiency, fixed: token.value - Parser.getAbilityModNumber(base[ability]) - proficiency * pb} : {mode: "fixed", value: token.value},
					...token.dice ? {dice: token.dice} : {}};
			}),
		}))};
}
function weaponComponents (base) {
	return ["trait", "action", "bonus", "reaction", "legendary"].flatMap(section => (base[section] || []).filter(entry => /\{@atk [^}]*w}/.test(JSON.stringify(entry.entries))).map(entry => ({
		section,
		match: {name: entry.name, source: entry.source || base.source},
		components: [...JSON.stringify(entry.entries).matchAll(/\{@damage [^{}]+}\)?\s+(?:bludgeoning|piercing|slashing) damage/g)].map((_part, index) => index),
	})));
}
function parentControl () {
	return {name: "Parent control",
		source: "TST",
		size: ["M"],
		type: "humanoid",
		alignment: ["N", "G"],
		ac: [12],
		hp: {average: 22, formula: "4d8 + 4"},
		speed: {walk: 30},
		str: 14,
		dex: 16,
		con: 12,
		int: 10,
		wis: 12,
		cha: 18,
		cr: "5"};
}
function inputs (base, category, decisions = {}) {
	return {undead: {...["skeletal", "mummified", "zombie", "ghostly"].includes(category) ? {bindings: bindings(base)} : {},
		...category === "ghostly" ? {ghostAbility: "dex"} : {},
		...decisions}};
}
function compile (base, category, selections = {}, decisions = {}) {
	return compileCreatureTransformation({resolved: pending(category, selections), current: base, inputs: inputs(base, category, decisions)});
}
function preview (subject = target(), category = "skeletal", selections = {}, decisions = {}, extra = {}) {
	const resolved = pending(category, selections);
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: subject.operations});
	return previewCreatureTransformationTargets({targets: [subject],
		resolved,
		automationInputs: {[subject.id]: inputs(current, category, decisions)},
		acknowledgedPrerequisites: resolved.prerequisites,
		dmApproved: true,
		...extra});
}
function outcome (batch) {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
}
function owner (batch, conflictDecisions) {
	return {...createCreatureTransformationChanges({batch, targets: batch.targets, ...conflictDecisions ? {conflictDecisions} : {}})[0].addOperations[0], id: "undead-owner"};
}
async function encounter (base) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M12", saveId: "m12", items: [{h: "tyrannosaurus rex_mm", c: 2}]},
		pResolveItem: async () => ({entity: base}),
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

describe("M12 Undead|SCRE complete selected source clauses", () => {
	it.each(["ghostly", "skeletal", "vampiric", "zombie", "ghoulish", "mummified"])("compiles %s from an actual MM chassis, preserving unrelated capabilities and CR", category => {
		const base = source("Tyrannosaurus Rex");
		const selections = category === "ghostly" ? {"ghostly-strikes": ["withering-strikes"]} : {};
		const decisions = category === "ghostly" ? {ghostWeapons: weaponComponents(base)} : {};
		const out = outcome(preview(target(base), category, selections, decisions));
		const raw = compile(base, category, selections, decisions);
		expect(validate(JSON.parse(JSON.stringify(raw)))).toBe(true);
		expect(validate.errors).toBeNull();
		expect(out.type).toBe("undead");
		expect(out.alignment).toEqual(["U"]);
		expect(out.resist).toContain("necrotic");
		expect(out.immune).toContain("poison");
		expect(out.conditionImmune).toEqual(expect.arrayContaining(["poisoned", "exhaustion"]));
		expect(out.senses).toContain(category === "vampiric" ? "darkvision 120 ft." : "darkvision 60 ft.");
		expect(rules(out, "Undead Nature")).toMatch(/air, food, drink, or sleep/);
		for (const key of ["name", "source", "size", "hp", "ac", "con", "dex", "cr", "languages", "environment"]) expect(out[key]).toEqual(base[key]);
		if (category === "ghostly") {
			expect(out.str).toBe(12);
			expect(out.speed).toEqual({walk: 0, fly: 50, canHover: true});
			expect(rules(out, "Incorporeal Movement")).toMatch(/difficult terrain.*5.*1d10.*force damage.*ends its turn inside an object/);
			expect(rules(out, "Bite", "action")).toContain("{@hit 3}");
			expect(rules(out, "Bite", "action")).toContain("26 ({@damage 4d12}) necrotic damage");
			expect(rules(out, "Bite", "action")).toMatch(/escape.*17.*restrained/);
			expect(out.conditionImmune).toEqual(expect.arrayContaining(["charmed", "frightened", "grappled", "paralyzed", "petrified", "prone", "restrained"]));
		}
		if (category === "skeletal" || category === "zombie") {
			expect(out.int).toBe(2);
			expect(out.wis).toBe(6);
			expect(out.cha).toBe(4);
			expect(out.skill.perception).toBe("+1");
			expect(out.passive).toBe(11);
			expect(out.action).toEqual(base.action);
			if (category === "skeletal") expect(out.vulnerable).toContain("bludgeoning");
			else {
				expect(out.speed.walk).toBe(40);
				expect(rules(out, "Undead Fortitude")).toMatch(/Constitution.*5 \+ the damage taken.*radiant.*critical hit.*1 hit point/);
			}
		}
		if (category === "vampiric") {
			expect(rules(out, "Bite", "action")).toMatch(/Draining Strikes \(1\/Turn\).*living creature.*2d6.*hit point maximum.*regains hit points.*long rest.*dies/);
			expect(rules(out, "Regeneration")).toMatch(/10 hit points.*start of its turn.*at least 1 hit point.*sunlight or running water.*radiant damage.*holy water.*next turn/);
			expect(rules(out, "Spider Climb")).toMatch(/upside down.*ability check/);
			expect(find(out, "Forbiddance")).toBeUndefined();
		}
		if (category === "ghoulish") expect(rules(out, "Ghoulish Strikes (1/Turn)")).toMatch(/other than an elf or undead.*15.*Constitution.*paralyzed.*1 minute.*end of each.*success/);
		if (category === "mummified") {
			expect(out.int).toBe(1);
			expect(out.speed.walk).toBe(25);
			expect(rules(out, "Rotting Strikes")).toMatch(/Whenever.*hits a target with an attack.*2d6.*15.*can't regain hit points.*every 24 hours.*dies.*dust.*remove curse/);
		}
		expect(find(out, "Deathly Aura")).toBeUndefined();
		expect(find(out, "Dreadful Glare", "action")).toBeUndefined();
		expect(base).toEqual(source("Tyrannosaurus Rex"));
	});

	it("does not transplant the worked Hydra/T Rex abilities, CR, damage, defenses or optional picks", () => {
		const base = source("Hydra");
		const out = outcome(preview(target(base), "mummified", {miscellaneous: ["overwhelming-necrosis", "turn-immunity"]}));
		expect(out.str).toBe(base.str);
		expect(out.int).toBe(Math.floor(base.int / 2) || 1);
		expect(out.speed).toEqual({walk: 20, swim: 20});
		expect(out.cr).toEqual(base.cr);
		expect(out.hp).toEqual(base.hp);
		expect(out.action).toEqual(base.action);
		expect(find(out, "Multiple Heads")).toEqual(find(base, "Multiple Heads"));
		expect(rules(out, "Rotting Strikes")).toContain("{@dc 16}");
		expect(rules(out, "Overwhelming Necrosis")).toMatch(/ignores resistance.*0 hit points.*one death saving throw failure/);
		expect(find(out, "Turn Immunity")).toBeDefined();
	});

	it.each([
		["deathly-aura", "Deathly Aura", /start of each.*non-undead.*5 feet.*5.*1d10.*cold damage/],
		["detect-life", "Detect Life", /magically.*living creatures.*5 miles.*aren't undead or constructs.*general direction.*not their exact/],
		["ethereal-sight", "Ethereal Sight", /120 feet.*Ethereal Plane.*Material Plane.*vice versa/],
		["magic-resistance", "Magic Resistance", /advantage.*saving throws.*spells.*magical effects/],
		["necrotic-absorption", "Necrotic Absorption", /immune.*necrotic.*no damage.*regains hit points equal/],
		["overwhelming-necrosis", "Overwhelming Necrosis", /ignores resistance.*0 hit points.*one death saving throw failure/],
		["sunlight-sensitivity", "Sunlight Sensitivity", /sunlight.*disadvantage.*attack rolls.*Wisdom \(Perception\).*rely on sight/],
		["turn-immunity", "Turn Immunity", /immune.*effect that turns undead/],
		["turn-resistance", "Turn Resistance", /advantage.*saving throws.*effect that turns undead/],
		["touch-of-death", "Touch of Death (1/Day)", /hits a creature.*melee attack.*8d8.*necrotic/],
	])("gives %s its actual rule only when selected", (id, name, expected) => {
		const base = source("Tyrannosaurus Rex");
		expect(find(outcome(preview(target(base), "skeletal")), name)).toBeUndefined();
		const out = outcome(preview(target(base), "skeletal", {miscellaneous: [id]}));
		expect(rules(out, name)).toMatch(expected);
		if (id === "necrotic-absorption") expect(out.immune).toContain("necrotic");
	});

	it("binds both innate spells to post-category WIS or CHA with proper daily/will uses and preserves unrelated casting", () => {
		const base = source("Mage");
		for (const ability of ["wis", "cha"]) {
			const out = outcome(preview(target(base), "skeletal", {miscellaneous: ["bestow-curse", "chill-touch"]}, {alignment: ["N", "E"], spellAbility: ability, components: ["V", "S"]}));
			const spell = out.spellcasting.find(entry => entry.source === "SCRE");
			const mod = Parser.getAbilityModNumber(out[ability]);
			expect(spell.ability).toBe(ability);
			expect(spell.daily).toEqual({"1e": ["{@spell bestow curse|PHB}"]});
			expect(spell.will).toEqual(["{@spell chill touch|PHB}"]);
			expect(spell.headerEntries.join(" ")).toContain(`{@dc ${8 + mod + 3}}`);
			expect(spell.headerEntries.join(" ")).toContain(`{@hit ${mod + 3}}`);
			expect(out.spellcasting[0].spells).toEqual(base.spellcasting[0].spells);
			expect(out.spellcasting[0].headerEntries.join(" ")).toMatch(/Intelligence.*dc 9.*hit 1/);
			const html = Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), out).find(entry => entry.name === "Innate Spellcasting (Undead)").rendered;
			expect(html.replace(/<[^>]+>/g, "")).toContain(`DC ${8 + mod + 3}`);
			expect(html).toContain("1/day each");
			expect(html).toMatch(/bestow curse/i);
			expect(html).toMatch(/chill touch/i);
		}
		expect(preview(target(base), "skeletal", {miscellaneous: ["bestow-curse"]}, {alignment: ["N", "E"]}).skipped[0].reason).toMatch(/spellAbility/);
		expect(outcome(preview(target(base), "skeletal", {}, {alignment: ["N", "E"]})).spellcasting).toHaveLength(1);
	});

	it("implements Headless and Dreadful Glare with source eligibility, sight, immunity window and Multiattack integration", () => {
		const base = {...source("Tyrannosaurus Rex"), senses: ["truesight 30 ft.", "blindsight 90 ft."]};
		const out = outcome(preview(target(base), "skeletal", {miscellaneous: ["headless", "dreadful-glare"]}, {headless: true, glareAbility: "cha"}));
		expect(out.senses).toEqual(["truesight 30 ft.", "blindsight 90 ft.", "darkvision 60 ft."]);
		expect(rules(out, "Headless")).toMatch(/formerly had eyes or a head.*blind beyond/);
		expect(rules(out, "Dreadful Glare", "action")).toMatch(/one creature it can see within 60 feet.*target can see.*8.*Wisdom.*magic.*frightened.*end of this creature's next turn.*by 5 or more.*paralyzed.*same duration.*succeeds.*all undead.*24 hours/);
		expect(rules(out, "Multiattack", "action")).toContain("can also use its Dreadful Glare as part of this Multiattack");
		expect(rules(out, "Multiattack", "action")).toContain(base.action[0].entries[0]);
		const html = Renderer.get().render({type: "entries", ...find(out, "Dreadful Glare", "action")});
		expect(html.replace(/<[^>]+>/g, "")).toMatch(/60 feet.*DC 8.*by 5 or more.*all undead.*24 hours/);
		expect(preview(target(base), "skeletal", {miscellaneous: ["headless"]}, {headless: false}).skipped[0].reason).toMatch(/former eyes or a head/);
	});

	it("accepts selected or retained dependencies, rejects missing ones, and applies cross-category options without relaxing v1", () => {
		const base = source("Tyrannosaurus Rex");
		const selections = {"ghostly-features": ["etherealness"], miscellaneous: ["ethereal-sight", "shadow-stealth", "sunlight-sensitivity"], "ghoulish-features": ["ghoulish-strikes", "stench"], "mummified-features": ["rotting-strikes"]};
		const out = outcome(preview(target(base), "skeletal", selections));
		expect(rules(out, "Etherealness", "action")).toMatch(/Ethereal Plane.*Material Plane.*visible.*Border Ethereal.*can't affect or be affected.*other plane/);
		expect(rules(out, "Shadow Stealth", "bonus")).toMatch(/dim light or darkness.*Hide.*bonus action/);
		expect(rules(out, "Stench")).toMatch(/starts its turn within 5 feet.*15.*poisoned.*start of its next turn.*successful.*immune.*24 hours/);
		expect(find(out, "Rotting Strikes")).toBeDefined();
		expect(() => pending("skeletal", selections, 1)).toThrow(/requires category/);
		for (const pick of [{"ghostly-features": ["etherealness"]}, {miscellaneous: ["shadow-stealth"]}]) expect(preview(target(base), "skeletal", pick).previews).toEqual([]);
		base.trait = [{name: "Ethereal Sight", source: "HB", entries: ["See into the Ethereal Plane."]}, {name: "Sunlight Sensitivity", source: "HB", entries: ["Sight-sensitive."]}];
		expect(outcome(preview(target(base), "skeletal", {"ghostly-features": ["etherealness"], miscellaneous: ["shadow-stealth"]})).trait).toEqual(expect.arrayContaining(base.trait));
	});

	it.each([[1, 3, "1d6"], [2, 3, "1d6"], [4, 3, "1d6"], [5, 7, "2d6"]])("uses CR %s for Stench/Turn Immunity/rotting thresholds, not the selected name or estimated CR", (cr, amount, dice) => {
		const base = {...source("Hydra"), cr: `${cr}`, profBonus: 4};
		const out = outcome(preview(target(base), "mummified"));
		expect(rules(out, "Rotting Strikes")).toContain(`extra ${amount} ({@damage ${dice}})`);
		expect(rules(out, "Rotting Strikes")).toContain(`decreases by ${amount} ({@dice ${dice}}) for every 24 hours`);
		expect(preview(target(base), "ghoulish", {"ghoulish-features": ["stench"]}).previews).toHaveLength(cr >= 2 ? 1 : 0);
		expect(preview(target(base), "ghoulish", {miscellaneous: ["turn-immunity"]}).previews).toHaveLength(cr >= 5 ? 1 : 0);
	});

	it("implements all selected vampire weaknesses, including destruction rather than the old catalog's paralysis summary", () => {
		for (const intelligence of [5, 6]) {
			const base = {...source("Hydra"), int: intelligence};
			const selected = {"vampiric-weaknesses": ["running-water", "stake-to-heart", "sunlight", ...intelligence >= 6 ? ["forbiddance"] : []]};
			const out = outcome(preview(target(base), "vampiric", selected));
			expect(rules(out, "Harmed by Running Water")).toMatch(/20 acid damage.*ends its turn.*running water/);
			expect(rules(out, "Stake to the Heart")).toMatch(/destroyed.*piercing weapon made of wood.*heart.*incapacitated.*resting place/);
			expect(rules(out, "Sunlight Hypersensitivity")).toMatch(/20 radiant damage.*starts its turn in sunlight.*disadvantage.*attack rolls and ability checks/);
			expect(!!find(out, "Forbiddance")).toBe(intelligence >= 6);
			expect(preview(target(base), "vampiric", {"vampiric-weaknesses": ["forbiddance"]}).previews).toHaveLength(intelligence >= 6 ? 1 : 0);
		}
	});

	it("preserves stronger defenses/senses/type metadata, and asks for unusual type/alignment instead of silently inventing them", () => {
		const base = {...source("Hydra"),
			type: {type: "monstrosity", tags: ["retained"], swarmSize: "H"},
			alignment: ["C", "G"],
			senses: ["darkvision 240 ft.", "tremorsense 30 ft."],
			immune: ["fire", "necrotic"],
			resist: ["cold", "bludgeoning"],
			skill: {perception: "+9"}};
		const out = outcome(preview(target(base), "skeletal"));
		expect(out.type).toEqual({...base.type, type: "undead"});
		expect(out.alignment).toEqual(["C", "E"]);
		expect(out.senses).toEqual(base.senses);
		expect(out.immune).toEqual(expect.arrayContaining(base.immune));
		expect(out.resist).toEqual(base.resist);
		expect(out.skill.perception).toBe("+6");
		expect(outcome(preview(target(base), "skeletal", {}, {alignment: ["L", "G"]})).alignment).toEqual(["L", "G"]);
		expect(preview(target({...base, alignment: [{alignment: ["N"], chance: 50}]}), "skeletal").skipped[0].reason).toMatch(/alignment/);
		expect(preview(target({...base, type: "ooze"}), "skeletal").skipped[0].reason).toMatch(/allowUnusualType/);
		expect(outcome(preview(target({...base, type: "ooze"}), "skeletal", {}, {allowUnusualType: true})).type).toBe("undead");
	});

	it("uses finite guided decisions tied to the exact target/source/history and rejects stale or arbitrary fields", () => {
		const subject = target();
		const resolved = pending("skeletal");
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		expect(model.status).toBe("needs-answers");
		expect(model.controls[0].facts.decisionKeys).toContain("bindings");
		const answers = {targetKey: model.targetKey, controls: {[model.controls[0].id]: {value: inputs(subject.baseCreature, "skeletal").undead, reason: "Reviewed the real source-qualified target."}}};
		const projected = compileCreatureTransformationInputs({target: subject, resolved, answers});
		expect(projected.status).toBe("ready");
		expect(projected.projection).toEqual(outcome(preview(subject)));
		expect(compileCreatureTransformationInputs({target: {...subject, id: "two"}, resolved, answers}).status).toBe("needs-answers");
		expect(compileCreatureTransformationInputs({target: {...subject, operations: [patch("changed", {wis: 20})]}, resolved, answers}).status).toBe("needs-answers");
		for (const decisions of [{path: "hp"}, {spellAbility: "cha"}, {bindings: {armor: {mode: "retain"}, entries: []}}]) expect(preview(subject, "skeletal", {}, decisions).previews).toEqual([]);
		expect(preview(subject, "vampiric", {}, {proficiencyBonus: "unused"}).skipped[0].reason).toMatch(/proficiencyBonus decision is unrelated or stale/);
	});

	it("resolves Ghostly attack ability and physical components without changing unrelated elemental riders or spell-only attacks", () => {
		const base = {...source("Tyrannosaurus Rex"), dex: 18, cha: 20};
		base.action.push({name: "Cold Ray", source: "HB", entries: ["{@atk rs} {@hit 8} to hit, range 60 ft., one target. {@h}9 ({@damage 2d8}) cold damage."]});
		base.action[1].entries[0] += " The attack also deals 7 ({@damage 2d6}) fire damage.";
		for (const [ability, hit, damage, type] of [["dex", 7, "4d12 + 4", "force"], ["cha", 8, "4d12 + 5", "necrotic"], ["str", 4, "4d12 + 1", "force"]]) {
			const decisions = {ghostAbility: ability, ghostDamage: type, ghostWeapons: weaponComponents(base)};
			const out = outcome(preview(target(base), "ghostly", {}, decisions));
			expect(rules(out, "Bite", "action")).toContain(`{@hit ${hit}}`);
			expect(rules(out, "Bite", "action")).toContain(`{@damage ${damage}}) ${type} damage`);
			expect(rules(out, "Bite", "action")).toContain("{@damage 2d6}) fire damage");
			expect(find(out, "Cold Ray", "action")).toEqual(find(base, "Cold Ray", "action"));
		}
		const mixed = source("Tyrannosaurus Rex");
		mixed.action = [{name: "Mixed", source: "HB", entries: ["{@atk mw,ms} {@hit 10} to hit. {@h}33 ({@damage 4d12 + 7}) piercing damage, or 7 ({@damage 2d6}) slashing damage as a spell."]}];
		const choice = [{section: "action", match: {name: "Mixed", source: "HB"}, components: [0]}];
		const out = outcome(preview(target(mixed), "ghostly", {"ghostly-strikes": ["spectral-strikes"]}, {ghostWeapons: choice}));
		expect(rules(out, "Mixed", "action")).toContain("force damage, or 7 ({@damage 2d6}) slashing damage as a spell");
		expect(preview(target(base), "ghostly").skipped[0].reason).toMatch(/ghostDamage/);
		expect(preview(target(base), "ghostly", {"ghostly-strikes": ["spectral-strikes"]}, {ghostWeapons: []}).skipped[0].reason).toMatch(/Bind each source-qualified weapon/);
	});

	it("handles speed minima, zero modes, structured alternatives and explicit ambiguous movement ordering without losing conditions", () => {
		const base = {...source("Hydra"), speed: {walk: 10, swim: {number: 35, condition: "in water"}, fly: 0, alternate: {walk: [40]}}};
		expect(outcome(preview(target(base), "zombie")).speed).toEqual({walk: 5, swim: {number: 25, condition: "in water"}, fly: 0, alternate: {walk: [30]}});
		expect(outcome(preview(target(base), "mummified")).speed).toEqual({walk: 20, swim: {number: 20, condition: "in water"}, fly: 0, alternate: {walk: [20]}});
		const odd = {...base, speed: {walk: 55}};
		expect(preview(target(odd), "mummified").skipped[0].reason).toMatch(/movementRounding/);
		expect(outcome(preview(target(odd), "mummified", {}, {movementRounding: "down"})).speed.walk).toBe(27);
		expect(outcome(preview(target(odd), "mummified", {}, {movementRounding: "up"})).speed.walk).toBe(28);
		const flying = {...base, speed: {walk: 50, fly: {number: 90, condition: "with wings"}, swim: 80, climb: 20, alternate: {fly: [120], swim: [100]}}};
		const ghost = {ghostDamage: "force", ghostWeapons: weaponComponents(base)};
		expect(outcome(preview(target(flying), "ghostly", {}, ghost)).speed).toEqual({walk: 0, fly: {number: 90, condition: "with wings"}, canHover: true, alternate: {fly: [120]}});
		const conditional = {...base, speed: {walk: 30, swim: {number: 50, condition: "while immersed"}, burrow: 10}};
		expect(preview(target(conditional), "ghostly", {}, ghost).skipped[0].reason).toMatch(/ghostFlight/);
		expect(outcome(preview(target(conditional), "ghostly", {}, {...ghost, ghostFlight: {mode: "swim"}})).speed).toEqual({walk: 0, fly: 30, canHover: true, alternate: {fly: [{number: 50, condition: "while immersed"}]}});
		const combined = {...base, speed: {walk: 40, swim: 35}};
		const extra = {additionalTraits: ["ghost-flight"], bindings: bindings(combined)};
		expect(preview(target(combined), "zombie", {}, extra).skipped[0].reason).toMatch(/movementOrder/);
		expect(outcome(preview(target(combined), "zombie", {}, {...extra, movementOrder: ["slowed-movement", "ghost-flight"]})).speed).toEqual({walk: 0, fly: 30, canHover: true});
	});

	it("M12 correction: grants sourced Ghostly flight when the existing flying speed is zero", () => {
		const base = {...parentControl(), speed: {walk: 30, fly: 0}};
		const out = outcome(preview(target(base), "ghostly", {}, {ghostAbility: "str", ghostDamage: "force", ghostWeapons: []}));
		expect(out.speed).toEqual({walk: 0, fly: 30, canHover: true});
	});

	it("M12 correction: preserves positive conditional/alternate flight while deriving flight for structured zero modes", () => {
		const decisions = {ghostAbility: "str", ghostDamage: "force", ghostWeapons: []};
		for (const fly of [{number: 0}, {number: 0, condition: "while its wings are spread"}]) {
			const base = {...parentControl(), speed: {walk: 30, fly, alternate: {fly: [{number: 80, condition: "while in darkness"}]}}};
			expect(outcome(preview(target(base), "ghostly", {}, decisions)).speed).toEqual({walk: 0, fly: 30, canHover: true, alternate: base.speed.alternate});
		}
		const conditional = {...parentControl(), speed: {walk: 30, fly: 0, swim: {number: 50, condition: "while immersed"}}};
		expect(outcome(preview(target(conditional), "ghostly", {}, {...decisions, ghostFlight: {mode: "swim"}})).speed).toEqual({walk: 0, fly: 30, canHover: true, alternate: {fly: [conditional.speed.swim]}});
		const positive = {...parentControl(), speed: {walk: 30, fly: {number: 40, condition: "while its wings are spread"}, alternate: {fly: [{number: 80, condition: "while in darkness"}]}}};
		expect(outcome(preview(target(positive), "ghostly", {}, decisions)).speed).toEqual({walk: 0, fly: positive.speed.fly, canHover: true, alternate: positive.speed.alternate});
	});

	it("M12 correction: blocks untagged explicit weapon attacks instead of succeeding with unchanged physical damage", () => {
		const base = {...parentControl(), action: [{name: "Spear", entries: ["Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage."]}]};
		const batch = preview(target(base), "ghostly", {}, {ghostAbility: "str", ghostDamage: "force", ghostWeapons: []});
		expect(batch.previews.map(({preview: result}) => ({canApply: result.canApply, attack: result.proposed.action[0].entries}))).toEqual([]);
		expect(batch.skipped[0].reason).toMatch(/unsupported.*untagged.*action.*Spear.*TST/i);
	});

	it("M12 correction: blocks partial or unresolved attack shapes but retains tagged spell-only physical damage", () => {
		const decisions = {ghostAbility: "str", ghostDamage: "force", ghostWeapons: []};
		for (const entry of [
			"Melee or Ranged Weapon Attack: +5 to hit. Hit: 5 (1d6 + 2) piercing damage.",
			"{@atk mw} {@hit 5} to hit. Hit: 5 (1d6 + 2) piercing damage.",
			"{@atkr m} {@hit 5} to hit. {@h}5 ({@damage 1d6 + 2}) piercing damage.",
			"{@atk rs} {@hit 5} to hit. {@h}5 ({@damage 1d6 + 2}) fire damage. Melee Weapon Attack: +5 to hit. Hit: 5 (1d6 + 2) piercing damage.",
		]) {
			const base = {...parentControl(), action: [{name: "Mixed", source: "HB", entries: [entry]}]};
			const batch = preview(target(base), "ghostly", {}, decisions);
			expect(batch.previews).toEqual([]);
			expect(batch.skipped[0].reason).toMatch(/unsupported.*action.*Mixed.*HB/i);
		}
		const base = {...parentControl(), action: [{name: "Stone Ray", source: "HB", entries: ["{@atk rs} {@hit 5} to hit. {@h}5 ({@damage 1d6 + 2}) piercing damage."]}]};
		const out = outcome(preview(target(base), "ghostly", {}, decisions));
		expect(out.action).toEqual(base.action);
	});

	it("uses explicit source-qualified fallback melee bindings for Draining Strikes, and has no invented half-CR pick cap", () => {
		const base = source("Tyrannosaurus Rex");
		base.action = base.action.filter(entry => entry.name !== "Bite");
		expect(preview(target(base), "vampiric").skipped[0].reason).toMatch(/drainAttack/);
		const decisions = {drainAttack: {section: "action", match: {name: "Tail", source: "MM"}}};
		expect(rules(outcome(preview(target(base), "vampiric", {}, decisions)), "Tail", "action")).toMatch(/Draining Strikes.*1\/Turn.*living creature.*2d6/);
		expect(preview(target(base), "vampiric", {}, {drainAttack: {section: "action", match: {name: "Multiattack", source: "MM"}}}).previews).toEqual([]);
		base.cr = "1/8";
		const picks = ["deathly-aura", "detect-life", "magic-resistance", "turn-resistance", "overwhelming-necrosis", "touch-of-death"];
		const out = outcome(preview(target(base), "ghoulish", {miscellaneous: picks}));
		expect(rules(out, "Touch of Death (1/Day)")).toContain("{@damage 1d8}");
		expect(find(out, "Deathly Aura")).toBeDefined();
		expect(find(out, "Detect Life")).toBeDefined();
		expect(find(out, "Magic Resistance")).toBeDefined();
	});

	it("reconciles post-category saves, expertise/passive residuals and spell DCs from actual declarations, not a feature label", () => {
		const base = {...source("Mage"), alignment: ["N"], save: {int: "+7", wis: "+9"}, skill: {arcana: "+10", perception: "+12"}, passive: 25};
		const out = outcome(preview(target(base), "mummified", {}, {alignment: ["N", "E"]}));
		expect(out.int).toBe(8);
		expect(out.save.int).toBe("+3");
		expect(out.save.wis).toBe("+9");
		expect(out.skill.arcana).toBe("+6");
		expect(out.passive).toBe(25);
		expect(out.spellcasting[0].headerEntries[0]).toContain("{@dc 10}");
		expect(out.spellcasting[0].headerEntries[0]).toContain("{@hit 2}");
		expect(out.spellcasting[0].spells).toEqual(base.spellcasting[0].spells);
	});

	it("requires explicit ordering for overlapping category ability clauses and keeps unconditional senses beside stronger conditional senses", () => {
		const base = {...source("Hydra"), int: 20, senses: ["darkvision 120 ft. while in darkness", "blindsight 90 ft. while immersed"]};
		const choices = {additionalTraits: ["skeletal-abilities"], senses: [{sense: "darkvision", index: 0, range: 120}]};
		expect(preview(target(base), "mummified", {}, choices).skipped[0].reason).toMatch(/abilityOrder/);
		const first = outcome(preview(target(base), "mummified", {}, {...choices, abilityOrder: ["mummy-abilities", "skeletal-abilities"]}));
		const second = outcome(preview(target(base), "mummified", {}, {...choices, abilityOrder: ["skeletal-abilities", "mummy-abilities"]}));
		expect(first.int).toBe(6);
		expect(second.int).toBe(3);
		expect(first.senses).toEqual([...base.senses, "darkvision 60 ft."]);
		const head = outcome(preview(target(base), "skeletal", {miscellaneous: ["headless"]}, {headless: true, senses: [{sense: "darkvision", index: 0, range: 120}, {sense: "blindsight", index: 1, range: 90}]}));
		expect(head.senses).toEqual([...base.senses, "darkvision 60 ft.", "blindsight 60 ft."]);
		expect(rules(head, "Headless")).toMatch(/unconditional blindsight.*60 feet.*retains any greater conditional.*blind beyond its applicable/);
	});

	it("composes every finite category clause with every miscellaneous pick without dropping attack, spell or curse riders", () => {
		const base = {...source("Hydra"), int: 20, wis: 18, cha: 16, speed: {walk: 40, swim: 40}};
		const selected = {"ghostly-strikes": ["spectral-strikes"], "ghostly-features": ["etherealness"], "ghoulish-features": ["stench"], miscellaneous: catalog.creatureTransformation.find(recipe => recipe.name === "Undead").optionGroups.find(group => group.id === "miscellaneous").options.map(option => option.id)};
		const extra = ["ghost-flight", "ghost-abilities", "ghost-defenses", "incorporeal-movement", "skeletal-abilities", "skeletal-vulnerability", "physical-resistance", "superior-darkvision", "draining-strikes", "regeneration", "spider-climb", "slowed-movement", "zombie-abilities", "undead-fortitude", "ghoulish-immunity", "ghoulish-strikes", "mummy-movement", "mummy-abilities", "mummy-defenses", "rotting-strikes"];
		const out = outcome(preview(target(base), "ghoulish", selected, {additionalTraits: extra, abilityOrder: ["ghost-abilities", "skeletal-abilities", "zombie-abilities", "mummy-abilities"], movementOrder: ["slowed-movement", "mummy-movement", "ghost-flight"], bindings: bindings(base), ghostAbility: "cha", ghostWeapons: weaponComponents(base), headless: true, spellAbility: "wis", components: ["V", "S"], glareAbility: "cha"}));
		expect([out.int, out.wis, out.cha]).toEqual([1, 4, 4]);
		expect(out.speed).toEqual({walk: 0, fly: 20, canHover: true});
		expect(out.senses).toEqual(["darkvision 120 ft.", "blindsight 60 ft."]);
		expect(out.immune).toEqual(expect.arrayContaining(["poison", "necrotic"]));
		expect(out.vulnerable).toEqual(expect.arrayContaining(["fire", "bludgeoning"]));
		expect(rules(out, "Bite", "action")).toMatch(/force damage.*Draining Strikes.*2d6.*hit point maximum.*long rest.*dies/);
		expect(rules(out, "Rotting Strikes")).toMatch(/2d6.*every 24 hours.*dust.*remove curse/);
		expect(rules(out, "Dreadful Glare", "action")).toMatch(/dc 8.*all undead.*24 hours/);
		expect(out.spellcasting[0].headerEntries[0]).toContain("{@dc 8}");
		expect(rules(out, "Shadow Stealth", "bonus")).toContain("bonus action");
		expect(rules(out, "Etherealness", "action")).toContain("other plane");
		expect(rules(out, "Undead Fortitude")).toContain("5 + the damage taken");
	});

	it("detects conditional alternate-speed ownership and refuses mixed winners for the complete source profile", () => {
		const base = {...source("Hydra"), speed: {walk: 40, fly: 10}, senses: []};
		const resolved = normalizeCreatureTransformation({id: "catalog:flight|hb", kind: "catalog", identity: {name: "Flight", source: "HB"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, manualReview: [], changes: [{op: "grantRelativeSpeed", mode: "fly", relativeTo: "walk", condition: "noMediumOrHeavyArmor"}, {op: "grantSense", sense: "darkvision", range: 30}]});
		const prior = {id: "prior", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved})})};
		const subject = target(base, [prior]);
		const conflicts = preview(subject, "mummified").previews[0].preview.conflicts;
		expect(conflicts.map(item => item.path)).toEqual(expect.arrayContaining(["speed.alternate.fly", "senses:darkvision"]));
		const mixed = {one: Object.fromEntries(conflicts.map(item => [item.path, item.path === "senses:darkvision" ? "existing" : "incoming"]))};
		expect(preview(subject, "mummified", {}, {}, {conflictDecisions: mixed}).skipped[0].reason).toMatch(/share one conflict winner/);
	});

	it("replays and removes two actual target histories through Registry and Encounter Store/Adapter without mutable catalog data", async () => {
		const originalCatalog = catalog.creatureTransformation;
		const originalLoader = DataUtil.loadJSON;
		const loader = jest.fn(() => { throw new Error("No live catalog during M12 replay"); });
		const cases = ["Tyrannosaurus Rex", "Hydra"].map((name, index) => {
			const base = source(name);
			const prefix = patch("prefix", {name: `History ${index}`, int: 18, con: 22 + index * 2, cr: index ? "5" : "4", profBonus: 5});
			const subject = target(base, [prefix]);
			const batch = preview(subject, "mummified", {miscellaneous: ["dreadful-glare"]}, {glareAbility: "con"});
			const expected = outcome(batch);
			expect(rules(expected, "Rotting Strikes")).toContain(index ? "{@damage 2d6}" : "{@damage 1d6}");
			expect(rules(expected, "Rotting Strikes")).toContain(`{@dc ${19 + index}}`);
			return {base, prefix, expected, operation: owner(batch)};
		});
		DataUtil.loadJSON = loader;
		try {
			for (const data of [[], [{name: "Undead", source: "SCRE", changes: []}]]) {
				catalog.creatureTransformation = data;
				for (const {base, prefix, expected, operation} of cases) {
					const registry = new BestiaryQuickActionsRegistry();
					const serialized = JSON.stringify([prefix, operation]);
					registry.applyChanges({creature: base, addOperations: JSON.parse(serialized)});
					expect(registry.getCreature({creature: base})).toEqual(expected);
					registry.removeOperation({creature: base, operationId: "undead-owner"});
					const before = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix]});
					expect(registry.getCreature({creature: base})).toEqual(before);
					const saved = persistence(await encounter(base));
					await saved.adapter.applyChanges({addOperations: JSON.parse(serialized)});
					await saved.reload();
					expect(saved.adapter.getCreature()).toEqual(expected);
					expect(saved.adapter.getOperations()).toEqual(JSON.parse(serialized));
					expect(saved.state().instances[1].monster).toEqual(base);
					await saved.adapter.removeOperation({operationId: "undead-owner"});
					await saved.reload();
					expect(saved.adapter.getCreature()).toEqual(before);
					expect(saved.adapter.getOperations()).toEqual([prefix]);
					expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [operation]})).toThrow(/actual pre-owner target|declared ability\/PB\/fixed/);
				}
			}
			expect(loader).not.toHaveBeenCalled();
		} finally { catalog.creatureTransformation = originalCatalog; DataUtil.loadJSON = originalLoader; }
	});

	it("checks complete frozen effects before coherent winners, rejecting tampering and incomplete signed payloads atomically", async () => {
		const base = source("Tyrannosaurus Rex");
		const resolved = normalizeCreatureTransformation({id: "catalog:prior|hb",
			kind: "catalog",
			identity: {name: "Prior", source: "HB"},
			provenance: {edition: "classic"},
			eligibility: [],
			prerequisites: [],
			selectedOptions: {},
			manualReview: [],
			changes: [{op: "grantConditionImmunity", value: "poisoned"}, {op: "grantSense", sense: "darkvision", range: 30}]});
		const priorPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved});
		const prior = {id: "prior", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: priorPreview})};
		const subject = target(base, [prior]);
		const selected = {miscellaneous: ["dreadful-glare"]};
		const batch = preview(subject, "mummified", selected, {glareAbility: "con"});
		const conflicts = batch.previews[0].preview.conflicts;
		expect(conflicts.map(item => item.path)).toContain("senses:darkvision");
		const wins = {one: Object.fromEntries(conflicts.map(item => [item.path, "incoming"]))};
		const keep = {one: Object.fromEntries(conflicts.map(item => [item.path, "existing"]))};
		const accepted = preview(subject, "mummified", selected, {glareAbility: "con"}, {conflictDecisions: wins});
		const operation = owner(accepted, wins);
		expect(outcome(preview(subject, "mummified", selected, {glareAbility: "con"}, {conflictDecisions: keep}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prior]}));
		const registry = new BestiaryQuickActionsRegistry();
		const saved = persistence(await encounter(base));
		const before = saved.state();
		for (const mutate of [
			value => { value.changes = value.changes.filter(step => step.type !== "setUndeadMovement"); },
			value => { value.changes.find(step => step.entry?.name === "Rotting Strikes").entry.entries[0] = "A label without its complete curse."; },
			value => { value.changes.find(step => step.entry?.name === "Dreadful Glare").entry.entries[0] = "Frightened."; },
		]) {
			const bad = structuredClone(accepted.previews[0].preview);
			mutate(bad.resolved);
			for (const conflictDecisions of [wins.one, keep.one]) {
				const signed = {id: "bad", ...BestiaryCreatureTransformation.createOperation({preview: bad, currentPreview: bad, conflictDecisions})};
				expect(() => registry.applyChanges({creature: base, addOperations: [prior, signed]})).toThrow(/complete selected source profile/);
				await expect(saved.adapter.applyChanges({addOperations: [prior, signed]})).rejects.toThrow(/complete selected source profile/);
				expect(saved.state()).toBe(before);
				expect(saved.storage.pSetForPage).not.toHaveBeenCalled();
				expect(registry.getOperations({creature: base})).toEqual([]);
			}
		}
		const tampered = structuredClone(operation);
		tampered.data.resolved.changes[0].alignment = ["L", "G"];
		expect(() => registry.applyChanges({creature: base, addOperations: [prior, tampered]})).toThrow(/tampered|changed/);
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("M12 storage full"));
		await expect(saved.adapter.applyChanges({addOperations: [prior, operation]})).rejects.toThrow("M12 storage full");
		expect(saved.state()).toBe(before);
		await saved.adapter.applyChanges({addOperations: [prior, operation]});
		expect(saved.adapter.getCreature()).toEqual(outcome(accepted));
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: [target(base)], conflictDecisions: wins})).toThrow(/stale/);
		expect(preview(target(base), "skeletal", {}, {}, {dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(base), "skeletal", {}, {}, {acknowledgedPrerequisites: []})).toThrow(/prerequisites/);
	});

	it("enforces exact 180000-byte and Encounter 100-operation limits before persistent publication", async () => {
		const base = source("Tyrannosaurus Rex");
		const operation = owner(preview(target(base)));
		const registry = new BestiaryQuickActionsRegistry();
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const atLimit = {...operation, id: "x".repeat(BestiaryCreatureTransformation.MAX_OPERATION_BYTES - bytes(operation) + operation.id.length)};
		expect(bytes(atLimit)).toBe(180_000);
		registry.applyChanges({creature: base, addOperations: [atLimit]});
		const oversized = {...atLimit, id: `${atLimit.id}x`};
		expect(bytes(oversized)).toBe(180_001);
		expect(() => registry.applyChanges({creature: base, addOperations: [oversized]})).toThrow(/size budget/);
		const prefix = Array.from({length: 99}, (_, ix) => patch(`prefix-${ix}`, {name: "History"}));
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [...prefix, owner(preview(target(base, prefix)))]});
		const before = saved.state();
		await expect(saved.adapter.applyChanges({addOperations: [patch("101", {cha: 20})]})).rejects.toThrow();
		expect(saved.state()).toBe(before);
		await expect(saved.adapter.applyChanges({removeIds: ["undead-owner"], addOperations: [oversized]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(before);
		console.info("M12 reach: actual compiler/executor, Registry and in-memory Encounter Store/Adapter JSON; not browser, disk persistence or E2E proof. Exact 180000/180001-byte and 100/101-operation boundaries exercised.");
	});

	it("verifies the entire catalog and closed M12 schema, while preserving all legacy recipes/options and Species", () => {
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
		const accepted = JSON.parse(childProcess.execFileSync("git", ["show", "584b4776f2b942022d64b9f760414083e88e35d8:data/creature-transformations.json"], {encoding: "utf8"}));
		for (const recipe of catalog.creatureTransformation) {
			const current = structuredClone(recipe);
			if (recipe.name === "Undead") delete current.automation;
			expect(current).toEqual(accepted.creatureTransformation.find(prior => prior.name === recipe.name && prior.source === recipe.source));
		}
		for (const category of ["ghostly", "skeletal", "vampiric", "zombie", "ghoulish", "mummified"]) expect(pending(category, {}, 1)).toEqual(pending(category, {}, 1, accepted));
		const races = [{name: "Species control", source: "TST", size: ["M"], speed: 30, ability: [{dex: 2}], entries: []}];
		const species = data => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races}), id: "race:species control|tst"});
		expect(species(catalog)).toEqual(species(accepted));
		for (const mutate of [
			recipe => { recipe.source = "OTHER"; }, recipe => { recipe.automation.rollout = "enabled"; },
			recipe => { recipe.optionGroups[0].options.pop(); }, recipe => { recipe.automation.path = "action"; },
			recipe => { recipe.optionGroups[6].options[0].id = "invented"; },
		]) {
			const data = structuredClone(catalog);
			mutate(data.creatureTransformation.find(recipe => recipe.name === "Undead"));
			expect(getCreatureTransformationSchemaErrors({data, filePath: "m12"})).not.toEqual([]);
			expect(() => getCreatureTransformationCandidates({catalog: data, races: []})).toThrow();
			expect(getCreatureTransformationIdentityErrors({data, filePath: "m12"}).length + getCreatureTransformationSchemaErrors({data, filePath: "m12"}).length).toBeGreaterThan(0);
		}
		for (const mutate of [
			raw => { raw.changes[0].path = "hp"; }, raw => { raw.changes[0].value.type = "fiend"; },
			raw => { raw.selectedOptions.category = ["skeletal", "zombie"]; }, raw => { raw.selectedOptions["automation-undead-inputs"] = ["x".repeat(30001)]; },
			raw => { raw.changes.push({op: "grantImmunity", value: "fire"}); },
		]) {
			const raw = compile(source("Tyrannosaurus Rex"), "skeletal"); mutate(raw);
			expect(validate(raw)).toBe(false);
			expect(() => normalizeCreatureTransformation(raw)).toThrow();
		}
	});
});
