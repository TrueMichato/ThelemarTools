import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetRest = globalThis.CharacterSheetRest;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

describe("Battle Master (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({
			name: "Fighter",
			source: "XPHB",
			level: 3,
			subclass: {name: "Battle Master", shortName: "Battle Master", source: "XPHB"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 18);
	});

	it.each([
		[3, 4, "d8", 3],
		[7, 5, "d8", 5],
		[10, 5, "d10", 7],
		[15, 6, "d10", 9],
		[18, 6, "d12", 9],
	])("scales at Fighter level %i", (level, dice, die, maneuvers) => {
		state._data.classes[0].level = level;
		const calc = state.getFeatureCalculations();
		expect(calc.superiorityDiceCount).toBe(dice);
		expect(calc.superiorityDie).toBe(die);
		expect(calc.maneuversKnown).toBe(maneuvers);
	});

	it("preserves spent dice when the pool maximum increases and restores on a short rest", () => {
		let resource = state.getSuperiorityDice();
		expect(resource).toMatchObject({current: 4, max: 4, recharge: "short"});
		state.setResourceCurrent(resource.id, 2);
		state._data.classes[0].level = 7;
		resource = state.getSuperiorityDice();
		expect(resource).toMatchObject({current: 3, max: 5});

		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;
		rest._restoreResources("short");
		expect(state.getSuperiorityDice().current).toBe(5);
	});

	it("exposes both legal maneuver DCs instead of silently choosing one", () => {
		const calc = state.getFeatureCalculations();
		expect(calc.maneuverSaveDcStr).toBe(13);
		expect(calc.maneuverSaveDcDex).toBe(14);
		expect(calc.maneuverSaveDc).toBe(14);
	});

	it("classifies every XPHB maneuver as a shared-pool activatable ability", () => {
		for (const name of Object.keys(CharacterSheetState.BATTLE_MASTER_MANEUVERS)) {
			const feature = {
				id: name,
				name: name.replace(/\b\w/g, ch => ch.toUpperCase()),
				source: "XPHB",
				description: "Use this maneuver.",
				optionalFeatureTypes: ["MV:B"],
			};
			const info = CharacterSheetState.detectActivatableFeature(feature);
			expect(info).toMatchObject({
				interactionMode: "limited",
				resourceName: "Superiority Dice",
				resourceCost: 1,
			});
			state.addFeature(feature);
		}
		expect(state.getActivatableFeatures().filter(it => it.activationInfo.maneuver)).toHaveLength(20);
		expect(CharacterSheetState.getBattleMasterManeuverDefinition({
			name: "Ambush",
			source: "PHB",
			optionalFeatureTypes: ["MV:B"],
		})).toBeNull();
		expect(CharacterSheetState.getBattleMasterManeuverDefinition({
			name: "Commanding Presence",
			source: "TCE",
			optionalFeatureTypes: ["MV:B"],
		})).toBeNull();
	});

	it("restores Know Your Enemy by spending exactly one Superiority Die", () => {
		state._data.classes[0].level = 7;
		state.addFeature({
			name: "Know Your Enemy",
			source: "XPHB",
			description: "As a Bonus Action, use this once, regaining the use after a Long Rest.",
			uses: {current: 0, max: 1, recharge: "long"},
		});
		const feature = state.getFeature("Know Your Enemy");
		state.setFeatureUses(feature.id, 0);
		const before = state.getSuperiorityDice().current;
		expect(state.restoreKnowYourEnemyWithSuperiorityDie()).toBe(true);
		expect(state.getSuperiorityDice().current).toBe(before - 1);
		expect(state.getFeature("Know Your Enemy").uses.current).toBe(1);
		expect(state.restoreKnowYourEnemyWithSuperiorityDie()).toBe(false);
	});

	it("floats and applies both Student of War proficiency choices", () => {
		state.addFeature({
			name: "Student of War",
			source: "XPHB",
			description: "Choose one artisan's tool and one Fighter skill.",
		});
		const choices = state.getPendingFeatureChoices().filter(it => it.featureName === "Student of War");
		expect(choices.map(it => it.kind).sort()).toEqual(["skill", "tool"]);
		expect(state.fulfillFeatureChoice(choices.find(it => it.kind === "skill").id, "history")).toBe(true);
		expect(state.fulfillFeatureChoice(choices.find(it => it.kind === "tool").id, "Smith's Tools")).toBe(true);
		expect(state.getSkillProficiencies().history).toBe(1);
		expect(state.getToolProficiencies()).toContain("Smith's Tools");

		state.removeFeature("Student of War", "XPHB");
		expect(state.getSkillProficiencies().history || 0).toBe(0);
		expect(state.getToolProficiencies()).not.toContain("Smith's Tools");
		expect(state.hasFulfilledFeatureSkillChoice("Student of War")).toBe(false);
		expect(state._data.fulfilledFeatureToolChoices).not.toContain("student of war");
	});

	it("does not downgrade or remove expertise selected for Student of War", () => {
		state.setSkillProficiency("history", 2);
		state.addFeature({
			name: "Student of War",
			source: "XPHB",
			description: "Choose one artisan's tool and one Fighter skill.",
		});
		const choice = state.getPendingFeatureChoices().find(it => it.featureName === "Student of War" && it.kind === "skill");
		expect(state.fulfillFeatureChoice(choice.id, "history")).toBe(true);
		expect(state.getSkillProficiencies().history).toBe(2);
		state.removeFeature("Student of War", "XPHB");
		expect(state.getSkillProficiencies().history).toBe(2);
	});

	it("offers one maneuver replacement whenever a progression milestone grants new maneuvers", () => {
		["Ambush", "Parry", "Rally"].forEach(name => state.addFeature({
			name,
			source: "XPHB",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["MV:B"],
		}));
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(
			{},
			3,
			7,
			state,
			{optionalfeatureProgression: [{name: "Maneuvers", featureType: ["MV:B"], progression: {3: 3, 7: 5, 10: 7, 15: 9}}]},
		);
		expect(gains).toEqual([expect.objectContaining({newCount: 2, totalCount: 5, replacementCount: 1})]);
	});

	it("filters maneuver editions by subclass source", () => {
		const options = [
			{name: "Ambush", source: "PHB", featureType: ["MV:B"]},
			{name: "Ambush", source: "XPHB", featureType: ["MV:B"]},
			{name: "Quick Toss", source: "TCE", featureType: ["MV:B"]},
		];
		const preserved = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(options, {preserveFeatureTypes: ["MV:B"]});
		expect(CharacterSheetClassUtils.filterOptionalFeaturesForProgressionSource(preserved, ["MV:B"], "XPHB"))
			.toEqual([{name: "Ambush", source: "XPHB", featureType: ["MV:B"]}]);
		expect(CharacterSheetClassUtils.filterOptionalFeaturesForProgressionSource(preserved, ["MV:B"], "PHB"))
			.toEqual([
				{name: "Ambush", source: "PHB", featureType: ["MV:B"]},
				{name: "Quick Toss", source: "TCE", featureType: ["MV:B"]},
			]);
	});

	it("replays maneuver replacements and restores the old maneuver when that level is removed", () => {
		state._data.classes[0].level = 7;
		state._data.levelHistory = [
			{
				level: 3,
				class: {name: "Fighter", source: "XPHB"},
				choices: {
					optionalFeatures: [{name: "Ambush", source: "XPHB", type: "MV:B"}],
					replayData: {optionalFeatures: [{
						name: "Ambush",
						source: "XPHB",
						type: "MV:B",
						optionalFeatureTypes: ["MV:B"],
						description: "Use this maneuver.",
					}]},
				},
			},
			{
				level: 7,
				class: {name: "Fighter", source: "XPHB"},
				choices: {
					optionalFeatures: [{name: "Parry", source: "XPHB", type: "MV:B", _replaces: {name: "Ambush", source: "XPHB"}}],
					replayData: {optionalFeatures: [{
						name: "Parry",
						source: "XPHB",
						type: "MV:B",
						optionalFeatureTypes: ["MV:B"],
						description: "Use this maneuver.",
						_replaces: {name: "Ambush", source: "XPHB"},
					}]},
				},
			},
		];
		state._reapplyHistoryOptionalFeatures();
		expect(state.getFeature("Ambush", "XPHB")).toBeNull();
		expect(state.getFeature("Parry", "XPHB")).not.toBeNull();

		expect(state._removeLevelEntry(state._data.levelHistory[1]).success).toBe(true);
		expect(state.getFeature("Parry", "XPHB")).toBeNull();
		expect(state.getFeature("Ambush", "XPHB")).not.toBeNull();
	});

	it("gates the free Relentless die to XPHB and resets it each turn", () => {
		state._data.classes[0].level = 15;
		state.startCombat();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._relentlessUsedThisTurn = false;
		expect(combat.canUseRelentless()).toBe(true);
		combat._relentlessUsedThisTurn = true;
		expect(combat.canUseRelentless()).toBe(false);
		combat._resetTurnActionUsage();
		expect(combat.canUseRelentless()).toBe(true);

		state._data.classes[0].subclass.source = "PHB";
		expect(combat.canUseRelentless()).toBe(false);
	});

	it("does not permanently latch Relentless when a maneuver is used outside combat", () => {
		state._data.classes[0].level = 15;
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {_showDiceResult: () => {}};
		combat._turnActionUsage = {action: false, bonus: false, reaction: false};
		combat._relentlessUsedThisTurn = false;
		combat.applyBattleMasterManeuver({
			feature: {name: "Commanding Presence"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS["commanding presence"],
			roll: 6,
			usedRelentless: true,
		});
		expect(combat.canUseRelentless()).toBe(true);
	});

	it("applies special maneuver results to the correct target and formula", () => {
		state._data.classes[0].level = 7;
		state.setTempHp(0);
		const results = [];
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {_showDiceResult: (...args) => results.push(args)};
		combat._turnActionUsage = {action: false, bonus: false, reaction: false};

		combat.applyBattleMasterManeuver({
			feature: {name: "Commander's Strike"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS["commander's strike"],
			roll: 6,
		});
		expect(combat._pendingBattleMasterDamage).toBeUndefined();
		expect(results.at(-1)).toEqual(["Commander's Strike — Damage", 6, "6 Superiority Die damage"]);

		combat.applyBattleMasterManeuver({
			feature: {name: "Rally"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS.rally,
			roll: 5,
		});
		expect(state.getTempHp()).toBe(0);
		expect(results.at(-1)).toEqual(["Rally — Ally Temporary HP", 8, "5 + 3 (half Fighter level)"]);

		combat.applyBattleMasterManeuver({
			feature: {name: "Parry"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS.parry,
			roll: 4,
			modifier: 3,
			modifierAbility: "str",
		});
		expect(results.at(-1)).toEqual(["Parry — Damage Reduction", 7, "4 + +3 STR"]);
	});

	it("binds attack damage riders to one roll, doubles the die on a critical hit, and expires AC", () => {
		state.startCombat();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {_showDiceResult: () => {}};
		combat._turnActionUsage = {action: false, bonus: false, reaction: false};
		combat._lastAttackContext = {attackId: "sword", rollId: 1};
		combat._parseDamage = jest.fn(() => ({total: 8}));
		expect(combat.canUseBattleMasterManeuver(CharacterSheetState.BATTLE_MASTER_MANEUVERS["trip attack"])).toBe(true);

		combat.applyBattleMasterManeuver({
			feature: {id: "trip", name: "Trip Attack"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS["trip attack"],
			roll: 6,
			die: "d10",
		});
		expect(combat.canUseBattleMasterManeuver(CharacterSheetState.BATTLE_MASTER_MANEUVERS["disarming attack"])).toBe(false);
		expect(combat._consumeBattleMasterDamage("sword", true)).toEqual({damage: 14, name: "Trip Attack"});
		expect(combat._parseDamage).toHaveBeenCalledWith("d10");
		expect(combat._consumeBattleMasterDamage("sword", true)).toEqual({damage: 0, name: null});

		combat.applyBattleMasterManeuver({
			feature: {id: "bait", name: "Bait and Switch"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS["bait and switch"],
			roll: 5,
		});
		const acState = state.getActiveStates().find(active => active.sourceFeatureId === "bait");
		expect(acState).toMatchObject({active: true, roundsRemaining: 1});
		state.advanceRound();
		expect(acState.active).toBe(false);
	});

	it("tracks Battle Master action economy and clears pending damage at the turn boundary", () => {
		state.startCombat();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {_showDiceResult: () => {}};
		combat._turnActionUsage = {action: false, bonus: false, reaction: false};
		expect(combat.canUseBattleMasterAction("bonus")).toBe(true);
		combat.applyBattleMasterManeuver({
			feature: {name: "Feinting Attack"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS["feinting attack"],
			roll: 5,
		});
		expect(combat.canUseBattleMasterAction("bonus")).toBe(false);
		expect(combat.canUseBattleMasterManeuver(CharacterSheetState.BATTLE_MASTER_MANEUVERS["feinting attack"])).toBe(false);
		expect(combat._pendingBattleMasterAttackAdvantage).toBe(true);
		combat._resetTurnActionUsage();
		expect(combat.canUseBattleMasterAction("bonus")).toBe(true);
		expect(combat._pendingBattleMasterDamage).toBeNull();
		expect(combat._pendingBattleMasterAttackAdvantage).toBe(false);
	});

	it("arms eligible check maneuvers for exactly one matching roll", () => {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {_showDiceResult: () => {}};
		combat._turnActionUsage = {action: false, bonus: false, reaction: false};
		combat.applyBattleMasterManeuver({
			feature: {name: "Ambush"},
			definition: CharacterSheetState.BATTLE_MASTER_MANEUVERS.ambush,
			roll: 7,
		});
		expect(combat.consumeBattleMasterCheckBonus("check:wis:perception")).toBeNull();
		expect(combat.consumeBattleMasterCheckBonus("initiative")).toMatchObject({name: "Ambush", roll: 7});
		expect(combat.consumeBattleMasterCheckBonus("initiative")).toBeNull();
	});
});
