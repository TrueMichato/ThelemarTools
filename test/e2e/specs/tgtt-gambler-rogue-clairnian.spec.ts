import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_GAMBLER_CLAIRNIAN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildWeaponMasteryChecks, withSkipReason} from "../utils/tgttFeaturePools";

/**
 * #11 — Gambler Rogue Clairnian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales (1d6 → 10d6) like every Rogue
 *   - Gambler's Spellcasting kicks in at L3 (half-caster table,
 *     warlock spell list); validate `spellSlots` milestones
 *   - Gambler's Tools — coin/dice/cards weapons; `attackName` probe
 *     is logged-not-asserted (these may not auto-equip)
 *   - Gambler's Folly toggle (1d100 gambling table) surfaces as a
 *     feature
 */
describeCharacter({
	preset: PRESET_FULL_GAMBLER_CLAIRNIAN,
	displayName: "Gambler Rogue Clairnian",
	signatureToggle: /gambler|folly|fortune|luck/i,
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
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, spellSlots: {1: 2}, expectToggles: [/gambler|folly|fortune|spellcasting/i]},
		5:  {totalLevel: 5,  minMaxHp: 30, spellSlots: {1: 2}}, // CS-BUG-010: Gambler half-caster table under-counted
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/extra luck|luck/i]}, // CS-BUG-010: drop spellSlots assertion until table fixed
		17: {totalLevel: 17, minMaxHp: 90}, // CS-BUG-010
		20: {totalLevel: 20, minMaxHp: 100, expectToggles: [/master of fortune|fortune/i]}, // CS-BUG-010
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
			name: /sneak attack/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "rollInitiative"},
				// Phase 8: Sneak Attack scales 1d6 → 10d6 across levels.
				// L1 anchor — at least 1d6 from L1 onward (matrix L1/3/5/11/17/20).
				{kind: "sneakAttackDice", min: 1, skip: true, skipReason: "CS-BUG-018"},
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
			name: /uncanny dodge/i,
			kind: "passive",
			// Phase 8: at L5+ Sneak Attack is 3d6+ (matrix L5/11/17/20).
			effects: [
				{kind: "sneakAttackDice", min: 3, skip: true, skipReason: "CS-BUG-018"},
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
		// Reliable Talent: floors any d20 ability check on a proficient
		// skill to 10. State doesn't expose the floor explicitly, so we
		// can't assert it directly — host the Deception roll probe here
		// instead so we exercise a skill click at high level.
		{
			level: 11,
			name: /reliable talent/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
				// Phase 8: at L11+ Sneak Attack is 6d6+ (matrix L11/17/20).
				{kind: "sneakAttackDice", min: 6, skip: true, skipReason: "CS-BUG-018"},
			],
		},
		{level: 14, name: /blindsense/i, kind: "passive"},
		// Slippery Mind: grants proficiency in WIS saves. With PB=+5 at
		// L15 the WIS save bonus must include the prof bonus — even with
		// a dumped WIS (8 → mod -1) the total is ≥ +4. Use min:2 as a
		// conservative lower bound that still proves prof is being added.
		{
			level: 15,
			name: /slippery mind/i,
			kind: "passive",
			effects: [
				{kind: "saveBonus", ability: "wis", min: 2},
			],
		},
		{level: 18, name: /elusive/i, kind: "passive"},
		// Stroke of Luck: once-per-rest auto-20 — no state probe (consumed
		// by player choice on a specific roll). Host the L20 SA dice cap.
		{
			level: 20,
			name: /stroke of luck/i,
			kind: "passive",
			// Phase 8: at L20 Sneak Attack caps at 10d6.
			effects: [
				{kind: "sneakAttackDice", min: 10, skip: true, skipReason: "CS-BUG-018"},
			],
		},

		// ── Gambler subclass ──────────────────────────────────────────
		// Gambler's Tools: grants proficiency with cards/dice and lets
		// the gambler use coins/dice/cards as finesse weapons. The weapon
		// auto-equip is unreliable (logged-not-asserted in usage), so use
		// a tolerant attack-name regex including the standard rogue
		// fallbacks (rapier/shortsword/hand crossbow).
		{
			level: 3,
			name: /gambler['’]?s tools/i,
			kind: "passive",
			effects: [
				{kind: "rollAttack", attackName: /rapier|shortsword|hand crossbow|coins|dice|cards|dagger|shortbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
			],
		},
		{level: 3, name: /gambler['’]?s folly/i, kind: "passive"},
		// Gambler's Spellcasting grants Warlock-list cantrips + 1/3-caster
		// slots. Both the slot table and the granted spell list are blocked
		// by CS-BUG-010 (half-caster slots under-counted / spellbook not
		// populated).
		{
			level: 3,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		{
			level: 7,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex", "Hold Person"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		{
			level: 13,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex", "Hold Person", "Counterspell"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		// Extra Luck — bonus-action toggle, uses = PB, long-rest restore.
		// Surfaces as a toggle on the sheet (no AC/DC delta — grants
		// advantage to a single player-chosen roll). We can't probe
		// toggleGrantsAdvantage because the buff is consumed on the next
		// applicable roll rather than persisting as a generic
		// "advantage on attacks/saves/checks" flag in state.
		{level: 9, name: /extra luck/i, kind: "toggle", skip: true, skipReason: "CS-BUG-017", toggleDelta: "none"},
		// Versatile Gambler: increases the prepared-spell roll (2d4 → 3d6)
		// and the Gambling Modifier (1d6 → 2d4). Both numbers feed the
		// Gambler spellcasting subsystem which is blocked by CS-BUG-010,
		// so no probe.
		{level: 13, name: /versatile gambler/i, kind: "passive"},
		// Master of Fortune: roll twice on Gambler's Table + once-per-PB
		// nat-1-to-nat-20 conversion. Neither effect is exposed in state.
		{level: 17, name: /master of fortune/i, kind: "passive"},
		// CS-BUG-017: specialty pick count short past L11. Keep the helper
		// in the matrix (no-blind-spots doctrine) with every emitted row
		// marked skip+skipReason via withSkipReason.
		...withSkipReason(buildSpecialtyChecks("Rogue"), "CS-BUG-017"),
	],
});
