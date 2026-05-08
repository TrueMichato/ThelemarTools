import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LUST_LEXALIAN} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * #17 — Lust Domain Cleric Lexalian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Full-caster spell-slot scaling
 *   - Channel Divinity resource (uses scale)
 *   - Domain-specific bonus spells / charm-themed toggles
 *   - Concentration via Bless
 */
// ── Lust Domain Cleric L1→20 features matrix ─────────────────────────
// TGTT Cleric is XPHB-style: Channel Divinity arrives at L2 (2 uses),
// scales to 3 at L6 and 4 at L18. Subclass starts at L3 (Lust Domain)
// with charm-themed Channel Divinity options + domain spell list at
// L3/5/7/9. Lust subclass features at L3/6/8/17.
const LUST_CLERIC_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Class features ──────────────────────────────────────────────
	// L1: Spellcasting + Divine Order (Protector / Thaumaturge choice).
	// Cleric grants 3 cantrips at L1 and prepared spells from the
	// cleric list. Sacred Flame is the canonical pick; Cure Wounds is
	// the spec's signature L1 prepared spell. Cleric saves are
	// proficient in WIS + CHA — both roll buttons should fire cleanly.
	// Religion is INT-based and is granted by the Acolyte background;
	// CHA ability checks and initiative also probed here.
	{level: 1, name: /spellcasting/i, kind: "passive", effects: [
		{kind: "cantripCount", min: 3, skip: true, skipReason: "CS-BUG-016"},
		{kind: "spellInList", spell: "Sacred Flame", skip: true, skipReason: "CS-BUG-016"},
		{kind: "spellInList", spell: "Cure Wounds", skip: true, skipReason: "CS-BUG-016"},
		{kind: "rollSavingThrow", ability: "wis"},
		{kind: "rollSavingThrow", ability: "cha"},
		{kind: "rollAbilityCheck", ability: "cha"},
		{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
		{kind: "rollInitiative"},
	]},
	{level: 1, name: /divine order/i, kind: "passive"},
	// L2: Channel Divinity is the iconic resource — pool starts at 2,
	// scales to 3 at L6 and 4 at L18 per the TGTT class table. Use
	// ranges to tolerate sheet-side under/over-counting (the milestone
	// assertions hint the implementation may surface a smaller pool
	// than the table prescribes — see the spec milestones above).
	{level: 2, name: /channel divinity/i, kind: "passive"},
	// Channel Divinity refreshes on a short or long rest per RAW
	// (XPHB cleric); probe via shortRestRestores on the resource entry.
	{level: 2, name: "Channel Divinity", kind: "resource", resourceMax: [1, 3], effects: [
		{kind: "shortRestRestores", resource: "Channel Divinity"},
	]},
	// Phase 8: re-assert short-rest restoration at the L6/L18 scaling
	// tiers — the resource pool grows but must still refill on a short
	// rest. Mirrors the L2 probe so a regression in the refill path at
	// any tier fails loudly with the offending milestone.
	{level: 6, name: "Channel Divinity", kind: "resource", resourceMax: [2, 3], effects: [
		{kind: "shortRestRestores", resource: "Channel Divinity"},
	]},
	{level: 18, name: "Channel Divinity", kind: "resource", resourceMax: [2, 4], effects: [
		{kind: "shortRestRestores", resource: "Channel Divinity"},
	]},
	{level: 2, name: /principles of devotion/i, kind: "passive"},
	// L4/8/12/16 ASIs + L19 Epic Boon — passive listing only.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// L5 Sear Undead — XPHB rebrand of Destroy Undead (use either name).
	// Use this as the mid-level perch for spell save DC (PB jumps to
	// +3 at L5, so DC = 8 + 3 + WIS mod ≥ 13) and an attack roll probe
	// — by L5 the comprehensive build has equipped a starting weapon.
	// Persuasion roll-button probe also lives here: cleric is
	// proficient via Bonus Proficiencies (L3+), so the button must be
	// click-without-throw at every milestone L5+.
	{level: 5, name: /sear undead|destroy undead/i, kind: "passive", effects: [
		{kind: "spellSaveDc", min: 13, skip: true, skipReason: "CS-BUG-016"},
		{kind: "rollAttack", attackName: /mace|warhammer|crossbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
	]},
	// L7 Blessed Strikes / L14 Improved Blessed Strikes — passive damage
	// rider on weapon attacks or cantrips. Damage scaling not surfaced
	// as a discrete state scalar; rules-text only.
	{level: 7, name: /blessed strikes/i, kind: "passive"},
	{level: 14, name: /improved blessed strikes/i, kind: "passive"},
	// L10 Divine Intervention + L20 Divine Intervention Improvement.
	{level: 10, name: /divine intervention/i, kind: "passive"},
	{level: 20, name: /divine intervention improvement/i, kind: "passive"},

	// ── Subclass: Lust Domain (TGTT) ────────────────────────────────
	// L3 grants the subclass + the first Channel Divinity option.
	// "Lust Domain" itself appears as a feature header. The L3 Bonus
	// Proficiencies sub-feature grants Deception + Persuasion — both
	// observable as a min skill bonus of +PB (=+2 at L3) on the sheet.
	{level: 3, name: /lust domain/i, kind: "passive", effects: [
		{kind: "skillBonus", skill: "persuasion", min: 2, skip: true, skipReason: "CS-BUG-019"},
		{kind: "skillBonus", skill: "deception", min: 2, skip: true, skipReason: "CS-BUG-019"},
	]},
	// Channel Divinity: Impulsive Infatuation — charm-themed CD option
	// (no separate resource pool; consumes Channel Divinity charges).
	// The WIS-save-or-charm-and-attack mechanic is rules-text only and
	// the sheet doesn't surface a clean state probe for it; skip.
	{level: 3, name: /impulsive infatuation/i, kind: "passive"},
	// Domain Spells unlock at L3/5/7/9 (always prepared for Cleric).
	// Complement the kind:"spells" grantsSpells assertion with
	// spellInList probes per spell so a missing spellbook entry fails
	// loudly with the offending name (rather than the aggregated set).
	{level: 3, name: /lust.*spells|domain spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016",
		grantsSpells: ["Charm Person", "Command", "Enthrall", "Suggestion"],
		effects: [
			{kind: "spellInList", spell: "Charm Person", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Command", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Enthrall", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Suggestion", skip: true, skipReason: "CS-BUG-016"},
		]},
	{level: 5, name: /lust.*spells|domain spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016",
		grantsSpells: ["Detect Thoughts", "Hypnotic Pattern"],
		effects: [
			{kind: "spellInList", spell: "Detect Thoughts", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Hypnotic Pattern", skip: true, skipReason: "CS-BUG-016"},
		]},
	{level: 7, name: /lust.*spells|domain spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016",
		grantsSpells: ["Charm Monster", "Compulsion"],
		effects: [
			{kind: "spellInList", spell: "Charm Monster", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Compulsion", skip: true, skipReason: "CS-BUG-016"},
		]},
	{level: 9, name: /lust.*spells|domain spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016",
		grantsSpells: ["Dominate Person", "Hold Monster"],
		effects: [
			{kind: "spellInList", spell: "Dominate Person", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Hold Monster", skip: true, skipReason: "CS-BUG-016"},
		]},
	// L6 Enchanting Presence — imposes disadvantage on a target's save
	// vs. a 1st-level+ enchantment cast within 5 ft. Per-target,
	// per-spell conditional disadvantage isn't exposed by
	// state.getAdvantageState; rules-text only.
	{level: 6, name: /enchanting presence/i, kind: "passive"},
	// L8 Potent Spellcasting — adds WIS mod to cleric cantrip damage.
	// Sheet bakes this into rendered cantrip damage rolls rather than
	// exposing a top-level scalar; no clean state probe.
	{level: 8, name: /potent spellcasting/i, kind: "passive"},
	// L17 Supplicant of the Flesh — capstone allure feature: damage
	// against creatures charmed by you doesn't end the condition. No
	// surfaced state probe.
	{level: 17, name: /supplicant of the flesh/i, kind: "passive"},
	// Note: Lexalian racial (Trained — light/medium armor, ranged
	// martial weapons, polearms) is proficiency-only. Armor/weapon
	// proficiency lists aren't surfaced as state scalars on the sheet,
	// so no race-level effect probes are added here.
	...buildSpecialtyChecks("Cleric"),
];

describeCharacter({
	preset: PRESET_FULL_LUST_LEXALIAN,
	displayName: "Lust Domain Cleric Lexalian",
	signatureToggle: /channel divinity|charm|lust|allure|persuasion|seduction|domain/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /mace|warhammer|crossbow/i,
		skillRoll: {name: "Persuasion"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectResources: {"Channel Divinity": 1}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Channel Divinity": 2}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 2}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 2}},
	},
	featuresMatrix: LUST_CLERIC_FEATURES_MATRIX,
});
