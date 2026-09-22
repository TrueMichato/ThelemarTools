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

function makeCartographer ({int = 16, hasTools = true} = {}) {
	const state = new CharacterSheetState();
	state.setCharacterName("Mira");
	state.setAbilityBase("int", int);
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 3,
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
