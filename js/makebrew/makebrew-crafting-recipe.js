import {
	CRAFTING_WORKBENCH_VOCABULARY,
	CraftingWorkbenchCore,
} from "../itembuilder/crafting-workbench-core.js";
import {RenderCrafting} from "../render-crafting.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {CraftingWorkbenchBuilderBase} from "./makebrew-crafting-workbench.js";

const _key = value => String(value ?? "").trim().toLowerCase();

export class CraftingRecipeBuilder extends CraftingWorkbenchBuilderBase {
	constructor () {
		super({prop: "craftingRecipe"});
		this._materialCatalog = [];
		this._recipeCatalog = [];
	}

	static getCatalogs ({generated, brew}) {
		return {
			materials: CraftingWorkbenchCore.dedupe([...(generated?.craftingMaterial || []), ...(brew?.craftingMaterial || [])]),
			recipes: CraftingWorkbenchCore.dedupe([...(generated?.craftingRecipe || []), ...(brew?.craftingRecipe || [])]),
		};
	}

	async _pInit () {
		const [generated, brew] = await Promise.all([
			DataUtil.craftingMaterial.loadJSON(),
			BrewUtil2.pGetBrewProcessed(),
		]);
		const catalogs = this.constructor.getCatalogs({generated, brew});
		this._materialCatalog = catalogs.materials;
		this._recipeCatalog = catalogs.recipes;
	}

	_getCoreOptions () {
		return {materialCatalog: this._materialCatalog};
	}

	async pHandleClickLoadExisting () {
		if (!this._recipeCatalog.length) return JqueryUtil.doToast({type: "warning", content: "No crafting recipes are available to use as a starting point."});
		const selected = await InputUiUtil.pGetUserEnum({
			title: "Choose Crafting Recipe",
			values: this._recipeCatalog,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			isResolveItem: true,
		});
		if (!selected) return;
		return this.pHandleLoadExistingData(selected);
	}

	_getStageDefinitions () {
		return [
			{name: "Base", render: this._renderBaseStage.bind(this)},
			{name: "Craft Requirements", render: this._renderRequirementsStage.bind(this)},
			{name: "Ingredients", render: this._renderIngredientsStage.bind(this)},
			{name: "Outcomes & Description", render: this._renderOutcomesStage.bind(this)},
			{name: "Review & Save", render: this._renderReviewStage.bind(this)},
		];
	}

	_getField ({label, control, hint = null}) {
		return ee`<label class="mkbru_cw__field">
			<span class="mkbru_cw__field-label">${label}</span>
			<span class="mkbru_cw__field-control">${control}${hint ? `<span class="ve-muted ve-small">${hint}</span>` : ""}</span>
		</label>`;
	}

	_renderText ({wrp, label, object, prop, cb, hint = null, placeholder = "", type = "text", fnParse = null}) {
		const input = ee`<input class="ve-form-control ve-input-xs form-control--minimal" type="${type}" placeholder="${placeholder.qq()}">`
			.val(object[prop] ?? "")
			.onn("change", () => {
				const raw = input.val();
				const value = fnParse ? fnParse(raw) : raw.trim();
				if (value == null || value === "") delete object[prop];
				else object[prop] = value;
				cb();
			});
		this._getField({label, control: input, hint}).appendTo(wrp);
		return input;
	}

	_renderNumber (opts) {
		return this._renderText({
			...opts,
			type: "number",
			fnParse: raw => raw.trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw),
		});
	}

	_renderSelect ({wrp, label, object, prop, values, cb, fnDisplay = it => it, nullable = true, hint = null}) {
		const select = ee`<select class="ve-form-control ve-input-xs form-control--minimal">
			${nullable ? `<option value="">(None)</option>` : ""}
			${values.map(value => `<option value="${`${value}`.qq()}">${fnDisplay(value).qq()}</option>`)}
		</select>`
			.val(object[prop] == null ? "" : `${object[prop]}`)
			.onn("change", () => {
				const value = select.val();
				if (nullable && value === "") delete object[prop];
				else object[prop] = value;
				cb();
			});
		this._getField({label, control: select, hint}).appendTo(wrp);
		return select;
	}

	_renderNullableBoolean ({wrp, label, object, prop, cb}) {
		const state = {value: object[prop] == null ? "" : `${object[prop]}`};
		this._renderSelect({
			wrp,
			label,
			object: state,
			prop: "value",
			values: ["true", "false"],
			cb: () => {
				if (state.value === "") delete object[prop];
				else object[prop] = state.value === "true";
				cb();
			},
			fnDisplay: value => value === "true" ? "Yes" : "No",
		});
	}

	_renderBaseStage ({wrp, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<h3>Identity</h3>
			<p class="ve-muted">Name the recipe and record its homebrew publication details.</p>
		</section>`.appendTo(wrp);
		this._renderText({wrp: section, label: "Name", object: this._draft, prop: "name", cb});
		this._selSource = BuilderUi.getStateIptEnum(
			"Source",
			cb,
			this._draft,
			{vals: this._sourcesCache, fnDisplay: Parser.sourceJsonToFull, nullable: false},
			"source",
		).appendTo(section);
		this._renderNumber({wrp: section, label: "Page", object: this._draft, prop: "page", cb});
		this._renderSelect({
			wrp: section,
			label: "Recipe category",
			object: this._draft,
			prop: "recipeCategory",
			values: CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.categories,
			cb: () => this._doSync({isRenderInput: true}),
			nullable: false,
			fnDisplay: it => it.toTitleCase(),
		});
	}

	_renderRequirementsStage ({wrp, cb}) {
		const requirements = ee`<section class="mkbru_cw__section">
			<h3>Craft requirements</h3>
			<p class="ve-muted">Set the specialist, difficulty, rarity, and any attunement requirement. Custom crafter text can be retained through Advanced canonical JSON.</p>
		</section>`.appendTo(wrp);
		const crafters = [
			...CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.crafters,
			...(
				this._draft.crafter
				&& !CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.crafters.includes(this._draft.crafter)
					? [this._draft.crafter]
					: []
			),
		];
		this._renderSelect({
			wrp: requirements,
			label: "Crafter",
			object: this._draft,
			prop: "crafter",
			values: crafters,
			cb,
			fnDisplay: it => CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.crafters.includes(it) ? it : `${it} (custom)`,
		});
		this._renderNumber({wrp: requirements, label: "Craft DC", object: this._draft, prop: "craftDC", cb});
		if (this._draft.recipeCategory === "dish") {
			this._renderSelect({
				wrp: requirements,
				label: "Dish complexity",
				object: this._draft,
				prop: "complexity",
				values: CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.complexities,
				cb,
				fnDisplay: it => it.toTitleCase(),
			});
		}
		this._renderSelect({
			wrp: requirements,
			label: "Rarity",
			object: this._draft,
			prop: "rarity",
			values: CRAFTING_WORKBENCH_VOCABULARY.rarities,
			cb,
			fnDisplay: it => it.toTitleCase(),
		});
		this._renderNullableBoolean({wrp: requirements, label: "Requires attunement", object: this._draft, prop: "reqAttune", cb});

		const output = ee`<section class="mkbru_cw__section">
			<h3>Crafted output</h3>
			<p class="ve-muted">Value is stored unchanged in copper pieces. Item UID uses <code>name|source</code> form.</p>
		</section>`.appendTo(wrp);
		this._renderNumber({wrp: output, label: "Output value (cp)", object: this._draft, prop: "value", cb});
		this._renderText({wrp: output, label: "Item UID", object: this._draft, prop: "itemUid", cb, placeholder: "item name|source"});
	}

	_renderIngredientsStage ({wrp}) {
		const listId = `mkbru-cw-recipe-materials-${CryptUtil.uid()}`;
		const identityToMaterial = new Map(this._materialCatalog.map(material => [CraftingWorkbenchCore.getIdentity(material), material]));
		const labelToMaterial = new Map(this._materialCatalog.map(material => [_key(this._getMaterialLabel(material)), material]));
		const section = ee`<section class="mkbru_cw__section">
			<div class="mkbru_cw__section-heading">
				<div>
					<h3>Ingredients</h3>
					<p class="ve-muted">Search installed materials, or keep an unresolved authored name. Assign the same alternative set to ingredients which may replace one another.</p>
				</div>
				<button class="ve-btn ve-btn-primary ve-btn-sm" type="button">Add ingredient</button>
			</div>
			<div class="mkbru_cw__rows"></div>
			<datalist id="${listId}">${this._materialCatalog.map(material => `<option value="${this._getMaterialLabel(material).qq()}"></option>`)}</datalist>
		</section>`.appendTo(wrp);
		section.querySelector("button").addEventListener("click", () => {
			this._draft.ingredients = CraftingWorkbenchCore.addRow(this._draft.ingredients, {name: "", quantity: 1});
			this._doSync({isRenderInput: true});
		});
		const rows = section.querySelector(".mkbru_cw__rows");
		this._draft.ingredients.forEach((ingredient, ix) => this._renderIngredientRow({
			wrp: rows,
			ingredient,
			ix,
			listId,
			identityToMaterial,
			labelToMaterial,
		}));
	}

	_renderIngredientRow ({wrp, ingredient, ix, listId, identityToMaterial, labelToMaterial}) {
		const row = this._getRow({
			wrp,
			title: `Ingredient ${ix + 1}`,
			rows: this._draft.ingredients,
			ix,
			fnSetRows: rows => this._draft.ingredients = rows,
		});
		const grid = row.querySelector(".mkbru_cw__row-grid");
		this._renderMaterialReference({wrp: grid, ingredient, listId, identityToMaterial, labelToMaterial});
		const cb = this._cbCache;
		this._renderNumber({wrp: grid, label: "Quantity", object: ingredient, prop: "quantity", cb});
		this._renderText({wrp: grid, label: "Unit", object: ingredient, prop: "unit", cb, placeholder: "portion"});
		this._renderText({wrp: grid, label: "Component group", object: ingredient, prop: "group", cb, hint: "Optional named recipe component, such as Bun."});
		this._renderText({
			wrp: grid,
			label: "Alternative set",
			object: ingredient,
			prop: "_alternativeSet",
			cb: () => this._doSync({isRenderInput: true}),
			hint: "Use the same name or number for ingredients which are alternatives.",
			placeholder: "1 or Filling",
		});
		if (ingredient._alternativeSet) {
			this._renderNumber({
				wrp: grid,
				label: "Alternative order",
				object: ingredient,
				prop: "_alternativeOrder",
				cb,
				hint: "Lower numbers are listed first; ties follow ingredient row order.",
			});
		}
	}

	_renderMaterialReference ({wrp, ingredient, listId, identityToMaterial, labelToMaterial}) {
		const selected = identityToMaterial.get(_key(ingredient._materialRef));
		const input = ee`<input class="ve-form-control ve-input-xs form-control--minimal" type="search" list="${listId}" autocomplete="off" placeholder="Search materials">`
			.val(selected ? this._getMaterialLabel(selected) : ingredient.name || "");
		const status = ee`<span class="${selected ? "text-success" : "text-warning"} ve-small" role="status">${
			selected
				? `Resolved as ${CraftingWorkbenchCore.getIdentity(selected)}.`
				: "Unresolved; the authored name will be saved without a UID."
		}</span>`;
		input.onn("change", () => {
			const raw = input.val().trim();
			const material = labelToMaterial.get(_key(raw)) || identityToMaterial.get(_key(raw));
			if (material) {
				ingredient.name = material.name;
				ingredient._materialRef = CraftingWorkbenchCore.getIdentity(material);
			} else {
				ingredient.name = raw;
				delete ingredient._materialRef;
			}
			this._doSync({isRenderInput: true});
		});
		this._getField({
			label: "Material",
			control: ee`<span class="mkbru_cw__material-search">${input}${status}</span>`,
			hint: "Generated and installed Brew materials are deduplicated by name and source.",
		}).appendTo(wrp);
	}

	_getMaterialLabel (material) {
		return `${material.name} (${Parser.sourceJsonToAbv(material.source)})`;
	}

	_getRow ({wrp, title, rows, ix, fnSetRows}) {
		const row = ee`<article class="mkbru_cw__row">
			<header><strong>${title}</strong><div class="mkbru_cw__row-actions"></div></header>
			<div class="mkbru_cw__row-grid"></div>
		</article>`.appendTo(wrp);
		const actions = row.querySelector(".mkbru_cw__row-actions");
		const move = delta => {
			fnSetRows(CraftingWorkbenchCore.moveRow(rows, ix, ix + delta));
			this._doSync({isRenderInput: true});
		};
		ee`<div class="ve-btn-group">
			<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move up" aria-label="Move ${title} up"><span class="glyphicon glyphicon-arrow-up"></span></button>
			<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move down" aria-label="Move ${title} down"><span class="glyphicon glyphicon-arrow-down"></span></button>
			<button class="ve-btn ve-btn-xs ve-btn-danger" type="button" title="Remove" aria-label="Remove ${title}"><span class="glyphicon glyphicon-trash"></span></button>
		</div>`.appendTo(actions);
		const [up, down, remove] = actions.querySelectorAll("button");
		up.disabled = ix === 0;
		down.disabled = ix === rows.length - 1;
		up.addEventListener("click", () => move(-1));
		down.addEventListener("click", () => move(1));
		remove.addEventListener("click", () => {
			fnSetRows(CraftingWorkbenchCore.removeRow(rows, ix));
			this._doSync({isRenderInput: true});
		});
		return row;
	}

	_renderOutcomesStage ({wrp, cb}) {
		const description = ee`<section class="mkbru_cw__section">
			<h3>Description</h3>
			<p class="ve-muted">Use 5etools entry syntax for flavour and mechanical text.</p>
		</section>`.appendTo(wrp);
		BuilderUi.getStateIptEntries(
			"Description",
			cb,
			this._draft,
			{nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice},
			"entries",
		).appendTo(description);

		const outcomes = ee`<section class="mkbru_cw__section">
			<h3>Dish outcomes</h3>
			<p class="ve-muted">Optional Success, Delicious, and Extra Delicious tiers each accept nested 5etools entries.</p>
		</section>`.appendTo(wrp);
		if (this._draft.recipeCategory !== "dish") {
			ee`<p class="ve-muted">Change the recipe category to Dish to author outcome tiers. Existing expert outcome data is preserved.</p>`.appendTo(outcomes);
			return;
		}
		for (const tier of CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.outcomeTiers) this._renderOutcomeTier({wrp: outcomes, tier});
	}

	_renderOutcomeTier ({wrp, tier}) {
		const label = tier.replace(/([A-Z])/g, " $1").toTitleCase();
		let outcome = this._draft.outcomes.find(it => it.tier === tier);
		const checkbox = ee`<input type="checkbox">`
			.prop("checked", !!outcome)
			.onn("change", () => {
				if (checkbox.prop("checked")) this._draft.outcomes = CraftingWorkbenchCore.addRow(this._draft.outcomes, {tier, entries: []});
				else this._draft.outcomes = this._draft.outcomes.filter(it => it.tier !== tier);
				this._doSync({isRenderInput: true});
			});
		const section = ee`<fieldset class="mkbru_cw__outcome">
			<legend><label class="mkbru_cw__check">${checkbox}<span>${label}</span></label></legend>
		</fieldset>`.appendTo(wrp);
		if (!outcome) return;
		outcome = this._draft.outcomes.find(it => it.tier === tier);
		BuilderUi.getStateIptEntries(
			`${label} entries`,
			this._cbCache,
			outcome,
			{nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice},
			"entries",
		).appendTo(section);
	}

	_renderReviewStage ({wrp}) {
		this._wrpReview = wrp;
		this._renderReviewContent();
	}

	_refreshReview () {
		if (this._wrpReview) this._renderReviewContent();
	}

	_renderReviewContent () {
		const wrp = this._wrpReview.empty();
		const canonical = CraftingWorkbenchCore.serialize("craftingRecipe", this._draft, this._getCoreOptions());
		const preview = this.constructor.getPreviewEntity("craftingRecipe", canonical);
		const previewTable = ee`<table class="ve-w-100 ve-stats" aria-label="Crafting recipe review preview"></table>`;
		const unresolved = this._draft.ingredients.filter(ingredient => !ingredient._materialRef).length;
		ee`<section class="mkbru_cw__review">
			<div class="mkbru_cw__review-summary">
				<h3>Review ${this._draft.name || "unnamed recipe"}</h3>
				<p>${(this._draft.recipeCategory || "No category").toTitleCase()} · ${this._draft.source || "No source"}</p>
				<p>${this._draft.ingredients.length} ingredient${this._draft.ingredients.length === 1 ? "" : "s"} · ${unresolved} unresolved · ${this._draft.outcomes.length} outcome tier${this._draft.outcomes.length === 1 ? "" : "s"}</p>
				<p class="ve-muted">Resolve any validation error above, then use Save in the builder toolbar. Unresolved material names are warnings and remain intact.</p>
			</div>
			<div class="mkbru_cw__review-preview">${previewTable}</div>
		</section>`.appendTo(wrp);
		previewTable.appends(RenderCrafting.getRenderedCrafting(preview, {isSkipExcludesRender: true}));
		this._renderAdvancedJson({wrp});
	}
}
