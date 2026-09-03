import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHAINED_FURY_MINOTAUR} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildWeaponMasteryChecks} from "../utils/tgttFeaturePools";

/**
 * #9 — Chained Fury Barbarian Minotaur (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Rage uses scale per Barbarian table (2/3/4/5/6)
 *   - Rage damage bonus scales (+2/+3/+4) and applies on the toggle
 *   - Reckless Attack at L2, Extra Attack at L5
 *   - Path of the Chained Fury subclass features at L3, L6, L10, L14 — each with
 *     real effect probes: the rage-gated Spectral Chains weapon appearing on the
 *     Combat tab, table-driven damage/reach scaling, the derived restrain DC, the
 *     grapple size category, and the L14 three-attack allowance
 *   - Primal Champion at L20 boosts STR/CON beyond 20
 */
describeCharacter({
	preset: PRESET_FULL_CHAINED_FURY_MINOTAUR,
	displayName: "Chained Fury Barbarian Minotaur",
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a
		// weapon the USE attack probe can actually roll.
		{name: "Greataxe", equipped: true},
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
		concentrationCheck: {castSpell: "Bless", thenAction: "rage", expectActive: false},
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
		// XPHB Weapon Mastery — preset masteryCount=2 → wizard picks the
		// first two proficient simple weapons (Club + Dagger, DOM order).
		...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
		// ── Class features ────────────────────────────────────────
		{
			level: 1,
			name: /^rage$/i,
			kind: "toggle", skip: true, skipReason: "CS-BUG-017",
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
		// No L1-2 or L12-16 tier: those windows reach none of the
		// checkpoints [3, 5, 11, 17, 20], so `resourceMax` 2 and 5 were
		// compared against nothing, and neither can be widened without
		// changing the correct value. The observable steps are 3, 4 and 6.
		{
			level: 3,
			untilLevel: 5,
			name: "Rage",
			kind: "resource",
			resourceMax: 3,
			effects: [
				{kind: "longRestRestores", resource: "Rage"},
			],
		},
		{level: 6,  untilLevel: 11, name: "Rage", kind: "resource", resourceMax: 4},
		{level: 17, name: "Rage", kind: "resource", resourceMax: 6},

		// Minotaur's Powerful Build is the cleanest end-to-end probe of the shared carry
		// contract: it is a race feature whose only mechanical effect is on carrying
		// capacity, so it fails loudly if the feature parser, the state adapter, or the
		// contract stop talking to each other. It also pins the rule that used to be wrong
		// in three places at once — doubling capacity must NOT double the encumbrance tiers.
		{
			level: 1,
			name: /powerful build/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getCarryProfile", path: "carryMultiplier", exact: 2},
				// Capacity is real and finite (the old TGTT bug produced absurd values here).
				{kind: "stateCall", method: "getCarryProfile", path: "bodyCapacity", min: 1},
				// Push/drag/lift is twice the BODY capacity, never inflated by containers.
				{kind: "stateCall", method: "getCarryProfile", path: "pushDragLift", min: 2},
				// A freshly built character is not encumbered, and every surface that asks
				// gets this same answer — the inventory bar, play mode, and the PDF all read
				// through here now.
				{kind: "stateCall", method: "getEncumbranceLevel", exact: "normal"},
			],
		},
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
		{level: 2, name: /reckless attack/i, kind: "toggle", skip: true, skipReason: "CS-BUG-017", toggleDelta: "none"},
		// Danger Sense grants advantage on DEX saves vs. effects you can see — a conditional
		// the sheet doesn't expose as a blanket advantage source, so no probe is added.
		{level: 2, name: /danger sense/i, kind: "passive"},
		{
			level: 5,
			name: /extra attack/i,
			kind: "passive",
			effects: [
				{kind: "rollAttack", attackName: /greataxe|battleaxe|maul/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
				{kind: "rollSkillCheck", skill: "athletics", skip: true, skipReason: "CS-BUG-017"},
				// Phase 8: numeric attack-bonus probe. At L5 prof = +3 and a
				// martial STR weapon adds STR mod (≥0) → bonus must be ≥3.
				{kind: "attackBonus", attackName: /greataxe|battleaxe|maul/i, min: 3, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
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
			skip: true, skipReason: "CS-BUG-017",
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
				// The wizard build's pre-capstone scores are STR 19 / CON 13, so
				// assert Primal Champion's +4 contribution rather than a false 24 floor.
				{kind: "stateCall", method: "getAbilityBonusBreakdown", args: ["str"], path: "contributions", contains: "\"source\":\"primalChampion\",\"label\":\"Primal Champion\",\"amount\":4"},
				{kind: "stateCall", method: "getAbilityBonusBreakdown", args: ["con"], path: "contributions", contains: "\"source\":\"primalChampion\",\"label\":\"Primal Champion\",\"amount\":4"},
			],
		},

		// ── Subclass: Path of the Chained Fury (TGTT) ────────────
		// Every one of these was previously a bare existence check carrying the
		// comment "aren't surfaced as state-probeable fields". They are now, and the
		// features are no longer inert, so each level gets real effect probes.
		//
		// Manifest Chains is a RAGE-GATED toggle (`requiresStates: ["rage"]`), so the
		// toggle probes declare `requiresStates` — without it the harness cannot even
		// activate the row, because a non-raging barbarian is correctly not offered it.
		// NOTE ON BANDING: `assertFeaturesMatrix` re-runs every row whose
		// `level <= currentLevel`, so a row pinning an exact scaled value is
		// re-checked at L11 and L20 too. Anything read from
		// `subclassTableGroups` (damage die, range) or that steps at a later
		// tier (chain count, grapple ceiling) therefore carries `untilLevel`
		// to bound its band; the invariants that hold at every level stay
		// unbounded so they keep being asserted all the way to 20.
		{
			level: 3,
			name: /manifest chains/i,
			kind: "toggle",
			toggleDelta: "none",
			requiresStates: ["rage"],
			effects: [
				// The chains are a real weapon on the Combat tab, and ONLY while manifested.
				{kind: "toggleAddsAttack", namePattern: /spectral chains/i},
				// Grapple + shove riders are offered at every level from 3 up.
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackOnHitOptions", contains: "chains-grapple"},
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackOnHitOptions", contains: "chains-shove"},
			],
		},
		{
			// L3–5 band: base die/range off the subclass table, one size category
			// of grapple bonus, two chains.
			level: 3,
			untilLevel: 5,
			name: /manifest chains/i,
			kind: "toggle",
			toggleDelta: "none",
			requiresStates: ["rage"],
			effects: [
				// Scaling comes from the subclass table, not a hardcoded ladder.
				{kind: "featureCalculation", property: "chainDamageDie", exact: "1d8"},
				{kind: "featureCalculation", property: "chainRange", exact: 15},
				{kind: "featureCalculation", property: "chainCount", exact: 2},
				// Grapple size category is a real derived bundle, not just prose.
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "effective", exact: "Large"},
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "maxTargetSize", exact: "Huge"},
			],
		},
		{
			level: 6,
			name: /chain imprisonment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "chainsAreMagical", exact: true},
				// Restrain DC is derived (8 + prof + STR), not a constant.
				{kind: "featureCalculation", property: "chainRestrainDc", min: 12},
				// Recurring force damage equals barbarian level.
				{kind: "featureCalculation", property: "chainRestrainDamage", min: 6},
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackOnHitOptions", contains: "chains-restrain"},
			],
		},
		{
			level: 6,
			untilLevel: 9,
			name: /chain imprisonment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "chainDamageDie", exact: "1d10"},
				{kind: "featureCalculation", property: "chainRange", exact: 20},
			],
		},
		{
			level: 10,
			name: /chain control/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "chainGrappleSizeBonus", exact: 2},
				{kind: "featureCalculation", property: "chainShoveDistance", exact: 10},
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "effective", exact: "Huge"},
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackOnHitOptions", contains: "chains-control-shove"},
			],
		},
		{
			level: 10,
			untilLevel: 13,
			name: /chain control/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "chainDamageDie", exact: "1d12"},
				{kind: "featureCalculation", property: "chainRange", exact: 25},
				// Ceiling is one step above "Huge" until Unchained Fury removes it.
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "maxTargetSize", exact: "Gargantuan"},
			],
		},
		{
			level: 14,
			name: /unchained fury/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "chainCount", exact: 4},
				// Top band of the subclass table — holds to L20, so unbounded.
				{kind: "featureCalculation", property: "chainDamageDie", exact: "2d6"},
				{kind: "featureCalculation", property: "chainRange", exact: 30},
				{kind: "featureCalculation", property: "chainFreeMovement", exact: true},
				// Three attacks per Attack action, gated on the chains being out.
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackActionAllowances", contains: "\"count\":3"},
				{kind: "stateCall", method: "getFeatureCalculations", path: "attackActionAllowances", contains: "\"requiresState\":\"manifestChains\""},
				// No grapple size ceiling at all.
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "unlimited", exact: true},
				{kind: "stateCall", method: "getGrappleSizeCategory", path: "maxTargetSize", exact: "Any"},
			],
		},
		...buildSpecialtyChecks("Barbarian"),
	],
});
