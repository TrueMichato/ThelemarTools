/**
 * Random Character Generator for Testing
 *
 * Creates a level-1 character of a chosen class with randomised race,
 * background, ability scores, proficiencies, and spells (when applicable).
 *
 * Usage:
 *   import { RandomCharacterGenerator } from "./CharacterSheetRandomGen.js";
 *   const gen = new RandomCharacterGenerator();
 *   const state = gen.create("Wizard");              // random race, bg, scores, spells
 *   const state2 = gen.create("Fighter", { seed: 42 }); // reproducible
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ── Static Data ──────────────────────────────────────────────────────────────

const RACES = [
	{race: {name: "Human", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Dwarvish"], abilityBonuses: {str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1}},
	{race: {name: "Elf", source: "PHB"}, subrace: {name: "High Elf", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Elvish"], abilityBonuses: {dex: 2, int: 1}, darkvision: 60, skillProfs: ["perception"]},
	{race: {name: "Elf", source: "PHB"}, subrace: {name: "Wood Elf", source: "PHB"}, speed: 35, size: "medium", languages: ["Common", "Elvish"], abilityBonuses: {dex: 2, wis: 1}, darkvision: 60, skillProfs: ["perception"]},
	{race: {name: "Dwarf", source: "PHB"}, subrace: {name: "Hill Dwarf", source: "PHB"}, speed: 25, size: "medium", languages: ["Common", "Dwarvish"], abilityBonuses: {con: 2, wis: 1}, darkvision: 60},
	{race: {name: "Dwarf", source: "PHB"}, subrace: {name: "Mountain Dwarf", source: "PHB"}, speed: 25, size: "medium", languages: ["Common", "Dwarvish"], abilityBonuses: {con: 2, str: 2}, darkvision: 60},
	{race: {name: "Halfling", source: "PHB"}, subrace: {name: "Lightfoot", source: "PHB"}, speed: 25, size: "small", languages: ["Common", "Halfling"], abilityBonuses: {dex: 2, cha: 1}},
	{race: {name: "Halfling", source: "PHB"}, subrace: {name: "Stout", source: "PHB"}, speed: 25, size: "small", languages: ["Common", "Halfling"], abilityBonuses: {dex: 2, con: 1}},
	{race: {name: "Dragonborn", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Draconic"], abilityBonuses: {str: 2, cha: 1}},
	{race: {name: "Gnome", source: "PHB"}, subrace: {name: "Rock Gnome", source: "PHB"}, speed: 25, size: "small", languages: ["Common", "Gnomish"], abilityBonuses: {int: 2, con: 1}, darkvision: 60},
	{race: {name: "Half-Elf", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Elvish"], abilityBonuses: {cha: 2, dex: 1, con: 0}, darkvision: 60, bonusAbilityChoices: 2},
	{race: {name: "Half-Orc", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Orc"], abilityBonuses: {str: 2, con: 1}, darkvision: 60, skillProfs: ["intimidation"]},
	{race: {name: "Tiefling", source: "PHB"}, speed: 30, size: "medium", languages: ["Common", "Infernal"], abilityBonuses: {cha: 2, int: 1}, darkvision: 60},
];

const BACKGROUNDS = [
	{name: "Acolyte", source: "PHB", skillProfs: ["insight", "religion"], languages: 2, toolProfs: []},
	{name: "Criminal", source: "PHB", skillProfs: ["deception", "stealth"], languages: 0, toolProfs: ["Thieves' tools", "Gaming set"]},
	{name: "Folk Hero", source: "PHB", skillProfs: ["animal handling", "survival"], languages: 0, toolProfs: ["Artisan's tools", "Vehicles (land)"]},
	{name: "Noble", source: "PHB", skillProfs: ["history", "persuasion"], languages: 1, toolProfs: ["Gaming set"]},
	{name: "Sage", source: "PHB", skillProfs: ["arcana", "history"], languages: 2, toolProfs: []},
	{name: "Soldier", source: "PHB", skillProfs: ["athletics", "intimidation"], languages: 0, toolProfs: ["Gaming set", "Vehicles (land)"]},
	{name: "Hermit", source: "PHB", skillProfs: ["medicine", "religion"], languages: 1, toolProfs: ["Herbalism kit"]},
	{name: "Outlander", source: "PHB", skillProfs: ["athletics", "survival"], languages: 1, toolProfs: ["Musical instrument"]},
	{name: "Entertainer", source: "PHB", skillProfs: ["acrobatics", "performance"], languages: 0, toolProfs: ["Disguise kit", "Musical instrument"]},
	{name: "Charlatan", source: "PHB", skillProfs: ["deception", "sleight of hand"], languages: 0, toolProfs: ["Disguise kit", "Forgery kit"]},
];

const EXTRA_LANGUAGES = ["Elvish", "Dwarvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc", "Abyssal", "Celestial", "Deep Speech", "Draconic", "Infernal", "Primordial", "Sylvan", "Undercommon"];

const ALL_SKILLS = [
	"acrobatics", "animal handling", "arcana", "athletics", "deception",
	"history", "insight", "intimidation", "investigation", "medicine",
	"nature", "perception", "performance", "persuasion", "religion",
	"sleight of hand", "stealth", "survival",
];

// Class definitions: proficiencies, spellcasting, save proficiencies, hit die, skill choices
const CLASS_DEFS = {
	Barbarian: {
		source: "PHB",
		hitDie: "d12",
		saves: ["str", "con"],
		armorProfs: ["Light armor", "Medium armor", "Shields"],
		weaponProfs: ["Simple weapons", "Martial weapons"],
		skillCount: 2,
		skillChoices: ["animal handling", "athletics", "intimidation", "nature", "perception", "survival"],
		casterType: null,
	},
	Bard: {
		source: "PHB",
		hitDie: "d8",
		saves: ["dex", "cha"],
		armorProfs: ["Light armor"],
		weaponProfs: ["Simple weapons", "Hand crossbows", "Longswords", "Rapiers", "Shortswords"],
		toolProfs: ["Musical instrument"],
		skillCount: 3,
		skillChoices: ALL_SKILLS, // Bard can choose any 3
		casterType: "full",
		castingAbility: "cha",
		cantripsKnown: 2,
		spellsKnown: 4,
		maxSpellLevel: 1,
	},
	Cleric: {
		source: "PHB",
		hitDie: "d8",
		saves: ["wis", "cha"],
		armorProfs: ["Light armor", "Medium armor", "Shields"],
		weaponProfs: ["Simple weapons"],
		skillCount: 2,
		skillChoices: ["history", "insight", "medicine", "persuasion", "religion"],
		casterType: "full",
		castingAbility: "wis",
		cantripsKnown: 3,
		preparedCaster: true,
		maxSpellLevel: 1,
	},
	Druid: {
		source: "PHB",
		hitDie: "d8",
		saves: ["int", "wis"],
		armorProfs: ["Light armor", "Medium armor", "Shields"],
		weaponProfs: ["Clubs", "Daggers", "Darts", "Javelins", "Maces", "Quarterstaffs", "Scimitars", "Sickles", "Slings", "Spears"],
		toolProfs: ["Herbalism kit"],
		skillCount: 2,
		skillChoices: ["arcana", "animal handling", "insight", "medicine", "nature", "perception", "religion", "survival"],
		casterType: "full",
		castingAbility: "wis",
		cantripsKnown: 2,
		preparedCaster: true,
		maxSpellLevel: 1,
	},
	Fighter: {
		source: "PHB",
		hitDie: "d10",
		saves: ["str", "con"],
		armorProfs: ["Light armor", "Medium armor", "Heavy armor", "Shields"],
		weaponProfs: ["Simple weapons", "Martial weapons"],
		skillCount: 2,
		skillChoices: ["acrobatics", "animal handling", "athletics", "history", "insight", "intimidation", "perception", "survival"],
		casterType: null,
	},
	Monk: {
		source: "PHB",
		hitDie: "d8",
		saves: ["str", "dex"],
		armorProfs: [],
		weaponProfs: ["Simple weapons", "Shortswords"],
		skillCount: 2,
		skillChoices: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"],
		casterType: null,
	},
	Paladin: {
		source: "PHB",
		hitDie: "d10",
		saves: ["wis", "cha"],
		armorProfs: ["Light armor", "Medium armor", "Heavy armor", "Shields"],
		weaponProfs: ["Simple weapons", "Martial weapons"],
		skillCount: 2,
		skillChoices: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"],
		casterType: null, // Paladin gets spellcasting at level 2
	},
	Ranger: {
		source: "PHB",
		hitDie: "d10",
		saves: ["str", "dex"],
		armorProfs: ["Light armor", "Medium armor", "Shields"],
		weaponProfs: ["Simple weapons", "Martial weapons"],
		skillCount: 3,
		skillChoices: ["animal handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"],
		casterType: null, // Ranger gets spellcasting at level 2
	},
	Rogue: {
		source: "PHB",
		hitDie: "d8",
		saves: ["dex", "int"],
		armorProfs: ["Light armor"],
		weaponProfs: ["Simple weapons", "Hand crossbows", "Longswords", "Rapiers", "Shortswords"],
		toolProfs: ["Thieves' tools"],
		skillCount: 4,
		skillChoices: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight of hand", "stealth"],
		casterType: null,
	},
	Sorcerer: {
		source: "PHB",
		hitDie: "d6",
		saves: ["con", "cha"],
		armorProfs: [],
		weaponProfs: ["Daggers", "Darts", "Slings", "Quarterstaffs", "Light crossbows"],
		skillCount: 2,
		skillChoices: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"],
		casterType: "full",
		castingAbility: "cha",
		cantripsKnown: 4,
		spellsKnown: 2,
		maxSpellLevel: 1,
	},
	Warlock: {
		source: "PHB",
		hitDie: "d8",
		saves: ["wis", "cha"],
		armorProfs: ["Light armor"],
		weaponProfs: ["Simple weapons"],
		skillCount: 2,
		skillChoices: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"],
		casterType: "pact",
		castingAbility: "cha",
		cantripsKnown: 2,
		spellsKnown: 2,
		maxSpellLevel: 1,
	},
	Wizard: {
		source: "PHB",
		hitDie: "d6",
		saves: ["int", "wis"],
		armorProfs: [],
		weaponProfs: ["Daggers", "Darts", "Slings", "Quarterstaffs", "Light crossbows"],
		skillCount: 2,
		skillChoices: ["arcana", "history", "insight", "investigation", "medicine", "religion"],
		casterType: "full",
		castingAbility: "int",
		cantripsKnown: 3,
		spellsKnown: 6,
		maxSpellLevel: 1, // Wizard starts with 6 in spellbook
	},
};

// Representative level-1 spell lists per class (common picks)
const SPELL_LISTS = {
	Bard: {
		cantrips: [
			{name: "Vicious Mockery", source: "PHB", school: "E"},
			{name: "Minor Illusion", source: "PHB", school: "I"},
			{name: "Mage Hand", source: "PHB", school: "C"},
			{name: "Light", source: "PHB", school: "V"},
			{name: "Prestidigitation", source: "PHB", school: "T"},
		],
		spells: [
			{name: "Healing Word", source: "PHB", level: 1, school: "V"},
			{name: "Faerie Fire", source: "PHB", level: 1, school: "V"},
			{name: "Thunderwave", source: "PHB", level: 1, school: "V"},
			{name: "Dissonant Whispers", source: "PHB", level: 1, school: "E"},
			{name: "Cure Wounds", source: "PHB", level: 1, school: "V"},
			{name: "Sleep", source: "PHB", level: 1, school: "E"},
			{name: "Charm Person", source: "PHB", level: 1, school: "E"},
			{name: "Detect Magic", source: "PHB", level: 1, school: "D", ritual: true},
		],
	},
	Cleric: {
		cantrips: [
			{name: "Sacred Flame", source: "PHB", school: "V"},
			{name: "Guidance", source: "PHB", school: "D"},
			{name: "Light", source: "PHB", school: "V"},
			{name: "Thaumaturgy", source: "PHB", school: "T"},
			{name: "Toll the Dead", source: "XPHB", school: "N"},
			{name: "Spare the Dying", source: "PHB", school: "N"},
		],
		spells: [], // Cleric prepares from full list
	},
	Druid: {
		cantrips: [
			{name: "Druidcraft", source: "PHB", school: "T"},
			{name: "Produce Flame", source: "PHB", school: "C"},
			{name: "Shillelagh", source: "PHB", school: "T"},
			{name: "Thorn Whip", source: "PHB", school: "T"},
			{name: "Guidance", source: "PHB", school: "D"},
		],
		spells: [], // Druid prepares from full list
	},
	Sorcerer: {
		cantrips: [
			{name: "Fire Bolt", source: "PHB", school: "V"},
			{name: "Ray of Frost", source: "PHB", school: "V"},
			{name: "Prestidigitation", source: "PHB", school: "T"},
			{name: "Mage Hand", source: "PHB", school: "C"},
			{name: "Minor Illusion", source: "PHB", school: "I"},
			{name: "Light", source: "PHB", school: "V"},
		],
		spells: [
			{name: "Shield", source: "PHB", level: 1, school: "A"},
			{name: "Magic Missile", source: "PHB", level: 1, school: "V"},
			{name: "Mage Armor", source: "PHB", level: 1, school: "A"},
			{name: "Chromatic Orb", source: "PHB", level: 1, school: "V"},
			{name: "Burning Hands", source: "PHB", level: 1, school: "V"},
			{name: "Thunderwave", source: "PHB", level: 1, school: "V"},
		],
	},
	Warlock: {
		cantrips: [
			{name: "Eldritch Blast", source: "PHB", school: "V"},
			{name: "Minor Illusion", source: "PHB", school: "I"},
			{name: "Mage Hand", source: "PHB", school: "C"},
			{name: "Prestidigitation", source: "PHB", school: "T"},
		],
		spells: [
			{name: "Hex", source: "PHB", level: 1, school: "E"},
			{name: "Armor of Agathys", source: "PHB", level: 1, school: "A"},
			{name: "Hellish Rebuke", source: "PHB", level: 1, school: "V"},
			{name: "Charm Person", source: "PHB", level: 1, school: "E"},
			{name: "Witch Bolt", source: "PHB", level: 1, school: "V"},
		],
	},
	Wizard: {
		cantrips: [
			{name: "Fire Bolt", source: "PHB", school: "V"},
			{name: "Mage Hand", source: "PHB", school: "C"},
			{name: "Prestidigitation", source: "PHB", school: "T"},
			{name: "Minor Illusion", source: "PHB", school: "I"},
			{name: "Ray of Frost", source: "PHB", school: "V"},
			{name: "Light", source: "PHB", school: "V"},
		],
		spells: [
			{name: "Shield", source: "PHB", level: 1, school: "A"},
			{name: "Magic Missile", source: "PHB", level: 1, school: "V"},
			{name: "Mage Armor", source: "PHB", level: 1, school: "A"},
			{name: "Find Familiar", source: "PHB", level: 1, school: "C", ritual: true},
			{name: "Detect Magic", source: "PHB", level: 1, school: "D", ritual: true},
			{name: "Sleep", source: "PHB", level: 1, school: "E"},
			{name: "Identify", source: "PHB", level: 1, school: "D", ritual: true},
			{name: "Thunderwave", source: "PHB", level: 1, school: "V"},
			{name: "Burning Hands", source: "PHB", level: 1, school: "V"},
			{name: "Chromatic Orb", source: "PHB", level: 1, school: "V"},
		],
	},
};

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

// Preferred ability priority per class (for stat assignment)
const CLASS_ABILITY_PRIORITY = {
	Barbarian: ["str", "con", "dex", "wis", "cha", "int"],
	Bard: ["cha", "dex", "con", "wis", "int", "str"],
	Cleric: ["wis", "con", "str", "cha", "dex", "int"],
	Druid: ["wis", "con", "dex", "int", "cha", "str"],
	Fighter: ["str", "con", "dex", "wis", "cha", "int"],
	Monk: ["dex", "wis", "con", "str", "cha", "int"],
	Paladin: ["str", "cha", "con", "wis", "dex", "int"],
	Ranger: ["dex", "wis", "con", "str", "int", "cha"],
	Rogue: ["dex", "con", "cha", "int", "wis", "str"],
	Sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
	Warlock: ["cha", "con", "dex", "wis", "int", "str"],
	Wizard: ["int", "con", "dex", "wis", "cha", "str"],
};

// ── Seeded Random ────────────────────────────────────────────────────────────

class SeededRandom {
	constructor (seed) {
		// Ensure seed is never 0 (degenerates LCG to constant 0)
		const raw = seed ?? Math.floor(Math.random() * 2147483647);
		this._seed = (raw % 2147483646) + 1;
	}

	/** Returns float in [0, 1) */
	next () {
		this._seed = (this._seed * 16807 + 0) % 2147483647;
		return (this._seed - 1) / 2147483646;
	}

	/** Returns int in [0, max) */
	int (max) {
		return Math.floor(this.next() * max);
	}

	/** Pick a random element from an array */
	pick (arr) {
		return arr[this.int(arr.length)];
	}

	/** Shuffle an array (Fisher-Yates) and return a copy */
	shuffle (arr) {
		const out = [...arr];
		for (let i = out.length - 1; i > 0; i--) {
			const j = this.int(i + 1);
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	/** Pick n unique random elements from arr */
	pickN (arr, n) {
		return this.shuffle(arr).slice(0, Math.min(n, arr.length));
	}
}

// ── Generator ────────────────────────────────────────────────────────────────

class RandomCharacterGenerator {
	/**
	 * Create a random level-1 character.
	 * @param {string} className - Class name (e.g. "Wizard", "Fighter")
	 * @param {object} [opts] - Options
	 * @param {number} [opts.seed] - Seed for reproducible randomness
	 * @param {string} [opts.source] - Class source (default: "PHB")
	 * @param {string} [opts.name] - Character name (default: generated)
	 * @returns {CharacterSheetState} Fully initialised state
	 */
	create (className, opts = {}) {
		const classDef = CLASS_DEFS[className];
		if (!classDef) throw new Error(`Unknown class: ${className}. Valid: ${Object.keys(CLASS_DEFS).join(", ")}`);

		const rng = new SeededRandom(opts.seed);
		const state = new CharacterSheetState();
		const source = opts.source ?? classDef.source;

		// 1. Name
		state._data.name = opts.name ?? `Test ${className}`;

		// 2. Race
		this._applyRace(state, rng);

		// 3. Background
		this._applyBackground(state, rng);

		// 4. Ability scores (standard array, class-optimised with shuffle)
		this._applyAbilityScores(state, rng, className);

		// 5. Class (also triggers calculateSpellSlots & _recalculateMaxHp internally)
		state.addClass({name: className, source, level: 1});

		// 6. Save proficiencies
		for (const save of classDef.saves) {
			state.addSaveProficiency(save);
		}

		// 7. Armor / weapon / tool proficiencies
		for (const prof of (classDef.armorProfs ?? [])) state.addArmorProficiency(prof);
		for (const prof of (classDef.weaponProfs ?? [])) state.addWeaponProficiency(prof);
		for (const prof of (classDef.toolProfs ?? [])) state.addToolProficiency(prof);

		// 8. Skill proficiencies (random from class list, avoiding duplicates from race/bg)
		this._applyClassSkills(state, rng, classDef);

		// 9. Spellcasting
		if (classDef.casterType) {
			state.setSpellcastingAbility(classDef.castingAbility);
			this._applySpells(state, rng, className, classDef);
		}

		// 10. Level history
		state.recordLevelChoice({
			level: 1,
			class: {name: className, source},
			choices: {},
			complete: true,
		});

		// 11. Set HP to max after everything is resolved
		const maxHp = state.getMaxHp?.() ?? state._data.hp.max;
		state._data.hp.current = maxHp;

		return state;
	}

	// ── Internal helpers ──

	_applyRace (state, rng) {
		const raceData = rng.pick(RACES);
		state.setRace(raceData.race, raceData.subrace || null);
		state._data.size = raceData.size;
		state._data.speed.walk = raceData.speed;

		// Ability bonuses from race
		if (raceData.abilityBonuses) {
			for (const [ab, bonus] of Object.entries(raceData.abilityBonuses)) {
				if (bonus) state.setAbilityBonus(ab, bonus);
			}
		}

		// Half-Elf bonus ability choices
		if (raceData.bonusAbilityChoices) {
			const available = ABILITIES.filter(a => !raceData.abilityBonuses?.[a]);
			const chosen = rng.pickN(available, raceData.bonusAbilityChoices);
			for (const ab of chosen) state.setAbilityBonus(ab, (state._data.abilityBonuses[ab] || 0) + 1);
		}

		// Darkvision
		if (raceData.darkvision) state._data.senses.darkvision = raceData.darkvision;

		// Languages
		for (const lang of (raceData.languages || [])) state.addLanguage(lang);

		// Racial skill proficiencies
		for (const skill of (raceData.skillProfs || [])) state.addSkillProficiency(skill);
	}

	_applyBackground (state, rng) {
		const bgData = rng.pick(BACKGROUNDS);
		state.setBackground({name: bgData.name, source: bgData.source});

		// Skill proficiencies
		for (const skill of bgData.skillProfs) state.addSkillProficiency(skill);

		// Tool proficiencies
		for (const tool of (bgData.toolProfs || [])) state.addToolProficiency(tool);

		// Extra languages from background
		if (bgData.languages > 0) {
			const known = new Set(state._data.languages.map(l => l.toLowerCase()));
			const available = EXTRA_LANGUAGES.filter(l => !known.has(l.toLowerCase()));
			const chosen = rng.pickN(available, bgData.languages);
			for (const lang of chosen) state.addLanguage(lang);
		}
	}

	_applyAbilityScores (state, rng, className) {
		// Shuffle standard array, but bias towards putting high scores in the
		// class's primary abilities. We take the class priority order and do a
		// mild shuffle: swap 0-2 random pairs to add variance.
		const priority = [...CLASS_ABILITY_PRIORITY[className]];
		const scores = [...STANDARD_ARRAY];

		// Randomly swap 0-2 pairs in priority for variety
		const swaps = rng.int(3); // 0, 1, or 2
		for (let i = 0; i < swaps; i++) {
			const a = rng.int(priority.length);
			const b = rng.int(priority.length);
			[priority[a], priority[b]] = [priority[b], priority[a]];
		}

		for (let i = 0; i < ABILITIES.length; i++) {
			state.setAbilityBase(priority[i], scores[i]);
		}
	}

	_applyClassSkills (state, rng, classDef) {
		const alreadyProficient = new Set(
			Object.keys(state._data.skillProficiencies).filter(s => state._data.skillProficiencies[s] >= 1),
		);
		const available = classDef.skillChoices.filter(s => !alreadyProficient.has(s));
		const chosen = rng.pickN(available, classDef.skillCount);
		for (const skill of chosen) state.addSkillProficiency(skill);
	}

	_applySpells (state, rng, className, classDef) {
		const spellData = SPELL_LISTS[className];
		if (!spellData) return;

		// Cantrips
		if (classDef.cantripsKnown && spellData.cantrips.length > 0) {
			const cantrips = rng.pickN(spellData.cantrips, classDef.cantripsKnown);
			for (const c of cantrips) {
				state.addCantrip({...c, sourceClass: className});
			}
		}

		// Spells (known casters only — prepared casters don't select at creation)
		if (classDef.spellsKnown && spellData.spells.length > 0) {
			const spells = rng.pickN(spellData.spells, classDef.spellsKnown);
			for (const s of spells) {
				state.addSpell({...s, sourceClass: className}, false);
			}
		}
	}
}

export {RandomCharacterGenerator, CLASS_DEFS, RACES, BACKGROUNDS, SPELL_LISTS, SeededRandom};
