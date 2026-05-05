import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SURREALISM_YUANTI} from "../utils/characterBuilder";

/**
 * #8 — College of Surrealism Bard Yuan-Ti (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Bardic Inspiration die scaling (d6→d8→d10→d12) across levels
 *   - Bard spell slot table all the way to 9th-level
 *   - Subclass features arrive at L3 + L6 + L14 milestones
 *   - Superior Inspiration / capstone at L20
 */
describeCharacter({
	preset: PRESET_FULL_SURREALISM_YUANTI,
	displayName: "College of Surrealism Bard Yuan-Ti",
	signatureToggle: /bardic inspiration|surreal|illusion|mockery/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Bardic Inspiration",
		expectLongRestRestores: true,
		attackName: /rapier|shortsword|dagger/i,
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectToggles: [/bardic inspiration/i]},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectToggles: [/bardic inspiration|font of inspiration/i]},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectToggles: [/superior inspiration|words of creation/i]},
	},
});
