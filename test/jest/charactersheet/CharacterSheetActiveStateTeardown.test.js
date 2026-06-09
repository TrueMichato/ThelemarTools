/**
 * Active-state effect teardown (round-5 Bug #9) — MECHANICS.
 *
 * Root cause: getAdvantageState() re-implemented its own iteration over
 * getActiveStates() (which returns ALL state instances, including deactivated
 * ones retained for history) WITHOUT a `state.active` guard. Every other
 * `_data.activeStates` reader (getActiveStateEffects, getSaveBonusFromStates,
 * getCarrySizeBonusFromStates, …) filters on `state.active`, so only the
 * advantage path leaked: a cancelled state (Aurochs Zodiac Form, ended Rage)
 * kept reporting advantage, which inflated passive scores and — via Thelemar's
 * passive-driven carry capacity — leaked "carrySizeBonus persists after cancel".
 *
 * These tests assert the GENERIC teardown contract: the moment a state is
 * deactivated, EVERY derived effect (advantage, disadvantage, save/check bonus,
 * carrySizeBonus) drops — for BOTH a zodiac form (customEffects path) AND a
 * non-druid built-in state (Rage/Dodge/Defensive Stance, the ACTIVE_STATE_TYPES
 * effects path). The non-druid cases are the required SCOPE-GUARD regression:
 * the shared deactivate/getAdvantageState path must not regress Rage et al.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** Druid (Circle of the Zodiac) with a Wild Shape resource, prof +2 at level 3. */
function makeZodiacDruid (level = 3) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
	});
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("str", 14);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current: 2, max: 2, recharge: "short"}});
	return state;
}

describe("#9 — Zodiac Form (Aurochs) effects fully drop on deactivate", () => {
	it("applies STR advantage + proficiency save bonus + carrySizeBonus while active", () => {
		const state = makeZodiacDruid(3);
		const prof = state.getProficiencyBonus();
		expect(prof).toBe(2);

		state.activateZodiacForm("aurochs");

		// Advantage on STR checks AND saves, attributed to the form.
		const advCheck = state.getAdvantageState("check:str");
		const advSave = state.getAdvantageState("save:str");
		expect(advCheck.advantage).toBe(true);
		expect(advSave.advantage).toBe(true);
		expect(advSave.sources).toContain("Zodiac Form: Aurochs");

		// +proficiency to STR saves (useProficiency effect).
		expect(state.getSaveBonusFromStates("str")).toBe(prof);

		// carrySizeBonus surfaced to the carry system (one size larger).
		expect(state.getCarrySizeBonusFromStates()).toBe(1);

		// The check:str bonus is live in the canonical aggregator.
		const effects = state.getActiveStateEffects();
		expect(effects.some(e => e.type === "bonus" && e.target === "check:str")).toBe(true);
		expect(effects.some(e => e.type === "carrySizeBonus")).toBe(true);
	});

	it("removes ALL of those effects the moment the form is deactivated (no leak)", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("aurochs");
		// Sanity: active.
		expect(state.getAdvantageState("save:str").advantage).toBe(true);
		expect(state.getCarrySizeBonusFromStates()).toBe(1);

		state.deactivateState("zodiacForm");

		// Advantage gone on BOTH check and save — and the source is gone too.
		const advCheck = state.getAdvantageState("check:str");
		const advSave = state.getAdvantageState("save:str");
		expect(advCheck.advantage).toBe(false);
		expect(advSave.advantage).toBe(false);
		expect(advSave.sources).not.toContain("Zodiac Form: Aurochs");

		// Numeric bonuses and carry size step gone.
		expect(state.getSaveBonusFromStates("str")).toBe(0);
		expect(state.getCarrySizeBonusFromStates()).toBe(0);

		// Canonical aggregator is empty.
		expect(state.getActiveStateEffects()).toHaveLength(0);
	});

	it("switching forms does not leave a stale Aurochs advantage behind", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("aurochs");
		expect(state.getAdvantageState("check:str").advantage).toBe(true);

		// Switch to a form WITHOUT STR advantage (Horse: speed only).
		state.activateZodiacForm("horse");

		// The Aurochs STR advantage must NOT persist under the new form.
		expect(state.getAdvantageState("check:str").advantage).toBe(false);
		expect(state.getSaveBonusFromStates("str")).toBe(0);
		expect(state.getCarrySizeBonusFromStates()).toBe(0);
	});
});

describe("#9 SCOPE GUARD — non-druid built-in active states tear down correctly", () => {
	it("Rage: STR advantage applies while raging and fully drops after deactivate", () => {
		// A plain state instance (no Barbarian class required — the active-state
		// machinery is class-agnostic); proves the built-in ACTIVE_STATE_TYPES
		// effects path (NOT customEffects) is covered by the same guard.
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "PHB", level: 5});

		state.activateState("rage");
		expect(state.getAdvantageState("check:str").advantage).toBe(true);
		expect(state.getAdvantageState("save:str").advantage).toBe(true);
		expect(state.getAdvantageState("save:str").sources).toContain("Rage");

		state.deactivateState("rage");
		expect(state.getAdvantageState("check:str").advantage).toBe(false);
		expect(state.getAdvantageState("save:str").advantage).toBe(false);
		expect(state.getAdvantageState("save:str").sources).not.toContain("Rage");
	});

	it("Dodge: DEX-save advantage applies while dodging and drops after deactivate", () => {
		const state = new CharacterSheetState();
		state.activateState("dodge");
		expect(state.getAdvantageState("save:dex").advantage).toBe(true);

		state.deactivateState("dodge");
		expect(state.getAdvantageState("save:dex").advantage).toBe(false);
	});

	it("Defensive Stance: attack DISADVANTAGE applies while active and drops after deactivate", () => {
		// Confirms the guard covers the disadvantage branch too, not just advantage.
		const state = new CharacterSheetState();
		state.activateState("defensiveStance");
		expect(state.getAdvantageState("attack").disadvantage).toBe(true);

		state.deactivateState("defensiveStance");
		expect(state.getAdvantageState("attack").disadvantage).toBe(false);
	});

	it("a re-activatable state leaves NO residual advantage between toggles", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "PHB", level: 5});

		state.activateState("rage");
		state.deactivateState("rage");
		expect(state.getAdvantageState("check:str").advantage).toBe(false);

		// Re-activate: advantage returns (state instance reused, active flipped true).
		state.activateState("rage");
		expect(state.getAdvantageState("check:str").advantage).toBe(true);
		state.deactivateState("rage");
		expect(state.getAdvantageState("check:str").advantage).toBe(false);
	});
});
