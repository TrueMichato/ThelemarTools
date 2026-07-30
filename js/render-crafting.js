import {SITE_STYLE__CLASSIC} from "./consts.js";
import {RenderPageImplBase} from "./render-page-base.js";

/**
 * Renderers for the three entity kinds on the Crafting & Harvesting hub.
 *
 * Materials, craftables and rules share a stat-block frame but carry very different metadata, so
 * each gets its own implementation rather than one branching mega-renderer.
 */

/* -------------------------------------------- */
/* Shared helpers                               */
/* -------------------------------------------- */

const _fmtValue = (valueCp) => (valueCp == null ? null : Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: valueCp})));

const _getSubtitle = (parts) => {
	const filtered = parts.filter(Boolean);
	if (!filtered.length) return "";
	return `<tr><td colspan="6" class="ve-pt-0"><i>${filtered.join(" &bull; ")}</i></td></tr>`;
};

/** A definition-list style row of `Label: value` pairs. */
const _getMetaRow = (pairs) => {
	const filtered = pairs.filter(([, value]) => value != null && value !== "");
	if (!filtered.length) return "";
	return `<tr><td colspan="6" class="ve-pt-1">${
		filtered.map(([label, value]) => `<div class="crafting__meta-line"><span class="crafting__meta-label">${label}</span> <span class="crafting__meta-value">${value}</span></div>`).join("")
	}</td></tr>`;
};

const _getEffectTagsRow = (ent) => {
	if (!ent.effectTags?.length) return "";
	return `<tr><td colspan="6" class="ve-pt-2">
		<div class="crafting__tags">${
	ent.effectTags.map(tag => `<span class="crafting__tag" data-crafting-tag="${tag.qq()}" title="Filter by &quot;${tag.toTitleCase().qq()}&quot;">${tag.toTitleCase()}</span>`).join("")
}</div>
	</td></tr>`;
};

const _getLinkList = (refs, {renderer, tag = "item"}) => {
	if (!refs?.length) return null;
	return refs
		.map(ref => renderer.render(`{@${tag} ${ref.name}|${ref.source || ""}}`))
		.join(", ");
};

/* -------------------------------------------- */
/* Materials                                    */
/* -------------------------------------------- */

class _RenderCraftingMaterialImpl extends RenderPageImplBase {
	_style = SITE_STYLE__CLASSIC;
	_page = UrlUtil.PG_CRAFTING;
	_dataProp = "craftingMaterial";

	_getRendered ({ent, renderer, opts}) {
		const {htmlPtIsExcluded, htmlPtName, htmlPtPage} = this._getCommonHtmlParts({ent, renderer, opts});

		const harvest = ent.harvest || {};

		const creatureLink = harvest.creature
			? renderer.render(`{@creature ${harvest.creature.name}${harvest.creature.source ? `|${harvest.creature.source}` : "|"}}`)
			: null;

		const creatureNote = harvest.creature?.label && harvest.creature.label !== harvest.creature.name
			? ` <span class="ve-muted">(listed as "${harvest.creature.label.qq()}")</span>`
			: "";

		const usedIn = ent.usedInRecipes?.length
			? ent.usedInRecipes
				.map(ref => (ref.isExternal
					? renderer.render(`{@item ${ref.name}|${ref.source || ""}}`)
					: `<a href="#${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CRAFTING](ref)}">${ref.name.qq()}</a>`))
				.join(", ")
			: null;

		return `
			${Renderer.utils.getBorderTr()}
			${htmlPtIsExcluded}
			${htmlPtName}

			${_getSubtitle([
		Parser.craftingCategoryToFull(ent.materialCategory),
		ent.materialKind ? `counts as ${ent.materialKind}` : null,
		ent.rarity ? ent.rarity.toTitleCase() : null,
	])}

			${_getMetaRow([
		["Harvest DC", harvest.dc != null ? renderer.render(`{@dc ${harvest.dc}}`) : null],
		["Quantity", harvest.quantityRoll || (harvest.quantity != null && harvest.quantity !== 1) ? renderer.render(Parser.craftingQuantityToFull(harvest)) : null],
		["Harvest Time", harvest.time],
		["From", creatureLink ? `${creatureLink}${creatureNote}` : null],
		["Creature Type", harvest.creatureType ? `${harvest.creatureType.toTitleCase()}${harvest.cr != null ? `, CR ${Parser.numberToCr(harvest.cr)}` : ""}` : null],
		["Biome", harvest.biome],
		["Preparation", harvest.requiresPreparation == null ? null : (harvest.requiresPreparation ? "Required" : "Not required")],
		["Shelf Life", Parser.craftingShelfLifeToFull(harvest.shelfLife)],
		["Value", _fmtValue(ent.value)],
		["Weight", ent.weight != null ? `${ent.weight} lb.` : null],
	])}

			${ent.entries?.length ? `<tr><td colspan="6" class="ve-pt-2">${renderer.render({entries: ent.entries}, 1)}</td></tr>` : ""}

			${ent.spells?.length ? `<tr><td colspan="6" class="ve-pt-2"><b>Variant component for:</b> ${_getLinkList(ent.spells, {renderer, tag: "spell"})}</td></tr>` : ""}

			${usedIn ? `<tr><td colspan="6" class="ve-pt-2"><b>Used to craft:</b> ${usedIn}</td></tr>` : ""}

			${ent.alsoIn?.length ? `<tr><td colspan="6" class="ve-pt-1"><i class="ve-muted">Also described in ${ent.alsoIn.map(ref => Parser.sourceJsonToAbv(ref.source)).join(", ")}.</i></td></tr>` : ""}

			${_getEffectTagsRow(ent)}

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

/* -------------------------------------------- */
/* Craftables                                   */
/* -------------------------------------------- */

class _RenderCraftingRecipeImpl extends RenderPageImplBase {
	_style = SITE_STYLE__CLASSIC;
	_page = UrlUtil.PG_CRAFTING;
	_dataProp = "craftingRecipe";

	_getRendered ({ent, renderer, opts}) {
		const {htmlPtIsExcluded, htmlPtName, htmlPtPage} = this._getCommonHtmlParts({ent, renderer, opts});

		// A dish's `entries` is just its flavour line, so it reads best up top; for everything else
		// `entries` is the item's mechanical text, which belongs after the ingredient list.
		const isFlavourFirst = ent.recipeCategory === "dish";
		const htmlPtEntries = ent.entries?.length
			? `<tr><td colspan="6" class="ve-pt-2">${renderer.render({entries: ent.entries}, 1)}</td></tr>`
			: "";

		return `
			${Renderer.utils.getBorderTr()}
			${htmlPtIsExcluded}
			${htmlPtName}

			${_getSubtitle([
		Parser.craftingCategoryToFull(ent.recipeCategory),
		ent.rarity ? ent.rarity.toTitleCase() : null,
		ent.complexity ? `${ent.complexity} recipe` : null,
		ent.reqAttune ? "requires attunement" : null,
	])}

			${isFlavourFirst ? htmlPtEntries : ""}

			${_getMetaRow([
		["Crafted By", ent.crafter],
		[ent.recipeCategory === "dish" ? "Cooking DC" : "Crafting DC", ent.craftDC != null ? renderer.render(`{@dc ${ent.craftDC}}`) : null],
		["Value", _fmtValue(ent.value)],
	])}

			${this._getIngredientsHtml({ent, renderer})}

			${this._getOutcomesHtml({ent, renderer})}

			${isFlavourFirst ? "" : htmlPtEntries}

			${_getEffectTagsRow(ent)}

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}

	_getIngredientsHtml ({ent, renderer}) {
		if (!ent.ingredients?.length) return "";

		// Arcadia recipes split their ingredients into named components ("Bun", "Filling", ...)
		const groups = new Map();
		for (const ingredient of ent.ingredients) {
			const key = ingredient.group || "";
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(ingredient);
		}

		const renderIngredient = (ingredient) => {
			const qty = ingredient.quantity != null && (ingredient.quantity !== 1 || ingredient.unit)
				? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : "\u00d7"} `
				: "";
			const label = ingredient.uid
				? `<a href="#${UrlUtil.encodeForHash(ingredient.uid.split("|"))}">${ingredient.name.qq()}</a>`
				: `<span title="No matching material entry in the loaded books">${ingredient.name.qq()}</span>`;
			const alt = ingredient.isAlternative && ingredient.alternativeIndex > 0 ? `<i class="ve-muted">or </i>` : "";
			const inferred = ingredient.isInferred ? ` <span class="ve-muted" title="Inferred from the material's own Crafting column">*</span>` : "";
			return `<li>${alt}${qty}${label}${inferred}</li>`;
		};

		const body = [...groups.entries()]
			.map(([groupName, ingredients]) => `
				${groupName ? `<div class="crafting__ingredient-group">${groupName.qq()}</div>` : ""}
				<ul class="crafting__ingredients">${ingredients.map(renderIngredient).join("")}</ul>
			`)
			.join("");

		return `<tr><td colspan="6" class="ve-pt-2"><b>Ingredients</b>${body}</td></tr>`;
	}

	_getOutcomesHtml ({ent, renderer}) {
		if (!ent.outcomes?.length) return "";

		const tierToLabel = {success: "Success", delicious: "Delicious", extraDelicious: "Extra Delicious"};

		return `<tr><td colspan="6" class="ve-pt-2">
			<ul class="crafting__outcomes">${
	ent.outcomes.map(outcome => `<li><span class="crafting__outcome-tier">${tierToLabel[outcome.tier] || outcome.tier}:</span> ${renderer.render({entries: outcome.entries}, 2)}</li>`).join("")
}</ul>
		</td></tr>`;
	}
}

/* -------------------------------------------- */
/* Rules                                        */
/* -------------------------------------------- */

class _RenderCraftingRuleImpl extends RenderPageImplBase {
	_style = SITE_STYLE__CLASSIC;
	_page = UrlUtil.PG_CRAFTING;
	_dataProp = "craftingRule";

	_getRendered ({ent, renderer, opts}) {
		const {htmlPtIsExcluded, htmlPtName, htmlPtPage} = this._getCommonHtmlParts({ent, renderer, opts});

		return `
			${Renderer.utils.getBorderTr()}
			${htmlPtIsExcluded}
			${htmlPtName}

			${_getSubtitle([
		Parser.craftingCategoryToFull(ent.ruleCategory),
		ent.skillAbility ? `${Parser.attAbvToFull(ent.skillAbility)}-based skill` : null,
	])}

			<tr><td colspan="6" class="ve-pt-2">${renderer.render({entries: ent.entries}, 1)}</td></tr>

			${ent.otherSources?.length ? `<tr><td colspan="6" class="ve-pt-1"><i class="ve-muted">Also printed in ${ent.otherSources.map(src => `${Parser.sourceJsonToAbv(src.source)} p${src.page}`).join(", ")}.</i></td></tr>` : ""}

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

/* -------------------------------------------- */

export class RenderCrafting {
	static _RENDER_BY_PROP = {
		"craftingMaterial": new _RenderCraftingMaterialImpl(),
		"craftingRecipe": new _RenderCraftingRecipeImpl(),
		"craftingRule": new _RenderCraftingRuleImpl(),
	};

	static getRenderedCrafting (ent) {
		const impl = this._RENDER_BY_PROP[ent.__prop];
		if (!impl) throw new Error(`Unhandled crafting property "${ent.__prop}"!`);
		return impl.getRendered(ent);
	}
}
