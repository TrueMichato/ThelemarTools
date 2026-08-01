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
		const listSyntax = new ListSyntaxCrafting({fnGetDataList: () => this._dataList});

		super({
			dataSource: DataUtil.craftingMaterial.loadJSON.bind(DataUtil.craftingMaterial),

			pageFilter,

			listSyntax,

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
		this._listSyntaxCrafting = listSyntax;
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
		this._initSearchRescue();
	}

	/**
	 * The default search deliberately covers names and metadata only — folding descriptions into it
	 * would bury "Dragon Blood" under every entry that merely mentions dragons. That precision has a
	 * cost: searching "exhaustion" finds nothing, even though twenty entries cure or cause it, and
	 * the `text:` syntax that would find them is discoverable only by hovering the search box.
	 *
	 * So when a plain search comes up empty, offer the full-text search it should have been, with
	 * the count it would return. The dead end becomes the signpost.
	 */
	_initSearchRescue () {
		const iptSearch = document.getElementById("lst__search");
		const wrpRescue = document.getElementById("crafting-search-rescue");
		if (!iptSearch || !wrpRescue) return;

		this._initSearchPlaceholder(iptSearch);

		this._list.on("updated", () => this._doUpdateSearchRescue({iptSearch, wrpRescue}));
		this._doUpdateSearchRescue({iptSearch, wrpRescue});
	}

	/** Longest first; the widest one that fits the search box is used. */
	static _SEARCH_PLACEHOLDERS = [
		`Search by name, or text:"exhaustion" to search inside`,
		`Search name, or text:"exhaustion"`,
		`Search, or text:"exhaustion"`,
		`Search, or text:"..."`,
	];

	/**
	 * The hint only teaches if it is readable in full — a placeholder truncated mid-example is worse
	 * than a short one. The room available does not track the viewport (the list column narrows when
	 * the two-column layout engages, so a 1024px window offers *less* space than a 768px one), so
	 * measure the box itself rather than guess at a breakpoint.
	 */
	_initSearchPlaceholder (iptSearch) {
		const getTextWidth = (() => {
			const ctx = document.createElement("canvas").getContext("2d");
			return (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
		})();

		const apply = () => {
			const styles = getComputedStyle(iptSearch);
			const font = `${styles.fontSize} ${styles.fontFamily}`;
			// Leave room for the search glass and clear affordances flanking the text.
			const avail = iptSearch.clientWidth - 28;
			const placeholders = this.constructor._SEARCH_PLACEHOLDERS;
			const fitting = placeholders.find(it => getTextWidth(it, font) < avail);
			iptSearch.setAttribute("placeholder", fitting || placeholders.at(-1));
		};

		if (typeof ResizeObserver !== "undefined") new ResizeObserver(apply).observe(iptSearch);
		apply();
	}

	static _RE_SEARCH_COMMAND = /^\s*(?:ingredient|name|stats|info|text)s?:/i;

	_doUpdateSearchRescue ({iptSearch, wrpRescue}) {
		const term = (iptSearch.value || "").trim().toLowerCase();

		// A search that already uses the syntax has nothing left to offer, and one with hits is not
		// stuck. Only a plain search that found nothing is at an impasse.
		const isRescuable = term
			&& !this.constructor._RE_SEARCH_COMMAND.test(term)
			&& !this._list.visibleItems.length;
		if (!isRescuable) return wrpRescue.classList.add("ve-hidden");

		const count = this._getFullTextMatchCount(term);
		if (!count) return wrpRescue.classList.add("ve-hidden");

		wrpRescue.classList.remove("ve-hidden");
		wrpRescue.innerHTML = "";

		const dispTerm = document.createElement("span");
		dispTerm.className = "crafting-search-rescue__term";
		dispTerm.textContent = `\u201c${term}\u201d`;

		const btn = ee`<button type="button" class="ve-btn ve-btn-xxs ve-btn-primary crafting-search-rescue__btn">Search inside text (${count})</button>`
			.onn("click", () => {
				iptSearch.value = `text:"${term}"`;
				iptSearch.dispatchEvent(new Event("keyup", {bubbles: true}));
				iptSearch.focus();
			});

		const eleMsg = document.createElement("span");
		eleMsg.className = "crafting-search-rescue__msg";
		eleMsg.append("No name matches ", dispTerm, ".");

		wrpRescue.append(eleMsg, btn);
	}

	/**
	 * Counts entries whose text matches, through the same filters the list is currently applying, so
	 * the number offered is the number that will appear. Populates the cache `text:` reads, making
	 * the search that follows the click instant.
	 */
	_getFullTextMatchCount (term) {
		const matching = this._list.items
			.filter(li => {
				if (li.data._textCacheStats == null) li.data._textCacheStats = this._listSyntaxCrafting.getSearchCacheStats(this._dataList[li.ix]);
				return li.data._textCacheStats.includes(term);
			});
		return this._list.getFilteredItems({items: matching}).length;
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
