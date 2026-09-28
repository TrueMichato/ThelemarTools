import fs from "node:fs";
import path from "node:path";
import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const {CharacterSheetBuilder, CharacterSheetRespec, CharacterSheetState} = globalThis;
const copy = value => JSON.parse(JSON.stringify(value));
const readData = file => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `data/${file}`), "utf8"));
const races = readData("races.json").race;
const backgrounds = readData("backgrounds.json").background;
const getRace = (name, source) => copy(races.find(race => race.name === name && race.source === source));
const getBackground = (name, source) => copy(backgrounds.find(background => background.name === name && background.source === source));
const CLASS = {
	name: "Barbarian",
	source: "XPHB",
	hd: {number: 1, faces: 12},
	classFeatures: [],
	startingProficiencies: {skills: []},
};

function build ({raceName = "Half-Elf", raceSource = "PHB", backgroundName = "Outlander", backgroundSource = "PHB", classSource = "XPHB", racePicks = ["str", "dex"], backgroundPicks = null, tashasBonuses = null, applyAbilities = false} = {}) {
	const state = new CharacterSheetState();
	const race = getRace(raceName, raceSource);
	const background = getBackground(backgroundName, backgroundSource);
	const classData = {...CLASS, source: classSource};
	const page = {
		getState: () => state,
		getClasses: () => [copy(classData)],
		getRaces: () => [copy(race)],
		getBackgrounds: () => [copy(background)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder.resetSelections();
	builder._page = page;
	builder._state = state;
	builder._selectedRace = race;
	builder._selectedBackground = background;
	builder._selectedClass = copy(classData);
	if (race.name === "Half-Elf" && race.source === "PHB") builder._selectedRacialSkills = ["Athletics", "Arcana"];
	builder._applyClassFeatures = () => {};
	builder._clearClassApplication = () => {};
	builder._getClassFeatureLanguageGrants = () => ({autoLanguages: []});
	if (racePicks?.length) {
		builder._selectedRacialAbilityChoices[`${race.name}|${race.source}`] = Object.fromEntries(
			racePicks.flatMap((ability, ix) => [
				[`choose_0_${ix}`, ability],
				[`choose_0_${ix}_amount`, 1],
			]),
		);
	}
	if (backgroundPicks?.length) {
		builder._selectedAbilityBonuses = Object.fromEntries(backgroundPicks.flatMap(([ability, amount], ix) => [
			[`bg_${ix}`, ability],
			[`bg_${ix}_weight`, amount],
		]));
	}
	for (const step of [1, 2, 3]) {
		builder._currentStep = step;
		builder._applyCurrentStep();
	}
	if (applyAbilities) {
		if (tashasBonuses) {
			builder._useTashasRules = true;
			builder._tashasAbilityBonuses = copy(tashasBonuses);
		}
		builder._currentStep = 4;
		builder._applyCurrentStep();
	}
	return {state, builder, page};
}

function reload (state) {
	const loaded = new CharacterSheetState();
	expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
	return loaded;
}

function openRespec (state, page) {
	const respec = new CharacterSheetRespec({page: {...page, getState: () => state}, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return respec;
}

function getRepairButton (card) {
	const find = element => {
		if (element?.dataset?.respecBackgroundAbilityRepair) return element;
		for (const child of element?._children || []) {
			const match = find(child);
			if (match) return match;
		}
		return null;
	};
	return find(card);
}

function findByClass (root, clazz) {
	if (root?._clazz?.split(" ").includes(clazz)) return root;
	for (const child of root?._children || []) {
		const match = findByClass(child, clazz);
		if (match) return match;
	}
	return null;
}

function findAll (root, predicate) {
	return [
		...(predicate(root) ? [root] : []),
		...(root?._children || []).flatMap(child => findAll(child, predicate)),
	];
}

const getAbilityDecisions = (respec, ownerType) => respec._engine.manifest.base.decisions
	.filter(decision => decision.provenance?.ownerType === ownerType
		&& (decision.provenance?.grantKind === "ability" || decision.meta?.originAbilityDistribution));

const withoutRegeneratedModifierIds = stateJson => ({
	...stateJson,
	namedModifiers: stateJson.namedModifiers.map(({id, ...modifier}) => modifier),
});

describe("Respec uses the actual owner of mixed-edition origin ASIs", () => {
	it("adopts both Builder-recorded PHB racial picks through Apply, reload, and Undo", async () => {
		const {state, page} = build();
		expect(state.getLevelHistoryEntry(1).class).toEqual({name: "Barbarian", source: "XPHB"});
		expect(state.getBaseRaceUserChoices().selectedAbilityChoices["Half-Elf|PHB"]).toMatchObject({
			choose_0_0: "str",
			choose_0_1: "dex",
		});
		expect(state.toJson().abilityBonuses).toMatchObject({str: 1, dex: 1, cha: 2});
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		const [decision] = getAbilityDecisions(respec, "race");
		expect(decision).toMatchObject({
			type: "nestedAbility",
			count: 2,
			selection: ["str", "dex"],
			status: "resolved",
		});
		expect(getAbilityDecisions(respec, "background")).toEqual([]);
		expect(respec._renderBaseCard().outerHTML).toContain("Strength +1");
		expect(respec._renderBaseCard().outerHTML).toContain("Dexterity +1");
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setName("Unrelated edit"));
		expect(loaded.toJson()).toEqual(before);
		await respec._engine.apply();
		expect(loaded.toJson().abilityBonuses).toMatchObject({str: 1, dex: 1, cha: 2});
		const reopened = openRespec(reload(loaded), page);
		expect(getAbilityDecisions(reopened, "race")[0]).toMatchObject({
			selection: ["str", "dex"],
			status: "resolved",
		});
		reopened._engine.cancel();
		expect(await respec._engine.undo()).toBe(true);
		expect(withoutRegeneratedModifierIds(loaded.toJson())).toEqual(withoutRegeneratedModifierIds(before));
	});

	it("edits both racial picks with exact receipts without changing the fixed racial bonus", async () => {
		const {state, page} = build();
		const loaded = reload(state);
		const respec = openRespec(loaded, page);
		const before = loaded.toJson();
		const [decision] = getAbilityDecisions(respec, "race");
		expect(decision.receipt.effects).toMatchObject([
			{type: "abilityBonusDelta", ability: "str", amount: 1, before: 0},
			{type: "abilityBonusDelta", ability: "dex", amount: 1, before: 0},
		]);
		expect(await respec._stageSameRaceAbilityChoices({
			selectedAbilityChoices: {rc_0: "wis", rc_0_weight: 1, rc_1: "con", rc_1_weight: 1},
		})).toBe(true);
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, dex: 0, wis: 1, con: 1, cha: 2});
		expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
			selection: ["wis", "con"],
			status: "resolved",
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		expect(loaded.toJson()).toEqual(before);
		await respec._engine.apply();
		expect(loaded.getBaseRaceUserChoices().selectedAbilityChoices["Half-Elf|PHB"]).toMatchObject({
			choose_0_0: "wis", choose_0_1: "con",
		});
		const reopened = openRespec(reload(loaded), page);
		expect(getAbilityDecisions(reopened, "race")[0].selection).toEqual(["wis", "con"]);
		expect(await respec._engine.undo()).toBe(true);
		expect(withoutRegeneratedModifierIds(loaded.toJson())).toEqual(withoutRegeneratedModifierIds(before));
	});

	it("repairs a previously persisted first-pick-only receipt from recorded Builder choices", async () => {
		const {state, page} = build();
		const loaded = reload(state);
		const initial = openRespec(loaded, page);
		const decision = getAbilityDecisions(initial, "race")[0];
		initial._engine.cancel();
		loaded.getCharacterBase().decisions = [{
			...copy(decision),
			selection: "str",
			status: "missing",
			receipt: {
				version: 1,
				sourceDecisionKey: decision.semanticKey,
				effects: [{type: "abilityBonusDelta", ability: "str", amount: 1, before: 0}],
			},
		}];
		const respec = openRespec(loaded, page);
		const repaired = getAbilityDecisions(respec, "race")[0];
		expect(repaired.selection).toEqual(["str", "dex"]);
		expect(repaired.receipt.effects.map(effect => effect.ability)).toEqual(["str", "dex"]);
		await respec._stageSameRaceAbilityChoices({
			selectedAbilityChoices: {rc_0: "wis", rc_0_weight: 1, rc_1: "con", rc_1_weight: 1},
		});
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, dex: 0, wis: 1, con: 1, cha: 2});
		respec._engine.cancel();
	});

	it("keeps partial source-qualified racial picks invalid beside a stale resolved base ledger", async () => {
		const {state, page} = build();
		const loaded = reload(state);
		const initial = openRespec(loaded, page);
		const resolved = copy(getAbilityDecisions(initial, "race")[0]);
		initial._engine.cancel();
		loaded.getCharacterBase().decisions = [resolved];
		loaded.setBaseRaceUserChoices({
			...loaded.getBaseRaceUserChoices(),
			selectedAbilityChoices: {"Half-Elf|PHB": {choose_0_0: "str", choose_0_0_amount: 1}},
		});
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
			selection: ["str"],
			status: "invalid",
		});
		expect(respec._engine.getValidation().errors.length).toBeGreaterThan(0);
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setName("Unrelated edit"));
		expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
			selection: ["str"],
			status: "invalid",
		});
		expect(respec._engine.getValidation().errors.length).toBeGreaterThan(0);
		respec._engine.cancel();
		expect(loaded.toJson()).toEqual(before);
	});

	it("retains a saved resolved base decision when no choices belong to this race", () => {
		const {state, page} = build();
		const loaded = reload(state);
		const initial = openRespec(loaded, page);
		const resolved = copy(getAbilityDecisions(initial, "race")[0]);
		initial._engine.cancel();
		loaded.getCharacterBase().decisions = [resolved];
		loaded.setBaseRaceUserChoices({
			...loaded.getBaseRaceUserChoices(),
			selectedAbilityChoices: {"Half-Elf|XPHB": {choose_0_0: "wis"}},
		});
		const respec = openRespec(loaded, page);
		expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
			selection: ["str", "dex"],
			status: "resolved",
		});
		respec._engine.cancel();
	});

	it("replaces both racial picks and their receipt through the Half-Elf Change Species dialog", async () => {
		const {state, page} = build();
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		const modalInner = e_({tag: "div"});
		const originalShow = globalThis.CharacterSheetModal.pGetShow;
		const languagePicker = jest.spyOn(respec, "_renderLanguageChoicePickers").mockReturnValue({
			type: "language",
			isComplete: () => true,
			getSelections: () => ({0: ["Elvish"]}),
		});
		const skillPicker = jest.spyOn(respec, "_renderSkillChoicePickers").mockReturnValue({
			type: "skill",
			isComplete: () => true,
			getSelections: () => ["Athletics", "Arcana"],
		});
		globalThis.CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
		try {
			await respec._editRace(1, respec._state.getLevelHistoryEntry(1), null);
			const list = findByClass(modalInner, "charsheet__respec-feat-list");
			list._children[0].click();
			expect(skillPicker).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({name: "Half-Elf", source: "PHB"}), expect.any(Function));
			const selects = findAll(modalInner, element => element?._html?.startsWith("<select") && element._handlers.change);
			expect(selects).toHaveLength(2);
			["wis", "con"].forEach((ability, ix) => {
				selects[ix].value = ability;
				selects[ix]._handlers.change();
			});
			const changeButton = findByClass(modalInner, "charsheet__respec-btn-row")._children[1];
			expect(changeButton.disabled).toBe(false);
			await changeButton._handlers.click();
			expect(respec._state.getBaseRaceUserChoices().selectedAbilityChoices["Half-Elf|PHB"])
				.toMatchObject({choose_0_0: "wis", choose_0_1: "con"});
			expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, dex: 0, wis: 1, con: 1, cha: 2});
			expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
				selection: ["wis", "con"],
				status: "resolved",
				receipt: {effects: [
					expect.objectContaining({type: "abilityBonusDelta", ability: "wis", amount: 1, before: 0}),
					expect.objectContaining({type: "abilityBonusDelta", ability: "con", amount: 1, before: 0}),
				]},
			});
			expect(respec._engine.getValidation().errors).toEqual([]);
			expect(loaded.toJson()).toEqual(before);
			await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setName("Unrelated edit"));
			await respec._engine.apply();
			const persisted = reload(loaded);
			const reopened = openRespec(persisted, page);
			expect(getAbilityDecisions(reopened, "race")[0]).toMatchObject({
				selection: ["wis", "con"],
				status: "resolved",
				receipt: {effects: [
					expect.objectContaining({type: "abilityBonusDelta", ability: "wis", amount: 1, before: 0}),
					expect.objectContaining({type: "abilityBonusDelta", ability: "con", amount: 1, before: 0}),
				]},
			});
			expect(reopened._engine.getValidation().errors).toEqual([]);
			reopened._engine.cancel();
		} finally {
			globalThis.CharacterSheetModal.pGetShow = originalShow;
			languagePicker.mockRestore();
			skillPicker.mockRestore();
			if (respec._engine.isActive) respec._engine.cancel();
		}
	});

	it("stores a newly selected PHB race's two picker choices under its source-qualified owner", async () => {
		const {state, page} = build({raceName: "Half-Orc", racePicks: []});
		const respec = openRespec(reload(state), page);
		const origin = respec._engine.manifest.base.decisions.find(decision => decision.type === "originRace");
		const choices = {
			selectedSkills: ["Athletics", "Arcana"],
			selectedAbilityChoices: {
				rc_0: "str",
				rc_0_weight: 1,
				rc_1: "dex",
				rc_1_weight: 1,
				rc_abilitySetIndex: 0,
			},
		};
		await respec._engine.stageGraphMutation(origin.id, {name: "Half-Elf", source: "PHB"}, {
			apply: ({state: candidate}) => {
				const previous = respec._state;
				respec._state = candidate;
				try {
					respec._applyRaceChange(candidate.getLevelHistoryEntry(1), getRace("Half-Elf", "PHB"), choices);
				} finally {
					respec._state = previous;
				}
			},
		});
		expect(respec._state.getBaseRaceUserChoices().selectedAbilityChoices).toEqual({
			"Half-Elf|PHB": {
				choose_0_0: "str",
				choose_0_0_amount: 1,
				choose_0_1: "dex",
				choose_0_1_amount: 1,
			},
		});
		expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
			selection: ["str", "dex"],
			status: "resolved",
		});
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 1, dex: 1, con: 0, cha: 2});
		respec._engine.cancel();
	});

	it("keeps partial, duplicate, and foreign-origin racial picks distinct from two recorded choices", () => {
		const {state, page} = build();
		for (const [choices, expectedStatus, expectedSelection] of [
			[{choose_0_0: "str"}, "invalid", ["str"]],
			[{choose_0_0: "str", choose_0_1: "str"}, "invalid", ["str", "str"]],
			[null, "deferred", null],
		]) {
			const loaded = reload(state);
			loaded.setBaseRaceUserChoices({
				selectedAbilityChoices: {
					...(choices ? {"Half-Elf|PHB": choices} : {"Half-Elf|XPHB": {choose_0_0: "str", choose_0_1: "dex"}}),
				},
				selectedSkills: ["Athletics", "Arcana"],
			});
			const respec = openRespec(loaded, page);
			expect(getAbilityDecisions(respec, "race")[0]).toMatchObject({
				status: expectedStatus,
				selection: expectedSelection,
			});
			respec._engine.cancel();
		}
	});

	it("does not render or reapply choices belonging to a different race source", () => {
		const {state, page} = build();
		const loaded = reload(state);
		const choices = loaded.getBaseRaceUserChoices();
		loaded.setBaseRaceUserChoices({
			...choices,
			selectedAbilityChoices: {
				...choices.selectedAbilityChoices,
				"Half-Elf|XPHB": {choose_0_0: "wis", choose_0_0_amount: 1},
			},
		});
		const respec = openRespec(loaded, page);
		const summary = respec._renderBaseCard().outerHTML;
		expect(summary).toContain("Strength +1");
		expect(summary).toContain("Dexterity +1");
		expect(summary).not.toContain("Wisdom +1");
		respec._applyBackgroundChange(respec._state.getLevelHistoryEntry(1), getBackground("Outlander", "PHB"), {});
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 1, dex: 1, wis: 0, cha: 2});
		respec._engine.cancel();
	});

	it("does not require an ignored XPHB background ASI beside a PHB race with its own ASI", () => {
		const {state, page} = build({raceName: "Half-Orc", racePicks: [], backgroundName: "Sage", backgroundSource: "XPHB"});
		expect(state.getRace().source).toBe("PHB");
		expect(state.getBackground().source).toBe("XPHB");
		expect(state.getBaseBackgroundUserChoices().selectedAbilityBonuses).toBeUndefined();
		const loaded = reload(state);
		const respec = openRespec(loaded, page);
		expect(getAbilityDecisions(respec, "background")).toEqual([]);
		expect(getRepairButton(respec._renderBaseCard())).toBeNull();
		expect(respec._engine.getValidation().errors).toEqual([]);
		respec._engine.cancel();
	});

	it("does not apply stale XPHB background picks to a PHB race during Builder or a background change", () => {
		const {state, page} = build({
			raceName: "Half-Orc",
			racePicks: [],
			backgroundName: "Sage",
			backgroundSource: "XPHB",
			backgroundPicks: [["int", 2], ["wis", 1]],
			applyAbilities: true,
		});
		expect(state.toJson().abilityBonuses).toMatchObject({str: 2, con: 1, int: 0, wis: 0});
		expect(state.getBaseBackgroundUserChoices().selectedAbilityBonuses).toBeUndefined();
		const respec = openRespec(reload(state), page);
		const before = respec._state.toJson().abilityBonuses;
		const history = respec._state.getLevelHistoryEntry(1);
		respec._applyBackgroundChange(history, getBackground("Sage", "XPHB"), {});
		expect(respec._state.toJson().abilityBonuses).toEqual(before);
		expect(getAbilityDecisions(respec, "background")).toEqual([]);
		respec._engine.cancel();
	});

	it.each([
		{raceName: "Half-Orc", raceSource: "PHB", shouldOffer: false},
		{raceName: "Dwarf", raceSource: "XPHB", shouldOffer: true},
	])("background editor respects ASI ownership for $raceName|$raceSource", async ({raceName, raceSource, shouldOffer}) => {
		const {state, page} = build({raceName, raceSource, racePicks: [], backgroundName: "Sage", backgroundSource: "XPHB"});
		const respec = openRespec(reload(state), page);
		const modalInner = e_({tag: "div"});
		const originalShow = globalThis.CharacterSheetModal.pGetShow;
		const picker = jest.spyOn(respec, "_renderAbilityChoicePickers").mockReturnValue({
			type: "ability",
			isComplete: () => false,
		});
		globalThis.CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
		try {
			await respec._editBackground(1, respec._state.getLevelHistoryEntry(1), null);
			const list = findByClass(modalInner, "charsheet__respec-feat-list");
			expect(list?._children).toHaveLength(1);
			list._children[0].click();
			expect(picker).toHaveBeenCalledTimes(shouldOffer ? 1 : 0);
		} finally {
			globalThis.CharacterSheetModal.pGetShow = originalShow;
			picker.mockRestore();
			respec._engine.cancel();
		}
	});

	it("keeps all-PHB fixed ASIs independent of class edition", () => {
		const {state, page} = build({raceName: "Half-Orc", racePicks: [], classSource: "PHB"});
		const respec = openRespec(reload(state), page);
		expect(getAbilityDecisions(respec, "background")).toEqual([]);
		expect(respec._engine.getValidation().errors).toEqual([]);
		respec._engine.cancel();
	});

	it("continues to require missing XPHB background choices when the XPHB species has no ASI", () => {
		const {state, page} = build({raceName: "Dwarf", raceSource: "XPHB", racePicks: [], backgroundName: "Sage", backgroundSource: "XPHB"});
		const respec = openRespec(reload(state), page);
		expect(getAbilityDecisions(respec, "background")).toEqual([
			expect.objectContaining({type: "nestedConfiguration", required: true, status: "missing"}),
		]);
		expect(getRepairButton(respec._renderBaseCard())).not.toBeNull();
		respec._engine.cancel();
	});

	it("preserves actual XPHB background picks when an ASI-less XPHB species owns no racial bonus", () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundName: "Sage",
			backgroundSource: "XPHB",
			backgroundPicks: [["int", 2], ["wis", 1]],
			applyAbilities: true,
		});
		expect(state.toJson().abilityBonuses).toMatchObject({int: 2, wis: 1});
		const respec = openRespec(reload(state), page);
		expect(getAbilityDecisions(respec, "background").map(decision => decision.status)).toEqual(["resolved", "resolved", "resolved"]);
		expect(respec._engine.getValidation().errors).toEqual([]);
		respec._engine.cancel();
	});

	it("preserves Builder's separate free ASI evidence for an XPHB species and PHB background", () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(loaded.getBaseBackgroundUserChoices().selectedAbilityBonuses).toMatchObject({
			bg_0: "str", bg_1: "con",
		});
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 2, con: 1});
		expect(getAbilityDecisions(respec, "background")).toEqual([]);
		respec._engine.cancel();
		expect(loaded.toJson()).toEqual(before);
	});

	it("owns the saved free +2/+1 as two reversible origin choices through unrelated Apply, reload, and Undo", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		state.setAbilityBonus("wis", 4);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		const decisions = respec._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility);
		expect(decisions.map(decision => [decision.type, decision.status, decision.selection])).toEqual([
			["nestedConfiguration", "resolved", expect.objectContaining({weights: [2, 1]})],
			["nestedAbility", "resolved", "str"],
			["nestedAbility", "resolved", "con"],
		]);
		expect(decisions.map(decision => decision.provenance.ownerUid)).toEqual(["dwarf|xphb", "dwarf|xphb", "dwarf|xphb"]);
		expect(decisions.slice(1).map(decision => decision.receipt.effects[0])).toMatchObject([
			{type: "abilityBonusDelta", ability: "str", amount: 2, before: 0},
			{type: "abilityBonusDelta", ability: "con", amount: 1, before: 0},
		]);
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setName("Unrelated edit"));
		expect(loaded.toJson()).toEqual(before);
		await respec._engine.apply();
		expect(loaded.toJson().abilityBonuses).toMatchObject({str: 2, con: 1, wis: 4});
		const reopened = openRespec(reload(loaded), page);
		expect(reopened._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility)
			.map(decision => decision.status)).toEqual(["resolved", "resolved", "resolved"]);
		reopened._engine.cancel();
		expect(await respec._engine.undo()).toBe(true);
		expect(withoutRegeneratedModifierIds(loaded.toJson())).toEqual(withoutRegeneratedModifierIds(before));
	});

	it("adopts a canonical Builder save with recorded free picks but no owned bonus receipts", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["dex", 2], ["con", 1]],
			applyAbilities: true,
		});
		globalThis.CharacterSheetProgression.syncCanonicalDecisions({page, state});
		const saved = state.getCharacterBase().decisions.filter(decision => decision.meta?.originFreeAbility);
		expect(saved).toHaveLength(3);
		expect(saved.slice(1).every(decision =>
			!decision.receipt?.effects?.some(effect => effect.type === "abilityBonusDelta"),
		)).toBe(true);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(respec._engine.getValidation().errors).toEqual([]);
		expect(respec._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility)
			.slice(1).map(decision => decision.receipt.effects[0]))
			.toEqual([
				expect.objectContaining({type: "abilityBonusDelta", ability: "dex", amount: 2, before: 0}),
				expect.objectContaining({type: "abilityBonusDelta", ability: "con", amount: 1, before: 0}),
			]);
		expect(loaded.toJson()).toEqual(before);
		respec._engine.cancel();
	});

	it("rejects a stored free-pair receipt with a different origin owner", () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["dex", 2], ["con", 1]],
			applyAbilities: true,
		});
		globalThis.CharacterSheetProgression.syncCanonicalDecisions({page, state});
		state.getCharacterBase().decisions.find(decision =>
			decision.meta?.originFreeAbility && decision.type === "nestedAbility",
		).receipt.sourceDecisionKey = "nested:another-origin";
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "free-origin-ability-evidence", repairable: false}),
		]));
		expect(loaded.toJson()).toEqual(before);
		respec._engine.cancel();
	});

	it("edits the free distribution in the same PHB background dialog without losing independent bonuses", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		state.setAbilityBonus("wis", 4);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		const modalInner = e_({tag: "div"});
		const originalShow = globalThis.CharacterSheetModal.pGetShow;
		const language = jest.spyOn(respec, "_renderLanguageChoicePickers").mockReturnValue(null);
		const tool = jest.spyOn(respec, "_renderToolChoicePickers").mockReturnValue(null);
		globalThis.CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
		try {
			await respec._editBackground(1, respec._state.getLevelHistoryEntry(1), null);
			findByClass(modalInner, "charsheet__respec-feat-list")._children[0].click();
			const selects = findAll(modalInner, element => element?._html?.startsWith("<select") && element._handlers.change);
			expect(selects).toHaveLength(2);
			["dex", "int"].forEach((ability, ix) => {
				selects[ix].value = ability;
				selects[ix]._handlers.change();
			});
			await findByClass(modalInner, "charsheet__respec-btn-row")._children[1]._handlers.click();
			expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 2, int: 1, wis: 4});
			expect(respec._state.getBaseBackgroundUserChoices().selectedAbilityBonuses)
				.toMatchObject({bg_0: "dex", bg_0_weight: 2, bg_1: "int", bg_1_weight: 1});
			expect(loaded.toJson()).toEqual(before);
			await respec._engine.apply();
			const reopened = openRespec(reload(loaded), page);
			expect(reopened._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility)
				.map(decision => decision.selection)).toEqual([
				expect.objectContaining({weights: [2, 1]}), "dex", "int",
			]);
			expect(reopened._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 2, int: 1, wis: 4});
			reopened._engine.cancel();
			expect(await respec._engine.undo()).toBe(true);
			expect(withoutRegeneratedModifierIds(loaded.toJson())).toEqual(withoutRegeneratedModifierIds(before));
		} finally {
			globalThis.CharacterSheetModal.pGetShow = originalShow;
			language.mockRestore();
			tool.mockRestore();
			respec._engine.cancel();
		}
	});

	it("keeps the exact free grant when switching between no-ASI PHB backgrounds", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		const loaded = reload(state);
		const respec = openRespec(loaded, page);
		const before = copy(respec._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility));
		const next = getBackground("Acolyte", "PHB");
		const origin = respec._engine.manifest.base.decisions.find(decision => decision.type === "originBackground");
		await respec._engine.stageGraphMutation(origin.id, {name: next.name, source: next.source}, {
			apply: ({state: candidate}) => {
				const old = respec._state;
				respec._state = candidate;
				try {
					respec._applyBackgroundChange(candidate.getLevelHistoryEntry(1), next, {});
				} finally {
					respec._state = old;
				}
			},
		});
		expect(respec._state.getBaseBackgroundUserChoices().selectedAbilityBonuses)
			.toEqual(state.getBaseBackgroundUserChoices().selectedAbilityBonuses);
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 2, con: 1});
		expect(respec._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility)
			.map(decision => [decision.semanticKey, decision.receipt]))
			.toEqual(before.map(decision => [decision.semanticKey, decision.receipt]));
		expect(respec._engine.getValidation().errors).toEqual([]);
		respec._engine.cancel();
	});

	it("reselects the same PHB background with language/tool changes and a new free pair", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		state.setAbilityBonus("dex", 3);
		const loaded = reload(state);
		const respec = openRespec(loaded, page);
		const modalInner = e_({tag: "div"});
		const originalShow = globalThis.CharacterSheetModal.pGetShow;
		const language = jest.spyOn(respec, "_renderLanguageChoicePickers").mockReturnValue({
			type: "language", isComplete: () => true, getSelections: () => ["Common"],
		});
		const tool = jest.spyOn(respec, "_renderToolChoicePickers").mockReturnValue({
			type: "tool", isComplete: () => true, getSelections: () => ["Bagpipes"],
		});
		globalThis.CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
		try {
			await respec._editBackground(1, respec._state.getLevelHistoryEntry(1), null);
			findByClass(modalInner, "charsheet__respec-feat-list")._children[0].click();
			const selects = findAll(modalInner, element => element?._html?.startsWith("<select") && element._handlers.change);
			expect(selects).toHaveLength(2);
			["dex", "int"].forEach((ability, ix) => {
				selects[ix].value = ability;
				selects[ix]._handlers.change();
			});
			await findByClass(modalInner, "charsheet__respec-btn-row")._children[1]._handlers.click();
			expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 5, int: 1});
			expect(respec._state.getBaseBackgroundUserChoices().selectedAbilityBonuses)
				.toMatchObject({bg_0: "dex", bg_0_weight: 2, bg_1: "int", bg_1_weight: 1});
			expect(respec._engine.getValidation().errors).toEqual([]);
			await respec._engine.apply();
			expect(reload(loaded).toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 5, int: 1});
		} finally {
			globalThis.CharacterSheetModal.pGetShow = originalShow;
			language.mockRestore();
			tool.mockRestore();
			respec._engine.cancel();
		}
	});

	it("replaces the free grant with an explicitly picked XPHB background ASI", async () => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		state.setAbilityBonus("wis", 4);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		const next = getBackground("Sage", "XPHB");
		const origin = respec._engine.manifest.base.decisions.find(decision => decision.type === "originBackground");
		await respec._engine.stageGraphMutation(origin.id, {name: next.name, source: next.source}, {
			apply: ({state: candidate}) => {
				const old = respec._state;
				respec._state = candidate;
				try {
					respec._applyBackgroundChange(candidate.getLevelHistoryEntry(1), next, {
						selectedAbilityBonuses: {bg_0: "int", bg_0_weight: 2, bg_1: "wis", bg_1_weight: 1},
					});
				} finally {
					respec._state = old;
				}
			},
		});
		expect(respec._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility)).toEqual([]);
		expect(getAbilityDecisions(respec, "background").map(decision => decision.status))
			.toEqual(["resolved", "resolved", "resolved"]);
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, int: 2, wis: 5});
		expect(loaded.toJson()).toEqual(before);
		await respec._engine.apply();
		const reopened = openRespec(reload(loaded), page);
		expect(getAbilityDecisions(reopened, "background").map(decision => decision.selection)).toEqual([
			expect.objectContaining({weights: [2, 1]}), "int", "wis",
		]);
		expect(reopened._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, int: 2, wis: 5});
		reopened._engine.cancel();
		expect(await respec._engine.undo()).toBe(true);
		expect(withoutRegeneratedModifierIds(loaded.toJson())).toEqual(withoutRegeneratedModifierIds(before));
	});

	it("offers repair when a free pairing has no recorded or applied choices", async () => {
		const {state, page} = build({raceName: "Dwarf", raceSource: "XPHB", racePicks: []});
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(getRepairButton(respec._renderBaseCard())).not.toBeNull();
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "free-origin-ability-evidence"}),
		]));
		expect(await respec._stageSameBackgroundAbilityChoices({
			selectedAbilityBonuses: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
		})).toBe(true);
		expect(respec._engine.getValidation().errors).toEqual([]);
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 2, con: 1});
		respec._engine.cancel();
		expect(loaded.toJson()).toEqual(before);
	});

	it("repairs an unassigned free pair through a same-background reselect with other choices", async () => {
		const {state, page} = build({raceName: "Dwarf", raceSource: "XPHB", racePicks: []});
		const respec = openRespec(reload(state), page);
		const origin = respec._engine.manifest.base.decisions.find(decision => decision.type === "originBackground");
		expect(respec._engine.getValidation().issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "free-origin-ability-evidence", repairable: true}),
		]));
		const currentBg = respec._state.getBackground();
		await respec._engine.stageGraphMutation(origin.id, {name: currentBg.name, source: currentBg.source}, {
			apply: ({state: candidate}) => {
				const old = respec._state;
				respec._state = candidate;
				try {
					respec._applyBackgroundChange(candidate.getLevelHistoryEntry(1), currentBg, {
						selectedLanguages: ["Common"],
						selectedAbilityBonuses: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
					});
				} finally {
					respec._state = old;
				}
			},
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 2, con: 1});
		respec._engine.cancel();
	});

	it("does not guess a missing free pair from an unrelated aggregate bonus", async () => {
		const {state, page} = build({raceName: "Dwarf", raceSource: "XPHB", racePicks: []});
		state.setAbilityBonus("str", 2);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(respec._engine.getValidation().issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "free-origin-ability-evidence", repairable: false}),
		]));
		expect(getRepairButton(respec._renderBaseCard())).toBeNull();
		await expect(respec._stageSameBackgroundAbilityChoices({
			selectedAbilityBonuses: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
		})).rejects.toThrow(/restore.*saved backup/i);
		expect(loaded.toJson()).toEqual(before);
		respec._engine.cancel();
	});

	it.each([
		{
			label: "partial",
			choices: {bg_0: "str", bg_0_weight: 2},
			bonuses: {str: 2, con: 1},
		},
		{
			label: "contradictory",
			choices: {bg_0: "str", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
			bonuses: {str: 2, con: 0},
		},
	])("blocks $label saved free ASI evidence with an actionable error rather than guessing bonuses", ({choices, bonuses}) => {
		const {state, page} = build({
			raceName: "Dwarf",
			raceSource: "XPHB",
			racePicks: [],
			backgroundPicks: [["str", 2], ["con", 1]],
			applyAbilities: true,
		});
		state.setBaseBackgroundUserChoices({
			...state.getBaseBackgroundUserChoices(), selectedAbilityBonuses: choices,
		});
		for (const [ability, bonus] of Object.entries(bonuses)) state.setAbilityBonus(ability, bonus);
		const loaded = reload(state);
		const before = loaded.toJson();
		const respec = openRespec(loaded, page);
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({message: expect.stringMatching(/free.*abilit.*(incomplete|mismatch|repair)/i)}),
		]));
		const card = respec._renderBaseCard();
		expect(getRepairButton(card)).toBeNull();
		expect(findAll(card, element => element?.textContent?.includes("Restore the recorded +2/+1 choices")))
			.not.toHaveLength(0);
		respec._engine.cancel();
		expect(loaded.toJson()).toEqual(before);
	});

	it("keeps an explicitly selected Tasha distribution when changing only the background", () => {
		const {state, page} = build({
			raceName: "Half-Orc",
			racePicks: [],
			tashasBonuses: {tasha_0: "dex", tasha_0_amount: 2, tasha_1: "int", tasha_1_amount: 1},
			applyAbilities: true,
		});
		expect(state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 2, int: 1});
		expect(state.getBaseRaceUserChoices()).toMatchObject({
			useTashasRules: true,
			tashasAbilityBonuses: {tasha_0: "dex", tasha_1: "int"},
		});
		const respec = openRespec(reload(state), page);
		expect(getAbilityDecisions(respec, "race")).toEqual([]);
		const history = respec._state.getLevelHistoryEntry(1);
		respec._applyBackgroundChange(history, getBackground("Sage", "XPHB"), {});
		expect(respec._state.toJson().abilityBonuses).toMatchObject({str: 0, con: 0, dex: 2, int: 1});
		expect(respec._state.getBaseRaceUserChoices().useTashasRules).toBe(true);
		respec._engine.cancel();
	});
});
