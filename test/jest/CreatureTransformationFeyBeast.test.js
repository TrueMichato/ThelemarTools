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
const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/compiledFeyBeast"});
const features = ["barkskin", "fey-touched", "entangle", "spike-growth", "natural-camouflage", "plant-stride", "rooted", "tree-stride", "nature-sense", "teleport"];
const source = name => structuredClone(mm.find(monster => monster.name === name && monster.source === "MM"));
const beast = () => ({...source("Wolf"), int: 3});
const target = (baseCreature = beast(), operations = [], id = "one") => ({id, label: id, baseCreature, operations});
const rule = (creature, name, section = "trait") => creature[section]?.find(entry => entry.name === name && entry.source === "SCRE");
const spell = (creature, name) => rule(creature, `Innate Spellcasting: ${name}`, "spellcasting");
const text = entry => entry.entries.join(" ");
const pending = (selected = features, data = catalog, version = 2) => resolveCreatureTransformation({
	candidates: getCreatureTransformationCandidates({catalog: data, races: []}),
	id: "catalog:fey beast|scre",
	selections: {features: selected},
	automationVersion: version,
});
const inputsFor = (selected = features, base = beast()) => selected.some(id => ["entangle", "spike-growth"].includes(id))
	? {feyBeast: {proficiencyBonus: base.profBonus ?? 2}} : {};
const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
function preview (subject = target(), selected = features, inputs = inputsFor(selected, subject.baseCreature), extra = {}) {
	const resolved = pending(selected);
	return previewCreatureTransformationTargets({targets: [subject], resolved, automationInputs: {[subject.id]: inputs}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extra});
}
function outcome (batch) {
	expect(batch.skipped).toEqual([]);
	expect(batch.previews).toHaveLength(1);
	return batch.previews[0].preview.proposed;
}
function owner (batch, conflictDecisions) {
	return {...createCreatureTransformationChanges({batch, targets: batch.targets, ...conflictDecisions ? {conflictDecisions} : {}})[0].addOperations[0], id: "fey-owner"};
}
function compile (base, selected = features, inputs = inputsFor(selected, base)) {
	return compileCreatureTransformation({resolved: pending(selected), current: base, inputs, chassisSource: base.source});
}
function assertEffect (id, out) {
	switch (id) {
		case "barkskin": expect(out.ac).toEqual([{ac: 16, from: ["natural armor (Barkskin)"]}]); break;
		case "fey-touched":
			expect(text(rule(out, "Fey-Touched"))).toMatch(/advantage on saving throws against being charmed or frightened/);
			expect(out.conditionImmune).toBeUndefined();
			break;
		case "entangle":
		case "spike-growth": {
			const name = id === "entangle" ? "Entangle" : "Spike Growth";
			const entry = spell(out, name);
			expect(entry.ability).toBe("wis");
			expect(entry.daily).toEqual({"1e": [`{@spell ${name.toLowerCase()}|PHB}`]});
			expect(entry.headerEntries).toEqual(["Its innate spellcasting ability is Wisdom (spell save {@dc 11}, {@hit 3} to hit with spell attacks). It requires somatic components but no verbal or material components."]);
			expect(entry.spells).toBeUndefined();
			break;
		}
		case "natural-camouflage": expect(text(rule(out, "Natural Camouflage"))).toMatch(/forest or grassland terrain.*advantage on Dexterity \(Stealth\) checks/); break;
		case "plant-stride":
			expect(text(rule(out, "Plant Stride"))).toMatch(/Nonmagical plants neither slow.*nor damage.*thorns, spines, or similar hazards/);
			expect(text(rule(out, "Plant Stride"))).toMatch(/Plants created or manipulated by magic also do not impede its movement/);
			break;
		case "rooted":
			expect(text(rule(out, "Rooted"))).toMatch(/advantage on saving throws.*push it, pull it, or knock it prone/);
			expect(text(rule(out, "Rooted"))).not.toMatch(/checks/);
			break;
		case "tree-stride":
			expect(text(rule(out, "Tree Stride"))).toMatch(/Once on its own turn.*spend 10 feet of movement.*living tree within 5 feet.*unoccupied space within 5 feet.*living tree within 60 feet of the first tree/);
			expect(text(rule(out, "Tree Stride"))).toMatch(/Both trees must be at least one size larger/);
			expect(text(rule(out, "Tree Stride"))).toMatch(/does not require an action or bonus action/);
			expect(rule(out, "Tree Stride", "action")).toBeUndefined();
			expect(rule(out, "Tree Stride", "bonus")).toBeUndefined();
			break;
		case "nature-sense":
			expect(text(rule(out, "Nature Sense", "action"))).toMatch(/As an action.*chooses a kind of beast or plant.*direction and distance.*nearest one within 5 miles, if any/);
			expect(rule(out, "Nature Sense")).toBeUndefined();
			break;
		case "teleport":
			expect(text(rule(out, "Teleport {@recharge 4}", "action"))).toMatch(/As an action.*up to 30 feet.*unoccupied space it can see.*worn and carried equipment/);
			expect(text(rule(out, "Teleport {@recharge 4}", "action"))).toMatch(/exactly one attack either before or after teleporting, not both.*does not grant Multiattack/);
			expect(rule(out, "Teleport {@recharge 4}", "bonus")).toBeUndefined();
			break;
		default: throw new Error(`Missing mechanical check for ${id}`);
	}
}
const absent = (id, out, base) => {
	if (id === "barkskin") { expect(out.ac).toEqual(base.ac); return; }
	const name = {"fey-touched": "Fey-Touched", "natural-camouflage": "Natural Camouflage", "plant-stride": "Plant Stride", rooted: "Rooted", "tree-stride": "Tree Stride", "nature-sense": "Nature Sense", teleport: "Teleport {@recharge 4}"}[id];
	if (["entangle", "spike-growth"].includes(id)) expect(spell(out, id === "entangle" ? "Entangle" : "Spike Growth")).toBeUndefined();
	else expect(rule(out, name, ["nature-sense", "teleport"].includes(id) ? "action" : "trait")).toBeUndefined();
};
async function encounter (base) {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "M10", saveId: "m10", items: [{h: "wolf_mm", c: 2}]},
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

describe("M10 Fey Beast source-only producer and effects", () => {
	it.each(features)("produces the actual %s effect, excludes it when unselected, and refuses an inapplicable chassis", id => {
		const base = beast();
		const selected = [id];
		const batch = preview(target(base), selected);
		const out = outcome(batch);
		const raw = compile(base, selected);
		expect(validate(JSON.parse(JSON.stringify(raw)))).toBe(true);
		expect(validate.errors).toBeNull();
		assertEffect(id, out);
		const operation = owner(batch);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [JSON.parse(JSON.stringify(operation))]});
		expect(registry.getCreature({creature: base})).toEqual(out);
		absent(id, outcome(preview(target(base), [id === "teleport" ? "rooted" : "teleport"])), base);
		const wrongType = preview(target({...base, type: "monstrosity"}), selected);
		expect(wrongType.previews).toEqual([]);
		expect(wrongType.skipped[0].reason).toMatch(/beast/);
		expect(out.type).toBe("fey");
		expect(base).toEqual(beast());
	});

	it("composes all ten choices above CR without rewriting the retained chassis, Multiattack or unrelated source-qualified rules", () => {
		const base = {...beast(),
			cr: "0",
			ac: [{ac: 23, from: ["natural armor"]}],
			type: {type: "beast", tags: ["enchanted", {tag: "swarm", prefix: "many"}], swarmSize: "T"},
			languages: ["Common", "telepathy 60 ft."],
			action: [...beast().action, {name: "Multiattack", source: "HB", entries: ["It makes two bite attacks."]}, {name: "Nature Sense", source: "HB", entries: ["A retained unrelated rule."]}],
			trait: [...beast().trait, {name: "Rooted", source: "HB", entries: ["A separate homebrew rule."]}],
			bonus: [{name: "Dash", source: "HB", entries: ["A retained bonus action."]}],
			spellcasting: [{name: "Innate Spellcasting: Entangle", source: "HB", ability: "cha", headerEntries: ["Retained DC 20; all components required."], daily: {"3": ["{@spell entangle|XPHB}"]}}],
			save: {wis: "+6"},
			skill: {stealth: "+9"},
			passive: 19,
			gear: ["collar|HB"],
			immune: ["fire"]};
		const out = outcome(preview(target(base)));
		for (const id of features) assertEffect(id, out);
		expect(out.type).toEqual({...base.type, type: "fey"});
		for (const field of ["str", "dex", "con", "int", "wis", "cha", "hp", "size", "speed", "cr", "save", "skill", "passive", "gear", "immune", "bonus"]) expect(out[field]).toEqual(base[field]);
		expect(out.action.filter(entry => entry.name === "Multiattack")).toEqual([base.action.at(-2)]);
		expect(out.action).toEqual(expect.arrayContaining(base.action));
		expect(out.trait).toEqual(expect.arrayContaining(base.trait));
		expect(out.spellcasting[0]).toEqual(base.spellcasting[0]);
		expect(out.languages).toEqual(["Common", "telepathy 60 ft.", "understands Sylvan but can't speak it"]);
		expect(out.languageTags).toEqual(base.languageTags);
	});

	it.each([
		[2, [], []],
		[2, ["Sylvan", "Common"], ["Sylvan", "Common"]],
		[3, [], ["understands Sylvan but can't speak it"]],
		[3, ["Common"], ["Common", "understands Sylvan but can't speak it"]],
		[3, ["Sylvan", "Common"], ["Sylvan", "Common"]],
		[3, ["Common and Sylvan"], ["Common and Sylvan"]],
		[3, ["understands Sylvan but can't speak", "telepathy 30 ft."], ["understands Sylvan but can't speak", "telepathy 30 ft."]],
		[3, ["understands Common but can't speak"], ["understands Common but can't speak", "understands Sylvan but can't speak it"]],
	])("applies the INT %s speech/understanding boundary for %j without stripping other languages", (int, languages, expected) => {
		const base = {...beast(), int, languages};
		const out = outcome(preview(target(base), ["rooted"]));
		expect(out.languages).toEqual(expected);
		expect(out.int).toBe(int);
	});

	it.each([
		["Giant Owl", () => source("Giant Owl"), false, []],
		["Giant Elk", () => source("Giant Elk"), false, []],
		["Giant Eagle", () => source("Giant Eagle"), true, []],
		["explicit Sylvan exception", () => ({...beast(), languages: ["understands all languages except Sylvan but can't speak"]}), true, []],
		["explicit Sylvan negation", () => ({...beast(), languages: ["understands Common but not Sylvan"]}), true, ["confirmation"]],
	])("preserves the actual %s language capabilities through guided inputs and Registry JSON restoration/removal", (_name, makeBase, grantsUnderstanding, controls) => {
		const base = makeBase();
		const subject = target(base);
		const resolved = pending(["rooted"]);
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		const compiled = compileCreatureTransformationInputs({target: subject,
			resolved,
			answers: {
				targetKey: model.targetKey,
				controls: Object.fromEntries(model.controls.map(item => [item.id, {value: false}])),
			}});
		expect(compiled.status).toBe("ready");
		const batch = preview(subject, ["rooted"], compiled.automationInputs);
		const expectedLanguages = grantsUnderstanding ? [...base.languages, "understands Sylvan but can't speak it"] : base.languages;
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [owner(batch)]});
		const reloaded = new BestiaryQuickActionsRegistry();
		reloaded.applyChanges({creature: base, addOperations: JSON.parse(JSON.stringify(registry.getOperations({creature: base})))});
		expect(reloaded.getCreature({creature: base})).toEqual(outcome(batch));
		expect(reloaded.getCreature({creature: base}).languages).toEqual(expectedLanguages);
		expect(compiled.projection.languages).toEqual(expectedLanguages);
		expect(model.controls.map(item => item.kind)).toEqual(controls);
		expect(model.facts.understandsSylvan).toBe(!grantsUnderstanding);
		if (grantsUnderstanding) {
			const missingGrant = structuredClone(batch.previews[0].preview);
			missingGrant.resolved.changes = missingGrant.resolved.changes.filter(step => step.type !== "grantFeyBeastUnderstanding");
			const incomplete = {id: "missing-understanding", ...BestiaryCreatureTransformation.createOperation({preview: missingGrant, currentPreview: missingGrant})};
			const rejected = new BestiaryQuickActionsRegistry();
			expect(() => rejected.applyChanges({creature: base, addOperations: [incomplete]})).toThrow(/complete selected source profile/);
			expect(rejected.getOperations({creature: base})).toEqual([]);
		}
		reloaded.removeOperation({creature: base, operationId: "fey-owner"});
		expect(reloaded.getCreature({creature: base})).toEqual(base);
		expect(registry.getCreature({creature: base}).languages).toEqual(expectedLanguages);
	});

	it("uses actual independent target PB and Wisdom, separate once-daily grants and exact component requirements", () => {
		const selected = ["entangle", "spike-growth"];
		const targets = [
			target({...beast(), profBonus: 4, wis: 18}, [], "one"),
			target({...beast(), profBonus: 6, pbNote: "+6", wis: 20}, [], "two"),
			target({...beast(), profBonus: 4, wis: 8}, [], "three"),
		];
		const resolved = pending(selected);
		const batch = previewCreatureTransformationTargets({targets, resolved, automationInputs: {}, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
		expect(batch.skipped).toEqual([]);
		expect(batch.previews).toHaveLength(3);
		for (const [index, [dc, attack]] of [[16, 8], [19, 11], [11, 3]].entries()) {
			const out = batch.previews[index].preview.proposed;
			for (const name of ["Entangle", "Spike Growth"]) {
				const entry = spell(out, name);
				expect(entry.headerEntries[0]).toContain(`{@dc ${dc}}, {@hit ${attack}}`);
				expect(entry.headerEntries[0]).toContain("requires somatic components but no verbal or material components");
				expect(entry.daily).toEqual({"1e": [`{@spell ${name.toLowerCase()}|PHB}`]});
			}
			expect(out.wis).toBe(targets[index].baseCreature.wis);
			expect(out.profBonus).toBe(targets[index].baseCreature.profBonus);
		}
		const phb = read("data/spells/spells-phb.json").spell;
		for (const name of ["Entangle", "Spike Growth"]) expect(phb.find(entry => entry.name === name && entry.source === "PHB").components.s).toBe(true);
		expect(preview(target({...beast(), profBonus: 4}), selected, {feyBeast: {proficiencyBonus: 2}}).skipped[0].reason).toMatch(/disagrees/);
		expect(spell(outcome(preview(target(), selected, {})), "Entangle").headerEntries[0]).toContain("{@dc 11}, {@hit 3}");
		expect(preview(target({...beast(), cr: "Unknown"}), selected, {}).skipped[0].reason).toMatch(/canonical current CR or explicit source PB/);
		expect(preview(target({...beast(), wis: undefined}), selected).skipped[0].reason).toMatch(/wis score/);
	});

	it("requires only genuine ambiguous-language/PB decisions with target/source/history-qualified controls", () => {
		const base = {...beast(), cr: "Unknown", languages: ["any two languages"]};
		const subject = target(base);
		const resolved = pending(["entangle"]);
		const model = inspectCreatureTransformationInputs({target: subject, resolved});
		expect(model.controls.map(item => item.kind)).toEqual(["confirmation", "proficiencyBonus"]);
		const answers = speaksSylvan => ({targetKey: model.targetKey,
			controls: Object.fromEntries(model.controls.map(item => [item.id, item.kind === "confirmation" ? {value: speaksSylvan} : {value: 2, reason: "Current target PB 2, reviewed against its source."}]))});
		for (const speaks of [true, false]) {
			const compiled = compileCreatureTransformationInputs({target: subject, resolved, answers: answers(speaks)});
			expect(compiled.status).toBe("ready");
			expect(compiled.projection.languages).toEqual(speaks ? base.languages : [...base.languages, "understands Sylvan but can't speak it"]);
		}
		const noAnswer = compileCreatureTransformationInputs({target: subject, resolved, answers: {targetKey: model.targetKey, controls: {}}});
		expect(noAnswer.status).toBe("needs-answers");
		expect(noAnswer.projection).toBeUndefined();
		for (const changed of [target(base, [patch("history", {name: "Renamed"})]), target({...base, source: "HB"}), target(base, [], "two")]) {
			expect(compileCreatureTransformationInputs({target: changed, resolved, answers: answers(false)}).status).toBe("needs-answers");
		}
		const ordinary = target({...beast(), profBonus: 3});
		const automatic = inspectCreatureTransformationInputs({target: ordinary, resolved});
		expect(automatic.controls).toEqual([]);
		expect(compileCreatureTransformationInputs({target: ordinary, resolved, answers: {targetKey: automatic.targetKey, controls: {}}}).status).toBe("ready");
		expect(preview(subject, ["rooted"], {}).skipped[0].reason).toMatch(/ambiguous/);
		expect(preview(target(), ["rooted"], {feyBeast: {speaksSylvan: true}}).skipped[0].reason).toMatch(/only permitted for an ambiguous/);
	});

	it("replaces only unique same-source entries, blocks ambiguous collisions and rejects malformed target/input shapes", () => {
		const old = {name: "Rooted", source: "SCRE", entries: ["Legacy incomplete rule: checks and saves."]};
		const base = {...beast(), trait: [...beast().trait, old, {...old, source: "HB"}]};
		const out = outcome(preview(target(base), ["rooted"]));
		assertEffect("rooted", out);
		expect(out.trait.filter(entry => entry.name === "Rooted" && entry.source === "HB")).toEqual([{...old, source: "HB"}]);
		expect(preview(target({...base, trait: [...base.trait, old]}), ["rooted"]).skipped[0].reason).toMatch(/duplicate/);
		const innate = spell(outcome(preview(target(), ["entangle"])), "Entangle");
		expect(preview(target({...beast(), spellcasting: [innate]}), ["entangle"]).skipped[0].reason).toMatch(/same source-qualified spell/);
		for (const bad of [{...beast(), languages: "Common"}, {...beast(), int: 0}, {...beast(), type: {type: "beast", arbitrary: true}}, {...beast(), trait: {}}]) {
			expect(preview(target(bad), ["rooted"]).previews).toEqual([]);
		}
		for (const inputs of [{hp: {}}, {feyBeast: {proficiencyBonus: 2}}, {feyBeast: {path: "ac"}}]) expect(preview(target(), ["rooted"], inputs).previews).toEqual([]);
		for (const selected of [[], ["rooted", "rooted"], ["not-a-feature"]]) expect(() => pending(selected)).toThrow();
	});

	it("keeps coherent conflict winners, source/consent guards and input/history stale checks", () => {
		const base = beast();
		const prior = {id: "catalog:prior|hb",
			kind: "catalog",
			identity: {name: "Prior", source: "HB"},
			provenance: {edition: "classic"},
			eligibility: [],
			prerequisites: [],
			selectedOptions: {},
			changes: [{type: "setType", value: "beast"}, {type: "grantLanguage", value: "Common"},
				...["Rooted", "Fey-Touched"].map(name => ({type: "addEntry", section: "trait", entry: {name, source: "SCRE", entries: ["Prior complete ownership."]}}))],
			manualReview: []};
		const first = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: prior});
		const prefix = {id: "prior", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: first})};
		const subject = target(base, [prefix]);
		const selected = ["rooted", "fey-touched", "barkskin"];
		const batch = preview(subject, selected);
		const conflicts = batch.previews[0].preview.conflicts;
		expect(conflicts.map(item => item.path)).toEqual(expect.arrayContaining(["trait:fey-touched|scre", "trait:rooted|scre"]));
		const wins = Object.fromEntries(conflicts.map(item => [item.path, "incoming"]));
		const keep = Object.fromEntries(conflicts.map(item => [item.path, "existing"]));
		expect(outcome(preview(subject, selected, {}, {conflictDecisions: {one: keep}}))).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix]}));
		const mixed = {...wins, "trait:rooted|scre": "existing"};
		expect(preview(subject, selected, {}, {conflictDecisions: {one: mixed}}).skipped[0].reason).toMatch(/must share one conflict winner/);
		const accepted = preview(subject, selected, {}, {conflictDecisions: {one: wins}});
		const operation = owner(accepted, {one: wins});
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, operation]})).toEqual(outcome(accepted));
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: [target(base, [])], conflictDecisions: {one: wins}})).toThrow(/stale/);
		expect(() => createCreatureTransformationChanges({batch: accepted, targets: accepted.targets, automationInputs: {one: {feyBeast: {speaksSylvan: true}}}, conflictDecisions: {one: wins}})).toThrow(/input answers changed/);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: {...base, source: "XMM"}, operations: [prefix, operation]})).toThrow();
		expect(preview(target(), ["rooted"], {}, {dmApproved: false}).previews).toEqual([]);
		expect(() => preview(target(), ["rooted"], {}, {acknowledgedPrerequisites: []})).toThrow(/prerequisites must be explicitly acknowledged/);
		const corrupt = structuredClone(operation);
		corrupt.data.resolved.changes[0].value.type = "undead";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix, corrupt]})).toThrow(/changed|tampered/i);
	});

	it("saves/reloads/removes real Registry and Encounter JSON owners with catalog and spell sources absent or changed", async () => {
		const base = {...beast(), languages: ["Common"], profBonus: 4};
		const prefix = patch("prefix", {name: "Renamed wolf", wis: 18});
		const subject = target(base, [prefix]);
		const batch = preview(subject, features, {});
		const expected = outcome(batch);
		const operation = owner(batch);
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [operation]})).toThrow(/actual pre-owner target/);
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({creature: base, addOperations: [prefix, operation]});
		const serialized = JSON.stringify(registry.getOperations({creature: base}));
		const originalCatalog = catalog.creatureTransformation;
		const originalLoader = DataUtil.loadJSON;
		const loader = jest.fn(() => { throw new Error("Source data unavailable during replay"); });
		DataUtil.loadJSON = loader;
		try {
			for (const data of [[], [{name: "Fey Beast", source: "SCRE", changes: [{op: "setType", value: "undead"}]}]]) {
				catalog.creatureTransformation = data;
				const reloaded = new BestiaryQuickActionsRegistry();
				reloaded.applyChanges({creature: base, addOperations: JSON.parse(serialized)});
				expect(reloaded.getCreature({creature: base})).toEqual(expected);
				expect(reloaded.getCreature({creature: {...base, name: "Other Wolf"}})).toEqual({...base, name: "Other Wolf"});
				reloaded.removeOperation({creature: base, operationId: "fey-owner"});
				expect(reloaded.getCreature({creature: base})).toEqual({...base, name: "Renamed wolf", wis: 18});
				const saved = persistence(await encounter(base));
				await saved.adapter.applyChanges({addOperations: JSON.parse(serialized)});
				await saved.reload();
				expect(saved.adapter.getOperations()).toEqual(JSON.parse(serialized));
				expect(saved.adapter.getCreature()).toEqual(expected);
				expect(saved.state().instances[1].monster).toEqual(base);
				await saved.adapter.removeOperation({operationId: "fey-owner"});
				await saved.reload();
				expect(saved.adapter.getCreature()).toEqual({...base, name: "Renamed wolf", wis: 18});
				expect(saved.adapter.getOperations()).toEqual([prefix]);
			}
			expect(loader).not.toHaveBeenCalled();
		} finally { catalog.creatureTransformation = originalCatalog; DataUtil.loadJSON = originalLoader; }
	});

	it("atomically rejects incomplete source effects, failed saves, operation count and byte ceilings", async () => {
		const base = beast();
		const batch = preview(target(base));
		const operation = owner(batch);
		const incompletePreview = structuredClone(batch.previews[0].preview);
		incompletePreview.resolved.changes = incompletePreview.resolved.changes.filter(step => step.type !== "setArmorClass");
		const incomplete = {id: "incomplete", ...BestiaryCreatureTransformation.createOperation({preview: incompletePreview, currentPreview: incompletePreview})};
		const registry = new BestiaryQuickActionsRegistry();
		const notify = jest.fn();
		registry.subscribe(notify);
		expect(() => registry.applyChanges({creature: base, addOperations: [incomplete]})).toThrow(/complete selected source profile/);
		expect(registry.getOperations({creature: base})).toEqual([]);
		expect(notify).not.toHaveBeenCalled();
		for (const mutate of [
			resolved => { resolved.changes.find(step => step.type === "addInnateSpellcasting").saveDc++; },
			resolved => { resolved.changes = resolved.changes.filter(step => step.entry?.name !== "Tree Stride"); },
			resolved => { resolved.changes.find(step => step.entry?.name === "Rooted").entry.entries = ["Advantage on checks and saves against forced movement."]; },
		]) {
			const badPreview = structuredClone(batch.previews[0].preview);
			mutate(badPreview.resolved);
			const signed = {id: "incomplete", ...BestiaryCreatureTransformation.createOperation({preview: badPreview, currentPreview: badPreview})};
			expect(() => registry.applyChanges({creature: base, addOperations: [signed]})).toThrow(/complete selected source profile/);
			expect(registry.getOperations({creature: base})).toEqual([]);
		}
		const saved = persistence(await encounter(base));
		const before = saved.state();
		await expect(saved.adapter.applyChanges({addOperations: [incomplete]})).rejects.toThrow(/complete selected source profile/);
		expect(saved.state()).toBe(before);
		expect(saved.storage.pSetForPage).not.toHaveBeenCalled();
		const listener = jest.fn();
		saved.adapter.subscribe(listener);
		saved.storage.pSetForPage.mockRejectedValueOnce(new Error("M10 disk full"));
		await expect(saved.adapter.applyChanges({addOperations: [operation]})).rejects.toThrow("M10 disk full");
		expect(saved.state()).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		await saved.adapter.applyChanges({addOperations: [operation]});
		await saved.reload();
		expect(saved.adapter.getCreature()).toEqual(outcome(batch));
		const countPrefix = Array.from({length: 99}, (_, ix) => patch(`prefix-${ix}`, {name: "Renamed wolf"}));
		const last = owner(preview(target(base, countPrefix)));
		const capped = persistence(await encounter(base));
		await capped.adapter.applyChanges({addOperations: [...countPrefix, last]});
		const cappedBefore = capped.state();
		await expect(capped.adapter.applyChanges({addOperations: [patch("101", {wis: 20})]})).rejects.toThrow();
		expect(capped.state()).toBe(cappedBefore);
		const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
		const oversized = {...operation, id: "x".repeat(BestiaryCreatureTransformation.MAX_OPERATION_BYTES - bytes(operation) + operation.id.length + 1)};
		expect(bytes(oversized)).toBe(BestiaryCreatureTransformation.MAX_OPERATION_BYTES + 1);
		const beforeOversize = saved.state();
		const writes = saved.storage.pSetForPage.mock.calls.length;
		await expect(saved.adapter.applyChanges({removeIds: ["fey-owner"], addOperations: [oversized]})).rejects.toThrow(/size budget/);
		expect(saved.state()).toBe(beforeOversize);
		expect(saved.storage.pSetForPage).toHaveBeenCalledTimes(writes);
		expect(() => registry.applyChanges({creature: base, addOperations: [oversized]})).toThrow(/size budget/);
	});

	it("keeps all other records and legacy/Species behavior identical against accepted-base data through current code", () => {
		const accepted = JSON.parse(childProcess.execFileSync("git", ["show", "76a6019851a19f591746670704f58622929cb482:data/creature-transformations.json"], {encoding: "utf8"}));
		for (const recipe of catalog.creatureTransformation) {
			const current = structuredClone(recipe);
			if (["Fey Beast|SCRE", "Fallen Angel|SCRE"].includes(`${recipe.name}|${recipe.source}`)) delete current.automation;
			expect(current).toEqual(accepted.creatureTransformation.find(prior => prior.name === recipe.name && prior.source === recipe.source));
		}
		for (const selected of features.map(id => [id]).concat([features])) {
			const current = normalizeCreatureTransformation(pending(selected, catalog, 1));
			const oldData = normalizeCreatureTransformation(pending(selected, accepted, 1));
			expect(current).toEqual(oldData);
			const base = beast();
			const legacyPreview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: current, acknowledgedPrerequisites: current.prerequisites, dmApproved: true});
			const legacy = {id: "legacy", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, preview: legacyPreview})};
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: JSON.parse(JSON.stringify([legacy]))})).toEqual(legacyPreview.proposed);
			expect(legacyPreview.proposed).toEqual(BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, resolved: oldData, acknowledgedPrerequisites: oldData.prerequisites, dmApproved: true}).proposed);
		}
		const races = [{name: "Species control", source: "TST", size: ["M"], speed: 30, ability: [{dex: 2}], entries: []}];
		const race = data => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races}), id: "race:species control|tst"});
		expect(race(catalog)).toEqual(race(accepted));
		const legacy = normalizeCreatureTransformation(pending(["rooted"], accepted, 1));
		legacy.changes = [{type: "grantFeyBeastUnderstanding"}];
		expect(() => BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: beast(), resolved: legacy})).toThrow(/version-2/);
	});

	it("enforces exact M10 catalog/profile and compiled schema boundaries without weakening other schemas", () => {
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
		for (const mutate of [
			record => { record.source = "OTHER"; },
			record => { record.automation.profile = "arbitrary"; },
			record => { record.automation.rollout = "enabled"; },
			record => { record.automation.version = 3; },
			record => { record.automation.path = "action"; },
			record => { record.optionGroups[0].options.pop(); },
			record => { record.optionGroups[0].selection = "one"; },
		]) {
			const bad = structuredClone(catalog);
			mutate(bad.creatureTransformation.find(record => record.name === "Fey Beast"));
			expect(getCreatureTransformationSchemaErrors({data: bad, filePath: "m10"})).not.toEqual([]);
			expect(() => getCreatureTransformationCandidates({catalog: bad, races: []})).toThrow();
		}
		const bad = structuredClone(catalog);
		bad.creatureTransformation.find(record => record.name === "Fey Beast").source = "OTHER";
		expect(getCreatureTransformationIdentityErrors({data: bad, filePath: "m10"})).not.toEqual([]);
		for (const mutate of [
			resolved => { resolved.changes[0].path = "hp"; },
			resolved => { resolved.changes[0].value.type = "undead"; },
			resolved => { resolved.selectedOptions.features = ["rooted", "rooted"]; },
			resolved => { resolved.selectedOptions["automation-fey-beast-inputs"] = ["x".repeat(257)]; },
			resolved => { resolved.changes.find(step => step.op === "addInnateSpellcasting").components = []; },
			resolved => { resolved.changes.find(step => step.op === "addInnateSpellcasting").spells[0].usage = "will"; },
		]) {
			const raw = compile(beast());
			mutate(raw);
			expect(validate(raw)).toBe(false);
		}
	});
});
