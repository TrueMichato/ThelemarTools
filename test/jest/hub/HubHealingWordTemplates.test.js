import crypto from "node:crypto";
import fs from "node:fs";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";
import {resolveReviewedMultiTargetSpell} from "../../../js/hub/hub-multi-target-operations.js";

const registry = createSemanticOperationRegistry();
const SEED = "a".repeat(64);
const cases = [
	["Healing Word", "PHB", 1, level => level],
	["Healing Word", "XPHB", 1, level => 2 * level],
	["Mass Healing Word", "PHB", 3, level => level - 2],
	["Mass Healing Word", "XPHB", 3, level => level - 1],
];

function args ({name, source, level, castLevel = level, count = 1}) {
	const targetCharacters = Array.from({length: count}, (_, index) => ({id: `target-${index}`, targetRef: `ref-${index}`, data: {hp: {current: 5, max: 100}}}));
	return {
		sourceCharacter: {
			id: "source",
			data: {
				abilities: {wis: 16},
				classes: [{name: "Cleric", source, level: 17, spellcastingAbility: "wis"}],
				spellcasting: {
					spellsKnown: [{name, source, level, prepared: true, sourceClass: "Cleric"}],
					spellSlots: {[castLevel]: {current: 1, max: 1}},
				},
			},
		},
		sourceEntity: {type: "spell", uid: `${name}|${source}`.toLowerCase(), version: source === "PHB" ? "phb-2014-v1" : "xphb-2024-v1"},
		effectTemplateId: level === 1 ? "spell.healing-word.heal" : "spell.mass-healing-word.heal",
		choice: {castLevel},
		operationId: crypto.randomUUID(),
		effectResolutionSeed: SEED,
		targetCharacter: targetCharacters[0],
		targetRef: targetCharacters[0].targetRef,
		targetCharacters,
		targetRefs: targetCharacters.map(target => target.targetRef),
		targetProfiles: targetCharacters.map(() => ({data: {identity: {name: "Twin"}}})),
	};
}

function expectedRoll (count) {
	return Array.from({length: count}, (_, index) => crypto.createHash("sha256").update(`${SEED}:${index}`).digest().readUInt32BE(0) % 4 + 1)
		.reduce((sum, roll) => sum + roll, 3);
}

describe("Reviewed Healing Word production templates", () => {
	it.each(cases)("%s %s matches exact checked-in base/upcast data at every standard slot level", (name, source, level, diceCount) => {
		const data = JSON.parse(fs.readFileSync(`data/spells/spells-${source.toLowerCase()}.json`, "utf8")).spell;
		const spell = data.find(entry => entry.name === name && entry.source === source);
		expect(spell.level).toBe(level);
		expect(spell.range).toEqual({type: "point", distance: {type: "feet", amount: 60}});
		expect(spell.time).toEqual([{number: 1, unit: "bonus"}]);
		expect(spell.components).toEqual({v: true});
		expect(JSON.stringify(spell.entries)).toContain(`{@dice ${diceCount(level)}d4}`);
		expect(JSON.stringify(spell.entriesHigherLevel)).toContain(`|${level}-9|${diceCount(level + 1) - diceCount(level)}d4}`);
		for (let castLevel = level; castLevel <= 9; ++castLevel) {
			const options = args({name, source, level, castLevel, count: level === 3 ? 6 : 1});
			const derived = level === 3 ? registry.deriveMultiTarget(options) : registry.derive(options);
			expect(derived.sourceCost).toEqual({version: 1, components: [{kind: "spell_slot", pool: "standard", level: castLevel, amount: 1}]});
			const operations = derived.targets?.map(target => target.operation) || [derived.operation];
			expect(operations.map(operation => operation.arguments.amount)).toEqual(operations.map(() => expectedRoll(diceCount(castLevel))));
			expect(options.sourceCharacter.data.spellcasting.spellSlots[castLevel].current).toBe(1);
			expect(registry.getTemplate(options).display.tableRules).toMatch(/not checked by the server/i);
			if (level === 3) expect(derived.allowTargetNoOp).toBe(true);
		}
	});

	it.each(cases)("%s %s fails closed for malformed choices, edition, preparation, acquisition, seed and slots", (name, source, level) => {
		const derive = options => level === 3 ? registry.deriveMultiTarget(options) : registry.derive(options);
		for (const mutate of [
			options => { options.choice = {castLevel: 0}; },
			options => { options.choice = {castLevel: 10}; },
			options => { options.choice = {castLevel: 1.5}; },
			options => { options.choice.amount = 100; },
			options => { options.choice.pool = "pact"; },
			options => { options.sourceEntity.version = "wrong"; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].source = "TST"; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].prepared = false; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].sourceClass = "Missing"; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].sourceItem = "Staff"; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].isInnate = true; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown[0].level = 0; },
			options => { options.sourceCharacter.data.spellcasting.spellsKnown.push({...options.sourceCharacter.data.spellcasting.spellsKnown[0]}); },
			options => { options.sourceCharacter.data.spellcasting.spellSlots[level].current = 0; },
			options => { options.effectResolutionSeed = null; },
		]) {
			const options = args({name, source, level});
			mutate(options);
			expect(() => derive(options)).toThrow();
		}
	});

	it.each(["PHB", "XPHB"])("Mass Healing Word %s permits six, rejects seven/eight, under-level and singular routes", source => {
		for (const count of [1, 6]) expect(registry.deriveMultiTarget(args({name: "Mass Healing Word", source, level: 3, count})).targets).toHaveLength(count);
		for (const count of [0, 7, 8]) expect(() => registry.deriveMultiTarget(args({name: "Mass Healing Word", source, level: 3, count}))).toThrow();
		expect(() => registry.deriveMultiTarget(args({name: "Mass Healing Word", source, level: 3, castLevel: 2}))).toThrow();
		expect(() => registry.derive(args({name: "Mass Healing Word", source, level: 3}))).toThrow();
	});

	it.each(cases)("%s %s applies the A5 selected-dice floor after a negative modifier, at base and upcast", (name, source, level, diceCount) => {
		for (const castLevel of [level, level + 1]) {
			for (const wisdom of [1, 8]) {
				const options = args({name, source, level, castLevel});
				options.effectResolutionSeed = `${"0".repeat(60)}0319`;
				options.sourceCharacter.data.abilities.wis = wisdom;
				const derived = level === 3 ? registry.deriveMultiTarget(options) : registry.derive(options);
				const operation = derived.targets?.[0].operation || derived.operation;
				expect(operation.arguments.amount).toBe(diceCount(castLevel));
				expect(options.sourceCharacter.data.spellcasting.spellSlots[castLevel].current).toBe(1);
			}
		}
	});

	it.each(cases)("%s %s still subtracts negative modifiers when the roll stays above the dice floor", (name, source, level, diceCount) => {
		const options = args({name, source, level, castLevel: level + 1});
		options.sourceCharacter.data.abilities.wis = 8;
		const derived = level === 3 ? registry.deriveMultiTarget(options) : registry.derive(options);
		const operation = derived.targets?.[0].operation || derived.operation;
		const count = diceCount(level + 1);
		const expected = expectedRoll(count) - 4;
		expect(expected).toBeGreaterThan(count);
		expect(operation.arguments.amount).toBe(expected);
	});

	it.each(["PHB", "XPHB"])("resolves only the exact %s production multi spell and standard casting shape", source => {
		const options = {spell: {name: "Mass Healing Word", source, level: 3}, selectedSlot: {level: 3}};
		expect(resolveReviewedMultiTargetSpell(options)).toMatchObject({
			sourceEntity: {type: "spell", uid: `mass healing word|${source.toLowerCase()}`},
			effectTemplateId: "spell.mass-healing-word.heal",
			choice: {castLevel: 3},
			maxTargets: 6,
		});
		for (const invalid of [
			{...options, spell: {...options.spell, source: "TST"}},
			{...options, spell: {...options.spell, level: 1}},
			{...options, spell: {...options.spell, name: "Healing Word"}},
			{...options, selectedSlot: {level: 2}},
			{...options, selectedSlot: {level: 10}},
			{...options, selectedSlot: {level: 3, isPact: true}},
			{...options, selectedSlot: {level: 3, isNoSlotResource: true}},
			{...options, selectedSlot: {level: 3, isWizardCapstone: true}},
			{...options, hasMetamagic: true},
			{...options, hasVariantComponent: true},
		]) expect(resolveReviewedMultiTargetSpell(invalid)).toBeNull();
	});
});
