/**
 * CharacterSheetState.getAbilityBonusBreakdown — read-only per-source breakdown.
 *
 * Verifies the helper that powers the play-mode "Edit Ability Scores" modal:
 * every contribution is correctly labelled per source, and the contributions
 * always sum EXACTLY to (total - base) — the invariant the UI relies on.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const sumAmounts = (contributions) => contributions.reduce((acc, c) => acc + c.amount, 0);
const findBy = (contributions, source) => contributions.find(c => c.source === source);

describe("getAbilityBonusBreakdown", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("returns no contributions and zero bonus when only the base score is set", () => {
		state.setAbilityBase("str", 15);
		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.base).toBe(15);
		expect(bd.total).toBe(15);
		expect(bd.bonus).toBe(0);
		expect(bd.contributions).toEqual([]);
	});

	it("labels racial, item and custom-modifier bonuses per source and sums to the total bonus", () => {
		// Base 14 (e.g. includes an ASI baked into base).
		state.setAbilityBase("str", 14);
		// Racial / species bonus.
		state.setAbilityBonus("str", 2);
		// Custom modifier (additive).
		state._data.customModifiers.abilityScores = {str: 1};
		// Item bonus (e.g. Belt of Giant Strength-style additive).
		state._data.itemAbilityOverrides = {bonus: {str: 1}};

		const bd = state.getAbilityBonusBreakdown("str");

		expect(bd.base).toBe(14);
		expect(bd.total).toBe(state.getAbilityScore("str"));
		expect(bd.total).toBe(18); // 14 + 2 + 1 + 1
		expect(bd.bonus).toBe(4);

		// Invariant: contributions sum to the displayed bonus.
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);

		// Each source present with the right amount + label.
		expect(findBy(bd.contributions, "racial")).toMatchObject({label: "Racial", amount: 2});
		expect(findBy(bd.contributions, "custom")).toMatchObject({label: "Custom Modifier", amount: 1});
		expect(findBy(bd.contributions, "item")).toMatchObject({label: "Item", amount: 1});
		// No spurious sources.
		expect(bd.contributions.map(c => c.source).sort()).toEqual(["custom", "item", "racial"]);
	});

	it("labels a direct feat/feature bonus", () => {
		state.setAbilityBase("wis", 12);
		state.addAbilityBonus("wis", 2); // directAbilityBonuses channel
		const bd = state.getAbilityBonusBreakdown("wis");
		expect(bd.total).toBe(14);
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		expect(findBy(bd.contributions, "feat")).toMatchObject({label: "Feat / Feature", amount: 2});
	});

	it("attributes an item static override ('set score to X') as its own entry", () => {
		state.setAbilityBase("str", 10);
		state._data.itemAbilityOverrides = {static: {str: 19}}; // Gauntlets of Ogre Power style
		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.total).toBe(19);
		expect(bd.bonus).toBe(9);
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		expect(findBy(bd.contributions, "itemStatic")).toMatchObject({label: "Item (set score)", amount: 9});
	});

	it("omits a static override that is lower than the computed score", () => {
		state.setAbilityBase("str", 16);
		state._data.itemAbilityOverrides = {static: {str: 15}}; // 15 < 16 → no effect
		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.total).toBe(16);
		expect(bd.bonus).toBe(0);
		expect(bd.contributions).toEqual([]);
	});

	it("attributes Primal Champion (+4, clamped to 24 when cap not enforced) with exact amounts", () => {
		state._data.classes = [{name: "Barbarian", level: 20}];
		state.setAbilityBase("str", 20);

		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.total).toBe(state.getAbilityScore("str"));
		expect(bd.total).toBe(24); // 20 + 4, clamped to 24
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		expect(bd.contributions).toEqual([
			{source: "primalChampion", label: "Primal Champion", amount: 4},
		]);
		expect(findBy(bd.contributions, "other")).toBeUndefined();
	});

	it("applies an item additive bonus AFTER Primal Champion (mirrors getAbilityScore order)", () => {
		// Barbarian 20, CON 20, cap OFF, +2 item: Primal clamps to 24, THEN item → 26.
		state._data.classes = [{name: "Barbarian", level: 20}];
		state.setAbilityBase("con", 20);
		state._data.itemAbilityOverrides = {bonus: {con: 2}};

		const bd = state.getAbilityBonusBreakdown("con");
		expect(bd.total).toBe(state.getAbilityScore("con"));
		expect(bd.total).toBe(26);
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		// Honest attribution: Primal +4 then Item +2, NO leftover "Other" entry.
		expect(findBy(bd.contributions, "primalChampion")).toMatchObject({amount: 4});
		expect(findBy(bd.contributions, "item")).toMatchObject({label: "Item", amount: 2});
		expect(findBy(bd.contributions, "other")).toBeUndefined();
	});

	it("attributes an enforced cap as a negative adjustment while preserving the invariant", () => {
		state._data.classes = [{name: "Barbarian", level: 20}];
		state.setAbilityBase("str", 22);
		state._data.itemAbilityOverrides = {bonus: {str: 2}};
		state._data.settings = {...state._data.settings, enforceAbilityScoreCap: true};

		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.total).toBe(state.getAbilityScore("str"));
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		// No misleading "Other" entry — every stage is honestly labelled.
		expect(findBy(bd.contributions, "other")).toBeUndefined();
		expect(findBy(bd.contributions, "primalChampion")).toBeTruthy();
	});

	it("represents Wild Shape as a single replacement entry (even at zero delta)", () => {
		state.setAbilityBase("str", 10);
		// Stub the active wild-shape lookup with a beast whose STR matches base.
		state._getActiveWildShapeState = () => ({beastData: {abilities: {str: 10, dex: 12, con: 14}}});

		const bd = state.getAbilityBonusBreakdown("str");
		expect(bd.total).toBe(10);
		expect(bd.contributions).toHaveLength(1);
		expect(bd.contributions[0]).toMatchObject({source: "wildShape", label: "Wild Shape", amount: 0, isReplacement: true});

		const bdDex = state.getAbilityBonusBreakdown("dex");
		expect(bdDex.total).toBe(12);
		expect(sumAmounts(bdDex.contributions)).toBe(bdDex.bonus);
		expect(bdDex.contributions[0]).toMatchObject({source: "wildShape", isReplacement: true, amount: 2});
	});
});
