/**
 * Phase 6.5: Exhaustion is reflected in the EFFECTIVE side of every
 * d20-roll breakdown (saves, skills, ability checks, initiative, spell
 * attacks) but NEVER in the CANONICAL side. Spell DC is intentionally
 * untouched — DCs are targets, not d20 rolls the character makes.
 *
 * These tests guard against:
 *   - Adding exhaustion to canonical (would break the "intrinsic build"
 *     contract of the dual display).
 *   - Forgetting to add exhaustion to a breakdown (the original bug,
 *     where the parenthetical "effective" value matched canonical
 *     even when the character was exhausted).
 *   - Adding exhaustion to spell DC (would mis-display the target
 *     number that other creatures roll against).
 *
 * Roll-handler double-subtraction guard: roll handlers subtract the
 * state-owned `_getExhaustionD20Penalty()` once at roll time. They do
 * NOT consume `breakdown.total`, so adding the same penalty to the
 * effective breakdown only affects DISPLAY.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const findComp = (breakdown, type) => breakdown.components.find(c => c.type === type);
const findExhaustion = (breakdown) => breakdown.components.find(c => c.name === "Exhaustion");

describe("CharacterSheetExhaustionBreakdown — Phase 6.5", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("ruleset magnitude stays identical across breakdowns", () => {
		test.each([
			["2024", 1, 2],
			["2024", 2, 4],
			["2024", 3, 6],
			["thelemar", 1, 1],
			["thelemar", 2, 2],
			["thelemar", 3, 3],
			["2014", 1, 0],
			["2014", 2, 0],
			["2014", 3, 0],
		])("%s exhaustion %i displays the applied -%i penalty", (rules, level, expectedPenalty) => {
			state.setExhaustionRules(rules);
			state.setExhaustion(level);
			state._data.spellcasting.ability = "int";
			state._data.customSkills.push({name: "Sailing", isLoreSkill: true, bonus: 3});

			const breakdowns = [
				state.getSaveBreakdown("dex"),
				state.getSkillBreakdown("stealth"),
				state.getSkillBreakdown("sailing"),
				state.getAbilityCheckBreakdown("cha"),
				state.getInitiativeBreakdown(),
				state.getSpellAttackBreakdown(),
			];

			expect(state._getExhaustionD20Penalty()).toBe(expectedPenalty);
			for (const breakdown of breakdowns) {
				const exhaustion = findExhaustion(breakdown);
				if (expectedPenalty === 0) {
					expect(exhaustion).toBeUndefined();
					expect(breakdown.total).toBe(breakdown.components.reduce((sum, component) => sum + component.value, 0));
				} else {
					expect(exhaustion?.value).toBe(-expectedPenalty);
					expect(breakdown.total).toBe(breakdown.canonical - expectedPenalty);
				}
			}
		});
	});

	// ─── getSaveBreakdown ─────────────────────────────────────

	describe("getSaveBreakdown", () => {
		it("at exhaustion 0 has no exhaustion component", () => {
			state._data.abilities.dex = 16; // +3
			state._data.exhaustion = 0;
			const breakdown = state.getSaveBreakdown("dex");
			expect(findExhaustion(breakdown)).toBeUndefined();
			expect(breakdown.total).toBe(3);
			expect(breakdown.canonical).toBe(3);
		});

		it("at exhaustion 3 effective drops but canonical does not", () => {
			state._data.abilities.dex = 16; // +3
			state._data.exhaustion = 3;
			const breakdown = state.getSaveBreakdown("dex");
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(exh.value).toBeLessThan(0);
			expect(exh.isCanonical).toBe(false);
			expect(breakdown.canonical).toBe(3);
			expect(breakdown.total).toBe(3 + exh.value);
		});

		it("exhaustion stacks with custom mod on effective; canonical untouched", () => {
			state._data.abilities.wis = 14; // +2
			state._data.customModifiers.savingThrows.wis = 1;
			state._data.exhaustion = 2;
			const breakdown = state.getSaveBreakdown("wis");
			const exh = findExhaustion(breakdown);
			expect(breakdown.canonical).toBe(2);
			expect(breakdown.total).toBe(2 + 1 + exh.value);
		});
	});

	// ─── getSkillBreakdown ────────────────────────────────────

	describe("getSkillBreakdown", () => {
		it("at exhaustion 0 has no exhaustion component", () => {
			state._data.abilities.dex = 14;
			state._data.exhaustion = 0;
			const breakdown = state.getSkillBreakdown("stealth");
			expect(findExhaustion(breakdown)).toBeUndefined();
		});

		it("at exhaustion 1 effective drops, canonical unchanged", () => {
			state._data.abilities.dex = 14; // +2
			state._data.exhaustion = 1;
			const breakdown = state.getSkillBreakdown("stealth");
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(exh.isCanonical).toBe(false);
			expect(breakdown.canonical).toBe(2);
			expect(breakdown.total).toBe(2 + exh.value);
		});

		it("lore-skill path also subtracts exhaustion on effective", () => {
			state._data.exhaustion = 2;
			state._data.customSkills = state._data.customSkills || [];
			state._data.customSkills.push({name: "Sailing", isLoreSkill: true, bonus: 3});
			const breakdown = state.getSkillBreakdown("sailing");
			expect(breakdown).toBeTruthy();
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(exh.isCanonical).toBe(false);
			expect(breakdown.total).toBeLessThan(breakdown.canonical);
		});
	});

	// ─── getAbilityCheckBreakdown (new in 6.5) ────────────────

	describe("getAbilityCheckBreakdown", () => {
		it("returns a valid breakdown shape at exhaustion 0", () => {
			state._data.abilities.cha = 16; // +3
			state._data.exhaustion = 0;
			const breakdown = state.getAbilityCheckBreakdown("cha");
			expect(breakdown).toBeTruthy();
			expect(breakdown.total).toBe(3);
			expect(breakdown.canonical).toBe(3);
			expect(findExhaustion(breakdown)).toBeUndefined();
		});

		it("at exhaustion 4 effective drops, canonical pure ability mod", () => {
			state._data.abilities.cha = 18; // +4
			state._data.exhaustion = 4;
			const breakdown = state.getAbilityCheckBreakdown("cha");
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(exh.isCanonical).toBe(false);
			expect(breakdown.canonical).toBe(4);
			expect(breakdown.total).toBe(4 + exh.value);
		});

		it("includes ability-check custom mod on effective only", () => {
			state._data.abilities.str = 14; // +2
			state._data.customModifiers.abilityChecks = state._data.customModifiers.abilityChecks || {};
			state._data.customModifiers.abilityChecks.str = 2;
			state._data.exhaustion = 0;
			const breakdown = state.getAbilityCheckBreakdown("str");
			expect(breakdown.canonical).toBe(2);
			expect(breakdown.total).toBe(2 + 2);
			const custom = findComp(breakdown, "custom");
			expect(custom).toBeTruthy();
			expect(custom.isCanonical).toBe(false);
		});
	});

	// ─── getInitiativeBreakdown ───────────────────────────────

	describe("getInitiativeBreakdown", () => {
		it("at exhaustion 0 has no exhaustion component", () => {
			state._data.abilities.dex = 14;
			state._data.exhaustion = 0;
			const breakdown = state.getInitiativeBreakdown();
			expect(findExhaustion(breakdown)).toBeUndefined();
		});

		it("at exhaustion 2 effective drops, canonical unchanged", () => {
			state._data.abilities.dex = 14; // +2
			state._data.exhaustion = 2;
			const breakdown = state.getInitiativeBreakdown();
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(breakdown.canonical).toBe(2);
			expect(breakdown.total).toBe(2 + exh.value);
		});
	});

	// ─── getSpellAttackBreakdown ──────────────────────────────

	describe("getSpellAttackBreakdown", () => {
		it("at exhaustion 0 has no exhaustion component", () => {
			state._data.spellcasting = state._data.spellcasting || {};
			state._data.spellcasting.ability = "int";
			state._data.exhaustion = 0;
			const breakdown = state.getSpellAttackBreakdown();
			expect(breakdown).toBeTruthy();
			expect(findExhaustion(breakdown)).toBeUndefined();
		});

		it("at exhaustion >= 1 effective drops, canonical unchanged", () => {
			state._data.spellcasting = state._data.spellcasting || {};
			state._data.spellcasting.ability = "int";
			state._data.abilities.int = 16; // +3
			state._data.exhaustion = 2;
			const breakdown = state.getSpellAttackBreakdown();
			expect(breakdown).toBeTruthy();
			const exh = findExhaustion(breakdown);
			expect(exh).toBeTruthy();
			expect(exh.value).toBeLessThan(0);
			expect(exh.isCanonical).toBe(false);
			expect(breakdown.canonical).toBe(3 + state.getProficiencyBonus());
			expect(breakdown.total).toBe(breakdown.canonical + exh.value);
		});
	});

	// ─── Regression guard: spell DC is NOT affected ───────────

	describe("getSpellDcBreakdown — exhaustion guard", () => {
		it("spell DC does NOT include exhaustion (DC is the target, not a roll)", () => {
			state._data.spellcasting = state._data.spellcasting || {};
			state._data.spellcasting.ability = "wis";
			state._data.exhaustion = 3;
			const breakdown = state.getSpellDcBreakdown();
			expect(breakdown).toBeTruthy();
			expect(findExhaustion(breakdown)).toBeUndefined();
		});
	});
});
