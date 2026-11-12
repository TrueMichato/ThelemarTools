import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import "../../js/parser.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {getCreatureTransformationCorpusErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationSchemaErrors} from "../util-creature-transformation-schema.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("data/creature-transformations.json");
const monsters = read("data/bestiary/bestiary-mm.json").monster;
const schema = read("schema/site/creature-transformation.json");
const validateLeaf = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledHalfDragon"});
const id = "catalog:half-dragon|mm";
const colors = ["black", "blue", "brass", "bronze", "copper", "gold", "green", "red", "silver", "white"];
const brackets = ["large-or-smaller", "huge", "gargantuan"];
const sizes = ["M", "H", "G"];
const recipe = () => structuredClone(catalog.creatureTransformation.find(it => it.name === "Half-Dragon" && it.source === "MM"));
const candidatesFor = data => getCreatureTransformationCandidates({catalog: data, races: []});
const resolve = (ancestry = "red", size = "large-or-smaller", data = catalog, automationVersion = 2) =>
	resolveCreatureTransformation({candidates: candidatesFor(data), id, selections: {ancestry: [ancestry], size: [size]}, automationVersion});
const chassis = size => ({...structuredClone(monsters.find(it => it.name === "Veteran" && it.source === "MM")), size: [size], cr: "0"});
const target = (key = "one", size = "M", operations = []) => ({id: key, label: key, baseCreature: chassis(size), operations});
const preview = (resolved, targets = [target()], extra = {}) => previewCreatureTransformationTargets({
	resolved, targets, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extra,
});
const edits = batch => createCreatureTransformationChanges({batch, targets: batch.targets}).map(change => ({
	...change, addOperations: change.addOperations.map(operation => ({...operation, id: `half-${change.id}`})),
}));
const walk = (value, predicate) => {
	if (!value || typeof value !== "object") return [];
	return [...predicate(value) ? [value] : [], ...Object.values(value).flatMap(part => walk(part, predicate))];
};
const source = walk(read("data/bestiary/fluff-bestiary-mm.json"), value => value.name === "Half-Dragon Template")[0];
const sourceResistance = walk(source, value => value.name === "Resistances")[0].entries.find(it => it.type === "table").rows;
const resistanceFor = color => sourceResistance.find(([label]) => new RegExp(`\\b${color}\\b`, "i").test(label))[1].toLowerCase();
const donorFor = (color, bracket) => {
	const capital = color[0].toUpperCase() + color.slice(1);
	const name = bracket === 0 ? `${capital} Dragon Wyrmling` : `${bracket === 1 ? "Young" : "Adult"} ${capital} Dragon`;
	const matches = monsters.filter(it => it.name === name && it.source === "MM");
	expect(matches).toHaveLength(1);
	expect(matches[0]).not.toHaveProperty("_copy");
	return matches[0];
};
const breathFor = donor => {
	const breaths = donor.action.filter(it => /breath/i.test(it.name));
	expect(breaths).toHaveLength(1);
	return breaths[0];
};

// Read mechanical signatures from the actual MM actions, independently of the app table/prose.
function modeSignature (name, text) {
	const area = /(\d+)-foot (line|cone)/.exec(text);
	const save = /\{@dc (\d+)\} (Dexterity|Constitution|Strength)/.exec(text);
	const damage = /(\d+) \(\{@damage ([^}]+)\}\) (\w+) damage/.exec(text);
	expect(area).not.toBeNull();
	expect(save).not.toBeNull();
	const signature = {
		name: name.replace(/ \{@recharge 5\}/, ""),
		area: [Number(area[1]), area[2], area[2] === "line" ? Number(/(\d+) feet wide/.exec(text)?.[1]) : null],
		targets: /[Ee]ach creature in (?:that (?:line|area)|the (?:line|cone))/.test(text),
		save: [Number(save[1]), save[2]],
		rollTags: [...text.matchAll(/\{@(dc|damage|condition) ([^}]+)\}/g)].map(it => [it[1], it[2]]),
		numbers: [...text.matchAll(/\b\d+\b/g)].map(it => Number(it[0])),
		damage: damage ? [Number(damage[1]), damage[2], damage[3], /half.*damage.*success|success.*half damage/i.test(text)] : null,
		failure: /failed save|[Ff]ailure|must succeed.* or /.test(text),
	};
	if (name === "Sleep Breath") {
		signature.special = [
			/\{@condition unconscious\}/.test(text), Number(/for (\d+) minute/.exec(text)?.[1]),
			/takes damage|Taking damage/.test(text), /someone (?:uses an action to wake it|spending an action to wake the sleeper)/.test(text),
			/ends (?:for a creature|the effect)/.test(text),
		];
	}
	if (name === "Repulsion Breath") {
		signature.special = [
			Number(/pushed (\d+) feet/.exec(text)?.[1]), /away from the (?:half-)?dragon/.test(text),
		];
	}
	if (["Slowing Breath", "Weakening Breath", "Paralyzing Breath"].includes(name)) {
		signature.special = [
			/for 1 minute|last for 1 minute/.test(text),
			/[Rr]epeat.*sav(?:e|ing throw) at the end of each of its turns/.test(text),
			/ending the effect on itself.*success|success ends the effect/.test(text),
			...name === "Slowing Breath" ? [
				/can't use reactions|no reactions/.test(text), /speed is halved|speed halved/.test(text),
				/can't make more than one attack on its turn|at most one attack on each of its turns/.test(text),
				/either an action or a bonus action on its turn/.test(text), /not both/.test(text),
			] : [],
			...name === "Weakening Breath" ? [
				/disadvantage on Strength-based attack rolls, Strength checks, and Strength saving throws/.test(text),
			] : [],
			...name === "Paralyzing Breath" ? [/\{@condition paralyzed\}/.test(text)] : [],
		];
	}
	return signature;
}

function signature (action) {
	const list = action.entries.find(it => it?.type === "list");
	const modes = list ? list.items.map(it => modeSignature(it.name, it.entry)) : [modeSignature(action.name, action.entries[0])];
	return {
		name: action.name,
		rechargeTags: [...JSON.stringify(action).matchAll(/\{@recharge ([^}]+)\}/g)].map(it => it[1]),
		oneMode: !list || /uses one of the following|Choose one mode/.test(action.entries[0]),
		modes,
	};
}

describe("M5 staged Half-Dragon MM source producer", () => {
	it("keeps the size-to-age and optional CR guidance grounded in MM p.180", () => {
		const rows = walk(source, value => value.type === "table" && value.colLabels?.includes("Optional Prerequisite"))[0].rows;
		expect(rows).toEqual([
			["Large or smaller", "As a wyrmling", "Challenge 2 or higher"],
			["Huge", "As a young dragon", "Challenge 7 or higher"],
			["Gargantuan", "As an adult dragon", "Challenge 8 or higher"],
		]);
		expect(source.entries[0]).toMatch(/beast, humanoid, giant, or monstrosity/);
		expect(walk(source, value => value.name === "Challenge")[0].entries[0]).toMatch(/optional prerequisite/);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});

	it.each(colors.flatMap(color => brackets.map((bracket, index) => [color, bracket, index])))(
		"compiles %s/%s through the real operation path with the complete independent MM donor signature",
		(color, bracket, index) => {
			const donor = donorFor(color, index);
			const expected = signature(breathFor(donor));
			expect(expected.rechargeTags).toEqual(["5"]);
			expect(expected.oneMode).toBe(true);
			for (const mode of expected.modes) {
				expect(mode.targets).toBe(true);
				expect(mode.failure).toBe(true);
				if (mode.damage) expect(mode.damage[3]).toBe(true);
				if (mode.special) expect(mode.special.every(value => value === true || (typeof value === "number" && value > 0))).toBe(true);
			}
			const pending = resolve(color, bracket);
			const batch = preview(pending, [target("one", sizes[index])]);
			expect(batch.skipped).toEqual([]);
			const {resolved, proposed} = batch.previews[0].preview;
			const addition = resolved.changes.filter(it => it.type === "addEntry");
			expect(addition).toHaveLength(1);
			expect(signature(addition[0].entry)).toEqual(expected);
			expect(addition[0].entry.source).toBe("MM");
			expect(resolved.selectedOptions["automation-breath"]).toEqual([`${donor.name.toLowerCase()}|mm`]);
			const row = pending.automation.halfDragonBreaths.find(it => it.ancestry === color && it.size === bracket);
			expect(row.donor).toEqual({name: donor.name, source: donor.source, page: donor.page});
			const raw = compileCreatureTransformation({resolved: pending, current: chassis(sizes[index])});
			validateLeaf(raw);
			expect(validateLeaf.errors).toBeNull();
			expect(normalizeCreatureTransformation(raw)).toEqual(resolved);
			expect(resolved.manualReview.map(it => it.field)).toEqual(["cr"]);
			expect(resolved.eligibility.some(it => it.minCr != null)).toBe(false);
			expect(proposed).toMatchObject({
				resist: expect.arrayContaining([resistanceFor(color)]),
				languages: expect.arrayContaining(["Draconic"]),
				senses: expect.arrayContaining(["blindsight 10 ft.", "darkvision 60 ft."]),
				cr: "0",
			});
			for (const [key, value] of Object.entries(chassis(sizes[index]))) {
				if (["action", "senses", "resist", "languages"].includes(key)) continue;
				expect(proposed[key]).toEqual(value);
			}
			expect(proposed.action.slice(0, -1)).toEqual(chassis(sizes[index]).action);
			const operation = JSON.parse(JSON.stringify(edits(batch)[0].addOperations[0]));
			expect(operation.data.resolved).not.toHaveProperty("automation");
			expect(JSON.stringify(operation)).not.toContain("halfDragonBreaths");
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: chassis(sizes[index]), operations: [operation]})).toEqual(proposed);
		},
	);

	it("rejects incomplete or misidentified tables/profiles rather than silently dropping a tuple or alternative", () => {
		const mutations = [
			value => { value.automation.halfDragonBreaths.pop(); },
			value => { value.automation.halfDragonBreaths[1] = structuredClone(value.automation.halfDragonBreaths[0]); },
			value => { delete value.automation.halfDragonBreaths[0].action; },
			value => { value.automation.halfDragonBreaths[0].ancestry = "amethyst"; },
			value => { value.automation.halfDragonBreaths[0].size = "tiny"; },
			value => { value.automation.halfDragonBreaths[0].donor.source = "XMM"; },
			value => { value.automation.halfDragonBreaths[0].action.source = "XMM"; },
			value => { value.automation.halfDragonBreaths[0].donor.name = "Young Black Dragon"; },
			value => { value.automation.halfDragonBreaths[0].donor.name = "Red Dragon Wyrmling"; },
			value => { value.automation.halfDragonBreaths[6].action.entries[1].items.pop(); },
			value => { value.automation.halfDragonBreaths[6].action.entries[1].items[1].name += " {@recharge 5}"; },
			value => { value.automation.halfDragonBreaths[0].condition = "size >= L"; },
			value => { value.automation.rollout = "enabled"; },
			value => { value.automation.profile = "arbitrary"; },
			value => { value.source = "XMM"; },
		];
		for (const mutate of mutations) {
			const changed = recipe();
			mutate(changed);
			const data = {creatureTransformation: [changed]};
			expect(() => candidatesFor(data)).toThrow();
			expect([...getCreatureTransformationSchemaErrors({data, filePath: "bad"}), ...getCreatureTransformationIdentityErrors({data, filePath: "bad"})]).not.toEqual([]);
		}
	});

	it("requires both joint selections and blocks unknown, duplicate and incomplete choices", () => {
		for (const selections of [{}, {ancestry: ["red"]}, {size: ["huge"]}, {ancestry: [], size: ["huge"]},
			{ancestry: ["red", "red"], size: ["huge"]}, {ancestry: ["red"], size: ["huge", "gargantuan"]},
			{ancestry: ["amethyst"], size: ["huge"]}, {ancestry: ["red"], size: ["tiny"]},
			{ancestry: ["red"], size: ["huge"], donor: ["Adult Red Dragon"]}]) {
			expect(() => resolveCreatureTransformation({candidates: candidatesFor(catalog), id, selections, automationVersion: 2})).toThrow();
		}
		const pending = resolve();
		delete pending.selectedOptions.size;
		expect(() => compileCreatureTransformation({resolved: pending, current: chassis("M")})).toThrow(/exactly one/);
		expect(() => compileCreatureTransformation({resolved: resolve(), current: chassis("M"), inputs: {donor: "other"}})).toThrow(/only/);
		expect(() => normalizeCreatureTransformation(resolve())).toThrow(/compiled/);
	});

	it("uses actual target history, isolates ineligible targets, and never invents a source CR floor", () => {
		const prior = [{id: "size-history", type: "patch", data: {patch: {set: {size: ["H"]}}}}];
		const targets = [
			target("historical", "M", prior), target("wrong-size", "M"), {...target("wrong-type", "H"), baseCreature: {...chassis("H"), type: "dragon"}},
			{...target("ambiguous"), baseCreature: {...chassis("H"), size: ["H", "G"]}}, target("valid", "H"),
		];
		const batch = preview(resolve("bronze", "huge"), targets);
		expect(batch.previews.map(it => it.id)).toEqual(["historical", "valid"]);
		expect(batch.skipped.map(it => it.id)).toEqual(["wrong-size", "wrong-type", "ambiguous"]);
		expect(edits(batch).map(it => it.id)).toEqual(["historical", "valid"]);
		expect(batch.previews.map(it => signature(it.preview.proposed.action.at(-1)))).toEqual([
			signature(breathFor(donorFor("bronze", 1))), signature(breathFor(donorFor("bronze", 1))),
		]);
		for (const size of ["T", "S", "M", "L"]) expect(preview(resolve(), [target("one", size)]).skipped).toEqual([]);
		for (const type of ["beast", "humanoid", "giant", "monstrosity"]) {
			expect(preview(resolve(), [{...target(), baseCreature: {...chassis("M"), type: {type, tags: ["retained"]}}}]).skipped).toEqual([]);
		}
		const stronger = {...chassis("M"), senses: ["blindsight 30 ft.", "darkvision 120 ft.", "truesight 10 ft."], resist: ["cold"], languages: ["Common"]};
		expect(preview(resolve(), [{...target(), baseCreature: stronger}]).previews[0].preview.proposed).toMatchObject({
			senses: stronger.senses, resist: ["cold", "fire"], languages: ["Common", "Draconic"],
		});
		const siblings = preview(resolve("silver", "huge"), [target("one", "H"), target("two", "H")]);
		siblings.previews[0].preview.resolved.changes.at(-1).entry.entries[1].items[1].entry = "Mutated one target.";
		expect(signature(siblings.previews[1].preview.resolved.changes.at(-1).entry)).toEqual(signature(breathFor(donorFor("silver", 1))));
	});

	it("freezes metallic modes through Registry and real Encounter adapter/Store replay and removal, without live sources", async () => {
		const data = structuredClone(catalog);
		const candidates = candidatesFor(data);
		const pending = resolveCreatureTransformation({candidates, id, selections: {ancestry: ["copper"], size: ["huge"]}, automationVersion: 2});
		const subject = target("one", "H");
		const batch = preview(pending, [subject]);
		const operation = JSON.parse(JSON.stringify(edits(batch)[0].addOperations[0]));
		const expected = batch.previews[0].preview.proposed;
		const registry = new BestiaryQuickActionsRegistry();
		const operationId = registry.addOperation({creature: subject.baseCreature, operation});
		expect(registry.getCreature({creature: subject.baseCreature})).toEqual(expected);
		let state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: {name: "M5", saveId: "half-dragon", items: [{h: "veteran_mm", c: 1}]},
			pResolveItem: async () => ({entity: subject.baseCreature}),
			fnUid: () => "one",
		});
		const values = new Map();
		const store = new EncounterWorkspaceStore({storage: {
			pGetForPage: async key => values.get(key),
			pSetForPage: async (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
		}});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => state, pCommit: async result => { state = await store.pSave(result.state); }});
		await adapter.addOperation({operation});
		const savedBytes = JSON.stringify(adapter.getOperations());
		pending.automation.halfDragonBreaths[13].action.entries = ["Changed after creation."];
		candidates[0].automation.halfDragonBreaths = [];
		candidates.length = 0;
		data.creatureTransformation.length = 0;
		state = await store.pLoad();
		expect(JSON.stringify(adapter.getOperations())).toBe(savedBytes);
		expect(adapter.getCreature()).toEqual(expected);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: JSON.parse(savedBytes)})).toEqual(expected);
		const corrupted = JSON.parse(savedBytes);
		corrupted[0].data.resolved.changes.at(-1).entry.entries[1].items[1].entry += " Corrupted.";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: subject.baseCreature, operations: corrupted})).toThrow(/changed/i);
		await expect(adapter.addOperation({operation: corrupted[0]})).rejects.toThrow();
		expect(JSON.stringify(adapter.getOperations())).toBe(savedBytes);
		await adapter.removeOperation({operationId: operation.id});
		state = await store.pLoad();
		expect(adapter.getCreature()).toEqual(subject.baseCreature);
		registry.removeOperation({creature: subject.baseCreature, operationId});
		expect(registry.getCreature({creature: subject.baseCreature})).toEqual(subject.baseCreature);
	});

	it("preserves stale-source/history, consent, storage and strict frozen-payload guards", () => {
		const pending = resolve();
		const batch = preview(pending);
		const changed = structuredClone(pending);
		changed.automation.halfDragonBreaths.find(it => it.ancestry === "red" && it.size === "large-or-smaller").action.entries[0] += " Updated.";
		expect(() => createCreatureTransformationChanges({batch, targets: batch.targets, resolved: changed})).toThrow(/stale/);
		expect(() => createCreatureTransformationChanges({batch, targets: [target("one", "H")]})).toThrow(/stale/);
		expect(() => preview(pending, [target()], {acknowledgedPrerequisites: []})).toThrow(/prerequisite/);
		const capped = preview(pending, [target()], {validateOperation: () => { throw new Error("storage limit"); }});
		expect(capped.previews).toEqual([]);
		expect(capped.skipped[0].reason).toMatch(/storage limit/);
		const compiled = compileCreatureTransformation({resolved: pending, current: chassis("M")});
		for (const mutate of [
			value => { value.selectedOptions.ancestry = ["blue"]; },
			value => { value.selectedOptions["automation-breath"] = ["young red dragon|mm"]; },
			value => { value.identity.source = "XMM"; },
			value => { value.changes.pop(); },
			value => { value.changes.push({op: "grantResistance", value: "cold"}); },
			value => { value.eligibility[0].minCr = 2; },
		]) {
			const invalid = structuredClone(compiled);
			mutate(invalid);
			expect(() => normalizeCreatureTransformation(invalid)).toThrow(/compiled/);
		}
		const wrongSource = edits(batch)[0].addOperations[0];
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...chassis("M"), source: "XMM"}, operations: [wrongSource]})).toThrow(/another creature/);
		const wrongBracket = {...chassis("M"), size: ["H"]};
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: wrongBracket, operations: [wrongSource]})).toThrow(expect.objectContaining({code: "CREATURE_TRANSFORMATION_INELIGIBLE"}));
	});

	it("leaves all legacy/default choices and saved breathless Half-Dragon bytes unchanged", () => {
		const oldCatalog = structuredClone(catalog);
		oldCatalog.creatureTransformation.forEach(it => delete it.automation);
		for (const color of colors) {
			for (const [index, bracket] of brackets.entries()) {
				const old = resolve(color, bracket, oldCatalog, 1);
				const current = resolve(color, bracket, catalog, 1);
				expect(JSON.stringify(current)).toBe(JSON.stringify(old));
				const batch = preview(current, [target("one", sizes[index])]);
				const operation = edits(batch)[0].addOperations[0];
				const bytes = JSON.stringify(operation);
				expect(operation.data.resolved).not.toHaveProperty("version");
				expect(operation.data.resolved.changes.some(it => it.type === "addEntry")).toBe(false);
				expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: chassis(sizes[index]), operations: [JSON.parse(bytes)]}).action).toEqual(chassis(sizes[index]).action);
				expect(JSON.stringify(operation)).toBe(bytes);
			}
		}
	});
});
