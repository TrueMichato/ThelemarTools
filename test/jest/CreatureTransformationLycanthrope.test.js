import fs from "node:fs";
import childProcess from "node:child_process";
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
import {compileCreatureTransformationInputs, inspectCreatureTransformationInputs} from "../../js/bestiary/bestiary-transformation-inputs.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationSchemaErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const schema = read("schema/site/creature-transformation.json");
const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/frozenFormResolved"});
const validateLeaf = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledLycanthrope"});
const source = name => structuredClone(mm.find(monster => monster.name === name && monster.source === "MM"));
const sections = ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"];
const forms = ["humanoid", "hybrid", "animal"];
const kinds = ["werebear", "wereboar", "wererat", "weretiger", "werewolf", "wereshark"];
const rule = (creature, name, section = "trait") => creature[section]?.find(entry => entry.name === name);
const target = (baseCreature, operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
const pending = (kind = "werewolf", version = 2, data = catalog) => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog: data, races: []}),
	id: kind === "wereshark" ? "catalog:wereshark|arcadia27" : "catalog:lycanthropy|mm",
	selections: kind === "wereshark" ? {} : {form: [kind]},
	automationVersion: version,
});
const scout = () => ({...source("Scout"),
	languages: ["Common", "Elvish", "telepathy 30 ft."],
	speed: {walk: 35, fly: 50, swim: 15, climb: 12, alternate: {walk: [45], fly: [60], swim: [20]}},
	gear: [{item: "longbow|phb", quantity: 1}],
	save: {str: "+2", dex: "+4"},
	immune: ["poison"],
	spellcasting: [{name: "Innate Spellcasting", type: "spellcasting", ability: "wis", headerEntries: ["Requires verbal components; spell save {@dc 11}."], will: ["{@spell guidance|PHB}"]}],
});
const equipmentFreeCommoner = () => ({...source("Commoner"),
	name: "Equipment-free Humanoid",
	source: "HB",
	languages: ["Common"],
	action: [{name: "Finesse Claw", source: "HB", entries: ["{@atk mw} {@hit 2} to hit, reach 5 ft., one target. {@h}2 ({@damage 1d4}) slashing damage."]}],
});
function equipmentFreeDecisions (base, kind) {
	const inputs = decisions(base, kind);
	inputs.bindings.armor = {mode: "retain"};
	inputs.bindings.entries = [{section: "action",
		match: {name: "Finesse Claw", source: "HB"},
		mode: "bind",
		numbers: [
			{paragraph: 0, token: 0, kind: "hit", mode: "ability", ability: "dex", proficiency: 1, fixed: 0},
			{paragraph: 0, token: 0, kind: "damage", mode: "ability", ability: "dex", proficiency: 0, fixed: 0, dice: {number: 1, faces: 4}},
		]}];
	for (const form of ["hybrid", "animal"]) for (const entry of inputs.lycanthrope[form].entries) entry.equipment = "not-required";
	return inputs;
}
function decisions (base, kind = "werewolf") {
	const form = name => ({armor: {mode: "retain", reason: "Equipment remains usable on this reviewed target."},
		entries: sections.flatMap(section => (base[section] || []).map(entry => ({
			section,
			match: {name: entry.name, source: entry.source || "MM"},
			requiresSpeech: section === "spellcasting",
			equipment: name === "animal" && section === "action" ? "unusable" : "not-required",
		})))});
	return {lycanthrope: {adaptation: kind === "wereshark" ? "arcadia27-template" : "sidebar-npc",
		embrace: false,
		hybrid: form("hybrid"),
		animal: form("animal")},
	bindings: {proficiencyBonus: 2,
		armor: {mode: "recalculate", alternatives: [{kind: "worn", base: 11, dexterity: "full", shield: 0, fixed: 0}]},
		entries: ["Shortsword", "Longbow"].map((name, index) => ({section: "action",
			match: {name, source: "MM"},
			mode: "bind",
			numbers: [
				{paragraph: 0, token: 0, kind: "hit", mode: "ability", ability: "dex", proficiency: 1, fixed: 0},
				{paragraph: 0, token: 0, kind: "damage", mode: "ability", ability: "dex", proficiency: 0, fixed: 0, dice: {number: 1, faces: index ? 8 : 6}},
			]})).concat(base.spellcasting ? [{section: "spellcasting", match: {name: "Innate Spellcasting", source: "MM"}, mode: "retain"}] : [])}};
}
function preview (subject, kind = "werewolf", inputs = decisions(BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: subject.operations}), kind), options = {}) {
	const resolved = options.resolved ?? pending(kind);
	return previewCreatureTransformationTargets({targets: [subject], resolved, automationInputs: {[subject.id]: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...options});
}
function outcome (batch) {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
}
function operation (batch, conflictDecisions) {
	return {...createCreatureTransformationChanges({batch, targets: batch.targets, ...conflictDecisions ? {conflictDecisions} : {}})[0].addOperations[0], id: "lycan-owner"};
}
function conflictingPrefix (base) {
	const resolved = {id: "catalog:prior|hb",
		kind: "catalog",
		identity: {name: "Prior", source: "HB"},
		provenance: {edition: "classic"},
		eligibility: [],
		prerequisites: [],
		selectedOptions: {},
		changes: [{type: "setAbility", ability: "str", value: 12}, {type: "setAbility", ability: "dex", value: 13}, {type: "grantSense", sense: "blindsight", range: 30}],
		manualReview: []};
	const previous = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved});
	return {id: "conflicting-prefix", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: previous})};
}
function retainedBindings (current, kind) {
	const inputs = decisions(current, kind);
	inputs.bindings.armor = {mode: "retain"};
	inputs.bindings.entries = inputs.bindings.entries.map(({section, match}) => ({section, match, mode: "retain"}));
	return inputs;
}
function compiled (base, kind = "werewolf", inputs = decisions(base, kind), operations = []) {
	return compileCreatureTransformation({resolved: pending(kind),
		current: BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations}),
		chassisSource: base.source,
		inputs,
		baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base, operations})});
}
function replayCompiled (base, raw, formId = "humanoid", prefix = []) {
	const resolved = normalizeCreatureTransformation(selectFrozenCreatureTransformation({resolved: raw, formId}));
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: prefix, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
	expect(preview.canApply).toBe(true);
	const owner = {id: "lycan-owner", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: prefix, preview})};
	const registry = new BestiaryQuickActionsRegistry();
	registry.applyChanges({creature: base, addOperations: [...prefix, owner]});
	const reloaded = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify([...prefix, owner]))});
	expect(registry.getCreature({creature: base})).toEqual(reloaded);
	return reloaded;
}
function switchForm (subject, formId) {
	const first = previewCreatureTransformationForm({target: subject, operationId: "lycan-owner", formId});
	const conflictDecisions = Object.fromEntries((first.preview?.conflicts || []).map(({path}) => [path, "incoming"]));
	const batch = first.canApply || first.noChange ? first : previewCreatureTransformationForm({target: subject, operationId: "lycan-owner", formId, conflictDecisions});
	return {batch, changes: createCreatureTransformationFormChanges({batch, target: subject})};
}
async function encounter (baseCreature) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M9", saveId: "m9", items: [{h: "scout_mm", c: 2}]},
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
function guidedAnswers (subject, kind, inputs = decisions(subject.baseCreature, kind)) {
	const model = inspectCreatureTransformationInputs({target: subject, resolved: pending(kind)});
	const controls = {};
	for (const item of model.controls) {
		switch (item.kind) {
			case "lycanthropeConsent": controls[item.id] = {value: inputs.lycanthrope[item.selector]}; break;
			case "proficiencyBonus": controls[item.id] = {value: inputs.bindings.proficiencyBonus, reason: "Actual target PB."}; break;
			case "lycanthropeArmorBinding": controls[item.id] = inputs.bindings.armor; break;
			case "lycanthropeReplacements": controls[item.id] = inputs.lycanthrope.replaceFeatures ?? []; break;
			case "lycanthropeArmor": controls[item.id] = inputs.lycanthrope[item.selector].armor; break;
			case "lycanthropeCapability": {
				const value = inputs.lycanthrope[item.selector.form].entries.find(entry => entry.section === item.selector.section && entry.match.name === item.selector.name);
				controls[item.id] = {requiresSpeech: value.requiresSpeech, equipment: value.equipment};
				break;
			}
			case "lycanthropeEntryBinding": {
				const value = inputs.bindings.entries.find(entry => entry.section === item.selector.section && entry.match.name === item.selector.name);
				const {section, match, ...answer} = value;
				controls[item.id] = answer;
				break;
			}
			default: throw new Error(`Unknown M9 control ${item.kind}`);
		}
	}
	return {targetKey: model.targetKey, controls};
}

describe("M9 source-defined MM lycanthropes and Arcadia27 Wereshark", () => {
	it("anchors the actual MM sidebar, form exceptions and equipment-free grants, not example chassis", () => {
		const sidebar = read("data/variantrules.json").variantrule.find(entry => entry.name === "Player Characters as Lycanthropes" && entry.source === "MM");
		expect(sidebar.page).toBe(207);
		expect(sidebar.entries[0]).toMatch(/speeds in non-humanoid form.*actions that don't involve equipment/);
		expect(sidebar.entries[1]).toMatch(/If the character embraces the curse/);
		for (const name of ["Werebear", "Wereboar", "Wererat", "Weretiger", "Werewolf"]) {
			expect(rule(source(name), "Shapechanger").entries[0]).toContain("isn't transformed");
			expect(source(name).immune[0]).toMatchObject({note: "from nonmagical attacks that aren't silvered", cond: true});
		}
		expect(source("Giant Rat").size).toEqual(["S"]);
		expect(source("Tiger").size).toEqual(["L"]);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});

	it.each(kinds.flatMap(kind => forms.map(form => [kind, form])))("retains sidebar statistics and source routine scope for equipment-free %s %s", (kind, form) => {
		const base = equipmentFreeCommoner();
		expect(base.senses).toBeUndefined();
		const prefix = patch("renamed-prefix", {name: "Renamed equipment-free Humanoid"});
		const inputs = equipmentFreeDecisions(base, kind);
		const out = replayCompiled(base, compiled(base, kind, inputs, [prefix]), form, [prefix]);
		expect(rule(out, "Finesse Claw", "action").entries[0]).toContain(`{@hit ${kind === "wererat" ? 4 : 2}}`);
		expect(rule(out, "Finesse Claw", "action").entries[0]).toContain(`{@damage 1d4${kind === "wererat" ? " + 2" : ""}}`);
		const routine = rule(out, "Lycanthrope Multiattack", "action");
		if (["wereboar", "wererat"].includes(kind) && form !== "animal") {
			const published = source(kind === "wereboar" ? "Wereboar" : "Wererat").action.find(entry => entry.name.startsWith("Multiattack"));
			expect(published.name).toContain("Humanoid or Hybrid Form Only");
			expect(published.entries[0]).toMatch(/two attacks, only one of which/);
			expect(routine).toBeDefined();
			expect(routine.entries[0]).toContain(`two attacks, at most one of them ${kind === "wereboar" ? "with its tusks" : "a bite"}`);
			expect(routine.entries[0]).toContain("grants no equipment or equipment attacks");
			expect(routine.entries[0]).toContain("alternative to any retained Multiattack");
			expect(rule(out, kind === "wereboar" ? "Tusks" : "Bite", "action") === undefined).toBe(form === "humanoid");
		} else if (form === "humanoid" || (form === "animal" && ["wereboar", "wererat"].includes(kind))) expect(routine).toBeUndefined();
		for (const name of ["Maul", "Shortsword", "Hand Crossbow", "Greataxe", "Scimitar", "Longbow", "Spear", "Trident"]) expect(rule(out, name, "action")).toBeUndefined();
		expect(out.senses).toEqual(kind === "wereshark" ? ["blindsight 60 ft."] : base.senses);
	});

	it("preserves existing non-donor senses in every MM form and keeps retained Multiattack an alternative", () => {
		for (const kind of ["wererat", "weretiger"]) {
			const base = {...equipmentFreeCommoner(), senses: ["darkvision 30 ft.", "tremorsense 10 ft."]};
			base.action.push({name: "Multiattack", source: "HB", entries: ["It makes two Finesse Claw attacks."]});
			const raw = compiled(base, kind, equipmentFreeDecisions(base, kind));
			for (const form of forms) {
				const out = replayCompiled(base, raw, form);
				expect(out.senses).toEqual(base.senses);
				expect(out.action.filter(entry => entry.name === "Multiattack")).toEqual([base.action[1]]);
				const routine = rule(out, "Lycanthrope Multiattack", "action");
				if (routine) expect(routine.entries[0]).toMatch(/alternative to/);
			}
		}
	});

	it.each(kinds.flatMap(kind => forms.map(form => [kind, form])))("applies %s %s effects through producer, normalizer, preview, operation, Registry and JSON replay", (kind, form) => {
		const base = scout();
		const raw = compiled(base, kind);
		expect(validate(raw)).toBe(true);
		expect(validate.errors).toBeNull();
		for (const profile of raw.frozenForms.profiles) {
			expect(validateLeaf(profile.resolved)).toBe(true);
			expect(validateLeaf.errors).toBeNull();
		}
		const out = replayCompiled(base, raw, form);
		const minimum = {werebear: 19, wereboar: 17, wererat: 15, weretiger: 17, werewolf: 15, wereshark: 16}[kind];
		expect(out.str).toBe(kind === "wererat" ? 11 : minimum);
		expect(out.dex).toBe(kind === "wererat" ? 15 : 14);
		for (const key of ["hp", "con", "int", "wis", "cha", "cr", "profBonus", "type", "gear", "alignment"]) expect(out[key]).toEqual(base[key]);
		expect(out.save).toEqual({str: kind === "wererat" ? "+2" : `+${2 + Math.floor((minimum - 10) / 2)}`, dex: "+4"});
		expect(out.immune).toContain("poison");
		for (const value of ["bludgeoning", "piercing", "slashing"]) {
			expect(out.immune).toContainEqual({immune: [value], note: "from nonmagical attacks that aren't silvered"});
			expect(out.immune).not.toContain(value);
		}
		expect(out.ac[0].ac).toBe(13 + (form !== "humanoid" && ["werebear", "wereboar", "werewolf", "wereshark"].includes(kind) ? 1 : 0));
		expect(out.speed.fly).toBe(50);
		expect(out.speed.alternate.fly).toEqual([60]);
		expect(out.speed.walk).toBe(kind === "wereshark" ? form === "animal" ? 0 : 30 : form === "humanoid" ? 35 : kind === "werebear" || (form === "animal" && ["wereboar", "weretiger", "werewolf"].includes(kind)) ? 40 : 30);
		expect(out.speed.climb).toBe(kind === "werebear" && form !== "humanoid" ? 30 : 12);
		expect(out.speed.swim).toBe(kind === "wereshark" && form !== "humanoid" ? 40 : 15);
		expect(out.size).toEqual([form === "animal" ? {werebear: "L", wererat: "S", weretiger: "L", wereshark: "L"}[kind] ?? "M" : kind === "werebear" && form === "hybrid" ? "L" : "M"]);
		expect(out.spellcasting).toEqual(form === "animal" ? [] : base.spellcasting);
		expect(out.languages).toEqual(form === "animal" ? ["understands Common, Elvish but can't speak", "telepathy 30 ft."] : base.languages);
		expect(!!rule(out, "Shortsword", "action")).toBe(form !== "animal");
		expect(!!rule(out, "Bite", "action")).toBe(form !== "humanoid" && kind !== "wereboar");
		expect(!!rule(out, "Tusks", "action")).toBe(form !== "humanoid" && kind === "wereboar");
		expect(!!rule(out, "Claw", "action")).toBe(form !== "humanoid" && ["werebear", "weretiger"].includes(kind));
		expect(!!rule(out, "Claws", "action")).toBe(form === "hybrid" && kind === "werewolf");
		expect(!!rule(out, "Charge")).toBe(form !== "humanoid" && kind === "wereboar");
		expect(!!rule(out, "Pounce")).toBe(form !== "humanoid" && kind === "weretiger");
		expect(!!rule(out, "Relentless (Recharges after a Short or Long Rest)")).toBe(kind === "wereboar");
		expect(!!rule(out, "Blood Frenzy")).toBe(kind === "wereshark");
		expect(out.senses).toEqual(kind === "wereshark" ? ["blindsight 60 ft."] : base.senses);
		if (kind === "wereshark") {
			expect(rule(out, "Change Shape", "bonus").entries[0]).toContain("bonus action");
			expect(rule(out, "Blood Frenzy").entries[0]).toMatch(/advantage on melee attack rolls.*missing any hit points/);
			for (const name of ["Amphibious", "From the Deep"]) expect(rule(out, name)).toBeUndefined();
			for (const name of ["Retreat to the Dark", "Trident"]) expect(rule(out, name, "action")).toBeUndefined();
			expect(rule(out, "Shapechanger")).toBeUndefined();
			expect(rule(out, "Change Shape")).toBeUndefined();
			expect(rule(out, "Lycanthrope Multiattack", "action")).toBeUndefined();
		} else {
			expect(rule(out, "Shapechanger").entries[0]).toContain("As an action");
			const curse = rule(out, "Curse of Lycanthropy").entries.join(" ");
			expect(curse).toMatch(/inherited.*remove curse\|PHB.*natural-born.*wish\|PHB/);
			expect(curse).toMatch(/full moon.*animal or hybrid.*Control returns.*moon wanes.*memories.*lost.*learned mastery.*DM may take control.*curse is removed/);
			if (kind === "wereboar") expect(rule(out, "Relentless (Recharges after a Short or Long Rest)").entries[0]).toMatch(/14 or less.*0 hit points.*1 hit point.*short or long rest/);
			else expect(rule(out, ["werebear", "wererat"].includes(kind) ? "Keen Smell" : "Keen Hearing and Smell").entries[0]).toMatch(/advantage.*Perception.*(?:hearing or )?smell/);
		}
		if (form !== "humanoid") {
			const natural = rule(out, kind === "wereboar" ? "Tusks" : "Bite", "action").entries[0];
			const modifier = kind === "wererat" ? 2 : Math.floor((minimum - 10) / 2);
			expect(natural).toContain(`{@hit ${modifier + 2}}`);
			expect(natural).toContain("{@dc 11}");
			const dice = {werebear: "2d10", wereboar: "2d6", wererat: "1d4", weretiger: "1d10", werewolf: "1d8", wereshark: "1d8"}[kind];
			expect(natural).toContain(`{@damage ${dice} + ${modifier}}`);
			if (kind === "wereshark") expect(natural).toMatch(/may pass on.*non-lycanthrope humanoid.*Constitution.*may choose to fail/);
			const claw = rule(out, kind === "werewolf" ? "Claws" : "Claw", "action");
			if (claw) {
				expect(claw.entries[0]).toContain(`{@hit ${modifier + 2}}`);
				expect(claw.entries[0]).toContain(`{@damage ${kind === "werebear" ? "2d8" : kind === "werewolf" ? "2d4" : "1d8"} + ${modifier}}`);
				expect(claw.entries[0]).not.toContain("lycanthropy");
			}
			const routine = rule(out, "Lycanthrope Multiattack", "action");
			if (kind === "werebear" || (kind === "weretiger" && form === "hybrid")) expect(routine.entries[0]).toContain("two claw attacks");
			else if (form === "hybrid" && kind === "werewolf") expect(routine.entries[0]).toContain("one bite attack and one claws attack");
			else if (form === "hybrid" && ["wereboar", "wererat"].includes(kind)) expect(routine.entries[0]).toContain(`two attacks, at most one of them ${kind === "wereboar" ? "with its tusks" : "a bite"}`);
			else expect(routine).toBeUndefined();
			if (kind === "wereboar" || kind === "weretiger") {
				const charge = rule(out, kind === "wereboar" ? "Charge" : "Pounce").entries[0];
				expect(charge).toMatch(/15 feet straight.*same turn.*\{@dc 13} Strength.*prone/);
				if (kind === "wereboar") expect(charge).toContain("7 ({@damage 2d6}) slashing");
				else expect(charge).toMatch(/prone.*bite attack.*bonus action/);
			}
		}
	});

	it.each(kinds)("rejects an inapplicable %s target and leaves another selected target isolated", kind => {
		const base = scout();
		const invalid = {...base, type: "beast"};
		const batch = previewCreatureTransformationTargets({targets: [target(base), target(invalid, [], "two")],
			resolved: pending(kind),
			automationInputs: {one: decisions(base, kind), two: decisions(invalid, kind)},
			acknowledgedPrerequisites: pending(kind).prerequisites,
			dmApproved: true});
		expect(batch.previews.map(entry => entry.id)).toEqual(["one"]);
		expect(batch.skipped.map(entry => entry.id)).toEqual(["two"]);
		expect(batch.skipped[0].reason).toContain("humanoid");
	});

	it.each(["werebear", "wereboar", "wererat", "weretiger", "werewolf"])("changes %s alignment only on explicit embrace, without resistance bypassing grants", kind => {
		const base = scout();
		base.alignment = ["C", "G"];
		base.alignmentPrefix = "usually ";
		const resist = decisions(base, kind);
		const embrace = structuredClone(resist);
		embrace.lycanthrope.embrace = true;
		for (const form of forms) {
			const resistant = replayCompiled(base, compiled(base, kind, resist), form);
			const embraced = replayCompiled(base, compiled(base, kind, embrace), form);
			expect(resistant.alignment).toEqual(["C", "G"]);
			expect(resistant.alignmentPrefix).toBe("usually ");
			expect(embraced.alignment).toEqual({werebear: ["N", "G"], wereboar: ["N", "E"], wererat: ["L", "E"], weretiger: ["N"], werewolf: ["C", "E"]}[kind]);
			expect(embraced.alignmentPrefix).toBe("");
			for (const key of ["str", "dex", "immune", "action", "trait", "speed"]) expect(resistant[key]).toEqual(embraced[key]);
		}
	});

	it("preserves higher target scores, STR-based rat bite when higher, strong senses and unchanged non-donor chassis", () => {
		const base = {...scout(), str: 24, dex: 20, con: 22, senses: ["darkvision 180 ft.", "blindsight 90 ft."], hp: {average: 34, formula: "3d8 + 21"}};
		const inputs = decisions(base, "wererat");
		inputs.bindings.armor = {mode: "retain"};
		for (const binding of inputs.bindings.entries) {
			binding.mode = "retain";
			delete binding.numbers;
		}
		const out = replayCompiled(base, compiled(base, "wererat", inputs), "animal");
		expect(out).toMatchObject({str: 24, dex: 20, con: 22, hp: base.hp, senses: base.senses, ac: base.ac});
		expect(rule(out, "Bite", "action").entries[0]).toContain("{@hit 9}");
		expect(rule(out, "Bite", "action").entries[0]).toContain("9 ({@damage 1d4 + 7})");
		expect(rule(out, "Bite", "action").entries[0]).toContain("{@dc 16}");
		for (const kind of kinds) {
			inputs.lycanthrope.adaptation = kind === "wereshark" ? "arcadia27-template" : "sidebar-npc";
			expect(replayCompiled(base, compiled(base, kind, inputs)).str).toBe(24);
		}
	});

	it("executes exact equipment/speech and armor decisions rather than stripping gear, invented movement or all capabilities", () => {
		const base = scout();
		const inputs = decisions(base);
		inputs.lycanthrope.animal.armor = {mode: "unarmored", reason: "The reviewed animal anatomy cannot wear this leather armor."};
		inputs.lycanthrope.animal.entries.find(entry => entry.match.name === "Shortsword").equipment = "usable";
		inputs.lycanthrope.hybrid.entries.find(entry => entry.match.name === "Longbow").equipment = "unusable";
		const raw = compiled(base, "werewolf", inputs);
		const animal = replayCompiled(base, raw, "animal");
		expect(animal.ac).toEqual([13]);
		expect(rule(animal, "Shortsword", "action")).toBeDefined();
		expect(rule(animal, "Longbow", "action")).toBeUndefined();
		expect(rule(animal, "Keen Hearing and Sight")).toEqual(base.trait[0]);
		expect(animal.gear).toEqual(base.gear);
		const hybrid = replayCompiled(base, raw, "hybrid");
		expect(rule(hybrid, "Longbow", "action")).toBeUndefined();
		expect(hybrid.spellcasting).toEqual(base.spellcasting);
	});

	it.each(kinds)("builds exact source-qualified guided controls for %s without answering or silently retargeting them", kind => {
		const base = scout();
		const subject = target(base);
		const resolved = pending(kind);
		const answers = guidedAnswers(subject, kind);
		const ready = compileCreatureTransformationInputs({target: subject, resolved, answers});
		expect(ready.status).toBe("ready");
		expect(ready.projection.str).toBe(kind === "wererat" ? 11 : {werebear: 19, wereboar: 17, weretiger: 17, werewolf: 15, wereshark: 16}[kind]);
		const batch = previewCreatureTransformationTargets({targets: [subject], resolved, guidedAnswers: {one: answers}, dmApproved: true, acknowledgedPrerequisites: resolved.prerequisites});
		expect(outcome(batch)).toEqual(ready.projection);
		expect(operation(batch).data.resolved.frozenForms.baseline.sourceUid).toBe("scout|mm");
		expect(compileCreatureTransformationInputs({target: {...subject, operations: [patch("renamed", {name: "Changed"})]}, resolved, answers}).status).toBe("needs-answers");
		const controls = inspectCreatureTransformationInputs({target: subject, resolved}).controls;
		for (const control of controls.filter(control => ["lycanthropeCapability", "lycanthropeEntryBinding"].includes(control.kind))) {
			const retargeted = structuredClone(answers);
			retargeted.controls[control.id].match = {name: "Other", source: "XMM"};
			expect(compileCreatureTransformationInputs({target: subject, resolved, answers: retargeted}).status).toBe("needs-answers");
		}
		delete answers.controls[Object.keys(answers.controls)[0]];
		expect(compileCreatureTransformationInputs({target: subject, resolved, answers}).status).toBe("needs-answers");
	});

	it.each(["werebear", "wereboar", "wererat", "weretiger", "werewolf", "wereshark"])("rejects incomplete or destructive closed %s snapshots in active AND inactive forms before conflict winners", kind => {
		const base = scout();
		const raw = compiled(base, kind);
		const prefix = conflictingPrefix(base);
		const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix]});
		const withPrefix = compiled(base, kind, retainedBindings(current, kind), [prefix]);
		const options = {baseCreature: base, operations: [prefix], resolved: normalizeCreatureTransformation(withPrefix), acknowledgedPrerequisites: withPrefix.prerequisites, dmApproved: true};
		const valid = BestiaryQuickActionsUtil.previewCreatureTransformation(options);
		expect(valid.conflicts.length).toBeGreaterThan(0);
		const kept = Object.fromEntries(valid.conflicts.map(({path}) => [path, "existing"]));
		const retained = BestiaryQuickActionsUtil.previewCreatureTransformation({...options, conflictDecisions: kept});
		expect(retained.canApply).toBe(true);
		expect(retained.proposed).toEqual(current);
		const mutations = [
			leaf => { leaf.changes = leaf.changes.filter(step => step.op !== "setAbility"); },
			leaf => { leaf.changes.push({op: "setAbility", ability: "con", value: 18}); },
			leaf => { leaf.changes = leaf.changes.filter(step => step.op !== "grantConditionalDefense" || step.value !== "slashing"); },
			leaf => { leaf.changes.push({op: "removeEntry", section: "trait", match: {name: "Keen Hearing and Sight", source: "MM"}}); },
			leaf => { leaf.changes.find(step => step.op === "setLycanthropeForm").speed.fly = 0; },
			leaf => { leaf.changes = leaf.changes.filter(step => step.op !== "removeLycanthropeSpellcasting"); },
			leaf => { leaf.changes = leaf.changes.filter(step => step.op !== "removeEntry" || step.match.name !== "Longbow"); },
			leaf => { leaf.changes.find(step => step.op === "addEntry" && ["Bite", "Tusks"].includes(step.entry.name)).entry.entries[0] = "An incomplete natural attack."; },
		];
		for (const mutate of mutations) {
			const bad = structuredClone(raw);
			const leaf = bad.frozenForms.profiles[2].resolved;
			mutate(leaf);
			for (const formId of ["humanoid", "animal"]) expect(() => replayCompiled(base, bad, formId)).toThrow();
			// A coherent retained winner cannot hide a deficient inactive source profile.
			const invalidRetained = structuredClone(withPrefix);
			mutate(invalidRetained.frozenForms.profiles[2].resolved);
			expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({...options,
				resolved: normalizeCreatureTransformation(invalidRetained),
				conflictDecisions: kept})).toThrow();
		}
	});

	it("checks target-relative minima and dependent setters rather than trusting self-consistent snapshots or producer markers", () => {
		const base = scout();
		const raw = compiled(base, "werebear");
		const higher = {...base, str: 24};
		raw.frozenForms.baseline = BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: higher});
		expect(() => replayCompiled(higher, raw)).toThrow();
		const rat = compiled(base, "wererat");
		for (const profile of rat.frozenForms.profiles) profile.resolved.changes = profile.resolved.changes.filter(step => step.op !== "setArmorClass");
		rat.changes = structuredClone(rat.frozenForms.profiles[0].resolved.changes);
		// DEX14 ->15 has the same modifier: omitting AC/save/attack setters is genuinely correct.
		expect(replayCompiled(base, rat).ac).toEqual(base.ac);
		const lower = {...base, dex: 12, ac: [{...base.ac[0], ac: 12}], save: {str: "+2", dex: "+3"}};
		for (const entry of lower.action.slice(1)) entry.entries[0] = entry.entries[0].replace("{@hit 4}", "{@hit 3}").replace(/\b[56] \(\{@damage 1d([68]) \+ 2}\)/, (_all, faces) => `${faces === "6" ? 4 : 5} ({@damage 1d${faces} + 1})`);
		const changed = compiled(lower, "wererat");
		const missing = structuredClone(changed);
		missing.frozenForms.profiles[1].resolved.changes = missing.frozenForms.profiles[1].resolved.changes.filter(step => step.op !== "setArmorClass" && step.op !== "setSaveBonus" && step.op !== "setEntryNumbers");
		expect(() => replayCompiled(lower, missing)).toThrow();
		const out = replayCompiled(lower, changed, "hybrid");
		expect(out.ac[0].ac).toBe(13);
		expect(out.save.dex).toBe("+4");
		expect(rule(out, "Shortsword", "action").entries[0]).toContain("5 ({@damage 1d6 + 2})");
	});

	it("requires consent, exact source matches and every form decision, with no baseline accepted from answers", () => {
		const base = scout();
		for (const mutate of [
			input => { input.lycanthrope.adaptation = "vampire"; },
			input => { delete input.lycanthrope.embrace; },
			input => { input.lycanthrope.animal.entries.pop(); },
			input => { input.lycanthrope.hybrid.entries[0].match.source = "XMM"; },
			input => { input.lycanthrope.animal.entries[0].equipment = "maybe"; },
			input => { input.lycanthrope.hybrid.entries.push(input.lycanthrope.hybrid.entries[0]); },
			input => { input.lycanthrope.animal.armor.mode = "drop-all-gear"; },
			input => { input.bindings.entries[0].match.source = "XMM"; },
			input => { input.bindings.entries.push(input.bindings.entries[0]); },
			input => { delete input.bindings.proficiencyBonus; },
			input => { input.lycanthrope.baseline = {sourceUid: "scout|mm", key: "12345678"}; },
			input => { input.lycanthrope.replaceFeatures = [{section: "trait", match: {name: "Keen Hearing and Sight", source: "MM"}}]; },
		]) {
			const inputs = decisions(base);
			mutate(inputs);
			const batch = preview(target(base), "werewolf", inputs);
			expect(batch.previews).toEqual([]);
			expect(batch.skipped).toHaveLength(1);
		}
		expect(preview(target(base), "werewolf", decisions(base), {dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(base), "werewolf", decisions(base), {acknowledgedPrerequisites: []})).toThrow(/prerequisite/i);
		const shark = decisions(base, "wereshark");
		shark.lycanthrope.embrace = true;
		expect(preview(target(base), "wereshark", shark).previews).toEqual([]);
	});

	it("replaces exact competing source grants and rejects wrong-source replacement instead of stacking", () => {
		const base = scout();
		base.trait.push({name: "Shapechanger", source: "HB", entries: ["Old form rule."]});
		const input = decisions(base);
		expect(preview(target(base), "werewolf", input).skipped[0].reason).toMatch(/replaceFeatures/);
		input.lycanthrope.replaceFeatures = [{section: "trait", match: {name: "Shapechanger", source: "HB"}}];
		const raw = compiled(base, "werewolf", input);
		for (const form of forms) expect(replayCompiled(base, raw, form).trait.filter(entry => entry.name === "Shapechanger")).toEqual([expect.objectContaining({source: "MM"})]);
		input.lycanthrope.replaceFeatures[0].match.source = "MM";
		expect(preview(target(base), "werewolf", input).previews).toEqual([]);
	});

	it.each(kinds)("switches %s through real Registry/Encounter JSON reload/removal with a nonempty renamed prefix and isolated second target", async kind => {
		const base = scout();
		const prefix = patch("prefix", {name: "Renamed scout"});
		const first = preview(target(base, [prefix]), kind);
		const owner = operation(first);
		expect(owner.data.resolved.frozenForms.baseline.sourceUid).toBe("scout|mm");
		const suffix = patch("suffix", {wis: 19});
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, owner, suffix]});
		const originalCatalog = catalog.creatureTransformation;
		catalog.creatureTransformation = [];
		try {
			for (const formId of ["hybrid", "animal", "humanoid"]) {
				const next = switchForm(target(base, registry.getOperations({creature: base})), formId);
				registry.applyChanges({creature: base, ...JSON.parse(JSON.stringify(next.changes[0]))});
				expect(registry.getCreature({creature: base})).toEqual(next.batch.proposed);
				expect(registry.getOperations({creature: base}).map(item => item.id)).toEqual(["prefix", "lycan-owner", "suffix"]);
				expect(registry.getOperations({creature: base})[2]).toEqual(suffix);
			}
			let initial = await encounter(base);
			initial = EncounterWorkspaceState.withStatblockChanges(initial, [{id: "one", addOperations: [prefix, JSON.parse(JSON.stringify(owner))], removeIds: []}]).state;
			const saved = persistence(initial);
			await saved.store.pSave(initial);
			await saved.reload();
			for (const formId of ["hybrid", "animal", "humanoid"]) {
				const next = switchForm(target(base, saved.adapter.getOperations()), formId);
				await saved.adapter.applyChanges(next.changes[0]);
				await saved.reload();
				expect(saved.adapter.getCreature()).toEqual(next.batch.proposed);
				expect(saved.state().instances[1].monster).toEqual(base);
				expect(saved.adapter.getOperations().map(item => item.id)).toEqual(["prefix", "lycan-owner"]);
			}
			const count = saved.storage.pSetForPage.mock.calls.length;
			expect(switchForm(target(base, saved.adapter.getOperations()), "humanoid").changes).toEqual([]);
			expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(count);
			await saved.adapter.removeOperation({operationId: "lycan-owner"});
			await saved.reload();
			expect(saved.adapter.getCreature()).toEqual({...base, name: "Renamed scout"});
			expect(saved.adapter.getOperations()).toEqual([prefix]);
		} finally { catalog.creatureTransformation = originalCatalog; }
		registry.removeOperation({creature: base, operationId: "lycan-owner"});
		expect(registry.getCreature({creature: base})).toEqual({...base, name: "Renamed scout", wis: 19});
	});

	it("preserves coherent retained/incoming conflict groups, and rejects stale histories, answers, owners and downstream dependency fences", () => {
		const base = scout();
		const prior = {id: "catalog:prior|hb", kind: "catalog", identity: {name: "Prior", source: "HB"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 12}, {type: "grantSense", sense: "darkvision", range: 30}], manualReview: []};
		const first = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: prior});
		const prefix = {id: "prefix", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: first})};
		const subject = target(base, [prefix]);
		const batch = preview(subject);
		const wins = Object.fromEntries(batch.previews[0].preview.conflicts.map(({path}) => [path, "incoming"]));
		const kept = Object.fromEntries(Object.keys(wins).map(path => [path, "existing"]));
		expect(outcome(preview(subject, "werewolf", decisions(base), {conflictDecisions: {one: kept}}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix]}));
		const accepted = preview(subject, "werewolf", decisions(base), {conflictDecisions: {one: wins}});
		const owner = operation(accepted, {one: wins});
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [owner]})).toThrow(/pre-template history changed/);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "XMM"}, operations: [prefix, owner]})).toThrow();
		const changed = structuredClone(accepted.automationInputs);
		changed.one.lycanthrope.embrace = true;
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: accepted.targets, automationInputs: changed, conflictDecisions: {one: wins}})).toThrow(/input answers changed/);
		const laterResolved = {...prior, id: "catalog:later|hb", identity: {name: "Later", source: "HB"}, changes: [{type: "setAbility", ability: "str", value: 22}]};
		const laterPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: [prefix, owner], resolved: laterResolved, conflictDecisions: {str: "incoming"}});
		const later = {id: "later", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: [prefix, owner], preview: laterPreview, conflictDecisions: {str: "incoming"}})};
		expect(() => switchForm(target(base, [prefix, owner, later]), "animal")).toThrow(/Conflict context changed/);
		expect(() => switchForm(target(base, [prefix, owner]), "werebear")).toThrow(/permitted/);
		const corrupt = structuredClone(owner);
		corrupt.data.resolved.frozenForms.profiles[1].label = "Corrupt";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, corrupt]})).toThrow();
	});

	it("rejects mixed dependent winners and atomically preserves Registry/Encounter state on invalid profiles or failed storage", async () => {
		const base = scout();
		const conflicting = conflictingPrefix(base);
		const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [conflicting]});
		const conflictingInputs = retainedBindings(current, "wereshark");
		const conflictBatch = preview(target(base, [conflicting]), "wereshark", conflictingInputs);
		const conflicts = conflictBatch.previews[0].preview.conflicts;
		expect(conflicts.map(({path}) => path)).toEqual(expect.arrayContaining(["str", "senses:blindsight"]));
		const mixed = Object.fromEntries(conflicts.map(({path}, index) => [path, index ? "existing" : "incoming"]));
		const rejected = preview(target(base, [conflicting]), "wereshark", conflictingInputs, {conflictDecisions: {one: mixed}});
		expect(rejected.previews).toEqual([]);
		expect(rejected.skipped[0].reason).toMatch(/must share one conflict winner/);
		const prefix = patch("prefix", {name: "Renamed scout", str: 12, ac: [{ac: 12, from: base.ac[0].from}]});
		const inputs = decisions(base);
		inputs.bindings.armor = {mode: "retain"};
		const subject = target(base, [prefix]);
		const initialBatch = preview(subject, "werebear", inputs);
		const owner = operation(initialBatch);
		let initial = await encounter(base);
		initial = EncounterWorkspaceState.withStatblockChanges(initial, [{id: "one", addOperations: [prefix, owner], removeIds: []}]).state;
		const saved = persistence(initial);
		await saved.store.pSave(initial);
		const next = switchForm(target(base, saved.adapter.getOperations()), "animal");
		const before = saved.state();
		const notify = jest.fn();
		saved.adapter.subscribe(notify);
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("M9 disk full"));
		await expect(saved.adapter.applyChanges(next.changes[0])).rejects.toThrow("M9 disk full");
		expect(saved.state()).toBe(before);
		expect(notify).not.toHaveBeenCalled();
		await saved.adapter.applyChanges(next.changes[0]);
		await saved.reload();
		expect(saved.adapter.getCreature().size).toEqual(["L"]);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, owner]});
		const operations = registry.getOperations({creature: base});
		const bad = structuredClone(next.changes[0]);
		bad.replaceOperation.operation.data.resolved.frozenForms.profiles[1].resolved.changes = bad.replaceOperation.operation.data.resolved.frozenForms.profiles[1].resolved.changes.filter(step => step.type !== "grantConditionalDefense" || step.value !== "slashing");
		expect(() => registry.applyChanges({creature: base, ...bad})).toThrow(/immutable/);
		expect(registry.getOperations({creature: base})).toEqual(operations);
		const beforeInvalid = saved.state();
		const writes = saved.storage.pSetForPage.mock.calls.length;
		bad.replaceOperation.expectedIntegrity = saved.adapter.getOperations().find(operation => operation.id === "lycan-owner").data.integrity;
		await expect(saved.adapter.applyChanges(bad)).rejects.toThrow(/immutable/);
		// A self-consistent signed envelope is still not evidence of complete source effects.
		const incompletePreview = structuredClone(initialBatch.previews[0].preview);
		incompletePreview.resolved.frozenForms.profiles[1].resolved.changes = incompletePreview.resolved.frozenForms.profiles[1].resolved.changes.filter(step => step.type !== "grantConditionalDefense" || step.value !== "slashing");
		const signedIncomplete = {id: "lycan-owner", ...BestiaryCreatureTransformation.createOperation({preview: incompletePreview, currentPreview: incompletePreview})};
		const other = new BestiaryQuickActionsRegistry();
		expect(() => other.applyChanges({creature: base, addOperations: [prefix, signedIncomplete]})).toThrow(/complete source profile/);
		expect(other.getOperations({creature: base})).toEqual([]);
		await expect(saved.adapter.applyChanges({removeIds: ["lycan-owner"], addOperations: [signedIncomplete]})).rejects.toThrow(/complete source profile/);
		expect(saved.state()).toBe(beforeInvalid);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(writes);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("keeps M9 owner replacement at Encounter slot 100 and rejects oversized M9 operations before either store mutates", async () => {
		const base = scout();
		const prefix = Array.from({length: 99}, (_, index) => patch(`prefix-${index}`, {name: "Renamed scout"}));
		const owner = operation(preview(target(base, prefix), "wereshark"));
		const saved = persistence(await encounter(base));
		await saved.adapter.applyChanges({addOperations: [...prefix, owner]});
		const next = switchForm(target(base, saved.adapter.getOperations()), "animal");
		await saved.adapter.applyChanges(next.changes[0]);
		expect(saved.adapter.getOperations()).toHaveLength(100);
		expect(saved.adapter.getOperations()[99].id).toBe("lycan-owner");
		expect(saved.adapter.getCreature().speed.walk).toBe(0);
		const before = saved.state();
		const writes = saved.storage.pSetForPage.mock.calls.length;
		await expect(saved.adapter.applyChanges({addOperations: [patch("101", {wis: 18})]})).rejects.toThrow();
		expect(saved.state()).toBe(before);
		const bytes = operation => new TextEncoder().encode(JSON.stringify(operation)).length;
		const oversized = {...owner, id: "x".repeat(BestiaryCreatureTransformation.MAX_OPERATION_BYTES - bytes(owner) + owner.id.length + 1)};
		expect(bytes(oversized)).toBe(BestiaryCreatureTransformation.MAX_OPERATION_BYTES + 1);
		await expect(saved.adapter.applyChanges({removeIds: ["lycan-owner"], addOperations: [oversized]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(before);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(writes);
		const registry = new BestiaryQuickActionsRegistry();
		expect(() => registry.applyChanges({creature: base, addOperations: [oversized]})).toThrow(/size budget/);
		expect(registry.getOperations({creature: base})).toEqual([]);
	});

	it("preserves unaffected catalog data and compares accepted-base/current catalog v1 and Species outputs through current code", () => {
		const acceptedBase = JSON.parse(childProcess.execFileSync("git", ["show", "55fe416b0b2324f60be420a42a58ea25b99f4daf:data/creature-transformations.json"], {encoding: "utf8"}));
		for (const recipe of catalog.creatureTransformation) {
			const prior = acceptedBase.creatureTransformation.find(entry => entry.name === recipe.name && entry.source === recipe.source);
			const current = structuredClone(recipe);
			if (["Lycanthropy|MM", "Wereshark|Arcadia27", "Fey Beast|SCRE", "Fallen Angel|SCRE"].includes(`${recipe.name}|${recipe.source}`)) delete current.automation;
			expect(current).toEqual(prior);
		}
		for (const kind of kinds) {
			expect(pending(kind, 1)).toEqual(pending(kind, 1, acceptedBase));
			const resolved = normalizeCreatureTransformation(pending(kind, 1));
			const old = normalizeCreatureTransformation(pending(kind, 1, acceptedBase));
			expect(BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: scout(), resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true}).proposed)
				.toEqual(BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: scout(), resolved: old, acknowledgedPrerequisites: old.prerequisites, dmApproved: true}).proposed);
		}
		const race = {name: "Species reach control", source: "TST", size: ["M"], speed: 30, ability: [{dex: 2}], entries: []};
		const resolveRace = data => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races: [race]}), id: "race:species reach control|tst"});
		expect(resolveRace(catalog)).toEqual(resolveRace(acceptedBase));
		const group = catalog.creatureTransformation.find(entry => entry.name === "Lycanthropy").optionGroups;
		expect(group.map(entry => entry.id)).toEqual(["form"]);
		expect(group[0].options.map(option => option.id)).toEqual(kinds.slice(0, 5));
		expect(catalog.creatureTransformation.find(entry => entry.name === "Wereshark").optionGroups).toEqual([]);
	});

	it("rejects source/profile/version/envelope mistakes through schema, candidate and ordinary operation boundaries", () => {
		for (const kind of ["werewolf", "wereshark"]) {
			for (const mutate of [
				record => { record.source = "XMM"; },
				record => { record.automation.profile = "arbitrary"; },
				record => { record.automation.rollout = "enabled"; },
				record => { record.automation.version = 3; },
				record => { record.automation.path = "action"; },
			]) {
				const bad = structuredClone(catalog);
				mutate(bad.creatureTransformation.find(entry => entry.name === (kind === "wereshark" ? "Wereshark" : "Lycanthropy")));
				expect(getCreatureTransformationSchemaErrors({data: bad, filePath: "m9"})).not.toEqual([]);
				expect(() => getCreatureTransformationCandidates({catalog: bad, races: []})).toThrow();
			}
			const bad = structuredClone(catalog);
			bad.creatureTransformation.find(entry => entry.name === (kind === "wereshark" ? "Wereshark" : "Lycanthropy")).source = "XMM";
			expect(getCreatureTransformationIdentityErrors({data: bad, filePath: "m9"})).not.toEqual([]);
			const raw = compiled(scout(), kind);
			const {frozenForms, ...leaf} = raw;
			expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: scout(), resolved: normalizeCreatureTransformation(leaf)})).toThrow(/requires its frozen/);
			raw.frozenForms.profiles[1].id = "arbitrary";
			expect(() => normalizeCreatureTransformation(raw)).toThrow();
		}
		expect(inspectCreatureTransformationInputs({target: target(scout()), resolved: {...pending("werewolf"), id: "catalog:unsupported|hb", automation: undefined}}).status).toBe("unsupported");
		expect(BestiaryCreatureTransformation.MAX_OPERATION_BYTES).toBe(180_000);
	});
});
