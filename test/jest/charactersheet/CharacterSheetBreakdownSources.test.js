/**
 * Breakdown helpers must attribute bonuses to their SOURCE feature, not a
 * generic lump:
 *  - Bug R26 #4: a dynamic (abilityMod-based) skill feature bonus (e.g. Magician)
 *    must surface in getSkillBreakdown() with the feature's own NAME instead of a
 *    hardcoded "Feature Bonus" line.
 *  - Bug R26 #5: an additive ability-score bonus from a named feature (e.g.
 *    "Pan's Apostle") must surface in getAbilityBonusBreakdown() under that name
 *    instead of a generic "Custom Modifier" line.
 *
 * Both assert component/contribution NAMES (not just totals) and preserve the
 * canonical total/sum invariants.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("getSkillBreakdown — dynamic feature bonus attribution (Bug #4)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("labels a Magician-style abilityMod skill bonus with its feature name, not 'Feature Bonus'", () => {
		state.setAbilityBase("wis", 16); // WIS mod +3
		// Magician (Primal Order): add WIS mod to Arcana, minimum +1.
		state.addNamedModifier({name: "Magician", type: "skill:arcana", abilityMod: "wis", minValue: 1});

		const bd = state.getSkillBreakdown("arcana");
		const feature = bd.components.find(c => c.type === "feature");
		expect(feature).toBeDefined();
		expect(feature.name).toBe("Magician");
		expect(feature.value).toBe(3);
		// No generic placeholder label remains.
		expect(bd.components.some(c => c.name === "Feature Bonus")).toBe(false);
		// Canonical total still equals the rolled modifier.
		expect(bd.total).toBe(state.getSkillMod("arcana"));
	});

	it("respects the abilityMod floor (min +1) and still names the source", () => {
		state.setAbilityBase("wis", 8); // WIS mod -1, floored to +1
		state.addNamedModifier({name: "Magician", type: "skill:nature", abilityMod: "wis", minValue: 1});

		const bd = state.getSkillBreakdown("nature");
		const feature = bd.components.find(c => c.name === "Magician");
		expect(feature).toBeDefined();
		expect(feature.value).toBe(1);
		expect(bd.total).toBe(state.getSkillMod("nature"));
	});

	it("itemizes multiple contributing features separately and keeps total === getSkillMod", () => {
		state.setAbilityBase("wis", 14); // +2
		state.setAbilityBase("int", 18); // +4
		state.addNamedModifier({name: "Magician", type: "skill:arcana", abilityMod: "wis", minValue: 1});
		state.addNamedModifier({name: "Keen Mind", type: "skill:arcana", abilityMod: "int"});

		const bd = state.getSkillBreakdown("arcana");
		const names = bd.components.filter(c => c.type === "feature").map(c => c.name).sort();
		expect(names).toEqual(["Keen Mind", "Magician"]);
		expect(bd.total).toBe(state.getSkillMod("arcana"));
	});
});

describe("getAbilityBonusBreakdown — named-source attribution (Bug #5)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	const sumAmounts = (c) => c.reduce((acc, x) => acc + x.amount, 0);

	it("labels an additive ability bonus with its source feature name, not 'Custom Modifier'", () => {
		state.setAbilityBase("cha", 15);
		state.addNamedModifier({name: "Pan's Apostle", type: "ability:cha", value: 2});

		const bd = state.getAbilityBonusBreakdown("cha");
		expect(bd.total).toBe(state.getAbilityScore("cha"));
		expect(bd.total).toBe(17);
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);

		const named = bd.contributions.find(c => c.label === "Pan's Apostle");
		expect(named).toBeDefined();
		expect(named).toMatchObject({source: "custom", amount: 2});
		// No generic placeholder remains when every feature point is attributed.
		expect(bd.contributions.some(c => c.label === "Custom Modifier")).toBe(false);
	});

	it("itemizes multiple named ability sources and preserves the sum invariant", () => {
		state.setAbilityBase("wis", 12);
		state.addNamedModifier({name: "Pan's Apostle", type: "ability:wis", value: 2});
		state.addNamedModifier({name: "Blessing of the Moon", type: "ability:wis", value: 1});

		const bd = state.getAbilityBonusBreakdown("wis");
		expect(bd.total).toBe(15);
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		const labels = bd.contributions.filter(c => c.source === "custom").map(c => c.label).sort();
		expect(labels).toEqual(["Blessing of the Moon", "Pan's Apostle"]);
	});

	it("keeps a residual 'Custom Modifier' line for directly-set feature points with no named source", () => {
		state.setAbilityBase("str", 14);
		// Directly-set additive feature channel (no backing named modifier).
		state._data.customModifiers.abilityScores = {str: 1};

		const bd = state.getAbilityBonusBreakdown("str");
		expect(sumAmounts(bd.contributions)).toBe(bd.bonus);
		const residual = bd.contributions.find(c => c.source === "custom");
		expect(residual).toMatchObject({label: "Custom Modifier", amount: 1});
	});
});
