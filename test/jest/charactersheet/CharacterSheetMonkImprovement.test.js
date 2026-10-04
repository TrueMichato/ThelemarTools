import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-features.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;
const Progression = globalThis.CharacterSheetProgression;
const State = globalThis.CharacterSheetState;
const LevelUp = globalThis.CharacterSheetLevelUp;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const Features = globalThis.CharacterSheetFeatures;
const Respec = globalThis.CharacterSheetRespec;
const copy = value => JSON.parse(JSON.stringify(value));
const monkData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-monk.json"), "utf8"));
const brew = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const feats = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/feats.json"), "utf8"));
const monk = brew.class.find(cls => cls.name === "Monk" && cls.source === "TGTT");
const xphbMonk = monkData.class.find(cls => cls.name === "Monk" && cls.source === "XPHB");
const phbMonk = monkData.class.find(cls => cls.name === "Monk" && cls.source === "PHB");
const asiFeat = feats.feat.find(feat => feat.name === "Ability Score Improvement" && feat.source === "XPHB");
const controlFeat = {name: "Control Feat", source: "TST", category: "O", repeatable: false, entries: []};
const opportunityLevels = [4, 8, 12, 16, 19];

function makeState (level = 1) {
	const state = new State();
	state.addClass({name: "Monk", source: "TGTT", level});
	state.setAbilityBase("dex", 12);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("con", 12);
	for (let i = 1; i <= level; i++) {
		state.recordLevelChoice({
			level: i,
			class: {name: "Monk", source: "TGTT"},
			classLevel: i,
			choices: {},
		});
	}
	return state;
}

function makePage (state, classData = monk) {
	return {
		getState: () => state,
		getClasses: () => [classData],
		getClassFeatures: () => monkData.classFeature,
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [asiFeat, controlFeat],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: entries => entries,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
	};
}

function getMonkDecision (manifest, level) {
	return manifest.decisions.find(decision =>
		decision.className === "Monk"
			&& decision.classSource === "TGTT"
			&& decision.classLevel === level
			&& ["feat", "asiOrFeat"].includes(decision.type),
	);
}

function analyzeQuickBuild (state, {from = state.getTotalLevel(), to = 8} = {}) {
	const page = makePage(state);
	const quickBuild = new QuickBuild(page);
	quickBuild._fromLevel = from;
	quickBuild._targetLevel = to;
	quickBuild._classAllocations = [{
		className: "Monk",
		classSource: "TGTT",
		classData: monk,
		currentLevel: from,
		targetLevel: to,
	}];
	return {quickBuild, analysis: quickBuild._analyzeLevels(), page};
}

async function applyLevelUp (state, newLevel, ability) {
	const page = makePage(state);
	const levelUp = new LevelUp(page);
	levelUp._processFeatSpellChoices = jest.fn().mockResolvedValue(undefined);
	await levelUp._applyLevelUp({
		classEntry: state.getClasses()[0],
		newLevel,
		asiChoices: newLevel === 4 ? {con: 2} : {},
		selectedFeat: {...copy(asiFeat), _featChoices: {ability}},
		selectedSubclass: null,
		selectedSubclassChoice: null,
		selectedOptionalFeatures: {},
		selectedCombatTraditions: [],
		selectedWeaponMasteries: [],
		selectedFeatureOptions: {},
		selectedClassFeatProgression: [],
		selectedExpertise: {},
		selectedLanguages: {},
		languageGrants: [],
		selectedScholarSkill: null,
		selectedSpellbookSpells: [],
		selectedSpellMasterySpells: [],
		selectedSignatureSpells: [],
		selectedArtificerPlanDecisions: [],
		selectedKnownSpells: [],
		selectedKnownCantrips: [],
		selectedPreparedSpells: [],
		selectedPreparedCantrips: [],
		stagedSpellSwap: null,
		newFeatures: [],
		hpMethod: "average",
		classData: monk,
	});
	return page;
}

describe("TGTT Monk improvement opportunities", () => {
	test("real cross-source ASI refs grant exactly four ASIs and the L19 Epic Boon", () => {
		expect(monk).toBeDefined();
		expect(asiFeat.repeatable).toBe(true);
		const opts = {classFeatures: monkData.classFeature};
		for (let level = 1; level <= 20; level++) {
			const opportunity = ClassUtils.getImprovementOpportunity(monk, level, opts);
			if (level === 19) expect(opportunity).toMatchObject({kind: "feat", categories: ["EB"]});
			else if (opportunityLevels.includes(level)) expect(opportunity).toMatchObject({kind: "asiOrFeat", source: "classFeature"});
			else expect(opportunity).toBeNull();
		}
		expect(ClassUtils.getImprovementOpportunity(xphbMonk, 19, opts)).toMatchObject({kind: "feat"});
		expect(ClassUtils.getImprovementOpportunity(phbMonk, 19, opts)).toMatchObject({kind: "asiOrFeat"});
	});

	test("cross-source grants require the exact authored feature, not a same-name/wrong-source UID", () => {
		const atFour = refs => ClassUtils.getImprovementOpportunity({
			...monk,
			featProgression: [],
			classFeatures: refs,
		}, 4, {classFeatures: monkData.classFeature});
		expect(atFour(["Ability Score Improvement|Monk|PHB|4"])).toMatchObject({kind: "asiOrFeat"});
		expect(atFour(["Ability Score Improvement|Monk|PHB|4|XPHB"])).toBeNull();
		expect(atFour(["Ability Score Improvement|Fighter|XPHB|4"])).toBeNull();
		expect(atFour(["Ability Score Improvement|Monk|XPHB|8"])).toBeNull();
		expect(atFour(["Ability Score Improvement|Monk|XPHB|4|PHB"])).toBeNull();
		expect(atFour(["Ability Score Improvement|Monk|XPHB|4|XPHB|extra"])).toBeNull();
		expect(ClassUtils.getImprovementOpportunity({...monk, classFeatures: ["Ability Score Improvement|Monk|XPHB|4"]}, 4)).toBeNull();
		for (const incompatible of [{source: "EFA"}, {edition: "classic"}]) {
			expect(ClassUtils.getImprovementOpportunity({
				...monk,
				...incompatible,
				featProgression: [],
				classFeatures: ["Ability Score Improvement|Monk|XPHB|4"],
			}, 4, {classFeatures: monkData.classFeature})).toBeNull();
		}
	});

	test("Level Up and Quick Build discover the same Monk slots at every qualifying level", async () => {
		for (const level of opportunityLevels) {
			const state = makeState(level - 1);
			const page = makePage(state);
			const levelUp = new LevelUp(page);
			levelUp._pShowLevelUpModal = jest.fn().mockResolvedValue(undefined);
			await levelUp._doLevelUp(state.getClasses()[0]);
			const levelUpOpportunity = levelUp._pShowLevelUpModal.mock.calls[0][0].improvement;
			expect(levelUpOpportunity?.kind).toBe(level === 19 ? "feat" : level === 4 ? "asiAndFeat" : "asiOrFeat");
			const {analysis} = analyzeQuickBuild(state, {from: level - 1, to: level});
			expect(analysis).toHaveLength(1);
			expect(analysis[0].improvement).toEqual(levelUpOpportunity);
			expect(analysis[0].hasAsi).toBe(true);
		}
	});

	test("Builder handoff to Quick Build exposes both level-4 and level-8 improvement steps", async () => {
		const state = makeState(1);
		const quickBuild = new QuickBuild(makePage(state));
		quickBuild._showWizard = jest.fn().mockResolvedValue(undefined);
		await quickBuild.showFromBuilder({classData: monk, targetLevel: 8});
		expect(quickBuild._showWizard).toHaveBeenCalledTimes(1);
		const analysis = quickBuild._analyzeLevels();
		expect(analysis.filter(level => level.hasAsi).map(level => level.classLevel)).toEqual([4, 8]);
	});
});

describe("repeatable XPHB Ability Score Improvement feat", () => {
	test("an owned ASI remains eligible while an owned non-repeatable feat is excluded", async () => {
		const state = makeState(3);
		await applyLevelUp(state, 4, "dex");
		expect(state.addFeat(controlFeat)).toBe(true);
		expect(ClassUtils.getEligibleFeats([asiFeat, controlFeat], state, {
			totalLevel: 8,
		})).toEqual([asiFeat]);
		expect(state.addFeat(controlFeat)).toBe(false);
		const unownedState = makeState(3);
		expect(unownedState.addFeat(asiFeat)).toBe(true);
		expect(unownedState.addFeat(asiFeat)).toBe(false);
	});

	describe("Features-tab repeatable feat acquisition", () => {
		test("picker allows an owned repeatable feat by exact source but not an owned non-repeatable feat", () => {
			const state = makeState(4);
			state.addFeat({...asiFeat, source: "PHB", repeatable: false});
			state.addFeat(controlFeat);
			globalThis.document ??= {addEventListener () {}, removeEventListener () {}};
			const features = new Features(makePage(state));
			expect(features._getFeatPickerAvailability(asiFeat)).toMatchObject({isKnown: false, canAdd: true});
			expect(features._getFeatPickerAvailability(controlFeat)).toMatchObject({isKnown: true, canAdd: false});
			state.addFeat({...copy(asiFeat), sourceDecisionKey: "test:prior-improvement"});
			expect(features._getFeatPickerAvailability(asiFeat)).toMatchObject({isKnown: true, canAdd: true});
		});

		test("direct add refuses an owned non-repeatable feat without changing the character", async () => {
			const state = makeState(4);
			const page = makePage(state);
			globalThis.document ??= {addEventListener () {}, removeEventListener () {}};
			const features = new Features(page);
			features.render = jest.fn();
			expect(await features._addFeat(controlFeat)).toBe(true);
			const snapshot = state.toJson();
			expect(await features._addFeat({...controlFeat, ability: [{choose: {from: ["dex"], amount: 2}}]}, {ability: "dex"})).toBe(false);
			expect(state.toJson()).toEqual(snapshot);
			expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		});

		test("manual ASI repeats apply and persist distinct bonuses without consuming a progression-owned ASI", async () => {
			const state = makeState(3);
			await applyLevelUp(state, 4, "con");
			const progressionFeat = copy(state.getFeats()[0]);
			globalThis.document ??= {addEventListener () {}, removeEventListener () {}};
			const page = makePage(state);
			const features = new Features(page);
			features.render = jest.fn();

			await features._addFeat(asiFeat, {ability: "dex"});
			await features._addFeat(asiFeat, {ability: "wis"});
			const owned = state.getFeats().filter(feat => feat.name === asiFeat.name && feat.source === asiFeat.source);
			expect(owned).toHaveLength(3);
			expect(new Set(owned.map(feat => feat.id)).size).toBe(3);
			expect(new Set(owned.map(feat => feat.sourceDecisionKey)).size).toBe(3);
			expect(owned[0]).toMatchObject(progressionFeat);
			expect(features._getFeatPickerAvailability(asiFeat)).toEqual({isKnown: true, canAdd: true});
			expect(owned.slice(1).map(feat => features._formatFeatChoices(feat.choices))).toEqual([
				"+2 Dexterity",
				"+2 Wisdom",
			]);
			expect(owned.slice(1).map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
			expect([state.getAbilityScore("con"), state.getAbilityScore("dex"), state.getAbilityScore("wis")]).toEqual([16, 14, 14]);
			const manifest = Progression.syncCanonicalDecisions({page, state});
			expect(manifest.base.decisions.filter(decision => decision.meta?.unplacedFeat)
				.map(decision => decision.semanticKey)).toEqual([
				owned[1].sourceDecisionKey,
				owned[2].sourceDecisionKey,
			]);

			const loaded = State.deserialize(state.serialize());
			expect(loaded.getFeats().map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{con: 2}, {dex: 2}, {wis: 2}]);
			loaded.removeFeat(owned[1].id);
			expect(loaded.getFeats().map(feat => feat.id)).toEqual([owned[0].id, owned[2].id]);
			expect([loaded.getAbilityScore("con"), loaded.getAbilityScore("dex"), loaded.getAbilityScore("wis")]).toEqual([16, 12, 14]);
		});
	});

	test("two independent Level Up acquisitions grant and persist distinct mechanical bonuses", async () => {
		const state = makeState(3);
		await applyLevelUp(state, 4, "dex");
		state.getClasses()[0].level = 7;
		for (let level = 5; level <= 7; level++) {
			state.recordLevelChoice({level, class: {name: "Monk", source: "TGTT"}, classLevel: level, choices: {}});
		}
		await applyLevelUp(state, 8, "wis");
		const owned = state.getFeats().filter(feat => feat.name === asiFeat.name && feat.source === asiFeat.source);
		expect(owned).toHaveLength(2);
		expect(new Set(owned.map(feat => feat.id)).size).toBe(2);
		expect(new Set(owned.map(feat => feat.sourceDecisionKey)).size).toBe(2);
		expect(owned.map(feat => feat.choices.ability)).toEqual(["dex", "wis"]);
		expect(owned.map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
		expect(state.getAbilityBase("con")).toBe(14);
		expect([state.getAbilityScore("dex"), state.getAbilityScore("wis"), state.getAbilityScore("con")]).toEqual([14, 14, 14]);
		const page = makePage(state);
		const manifest = Progression.syncCanonicalDecisions({page, state});
		for (const level of [4, 8]) {
			expect(getMonkDecision(manifest, level)).toMatchObject({
				status: "resolved",
				selection: level === 4
					? {name: asiFeat.name, source: asiFeat.source}
					: {mode: "feat", feat: {name: asiFeat.name, source: asiFeat.source}},
			});
		}
		expect(ClassUtils.getHistoricalAbilityScores({
			state,
			history: state.getLevelHistory(),
			characterLevel: 7,
		})).toMatchObject({dex: 14, wis: 12, con: 14});
		const reloaded = State.deserialize(state.serialize());
		expect(reloaded.getFeats().map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
		expect([reloaded.getAbilityScore("dex"), reloaded.getAbilityScore("wis"), reloaded.getAbilityScore("con")]).toEqual([14, 14, 14]);
	});

	test("Quick Build commits the same feat at L4 and L8 once per slot and rejects a duplicate non-repeatable feat", () => {
		const state = makeState(3);
		const {quickBuild, analysis, page} = analyzeQuickBuild(state, {from: 3, to: 8});
		const selectionFor = (ability, feat = asiFeat) => ({
			mode: "feat",
			feat: copy(feat),
			featChoices: {ability},
			isBoth: false,
		});
		quickBuild._selections.asi.Monk_4 = selectionFor("dex");
		quickBuild._selections.asi.Monk_4.isBoth = true;
		quickBuild._selections.asi.Monk_4.abilityChoices = {con: 2};
		quickBuild._selections.asi.Monk_8 = selectionFor("wis");
		expect(quickBuild._getQuickBuildFeatSelectionIssues()).toEqual([]);
		for (const level of [4, 8]) {
			state.getClasses()[0].level = level;
			const sel = quickBuild._selections.asi[`Monk_${level}`];
			quickBuild._applyAsiOrFeat(sel, state.getClasses()[0], level, monk);
			state.recordLevelChoice(quickBuild._buildHistoryEntry(analysis.find(it => it.classLevel === level), `Monk_${level}`));
		}
		const beforeReplay = state.toJson();
		for (const level of [4, 8]) {
			quickBuild._applyAsiOrFeat(quickBuild._selections.asi[`Monk_${level}`], state.getClasses()[0], level, monk);
		}
		expect(state.toJson()).toEqual(beforeReplay);
		expect(state.getFeats().map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
		expect([state.getAbilityBase("dex"), state.getAbilityBase("wis"), state.getAbilityBase("con")]).toEqual([14, 14, 14]);
		const manifest = Progression.syncCanonicalDecisions({page, state});
		expect(getMonkDecision(manifest, 4)?.status).toBe("resolved");
		expect(getMonkDecision(manifest, 8)?.status).toBe("resolved");

		quickBuild._selections.asi.Monk_4 = selectionFor(null, controlFeat);
		quickBuild._selections.asi.Monk_8 = selectionFor(null, controlFeat);
		expect(quickBuild._getQuickBuildFeatSelectionIssues()).toEqual([
			expect.stringContaining("Control Feat"),
		]);
	});

	test("Respec swaps only the later acquisition, then restores it without touching the first", async () => {
		const state = makeState(3);
		await applyLevelUp(state, 4, "dex");
		state.getClasses()[0].level = 7;
		for (let level = 5; level <= 7; level++) {
			state.recordLevelChoice({level, class: {name: "Monk", source: "TGTT"}, classLevel: level, choices: {}});
		}
		await applyLevelUp(state, 8, "wis");
		const page = makePage(state, {
			...monk,
			classFeatures: [
				"Ability Score Improvement|Monk|XPHB|4",
				"Ability Score Improvement|Monk|XPHB|8",
			],
			optionalfeatureProgression: [],
		});
		Progression.syncCanonicalDecisions({page, state});
		const respec = new Respec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;

		let later = getMonkDecision(respec._engine.manifest, 8);
		expect(later).toMatchObject({status: "resolved", selection: {mode: "feat"}});
		expect(respec._engine.manifest.decisions.filter(decision =>
			decision.parentSemanticKey === later.semanticKey && decision.type === "nestedAbility",
		)).toEqual([expect.objectContaining({
			count: 1,
			status: "resolved",
			selection: "wis",
			receipt: expect.objectContaining({effects: [expect.objectContaining({amount: 2})]}),
		})]);
		expect(respec._applyImprovementChange(later, {
			mode: "feat",
			feat: copy(controlFeat),
			featChoices: {},
		})).toBe(true);
		expect(respec._state.getFeats().map(feat => feat.name)).toEqual([asiFeat.name, controlFeat.name]);
		expect(respec._state.getFeats()[0].appliedEffects.abilityDeltas).toEqual({dex: 2});
		expect([respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([14, 12]);

		later = getMonkDecision(respec._engine.manifest, 8);
		expect(respec._applyImprovementChange(later, {
			mode: "feat",
			feat: copy(asiFeat),
			featChoices: {ability: "wis"},
		})).toBe(true);
		expect(respec._state.getFeats().map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
		expect([respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([14, 14]);
		expect(state.getFeats()).toHaveLength(2);
		const reloaded = State.deserialize(respec._state.serialize());
		expect(reloaded.getFeats().map(feat => feat.choices.ability)).toEqual(["dex", "wis"]);
	});

	test("class-feat progression Respec preserves the other repeatable feat and its bonus", () => {
		const classData = {
			...monk,
			classFeatures: [],
			featProgression: [{name: "General Feat", category: ["G"], progression: {"4": 1, "8": 1}}],
		};
		const state = makeState(8);
		for (const [level, ability] of [[4, "dex"], [8, "wis"]]) {
			const sourceDecisionKey = Progression.getSemanticKey({
				className: "Monk",
				classSource: "TGTT",
				classLevel: level,
				type: "classFeatProgressionFeat",
				sourceKey: "General Feat",
			});
			const feat = {
				...copy(asiFeat),
				choices: {ability},
				_featChoices: {ability},
				sourceDecisionKey,
			};
			expect(state.addFeat(feat, {
				sourceDecisionKey,
				classFeatProgression: {
					className: "Monk",
					classSource: "TGTT",
					level,
					progressionName: "General Feat",
				},
			})).toBe(true);
			ClassUtils.applyFeatBonuses(state, feat);
			state.updateLevelChoice(level, {
				classFeatProgressionFeats: [{
					progressionName: "General Feat",
					name: asiFeat.name,
					source: asiFeat.source,
					category: ["G"],
				}],
			});
		}
		expect([state.getAbilityBase("dex"), state.getAbilityBase("wis")]).toEqual([14, 14]);
		const page = makePage(state, classData);
		const respec = new Respec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const earlier = respec._engine.manifest.decisions.find(decision =>
			decision.type === "classFeatProgressionFeat" && decision.classLevel === 4);
		const later = respec._engine.manifest.decisions.find(decision =>
			decision.type === "classFeatProgressionFeat" && decision.classLevel === 8);
		expect(earlier).toMatchObject({status: "resolved", selection: {name: asiFeat.name}});
		expect(later).toMatchObject({status: "resolved", selection: {name: asiFeat.name}});
		expect(respec._applyClassFeatProgressionDecisionChange(later, {
			...controlFeat,
			category: "G",
		})).toBe(true);
		expect(respec._state.getFeats().map(feat => feat.name)).toEqual([asiFeat.name, controlFeat.name]);
		expect(respec._state.getFeats()[0]).toMatchObject({
			sourceDecisionKey: earlier.semanticKey,
			appliedEffects: {abilityDeltas: {dex: 2}},
		});
		expect([respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([14, 12]);
		const replacement = respec._engine.manifest.decisions.find(decision =>
			decision.type === "classFeatProgressionFeat" && decision.classLevel === 8);
		expect(respec._applyClassFeatProgressionDecisionChange(replacement, copy(asiFeat), {ability: "wis"})).toBe(true);
		expect(respec._state.getFeats().map(feat => feat.appliedEffects.abilityDeltas)).toEqual([{dex: 2}, {wis: 2}]);
		expect([respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([14, 14]);
		expect(State.deserialize(respec._state.serialize()).getFeats()).toHaveLength(2);
	});
});
