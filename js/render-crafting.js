import {SITE_STYLE__CLASSIC} from "./consts.js";
import {RenderPageImplBase} from "./render-page-base.js";

/**
 * Renderers for the four entity kinds on the Crafting & Harvesting hub.
 *
 * Harvestable materials, craftables, rules and item materials share a stat-block frame but carry
 * very different metadata, so each gets its own implementation rather than one branching
 * mega-renderer.
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
/* Item materials (Thelemar)                    */
/* -------------------------------------------- */

class _RenderItemMaterialImpl extends RenderPageImplBase {
	_style = SITE_STYLE__CLASSIC;
	_page = UrlUtil.PG_CRAFTING;
	_dataProp = "itemMaterial";

	_getRendered ({ent, renderer, opts}) {
		const {htmlPtIsExcluded, htmlPtName, htmlPtPage} = this._getCommonHtmlParts({ent, renderer, opts});

		return `
			${Renderer.utils.getBorderTr()}
			${htmlPtIsExcluded}
			${htmlPtName}

			${_getSubtitle([
		Parser.craftingCategoryToFull(ent.materialCategory),
		ent.rarity && ent.rarity !== "none" ? `${ent.rarity}`.toTitleCase() : null,
		ent.primaryRole ? Parser.itemMaterialRoleToFull(ent.primaryRole) : null,
	])}

			${this._getAxesRow({ent})}

			${_getMetaRow([
		["Density", this._getDensityHtml(ent)],
		["Price", ent.price?.display || null],
		["Object AC", this._getObjectAcHtml(ent)],
		["Roles", (ent.roles || []).map(Parser.itemMaterialRoleToFull).join(", ") || null],
		["Applies To", (ent.appliesTo || []).map(Parser.itemMaterialAppliesToFull).join(", ") || null],
		["Elemental Plane", ent.elementalPlane || null],
	])}

			${_getEffectTagsRow(ent)}

			${ent.entries?.length ? `<tr><td colspan="6" class="ve-pt-2">${renderer.render({entries: ent.entries}, 1)}</td></tr>` : ""}

			${this._getMagicCapacityRulesHtml({ent})}
			${this._getDraconicResonanceHtml({ent})}
			${this._getDegradationHtml({ent})}

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}

	/** The six axes as a compact table — the headline of every material. */
	_getAxesRow ({ent}) {
		const cells = Parser.ITEM_MATERIAL_AXES
			.map(axis => `<div class="crafting__axis">
				<div class="crafting__axis-label">${axis.full}</div>
				<div class="crafting__axis-value">${Parser.itemMaterialAxisToFull(ent[axis.key], {isSigned: axis.isSigned})}</div>
			</div>`)
			.join("");
		return `<tr><td colspan="6" class="ve-pt-2"><div class="crafting__axes">${cells}</div></td></tr>`;
	}

	_getDensityHtml (ent) {
		if (ent.densityVaries || ent.density == null) return "Varies";
		const mult = ent.weightMultiplier != null
			? ` <span class="ve-muted">(weight &times;${ent.weightMultiplier})</span>`
			: "";
		return `${ent.density}${mult}`;
	}

	_getObjectAcHtml (ent) {
		if (ent.objectAc == null) return null;
		return ent.objectAcInferred
			? `${ent.objectAc} <span class="ve-muted">(inferred from the closest ordinary material)</span>`
			: `${ent.objectAc}`;
	}

	_getMagicCapacityRulesHtml ({ent}) {
		if (!ent.magicCapacityRules?.length) return "";
		const RULE_TO_TEXT = {
			"opposedStatesCountAsOne": "Two opposed magical states count as a single effect against this material's capacity.",
			"makerForeknowledge": "The maker knows in advance whether adding another effect would exceed the capacity.",
			"dcRiseThreshold": "The interference DC only begins to rise once the capacity is exceeded by more than the listed amount.",
			"freeEffect": "The first qualifying effect does not count against the capacity.",
		};
		const items = ent.magicCapacityRules
			.map(rule => {
				// The authored note is the book's own wording and is always more precise than the
				// generic fallback, so it wins wherever it is present.
				const base = rule.note || RULE_TO_TEXT[rule.type] || rule.type;
				const detail = [
					rule.when ? `when ${rule.when}` : null,
					rule.theme ? `${rule.theme} effects` : null,
					rule.value != null ? `value ${rule.value}` : null,
				].filter(Boolean).join(", ");
				return `<li>${Renderer.stripTags(base).qq()}${detail ? ` <span class="ve-muted">(${detail.qq()})</span>` : ""}</li>`;
			})
			.join("");
		return `<tr><td colspan="6" class="ve-pt-2"><b>Magic Capacity Exceptions</b><ul>${items}</ul></td></tr>`;
	}

	/**
	 * A material made of solid dragon remains can carry one Draconic Domain Resonance. The
	 * eighteen resonances are shared reference data rather than a browsable entity, so they
	 * are printed inline here — a reader looking at Dragon Bone should not have to go
	 * hunting for what a resonance actually does.
	 */
	_getDraconicResonanceHtml ({ent}) {
		const slots = (ent.effects || []).find(fx => fx.type === "draconicResonanceSlot");
		if (!slots) return "";
		const all = (globalThis.__craftingDraconicResonances || []);
		if (!all.length) return "";
		const rows = ["fear", "safety"]
			.flatMap(kind => all.filter(r => r.kind === kind))
			.map(r => `<tr>
				<td class="ve-text-center">${(r.kind || "").toTitleCase().qq()}</td>
				<td>${(r.domain || "").qq()}</td>
				<td><b>${r.name.qq()}</b> ${Renderer.stripTags(r.entries?.[0] || "").qq()}</td>
			</tr>`)
			.join("");
		return `<tr><td colspan="6" class="ve-pt-2">
			<b>Draconic Domain Resonance</b>
			<div class="ve-muted ve-small">This material may carry ${slots.count ?? 1} resonance from its source dragon's domain.</div>
			<table class="w-100 ve-tbl-border stripe-odd-table"><thead><tr>
				<th class="ve-text-center">Kind</th><th>Domain</th><th>Resonance</th>
			</tr></thead><tbody>${rows}</tbody></table>
		</td></tr>`;
	}

	_getDegradationHtml ({ent}) {
		const deg = ent.degradation;
		if (!deg) return "";

		const TRIGGER_TO_TEXT = {
			"attackRoll": "on an attack roll",
			"critReceived": "when struck by a critical hit",
			"damaged": "when damaged",
		};
		const EFFECT_TO_TEXT = {
			"damageStepDelta": (v) => `${v > 0 ? "increases" : "reduces"} its Damage by ${Math.abs(v)} step${Math.abs(v) === 1 ? "" : "s"}`,
			"protectionDelta": (v) => `${v > 0 ? "increases" : "reduces"} its Protection by ${Math.abs(v)}`,
			"axesToZero": () => "drops the listed axes to 0",
		};
		const REPAIR_TO_TEXT = {
			"shortRest": "repaired over a Short Rest",
			"tool": "repaired with the listed tools",
			"none": "cannot be repaired",
		};

		const natural = deg.trigger?.natural?.length ? ` (natural ${deg.trigger.natural.join(" or ")})` : "";
		const trigger = `${TRIGGER_TO_TEXT[deg.trigger?.on] || deg.trigger?.on || "in use"}${natural}`;

		const fnEffect = EFFECT_TO_TEXT[deg.effect?.type];
		const effect = deg.destroys
			? "the item is destroyed"
			: (fnEffect ? fnEffect(deg.effect.value) : `${deg.effect?.type || "degrades"}`);

		const repair = deg.repair
			? `${REPAIR_TO_TEXT[deg.repair.method] || deg.repair.method}${deg.repair.tool ? ` (${deg.repair.tool.qq()})` : ""}`
			: null;

		return `<tr><td colspan="6" class="ve-pt-2"><b>Degradation</b><ul>
			<li>${trigger.qq()}, ${effect.qq()}${deg.stacking ? " (cumulative)" : ""}.</li>
			${repair ? `<li>Can be ${repair.qq()}.</li>` : ""}
		</ul></td></tr>`;
	}
}

/* -------------------------------------------- */

export class RenderCrafting {
	static _RENDER_BY_PROP = {
		"craftingMaterial": new _RenderCraftingMaterialImpl(),
		"craftingRecipe": new _RenderCraftingRecipeImpl(),
		"craftingRule": new _RenderCraftingRuleImpl(),
		"itemMaterial": new _RenderItemMaterialImpl(),
	};

	static getRenderedCrafting (ent) {
		const impl = this._RENDER_BY_PROP[ent.__prop];
		if (!impl) throw new Error(`Unhandled crafting property "${ent.__prop}"!`);
		return impl.getRendered(ent);
	}
}
