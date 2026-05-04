import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BLADESINGER_TABAXI} from "../utils/characterBuilder";

/**
 * #3 — Bladesinger Wizard Tabaxi (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Wizard spell-slot progression (1st → 9th level slots)
 *   - Bladesong toggle arrives at L3, raises AC by INT mod
 *   - Extra Attack at L6, Song of Defense at L10
 *   - Signet of Knowledge at L20 capstone
 *   - Signature spells: Shield + Booming Blade
 */
describeCharacter({
	preset: PRESET_FULL_BLADESINGER_TABAXI,
	displayName: "Bladesinger Wizard Tabaxi",
	midTierLoadout: [
		{name: "Wand of the War Mage, +1", source: "DMG"},
	],
	signatureToggle: /bladesong/i,
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 6,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  minMaxHp: 14, spellSlots: {2: 2}, expectToggles: [/bladesong/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectToggles: [/bladesong/i]},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
});
