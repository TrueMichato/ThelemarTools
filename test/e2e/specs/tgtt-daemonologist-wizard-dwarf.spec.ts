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
	// preparing. The factory has no ritual-cast probe, but the mode itself is a
	// real mechanical value and distinguishes Wizard ("spellbook") from the
	// "prepared" / "known" casters — so it is asserted rather than deferred.
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
