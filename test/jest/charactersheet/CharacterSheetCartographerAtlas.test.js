import "./setup.js";
import {readFileSync} from "node:fs";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

const SELF = {name: "Mira", isSelf: true, status: "active"};
const ALLY = {name: "Thorn", isSelf: false, status: "active"};
const ALLY_TWO = {name: "Vey", isSelf: false, status: "active"};

function makeCartographer ({int = 16, hasTools = true, level = 3} = {}) {
	const state = new CharacterSheetState();
	state.setCharacterName("Mira");
	state.setAbilityBase("int", int);
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level,
		subclass: {name: "Cartographer", shortName: "Cartographer", source: "EFA"},
	});
	if (hasTools) state.addItem({name: "Cartographer's Tools", source: "XPHB", type: "AT", quantity: 1});
	return state;
}

function createAtlas (state, holders = [SELF, ALLY]) {
	const result = state.createAdventurersAtlas(holders, {isHoldingTools: true, createdAt: 1_700_000_000_000});
	expect(result.ok).toBe(true);
	expect(Object.isFrozen(result)).toBe(true);
	expect(Object.isFrozen(result.atlas)).toBe(true);
	return result.atlas;
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

describe("Cartographer — Adventurer's Atlas lifecycle", () => {
	test("starts as a versioned immutable not-yet-created state", () => {
		const state = makeCartographer();
		const atlas = state.getAdventurersAtlas();

		expect(atlas).toEqual({
			version: 1,
			generation: 0,
			createdAt: null,
			capacityAtCreation: null,
			invalidatedReason: null,
			holders: [],
		});
		expect(Object.isFrozen(atlas)).toBe(true);
		expect(Object.isFrozen(atlas.holders)).toBe(true);
		expect(state.getFeatureCalculations()).toMatchObject({
			hasAdventurersAtlas: true,
			adventurersAtlasCapacity: 4,
			hasAdventurersAtlasAwareness: true,
		});
	});

	test("requires the exact tools item and explicit held confirmation without partial mutation", () => {
		const noTools = makeCartographer({hasTools: false});
		const missingTools = noTools.createAdventurersAtlas([SELF, ALLY], {isHoldingTools: true});
		expect(missingTools.ok).toBe(false);
		expect(missingTools.errors.join(" ")).toContain("Cartographer's Tools|XPHB");
		expect(noTools.getAdventurersAtlas().generation).toBe(0);

		noTools.addItem({name: "Cartographer's Tools", source: "PHB", type: "AT", quantity: 1});
		expect(noTools.createAdventurersAtlas([SELF, ALLY], {isHoldingTools: true}).ok).toBe(false);
		expect(noTools.getAdventurersAtlas().generation).toBe(0);

		const state = makeCartographer();
		const notHeld = state.createAdventurersAtlas([SELF, ALLY], {isHoldingTools: false});
		expect(notHeld.ok).toBe(false);
		expect(notHeld.errors.join(" ")).toContain("Confirm");
		expect(state.getAdventurersAtlas().generation).toBe(0);

		state.setDeathSaves({successes: 0, failures: 3});
		const dead = state.createAdventurersAtlas([SELF, ALLY], {isHoldingTools: true});
		expect(dead.ok).toBe(false);
		expect(dead.errors.join(" ")).toContain("dead character");
	});

	test("accepts ally-only rosters through the public validator and lifecycle", () => {
		const state = makeCartographer({int: 14}); // capacity 3

		expect(state.validateAdventurersAtlasRoster([ALLY, ALLY_TWO])).toMatchObject({
			ok: true,
			errors: [],
		});

		const atlas = createAtlas(state, [ALLY, ALLY_TWO]);
		expect(atlas.holders).toHaveLength(2);
		expect(atlas.holders.filter(holder => holder.isSelf)).toHaveLength(0);
	});

	test("validates at most one self holder, stable unique IDs, minimum two holders, and capacity", () => {
		const state = makeCartographer({int: 14}); // capacity 3

		expect(state.validateAdventurersAtlasRoster([SELF]).ok).toBe(false);
		const multipleSelf = state.validateAdventurersAtlasRoster([SELF, {...ALLY, isSelf: true}]);
		expect(multipleSelf.ok).toBe(false);
		expect(multipleSelf.errors.join(" ")).toContain("at most one self holder");
		expect(state.validateAdventurersAtlasRoster([
			{...SELF, id: "same"},
			{...ALLY, id: "same"},
		]).ok).toBe(false);
		expect(state.validateAdventurersAtlasRoster([SELF, ALLY, ALLY_TWO, {...ALLY, name: "Fourth"}]).ok).toBe(false);

		const atlas = createAtlas(state, [SELF, ALLY, ALLY_TWO]);
		expect(atlas.holders).toHaveLength(3);
		expect(new Set(atlas.holders.map(holder => holder.id)).size).toBe(3);
		expect(atlas.holders.filter(holder => holder.isSelf)).toHaveLength(1);
		expect(atlas.holders.every(holder => holder.status === "active")).toBe(true);
	});

	test("recreation atomically replaces every prior map and increments generation", () => {
		const state = makeCartographer();
		const first = createAtlas(state);
		const firstIds = first.holders.map(holder => holder.id);

		const rejected = state.recreateAdventurersAtlas([SELF], {isHoldingTools: true});
		expect(rejected.ok).toBe(false);
		expect(state.getAdventurersAtlas()).toEqual(first);

		const recreated = state.recreateAdventurersAtlas([
			{...ALLY, id: firstIds[0]},
			{...ALLY_TWO, id: firstIds[1]},
		], {
			isHoldingTools: true,
			createdAt: 1_700_000_010_000,
		});
		expect(recreated.ok).toBe(true);
		expect(recreated.atlas.generation).toBe(2);
		expect(recreated.atlas.holders.map(holder => holder.name)).toEqual(["Thorn", "Vey"]);
		expect(recreated.atlas.holders.some(holder => holder.isSelf)).toBe(false);
		expect(recreated.atlas.holders.map(holder => holder.id)).not.toEqual(firstIds);
		expect(recreated.atlas.createdAt).toBe(1_700_000_010_000);
	});

	test("freezes capacity at creation and recalculates it only on recreation", () => {
		const state = makeCartographer({int: 16}); // +3 => 4
		createAtlas(state);
		expect(state.getAdventurersAtlas().capacityAtCreation).toBe(4);

		state.setAbilityBase("int", 20); // +5 => 6 now, but not retroactively
		expect(state.getAdventurersAtlasCapacity()).toBe(6);
		expect(state.getAdventurersAtlas().capacityAtCreation).toBe(4);

		const recreated = state.recreateAdventurersAtlas([SELF, ALLY], {isHoldingTools: true});
		expect(recreated.atlas.capacityAtCreation).toBe(6);
	});

	test("persists destroyed holder details and removes Awareness when the self map is destroyed", () => {
		const state = makeCartographer();
		const atlas = createAtlas(state);
		const self = atlas.holders.find(holder => holder.isSelf);

		expect(state.destroyAdventurersAtlasHolder(self.id, {
			destroyedBy: "Dispel Magic",
			destroyedAt: 1_700_000_020_000,
		}).ok).toBe(true);
		expect(state.getAdventurersAtlas().holders.find(holder => holder.isSelf)).toMatchObject({
			status: "destroyed",
			destroyedBy: "Dispel Magic",
			destroyedAt: 1_700_000_020_000,
		});
		expect(state.getAdventurersAtlasInitiativeDie()).toBeNull();
	});
});

describe("Cartographer — Awareness initiative integration", () => {
	test("adds one named 1d4 to the initiative roll API and breakdown, not the flat modifier", () => {
		const state = makeCartographer();
		createAtlas(state);
		const flatInitiative = state.getInitiative();

		expect(state.getRollBonusDice("initiative")).toEqual([{
			dice: "1d4",
			sign: 1,
			source: "Adventurer's Atlas — Awareness",
		}]);
		expect(state.getInitiativeBreakdown().diceBonuses).toEqual([{
			dice: "1d4",
			sign: 1,
			source: "Adventurer's Atlas — Awareness",
		}]);
		expect(state.getInitiative()).toBe(flatInitiative);
		expect(state.getRollBonusDice("attack:melee:int")).toEqual([]);
	});

	test("routes both initiative roll handlers through the Atlas-aware shared dice API", () => {
		const pageSource = readFileSync(new URL("../../../js/charactersheet/charactersheet.js", import.meta.url), "utf8");
		const combatSource = readFileSync(new URL("../../../js/charactersheet/charactersheet-combat.js", import.meta.url), "utf8");

		expect(pageSource).toContain("getRollBonusDice?.(rollType)");
		expect(combatSource).toContain(`getRollBonusDice?.("initiative")`);
	});

	test("does not apply when unmapped, invalidated, dead, destroyed, or no longer a Cartographer", () => {
		const unmapped = makeCartographer();
		expect(unmapped.getRollBonusDice("initiative")).toEqual([]);

		const invalidated = makeCartographer();
		createAtlas(invalidated);
		invalidated.invalidateAdventurersAtlas("test");
		expect(invalidated.getRollBonusDice("initiative")).toEqual([]);

		const dead = makeCartographer();
		createAtlas(dead);
		dead.setDeathSaves({successes: 0, failures: 3});
		expect(dead.getRollBonusDice("initiative")).toEqual([]);

		const destroyed = makeCartographer();
		const atlas = createAtlas(destroyed);
		destroyed.destroyAdventurersAtlasHolder(atlas.holders.find(holder => holder.isSelf).id);
		expect(destroyed.getRollBonusDice("initiative")).toEqual([]);

		const removed = makeCartographer();
		createAtlas(removed);
		removed.setSubclass("Artificer", {name: "Armorer", source: "EFA"});
		expect(removed.getRollBonusDice("initiative")).toEqual([]);
	});

	test("does not grant the current sheet Awareness for ally-only maps and restores it when self is added", () => {
		const state = makeCartographer();
		createAtlas(state, [ALLY, ALLY_TWO]);

		expect(state.getAdventurersAtlasInitiativeDie()).toBeNull();
		expect(state.getRollBonusDice("initiative")).toEqual([]);

		const recreated = state.recreateAdventurersAtlas([SELF, ALLY], {isHoldingTools: true});
		expect(recreated.ok).toBe(true);
		expect(state.getAdventurersAtlasInitiativeDie()).toMatchObject({
			dice: "1d4",
			source: "Adventurer's Atlas — Awareness",
		});
		expect(state.getRollBonusDice("initiative")).toHaveLength(1);
	});

	test("exposes external-holder dice only in the immutable versioned integration snapshot", () => {
		const state = makeCartographer();
		createAtlas(state, [ALLY, ALLY_TWO]);

		const snapshot = state.getAdventurersAtlasIntegrationSnapshot();
		expect(snapshot.version).toBe(1);
		expect(snapshot.status).toBe("active");
		expect(snapshot.holders.find(holder => holder.name === "Thorn").initiativeDie).toBe("1d4");
		expect(snapshot.holders.find(holder => holder.name === "Vey").initiativeDie).toBe("1d4");
		expect(state.getRollBonusDice("initiative")).toEqual([]);
		expect(Object.keys(snapshot)).toEqual([
			"version",
			"atlasVersion",
			"generation",
			"status",
			"createdAt",
			"capacityAtCreation",
			"invalidatedReason",
			"holders",
		]);
		expect(Object.keys(snapshot.holders[0])).toEqual([
			"id",
			"name",
			"isSelf",
			"status",
			"destroyedBy",
			"destroyedAt",
			"initiativeDie",
		]);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.holders)).toBe(true);
		expect(Object.isFrozen(snapshot.holders[0])).toBe(true);
	});
});

describe("Cartographer — persistence, invalidation, and teardown", () => {
	test("round-trips valid state and migrates old saves to empty state", () => {
		const state = makeCartographer();
		createAtlas(state, [ALLY, ALLY_TWO]);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getAdventurersAtlas()).toEqual(state.getAdventurersAtlas());
		expect(loaded.getAdventurersAtlas().holders.some(holder => holder.isSelf)).toBe(false);
		expect(loaded.getRollBonusDice("initiative")).toEqual([]);

		const oldSave = state.toJson();
		delete oldSave.adventurersAtlas;
		const migrated = new CharacterSheetState();
		migrated.loadFromJson(oldSave);
		expect(migrated.getAdventurersAtlas().generation).toBe(0);
		expect(migrated.getAdventurersAtlas().holders).toEqual([]);
	});

	test("filters malformed persisted holders and never activates a row with a missing status", () => {
		const state = makeCartographer();
		createAtlas(state);
		const saved = state.toJson();
		saved.adventurersAtlas.holders.push({
			id: "malformed",
			name: "Ghost",
			isSelf: false,
			destroyedBy: null,
			destroyedAt: null,
		});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(saved);
		expect(loaded.getAdventurersAtlas().generation).toBe(1);
		expect(loaded.getAdventurersAtlas().holders.map(holder => holder.name)).not.toContain("Ghost");

		saved.adventurersAtlas.holders = [
			saved.adventurersAtlas.holders.find(holder => holder.isSelf),
			{id: "malformed-only", name: "Ghost", isSelf: false},
		];
		const rejected = new CharacterSheetState();
		rejected.loadFromJson(saved);
		expect(rejected.getAdventurersAtlas().generation).toBe(0);
	});

	test("filters duplicate persisted self rows without inventing a missing self holder", () => {
		const allyOnly = makeCartographer();
		createAtlas(allyOnly, [ALLY, ALLY_TWO]);
		const loadedAllyOnly = new CharacterSheetState();
		loadedAllyOnly.loadFromJson(allyOnly.toJson());
		expect(loadedAllyOnly.getAdventurersAtlas().holders.filter(holder => holder.isSelf)).toHaveLength(0);

		const state = makeCartographer();
		createAtlas(state);
		const saved = state.toJson();
		const self = saved.adventurersAtlas.holders.find(holder => holder.isSelf);
		saved.adventurersAtlas.holders.push({...self, id: "duplicate-self", name: "False Mira"});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(saved);
		expect(loaded.getAdventurersAtlas().holders.filter(holder => holder.isSelf)).toHaveLength(1);
		expect(loaded.getAdventurersAtlas().holders.map(holder => holder.name)).not.toContain("False Mira");
	});

	test("invalidates for death exactly once through the centralized transition", () => {
		const state = makeCartographer();
		createAtlas(state);
		const invalidateSpy = jest.spyOn(state, "invalidateAdventurersAtlas");

		state.setDeathSaves({successes: 0, failures: 3});
		expect(state.getAdventurersAtlas().invalidatedReason).toBe("character-death");
		expect(invalidateSpy).toHaveBeenCalledTimes(1);

		state.addDeathSaveFailure();
		state.setExhaustion(state.getMaxExhaustion());
		expect(invalidateSpy).toHaveBeenCalledTimes(1);
		expect(state.getAdventurersAtlas().invalidatedReason).toBe("character-death");
	});

	test("invalidates when the subclass is changed, removed, or drops below level 3", () => {
		const changed = makeCartographer();
		createAtlas(changed);
		changed.setSubclass("Artificer", {name: "Armorer", source: "EFA"});
		expect(changed.getAdventurersAtlas().invalidatedReason).toBe("subclass-removed");

		const removed = makeCartographer();
		createAtlas(removed);
		removed.removeClass("Artificer", "EFA");
		expect(removed.getAdventurersAtlas().invalidatedReason).toBe("subclass-removed");

		const lowered = makeCartographer();
		createAtlas(lowered);
		lowered.addClass({
			name: "Artificer",
			source: "EFA",
			level: 2,
			subclass: {name: "Cartographer", source: "EFA"},
		});
		expect(lowered.getAdventurersAtlas().invalidatedReason).toBe("subclass-removed");
	});
});

describe("Cartographer — Long Rest atomicity and undo", () => {
	test("keeps the current Atlas by default and applies create/recreate plans only at commit", () => {
		const state = makeCartographer();
		const {rest} = makeRest(state);

		expect(rest._applyAdventurersAtlasLongRestPlan({mode: "keep"})).toMatchObject({ok: true, changed: false});
		expect(state.getAdventurersAtlas().generation).toBe(0);

		const created = rest._applyAdventurersAtlasLongRestPlan({
			mode: "create",
			holders: [ALLY, ALLY_TWO],
			isHoldingTools: true,
		});
		expect(created).toMatchObject({ok: true, changed: true});
		expect(state.getAdventurersAtlas().generation).toBe(1);
		expect(state.getAdventurersAtlas().holders.some(holder => holder.isSelf)).toBe(false);

		const beforeRejectedRecreation = state.getAdventurersAtlas();
		const rejected = rest._applyAdventurersAtlasLongRestPlan({
			mode: "recreate",
			holders: [SELF],
			isHoldingTools: true,
		});
		expect(rejected.ok).toBe(false);
		expect(state.getAdventurersAtlas()).toEqual(beforeRejectedRecreation);
	});

	test("rechecks tools and held confirmation at commit time", () => {
		const noTools = makeCartographer({hasTools: false});
		const {rest: noToolsRest} = makeRest(noTools);
		expect(noToolsRest._applyAdventurersAtlasLongRestPlan({
			mode: "create",
			holders: [SELF, ALLY],
			isHoldingTools: true,
		}).ok).toBe(false);

		const state = makeCartographer();
		const {rest} = makeRest(state);
		expect(rest._applyAdventurersAtlasLongRestPlan({
			mode: "create",
			holders: [SELF, ALLY],
			isHoldingTools: false,
		}).ok).toBe(false);
		expect(state.getAdventurersAtlas().generation).toBe(0);
	});

	test("rest undo restores the complete previous Atlas snapshot", () => {
		const state = makeCartographer();
		createAtlas(state);
		const before = state.getAdventurersAtlas();
		const {rest} = makeRest(state);

		rest._captureRestSnapshot("long");
		expect(rest._applyAdventurersAtlasLongRestPlan({
			mode: "recreate",
			holders: [SELF, ALLY_TWO],
			isHoldingTools: true,
		}).ok).toBe(true);
		expect(state.getAdventurersAtlas().generation).toBe(2);

		expect(rest._onUndoRest()).toBe(true);
		expect(state.getAdventurersAtlas()).toEqual(before);
	});

	test("offers an explicit optional self choice instead of a fixed self roster row", () => {
		const restSource = readFileSync(new URL("../../../js/charactersheet/charactersheet-rest.js", import.meta.url), "utf8");

		expect(restSource).toContain("Include yourself as a map holder");
		expect(restSource).toContain("cbIncludeSelf.checked = !!previousSelf;");
		expect(restSource).toContain("const rows = previousOthers");
		expect(restSource).not.toMatch(/const rows = \[\s*\{isSelf: true/);
	});
});

describe("Cartographer — Features Atlas card model", () => {
	test("reports authoritative status, frozen capacity, holder groups, self status, and Awareness", () => {
		const state = makeCartographer();
		const atlas = createAtlas(state, [SELF, ALLY, ALLY_TWO]);
		state.destroyAdventurersAtlasHolder(atlas.holders.find(holder => holder.name === "Vey").id, {
			destroyedBy: "Fire",
			destroyedAt: 1_700_000_030_000,
		});
		const features = Object.create(CharacterSheetFeatures.prototype);
		features._state = state;

		const model = features._getAdventurersAtlasCardModel();
		expect(model).toMatchObject({
			status: "active",
			statusLabel: "Active",
			capacityAtCreation: 4,
			selfStatus: "Active map",
			awarenessLabel: "1d4 to Initiative",
			hasTools: true,
			actionLabel: "Plan Atlas recreation",
		});
		expect(model.activeHolders.map(holder => holder.name)).toEqual(["Mira", "Thorn"]);
		expect(model.destroyedHolders).toEqual([
			expect.objectContaining({name: "Vey", status: "destroyed", destroyedBy: "Fire"}),
		]);
	});

	test("shows self as unmapped and Awareness inactive for an ally-only Atlas", () => {
		const state = makeCartographer();
		createAtlas(state, [ALLY, ALLY_TWO]);
		const features = Object.create(CharacterSheetFeatures.prototype);
		features._state = state;

		expect(features._getAdventurersAtlasCardModel()).toMatchObject({
			status: "active",
			selfStatus: "Not mapped",
			awarenessLabel: "Inactive",
		});
	});
});

describe("Cartographer — Superior Atlas Safe Haven", () => {
	const DESTROYED_AT = 1_700_000_040_000;

	function makeSafeHavenCartographer ({level = 15, holders = [SELF, ALLY], hp = 80} = {}) {
		const state = makeCartographer({level});
		state.setHp(hp, hp);
		createAtlas(state, holders);
		return state;
	}

	function dropToZero (state, damage = state.getCurrentHp()) {
		state.takeDamage(damage);
		return state.getPendingZeroHpIntervention();
	}

	test("registers the source-qualified level-15 feature and restores exactly twice the current Artificer level", () => {
		const below = makeCartographer({level: 14});
		expect(below.getFeatureCalculations().hasSuperiorAtlasSafeHaven).toBeUndefined();
		expect(below.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven requires Artificer level 15.",
		});
		const wrongSource = makeCartographer({level: 15});
		wrongSource.setSubclass("Artificer", {name: "Cartographer", source: "HB"});
		expect(wrongSource.getFeatureCalculations().hasSuperiorAtlasSafeHaven).toBeUndefined();
		expect(wrongSource.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven requires the EFA Cartographer subclass.",
		});

		const state = makeSafeHavenCartographer({level: 17});
		expect(state.getFeatureCalculations()).toMatchObject({
			hasSuperiorAtlasSafeHaven: true,
			safeHavenHitPoints: 34,
			safeHavenSourceFeatureUid: "Superior Atlas|Artificer|EFA|Cartographer|EFA|15|EFA",
		});
		dropToZero(state);

		const result = state.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{destroyedAt: DESTROYED_AT},
		);
		expect(result).toMatchObject({
			applied: true,
			committed: true,
			success: true,
			hp: 34,
			consumption: {
				type: "adventurersAtlasMap",
				amount: 1,
				holderName: "Mira",
				status: "destroyed",
				destroyedBy: "Safe Haven",
			},
			postApplication: {
				kind: "safeHaven",
				sourceFeatureUid: "Superior Atlas|Artificer|EFA|Cartographer|EFA|15|EFA",
				hitPoints: 34,
			},
		});
		expect(state.getCurrentHp()).toBe(34);
	});

	test("uses the generic automatic transaction, destroys exactly the self map once, and returns placement requirements", () => {
		const state = makeSafeHavenCartographer();
		state.addConcentration({id: "spell:haste", kind: "spell", name: "Haste"});
		const atlas = state.getAdventurersAtlas();
		const self = atlas.holders.find(holder => holder.isSelf);
		const ally = atlas.holders.find(holder => !holder.isSelf);
		const destroySpy = jest.spyOn(state, "destroyAdventurersAtlasHolder");
		const pending = dropToZero(state);

		expect(pending.chooser.options.map(option => option.id)).toContain(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
		);
		const result = state.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{destroyedAt: DESTROYED_AT},
		);

		expect(destroySpy).toHaveBeenCalledTimes(1);
		expect(destroySpy).toHaveBeenCalledWith(self.id, {
			destroyedBy: "Safe Haven",
			destroyedAt: DESTROYED_AT,
		});
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === self.id)).toMatchObject({
			status: "destroyed",
			destroyedBy: "Safe Haven",
			destroyedAt: DESTROYED_AT,
		});
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === ally.id).status).toBe("active");
		expect(result.postApplication.teleport).toEqual({
			kind: "safeHavenTeleport",
			status: "requires-placement",
			applied: false,
			maxDistanceFeet: 5,
			mustBeUnoccupied: true,
			anchorChoiceRequired: true,
			instruction: "Place the creature in an unoccupied space within 5 feet of one listed anchor.",
			anchors: [
				{
					kind: "cartographer",
					holderId: null,
					name: "Mira",
					isActiveMapHolder: false,
				},
				{
					kind: "activeMapHolder",
					holderId: ally.id,
					name: "Thorn",
					isActiveMapHolder: true,
				},
			],
		});
		expect(Object.isFrozen(result.postApplication)).toBe(true);
		expect(Object.isFrozen(result.postApplication.teleport)).toBe(true);
		expect(state.isConcentrating()).toBe(true);
		expect(state.applyZeroHpIntervention(CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID)).toBeNull();
		expect(destroySpy).toHaveBeenCalledTimes(1);

		const pageSource = readFileSync(new URL("../../../js/charactersheet/charactersheet.js", import.meta.url), "utf8");
		const applyDamageSource = pageSource.slice(
			pageSource.indexOf("async _pApplyDamage"),
			pageSource.indexOf("async _pOfferMaterialDamageReactions"),
		);
		expect(applyDamageSource.indexOf("await this._pOfferZeroHpIntervention();"))
			.toBeLessThan(applyDamageSource.indexOf("if (this._state.isConcentrating?.())"));
	});

	test("keeps the Cartographer as the self-trigger anchor when no external active map remains", () => {
		const state = makeSafeHavenCartographer();
		const atlas = state.getAdventurersAtlas();
		const self = atlas.holders.find(holder => holder.isSelf);
		const ally = atlas.holders.find(holder => !holder.isSelf);
		expect(state.destroyAdventurersAtlasHolder(ally.id, {destroyedAt: DESTROYED_AT}).ok).toBe(true);
		const expectedTeleport = {
			kind: "safeHavenTeleport",
			status: "requires-placement",
			applied: false,
			maxDistanceFeet: 5,
			mustBeUnoccupied: true,
			anchorChoiceRequired: false,
			instruction: "Place the creature in an unoccupied space within 5 feet of one listed anchor.",
			anchors: [{
				kind: "cartographer",
				holderId: null,
				name: "Mira",
				isActiveMapHolder: false,
			}],
		};

		expect(state.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: true,
			holder: {
				id: self.id,
				isSelf: true,
				status: "active",
			},
			teleport: expectedTeleport,
		});

		const pending = dropToZero(state);
		expect(pending.chooser.options.map(option => option.id)).toContain(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
		);
		const result = state.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{destroyedAt: DESTROYED_AT + 1},
		);

		expect(result).toMatchObject({
			applied: true,
			committed: true,
			hp: 30,
			consumption: {
				holderId: self.id,
				holderName: "Mira",
			},
		});
		expect(result.postApplication).toEqual({
			kind: "safeHaven",
			sourceFeatureUid: CharacterSheetState.SAFE_HAVEN_FEATURE_UID,
			holder: {
				id: self.id,
				name: "Mira",
				isSelf: true,
			},
			hitPoints: 30,
			message: expectedTeleport.instruction,
			teleport: expectedTeleport,
		});
		expect(Object.isFrozen(result.postApplication)).toBe(true);
		expect(Object.isFrozen(result.postApplication.teleport)).toBe(true);
		expect(Object.isFrozen(result.postApplication.teleport.anchors)).toBe(true);
		expect(Object.isFrozen(result.postApplication.teleport.anchors[0])).toBe(true);
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === self.id)).toMatchObject({
			status: "destroyed",
			destroyedBy: "Safe Haven",
			destroyedAt: DESTROYED_AT + 1,
		});
	});

	test("rejects external automatic, destroyed, missing, and invalidated holder states", () => {
		const external = makeSafeHavenCartographer({holders: [ALLY, ALLY_TWO]});
		const externalHolder = external.getAdventurersAtlas().holders[0];
		expect(external.getAdventurersAtlasSafeHavenAvailability({
			holderId: externalHolder.id,
			isExternal: false,
		})).toMatchObject({
			available: false,
			unavailableReason: "Automatic Safe Haven resolution requires the Cartographer's own map.",
		});
		expect(external.getAdventurersAtlasSafeHavenAvailability({
			holderId: "missing-holder",
			isExternal: true,
		})).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven requires a named Atlas holder.",
		});

		const destroyed = makeSafeHavenCartographer();
		const destroyedSelf = destroyed.getAdventurersAtlas().holders.find(holder => holder.isSelf);
		expect(destroyed.destroyAdventurersAtlasHolder(destroyedSelf.id, {destroyedAt: DESTROYED_AT}).ok).toBe(true);
		expect(destroyed.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven is unavailable because Mira's map is destroyed.",
		});

		const invalidated = makeSafeHavenCartographer();
		invalidated.invalidateAdventurersAtlas("test-invalidation");
		expect(invalidated.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven is unavailable because the Atlas is invalidated (test-invalidation).",
		});
	});

	test("cancels without spending and revalidates to the Cartographer anchor after external map loss", () => {
		const cancelled = makeSafeHavenCartographer();
		const cancelledSelf = cancelled.getAdventurersAtlas().holders.find(holder => holder.isSelf);
		dropToZero(cancelled);
		expect(cancelled.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{cancelled: true},
		)).toMatchObject({applied: false, committed: false, cancelled: true});
		expect(cancelled.getAdventurersAtlas().holders.find(holder => holder.id === cancelledSelf.id).status).toBe("active");

		const revalidated = makeSafeHavenCartographer();
		const revalidatedAtlas = revalidated.getAdventurersAtlas();
		const revalidatedSelf = revalidatedAtlas.holders.find(holder => holder.isSelf);
		const revalidatedAlly = revalidatedAtlas.holders.find(holder => !holder.isSelf);
		dropToZero(revalidated);
		revalidated.destroyAdventurersAtlasHolder(revalidatedAlly.id, {destroyedAt: DESTROYED_AT});

		expect(revalidated.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{destroyedAt: DESTROYED_AT + 1},
		)).toMatchObject({
			applied: true,
			committed: true,
			hp: 30,
			postApplication: {
				teleport: {
					anchors: [{
						kind: "cartographer",
						holderId: null,
						name: "Mira",
						isActiveMapHolder: false,
					}],
				},
			},
		});
		expect(revalidated.getAdventurersAtlas().holders.find(holder => holder.id === revalidatedSelf.id)).toMatchObject({
			status: "destroyed",
			destroyedBy: "Safe Haven",
			destroyedAt: DESTROYED_AT + 1,
		});
		expect(revalidated.getCurrentHp()).toBe(30);
		expect(revalidated.getPendingZeroHpIntervention()).toBeNull();
	});

	test("reports an invalidated Atlas explicitly and spends no map", () => {
		const state = makeSafeHavenCartographer();
		const self = state.getAdventurersAtlas().holders.find(holder => holder.isSelf);
		state.invalidateAdventurersAtlas("test-invalidation");

		expect(state.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven is unavailable because the Atlas is invalidated (test-invalidation).",
		});
		expect(state.resolveAdventurersAtlasSafeHavenForExternalHolder(
			state.getAdventurersAtlas().holders.find(holder => !holder.isSelf).id,
			{confirmedReducedToZero: true, killedOutright: false},
		)).toMatchObject({
			ok: false,
			committed: false,
			errors: ["Safe Haven is unavailable because the Atlas is invalidated (test-invalidation)."],
		});
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === self.id).status).toBe("active");
	});

	test("leaves massive-damage death to the canonical pipeline without offering or consuming Safe Haven", () => {
		const state = makeSafeHavenCartographer({hp: 40});
		const self = state.getAdventurersAtlas().holders.find(holder => holder.isSelf);
		const destroySpy = jest.spyOn(state, "destroyAdventurersAtlasHolder");

		state.takeDamage(80);

		expect(state.isDead()).toBe(true);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
		expect(state.applyZeroHpIntervention(CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID)).toBeNull();
		expect(destroySpy).not.toHaveBeenCalled();
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === self.id).status).toBe("active");
		expect(state.getAdventurersAtlas().invalidatedReason).toBe("character-death");
	});

	test("uses deterministic chooser ordering and consumes only the selected intervention", () => {
		const original = CharacterSheetState.ZERO_HP_INTERVENTIONS;
		let customConsumes = 0;
		CharacterSheetState.ZERO_HP_INTERVENTIONS = [
			...original,
			{
				id: "testAlternative",
				featureName: "Test Alternative",
				displayName: "Test Alternative",
				saveAbility: null,
				dcBase: 0,
				dcAddsDamage: false,
				excludedDamageTypes: [],
				excludeCritical: false,
				spendOn: "success",
				usesMax: null,
				recharge: null,
				hpOutcome: 3,
				consumption: () => {
					customConsumes++;
					return {type: "test"};
				},
			},
		];
		try {
			const state = makeSafeHavenCartographer();
			const pending = dropToZero(state);
			expect(pending.chooser).toMatchObject({required: true});
			expect(pending.chooser.options.map(option => option.id)).toEqual([
				CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
				"testAlternative",
			]);

			const result = state.applyZeroHpIntervention(
				CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
				{destroyedAt: DESTROYED_AT},
			);
			expect(result.consumption.type).toBe("adventurersAtlasMap");
			expect(customConsumes).toBe(0);
		} finally {
			CharacterSheetState.ZERO_HP_INTERVENTIONS = original;
		}
	});

	test("supports ally-only Atlases through the external resolver while automatic self use stays unavailable", () => {
		const state = makeSafeHavenCartographer({holders: [ALLY, ALLY_TWO]});
		const atlas = state.getAdventurersAtlas();
		const thorn = atlas.holders.find(holder => holder.name === "Thorn");
		const vey = atlas.holders.find(holder => holder.name === "Vey");

		expect(state.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven is unavailable because the Cartographer has no Atlas map.",
		});
		expect(dropToZero(state)).toBeNull();

		const result = state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id, {
			confirmedReducedToZero: true,
			killedOutright: false,
			destroyedAt: DESTROYED_AT,
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			hp: 30,
			consumption: {
				holderId: thorn.id,
				holderName: "Thorn",
			},
		});
		expect(result.postApplication.teleport.anchors).toEqual([
			{
				kind: "cartographer",
				holderId: null,
				name: "Mira",
				isActiveMapHolder: false,
			},
			{
				kind: "activeMapHolder",
				holderId: vey.id,
				name: "Vey",
				isActiveMapHolder: true,
			},
		]);
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === thorn.id).status).toBe("destroyed");
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === vey.id).status).toBe("active");
	});

	test("requires explicit external confirmation, blocks killed-outright use, and prevents destroyed-map reuse", () => {
		const state = makeSafeHavenCartographer({holders: [ALLY, ALLY_TWO]});
		const thorn = state.getAdventurersAtlas().holders.find(holder => holder.name === "Thorn");

		expect(state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id)).toMatchObject({
			ok: false,
			committed: false,
			errors: ["Confirm that the external map holder reached 0 hit points."],
		});
		expect(state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id, {
			confirmedReducedToZero: true,
			killedOutright: true,
		})).toMatchObject({
			ok: false,
			committed: false,
			errors: ["Safe Haven can't resolve unless the external map holder was not killed outright."],
		});
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === thorn.id).status).toBe("active");

		expect(state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id, {
			confirmedReducedToZero: true,
			killedOutright: false,
			destroyedAt: DESTROYED_AT,
		}).ok).toBe(true);
		expect(state.resolveAdventurersAtlasSafeHavenForExternalHolder(thorn.id, {
			confirmedReducedToZero: true,
			killedOutright: false,
		})).toMatchObject({
			ok: false,
			committed: false,
			errors: ["Safe Haven is unavailable because Thorn's map is destroyed."],
		});
	});

	test("persists destruction, recreates cleanly, reports teardown reasons, and remains rest-undo safe", () => {
		const state = makeSafeHavenCartographer();
		state.setHp(50, 80);
		const self = state.getAdventurersAtlas().holders.find(holder => holder.isSelf);
		const {rest} = makeRest(state);
		rest._captureRestSnapshot("short");
		dropToZero(state, 50);
		state.applyZeroHpIntervention(
			CharacterSheetState.SAFE_HAVEN_ZERO_HP_INTERVENTION_ID,
			{destroyedAt: DESTROYED_AT},
		);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getAdventurersAtlas().holders.find(holder => holder.id === self.id)).toMatchObject({
			status: "destroyed",
			destroyedBy: "Safe Haven",
			destroyedAt: DESTROYED_AT,
		});
		expect(loaded.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven is unavailable because Mira's map is destroyed.",
		});

		expect(rest._onUndoRest()).toBe(true);
		expect(state.getCurrentHp()).toBe(50);
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === self.id).status).toBe("active");

		const recreated = loaded.recreateAdventurersAtlas([SELF, ALLY], {isHoldingTools: true});
		expect(recreated.ok).toBe(true);
		expect(loaded.getAdventurersAtlasSafeHavenAvailability().available).toBe(true);
		loaded.setSubclass("Artificer", {name: "Armorer", source: "EFA"});
		expect(loaded.getAdventurersAtlas().invalidatedReason).toBe("subclass-removed");
		expect(loaded.getAdventurersAtlasSafeHavenAvailability()).toMatchObject({
			available: false,
			unavailableReason: "Safe Haven requires the EFA Cartographer subclass.",
		});
	});

	test("does not arm from non-damage 0-HP changes", () => {
		const state = makeSafeHavenCartographer();
		state.setHp(0, 80);

		expect(state.getPendingZeroHpIntervention()).toBeNull();
		expect(state.getAdventurersAtlas().holders.find(holder => holder.isSelf).status).toBe("active");
	});

	test("surfaces an accessible external-holder action on the Atlas card and resolves only that named holder", async () => {
		const state = makeSafeHavenCartographer({holders: [ALLY, ALLY_TWO]});
		const page = {saveCharacter: jest.fn(), openAdventurersAtlasLongRest: jest.fn()};
		const features = Object.create(CharacterSheetFeatures.prototype);
		features._state = state;
		features._page = page;
		features.render = jest.fn();
		const model = features._getAdventurersAtlasCardModel();

		expect(model.safeHaven).toMatchObject({
			hitPoints: 30,
			unavailableReason: null,
		});
		expect(model.safeHaven.externalHolders.map(holder => holder.name)).toEqual(["Thorn", "Vey"]);

		const thorn = model.safeHaven.externalHolders.find(holder => holder.name === "Thorn");
		const originalConfirm = globalThis.InputUiUtil.pGetUserBoolean;
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn().mockResolvedValue(true);
		try {
			const result = await features._pResolveAdventurersAtlasSafeHavenExternal(thorn.id);
			expect(result).toMatchObject({ok: true, hp: 30});
		} finally {
			globalThis.InputUiUtil.pGetUserBoolean = originalConfirm;
		}
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(features.render).toHaveBeenCalledTimes(1);
		expect(state.getAdventurersAtlas().holders.find(holder => holder.id === thorn.id).status).toBe("destroyed");

		const source = readFileSync(new URL("../../../js/charactersheet/charactersheet-features.js", import.meta.url), "utf8");
		expect(source).toContain(`attrs: {for: selectId}`);
		expect(source).toContain(`"aria-describedby": "charsheet-atlas-safe-haven-help charsheet-atlas-safe-haven-status"`);
		expect(source).toContain(`role: "status"`);
	});
});
