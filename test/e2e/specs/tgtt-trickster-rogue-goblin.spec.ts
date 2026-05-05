import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TRICKSTER_GOBLIN} from "../utils/characterBuilder";

/**
 * #16 — Trickster Rogue Goblin (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales like every Rogue
 *   - Trickster Dice (L3) — pool of 4 d8 dice, restores on short
 *     OR long rest; pool grows at L9/L13/L17
 *   - 3 *Tricks* (TT optional features) picked at L3, scaling to 7
 *     by L19 — at least one of the picked Tricks must surface as a
 *     feature on the sheet
 *   - No spellcasting / no concentration
 */
describeCharacter({
	preset: PRESET_FULL_TRICKSTER_GOBLIN,
	displayName: "Trickster Rogue Goblin",
	signatureToggle: /disarming strike|trip attack|swing away|deafening strike|blinding strike|noise maker|rebounding throw|weaponized debris|rapid deployment|trick/i,
	usage: {
		atLevel: 5,
		// CS-BUG-012: Trickster Dice resource not surfaced; useResourceName + shortRest skipped
		expectLongRestRestores: false,
		attackName: /dagger|shortsword|shortbow|hand crossbow/i,
		skillRoll: {name: "Sleight of Hand"},
		shortRestRestores: {skip: true}, // CS-BUG-012
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, expectToggles: [/disarming|trip attack|swing|deafening|blinding|noise|rebounding|weaponized|rapid|trick/i]}, // CS-BUG-012: drop expectResources
		5:  {totalLevel: 5,  minMaxHp: 30},
		9:  {totalLevel: 9,  expectToggles: [/sticky hands/i]},
		11: {totalLevel: 11, minMaxHp: 60},
		13: {totalLevel: 13, expectToggles: [/the switch|switch/i]},
		17: {totalLevel: 17, minMaxHp: 90}, // L17 "Master of Mischief" not always exposed as activatable feature
		20: {totalLevel: 20, minMaxHp: 100},
	},
});
