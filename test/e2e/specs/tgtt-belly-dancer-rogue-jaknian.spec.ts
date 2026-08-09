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
		// L9 and L13 are sampled so the Tantalizing Shivers and Fluid Step
		// rows have a checkpoint inside their windows. Without them those
		// subclass features had no live check at any level.
		9:  {totalLevel: 9,  minMaxHp: 48, expectResources: {"Dance of the Country": 4}},
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/tantalizing shivers|shivers/i]},
		13: {totalLevel: 13, minMaxHp: 70, expectResources: {"Dance of the Country": 5}},
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
		// Bonus Proficiency grants EXPERTISE in Performance + lets held
		// weapons be treated as Concealed (advantage on Dexterity
		// (Sleight of Hand) checks made to keep a weapon hidden).
		//
		// Both halves are probed for real:
		//   - `getSkillProficiency("performance") === 2` is expertise,
		//     not mere proficiency (1). The old spec skipped this on the
		//     assumption that "expertise wiring on TGTT subclasses is
		//     not consistently surfaced" — it is, via the generic text
		//     parser, and this assertion is the proof.
		//   - `hasConcealedWeapons` gates the Concealed advantage, which
		//     rides as a CONDITIONAL Sleight of Hand modifier (offered in
		//     the per-roll picker rather than silently auto-applied, per
		//     the repo's conditional-modifiers-gate-by-default rule).
		{
			level: 3,
			untilLevel: 4,
			name: /bonus proficiency/i,
			kind: "passive",
			effects: [
				{kind: "sneakAttackDice", exact: 2},
				{kind: "stateCall", method: "getSkillProficiency", args: ["performance"], exact: 2},
				{kind: "featureCalculation", property: "hasConcealedWeapons", exact: true},
			],
		},
		// Dance of the Country — bonus-action toggle. Uses = PB, short
		// rest recharge. While Dancing:
		//   +CHA AC (minimum +1), advantage on Dexterity (Acrobatics),
		//   and Sneak Attack in melee range WITHOUT needing advantage.
		// When it ends: a DC 10 CON save or a level of exhaustion.
		//
		// Every one of those is asserted, not just the AC.
		{
			level: 3,
			name: /dance of the country/i,
			kind: "toggle",
			toggleDelta: "ac",
			effects: [
				// "a bonus to AC equal to your Charisma modifier (minimum of
				// +1)". Jaknian's CHA mod is negative at L3, so the floor is
				// exactly what this build exercises — without it the probe
				// expects -1 and the correct +1 reads as a product bug.
				{kind: "togglePlusAc", whenActive: "abilityMod", ability: "cha", floor: 1},
				{
					kind: "toggleGrantsAdvantage",
					rollType: "skill:acrobatics",
				},
				// CS-BUG-014 regression guard: the dance must NOT grant
				// Athletics advantage. Probed state-side because the
				// toggle probe only takes one rollType.
				{kind: "stateCall", method: "activateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "getSkillAdvantageState", args: ["acrobatics"], path: "advantage", exact: true},
				{kind: "stateCall", method: "getSkillAdvantageState", args: ["athletics"], path: "advantage", exact: false},
				// Sneak Attack licence — melee only, and only while Dancing.
				{kind: "stateCall", method: "canSneakAttackWithoutAdvantage", args: [{isMelee: true}], exact: true},
				{kind: "stateCall", method: "canSneakAttackWithoutAdvantage", args: [{isMelee: false}], exact: false},
				{kind: "stateCall", method: "deactivateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "canSneakAttackWithoutAdvantage", args: [{isMelee: true}], exact: false},
				// End-of-dance DC 10 CON save → one level of exhaustion.
				{kind: "stateCall", method: "getStateEndSave", args: ["dancing"], path: "dc", exact: 10},
				{kind: "stateCall", method: "getStateEndSave", args: ["dancing"], path: "ability", exact: "con"},
				{kind: "stateCall", method: "resolveStateEndSave", args: ["dancing", {total: 1}], path: "exhaustionGained", exact: 1},
				{kind: "stateCall", method: "getExhaustion", min: 1},
			],
		},
		// Uses = proficiency bonus, so the windows must track PB exactly:
		// L1-4 → 2, L5-8 → 3, L9-12 → 4, L13-16 → 5, L17-20 → 6.
		// (The previous windows were only correct at the old checkpoint
		// set; sampling L9 and L13 exposes them.)
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
			untilLevel: 8,
			resourceMax: 3,
			restoreOn: "short",
		},
		{
			level: 9,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 12,
			resourceMax: 4,
			restoreOn: "short",
		},
		{
			level: 13,
			name: "Dance of the Country",
			kind: "resource",
			untilLevel: 16,
			resourceMax: 5,
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
		// Tantalizing Shivers (L9) — a bonus action WHILE DANCING that
		// opens a Charisma (Performance) contest against the target's
		// Wisdom (Insight). On a win the target is charmed, incapacitated
		// with speed 0, and you get advantage on attacks against it.
		//
		// Probed as a real gated toggle, not just "the text renders":
		//   - the contest descriptor is null outside the Dance and
		//     populated inside it (the "while Dancing" clause),
		//   - the contest modifier is the live Performance modifier,
		//   - activating it grants advantage on ATTACKS,
		//   - it drops automatically when the Dance ends.
		{
			level: 9,
			name: /tantalizing shivers/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasTantalizingShivers", exact: true},
				// Outside the Dance there is no contest to run
				// ("a bonus action while Dancing").
				{kind: "stateCall", method: "getTantalizingShiversContest", isNull: true},
				{kind: "stateCall", method: "activateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "getTantalizingShiversContest", path: "skill", exact: "performance"},
				{kind: "stateCall", method: "getTantalizingShiversContest", path: "ability", exact: "cha"},
				{kind: "stateCall", method: "getTantalizingShiversContest", path: "opposedBy", contains: "Insight"},
				// Advantage on attacks only once the Shivers land.
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack"], exact: false},
				{kind: "stateCall", method: "activateState", args: ["tantalizingShivers"], ignoreResult: true},
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack"], exact: true},
				// Ending the Dance ends its dependents.
				{kind: "stateCall", method: "deactivateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["tantalizingShivers"], exact: false},
			],
		},
		// Fluid Step (L13) — "You gain the benefit of the Disengage
		// action while Dancing, and other creatures cannot gain the
		// benefit of Disengaging from you while you are Dancing."
		//
		// The first half is a real, queryable mechanic
		// (`hasActionBenefitFromStates("disengage")`, driven by the
		// generic `grantsActionBenefit` state effect). The second half is
		// an effect on ENEMIES, which the sheet does not model — it is
		// surfaced as a rules note instead (see CS-BUG-115).
		{
			level: 13,
			name: /fluid step/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasFluidStep", exact: true},
				{kind: "stateCall", method: "hasActionBenefitFromStates", args: ["disengage"], exact: false},
				{kind: "stateCall", method: "activateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "hasActionBenefitFromStates", args: ["disengage"], exact: true},
				{kind: "stateCall", method: "deactivateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "hasActionBenefitFromStates", args: ["disengage"], exact: false},
			],
		},
		// Percussive Strike (L17) — when the Dance BEGINS, every hostile
		// creature that can see you makes a Wisdom save, DC 8 + PB + CHA
		// mod; a failure gives you advantage on attacks against it for
		// the rest of the Dance.
		//
		// The DC is asserted to be DERIVED (8 + PB + CHA), not a constant,
		// and the toggle is asserted to be gated behind an active Dance.
		{
			level: 17,
			untilLevel: 19,
			name: /percussive strike/i,
			kind: "passive",
			effects: [
				{kind: "rollAbilityCheck", ability: "cha"},
				{kind: "sneakAttackDice", exact: 9},
				{kind: "featureCalculation", property: "hasPercussiveStrike", exact: true},
				// DC = 8 + PB + CHA mod. At L17 PB is +6, so the DC is
				// 14 + CHA mod — derived from a live statistic, floored
				// well above any constant a stub could return.
				{kind: "featureCalculationDerivedFrom", property: "percussiveStrikeDc", equals: "abilityMod", ability: "cha", offset: 14},
				// Jaknian dumps Charisma (mod -1 at 17), so the DC here is
				// 14 - 1 = 13. The previous `min: 15` silently presumed a
				// positive CHA and failed on the correct value — the
				// derivation check above is what actually rules out a
				// constant; this one only proves the METHOD returns the same
				// live number as the calculation key.
				{kind: "stateCall", method: "getPercussiveStrikeDc", min: 13},
				// Gated behind the Dance, and grants attack advantage.
				{kind: "stateCall", method: "activateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack"], exact: false},
				{kind: "stateCall", method: "activateState", args: ["percussiveStrike"], ignoreResult: true},
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack"], exact: true},
				{kind: "stateCall", method: "deactivateState", args: ["dancing"], ignoreResult: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["percussiveStrike"], exact: false},
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
