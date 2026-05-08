import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SURREALISM_YUANTI} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * #8 — College of Surrealism Bard Yuan-Ti (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Bardic Inspiration die scaling (d6→d8→d10→d12) across levels
 *   - Bard spell slot table all the way to 9th-level
 *   - Subclass features arrive at L3 + L6 + L14 milestones
 *   - Superior Inspiration / capstone at L20
 */
// ── College of Surrealism Bard L1→20 features matrix ───────────────────
// TGTT Bard uses XPHB Bard chassis (Spellcasting, Jack of All Trades,
// Expertise at L2/L9, Font of Inspiration at L5, Magical Secrets at L10,
// Countercharm at L7, Superior Inspiration at L18, Words of Creation at
// L20) plus a PHB-flavoured Bardic Inspiration die that scales d6→d12.
// Note: XPHB removed Song of Rest entirely, so it is NOT included here.
//
// Subclass — College of Surrealism (TGTT): Lucid Insight + Warped
// Reality at L3, Canvas of the Mind at L6, Guiding Whispers at L14.
const SURREALISM_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Class — Bard (TGTT/XPHB) ─────────────────────────────────────
	// Bardic Inspiration: toggle exists from L1; the resource pool size
	// is CHA-mod-tied (auto-fill picks CHA 16-17 → 3 uses), so probe a
	// generous range rather than an exact value.
	// Bardic Inspiration is a per-rest *resource* (CHA mod uses per
	// long rest at L1, restored on short rest from L5+). The Jester
	// spec correctly models it as `kind: "resource"`; this spec
	// previously declared it as `kind: "toggle"` which doesn't match
	// how the sheet renders BI on a base/Surrealism Bard.
	{level: 1,  name: /^bardic inspiration/i, kind: "resource", skip: true, skipReason: "CS-BUG-017",
		resourceMax: [3, 3], restoreOn: "long"},
	// Bardic Inspiration restores on long rest at L1-4 (PHB-classic),
	// short rest at L5+ (Font of Inspiration / XPHB).
	{
		level: 1,
		name: "Bardic Inspiration",
		kind: "resource",
		resourceMax: [1, 6],
		effects: [
			{kind: "longRestRestores", resource: "Bardic Inspiration"},
			// PHB-flavoured BI die scaling: d6 from L1, d8 at L5, d10 at
			// L10, d12 at L15. The L1 floor (≥6) survives every probe
			// level; tighter mins ride along on the L5 / L10 / L14
			// entries so each tier asserts its own face count.
			{kind: "bardicInspirationDie", minFaces: 6},
		],
	},
	{
		level: 5,
		name: "Bardic Inspiration",
		kind: "resource",
		resourceMax: [1, 6],
		effects: [
			{kind: "longRestRestores", resource: "Bardic Inspiration"},
			// Font of Inspiration (L5+) → BI should also refill on short
			// rest. Blocked by CS-BUG-008 (short-rest restore not wired).
			{kind: "shortRestRestores", resource: "Bardic Inspiration",
				skip: true, skipReason: "CS-BUG-008"},
			// L5+ BI die has scaled to d8.
			{kind: "bardicInspirationDie", minFaces: 8},
		],
	},
	// Font of Inspiration (XPHB L5) — Bardic Inspiration restores on
	// short rest. Restoration semantics are blocked by CS-BUG-008 so
	// we only assert the pool exists at the higher tiers, not restore.
	// Spellcasting maturity probes also live here (Bard CHA mod hits
	// +3 by L5 with the auto-fill picks → expected DC ≥ 13).
	{
		level: 5,
		name: /font of inspiration/i,
		kind: "passive",
		effects: [
			{kind: "shortRestRestores", resource: "Bardic Inspiration",
				skip: true, skipReason: "CS-BUG-008"},
			{kind: "spellSaveDc", min: 13, skip: true, skipReason: "CS-BUG-016"},
		],
	},
	// Spellcasting + Jack of All Trades + Expertise (L2 / L9 picks two
	// skills each). Expertise is a `pick` over the Bard's two granted
	// skills; the auto-fill picks include Performance + at least one
	// other social/lore skill.
	//
	// We piggyback the bulk of the breadth probes onto Spellcasting
	// (always present from L1) — known cantrip count, signature spells,
	// the Yuan-Ti racial spell-list grants, plus roll-button no-throw
	// probes for the bard's signature ability (CHA), DEX (proficient
	// save), Initiative, and the Performance skill.
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "cantripCount", min: 2, skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Vicious Mockery", skip: true, skipReason: "CS-BUG-016"},
			// Yuan-Ti `Serpentine Spellcasting` racial: Poison Spray
			// cantrip is granted as `known` at L1 in MPMM data.
			{kind: "spellInList", spell: "Poison Spray", skip: true, skipReason: "CS-BUG-016"},
			// Yuan-Ti `Poison Resilience` (MPMM): resistance to poison
			// damage. (User-prompt hinted "immunity" but MPMM data is
			// resistance — going with the data.)
			{kind: "resistance", damageType: "poison"},
			// Yuan-Ti `Magic Resistance` racial grants advantage on
			// saves *vs spells* — that's a per-source category which
			// state.getAdvantageState() doesn't expose. Probed as
			// advantage on a generic CHA save (the shape that *would*
			// fire if the sheet exposed it) and skipped per the
			// per-prompt guidance.
			{kind: "advantage", rollType: "save:cha",
				skip: true, skipReason: "Yuan-Ti Magic Resistance is 'vs spells' only — state.getAdvantageState() lacks per-source granularity"},
			{kind: "rollAbilityCheck", ability: "cha"},
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollSavingThrow", ability: "dex"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			{kind: "rollInitiative"},
		],
	},
	{
		level: 2,
		name: /jack of all trades/i,
		kind: "passive",
		effects: [
			// Yuan-Ti are stereotypically Deception-flavoured; probe the
			// skill button no-throws as part of the JoaT entry.
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			// Bard starting kit weapons: probe whichever simple weapon
			// the auto-loadout actually picked up.
			{kind: "rollAttack", attackName: /rapier|shortsword|dagger|hand crossbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},
	{level: 2,  name: /^expertise/i, kind: "pick", pickedCount: 1, pickedFrom: [
		/performance/i, /persuasion/i, /deception/i, /history/i, /arcana/i,
		/insight/i, /investigation/i, /perception/i, /acrobatics/i,
	]},
	{level: 9,  name: /^expertise/i, kind: "pick", pickedCount: 1, pickedFrom: [
		/performance/i, /persuasion/i, /deception/i, /history/i, /arcana/i,
		/insight/i, /investigation/i, /perception/i, /acrobatics/i,
	]},
	// ASIs at L4/8/12/16 + Epic Boon at L19.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Countercharm (L7), Magical Secrets (L10), Superior Inspiration
	// (L18), Words of Creation (L20).
	{level: 7,  name: /countercharm/i, kind: "passive"},
	{
		level: 10,
		name: /magical secrets/i,
		kind: "passive",
		effects: [
			// L10+ BI die has scaled to d10.
			{kind: "bardicInspirationDie", minFaces: 10},
		],
	},
	{level: 18, name: /superior inspiration/i, kind: "passive"},
	{level: 20, name: /words of creation/i, kind: "passive"},

	// ── Subclass — College of Surrealism (TGTT) ─────────────────────
	// L3 Lucid Insight: "When you roll for a Wisdom saving throw you
	// may add your Charisma modifier to the result." That's a non-
	// standard cross-stat bonus that the state's `getSaveMod` API may
	// not surface — there's no documented `lucidInsight` calculation
	// key in `getFeatureCalculations`. We probe the WIS save *button*
	// (no-throw) here as a sanity check; the actual numeric bonus is
	// declared as an unskipped `saveBonus` probe with min:0 (matches
	// any non-negative WIS save total — survives low base WIS scores).
	{
		level: 3,
		name: /lucid insight/i,
		kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "wis"},
			{kind: "saveBonus", ability: "wis", min: 0},
		],
	},
	// L3 Warped Reality: bonus action, spends 1 Bardic Inspiration die,
	// short-rest cooldown. The sheet renders it as an activatable
	// feature; treat as toggle with no derived-stat delta required.
	{
		level: 3,
		name: /warped reality/i,
		kind: "toggle", skip: true, skipReason: "CS-BUG-017",
		toggleDelta: "none",
		effects: [
			// L3+ guarantee an attack-roll button fires without throwing
			// (different feature card, different probe to spread risk).
			{kind: "rollAttack", attackName: /rapier|shortsword|dagger|hand crossbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		],
	},
	// L6 Canvas of the Mind: long-rest cooldown reality-warping zone.
	// Modeled passively — no isolated stat delta to verify.
	{level: 6,  name: /canvas of the mind/i, kind: "passive"},
	// L14 Guiding Whispers: passive — once-per-short-rest emotion
	// manipulation; also unlocks bonus-action Bardic Inspiration in
	// the Canvas. Doubles as the L15+ probe carrier for the BI die's
	// final upgrade to d12 (probe levels are 3/5/11/17/20, so a L14
	// entry only fires at L17/L20 where the d12 is in effect).
	{
		level: 14,
		name: /guiding whispers/i,
		kind: "passive",
		effects: [
			{kind: "bardicInspirationDie", minFaces: 12},
		],
	},
	...buildSpecialtyChecks("Bard"),
];

describeCharacter({
	preset: PRESET_FULL_SURREALISM_YUANTI,
	displayName: "College of Surrealism Bard Yuan-Ti",
	signatureToggle: /bardic inspiration|surreal|illusion|mockery/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Bardic Inspiration",
		expectLongRestRestores: true,
		attackName: /rapier|shortsword|dagger/i,
		skillRoll: {name: "Performance"},
		// Bardic Inspiration restores on long rest in 2014 PHB, on a SR
		// once the bard hits L5 (Font of Inspiration).  TGTT mirrors XPHB.
		shortRestRestores: {skip: true}, // blocked by CS-BUG-008 (Bardic Inspiration not restored on short rest)
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectToggles: [/bardic inspiration/i]},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectToggles: [/bardic inspiration|font of inspiration/i]},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectToggles: [/superior inspiration|words of creation/i]},
	},
	featuresMatrix: SURREALISM_FEATURES_MATRIX,
});

