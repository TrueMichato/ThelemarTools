import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BASTION_BUGBEAR} from "../utils/characterBuilder";

/**
 * #14 — Oath of Bastion Paladin Bugbear (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Half-caster spell slot scaling (slots from L2)
 *   - Channel Divinity resource (uses scale with level)
 *   - Lay on Hands pool
 *   - Bastion-specific channel options surface as toggles
 *   - Concentration via Bless
 */
describeCharacter({
	preset: PRESET_FULL_BASTION_BUGBEAR,
	displayName: "Oath of Bastion Paladin Bugbear",
	signatureToggle: /bastion|sentinel|guardian|aura|smite|channel divinity|protect/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /longsword|warhammer|greatsword|battleaxe/i,
		skillRoll: {name: "Athletics"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10, acRange: [10, 22]},
		3:  {totalLevel: 3,  minMaxHp: 22, spellSlots: {1: 3}, expectResources: {"Channel Divinity": 1}, expectToggles: [/bastion|sentinel|guardian|aura|protect|channel/i]},
		5:  {totalLevel: 5,  minMaxHp: 38, spellSlots: {2: 2}},
		11: {totalLevel: 11, minMaxHp: 75, spellSlots: {3: 3}, expectToggles: [/aura/i]},
		17: {totalLevel: 17, minMaxHp: 115, spellSlots: {5: 1}},
		20: {totalLevel: 20, minMaxHp: 130, spellSlots: {5: 2}},
	},
});
