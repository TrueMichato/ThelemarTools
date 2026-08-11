"use strict";

/**
 * Filters for the Crafting & Harvesting hub.
 *
 * The page spans three entity kinds — materials, craftables and rules — so most filters only apply
 * to a subset. `PageFilterBase` handles that naturally: an entity with no value for a filter simply
 * never matches a positive selection on it.
 *
 * The headline filter is Effect Tags, which is grouped by the taxonomy the data generator uses.
 */
class PageFilterCrafting extends PageFilterBase {
	/* -------------------------------------------- */
	/* Static                                       */
	/* -------------------------------------------- */

	static _PROP_TO_ABV = {
		"craftingMaterial": "MAT",
		"craftingRecipe": "CRF",
		"craftingRule": "RUL",
		"itemMaterial": "MTL",
	};

	static getTypeAbbreviation (prop) {
		return this._PROP_TO_ABV[prop] ?? "?";
	}

	/** Which taxonomy group an effect tag belongs to; mirrors the generator's EFFECT_TAG_GROUPS. */
	static EFFECT_TAG_GROUPS = {
		"Damage Type": ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison damage", "psychic", "radiant", "slashing", "thunder"],
		"Restoration": ["healing", "temporary hit points", "cures condition", "cures disease", "neutralises poison", "revives"],
		"Protection": ["resistance", "immunity", "vulnerability", "armour class", "absorbs damage"],
		"Rolls": ["advantage", "disadvantage", "ability score", "skill bonus", "attack bonus", "saving throw bonus", "critical hit"],
		"Conditions": ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralysed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"],
		"Movement": ["flying speed", "swimming speed", "climbing speed", "burrowing speed", "increased speed", "teleportation", "planar travel"],
		"Senses": ["darkvision", "blindsight", "tremorsense", "truesight", "detects magic", "scrying"],
		"Magic": ["grants spell", "spell component", "concentration", "summoning", "animates dead", "shapechanging", "wild magic", "dispels magic", "counters magic"],
		"Mechanics": ["forces a saving throw", "area of effect", "requires an action", "lasting effect", "single use"],
		"Crafting Use": ["armour material", "weapon material", "ammunition", "poison crafting", "potion crafting", "food", "crafting ingredient", "spell reagent", "trade good"],
		"Utility": ["light source", "adhesive", "acid solvent", "waterproofing", "disguise", "language", "communication"],
	};

	static _EFFECT_TAG_TO_GROUP = Object.entries(PageFilterCrafting.EFFECT_TAG_GROUPS)
		.reduce((acc, [group, tags]) => {
			tags.forEach(tag => acc[tag] = group);
			return acc;
		}, {});

	static getEffectTagGroup (tag) {
		return this._EFFECT_TAG_TO_GROUP[tag] ?? "Other";
	}

	static _ascSortEffectTag (a, b) {
		const groupOrder = Object.keys(PageFilterCrafting.EFFECT_TAG_GROUPS);
		const ixA = groupOrder.indexOf(PageFilterCrafting.getEffectTagGroup(a.item));
		const ixB = groupOrder.indexOf(PageFilterCrafting.getEffectTagGroup(b.item));
		return SortUtil.ascSort(~ixA ? ixA : Number.MAX_SAFE_INTEGER, ~ixB ? ixB : Number.MAX_SAFE_INTEGER)
			|| SortUtil.ascSortLower(a.item, b.item);
	}

	/** Column sorting for the list. */
	static sortCrafting (itemA, itemB, options) {
		switch (options.sortBy) {
			case "type":
			case "category":
			case "source":
				return SortUtil.ascSortLower(itemA.values[options.sortBy], itemB.values[options.sortBy]) || SortUtil.listSort(itemA, itemB, options);
			case "dc":
			case "value":
				// Entries with no DC/value sort last regardless of direction
				return SortUtil.ascSort(itemA.values[options.sortBy] ?? Number.MAX_SAFE_INTEGER, itemB.values[options.sortBy] ?? Number.MAX_SAFE_INTEGER)
					|| SortUtil.listSort(itemA, itemB, options);
			default:
				return SortUtil.listSort(itemA, itemB, options);
		}
	}

	/* -------------------------------------------- */
	/* Construction                                 */
	/* -------------------------------------------- */

	constructor () {
		super();

		this._typeFilter = new Filter({
			header: "Type",
			items: ["craftingMaterial", "craftingRecipe", "craftingRule", "itemMaterial"],
			displayFn: it => Parser.getPropDisplayName(it),
			itemSortFn: null,
		});

		this._categoryFilter = new Filter({
			header: "Category",
			items: [...new Set([
				...Parser.CRAFTING_MATERIAL_CATEGORIES,
				...Parser.CRAFTING_RECIPE_CATEGORIES,
				...Parser.CRAFTING_RULE_CATEGORIES,
				...Parser.ITEM_MATERIAL_CATEGORIES,
			])],
			displayFn: Parser.craftingCategoryToFull,
			groupFn: it => {
				// Checked most-specific-first: "materials" is both a rule category and, loosely,
				// what item materials are, so the item-material list has to win over the rule list.
				if (Parser.ITEM_MATERIAL_CATEGORIES.includes(it)) return "Item Material";
				if (Parser.CRAFTING_MATERIAL_CATEGORIES.includes(it)) return "Material";
				if (Parser.CRAFTING_RECIPE_CATEGORIES.includes(it)) return "Craftable";
				return "Rule";
			},
			itemSortFn: null,
		});

		this._effectTagFilter = new Filter({
			header: "Effect",
			items: Object.values(PageFilterCrafting.EFFECT_TAG_GROUPS).flat(),
			displayFn: it => it.toTitleCase(),
			groupFn: it => PageFilterCrafting.getEffectTagGroup(it),
			itemSortFn: PageFilterCrafting._ascSortEffectTag.bind(PageFilterCrafting),
		});

		/* ----- Harvesting ----- */

		this._creatureFilter = new SearchableFilter({header: "Source Creature"});

		this._creatureTypeFilter = new Filter({
			header: "Creature Type",
			displayFn: it => `${it}`.toTitleCase(),
		});

		this._crFilter = new RangeFilter({
			header: "Creature CR",
			isLabelled: true,
			labelSortFn: SortUtil.ascSortCr,
			labels: [...Parser.CRS],
		});

		this._harvestDcFilter = new RangeFilter({header: "Harvest DC", min: 5, max: 30, isAllowGreater: true});

		this._biomeFilter = new Filter({header: "Biome", displayFn: it => `${it}`.toTitleCase()});

		this._shelfLifeFilter = new Filter({
			header: "Shelf Life",
			items: ["short", "medium", "long"],
			displayFn: Parser.craftingShelfLifeToFull,
			itemSortFn: null,
		});

		/* ----- Crafting ----- */

		this._crafterFilter = new Filter({header: "Crafter", displayFn: it => `${it}`.toTitleCase()});

		this._craftDcFilter = new RangeFilter({header: "Crafting DC", min: 5, max: 30, isAllowGreater: true});

		this._rarityFilter = new Filter({
			header: "Rarity",
			items: [...Parser.ITEM_RARITIES].filter(it => it !== "none" && it !== "unknown"),
			displayFn: it => `${it}`.toTitleCase(),
			itemSortFn: null,
		});

		this._spellFilter = new SearchableFilter({header: "Variant Component For Spell"});

		/* ----- Item materials (Thelemar) ----- */

		this._materialRoleFilter = new Filter({
			header: "Material Role",
			items: Object.keys(Parser.ITEM_MATERIAL_ROLE_TO_FULL),
			displayFn: Parser.itemMaterialRoleToFull,
			itemSortFn: null,
		});

		this._materialAppliesToFilter = new Filter({
			header: "Applies To",
			items: Object.keys(Parser.ITEM_MATERIAL_APPLIES_TO_FULL),
			displayFn: Parser.itemMaterialAppliesToFull,
			itemSortFn: null,
		});

		// One range filter per axis. `isAllowNegative` matters: Damage and Critical are signed
		// steps, and Magic Capacity reaches -\u221E (Lead), which is clamped into the range below.
		this._axisFilters = Parser.ITEM_MATERIAL_AXES.map(axis => ({
			key: axis.key,
			filter: new RangeFilter({header: axis.full, min: -5, max: 25, isAllowNegative: true}),
		}));

		this._materialFilter = new MultiFilter({
			header: "Item Materials",
			filters: [this._materialRoleFilter, this._materialAppliesToFilter, ...this._axisFilters.map(it => it.filter)],
			isAddDropdownToggle: true,
		});

		/* ----- Economy ----- */

		this._valueFilter = new RangeFilter({
			header: "Value",
			isLabelled: true,
			isAllowGreater: true,
			labelSortFn: null,
			labels: [
				0,
				...[...new Array(9)].map((_, i) => (i + 1) * 10),
				...[...new Array(9)].map((_, i) => (i + 1) * 100),
				...[...new Array(9)].map((_, i) => (i + 1) * 1_000),
				...[...new Array(9)].map((_, i) => (i + 1) * 10_000),
				...[...new Array(10)].map((_, i) => (i + 1) * 100_000),
			],
			labelDisplayFn: it => !it ? "None" : Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: it})),
		});

		this._weightFilter = new RangeFilter({header: "Weight", min: 0, max: 100, isAllowGreater: true, suffix: " lb."});

		this._miscFilter = new Filter({
			header: "Miscellaneous",
			items: [
				"Has Mechanical Effect",
				"Has Use Effect",
				"Degrades In Use",
				"Priceless",
				"Requires Preparation",
				"Craftable From",
				"Has Ingredients",
				"Has Structured Spell Effects",
				"Appears In Multiple Books",
				"SRD",
				"Legacy",
			],
			isMiscFilter: true,
			deselFn: PageFilterBase.defaultMiscellaneousDeselFn.bind(PageFilterBase),
		});

		this._harvestFilter = new MultiFilter({
			header: "Harvesting",
			filters: [this._creatureFilter, this._creatureTypeFilter, this._crFilter, this._harvestDcFilter, this._biomeFilter, this._shelfLifeFilter],
			isAddDropdownToggle: true,
		});

		this._craftFilter = new MultiFilter({
			header: "Crafting",
			filters: [this._crafterFilter, this._craftDcFilter, this._rarityFilter, this._spellFilter],
			isAddDropdownToggle: true,
		});
	}

	/* -------------------------------------------- */
	/* Mutation                                     */
	/* -------------------------------------------- */

	static mutateForFilters (ent) {
		this._mutateForFilters_commonSources(ent);
		this._mutateForFilters_commonMisc(ent);

		ent._fCategory = ent.materialCategory || ent.recipeCategory || ent.ruleCategory || null;

		ent._fEffectTags = ent.effectTags || [];

		const harvest = ent.harvest || {};
		ent._fCreature = harvest.creature?.name || null;
		ent._fCreatureType = harvest.creatureType || null;
		ent._fCr = harvest.cr != null ? Parser.numberToCr(harvest.cr) : null;
		ent._fHarvestDc = harvest.dc ?? null;
		ent._fBiome = harvest.biome || null;
		ent._fShelfLife = harvest.shelfLife || null;

		ent._fCrafter = ent.crafter || null;
		ent._fCraftDc = ent.craftDC ?? null;
		ent._fRarity = ent.rarity && ent.rarity !== "none" && ent.rarity !== "unknown" ? ent.rarity : null;
		ent._fSpells = (ent.spells || []).map(sp => sp.name.toTitleCase());

		ent._fValue = ent.value ?? null;
		ent._fWeight = ent.weight ?? null;

		if (ent.hasMechanicalEffect) ent._fMisc.push("Has Mechanical Effect");
		if (ent.hasUseEffect) ent._fMisc.push("Has Use Effect");
		if (ent.harvest?.requiresPreparation) ent._fMisc.push("Requires Preparation");
		if ((ent.usedInRecipes || []).length) ent._fMisc.push("Craftable From");
		if ((ent.ingredients || []).length) ent._fMisc.push("Has Ingredients");
		if (ent.variantComponent?.spellEffects?.length) ent._fMisc.push("Has Structured Spell Effects");
		if ((ent.alsoIn || []).length) ent._fMisc.push("Appears In Multiple Books");

		/* ----- Item materials ----- */
		ent._fMaterialRoles = ent.__prop === "itemMaterial" ? (ent.roles || []) : [];
		ent._fMaterialAppliesTo = ent.__prop === "itemMaterial" ? (ent.appliesTo || []) : [];
		ent._fMaterialAxes = {};
		if (ent.__prop === "itemMaterial") {
			for (const axis of Parser.ITEM_MATERIAL_AXES) {
				// "na" / "Varies" carry no position on a numeric scale, so they get no value and
				// simply never match a positive selection. The infinities are clamped to the ends.
				const raw = ent[axis.key];
				if (raw === "infinity") ent._fMaterialAxes[axis.key] = 25;
				else if (raw === "-infinity") ent._fMaterialAxes[axis.key] = -5;
				else if (typeof raw === "number") ent._fMaterialAxes[axis.key] = raw;
				else ent._fMaterialAxes[axis.key] = null;
			}
		}

		if (ent.__prop === "itemMaterial") {
			if ((ent.effects || []).length) ent._fMisc.push("Has Mechanical Effect");
			if (ent.degradation) ent._fMisc.push("Degrades In Use");
			if (ent.price?.isPriceless) ent._fMisc.push("Priceless");
		}
	}

	addToFilters (ent, isExcluded) {
		if (isExcluded) return;

		this._sourceFilter.addItem(ent._fSources);
		this._typeFilter.addItem(ent.__prop);
		this._categoryFilter.addItem(ent._fCategory);
		this._effectTagFilter.addItem(ent._fEffectTags);
		this._creatureFilter.addItem(ent._fCreature);
		this._creatureTypeFilter.addItem(ent._fCreatureType);
		this._crFilter.addItem(ent._fCr);
		this._harvestDcFilter.addItem(ent._fHarvestDc);
		this._biomeFilter.addItem(ent._fBiome);
		this._shelfLifeFilter.addItem(ent._fShelfLife);
		this._crafterFilter.addItem(ent._fCrafter);
		this._craftDcFilter.addItem(ent._fCraftDc);
		this._rarityFilter.addItem(ent._fRarity);
		this._spellFilter.addItem(ent._fSpells);
		this._materialRoleFilter.addItem(ent._fMaterialRoles);
		this._materialAppliesToFilter.addItem(ent._fMaterialAppliesTo);
		this._axisFilters.forEach(({key, filter}) => filter.addItem(ent._fMaterialAxes?.[key]));
		this._valueFilter.addItem(ent._fValue);
		this._weightFilter.addItem(ent._fWeight);
		this._miscFilter.addItem(ent._fMisc);
	}

	async _pPopulateBoxOptions (opts) {
		opts.filters = [
			this._sourceFilter,
			this._typeFilter,
			this._categoryFilter,
			this._effectTagFilter,
			this._harvestFilter,
			this._craftFilter,
			this._materialFilter,
			this._valueFilter,
			this._weightFilter,
			this._miscFilter,
		];
	}

	toDisplay (values, ent) {
		return this._filterBox.toDisplay(
			values,
			ent._fSources,
			ent.__prop,
			ent._fCategory,
			ent._fEffectTags,
			[
				ent._fCreature,
				ent._fCreatureType,
				ent._fCr,
				ent._fHarvestDc,
				ent._fBiome,
				ent._fShelfLife,
			],
			[
				ent._fCrafter,
				ent._fCraftDc,
				ent._fRarity,
				ent._fSpells,
			],
			[
				ent._fMaterialRoles,
				ent._fMaterialAppliesTo,
				...this._axisFilters.map(({key}) => ent._fMaterialAxes?.[key]),
			],
			ent._fValue,
			ent._fWeight,
			ent._fMisc,
		);
	}
}

globalThis.PageFilterCrafting = PageFilterCrafting;

/**
 * Search syntax for the hub, powering `text:"query"` and friends.
 *
 * The inherited syntax indexes `entries` alone, which on this page misses most of what anyone
 * would actually search for. The Arcadia 11 dishes keep their flavour text in `entries` and the
 * benefit that matters — "You gain 5 temporary hit points" — in `outcomes`; a material's link to
 * the things it makes lives in `usedInRecipes`; and an Arcadia 8 component's spell effect sits
 * under `variantComponent`. All of it is prose a player wants to search by effect.
 *
 * Indexing is lazy and memoised per row by the base class, so none of this costs anything until
 * a text search is actually run.
 */
class ListSyntaxCrafting extends ListUiUtil.ListSyntax {
	static _INDEXABLE_PROPS_ENTRIES = [
		"entries",
		// Where the Arcadia 11 dish benefits live; `entries` holds only flavour text.
		"outcomes",
		"ingredients",
		"componentGroups",
		"harvest",
		"usedInRecipes",
		"variantComponent",
		"effectTags",
	];

	static _INDEXABLE_PROPS_INGREDIENTS = [
		"ingredients",
		"componentGroups",
	];

	build () {
		return {
			...super.build(),

			// Longest-first: the parser matches this un-anchored at the end, so `ingredient` must
			// be offered before any prefix of it could win.
			reCommand: /^(?<command>ingredient|name|stats|info|text)/,

			ingredient: {
				help: `\`ingredient:"query"\` (/query/ for regex; \`ingredient:! ...\` to invert) to search by what a craftable consumes.`,
				fn: (listItem, searchTerm) => {
					if (listItem.data._textCacheIngredients == null) listItem.data._textCacheIngredients = this._getSearchCacheIngredients(this._dataList[listItem.ix]);
					return this._listSyntax_isTextMatch(listItem.data._textCacheIngredients, searchTerm);
				},
			},
		};
	}

	_getSearchCacheIngredients (entity) {
		return this._getSearchCache_entries(entity, {indexableProps: this.constructor._INDEXABLE_PROPS_INGREDIENTS});
	}

	static _RE_TAG = /\{@\w+ ([^{}]+)}/g;

	/**
	 * `stripTags` keeps only a tag's display text, so `{@condition exhaustion|PHB|exhausted}` indexes
	 * as "exhausted" and a search for "exhaustion" — the name of the thing itself — misses it.
	 * Index the tag's target alongside its display text so both spellings find the entry.
	 */
	_getSearchCache_handleString (ptrOut, str) {
		super._getSearchCache_handleString(ptrOut, str);

		for (const [, payload] of str.matchAll(this.constructor._RE_TAG)) {
			const name = payload.split("|")[0].trim().toLowerCase();
			if (name) ptrOut._ += `${name} -- `;
		}
	}

	/** Exposed so the page can offer a full-text search when a plain one finds nothing. */
	getSearchCacheStats (entity) { return this._getSearchCacheStats(entity); }
}

globalThis.ListSyntaxCrafting = ListSyntaxCrafting;
