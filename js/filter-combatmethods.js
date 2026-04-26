"use strict";

class PageFilterCombatMethods extends PageFilterBase {
	// region static
	static sortCombatMethods (itemA, itemB, options) {
		if (options.sortBy === "degree") {
			const aValue = Number(itemA.values.degree) || 0;
			const bValue = Number(itemB.values.degree) || 0;
			return SortUtil.ascSort(aValue, bValue) || SortUtil.listSort(itemA, itemB, options);
		}
		if (options.sortBy === "tradition") {
			return SortUtil.ascSortLower(itemA.values.tradition, itemB.values.tradition) || SortUtil.listSort(itemA, itemB, options);
		}
		if (options.sortBy === "stamina") {
			const aValue = Number(itemA.values.stamina) || 0;
			const bValue = Number(itemB.values.stamina) || 0;
			return SortUtil.ascSort(aValue, bValue) || SortUtil.listSort(itemA, itemB, options);
		}
		if (options.sortBy === "action") {
			return SortUtil.ascSortLower(itemA.values.action || "", itemB.values.action || "") || SortUtil.listSort(itemA, itemB, options);
		}
		return SortUtil.listSort(itemA, itemB, options);
	}
	// endregion

	constructor () {
		super();

		this._traditionFilter = new Filter({
			header: "Tradition",
			items: [],
		});
		this._degreeFilter = new Filter({
			header: "Degree",
			items: ["1st", "2nd", "3rd", "4th", "5th"],
			itemSortFn: SortUtil.ascSortNumericalSuffix,
		});
		this._staminaFilter = new Filter({
			header: "Stamina Cost",
			items: [],
			itemSortFn: SortUtil.ascSort,
		});
		this._actionTypeFilter = new Filter({
			header: "Action Type",
			items: [],
		});
		this._prerequisiteFilter = new Filter({
			header: "Prerequisite",
			items: [],
			displayFn: StrUtil.toTitleCase.bind(StrUtil),
		});
		this._miscFilter = new Filter({
			header: "Miscellaneous",
			items: ["Has Info", "Has Images", "Legacy"],
			isMiscFilter: true,
			deselFn: PageFilterBase.defaultMiscellaneousDeselFn.bind(PageFilterBase),
		});
	}

	static mutateForFilters (ent) {
		this._mutateForFilters_commonSources(ent);

		ent._fTradition = ent.tradition || "Unknown";
		ent._fDegree = ent.degree ? PageFilterCombatMethods._getDegreeDisplay(ent.degree) : "Unknown";
		ent._fStaminaCost = ent.staminaCost != null ? ent.staminaCost : 0;
		ent._fActionType = ent.actionType || "Unknown";
		ent._fPrerequisites = [];
		if (ent.prerequisite) {
			for (const prereq of ent.prerequisite) {
				if (prereq.feature) ent._fPrerequisites.push(...prereq.feature);
			}
		}

		this._mutateForFilters_commonMisc(ent);
	}

	static _getDegreeDisplay (degree) {
		switch (degree) {
			case 1: return "1st";
			case 2: return "2nd";
			case 3: return "3rd";
			case 4: return "4th";
			case 5: return "5th";
			default: return `${degree}th`;
		}
	}

	addToFilters (it, isExcluded) {
		if (isExcluded) return;

		this._sourceFilter.addItem(it._fSources);
		this._traditionFilter.addItem(it._fTradition);
		this._degreeFilter.addItem(it._fDegree);
		this._staminaFilter.addItem(it._fStaminaCost);
		this._actionTypeFilter.addItem(it._fActionType);
		this._prerequisiteFilter.addItem(it._fPrerequisites);
		this._miscFilter.addItem(it._fMisc);
	}

	async _pPopulateBoxOptions (opts) {
		opts.filters = [
			this._sourceFilter,
			this._traditionFilter,
			this._degreeFilter,
			this._staminaFilter,
			this._actionTypeFilter,
			this._prerequisiteFilter,
			this._miscFilter,
		];
	}

	toDisplay (values, it) {
		return this._filterBox.toDisplay(
			values,
			it._fSources,
			it._fTradition,
			it._fDegree,
			it._fStaminaCost,
			it._fActionType,
			it._fPrerequisites,
			it._fMisc,
		);
	}
}

globalThis.PageFilterCombatMethods = PageFilterCombatMethods;
