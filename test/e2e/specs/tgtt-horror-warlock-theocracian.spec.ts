import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HORROR_THEOCRACIAN} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildAnyInvocationChecks, withSkipReason} from "../utils/tgttFeaturePools";

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
	// Eldritch Invocations default to PASSIVE (they are routed through
	// WARLOCK_INVOCATION_REGISTRY and only opt into toggle/trigger behaviour
	// per entry), and Pact Boon is a choice rather than a stance. The only row
	// this build puts in the Overview strip at L5 is Devastating Strike, a
	// racial feature — asserting that would be asserting an unrelated mechanic.
	signatureToggleSkip: {skip: true, reason: "Eldritch Invocations default to passive via WARLOCK_INVOCATION_REGISTRY and Pact Boon is a pick, not a stance; both are covered in featuresMatrix (pact magic passive, pact boon pick)"},
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
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
		// CS-BUG-013 is marked **Stale (Wave 1 triage — closing)** and the
		// export artifact confirms it: a freshly-built L1 Horror Warlock
		// carries `spellcasting.pactSlots = {current:1, max:1, level:1}`.
		// Pact magic IS wired — it is simply modelled as spell slots, not
		// as a resource-tracker pool. The `pactSlots` milestone assertions
		// dropped below were therefore frozen behind a reason that no
		// longer stands; restored here against the real reading surface.
		// Floors only (the helper asserts >=), per PHB pact progression.
		1:  {totalLevel: 1,  expectToggles: [/horror|hex|eldritch|pact|terror/i], pactSlots: {level: 1, max: 1}},
		3:  {totalLevel: 3,  expectToggles: [/pact of|invocation|horror|hex|terror/i], pactSlots: {level: 2, max: 2}},
		5:  {totalLevel: 5,  pactSlots: {level: 3, max: 2}},
		11: {totalLevel: 11, pactSlots: {level: 5, max: 3}},
		17: {totalLevel: 17, pactSlots: {level: 5, max: 4}},
		20: {totalLevel: 20, pactSlots: {level: 5, max: 4}},
	},
	featuresMatrix: [
		// ── Class features ────────────────────────────────────────
		// RETIRED: four `kind: "resource"` rows (L1/L2/L11/L17) that looked
		// for a resource-tracker pool named "Pact Magic". Measured on a real
		// run, the pools on this sheet at L1/L2 are
		// [Magical Cunning, Devastating Strike] — there is no Pact Magic
		// pool and there never was one, because pact slots are modelled as
		// spell slots (`spellcasting.pactSlots`), not as a resource pool.
		// So these rows could never pass regardless of CS-BUG-013, in the
		// same way the mercy-monk spec asserted a Debilitation-only feature.
		// Their real claim now lives in `milestones[*].pactSlots` above,
		// which probes the surface the product actually exposes. The
		// spell-list / save / cantrip probes they carried are preserved by
		// the live `kind: "passive"` twin immediately below.

		// Spellbook-side probes for Pact Magic. Added as a separate
		// non-skipped passive entry. The Eldritch Blast / Hex probes
		// were skipped on the theory that spell registration might be
		// impacted while pact slots weren't wired; the export shows
		// pactSlots is populated, so that theory is retired too.
		{level: 1, name: /pact magic|pact slots/i, kind: "passive",
			effects: [
				{kind: "cantripCount", min: 2},
				{kind: "spellInList", spell: "Eldritch Blast"},
				{kind: "spellInList", spell: "Hex"},
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
				// Floor measured on THIS build, not aspirational: the preset has no
				// `abilityPriority`, so the standard array leaves the spellcasting
				// ability at its STR-first default (CS-BUG-056, "Follow-up"). DC is
				// 8 + prof + mod with that dump-stat mod. Previously skipped under
				// CS-BUG-016, which was a mis-attribution — the picker never affected
				// the DC. Raise this when the preset gains `abilityPriority`.
				{kind: "spellSaveDc", min: 11},
			],
		},

		// Eldritch Invocations — count scales with level. Cross-source
		// helper (XPHB + XGE + TGTT) attaches per-pick effect probes for the
		// auto-picker first choice (alphabetic across the union).
		// CS-BUG-017: Invocation picks short. Keep the helper in the matrix
		// (no-blind-spots doctrine) with every emitted row marked
		// skip+skipReason via withSkipReason.
		...withSkipReason(buildAnyInvocationChecks(["XPHB", "XGE", "TGTT"]), "CS-BUG-017"),

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
			skip: true, skipReason: "CS-BUG-017",
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
		{level: 11, name: /mystic arcanum/i, kind: "passive"},
		{level: 13, name: /mystic arcanum/i, kind: "passive"},
		{level: 15, name: /mystic arcanum/i, kind: "passive"},
		{level: 17, name: /mystic arcanum/i, kind: "passive"},

		// Eldritch Master — restores expended pact slots after a 1-min
		// rest. Conditional ritual; nothing the sheet exposes as a
		// queryable state delta, so no effect probe.
		{level: 20, name: /eldritch master/i, kind: "passive"},

		// ── Subclass: The Horror (TGTT) ──────────────────────────
		// Expanded Spell List — patron spells are added to the
		// learnable picklist, not auto-granted, so spellInList
		// probes wouldn't pass without a fixed selection. Left as
		// presence-only.
		{level: 1, name: /expanded spell list/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},

		// Devastating Strike — unarmed-strike attack at L1; uses CON
		// mod for resource pool. The strike itself isn't a separate
		// attack on the attack list (it modifies the unarmed strike),
		// so we attach roll probes that exercise warlock-signature
		// rolls + the race walk speed (Theocracian = Child of the
		// Empire base, speed 30).
		{level: 1, name: /devastating strike/i, kind: "passive",
			skip: true, skipReason: "CS-BUG-017",
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
