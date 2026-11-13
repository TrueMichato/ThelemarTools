import fs from "node:fs";
import childProcess from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
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
const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledFallenAngel"});
const source = name => structuredClone(mm.find(monster => monster.name === name && monster.source === "MM"));
const target = (baseCreature = source("Planetar"), operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const find = (out, name, section = "trait") => out[section]?.find(entry => entry.name === name);
const touch = out => out.action?.find(entry => entry.name.startsWith("Corrupting Touch"));
const text = entry => entry.entries.join(" ");
const pending = (mode = "fallen", data = catalog, version = 2) => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog: data, races: []}),
	id: "catalog:fallen angel|scre",
	selections: {allegiance: [mode]},
	automationVersion: version,
});
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
function preview (subject = target(), mode = "fallen", inputs = {}, extra = {}) {
	const resolved = pending(mode);
	return previewCreatureTransformationTargets({targets: [subject], resolved, automationInputs: {[subject.id]: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extra});
}
function outcome (batch) {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
}
function owner (batch, conflictDecisions) {
	return {...createCreatureTransformationChanges({batch, targets: batch.targets, ...conflictDecisions ? {conflictDecisions} : {}})[0].addOperations[0], id: "fallen-owner"};
}
function compile (base, mode = "fallen", inputs = {}) {
	return compileCreatureTransformation({resolved: pending(mode), current: base, inputs, chassisSource: base.source});
}
async function encounter (base) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M11", saveId: "m11", items: [{h: "planetar_mm", c: 2}]},
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
function guided (subject, mode, values) {
	const resolved = pending(mode);
	const model = inspectCreatureTransformationInputs({target: subject, resolved});
	const answers = {targetKey: model.targetKey, controls: Object.fromEntries(model.controls.map(item => [item.id, {value: values[item.selector], reason: "Reviewed this exact target's source capability."}]))};
	return {model, answers, result: compileCreatureTransformationInputs({target: subject, resolved, answers})};
}

describe("M11 Fallen Angel / Devilsworn source-only compilation", () => {
	it.each([
		["Deva", 60, 9, 17, 3, "4d8", "Mace"],
		["Planetar", 90, 12, 20, 4, "5d8", "Greatsword"],
		["Solar", 120, 17, 25, 4, "6d8", "Greatsword"],
	])("uses the actual %s flight, skills, dice, PB/CHA and Healing Touch uses in both allegiance outcomes", (name, flight, skill, dc, uses, dice, weapon) => {
		const base = source(name);
		for (const mode of ["fallen", "devilsworn"]) {
			const batch = preview(target(base), mode);
			const out = outcome(batch);
			const raw = compile(base, mode);
			expect(validate(JSON.parse(JSON.stringify(raw)))).toBe(true);
			expect(validate.errors).toBeNull();
			expect(out.alignment).toEqual(["L", "E"]);
			expect(out.speed).toEqual({...base.speed, fly: flight});
			expect(out.skill).toEqual({...base.skill, deception: `+${skill}`, intimidation: `+${skill}`});
			expect(out.resist).toContain("necrotic");
			const type = mode === "fallen" ? "necrotic" : "fire";
			expect(text(find(out, weapon, "action"))).toContain(`{@damage ${dice}}) ${type} damage`);
			expect(text(find(out, mode === "fallen" ? "Scornful Weapons" : "Hellish Weapons"))).toContain(`{@damage ${dice}} ${type} damage`);
			expect(touch(out).name).toBe(`Corrupting Touch (${uses}/Day)`);
			expect(text(touch(out))).toMatch(new RegExp(`\\{@dc ${dc}} Wisdom saving throw against magic`));
			expect(text(touch(out))).toMatch(/charmed.*1 hour.*spoken or telepathic commands/);
			expect(text(touch(out))).toMatch(/angel or one of its allies harms.*suicidal command.*repeat the saving throw.*ending the effect on a success/);
			expect(text(touch(out))).toMatch(/successful save, or the effect ending.*immune to this angel's Corrupting Touch for 24 hours/);
			expect(out.action.some(entry => entry.name.startsWith("Healing Touch"))).toBe(false);
			if (name !== "Deva") expect(out.spellcasting[0].daily).toEqual({"3e": ["{@spell dispel evil and good}"]});
			else expect(out.spellcasting[0].daily).toBeUndefined();
			expect(out.spellcasting[0].will).toEqual(base.spellcasting[0].will);
			if (mode === "devilsworn") {
				expect(out.type).toEqual({type: "fiend", tags: ["devil"]});
				expect(out.resist).toEqual(expect.arrayContaining(["cold", "fire", "necrotic", "radiant"]));
				expect(out.resist.find(part => typeof part === "object").note).toMatch(/nonmagical attacks; silvered weapons bypass/);
				expect(out.immune).toContain("poison");
				expect(out.conditionImmune).toContain("poisoned");
				expect(out.senses).toEqual(["darkvision 120 ft."]);
				expect(text(find(out, "Devil's Sight"))).toMatch(/Magical darkness does not impede.*darkvision/);
			} else {
				expect(out.type).toEqual(base.type);
				expect(out.senses).toEqual(base.senses);
				expect(out.immune).toEqual(base.immune);
				expect(out.conditionImmune).toEqual(base.conditionImmune);
				expect(out.resist.filter(part => part !== "necrotic")).toEqual(base.resist);
				expect(find(out, "Devil's Sight")).toBeUndefined();
			}
			for (const key of ["str", "dex", "con", "int", "wis", "cha", "hp", "ac", "cr", "size", "save", "passive", "languages", "legendary", "attachedItems"]) expect(out[key]).toEqual(base[key]);
			expect(find(out, "Magic Resistance")).toEqual(find(base, "Magic Resistance"));
			expect(find(out, "Multiattack", "action")).toEqual(find(base, "Multiattack", "action"));
			if (name === "Deva") expect(find(out, "Change Shape", "action")).toEqual(find(base, "Change Shape", "action"));
			if (name === "Solar") {
				expect(text(find(out, "Slaying Longbow", "action"))).toContain(`27 ({@damage 6d8}) ${type} damage`);
				expect(text(find(out, "Slaying Longbow", "action"))).toContain("{@dc 15} Constitution saving throw or die");
				expect(find(out, "Searing Burst (Costs 2 Actions)", "legendary")).toEqual(find(base, "Searing Burst (Costs 2 Actions)", "legendary"));
			}
			const registry = new BestiaryQuickActionsRegistry();
			registry.applyChanges({creature: base, addOperations: [JSON.parse(JSON.stringify(owner(batch)))]});
			expect(registry.getCreature({creature: base})).toEqual(out);
			expect(base).toEqual(source(name));
		}
	});

	it("retains actual at-will spells and limited-use Dispel, but not limited-use Detect or other spells; ordinary casting is unrelated", () => {
		const base = source("Planetar");
		base.spellcasting[0].daily = {"7e": ["{@spell dispel evil and good|PHB}", "{@spell detect evil and good|PHB}", "{@spell raise dead}"], "2": ["{@spell detect evil and good}"]};
		base.spellcasting[0].rest = {"2": ["{@spell dispel evil and good|XPHB} (self only)", "{@spell fireball}"]};
		base.spellcasting[0].will.push("{@spell fire bolt|PHB}");
		const ordinary = {name: "Spellcasting", source: "HB", ability: "int", headerEntries: ["Retained ordinary spell slots."], spells: {"1": {slots: 3, spells: ["{@spell detect evil and good}"]}}};
		base.spellcasting.push(ordinary, {name: "Innate Spellcasting (Other)", source: "HB", headerEntries: ["Other innate spells."], daily: {"5": ["{@spell heal}"]}});
		const out = outcome(preview(target(base)));
		expect(out.spellcasting).toHaveLength(2);
		expect(out.spellcasting[0].daily).toEqual({"7e": ["{@spell dispel evil and good|PHB}"]});
		expect(out.spellcasting[0].rest).toEqual({"2": ["{@spell dispel evil and good|XPHB} (self only)"]});
		expect(out.spellcasting[0].will).toEqual(base.spellcasting[0].will);
		expect(out.spellcasting[0].headerEntries).toEqual(base.spellcasting[0].headerEntries);
		expect(out.spellcasting[1]).toEqual(ordinary);
	});

	it("preserves nonstandard usage, bonus dice and stronger skills instead of transplanting the example", () => {
		const base = {...source("Deva"),
			profBonus: 3,
			pbNote: "+3",
			cha: 14,
			cr: {cr: "1/2", xp: 101},
			speed: {walk: 15, fly: {number: 40, condition: "while airborne"}, swim: 22, canHover: true, alternate: {fly: [{number: 100, condition: "in wind"}], swim: [45]}},
			skill: {deception: "+16", intimidation: "+1", stealth: "+8"}};
		base.trait[0].entries[0] = base.trait[0].entries[0].replace("4d8", "2d6 + 3");
		base.action[1].entries[0] = base.action[1].entries[0].replace("18 ({@damage 4d8})", "10 ({@damage 2d6 + 3})");
		base.action[2].name = "Healing Touch (7/Day)";
		base.action[2].page = 99;
		base.action[1].page = 88;
		const out = outcome(preview(target(base)));
		expect(out.speed).toEqual({...base.speed, fly: {number: 30, condition: "while airborne"}, alternate: {fly: [{number: 70, condition: "in wind"}], swim: [45]}});
		expect(out.skill).toEqual({deception: "+16", intimidation: "+5", stealth: "+8"});
		expect(touch(out).name).toBe("Corrupting Touch (7/Day)");
		expect(touch(out).page).toBeUndefined();
		expect(find(out, "Mace", "action").page).toBe(88);
		expect(text(touch(out))).toContain("{@dc 13}");
		expect(text(find(out, "Mace", "action"))).toContain("10 ({@damage 2d6 + 3}) necrotic damage");
		expect(out.cr).toEqual(base.cr);
		expect(out.profBonus).toBe(3);
		expect(out.cha).toBe(14);
	});

	it.each([[150, 120], [60, 30], [30, 30], [20, 30], [0, 0], [undefined, undefined]])("reduces only actual flight %s to %s, respecting its floor without granting missing flight", (fly, expected) => {
		const base = source("Deva");
		base.speed = {walk: 37, climb: 19, ...fly === undefined ? {} : {fly}};
		expect(outcome(preview(target(base))).speed).toEqual({walk: 37, climb: 19, ...expected === undefined ? {} : {fly: expected}});
	});

	it("does not grant absent Healing Touch/Angelic Weapons or reskin unrelated radiant effects, and preserves unrelated source identities", () => {
		const base = source("Solar");
		base.trait = base.trait.filter(entry => entry.name !== "Angelic Weapons");
		base.action = base.action.filter(entry => !entry.name.startsWith("Healing Touch"));
		for (const mode of ["fallen", "devilsworn"]) {
			const out = outcome(preview(target(base), mode));
			expect(out.action).toEqual(base.action);
			expect(touch(out)).toBeUndefined();
			expect(find(out, "Scornful Weapons")).toBeUndefined();
			expect(find(out, "Hellish Weapons")).toBeUndefined();
			expect(out.legendary).toEqual(base.legendary);
		}
		const sameName = source("Planetar");
		sameName.action.push({name: "Healing Touch (1/Day)", source: "HB", entries: ["An unrelated source-qualified healing power."]});
		expect(preview(target(sameName)).skipped[0].reason).toMatch(/healing binding/);
		const answer = {fallenAngel: {healing: {match: {name: "Healing Touch (4/Day)", source: "MM"}, usage: {kind: "day", uses: 4}}}};
		const out = outcome(preview(target(sameName), "fallen", answer));
		expect(out.action.at(-1)).toEqual(sameName.action.at(-1));
		expect(touch(out).name).toBe("Corrupting Touch (4/Day)");
	});

	it("M11 correction: respects explicit spell-attack tags despite negated weapon wording and requires mixed-attack bindings", () => {
		for (const suffix of ["", " This is a spell attack, not a weapon attack."]) {
			const base = source("Deva");
			const ray = {name: "Sacred Ray", entries: [`{@atk rs} {@hit 8} to hit, range 60 ft., one creature. {@h}18 ({@damage 4d8}) radiant damage.${suffix}`]};
			base.action.push(ray);
			for (const mode of ["fallen", "devilsworn"]) {
				const {result} = guided(target(base), mode, {});
				expect(result.status).toBe("ready");
				const batch = preview(target(base), mode, result.automationInputs);
				const registry = new BestiaryQuickActionsRegistry();
				registry.applyChanges({creature: base, addOperations: JSON.parse(JSON.stringify([owner(batch)]))});
				const out = registry.getCreature({creature: base});
				expect(find(out, "Sacred Ray", "action")).toEqual(ray);
				expect(text(find(out, "Mace", "action"))).toContain(mode === "fallen" ? "necrotic damage" : "fire damage");
				registry.removeOperation({creature: base, operationId: "fallen-owner"});
				expect(registry.getCreature({creature: base})).toEqual(base);
			}
		}
		const mixed = source("Deva");
		mixed.action.push({name: "Mixed Strike",
			entries: [
				"{@atk mw} {@hit 8} to hit. {@h}18 ({@damage 4d8}) radiant damage.",
				"{@atk rs} {@hit 8} to hit. {@h}18 ({@damage 4d8}) radiant damage.",
			]});
		const values = {weapons: {match: {name: "Angelic Weapons", source: "MM"},
			token: 0,
			attacks: [
				{section: "action", match: {name: "Mace", source: "MM"}, tokens: [0]},
				{section: "action", match: {name: "Mixed Strike", source: "MM"}, tokens: [0]},
			]}};
		expect(inspectCreatureTransformationInputs({target: target(mixed), resolved: pending()}).controls.map(control => control.selector)).toContain("weapons");
		for (const mode of ["fallen", "devilsworn"]) {
			const {result} = guided(target(mixed), mode, values);
			expect(result.status).toBe("ready");
			const out = outcome(preview(target(mixed), mode, result.automationInputs));
			expect(find(out, "Mixed Strike", "action").entries).toEqual([
				`{@atk mw} {@hit 8} to hit. {@h}18 ({@damage 4d8}) ${mode === "fallen" ? "necrotic" : "fire"} damage.`,
				mixed.action.at(-1).entries[1],
			]);
		}
	});

	it("M11 correction: preserves a zero-damage radiant defense without inventing or requiring Angelic Weapons", () => {
		const base = source("Deva");
		base.trait = base.trait.filter(entry => entry.name !== "Angelic Weapons");
		const ward = {name: "Radiant Ward", entries: ["The angel has resistance to radiant damage from weapon attacks."]};
		base.trait.push(ward);
		for (const mode of ["fallen", "devilsworn"]) {
			const {result} = guided(target(base), mode, {weapons: null});
			expect(result.status).toBe("ready");
			const batch = preview(target(base), mode, result.automationInputs);
			const registry = new BestiaryQuickActionsRegistry();
			registry.applyChanges({creature: base, addOperations: JSON.parse(JSON.stringify([owner(batch)]))});
			const out = registry.getCreature({creature: base});
			expect(find(out, "Radiant Ward")).toEqual(ward);
			expect(out.action.find(entry => entry.name === "Mace")).toEqual(base.action.find(entry => entry.name === "Mace"));
			expect(out.trait.some(entry => ["Scornful Weapons", "Hellish Weapons"].includes(entry.name))).toBe(false);
			expect(out.speed.fly).toBe(60);
			registry.removeOperation({creature: base, operationId: "fallen-owner"});
			expect(registry.getCreature({creature: base})).toEqual(base);
		}
		const ambiguous = source("Deva");
		ambiguous.trait[0].name = "Radiant Armaments";
		const {result} = guided(target(ambiguous), "fallen", {weapons: null});
		expect(result.status).toBe("ready");
		expect(outcome(preview(target(ambiguous), "fallen", result.automationInputs)).trait[0]).toEqual(ambiguous.trait[0]);
		expect(() => compile(source("Deva"), "fallen", {fallenAngel: {weapons: null}})).toThrow(/automatic/);
	});

	it("M11 correction: precisely blocks compound truesight before a guided answer can erase unrelated senses", () => {
		const base = source("Deva");
		base.senses = ["blindsight 30 ft.; truesight 120 ft."];
		const before = structuredClone(base);
		const resolved = pending("devilsworn");
		const subject = target(base);
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		expect(model.status).toBe("blocked");
		expect(JSON.stringify(model.requirements)).toMatch(/compound.*separat/i);
		expect(() => compile(base, "devilsworn", {fallenAngel: {sight: [{index: 0, range: 120, condition: ""}]}})).toThrow(/compound.*separat/i);
		expect(preview(subject, "devilsworn").previews).toEqual([]);
		expect(base).toEqual(before);
		expect(outcome(preview(subject, "fallen")).senses).toEqual(base.senses);
		base.senses = ["blindsight 30 ft.", "truesight 120 ft."];
		expect(outcome(preview(target(base), "devilsworn")).senses).toEqual(["blindsight 30 ft.", "darkvision 120 ft."]);
	});

	it("M11 correction: precisely blocks recognized prose innate spellcasting instead of retaining disallowed limited-use spells", () => {
		const base = source("Deva");
		delete base.spellcasting;
		base.trait.push({name: "Innate Spellcasting",
			entries: [
				"The angel innately casts the following spells without material components.",
				"At will: {@spell detect evil and good}.",
				"3/day each: {@spell dispel evil and good}, {@spell detect evil and good}, {@spell fireball}.",
			]});
		const before = structuredClone(base);
		for (const mode of ["fallen", "devilsworn"]) {
			const model = inspectCreatureTransformationInputs({target: target(base), resolved: pending(mode)});
			expect(model.status).toBe("blocked");
			expect(JSON.stringify(model.requirements)).toMatch(/innate.*supported spellcasting/i);
			expect(() => compile(base, mode)).toThrow(/innate.*supported spellcasting/i);
			expect(preview(target(base), mode).previews).toEqual([]);
		}
		expect(base).toEqual(before);
	});

	it("uses finite target-qualified guided weapon/use/PB/CHA inputs and rejects stale or incomplete bindings", () => {
		const base = {...source("Deva"), cr: "Unknown", cha: {special: "Variable Charisma"}, group: [], type: {type: "celestial", tags: ["custom"]}};
		base.action[2].name = "Healing Touch";
		base.action[1].entries[0] += " A separate relic adds 3 ({@damage 1d6}) radiant damage.";
		base.action.push({name: "Relic Blade", source: "HB", entries: ["{@atk mw} {@hit 2} to hit. {@h}9 ({@damage 2d8}) radiant damage."]});
		const values = {angel: true,
			proficiencyBonus: 6,
			charisma: 18,
			healing: {match: {name: "Healing Touch", source: "MM"}, usage: {kind: "shortRest", uses: 2}},
			weapons: {match: {name: "Angelic Weapons", source: "MM"},
				token: 0,
				attacks: [
					{section: "action", match: {name: "Mace", source: "MM"}, tokens: [0]},
					{section: "action", match: {name: "Relic Blade", source: "HB"}, tokens: []},
				]}};
		const subject = target(base);
		const {model, answers, result} = guided(subject, "fallen", values);
		expect(model.status).toBe("needs-answers");
		expect(model.controls.map(item => item.selector)).toEqual(["angel", "proficiencyBonus", "charisma", "weapons", "healing"]);
		expect(result.status).toBe("ready");
		const out = outcome(preview(subject, "fallen", result.automationInputs));
		expect(text(touch(out))).toContain("{@dc 18}");
		expect(touch(out).name).toBe("Corrupting Touch (2/Short Rest)");
		expect(out.skill.deception).toBe("+10");
		expect(text(find(out, "Mace", "action"))).toContain("18 ({@damage 4d8}) necrotic damage");
		expect(text(find(out, "Mace", "action"))).toContain("3 ({@damage 1d6}) radiant damage");
		expect(find(out, "Relic Blade", "action")).toEqual(base.action.at(-1));
		expect(out.cha).toEqual(base.cha);
		expect(compileCreatureTransformationInputs({target: subject, resolved: pending(), answers: {targetKey: model.targetKey, controls: {}}}).status).toBe("needs-answers");
		for (const changed of [target(base, [patch("history", {name: "Renamed"})]), target({...base, source: "HB"}), target(base, [], "two")]) {
			expect(compileCreatureTransformationInputs({target: changed, resolved: pending(), answers}).status).toBe("needs-answers");
		}
		for (const bad of [
			{...values, angel: false},
			{...values, proficiencyBonus: 0},
			{...values, charisma: 31},
			{...values, weapons: {...values.weapons, attacks: values.weapons.attacks.slice(1)}},
			{...values, weapons: {...values.weapons, match: {name: "Angelic Weapons", source: "OTHER"}}},
			{...values, healing: {...values.healing, usage: {kind: "day", uses: 0}}},
		]) expect(preview(subject, "fallen", {fallenAngel: bad}).previews).toEqual([]);
		expect(preview(target(source("Deva")), "fallen", {fallenAngel: {charisma: 18}}).skipped[0].reason).toMatch(/automatic/);
	});

	it("resolves custom innate spell identities, silver qualifications and sight ranges through bounded controls", () => {
		const base = source("Planetar");
		base.spellcasting = [{name: "Other Magic", source: "HB", ability: "cha", daily: {"8": ["Unlinked dispelling ability", "{@spell detect evil and good}"]}}];
		base.resist.push({resist: ["acid", "slashing"], note: "from nonmagical attacks while awake", cond: true});
		base.senses = ["blindsight 10 ft.", "truesight (while awake)", "darkvision 180 ft."];
		base.senseTags = ["B", "U", "D"];
		const values = {
			innate: [{match: {name: "Other Magic", source: "HB"}, value: true, exceptions: [{prop: "daily", key: "8", index: 0, value: true}]}],
			silver: [{index: 2, value: true}],
			sight: [{index: 1, range: 80, condition: "(while awake)"}],
		};
		const {model, result} = guided(target(base), "devilsworn", values);
		expect(model.controls.find(control => control.selector === "innate").facts).toMatchObject({exception: "dispel evil and good", notException: "limited-use detect evil and good"});
		expect(result.status).toBe("ready");
		const out = outcome(preview(target(base), "devilsworn", result.automationInputs));
		expect(out.spellcasting[0].daily).toEqual({"8": ["Unlinked dispelling ability"]});
		expect(out.resist).toEqual(expect.arrayContaining([
			{resist: ["acid"], note: "from nonmagical attacks while awake", cond: true},
			{resist: ["slashing"], note: "from nonmagical attacks while awake; silvered weapons bypass this resistance", cond: true},
		]));
		expect(out.senses).toEqual(["blindsight 10 ft.", "darkvision 80 ft. (while awake)", "darkvision 180 ft."]);
		expect(out.senseTags).toEqual(["B", "D"]);
		const notInnate = {...values, innate: [{match: {name: "Other Magic", source: "HB"}, value: false}]};
		expect(outcome(preview(target(base), "devilsworn", {fallenAngel: notInnate})).spellcasting).toEqual(base.spellcasting);
		expect(preview(target(base), "devilsworn").previews).toEqual([]);
	});

	it("requires an explicit Dispel-only exception classification for opaque spells in a recognized innate block", () => {
		const base = source("Deva");
		base.spellcasting[0].daily = {"6": ["Unlinked dispelling power", "Unlinked detection power"]};
		const values = {spellExceptions: [true, false].map((value, index) => ({match: {name: "Innate Spellcasting", source: "MM"}, prop: "daily", key: "6", index, value}))};
		const {model, result} = guided(target(base), "fallen", values);
		expect(model.controls.find(control => control.selector === "spellExceptions").facts).toMatchObject({exception: "dispel evil and good", notException: "limited-use detect evil and good"});
		expect(result.status).toBe("ready");
		expect(outcome(preview(target(base), "fallen", result.automationInputs)).spellcasting[0].daily).toEqual({"6": ["Unlinked dispelling power"]});
		expect(preview(target(base)).skipped[0].reason).toMatch(/spellExceptions/);
		expect(() => compile(base, "fallen", {fallenAngel: {spellExceptions: values.spellExceptions.slice(1)}})).toThrow(/Invalid target-qualified spellExceptions/);
	});

	it("does not invent darkvision without truesight or weaken physical resistance unrelated to nonmagical attacks", () => {
		const base = source("Deva");
		base.senses = ["blindsight 30 ft."];
		base.senseTags = ["B"];
		base.resist = ["slashing", {resist: ["cold", "piercing"], note: "while submerged", cond: true},
			{resist: ["bludgeoning"], note: "from nonmagical attacks that aren't silvered", cond: true}];
		const {result} = guided(target(base), "devilsworn", {silver: [{index: 1, value: false}]});
		expect(result.status).toBe("ready");
		const out = outcome(preview(target(base), "devilsworn", result.automationInputs));
		expect(out.senses).toEqual(base.senses);
		expect(out.senseTags).toEqual(base.senseTags);
		expect(out.resist).toEqual([...base.resist, "cold", "fire", "necrotic"]);
		expect(out.speed).toEqual({...base.speed, fly: 60});
		expect(text(find(out, "Devil's Sight"))).toContain("darkvision");
	});

	it("detects exact prior sense and conditional-defense writes and keeps the selected source profile coherent", () => {
		const base = source("Planetar");
		base.senses = ["blindsight 10 ft."];
		base.resist = ["radiant"];
		const priorResolved = normalizeCreatureTransformation({
			id: "catalog:prior|hb",
			kind: "catalog",
			identity: {name: "Prior", source: "HB"},
			provenance: {edition: "classic"},
			eligibility: [],
			prerequisites: [],
			selectedOptions: {},
			changes: [{op: "grantSense", sense: "truesight", range: 60}, {op: "grantConditionalDefense", kind: "resistance", value: "slashing", when: "nonmagical"}],
			manualReview: [],
		});
		const priorPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: priorResolved});
		const prior = {id: "prior", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: priorPreview})};
		const subject = target(base, [prior]);
		const batch = preview(subject, "devilsworn");
		const conflicts = batch.previews[0].preview.conflicts;
		expect(conflicts.map(item => item.path)).toEqual(expect.arrayContaining(["senses:truesight", "resist:slashing|nonmagical"]));
		for (const winner of ["existing", "incoming"]) {
			const decisions = {one: Object.fromEntries(conflicts.map(item => [item.path, winner]))};
			const accepted = preview(subject, "devilsworn", {}, {conflictDecisions: decisions});
			const out = outcome(accepted);
			expect(out.type).toEqual(winner === "incoming" ? {type: "fiend", tags: ["devil"]} : base.type);
			expect(out.senses).toEqual(winner === "incoming" ? ["blindsight 10 ft.", "darkvision 60 ft."] : ["blindsight 10 ft.", "truesight 60 ft."]);
			const operation = owner(accepted, decisions);
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prior, operation]})).toEqual(out);
		}
	});

	it("rejects ineligible, duplicate and malformed inputs rather than applying a partial profile", () => {
		expect(preview(target({...source("Deva"), type: "fiend"})).skipped[0].reason).toMatch(/celestial angel/);
		const duplicate = source("Deva");
		duplicate.trait.push(structuredClone(duplicate.trait[0]));
		expect(preview(target(duplicate)).skipped[0].reason).toMatch(/Duplicate/);
		for (const fields of [{speed: {}}, {profBonus: 2, pbNote: "+3"}, {skill: {deception: "special"}}, {spellcasting: {}}, {senses: "truesight 30 ft."}]) {
			const batch = preview(target({...source("Deva"), ...fields}), "devilsworn");
			if (Object.hasOwn(fields, "speed")) expect(outcome(batch).speed).toEqual({});
			else expect(batch.previews).toEqual([]);
		}
		for (const inputs of [{hp: {}}, {fallenAngel: {path: "hp"}}, {fallenAngel: null}, {fallenAngel: {sight: []}}]) expect(preview(target(), "fallen", inputs).previews).toEqual([]);
	});

	it("fences selection, source, consent, history and coherent winners, including closure before an existing winner", () => {
		const base = source("Planetar");
		const priorRule = {id: "catalog:prior|hb",
			kind: "catalog",
			identity: {name: "Prior", source: "HB"},
			provenance: {edition: "classic"},
			eligibility: [],
			prerequisites: [],
			selectedOptions: {},
			manualReview: [],
			changes: [{type: "replaceEntry", section: "trait", match: {name: "Angelic Weapons", source: "MM"}, onMissing: "error", entry: {name: "Angelic Weapons", source: "MM", entries: ["Weapon attacks are magical and deal an extra {@damage 5d8} radiant damage."]}},
				{type: "grantSpeed", mode: "fly", feet: 150}]};
		const priorPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: priorRule});
		const prior = {id: "prior", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: priorPreview})};
		const subject = target(base, [prior]);
		const batch = preview(subject, "devilsworn");
		const conflicts = batch.previews[0].preview.conflicts;
		expect(conflicts.map(item => item.path)).toEqual(expect.arrayContaining(["trait:angelic weapons|mm", "speed.fly"]));
		const wins = Object.fromEntries(conflicts.map(item => [item.path, "incoming"]));
		const keep = Object.fromEntries(conflicts.map(item => [item.path, "existing"]));
		expect(outcome(preview(subject, "devilsworn", {}, {conflictDecisions: {one: keep}}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prior]}));
		const mixed = {...wins, "trait:angelic weapons|mm": "existing"};
		expect(preview(subject, "devilsworn", {}, {conflictDecisions: {one: mixed}}).skipped[0].reason).toMatch(/must share one conflict winner/);
		const accepted = preview(subject, "devilsworn", {}, {conflictDecisions: {one: wins}});
		const operation = owner(accepted, {one: wins});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prior, operation]})).toEqual(outcome(accepted));
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: [target(base)], conflictDecisions: {one: wins}})).toThrow(/stale/);
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: accepted.targets, automationInputs: {one: {fallenAngel: {angel: true}}}, conflictDecisions: {one: wins}})).toThrow(/input answers changed/);
		const changed = pending("fallen");
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: accepted.targets, resolved: changed, conflictDecisions: {one: wins}})).toThrow(/changed|stale/);
		expect(preview(target(), "fallen", {}, {dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(), "fallen", {}, {acknowledgedPrerequisites: []})).toThrow(/prerequisites must be explicitly acknowledged/);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "XMM"}, operations: [operation]})).toThrow();
		const existingPreview = structuredClone(preview(subject, "devilsworn", {}, {conflictDecisions: {one: keep}}).previews[0].preview);
		existingPreview.resolved.changes.find(step => step.type === "setFallenAngelEntry" && step.entry.name.startsWith("Corrupting Touch")).entry.entries[0] = "A label without the actual effect.";
		const signedBad = {id: "bad", ...BestiaryCreatureTransformation.createOperation({preview: existingPreview, currentPreview: existingPreview, conflictDecisions: keep})};
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prior, signedBad]})).toThrow(/complete selected source profile/);
	});

	it("saves/reloads/removes real Registry and Encounter JSON owners without the catalog or source loader, preserving prefixes and target isolation", async () => {
		const base = source("Planetar");
		const prefix = patch("prefix", {name: "Renamed angel", cha: 18, profBonus: 3});
		const subject = target(base, [prefix]);
		const batch = preview(subject, "devilsworn");
		const expected = outcome(batch);
		expect(text(touch(expected))).toContain("{@dc 15}");
		const operation = owner(batch);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [operation]})).toThrow(/actual pre-owner target/);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, operation]});
		const serialized = JSON.stringify(registry.getOperations({creature: base}));
		const originalCatalog = catalog.creatureTransformation;
		const originalLoader = DataUtil.loadJSON;
		const loader = jest.fn(() => { throw new Error("Source data unavailable during M11 replay"); });
		DataUtil.loadJSON = loader;
		try {
			for (const data of [[], [{name: "Fallen Angel", source: "SCRE", changes: [{op: "setType", value: "undead"}]}]]) {
				catalog.creatureTransformation = data;
				const reloaded = new BestiaryQuickActionsRegistry();
				reloaded.applyChanges({creature: base, addOperations: JSON.parse(serialized)});
				expect(reloaded.getCreature({creature: base})).toEqual(expected);
				expect(reloaded.getCreature({creature: {...base, name: "Other angel"}})).toEqual({...base, name: "Other angel"});
				reloaded.removeOperation({creature: base, operationId: "fallen-owner"});
				expect(reloaded.getCreature({creature: base})).toEqual({...base, name: "Renamed angel", cha: 18, profBonus: 3});
				const saved = persistence(await encounter(base));
				await saved.adapter.applyChanges({addOperations: JSON.parse(serialized)});
				await saved.reload();
				expect(saved.adapter.getOperations()).toEqual(JSON.parse(serialized));
				expect(saved.adapter.getCreature()).toEqual(expected);
				expect(saved.state().instances[1].monster).toEqual(base);
				await saved.adapter.removeOperation({operationId: "fallen-owner"});
				await saved.reload();
				expect(saved.adapter.getOperations()).toEqual([prefix]);
				expect(saved.adapter.getCreature()).toEqual({...base, name: "Renamed angel", cha: 18, profBonus: 3});
			}
			expect(loader).not.toHaveBeenCalled();
		} finally { catalog.creatureTransformation = originalCatalog; DataUtil.loadJSON = originalLoader; }
	});

	it("atomically rejects integrity tampering, signed incomplete effects, failed saves and exact count/byte ceilings", async () => {
		const base = source("Planetar");
		const batch = preview(target(base), "devilsworn");
		const operation = owner(batch);
		const registry = new BestiaryQuickActionsRegistry();
		const saved = persistence(await encounter(base));
		const before = saved.state();
		const notify = jest.fn();
		registry.subscribe(notify);
		const listener = jest.fn();
		saved.adapter.subscribe(listener);
		const tampered = structuredClone(operation);
		tampered.data.resolved.changes[0].value.tags = ["other"];
		expect(() => registry.applyChanges({creature: base, addOperations: [tampered]})).toThrow(/tampered|changed|Invalid/);
		for (const mutate of [
			resolved => { resolved.changes = resolved.changes.filter(step => step.type !== "setFallenAngelFlight"); },
			resolved => { resolved.changes.find(step => step.type === "setFallenAngelSpells").lists.push({prop: "daily", key: "1", spells: ["{@spell raise dead}"]}); },
			resolved => { resolved.changes.find(step => step.type === "setFallenAngelEntry" && step.entry.name.startsWith("Corrupting")).entry.entries[0] = "The target is charmed."; },
			resolved => { resolved.changes.find(step => step.type === "setFallenAngelEntry" && step.entry.name === "Greatsword").entry.entries[0] = "22 ({@damage 5d8}) necrotic damage."; },
			resolved => { resolved.changes = resolved.changes.filter(step => step.type !== "setDevilswornSenses"); },
		]) {
			const badPreview = structuredClone(batch.previews[0].preview);
			mutate(badPreview.resolved);
			const incomplete = {id: "incomplete", ...BestiaryCreatureTransformation.createOperation({preview: badPreview, currentPreview: badPreview})};
			expect(() => registry.applyChanges({creature: base, addOperations: [incomplete]})).toThrow(/complete selected source profile/);
			await expect(saved.adapter.applyChanges({addOperations: [incomplete]})).rejects.toThrow(/complete selected source profile/);
			expect(registry.getOperations({creature: base})).toEqual([]);
			expect(saved.state()).toBe(before);
			expect(saved.storage.pSetForPage).not.toHaveBeenCalled();
		}
		expect(notify).not.toHaveBeenCalled();
		expect(listener).not.toHaveBeenCalled();
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("M11 storage full"));
		await expect(saved.adapter.applyChanges({addOperations: [operation]})).rejects.toThrow("M11 storage full");
		expect(saved.state()).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		await saved.adapter.applyChanges({addOperations: [operation]});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual(outcome(batch));
		const countPrefix = Array.from({length: 99}, (_, ix) => patch(`prefix-${ix}`, {name: "Renamed angel"}));
		const capped = persistence(await encounter(base));
		await capped.adapter.applyChanges({addOperations: [...countPrefix, owner(preview(target(base, countPrefix), "devilsworn"))]});
		const cappedBefore = capped.state();
		await expect(capped.adapter.applyChanges({addOperations: [patch("101", {cha: 20})]})).rejects.toThrow();
		expect(capped.state()).toBe(cappedBefore);
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const atLimit = {...operation, id: "x".repeat(BestiaryCreatureTransformation.MAX_OPERATION_BYTES - bytes(operation) + operation.id.length)};
		expect(bytes(atLimit)).toBe(180_000);
		registry.applyChanges({creature: base, addOperations: [atLimit]});
		const oversized = {...atLimit, id: `${atLimit.id}x`};
		expect(bytes(oversized)).toBe(180_001);
		const stateBefore = saved.state();
		await expect(saved.adapter.applyChanges({removeIds: ["fallen-owner"], addOperations: [oversized]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(stateBefore);
		expect(() => registry.applyChanges({creature: base, addOperations: [oversized]})).toThrow(/size budget/);
		console.info("M11 evidence: real compiler/executor, Registry and in-memory Encounter Store/Adapter JSON; not browser, disk or E2E proof. 180000/180001 bytes and 100/101 operations exercised.");
	});

	it("preserves other thirteen records, legacy Fallen payloads and Species through current-code accepted-base data comparisons", () => {
		const accepted = JSON.parse(childProcess.execFileSync("git", ["show", "0a0f64c06cdd02df5209416a5cbe1cfe1ccfb9e8:data/creature-transformations.json"], {encoding: "utf8"}));
		for (const recipe of catalog.creatureTransformation) {
			const current = structuredClone(recipe);
			if (recipe.name === "Fallen Angel" && recipe.source === "SCRE") delete current.automation;
			expect(current).toEqual(accepted.creatureTransformation.find(prior => prior.name === recipe.name && prior.source === recipe.source));
		}
		for (const mode of ["fallen", "devilsworn"]) {
			const current = normalizeCreatureTransformation(pending(mode, catalog, 1));
			const oldData = normalizeCreatureTransformation(pending(mode, accepted, 1));
			expect(current).toEqual(oldData);
			const base = source("Planetar");
			const legacyPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: current, acknowledgedPrerequisites: current.prerequisites, dmApproved: true});
			const legacy = {id: "legacy", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: legacyPreview})};
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify([legacy]))})).toEqual(legacyPreview.proposed);
			expect(legacyPreview.proposed.speed).toEqual(base.speed);
			expect(legacyPreview.proposed).toEqual(BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: oldData, acknowledgedPrerequisites: oldData.prerequisites, dmApproved: true}).proposed);
		}
		const races = [{name: "Species control", source: "TST", size: ["M"], speed: 30, ability: [{dex: 2}], entries: []}];
		const race = data => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races}), id: "race:species control|tst"});
		expect(race(catalog)).toEqual(race(accepted));
		const legacy = normalizeCreatureTransformation(pending("fallen", accepted, 1));
		legacy.changes = [{type: "setFallenAngelNature"}];
		expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: source("Deva"), resolved: legacy})).toThrow(/version-2/);
	});

	it("enforces closed catalog/schema/runtime boundaries and excludes only a malformed owning candidate", () => {
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
		for (const mutate of [
			record => { record.source = "OTHER"; },
			record => { record.automation.profile = "arbitrary"; },
			record => { record.automation.rollout = "enabled"; },
			record => { record.automation.version = 3; },
			record => { record.automation.path = "action"; },
			record => { record.optionGroups[0].options.pop(); },
			record => { record.optionGroups[0].selection = "any"; },
		]) {
			const bad = structuredClone(catalog);
			mutate(bad.creatureTransformation.find(record => record.name === "Fallen Angel"));
			expect(getCreatureTransformationSchemaErrors({data: bad, filePath: "m11"})).not.toEqual([]);
			expect(() => getCreatureTransformationCandidates({catalog: bad, races: []})).toThrow();
		}
		const bad = structuredClone(catalog);
		bad.creatureTransformation.find(record => record.name === "Fallen Angel").source = "OTHER";
		expect(getCreatureTransformationIdentityErrors({data: bad, filePath: "m11"})).not.toEqual([]);
		const warning = jest.fn();
		const candidates = getCreatureTransformationCandidates({catalog: bad, races: [], onInvalidCandidate: warning});
		expect(candidates.filter(candidate => candidate.kind === "catalog")).toHaveLength(13);
		expect(warning).toHaveBeenCalledTimes(1);
		for (const mutate of [
			resolved => { resolved.changes[0].path = "hp"; },
			resolved => { resolved.changes[0].value.type = "undead"; },
			resolved => { resolved.selectedOptions.allegiance = ["fallen", "devilsworn"]; },
			resolved => { resolved.selectedOptions["automation-fallen-angel-inputs"] = ["x".repeat(30001)]; },
			resolved => { resolved.changes.find(step => step.op === "setFallenAngelSpells").lists[0].path = "hp"; },
		]) {
			const raw = compile(source("Planetar"), "devilsworn");
			mutate(raw);
			expect(validate(raw)).toBe(false);
			expect(() => normalizeCreatureTransformation(raw)).toThrow();
		}
	});
});
