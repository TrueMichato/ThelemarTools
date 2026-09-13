import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const makeFury = (level = 6) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.setSpeed("walk", 30);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	for (const [lvl, name] of [[3, "Manifest Chains"], [6, "Chain Imprisonment"], [10, "Chain Control"], [14, "Unchained Fury"]]) {
		if (level >= lvl) state.addFeature({name, source: "TGTT", description: name});
	}
	state.activateState("rage");
	state.activateState("manifestChains");
	return state;
};

describe("CharacterSheet target/effect lifecycle", () => {
	it("opts Chained Fury riders into persistence without changing generic rider shape", () => {
		const state = makeFury(6);
		const options = state.getFeatureCalculations().attackOnHitOptions;
		expect(options.find(o => o.id === "chains-grapple").targetAware).toBe(true);
		expect(options.find(o => o.id === "chains-shove").targetAware).toBe(true);
		expect(options.find(o => o.id === "chains-grapple").targetEffect).toEqual({source: "chained-fury", effect: "grapple"});
		expect(options.find(o => o.id === "chains-restrain").targetEffect).toEqual({source: "chained-fury", effect: "restrain"});
		expect(options.find(o => o.id === "chains-grapple").description).toContain("Grapple");
	});

	it("persists a restrained Chained Fury target with recurring damage", () => {
		const state = makeFury(6);
		const result = state.applyChainedTargetEffect({
			targetName: "Ogre",
			size: "large",
			distance: 20,
			riderId: "chains-restrain",
			effect: "restrain",
			restraintSaveTotal: 10,
		});
		expect(result.ok).toBe(true);
		expect(result.target).toMatchObject({
			targetName: "Ogre",
			grappled: true,
			restrained: true,
			recurringDamage: {amount: 6, type: "force"},
		});
		expect(state.resolveChainedTargetTurn(result.target.id, 1)).toMatchObject({ok: true, damage: 6});
		expect(state.resolveChainedTargetTurn(result.target.id, 1)).toMatchObject({ok: true, damage: 0, alreadyResolved: true});
	});

	it("enforces chain occupancy, size, and reach", () => {
		const state = makeFury(3);
		expect(state.applyChainedTargetEffect({targetName: "Too far", distance: 16}).reason).toBe("out-of-range");
		expect(state.applyChainedTargetEffect({targetName: "Too big", size: "gargantuan", distance: 10}).reason).toBe("target-too-large");
		expect(state.applyChainedTargetEffect({targetName: "A", distance: 10}).ok).toBe(true);
		expect(state.applyChainedTargetEffect({targetName: "B", distance: 10}).ok).toBe(true);
		expect(state.applyChainedTargetEffect({targetName: "C", distance: 10}).reason).toBe("chain-capacity");
	});

	it("supports escape, release, and source teardown", () => {
		const state = makeFury(6);
		const target = state.createChainedTarget({targetName: "Bandit", distance: 10}).target;
		expect(state.escapeChainedTarget(target.id, 1)).toMatchObject({ok: false, escaped: false});
		expect(state.escapeChainedTarget(target.id, 30)).toMatchObject({ok: true, escaped: true});
		const second = state.createChainedTarget({targetName: "Cultist", distance: 10}).target;
		expect(state.getChainedTargets()).toHaveLength(2);
		expect(state.getChainedTargetState().used).toBe(1);
		state.deactivateState("rage");
		expect(state.getChainedTargets()).toHaveLength(0);
		expect(second).toBeDefined();
	});

	it("migrates malformed target entries and removes stale chain effects on load", () => {
		const state = makeFury(6);
		const json = state.toJson();
		json.targetEffects = [{id: "stale", source: "chained-fury", targetName: "Stale", size: "not-a-size"}];
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.getTargetEffects()).toHaveLength(1);
		expect(restored.getChainedTargetState().used).toBe(0);
	});

	it("resolves grapple and escape with either Strength or Dexterity against the live method DC", () => {
		const state = makeFury(6);
		const failed = state.applyChainedTargetEffect({
			targetName: "Dextrous target",
			distance: 10,
			grappleSaveAbility: "dex",
			grappleSaveTotal: state.getFeatureCalculations().chainGrappleDc,
		});
		expect(failed).toMatchObject({ok: true, grappled: false, grappleSaveSuccess: false});
		const target = state.createChainedTarget({targetName: "Escaper", distance: 10}).target;
		state.setAbilityBase("str", 20);
		expect(state.escapeChainedTarget(target.id, 15, {ability: "dex"})).toMatchObject({ok: false, escaped: false, dc: 16});
		expect(state.escapeChainedTarget(target.id, 16, {ability: "dex"})).toMatchObject({ok: true, escaped: true, ability: "dex"});
	});

	it("keeps shove-only records out of chain occupancy and validates the final shove distance", () => {
		const state = makeFury(10);
		const shove = state.applyChainedTargetEffect({targetName: "Shoved", distance: 10, effect: "shove", riderId: "chains-shove"});
		expect(shove).toMatchObject({ok: true, grappled: false});
		expect(state.getChainedTargetState().used).toBe(0);
		expect(state.applyChainedTargetEffect({
			targetName: "Control",
			distance: 20,
			effect: "control-shove",
			riderId: "chains-control-shove",
			shoveDistance: 10,
		})).toMatchObject({ok: false, reason: "shove-out-of-range", finalDistance: 30});
	});

	it("accounts for drag movement, doubled chain-only movement, and the level-14 exception", () => {
		const pre14 = makeFury(10);
		const target = pre14.createChainedTarget({targetName: "Large", size: "large", distance: 0}).target;
		expect(pre14.moveChainedTarget(target.id, 15)).toMatchObject({ok: true, movementCost: 30, dragMultiplier: 2});
		expect(pre14.moveChainedTarget(target.id, 25)).toMatchObject({ok: false, reason: "movement-exceeded"});
		const level14 = makeFury(14);
		const free = level14.createChainedTarget({targetName: "Huge", size: "huge", distance: 0}).target;
		expect(level14.moveChainedTarget(free.id, 30, {doubleMovement: true})).toMatchObject({ok: true, movementCost: 30, dragMultiplier: 1});
		expect(level14.resolveChainedTargetTurn(free.id, 1, {repeat: true})).toMatchObject({ok: false});
	});

	it("requires the canonical TGTT subclass/source and both active chain states", () => {
		const wrongSource = makeFury(6);
		wrongSource.getClasses()[0].subclass.source = "OTHER";
		expect(wrongSource.getFeatureCalculations().hasManifestChains).toBeFalsy();
		expect(wrongSource.activateState("manifestChains")).toBeNull();

		const state = makeFury(6);
		state.deactivateState("rage");
		expect(state.getFeatureGrantedAttacks()).toEqual([]);
		expect(state.applyChainedTargetEffect({targetName: "No rage", distance: 5}).reason).toBe("chains-inactive");
	});

	it("persists target-only hits without consuming a chain and rejects unavailable riders", () => {
		const state = makeFury(3);
		const tracked = state.applyChainedTargetEffect({targetName: "Tracked", distance: 10, effect: "target"});
		expect(tracked).toMatchObject({ok: true, grappled: false, restrained: false});
		expect(state.getChainedTargetState().used).toBe(0);
		expect(state.applyTargetEffect({
			source: "chained-fury",
			targetEffect: {source: "chained-fury", effect: "target"},
			riderId: "target-only",
			targetName: "Tracked through dispatcher",
			distance: 5,
		})).toMatchObject({ok: true, target: {grappled: false, restrained: false}});
		expect(state.applyChainedTargetEffect({targetName: "Illegal", distance: 10, effect: "restrain"}).reason).toBe("effect-unavailable");
	});

	it("rejects mismatched rider/effect metadata instead of bypassing level gates", () => {
		const state = makeFury(3);
		expect(state.applyTargetEffect({
			source: "chained-fury",
			targetName: "Mismatched",
			effect: "grapple",
			riderId: "chains-control-shove",
			distance: 10,
		})).toMatchObject({ok: false, reason: "effect-metadata-mismatch"});
		expect(state.applyTargetEffect({
			source: "chained-fury",
			targetEffect: {source: "chained-fury", effect: "control-shove"},
			targetName: "Nested mismatch",
			effect: "grapple",
			distance: 10,
		})).toMatchObject({ok: false, reason: "effect-metadata-mismatch"});
	});

	it("keeps ordinary grapples unrestrained and without recurring damage", () => {
		const state = makeFury(6);
		const result = state.applyTargetEffect({
			source: "chained-fury",
			targetName: "Grappled",
			effect: "grapple",
			riderId: "chains-grapple",
			distance: 10,
		});
		expect(result).toMatchObject({
			ok: true,
			grappled: true,
			restrained: false,
			target: {
				effects: {restraint: {active: false}},
				recurringDamage: null,
			},
		});
	});

	it("releases stale effects instead of clamping them and reconciles derived values/capacity", () => {
		const state = makeFury(14);
		const targets = [1, 2, 3, 4].map(i => state.createChainedTarget({targetName: `T${i}`, distance: 10}).target);
		expect(state.getChainedTargetState().used).toBe(4);
		state.getClasses()[0].level = 10;
		state.reconcileTargetEffects();
		expect(state.getChainedTargetState().used).toBe(2);
		expect(state.getChainedTargets().filter(t => t.restrained).length).toBe(0);

		const target = state.getChainedTargets()[0];
		state.upsertTargetEffect({id: target.id, distance: 999});
		state.reconcileTargetEffects();
		expect(state.getChainedTargets().find(t => t.id === target.id)).toMatchObject({grappled: false, chainIndex: null});
	});

	it("uses one doubled movement pool across multiple moves and releases out-of-range moves", () => {
		const state = makeFury(14);
		const target = state.createChainedTarget({targetName: "Mover", distance: 0}).target;
		expect(state.moveChainedTarget(target.id, 25, {doubleMovement: true})).toMatchObject({ok: true});
		expect(state.moveChainedTarget(target.id, 30)).toMatchObject({ok: true});
		const released = state.moveChainedTarget(target.id, 31);
		expect(released).toMatchObject({ok: false, released: true, reason: "out-of-range-released"});
		expect(state.getChainedTargets().find(t => t.id === target.id)).toMatchObject({grappled: false, chainIndex: null});
	});

	it("does not consume doubled movement or bonus action when validation fails", () => {
		const state = makeFury(10);
		state.setSpeed("walk", 5);
		const target = state.createChainedTarget({targetName: "Transactional", distance: 0}).target;
		const before = state.getChainedMovementState();
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
		expect(state.moveChainedTarget(target.id, 20, {doubleMovement: true})).toMatchObject({ok: false, reason: "movement-exceeded"});
		expect(state.getChainedMovementState()).toMatchObject(before);
		expect(state.isActionTypeAvailable("bonus")).toBe(true);
	});

	it("shares bonus-action usage with movement across a new round boundary", () => {
		const state = makeFury(14);
		const target = state.createChainedTarget({targetName: "Shared economy", distance: 0}).target;
		expect(state.consumeActionType("bonus")).toBe(true);
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(state.moveChainedTarget(target.id, 10, {doubleMovement: true})).toMatchObject({ok: false, reason: "bonus-action-used"});
		expect(state.getChainedMovementState()).toMatchObject({doubled: false, used: 0});
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
	});

	it("restores one action slot without restoring unrelated slots", () => {
		const state = makeFury(6);
		state.consumeActionType("action");
		state.consumeActionType("bonus");
		state.consumeActionType("reaction");

		expect(state.restoreActionType("bonus")).toBe(true);
		expect(state.getActionEconomyState()).toEqual({action: false, bonus: true, reaction: false});
	});

	it("accepts and validates Chain Control's declared final position and direction", () => {
		const state = makeFury(10);
		expect(state.applyChainedTargetEffect({
			targetName: "Control",
			distance: 20,
			effect: "control-shove",
			riderId: "chains-control-shove",
			shoveDistance: 10,
			finalDistance: 10,
			shoveDirection: "toward",
		})).toMatchObject({ok: true, finalDistance: 10, shoveDirection: "toward"});
		expect(state.applyChainedTargetEffect({
			targetName: "Too far",
			distance: 20,
			effect: "control-shove",
			riderId: "chains-control-shove",
			finalDistance: 26,
			shoveDirection: "away",
		})).toMatchObject({ok: false, reason: "shove-out-of-range"});
	});

	it("does not apply Chain Control when the initial grapple save succeeds", () => {
		const state = makeFury(10);
		const result = state.applyTargetEffect({
			source: "chained-fury",
			targetName: "Resisted control",
			effect: "control-shove",
			riderId: "chains-control-shove",
			distance: 10,
			grappleSaveAbility: "str",
			grappleSaveTotal: state.getFeatureCalculations().chainGrappleDc,
			finalDistance: 20,
			shoveDirection: "away",
		});
		expect(result).toMatchObject({ok: true, grappled: false, shoved: false, controlApplied: false});
		expect(result.target).toMatchObject({grappled: false, shoved: false, chainIndex: null});
	});
});
