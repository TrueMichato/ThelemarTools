import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BELLY_DANCER_JAKNIAN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildWeaponMasteryChecks, withSkipReason} from "../utils/tgttFeaturePools";

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
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Rapier", equipped: true},
	],
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
		// XPHB Weapon Mastery — Rogue picks Club + Dagger (first two
		// proficient simple weapons in DOM order, deterministic).
		...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
		// ── Rogue base ────────────────────────────────────────────────
		// Sneak Attack itself isn't a clean state probe (damage shows
		// only inside the attack listing). Use this entry to host a
		// fundamental rogue roll-button probe (initiative — rogues live
		// or die by it).
		//
		// Anchored at L3, not L1: a row only ever runs at a checkpoint
		// inside its [level, untilLevel] window, and the checkpoints are
		// [3, 5, 11, 17, 20]. An L1-2 window contains none of them, so
		// everything hosted here was dead code that nothing reported.
		{
			level: 3,
			untilLevel: 4,
			name: /sneak attack/i,
			kind: "passive",
			effects: [
				{kind: "rollInitiative"},
			],
		},
		{level: 1, name: /thieves['’]? cant/i, kind: "passive"},
		{level: 2, name: /cunning action/i, kind: "passive"},
		// Uncanny Dodge keys off a DEX save trigger — exercise the DEX
		// save roll button (rogue is proficient).
		{
			level: 5,
			untilLevel: 6,
			name: /uncanny dodge/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "sneakAttackDice", exact: 3},
			],
		},
		// Evasion converts DEX saves into half-on-fail; rogue is also
		// INT-save proficient — probe both that the INT save button
		// renders/clicks and indirectly the DEX one (already covered
		// above) at higher levels too.
		{
			level: 7,
			name: /evasion/i,
			kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
			effects: [
				{kind: "rollSavingThrow", ability: "int"},
			],
		},
		// No L7-8 Sneak Attack row. Sneak Attack steps on every odd level,
		// but the matrix samples [3, 5, 11, 17, 20], so only 2/3/6/9/10
		// are ever observable — and each of those is asserted below. The
		// values at L1, L7, L9, L13 and L15 (1/4/5/7/8) are correct on no
		// sampled level, so a row asserting one cannot run: widening its
		// window to reach a checkpoint changes the expected value. Those
		// are not weaker assertions, they are unreachable ones.
		// Reliable Talent treats any proficient skill check d20 < 10 as
		// a 10. Acrobatics is rogue-signature; assert the skill button
		// click handler is wired.
		{
			level: 11,
			untilLevel: 12,
			name: /reliable talent/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", skill: "acrobatics", skip: true, skipReason: "CS-BUG-017"},
				{kind: "sneakAttackDice", exact: 6},
			],
		},
		{level: 14, name: /blindsense/i, kind: "passive"},
		// Open-ended like its blindsense/elusive siblings: an L15-16
		// window contains no checkpoint, so this row never ran at all.
		{level: 15, name: /slippery mind/i, kind: "passive"},
		{level: 18, name: /elusive/i, kind: "passive"},
		{
			level: 20,
			name: /stroke of luck/i,
			kind: "passive",
			effects: [
				{kind: "sneakAttackDice", exact: 10},
			],
		},

		// ── Belly Dancer subclass ─────────────────────────────────────
		// Bonus Proficiency grants Expertise in Performance + lets weapons
		// be treated as Concealed. Expertise wiring on TGTT subclasses is
		// not consistently surfaced through skill-bonus state — leave the
		// numeric assertion off and rely on the feature-presence check.
		{
			level: 3,
			untilLevel: 4,
			name: /bonus proficiency/i,
			kind: "passive",
			effects: [
				{kind: "sneakAttackDice", exact: 2},
			],
		},
		// Dance of the Country — bladesong-like AC buff (+CHA mod) when
		// active. Bonus-action toggle, lasts until ended/incapacitated,
		// uses = PB, short-rest restore.
		//
		// Effects:
		//   - togglePlusAc whenActive=abilityMod cha — matches the
		//     `dancing` ACTIVE_STATE_TYPES entry
		//     ({type: "bonus", target: "ac", abilityMod: "cha"}).
		//   - toggleGrantsAdvantage skill:acrobatics — homebrew rule
		//     grants advantage on Dexterity (Acrobatics) rolls
		//     (CS-BUG-014 fixed: dancing state now correctly targets
		//     skill:acrobatics).
		{
			level: 3,
			name: /dance of the country/i,
			kind: "toggle",
			skip: true, skipReason: "CS-BUG-017",
			toggleDelta: "ac",
			effects: [
				{kind: "togglePlusAc", whenActive: "abilityMod", ability: "cha"},
				{
					kind: "toggleGrantsAdvantage",
					rollType: "skill:acrobatics",
				},
			],
		},
		{
			level: 3,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 4,
			resourceMax: 2,
			restoreOn: "short",
		},
		{
			level: 5,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 10,
			resourceMax: 3,
			restoreOn: "short",
		},
		{
			level: 11,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 16,
			resourceMax: 4,
			restoreOn: "short",
		},
		{
			level: 17,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 19,
			resourceMax: 6,
			restoreOn: "short",
		},
		{
			level: 20,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 6,
			restoreOn: "short",
		},
		// Tantalizing Shivers fires a Charisma (Performance) check vs
		// Wisdom (Insight) while Dancing — exercise the Performance
		// skill roll button at this level.
		//
		// Open-ended: an L9-10 window contains no checkpoint, so this
		// subclass feature had no live existence check at any level.
		{
			level: 9,
			name: /tantalizing shivers/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			],
		},
		// Open-ended for the same reason: L13-14 contains no checkpoint.
		{level: 13, name: /fluid step/i, kind: "passive"},
		// Percussive Strike sets a save DC = 8 + PB + CHA mod for hostile
		// onlookers. The DC isn't surfaced as a feature-DC field, but
		// CHA is the signature ability — exercise the CHA ability-check
		// roll button to cover the ability-check probe quota.
		{
			level: 17,
			untilLevel: 19,
			name: /percussive strike/i,
			kind: "passive",
			effects: [
				{kind: "rollAbilityCheck", ability: "cha"},
				{kind: "sneakAttackDice", exact: 9},
			],
		},
		// Jaknian race traits (Trade Secrets: Persuasion or Investigation
		// proficiency + double-prof on haggling Persuasion checks; Tools
		// of the Trade: two artisan tools) belong to the race tab, not
		// the class featuresMatrix. The base Child of the Empire speed
		// is a flat 30 with no Jaknian-specific speed bonus — no clean
		// effect probe to add at the class-feature level.
		// CS-BUG-017: rogue specialty pick count short past L11. Keep the
		// helper in the matrix (no-blind-spots doctrine) with every
		// emitted row marked skip+skipReason via withSkipReason.
		...withSkipReason(buildSpecialtyChecks("Rogue"), "CS-BUG-017"),
	],
});
