import {entriesToText} from "./crafting-utils.js";

/**
 * Collects the crafting rules scattered across the six source books into a single `craftingRule`
 * prop, so the hub page is self-contained and searchable without needing every book loaded.
 */

/** Rule name (lowercased) → `ruleCategory`. Anything unmatched falls back to the book default. */
const RULE_NAME_TO_CATEGORY = {
	"new proficiency: harvesting kit": "harvesting",
	"optional rule: carcass degradation": "harvesting",
	"optional rule: crafter skill": "crafting",
	"optional rule: harvesting dangerous materials": "harvesting",
	"incorporating artificers": "crafting",
	"miscellaneous harvesting": "harvesting",
	"optional rule: herb toxicity": "materials",
	"optional rule: identifying herbs": "harvesting",
	"tinctures": "crafting",
	"culinary student": "cooking",
	"hot and fast": "cooking",
	"crafting an item": "crafting",
	"crafting magic items": "crafting",
	"crafting complications": "crafting",
	"brewing potions of healing": "crafting",
	"scribing a spell scroll": "crafting",
	"scribing scroll complications": "crafting",
	"collecting creature parts": "harvesting",
	"harvested unit values": "materials",
	"extracting minerals": "harvesting",
	"foraging variant: getting meat": "harvesting",
	"extracting non-mineral materials": "harvesting",
	"gathering plants and herbs": "harvesting",
	"buying and selling materials": "materials",
	"plants and herbs by area": "materials",
	"modular crafting": "crafting",
	"crafting material descriptions": "materials",
	"optional rule: material resistance": "materials",
	"modular magic items: item tiers": "crafting",
	"spells and charges on modular items": "crafting",
	"modular magic item properties": "crafting",
	"evolving magic items": "crafting",
	"parts by creature": "harvesting",
};

/** Arcadia 8 keeps its component rules in book prose rather than `variantrule`. */
const ARCADIA8_RULE_SECTIONS = [
	{name: "Harvesting Components", ruleCategory: "harvesting"},
	{name: "Spellcasting with Monstrous Components", ruleCategory: "components"},
	{name: "Combining Components", ruleCategory: "components"},
];

/**
 * The six source books are wholly about crafting, so every rule in them belongs here. Thelemar is a
 * general campaign setting, so only the handful of its rules that bear on crafting are taken —
 * otherwise the hub fills up with sleep deprivation and deity relationships.
 */
const RULE_ALLOWLIST_BY_SOURCE = {
	thelemar: {
		"Variant Spell Components (Conversion Notes)": "components",
		"The Twelve Uses of Dragon's Blood": "components",
		"Identifying Magic Items & Effects": "materials",
		"Gemstone Empowerment": "crafting",
		"Object Durability": "materials",
		"Magical Interference": "materials",
	},
};

/**
 * @param {Record<string, object>} books Keyed source books.
 * @returns {object[]} `craftingRule` entities.
 */
export function extractCraftingRules (books) {
	const out = [];

	for (const [key, bookData] of Object.entries(books)) {
		const allowlist = RULE_ALLOWLIST_BY_SOURCE[key];

		for (const rule of bookData.variantrule || []) {
			if (allowlist && !allowlist[rule.name]) continue;

			out.push({
				name: rule.name,
				source: rule.source,
				page: rule.page,
				ruleCategory: allowlist?.[rule.name] || RULE_NAME_TO_CATEGORY[rule.name.toLowerCase()] || "crafting",
				ruleType: rule.ruleType,
				...(rule.otherSources ? {otherSources: rule.otherSources} : {}),
				entries: rule.entries || [],
			});
		}

		// New skills (Arcadia 11's Cooking / Harvesting)
		for (const skill of bookData.skill || []) {
			if (allowlist) continue;
			out.push({
				name: `Skill: ${skill.name}`,
				source: skill.source,
				page: skill.page,
				ruleCategory: skill.name.toLowerCase() === "cooking" ? "cooking" : "harvesting",
				skillAbility: skill.ability,
				entries: skill.entries || [],
			});
		}

		if (key === "arcadia8") out.push(..._extractArcadia8BookRules(bookData));
	}

	// Recipe item-properties explain the Success/Delicious/Extra Delicious ladder
	for (const prop of books.arcadia11?.itemProperty || []) {
		out.push({
			name: prop.name,
			source: prop.source,
			page: prop.page,
			ruleCategory: "cooking",
			entries: prop.entries || [],
		});
	}

	return out;
}

function _extractArcadia8BookRules (arcadia8Data) {
	const out = [];
	const wanted = new Map(ARCADIA8_RULE_SECTIONS.map(it => [it.name, it]));

	const walk = (entry) => {
		if (!entry || typeof entry !== "object") return;
		const match = entry.name ? wanted.get(entry.name) : null;
		if (match && entry.entries?.length) {
			out.push({
				name: entry.name,
				source: "Ar8",
				page: entry.page,
				ruleCategory: match.ruleCategory,
				entries: entry.entries,
			});
			wanted.delete(entry.name);
		}
		(entry.entries || []).forEach(walk);
	};

	for (const bookData of arcadia8Data.bookData || []) (bookData.data || []).forEach(walk);

	// "Combining Components" is a bare table rather than a named section
	if (wanted.has("Combining Components")) {
		const table = (arcadia8Data.table || []).find(it => it.name === "Combining Components");
		if (table) {
			out.push({
				name: "Combining Components",
				source: table.source,
				page: table.page,
				ruleCategory: "components",
				entries: [
					"Using more than one monstrous component in a single casting risks a surge of wild magic.",
					table,
				],
			});
		}
	}

	return out;
}

/** Rules that reference a table by name, for the coverage report. */
export const getRuleSummaryText = (rule) => entriesToText(rule.entries).slice(0, 160);
