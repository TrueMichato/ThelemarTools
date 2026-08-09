/**
 * Per-pick effect maps for TGTT optional-feature pickers, plus the
 * hand-written XPHB Weapon Mastery effect map.
 *
 * Used by the `build*Checks` helpers in `tgttFeaturePools.ts` to
 * attach `pickedFeatureGrants` sub-effects when the auto-picker's
 * deterministic first choice (alphabetical) lands on the sheet.
 *
 * These maps are NOT auto-generated. Add new entries by hand as new
 * picker options are introduced or as test coverage broadens.
 *
 * ─── Discipline ──────────────────────────────────────────────────────
 * • Map keys MUST exactly match the optional-feature `name` field in
 *   `homebrew/TravelersGuidetoThelemar.json` (or for XPHB, the canonical
 *   weapon name).
 * • Entries with `[]` value mean "the pick exists but its mechanical
 *   effect is too narrative / cinematic / context-dependent to probe
 *   in a generic test" — leave them as empty arrays (or omit) so the
 *   `pickedFeatureGrants` no-ops cleanly.
 * • Auto-picker is alphabetical over remaining options. The
 *   `*_FIRST_PICK` constants in `tgttFeaturePools.ts` reflect the
 *   first-pick name; if the auto-picker algorithm changes, the
 *   first-pick constants AND the matching map keys must be refreshed.
 */

import type {EffectCheck} from "./comprehensiveBuildHelpers";

// ── Specialty effects: keyed by [className][specialtyName] ───────────

export const TGTT_SPECIALTY_EFFECTS: Record<string, Record<string, EffectCheck[]>> = {
	// Alphabetical first picks per class. Most TGTT specialties grant a
	// proficiency, expertise, or passive bump that surfaces on the sheet
	// — but verifying which specialty was chosen is brittle without
	// reading raw state, so we attach `pickActivatable: false`-style
	// existence probes only where the specialty produces an
	// activatable / toggleable feature row. For pure-passive picks the
	// existing `kind: "pick"` count check is sufficient.
	Barbarian: {
		// "Agile Sprinter" → flat speed bonus while not wearing heavy armor.
		"Agile Sprinter": [
			{kind: "speed", min: 30},
		],
	},
	Bard: {
		// "Bewitching Companion" — narrative/social effect; no mechanical probe.
		"Bewitching Companion": [],
	},
	Cleric: {
		// "Ancestral Guidance" → narrative; no mechanical probe.
		"Ancestral Guidance": [],
	},
	Druid: {
		// "Aerial Surveyor" → narrative; no probe.
		"Aerial Surveyor": [],
	},
	Fighter: {
		// "Amphibious Combatant" → swim speed, breathing underwater.
		"Amphibious Combatant": [
			{kind: "speed", type: "swim", min: 1},
		],
	},
	Monk: {
		// "Adept Speed" → +5 ft walking speed.
		"Adept Speed": [
			{kind: "speed", min: 35},
		],
	},
	Paladin: {
		// "Bestowed Understanding" → narrative.
		"Bestowed Understanding": [],
	},
	Ranger: {
		// "Beast Friend" → narrative.
		"Beast Friend": [],
	},
	Rogue: {
		// "Agile Athlete" → Athletics + Acrobatics proficiency hint.
		"Agile Athlete": [],
	},
	Sorcerer: {
		// "Draw Nourishment" → narrative.
		"Draw Nourishment": [],
	},
	Warlock: {
		// "Ascendant Step" → flight at higher level; not yet probed.
		"Ascendant Step": [],
	},
	Wizard: {
		// "Air Lift" → narrative jump-distance buff; no clean probe.
		"Air Lift": [],
	},
};

// ── Battle Tactics ───────────────────────────────────────────────────

export const TGTT_BATTLE_TACTIC_EFFECTS: Record<string, EffectCheck[]> = {
	// First alphabetical: "Back to the Wall".
	"Back to the Wall": [
		{kind: "pickActivatable", matchAny: [/Back to the Wall/i], min: 1},
	],
	"Charging": [
		{kind: "pickActivatable", matchAny: [/Charging/i], min: 1},
	],
	"Covering Attack": [
		{kind: "pickActivatable", matchAny: [/Covering Attack/i], min: 1},
	],
	"Daring Feint": [
		{kind: "pickActivatable", matchAny: [/Daring Feint/i], min: 1},
	],
	"Dying Surge": [
		{kind: "pickActivatable", matchAny: [/Dying Surge/i], min: 1},
	],
	"Eye of the Storm": [
		{kind: "pickActivatable", matchAny: [/Eye of the Storm/i], min: 1},
	],
	"Flanking": [
		{kind: "pickActivatable", matchAny: [/Flanking/i], min: 1},
	],
	"Goading Movement": [
		{kind: "pickActivatable", matchAny: [/Goading Movement/i], min: 1},
	],
	"Hammer and Anvil": [
		{kind: "pickActivatable", matchAny: [/Hammer and Anvil/i], min: 1},
	],
	"High Ground": [
		{kind: "pickActivatable", matchAny: [/High Ground/i], min: 1},
	],
	"Last Ditch Evasion": [
		{kind: "pickActivatable", matchAny: [/Last Ditch Evasion/i], min: 1},
	],
	"Sheathing the Sword": [
		{kind: "pickActivatable", matchAny: [/Sheathing the Sword/i], min: 1},
	],
	"Sweeping Blows": [
		{kind: "pickActivatable", matchAny: [/Sweeping Blows/i], min: 1},
	],
};

// ── Metamagic ────────────────────────────────────────────────────────

const _mmActivatable = (name: string): EffectCheck[] => [
	{kind: "pickActivatable", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
];

export const TGTT_METAMAGIC_EFFECTS: Record<string, EffectCheck[]> = {
	// All TGTT MM options surface as activatable ability rows on the
	// sheet. Damage / saving-throw modifications happen during a cast,
	// which is out of scope for this generic probe.
	"Careful Spell (Passive)": _mmActivatable("Careful Spell"),
	"Distant Spell (Passive)": _mmActivatable("Distant Spell"),
	"Empowered Spell (Passive)": _mmActivatable("Empowered Spell"),
	"Extended Spell (Passive)": _mmActivatable("Extended Spell"),
	"Heightened Spell (Passive)": _mmActivatable("Heightened Spell"),
	"Quickened Spell (Passive)": _mmActivatable("Quickened Spell"),
	"Resonant Spell (Passive)": _mmActivatable("Resonant Spell"),
	"Seeking Spell (Passive)": _mmActivatable("Seeking Spell"),
	"Subtle Spell (Passive)": _mmActivatable("Subtle Spell"),
	"Transmuted Spell (Passive)": _mmActivatable("Transmuted Spell"),
	"Twinned Spell (Passive)": _mmActivatable("Twinned Spell"),
};

// ── Eldritch Invocations ─────────────────────────────────────────────

export const TGTT_ELDRITCH_INVOCATION_EFFECTS: Record<string, EffectCheck[]> = {
	// First alphabetical: "Abomination's Physique".
	"Abomination's Physique": [],
	"Burrower": [
		{kind: "speed", type: "burrow", min: 1, skip: true, skipReason: "burrow speed not surfaced reliably"},
	],
	"Extra Appendages": [],
	"Gravity Defied": [],
	"Leaper": [],
};

// ── Jester Acts (Bard) ───────────────────────────────────────────────
//
// Every act carries a REAL mechanical probe, not an existence assertion.
// `getJesterAct(name)` derives each act's action economy, save ability +
// DC, range, imposed condition, granted spell, AC bonus and Bardic
// Inspiration price from the act's own rules text, so asserting a path
// into it proves the sheet actually understood the act — a prose-only
// "the text renders" implementation fails these.
//
// Expected values below are measured against
// homebrew/TravelersGuidetoThelemar.json; DCs use `min: 8` because the
// act DC is 8 + the character's Performance bonus, which varies with the
// build's CHA / proficiency / Unparalleled Skill expertise.

const _jesterAct = (name: string, mechanics: EffectCheck[]): EffectCheck[] => [
	// Surfacing is asserted WITHOUT clicking Activate: several acts cost a
	// Bardic Inspiration use, and a click-through probe on all thirteen
	// would drain the pool and then fail on the sheet's correct
	// "not enough Bardic Inspiration remaining" gating.
	{kind: "activatableListed", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
	...mechanics,
];

/** Assert one derived property of a single act. */
const _actProp = (name: string, path: string, expect: {exact?: number | string | boolean | null; min?: number}): EffectCheck =>
	({kind: "stateCall", method: "getJesterAct", args: [name], path, ...expect});

export const TGTT_JESTER_ACT_EFFECTS: Record<string, EffectCheck[]> = {
	// Action, 30 ft, Wis save or charmed.
	"Pantomime": _jesterAct("Pantomime", [
		_actProp("Pantomime", "timing", {exact: "action"}),
		_actProp("Pantomime", "saveType", {exact: "wis"}),
		_actProp("Pantomime", "dc", {min: 8}),
		_actProp("Pantomime", "range", {exact: 30}),
		_actProp("Pantomime", "condition", {exact: "charmed"}),
	]),
	// Action, 30 ft, Wis save or dazed (TGTT condition).
	"Prankster": _jesterAct("Prankster", [
		_actProp("Prankster", "timing", {exact: "action"}),
		_actProp("Prankster", "saveType", {exact: "wis"}),
		_actProp("Prankster", "dc", {min: 8}),
		_actProp("Prankster", "condition", {exact: "dazed"}),
	]),
	// Bonus action, no save, no resource.
	"Trickster's Disengagement": _jesterAct("Trickster's Disengagement", [
		_actProp("Trickster's Disengagement", "timing", {exact: "bonus"}),
		_actProp("Trickster's Disengagement", "saveType", {exact: null}),
		_actProp("Trickster's Disengagement", "bardicInspirationCost", {exact: 0}),
	]),
	// Bonus action toggle lasting the rest of the turn.
	"Tumbler": _jesterAct("Tumbler", [
		_actProp("Tumbler", "timing", {exact: "bonus"}),
		_actProp("Tumbler", "isToggle", {exact: true}),
		_actProp("Tumbler", "duration", {exact: "rest of the turn"}),
	]),
	// 1-hour disguise toggle; also registers conditional Deception advantage.
	"Dazzling Disguise": _jesterAct("Dazzling Disguise", [
		_actProp("Dazzling Disguise", "isToggle", {exact: true}),
		_actProp("Dazzling Disguise", "duration", {exact: "1 hour"}),
	]),
	// Bonus action, 30 ft, Wis save.
	"Jester's Juggle": _jesterAct("Jester's Juggle", [
		_actProp("Jester's Juggle", "timing", {exact: "bonus"}),
		_actProp("Jester's Juggle", "saveType", {exact: "wis"}),
		_actProp("Jester's Juggle", "dc", {min: 8}),
		_actProp("Jester's Juggle", "range", {exact: 30}),
	]),
	// Rider phrasing ("when you use your Bardic Inspiration") but the homebrew
	// declares a `consumes` block, which wins: 60 ft, Int save or incapacitated,
	// one Bardic Inspiration.
	"Fool's Folly": _jesterAct("Fool's Folly", [
		_actProp("Fool's Folly", "saveType", {exact: "int"}),
		_actProp("Fool's Folly", "dc", {min: 8}),
		_actProp("Fool's Folly", "range", {exact: 60}),
		_actProp("Fool's Folly", "condition", {exact: "incapacitated"}),
		_actProp("Fool's Folly", "usesBardicInspiration", {exact: true}),
		_actProp("Fool's Folly", "bardicInspirationCost", {exact: 1}),
	]),
	// Rider on the Attack action; explicitly spends one Bardic Inspiration.
	"Laughing Lunge": _jesterAct("Laughing Lunge", [
		_actProp("Laughing Lunge", "timing", {exact: "attack"}),
		_actProp("Laughing Lunge", "bardicInspirationCost", {exact: 1}),
	]),
	// Spends one Bardic Inspiration to cast mirror image.
	"Jester's Jaunt": _jesterAct("Jester's Jaunt", [
		_actProp("Jester's Jaunt", "grantsSpell", {exact: "mirror image"}),
		_actProp("Jester's Jaunt", "bardicInspirationCost", {exact: 1}),
	]),
	// Spends one Bardic Inspiration to cast silent image.
	"Ridiculous Ruse": _jesterAct("Ridiculous Ruse", [
		_actProp("Ridiculous Ruse", "grantsSpell", {exact: "silent image"}),
		_actProp("Ridiculous Ruse", "bardicInspirationCost", {exact: 1}),
	]),
	// Reaction toggle: +PB AC until the start of your next turn, for one
	// Bardic Inspiration. `acBonus` resolves the proficiency scale per build.
	"Jester's Agility": _jesterAct("Jester's Agility", [
		_actProp("Jester's Agility", "timing", {exact: "reaction"}),
		_actProp("Jester's Agility", "isToggle", {exact: true}),
		_actProp("Jester's Agility", "acBonus", {min: 2}),
		_actProp("Jester's Agility", "bardicInspirationCost", {exact: 1}),
	]),
	// Rider on a Bardic Inspiration use: disadvantage on one attack within 60 ft.
	"Witty Wordplay": _jesterAct("Witty Wordplay", [
		_actProp("Witty Wordplay", "range", {exact: 60}),
		_actProp("Witty Wordplay", "usesBardicInspiration", {exact: true}),
		_actProp("Witty Wordplay", "bardicInspirationCost", {exact: 0}),
	]),
	// Bonus action, Wis save.
	"Jester's Jest": _jesterAct("Jester's Jest", [
		_actProp("Jester's Jest", "timing", {exact: "bonus"}),
		_actProp("Jester's Jest", "saveType", {exact: "wis"}),
		_actProp("Jester's Jest", "dc", {min: 8}),
	]),
};

// ── Trickster Tricks (Rogue) ─────────────────────────────────────────

const _tricksterActivatable = (name: string): EffectCheck[] => [
	{kind: "pickActivatable", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
];

export const TGTT_TRICKSTER_TRICK_EFFECTS: Record<string, EffectCheck[]> = {
	"Disarming Strike": _tricksterActivatable("Disarming Strike"),
	"Trip Attack": _tricksterActivatable("Trip Attack"),
	"Swing Away": _tricksterActivatable("Swing Away"),
	"Deafening Strike": _tricksterActivatable("Deafening Strike"),
	"Blinding Strike": _tricksterActivatable("Blinding Strike"),
};

// ── Precise Strike Methods (Monk Debilitation only) ─────────────────

const _preciseActivatable = (name: string): EffectCheck[] => [
	{kind: "pickActivatable", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
];

export const TGTT_PRECISE_STRIKE_EFFECTS: Record<string, EffectCheck[]> = {
	"Arm Snap": _preciseActivatable("Arm Snap"),
	"Air Draining Strike": _preciseActivatable("Air Draining Strike"),
	"Ear Clap": _preciseActivatable("Ear Clap"),
	"Eye Gouge": _preciseActivatable("Eye Gouge"),
	"Finger Smash": _preciseActivatable("Finger Smash"),
};

// ── Pact Boons ───────────────────────────────────────────────────────

export const TGTT_PACT_BOON_EFFECTS: Record<string, EffectCheck[]> = {
	"Pact of Transformation": [
		{kind: "pickToggleable", matchAny: [/Pact of Transformation/i], min: 1, skip: true, skipReason: "transformation toggle row not yet surfaced"},
	],
};

// ── Dreamwalker (Calls / Studies) ────────────────────────────────────

export const TGTT_DREAMWALKER_CUSTOM_EFFECTS: Record<string, EffectCheck[]> = {
	"Dreamwalk": [],
	"Dreamwatch": [],
	"Dreambend": [],
};

export const TGTT_DREAMWALKER_SPECIAL_EFFECTS: Record<string, EffectCheck[]> = {
	"Dreamjump": [],
	"Dreamorph": [],
	"Dreamforge": [],
	"Dreamake": [],
	"Dreamsnatch": [],
};

// ── XPHB Weapon Mastery ──────────────────────────────────────────────
// Keyed on canonical weapon name. The auto-picker for L1 weapon
// mastery picks the first weapon in the build's chosen weapons; the
// helper attaches `attackPresent` (so the weapon row exists) and a
// best-effort `attackDamageContains` for masteries that add a damage
// rider. Mastery-only mechanics (Topple, Push, Vex etc.) cannot be
// fully verified without a target — we settle for the attack row
// being present and clickable.

export const XPHB_WEAPON_MASTERY_EFFECTS: Record<string, EffectCheck[]> = {
	Longsword: [
		{kind: "attackPresent", namePattern: /Longsword/i},
	],
	Shortsword: [
		{kind: "attackPresent", namePattern: /Shortsword/i},
	],
	Rapier: [
		{kind: "attackPresent", namePattern: /Rapier/i},
	],
	Longbow: [
		{kind: "attackPresent", namePattern: /Longbow/i},
	],
	Shortbow: [
		{kind: "attackPresent", namePattern: /Shortbow/i},
	],
	Greatsword: [
		{kind: "attackPresent", namePattern: /Greatsword/i},
	],
	Greataxe: [
		{kind: "attackPresent", namePattern: /Greataxe/i},
	],
	Maul: [
		{kind: "attackPresent", namePattern: /Maul/i},
	],
	Warhammer: [
		{kind: "attackPresent", namePattern: /Warhammer/i},
	],
	Battleaxe: [
		{kind: "attackPresent", namePattern: /Battleaxe/i},
	],
	Handaxe: [
		{kind: "attackPresent", namePattern: /Handaxe/i},
	],
	Mace: [
		{kind: "attackPresent", namePattern: /Mace/i},
	],
	Quarterstaff: [
		{kind: "attackPresent", namePattern: /Quarterstaff/i},
	],
	Spear: [
		{kind: "attackPresent", namePattern: /Spear/i},
	],
	Dagger: [
		{kind: "attackPresent", namePattern: /Dagger/i},
	],
	Javelin: [
		{kind: "attackPresent", namePattern: /Javelin/i},
	],
	Scimitar: [
		{kind: "attackPresent", namePattern: /Scimitar/i},
	],
	Glaive: [
		{kind: "attackPresent", namePattern: /Glaive/i},
	],
	Halberd: [
		{kind: "attackPresent", namePattern: /Halberd/i},
	],
	Pike: [
		{kind: "attackPresent", namePattern: /Pike/i},
	],
	"Light Hammer": [
		{kind: "attackPresent", namePattern: /Light Hammer/i},
	],
	Sickle: [
		{kind: "attackPresent", namePattern: /Sickle/i},
	],
	Club: [
		{kind: "attackPresent", namePattern: /Club/i},
	],
	"Hand Crossbow": [
		{kind: "attackPresent", namePattern: /Hand Crossbow/i},
	],
	"Light Crossbow": [
		{kind: "attackPresent", namePattern: /Light Crossbow/i},
	],
	"Heavy Crossbow": [
		{kind: "attackPresent", namePattern: /Heavy Crossbow/i},
	],
};


// ────────────────────────────────────────────────────────────────────────
// Cross-source effect maps (XPHB / XGE / etc.). Keyed on the canonical
// optional-feature `name`. Entries here are best-effort starters — the
// helper falls through with no effect probe when a pick name is absent,
// so it's safe to add entries incrementally.
// ────────────────────────────────────────────────────────────────────────

/** XPHB Eldritch Invocations. */
export const XPHB_INVOCATION_EFFECTS: Record<string, EffectCheck[]> = {
	"Agonizing Blast": [
		{kind: "attackDamageContains", attackName: /Eldritch Blast/i, contains: /\+/},
	],
	"Devil's Sight": [],
	"Pact of the Blade": [
		{kind: "pickActivatable", matchAny: [/Pact of the Blade/i], min: 1},
	],
	"Repelling Blast": [],
};

/** XPHB Metamagic options (Sorcerer). NOTE: TGTT specs use TGTT_METAMAGIC
 *  exclusively; this map exists only for non-TGTT/vanilla Sorcerer specs.
 *  It is intentionally minimal — extend on demand. */
export const XPHB_METAMAGIC_EFFECTS: Record<string, EffectCheck[]> = {};

/** XGE Arcane Shot options (Arcane Archer Fighter). */
export const XGE_ARCANE_SHOT_EFFECTS: Record<string, EffectCheck[]> = {
	"Banishing Arrow": [
		{kind: "pickActivatable", matchAny: [/Banishing Arrow/i], min: 1},
	],
	"Beguiling Arrow": [
		{kind: "pickActivatable", matchAny: [/Beguiling Arrow/i], min: 1},
	],
	"Bursting Arrow": [
		{kind: "pickActivatable", matchAny: [/Bursting Arrow/i], min: 1},
	],
	"Enfeebling Arrow": [
		{kind: "pickActivatable", matchAny: [/Enfeebling Arrow/i], min: 1},
	],
	"Grasping Arrow": [
		{kind: "pickActivatable", matchAny: [/Grasping Arrow/i], min: 1},
	],
	"Piercing Arrow": [
		{kind: "pickActivatable", matchAny: [/Piercing Arrow/i], min: 1},
	],
	"Seeking Arrow": [
		{kind: "pickActivatable", matchAny: [/Seeking Arrow/i], min: 1},
	],
	"Shadow Arrow": [
		{kind: "pickActivatable", matchAny: [/Shadow Arrow/i], min: 1},
	],
};

/** XPHB Battle Master Maneuvers. */
const _maneuverActivatable = (name: string): EffectCheck[] => [
	{kind: "pickActivatable", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
];

export const XPHB_MANEUVER_EFFECTS: Record<string, EffectCheck[]> = {
	"Ambush": _maneuverActivatable("Ambush"),
	"Bait and Switch": _maneuverActivatable("Bait and Switch"),
	"Commander's Strike": _maneuverActivatable("Commander's Strike"),
	"Commanding Presence": _maneuverActivatable("Commanding Presence"),
	"Disarming Attack": _maneuverActivatable("Disarming Attack"),
	"Distracting Strike": _maneuverActivatable("Distracting Strike"),
	"Evasive Footwork": _maneuverActivatable("Evasive Footwork"),
	"Feinting Attack": _maneuverActivatable("Feinting Attack"),
	"Goading Attack": _maneuverActivatable("Goading Attack"),
	"Lunging Attack": _maneuverActivatable("Lunging Attack"),
	"Maneuvering Attack": _maneuverActivatable("Maneuvering Attack"),
	"Menacing Attack": _maneuverActivatable("Menacing Attack"),
	"Parry": _maneuverActivatable("Parry"),
	"Precision Attack": _maneuverActivatable("Precision Attack"),
	"Pushing Attack": _maneuverActivatable("Pushing Attack"),
	"Rally": _maneuverActivatable("Rally"),
	"Riposte": _maneuverActivatable("Riposte"),
	"Sweeping Attack": _maneuverActivatable("Sweeping Attack"),
	"Tactical Assessment": _maneuverActivatable("Tactical Assessment"),
	"Trip Attack": _maneuverActivatable("Trip Attack"),
};

/** XPHB Pact Boons. */
export const XPHB_PACT_BOON_EFFECTS: Record<string, EffectCheck[]> = {
	"Pact of the Blade": [
		{kind: "pickActivatable", matchAny: [/Pact of the Blade/i], min: 1},
	],
	"Pact of the Chain": [
		{kind: "pickActivatable", matchAny: [/Pact of the Chain|Find Familiar/i], min: 1},
	],
	"Pact of the Tome": [
		{kind: "pickActivatable", matchAny: [/Pact of the Tome|Book of Shadows/i], min: 1},
	],
};

/** Zodiac Druid forms (TGTT). These are individual subclassFeature
 *  entries (not picker options) — every form surfaces on the sheet for
 *  any Zodiac druid at the appropriate level. Most form effects are
 *  conditional on form activation (entered via Wild Shape) and don't
 *  manifest as passive stat changes; we attach effect probes only for
 *  representatives whose existence-as-a-feature is itself the meaningful
 *  signal. Forms without concrete sheet-visible effects use empty arrays
 *  to declare them existence-only intentionally (no warning from audit). */
export const ZODIAC_FORM_EFFECTS: Record<string, EffectCheck[]> = {
	// L3 (Month) — 12 constellation forms.
	"Beaver": [],          // damage-reduction reaction (conditional)
	"Aurochs": [],         // STR check advantage (conditional)
	"Horse": [],           // doubled walk speed (conditional)
	"Octopus": [],         // swim speed + reach (conditional, needs water)
	"Peacock": [],         // attacker WIS save (conditional)
	// Existence-only, like all 11 sibling constellations. Roc reads "You
	// can use your action to cast gust of wind or warding wind without
	// expending a spell slot" — a free-CAST grant, not an activatable
	// state, so the sheet correctly reports activatable: false. The
	// `pickActivatable` probe that used to live here was unsatisfiable
	// for the SAME reason its unanchored `/Roc/i` made Aurochs
	// unsatisfiable (CS-BUG-107): none of the 12 Zodiac forms is a
	// toggle. Anchoring the pattern only moved the failure from Aurochs
	// onto Roc itself — measured, not assumed.
	//
	// A stronger probe than `[]` would assert the two granted spells are
	// castable without a slot; there is no EffectCheck kind for
	// free-cast riders today, so this stays existence-only deliberately
	// rather than by omission.
	"Roc": [],
	"Bee": [],             // ranged spell attack (conditional)
	"Hound": [],           // mark target (conditional)
	"Cat": [],             // perception bonus (conditional)
	"Griffon": [],         // frighten saves advantage (conditional)
	"Bulette": [],         // AC + burrow (conditional on form active)
	"Phoenix": [],         // unconscious-recovery (conditional)
	// L10 (Star Week) — 12 constellation forms.
	"Sequoia": [],         // temp HP (conditional on form active)
	"Unicorn": [
		{kind: "pickActivatable", matchAny: [/Unicorn/i], min: 1, skip: true, skipReason: "CS-BUG-017"},
	],
	"Raven": [],           // initiative advantage (conditional)
	"Kitsune": [],         // teleport reaction (conditional)
	"Hillstep Turtle": [], // CON save advantage (conditional)
	"Owlbear": [],         // bonus force damage (conditional)
	"Almiraj": [],         // d4 reroll (conditional)
	"Bat": [],             // blindsight (conditional)
	"Pseudodragon": [],    // mental-stat floor (conditional)
	"Aurumvorax": [],      // temp HP + persuasion advantage (conditional)
	"Salmon": [],          // difficult-terrain ignore (conditional)
	"Lizard": [],          // healing aura (conditional)
};

/** Debilitation Monk Precise Strike Methods are `PS` optional features —
 *  use TGTT_PRECISE_STRIKE_EFFECTS / buildPreciseStrikeChecks for them. */
