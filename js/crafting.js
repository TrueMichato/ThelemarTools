import {RenderCrafting} from "./render-crafting.js";
import {CraftingHarvestLookup} from "./crafting/crafting-harvest-lookup.js";
import {CraftingPlanner} from "./crafting/crafting-planner.js";

/**
 * The Crafting & Harvesting hub — one filterable list spanning harvestable materials, craftable
 * outputs, and the crafting rules that govern them, backed by `data/crafting.json`.
 */

const _getDisplayCategory = (ent) => Parser.craftingCategoryToFull(ent.materialCategory || ent.recipeCategory || ent.ruleCategory);

/** Harvest DC for materials, crafting DC for craftables; rules have neither. */
const _getDisplayDc = (ent) => ent.harvest?.dc ?? ent.craftDC ?? null;

const _getDisplayValue = (ent) => (ent.value == null ? null : Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: ent.value})));

class CraftingSublistManager extends SublistManager {
	static _getRowTemplate () {
		return [
			new SublistCellTemplate({name: "Type", css: "ve-col-1-5 ve-pl-0 ve-pr-1 ve-text-center", colStyle: "text-center"}),
			new SublistCellTemplate({name: "Name", css: "ve-bold ve-col-5 ve-px-1"}),
			new SublistCellTemplate({name: "Category", css: "ve-col-2-5 ve-px-1 ve-text-center", colStyle: "text-center"}),
			new SublistCellTemplate({name: "DC", css: "ve-col-1-5 ve-px-1 ve-text-center", colStyle: "text-center"}),
			new SublistCellTemplate({name: "Value", css: "ve-col-1-5 ve-pl-1 ve-pr-0 ve-text-center", colStyle: "text-center"}),
		];
	}

	pGetSublistItem (ent, hash) {
		const type = Parser.getPropDisplayName(ent.__prop);
		const typeShort = PageFilterCrafting.getTypeAbbreviation(ent.__prop);
		const category = _getDisplayCategory(ent);
		const dc = _getDisplayDc(ent);
		const value = _getDisplayValue(ent);

		const cellsText = [
			new SublistCell({text: typeShort, title: type}),
			ent.name,
			category,
			dc ?? "\u2014",
			value ?? "\u2014",
		];

		const ele = ee`<div class="ve-lst__row ve-lst__row--sublist ve-flex-col">
			<a href="#${hash}" class="ve-lst__row-border ve-lst__row-inner">
				${this.constructor._getRowCellsHtml({values: cellsText})}
			</a>
		</div>`
			.onn("contextmenu", evt => this._handleSublistItemContextMenu(evt, listItem))
			.onn("click", evt => this._listSub.doSelect(listItem, evt));

		const listItem = new ListItem(
			hash,
			ele,
			ent.name,
			{
				hash,
				type,
				category,
				dc: dc ?? Number.MAX_SAFE_INTEGER,
				value: ent.value ?? Number.MAX_SAFE_INTEGER,
			},
			{
				entity: ent,
				mdRow: [...cellsText],
			},
		);
		return listItem;
	}
}

class CraftingPage extends ListPage {
	constructor () {
		const pageFilter = new PageFilterCrafting();

		super({
			dataSource: DataUtil.craftingMaterial.loadJSON.bind(DataUtil.craftingMaterial),

			pageFilter,

			dataProps: ["craftingMaterial", "craftingRecipe", "craftingRule"],

			listOptions: {
				sortByInitial: "name",
				sortFn: PageFilterCrafting.sortCrafting,
			},

			bookViewOptions: {
				nameSingular: "entry",
				namePlural: "entries",
				pageTitle: "Crafting Book View",
			},
		});

		this._harvestLookup = null;
		this._planner = null;
	}

	getListItem (ent, ixEnt, isExcluded) {
		this._pageFilter.mutateAndAddToFilters(ent, isExcluded);

		const eleLi = document.createElement("div");
		eleLi.className = `ve-lst__row ve-flex-col ${isExcluded ? "ve-lst__row--blocklisted" : ""}`;

		const hash = UrlUtil.autoEncodeHash(ent);
		const source = Parser.sourceJsonToAbv(ent.source);
		const type = Parser.getPropDisplayName(ent.__prop);
		const typeShort = PageFilterCrafting.getTypeAbbreviation(ent.__prop);
		const category = _getDisplayCategory(ent);
		const dc = _getDisplayDc(ent);
		const value = _getDisplayValue(ent);

		eleLi.innerHTML = `<a href="#${hash}" class="ve-lst__row-border ve-lst__row-inner">
			<span class="ve-col-1-2 ve-pl-0 ve-pr-1 ve-text-center" title="${type.qq()}">${typeShort}</span>
			<span class="ve-col-3-8 ve-bold ve-px-1">${ent.name.qq()}</span>
			<span class="ve-col-2-2 ve-px-1 ve-text-center">${category}</span>
			<span class="ve-col-1-1 ve-px-1 ve-text-center">${dc ?? "\u2014"}</span>
			<span class="ve-col-1-4 ve-px-1 ve-text-center">${value ?? "\u2014"}</span>
			<span class="ve-col-2 ve-text-center ${Parser.sourceJsonToSourceClassname(ent.source)} ve-pl-1 ve-pr-0" title="${Parser.sourceJsonToFull(ent.source).qq()}">${source}</span>
		</a>`;

		const listItem = new ListItem(
			ixEnt,
			eleLi,
			ent.name,
			{
				hash,
				source,
				page: ent.page,
				type,
				category,
				dc: dc ?? Number.MAX_SAFE_INTEGER,
				value: ent.value ?? Number.MAX_SAFE_INTEGER,
				creature: ent.harvest?.creature?.name || "",
				effects: (ent.effectTags || []).join(" "),
			},
			{isExcluded},
		);

		eleLi.addEventListener("click", evt => this._list.doSelect(listItem, evt));
		eleLi.addEventListener("contextmenu", evt => this._openContextMenu(evt, this._list, listItem));

		return listItem;
	}

	_renderStats_doBuildStatsTab ({ent}) {
		this._pgContent.empty().appends(RenderCrafting.getRenderedCrafting(ent));
		this._bindEffectTagFilterClicks();
	}

	/** Clicking an effect tag in a stat block filters the list down to that tag. */
	_bindEffectTagFilterClicks () {
		this._pgContent.parente()?.querySelectorAll?.(`[data-crafting-tag]`)?.forEach?.(ele => {
			ele.addEventListener("click", () => {
				this._filterBox.setFromValues({"Effect": {[ele.dataset.craftingTag]: 1}});
				this.handleFilterChange();
			});
		});
	}

	async pOnLoad () {
		await super.pOnLoad();
		this._initTools();
	}

	_initTools () {
		const allEnts = this._dataList;

		this._harvestLookup = new CraftingHarvestLookup({entities: allEnts});
		this._planner = new CraftingPlanner({entities: allEnts, sublistManager: this._sublistManager});

		document.getElementById("btn-harvest-lookup")
			?.addEventListener("click", () => this._harvestLookup.pShow());

		document.getElementById("btn-crafting-planner")
			?.addEventListener("click", () => this._planner.pShow());
	}
}

const craftingPage = new CraftingPage();
craftingPage.sublistManager = new CraftingSublistManager();
window.addEventListener("load", () => craftingPage.pOnLoad());

globalThis.dbg_page = craftingPage;
