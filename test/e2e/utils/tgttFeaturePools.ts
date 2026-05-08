/**
 * TGTT Feature Pools — Auto-generated. Do not edit by hand.
 *
 * Source:        homebrew/TravelersGuidetoThelemar.json (sha256:02af5c93b783)
 * Generator:     scripts/genTgttPools.mjs
 * Regenerate:    node scripts/genTgttPools.mjs
 *
 * Pools below are consumed by the comprehensive E2E character build
 * tests in test/e2e/specs/tgtt-*.spec.ts via the build*Checks helpers
 * at the bottom of this file.
 *
 * The per-pick effect maps (TGTT_SPECIALTY_EFFECTS,
 * TGTT_METAMAGIC_EFFECTS, etc.) and the hand-written XPHB pools live
 * in tgttFeatureEffects.ts — that file is NOT auto-generated.
 */

import type {EffectCheck, FeatureCheck} from "./comprehensiveBuildHelpers";
import {
	TGTT_BATTLE_TACTIC_EFFECTS,
	TGTT_DREAMWALKER_CUSTOM_EFFECTS,
	TGTT_DREAMWALKER_SPECIAL_EFFECTS,
	TGTT_ELDRITCH_INVOCATION_EFFECTS,
	TGTT_JESTER_ACT_EFFECTS,
	TGTT_METAMAGIC_EFFECTS,
	TGTT_PACT_BOON_EFFECTS,
	TGTT_PAINFUL_STRIKE_EFFECTS,
	TGTT_SPECIALTY_EFFECTS,
	TGTT_TRICKSTER_TRICK_EFFECTS,
	XPHB_WEAPON_MASTERY_EFFECTS,
	XPHB_INVOCATION_EFFECTS,
	XPHB_METAMAGIC_EFFECTS,
	XGE_ARCANE_SHOT_EFFECTS,
	XPHB_MANEUVER_EFFECTS,
	XPHB_PACT_BOON_EFFECTS,
	ZODIAC_FORM_EFFECTS,
	DEBILITATION_PRECISE_STRIKE_EFFECTS,
} from "./tgttFeatureEffects";

// ── Specialties (Class-feature "Specialties" pick-list at progression levels) ──
export const TGTT_SPECIALTIES: Record<string, RegExp[]> = {
	Barbarian: [
		/^Agile Sprinter$/i,
		/^Flock Step$/i,
		/^Lead the Pack$/i,
		/^Mark of the Wilderness$/i,
		/^Natural Tracker$/i,
		/^Path of Blustery Autumns$/i,
		/^Path of Drowning Springs$/i,
		/^Path of Lean Winters$/i,
		/^Path of Scorching Summers$/i,
		/^Sharpened Senses$/i,
	],
	Bard: [
		/^Bewitching Companion$/i,
		/^Brutish Confrontation$/i,
		/^Improvised Engineering$/i,
		/^Marching Song$/i,
		/^Profitable$/i,
		/^Resonance$/i,
		/^Showoff$/i,
		/^Sly Confidant$/i,
		/^Song of Rest$/i,
		/^Townie$/i,
		/^Widely Known$/i,
	],
	Cleric: [
		/^Ancestral Guidance$/i,
		/^Compassionate Nurse$/i,
		/^Faithful Historian$/i,
		/^Gentle Healer$/i,
		/^Graceful Fall$/i,
		/^Monastic Austerity$/i,
		/^Numinous Awareness$/i,
		/^Premonition$/i,
		/^Preservation$/i,
		/^Righteous Path$/i,
		/^Soothing Words$/i,
		/^Supernal Intuition$/i,
		/^Theologian$/i,
		/^Voice of Doom$/i,
	],
	Druid: [
		/^Aerial Surveyor$/i,
		/^Aquatic Delver$/i,
		/^Cavern Skulker$/i,
		/^Desert Dweller$/i,
		/^Eldritch Survivor$/i,
		/^Herbal Apothecary$/i,
		/^Marshland Guide$/i,
		/^Master Forager$/i,
		/^Mountain Climber$/i,
		/^Tundra Explorer$/i,
	],
	Fighter: [
		/^Amphibious Combatant$/i,
		/^Battle Hardened$/i,
		/^Burst of Strength$/i,
		/^Campaigner$/i,
		/^Clearsight Sentinel$/i,
		/^Combat Medic$/i,
		/^Extreme Leap$/i,
		/^Fight Club$/i,
		/^Mountaineer$/i,
		/^Nightwatch$/i,
		/^Shield Specialist$/i,
		/^Stable Footing$/i,
		/^Stamina Enthusiast$/i,
		/^Stronghold Builder$/i,
		/^Sweeping Attacker$/i,
		/^Weather Beaten$/i,
	],
	Monk: [
		/^Adept Speed$/i,
		/^Agile Acrobat$/i,
		/^Focus Speech$/i,
		/^Gale Walk$/i,
		/^Hurricane Walk$/i,
		/^Instant Step$/i,
		/^Marathon Runner$/i,
		/^Nimble Athlete$/i,
		/^Perfect Flow$/i,
		/^Power Tumble$/i,
		/^Religious Training$/i,
		/^Shadow Walk$/i,
		/^Sixth Sense$/i,
		/^Wall Walk$/i,
		/^Warrior's Awareness$/i,
		/^Water Walk$/i,
		/^Wilderness Training$/i,
	],
	Paladin: [
		/^Bestowed Understanding$/i,
		/^Divine Health$/i,
		/^Divine Vision$/i,
		/^Do Without$/i,
		/^Exemplary$/i,
		/^Glorious Purpose$/i,
		/^Heraldic Order$/i,
		/^Holy Avenger$/i,
		/^Miraculous Discovery$/i,
		/^Naturalist$/i,
		/^Pious Soul$/i,
		/^Prophetic Protection$/i,
		/^Sacred Protection$/i,
		/^Seek Truths$/i,
		/^Sense Import$/i,
		/^Silvered Tongue$/i,
		/^Supreme Healing$/i,
		/^Undaunted$/i,
	],
	Ranger: [
		/^Beast Friend$/i,
		/^Build Shelter$/i,
		/^Calls of the Wild$/i,
		/^Ear to the Ground$/i,
		/^Expert Foraging$/i,
		/^Forced Marcher$/i,
		/^Guide$/i,
		/^Healing Salves$/i,
		/^Herbal Bitters$/i,
		/^Huntsman$/i,
		/^Longwalker$/i,
		/^Master Tracker$/i,
		/^Monster Mimic$/i,
		/^Poisons and Antidotes$/i,
		/^Read the Room$/i,
		/^Relentless Pursuit$/i,
		/^See the Unseen$/i,
		/^Swift Tracker$/i,
		/^Uncanny Tracker$/i,
	],
	Rogue: [
		/^Agile Athlete$/i,
		/^Analysis$/i,
		/^Boobytrapper$/i,
		/^Cat's Eyes$/i,
		/^Delay Trap$/i,
		/^Expertise Training$/i,
		/^Extra Skill Training$/i,
		/^Graceful Leap$/i,
		/^Hide in the Shadows$/i,
		/^Keen Eye$/i,
		/^Kip Up$/i,
		/^Locksmith$/i,
		/^Loot Runner$/i,
		/^Observer$/i,
		/^Poison Expert$/i,
		/^Practiced Dash$/i,
		/^Quick Scan$/i,
		/^Scout Leader$/i,
		/^Sense Aura$/i,
		/^Sense for Secrets$/i,
		/^Shadow Skulk$/i,
		/^Skeleton Key$/i,
		/^Tuck and Roll$/i,
		/^Unstable Poison$/i,
	],
	Sorcerer: [
		/^Draw Nourishment$/i,
		/^Hot Air$/i,
		/^Lingering Touch$/i,
		/^Mage Hunter$/i,
		/^Magnetic Step$/i,
		/^Ominous Insight$/i,
		/^Retrace$/i,
		/^Strange Traces$/i,
		/^Wode Sense$/i,
	],
	Warlock: [
		/^Ascendant Step$/i,
		/^Beast Speech$/i,
		/^Book of Ancient Secrets$/i,
		/^Devil's Sight$/i,
		/^Eldritch Sight$/i,
		/^Inscrutability$/i,
		/^Master of Myriad Forms$/i,
		/^Mirror, Mirror$/i,
		/^One with Shadows$/i,
		/^Otherworldly Leap$/i,
		/^Portents and Portals$/i,
		/^Shadowveil$/i,
		/^Visions of Distant Realms$/i,
		/^Whiff of the Beyond$/i,
	],
	Wizard: [
		/^Air Lift$/i,
		/^Detect Magic Savant$/i,
		/^Eidetic Memory$/i,
		/^Illusion Detective$/i,
		/^Loremaster of Creatures$/i,
		/^Loremaster of Travel$/i,
		/^Persistent Mending$/i,
		/^Presto, Prestidigitation$/i,
	],
};

// Levels at which each TGTT class gains a Specialty pick (cumulative).
export const TGTT_SPECIALTY_LEVELS: Record<string, number[]> = {
	Barbarian: [1, 3, 6, 8, 10, 13, 15, 18, 20],
	Bard: [2, 6, 9, 13, 16, 20],
	Cleric: [3, 7, 11, 15, 20],
	Druid: [1, 5, 9, 13, 17],
	Fighter: [1, 5, 9, 13, 17],
	Monk: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
	Paladin: [3, 5, 7, 9, 11, 14, 19],
	Ranger: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
	Rogue: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
	Sorcerer: [4, 8, 12, 16, 20],
	Warlock: [2, 8, 14],
	Wizard: [4, 8, 12, 16, 20],
};

// Auto-picker's deterministic first choice (alphabetical) per class.
// Used as the key into TGTT_SPECIALTY_EFFECTS.
export const TGTT_SPECIALTY_FIRST_PICK: Record<string, string> = {
	Barbarian: "Agile Sprinter",
	Bard: "Bewitching Companion",
	Cleric: "Ancestral Guidance",
	Druid: "Aerial Surveyor",
	Fighter: "Amphibious Combatant",
	Monk: "Adept Speed",
	Paladin: "Bestowed Understanding",
	Ranger: "Beast Friend",
	Rogue: "Agile Athlete",
	Sorcerer: "Draw Nourishment",
	Warlock: "Ascendant Step",
	Wizard: "Air Lift",
};

// ── Battle Tactics (BT) ──
// featureType BT — Fighter Battle Tactics options.
export const TGTT_BATTLE_TACTICS: RegExp[] = [
	/^Back to the Wall$/i,
	/^Charging$/i,
	/^Covering Attack$/i,
	/^Daring Feint$/i,
	/^Dying Surge$/i,
	/^Eye of the Storm$/i,
	/^Flanking$/i,
	/^Goading Movement$/i,
	/^Hammer and Anvil$/i,
	/^High Ground$/i,
	/^Last Ditch Evasion$/i,
	/^Sheathing the Sword$/i,
	/^Sweeping Blows$/i,
];
export const TGTT_BATTLE_TACTICS_FIRST_PICK: string = "Back to the Wall";
// Cumulative Battle Tactics picks at each Fighter level.
export const TGTT_BATTLE_TACTICS_CUM: Record<number, number> = {3:2,7:3,10:4,15:5};

// ── Metamagic (MM) ──
// featureType MM — Sorcerer Metamagic options.
export const TGTT_METAMAGIC: RegExp[] = [
	/^Aimed Spell \(Active\)$/i,
	/^Bestowed Spell \(Active\)$/i,
	/^Bouncing Spell \(Active\)$/i,
	/^Careful Spell \(Passive\)$/i,
	/^Distant Spell \(Passive\)$/i,
	/^Empowered Spell \(Passive\)$/i,
	/^Extended Spell \(Passive\)$/i,
	/^Focused Spell \(Active\)$/i,
	/^Heightened Spell \(Active\)$/i,
	/^Lingering Spell \(Active\)$/i,
	/^Overcharged Spell \(Active\)$/i,
	/^Quickened Spell \(Active\)$/i,
	/^Resonant Spell \(Passive\)$/i,
	/^Seeking Spell \(Active\)$/i,
	/^Split Spell \(Passive\)$/i,
	/^Subtle Spell \(Active\)$/i,
	/^Supple Spell \(Passive\)$/i,
	/^Transmuted Spell \(Passive\)$/i,
	/^Twinned Spell \(Active\)$/i,
	/^Vampiric Spell \(Active\)$/i,
	/^Warding Spell \(Passive\)$/i,
];
export const TGTT_METAMAGIC_FIRST_PICK: string = "Aimed Spell (Active)";

// ── Eldritch Invocations (EI) ──
// featureType EI — TGTT-flavoured Warlock Invocations.
export const TGTT_ELDRITCH_INVOCATIONS: RegExp[] = [
	/^Abomination's Physique$/i,
	/^Burrower$/i,
	/^Extra Appendages$/i,
	/^Gravity Defied$/i,
	/^Leaper$/i,
	/^Spiked Carapace$/i,
];
export const TGTT_ELDRITCH_INVOCATIONS_FIRST_PICK: string = "Abomination's Physique";

// ── Jester Acts (JA) ──
// featureType JA — Jester Bard subclass acts.
export const TGTT_JESTER_ACTS: RegExp[] = [
	/^Dazzling Disguise$/i,
	/^Fool's Folly$/i,
	/^Jester's Agility$/i,
	/^Jester's Jaunt$/i,
	/^Jester's Jest$/i,
	/^Jester's Juggle$/i,
	/^Laughing Lunge$/i,
	/^Pantomime$/i,
	/^Prankster$/i,
	/^Ridiculous Ruse$/i,
	/^Trickster's Disengagement$/i,
	/^Tumbler$/i,
	/^Witty Wordplay$/i,
];
export const TGTT_JESTER_ACTS_FIRST_PICK: string = "Dazzling Disguise";

// ── Trickster Tricks (TT) ──
// featureType TT — Trickster Rogue subclass tricks.
export const TGTT_TRICKSTER_TRICKS: RegExp[] = [
	/^Blinding Strike$/i,
	/^Deafening Strike$/i,
	/^Disarming Strike$/i,
	/^Explosive Flask$/i,
	/^Instant Barrier$/i,
	/^Noise Maker$/i,
	/^Rapid Deployment$/i,
	/^Rebounding Throw$/i,
	/^Swing Away$/i,
	/^Trip Attack$/i,
	/^Weaponized Debris$/i,
];
export const TGTT_TRICKSTER_TRICKS_FIRST_PICK: string = "Blinding Strike";

// ── Painful Strikes (PS) ──
// featureType PS — Painful / pugilistic strikes pool.
export const TGTT_PAINFUL_STRIKES: RegExp[] = [
	/^Air Draining Strike$/i,
	/^Arm Snap$/i,
	/^Ear Clap$/i,
	/^Eye Gouge$/i,
	/^Finger Smash$/i,
	/^Heart Bursting Punch$/i,
	/^Leg Sweeping Kick$/i,
	/^Low Blow$/i,
	/^Neck Chop$/i,
	/^Pierce Defenses$/i,
	/^Temple Strike$/i,
];
export const TGTT_PAINFUL_STRIKES_FIRST_PICK: string = "Air Draining Strike";

// ── Pact Boons (PB) ──
// featureType PB — TGTT Warlock Pact Boon variants.
export const TGTT_PACT_BOONS: RegExp[] = [
	/^Pact of Transformation$/i,
];
export const TGTT_PACT_BOONS_FIRST_PICK: string = "Pact of Transformation";

// ── Dreamwalker Customs (DW:C) ──
// featureType DW:C — Dreamwalker calls / customs.
export const TGTT_DREAMWALKER_CUSTOMS: RegExp[] = [
	/^Dreambend$/i,
	/^Dreamwalk$/i,
	/^Dreamwatch$/i,
];
export const TGTT_DREAMWALKER_CUSTOMS_FIRST_PICK: string = "Dreambend";

// ── Dreamwalker Specials (DW:S) ──
// featureType DW:S — Dreamwalker studies / specials.
export const TGTT_DREAMWALKER_SPECIALS: RegExp[] = [
	/^Daydream$/i,
	/^Dreamake$/i,
	/^Dreamforge$/i,
	/^Dreamjump$/i,
	/^Dreamorph$/i,
	/^Dreamshare$/i,
	/^Dreamsnatch$/i,
	/^Dreamveil$/i,
];
export const TGTT_DREAMWALKER_SPECIALS_FIRST_PICK: string = "Daydream";
// ── Combat Methods grouped by tradition (TGTT) ──
// Each combat tradition has its own pool of methods of varying degrees;
// the Fighter / Pugilist / etc. Combat Methods feature picks from the
// pool of every tradition the character knows.
export const TGTT_COMBAT_METHODS_BY_TRADITION: Record<string, RegExp[]> = {
	"Ace Starfighter": [
		/^A Game of Chicken$/i,
		/^Ace Maneuvering$/i,
		/^Barrel Roll$/i,
		/^Bombing Formation$/i,
		/^Dive Bomb$/i,
		/^Escort Formation$/i,
		/^Hit the Brakes$/i,
		/^Interceptor Formation$/i,
		/^Lock On$/i,
		/^Lose Them$/i,
		/^Pull Up$/i,
		/^Quantum Slip$/i,
		/^Scouting Formation$/i,
		/^Shake Them Off$/i,
		/^Stealth Formation$/i,
		/^Targeted Fire$/i,
		/^Trench Run$/i,
		/^Trust Your Instincts$/i,
	],
	"Adamant Mountain": [
		/^Battering Strike$/i,
		/^Catch Your Breath$/i,
		/^Cleaving Swing$/i,
		/^Crushing Blow$/i,
		/^Heavy Stance$/i,
		/^Lean Into It$/i,
		/^Reactive Knockdown$/i,
		/^Shrug It Off$/i,
		/^Stand Tall Stance$/i,
		/^Unbreakable$/i,
		/^Unstoppable$/i,
		/^Unyielding$/i,
		/^Warding Wield$/i,
		/^Wild Swing$/i,
		/^World-Shaking Strike$/i,
	],
	"Arcane Knight": [
		/^Arcane Dismissal$/i,
		/^Argent Strike$/i,
		/^Blazing Pursuit$/i,
		/^Dimensional Strike$/i,
		/^Duelist's Sigil$/i,
		/^Flame Burst$/i,
		/^Frigid Strike$/i,
		/^Grasp of the Storm$/i,
		/^Grasping Gauntlet$/i,
		/^Groundshatter$/i,
		/^Malicious Mark$/i,
		/^Mystic Feint$/i,
		/^Quickening$/i,
		/^Reactive Ward$/i,
		/^Stormrider$/i,
		/^Warding Flourish$/i,
	],
	"Beast Unity": [
		/^Attack in Tandem$/i,
		/^Bounding Charge$/i,
		/^Bring the Mighty Low$/i,
		/^Coordinated Trip$/i,
		/^Fetch!$/i,
		/^Fortifying Reassurance$/i,
		/^Get Back!$/i,
		/^Goading Stance$/i,
		/^Heroic Substitution$/i,
		/^Howl of Challenge$/i,
		/^Quick Switch$/i,
		/^Strike from Below$/i,
		/^Vigilant Stance$/i,
		/^Warning Cry$/i,
		/^Wild Strikes$/i,
	],
	"Biting Zephyr": [
		/^Blindshot$/i,
		/^Countershot$/i,
		/^Covering Fire$/i,
		/^Dive For Cover$/i,
		/^Doubleshot$/i,
		/^Farshot Stance$/i,
		/^Hear the Wind$/i,
		/^Heartseeker$/i,
		/^Horizon Shot$/i,
		/^Missile Volley$/i,
		/^Mundane Missile Stance$/i,
		/^Point Blank Shot$/i,
		/^Quickdraw$/i,
		/^Ricochet$/i,
		/^Trickshot$/i,
	],
	"BM": [
		/^Disarm$/i,
		/^Grab On$/i,
		/^Grapple$/i,
		/^Knockdown$/i,
		/^Overrun$/i,
		/^Shove$/i,
	],
	"BMD": [
		/^Blinding Diversion$/i,
		/^Block$/i,
		/^Center$/i,
		/^Deflect$/i,
		/^Gain the High Ground$/i,
		/^Goad$/i,
		/^Knee Strike$/i,
		/^Low Blow$/i,
		/^Reposition$/i,
		/^Taunt$/i,
	],
	"BSG": [
		/^Blinding Light$/i,
		/^Deflect Missile$/i,
		/^Earthstrike$/i,
		/^Guided Throw$/i,
		/^I Have The High Ground$/i,
		/^Imbued Strike$/i,
		/^Pass-Through$/i,
		/^Psychic Sunder$/i,
		/^Reactive Re-arm$/i,
		/^Reeling Strike$/i,
		/^Sever Limb$/i,
		/^Shielded Stance$/i,
		/^Total Dismemberment$/i,
		/^Trusting Stance$/i,
		/^Unstoppable Attack$/i,
	],
	"Comedic Jabs": [
		/^Don't Hit Me$/i,
		/^Instant Allyship$/i,
		/^Jovial Stance$/i,
		/^Just A Giggle$/i,
		/^Make Them Laugh$/i,
		/^Old Pal$/i,
		/^Partner Fall$/i,
		/^Pie To The Face$/i,
		/^Pratfall Pull$/i,
		/^Quick Spill$/i,
		/^Quick, Drink This$/i,
		/^Really Very Funny$/i,
		/^Rolling With The Punches$/i,
		/^Splash of Humor$/i,
		/^This is Yours$/i,
	],
	"Eldritch Blackguard": [
		/^Blackguard’s Blight$/i,
		/^Darkstalkers$/i,
		/^Deathgrip$/i,
		/^Dreadful Edge$/i,
		/^Fell Spines$/i,
		/^Grasping Shadows$/i,
		/^Green-Flame Strike$/i,
		/^Hungry Ghosts$/i,
		/^Life Drinker$/i,
		/^Living Shadow$/i,
		/^Mistfade Retreat$/i,
		/^Necrotic Grip$/i,
		/^Shadowy Feint$/i,
		/^Skull Taker$/i,
		/^Vicious Blade$/i,
	],
	"Gallant Heart": [
		/^Bravado Taunt$/i,
		/^Captivating Speech$/i,
		/^Challenger's Strike$/i,
		/^Engender Doubt$/i,
		/^Formal Introduction$/i,
		/^Honourable Bout$/i,
		/^Impeccable Presence$/i,
		/^Overconfident Gambit$/i,
		/^Socialite Stance$/i,
		/^Sporting Chance$/i,
		/^Stylish Tumble$/i,
		/^To My Side$/i,
		/^To The Death$/i,
		/^Triumphant Return$/i,
		/^Wink and Smile$/i,
	],
	"MB": [
		/^Always Prepared$/i,
		/^Anticipated Intercept$/i,
		/^Assess Defenses$/i,
		/^Blind Stance$/i,
		/^Calculated Trajectory$/i,
		/^Elusive Maneuvering$/i,
		/^Gunner’s Focus$/i,
		/^Kinesthetic Geometry$/i,
		/^Martial Alacrity$/i,
		/^Pilot’s Trance Stance$/i,
		/^Psychosomatic Encouragement$/i,
		/^Starfield Vision$/i,
		/^Sympathetic Heart Stop$/i,
		/^Tactical Retreat$/i,
		/^Thoughtful Assistance$/i,
	],
	"Mirror's Glint": [
		/^Assisted Roll$/i,
		/^Blinding Strikes$/i,
		/^Discerning Strike$/i,
		/^Flowing Form$/i,
		/^Heightened Reflexes$/i,
		/^Knockdown Assault$/i,
		/^Leading Throw$/i,
		/^Off-Balancing Strikes$/i,
		/^Redirect$/i,
		/^Reflect Attack$/i,
		/^Retributive Blow$/i,
		/^Strike the Cracks Stance$/i,
		/^Take Weapon$/i,
		/^Warning Strike$/i,
		/^Wary Stance$/i,
	],
	"Mist and Shade": [
		/^Agile Feint$/i,
		/^Anticipate Spell$/i,
		/^Armor Lock$/i,
		/^Blinding Blow Stance$/i,
		/^Deceptive Stance$/i,
		/^Douse$/i,
		/^Feinting Strike$/i,
		/^Force Hesitation$/i,
		/^Mugging Hit$/i,
		/^Painful Pickpocket$/i,
		/^Perplexing Flurry$/i,
		/^Pickpocket$/i,
		/^Pilfer Object$/i,
		/^Spinning Parry$/i,
		/^Steal Momentum$/i,
	],
	"Rapid Current": [
		/^Charge$/i,
		/^Crushing Waterfall$/i,
		/^Disarming Counter$/i,
		/^Eye Slash$/i,
		/^First Blood$/i,
		/^Flowing Steps Stance$/i,
		/^Parrying Counter$/i,
		/^Rapid Drink$/i,
		/^Rapid Strike$/i,
		/^Rolling Strike$/i,
		/^Speed Over Strength$/i,
		/^Swift Stance$/i,
		/^Tidal Parry$/i,
		/^Tsunami Dash$/i,
		/^Whirlpool Strike$/i,
		/^Whirlwind Strike$/i,
	],
	"Razor's Edge": [
		/^Dangerous Strikes$/i,
		/^Dashing Razor$/i,
		/^Death Blow$/i,
		/^Drive Back$/i,
		/^Exploit Footing$/i,
		/^Heightened Concentration$/i,
		/^Instinctive Counterattack$/i,
		/^Iron Will$/i,
		/^Mind Over Body$/i,
		/^Perceptive Stance$/i,
		/^Perfect Edge Stance$/i,
		/^Practiced Roll$/i,
		/^Sharpened Awareness$/i,
		/^Twist the Blade$/i,
		/^Use The Pain$/i,
	],
	"Sanguine Knot": [
		/^Back To Back$/i,
		/^Bodyguard$/i,
		/^Brotherhood Stance$/i,
		/^Double Tackle$/i,
		/^Doubleteam$/i,
		/^Doubletime$/i,
		/^Dual Grapple$/i,
		/^Follow-Up Topple$/i,
		/^Hurl Ally$/i,
		/^Legion Stance$/i,
		/^Look At Me!$/i,
		/^Rallying Cry$/i,
		/^Shield Wall$/i,
		/^Shoulder Check$/i,
		/^United We Stand$/i,
	],
	"Spirited Steed": [
		/^Cavalier Stance$/i,
		/^Lancer Strike$/i,
		/^Launched Strike$/i,
		/^Mounted Charge$/i,
		/^Prodigious Leap$/i,
		/^Rearing Menace$/i,
		/^Reassuring Pat$/i,
		/^Riding Leap$/i,
		/^Sacrifice Mount$/i,
		/^Saddled Blows$/i,
		/^Spirited Whistle$/i,
		/^Spur Mount$/i,
		/^Steely Steed Stance$/i,
		/^Trample$/i,
		/^Wheeling Charge$/i,
	],
	"Tempered Iron": [
		/^Branding Steel$/i,
		/^Break Spell$/i,
		/^Burning Embers of Faith$/i,
		/^Defy Magic$/i,
		/^Devoted Assault$/i,
		/^Dispelling Assault$/i,
		/^Disrupting Charge$/i,
		/^Faith Within$/i,
		/^Gaze Of Conviction$/i,
		/^Imposing Glare$/i,
		/^Purge Magic$/i,
		/^Spell Shattering Strike$/i,
		/^Striding Swings$/i,
		/^Stunning Assault$/i,
		/^Zealous Stance$/i,
	],
	"Tooth and Claw": [
		/^Blind Instinct$/i,
		/^Bloody Roar$/i,
		/^Bounding Strike$/i,
		/^Expert Tumble$/i,
		/^Furious Barrage$/i,
		/^Gut Strike$/i,
		/^Leaping Strike$/i,
		/^Mercurial Striking Stance$/i,
		/^Primal Intercept$/i,
		/^Rake$/i,
		/^Raking Strikes$/i,
		/^Ride Enemy$/i,
		/^Springing Stance$/i,
		/^Wild Capering$/i,
		/^Wounded Animal Gambit$/i,
	],
	"Unending Wheel": [
		/^Any Weapon Stance$/i,
		/^Dangerous Signature$/i,
		/^Deflect Strike$/i,
		/^Disarming Assault$/i,
		/^Expert Sidestep$/i,
		/^Heart of the Sword$/i,
		/^Instant Strike$/i,
		/^Mistaken Opportunity$/i,
		/^Perfect Assault$/i,
		/^Preternatural Strikes$/i,
		/^Throwing Stance$/i,
		/^Unsettling Injury$/i,
		/^Victory Pose$/i,
		/^Wind Strike$/i,
		/^Wounding Strike$/i,
	],
	"Unerring Hawk": [
		/^Blood Tracking$/i,
		/^Hamstring$/i,
		/^Harrying Shots$/i,
		/^Hunting Stance$/i,
		/^Merciless Ambush$/i,
		/^On Task$/i,
		/^Overwatch$/i,
		/^Predict Movements$/i,
		/^Resteady$/i,
		/^Run Down$/i,
		/^Singular Focus$/i,
		/^Split the Arrow$/i,
		/^Stalking Crouch$/i,
		/^Stoic Stance$/i,
		/^Thread the Needle$/i,
	],
};

// ── Cross-source first-party picker pools ──
// One named export per (featureType × source). Specs that pick from
// multiple sources should use the buildAny*Checks helpers below to
// union the relevant pools.

export const AS_XGE: RegExp[] = [
	/^Banishing Arrow$/i,
	/^Beguiling Arrow$/i,
	/^Bursting Arrow$/i,
	/^Enfeebling Arrow$/i,
	/^Grasping Arrow$/i,
	/^Piercing Arrow$/i,
	/^Seeking Arrow$/i,
	/^Shadow Arrow$/i,
];
export const AS_XGE_FIRST_PICK: string = "Banishing Arrow";

export const EI_XPHB: RegExp[] = [
	/^Agonizing Blast$/i,
	/^Armor of Shadows$/i,
	/^Ascendant Step$/i,
	/^Devil's Sight$/i,
	/^Devouring Blade$/i,
	/^Eldritch Mind$/i,
	/^Eldritch Smite$/i,
	/^Eldritch Spear$/i,
	/^Fiendish Vigor$/i,
	/^Gaze of Two Minds$/i,
	/^Gift of the Depths$/i,
	/^Gift of the Protectors$/i,
	/^Investment of the Chain Master$/i,
	/^Lessons of the First Ones$/i,
	/^Lifedrinker$/i,
	/^Mask of Many Faces$/i,
	/^Master of Myriad Forms$/i,
	/^Misty Visions$/i,
	/^One with Shadows$/i,
	/^Otherworldly Leap$/i,
	/^Pact of the Blade$/i,
	/^Pact of the Chain$/i,
	/^Pact of the Tome$/i,
	/^Repelling Blast$/i,
	/^Thirsting Blade$/i,
	/^Visions of Distant Realms$/i,
	/^Whispers of the Grave$/i,
	/^Witch Sight$/i,
];
export const EI_XPHB_FIRST_PICK: string = "Agonizing Blast";
export const EI_XGE: RegExp[] = [
	/^Aspect of the Moon$/i,
	/^Cloak of Flies$/i,
	/^Eldritch Smite$/i,
	/^Ghostly Gaze$/i,
	/^Gift of the Depths$/i,
	/^Gift of the Ever-Living Ones$/i,
	/^Grasp of Hadar$/i,
	/^Improved Pact Weapon$/i,
	/^Lance of Lethargy$/i,
	/^Maddening Hex$/i,
	/^Relentless Hex$/i,
	/^Shroud of Shadow$/i,
	/^Tomb of Levistus$/i,
	/^Trickster's Escape$/i,
];
export const EI_XGE_FIRST_PICK: string = "Aspect of the Moon";
export const EI_PHB: RegExp[] = [
	/^Agonizing Blast$/i,
	/^Armor of Shadows$/i,
	/^Ascendant Step$/i,
	/^Beast Speech$/i,
	/^Beguiling Influence$/i,
	/^Bewitching Whispers$/i,
	/^Book of Ancient Secrets$/i,
	/^Chains of Carceri$/i,
	/^Devil's Sight$/i,
	/^Dreadful Word$/i,
	/^Eldritch Sight$/i,
	/^Eldritch Spear$/i,
	/^Eyes of the Rune Keeper$/i,
	/^Fiendish Vigor$/i,
	/^Gaze of Two Minds$/i,
	/^Lifedrinker$/i,
	/^Mask of Many Faces$/i,
	/^Master of Myriad Forms$/i,
	/^Minions of Chaos$/i,
	/^Mire the Mind$/i,
	/^Misty Visions$/i,
	/^One with Shadows$/i,
	/^Otherworldly Leap$/i,
	/^Repelling Blast$/i,
	/^Sculptor of Flesh$/i,
	/^Sign of Ill Omen$/i,
	/^Thief of Five Fates$/i,
	/^Thirsting Blade$/i,
	/^Visions of Distant Realms$/i,
	/^Voice of the Chain Master$/i,
	/^Whispers of the Grave$/i,
	/^Witch Sight$/i,
];
export const EI_PHB_FIRST_PICK: string = "Agonizing Blast";
export const EI_TCE: RegExp[] = [
	/^Bond of the Talisman$/i,
	/^Eldritch Mind$/i,
	/^Far Scribe$/i,
	/^Gift of the Protectors$/i,
	/^Investment of the Chain Master$/i,
	/^Protection of the Talisman$/i,
	/^Rebuke of the Talisman$/i,
	/^Undying Servitude$/i,
];
export const EI_TCE_FIRST_PICK: string = "Bond of the Talisman";

export const MM_XPHB: RegExp[] = [
	/^Careful Spell$/i,
	/^Distant Spell$/i,
	/^Empowered Spell$/i,
	/^Extended Spell$/i,
	/^Heightened Spell$/i,
	/^Quickened Spell$/i,
	/^Seeking Spell$/i,
	/^Subtle Spell$/i,
	/^Transmuted Spell$/i,
	/^Twinned Spell$/i,
];
export const MM_XPHB_FIRST_PICK: string = "Careful Spell";
export const MM_PHB: RegExp[] = [
	/^Careful Spell$/i,
	/^Distant Spell$/i,
	/^Empowered Spell$/i,
	/^Extended Spell$/i,
	/^Heightened Spell$/i,
	/^Quickened Spell$/i,
	/^Subtle Spell$/i,
	/^Twinned Spell$/i,
];
export const MM_PHB_FIRST_PICK: string = "Careful Spell";
export const MM_TCE: RegExp[] = [
	/^Seeking Spell$/i,
	/^Transmuted Spell$/i,
];
export const MM_TCE_FIRST_PICK: string = "Seeking Spell";

export const MVB_XPHB: RegExp[] = [
	/^Ambush$/i,
	/^Bait and Switch$/i,
	/^Commander's Strike$/i,
	/^Commanding Presence$/i,
	/^Disarming Attack$/i,
	/^Distracting Strike$/i,
	/^Evasive Footwork$/i,
	/^Feinting Attack$/i,
	/^Goading Attack$/i,
	/^Lunging Attack$/i,
	/^Maneuvering Attack$/i,
	/^Menacing Attack$/i,
	/^Parry$/i,
	/^Precision Attack$/i,
	/^Pushing Attack$/i,
	/^Rally$/i,
	/^Riposte$/i,
	/^Sweeping Attack$/i,
	/^Tactical Assessment$/i,
	/^Trip Attack$/i,
];
export const MVB_XPHB_FIRST_PICK: string = "Ambush";
export const MVB_PHB: RegExp[] = [
	/^Commander's Strike$/i,
	/^Disarming Attack$/i,
	/^Distracting Strike$/i,
	/^Evasive Footwork$/i,
	/^Feinting Attack$/i,
	/^Goading Attack$/i,
	/^Lunging Attack$/i,
	/^Maneuvering Attack$/i,
	/^Menacing Attack$/i,
	/^Parry$/i,
	/^Precision Attack$/i,
	/^Pushing Attack$/i,
	/^Rally$/i,
	/^Riposte$/i,
	/^Sweeping Attack$/i,
	/^Trip Attack$/i,
];
export const MVB_PHB_FIRST_PICK: string = "Commander's Strike";
export const MVB_TCE: RegExp[] = [
	/^Ambush$/i,
	/^Bait and Switch$/i,
	/^Brace$/i,
	/^Commanding Presence$/i,
	/^Grappling Strike$/i,
	/^Quick Toss$/i,
	/^Tactical Assessment$/i,
];
export const MVB_TCE_FIRST_PICK: string = "Ambush";

export const PB_XPHB: RegExp[] = [];
export const PB_XPHB_FIRST_PICK: string | undefined = undefined;
export const PB_PHB: RegExp[] = [
	/^Pact of the Blade$/i,
	/^Pact of the Chain$/i,
	/^Pact of the Tome$/i,
];
export const PB_PHB_FIRST_PICK: string = "Pact of the Blade";
export const PB_TCE: RegExp[] = [
	/^Pact of the Talisman$/i,
];
export const PB_TCE_FIRST_PICK: string = "Pact of the Talisman";

// ── Subclass-feature catalogs ──
// Subclasses that enumerate options as individual subclassFeature
// entries (NOT pickers) — every catalog entry surfaces on the sheet
// for any character of that subclass at the appropriate level.

// Druid / Zodiac L3
export const ZODIAC_FORMS_L3: RegExp[] = [
	/^Aurochs$/i,
	/^Beaver$/i,
	/^Bee$/i,
	/^Bulette$/i,
	/^Cat$/i,
	/^Griffon$/i,
	/^Horse$/i,
	/^Hound$/i,
	/^Octopus$/i,
	/^Peacock$/i,
	/^Phoenix$/i,
	/^Roc$/i,
];
export const ZODIAC_FORMS_L3_LEVEL: number = 3;

// Druid / Zodiac L10
export const ZODIAC_FORMS_L10: RegExp[] = [
	/^Almiraj$/i,
	/^Aurumvorax$/i,
	/^Bat$/i,
	/^Hillstep Turtle$/i,
	/^Kitsune$/i,
	/^Lizard$/i,
	/^Owlbear$/i,
	/^Pseudodragon$/i,
	/^Raven$/i,
	/^Salmon$/i,
	/^Sequoia$/i,
	/^Unicorn$/i,
];
export const ZODIAC_FORMS_L10_LEVEL: number = 10;

// Monk / Debilitation L3
export const DEBILITATION_PRECISE_STRIKES_L3: RegExp[] = [
	/^Combat Methods \(Debilitation\)$/i,
	/^Precise Strike$/i,
];
export const DEBILITATION_PRECISE_STRIKES_L3_LEVEL: number = 3;

// ────────────────────────────────────────────────────────────────────────
// build*Checks helpers — emit FeatureCheck arrays that specs spread
// into their featuresMatrix. Each helper attaches a "pickedFeatureGrants"
// effect for the auto-picker's deterministic first choice (when an
// effect map entry exists), so the test verifies not just that a pick
// surfaced but that the picked option's documented effect lands on the
// sheet.
//
// All progression arrays are defaults — pass an explicit progression
// to override (e.g. for multiclass specs).
// ────────────────────────────────────────────────────────────────────────

function applyLevelMap (level: number, levelMap?: Record<number, number>): number {
	return levelMap?.[level] ?? level;
}

function pickedGrants (pickName: string, subEffects?: EffectCheck[]): EffectCheck[] {
	if (!subEffects || subEffects.length === 0) return [];
	return [{kind: "pickedFeatureGrants", pickName, subEffects}];
}

/**
 * Generate FeatureCheck entries for the TGTT "Specialties" pick at each
 * level the class gains a new specialty. Each entry asserts that
 * cumulative `pickedCount` distinct specialty names from the class's
 * pool surface in the feature list, and (if the class has an entry in
 * TGTT_SPECIALTY_EFFECTS) attaches a `pickedFeatureGrants` effect for
 * the auto-picker's deterministic first pick.
 *
 * Multiclass usage: pass the class-level you expect at the milestone
 * (not character-level) — `levelMap` maps class-level → character-level.
 */
export function buildSpecialtyChecks (className: string, levelMap?: Record<number, number>): FeatureCheck[] {
	const pool = TGTT_SPECIALTIES[className];
	const levels = TGTT_SPECIALTY_LEVELS[className];
	if (!pool || !levels) return [];
	const firstPick = TGTT_SPECIALTY_FIRST_PICK[className];
	const subEffects = firstPick ? TGTT_SPECIALTY_EFFECTS?.[className]?.[firstPick] : undefined;
	const grants = firstPick ? pickedGrants(firstPick, subEffects) : [];
	return levels.map((classLevel, idx) => ({
		level: applyLevelMap(classLevel, levelMap),
		name: /specialties/i,
		kind: "pick" as const,
		pickedCount: idx + 1,
		pickedFrom: pool,
		// Per-pick effect attached only at the first milestone — re-checking
		// the same effect at every milestone would be redundant.
		effects: idx === 0 && grants.length ? grants : undefined,
	}));
}

/**
 * Recover the auto-picker's deterministic first choice (lexicographic)
 * from a regex pool. Pools emitted by the generator are
 * `/^Name$/i` literals, so we strip the anchors and case flag.
 */
function readableFirstPick (pool: RegExp[]): string | undefined {
	const names: string[] = [];
	for (const r of pool) {
		const m = /^\/\^(.+?)\$\/i?$/.exec(r.toString());
		if (m) names.push(m[1].replace(/\\(.)/g, "$1"));
	}
	if (!names.length) return undefined;
	return names.sort((a, b) => a.localeCompare(b))[0];
}

function buildOptionalFeatureChecks (
	featureName: RegExp,
	pool: RegExp[],
	effectMap: Record<string, EffectCheck[] | undefined> | undefined,
	progression: Array<{level: number; cum: number}>,
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	const firstPickName = readableFirstPick(pool);
	const subEffects = firstPickName ? effectMap?.[firstPickName] : undefined;
	const grants = firstPickName ? pickedGrants(firstPickName, subEffects) : [];
	return progression.map(({level, cum}, idx) => ({
		level: applyLevelMap(level, levelMap),
		name: featureName,
		kind: "pick" as const,
		pickedCount: cum,
		pickedFrom: pool,
		effects: idx === 0 && grants.length ? grants : undefined,
	}));
}

/**
 * Fighter Battle Tactics — emits one FeatureCheck per cumulative
 * milestone (L3/7/10/15) and attaches a `pickedFeatureGrants` effect
 * for the auto-picker's first choice at L3.
 */
export function buildBattleTacticChecks (levelMap?: Record<number, number>): FeatureCheck[] {
	const milestones = Object.entries(TGTT_BATTLE_TACTICS_CUM)
		.map(([lvl, cum]) => ({level: Number(lvl), cum}))
		.sort((a, b) => a.level - b.level);
	return buildOptionalFeatureChecks(
		/Battle Tactics/i, TGTT_BATTLE_TACTICS, TGTT_BATTLE_TACTIC_EFFECTS, milestones, levelMap,
	);
}

/**
 * Sorcerer Metamagic — TGTT homebrew lets sorcerers pick MM options at
 * L3/10/17 (matches XPHB). Pass a progression override if needed.
 */
export function buildMetamagicChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 10, cum: 3}, {level: 17, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Metamagic/i, TGTT_METAMAGIC, TGTT_METAMAGIC_EFFECTS, progression, levelMap,
	);
}

/**
 * Warlock Eldritch Invocations — XPHB Warlock learns invocations at
 * L2/5/7/9/12/15/18.
 */
export function buildInvocationChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 2, cum: 2}, {level: 5, cum: 3}, {level: 7, cum: 4},
		{level: 9, cum: 5}, {level: 12, cum: 6}, {level: 15, cum: 7}, {level: 18, cum: 8},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Eldritch Invocations|Invocations/i,
		TGTT_ELDRITCH_INVOCATIONS,
		TGTT_ELDRITCH_INVOCATION_EFFECTS,
		progression,
		levelMap,
	);
}

/** Jester Bard Acts — picks at L3 (subclass arrival) and grow on level-up. */
export function buildJesterActChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 6, cum: 3}, {level: 14, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Jester Acts|Acts/i, TGTT_JESTER_ACTS, TGTT_JESTER_ACT_EFFECTS, progression, levelMap,
	);
}

/** Trickster Rogue Tricks — picks at L3+. */
export function buildTricksterTrickChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 9, cum: 3}, {level: 13, cum: 4}, {level: 17, cum: 5},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Trickster Tricks|Tricks/i, TGTT_TRICKSTER_TRICKS, TGTT_TRICKSTER_TRICK_EFFECTS, progression, levelMap,
	);
}

/** Belly Dancer Rogue / Pugilist Painful Strikes — picks at L3+. */
export function buildPainfulStrikeChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 9, cum: 3}, {level: 13, cum: 4}, {level: 17, cum: 5},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Painful Strikes|Strikes/i, TGTT_PAINFUL_STRIKES, TGTT_PAINFUL_STRIKE_EFFECTS, progression, levelMap,
	);
}

/** TGTT Warlock Pact Boons — Pact of Transformation single pick at L3. */
export function buildPactBoonChecks (
	progression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Pact Boon/i, TGTT_PACT_BOONS, TGTT_PACT_BOON_EFFECTS, progression, levelMap,
	);
}

/** Dreamwalker subclass calls/customs and studies/specials. */
export function buildDreamwalkerChecks (
	customsProgression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}, {level: 10, cum: 2}],
	specialsProgression: Array<{level: number; cum: number}> = [{level: 6, cum: 2}, {level: 14, cum: 4}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return [
		...buildOptionalFeatureChecks(
			/Dreamwalker Calls|Customs/i,
			TGTT_DREAMWALKER_CUSTOMS,
			TGTT_DREAMWALKER_CUSTOM_EFFECTS,
			customsProgression,
			levelMap,
		),
		...buildOptionalFeatureChecks(
			/Dreamwalker Studies|Specials/i,
			TGTT_DREAMWALKER_SPECIALS,
			TGTT_DREAMWALKER_SPECIAL_EFFECTS,
			specialsProgression,
			levelMap,
		),
	];
}

/**
 * XPHB Weapon Mastery — emits one pick check at the given level with
 * `pickedFeatureGrants` sub-effects per provided weapon name.
 */
export function buildWeaponMasteryChecks (
	weaponNames: string[],
	level: number = 1,
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	const effects: EffectCheck[] = weaponNames.flatMap(w => {
		const sub = XPHB_WEAPON_MASTERY_EFFECTS?.[w] ?? [];
		return sub.length ? [{kind: "pickedFeatureGrants" as const, pickName: w, subEffects: sub}] : [];
	});
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return [{
		level: applyLevelMap(level, levelMap),
		name: /Weapon Mastery/i,
		kind: "pick" as const,
		pickedCount: weaponNames.length,
		pickedFrom: weaponNames.map(w => new RegExp("^" + escape(w) + "$", "i")),
		effects: effects.length ? effects : undefined,
	}];
}


// ────────────────────────────────────────────────────────────────────────
// Cross-source helpers — union per-source pools and call the common
// optional-feature-check builder. Effect maps are merged per-pick.
// ────────────────────────────────────────────────────────────────────────

const _CROSS_SOURCE_POOLS = {
	EI: {XPHB: EI_XPHB, XGE: EI_XGE, PHB: EI_PHB, TCE: EI_TCE, TGTT: TGTT_ELDRITCH_INVOCATIONS},
	MM: {XPHB: MM_XPHB, PHB: MM_PHB, TCE: MM_TCE, TGTT: TGTT_METAMAGIC},
	AS: {XGE: AS_XGE},
	"MV:B": {XPHB: MVB_XPHB, PHB: MVB_PHB, TCE: MVB_TCE},
	PB: {XPHB: PB_XPHB, PHB: PB_PHB, TCE: PB_TCE, TGTT: TGTT_PACT_BOONS},
} as const;

const _CROSS_SOURCE_EFFECTS = {
	EI: {XPHB: XPHB_INVOCATION_EFFECTS, TGTT: TGTT_ELDRITCH_INVOCATION_EFFECTS},
	MM: {XPHB: XPHB_METAMAGIC_EFFECTS, TGTT: TGTT_METAMAGIC_EFFECTS},
	AS: {XGE: XGE_ARCANE_SHOT_EFFECTS},
	"MV:B": {XPHB: XPHB_MANEUVER_EFFECTS},
	PB: {XPHB: XPHB_PACT_BOON_EFFECTS, TGTT: TGTT_PACT_BOON_EFFECTS},
} as const;

function _mergedEffectMap (
	featureType: keyof typeof _CROSS_SOURCE_EFFECTS,
	sources: string[],
): Record<string, EffectCheck[] | undefined> {
	const merged: Record<string, EffectCheck[] | undefined> = {};
	const bucket = _CROSS_SOURCE_EFFECTS[featureType] as Record<string, Record<string, EffectCheck[] | undefined> | undefined>;
	for (const src of sources) {
		const m = bucket?.[src];
		if (!m) continue;
		for (const [k, v] of Object.entries(m)) {
			if (merged[k] === undefined) merged[k] = v;
		}
	}
	return merged;
}

function _unionPool (
	featureType: keyof typeof _CROSS_SOURCE_POOLS,
	sources: string[],
): RegExp[] {
	const seen = new Set<string>();
	const out: RegExp[] = [];
	const bucket = _CROSS_SOURCE_POOLS[featureType] as Record<string, RegExp[] | undefined>;
	for (const src of sources) {
		for (const re of (bucket?.[src] ?? [])) {
			const key = re.toString();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(re);
		}
	}
	return out.sort((a, b) => a.toString().localeCompare(b.toString()));
}

/** Eldritch Invocations across an arbitrary mix of sources. */
export function buildAnyInvocationChecks (
	sources: string[] = ["XPHB", "XGE", "TGTT"],
	progression: Array<{level: number; cum: number}> = [
		{level: 2, cum: 2}, {level: 5, cum: 3}, {level: 7, cum: 4},
		{level: 9, cum: 5}, {level: 12, cum: 6}, {level: 15, cum: 7}, {level: 18, cum: 8},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Eldritch Invocations|Invocations/i,
		_unionPool("EI", sources),
		_mergedEffectMap("EI", sources),
		progression,
		levelMap,
	);
}

/** Metamagic across an arbitrary mix of sources. */
export function buildAnyMetamagicChecks (
	sources: string[] = ["XPHB", "TGTT"],
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 10, cum: 3}, {level: 17, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Metamagic/i,
		_unionPool("MM", sources),
		_mergedEffectMap("MM", sources),
		progression,
		levelMap,
	);
}

/** Battle Master Maneuvers across an arbitrary mix of sources. */
export function buildAnyManeuverChecks (
	sources: string[] = ["XPHB"],
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 3}, {level: 7, cum: 5}, {level: 10, cum: 7}, {level: 15, cum: 9},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Maneuvers|Combat Superiority/i,
		_unionPool("MV:B", sources),
		_mergedEffectMap("MV:B", sources),
		progression,
		levelMap,
	);
}

/** Arcane Shot options (XGE — Arcane Archer Fighter). */
export function buildAnyArcaneShotChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 7, cum: 3}, {level: 10, cum: 4},
		{level: 15, cum: 5}, {level: 18, cum: 6},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Arcane Shot/i,
		_unionPool("AS", ["XGE"]),
		_mergedEffectMap("AS", ["XGE"]),
		progression,
		levelMap,
	);
}

/** Pact Boons across an arbitrary mix of sources. */
export function buildAnyPactBoonChecks (
	sources: string[] = ["XPHB", "TGTT"],
	progression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Pact Boon/i,
		_unionPool("PB", sources),
		_mergedEffectMap("PB", sources),
		progression,
		levelMap,
	);
}

// ────────────────────────────────────────────────────────────────────────
// Subclass-feature catalog helper (Zodiac forms, Precise Strike Methods).
// Catalogs differ from pickers: every entry surfaces on the sheet for any
// character of that subclass; the spec asserts existence of every entry
// AND verifies the documented effect of one representative entry.
// ────────────────────────────────────────────────────────────────────────

export function buildCatalogChecks (args: {
	pool: RegExp[];
	level: number;
	featureNameRe?: RegExp;
	repName?: string;
	effectMap?: Record<string, EffectCheck[] | undefined>;
	levelMap?: Record<number, number>;
}): FeatureCheck[] {
	const {pool, level, featureNameRe, repName, effectMap, levelMap} = args;
	const charLevel = applyLevelMap(level, levelMap);
	const out: FeatureCheck[] = [];
	for (const re of pool) {
		out.push({
			level: charLevel,
			name: re,
			kind: "passive" as const,
		});
	}
	if (repName && featureNameRe) {
		const sub = effectMap?.[repName];
		if (sub && sub.length) {
			out.push({
				level: charLevel,
				name: featureNameRe,
				kind: "passive" as const,
				effects: [{kind: "pickedFeatureGrants" as const, pickName: repName, subEffects: sub}],
			});
		}
	}
	return out;
}

/** Convenience wrapper for Zodiac Druid forms — emits L3 + L10 catalogs. */
export function buildZodiacFormChecks (levelMap?: Record<number, number>): FeatureCheck[] {
	return [
		...buildCatalogChecks({
			pool: ZODIAC_FORMS_L3, level: ZODIAC_FORMS_L3_LEVEL,
			featureNameRe: /Zodiac Form: Month/i,
			repName: "Roc",
			effectMap: ZODIAC_FORM_EFFECTS,
			levelMap,
		}),
		...buildCatalogChecks({
			pool: ZODIAC_FORMS_L10, level: ZODIAC_FORMS_L10_LEVEL,
			featureNameRe: /Zodiac Form: Star Week/i,
			repName: "Unicorn",
			effectMap: ZODIAC_FORM_EFFECTS,
			levelMap,
		}),
	];
}
