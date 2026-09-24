import {jest} from "@jest/globals";
import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const elementFactory = globalThis.e_;
globalThis.e_ = opts => {
	const element = elementFactory(opts);
	const selectors = new Map();
	element.isConnected = true;
	element.querySelector = selector => {
		if (!selectors.has(selector)) selectors.set(selector, elementFactory({outer: `<div data-test-selector="${selector}"></div>`}));
		return selectors.get(selector);
	};
	element.remove = jest.fn(() => { element.isConnected = false; });
	return element;
};
const {CharacterSheetCombat} = await import("../../../js/charactersheet/charactersheet-combat.js");
const CharacterSheetModal = globalThis.CharacterSheetModal;
const CRUEL_SOURCE = "TalDoreiCampaignSettingReborn";
const upgrades = JSON.parse(fs.readFileSync(new URL("../../../data/itemupgrades.json", import.meta.url))).itemUpgrade;
const sharpened = upgrades.find(it => it.name === "Critical: Sharpened");

function makeChainsState () {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 10);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level: 17,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	state.addFeature({
		name: "Manifest Chains",
		source: "TGTT",
		description: "When you rage, you can manifest a pair of spectral chains.",
	});
	expect(state.addFeat({name: "Cruel", source: CRUEL_SOURCE})).toBe(true);
	state.activateState("rage");
	state.activateState("manifestChains");
	const item = state.getItems().find(it => it._generatedItemId === "tgtt-chained-fury:spectral-chains");
	expect(item).toBeDefined();
	state.applyItemUpgrade(item.id, sharpened, 0);
	const attack = state.getFeatureGrantedAttacks().find(it => it.sourceItem?.id === item.id);
	expect(attack).toBeDefined();
	expect(state.getCriticalRange({attack})).toBe(19);
	expect(state.getAttackBonusBreakdown(attack).total).toBe(8);
	return {state, attack};
}

function makeCombat (state, attack, roll = 19) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	const resultEl = globalThis.e_({outer: "<div class=\"charsheet__dice-result\"></div>"});
	combat._state = state;
	combat._cachedAttacks = [attack];
	combat._battleTacticToggles = {};
	combat._flankingEnabled = false;
	combat._canRollAttackActionAttack = () => true;
	combat._getSelectedAmmoForWeapon = () => null;
	combat._getCombatLocalAttackBonus = () => ({bonus: 0, parts: []});
	combat._recordAttackForTurn = () => {};
	combat._renderSneakAttackToggle = () => {};
	combat._isSneakAttackAvailableThisTurn = () => false;
	combat._consumeOnAttackStates = () => {};
	combat._page = {
		rollD20: jest.fn(() => ({roll, roll1: roll, mode: "normal", thelemar_critBonus: 0})),
		getModeLabel: () => "",
		formatD20Breakdown: (result, bonus) => `1d20 (${result.roll}) + ${bonus}`,
		pAnimateD20: () => {},
		showDiceResult: jest.fn(() => resultEl),
		_offerGuidedStrikePostAttack: () => {},
		_pRollTriggeredFeatDie: jest.fn(async () => null),
		saveCharacter: () => {},
	};
	return combat;
}

describe("post-attack roll offers at the real attack boundary", () => {
	let previousDocument;

	beforeEach(() => {
		previousDocument = globalThis.document;
		globalThis.document = {
			activeElement: null,
			getElementById: () => null,
			querySelector: () => null,
			body: {append () {}, contains: () => true},
		};
	});

	afterEach(() => {
		globalThis.document = previousDocument;
		jest.restoreAllMocks();
	});

	afterAll(() => { globalThis.e_ = elementFactory; });

	it("keeps the real Spectral Chains + Cruel natural-19 critical roll readable without opening optional choices", async () => {
		const {state, attack} = makeChainsState();
		const combat = makeCombat(state, attack);
		const choice = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		let context;
		const originalRun = combat._runPostAttackHooks.bind(combat);
		combat._runPostAttackHooks = (ctx, opts) => {
			context = ctx;
			return originalRun(ctx, opts);
		};

		await expect(combat._rollAttack(attack.id, null)).resolves.toBe(true);
		await Promise.resolve();

		expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			roll: 19,
			total: 27,
			resultNote: "Critical Hit!",
			subtitle: "1d20 (19) + 8",
		}));
		expect(context.rollFollowup).toMatchObject({
			label: "Spectral Chains Attack",
			naturalRoll: "19",
			total: "27",
			outcome: "Critical Hit!",
			breakdown: "1d20 (19) + 8",
		});
		const html = CharacterSheetModal.getRollFollowupHtml(context.rollFollowup);
		expect(html).toContain("1d20 (19) + 8");
		expect(html).not.toContain("[object Object]");
		expect(combat._page._pRollTriggeredFeatDie).not.toHaveBeenCalled();
		expect(choice).not.toHaveBeenCalled();
		expect(state.getResources().find(it => it.name === "Cruelty Dice").current).toBe(6);
	});

	it("keeps an ordinary attack's roll context a readable string without creating an offer", async () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		const attack = {id: "ordinary", name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8"};
		state.addAttack(attack);
		const combat = makeCombat(state, attack, 12);
		let context;
		const originalRun = combat._runPostAttackHooks.bind(combat);
		combat._runPostAttackHooks = (ctx, opts) => {
			context = ctx;
			return originalRun(ctx, opts);
		};

		await expect(combat._rollAttack(attack.id, null)).resolves.toBe(true);

		expect(context.rollFollowup.breakdown).toBe(combat._page.showDiceResult.mock.calls[0][0].subtitle);
		expect(context.rollFollowup.breakdown).toMatch(/^1d20 \(12\) \+ 6$/);
		expect(context.rollFollowup.breakdown).not.toContain("[object Object]");
		expect(combat._postAttackOffer).toBeFalsy();
	});

	it("groups both optional choices, leaves cancellation unspent, then applies Cruel only once to this roll", async () => {
		const {state, attack} = makeChainsState();
		state.startCombat();
		const combat = makeCombat(state, attack);
		combat.renderCombatResources = () => {};
		const cruelty = state.getResources().find(it => it.name === "Cruelty Dice");
		const buttonFocused = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);

		await combat._rollAttack(attack.id, null);
		const offer = combat._postAttackOffer;
		expect(offer.rollId).toBe(combat._lastAttackContext.rollId);
		expect([...offer.options.keys()]).toEqual(["triggeredFeatCriticalHit", "featureOnHitOptions"]);
		expect(offer.element.outerHTML).toContain("Natural 19 · Total 27 · Critical hit");
		expect(offer.element.outerHTML).toContain("1d20 (19) + 8");
		expect(combat._page._pRollTriggeredFeatDie).not.toHaveBeenCalled();
		expect(buttonFocused).not.toHaveBeenCalled();
		expect(combat._page.rollD20).toHaveBeenCalledTimes(1);

		await expect(combat._pOpenPostAttackOffer(offer, "featureOnHitOptions")).resolves.toBe(false);
		expect(buttonFocused).toHaveBeenCalledWith(expect.objectContaining({
			rollFollowup: expect.objectContaining({total: "27", breakdown: "1d20 (19) + 8"}),
		}));
		expect(offer.options.has("featureOnHitOptions")).toBe(true);
		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(false);
		expect(cruelty.current).toBe(6);
		expect(offer.options.has("triggeredFeatCriticalHit")).toBe(true);

		combat._page._pRollTriggeredFeatDie.mockImplementation(async () => {
			const option = state.getTriggeredFeatDieOptions("criticalHit", {isCriticalHit: true, attack})[0];
			const spent = state.spendTriggeredFeatDie(option.resourceId, "criticalHit", {isCriticalHit: true, attack});
			return {...spent, sourceName: "Cruel", roll: 4};
		});
		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(true);
		expect(cruelty.current).toBe(5);
		expect(state.getTempHp()).toBe(4);
		expect(offer.options.has("triggeredFeatCriticalHit")).toBe(false);
		expect(offer.options.get("featureOnHitOptions").button.disabled).toBe(false);
		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(false);
		expect(cruelty.current).toBe(5);
		expect(combat._page.rollD20).toHaveBeenCalledTimes(1);
	});

	it("does not open a second choice while another choice's modal is still pending", async () => {
		const {state, attack} = makeChainsState();
		const combat = makeCombat(state, attack);
		let settleFirst;
		combat._page._pRollTriggeredFeatDie.mockImplementation(() => new Promise(resolve => { settleFirst = resolve; }));
		const onHitPrompt = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		await combat._rollAttack(attack.id, null);
		const offer = combat._postAttackOffer;
		const first = combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit");
		let secondWhilePending;
		let buttonsWhilePending;
		let promptsWhilePending;
		try {
			buttonsWhilePending = [...offer.options.values()].map(option => option.button.disabled);
			secondWhilePending = await combat._pOpenPostAttackOffer(offer, "featureOnHitOptions");
			promptsWhilePending = onHitPrompt.mock.calls.length;
		} finally {
			settleFirst(null);
			await first;
		}

		expect(buttonsWhilePending).toEqual([true, true]);
		expect(secondWhilePending).toBe(false);
		expect(promptsWhilePending).toBe(0);
		expect([...offer.options.values()].map(option => option.button.disabled)).toEqual([false, false]);
		expect(state.getResources().find(it => it.name === "Cruelty Dice").current).toBe(6);
		await expect(combat._pOpenPostAttackOffer(offer, "featureOnHitOptions")).resolves.toBe(false);
		expect(onHitPrompt).toHaveBeenCalledTimes(1);
	});

	it("unlocks every choice when an opened handler fails", async () => {
		const {state, attack} = makeChainsState();
		const combat = makeCombat(state, attack);
		const failure = new Error("picker failed");
		const logged = jest.spyOn(console, "error").mockImplementation(() => {});
		combat._page._pRollTriggeredFeatDie.mockRejectedValueOnce(failure);
		const onHitPrompt = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		await combat._rollAttack(attack.id, null);
		const offer = combat._postAttackOffer;

		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(false);
		expect(logged).toHaveBeenCalledWith(expect.stringContaining("triggeredFeatCriticalHit"), failure);
		expect([...offer.options.values()].map(option => option.button.disabled)).toEqual([false, false]);
		await expect(combat._pOpenPostAttackOffer(offer, "featureOnHitOptions")).resolves.toBe(false);
		expect(onHitPrompt).toHaveBeenCalledTimes(1);
		expect(state.getResources().find(it => it.name === "Cruelty Dice").current).toBe(6);
	});

	it("invalidates an unclaimed Cruel choice if the same die was spent on damage first", async () => {
		const {state, attack} = makeChainsState();
		state.startCombat();
		const combat = makeCombat(state, attack);

		await combat._rollAttack(attack.id, null);
		const offer = combat._postAttackOffer;
		const cruelty = state.getResources().find(it => it.name === "Cruelty Dice");
		expect(state.spendTriggeredFeatDie(cruelty.id, "damage", {damageSource: "weapon"}).ok).toBe(true);
		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(false);
		expect(combat._page._pRollTriggeredFeatDie).not.toHaveBeenCalled();
		expect(offer.options.has("triggeredFeatCriticalHit")).toBe(false);
		expect(offer.options.has("featureOnHitOptions")).toBe(true);
		expect(cruelty.current).toBe(5);
	});

	it("keeps the offer through other results or cancelled pre-roll choices; a committed new attack supersedes it", async () => {
		const {state, attack} = makeChainsState();
		const combat = makeCombat(state, attack);
		await combat._rollAttack(attack.id, null);
		const firstOffer = combat._postAttackOffer;
		combat._page.showDiceResult.mock.results[0].value.remove();
		expect(combat._postAttackOffer).toBe(firstOffer);

		const aggregate = jest.spyOn(state, "aggregateModifiers").mockReturnValueOnce({
			conditionalsAvailable: [{id: "conditional"}],
		});
		combat._page._pPickConditionalModifiers = async () => ({cancelled: true});
		await expect(combat._rollAttack(attack.id, null)).resolves.toBe(false);
		expect(combat._postAttackOffer).toBe(firstOffer);
		expect(firstOffer.element.remove).not.toHaveBeenCalled();
		aggregate.mockRestore();

		await combat._rollAttack(attack.id, null);
		expect(firstOffer.element.remove).toHaveBeenCalledTimes(1);
		expect(combat._postAttackOffer.rollId).not.toBe(firstOffer.rollId);
		await expect(combat._pOpenPostAttackOffer(firstOffer, "featureOnHitOptions")).resolves.toBe(false);
		expect(combat._page.rollD20).toHaveBeenCalledTimes(2);
		combat._dismissPostAttackOffer();
		expect(combat._postAttackOffer).toBeNull();
		expect(state.getResources().find(it => it.name === "Cruelty Dice").current).toBe(6);
	});

	it("discards the previous character's offer when Combat binds a different state", async () => {
		const {state, attack} = makeChainsState();
		const combat = makeCombat(state, attack);
		await combat._rollAttack(attack.id, null);
		const offer = combat._postAttackOffer;
		combat._page.getState = () => new CharacterSheetState();
		combat._runRenderSteps = () => {};
		combat._clearPendingSpellRider = () => {};

		combat.render();

		expect(offer.element.remove).toHaveBeenCalledTimes(1);
		expect(combat._postAttackOffer).toBeNull();
		await expect(combat._pOpenPostAttackOffer(offer, "triggeredFeatCriticalHit")).resolves.toBe(false);
		expect(combat._page._pRollTriggeredFeatDie).not.toHaveBeenCalled();
	});
});
