/**
 * Modifiers & Effects editor — shared helper contract (Bug #2).
 *
 * The custom-ITEM modal and the custom-ABILITY modal share one editor
 * (`CharacterSheetCustomAbilities.mountEffectsEditor`). The pure helpers backing its UX are
 * unit-tested here at the data level (jest runs in a `node` env with no DOM, so the rendered
 * editor itself can't be mounted). These pin:
 *   #2a — a freshly-added effect defaults to a neutral +0 bonus (was +1 in the item modal).
 *   #2b — positive bonuses display with a leading "+"; negatives keep "-"; 0 is bare.
 *   #2d — a fresh effect grants NO advantage/disadvantage (the control defaults to "Normal").
 *   effectHasBehavior — the predicate that stops the +0 default from persisting as a no-op
 *                       and gates item equippability (shared with canEquip, Bug #3).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-customabilities.js";

const CustomAbilities = globalThis.CharacterSheetCustomAbilities;

describe("Bug #2a/#2d — new-effect defaults", () => {
	it("createDefaultEffect() starts at a neutral +0 bonus", () => {
		const eff = CustomAbilities.createDefaultEffect();
		expect(eff.value).toBe(0);
		expect(eff.type).toBe("ac");
	});

	it("createDefaultEffect() grants NO advantage or disadvantage by default", () => {
		const eff = CustomAbilities.createDefaultEffect();
		expect(eff.advantage).toBeUndefined();
		expect(eff.disadvantage).toBeUndefined();
	});

	it("two calls return independent objects (no shared mutable default)", () => {
		const a = CustomAbilities.createDefaultEffect();
		const b = CustomAbilities.createDefaultEffect();
		a.value = 5;
		expect(b.value).toBe(0);
	});
});

describe("Bug #2b — signed bonus formatting", () => {
	it("positive values get a leading +", () => {
		expect(CustomAbilities.formatEffectBonus(2)).toBe("+2");
		expect(CustomAbilities.formatEffectBonus(10)).toBe("+10");
	});

	it("negative values keep their -", () => {
		expect(CustomAbilities.formatEffectBonus(-1)).toBe("-1");
		expect(CustomAbilities.formatEffectBonus(-3)).toBe("-3");
	});

	it("zero is shown bare", () => {
		expect(CustomAbilities.formatEffectBonus(0)).toBe("0");
	});

	it("string and non-finite inputs are coerced safely", () => {
		expect(CustomAbilities.formatEffectBonus("4")).toBe("+4");
		expect(CustomAbilities.formatEffectBonus("-2")).toBe("-2");
		expect(CustomAbilities.formatEffectBonus("")).toBe("0");
		expect(CustomAbilities.formatEffectBonus(undefined)).toBe("0");
		expect(CustomAbilities.formatEffectBonus(NaN)).toBe("0");
	});
});

describe("effectHasBehavior — no-op vs meaningful effect rows", () => {
	it("the neutral +0 default is treated as a no-op", () => {
		expect(CustomAbilities.effectHasBehavior(CustomAbilities.createDefaultEffect())).toBe(false);
		expect(CustomAbilities.effectHasBehavior({type: "ac", value: 0})).toBe(false);
	});

	it("a non-zero numeric bonus counts as behaviour", () => {
		expect(CustomAbilities.effectHasBehavior({type: "ac", value: 2})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "initiative", value: -1})).toBe(true);
	});

	it("advantage / disadvantage count even with value 0", () => {
		expect(CustomAbilities.effectHasBehavior({type: "initiative", value: 0, advantage: true})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "save:dex", value: 0, disadvantage: true})).toBe(true);
	});

	it("a roll floor / ceiling, bonus dice, set mode, and scaling all count", () => {
		expect(CustomAbilities.effectHasBehavior({type: "check:dex", value: 0, setMinimum: 10})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "check:dex", value: 0, setMaximum: 5})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "attack", value: 0, bonusDie: "1d4"})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ability:str", value: 0, mode: "set"})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ac", value: 0, proficiencyBonus: true})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ac", value: 0, abilityMod: "dex"})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ac", value: 0, perLevel: true})).toBe(true);
	});

	it("non-numeric (type-only) families are meaningful by type alone (value 0 is fine)", () => {
		expect(CustomAbilities.effectHasBehavior({type: "resistance:fire", value: 0})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "immunity:poison", value: 0})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "conditionImmunity:charmed", value: 0})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "reach", value: 0})).toBe(true); // defaults to +5
	});

	it("numeric families (senses, ability) need a real value/mode — a value-0 row is a no-op", () => {
		expect(CustomAbilities.effectHasBehavior({type: "sense:darkvision", value: 0})).toBe(false);
		expect(CustomAbilities.effectHasBehavior({type: "sense:darkvision", value: 60})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ability:str", value: 0})).toBe(false);
		expect(CustomAbilities.effectHasBehavior({type: "ability:str", value: 2})).toBe(true);
		expect(CustomAbilities.effectHasBehavior({type: "ability:str", value: 0, mode: "set"})).toBe(true);
	});

	it("malformed / typeless rows are rejected", () => {
		expect(CustomAbilities.effectHasBehavior(null)).toBe(false);
		expect(CustomAbilities.effectHasBehavior({})).toBe(false);
		expect(CustomAbilities.effectHasBehavior({value: 5})).toBe(false);
	});
});
