import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import {estimateCreatureTransformationCr, isCreatureTransformationCrChange} from "../../js/creature-transformation-cr.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterMonsterXp} from "../../js/encounterworkspace/encounterworkspace-assessment.js";
import {getCreatureTransformationCorpusErrors} from "../util-creature-transformation-schema.js";

const table = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const monsters = JSON.parse(fs.readFileSync("data/bestiary/bestiary-mm.json", "utf8")).monster;
const source = name => monsters.find(it => it.name === name && it.source === "MM");
const staged = (data = catalog) => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog: data, races: []}), id: "catalog:zombie|dmg", automationVersion: 2});
const amount = (value, proficiency = 0) => ({value, proficiency});
const routine = (id = "melee", rounds = [30, 30, 30], value = 5, proficiency = 0, kind = "attack") => ({
	id,
	rounds: rounds.map(value => amount(value)),
	accuracy: {kind, value, proficiency},
	note: "Declared three-round totals include all selected attacks, targets and off-turn damage; accuracy is the most frequent chosen mode.",
});
const assumptions = (patch = {}) => ({
	defense: {expectedCr: "4",
		hpBoundary: null,
		acIndex: 0,
		acAdjustment: 0,
		hpAdjustment: 0,
		resistance: "none",
		vulnerability: false,
		regeneration: 0,
		note: "Reviewed the selected armor alternative, all defenses, regeneration and other effective-HP/AC features; no further numeric effects apply."},
	routines: [routine()],
	routine: "highest-damage",
	review: "Post-ability, pre-PB numbers explicitly adjudicated; all relevant effects and alternate routines are represented. No unmodeled effects remain.",
	override: null,
	zeroXp: false,
	proficiencyAnswer: null,
	...patch,
});
const creature = (hp = 120, ac = 14, cr = "4") => ({name: "Numeric oracle", source: "MM", cr, hp: {average: hp}, ac: [ac]});
const estimate = (current = creature(), input = assumptions(), rows = table, proficiencyBonus) => estimateCreatureTransformationCr({
	current, table: rows, assumptions: input, ...proficiencyBonus === undefined ? {} : {proficiencyBonus},
});
const entry = (name, numbers, section = "action") => ({section, match: {name, source: "MM"}, mode: "bind", numbers});
const ability = (kind, token, attribute, proficiency, fixed = 0, dice) => ({
	paragraph: 0, kind, token, mode: "ability", ability: attribute, proficiency, fixed, ...dice ? {dice} : {},
});
const retainEntry = (name, section = "action") => ({section, match: {name, source: "MM"}, mode: "retain"});
const bugbearInputs = (patch = {}) => ({
	bindings: {
		armor: {mode: "recalculate", alternatives: [{kind: "worn", base: 12, dexterity: "capped", maxDex: 2, shield: 2, fixed: 0}]},
		entries: [
			entry("Morningstar", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, {number: 2, faces: 8})]),
			entry("Javelin", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, {number: 2, faces: 6}), ability("damage", 1, "str", 0, 0, {number: 1, faces: 6})]),
			retainEntry("Surprise Attack", "trait"),
		],
	},
	proficiencies: {skill: {stealth: 2, survival: 1}},
	cr: {table: structuredClone(table), assumptions: assumptions({routines: [routine("morningstar", [12, 12, 12], 5, 1)]})},
	...patch,
});
const target = (id, baseCreature = source("Bugbear"), operations = []) => ({id, label: id, baseCreature, operations});
const stage = (targets, automationInputs, extras = {}) => {
	const resolved = staged();
	return previewCreatureTransformationTargets({targets, resolved, automationInputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extras});
};
const save = (batch, conflictDecisions = {}) => createCreatureTransformationChanges({batch, targets: batch.targets, conflictDecisions})
	.map((edit, ix) => ({...edit, addOperations: edit.addOperations.map(op => ({...op, id: `m3-${ix}`}))}));
const incoming = (targets, automationInputs) => {
	const pending = stage(targets, automationInputs);
	const decisions = Object.fromEntries(pending.previews.map(it => [it.id, Object.fromEntries(it.preview.conflicts.map(conflict => [conflict.path, "incoming"]))]));
	return {batch: stage(targets, automationInputs, {conflictDecisions: decisions}), decisions};
};
const priorHp = [{id: "prior-hp", type: "patch", data: {patch: {set: {hp: {average: 44, formula: "8d8 + 8"}}}}}];
const previousConfig = globalThis.VetoolsConfig;
beforeAll(() => { globalThis.VetoolsConfig = {get: () => "classic"}; });
afterAll(() => { globalThis.VetoolsConfig = previousConfig; });

function inputRequired (attempt, message) {
	try {
		attempt();
		throw new Error("Unresolved CR inputs unexpectedly succeeded.");
	} catch (error) {
		expect(error.code).toBe("CREATURE_TRANSFORMATION_INPUT_REQUIRED");
		expect(error.message).toMatch(message);
	}
}

describe("M3 pure numeric DMG 2014 estimate (independent table/rule oracles)", () => {
	it.each([
		[1, 0, "0", 10], [7, 2, "1/8", 25], [36, 4, "1/4", 50], [50, 6, "1/2", 100],
	])("uses fractional HP %i / DPR %i for canonical CR %s and XP %i", (hp, dpr, cr, xp) => {
		const result = estimate(creature(hp, 13, cr), assumptions({routines: [routine("basic", [dpr, dpr, dpr], 3)]}));
		expect(result.value).toEqual({cr, xp});
		expect(result.receipt).toMatchObject({defensiveCr: cr, offensiveCr: cr, estimatedCr: cr, proficiency: {before: 2, after: 2, canonical: 2, source: "derived-cr"}});
	});

	it("rounds the actual numeric average to the nearest canonical CR, taking the higher exact tie", () => {
		// DCR 1/8 and OCR 1/4 average 3/16: exactly between 1/8 and 1/4.
		const result = estimate(creature(7, 13), assumptions({routines: [routine("basic", [4, 4, 4], 3)]}));
		expect(result.value).toEqual({cr: "1/4", xp: 50});
		expect(result.receipt).toMatchObject({defensiveCr: "1/8", offensiveCr: "1/4"});
	});

	it("accounts for adjudicated resistance, regeneration, prevalent vulnerability and effective AC without mutating actual HP", () => {
		const current = creature(150, 13, "6");
		const original = structuredClone(current);
		const input = assumptions({routines: [routine("basic", [18, 18, 18], 3)]});
		Object.assign(input.defense, {expectedCr: "6", resistance: "resistance"});
		// 150*1.5=225 -> HP CR11; AC13 vs17 moves down2 -> DCR9. OCR2 -> mean5.5 -> CR6.
		expect(estimate(current, input)).toMatchObject({value: {cr: "6", xp: 2300}, receipt: {effectiveHp: 225, defensiveCr: "9", offensiveCr: "2"}});
		input.defense.regeneration = 10;
		// 225+3*10=255 -> HP CR13; AC13 vs18 down2 -> DCR11; mean(11,2)=6.5 -> CR7.
		expect(estimate(current, input)).toMatchObject({value: {cr: "7", xp: 2900}, receipt: {effectiveHp: 255, defensiveCr: "11"}});
		input.defense.vulnerability = true;
		// floor(150*1.5/2+30)=142 -> HP CR5; AC13 vs15 down1 -> DCR4; mean(4,2)=3.
		expect(estimate(current, input)).toMatchObject({value: {cr: "3", xp: 700}, receipt: {effectiveHp: 142, defensiveCr: "4"}});
		Object.assign(input.defense, {resistance: "immunity", vulnerability: false, regeneration: 0});
		expect(estimate(current, input).receipt).toMatchObject({effectiveHp: 300, defensiveCr: "14", estimatedCr: "8"});
		Object.assign(input.defense, {resistance: "resistance", expectedCr: "17", acAdjustment: 2});
		expect(estimate(current, input).receipt).toMatchObject({effectiveHp: 150, effectiveAc: 15, defensiveCr: "6", estimatedCr: "4"});
		expect(current).toEqual(original);
	});

	it("uses an explicitly chosen conditional armor alternative and source-table overlap policy", () => {
		const input = assumptions();
		input.defense.acIndex = 1;
		expect(estimate({...creature(), ac: [14, {ac: 16, condition: "with a spell"}]}, input).receipt.defensiveCr).toBe("5");
		input.defense.acIndex = 0;
		input.routines = [routine("high", [300, 300, 300], 13)];
		inputRequired(() => estimate(creature(805, 19, "29"), input), /Overlapping HP.*lower or higher/);
		input.defense.hpBoundary = "lower";
		expect(estimate(creature(805, 19, "29"), input)).toMatchObject({value: {cr: "29", xp: 135000}, receipt: {defensiveCr: "29"}});
		input.defense.hpBoundary = "higher";
		expect(estimate(creature(805, 19, "29"), input)).toMatchObject({value: {cr: "30", xp: 155000}, receipt: {defensiveCr: "30"}});
		input.routines = [routine("high", [270, 270, 270], 13)];
		input.defense.hpBoundary = null;
		inputRequired(() => estimate(creature(760, 19, "28"), input), /Overlapping HP/);
		input.defense.hpBoundary = "lower";
		expect(estimate(creature(760, 19, "28"), input)).toMatchObject({value: {cr: "28", xp: 120000}, receipt: {defensiveCr: "28"}});
		input.defense.hpBoundary = "higher";
		expect(estimate(creature(760, 19, "28"), input)).toMatchObject({value: {cr: "29", xp: 135000}, receipt: {defensiveCr: "29"}});
	});

	it("selects the most damaging complete three-round routine, not their sum or the first listed attack", () => {
		const input = assumptions({routines: [
			routine("weapon", [37, 37, 37], 6),
			routine("breath-then-weapon", [90, 37, 37], 15, 0, "save"),
		]});
		// floor((90+37+37)/3)=54 -> OCR8 with DC15 vs16 (no full 2-point shift).
		// HP150/AC15 -> DCR6; average -> CR7. The source-fixed breath DC has PB multiplier0.
		const result = estimate(creature(150, 15, "6"), input);
		expect(result).toMatchObject({value: {cr: "7", xp: 2900}, receipt: {routineId: "breath-then-weapon", damagePerRound: 54, accuracy: 15, defensiveCr: "6", offensiveCr: "8"}});
		input.routines[0].rounds = [amount(90), amount(37), amount(37)];
		inputRequired(() => estimate(creature(150, 15, "6"), input), /routines tie/);
		input.routine = "weapon";
		expect(estimate(creature(150, 15, "6"), input).receipt.routineId).toBe("weapon");
	});

	it.each([
		["4", 120, 14, 30, 5, 1100, 2], ["5", 135, 15, 35, 6, 1800, 3],
		["8", 180, 16, 54, 7, 3900, 3], ["9", 195, 16, 60, 7, 5000, 4],
	])("crosses the CR %s XP/PB threshold canonically", (cr, hp, ac, dpr, hit, xp, pb) => {
		expect(estimate(creature(hp, ac, cr), assumptions({routines: [routine("basic", [dpr, dpr, dpr], hit)]})))
			.toMatchObject({value: {cr, xp}, receipt: {estimatedCr: cr, proficiency: {after: pb, canonical: pb}}});
	});

	it("reports nonunique finite PB fixed points explicitly and permits an explicit CR override to resolve them", () => {
		const input = assumptions({routines: [routine("threshold", [27, 27, 27], 3, 1)]});
		// HP131/AC15 -> DCR5. PB2 hit3 -> OCR3 -> CR4/PB2; PB3 hit4 -> OCR4 -> CR5/PB3.
		inputRequired(() => estimate(creature(131, 15), input), /2 fixed points.*eight-value/);
		input.override = {cr: "5", reason: "DM selects the higher fixed point after review."};
		expect(estimate(creature(131, 15), input)).toMatchObject({value: {cr: "5", xp: 1800}, receipt: {estimatedCr: "5", accuracy: 4, proficiency: {before: 2, after: 3}}});
	});

	it("reconciles an explicit aggregate damage coefficient and rejects a routine-switch PB cycle without a fallback", () => {
		const input = assumptions({routines: [routine("pb-damage", [32, 32, 32], 6)]});
		input.routines[0].rounds = [amount(32, 2), amount(32, 2), amount(32, 2)];
		input.override = {cr: "5", reason: "PB2 to PB3 adds two damage per round, from 32 to 34."};
		// 34 DPR -> OCR5 with hit6; HP135/AC15 -> DCR5, so estimated CR5.
		expect(estimate(creature(135, 15), input)).toMatchObject({value: {cr: "5", xp: 1800}, receipt: {damagePerRound: 34, offensiveCr: "5", estimatedCr: "5"}});
		const switching = assumptions({routines: [
			routine("accurate", [32, 32, 32], 8),
			{...routine("more-but-inaccurate", [30, 30, 30], 0), rounds: [amount(30, 3), amount(30, 3), amount(30, 3)]},
		]});
		// At PB2 the accurate routine implies CR5/PB3; PB3 switches to 33 DPR/hit0,
		// yielding OCR2 with DCR5, hence CR4/PB2. PB4..9 imply only PB2 or PB3.
		inputRequired(() => estimate(creature(131, 15), switching), /0 fixed points.*eight-value/);
		switching.override = {cr: "5", reason: "Explicit override resolves the nonconvergent routine switch."};
		expect(estimate(creature(131, 15), switching)).toMatchObject({value: {cr: "5", xp: 1800}, receipt: {estimatedCr: "4", routineId: "more-but-inaccurate", damagePerRound: 33, proficiency: {after: 3}}});
	});

	it.each([
		[{profBonus: 6}, undefined, "source-profBonus", 6],
		[{pbNote: "+4"}, undefined, "source-pbNote", 4],
		[{}, 5, "source-input", 5],
	])("preserves explicit source PB instead of replacing it with CR-derived PB %#", (patch, supplied, origin, pb) => {
		const input = assumptions({override: {cr: "5", reason: "Source-independent CR adjudication."}});
		expect(estimate({...creature(), ...patch}, input, table, supplied))
			.toMatchObject({value: {cr: "5", xp: 1800}, receipt: {estimatedCr: "4", proficiency: {source: origin, before: pb, after: pb, canonical: 3}}});
	});

	it("replaces old custom XP with canonical XP, including the explicit CR0 no-threat exception", () => {
		const input = assumptions({override: {cr: "0", reason: "No threat after transformation."}, zeroXp: true});
		const noThreat = {...creature(), cr: estimate({...creature(), cr: {cr: "4", xp: 999}}, input).value};
		expect(noThreat.cr).toEqual({cr: "0", xp: 0});
		expect(Renderer.monster.getChallengeRatingPart(noThreat, {isPlainText: true})).toBe("0 (0 XP)");
		expect(getEncounterMonsterXp(noThreat)).toBe(0);
		input.zeroXp = false;
		expect(estimate(creature(), input).value).toEqual({cr: "0", xp: 10});
		input.override.cr = "1";
		input.zeroXp = true;
		inputRequired(() => estimate(creature(), input), /0 XP policy/);
	});

	it("fails on unsupported effects, missing reviews, malformed tables, ambiguous notes and out-of-domain numbers without mutation", () => {
		const sparseRounds = [amount(30), amount(30), amount(30)];
		delete sparseRounds[1];
		for (const [current, input, rows, message] of [
			[creature(), {...assumptions(), review: ""}, table, /full effect review/],
			[creature(), {...assumptions(), effects: ["unmodeled aura"]}, table, /unsupported effects/],
			[creature(), assumptions({override: {cr: "5", reason: "", xp: 12}}), table, /override/],
			[{...creature(), pbNote: "+2 in combat"}, assumptions(), table, /pbNote/],
			[{...creature(), profBonus: 3, pbNote: "+2"}, assumptions(), table, /disagrees/],
			[{...creature(), cr: {cr: "4", lair: "5"}}, assumptions(), table, /source-specific policy/],
			[{...creature(), cr: "Unknown"}, assumptions(), table, /canonical current CR/],
			[creature(1000), assumptions(), table, /outside the supported/],
			[creature(), assumptions({routines: [routine("too-high", [321, 321, 321])]}), table, /damage domain/],
			[creature(), assumptions({routines: [{...routine(), rounds: sparseRounds}]}), table, /three-round routines/],
			[creature(), assumptions({routines: [routine("invalid-save", [30, 30, 30], -1, 0, "save")]}), table, /three-round routines/],
			[creature(), assumptions(), table.slice(1), /34 ordered rows/],
			[creature(), assumptions(), table.map((row, i) => i === 8 ? {...row, pb: 2} : row), /noncanonical row/],
		]) {
			const before = structuredClone({current, input, rows});
			inputRequired(() => estimate(current, input, rows), message);
			expect({current, input, rows}).toEqual(before);
		}
	});
});

describe("M3 actual opt-in Zombie producer, not default rollout", () => {
	it("compiles actual target histories with transformed HP rather than unmodified chassis HP", () => {
		const targets = [target("prior", source("Bugbear"), priorHp), target("plain")];
		const batch = stage(targets, {prior: bugbearInputs(), plain: bugbearInputs()});
		expect(batch.skipped).toEqual([]);
		// 8d8+8 at CON13 -> 8d8+16 at CON15 =52 HP. AC16 -> DCR1.
		// Morningstar 12 DPR and hit5 -> OCR2; mean(1,2)=1.5 -> CR2.
		expect(batch.previews[0].preview.proposed).toMatchObject({hp: {average: 52, formula: "8d8 + 16"}, cr: {cr: "2", xp: 450}, profBonus: 2, pbNote: "+2"});
		// Original 5d8+5 -> 5d8+10 =32 HP; DCR1/4. mean(1/4,2)=1.125 -> CR1.
		expect(batch.previews[1].preview.proposed).toMatchObject({hp: {average: 32, formula: "5d8 + 10"}, cr: {cr: "1", xp: 200}});
		const receipt = batch.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt;
		expect(receipt).toMatchObject({estimatedCr: "2", defensiveCr: "1", offensiveCr: "2", effectiveHp: 52});
		expect(batch.previews[0].preview.manualReview).toContainEqual({field: "cr", reason: expect.stringMatching(/estimate.*not a playtested/)});
		expect(Renderer.monster.getPbPart(batch.previews[0].preview.proposed)).toBe("+2");
	});

	it("reconciles an ordinary overridden PB through actual saves, expertise, passive, AC and entry bindings atomically", () => {
		const base = {...source("Bugbear"), save: {con: "+3"}, skill: {...source("Bugbear").skill, perception: "+5"}, passive: 15};
		const input = bugbearInputs();
		input.proficiencies.save = {con: 1};
		input.proficiencies.skill.perception = 2;
		input.cr.assumptions.override = {cr: "5", reason: "Explicit DM override crosses PB2 to PB3."};
		const batch = stage([target("one", base)], {one: input});
		expect(batch.skipped).toEqual([]);
		const proposed = batch.previews[0].preview.proposed;
		expect(proposed).toMatchObject({cr: {cr: "5", xp: 1800}, profBonus: 3, pbNote: "+3", save: {con: "+5"}, skill: {stealth: "+8", survival: "+1", perception: "+5"}, passive: 15});
		expect(proposed.action[0].entries[0]).toContain("{@hit 6}");
		expect(proposed.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(proposed.ac).toEqual(base.ac);
		expect(proposed.trait.find(it => it.name === "Surprise Attack")).toEqual(base.trait.find(it => it.name === "Surprise Attack"));
		expect(Renderer.monster.getPbPart(proposed)).toBe("+3");
		const receipt = batch.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt;
		expect(receipt).toMatchObject({estimatedCr: "1", accuracy: 6, proficiency: {source: "derived-cr", before: 2, after: 3, canonical: 3}});
		delete input.proficiencies.skill.stealth;
		expect(stage([target("one", base)], {one: input}).skipped[0].reason).toMatch(/multiplier.*skill.stealth/);
	});

	it("preserves explicit source PB and paired engine/display semantics even when the new CR implies another PB", () => {
		const base = {...source("Bugbear"), profBonus: 3};
		const input = bugbearInputs();
		for (const binding of input.bindings.entries) {
			for (const number of binding.numbers || []) if (number.kind === "hit") number.fixed = -1;
		}
		input.cr.assumptions.override = {cr: "9", reason: "Explicit source PB3 is retained, independently of CR9/PB4."};
		const batch = stage([target("one", base)], {one: input});
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed).toMatchObject({cr: {cr: "9", xp: 5000}, profBonus: 3, pbNote: "+3"});
		expect(batch.previews[0].preview.proposed.action[0].entries[0]).toContain("{@hit 5}");
		expect(batch.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt.proficiency)
			.toEqual({source: "source-profBonus", before: 3, after: 3, canonical: 4, history: null});
	});

	it("does not rescale source-fixed donor breath DC/dice when the real producer changes CON and ordinary PB", () => {
		const base = source("Young Red Dragon");
		const inputs = {
			bindings: {
				armor: {mode: "retain"},
				entries: ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"].flatMap(section =>
					(base[section] || []).filter(it => /\{@(?:hit|dc|damage)\b/.test(JSON.stringify(it))).map(it => it.name === "Fire Breath {@recharge 5}"
						? entry(it.name, [
							{paragraph: 0, kind: "dc", token: 0, mode: "fixed", value: 17},
							{paragraph: 0, kind: "damage", token: 0, mode: "fixed", value: 0, dice: {number: 16, faces: 6}},
						], section)
						: retainEntry(it.name, section))),
			},
			proficiencies: {save: {dex: 1, con: 1, wis: 1, cha: 1}, skill: {perception: 2, stealth: 1}},
			cr: {table,
				assumptions: assumptions({
					routines: [routine("fixed-breath", [112, 0, 0], 17, 0, "save")],
					override: {cr: "5", reason: "Explicit CR override; source-fixed breath remains at DC17 and 16d6."},
				})},
		};
		const batch = stage([target("dragon", base)], {dragon: inputs});
		expect(batch.skipped).toEqual([]);
		const proposed = batch.previews[0].preview.proposed;
		expect(proposed).toMatchObject({con: 23, cr: {cr: "5", xp: 1800}, profBonus: 3, pbNote: "+3"});
		expect(proposed.action.find(it => it.name === "Fire Breath {@recharge 5}")).toEqual(base.action.find(it => it.name === "Fire Breath {@recharge 5}"));
		expect(proposed.action.find(it => it.name === "Fire Breath {@recharge 5}").entries[0]).toContain("56 ({@damage 16d6})");
	});

	it("re-estimates generated PB from validated applied history rather than misclassifying the prior M3 pair as authored", () => {
		const first = save(stage([target("one")], {one: bugbearInputs()}))[0].addOperations[0];
		const input = bugbearInputs();
		input.cr.assumptions.override = {cr: "5", reason: "Second estimate crosses to ordinary PB3."};
		const targets = [target("one", source("Bugbear"), [first])];
		const {batch, decisions} = incoming(targets, {one: input});
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed).toMatchObject({cr: {cr: "5", xp: 1800}, profBonus: 3, pbNote: "+3", skill: {stealth: "+8"}});
		const receipt = batch.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt;
		expect(receipt.proficiency).toEqual({source: "derived-cr",
			before: 2,
			after: 3,
			canonical: 3,
			history: {ownership: "derived", index: 0, integrity: first.data.integrity, value: 2}});
		const second = save(batch, decisions)[0].addOperations[0];
		second.id = "second-m3";
		const operations = JSON.parse(JSON.stringify([first, second]));
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: source("Bugbear"), operation: first});
		const id = registry.addOperation({creature: source("Bugbear"), operation: second});
		expect(registry.getCreature({creature: source("Bugbear")}).profBonus).toBe(3);
		registry.removeOperation({creature: source("Bugbear"), operationId: id});
		expect(registry.getCreature({creature: source("Bugbear")}).profBonus).toBe(2);
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: source("Bugbear"), operations}).profBonus).toBe(3);
		expect(() => createCreatureTransformationChanges({batch, targets: [target("one")], conflictDecisions: decisions})).toThrow(/history changed/);
		const retained = stage(targets, {one: input}, {conflictDecisions: {one: Object.fromEntries(Object.keys(decisions.one).map(path => [path, "existing"]))}});
		expect(retained.previews[0].preview.proposed.profBonus).toBe(2);
	});

	it("honors intervening explicit same-value PB writers, and re-establishes generated ownership after their removal", () => {
		const first = save(stage([target("one")], {one: bugbearInputs()}))[0].addOperations[0];
		const authored = {id: "authored-pb", type: "patch", data: {patch: {set: {profBonus: 2, pbNote: "+2"}}}};
		const input = bugbearInputs();
		input.cr.assumptions.override = {cr: "5", reason: "CR changes; a later explicit PB decision is retained."};
		const {batch} = incoming([target("one", source("Bugbear"), [first, authored])], {one: input});
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed).toMatchObject({cr: {cr: "5", xp: 1800}, profBonus: 2, pbNote: "+2"});
		expect(batch.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt.proficiency)
			.toMatchObject({source: "source-profBonus", before: 2, after: 2, history: {ownership: "explicit", index: 1, integrity: null}});
		const removed = incoming([target("one", source("Bugbear"), [first])], {one: input}).batch;
		expect(removed.previews[0].preview.proposed.profBonus).toBe(3);
		const note = {...authored, data: {patch: {set: {pbNote: "+2 (source condition)"}}}};
		expect(stage([target("one", source("Bugbear"), [first, note])], {one: input}).skipped[0].reason).toMatch(/pbNote/);
	});

	it("respects a later different explicit PB with its source-qualified attack/skill edits", () => {
		const first = save(stage([target("one")], {one: bugbearInputs()}))[0].addOperations[0];
		const after = BestiaryQuickActionsUtil.applyOperations({baseCreature: source("Bugbear"), operations: [first]});
		const authored = {id: "authored-pb4",
			type: "patch",
			data: {patch: {set: {
				profBonus: 4,
				pbNote: "+4",
				skill: {stealth: "+10", survival: "+2"},
				action: after.action.map(it => ({...it, entries: it.entries.map(text => text.replace("{@hit 5}", "{@hit 7}"))})),
			}}}};
		const input = bugbearInputs();
		input.cr.assumptions.routines = [routine("morningstar", [12, 12, 12], 7, 1)];
		input.cr.assumptions.override = {cr: "5", reason: "Source PB4 remains explicit despite CR5 implying PB3."};
		const {batch} = incoming([target("one", source("Bugbear"), [first, authored])], {one: input});
		expect(batch.skipped).toEqual([]);
		expect(batch.previews[0].preview.proposed).toMatchObject({cr: {cr: "5", xp: 1800}, profBonus: 4, pbNote: "+4", skill: {stealth: "+10"}});
		expect(batch.previews[0].preview.proposed.action[0].entries[0]).toContain("{@hit 7}");
	});

	it("attributes only an actually applied PB decision, including retained conflicts whose prior writer was later removed", () => {
		const first = save(stage([target("one")], {one: bugbearInputs()}))[0].addOperations[0];
		const input = bugbearInputs();
		input.cr.assumptions.override = {cr: "5", reason: "This later source-fixed decision will be retained, not applied."};
		input.cr.assumptions.proficiencyAnswer = {mode: "source-fixed", value: 2, reason: "Explicit same-value PB decision."};
		const targets = [target("one", source("Bugbear"), [first])];
		const pending = stage(targets, {one: input});
		const decisions = {one: Object.fromEntries(pending.previews[0].preview.conflicts.map(it => [it.path, "existing"]))};
		const retained = stage(targets, {one: input}, {conflictDecisions: decisions});
		const second = save(retained, decisions)[0].addOperations[0];
		second.id = "retained-source-pb";
		const next = bugbearInputs();
		next.cr.assumptions.override = {cr: "9", reason: "The rejected source-fixed PB must not pin the next ordinary PB."};
		const both = incoming([target("one", source("Bugbear"), [first, second])], {one: next}).batch;
		expect(both.skipped).toEqual([]);
		expect(both.previews[0].preview.proposed.profBonus).toBe(4);
		expect(both.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt.proficiency.history)
			.toMatchObject({ownership: "derived", index: 0, integrity: first.data.integrity});
		// Removing the prior writer eliminates those conflicts: saved replay now applies the concrete second setter.
		const onlyInput = bugbearInputs();
		onlyInput.cr.assumptions.override = next.cr.assumptions.override;
		expect(stage([target("one", source("Bugbear"), [second])], {one: onlyInput}).skipped[0].reason).toMatch(/contributions/);
		// Frozen second-stage setters never regenerate formerly unchanged attacks after removal.
		// Explicitly retain those authored numbers for this separate source-policy control.
		onlyInput.bindings.entries = [retainEntry("Morningstar"), retainEntry("Javelin"), retainEntry("Surprise Attack", "trait")];
		onlyInput.cr.assumptions.routines = [routine("morningstar", [11, 11, 11], 4)];
		const only = incoming([target("one", source("Bugbear"), [second])], {one: onlyInput}).batch;
		expect(only.skipped).toEqual([]);
		expect(only.previews[0].preview.proposed.profBonus).toBe(2);
		expect(only.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt.proficiency.history)
			.toMatchObject({ownership: "explicit", index: 0, integrity: second.data.integrity});
	});

	it("requires an explicit ownership answer after an unclassified intervening operation, and freezes later same-value source-fixed answers", () => {
		const first = save(stage([target("one")], {one: bugbearInputs()}))[0].addOperations[0];
		const area = {id: "area", type: "applyAreaTrait", data: {entry: {name: "Area context", entries: ["A narrative area rule."]}, effects: []}};
		const targets = [target("one", source("Bugbear"), [first, area])];
		const input = bugbearInputs();
		input.cr.assumptions.override = {cr: "5", reason: "A new estimate after reviewing the intervening context."};
		expect(stage(targets, {one: input}).skipped[0].reason).toMatch(/ownership ambiguous/);
		input.cr.assumptions.proficiencyAnswer = {mode: "derived", value: 2, reason: "The area operation did not grant a source-fixed PB."};
		const derived = incoming(targets, {one: input}).batch;
		expect(derived.previews[0].preview.proposed.profBonus).toBe(3);
		input.cr.assumptions.proficiencyAnswer = {mode: "source-fixed", value: 2, reason: "DM explicitly fixes PB at its present value."};
		const {batch, decisions} = incoming(targets, {one: input});
		expect(batch.previews[0].preview.proposed.profBonus).toBe(2);
		const second = save(batch, decisions)[0].addOperations[0];
		second.id = "explicit-m3";
		const laterInput = bugbearInputs();
		laterInput.cr.assumptions.routines = [routine("morningstar", [13, 13, 13], 6, 1)];
		laterInput.cr.assumptions.override = {cr: "9", reason: "The later source-fixed PB2 must survive another estimate."};
		const later = incoming([target("one", source("Bugbear"), [first, area, second])], {one: laterInput}).batch;
		expect(later.skipped).toEqual([]);
		expect(later.previews[0].preview.proposed).toMatchObject({cr: {cr: "9", xp: 5000}, profBonus: 2, pbNote: "+2"});
		expect(later.previews[0].preview.resolved.changes.find(it => it.type === "setChallengeRating").receipt.proficiency.history)
			.toMatchObject({ownership: "explicit", index: 2});
	});

	it("freezes producer-to-preview-to-saved JSON replay/removal on both consumers after the live catalog and table disappear", () => {
		const targets = [target("prior", source("Bugbear"), priorHp), target("plain")];
		const input = {prior: bugbearInputs(), plain: bugbearInputs()};
		const batch = stage(targets, input);
		const edits = save(batch);
		const expected = batch.previews.map(it => it.preview.proposed);
		batch.resolved.automation.hitPoints = "changed";
		batch.automationInputs.prior.cr.table = [];
		const catalogIndex = catalog.creatureTransformation.findIndex(it => it.name === "Zombie" && it.source === "DMG");
		const [removedRecipe] = catalog.creatureTransformation.splice(catalogIndex, 1);
		const removedTable = table.splice(0);
		try {
			const operations = JSON.parse(JSON.stringify([...priorHp, ...edits[0].addOperations]));
			expect(operations[1].data.resolved).not.toHaveProperty("automation");
			expect(operations[1].data.resolved.selectedOptions["automation-cr"]).toEqual(["zombie-dmg-m3"]);
			expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: source("Bugbear"), operations})).toEqual(expected[0]);
			const registry = new BestiaryQuickActionsRegistry();
			registry.addOperation({creature: source("Bugbear"), operation: priorHp[0]});
			const id = registry.addOperation({creature: source("Bugbear"), operation: operations[1]});
			expect(registry.getCreature({creature: source("Bugbear")})).toEqual(expected[0]);
			registry.removeOperation({creature: source("Bugbear"), operationId: id});
			expect(registry.getCreature({creature: source("Bugbear")}).hp.average).toBe(44);
			let state = EncounterWorkspaceState.validate({
				version: 6,
				sourceList: {name: "CR", saveId: "cr"},
				instances: targets.map(it => ({id: it.id,
					hash: "bugbear_mm",
					monster: it.baseCreature,
					hp: {current: 27, max: 27, temp: 0},
					initiative: 1,
					conditions: [],
					areaNotes: [],
					modifiers: [],
					statblockOperations: it.operations})),
				selectedIds: targets.map(it => it.id),
				omissions: [],
				groups: [],
				ungroupedIds: [],
				turn: {round: 0, activeId: null},
			});
			state = EncounterWorkspaceState.withStatblockChanges(state, edits).state;
			const loaded = EncounterWorkspaceState.validate(JSON.parse(JSON.stringify(state)));
			expect(loaded.instances.map(it => getEncounterEffectiveMonster(it))).toEqual(expected);
			const removed = EncounterWorkspaceState.withStatblockChanges(loaded, edits.map(it => ({id: it.id, addOperations: [], removeIds: it.addOperations.map(op => op.id)}))).state;
			expect(getEncounterEffectiveMonster(removed.instances[0]).hp.average).toBe(44);
			expect(getEncounterEffectiveMonster(removed.instances[1])).toEqual(source("Bugbear"));
			operations[1].data.resolved.changes.find(it => it.type === "setChallengeRating").receipt.estimatedCr = "30";
			expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: source("Bugbear"), operations})).toThrow(/changed/);
		} finally {
			catalog.creatureTransformation.splice(catalogIndex, 0, removedRecipe);
			table.push(...removedTable);
		}
	});

	it("includes CR/XP in the whole numerical conflict group; unresolved/existing/mixed winners cannot leave stale dependencies", () => {
		const base = source("Bugbear");
		const concrete = compileCreatureTransformation({resolved: staged(), current: base, inputs: bugbearInputs()});
		const options = {original: base,
			current: base,
			resolved: normalizeCreatureTransformation(concrete),
			dmApproved: true,
			acknowledgedPrerequisites: concrete.prerequisites,
			priorWrites: [{path: "cr", after: base.cr, operationId: "prior"}, {path: "con", after: base.con, operationId: "prior"}]};
		const pending = BestiaryCreatureTransformation.preview(options);
		expect(pending.conflicts.map(it => it.path).sort()).toEqual(["con", "cr"]);
		expect(pending.proposed.hp).toEqual(base.hp);
		expect(pending.proposed.cr).toBe(base.cr);
		const decisions = {con: "existing", cr: "existing"};
		const retained = BestiaryCreatureTransformation.preview({...options, conflictDecisions: decisions});
		expect(retained.proposed.action).toEqual(base.action);
		expect(retained.proposed.profBonus).toBeUndefined();
		const incoming = BestiaryCreatureTransformation.preview({...options, conflictDecisions: {con: "incoming", cr: "incoming"}});
		expect(incoming.proposed.cr).toEqual({cr: "1", xp: 200});
		inputRequired(() => BestiaryCreatureTransformation.preview({...options, conflictDecisions: {con: "incoming", cr: "existing"}}), /one conflict winner/);
	});

	it("fences raw assumptions, table, catalog and history changes, consent and failed storage before any operation is saved", () => {
		const targets = [target("bad"), target("good")];
		const input = {bad: bugbearInputs(), good: bugbearInputs()};
		input.bad.cr.assumptions.review = "";
		const batch = stage(targets, input);
		expect(batch.skipped.map(it => it.id)).toEqual(["bad"]);
		expect(save(batch).map(it => it.id)).toEqual(["good"]);
		const changed = structuredClone(input);
		changed.good.cr.assumptions.defense.note += " Same numbers, different answer.";
		expect(() => createCreatureTransformationChanges({batch, targets, automationInputs: changed})).toThrow(/stale.*input/i);
		changed.good.cr.table[0].ac += 1;
		expect(() => createCreatureTransformationChanges({batch, targets, automationInputs: changed})).toThrow(/stale/i);
		expect(() => createCreatureTransformationChanges({batch, targets: [target("bad"), target("good", source("Bugbear"), priorHp)]})).toThrow(/stale/);
		const changedRecipe = structuredClone(batch.resolved);
		changedRecipe.changes.find(it => it.op === "adjustAbility" && it.ability === "con").amount = 4;
		expect(() => createCreatureTransformationChanges({batch, targets, resolved: changedRecipe})).toThrow(/stale/);
		expect(stage([target("good")], {good: bugbearInputs()}, {dmApproved: false}).previews).toEqual([]);
		const capped = stage([target("good")], {good: bugbearInputs()}, {validateOperation: () => { throw new Error("Storage limit"); }});
		expect(capped.skipped[0].reason).toMatch(/Storage limit/);
	});

	it("keeps the setter and receipt closed, forbids CR in default/legacy/M1/M2 snapshots and preserves the catalog", () => {
		const schema = JSON.parse(fs.readFileSync("schema/site/creature-transformation.json", "utf8"));
		const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/crChange"});
		const step = estimate();
		expect(validate(step)).toBe(true);
		expect(isCreatureTransformationCrChange(step)).toBe(true);
		for (const bad of [
			{...step, path: "arbitrary.path"},
			{...step, receipt: {...step.receipt, expression: "1+2"}},
			{...step, receipt: {...step.receipt, assumptions: {...step.receipt.assumptions, unsupported: true}}},
			{...step, receipt: {...step.receipt, proficiency: {...step.receipt.proficiency, after: 100}}},
		]) {
			expect(validate(bad)).toBe(false);
			expect(isCreatureTransformationCrChange(bad)).toBe(false);
		}
		for (const bad of [
			{...step, value: {...step.value, xp: 999}},
			{...step, receipt: {...step.receipt, proficiency: {...step.receipt.proficiency, canonical: 3}}},
			{...step, receipt: {...step.receipt, assumptions: {...step.receipt.assumptions, proficiencyAnswer: {mode: "source-fixed", value: 2, reason: "Contradicts the derived source receipt."}}}},
		]) expect(isCreatureTransformationCrChange(bad)).toBe(false);
		const defaultRecipe = resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:zombie|dmg"});
		defaultRecipe.changes.push(step);
		expect(() => normalizeCreatureTransformation(defaultRecipe)).toThrow(/version-2/);
		const m2 = compileCreatureTransformation({resolved: staged(), current: source("Bugbear")});
		m2.changes.push(step);
		expect(() => normalizeCreatureTransformation(m2)).toThrow(/version-2/);
		const m1 = compileCreatureTransformation({resolved: resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:dracolich|mm", automationVersion: 2}),
			current: source("Adult Black Dragon"),
			inputs: {age: "adult", trueDragon: true, shadowDragon: false, physiology: "amphibious-only", lairActions: "retain"}});
		m1.changes.push(step);
		expect(() => normalizeCreatureTransformation(m1)).toThrow(/version-2/);
		const recipe = structuredClone(catalog);
		recipe.creatureTransformation[0].changes.push(step);
		expect(() => getCreatureTransformationCandidates({catalog: recipe, races: []})).toThrow(/Invalid transformation change/);
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});
});
