import "./setup.js";
import fs from "node:fs";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const GENERATED_CHAIN_ID = "tgtt-chained-fury:spectral-chains";

const makeFury = (level = 6, {tracking = false} = {}) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	for (const [featureLevel, name] of [[3, "Manifest Chains"], [6, "Chain Imprisonment"], [10, "Chain Control"], [14, "Unchained Fury"]]) {
		if (level >= featureLevel) state.addFeature({name, source: "TGTT", description: name});
	}
	state.activateState("rage");
	state.activateState("manifestChains");
	state.setChainedFuryTargetTrackingEnabled(tracking);
	return state;
};

const addGrappledTarget = (state, targetName = "Ogre", size = "medium") => state.applyChainedTargetEffect({
	targetName,
	size,
	effect: "grapple",
	riderId: "chains-grapple",
	grappleSaveFailed: true,
});

describe("Chained Fury optional target bookkeeping", () => {
	it("defaults off for new characters and legacy saves", () => {
		const fresh = makeFury(6);
		expect(fresh.isChainedFuryTargetTrackingEnabled()).toBe(false);
		expect(fresh.getSettings().chainedFuryTargetTracking).toBe(false);

		const legacyJson = fresh.toJson();
		delete legacyJson.settings.chainedFuryTargetTracking;
		legacyJson.targetEffects = [{
			id: "legacy-chain-target",
			source: "chained-fury",
			targetName: "Legacy target",
			grappled: true,
			chainIndex: 0,
			effects: {grapple: {active: true, ability: "str", dc: 15}},
		}];
		const restored = new CharacterSheetState();
		restored.loadFromJson(legacyJson);

		expect(restored.isChainedFuryTargetTrackingEnabled()).toBe(false);
		expect(restored.getChainedTargets()).toEqual([]);
		expect(restored.toJson().targetEffects).toEqual([]);
	});

	it("keeps every rider and the Spectral Chains attack usable while tracking is off", () => {
		const state = makeFury(10);
		const attacksBefore = state.getFeatureGrantedAttacks();
		const chainAttackBefore = attacksBefore.find(it => it.sourceFeature === "Manifest Chains");
		const optionsBefore = state.getFeatureCalculations().attackOnHitOptions;

		expect(chainAttackBefore).toBeDefined();
		expect(optionsBefore.map(it => it.id)).toEqual(expect.arrayContaining([
			"chains-grapple",
			"chains-shove",
			"chains-restrain",
			"chains-control-shove",
		]));
		expect(optionsBefore.every(it => !it.targetAware && !it.targetEffect)).toBe(true);
		expect(state.applyChainedTargetEffect({
			targetName: "No bookkeeping",
			effect: "grapple",
			riderId: "chains-grapple",
			grappleSaveFailed: true,
		})).toEqual({ok: false, reason: "tracking-disabled"});

		state.setChainedFuryTargetTrackingEnabled(true);
		const chainAttackAfter = state.getFeatureGrantedAttacks().find(it => it.sourceFeature === "Manifest Chains");
		const optionsAfter = state.getFeatureCalculations().attackOnHitOptions;

		expect(chainAttackAfter).toMatchObject({
			attackBonus: chainAttackBefore.attackBonus,
			damage: chainAttackBefore.damage,
			damageBonus: chainAttackBefore.damageBonus,
			range: chainAttackBefore.range,
		});
		expect(optionsAfter.map(it => it.id)).toEqual(optionsBefore.map(it => it.id));
		expect(optionsAfter.find(it => it.id === "chains-grapple")).toMatchObject({
			targetAware: true,
			targetEffect: {source: "chained-fury", effect: "grapple"},
		});
		expect(optionsAfter.find(it => it.id === "chains-shove").targetAware).toBeUndefined();
	});

	it("accounts for drag movement, doubled chain-only movement, and the level-14 exception", () => {
		const pre14 = makeFury(10, {tracking: true});
		const target = addGrappledTarget(pre14, "Large", "large").target;
		expect(pre14.moveChainedTarget(target.id, 15)).toMatchObject({
			ok: true,
			movementCost: 30,
			dragMultiplier: 2,
			movementReceipt: {source: "chained-fury:target-move", scope: "chained-fury", amount: 30},
		});
		expect(pre14.getMovementEconomyState()).toMatchObject({allowance: 30, used: 30, remaining: 0});
		expect(pre14.moveChainedTarget(target.id, 25)).toMatchObject({ok: false, reason: "movement-exceeded"});

		const level14 = makeFury(14, {tracking: true});
		const free = addGrappledTarget(level14, "Huge", "huge").target;
		expect(level14.moveChainedTarget(free.id, 30, {doubleMovement: true})).toMatchObject({ok: true, movementCost: 30, dragMultiplier: 1});
		expect(level14.getMovementEconomyState()).toMatchObject({allowance: 30, used: 30, remaining: 0});
		expect(level14.getChainedMovementState()).toMatchObject({allowance: 60, used: 30, remaining: 30, doubled: true});
		expect(level14.resolveChainedTargetTurn(free.id, 1, {repeat: true})).toMatchObject({ok: false});
	});

	it("requires explicit save outcomes and never treats missing input as a failed save", () => {
		const state = makeFury(6, {tracking: true});

		expect(state.applyChainedTargetEffect({
			targetName: "Ambiguous",
			effect: "grapple",
			riderId: "chains-grapple",
		})).toEqual({ok: false, reason: "outcome-required", outcome: "grapple"});
		expect(state.applyChainedTargetEffect({
			targetName: "Resisted",
			effect: "grapple",
			riderId: "chains-grapple",
			grappleSaveFailed: false,
		})).toMatchObject({
			ok: true,
			tracked: false,
			target: null,
			grappled: false,
			grappleSaveSuccess: true,
			grappleSaveFailed: false,
		});
		expect(state.getChainedTargets()).toEqual([]);
	});

	it("records only successful grapples with a human name and explicit condition state", () => {
		const state = makeFury(6, {tracking: true});

		expect(state.applyChainedTargetEffect({
			effect: "grapple",
			riderId: "chains-grapple",
			grappleSaveFailed: true,
		})).toEqual({ok: false, reason: "target-name-required"});

		const result = addGrappledTarget(state, "Ogre");
		expect(result).toMatchObject({
			ok: true,
			tracked: true,
			grappled: true,
			restrained: false,
			grappleSaveSuccess: false,
			grappleSaveFailed: true,
			target: {
				targetName: "Ogre",
				effectType: "grapple",
				grappled: true,
				restrained: false,
				shoved: false,
				recurringDamage: null,
				effects: {
					grapple: {active: true},
					restraint: {active: false},
				},
			},
		});
		expect(state.getChainedTargetState()).toMatchObject({trackingEnabled: true, capacity: 2, used: 1, availableChains: 1});
	});

	it("records Chain Imprisonment only after both saves are resolved", () => {
		const state = makeFury(6, {tracking: true});
		expect(state.applyChainedTargetEffect({
			targetName: "Ogre",
			effect: "restrain",
			riderId: "chains-restrain",
			grappleSaveFailed: true,
		})).toEqual({ok: false, reason: "outcome-required", outcome: "restraint"});

		const grappleOnly = state.applyChainedTargetEffect({
			targetName: "Veteran",
			effect: "restrain",
			riderId: "chains-restrain",
			grappleSaveFailed: true,
			restraintSaveFailed: false,
		});
		expect(grappleOnly).toMatchObject({
			ok: true,
			grappled: true,
			restrained: false,
			restraintSaveSuccess: true,
			restraintSaveFailed: false,
			target: {effectType: "grapple", recurringDamage: null},
		});

		const restrained = state.applyChainedTargetEffect({
			targetName: "Ogre",
			effect: "restrain",
			riderId: "chains-restrain",
			grappleSaveFailed: true,
			restraintSaveFailed: true,
		});
		expect(restrained).toMatchObject({
			ok: true,
			grappled: true,
			restrained: true,
			restraintSaveSuccess: false,
			restraintSaveFailed: true,
			target: {
				effectType: "restrain",
				recurringDamage: {amount: 6, type: "force", when: "start of each of its turns"},
			},
		});
		expect(state.resolveChainedTargetTurn(restrained.target.id, 1)).toMatchObject({ok: true, damage: 6});
		expect(state.resolveChainedTargetTurn(restrained.target.id, 1)).toMatchObject({ok: true, damage: 0, alreadyResolved: true});
	});

	it("keeps ordinary shove reminder-only and records Chain Control only after a failed grapple save", () => {
		const state = makeFury(10, {tracking: true});
		expect(state.applyChainedTargetEffect({
			targetName: "Shoved",
			effect: "shove",
			riderId: "chains-shove",
		})).toMatchObject({ok: true, tracked: false, target: null, shoved: true});
		expect(state.getChainedTargets()).toEqual([]);

		expect(state.applyChainedTargetEffect({
			targetName: "Resisted control",
			effect: "control-shove",
			riderId: "chains-control-shove",
			grappleSaveFailed: false,
		})).toMatchObject({ok: true, tracked: false, target: null, controlApplied: false});

		const controlled = state.applyChainedTargetEffect({
			targetName: "Controlled",
			effect: "control-shove",
			riderId: "chains-control-shove",
			grappleSaveFailed: true,
		});
		expect(controlled).toMatchObject({
			ok: true,
			tracked: true,
			grappled: true,
			controlApplied: true,
			shoveDistance: 10,
			target: {targetName: "Controlled", effectType: "grapple", shoved: false},
		});
	});

	it("supports the authored two-to-four chain capacity without target occupancy controls", () => {
		const level3 = makeFury(3, {tracking: true});
		expect(addGrappledTarget(level3, "A").ok).toBe(true);
		expect(addGrappledTarget(level3, "B").ok).toBe(true);
		expect(addGrappledTarget(level3, "C")).toEqual({ok: false, reason: "chain-capacity"});
		expect(level3.applyChainedTargetEffect({
			effect: "grapple",
			riderId: "chains-grapple",
			grappleSaveFailed: false,
		})).toMatchObject({ok: true, tracked: false, grappleSaveSuccess: true});
		expect(level3.getChainedTargetState()).toMatchObject({capacity: 2, used: 2, availableChains: 0});

		const level14 = makeFury(14, {tracking: true});
		for (const targetName of ["A", "B", "C", "D"]) expect(addGrappledTarget(level14, targetName).ok).toBe(true);
		expect(addGrappledTarget(level14, "E")).toEqual({ok: false, reason: "chain-capacity"});
		expect(level14.getChainedTargetState()).toMatchObject({capacity: 4, used: 4, availableChains: 0});
	});

	it("preserves an opted-in tracker and targets across save/load", () => {
		const state = makeFury(6, {tracking: true});
		const target = state.applyChainedTargetEffect({
			targetName: "Saved target",
			effect: "restrain",
			riderId: "chains-restrain",
			grappleSaveFailed: true,
			restraintSaveFailed: true,
		}).target;

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());

		expect(restored.isChainedFuryTargetTrackingEnabled()).toBe(true);
		expect(restored.getChainedTargets()).toEqual([expect.objectContaining({
			id: target.id,
			targetName: "Saved target",
			grappled: true,
			restrained: true,
		})]);
	});

	it.each([
		["tracking is disabled", state => state.setChainedFuryTargetTrackingEnabled(false)],
		["Rage ends", state => state.deactivateState("rage")],
		["Manifest Chains ends", state => state.deactivateState("manifestChains")],
		["the generated chains are unequipped", state => {
			const item = state.getItems().find(it => it._generatedItemId === GENERATED_CHAIN_ID);
			state.setItemEquipped(item.id, false);
		}],
		["the subclass becomes illegal", state => state.setSubclass("Barbarian", {name: "Path of the Juggernaut", shortName: "Juggernaut", source: "TGTT"})],
	])("clears targets and legacy movement when %s", (_label, mutate) => {
		const state = makeFury(6, {tracking: true});
		expect(addGrappledTarget(state).ok).toBe(true);
		state._data.chainedMovementUsage = {round: 2, movementUsed: 20, bonusActionUsed: true, doubled: true};

		mutate(state);

		expect(state._data.targetEffects.filter(it => it.source === "chained-fury")).toEqual([]);
		expect(state._data.chainedMovementUsage).toEqual({
			round: null,
			movementUsed: 0,
			bonusActionUsed: false,
			doubled: false,
		});
		expect(state.getChainedTargets()).toEqual([]);
		expect(state.getChainedMovementState()).toMatchObject({
			round: null,
			used: 0,
			doubled: false,
			bonusActionUsed: false,
		});
	});

	it("drops invalid loaded targets before serialization", () => {
		const state = makeFury(6, {tracking: true});
		expect(addGrappledTarget(state).ok).toBe(true);
		const chainItem = state.getItems().find(it => it._generatedItemId === GENERATED_CHAIN_ID);
		state._data.inventory.find(it => it.id === chainItem.id).equipped = false;

		expect(state.toJson().targetEffects).toEqual([]);
	});

	it("pins the grapple DC to the finalized spellcasting-aware Combat Method DC", () => {
		const state = makeFury(6);
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 10);
		state.setAbilityBase("cha", 20);
		state.addClass({
			name: "Warlock",
			source: "TGTT",
			level: 5,
			subclass: {name: "Hexblade", shortName: "Hexblade", source: "TGTT"},
		});
		state.addCombatTradition("Mirror's Glint");
		state.applyClassFeatureEffects();

		const calc = state.getFeatureCalculations();
		expect(calc.combatMethodDcUsesSpellcasting).toBe(true);
		expect(calc.combatMethodDc).toBe(calc.spellSaveDc);
		expect(calc.chainGrappleDc).toBe(calc.combatMethodDc);
		expect(calc.chainGrappleDc).toBeGreaterThan(8 + state.getProficiencyBonus());
	});

	it("keeps the level-14 movement benefit visible in player-facing rider copy", () => {
		const level10 = makeFury(10);
		const level14 = makeFury(14);
		const grapple10 = level10.getFeatureCalculations().attackOnHitOptions.find(it => it.id === "chains-grapple");
		const grapple14 = level14.getFeatureCalculations().attackOnHitOptions.find(it => it.id === "chains-grapple");

		expect(grapple10.description).toContain("spending your movement");
		expect(grapple14.description).toContain("without spending extra movement");
	});

	it("keeps Combat and Play Mode free of the removed VTT-style controls", () => {
		const combatSource = fs.readFileSync(new URL("../../../js/charactersheet/charactersheet-combat.js", import.meta.url), "utf8");
		const playModeSource = fs.readFileSync(new URL("../../../js/charactersheet/charactersheet-playmode.js", import.meta.url), "utf8");
		const html = fs.readFileSync(new URL("../../../charactersheet.html", import.meta.url), "utf8");
		const removedControls = [
			"Track target only",
			"data-target-size",
			"data-target-distance",
			"data-final-distance",
			"data-shove-direction",
			"data-escape-total",
			"data-double-movement",
		];

		for (const removed of removedControls) {
			expect(combatSource).not.toContain(removed);
			expect(playModeSource).not.toContain(removed);
		}
		expect(combatSource).toContain("Remember chained creatures");
		expect(playModeSource).toContain("Remember chained creatures");
		expect(combatSource).toContain("Did the creature fail its grapple save");
		expect(html).toContain("Spectral Chains");
	});
});
