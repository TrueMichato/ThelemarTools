import {describeCharacter, describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HUNTER_CENTAUR, PRESET_FULL_ZODIAC_CENTAUR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ─────────────────────────────────────────────────────────────────────
// Hunter Ranger L20 standalone features matrix (TGTT Ranger + XPHB
// Hunter subclass). Centaur racials (Powerful Build / Hooves /
// Equine Build = walk 40) ride along on the L1 entry's effects.
// Ranger TGTT proficient saves: STR + DEX. Hunter's Mark is always
// prepared at L1 (TGTT additionalSpells). Equipment: longbow,
// shortsword, scimitar, studded leather.
// ─────────────────────────────────────────────────────────────────────
const HUNTER_FEATURES_MATRIX: FeatureCheck[] = [
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
			{kind: "rollSkillCheck", skill: "perception"},
			{kind: "rollInitiative"},
		],
	},
	// L1 Favored Enemy / Primal Focus (TGTT-flavored opener).
	{level: 1, name: /primal focus|favored enemy/i, kind: "passive"},
	// L2 Combat Methods (TGTT). Treat as passive listing — the
	// individual method picks vary too much to enumerate as a `pick`.
	{level: 2, name: /combat methods/i, kind: "passive"},
	// L3 Hunter's Lore — passive subclass info feature.
	{level: 3, name: /hunter's lore|hunters lore/i, kind: "passive"},
	// L3 Hunter's Prey pick — XPHB has Colossus Slayer / Horde
	// Breaker; legacy PHB also exposed Giant Killer. Steel Will /
	// Multiattack Defense / Escape the Horde from Defensive Tactics
	// don't appear here; those are L7.
	{level: 3, name: /hunter's prey|hunters prey/i, kind: "pick",
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
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i},
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
	{level: 7, name: /defensive tactics/i, kind: "pick",
		pickedFrom: [/escape the horde/i, /multiattack defense/i, /steel will/i]},
	// L9 Expertise — passive (which skills get expertise is the
	// player's choice; no clean state probe).
	{level: 9, name: /expertise/i, kind: "passive"},
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
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i},
		],
	},
	// L13 Relentless Hunter — passive concentration-save buffer.
	{level: 13, name: /relentless hunter/i, kind: "passive"},
	// L14 Nature's Veil (XPHB) — Invisibility-like reaction; not a
	// toggle the matrix can probe via stat delta.
	{level: 14, name: /nature's veil|natures veil/i, kind: "passive"},
	// L15 Superior Hunter's Defense pick — XPHB (Evasion / Stand
	// Against the Tide / Uncanny Dodge); no state probe.
	{level: 15, name: /superior hunter's defense|superior hunters defense/i, kind: "passive"},
	// L17 Precise Hunter — passive advantage against Hunter's Mark
	// target (situational; not surfaced as a global advantage flag).
	{level: 17, name: /precise hunter/i, kind: "passive"},
	// L18 Feral Senses — passive (limited-blindsight against
	// Hunter's Mark target).
	{level: 18, name: /feral senses/i, kind: "passive"},
	// L19 Epic Boon — chooses a feat; passive listing.
	{level: 19, name: /epic boon|ability score improvement/i, kind: "passive"},
	// L20 Foe Slayer — passive damage adder vs Hunter's Mark target.
	{level: 20, name: /foe slayer/i, kind: "passive"},
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
			{kind: "rollSkillCheck", skill: "nature"},
			{kind: "rollInitiative"},
			{kind: "cantripCount", min: 2},
		],
	},
	// L1 Druidic — passive subclass-language feature.
	{level: 1, name: /druidic/i, kind: "passive"},
	// L1 Primal Order — TGTT/XPHB primal-order pick (Magician /
	// Warden). Both surface as feature listings; treat as passive.
	{level: 1, name: /primal order/i, kind: "passive"},
	// L2 Wild Shape — 2 uses, short-rest restored.
	{
		level: 2,
		name: /wild shape/i,
		kind: "resource",
		resourceMax: [2, 2],
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Wild Shape"},
		],
	},
	{level: 2, name: /wild companion/i, kind: "passive"},
	// L3 Druid Circle (Zodiac).
	{level: 3, name: /circle of the zodiac|druid circle/i, kind: "passive"},
	// L3 Zodiac Form: Month — picks among 12 constellation features
	// (Beaver / Aurochs / Horse / etc.). Treated as passive listing
	// rather than enumerating all 12 options as `pick`.
	{level: 3, name: /zodiac form: month|zodiac form/i, kind: "passive"},
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
			{kind: "rollAttack", attackName: /quarterstaff|scimitar|club/i},
		],
	},
	// L8 ASI.
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	// L10 Zodiac Form: Star Week — picks among 12 constellation
	// features (Sequoia / Unicorn / etc.).
	{level: 10, name: /zodiac form: star week|star week/i, kind: "passive"},
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
];

// ── Ranger 6 / Druid 14 Centaur multiclass features matrix ───────────
// Levels are TOTAL character levels. Druid level = char level − 6.
//   Char L1-6 = Ranger 1-6 (Hunter @ Ranger 3 = char L3).
//   Char L7-20 = Druid 1-14 (Zodiac Circle @ Druid 3 = char L9).
// Druid 14 doesn't reach Beast Spells (Druid 18) or Archdruid /
// Timeless Body (Druid 20), so those are intentionally omitted.
const HUNTER_ZODIAC_MULTI_FEATURES_MATRIX: FeatureCheck[] = [
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
			{kind: "rollSkillCheck", skill: "perception"},
			{kind: "rollInitiative"},
		],
	},
	// Combat Methods at L2 — TGTT-specific pick (varies). Pick-kind
	// would require enumerating all options; treat as passive listing.
	{level: 2, name: /combat methods/i, kind: "passive"},
	// Hunter subclass arrives at L3 (Ranger 3). Hunter's Prey is a
	// pick from Colossus Slayer / Horde Breaker (XPHB) plus Giant
	// Killer (PHB legacy carry-over).
	{level: 3, name: /hunter's prey|hunters prey/i, kind: "pick",
		pickedFrom: [/colossus slayer/i, /giant killer/i, /horde breaker/i]},
	// Extra Attack at Ranger 5 = char L5. Anchor the Ranger weapon-
	// attack roll-button probe here (longbow / shortbow / scimitar
	// from the TGTT Ranger starting kit).
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar/i},
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
			{kind: "rollSkillCheck", skill: "nature"},
			{kind: "cantripCount", min: 2},
			{kind: "spellSaveDc", min: 11},
		],
	},
	// Druid 2 = char L8: Wild Shape (resource, 2 uses, short rest)
	// and Wild Companion (passive feature option). The shortRest
	// restore probe layered on top of `restoreOn: "short"` doubles
	// as a resource-mechanics smoke check.
	{
		level: 8,
		name: /wild shape/i,
		kind: "resource",
		resourceMax: [2, 2],
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
			{kind: "rollAttack", attackName: /longbow|shortbow|scimitar|quarterstaff|club/i},
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
	signatureToggle: /hunter|hunter's mark|colossus|horde/i,
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
	signatureToggle: /zodiac|starry|wild shape|stellar/i,
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
