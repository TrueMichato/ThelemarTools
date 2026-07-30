import {
	entriesToText,
	extractItemRefs,
	getUid,
	parseIngredientList,
} from "./crafting-utils.js";

/**
 * Extracts craftable outputs — Hamund's crafted magic items, Arcadia 11's dishes, and The Complete
 * Crafter's bespoke items — into a single `craftingRecipe` shape.
 */

const OUTCOME_TIERS = [
	{tier: "success", pattern: /^Success/i},
	{tier: "delicious", pattern: /^Delicious/i},
	{tier: "extraDelicious", pattern: /^Extra Delicious/i},
];

/**
 * Hamund craftables are ordinary `item` entries that carry `customProperties.crafter` and
 * `customProperties.ingredients`.
 */
export function extractHamundRecipes (bookDatas, {fnDeriveEffectTags, report}) {
	const out = [];

	for (const bookData of bookDatas) {
		for (const item of [...(bookData.item || []), ...(bookData.itemGroup || [])]) {
			const cp = item.customProperties || {};
			if (!cp.crafter && !cp.ingredients) continue;

			const ent = {
				name: item.name,
				source: item.source,
				page: item.page,
				recipeCategory: _getRecipeCategory(item),
				crafter: cp.crafter || null,
				craftDC: null,
				ingredients: parseIngredientList(cp.ingredients, {defaultSource: item.source}),
				itemUid: getUid(item.name, item.source),
				entries: item.entries || [],
			};

			if (item.rarity && item.rarity !== "none" && item.rarity !== "unknown") ent.rarity = item.rarity;
			if (item.reqAttune) ent.reqAttune = item.reqAttune;
			if (item.value != null) ent.value = item.value;

			ent.effectTags = fnDeriveEffectTags({
				name: ent.name,
				source: ent.source,
				entries: item.entries,
			});

			if (!ent.ingredients.length && cp.ingredients) {
				report.skippedRows.push(`${item.source} \u2014 "${item.name}": could not parse ingredients "${cp.ingredients}"`);
			}

			out.push(ent);
		}
	}

	return out;
}

const _getRecipeCategory = (item) => {
	const type = `${item.type || ""}`.split("|")[0];
	if (type === "P") return "potion";
	if (type === "SC") return "scroll";
	if (type === "Oil") return "potion";
	if (type === "FD") return "dish";
	if (type === "Curse") return "curse";
	return "item";
};

/**
 * Arcadia 11 recipes are `type: "FD"` items flagged with the `SimRep` / `SpeRep` item properties.
 * Their ingredients are portion lines inside `list` entries, and their payoff is a
 * Success / Delicious / Extra Delicious ladder.
 */
export function extractArcadiaRecipes (arcadia11Data, {fnDeriveEffectTags, report}) {
	const out = [];

	for (const item of arcadia11Data.item || []) {
		const props = item.property || [];
		const isRecipe = props.includes("SimRep") || props.includes("SpeRep");
		if (!isRecipe) continue;

		const {ingredients, outcomes, componentGroups, otherEntries} = _parseArcadiaRecipeEntries(item.entries);

		const ent = {
			name: item.name,
			source: item.source,
			page: item.page,
			recipeCategory: "dish",
			crafter: "Cook",
			craftDC: item.customProperties?.cookDC ?? null,
			complexity: props.includes("SpeRep") ? "special" : "simple",
			ingredients,
			...(componentGroups.length > 1 ? {componentGroups} : {}),
			outcomes,
			itemUid: getUid(item.name, item.source),
			// Only the flavour text: the ingredient lists and outcome ladder are structured above,
			// and repeating them verbatim would render the whole recipe twice.
			entries: otherEntries,
		};

		ent.effectTags = fnDeriveEffectTags({
			name: ent.name,
			source: ent.source,
			entries: [...outcomes.map(it => it.entries), otherEntries],
			extraText: "food cooking",
		});

		if (!ent.ingredients.length) report.skippedRows.push(`${item.source} \u2014 "${item.name}": no ingredients parsed`);
		if (!ent.outcomes.length) report.skippedRows.push(`${item.source} \u2014 "${item.name}": no outcome tiers parsed`);

		out.push(ent);
	}

	return out;
}

function _parseArcadiaRecipeEntries (entries) {
	const ingredients = [];
	const outcomes = [];
	const componentGroups = [];
	const otherEntries = [];

	const pushIngredientLine = (line, groupName) => {
		const text = typeof line === "string" ? line : entriesToText(line);
		const m = /^\s*(\d+(?:\/\d+)?)\s+(?:portions?|units?)\s+(?:of\s+)?(.*)$/i.exec(entriesToText(text));
		const refs = extractItemRefs(line);

		const rawName = (m ? m[2] : entriesToText(text)).trim().replace(/\.$/, "");
		if (!rawName) return;

		ingredients.push({
			name: refs[0]?.name ?? rawName,
			quantity: m ? Number(m[1]) || 1 : 1,
			unit: "portion",
			uid: refs[0] ? getUid(refs[0].name, refs[0].source) : null,
			...(groupName ? {group: groupName} : {}),
		});
	};

	for (const entry of entries || []) {
		if (typeof entry === "string") {
			if (/^\s*\d+(?:\/\d+)?\s+(?:portions?|units?)\b/i.test(entriesToText(entry))) pushIngredientLine(entry, null);
			else otherEntries.push(entry);
			continue;
		}
		if (entry?.type !== "list") {
			otherEntries.push(entry);
			continue;
		}

		const isOutcomeList = (entry.items || []).some(it => typeof it === "object" && OUTCOME_TIERS.some(tier => tier.pattern.test(it.name || "")));

		if (isOutcomeList) {
			for (const listItem of entry.items || []) {
				if (typeof listItem !== "object" || !listItem.name) continue;
				const match = OUTCOME_TIERS.find(tier => tier.pattern.test(listItem.name));
				if (!match) continue;
				outcomes.push({tier: match.tier, entries: listItem.entries || []});
			}
			continue;
		}

		if (entry.name) componentGroups.push(entry.name);
		for (const listItem of entry.items || []) pushIngredientLine(listItem, entry.name || null);
	}

	return {ingredients, outcomes, componentGroups, otherEntries};
}

/** The Complete Crafter's own magic items and potions. */
export function extractCompleteCrafterRecipes (completeCrafterData, {fnDeriveEffectTags}) {
	return (completeCrafterData.item || []).map(item => {
		const ent = {
			name: item.name,
			source: item.source,
			page: item.page,
			recipeCategory: _getRecipeCategory(item),
			crafter: null,
			craftDC: null,
			ingredients: [],
			itemUid: getUid(item.name, item.source),
			entries: item.entries || [],
		};

		if (item.rarity && item.rarity !== "none" && item.rarity !== "unknown") ent.rarity = item.rarity;
		if (item.reqAttune) ent.reqAttune = item.reqAttune;
		if (item.value != null) ent.value = item.value;

		ent.effectTags = fnDeriveEffectTags({
			name: ent.name,
			source: ent.source,
			entries: item.entries,
		});

		return ent;
	});
}
