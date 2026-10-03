import "./setup.js";
import fs from "node:fs";
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

const Utils = globalThis.CharacterSheetClassUtils;
const State = globalThis.CharacterSheetState;
const Progression = globalThis.CharacterSheetProgression;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const Respec = globalThis.CharacterSheetRespec;
const copy = value => JSON.parse(JSON.stringify(value));
const feat = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat
	.find(entry => entry.name === "Ability Score Improvement" && entry.source === "XPHB");
const split = {ability: {str: 1, dex: 1}, abilityOption: 1};
const cls = {
	name: "Fighter",
	source: "XPHB",
	hd: {faces: 10},
	classFeatures: ["Ability Score Improvement|Fighter|XPHB|4", "Ability Score Improvement|Fighter|XPHB|8"],
};
const control = {name: "Control", source: "TST", category: "O", entries: []};

function setupRespec (classData = cls) {
	const state = new State();
	state.setSetting("thelemar_asiFeat", false);
	const subclass = {name: "Champion", shortName: "Champion", source: "XPHB"};
	state.addClass({...classData, level: 8, subclass});
	for (let level = 1; level <= 8; level++) state.recordLevelChoice({level, class: cls, classLevel: level, choices: level === 3 ? {subclass} : {}});
	const page = {
		getState: () => state,
		getClasses: () => [classData],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSkillsList: () => [],
		getFeats: () => [feat, control],
		getSpells: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
	const qb = Object.create(QuickBuild.prototype);
	qb._state = state;
	qb._page = page;
	return {state, page, qb};
}

function apply (state, choices, key = "test:asi:4") {
	const selected = {...copy(feat), choices: copy(choices), _featChoices: copy(choices), sourceDecisionKey: key};
	if (state.addFeat(selected, {sourceDecisionKey: key})) Utils.applyFeatBonuses(state, selected);
	return state.getFeats().find(entry => entry.sourceDecisionKey === key);
}

describe("authored feat ability alternatives", () => {
	test("discovers both modes without changing the source data", () => {
		expect(Utils.buildFeatChoicesSpec(feat).ability.alternatives).toEqual([
			{count: 1, amount: 2, from: Parser.ABIL_ABVS, max: 20},
			{count: 2, amount: 1, from: Parser.ABIL_ABVS, max: 20},
		]);
	});

	test.each([{ability: "str"}, split])("grants exactly two total points for %j", choices => {
		const state = new State();
		const stored = apply(state, choices);
		expect(Parser.ABIL_ABVS.reduce((sum, ability) => sum + state.getAbilityBase(ability) - 10, 0)).toBe(2);
		expect(stored.appliedEffects.abilityDeltas).toEqual(choices === split ? {str: 1, dex: 1} : {str: 2});
	});

	test.each([
		{ability: {str: 1}, abilityOption: 1},
		{ability: ["str", "str"], abilityOption: 1},
		{ability: {str: 2, dex: 1}, abilityOption: 1},
		{ability: {str: 1, nope: 1}, abilityOption: 1},
		{ability: {str: 1, dex: 1}, abilityOption: 0},
		{ability: "str", abilityOption: 7},
	])("rejects incomplete, duplicate, overfull and wrong-mode choices: %j", choices => {
		expect(Utils.isFeatChoiceSpecComplete({...feat, _featChoices: choices})).toBe(false);
		const state = new State();
		const before = state.toJson();
		expect(() => Utils.applyFeatBonuses(state, feat, choices)).toThrow(/ability/i);
		expect(state.toJson()).toEqual(before);
	});

	test("caps each split delta and reverses the actual receipt once after reload", () => {
		const state = new State();
		state.setAbilityBase("str", 20);
		state.setAbilityBase("dex", 19);
		const first = apply(state, split);
		expect(first.appliedEffects.abilityDeltas).toEqual({str: 0, dex: 1});
		apply(state, {ability: "wis"}, "test:asi:8");
		const loaded = State.deserialize(state.serialize());
		loaded.removeFeat(first.id, first.source);
		loaded.removeFeat(first.id, first.source);
		expect(Parser.ABIL_ABVS.map(ability => loaded.getAbilityBase(ability))).toEqual([20, 19, 10, 10, 12, 10]);
		expect(loaded.getFeats()).toHaveLength(1);
	});

	test("QuickBuild replay persists split choices and never stacks sibling acquisitions", () => {
		const state = new State();
		state.addClass({name: "Fighter", source: "XPHB", level: 8});
		const qb = Object.create(QuickBuild.prototype);
		qb._state = state;
		qb._page = {getSpells: () => [], getClassFeatures: () => []};
		const cls = {name: "Fighter", source: "XPHB"};
		for (const level of [4, 8, 4, 8]) {
			qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(split)}, cls, level, cls);
		}
		expect([state.getAbilityBase("str"), state.getAbilityBase("dex")]).toEqual([12, 12]);
		expect(state.getFeats()).toHaveLength(2);
		expect(state.getFeats().map(entry => entry.choices)).toEqual([split, split]);
		const loaded = State.deserialize(state.serialize());
		qb._state = loaded;
		for (const level of [4, 8]) qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(split)}, cls, level, cls);
		expect([loaded.getAbilityBase("str"), loaded.getAbilityBase("dex")]).toEqual([12, 12]);
		expect(loaded.getFeats()).toHaveLength(2);
		loaded.removeFeat(loaded.getFeats()[1].id, feat.source);
		expect([loaded.getAbilityBase("str"), loaded.getAbilityBase("dex")]).toEqual([11, 11]);
	});

	test("LevelUp history records only applied ASIs, never a hidden abandoned ordinary allocation beside a feat", async () => {
		const state = new State();
		state.setSetting("thelemar_asiFeat", false);
		state.addClass({...cls, level: 3});
		const page = {
			getState: () => state,
			getClasses: () => [cls],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => [feat],
			getSpells: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
		};
		const levelUp = new globalThis.CharacterSheetLevelUp(page);
		levelUp._processFeatSpellChoices = jest.fn().mockResolvedValue(undefined);
		await levelUp._applyLevelUp({
			classEntry: state.getClasses()[0],
			newLevel: 4,
			classData: cls,
			asiChoices: {con: 2},
			selectedFeat: {...copy(feat), _featChoices: copy(split)},
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
			selectedSpellbookSpells: [],
			selectedKnownSpells: [],
			selectedKnownCantrips: [],
			selectedPreparedSpells: [],
			selectedPreparedCantrips: [],
			newFeatures: [],
			hpMethod: "average",
		});
		expect([state.getAbilityBase("str"), state.getAbilityBase("dex"), state.getAbilityBase("con")]).toEqual([11, 11, 10]);
		expect(state.getLevelHistoryEntry(4).choices.asi).toBeUndefined();
		expect(Utils.getHistoricalAbilityScores({state, history: state.getLevelHistory(), characterLevel: 3})).toEqual(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, 10])));
	});

	test.each([
		{mode: "feat", isBoth: false, expectedAsi: undefined},
		{mode: "asi", isBoth: false, expectedAsi: {con: 2}},
		{mode: "feat", isBoth: true, expectedAsi: {con: 2}},
	])("QuickBuild history keeps only the ASI allocation committed by mode $mode (both=$isBoth)", ({mode, isBoth, expectedAsi}) => {
		const {page} = setupRespec();
		const qb = new QuickBuild(page);
		const key = "Fighter_XPHB_4";
		qb._selections.asi[key] = {
			mode,
			isBoth,
			abilityChoices: {con: 2},
			...(mode === "feat" ? {feat: copy(feat), featChoices: copy(split)} : {}),
		};
		const history = qb._buildHistoryEntry({
			characterLevel: 4,
			classLevel: 4,
			className: cls.name,
			classSource: cls.source,
			optionalFeatureGains: [],
			featureOptions: [],
			expertiseGrants: [],
			languageGrants: [],
		}, key);
		expect(history.choices.asi).toEqual(expectedAsi);
		if (mode === "feat") expect(history.choices.feat).toEqual({name: feat.name, source: feat.source});
	});

	test("honors per-entry count, amount, cap and allowlist; scalar half-feats remain compatible", () => {
		const half = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}], savingThrowProficiencies: [{choose: {from: Parser.ABIL_ABVS}}]};
		expect(Utils.isFeatChoiceSpecComplete({...half, _featChoices: {ability: "dex"}})).toBe(false);
		const state = new State();
		Utils.applyFeatBonuses(state, half, {ability: "con"});
		expect(state.getAbilityBase("con")).toBe(11);
		expect(state.getSaveProficiencies()).toContain("con");
		const limited = {name: "Two gifts", ability: [{max: 22, choose: {count: 2, amount: 2, from: ["str", "dex"]}}]};
		state.setAbilityBase("str", 21);
		Utils.applyFeatBonuses(state, limited, {ability: {str: 2, dex: 2}});
		expect([state.getAbilityBase("str"), state.getAbilityBase("dex")]).toEqual([22, 12]);
		expect(globalThis.CharacterSheetFeatures.prototype._formatFeatChoices(split)).toContain("+1 Strength");
	});

	test("historical scores, split child receipts and Respec swap/Apply/reload/Undo preserve the earlier repeat", async () => {
		const {state, page, qb} = setupRespec();
		qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(split)}, cls, 4, cls);
		const laterChoices = {ability: {dex: 1, wis: 1}, abilityOption: 1};
		qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: laterChoices}, cls, 8, cls);
		for (const [level, choices] of [[4, split], [8, laterChoices]]) {
			state.updateLevelChoice(level, {feat: {name: feat.name, source: feat.source}, featChoices: choices});
		}
		Progression.syncCanonicalDecisions({page, state});
		expect(Utils.getHistoricalAbilityScores({state, history: state.getLevelHistory(), characterLevel: 4})).toMatchObject({str: 10, dex: 10, wis: 10});
		expect(Utils.getHistoricalAbilityScores({state, history: state.getLevelHistory(), characterLevel: 8})).toMatchObject({str: 11, dex: 11, wis: 10});
		const respec = new Respec({state, page});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const later = respec._engine.manifest.decisions.find(decision => decision.classLevel === 8 && decision.type === "asiOrFeat");
		const child = respec._engine.manifest.decisions.find(decision => decision.type === "nestedAbility" && decision.parentSemanticKey === later.semanticKey);
		expect(child).toMatchObject({count: 2, selection: ["dex", "wis"], status: "resolved"});
		expect(child.receipt.effects).toEqual([
			expect.objectContaining({ability: "dex", amount: 1}),
			expect.objectContaining({ability: "wis", amount: 1}),
		]);
		expect(respec._applyImprovementChange(later, {mode: "feat", feat: control, featChoices: {}})).toBe(true);
		expect([respec._state.getAbilityBase("str"), respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([11, 11, 10]);
		expect(state.getAbilityBase("dex")).toBe(12);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		expect(State.deserialize(state.serialize()).getAbilityBase("dex")).toBe(11);
		await respec._engine.undo();
		expect(state.getAbilityBase("dex")).toBe(12);
		expect(state.getFeats().map(entry => entry.choices)).toEqual([split, laterChoices]);
	});

	test("nested Respec editing writes the complete allocation and reverses both old deltas only once", () => {
		const {state, page, qb} = setupRespec();
		for (const level of [4, 8]) {
			qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(split)}, cls, level, cls);
			state.updateLevelChoice(level, {feat: {name: feat.name, source: feat.source}});
		}
		const respec = new Respec({state, page});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const parent = respec._engine.manifest.decisions.find(decision => decision.classLevel === 8 && decision.type === "asiOrFeat");
		const child = respec._engine.manifest.decisions.find(decision => decision.type === "nestedAbility" && decision.parentSemanticKey === parent.semanticKey);
		respec._engine.stageGraphMutation(child.id, ["con", "wis"], {
			reverseParent: true,
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(child, ["con", "wis"], child.options, candidate),
		});
		expect([respec._state.getAbilityBase("str"), respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("con"), respec._state.getAbilityBase("wis")]).toEqual([11, 11, 11, 11]);
		expect(respec._state.getFeats().map(entry => entry.appliedEffects.abilityDeltas)).toEqual([{str: 1, dex: 1}, {con: 1, wis: 1}]);
		expect(respec._state.getFeats()[1].choices).toEqual({ability: {con: 1, wis: 1}, abilityOption: 1});
		expect(state.getAbilityBase("str")).toBe(12);
	});

	test("a capped split child receipt reverses zero and one, not two authored points or a sibling", () => {
		const {state, page, qb} = setupRespec();
		state.setAbilityBase("str", 20);
		state.setAbilityBase("dex", 19);
		const laterChoices = {ability: {con: 1, wis: 1}, abilityOption: 1};
		for (const [level, choices] of [[4, split], [8, laterChoices]]) {
			qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(choices)}, cls, level, cls);
			state.updateLevelChoice(level, {feat: {name: feat.name, source: feat.source}, featChoices: choices});
		}
		const respec = new Respec({state, page});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const parent = respec._engine.manifest.decisions.find(decision => decision.classLevel === 4 && decision.type === "asiOrFeat");
		const child = respec._engine.manifest.decisions.find(decision => decision.type === "nestedAbility" && decision.parentSemanticKey === parent.semanticKey);
		expect(child.receipt.effects).toEqual([
			expect.objectContaining({ability: "str", amount: 0}),
			expect.objectContaining({ability: "dex", amount: 1}),
		]);
		expect(respec._applyImprovementChange(parent, {mode: "feat", feat: control, featChoices: {}})).toBe(true);
		expect(["str", "dex", "con", "wis"].map(ability => respec._state.getAbilityBase(ability))).toEqual([20, 19, 11, 11]);
		expect(respec._state.getFeats().find(entry => entry.name === feat.name).appliedEffects.abilityDeltas).toEqual({con: 1, wis: 1});
	});

	test("class feat progression can switch split to scalar and rejects an incomplete split atomically", () => {
		const classData = {...cls, classFeatures: [], featProgression: [{name: "General Feat", category: ["G"], progression: {"4": 1, "8": 1}}]};
		const {state, page} = setupRespec(classData);
		for (const level of [4, 8]) {
			const key = Progression.getSemanticKey({className: cls.name, classSource: cls.source, classLevel: level, type: "classFeatProgressionFeat", sourceKey: "General Feat"});
			apply(state, split, key);
			state.updateLevelChoice(level, {classFeatProgressionFeats: [{progressionName: "General Feat", name: feat.name, source: feat.source, category: ["G"]}]});
		}
		const respec = new Respec({state, page});
		respec._engine.begin();
		respec._state = respec._engine.state;
		let later = respec._engine.manifest.decisions.find(decision => decision.classLevel === 8 && decision.type === "classFeatProgressionFeat");
		const before = respec._state.toJson();
		const toast = globalThis.JqueryUtil;
		globalThis.JqueryUtil = {doToast: jest.fn()};
		try {
			expect(respec._applyClassFeatProgressionDecisionChange(later, feat, {ability: {str: 1}, abilityOption: 1})).toBe(false);
			expect(respec._state.toJson()).toEqual(before);
			expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
		} finally {
			globalThis.JqueryUtil = toast;
		}
		later = respec._engine.manifest.decisions.find(decision => decision.classLevel === 8 && decision.type === "classFeatProgressionFeat");
		expect(respec._applyClassFeatProgressionDecisionChange(later, feat, {ability: "wis", abilityOption: 0})).toBe(true);
		expect([respec._state.getAbilityBase("str"), respec._state.getAbilityBase("dex"), respec._state.getAbilityBase("wis")]).toEqual([11, 11, 12]);
		expect(respec._state.getFeats().map(entry => entry.appliedEffects.abilityDeltas)).toEqual([{str: 1, dex: 1}, {wis: 2}]);
	});
});
