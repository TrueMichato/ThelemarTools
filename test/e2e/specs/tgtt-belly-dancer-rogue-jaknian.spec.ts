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
	featuresMatrix: [
		// ── Rogue base ────────────────────────────────────────────────
		{level: 1, name: /sneak attack/i, kind: "passive"},
		{level: 1, name: /thieves['’]? cant/i, kind: "passive"},
		{level: 2, name: /cunning action/i, kind: "passive"},
		{level: 5, name: /uncanny dodge/i, kind: "passive"},
		{level: 7, name: /evasion/i, kind: "passive"},
		{level: 11, name: /reliable talent/i, kind: "passive"},
		{level: 14, name: /blindsense/i, kind: "passive"},
		{level: 15, name: /slippery mind/i, kind: "passive"},
		{level: 18, name: /elusive/i, kind: "passive"},
		{level: 20, name: /stroke of luck/i, kind: "passive"},

		// ── Belly Dancer subclass ─────────────────────────────────────
		{level: 3, name: /bonus proficiency/i, kind: "passive"},
		// Dance of the Country — bladesong-like AC buff (+CHA mod) when
		// active. Bonus-action toggle, lasts until ended/incapacitated,
		// uses = PB, short-rest restore.
		{level: 3, name: /dance of the country/i, kind: "toggle", toggleDelta: "ac"},
		{
			level: 3,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 2, // PB at L3
			restoreOn: "short",
		},
		{
			level: 5,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 3, // PB at L5
			restoreOn: "short",
		},
		{
			level: 9,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 4, // PB at L9
			restoreOn: "short",
		},
		{
			level: 13,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 5, // PB at L13
			restoreOn: "short",
		},
		{
			level: 17,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 6, // PB at L17
			restoreOn: "short",
		},
		{level: 9, name: /tantalizing shivers/i, kind: "passive"},
		{level: 13, name: /fluid step/i, kind: "passive"},
		{level: 17, name: /percussive strike/i, kind: "passive"},
	],
});
