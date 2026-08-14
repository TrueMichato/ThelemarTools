import {Page} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {LevelUpPage} from "../pages/LevelUpPage";

/**
 * Character build presets for use across E2E tests.
 * Each preset defines the wizard selections needed to create a character.
 */
export interface CharacterPreset {
	race: string;
	raceSource: string;
	/**
	 * Optional subrace label exactly as it appears in the wizard's
	 * subrace dropdown (e.g. "Jaknian", "Lexalian"). When the chosen
	 * race exposes a subrace selector, this label is selected after
	 * the parent race click. Required for races that gate stats
	 * behind a subrace pick.
	 */
	subrace?: string;
	className: string;
	classSource: string;
	/** Override the sheet's source-priority filter before the Builder renders. */
	prioritySources?: string[];
	/** Disable per-roll conditional pickers for deterministic lifecycle probes. */
	skipConditionalPrompt?: boolean;
	background: string;
	bgSource: string;
	name: string;
	quickBuildTargetLevel?: number;
	skillCount?: number;
	masteryCount?: number;
	optFeatCount?: number;
	divineSoulAffinity?: string;
	namedSubclassChoice?: {title: string; name: string};
	/** Subclass to select on level-up (e.g. "Bladesinging"). */
	subclassName?: string;
	/** Subclass source ("TGTT", "TGTT-2014", "TGTT-2024", ...). */
	subclassSource?: string;
	/**
	 * Optional signature spells to deterministically pick during creation /
	 * level-up wizards instead of relying on auto-fill. See pickSignatureSpells.
	 */
	signatureSpells?: string[];
	/**
	 * Optional preference regex tested against each class-feat-progression
	 * option's visible text (e.g. Fighter L1 "Fighting Style") during
	 * wizard creation. Passed through to `selectClassFeatProgressions` so a
	 * spec can pin a SPECIFIC, deterministic pick (e.g. `/^archery /i`)
	 * instead of whatever lands first alphabetically — homebrew sources can
	 * inject extra same-category feats ("Advanced Weapon Proficiency (FS)"
	 * from GrimHollowPG24 sorts before "Archery") that would otherwise make
	 * the "obvious" pick non-deterministic.
	 */
	preferredFeatProgressionPattern?: RegExp;
	/**
	 * Ability priority for the standard-array assignment step, best score
	 * first (e.g. `["cha", "dex", "con", "wis", "int", "str"]`). Omit to keep
	 * the historical STR-first default. Spellcaster presets should set this —
	 * the default otherwise puts an 8 in the spellcasting ability, which makes
	 * save DCs and mod-scaled pools unrepresentative of real play.
	 */
	abilityPriority?: string[];
	/** Additional homebrew JSON URLs required by this build. */
	homebrewUrls?: string[];
}

// NOTE: All legacy PRESETs use `classSource: "TGTT"` because the character-sheet
// dev fork autoloads `homebrew/TravelersGuidetoThelemar.json` via
// `homebrew/index.json`, and the sheet's default `prioritySources: ["TGTT"]`
// setting (CharacterSheetState._getDefaultData) hides the PHB'24/XPHB versions
// of any class TGTT redefines (every base class). Using PHB'24 here causes
// `selectClassExact` to throw "Could not find …" because the class isn't in
// the deduped list. TGTT versions are mechanically identical for the L1 / L3 /
// L5 smoke tests these PRESETs drive.

/** Simple Fighter — minimal selections, fastest to create */
export const PRESET_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Test Fighter",
	skillCount: 2,
	masteryCount: 3,
	optFeatCount: 1,
};

/** Cleric — tests Divine Order optional feature + feature options */
export const PRESET_CLERIC: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Cleric",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Test Cleric",
	skillCount: 2,
	optFeatCount: 1,
};

export const PRESET_FULL_XPHB_LIGHT_CLERIC: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Cleric",
	classSource: "PHB'24",
	prioritySources: ["XPHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Solana Dawnkeeper",
	skillCount: 2,
	optFeatCount: 1,
	subclassName: "Light Domain",
	subclassSource: "PHB'24",
	signatureSpells: ["Sacred Flame", "Bless", "Cure Wounds"],
};

/** XPHB 2024 Circle of the Sea Druid. */
export const PRESET_FULL_SEA_DRUID: CharacterPreset = {
	race: "Human",
	raceSource: "PHB'24",
	className: "Druid",
	classSource: "PHB'24",
	prioritySources: ["XPHB"],
	skipConditionalPrompt: true,
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Nerida Tidecaller",
	skillCount: 2,
	optFeatCount: 1,
	subclassName: "Circle of the Sea",
	subclassSource: "PHB'24",
	signatureSpells: ["Druidcraft", "Cure Wounds", "Entangle"],
};
/** PHB 2014 Tempest Domain Cleric. */export const PRESET_FULL_TEMPEST_CLERIC: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Cleric",
	classSource: "PHB",
	prioritySources: ["PHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Thora Stormward",
	skillCount: 2,
	subclassName: "Tempest Domain",
	subclassSource: "PHB",
	signatureSpells: ["Sacred Flame", "Bless", "Cure Wounds"],
};

export const PRESET_FULL_XPHB_DEVOTION_PALADIN: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Paladin",
	classSource: "PHB'24",
	prioritySources: ["XPHB"],
	skipConditionalPrompt: true,
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Ser Calen Trueheart",
	skillCount: 2,
	masteryCount: 2,
	optFeatCount: 1,
	subclassName: "Oath of Devotion",
	subclassSource: "PHB'24",
	signatureSpells: ["Bless", "Divine Smite", "Shield of Faith"],
};

/** Bard — spellcaster with known spells */
export const PRESET_BARD: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Test Bard",
	skillCount: 3,
};

// ═══════════════════════════════════════════════════════════════════════════
//  TGTT PLAYER PARTY PRESETS (7 combos)
// ═══════════════════════════════════════════════════════════════════════════

/** TGTT Bladesinger Wizard */
export const PRESET_TGTT_BLADESINGER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Thea Bladesinger",
	skillCount: 2,
};

/** TGTT Zodiac Druid (Circle of the Stars) */
export const PRESET_TGTT_ZODIAC_DRUID: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Druid",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Celeste Zodiac",
	skillCount: 2,
};

/** TGTT Hunter Ranger */
export const PRESET_TGTT_HUNTER_RANGER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Ranger",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Kael Hunter",
	skillCount: 3,
};

/** TGTT Arcane Archer Fighter */
export const PRESET_TGTT_ARCANE_ARCHER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Varn Arcane Archer",
	skillCount: 2,
	masteryCount: 3,
};

/** TGTT Way of Mercy Monk */
export const PRESET_TGTT_MERCY_MONK: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Zara Mercy",
	skillCount: 2,
};

/** TGTT Divine Soul Sorcerer */
export const PRESET_TGTT_DIVINE_SOUL: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Isra Divine Soul",
	skillCount: 2,
	divineSoulAffinity: "Good",
};

/** TGTT Hexblade Warlock */
export const PRESET_TGTT_HEXBLADE: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Warlock",
	classSource: "TGTT",
	background: "Criminal",
	bgSource: "PHB'24",
	name: "Mordak Hexblade",
	skillCount: 2,
};

// ═══════════════════════════════════════════════════════════════════════════
//  COMPREHENSIVE PLAYER-BUILD PRESETS — full L1→20 coverage
//  ───────────────────────────────────────────────────────────────────────
//  These are the 10 builds exercised by the comprehensive E2E specs added
//  alongside this preset block.  Race, subclass, and signature spells are
//  pre-resolved to the names actually present in
//  homebrew/TravelersGuidetoThelemar.json so the wizard can select them
//  directly via the existing fuzzy `includes` matchers in
//  BuilderWizardPage / LevelUpPage.
// ═══════════════════════════════════════════════════════════════════════════

/** 1. Mercy Monk Changeling (TGTT) */
export const PRESET_FULL_MERCY_MONK_CHANGELING: CharacterPreset = {
	race: "Changeling",
	raceSource: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Zara Mercyhand",
	skillCount: 2,
	subclassName: "Warrior of Mercy",
	subclassSource: "TGTT",
};

/** Astral Self Monk Changeling (TCE subclass on the TGTT Monk chassis). */
export const PRESET_FULL_ASTRAL_SELF_MONK_CHANGELING: CharacterPreset = {
	race: "Changeling",
	raceSource: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Astra Manyhands",
	skillCount: 2,
	subclassName: "Way of the Astral Self",
	subclassSource: "TCE",
};

/** College of Creation Bard Changeling (TCE subclass on the TGTT Bard chassis). */
export const PRESET_FULL_CREATION_BARD_CHANGELING: CharacterPreset = {
	race: "Changeling",
	raceSource: "TGTT",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Aria Songwright",
	skillCount: 3,
	subclassName: "College of Creation",
	subclassSource: "TCE",
	// Bard: CHA is the spellcasting ability and drives the Mote of Potential
	// save DC, the Dancing Item's to-hit and Creative Crescendo's item count.
	abilityPriority: ["cha", "dex", "con", "wis", "int", "str"],
	signatureSpells: ["Vicious Mockery", "Healing Word"],
};

/** Way of the Sun Soul Monk Changeling (XGE subclass on the TGTT Monk chassis). */
export const PRESET_FULL_SUN_SOUL_MONK_CHANGELING: CharacterPreset = {
	race: "Changeling",
	raceSource: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Sol Radiant",
	skillCount: 2,
	subclassName: "Way of the Sun Soul",
	subclassSource: "XGE",
};

/** 2. Arcane Archer Fighter Hochling (TGTT) */
export const PRESET_FULL_ARCANE_ARCHER_HOCHLING: CharacterPreset = {
	race: "Hochling",
	raceSource: "TGTT",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Varn Boltcaller",
	skillCount: 2,
	masteryCount: 3,
	subclassName: "Arcane Archer",
	subclassSource: "TGTT",
};

/** XPHB Battle Master Fighter */
export const PRESET_FULL_BATTLE_MASTER_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Tarin Battlewise",
	skillCount: 2,
	masteryCount: 3,
	subclassName: "Battle Master",
	subclassSource: "XPHB",
};

/** XPHB Champion Fighter */
export const PRESET_FULL_CHAMPION_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Corin Steeltriumph",
	skillCount: 2,
	masteryCount: 3,
	subclassName: "Champion",
	subclassSource: "XPHB",
	// Pin the L1 Fighting Style pick to Archery (deterministic, mechanically
	// probeable: unconditional +2 ranged attack bonus) and the L7 Additional
	// Fighting Style pick to Blind Fighting (a genuinely NEW, distinct style).
	// Without this, homebrew sources (e.g. GrimHollowPG24's "Advanced Weapon
	// Proficiency (FS)") can sort alphabetically ahead of both and get
	// auto-picked instead. Both patterns live in one regex since this same
	// preset object drives every `levelUpTo` call across the spec (L1
	// creation AND the L7 level-up) — "archery" simply won't match once
	// Archery is already known, so it's a no-op fallback at L7.
	preferredFeatProgressionPattern: /^(archery|blind fighting)\b/i,
};

/** TGS4 Shadow Knight Fighter */
export const PRESET_FULL_SHADOW_KNIGHT_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "PHB",
	prioritySources: ["PHB"],
	background: "Soldier",
	bgSource: "PHB",
	name: "Nyx Gloamward",
	skillCount: 2,
	masteryCount: 3,
	optFeatCount: 1,
	subclassName: "Shadow Knight",
	subclassSource: "GriffonsSaddlebag4",
	preferredFeatProgressionPattern: /^archery\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/collection/Griffin%20Macaulay%3B%20The%20Griffon's%20Saddlebag%2C%20Book%204.json",
	],
};

/** 2b. Meteor Knight Fighter (The Griffon's Saddlebag, Book 3) */
export const PRESET_FULL_METEOR_KNIGHT_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "PHB",
	prioritySources: ["PHB"],
	background: "Soldier",
	bgSource: "PHB",
	name: "Vex Starfall",
	skillCount: 2,
	masteryCount: 3,
	optFeatCount: 1,
	subclassName: "Meteor Knight",
	subclassSource: "GriffonsSaddlebag3",
	preferredFeatProgressionPattern: /^archery\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/collection/Griffin%20Macaulay%3B%20The%20Griffon's%20Saddlebag%2C%20Book%203.json",
	],
};

/** 2c. Steel Hawk Fighter (The Griffon's Saddlebag, Book 2) */
export const PRESET_FULL_STEEL_HAWK_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "PHB",
	prioritySources: ["PHB"],
	background: "Soldier",
	bgSource: "PHB",
	name: "Ryn Skytalon",
	skillCount: 2,
	masteryCount: 3,
	optFeatCount: 1,
	subclassName: "Steel Hawk",
	subclassSource: "GriffonsSaddlebag2",
	preferredFeatProgressionPattern: /^archery\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/collection/Griffin%20Macaulay%3B%20The%20Griffon's%20Saddlebag%2C%20Book%202.json",
	],
};

/** 3. Bladesinger Wizard Tabaxi (TGTT) */
export const PRESET_FULL_BLADESINGER_TABAXI: CharacterPreset = {
	race: "Tabaxi",
	raceSource: "TGTT",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Thea Dancesteel",
	skillCount: 2,
	subclassName: "Bladesinging",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Shield", "Booming Blade", "Mage Armor"],
};

/** 4a. Hunter Ranger Centaur (TGTT) — pure single-class */
export const PRESET_FULL_HUNTER_CENTAUR: CharacterPreset = {
	race: "Centaur",
	raceSource: "TGTT",
	className: "Ranger",
	classSource: "TGTT",
	background: "Outlander",
	bgSource: "PHB",
	name: "Kael Wildhoof",
	skillCount: 3,
	subclassName: "Hunter",
	subclassSource: "TGTT-2024",
	signatureSpells: ["Hunter's Mark", "Cure Wounds"],
};

/** 4b. Zodiac Druid Centaur (TGTT) — pure single-class */
export const PRESET_FULL_ZODIAC_CENTAUR: CharacterPreset = {
	race: "Centaur",
	raceSource: "TGTT",
	className: "Druid",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Celeste Starhoof",
	skillCount: 2,
	subclassName: "Circle of the Zodiac",
	subclassSource: "TGTT",
	signatureSpells: ["Druidcraft", "Goodberry"],
};

/** 5. Hexblade Warlock 2 / Divine Soul Sorcerer 18 Tortle (TGTT) */
export const PRESET_FULL_HEX_DIVINE_TORTLE: CharacterPreset = {
	race: "Tortle",
	raceSource: "TGTT",
	className: "Warlock",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Shellbound Hex",
	skillCount: 2,
	subclassName: "The Hexblade",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Hex", "Eldritch Blast"],
};

/**
 * 6. Child of the Sun Bloodline Sorcerer Hochling (TGTT)
 *
 * CS-BUG-056: `abilityPriority` pins CHA first. Without it the standard array
 * leaves the Sorcerer on CHA 8, which does not merely deflate the spell save DC
 * — it makes Summer's Defiant Blood *unarmable*, because the feature adds your
 * Charisma modifier and refuses a bonus of zero or less. The rider's own probe
 * would then be measuring a dump stat rather than the feature.
 * DEX/CON stay high so HP, AC and initiative are untouched.
 */
export const PRESET_FULL_CHILD_OF_SUN_HOCHLING: CharacterPreset = {
	race: "Hochling",
	raceSource: "TGTT",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Solis Hochsun",
	skillCount: 2,
	subclassName: "Child of the Sun Bloodline",
	subclassSource: "TGTT",
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	signatureSpells: ["Fire Bolt", "Burning Hands"],
};

/** 7. Chronurgy Wizard Nyuidj (TGTT) */
export const PRESET_FULL_CHRONURGY_NYUIDJ: CharacterPreset = {
	race: "Nyuidj",
	raceSource: "TGTT",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Tyk Hourglass",
	skillCount: 2,
	subclassName: "Chronurgy Magic",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Mage Hand", "Magic Missile"],
};

/** Daemonologist Wizard Dwarf (Grim Hollow 2024) */
export const PRESET_FULL_DAEMONOLOGIST_DWARF: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Wizard",
	classSource: "PHB'24",
	prioritySources: ["XPHB", "GrimHollowPG24"],
	background: "Sage",
	bgSource: "PHB'24",
	name: "Mordecai Ashenward",
	skillCount: 2,
	subclassName: "Daemonologist",
	subclassSource: "GH:PG'24",
	namedSubclassChoice: {title: "Fair and Foul", name: "Arch Daemon"},
	signatureSpells: ["Mage Hand", "Magic Missile", "Shield"],
};

/** 8. College of Surrealism Bard Yuan-Ti (TGTT) */
export const PRESET_FULL_SURREALISM_YUANTI: CharacterPreset = {
	race: "Yuan-Ti",
	raceSource: "TGTT",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Sissin Dreamweaver",
	skillCount: 3,
	subclassName: "College of Surrealism",
	subclassSource: "TGTT",
	signatureSpells: ["Vicious Mockery", "Healing Word"],
};

/** 9. Chained Fury Barbarian Minotaur (TGTT) */
export const PRESET_FULL_CHAINED_FURY_MINOTAUR: CharacterPreset = {
	race: "Minotaur",
	raceSource: "TGTT",
	className: "Barbarian",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Korr Ironhorn",
	skillCount: 2,
	masteryCount: 2,
	subclassName: "Path of the Chained Fury",
	subclassSource: "TGTT",
};

/** TDCSR Path of the Juggernaut Barbarian */
export const PRESET_FULL_JUGGERNAUT_BARBARIAN: CharacterPreset = {
	race: "Minotaur",
	raceSource: "TGTT",
	className: "Barbarian",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Kordran Stonewake",
	skillCount: 2,
	masteryCount: 2,
	subclassName: "Path of the Juggernaut",
	subclassSource: "TGTT-2014",
};

/** 10. Time Domain Cleric (TGTT) — race not specified by user; default to a flexible TGTT race. */
export const PRESET_FULL_TIME_CLERIC: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Cleric",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Mira Hourward",
	skillCount: 2,
	subclassName: "Time Domain",
	subclassSource: "TGTT",
	signatureSpells: ["Sacred Flame", "Cure Wounds"],
};

/** 11. Gambler Rogue Clairnian (TGTT) — Spellcasting from L3 (warlock list). */
export const PRESET_FULL_GAMBLER_CLAIRNIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Clairnian",
	className: "Rogue",
	classSource: "TGTT",
	background: "Charlatan",
	bgSource: "PHB'24",
	name: "Faro Luckwell",
	skillCount: 4,
	subclassName: "Gambler",
	subclassSource: "TGTT",
	signatureSpells: ["Eldritch Blast", "Hex"],
};

/** 12. Belly Dancer Rogue Jaknian (TGTT) — Dance of the Country toggle. */
export const PRESET_FULL_BELLY_DANCER_JAKNIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Jaknian",
	className: "Rogue",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Sahar Whirlstep",
	skillCount: 4,
	subclassName: "The Belly Dancer",
	subclassSource: "TGTT",
};

/** 13. Jester Bard Dendulra (TGTT) — Jester's Acts at L3. */
export const PRESET_FULL_JESTER_DENDULRA: CharacterPreset = {
	race: "Dendulra",
	raceSource: "TGTT",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Pip Bellsong",
	skillCount: 3,
	subclassName: "College of Jesters",
	subclassSource: "TGTT",
	signatureSpells: ["Vicious Mockery", "Healing Word"],
};

/** 14. Oath of Bastion Paladin Bugbear (TGTT). */
export const PRESET_FULL_BASTION_BUGBEAR: CharacterPreset = {
	race: "Bugbear",
	raceSource: "TGTT",
	className: "Paladin",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Grom Shieldoath",
	skillCount: 2,
	subclassName: "Oath of Bastion",
	subclassSource: "TGTT",
};

/**
 * 14b. Oath of the Crown Paladin (SCAG, PHB 2014 chassis).
 *
 * `prioritySources: ["PHB"]` keeps the wizard on the 2014 Paladin so the SCAG oath is
 * actually offered at L3; `skipConditionalPrompt` stops Unyielding Spirit's gated save
 * advantage from opening the per-roll opt-in picker mid-probe.
 */
export const PRESET_FULL_CROWN_PALADIN: CharacterPreset = {
	// Dwarf/Acolyte rather than Human/Noble: the 2014+2024 "Human" rows both match
	// `sourceText.includes("PHB")`, and the 2024 Human's mandatory Origin Feat pick is
	// not something `selectAllRacialChoices()` can satisfy, so the wizard stalls on the
	// Species step. Dwarf/PHB + Acolyte/PHB is the proven 2014 pairing.
	race: "Dwarf",
	raceSource: "PHB",
	className: "Paladin",
	classSource: "PHB",
	prioritySources: ["PHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Aldric Crownward",
	skillCount: 2,
	subclassName: "Oath of the Crown",
	subclassSource: "SCAG",
	// Steer the L2 Fighting Style pick to Defense. "Blessed Warrior" chains a
	// cantrip chooser on top of the Fighting Style modal, which is a strictly
	// noisier path to drive.
	preferredFeatProgressionPattern: /^defense\b/i,
};

/** 15. Heroic Soul Sorcerer Half-Ogre (TGTT) — Over Soul + Stamina + Metamagic. */
export const PRESET_FULL_HEROIC_SOUL_HALFOGRE: CharacterPreset = {
	race: "Half-Ogre",
	raceSource: "TGTT",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Kael Heartflame",
	skillCount: 2,
	subclassName: "Heroic Soul",
	subclassSource: "TGTT",
	signatureSpells: ["Fire Bolt", "Magic Missile"],
};

/** 16. Trickster Rogue Goblin (TGTT) — Trickster Dice resource + Tricks. */
export const PRESET_FULL_TRICKSTER_GOBLIN: CharacterPreset = {
	race: "Goblin",
	raceSource: "TGTT",
	className: "Rogue",
	classSource: "TGTT",
	background: "Criminal",
	bgSource: "PHB'24",
	name: "Snik Quickfingers",
	skillCount: 4,
	subclassName: "Trickster",
	subclassSource: "TGTT",
};

/** 17. Lust Domain Cleric Lexalian (TGTT). */
export const PRESET_FULL_LUST_LEXALIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Lexalian",
	className: "Cleric",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Lyra Heartcall",
	skillCount: 2,
	subclassName: "Lust Domain",
	subclassSource: "TGTT",
	signatureSpells: ["Sacred Flame", "Cure Wounds"],
};

/** 18. Horror Warlock Theocracian (TGTT). */
export const PRESET_FULL_HORROR_THEOCRACIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Theocracian",
	className: "Warlock",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Vex Whisperer",
	skillCount: 2,
	subclassName: "The Horror",
	subclassSource: "TGTT",
	signatureSpells: ["Eldritch Blast", "Hex"],
};

/** BH2022 Order of the Lycan Blood Hunter. */
export const PRESET_FULL_LYCAN_BLOOD_HUNTER: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Blood Hunter",
	classSource: "BH2022",
	prioritySources: ["BH2022"],
	skipConditionalPrompt: true,
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Varek Moonfang",
	skillCount: 3,
	optFeatCount: 1,
	subclassName: "Order of the Lycan",
	subclassSource: "BH2022",
	preferredFeatProgressionPattern: /^archery\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/class/Matthew%20Mercer%3B%20Blood%20Hunter%20(2022).json",
	],
};

/** BH2022 Order of the Mutant Blood Hunter — mutagen formulas, benefits AND drawbacks. */
export const PRESET_FULL_MUTANT_BLOOD_HUNTER: CharacterPreset = {
	race: "Human",
	raceSource: "PHB'24",
	className: "Blood Hunter",
	classSource: "BH2022",
	prioritySources: ["BH2022"],
	skipConditionalPrompt: true,
	background: "Sage",
	bgSource: "PHB'24",
	name: "Ysolde Vane",
	skillCount: 3,
	optFeatCount: 1,
	subclassName: "Order of the Mutant",
	subclassSource: "BH2022",
	preferredFeatProgressionPattern: /^dueling\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/class/Matthew%20Mercer%3B%20Blood%20Hunter%20(2022).json",
	],
};

/**
 * BH2022 Order of the Profane Soul Blood Hunter — INT-based Pact Magic on a
 * reduced warlock grid, plus a patron choice that other features key off.
 *
 * Human matches the Lycan and Mutant presets deliberately: the variable under
 * test here is the ORDER, and holding race/chassis constant across the three
 * Blood Hunter specs means a difference in results is attributable to the
 * subclass rather than to racial bonuses.
 */
export const PRESET_FULL_PROFANE_SOUL_BLOOD_HUNTER: CharacterPreset = {
	race: "Human",
	raceSource: "PHB'24",
	className: "Blood Hunter",
	classSource: "BH2022",
	prioritySources: ["BH2022"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Cassian Vole",
	skillCount: 3,
	optFeatCount: 1,
	subclassName: "Order of the Profane Soul",
	subclassSource: "BH2022",
	preferredFeatProgressionPattern: /^dueling\b/i,
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/class/Matthew%20Mercer%3B%20Blood%20Hunter%20(2022).json",
	],
};

/** TalPsi Chronopath Talent (MCDM "The Talent and Psionics") — psionic strain + powers. */
export const PRESET_FULL_TALENT_CHRONOPATH: CharacterPreset = {
	race: "Human",
	raceSource: "PHB'24",
	className: "Talent",
	// `classSource` / `subclassSource` are matched against the source ABBREVIATION the
	// sheet renders, which for this brew is "TAP" (`_meta.sources[0].abbreviation`),
	// not the JSON source key "TalPsi" used by `prioritySources`.
	classSource: "TAP",
	prioritySources: ["TalPsi"],
	skipConditionalPrompt: true,
	background: "Sage",
	bgSource: "PHB'24",
	name: "Ilyra Timeweave",
	skillCount: 2,
	optFeatCount: 1,
	subclassName: "Chronopath",
	subclassSource: "TAP",
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/class/MCDM%20Productions%3B%20The%20Talent%20and%20Psionics.json",
	],
};

/**
 * Beastheart — Protector Bond (MCDM "Beastheart and Monstrous Companions", BST).
 *
 * Protector is chosen over the other four bonds because it is the most mechanically
 * concrete: Beast Vitality moves the companion's HP by the character's level,
 * Thickened Hide moves its AC by a fixed +2, and Undying Protector has an escalating
 * ferocity cost — three independently observable numbers, where (say) Ferocious's
 * rampage riders only manifest mid-rampage.
 *
 * WIS-first because Superior Ferocity's exploit save DC and three of the class's
 * rest pools are all Wisdom-derived; a WIS-10 Beastheart would make several features
 * indistinguishable from doing nothing.
 */
export const PRESET_FULL_BEASTHEART_PROTECTOR: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Beastheart",
	// Matched against the abbreviation the sheet renders (`_meta.sources[0].abbreviation`).
	classSource: "BST",
	prioritySources: ["BST"],
	skipConditionalPrompt: true,
	background: "Outlander",
	bgSource: "PHB",
	name: "Ordrek Houndsworn",
	skillCount: 2,
	abilityPriority: ["wis", "con", "str", "dex", "cha", "int"],
	subclassName: "Protector",
	subclassSource: "BST",
	homebrewUrls: [
		"https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/class/MCDM%20Productions%3B%20Beastheart.json",
	],
};

/** School of Necromancy Wizard (PHB subclass via TGTT-2014). */
export const PRESET_FULL_NECROMANCER_WIZARD: CharacterPreset = {
	race: "Human",
	raceSource: "PHB'24",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Malifar Boneweaver",
	skillCount: 2,
	subclassName: "School of Necromancy",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Chill Touch", "False Life"],
};

/**
 * Arcana Domain Cleric (SCAG, PHB 2014 chassis).
 *
 * `abilityPriority` puts the standard array's 15 in WISDOM. The harness default is
 * STR-first, which would leave this cleric at WIS 10 (+0) and make Potent Spellcasting's
 * "+WIS to cantrip damage" indistinguishable from the feature doing nothing.
 *
 * Dwarf/Acolyte (both PHB) is the proven 2014 pairing — see PRESET_FULL_CROWN_PALADIN
 * for why "Human" stalls the Species step.
 */
export const PRESET_FULL_ARCANA_CLERIC: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Cleric",
	classSource: "PHB",
	prioritySources: ["PHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Yssira Runekeeper",
	skillCount: 2,
	abilityPriority: ["wis", "con", "str", "dex", "int", "cha"],
	subclassName: "Arcana Domain",
	subclassSource: "SCAG",
	signatureSpells: ["Sacred Flame", "Bless", "Cure Wounds"],
};

/**
 * Shadow Magic Sorcerer (XGE subclass on the PHB-2014 Sorcerer chassis).
 *
 * PHB rather than TGTT deliberately: `Shadow Magic` carries `classSource: "PHB"`, PHB
 * Sorcerer picks its Sorcerous Origin at LEVEL 1 (so the subclass is online for the whole
 * ladder), and the PHB chassis keeps the TGTT Specialty / passive-Metamagic pickers out of
 * the way of the subclass probes.
 *
 * Dwarf/Acolyte for the same reason as the Crown Paladin: the 2024 Human's mandatory
 * Origin Feat pick stalls the Species step.
 */
export const PRESET_FULL_SHADOW_MAGIC_SORCERER: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Sorcerer",
	classSource: "PHB",
	prioritySources: ["PHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Nyx Duskwhisper",
	skillCount: 2,
	subclassName: "Shadow Magic",
	subclassSource: "XGE",
	// CS-BUG-056: without this the standard array is assigned STR-first and the Sorcerer
	// lands on CHA 8 — which would make the Strength of the Grave save modifier, every
	// spell save DC and the Umbral Form / Hound costs unrepresentative.
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	signatureSpells: ["Fire Bolt", "Shield"],
};

/**
 * Sorcerer / Shadow Sorcery (RHW) — the 2024 rework of Shadow Magic, on the **XPHB**
 * chassis (Innate Sorcery at 1, subclass at 3, Sorcery Points = level).
 *
 * `shortName` is `"Shadow"` for THREE sorcerer subclasses (`Shadow Magic|XGE` twice,
 * once per classSource, and this one), so the shorthand spawner is ambiguous here and
 * both `subclassName` AND `subclassSource` are mandatory — the *names* differ, so the
 * name+source pair is unambiguous where the shortName is not.
 *
 * `prioritySources: ["XPHB"]` is likewise load-bearing: the sheet's source filter
 * otherwise reduces `Sorcerer` to `Sorcerer|TGTT`, which carries its own 69-subclass
 * list and a `level + 1` Sorcery Point progression — i.e. the wrong chassis.
 */
export const PRESET_FULL_SHADOW_SORCERY_RHW_SORCERER: CharacterPreset = {
	race: "Human",
	// The wizard labels 2024 content `PHB'24`, not `XPHB` — `selectRaceExact` matches
	// the rendered label, so the abbreviation that works in data does NOT work here.
	raceSource: "PHB'24",
	className: "Sorcerer",
	classSource: "PHB'24",
	prioritySources: ["XPHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Vess Nightpall",
	skillCount: 2,
	optFeatCount: 1,
	subclassName: "Shadow Sorcery",
	subclassSource: "RHW",
	// CS-BUG-056: without this the standard array is assigned STR-first and the Sorcerer
	// lands on CHA 8 — which would make every spell save DC and, critically, the
	// Strength of the Grave hit point total (CHA mod + Sorcerer level) unrepresentative.
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	signatureSpells: ["Fire Bolt", "Shield"],
};

/**
 * Spellfire Sorcery Sorcerer (FRHoF subclass on the XPHB / 2024 Sorcerer chassis).
 *
 * Unlike Shadow Magic (a 2014 PHB origin online from L1), Spellfire is a 2024 subclass and
 * is therefore selected at LEVEL 3 — the factory handles the L3 subclass arrival exactly as
 * it does for the XPHB Light Cleric and Sea Druid.
 *
 * `classSource: "PHB'24"` selects the XPHB Sorcerer; `subclassSource: "FRHoF"` selects the
 * Spellfire Sorcery subclass (its `classSource` is XPHB). `optFeatCount: 1` accounts for the
 * 2024 Background's Origin Feat. Dwarf/Acolyte for the same reason as the other 2024 presets:
 * the 2024 Human's mandatory extra Origin-Feat pick stalls the Species step.
 *
 * CS-BUG-056: `abilityPriority` pins CHA first (else the standard array lands the Sorcerer on
 * CHA 8, making every save DC, the Bolstering Flames Temp HP total and Burning Life Force cap
 * unrepresentative). DEX/CON stay at 14/13 so HP, AC and initiative are untouched.
 */
export const PRESET_FULL_SPELLFIRE_SORCERER: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Sorcerer",
	classSource: "PHB'24",
	prioritySources: ["XPHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Ember Weavefire",
	skillCount: 2,
	optFeatCount: 1,
	subclassName: "Spellfire Sorcery",
	subclassSource: "FRHoF",
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	signatureSpells: ["Fire Bolt", "Shield"],
};

/**
 * Wicked Witch Sorcerer (Arcadia 8 subclass re-parented onto the TGTT Sorcerer chassis).
 *
 * The subclass reaches the sheet as a `_copy` in `homebrew/TravelersGuidetoThelemar.json`
 * (`source: "TGTT-AR"`, `classSource: "TGTT"`) of `Wicked Witch Sorcerous Origin|Ar8`,
 * so BOTH brews must be loaded: Thelemar via the sheet's own `homebrew/index.json`
 * fan-out (which already lists every Arcadia issue), and nothing extra here — supplying
 * `homebrewUrls` would SUPPRESS the fan-out and break the copy target.
 *
 * `subclassSource` is the source ABBREVIATION the sheet renders for `TGTT-AR`, which is
 * `"AR"` (`_meta.sources[3].abbreviation`), not the JSON key.
 *
 * Chassis consequences (they differ from every PHB-Sorcerer preset):
 *   - Sorcerous Origin arrives at **level 3**, not level 1.
 *   - Font of Magic is a **level 1** feature, so Sorcery Points = `level + 1` from L1
 *     (`CharacterSheetState.getSorceryPointsMaxForClass()`).
 *   - The chassis adds its own Specialty (L4/8/12/16/20) and Metamagic pickers.
 */
export const PRESET_FULL_WICKED_WITCH_SORCERER: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Sorcerer",
	classSource: "TGTT",
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Morgath Thornwhistle",
	skillCount: 2,
	subclassName: "Wicked Witch Sorcerous Origin",
	subclassSource: "AR",
	// CS-BUG-056: the standard array is otherwise assigned STR-first, landing the Sorcerer
	// on CHA 8 — which would make every spell save DC and the Clever Little Witch
	// reflection DC unrepresentative.
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	// Matched to PRESET_FULL_CHILD_OF_SUN_HOCHLING, the other TGTT-chassis sorcerer:
	// the TGTT spell picker does not surface "Shield" in the L1 view, and the retry
	// loop that chases it costs the L1 round-trip test most of its 60 s budget.
	signatureSpells: ["Fire Bolt", "Burning Hands"],
};

/**
 * Lunar Sorcery Sorcerer (DSotDQ subclass on the PHB-2014 Sorcerer chassis).
 *
 * PHB rather than XPHB deliberately: `Lunar Sorcery` exists for BOTH `classSource`
 * values, but the XPHB copy is pinned to level 3 while the PHB one is online at LEVEL 1
 * — so on the PHB chassis every feature gate is a plain sorcerer-level gate and the
 * L1→L20 matrix covers all seven features. It also keeps the TGTT Specialty / passive
 * Metamagic pickers out of the way of the subclass probes.
 *
 * Dwarf/Acolyte for the same reason as the Shadow Magic Sorcerer: the 2024 Human's
 * mandatory Origin Feat pick stalls the Species step.
 */
export const PRESET_FULL_LUNAR_SORCERY_SORCERER: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB",
	className: "Sorcerer",
	classSource: "PHB",
	prioritySources: ["PHB"],
	skipConditionalPrompt: true,
	background: "Acolyte",
	bgSource: "PHB",
	name: "Selene Tidewane",
	skillCount: 2,
	subclassName: "Lunar Sorcery",
	subclassSource: "DSotDQ",
	// CS-BUG-056: without this the standard array is assigned STR-first and the Sorcerer
	// lands on CHA 8 — which would make every spell save DC, and therefore the Lunar
	// Phenomenon save DC, unrepresentative.
	abilityPriority: ["cha", "con", "dex", "wis", "int", "str"],
	signatureSpells: ["Fire Bolt", "Shield"],
};

/** Convenience array of all comprehensive presets — handy for parameterised smoke tests. */
export const PRESETS_FULL_PARTY: CharacterPreset[] = [
	PRESET_FULL_MERCY_MONK_CHANGELING,
	PRESET_FULL_SUN_SOUL_MONK_CHANGELING,
	PRESET_FULL_ARCANE_ARCHER_HOCHLING,
	PRESET_FULL_BLADESINGER_TABAXI,
	PRESET_FULL_HUNTER_CENTAUR,
	PRESET_FULL_ZODIAC_CENTAUR,
	PRESET_FULL_HEX_DIVINE_TORTLE,
	PRESET_FULL_CHILD_OF_SUN_HOCHLING,
	PRESET_FULL_CHRONURGY_NYUIDJ,
	PRESET_FULL_SURREALISM_YUANTI,
	PRESET_FULL_CHAINED_FURY_MINOTAUR,
	PRESET_FULL_TIME_CLERIC,
	PRESET_FULL_GAMBLER_CLAIRNIAN,
	PRESET_FULL_BELLY_DANCER_JAKNIAN,
	PRESET_FULL_JESTER_DENDULRA,
	PRESET_FULL_BASTION_BUGBEAR,
	PRESET_FULL_CROWN_PALADIN,
	PRESET_FULL_HEROIC_SOUL_HALFOGRE,
	PRESET_FULL_TRICKSTER_GOBLIN,
	PRESET_FULL_LUST_LEXALIAN,
	PRESET_FULL_HORROR_THEOCRACIAN,
	PRESET_FULL_CREATION_BARD_CHANGELING,
	PRESET_FULL_ARCANA_CLERIC,
	PRESET_FULL_BEASTHEART_PROTECTOR,
	PRESET_FULL_SHADOW_MAGIC_SORCERER,
	PRESET_FULL_SHADOW_SORCERY_RHW_SORCERER,
	PRESET_FULL_SPELLFIRE_SORCERER,
	PRESET_FULL_WICKED_WITCH_SORCERER,
	PRESET_FULL_LUNAR_SORCERY_SORCERER,
];

/**
 * Build a complete character via the Builder Wizard UI.
 * Returns the CharacterSheetPage for further interaction.
 */
export async function createCharacterViaWizard (
	page: Page,
	preset: CharacterPreset = PRESET_FIGHTER,
): Promise<{charSheet: CharacterSheetPage; builder: BuilderWizardPage}> {
	const charSheet = new CharacterSheetPage(page);
	const builder = new BuilderWizardPage(page);

	await charSheet.goto();

	// CRITICAL: the wizard must run against an actual character record.
	// Just switching to the builder tab does NOT create a character — the
	// page only assigns a `_currentCharacterId` when the user clicks the
	// "+" New Character button (or selects an existing one). Without an
	// id, `_saveCurrentCharacter()` early-returns, so the wizard's final
	// "Finish" never persists. The sheet then renders the in-memory state
	// (so L1 assertions pass) but `#charsheet-name-select` remains on the
	// "Create New Character" placeholder, breaking every later flow that
	// depends on a loaded character (Level Up, Multiclass, etc.).
	await page.locator("#charsheet-btn-new").click();
	if (preset.prioritySources?.length) await charSheet.setPrioritySources(preset.prioritySources);
	if (preset.skipConditionalPrompt) await charSheet.setStateSetting("skipConditionalPrompt", true);
	await charSheet.switchToTab(charSheet.tabBuilder);

	// Builder steps (current order, see js/charactersheet/charactersheet-builder.js
	// `_renderStepContent`): 0. Name → 1. Race → 2. Background → 3. Class →
	// 4. Abilities → 5. Equipment → 6. Spells → 7. Details.
	//
	// Step 0 was added in 4f059f9a; the harness previously jumped straight to
	// the Race step and stalled on `#builder-race-list` forever (CS-BUG-025).
	// `completeNameStep` is a no-op if the step is absent, so this stays
	// correct if the order changes again.

	// Step 0: Name
	await builder.completeNameStep(preset.name);

	// Step 1: Race
	await builder.selectRaceExact(preset.race, preset.raceSource);
	await page.waitForTimeout(300);
	if (preset.subrace) {
		// Some races (Children of the Empire, Genasi, etc.) defer their
		// stat-relevant choices to a subrace dropdown that appears in the
		// race preview pane after the parent row is clicked.
		if (await builder.hasSubraceSelection()) {
			await builder.selectSubrace(preset.subrace);
		}
	}
	// Race may require sub-choices (skill/tool/language picks) — satisfy
	// validation before clicking Next.  No-op for races without choices.
	await builder.selectAllRacialChoices();
	await builder.clickNext();

	// Step 2: Background
	await builder.selectBackgroundExact(preset.background, preset.bgSource);
	// Backgrounds (esp. 2024) may have skill/tool/feat sub-pickers — these
	// are harmless no-ops if the background has no choices.
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 3: Class
	await builder.selectClassExact(preset.className, preset.classSource);
	if (preset.quickBuildTargetLevel != null) {
		await builder.setQuickBuildTargetLevel(preset.quickBuildTargetLevel);
	}
	await page.waitForTimeout(500);
	// Classes whose subclass arrives at LEVEL 1 (PHB-2014 Sorcerer / Warlock / Cleric /
	// Druid) render the choice right here in the Class step. It must be picked BEFORE the
	// skill / optional-feature pickers, because selecting it can add its own sub-pickers.
	// No-op for every class that gains its subclass later.
	if (preset.subclassName && await builder.hasLevel1SubclassSelection()) {
		await builder.selectLevel1Subclass(preset.subclassName, preset.subclassSource);
	}
	if (preset.skillCount) {
		await builder.selectFirstAvailableSkills(preset.skillCount);
	}
	// Presets' `skillCount` can under-count what the class grants; top up from
	// the live counter so the picker never silently gates Next.
	await builder.topUpClassSkillsToRequired();
	// Expertise (Rogue / Bard / TGTT-Ranger) — must come AFTER class skills
	// are picked so the expertise list isn't empty.
	await builder.selectFirstAvailableExpertise(4);
	// Class-feature language grants (e.g. Ranger Deft Explorer)
	await builder.selectAllClassFeatureLanguages();
	if (preset.masteryCount) {
		await builder.selectFirstAvailableWeaponMasteries(preset.masteryCount);
	} else {
		// Fighter/Paladin/Ranger/Rogue (and TGTT variants) require weapon
		// masteries even when the test preset doesn't request a specific
		// count. Selecting up to 3 is safe — the picker caps itself.
		await builder.selectFirstAvailableWeaponMasteries(3);
	}
	if (preset.optFeatCount) {
		await builder.selectFirstAvailableOptionalFeatures(preset.optFeatCount);
	} else {
		// TGTT Warlock starts with Eldritch Invocations at L1 (etc.) so
		// always attempt to fill any optional-feature picker that's present.
		await builder.selectFirstAvailableOptionalFeatures(5);
	}
	// A class can open with SEVERAL required optional-feature groups (MCDM's
	// Talent has two power pickers at level 1 on top of its skill picker), which
	// the count-based helper above under-fills. Top each group up to its own
	// declared count so Next is never silently gated.
	await builder.topUpOptionalFeatureGroupsToRequired();
	// TGTT Fighter / Paladin / etc. expose Combat Traditions + Methods
	// pickers under the optional-features region — these gate Next when
	// unfilled. The helper is a no-op when the section is absent.
	await builder.selectCombatTraditionsAndMethods();
	// Class-feat progressions (Fighter "Class Feats" etc.) render as required
	// dropdowns that block Next until each slot holds a fully-specified feat.
	await builder.selectClassFeatProgressions(30, preset.preferredFeatProgressionPattern);
	// Always try feature options (harmless if none exist)
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 4: Abilities
	await builder.assignStandardArrayDefaults(preset.abilityPriority);
	await builder.clickNext();

	// Step 5: Equipment — take gold (simplest)
	await builder.selectEquipmentOption("gold");
	await builder.clickNext();

	// Step 6: Spells (renders for every class; only spellcasters have a
	// "Starting Spells" heading, but the wizard still has a Next button to
	// advance to step 7 either way).
	// CS-BUG-016: `signatureSpells` is documented as applying "during
	// creation / level-up" but had only ever been passed to level-up, so
	// L1 builds took an alphabetical auto-pick (or, before the picker
	// driver was fixed, nothing at all).
	await builder.autoFillStartingSpells({
		divineSoulAffinity: preset.divineSoulAffinity,
		signatureSpells: preset.signatureSpells,
	});
	await builder.clickNext();
	// If we under-filled spells/cantrips, the wizard pops a "Skip Spell
	// Selection?" confirmation modal — accept it so we reach Details.
	await builder.acceptSkipSpellsDialog();

	// Step 7: Details
	await builder.fillDetails({name: preset.name});
	await builder.finishWizard();

	// Confirm the character actually saved & became the active record.
	// `_finishCharacter` calls `saveCharacter()` then switches to the
	// overview tab — both async. Without this wait, downstream steps
	// (Level Up, etc.) operate against a not-yet-loaded character.
	// (Note: the builder doesn't refresh `#charsheet-sel-character` after
	// save, so we don't assert on the dropdown here — only on the
	// in-memory state, which is what every other module reads.)
	//
	// The class check matters: the name is set by the wizard's FIRST step, so
	// a name-only guard also passes when the wizard silently stalled partway
	// (e.g. blocked by an unfilled required picker) and never finished.
	await page.waitForFunction(
		(name) => {
			const cs: any = (globalThis as any).charSheet;
			if (!cs?._currentCharacterId) return false;
			if (cs?._state?.getName?.() !== name) return false;
			return (cs?._state?.getClasses?.() || []).length > 0;
		},
		preset.name,
		{timeout: 10_000},
	);

	return {charSheet, builder};
}

/**
 * Level a character up from their current level to a target level.
 * Each level: clicks Level Up, auto-fills all selections (HP average,
 * first available skills/feats/spells), and finishes.
 *
 * If a subclass needs selecting (e.g. level 3), pass `subclassName`.
 * Pass `signatureSpells` to deterministically tick named spells before
 * the auto-fill step picks the first-available remainder.
 */
/**
 * After clicking the Level Up button on a multiclass character, the
 * runtime opens an `InputUiUtil.pGetUserEnum` modal asking which class
 * to advance. This helper picks the class deterministically and clicks
 * OK so the actual level-up wizard appears.
 *
 * If `targetClassName` is provided, picks that class. Otherwise picks
 * the LAST class in the dropdown — which matches the most-recently
 * added multiclass leg (so consecutive level-ups in a multiclass plan
 * land on the new class).
 *
 * Returns immediately (no-op) if no picker modal opens (single-class
 * characters skip the picker entirely). Bounded ~1.5s.
 */
export async function pHandleLevelUpClassPicker (page: Page, targetClassName?: string): Promise<void> {
	// The picker modal is the InputUiUtil enum dialog: a `<select>`
	// inside a modal whose only contents are the select + OK/Cancel.
	// Crucially it does NOT contain `.charsheet__levelup-wizard` —
	// that's how we tell the picker apart from the real wizard.
	const picker = await page.waitForFunction(
		() => {
			const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => m.offsetParent !== null);
			for (const m of inners) {
				if (m.querySelector(".charsheet__levelup-wizard")) continue;
				const sel = m.querySelector<HTMLSelectElement>("select");
				if (sel && sel.options.length > 1) return true;
			}
			return false;
		},
		{timeout: 1500},
	).then(() => true).catch(() => false);

	if (!picker) {
		(globalThis as unknown as {__lastPickerSeen?: boolean}).__lastPickerSeen = false;
		return;
	}
	(globalThis as unknown as {__lastPickerSeen?: boolean}).__lastPickerSeen = true;

	await page.evaluate((wantClassName) => {
		const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
			.filter(m => m.offsetParent !== null);
		for (const m of inners) {
			if (m.querySelector(".charsheet__levelup-wizard")) continue;
			const sel = m.querySelector<HTMLSelectElement>("select");
			if (!sel) continue;
			const realOpts = Array.from(sel.options).filter(o => o.value !== "-1");
			if (!realOpts.length) continue;
			let chosen: HTMLOptionElement | undefined;
			if (wantClassName) {
				const re = new RegExp(`\\b${wantClassName}\\b`, "i");
				chosen = realOpts.find(o => re.test(o.textContent || ""));
			}
			if (!chosen) chosen = realOpts[realOpts.length - 1];
			sel.value = chosen.value;
			sel.dispatchEvent(new Event("change", {bubbles: true}));
			const okBtn = Array.from(m.querySelectorAll<HTMLButtonElement>("button"))
				.find(b => /\bOK\b|\bConfirm\b/i.test(b.textContent || ""));
			if (okBtn) okBtn.click();
			return;
		}
	}, targetClassName);

	await page.waitForTimeout(200);
}


export async function levelUpTo (
	page: Page,
	targetLevel: number,
	opts?: {subclassName?: string; subclassSource?: string; namedSubclassChoice?: {title: string; name: string}; signatureSpells?: string[]; targetClassName?: string; preferredFeatProgressionPattern?: RegExp},
): Promise<void> {
	const charSheet = new CharacterSheetPage(page);
	const levelUp = new LevelUpPage(page);

	// Read current level from the live state (single source of truth).
	// DOM-based selectors here historically defaulted to 1 when they
	// missed (the real element is `#charsheet-disp-level`), causing
	// consecutive `levelUpTo` calls to overshoot by re-levelling from L1.
	const startLevel = await page.evaluate(() => {
		const cs: any = (globalThis as any).charSheet;
		const fromState = cs?._state?.getTotalLevel?.();
		if (typeof fromState === "number" && fromState >= 1) return fromState;
		const el = document.getElementById("charsheet-disp-level")
			|| document.querySelector("[data-testid='charsheet-level']")
			|| document.querySelector(".charsheet__header-level");
		const match = el?.textContent?.match(/(\d+)/);
		return match ? parseInt(match[1], 10) : 1;
	});

	if (targetLevel <= startLevel) return;

	for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
		const t0 = Date.now();
		if (page.isClosed()) throw new Error(`levelUpTo: page closed before reaching L${lvl} (last reached L${lvl - 1})`);

		// A feature-choice prompt left over from the previous level blocks this
		// one's wizard from closing — clear it before opening the next.
		await levelUp.resolvePendingFeatureChoices();

		// When `opts.targetClassName` is provided, bypass the Level Up
		// button entirely and call the production API directly. This
		// sidesteps the multiclass class-picker modal that
		// `pGetUserEnum` otherwise raises (and which played havoc with
		// our DOM-based wait loop on multiclass characters).
		if (opts?.targetClassName) {
			await page.evaluate(async (cls) => {
				const cs: any = (globalThis as any).charSheet;
				if (!cs?._levelUp?.showLevelUp) throw new Error("charSheet._levelUp.showLevelUp unavailable");
				await cs._levelUp.showLevelUp(cls);
			}, opts.targetClassName);
			await page.waitForTimeout(200);
		} else {
			await charSheet.btnLevelUp.waitFor({state: "visible", timeout: 5000});
			// A feature-choice modal raised ASYNCHRONOUSLY by the previous
			// level (PHB'14 Fighting Style at Paladin/Ranger L2, Fighter L1,
			// …) lands after `resolvePendingFeatureChoices()` above has
			// already run, and its overlay then swallows every click on the
			// Level Up button — the run dies with a 15-minute
			// "subtree intercepts pointer events" retry loop rather than a
			// useful error. Resolve-and-retry instead of clicking blind.
			for (let attempt = 0; ; attempt++) {
				try {
					await charSheet.btnLevelUp.click({timeout: 5000});
					break;
				} catch (e) {
					// The click may have ALREADY landed. Playwright re-checks
					// actionability after dispatching, so the wizard's own
					// overlay animating in covers the button and a SUCCESSFUL
					// click is reported as "subtree intercepts pointer events".
					// Retrying then blocks forever against the very modal we
					// asked for — the button is now permanently covered — and
					// the run dies 5 attempts later pointing at the wizard as
					// if it were a stray leftover. Treat an open wizard as the
					// success it is, before attributing the failure to an
					// unresolved feature choice.
					const wizardUp = await page.locator(".charsheet__levelup-wizard").isVisible().catch(() => false);
					if (wizardUp) break;
					if (attempt >= 4) throw e;
					await levelUp.resolvePendingFeatureChoices();
					await page.waitForTimeout(400);
				}
			}
			await page.waitForTimeout(300);
			// Only single-class characters reach this branch in normal
			// flow (multiclass tests pass `targetClassName` and use the
			// API path above). For safety against unexpected pickers we
			// still detect the picker modal — but only if it appears
			// BEFORE the wizard renders, so we never race against the
			// wizard's own select elements (HP option, subclass picker).
			const wizardOpen = await page.locator(".charsheet__levelup-wizard").isVisible().catch(() => false);
			if (!wizardOpen) await pHandleLevelUpClassPicker(page, opts?.targetClassName);
		}

		// Wait for the level-up modal
		await levelUp.waitForModal();

		// If subclass selection is available and we have a name, select it
		if (opts?.subclassName && await levelUp.isAccordionVisible("subclass")) {
			await levelUp.expandAccordion("subclass");
			await levelUp.selectSubclass(opts.subclassName, opts.subclassSource);
			if (opts.namedSubclassChoice) {
				await levelUp.selectNamedSubclassChoice(opts.namedSubclassChoice.title, opts.namedSubclassChoice.name);
			}
		}

		// HP: take average (most reliable for deterministic tests)
		if (await levelUp.isAccordionVisible("hp")) {
			await levelUp.expandAccordion("hp");
			await levelUp.selectHpOption("average");
		}

		// Try signature spells before the generic auto-fill so they win.
		if (opts?.signatureSpells?.length && await levelUp.isAccordionVisible("knownspells")) {
			await levelUp.expandAccordion("knownspells");
			const {pickSignatureSpells} = await import("./comprehensiveBuildHelpers");
			await pickSignatureSpells(page, opts.signatureSpells);
		}

		// Auto-fill all remaining selections (skills, spells, feats, etc.)
		await levelUp.autoFillAllSelections({
			preferredFeatProgressionPattern: opts?.preferredFeatProgressionPattern,
			signatureSpells: opts?.signatureSpells,
		});

		// Finish this level
		await levelUp.finish();
		await levelUp.resolvePendingFeatureChoices();
		await levelUp.expectModalClosed();
		await page.waitForTimeout(100);

		// Confirm the level actually advanced. If not, the wizard rejected
		// `finish()` (e.g. silent toast about an unfilled required choice)
		// and we'd otherwise spin up another level-up against the same
		// state. Surface this immediately.
		await page.waitForFunction(
			(expected) => {
				const cs: any = (globalThis as any).charSheet;
				return (cs?._state?.getTotalLevel?.() ?? 0) >= expected;
			},
			lvl,
			{timeout: 10_000},
		).catch(async () => {
			const got = await page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				return {
					level: cs?._state?.getTotalLevel?.() ?? null,
					name: cs?._state?.getName?.() ?? null,
					id: cs?._currentCharacterId ?? null,
					selValue: (document.getElementById("charsheet-sel-character") as HTMLSelectElement | null)?.value ?? null,
				};
			});
			throw new Error(
				`level-up to ${lvl} did not take effect. sheet state=${JSON.stringify(got)}`,
			);
		});
		// eslint-disable-next-line no-console
		console.log(`[levelUpTo] reached L${lvl} in ${Date.now() - t0}ms`);
	}
}
