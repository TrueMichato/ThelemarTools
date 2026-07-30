/**
 * Crafting Planner — turn a set of craftables into an actionable shopping list.
 *
 * Reads whatever the user has pinned to the sublist (falling back to a picker), aggregates the
 * required materials across all of them, and shows where each material comes from, what DC it
 * needs, and what the whole lot is worth.
 */
export class CraftingPlanner {
	constructor ({entities, sublistManager}) {
		this._sublistManager = sublistManager;

		this._materialsByUid = new Map();
		this._recipes = [];

		for (const ent of entities) {
			if (ent.__prop === "craftingMaterial") this._materialsByUid.set(this.constructor._getUid(ent), ent);
			else if (ent.__prop === "craftingRecipe") this._recipes.push(ent);
		}
	}

	static _getUid (ent) { return `${ent.name.toLowerCase()}|${ent.source.toLowerCase()}`; }

	async pShow () {
		const {eleModalInner} = UiUtil.getShowModal({
			title: "Crafting Planner",
			isHeight100: true,
			isWidth100: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input class="ve-form-control" placeholder="Add a craftable\u2026" autocomplete="off" spellcheck="false">`;
		const wrpPicker = ee`<div class="crafting-tool__picker ve-overflow-y-auto"></div>`;
		const wrpPlan = ee`<div class="ve-overflow-y-auto ve-h-100 ve-min-h-0 crafting-tool__results"></div>`;

		/** @type {object[]} */
		const selected = this._getPinnedRecipes();

		const renderPlan = () => {
			wrpPlan.empty();
			ee(wrpPlan)`${this._getPlanHtml(selected, {onRemove: (recipe) => {
				const ix = selected.indexOf(recipe);
				if (~ix) selected.splice(ix, 1);
				renderPlan();
			}})}`;
		};

		const renderPicker = () => {
			const term = iptSearch.value.trim().toLowerCase();
			wrpPicker.empty();
			if (!term) return;

			const matches = this._recipes
				.filter(it => it.name.toLowerCase().includes(term) && !selected.includes(it))
				.slice(0, 12);

			if (!matches.length) {
				ee(wrpPicker)`<div class="ve-muted ve-p-1">No craftable matches "${term}".</div>`;
				return;
			}

			matches.forEach(recipe => {
				ee`<div class="crafting-tool__picker-row">
					<span>${recipe.name} <span class="ve-muted">(${Parser.sourceJsonToAbv(recipe.source)})</span></span>
				</div>`
					.onn("click", () => {
						if (!selected.includes(recipe)) selected.push(recipe);
						iptSearch.value = "";
						renderPicker();
						renderPlan();
					})
					.appendTo(wrpPicker);
			});
		};

		iptSearch.addEventListener("input", () => renderPicker());

		ee(eleModalInner)`
			<div class="ve-mb-1 ve-relative">
				${iptSearch}
				${wrpPicker}
			</div>
			${wrpPlan}
		`;

		renderPlan();
		iptSearch.focus();
	}

	/** Craftables the user has pinned to the sublist, so the planner opens pre-populated. */
	_getPinnedRecipes () {
		const items = this._sublistManager?.sublistItems || [];
		return [...new Set(
			items
				.map(li => li.data?.entity)
				.filter(ent => ent?.__prop === "craftingRecipe"),
		)];
	}

	_getPlanHtml (recipes, {onRemove}) {
		if (!recipes.length) {
			return ee`<div class="ve-muted ve-p-2">
				Search above to add craftables, or pin some from the main list first \u2014 the planner picks up whatever is in your pinned list.
			</div>`;
		}

		const plan = this._buildPlan(recipes);

		const wrp = ee`<div></div>`;

		/* ----- What we're making ----- */
		const recipeRows = recipes.map(recipe => {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CRAFTING](recipe);
			const btnRemove = ee`<button class="ve-btn ve-btn-xxs ve-btn-danger" title="Remove from plan">\u00d7</button>`
				.onn("click", () => onRemove(recipe));
			return ee`<tr>
				<td><a href="#${hash}">${recipe.name}</a></td>
				<td class="ve-text-center">${recipe.crafter || "\u2014"}</td>
				<td class="ve-text-center">${recipe.craftDC ?? "\u2014"}</td>
				<td class="ve-text-center">${recipe.rarity ? recipe.rarity.toTitleCase() : "\u2014"}</td>
				<td class="ve-text-center">${btnRemove}</td>
			</tr>`;
		});

		ee(wrp)`<div class="crafting-tool__section">
			<div class="crafting-tool__section-head">Making</div>
			<table class="ve-w-100 crafting-tool__table stripe-odd-table">
				<thead><tr>
					<th>Craftable</th>
					<th class="ve-text-center">Crafter</th>
					<th class="ve-text-center">DC</th>
					<th class="ve-text-center">Rarity</th>
					<th class="ve-text-center"></th>
				</tr></thead>
				<tbody>${recipeRows}</tbody>
			</table>
		</div>`;

		/* ----- Shopping list ----- */
		const renderer = Renderer.get();

		const materialRows = plan.materials.map(line => {
			const {material} = line;
			const hash = material ? UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CRAFTING](material) : null;
			const nameHtml = hash
				? `<a href="#${hash}">${line.name.qq()}</a>`
				: `<span title="No matching material entry in the loaded books">${line.name.qq()}</span>`;

			const sourceHtml = material?.harvest?.creature?.name
				? renderer.render(`{@creature ${material.harvest.creature.name}${material.harvest.creature.source ? `|${material.harvest.creature.source}` : "|"}}`)
				: (material?.harvest?.biome || "\u2014");

			const unitValue = material?.value != null ? material.value : null;
			const lineValue = unitValue != null ? unitValue * line.quantity : null;

			return `<tr${line.isAlternative ? ` class="crafting-tool__row--alt"` : ""}>
				<td class="ve-text-center">${line.quantity % 1 ? line.quantity.toFixed(2) : line.quantity}${line.unit ? ` ${line.unit}` : ""}</td>
				<td>${line.isAlternative ? `<i class="ve-muted">or </i>` : ""}${nameHtml}</td>
				<td class="ve-text-center">${material?.harvest?.dc ?? "\u2014"}</td>
				<td>${sourceHtml}</td>
				<td class="ve-text-center">${lineValue != null ? Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: lineValue})) : "\u2014"}</td>
				<td>${line.forRecipes.join(", ").qq()}</td>
			</tr>`;
		}).join("");

		ee(wrp)`<div class="crafting-tool__section">
			<div class="crafting-tool__section-head">Shopping List</div>
			<table class="ve-w-100 crafting-tool__table stripe-odd-table">
				<thead><tr>
					<th class="ve-text-center">Qty</th>
					<th>Material</th>
					<th class="ve-text-center">Harvest DC</th>
					<th>Source</th>
					<th class="ve-text-center">Value</th>
					<th>Needed For</th>
				</tr></thead>
				<tbody>${materialRows}</tbody>
			</table>
			<div class="crafting-tool__totals">
				<span><b>Materials:</b> ${plan.materials.length}</span>
				<span><b>Known value:</b> ${plan.totalValueCp ? Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: plan.totalValueCp})) : "\u2014"}</span>
				${plan.nUnknown ? `<span class="ve-muted">${plan.nUnknown} material${plan.nUnknown === 1 ? " has" : "s have"} no listed value</span>` : ""}
				${plan.highestDc != null ? `<span><b>Highest harvest DC:</b> ${plan.highestDc}</span>` : ""}
			</div>
		</div>`;

		return wrp;
	}

	/** Aggregate every recipe's ingredients into a single de-duplicated list. */
	_buildPlan (recipes) {
		/** @type {Map<string, object>} */
		const byKey = new Map();

		for (const recipe of recipes) {
			for (const ingredient of recipe.ingredients || []) {
				const material = ingredient.uid ? this._materialsByUid.get(ingredient.uid) : null;
				const key = ingredient.uid || `~${ingredient.name.toLowerCase()}`;

				if (!byKey.has(key)) {
					byKey.set(key, {
						name: material?.name ?? ingredient.name,
						material,
						quantity: 0,
						unit: ingredient.unit ?? null,
						isAlternative: !!ingredient.isAlternative,
						forRecipes: [],
					});
				}

				const line = byKey.get(key);
				line.quantity += ingredient.quantity ?? 1;
				if (!line.forRecipes.includes(recipe.name)) line.forRecipes.push(recipe.name);
			}
		}

		const materials = [...byKey.values()]
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const totalValueCp = materials
			.reduce((acc, line) => acc + (line.material?.value != null ? line.material.value * line.quantity : 0), 0);

		const dcs = materials.map(line => line.material?.harvest?.dc).filter(dc => dc != null);

		return {
			materials,
			totalValueCp: Math.round(totalValueCp),
			nUnknown: materials.filter(line => line.material?.value == null).length,
			highestDc: dcs.length ? Math.max(...dcs) : null,
		};
	}
}
