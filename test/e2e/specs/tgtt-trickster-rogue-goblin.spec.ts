import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TRICKSTER_GOBLIN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildTricksterTrickChecks, buildWeaponMasteryChecks, withSkipReason} from "../utils/tgttFeaturePools";

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
	// Trickster Tricks are spent per attack out of the Trickster Dice pool, not
	// switched on, so none reach the Overview activatable strip. The one row
	// that IS there at L5 is Steady Aim — a base Rogue feature already covered
	// by the Gambler Rogue spec. Pointing this probe at it would assert a
	// different mechanic than the one named, which is exactly the
	// "finds *a* match, not *the* match" failure CS-BUG-156 exists to stop.
	signatureToggleSkip: {skip: true, reason: "Trickster Tricks are spent per attack from the Trickster Dice pool rather than toggled, and the only strip row at L5 (Steady Aim) is an unrelated base-Rogue feature; the tricks are covered as kind:\"resource\" trickster-dice rows in featuresMatrix"},
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Shortsword", equipped: true},
	],
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
	featuresMatrix: [
		// XPHB Weapon Mastery — Rogue picks Club + Dagger (first two
		// proficient simple weapons in DOM order, deterministic).
		...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
		// ── Rogue base ────────────────────────────────────────────────
		// Sneak Attack carries the Rogue signature roll-button probes:
		// signature stealth check, an attack roll (rapier/shortsword/
		// dagger/crossbow — whatever the loadout grabs), plus the
		// initiative probe (Rogues are dex-init characters).
		{
			level: 1,
			untilLevel: 4,
			name: /sneak attack/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", skill: "stealth", skip: true, skipReason: "CS-BUG-017"},
				{kind: "rollAttack", attackName: /rapier|shortsword|dagger|crossbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
				{kind: "rollInitiative"},
				{kind: "sneakAttackDice", exact: 2},
			],
		},
		// Cunning Action = Disengage/Hide as bonus action; both are
		// dex-driven, so probe a dex ability check button here.
		{
			level: 2,
			name: /cunning action/i,
			kind: "passive",
			effects: [
				{kind: "rollAbilityCheck", ability: "dex"},
			],
		},
		// Uncanny Dodge halves damage on attack hits (dex-reactionish);
		// no clean state-observable probe — the underlying mechanic is
		// reactive damage reduction. No effect.
		{
			level: 5,
			untilLevel: 10,
			name: /uncanny dodge/i,
			kind: "passive",
			// Uncanny Dodge's reactive damage reduction has no state-facing
			// effect to probe; pin the Rogue's exact L5 Sneak Attack tier.
			effects: [
				{kind: "sneakAttackDice", exact: 3},
			],
		},
		// Evasion: succeed = no dmg, fail = half on dex saves.
		// Probe the dex save roll button to make sure the handler still
		// fires once Evasion is in play.
		{
			level: 7,
			name: /evasion/i,
			kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
			effects: [
				{kind: "rollSavingThrow", ability: "dex"},
			],
		},
		// Reliable Talent — ≥10 on every proficient ability check.
		// Probe a non-signature save (int) to make sure the global roll
		// pipeline didn't break under the Reliable Talent override.
		{
			level: 11,
			untilLevel: 16,
			name: /reliable talent/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "int"},
				{kind: "featureCalculation", property: "reliableTalentMinimum", exact: 10},
				{kind: "sneakAttackDice", exact: 6},
			],
		},
		// Stroke of Luck — once-per-short-rest reroll/auto-20. Surfaces
		// as a passive on the sheet; probe a deception skill roll to
		// cover the Trickster's social-skill side.
		{
			level: 20,
			name: /stroke of luck/i,
			kind: "passive",
			// Stroke of Luck is a player-chosen auto-20 with no persistent
			// state-facing effect; pin the Rogue's exact capstone damage tier.
			effects: [
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
				{kind: "sneakAttackDice", exact: 10},
			],
		},

		// ── Trickster subclass ───────────────────────────────────────
		// Trickster Dice pool — 4 @ L3, +1 at L9/L13/L17 (max 7).
		// Blocked by CS-BUG-012 (resource not surfaced on the sheet).
		{level: 3, name: /trickster dice/i, kind: "resource", resourceMax: 4, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 9, name: /trickster dice/i, kind: "resource", resourceMax: 5, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 13, name: /trickster dice/i, kind: "resource", resourceMax: 6, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 17, name: /trickster dice/i, kind: "resource", resourceMax: 7, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},

		// Tricks (TT optional features) — 3 picked at L3, +1 at L7/L10/L15/L19.
		// Candidate names sourced from `featureType: ["TT"]` in
		// homebrew/TravelersGuidetoThelemar.json.
		{
			level: 3,
			name: /tricks?/i,
			kind: "pick",
			skip: true, skipReason: "CS-BUG-017",
			pickedCount: 3,
			pickedFrom: [
				/disarming strike/i,
				/trip attack/i,
				/swing away/i,
				/deafening strike/i,
				/blinding strike/i,
				/noise maker/i,
				/rebounding throw/i,
				/weaponized debris/i,
				/rapid deployment/i,
				/explosive flask/i,
				/instant barrier/i,
			],
			// Phase 8: each Trick is action/bonus-action — verify at
			// least one picked Trick activates without throwing. min=1
			// because we don't know which 3 the user picked.
			effects: [
				{kind: "pickActivatable", matchAny: [
					/disarming strike/i, /trip attack/i, /swing away/i,
					/deafening strike/i, /blinding strike/i, /noise maker/i,
					/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
					/explosive flask/i, /instant barrier/i,
				], min: 1},
			],
		},
		{
			level: 7,
			name: /tricks?/i,
			kind: "pick",
			skip: true, skipReason: "CS-BUG-017",
			pickedCount: 4,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
			effects: [
				{kind: "pickActivatable", matchAny: [
					/disarming strike/i, /trip attack/i, /swing away/i,
					/deafening strike/i, /blinding strike/i, /noise maker/i,
					/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
					/explosive flask/i, /instant barrier/i,
				], min: 1},
			],
		},
		{
			level: 10,
			name: /tricks?/i,
			kind: "pick",
			skip: true, skipReason: "CS-BUG-017",
			pickedCount: 5,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
			effects: [
				{kind: "pickActivatable", matchAny: [
					/disarming strike/i, /trip attack/i, /swing away/i,
					/deafening strike/i, /blinding strike/i, /noise maker/i,
					/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
					/explosive flask/i, /instant barrier/i,
				], min: 1},
			],
		},
		{
			level: 15,
			name: /tricks?/i,
			kind: "pick",
			skip: true, skipReason: "CS-BUG-017",
			pickedCount: 6,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
			effects: [
				{kind: "pickActivatable", matchAny: [
					/disarming strike/i, /trip attack/i, /swing away/i,
					/deafening strike/i, /blinding strike/i, /noise maker/i,
					/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
					/explosive flask/i, /instant barrier/i,
				], min: 1},
			],
		},
		{
			level: 19,
			name: /tricks?/i,
			kind: "pick",
			skip: true, skipReason: "CS-BUG-017",
			pickedCount: 7,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
			effects: [
				{kind: "pickActivatable", matchAny: [
					/disarming strike/i, /trip attack/i, /swing away/i,
					/deafening strike/i, /blinding strike/i, /noise maker/i,
					/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
					/explosive flask/i, /instant barrier/i,
				], min: 1},
			],
		},

		// Other Trickster passives / scaling features.
		// Sticky Hands explicitly calls for a Dexterity (Sleight of
		// Hand) check with advantage to steal — perfect place for the
		// signature sleight-of-hand roll-button probe.
		{
			level: 9,
			name: /sticky hands/i,
			kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
			effects: [
				{kind: "rollSkillCheck", skill: "sleight of hand"},
			],
		},
		// The Switch (L13) — reactive Dexterity (Acrobatics) contest
		// against another creature; not state-observable.
		{level: 13, name: /the switch|switch/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
		// Master of Mischief (L17) — extends Quick Hands and refunds
		// trickster dice on item interaction; refund mechanics aren't
		// surfaced (CS-BUG-012 covers the underlying resource), so no
		// clean probe.
		{
			level: 17,
			name: /master of mischief/i,
			kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
		},
		{level: 17, untilLevel: 19, name: /sneak attack/i, kind: "passive", effects: [{kind: "sneakAttackDice", exact: 9}]},
		// CS-BUG-017: specialty pick count short past L11. Keep the helper
		// in the matrix (no-blind-spots doctrine) with every emitted row
		// marked skip+skipReason via withSkipReason.
		...withSkipReason(buildSpecialtyChecks("Rogue"), "CS-BUG-017"),
		// Trickster Tricks (TT optional features) — 3 picks at L3,
		// scaling to 7 by L19. Helper attaches per-pick effect probes.
		// CS-BUG-017: Trickster Tricks picks not surfacing.
		...withSkipReason(buildTricksterTrickChecks(), "CS-BUG-017"),
	],
});
