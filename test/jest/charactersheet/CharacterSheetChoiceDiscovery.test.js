import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;

describe("Character Sheet choice discovery contract", () => {
	it("normalizes union, ability, proficiency, and spell choice shapes", () => {
		const entity = {
			name: "Nested Example",
			skillProficiencies: [{choose: {from: ["arcana", "history"], count: 1}}],
			toolProficiencies: [{choose: {from: ["thieves' tools", "smith's tools"], count: 1}}],
			ability: [{choose: {from: ["int", "wis"], count: 1}}],
			additionalSpells: [{
				level: 0,
				choose: {from: [{name: "Guidance", source: "XPHB"}]},
			}],
			entries: [{
				type: "options",
				name: "Specialty",
				count: 1,
				entries: [
					{type: "refClassFeature", classFeature: "Arcane Shot|Rogue|XPHB|1"},
					{type: "refClassFeature", classFeature: "Battle Tactics|Rogue|XPHB|1"},
				],
			}],
		};
		const descriptors = CharacterSheetClassUtils.getChoiceDescriptors(entity);
		expect(descriptors.map(it => it.kind)).toEqual(expect.arrayContaining([
			"skill", "tool", "cantrip", "entity",
		]));
		expect(descriptors.every(it => it.grantKey && it.sourcePath && it.rules)).toBe(true);
	});

	it("recognizes direct spellcasting ability arrays and weighted origin abilities", () => {
		const race = {
			name: "Aarakocra",
			source: "MPMM",
			additionalSpells: [{
				innate: {"3": ["gust of wind"]},
				ability: {choose: ["int", "wis", "cha"]},
			}],
			ability: [{
				choose: {
					weighted: {
						from: ["str", "dex", "con"],
						weights: [2, 1],
					},
				},
			}],
		};
		const descriptors = CharacterSheetClassUtils.getChoiceDescriptors(race, {sourcePath: "race"});
		expect(descriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: "ability",
				sourcePath: "race.additionalSpells[0].ability",
				options: ["int", "wis", "cha"],
			}),
			expect.objectContaining({
				kind: "ability",
				sourcePath: "race.ability[0]",
				options: ["str", "dex", "con"],
			}),
		]));
	});

	it("censuses required choices and reports unclassified choose payloads", () => {
		const census = CharacterSheetClassUtils.getChoiceDescriptorCensus([
			{name: "Supported", entries: [{type: "options", entries: [{name: "One"}]}]},
			{name: "Supported Spell", additionalSpells: [{choose: {from: "class"}}]},
			{name: "Unsupported", choose: "free-form prose"},
			{name: "Optional Unsupported", required: false, choose: "optional prose"},
			{name: "Runtime", runtime: true},
		]);
		expect(census.total).toBeGreaterThanOrEqual(4);
		expect(census.supported).toBeGreaterThan(0);
		expect(census.runtime).toBeGreaterThan(0);
		expect(census.unclassified).toBeGreaterThan(0);
		expect(census.entries.find(entry => entry.path.endsWith("Optional Unsupported"))).toMatchObject({required: false});
	});

	it("keeps the adapter registry closed over editors and reversible mechanics", () => {
		expect(CharacterSheetProgression.getAdapterClosureIssues()).toEqual([]);
	});

	it("runs the census against production class data and protects the real discovery path", () => {
		const classDir = path.resolve(process.cwd(), "data/class");
		const files = fs.readdirSync(classDir).filter(file => /^class-.*\.json$/.test(file)).slice(0, 4);
		const entities = files.flatMap(file => {
			const parsed = JSON.parse(fs.readFileSync(path.join(classDir, file), "utf8"));
			return [...(parsed.class || []), ...(parsed.subclass || []), ...(parsed.classFeature || [])];
		});
		const productionCensus = CharacterSheetClassUtils.getChoiceDescriptorCensus(entities);
		expect(productionCensus.total).toBeGreaterThan(0);
		expect(productionCensus.supported).toBeGreaterThan(0);

		const entity = {
			name: "Production-path negative control",
			skillProficiencies: [{choose: {from: ["arcana"], count: 1}}],
		};
		const original = CharacterSheetClassUtils.getChoiceDescriptors;
		try {
			CharacterSheetClassUtils.getChoiceDescriptors = () => [];
			const broken = CharacterSheetClassUtils.getChoiceDescriptorCensus([entity]);
			expect(broken.unclassified).toBeGreaterThan(0);
		} finally {
			CharacterSheetClassUtils.getChoiceDescriptors = original;
		}
		expect(CharacterSheetClassUtils.getChoiceDescriptorCensus([entity]).supported).toBeGreaterThan(0);
	});
});
