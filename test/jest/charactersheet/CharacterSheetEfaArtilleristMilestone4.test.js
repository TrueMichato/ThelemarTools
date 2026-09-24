import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const objectData = JSON.parse(fs.readFileSync("data/objects.json", "utf8")).object;
const getSubclass = source => artificerData.subclass.find(it =>
	it.name === "Artillerist"
	&& it.source === source
	&& it.classSource === source,
);

const addCreationTool = (state, {
	id = "cannon-tool",
	name = "Smith's Tools",
	equipped = true,
	quantity = 1,
	proficient = true,
} = {}) => {
	state.addItem({id, name, source: "PHB", type: "AT", _isCustom: true}, quantity, equipped);
	if (proficient) state.addToolProficiency(name);
	return id;
};

const makeState = ({
	source = "EFA",
	level = 15,
	withTool = true,
	spellSlots = [{level: 1, current: 2, max: 2}],
} = {}) => {
	const state = new CharacterSheetState();
	state.setClassSummonTemplateCatalog(objectData);
	state.setAbilityBase("int", 18);
	const subclass = getSubclass(source);
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
	if (withTool && source === "EFA") addCreationTool(state);
	return state;
};

const request = (overrides = {}) => ({
	form: "forceBallista",
	size: "S",
	placement: "deployed",
	mobility: "wheels",
	distanceFromOwnerFt: 5,
	createdWith: "freeUse",
	createdWithSlotLevel: null,
	createdWithSlotKind: "spell",
	...overrides,
});

const createOne = state => state.pCreateEfaEldritchCannon(request());

describe("EFA Artillerist Milestone 4 creation tools and Double Firepower", () => {
	test("requires an equipped positive-quantity proficient Smith's or Woodcarver's Tools wrapper", async () => {
		const missing = makeState({withTool: false});
		expect(missing.getEfaEldritchCannonCreationState()).toMatchObject({
			canCreate: false,
			reason: "toolUnavailable",
			tools: [],
		});
		expect(await createOne(missing)).toMatchObject({ok: false, committed: false, reason: "toolUnavailable"});

		for (const toolOptions of [
			{equipped: false},
			{quantity: 0},
			{proficient: false},
			{name: "Thieves' Tools"},
		]) {
			const state = makeState({withTool: false});
			addCreationTool(state, toolOptions);
			expect(state.getEligibleEfaEldritchCannonCreationTools()).toEqual([]);
		}

		const state = makeState({withTool: false});
		addCreationTool(state, {name: "Woodcarver's Tools"});
		const created = await state.pCreateEfaEldritchCannon({...request(), toolInventoryItemId: "cannon-tool"});
		expect(created).toMatchObject({
			ok: true,
			tool: {
				inventoryItemId: "cannon-tool",
				itemUid: "Woodcarver's Tools|PHB",
			},
		});
		expect(created.summon.creationTool).toEqual(created.tool);

		state.removeItem("cannon-tool");
		expect(state.getEfaEldritchCannon(created.instanceId)).toMatchObject({
			instanceId: created.instanceId,
			creationTool: created.tool,
		});
	});

	test("keeps the established single-cannon commit callback and result contract", async () => {
		const state = makeState();
		state.startCombat();
		const pCommit = jest.fn(async payload => {
			expect(payload).toMatchObject({
				summon: {
					form: "forceBallista",
					creationTool: {inventoryItemId: "cannon-tool"},
				},
				payment: {type: "freeUse"},
				action: {type: "action", subtype: "Magic action", spent: true},
			});
			expect(payload.summons).toBeUndefined();
			expect(payload.payments).toBeUndefined();
			return true;
		});

		const created = await state.pCreateEfaEldritchCannon({...request(), pCommit});
		expect(created).toMatchObject({
			ok: true,
			committed: true,
			instanceId: expect.any(String),
			summon: {form: "forceBallista"},
			reconciliation: {action: "kept"},
			payment: {type: "freeUse"},
		});
		expect(pCommit).toHaveBeenCalledTimes(1);
	});

	test("creates two free-use cannons atomically in stable slots with one Magic action and one free use", async () => {
		const state = makeState();
		state.startCombat();
		const result = await state.pCreateEfaEldritchCannons({
			requests: [
				request({form: "flamethrower"}),
				request({form: "protector", placement: "carried", mobility: null, distanceFromOwnerFt: 0}),
			],
			toolInventoryItemId: "cannon-tool",
		});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			action: {type: "action", spent: true},
			payments: [{type: "freeUse"}, {type: "freeUse"}],
		});
		expect(state.getActionEconomyState().action).toBe(false);
		expect(state.getEfaEldritchCannonCreationState().freeUse.current).toBe(0);
		expect(state.listEfaEldritchCannons().map(cannon => ({
			slot: cannon.generatedClassSummon.generatedSlot,
			form: cannon.form,
			tool: cannon.creationTool.inventoryItemId,
		}))).toEqual([
			{slot: 0, form: "flamethrower", tool: "cannon-tool"},
			{slot: 1, form: "protector", tool: "cannon-tool"},
		]);
	});

	test("aggregates normal and Pact slot payments before spending and rolls back both records and revisions on save failure", async () => {
		const insufficient = makeState({spellSlots: [{level: 1, current: 1, max: 2}]});
		insufficient.startCombat();
		const before = insufficient.toJson();
		expect(await insufficient.pCreateEfaEldritchCannons({
			requests: [
				request({createdWith: "spellSlot", createdWithSlotLevel: 1}),
				request({createdWith: "spellSlot", createdWithSlotLevel: 1}),
			],
		})).toMatchObject({ok: false, committed: false, reason: "spellSlotUnavailable", required: 2});
		expect(insufficient.toJson()).toEqual(before);

		const normal = makeState();
		const normalResult = await normal.pCreateEfaEldritchCannons({
			requests: [
				request({createdWith: "spellSlot", createdWithSlotLevel: 1}),
				request({createdWith: "spellSlot", createdWithSlotLevel: 1}),
			],
		});
		expect(normalResult.ok).toBe(true);
		expect(normal.toJson().spellcasting.spellSlots[1].current).toBe(0);

		const mixed = makeState({spellSlots: [{level: 1, current: 1, max: 1}]});
		mixed.setPactSlots({level: 2, current: 1, max: 1});
		const mixedResult = await mixed.pCreateEfaEldritchCannons({
			requests: [
				request({createdWith: "spellSlot", createdWithSlotKind: "spell", createdWithSlotLevel: 1}),
				request({createdWith: "spellSlot", createdWithSlotKind: "pact", createdWithSlotLevel: 2}),
			],
		});
		expect(mixedResult).toMatchObject({
			ok: true,
			payments: [
				{type: "spellSlot", kind: "spell", level: 1},
				{type: "spellSlot", kind: "pact", level: 2},
			],
		});
		expect(mixed.toJson().spellcasting.spellSlots[1].current).toBe(0);
		expect(mixed.toJson().spellcasting.pactSlots.current).toBe(0);

		const pact = makeState({spellSlots: []});
		pact.setPactSlots({level: 2, current: 2, max: 2});
		const pactBefore = {
			actionEconomyUsage: pact.toJson().actionEconomyUsage,
			pactSlots: pact.toJson().spellcasting.pactSlots,
			companions: pact.toJson().companions,
			generatedClassSummonRevisions: pact.toJson().generatedClassSummonRevisions,
		};
		const failed = await pact.pCreateEfaEldritchCannons({
			requests: [
				request({createdWith: "spellSlot", createdWithSlotKind: "pact", createdWithSlotLevel: 2}),
				request({createdWith: "spellSlot", createdWithSlotKind: "pact", createdWithSlotLevel: 2}),
			],
			pCommit: async () => false,
		});
		expect(failed).toMatchObject({ok: false, committed: false, reason: "saveFailed"});
		expect({
			actionEconomyUsage: pact.toJson().actionEconomyUsage,
			pactSlots: pact.toJson().spellcasting.pactSlots,
			companions: pact.toJson().companions,
			generatedClassSummonRevisions: pact.toJson().generatedClassSummonRevisions,
		}).toEqual(pactBefore);
	});

	test("accepts legacy cannon records without a tool receipt and retires malformed receipts", async () => {
		const state = makeState();
		const created = await createOne(state);
		const legacyJson = state.toJson();
		delete legacyJson.companions.find(it => it.id === created.instanceId).creationTool;
		const legacy = makeState();
		legacy.loadFromJson(legacyJson);
		expect(legacy.getEfaEldritchCannon(created.instanceId)).toMatchObject({creationTool: null});

		const malformedJson = state.toJson();
		malformedJson.companions.find(it => it.id === created.instanceId).creationTool = {inventoryItemId: 42};
		const malformed = makeState();
		malformed.loadFromJson(malformedJson);
		expect(malformed.getEfaEldritchCannon(created.instanceId)).toBeNull();

		const forgedJson = state.toJson();
		forgedJson.companions.find(it => it.id === created.instanceId).creationTool = {
			inventoryItemId: "cannon-tool",
			itemUid: "Thieves' Tools|PHB",
			name: "Thieves' Tools",
			source: "PHB",
		};
		const forged = makeState();
		forged.loadFromJson(forgedJson);
		expect(forged.getEfaEldritchCannon(created.instanceId)).toBeNull();
	});
});

describe("EFA Artillerist Milestone 4 dual activation", () => {
	test("activates two cannons with one tracked Bonus Action after validating every request and roll", async () => {
		const state = makeState();
		const created = await state.pCreateEfaEldritchCannons({
			requests: [
				request({form: "forceBallista"}),
				request({form: "flamethrower"}),
			],
		});
		state.startCombat();
		const [ballista, flamethrower] = created.summons;
		const result = state.activateEfaEldritchCannons({
			requests: [
				{
					instanceId: ballista.instanceId,
					targetName: "Ogre",
					targetDistanceFromCannonFt: 60,
					movementTiming: "after",
					movementDistanceFromOwnerFt: 20,
					attackRoll: 12,
					effectRoll: 10,
				},
				{
					instanceId: flamethrower.instanceId,
					targetName: "Bandits",
					targetDistanceFromCannonFt: 15,
					movementTiming: "none",
					effectRoll: 11,
				},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			action: {type: "bonus", spent: true},
			results: [
				{instanceId: ballista.instanceId, result: {kind: "spellAttack", damage: 10}},
				{instanceId: flamethrower.instanceId, result: {kind: "savingThrow", damage: 11}},
			],
		});
		expect(state.getActionEconomyState().bonus).toBe(false);
		expect(state.getEfaEldritchCannon(ballista.instanceId).distanceFromOwnerFt).toBe(20);
	});

	test("spends nothing when either activation request or roll is invalid", async () => {
		const state = makeState();
		const created = await state.pCreateEfaEldritchCannons({
			requests: [request(), request({form: "flamethrower"})],
		});
		state.startCombat();
		const before = state.toJson();
		const failed = state.activateEfaEldritchCannons({
			requests: [
				{instanceId: created.instanceIds[0], targetDistanceFromCannonFt: 60, attackRoll: 10, effectRoll: 8},
				{instanceId: created.instanceIds[1], targetDistanceFromCannonFt: 15, effectRoll: 99},
			],
		});
		expect(failed).toMatchObject({ok: false, committed: false, reason: "invalidRoll", requestIndex: 1});
		expect(state.toJson()).toEqual(before);
	});
});

describe("EFA Artillerist Milestone 4 Explosive Cannon", () => {
	test("offers a one-shot Reaction only after surviving in-range combat damage and decline spends nothing", async () => {
		const state = makeState({level: 9});
		const created = await createOne(state);
		state.startCombat();
		const damage = state.damageEfaEldritchCannon(created.instanceId, 5);
		expect(damage.detonationOpportunity).toMatchObject({
			instanceId: created.instanceId,
			damageDice: "3d10",
			damageType: "force",
			saveAbility: "dex",
			area: {shape: "radius", sizeFt: 20},
			reaction: {available: true},
		});

		const declined = state.declineEfaCannonDetonation(damage.detonationOpportunity.triggerId);
		expect(declined).toMatchObject({ok: true, declined: true, action: {spent: false}});
		expect(state.getActionEconomyState().reaction).toBe(true);
		expect(state.getEfaEldritchCannon(created.instanceId).hp.current).toBe(40);
		expect(state.getPendingEfaCannonDetonation()).toBeNull();
	});

	test("detonates atomically for exact damage and restores the post-damage cannon and Reaction on save failure", async () => {
		const state = makeState({level: 9});
		const created = await createOne(state);
		state.startCombat();
		const damaged = state.damageEfaEldritchCannon(created.instanceId, 7);
		const failed = await state.pDetonateEfaEldritchCannon({
			triggerId: damaged.detonationOpportunity.triggerId,
			damageRoll: 18,
			pCommit: async () => false,
		});
		expect(failed).toMatchObject({ok: false, committed: false, reason: "saveFailed"});
		expect(state.getActionEconomyState().reaction).toBe(true);
		expect(state.getEfaEldritchCannon(created.instanceId).hp.current).toBe(38);
		expect(state.getPendingEfaCannonDetonation()).toBeTruthy();

		const committed = await state.pDetonateEfaEldritchCannon({
			triggerId: damaged.detonationOpportunity.triggerId,
			damageRoll: 18,
		});
		expect(committed).toMatchObject({
			ok: true,
			committed: true,
			action: {type: "reaction", spent: true},
			retirement: {reason: "detonated"},
			result: {
				kind: "savingThrow",
				saveAbility: "dex",
				damage: 18,
				damageOnSuccess: 9,
				damageDice: "3d10",
				damageType: "force",
				area: {shape: "radius", sizeFt: 20},
			},
		});
		expect(state.getActionEconomyState().reaction).toBe(false);
		expect(state.getEfaEldritchCannon(created.instanceId)).toBeNull();
	});

	test("supports an untracked Reaction opportunity outside combat", async () => {
		const outsideCombat = makeState({level: 9});
		const outside = await createOne(outsideCombat);
		const damaged = outsideCombat.damageEfaEldritchCannon(outside.instanceId, 1);
		expect(damaged.detonationOpportunity).toMatchObject({
			instanceId: outside.instanceId,
			reaction: {tracked: false, available: true},
		});
		const detonated = await outsideCombat.pDetonateEfaEldritchCannon({
			triggerId: damaged.detonationOpportunity.triggerId,
			damageRoll: 16,
		});
		expect(detonated).toMatchObject({
			ok: true,
			action: {tracked: false, spent: false},
			result: {damage: 16, damageOnSuccess: 8},
		});
		expect(outsideCombat.getEfaEldritchCannon(outside.instanceId)).toBeNull();
	});

	test("restores a declined opportunity when persistence fails", async () => {
		const state = makeState({level: 9});
		const created = await createOne(state);
		state.startCombat();
		const damaged = state.damageEfaEldritchCannon(created.instanceId, 4);
		const failed = await state.pDeclineEfaCannonDetonation({
			triggerId: damaged.detonationOpportunity.triggerId,
			pCommit: async () => false,
		});

		expect(failed).toMatchObject({ok: false, committed: false, reason: "saveFailed"});
		expect(state.getPendingEfaCannonDetonation()).toMatchObject({
			triggerId: damaged.detonationOpportunity.triggerId,
			instanceId: created.instanceId,
		});
		expect(state.getEfaEldritchCannon(created.instanceId).hp.current).toBe(41);
		expect(state.getActionEconomyState().reaction).toBe(true);
	});

	test("does not expose a trigger after destruction, out of range, or for TCE", async () => {
		const destroyed = makeState({level: 9});
		const destroyedCannon = await createOne(destroyed);
		destroyed.startCombat();
		expect(destroyed.damageEfaEldritchCannon(destroyedCannon.instanceId, 99).detonationOpportunity).toBeNull();

		const outOfRange = makeState({level: 9});
		const ranged = await createOne(outOfRange);
		outOfRange.setEfaEldritchCannonPosition(ranged.instanceId, {distanceFromOwnerFt: 61});
		outOfRange.startCombat();
		expect(outOfRange.damageEfaEldritchCannon(ranged.instanceId, 1).detonationOpportunity).toBeNull();

		const tce = makeState({source: "TCE", level: 15, withTool: false});
		expect(tce.getPendingEfaCannonDetonation()).toBeNull();
		expect(await tce.pDetonateEfaEldritchCannon({triggerId: "forged", damageRoll: 30}))
			.toMatchObject({ok: false, committed: false, reason: "triggerUnavailable"});
	});

	test("clears stale trigger state on new damage, load, action reset, and owner reconciliation", async () => {
		const state = makeState({level: 9});
		const created = await createOne(state);
		state.startCombat();
		const first = state.damageEfaEldritchCannon(created.instanceId, 1).detonationOpportunity;
		const second = state.damageEfaEldritchCannon(created.instanceId, 1).detonationOpportunity;
		expect(second.triggerId).not.toBe(first.triggerId);

		const json = state.toJson();
		const loaded = makeState({level: 9});
		loaded.loadFromJson(json);
		expect(loaded.getPendingEfaCannonDetonation()).toBeNull();

		state.resetTurnEconomy();
		expect(state.getPendingEfaCannonDetonation()).toBeNull();
		state.damageEfaEldritchCannon(created.instanceId, 1);
		state._data.classes = [];
		state.reconcileClassSummons();
		expect(state.getPendingEfaCannonDetonation()).toBeNull();
	});
});

describe("EFA Artillerist Milestone 4 cover and rest lifecycle", () => {
	test("projects reusable nonstacking Half Cover and removes it immediately with the last in-range cannon", async () => {
		const state = makeState();
		const baseAc = state.getAc();
		const baseDexSave = state.getSaveMod("dex");
		const created = await createOne(state);

		expect(state.getCoverProjection()).toMatchObject({
			cover: "half",
			acBonus: 2,
			dexSaveBonus: 2,
			sources: [expect.objectContaining({rangeFt: 10})],
		});
		expect(state.getAc()).toBe(baseAc + 2);
		expect(state.getSaveMod("dex")).toBe(baseDexSave + 2);
		expect(state.getAcBreakdown().components).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "cover", value: 2, name: expect.stringContaining("Shimmering Field Projection")}),
		]));
		expect(state.getSaveBreakdown("dex").components).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "cover", value: 2, name: expect.stringContaining("(10 ft)")}),
		]));

		state.activateState("smiteOfProtection");
		expect(state.getCoverProjection().sources).toHaveLength(2);
		expect(state.getAc()).toBe(baseAc + 2);
		expect(state.getSaveMod("dex")).toBe(baseDexSave + 2);

		const legacy = state.toJson();
		legacy.activeStates.push({
			id: "legacy-cover-of-darkness",
			stateTypeId: "shadowKnightDimLight",
			name: "Umbral Warrior",
			active: true,
			customEffects: [
				{type: "advantage", target: "save:dex"},
				{type: "bonus", target: "ac", value: 2},
				{type: "bonus", target: "save:dex", value: 2},
			],
		});
		const migrated = makeState();
		migrated.loadFromJson(legacy);
		expect(migrated.toJson().activeStates.find(state => state.id === "legacy-cover-of-darkness").customEffects).toEqual([
			{type: "advantage", target: "save:dex"},
			{type: "cover", cover: "half", source: "Cover of Darkness"},
		]);
		expect(migrated.getCoverProjection().sources).toHaveLength(3);
		expect(migrated.getAc()).toBe(baseAc + 2);
		expect(migrated.getSaveMod("dex")).toBe(baseDexSave + 2);

		state.setEfaEldritchCannonPosition(created.instanceId, {distanceFromOwnerFt: 11});
		expect(state.getCoverProjection()).toMatchObject({sources: [expect.objectContaining({name: "Smite of Protection"})]});
		state.deactivateState("smiteOfProtection");
		expect(state.getCoverProjection()).toBeNull();
		expect(state.getAc()).toBe(baseAc);
		expect(state.getSaveMod("dex")).toBe(baseDexSave);
	});

	test("expires every EFA cannon on either rest and a full pre-rest snapshot restores records, HP, duration, revisions, and cover", async () => {
		for (const rest of ["short", "long"]) {
			const state = makeState();
			const created = await state.pCreateEfaEldritchCannons({
				requests: [request(), request({form: "protector", placement: "carried", mobility: null, distanceFromOwnerFt: 0})],
			});
			state.damageEfaEldritchCannon(created.instanceIds[0], 6);
			state.advanceClassSummonGameTime(15);
			const snapshot = state.toJson();
			const beforeCover = state.getCoverProjection();
			const result = rest === "short" ? state.onShortRest() : state.onLongRest();
			expect(result.efaCannonExpiry.count).toBe(2);
			expect(result.efaCannonExpiry.retirements).toEqual(expect.arrayContaining([
				expect.objectContaining({ok: true, action: "retired", reason: "durationExpired"}),
			]));
			expect(state.listEfaEldritchCannons()).toEqual([]);
			expect(state.getCoverProjection()).toBeNull();

			state.loadFromJson(snapshot);
			expect(state.listEfaEldritchCannons()).toEqual(expect.arrayContaining([
				expect.objectContaining({instanceId: created.instanceIds[0], hp: expect.objectContaining({current: created.summons[0].hp.max - 6}), durationRemainingMinutes: 45}),
				expect.objectContaining({instanceId: created.instanceIds[1], durationRemainingMinutes: 45}),
			]));
			expect(state.toJson().generatedClassSummonRevisions).toEqual(snapshot.generatedClassSummonRevisions);
			expect(state.getCoverProjection()).toEqual(beforeCover);
		}
	});

	test("never projects EFA cannon cover for a TCE Artillerist", () => {
		const state = makeState({source: "TCE", level: 15, withTool: false});
		expect(state.getCoverProjection()).toBeNull();
		expect(state.getEfaEldritchCannonCreationState().available).toBe(false);
	});
});
