import "./setup.js";
import {jest} from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

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
		// The production closure must inspect the actual controller/state
		// prototypes, not accept an unavailable-prototype bypass.
		expect(CharacterSheetProgression.getAdapterClosureIssues()).toEqual([]);
	});

	it("dispatches every registered mechanics family through its concrete path", () => {
		const respec = Object.create(globalThis.CharacterSheetRespec.prototype);
		const applyCases = [
			["class", "class", "_applyDecisionMechanicsClass"],
			["skills", "nestedSkill", "_applyDecisionMechanicsProficiencies"],
			["spells", "nestedCantrip", "_applyDecisionMechanicsSpells"],
			["improvement", "feat", "_applyDecisionMechanicsImprovement"],
			["features", "featureChoice", "_applyDecisionMechanicsFeatures"],
			["origin", "originRace", "_applyDecisionMechanicsOrigin"],
			["configuration", "nestedConfiguration", "_applyDecisionMechanicsConfiguration"],
		];
		for (const [family, type, method] of applyCases) {
			const spy = jest.fn();
			respec[method] = spy;
			respec._applyManifestSelectionMechanics(
				{type, semanticKey: `test:${type}`, meta: {}},
				["selection"],
				[],
				{},
			);
			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({type}),
				["selection"],
				[],
				{},
			);
			expect(CharacterSheetProgression.DECISION_ADAPTERS[type].mechanics).toBeTruthy();
			expect(family).toBeTruthy();
		}

		const state = Object.create(globalThis.CharacterSheetState.prototype);
		const reverseCases = [
			["class", "class", "reverseProgressionClassReceipt"],
			["proficiencies", "nestedSkill", "reverseProgressionProficiencyReceipt"],
			["spells", "nestedCantrip", "reverseProgressionSpellReceipt"],
			["improvement", "feat", "reverseProgressionImprovementReceipt"],
			["features", "featureChoice", "reverseProgressionFeatureReceipt"],
			["origin", "originBackground", "reverseProgressionOriginReceipt"],
			["configuration", "nestedConfiguration", "reverseProgressionConfigurationReceipt"],
		];
		for (const [family, type, method] of reverseCases) {
			const spy = jest.fn(() => true);
			state._reverseProgressionDecisionReceiptInner = spy;
			expect(state[method]({type, semanticKey: `test:${type}`})).toBe(true);
			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({type}),
				family,
			);
		}

		const engine = Object.create(globalThis.CharacterSheetRespecEngine.prototype);
		const reverseSpy = jest.fn(() => true);
		engine._candidateState = {
			reverseProgressionFeatureReceipt: reverseSpy,
			reverseProgressionDecisionReceipt: jest.fn(),
		};
		engine._reverseDecisionReceipt({type: "featureChoice"});
		expect(reverseSpy).toHaveBeenCalledTimes(1);

		const respecProto = globalThis.CharacterSheetRespec.prototype;
		const stateProto = globalThis.CharacterSheetState.prototype;
		const savedApply = respecProto._applyDecisionMechanicsClass;
		const savedReverse = stateProto.reverseProgressionClassReceipt;
		try {
			respecProto._applyDecisionMechanicsClass = undefined;
			stateProto.reverseProgressionClassReceipt = undefined;
			const issues = CharacterSheetProgression.getAdapterClosureIssues();
			expect(issues).toEqual(expect.arrayContaining([
				expect.objectContaining({code: "adapter-missing-apply", type: "class"}),
				expect.objectContaining({code: "adapter-missing-reverse", type: "class"}),
			]));
		} finally {
			respecProto._applyDecisionMechanicsClass = savedApply;
			stateProto.reverseProgressionClassReceipt = savedReverse;
		}
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
		expect(extraDescriptors.flatMap(it => it.options || []))
			.not.toContainEqual(expect.objectContaining({value: "anyTool"}));
		const recurringSpecialtyDescriptors = CharacterSheetProgression._getEntityChoiceDescriptors(
			rogueSpecialties.find(it => it.level === 3),
			{classFeatures: allClassFeatures},
		);
		const filteredSpecialties = recurringSpecialtyDescriptors.map(descriptor =>
			CharacterSheetProgression._filterDescriptorOptionsForLevel(descriptor, 3),
		);
		expect(filteredSpecialties).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: "entity",
				options: expect.arrayContaining([
					expect.objectContaining({name: expect.any(String)}),
				]),
			}),
		]));
		expect(filteredSpecialties.find(it => it.kind === "entity")?.options || [])
			.not.toEqual(expect.arrayContaining([
				expect.objectContaining({ref: expect.stringMatching(/\|13(?:\||$)/)}),
			]));
		const loreKinds = CharacterSheetClassUtils.getChoiceDescriptors(arcaneArcherLore).map(it => it.kind);
		expect(loreKinds).toEqual(expect.arrayContaining(["skill", "cantrip"]));
		expect(CharacterSheetClassUtils.getChoiceDescriptors(arcaneArcherLore)
			.filter(it => it.kind === "cantrip")
			.flatMap(it => it.options || [])
			.every(option => option.source)).toBe(true);
		const clericSpellcasting = allClassFeatures.find(it =>
			it.name === "Spellcasting" && it.className === "Cleric" && it.source === "XPHB",
		);
		expect(clericSpellcasting).toBeTruthy();
		expect(CharacterSheetClassUtils.getChoiceDescriptors(clericSpellcasting)
			.filter(it => ["spell", "cantrip"].includes(it.kind))).toEqual([]);
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
		const featCatalog = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/feats.json"), "utf8")).feat;
		const productionCensus = CharacterSheetClassUtils.getChoiceDescriptorCensus(
			[...entities, ...catalogEntities],
			{feats: featCatalog},
		);
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

	it("keeps fixed spell grants out of the authored census and exposes Human/Acolyte origin choices", () => {
		const read = file => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
		const human = read("data/races.json").race.find(it => it.name === "Human" && it.source === "XPHB");
		const acolyte = read("data/backgrounds.json").background.find(it => it.name === "Acolyte" && it.source === "XPHB");
		const feats = read("data/feats.json").feat;
		const humanDescriptors = CharacterSheetClassUtils.getChoiceDescriptors(human, {feats});
		expect(humanDescriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({kind: "skill"}),
			expect.objectContaining({kind: "feat", label: "Origin Feat"}),
		]));
		expect(humanDescriptors.find(it => it.kind === "feat")?.options?.length).toBeGreaterThan(0);

		const acolyteDescriptors = CharacterSheetClassUtils.getChoiceDescriptors(acolyte, {feats});
		expect(acolyteDescriptors.filter(it => it.kind === "skill")).toEqual([]);
		expect(acolyteDescriptors.filter(it => it.kind === "feat")).toEqual([]);
		expect(acolyteDescriptors.filter(it => it.kind === "ability")).toHaveLength(2);

		const fixedSpells = {
			name: "Fixed grant",
			additionalSpells: [
				{innate: {"1": ["Cure Wounds"]}},
				{prepared: {"1": ["Bless"]}},
				{known: {"1": ["Guidance"]}},
			],
		};
		const fixedCensus = CharacterSheetClassUtils.getChoiceDescriptorCensus([fixedSpells]);
		expect(fixedCensus.entries.filter(it => it.family === "spell")).toEqual([]);
	});
});
