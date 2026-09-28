import fs from "node:fs";
import path from "node:path";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const {CharacterSheetBuilder, CharacterSheetClassUtils, CharacterSheetProgression, CharacterSheetRespecEngine, CharacterSheetState} = globalThis;

const published = new Map([
	["PHB", "data/class/class-bard.json", "Bard"],
	["XPHB", "data/class/class-bard.json", "Bard"],
	["TGTT", "homebrew/TravelersGuidetoThelemar.json", "Bard"],
	["cleric", "data/class/class-cleric.json", "Cleric"],
	["wizard", "data/class/class-wizard.json", "Wizard"],
].map(([key, file, name]) => [key, JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"))
	.class.find(cls => cls.name === name && (key === "cleric" || key === "wizard" ? cls.source === "XPHB" : cls.source === key))]));

const spell = (name, source, level, className = "Bard") => ({
	name,
	source,
	level,
	school: "V",
	classes: {fromClassList: [{name: className, source: source === "PHB" ? "PHB" : "XPHB"}]},
});
const bardSpells = ["Cure Wounds", "Dissonant Whispers", "Faerie Fire", "Healing Word"]
	.map(name => spell(name, "XPHB", 1));
const bardCantrips = ["Mage Hand", "Vicious Mockery"].map(name => spell(name, "XPHB", 0));

function build ({source, classData = published.get(source), spells = bardSpells, cantrips = bardCantrips, catalog = [...bardSpells, ...bardCantrips]} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(catalog);
	const page = {
		getState: () => state,
		getClasses: () => [classData],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => catalog,
		getFilteredSpellData: () => catalog,
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		renderCharacter: () => {},
	};
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder.resetSelections();
	builder._page = page;
	builder._state = state;
	builder._selectedClass = classData;
	builder._applyClassFeatures = () => {};
	builder._clearClassApplication = () => {};
	builder._getClassFeatureLanguageGrants = () => ({autoLanguages: []});
	builder._currentStep = 3;
	builder._applyCurrentStep();
	builder._selectedKnownSpells = spells;
	builder._selectedKnownCantrips = cantrips;
	builder._currentStep = 6;
	builder._applyCurrentStep();
	return {builder, state, page};
}

function decisions ({state, page, className = "Bard"}) {
	const reloaded = new CharacterSheetState();
	reloaded.setSpellData(page.getSpells());
	reloaded.loadFromJson(state.toJson());
	const manifest = CharacterSheetProgression.buildManifest({
		state: reloaded,
		page: {...page, getState: () => reloaded},
	});
	return {
		reloaded,
		manifest,
		spells: manifest.decisions.find(decision => decision.className === className && decision.classLevel === 1 && decision.type === "knownSpells"),
		cantrips: manifest.decisions.find(decision => decision.className === className && decision.classLevel === 1 && decision.type === "cantrips"),
	};
}

describe("CS-BUG-177 (FIXED): Builder level-1 Bard spell ownership", () => {
	for (const source of ["TGTT", "XPHB"]) {
		test(`${source} full picks survive the real Class → Spells apply boundary and reload as resolved known acquisitions`, () => {
			const {state, page} = build({source});
			const choice = state.getLevelHistoryEntry(1).choices;
			expect(choice.knownSpells).toEqual(bardSpells.map(({name, source, level}) => ({name, source, level})));
			expect(choice.knownCantrips).toEqual(bardCantrips.map(({name, source, level}) => ({name, source, level})));
			expect(choice.preparedSpells).toBeUndefined();
			expect(state.getSpellsKnown()).toEqual(expect.arrayContaining(bardSpells.map(({name, source: spellSource}) =>
				expect.objectContaining({name, source: spellSource, sourceFeature: "Spells Known", sourceClass: "Bard", sourceClassSource: source, prepared: false}))));
			const after = decisions({state, page});
			expect(after.spells).toMatchObject({count: 4, status: "resolved", required: true, selection: choice.knownSpells});
			expect(after.cantrips).toMatchObject({count: 2, status: "resolved", required: true, selection: choice.knownCantrips});
		});

		test(`${source} reapplied Spells step clears deselected level-1 picks without revisiting Class`, () => {
			const {builder, state, page} = build({source});
			builder._selectedKnownSpells = [];
			builder._selectedKnownCantrips = [];
			builder._currentStep = 6;
			builder._applyCurrentStep();
			expect(state.getLevelHistoryEntry(1).choices).toMatchObject({
				knownSpells: [],
				knownCantrips: [],
				builderSpellPicks: {knownSpells: [], cantrips: []},
			});
			expect(state.getSpellsKnown()).toEqual([]);
			expect(state.getCantripsKnown()).toEqual([]);
			const after = decisions({state, page});
			expect(after.spells).toMatchObject({status: "deferred", required: false, selection: []});
			expect(after.cantrips).toMatchObject({status: "deferred", required: false, selection: []});
		});

		test(`${source} reapplied Spells step retains only still-selected level-1 choices`, () => {
			const {builder, state, page} = build({source});
			const retained = state.getSpellsKnown()[0];
			builder._selectedKnownSpells = bardSpells.slice(0, 2);
			builder._selectedKnownCantrips = bardCantrips.slice(0, 1);
			builder._currentStep = 6;
			builder._applyCurrentStep();
			expect(state.getSpellsKnown().map(it => `${it.name}|${it.source}`))
				.toEqual(bardSpells.slice(0, 2).map(it => `${it.name}|${it.source}`));
			expect(state.getSpellsKnown()[0].id).toBe(retained.id);
			expect(state.getCantripsKnown().map(it => `${it.name}|${it.source}`))
				.toEqual(bardCantrips.slice(0, 1).map(it => `${it.name}|${it.source}`));
			const after = decisions({state, page});
			expect(after.spells).toMatchObject({status: "deferred", required: false, selection: after.reloaded.getLevelHistoryEntry(1).choices.knownSpells});
			expect(after.cantrips).toMatchObject({status: "deferred", required: false, selection: after.reloaded.getLevelHistoryEntry(1).choices.knownCantrips});
		});

		for (const {label, spells, cantrips} of [
			{label: "partial", spells: bardSpells.slice(0, 2), cantrips: bardCantrips.slice(0, 1)},
			{label: "empty", spells: [], cantrips: []},
		]) {
			test(`${source} ${label} Builder picks stay explicit and deferred rather than invented or blocking`, () => {
				const {state, page} = build({source, spells, cantrips});
				const after = decisions({state, page});
				const choices = after.reloaded.getLevelHistoryEntry(1).choices;
				expect(choices.knownSpells).toEqual(spells.map(({name, source, level}) => ({name, source, level})));
				expect(choices.knownCantrips).toEqual(cantrips.map(({name, source, level}) => ({name, source, level})));
				expect(after.spells).toMatchObject({count: 4, status: "deferred", required: false, selection: choices.knownSpells});
				expect(after.cantrips).toMatchObject({count: 2, status: "deferred", required: false, selection: choices.knownCantrips});
				expect(after.manifest.decisions.filter(decision => decision.type === "knownSpells" && decision.classLevel === 1))
					.toHaveLength(1);
				const engine = new CharacterSheetRespecEngine({state: after.reloaded, page});
				engine.begin();
				const errors = engine.getValidation().errors;
				expect(errors.filter(error => [after.spells.id, after.cantrips.id].includes(error.decisionId))).toEqual([]);
				engine.cancel();
			});
		}
	}

	test("empty Builder history with orphaned Bard-owned spells is invalid, not deferred", () => {
		const {state, page} = build({source: "TGTT"});
		state.updateLevelChoice(1, {
			knownSpells: [],
			knownCantrips: [],
			builderSpellPicks: {classUid: "Bard|TGTT", knownSpells: [], cantrips: []},
		});
		const after = decisions({state, page});
		expect(after.spells.status).toBe("invalid");
		expect(after.cantrips.status).toBe("invalid");
		const engine = new CharacterSheetRespecEngine({state: after.reloaded, page});
		engine.begin();
		expect(engine.getValidation().isValid).toBe(false);
	});

	test("reapplying level-1 Builder spells preserves a later recorded Bard acquisition", () => {
		const laterSpell = spell("Shatter", "XPHB", 2);
		const {builder, state, page} = build({
			source: "TGTT", catalog: [...bardSpells, ...bardCantrips, laterSpell],
		});
		state.addClass({name: "Bard", source: "TGTT", level: 3});
		state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(laterSpell, {
			sourceFeature: "Spells Known", sourceClass: "Bard", sourceClassSource: "TGTT",
		}));
		state.recordLevelChoice({
			level: 3,
			class: {name: "Bard", source: "TGTT"},
			classLevel: 3,
			choices: {knownSpells: [{name: laterSpell.name, source: laterSpell.source, level: laterSpell.level}]},
		});
		builder._selectedKnownSpells = [];
		builder._selectedKnownCantrips = [];
		builder._currentStep = 6;
		builder._applyCurrentStep();
		expect(state.getSpellsKnown().map(it => `${it.name}|${it.source}`)).toEqual(["Shatter|XPHB"]);
		expect(state.getLevelHistoryEntry(3).choices.knownSpells)
			.toEqual([{name: "Shatter", source: "XPHB", level: 2}]);
		const after = decisions({state, page});
		expect(after.spells).toMatchObject({status: "deferred", required: false, selection: []});
	});

	for (const {label, spells, cantrips} of [
		{label: "partial", spells: bardSpells.slice(0, 2), cantrips: bardCantrips.slice(0, 1)},
		{label: "empty", spells: [], cantrips: []},
	]) {
		test(`Defer on already-${label} Builder spells keeps the picks and does not block Respec`, () => {
			const {state, page} = build({source: "TGTT", spells, cantrips});
			const engine = new CharacterSheetRespecEngine({state, page});
			engine.begin();
			const before = engine.manifest.decisions.find(it => it.classLevel === 1 && it.type === "knownSpells");
			expect(before).toMatchObject({status: "deferred", required: false});
			engine.updateDecisionSelection(before.id, null, {status: "deferred"});
			const after = engine.getDecision(before.id);
			expect(after).toMatchObject({status: "deferred", required: false, selection: before.selection});
			expect(engine.state.getLevelHistoryEntry(1).choices.knownSpells).toEqual(before.selection);
			expect(engine.state.getSpellsKnown().map(it => `${it.name}|${it.source}`))
				.toEqual(spells.map(it => `${it.name}|${it.source}`));
			expect(engine.getValidation().errors.filter(it => it.decisionId === before.id)).toEqual([]);
			expect(engine.isDirty).toBe(false);
		});
	}

	test("PHB Bard stays a known caster without 2024-only partial deferral", () => {
		const source = "PHB";
		const spells = bardSpells.map(it => spell(it.name, "PHB", it.level));
		const cantrips = bardCantrips.map(it => spell(it.name, "PHB", it.level));
		const {state, page} = build({source, spells, cantrips, catalog: [...spells, ...cantrips]});
		const after = decisions({state, page});
		expect(after.spells).toMatchObject({status: "resolved", required: true});
		expect(after.reloaded.getLevelHistoryEntry(1).choices.knownSpells).toHaveLength(4);
		expect(after.reloaded.getLevelHistoryEntry(1).choices.builderSpellPicks).toBeUndefined();
	});

	test("PHB Bard partial picks have no 2024 Builder provenance or deferred exception", () => {
		const spells = bardSpells.slice(0, 2).map(it => spell(it.name, "PHB", it.level));
		const cantrips = bardCantrips.slice(0, 1).map(it => spell(it.name, "PHB", it.level));
		const {state, page} = build({source: "PHB", spells, cantrips, catalog: [...spells, ...cantrips]});
		const after = decisions({state, page});
		expect(after.reloaded.getLevelHistoryEntry(1).choices.builderSpellPicks).toBeUndefined();
		expect(after.spells.status).not.toBe("deferred");
		expect(after.cantrips.status).not.toBe("deferred");
	});

	test("genuinely prepared Cleric and spellbook Wizard do not gain known-spell deferrals", () => {
		const cleric = published.get("cleric");
		const clericSpell = spell("Cure Wounds", "XPHB", 1, "Cleric");
		const clericCantrip = spell("Guidance", "XPHB", 0, "Cleric");
		const {state: clericState} = build({
			source: "cleric",
			classData: cleric,
			spells: [clericSpell],
			cantrips: [clericCantrip],
			catalog: [clericSpell, clericCantrip],
		});
		expect(CharacterSheetClassUtils.getClassSpellcastingModel({classData: cleric})).toBe("prepared");
		expect(clericState.getLevelHistoryEntry(1).choices.preparedSpells).toEqual([
			{name: "Cure Wounds", source: "XPHB", level: 1},
		]);
		expect(clericState.getLevelHistoryEntry(1).choices.builderSpellPicks).toBeUndefined();
		expect(clericState.getSpellsKnown()[0].sourceFeature).toBe("Spells Prepared");

		const wizard = published.get("wizard");
		const wizardSpell = spell("Shield", "XPHB", 1, "Wizard");
		const {builder, state: wizardState} = build({
			source: "wizard",
			classData: wizard,
			spells: [],
			cantrips: [],
			catalog: [wizardSpell],
		});
		builder._selectedSpellbookSpells = [wizardSpell];
		builder._applyCurrentStep();
		expect(wizardState.getSpellsKnown()[0]).toMatchObject({name: "Shield", inSpellbook: true, sourceFeature: "Wizard Spellbook"});
		expect(wizardState.getLevelHistoryEntry(1).choices.spellbookSpells).toEqual([
			{name: "Shield", source: "XPHB", level: 1},
		]);
		expect(wizardState.getLevelHistoryEntry(1).choices.builderSpellPicks).toBeUndefined();
	});

	test("a source-mismatched pick never becomes a deferred valid Builder choice", () => {
		const {state, page} = build({source: "TGTT", spells: bardSpells.slice(0, 1), cantrips: []});
		const history = state.getLevelHistoryEntry(1);
		history.choices.knownSpells[0].source = "PHB";
		const after = decisions({state, page});
		expect(after.spells.status).toBe("invalid");
	});

	test("an old partial save without Builder provenance remains invalid", () => {
		const {state, page} = build({source: "TGTT", spells: bardSpells.slice(0, 2), cantrips: bardCantrips.slice(0, 1)});
		delete state.getLevelHistoryEntry(1).choices.builderSpellPicks;
		const after = decisions({state, page});
		expect(after.spells).toMatchObject({status: "invalid", required: true});
		expect(after.cantrips).toMatchObject({status: "invalid", required: true});
	});

	test("projecting an unrelated edit retains explicit empty Builder spell choices", () => {
		const {state, page} = build({source: "TGTT", spells: [], cantrips: []});
		const manifest = CharacterSheetProgression.buildManifest({state, page});
		state.setProgressionManifest(manifest);
		const projected = CharacterSheetProgression.projectDecisionsToChoices(state.getLevelHistoryEntry(1));
		expect(projected.choices).toMatchObject({
			knownSpells: [],
			knownCantrips: [],
			builderSpellPicks: {classUid: "Bard|TGTT", knownSpells: [], cantrips: []},
		});
		state.recordLevelChoice(projected);
		const after = decisions({state, page});
		expect(after.spells).toMatchObject({status: "deferred", required: false, selection: []});
		expect(after.cantrips).toMatchObject({status: "deferred", required: false, selection: []});
	});

	test("filling a spell shortfall does not turn an untouched cantrip omission into an error", () => {
		const {state, page} = build({
			source: "TGTT", spells: bardSpells.slice(0, 2), cantrips: bardCantrips.slice(0, 1),
		});
		for (const picked of bardSpells.slice(2)) {
			state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(picked, {
				sourceFeature: "Spells Known", sourceClass: "Bard", sourceClassSource: "TGTT",
			}));
		}
		state.updateLevelChoice(1, {
			knownSpells: bardSpells.map(({name, source, level}) => ({name, source, level})),
		});
		const after = decisions({state, page});
		expect(after.spells).toMatchObject({status: "resolved", required: true});
		expect(after.cantrips).toMatchObject({status: "deferred", required: false});
	});

	for (const {label, alter} of [
		{label: "duplicate pick",
			alter: (state) => {
				state.getLevelHistoryEntry(1).choices.knownSpells.push(state.getLevelHistoryEntry(1).choices.knownSpells[0]);
				state.getLevelHistoryEntry(1).choices.builderSpellPicks.knownSpells.push("Cure Wounds|XPHB");
			}},
		{label: "contradictory provenance",
			alter: (state) => {
				state.getLevelHistoryEntry(1).choices.builderSpellPicks.classUid = "Bard|PHB";
			}},
		{label: "wrong live class owner",
			alter: (state) => {
				state.getSpellsKnown()[0].sourceClassSource = "PHB";
			}},
		{label: "illegal cantrip source",
			alter: (state) => {
				state.getLevelHistoryEntry(1).choices.knownCantrips[0].source = "PHB";
			}},
	]) {
		test(`${label} cannot be treated as an intentional deferred Builder pick`, () => {
			const {state, page} = build({source: "XPHB", spells: bardSpells.slice(0, 2), cantrips: bardCantrips.slice(0, 1)});
			alter(state);
			const after = decisions({state, page});
			expect([after.spells.status, after.cantrips.status]).toContain("invalid");
			const engine = new CharacterSheetRespecEngine({state: after.reloaded, page});
			engine.begin();
			expect(engine.getValidation().errors.some(error => [after.spells.id, after.cantrips.id].includes(error.decisionId))).toBe(true);
		});
	}

	test("a prior Bard pick is not copied into the next Class-step history", () => {
		const {builder, state} = build({source: "TGTT"});
		builder._selectedKnownSpells = [];
		builder._selectedKnownCantrips = [];
		builder._currentStep = 3;
		builder._applyCurrentStep();
		expect(state.getLevelHistoryEntry(1).choices.knownSpells).toBeUndefined();
		expect(state.getLevelHistoryEntry(1).choices.knownCantrips).toBeUndefined();
		builder._currentStep = 6;
		builder._applyCurrentStep();
		expect(state.getLevelHistoryEntry(1).choices.knownSpells).toEqual([]);
	});
});
