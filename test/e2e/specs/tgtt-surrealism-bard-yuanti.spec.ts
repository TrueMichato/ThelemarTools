import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SURREALISM_YUANTI} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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
	{level: 1,  name: /^bardic inspiration/i, kind: "toggle", toggleDelta: "none"},
	{level: 1,  name: "Bardic Inspiration", kind: "resource", resourceMax: [1, 6]},
	{level: 5,  name: "Bardic Inspiration", kind: "resource", resourceMax: [1, 6]},
	// Font of Inspiration (XPHB L5) — Bardic Inspiration restores on
	// short rest. Restoration semantics are blocked by CS-BUG-008 so
	// we only assert the pool exists at the higher tiers, not restore.
	{level: 5,  name: /font of inspiration/i, kind: "passive"},
	// Spellcasting + Jack of All Trades + Expertise (L2 / L9 picks two
	// skills each). Expertise is a `pick` over the Bard's two granted
	// skills; the auto-fill picks include Performance + at least one
	// other social/lore skill.
	{level: 1,  name: /spellcasting/i, kind: "passive"},
	{level: 2,  name: /jack of all trades/i, kind: "passive"},
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
	{level: 10, name: /magical secrets/i, kind: "passive"},
	{level: 18, name: /superior inspiration/i, kind: "passive"},
	{level: 20, name: /words of creation/i, kind: "passive"},

	// ── Subclass — College of Surrealism (TGTT) ─────────────────────
	// L3 Lucid Insight: passive (CHA mod added to WIS saves).
	{level: 3,  name: /lucid insight/i, kind: "passive"},
	// L3 Warped Reality: bonus action, spends 1 Bardic Inspiration die,
	// short-rest cooldown. The sheet renders it as an activatable
	// feature; treat as toggle with no derived-stat delta required.
	{level: 3,  name: /warped reality/i, kind: "toggle", toggleDelta: "none"},
	// L6 Canvas of the Mind: long-rest cooldown reality-warping zone.
	// Modeled passively — no isolated stat delta to verify.
	{level: 6,  name: /canvas of the mind/i, kind: "passive"},
	// L14 Guiding Whispers: passive — once-per-short-rest emotion
	// manipulation; also unlocks bonus-action Bardic Inspiration in
	// the Canvas.
	{level: 14, name: /guiding whispers/i, kind: "passive"},
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

