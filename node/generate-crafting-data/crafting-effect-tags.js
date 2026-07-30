import {entriesToText, getUid} from "./crafting-utils.js";

/**
 * Derives filterable effect tags from the prose that source books use to describe what a
 * material or craftable actually does.
 *
 * Tags are intentionally coarse — they exist to answer "show me everything that deals fire
 * damage" or "show me everything that grants a flying speed", not to model mechanics
 * precisely. Where a book already provides structured effects (Arcadia 8's
 * `variantComponent.spellEffects`) those are read directly instead of guessed at.
 */

/* -------------------------------------------- */
/* Taxonomy                                     */
/* -------------------------------------------- */

export const EFFECT_TAG_GROUPS = {
	"Damage Type": [
		"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing",
		"poison damage", "psychic", "radiant", "slashing", "thunder",
	],
	"Restoration": ["healing", "temporary hit points", "cures condition", "cures disease", "neutralises poison", "revives"],
	"Protection": ["resistance", "immunity", "vulnerability", "armour class", "absorbs damage"],
	"Rolls": ["advantage", "disadvantage", "ability score", "skill bonus", "attack bonus", "saving throw bonus", "critical hit"],
	"Conditions": [
		"blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
		"invisible", "paralysed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
	],
	"Movement": ["flying speed", "swimming speed", "climbing speed", "burrowing speed", "increased speed", "teleportation", "planar travel"],
	"Senses": ["darkvision", "blindsight", "tremorsense", "truesight", "detects magic", "scrying"],
	"Magic": ["grants spell", "spell component", "concentration", "summoning", "animates dead", "shapechanging", "wild magic", "dispels magic", "counters magic"],
	"Mechanics": ["forces a saving throw", "area of effect", "requires an action", "lasting effect", "single use"],
	"Crafting Use": ["armour material", "weapon material", "ammunition", "poison crafting", "potion crafting", "food", "crafting ingredient", "spell reagent", "trade good"],
	"Utility": ["light source", "adhesive", "acid solvent", "waterproofing", "disguise", "language", "communication"],
};

export const EFFECT_TAGS = Object.values(EFFECT_TAG_GROUPS).flat();

const EFFECT_TAG_TO_GROUP = Object.entries(EFFECT_TAG_GROUPS)
	.reduce((acc, [group, tags]) => {
		tags.forEach(tag => acc[tag] = group);
		return acc;
	}, {});

export const getEffectTagGroup = (tag) => EFFECT_TAG_TO_GROUP[tag] || "Other";

/* -------------------------------------------- */
/* Patterns                                     */
/* -------------------------------------------- */

/**
 * Ordered list of `[tag, pattern]`. Patterns run against the flattened, tag-stripped text of an
 * entity's description and effect prose.
 */
const _PATTERNS = [
	// Damage types — require a damage-ish context so "cold climate" doesn't tag as cold damage
	["acid", /\bacid damage\b|\bdamage[^.]{0,20}\bacid\b/i],
	["bludgeoning", /\bbludgeoning damage\b/i],
	["cold", /\bcold damage\b|\bdamage[^.]{0,20}\bcold\b/i],
	["fire", /\bfire damage\b|\bdamage[^.]{0,20}\bfire\b/i],
	["force", /\bforce damage\b/i],
	["lightning", /\blightning damage\b|\bdamage[^.]{0,20}\blightning\b/i],
	["necrotic", /\bnecrotic damage\b/i],
	["piercing", /\bpiercing damage\b/i],
	["poison damage", /\bpoison damage\b/i],
	["psychic", /\bpsychic damage\b/i],
	["radiant", /\bradiant damage\b/i],
	["slashing", /\bslashing damage\b/i],
	["thunder", /\bthunder damage\b/i],

	// Restoration
	["healing", /\bregain(?:s|ing)? (?:\d|\ba\b|hit points)|\bheal(?:s|ed|ing)?\b|\brestores? \d+ hit points\b/i],
	["temporary hit points", /\btemporary hit points?\b/i],
	["cures condition", /\b(?:ends?|removes?|cures?|is no longer)\b[^.]{0,40}\b(?:blinded|charmed|deafened|frightened|paralyz|petrified|poisoned|stunned|exhaustion)\b/i],
	["cures disease", /\bcures?\b[^.]{0,30}\bdisease\b|\bimmune to disease\b/i],
	["neutralises poison", /\bneutrali[sz]e[^.]{0,20}\bpoison\b|\bcures?\b[^.]{0,20}\bpoison(?:ed)?\b/i],
	["revives", /\breturns? (?:a |the )?(?:creature|target)[^.]{0,30}\bto life\b|\brevivify\b|\braise dead\b/i],

	// Protection
	["resistance", /\bresistance to\b/i],
	["immunity", /\bimmunit(?:y|ies) to\b|\bimmune to\b/i],
	["vulnerability", /\bvulnerabilit(?:y|ies) to\b|\bvulnerable to\b/i],
	["armour class", /\bbonus to (?:your )?(?:AC|Armor Class|Armour Class)\b|\bArmor Class (?:increases|becomes)\b/i],
	["absorbs damage", /\babsorbs? (?:up to )?\d+|\babsorbs that damage\b|\bdamage you take is reduced\b/i],

	// Rolls
	["advantage", /\badvantage on\b/i],
	["disadvantage", /\bdisadvantage on\b/i],
	["ability score", /\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score (?:increases|becomes)\b/i],
	["skill bonus", /\bbonus to\b[^.]{0,40}\b(?:Athletics|Acrobatics|Sleight of Hand|Stealth|Arcana|History|Investigation|Nature|Religion|Animal Handling|Insight|Medicine|Perception|Survival|Deception|Intimidation|Performance|Persuasion)\b/i],
	["attack bonus", /\bbonus to (?:your )?attack rolls?\b|\bbonus to spell attack rolls?\b/i],
	["saving throw bonus", /\bbonus to (?:your )?saving throws?\b/i],
	["critical hit", /\bcritical hit\b/i],

	// Conditions inflicted
	["blinded", /\bblinded\b/i],
	["charmed", /\bcharmed\b/i],
	["deafened", /\bdeafened\b/i],
	["frightened", /\bfrightened\b/i],
	["grappled", /\bgrappled\b/i],
	["incapacitated", /\bincapacitated\b/i],
	["invisible", /\binvisible\b|\binvisibility\b/i],
	["paralysed", /\bparaly[sz]ed\b/i],
	["petrified", /\bpetrified\b/i],
	["poisoned", /\bpoisoned\b/i],
	["prone", /\bknocked prone\b|\bfalls? prone\b/i],
	["restrained", /\brestrained\b/i],
	["stunned", /\bstunned\b/i],
	["unconscious", /\bunconscious\b|\bfalls? asleep\b/i],

	// Movement
	["flying speed", /\bflying speed\b|\bfly(?:ing)? speed of\b/i],
	["swimming speed", /\bswimming speed\b|\bswim speed\b|\bbreathe underwater\b/i],
	["climbing speed", /\bclimbing speed\b|\bclimb speed\b/i],
	["burrowing speed", /\bburrow(?:ing)? speed\b/i],
	["increased speed", /\b(?:walking )?speed increases\b|\bspeed is increased\b|\bbonus to (?:your )?speed\b/i],
	["teleportation", /\bteleport/i],
	["planar travel", /\bportal\b|\bplane shift\b|\bplanar\b|\bto the (?:Abyss|Nine Hells|Feywild|Shadowfell|Astral Plane|Ethereal Plane)\b/i],

	// Senses
	["darkvision", /\bdarkvision\b/i],
	["blindsight", /\bblindsight\b/i],
	["tremorsense", /\btremorsense\b/i],
	["truesight", /\btruesight\b/i],
	["detects magic", /\bdetect magic\b|\bsense[^.]{0,20}\bmagic\b/i],
	["scrying", /\bscry/i],

	// Magic
	["grants spell", /\byou (?:may |can )?cast\b|\bas if you had cast\b|\bcast the\b[^.]{0,30}\bspell\b/i],
	["spell component", /\bvariant spell component\b|\bmonstrous component\b|\bmaterial component\b/i],
	["concentration", /\bconcentrat/i],
	["summoning", /\bsummons?\b|\bconjures?\b/i],
	["animates dead", /\brises? as\b|\banimat(?:e|es|ed|ing)\b[^.]{0,30}\b(?:corpse|dead|body)\b|\breanimat/i],
	["shapechanging", /\bshapechang|\bpolymorph|\btransforms? into\b|\bassume the (?:form|shape)\b/i],
	["wild magic", /\bwild magic\b/i],
	["dispels magic", /\bdispel/i],
	["counters magic", /\bcounterspell\b|\bcounters? the spell\b/i],

	// General mechanics — catch entities whose effect is real but whose specifics vary
	["forces a saving throw", /\b(?:make|makes|roll|rolls|repeat)s? an? [A-Za-z]* ?saving throw\b|\bmust (?:succeed on|make) a\b/i],
	["area of effect", /\b\d+[- ]foot[- ](?:radius|cone|line|cube|sphere|square)\b|\bwithin \d+ feet\b/i],
	["requires an action", /\bas an action\b|\bas a bonus action\b|\bas a reaction\b|\bspend(?:s|ing)? (?:your |an )?action\b/i],
	["lasting effect", /\bfor (?:the next )?\d+ (?:minutes?|hours?|days?|rounds?)\b|\buntil you finish a (?:short|long) rest\b/i],
	["single use", /\bbecomes? useless\b|\bloses? all (?:of its )?magic/i],

	// Crafting use
	["armour material", /\barmou?r\b/i],
	["weapon material", /\bweapon(?:s|ry)?\b/i],
	["ammunition", /\bammunition\b|\barrows?\b|\bbolts?\b|\bbullets?\b/i],
	["poison crafting", /\bpoison(?:er's)? kit\b|\bcraft(?:ed|ing)?\b[^.]{0,20}\bpoison\b/i],
	["potion crafting", /\bpotions?\b|\bbrew(?:ed|ing)?\b|\belixir/i],
	["food", /\bedible\b|\beat(?:en|ing)?\b|\bcook(?:ed|ing)?\b|\bmeal\b|\bration\b/i],
	["spell reagent", /\breagent\b|\bspell component\b|\bspellcasting focus\b|\bcomponent for\b/i],

	// Utility
	["light source", /\bsheds? (?:bright|dim) light\b|\bemits? light\b|\bglows?\b/i],
	["adhesive", /\badhesive\b|\bsticky\b|\bglue\b/i],
	["acid solvent", /\bdissolves?\b|\bcorrode/i],
	["waterproofing", /\bwaterproof/i],
	["disguise", /\bdisguise\b|\bappear(?:s|ance) (?:as|of)\b/i],
	["language", /\bspeak(?:s|ing)?\b[^.]{0,20}\blanguage\b|\bunderstand\b[^.]{0,20}\blanguage\b/i],
	["communication", /\btelepath/i],
];

/**
 * Tags that are noisy on their own — "armour"/"weapon" appear in almost every description.
 * Only keep them when the text actually describes making something.
 */
const _CRAFTING_GATE = /\bcraft(?:ed|ing|s|er|ers)?\b|\bforge[ds]?\b|\bsmith(?:ed|ing)?\b|\bmade (?:in)?to\b|\b(?:used|use) to make\b|\bmake a\b|\bmaterials?\b|\btann(?:ed|ing)\b|\bwork(?:ed|ing) into\b|\bingredient\b|\breagent\b|\bcomponent\b|\bfashioned?\b|\bconstruct(?:ed|ing)?\b/i;
const _CRAFTING_GATED_TAGS = new Set(["armour material", "weapon material", "ammunition", "potion crafting"]);

/* -------------------------------------------- */
/* Derivation                                   */
/* -------------------------------------------- */

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.source
 * @param {*} opts.entries Entry tree to scan.
 * @param {string} [opts.extraText] Additional text to scan (e.g. a `Crafting` table cell).
 * @param {object} [opts.variantComponent] Arcadia 8 structured effects, when present.
 * @param {Record<string, {add?: string[], remove?: string[]}>} [opts.overrides]
 * @returns {string[]} Sorted, de-duplicated effect tags.
 */
export function deriveEffectTags ({name, source, entries, extraText = "", variantComponent = null, overrides = {}}) {
	const text = `${entriesToText(entries)} ${extraText}`.replace(/\s+/g, " ");
	const isCrafting = _CRAFTING_GATE.test(text);

	const tags = new Set();

	for (const [tag, pattern] of _PATTERNS) {
		if (_CRAFTING_GATED_TAGS.has(tag) && !isCrafting) continue;
		if (pattern.test(text)) tags.add(tag);
	}

	// Structured effects beat guesswork
	if (variantComponent?.spellEffects?.length) {
		tags.add("spell component");
		for (const se of variantComponent.spellEffects) {
			if (se.match?.damageType) tags.add(_normaliseDamageTag(se.match.damageType));
			for (const eff of se.effects || []) {
				switch (eff.type) {
					case "bonusDamage": case "bonusDice": case "dieSizeIncrease": case "maximiseDamage":
						if (eff.damageType) tags.add(_normaliseDamageTag(eff.damageType));
						break;
					case "removeConcentration": tags.add("concentration"); break;
					case "bonusHealing": tags.add("healing"); break;
					case "advantage": tags.add("advantage"); break;
					case "condition": tags.add(_normaliseConditionTag(eff.condition)); break;
					default: break;
				}
			}
		}
	}

	const override = overrides[getUid(name, source)];
	if (override) {
		(override.add || []).forEach(tag => tags.add(tag));
		(override.remove || []).forEach(tag => tags.delete(tag));
	}

	return [...tags].filter(Boolean).sort();
}

const _normaliseDamageTag = (damageType) => {
	const clean = `${damageType}`.toLowerCase().trim();
	return clean === "poison" ? "poison damage" : (EFFECT_TAGS.includes(clean) ? clean : null);
};

const _normaliseConditionTag = (condition) => {
	const clean = `${condition}`.toLowerCase().trim();
	if (clean === "paralyzed") return "paralysed";
	return EFFECT_TAGS.includes(clean) ? clean : null;
};

/* -------------------------------------------- */
/* Fallbacks                                    */
/* -------------------------------------------- */

/**
 * Tags that describe *what a thing is for* rather than what it does. Applied after the crafting
 * graph is built, so that materials with no mechanical effect of their own are still filterable
 * (most Hamund harvestables are trade goods or crafting inputs, not magic items).
 */
const _MECHANICAL_GROUPS = new Set(["Damage Type", "Restoration", "Protection", "Rolls", "Conditions", "Movement", "Senses", "Magic", "Mechanics"]);

/** Every gatherable material is, by definition, a crafting input. */
const _INGREDIENT_CATEGORIES = new Set(["creature part", "herb", "mineral", "food ingredient", "spell component"]);

/**
 * @param {object} ent A `craftingMaterial` or `craftingRecipe`.
 * @param {Record<string, {add?: string[], remove?: string[]}>} [overrides]
 */
export function applyFallbackTags (ent, overrides = {}) {
	const tags = new Set(ent.effectTags || []);

	if ((ent.usedInRecipes || []).length || (ent.ingredients || []).length) tags.add("crafting ingredient");
	if (_INGREDIENT_CATEGORIES.has(ent.materialCategory)) tags.add("crafting ingredient");

	const hasMechanicalTag = [...tags].some(tag => _MECHANICAL_GROUPS.has(getEffectTagGroup(tag)));
	if (!hasMechanicalTag && ent.value != null) tags.add("trade good");

	const override = overrides[getUid(ent.name, ent.source)];
	if (override) {
		(override.add || []).forEach(tag => tags.add(tag));
		(override.remove || []).forEach(tag => tags.delete(tag));
	}

	ent.effectTags = [...tags].filter(Boolean).sort();
	ent.hasMechanicalEffect = [...tags].some(tag => _MECHANICAL_GROUPS.has(getEffectTagGroup(tag)));
}
