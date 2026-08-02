import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ARCANA_CLERIC} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * Arcana Domain Cleric (SCAG, PHB 2014 chassis) — L1→20.
 *
 * Coverage focus — every Arcana feature must DO something observable, not just render:
 *   - Arcane Initiate grants Arcana proficiency AND a real two-pick wizard-cantrip
 *     list. Before CS-BUG-075 the `{choose: "level=0|class=Wizard", count: 2}` block
 *     was silently dropped by `_parseSpellReference`, so the picks never existed.
 *     The matrix asserts the slots are DERIVED (`getSubclassSpellChoiceSlots`) and
 *     DRAINED (`getPendingSpellChoices` is empty after the wizard finishes).
 *   - Arcane Abjuration is an activatable Channel Divinity whose WIS save DC is
 *     resolved from the CHARACTER (CS-BUG-053), with a level-gated banishment rider
 *     that steps 0.5 → 1 → 2 → 3 → 4 at L5/8/11/14/17.
 *   - The 2014 Cleric Channel Divinity pool is capped and scales 1 → 2 → 3 at
 *     L2/L6/L18 (verified empirically, not assumed from the Paladin fix).
 *   - Spell Breaker's dispel ceiling tracks the character's highest spell slot.
 *   - Potent Spellcasting adds a REAL number to cleric cantrip damage
 *     (CS-BUG-076: the calculation existed but was consumed nowhere).
 *   - Arcane Mastery is a four-part pick-list (one spell each of 6th/7th/8th/9th).
 *
 * NOTE the preset sets `abilityPriority` so the standard array's 15 lands in WISDOM.
 * The harness default is STR-first, which would leave this cleric at WIS 10 and make
 * Potent Spellcasting's bonus +0 — indistinguishable from the feature doing nothing.
 */
const ARCANA_FEATURES: FeatureCheck[] = [
	// ── L1: full-caster chassis ─────────────────────────────────────────
	{
		level: 1,
		name: /^spellcasting$/i,
		kind: "passive",
		effects: [
			{kind: "spellSlots", level: 1, min: 2},
			{kind: "spellSaveDc", min: 12},
		],
	},
	// ── L1: Arcana Domain always-prepared spells ────────────────────────
	{
		level: 1,
		name: /arcana domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Detect Magic"},
			{kind: "spellInList", spell: "Magic Missile"},
		],
	},
	// ── L1: Arcane Initiate ─────────────────────────────────────────────
	// Two things, both mechanical: an Arcana proficiency and a two-pick wizard
	// cantrip list whose picks count as CLERIC cantrips (so Potent Spellcasting
	// reaches them at L8 — asserted separately below).
	{
		level: 1,
		name: /arcane initiate/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasArcaneInitiate", exact: true},
			{kind: "featureCalculation", property: "bonusWizardCantrips", exact: 2},
			{kind: "skillBonus", skill: "Arcana", min: 2},
			{kind: "rollSkillCheck", skill: "Arcana"},
			// The pick-list is REAL: two choice slots are derived from the subclass's
			// `additionalSpells.known["1"]` choose block (CS-BUG-075)…
			{kind: "stateCall", method: "getSubclassSpellChoiceSlots", path: "length", min: 2},
			// …and the creation wizard actually drained them, so nothing is left pending.
			{kind: "stateCall", method: "getPendingSpellChoices", path: "length", exact: 0},
			// Cleric L1 has 3 cantrips of its own plus the two Arcane Initiate
			// picks. `min: 2` is kept deliberately loose: the Arcane Initiate pair
			// is what this entry exists to prove — they exercise the CS-BUG-075
			// choose-block walker and the CS-BUG-077 sequential picker end-to-end.
			// (Before CS-BUG-016 was fixed the builder landed ZERO cleric cantrips,
			// so those two picks were the only thing keeping this green.)
			{kind: "cantripCount", min: 2},
		],
	},
	// ── L2: Channel Divinity pool (2014 Cleric: 1 → 2 at L6 → 3 at L18) ──
	// A pool that GROWS needs one entry per tier with `untilLevel`; a single fixed
	// `resourceMax` would be re-evaluated at every later checkpoint and report the
	// correct new value as a failure.
	{
		level: 2,
		untilLevel: 5,
		name: "Channel Divinity",
		kind: "resource",
		resourceMax: 1,
		restoreOn: "short",
		effects: [
			{kind: "featureCalculation", property: "channelDivinityUses", exact: 1},
			{kind: "shortRestRestores", resource: "Channel Divinity"},
		],
	},
	{
		level: 6,
		untilLevel: 17,
		name: "Channel Divinity",
		kind: "resource",
		resourceMax: 2,
		effects: [{kind: "featureCalculation", property: "channelDivinityUses", exact: 2}],
	},
	{
		level: 18,
		name: "Channel Divinity",
		kind: "resource",
		resourceMax: 3,
		effects: [{kind: "featureCalculation", property: "channelDivinityUses", exact: 3}],
	},
	// ── L2: Channel Divinity: Arcane Abjuration ─────────────────────────
	// The umbrella "Channel Divinity" feature must NOT mint a second, resource-less
	// phantom ability row (CS-BUG-051) — `pickActivatable` with a min of 1 plus the
	// single-pool assertions above are what pin that down.
	{
		level: 2,
		name: /arcane abjuration/i,
		kind: "passive",
		effects: [
			{kind: "pickActivatable", matchAny: [/arcane abjuration/i], min: 1},
			{kind: "featureCalculation", property: "hasArcaneAbjuration", exact: true},
			{kind: "featureCalculation", property: "arcaneAbjurationRange", exact: 30},
			{kind: "featureCalculation", property: "arcaneAbjurationDuration", exact: 1},
			// "each celestial, elemental, fey or fiend … must make a Wisdom saving
			// throw" — the prose names no DC, so the sheet must resolve 8 + PB + WIS
			// from the character rather than fall back to a hard-coded 10.
			{
				kind: "combatAction",
				feature: "Channel Divinity: Arcane Abjuration",
				interactionMode: "limited",
				rollType: "save",
				saveAbility: "wis",
				saveDcFromCharacter: true,
			},
			{kind: "stateCall", method: "getFeatureCalculations", path: "arcaneAbjurationDc", min: 12},
			// The `consumes: {name: "Channel Divinity"}` tag exists in
			// data/class/class-cleric.json but four of the five subclass-feature
			// construction paths in charactersheet-class-utils.js used to drop it, so it
			// never reached the sheet (CS-BUG-079 part 1). Pinned explicitly because the
			// name-convention fallback (part 2) would otherwise keep every other probe on
			// this row green with the tag still missing.
			{
				kind: "stateCall",
				method: "getFeature",
				args: ["Channel Divinity: Arcane Abjuration"],
				path: "consumes.name",
				exact: "Channel Divinity",
			},
		],
	},
	// Banishment rider — gated at L5 and stepping with level.
	{level: 5, untilLevel: 7, name: /arcane abjuration/i, kind: "passive", effects: [{kind: "featureCalculation", property: "arcaneAbjurationBanishCr", exact: 0.5}]},
	{level: 11, untilLevel: 13, name: /arcane abjuration/i, kind: "passive", effects: [{kind: "featureCalculation", property: "arcaneAbjurationBanishCr", exact: 2}]},
	{level: 17, name: /arcane abjuration/i, kind: "passive", effects: [{kind: "featureCalculation", property: "arcaneAbjurationBanishCr", exact: 4}]},
	// ── L3/5/7/9: the rest of the domain spell list ─────────────────────
	{
		level: 3,
		name: /arcana domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Magic Weapon"},
			{kind: "spellInList", spell: "Nystul's Magic Aura"},
		],
	},
	{
		level: 5,
		name: /arcana domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Dispel Magic"},
			{kind: "spellInList", spell: "Magic Circle"},
		],
	},
	{
		level: 7,
		name: /arcana domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Arcane Eye"},
			{kind: "spellInList", spell: "Leomund's Secret Chest"},
		],
	},
	{
		level: 9,
		name: /arcana domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Planar Binding"},
			{kind: "spellInList", spell: "Teleportation Circle"},
		],
	},
	// ── L6: Spell Breaker ───────────────────────────────────────────────
	// "the spell ends if its level is equal to or lower than the level of the spell
	// slot you used" — the ceiling is the character's highest available slot, so it
	// steps with the caster's own progression.
	{
		level: 6,
		name: /spell breaker/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasSpellBreaker", exact: true}],
	},
	{level: 11, untilLevel: 16, name: /spell breaker/i, kind: "passive", effects: [{kind: "featureCalculation", property: "spellBreakerMaxSpellLevel", exact: 6}]},
	{level: 17, name: /spell breaker/i, kind: "passive", effects: [{kind: "featureCalculation", property: "spellBreakerMaxSpellLevel", exact: 9}]},
	// ── L8: Potent Spellcasting ─────────────────────────────────────────
	// The whole point of CS-BUG-076: `potentSpellcastingBonus` used to be computed and
	// then consumed by NOTHING. `getCantripDamageBonus()` is the generic consumer that
	// the cantrip damage roll path now reads, so probe THAT rather than the raw calc.
	{
		level: 8,
		name: /potent spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasPotentSpellcasting", exact: true},
			{kind: "featureCalculation", property: "potentSpellcastingClass", exact: "Cleric"},
			// WIS is the preset's 15 (+2 before any ASI), so this is a real, non-zero
			// number — never the +0 a STR-first standard array would produce.
			{kind: "featureCalculation", property: "potentSpellcastingBonus", min: 2},
			{kind: "stateCall", method: "getCantripDamageBonus", path: "bonus", min: 2},
			{kind: "stateCall", method: "getCantripDamageBonus", path: "sources.0.name", contains: "Potent Spellcasting"},
		],
	},
	// ── L17: Arcane Mastery ─────────────────────────────────────────────
	// Four picks — one each of 6th/7th/8th/9th level from the wizard list — that
	// become always-prepared domain spells. Combined with the two Arcane Initiate
	// cantrips that is six derived choice slots, and all six must be drained.
	{
		level: 17,
		name: /arcane mastery/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasArcaneMastery", exact: true},
			{kind: "stateCall", method: "getFeatureCalculations", path: "arcaneMasterySpellLevels.length", exact: 4},
			{kind: "stateCall", method: "getSubclassSpellChoiceSlots", path: "length", min: 6},
			{kind: "stateCall", method: "getPendingSpellChoices", path: "length", exact: 0},
			// The picks are real spells on the sheet, one per tier.
			{kind: "spellInList", spell: "", spellMatchMode: "any", level: 6},
			{kind: "spellInList", spell: "", spellMatchMode: "any", level: 7},
			{kind: "spellInList", spell: "", spellMatchMode: "any", level: 8},
			{kind: "spellInList", spell: "", spellMatchMode: "any", level: 9},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_ARCANA_CLERIC,
	displayName: "Arcana Domain Cleric (SCAG)",
	// Arcane Abjuration is the domain's only activatable at L5. Its entire effect
	// lands on OTHER creatures (turned, and optionally banished), so no self-facing
	// stat can move; activation plus the character-derived save DC are asserted in
	// the matrix instead.
	signatureToggle: /arcane abjuration/i,
	signatureToggleNoDerivedEffect: "Arcane Abjuration is enemy-facing (celestials/elementals/fey/fiends make a WIS save or are turned, and are banished outright at L5+); the sheet models one character, so no self-facing stat changes. Activation and the character-derived save DC are asserted in the features matrix.",
	midTierLoadout: [
		{name: "Mace", equipped: true},
		{name: "Scale Mail", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /mace/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {resourceName: "Channel Divinity"},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		// This deterministic build takes ASIs, not a toggleable feat.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, spellSlots: {1: 2}},
		3: {totalLevel: 3, minMaxHp: 24, spellSlots: {2: 2}, expectResources: {"Channel Divinity": 1}},
		5: {totalLevel: 5, minMaxHp: 38, spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, minMaxHp: 80, spellSlots: {6: 1}, expectResources: {"Channel Divinity": 2}},
		17: {totalLevel: 17, minMaxHp: 120, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 2}},
		20: {totalLevel: 20, minMaxHp: 140, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 3}},
	},
	featuresMatrix: ARCANA_FEATURES,
});
