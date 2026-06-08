/**
 * Ability Score Maximum — generic effect-driven mechanism
 *
 * Verifies the round-3 generic channel for raising/setting an ability score's
 * MAXIMUM. The cap is modeled as named modifiers `abilityMax:<abl>` with
 * mode "increase" | "set", aggregated by `getAbilityScoreMax(ability)` and
 * (when the enforcement setting is on) used to clamp `getAbilityScore`.
 *
 * The same effect type flows through every channel that uses the named-modifier
 * pipeline: custom abilities, class features / feats / items (via
 * `_applyFeatureEffect`), and direct `addNamedModifier` calls.
 *
 * Assertions target MECHANICS (cap numbers, clamped scores), never level counts.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	state = new CharacterSheetState();
});

describe("getAbilityScoreMax — baseline", () => {
	it("defaults to 20 for every ability", () => {
		["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
			expect(state.getAbilityScoreMax(abl)).toBe(20);
		});
	});

	it("returns a number even when enforcement is off (independent of the setting)", () => {
		expect(state._data.settings.enforceAbilityScoreCap).toBe(false);
		expect(state.getAbilityScoreMax("str")).toBe(20);
	});
});

describe("increase-max effect", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("raises getAbilityScoreMax additively", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "increase", value: 4, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(24);
	});

	it("lets getAbilityScore exceed 20 up to the raised cap", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "increase", value: 4, enabled: true});
		state.setAbilityBase("str", 23);
		expect(state.getAbilityScore("str")).toBe(23);
		state.setAbilityBase("str", 26); // above the new cap of 24
		expect(state.getAbilityScore("str")).toBe(24);
	});

	it("stacks multiple increases additively", () => {
		state.addNamedModifier({name: "A", type: "abilityMax:con", mode: "increase", value: 2, enabled: true});
		state.addNamedModifier({name: "B", type: "abilityMax:con", mode: "increase", value: 3, enabled: true});
		expect(state.getAbilityScoreMax("con")).toBe(25);
	});

	it("only affects the targeted ability", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "increase", value: 4, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(24);
		expect(state.getAbilityScoreMax("dex")).toBe(20);
	});
});

describe("set-max effect", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("sets the cap to the given value", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:cha", mode: "set", value: 26, enabled: true});
		expect(state.getAbilityScoreMax("cha")).toBe(26);
	});

	it("lets getAbilityScore reach the set cap", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:cha", mode: "set", value: 26, enabled: true});
		state.setAbilityBase("cha", 28);
		expect(state.getAbilityScore("cha")).toBe(26);
	});

	it("takes the highest 'set' when several apply", () => {
		state.addNamedModifier({name: "A", type: "abilityMax:str", mode: "set", value: 22, enabled: true});
		state.addNamedModifier({name: "B", type: "abilityMax:str", mode: "set", value: 26, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(26);
	});

	it("never lowers below the default 20 floor (raise-only)", () => {
		state.addNamedModifier({name: "Curse", type: "abilityMax:str", mode: "set", value: 18, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(20);
	});

	it("adds increases on top of the resolved set", () => {
		state.addNamedModifier({name: "Set", type: "abilityMax:str", mode: "set", value: 22, enabled: true});
		state.addNamedModifier({name: "Inc", type: "abilityMax:str", mode: "increase", value: 3, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(25);
	});
});

describe("hard ceiling of 30", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("clamps a set above 30 down to 30", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "set", value: 35, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(30);
	});

	it("clamps set + increase combinations at 30", () => {
		state.addNamedModifier({name: "Set", type: "abilityMax:str", mode: "set", value: 28, enabled: true});
		state.addNamedModifier({name: "Inc", type: "abilityMax:str", mode: "increase", value: 5, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(30);
	});

	it("never lets getAbilityScore exceed 30", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "set", value: 30, enabled: true});
		state.setAbilityBase("str", 40);
		expect(state.getAbilityScore("str")).toBe(30);
	});
});

describe("manual override + effect interaction", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("manual override participates as a 'set' candidate", () => {
		state.setAbilityScoreMaximum("str", 24);
		expect(state.getAbilityScoreMax("str")).toBe(24);
	});

	it("increases add on top of a manual override", () => {
		state.setAbilityScoreMaximum("str", 24);
		state.addNamedModifier({name: "Inc", type: "abilityMax:str", mode: "increase", value: 2, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(26);
	});

	it("the higher of manual override and effect-set wins", () => {
		state.setAbilityScoreMaximum("str", 22);
		state.addNamedModifier({name: "Set", type: "abilityMax:str", mode: "set", value: 26, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(26);
	});
});

describe("custom-ability path", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("a passive custom ability with a set abilityMax effect raises the cap", () => {
		state.addCustomAbility({
			name: "Crown of Might",
			mode: "passive",
			effects: [{type: "abilityMax:str", mode: "set", value: 24}],
		});
		expect(state.getAbilityScoreMax("str")).toBe(24);
		state.setAbilityBase("str", 24);
		expect(state.getAbilityScore("str")).toBe(24);
	});

	it("a passive custom ability with an increase abilityMax effect raises the cap", () => {
		state.addCustomAbility({
			name: "Giant's Vigor",
			mode: "passive",
			effects: [{type: "abilityMax:con", mode: "increase", value: 2}],
		});
		expect(state.getAbilityScoreMax("con")).toBe(22);
	});

	it("removing the custom ability reverts the cap cleanly", () => {
		const id = state.addCustomAbility({
			name: "Crown of Might",
			mode: "passive",
			effects: [{type: "abilityMax:str", mode: "set", value: 24}],
		});
		expect(state.getAbilityScoreMax("str")).toBe(24);
		state.removeCustomAbility(id);
		expect(state.getAbilityScoreMax("str")).toBe(20);
	});
});

describe("feature-effect path (_applyFeatureEffect)", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("a 'set' abilityMax feature effect raises the cap", () => {
		state._applyFeatureEffect({type: "abilityMax", ability: "str", mode: "set", value: 24, source: "Epic Boon of Strength"});
		expect(state.getAbilityScoreMax("str")).toBe(24);
	});

	it("an 'increase' abilityMax feature effect raises the cap", () => {
		state._applyFeatureEffect({type: "abilityMax", ability: "dex", mode: "increase", value: 2, source: "Test Feature"});
		expect(state.getAbilityScoreMax("dex")).toBe(22);
	});
});

describe("generic teardown via removeModifiersByFeature", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
	});

	it("removing the granting feature reverts the cap", () => {
		state.addNamedModifier({
			name: "Capstone",
			type: "abilityMax:str",
			mode: "set",
			value: 24,
			enabled: true,
			sourceFeatureId: "feat-123",
		});
		expect(state.getAbilityScoreMax("str")).toBe(24);
		state.removeModifiersByFeature("feat-123");
		expect(state.getAbilityScoreMax("str")).toBe(20);
	});

	it("disabling the modifier reverts the cap", () => {
		const id = state.addNamedModifier({name: "Capstone", type: "abilityMax:str", mode: "set", value: 24, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(24);
		state.updateNamedModifier(id, {enabled: false});
		expect(state.getAbilityScoreMax("str")).toBe(20);
	});
});

describe("Primal Champion proof (Barbarian 20)", () => {
	beforeEach(() => {
		state.setSetting("enforceAbilityScoreCap", true);
		state.addClass({name: "Barbarian", source: "PHB", level: 20});
	});

	it("raises STR/CON maximum to 24 through getAbilityScoreMax", () => {
		expect(state.getAbilityScoreMax("str")).toBe(24);
		expect(state.getAbilityScoreMax("con")).toBe(24);
	});

	it("does not raise DEX/INT/WIS/CHA maximum", () => {
		expect(state.getAbilityScoreMax("dex")).toBe(20);
		expect(state.getAbilityScoreMax("cha")).toBe(20);
	});

	it("a further increase effect raises the Primal Champion ceiling and the natural score follows", () => {
		// Primal Champion sets the floor at 24; an Epic Boon increase of +2 → 26.
		state.addNamedModifier({name: "Epic Boon", type: "abilityMax:str", mode: "increase", value: 2, enabled: true});
		expect(state.getAbilityScoreMax("str")).toBe(26);
		state.setAbilityBase("str", 22); // 22 + Primal Champion +4 = 26
		expect(state.getAbilityScore("str")).toBe(26);
	});
});

describe("save / load round-trip", () => {
	it("preserves an effect-driven cap and clamped score", () => {
		state.setSetting("enforceAbilityScoreCap", true);
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "set", value: 24, enabled: true});
		state.setAbilityBase("str", 24);

		const json = state.toJson();
		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);

		expect(state2.getAbilityScoreMax("str")).toBe(24);
		expect(state2.getAbilityScore("str")).toBe(24);
	});

	it("preserves the 'mode' field on named modifiers across the round-trip", () => {
		state.addNamedModifier({name: "Boon", type: "abilityMax:str", mode: "set", value: 24, enabled: true});
		const json = state.toJson();
		const saved = json.namedModifiers.find(m => m.type === "abilityMax:str");
		expect(saved.mode).toBe("set");

		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);
		state2.setSetting("enforceAbilityScoreCap", true);
		expect(state2.getAbilityScoreMax("str")).toBe(24);
	});
});

describe("backward compatibility", () => {
	it("an old save with no abilityMax effects has a default cap of 20", () => {
		const json = state.toJson();
		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);
		expect(state2.getAbilityScoreMax("str")).toBe(20);
	});

	it("an old save without enforcement leaves scores unclamped (behaves as today)", () => {
		const json = state.toJson();
		delete json.settings.enforceAbilityScoreCap;
		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);
		state2.setAbilityBase("str", 25);
		expect(state2.getAbilityScore("str")).toBe(25);
		// The generic max is still well-defined.
		expect(state2.getAbilityScoreMax("str")).toBe(20);
	});
});

describe("mode preservation regression (addNamedModifier)", () => {
	it("keeps mode:'set' on the stored modifier", () => {
		const id = state.addNamedModifier({name: "X", type: "abilityMax:str", mode: "set", value: 24, enabled: true});
		const stored = state.getNamedModifiers().find(m => m.id === id);
		expect(stored.mode).toBe("set");
	});

	it("fixes the parallel ability:<abl> set path (static override now applies)", () => {
		state.addNamedModifier({name: "Gauntlets", type: "ability:str", mode: "set", value: 19, enabled: true});
		state.setAbilityBase("str", 10);
		expect(state.getAbilityScore("str")).toBe(19);
	});
});
