import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHRONURGY_NYUIDJ} from "../utils/characterBuilder";

/**
 * #7 — Chronurgy Wizard Nyuidj (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Wizard slot table identical to other Wizards (sanity check)
 *   - Chronal Shift uses arrive at L2 (subclass L1 Chronurgy feature)
 *   - Convergent Future at L14
 *   - Time Ravager / capstone at L20
 */
describeCharacter({
	preset: PRESET_FULL_CHRONURGY_NYUIDJ,
	displayName: "Chronurgy Wizard Nyuidj",
	signatureToggle: /chronal|convergent|temporal|momentary/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /quarterstaff|dagger/i,
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectToggles: [/chronal|convergent|momentary/i]},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
});
