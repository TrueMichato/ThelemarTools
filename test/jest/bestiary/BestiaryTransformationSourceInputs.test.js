import fs from "node:fs";
import {jest} from "@jest/globals";
import Ajv from "ajv/dist/2020.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import {getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {observeCreatureTransformationBindings} from "../../../js/creature-transformation-bindings.js";
import {inspectCreatureTransformationSourceInputs, previewCreatureTransformationSourceInputs, compileCreatureTransformationSourceInputs, SOURCE_ESTIMATE_MODE} from "../../../js/bestiary/bestiary-transformation-source-inputs.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets, previewCreatureTransformationForm, createCreatureTransformationFormChanges} from "../../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsOperations, BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {BestiaryQuickActionsUi} from "../../../js/bestiary/bestiary-quick-actions-ui.js";
import {BestiaryCreatureTransformation} from "../../../js/bestiary/bestiary-creature-transformation.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../../js/encounterworkspace/encounterworkspace-quick-actions.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const mm = read("data/bestiary/bestiary-mm.json").monster;
const table = read("data/msbcr.json").cr;
const schema = read("schema/site/creature-transformation.json");
const validateLeaf = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/estimatedCompiled"});
const validateForms = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/estimatedFrozenForm"});
const candidates = getCreatureTransformationCandidates({catalog, races: []});
const source = name => structuredClone(mm.find(item => item.name === name && item.source === "MM"));
const target = (baseCreature = source("Bugbear"), operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const pending = (name, book, selections = {}) => resolveCreatureTransformation({candidates, id: `catalog:${name}|${book}`.toLowerCase(), selections, automationVersion: 2});
const patch = (id, set) => ({id, type: "patch", data: {patch: {set}}});
const effective = subject => BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: subject.operations});
const numbers = entry => entry.tokens.map(({paragraph, kind, token, value, dice}) => ({paragraph, kind, token, mode: "fixed", value, ...dice ? {dice} : {}}));
function bindings (current, ability = "str") {
	return {proficiencyBonus: current.profBonus ?? Parser.crToPb(current.cr?.cr ?? current.cr),
		armor: {mode: "retain"},
		entries: observeCreatureTransformationBindings({current}).filter(item => item.needsBinding).map(entry => ({
			section: entry.section,
			match: entry.match,
			...entry.supported ? {mode: "bind",
				numbers: entry.tokens.map(token => {
					const numeric = numbers({tokens: [token]})[0];
					if (entry.section !== "action" || !/\{@atk [^}]*w}/.test(JSON.stringify(entry.entry.entries)) || !["hit", "damage"].includes(token.kind) || (token.kind === "damage" && token.token > 0)) return numeric;
					const proficiency = token.kind === "hit" ? 1 : 0;
					const pb = current.profBonus ?? Parser.crToPb(current.cr?.cr ?? current.cr);
					return {...numeric,
						mode: "ability",
						ability,
						proficiency,
						fixed: token.value - Parser.getAbilityModNumber(current[ability]) - proficiency * pb,
						...{value: undefined}};
				}).map(({value, ...numeric}) => numeric.mode === "fixed" ? {...numeric, value} : numeric)} : {mode: "retain"},
		}))};
}
function postBindings (current, ability = "str") {
	const {proficiencyBonus, ...declarations} = bindings(current, ability);
	return declarations;
}
function sourceAnswers (subject, resolved, inputs) {
	const model = inspectCreatureTransformationSourceInputs({target: subject, resolved});
	expect(model.requirements).toEqual([]);
	return {mode: SOURCE_ESTIMATE_MODE,
		targetKey: model.targetKey,
		source: Object.fromEntries(model.controls.flatMap(control => {
			const [namespace, field] = control.path;
			const value = field ? inputs[namespace]?.[field] : inputs[namespace];
			return value === undefined ? [] : [[control.id, {value, reason: "Reviewed the exact source clause and actual target capability."}]];
		}))};
}
function formAnswers (form, {attack = "Morningstar", override = null, zeroXp = false, bound = null, fixedDamage = null} = {}) {
	const selected = form.entries.find(item => item.section === "action" && item.match.name === attack);
	const damage = selected?.tokens.filter(item => item.kind === "damage" && item.average !== undefined) || [];
	const accuracy = selected?.tokens.find(item => item.kind === "hit" || item.kind === "dc");
	expect(fixedDamage !== null || selected).toBeTruthy();
	const declarations = structuredClone(bound ?? {armor: {mode: "retain"},
		entries: form.entries.filter(item => item.needsBinding).map(item => ({
			section: item.section, match: item.match, ...item.supported ? {mode: "bind", numbers: numbers(item)} : {mode: "retain"},
		}))});
	for (const entry of form.entries.filter(item => item.supported && item.needsBinding && item.sourceNumbers)) {
		const binding = declarations.entries.find(item => item.section === entry.section && JSON.stringify(item.match) === JSON.stringify(entry.match));
		Object.assign(binding, {mode: "bind",
			numbers: binding.numbers.map(number => entry.sourceNumbers.find(item =>
				item.paragraph === number.paragraph && item.kind === number.kind && item.token === number.token) || number)});
	}
	return {targetKey: form.targetKey,
		bindings: declarations,
		armorReason: "Retain the actual post-source armor; do not reapply ability changes.",
		proficiencies: Object.fromEntries(["save", "skill"].map(section => [section, {...Object.fromEntries(Object.keys(form.current[section] || {}).map(name => [name, 0])), ...form.sourceProficiencies[section]}])),
		defenses: form.defenses.map(({field}) => ({field, reason: "Reviewed the actual post-source field, conditional protections and absent alternatives."})),
		cr: {defense: {expectedCr: form.current.cr?.cr ?? form.current.cr,
			hpBoundary: null,
			acIndex: 0,
			acAdjustment: 0,
			hpAdjustment: 0,
			resistance: "none",
			vulnerability: false,
			regeneration: 0,
			note: "Selected actual AC and HP. This encounter judgment excludes situational defenses/regeneration; all source rules remain present."},
		routines: [{id: "reviewed",
			rows: (fixedDamage === null && damage.length ? damage.map(token => ({tokenId: token.id}))
				: [{fixed: {value: fixedDamage ?? 0, source: {name: form.label, source: "MM"}, reason: "Explicit three-round adjudication, including a no-actions mist routine."}}]).map(row => ({...row,
				counts: [1, 1, 1],
				targets: [1, 1, 1],
				timing: "normal",
				reason: "One reviewed use per round; no other damage in this declared encounter routine."})),
			accuracy: accuracy?.id ?? {kind: "attack", value: 0, source: {name: form.label, source: "MM"}, reason: "No attack/save in this declared no-damage routine."},
			mixedReason: "Use the declared routine's one predominant accuracy measure.",
			note: "Complete declared three-round encounter alternative."}],
		routine: "reviewed",
		review: {confirmed: true, reason: "Reviewed every source entry, defense and excluded alternative; this is an estimate, not playtesting."},
		override,
		zeroXp,
		proficiencyAnswer: null,
		coverage: form.entries.map(item => ({entryId: item.id,
			decision: item === selected ? "represented" : "excluded",
			reason: item === selected ? "Included in the declared routine." : "Reviewed exclusion from this encounter routine; source effects remain on the creature.",
			tokens: item.tokens.map(token => ({tokenId: token.id,
				decision: item === selected && (damage.includes(token) || token === accuracy) ? "represented" : "excluded",
				reason: item === selected ? "Include this attack and its complete damage; non-accuracy DCs are reviewed conditional riders." : "Not used in this declared encounter routine."}))}))}};
}
function answersFor (subject, resolved, inputs, options = {}) {
	const answers = sourceAnswers(subject, resolved, inputs);
	const model = previewCreatureTransformationSourceInputs({target: subject, resolved, answers});
	expect(model.requirements).toEqual([]);
	expect(model.status).toBe("source-ready");
	answers.forms = Object.fromEntries(model.forms.map(form => [form.id, formAnswers(form, {...typeof options === "function" ? options(form) : options, ...form.id === "mist" ? {fixedDamage: 0} : {}})]));
	return {answers, model};
}
function preview (subject, resolved, answers, extra = {}) {
	return previewCreatureTransformationTargets({targets: [subject],
		resolved,
		guidedAnswers: {[subject.id]: answers},
		crTable: table,
		generation: 1,
		acknowledgedPrerequisites: resolved.prerequisites,
		dmApproved: true,
		...extra});
}
function saved (subject, resolved, answers) {
	let batch = preview(subject, resolved, answers);
	expect(batch.skipped).toEqual([]);
	const conflictDecisions = {[subject.id]: Object.fromEntries(batch.previews[0].preview.conflicts.map(({path}) => [path, "incoming"]))};
	batch = preview(subject, resolved, answers, {conflictDecisions});
	const change = createCreatureTransformationChanges({batch, targets: batch.targets, conflictDecisions})[0];
	return {batch, change, owner: {...change.addOperations[0], id: "estimated-owner"}};
}
function lycanInputs (current, shark = false) {
	const observations = observeCreatureTransformationBindings({current});
	return {bindings: {...bindings(current), proficiencyBonus: Parser.crToPb(current.cr)},
		lycanthrope: {adaptation: shark ? "arcadia27-template" : "sidebar-npc",
			embrace: false,
			...Object.fromEntries(["hybrid", "animal"].map(form => [form, {armor: {mode: "retain", reason: "Source-fixed equipment policy."},
				entries: observations.map(item => ({section: item.section, match: item.match, requiresSpeech: false, equipment: "not-required"}))}]))}};
}
async function persistence (baseCreature) {
	let state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M13a production source", saveId: "m13a", items: [{h: "bugbear_mm", c: 1}]},
		pResolveItem: async () => ({entity: baseCreature}),
		fnUid: () => "one",
	});
	const values = new Map();
	const storage = {pGetForPage: jest.fn(async key => values.get(key)), pSetForPage: jest.fn(async (key, value) => values.set(key, JSON.parse(JSON.stringify(value))))};
	const store = new EncounterWorkspaceStore({storage});
	const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async result => { state = await store.pSave(result.state); }});
	return {adapter, storage, state: () => state, reload: async () => { state = await store.pLoad(); }};
}
function zombie (subject = target()) {
	const resolved = pending("Zombie", "DMG");
	const {creature: current} = BestiaryQuickActionsUtil._getReplayState({baseCreature: subject.baseCreature, operations: subject.operations});
	const {answers, model} = answersFor(subject, resolved, {reanimation: {}, bindings: bindings(current)});
	return {subject, resolved, answers, model};
}
function compile (fixture, answers = fixture.answers, subject = fixture.subject) {
	return compileCreatureTransformationSourceInputs({target: subject, resolved: fixture.resolved, answers, table});
}
function switchForm (subject, owner, formId) {
	const first = previewCreatureTransformationForm({target: subject, operationId: owner.id, formId});
	const conflictDecisions = Object.fromEntries((first.preview?.conflicts || []).map(({path}) => [path, "incoming"]));
	const batch = previewCreatureTransformationForm({target: subject, operationId: owner.id, formId, conflictDecisions});
	return {batch, changes: createCreatureTransformationFormChanges({batch, target: subject})};
}

describe("M13a production guided source -> estimate -> adapter/executor", () => {
	const cases = [
		["Half-Dragon", "MM", "Bugbear", {ancestry: ["red"], size: ["large-or-smaller"]}, () => ({}), "Fire Breath {@recharge 5}", out => expect(JSON.stringify(out.action)).toContain("7d6")],
		["Shadow Dragon", "MM", "Young Black Dragon", {}, current => ({shadow: {trueDragon: true, shadowfell: "years", proficiencyBonus: Parser.crToPb(current.cr), stealth: {proficiency: 1, residual: 0}, lair: {mode: "retain"}}}), "Bite", out => expect(JSON.stringify(out.action)).toContain("necrotic damage")],
		["Dracolich", "MM", "Adult Black Dragon", {}, current => ({reanimation: {age: "adult",
			trueDragon: true,
			shadowDragon: false,
			physiology: current.trait.map(entry => ({match: {name: entry.name, source: entry.source || current.source}, mode: entry.name === "Amphibious" ? "remove" : "retain"})),
			lair: {mode: "retain"}}}), "Bite", out => expect(out.trait.some(item => item.name === "Spirit Gem")).toBe(true)],
		["Spore Servant", "MM", "Bugbear", {}, current => ({spore: {bindings: {entries: [{section: "action", match: {name: "Morningstar", source: "MM"}, mode: "retain"}, {section: "action", match: {name: "Javelin", source: "MM"}, mode: "retain"}]}}}), "Morningstar", out => expect(JSON.stringify(out.action)).toContain("1d8 + 2")],
		["Vampire", "MM", "Bugbear", {outcome: ["vampire"]}, current => ({bindings: bindings(current),
			vampire: {adaptation: "sidebar-npc",
				grappleDc: 14,
				legendaryResistance: {mode: "grant"},
				batEntries: observeCreatureTransformationBindings({current}).map(item => ({section: item.section, match: item.match, requiresSpeech: false, carriedEquipment: "not-required"}))}}), "Bite (Bat or Vampire Form Only)", out => expect(out.str).toBe(18)],
		["Lycanthropy", "MM", "Bugbear", {form: ["werewolf"]}, current => lycanInputs(current), "Bite", out => expect(out.str).toBe(15)],
		["Skeleton", "DMG", "Bugbear", {}, current => ({reanimation: {}, bindings: bindings(current)}), "Morningstar", out => expect(out.dex).toBe(16)],
		["Zombie", "DMG", "Bugbear", {}, current => ({reanimation: {}, bindings: bindings(current)}), "Morningstar", out => expect(out.trait.some(item => item.name === "Undead Fortitude")).toBe(true)],
		["Wereshark", "Arcadia27", "Bugbear", {}, current => lycanInputs(current, true), "Bite", out => expect(out.str).toBe(16)],
		["Skeletal Wyrmling", "Ar8", "Black Dragon Wyrmling", {}, current => ({reanimation: {wyrmling: true,
			donor: {name: current.name, source: current.source},
			breaths: [{section: "action", match: {name: "Acid Breath {@recharge 5}", source: "MM"}, mode: "remove"}]},
		bindings: {...bindings(current), entries: bindings(current).entries.filter(entry => !/Breath/.test(entry.match.name))}}), "Bite", out => expect(out.action.some(item => /Breath/.test(item.name))).toBe(false)],
		["Shadow Dragon", "BEG", "Young Black Dragon", {}, current => ({shadow: {trueDragon: true, shadowfell: "born", proficiencyBonus: Parser.crToPb(current.cr), stealth: {proficiency: 1, residual: 0}, lair: {mode: "retain"}}}), "Bite", out => expect(JSON.stringify(out.trait)).toContain("BEG")],
		["Fey Beast", "SCRE", "Wolf", {features: ["barkskin", "fey-touched", "entangle", "spike-growth", "natural-camouflage", "plant-stride", "rooted", "tree-stride", "nature-sense", "teleport"]}, () => ({}), "Bite", out => expect(out.ac[0].ac).toBe(16)],
		["Fallen Angel", "SCRE", "Deva", {allegiance: ["fallen"]}, () => ({}), "Mace", out => expect(out.action.some(item => item.name.startsWith("Corrupting Touch"))).toBe(true)],
		["Undead", "SCRE", "Bugbear", {category: ["zombie"]}, current => ({undead: {bindings: {armor: {mode: "retain"}, entries: bindings(current).entries}}}), "Morningstar", out => expect(out.int).toBe(3)],
	];
	it.each(cases)("%s|%s reaches the real guided producer and freezes each actual source form", (name, book, monster, selections, inputs, attack, check) => {
		const subject = target(source(monster));
		const resolved = pending(name, book, selections);
		const {answers, model} = answersFor(subject, resolved, inputs(effective(subject)), form => ({attack: form.id === "humanoid" ? "Morningstar" : attack}));
		const {batch, owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [owner]});
		check(out);
		expect(batch.guidedModels[0].estimates.map(item => item.form)).toEqual(model.forms.map(item => item.id));
		expect(out.cr.xp).toBe(Parser.crToXpNumber(out.cr.cr));
		expect(out.pbNote).toBe(`+${out.profBonus}`);
		for (const form of owner.data.resolved.frozenForms?.profiles || [{resolved: owner.data.resolved}]) {
			expect(form.resolved.estimation.sourceChangeCount).toBeGreaterThan(0);
			expect(form.resolved.changes.at(-1).receipt.proficiency.source).toBe("derived-cr");
		}
		const raw = batch.guidedModels[0].compiled;
		const validate = raw.frozenForms ? validateForms : validateLeaf;
		expect(validate(JSON.parse(JSON.stringify(raw))) ? null : validate.errors).toBeNull();
		console.log(`REACH ${name}|${book}: guided -> source -> CR -> operation/replay; forms=${model.forms.map(item => item.id).join(",")}; entries=${model.forms.map(item => item.entries.length).join(",")}`);
	});

	it("uses actual post-history Zombie HP/damage and never falls back to the old numeric-only profile", () => {
		const subject = target(source("Bugbear"), [patch("history", {str: 17, action: [{name: "Morningstar", entries: ["{@atk mw} {@hit 5} to hit. 12 ({@damage 2d8 + 3}) piercing damage."]}]})]);
		const resolved = pending("Zombie", "DMG");
		const {answers} = answersFor(subject, resolved, {reanimation: {}, bindings: bindings(effective(subject))});
		const {batch, owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [...subject.operations, owner]});
		expect(out).toMatchObject({str: 18, con: 15, hp: {average: 32}, cr: {cr: expect.any(String)}});
		expect(out.action[0].entries[0]).toContain("13 ({@damage 2d8 + 4})");
		expect(batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(13);
		expect(owner.data.resolved.selectedOptions["automation-reanimation"]).toEqual(["zombie|dmg:m6"]);
		expect(out.trait.some(item => item.name === "Undead Fortitude")).toBe(true);
	});

	it("reaches all ten Half-Dragon ancestries at each source size with unchanged donor numbers", () => {
		for (const ancestry of ["black", "blue", "brass", "bronze", "copper", "gold", "green", "red", "silver", "white"]) {
			for (const [size, monster, attack] of [["large-or-smaller", "Bugbear", "Morningstar"], ["huge", "Cloud Giant", "Morningstar"], ["gargantuan", "Purple Worm", "Bite"]]) {
				const subject = target(source(monster));
				const resolved = pending("Half-Dragon", "MM", {ancestry: [ancestry], size: [size]});
				const {answers, model} = answersFor(subject, resolved, {}, {attack, override: {cr: "20", reason: "Deliberately test a changed chassis PB without rebinding the donor breath."}});
				const {owner} = saved(subject, resolved, answers);
				const out = effective({...subject, operations: [owner]});
				const breath = model.source.changes.find(step => step.op === "addEntry").entry;
				expect(out.action.find(item => item.name === breath.name)).toEqual(breath);
				expect(out.profBonus).toBe(6);
				expect(out.cr).toEqual({cr: "20", xp: 25000});
				expect(out.resist).toContain({black: "acid", blue: "lightning", brass: "fire", bronze: "lightning", copper: "acid", gold: "fire", green: "poison", red: "fire", silver: "cold", white: "cold"}[ancestry]);
			}
		}
		console.log("CHOICE REACH Half-Dragon: all ten ancestries x large-or-smaller/huge/gargantuan; donor values remain source-fixed even when chassis PB becomes 6.");
	});

	it.each(["werebear", "wereboar", "wererat", "weretiger", "werewolf"])("reaches %s humanoid/hybrid/animal effects without reapplying ability deltas", kind => {
		const subject = target(source("Bugbear"));
		const resolved = pending("Lycanthropy", "MM", {form: [kind]});
		const {answers, model} = answersFor(subject, resolved, lycanInputs(subject.baseCreature), form => ({
			attack: form.id === "humanoid" ? "Morningstar" : kind === "wereboar" ? "Tusks" : "Bite",
			override: {cr: "10", reason: "Exercise the post-source generated PB contribution."},
			bound: postBindings(form.current),
		}));
		const {owner} = saved(subject, resolved, answers);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: subject.baseCreature, addOperations: [owner]});
		for (const form of model.forms) {
			const current = target(subject.baseCreature, registry.getOperations({creature: subject.baseCreature}));
			const batch = previewCreatureTransformationForm({target: current, operationId: owner.id, formId: form.id});
			const changes = createCreatureTransformationFormChanges({batch, target: current});
			if (changes.length) registry.applyChanges({creature: subject.baseCreature, ...changes[0]});
			const out = registry.getCreature({creature: subject.baseCreature});
			expect(out.str).toBe(form.current.str);
			expect(out.profBonus).toBe(4);
			expect(out.cr).toEqual({cr: "10", xp: 5900});
			const attack = out.action.find(item => ["Bite", "Tusks"].includes(item.name));
			if (attack) expect(JSON.stringify(attack)).toContain(`{@hit ${Parser.getAbilityModNumber(out.str) + 4}}`);
			if (form.id === "animal") expect(out.size).toEqual(form.current.size);
		}
		console.log(`CHOICE REACH Lycanthropy ${kind}: saved/replaced all source forms; source ability floors applied once, generated attacks reconciled to PB 4.`);
	});

	it("reaches Vampire Spawn separately from full-vampire bat/mist/legendary grants", () => {
		const subject = target(source("Scout"));
		const resolved = pending("Vampire", "MM", {outcome: ["spawn"]});
		const {answers} = answersFor(subject, resolved, {bindings: bindings(subject.baseCreature, "dex"), vampire: {adaptation: "sidebar-npc", grappleDc: 13}}, {attack: "Bite"});
		const {owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [owner]});
		expect(owner.data.resolved.frozenForms).toBeUndefined();
		expect(out).toMatchObject({str: 18, dex: 18, con: 18});
		expect(out.legendary).toBeUndefined();
		expect(JSON.stringify(out.trait)).toContain("Regeneration");
		expect(JSON.stringify(out.trait)).not.toContain("Shapechanger");
	});

	it("reaches Devilsworn on a different actual angel and includes changed spell/weapon defenses before estimation", () => {
		const subject = target(source("Planetar"));
		const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["devilsworn"]});
		const {answers, model} = answersFor(subject, resolved, {}, {attack: "Greatsword"});
		const {batch, owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [owner]});
		expect(out.type.type ?? out.type).toBe("fiend");
		expect(out.resist).toContain("fire");
		expect(out.resist).toContain("cold");
		expect(out.skill.deception).toBe(`+${Parser.getAbilityModNumber(out.cha) + out.profBonus}`);
		expect(JSON.stringify(out.spellcasting)).not.toContain("raise dead");
		expect(out.action.find(item => item.name === "Greatsword")).toEqual(model.forms[0].current.action.find(item => item.name === "Greatsword"));
		expect(batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(43);
	});

	it.each(["omitted", "zero-use"])("rejects a represented Devilsworn damage rider that is %s from meaningful routines", omission => {
		const subject = target(source("Planetar"));
		const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["devilsworn"]});
		const {answers} = answersFor(subject, resolved, {}, {attack: "Greatsword", override: {cr: "20", reason: "Isolate routine completeness from PB fixed-point selection."}});
		const run = () => compileCreatureTransformationSourceInputs({target: subject, resolved, answers, table});
		expect(run().estimates[0].receipt.damagePerRound).toBe(43);
		const rows = answers.forms.default.cr.routines[0].rows;
		const rider = rows[1].tokenId;
		if (omission === "omitted") rows.pop();
		else rows[1].counts = [0, 0, 0];
		const coverage = answers.forms.default.cr.coverage.flatMap(item => item.tokens).find(item => item.tokenId === rider);
		expect(coverage.decision).toBe("represented");
		const result = run();
		expect(result.status).toBe("needs-answers");
		expect(result.requirements[0].reason).toMatch(/represented damage.*positive use|represented damage.*adjudication/i);
	});

	it("rejects a re-signed self-consistent DPR21 receipt that falsely claims the omitted rider is represented", () => {
		const subject = target(source("Planetar"));
		const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["devilsworn"]});
		const {answers} = answersFor(subject, resolved, {}, {attack: "Greatsword"});
		const rider = answers.forms.default.cr.routines[0].rows.pop().tokenId;
		const coverage = answers.forms.default.cr.coverage.flatMap(item => item.tokens).find(item => item.tokenId === rider);
		Object.assign(coverage, {decision: "excluded", reason: "Deliberately omit the fire rider in this encounter judgment; the source attack still retains it."});
		const {batch} = saved(subject, resolved, answers);
		const forged = structuredClone(batch.previews[0].preview);
		expect(forged.resolved.changes.at(-1).receipt.damagePerRound).toBe(21);
		const frozenCoverage = forged.resolved.estimation.inputs.composition.coverage.flatMap(item => item.tokens).find(item => item.tokenId === rider);
		Object.assign(frozenCoverage, {decision: "represented", reason: "The complete hit, including this damage rider, is represented."});
		// Totals, rows and effects remain self-consistent; the false inclusion claim is the only change.
		const operation = BestiaryCreatureTransformation.createOperation({preview: forged, currentPreview: forged});
		expect(() => effective({...subject, operations: [operation]})).toThrow(/represented damage.*positive use|represented damage.*adjudication/i);
	});

	it.each(["excluded", "alternative", "conditional", "fixed"])("allows a damage rider to be explicitly %s rather than silently omitted", policy => {
		const subject = target(source("Planetar"));
		const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["devilsworn"]});
		const {answers} = answersFor(subject, resolved, {}, {attack: "Greatsword", override: {cr: "20", reason: "Isolate the explicit routine policy from PB ambiguity."}});
		const cr = answers.forms.default.cr;
		const routine = cr.routines[0];
		const rider = routine.rows.pop();
		if (policy === "excluded") {
			Object.assign(cr.coverage.flatMap(item => item.tokens).find(item => item.tokenId === rider.tokenId), {
				decision: "excluded", reason: "Deliberately exclude the fire rider in this encounter; retain its actual source effect.",
			});
		} else if (policy === "alternative") cr.routines.push({...structuredClone(routine), id: "rider-alternative", rows: [rider]});
		else if (policy === "conditional") routine.rows.push({...rider, counts: [1, 0, 0], timing: "conditional", reason: "Include the exact fire rider on the first round only."});
		else {
			const {tokenId, ...schedule} = rider;
			routine.rows.push({...schedule, fixed: {value: 22, source: {name: "Greatsword", source: "MM"}, reason: "Explicitly account for the exact fire rider with this bounded per-use judgment."}, accountsFor: [tokenId]});
		}
		const {batch, owner} = saved(subject, resolved, answers);
		const expected = policy === "conditional" ? 28 : policy === "fixed" ? 43 : 21;
		expect(batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(expected);
		expect(validateLeaf(JSON.parse(JSON.stringify(batch.guidedModels[0].compiled))) ? null : validateLeaf.errors).toBeNull();
		expect(effective({...subject, operations: [owner]}).action.find(item => item.name === "Greatsword").entries).toEqual(subject.baseCreature.action.find(item => item.name === "Greatsword").entries.map(text => text.replace(/radiant/g, "fire")));
	});

	it("requires bounded fixed accounting to name exact represented damage tokens with positive uses", () => {
		const subject = target(source("Planetar"));
		const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["devilsworn"]});
		const {answers} = answersFor(subject, resolved, {}, {attack: "Greatsword"});
		const rider = answers.forms.default.cr.routines[0].rows.pop();
		const {tokenId, ...schedule} = rider;
		answers.forms.default.cr.routines[0].rows.push({...schedule, fixed: {value: 22, source: {name: "Greatsword", source: "MM"}, reason: "This bounded value accounts for exactly the linked fire rider."}, accountsFor: [tokenId]});
		const run = value => compileCreatureTransformationSourceInputs({target: subject, resolved, answers: value, table});
		const ready = run(answers);
		expect(ready.status).toBe("ready");
		for (const change of [
			(row, cr) => { delete row.accountsFor; },
			row => { row.accountsFor = []; },
			row => { row.accountsFor = ["another token"]; },
			row => { row.accountsFor.push(tokenId); },
			(row, cr) => { row.accountsFor = [cr.routines[0].accuracy]; },
			row => { row.counts = [0, 0, 0]; },
			row => { row.fixed.value = -1; },
			row => { row.fixed.reason = ""; },
			(row, cr) => { cr.coverage.flatMap(item => item.tokens).find(item => item.tokenId === tokenId).decision = "excluded"; },
			row => { delete row.fixed; row.tokenId = tokenId; },
		]) {
			const bad = structuredClone(answers);
			change(bad.forms.default.cr.routines[0].rows[1], bad.forms.default.cr);
			expect(run(bad).status).toBe("needs-answers");
		}
		for (const accountsFor of [[], [tokenId, tokenId], Array(101).fill(tokenId)]) {
			const bad = JSON.parse(JSON.stringify(ready.compiled));
			bad.estimation.inputs.composition.routines[0].rows[1].accountsFor = accountsFor;
			expect(validateLeaf(bad)).toBe(false);
		}
		console.log("CORRECTION REACH: represented damage must have positive scheduled use or exact bounded fixed accountsFor; omitted/zero-use riders, unrelated/duplicate/excluded/non-damage links and self-consistent signed false coverage reject. Explained exclusions and alternatives remain allowed.");
	});

	it("retains explicit fixed judgments for unsupported damage without treating them as parsed averages", () => {
		const base = source("Bugbear");
		base.action[0].entries[0] = "{@atk mw} {@hit 4} to hit. Special ({@damage 2d8 + 2}) piercing damage.";
		const subject = target(base);
		const resolved = pending("Half-Dragon", "MM", {ancestry: ["red"], size: ["large-or-smaller"]});
		const {answers, model} = answersFor(subject, resolved, {}, {attack: "Morningstar", fixedDamage: 11});
		const entry = model.forms[0].entries.find(item => item.match.name === "Morningstar");
		expect(entry.supported).toBe(false);
		const damage = entry.tokens.find(item => item.kind === "damage");
		const cr = answers.forms.default.cr;
		cr.routines[0].rows[0].accountsFor = [damage.id];
		cr.routines[0].accuracy = {kind: "attack", value: 4, source: entry.match, reason: "Explicit reviewed accuracy for unsupported attack content."};
		cr.coverage.flatMap(item => item.tokens).find(item => item.tokenId === damage.id).decision = "represented";
		const {batch, owner} = saved(subject, resolved, answers);
		expect(batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(11);
		expect(effective({...subject, operations: [owner]}).action[0]).toEqual(base.action[0]);
	});

	it.each([["ghostly", "withering-strikes"], ["ghostly", "spectral-strikes"], ...["skeletal", "vampiric", "zombie", "ghoulish", "mummified"].map(category => [category, null])])("reaches Undead %s (%s) and every catalog additional pick through finite guided declarations", (category, strikes) => {
		const subject = target(source("Frost Giant"));
		const selections = {category: [category]};
		const inputs = {undead: {}};
		if (["ghostly", "skeletal", "zombie", "mummified"].includes(category)) inputs.undead.bindings = {armor: {mode: "retain"}, entries: bindings(subject.baseCreature).entries};
		if (category === "ghostly") {
			selections["ghostly-strikes"] = [strikes];
			selections["ghostly-features"] = ["etherealness"];
			selections.miscellaneous = ["ethereal-sight"];
			inputs.undead.ghostAbility = "dex";
			inputs.undead.ghostWeapons = observeCreatureTransformationBindings({current: subject.baseCreature}).filter(item => item.section === "action" && /\{@atk [^}]*w}/.test(JSON.stringify(item.entry))).map(item => ({section: item.section, match: item.match, components: [0]}));
		}
		if (category === "vampiric") {
			selections["vampiric-weaknesses"] = ["forbiddance", "running-water", "stake-to-heart", "sunlight"];
			inputs.undead.drainAttack = {section: "action", match: {name: "Greataxe", source: "MM"}};
		}
		if (category === "ghoulish") selections["ghoulish-features"] = ["ghoulish-strikes", "stench"];
		if (category === "mummified") selections["mummified-features"] = ["rotting-strikes"];
		if (category === "skeletal") {
			selections.miscellaneous = catalog.creatureTransformation.find(item => item.name === "Undead").optionGroups.find(group => group.id === "miscellaneous").options.map(item => item.id);
			Object.assign(inputs.undead, {headless: true, spellAbility: "wis", components: ["V", "S"], glareAbility: "con"});
		}
		const resolved = pending("Undead", "SCRE", selections);
		const {answers, model} = answersFor(subject, resolved, inputs, {attack: "Greataxe"});
		const {batch, owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [owner]});
		expect(out.type).toBe("undead");
		expect(out.action).toEqual(model.forms[0].current.action);
		expect(batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(model.forms[0].entries.find(item => item.match.name === "Greataxe").tokens.filter(token => token.kind === "damage").reduce((sum, token) => sum + token.average, 0));
		if (category === "skeletal") {
			expect(JSON.stringify(out)).toMatch(/Deathly Aura.*Detect Life.*Ethereal Sight/);
			expect(out.spellcasting[0].daily["1e"]).toEqual(["{@spell bestow curse|PHB}"]);
			expect(out.spellcasting[0].will).toEqual(["{@spell chill touch|PHB}"]);
			expect(JSON.stringify(out.action)).toContain("Dreadful Glare");
			expect(JSON.stringify(out.bonus)).toContain("Shadow Stealth");
		}
		if (category === "ghostly") expect(JSON.stringify(out.action)).toMatch(new RegExp(`${strikes === "spectral-strikes" ? "force" : "necrotic"}.*Etherealness`));
		if (category === "vampiric") expect(JSON.stringify(out.trait)).toMatch(/Forbiddance.*Harmed by Running Water.*Stake to the Heart.*Sunlight Hypersensitivity/);
		console.log(`CHOICE REACH Undead ${category}: ${JSON.stringify(selections)}; ${model.forms[0].entries.length} actual post-source entries reviewed, no worked-example transplant.`);
	});

	it("requires exact finite source/form/history answers and complete token/defense judgments", () => {
		const fixture = zombie();
		for (const change of [
			answer => { answer.source.unknown = {value: true, reason: "An arbitrary extra source path is not a finite control."}; },
			answer => { delete answer.source[Object.keys(answer.source)[0]]; },
			answer => { answer.forms.default.targetKey = "another form"; },
			answer => { delete answer.forms.default; },
			answer => { answer.forms.extra = answer.forms.default; },
			answer => { answer.forms.default.defenses.pop(); },
			answer => { answer.forms.default.cr.coverage.pop(); },
			answer => { answer.forms.default.cr.coverage.find(item => item.entryId.includes("Javelin")).tokens.pop(); },
			answer => { answer.forms.default.cr.coverage.find(item => item.entryId.includes("Javelin")).tokens.find(item => item.tokenId.includes("damage")).decision = "represented"; },
			answer => { answer.forms.default.cr.routines[0].rows[0].tokenId = "unsupported or stale contribution"; },
			answer => { answer.forms.default.cr.override = {cr: "20", reason: ""}; },
			answer => { answer.forms.default.bindings.entries = null; },
		]) {
			const answers = structuredClone(fixture.answers); change(answers);
			const result = compile(fixture, answers);
			expect(result.status).toBe("needs-answers");
			expect(result.requirements[0].reason).toBeTruthy();
		}
		for (const subject of [target(source("Scout")), target(fixture.subject.baseCreature, [], "another-target"), target(fixture.subject.baseCreature, [patch("same-value-history", {str: 15})])]) {
			expect(compile(fixture, fixture.answers, subject).requirements[0].reason).toMatch(/stale|another target/);
		}
		const {batch} = saved(fixture.subject, fixture.resolved, fixture.answers);
		const changed = structuredClone(fixture.answers);
		changed.forms.default.armorReason = "Same concrete values but a different raw judgment.";
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, guidedAnswers: {one: changed}})).toThrow(/stale/);
		expect(preview(fixture.subject, fixture.resolved, fixture.answers, {dmApproved: false}).previews).toEqual([]);
		console.log("NEGATIVE REACH: unknown/missing controls, stale target/history/form, missing form/defense/entry/token, unsupported token, unexplained override, malformed bindings and absent consent all block.");
	});

	it("reconciles the source-generated Spore fallback attack rather than keeping or doubling its old PB", () => {
		const subject = target({...source("Scout"), action: []});
		const resolved = pending("Spore Servant", "MM");
		const {answers} = answersFor(subject, resolved, {spore: {proficiencyBonus: 2}}, {
			attack: "Unarmed Strike", override: {cr: "20", reason: "Exercise the fallback attack's explicit source PB formula."},
		});
		const {owner} = saved(subject, resolved, answers);
		const out = effective({...subject, operations: [owner]});
		expect(out.action).toHaveLength(1);
		expect(out.action[0].entries[0]).toContain(`{@hit ${6 + Parser.getAbilityModNumber(out.str)}}`);
		expect(out.action[0].entries[0]).toContain("{@damage 1d4}");
	});

	it("keeps the estimate receipt schema closed at its new boundaries", () => {
		const fixture = zombie();
		const raw = compile(fixture).compiled;
		for (const mutate of [
			value => { value.unexpected = true; },
			value => { value.estimation.unexpected = true; },
			value => { value.estimation.inputs.bindings.unexpected = true; },
			value => { value.estimation.inputs.composition.coverage[0].unexpected = true; },
			value => { value.estimation.inputs.composition.routines[0].rows[0].unexpected = true; },
		]) {
			const bad = JSON.parse(JSON.stringify(raw)); mutate(bad);
			expect(validateLeaf(bad)).toBe(false);
		}
	});

	it("pins donor DCs and generated PB formulas rather than accepting plausible relabelled numbers", () => {
		for (const [resolved, inputs, attack, tokenKind] of [
			[pending("Half-Dragon", "MM", {ancestry: ["red"], size: ["large-or-smaller"]}), {}, "Morningstar", "dc"],
			[pending("Fey Beast", "SCRE", {features: ["entangle", "spike-growth"]}), {}, "Morningstar", "dc"],
		]) {
			const subject = target(resolved.identity.name === "Fey Beast" ? source("Wolf") : source("Bugbear"));
			const {answers, model} = answersFor(subject, resolved, inputs, {attack: resolved.identity.name === "Fey Beast" ? "Bite" : attack,
				override: {cr: "20", reason: "Exercise generated and donor numbers across a PB boundary."}});
			const form = model.forms[0];
			const entry = form.entries.find(item => item.sourceNumbers?.some(number => number.kind === tokenKind));
			const declaration = answers.forms.default.bindings.entries.find(item => item.section === entry.section && JSON.stringify(item.match) === JSON.stringify(entry.match));
			const original = declaration.numbers.find(item => item.kind === tokenKind);
			const {owner} = saved(subject, resolved, answers);
			const out = effective({...subject, operations: [owner]});
			const actual = observeCreatureTransformationBindings({current: out}).find(item => item.section === entry.section && JSON.stringify(item.match) === JSON.stringify(entry.match));
			expect(actual.tokens.find(item => item.kind === tokenKind).value).toBe(resolved.identity.name === "Fey Beast" ? 8 + 6 + Parser.getAbilityModNumber(out.wis) : original.value);
			Object.assign(original, original.mode === "fixed"
				? {mode: "ability", ability: "con", proficiency: 1, fixed: original.value - Parser.getAbilityModNumber(form.current.con) - 2}
				: {mode: "fixed", value: 8 + 2 + Parser.getAbilityModNumber(form.current.wis)});
			if (original.mode === "ability") delete original.value;
			else { delete original.ability; delete original.proficiency; delete original.fixed; }
			const result = compileCreatureTransformationSourceInputs({target: subject, resolved, answers, table});
			expect(result.status).toBe("needs-answers");
			expect(result.requirements[0].reason).toMatch(/source-defined PB\/ability or donor-fixed/);
		}
	});

	it("keeps Fallen Angel skill minima without treating them as expertise or losing authored stronger values", () => {
		for (const minimum of [null, 30]) {
			const base = source("Planetar");
			if (minimum !== null) (base.skill ||= {}).deception = `+${minimum}`;
			const subject = target(base);
			const resolved = pending("Fallen Angel", "SCRE", {allegiance: ["fallen"]});
			const {answers} = answersFor(subject, resolved, {}, {attack: "Greatsword", override: {cr: "20", reason: "Exercise the source proficiency minimum at another PB."}});
			const {owner} = saved(subject, resolved, answers);
			const out = effective({...subject, operations: [owner]});
			expect(out.skill.deception).toBe(`+${Math.max(minimum ?? -1000, Parser.getAbilityModNumber(out.cha) + 6)}`);
			answers.forms.default.proficiencies.skill.deception = 2;
			expect(compileCreatureTransformationSourceInputs({target: subject, resolved, answers, table}).requirements[0].reason).toMatch(/actual source-defined PB multiplier 1/);
		}
	});

	it("pairs estimates with reasoned override/zero-XP and preserves actual PB ownership beyond Registry index 99", () => {
		const fixture = zombie();
		fixture.answers.forms.default.cr.override = {cr: "0", reason: "Explicit CR-zero encounter judgment."};
		fixture.answers.forms.default.cr.zeroXp = true;
		const zero = saved(fixture.subject, fixture.resolved, fixture.answers).owner;
		expect(effective({...fixture.subject, operations: [zero]}).cr).toEqual({cr: "0", xp: 0});
		fixture.answers.forms.default.cr.zeroXp = false;
		expect(effective({...fixture.subject, operations: [saved(fixture.subject, fixture.resolved, fixture.answers).owner]}).cr).toEqual({cr: "0", xp: 10});
		const prefix = Array.from({length: 101}, (_, index) => patch(`prefix-${index}`, {int: 8}));
		const first = zombie(target(source("Bugbear"), prefix));
		const owner = saved(first.subject, first.resolved, first.answers).owner;
		for (const authored of [false, true]) {
			const subject = target(first.subject.baseCreature, [...prefix, owner, ...authored ? [patch("authored-pb", {profBonus: 2, pbNote: "+2"})] : []]);
			const second = zombie(subject);
			second.answers.forms.default.cr.override = {cr: "5", reason: "Cross PB boundary while preserving the actual history owner."};
			const compiled = saved(subject, second.resolved, second.answers).owner;
			expect(compiled.data.resolved.changes.at(-1).receipt.proficiency).toMatchObject({
				source: authored ? "source-profBonus" : "derived-cr",
				after: authored ? 2 : 3,
				history: {ownership: authored ? "explicit" : "derived", index: authored ? 102 : 101},
			});
			const registry = new BestiaryQuickActionsRegistry();
			registry.applyChanges({creature: subject.baseCreature, addOperations: [...subject.operations, {...compiled, id: "second-owner"}]});
			expect(registry.getOperations({creature: subject.baseCreature})).toHaveLength(authored ? 104 : 103);
		}
		console.log("OWNERSHIP REACH: Registry PB owners at index 101/102 retain derived versus later same-value authored ownership; no Registry global 100-operation limit.");
	});

	it("recomputes signed frozen receipts and rejects altered effects, bindings, judgments and inactive forms", () => {
		const fixture = zombie();
		const {batch, owner} = saved(fixture.subject, fixture.resolved, fixture.answers);
		for (const mutate of [
			value => { value.changes.push({type: "setAbility", ability: "str", value: 30}); },
			value => { value.changes.find(item => item.type === "setChallengeRating").receipt.damagePerRound += 100; },
			value => { value.estimation.inputs.composition.routines[0].rows[0].counts = [2, 2, 2]; },
			value => { value.estimation.inputs.coverage.defenses.pop(); },
			value => { value.estimation.sourceChangeCount--; },
		]) {
			const forged = structuredClone(batch.previews[0].preview);
			mutate(forged.resolved);
			const operation = BestiaryCreatureTransformation.createOperation({preview: forged, currentPreview: forged});
			expect(() => effective({...fixture.subject, operations: [operation]})).toThrow();
		}
		const other = {...fixture.subject.baseCreature, source: "OTHER"};
		expect(() => effective(target(other, [owner]))).toThrow(/another creature/);
		const changed = target(fixture.subject.baseCreature, [patch("prior-change", {wis: 14}), owner]);
		expect(() => effective(changed)).toThrow(/pre-owner target changed/);
	});

	it("persists real Vampire forms atomically, retries explicitly and replays/replaces frozen data without live sources", async () => {
		const subject = target({...source("Bugbear"), size: ["L"]}, [patch("prefix", {int: 9})]);
		const resolved = pending("Vampire", "MM", {outcome: ["vampire"]});
		const {answers} = answersFor(subject, resolved, {bindings: bindings(effective(subject)),
			vampire: {adaptation: "sidebar-npc",
				grappleDc: 14,
				legendaryResistance: {mode: "grant"},
				batEntries: observeCreatureTransformationBindings({current: effective(subject)}).map(item =>
					({section: item.section, match: item.match, requiresSpeech: false, carriedEquipment: "not-required"}))}}, {attack: "Bite (Bat or Vampire Form Only)"});
		const {owner} = saved(subject, resolved, answers);
		const suffix = patch("suffix", {wis: 17});
		const operations = [...subject.operations, owner, suffix];
		const expected = effective({...subject, operations});
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: subject.baseCreature, addOperations: JSON.parse(JSON.stringify(operations))});
		const stored = await persistence(subject.baseCreature);
		const notify = jest.fn(); stored.adapter.subscribe(notify);
		stored.storage.pSetForPage.mockRejectedValueOnce(new Error("deliberate persistence failure"));
		const before = stored.state();
		await expect(stored.adapter.applyChanges({addOperations: operations})).rejects.toThrow(/deliberate persistence failure/);
		expect(stored.state()).toBe(before);
		expect(notify).not.toHaveBeenCalled();
		await stored.adapter.applyChanges({addOperations: operations});
		await stored.reload();
		expect(stored.adapter.getCreature()).toEqual(expected);
		const removed = catalog.creatureTransformation.splice(0);
		const rows = table.splice(0);
		try {
			for (const formId of ["bat", "mist", "true"]) {
				const current = target(subject.baseCreature, stored.adapter.getOperations());
				const {batch, changes} = switchForm(current, owner, formId);
				if (changes.length) {
					registry.applyChanges({creature: subject.baseCreature, ...changes[0]});
					await stored.adapter.applyChanges(changes[0]);
					await stored.reload();
				}
				expect(stored.adapter.getOperations().map(item => item.id)).toEqual(["prefix", owner.id, "suffix"]);
				expect(stored.adapter.getOperations()[2]).toEqual(suffix);
				expect(stored.adapter.getCreature()).toEqual(registry.getCreature({creature: subject.baseCreature}));
				expect(stored.adapter.getCreature()).toEqual(batch.proposed);
			}
			const current = target(subject.baseCreature, stored.adapter.getOperations());
			expect(switchForm(current, owner, "true").changes).toEqual([]);
			const forged = structuredClone(stored.adapter.getOperations()[1]);
			forged.data.resolved.frozenForms.profiles.find(item => item.id === "mist").resolved.estimation.inputs.coverage.defenses.pop();
			const signedPreview = {resolved: forged.data.resolved,
				original: subject.baseCreature,
				current: effective({...subject}),
				conflicts: [],
				canApply: true,
				manualReview: forged.data.resolved.manualReview,
				sourceUid: "bugbear|mm",
				dmApproved: true,
				acknowledgedPrerequisites: resolved.prerequisites};
			const signed = BestiaryCreatureTransformation.createOperation({preview: signedPreview, currentPreview: signedPreview});
			expect(() => effective({...subject, operations: [...subject.operations, signed]})).toThrow(/Review every post-source/);

			const batChange = switchForm(current, owner, "bat").changes[0];
			registry.applyChanges({creature: subject.baseCreature, ...batChange});
			await stored.adapter.applyChanges(batChange);
			const batTarget = target(subject.baseCreature, stored.adapter.getOperations());
			const replacements = ["mist", "true"].map(formId => switchForm(batTarget, owner, formId).changes[0]);
			const laterResolved = {id: "catalog:later|tst",
				kind: "catalog",
				identity: {name: "Later size", source: "TST"},
				provenance: {edition: "classic"},
				eligibility: [],
				prerequisites: [],
				selectedOptions: {},
				manualReview: [],
				changes: [{type: "setSize", value: "H"}]};
			const options = {baseCreature: subject.baseCreature, operations: batTarget.operations, resolved: laterResolved, conflictDecisions: {size: "incoming"}};
			const laterPreview = BestiaryQuickActionsUtil.previewCreatureTransformation(options);
			const later = {id: "later", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({...options, preview: laterPreview})};
			expect(later.data.approvedConflicts).toEqual([expect.objectContaining({path: "size", existing: ["T"], incoming: ["H"]})]);
			registry.addOperation({creature: subject.baseCreature, operation: later});
			await stored.adapter.addOperation({operation: later});
			const beforeRejected = stored.state();
			const writes = stored.storage.pSetForPage.mock.calls.length;
			const notifications = notify.mock.calls.length;
			for (const change of replacements) {
				expect(() => registry.applyChanges({creature: subject.baseCreature, ...change})).toThrow(/conflict.*changed/i);
				await expect(stored.adapter.applyChanges(change)).rejects.toThrow(/conflict.*changed/i);
				expect(stored.state()).toBe(beforeRejected);
			}
			expect(stored.storage.pSetForPage).toHaveBeenCalledTimes(writes);
			expect(notify).toHaveBeenCalledTimes(notifications);
		} finally {
			catalog.creatureTransformation.push(...removed); table.push(...rows);
		}
		console.log("PERSISTENCE REACH: real three-form Vampire, Registry + Encounter JSON store, failed-save zero notification/state mutation, explicit retry, source-free inactive replay, stable owner slot/suffix and same-active no change.");
	});

	it("uses raw deferred history for the source baseline, then flattens the actual effective creature for Homebrew", () => {
		const area = {id: "area", ...BestiaryQuickActionsOperations.applyAreaTrait({entry: {name: "Area ward", entries: ["DC 10 plus PB."]}})};
		const fixture = zombie(target(source("Bugbear"), [area]));
		const {owner} = saved(fixture.subject, fixture.resolved, fixture.answers);
		const out = effective({...fixture.subject, operations: [area, owner]});
		expect(owner.data.resolved.estimation.baseline).not.toEqual(BestiaryCreatureTransformation.getBaseline({
			original: fixture.subject.baseCreature, current: effective(fixture.subject),
		}));
		expect(JSON.stringify(out.trait)).toContain("Undead Fortitude");
		expect(out.trait.find(item => item.name === "Area ward").entries[0]).toContain(`{@dc ${10 + out.profBonus}}`);
		const clean = BestiaryQuickActionsUi._getCleanMonster({monster: out, name: "Flattened source Zombie", source: "TEST", uniqueId: "flattened"});
		expect(clean).toMatchObject({name: "Flattened source Zombie", source: "TEST", str: out.str, hp: out.hp, cr: out.cr, action: out.action, trait: out.trait});
		expect(JSON.stringify(clean)).not.toMatch(/estimation|sourceChangeCount|sourceReview|frozenForms|applyCreatureTransformation/);
	});

	it("enforces 180000 UTF8 bytes, Encounter 200000 characters/100 operations and atomic failures", async () => {
		const fixture = zombie();
		const {owner} = saved(fixture.subject, fixture.resolved, fixture.answers);
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const available = 180_000 - bytes(owner) + owner.id.length;
		const atLimit = {...owner, id: `${"x".repeat(available % 2)}${"\u00e9".repeat(Math.floor(available / 2))}`};
		expect(bytes(atLimit)).toBe(180_000);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: fixture.subject.baseCreature, operation: atLimit});
		const stored = await persistence(fixture.subject.baseCreature);
		await stored.adapter.addOperation({operation: atLimit});
		const before = stored.state();
		for (const id of [`${atLimit.id}x`, "x".repeat(200_001)]) {
			const tooLarge = {...atLimit, id};
			expect(() => registry.applyChanges({creature: fixture.subject.baseCreature, removeIds: [atLimit.id], addOperations: [tooLarge]})).toThrow(/size budget/);
			await expect(stored.adapter.applyChanges({removeIds: [atLimit.id], addOperations: [tooLarge]})).rejects.toThrow(/size budget|invalid statblock operation/);
			expect(stored.state()).toBe(before);
			expect(registry.getOperations({creature: fixture.subject.baseCreature})).toEqual([atLimit]);
		}
		expect(stored.storage.pSetForPage).toHaveBeenCalledTimes(1);
		const prefix = Array.from({length: 99}, (_, index) => patch(`count-${index}`, {int: 8}));
		const counted = zombie(target(fixture.subject.baseCreature, prefix));
		const countedOwner = saved(counted.subject, counted.resolved, counted.answers).owner;
		const full = await persistence(fixture.subject.baseCreature);
		await full.adapter.applyChanges({addOperations: [...prefix, countedOwner]});
		expect(full.adapter.getOperations()).toHaveLength(100);
		const fullBefore = full.state();
		await expect(full.adapter.addOperation({operation: patch("101st", {wis: 14})})).rejects.toThrow(/invalid statblock history/);
		expect(full.state()).toBe(fullBefore);
		expect(full.storage.pSetForPage).toHaveBeenCalledTimes(1);
		console.log("LIMIT REACH: estimated complete Zombie at exactly 180000 UTF8 bytes accepted; +1 byte and >200000 characters rejected atomically; Encounter 100 accepted/101 rejected, independent of Registry history.");
	});
});
