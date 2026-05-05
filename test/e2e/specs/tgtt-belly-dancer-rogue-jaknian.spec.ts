import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BELLY_DANCER_JAKNIAN} from "../utils/characterBuilder";

/**
 * #12 — Belly Dancer Rogue Jaknian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Dance of the Country (L3) — bladesong-like toggle: +CHA mod
 *     to AC, advantage on Acrobatics, sneak in melee w/o advantage.
 *     Validate the toggle is present, costs uses (per prof bonus),
 *     restores on short rest.
 *   - Sneak Attack scales like every Rogue.
 *   - No spellcasting / no concentration spells.
 */
describeCharacter({
	preset: PRESET_FULL_BELLY_DANCER_JAKNIAN,
	displayName: "Belly Dancer Rogue Jaknian",
	signatureToggle: /dance of the country|dance/i,
	usage: {
		atLevel: 5,
		useResourceName: "Dance of the Country",
		expectLongRestRestores: false,
		attackName: /dagger|shortsword|rapier|shortbow/i,
		skillRoll: {name: "Acrobatics"},
		shortRestRestores: {resourceName: "Dance of the Country"},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, expectToggles: [/dance of the country|dance/i], expectResources: {"Dance of the Country": 2}},
		5:  {totalLevel: 5,  minMaxHp: 30, expectResources: {"Dance of the Country": 3}},
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/tantalizing shivers|shivers/i]},
		17: {totalLevel: 17, minMaxHp: 90, expectToggles: [/percussive strike|percussive/i]},
		20: {totalLevel: 20, minMaxHp: 100},
	},
});
