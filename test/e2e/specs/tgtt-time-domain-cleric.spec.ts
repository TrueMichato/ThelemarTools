import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TIME_CLERIC} from "../utils/characterBuilder";

/**
 * #10 — Time Domain Cleric (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Channel Divinity uses scale (1→2→3 by L18)
 *   - Cleric spell slot table all the way to 9th-level
 *   - Subclass features at L1, L3, L6, L8, L17
 *   - Divine Intervention at L10, automatic at L20
 */
describeCharacter({
	preset: PRESET_FULL_TIME_CLERIC,
	displayName: "Time Domain Cleric",
	signatureToggle: /channel divinity|time|temporal|destroy undead/i,
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectToggles: [/divine intervention/i]},
	},
});
