import {RenderItemUpgrades} from "./render-itemupgrades.js";

class ItemUpgradesSublistManager extends SublistManager {
	constructor () {
		super({
			sublistListOptions: {
				fnSort: PageFilterItemUpgrades.sortItemUpgrades,
			},
		});
	}

	static _getRowTemplate () {
		return [
			new SublistCellTemplate({
				name: "Name",
				css: "ve-bold ve-col-3 ve-pl-0 ve-pr-1",
				colStyle: "",
			}),
			new SublistCellTemplate({
				name: "Category",
				css: "ve-col-2-5 ve-px-1 ve-text-center",
				colStyle: "ve-text-center",
			}),
			new SublistCellTemplate({
				name: "Tier",
				css: "ve-col-2 ve-px-1 ve-text-center",
				colStyle: "ve-text-center",
			}),
			new SublistCellTemplate({
				name: "Type",
				css: "ve-col-1-5 ve-px-1 ve-text-center",
				colStyle: "ve-text-center",
			}),
			new SublistCellTemplate({
				name: "Cost",
				css: "ve-col-1 ve-px-1",
				colStyle: "",
			}),
			new SublistCellTemplate({
				name: "Source",
				css: "ve-col-2 ve-text-center ve-pl-1 ve-pr-0",
				colStyle: "ve-text-center",
			}),
		];
	}

	pGetSublistItem (it, hash) {
		const cellsText = [
			it.name,
			it._lCategory,
			it._lTier,
			it._lEquipmentType,
			it.cost || "\u2014",
			Parser.sourceJsonToAbv(it.source),
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
			it.name,
			{
				hash,
				category: it._lCategory,
				tier: it._lTier,
				type: it._lEquipmentType,
				cost: it.cost || "",
				source: Parser.sourceJsonToAbv(it.source),
			},
			{
				entity: it,
				mdRow: [...cellsText],
			},
		);
		return listItem;
	}
}

class ItemUpgradesPage extends ListPage {
	constructor () {
		const pageFilter = new PageFilterItemUpgrades();

		super({
			dataSource: DataUtil.itemUpgrade.loadJSON.bind(DataUtil.itemUpgrade),

			pFnGetFluff: Renderer.itemUpgrade.pGetFluff.bind(Renderer.itemUpgrade),

			pageFilter,

			listOptions: {
				fnSort: PageFilterItemUpgrades.sortItemUpgrades,
			},

			dataProps: ["itemUpgrade"],

			bookViewOptions: {
				nameSingular: "item upgrade",
				namePlural: "item upgrades",
				pageTitle: "Item Upgrades Book View",
			},

			isPreviewable: true,
		});
	}

	getListItem (it, ivI, isExcluded) {
		this._pageFilter.mutateAndAddToFilters(it, isExcluded);

		const eleLi = document.createElement("div");
		eleLi.className = `ve-lst__row ve-flex-col ${isExcluded ? "ve-lst__row--blocklisted" : ""}`;

		const source = Parser.sourceJsonToAbv(it.source);
		const hash = UrlUtil.autoEncodeHash(it);
		const cost = it.cost || "\u2014";

		eleLi.innerHTML = `<a href="#${hash}" class="ve-lst__row-border ve-lst__row-inner">
			<span class="ve-col-0-3 ve-px-0 ve-flex-vh-center ve-lst__btn-toggle-expand ve-self-flex-stretch ve-no-select">[+]</span>
			<span class="ve-bold ve-col-2-5 ve-px-1">${it.name}</span>
			<span class="ve-col-1-8 ve-px-1 ve-text-center">${it._lCategory}</span>
			<span class="ve-col-1-5 ve-px-1 ve-text-center">${it._lTier}</span>
			<span class="ve-col-1-2 ve-px-1 ve-text-center">${it._lEquipmentType}</span>
			<span class="ve-col-1-5 ve-px-1">${cost}</span>
			<span class="ve-col-1 ve-px-1 ve-text-center">${it._lHasPrerequisite}</span>
			<span class="ve-grow ${Parser.sourceJsonToSourceClassname(it.source)} ve-text-center ve-pl-1 ve-pr-0" title="${Parser.sourceJsonToFull(it.source)}">${source}</span>
		</a>
		<div class="ve-flex ve-hidden ve-relative ve-accordion__wrp-preview">
			<div class="ve-vr-0 ve-absolute ve-accordion__vr-preview"></div>
			<div class="ve-flex-col ve-py-3 ve-ml-4 ve-accordion__wrp-preview-inner"></div>
		</div>`;

		const listItem = new ListItem(
			ivI,
			eleLi,
			it.name,
			{
				hash,
				source,
				page: it.page,
				cost,
				category: it._lCategory,
				tier: it._lTier,
				type: it._lEquipmentType,
				prerequisite: it._lHasPrerequisite,
			},
			{
				isExcluded,
			},
		);

		eleLi.addEventListener("click", (evt) => this._list.doSelect(listItem, evt));
		eleLi.addEventListener("contextmenu", (evt) => this._openContextMenu(evt, this._list, listItem));

		return listItem;
	}

	_renderStats_doBuildStatsTab ({ent}) {
		this._wrpTabs.parente().find(`.item-upgrade-type`)?.remove();

		Promise.any([
			Renderer.utils.pHasFluffText(ent, "itemUpgradeFluff"),
			Renderer.utils.pHasFluffImages(ent, "itemUpgradeFluff"),
		])
			.then(hasAnyFluff => {
				const wrpType = ee`<div class="item-upgrade-type"></div>`;

				if (hasAnyFluff) wrpType.addClass("ve-ml-0 ve-mb-1").insertBefore(this._wrpTabs);
				else wrpType.prependTo(this._wrpTabs);

				const commonPrefix = ent.upgradeType.length > 1 ? MiscUtil.findCommonPrefix(ent.upgradeType.map(t => Parser.itemUpgradeTypeToFull(t)), {isRespectWordBoundaries: true}) : "";
				if (commonPrefix) wrpType.appends(`<span>${commonPrefix.trim()} </span>`);

				ent.upgradeType.forEach((ut, i) => {
					if (i > 0) wrpType.appends(`<span>/</span>`);
					ee`<span class="ve-roller">${Parser.itemUpgradeTypeToFull(ut).substring(commonPrefix.length)}</span>`
						.onn("click", () => {
							this._filterBox.setFromValues({"Upgrade Type": {[ut]: 1}});
							this.handleFilterChange();
						})
						.appendTo(wrpType);
				});
			});

		this._pgContent.empty().appends(RenderItemUpgrades.getRenderedItemUpgrade(ent));
	}
}

const itemUpgradesPage = new ItemUpgradesPage();
itemUpgradesPage.sublistManager = new ItemUpgradesSublistManager();
window.addEventListener("load", () => itemUpgradesPage.pOnLoad());

globalThis.dbg_page = itemUpgradesPage;
