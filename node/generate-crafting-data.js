import fs from "fs";
import "../js/parser.js";
import "../js/utils.js";
import "../js/render.js";

import {getEffectTagOverrides, getVariantComponents, pLoadCraftingSourceBooks} from "./generate-crafting-data/crafting-sources.js";
import {applyFallbackTags, deriveEffectTags} from "./generate-crafting-data/crafting-effect-tags.js";
import {buildCreatureResolver} from "./generate-crafting-data/resolve-creatures.js";
import {extractHamundCraftIndex, extractHamundMaterials} from "./generate-crafting-data/extract-hamund-materials.js";
import {extractArcadiaIngredients, extractHerbs} from "./generate-crafting-data/extract-herbs-and-ingredients.js";
import {extractVariantComponents} from "./generate-crafting-data/extract-variant-components.js";
import {extractCompleteCrafterCreatureParts, extractCompleteCrafterMaterials} from "./generate-crafting-data/extract-complete-crafter.js";
import {extractArcadiaRecipes, extractCompleteCrafterRecipes, extractHamundRecipes} from "./generate-crafting-data/extract-recipes.js";
import {extractCraftingRules} from "./generate-crafting-data/extract-rules.js";
import {buildCraftingGraph, markDuplicates} from "./generate-crafting-data/build-graph.js";
import {getUid} from "./generate-crafting-data/crafting-utils.js";

/**
 * Generates `data/crafting.json` — the backing dataset for `crafting.html`.
 *
 * Almost all crafting content across the six source books is prose-locked (harvestable materials
 * exist only as table rows, ingredients only as free text), so this generator lifts it into
 * structured, filterable entities. Run via `npm run gen` or `npm run gen:crafting`.
 */

const OUT_PATH = "./data/crafting.json";

class GenCrafting {
	constructor () {
		this._report = {
			skippedRows: [],
			unresolvedCreatures: new Set(),
			unresolvedIngredients: [],
			untagged: [],
			errors: [],
			graph: null,
		};
	}

	async pRun ({isRefresh = false, isOffline = false} = {}) {
		const books = await pLoadCraftingSourceBooks({isRefresh, isOffline});
		const variantComponentsData = getVariantComponents();
		const overrides = getEffectTagOverrides();

		const fnResolveCreature = buildCreatureResolver();
		const fnDeriveEffectTags = (ctx) => deriveEffectTags({...ctx, overrides});

		const ctx = {fnDeriveEffectTags, fnResolveCreature, report: this._report};
		const hamundBooks = [books.hamundI, books.hamundII, books.hamundIII];

		/* ----- Materials ----- */
		const materials = [
			...extractHamundMaterials(hamundBooks, ctx),
			...extractHerbs(books.herbalism, ctx),
			...extractArcadiaIngredients(books.arcadia11, ctx),
			...extractVariantComponents([variantComponentsData, books.thelemar], books.arcadia8, ctx),
			...extractCompleteCrafterMaterials(books.completeCrafter, ctx),
			...extractCompleteCrafterCreatureParts(books.completeCrafter, ctx),
		];

		/* ----- Recipes ----- */
		const recipes = [
			...extractHamundRecipes(hamundBooks, ctx),
			...extractArcadiaRecipes(books.arcadia11, ctx),
			...extractCompleteCrafterRecipes(books.completeCrafter, ctx),
		];

		/* ----- Rules ----- */
		const rules = extractCraftingRules(books);

		this._dedupe(materials, "craftingMaterial");
		this._dedupe(recipes, "craftingRecipe");
		this._dedupe(rules, "craftingRule");

		this._applyCraftIndex(extractHamundCraftIndex(hamundBooks), recipes);

		buildCraftingGraph(materials, recipes, this._report);
		markDuplicates(materials);

		// Fallback tagging runs last so it can see the crafting graph
		[...materials, ...recipes].forEach(ent => applyFallbackTags(ent, overrides));
		this._report.untagged = [...materials, ...recipes]
			.filter(ent => !ent.effectTags.length)
			.map(ent => getUid(ent.name, ent.source));

		this._sort(materials);
		this._sort(recipes);
		this._sort(rules);

		const output = {
			_meta: {
				sources: this._getSourceMeta(books),
				generatedBy: "node/generate-crafting-data.js",
			},
			craftingMaterial: materials,
			craftingRecipe: recipes,
			craftingRule: rules,
		};

		// Written via `CleanUtil` so `npm run clean-jsons` is a no-op on this file
		fs.writeFileSync(OUT_PATH, CleanUtil.getCleanJson(output), "utf-8");

		this._printReport({materials, recipes, rules});

		return output;
	}

	/**
	 * The handbooks also publish a "Craftable Item / Harvesting Material / Crafter" summary index.
	 * It is the only place some craftables state their crafter, so use it to backfill.
	 */
	_applyCraftIndex (craftIndex, recipes) {
		const byName = new Map();
		for (const recipe of recipes) byName.set(recipe.name.toLowerCase().trim(), recipe);

		let nBackfilled = 0;
		for (const row of craftIndex) {
			const names = row.craftableRefs.length ? row.craftableRefs.map(ref => ref.name) : [row.craftable];
			for (const name of names) {
				const recipe = byName.get(`${name}`.toLowerCase().trim());
				if (!recipe) continue;
				if (!recipe.crafter && row.crafter && row.crafter !== "—") {
					recipe.crafter = row.crafter;
					++nBackfilled;
				}
			}
		}
		if (nBackfilled) this._report.skippedRows.push(`craft index: backfilled crafter for ${nBackfilled} recipe(s)`);
	}

	/** Later duplicates of the same `name|source` are dropped — the first extractor wins. */
	_dedupe (ents, label) {
		const seen = new Set();
		let nDropped = 0;
		for (let i = ents.length - 1; i >= 0; --i) {
			const uid = getUid(ents[i].name, ents[i].source);
			if (seen.has(uid)) {
				ents.splice(i, 1);
				++nDropped;
				continue;
			}
			seen.add(uid);
		}
		if (nDropped) this._report.skippedRows.push(`${label}: dropped ${nDropped} duplicate name|source entries`);
	}

	_sort (ents) {
		ents.sort((a, b) => (a.name || "").localeCompare(b.name || "", "en") || (a.source || "").localeCompare(b.source || "", "en"));
	}

	_getSourceMeta (books) {
		return Object.values(books)
			.flatMap(book => book._meta?.sources || [])
			.map(src => ({json: src.json, abbreviation: src.abbreviation, full: src.full}))
			.filter((src, ix, arr) => arr.findIndex(it => it.json === src.json) === ix);
	}

	_printReport ({materials, recipes, rules}) {
		const report = this._report;
		const nTagged = materials.filter(it => it.effectTags?.length).length + recipes.filter(it => it.effectTags?.length).length;
		const nTaggable = materials.length + recipes.length;

		const log = console.log;

		log(`\nGenerated ${OUT_PATH}`);
		log(`  craftingMaterial  ${materials.length}`);
		log(`  craftingRecipe    ${recipes.length}`);
		log(`  craftingRule      ${rules.length}`);
		log(`\n  Effect-tag coverage  ${nTagged}/${nTaggable} (${((nTagged / nTaggable) * 100).toFixed(1)}%)`);
		log(`  Materials linked to a craftable  ${report.graph.materialsWithRecipes}`);
		log(`  Recipes with ingredients         ${report.graph.recipesWithIngredients}`);
		log(`  External craft targets (DMG/etc) ${report.graph.externalRecipeRefs}`);

		if (report.unresolvedCreatures.size) log(`\n  ${report.unresolvedCreatures.size} unresolved creature name(s) \u2014 these keep their raw name but get no type/CR filter`);
		if (report.unresolvedIngredients.length) log(`  ${report.unresolvedIngredients.length} unresolved ingredient reference(s)`);
		if (report.untagged.length) log(`  ${report.untagged.length} entit(ies) with no effect tags`);
		if (report.skippedRows.length) log(`  ${report.skippedRows.length} skipped/notable row(s)`);

		if (report.errors.length) {
			log(`\n  ERRORS:`);
			report.errors.forEach(err => log(`    \u2022 ${err}`));
		}

		if (process.env.CRAFTING_VERBOSE) {
			log(`\n--- Unresolved creatures ---\n${[...report.unresolvedCreatures].sort().join("\n")}`);
			log(`\n--- Unresolved ingredients ---\n${report.unresolvedIngredients.join("\n")}`);
			log(`\n--- Untagged ---\n${report.untagged.join("\n")}`);
			log(`\n--- Skipped rows ---\n${report.skippedRows.join("\n")}`);
		}

		log("");
	}
}

const generator = new GenCrafting();
export default generator.pRun({
	isRefresh: process.argv.includes("--refresh"),
	isOffline: process.argv.includes("--offline"),
});
