/**
 * Character Sheet — Natural weapons default to Finesse under the TGTT house rule (R45 Bug 6).
 *
 * Rule: for ALL natural weapons, the attack should default to "finesse" (the better of STR/DEX)
 * instead of the vanilla STR default, GATED on settings.enableTgtt (default ON). Explicitly
 * parsed abilities (con / dex / spellcasting / an already-detected finesse) are preserved.
 *
 * The override is applied at the addFeature natural-weapon call site (parseNaturalWeapon is
 * static and has no settings access). combat.js resolves "finesse" -> max(str, dex).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const CLAWS_STR = "Your claws are natural weapons, which you can use to make unarmed strikes. On a hit you deal 1d6 slashing damage.";
const BITE_CON = "Your bite is a natural weapon. On a hit you deal 1d6 piercing damage. You use your Constitution modifier for the attack and damage rolls.";

function mkStateWithNaturalWeapon (desc, {str = 10, dex = 18, enableTgtt} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", dex);
	if (enableTgtt !== undefined) state.setSetting("enableTgtt", enableTgtt);
	state.addFeature({name: "Claws", source: "TGTT", description: desc});
	return state;
}

const natWeapon = (state) =>
	state.getAttacks().find(a => a.sourceFeature === "Claws" || /claw|bite/i.test(a.name || ""));

describe("Natural weapon finesse (TGTT house rule)", () => {
	it("defaults a STR natural weapon to finesse when TGTT is enabled (default)", () => {
		const state = mkStateWithNaturalWeapon(CLAWS_STR, {str: 10, dex: 18});
		const atk = natWeapon(state);
		expect(atk).toBeTruthy();
		expect(atk.abilityMod).toBe("finesse");
	});

	it("resolves finesse to the higher of STR/DEX in combat", () => {
		const state = mkStateWithNaturalWeapon(CLAWS_STR, {str: 10, dex: 18}); // DEX +4 > STR +0
		expect(state._resolveBaseWeaponAbilityMod("finesse")).toBe(state.getAbilityMod("dex"));
		expect(state._resolveBaseWeaponAbilityMod("finesse")).toBe(4);
	});

	it("keeps the vanilla STR default when TGTT is disabled", () => {
		const state = mkStateWithNaturalWeapon(CLAWS_STR, {str: 10, dex: 18, enableTgtt: false});
		const atk = natWeapon(state);
		expect(atk).toBeTruthy();
		expect(atk.abilityMod).toBe("str");
	});

	it("preserves an explicitly-specified ability (Constitution) even with TGTT on", () => {
		const state = mkStateWithNaturalWeapon(BITE_CON, {str: 10, dex: 18});
		const atk = natWeapon(state);
		expect(atk).toBeTruthy();
		expect(atk.abilityMod).toBe("con");
	});
});
