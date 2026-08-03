import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_STEEL_HAWK_FIGHTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const STEEL_HAWK_FEATURES_MATRIX: FeatureCheck[] = [
	{
		level: 1,
		name: /second wind/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Second Wind"}],
	},
	{
		level: 2,
		name: /action surge/i,
		kind: "resource",
		resourceMax: [1, 2],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Action Surge"}],
	},

	// ===== Launch (3 / 7 / 10 / 15 / 18) =====
	// Every tier gets its OWN entry with an EXACT max. The matrix re-evaluates
	// each earlier entry at every later checkpoint, so a `untilLevel`-less
	// growing pool would make its own level-3 row fail at level 7.
	{
		level: 3,
		untilLevel: 6,
		name: /^launch$/i,
		kind: "resource",
		resourceName: "Launch",
		resourceMax: 3,
		restoreOn: "short",
		effects: [
			{kind: "featureCalculation", property: "hasLaunch", exact: true},
			{kind: "featureCalculation", property: "launchUses", exact: 3},
			// 15 ft of combined horizontal + vertical leap before Steel Grace.
			{kind: "featureCalculation", property: "launchDistance", exact: 15},
			// "doesn't provoke opportunity attacks" is a real modelled property,
			// not prose in the description.
			{kind: "featureCalculation", property: "launchProvokesOpportunityAttacks", exact: false},
			// "subtract up to 30 feet from the fall" — displayed only (no fall-damage
			// system exists in this codebase), but still a resolved number.
			{kind: "featureCalculation", property: "launchFallReduction", exact: 30},
			{kind: "shortRestRestores", resource: "Launch"},
			{kind: "stateCall", method: "getLaunchUsesMax", exact: 3},
			// Spending a use ACTUALLY resolves a leap and arms the momentum rider.
			{kind: "stateCall", method: "useLaunch", path: "distance", exact: 15},
			{kind: "stateCall", method: "getLaunchUsesRemaining", exact: 2},
			{kind: "stateCall", method: "hasLaunchMomentum", exact: true},
			// …and while armed, the melee attack gets advantage on BOTH aggregators.
			{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack:melee:str"], exact: true},
			{kind: "stateCall", method: "getAdvantageState", args: ["attack:melee:str"], path: "advantage", exact: true},
			// The rider is SCOPED to melee — a ranged attack gets nothing.
			{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack:ranged:dex"], exact: false},
		],
	},
	{
		// Damage tier 1: 1d8 from 3 until Eagle Eye bumps it at 10.
		level: 3,
		untilLevel: 9,
		name: /^launch$/i,
		kind: "resource",
		resourceName: "Launch",
		effects: [
			{kind: "featureCalculation", property: "launchBonusDamage", exact: "1d8"},
			// effects[0] is the advantage rider; effects[1] is the weapon-typed die.
			{kind: "stateCall", method: "getLaunchMomentumEffects", path: "1.value", exact: "1d8"},
			// The extra damage is melee-only, so it can never leak onto a ranged
			// attack or a spell.
			{kind: "stateCall", method: "getLaunchMomentumEffects", path: "1.meleeOnly", exact: true},
			// Crit range is untouched before Eagle Eye.
			{kind: "stateCall", method: "getCriticalRange", exact: 20},
		],
	},
	{
		level: 7,
		untilLevel: 14,
		name: /^launch$/i,
		kind: "resource",
		resourceName: "Launch",
		resourceMax: 4,
		effects: [
			{kind: "featureCalculation", property: "launchUses", exact: 4},
			{kind: "featureCalculation", property: "launchDistance", exact: 30},
			{kind: "stateCall", method: "getLaunchUsesMax", exact: 4},
		],
	},
	{
		level: 15,
		name: /^launch$/i,
		kind: "resource",
		resourceName: "Launch",
		resourceMax: 5,
		effects: [
			{kind: "featureCalculation", property: "launchUses", exact: 5},
			{kind: "stateCall", method: "getLaunchUsesMax", exact: 5},
		],
	},

	// ===== Nimble Lancer (3) =====
	{
		level: 3,
		name: /nimble lancer/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasNimbleLancer", exact: true},
			{kind: "featureCalculation", property: "nimbleLancerDisengageDistance", exact: 5},
			// A lance has NO versatile property in the SRD data — the feature
			// synthesises one, and it reaches the damage resolver.
			{
				kind: "stateCall",
				method: "getNimbleLancerLanceDamage",
				args: [{name: "Lance"}],
				path: "oneHanded",
				exact: "1d8",
			},
			{
				kind: "stateCall",
				method: "getNimbleLancerLanceDamage",
				args: [{name: "Lance"}],
				path: "twoHanded",
				exact: "1d12",
			},
			// The generic profile resolver — the thing the hands-used toggle, the
			// damage roll and the inventory line all read — reports the synthesised
			// versatile die, proving this is not a bespoke display string.
			{
				kind: "stateCall",
				method: "getEffectiveWeaponDamageProfile",
				args: [{name: "Lance", dmg1: "1d12"}],
				path: "dmg2",
				exact: "1d12",
			},
			// Scoped: a longsword is untouched.
			{
				kind: "stateCall",
				method: "getNimbleLancerLanceDamage",
				args: [{name: "Longsword"}],
				exact: null,
			},
		],
	},

	// ===== Bird Caller (3) =====
	{
		level: 3,
		name: /bird caller/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasBirdCaller", exact: true},
			// *animal messenger* is granted as a RITUAL-ONLY innate spell, not the
			// bogus 1/day the generic parser used to invent.
			{kind: "stateCall", method: "getInnateSpells", contains: "Animal Messenger"},
			{kind: "stateCall", method: "getInnateSpells", contains: "\"ritualOnly\":true"},
			// Advantage on Animal Handling is CONDITIONAL (flying beasts only), so it
			// must surface as an opt-in rather than an unconditional grant.
			{
				kind: "stateCall",
				method: "aggregateModifiers",
				args: ["skill:animal handling"],
				path: "conditionalsAvailable",
				contains: "flying",
			},
		],
	},

	// ===== Steel Grace (7) =====
	{
		level: 7,
		name: /steel grace/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSteelGrace", exact: true},
			// "your armor never imposes disadvantage on your Dexterity (Stealth) checks"
			{kind: "featureCalculation", property: "ignoresArmorStealthDisadvantage", exact: true},
			{kind: "stateCall", method: "hasArmorStealthDisadvantage", exact: false},
			// Launch-fuelled Evasion: no damage on a success, half on a failure.
			{kind: "featureCalculation", property: "hasLaunchEvasion", exact: true},
			{kind: "stateCall", method: "useLaunchEvasion", args: [{success: true, damage: 22}], path: "damage", exact: 0},
			{kind: "stateCall", method: "useLaunchEvasion", args: [{success: false, damage: 22}], path: "damage", exact: 11},
		],
	},

	// ===== Eagle Eye (10) =====
	{
		level: 10,
		name: /eagle eye/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasEagleEye", exact: true},
			// "you gain proficiency in the Perception skill if you don't already have it"
			{kind: "stateCall", method: "getSkillProficiency", args: ["perception"], min: 1},
			// DC 8 + PB + STR. PB is 4 at L10, so the floor is 12 even at STR 10.
			{kind: "featureCalculation", property: "steelHawkSaveDc", min: 12},
			// The sight toggle is a real state that MOVES the Perception modifier.
			{kind: "stateCall", method: "setEagleEyeSightActive", args: [true], exact: true},
			{kind: "stateCall", method: "isEagleEyeSightActive", exact: true},
		],
	},
	{
		// Damage tier 2 plus the widened crit range, both released at 10 and both
		// superseded at 18 — so this row must expire before the capstone.
		level: 10,
		untilLevel: 17,
		name: /eagle eye/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "launchBonusDamage", exact: "1d10"},
			{kind: "featureCalculation", property: "launchCriticalRange", exact: 19},
			{kind: "stateCall", method: "getLaunchMomentumEffects", path: "1.value", exact: "1d10"},
			// The 19-20 crit range applies only WHILE the momentum rider is armed.
			{kind: "stateCall", method: "useLaunch", path: "criticalRange", exact: 19},
			{kind: "stateCall", method: "getCriticalRange", exact: 19},
		],
	},

	// ===== Predatory Instinct (15) =====
	{
		level: 15,
		name: /predatory instinct/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasPredatoryInstinct", exact: true},
			// "you have advantage on initiative rolls" — resolved through the same
			// `getInitiativeRollMode()` the roll handler uses, not a bespoke flag.
			{kind: "stateCall", method: "getInitiativeRollMode", path: "advantage", exact: true},
			{kind: "stateCall", method: "getAdvantageState", args: ["initiative"], path: "advantage", exact: true},
			// "if you have no uses left, you regain one" — only when empty.
			{kind: "stateCall", method: "setLaunchUsesRemaining", args: [0], exact: true},
			{kind: "stateCall", method: "restoreLaunchOnInitiative", exact: 1},
			{kind: "stateCall", method: "getLaunchUsesRemaining", exact: 1},
			// Called again with a use in the bank, it must be a no-op.
			{kind: "stateCall", method: "restoreLaunchOnInitiative", exact: 0},
		],
	},

	// ===== Improved Launch (18) =====
	{
		level: 18,
		name: /improved launch/i,
		kind: "resource",
		resourceName: "Improved Launch",
		resourceMax: 1,
		restoreOn: "short",
		effects: [
			{kind: "featureCalculation", property: "hasImprovedLaunch", exact: true},
			{kind: "featureCalculation", property: "improvedLaunchDistance", exact: 90},
			{kind: "featureCalculation", property: "improvedLaunchExhaustionCost", exact: 1},
			{kind: "featureCalculation", property: "improvedLaunchMaxExhaustion", exact: 1},
			// Final damage tier.
			{kind: "featureCalculation", property: "launchBonusDamage", exact: "1d12"},
			{kind: "shortRestRestores", resource: "Improved Launch"},
			{kind: "stateCall", method: "canUseImprovedLaunch", exact: true},
			// A push-mode Launch costs a Launch use, the once-per-rest use AND a
			// level of exhaustion — all three, in one call. It also suppresses fall
			// damage outright rather than shaving 30 ft off it.
			{kind: "stateCall", method: "useLaunch", args: [{improved: true}], path: "distance", exact: 90},
			{kind: "stateCall", method: "getExhaustion", exact: 1},
			// The once-per-rest pool is now empty, so a second push is refused.
			{kind: "stateCall", method: "canUseImprovedLaunch", exact: false},
		],
	},

	// ===== Fighter chassis =====
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "extraAttacks", min: 2}],
	},
	{
		level: 9,
		name: /indomitable/i,
		kind: "resource",
		// Defensive pin, NOT load-bearing. It names the authoritative pool
		// explicitly; it does not describe how the sheet renders. Once
		// CS-BUG-112 (classic-Fighter Indomitable emitting a second, stale
		// "Indomitable (two uses)" pool) is fixed, the pattern resolves to a
		// single pool and this line is redundant — check known-bugs.md for
		// status rather than inferring it from this comment.
		resourceName: "Indomitable",
		resourceMax: [1, 3],
		restoreOn: "long",
		effects: [{kind: "longRestRestores", resource: "Indomitable"}],
	},
];

/**
 * TGS2 Steel Hawk Fighter — L1→20.
 *
 * Coverage focus:
 *   - Launch's short-rest pool across all three size tiers (3 / 4@7 / 5@15),
 *     its distance tiers (15 / 30@7 / 90@18) and the momentum rider it arms
 *     (melee-scoped advantage + a 1d8 / 1d10@10 / 1d12@18 weapon-typed die)
 *   - Nimble Lancer's synthesised versatile lance profile reaching the generic
 *     weapon-damage resolver
 *   - Bird Caller's ritual-only *animal messenger* and its opt-in conditional
 *     advantage on Animal Handling
 *   - Steel Grace's armor-stealth waiver and Launch-fuelled Evasion, Eagle Eye's
 *     automatic Perception proficiency / 19-20 crit range / toggleable sight
 *     bonus, Predatory Instinct's initiative advantage + refill, and Improved
 *     Launch's exhaustion-priced 90 ft push
 */
describeCharacter({
	preset: PRESET_FULL_STEEL_HAWK_FIGHTER,
	displayName: "Steel Hawk Fighter Aarakocra",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Lance", source: "PHB"},
		{name: "Cloak of Protection", source: "DMG", attune: true},
	],
	// Eagle Eye's sight bonus IS a toggle, but it only exists from level 10 —
	// past the L5 window the signature-toggle probe runs in. It is asserted
	// instead via the level-10 featuresMatrix row (setEagleEyeSightActive +
	// isEagleEyeSightActive), and the momentum rider is asserted at level 3.
	signatureToggleSkip: {skip: true, reason: "Steel Hawk's only stance-shaped toggle (Eagle Eye sight) unlocks at L10, past the L5 signature-toggle window; probed in the featuresMatrix instead"},
	usage: {
		useResourceName: "Launch",
		// The USE probe runs on the bare L5 sheet (midTierLoadout is applied only by
		// the loadout test), so it targets the Aarakocra's innate Talons rather than
		// a weapon the character has not been handed yet.
		attackName: /talons|unarmed strike/i,
		skillRoll: {name: "Perception"},
		// Launch explicitly recharges on a short OR long rest.
		shortRestRestores: {resource: "Launch"},
		// Fighter has no concentration spell at L5.
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		// The build takes Archery, a passive Fighting Style with no activatable toggle.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectToggles: [/second wind/i]},
		3: {totalLevel: 3, minMaxHp: 25, expectResources: {Launch: 3}},
		5: {totalLevel: 5, minMaxHp: 39, expectResources: {Launch: 3}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {Launch: 4}},
		17: {totalLevel: 17, minMaxHp: 120, expectResources: {Launch: 5}},
		20: {totalLevel: 20, minMaxHp: 140, expectResources: {Launch: 5, "Improved Launch": 1}},
	},
	featuresMatrix: STEEL_HAWK_FEATURES_MATRIX,
});
