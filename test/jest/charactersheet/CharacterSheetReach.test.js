/**
 * Character Sheet Reach System - Unit Tests
 *
 * Exercises the canonical, declarative reach model:
 *   getReachContributions() -> getReachBonus() -> getMeleeReach()
 *   getAttackReach(attack, ctx)
 *
 * Verifies that every recognized contribution source (named modifier,
 * active-state effect, passive feature/feat registry modifier) feeds the single
 * resolver, that toggling/removing a contribution reverts, that reach-property
 * attacks reflect the character's reach, and that the value the Overview chip
 * renders (getMeleeReach) matches the resolver.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetState — Reach system", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("Base reach", () => {
		it("defaults to 5 ft with no contributions", () => {
			expect(state.getReachBonus()).toBe(0);
			expect(state.getMeleeReach()).toBe(5);
			expect(state.getReachContributions()).toEqual([]);
		});

		it("exposes base/property constants", () => {
			expect(CharacterSheetState.BASE_MELEE_REACH).toBe(5);
			expect(CharacterSheetState.REACH_PROPERTY_BONUS).toBe(5);
		});
	});

	describe("Named-modifier contributions", () => {
		it("a registered reach modifier increases resolved reach; disabling reverts", () => {
			const id = state.addNamedModifier({name: "Test Reach", type: "reach", value: 5, enabled: true});

			expect(state.getReachBonus()).toBe(5);
			expect(state.getMeleeReach()).toBe(10);
			const contrib = state.getReachContributions();
			expect(contrib).toContainEqual({source: "Test Reach", value: 5});

			// Disable -> reverts
			state.toggleNamedModifier(id);
			expect(state.getReachBonus()).toBe(0);
			expect(state.getMeleeReach()).toBe(5);
		});

		it("removing the modifier reverts reach", () => {
			const id = state.addNamedModifier({name: "Temp Reach", type: "reach", value: 10, enabled: true});
			expect(state.getMeleeReach()).toBe(15);
			state.removeNamedModifier(id);
			expect(state.getMeleeReach()).toBe(5);
		});

		it("floors effective reach at 0 for large negative modifiers", () => {
			state.addNamedModifier({name: "Shrink", type: "reach", value: -20, enabled: true});
			expect(state.getReachBonus()).toBe(-20);
			expect(state.getMeleeReach()).toBe(0);
		});
	});

	describe("Active-state contributions", () => {
		it("an active-state reach effect changes resolved reach; removing reverts", () => {
			const stateId = state.addActiveState("custom", {
				name: "Test Form",
				sourceFeatureId: "test-form",
				customEffects: [{type: "reach", value: 5}],
			});

			expect(state.getMeleeReach()).toBe(10);
			expect(state.getReachContributions()).toContainEqual({source: "Test Form", value: 5});

			state.removeActiveState(stateId);
			expect(state.getMeleeReach()).toBe(5);
		});

		it("accepts the {type:'bonus', target:'reach'} shape", () => {
			state.addActiveState("custom", {
				name: "Bonus Form",
				sourceFeatureId: "bonus-form",
				customEffects: [{type: "bonus", target: "reach", value: 5}],
			});
			expect(state.getMeleeReach()).toBe(10);
		});

		it("a deactivated state contributes nothing", () => {
			const stateId = state.addActiveState("custom", {
				name: "Off Form",
				sourceFeatureId: "off-form",
				customEffects: [{type: "reach", value: 5}],
			});
			expect(state.getMeleeReach()).toBe(10);
			state.toggleActiveState(stateId); // deactivate
			expect(state.getMeleeReach()).toBe(5);
		});
	});

	describe("Passive feature/feat registry contributions", () => {
		it("counts a registered passive reach modifier (Long-Limbed)", () => {
			// Long-Limbed registers {type:"modifier", modType:"reach:melee:bonus", value:5}
			state._data.features.push({name: "Long-Limbed"});
			expect(state.getReachBonus()).toBe(5);
			expect(state.getMeleeReach()).toBe(10);
			expect(state.getReachContributions()).toContainEqual({source: "Long-Limbed", value: 5});
		});

		it("ignores non-additive / unrelated registry modifiers", () => {
			// A feature whose registry effect is not a reach:*:bonus modifier
			state._data.features.push({name: "Evasion"});
			expect(state.getReachBonus()).toBe(0);
		});
	});

	describe("_isAdditiveReachModifier", () => {
		it("matches reach:*:bonus modifiers only", () => {
			expect(CharacterSheetState._isAdditiveReachModifier({type: "modifier", modType: "reach:melee:bonus"})).toBe(true);
			expect(CharacterSheetState._isAdditiveReachModifier({type: "modifier", modType: "reach:bonus"})).toBe(true);
			expect(CharacterSheetState._isAdditiveReachModifier({type: "modifier", modType: "reach:melee:set"})).toBe(false);
			expect(CharacterSheetState._isAdditiveReachModifier({type: "modifier", modType: "ac"})).toBe(false);
			expect(CharacterSheetState._isAdditiveReachModifier({type: "reach", value: 5})).toBe(false);
			expect(CharacterSheetState._isAdditiveReachModifier(null)).toBe(false);
		});
	});

	describe("Contribution aggregation", () => {
		it("sums every source and getReachBonus equals the contribution total", () => {
			state.addNamedModifier({name: "Mod", type: "reach", value: 5, enabled: true});
			state.addActiveState("custom", {name: "Form", sourceFeatureId: "f", customEffects: [{type: "reach", value: 5}]});
			state._data.features.push({name: "Long-Limbed"});

			const contributions = state.getReachContributions();
			const sum = contributions.reduce((t, c) => t + c.value, 0);
			expect(sum).toBe(15);
			expect(state.getReachBonus()).toBe(sum);
			expect(state.getMeleeReach()).toBe(CharacterSheetState.BASE_MELEE_REACH + sum);
		});

		it("Overview-rendered value (getMeleeReach) always equals base + resolver bonus", () => {
			state.addNamedModifier({name: "Mod", type: "reach", value: 5, enabled: true});
			expect(state.getMeleeReach()).toBe(CharacterSheetState.BASE_MELEE_REACH + state.getReachBonus());
		});
	});

	describe("getAttackReach", () => {
		it("returns character melee reach for a plain melee attack", () => {
			expect(state.getAttackReach({isMelee: true, properties: []})).toBe(5);
		});

		it("adds +5 for a weapon with the Reach property", () => {
			expect(state.getAttackReach({isMelee: true, properties: ["R"]})).toBe(10);
			expect(state.getAttackReach({isMelee: true, properties: ["R|XPHB"]})).toBe(10);
		});

		it("reflects an active reach bonus on the character", () => {
			state.addNamedModifier({name: "Reach", type: "reach", value: 5, enabled: true});
			expect(state.getAttackReach({isMelee: true, properties: []})).toBe(10); // 5 base + 5 bonus
			expect(state.getAttackReach({isMelee: true, properties: ["R"]})).toBe(15); // + Reach property
		});

		it("returns null for explicitly ranged attacks", () => {
			expect(state.getAttackReach({isMelee: false, range: "30/120 ft."})).toBeNull();
		});

		it("treats an attack with a non-thrown range string as melee when isMelee is unset", () => {
			expect(state.getAttackReach({range: "5 ft.", properties: []})).toBe(5);
		});

		it("honors a precomputed meleeReach context (skips recomputation)", () => {
			expect(state.getAttackReach({isMelee: true, properties: ["R"]}, {meleeReach: 20})).toBe(25);
		});

		it("returns null for a null attack", () => {
			expect(state.getAttackReach(null)).toBeNull();
		});
	});
});
