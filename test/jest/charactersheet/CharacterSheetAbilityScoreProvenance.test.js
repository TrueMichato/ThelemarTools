import "./setup.js";
import fs from "node:fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const State = globalThis.CharacterSheetState;
const Utils = globalThis.CharacterSheetClassUtils;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const fighter = JSON.parse(fs.readFileSync("data/class/class-fighter.json", "utf8")).class.find(cls => cls.source === "PHB");
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const feat = feats.find(f => f.name === "Ability Score Improvement" && f.source === "XPHB");
const copy = value => JSON.parse(JSON.stringify(value));
const sum = rows => rows.reduce((total, row) => total + (row.amount || 0), 0);

function acquireFeat (state, choice, key) {
	const selected = {...copy(feat), choices: choice, _featChoices: choice, sourceDecisionKey: key};
	state.addFeat(selected, {sourceDecisionKey: key});
	Utils.applyFeatBonuses(state, selected);
	return state.getFeats().find(f => f.sourceDecisionKey === key);
}

function acquireAsi (state, level, allocation) {
	const qb = Object.create(QuickBuild.prototype);
	qb._state = state;
	qb._page = {getClassFeatures: () => [], getSpells: () => []};
	qb._applyAsiOrFeat({mode: "asi", abilityChoices: allocation}, fighter, level, fighter);
	state.recordLevelChoice({level, class: fighter, classLevel: level, choices: {asi: allocation}});
}

describe("read-only ability score provenance", () => {
	test("projects actual LevelUp history receipts, including a capped zero, without replacing legacy evidence", async () => {
		const state = new State();
		state.setSetting("thelemar_asiFeat", false);
		state.setAbilityBase("str", 19);
		state.addClass({name: fighter.name, source: fighter.source, level: 3});
		const levelUp = new globalThis.CharacterSheetLevelUp({
			getState: () => state,
			getClasses: () => [fighter],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => feats,
			getSpells: () => [],
			getSkillsList: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: async () => {},
			renderCharacter: () => {},
			_updateTabVisibility: () => {},
		});
		for (const newLevel of [4, 5, 6]) {
			await levelUp._applyLevelUp({
				classEntry: state.getClasses()[0],
				classData: fighter,
				newLevel,
				asiChoices: newLevel === 5 ? null : {str: 2},
				newFeatures: [],
				hpMethod: "average",
				selectedOptionalFeatures: {},
				selectedFeatureOptions: {},
			});
		}
		const before = state.serialize();
		const breakdown = state.getAbilityScoreBreakdown("str");
		const rows = breakdown.components.filter(component => component.source === "acquisition");
		expect(rows.map(row => row.amount)).toEqual([1, 0]);
		expect(rows.map(row => row.label)).toEqual([
			expect.stringContaining("Fighter [PHB] level 4"),
			expect.stringContaining("Fighter [PHB] level 6"),
		]);
		expect(breakdown.components[0].amount).toBe(19);
		expect(sum(breakdown.components)).toBe(20);
		expect(state.serialize()).toBe(before);
		expect(State.deserialize(before).getAbilityScoreBreakdown("str")).toEqual(breakdown);
	});

	test("a real fixed-at-cap feat writer supplies an explicit zero disclosure after reload", () => {
		const state = new State();
		state.setAbilityBase("con", 20);
		const durable = feats.find(candidate => candidate.name === "Durable" && candidate.source === "PHB");
		expect(state.addFeat(copy(durable))).toBe(true);
		Utils.applyFeatBonuses(state, durable);
		expect(state.getFeats()[0].appliedEffects.abilityDeltas).toEqual({con: 0});
		const before = state.serialize();
		const breakdown = state.getAbilityScoreBreakdown("con");
		expect(breakdown.components.filter(component => component.source === "featAcquisition"))
			.toEqual([{source: "featAcquisition", label: "Durable [PHB] - unplaced acquisition; acquisition 1", amount: 0}]);
		expect(breakdown.components[0].amount).toBe(20);
		expect(sum(breakdown.components)).toBe(20);
		expect(state.serialize()).toBe(before);
		expect(State.deserialize(before).getAbilityScoreBreakdown("con")).toEqual(breakdown);
	});

	test("lists two real ordinary ASIs separately without crediting authored gains as actual receipts", () => {
		const state = new State();
		state.setAbilityBase("str", 19);
		acquireAsi(state, 4, {str: 2});
		acquireAsi(state, 8, {str: 1, dex: 1});
		expect(state.getAbilityBase("str")).toBe(20);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(c => c.source === "acquisition")).toEqual([
			{source: "acquisition", label: "Ability Score Improvement - Fighter [PHB] level 4 (recorded STR +2)", amount: null},
			{source: "acquisition", label: "Ability Score Improvement - Fighter [PHB] level 8 (recorded STR +1)", amount: null},
		]);
		expect(breakdown.components[0]).toEqual({source: "base", label: "Unallocated base (manual / unknown history)", amount: 20});
		expect(sum(breakdown.components)).toBe(breakdown.total);
	});

	test("uses real repeatable scalar/split deltas and an explicit nested capped-zero receipt", () => {
		const state = new State();
		state.setAbilityBase("str", 18);
		acquireFeat(state, {ability: "str"}, "first");
		const stored = acquireFeat(state, {ability: {str: 1, dex: 1}, abilityOption: 1}, "second");
		const child = {
			semanticKey: "second.ability",
			parentSemanticKey: "second",
			type: "nestedAbility",
			selection: ["str", "dex"],
			meta: {descriptorRules: {featAbilityChoice: true}},
		};
		child.receipt = {effects: globalThis.CharacterSheetProgression.getFeatAbilityDecisionEffects(child, state)};
		state.recordLevelChoice({level: 8,
			class: fighter,
			classLevel: 8,
			decisions: [
				{semanticKey: "second", type: "feat", meta: {featId: stored.id}},
				child,
			]});
		const breakdown = state.getAbilityScoreBreakdown("str");
		const rows = breakdown.components.filter(c => c.source === "featAcquisition");
		expect(rows.map(c => c.amount)).toEqual([2, 0]);
		expect(rows.map(c => c.label)).toEqual([
			"Ability Score Improvement [XPHB] - unplaced acquisition; acquisition 1",
			"Ability Score Improvement [XPHB] - Fighter [PHB] level 8; acquisition 2",
		]);
		expect(breakdown.components[0].amount).toBe(18);
		expect(state.getAbilityScoreBreakdown("dex").components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([1]);
		expect(sum(breakdown.components)).toBe(20);
	});

	test("a real nested Respec grant remains attributed after an initially empty parent receipt and reload", () => {
		const state = new State();
		const parent = {semanticKey: "deferred.feat", type: "nestedFeat"};
		state.addFeat({...copy(feat), sourceDecisionKey: parent.semanticKey});
		expect(state.getFeats()[0].appliedEffects.abilityDeltas).toEqual({});
		const child = {
			semanticKey: "deferred.feat.ability",
			parentSemanticKey: parent.semanticKey,
			type: "nestedAbility",
			selection: null,
			meta: {descriptorRules: {amount: 2, max: 20}},
		};
		const respec = Object.create(globalThis.CharacterSheetRespec.prototype);
		respec._state = state;
		respec._engine = {manifest: {decisions: [parent, child]}};
		respec._applyManifestSelectionMechanics(child, "str", ["str"], state);
		const engine = Object.create(globalThis.CharacterSheetRespecEngine.prototype);
		child.receipt = engine._makeDecisionReceipt(child, "str", state);
		child.selection = "str";
		state.recordLevelChoice({level: 4, class: fighter, classLevel: 4, decisions: [parent, child]});
		expect(state.getAbilityBase("str")).toBe(12);
		expect(state.getFeats()[0].appliedEffects.abilityDeltas).toEqual({});
		expect(child.receipt.effects).toContainEqual({type: "abilityDelta", sourceDecisionKey: child.semanticKey, ability: "str", amount: 2, before: 10});
		const before = copy(state._data);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([2]);
		expect(breakdown.components[0].amount).toBe(10);
		expect(sum(breakdown.components)).toBe(12);
		expect(state._data).toEqual(before);
		expect(State.deserialize(state.serialize()).getAbilityScoreBreakdown("str")).toEqual(breakdown);
		for (const deltas of [{dex: 1}, {str: NaN}, Object.create({str: 0})]) {
			state._data.feats[0].appliedEffects.abilityDeltas = deltas;
			expect(state.getAbilityScoreBreakdown("str").components[1].amount).toBe(2);
		}
		state._data.feats[0].appliedEffects.abilityDeltas = {str: 0};
		const targetedZero = state.getAbilityScoreBreakdown("str");
		expect(targetedZero.components[1].amount).toBe(0);
		expect(targetedZero.components[0].amount).toBe(12);
		expect(sum(targetedZero.components)).toBe(12);
	});

	test.each([
		{deltas: {}, expected: null},
		{deltas: {dex: 1}, expected: null},
		{deltas: {str: undefined}, expected: null},
		{deltas: {str: null}, expected: null},
		{deltas: {str: NaN}, expected: null},
		{deltas: {str: Infinity}, expected: null},
		{deltas: {str: "2"}, expected: null},
		{deltas: Object.create({str: 2}), expected: null},
		{deltas: {str: 0}, expected: 0},
		{deltas: {str: 2}, expected: 2},
	])("requires finite own-target evidence without a proven nested receipt: $deltas", ({deltas, expected}) => {
		const state = new State();
		acquireFeat(state, {ability: "str"}, "legacy");
		state._data.feats[0].appliedEffects.abilityDeltas = deltas;
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components[1].amount).toBe(expected);
		expect(sum(breakdown.components)).toBe(state.getAbilityScore("str"));
	});

	test("never mutates acquisition evidence and preserves repeat ownership after reload/removal", () => {
		const state = new State();
		const first = acquireFeat(state, {ability: "str"}, "first");
		acquireFeat(state, {ability: "str"}, "second");
		const loaded = State.deserialize(state.serialize());
		const before = copy(loaded._data);
		const breakdown = loaded.getAbilityScoreBreakdown("str");
		expect(loaded._data).toEqual(before);
		expect(breakdown.components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([2, 2]);
		loaded.removeFeat(first.id, first.source);
		expect(loaded.getAbilityScoreBreakdown("str").components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([2]);
		expect(loaded.getAbilityScore("str")).toBe(12);
	});

	test("shows manual changes as residual, not a fabricated starting score", () => {
		const state = new State();
		acquireFeat(state, {ability: "str"}, "first");
		state.setAbilityBase("str", 17);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components[0]).toMatchObject({amount: 15, label: expect.stringContaining("unknown history")});
		expect(sum(breakdown.components)).toBe(17);
		const legacy = new State();
		legacy.setAbilityBase("str", 17);
		expect(legacy.getAbilityScoreBreakdown("str").components).toEqual([{source: "base", label: "Unallocated base (manual / unknown history)", amount: 17}]);
	});

	test("does not count a feat's nested receipt twice and labels its exact owner/level", () => {
		const state = new State();
		const stored = acquireFeat(state, {ability: "str"}, "feat:four");
		state.recordLevelChoice({
			level: 6,
			class: fighter,
			classLevel: 4,
			decisions: [
				{semanticKey: "feat:four", type: "feat", selection: {name: feat.name, source: feat.source}, meta: {featId: stored.id}},
				{semanticKey: "feat:four.ability", parentSemanticKey: "feat:four", type: "nestedAbility", receipt: {effects: [{type: "abilityDelta", ability: "str", amount: 2, before: 10}]}},
			],
		});
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components).toHaveLength(2);
		expect(breakdown.components[1]).toMatchObject({amount: 2, label: "Ability Score Improvement [XPHB] - Fighter [PHB] level 4 (character level 6); acquisition 1"});
		expect(sum(breakdown.components)).toBe(12);
	});

	test("consumes the existing actual abilityDelta contract and deduplicates mirrored parent/child receipts", () => {
		const state = new State();
		state.setAbilityBase("str", 20);
		const effect = {type: "abilityDelta", sourceDecisionKey: "asi:four", ability: "str", amount: 1, before: 19};
		state.recordLevelChoice({
			level: 4,
			class: fighter,
			classLevel: 4,
			decisions: [
				{semanticKey: "asi:four", type: "asi", label: "Ability Score Improvement", selection: {str: 2}, receipt: {effects: [effect]}},
				{semanticKey: "asi:four.child", parentSemanticKey: "asi:four", type: "nestedAbility", receipt: {effects: [effect]}},
			],
		});
		state.recordLevelChoice({
			level: 8,
			class: fighter,
			classLevel: 8,
			decisions: [{semanticKey: "asi:eight", type: "asi", label: "Ability Score Improvement", selection: {str: 2}, receipt: {effects: [{...effect, sourceDecisionKey: "asi:eight", amount: 0, before: 20}]}}],
		});
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(c => c.source === "acquisition").map(c => c.amount)).toEqual([1, 0]);
		expect(breakdown.components[0].amount).toBe(19);
		expect(sum(breakdown.components)).toBe(20);
	});

	test("uses linked ability evidence when an acquisition's selected target is no longer stored", () => {
		const state = new State();
		state.setAbilityBase("str", 20);
		const stored = acquireFeat(state, {ability: "str"}, "capped");
		const decision = {
			semanticKey: "capped.ability",
			parentSemanticKey: "capped",
			type: "nestedAbility",
			selection: "str",
			meta: {descriptorRules: {featAbilityChoice: true}},
		};
		decision.receipt = {effects: globalThis.CharacterSheetProgression.getFeatAbilityDecisionEffects(decision, state)};
		state.recordLevelChoice({level: 4,
			class: fighter,
			classLevel: 4,
			decisions: [
				{semanticKey: "capped", type: "feat", meta: {featId: stored.id}},
				decision,
				{semanticKey: "capped.mirror",
					parentSemanticKey: "capped",
					type: "nestedAbility",
					receipt: {
						effects: [{type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability: "str", amount: 2}],
					}},
			]});
		state._data.feats[0].choices = null;
		let breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([0]);
		expect(breakdown.components).toHaveLength(2);
		expect(sum(breakdown.components)).toBe(20);
		delete state._data.feats[0].appliedEffects;
		breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components[1].amount).toBe(0);
		expect(sum(breakdown.components)).toBe(20);
	});

	test("distinguishes evidenced species and background receipts, leaving an honest origin residual", () => {
		const state = new State();
		state.setAbilityBonus("str", 4);
		state._data.characterBase = {v: 1,
			decisions: ["race", "background"].map((ownerType, index) => ({
				semanticKey: `origin:${ownerType}`,
				type: "nestedAbility",
				label: "Ability increase",
				provenance: {ownerType, ownerName: index ? "Soldier [XPHB]" : "Dwarf [PHB]"},
				receipt: {effects: [{type: "abilityBonusDelta", ability: "str", amount: index ? 1 : 2, before: 0}]},
			}))};
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.slice(1).map(c => [c.label, c.amount])).toEqual([
			["Ability increase - Species: Dwarf [PHB]", 2],
			["Ability increase - Background: Soldier [XPHB]", 1],
			["Species / background / manual (unattributed)", 1],
		]);
		expect(sum(breakdown.components)).toBe(14);
	});

	test("preserves public bonus shape, override/cap ordering, active bonus, negative modifier and floored drain", () => {
		const state = new State();
		acquireFeat(state, {ability: "str"}, "first");
		state._data.customModifiers.abilityScores = {str: -1};
		state._data.itemAbilityOverrides = {static: {str: 22}};
		state.setSetting("enforceAbilityScoreCap", true);
		state._data.activeStates = [{active: true, name: "Mutagen", customEffects: [{type: "abilityScoreBonus", ability: "str", value: 3}, {type: "abilityDamage", target: "str", value: 30}]}];
		const bonus = state.getAbilityBonusBreakdown("str");
		expect(Object.keys(bonus).sort()).toEqual(["ability", "base", "bonus", "contributions", "total"]);
		expect(bonus.contributions.map(c => [c.label, c.amount])).toEqual([
			["Custom Modifier", -1], ["Item (set score)", 11], ["Ability Score Cap", -2], ["Mutagen", 3], ["Ability damage", -23],
		]);
		expect(sum(bonus.contributions)).toBe(bonus.bonus);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.total).toBe(state.getAbilityScore("str"));
		expect(breakdown.total).toBe(0);
		expect(sum(breakdown.components)).toBe(0);
	});

	test("preserves Wild Shape replacement and Primal Champion totals with acquired feats", () => {
		const state = new State();
		acquireFeat(state, {ability: "str"}, "first");
		state._getActiveWildShapeState = () => ({beastData: {abilities: {str: 18}}});
		let breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.at(-1)).toMatchObject({source: "wildShape", amount: 6, isReplacement: true});
		expect(sum(breakdown.components)).toBe(18);
		state._getActiveWildShapeState = () => null;
		state._data.classes = [{name: "Barbarian", level: 20}];
		breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.at(-1)).toMatchObject({source: "primalChampion", amount: 4});
		expect(sum(breakdown.components)).toBe(state.getAbilityScore("str"));
	});

	test("does not mistake a descriptor-only nested receipt for actual capped evidence", () => {
		const state = new State();
		state.recordLevelChoice({
			level: 4,
			class: fighter,
			decisions: [{semanticKey: "legacy-child", type: "nestedAbility", label: "Legacy choice", receipt: {effects: [{type: "abilityDelta", ability: "str", amount: 2}]}}],
		});
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components[1]).toMatchObject({label: expect.stringContaining("Legacy choice"), amount: null});
		expect(sum(breakdown.components)).toBe(10);
	});

	test("Respec candidate/Apply/reload/Undo recompute acquired feat disclosure, never a cached or sibling total", async () => {
		const state = new State();
		const cls = {
			name: "Fighter",
			source: "XPHB",
			hd: {faces: 10},
			classFeatures: ["Ability Score Improvement|Fighter|XPHB|4", "Ability Score Improvement|Fighter|XPHB|8"],
		};
		const subclass = {name: "Champion", shortName: "Champion", source: "XPHB"};
		state.setSetting("thelemar_asiFeat", false);
		state.addClass({...cls, level: 8, subclass});
		for (let level = 1; level <= 8; level++) state.recordLevelChoice({level, class: cls, classLevel: level, choices: level === 3 ? {subclass} : {}});
		const page = {
			getState: () => state,
			getClasses: () => [cls],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSkillsList: () => [],
			getFeats: () => [feat],
			getSpells: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: async () => {},
			renderCharacter: () => {},
		};
		const qb = Object.create(QuickBuild.prototype);
		qb._state = state;
		qb._page = page;
		const choices = {ability: {str: 1, dex: 1}, abilityOption: 1};
		for (const level of [4, 8]) {
			qb._applyAsiOrFeat({mode: "feat", feat: copy(feat), featChoices: copy(choices)}, cls, level, cls);
			state.updateLevelChoice(level, {feat: {name: feat.name, source: feat.source}, featChoices: choices});
		}
		globalThis.CharacterSheetProgression.syncCanonicalDecisions({page, state});
		const respec = new globalThis.CharacterSheetRespec({state, page});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const parent = respec._engine.manifest.decisions.find(d => d.classLevel === 8 && d.type === "asiOrFeat");
		const child = respec._engine.manifest.decisions.find(d => d.type === "nestedAbility" && d.parentSemanticKey === parent.semanticKey);
		respec._engine.stageGraphMutation(child.id, ["con", "wis"], {
			reverseParent: true,
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(child, ["con", "wis"], child.options, candidate),
		});
		expect(state.getAbilityScoreBreakdown("str").components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([1, 1]);
		expect(respec._state.getAbilityScoreBreakdown("str").components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([1]);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		const applied = state.getAbilityScoreBreakdown("str");
		expect(applied.total).toBe(11);
		expect(applied.components.filter(c => c.source === "featAcquisition")).toHaveLength(1);
		expect(State.deserialize(state.serialize()).getAbilityScoreBreakdown("str")).toEqual(applied);
		await respec._engine.undo();
		expect(state.getAbilityScoreBreakdown("str").components.filter(c => c.source === "featAcquisition").map(c => c.amount)).toEqual([1, 1]);
	});
});
