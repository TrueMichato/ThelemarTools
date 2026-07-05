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

// -------------------------------------------------------------------------
// (R46 Bug 5) Load-time migration: existing saves keep the vanilla `str`
// default because the finesse rule only runs at addFeature time. loadFromJson
// must re-apply it to already-stored natural-weapon attacks.
// -------------------------------------------------------------------------
function mkSaveWithStoredAttacks (attacks, {enableTgtt} = {}) {
	const json = {
		name: "Tabaxi Test",
		abilityScores: {str: 10, dex: 18, con: 14, int: 10, wis: 10, cha: 10},
		attacks,
	};
	if (enableTgtt !== undefined) json.settings = {enableTgtt};
	return json;
}

const STORED_CLAWS_STR = {
	name: "Claws",
	isMelee: true,
	isNaturalWeapon: true,
	abilityMod: "str",
	damage: "1d6",
	damageType: "slashing",
	sourceFeature: "Cat's Claws",
};

describe("Natural weapon finesse — load-time migration (R46 Bug 5)", () => {
	const clawsOf = (state) => state.getAttacks().find(a => a.name === "Claws" && a.isNaturalWeapon);

	it("re-applies finesse to a Tabaxi claws attack stored with abilityMod:'str'", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(mkSaveWithStoredAttacks([{...STORED_CLAWS_STR}]));
		expect(clawsOf(state).abilityMod).toBe("finesse");
	});

	it("leaves the stored 'str' default when TGTT is disabled", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(mkSaveWithStoredAttacks([{...STORED_CLAWS_STR}], {enableTgtt: false}));
		expect(clawsOf(state).abilityMod).toBe("str");
	});

	it("never touches an explicitly-parsed Constitution natural weapon", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(mkSaveWithStoredAttacks([
			{name: "Bite", isMelee: true, isNaturalWeapon: true, abilityMod: "con", damage: "1d6", damageType: "piercing"},
		]));
		expect(state.getAttacks().find(a => a.name === "Bite").abilityMod).toBe("con");
	});

	it("never touches a non-natural weapon that happens to use STR", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(mkSaveWithStoredAttacks([
			{name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing"},
		]));
		expect(state.getAttacks().find(a => a.name === "Longsword").abilityMod).toBe("str");
	});

	it("is idempotent — an already-finesse natural weapon is left as-is", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(mkSaveWithStoredAttacks([
			{...STORED_CLAWS_STR, abilityMod: "finesse"},
		]));
		expect(clawsOf(state).abilityMod).toBe("finesse");
		// A second migration pass must be a no-op.
		state._migrateNaturalWeaponFinesse();
		expect(clawsOf(state).abilityMod).toBe("finesse");
	});
});
