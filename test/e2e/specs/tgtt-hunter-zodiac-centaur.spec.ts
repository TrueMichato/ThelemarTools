import {describeCharacter, describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HUNTER_CENTAUR, PRESET_FULL_ZODIAC_CENTAUR} from "../utils/characterBuilder";

/**
 * #4 — Hunter Ranger / Zodiac Druid Centaur (TGTT).
 *
 * Three covered builds:
 *   (a) pure Hunter Ranger 20
 *   (b) pure Zodiac Druid 20
 *   (c) Ranger 6 / Druid 14 multiclass
 */
describeCharacter({
	preset: PRESET_FULL_HUNTER_CENTAUR,
	displayName: "Hunter Ranger Centaur",
	signatureToggle: /hunter|hunter's mark|colossus|horde/i,
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10},
		3:  {totalLevel: 3,  spellSlots: {1: 3}},
		5:  {totalLevel: 5,  spellSlots: {2: 2}},
		11: {totalLevel: 11, spellSlots: {3: 3}},
		17: {totalLevel: 17, spellSlots: {5: 1}},
		20: {totalLevel: 20, spellSlots: {5: 2}},
	},
});

describeCharacter({
	preset: PRESET_FULL_ZODIAC_CENTAUR,
	displayName: "Zodiac Druid Centaur",
	signatureToggle: /zodiac|starry|wild shape|stellar/i,
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/zodiac|starry/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
});

describeMulticlassCharacter({
	displayName: "Ranger 6 / Druid 14 Centaur",
	preset: {...PRESET_FULL_HUNTER_CENTAUR, name: "Mira Wildhoof"},
	plan: [
		{className: "Ranger", classSource: "TGTT", subclassName: "Hunter", subclassSource: "TGTT-2024",
			signatureSpells: PRESET_FULL_HUNTER_CENTAUR.signatureSpells, toTotalLevel: 6},
		{className: "Druid", classSource: "TGTT", subclassName: "Circle of the Zodiac", subclassSource: "TGTT",
			signatureSpells: PRESET_FULL_ZODIAC_CENTAUR.signatureSpells, toTotalLevel: 20},
	],
	finalMilestone: {
		totalLevel: 20,
		// Multiclass spell-slot table: Ranger 6 (half) + Druid 14 (full) → caster level ≈ 17 → 9th-level slots present.
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
	},
});
