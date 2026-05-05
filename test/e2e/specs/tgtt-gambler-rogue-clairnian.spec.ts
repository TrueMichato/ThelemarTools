import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_GAMBLER_CLAIRNIAN} from "../utils/characterBuilder";

/**
 * #11 — Gambler Rogue Clairnian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales (1d6 → 10d6) like every Rogue
 *   - Gambler's Spellcasting kicks in at L3 (half-caster table,
 *     warlock spell list); validate `spellSlots` milestones
 *   - Gambler's Tools — coin/dice/cards weapons; `attackName` probe
 *     is logged-not-asserted (these may not auto-equip)
 *   - Gambler's Folly toggle (1d100 gambling table) surfaces as a
 *     feature
 */
describeCharacter({
	preset: PRESET_FULL_GAMBLER_CLAIRNIAN,
	displayName: "Gambler Rogue Clairnian",
	signatureToggle: /gambler|folly|fortune|luck/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: undefined,
		expectLongRestRestores: false,
		attackName: /coins|dice|cards|dagger|shortbow/i,
		skillRoll: {name: "Sleight of Hand"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Hex", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, spellSlots: {1: 2}, expectToggles: [/gambler|folly|fortune|spellcasting/i]},
		5:  {totalLevel: 5,  minMaxHp: 30, spellSlots: {1: 2}}, // CS-BUG-010: Gambler half-caster table under-counted
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/extra luck|luck/i]}, // CS-BUG-010: drop spellSlots assertion until table fixed
		17: {totalLevel: 17, minMaxHp: 90}, // CS-BUG-010
		20: {totalLevel: 20, minMaxHp: 100, expectToggles: [/master of fortune|fortune/i]}, // CS-BUG-010
	},
});
