import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_WICKED_WITCH_SORCERER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks, buildAnyMetamagicChecks, TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

// ── Wicked Witch Sorcerer L1→20 features matrix ─────────────────────
//
// Chassis: TGTT Sorcerer (`Sorcerer|TGTT`), which republishes the Arcadia 8
// Wicked Witch Sorcerous Origin as `Wicked Witch|TGTT-AR`. The Arcadia 8 brew
// is already part of the site's default `homebrew/index.json` fan-out, so the
// preset deliberately carries NO `homebrewUrls` — supplying one suppresses the
// fan-out and takes the TGTT Sorcerer class with it.
//
// Sorcerer base (TGTT table):
//   L1  Font of Magic / Sorcery Points = sorcerer level + 1 (TGTT starts at 1)
//   L2+ Metamagic — 3 known, 5 at L10, 7 at L17
//   L4  Specialties
//   L20 Sorcerous Restoration
// Wicked Witch subclass (Ar8 levels 1/1/6/14/18; the origin itself is picked at
// sorcerer level 3 on the TGTT chassis, so the "level 1" features arrive at 3):
//   L3  Granny's Gifts   — always-prepared spell list + a granted-spell swap
//                          + a long-rest charm/fright ward on self or an ally
//   L3  Hag Ancestor     — Green / Night / Sea; each grants a specialty school,
//                          a language and a skill proficiency
//   L6  Clever Little Witch — reaction, SP = spell level, HALVED (floored) when
//                          the spell is from the ancestor's specialty school
//   L14 Fly, My Pretty   — enchant an object; rider gets fly 60 + charm/fright
//                          immunity
//   L18 Coven Calling    — reflect any spell seen in the last minute, and 2 SP
//                          for two duplicates that can each cast a known
//                          instantaneous spell of 3rd level or lower

/**
 * The three Hag Ancestor options, mirroring
 * `CharacterSheetClassUtils.TABLE_DRIVEN_SUBFEATURE_CHOICES["hag ancestor|ar8"]`
 * (the in-tree source of truth — Arcadia 8 itself is an out-of-tree brew, so
 * there is no generated pool to import here).
 */
const HAG_ANCESTORS: RegExp[] = [
	/green hag/i,
	/night hag/i,
	/sea hag/i,
];

const WICKED_WITCH_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Sorcerer base ────────────────────────────────────────────
	// TGTT Sorcery Points = sorcerer level + 1 from L1 (single source of
	// truth: `CharacterSheetState.getSorceryPointsMaxForClass`).
	{
		level: 3,
		name: "Sorcery Points",
		kind: "resource",
		untilLevel: 4,
		resourceMax: 4,
		restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Sorcery Points"},
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollInitiative"},
		],
	},
	{level: 5, name: "Sorcery Points", kind: "resource", untilLevel: 10, resourceMax: 6,
		effects: [
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollAbilityCheck", ability: "cha"},
		]},
	{level: 11, name: "Sorcery Points", kind: "resource", untilLevel: 16, resourceMax: 12},
	{level: 17, name: "Sorcery Points", kind: "resource", untilLevel: 19, resourceMax: 18},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 21},

	// Metamagic is CAST-TIME on this sheet — deliberately excluded from the
	// activatable rows — so probe ownership and cast-time availability through
	// the state APIs rather than with a `pickToggleable` probe.
	{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 3},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
			{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 1}], contains: "Aimed Spell"},
		]},
	{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 5,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 5},
		]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 7,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 7},
		]},
	...buildAnyMetamagicChecks(["TGTT"]),
	...buildSpecialtyChecks("Sorcerer"),

	{level: 3, untilLevel: 3, name: /font of magic/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
			{kind: "stateCall", method: "useSorceryPoint", args: [2], exact: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 2},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
	{level: 20, name: /sorcerous restoration/i, kind: "passive",
		effects: [
			{kind: "shortRestRestores", resource: "Sorcery Points"},
		]},

	// ── Wicked Witch: the origin wrapper ─────────────────────────
	{level: 3, name: /wicked witch/i, kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasGrannysGifts", exact: true},
			{kind: "featureCalculation", property: "hasHagAncestor", exact: true},
		]},

	// ── Hag Ancestor (L3) — the subclass's headline CHOICE ────────
	// Surfaced by Builder / Level-Up / Quick Build through the shared
	// `seedSubclassFeatureChoices` → `addPendingFeatureChoice` pipeline, so a
	// `kind: "pick"` check proves the choice was offered AND answered.
	{level: 3, name: /hag ancestor/i, kind: "pick", pickedCount: 1,
		pickedFrom: HAG_ANCESTORS,
		effects: [
			// The auto-picker's deterministic first choice is the Green Hag,
			// whose specialty school is Illusion, language Sylvan, skill Deception.
			{kind: "stateCall", method: "getHagAncestorKind", path: "kind", exact: "Green"},
			{kind: "featureCalculation", property: "hagAncestorSpecialtySchool", exact: "Illusion"},
			{kind: "featureCalculation", property: "hagAncestorLanguage", exact: "Sylvan"},
			// The synthesised option's prose is parsed by the normal pipeline, so
			// the language is really granted rather than merely described.
			{kind: "stateCall", method: "getLanguages", contains: "Sylvan"},
			{kind: "skillBonus", skill: "deception", min: 1},
			// "advantage on Charisma checks made to influence hags" is a GATED
			// conditional — it must be offered, not silently auto-applied.
			{kind: "conditionalAdvantage", rollType: "check:cha", conditionalIncludes: "hag"},
		]},

	// ── Granny's Gifts (L3) — spells, ward, swap ─────────────────
	// The `known` grants are keyed by sorcerer level 1/3/5/7/9, so a level-3
	// witch already carries both the level-1 and the level-3 pairs.
	{level: 3, untilLevel: 4, name: /granny'?s gifts/i, kind: "spells",
		grantsSpells: ["Bane", "Tasha's Hideous Laughter", "Animal Messenger", "Mirror Image"],
		effects: [
			{kind: "spellInList", spell: "Bane"},
			{kind: "spellInList", spell: "Tasha's Hideous Laughter"},
			{kind: "spellInList", spell: "Animal Messenger"},
			{kind: "spellInList", spell: "Mirror Image"},
			// The long-rest ward: choosing yourself registers REAL advantage
			// modifiers against being charmed and frightened.
			{kind: "stateCall", method: "getGrannysGiftsWard", exact: null},
			{kind: "stateCall", method: "setGrannysGiftsWard", args: [{target: "self"}], path: "ok", exact: true},
			{kind: "stateCall", method: "getGrannysGiftsWard", path: "target", exact: "self"},
			// Query the BROAD save type a real charm/fright save actually uses — the
			// gating only kicks in for broad queries; asking for the exact sub-type
			// `save:charmed` is asking "what applies to a charm save", which correctly
			// applies unconditionally.
			{kind: "conditionalAdvantage", rollType: "save:wis", conditionalIncludes: "charmed"},
			{kind: "conditionalAdvantage", rollType: "save:wis", conditionalIncludes: "frightened"},
			// … and the ward expires with the long rest that re-offers it.
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getGrannysGiftsWard", exact: null},
			// The granted-spell swap is a real, revisitable substitution:
			// Bane (1st, necromancy) → Charm Person (1st, enchantment).
			{kind: "stateCall", method: "applyGrantedSpellSwap", args: [{
				className: "Sorcerer",
				featureName: "Granny's Gifts",
				originalSpell: {name: "Bane", source: "PHB"},
				replacementSpell: {name: "Charm Person", source: "PHB", level: 1, school: "E"},
			}], path: "ok", exact: true},
			{kind: "stateCall", method: "getGrantedSpellOverrides", args: ["Sorcerer"], contains: "Charm Person"},
		]},
	{level: 5, untilLevel: 6, name: /granny'?s gifts/i, kind: "spells",
		grantsSpells: ["Fear", "Hypnotic Pattern"],
		effects: [
			{kind: "spellInList", spell: "Fear"},
			{kind: "spellInList", spell: "Hypnotic Pattern"},
		]},
	// No `untilLevel` on the last two tiers: the MEGA checkpoints are
	// 3/5/11/17/20, so an `untilLevel: 8` window would never be visited, and
	// these grants are permanent anyway.
	{level: 7, name: /granny'?s gifts/i, kind: "spells",
		grantsSpells: ["Confusion", "Greater Invisibility"],
		effects: [
			{kind: "spellInList", spell: "Confusion"},
			{kind: "spellInList", spell: "Greater Invisibility"},
		]},
	{level: 9, name: /granny'?s gifts/i, kind: "spells",
		grantsSpells: ["Dream", "Mislead"],
		effects: [
			{kind: "spellInList", spell: "Dream"},
			{kind: "spellInList", spell: "Mislead"},
		]},

	// ── Clever Little Witch (L6) ─────────────────────────────────
	// The whole feature IS the discount, so every probe is a cost.
	{level: 6, name: /clever little witch/i, kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "cleverLittleWitchRange", exact: 15},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			// Off-school: full price. Specialty school (Illusion): halved, floored.
			{kind: "stateCall", method: "getCleverLittleWitchCost", args: [4, "Necromancy"], exact: 4},
			{kind: "stateCall", method: "getCleverLittleWitchCost", args: [4, "Illusion"], exact: 2},
			{kind: "stateCall", method: "getCleverLittleWitchCost", args: [5, "Illusion"], exact: 2},
			// RAW rounds down with no floor of 1, so a 1st-level specialty spell is free.
			{kind: "stateCall", method: "getCleverLittleWitchCost", args: [1, "Illusion"], exact: 0},
			// Using it really spends the points — assert the RETURNED cost, not an
			// absolute pool reading: this entry is re-checked at every MEGA
			// checkpoint from 11 upward, where the pool size differs.
			{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 3, school: "Necromancy", distance: 10}], path: "cost", exact: 3},
			{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 4, school: "Illusion", distance: 10}], path: "cost", exact: 2},
			// …and it refuses out-of-range triggers and cantrips.
			{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 1, school: "Illusion", distance: 40}], path: "ok", exact: false},
			{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 0, school: "Illusion", distance: 5}], path: "ok", exact: false},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},

	// ── Fly, My Pretty (L14) ─────────────────────────────────────
	{level: 14, name: /fly, my pretty/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "enchantFlyingItem", args: [{itemName: "Broomstick", commandWord: "Up"}], path: "ok", exact: true},
			{kind: "stateCall", method: "getEnchantedFlyingItem", path: "itemName", exact: "Broomstick"},
			// Riding it is the toggle: fly 60 and immunity to charm/fright.
			{kind: "stateCall", method: "activateState", args: ["flyMyPretty"], ignoreResult: true},
			{kind: "speed", type: "fly", min: 60},
			{kind: "conditionImmunity", condition: "charmed"},
			{kind: "conditionImmunity", condition: "frightened"},
			{kind: "stateCall", method: "deactivateState", args: ["flyMyPretty"], ignoreResult: true},
			// Enchanting another object ends the previous enchantment.
			{kind: "stateCall", method: "enchantFlyingItem", args: [{itemName: "Cauldron", commandWord: "Bubble"}], path: "replaced", exact: "Broomstick"},
			{kind: "stateCall", method: "getEnchantedFlyingItem", path: "itemName", exact: "Cauldron"},
			// …and that is the ONLY stated end condition, so it survives a long rest
			// (unlike the Granny's Gifts ward, which is re-chosen every long rest).
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getEnchantedFlyingItem", path: "itemName", exact: "Cauldron"},
			{kind: "stateCall", method: "dismissEnchantedFlyingItem", ignoreResult: true},
			{kind: "stateCall", method: "getEnchantedFlyingItem", exact: null},
		]},

	// ── Coven Calling (L18) ──────────────────────────────────────
	{level: 18, name: /coven calling/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			// (a) Reflect ANY spell seen that creature cast in the last minute.
			{kind: "stateCall", method: "recordSeenSpell", args: [{spellName: "Phantasmal Killer", spellLevel: 4, school: "Illusion", casterName: "Green Hag"}], ignoreResult: true},
			{kind: "stateCall", method: "getSeenSpells", args: [{casterName: "Green Hag"}], path: "length", exact: 1},
			// Illusion is the Green Hag specialty → 4th level costs 2, not 4.
			{kind: "stateCall", method: "useCovenCallingReflection", args: [{spellName: "Phantasmal Killer", casterName: "Green Hag", distance: 10}], path: "cost", exact: 2},
			// A spell you never saw cannot be reflected.
			{kind: "stateCall", method: "useCovenCallingReflection", args: [{spellName: "Meteor Swarm", casterName: "Green Hag"}], path: "ok", exact: false},
			// (b) 2 SP → two duplicates, each able to cast one known
			//     instantaneous spell of 3rd level or lower.
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "summonCovenDuplicates", path: "ok", exact: true},
			{kind: "stateCall", method: "getCovenDuplicates", path: "length", exact: 2},
			{kind: "stateCall", method: "castWithCovenDuplicate", args: [{spellName: "Magic Missile", spellLevel: 1, instantaneous: true}], path: "cost", exact: 1},
			{kind: "stateCall", method: "castWithCovenDuplicate", args: [{spellName: "Fireball", spellLevel: 3, instantaneous: true}], path: "cost", exact: 3},
			{kind: "stateCall", method: "castWithCovenDuplicate", args: [{spellName: "Fly", spellLevel: 3, instantaneous: false}], path: "ok", exact: false},
			{kind: "stateCall", method: "castWithCovenDuplicate", args: [{spellName: "Wall of Force", spellLevel: 5, instantaneous: true}], path: "ok", exact: false},
			{kind: "stateCall", method: "dismissCovenDuplicates", exact: true},
			{kind: "stateCall", method: "getCovenDuplicates", path: "length", exact: 0},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
];

/**
 * Wicked Witch Sorcerer Hochling (Arcadia 8 origin on the TGTT chassis) — L1→20.
 *
 * Coverage focus:
 *   - The Hag Ancestor CHOICE is offered and answered by every build flow, and
 *     its answer really grants a language, a skill and a specialty school
 *   - Granny's Gifts always-prepared spells land in the spellbook at every tier,
 *     the long-rest ward registers genuine advantage modifiers, and a granted
 *     spell can be swapped for another of the same level
 *   - Clever Little Witch's specialty-school discount is a real, floored number
 *     that really spends Sorcery Points
 *   - Fly, My Pretty grants fly 60 plus charm/fright immunity while ridden, one
 *     object at a time, until the next long rest
 *   - Coven Calling reflects seen spells at the discounted cost and summons two
 *     duplicates that spend Sorcery Points to cast
 */
describeCharacter({
	preset: PRESET_FULL_WICKED_WITCH_SORCERER,
	displayName: "Wicked Witch Sorcerer Hochling",
	signatureToggle: /fly, my pretty|metamagic|font of magic/i,
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon the
	// USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|crossbow/i,
		skillRoll: {name: "Deception"},
		// Sorcery Points restore on long rest, not short rest.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bane", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectResources: {"Sorcery Points": 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectResources: {"Sorcery Points": 4}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Sorcery Points": 6}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 12}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 18}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 21}},
	},
	featuresMatrix: WICKED_WITCH_FEATURES_MATRIX,
});
