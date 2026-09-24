import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const ITEMS = JSON.parse(fs.readFileSync("data/items-base.json", "utf8")).baseitem;
const ARTIFICER_DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));

const MODEL_IDS = {
	Dreadnaught: "efa-armorer:dreadnaught:force-demolisher",
	Guardian: "efa-armorer:guardian:thunder-pulse",
	Infiltrator: "efa-armorer:infiltrator:lightning-launcher",
};

const BASE_DAMAGE = {
	Dreadnaught: "1d10",
	Guardian: "1d8",
	Infiltrator: "1d6",
};

const PERFECTED_DAMAGE = {
	Dreadnaught: "2d6",
	Guardian: "1d10",
	Infiltrator: "2d6",
};

const copy = value => JSON.parse(JSON.stringify(value));

function getBaseItem (name, source = "XPHB") {
	const item = ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing test item ${name}|${source}`);
	return copy(item);
}

function addInventoryItem (state, item, equipped = false) {
	const beforeIds = new Set(state.getItems().map(candidate => candidate.id));
	state.addItem(item, 1, equipped);
	const row = state.getItems().find(candidate =>
		!beforeIds.has(candidate.id)
		&& candidate.name === item.name
		&& candidate.source === item.source);
	if (!row) throw new Error(`Inventory row was not added for ${item.name}|${item.source}`);
	return row;
}

function setCanonicalModel (state, name) {
	state._data.chosenSubfeatures = (state._data.chosenSubfeatures || [])
		.filter(record => !(record.parent === "Armor Model" && record.parentSource === "EFA"));
	if (name) {
		state._data.chosenSubfeatures.push({
			parent: "Armor Model",
			parentSource: "EFA",
			parentClass: "Artificer",
			parentClassSource: "EFA",
			level: 3,
			characterLevel: 3,
			name,
			source: "EFA",
			sourceDecisionKey: "artificer|efa:cl3:featurechoice:armor-model:slot0",
		});
	}
	state.reconcileEfaArmorerState({cause: "perfected-armor-test-model"});
}

function addArmorer (state, {
	level = 15,
	classSource = "EFA",
	subclassSource = "EFA",
} = {}) {
	const classData = ARTIFICER_DATA.class.find(it => it.name === "Artificer" && it.source === classSource);
	const subclassData = ARTIFICER_DATA.subclass.find(it =>
		(it.shortName || it.name) === "Armorer"
		&& it.source === subclassSource
		&& it.className === "Artificer"
		&& it.classSource === classSource);
	state.addClass({
		...(classData ? copy(classData) : {name: "Artificer", source: classSource}),
		level,
		subclass: {
			...(subclassData ? copy(subclassData) : {name: "Armorer", shortName: "Armorer", source: subclassSource}),
			className: "Artificer",
			classSource,
		},
	});
}

function buildState ({
	model = "Guardian",
	level = 15,
	classSource = "EFA",
	subclassSource = "EFA",
	bind = true,
	intelligence = 18,
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
	addArmorer(state, {level, classSource, subclassSource});
	const isExactEfaArmorer = classSource === "EFA" && subclassSource === "EFA";
	if (model && isExactEfaArmorer) setCanonicalModel(state, model);
	state.addArmorProficiency("Heavy Armor");
	state.addToolProficiency("Smith's Tools");
	addInventoryItem(state, getBaseItem("Smith's Tools"));
	const armor = addInventoryItem(state, getBaseItem("Plate Armor"), true);
	if (bind && isExactEfaArmorer) expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
	return {state, armor};
}

function setArtificerLevel (state, level) {
	const current = state.getClasses().find(cls => cls.name === "Artificer" && cls.source === "EFA");
	if (!current) throw new Error("Missing EFA Artificer class");
	state.addClass({...copy(current), level});
	state.reconcileEfaArmorerState({cause: "perfected-armor-test-level"});
}

function getModelRow (state, model) {
	const row = state.getItems().find(item => item._efaArmorerWeaponId === MODEL_IDS[model]);
	if (!row) throw new Error(`Missing generated ${model} weapon row`);
	return row;
}

function getActiveAttack (state) {
	const attacks = state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId);
	expect(attacks).toHaveLength(1);
	return attacks[0];
}

function getModelPower (state, armor, action) {
	return state.getItemPowers().find(power =>
		power.itemId === armor.id
		&& power.efaArcaneArmorModelAction === action);
}

function makeInventoryConsumer (state) {
	const inventory = Object.create(CharacterSheetInventory.prototype);
	inventory._state = state;
	inventory._page = {
		_combat: {
			renderCombatItemPowers: () => {},
			renderCombatActionEconomy: () => {},
		},
		_playMode: {_renderActionsHub: () => {}},
		renderCharacter: () => {},
		_saveCurrentCharacter: () => {},
	};
	inventory._updateItemBonuses = () => {};
	inventory._renderItemList = () => {};
	inventory._renderEquippedItems = () => {};
	inventory._updateArmorClass = () => {};
	inventory._updateEncumbrance = () => {};
	return inventory;
}

function makeDamageConsumer (state, attack) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._cachedAttacks = [attack];
	combat._weaponRiderEnabled = {};
	combat._lastRiderRoundUsed = {};
	combat._selectedCunningStrikes = [];
	combat._page = {
		showDiceResult: jest.fn(),
		pAnimateDamageDice: jest.fn(),
	};
	combat._parseDamage = jest.fn(dice => {
		const match = /^(\d+)d(\d+)$/i.exec(String(dice));
		const count = Number(match?.[1]) || 1;
		const sides = Number(match?.[2]) || 1;
		return {total: count, sides, rolls: Array(count).fill(1)};
	});
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({
		channelSpell: null,
		channelSpellRoll: null,
		channelSpellDamage: 0,
		riderMatched: false,
	});
	combat._promptUseCombatMethod = async () => null;
	combat._pChooseJuggernautTargetContext = async () => "normal";
	combat._pChooseTargetTypeContext = async () => [];
	combat._pSelectDeferredFlatDamageRiderForAttack = async () => null;
	combat._pResolveJuggernautHitEffects = async () => "";
	combat._getSelectedAmmoForWeapon = () => null;
	combat._consumePendingWeaponDamageDie = () => null;
	combat._pOfferEfaLightningLauncherGlimmerAfterDamage = jest.fn();
	return combat;
}

describe("EFA Armorer Perfected Armor generated damage", () => {
	it.each(Object.keys(MODEL_IDS))(
		"keeps %s inert at level 14, upgrades the real descriptor and damage pipeline at 15, then removes only the generated upgrade",
		async model => {
			const {state} = buildState({model, level: 14});
			const rowAtFourteen = getModelRow(state, model);
			const wrapperId = rowAtFourteen.id;
			state.replaceItem(wrapperId, {...rowAtFourteen, name: `Customized ${model} Weapon`});
			expect(getActiveAttack(state)).toMatchObject({
				id: MODEL_IDS[model],
				name: `Customized ${model} Weapon`,
				damage: BASE_DAMAGE[model],
			});
			expect(state.getFeatureCalculations().hasEfaPerfectedArmor).toBe(false);

			setArtificerLevel(state, 15);
			const attack = getActiveAttack(state);
			expect(getModelRow(state, model)).toMatchObject({
				id: wrapperId,
				name: `Customized ${model} Weapon`,
				dmg1: PERFECTED_DAMAGE[model],
			});
			expect(attack).toMatchObject({
				id: MODEL_IDS[model],
				name: `Customized ${model} Weapon`,
				damage: PERFECTED_DAMAGE[model],
			});
			const combat = makeDamageConsumer(state, attack);
			await combat._rollDamage(attack.id);
			expect(combat._parseDamage).toHaveBeenCalledWith(PERFECTED_DAMAGE[model], false, {maximize: false});
			expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
				title: `Customized ${model} Weapon Damage`,
			}));
			expect(combat._pOfferEfaLightningLauncherGlimmerAfterDamage).toHaveBeenCalledTimes(1);

			setArtificerLevel(state, 14);
			expect(getModelRow(state, model)).toMatchObject({
				id: wrapperId,
				name: `Customized ${model} Weapon`,
				dmg1: BASE_DAMAGE[model],
			});
			expect(getActiveAttack(state).damage).toBe(BASE_DAMAGE[model]);
		},
	);

	it("preserves a player damage override instead of rewriting it during a level downgrade", () => {
		const {state} = buildState({model: "Dreadnaught", level: 15});
		const row = getModelRow(state, "Dreadnaught");
		state.replaceItem(row.id, {...row, dmg1: "1d12"});
		setArtificerLevel(state, 14);
		expect(getModelRow(state, "Dreadnaught")).toMatchObject({id: row.id, dmg1: "1d12"});
	});

	it("upgrades only the exact active bound model and moves the generated upgrade on a model switch", () => {
		const {state} = buildState({model: "Guardian", level: 15});
		expect(getModelRow(state, "Guardian").dmg1).toBe("1d10");
		expect(getModelRow(state, "Dreadnaught").dmg1).toBe("1d10");
		expect(getModelRow(state, "Infiltrator").dmg1).toBe("1d6");
		setCanonicalModel(state, "Infiltrator");
		expect(getModelRow(state, "Guardian").dmg1).toBe("1d8");
		expect(getModelRow(state, "Infiltrator").dmg1).toBe("2d6");
	});
});

describe("EFA Armorer Perfected Dreadnaught", () => {
	it("extends the existing Giant Stature transaction with +10 reach, Huge choice, and Strength Advantage", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		state.setSize("medium");
		state.startCombat();
		const before = copy(state.getResource("Giant Stature"));
		const result = await state.activateEfaGiantStature({hasRoom: true, targetSize: "huge"});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			actionConsumed: true,
			result: {
				reachBonus: 10,
				targetSize: "huge",
				sizeSteps: 2,
				strengthAdvantage: true,
			},
		});
		expect(state.getResource("Giant Stature")).toMatchObject({
			current: before.current - 1,
			max: before.max,
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(state.getSize()).toBe("huge");
		expect(state.getMeleeReach()).toBe(15);
		expect(state.getActiveStateEffects()).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "advantage", target: "check:str"}),
			expect.objectContaining({type: "advantage", target: "save:str"}),
		]));
	});

	it("round-trips the chosen size and spent uses, then causally removes only the level-15 layers on downgrade", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		state.setSize("small");
		await state.activateEfaGiantStature({targetSize: "huge"});
		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.getSize()).toBe("huge");
		expect(restored.getMeleeReach()).toBe(15);
		expect(restored.getResource("Giant Stature")).toMatchObject({current: 3, max: 4});

		setArtificerLevel(restored, 14);
		expect(restored.isStateTypeActive("giantStature")).toBe(true);
		expect(restored.getSize()).toBe("large");
		expect(restored.getMeleeReach()).toBe(10);
		expect(restored.getActiveStateEffects()).not.toEqual(expect.arrayContaining([
			expect.objectContaining({type: "advantage", target: "check:str"}),
		]));
	});

	it("uses the existing control for Large/Huge choice and cancellation spends nothing", async () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		state.startCombat();
		const inventory = makeInventoryConsumer(state);
		const power = getModelPower(state, armor, "giant-stature");
		const before = copy(state.getResource("Giant Stature"));
		const prompt = jest.spyOn(InputUiUtil, "pGetUserEnum").mockResolvedValueOnce(null);
		await expect(inventory._pInvokeItemPower(armor.id, power.id)).resolves.toBe(false);
		expect(state.getResource("Giant Stature")).toMatchObject(before);
		expect(state.isActionTypeAvailable("bonus")).toBe(true);

		prompt.mockResolvedValueOnce("Become Huge");
		await expect(inventory._pInvokeItemPower(armor.id, power.id)).resolves.toBe(true);
		expect(prompt).toHaveBeenLastCalledWith(expect.objectContaining({
			values: ["Become Large", "Become Huge", "Reach only — insufficient room"],
		}));
		expect(state.getSize()).toBe("huge");
		prompt.mockRestore();
	});

	it("tears down through the authoritative binding/model/death lifecycle", async () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		await state.activateEfaGiantStature({targetSize: "huge"});
		setCanonicalModel(state, "Guardian");
		expect(state.isStateTypeActive("giantStature")).toBe(false);
		setCanonicalModel(state, "Dreadnaught");
		await state.activateEfaGiantStature({targetSize: "large"});
		state.setItemEquipped(armor.id, false);
		expect(state.isStateTypeActive("giantStature")).toBe(false);
		state.setItemEquipped(armor.id, true);
		await state.activateEfaGiantStature({targetSize: "large"});
		state.setDeathSaves({successes: 0, failures: 3});
		expect(state.isStateTypeActive("giantStature")).toBe(false);
	});
});

describe("EFA Armorer Perfected Guardian", () => {
	it("validates every rule-critical gate before atomically spending the Reaction and dedicated use", async () => {
		const {state} = buildState({model: "Guardian"});
		state.startCombat();
		const status = state.getEfaPerfectedGuardianStatus();
		expect(status).toMatchObject({ok: true, saveDc: 17, range: 30, maxTargetSize: "huge", maxPullDistance: 25});
		const resourceBefore = copy(status.resource);
		const invalidContexts = [
			{targetName: "Dragon", targetSize: "gargantuan", distance: 20, isVisible: true, endedTurn: true, saveOutcome: "failed", pullDistance: 10},
			{targetName: "Ogre", targetSize: "large", distance: 31, isVisible: true, endedTurn: true, saveOutcome: "failed", pullDistance: 10},
			{targetName: "Ogre", targetSize: "large", distance: 20, isVisible: false, endedTurn: true, saveOutcome: "failed", pullDistance: 10},
			{targetName: "Ogre", targetSize: "large", distance: 20, isVisible: true, endedTurn: false, saveOutcome: "failed", pullDistance: 10},
			{targetName: "Ogre", targetSize: "large", distance: 20, isVisible: true, endedTurn: true, saveOutcome: "succeeded", pullDistance: 10},
			{targetName: "Ogre", targetSize: "large", distance: 20, isVisible: true, endedTurn: true, saveOutcome: "failed", pullDistance: 21},
		];
		for (const context of invalidContexts) {
			await expect(state.activateEfaPerfectedGuardian(context)).resolves.toMatchObject({ok: false, committed: false});
			expect(state.getEfaPerfectedGuardianStatus().resource).toMatchObject(resourceBefore);
			expect(state.isActionTypeAvailable("reaction")).toBe(true);
		}

		const result = await state.activateEfaPerfectedGuardian({
			targetName: "Ogre",
			targetSize: "large",
			distance: 30,
			isVisible: true,
			endedTurn: true,
			saveOutcome: "failed",
			pullDistance: 25,
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			actionConsumed: true,
			saveDc: 17,
			pullDistance: 25,
			finalDistance: 5,
			result: {
				pull: {direction: "toward-wearer", distance: 25, finalDistance: 5},
				isAdjacent: true,
			},
		});
		expect(result.meleeAttackOptions).toEqual(expect.arrayContaining([
			expect.objectContaining({id: MODEL_IDS.Guardian, name: "Thunder Pulse"}),
		]));
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(state.getEfaPerfectedGuardianStatus().resource).toMatchObject({current: 3, max: 4});
	});

	it("preserves total spend across Intelligence changes and save/load, while Long Rest restores the pool", async () => {
		const {state} = buildState({model: "Guardian"});
		state.startCombat();
		await state.activateEfaPerfectedGuardian({
			targetName: "Ogre",
			targetSize: "large",
			distance: 20,
			isVisible: true,
			endedTurn: true,
			saveOutcome: "failed",
			pullDistance: 10,
		});
		state.setAbilityBase("int", 10);
		state.resetTurnEconomy();
		expect(state.getEfaPerfectedGuardianStatus().resource).toMatchObject({current: 0, max: 1});
		state.setAbilityBase("int", 20);
		expect(state.getEfaPerfectedGuardianStatus().resource).toMatchObject({current: 4, max: 5});

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.getEfaPerfectedGuardianStatus().resource).toMatchObject({current: 4, max: 5});
		restored.recoverResources("long");
		expect(restored.getEfaPerfectedGuardianStatus().resource).toMatchObject({current: 5, max: 5});
	});

	it("preserves spent uses across model switches, hides the power below level 15, and removes the exact-owned resource on source loss", async () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.startCombat();
		await state.activateEfaPerfectedGuardian({
			targetName: "Ogre",
			targetSize: "large",
			distance: 20,
			isVisible: true,
			endedTurn: true,
			saveOutcome: "failed",
			pullDistance: 10,
		});
		setCanonicalModel(state, "Infiltrator");
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.guardian.id)).toMatchObject({current: 3, max: 4});
		setCanonicalModel(state, "Guardian");
		expect(getModelPower(state, armor, "perfected-guardian")).toMatchObject({usesCurrent: 3, usesMax: 4});
		setArtificerLevel(state, 14);
		expect(getModelPower(state, armor, "perfected-guardian")).toBeUndefined();
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.guardian.id)).toBeNull();

		setArtificerLevel(state, 15);
		state._data.classes[0].subclass.source = "TCE";
		state.reconcileEfaArmorerState({cause: "perfected-armor-test-source-loss"});
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.guardian.id)).toBeNull();
	});

	it("keeps the committed Reaction when optional follow-up selection fails and never spends a second Reaction", async () => {
		const {state} = buildState({model: "Guardian"});
		state.startCombat();
		const result = await state.activateEfaPerfectedGuardian({
			targetName: "Ogre",
			targetSize: "large",
			distance: 10,
			isVisible: true,
			endedTurn: true,
			saveOutcome: "failed",
			pullDistance: 5,
		});
		const inventory = makeInventoryConsumer(state);
		const prompt = jest.spyOn(InputUiUtil, "pGetUserEnum").mockRejectedValue(new Error("modal failed"));
		const resolved = await inventory._pResolveEfaPerfectedGuardianFollowUp(result);
		expect(resolved).toMatchObject({
			ok: true,
			committed: true,
			followUpFailed: true,
			guardianFollowUp: {ok: false, error: "modal failed"},
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.guardian.id)).toMatchObject({current: 3});
		prompt.mockRestore();
	});

	it("renders action type, counts, exact disabled copy, and success feedback through the existing item-power row", async () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.startCombat();
		const power = getModelPower(state, armor, "perfected-guardian");
		expect(power).toMatchObject({
			actionType: "reaction",
			usesCurrent: 4,
			usesMax: 4,
			saveDc: 17,
			isAvailable: true,
		});
		expect(power.description).toContain("pull it 0–25 feet");
		state.consumeActionType("reaction");
		expect(getModelPower(state, armor, "perfected-guardian")).toMatchObject({
			actionType: "reaction",
			usesCurrent: 4,
			usesMax: 4,
			invokeLabel: "React",
			isAvailable: false,
			unavailableReason: "Reaction already used this turn.",
		});
	});

	it("treats cancellation as a no-op and surfaces the committed pull/follow-up result", async () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.startCombat();
		const inventory = makeInventoryConsumer(state);
		const power = getModelPower(state, armor, "perfected-guardian");
		const context = jest.spyOn(inventory, "_pGetEfaPerfectedGuardianContext").mockResolvedValueOnce(null);
		const before = copy(state.getEfaPerfectedGuardianStatus().resource);
		await expect(inventory._pInvokeItemPower(armor.id, power.id)).resolves.toBe(false);
		expect(state.getEfaPerfectedGuardianStatus().resource).toMatchObject(before);
		expect(state.isActionTypeAvailable("reaction")).toBe(true);

		context.mockResolvedValueOnce({
			targetName: "Ogre",
			targetSize: "large",
			distance: 30,
			isVisible: true,
			endedTurn: true,
			saveOutcome: "failed",
			pullDistance: 25,
		});
		const followUp = jest.spyOn(inventory, "_pResolveEfaPerfectedGuardianFollowUp")
			.mockImplementation(async result => ({...result, guardianFollowUp: {ok: true, declined: true}}));
		const toast = jest.spyOn(JqueryUtil, "doToast");
		const result = await inventory._pInvokeItemPower(armor.id, power.id, {returnResult: true});
		expect(result).toMatchObject({ok: true, finalDistance: 5, guardianFollowUp: {declined: true}});
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			type: "success",
			content: expect.stringContaining("pull 25 feet"),
		}));
		context.mockRestore();
		followUp.mockRestore();
		toast.mockRestore();
	});
});

describe("EFA Armorer Perfected Infiltrator glimmer", () => {
	it("applies only from committed exact stable Lightning Launcher damage, refreshes, and uses owner-only disadvantage semantics", () => {
		const {state} = buildState({model: "Infiltrator"});
		state.startCombat();
		const attack = getActiveAttack(state);
		const first = state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-lightning-launcher-glimmer",
				effect: "glimmer",
				attackId: attack.id,
			},
		});
		expect(first).toMatchObject({
			ok: true,
			applied: true,
			target: {
				attackId: MODEL_IDS.Infiltrator,
				model: "Infiltrator",
				dimLightFeet: 5,
				attackDisadvantage: {against: "owner"},
				expiry: {type: "ownerTurnStart", combatRound: 2},
			},
		});
		expect(state.getTargetAttackDisadvantage(first.target.id, {
			defenderOwnerUid: CharacterSheetState.EFA_ARMORER_FEATURE_OWNERS.perfectedArmor.uid,
		})).toBe(true);
		expect(state.getTargetAttackDisadvantage(first.target.id, {defenderOwnerUid: "another-owner"})).toBe(false);

		const refreshed = state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetId: first.target.id,
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-lightning-launcher-glimmer",
				effect: "glimmer",
				attackId: attack.id,
			},
		});
		expect(refreshed.target.id).toBe(first.target.id);
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toHaveLength(1);
		const sameNameTarget = state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-lightning-launcher-glimmer",
				effect: "glimmer",
				attackId: attack.id,
			},
		});
		expect(sameNameTarget.target.id).not.toBe(first.target.id);
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toHaveLength(2);
		state.resetTurnEconomy();
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toEqual([]);
	});

	it("rejects level 14, wrong attack IDs, inactive bindings, and TCE/mixed-source controls", () => {
		const levelFourteen = buildState({model: "Infiltrator", level: 14}).state;
		expect(levelFourteen.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {source: "efa-armorer-lightning-launcher-glimmer", effect: "glimmer", attackId: MODEL_IDS.Infiltrator},
		})).toMatchObject({ok: false, reason: "inactive-lightning-launcher-glimmer"});

		const {state, armor} = buildState({model: "Infiltrator"});
		expect(state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {source: "efa-armorer-lightning-launcher-glimmer", effect: "glimmer", attackId: "auto-renamed-launcher"},
		})).toMatchObject({ok: false, reason: "inactive-lightning-launcher-glimmer"});
		state.setItemEquipped(armor.id, false);
		expect(state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {source: "efa-armorer-lightning-launcher-glimmer", effect: "glimmer", attackId: MODEL_IDS.Infiltrator},
		})).toMatchObject({ok: false, reason: "inactive-lightning-launcher-glimmer"});

		for (const sources of [
			{classSource: "TCE", subclassSource: "TCE"},
			{classSource: "EFA", subclassSource: "TCE"},
			{classSource: "TCE", subclassSource: "EFA"},
		]) {
			const control = buildState({...sources, model: null, bind: false}).state;
			expect(control.getFeatureCalculations().hasEfaLightningLauncherGlimmer).not.toBe(true);
		}
	});

	it("binds to the stable attack ID after rename and tears down on model, binding, death, and combat loss", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.startCombat();
		const launcher = getModelRow(state, "Infiltrator");
		state.replaceItem(launcher.id, {...launcher, name: "Storm Needle"});
		const apply = () => state.applyTargetEffect({
			source: "efa-armorer-lightning-launcher-glimmer",
			effect: "glimmer",
			targetName: "Ogre",
			targetEffect: {source: "efa-armorer-lightning-launcher-glimmer", effect: "glimmer", attackId: MODEL_IDS.Infiltrator},
		});
		expect(apply()).toMatchObject({ok: true});
		setCanonicalModel(state, "Guardian");
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toEqual([]);
		setCanonicalModel(state, "Infiltrator");
		expect(apply()).toMatchObject({ok: true});
		state.setItemEquipped(armor.id, false);
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toEqual([]);
		state.setItemEquipped(armor.id, true);
		expect(apply()).toMatchObject({ok: true});
		state.setDeathSaves({successes: 0, failures: 3});
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toEqual([]);
		state.resetDeathSaves();
		state.bindEfaArcaneArmor(armor.id);
		state.startCombat();
		expect(apply()).toMatchObject({ok: true});
		state.endCombat();
		expect(state.getTargetEffects({source: "efa-armorer-lightning-launcher-glimmer"})).toEqual([]);
	});

	it("offers the target form only after the exact active Lightning Launcher damage path completes", async () => {
		const {state} = buildState({model: "Infiltrator"});
		const attack = getActiveAttack(state);
		const combat = makeDamageConsumer(state, attack);
		await combat._rollDamage(attack.id);
		expect(combat._page.showDiceResult).toHaveBeenCalledTimes(1);
		expect(combat._pOfferEfaLightningLauncherGlimmerAfterDamage)
			.toHaveBeenCalledWith(expect.objectContaining({id: MODEL_IDS.Infiltrator}), expect.objectContaining({rollFollowup: expect.anything()}));

		const realOffer = Object.create(CharacterSheetCombat.prototype);
		realOffer._state = state;
		realOffer._pOfferTargetEffect = jest.fn();
		await realOffer._pOfferEfaLightningLauncherGlimmerAfterDamage(attack);
		expect(realOffer._pOfferTargetEffect).toHaveBeenCalledWith(
			expect.objectContaining({attack}),
			expect.objectContaining({
				targetEffect: {
					source: "efa-armorer-lightning-launcher-glimmer",
					effect: "glimmer",
					attackId: MODEL_IDS.Infiltrator,
				},
			}),
		);
	});
});

describe("EFA Armorer Perfected Infiltrator flight", () => {
	it("commits the Bonus Action/use and grants a live Fly Speed equal to twice current Speed until turn end", async () => {
		const {state} = buildState({model: "Infiltrator"});
		state.startCombat();
		const status = state.getEfaPerfectedArmorFlightStatus();
		expect(status).toMatchObject({ok: true, speed: 35, flySpeed: 70, resource: {current: 4, max: 4}});
		const result = await state.activateEfaPerfectedArmorFlight();
		expect(result).toMatchObject({ok: true, committed: true, actionConsumed: true, flySpeed: 70});
		expect(state.getSpeedByType("fly")).toBe(70);
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.flight.id)).toMatchObject({current: 3, max: 4});

		state.setSpeed("walk", 40);
		expect(state.getWalkSpeed()).toBe(45);
		expect(state.getSpeedByType("fly")).toBe(90);
		state.setItemBonuses({speedMultiply: {"*": 2}});
		expect(state.getWalkSpeed()).toBe(90);
		expect(state.getSpeedByType("fly")).toBe(180);
		expect(state.getSpeed()).toContain("fly 180 ft.");
		state.resetTurnEconomy();
		expect(state.isStateTypeActive("efaPerfectedArmorFlight")).toBe(false);
		expect(state.getSpeedByType("fly")).toBe(0);
	});

	it("round-trips active flight and spent uses, preserves spend across Intelligence changes, and restores on Long Rest", async () => {
		const {state} = buildState({model: "Infiltrator"});
		await state.activateEfaPerfectedArmorFlight();
		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.isStateTypeActive("efaPerfectedArmorFlight")).toBe(true);
		expect(restored.getSpeedByType("fly")).toBe(70);
		expect(restored.getEfaPerfectedArmorFlightStatus().resource).toMatchObject({current: 3, max: 4});
		restored.setAbilityBase("int", 10);
		expect(restored.getEfaPerfectedArmorFlightStatus().resource).toMatchObject({current: 0, max: 1});
		restored.setAbilityBase("int", 20);
		expect(restored.getEfaPerfectedArmorFlightStatus().resource).toMatchObject({current: 4, max: 5});
		restored.recoverResources("long");
		expect(restored.getEfaPerfectedArmorFlightStatus().resource).toMatchObject({current: 5, max: 5});
	});

	it("preserves the resource across model switches and tears down flight on model/source/binding/death loss", async () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		await state.activateEfaPerfectedArmorFlight();
		setCanonicalModel(state, "Guardian");
		expect(state.isStateTypeActive("efaPerfectedArmorFlight")).toBe(false);
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.flight.id)).toMatchObject({current: 3, max: 4});
		setCanonicalModel(state, "Infiltrator");
		await state.activateEfaPerfectedArmorFlight();
		state.setItemEquipped(armor.id, false);
		expect(state.isStateTypeActive("efaPerfectedArmorFlight")).toBe(false);
		state.setItemEquipped(armor.id, true);
		await state.activateEfaPerfectedArmorFlight();
		state.setDeathSaves({successes: 0, failures: 3});
		expect(state.isStateTypeActive("efaPerfectedArmorFlight")).toBe(false);
		state._data.classes[0].subclass.source = "TCE";
		state.reconcileEfaArmorerState({cause: "perfected-armor-test-source-loss"});
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.flight.id)).toBeNull();
	});

	it("shows computed speed/counts and makes cancellation a no-op before commit", async () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.startCombat();
		const inventory = makeInventoryConsumer(state);
		const power = getModelPower(state, armor, "perfected-flight");
		expect(power).toMatchObject({
			actionType: "bonus",
			speed: 35,
			flySpeed: 70,
			usesCurrent: 4,
			usesMax: 4,
			isAvailable: true,
		});
		expect(power.description).toContain("twice your current 35-foot Speed");
		const confirm = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValueOnce(false);
		await expect(inventory._pInvokeItemPower(armor.id, power.id)).resolves.toBe(false);
		expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.flight.id)).toMatchObject({current: 4, max: 4});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);

		confirm.mockResolvedValueOnce(true);
		const toast = jest.spyOn(JqueryUtil, "doToast");
		const result = await inventory._pInvokeItemPower(armor.id, power.id, {returnResult: true});
		expect(result).toMatchObject({ok: true, committed: true, flySpeed: 70});
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			type: "success",
			content: expect.stringContaining("Fly Speed 70 feet"),
		}));
		confirm.mockRestore();
		toast.mockRestore();
	});
});

describe("EFA Perfected Armor exact-source isolation", () => {
	it("never projects onto TCE or mixed-source Armorers", () => {
		for (const sources of [
			{classSource: "TCE", subclassSource: "TCE"},
			{classSource: "EFA", subclassSource: "TCE"},
			{classSource: "TCE", subclassSource: "EFA"},
		]) {
			const {state} = buildState({...sources, model: null, bind: false});
			const calc = state.getFeatureCalculations();
			expect(calc.hasEfaPerfectedArmor).not.toBe(true);
			expect(state.getItems().filter(item => item._efaArmorerWeaponId)).toEqual([]);
			expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.guardian.id)).toBeNull();
			expect(state.getResource(CharacterSheetState.EFA_PERFECTED_ARMOR_RESOURCES.flight.id)).toBeNull();
		}
	});
});
