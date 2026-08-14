import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_MUTANT_BLOOD_HUNTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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

const MUTANT_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /hunter'?s bane/i,
		kind: "passive",
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
	// no measurable derived effect: the order's opening feature is pure framing for the
	// three mechanical features (Formulas / Mutagencraft / Mutagens) that arrive with it.
	{level: 3, name: /order of the mutant/i, kind: "passive"},
	{
		level: 3,
		name: /formulas/i,
		kind: "passive",
		// The cap is the whole point of Formulas: it is what makes the mutagen pool a
		// choice rather than a menu. Asserting the number ALONE would have passed
		// throughout CS-BUG-124, when the value was computed and never enforced — so
		// the enforcement itself is probed below via `mutagenFormulasCap`.
		effects: [
			{kind: "featureCalculation", property: "mutagenFormulasKnown", min: 4},
			{kind: "mutagenFormulasCap"},
		],
	},
	{
		level: 3,
		name: /mutagencraft/i,
		kind: "passive",
	},
	{
		level: 3,
		name: /mutagen/i,
		kind: "resource",
		resourceMax: [1, 3],
		restoreOn: "short",
	},
	{
		level: 3,
		name: /^mutagens$/i,
		kind: "passive",
		// NOT `kind: "pick"`. Mutagen formulas are never auto-picked, because MTGN is
		// absent from the class's `optionalfeatureProgression` — the same structural
		// fact that caused CS-BUG-124. The player learns them through the Formulas
		// prompt, so the probe below teaches one and then drives the real UI.
		//
		// This is the UI-path probe. Every other Blood Hunter effect check calls the
		// state API from `page.evaluate`; this one clicks the real Activate button and
		// answers the real prompt — the layer CS-BUG-124 was missing entirely.
		effects: [{
			kind: "mutagenUiFlow",
			formula: "Impermeable",
			expectResistance: "piercing",
			expectVulnerability: "slashing",
		}],
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
		name: /strange metabolism/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "long",
		effects: [
			// Real effects, not `hasStrangeMetabolism`. The negative control matters:
			// a predicate that answered `true` for everything would satisfy the first
			// two assertions and still be broken.
			{kind: "stateMethodEffect", method: "getImmunities", reader: "getImmunities", expectReaderContains: ["poison"]},
			{kind: "stateMethodEffect", method: "isImmuneToCondition", args: ["poisoned"], expectReturnValue: true},
			{kind: "stateMethodEffect", method: "isImmuneToCondition", args: ["frightened"], expectReturnValue: false},
		],
	},
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	{
		level: 9,
		name: /grim psychometry/i,
		kind: "passive",
		effects: [{
			kind: "conditionalAdvantage",
			rollType: "skill:history",
			conditionalIncludes: "sinister or tragic history",
			sourceIncludes: "Grim Psychometry",
		}],
	},
	{
		level: 10,
		name: /dark augmentation/i,
		kind: "passive",
		effects: [
			{kind: "speed", type: "walk", min: 35},
			{kind: "featureCalculation", property: "darkAugmentationSaveBonus", min: 1},
		],
	},
	{
		level: 10,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 3,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 3}],
	},
	{
		level: 11,
		name: /brand of axiom/i,
		kind: "passive",
		// (CS-BUG-150) `hasBrandOfAxiom` was assigned and never read, so nothing
		// rendered or mentioned the feature. Assert the rider a player can actually
		// see on a branded target, not the flag.
		effects: [{
			kind: "stateMethodEffect",
			method: "activateState",
			args: ["brandedTarget"],
			reader: "getBrandedTargetEffects",
			expectReaderContains: ["axiom"],
		}],
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
		effects: [
			{kind: "featureCalculation", property: "brandTetherDamage", exact: "4d6"},
			{kind: "featureCalculation", property: "brandTetherDc", min: 13},
		],
	},
	{
		level: 14,
		name: /hardened soul/i,
		kind: "passive",
		effects: [
			{
				kind: "conditionalAdvantage",
				rollType: "save:wis",
				conditionalIncludes: "charmed",
				sourceIncludes: "Hardened Soul",
			},
		],
	},
	{
		level: 14,
		name: /crimson rite improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", exact: 3}],
	},
	{
		level: 14,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 3,
		pickedFrom: CRIMSON_RITES,
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", exact: 3}],
	},
	{
		level: 14,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 4,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 4}],
	},
	{
		level: 15,
		name: /blood curse of corrosion/i,
		kind: "passive",
		// Granted outright by the order, so it must be present WITHOUT having been picked.
		// Curses are invoked through the Blood Maledict resource rather than their own row,
		// so presence here IS the assertion. The budget-independence invariant (the curse
		// does not consume a known-curse slot) is pinned level-exactly in the Jest suite
		// instead: matrix rows are evaluated at the checkpoint levels [3,5,11,17,20], not
		// at their declared level, so any level-varying number pinned here is fragile.
		effects: [],
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
		name: /exalted mutation/i,
		kind: "resource",
		resourceMax: [1, 3],
		restoreOn: "long",
		effects: [{kind: "featureCalculation", property: "hasExaltedMutation", exact: true}],
	},
	{
		level: 18,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 5,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", exact: 5}],
	},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	{
		level: 20,
		name: /sanguine mastery/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasSanguineMastery", exact: true}],
	},
];

/**
 * BH2022 Order of the Mutant Blood Hunter — L1→20.
 *
 * Coverage focus:
 *   - Mutagens reached through the REAL Activate button and confirmation prompt
 *     (CS-BUG-124: the state layer was complete and correct while no UI existed,
 *     so 81 green unit tests all entered below the missing layer).
 *   - The formulas-known cap actually ENFORCES rather than merely computing.
 *   - Both halves of a mutagen land: the benefit and the drawback.
 *   - Brand of Axiom surfaces a rider on a branded target (CS-BUG-150).
 */
describeCharacter({
	preset: PRESET_FULL_MUTANT_BLOOD_HUNTER,
	displayName: "Order of the Mutant Blood Hunter Human",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		{name: "Longsword", equipped: true},
	],
	// NOT `/mutagen/i`. Two independent reasons, and the second is the one that
	// matters: `getToggleableFeatureNames()` reads `.charsheet__activatable-row` on
	// the OVERVIEW tab, while mutagen rows are `.charsheet__feature` cards on the
	// FEATURES tab. So the pattern is structurally unmatchable — seeding a formula
	// would not have helped. Crimson Rite is the class's real Overview toggle and is
	// present at L5; the mutagen click path is covered by `mutagenUiFlow` above.
	signatureToggle: /rite of the/i,
	// Crimson Rite asks which weapon to empower (`pGetUserEnum`), so the probe must
	// answer the dialog or the handler returns before activating anything.
	signatureTogglePrompt: "OK",
	usage: {
		atLevel: 7,
		useResourceName: "Blood Maledict",
		attackName: /longsword/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {resourceName: "Blood Maledict", expectAfter: 2},
		concentrationCheck: {skip: true}, // Blood Hunters have no concentration spellcasting.
		deathSaves: true,
		// Strange Metabolism (L7) grants immunity to the poisoned condition, so
		// `applyCondition("Poisoned")` correctly refuses on this build. Probe the generic
		// condition plumbing with one this order is not immune to; the immunity itself is
		// asserted on the Strange Metabolism matrix row.
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectResources: {"Blood Maledict": 1}},
		3: {totalLevel: 3, minMaxHp: 24, expectResources: {"Blood Maledict": 1, "Mutagen": 1}},
		5: {totalLevel: 5, minMaxHp: 38, expectResources: {"Blood Maledict": 1}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Blood Maledict": 2}},
		17: {totalLevel: 17, minMaxHp: 122, expectResources: {"Blood Maledict": 4}},
		20: {totalLevel: 20, minMaxHp: 143, expectResources: {"Blood Maledict": 4}},
	},
	featuresMatrix: MUTANT_FEATURES,
});
