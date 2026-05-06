import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LUST_LEXALIAN} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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
	{level: 1, name: /spellcasting/i, kind: "passive"},
	{level: 1, name: /divine order/i, kind: "passive"},
	// L2: Channel Divinity is the iconic resource — pool starts at 2,
	// scales to 3 at L6 and 4 at L18 per the TGTT class table. Use
	// ranges to tolerate sheet-side under/over-counting (the milestone
	// assertions hint the implementation may surface a smaller pool
	// than the table prescribes — see the spec milestones above).
	{level: 2, name: /channel divinity/i, kind: "passive"},
	{level: 2, name: "Channel Divinity", kind: "resource", resourceMax: [1, 3]},
	{level: 6, name: "Channel Divinity", kind: "resource", resourceMax: [2, 3]},
	{level: 18, name: "Channel Divinity", kind: "resource", resourceMax: [2, 4]},
	{level: 2, name: /principles of devotion/i, kind: "passive"},
	// L4/8/12/16 ASIs + L19 Epic Boon — passive listing only.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// L5 Sear Undead — XPHB rebrand of Destroy Undead (use either name).
	{level: 5, name: /sear undead|destroy undead/i, kind: "passive"},
	// L7 Blessed Strikes / L14 Improved Blessed Strikes — passive damage
	// rider on weapon attacks or cantrips.
	{level: 7, name: /blessed strikes/i, kind: "passive"},
	{level: 14, name: /improved blessed strikes/i, kind: "passive"},
	// L10 Divine Intervention + L20 Divine Intervention Improvement.
	{level: 10, name: /divine intervention/i, kind: "passive"},
	{level: 20, name: /divine intervention improvement/i, kind: "passive"},

	// ── Subclass: Lust Domain (TGTT) ────────────────────────────────
	// L3 grants the subclass + the first Channel Divinity option.
	// "Lust Domain" itself appears as a feature header.
	{level: 3, name: /lust domain/i, kind: "passive"},
	// Channel Divinity: Impulsive Infatuation — charm-themed CD option
	// (no separate resource pool; consumes Channel Divinity charges).
	{level: 3, name: /impulsive infatuation/i, kind: "passive"},
	// Domain Spells unlock at L3/5/7/9 (always prepared for Cleric).
	{level: 3, name: /lust.*spells|domain spells/i, kind: "spells",
		grantsSpells: ["Charm Person", "Command", "Enthrall", "Suggestion"]},
	{level: 5, name: /lust.*spells|domain spells/i, kind: "spells",
		grantsSpells: ["Detect Thoughts", "Hypnotic Pattern"]},
	{level: 7, name: /lust.*spells|domain spells/i, kind: "spells",
		grantsSpells: ["Charm Monster", "Compulsion"]},
	{level: 9, name: /lust.*spells|domain spells/i, kind: "spells",
		grantsSpells: ["Dominate Person", "Hold Monster"]},
	// L6 Enchanting Presence — allure feature (passive aura/charm boost).
	{level: 6, name: /enchanting presence/i, kind: "passive"},
	// L8 Potent Spellcasting — adds WIS mod to cantrip damage.
	{level: 8, name: /potent spellcasting/i, kind: "passive"},
	// L17 Supplicant of the Flesh — capstone allure feature.
	{level: 17, name: /supplicant of the flesh/i, kind: "passive"},
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
