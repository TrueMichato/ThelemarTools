import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BASTION_BUGBEAR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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
	featuresMatrix: <FeatureCheck[]>[
		// ── L1: half-caster baseline ────────────────────────────────────
		{level: 1, name: /lay on hands/i, kind: "resource", resourceMax: [5, 5]},
		{level: 1, name: /weapon mastery/i, kind: "passive"},
		// ── L2: Fighting Style pick + Smite ─────────────────────────────
		{
			level: 2,
			name: /fighting style/i,
			kind: "pick",
			pickedCount: 1,
			pickedFrom: [/defense/i, /great weapon fighting/i, /protection/i, /dueling/i, /blessed warrior/i, /blind fighting/i, /interception/i, /two-weapon fighting/i],
		},
		{level: 2, name: /paladin'?s? smite|divine smite/i, kind: "passive"},
		// ── L3: Channel Divinity + Oath of Bastion ──────────────────────
		{level: 3, name: /^channel divinity$/i, kind: "resource", resourceMax: [1, 3]},
		{level: 3, name: /oath of bastion spells/i, kind: "spells", grantsSpells: ["Shield of Faith", "Sanctuary"]},
		{level: 3, name: /sentry'?s lingering aura/i, kind: "passive"},
		{level: 3, name: /shield of the helpless/i, kind: "passive"},
		{level: 3, name: /armor bond/i, kind: "passive"},
		// ── L5: Extra Attack + 2nd-tier oath spells ─────────────────────
		{level: 5, name: /extra attack/i, kind: "passive"},
		{level: 5, name: /oath of bastion spells/i, kind: "spells", grantsSpells: ["Warding Bond", "Lesser Restoration"]},
		{level: 5, name: /faithful steed/i, kind: "passive"},
		// ── L6: Aura of Protection ──────────────────────────────────────
		{level: 6, name: /aura of protection/i, kind: "passive"},
		// ── L7: Bastion auras ───────────────────────────────────────────
		{level: 7, name: /fortifying aura/i, kind: "passive"},
		{level: 7, name: /bastion'?s? sustenance/i, kind: "passive"},
		// ── L9: 3rd-tier oath spells + Abjure Foes ──────────────────────
		{level: 9, name: /abjure foes/i, kind: "passive"},
		{level: 9, name: /oath of bastion spells/i, kind: "spells", grantsSpells: ["Spirit Guardians", "Protection from Energy"]},
		// ── L10: Aura of Courage ────────────────────────────────────────
		{level: 10, name: /aura of courage/i, kind: "passive"},
		// ── L11: Improved Divine Smite (XPHB Radiant Strikes) ───────────
		{level: 11, name: /radiant strikes|improved divine smite/i, kind: "passive"},
		// ── L13: 4th-tier oath spells ───────────────────────────────────
		{level: 13, name: /oath of bastion spells/i, kind: "spells", grantsSpells: ["Stoneskin", "Guardian of Faith"]},
		// ── L14: Cleansing Touch (XPHB Restoring Touch) ─────────────────
		{level: 14, name: /restoring touch|cleansing touch/i, kind: "passive"},
		// ── L15: Indomitable Guardian ───────────────────────────────────
		{level: 15, name: /indomitable guardian/i, kind: "passive"},
		// ── L17: 5th-tier oath spells ───────────────────────────────────
		{level: 17, name: /oath of bastion spells/i, kind: "spells", grantsSpells: ["Wall of Stone", "Greater Restoration"]},
		// ── L18: Aura Expansion ─────────────────────────────────────────
		{level: 18, name: /aura expansion/i, kind: "passive"},
		// ── L20: Eternal Bastion capstone ───────────────────────────────
		{level: 20, name: /eternal bastion/i, kind: "passive"},
	],
});
