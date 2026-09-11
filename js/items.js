import {RenderItems} from "./render-items.js";
import {ItemBuilderCore} from "./itembuilder/itembuilder-core.js";
import {CharacterSheetItemTransfer} from "./charactersheet/charactersheet-item-transfer.js";

let _pCompositionCatalogs;
const _escapeHtml = value => String(value ?? "")
	.replace(/&/g, "&amp;")
	.replace(/</g, "&lt;")
	.replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;")
	.replace(/'/g, "&#39;");

async function _pGetCompositionCatalogs () {
	_pCompositionCatalogs ||= Promise.all([
		DataUtil.itemMaterial.loadJSON().catch(() => ({itemMaterial: []})),
		DataUtil.itemUpgrade.loadJSON().catch(() => ({itemUpgrade: []})),
		PrereleaseUtil.pGetBrewProcessed().catch(() => ({})),
		BrewUtil2.pGetBrewProcessed().catch(() => ({})),
	]).then(([materials, upgrades, prerelease, brew]) => ({
		materials: ItemBuilderCore.dedupeCatalog([
			...(materials.itemMaterial || []),
			...(prerelease.itemMaterial || []),
			...(brew.itemMaterial || []),
		]),
		upgrades: ItemBuilderCore.dedupeCatalog([
			...(upgrades.itemUpgrade || []),
			...(prerelease.itemUpgrade || []),
			...(brew.itemUpgrade || []),
		]),
		resonances: ItemBuilderCore.dedupeCatalog([
			...(materials.draconicResonance || []),
			...(prerelease.draconicResonance || []),
			...(brew.draconicResonance || []),
		]),
		sources: [
			...(prerelease._meta?.sources || []),
			...(brew._meta?.sources || []),
		],
	}));
	return _pCompositionCatalogs;
}

async function _pLoadComposedItems (pLoad) {
	const [data, catalogs] = await Promise.all([pLoad(), _pGetCompositionCatalogs()]);
	return {
		...data,
		item: (data.item || []).map(item => ItemBuilderCore.projectItem(item, catalogs)),
	};
}

class ItemsSublistManager extends SublistManager {
	constructor () {
		super({
			sublistListOptions: {
				fnSort: PageFilterItems.sortItems,
			},
			isSublistItemsCountable: true,
		});

		this._sublistCurrencyConversion = null;
		this._sublistCurrencyDisplayMode = null;

		this._totalWeight = null;
		this._totalValue = null;
		this._totalItems = null;
	}

	async pCreateSublist () {
		[this._sublistCurrencyConversion, this._sublistCurrencyDisplayMode] = await Promise.all([
			StorageUtil.pGetForPage("sublistCurrencyConversion"),
			StorageUtil.pGetForPage("sublistCurrencyDisplayMode"),
		]);

		return super.pCreateSublist();
	}

	static _getRowTemplate () {
		return [
			new SublistCellTemplate({
				name: "Name",
				css: "ve-bold ve-col-6 ve-pl-0 ve-pr-1",
				colStyle: "",
			}),
			new SublistCellTemplate({
				name: "Weight",
				css: "ve-text-center ve-col-2 ve-px-1",
				colStyle: "text-center",
			}),
			new SublistCellTemplate({
				name: "Cost",
				css: "ve-text-center ve-col-2 ve-px-1",
				colStyle: "text-center",
			}),
			new SublistCellTemplate({
				name: "Number",
				css: "ve-text-center ve-col-2 ve-pl-1 ve-pr-0",
				colStyle: "text-center",
			}),
		];
	}

	pGetSublistItem (item, hash, {count = 1} = {}) {
		const cellsText = [
			item.name,
			item._l_weight || "\u2014",
			item._l_value,
		];

		const {stg: stgCount, comp: compCount} = (() => {
			const comp = BaseComponent.fromObject({count});

			const ipt = ComponentUiUtil.getIptNumber(
				comp,
				"count",
				1,
				{
					fallbackOnNaN: count,
					html: `<input class="ve-w-100 ve-text-center ve-form-control form-control--minimal ve-input-xs">`,
				},
			);

			comp._addHookBase("count", () => {
				if (comp._state.count <= 0) {
					this.pDoSublistRemove({entity: item, doFinalize: true}).then(null);
					return;
				}

				this.pDoSublistSetCount({entity: item, doFinalize: true, count: comp._state.count}).then(null);
			});

			const stg = this._pGetSublistItem_getWrpIptCount()
				.vee.addClass("ve-absolute")
				// Match padding
				.vee.css({right: "2px"})
				.vee.appends(ipt);

			return {stg, ipt, comp};
		})();

		const ptsCells = [
			...this.constructor._getRowCellsHtml({values: cellsText, templates: this.constructor._ROW_TEMPLATE.slice(0, 3)}),
			// Placeholder to vertically expand row
			this._pGetSublistItem_getWrpIptCount()
				.vee.appends(`<input class="ve-w-100 ve-text-center ve-form-control form-control--minimal ve-input-xs" disabled>`),
		];

		const ele = veT`<div class="ve-lst__row ve-lst__row--sublist ve-flex-col">
			<div class="ve-lst__wrp-cells ve-lst__row-border ve-lst__row-inner ve-relative">
				<a href="#${hash}" class="ve-lst__row-lnk-inner">
					${ptsCells}
				</a>
				${stgCount}
			</div>
		</div>`
			.vee.onn("contextmenu", evt => this._handleSublistItemContextMenu(evt, listItem))
			.vee.onn("click", evt => this._listSub.doSelect(listItem, evt));

		const listItem = new ListItem(
			hash,
			ele,
			item.name,
			{
				source: Parser.sourceJsonToAbv(item.source),
				...ListItem.getCommonValues(item),
				weight: Parser.weightValueToNumber(item.weight),
				cost: item.value || 0,
			},
			{
				hash,
				page: item.page,
				count,
				elesCount: [],
				fnsUpdate: [({sublistItem}) => compCount._state.count = sublistItem.data.count],
				entity: item,
				mdRow: [...cellsText, ({listItem}) => listItem.data.count],
			},
		);
		return listItem;
	}

	_pGetSublistItem_getWrpIptCount () {
		return veT`<span class="ve-text-center ve-col-2 ve-pr-0"></span>`;
	}

	_onSublistChange () {
		this._totalWeight ||= veEs(`#totalweight`);
		this._totalValue ||= veEs(`#totalvalue`);
		this._totalItems ||= veEs(`#totalitems`);

		let weight = 0;
		let value = 0;
		let cntItems = 0;

		const availConversions = new Set();
		this._listSub.items.forEach(it => {
			const {data: {entity: item}} = it;
			if (item.currencyConversion) availConversions.add(item.currencyConversion);
			const count = it.data.count;
			cntItems += it.data.count;
			if (item.weight) weight += Number(item.weight) * count;
			if (item.value) value += item.value * count;
		});

		this._totalWeight.vee.txt(Parser.itemWeightToFull({weight}, true));
		this._totalItems.vee.txt(cntItems);

		if (availConversions.size) {
			this._totalValue
				.vee.txt(Parser.itemValueToFullMultiCurrency({value, currencyConversion: this._sublistCurrencyConversion}, {styleHint: this._styleHint}))
				.vee.off("click")
				.vee.onn("click", async () => {
					const values = ["(Default)", ...[...availConversions].sort(SortUtil.ascSortLower)];
					const userSel = await InputUiUtil.pGetUserEnum({
						values,
						isResolveItem: true,
						default: this._sublistCurrencyConversion,
						title: "Select Currency Conversion Table",
						fnDisplay: it => it === null ? values[0] : it,
					});
					if (userSel == null) return;
					this._sublistCurrencyConversion = userSel === values[0] ? null : userSel;
					await StorageUtil.pSetForPage("sublistCurrencyConversion", this._sublistCurrencyConversion);
					this._onSublistChange();
				});
			return;
		}

		this._totalValue
			.vee.txt(this._getTotalValueText({value}) || "\u2014")
			.vee.off("click")
			.vee.onn("click", async () => {
				const userSel = await InputUiUtil.pGetUserEnum({
					values: this.constructor._TOTAL_VALUE_MODES,
					isResolveItem: true,
					default: this.constructor._TOTAL_VALUE_MODES.indexOf(this._sublistCurrencyDisplayMode),
					title: "Select Display Mode",
					fnDisplay: it => it === null ? this.constructor._TOTAL_VALUE_MODES[0] : it,
				});
				if (userSel == null) return;
				this._sublistCurrencyDisplayMode = userSel === this.constructor._TOTAL_VALUE_MODES[0] ? null : userSel;
				await StorageUtil.pSetForPage("sublistCurrencyDisplayMode", this._sublistCurrencyDisplayMode);
				this._onSublistChange();
			});
	}

	static _TOTAL_VALUE_MODE_EXACT_COINAGE = "Exact Coinage";
	static _TOTAL_VALUE_MODE_LOWEST_COMMON = "Lowest Common Currency";
	static _TOTAL_VALUE_MODE_GOLD = "Gold";
	static _TOTAL_VALUE_MODES = [
		this._TOTAL_VALUE_MODE_EXACT_COINAGE,
		this._TOTAL_VALUE_MODE_LOWEST_COMMON,
		this._TOTAL_VALUE_MODE_GOLD,
	];
	_getTotalValueText ({value}) {
		switch (this._sublistCurrencyDisplayMode) {
			case this.constructor._TOTAL_VALUE_MODE_LOWEST_COMMON: return Parser.itemValueToFull({value});

			case this.constructor._TOTAL_VALUE_MODE_GOLD: {
				return value ? `${Number((Parser.DEFAULT_CURRENCY_CONVERSION_TABLE.find(it => it.coin === "gp").mult * value).toFixed(2))} gp` : "";
			}

			default: {
				const CURRENCIES = ["gp", "sp", "cp"];
				const coins = {cp: value};
				CurrencyUtil.doSimplifyCoins(coins);
				return CURRENCIES.filter(it => coins[it]).map(it => `${coins[it].toLocaleStringVe()} ${it}`).join(", ");
			}
		}
	}
}

class ItemsPage extends ListPage {
	constructor () {
		const pFnGetFluff = Renderer.item.pGetFluff.bind(Renderer.item);

		super({
			dataSource: () => _pLoadComposedItems(DataUtil.item.loadJSON.bind(DataUtil.item)),
			prereleaseDataSource: () => _pLoadComposedItems(DataUtil.item.loadPrerelease.bind(DataUtil.item)),
			brewDataSource: () => _pLoadComposedItems(DataUtil.item.loadBrew.bind(DataUtil.item)),

			pFnGetFluff,

			pageFilter: new PageFilterItems(),

			dataProps: ["item"],

			bookViewOptions: {
				nameSingular: "item",
				namePlural: "items",
				pageTitle: "Items Book View",
				propMarkdown: "item",
				isSublistItemsCountable: true,
			},

			tableViewOptions: {
				title: "Items",
				colTransforms: {
					name: UtilsTableview.COL_TRANSFORM_NAME,
					source: UtilsTableview.COL_TRANSFORM_SOURCE,
					page: UtilsTableview.COL_TRANSFORM_PAGE,
					rarity: {name: "Rarity"},
					_type: {
						name: "Type",
						transform: (item, additionalData, {styleHint}) => {
							const {
								entryType,
								entrySubtype,
							} = Renderer.item.getTransformedTypeEntriesMeta({item, styleHint});

							return [Renderer.get().render(entryType), Renderer.get().render(entrySubtype)].filter(Boolean).join(", ");
						},
					},
					_attunement: {name: "Attunement", transform: it => it._attunement ? it._attunement.slice(1, it._attunement.length - 1) : ""},
					_damage: {name: "Damage", transform: it => Renderer.item.getRenderedDamageAndProperties(it)[0]},
					_properties: {name: "Properties", transform: it => Renderer.item.getRenderedDamageAndProperties(it)[1]},
					_mastery: {name: "Mastery", transform: it => Renderer.item.getRenderedMastery(it)},
					_weight: {name: "Weight", transform: it => Parser.itemWeightToFull(it)},
					_value: {name: "Value", transform: it => Parser.itemValueToFullMultiCurrency(it, {styleHint: this._styleHint})},
					_entries: {name: "Text", transform: (it) => Renderer.item.getRenderedEntries(it, {isCompact: true}), flex: 3},
				},
			},
			propEntryData: "item",

			listSyntax: new ListSyntaxItems({fnGetDataList: () => this._dataList, pFnGetFluff}),
		});

		this._mundaneList = null;
		this._magicList = null;
	}

	get _bindOtherButtonsOptions () {
		return {
			other: [
				this._bindOtherButtonsOptions_openAsSinglePage({slugPage: "items"}),
			].filter(Boolean),
		};
	}

	get primaryLists () { return [this._mundaneList, this._magicList]; }

	getListItem (item, itI, isExcluded) {
		const hash = UrlUtil.autoEncodeHash(item);

		if (Renderer.item.isExcluded(item, {hash})) return null;
		if (item.noDisplay) return null;
		Renderer.item.enhanceItem(item);

		this._pageFilter.mutateAndAddToFilters(item, isExcluded);

		const source = Parser.sourceJsonToAbv(item.source);
		const type = item._textTypes.join(", ").toTitleCase();

		if (item._fIsMundane) {
			const eleLi = veE({
				tag: "div",
				clazz: `ve-lst__row ve-flex-col ${isExcluded ? "ve-lst__row--blocklisted" : ""}`,
				click: (evt) => this._mundaneList.doSelect(listItem, evt),
				contextmenu: (evt) => this._openContextMenu(evt, this._mundaneList, listItem),
				children: [
					veE({
						tag: "a",
						href: `#${hash}`,
						clazz: "ve-lst__row-border ve-lst__row-inner",
						children: [
							veE({tag: "span", clazz: `ve-col-3-5 ve-pl-0 ve-pr-1 ve-bold`, txt: item.name}),
							veE({tag: "span", clazz: `ve-col-4-5 ve-px-1`, txt: type}),
							veE({tag: "span", clazz: `ve-col-1-5 ve-px-1 ve-text-center`, txt: item._l_value}),
							veE({tag: "span", clazz: `ve-col-1-5 ve-px-1 ve-text-center`, txt: item._l_weight}),
							veE({
								tag: "span",
								clazz: `ve-col-1 ve-text-center ${Parser.sourceJsonToSourceClassname(item.source)} ve-pl-1 ve-pr-0`,
								title: `${Parser.sourceJsonToFull(item.source)}${Renderer.utils.getSourceSubText(item)}`,
								txt: source,
							}),
						],
					}),
				],
			});

			const listItem = new ListItem(
				itI,
				eleLi,
				item.name,
				{
					source,
					...ListItem.getCommonValues(item),
					type,
					cost: item.value || 0,
					weight: Parser.weightValueToNumber(item.weight),
				},
				{
					hash,
					page: item.page,
					isExcluded,
				},
			);

			return {mundane: listItem};
		} else {
			const eleLi = veE({
				tag: "div",
				clazz: `ve-lst__row ve-flex-col ${isExcluded ? "ve-lst__row--blocklisted" : ""}`,
				click: (evt) => this._magicList.doSelect(listItem, evt),
				contextmenu: (evt) => this._openContextMenu(evt, this._magicList, listItem),
				children: [
					veE({
						tag: "a",
						href: `#${hash}`,
						clazz: "ve-lst__row-border ve-lst__row-inner",
						children: [
							e_({tag: "span", clazz: `ve-col-3-5 ve-pl-0 ve-bold`, txt: item.name}),
							e_({tag: "span", clazz: `ve-col-2-5`, txt: type}),
							e_({tag: "span", clazz: `ve-col-1-5 ve-text-center`, txt: item._l_weight}),
							e_({tag: "span", clazz: `ve-col-1-5 ve-text-center`, txt: item._l_value}),
							e_({tag: "span", clazz: `ve-col-0-6 ve-text-center`, txt: item._attunementCategory !== VeCt.STR_NO_ATTUNEMENT ? "×" : ""}),
							e_({
								tag: "span",
								clazz: `ve-col-1-4 ve-text-center ${item.rarity ? `ve-itm__rarity-${item.rarity}` : ""}`,
								title: (item.rarity || "").toTitleCase(),
								txt: Parser.itemRarityToShort(item.rarity) || "",
							}),
							veE({
								tag: "span",
								clazz: `ve-col-1 ve-text-center ${Parser.sourceJsonToSourceClassname(item.source)} ve-pr-0`,
								title: `${Parser.sourceJsonToFull(item.source)}${Renderer.utils.getSourceSubText(item)}`,
								txt: source,
							}),
						],
					}),
				],
			});

			const listItem = new ListItem(
				itI,
				eleLi,
				item.name,
				{
					source,
					...ListItem.getCommonValues(item),
					type,
					rarity: item.rarity,
					attunement: item._attunementCategory !== VeCt.STR_NO_ATTUNEMENT,
					weight: Parser.weightValueToNumber(item.weight),
					cost: item.value || 0,
				},
				{
					hash,
					page: item.page,
				},
			);

			return {magic: listItem};
		}
	}

	handleFilterChange () {
		const f = this._pageFilter.filterBox.getValues();
		const listFilter = li => this._pageFilter.toDisplay(f, this._dataList[li.ix]);
		this._mundaneList.filter(listFilter);
		this._magicList.filter(listFilter);
		FilterBox.selectFirstVisible(this._dataList);
	}

	_tabTitleStats = "Item";

	_renderStats_doBuildStatsTab ({ent}) {
		this._pgContent.vee.empty().vee.appends(RenderItems.getRenderedItem(ent));
		this._bindAddToCharacterButton();
	}

	_bindAddToCharacterButton () {
		const btn = this._getOrTabRightButton(
			"add-to-character",
			"glyphicon-user",
			{title: "Add this item to a saved character"},
		);
		btn.classList.add("ve-itm__btn-add-character");
		if (!btn.querySelector(".ve-itm__btn-add-character-label")) {
			btn.append(veE({
				tag: "span",
				clazz: "ve-itm__btn-add-character-label",
				txt: "Add to Character",
			}));
		}
		if (btn.dataset.isItemTransferBound) return;
		btn.dataset.isItemTransferBound = "true";
		btn.addEventListener("click", () => this._pAddCurrentItemToCharacter({btn}));
	}

	async _pAddCurrentItemToCharacter ({btn}) {
		const item = this._lastRender?.entity;
		if (!item) return;

		btn.disabled = true;
		btn.setAttribute("aria-busy", "true");
		try {
			const characters = await CharacterSheetItemTransfer.pGetCharacters();
			if (!characters.length) {
				const isCreate = await InputUiUtil.pGetUserBoolean({
					title: "No Saved Characters",
					htmlDescription: `<div>Create a character before adding <b>${_escapeHtml(item.name)}</b> to an inventory.</div>`,
					textYes: "Create Character",
					textNo: "Cancel",
				});
				if (isCreate) window.open("charactersheet.html", "_blank", "noopener");
				return;
			}

			const character = await InputUiUtil.pGetUserEnum({
				title: `Add ${item.name} to...`,
				htmlDescription: "Choose the character who should receive one unequipped copy.",
				values: characters,
				fnDisplay: CharacterSheetItemTransfer.getCharacterLabel,
				isResolveItem: true,
			});
			if (!character) return;

			const configuredItem = await this._pGetItemForCharacterTransfer(item);
			if (!configuredItem) return;

			await CharacterSheetItemTransfer.pQueue({
				characterId: character.id,
				item: configuredItem,
			});
			JqueryUtil.doToast({
				type: "success",
				content: `Added ${item.name} to ${character.name || "Unnamed Character"}.`,
			});
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("[Items] Failed to add item to character:", error);
			JqueryUtil.doToast({
				type: "danger",
				content: `Could not add ${item.name} to the character. ${error.message || VeCt.STR_SEE_CONSOLE}`,
			});
		} finally {
			btn.disabled = false;
			btn.removeAttribute("aria-busy");
		}
	}

	async _pGetItemForCharacterTransfer (item) {
		let configured = MiscUtil.copyFast(item._compositionRaw || item);
		const {CharacterSheetState} = await import("./charactersheet/charactersheet-state.js");

		if (
			configured.spellScrollLevel != null
			&& !configured.attachedSpells
			&& !configured.selectedSpell
		) {
			const selectedSpell = await this._pChooseTransferSpell(configured);
			if (!selectedSpell) return null;
			configured.selectedSpell = {
				name: selectedSpell.name,
				source: selectedSpell.source || Parser.SRC_PHB,
				level: Number(selectedSpell.level ?? configured.spellScrollLevel ?? 0),
			};
		}

		if (configured.ability?.choose?.length && !CharacterSheetState._hasResolvedItemAbilityChoices(configured)) {
			const selectedAbilityChoices = await this._pChooseTransferAbilities(configured);
			if (!selectedAbilityChoices) return null;
			configured.selectedAbilityChoices = selectedAbilityChoices;
		}

		if (configured.grantsLanguage && !CharacterSheetState.getItemGrantedLanguages(configured).length) {
			const selectedLanguage = await this._pChooseTransferLanguage(configured);
			if (!selectedLanguage) return null;
			configured.selectedLanguage = selectedLanguage;
		}

		return configured;
	}

	async _pChooseTransferSpell (item) {
		const [siteSpells, prerelease, brew] = await Promise.all([
			DataUtil.spell.pLoadAll(),
			PrereleaseUtil.pGetBrewProcessed().catch(() => ({})),
			BrewUtil2.pGetBrewProcessed().catch(() => ({})),
		]);
		const seen = new Set();
		const candidates = [
			...(siteSpells || []),
			...(prerelease.spell || []),
			...(brew.spell || []),
		]
			.filter(spell => Number(spell.level) === Number(item.spellScrollLevel))
			.filter(spell => {
				const key = `${spell.name}|${spell.source}`.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));

		const spellLevel = Number(item.spellScrollLevel);
		const spellLevelText = spellLevel === 0 ? "cantrip" : `level ${spellLevel} spell`;
		if (!candidates.length) throw new Error(`No ${spellLevelText}s are available.`);
		return InputUiUtil.pGetUserEnum({
			title: `Choose the Spell for ${item.name}`,
			htmlDescription: `Choose the ${spellLevelText} contained in this item.`,
			values: candidates,
			fnDisplay: spell => `${spell.name} (${Parser.sourceJsonToAbv(spell.source)})`,
			isResolveItem: true,
		});
	}

	async _pChooseTransferAbilities (item) {
		const selected = [];
		for (const choice of item.ability.choose) {
			const count = Math.max(1, Number(choice.count) || 1);
			const amount = Number(choice.amount) || 1;
			for (let i = 0; i < count; i++) {
				const available = (choice.from || []).filter(ability => !selected.some(it => it.ability === ability));
				if (!available.length) return null;
				const ability = await InputUiUtil.pGetUserEnum({
					title: `Choose an Ability for ${item.name}`,
					htmlDescription: `Choose ${count > 1 ? `${i + 1} of ${count}: ` : ""}an ability to increase by ${amount}.`,
					values: available,
					fnDisplay: value => Parser.attAbvToFull(value),
					isResolveItem: true,
				});
				if (!ability) return null;
				selected.push({ability, amount});
			}
		}
		return selected;
	}

	async _pChooseTransferLanguage (item) {
		const [siteData, prerelease, brew] = await Promise.all([
			DataUtil.loadJSON("data/languages.json"),
			PrereleaseUtil.pGetBrewProcessed().catch(() => ({})),
			BrewUtil2.pGetBrewProcessed().catch(() => ({})),
		]);
		const values = [...new Set([
			...(siteData.language || []),
			...(prerelease.language || []),
			...(brew.language || []),
		].map(language => language?.name).filter(Boolean))]
			.sort(SortUtil.ascSortLower);
		if (!values.length) throw new Error(`No languages are available for ${item.name}.`);

		return InputUiUtil.pGetUserEnum({
			title: `Choose a Language for ${item.name}`,
			htmlDescription: "Choose the language granted while this item is equipped and active.",
			values,
			fnDisplay: value => value,
			isResolveItem: true,
		});
	}

	async _pOnLoad_pInitPrimaryLists () {
		const iptSearch = veE(document.getElementById("lst__search"));
		const btnReset = veE(document.getElementById("reset"));
		const btnClear = veE(document.getElementById("lst__search-glass"));
		this._mundaneList = this._initList({
			iptSearch,
			btnReset,
			btnClear,
			dispPageTagline: document.getElementById(`page__subtitle`),
			wrpList: veE(document.getElementById("list-mundane")),
			syntax: this._listSyntax.build(),
			isBindFindHotkey: true,
			optsList: {
				fnSort: PageFilterItems.sortItems,
			},
		});
		this._magicList = this._initList({
			iptSearch,
			btnReset,
			btnClear,
			wrpList: veE(document.getElementById("list-magic")),
			syntax: this._listSyntax.build(),
			optsList: {
				fnSort: PageFilterItems.sortItems,
			},
		});

		SortUtil.initBtnSortHandlers(veEs("#filtertools-mundane"), this._mundaneList);
		SortUtil.initBtnSortHandlers(veEs("#filtertools-magic"), this._magicList);

		this._mundaneList.nextList = this._magicList;
		this._magicList.prevList = this._mundaneList;

		this._filterBox = await this._pageFilter.pInitFilterBox({
			iptSearch,
			wrpFormTop: veE(document.getElementById("filter-search-group")),
			btnReset,
		});
	}

	_pOnLoad_initVisibleItemsDisplay () {
		const elesMundaneAndMagic = veEm(`.ele-mundane-and-magic`);
		veEs(`.side-label--mundane`).vee.onn("click", () => {
			const filterValues = this._pageFilter.filterBox.getValues();
			const curValue = MiscUtil.get(filterValues, "Miscellaneous", "Mundane");
			this._pageFilter.filterBox.setFromValues({
				Miscellaneous: {
					...(filterValues?.Miscellaneous || {}),
					Mundane: curValue === 1 ? 0 : 1,
				},
			});
		});
		veEs(`.side-label--magic`).vee.onn("click", () => {
			const filterValues = this._pageFilter.filterBox.getValues();
			const curValue = MiscUtil.get(filterValues, "Miscellaneous", "Magic");
			this._pageFilter.filterBox.setFromValues({
				Miscellaneous: {
					...(filterValues?.Miscellaneous || {}),
					Magic: curValue === 1 ? 0 : 1,
				},
			});
		});
		const outVisibleResults = veEs(`.ve-lst__wrp-search-visible`);
		const wrpListMundane = veEs(`.ve-itm__wrp-list--mundane`);
		const wrpListMagic = veEs(`.ve-itm__wrp-list--magic`);
		const elesMundane = veEm(`.ele-mundane`);
		const elesMagic = veEm(`.ele-magic`);
		this._mundaneList.on("updated", () => {
			// Force-show the mundane list if there are no items on display
			if (this._magicList.visibleItems.length) elesMundane.forEach(ele => ele.vee.toggle(!!this._mundaneList.visibleItems.length));
			else elesMundane.forEach(ele => ele.vee.show());
			elesMundaneAndMagic.forEach(ele => ele.vee.toggle(!!(this._mundaneList.visibleItems.length && this._magicList.visibleItems.length)));

			const current = this._mundaneList.visibleItems.length + this._magicList.visibleItems.length;
			const total = this._mundaneList.items.length + this._magicList.items.length;
			outVisibleResults.vee.html(`${current}/${total}`);

			// Collapse the mundane section if there are no magic items displayed
			wrpListMundane.vee.toggleClass(`ve-itm__wrp-list--empty`, this._mundaneList.visibleItems.length === 0);
		});
		this._magicList.on("updated", () => {
			elesMagic.forEach(ele => ele.vee.toggle(!!this._magicList.visibleItems.length));
			// Force-show the mundane list if there are no items on display
			if (!this._magicList.visibleItems.length) elesMundane.forEach(ele => ele.vee.show());
			else elesMundane.forEach(ele => ele.vee.toggle(!!this._mundaneList.visibleItems.length));
			elesMundaneAndMagic.forEach(ele => ele.vee.toggle(!!(this._mundaneList.visibleItems.length && this._magicList.visibleItems.length)));

			const current = this._mundaneList.visibleItems.length + this._magicList.visibleItems.length;
			const total = this._mundaneList.items.length + this._magicList.items.length;
			outVisibleResults.vee.html(`${current}/${total}`);

			// Collapse the magic section if there are no magic items displayed
			wrpListMagic.vee.toggleClass(`ve-itm__wrp-list--empty`, this._magicList.visibleItems.length === 0);
		});
	}

	_addData (data) {
		super._addData(data);

		// Populate table labels
		veEs(`h3.ele-mundane span.side-label`).vee.txt("Mundane");
		veEs(`h3.ele-magic span.side-label`).vee.txt("Magic");
	}

	_addListItem (listItem) {
		if (listItem.mundane) this._mundaneList.addItem(listItem.mundane);
		if (listItem.magic) this._magicList.addItem(listItem.magic);
	}
}

const itemsPage = new ItemsPage();
itemsPage.sublistManager = new ItemsSublistManager();
window.addEventListener("load", () => itemsPage.pOnLoad());

globalThis.dbg_page = itemsPage;
