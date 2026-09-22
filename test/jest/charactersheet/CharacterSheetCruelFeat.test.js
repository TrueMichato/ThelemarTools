import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetRest = globalThis.CharacterSheetRest;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CRUEL_SOURCE = "TalDoreiCampaignSettingReborn";

let CharacterSheetPage;
let savedWindow;
let savedDocument;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

function makeState ({level = 5} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 16);
	state.setAbilityBase("cha", 10);
	state.addClass({name: "Fighter", source: "PHB", level});
	expect(state.addFeat({name: "Cruel", source: CRUEL_SOURCE})).toBe(true);
	return state;
}

function getCrueltyDice (state) {
	return state.getResources().find(resource => resource.name === "Cruelty Dice");
}

function spendTriggeredDieWithRoll (state, trigger, context = {}, roll = 4) {
	const option = state.getTriggeredFeatDieOptions(trigger, context)[0];
	if (!option) return null;
	const spent = state.spendTriggeredFeatDie(option.resourceId, trigger, context);
	return spent.ok ? {...spent, roll, sides: 6} : null;
}

describe("Cruel feat resource model", () => {
	it("does not apply the Tal'Dorei mechanic to an unrelated same-name feat", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addFeat({name: "Cruel", source: "HomebrewSource"});

		expect(getCrueltyDice(state)).toBeUndefined();
	});

	it("creates PB d6 Cruelty Dice with long-rest recovery and contextual trigger metadata", () => {
		const state = makeState();
		const resource = getCrueltyDice(state);

		expect(resource).toMatchObject({
			current: 3,
			max: 3,
			recharge: "long",
			contextualOnly: true,
			triggeredDiePool: {
				die: "d6",
				oncePerTurn: true,
			},
		});
		expect(Object.keys(resource.triggeredDiePool.triggers).sort()).toEqual(["criticalHit", "damage", "skillCheck"]);
	});

	it("preserves spent dice when proficiency bonus increases", () => {
		const state = makeState();
		const resource = getCrueltyDice(state);
		state.setResourceCurrent(resource.id, 2);

		state.addClass({name: "Fighter", source: "PHB", level: 9});

		expect(getCrueltyDice(state)).toMatchObject({current: 3, max: 4});
	});

	it("backfills the resource for an imported character that only contains the feat", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			feats: [{name: "Cruel", source: CRUEL_SOURCE}],
			resources: [],
		});

		expect(getCrueltyDice(state)).toMatchObject({current: 3, max: 3, featId: `Cruel|${CRUEL_SOURCE}`});
	});

	it("adopts a legacy feat-named resource instead of creating a duplicate pool", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			classes: [{name: "Fighter", source: "PHB", level: 5}],
			feats: [{id: "imported-cruel", name: "Cruel", source: CRUEL_SOURCE}],
			resources: [{id: "legacy-cruel", name: "Cruel", featId: "imported-cruel", current: 1, max: 3, recharge: "long"}],
		});

		const resources = state.getResources().filter(resource => resource.featId === "imported-cruel");
		expect(resources).toHaveLength(1);
		expect(resources[0]).toMatchObject({id: "legacy-cruel", name: "Cruelty Dice", current: 1, max: 3});
	});

	it("uses one shared once-per-turn gate across damage, critical-hit temp HP, and Intimidation", () => {
		const state = makeState();
		state.startCombat();
		const resource = getCrueltyDice(state);

		expect(state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"})).toMatchObject({
			ok: true,
			kind: "bonusDamage",
			remaining: 2,
		});
		expect(state.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true})).toEqual([]);
		expect(state.getTriggeredFeatDieOptions("skillCheck", {skill: "intimidation", ability: "cha"})).toEqual([]);

		state.advanceRound();
		expect(state.getTriggeredFeatDieOptions("skillCheck", {skill: "intimidation", ability: "wis"})).toEqual([]);
		expect(state.spendTriggeredFeatDie(resource.id, "skillCheck", {skill: "intimidation", ability: "cha"})).toMatchObject({
			ok: true,
			kind: "rollBonus",
			remaining: 1,
		});
	});

	it("round-trips current dice and the current-turn gate through save/load", () => {
		const state = makeState();
		state.startCombat();
		const resource = getCrueltyDice(state);
		state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"});

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());

		expect(getCrueltyDice(restored)).toMatchObject({current: 2, max: 3});
		expect(restored.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true})).toEqual([]);
		restored.advanceRound();
		expect(restored.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true})).toHaveLength(1);
	});

	it("restores all spent dice on a long rest", () => {
		const state = makeState();
		const resource = getCrueltyDice(state);
		state.setResourceCurrent(resource.id, 0);
		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;

		rest._restoreResources("short");
		expect(getCrueltyDice(state).current).toBe(0);
		rest._restoreResources("long");

		expect(getCrueltyDice(state).current).toBe(3);
	});

	it("removes the resource and turn-use receipt when the feat is removed", () => {
		const state = makeState();
		state.startCombat();
		const resource = getCrueltyDice(state);
		const turnReceiptKey = resource.triggeredDiePool.turnReceipt.key;
		state.spendTriggeredFeatDie(resource.id, "damage", {damageSource: "weapon"});

		state.removeFeat("Cruel", CRUEL_SOURCE);

		expect(getCrueltyDice(state)).toBeUndefined();
		expect(state.queryTurnReceipt(turnReceiptKey).used).toBe(false);
	});
});

describe("Cruel feat roll integration", () => {
	it("does not spend a die when the contextual prompt is declined", async () => {
		const state = makeState();
		jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValueOnce(false);
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page.rollDice = jest.fn();

		await expect(page._pRollTriggeredFeatDie({
			trigger: "damage",
			context: {damageSource: "weapon"},
			rollLabel: "weapon damage",
		})).resolves.toBeNull();

		expect(page.rollDice).not.toHaveBeenCalled();
		expect(getCrueltyDice(state).current).toBe(3);
	});

	it("adds one Cruelty Die to a Charisma (Intimidation) check and spends the pool", async () => {
		const state = makeState();
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._combat = null;
		page._getExhaustionPenalty = () => 0;
		page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
		page.rollDice = (count, sides) => count === 1 && sides === 6 ? 4 : 0;
		page._pPickConditionalModifiers = async () => ({appliedConditionalIds: new Set(), applied: [], cancelled: false});
		page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
		page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
		page._pMaybeApplyTacticalMind = async () => {};
		page.pAnimateD20 = async () => {};
		page.pAnimateDamageDice = async () => {};
		page._showDiceResult = jest.fn();
		page._saveCurrentCharacter = async () => {};
		page._renderResources = () => {};
		page._features = {_renderResources: () => {}};

		const result = await page._rollSkillCheck("intimidation", "Intimidation", null);

		expect(result.total).toBe(14);
		expect(getCrueltyDice(state).current).toBe(2);
		expect(page._showDiceResult).toHaveBeenCalledWith(
			expect.any(String),
			14,
			expect.stringMatching(/Cruel.*d6/i),
			expect.any(String),
			expect.stringMatching(/Cruel.*\+4/i),
		);
	});

	it("adds one untyped Cruelty Die to dealt damage and spends the pool", async () => {
		const state = makeState();
		state.addAttack({
			id: "longsword",
			name: "Longsword",
			isMelee: true,
			abilityMod: "str",
			damage: "1d8",
			damageType: "slashing",
		});
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		const shown = [];
		combat._page = {
			_pRollTriggeredFeatDie: async ({trigger, context}) => spendTriggeredDieWithRoll(state, trigger, context),
			pAnimateDamageDice: async () => {},
			showDiceResult: result => shown.push(result),
			saveCharacter: () => {},
		};
		combat._parseDamage = dice => ({total: dice === "1d8" ? 5 : 4, sides: Number(dice.match(/d(\\d+)/)?.[1] || 6), rolls: [dice === "1d8" ? 5 : 4]});
		combat._pushDiceGroup = () => {};
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;
		combat._getSelectedAmmoForWeapon = () => null;

		await combat._rollDamage("longsword", false);

		expect(shown.at(-1)).toMatchObject({total: 12});
		expect(shown.at(-1).subtitle).toMatch(/Cruel.*d6.*\+4/i);
		expect(getCrueltyDice(state).current).toBe(2);
	});

	it("adds one untyped Cruelty Die to spell damage and spends the same pool", async () => {
		const state = makeState();
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = state;
		spells._page = {
			_pRollTriggeredFeatDie: async ({trigger, context}) => spendTriggeredDieWithRoll(state, trigger, context, 6),
			pAnimateDamageDice: async () => {},
		};

		const result = await spells._pApplyTriggeredFeatDamageToSpellResult({
			damageResult: {total: 8, dice: "2d6", damageType: "fire", text: "<br>Damage: <strong>8</strong> fire (2d6)"},
			spell: {name: "Burning Hands"},
			spellData: {name: "Burning Hands"},
		});

		expect(result).toMatchObject({total: 14});
		expect(result.text).toMatch(/Cruel.*6.*untyped.*Total damage.*14/i);
		expect(getCrueltyDice(state).current).toBe(2);
	});

	it("grants temporary hit points from a critical spell attack", async () => {
		const state = makeState();
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = state;
		spells._page = {
			_pRollTriggeredFeatDie: async ({trigger, context}) => spendTriggeredDieWithRoll(state, trigger, context, 5),
			_saveCurrentCharacter: async () => {},
			_renderResources: () => {},
			_features: {_renderResources: () => {}},
			_combat: {renderCombatResources: () => {}},
		};

		await spells._pApplyTriggeredFeatCriticalHit({
			spell: {name: "Scorching Ray"},
			spellData: {name: "Scorching Ray"},
		});

		expect(state.getTempHp()).toBe(5);
		expect(getCrueltyDice(state).current).toBe(2);
	});

	it("offers the critical-hit option, grants the rolled temp HP, and blocks damage use that turn", async () => {
		const state = makeState();
		state.startCombat();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {
			_pRollTriggeredFeatDie: async ({trigger, context}) => spendTriggeredDieWithRoll(state, trigger, context, 5),
			_saveCurrentCharacter: async () => {},
			_renderResources: () => {},
			_features: {_renderResources: () => {}},
		};
		combat.renderCombatResources = () => {};

		const hook = combat._getPostAttackHooks().find(it => it.id === "triggeredFeatCriticalHit");
		expect(hook.predicate({isCrit: true, attack: {name: "Longsword"}})).toBe(true);
		await hook.handler({isCrit: true, attack: {name: "Longsword"}});

		expect(state.getTempHp()).toBe(5);
		expect(getCrueltyDice(state).current).toBe(2);
		expect(state.getTriggeredFeatDieOptions("damage", {damageSource: "weapon"})).toEqual([]);
	});
});
