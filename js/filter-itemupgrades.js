"use strict";

class PageFilterItemUpgrades extends PageFilterBase {
	// region static
	static _filterUpgradeTypeSort (a, b) {
		return SortUtil.ascSort(Parser.itemUpgradeTypeToFull(a.item), Parser.itemUpgradeTypeToFull(b.item));
	}

	static _filterTierSort (a, b) {
		const order = Parser.ITEM_UPGRADE_TIER_ORDER;
		const iA = order.indexOf(a.item);
		const iB = order.indexOf(b.item);
		return SortUtil.ascSort(iA === -1 ? 999 : iA, iB === -1 ? 999 : iB);
	}

	static sortItemUpgrades (itemA, itemB, options) {
		if (options.sortBy === "category") {
			return SortUtil.ascSortLower(itemA.values.category, itemB.values.category) || SortUtil.listSort(itemA, itemB, options);
		}
		if (options.sortBy === "tier") {
			const orderA = Parser.ITEM_UPGRADE_TIER_ORDER.indexOf(itemA.values.tier);
			const orderB = Parser.ITEM_UPGRADE_TIER_ORDER.indexOf(itemB.values.tier);
			return SortUtil.ascSort(orderA === -1 ? 999 : orderA, orderB === -1 ? 999 : orderB) || SortUtil.listSort(itemA, itemB, options);
		}
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
			items: ["Weapon Upgrade", "Armor Upgrade", "Gem"],
		});
		this._tierFilter = new Filter({
			header: "Tier",
			items: [],
			itemSortFn: PageFilterItemUpgrades._filterTierSort,
		});
		this._equipmentTypeFilter = new Filter({
			header: "Type",
			items: ["Equipment", "Gem"],
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
		ent._fCategory = [...new Set(ent.upgradeType.map(t => Parser.itemUpgradeTypeToCategory(t)))];
		ent._lCategory = ent._fCategory.join(", ");

		// Derive tier for filtering
		ent._fTier = [...new Set(ent.upgradeType.map(t => Parser.itemUpgradeTypeToTier(t)).filter(Boolean))];
		ent._lTier = ent._fTier.join(", ") || "\u2014";

		// Derive equipment type for filtering
		ent._fEquipmentType = [...new Set(ent.upgradeType.map(t => Parser.itemUpgradeTypeToEquipmentType(t)))];
		ent._lEquipmentType = ent._fEquipmentType.join(", ");

		// Derive prerequisite yes/no
		ent._lHasPrerequisite = ent.prerequisite?.length ? "Yes" : "\u2014";

		this._mutateForFilters_commonMisc(ent);
	}

	addToFilters (it, isExcluded) {
		if (isExcluded) return;

		this._sourceFilter.addItem(it._fSources);
		this._typeFilter.addItem(it.upgradeType);
		this._categoryFilter.addItem(it._fCategory);
		this._tierFilter.addItem(it._fTier);
		this._equipmentTypeFilter.addItem(it._fEquipmentType);
		this._miscFilter.addItem(it._fMisc);
	}

	async _pPopulateBoxOptions (opts) {
		opts.filters = [
			this._sourceFilter,
			this._categoryFilter,
			this._tierFilter,
			this._equipmentTypeFilter,
			this._typeFilter,
			this._miscFilter,
		];
	}

	toDisplay (values, it) {
		return this._filterBox.toDisplay(
			values,
			it._fSources,
			it._fCategory,
			it._fTier,
			it._fEquipmentType,
			it.upgradeType,
			it._fMisc,
		);
	}
}

globalThis.PageFilterItemUpgrades = PageFilterItemUpgrades;
