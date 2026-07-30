import {getUid, joinCreatureAndMaterialName} from "./crafting-utils.js";

/**
 * Links materials and recipes together in both directions.
 *
 * Two independent signals exist in the source data:
 *  - harvest tables name what a material crafts into (the `Crafting` column → `usedIn`)
 *  - craftables name what they are made from (`customProperties.ingredients` → `ingredients`)
 *
 * Neither is complete on its own, and neither uses canonical UIDs, so this pass reconciles them
 * against the actual generated entities and fills in whichever direction is missing.
 */

/**
 * Index materials under every spelling an ingredient reference might plausibly use.
 *
 * The handbooks name the same material three different ways depending on where it appears:
 *   material entry       `"Salamander Scale (large pouch)"`
 *   ingredient reference `"Salamander Scale ×1 large pouch"`
 *   placeholder form     `"[Type] Dragon Tooth"` on a table named `"Young Dragon"`
 */
function _buildMaterialIndex (materials) {
	/** @type {Map<string, object[]>} */
	const byKey = new Map();

	const add = (key, mat) => {
		if (!key) return;
		if (!byKey.has(key)) byKey.set(key, []);
		if (!byKey.get(key).includes(mat)) byKey.get(key).push(mat);
	};

	for (const mat of materials) {
		for (const key of getMaterialKeys(mat)) add(key, mat);
	}

	return byKey;
}

const _normKey = (name) => `${name}`
	.toLowerCase()
	.replace(/[\u2019\u2018]/g, "'")
	.replace(/[^a-z0-9' /-]/g, " ")
	.replace(/\s+/g, " ")
	.trim();

/** Every lookup key a material should be findable under. */
export function getMaterialKeys (mat) {
	const keys = new Set();
	const name = mat.name || "";

	// Drop a parenthetical unit/qualifier: "Salamander Scale (large pouch)" → "Salamander Scale"
	const noParen = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();

	const variants = [name, noParen];

	// Prefix the creature name, resolving any shared words:
	// "Hide" on "Bone Devil" → "Bone Devil Hide"; "Devil Hide" on "Bone Devil" → "Bone Devil Hide"
	const creatureNames = [mat.harvest?.creature?.label, mat.harvest?.creature?.name].filter(Boolean);
	for (const creatureName of creatureNames) {
		variants.push(joinCreatureAndMaterialName(creatureName, noParen));
	}

	for (const variant of variants) {
		const key = _normKey(variant);
		if (!key) continue;
		keys.add(key);
		// The books are inconsistent about pluralising the final word
		keys.add(_singularise(key));
		keys.add(_pluralise(key));
	}

	return [...keys].filter(Boolean);
}

const _singularise = (key) => key.replace(/(?:ies)$/, "y").replace(/(?<=[^s])s$/, "");
const _pluralise = (key) => (/s$/.test(key) ? key : `${key}s`);

const _lookupMaterials = (byKey, name, preferredSource) => {
	if (!name) return [];

	const base = _normKey(name);
	const noParen = _normKey(`${name}`.replace(/\s*\(.*?\)\s*/g, " "));
	const candidates = byKey.get(base)
		|| byKey.get(noParen)
		|| byKey.get(_singularise(base))
		|| byKey.get(_pluralise(base));

	if (!candidates?.length) return [];
	const sameSource = candidates.filter(it => it.source === preferredSource);
	return sameSource.length ? sameSource : candidates;
};

/**
 * @param {object[]} materials
 * @param {object[]} recipes
 * @param {object} report
 */
export function buildCraftingGraph (materials, recipes, report) {
	const byName = _buildMaterialIndex(materials);
	const recipeByUid = new Map(recipes.map(recipe => [getUid(recipe.name, recipe.source), recipe]));

	// Reset derived links so re-runs are idempotent
	materials.forEach(mat => mat.usedInRecipes = []);

	/* ----- Direction 1: recipe.ingredients → material ----- */
	for (const recipe of recipes) {
		const recipeUid = getUid(recipe.name, recipe.source);

		for (const ingredient of recipe.ingredients || []) {
			const matches = _lookupMaterials(byName, ingredient.name, recipe.source);
			if (!matches.length) {
				ingredient.uid = null;
				report.unresolvedIngredients.push(`${recipe.source} \u2014 "${recipe.name}" ingredient "${ingredient.name}"`);
				continue;
			}

			const match = matches[0];
			ingredient.uid = getUid(match.name, match.source);

			if (!match.usedInRecipes.some(it => it.uid === recipeUid)) {
				match.usedInRecipes.push({name: recipe.name, source: recipe.source, uid: recipeUid});
			}
		}
	}

	/* ----- Direction 2: material.usedIn (Crafting column) → recipe ----- */
	for (const material of materials) {
		const materialUid = getUid(material.name, material.source);

		for (const ref of material.usedIn || []) {
			const refUid = getUid(ref.name, ref.source);
			const recipe = recipeByUid.get(refUid);

			if (!recipe) {
				// Not every `Crafting` target is a craftable we model (many point at DMG items)
				ref.isExternal = true;
				if (!material.usedInRecipes.some(it => it.uid === refUid)) {
					material.usedInRecipes.push({name: ref.name, source: ref.source, uid: refUid, isExternal: true});
				}
				continue;
			}

			if (!material.usedInRecipes.some(it => it.uid === refUid)) {
				material.usedInRecipes.push({name: recipe.name, source: recipe.source, uid: refUid});
			}

			recipe.ingredients ||= [];
			if (!recipe.ingredients.some(ing => ing.uid === materialUid)) {
				recipe.ingredients.push({
					name: material.name,
					quantity: 1,
					uid: materialUid,
					isInferred: true,
				});
			}
		}
	}

	// `usedIn` was scratch state for building the graph; `usedInRecipes` supersedes it
	materials.forEach(mat => delete mat.usedIn);

	report.graph = {
		materialsWithRecipes: materials.filter(it => it.usedInRecipes.length).length,
		recipesWithIngredients: recipes.filter(it => (it.ingredients || []).length).length,
		externalRecipeRefs: materials.reduce((acc, it) => acc + it.usedInRecipes.filter(ref => ref.isExternal).length, 0),
	};
}

/**
 * Flags materials that share a name across books, so the page can surface an
 * "also appears in" cross-reference instead of silently hiding a duplicate.
 */
export function markDuplicates (materials) {
	/** @type {Map<string, object[]>} */
	const byName = new Map();
	for (const mat of materials) {
		const key = _normKey(mat.name);
		if (!byName.has(key)) byName.set(key, []);
		byName.get(key).push(mat);
	}

	for (const candidates of byName.values()) {
		if (candidates.length < 2) continue;
		for (const mat of candidates) {
			mat.alsoIn = candidates
				.filter(other => other !== mat)
				.map(other => ({name: other.name, source: other.source}));
		}
	}
}
