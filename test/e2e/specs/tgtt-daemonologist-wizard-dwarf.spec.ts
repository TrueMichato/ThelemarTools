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
	// Ritual Adept changes which spellbook spells can be ritual-cast; the factory has no ritual-cast probe.
	{level: 1, name: /ritual adept/i, kind: "passive"},
	// Arcane Recovery's variable slot-level chooser is covered by Wizard suites; no deterministic matrix delta.
	{level: 1, name: /arcane recovery/i, kind: "passive"},
	// Scholar's expertise target is auto-picked and therefore not deterministic.
	{level: 2, name: /scholar/i, kind: "passive"},
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
	// ASIs have no deterministic target in the auto-filled level-up flow.
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Memorize Spell, Spell Mastery, and Signature Spells are choice-driven spellbook operations.
	{level: 5, name: /memorize spell/i, kind: "passive"},
	{level: 18, name: /spell mastery/i, kind: "passive"},
	{level: 20, name: /signature spells/i, kind: "passive"},
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
