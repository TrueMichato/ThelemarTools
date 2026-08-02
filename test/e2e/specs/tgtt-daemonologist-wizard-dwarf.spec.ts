import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_DAEMONOLOGIST_DWARF} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildAnyInvocationChecks} from "../utils/tgttFeaturePools";

/**
 * Daemonologist Wizard Dwarf (Grim Hollow 2024) — L1→20.
 *
 * Coverage focus:
 *   - Fair and Foul persists the Arch Daemon branch and gates its spells.
 *   - Wizard-owned Eldritch Invocations progress at L3/L6/L14.
 *   - Borrowed Tongues and Hides, Unearthly Countenance, and Eternal War Eruption are usable.
 */
const DAEMONOLOGIST_FEATURES: FeatureCheck[] = [
	{level: 1, name: /spellcasting/i, kind: "passive", effects: [
		{kind: "rollAbilityCheck", ability: "int"},
		{kind: "rollSavingThrow", ability: "int"},
		{kind: "rollSavingThrow", ability: "wis"},
	]},
	// Ritual Adept lets a Wizard ritual-cast straight from the spellbook without
	// preparing. ALL THREE keys below are WRITE-ONLY as far as the UI is
	// concerned (CS-BUG-093), so this row proves the calcs ran and nothing more:
	//   hasRitualCasting   6 refs = 5 writes + 1 read (state.js:15074)
	//   ritualCastingMode  5 refs = 5 writes, 0 reads
	//   hasRitualAdept     1 ref  = 1 write,  0 reads
	// The single `hasRitualCasting` read is itself unreachable from the UI: it
	// sits inside `getAvailableRitualSpells` (state.js:15072), which has zero
	// callers in js/ — only Jest tests.
	//
	// An earlier version of this comment called `ritualCastingMode` "the
	// load-bearing one (5 refs)". That was wrong, and wrong in the exact way the
	// CS-BUG-093 detector exists to catch: all 5 refs are `calculations.x = …`
	// ASSIGNMENTS. A reference count is not a read count.
	//
	// The real reader is `canCastAsRitual` (state.js:15033), which has 4 UI
	// callers in charactersheet-spells.js (:2226, :2512, :3115, :7619) and
	// implements the whole prepared-vs-spellbook distinction itself.
	//
	// NOT repinned to `getAvailableRitualSpells()` — besides having no UI
	// caller, its count is CHOICE-DEPENDENT, so no fixed assertion survives the
	// matrix re-evaluating this row at every later checkpoint. Measured on
	// spawned builds: wizard L1 → 1 ritual (Find Familiar), same build at L3 → 0.
	// A `min: 1` here would go red at the level-3 checkpoint. Pinning this needs
	// a spec that fixes a known ritual in the spellbook first, then asserts
	// `canCastAsRitual` on it while UNPREPARED — that is the behaviour Ritual
	// Adept actually changes. Deferred rather than guessed.
	{level: 1, name: /ritual adept/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasRitualCasting", exact: true},
		{kind: "featureCalculation", property: "ritualCastingMode", exact: "spellbook"},
		{kind: "featureCalculation", property: "hasRitualAdept", exact: true},
	]},
	{level: 1, name: /ritual adept/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasRitualCasting", exact: true},
		{kind: "featureCalculation", property: "ritualCastingMode", exact: "spellbook"},
		{kind: "featureCalculation", property: "hasRitualAdept", exact: true},
	]},
	// Arcane Recovery's slot-level CHOOSER is non-deterministic, but its budget
	// is not: `ceil(level / 2)`. Likewise the spellbook grows `6 + (level-1)*2`.
	// Both are level-driven ladders, so they need one exact tier per checkpoint
	// with `untilLevel` — the matrix re-evaluates every earlier row at each
	// later checkpoint, so a single fixed value fails by construction.
	// Windows are chosen to contain exactly one of [3, 5, 11, 17, 20].
	{level: 1, untilLevel: 4, name: /arcane recovery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasArcaneRecovery", exact: true},
		{kind: "featureCalculation", property: "arcaneRecoverySlotLevels", exact: 2},
		// CS-BUG-093: `spellbookSpellsKnown` is WRITE-ONLY — nothing enforces or
		// displays the cap. `arcaneRecoverySlotLevels` IS read
		// (charactersheet-rest.js:193), so that one is load-bearing.
		{kind: "featureCalculation", property: "spellbookSpellsKnown", exact: 10},
	]},
	{level: 5, untilLevel: 10, name: /arcane recovery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "arcaneRecoverySlotLevels", exact: 3},
		{kind: "featureCalculation", property: "spellbookSpellsKnown", exact: 14},
	]},
	{level: 11, untilLevel: 16, name: /arcane recovery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "arcaneRecoverySlotLevels", exact: 6},
		{kind: "featureCalculation", property: "spellbookSpellsKnown", exact: 26},
	]},
	{level: 17, untilLevel: 19, name: /arcane recovery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "arcaneRecoverySlotLevels", exact: 9},
		{kind: "featureCalculation", property: "spellbookSpellsKnown", exact: 38},
	]},
	{level: 20, name: /arcane recovery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "arcaneRecoverySlotLevels", exact: 10},
		{kind: "featureCalculation", property: "spellbookSpellsKnown", exact: 44},
	]},
	// Scholar's expertise TARGET is auto-picked and not deterministic, but the
	// grant itself and the menu it must be drawn from are.
	{level: 2, name: /scholar/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasScholar", exact: true},
	]},
	{level: 3, name: /fair and foul/i, kind: "passive", effects: [
		// Deliberately NOT `spellMatchMode: "any"`: that mode drops the name
		// assertion entirely and only counts spells at `level`, so it would
		// pass on any wizard with a single level-1 spell without ever looking
		// for Bane. The default `first-party` mode does the exact-name lookup.
		{kind: "spellInList", spell: "Bane"},
	]},
	{level: 6, name: /borrowed tongues and hides/i, kind: "passive", effects: [
		{kind: "resistance", damageType: "necrotic"},
	]},
	{level: 10, name: /unearthly countenance/i, kind: "passive", effects: [
		{kind: "toggleGrantsSpeed", type: "fly", min: 60},
		{kind: "toggleGrantsAdvantage", rollType: "check:cha"},
	]},
	{level: 14, name: /eternal war eruption/i, kind: "passive", effects: [
		{kind: "longRestRestoresFeatureUses", feature: "Eternal War Eruption"},
	]},
	...buildAnyInvocationChecks(["XPHB", "PHB", "XGE", "TCE", "TGTT"], [
		{level: 3, cum: 1},
		{level: 6, cum: 2},
		{level: 14, cum: 3},
	]),
	// ASIs are a genuine coverage gap, not a deferred one. The auto-filled
	// level-up picks its own targets, so no specific score is deterministic,
	// and there is no ASI-specific calculation to read.
	// Do NOT "fix" this with a global probe such as `hasPendingFeatureChoices()`:
	// that is process-wide state, so it would pass or fail for reasons this row
	// does not own — a probe that passes for a different reason than it appears
	// to, which is the exact shape this suite has been removing. An honest gap
	// is worth more than a probe that cannot fail for the right reason.
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// CS-BUG-093: `hasSpellMastery` and `hasSignatureSpells` are WRITE-ONLY
	// (one ref each in js/ — their own assignment) and neither ability is
	// implemented: a L18 wizard still spends a slot on a 1st-level spell.
	// These two assertions therefore prove the calc RAN, not that the ability
	// does anything. Do NOT read a green run here as implementation.
	//   Signature Spells has a ready wiring target — `noSlotCasts` /
	//   `getNoSlotCastResourcesForSpell` (state :34407), already in the cast
	//   menu — but Spell Mastery does not: that descriptor gates on a resource
	//   with charges and Spell Mastery is unlimited. `spell.atWill` is NOT the
	//   target for either; it renders in `_renderInnateSpellItem`, the innate
	//   list, and these act on prepared spellbook spells.
	// By contrast `hasMemorizeSpell` (3 refs) is genuinely consumed.
	// Memorize Spell, Spell Mastery and Signature Spells are choice-driven
	// spellbook operations, so their PICKS aren't deterministic — but each
	// grant sets a real calculation flag, so presence is now verified
	// mechanically rather than by feature name alone.
	{level: 5, name: /memorize spell/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasMemorizeSpell", exact: true},
	]},
	{level: 18, name: /spell mastery/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasSpellMastery", exact: true},
	]},
	{level: 20, name: /signature spells/i, kind: "passive", effects: [
		{kind: "featureCalculation", property: "hasSignatureSpells", exact: true},
	]},
];

describeCharacter({
	preset: PRESET_FULL_DAEMONOLOGIST_DWARF,
	displayName: "Daemonologist Wizard Dwarf",
	midTierLoadout: [{name: "Cloak of Protection", source: "XDMG", attune: true}],
	signatureToggle: /unearthly countenance/i,
	usage: {
		atLevel: 10,
		castSpellSlotLevel: 1,
		useResourceName: "Borrowed Tongues and Hides",
		expectLongRestRestores: true,
		attackName: /unarmed strike|quarterstaff|dagger/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {skip: true}, // Wizards have no short-rest resource pool.
		concentrationCheck: {castSpell: "Fly", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Poisoned"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}},
		5: {totalLevel: 5, spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: DAEMONOLOGIST_FEATURES,
});
