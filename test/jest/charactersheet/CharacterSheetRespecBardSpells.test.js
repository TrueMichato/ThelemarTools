import fs from "node:fs";
import path from "node:path";
import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetModal = globalThis.CharacterSheetModal;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const spell = (name, level, className = "Bard") => ({
	name,
	source: "TGTT",
	level,
	classes: {fromClassList: [{name: className, source: className === "Bard" ? "TGTT" : "XPHB"}]},
});

const BARD_SPELLS = [
	spell("Low A", 1),
	spell("Low B", 1),
	spell("High A", 2),
	spell("High B", 2),
	spell("High C", 2),
	spell("Borrowed Secret", 5, "Wizard"),
	spell("Bard Secret", 5),
	spell("Mocking Note", 0),
];

const PUBLISHED_BARDS = new Map([
	["PHB", "data/class/class-bard.json"],
	["XPHB", "data/class/class-bard.json"],
	["TGTT", "homebrew/TravelersGuidetoThelemar.json"],
].map(([source, file]) => [
	source,
	JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"))
		.class.find(cls => cls.name === "Bard" && cls.source === source),
]));

function getBard ({level = 3, knownProgression = [3, 3, 4], cantripProgression = [1, 1, 1]} = {}) {
	return {
		name: "Bard",
		source: "TGTT",
		edition: "one",
		hd: {faces: 8},
		casterProgression: "full",
		spellcastingAbility: "cha",
		preparedSpellsProgression: knownProgression,
		cantripProgression,
		classFeatures: [],
		subclass: {name: "Jester", shortName: "Jester", source: "TGTT"},
		level,
	};
}

function getState ({
	level = 3,
	bard = getBard({level}),
	known = BARD_SPELLS.slice(0, 4),
	cantrips = [BARD_SPELLS.at(-1)],
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(BARD_SPELLS);
	state.addClass(copy(bard));
	state.setSubclass("Bard", copy(bard.subclass));
	for (let ix = 1; ix <= level; ++ix) {
		state.recordLevelChoice({
			level: ix,
			class: {name: "Bard", source: "TGTT"},
			choices: ix === 3 ? {subclass: copy(bard.subclass)} : {},
		});
	}
	for (const entry of known) {
		state.addSpell({
			...entry,
			sourceClass: "Bard",
			sourceFeature: "Spells Known",
		});
	}
	for (const entry of cantrips) {
		state.addCantrip({
			...entry,
			sourceClass: "Bard",
			sourceFeature: "Cantrips Known",
		});
	}
	return state;
}

function addStaleReconstructedLedger (state) {
	const entry = state.getLevelHistoryEntry(1);
	const semanticKey = CharacterSheetProgression.getSemanticKey({
		className: "Bard",
		classSource: "TGTT",
		classLevel: 1,
		type: "knownSpells",
		sourceKey: "known-spells",
		slot: 0,
	});
	entry.decisions = [{
		id: CharacterSheetProgression.getDecisionId({semanticKey, characterLevel: 1}),
		semanticKey,
		characterLevel: 1,
		className: "Bard",
		classSource: "TGTT",
		classLevel: 1,
		type: "knownSpells",
		label: "Spells Known",
		sourceKey: "known-spells",
		slot: 0,
		required: true,
		count: 3,
		options: [],
		selection: copy(BARD_SPELLS.slice(0, 2).concat(BARD_SPELLS[2])),
		status: "invalid",
		meta: {maxSpellLevel: 1},
		scope: "level",
		parentSemanticKey: null,
		rootSemanticKey: semanticKey,
		depth: 0,
		provenance: null,
		receipt: null,
	}];
	entry.manifestComplete = true;
}

function getPage (state, bard = state.getClasses()[0]) {
	return {
		getState: () => state,
		getClasses: () => [copy(bard)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => copy(BARD_SPELLS),
		getFilteredSpellData: () => copy(BARD_SPELLS),
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getSpellNames (state) {
	return state.getSpellsKnown().map(it => it.name).sort();
}

function getDescendants (root) {
	return [root, ...(root?._children || []).flatMap(getDescendants)];
}

function getRecordedBard ({
	source = "TGTT",
	level = 10,
	acquiredSecret = false,
	acquiredWrongSource = false,
	legacyPreparedFrom = null,
} = {}) {
	const published = PUBLISHED_BARDS.get(source);
	const subclass = source === "TGTT"
		? {name: "Jester", shortName: "Jester", source}
		: {name: "College of Lore", shortName: "Lore", source};
	const bard = {
		name: "Bard",
		source,
		edition: published.edition,
		level,
		hd: {faces: 8},
		casterProgression: "full",
		spellcastingAbility: "cha",
		preparedSpellsProgression: published.preparedSpellsProgression,
		spellsKnownProgression: published.spellsKnownProgression,
		cantripProgression: published.cantripProgression,
		classFeatures: [],
		subclass,
	};
	const normalSpells = Array.from({length: CharacterSheetClassUtils.getKnownSpellsAtLevel(published, "Bard", level)}, (_, ix) => ({
		name: `Bard Tune ${ix + 1}`,
		source: "XPHB",
		level: 1,
		classes: {fromClassList: [{name: "Bard", source: "XPHB"}]},
	}));
	const normalCantrips = Array.from({length: published.cantripProgression[level - 1]}, (_, ix) => ({
		name: `Bard Cantrip ${ix + 1}`,
		source: "XPHB",
		level: 0,
		classes: {fromClassList: [{name: "Bard", source: "XPHB"}]},
	}));
	const borrowed = {
		name: "Borrowed Secret",
		source: "XPHB",
		level: 5,
		classes: {fromClassList: [{name: "Wizard", source: "XPHB"}]},
	};
	const clericSecret = {...borrowed, name: "Cleric Secret", classes: {fromClassList: [{name: "Cleric", source: "XPHB"}]}};
	const druidSecret = {...borrowed, name: "Druid Secret", classes: {fromClassList: [{name: "Druid", source: "XPHB"}]}};
	const wrongSource = {
		...borrowed,
		source: "PHB",
		classes: {fromClassList: [{name: "Sorcerer", source: "PHB"}]},
	};
	const borrowedCantrip = {...borrowed, name: "Borrowed Cantrip", level: 0};
	const tooHigh = {...borrowed, name: "Borrowed Too High", level: 6};
	const spellData = [...normalSpells, ...normalCantrips, borrowed, clericSecret, druidSecret, wrongSource, borrowedCantrip, tooHigh];
	const state = new CharacterSheetState();
	state.setSpellData(spellData);
	state.addClass(copy(bard));
	state.setSubclass("Bard", copy(subclass));
	state.setSetting("thelemar_asiFeat", false);
	state.setAbilityBase("cha", 14);
	let spellOffset = 0;
	let cantripOffset = 0;
	for (let classLevel = 1; classLevel <= level; ++classLevel) {
		const spellCount = CharacterSheetClassUtils.getKnownSpellsAtLevel(published, "Bard", classLevel)
			- (classLevel === 1 ? 0 : CharacterSheetClassUtils.getKnownSpellsAtLevel(published, "Bard", classLevel - 1));
		const cantripCount = published.cantripProgression[classLevel - 1]
			- (published.cantripProgression[classLevel - 2] || 0);
		const chosenSpells = normalSpells.slice(spellOffset, spellOffset + spellCount);
		if (classLevel === 10 && (acquiredSecret || acquiredWrongSource)) {
			chosenSpells[0] = acquiredWrongSource ? wrongSource : borrowed;
		}
		const chosenCantrips = normalCantrips.slice(cantripOffset, cantripOffset + cantripCount);
		const isLegacyLevel = legacyPreparedFrom != null && classLevel >= legacyPreparedFrom;
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Bard", source},
			choices: {
				...(classLevel === 3 ? {subclass: copy(subclass)} : {}),
				...([4, 8].includes(classLevel) ? {asi: {cha: 2}} : {}),
				...(spellCount ? {[isLegacyLevel ? "preparedSpells" : "knownSpells"]: chosenSpells.map(({name, source, level}) => ({name, source, level}))} : {}),
				...(cantripCount ? {[isLegacyLevel ? "preparedCantrips" : "cantrips"]: chosenCantrips.map(({name, source, level}) => ({name, source, level}))} : {}),
			},
		});
		chosenSpells.forEach(entry => state.addSpell({
			...entry,
			sourceClass: "Bard",
			sourceClassSource: source,
			sourceFeature: isLegacyLevel ? "Prepared Spells" : "Spells Known",
			prepared: isLegacyLevel,
		}));
		chosenCantrips.forEach(entry => state.addCantrip({
			...entry,
			sourceClass: "Bard",
			sourceClassSource: source,
			sourceFeature: isLegacyLevel ? "Prepared Spells" : "Cantrips Known",
		}));
		spellOffset += spellCount;
		cantripOffset += cantripCount;
	}
	const page = getPage(state, bard);
	page.getSpells = () => copy(spellData);
	page.getFilteredSpellData = () => copy(spellData);
	return {state, page, bard, borrowed, clericSecret, druidSecret, wrongSource, borrowedCantrip, tooHigh, spellData};
}

describe("Character Sheet Respec cumulative Bard spell choices", () => {
	it("replaces Juli-style false per-level reconstruction with stable cumulative repertoire decisions", () => {
		const state = getState();
		addStaleReconstructedLedger(state);

		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const known = manifest.decisions.filter(it => it.type === "knownSpells");
		const cantrips = manifest.decisions.filter(it => it.type === "cantrips");

		expect(known).toEqual([
			expect.objectContaining({
				characterLevel: 3,
				classLevel: 3,
				count: 4,
				status: "resolved",
				sourceKey: "legacy-known-spell-repertoire",
				selection: expect.arrayContaining(BARD_SPELLS.slice(0, 4).map(it => expect.objectContaining({name: it.name}))),
				meta: expect.objectContaining({legacyCumulative: true}),
			}),
		]);
		expect(cantrips).toEqual([
			expect.objectContaining({
				characterLevel: 3,
				count: 1,
				status: "resolved",
				sourceKey: "legacy-cantrip-repertoire",
				meta: expect.objectContaining({legacyCumulative: true}),
			}),
		]);
		expect(manifest.unresolved.filter(it => ["knownSpells", "cantrips"].includes(it.type))).toEqual([]);
	});

	describe("Character Sheet Respec recorded Bard Magical Secrets", () => {
		it("prefers multiple recorded Level Up acquisitions over a stale cumulative marker", () => {
			const {state, page, borrowed} = getRecordedBard({acquiredSecret: true});
			const history = state.getLevelHistory();
			history[9].decisions = ["knownSpells", "cantrips"].map(type => ({
				type,
				meta: {legacyCumulative: true},
				selection: [{name: borrowed.name, source: borrowed.source}],
			}));
			const spellPool = CharacterSheetProgression._getClassSpellPools(state, page, history).get("bard");
			expect(CharacterSheetProgression._isLegacyCumulativeSpellProgression({
				className: "Bard", classSource: "TGTT", history, spellPool,
			})).toBe(false);
		});

		it("keeps a genuinely cumulative repertoire when only one later level has recorded acquisitions", () => {
			const {state, page, borrowed} = getRecordedBard({acquiredSecret: true});
			const history = state.getLevelHistory();
			const startingCantrips = history[0].choices.cantrips;
			for (const entry of history.slice(0, 8)) {
				delete entry.choices.knownSpells;
				delete entry.choices.cantrips;
			}
			history[0].choices.cantrips = startingCantrips;
			history[8].decisions = [{
				type: "knownSpells",
				meta: {legacyCumulative: true},
				selection: [{name: borrowed.name, source: borrowed.source}],
			}];
			const spellPool = CharacterSheetProgression._getClassSpellPools(state, page, history).get("bard");
			expect(CharacterSheetProgression._isLegacyCumulativeSpellProgression({
				className: "Bard", classSource: "TGTT", history, spellPool,
			})).toBe(true);
		});

		it.each(["TGTT", "XPHB"])("reads a saved old-Level-Up %s Bard spell without changing it on open, Cancel, or unrelated Apply", async source => {
			const {state, page, borrowed} = getRecordedBard({source, acquiredSecret: true, legacyPreparedFrom: 10});
			const original = state.toJson();
			const respec = new CharacterSheetRespec({page, state});
			respec._engine.begin();
			const decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10);
			expect(decision).toMatchObject({
				status: "resolved",
				selection: [expect.objectContaining({name: borrowed.name, source: borrowed.source})],
			});
			expect(respec._engine.getValidation().errors.filter(error => error.decisionId === decision.id)).toEqual([]);
			expect(state.toJson()).toEqual(original);
			respec._engine.cancel();
			expect(state.toJson()).toEqual(original);

			respec._engine.begin();
			const hp = respec._engine.manifest.decisions.find(it => it.type === "hp" && it.classLevel === 9);
			respec._engine.updateDecisionSelection(hp.id, {method: "average"});
			await respec._engine.apply();
			expect(state.getLevelHistoryEntry(10).choices.preparedSpells).toEqual(original.levelHistory[9].choices.preparedSpells);
			expect(state.getLevelHistoryEntry(10).choices.knownSpells).toBeUndefined();
			expect(state.getSpellsKnown().find(it => it.name === borrowed.name && it.source === borrowed.source))
				.toMatchObject({sourceFeature: "Prepared Spells", prepared: true, sourceClassSource: source});
			await respec._engine.undo();
			expect(state.getLevelHistoryEntry(10).choices).toEqual(original.levelHistory[9].choices);
			expect(state.getSpellsKnown().find(it => it.name === borrowed.name && it.source === borrowed.source))
				.toMatchObject({sourceFeature: "Prepared Spells", prepared: true, sourceClassSource: source});
		});

		it("keeps an all-prepared-history Bard level-specific and converts only a staged old pick", async () => {
			const {state, page, borrowed, clericSecret, spellData} = getRecordedBard({
				acquiredSecret: true,
				legacyPreparedFrom: 1,
			});
			const original = state.toJson();
			const respec = new CharacterSheetRespec({page, state});
			respec._engine.begin();
			respec._state = respec._engine.state;
			const decisions = respec._engine.manifest.decisions.filter(it => it.type === "knownSpells");
			expect(decisions).toHaveLength(10);
			const tenth = decisions.find(it => it.classLevel === 10);
			expect(tenth).toMatchObject({
				status: "resolved",
				selection: [expect.objectContaining({name: borrowed.name, source: borrowed.source})],
			});
			expect(respec._engine.manifest.decisions.filter(it => it.type === "cantrips" && it.classLevel === 10))
				.toEqual([expect.objectContaining({status: "resolved", count: 1})]);
			const selected = [{name: clericSecret.name, source: clericSecret.source}];
			respec._engine.stageGraphMutation(tenth.id, selected, {
				apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(tenth, selected, tenth.options, candidate),
			});
			const draft = respec._engine.state;
			expect(draft.getLevelHistoryEntry(10).choices.preparedSpells).toBeUndefined();
			expect(draft.getLevelHistoryEntry(10).choices.knownSpells)
				.toEqual([expect.objectContaining({name: clericSecret.name, source: clericSecret.source})]);
			expect(draft.getLevelHistoryEntry(10).choices.preparedCantrips)
				.toEqual(original.levelHistory[9].choices.preparedCantrips);
			expect(draft.getLevelHistoryEntry(9).choices.preparedSpells).toEqual(original.levelHistory[8].choices.preparedSpells);
			expect(draft.getSpellsKnown().filter(it => [borrowed.name, clericSecret.name].includes(it.name)))
				.toEqual([expect.objectContaining({name: clericSecret.name, sourceFeature: "Spells Known", prepared: false})]);
			expect(state.toJson()).toEqual(original);
			expect(respec._engine.getValidation().errors).toEqual([]);
			await respec._engine.apply();
			const reloaded = new CharacterSheetState();
			reloaded.setSpellData(spellData);
			expect(reloaded.loadFromJson(state.toJson())).not.toBe(false);
			const reopenedPage = getPage(reloaded, page.getClasses()[0]);
			reopenedPage.getSpells = () => copy(spellData);
			reopenedPage.getFilteredSpellData = () => copy(spellData);
			const reopened = new CharacterSheetRespec({page: reopenedPage, state: reloaded});
			reopened._engine.begin();
			expect(reopened._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10))
				.toMatchObject({status: "resolved", selection: [expect.objectContaining({name: clericSecret.name, source: clericSecret.source})]});
			expect(await respec._engine.undo()).toBe(true);
			expect(state.getLevelHistoryEntry(10).choices).toEqual(original.levelHistory[9].choices);
			expect(state.getSpellsKnown().find(it => it.name === borrowed.name && it.source === borrowed.source))
				.toMatchObject({sourceFeature: "Prepared Spells", prepared: true, sourceClassSource: "TGTT"});
			expect(state.getSpellsKnown().some(it => it.name === clericSecret.name)).toBe(false);
		});

		it.each(["TGTT", "XPHB"])("accepts a recorded %s level-10 Wizard spell in the manifest and editor", source => {
			const {state, page, borrowed, clericSecret, druidSecret, wrongSource, tooHigh} = getRecordedBard({source, acquiredSecret: true});
			const saved = state.toJson();
			expect(saved.levelHistory[9].choices.knownSpells).toEqual([
				expect.objectContaining({name: borrowed.name, source: borrowed.source}),
			]);
			const loaded = new CharacterSheetState();
			loaded.setSpellData(page.getSpells());
			expect(loaded.loadFromJson(saved)).not.toBe(false);

			const manifest = CharacterSheetProgression.buildManifest({page, state: loaded});
			const decision = manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10);
			expect(decision).toMatchObject({
				sourceKey: "known-spells",
				count: 1,
				status: "resolved",
				meta: {additionalClassNames: ["Cleric", "Druid", "Wizard"]},
			});
			for (const option of [borrowed, clericSecret, druidSecret]) {
				expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey))
					.toContain(CharacterSheetRespec._getDecisionOptionKey(option));
			}
			expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain("borrowed secret|phb");
			expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain("borrowed too high|xphb");
			const respec = new CharacterSheetRespec({page, state: loaded});
			respec._engine.begin();
			respec._state = respec._engine.state;
			const editorDecision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10);
			for (const option of [borrowed, clericSecret, druidSecret]) {
				expect(respec._getDecisionOptions(editorDecision).map(CharacterSheetRespec._getDecisionOptionKey))
					.toContain(CharacterSheetRespec._getDecisionOptionKey(option));
			}
			expect(respec._getDecisionOptions(editorDecision).map(CharacterSheetRespec._getDecisionOptionKey))
				.not.toContain(CharacterSheetRespec._getDecisionOptionKey(wrongSource));
			expect(respec._getDecisionOptions(editorDecision).map(CharacterSheetRespec._getDecisionOptionKey))
				.not.toContain(CharacterSheetRespec._getDecisionOptionKey(tooHigh));
		});

		it("keeps all three expanded lists available on later 2024 Bard levels", () => {
			const {state, page, borrowed, clericSecret, druidSecret} = getRecordedBard({level: 11});
			const decision = CharacterSheetProgression.buildManifest({page, state})
				.decisions.find(it => it.type === "knownSpells" && it.classLevel === 11);
			expect(decision).toMatchObject({
				status: "resolved",
				meta: {additionalClassNames: ["Cleric", "Druid", "Wizard"]},
			});
			for (const option of [borrowed, clericSecret, druidSecret]) {
				expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey))
					.toContain(CharacterSheetRespec._getDecisionOptionKey(option));
			}
		});

		it("keeps level-9, cantrip, PHB Bard, and non-Bard eligibility distinct", () => {
			for (const source of ["TGTT", "XPHB", "PHB"]) {
				const {state, page, borrowed, borrowedCantrip} = getRecordedBard({source});
				const respec = new CharacterSheetRespec({page, state});
				respec._engine.begin();
				respec._state = respec._engine.state;
				const levelNine = respec._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 9);
				expect(levelNine.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain(
					CharacterSheetRespec._getDecisionOptionKey(borrowed),
				);
				expect(respec._getDecisionOptions(levelNine).map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain(
					CharacterSheetRespec._getDecisionOptionKey(borrowed),
				);
				if (source === "PHB") {
					const tenth = respec._engine.manifest.decisions.find(it =>
						it.type === "knownSpells" && it.classLevel === 10);
					expect(tenth.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain(
						CharacterSheetRespec._getDecisionOptionKey(borrowed),
					);
					continue; // PHB Magical Secrets grants two any-class spells at specific levels.
				}
				const cantrip = respec._engine.manifest.decisions.find(it => it.type === "cantrips" && it.classLevel === 10);
				expect(cantrip.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain(
					CharacterSheetRespec._getDecisionOptionKey(borrowedCantrip),
				);
				expect(respec._getDecisionOptions(cantrip).map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain(
					CharacterSheetRespec._getDecisionOptionKey(borrowedCantrip),
				);
			}
			expect(CharacterSheetClassUtils.getProgressionAdditionalSpellListClassNames({
				className: "Sorcerer", classSource: "XPHB", classLevel: 10,
			})).not.toContain("Wizard");
		});

		it("does not reinterpret a Cleric's prepared-spell history as a known Bard acquisition", () => {
			const cleric = {
				name: "Cleric",
				source: "XPHB",
				edition: "one",
				level: 1,
				hd: {faces: 8},
				casterProgression: "full",
				spellcastingAbility: "wis",
				preparedSpellsProgression: [4],
				cantripProgression: [3],
				classFeatures: [],
			};
			const healingWord = {
				name: "Healing Word",
				source: "XPHB",
				level: 1,
				classes: {fromClassList: [{name: "Cleric", source: "XPHB"}]},
			};
			const state = new CharacterSheetState();
			state.setSpellData([healingWord]);
			state.addClass(cleric);
			state.recordLevelChoice({
				level: 1,
				class: {name: "Cleric", source: "XPHB"},
				choices: {preparedSpells: [{name: healingWord.name, source: healingWord.source, level: 1}]},
			});
			state.addSpell({
				...healingWord,
				sourceClass: "Cleric",
				sourceClassSource: "XPHB",
				sourceFeature: "Prepared Spells",
				prepared: true,
			});
			const page = getPage(state, cleric);
			page.getSpells = () => [healingWord];
			page.getFilteredSpellData = () => [healingWord];
			const history = state.getLevelHistory();
			expect(CharacterSheetProgression._getLegacyBardPreparedSelection({
				entry: history[0], type: "knownSpells", state, history,
			})).toBeNull();
			const pool = CharacterSheetProgression._getClassSpellPools(state, page, history).get("cleric");
			expect(pool.knownSpells).toEqual([]);
			expect(pool.preparedSpells).toEqual([expect.objectContaining({
				name: healingWord.name, sourceFeature: "Prepared Spells", prepared: true,
			})]);
			expect(CharacterSheetClassUtils.getClassSpellcastingModel({
				name: cleric.name, source: cleric.source, classData: cleric,
			})).toBe("prepared");
		});

		it("rejects a recorded same-name spell from an ineligible source", () => {
			const {state, page, wrongSource} = getRecordedBard({acquiredWrongSource: true});
			const manifest = CharacterSheetProgression.buildManifest({page, state});
			const decision = manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10);
			expect(decision.selection).toEqual([{name: wrongSource.name, source: wrongSource.source, level: wrongSource.level}]);
			expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey)).toContain("borrowed secret|xphb");
			expect(decision.options.map(CharacterSheetRespec._getDecisionOptionKey)).not.toContain("borrowed secret|phb");
			expect(decision.status).toBe("invalid");
		});

		it("admits Wizard replacements after level 10 without broadening earlier swaps", () => {
			const {state, page, borrowed} = getRecordedBard();
			const manifest = CharacterSheetProgression.buildManifest({page, state});
			for (const classLevel of [9, 10]) {
				const swap = manifest.decisions.find(it => it.type === "spellSwap" && it.classLevel === classLevel);
				const hasSecret = swap.options.some(option => CharacterSheetRespec._getDecisionOptionKey(option) === "borrowed secret|xphb");
				expect(hasSecret).toBe(classLevel === 10);
				const respec = new CharacterSheetRespec({page, state});
				respec._engine.begin();
				respec._state = respec._engine.state;
				expect(respec._getDecisionOptions(swap).some(option =>
					CharacterSheetRespec._getDecisionOptionKey(option) === CharacterSheetRespec._getDecisionOptionKey(borrowed),
				)).toBe(classLevel === 10);
			}
		});

		it("stages a source-qualified level-10 spell, applies it, reopens it, and undoes it", async () => {
			const {state, page, borrowed, spellData} = getRecordedBard();
			const original = state.toJson();
			const originalSpells = state.getSpellsKnown().map(CharacterSheetRespec._getDecisionOptionKey).sort();
			const respec = new CharacterSheetRespec({page, state});
			respec._engine.begin();
			respec._state = respec._engine.state;
			respec.render = jest.fn();
			const decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10);
			const modalInner = e_({tag: "div"});
			const originalPGetShow = CharacterSheetModal.pGetShow;
			CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
			try {
				await respec._editManifestOptions(10, null, {decision}, jest.fn());
				const row = getDescendants(modalInner).find(it =>
					it._clazz?.includes("charsheet__respec-option")
						&& it._children?.[1]?.textContent?.includes("Borrowed Secret (XPHB)"),
				);
				expect(row).toBeDefined();
				expect(row._children[1].textContent).not.toContain("no longer legal");
				row._children[0].checked = true;
				row._children[0]._handlers.change();
				const stage = getDescendants(modalInner).find(it => it.textContent === "Stage Choice");
				await stage._handlers.click();
				expect(respec._engine.getDecision(decision.id)).toMatchObject({
					status: "resolved",
					selection: [{name: borrowed.name, source: borrowed.source}],
				});
				expect(respec._state.getSpellsKnown().map(CharacterSheetRespec._getDecisionOptionKey)).toContain("borrowed secret|xphb");
				expect(state.toJson()).toEqual(original);
				expect(respec._engine.getValidation().errors).toEqual([]);
				expect(await respec._engine.apply()).toBe(true);
				expect(state.getSpellsKnown().map(CharacterSheetRespec._getDecisionOptionKey)).toContain("borrowed secret|xphb");

				const loaded = new CharacterSheetState();
				loaded.setSpellData(spellData);
				expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
				const reopenedPage = getPage(loaded, page.getClasses()[0]);
				reopenedPage.getSpells = () => copy(spellData);
				reopenedPage.getFilteredSpellData = () => copy(spellData);
				const reopened = new CharacterSheetRespec({page: reopenedPage, state: loaded});
				reopened._engine.begin();
				expect(reopened._engine.manifest.decisions.find(it => it.type === "knownSpells" && it.classLevel === 10))
					.toMatchObject({status: "resolved", selection: [{name: borrowed.name, source: borrowed.source}]});
				expect(await respec._engine.undo()).toBe(true);
				expect(state.getSpellsKnown().map(CharacterSheetRespec._getDecisionOptionKey).sort()).toEqual(originalSpells);
				expect(state.getLevelHistoryEntry(10).choices.knownSpells).toEqual(original.levelHistory[9].choices.knownSpells);
			} finally {
				CharacterSheetModal.pGetShow = originalPGetShow;
			}
		});
	});

	it("uses the level-10 TGTT Bard Magical Secrets lists for the cumulative leveled-spell opportunity", () => {
		const bard = getBard({
			level: 10,
			knownProgression: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
			cantripProgression: Array(10).fill(0),
		});
		const state = getState({
			level: 10,
			bard,
			known: [BARD_SPELLS[6], BARD_SPELLS[5]],
			cantrips: [],
		});

		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state, bard), state});
		const decision = manifest.decisions.find(it => it.type === "knownSpells");

		expect(decision).toMatchObject({
			characterLevel: 10,
			count: 2,
			status: "resolved",
			meta: {
				legacyCumulative: true,
				additionalClassNames: ["Cleric", "Druid", "Wizard"],
			},
		});
		expect(decision.options.map(it => it.name)).toEqual(expect.arrayContaining(["Borrowed Secret", "Bard Secret"]));
	});

	it("keeps an invalid historical spell visible so the repair editor can remove it", () => {
		const legal = [BARD_SPELLS.at(-1)];
		const invalid = spell("Borrowed Cantrip", 0, "Cleric");
		const {options, invalidOptionKeys} = CharacterSheetRespec._getDecisionEditorOptions(legal, [legal[0], invalid]);

		expect(options).toEqual([
			legal[0],
			expect.objectContaining({
				name: "Borrowed Cantrip",
				source: "TGTT",
			}),
		]);
		expect(invalidOptionKeys).toEqual(new Set(["borrowed cantrip|tgtt"]));

		expect(CharacterSheetRespec._getDecisionEditorOptions(["arcana"], ["arcana", "legacy lore"])).toEqual({
			options: ["arcana", "legacy lore"],
			invalidOptionKeys: new Set(["legacy lore"]),
		});
	});

	it("lets the repair flow replace an illegal historical cantrip instead of silently restaging it", async () => {
		const legal = BARD_SPELLS.at(-1);
		const replacement = spell("Bright Note", 0);
		const invalid = spell("Borrowed Cantrip", 0, "Cleric");
		const bard = getBard({cantripProgression: [2, 2, 2]});
		const state = getState({bard, cantrips: [legal, invalid]});
		const spells = [...BARD_SPELLS, replacement, invalid];
		state.setSpellData(spells);
		const page = getPage(state, bard);
		page.getSpells = () => copy(spells);
		page.getFilteredSpellData = () => copy(spells);
		const respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		respec.render = jest.fn();
		const decision = respec._engine.manifest.decisions.find(it => it.type === "cantrips");
		expect(decision).toMatchObject({count: 2, status: "invalid"});

		const modalInner = e_({tag: "div"});
		const originalPGetShow = CharacterSheetModal.pGetShow;
		CharacterSheetModal.pGetShow = async () => ({
			eleModalInner: modalInner,
			doClose: jest.fn(),
		});

		try {
			await respec._showSpellRepairFlow([decision.id], jest.fn());
			const rows = getDescendants(modalInner).filter(it => it._clazz?.includes("charsheet__respec-option"));
			const invalidRow = rows.find(row => row._children?.[1]?.textContent?.includes("Borrowed Cantrip"));
			const replacementRow = rows.find(row => row._children?.[1]?.textContent?.includes("Bright Note"));

			expect(invalidRow?._children?.[1]?.textContent).toContain("currently selected, no longer legal");
			expect(invalidRow?._children?.[0]?.checked).toBe(true);
			invalidRow._children[0].checked = false;
			invalidRow._children[0]._handlers.change();
			replacementRow._children[0].checked = true;
			replacementRow._children[0]._handlers.change();

			const finish = getDescendants(modalInner).find(it => it.textContent === "Stage & Finish");
			finish.click();
			expect(respec._state.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());
			expect(respec._engine.getDecision(decision.id)).toMatchObject({
				status: "resolved",
				selection: expect.arrayContaining([
					expect.objectContaining({name: legal.name}),
					expect.objectContaining({name: replacement.name}),
				]),
			});
			await respec._engine.apply();
			expect(state.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());

			const loaded = new CharacterSheetState();
			loaded.setSpellData(spells);
			expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
			expect(loaded.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());
		} finally {
			CharacterSheetModal.pGetShow = originalPGetShow;
		}
	});

	it("reconfigures the cumulative repertoire with Cancel, Apply/reload, and one-step Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		state.setSpellData(BARD_SPELLS);
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});
		const original = state.toJson();

		respec._engine.begin();
		respec._state = respec._engine.state;
		let decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells");
		const replacement = [BARD_SPELLS[0], BARD_SPELLS[1], BARD_SPELLS[2], BARD_SPELLS[4]];
		respec._engine.stageGraphMutation(decision.id, replacement, {
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(decision, replacement, decision.options, candidate),
		});

		expect(getSpellNames(respec._state)).toEqual(replacement.map(it => it.name).sort());
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		respec._state = respec._engine.state;
		decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells");
		await respec._engine.stageGraphMutation(decision.id, replacement, {
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(decision, replacement, decision.options, candidate),
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		expect(getSpellNames(state)).toEqual(replacement.map(it => it.name).sort());

		const loaded = new CharacterSheetState();
		loaded.setSpellData(BARD_SPELLS);
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		const persisted = reopened._engine.manifest.decisions.find(it => it.type === "knownSpells");
		expect(persisted).toMatchObject({
			status: "resolved",
			meta: expect.objectContaining({legacyCumulative: true}),
		});
		expect(persisted.selection.map(it => it.name).sort()).toEqual(replacement.map(it => it.name).sort());

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(await respec._engine.undo()).toBe(false);
	});
});
