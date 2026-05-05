import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_JESTER_DENDULRA} from "../utils/characterBuilder";

/**
 * #13 — College of Jesters Bard Dendulra (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Standard Bard spell-slot scaling and Bardic Inspiration
 *   - 3 *Jester's Acts* (JA optional features) picked at L3,
 *     +1 each at L6 and L14 — at least one of the picked Acts must
 *     surface as an activatable feature on the sheet (validated via
 *     `expectToggles` regex covering all 13 JA names)
 *   - Concentration via Bless
 *   - Short-rest BI restoration is blocked by CS-BUG-008
 */
describeCharacter({
	preset: PRESET_FULL_JESTER_DENDULRA,
	displayName: "College of Jesters Bard Dendulra",
	signatureToggle: /juggle|jaunt|jest|prankster|pantomime|fool|laughing|witty|agility|dazzling|tumbler|disengagement|ridiculous/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Bardic Inspiration",
		expectLongRestRestores: true,
		attackName: /dagger|rapier|crossbow/i,
		skillRoll: {name: "Performance"},
		shortRestRestores: {skip: true}, // blocked by CS-BUG-008 (Bardic Inspiration not restored on short rest)
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectResources: {"Bardic Inspiration": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/juggle|jaunt|jest|prankster|pantomime|fool|laughing|witty|agility|dazzling|tumbler|disengagement|ridiculous/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectToggles: [/jester's privilege|privilege/i]},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
});
