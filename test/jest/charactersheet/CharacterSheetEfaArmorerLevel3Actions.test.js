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

const copy = value => JSON.parse(JSON.stringify(value));

function getBaseItem (name, source = "XPHB") {
	const item = ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing test item ${name}|${source}`);
	return copy(item);
}

function addInventoryItem (state, item, equipped = false) {
	state.addItem(item, 1, equipped);
	const row = state.getItems().find(candidate =>
		candidate.name === item.name
		&& candidate.source === item.source);
	if (!row) throw new Error(`Inventory row was not added for ${item.name}|${item.source}`);
	return row;
}

function setCanonicalModel (state, name) {
	const ref = `${name}|Artificer|EFA|Armorer|EFA|3|EFA`;
	state._data.chosenSubfeatures = (state._data.chosenSubfeatures || [])
		.filter(record => !(record.parent === "Armor Model" && record.parentSource === "EFA"));
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
	const history = state._data.levelHistory.find(entry =>
		entry.class?.name === "Artificer"
		&& entry.class?.source === "EFA"
		&& Number(entry.classLevel) === 3);
	if (history) {
		history.choices ||= {};
		history.choices.featureChoices = [{
			featureName: "Armor Model",
			choice: name,
			source: "EFA",
			acquisitionLevel: 3,
			ref,
			type: "subclassFeature",
		}];
		history.choices.replayData = {
			...(history.choices.replayData || {}),
			featureChoices: [{
				name,
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Armorer",
				subclassSource: "EFA",
				level: 3,
				parentFeature: "Armor Model",
				acquisitionLevel: 3,
				ref,
			}],
		};
		history.decisions = [{
			type: "featureChoice",
			label: "Armor Model",
			sourceKey: "Armor Model",
			required: true,
			count: 1,
			status: "resolved",
			selection: [{choice: name, source: "EFA", ref}],
		}];
		history.complete = true;
	}
	state.getFeatureCalculations();
}

function addArmorer (state, {classSource = "EFA", subclassSource = "EFA"} = {}) {
	const classData = ARTIFICER_DATA.class.find(it => it.name === "Artificer" && it.source === classSource);
	const subclassData = ARTIFICER_DATA.subclass.find(it =>
		(it.shortName || it.name) === "Armorer"
		&& it.source === subclassSource
		&& it.className === "Artificer"
		&& it.classSource === classSource);
	state.addClass({
		...(classData ? copy(classData) : {name: "Artificer", source: classSource}),
		level: 3,
		subclass: {
			...(subclassData ? copy(subclassData) : {name: "Armorer", shortName: "Armorer", source: subclassSource}),
			className: "Artificer",
			classSource,
		},
	});
	for (let classLevel = 1; classLevel <= 3; ++classLevel) {
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Artificer", source: classSource},
			classLevel,
			choices: classLevel === 3
				? {subclass: {name: "Armorer", shortName: "Armorer", source: subclassSource}}
				: {},
			complete: true,
		});
	}
}

function buildState ({
	model = "Guardian",
	classSource = "EFA",
	subclassSource = "EFA",
	bind = true,
} = {}) {
	const state = new CharacterSheetState();
	addArmorer(state, {classSource, subclassSource});
	if (model && classSource === "EFA" && subclassSource === "EFA") setCanonicalModel(state, model);
	state.addArmorProficiency("Heavy Armor");
	state.addToolProficiency("Smith's Tools");
	addInventoryItem(state, getBaseItem("Smith's Tools"));
	const armor = addInventoryItem(state, getBaseItem("Plate Armor"), true);
	if (bind && classSource === "EFA" && subclassSource === "EFA") {
		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
	}
	return {state, armor};
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

function makeCombatConsumer (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {};
	combat._lastRiderRoundUsed = {};
	combat._weaponRiderEnabled = {};
	return combat;
}

describe("EFA Armorer level-3 calculation contracts", () => {
	it("emits exact stable attack selectors for each active model and isolates TCE/mixed-source builds", () => {
		expect(CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT).toEqual({
			key: "subclassFeature:Infiltrator|Artificer|EFA|Armorer|EFA|3|EFA:action:lightning-launcher-extra-damage",
			ownerUid: "subclass:Armorer|EFA|Artificer|EFA",
			sourceUid: "subclassFeature:Infiltrator|Artificer|EFA|Armorer|EFA|3|EFA",
			actionUid: "lightning-launcher-extra-damage",
		});
		const dread = buildState({model: "Dreadnaught"}).state.getFeatureCalculations();
		expect(dread.attackOnHitOptions).toContainEqual(expect.objectContaining({
			id: "efa-armorer-force-demolisher-movement",
			attackIds: [MODEL_IDS.Dreadnaught],
		}));

		const guardian = buildState({model: "Guardian"}).state.getFeatureCalculations();
		expect(guardian.attackOnHitOptions).toContainEqual(expect.objectContaining({
			id: "efa-armorer-thunder-pulse-disadvantage",
			attackIds: [MODEL_IDS.Guardian],
			allowTrackOnly: false,
		}));

		const infiltrator = buildState({model: "Infiltrator"}).state.getFeatureCalculations();
		expect(infiltrator.weaponDamageRiders).toContainEqual(expect.objectContaining({
			id: "efa-armorer-lightning-launcher-extra-damage",
			dice: "1d6",
			damageType: "lightning",
			perTurn: true,
			attackIds: [MODEL_IDS.Infiltrator],
			turnReceipt: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT,
		}));

		for (const sources of [
			{classSource: "TCE", subclassSource: "TCE"},
			{classSource: "EFA", subclassSource: "TCE"},
			{classSource: "TCE", subclassSource: "EFA"},
		]) {
			const state = buildState({...sources, bind: false}).state;
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEfaArmorer).not.toBe(true);
			expect(calculations.attackOnHitOptions || []).toEqual([]);
			expect(calculations.weaponDamageRiders || []).not.toContainEqual(expect.objectContaining({
				id: "efa-armorer-lightning-launcher-extra-damage",
			}));
			expect(state.getResource("Giant Stature")).toBeNull();
		}
	});

	it("suppresses only exact seven-part EFA Armorer model wrappers from generic activation", () => {
		const dreadnaught = ARTIFICER_DATA.subclassFeature.find(feature =>
			feature.name === "Dreadnaught"
			&& feature.source === "EFA"
			&& feature.classSource === "EFA"
			&& feature.subclassSource === "EFA"
			&& feature.level === 3);
		const canonical = {
			...copy(dreadnaught),
			description: CharacterSheetState._featureTextFromEntries(dreadnaught),
		};
		expect(CharacterSheetState.isEfaArmorerModelFeature(canonical)).toBe(true);
		expect(CharacterSheetState.detectActivatableFeature(canonical)).toBeNull();

		const lookalike = {
			...canonical,
			name: "Siege Growth",
			source: "HB",
			className: "Fighter",
			classSource: "PHB",
			subclassShortName: "Siege Knight",
			subclassSource: "HB",
		};
		expect(CharacterSheetState.isEfaArmorerModelFeature(lookalike)).toBe(false);
		expect(CharacterSheetState.detectActivatableFeature(lookalike)).not.toBeNull();
	});
});

describe("EFA Armorer Combat integration", () => {
	it("matches only exact stable generated attack identities, not editable names or shared source labels", () => {
		const dread = buildState({model: "Dreadnaught"}).state;
		const dreadCombat = makeCombatConsumer(dread);
		const renamedDreadAttack = {
			id: MODEL_IDS.Dreadnaught,
			name: "My Customized Demolisher",
			sourceFeature: "Renamed Armor Model",
		};
		expect(dreadCombat._getEligibleOnHitOptions(renamedDreadAttack)).toEqual([
			expect.objectContaining({id: "efa-armorer-force-demolisher-movement"}),
		]);
		expect(dreadCombat._getEligibleOnHitOptions({
			id: "different-generated-weapon",
			name: "Force Demolisher",
			sourceFeature: "Armor Model",
		})).toEqual([]);

		const infiltrator = buildState({model: "Infiltrator"}).state;
		const infiltratorCombat = makeCombatConsumer(infiltrator);
		const rider = infiltrator.getFeatureCalculations().weaponDamageRiders
			.find(it => it.id === "efa-armorer-lightning-launcher-extra-damage");
		expect(infiltratorCombat._isWeaponDamageRiderEligible(rider, {
			id: MODEL_IDS.Infiltrator,
			name: "Storm Needle",
			sourceFeature: "Renamed Armor Model",
		})).toBe(true);
		expect(infiltratorCombat._isWeaponDamageRiderEligible(rider, {
			id: "same-label-collision",
			name: "Lightning Launcher",
			sourceFeature: "Armor Model",
		})).toBe(false);
	});

	it("uses only the Base M1E turn-receipt contract for Lightning Launcher", () => {
		const {state} = buildState({model: "Infiltrator"});
		const combat = makeCombatConsumer(state);
		const rider = state.getFeatureCalculations().weaponDamageRiders
			.find(it => it.id === "efa-armorer-lightning-launcher-extra-damage");
		let liveReceipt = null;
		state.queryTurnReceipt = jest.fn(key => ({
			ok: true,
			used: !!liveReceipt,
			key,
			turnId: 7,
			receipt: liveReceipt,
		}));
		state.commitTurnReceipt = jest.fn(descriptor => {
			if (liveReceipt) return {ok: false, committed: false, duplicate: true, reason: "alreadyUsed", receipt: liveReceipt};
			liveReceipt = {...descriptor, receiptId: "receipt-1", turnId: 7};
			return {ok: true, committed: true, duplicate: false, reason: null, receipt: copy(liveReceipt)};
		});
		state.rollbackTurnReceipt = jest.fn(receipt => {
			const matches = receipt?.receiptId === liveReceipt?.receiptId;
			if (matches) liveReceipt = null;
			return {ok: matches, rolledBack: matches};
		});

		expect(combat._isRiderAvailableThisTurn(rider)).toBe(true);
		const committed = combat._markRiderUsedThisTurn(rider, {attackId: MODEL_IDS.Infiltrator});
		expect(committed).toMatchObject({ok: true, committed: true});
		expect(state.commitTurnReceipt).toHaveBeenCalledWith({
			...CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT,
			metadata: {attackId: MODEL_IDS.Infiltrator},
		});
		expect(combat._isRiderAvailableThisTurn(rider)).toBe(false);
		expect(combat._markRiderUsedThisTurn(rider)).toMatchObject({
			ok: false,
			committed: false,
			reason: "alreadyUsed",
		});
		expect(combat._lastRiderRoundUsed).toEqual({});
		expect(state.rollbackTurnReceipt(committed.receipt)).toMatchObject({ok: true, rolledBack: true});
		expect(combat._isRiderAvailableThisTurn(rider)).toBe(true);
	});

	it("does not spend a legacy once-per-round rider when damage dice resolution throws", async () => {
		const combat = makeCombatConsumer({
			getAttacks: () => [{
				id: "legacy-attack",
				name: "Legacy Attack",
				damage: "1d8",
				damageType: "slashing",
				abilityMod: "str",
				sourceItem: {id: "legacy-item"},
			}],
			getWeaponAbilityMod: () => 3,
			getNamedModifiersByType: () => [],
			getItemWeaponScopedDamageContributions: () => [],
			getFeatureCalculations: () => ({
				weaponDamageRiders: [{
					id: "legacy-rider",
					name: "Legacy Rider",
					dice: "1d6",
					damageType: "fire",
					perTurn: true,
				}],
			}),
			isInCombat: () => true,
			getCombatRound: () => 4,
		});
		combat._weaponRiderEnabled = {"legacy-rider": true};
		combat._page = {
			showDiceResult: jest.fn(),
			pAnimateDamageDice: jest.fn(),
		};
		combat._parseDamage = jest.fn(dice => {
			if (dice === "1d6") throw new Error("rider dice failed");
			return {total: 5, sides: 8, rolls: [5]};
		});
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({
			channelSpell: null,
			channelSpellRoll: null,
			channelSpellDamage: 0,
			riderMatched: false,
		});
		combat._promptUseCombatMethod = async () => null;

		await expect(combat._rollDamage("legacy-attack", false)).rejects.toThrow("rider dice failed");
		expect(combat._lastRiderRoundUsed).toEqual({});
	});

	it("does not double-consume a Bonus Action already committed by an armor item power", async () => {
		const combat = makeCombatConsumer({});
		combat._isActionTypeAvailable = jest.fn(() => true);
		combat._consumeActionType = jest.fn();
		combat.renderCombatItemPowers = jest.fn();
		combat.renderCombatActionEconomy = jest.fn();
		combat._page = {
			_inventory: {
				_pInvokeItemPower: jest.fn(async () => ({ok: true, committed: true, actionConsumed: true})),
			},
		};
		await expect(combat._pInvokeCombatItemPower({
			id: "giant-stature",
			itemId: "armor-1",
			isAvailable: true,
			actionType: "bonus",
			chargesCost: 0,
			chargesCostMax: 0,
		})).resolves.toBe(true);
		expect(combat._page._inventory._pInvokeItemPower).toHaveBeenCalledWith(
			"armor-1",
			"giant-stature",
			{returnResult: true},
		);
		expect(combat._consumeActionType).not.toHaveBeenCalled();
	});

	it("prunes Lightning Launcher receipts only after exact model or Armorer source teardown", () => {
		const {state} = buildState({model: "Infiltrator"});
		state.pruneTurnReceipts = jest.fn(() => ({ok: true, pruned: 1}));
		state.reconcileEfaArmorerState({cause: "control"});
		expect(state.pruneTurnReceipts).not.toHaveBeenCalled();

		setCanonicalModel(state, "Guardian");
		expect(state.pruneTurnReceipts).toHaveBeenCalledWith({
			ownerUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.ownerUid,
			sourceUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.sourceUid,
			actionUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.actionUid,
		});
		state.pruneTurnReceipts.mockClear();

		state._data.classes[0].subclass.source = "TCE";
		state.reconcileEfaArmorerState({cause: "source-loss"});
		expect(state.pruneTurnReceipts).toHaveBeenCalledWith({
			ownerUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.ownerUid,
			sourceUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.sourceUid,
			actionUid: CharacterSheetState.EFA_LIGHTNING_LAUNCHER_TURN_RECEIPT.actionUid,
		});
	});
});

describe("Dreadnaught level-3 mechanics", () => {
	it("resolves Force Demolisher movement only for a committed eligible stable attack hit", () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		expect(state.resolveEfaForceDemolisherHitRider({
			attackId: MODEL_IDS.Dreadnaught,
			hit: true,
			targetSize: "small",
			direction: "push",
			distance: 10,
		})).toMatchObject({
			ok: true,
			applied: true,
			type: "forcedMovement",
			attackId: MODEL_IDS.Dreadnaught,
			direction: "push",
			distance: 10,
		});
		expect(state.resolveEfaForceDemolisherHitRider({
			attackId: MODEL_IDS.Dreadnaught,
			hit: false,
			targetSize: "small",
			direction: "push",
		})).toMatchObject({ok: false, applied: false, reason: "miss"});
		expect(state.resolveEfaForceDemolisherHitRider({
			attackId: "renamed-force-demolisher",
			targetSize: "small",
			direction: "pull",
		})).toMatchObject({ok: false, applied: false, reason: "inactive-force-demolisher"});
		expect(state.resolveEfaForceDemolisherHitRider({
			attackId: MODEL_IDS.Dreadnaught,
			targetSize: "medium",
			direction: "push",
		})).toMatchObject({ok: false, applied: false, reason: "target-not-smaller"});

		state.setItemEquipped(armor.id, false);
		expect(state.resolveEfaForceDemolisherHitRider({
			attackId: MODEL_IDS.Dreadnaught,
			targetSize: "small",
			direction: "pull",
		})).toMatchObject({ok: false, applied: false, reason: "inactive-force-demolisher"});
	});

	it("commits Giant Stature atomically, tracks reach/size/duration, and preserves spent uses", async () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		state.setAbilityBase("int", 18);
		const resource = state.getResource("Giant Stature");
		expect(resource).toMatchObject({current: 4, max: 4, recharge: "long"});
		state.startCombat();

		const result = await state.invokeItemPower(
			armor.id,
			getModelPower(state, armor, "giant-stature").id,
			{efaArmorer: {hasRoom: true}},
		);
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			actionConsumed: true,
			remainingUses: 3,
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(state.isStateTypeActive("giantStature")).toBe(true);
		expect(state.getMeleeReach()).toBe(10);
		expect(state.getSize()).toBe("large");
		expect(state.getActiveStates().find(active => active.stateTypeId === "giantStature")).toMatchObject({roundsRemaining: 10});

		const staleAttempt = await state.activateEfaGiantStature();
		expect(staleAttempt).toMatchObject({ok: false, committed: false});
		expect(state.getResource("Giant Stature").current).toBe(3);

		state.recoverResources("short");
		expect(state.getResource("Giant Stature").current).toBe(3);
		state.recoverResources("long");
		expect(state.getResource("Giant Stature").current).toBe(4);

		state.setItemEquipped(armor.id, false);
		expect(state.isStateTypeActive("giantStature")).toBe(false);
		expect(state.getMeleeReach()).toBe(5);
		expect(state.getSize()).toBe("medium");
	});

	it("keeps Giant Stature reach when room prevents a size change and rejects stale action/model/binding gates without spending", async () => {
		const noRoom = buildState({model: "Dreadnaught"});
		noRoom.state.setSize("small");
		noRoom.state.startCombat();
		const noRoomResult = await noRoom.state.activateEfaGiantStature({hasRoom: false});
		expect(noRoomResult).toMatchObject({ok: true, committed: true});
		expect(noRoom.state.getSize()).toBe("small");
		expect(noRoom.state.getMeleeReach()).toBe(10);

		const usedAction = buildState({model: "Dreadnaught"}).state;
		usedAction.startCombat();
		usedAction.consumeActionType("bonus");
		const usedActionResource = usedAction.getResource("Giant Stature").current;
		expect(await usedAction.activateEfaGiantStature()).toMatchObject({ok: false, committed: false});
		expect(usedAction.getResource("Giant Stature").current).toBe(usedActionResource);

		const switched = buildState({model: "Dreadnaught"});
		const beforeSwitch = switched.state.getResource("Giant Stature").current;
		setCanonicalModel(switched.state, "Guardian");
		expect(await switched.state.activateEfaGiantStature()).toMatchObject({ok: false, committed: false});
		expect(switched.state.getResource("Giant Stature").current).toBe(beforeSwitch);

		const doffed = buildState({model: "Dreadnaught"});
		doffed.state.setItemEquipped(doffed.armor.id, false);
		const beforeDoff = doffed.state.getResource("Giant Stature").current;
		expect(await doffed.state.activateEfaGiantStature()).toMatchObject({ok: false, committed: false});
		expect(doffed.state.getResource("Giant Stature").current).toBe(beforeDoff);
	});

	it("round-trips Giant Stature safely and does not resurrect an invalid saved state", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		await state.activateEfaGiantStature();
		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.isStateTypeActive("giantStature")).toBe(true);
		expect(restored.getResource("Giant Stature")).toMatchObject({current: 0, max: 1});

		const invalidJson = copy(state.toJson());
		invalidJson.classes[0].subclass.source = "TCE";
		const invalid = new CharacterSheetState();
		expect(invalid.loadFromJson(invalidJson)).not.toBe(false);
		expect(invalid.isStateTypeActive("giantStature")).toBe(false);
		expect(invalid.getResource("Giant Stature")).toBeNull();
	});

	it("preserves spent Giant Stature uses when Intelligence changes the maximum", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		state.setAbilityBase("int", 18);
		expect(state.getResource("Giant Stature")).toMatchObject({current: 4, max: 4});
		expect(await state.activateEfaGiantStature()).toMatchObject({ok: true});
		state.deactivateState("giantStature");
		expect(await state.activateEfaGiantStature()).toMatchObject({ok: true});
		expect(state.getResource("Giant Stature")).toMatchObject({current: 2, max: 4});

		state.setAbilityBase("int", 20);
		expect(state.getResource("Giant Stature")).toMatchObject({current: 3, max: 5});
		state.setAbilityBase("int", 14);
		expect(state.getResource("Giant Stature")).toMatchObject({current: 0, max: 2});
		state.setAbilityBase("int", 20);
		expect(state.getResource("Giant Stature")).toMatchObject({current: 3, max: 5});
	});

	it("durably preserves total Giant Stature spend across a capped maximum and clears it only on Long Rest", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		state.setAbilityBase("int", 20);
		for (let i = 0; i < 4; ++i) {
			expect(await state.activateEfaGiantStature()).toMatchObject({ok: true});
			state.deactivateState("giantStature");
		}
		expect(state.getResource("Giant Stature")).toMatchObject({
			current: 1,
			max: 5,
			metadata: {efaGiantStature: {version: 1, spentUses: 4}},
		});

		state.setAbilityBase("int", 14);
		expect(state.getResource("Giant Stature")).toMatchObject({
			current: 0,
			max: 2,
			metadata: {efaGiantStature: {spentUses: 4}},
		});
		state.setAbilityBase("int", 20);
		expect(state.getResource("Giant Stature")).toMatchObject({current: 1, max: 5});

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.getResource("Giant Stature")).toMatchObject({
			current: 1,
			max: 5,
			metadata: {efaGiantStature: {spentUses: 4}},
		});
		restored.recoverResources("long");
		expect(restored.getResource("Giant Stature")).toMatchObject({
			current: 5,
			max: 5,
			metadata: {efaGiantStature: {spentUses: 0}},
		});
	});

	it("awaits the real Inventory invocation and commits the explicit insufficient-room choice", async () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		state.setSize("small");
		const inventory = makeInventoryConsumer(state);
		const prompt = jest.spyOn(InputUiUtil, "pGetUserEnum")
			.mockResolvedValue("Reach only — insufficient room");

		await expect(inventory._pInvokeItemPower(
			armor.id,
			getModelPower(state, armor, "giant-stature").id,
		)).resolves.toBe(true);

		expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
			title: "Giant Stature — Available Space",
		}));
		expect(state.isStateTypeActive("giantStature")).toBe(true);
		expect(state.getSize()).toBe("small");
		expect(state.getMeleeReach()).toBe(10);
		prompt.mockRestore();
	});

	it("keeps an unexpected post-commit Giant Stature follow-up failure committed", async () => {
		const {state} = buildState({model: "Dreadnaught"});
		state.startCombat();
		const resourceBefore = state.getResource("Giant Stature").current;
		const activation = jest.spyOn(state, "activateState").mockReturnValue(null);

		const result = await state.activateEfaGiantStature();

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			followUpFailed: true,
			reason: "stateActivationFailed",
			actionConsumed: true,
		});
		expect(state.getResource("Giant Stature").current).toBe(resourceBefore - 1);
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		activation.mockRestore();
	});

	it("renders a committed Giant Stature follow-up failure as warning feedback", async () => {
		const {state, armor} = buildState({model: "Dreadnaught"});
		state.startCombat();
		const inventory = makeInventoryConsumer(state);
		const prompt = jest.spyOn(InputUiUtil, "pGetUserEnum").mockResolvedValue("Become Large");
		const activation = jest.spyOn(state, "activateState").mockReturnValue(null);
		const toast = jest.spyOn(JqueryUtil, "doToast");
		const before = state.getResource("Giant Stature").current;

		const result = await inventory._pInvokeItemPower(
			armor.id,
			getModelPower(state, armor, "giant-stature").id,
			{returnResult: true},
		);

		expect(result).toMatchObject({ok: true, committed: true, followUpFailed: true});
		expect(state.getResource("Giant Stature").current).toBe(before - 1);
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			type: "warning",
			content: expect.stringContaining("follow-up failed"),
		}));
		prompt.mockRestore();
		activation.mockRestore();
		toast.mockRestore();
	});
});

describe("Guardian level-3 mechanics", () => {
	it("grants exact source-owned Defensive Field temp HP with no fake resource", () => {
		const {state} = buildState({model: "Guardian"});
		state.setHp(3, 10);
		state.startCombat();
		expect(state.getResource("Defensive Field")).toBeNull();

		const result = state.activateEfaDefensiveField();
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			actionConsumed: true,
			tempHp: 3,
		});
		expect(state.getTempHp()).toBe(3);
		expect(state.getTempHpOwner()).toEqual(CharacterSheetState.EFA_ARMORER_FEATURE_OWNERS.defensiveField);
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
	});

	it("does not spend Defensive Field's Bonus Action on failed gates and clears only its owned pool", () => {
		const healthy = buildState({model: "Guardian"}).state;
		healthy.setHp(10, 10);
		healthy.startCombat();
		expect(healthy.activateEfaDefensiveField()).toMatchObject({ok: false, committed: false});
		expect(healthy.isActionTypeAvailable("bonus")).toBe(true);

		const doffed = buildState({model: "Guardian"});
		doffed.state.setHp(3, 10);
		expect(doffed.state.activateEfaDefensiveField()).toMatchObject({ok: true});
		doffed.state.setItemEquipped(doffed.armor.id, false);
		expect(doffed.state.getTempHp()).toBe(0);

		const replaced = buildState({model: "Guardian"});
		replaced.state.setHp(3, 10);
		expect(replaced.state.activateEfaDefensiveField()).toMatchObject({ok: true});
		expect(replaced.state.grantOwnedTempHp(8, {
			id: "unrelated",
			kind: "spell",
			name: "Heroic Ward",
			source: "HB",
			uid: "Heroic Ward|HB",
		})).toBe(true);
		replaced.state.setItemEquipped(replaced.armor.id, false);
		expect(replaced.state.getTempHp()).toBe(8);
		expect(replaced.state.getTempHpOwner()).toMatchObject({id: "unrelated"});
	});

	it("persists and deterministically refreshes Thunder Pulse, then expires it at owner-turn start", () => {
		const {state} = buildState({model: "Guardian"});
		state.startCombat();
		const first = state.applyTargetEffect({
			source: "efa-armorer-thunder-pulse",
			effect: "attack-disadvantage-other-targets",
			riderId: "efa-armorer-thunder-pulse-disadvantage",
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-thunder-pulse",
				effect: "attack-disadvantage-other-targets",
				attackId: MODEL_IDS.Guardian,
			},
		});
		expect(first).toMatchObject({
			ok: true,
			applied: true,
			target: {
				id: "efa-armorer-thunder-pulse:ogre",
				source: "efa-armorer-thunder-pulse",
				attackId: MODEL_IDS.Guardian,
				model: "Guardian",
				attackDisadvantage: {against: "other-than-owner"},
				expiry: {type: "ownerTurnStart", combatRound: 2},
			},
		});
		expect(state.getTargetAttackDisadvantage(first.target.id, {defenderOwnerUid: "another-owner"})).toBe(true);
		expect(state.getTargetAttackDisadvantage(first.target.id, {
			defenderOwnerUid: CharacterSheetState.EFA_ARMORER_FEATURE_OWNERS.thunderPulse.uid,
		})).toBe(false);

		const refreshed = state.applyTargetEffect({
			source: "efa-armorer-thunder-pulse",
			effect: "attack-disadvantage-other-targets",
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-thunder-pulse",
				effect: "attack-disadvantage-other-targets",
				attackId: MODEL_IDS.Guardian,
			},
		});
		expect(refreshed.target.id).toBe(first.target.id);
		expect(state.getTargetEffects({source: "efa-armorer-thunder-pulse"})).toHaveLength(1);

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.getTargetEffect(first.target.id)).toMatchObject({
			owner: CharacterSheetState.EFA_ARMORER_FEATURE_OWNERS.thunderPulse,
			expiry: {type: "ownerTurnStart", combatRound: 2},
		});
		restored.advanceRound();
		expect(restored.getTargetEffect(first.target.id)).toBeNull();
	});

	it("applies no Thunder Pulse effect from a miss-equivalent inactive/source-loss path", () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.setItemEquipped(armor.id, false);
		expect(state.applyTargetEffect({
			source: "efa-armorer-thunder-pulse",
			effect: "attack-disadvantage-other-targets",
			targetName: "Ogre",
			targetEffect: {
				source: "efa-armorer-thunder-pulse",
				effect: "attack-disadvantage-other-targets",
				attackId: MODEL_IDS.Guardian,
			},
		})).toMatchObject({ok: false, reason: "inactive-thunder-pulse"});
		expect(state.getTargetEffects({source: "efa-armorer-thunder-pulse"})).toEqual([]);
	});
});
