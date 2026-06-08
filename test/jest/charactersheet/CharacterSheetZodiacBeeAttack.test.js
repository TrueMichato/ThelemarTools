/**
 * Bug #12 — Bee Zodiac Form surfaces its bonus-action ranged radiant spell
 * attack as a REAL, rollable attack (not just an info label).
 *
 * The Bee form's `getEffects()` now emits a generic mechanical
 * `{type:"attack", ...}` effect (mirroring how Octopus emits `{type:"reach"}`),
 * and the new generic `getActiveStateAttacks()` resolver turns any active-state
 * attack effect into an attack descriptor the Combat tab merges + the roll
 * handlers resolve.
 *
 * These tests exercise the MECHANICS (state model), not the jsdom DOM:
 *  - the attack only exists while the Bee form is active;
 *  - it is a ranged (not melee) radiant spell attack using Wisdom;
 *  - the damage is DICE-ONLY (no baked-in +Wis) so the attack system doesn't
 *    double-count Wisdom on the damage roll;
 *  - the dice scale 1d8 / 2d8 / 3d8 at druid levels 3 / 10 / 14;
 *  - it survives a save/load round-trip;
 *  - a mechanical-but-non-attack form (Octopus → reach) yields no attack.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** TGTT Circle of the Zodiac druid at `level` with WIS 16 (+3). */
function makeZodiacDruid (level) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: level >= 3 ? {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"} : undefined,
	});
	state.setAbilityBase("str", 8);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 16); // +3
	state.setAbilityBase("cha", 10);
	return state;
}

describe("Bug #12 — Bee Zodiac Form attack surfacing", () => {
	it("surfaces NO active-state attack when no form is active", () => {
		const state = makeZodiacDruid(3);
		expect(state.getActiveStateAttacks()).toEqual([]);
	});

	it("surfaces a single ranged radiant spell attack while the Bee form is active", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("bee");

		const attacks = state.getActiveStateAttacks();
		expect(attacks.length).toBe(1);

		const atk = attacks[0];
		expect(atk.isRanged).toBe(true);
		expect(atk.isMelee).toBe(false);
		expect(atk.isSpell).toBe(true);
		expect(atk.abilityMod).toBe("wis");
		expect(atk.damageType).toBe("radiant");
		expect(atk.range).toBe("60 ft.");
		expect(atk.actionType).toBe("bonus");
		expect(atk.isActiveStateAttack).toBe(true);
		// Stable, deterministic id so render + roll handlers agree across re-renders.
		expect(atk.id).toMatch(/^as_/);
		// Sourced from the form for the badge.
		expect(atk.sourceState).toMatch(/Bee/i);
	});

	it("uses DICE-ONLY damage (no baked-in +Wis) to avoid double-counting Wisdom", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("bee");
		const atk = state.getActiveStateAttacks()[0];
		// The attack renderer/roller adds the Wis ability modifier as the damage
		// bonus, so the descriptor's damage must be the raw dice only.
		expect(atk.damage).toBe("1d8");
		expect(atk.damage).not.toContain("+");
	});

	it("scales the damage dice 1d8 / 2d8 / 3d8 at druid levels 3 / 10 / 14", () => {
		for (const [level, dice] of [[3, "1d8"], [10, "2d8"], [14, "3d8"]]) {
			const state = makeZodiacDruid(level);
			state.activateZodiacForm("bee");
			const atk = state.getActiveStateAttacks()[0];
			expect(atk.damage).toBe(dice);
		}
	});

	it("removes the attack when the Bee form is deactivated", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("bee");
		expect(state.getActiveStateAttacks().length).toBe(1);

		state.deactivateState("zodiacForm");
		expect(state.getActiveStateAttacks()).toEqual([]);
	});

	it("survives a save/load round-trip (the attack re-derives on load)", () => {
		const state = makeZodiacDruid(10);
		state.activateZodiacForm("bee");
		const json = state.toJson();

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		const attacks = reloaded.getActiveStateAttacks();
		expect(attacks.length).toBe(1);
		expect(attacks[0].damage).toBe("2d8");
		expect(attacks[0].damageType).toBe("radiant");
		expect(attacks[0].abilityMod).toBe("wis");
	});

	it("yields no attack for a mechanical-but-non-attack form (Octopus → reach)", () => {
		const state = makeZodiacDruid(3);
		state.activateZodiacForm("octopus");
		// Octopus contributes a reach effect, not an attack.
		expect(state.getActiveStateAttacks()).toEqual([]);
	});
});
