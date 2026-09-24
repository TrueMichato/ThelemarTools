import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const objectData = JSON.parse(fs.readFileSync("data/objects.json", "utf8")).object;
const EFA_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === "EFA"
	&& it.classSource === "EFA",
);
const TCE_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === "TCE"
	&& it.classSource === "TCE",
);

const makeState = ({
	source = "EFA",
	level = 3,
	intelligence = 16,
	spellSlots = [{level: 1, current: 2, max: 2}],
} = {}) => {
	const subclass = source === "EFA" ? EFA_ARTILLERIST : TCE_ARTILLERIST;
	const state = new CharacterSheetState();
	state.setClassSummonTemplateCatalog(objectData);
	state.setAbilityBase("int", intelligence);
	state.addClass({
		name: "Artificer",
		source,
		level,
		hd: {number: 1, faces: 8},
		subclass: {
			name: subclass.name,
			shortName: subclass.shortName,
			source: subclass.source,
		},
	});
	state.setSpellSlots(spellSlots);
	if (source === "EFA") {
		state.addItem({id: "efa-cannon-tool", name: "Smith's Tools", source: "PHB", type: "AT", _isCustom: true}, 1, true);
		state.addToolProficiency("Smith's Tools");
	}
	return state;
};

const createRequest = (overrides = {}) => ({
	form: "forceBallista",
	size: "S",
	placement: "deployed",
	mobility: "wheels",
	distanceFromOwnerFt: 5,
	createdWith: "freeUse",
	createdWithSlotLevel: null,
	...overrides,
});

const getCreationResource = state => state.toJson().resources.find(resource =>
	resource.featureUid === CharacterSheetState.EFA_ELDRITCH_CANNON_FEATURE_UID,
);

const getCannonTransactionState = state => {
	const json = state.toJson();
	return {
		actionEconomyUsage: json.actionEconomyUsage,
		spellSlots: json.spellcasting.spellSlots,
		pactSlots: json.spellcasting.pactSlots,
		creationResource: json.resources.find(resource =>
			resource.featureUid === CharacterSheetState.EFA_ELDRITCH_CANNON_FEATURE_UID,
		),
		generatedClassSummonRevisions: json.generatedClassSummonRevisions,
		companions: json.companions,
	};
};

describe("EFA Artillerist Milestone 3 cannon creation", () => {
	test("validates the complete request before spending its Magic Action or free use", async () => {
		const state = makeState();
		state.startCombat();

		const invalid = await state.pCreateEfaEldritchCannon(createRequest({
			form: "invalid",
			distanceFromOwnerFt: 6,
		}));
		expect(invalid).toMatchObject({ok: false, committed: false, reason: "invalidState"});
		expect(state.getActionEconomyState()).toEqual({action: true, bonus: true, reaction: true});
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
		expect(state.listEfaEldritchCannons()).toEqual([]);

		const cancelled = await state.pCreateEfaEldritchCannon({...createRequest(), cancelled: true});
		expect(cancelled).toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(state.getActionEconomyState().action).toBe(true);
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
	});

	test("atomically creates with the free use and rolls back action, resource, revision, and summon on save failure", async () => {
		const state = makeState();
		state.startCombat();

		const failed = await state.pCreateEfaEldritchCannon({
			...createRequest(),
			pCommit: async () => false,
		});
		expect(failed).toMatchObject({ok: false, committed: false, reason: "saveFailed"});
		expect(state.getActionEconomyState().action).toBe(true);
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
		expect(state.listEfaEldritchCannons()).toEqual([]);
		expect(state.toJson().generatedClassSummonRevisions).toEqual({});

		const created = await state.pCreateEfaEldritchCannon({
			...createRequest(),
			pCommit: async () => true,
		});
		expect(created).toMatchObject({
			ok: true,
			committed: true,
			payment: {type: "freeUse"},
			action: {type: "action", subtype: "Magic action", spent: true},
			freeUseRemaining: 0,
			summon: {
				form: "forceBallista",
				placement: "deployed",
				hp: {current: 15, max: 15},
				durationRemainingMinutes: 60,
				createdWith: "freeUse",
				createdWithSlotLevel: null,
			},
		});
		expect(state.getActionEconomyState().action).toBe(false);
		expect(state.toJson().companions[0]).not.toHaveProperty("calculations");
	});

	test("spends the explicitly selected normal or pact slot and persists only the required payment metadata", async () => {
		const state = makeState();
		const normal = await state.pCreateEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
			createdWithSlotKind: "spell",
		}));
		expect(normal).toMatchObject({
			ok: true,
			payment: {type: "spellSlot", level: 1, kind: "spell"},
			action: {spent: false},
		});
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
		expect(state.toJson().companions[0]).toMatchObject({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
			createdWithSlotKind: "spell",
		});

		state.dismissEfaEldritchCannon(normal.instanceId);
		state.setPactSlots({current: 1, max: 1, level: 2});
		const pact = await state.pCreateEfaEldritchCannon(createRequest({
			form: "protector",
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 0,
			createdWith: "spellSlot",
			createdWithSlotLevel: 2,
			createdWithSlotKind: "pact",
		}));
		expect(pact).toMatchObject({
			ok: true,
			payment: {type: "spellSlot", level: 2, kind: "pact"},
			summon: {
				form: "protector",
				createdWith: "spellSlot",
				createdWithSlotLevel: 2,
				createdWithSlotKind: "pact",
			},
		});
		expect(state.getPactSlots().current).toBe(0);
	});

	test("expires the cannon on either rest and restores the free creation use only on a Long Rest", async () => {
		const state = makeState();
		const created = await state.pCreateEfaEldritchCannon(createRequest());
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(0);

		state.onShortRest();
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(0);
		expect(state.getEfaEldritchCannon(created.instanceId)).toBeNull();

		state.onLongRest();
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
		expect(state.getEfaEldritchCannon(created.instanceId)).toBeNull();
	});

	test("migrates a resource-less M2 free-use cannon save as spent until Long Rest", async () => {
		const legacy = makeState();
		const created = legacy.createEfaEldritchCannon(createRequest());
		const legacySave = legacy.toJson();
		legacySave.resources = [];

		const catalogDeferred = new CharacterSheetState();
		catalogDeferred.loadFromJson(legacySave);
		expect(getCreationResource(catalogDeferred)).toMatchObject({current: 0});

		const loaded = makeState();
		loaded.loadFromJson(legacySave);
		const migratedResource = getCreationResource(loaded);
		expect(migratedResource).toMatchObject({
			current: 0,
			max: 1,
			recharge: "long",
			featureUid: CharacterSheetState.EFA_ELDRITCH_CANNON_FEATURE_UID,
			classUid: CharacterSheetState.EFA_ARTIFICER_CLASS_UID,
			subclassUid: CharacterSheetState.EFA_ARTILLERIST_SUBCLASS_UID,
		});
		expect(loaded.getEfaEldritchCannonCreationState().freeUse.current).toBe(0);

		const roundTrip = makeState();
		roundTrip.loadFromJson(loaded.toJson());
		expect(getCreationResource(roundTrip)).toEqual(migratedResource);
		expect(roundTrip.dismissEfaEldritchCannon(created.instanceId).ok).toBe(true);
		expect(await roundTrip.pCreateEfaEldritchCannon(createRequest())).toMatchObject({
			ok: false,
			committed: false,
			reason: "freeUseUnavailable",
		});

		roundTrip.onLongRest();
		expect(roundTrip.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
		const afterRestRoundTrip = makeState();
		afterRestRoundTrip.loadFromJson(roundTrip.toJson());
		expect(afterRestRoundTrip.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
	});

	test("keeps a resource-less M2 slot-funded cannon's free use available", () => {
		const legacy = makeState();
		legacy.createEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		}));
		const legacySave = legacy.toJson();
		legacySave.resources = [];

		const loaded = makeState();
		loaded.loadFromJson(legacySave);
		expect(getCreationResource(loaded)).toMatchObject({current: 1, max: 1, recharge: "long"});
		expect(loaded.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
	});

	test.each([
		["malformed", record => { record.form = "invalid"; }],
		["retired", record => { record.durationRemainingMinutes = 0; }],
	])("does not infer a spent free use from a %s legacy cannon record", (label, mutateRecord) => {
		const legacy = makeState();
		legacy.createEfaEldritchCannon(createRequest());
		const legacySave = legacy.toJson();
		legacySave.resources = [];
		mutateRecord(legacySave.companions[0]);

		const loaded = makeState();
		loaded.loadFromJson(legacySave);
		expect(loaded.listEfaEldritchCannons()).toEqual([]);
		expect(getCreationResource(loaded)).toMatchObject({current: 1});
	});

	test.each([
		["TCE", save => {
			save.classes = makeState({source: "TCE"}).toJson().classes;
		}],
		["missing owner", save => {
			save.classes = [];
		}],
	])("does not create an EFA resource for a %s legacy save", (label, mutateSave) => {
		const legacy = makeState();
		legacy.createEfaEldritchCannon(createRequest());
		const legacySave = legacy.toJson();
		legacySave.resources = [];
		mutateSave(legacySave);

		const loaded = makeState();
		loaded.loadFromJson(legacySave);
		expect(loaded.listEfaEldritchCannons()).toEqual([]);
		expect(getCreationResource(loaded)).toBeUndefined();
		expect(loaded.getEfaEldritchCannonCreationState()).toMatchObject({available: false});
	});

	test.each([
		["available", 1, "freeUse"],
		["spent", 0, "spellSlot"],
	])("keeps an existing explicit %s creation resource authoritative", (label, current, createdWith) => {
		const source = makeState();
		const resourceId = source.getEfaEldritchCannonCreationState().freeUse.resourceId;
		source.setResourceCurrent(resourceId, current);
		source.createEfaEldritchCannon(createRequest({
			createdWith,
			createdWithSlotLevel: createdWith === "spellSlot" ? 1 : null,
		}));

		const loaded = makeState();
		loaded.loadFromJson(source.toJson());
		expect(getCreationResource(loaded).current).toBe(current);
		expect(loaded.getEfaEldritchCannonCreationState().freeUse.current).toBe(current);
	});

	test("retains the level-3 single-cannon cap, fills the free level-15 slot, and isolates creation from TCE", async () => {
		const state = makeState();
		await state.pCreateEfaEldritchCannon(createRequest());
		const before = state.toJson();
		expect(await state.pCreateEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		}))).toMatchObject({ok: false, committed: false, reason: "slotOccupied"});
		expect(state.toJson()).toEqual(before);

		const reservedSlotOnly = makeState({level: 15});
		const reserved = reservedSlotOnly.createEfaEldritchCannon(createRequest());
		reservedSlotOnly._data.companions[0].generatedClassSummon.generatedSlot = 1;
		expect(await reservedSlotOnly.pCreateEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		}))).toMatchObject({ok: true, committed: true});
		expect(reservedSlotOnly.listEfaEldritchCannons().map(cannon => cannon.generatedClassSummon.generatedSlot)).toEqual([0, 1]);
		expect(reserved.ok).toBe(true);

		const tce = makeState({source: "TCE"});
		expect(tce.getEfaEldritchCannonCreationState()).toMatchObject({
			available: false,
			canCreate: false,
			reason: "sourceMismatch",
		});
		expect(tce.getResources().some(it => it.featureUid === CharacterSheetState.EFA_ELDRITCH_CANNON_FEATURE_UID)).toBe(false);
		expect(await tce.pCreateEfaEldritchCannon(createRequest())).toMatchObject({
			ok: false,
			committed: false,
			reason: "sourceMismatch",
		});
	});

	test.each([
		["normal spell", {
			setup: state => state.setPactSlots({current: 1, max: 1, level: 2}),
			request: {createdWithSlotLevel: 1, createdWithSlotKind: "spell"},
			assertSpent: state => {
				expect(state.getSpellSlotsCurrent(1)).toBe(1);
				expect(state.getPactSlots().current).toBe(1);
			},
		}],
		["Pact", {
			setup: state => state.setPactSlots({current: 1, max: 1, level: 2}),
			request: {createdWithSlotLevel: 2, createdWithSlotKind: "pact"},
			assertSpent: state => {
				expect(state.getSpellSlotsCurrent(1)).toBe(2);
				expect(state.getPactSlots().current).toBe(0);
			},
		}],
	])("rolls back a failed %s slot-funded production commit and executes rollback persistence", async (label, {setup, request, assertSpent}) => {
		const state = makeState();
		setup(state);
		state.getEfaEldritchCannonCreationState();
		state.startCombat();
		const before = getCannonTransactionState(state);
		const pCommit = jest.fn(async () => {
			expect(state.getActionEconomyState().action).toBe(false);
			assertSpent(state);
			expect(state.listEfaEldritchCannons()).toHaveLength(1);
			expect(Object.keys(state.toJson().generatedClassSummonRevisions)).toHaveLength(1);
			expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(1);
			return false;
		});
		const pRollback = jest.fn(async () => {
			expect(getCannonTransactionState(state)).toEqual(before);
			return false;
		});

		const failed = await state.pCreateEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			...request,
			pCommit,
			pRollback,
		}));

		expect(failed).toMatchObject({
			ok: false,
			committed: false,
			reason: "saveFailed",
			rollbackSaveAttempted: true,
			rollbackSaved: false,
		});
		expect(pCommit).toHaveBeenCalledTimes(1);
		expect(pRollback).toHaveBeenCalledTimes(1);
		expect(getCannonTransactionState(state)).toEqual(before);
	});
});

describe("EFA Artillerist Milestone 3 cannon operation", () => {
	test("tracks activation Bonus Actions only in combat and enforces owner/target ranges", async () => {
		const state = makeState({level: 9, intelligence: 18});
		const {instanceId} = await state.pCreateEfaEldritchCannon(createRequest());

		const outsideCombat = state.activateEfaEldritchCannon({
			instanceId,
			targetName: "Ogre",
			targetDistanceFromCannonFt: 120,
			attackRoll: 12,
			effectRoll: 14,
		});
		expect(outsideCombat).toMatchObject({
			ok: true,
			action: {type: "bonus", spent: false},
			result: {
				kind: "spellAttack",
				attack: {natural: 12, bonus: 8, total: 20},
				damage: 14,
				damageDice: "3d8",
				damageType: "force",
				rangeFt: 120,
				pushFt: 5,
			},
		});
		expect(state.getActionEconomyState().bonus).toBe(true);

		state.startCombat();
		const inCombat = state.activateEfaEldritchCannon({
			instanceId,
			targetName: "Ogre",
			targetDistanceFromCannonFt: 30,
			attackRoll: 10,
			effectRoll: 10,
		});
		expect(inCombat).toMatchObject({ok: true, action: {type: "bonus", spent: true}});
		expect(state.getActionEconomyState().bonus).toBe(false);
		expect(state.activateEfaEldritchCannon({
			instanceId,
			targetDistanceFromCannonFt: 30,
		})).toMatchObject({ok: false, committed: false, reason: "actionUnavailable"});

		state.resetActionEconomy();
		state.setEfaEldritchCannonPosition(instanceId, {distanceFromOwnerFt: 61});
		expect(state.activateEfaEldritchCannon({
			instanceId,
			targetDistanceFromCannonFt: 30,
		})).toMatchObject({ok: false, committed: false, reason: "ownerOutOfRange", rangeFt: 60});
		expect(state.getActionEconomyState().bonus).toBe(true);

		state.setEfaEldritchCannonPosition(instanceId, {distanceFromOwnerFt: 5});
		expect(state.activateEfaEldritchCannon({
			instanceId,
			targetDistanceFromCannonFt: 121,
		})).toMatchObject({ok: false, committed: false, reason: "targetOutOfRange", rangeFt: 120});
		expect(state.getActionEconomyState().bonus).toBe(true);
	});

	test("reports the Flamethrower save/DC/half-damage contract at both damage tiers", async () => {
		for (const [level, dice, damage, expectedDc] of [
			[3, "2d8", 9, 13],
			[9, "3d8", 13, 15],
		]) {
			const state = makeState({level, intelligence: 16});
			const {instanceId} = await state.pCreateEfaEldritchCannon(createRequest({form: "flamethrower"}));
			expect(state.activateEfaEldritchCannon({
				instanceId,
				targetName: "Bandit",
				effectRoll: damage,
			})).toMatchObject({
				ok: true,
				result: {
					kind: "savingThrow",
					saveAbility: "dex",
					saveDc: expectedDc,
					damage,
					damageOnSuccess: Math.floor(damage / 2),
					damageDice: dice,
					damageType: "fire",
					area: {shape: "cone", sizeFt: 15},
				},
			});
		}
	});

	test("moves a deployed cannon up to 15 feet before or after activation and keeps carried cannons at zero", async () => {
		const state = makeState();
		const deployed = await state.pCreateEfaEldritchCannon(createRequest({distanceFromOwnerFt: 5}));
		expect(state.activateEfaEldritchCannon({
			instanceId: deployed.instanceId,
			targetDistanceFromCannonFt: 20,
			movementTiming: "before",
			movementDistanceFromOwnerFt: 20,
			attackRoll: 10,
			effectRoll: 8,
		})).toMatchObject({
			ok: true,
			movement: {timing: "before", fromDistanceFt: 5, toDistanceFt: 20, movedFt: 15},
			cannon: {distanceFromOwnerFt: 20},
		});
		expect(state.activateEfaEldritchCannon({
			instanceId: deployed.instanceId,
			targetDistanceFromCannonFt: 20,
			movementTiming: "after",
			movementDistanceFromOwnerFt: 0,
		})).toMatchObject({ok: false, committed: false, reason: "invalidMovement"});
		expect(state.getEfaEldritchCannon(deployed.instanceId).distanceFromOwnerFt).toBe(20);

		state.setEfaEldritchCannonPosition(deployed.instanceId, {distanceFromOwnerFt: 65});
		expect(state.activateEfaEldritchCannon({
			instanceId: deployed.instanceId,
			targetDistanceFromCannonFt: 20,
			movementTiming: "before",
			movementDistanceFromOwnerFt: 50,
			attackRoll: 10,
			effectRoll: 8,
		})).toMatchObject({
			ok: true,
			movement: {timing: "before", fromDistanceFt: 65, toDistanceFt: 50, movedFt: 15},
			cannon: {distanceFromOwnerFt: 50},
		});

		state.dismissEfaEldritchCannon(deployed.instanceId);
		const carried = await state.pCreateEfaEldritchCannon(createRequest({
			form: "protector",
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 0,
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		}));
		expect(state.setEfaEldritchCannonPosition(carried.instanceId, {
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 1,
		})).toMatchObject({ok: false, reason: "invalidState"});
		expect(state.activateEfaEldritchCannon({
			instanceId: carried.instanceId,
			targetType: "self",
			movementTiming: "before",
			movementDistanceFromOwnerFt: 1,
			effectRoll: 5,
		})).toMatchObject({ok: false, committed: false, reason: "invalidMovement"});
	});

	test("applies Protector temp HP replacement to self, reports allies without automation, and floors INT at +1", async () => {
		const state = makeState({level: 3, intelligence: 8});
		state.setTempHp(6);
		const {instanceId} = await state.pCreateEfaEldritchCannon(createRequest({
			form: "protector",
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 0,
		}));
		expect(state.getEfaEldritchCannon(instanceId).calculations.tempHpBonus).toBe(1);
		expect(state.activateEfaEldritchCannon({
			instanceId,
			targetType: "self",
			effectRoll: 5,
		})).toMatchObject({
			ok: true,
			effect: {formula: "1d8+1", total: 5},
			result: {
				tempHp: 5,
				applied: false,
				previousTempHp: 6,
				currentTempHp: 6,
			},
		});
		expect(state.getTempHp()).toBe(6);

		expect(state.activateEfaEldritchCannon({
			instanceId,
			targetType: "creature",
			targetName: "Ally",
			targetDistanceFromCannonFt: 10,
			effectRoll: 8,
		})).toMatchObject({
			ok: true,
			result: {
				tempHp: 8,
				target: {type: "creature", name: "Ally", distanceFromCannonFt: 10},
				applied: false,
			},
		});
		expect(state.getTempHp()).toBe(6);
	});

	test("tracks HP, destruction, capped Mending, explicit duration decrement/end, and save/load", async () => {
		const state = makeState({level: 5});
		const {instanceId} = await state.pCreateEfaEldritchCannon(createRequest());
		expect(state.damageEfaEldritchCannon(instanceId, 20)).toMatchObject({
			ok: true,
			currentHp: 5,
			amount: 20,
			previousHp: 25,
		});
		expect(state.mendEfaEldritchCannon(instanceId, {roll: 12})).toMatchObject({
			ok: true,
			formula: "2d6",
			roll: 12,
			healed: 12,
			currentHp: 17,
			maxHp: 25,
		});
		expect(state.mendEfaEldritchCannon(instanceId, {roll: 12})).toMatchObject({
			ok: true,
			healed: 8,
			currentHp: 25,
		});

		state.advanceClassSummonGameTime(30);
		const saved = state.toJson();
		const restored = makeState({level: 5});
		restored.loadFromJson(saved);
		expect(restored.getEfaEldritchCannon(instanceId)).toMatchObject({
			hp: {current: 25, max: 25},
			durationRemainingMinutes: 30,
			createdWith: "freeUse",
		});
		expect(restored.endEfaEldritchCannonDuration(instanceId)).toMatchObject({
			ok: true,
			reason: "durationExpired",
		});
		expect(restored.listEfaEldritchCannons()).toEqual([]);

		const replacement = await restored.pCreateEfaEldritchCannon(createRequest({
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		}));
		expect(restored.damageEfaEldritchCannon(replacement.instanceId, 25)).toMatchObject({
			ok: true,
			action: "retired",
			reason: "destroyed",
		});
	});

	test("charges dismissal as a Magic Action only in combat", async () => {
		const outside = makeState();
		const outsideCreated = await outside.pCreateEfaEldritchCannon(createRequest());
		expect(outside.dismissEfaEldritchCannonWithMagicAction(outsideCreated.instanceId)).toMatchObject({
			ok: true,
			committed: true,
			action: {type: "action", subtype: "Magic action", spent: false},
		});

		const inside = makeState();
		const insideCreated = await inside.pCreateEfaEldritchCannon(createRequest());
		inside.startCombat();
		expect(inside.dismissEfaEldritchCannonWithMagicAction(insideCreated.instanceId)).toMatchObject({
			ok: true,
			committed: true,
			action: {type: "action", subtype: "Magic action", spent: true},
		});
		expect(inside.getActionEconomyState().action).toBe(false);
	});
});
