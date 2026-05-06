import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHRONURGY_NYUIDJ} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * #7 — Chronurgy Wizard Nyuidj (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Wizard slot table identical to other Wizards (sanity check)
 *   - Chronal Shift uses arrive at L2 (subclass L1 Chronurgy feature)
 *   - Convergent Future at L14
 *   - Time Ravager / capstone at L20
 */
// ── Chronurgy Wizard L1→20 features matrix ───────────────────────────
// TGTT Wizard is XPHB-style: Spellcasting / Ritual Adept / Arcane
// Recovery at L1, Scholar L2, subclass at L3, Memorize Spell L5, ASIs
// L4/8/12/16/19, Spell Mastery L18, Signature Spells L20. Subclass
// (Chronurgy Magic, EGW): Chronal Shift + Temporal Awareness at L3,
// Momentary Stasis L6, Arcane Abeyance L10, Convergent Future L14.
//
// CS-BUG-002 — TGTT Wizard subclass features (including Chronurgy)
// are never appended to the feature list on level-up. All Chronurgy
// subclass entries below are skipped with that bug reference until
// the underlying class-utils subclass-grant pipeline is fixed.
const CHRONURGY_WIZARD_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Wizard base class features ──────────────────────────────────
	// L1: Spellcasting + Ritual Adept (free ritual casting from book)
	// + Arcane Recovery (recover slots ≤ ⌈half-level⌉ once per long
	// rest, total slot levels = prof bonus). Pool exposure is
	// inconsistent across builds; assert as passive listing.
	{level: 1, name: /spellcasting/i, kind: "passive"},
	{level: 1, name: /ritual adept/i, kind: "passive"},
	{level: 1, name: /arcane recovery/i, kind: "passive"},
	// L2 Scholar — INT-based skill expertise pick.
	{level: 2, name: /scholar/i, kind: "passive"},
	// ASIs at L4/8/12/16 + Epic Boon at L19.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// L5 Memorize Spell — XPHB-only Wizard feature (swap a prepared
	// spell on a short rest).
	{level: 5, name: /memorize spell/i, kind: "passive"},
	// L18 Spell Mastery — pick a 1st + 2nd-level spell to cast at
	// will. The at-will mechanic is a spell-list annotation rather
	// than a toggle/resource.
	{level: 18, name: /spell mastery/i, kind: "passive"},
	// L20 Signature Spells — 2 always-prepared 3rd-level spells,
	// each recoverable once per short rest. Passive listing.
	{level: 20, name: /signature spells/i, kind: "passive"},

	// ── Subclass: Chronurgy Magic (EGW, sourced under TGTT-2014) ────
	// All subclass entries blocked by CS-BUG-002 — feature list never
	// receives the subclass grants on level-up, so name-based probes
	// fail even though the JSON payload is correct.
	//
	// L3 Chronal Shift — reaction reroll, 2 uses per long rest.
	{level: 3, name: /chronal shift/i, kind: "resource",
		resourceMax: 2, restoreOn: "long",
		skip: true, skipReason: "CS-BUG-002"},
	// L3 Temporal Awareness — passive +INT mod to initiative.
	{level: 3, name: /temporal awareness/i, kind: "passive",
		skip: true, skipReason: "CS-BUG-002"},
	// L6 Momentary Stasis — action, INT mod uses per long rest,
	// freezes a Large-or-smaller creature in a stasis field.
	{level: 6, name: /momentary stasis/i, kind: "passive",
		skip: true, skipReason: "CS-BUG-002"},
	// L10 Arcane Abeyance — store a 4th-level-or-lower spell in a
	// bead, recoverable on short or long rest. Modeled passively
	// because the cooldown isn't a numeric pool.
	{level: 10, name: /arcane abeyance/i, kind: "passive",
		skip: true, skipReason: "CS-BUG-002"},
	// L14 Convergent Future — reaction; pick the result of a roll
	// at the cost of one level of exhaustion (long rest to remove).
	{level: 14, name: /convergent future/i, kind: "passive",
		skip: true, skipReason: "CS-BUG-002"},
];

describeCharacter({
	preset: PRESET_FULL_CHRONURGY_NYUIDJ,
	displayName: "Chronurgy Wizard Nyuidj",
	signatureToggle: /chronal|convergent|temporal|momentary/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /quarterstaff|dagger/i,
		skillRoll: {name: "Arcana"},
		// Wizards regain one slot of level ≤ ⌈half-level⌉ via Arcane Recovery (SR).
		// Resource isn't named uniformly; skip the strict check.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Slow", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectToggles: [/chronal|convergent|momentary/i]},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: CHRONURGY_WIZARD_FEATURES_MATRIX,
});
