import fs from "node:fs";
import Ajv from "ajv/dist/2020.js";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {compileCreatureTransformationBindings, compileCreatureTransformationInnateSpellcasting, getCreatureTransformationInnateSpellcastingEntry, isCreatureTransformationBindingChange} from "../../js/creature-transformation-bindings.js";
import {compileCreatureTransformationStats} from "../../js/creature-transformation-stats.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {normalizeCreatureTransformation} from "../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {BestiaryCreatureTransformation} from "../../js/bestiary/bestiary-creature-transformation.js";
import {BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";

const monsters = JSON.parse(fs.readFileSync("data/bestiary/bestiary-mm.json", "utf8")).monster;
const source = name => monsters.find(it => it.name === name && it.source === "MM");
const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const staged = () => resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:zombie|dmg", automationVersion: 2});
const retain = {mode: "retain"};
const entry = (name, numbers, section = "action") => ({section, match: {name, source: "MM"}, mode: "bind", numbers});
const fixed = (kind, token, value, dice) => ({paragraph: 0, kind, token, mode: "fixed", value, ...dice ? {dice} : {}});
const ability = (kind, token, attribute, proficiency, fixed = 0, dice) => ({paragraph: 0, kind, token, mode: "ability", ability: attribute, proficiency, fixed, ...dice ? {dice} : {}});
const dice = (number, faces) => ({number, faces});
const retainEntry = (name, section = "action") => ({section, match: {name, source: "MM"}, mode: "retain"});
const retainNumbers = creature => ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"].flatMap(section =>
	(creature[section] || []).filter(it => /\{@(?:hit|dc|damage)\b/.test(JSON.stringify(it))).map(it => retainEntry(it.name, section)));
const bound = (current, patch = {}) => compileCreatureTransformationBindings({current, armor: retain, entries: retainNumbers(current), ...patch});
const acPolicy = (...alternatives) => ({mode: "recalculate", alternatives});
const ac = (kind, base, dexterity, shield = 0, extra = {}) => ({kind, base, dexterity, shield, fixed: 0, ...extra});
const target = (id, baseCreature, operations = []) => ({id, label: id, baseCreature, operations});
const stage = (targets, automationInputs, extras = {}) => {
	const resolved = staged();
	return previewCreatureTransformationTargets({targets, resolved, automationInputs, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, ...extras});
};
const save = batch => createCreatureTransformationChanges({batch, targets: batch.targets});
const bugbearEntries = () => [
	entry("Morningstar", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, dice(2, 8))]),
	entry("Javelin", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, dice(2, 6)), ability("damage", 1, "str", 0, 0, dice(1, 6))]),
	retainEntry("Surprise Attack", "trait"),
];
const bugbearBindings = () => ({armor: acPolicy(ac("worn", 12, "capped", 2, {maxDex: 2})), entries: bugbearEntries(), proficiencyBonus: 2});
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

function assertInputRequired (attempt, message) {
	try {
		attempt();
		throw new Error("Binding unexpectedly succeeded.");
	} catch (error) {
		expect(error.code).toBe("CREATURE_TRANSFORMATION_INPUT_REQUIRED");
		expect(error.message).toMatch(message);
	}
}

describe("M2b explicit AC and entry arithmetic foundation", () => {
	it("keeps plate, shields, capped armor and natural AC distinct, without adding DEX blindly", () => {
		expect(bound(source("Knight"), {abilities: {dex: 20}, armor: acPolicy(ac("worn", 18, "none"))})).toEqual([]);
		expect(bound(source("Scout"), {abilities: {dex: 8}, armor: acPolicy(ac("worn", 11, "full"))})).toContainEqual({op: "setArmorClass", value: [{...source("Scout").ac[0], ac: 10}]});
		const elite = source("Drow Elite Warrior");
		const shield = bound(elite, {abilities: {dex: 12}, armor: acPolicy(ac("worn", 12, "full", 2))});
		expect(shield[0].value).toEqual([{ac: 15, from: elite.ac[0].from}]);
		expect(bound(source("Bugbear"), {abilities: {dex: 20}, armor: bugbearBindings().armor})).toEqual([]);
		expect(bound(source("Bugbear"), {abilities: {dex: 8}, armor: bugbearBindings().armor})[0].value[0].ac).toBe(13);
		const dragon = source("Adult Black Dragon");
		expect(bound(dragon, {abilities: {dex: 18}, armor: acPolicy(ac("natural", 17, "full"))})[0].value).toEqual([{ac: 21, from: ["natural armor"]}]);
		expect(bound(dragon, {abilities: {dex: 18}, armor: acPolicy(ac("natural", 19, "none"))})).toEqual([]);
	});

	it("retains conditional alternatives and source-required equipment under recalculation and minimum policies", () => {
		const mage = source("Mage");
		const changed = bound(mage, {abilities: {dex: 18}, armor: acPolicy(ac("unarmored", 10, "full"), ac("natural", 13, "full"))})[0];
		expect(changed.value).toEqual([14, {...mage.ac[1], ac: 17}]);
		expect(Parser.acToFull(changed.value)).toContain("with");
		expect(Parser.acToFull(changed.value)).toContain("mage armor");
		const minimum = bound(mage, {armor: acPolicy(ac("unarmored", 10, "full", 0, {minimum: 16}), retain)})[0];
		expect(minimum.value).toEqual([16, mage.ac[1]]);
		expect(minimum.value[1].condition).toBe(mage.ac[1].condition);
	});

	it("updates only declared hit/damage/DC tokens, preserving poison riders, poison DCs, durations and innate usage", () => {
		const elite = source("Drow Elite Warrior");
		const entries = [
			entry("Shortsword", [ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, dice(1, 6)), fixed("damage", 1, 0, dice(3, 6))]),
			entry("Hand Crossbow", [ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, dice(1, 6)), fixed("dc", 0, 13)]),
			entry("Innate Spellcasting", [ability("dc", 0, "cha", 1, 8)], "spellcasting"),
		];
		const steps = bound(elite, {abilities: {dex: 20, cha: 14}, proficiencyBonus: 3, nextProficiencyBonus: 4, entries});
		const sword = steps.find(it => it.match?.name === "Shortsword");
		expect(sword.entries[0]).toContain("{@hit 9}");
		expect(sword.entries[0]).toContain("8 ({@damage 1d6 + 5})");
		expect(sword.entries[0]).toContain("plus 10 ({@damage 3d6}) poison damage");
		const crossbow = steps.find(it => it.match?.name === "Hand Crossbow");
		expect(crossbow.entries[0]).toBe(elite.action[2].entries[0].replace("{@hit 7}", "{@hit 9}").replace("7 ({@damage 1d6 + 4})", "8 ({@damage 1d6 + 5})"));
		expect(steps.find(it => it.section === "spellcasting").entries[0]).toContain("{@dc 14}");
		expect(elite.spellcasting[0].daily["1e"][2]).toContain("(self only)");
	});

	it("retains non-PB residuals and declared expertise, and handles negative damage modifiers", () => {
		const gladiator = source("Gladiator");
		const steps = bound(gladiator, {
			abilities: {str: 20},
			proficiencyBonus: 1,
			nextProficiencyBonus: 2,
			entries: [
				retainEntry("Spear"),
				entry("Shield Bash", [ability("hit", 0, "str", 2, 1), ability("damage", 0, "str", 0, 0, dice(2, 4)), ability("dc", 0, "str", 2, 9)]),
			],
		});
		// Authored decomposition: hit 7 = STR 4 + 2*PB 1 + residual 1; DC 15 = 4 + 2*1 + 9.
		expect(steps[0].entries[0]).toContain("{@hit 10}");
		expect(steps[0].entries[0]).toContain("{@dc 18}");
		expect(steps[0].entries[0]).toContain("10 ({@damage 2d4 + 5})");
		const low = bound(source("Commoner"), {abilities: {str: 8}, proficiencyBonus: 2, entries: [entry("Club", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, dice(1, 4))])]});
		expect(low[0].entries[0]).toContain("{@hit 1}");
		expect(low[0].entries[0]).toContain("1 ({@damage 1d4 - 1})");
	});

	it("does not rescale source-fixed donor breath values when CON or explicit PB changes", () => {
		const dragon = source("Young Red Dragon");
		const entries = retainNumbers(dragon).filter(it => it.match.name !== "Fire Breath {@recharge 5}");
		entries.push(entry("Fire Breath {@recharge 5}", [fixed("dc", 0, 17), fixed("damage", 0, 0, dice(16, 6))]));
		expect(bound(dragon, {abilities: {con: 30}, proficiencyBonus: 4, nextProficiencyBonus: 8, entries})).toEqual([]);
		expect(dragon.action[3].entries[0]).toContain("56 ({@damage 16d6})");
	});

	it("resolves exact entry sources against the original chassis rather than another source's same-name attack", () => {
		const bugbear = source("Bugbear");
		const current = {...bugbear, source: "HB", action: [...bugbear.action, {...bugbear.action[0], source: "HB"}]};
		const changes = bound(current, {
			abilities: {str: 16},
			chassisSource: "MM",
			proficiencyBonus: 2,
			entries: [...bugbearEntries(), {...retainEntry("Morningstar"), match: {name: "Morningstar", source: "HB"}}],
		});
		expect(changes.find(it => it.match?.name === "Morningstar").match.source).toBe("MM");
		expect(changes.some(it => it.match?.source === "HB")).toBe(false);
		expect(current.action[2].entries).toEqual(bugbear.action[0].entries);
	});

	it.each([
		[{armor: acPolicy()}, /every.*alternative/],
		[{armor: acPolicy(ac("worn", 10, "full"))}, /does not explain/],
		[{armor: acPolicy(ac("worn", 12, "capped", 2))}, /cap/],
		[{entries: []}, /explicit entry binding/],
		[{entries: [entry("Morningstar", []), ...bugbearEntries().slice(1)]}, /numeric bindings/],
		[{entries: [...bugbearEntries(), retainEntry("Missing")]}, /did not match/],
		[{entries: [...bugbearEntries(), retainEntry("Morningstar")]}, /exactly one/],
		[{entries: [entry("Morningstar", [ability("hit", 0, "cha", 1), fixed("damage", 0, 2, dice(2, 8))]), ...bugbearEntries().slice(1)]}, /contributions/],
		[{proficiencyBonus: undefined}, /explicit current PB/],
		[{entries: [entry("Morningstar", [ability("hit", 0, "str", 1), ability("damage", 0, "str", 0, 0, dice(1, 8))]), ...bugbearEntries().slice(1)]}, /dice/],
	])("rejects malformed or ambiguous bindings %# without partial target mutation", (patch, reason) => {
		const current = structuredClone(source("Bugbear"));
		const before = structuredClone(current);
		assertInputRequired(() => compileCreatureTransformationBindings({current, ...bugbearBindings(), ...patch}), reason);
		expect(current).toEqual(before);
	});

	it("fails closed on duplicate identities, custom damage averages/formulas, nested numerics and ambiguous PB notes", () => {
		const bugbear = source("Bugbear");
		for (const [current, reason] of [
			[{...bugbear, action: [...bugbear.action, bugbear.action[0]]}, /ambiguous/],
			[{...bugbear, pbNote: "+3"}, /disagrees/],
			[{...bugbear, pbNote: "+2 in combat"}, /plain numeric/],
			[{...bugbear, action: [{...bugbear.action[0], entries: [bugbear.action[0].entries[0].replace("11 (", "12 (")]}, bugbear.action[1]]}, /matching numeric average/],
			[{...bugbear, action: [{...bugbear.action[0], entries: [bugbear.action[0].entries[0].replace("2d8 + 2", "2d8 + 1d4")]}, bugbear.action[1]]}, /Unsupported damage formula/],
			[{...bugbear, action: [{...bugbear.action[0], entries: [{type: "entries", entries: bugbear.action[0].entries}]}, bugbear.action[1]]}, /nested numerical/],
			[{...bugbear, action: [{...bugbear.action[0], entries: [bugbear.action[0].entries[0].replace("{@damage 2d8 + 2}", "{@damage }")]}, bugbear.action[1]]}, /malformed numeric tags/],
			[{...bugbear, action: [null]}, /entry objects/],
		]) assertInputRequired(() => compileCreatureTransformationBindings({current, ...bugbearBindings()}), reason);
	});
});

describe("actual staged Zombie M2b catalog producer", () => {
	it("compiles source-qualified weapon bindings through the production workflow and renders the changed damage", () => {
		const bugbear = source("Bugbear");
		const batch = stage([target("bear", bugbear)], {bear: {bindings: bugbearBindings()}});
		expect(batch.skipped).toEqual([]);
		const proposed = batch.previews[0].preview.proposed;
		// DMG +1 STR: 15 -> 16. MM weapon hit = STR 3 + PB 2; 2d8+3 mean = 12.
		expect(proposed.str).toBe(16);
		expect(proposed.action[0].entries[0]).toContain("{@hit 5}");
		expect(proposed.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(proposed.action[1].entries[0]).toContain("10 ({@damage 2d6 + 3})");
		expect(proposed.action[1].entries[0]).toContain("6 ({@damage 1d6 + 3})");
		const rendered = Renderer.get().render({type: "entries", ...proposed.action[0]});
		expect(rendered).toContain("2d8 + 3");
		expect(Renderer.stripTags(proposed.action[0].entries[0])).toContain("12 (2d8 + 3)");
		expect(proposed.ac).toEqual(bugbear.ac);
		expect(proposed.attachedItems).toEqual(bugbear.attachedItems);
		expect(proposed.cr).toBe(bugbear.cr);
		expect(proposed.spellcasting).toBeUndefined();
		expect(batch.previews[0].preview.manualReview.some(it => it.field === "ac" || it.field === "attacks")).toBe(false);
	});

	it("updates actual target innate DC headers without changing uses, spell UIDs, or fixed poison DCs", () => {
		const drow = source("Drow");
		const inputs = {bindings: {
			armor: acPolicy(ac("worn", 13, "capped", 0, {maxDex: 2})),
			proficiencyBonus: 2,
			entries: [
				retainEntry("Shortsword"), retainEntry("Hand Crossbow"),
				entry("Innate Spellcasting", [ability("dc", 0, "cha", 1, 8)], "spellcasting"),
			],
		}};
		const batch = stage([target("drow", drow)], {drow: inputs});
		expect(batch.skipped).toEqual([]);
		const proposed = batch.previews[0].preview.proposed;
		expect(proposed.cha).toBe(8);
		expect(proposed.spellcasting[0]).toEqual({...drow.spellcasting[0], headerEntries: [drow.spellcasting[0].headerEntries[0].replace("{@dc 11}", "{@dc 9}")]});
		const html = Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), proposed)[0].rendered;
		expect(html.replace(/<[^>]+>/g, "")).toContain("DC 9");
		expect(html).toContain("1/day each");
		expect(html).toContain("no material components");
		expect(proposed.action).toEqual(drow.action);
	});

	it("uses actual prior history, isolates bulk targets, and freezes replay/removal in both operation consumers", () => {
		const bugbear = source("Bugbear");
		const prior = [{id: "prior",
			type: "patch",
			data: {patch: {set: {
				str: 17, action: bugbear.action.map(action => ({...action, entries: action.entries.map(text => text.replace("{@hit 4}", "{@hit 5}").replaceAll("2d8 + 2", "2d8 + 3").replaceAll("11 (", "12 (").replace("9 ({@damage 2d6 + 2})", "10 ({@damage 2d6 + 3})").replace("5 ({@damage 1d6 + 2})", "6 ({@damage 1d6 + 3})"))})),
			}}}}];
		const targets = [target("prior", bugbear, prior), target("plain", bugbear)];
		const inputs = {prior: {bindings: bugbearBindings()}, plain: {bindings: bugbearBindings()}};
		const batch = stage(targets, inputs);
		expect(batch.skipped).toEqual([]);
		const expected = batch.previews.map(it => it.preview.proposed);
		expect(expected[0].action[0].entries[0]).toContain("13 ({@damage 2d8 + 4})");
		expect(expected[1].action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		const edits = save(batch).map((edit, ix) => ({...edit, addOperations: edit.addOperations.map(op => ({...op, id: `m2b-${ix}`}))}));
		const operations = JSON.parse(JSON.stringify([...prior, ...edits[0].addOperations]));
		expect(operations[1].data.resolved).not.toHaveProperty("automation");
		expect(JSON.stringify(operations[1])).not.toContain("\"numbers\"");
		inputs.prior.bindings.entries[0].numbers[0].ability = "dex";
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: bugbear, operations})).toEqual(expected[0]);
		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({creature: bugbear, operation: prior[0]});
		const id = registry.addOperation({creature: bugbear, operation: operations[1]});
		expect(registry.getCreature({creature: bugbear})).toEqual(expected[0]);
		registry.removeOperation({creature: bugbear, operationId: id});
		expect(registry.getCreature({creature: bugbear})).toEqual(BestiaryQuickActionsUtil.applyOperations({baseCreature: bugbear, operations: prior}));
		let state = EncounterWorkspaceState.validate({
			version: 6,
			sourceList: {name: "Bindings", saveId: "bindings"},
			instances: targets.map(it => ({id: it.id, hash: "bugbear_mm", monster: bugbear, hp: {current: 27, max: 27, temp: 0}, initiative: 1, conditions: [], areaNotes: [], modifiers: [], statblockOperations: it.operations})),
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
		expect(removed.instances[1].statblockOperations).toEqual([]);
		expect(getEncounterEffectiveMonster(removed.instances[1])).toEqual(bugbear);
		operations[1].data.resolved.changes.find(it => it.type === "setEntryNumbers").entries[0] += " changed";
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: bugbear, operations})).toThrow(/changed/i);
	});

	it("withholds the entire dependent group on an entry conflict and rejects mixed numeric winners", () => {
		const original = source("Bugbear");
		const current = structuredClone(original);
		const concrete = compileCreatureTransformation({resolved: staged(), current, inputs: {bindings: bugbearBindings()}});
		const options = {original,
			current,
			resolved: normalizeCreatureTransformation(concrete),
			acknowledgedPrerequisites: concrete.prerequisites,
			dmApproved: true,
			priorWrites: [
				{path: "str", after: current.str, operationId: "prior"},
				{path: "action:morningstar|mm", after: current.action[0], operationId: "prior"},
			]};
		const pending = BestiaryCreatureTransformation.preview(options);
		expect(pending.conflicts.map(it => it.path)).toEqual(["str", "action:morningstar|mm"]);
		expect(pending.proposed.str).toBe(current.str);
		expect(pending.proposed.hp).toEqual(current.hp);
		expect(pending.proposed.action).toEqual(current.action);
		const incoming = BestiaryCreatureTransformation.preview({...options, conflictDecisions: {str: "incoming", "action:morningstar|mm": "incoming"}});
		expect(incoming.proposed.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		const retained = BestiaryCreatureTransformation.preview({...options, conflictDecisions: {str: "existing", "action:morningstar|mm": "existing"}});
		expect(retained.proposed.action).toEqual(current.action);
		expect(retained.proposed.con).toBe(current.con);
		assertInputRequired(() => BestiaryCreatureTransformation.preview({...options, conflictDecisions: {str: "incoming", "action:morningstar|mm": "existing"}}), /one conflict winner/);
	});

	it("skips malformed bindings without partial operations, and fences changed answers/history, consent and storage", () => {
		const current = source("Bugbear");
		const targets = [target("bad", current), target("good", current)];
		const inputs = {bad: {bindings: {...bugbearBindings(), entries: []}}, good: {bindings: bugbearBindings()}};
		const batch = stage(targets, inputs);
		expect(batch.skipped).toEqual([expect.objectContaining({id: "bad", reason: expect.stringMatching(/explicit entry binding/)})]);
		expect(save(batch).map(it => it.id)).toEqual(["good"]);
		const changed = structuredClone(inputs);
		changed.good.bindings.entries[0] = retainEntry("Morningstar");
		expect(() => createCreatureTransformationChanges({batch, targets, automationInputs: changed})).toThrow(/stale/i);
		const sameOutput = structuredClone(inputs);
		sameOutput.good.bindings.armor = retain;
		expect(() => createCreatureTransformationChanges({batch, targets, automationInputs: sameOutput})).toThrow(/stale.*input/i);
		expect(() => createCreatureTransformationChanges({batch, targets: [target("bad", current), target("good", current, [{id: "changed"}])]})).toThrow(/stale/i);
		expect(stage([target("good", current)], {good: inputs.good}, {dmApproved: false}).previews).toEqual([]);
		const capped = stage([target("good", current)], {good: inputs.good}, {validateOperation: () => { throw new Error("Storage limit"); }});
		expect(capped.skipped[0].reason).toMatch(/Storage limit/);
		const legacy = resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:zombie|dmg"});
		expect(legacy).not.toHaveProperty("version");
		expect(legacy.changes.some(it => it.op === "setEntryNumbers")).toBe(false);
	});
});

describe("complete innate spell API and concrete setters (not a catalog spell producer)", () => {
	const profile = () => ({
		name: "Bound Innate Magic",
		source: "MM",
		ability: "cha",
		dcFixed: 8,
		attackFixed: 0,
		components: ["V", "S"],
		spells: [
			{spell: "dancing lights|PHB", usage: "will"},
			{spell: "darkness|PHB", usage: "daily", uses: 1, each: true},
			{spell: "faerie fire|PHB", usage: "daily", uses: 1, each: true},
			{spell: "levitate|PHB", usage: "daily", uses: 1, each: true, restriction: "selfOnly"},
		],
	});
	const innate = (spellcasting = profile()) => compileCreatureTransformationInnateSpellcasting({current: source("Drow Elite Warrior"), proficiencyBonus: 3, spellcasting});
	const foundationOptions = (steps, current = source("Drow Elite Warrior")) => {
		// Setter/replay fixture only: Zombie does not author these spell/AC/ability grants.
		const concrete = compileCreatureTransformation({resolved: staged(), current});
		concrete.selectedOptions["automation-bindings"] = ["zombie-dmg-m2b"];
		concrete.changes.push(...steps);
		return {original: current, current, resolved: normalizeCreatureTransformation(concrete), acknowledgedPrerequisites: concrete.prerequisites, dmApproved: true};
	};

	it("produces real ability/DC/attack, innate uses/components and self-only restrictions without Species placeholders", () => {
		const step = innate();
		expect(step).toMatchObject({ability: "cha", saveDc: 12, attackBonus: 4, components: ["V", "S"]});
		const entry = getCreatureTransformationInnateSpellcastingEntry(step);
		expect(entry.daily).toEqual({"1e": source("Drow Elite Warrior").spellcasting[0].daily["1e"].map(it => it.replace(/}/g, "|PHB}"))});
		expect(entry.headerEntries[0]).toContain("Charisma");
		expect(entry.headerEntries[0]).toContain("{@dc 12}, {@hit 4}");
		expect(entry.headerEntries[0]).toContain("no material components");
		const options = foundationOptions([step]);
		const preview = BestiaryCreatureTransformation.preview(options);
		const html = Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), preview.proposed).find(it => it.name === step.name).rendered;
		for (const text of ["DC 12", "1/day each", "self only", "no material components"]) expect(html.replace(/<[^>]+>/g, "")).toContain(text);
		expect(html).not.toContain("DM determines");
		expect(preview.proposed.spellcasting[0]).toEqual(options.current.spellcasting[0]);
		const operation = JSON.parse(JSON.stringify(BestiaryCreatureTransformation.createOperation({preview, currentPreview: preview})));
		step.saveDc = 99;
		expect(BestiaryCreatureTransformation.replay({creature: options.current, baseCreature: options.current, operation}).creature.spellcasting).toEqual(preview.proposed.spellcasting);
		const registry = new BestiaryQuickActionsRegistry();
		const id = registry.addOperation({creature: options.current, operation});
		expect(registry.getCreature({creature: options.current}).spellcasting).toEqual(preview.proposed.spellcasting);
		registry.removeOperation({creature: options.current, operationId: id});
		expect(registry.getCreature({creature: options.current})).toEqual(options.current);
	});

	it("preserves edition-qualified UIDs, shared daily/rest pools and prepared slots while supporting no-component casting", () => {
		const spellcasting = {...profile(),
			source: "XMM",
			components: [],
			spells: [
				{spell: "dancing lights|XPHB", usage: "will"},
				{spell: "darkness|XPHB", usage: "daily", uses: 2, each: false},
				{spell: "faerie fire|XPHB", usage: "daily", uses: 2, each: false},
				{spell: "levitate|XPHB", usage: "rest", uses: 1, each: true, restriction: "selfOnly"},
			]};
		const step = innate(spellcasting);
		const options = foundationOptions([step], source("Mage"));
		const proposed = BestiaryCreatureTransformation.preview(options).proposed;
		expect(proposed.spellcasting[0]).toEqual(source("Mage").spellcasting[0]);
		const added = proposed.spellcasting[1];
		expect(added.source).toBe("XMM");
		expect(added.will).toEqual(["{@spell dancing lights|XPHB}"]);
		expect(added.daily).toEqual({"2": ["{@spell darkness|XPHB}", "{@spell faerie fire|XPHB}"]});
		expect(added.rest).toEqual({"1e": ["{@spell levitate|XPHB} (self only)"]});
		const html = Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), proposed)[1].rendered;
		expect(html).toContain("2/day");
		expect(html).toContain("1/rest each");
		expect(html).toContain("no components");
	});

	it("calculates declared innate ability/PB/fixed contributions rather than borrowing a donor's DC", () => {
		const step = compileCreatureTransformationInnateSpellcasting({
			current: source("Drow Elite Warrior"),
			abilities: {cha: 18},
			proficiencyBonus: 3,
			nextProficiencyBonus: 4,
			spellcasting: {...profile(), dcFixed: 9, attackFixed: 1, components: ["V", "S", "M"]},
		});
		expect(step.saveDc).toBe(17);
		expect(step.attackBonus).toBe(9);
		expect(getCreatureTransformationInnateSpellcastingEntry(step).headerEntries[0]).toContain("verbal and somatic and material components");
		assertInputRequired(() => getCreatureTransformationInnateSpellcastingEntry({...step, saveDc: null}), /validated concrete/);
	});

	it("applies AC and entry setters without dropping metadata and groups them with ability/PB dependencies", () => {
		const current = {...source("Mage"), action: source("Mage").action.map(it => ({...it, id: "preserved-id"}))};
		const steps = compileCreatureTransformationStats({current, abilities: {dex: 18}});
		const bindings = bound(current, {abilities: {dex: 18},
			proficiencyBonus: 3,
			armor: acPolicy(ac("unarmored", 10, "full"), ac("natural", 13, "full")),
			entries: [
				entry("Dagger", [ability("hit", 0, "dex", 1), ability("damage", 0, "dex", 0, 0, dice(1, 4))]), retainEntry("Spellcasting", "spellcasting"),
			]});
		const options = foundationOptions([...steps, ...bindings], current);
		const preview = BestiaryCreatureTransformation.preview(options);
		expect(preview.proposed.ac).toEqual([14, {...current.ac[1], ac: 17}]);
		expect(preview.proposed.action[0].id).toBe("preserved-id");
		expect(preview.proposed.action[0].entries[0]).toContain("6 ({@damage 1d4 + 4})");
		expect(preview.writes).toContainEqual(expect.objectContaining({path: "ac"}));
		const priorWrites = [{path: "ac", after: current.ac, operationId: "prior"}];
		const kept = BestiaryCreatureTransformation.preview({...options, priorWrites, conflictDecisions: {ac: "existing"}});
		expect(kept.proposed.dex).toBe(current.dex);
		expect(kept.proposed.action).toEqual(current.action);
	});

	it.each([
		[{ability: undefined}, /supported ability/],
		[{components: undefined}, /concrete ability/],
		[{components: ["verbal"]}, /component/],
		[{spells: [{spell: "darkness", usage: "will"}]}, /source-qualified/],
		[{spells: [{spell: "darkness|PHB", usage: "daily"}]}, /uses/],
		[{spells: [{spell: "darkness|PHB", usage: "known"}]}, /uses/],
		[{spells: [{spell: "darkness|PHB", usage: "daily", uses: 1, each: true, restriction: "DM decides"}]}, /component/],
	])("rejects incomplete or unsupported innate profiles %# precisely", (patch, reason) => {
		assertInputRequired(() => innate({...profile(), ...patch}), reason);
	});

	it("keeps the v2 schema/runtime setters strict and rejects them in default recipes, legacy snapshots and M1", () => {
		const schema = JSON.parse(fs.readFileSync("schema/site/creature-transformation.json", "utf8"));
		const validate = new Ajv().compile({$defs: schema.$defs, $ref: "#/$defs/bindingChange"});
		const steps = [{op: "setArmorClass", value: source("Mage").ac}, {op: "setEntryNumbers", section: "action", match: {name: "Dagger", source: "MM"}, entries: source("Mage").action[0].entries}, innate()];
		for (const step of steps) {
			expect(validate(step)).toBe(true);
			expect(isCreatureTransformationBindingChange(step)).toBe(true);
			expect(validate({...step, path: "arbitrary.path"})).toBe(false);
			expect(isCreatureTransformationBindingChange({...step, path: "arbitrary.path"})).toBe(false);
			const recipe = structuredClone(catalog);
			recipe.creatureTransformation[0].changes.push(step);
			expect(() => getCreatureTransformationCandidates({catalog: recipe, races: []})).toThrow(/Invalid transformation change/);
		}
		const options = foundationOptions([innate()]);
		const legacy = {...options.resolved};
		delete legacy.version;
		expect(() => BestiaryCreatureTransformation.preview({...options, resolved: legacy})).toThrow(/version-2/);
		const m1 = compileCreatureTransformation({resolved: resolveCreatureTransformation({candidates: getCreatureTransformationCandidates({catalog, races: []}), id: "catalog:dracolich|mm", automationVersion: 2}), current: source("Adult Black Dragon"), inputs: {age: "adult", trueDragon: true, shadowDragon: false, physiology: "amphibious-only", lairActions: "retain"}});
		m1.changes.push(innate());
		expect(() => normalizeCreatureTransformation(m1)).toThrow(/version-2/);
		const invalid = innate();
		invalid.spells.push({...invalid.spells[0]});
		expect(isCreatureTransformationBindingChange(invalid)).toBe(false);
	});
});
