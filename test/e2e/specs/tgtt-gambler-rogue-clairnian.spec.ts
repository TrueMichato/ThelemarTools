import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_GAMBLER_CLAIRNIAN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildWeaponMasteryChecks, withSkipReason} from "../utils/tgttFeaturePools";

/**
 * #11 — Gambler Rogue Clairnian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales (1d6 → 10d6) like every Rogue
 *   - Gambler's Spellcasting: the subclass publishes its OWN slot table
 *     (`subclassTableGroups[].rowsSpellProgression`), which deviates from
 *     generic third-caster math at L10-12 (4/2, not 4/3). The milestones
 *     below pin the published grid — this is the assertion CS-BUG-010 was
 *     filed against, and its "Test follow-up" asked for exactly this.
 *   - Gambler's Tools — coins/dice/cards arrive as EQUIPPED weapons, so
 *     they must show up as rollable attacks, and the coins must carry the
 *     "ignores half cover" rider.
 *   - Gambler's Folly — casting through an implement is a bet whose odds
 *     depend on the slot level, resolved against a d100 table.
 *   - Extra Luck (L9) and Master of Fortune (L17) are real, spendable,
 *     long-rest resources that feed the generic d20 fortune-intervention
 *     API (`getD20InterventionOffers` / `applyD20Intervention`).
 */
describeCharacter({
	preset: PRESET_FULL_GAMBLER_CLAIRNIAN,
	displayName: "Gambler Rogue Clairnian",
	signatureToggle: /gambler|folly|fortune|luck/i,
	// TGTT Gambler's signature abilities alter dice OUTCOMES (roll twice on the
	// Gambler's Table, treat a natural 1 as a natural 20, cast-as-a-bet d100)
	// rather than any derived stat, so probeToggleDelta has nothing to observe.
	// The toggle is still required to surface and activate.
	signatureToggleNoDerivedEffect: "Gambler abilities modify dice outcomes, not AC/DC/speed/attacks/damage",
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: undefined,
		expectLongRestRestores: false,
		attackName: /coins|dice|cards|dagger|shortbow/i,
		skillRoll: {name: "Sleight of Hand"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Hex", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	// The Gambler's published "Spell Slots per Spell Level" table, pinned
	// level by level. `assertMilestone` asserts `slots.max >= n`, and the
	// published grid is monotonic, so these bounds are exact in practice.
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, spellSlots: {1: 2}, expectToggles: [/gambler|folly|fortune|spellcasting/i]},
		5:  {totalLevel: 5,  minMaxHp: 30, spellSlots: {1: 3}},
		11: {totalLevel: 11, minMaxHp: 60, spellSlots: {1: 4, 2: 2}, expectToggles: [/extra luck|luck/i]},
		17: {totalLevel: 17, minMaxHp: 90, spellSlots: {1: 4, 2: 3, 3: 3}},
		20: {totalLevel: 20, minMaxHp: 100, spellSlots: {1: 4, 2: 3, 3: 3, 4: 1}, expectToggles: [/master of fortune|fortune/i]},
	},
	featuresMatrix: [
		// XPHB Weapon Mastery — Rogue picks Club + Dagger (first two
		// proficient simple weapons in DOM order, deterministic).
		...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
		// ── Rogue base ────────────────────────────────────────────────
		// Sneak Attack: damage scales 1d6/2 levels — no clean state probe
		// (the bonus damage applies only to qualifying attacks). Use this
		// entry as a host for the DEX-save roll probe (rogues are
		// proficient in DEX saves from L1) and the initiative click probe.
		{
			level: 1,
			untilLevel: 4,
			name: /sneak attack/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "rollInitiative"},
				{kind: "sneakAttackDice", exact: 2},
			],
		},
		{level: 1, name: /thieves['’]? cant/i, kind: "passive"},
		// Cunning Action: bonus-action Dash/Disengage/Hide. No
		// state-observable delta; host the Sleight of Hand skill probe
		// here (signature rogue skill).
		{
			level: 2,
			name: /cunning action/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", skill: "sleight of hand", skip: true, skipReason: "CS-BUG-017"},
			],
		},
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
		// Evasion: half/no damage on DEX saves vs AoE — not state-probed.
		// Host the INT-save roll probe (rogues are proficient in INT
		// saves) and a CHA ability-check probe here.
		{
			level: 7,
			name: /evasion/i,
			kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
			effects: [
				{kind: "rollSavingThrow", ability: "int"},
				{kind: "rollAbilityCheck", ability: "cha"},
			],
		},
		// Reliable Talent floors any d20 ability check on a proficient
		// skill to 10; assert that calculation directly.
		{
			level: 11,
			untilLevel: 16,
			name: /reliable talent/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
				{kind: "featureCalculation", property: "reliableTalentMinimum", exact: 10},
				{kind: "sneakAttackDice", exact: 6},
			],
		},
		{level: 14, name: /blindsense/i, kind: "passive"},
		// Slippery Mind: grants proficiency in WIS saves. With PB=+5 at
		// L15 the WIS save bonus must include the prof bonus — even with
		// a dumped WIS (8 → mod -1) the total is ≥ +4. Use min:2 as a
		// conservative lower bound that still proves prof is being added.
		{
			level: 15,
			untilLevel: 19,
			name: /slippery mind/i,
			kind: "passive",
			effects: [
				{kind: "saveBonus", ability: "wis", min: 2},
				{kind: "sneakAttackDice", exact: 9},
			],
		},
		{level: 18, name: /elusive/i, kind: "passive"},
		// Stroke of Luck: once-per-rest auto-20 — no state probe (consumed
		// by player choice on a specific roll). Host the L20 SA dice cap.
		{
			level: 20,
			name: /stroke of luck/i,
			kind: "passive",
			// Stroke of Luck is a player-chosen auto-20 with no persistent
			// state-facing effect; pin the Rogue's exact capstone damage tier.
			effects: [
				{kind: "sneakAttackDice", exact: 10},
			],
		},

		// ── Gambler subclass ──────────────────────────────────────────
		// Gambler's Tools grants proficiency with playing-card and dice
		// sets AND injects the three implement weapons (coins 1d4 P,
		// dice 1d6 B, cards 1d8 S — all finesse/thrown) as EQUIPPED
		// inventory, so each must reach the Attacks panel and be
		// rollable. The coins additionally carry the ricochet rider:
		// a ranged attack with them treats half cover as no cover.
		{
			level: 3,
			name: /gambler['’]?s tools/i,
			kind: "passive",
			effects: [
				{kind: "attackPresent", namePattern: /coins/i},
				{kind: "attackPresent", namePattern: /dice/i},
				{kind: "attackPresent", namePattern: /cards/i},
				{kind: "rollAttack", attackName: /coins/i},
				// The rider mechanism itself: the coins declare a rider that
				// `getAttackRiderNotes` surfaces on the attack row and in the
				// roll toast.
				{
					kind: "stateCall",
					method: "getAttackRiderNotes",
					args: [{name: "Gambler's Coins", sourceItem: {name: "Gambler's Coins", _isGamblerWeapon: true}}],
					contains: "half cover",
				},
			],
		},
		// Gambler's Folly: casting through an implement is a bet. A loss
		// forces a d100 Gambling Table roll, so the table must be live.
		{
			level: 3,
			name: /gambler['’]?s folly/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasGamblerFolly", exact: true},
				{kind: "stateCall", method: "rollGamblingTable", path: "effect"},
			],
		},
		// Gambler's Spellcasting: warlock-list cantrips + the subclass's
		// own slot table + a rolled "Gambling Modifier" INSTEAD of a
		// spellcasting ability. All three are asserted.
		//
		// kind is "passive", not "spells": the feature grants a CHOICE of
		// warlock cantrips plus 2d4 randomly-prepared spells, so there is
		// no fixed `grantsSpells` list to pin. `cantripCount` asserts the
		// choice actually resolved into the spellbook.
		{
			level: 3,
			// Bounded at 12: Versatile Gambler (L13) legitimately upgrades
			// both dice, and the L13 row below asserts the new values.
			untilLevel: 12,
			name: /gambler['’]?s spellcasting/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasGamblerSpellcasting", exact: true},
				{kind: "featureCalculation", property: "gamblerModifierDice", exact: "1d6"},
				{kind: "featureCalculation", property: "gamblerSpellsPreparedDice", exact: "2d4"},
				{kind: "spellSlots", level: 1, min: 2},
				// 3 cantrips from the warlock list, minted as pending
				// subclass cantrip choices and drained by the wizard.
				{kind: "cantripCount", min: 3},
			],
		},
		{
			level: 7,
			name: /gambler['’]?s spellcasting/i,
			kind: "passive",
			effects: [
				{kind: "spellSlots", level: 1, min: 4},
				{kind: "spellSlots", level: 2, min: 2},
			],
		},
		// L10 is the cantrip bump published by the subclass's own
		// `cantripProgression` (3 → 4). This is the assertion that proves
		// the subclass cantrip-choice slots survive level-up, not just
		// character creation.
		{
			level: 10,
			name: /gambler['’]?s spellcasting/i,
			kind: "passive",
			effects: [
				{kind: "cantripCount", min: 4},
			],
		},
		{
			level: 13,
			name: /gambler['’]?s spellcasting/i,
			kind: "passive",
			effects: [
				{kind: "spellSlots", level: 3, min: 2},
			],
		},
		// Extra Luck — bonus action, advantage on an attack/check/save,
		// uses = PB, restored on a long rest, and every use forces a
		// Gambling Table roll. A real spendable resource AND a real offer
		// in the generic post-roll d20 intervention API.
		{
			level: 9,
			untilLevel: 16,
			name: /extra luck/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculationDerivedFrom", property: "extraLuckUses", equals: "proficiencyBonus"},
				{kind: "longRestRestores", resource: "Extra Luck"},
				// The intervention API must OFFER Extra Luck on a low roll…
				{
					kind: "stateCall",
					method: "getD20InterventionOffers",
					args: [{naturalRoll: 3, effectiveRoll: 3, rollType: "attack"}],
					contains: "gamblerExtraLuck",
				},
				// …and applying it must actually spend a use and re-roll.
				{
					kind: "stateCall",
					method: "applyD20Intervention",
					args: ["gamblerExtraLuck", {naturalRoll: 3, effectiveRoll: 3}],
					path: "applied",
					exact: true,
				},
			],
		},
		// Versatile Gambler: the prepared-spell roll becomes 3d6 and the
		// Gambling Modifier becomes 2d4. Both are live calculations.
		{
			level: 13,
			name: /versatile gambler/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "gamblerModifierDice", exact: "2d4"},
				{kind: "featureCalculation", property: "gamblerSpellsPreparedDice", exact: "3d6"},
			],
		},
		// Master of Fortune: roll TWICE on the Gambling Table and choose,
		// plus PB/day treat a natural 1 as a natural 20.
		{
			level: 17,
			name: /master of fortune/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculationDerivedFrom", property: "masterOfFortuneUses", equals: "proficiencyBonus"},
				{kind: "longRestRestores", resource: "Master of Fortune"},
				// Two rolls, and the result is flagged as needing a choice.
				{kind: "stateCall", method: "rollGamblingTable", path: "needsChoice", exact: true},
				// The nat-1 → nat-20 conversion is offered and applies.
				{
					kind: "stateCall",
					method: "getD20InterventionOffers",
					args: [{naturalRoll: 1, effectiveRoll: 1, rollType: "save"}],
					contains: "gamblerMasterOfFortune",
				},
				{
					kind: "stateCall",
					method: "applyD20Intervention",
					args: ["gamblerMasterOfFortune", {naturalRoll: 1, effectiveRoll: 1}],
					path: "effectiveRoll",
					exact: 20,
				},
			],
		},
		// CS-BUG-017: specialty pick count short past L11. Keep the helper
		// in the matrix (no-blind-spots doctrine) with every emitted row
		// marked skip+skipReason via withSkipReason.
		...withSkipReason(buildSpecialtyChecks("Rogue"), "CS-BUG-017"),
	],
});
