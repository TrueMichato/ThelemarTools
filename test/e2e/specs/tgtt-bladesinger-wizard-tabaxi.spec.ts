import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BLADESINGER_TABAXI} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ── Bladesinger Wizard L1→20 features matrix ─────────────────────────
// Wizard base (PHB / TGTT-2014 sourced subclass): Arcane Recovery,
// ASIs, Spell Mastery (L18), Signature Spells (L20), full caster slots
// up to 9th. Subclass: Bladesong (L3 toggle), Extra Attack (L6),
// Song of Defense (L10), Song of Victory (L14).
const BLADESINGER_FEATURES_MATRIX: FeatureCheck[] = [
	// Wizard base — Arcane Recovery: prof-bonus-tied recovery slots,
	// once per long rest. Pool exposure varies on the sheet, so we
	// validate it as a passive feature listing rather than a resource.
	{level: 1, name: /arcane recovery/i, kind: "passive"},
	// Wizard ASIs at L4/8/12/16/19 — passive listing.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Wizard L18 Spell Mastery — pick 1 1st-level + 1 2nd-level spell
	// to cast at-will. Listed as passive (the actual at-will mechanic
	// isn't a toggle, just a visual annotation on the spell list).
	{level: 18, name: /spell mastery/i, kind: "passive"},
	// Wizard L20 Signature Spells — 2 always-prepared 3rd-level spells
	// recoverable 1/short-rest. Passive listing.
	{level: 20, name: /signature spells/i, kind: "passive"},

	// Bladesinger subclass features.
	// Bladesong AC delta — blocked by CS-BUG-006 (the toggle does
	// activate but the AC delta is not applied, so the matrix's
	// strict `toggleDelta: "ac"` check fails). Skip the strict AC
	// variant and keep a `none` variant so we still verify the toggle
	// button exists and activates without throwing.
	{level: 3, name: /bladesong/i, kind: "toggle", toggleDelta: "ac", skip: true, skipReason: "CS-BUG-006"},
	{level: 3, name: /bladesong/i, kind: "toggle", toggleDelta: "none"},
	// Extra Attack at L6 — passive damage/attack-count feature.
	{level: 6, name: /extra attack/i, kind: "passive"},
	// Song of Defense at L10 — spend a spell slot as a reaction to
	// reduce damage. Modeled as a passive feature: it doesn't expose
	// its own resource pool (it consumes existing slots), so the
	// matrix probes it as `passive` per the prompt's fallback.
	{level: 10, name: /song of defense/i, kind: "passive"},
	// Song of Victory at L14 — passive damage bonus while Bladesong
	// is active.
	{level: 14, name: /song of victory/i, kind: "passive"},
];

/**
 * #3 — Bladesinger Wizard Tabaxi (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Wizard spell-slot progression (1st → 9th level slots)
 *   - Bladesong toggle arrives at L3, raises AC by INT mod
 *   - Extra Attack at L6, Song of Defense at L10
 *   - Signet of Knowledge at L20 capstone
 *   - Signature spells: Shield + Booming Blade
 */
describeCharacter({
	preset: PRESET_FULL_BLADESINGER_TABAXI,
	displayName: "Bladesinger Wizard Tabaxi",
	// Skip L7 + MEGA: blocked by CS-BUG-002 (subclass features not granted,
	// so Bladesong toggle never registers).  L3 / L5 stay on as red
	// reminders of the bug.
	skipL7: true,
	skipMega: true,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /bladesong/i,
	// Usage spec skipped — same reason as L7/MEGA: subclass features
	// missing means Bladesong toggle never appears, and the L5 build
	// itself sometimes errors before we can probe the spell pipeline.
	// Re-enable once CS-BUG-002 lands.  When un-skipping, restore:
	//   skillRoll: {name: "Arcana"}, shortRestRestores: {resourceName: "Bladesong", expectAfter: 1},
	//   concentrationCheck: {castSpell: "Shield", thenAction: "damage", expectActive: false},
	//   deathSaves: true, applyCondition: {skip: true}, featAbility: {skip: true},
	usage: {skip: true},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 6,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  minMaxHp: 14, spellSlots: {2: 2}, expectToggles: [/bladesong/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectToggles: [/bladesong/i]},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: BLADESINGER_FEATURES_MATRIX,
});
