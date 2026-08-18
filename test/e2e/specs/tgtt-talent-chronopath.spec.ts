import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TALENT_CHRONOPATH} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/** The nine Psionic Exertion options (`PsiEx`) a Talent chooses from at 3/7/11/15. */
const PSIONIC_EXERTIONS = [
	/Destructive Power/i,
	/Dynamic Power/i,
	/Expanded Power/i,
	/Fascinating Power/i,
	/Halting Power/i,
	/Magnified Power/i,
	/Overwhelming Power/i,
	/Shared Power/i,
	/Terrifying Power/i,
];

const TALENT_FEATURES: FeatureCheck[] = [
	// === Level 1 ===
	{
		level: 1,
		name: /psionic powers/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasPsionicPowers", exact: true},
			{kind: "featureCalculation", property: "manifestationAbility", exact: "int"},
			{kind: "featureCalculation", property: "powerSaveDc", min: 8},
			{kind: "featureCalculation", property: "powerAttackBonus", min: 2},
			{kind: "featureCalculation", property: "strainMaximum", min: 5},
			{kind: "psionicStrainMechanics"},
			// 1st-order powers never require a manifestation test.
			{kind: "manifestationTest", order: 1, roll: 1, expectStrain: 0},
			// A 2nd-order power beaten by the die is free; a tie costs 1; a loss costs
			// strain equal to the power's order.
			{kind: "manifestationTest", order: 2, roll: 4, expectStrain: 0},
			{kind: "manifestationTest", order: 2, roll: 2, expectStrain: 1},
			// Powers are first-class: a real power's prose metadata is parsed, it
			// manifests through the one pipeline, and a concentrating power registers
			// both a concentration entry and a running manifestation.
			{kind: "psionicPowerModel", power: "Apparition", expectOrder: 1},
			{kind: "psionicPowerModel", power: "Adapt", expectOrder: 2},
			// The rule the old single-slot concentration model could not express.
			{kind: "psionicConcentrationCap"},
			// Strain to Maintain derives its own price from what is actually running:
			// Apparition (1st) + Aura Projection… see the level-9 entry for the pair.
			{kind: "psionicStrainToMaintain", powers: ["Apparition"], expectCost: 1},
		],
	},
	{
		level: 1,
		untilLevel: 4,
		name: /psionic powers/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "manifestationDie", exact: "1d4"},
			{kind: "featureCalculation", property: "maxPowerOrder", exact: 2},
			{kind: "featureCalculation", property: "firstOrderPowersKnown", exact: 4},
		],
	},
	{
		level: 1,
		name: /strain to maintain/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasStrainToMaintain", exact: true}],
	},

	// === Level 2 — Chronopath ===
	{
		level: 2,
		name: /chronopathy adept/i,
		kind: "resource",
		resourceMax: [1, 5],
		effects: [
			{kind: "featureCalculation", property: "hasChronopathyAdept", exact: true},
			{kind: "featureUsesEqualAbilityMod", feature: "Chronopathy Adept", ability: "int", minimum: 1, recharge: "long"},
			{kind: "longRestRestoresFeatureUses", feature: "Chronopathy Adept"},
		],
	},
	{
		level: 2,
		name: /rapid manifestation/i,
		kind: "resource",
		resourceMax: [1, 5],
		effects: [
			{kind: "featureCalculation", property: "hasRapidManifestation", exact: true},
			{kind: "featureUsesEqualAbilityMod", feature: "Rapid Manifestation", ability: "int", minimum: 1, recharge: "long"},
			{kind: "longRestRestoresFeatureUses", feature: "Rapid Manifestation"},
		],
	},

	// === Level 3 — Psionic Exertion ===
	{
		level: 3,
		untilLevel: 6,
		name: /psionic exertion/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: PSIONIC_EXERTIONS,
		effects: [
			{kind: "featureCalculation", property: "psionicExertionsKnown", exact: 1},
			// Exertions must actually DO something. An at-manifestation option is
			// charged during the manifestation; an outcome option is charged against
			// the running manifestation afterwards; only one may apply to either.
			{
				kind: "psionicExertion",
				power: "Adapt",
				manifestationOption: "Shared Power",
				outcomeOption: "Halting Power",
			},
		],
	},

	{level: 4, name: /ability score improvement/i, kind: "passive"},

	// === Level 5 — 3rd-order powers, d6 manifestation die ===
	{
		level: 5,
		untilLevel: 8,
		name: /3rd-order powers/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "maxPowerOrder", exact: 3},
			{kind: "featureCalculation", property: "manifestationDie", exact: "1d6"},
			{kind: "featureCalculation", property: "firstOrderPowersKnown", exact: 5},
			{kind: "manifestationTest", order: 3, roll: 2, expectStrain: 3},
			// Increased Order: manifesting a 2nd-order power at 3rd raises the
			// manifestation score, which is the whole point of the mechanic.
			{kind: "psionicPowerModel", power: "Adapt", expectOrder: 2, increaseTo: 3},
			// CS-BUG-133: the Chronopathy Adept reroll is a real reroll, not a
			// resource the sheet lets you spend on nothing. Same order and same
			// failing first roll as the line above — the reroll must turn a
			// 3-strain "strained" outcome into a clean one, and cost a use.
			{
				kind: "manifestationAdeptReroll",
				feature: "Chronopathy Adept",
				order: 3,
				roll: 2,
				rerollResult: 5,
				expectRoll: 5,
				expectStrain: 0,
				expectSpend: true,
				powerType: "CP",
			},
			// ...and must NOT be spent when the first roll already beat the score.
			{
				kind: "manifestationAdeptReroll",
				feature: "Chronopathy Adept",
				order: 3,
				roll: 5,
				rerollResult: 1,
				expectRoll: 5,
				expectStrain: 0,
				expectSpend: false,
				powerType: "CP",
			},
		],
	},

	// === Level 6 — Chronopath: Decay ===
	{
		level: 6,
		name: /^decay$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasDecay", exact: true},
			{kind: "featureCalculation", property: "decayDamagePerStrain", exact: "2d10"},
			{kind: "featureCalculation", property: "decayDamageType", exact: "necrotic"},
			{kind: "featureCalculation", property: "decayDc", min: 12},
		],
	},

	// === Level 7 — Psychic Boost + an extra Psionic Exertion ===
	{
		level: 7,
		untilLevel: 11,
		name: /psychic boost/i,
		kind: "resource",
		resourceMax: 1,
		effects: [
			{kind: "featureCalculation", property: "hasPsychicBoost", exact: true},
			{kind: "featureCalculation", property: "psychicBoostUses", exact: 1},
			{kind: "longRestRestoresFeatureUses", feature: "Psychic Boost"},
			// Talent's own strain-clearing API, reachable only through a bespoke state call.
			{kind: "stateCall", method: "getStrainMaximum", min: 11},
		],
	},
	// No L7-10 Psionic Exertion rows. An L7-10 window reaches none of the
	// checkpoints [3, 5, 11, 17, 20], so `psionicExertionsKnown: 2` and
	// `pickedCount: 2` were compared against nothing — and 2 holds only on
	// L7-10, so widening changes the value. The L11 and L15 rows use the
	// same two regexes, so the feature and picker existence checks are
	// unaffected; only the unobservable step is gone.

	{level: 8, name: /ability score improvement/i, kind: "passive"},

	// === Level 9 — 4th-order powers ===
	{
		level: 9,
		untilLevel: 12,
		name: /4th-order powers/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "maxPowerOrder", exact: 4}],
	},

	// === Level 10 — Chronopath: Fickle Readiness ===
	{
		level: 10,
		name: /fickle readiness/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasFickleReadiness", exact: true}],
	},
	{
		level: 10,
		name: /psionic powers/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "firstOrderPowersKnown", exact: 6}],
	},

	// === Level 11 — Psionic Bastion + a third Psionic Exertion ===
	{
		level: 11,
		name: /psionic bastion/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasPsionicBastion", exact: true},
			{kind: "resistance", damageType: "psychic"},
			{kind: "conditionImmunity", condition: "charmed"},
			{kind: "conditionImmunity", condition: "frightened"},
		],
	},
	{
		level: 11,
		untilLevel: 14,
		name: /psionic exertion improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "psionicExertionsKnown", exact: 3}],
	},
	{
		level: 11,
		untilLevel: 14,
		name: /psionic exertion/i,
		kind: "pick",
		pickedCount: 3,
		pickedFrom: PSIONIC_EXERTIONS,
	},

	// === Level 12 — Psychic Boost (two uses) ===
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	// No row for the two-use tier. `psychicBoostUses` is
	// `level >= 17 ? 3 : level >= 12 ? 2 : 1`, so 2 holds only on L12-16 —
	// a window containing no checkpoint. Both observable values are
	// asserted: 1 at L11 (L7 row) and 3 at L17/L20 (below).

	// === Level 13 — 5th-order powers, d8 manifestation die ===
	// Open-ended, and asserting only the manifestation die. `maxPowerOrder`
	// is 5 solely on L13-16, which contains no checkpoint, so that value
	// is unobservable and the L17 row covers 6. The die, by contrast, is
	// `level >= 13 ? "1d8"` — permanent — so it stays true at L17 and L20
	// and this row now actually runs.
	{
		level: 13,
		name: /5th-order powers/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "manifestationDie", exact: "1d8"},
		],
	},

	// === Level 14 — Chronopath: Time Pocket ===
	{
		level: 14,
		name: /time pocket/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasTimePocket", exact: true},
			{kind: "featureCalculation", property: "timePocketDamage", exact: "6d10"},
			{kind: "featureCalculation", property: "timePocketStrainCost", exact: 3},
		],
	},

	// === Level 15 — a fourth Psionic Exertion ===
	{
		level: 15,
		name: /psionic exertion improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "psionicExertionsKnown", exact: 4}],
	},
	{
		level: 15,
		name: /psionic exertion/i,
		kind: "pick",
		pickedCount: 4,
		pickedFrom: PSIONIC_EXERTIONS,
	},

	{level: 16, name: /ability score improvement/i, kind: "passive"},

	// === Level 17 — 6th-order powers + Psychic Boost (three uses) ===
	{
		level: 17,
		name: /6th-order powers/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "maxPowerOrder", exact: 6}],
	},
	{
		level: 17,
		// Was `/psychic boost \(three uses\)/i`, which named a feature that
		// exists NOWHERE — `charactersheet-state.js:34038,34041,34113` names
		// both the pool and the feature exactly "Psychic Boost". It never went
		// red because `name` is INERT on a `resourceName`-pinned resource row
		// (see the note on `case "resource"` in comprehensiveBuildHelpers.ts):
		// the compiled regex is used only by passive/pick/toggle. The tier is
		// still asserted — by `resourceMax: 3` and the effect probe below.
		name: /^psychic boost$/i,
		kind: "resource",
		resourceName: "Psychic Boost",
		resourceMax: 3,
		effects: [{kind: "featureCalculation", property: "psychicBoostUses", exact: 3}],
	},

	// === Level 18 — Shielded Mind ===
	{
		level: 18,
		name: /shielded mind/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasShieldedMind", exact: true},
			{kind: "advantage", rollType: "save:int"},
			{kind: "advantage", rollType: "save:wis"},
			{kind: "advantage", rollType: "save:cha"},
		],
	},

	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},

	// === Level 20 — Ignore Strain ===
	{
		level: 20,
		name: /ignore strain/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasIgnoreStrain", exact: true},
			// Bespoke state APIs the flat calculation fields can't express.
			{kind: "stateCall", method: "getStrainMaximum", exact: 24},
			{kind: "stateCall", method: "getStrainState", path: "max", exact: 24},
			{kind: "stateCall", method: "getManifestationDie", exact: "1d8"},
			{kind: "stateCall", method: "getHigherOrderPowersKnown", exact: 21},
		],
	},
];

/**
 * MCDM Chronopath Talent (TalPsi) — L1→20.
 *
 * Coverage focus:
 *   - The Talent is a whole homebrew BASE class: hit die, saves, derived power DC and
 *     attack bonus, manifestation die and max power order all come from its own table.
 *   - Psionic strain is the class's signature currency: three tracks, twelve cumulative
 *     debuffs, a hard maximum, and a long rest that wipes it. `psionicStrainMechanics`
 *     asserts every debuff really reaches AC / speed / hit point maximum / proficiency /
 *     advantage rather than merely rendering as text.
 *   - Power selection (1st-order and 2nd-order-or-higher) and Psionic Exertion are
 *     surfaced as real pickers in the Builder, Level-Up and Quick Build flows.
 *   - Chronopath layers two Intelligence-scaled long-rest pools on top, plus Decay and
 *     Time Pocket, whose damage and DC are derived, not literal.
 */
describeCharacter({
	preset: PRESET_FULL_TALENT_CHRONOPATH,
	displayName: "Chronopath Talent Human",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		{name: "Quarterstaff", equipped: true},
		{name: "Dagger", equipped: true},
	],
	// The Talent has no transformation-style toggle: its signature currency is
	// psionic strain, a numeric tracker, and Psychic Boost is a limited-use
	// ability rather than a persistent on/off state.
	signatureToggleSkip: {skip: true, reason: "Talent has no persistent toggle; strain is numeric and Psychic Boost is a limited-use ability (covered by usage.useResourceName)"},
	usage: {
		atLevel: 7,
		useResourceName: "Psychic Boost",
		attackName: /quarterstaff|dagger/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {skip: true}, // Psychic Boost recharges on a long rest.
		concentrationCheck: {skip: true}, // Powers are not spells; concentration is not modelled as spellcasting.
		deathSaves: true,
		applyCondition: {name: "Poisoned"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 6},
		3: {totalLevel: 3, minMaxHp: 13},
		5: {totalLevel: 5, minMaxHp: 21},
		11: {totalLevel: 11, minMaxHp: 45},
		17: {totalLevel: 17, minMaxHp: 69},
		20: {totalLevel: 20, minMaxHp: 81},
	},
	featuresMatrix: TALENT_FEATURES,
});
