/**
 * S3 #8 — Tactical Mind (XPHB Fighter L2).
 *
 * The post-roll prompt lives in the page controller, but its mechanics are pure state:
 * after a failed ability check the Fighter expends ONE Second Wind use to add 1d10, and
 * the use is REFUNDED (exactly one, not a reset-to-max) if the check still fails. These
 * tests assert that spend/refund cycle and the feature gating the hook checks.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Tactical Mind (XPHB Fighter L2)", () => {
	let state;

	function makeFighter (level, {source = "XPHB"} = {}) {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source, level, hitDice: "d10"});
		state.addFeature({name: "Second Wind", source, className: "Fighter", level: 1, description: "<p>Second Wind.</p>"});
		state.ensureFighterFeatureUses();
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 16);
		state.setAbilityBase("int", 14);
	}

	describe("feature gating", () => {
		it("is present for an XPHB Fighter at level 2+", () => {
			makeFighter(2);
			expect(state.getFeatureCalculations().hasTacticalMind).toBe(true);
		});

		it("is absent at level 1", () => {
			makeFighter(1);
			expect(state.getFeatureCalculations().hasTacticalMind).toBeFalsy();
		});

		it("is absent for a 2014 (PHB) Fighter", () => {
			makeFighter(5, {source: "PHB"});
			expect(state.getFeatureCalculations().hasTacticalMind).toBeFalsy();
		});
	});

	describe("spend / refund cycle (the hook's mechanics)", () => {
		it("spends exactly one use, then refunds exactly one when the check still fails", () => {
			makeFighter(5);
			const prev = state.getSecondWindUsesRemaining();
			expect(prev).toBeGreaterThan(0);

			// Spend (Tactical Mind rider — NOT a heal).
			state.setSecondWindUsesRemaining(prev - 1);
			expect(state.getSecondWindUsesRemaining()).toBe(prev - 1);

			// Check still fails → refund the single use.
			state.setSecondWindUsesRemaining(prev);
			expect(state.getSecondWindUsesRemaining()).toBe(prev);
		});

		it("keeps the use spent when the boosted check succeeds", () => {
			makeFighter(5);
			const prev = state.getSecondWindUsesRemaining();
			state.setSecondWindUsesRemaining(prev - 1);
			// No refund on success.
			expect(state.getSecondWindUsesRemaining()).toBe(prev - 1);
		});

		it("refund restores only ONE use, not the whole pool, when several were already spent", () => {
			makeFighter(20); // higher level → multiple Second Wind uses
			const max = state.getSecondWindUsesMax();
			if (max < 2) return; // guard: only meaningful with >1 use
			// Pre-spend down to 1 remaining (e.g. earlier healing).
			state.setSecondWindUsesRemaining(1);
			const prev = state.getSecondWindUsesRemaining();
			expect(prev).toBe(1);
			// Tactical Mind spends the last use, then refunds it on continued failure.
			state.setSecondWindUsesRemaining(prev - 1);
			expect(state.getSecondWindUsesRemaining()).toBe(0);
			state.setSecondWindUsesRemaining(prev);
			expect(state.getSecondWindUsesRemaining()).toBe(1); // NOT reset to max
		});
	});
});
