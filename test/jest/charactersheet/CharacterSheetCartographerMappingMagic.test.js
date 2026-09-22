import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetRest = globalThis.CharacterSheetRest;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

const SELF = {name: "Mira", isSelf: true, status: "active"};
const ALLY = {name: "Thorn", isSelf: false, status: "active"};
const ALLY_TWO = {name: "Vey", isSelf: false, status: "active"};

const FAERIE_FIRE_XPHB = {
	name: "Faerie Fire",
	source: "XPHB",
	level: 1,
	school: "V",
	time: [{number: 1, unit: "action"}],
	range: {type: "point", distance: {type: "feet", amount: 60}},
	components: {v: true},
	duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
	savingThrow: ["dex"],
	entries: ["Creatures in a 20-foot cube make a Dexterity saving throw."],
};
const FIND_THE_PATH_XPHB = {
	name: "Find the Path",
	source: "XPHB",
	level: 6,
	school: "D",
	time: [{number: 1, unit: "minute"}],
	range: {type: "point", distance: {type: "self"}},
	components: {v: true, s: true, m: {text: "a set of divinatory tools worth 100 GP"}},
	duration: [{type: "timed", duration: {type: "day", amount: 1}, concentration: true}],
	entries: ["You magically sense the most direct physical route to a fixed location."],
};

function makeCartographer ({level = 15, source = "EFA", subclassSource = "EFA"} = {}) {
	const state = new CharacterSheetState();
	state.setCharacterName("Mira");
	state.addClass({
		name: "Artificer",
		source,
		level,
		subclass: {name: "Cartographer", shortName: "Cartographer", source: subclassSource},
	});
	state.setAbilityBase("int", 16);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	if (source === "EFA" && subclassSource === "EFA" && level >= 3) {
		state.addItem({name: "Cartographer's Tools", source: "XPHB", type: "AT", quantity: 1});
	}
	return state;
}

function createSelfAtlas (state) {
	const result = state.createAdventurersAtlas([SELF, ALLY], {
		isHoldingTools: true,
		createdAt: 1_700_000_000_000,
	});
	expect(result.ok).toBe(true);
	return result.atlas;
}

function makeSpellsManager (state, {
	allSpells = [FAERIE_FIRE_XPHB, FIND_THE_PATH_XPHB],
	cancelResult = false,
	constraintsPass = true,
	useRealConstraints = false,
} = {}) {
	const page = {
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_features: {render: jest.fn()},
		saveCharacter: jest.fn(),
		_combat: {renderCombatActionEconomy: jest.fn()},
	};
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = page;
	spells._state = state;
	spells._allSpells = allSpells;
	if (!useRealConstraints) spells._pHandleCastingConstraints = jest.fn(async () => constraintsPass);
	spells._showCastResult = jest.fn(async () => ({cancelled: cancelResult}));
	spells._pConsumeMaterialComponent = jest.fn(async () => ({consumed: null}));
	spells._updateConcentrationUI = jest.fn();
	spells.renderSlots = jest.fn();
	return {spells, page};
}

function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
	};
	rest._state = state;
	rest._page = page;
	rest._removeUndoRestAffordance = jest.fn();
	return {rest, page};
}

beforeEach(() => {
	globalThis.InputUiUtil = globalThis.InputUiUtil || {};
	globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
	globalThis.InputUiUtil.pGetUserEnum = jest.fn(async () => null);
});

afterEach(() => jest.restoreAllMocks());

describe("EFA Cartographer — Mapping Magic", () => {
	test("exposes the exact Illuminated Cartography feature-spell grant from an active self-held Atlas", () => {
		const state = makeCartographer({level: 5});
		createSelfAtlas(state);

		const snapshot = state.getCartographerMappingMagicSnapshot();

		expect(snapshot).toMatchObject({
			version: 1,
			illuminatedCartography: {
				available: true,
				usesCurrent: 1,
				usesMax: 1,
				recharge: "long",
				spell: {name: "Faerie Fire", source: "XPHB", castLevel: 1},
				castingAbility: "int",
				economy: {type: "action"},
			},
		});
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.illuminatedCartography)).toBe(true);
	});
});

describe("EFA Cartographer — Mapping Magic eligibility and teardown", () => {
	test("uses the delegated level gates without leaking to same-label foreign sources", () => {
		const level4 = makeCartographer({level: 4});
		createSelfAtlas(level4);
		expect(level4.getCartographerMappingMagicSnapshot().illuminatedCartography.available).toBe(false);

		const level8 = makeCartographer({level: 8});
		createSelfAtlas(level8);
		expect(level8.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {available: true},
			portalJump: {available: false},
			positioning: {available: false},
			unerringPath: {available: false},
		});

		const level9 = makeCartographer({level: 9});
		createSelfAtlas(level9);
		expect(level9.getCartographerMappingMagicSnapshot()).toMatchObject({
			portalJump: {available: true},
			positioning: {available: true},
			unerringPath: {available: false},
		});

		for (const foreign of [
			makeCartographer({source: "TCE"}),
			makeCartographer({subclassSource: "HB"}),
		]) {
			expect(foreign.getCartographerMappingMagicSnapshot()).toMatchObject({
				activeSelfMap: false,
				illuminatedCartography: {available: false},
				portalJump: {available: false},
				positioning: {available: false},
				unerringPath: {available: false},
			});
		}
	});

	test("requires an active self map and tears every current-sheet grant down on Atlas loss", () => {
		const noAtlas = makeCartographer();
		expect(noAtlas.getCartographerMappingMagicSnapshot().illuminatedCartography.reason).toMatch(/create an Adventurer's Atlas/i);

		const allyOnly = makeCartographer();
		expect(allyOnly.createAdventurersAtlas([ALLY, ALLY_TWO], {isHoldingTools: true}).ok).toBe(true);
		expect(allyOnly.getCartographerMappingMagicSnapshot()).toMatchObject({
			activeSelfMap: false,
			illuminatedCartography: {available: false},
			portalJump: {available: false},
			positioning: {available: false},
			unerringPath: {available: false},
		});

		const destroyed = makeCartographer();
		const atlas = createSelfAtlas(destroyed);
		const selfHolder = atlas.holders.find(holder => holder.isSelf);
		expect(destroyed.destroyAdventurersAtlasHolder(selfHolder.id).ok).toBe(true);
		expect(destroyed.getCartographerMappingMagicSnapshot().activeSelfMap).toBe(false);
		expect(destroyed.getTargetingExceptionDescriptors()).toEqual([]);

		const invalidated = makeCartographer();
		createSelfAtlas(invalidated);
		invalidated.invalidateAdventurersAtlas("test");
		expect(invalidated.getCartographerMappingMagicSnapshot().illuminatedCartography.available).toBe(false);
	});

	test("tears down by exact class lifecycle and death, and blocks feature casting while incapacitated", () => {
		const lowered = makeCartographer();
		createSelfAtlas(lowered);
		lowered.addClass({
			name: "Artificer",
			source: "EFA",
			level: 2,
			subclass: {name: "Cartographer", source: "EFA"},
		});
		expect(lowered.getCartographerMappingMagicSnapshot().illuminatedCartography.available).toBe(false);

		const swapped = makeCartographer();
		createSelfAtlas(swapped);
		swapped.setSubclass("Artificer", {name: "Armorer", source: "EFA"});
		expect(swapped.getCartographerMappingMagicSnapshot().activeSelfMap).toBe(false);

		const dead = makeCartographer();
		createSelfAtlas(dead);
		dead.setDeathSaveFailures(3);
		expect(dead.getCartographerMappingMagicSnapshot().activeSelfMap).toBe(false);

		const incapacitated = makeCartographer();
		createSelfAtlas(incapacitated);
		jest.spyOn(incapacitated, "isIncapacitated").mockReturnValue(true);
		expect(incapacitated.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {available: false, reason: expect.stringMatching(/incapacitated/i)},
			unerringPath: {available: false, reason: expect.stringMatching(/incapacitated/i)},
		});
	});
});

describe("EFA Cartographer — feature-granted spell transactions", () => {
	test("casts exact Faerie Fire|XPHB with Intelligence, no preparation or slot, one use, and one action", async () => {
		const state = makeCartographer({level: 5});
		createSelfAtlas(state);
		state.startCombat();
		const slotsBefore = state.getSpellSlots();
		const {spells} = makeSpellsManager(state);

		const result = await spells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID);

		expect(result).toMatchObject({ok: true, cancelled: false});
		expect(result.spell).toMatchObject({
			name: "Faerie Fire",
			source: "XPHB",
			prepared: false,
			spellcastingAbility: "int",
			sourceFeatureUid: CharacterSheetState.CARTOGRAPHER_MAPPING_MAGIC_FEATURE_UID,
		});
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Faerie Fire", source: "XPHB"}),
			1,
			false,
			false,
			expect.objectContaining({
				freeCastSource: "Illuminated Cartography",
				componentWaivers: [],
			}),
		);
		expect(state.getSpellSlots()).toEqual(slotsBefore);
		expect(state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(0);
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getConcentration()).toMatchObject({spellName: "Faerie Fire", spellSource: "XPHB"});
		expect(state.getDamageConcentrationProtection()).toMatchObject({spellUid: "faerie fire|xphb"});
		expect(state.toJson().deferredFlatDamageRiderTurnUsage).not.toHaveProperty(CharacterSheetState.GUIDED_PRECISION_FEATURE_UID);
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);
	});

	test("rolls back the feature use and action when canonical spell resolution is cancelled", async () => {
		const state = makeCartographer({level: 5});
		createSelfAtlas(state);
		state.startCombat();
		state.setConcentration({name: "Bless", source: "XPHB", level: 1});
		const {spells} = makeSpellsManager(state, {cancelResult: true});

		const result = await spells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID);

		expect(result).toMatchObject({ok: false, cancelled: true, reason: "cast-cancelled"});
		expect(state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);
		expect(state.isActionTypeAvailable("action")).toBe(true);
		expect(state.getConcentration()).toMatchObject({spellName: "Bless"});
		expect(state.toJson().cartographerMappingMagic.castReceipts).toEqual([]);
	});

	test("rolls back the feature use and action when canonical spell resolution throws", async () => {
		const state = makeCartographer({level: 5});
		createSelfAtlas(state);
		state.startCombat();
		const {spells} = makeSpellsManager(state);
		spells._showCastResult.mockRejectedValueOnce(new Error("target resolver failed"));

		await expect(spells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.rejects.toThrow("target resolver failed");

		expect(state.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);
		expect(state.isActionTypeAvailable("action")).toBe(true);
		expect(state.toJson().cartographerMappingMagic.castReceipts).toEqual([]);
	});

	test("spends nothing when concentration replacement is declined or casting constraints fail", async () => {
		const declined = makeCartographer({level: 5});
		createSelfAtlas(declined);
		declined.startCombat();
		declined.setConcentration({name: "Bless", source: "XPHB", level: 1});
		globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValueOnce(false);
		const {spells: declinedSpells} = makeSpellsManager(declined);
		expect(await declinedSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, cancelled: true, reason: "concentration-cancelled"});
		expect(declined.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);
		expect(declined.isActionTypeAvailable("action")).toBe(true);
		expect(declinedSpells._showCastResult).not.toHaveBeenCalled();

		const constrained = makeCartographer({level: 5});
		createSelfAtlas(constrained);
		constrained.startCombat();
		const {spells: constrainedSpells} = makeSpellsManager(constrained, {constraintsPass: false});
		expect(await constrainedSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, cancelled: true, reason: "casting-constraint"});
		expect(constrained.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);
		expect(constrained.isActionTypeAvailable("action")).toBe(true);
	});

	test("rejects PHB Faerie Fire, unavailable actions, unrelated spells, and repeat casts without fallback slots", async () => {
		const phbOnly = makeCartographer({level: 5});
		createSelfAtlas(phbOnly);
		const {spells: phbSpells} = makeSpellsManager(phbOnly, {
			allSpells: [{...FAERIE_FIRE_XPHB, source: "PHB"}],
		});
		expect(await phbSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, reason: "spell-data-unavailable"});
		expect(phbOnly.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);

		const actionSpent = makeCartographer({level: 5});
		createSelfAtlas(actionSpent);
		actionSpent.consumeActionType("action");
		const {spells: spentSpells} = makeSpellsManager(actionSpent);
		expect(await spentSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, reason: "feature-spell-unavailable"});

		const unrelated = makeCartographer({level: 5});
		createSelfAtlas(unrelated);
		const {spells: unrelatedSpells} = makeSpellsManager(unrelated);
		expect(await unrelatedSpells.pCastFeatureSpellGrant("fireball|xphb")).toMatchObject({ok: false});

		const exhausted = makeCartographer({level: 5});
		createSelfAtlas(exhausted);
		const {spells: exhaustedSpells} = makeSpellsManager(exhausted);
		expect((await exhaustedSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID)).ok).toBe(true);
		exhausted.resetTurnEconomy();
		expect(await exhaustedSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, reason: "feature-spell-unavailable"});
	});

	test("casts Find the Path|XPHB at its real one-minute casting time with all source-stated components waived", async () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		state.startCombat();
		const {spells} = makeSpellsManager(state);

		const result = await spells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_UNERRING_PATH_GRANT_ID);

		expect(result).toMatchObject({ok: true});
		expect(spells._pHandleCastingConstraints).toHaveBeenCalledWith(
			expect.objectContaining({name: "Find the Path", source: "XPHB"}),
			FIND_THE_PATH_XPHB,
			null,
			{
				enforceArmor: true,
				enforceMaterial: true,
				componentWaivers: ["v", "s", "m"],
			},
		);
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Find the Path", spellcastingAbility: "int"}),
			6,
			false,
			false,
			expect.objectContaining({
				componentWaivers: ["v", "s", "m"],
				castingEconomy: {type: "casting-time", label: "1 minute", tracked: false},
			}),
		);
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
		expect(state.isActionTypeAvailable("action")).toBe(true);
		expect(state.getCartographerMappingMagicSnapshot().unerringPath.usesCurrent).toBe(0);
		expect(state.getConcentration()).toMatchObject({spellName: "Find the Path", spellSource: "XPHB"});
		expect(spells._page._features.render).toHaveBeenCalledTimes(1);
	});

	test("applies exact component waivers without bypassing unrelated casting restrictions", async () => {
		const unerring = makeCartographer({level: 15});
		createSelfAtlas(unerring);
		unerring.addCondition({name: "Silenced", source: "HB"});
		const {spells: unerringSpells} = makeSpellsManager(unerring, {useRealConstraints: true});

		expect(await unerringSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_UNERRING_PATH_GRANT_ID))
			.toMatchObject({ok: true});

		const illuminated = makeCartographer({level: 5});
		createSelfAtlas(illuminated);
		illuminated.addCondition({name: "Silenced", source: "HB"});
		const {spells: illuminatedSpells} = makeSpellsManager(illuminated, {useRealConstraints: true});

		expect(await illuminatedSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID))
			.toMatchObject({ok: false, cancelled: true, reason: "casting-constraint"});
		expect(illuminated.getCartographerMappingMagicSnapshot().illuminatedCartography.usesCurrent).toBe(1);

		const armorBlocked = makeCartographer({level: 15});
		createSelfAtlas(armorBlocked);
		jest.spyOn(armorBlocked, "isSpellcastingBlockedByArmor").mockReturnValue(true);
		const {spells: armorSpells} = makeSpellsManager(armorBlocked, {useRealConstraints: true});

		expect(await armorSpells.pCastFeatureSpellGrant(CharacterSheetState.CARTOGRAPHER_UNERRING_PATH_GRANT_ID))
			.toMatchObject({ok: false, cancelled: true, reason: "casting-constraint"});
		expect(armorBlocked.getCartographerMappingMagicSnapshot().unerringPath.usesCurrent).toBe(1);
	});
});

describe("EFA Cartographer — Portal Jump", () => {
	test("spends floor(live Speed / 2) through the canonical receipt API and resets next turn", () => {
		const state = makeCartographer({level: 9});
		createSelfAtlas(state);
		state.setSpeed("walk", 35);
		state.startCombat();

		const result = state.useCartographerPortalJump({
			destinationMode: "direct",
			confirmedVisible: true,
			confirmedWithin10Feet: true,
			confirmedUnoccupied: true,
		});

		expect(result).toMatchObject({
			ok: true,
			speedAtCommit: 35,
			movementCost: 17,
			movementRemaining: 18,
			destination: {mode: "direct", visible: true, within10Feet: true, unoccupied: true},
			receipt: {
				kind: "spend",
				source: CharacterSheetState.CARTOGRAPHER_PORTAL_JUMP_SOURCE,
				scope: "cartographer-portal-jump",
				amount: 17,
			},
		});
		expect(state.getMovementEconomyState()).toMatchObject({speed: 35, used: 17, remaining: 18});
		state.resetTurnEconomy({round: 2});
		expect(state.getMovementEconomyState()).toMatchObject({used: 0, remaining: 35, receipts: []});
	});

	test("supports the external-holder destination without inventing sight or geometry", () => {
		const state = makeCartographer({level: 9});
		createSelfAtlas(state);
		const holder = state.getCartographerPortalJumpState().destinations.holder.holders[0];

		const rejected = state.useCartographerPortalJump({
			destinationMode: "holder",
			holderId: holder.id,
			confirmedHolderWithin30Feet: false,
			confirmedWithin5FeetOfHolder: true,
			confirmedUnoccupied: true,
		});
		expect(rejected).toMatchObject({ok: false, reason: "portal-jump-confirmation-required"});
		expect(state.getMovementEconomyState().used).toBe(0);

		const committed = state.useCartographerPortalJump({
			destinationMode: "holder",
			holderId: holder.id,
			confirmedHolderWithin30Feet: true,
			confirmedWithin5FeetOfHolder: true,
			confirmedUnoccupied: true,
		});
		expect(committed).toMatchObject({
			ok: true,
			destination: {
				mode: "holder",
				holder: {id: holder.id, name: "Thorn"},
				holderWithin30Feet: true,
				within5FeetOfHolder: true,
				unoccupied: true,
			},
		});
		expect(committed.destination).not.toHaveProperty("visible");
	});

	test("fails transactionally for zero or insufficient movement, destroyed holders, and missing confirmation", () => {
		const zero = makeCartographer({level: 9});
		createSelfAtlas(zero);
		zero.setSpeed("walk", 0);
		expect(zero.getCartographerPortalJumpState()).toMatchObject({available: false, movementCost: 0, reason: expect.stringMatching(/Speed is 0/i)});
		expect(zero.useCartographerPortalJump({destinationMode: "direct"}).ok).toBe(false);
		expect(zero.getMovementEconomyState().receipts).toEqual([]);

		const insufficient = makeCartographer({level: 9});
		createSelfAtlas(insufficient);
		insufficient.spendMovement(20, {source: "test:walk"});
		expect(insufficient.getCartographerPortalJumpState()).toMatchObject({available: false, movementCost: 15, movementRemaining: 10});
		expect(insufficient.useCartographerPortalJump({destinationMode: "direct"}).ok).toBe(false);
		expect(insufficient.getMovementEconomyState().used).toBe(20);

		const missing = makeCartographer({level: 9});
		createSelfAtlas(missing);
		expect(missing.useCartographerPortalJump({
			destinationMode: "direct",
			confirmedVisible: true,
			confirmedWithin10Feet: true,
			confirmedUnoccupied: false,
		})).toMatchObject({ok: false, reason: "portal-jump-confirmation-required"});
		expect(missing.getMovementEconomyState().used).toBe(0);

		const destroyed = makeCartographer({level: 9});
		const atlas = createSelfAtlas(destroyed);
		const ally = atlas.holders.find(holder => !holder.isSelf);
		destroyed.destroyAdventurersAtlasHolder(ally.id);
		expect(destroyed.useCartographerPortalJump({
			destinationMode: "holder",
			holderId: ally.id,
			confirmedHolderWithin30Feet: true,
			confirmedWithin5FeetOfHolder: true,
			confirmedUnoccupied: true,
		})).toMatchObject({ok: false, reason: "portal-jump-holder-unavailable"});
		expect(destroyed.getMovementEconomyState().used).toBe(0);
	});

	test("persists the source receipt and structured destination through save/load", () => {
		const state = makeCartographer({level: 9});
		createSelfAtlas(state);
		const result = state.useCartographerPortalJump({
			destinationMode: "direct",
			confirmedVisible: true,
			confirmedWithin10Feet: true,
			confirmedUnoccupied: true,
		});
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());

		expect(loaded.getMovementEconomyState()).toMatchObject({used: 15, remaining: 15});
		expect(loaded.getMovementEconomyState().receipts).toContainEqual(expect.objectContaining({
			id: result.receipt.id,
			source: CharacterSheetState.CARTOGRAPHER_PORTAL_JUMP_SOURCE,
			metadata: expect.objectContaining({
				speedAtCommit: 30,
				movementCost: 15,
				destination: {mode: "direct", visible: true, within10Feet: true, unoccupied: true},
			}),
		}));
	});
});

describe("EFA Cartographer — Positioning targeting exception", () => {
	test("exposes an immutable exact-source descriptor that bypasses only sight and cover", () => {
		const state = makeCartographer({level: 9});
		createSelfAtlas(state);

		const [descriptor] = state.getTargetingExceptionDescriptors();

		expect(descriptor).toMatchObject({
			id: CharacterSheetState.CARTOGRAPHER_POSITIONING_DESCRIPTOR_ID,
			sourceFeatureUid: CharacterSheetState.CARTOGRAPHER_ATLAS_FEATURE_UID,
			bypass: {sight: true, cover: true, range: false},
			preservedRequirements: expect.arrayContaining(["range", "target eligibility", "casting requirements", "spell components"]),
			requiresConfirmation: expect.arrayContaining(["same plane", "within range", "target otherwise eligible"]),
		});
		expect(Object.isFrozen(descriptor)).toBe(true);
		expect(Object.isFrozen(descriptor.holders)).toBe(true);
	});

	test("requires same-plane, range, eligibility, and an active external holder while preserving range", () => {
		const state = makeCartographer({level: 9});
		createSelfAtlas(state);
		const descriptor = state.getTargetingExceptionDescriptors()[0];
		const holder = descriptor.holders[0];

		for (const confirmations of [
			{confirmedSamePlane: false, confirmedWithinRange: true, confirmedTargetEligibility: true},
			{confirmedSamePlane: true, confirmedWithinRange: false, confirmedTargetEligibility: true},
			{confirmedSamePlane: true, confirmedWithinRange: true, confirmedTargetEligibility: false},
		]) {
			expect(state.resolveTargetingException({
				descriptorId: descriptor.id,
				targetHolderId: holder.id,
				effectRequiresSight: true,
				...confirmations,
			})).toMatchObject({ok: false, applies: false, reason: "targeting-confirmation-required"});
		}

		expect(state.resolveTargetingException({
			descriptorId: descriptor.id,
			targetHolderId: holder.id,
			effectRequiresSight: false,
			confirmedSamePlane: true,
			confirmedWithinRange: true,
			confirmedTargetEligibility: true,
		})).toMatchObject({ok: true, applies: false, reason: "effect-does-not-require-sight"});

		const applied = state.resolveTargetingException({
			descriptorId: descriptor.id,
			targetHolderId: holder.id,
			effectRequiresSight: true,
			confirmedSamePlane: true,
			confirmedWithinRange: true,
			confirmedTargetEligibility: true,
		});
		expect(applied).toMatchObject({
			ok: true,
			applies: true,
			holder: {id: holder.id, name: "Thorn"},
			bypass: {sight: true, cover: true, range: false},
			waivedRequirements: ["sight", "cover"],
			confirmations: {samePlane: true, withinRange: true, targetOtherwiseEligible: true},
		});
		expect(applied.preservedRequirements).toContain("range");
	});
});

describe("EFA Cartographer — Mapping Magic Operate-mode adapters", () => {
	function makeFeatures (state) {
		const features = Object.create(CharacterSheetFeatures.prototype);
		features._state = state;
		features._page = {
			_spells: {pCastFeatureSpellGrant: jest.fn(async () => ({ok: true}))},
			_combat: {renderCombatMovement: jest.fn()},
			saveCharacter: jest.fn(),
		};
		features.render = jest.fn();
		features._queueAdventurersAtlasActionFocus = jest.fn();
		return features;
	}

	test("puts all four controls on the one authoritative Atlas card model", () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		const model = makeFeatures(state)._getAdventurersAtlasCardModel();

		expect(model.mappingMagic).toMatchObject({
			activeSelfMap: true,
			illuminatedCartography: {available: true, usesCurrent: 1},
			portalJump: {available: true, movementCost: 15},
			positioning: {available: true, holders: [{name: "Thorn"}]},
			unerringPath: {available: true, usesCurrent: 1},
		});
	});

	test("delegates feature spells to the canonical spell controller and preserves cancellation focus", async () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		const features = makeFeatures(state);

		await features._pCastCartographerFeatureSpell(
			CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID,
			"illuminated-cartography",
		);

		expect(features._page._spells.pCastFeatureSpellGrant)
			.toHaveBeenCalledWith(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID);
		expect(features._queueAdventurersAtlasActionFocus).toHaveBeenCalledWith("illuminated-cartography");
	});

	test("Portal Jump cancellation and Positioning cancellation spend nothing", async () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		const features = makeFeatures(state);
		const portalSpy = jest.spyOn(state, "useCartographerPortalJump");
		const positioningSpy = jest.spyOn(state, "resolveTargetingException");
		globalThis.InputUiUtil.pGetUserEnum
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce("Thorn");
		globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValueOnce(false);

		await features._pUseCartographerPortalJump();
		await features._pResolveCartographerPositioning();

		expect(portalSpy).not.toHaveBeenCalled();
		expect(positioningSpy).not.toHaveBeenCalled();
		expect(state.getMovementEconomyState().used).toBe(0);
		expect(features._queueAdventurersAtlasActionFocus).toHaveBeenCalledWith("portal-jump");
		expect(features._queueAdventurersAtlasActionFocus).toHaveBeenCalledWith("positioning");
	});
});

describe("EFA Cartographer — Mapping Magic persistence and rests", () => {
	test("round-trips uses and feature-cast receipts, defaulting old saves safely", () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		expect(state.commitFeatureSpellCast(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID).ok).toBe(true);
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {usesCurrent: 0},
			unerringPath: {usesCurrent: 1},
			castReceipts: [expect.objectContaining({
				grantId: CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID,
				spellUid: "faerie fire|xphb",
			})],
		});

		const oldSave = state.toJson();
		delete oldSave.cartographerMappingMagic;
		const migrated = new CharacterSheetState();
		migrated.loadFromJson(oldSave);
		expect(migrated.toJson().cartographerMappingMagic).toEqual({
			version: 1,
			illuminatedCartographyUses: 0,
			unerringPathUses: 0,
			castReceipts: [],
		});
	});

	test("strictly rejects malformed use ledgers and filters malformed or duplicate receipts", () => {
		const state = makeCartographer();
		createSelfAtlas(state);
		const malformedUses = state.toJson();
		malformedUses.cartographerMappingMagic = {
			version: 1,
			illuminatedCartographyUses: 2,
			unerringPathUses: -1,
			castReceipts: [],
		};
		const rejected = new CharacterSheetState();
		rejected.loadFromJson(malformedUses);
		expect(rejected.toJson().cartographerMappingMagic).toEqual({
			version: 1,
			illuminatedCartographyUses: 0,
			unerringPathUses: 0,
			castReceipts: [],
		});

		expect(state.commitFeatureSpellCast(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID).ok).toBe(true);
		const malformedReceipts = state.toJson();
		const valid = malformedReceipts.cartographerMappingMagic.castReceipts[0];
		malformedReceipts.cartographerMappingMagic.castReceipts.push(
			{...valid},
			{...valid, id: "bad-action", actionType: "legendary"},
			{version: 1, id: "missing-fields"},
		);
		const filtered = new CharacterSheetState();
		filtered.loadFromJson(malformedReceipts);
		expect(filtered.toJson().cartographerMappingMagic.castReceipts).toEqual([valid]);
	});

	test("Long Rest recharges both uses and rest undo restores the expended snapshot", () => {
		const state = makeCartographer({level: 15});
		createSelfAtlas(state);
		state.commitFeatureSpellCast(CharacterSheetState.CARTOGRAPHER_ILLUMINATED_CARTOGRAPHY_GRANT_ID);
		state.commitFeatureSpellCast(CharacterSheetState.CARTOGRAPHER_UNERRING_PATH_GRANT_ID);
		expect(state.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {usesCurrent: 0},
			unerringPath: {usesCurrent: 0},
		});

		const {rest} = makeRest(state);
		rest._captureRestSnapshot("long");
		state.restoreCartographerMappingMagicUses();
		expect(state.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {usesCurrent: 1},
			unerringPath: {usesCurrent: 1},
			castReceipts: [],
		});
		expect(rest._onUndoRest()).toBe(true);
		expect(state.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {usesCurrent: 0},
			unerringPath: {usesCurrent: 0},
		});

		state.onLongRest();
		expect(state.getCartographerMappingMagicSnapshot()).toMatchObject({
			illuminatedCartography: {usesCurrent: 1, available: true},
			unerringPath: {usesCurrent: 1},
		});
		expect(state.isActionTypeAvailable("action")).toBe(true);
	});
});
