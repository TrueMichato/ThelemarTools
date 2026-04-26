"use strict";

class PageFilterItemUpgrades extends PageFilterBase {
	// region static
	static _filterUpgradeTypeSort (a, b) {
		return SortUtil.ascSort(Parser.itemUpgradeTypeToFull(a.item), Parser.itemUpgradeTypeToFull(b.item));
	}

	static sortItemUpgrades (itemA, itemB, options) {
		if (options.sortBy === "type") {
			return SortUtil.ascSortLower(itemA.values.type, itemB.values.type) || SortUtil.listSort(itemA, itemB, options);
		}
		if (options.sortBy === "cost") {
			return SortUtil.ascSortLower(itemA.values.cost, itemB.values.cost) || SortUtil.listSort(itemA, itemB, options);
		}
		return SortUtil.listSort(itemA, itemB, options);
	}
	// endregion

	constructor () {
		super();

		this._typeFilter = new Filter({
			header: "Upgrade Type",
			items: [],
			displayFn: Parser.itemUpgradeTypeToFull,
			itemSortFn: PageFilterItemUpgrades._filterUpgradeTypeSort,
		});
		this._categoryFilter = new Filter({
			header: "Category",
			items: ["Weapon Upgrade", "Armor Upgrade", "Gemstone"],
		});
		this._miscFilter = new Filter({
			header: "Miscellaneous",
			items: ["Has Info", "Legacy"],
			isMiscFilter: true,
			deselFn: PageFilterBase.defaultMiscellaneousDeselFn.bind(PageFilterBase),
		});
	}

	static mutateForFilters (ent) {
		this._mutateForFilters_commonSources(ent);

		ent.upgradeType = ent.upgradeType && ent.upgradeType instanceof Array ? ent.upgradeType : ent.upgradeType ? [ent.upgradeType] : ["OTH"];

		ent._dUpgradeType = ent.upgradeType.map(t => Parser.itemUpgradeTypeToFull(t));
		ent._lUpgradeType = ent.upgradeType.map(t => Parser.itemUpgradeTypeToAbv(t)).join(", ");

		// Derive category for filtering
		ent._fCategory = [];
		for (const type of ent.upgradeType) {
			if (type.startsWith("WU")) ent._fCategory.push("Weapon Upgrade");
			else if (type.startsWith("AU")) ent._fCategory.push("Armor Upgrade");
			else if (type.startsWith("GS")) ent._fCategory.push("Gemstone");
		}
		ent._fCategory = [...new Set(ent._fCategory)];

		this._mutateForFilters_commonMisc(ent);
	}

	addToFilters (it, isExcluded) {
		if (isExcluded) return;

		this._sourceFilter.addItem(it._fSources);
		this._typeFilter.addItem(it.upgradeType);
		this._categoryFilter.addItem(it._fCategory);
		this._miscFilter.addItem(it._fMisc);
	}

	async _pPopulateBoxOptions (opts) {
		opts.filters = [
			this._sourceFilter,
			this._categoryFilter,
			this._typeFilter,
			this._miscFilter,
		];
	}

	toDisplay (values, it) {
		return this._filterBox.toDisplay(
			values,
			it._fSources,
			it._fCategory,
			it.upgradeType,
			it._fMisc,
		);
	}
}

globalThis.PageFilterItemUpgrades = PageFilterItemUpgrades;
