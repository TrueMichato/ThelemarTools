import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TIME_CLERIC} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * #10 — Time Domain Cleric (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Channel Divinity uses scale (1→2→3 by L18)
 *   - Cleric spell slot table all the way to 9th-level
 *   - Subclass features at L1, L3, L6, L8, L17
 *   - Divine Intervention at L10, automatic at L20
 */
describeCharacter({
	preset: PRESET_FULL_TIME_CLERIC,
	displayName: "Time Domain Cleric",
	signatureToggle: /channel divinity|time|temporal|destroy undead/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /mace|warhammer/i,
		skillRoll: {name: "Religion"},
		// Channel Divinity restores on a short rest.
		shortRestRestores: {resourceName: "Channel Divinity"},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectToggles: [/divine intervention/i]},
	},
	// SMOKE-tier matrix: keep entries conservative — passive presence
	// checks for the well-known features, plus the domain spell list at
	// each granted tier and a Channel Divinity pool size range.
	featuresMatrix: <FeatureCheck[]>[
		// ── L1 baseline ─────────────────────────────────────────────────
		{level: 1, name: /spellcasting/i, kind: "passive"},
		// ── L2: Channel Divinity + Turn Undead ──────────────────────────
		{level: 2, name: /^channel divinity$/i, kind: "resource", resourceMax: [1, 4]},
		{level: 2, name: /turn undead/i, kind: "passive"},
		// ── L3: Time Domain subclass features + 1st domain spell tier ───
		{level: 3, name: /time domain spells/i, kind: "spells", grantsSpells: ["Feather Fall"]},
		{level: 3, name: /chronological interference/i, kind: "passive"},
		{level: 3, name: /right on time/i, kind: "passive"},
		{level: 3, name: /channel divinity: temporal manipulation/i, kind: "passive"},
		// ── L5: Destroy/Sear Undead + 2nd domain spell tier ─────────────
		{level: 5, name: /sear undead|destroy undead/i, kind: "passive"},
		{level: 5, name: /time domain spells/i, kind: "spells", grantsSpells: ["Haste", "Slow"]},
		// ── L6: Eyes of the Future Past + CD pool grows ─────────────────
		{level: 6, name: /eyes of the future past/i, kind: "passive"},
		{level: 6, name: /^channel divinity$/i, kind: "resource", resourceMax: [2, 4]},
		// ── L7: 3rd domain spell tier ───────────────────────────────────
		{level: 7, name: /time domain spells/i, kind: "spells", grantsSpells: ["Death Ward", "Freedom of Movement"]},
		// ── L8: Potent Spellcasting ─────────────────────────────────────
		{level: 8, name: /potent spellcasting/i, kind: "passive"},
		// ── L9: 4th domain spell tier ───────────────────────────────────
		{level: 9, name: /time domain spells/i, kind: "spells", grantsSpells: ["Hold Monster"]},
		// ── L10: Divine Intervention ────────────────────────────────────
		{level: 10, name: /divine intervention/i, kind: "passive"},
		// ── L17: Temporal Mastery capstone subclass feature ─────────────
		{level: 17, name: /temporal mastery/i, kind: "passive"},
		// ── L20: Divine Intervention auto-success ───────────────────────
		{level: 20, name: /divine intervention improvement|divine intervention/i, kind: "passive"},
	],
});
