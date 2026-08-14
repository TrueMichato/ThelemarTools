import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHAMPION_FIGHTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	buildSpecialtyChecks,
	buildWeaponMasteryChecks,
} from "../utils/tgttFeaturePools";

const CHAMPION_FEATURES_MATRIX: FeatureCheck[] = [
	...buildWeaponMasteryChecks(["Club", "Dagger", "Dart"], 1),
	// L1 Fighting Style — the preset's `preferredFeatProgressionPattern`
	// (see PRESET_FULL_CHAMPION_FIGHTER in characterBuilder.ts) forces the
	// auto-picker to deterministically choose "Archery" here (a homebrew
	// source can otherwise inject an alphabetically-earlier FS-category
	// feat, making plain first-choice-free selection unreliable). Its
	// effect (an unconditional +2 to ranged attack rolls) is a stable,
	// generic probe via getModifierBonus("attack:ranged") — no equipped
	// ranged weapon required on the sheet.
	{
		level: 1,
		name: /fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [
			/archery/i, /blind fighting/i, /defense/i, /dueling/i,
			/great weapon fighting/i, /interception/i, /protection/i,
			/thrown weapon fighting/i, /two-weapon fighting/i, /unarmed fighting/i,
		],
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /archery/i,
			subEffects: [{kind: "modifierBonus", modType: "attack:ranged", min: 2}],
		}],
	},
	{
		level: 1,
		name: /second wind/i,
		kind: "resource",
		resourceMax: [1, 6],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Second Wind"}],
	},
	{
		level: 2,
		name: /action surge/i,
		kind: "resource",
		// 1 use through L16; the base Fighter class (not Champion-specific)
		// grants a 2nd use at L17 ("Action Surge (two uses)") — range keeps
		// this check valid across the whole L2→L20 MEGA sweep.
		resourceMax: [1, 2],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Action Surge"}],
	},
	// L3 Champion — Improved Critical (weapon/Unarmed Strike crit on 19-20;
	// spell attacks are NOT affected — see CharacterSheetFighter.test.js for
	// the isolated unit coverage of that scoping rule). Uses `max` (not
	// `exact`) since L15 Superior Critical later improves the range to
	// 18-20 — this check must keep passing once re-asserted at L17/L20.
	{
		level: 3,
		name: /improved critical/i,
		kind: "passive",
		effects: [{kind: "criticalRange", max: 19}],
	},
	// L3 Remarkable Athlete — advantage on Initiative + Athletics checks.
	// The "move up to half Speed without opportunity attacks after a
	// weapon/Unarmed crit" affordance is a post-attack UI hook (see
	// _getPostAttackHooks in charactersheet-combat.js) rather than a
	// standing numeric bonus, so it isn't independently probed here; the
	// advantage grants are the measurable, declarative mechanic.
	{
		level: 3,
		name: /remarkable athlete/i,
		kind: "passive",
		effects: [
			{kind: "advantage", rollType: "initiative"},
			{kind: "skillAdvantage", skill: "athletics"},
		],
	},
	...buildSpecialtyChecks("Fighter"),
	{level: 5, name: /extra attack/i, kind: "passive"},
	// L7 Additional Fighting Style — a second XPHB Fighting Style pick.
	// The preset's `preferredFeatProgressionPattern` also matches "Blind
	// Fighting" as its 2nd priority (Archery is already known and excluded
	// by the picker at this point), confirming the pick is genuinely a
	// NEW, distinct style rather than a re-surfaced L1 pick.
	{
		level: 7,
		name: /additional fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [
			/blind fighting/i, /defense/i, /dueling/i,
			/great weapon fighting/i, /interception/i, /protection/i,
			/thrown weapon fighting/i, /two-weapon fighting/i, /unarmed fighting/i,
		],
	},
	{
		level: 9,
		name: /indomitable/i,
		kind: "resource",
		// 1 use through L12; base Fighter grants a 2nd use at L13 and a 3rd
		// at L17 — range keeps this check valid across the full MEGA sweep.
		resourceMax: [1, 3],
		restoreOn: "long",
		effects: [{kind: "longRestRestores", resource: "Indomitable"}],
	},
	// L10 Heroic Warrior — grants Heroic Inspiration at the start of a
	// combat turn if the character doesn't already have it. Driven directly
	// through the generic turn-start resolver (applyTurnStartEffects()).
	{
		level: 10,
		name: /heroic warrior/i,
		kind: "passive",
		effects: [{kind: "turnStartGrantsInspiration"}],
	},
	// L15 Superior Critical — same pipeline as Improved Critical, 18-20.
	{
		level: 15,
		name: /superior critical/i,
		kind: "passive",
		effects: [{kind: "criticalRange", exact: 18}],
	},
	// L18 Survivor — Defy Death (advantage on death saves; natural-20
	// benefit on an 18-20 death-save roll is unit-tested in
	// CharacterSheetFighter.test.js) + Heroic Rally (5 + CON mod healing at
	// the start of a turn while Bloodied and above 0 HP).
	{
		level: 18,
		name: /survivor/i,
		kind: "passive",
		effects: [
			{kind: "advantage", rollType: "deathSave"},
			{kind: "turnStartHeals", min: 5, setHpFraction: 0.4},
		],
	},
];

/**
 * XPHB Champion Fighter — L1→20.
 *
 * Coverage focus:
 *   - L1 Fighting Style pick + its Archery ranged-attack-bonus effect
 *   - L3 Improved Critical (19-20) and Remarkable Athlete (advantage:
 *     Initiative + Athletics)
 *   - L7 Additional Fighting Style (a genuinely new, second style pick)
 *   - L10 Heroic Warrior (turn-start Inspiration grant) and L15 Superior
 *     Critical (18-20)
 *   - L18 Survivor: Defy Death (advantage on death saves) + Heroic Rally
 *     (turn-start Bloodied healing)
 *   - Weapon Mastery + Specialty picks shared with the Battle Master sibling
 */
describeCharacter({
	preset: PRESET_FULL_CHAMPION_FIGHTER,
	displayName: "Champion Fighter Aarakocra",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a
		// weapon the USE attack probe can actually roll.
		{name: "Longsword", equipped: true},
	],
	// Action Surge and Second Wind are instant abilities, not stances:
	// `detectActivatableFeature` classifies both as `isInstant: true`, and R21
	// deliberately routes instant/limited-use abilities to the Features tab's
	// Use button while EXCLUDING them from the Overview "Available to Activate"
	// strip (`isActivatableAbilityEntry` → filtered). `signatureToggle` reads
	// only that strip, so no pattern naming them can ever match here. Both are
	// asserted as resources in the matrix (:37, :45) and as Features-tab
	// activatables via the milestone `expectToggles`, which reads the other surface.
	signatureToggleSkip: {skip: true, reason: "Action Surge and Second Wind are instant abilities (isInstant: true), which R21 routes to the Features tab and excludes from the Overview activatable strip this probe reads; both are covered as resources in featuresMatrix and by milestone expectToggles"},
	usage: {
		useResourceName: "Second Wind",
		attackName: /longsword|greatsword|warhammer|battleaxe|mace|scimitar|rapier|shortsword/i,
		skillRoll: {name: "Athletics"},
		// Second Wind's pool max can vary with TGTT homebrew scaling, so
		// rely on the generic "restores to max" assertion (Action Surge,
		// which is a flat 1-use pool) rather than guessing an exact value.
		shortRestRestores: {resourceName: "Action Surge"},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectToggles: [/second wind/i]},
		3: {totalLevel: 3, minMaxHp: 25, expectResources: {"Second Wind": 1}},
		5: {totalLevel: 5, minMaxHp: 39, expectResources: {"Second Wind": 1}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Second Wind": 1}},
		17: {totalLevel: 17, minMaxHp: 120, expectResources: {"Second Wind": 1}},
		20: {totalLevel: 20, minMaxHp: 140, expectResources: {"Second Wind": 1}},
	},
	featuresMatrix: CHAMPION_FEATURES_MATRIX,
});
