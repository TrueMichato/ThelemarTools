import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BASTION_BUGBEAR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

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
		// Lay on Hands pool (5 × paladin level) replenishes on a Long
		// Rest only (XPHB & PHB'14 agree). Probe the long-rest restore
		// path on top of the resource pool size.
		{
			level: 1,
			name: /lay on hands/i,
			kind: "resource", skip: true, skipReason: "CS-BUG-018",
			resourceMax: [5, 5],
			effects: [
				{kind: "longRestRestores", resource: "Lay on Hands"},
			],
		},
		// Weapon Mastery is the L1 catch-all entry — piggyback the
		// always-on roll-button probes (one weapon attack + initiative)
		// here so they fire at every checkpoint from L1 upward.
		{
			level: 1,
			name: /weapon mastery/i,
			kind: "passive",
			effects: [
				{kind: "rollAttack", attackName: /longsword|greatsword|warhammer|battleaxe|mace|scimitar|rapier|shortsword/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
				{kind: "rollInitiative"},
			],
		},
		// ── L2: Fighting Style pick + Smite ─────────────────────────────
		{
			level: 2,
			name: /fighting style/i,
			kind: "pick", skip: true, skipReason: "CS-BUG-017",
			pickedCount: 1,
			pickedFrom: [/defense/i, /great weapon fighting/i, /protection/i, /dueling/i, /blessed warrior/i, /blind fighting/i, /interception/i, /two-weapon fighting/i],
		},
		// Paladin's Smite (XPHB L2) auto-prepares the Divine Smite spell
		// — verify it's in the prepared list. This is the closest
		// observable effect; the "cast without a slot 1/long rest"
		// mechanic isn't surfaced as a discrete resource pool.
		{
			level: 2,
			name: /paladin'?s? smite|divine smite/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Divine Smite", skip: true, skipReason: "CS-BUG-016"},
			],
		},
		// ── L3: Channel Divinity + Oath of Bastion ──────────────────────
		// Channel Divinity (XPHB) recovers on a Short or Long Rest —
		// probe the short-rest restore path on top of the resource pool.
		{
			level: 3,
			name: /^channel divinity$/i,
			kind: "resource", skip: true, skipReason: "CS-BUG-017",
			resourceMax: [1, 3],
			effects: [
				{kind: "shortRestRestores", resource: "Channel Divinity"},
			],
		},
		{level: 3, name: /oath of bastion spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016", grantsSpells: ["Shield of Faith", "Sanctuary"]},
		// Sentry's Lingering Aura — CD-fueled aura that frightens nearby
		// foes on a failed WIS save. The aura's frightened mechanic
		// isn't surfaced on the caster's own state, but we can use this
		// entry to probe the paladin's two proficient saves (WIS + CHA).
		{
			level: 3,
			name: /sentry'?s lingering aura/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "wis"},
				{kind: "rollSavingThrow", ability: "cha"},
			],
		},
		// Shield of the Helpless — CD reaction to redirect an attack
		// against an ally onto the paladin (with resistance). Purely
		// reactive; no clean state probe.
		{level: 3, name: /shield of the helpless/i, kind: "passive"},
		// Armor Bond — sleep in armor without penalty + immune to
		// armor-removal effects. No state-observable flag is exposed.
		{level: 3, name: /armor bond/i, kind: "passive"},
		// ── L5: Extra Attack + 2nd-tier oath spells ─────────────────────
		// Extra Attack — also a good place to fire a second attack-roll
		// probe at the L5+ checkpoint (different attackName regex would
		// be redundant; the L1 probe already covers the click handler).
		{level: 5, name: /extra attack/i, kind: "passive"},
		{level: 5, name: /oath of bastion spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016", grantsSpells: ["Warding Bond", "Lesser Restoration"]},
		// Faithful Steed — grants the Find Steed spell as a ritual /
		// always-prepared option. No clean state probe (the spell list
		// check isn't reliable across editions).
		{level: 5, name: /faithful steed/i, kind: "passive"},
		// ── L6: Aura of Protection ──────────────────────────────────────
		// Aura of Protection adds the paladin's CHA mod (min +1) to all
		// six saving throws once active at L6+. Six probes — one per
		// ability — using `min: 1` so the assertion stays true regardless
		// of the actual CHA mod or proficiency on the save.
		{
			level: 6,
			name: /aura of protection/i,
			kind: "passive",
			effects: [
				{kind: "saveBonus", ability: "str", min: 1},
				{kind: "saveBonus", ability: "dex", min: 1},
				{kind: "saveBonus", ability: "con", min: 1},
				{kind: "saveBonus", ability: "int", min: 1},
				{kind: "saveBonus", ability: "wis", min: 1},
				{kind: "saveBonus", ability: "cha", min: 1},
			],
		},
		// ── L7: Bastion auras ───────────────────────────────────────────
		// Fortifying Aura — temp HP to allies (prof bonus). Affects
		// allies, not the paladin's own state. Use this entry for a
		// generic CHA ability-check roll-button probe.
		{
			level: 7,
			name: /fortifying aura/i,
			kind: "passive",
			effects: [
				{kind: "rollAbilityCheck", ability: "cha"},
			],
		},
		// Bastion's Sustenance — 2× food/water duration + restore 1
		// exhaustion per rest. Calculation flags exist but aren't
		// exposed via getResistances/getResources/etc.
		{level: 7, name: /bastion'?s? sustenance/i, kind: "passive"},
		// ── L9: 3rd-tier oath spells + Abjure Foes ──────────────────────
		// Abjure Foes — Channel Divinity option that frightens enemies.
		// Use this entry for a Persuasion skill-check roll probe (CHA
		// skill — paladin's signature stat).
		{
			level: 9,
			name: /abjure foes/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			],
		},
		{level: 9, name: /oath of bastion spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016", grantsSpells: ["Spirit Guardians", "Protection from Energy"]},
		// ── L10: Aura of Courage ────────────────────────────────────────
		// Aura of Courage grants immunity to the *frightened condition*
		// (registered as `conditionImmunity: frightened`). The
		// EffectCheck union exposes `immunity` for damage types and
		// `advantage` for roll categories, but not condition immunities
		// — and the sheet's `getAdvantageState("save:cha")` does NOT
		// fire just because we're immune to frightened. No clean probe.
		{level: 10, name: /aura of courage/i, kind: "passive"},
		// ── L11: Improved Divine Smite (XPHB Radiant Strikes) ───────────
		// Radiant Strikes adds 1d8 radiant on weapon hits. The damage
		// rider isn't surfaced as a queryable bonus on the sheet — no
		// clean state probe.
		{level: 11, name: /radiant strikes|improved divine smite/i, kind: "passive"},
		// ── L13: 4th-tier oath spells ───────────────────────────────────
		{level: 13, name: /oath of bastion spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016", grantsSpells: ["Stoneskin", "Guardian of Faith"]},
		// ── L14: Cleansing Touch (XPHB Restoring Touch) ─────────────────
		// Restoring Touch consumes Lay on Hands charges to remove
		// conditions; the conditions removed aren't a queryable flag.
		{level: 14, name: /restoring touch|cleansing touch/i, kind: "passive"},
		// ── L15: Indomitable Guardian ───────────────────────────────────
		// Sets `indomitableGuardianResistance = ["bludgeoning",
		// "piercing", "slashing"]` in feature calculations, but those
		// flags are NOT wired through `getResistances()` (verified in
		// charactersheet-state.js — only base + active-state +
		// item-defense resistances are aggregated). No clean probe
		// without a product fix.
		{level: 15, name: /indomitable guardian/i, kind: "passive"},
		// ── L17: 5th-tier oath spells ───────────────────────────────────
		{level: 17, name: /oath of bastion spells/i, kind: "spells", skip: true, skipReason: "CS-BUG-016", grantsSpells: ["Wall of Stone", "Greater Restoration"]},
		// ── L18: Aura Expansion ─────────────────────────────────────────
		// Bumps Aura of Protection (and other auras) to 30 ft range —
		// the range itself isn't read back via the EffectCheck union.
		{level: 18, name: /aura expansion/i, kind: "passive"},
		// ── L20: Eternal Bastion capstone ───────────────────────────────
		// Sets `eternalBastionImmunity = ["bludgeoning","piercing",
		// "slashing"]` and `eternalBastionResistanceAll = true`, but
		// (same story as Indomitable Guardian) those flags don't flow
		// through `getResistances()` / `getImmunities()`. No clean state
		// probe without a product fix.
		{level: 20, name: /eternal bastion/i, kind: "passive"},
		...buildSpecialtyChecks("Paladin"),
	],
});
