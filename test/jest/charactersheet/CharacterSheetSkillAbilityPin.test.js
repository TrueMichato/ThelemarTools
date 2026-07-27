import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/**
 * S1 — Skill→ability correctness (Bug B) + persistent per-skill ability pin (Feature C).
 *
 * These tests lock in:
 *  - Bug B: Culture is a WIS skill (was mislabelled INT).
 *  - the single effective-ability resolver's precedence:
 *      per-roll override > manual pin > feature auto-MAX (Forest Sage) > base map.
 *  - getSkillMod / getSkillBreakdown reflect the pin (incl. the "(pinned)" label).
 *  - getSkillModWithAbility routes active-state bonuses through the ABILITY ARGUMENT (latent a).
 *  - lore skills are excluded from pinning (a pin would be a no-op).
 *  - removeCustomSkill clears any pin (no ghost overrides).
 *  - migration: old saves default to {} and a pin survives a serialize→load round-trip.
 */

describe("Bug B — Culture is a WIS skill", () => {
	test("getSkillAbility('culture') === 'wis'", () => {
		const state = new CharacterSheetState();
		expect(state.getSkillAbility("culture")).toBe("wis");
	});

	test("getSkillMod uses WIS for culture", () => {
		const state = new CharacterSheetState();
		state._data.abilities.wis = 18; // +4
		state._data.abilities.int = 8; // -1 — must NOT be used
		expect(state.getSkillMod("culture")).toBe(4);
	});

	test("linguistics stays WIS", () => {
		const state = new CharacterSheetState();
		expect(state.getSkillAbility("linguistics")).toBe("wis");
	});
});

describe("Resolver precedence (_resolveSkillAbility)", () => {
	test("base map when no pin/swap/override", () => {
		const state = new CharacterSheetState();
		const r = state._resolveSkillAbility("arcana");
		expect(r).toMatchObject({ability: "int", baseAbility: "int", source: "default"});
	});

	test("manual pin beats base", () => {
		const state = new CharacterSheetState();
		state.setSkillAbilityOverride("arcana", "cha");
		const r = state._resolveSkillAbility("arcana");
		expect(r).toMatchObject({ability: "cha", baseAbility: "int", source: "pinned"});
	});

	test("manual pin beats feature auto-MAX", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 10; // +0
		state._data.abilities.wis = 18; // +4 (swap would prefer this)
		state._data.abilities.cha = 8; // -1 (pin forces this anyway)
		state.addNamedModifier({name: "Forest Sage", type: "abilitySwap:arcana", newAbility: "wis"});
		// Without a pin, the swap would pick WIS:
		expect(state.getSkillAbility("arcana")).toBe("wis");
		// Pin to CHA overrides the swap outright:
		state.setSkillAbilityOverride("arcana", "cha");
		const r = state._resolveSkillAbility("arcana");
		expect(r).toMatchObject({ability: "cha", source: "pinned"});
		expect(state.getSkillMod("arcana")).toBe(state.getAbilityMod("cha"));
	});

	test("per-roll override beats the pin (and is not persisted)", () => {
		const state = new CharacterSheetState();
		state.setSkillAbilityOverride("arcana", "cha");
		const r = state._resolveSkillAbility("arcana", {overrideAbility: "str"});
		expect(r).toMatchObject({ability: "str", source: "override"});
		// The pin is untouched:
		expect(state.getSkillAbilityOverride("arcana")).toBe("cha");
	});

	test("feature auto-MAX still works when unpinned (Forest Sage MAX semantics)", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 10; // +0
		state._data.abilities.wis = 18; // +4
		state.addNamedModifier({name: "Forest Sage", type: "abilitySwap:arcana", newAbility: "wis"});
		const r = state._resolveSkillAbility("arcana");
		expect(r).toMatchObject({ability: "wis", baseAbility: "int", source: "swap"});
	});
});

describe("getSkillMod / getSkillBreakdown reflect the pin", () => {
	test("getSkillMod uses the pinned ability", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 8; // -1 (default arcana)
		state._data.abilities.cha = 20; // +5 (pin)
		state.setSkillAbilityOverride("arcana", "cha");
		expect(state.getSkillMod("arcana")).toBe(5);
	});

	test("breakdown ability + '(pinned)' label + total invariant", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 8; // -1
		state._data.abilities.cha = 20; // +5
		state.setSkillAbilityOverride("arcana", "cha");
		const b = state.getSkillBreakdown("arcana");
		expect(b.ability).toBe("cha");
		const abilityComp = b.components.find(c => c.type === "ability");
		expect(abilityComp.name).toContain("CHA");
		expect(abilityComp.name.toLowerCase()).toContain("(pinned)");
		// Invariant: breakdown total equals getSkillMod
		expect(b.total).toBe(state.getSkillMod("arcana"));
	});

	test("unpinned swap breakdown still says 'swapped from'", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 10; // +0
		state._data.abilities.wis = 18; // +4
		state.addNamedModifier({name: "Forest Sage", type: "abilitySwap:arcana", newAbility: "wis"});
		const b = state.getSkillBreakdown("arcana");
		const abilityComp = b.components.find(c => c.type === "ability");
		expect(abilityComp.name.toLowerCase()).toContain("swapped from int");
	});
});

describe("getSkillModWithAbility routes state bonus by the ability argument (latent a)", () => {
	test("passing an alternate ability does not throw and honours that ability's mod", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 8; // -1 (arcana default)
		state._data.abilities.str = 16; // +3
		// No active states here; the key assertion is that the alternate-ability mod is used,
		// which requires the state-bonus routing to use the passed ability rather than the default.
		expect(state.getSkillModWithAbility("arcana", "str")).toBe(3);
		expect(state.getSkillModWithAbility("arcana", "int")).toBe(-1);
	});
});

describe("Lore skills are excluded from pinning", () => {
	test("setSkillAbilityOverride rejects a lore skill", () => {
		const state = new CharacterSheetState();
		state.addLoreSkill("Heraldry", 2);
		expect(state.setSkillAbilityOverride("heraldry", "int")).toBe(false);
		expect(state.getSkillAbilityOverride("heraldry")).toBeNull();
	});

	test("resolver returns null ability for a lore skill", () => {
		const state = new CharacterSheetState();
		state.addLoreSkill("Heraldry", 2);
		const r = state._resolveSkillAbility("heraldry");
		expect(r.ability).toBeNull();
	});
});

describe("removeCustomSkill clears the pin", () => {
	test("deleting a custom skill removes its pin", () => {
		const state = new CharacterSheetState();
		state.addCustomSkill("Brewing", "cha");
		expect(state.setSkillAbilityOverride("brewing", "int")).toBe(true);
		expect(state.getSkillAbilityOverride("brewing")).toBe("int");
		state.removeCustomSkill("Brewing");
		expect(state.getSkillAbilityOverride("brewing")).toBeNull();
	});
});

describe("Invalid pins are rejected", () => {
	test("non-ability strings are rejected", () => {
		const state = new CharacterSheetState();
		expect(state.setSkillAbilityOverride("arcana", "luck")).toBe(false);
		expect(state.getSkillAbilityOverride("arcana")).toBeNull();
	});
});

describe("Migration + persistence", () => {
	test("old save without skillAbilityOverrides loads to {}", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({name: "Legacy", abilities: {str: 10}});
		expect(state._data.skillAbilityOverrides).toEqual({});
	});

	test("a corrupt (array) value is normalised to {}", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({name: "Corrupt", skillAbilityOverrides: ["nope"]});
		expect(state._data.skillAbilityOverrides).toEqual({});
	});

	test("a pin survives serialize→load", () => {
		const state = new CharacterSheetState();
		state.setSkillAbilityOverride("arcana", "cha");
		const json = state.toJson();

		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);
		expect(state2.getSkillAbilityOverride("arcana")).toBe("cha");
		expect(state2.getSkillAbility("arcana")).toBe("cha");
	});
});
