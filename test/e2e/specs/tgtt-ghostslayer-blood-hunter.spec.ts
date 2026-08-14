import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_GHOSTSLAYER_BLOOD_HUNTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * BH2022 Order of the Ghostslayer — the fourth and last Blood Hunter order to
 * get an E2E spec (Lycan, Mutant and Profane Soul have theirs).
 *
 * What this order tests that the other three cannot: it is the only one that
 * MODIFIES THE BASE CLASS'S OWN NUMBERS rather than bolting new machinery
 * alongside them.
 *
 *   1. Curse Specialist adds +1 to the class's Blood Maledict pool, so every
 *      checkpoint's resource count differs from the identical-level Profane
 *      Soul build. A subclass that quietly failed to apply would still look
 *      perfectly healthy on its own; it is only wrong relative to the base
 *      progression, which is why the maledict count is pinned at all five
 *      checkpoints rather than once.
 *   2. Brand of Sundering DOUBLES the Crimson Rite damage die from level 11
 *      (`1d8` -> `2d8`, `1d10` -> `2d10` at 17). The rite rider is the one
 *      number in the Blood Hunter that two different features both write, so
 *      it is asserted EXACTLY here. The `crimsonRiteMechanics` probe previously
 *      only checked that a rider *existed*, which would pass just as happily on
 *      an undoubled `1d8`; `expectDice` was added for this spec rather than
 *      inheriting that looseness.
 *
 * Levels that change a number are windowed with `untilLevel`, because a matrix
 * row is re-evaluated at EVERY checkpoint at or above its declared level
 * (checkpoints are [3, 5, 11, 17, 20]). Without the window, `aetherWalkUses:
 * 1` declared at level 7 would be re-checked at 17 and 20, where the correct
 * value is 2 — the row would fail on correct data.
 */

const GHOSTSLAYER_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /hunter'?s bane/i,
		kind: "passive",
		// The hemocraft ability is a real choice here (unlike Pact Magic's
		// restatement of it — see CS-BUG-161). Source order is ["wis", "int"] and
		// the auto-picker takes the first.
		effects: [
			{
				kind: "featureChoiceCalculation",
				className: "Blood Hunter",
				featureName: "Hunter's Bane",
				expectedChoice: "Wisdom",
				property: "hemocraftAbility",
				expectedValue: "wis",
				dcProperty: "hemocraftSaveDc",
			},
		],
	},
	{
		level: 2,
		name: /crimson rite/i,
		kind: "passive",
		// The class rite die before Brand of Sundering touches it. The hemocraft
		// die is d4 through level 4 and d6 from 5, and a matrix row is re-evaluated
		// at EVERY checkpoint at or above its level, so this needs one row per
		// die window rather than one row for "pre-Sundering". The first gated run
		// failed here with `dice=1d4, expected 1d6` — a pin that was wrong on
		// correct data, which is exactly what an exact assertion is for.
		untilLevel: 4,
		effects: [
			// The rider's DICE are pinned, not merely its existence — an
			// existence check passes identically on a correct `1d4` and on a
			// Sundering-doubled value arriving eight levels early.
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3], expectDice: "1d4"},
			{kind: "featureCalculation", property: "crimsonRiteDamage", exact: "1d4"},
		],
	},
	{
		level: 5,
		name: /crimson rite/i,
		kind: "passive",
		untilLevel: 10,
		effects: [
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3], expectDice: "1d6"},
			{kind: "featureCalculation", property: "crimsonRiteDamage", exact: "1d6"},
		],
	},
	{level: 2, name: /fighting style/i, kind: "passive"},
	{
		level: 3,
		name: /order of the ghostslayer/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasRiteOfTheDawn", exact: true}],
	},
	{
		level: 3,
		name: /curse specialist/i,
		kind: "passive",
		// The order's signature interference with the base class. Pinned at every
		// checkpoint below, one row per window, because the whole point of this
		// feature is that the number differs from a plain Blood Hunter's.
		untilLevel: 5,
		effects: [
			{kind: "featureCalculation", property: "bloodMaledictUses", exact: 2},
			// Curses normally require a target with blood; the order lifts that.
			{kind: "featureCalculation", property: "bloodCurseTargetsBloodless", exact: true},
		],
	},
	{
		level: 3,
		name: /rite of the dawn/i,
		kind: "passive",
		untilLevel: 4,
		effects: [
			{kind: "featureCalculation", property: "riteOfTheDawnLightRange", exact: 20},
			// Extra rite damage against undead, one hemocraft die — so it needs the
			// same per-window treatment as the rite die itself.
			{kind: "featureCalculation", property: "riteOfTheDawnUndeadBonusDamage", exact: "1d4"},
		],
	},
	{
		level: 5,
		name: /rite of the dawn/i,
		kind: "passive",
		untilLevel: 10,
		effects: [{kind: "featureCalculation", property: "riteOfTheDawnUndeadBonusDamage", exact: "1d6"}],
	},
	{
		level: 11,
		name: /rite of the dawn/i,
		kind: "passive",
		untilLevel: 16,
		effects: [{kind: "featureCalculation", property: "riteOfTheDawnUndeadBonusDamage", exact: "1d8"}],
	},
	{
		level: 17,
		name: /rite of the dawn/i,
		kind: "passive",
		// Note this does NOT double with Brand of Sundering — Sundering rewrites
		// `crimsonRiteDamage`, while the undead rider is a separate single die.
		effects: [{kind: "featureCalculation", property: "riteOfTheDawnUndeadBonusDamage", exact: "1d10"}],
	},
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "attackCount", min: 2}],
	},
	{
		level: 6,
		name: /brand of castigation/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasBrandOfCastigation", exact: true}],
	},
	{
		level: 7,
		name: /aether walk/i,
		// A real pool, not a flag: `_resizeFeatureBackedResource("Aether Walk", …)`
		// computes the max independently of `aetherWalkUses`, so the resource is
		// what the player actually spends. 1 use at 7-14, 2 from 15; windowed so
		// the L11 checkpoint asserts 1 while the 15+ row below asserts 2, instead
		// of one row failing at 17 and 20 on correct data.
		kind: "resource",
		untilLevel: 14,
		resourceMax: 1,
		restoreOn: "short",
		effects: [
			// Duration is the hemocraft MODIFIER, which grows with ASIs, so this is
			// the one Ghostslayer number that is legitimately a floor rather than a
			// pin — an exact value here would encode the ASI plan, not the feature.
			{kind: "featureCalculation", property: "aetherWalkDurationRounds", min: 1},
		],
	},
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	{
		level: 9,
		name: /grim psychometry/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasGrimPsychometry", exact: true}],
	},
	{
		level: 10,
		name: /dark augmentation/i,
		kind: "passive",
		effects: [{kind: "speedBonus", min: 5}],
	},
	{
		level: 11,
		name: /brand of sundering/i,
		kind: "passive",
		// The doubled rite die — the single most falsifiable claim in this spec.
		// Windowed to 11-16 where the hemocraft die is d8.
		untilLevel: 16,
		effects: [
			{kind: "featureCalculation", property: "hasBrandOfSundering", exact: true},
			{kind: "featureCalculation", property: "crimsonRiteDamage", exact: "2d8"},
			// The doubling asserted on the RIDER the weapon actually carries, not
			// only on the calculation that feeds it. CS-BUG-125 was exactly a case
			// of the calc being right while nothing rode the weapon.
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3], expectDice: "2d8"},
		],
	},
	{
		level: 11,
		name: /curse specialist|blood maledict/i,
		kind: "passive",
		untilLevel: 16,
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", exact: 3}],
	},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{
		level: 13,
		name: /brand of tethering/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasBrandOfTethering", exact: true}],
	},
	{
		level: 14,
		name: /hardened soul/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasHardenedSoul", exact: true}],
	},
	{
		level: 15,
		name: /blood curse of the exorcist/i,
		kind: "passive",
		// Granted outright by the order, and — as with the Lycan's Howl and the
		// Profane Soul's Souleater — WITHOUT consuming a known-curse slot.
		//
		// Asserted as a REAL ACTIVATION, not as `grantsBloodCurseOfTheExorcist` and not
		// as a mere activatable listing. That calc flag exists but nothing in `js/`
		// reads it; and an `activatableListed` check passed even while the curse was
		// unusable (CS-BUG-162), because it matched the descriptive subclass feature of
		// the same name. `featureActivation` runs `detectActivatableFeature`, which
		// returned `null` before the fix and now returns a descriptor costing 1 Blood
		// Maledict — so this probe can actually tell the two states apart.
		effects: [
			{kind: "featureActivation", feature: "Blood Curse of the Exorcist", resourceName: "Blood Maledict", resourceCost: 1},
		],
	},
	{
		level: 15,
		name: /aether walk/i,
		kind: "resource",
		resourceMax: 2,
		restoreOn: "short",
	},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{
		level: 17,
		name: /blood maledict improvement/i,
		kind: "passive",
		// Base 4 + Curse Specialist's 1. A plain Blood Hunter reads 4 here, so this
		// row is the level at which the order's modifier is most easily lost.
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", exact: 5}],
	},
	{
		level: 17,
		name: /brand of sundering|crimson rite/i,
		kind: "passive",
		// d10 hemocraft die, still doubled by Sundering.
		effects: [
			{kind: "featureCalculation", property: "crimsonRiteDamage", exact: "2d10"},
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3], expectDice: "2d10"},
		],
	},
	{
		level: 18,
		name: /rite revival/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasRiteRevival", exact: true}],
	},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	{
		level: 20,
		name: /sanguine mastery/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasSanguineMastery", exact: true}],
	},
];

describeCharacter({
	preset: PRESET_FULL_GHOSTSLAYER_BLOOD_HUNTER,
	displayName: "Order of the Ghostslayer Blood Hunter Human",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		{name: "Longsword", equipped: true},
	],
	// Crimson Rite is the class's real toggle and is present at L5. Verified
	// against what the ungated L5 build actually renders rather than what the
	// order grants on paper: Ghostslayer's own L3 features are all passive, so
	// none of them produce an Overview activatable row (see CS-BUG-156 — a probe
	// that silently skips is indistinguishable from one that passes).
	signatureToggle: /rite of the/i,
	// Crimson Rite asks which weapon to empower whenever more than one is
	// equipped, so the probe must answer the dialog.
	signatureTogglePrompt: "OK",
	usage: {
		atLevel: 7,
		useResourceName: "Blood Maledict",
		attackName: /longsword/i,
		skillRoll: {name: "Arcana"},
		// 2 base at L7 + 1 Curse Specialist = 3. A plain Blood Hunter restores to
		// 2 here, so this number is order-specific rather than boilerplate.
		shortRestRestores: {resourceName: "Blood Maledict", expectAfter: 3},
		// This order does not cast, so concentration has no in-character source.
		// Skipped explicitly rather than dropped, per the standard.
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectResources: {"Blood Maledict": 1}},
		// From L3 every count below carries Curse Specialist's +1.
		3: {totalLevel: 3, minMaxHp: 24, expectResources: {"Blood Maledict": 2}},
		5: {totalLevel: 5, minMaxHp: 38, expectResources: {"Blood Maledict": 2}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Blood Maledict": 3}},
		17: {totalLevel: 17, minMaxHp: 122, expectResources: {"Blood Maledict": 5}},
		20: {totalLevel: 20, minMaxHp: 143, expectResources: {"Blood Maledict": 5}},
	},
	featuresMatrix: GHOSTSLAYER_FEATURES,
});
