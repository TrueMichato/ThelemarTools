import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CROWN_PALADIN} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * Oath of the Crown Paladin (SCAG, PHB 2014 chassis) — L1→20.
 *
 * Coverage focus — every Crown feature must do something observable, not just render:
 *   - Oath Spells at 3/5/9/13/17 land in the always-prepared list
 *   - Champion Challenge is an activatable Channel Divinity whose WIS save DC is
 *     resolved from the CHARACTER (8 + PB + CHA), not the old hard-coded 10
 *   - Turn the Tide is an activatable Channel Divinity that rolls 1d6 + CHA (min 1)
 *     healing rather than being prose-only
 *   - Divine Allegiance transfers damage to the paladin as UNPREVENTABLE damage
 *   - Unyielding Spirit registers GATED save advantage against paralysed/stunned —
 *     offered to the per-roll picker, never auto-applied
 *   - Exalted Champion is a durational toggle granting B/P/S resistance + WIS-save
 *     advantage, not a one-shot button
 */
const CROWN_FEATURES: FeatureCheck[] = [
	// ── L1: half-caster chassis ─────────────────────────────────────────
	// Lay on Hands renders as an activatable ability row with a Use button, so
	// `getGenericPoolResources()` deliberately EXCLUDES it — probe the feature's
	// own uses + long-rest restore rather than `kind: "resource"`.
	{
		level: 1,
		name: /lay on hands/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "layOnHandsPool", min: 5},
			{kind: "longRestRestores", resource: "Lay on Hands"},
			{kind: "rollInitiative"},
		],
	},
	{
		level: 1,
		name: /divine sense/i,
		kind: "passive",
		effects: [
			{kind: "longRestRestoresFeatureUses", feature: "Divine Sense"},
		],
	},
	// ── L2: Fighting Style + spellcasting ───────────────────────────────
	{
		level: 2,
		name: /fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [/defense/i, /great weapon fighting/i, /protection/i, /dueling/i, /blessed warrior/i, /blind fighting/i, /interception/i, /two-weapon fighting/i],
	},
	{
		level: 2,
		name: /spellcasting/i,
		kind: "passive",
		effects: [{kind: "spellSlots", level: 1, min: 2}],
	},
	// ── L3: the oath lands ──────────────────────────────────────────────
	// The 2014 Paladin's Channel Divinity is a SINGLE use at every level (only the
	// 2024 Paladin scales 2 → 3, and only the Cleric reaches 3 at L18) — see
	// `_getChannelDivinityUsesForClass` / CS-BUG-033. The matrix re-evaluates this
	// row at every later checkpoint, which is exactly the regression guard we want.
	// Channel Divinity renders as an activatable row so it is excluded from
	// `getGenericPoolResources()`; probe the feature's own uses instead.
	{
		level: 3,
		name: /^channel divinity$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "channelDivinityUses", exact: 1},
			{kind: "shortRestRestoresFeatureUses", feature: "Channel Divinity"},
		],
	},
	{
		level: 3,
		name: /oath spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Command"},
			{kind: "spellInList", spell: "Compelled Duel"},
		],
	},
	{
		level: 3,
		name: /champion challenge/i,
		kind: "passive",
		effects: [
			// The oath's own Channel Divinity umbrella must NOT mint a second,
			// resource-less activatable row (CS-BUG-051) — assert exactly the two
			// real Channel Divinity options surface.
			{kind: "pickActivatable", matchAny: [/champion challenge/i], min: 1},
			{kind: "featureCalculation", property: "hasChampionChallenge", exact: true},
			// 8 + proficiency + CHA, resolved from the character. Before the fix the
			// action modal fell back to a hard-coded DC 10.
			{
				kind: "combatAction",
				feature: "Champion Challenge",
				// "limited" is the sheet's contract for an instant, uses-limited ability.
				interactionMode: "limited",
				rollType: "save",
				saveAbility: "wis",
				saveDcFromCharacter: true,
			},
			{kind: "rollSavingThrow", ability: "wis"},
			{kind: "rollSavingThrow", ability: "cha"},
		],
	},
	{
		level: 3,
		name: /turn the tide/i,
		kind: "passive",
		effects: [
			{kind: "pickActivatable", matchAny: [/turn the tide/i], min: 1},
			{kind: "featureCalculation", property: "hasTurnTheTide", exact: true},
			// "regains hit points equal to 1d6 + your Charisma modifier (minimum of 1)"
			{
				kind: "combatAction",
				feature: "Turn the Tide",
				interactionMode: "limited",
				formula: "1d6",
				rollType: "healing",
				abilityMod: "cha",
				minimum: 1,
			},
		],
	},
	// Tenets of the Crown / Oath of the Crown are pure flavour headers — no
	// mechanical surface exists to probe.
	{level: 3, name: /tenets of the crown/i, kind: "passive"},
	{
		level: 3,
		name: /divine health/i,
		kind: "passive",
		effects: [{kind: "conditionImmunity", condition: "diseased"}],
	},
	// ── L5: Extra Attack + 2nd-tier oath spells ─────────────────────────
	{level: 5, name: /extra attack/i, kind: "passive"},
	{
		level: 5,
		name: /oath spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Warding Bond"},
			{kind: "spellInList", spell: "Zone of Truth"},
		],
	},
	// ── L6: Aura of Protection ──────────────────────────────────────────
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
	// ── L7: Divine Allegiance ───────────────────────────────────────────
	// A reaction-shaped ability with no uses of its own (the Song of Defense
	// precedent): it must render a Use button AND actually move HP.
	{
		level: 7,
		name: /divine allegiance/i,
		kind: "passive",
		effects: [
			{kind: "pickActivatable", matchAny: [/divine allegiance/i], min: 1},
			{kind: "featureCalculation", property: "hasDivineAllegiance", exact: true},
			// The whole mechanic: the paladin takes the ally's damage, and it is
			// UNPREVENTABLE — temporary hit points must not soak any of it.
			{
				kind: "stateMethodEffect",
				method: "useDivineAllegiance",
				args: [7],
				setup: {tempHp: 5},
				expectHpDelta: -7,
				expectTempHpDelta: 0,
				expectReturns: {applied: true, damageTransferred: 7},
			},
			{kind: "rollAbilityCheck", ability: "cha"},
		],
	},
	// ── L9: 3rd-tier oath spells ────────────────────────────────────────
	{
		level: 9,
		name: /oath spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Aura of Vitality"},
			{kind: "spellInList", spell: "Spirit Guardians"},
		],
	},
	// ── L10: Aura of Courage ────────────────────────────────────────────
	{
		level: 10,
		name: /aura of courage/i,
		kind: "passive",
		effects: [{kind: "conditionImmunity", condition: "frightened"}],
	},
	// ── L11: Improved Divine Smite ──────────────────────────────────────
	// The 1d8 radiant rider is not surfaced as a queryable bonus on the sheet.
	{level: 11, name: /improved divine smite/i, kind: "passive"},
	// ── L13: 4th-tier oath spells ───────────────────────────────────────
	{
		level: 13,
		name: /oath spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Banishment"},
			{kind: "spellInList", spell: "Guardian of Faith"},
		],
	},
	// ── L14: Cleansing Touch ────────────────────────────────────────────
	{
		level: 14,
		name: /cleansing touch/i,
		kind: "passive",
		effects: [{kind: "longRestRestoresFeatureUses", feature: "Cleansing Touch"}],
	},
	// ── L15: Unyielding Spirit ──────────────────────────────────────────
	// "advantage on saving throws to avoid becoming paralyzed or stunned" is a
	// GATED conditional: it must reach the per-roll opt-in picker and must not
	// silently apply to every save. Two conditions ⇒ two independent entries
	// (CS-BUG-052 collapsed them into one).
	{
		level: 15,
		name: /unyielding spirit/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasUnyieldingSpirit", exact: true},
			{kind: "conditionalAdvantage", rollType: "save:con", conditionalIncludes: "paralyzed", sourceIncludes: "Unyielding Spirit"},
			{kind: "conditionalAdvantage", rollType: "save:con", conditionalIncludes: "stunned", sourceIncludes: "Unyielding Spirit"},
		],
	},
	// ── L17: 5th-tier oath spells ───────────────────────────────────────
	{
		level: 17,
		name: /oath spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Circle of Power"},
			{kind: "spellInList", spell: "Geas"},
		],
	},
	// ── L20: Exalted Champion capstone ──────────────────────────────────
	// A one-hour toggle, not a one-shot button. B/P/S resistance from nonmagical
	// weapons + advantage on WIS saves.
	{
		level: 20,
		name: /exalted champion/i,
		kind: "toggle",
		effects: [
			{kind: "featureCalculation", property: "hasExaltedChampion", exact: true},
			{kind: "toggleGrantsResistance", damageType: "bludgeoning"},
			{kind: "toggleGrantsResistance", damageType: "piercing"},
			{kind: "toggleGrantsResistance", damageType: "slashing"},
			{kind: "toggleGrantsAdvantage", rollType: "save:wis"},
			{kind: "longRestRestoresFeatureUses", feature: "Exalted Champion"},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_CROWN_PALADIN,
	displayName: "Oath of the Crown Paladin (SCAG)",
	// Exalted Champion is L20-only, so the L5 signature-toggle probe has to target
	// something the build actually has at L5. The only guaranteed toggleable rows a
	// Crown paladin owns at L5 are its two Channel Divinity options; Champion
	// Challenge's entire effect lands on OTHER creatures (a WIS save to stop them
	// moving away), so no self-facing stat can move.
	signatureToggle: /champion challenge/i,
	signatureToggleNoDerivedEffect: "Champion Challenge is enemy-facing (nearby creatures make a WIS save or can't willingly move away); the sheet models one character, so no self-facing stat changes. Activation and the character-derived save DC are asserted instead.",
	midTierLoadout: [
		{name: "Longsword", equipped: true},
		{name: "Chain Mail", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		// Channel Divinity is NOT a generic resource pool for the 2014 Paladin — it
		// renders as an activatable ability row, so `getGenericPoolResources()` (and
		// therefore `getResource()`) never sees it. Drive Lay on Hands here and cover
		// Channel Divinity's short-rest recovery via `shortRestRestoresFeatureUses`
		// in the matrix instead.
		useResourceName: "Lay on Hands",
		expectLongRestRestores: true,
		attackName: /longsword/i,
		skillRoll: {name: "Persuasion"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		// This deterministic build takes ASIs, not a toggleable feat.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, acRange: [10, 22]},
		// Champion Challenge / Turn the Tide are INSTANT abilities (Use button), not
		// durational toggles, so they are asserted via `pickActivatable` in the matrix
		// rather than `expectToggles` here.
		3: {totalLevel: 3, minMaxHp: 22, spellSlots: {1: 3}},
		5: {totalLevel: 5, minMaxHp: 38, spellSlots: {2: 2}},
		11: {totalLevel: 11, minMaxHp: 75, spellSlots: {3: 3}},
		17: {totalLevel: 17, minMaxHp: 115, spellSlots: {5: 1}},
		20: {totalLevel: 20, minMaxHp: 130, spellSlots: {5: 2}, expectToggles: [/exalted champion/i]},
	},
	featuresMatrix: CROWN_FEATURES,
});
