import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHAINED_FURY_MINOTAUR} from "../utils/characterBuilder";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * #9 — Chained Fury Barbarian Minotaur (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Rage uses scale per Barbarian table (2/3/4/4/5/5/6/6/unlimited)
 *   - Rage damage bonus scales (+2/+3/+4) and applies on the toggle
 *   - Reckless Attack at L2, Extra Attack at L5
 *   - Path of the Chained Fury subclass features at L3, L6, L10, L14
 *   - Primal Champion at L20 boosts STR/CON beyond 20
 */
describeCharacter({
	preset: PRESET_FULL_CHAINED_FURY_MINOTAUR,
	displayName: "Chained Fury Barbarian Minotaur",
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /rage|reckless attack|chained/i,
	usage: {
		atLevel: 5,
		useResourceName: "Rage",
		attackName: /greataxe|battleaxe|maul/i,
		skillRoll: {name: "Athletics"},
		// Barbarians don't have a class-granted SR resource at L5; skip.
		shortRestRestores: {skip: true},
		// Activating Rage breaks any concentration the player has.
		concentrationCheck: {skip: true}, // blocked by CS-BUG-007 (Rage doesn't break concentration)
		deathSaves: true,
		applyCondition: {skip: true}, // blocked by CS-BUG-009 (addCondition hangs render — to retest after fix)
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  expectToggles: [/rage/i], expectResources: {"Rage": 2}},
		3:  {totalLevel: 3,  expectResources: {"Rage": 3}},
		5:  {totalLevel: 5,  expectResources: {"Rage": 3}},
		11: {totalLevel: 11, expectResources: {"Rage": 4}},
		17: {totalLevel: 17, expectResources: {"Rage": 6}},
		20: {totalLevel: 20, expectToggles: [/primal champion|persistent rage|indomitable/i]},
	},
	featuresMatrix: [
		// ── Class features ────────────────────────────────────────
		{
			level: 1,
			name: /^rage$/i,
			kind: "toggle",
			toggleDelta: "any",
			effects: [
				// Per ACTIVE_STATE_TYPES.rage: advantage on STR checks/saves + B/P/S resistance.
				{kind: "toggleGrantsAdvantage", rollType: "save:str"},
				{kind: "toggleGrantsAdvantage", rollType: "check:str"},
				{kind: "toggleGrantsResistance", damageType: "bludgeoning"},
				{kind: "toggleGrantsResistance", damageType: "piercing"},
				{kind: "toggleGrantsResistance", damageType: "slashing"},
			],
		},
		// Rage uses pool — re-checked at scaling thresholds.
		{
			level: 1,
			name: "Rage",
			kind: "resource",
			resourceMax: 2,
			effects: [
				{kind: "longRestRestores", resource: "Rage"},
			],
		},
		{level: 3,  name: "Rage", kind: "resource", resourceMax: 3},
		{level: 6,  name: "Rage", kind: "resource", resourceMax: 4},
		{level: 12, name: "Rage", kind: "resource", resourceMax: 5},
		{level: 17, name: "Rage", kind: "resource", resourceMax: 6},
		// L20 grants unlimited rages — accept any high value or sentinel.
		{level: 20, name: "Rage", kind: "resource", resourceMax: [6, 999]},

		{
			level: 1,
			name: /unarmored defense/i,
			kind: "passive",
			effects: [
				// Barbarian save proficiencies — STR is one of the two proficient saves.
				{kind: "rollSavingThrow", ability: "str"},
			],
		},
		// Reckless Attack grants advantage on the next melee STR attack and gives attackers
		// advantage in return — a per-roll conditional the sheet doesn't surface as global
		// advantage state. Parent FeatureCheck already verifies the toggle exists.
		{level: 2, name: /reckless attack/i, kind: "toggle", toggleDelta: "none"},
		// Danger Sense grants advantage on DEX saves vs. effects you can see — a conditional
		// the sheet doesn't expose as a blanket advantage source, so no probe is added.
		{level: 2, name: /danger sense/i, kind: "passive"},
		{
			level: 5,
			name: /extra attack/i,
			kind: "passive",
			effects: [
				{kind: "rollAttack", attackName: /greataxe|battleaxe|maul/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
				{kind: "rollSkillCheck", skill: "athletics"},
				// Phase 8: numeric attack-bonus probe. At L5 prof = +3 and a
				// martial STR weapon adds STR mod (≥0) → bonus must be ≥3.
				{kind: "attackBonus", attackName: /greataxe|battleaxe|maul/i, min: 3},
			],
		},
		{
			level: 5,
			name: /fast movement/i,
			kind: "passive",
			effects: [
				// Barbarian +10 walking speed (unarmored). Minotaur base 30 → 40+.
				{kind: "speed", type: "walk", min: 40},
			],
		},
		{
			level: 7,
			name: /feral instinct/i,
			kind: "passive",
			effects: [
				// Feral Instinct gives advantage on initiative; getAdvantageState doesn't expose
				// initiative-specific advantage, so probe via the roll-button no-throw path.
				{kind: "rollInitiative"},
			],
		},
		{
			level: 9,
			name: /brutal critical/i,
			kind: "passive",
			effects: [
				// Brutal Critical adds extra weapon dice on crits — not surfaced as a state field
				// (no `brutalCriticalDice` probe). Use a roll-button probe instead.
				{kind: "rollAttack", attackName: /greataxe|battleaxe|maul/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
			],
		},
		{
			level: 11,
			name: /relentless rage/i,
			kind: "passive",
			effects: [
				// Relentless Rage triggers off the recovery CON save — barb is proficient in CON.
				{kind: "rollSavingThrow", ability: "con"},
			],
		},
		// Persistent Rage L15: rage no longer ends from "no attack/no damage taken for a turn".
		// We can't probe automatic re-application — there is no state field for it.
		{level: 15, name: /persistent rage/i, kind: "passive"},
		{
			level: 18,
			name: /indomitable might/i,
			kind: "passive",
			effects: [
				// indomitable might can't be probed via getAbilityScore — floor is on str checks not score
				{kind: "rollAbilityCheck", ability: "str"},
			],
		},
		{
			level: 20,
			name: /primal champion/i,
			kind: "passive",
			effects: [
				// Primal Champion: +4 STR & CON, max raised to 24. Probe via abilityScore floor.
				{kind: "abilityScore", ability: "str", min: 24},
				{kind: "abilityScore", ability: "con", min: 24},
			],
		},

		// ── Subclass: Path of the Chained Fury (TGTT) ────────────
		// Subclass features grant flavor mechanics (manifested chain weapons, prone/restrained
		// effects on hit) that aren't surfaced as state-probeable fields. Existence is verified
		// by the parent FeatureCheck; no additional effect probes available.
		{level: 3,  name: /manifest chains/i, kind: "passive"},
		{level: 6,  name: /chain imprisonment/i, kind: "passive"},
		{level: 10, name: /chain control/i, kind: "passive"},
		{level: 14, name: /unchained fury/i, kind: "passive"},
		...buildSpecialtyChecks("Barbarian"),
	],
});
