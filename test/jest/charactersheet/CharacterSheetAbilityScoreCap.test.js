/**
 * Ability Score Cap Tests
 *
 * Verifies the opt-in ability score maximum enforcement feature.
 * When `enforceAbilityScoreCap` is enabled, ability scores are capped at
 * 20 by default, with per-ability overrides and auto-raising for features
 * like Primal Champion.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Ability Score Cap", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// DEFAULT BEHAVIOR — cap disabled
	// =========================================================================
	describe("when enforceAbilityScoreCap is disabled (default)", () => {
		it("should not cap ability scores at 20", () => {
			state.setAbilityBase("str", 22);
			expect(state.getAbilityScore("str")).toBe(22);
		});

		it("should allow scores above 20 with bonuses", () => {
			state.setAbilityBase("str", 18);
			state.addAbilityBonus("str", 6);
			expect(state.getAbilityScore("str")).toBe(24);
		});

		it("should allow extreme scores (deity-level)", () => {
			state.setAbilityBase("str", 30);
			expect(state.getAbilityScore("str")).toBe(30);
		});

		it("getAbilityScoreMaximum should return null", () => {
			expect(state.getAbilityScoreMaximum("str")).toBeNull();
		});
	});

	// =========================================================================
	// CAP ENABLED — default max 20
	// =========================================================================
	describe("when enforceAbilityScoreCap is enabled", () => {
		beforeEach(() => {
			state.setSetting("enforceAbilityScoreCap", true);
		});

		it("should cap ability scores at 20", () => {
			state.setAbilityBase("str", 22);
			expect(state.getAbilityScore("str")).toBe(20);
		});

		it("should cap scores with bonuses at 20", () => {
			state.setAbilityBase("str", 18);
			state.addAbilityBonus("str", 6);
			expect(state.getAbilityScore("str")).toBe(20);
		});

		it("should not affect scores already at or below 20", () => {
			state.setAbilityBase("str", 16);
			expect(state.getAbilityScore("str")).toBe(16);
		});

		it("should cap all six abilities independently", () => {
			const abilities = ["str", "dex", "con", "int", "wis", "cha"];
			abilities.forEach(ability => {
				state.setAbilityBase(ability, 25);
			});
			abilities.forEach(ability => {
				expect(state.getAbilityScore(ability)).toBe(20);
			});
		});

		it("getAbilityScoreMaximum should return 20 by default", () => {
			expect(state.getAbilityScoreMaximum("str")).toBe(20);
		});
	});

	// =========================================================================
	// PER-ABILITY MAXIMUMS
	// =========================================================================
	describe("per-ability maximum overrides", () => {
		beforeEach(() => {
			state.setSetting("enforceAbilityScoreCap", true);
		});

		it("should respect per-ability maximum override", () => {
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityBase("str", 22);
			expect(state.getAbilityScore("str")).toBe(22);
		});

		it("should cap at per-ability maximum", () => {
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityBase("str", 26);
			expect(state.getAbilityScore("str")).toBe(24);
		});

		it("should not affect other abilities", () => {
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityBase("str", 22);
			state.setAbilityBase("dex", 22);
			expect(state.getAbilityScore("str")).toBe(22);
			expect(state.getAbilityScore("dex")).toBe(20); // default cap
		});

		it("should remove override when set to null", () => {
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityScoreMaximum("str", null);
			state.setAbilityBase("str", 22);
			expect(state.getAbilityScore("str")).toBe(20);
		});

		it("getAbilityScoreMaximum should return override value", () => {
			state.setAbilityScoreMaximum("str", 24);
			expect(state.getAbilityScoreMaximum("str")).toBe(24);
		});
	});

	// =========================================================================
	// PRIMAL CHAMPION AUTO-RAISE
	// =========================================================================
	describe("Primal Champion auto-raises STR/CON cap to 24", () => {
		beforeEach(() => {
			state.setSetting("enforceAbilityScoreCap", true);
			state.addClass({name: "Barbarian", source: "PHB", level: 20});
		});

		it("should allow STR up to 24 with Primal Champion", () => {
			// Primal Champion adds +4, but the raw computed may also be capped at 24
			state.setAbilityBase("str", 18);
			const score = state.getAbilityScore("str");
			// Primal Champion: base 18 + 4 = 22, cap 24 → 22
			expect(score).toBe(22);
		});

		it("should allow CON up to 24 with Primal Champion", () => {
			state.setAbilityBase("con", 20);
			const score = state.getAbilityScore("con");
			// Primal Champion: base 20 + 4 = 24, cap 24 → 24
			expect(score).toBe(24);
		});

		it("should still cap STR at 24 with Primal Champion", () => {
			state.setAbilityBase("str", 22);
			state.addAbilityBonus("str", 4);
			const score = state.getAbilityScore("str");
			// base 22 + bonus 4 + PC +4 = 30, but PC min(30, 24) = 24, cap 24 → 24
			expect(score).toBe(24);
		});

		it("should not raise cap for DEX/INT/WIS/CHA", () => {
			state.setAbilityBase("dex", 22);
			expect(state.getAbilityScore("dex")).toBe(20);
			state.setAbilityBase("int", 22);
			expect(state.getAbilityScore("int")).toBe(20);
		});

		it("manual override should take precedence over Primal Champion auto-raise", () => {
			state.setAbilityScoreMaximum("str", 30);
			state.setAbilityBase("str", 20);
			// Primal Champion: base 20 + 4 = 24, min(24, 24) = 24
			// Cap: min(24, 30) = 24 (perAbilityMax is 30, but computed is 24)
			expect(state.getAbilityScore("str")).toBe(24);
		});
	});

	// =========================================================================
	// ITEM OVERRIDES
	// =========================================================================
	describe("interaction with item ability overrides", () => {
		beforeEach(() => {
			state.setSetting("enforceAbilityScoreCap", true);
		});

		it("item static override should be capped", () => {
			state.setAbilityBase("str", 10);
			if (!state._data.itemAbilityOverrides) state._data.itemAbilityOverrides = {};
			if (!state._data.itemAbilityOverrides.static) state._data.itemAbilityOverrides.static = {};
			state._data.itemAbilityOverrides.static.str = 25;
			// 25 > computed (10), so static kicks in, but cap is 20
			expect(state.getAbilityScore("str")).toBe(20);
		});

		it("item static override below cap should work normally", () => {
			state.setAbilityBase("str", 10);
			if (!state._data.itemAbilityOverrides) state._data.itemAbilityOverrides = {};
			if (!state._data.itemAbilityOverrides.static) state._data.itemAbilityOverrides.static = {};
			state._data.itemAbilityOverrides.static.str = 19;
			expect(state.getAbilityScore("str")).toBe(19);
		});

		it("item static override with per-ability max should respect the override", () => {
			state.setAbilityScoreMaximum("str", 29);
			state.setAbilityBase("str", 10);
			if (!state._data.itemAbilityOverrides) state._data.itemAbilityOverrides = {};
			if (!state._data.itemAbilityOverrides.static) state._data.itemAbilityOverrides.static = {};
			state._data.itemAbilityOverrides.static.str = 29; // Belt of Storm Giant STR
			expect(state.getAbilityScore("str")).toBe(29);
		});
	});

	// =========================================================================
	// increaseAbility RESPECTS CAP
	// =========================================================================
	describe("increaseAbility respects dynamic cap", () => {
		it("should clamp at cap when cap is enforced", () => {
			state.setSetting("enforceAbilityScoreCap", true);
			state.setAbilityBase("str", 19);
			state.increaseAbility("str", 2);
			expect(state.getAbilityBase("str")).toBe(20);
		});

		it("should use per-ability max for clamping", () => {
			state.setSetting("enforceAbilityScoreCap", true);
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityBase("str", 23);
			state.increaseAbility("str", 2);
			expect(state.getAbilityBase("str")).toBe(24);
		});

		it("should use default maxScore param when cap is not enforced", () => {
			state.setAbilityBase("str", 19);
			state.increaseAbility("str", 2, 20);
			expect(state.getAbilityBase("str")).toBe(20);
		});
	});

	// =========================================================================
	// SERIALIZATION / PERSISTENCE
	// =========================================================================
	describe("persistence", () => {
		it("should round-trip ability score cap setting via toJson/loadFromJson", () => {
			state.setSetting("enforceAbilityScoreCap", true);
			state.setAbilityScoreMaximum("str", 24);
			state.setAbilityScoreMaximum("con", 24);
			state.setAbilityBase("str", 22);

			const json = state.toJson();
			const state2 = new CharacterSheetState();
			state2.loadFromJson(json);

			expect(state2.getSettings().enforceAbilityScoreCap).toBe(true);
			expect(state2.getAbilityScore("str")).toBe(22);
		});

		it("should default to cap disabled for old saves without the setting", () => {
			const json = state.toJson();
			delete json.settings.enforceAbilityScoreCap;
			const state2 = new CharacterSheetState();
			state2.loadFromJson(json);
			// Should not cap
			state2.setAbilityBase("str", 25);
			expect(state2.getAbilityScore("str")).toBe(25);
		});
	});
});
