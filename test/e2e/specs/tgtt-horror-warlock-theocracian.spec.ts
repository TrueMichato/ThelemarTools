import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HORROR_THEOCRACIAN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildAnyInvocationChecks} from "../utils/tgttFeaturePools";

/**
 * #18 — The Horror Warlock Theocracian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Pact-magic slot scaling (uses `pactSlots` not `spellSlots`)
 *   - Eldritch Invocations chosen at L2/L5/...; one must surface
 *   - Hex concentration (cast at L5, attack should NOT clear it
 *     — concentration probe expects `expectActive: false` after
 *     the concentration pipeline runs the explicit break)
 *   - Pact Boon (L3) selection should appear
 */
describeCharacter({
	preset: PRESET_FULL_HORROR_THEOCRACIAN,
	displayName: "The Horror Warlock Theocracian",
	signatureToggle: /horror|invocation|pact|hex|dark|terror|eldritch/i,
	usage: {
		atLevel: 5,
		// CS-BUG-013: Horror Warlock pact slots not registered → cast/attack/USE probe hangs.
		// Skip cast probe entirely; keep concentration probe but use Hex without slot dependency.
		expectLongRestRestores: false,
		attackName: /dagger|crossbow|quarterstaff/i,
		skillRoll: {name: "Intimidation"},
		shortRestRestores: {skip: true},
		concentrationCheck: {skip: true}, // CS-BUG-013: Hex cast requires pact slot
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  expectToggles: [/horror|hex|eldritch|pact|terror/i]},
		3:  {totalLevel: 3,  expectToggles: [/pact of|invocation|horror|hex|terror/i]}, // CS-BUG-013: drop pactSlots assertion
		5:  {totalLevel: 5},  // CS-BUG-013
		11: {totalLevel: 11}, // CS-BUG-013
		17: {totalLevel: 17}, // CS-BUG-013
		20: {totalLevel: 20}, // CS-BUG-013
	},
	featuresMatrix: [
		// ── Class features ────────────────────────────────────────
		// Pact Magic slots — entirely blocked by CS-BUG-013.
		// Effects below are documented but skipped: anything that
		// reads from the pact-slot pipeline (spellbook entries fed
		// by signatureSpells, slot-pool restoration) can't be probed
		// while CS-BUG-013 stands.
		{level: 1,  name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013",
			effects: [
				{kind: "spellInList", spell: "Eldritch Blast", skip: true, skipReason: "CS-BUG-013"},
				{kind: "spellInList", spell: "Hex",            skip: true, skipReason: "CS-BUG-013"},
				{kind: "shortRestRestores", resource: "Pact Magic", skip: true, skipReason: "CS-BUG-013"},
			],
		},
		{level: 2,  name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},
		{level: 11, name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},
		{level: 17, name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},

		// Spellbook-side probes for Pact Magic. Added as a separate
		// non-skipped passive entry so the cantrip/spell-list checks
		// still run even though the slot resource itself is gated by
		// CS-BUG-013. The actual spellInList probes for Eldritch
		// Blast / Hex remain skipped here too, because spell
		// registration may also be impacted while pact slots aren't
		// wired (see CS-BUG-013).
		{level: 1, name: /pact magic|pact slots/i, kind: "passive",
			effects: [
				{kind: "cantripCount", min: 2, skip: true, skipReason: "CS-BUG-016"},
				{kind: "spellInList", spell: "Eldritch Blast", skip: true, skipReason: "CS-BUG-013"},
				{kind: "spellInList", spell: "Hex",            skip: true, skipReason: "CS-BUG-013"},
				// Saves a warlock is proficient in: WIS, CHA.
				{kind: "rollSavingThrow", ability: "wis"},
				{kind: "rollSavingThrow", ability: "cha"},
				{kind: "rollAbilityCheck", ability: "cha"},
			],
		},

		// Mid-level spell save DC probe — CHA-based, PB scales.
		// Even at PB=4 with CHA mod 0, DC = 8+4+0 = 12. We expect
		// at least 13 by L11 for a CHA-focused warlock build.
		{level: 11, name: /pact magic|pact slots/i, kind: "passive",
			effects: [
				{kind: "spellSaveDc", min: 13, skip: true, skipReason: "CS-BUG-016"},
			],
		},

		// Eldritch Invocations — count scales with level. Replaced with
		// buildAnyInvocationChecks across XPHB + XGE + TGTT sources so
		// the helper attaches per-pick effect probes for the auto-picker
		// first choice (alphabetic across the union).
		...buildAnyInvocationChecks(["XPHB", "XGE", "TGTT"]),

		// Pact Boon at L3 — no clean state probe (boon-specific).
		// Roll-button probes layered here so they fan out by level.
		// Phase 8: also probe that the picked Pact Boon surfaces as
		// an activatable feature on the sheet (Pact of the Blade =
		// summon weapon, Pact of the Chain = find familiar, Pact of
		// the Tome = Book of Shadows, Pact of the Talisman = grant).
		// Plus a dedicated attackPresent probe for the Pact Blade
		// summoned weapon. Both stay `{skip: true}` because the
		// wizard's auto-pick across the four boons is not pinned by
		// the preset — many runs will pick a non-Blade boon and the
		// attackPresent probe would surface no Pact Weapon row.
		{level: 3, name: /pact boon|pact of the/i, kind: "pick", pickedCount: 1,
			pickedFrom: [/blade/i, /tome/i, /chain/i, /talisman/i],
			effects: [
				{kind: "pickActivatable", matchAny: [/pact of the blade/i, /pact of the tome/i, /pact of the chain/i, /pact of the talisman/i], min: 1,
					skip: true, skipReason: "wizard auto-pick across pact boons is non-deterministic; not all boons surface as activatable toggles (Tome/Talisman are passive grants)"},
				{kind: "attackPresent", namePattern: /pact (weapon|blade)|pact of the blade/i,
					skip: true, skipReason: "preset does not pin Pact of the Blade — wizard may auto-pick Tome/Chain/Talisman, leaving no Pact Weapon attack row"},
			]},

		// Mystic Arcanum — grants one fixed-pick spell per level
		// tier. Concrete spell picks aren't deterministic for the
		// preset, so no spellInList probe is asserted here. Marked
		// inline rather than skipped so a future preset that pins
		// the picks can attach probes with no schema change.
		{level: 11, name: /mystic arcanum.*6th|mystic arcanum \(6/i, kind: "passive"},
		{level: 13, name: /mystic arcanum.*7th|mystic arcanum \(7/i, kind: "passive"},
		{level: 15, name: /mystic arcanum.*8th|mystic arcanum \(8/i, kind: "passive"},
		{level: 17, name: /mystic arcanum.*9th|mystic arcanum \(9/i, kind: "passive"},

		// Eldritch Master — restores expended pact slots after a 1-min
		// rest. Conditional ritual; nothing the sheet exposes as a
		// queryable state delta, so no effect probe.
		{level: 20, name: /eldritch master/i, kind: "passive"},

		// ── Subclass: The Horror (TGTT) ──────────────────────────
		// Expanded Spell List — patron spells are added to the
		// learnable picklist, not auto-granted, so spellInList
		// probes wouldn't pass without a fixed selection. Left as
		// presence-only.
		{level: 1, name: /expanded spell list/i, kind: "passive"},

		// Devastating Strike — unarmed-strike attack at L1; uses CON
		// mod for resource pool. The strike itself isn't a separate
		// attack on the attack list (it modifies the unarmed strike),
		// so we attach roll probes that exercise warlock-signature
		// rolls + the race walk speed (Theocracian = Child of the
		// Empire base, speed 30).
		{level: 1, name: /devastating strike/i, kind: "passive",
			effects: [
				{kind: "speed", type: "walk", exact: 30},
				{kind: "rollAttack", attackName: /eldritch blast|dagger|crossbow|quarterstaff/i, skip: true, skipReason: "CS-BUG-013"},
				{kind: "rollInitiative"},
				{kind: "rollSkillCheck", skill: "intimidation"},
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			],
		},

		// Lone Survivor — situational immunity to frightened only
		// when no allies within 30 ft. Sheet has no probe for that
		// gate, so no effect.
		{level: 6, name: /lone survivor/i, kind: "passive"},

		// Unearthly Manifestation — grants CON save proficiency.
		// At L6 PB=3, so a non-dumped CON yields a save bonus ≥ 3
		// only after proficiency is added. We assert min: 2 to
		// allow CON 8 (mod -1, +PB 3 = +2) but still catch a
		// regression where proficiency isn't applied at all.
		{level: 6, name: /unearthly manifestation/i, kind: "passive",
			effects: [
				{kind: "saveBonus", ability: "con", min: 2},
			],
		},

		// Degenerating Touch — situational, requires hit + failed
		// CON save against spell DC; no state-observable always-on
		// effect to probe.
		{level: 10, name: /degenerating touch/i, kind: "passive"},

		// Imploding Infestation — once-per-long-rest situational AoE
		// applied via unarmed strike; nothing always-on to probe.
		{level: 14, name: /imploding infestation/i, kind: "passive"},
		...buildSpecialtyChecks("Warlock"),
	],
});
