import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import {compileCreatureTransformationStats, isCreatureTransformationStatChange} from "../../js/creature-transformation-stats.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsRegistry} from "../../js/bestiary/bestiary-quick-actions-engine.js";

const monsters = JSON.parse(fs.readFileSync("data/bestiary/bestiary-mm.json", "utf8")).monster;
const scout = monsters.find(it => it.name === "Scout" && it.source === "MM");
const knight = monsters.find(it => it.name === "Knight" && it.source === "MM");
const commoner = monsters.find(it => it.name === "Commoner" && it.source === "MM");
const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const candidates = getCreatureTransformationCandidates({catalog, races: []});
const staged = () => resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
const hpOf = options => compileCreatureTransformationStats(options).find(it => it.op === "setHitPoints")?.value;
const pbOptions = (current, value = 3, original = current) => {
	const numeric = compileCreatureTransformationStats({
		current, proficiencyBonus: current.profBonus ?? 2, nextProficiencyBonus: value,
	});
	const concrete = compileCreatureTransformation({resolved: staged(), current});
	concrete.changes.push(...numeric);
	return {original, current, resolved: normalizeCreatureTransformation(concrete), acknowledgedPrerequisites: concrete.prerequisites, dmApproved: true};
};

describe("bounded HP and proficiency reconciliation", () => {
	it.each([
		["CR fallback", {cr: "1/2"}],
		["existing numeric note", {cr: "1/2", profBonus: 2, pbNote: "+2"}],
		["unchanged explicit engine PB", {cr: "1/2", profBonus: 3}],
	])("keeps the real rendered PB and engine PB coherent through preview and frozen replay: %s", (_label, patch) => {
		const current = {...commoner, ...patch};
		const before = structuredClone(current);
		const options = pbOptions(current);
		const preview = BestiaryCreatureTransformation.preview(options);
		expect(Renderer.monster.getPbPart(preview.proposed)).toBe("+3");
		expect(preview.proposed.profBonus).toBe(3);
		expect(preview.proposed.pbNote).toBe("+3");
		expect(preview.proposed.cr).toBe("1/2");
		expect(preview.writes).toContainEqual(expect.objectContaining({path: "pbNote", before: current.pbNote, after: "+3"}));
		if (current.profBonus !== 3) expect(preview.writes).toContainEqual(expect.objectContaining({path: "profBonus", before: current.profBonus, after: 3}));
		const operation = JSON.parse(JSON.stringify(BestiaryCreatureTransformation.createOperation({
			preview, currentPreview: BestiaryCreatureTransformation.preview(options),
		})));
		options.resolved.changes.find(it => it.type === "setProficiencyBonus").value = 9;
		const replayed = BestiaryCreatureTransformation.replay({creature: current, baseCreature: current, operation});
		expect(Renderer.monster.getPbPart(replayed.creature)).toBe("+3");
		expect(replayed.creature.profBonus).toBe(3);
		expect(replayed.writes).toContainEqual(expect.objectContaining({path: "pbNote", after: "+3"}));
		const registry = new BestiaryQuickActionsRegistry();
		const id = registry.addOperation({creature: current, operation});
		expect(Renderer.monster.getPbPart(registry.getCreature({creature: current}))).toBe("+3");
		expect(registry.removeOperation({creature: current, operationId: id})).toBe(true);
		expect(registry.getCreature({creature: current})).toEqual(current);
		expect(Renderer.monster.getPbPart(registry.getCreature({creature: current}))).toBe(current.pbNote ?? "+2");
		expect(current).toEqual(before);
	});

	it("uses an existing plain numeric PB note as source input, without deriving a new PB from CR", () => {
		const current = {...commoner, cr: "1/2", pbNote: "+4"};
		expect(compileCreatureTransformationStats({current, nextProficiencyBonus: 5})).toEqual([{op: "setProficiencyBonus", value: 5}]);
		expect(() => compileCreatureTransformationStats({current, proficiencyBonus: 2, nextProficiencyBonus: 5})).toThrow(/disagrees/);
		const coherent = {...commoner, profBonus: 3, pbNote: "+3"};
		expect(compileCreatureTransformationStats({current: coherent, nextProficiencyBonus: 3})).toEqual([]);
	});

	it.each([
		["authored PB rule", {pbNote: "equals your proficiency bonus"}],
		["conditional numeric note", {pbNote: "+2 (+3 in lair)"}],
		["empty authored note", {pbNote: ""}],
		["non-string note", {pbNote: 2}],
		["disagreeing engine and note", {pbNote: "+4"}],
	])("rejects PB replacement without overwriting an ambiguous source: %s", (_label, patch) => {
		const valid = {...commoner, profBonus: 2};
		const current = {...valid, ...patch};
		const before = structuredClone(current);
		const options = pbOptions(valid);
		const preview = BestiaryCreatureTransformation.preview(options);
		const operation = BestiaryCreatureTransformation.createOperation({preview, currentPreview: preview});
		for (const attempt of [
			() => compileCreatureTransformationStats({current, nextProficiencyBonus: 3}),
			() => BestiaryCreatureTransformation.preview({...options, current}),
			() => BestiaryCreatureTransformation.replay({creature: current, baseCreature: valid, operation}),
		]) {
			try {
				attempt();
				throw new Error("Ambiguous PB unexpectedly succeeded.");
			} catch (error) {
				expect(error.code).toBe("CREATURE_TRANSFORMATION_INPUT_REQUIRED");
				expect(error.message).toMatch(/pbNote/);
			}
		}
		expect(current).toEqual(before);
		const retained = compileCreatureTransformation({resolved: staged(), current});
		expect(retained.changes.some(it => it.op === "setProficiencyBonus")).toBe(false);
	});

	it("tracks both canonical PB writes and keeps note-only and paired conflicts atomic through replay", () => {
		const original = {...commoner, cr: "1/2", profBonus: 2, pbNote: "+2"};
		const initialOptions = pbOptions(original);
		const initialPreview = BestiaryCreatureTransformation.preview(initialOptions);
		const initialOperation = BestiaryCreatureTransformation.createOperation({preview: initialPreview, currentPreview: initialPreview});
		const initial = BestiaryCreatureTransformation.replay({creature: original, baseCreature: original, operation: initialOperation});
		const options = {...pbOptions(initial.creature, 4, original), priorWrites: initial.writes};
		for (const priorWrites of [initial.writes, initial.writes.filter(it => it.path !== "profBonus")]) {
			const pending = BestiaryCreatureTransformation.preview({...options, priorWrites});
			const pbPaths = pending.conflicts.map(it => it.path).filter(path => ["profBonus", "pbNote"].includes(path));
			expect(pbPaths).toContain("pbNote");
			const decisions = Object.fromEntries(pending.conflicts.map(it => [it.path, "incoming"]));
			const incoming = BestiaryCreatureTransformation.preview({...options, priorWrites, conflictDecisions: decisions});
			expect(incoming.proposed.profBonus).toBe(4);
			expect(Renderer.monster.getPbPart(incoming.proposed)).toBe("+4");
			expect(incoming.writes).toEqual(expect.arrayContaining([
				expect.objectContaining({path: "profBonus", before: 3, after: 4}),
				expect.objectContaining({path: "pbNote", before: "+3", after: "+4"}),
			]));
			const operation = JSON.parse(JSON.stringify(BestiaryCreatureTransformation.createOperation({
				preview: incoming, currentPreview: incoming, conflictDecisions: decisions,
			})));
			const replayed = BestiaryCreatureTransformation.replay({creature: initial.creature, baseCreature: original, operation, priorWrites});
			expect(replayed.creature.profBonus).toBe(4);
			expect(Renderer.monster.getPbPart(replayed.creature)).toBe("+4");
			const retainedDecisions = Object.fromEntries(pending.conflicts.map(it => [it.path, "existing"]));
			const retained = BestiaryCreatureTransformation.preview({...options, priorWrites, conflictDecisions: retainedDecisions});
			expect(retained.proposed.profBonus).toBe(3);
			expect(Renderer.monster.getPbPart(retained.proposed)).toBe("+3");
			expect(retained.writes.some(it => ["profBonus", "pbNote"].includes(it.path))).toBe(false);
			expect(() => BestiaryCreatureTransformation.preview({
				...options, priorWrites, conflictDecisions: {...decisions, pbNote: "existing"},
			})).toThrow(/one conflict winner/);
		}
	});

	it("uses independent MM HP/bonus and DMG passive rules on real source statblocks", () => {
		// MM pp. 7-9: count * CON modifier; DMG p. 279: passive = 10 + Perception.
		const changes = compileCreatureTransformationStats({current: knight, abilities: {con: 16, wis: 7}});
		expect(changes).toContainEqual({op: "setHitPoints", value: {average: 60, formula: "8d8 + 24"}});
		expect(changes).toContainEqual({op: "setSaveBonus", ability: "con", value: 5});
		expect(changes).toContainEqual({op: "setSaveBonus", ability: "wis", value: 0});
		expect(changes).toContainEqual({op: "setPassivePerception", value: 8});
		const expert = compileCreatureTransformationStats({current: scout, abilities: {wis: 9, int: 5}});
		expect(expert).toContainEqual({op: "setSkillBonus", skill: "perception", value: 3});
		expect(expert).toContainEqual({op: "setSkillBonus", skill: "nature", value: 1});
		expect(expert).toContainEqual({op: "setPassivePerception", value: 13});
		expect(scout.skill.perception).toBe("+5");
		expect(knight.hp).toEqual({average: 52, formula: "8d8 + 16"});
	});

	it("preserves authored fixed/per-die HP extras and adds an explicitly independent bonus exactly once", () => {
		const current = {...commoner, con: 14, hp: {average: 32, formula: "4d8 + 14"}};
		// +8 CON, +4 per-HD residual, +2 fixed; the new +1/HD and +3 fixed are separate.
		const hp = {mode: "constitution", residual: {perHitDie: 1, fixed: 2}, bonusPerHitDie: 1, bonusFixed: 3};
		expect(hpOf({current, abilities: {con: 16}, hp})).toEqual({average: 43, formula: "4d8 + 25"});
		expect(hpOf({current, abilities: {con: 16}})).toEqual({average: 36, formula: "4d8 + 18"});
		expect(hpOf({current, abilities: {con: 16}, hp: {...hp, hitDice: {number: 6, faces: 10}}})).toEqual({average: 68, formula: "6d10 + 35"});
		expect(() => hpOf({current, hp: {mode: "constitution", hitDice: {number: 6, faces: 10}}})).toThrow(/per-Hit-Die\/fixed binding/);
		expect(() => hpOf({current, hp: {mode: "constitution", residual: {perHitDie: 2, fixed: 0}}})).toThrow(/do not explain/);
	});

	it("handles negative modifiers, odd averages, the one-HP floor and explicit source overrides without double CON", () => {
		expect(hpOf({current: commoner, abilities: {con: 8}})).toEqual({average: 3, formula: "1d8 - 1"});
		expect(hpOf({current: commoner, abilities: {con: 1}})).toEqual({average: 1, formula: "1d8 - 5"});
		const low = {...commoner, con: 1, hp: {average: 1, formula: "1d4 - 5"}};
		expect(hpOf({current: low, abilities: {con: 10}})).toEqual({average: 2, formula: "1d4"});
		const hp = {mode: "override", value: {average: 40, formula: "4d8 + 22"}};
		expect(hpOf({current: commoner, abilities: {con: 20}, hp})).toEqual(hp.value);
		expect(hpOf({current: {...commoner, hp: {special: "variable"}}, abilities: {con: 20}, hp: {mode: "retain"}})).toBeUndefined();
		expect(hpOf({current: commoner, hp: {mode: "constitution", hitDice: {number: 3, faces: 6}}})).toEqual({average: 10, formula: "3d6"});
	});

	it("preserves known no-proficiency, proficiency, expertise and non-PB residuals when PB and abilities change", () => {
		const current = {...scout, profBonus: 2, save: {str: "+0", con: "+5", wis: "+6"}, passive: 20};
		const changes = compileCreatureTransformationStats({
			current,
			abilities: {str: 13, con: 14, wis: 15},
			nextProficiencyBonus: 3,
			bindings: {save: {str: 0, con: 1, wis: 2}, skill: {nature: 2, perception: 2, stealth: 2, survival: 2}},
		});
		// CON +5 = +1 ability +2 PB +2 residual; WIS +6 = +1 ability +4 expertise +1 residual.
		expect(changes).toEqual(expect.arrayContaining([
			{op: "setSaveBonus", ability: "str", value: 1},
			{op: "setSaveBonus", ability: "con", value: 7},
			{op: "setSaveBonus", ability: "wis", value: 9},
			{op: "setSkillBonus", skill: "perception", value: 8},
			{op: "setSkillBonus", skill: "stealth", value: 8},
			{op: "setProficiencyBonus", value: 3},
			{op: "setPassivePerception", value: 23},
		]));
		const explicit = compileCreatureTransformationStats({
			current: commoner, proficiencyBonus: 2, nextProficiencyBonus: 4,
		});
		expect(explicit).toEqual([{op: "setProficiencyBonus", value: 4}]);
		expect(compileCreatureTransformationStats({current: {...commoner, passive: undefined}})).toContainEqual({op: "setPassivePerception", value: 10});
	});

	it.each([
		[{hp: {special: "variable"}}, {}, /HP needs/],
		[{hp: {average: 12, formula: "1d8 + 1d6"}}, {}, /single Nd/],
		[{hp: {average: 12, formula: "4 + PB"}}, {}, /single Nd/],
		[{hp: {average: 10, formula: "1d8"}}, {}, /average disagrees/],
		[{con: 31}, {}, /con score/],
		[{skill: {perception: "+2 + PB"}}, {}, /skill.perception/],
		[{skill: {other: [{oneOf: {stealth: "+2"}}]}}, {}, /alternative bindings/],
		[{save: {con: {value: 2}}}, {}, /save.con/],
		[{passive: "10 + PB"}, {}, /Passive Perception/],
		[{}, {nextProficiencyBonus: 3}, /current proficiency bonus/],
		[{profBonus: 2}, {proficiencyBonus: 3}, /disagrees/],
		[{profBonus: 2, skill: {perception: "+4"}}, {nextProficiencyBonus: 3}, /explicit proficiency\/expertise/],
		[{profBonus: 2, skill: {perception: "+4"}}, {bindings: {skill: {perception: 0.5}}}, /multiplier/],
		[{}, {hp: {mode: "retain", bonusFixed: 5}}, /cannot also/],
		[{}, {hp: {mode: "constitution", hitDice: {number: 0, faces: 8}}}, /Hit Dice/],
		[{}, {hp: {mode: "constitution", hitDice: {number: 2, faces: 100}}}, /Hit Dice/],
		[{}, {hp: {mode: "constitution", hitDice: null}}, /Hit Dice/],
		[{}, {bindings: {skill: null}}, /proficiency bindings/],
		[{}, {hpBonus: 4}, /Numeric inputs/],
		[{}, {abilities: {con: 32}}, /output score/],
	])("rejects ambiguous/unsupported numeric input %# without mutating its target", (patch, options, reason) => {
		const current = {...structuredClone(commoner), ...patch};
		const before = JSON.stringify(current);
		expect(() => compileCreatureTransformationStats({current, ...options})).toThrow(reason);
		try {
			compileCreatureTransformationStats({current, ...options});
		} catch (error) {
			expect(error.code).toBe("CREATURE_TRANSFORMATION_INPUT_REQUIRED");
		}
		expect(JSON.stringify(current)).toBe(before);
	});

	it("applies every strict numeric setter through a real v2 snapshot, but never through legacy or M1", () => {
		const current = {...knight, profBonus: 2, skill: {perception: "+2"}};
		const numeric = compileCreatureTransformationStats({
			current,
			abilities: {con: 16, wis: 7},
			nextProficiencyBonus: 3,
			bindings: {save: {con: 1, wis: 1}, skill: {perception: 1}},
		});
		const concrete = compileCreatureTransformation({resolved: staged(), current});
		concrete.changes = [...concrete.changes.filter(it => !["setAbility", "setHitPoints", "setSaveBonus", "setSkillBonus", "setPassivePerception"].includes(it.op)), ...numeric];
		const normalized = normalizeCreatureTransformation(concrete);
		const options = {original: current, current, resolved: normalized, acknowledgedPrerequisites: concrete.prerequisites, dmApproved: true};
		const preview = BestiaryCreatureTransformation.preview(options);
		expect(preview.proposed).toMatchObject({
			con: 16,
			wis: 7,
			hp: {average: 60, formula: "8d8 + 24"},
			profBonus: 3,
			save: {con: "+6", wis: "+1"},
			skill: {perception: "+1"},
			passive: 9,
		});
		expect(preview.proposed.ac).toEqual(current.ac);
		expect(preview.proposed.action).toEqual(current.action);
		expect(preview.proposed.cr).toEqual(current.cr);
		const operation = JSON.parse(JSON.stringify(BestiaryCreatureTransformation.createOperation({
			preview, currentPreview: BestiaryCreatureTransformation.preview(options),
		})));
		expect(BestiaryCreatureTransformation.replay({creature: current, baseCreature: current, operation}).creature).toEqual(preview.proposed);
		for (const version of [undefined, 1, 3]) {
			const legacy = {...concrete, ...version === undefined ? {} : {version}};
			if (version === undefined) delete legacy.version;
			expect(() => normalizeCreatureTransformation(legacy)).toThrow(/numeric|version-2/i);
			expect(() => BestiaryCreatureTransformation.preview({...options, resolved: {...normalized, version}})).toThrow();
		}
		const malformed = {...normalized, changes: [...normalized.changes, {type: "setHitPoints", value: {average: 0, formula: "1d8"}}]};
		expect(() => BestiaryCreatureTransformation.preview({...options, resolved: malformed})).toThrow();
	});

	it("keeps the numeric schema closed and rejects these setters in authored default recipes", () => {
		const schema = JSON.parse(fs.readFileSync("schema/site/creature-transformation.json", "utf8"));
		const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/numericChange"});
		const changes = [
			{op: "setHitPoints", value: {average: 60, formula: "8d8 + 24"}},
			{op: "setSaveBonus", ability: "con", value: -2},
			{op: "setSkillBonus", skill: "perception", value: 5},
			{op: "setPassivePerception", value: 15},
			{op: "setProficiencyBonus", value: 3},
		];
		for (const step of changes) {
			expect(validate(step)).toBe(true);
			expect(isCreatureTransformationStatChange(step)).toBe(true);
		}
		for (const step of [
			{op: "setHitPoints", value: {average: 2, formula: "1d8 + PB"}},
			{op: "setSaveBonus", ability: "not-an-ability", value: 2},
			{op: "setSkillBonus", skill: "custom", value: 2},
			{op: "setPassivePerception", value: -1},
			{op: "setProficiencyBonus", value: 0},
			{op: "setSkillBonus", skill: "stealth", value: 2, path: "ac"},
			{op: "setHitPoints", value: {average: 2, formula: "10001d8"}},
			{op: "setHitPoints", value: {average: 2, formula: "1d8 + 1000001"}},
		]) {
			expect(validate(step)).toBe(false);
			expect(isCreatureTransformationStatChange(step)).toBe(false);
		}
		expect(() => getCreatureTransformationCandidates({catalog: {creatureTransformation: [{...catalog.creatureTransformation[0], changes}]}, races: []})).toThrow(/Invalid transformation change/);
	});
});
