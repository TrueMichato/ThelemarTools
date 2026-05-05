import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LUST_LEXALIAN} from "../utils/characterBuilder";

/**
 * #17 — Lust Domain Cleric Lexalian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Full-caster spell-slot scaling
 *   - Channel Divinity resource (uses scale)
 *   - Domain-specific bonus spells / charm-themed toggles
 *   - Concentration via Bless
 */
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
});
