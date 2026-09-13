/**
 * Closed protocol vocabulary shared by the Hub projection authority and its browser
 * controls. This module intentionally contains no preset membership or projection logic.
 */

const freezeChoices = choices => Object.freeze(choices.map(choice => Object.freeze(choice)));

export const ABILITY_CHOICES = freezeChoices([
	{value: "str", label: "Strength"},
	{value: "dex", label: "Dexterity"},
	{value: "con", label: "Constitution"},
	{value: "int", label: "Intelligence"},
	{value: "wis", label: "Wisdom"},
	{value: "cha", label: "Charisma"},
]);
export const ABILITY_KEYS = Object.freeze(ABILITY_CHOICES.map(choice => choice.value));

export const MOVEMENT_CHOICES = freezeChoices([
	{value: "walk", label: "Walking"},
	{value: "fly", label: "Flying"},
	{value: "swim", label: "Swimming"},
	{value: "climb", label: "Climbing"},
	{value: "burrow", label: "Burrowing"},
]);
export const MOVEMENT_KEYS = Object.freeze(MOVEMENT_CHOICES.map(choice => choice.value));

export const SKILL_TO_ABILITY = Object.freeze({
	athletics: "str",
	acrobatics: "dex",
	sleightOfHand: "dex",
	stealth: "dex",
	arcana: "int",
	history: "int",
	investigation: "int",
	nature: "int",
	religion: "int",
	animalHandling: "wis",
	insight: "wis",
	medicine: "wis",
	perception: "wis",
	survival: "wis",
	deception: "cha",
	intimidation: "cha",
	performance: "cha",
	persuasion: "cha",
	cooking: "wis",
	culture: "wis",
	endurance: "con",
	engineering: "int",
	harvesting: "dex",
	linguistics: "wis",
	might: "str",
});

export const SKILL_CHOICES = freezeChoices([
	{value: "athletics", label: "Athletics"},
	{value: "acrobatics", label: "Acrobatics"},
	{value: "sleightOfHand", label: "Sleight of Hand"},
	{value: "stealth", label: "Stealth"},
	{value: "arcana", label: "Arcana"},
	{value: "history", label: "History"},
	{value: "investigation", label: "Investigation"},
	{value: "nature", label: "Nature"},
	{value: "religion", label: "Religion"},
	{value: "animalHandling", label: "Animal Handling"},
	{value: "insight", label: "Insight"},
	{value: "medicine", label: "Medicine"},
	{value: "perception", label: "Perception"},
	{value: "survival", label: "Survival"},
	{value: "deception", label: "Deception"},
	{value: "intimidation", label: "Intimidation"},
	{value: "performance", label: "Performance"},
	{value: "persuasion", label: "Persuasion"},
	{value: "cooking", label: "Cooking"},
	{value: "culture", label: "Culture"},
	{value: "endurance", label: "Endurance"},
	{value: "engineering", label: "Engineering"},
	{value: "harvesting", label: "Harvesting"},
	{value: "linguistics", label: "Linguistics"},
	{value: "might", label: "Might"},
]);
export const SKILL_KEYS = Object.freeze(SKILL_CHOICES.map(choice => choice.value));

export const SKILL_RANK_CHOICES = freezeChoices([
	{value: "none", label: "Not trained"},
	{value: "half", label: "Half proficiency"},
	{value: "proficient", label: "Proficient"},
	{value: "expertise", label: "Expertise"},
]);
export const SKILL_RANKS = Object.freeze(SKILL_RANK_CHOICES.map(choice => choice.value));

export const PROJECTION_FIELD_KEYS = Object.freeze([
	"identity",
	"species",
	"classes",
	"abilities",
	"saves",
	"skills",
	"ac",
	"hp",
	"speed",
	"senses",
	"conditions",
	"diseases",
	"exhaustion",
	"inventorySummary",
	"carrySummary",
]);

export const PROJECTION_PRESET_KEYS = Object.freeze(["table", "minimal", "open", "private"]);
export const PROJECTION_OVERRIDE_MODES = Object.freeze(["share", "hide", "replace"]);
