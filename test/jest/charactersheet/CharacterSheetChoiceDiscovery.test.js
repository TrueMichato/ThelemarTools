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
			skillToolLanguageProficiencies: [{from: ["anySkill", "anyTool"], count: 1}],
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
			"skillTool", "cantrip", "entity",
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

	it("discovers the reviewed real-data prose families and named entities", () => {
		const read = file => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
		const tgtt = read("homebrew/TravelersGuidetoThelemar.json");
		const classes = fs.readdirSync(path.resolve(process.cwd(), "data/class"))
			.filter(file => /^class-.*\.json$/.test(file))
			.flatMap(file => {
				const parsed = read(`data/class/${file}`);
				return [...(parsed.class || []), ...(parsed.subclass || []), ...(parsed.classFeature || []), ...(parsed.subclassFeature || [])];
			});
		const allClassFeatures = [...classes, ...(tgtt.classFeature || []), ...(tgtt.subclassFeature || [])];
		const rogueSpecialties = (tgtt.classFeature || []).filter(it =>
			it.name === "Specialties" && it.className === "Rogue" && it.classSource === "TGTT");
		expect(rogueSpecialties.map(it => it.level)).toEqual(expect.arrayContaining([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]));
		const extraSkillTraining = (tgtt.classFeature || []).find(it => it.name === "Extra Skill Training");
		const arcaneArcherLore = (tgtt.subclassFeature || []).find(it => it.name === "Arcane Archer Lore");
		const thaumaturge = allClassFeatures.find(it => it.name === "Thaumaturge" && it.className === "Cleric");
		const lessons = read("data/optionalfeatures.json").optionalfeature.find(it => it.name === "Lessons of the First Ones");
		expect(extraSkillTraining).toBeTruthy();
		expect(arcaneArcherLore).toBeTruthy();
		expect(thaumaturge).toBeTruthy();
		expect(lessons).toBeTruthy();

		const extraDescriptors = CharacterSheetClassUtils.getChoiceDescriptors(extraSkillTraining);
		expect(extraDescriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({kind: "skillTool", count: 1}),
		]));
		const recurringSpecialtyDescriptors = CharacterSheetProgression._getEntityChoiceDescriptors(
			rogueSpecialties.find(it => it.level === 3),
			{classFeatures: allClassFeatures},
		);
		expect(recurringSpecialtyDescriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: "entity",
				options: expect.arrayContaining([
					expect.objectContaining({name: expect.any(String)}),
				]),
			}),
		]));
		const loreKinds = CharacterSheetClassUtils.getChoiceDescriptors(arcaneArcherLore).map(it => it.kind);
		expect(loreKinds).toEqual(expect.arrayContaining(["skill", "cantrip"]));
		expect(CharacterSheetClassUtils.getChoiceDescriptors(thaumaturge).some(it =>
			it.kind === "cantrip" && it.rules.optionSource?.kind === "filter",
		)).toBe(true);
		const featDescriptors = CharacterSheetClassUtils.getChoiceDescriptors(lessons, {
			feats: read("data/feats.json").feat,
		});
		expect(featDescriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({kind: "feat", label: "Origin Feat"}),
		]));
	});

	it("runs a complete production census and protects the real discovery path", () => {
		const classDir = path.resolve(process.cwd(), "data/class");
		const files = fs.readdirSync(classDir).filter(file => /^class-.*\.json$/.test(file));
		const entities = files.flatMap(file => {
			const parsed = JSON.parse(fs.readFileSync(path.join(classDir, file), "utf8"));
			return [...(parsed.class || []), ...(parsed.subclass || []), ...(parsed.classFeature || []), ...(parsed.subclassFeature || [])];
		});
		const catalogFiles = [
			"data/optionalfeatures.json",
			"data/feats.json",
			"data/races.json",
			"data/backgrounds.json",
			"homebrew/TravelersGuidetoThelemar.json",
		];
		const catalogEntities = catalogFiles.flatMap(file => {
			const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
			return Object.values(parsed).flatMap(value => Array.isArray(value) ? value : []);
		});
		const productionCensus = CharacterSheetClassUtils.getChoiceDescriptorCensus([...entities, ...catalogEntities]);
		expect(productionCensus.total).toBeGreaterThan(0);
		expect(productionCensus.supported).toBeGreaterThan(0);
		expect(productionCensus.entries.filter(entry =>
			entry.classification === "unclassified" && entry.required !== false,
		)).toEqual([]);

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
