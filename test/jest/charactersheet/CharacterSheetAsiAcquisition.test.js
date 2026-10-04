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
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const Utils = globalThis.CharacterSheetClassUtils;
const State = globalThis.CharacterSheetState;
const Progression = globalThis.CharacterSheetProgression;
const LevelUp = globalThis.CharacterSheetLevelUp;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const Respec = globalThis.CharacterSheetRespec;
// Keep catalog arrays in the test realm; copyFast uses instanceof Array.
const books = [...fs.readdirSync("data/class")].filter(name => /^class-.*\.json$/.test(name))
	.map(name => JSON.parse(fs.readFileSync(`data/class/${name}`, "utf8")));
const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const features = books.flatMap(book => book.classFeature || []).concat(brew.classFeature || []);
const standardNames = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];
const classes = books.flatMap(book => book.class || []).concat(brew.class || [])
	.filter(cls => standardNames.includes(cls.name) && ["PHB", "XPHB", "TGTT"].includes(cls.source));
const fighter = classes.find(cls => cls.name === "Fighter" && cls.source === "XPHB");
const sorcerer = classes.find(cls => cls.name === "Sorcerer" && cls.source === "TGTT");
const asiFeat = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat
	.find(feat => feat.name === "Ability Score Improvement" && feat.source === "XPHB");

function pageFor (state) {
	return {
		getState: () => state,
		getClasses: () => classes,
		getClassFeatures: () => features,
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [asiFeat],
		getSpells: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
	};
}

function stateAtThree () {
	const state = new State();
	state.setSetting("thelemar_asiFeat", false);
	state.addClass({name: fighter.name, source: fighter.source, level: 3});
	for (let level = 1; level <= 3; level++) state.recordLevelChoice({level, class: fighter, classLevel: level, choices: {}});
	return state;
}

function applyOrdinary (state, asi, level = 4, grantBoth = false) {
	state.getClasses()[0].level = Math.max(state.getClasses()[0].level, level);
	const decision = Utils.applyClassAsi(state, {
		className: fighter.name,
		classSource: fighter.source,
		classLevel: level,
		characterLevel: level,
		asi,
		grantBoth,
	});
	state.recordLevelChoice({
		level,
		class: fighter,
		classLevel: level,
		choices: {asi},
		decisions: decision ? [decision] : [],
	});
	return decision;
}

describe("production class improvement acquisition", () => {
	test("the matrix includes each standard class in all three source families", () => {
		expect(classes).toHaveLength(36);
	});

	test.each(classes.map(cls => [`${cls.name}|${cls.source}`, cls]))("%s honors authored slots and preserves level-19 policy", (_name, cls) => {
		const levels = new Set([4, 8, 12, 16, 19, ...(cls.name === "Fighter" ? [6, 14] : cls.name === "Rogue" ? [10] : [])]);
		for (let level = 1; level <= 20; level++) {
			const found = Utils.getImprovementOpportunity(cls, level, {classFeatures: features});
			if (!levels.has(level)) expect(found).toBeNull();
			else expect(found?.kind).toBe(level === 19 && cls.source !== "PHB" ? "feat" : "asiOrFeat");
		}
	});

	test.each([[4, "asiOrFeat"], [19, "feat"]])("EFA Artificer retains the authored level-%s improvement", (level, kind) => {
		const artificer = books.flatMap(book => book.class || []).find(cls => cls.name === "Artificer" && cls.source === "EFA");
		expect(artificer).toBeDefined();
		expect(Utils.getImprovementOpportunity(artificer, level, {classFeatures: features})).toMatchObject({kind});
	});

	test.each(["string", "wrapper", "resolved", "nested"])("TGTT legacy Sorcerer reference resolves in %s form", shape => {
		const uid = "Ability Score Improvement|Sorcerer|PHB|4";
		const resolved = features.find(feature => feature.name === "Ability Score Improvement"
			&& feature.className === "Sorcerer" && feature.classSource === "PHB" && feature.level === 4);
		const refs = shape === "string" ? [uid] : shape === "wrapper" ? [{classFeature: uid}]
			: shape === "resolved" ? [resolved] : [[{classFeature: uid}]];
		expect(Utils.getImprovementOpportunity({...sorcerer, classFeatures: refs}, 4, {classFeatures: features}))
			.toMatchObject({kind: "asiOrFeat", source: "classFeature"});
	});

	test.each([
		"Ability Score Improvement|Fighter|PHB|4",
		"Ability Score Improvement|Sorcerer|PHB|8",
		"Ability Score Improvement|Sorcerer|PHB|4|XPHB",
		"Ability Score Improvement|Sorcerer|XPHB|4|PHB",
		"Ability Score Improvement|Sorcerer|RHW|4",
		"Ability Score Improvement|Sorcerer|PHB|4|PHB|extra",
	])("rejects the invalid source-qualified reference %s", uid => {
		expect(Utils.getImprovementOpportunity({...sorcerer, classFeatures: [uid]}, 4, {classFeatures: features})).toBeNull();
	});

	test("authored cross-source references are case-insensitive without relaxing identity", () => {
		for (const source of ["TGTT", "tgtt"]) {
			expect(Utils.getImprovementOpportunity({...sorcerer, source, classFeatures: ["ability score improvement|sorcerer|phb|4"]}, 4, {classFeatures: features}))
				.toMatchObject({kind: "asiOrFeat", source: "classFeature"});
		}
	});

	test.each(classes.map(cls => [`${cls.name}|${cls.source}`, cls]))("%s wires the same source-safe opportunity to LevelUp and QuickBuild", async (_name, cls) => {
		const state = new State();
		state.setSetting("thelemar_asiFeat", false);
		state.addClass({name: cls.name, source: cls.source, level: 3});
		const page = pageFor(state);
		const levelUp = new LevelUp(page);
		levelUp._pShowLevelUpModal = jest.fn().mockResolvedValue(undefined);
		await levelUp._doLevelUp(state.getClasses()[0]);
		const quickBuild = new QuickBuild(page);
		quickBuild._fromLevel = 3;
		quickBuild._targetLevel = 4;
		quickBuild._classAllocations = [{className: cls.name, classSource: cls.source, classData: cls, currentLevel: 3, targetLevel: 4}];
		expect(quickBuild._analyzeLevels()[0].improvement).toEqual(levelUp._pShowLevelUpModal.mock.calls[0][0].improvement);
		expect(quickBuild._analyzeLevels()[0].hasAsi).toBe(true);
	});
});

describe("actual ordinary ASI acquisition receipts", () => {
	test.each([false, true])("captures capped zero and nonzero transitions, both policy %s", grantBoth => {
		const state = stateAtThree();
		state.setSetting("thelemar_asiFeat", grantBoth);
		state.setAbilityBase("str", 20);
		state.setAbilityBase("dex", 19);
		const decision = applyOrdinary(state, {str: 1, dex: 1}, 4, grantBoth);
		expect(decision.type).toBe(grantBoth ? "asi" : "asiOrFeat");
		expect(decision.receipt.sourceDecisionKey).toBe(decision.semanticKey);
		expect(decision.receipt.effects).toEqual([
			{type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability: "str", amount: 0, before: 20, after: 20},
			{type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability: "dex", amount: 1, before: 19, after: 20},
			{type: "materialized", features: [{id: state.getFeatures()[0].id, name: "Ability Score Improvement", source: "XPHB"}]},
		]);
		const original = JSON.stringify(decision.receipt);
		Progression.syncCanonicalDecisions({page: pageFor(state), state});
		const loaded = State.deserialize(state.serialize());
		const replay = applyOrdinary(loaded, {str: 1, dex: 1}, 4, grantBoth);
		expect(JSON.stringify(replay.receipt)).toBe(original);
		expect(loaded.getAbilityBase("str")).toBe(20);
		expect(loaded.getAbilityBase("dex")).toBe(20);
		expect(loaded.getFeatures().filter(feature => feature.isAsiChoice)).toHaveLength(1);
	});

	describe("feat targets capped to zero remain acquisition evidence", () => {
		const featData = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
		const fixed = featData.find(feat => feat.name === "Durable" && feat.source === "PHB");
		test.each([
			["fixed", fixed, {}, {con: 0}],
			["selected", asiFeat, {ability: "str"}, {str: 0}],
			["split", asiFeat, {ability: {str: 1, dex: 1}, abilityOption: 1}, {str: 0, dex: 0}],
		])("%s records only the real resolved targets, survives replay/reload and removes no sibling", (_label, feat, choices, expected) => {
			const state = stateAtThree();
			for (const ability of Object.keys(expected)) state.setAbilityBase(ability, 20);
			const siblingChoices = {ability: "wis"};
			const sibling = {...asiFeat, choices: siblingChoices, sourceDecisionKey: "test:sibling:6"};
			expect(state.addFeat(sibling, {sourceDecisionKey: sibling.sourceDecisionKey})).toBe(true);
			Utils.applyFeatBonuses(state, sibling, siblingChoices);
			const selected = {...feat, choices, _featChoices: choices, sourceDecisionKey: "test:cap:4"};
			const acquire = () => {
				if (state.addFeat(selected, {sourceDecisionKey: selected.sourceDecisionKey})) Utils.applyFeatBonuses(state, selected, choices);
			};
			acquire();
			acquire();
			const stored = state.getFeats().find(candidate => candidate.sourceDecisionKey === selected.sourceDecisionKey);
			expect(stored.appliedEffects.abilityDeltas).toEqual(expected);
			const loaded = State.deserialize(state.serialize());
			const beforeRemoval = Parser.ABIL_ABVS.map(ability => loaded.getAbilityBase(ability));
			loaded.removeFeat(stored.id, stored.source);
			expect(Parser.ABIL_ABVS.map(ability => loaded.getAbilityBase(ability))).toEqual(beforeRemoval);
			expect(loaded.getFeats()).toHaveLength(1);
			expect(loaded.getFeats()[0]).toMatchObject({
				sourceDecisionKey: sibling.sourceDecisionKey, appliedEffects: {abilityDeltas: {wis: 2}},
			});
		});
	});

	test.each([{str: 1}, {str: 3}, {str: -1, dex: 3}, {other: 2}, {str: 1.5, dex: 0.5}])("invalid allocations refuse before any write: %j", asi => {
		const state = stateAtThree();
		const before = state.serialize();
		expect(() => Utils.applyClassAsi(state, {
			className: fighter.name, classSource: fighter.source, classLevel: 4, characterLevel: 4, asi,
		})).toThrow(/Ability Score Improvement/);
		expect(state.serialize()).toBe(before);
	});

	test("QuickBuild returns the actual scalar receipt and preserves it on replay", () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 19);
		state.getClasses()[0].level = 4;
		const quickBuild = new QuickBuild(pageFor(state));
		const selection = {mode: "asi", abilityChoices: {str: 2}};
		const receipt = quickBuild._applyAsiOrFeat(selection, state.getClasses()[0], 4, fighter);
		expect(receipt).toMatchObject({classLevel: 4, characterLevel: 4});
		expect(receipt.receipt.effects[0]).toMatchObject({ability: "str", amount: 1, before: 19, after: 20});
		state.recordLevelChoice({level: 4, class: fighter, classLevel: 4, choices: {asi: {str: 2}}, decisions: [receipt]});
		expect(quickBuild._applyAsiOrFeat(selection, state.getClasses()[0], 4, fighter)).toEqual(state.getLevelHistoryEntry(4).decisions.find(decision => decision.semanticKey === receipt.semanticKey));
		expect(state.getAbilityBase("str")).toBe(20);
	});

	test("LevelUp records the actual capped receipt in its canonical history", async () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 19);
		const levelUp = new LevelUp(pageFor(state));
		await levelUp._applyLevelUp({
			classEntry: state.getClasses()[0],
			classData: fighter,
			newLevel: 4,
			asiChoices: {str: 2},
			newFeatures: [],
			hpMethod: "average",
			selectedOptionalFeatures: {},
			selectedFeatureOptions: {},
		});
		const decision = state.getLevelHistoryEntry(4).decisions.find(entry => entry.type === "asiOrFeat");
		expect(decision.receipt.effects.find(effect => effect.type === "abilityDelta"))
			.toMatchObject({ability: "str", amount: 1, before: 19, after: 20, sourceDecisionKey: decision.semanticKey});
	});

	test("legacy authored choices remain unproven, not retroactively stamped as actual deltas", () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 20);
		state.getClasses()[0].level = 4;
		state.recordLevelChoice({level: 4, class: fighter, classLevel: 4, choices: {asi: {str: 2}}});
		Progression.syncCanonicalDecisions({page: pageFor(state), state});
		const decision = state.getLevelHistoryEntry(4).decisions.find(entry => entry.type === "asiOrFeat");
		expect(decision.receipt.effects.filter(effect => effect.type === "abilityDelta")).toEqual([]);
	});

	test("receipt-backed Respec reverses only capped applied amounts and returns a matching replacement receipt", () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 19);
		const old = applyOrdinary(state, {str: 2});
		applyOrdinary(state, {wis: 2}, 6);
		const respec = new Respec({page: pageFor(state), state});
		const before = state.getAbilityBase("wis");
		const result = respec._applyImprovementChangeInner(old, {mode: "asi", asi: {dex: 2}}, {
			throwOnError: true, skipLedgerUpdate: true,
		});
		expect(state.getAbilityBase("str")).toBe(19);
		expect(state.getAbilityBase("dex")).toBe(12);
		expect(state.getAbilityBase("wis")).toBe(before);
		expect(result.receipt.sourceDecisionKey).toBe(old.semanticKey);
		expect(result.receipt.effects[0]).toMatchObject({ability: "dex", amount: 2, before: 10, after: 12});
		expect(state.getFeatures().filter(feature => feature.isAsiChoice).map(feature => feature.level)).toEqual([6, 4]);
	});

	test("staged capped replacements preserve zero/nonzero receipts through second edit, Apply/reload/Undo", async () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 19);
		state.setAbilityBase("dex", 19);
		state.setAbilityBase("con", 20);
		state.setAbilityBase("int", 19);
		const originalAsi = applyOrdinary(state, {str: 2});
		applyOrdinary(state, {wis: 2}, 6);
		const respec = new Respec({page: pageFor(state), state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const decisionAtFour = () => respec._engine.manifest.decisions.find(decision => decision.type === "asiOrFeat" && decision.classLevel === 4);
		const original = state.serialize();
		expect(respec._applyImprovementChange(decisionAtFour(), {mode: "asi", asi: {dex: 2}})).toBe(true);
		expect(decisionAtFour().receipt.effects.filter(effect => effect.type === "abilityDelta")).toEqual([{
			type: "abilityDelta", sourceDecisionKey: decisionAtFour().semanticKey, ability: "dex", amount: 1, before: 19, after: 20,
		}]);
		expect(respec._applyImprovementChange(decisionAtFour(), {mode: "asi", asi: {con: 1, int: 1}})).toBe(true);
		const splitReceipt = decisionAtFour().receipt;
		expect(splitReceipt.effects.filter(effect => effect.type === "abilityDelta")).toEqual([
			{type: "abilityDelta", sourceDecisionKey: decisionAtFour().semanticKey, ability: "con", amount: 0, before: 20, after: 20},
			{type: "abilityDelta", sourceDecisionKey: decisionAtFour().semanticKey, ability: "int", amount: 1, before: 19, after: 20},
		]);
		expect(["str", "dex", "con", "int", "wis"].map(ability => respec._state.getAbilityBase(ability))).toEqual([19, 19, 20, 20, 12]);
		expect(state.serialize()).toBe(original);
		await respec._engine.apply();
		const loaded = State.deserialize(state.serialize());
		const reopened = new Respec({page: pageFor(loaded), state: loaded});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const saved = reopened._engine.manifest.decisions.find(decision => decision.semanticKey === originalAsi.semanticKey);
		expect(saved.receipt).toEqual(splitReceipt);
		expect(reopened._applyImprovementChange(saved, {mode: "asi", asi: {str: 2}})).toBe(true);
		expect(["str", "dex", "con", "int", "wis"].map(ability => reopened._state.getAbilityBase(ability))).toEqual([20, 19, 20, 19, 12]);
		await reopened._engine.apply();
		expect(State.deserialize(loaded.serialize()).getLevelHistoryEntry(4).decisions
			.find(decision => decision.semanticKey === saved.semanticKey).receipt.effects
			.find(effect => effect.type === "abilityDelta")).toMatchObject({ability: "str", amount: 1, before: 19, after: 20});
		await reopened._engine.undo();
		expect(["str", "dex", "con", "int", "wis"].map(ability => loaded.getAbilityBase(ability))).toEqual([19, 19, 20, 20, 12]);
		await respec._engine.undo();
		expect(["str", "dex", "con", "int", "wis"].map(ability => state.getAbilityBase(ability))).toEqual([20, 19, 20, 19, 12]);
		expect(state.getLevelHistoryEntry(4).decisions.find(decision => decision.semanticKey === originalAsi.semanticKey).receipt)
			.toEqual(originalAsi.receipt);
	});

	test("feat-to-ASI replacement captures the real post-feat teardown baseline and survives Apply/reload/Undo", async () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 19);
		state.setAbilityBase("dex", 19);
		state.getClasses()[0].level = 4;
		const quickBuild = new QuickBuild(pageFor(state));
		quickBuild._applyAsiOrFeat({mode: "feat", feat: asiFeat, featChoices: {ability: "str"}}, state.getClasses()[0], 4, fighter);
		state.recordLevelChoice({level: 4,
			class: fighter,
			classLevel: 4,
			choices: {
				feat: {name: asiFeat.name, source: asiFeat.source}, featChoices: {ability: "str"},
			}});
		applyOrdinary(state, {wis: 2}, 6);
		const ownedFeat = state.getFeats()[0];
		expect(ownedFeat.appliedEffects.abilityDeltas).toEqual({str: 1});
		const respec = new Respec({page: pageFor(state), state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const decision = respec._engine.manifest.decisions.find(entry => entry.type === "asiOrFeat" && entry.classLevel === 4);
		expect(respec._applyImprovementChange(decision, {mode: "asi", asi: {dex: 2}})).toBe(true);
		const receipt = respec._engine.manifest.decisions.find(entry => entry.semanticKey === decision.semanticKey).receipt;
		expect(receipt.effects.find(effect => effect.type === "abilityDelta")).toEqual({
			type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability: "dex", amount: 1, before: 19, after: 20,
		});
		await respec._engine.apply();
		const loaded = State.deserialize(state.serialize());
		expect(["str", "dex", "wis"].map(ability => loaded.getAbilityBase(ability))).toEqual([19, 20, 12]);
		expect(loaded.getFeats()).toEqual([]);
		expect(loaded.getLevelHistoryEntry(4).decisions.find(entry => entry.semanticKey === decision.semanticKey).receipt).toEqual(receipt);
		await respec._engine.undo();
		expect(["str", "dex", "wis"].map(ability => state.getAbilityBase(ability))).toEqual([20, 19, 12]);
		expect(state.getFeats()).toEqual([ownedFeat]);
	});

	test("legacy ASI replacement refuses only the uncertain acquisition and rolls back candidate and live siblings", () => {
		const state = stateAtThree();
		state.setAbilityBase("str", 20);
		state.recordLevelChoice({level: 4, class: fighter, classLevel: 4, choices: {asi: {str: 2}}});
		applyOrdinary(state, {wis: 2}, 6);
		const respec = new Respec({page: pageFor(state), state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const legacy = respec._engine.manifest.decisions.find(decision => decision.type === "asiOrFeat" && decision.classLevel === 4);
		const sibling = respec._engine.manifest.decisions.find(decision => decision.type === "asiOrFeat" && decision.classLevel === 6);
		const liveBefore = state.serialize();
		const candidateBefore = respec._engine.state.serialize();
		const toast = jest.spyOn(JqueryUtil, "doToast");
		expect(respec._applyImprovementChange(legacy, {mode: "asi", asi: {dex: 2}})).toBe(false);
		expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({
			type: "danger", content: expect.stringMatching(/Keep the original save.*Other Respec choices remain available/),
		}));
		expect(state.serialize()).toBe(liveBefore);
		expect(respec._engine.state.serialize()).toBe(candidateBefore);
		expect(respec._applyImprovementChange(sibling, {mode: "asi", asi: {con: 2}})).toBe(true);
		expect(state.serialize()).toBe(liveBefore);
		expect(respec._engine.state.getAbilityBase("str")).toBe(20);
		expect(respec._engine.state.getAbilityBase("wis")).toBe(10);
		expect(respec._engine.state.getAbilityBase("con")).toBe(12);
		toast.mockRestore();
	});
});
