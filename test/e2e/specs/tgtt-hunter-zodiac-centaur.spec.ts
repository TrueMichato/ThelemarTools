import {describeCharacter, describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HUNTER_CENTAUR, PRESET_FULL_ZODIAC_CENTAUR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildCombatMethodChecks, buildSpecialtyChecks, buildWeaponMasteryChecks, buildZodiacFormChecks} from "../utils/tgttFeaturePools";

// ─────────────────────────────────────────────────────────────────────
// Hunter Ranger L20 standalone features matrix (TGTT Ranger + XPHB
// Hunter subclass). Centaur racials (Powerful Build / Hooves /
// Equine Build = walk 40) ride along on the L1 entry's effects.
// Ranger TGTT proficient saves: STR + DEX. Hunter's Mark is always
// prepared at L1 (TGTT additionalSpells). Equipment: longbow,
// shortsword, scimitar, studded leather.
// ─────────────────────────────────────────────────────────────────────
const HUNTER_FEATURES_MATRIX: FeatureCheck[] = [
	// XPHB Weapon Mastery — Ranger picks Club + Dagger (first two
	// proficient simple weapons in DOM order, deterministic).
	...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
	// L1 Spellcasting — also our anchor for the racial walk-speed
	// probe (Centaur is a 40-ft race), the always-prepared Hunter's
	// Mark, and the L1 roll-button smoke probes (STR/DEX saves —
	// Ranger proficient — Perception skill, Initiative button).
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Hunter's Mark"},
			// Centaur Equine Build base walk speed = 40 ft.
			{kind: "speed", type: "walk", min: 40},
			{kind: "rollSavingThrow", ability: "str"},
			{kind: "rollSavingThrow", ability: "dex"},
			{kind: "rollSkillCheck", skill: "perception", skip: true, skipReason: "CS-BUG-017"},
			{kind: "rollInitiative"},
		],
	},
	// L1 Favored Enemy / Primal Focus (TGTT-flavored opener).
	{level: 1, name: /primal focus|favored enemy/i, kind: "passive"},
	// L2 Combat Methods (TGTT). The parent feature row, plus the real
	// per-method assertions from buildCombatMethodChecks: the count
	// ladder off the Ranger class table, and the two methods Primal
	// Focus Upgrade grants outright at L6 (Groundshatter / Singular
	// Focus) asserted by name. Previously this was a lone `passive`
	// on the parent row, which asserted nothing about the methods.
	{level: 2, name: /combat methods/i, kind: "passive"},
	...buildCombatMethodChecks("Ranger", {subclassName: "Hunter"}),
	// L3 Hunter's Lore — passive subclass info feature.
	{level: 3, name: /hunter's lore|hunters lore/i, kind: "passive"},
	{level: 3, name: /hunter's prey|hunters prey/i, kind: "pick",
		skip: true, skipReason: "CS-BUG-017",
		pickedFrom: [/colossus slayer/i, /giant killer/i, /horde breaker/i]},
	// L5 Extra Attack — anchor for the weapon-attack roll-button
	// probe. The TGTT Ranger starting kit guarantees a longbow,
	// shortsword, and scimitar. Phase 8: also a good slot for the
	// half-caster spellSaveDc scaling floor (8 + prof + WIS mod;
	// at L5 prof=3 + WIS≥10 → DC ≥ 11; at L20 prof=6 → DC ≥ 14).
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
			{kind: "spellSaveDc", min: 11},
		],
	},
	// L6 Roving — XPHB Ranger speed-boost passive (no extra probe;
	// the Phase-7 toggleable speed-delta shape is for active toggles).
	{level: 6, name: /roving/i, kind: "passive"},
	// L7 Defensive Tactics pick — XPHB Hunter (Escape the Horde /
	// Multiattack Defense / Steel Will). Steel Will grants advantage
	// on saves vs frightened (not a sheet-exposed advantage state),
	// and Multiattack Defense is the post-first-hit +4 AC reaction
	// (situational, not exposed). Pick coverage only.
	{level: 7, name: /defensive tactics/i, kind: "pick", skip: true, skipReason: "CS-BUG-017",
		pickedFrom: [/escape the horde/i, /multiattack defense/i, /steel will/i]},
	// L9 Expertise — passive (which skills get expertise is the
	// player's choice; no clean state probe).
	{level: 9, name: /expertise/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// L10 Tireless — passive XPHB feature (temp HP on prof bonus
	// expenditure; resource handling is class-internal).
	{level: 10, name: /tireless/i, kind: "passive"},
	// L11 Superior Hunter's Prey (XPHB) — passive damage augment.
	// Hint #5 calls this slot Multiattack/Volley/Whirlwind (legacy
	// PHB Hunter) so the regex covers both names; the rollAttack
	// probe verifies the weapon roll button still fires at L11+.
	{
		level: 11,
		name: /superior hunter's prey|multiattack|volley|whirlwind/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},
	// L13 Relentless Hunter — passive concentration-save buffer.
	{level: 13, name: /relentless hunter/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// L14 Nature's Veil (XPHB) — Invisibility-like reaction; not a
	// toggle the matrix can probe via stat delta.
	{level: 14, name: /nature's veil|natures veil/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// L15 Superior Hunter's Defense pick — XPHB (Evasion / Stand
	// Against the Tide / Uncanny Dodge); no state probe.
	{level: 15, name: /superior hunter's defense|superior hunters defense/i, kind: "passive"},
	// L17 Precise Hunter — passive advantage against Hunter's Mark
	// target (situational; not surfaced as a global advantage flag).
	{level: 17, name: /precise hunter/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// L18 Feral Senses — passive (limited-blindsight against
	// Hunter's Mark target).
	{level: 18, name: /feral senses/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// L19 Epic Boon — chooses a feat; passive listing.
	{level: 19, name: /epic boon|ability score improvement/i, kind: "passive"},
	// L20 Foe Slayer — passive damage adder vs Hunter's Mark target.
	{level: 20, name: /foe slayer/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
	// TGTT Specialties (Ranger: 2/5/9/13/17) — per-pick effects.
	...buildSpecialtyChecks("Ranger"),
];

// ─────────────────────────────────────────────────────────────────────
// Zodiac Druid L20 standalone features matrix (TGTT Druid + TGTT
// Circle of the Zodiac subclass). Druid TGTT proficient saves:
// INT + WIS. Wild Shape is a 2-use, short-rest resource. Centaur
// racials (walk 40) ride on the L1 entry.
// ─────────────────────────────────────────────────────────────────────
const ZODIAC_FEATURES_MATRIX: FeatureCheck[] = [
	// L1 Spellcasting — racial speed probe + signature signature
	// spell + WIS save (Druid proficient) + Nature skill probe +
	// Initiative button. Phase 8: cantripCount floor — Druid L1
	// grants 2 cantrips (signatureSpells: Druidcraft + autoFill).
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Druidcraft"},
			{kind: "speed", type: "walk", min: 40},
			{kind: "rollSavingThrow", ability: "wis"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			{kind: "rollInitiative"},
			{kind: "cantripCount", min: 2},
		],
	},
	// L1 Druidic — passive subclass-language feature.
	{level: 1, name: /druidic/i, kind: "passive"},
	// L1 Primal Order — TGTT/XPHB primal-order pick (Magician /
	// Warden). Both surface as feature listings; treat as passive.
	{level: 1, name: /primal order/i, kind: "passive"},
	// L2 Wild Shape — short-rest restored, and the pool GROWS: TGTT
	// Druid class table reads 2 uses at Druid 2-5, 3 at Druid 6-16,
	// 4 at Druid 17+. A single `resourceMax: [2, 2]` at level 2 is
	// re-evaluated at every later checkpoint and so fails by
	// construction from L11 on — the CS-BUG-018 stale-ladder shape.
	//
	// ⚠️ UNVERIFIED, and deliberately disclosed as such: this matrix
	// currently aborts at its FIRST checkpoint (L3) on an unrelated
	// `Zodiac Form: Month` / Aurochs `pickActivatable` failure, so
	// checkpoints 5/11/17/20 have never executed and this ladder
	// cannot be run green today. Tiered from the class table rather
	// than from a measurement, to save the next session the round it
	// would otherwise burn once the L3 red is cleared. The identical
	// ladder IS measured-and-green on the multiclass leg below.
	{
		level: 2,
		untilLevel: 5,
		name: /wild shape/i,
		kind: "resource",
		resourceMax: [2, 2],
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Wild Shape"},
		],
	},
	{level: 6, untilLevel: 16, name: /wild shape/i, kind: "resource", resourceMax: [3, 3], restoreOn: "short"},
	{level: 17, name: /wild shape/i, kind: "resource", resourceMax: [4, 4], restoreOn: "short"},
	{level: 2, name: /wild companion/i, kind: "passive"},
	// L3 Druid Circle (Zodiac).
	{level: 3, name: /circle of the zodiac|druid circle/i, kind: "passive"},
	// L3 Zodiac Form: Month — 12 constellation features (Beaver / Aurochs
	// / Horse / Octopus / Peacock / Roc / Bee / Hound / Cat / Griffon /
	// Bulette / Phoenix). Catalog helper asserts every form surfaces and
	// attaches a representative effect probe (Roc — flight via Wild Shape).
	// Also covers L10 Star Week (Sequoia / Unicorn / Raven / etc.).
	...buildZodiacFormChecks(),
	// L4 ASI — also a good slot for an INT save roll-button probe
	// (Druid's other proficient save).
	{
		level: 4,
		name: /ability score improvement/i,
		kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "int"},
		],
	},
	// L5 Wild Resurgence — passive 1/long-rest Hunter's-Mark-style
	// recovery. Phase 8: full-caster spellSaveDc scaling floor
	// (8 + prof + WIS mod; at L5 prof=3, WIS≥10 → DC ≥ 11; at
	// L20 prof=6 → DC ≥ 14).
	{
		level: 5,
		name: /wild resurgence/i,
		kind: "passive",
		effects: [
			{kind: "spellSaveDc", min: 11},
		],
	},
	// L7 Elemental Fury — TGTT Druid passive (XPHB equivalent
	// "Elemental Fury" pick of Potent Spellcasting / Primal Strike).
	// Anchor a weapon-attack probe here; druid's starting kit gives
	// quarterstaff / scimitar / club.
	{
		level: 7,
		name: /elemental fury|potent spellcasting|primal strike/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /quarterstaff|scimitar|club/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},
	// L8 ASI.
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	// L10 Zodiac Form: Star Week — 12 constellation features (covered by
	// buildZodiacFormChecks() above).
	// L12 ASI.
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	// L14 Full Zodiac — Zodiac capstone subclass feature.
	{level: 14, name: /full zodiac/i, kind: "passive"},
	// L15 Improved Elemental Fury (XPHB druid).
	{level: 15, name: /improved elemental fury/i, kind: "passive"},
	// L16 ASI.
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	// L18 Beast Spells — passive (cast spells while in Wild Shape).
	{level: 18, name: /beast spells/i, kind: "passive"},
	// L19 Epic Boon.
	{level: 19, name: /epic boon|ability score improvement/i, kind: "passive"},
	// L20 Archdruid — passive capstone (Wild Shape becomes effectively
	// at-will + magic-item attunement bypass on natural items).
	{level: 20, name: /archdruid/i, kind: "passive"},
	// TGTT Specialties (Druid: 1/5/9/13/17) — per-pick effects.
	...buildSpecialtyChecks("Druid"),
];

// ── Ranger 6 / Druid 14 Centaur multiclass features matrix ───────────
// Levels are TOTAL character levels. Druid level = char level − 6.
//   Char L1-6 = Ranger 1-6 (Hunter @ Ranger 3 = char L3).
//   Char L7-20 = Druid 1-14 (Zodiac Circle @ Druid 3 = char L9).
// Druid 14 doesn't reach Beast Spells (Druid 18) or Archdruid /
// Timeless Body (Druid 20), so those are intentionally omitted.
const HUNTER_ZODIAC_MULTI_FEATURES_MATRIX: FeatureCheck[] = [
	// XPHB Weapon Mastery (Ranger leg) — Club + Dagger picked at L1.
	...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
	// ── Ranger leg (TGTT Ranger + XPHB-derived Hunter) ──────────────
	{level: 1, name: /primal focus|favored enemy/i, kind: "passive"},
	// L1 Spellcasting anchors the multi-leg's Phase-7 racial probes:
	// Centaur walk speed 40, Hunter's Mark always prepared, Ranger's
	// proficient STR/DEX saves, Perception (Ranger signature skill),
	// and the Initiative button smoke probe.
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Hunter's Mark"},
			{kind: "speed", type: "walk", min: 40},
			{kind: "rollSavingThrow", ability: "str"},
			{kind: "rollSavingThrow", ability: "dex"},
			{kind: "rollSkillCheck", skill: "perception", skip: true, skipReason: "CS-BUG-017"},
			{kind: "rollInitiative"},
		],
	},
	// Combat Methods at L2 — real per-method coverage on the Ranger
	// leg. Capped at Ranger 6: the character switches to Druid after
	// that, so the Ranger ladder freezes. Ranger 6 is exactly the
	// Primal Focus Upgrade boundary, so this leg also asserts the two
	// outright-granted methods by name.
	{level: 2, name: /combat methods/i, kind: "passive"},
	...buildCombatMethodChecks("Ranger", {subclassName: "Hunter", maxClassLevel: 6}),
	// Hunter subclass arrives at L3 (Ranger 3). Hunter's Prey is a
	// pick from Colossus Slayer / Horde Breaker (XPHB) plus Giant
	// Killer (PHB legacy carry-over).
	{level: 3, name: /hunter's prey|hunters prey/i, kind: "pick",
		skip: true, skipReason: "CS-BUG-017",
		pickedFrom: [/colossus slayer/i, /giant killer/i, /horde breaker/i]},
	// Extra Attack at Ranger 5 = char L5. Anchor the Ranger weapon-
	// attack roll-button probe here (longbow / shortbow / scimitar
	// from the TGTT Ranger starting kit).
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},

	// ── Druid leg (TGTT Druid + Zodiac subclass) ────────────────────
	// Druid 1 = char L7: Druidic + Spellcasting (Druidic shows up as a
	// passive feature on the sheet). Spellcasting is already listed
	// from the Ranger leg, so we only assert Druidic here to avoid a
	// duplicate matcher. Anchor the druid-leg roll-button probes
	// here: WIS save (Druid proficient — already proficient via
	// Ranger?  no — STR/DEX for Ranger; WIS comes from Druid leg)
	// and Nature skill (druid theme). Phase 8: cantripCount floor
	// (Druid 1 grants 2 cantrips) and full-caster spellSaveDc
	// floor (8 + prof + WIS mod; at char L7 prof=3, WIS≥10 → ≥11).
	{
		level: 7,
		name: /druidic/i,
		kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "wis"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			{kind: "cantripCount", min: 2},
			{kind: "spellSaveDc", min: 11},
		],
	},
	// Druid 2 = char L8: Wild Shape (resource) and Wild Companion
	// (passive feature option).
	//
	// Wild Shape uses GROW with Druid level — TGTT Druid class table
	// reads 2 (Druid 2-5), 3 (Druid 6-16), 4 (Druid 17+). On this leg
	// Druid level = char level - 6, so char 8-11 -> 2 and char 12-20
	// -> 3; Druid 17 would need char 23 and is unreachable. A single
	// fixed `resourceMax: [2, 2]` at level 8 therefore failed by
	// construction (measured: `max=3 outside expected range [2,2]`),
	// the same stale-ladder shape as CS-BUG-018. Tiered with
	// `untilLevel` instead.
	//
	// Note the multiclass matrix is evaluated once PER LEG
	// (`assertFeaturesMatrix(..., leg.toTotalLevel)`), i.e. only at
	// char 6 and char 20 — so the level-8 tier is inert here and the
	// `shortRestRestores` probe is relocated onto the level-12 tier
	// rather than dropped.
	{
		level: 8,
		untilLevel: 11,
		name: /wild shape/i,
		kind: "resource",
		resourceMax: [2, 2],
		restoreOn: "short",
	},
	{
		level: 12,
		name: /wild shape/i,
		kind: "resource",
		resourceMax: [3, 3],
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Wild Shape"},
		],
	},
	{level: 8, name: /wild companion/i, kind: "passive"},
	// Druid 3 = char L9: Druid Circle (Zodiac arrives) + Zodiac
	// Form: Month feature. Once Zodiac is online the druid prepared-
	// spell list should include Druidcraft from the signature spell
	// set baked into PRESET_FULL_ZODIAC_CENTAUR.signatureSpells.
	{
		level: 9,
		name: /circle of the zodiac|druid circle/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Druidcraft"},
		],
	},
	{level: 9, name: /zodiac form: month|zodiac form/i, kind: "passive"},
	// Druid 5 = char L11: Wild Resurgence.
	{level: 11, name: /wild resurgence/i, kind: "passive"},
	// Druid 7 = char L13: Elemental Fury. Druid leg melee-attack
	// probe lands here (quarterstaff / scimitar / club from druid
	// starting equipment, though the multiclass char carries the
	// Ranger kit — the regex stays inclusive of either).
	{
		level: 13,
		name: /elemental fury/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar|quarterstaff|club/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},
	// Druid 10 = char L16: subclass feature → Zodiac Form: Star Week.
	{level: 16, name: /zodiac form: star week|star week/i, kind: "passive"},
	// Druid 14 = char L20: subclass feature → Full Zodiac.
	{level: 20, name: /full zodiac/i, kind: "passive"},
];

/**
 * #4 — Hunter Ranger / Zodiac Druid Centaur (TGTT).
 *
 * Three covered builds:
 *   (a) pure Hunter Ranger 20
 *   (b) pure Zodiac Druid 20
 *   (c) Ranger 6 / Druid 14 multiclass
 */
describeCharacter({
	preset: PRESET_FULL_HUNTER_CENTAUR,
	displayName: "Hunter Ranger Centaur",
	// Hunter's Mark is a concentration SPELL rather than a class toggle, and
	// Colossus Slayer / Horde Breaker are passive per-turn damage riders — none
	// of them is a stance, so none reaches the Overview activatable strip. The
	// Hunter's Prey choice is covered as a `kind: "pick"` matrix row.
	signatureToggleSkip: {skip: true, reason: "Hunter's Mark is a concentration spell and Colossus Slayer / Horde Breaker are passive damage riders, so the Hunter has no L5 stance; the Hunter's Prey choice is covered as a kind:\"pick\" matrix row"},
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Longbow", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /longbow|shortbow/i,
		skillRoll: {name: "Stealth"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Hunter's Mark", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10},
		3:  {totalLevel: 3,  spellSlots: {1: 3}},
		5:  {totalLevel: 5,  spellSlots: {2: 2}},
		11: {totalLevel: 11, spellSlots: {3: 3}},
		17: {totalLevel: 17, spellSlots: {5: 1}},
		20: {totalLevel: 20, spellSlots: {5: 2}},
	},
	featuresMatrix: HUNTER_FEATURES_MATRIX,
});

describeCharacter({
	preset: PRESET_FULL_ZODIAC_CENTAUR,
	displayName: "Zodiac Druid Centaur",
	// Wild Shape and Zodiac Form ARE registered active states, but the sheet
	// deliberately routes them to the dedicated Druid Resources modal and drops
	// them from the generic strip (`isDruidResourceActivatable` in
	// charactersheet.js). So this probe's surface can never show them, by
	// design. Wild Shape is covered as a `kind: "resource"` matrix row.
	signatureToggleSkip: {skip: true, reason: "Wild Shape and Zodiac Form are deliberately routed to the dedicated Druid Resources modal and excluded from the generic Overview activatable strip via isDruidResourceActivatable; Wild Shape is covered as a kind:\"resource\" matrix row"},
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Quarterstaff", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Wild Shape",
		expectLongRestRestores: true,
		attackName: /quarterstaff|scimitar|club/i,
		skillRoll: {name: "Nature"},
		shortRestRestores: {resourceName: "Wild Shape"},
		concentrationCheck: {castSpell: "Entangle", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/zodiac|starry/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: ZODIAC_FEATURES_MATRIX,
});

describeMulticlassCharacter({
	displayName: "Ranger 6 / Druid 14 Centaur",
	preset: {...PRESET_FULL_HUNTER_CENTAUR, name: "Mira Wildhoof"},
	plan: [
		{className: "Ranger", classSource: "TGTT", subclassName: "Hunter", subclassSource: "TGTT-2024",
			signatureSpells: PRESET_FULL_HUNTER_CENTAUR.signatureSpells, toTotalLevel: 6},
		{className: "Druid", classSource: "TGTT", subclassName: "Circle of the Zodiac", subclassSource: "TGTT",
			signatureSpells: PRESET_FULL_ZODIAC_CENTAUR.signatureSpells, toTotalLevel: 20},
	],
	usageAfterEachLeg: [
		// After Ranger 6 — should have Hunter's Mark + 1st-level slots + bow attack
		{
			castSpellSlotLevel: 1,
			attackName: /longbow|shortbow/i,
			// Multiclass legs have no loadout hook, and the TGTT Ranger preset
			// ships unarmed, so the bow can never render here (CS-BUG-030).
			attackNameOptional: true,
			skillRoll: {name: "Stealth"},
		},
		// After Druid 20 — full 9th-level access + Wild Shape resource + Nature roll
		{
			castSpellSlotLevel: 1,
			useResourceName: "Wild Shape",
			skillRoll: {name: "Nature"},
		},
	],
	finalMilestone: {
		totalLevel: 20,
		// Multiclass spell-slot table: Ranger 6 (half) + Druid 14 (full) → caster level ≈ 17 → 9th-level slots present.
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
	},
	featuresMatrix: HUNTER_ZODIAC_MULTI_FEATURES_MATRIX,
});
