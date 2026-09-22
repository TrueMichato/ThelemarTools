import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetArtificerPlans = globalThis.CharacterSheetArtificerPlans;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const ITEM_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/items.json"),
	"utf8",
));
const MAGIC_VARIANT_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/magicvariants.json"),
	"utf8",
));
const PLAN_ITEMS = [
	...ITEM_DATA.item,
	...MAGIC_VARIANT_DATA.magicvariant.map(variant => ({
		...variant,
		source: variant.source || variant.inherits?.source,
	})),
	{name: "+1 Shield", source: "XDMG"},
	{name: "Armor of Resistance", source: "XDMG"},
	{name: "+2 Shield", source: "XDMG"},
];

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(subclass =>
	subclass.name === "Reanimator"
	&& subclass.source === "RHW"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);

const COMPANION_OWNER_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const LEGACY_COMPANION_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3";
const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const REFINED_UID = "Refined Reanimation|Artificer|EFA|Reanimator|RHW|15|RHW";
const ARCANE_SOURCE_UID = "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW";
const ARCANE_ACTION_UID = "arcane-conduit:damage-rider";
const INVALID_EXPLICIT_NUMBERS = [null, "", "5", true, [], [5], {}];

const copy = value => JSON.parse(JSON.stringify(value));

function subclassSnapshot (source = "RHW") {
	return {
		name: REANIMATOR.name,
		shortName: REANIMATOR.shortName,
		source,
		casterProgression: REANIMATOR.casterProgression,
		spellcastingAbility: REANIMATOR.spellcastingAbility,
		additionalSpells: copy(REANIMATOR.additionalSpells || []),
	};
}

function makeState ({
	level = 3,
	intelligence = 18,
	classSource = "EFA",
	subclassSource = "RHW",
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		spellcastingAbility: "int",
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: level >= 3 ? subclassSnapshot(subclassSource) : null,
	});
	state.setSpellSlots(1, 4, 4);
	state.setSpellSlots(2, 3, 3);
	return state;
}

function addTool (state) {
	state.addItem({
		id: "reanimator-tool",
		name: "Tinker's Tools",
		source: "XPHB",
		type: "AT|XPHB",
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped("reanimator-tool", true);
	state.addToolProficiency("Tinker's Tools");
}

function getFocusReference (state) {
	return state.getSpellCastFocusReference(
		state.getInventory().find(row => row.id === "reanimator-tool"),
	);
}

function getSetupChoiceInput (state, selectedOptionIds) {
	const boundary = state.getFeatureCompanionCreationBoundary(COMPANION_OWNER_UID, {
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		payment: {type: "freeCreation"},
	});
	const transaction = boundary.setupChoices.transaction;
	return {
		transactionId: transaction.transactionId,
		selectedOptions: selectedOptionIds.map(id =>
			copy(transaction.options.find(option => option.id === id))),
	};
}

async function createCompanion (state, selectedOptionIds, {
	payment = {type: "freeCreation"},
} = {}) {
	if (!state.getInventory().some(row => row.id === "reanimator-tool")) addTool(state);
	const setupChoices = getSetupChoiceInput(state, selectedOptionIds);
	return state.pCreateFeatureCompanion({
		featureUid: COMPANION_OWNER_UID,
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		focusReference: getFocusReference(state),
		payment,
		setupChoices,
		appearance: "A stitched brass hound",
	});
}

function getTurnReceipts (state) {
	return Object.values(state.toJson().turnReceipts.receipts);
}

function getDeathBurstResolution (level, {
	targets = [
		{id: "failed", name: "Failed Save", distanceFeet: 5, dexSaveTotal: 4},
		{id: "passed", name: "Passed Save", distanceFeet: 10, dexSaveTotal: 30},
	],
} = {}) {
	return {
		targets,
		rolls: {damageDice: level >= 9 ? [1, 2, 3, 4] : [2, 3]},
	};
}

function getSpellReceipt ({
	classUid = CLASS_UID,
	school = "V",
	castType = "slot",
	rolls = [{
		rollId: "damage:0",
		kind: "damage",
		damageType: "necrotic",
		total: 7,
		status: "resolved",
	}],
} = {}) {
	return {
		receiptVersion: 1,
		receiptId: `spell-${Math.random()}`,
		ok: true,
		committed: true,
		castingClassUid: classUid,
		spellUid: "Blight|XPHB",
		spell: {name: "Blight", source: "XPHB", level: 4, school},
		castType,
		cast: {rolls},
	};
}

function useSwipe (state, companionId, {
	commandMethod = "bonusAction",
	attackD20 = 12,
	hitConfirmed = true,
	damageDice = [3],
	target = {name: "Ogre", size: "L"},
	rangeConfirmed = true,
	cancelled = false,
} = {}) {
	return state.commandCompanionAction({
		companionId,
		actionKey: "dreadfulSwipe",
		commandMethod,
		target,
		rangeConfirmed,
		hitConfirmed,
		cancelled,
		rolls: {attackD20, damageDice},
	});
}

function makeRespecPage (state) {
	return {
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => ARTIFICER_DATA.classFeature,
		getSubclassFeatures: () => ARTIFICER_DATA.subclassFeature,
		getOptionalFeatures: () => [],
		getItems: () => PLAN_ITEMS,
		filterByAllowedSources: values => values,
		getSpells: () => [],
		getFilteredSpellData: () => [],
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function resolveFixtureOnlyRespecDecisions (engine) {
	const used = new Set();
	while (true) {
		const decision = engine.manifest.decisions.find(it =>
			it.type === CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE
			&& it.required
			&& it.selection == null);
		if (!decision) break;
		const selection = decision.options.find(option => {
			const identity = CharacterSheetArtificerPlans.getSelectionIdentity(option);
			return identity && !used.has(identity);
		});
		if (!selection) throw new Error("No legal unique Artificer plan remained for the R4b Respec fixture.");
		used.add(CharacterSheetArtificerPlans.getSelectionIdentity(selection));
		engine.stageGraphMutation(decision.id, selection);
	}
	for (const decision of engine.manifest.decisions) decision.status = "resolved";
	expect(engine.getValidation().errors).toEqual([]);
}

describe("RHW Reanimator R4b command contract and Dreadful Swipe", () => {
	it.each([
		{level: 3, selected: []},
		{level: 5, selected: ["ferocity"]},
		{level: 9, selected: ["bloated", "gaunt"]},
		{level: 15, selected: ["arcaneConduit", "gaunt", "moist"]},
		{level: 20, selected: ["arcaneConduit", "bloated", "ferocity"]},
	])("projects executable runtime operations at exact EFA level $level", async ({level, selected}) => {
		const state = makeState({level});
		const created = await createCompanion(state, selected);
		expect(created).toMatchObject({ok: true, committed: true});
		expect(state.getFeatureCalculations().reanimatedCompanion).toMatchObject({
			runtimeImplemented: true,
			activeCompanion: {
				companionId: created.companionId,
				resolved: {
					operations: {
						command: {status: "executable"},
						dreadfulSwipe: {status: "executable"},
						deathBurst: {status: "executable"},
						lightningAbsorption: {status: "executable"},
					},
				},
			},
		});
	});

	it("defaults to Dodge, commands Swipe with a Bonus Action, and acts freely only while the exact summoner is incapacitated", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		const dodge = state.commandCompanionAction({
			companionId: created.companionId,
			actionKey: "dodge",
		});
		expect(dodge).toMatchObject({
			ok: true,
			commandMethod: "defaultDodge",
			costs: {ownerAction: null, companionAction: true},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);

		state.resetTurnEconomy();
		const swipe = useSwipe(state, created.companionId);
		expect(swipe).toMatchObject({
			ok: true,
			operation: "dreadfulSwipe",
			commandMethod: "bonusAction",
			costs: {ownerAction: "bonus", companionAction: true},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(false);

		state.resetTurnEconomy();
		jest.spyOn(state, "isIncapacitated").mockReturnValue(true);
		const autonomous = useSwipe(state, created.companionId, {commandMethod: null});
		expect(autonomous).toMatchObject({
			ok: true,
			commandMethod: "incapacitatedFree",
			costs: {ownerAction: null, companionAction: true},
		});
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
	});

	it("rejects attack replacement and every preflight failure byte-for-byte", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		for (const input of [
			{commandMethod: "replaceOneAttack"},
			{target: {name: "", size: "M"}},
			{rangeConfirmed: false},
			{attackD20: 21},
			{damageDice: [0]},
		]) {
			const before = JSON.stringify(state.toJson());
			const result = useSwipe(state, created.companionId, input);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(state.toJson())).toBe(before);
		}
		state.consumeActionType("bonus");
		const before = JSON.stringify(state.toJson());
		expect(useSwipe(state, created.companionId)).toMatchObject({
			ok: false,
			reason: "noCommandMethodAvailable",
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
	});

	it("keeps cancellation, inactive/dead/wrong-owner companions, and a late Bonus Action failure atomic", async () => {
		for (const {mutate, cancelled = false} of [
			{mutate: () => {}, cancelled: true},
			{mutate: companion => { companion.active = false; }},
			{mutate: companion => { companion.hp.current = 0; }},
			{mutate: companion => { companion.featureGrant.classSource = "TCE"; }},
		]) {
			const state = makeState({level: 3});
			const created = await createCompanion(state, []);
			mutate(state.getCompanion(created.companionId));
			const before = JSON.stringify(state.toJson());
			const result = useSwipe(state, created.companionId, {cancelled});
			expect(result.ok).toBe(false);
			expect(JSON.stringify(state.toJson())).toBe(before);
		}

		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		jest.spyOn(state, "consumeActionType").mockReturnValueOnce(false);
		const failed = useSwipe(state, created.companionId);
		expect(failed).toMatchObject({
			ok: false,
			reason: "transactionRolledBack",
			rollback: {
				companionReceipt: {ok: true, rolledBack: true},
			},
		});
		expect(getTurnReceipts(state)).toEqual([]);
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
	});

	it("executes hit, miss, critical, Ferocity, Bloated, and Improved Reanimation exactly", async () => {
		const baseState = makeState({level: 3, intelligence: 18});
		const base = await createCompanion(baseState, []);
		const hit = useSwipe(baseState, base.companionId, {damageDice: [4]});
		expect(hit).toMatchObject({
			operationUid: "Dreadful Swipe|Reanimated Companion|RHW",
			rolls: {
				attack: {bonus: 6, range: 5, type: "melee"},
				damage: {dieRolls: [4], flat: 4, total: 8, dice: "1d4", type: "necrotic", ignoresResistance: false},
			},
			riders: [{
				id: "preventOpportunityAttacks",
				applies: true,
				manualResolution: true,
			}],
		});

		baseState.resetTurnEconomy();
		const miss = useSwipe(baseState, base.companionId, {hitConfirmed: false, damageDice: []});
		expect(miss).toMatchObject({ok: true, rolls: {damage: null}, riders: []});

		baseState.resetTurnEconomy();
		const critical = useSwipe(baseState, base.companionId, {attackD20: 20, damageDice: [4, 3]});
		expect(critical.rolls.damage).toMatchObject({dieRolls: [4, 3], flat: 4, total: 11, dice: "2d4"});

		const modifiedState = makeState({level: 9, intelligence: 18});
		const modified = await createCompanion(modifiedState, ["ferocity", "bloated"]);
		const pushed = useSwipe(modifiedState, modified.companionId, {
			attackD20: 20,
			damageDice: [6, 5],
			target: {name: "Ogre", size: "large"},
		});
		expect(pushed.rolls.damage).toMatchObject({
			dieRolls: [6, 5],
			total: 15,
			dice: "2d6",
			ignoresResistance: true,
		});
		expect(pushed.riders).toContainEqual(expect.objectContaining({
			id: "bloatedPush",
			applies: true,
			eligible: true,
			targetSize: "large",
			maximumTargetSize: "large",
			distanceFeet: 10,
			manualResolution: true,
		}));

		modifiedState.resetTurnEconomy();
		const huge = useSwipe(modifiedState, modified.companionId, {
			damageDice: [5],
			target: {name: "Giant", size: "H"},
		});
		expect(huge.riders).toContainEqual(expect.objectContaining({
			id: "bloatedPush",
			applies: false,
			eligible: false,
			targetSize: "huge",
			manualResolution: false,
		}));
	});
});

describe("RHW Reanimator R4b Death Burst and damage entry", () => {
	it("persists one ordinary death event, validates before resolving, and never emits or resolves twice", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		const death = state.killFeatureOwnedCompanion(created.companionId, {
			featureUid: COMPANION_OWNER_UID,
		});
		expect(death).toMatchObject({
			ok: true,
			committed: true,
			deathBurst: {damage: {dice: "2d4", flat: 0, ignoresResistance: false}},
			receipt: {cause: "companionDeath"},
		});
		expect(state.killFeatureOwnedCompanion(created.companionId, {
			featureUid: COMPANION_OWNER_UID,
		})).toMatchObject({ok: true, committed: false, reason: "alreadyDead", deathBurst: null});

		const beforeInvalid = JSON.stringify(state.toJson());
		expect(state.resolveFeatureCompanionDeathBurst({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			...getDeathBurstResolution(3, {
				targets: [{id: "far", name: "Far Target", distanceFeet: 11, dexSaveTotal: 1}],
			}),
		})).toMatchObject({ok: false, committed: false, reason: "invalidTarget"});
		expect(state.resolveFeatureCompanionDeathBurst({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			...getDeathBurstResolution(3, {
				targets: [{id: "missing-range", name: "Missing Range", distanceFeet: null, dexSaveTotal: 1}],
			}),
		})).toMatchObject({ok: false, committed: false, reason: "invalidTarget"});
		expect(JSON.stringify(state.toJson())).toBe(beforeInvalid);

		const resolved = state.resolveFeatureCompanionDeathBurst({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			...getDeathBurstResolution(3),
		});
		expect(resolved).toMatchObject({
			ok: true,
			committed: true,
			result: {
				area: {shape: "emanation", radiusFeet: 10},
				save: {ability: "dex"},
				damage: {dieRolls: [2, 3], total: 5, type: "necrotic", ignoresResistance: false},
				targets: [
					{name: "Failed Save", saveSucceeded: false, damage: 5, manualApplication: true},
					{name: "Passed Save", saveSucceeded: true, damage: 2, manualApplication: true},
				],
			},
		});
		expect(state.resolveFeatureCompanionDeathBurst({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			...getDeathBurstResolution(3),
		})).toMatchObject({ok: true, committed: false, reason: "alreadyResolved"});
	});

	it("never bursts on early dismissal and resolves summoner death before removing the companion", async () => {
		const dismissedState = makeState({level: 3});
		const dismissed = await createCompanion(dismissedState, []);
		expect(await dismissedState.pDismissFeatureOwnedCompanion({
			featureUid: COMPANION_OWNER_UID,
			companionId: dismissed.companionId,
		})).toMatchObject({ok: true, committed: true, deathBurst: null});

		const deathState = makeState({level: 9});
		const created = await createCompanion(deathState, ["bloated", "gaunt"]);
		const beforeUnresolved = JSON.stringify(deathState.toJson());
		expect(deathState.handleFeatureCompanionSummonerDeath(COMPANION_OWNER_UID))
			.toMatchObject({
				ok: false,
				committed: false,
				reason: "deathBurstResolutionRequired",
				results: [{companionId: created.companionId, reason: "deathBurstResolutionRequired"}],
			});
		expect(JSON.stringify(deathState.toJson())).toBe(beforeUnresolved);

		expect(deathState.handleFeatureCompanionSummonerDeath(COMPANION_OWNER_UID, {
			deathBurstResolutions: {
				[created.companionId]: getDeathBurstResolution(9, {
					targets: [{id: "far", name: "Far", distanceFeet: 11, dexSaveTotal: 1}],
				}),
			},
		})).toMatchObject({
			ok: false,
			committed: false,
			reason: "invalidTarget",
			results: [{companionId: created.companionId, reason: "invalidTarget"}],
		});
		expect(JSON.stringify(deathState.toJson())).toBe(beforeUnresolved);

		const result = deathState.handleFeatureCompanionSummonerDeath(COMPANION_OWNER_UID, {
			deathBurstResolutions: {
				[created.companionId]: getDeathBurstResolution(9),
			},
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			results: [{
				removed: true,
				deathBurst: {damage: {dice: "4d4", flat: 4, ignoresResistance: true}},
				deathBurstResult: {
					damage: {dieRolls: [1, 2, 3, 4], total: 14, ignoresResistance: true},
				},
			}],
		});
		expect(deathState.getCompanion(created.companionId)).toBeNull();
	});

	it("resolves an explicit zero-target Death Burst while rejecting missing targets and invalid dice", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		expect(state.killFeatureOwnedCompanion(created.companionId, {
			featureUid: COMPANION_OWNER_UID,
		})).toMatchObject({ok: true, committed: true});

		for (const input of [
			{rolls: {damageDice: [1, 2]}},
			{targets: [], rolls: {damageDice: [1]}},
		]) {
			const before = JSON.stringify(state.toJson());
			expect(state.resolveFeatureCompanionDeathBurst({
				featureUid: COMPANION_OWNER_UID,
				companionId: created.companionId,
				...input,
			})).toMatchObject({
				ok: false,
				committed: false,
				reason: input.targets ? "invalidDamageRoll" : "targetsRequired",
			});
			expect(JSON.stringify(state.toJson())).toBe(before);
		}

		const resolved = state.resolveFeatureCompanionDeathBurst({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			targets: [],
			rolls: {damageDice: [1, 2]},
		});
		expect(resolved).toMatchObject({
			ok: true,
			committed: true,
			result: {
				damage: {dieRolls: [1, 2], total: 3},
				targets: [],
			},
		});
		expect(state.getCompanion(created.companionId)).toMatchObject({
			lifecycle: {
				deathBurstEmitted: true,
				deathBurstResolved: true,
				deathReceipt: {deathBurstResolution: {targets: []}},
			},
		});
	});

	it("absorbs Lightning into capped healing and routes other damage through temp HP into one death event", async () => {
		const state = makeState({level: 9});
		const created = await createCompanion(state, ["bloated", "moist"]);
		const companion = state.getCompanion(created.companionId);
		companion.hp.current = 20;
		companion.hp.temp = 3;

		const lightning = state.applyFeatureCompanionDamage({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			amount: 40,
			damageType: "Lightning",
		});
		expect(lightning).toMatchObject({
			ok: true,
			actualDamage: 0,
			immunityApplied: true,
			absorptionApplied: true,
			healing: {requested: 40, actual: 30},
			before: {current: 20, temp: 3, max: 50},
			after: {current: 50, temp: 3, max: 50},
		});

		const damaged = state.applyFeatureCompanionDamage({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			amount: 8,
			damageType: "fire",
		});
		expect(damaged).toMatchObject({
			ok: true,
			actualDamage: 8,
			damage: {tempAbsorbed: 3, hpLost: 5, droppedToZero: false},
			after: {current: 45, temp: 0},
			death: null,
		});

		const killed = state.applyFeatureCompanionDamage({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			amount: 45,
			damageType: "force",
			deathBurstResolution: getDeathBurstResolution(9),
		});
		expect(killed).toMatchObject({
			ok: true,
			damage: {droppedToZero: true},
			death: {
				committed: true,
				receipt: {cause: "damageToZero"},
				deathBurstResult: {damage: {total: 14}},
			},
		});
	});

	it("rejects malformed damage, wrong owners, inactive companions, and invalid burst input atomically", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		for (const input of [
			{featureUid: LEGACY_COMPANION_UID, amount: 1, damageType: "fire"},
			{featureUid: COMPANION_OWNER_UID, amount: -1, damageType: "fire"},
			{featureUid: COMPANION_OWNER_UID, amount: 1, damageType: "not-a-type"},
			{
				featureUid: COMPANION_OWNER_UID,
				amount: 999,
				damageType: "fire",
				deathBurstResolution: {rolls: {damageDice: [1, 1]}},
			},
		]) {
			const before = JSON.stringify(state.toJson());
			expect(state.applyFeatureCompanionDamage({
				companionId: created.companionId,
				...input,
			}).ok).toBe(false);
			expect(JSON.stringify(state.toJson())).toBe(before);
		}
		state.getCompanion(created.companionId).active = false;
		const before = JSON.stringify(state.toJson());
		expect(state.applyFeatureCompanionDamage({
			featureUid: COMPANION_OWNER_UID,
			companionId: created.companionId,
			amount: 1,
			damageType: "fire",
		})).toMatchObject({ok: false, reason: "companionInactive"});
		expect(JSON.stringify(state.toJson())).toBe(before);
	});

	it.each(INVALID_EXPLICIT_NUMBERS)(
		"rejects non-number companion damage amount %p atomically",
		async amount => {
			const state = makeState({level: 3});
			const created = await createCompanion(state, []);
			const before = JSON.stringify(state.toJson());

			expect(state.applyFeatureCompanionDamage({
				featureUid: COMPANION_OWNER_UID,
				companionId: created.companionId,
				amount,
				damageType: "fire",
			})).toMatchObject({ok: false, committed: false, reason: "invalidAmount"});
			expect(JSON.stringify(state.toJson())).toBe(before);
		},
	);
});

describe("RHW Reanimator R4b Gaunt, Moist, and Arcane Conduit", () => {
	it("resolves Gaunt without an invented receipt and returns Moist damage with no reaction cost", async () => {
		const state = makeState({level: 15, intelligence: 18});
		const created = await createCompanion(state, ["ferocity", "gaunt", "moist"]);
		const beforeReceipts = copy(state._data.turnReceipts);

		const failed = state.resolveRhwReanimatorGauntTrigger({
			companionId: created.companionId,
			target: {id: "orc", name: "Orc", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 10,
			wisdomSaveTotal: 3,
		});
		expect(failed).toMatchObject({
			ok: true,
			save: {ability: "wis", dc: 17, total: 3, succeeded: false},
			condition: {
				condition: "frightened",
				duration: "untilStartOfCreatureNextTurn",
				manualResolution: true,
			},
		});
		expect(state.resolveRhwReanimatorGauntTrigger({
			companionId: created.companionId,
			target: {id: "elf", name: "Elf", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 5,
			wisdomSaveTotal: 30,
		})).toMatchObject({ok: true, save: {succeeded: true}, condition: null});

		const moist = state.resolveRhwReanimatorMoistTrigger({
			companionId: created.companionId,
			attacker: {id: "wolf", name: "Wolf", isCreature: true},
			attackHit: true,
			rangeFeet: 10,
		});
		expect(moist).toMatchObject({
			ok: true,
			damage: {total: 4, flat: 4, type: "acid", manualApplication: true},
			costs: {companionReaction: false, turnReceipt: false},
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
		expect(state._data.turnReceipts).toEqual(beforeReceipts);
	});

	it("returns no Gaunt/Moist effect for invalid triggers, misses, range, wrong companion, or unselected modifications", async () => {
		const state = makeState({level: 9});
		const selected = await createCompanion(state, ["gaunt", "moist"]);
		const before = JSON.stringify(state.toJson());
		expect(state.resolveRhwReanimatorGauntTrigger({
			companionId: selected.companionId,
			target: {id: "far", name: "Far", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 11,
			wisdomSaveTotal: 1,
		})).toMatchObject({ok: false, reason: "targetOutOfRange"});
		expect(state.resolveRhwReanimatorGauntTrigger({
			companionId: selected.companionId,
			target: {id: "missing-save", name: "Missing Save", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 5,
			wisdomSaveTotal: null,
		})).toMatchObject({ok: false, reason: "invalidSave"});
		expect(state.resolveRhwReanimatorMoistTrigger({
			companionId: selected.companionId,
			attacker: {id: "miss", name: "Miss", isCreature: true},
			attackHit: false,
			rangeFeet: 5,
		})).toMatchObject({ok: true, reason: "attackMissed", damage: null});
		expect(state.resolveRhwReanimatorMoistTrigger({
			companionId: selected.companionId,
			attacker: {id: "missing-range", name: "Missing Range", isCreature: true},
			attackHit: true,
			rangeFeet: null,
		})).toMatchObject({ok: false, reason: "attackerOutOfRange", damage: null});
		expect(state.resolveRhwReanimatorMoistTrigger({
			companionId: "missing",
			attacker: {id: "wolf", name: "Wolf", isCreature: true},
			attackHit: true,
			rangeFeet: 5,
		})).toMatchObject({ok: false, reason: "companionNotFound", damage: null});
		expect(JSON.stringify(state.toJson())).toBe(before);

		const unselectedState = makeState({level: 9});
		const unselected = await createCompanion(unselectedState, ["arcaneConduit", "bloated"]);
		expect(unselectedState.resolveRhwReanimatorGauntTrigger({
			companionId: unselected.companionId,
			target: {id: "orc", name: "Orc", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 5,
			wisdomSaveTotal: 1,
		})).toMatchObject({ok: false, reason: "modificationUnavailable"});
	});

	it.each(INVALID_EXPLICIT_NUMBERS)(
		"rejects non-number range/save input %p across triggered and Arcane operations",
		async invalidNumber => {
			const state = makeState({level: 15});
			const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
			const before = JSON.stringify(state.toJson());
			const target = {id: "target", name: "Target", chosen: true, startedTurn: true, isCreature: true};

			expect(state.resolveRhwReanimatorGauntTrigger({
				companionId: created.companionId,
				target,
				rangeFeet: invalidNumber,
				wisdomSaveTotal: 10,
			})).toMatchObject({ok: false, committed: false, reason: "targetOutOfRange"});
			expect(state.resolveRhwReanimatorGauntTrigger({
				companionId: created.companionId,
				target,
				rangeFeet: 5,
				wisdomSaveTotal: invalidNumber,
			})).toMatchObject({ok: false, committed: false, reason: "invalidSave"});
			expect(state.resolveRhwReanimatorMoistTrigger({
				companionId: created.companionId,
				attacker: {id: "attacker", name: "Attacker", isCreature: true},
				attackHit: true,
				rangeFeet: invalidNumber,
			})).toMatchObject({ok: false, committed: false, reason: "attackerOutOfRange"});
			expect(state.applyRhwArcaneConduitDamageRider({
				companionId: created.companionId,
				spellCastReceipt: getSpellReceipt(),
				selectedRollId: "damage:0",
				companionDistanceFeet: invalidNumber,
			})).toMatchObject({ok: false, committed: false, reason: "companionOutOfRange"});
			expect(JSON.stringify(state.toJson())).toBe(before);

			const deathState = makeState({level: 3});
			const dead = await createCompanion(deathState, []);
			expect(deathState.killFeatureOwnedCompanion(dead.companionId, {
				featureUid: COMPANION_OWNER_UID,
			})).toMatchObject({ok: true, committed: true});
			const beforeDeathResolution = JSON.stringify(deathState.toJson());
			for (const targets of [
				[{id: "target", name: "Target", distanceFeet: invalidNumber, dexSaveTotal: 10}],
				[{id: "target", name: "Target", distanceFeet: 5, dexSaveTotal: invalidNumber}],
			]) {
				expect(deathState.resolveFeatureCompanionDeathBurst({
					featureUid: COMPANION_OWNER_UID,
					companionId: dead.companionId,
					targets,
					rolls: {damageDice: [1, 2]},
				})).toMatchObject({ok: false, committed: false, reason: "invalidTarget"});
				expect(JSON.stringify(deathState.toJson())).toBe(beforeDeathResolution);
			}
		},
	);

	it("projects the alternate origin and applies one exact EFA damage-roll bonus per turn", async () => {
		const state = makeState({level: 5, intelligence: 18});
		const created = await createCompanion(state, ["arcaneConduit"]);
		expect(state.getRhwArcaneConduitSpellOriginOptions(created.companionId)).toEqual({
			available: true,
			reason: null,
			companionId: created.companionId,
			usesSummonerSenses: true,
			options: [
				{id: "summoner", origin: "summonerSpace", senses: "summoner"},
				{id: "companion", origin: "companionSpace", companionId: created.companionId, senses: "summoner"},
			],
		});

		const spell = getSpellReceipt({
			rolls: [
				{rollId: "damage:0", kind: "damage", damageType: "necrotic", total: 7, status: "resolved"},
				{rollId: "damage:1", kind: "damage", damageType: "fire", total: 5, status: "resolved"},
			],
		});
		const result = state.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: spell,
			selectedRollId: "damage:1",
			companionDistanceFeet: 120,
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			ownerUid: COMPANION_OWNER_UID,
			sourceUid: ARCANE_SOURCE_UID,
			actionUid: ARCANE_ACTION_UID,
			application: {rollId: "damage:1", before: 5, bonus: 4, after: 9},
		});
		expect(spell.cast.rolls).toEqual([
			expect.objectContaining({rollId: "damage:0", total: 7}),
			expect.objectContaining({
				rollId: "damage:1",
				total: 9,
				arcaneConduit: expect.objectContaining({bonus: 4}),
			}),
		]);

		const duplicateSpell = getSpellReceipt({school: "N"});
		expect(state.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: duplicateSpell,
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		})).toMatchObject({ok: false, committed: false, reason: "alreadyUsed"});
		expect(duplicateSpell.cast.rolls[0].total).toBe(7);
	});

	it.each([
		{
			name: "cancelled",
			selected: ["arcaneConduit"],
			overrides: {cancelled: true},
			reason: "cancelled",
		},
		{
			name: "out of range",
			selected: ["arcaneConduit"],
			overrides: {companionDistanceFeet: 121},
			reason: "companionOutOfRange",
		},
		{
			name: "missing range",
			selected: ["arcaneConduit"],
			overrides: {companionDistanceFeet: null},
			reason: "companionOutOfRange",
		},
		{
			name: "TCE class",
			selected: ["arcaneConduit"],
			receipt: {classUid: "Artificer|TCE"},
			reason: "invalidSpellSource",
		},
		{
			name: "item cast",
			selected: ["arcaneConduit"],
			receipt: {castType: "item"},
			reason: "invalidSpellSource",
		},
		{
			name: "wrong school",
			selected: ["arcaneConduit"],
			receipt: {school: "A"},
			reason: "invalidSpellSchool",
		},
		{
			name: "no damage",
			selected: ["arcaneConduit"],
			receipt: {rolls: []},
			reason: "spellDealtNoDamage",
		},
		{
			name: "wrong selected roll",
			selected: ["arcaneConduit"],
			overrides: {selectedRollId: "damage:missing"},
			reason: "invalidDamageRollSelection",
		},
		{
			name: "unselected modification",
			selected: ["ferocity"],
			reason: "modificationUnavailable",
		},
	])("rejects Arcane Conduit gate: $name without state mutation", async ({
		selected,
		receipt = {},
		overrides = {},
		reason,
	}) => {
		const state = makeState({level: 5});
		const created = await createCompanion(state, selected);
		const spell = getSpellReceipt(receipt);
		const before = JSON.stringify(state.toJson());
		const rollBefore = copy(spell.cast.rolls);
		expect(state.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: spell,
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
			...overrides,
		})).toMatchObject({ok: false, committed: false, reason});
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(spell.cast.rolls).toEqual(rollBefore);
	});

	it("keeps Arcane use across combatRound and save/load, resets only at the turn boundary, and rolls back a late failure", async () => {
		const state = makeState({level: 5});
		const created = await createCompanion(state, ["arcaneConduit"]);
		const spell = getSpellReceipt();
		expect(state.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: spell,
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		}).ok).toBe(true);
		state._data.combatRound = 999;

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(loaded.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: getSpellReceipt(),
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		})).toMatchObject({ok: false, reason: "alreadyUsed"});
		loaded.resetTurnEconomy();
		expect(loaded.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: getSpellReceipt(),
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		}).ok).toBe(true);

		loaded.resetTurnEconomy();
		const failedSpell = getSpellReceipt();
		const failedBefore = copy(failedSpell);
		jest.spyOn(loaded, "_applyRhwArcaneConduitDamageRoll").mockReturnValueOnce(null);
		const failed = loaded.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: failedSpell,
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		});
		expect(failed).toMatchObject({
			ok: false,
			reason: "transactionRolledBack",
			rollback: {ok: true, rolledBack: true},
		});
		expect(failedSpell).toEqual(failedBefore);
		expect(getTurnReceipts(loaded)).toEqual([]);
	});

	it("uses a distinct replacement-generation key and prunes only the exact Arcane receipt on source loss", async () => {
		const state = makeState({level: 5});
		const first = await createCompanion(state, ["arcaneConduit"]);
		const firstUse = state.applyRhwArcaneConduitDamageRider({
			companionId: first.companionId,
			spellCastReceipt: getSpellReceipt(),
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		});
		expect(firstUse.ok).toBe(true);
		const firstKey = firstUse.key;

		state.killFeatureOwnedCompanion(first.companionId, {featureUid: COMPANION_OWNER_UID});
		const second = await createCompanion(state, ["arcaneConduit"], {
			payment: {type: "spellSlot", pool: "spell", slotLevel: 1},
		});
		const secondRule = state.getCompanion(second.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt;
		expect(secondRule.generation).toBe(2);
		expect(secondRule.key).not.toBe(firstKey);
		expect(state.queryTurnReceipt(firstKey).used).toBe(false);

		expect(state.applyRhwArcaneConduitDamageRider({
			companionId: second.companionId,
			spellCastReceipt: getSpellReceipt(),
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		}).ok).toBe(true);
		state.commitTurnReceipt({
			key: "foreign-battle-smith",
			ownerUid: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA",
			sourceUid: "Steel Defender|EFA",
			actionUid: ARCANE_ACTION_UID,
		});
		state.commitTurnReceipt({
			key: "malformed-rhw-collision",
			ownerUid: COMPANION_OWNER_UID,
			sourceUid: ARCANE_SOURCE_UID,
			actionUid: ARCANE_ACTION_UID,
			metadata: {companionId: "foreign"},
		});

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(second.companionId)).toBeNull();
		expect(getTurnReceipts(state)).toEqual(expect.arrayContaining([
			expect.objectContaining({key: "foreign-battle-smith"}),
			expect.objectContaining({key: "malformed-rhw-collision"}),
		]));
		expect(getTurnReceipts(state).some(receipt => receipt.key === secondRule.key)).toBe(false);
	});
});

describe("RHW Reanimator R4b Life Transfer, persistence, and Respec", () => {
	it.each(["summoner", "companion"])("uses the summoner Reaction after confirmed %s damage and kills/bursts once", async target => {
		const state = makeState({level: 15, intelligence: 18});
		const created = await createCompanion(state, ["bloated", "gaunt", "moist"]);
		state._data.hp.current = 10;
		state._data.hp.max = 40;
		state.getCompanion(created.companionId).hp.current = 12;
		state.startCombat();
		const result = state.performRhwLifeTransfer({
			featureUid: REFINED_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			companionId: created.companionId,
			trigger: {
				eventId: `${target}-damage`,
				target,
				companionId: target === "companion" ? created.companionId : null,
				damageAmount: 5,
				confirmed: true,
			},
			deathBurstResolution: getDeathBurstResolution(15),
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			reaction: {ok: true, actionType: "reaction", tracked: true},
			healing: {before: 10, requested: 12, actual: 12, after: 22},
			death: {
				committed: true,
				receipt: {cause: "lifeTransfer"},
				deathBurstResult: {damage: {total: 14}},
			},
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
	});

	it("executes at full HP, never leaves an out-of-combat reaction lock, and uses post-damage companion HP", async () => {
		const state = makeState({level: 15});
		const created = await createCompanion(state, ["arcaneConduit", "ferocity", "gaunt"]);
		state._data.hp.current = state._data.hp.max = 20;
		state.getCompanion(created.companionId).hp.current = 9;
		const result = state.performRhwLifeTransfer({
			featureUid: REFINED_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			companionId: created.companionId,
			trigger: {
				eventId: "post-damage",
				target: "companion",
				companionId: created.companionId,
				damageAmount: 7,
				confirmed: true,
			},
		});
		expect(result).toMatchObject({
			ok: true,
			healing: {requested: 9, actual: 0, before: 20, after: 20},
			reaction: {tracked: false},
		});
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
	});

	it("keeps cancellation, invalid identities/triggers, unavailable reaction, and source loss byte-stable", async () => {
		const state = makeState({level: 15});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		const valid = {
			featureUid: REFINED_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			companionId: created.companionId,
			trigger: {
				eventId: "damage",
				target: "summoner",
				damageAmount: 1,
				confirmed: true,
			},
		};
		for (const overrides of [
			{cancelled: true},
			{featureUid: `${REFINED_UID}|RHW`},
			{classUid: "Artificer|TCE"},
			{subclassUid: "Reanimator|Artificer|EFA|TST"},
			{trigger: {...valid.trigger, confirmed: false}},
		]) {
			const before = JSON.stringify(state.toJson());
			expect(state.performRhwLifeTransfer({...valid, ...overrides}).ok).toBe(false);
			expect(JSON.stringify(state.toJson())).toBe(before);
		}

		state.startCombat();
		state.consumeActionType("reaction");
		const beforeReaction = JSON.stringify(state.toJson());
		expect(state.performRhwLifeTransfer(valid)).toMatchObject({
			ok: false,
			reason: "reactionUnavailable",
		});
		expect(JSON.stringify(state.toJson())).toBe(beforeReaction);

		state.resetTurnEconomy();
		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();
		const beforeLoss = JSON.stringify(state.toJson());
		expect(state.performRhwLifeTransfer(valid)).toMatchObject({
			ok: false,
			reason: "featureUnavailable",
		});
		expect(JSON.stringify(state.toJson())).toBe(beforeLoss);
	});

	it.each(INVALID_EXPLICIT_NUMBERS)(
		"rejects non-number Life Transfer damage input %p atomically",
		async damageAmount => {
			const state = makeState({level: 15});
			const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
			const before = JSON.stringify(state.toJson());

			expect(state.performRhwLifeTransfer({
				featureUid: REFINED_UID,
				classUid: CLASS_UID,
				subclassUid: SUBCLASS_UID,
				companionId: created.companionId,
				trigger: {
					eventId: "damage",
					target: "summoner",
					damageAmount,
					confirmed: true,
				},
			})).toMatchObject({ok: false, committed: false, reason: "invalidTrigger"});
			expect(JSON.stringify(state.toJson())).toBe(before);
		},
	);

	it("rolls summoner HP, Reaction, companion lifecycle, and Death Burst back after a late kill failure", async () => {
		const state = makeState({level: 15});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		state._data.hp.current = 5;
		state.startCombat();
		const before = copy(state.toJson());
		jest.spyOn(state, "killFeatureOwnedCompanion").mockReturnValueOnce({
			ok: false,
			committed: false,
			reason: "injectedKillFailure",
		});
		const result = state.performRhwLifeTransfer({
			featureUid: REFINED_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			companionId: created.companionId,
			trigger: {
				eventId: "damage",
				target: "summoner",
				damageAmount: 3,
				confirmed: true,
			},
		});
		expect(result).toMatchObject({
			ok: false,
			committed: false,
			reason: "transactionRolledBack",
			rollback: {summonerHp: true, reaction: true, companion: true},
		});
		expect(state.toJson()).toEqual(before);
	});

	it("round-trips active runtime receipts and Respec Apply/Undo prunes then restores only exact RHW state", async () => {
		const state = makeState({level: 15});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		expect(state.applyRhwArcaneConduitDamageRider({
			companionId: created.companionId,
			spellCastReceipt: getSpellReceipt(),
			selectedRollId: "damage:0",
			companionDistanceFeet: 5,
		}).ok).toBe(true);
		expect(state.loadFromJson(copy(state.toJson()))).not.toBe(false);
		const collisionId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			creatureName: "Reanimated Companion",
			creatureSource: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			active: true,
			featureGrant: {
				type: "subclassFeature",
				uid: LEGACY_COMPANION_UID,
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Reanimator",
				subclassSource: "RHW",
				level: 3,
			},
			hp: {max: 20, current: 20, temp: 0},
			lifecycle: {status: "active", generation: 99},
		});
		const before = JSON.stringify(state.toJson());
		const collisionBefore = JSON.stringify(state.getCompanion(collisionId));
		const page = makeRespecPage(state);
		const engine = new CharacterSheetRespecEngine({page, state});

		engine.begin();
		engine.state.getClasses()[0].subclass = null;
		engine.state.applyClassFeatureEffects();
		expect(engine.state.getCompanion(created.companionId)).toBeNull();
		expect(JSON.stringify(engine.state.getCompanion(collisionId))).toBe(collisionBefore);
		expect(getTurnReceipts(engine.state)).toEqual([]);
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).resolves.toBe(true);
		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(JSON.stringify(state.getCompanion(collisionId))).toBe(collisionBefore);

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(state.toJson())).toBe(before);
	});
});
