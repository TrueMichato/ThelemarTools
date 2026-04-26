import {RenderCombatMethods} from "./render-combatmethods.js";

class CombatMethodsSublistManager extends SublistManager {
	constructor () {
		super({
			sublistListOptions: {
				fnSort: PageFilterCombatMethods.sortCombatMethods,
			},
		});
	}

	static _getRowTemplate () {
		return [
			new SublistCellTemplate({
				name: "Name",
				css: "ve-bold ve-col-4 ve-pl-0 ve-pr-1",
				colStyle: "",
			}),
			new SublistCellTemplate({
				name: "Tradition",
				css: "ve-col-3 ve-px-1",
				colStyle: "",
			}),
			new SublistCellTemplate({
				name: "Degree",
				css: "ve-col-1-5 ve-text-center ve-px-1",
				colStyle: "ve-text-center",
			}),
			new SublistCellTemplate({
				name: "Stamina",
				css: "ve-col-1-5 ve-text-center ve-px-1",
				colStyle: "ve-text-center",
			}),
			new SublistCellTemplate({
				name: "Action",
				css: "ve-col-2 ve-text-center ve-pl-1 ve-pr-0",
				colStyle: "ve-text-center",
			}),
		];
	}

	pGetSublistItem (it, hash) {
		const degree = it.degree ? PageFilterCombatMethods._getDegreeDisplay(it.degree) : "\u2014";
		const stamina = it.staminaCost != null ? it.staminaCost : "\u2014";
		const action = it.actionType ? it.actionType.toTitleCase() : "\u2014";

		const cellsText = [
			it.name,
			it.tradition || "\u2014",
			degree,
			stamina,
			action,
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
				tradition: it.tradition || "",
				degree,
				stamina,
				action,
			},
			{
				entity: it,
				mdRow: [...cellsText],
			},
		);
		return listItem;
	}
}

class CombatMethodsPage extends ListPage {
	constructor () {
		const pageFilter = new PageFilterCombatMethods();

		super({
			dataSource: DataUtil.combatmethod.loadJSON.bind(DataUtil.combatmethod),

			pageFilter,

			listOptions: {
				fnSort: PageFilterCombatMethods.sortCombatMethods,
			},

			dataProps: ["combatMethod"],

			bookViewOptions: {
				nameSingular: "combat method",
				namePlural: "combat methods",
				pageTitle: "Combat Methods Book View",
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
		const degree = it.degree ? PageFilterCombatMethods._getDegreeDisplay(it.degree) : "\u2014";
		const stamina = it.staminaCost != null ? it.staminaCost : "\u2014";
		const action = it.actionType ? it.actionType.toTitleCase() : "\u2014";
		const type = it.isStance ? "Stance" : "Strike";
		const tradClass = Parser.cmTraditionToStyleClass(it.tradition);

		eleLi.innerHTML = `<a href="#${hash}" class="ve-lst__row-border ve-lst__row-inner">
			<span class="ve-col-0-3 ve-px-0 ve-flex-vh-center ve-lst__btn-toggle-expand ve-self-flex-stretch ve-no-select">[+]</span>
			<span class="ve-bold ve-col-2-7 ve-px-1">${it.name}</span>
			<span class="ve-col-2-2 ve-px-1 ${tradClass}">${it.tradition || "\u2014"}</span>
			<span class="ve-col-0-8 ve-px-1 ve-text-center ${it.isStance ? "ve-cm__type--stance" : ""}">${type}</span>
			<span class="ve-col-1 ve-px-1 ve-text-center">${degree}</span>
			<span class="ve-col-1 ve-px-1 ve-text-center">${stamina}</span>
			<span class="ve-col-2 ve-px-1 ve-text-center">${action}</span>
			<span class="ve-col-2 ${Parser.sourceJsonToSourceClassname(it.source)} ve-text-center ve-pl-1 ve-pr-0" title="${Parser.sourceJsonToFull(it.source)}">${source}</span>
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
				tradition: it.tradition || "",
				type,
				degree,
				stamina,
				action,
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
		this._pgContent.empty().appends(RenderCombatMethods.getRenderedCombatMethod(ent));
	}
}

const combatMethodsPage = new CombatMethodsPage();
combatMethodsPage.sublistManager = new CombatMethodsSublistManager();
window.addEventListener("load", () => combatMethodsPage.pOnLoad());

globalThis.dbg_page = combatMethodsPage;
