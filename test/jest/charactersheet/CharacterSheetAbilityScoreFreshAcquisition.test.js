import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

const State = globalThis.CharacterSheetState;
const Builder = globalThis.CharacterSheetBuilder;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const LevelUp = globalThis.CharacterSheetLevelUp;
const fixture = JSON.parse(fs.readFileSync("test/jest/charactersheet/fixtures/round67-score-provenance.json", "utf8"));
const book = JSON.parse(fs.readFileSync("data/class/class-barbarian.json", "utf8"));
const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const classes = [...book.class, ...brew.class.filter(cls => cls.name === "Barbarian")];
const species = JSON.parse(fs.readFileSync("data/races.json", "utf8"));
const features = [...book.classFeature, ...brew.classFeature];
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const tgtt = classes.find(cls => cls.source === "TGTT");
const resilient = feats.find(feat => feat.name === "Resilient" && feat.source === "PHB");
const boon = feats.find(feat => feat.name === "Boon of Irresistible Offense" && feat.source === "XPHB");
const copy = value => JSON.parse(JSON.stringify(value));
const numeric = breakdown => breakdown.components.filter(row => Number.isFinite(row.amount));
const amountSum = rows => rows.reduce((total, row) => total + row.amount, 0);

function pageFor (state) {
	state.setClassCatalog(classes);
	state.setClassFeatureCatalog(features, [], []);
	return {
		getState: () => state,
		getClasses: () => classes,
		getClassFeatures: () => features,
		_classFeatures: features,
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => feats,
		getSpells: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
	};
}

async function freshBuilder ({
	race = fixture.state.race, subrace = null, background = null, choices = {},
	racialChoices = {"Dendulra|TGTT": {choose_0_0: "dex", choose_0_0_amount: 1}},
	abilitySetIndices = {}, tasha = null,
} = {}) {
	const state = new State();
	const page = pageFor(state);
	const init = jest.spyOn(Builder.prototype, "_init").mockImplementation(() => {});
	const builder = new Builder(page);
	init.mockRestore();
	builder._selectedRace = copy(race);
	builder._selectedSubrace = subrace && copy(subrace);
	builder._selectedBackground = background && copy(background);
	builder._selectedClass = tgtt;
	builder._selectedRacialAbilityChoices = racialChoices;
	builder._selectedRacialAbilitySetIdx = abilitySetIndices;
	builder._useTashasRules = !!tasha;
	builder._tashasAbilityBonuses = tasha || {};
	builder._selectedAbilityBonuses = choices;
	// Controlled legal point-buy reconstruction, not the user's unrecorded method.
	builder._abilityMethod = "pointbuy";
	builder._abilityScores = {str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8};
	for (const step of [1, 2, 3, 4]) {
		builder._currentStep = step;
		builder._applyCurrentStep();
	}
	await builder._finishCharacterCore();
	return {state, page, builder};
}

describe("Round 67 genuine fresh export", () => {
	test("keeps the original channel and exact feat ownership, not a sum-only approximation", () => {
		// This fixture is a field reduction of the supplied export, not fabricated receipts.
		expect(fixture.sourceSha256).toBe("af4db4573726f0aa98f2205b574a539bdc98e80223da1eb3312a2cfb8e2688e9");
		const state = new State();
		pageFor(state);
		state.loadFromJson(copy(fixture.state));
		const before = state.serialize();
		const expected = {
			str: [15, 2, 2, 1, 1, 4],
			con: [14, 1, 2, 4],
			dex: [13, 1],
			cha: [8, 2],
			wis: [10, 1],
			int: [12],
		};
		for (const [ability, amounts] of Object.entries(expected)) {
			const breakdown = state.getAbilityScoreBreakdown(ability);
			expect(numeric(breakdown).map(row => row.amount)).toEqual(amounts);
			expect(amountSum(numeric(breakdown))).toBe(breakdown.total);
			expect(breakdown.components[0].label).toBe("Unitemized score");
			expect(breakdown.components.map(row => row.label).join(" ")).not.toMatch(/ability\[|dendulra\|tgtt|or Feat/);
		}
		expect(state.getAbilityBase("dex")).toBe(13);
		expect(state.getAbilityBase("cha")).toBe(8);
		const wisdom = state.getAbilityScoreBreakdown("wis").components;
		expect(wisdom.filter(row => row.source === "featAcquisition")).toEqual([
			expect.objectContaining({label: "Ashbound Initiate [FoEQuickstone] - Barbarian [TGTT] level 4", amount: 1}),
		]);
		expect(wisdom).toHaveLength(2);
		const strength = state.getAbilityScoreBreakdown("str").components;
		expect(strength.filter(row => row.label.includes("Boon of"))).toHaveLength(1);
		expect(strength.find(row => row.label.includes("Boon of")).label).toContain("level 19");
		expect(state.getAbilityScoreBreakdown("dex").components).toContainEqual(expect.objectContaining({
			label: "Species: Dendulra [TGTT]", amount: null,
		}));
		expect(state.serialize()).toBe(before);
		const loaded = State.deserialize(before);
		pageFor(loaded);
		const loadedBefore = loaded.serialize();
		for (const ability of Object.keys(expected)) {
			expect(loaded.getAbilityScoreBreakdown(ability)).toEqual(state.getAbilityScoreBreakdown(ability));
		}
		expect(loaded.serialize()).toBe(loadedBefore);
		expect(loaded.getCharacterBase().decisions[1].receipt).toEqual(fixture.state.characterBase.decisions[1].receipt);
	});
});

describe("Round 67 actual creation and progression writers", () => {
	test("Builder captures fixed/chosen origin transitions and creation input before canonical sync", async () => {
		const {state, page} = await freshBuilder();
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(state.getAbilityScore("dex")).toBe(14);
		expect(state.getAbilityScore("cha")).toBe(10);
		const effects = state.getCharacterBase().decisions.flatMap(decision => decision.receipt?.effects || []);
		expect(effects).toContainEqual(expect.objectContaining({type: "abilityBonusDelta", ability: "dex", before: 0, after: 1, amount: 1}));
		expect(effects).toContainEqual(expect.objectContaining({type: "abilityBonusDelta", ability: "cha", before: 0, after: 2, amount: 2}));
		for (const [ability, amounts] of [["dex", [13, 1]], ["cha", [8, 2]]]) {
			const rows = numeric(state.getAbilityScoreBreakdown(ability));
			expect(rows.map(row => row.amount)).toEqual(amounts);
			expect(rows[0].label).toBe("Starting score");
			expect(rows[1].label).toBe("Species: Dendulra [TGTT]");
		}
		const serialized = state.serialize();
		expect(State.deserialize(serialized).getAbilityScoreBreakdown("dex")).toEqual(state.getAbilityScoreBreakdown("dex"));
		state.setAbilityBase("dex", 17);
		expect(state.getAbilityScoreBreakdown("dex").components[0].label).toBe("Unitemized score");
	});

	test("the real background writer owns an eligible distribution, not species defaults", async () => {
		const backgrounds = JSON.parse(fs.readFileSync("data/backgrounds.json", "utf8")).background;
		const soldier = backgrounds.find(background => background.name === "Soldier" && background.source === "XPHB");
		const {state} = await freshBuilder({
			race: {name: "Human", source: "XPHB"},
			background: soldier,
			choices: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
		});
		expect(numeric(state.getAbilityScoreBreakdown("str"))).toEqual([
			expect.objectContaining({amount: 15}),
			expect.objectContaining({label: "Background: Soldier [XPHB]", amount: 2}),
		]);
	});

	test("the actual Tasha writer replaces authored fixed/selected grants and does not revive stale origin receipts", async () => {
		const {state, builder} = await freshBuilder();
		builder._useTashasRules = true;
		builder._tashasAbilityBonuses = {two: "str", two_amount: 2, one: "wis", one_amount: 1};
		builder._currentStep = 4;
		builder._applyCurrentStep();
		await builder._finishCharacterCore();
		expect(state.getAbilityScore("cha")).toBe(8);
		expect(state.getAbilityScore("dex")).toBe(13);
		expect(numeric(state.getAbilityScoreBreakdown("str")).map(row => row.amount)).toEqual([15, 2]);
		expect(state.getAbilityScoreBreakdown("dex").components).toEqual([
			expect.objectContaining({label: "Starting score", amount: 13}),
		]);
		const effects = state.getCharacterBase().decisions.filter(decision => decision.meta?.originAbilityObservationVersion)
			.flatMap(decision => decision.receipt?.effects || []);
		expect(effects.filter(effect => effect.type === "abilityBonusDelta").map(effect => effect.ability)).toEqual(["str", "wis"]);
		const beforeCaseChange = state.getAbilityScoreBreakdown("cha");
		const root = state._data.characterBase.decisions.find(decision => decision.type === "originRace");
		expect(root.provenance.ownerUid.toLowerCase()).toBe("dendulra|tgtt");
		root.provenance.ownerUid = root.provenance.ownerUid.toUpperCase();
		expect(state.getAbilityScoreBreakdown("cha")).toEqual(beforeCaseChange);
		expect(State.deserialize(state.serialize()).getAbilityScoreBreakdown("str")).toEqual(state.getAbilityScoreBreakdown("str"));
	});

	test("actual chosen alternatives, subrace writes, and skipped stale background allocations have independent controls", async () => {
		const alternative = brew.race.find(race => race.name === "Nahalud" && race.source === "TGTT");
		expect(alternative).toBeDefined();
		const uid = `${alternative.name}|${alternative.source}`;
		const weighted = alternative.ability[1].choose.weighted;
		const selected = weighted.from.slice(0, weighted.weights.length);
		const racialChoices = {[uid]: Object.fromEntries(selected.flatMap((ability, index) =>
			[[`choose_1_${index}`, ability], [`choose_1_${index}_amount`, weighted.weights[index]]]))};
		const fresh = await freshBuilder({race: alternative, racialChoices, abilitySetIndices: {[uid]: 1}});
		for (const [index, ability] of selected.entries()) {
			const rows = numeric(fresh.state.getAbilityScoreBreakdown(ability));
			expect(rows.at(-1)).toMatchObject({label: `Species: ${alternative.name} [${alternative.source}]`, amount: weighted.weights[index]});
		}
		const elf = species.race.find(race => race.name === "Elf" && race.source === "PHB");
		const high = species.subrace.find(race => race.raceName === "Elf" && race.source === "PHB" && race.ability?.[0]?.int === 1);
		expect(high).toBeDefined();
		const subrace = await freshBuilder({race: elf, subrace: high, racialChoices: {}});
		expect(numeric(subrace.state.getAbilityScoreBreakdown("int")).at(-1)).toMatchObject({
			label: `Species: ${high.name} [${high.source}]`, amount: 1,
		});
		const backgrounds = JSON.parse(fs.readFileSync("data/backgrounds.json", "utf8")).background;
		const soldier = backgrounds.find(background => background.name === "Soldier" && background.source === "XPHB");
		const skipped = await freshBuilder({background: soldier, choices: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1}});
		expect(skipped.state.getAbilityScore("str")).toBe(15);
		expect(skipped.state.getCharacterBase().decisions.flatMap(decision => decision.receipt?.effects || [])
			.filter(effect => effect.ownerType === "background" && effect.type === "abilityBonusDelta")).toEqual([]);
	});

	test("QuickBuild's real apply/sync retains ordinary ASIs plus the paired real Resilient feat", async () => {
		const {state, page} = await freshBuilder();
		const qb = new QuickBuild(page);
		qb._resetSelections();
		qb._fromLevel = 1;
		qb._targetLevel = 20;
		qb._classAllocations = [{className: tgtt.name, classSource: tgtt.source, classData: tgtt, currentLevel: 1, targetLevel: 20}];
		qb._analyzeLevels();
		const choice = {ability: "wis"};
		qb._selections.asi = {
			Barbarian_4: {mode: "asi", isBoth: true, abilityChoices: {str: 2}, feat: {...copy(resilient), _featChoices: choice}, featChoices: choice},
			Barbarian_8: {mode: "asi", abilityChoices: {str: 2}},
			Barbarian_12: {mode: "asi", abilityChoices: {str: 1, con: 1}},
			Barbarian_16: {mode: "asi", abilityChoices: {con: 2}},
			Barbarian_19: {mode: "feat", feat: copy(boon), featChoices: {ability: "str"}},
		};
		await qb._applyQuickBuild();
		const stored = state.getFeats().find(feat => feat.name === "Resilient");
		expect(stored.appliedEffects.abilityDeltas).toEqual({wis: 1});
		expect(stored.appliedEffects.abilityTransitions.wis).toMatchObject({before: 10, after: 11, amount: 1});
		expect(stored.appliedEffects.abilityTransitions.wis).toMatchObject({requestedAmount: 1, maximum: 20});
		expect(state.getFeats().find(feat => feat.name === boon.name).appliedEffects.abilityTransitions.str)
			.toMatchObject({before: 20, after: 21, amount: 1, requestedAmount: 1, maximum: 30});
		expect(state.getAbilityScore("str")).toBe(25);
		expect(state.getAbilityScore("con")).toBe(21);
		expect(numeric(state.getAbilityScoreBreakdown("str")).map(row => row.amount)).toEqual([15, 2, 2, 1, 1, 4]);
		expect(state.getAbilityScoreBreakdown("wis").components).toEqual([
			expect.objectContaining({label: "Starting score", amount: 10}),
			expect.objectContaining({label: "Resilient [PHB] - Barbarian [TGTT] level 4", amount: 1}),
		]);
		const loaded = State.deserialize(state.serialize());
		pageFor(loaded);
		expect(loaded.getAbilityScoreBreakdown("str")).toEqual(state.getAbilityScoreBreakdown("str"));
	});

	test("LevelUp supplies genuine targeted capped-zero feat transitions, not final-score subtraction", async () => {
		const {state, page} = await freshBuilder();
		state.setAbilityBase("wis", 20);
		const levelUp = new LevelUp(page);
		for (const newLevel of [2, 3, 4]) {
			await levelUp._applyLevelUp({
				classEntry: state.getClasses()[0],
				classData: tgtt,
				newLevel,
				asiChoices: newLevel === 4 ? {str: 2} : null,
				selectedFeat: newLevel === 4 ? {...copy(resilient), _featChoices: {ability: "wis"}} : null,
				newFeatures: [],
				hpMethod: "average",
				selectedOptionalFeatures: {},
				selectedFeatureOptions: {},
			});
		}
		const feat = state.getFeats().find(candidate => candidate.name === "Resilient");
		expect(feat.appliedEffects.abilityTransitions.wis).toMatchObject({before: 20, after: 20, amount: 0});
		const row = state.getAbilityScoreBreakdown("wis").components.find(component => component.source === "featAcquisition");
		expect(row).toMatchObject({amount: 0, maximum: 20, requestedAmount: 1});
		expect(state.getAbilityScoreBreakdown("str").components.find(component => component.source === "acquisition").amount).toBe(2);
	});

	test.each([
		["Boon of Irresistible Offense", "XPHB", "str", 29, 30, 30],
		["Durable", "PHB", "con", 20, 20, 20],
		["Resilient", "PHB", "wis", 20, 20, 20],
	])("actual %s writer supplies its exact request/max, even when the lean wrapper lacks authored ability data", (name, source, ability, before, after, maximum) => {
		const state = new State();
		const selected = copy(feats.find(feat => feat.name === name && feat.source === source));
		const choices = selected.ability.some(entry => entry.choose) ? {ability} : {};
		selected.choices = choices;
		state.setAbilityBase(ability, before);
		expect(state.addFeat(selected)).toBe(true);
		globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, selected, choices);
		const stored = state.getFeats()[0];
		expect(stored.ability).toBeUndefined();
		expect(stored.appliedEffects.abilityTransitions[ability]).toMatchObject({
			before, after, amount: after - before, requestedAmount: 1, maximum,
		});
	});

	test.each(["same maximum", "missing request", "different maximum", "discontinuous"])(
		"same-instance observations preserve only demonstrable merged cap context: %s", mode => {
			const state = new State();
			const selected = {...copy(resilient), choices: {ability: "wis"}};
			state.setAbilityBase("wis", 17);
			expect(state.addFeat(selected)).toBe(true);
			const apply = () => globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, selected, selected.choices);
			apply();
			const prior = state._data.feats[0].appliedEffects.abilityTransitions.wis;
			if (mode === "missing request") delete prior.requestedAmount;
			if (mode === "different maximum") prior.maximum = 30;
			if (mode === "discontinuous") state.setAbilityBase("wis", 10);
			apply();
			const effects = state.getFeats()[0].appliedEffects;
			expect(effects.abilityDeltas.wis).toBe(2);
			const transition = effects.abilityTransitions.wis;
			if (mode === "discontinuous") {
				expect(transition).toBeUndefined();
			} else {
				expect(transition).toMatchObject({before: 17, after: 19, amount: 2});
				if (mode === "same maximum") expect(transition).toMatchObject({requestedAmount: 2, maximum: 20});
				else {
					expect(transition).not.toHaveProperty("requestedAmount");
					expect(transition).not.toHaveProperty("maximum");
				}
			}
			expect(State.deserialize(state.serialize()).getFeats()[0].appliedEffects).toEqual(effects);
		},
	);

	test("ambiguous historical repeat placement preserves independently proven own positive/zero deltas without crediting an unresolved mirror", () => {
		const state = new State();
		state.setAbilityBase("str", 18);
		const asiFeat = feats.find(feat => feat.name === "Ability Score Improvement" && feat.source === "XPHB");
		for (const sourceDecisionKey of ["first", "second"]) {
			const selected = {...copy(asiFeat), choices: {ability: "str"}, sourceDecisionKey};
			expect(state.addFeat(selected)).toBe(true);
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, selected, {ability: "str"});
		}
		const transition = copy(state.getFeats()[0].appliedEffects.abilityTransitions.str);
		state._data.feats.forEach(feat => { delete feat.sourceDecisionKey; });
		state.recordLevelChoice({level: 4,
			class: {name: "Barbarian", source: "TGTT"},
			classLevel: 4,
			decisions: [
				{semanticKey: "ambiguous", type: "feat", selection: {name: asiFeat.name, source: asiFeat.source}},
				{semanticKey: "ambiguous.ability",
					parentSemanticKey: "ambiguous",
					type: "nestedAbility",
					label: "ability[0]",
					receipt: {effects: [{type: "abilityDelta", ability: "str", ...transition}]}},
			]});
		const before = state.serialize();
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(row => row.source === "featAcquisition").map(row => row.amount)).toEqual([2, 0]);
		expect(breakdown.components.filter(row => row.source === "featAcquisition").every(row =>
			row.label.includes("level unrecorded") && !row.label.includes("level 4"))).toBe(true);
		expect(breakdown.components.find(row => row.source === "acquisition").amount).toBeNull();
		expect(numeric(breakdown).map(row => row.amount)).toEqual([18, 2, 0]);
		expect(amountSum(numeric(breakdown))).toBe(20);
		expect(state.serialize()).toBe(before);
	});
});

describe("Round 67 source-qualified Champion", () => {
	test.each([["PHB", 24, 3], ["XPHB", 25, 4], ["TGTT", 25, 4]])("%s resolves its actual inherited source", (source, max, gain) => {
		const state = new State();
		pageFor(state);
		state.addClass({name: "Barbarian", source, level: 20});
		state.setAbilityBase("str", 21);
		state.setAbilityBase("con", 17);
		expect(state.getAbilityScore("con")).toBe(21);
		expect(state.getAbilityScoreMax("str")).toBe(max);
		expect(state.getAbilityScore("str")).toBe(21 + gain);
		expect(state.getAbilityScoreBreakdown("str").components.find(row => row.source === "primalChampion")).toMatchObject({
			amount: gain, requestedAmount: 4, maximum: max,
		});
		state.setAbilityBase("str", 26);
		expect(state.getAbilityScore("str")).toBe(26);
		state.setSetting("enforceAbilityScoreCap", true);
		expect(state.getAbilityScore("str")).toBe(max);
		state.setAbilityScoreMaximum("str", 30);
		expect(state.getAbilityScore("str")).toBe(30);
	});

	test("missing source can resolve by the unique stored/catalog UID; genuine ambiguity stays explicitly provisional", () => {
		const state = new State();
		pageFor(state);
		state._data.classes = [{name: "Barbarian", level: 20}];
		state._data.features = copy(fixture.state.features);
		state.setAbilityBase("str", 21);
		expect(state.getAbilityScore("str")).toBe(25);
		state._data.features.push(copy(book.classFeature.find(feature => feature.name === "Primal Champion" && feature.source === "PHB")));
		const before = state.serialize();
		expect(state.getAbilityScore("str")).toBe(24);
		expect(state.getAbilityScoreMax("str")).toBe(24);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.provisional).toBe(true);
		expect(breakdown.notes.join(" ")).toMatch(/Rules source unresolved/);
		expect(state.serialize()).toBe(before);
	});

	test("loading unique authored references resolves unknown/missing sources without mutating historical state", () => {
		const state = new State();
		state.addClass({name: "Barbarian", source: "UNKNOWN", level: 20, edition: "one"});
		state.setAbilityBase("str", 21);
		expect(state.getAbilityScoreBreakdown("str").provisional).toBe(true);
		expect(state.getAbilityScore("str")).toBe(24);
		const before = state.serialize();
		state.setClassCatalog([{name: "Barbarian", source: "UNKNOWN", classFeatures: [{classFeature: "Primal Champion|Barbarian|XPHB|20"}]}]);
		expect(state.getAbilityScore("str")).toBe(25);
		expect(state.getAbilityScoreBreakdown("str").provisional).toBeUndefined();
		expect(state.serialize()).toBe(before);
		state._data.classes[0].source = null;
		state.setClassCatalog(classes.filter(cls => cls.source === "XPHB"));
		expect(state.getAbilityScore("str")).toBe(25);
		state.setClassCatalog(classes);
		expect(state.getAbilityScoreBreakdown("str").provisional).toBe(true);
	});

	test("known XPHB preserves additive-item/static/global-cap/active-bonus/damage stage order", () => {
		const state = new State();
		pageFor(state);
		state.addClass({name: "Barbarian", source: "XPHB", level: 20});
		state.setAbilityBase("str", 21);
		state.setAbilityBonus("str", 1);
		state._data.customModifiers.abilityScores = {str: 1};
		state._data.directAbilityBonuses = {str: 1};
		state._data.itemAbilityOverrides = {bonus: {str: 2}, static: {str: 28}};
		state._data.customModifiers.abilityScoreStatic = {str: 29};
		expect(state.getAbilityScore("str")).toBe(29);
		expect(numeric(state.getAbilityScoreBreakdown("str")).find(row => row.source === "primalChampion").amount).toBe(1);
		state.setSetting("enforceAbilityScoreCap", true);
		state.setAbilityScoreMaximum("str", 25);
		state._data.activeStates = [{id: "mutagen",
			active: true,
			type: "mutagen",
			customEffects: [
				{type: "abilityScoreBonus", ability: "str", value: 2},
				{type: "abilityDamage", target: "str", value: 3},
			]}];
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(state.getAbilityScore("str")).toBe(24);
		expect(numeric(breakdown).find(row => row.source === "primalChampion").amount).toBe(4);
		expect(numeric(breakdown).find(row => row.source === "cap").amount).toBe(-5);
		expect(amountSum(numeric(breakdown))).toBe(24);
		state.setAbilityScoreMaximum("str", 30);
		expect(state.getAbilityScore("str")).toBe(29);
	});
});
