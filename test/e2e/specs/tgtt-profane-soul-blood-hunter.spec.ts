import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_PROFANE_SOUL_BLOOD_HUNTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * BH2022 Order of the Profane Soul — the third and last Blood Hunter order to
 * get an E2E spec (Lycan and Mutant already have theirs).
 *
 * What makes this order worth its own spec rather than a variant of the other
 * two: it is the ONLY Blood Hunter order that casts. It bolts a reduced,
 * warlock-style Pact Magic progression onto a class whose base has no
 * spellcasting at all, and it casts that magic with the HEMOCRAFT ability
 * rather than a conventional casting stat. Two things follow that no existing
 * spec covers:
 *
 *   1. Pact slots are a SEPARATE store from the standard slot grid, rendered as
 *      `data-spell-level="pact"`. A pure pact caster has no `data-spell-level="1"`
 *      container whatsoever, so the obvious probe reports zero slots for a
 *      perfectly correct build. That is a false negative, and it is why
 *      `getSpellSlots` grew a `"pact"` argument for this spec rather than the
 *      spec working around it locally.
 *   2. The casting ability is chosen at L1 (Hunter's Bane) and consumed at L3
 *      (Pact Magic), so the two features are coupled across ten levels. The
 *      matrix pins the L1 choice AND the L3 consequence.
 */

const BLOOD_CURSES = [
	/Blood Curse of Binding/i,
	/Blood Curse of Bloated Agony/i,
	/Blood Curse of Corrosion/i,
	/Blood Curse of Exposure/i,
	/Blood Curse of the Anxious/i,
	/Blood Curse of the Exorcist/i,
	/Blood Curse of the Eyeless/i,
	/Blood Curse of the Fallen Puppet/i,
	/Blood Curse of the Howl/i,
	/Blood Curse of the Marked/i,
	/Blood Curse of the Muddled Mind/i,
	/Blood Curse of the Souleater/i,
];

const CRIMSON_RITES = [
	/Rite of the Dead/i,
	/Rite of the Flame/i,
	/Rite of the Frozen/i,
	/Rite of the Oracle/i,
	/Rite of the Roar/i,
	/Rite of the Storm/i,
];

const PROFANE_SOUL_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /hunter'?s bane/i,
		kind: "passive",
		// The Hemocraft ability is picked here and SPENT by Pact Magic at L3, which
		// is what makes this order different from the other two: the same choice
		// drives the class save DC and the subclass's spell save DC. Pinning the DC
		// (`dcProperty`) rather than only the ability is the part that would catch a
		// regression that kept the choice but stopped applying it.
		effects: [
			{
				kind: "featureChoiceCalculation",
				className: "Blood Hunter",
				featureName: "Hunter's Bane",
				expectedChoice: "Intelligence",
				property: "hemocraftAbility",
				expectedValue: "int",
				dcProperty: "hemocraftSaveDc",
			},
		],
	},
	{
		level: 1,
		name: /blood maledict/i,
		kind: "resource",
		resourceMax: [1, 4],
		restoreOn: "short",
		effects: [
			{kind: "bloodMaledictAmplification", hpCost: 2},
			{kind: "featureCalculation", property: "bloodMaledictUses", min: 1},
		],
	},
	{
		level: 1,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: BLOOD_CURSES,
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /Blood Curse of Binding/i,
			subEffects: [{kind: "pickActivatable", matchAny: BLOOD_CURSES, min: 1}],
		}],
	},
	{
		level: 2,
		name: /fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [
			/archery/i, /blind fighting/i, /defense/i, /dueling/i,
			/great weapon fighting/i, /two-weapon fighting/i,
		],
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /dueling/i,
			subEffects: [{kind: "modifierBonus", modType: "damage:melee", min: 2}],
		}],
	},
	{
		level: 2,
		name: /crimson rite/i,
		kind: "passive",
		effects: [
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3]},
			{kind: "featureCalculation", property: "hasCrimsonRite", exact: true},
		],
	},
	{
		level: 2,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: CRIMSON_RITES,
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /Rite of the Dead/i,
			subEffects: [{kind: "pickActivatable", matchAny: CRIMSON_RITES, min: 1}],
		}],
	},
	// Pure framing for the three mechanical features that arrive with it
	// (Otherworldly Patron / Pact Magic / Rite Focus), each probed below.
	{level: 3, name: /order of the profane soul/i, kind: "passive"},
	{
		level: 3,
		name: /otherworldly patron/i,
		kind: "passive",
		// The patron is the order's one branching decision, and several later
		// features (Rite Focus, Revealed Arcana, Unsealed Arcana) are documented as
		// keying off it. Asserting the calculation READS BACK the recorded choice is
		// what makes the choice load-bearing rather than decorative.
		effects: [
			{
				kind: "featureChoiceCalculation",
				className: "Blood Hunter",
				featureName: "Otherworldly Patron",
				expectedChoice: "The Fiend",
				property: "profaneSoulPatron",
				expectedValue: "The Fiend",
			},
		],
	},
	{
		level: 3,
		name: /pact magic/i,
		kind: "passive",
		// Three separate claims, deliberately not collapsed into one:
		//   - the order casts at all (`hasPactMagic`);
		//   - it casts with the HEMOCRAFT ability, not a conventional casting stat;
		//   - the slots actually RENDER, through the pact store rather than the
		//     numeric grid — the UI half that a state-only assertion would miss.
		effects: [
			{kind: "featureCalculation", property: "hasPactMagic", exact: true},
			{kind: "featureCalculation", property: "profaneSoulSpellcastingAbility", exact: "int"},
			{kind: "featureCalculation", property: "profaneSoulCantripsKnown", min: 2},
			{kind: "featureCalculation", property: "profaneSoulSpellsKnown", min: 2},
			// The four calcs above all read the PROGRESSION TABLE, so they report 2/2
			// whether or not the player was ever able to pick anything. CS-BUG-158 was
			// exactly that: the picker offered an empty Blood Hunter list and the
			// character learned nothing, while every calc still said 2. This counts the
			// cantrips ACTUALLY LEARNED, which is the only assertion here that can fail
			// when the spell-list plumbing breaks.
			{kind: "cantripCount", min: 2},
			{kind: "spellSlots", level: "pact", min: 1},
		],
	},
	{
		level: 3,
		name: /rite focus/i,
		kind: "passive",
		// Only the flag and the patron name are modelled. The PATRON-SPECIFIC Rite
		// Focus benefits (Archfey's no-cover glow, Celestial's Blood-Maledict heal,
		// Fathomless' speed reduction, …) are not implemented as mechanics, so there
		// is nothing further to assert without asserting prose. Recorded as a known
		// limitation rather than papered over with a text match.
		effects: [{kind: "featureCalculation", property: "hasRiteFocus", exact: true}],
	},
	// ASIs are auto-filled and do not have a deterministic target.
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "attackCount", exact: 2}],
	},
	{
		level: 6,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", min: 2}],
	},
	{
		level: 6,
		name: /brand of castigation/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "brandDamage", min: 1}],
	},
	{
		level: 6,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 2,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 2}],
	},
	{
		level: 7,
		name: /crimson rite improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", min: 2}],
	},
	{
		level: 7,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 2,
		pickedFrom: CRIMSON_RITES,
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", min: 2}],
	},
	{
		level: 7,
		name: /mystic frenzy/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMysticFrenzy", exact: true},
			{kind: "featureCalculation", property: "mysticFrenzyBonusAttack", exact: true},
		],
	},
	{
		level: 7,
		name: /revealed arcana/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasRevealedArcana", exact: true}],
	},
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
		// +5 walking speed on a Human base of 30.
		effects: [{kind: "speed", type: "walk", min: 35}],
	},
	{
		level: 11,
		name: /brand of the sapping scar/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasBrandOfTheSappingScar", exact: true}],
	},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{
		level: 13,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", min: 3}],
	},
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
		name: /unsealed arcana/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasUnsealedArcana", exact: true}],
	},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{
		level: 17,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", exact: 4}],
	},
	{
		level: 18,
		name: /blood curse of the souleater/i,
		kind: "passive",
		// Granted outright by the order at 18, and — the part worth pinning — WITHOUT
		// consuming one of the character's known-curse slots. Curses are invoked
		// through the Blood Maledict resource rather than their own row, so presence
		// plus the grant flag is the assertion available here. The budget-independence
		// invariant is pinned level-exactly in the Jest suite instead, because matrix
		// rows are evaluated at the checkpoint levels [3,5,11,17,20] rather than at
		// their declared level, which makes any level-varying number fragile here.
		effects: [{kind: "featureCalculation", property: "grantsBloodCurseOfTheSouleater", exact: true}],
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
	preset: PRESET_FULL_PROFANE_SOUL_BLOOD_HUNTER,
	displayName: "Order of the Profane Soul Blood Hunter Human",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		{name: "Longsword", equipped: true},
	],
	// Crimson Rite, not a Profane Soul feature. Checked against what the L5 build
	// ACTUALLY renders rather than what the order grants on paper: the order's own
	// L3 features are passive (Pact Magic, Rite Focus) or a one-time choice
	// (Patron), so none of them produce an Overview `.charsheet__activatable-row`.
	// The rite is the class's real toggle and is present at L5.
	signatureToggle: /rite of the/i,
	// Crimson Rite asks which weapon to empower (`pGetUserEnum`) whenever more than
	// one is equipped, so the probe must answer the dialog or the handler returns
	// before activating anything.
	signatureTogglePrompt: "OK",
	usage: {
		atLevel: 7,
		useResourceName: "Blood Maledict",
		attackName: /longsword/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {resourceName: "Blood Maledict", expectAfter: 2},
		// Unlike the other two orders, this one DOES cast — so concentration is
		// genuinely reachable here and is exercised rather than skipped.
		concentrationCheck: {},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectResources: {"Blood Maledict": 1}},
		3: {totalLevel: 3, minMaxHp: 24, expectResources: {"Blood Maledict": 1}},
		5: {totalLevel: 5, minMaxHp: 38, expectResources: {"Blood Maledict": 1}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Blood Maledict": 2}},
		17: {totalLevel: 17, minMaxHp: 122, expectResources: {"Blood Maledict": 4}},
		20: {totalLevel: 20, minMaxHp: 143, expectResources: {"Blood Maledict": 4}},
	},
	featuresMatrix: PROFANE_SOUL_FEATURES,
});
