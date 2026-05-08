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

const _jesterActivatable = (name: string): EffectCheck[] => [
	{kind: "pickActivatable", matchAny: [new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")], min: 1},
];

export const TGTT_JESTER_ACT_EFFECTS: Record<string, EffectCheck[]> = {
	"Pantomime": _jesterActivatable("Pantomime"),
	"Prankster": _jesterActivatable("Prankster"),
	"Trickster's Disengagement": _jesterActivatable("Trickster's Disengagement"),
	"Tumbler": _jesterActivatable("Tumbler"),
	"Dazzling Disguise": _jesterActivatable("Dazzling Disguise"),
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
export const XPHB_MANEUVER_EFFECTS: Record<string, EffectCheck[]> = {};

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
	"Roc": [
		{kind: "pickActivatable", matchAny: [/Roc/i], min: 1},
	],
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
