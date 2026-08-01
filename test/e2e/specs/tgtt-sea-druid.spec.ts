import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SEA_DRUID} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * NOTE ON ABILITY SCORES — the shared wizard driver assigns the standard
 * array 15/14/13/12/10/8 in a fixed STR→CHA order, so this Druid ends up
 * with WIS 10 (+0) at L3 and whatever the auto-picked ASIs give later.
 * Every Wisdom-scaled assertion below therefore uses `min` (or is pinned
 * with `untilLevel: 3`, before the first ASI can move the score) rather
 * than a hard-coded die count.
 */
const SEA_FEATURES: FeatureCheck[] = [
	{
		level: 3,
		name: /circle of the sea spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Fog Cloud"},
			{kind: "spellInList", spell: "Gust of Wind"},
			{kind: "spellInList", spell: "Ray of Frost"},
			{kind: "spellInList", spell: "Shatter"},
			{kind: "spellInList", spell: "Thunderwave"},
		],
	},
	{
		level: 3,
		name: /^wrath of the sea$/i,
		kind: "passive",
		// NOTE: deliberately NOT `kind: "toggle"`. A toggle check activates and
		// deactivates the feature, and each activation burns a Wild Shape use —
		// at L3 the pool is only 2 deep, so a toggle check here would starve the
		// `activeStateTrigger` probe below. `pickActivatable` proves the toggle
		// surfaces; the trigger probe proves it actually activates and fires.
		effects: [
			// The four mechanics the feature actually has: typed damage, a save
			// against the druid's own spell save DC, a forced push, and a Wild
			// Shape cost.
			{kind: "featureCalculation", property: "wrathOfTheSeaDamageType", exact: "cold"},
			{kind: "featureCalculation", property: "wrathOfTheSeaSaveAbility", exact: "con"},
			{kind: "featureCalculation", property: "wrathOfTheSeaDiceCount", min: 1},
			{kind: "featureCalculation", property: "wrathOfTheSeaPush", exact: 15},
			{kind: "featureCalculation", property: "wrathOfTheSeaMaxPushSize", exact: "Large"},
			{kind: "featureCalculation", property: "wrathOfTheSeaDc", min: 10},
			{kind: "stateCall", method: "getWrathOfTheSeaAction", path: "damage", contains: "d6"},
			{kind: "stateCall", method: "getWrathOfTheSeaAction", path: "resourceName", exact: "Wild Shape"},
			{kind: "stateCall", method: "getWrathOfTheSeaWildShapeCost", args: ["self"], exact: 1},
			{kind: "pickActivatable", matchAny: [/^Wrath of the Sea$/i]},
		],
	},
	{
		// Pinned pre-ASI so the exact dice formula and the 5-ft Emanation are
		// both deterministic. Later checkpoints re-check the same mechanics
		// through the `min`/`untilLevel` entries above and below.
		level: 3,
		untilLevel: 3,
		name: /^wrath of the sea$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "wrathOfTheSeaEmanation", exact: 5},
			{
				kind: "activeStateTrigger",
				feature: "Wrath of the Sea",
				stateTypeId: "wrathOfTheSea",
				label: "Ocean Spray",
				actionType: "bonus",
				damageType: "cold",
				damageMin: 0,
				damageFormula: "1d6",
				dcMin: 10,
			},
		],
	},
	{
		// Wild Shape is the fuel for the whole subclass, so prove the 2024 table's
		// progression rather than accepting any pool size: 2 (L2-5), 3 (L6-16),
		// 4 (L17-20).
		level: 3,
		untilLevel: 5,
		name: "Wild Shape",
		kind: "resource",
		resourceMax: 2,
	},
	{
		level: 6,
		untilLevel: 16,
		name: "Wild Shape",
		kind: "resource",
		resourceMax: 3,
	},
	{
		level: 17,
		name: "Wild Shape",
		kind: "resource",
		resourceMax: 4,
	},
	{
		level: 5,
		name: /circle of the sea spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Lightning Bolt"},
			{kind: "spellInList", spell: "Water Breathing"},
		],
	},
	{
		level: 6,
		name: /aquatic affinity/i,
		kind: "passive",
		effects: [
			// A COMPUTED swim speed that tracks the walking speed, not prose.
			{kind: "speedEquals", left: "swim", right: "walk"},
			// Aquatic Affinity also widens the Emanation from 5 ft to 10 ft.
			{kind: "featureCalculation", property: "wrathOfTheSeaEmanation", exact: 10},
		],
	},
	{
		level: 7,
		name: /circle of the sea spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Control Water"},
			{kind: "spellInList", spell: "Ice Storm"},
		],
	},
	{
		level: 9,
		name: /circle of the sea spells/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Conjure Elemental"},
			{kind: "spellInList", spell: "Hold Monster"},
		],
	},
	{
		level: 10,
		name: /^stormborn$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSeaStormborn", exact: true},
			// The Tempest Cleric's identically-named L17 feature owns
			// `hasStormborn`; a Sea Druid must NOT set it, or it would inherit
			// Tempest's ALWAYS-ON fly speed instead of the Emanation-gated one.
			{kind: "speed", type: "fly", exact: 0},
		],
	},
	{
		level: 10,
		name: /^wrath of the sea$/i,
		kind: "toggle",
		toggleDelta: "any",
		effects: [
			// Stormborn's benefits are benefits OF the Emanation: they must only
			// exist while it is manifested.
			{kind: "toggleGrantsResistance", damageType: "cold"},
			{kind: "toggleGrantsResistance", damageType: "lightning"},
			{kind: "toggleGrantsResistance", damageType: "thunder"},
			{kind: "toggleGrantsSpeed", type: "fly", equalsWalk: true},
		],
	},
	{
		level: 14,
		name: /oceanic gift/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "oceanicGiftRange", exact: 60},
			// Three placements become available, and covering BOTH the druid and
			// an ally really does cost two Wild Shape uses.
			{kind: "stateCall", method: "getWrathOfTheSeaPlacements", path: "length", exact: 3},
			{kind: "stateCall", method: "getWrathOfTheSeaWildShapeCost", args: ["both"], exact: 2},
			{kind: "stateCall", method: "getWrathOfTheSeaWildShapeCost", args: ["ally"], exact: 1},
			// Placing the Emanation on an ally moves Stormborn's benefits with
			// it — the druid keeps the DC and the dice, but not the resistances.
			{kind: "stateCall", method: "getWrathOfTheSeaAction", args: ["ally"], path: "grantsFlySpeed", exact: false},
			{kind: "stateCall", method: "getWrathOfTheSeaAction", args: ["ally"], path: "damage", contains: "d6"},
			{kind: "stateCall", method: "getWrathOfTheSeaAction", args: ["both"], path: "grantsFlySpeed", exact: true},
		],
	},
];

/**
 * XPHB 2024 Circle of the Sea Druid — L1→20.
 *
 * Coverage focus:
 *   - Wrath of the Sea as a real Wild-Shape-fuelled Emanation: CON save at the
 *     druid's spell save DC, Cold damage scaling on the Wisdom modifier, a
 *     15-ft push, and a bonus-action trigger that consumes the bonus action.
 *   - Aquatic Affinity's computed swim speed and the 5 ft → 10 ft Emanation.
 *   - Stormborn's Emanation-gated resistances and fly speed (and the proof
 *     that it does NOT leak the Tempest Cleric's always-on variant).
 *   - Oceanic Gift's placement choice and its doubled Wild Shape cost.
 */
describeCharacter({
	preset: PRESET_FULL_SEA_DRUID,
	displayName: "Circle of the Sea Druid (XPHB)",
	signatureToggle: /wrath of the sea/i,
	// At the L5 loadout checkpoint the Emanation's entire payload is a
	// bonus-action save-for-damage burst plus a forced push — neither is a
	// persistent derived stat, so `probeToggleDelta`'s AC/DC/speed/resistance
	// snapshot legitimately shows no delta. The persistent half of the feature
	// (Stormborn's resistances + fly speed) arrives at L10 and is asserted with
	// real toggle probes in the features matrix above.
	signatureToggleNoDerivedEffect: "At L5 Wrath of the Sea's whole effect is a bonus-action CON-save damage burst with a push; Stormborn's persistent resistances and fly speed only arrive at L10 (covered by toggleGrantsResistance / toggleGrantsSpeed in the matrix).",
	midTierLoadout: [
		{name: "Scimitar", equipped: true},
		{name: "Shield", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Wild Shape",
		expectLongRestRestores: true,
		attackName: /scimitar/i,
		skillRoll: {name: "Nature"},
		// XPHB Wild Shape recharges on a Long Rest (and via Wild Resurgence),
		// not on a Short Rest, so there is no short-rest pool to probe.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Entangle", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		// This deterministic build takes ASIs, not a toggleable feat.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}},
		5: {totalLevel: 5, spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: SEA_FEATURES,
});
