import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "./consts.js";
import {VetoolsConfig} from "./utils-config/utils-config-config.js";
import {RenderPageImplBase} from "./render-page-base.js";

/** @abstract */
class _RenderItemUpgradesImplBase extends RenderPageImplBase {
	_style;
	_page = UrlUtil.PG_ITEM_UPGRADES;
	_dataProp = "itemUpgrade";

	/* -------------------------------------------- */

	_getCommonHtmlParts (
		{
			ent,
			renderer,
			opts,
		},
	) {
		return {
			...super._getCommonHtmlParts({ent, renderer, opts}),

			htmlPtCost: this._getCommonHtmlParts_cost({ent}),

			htmlPtGemInfo: this._getCommonHtmlParts_gemInfo({ent}),

			htmlPtEntries: this._getCommonHtmlParts_entries({ent, renderer}),
		};
	}

	/* ----- */

	_getCommonHtmlParts_prerequisites ({ent}) {
		const ptPrerequisites = Renderer.utils.prerequisite.getHtml(ent.prerequisite, {styleHint: this._style});
		return ptPrerequisites ? `<tr><td colspan="6" class="ve-pt-0 ${this._style === SITE_STYLE__CLASSIC ? "" : "ve-italic"}">${ptPrerequisites}</td></tr>` : "";
	}

	/* ----- */

	_getCommonHtmlParts_cost ({ent}) {
		if (!ent.cost) return "";
		return `<tr><td colspan="6" ${ent.prerequisite ? "" : `class="ve-pt-0"`}><i>Cost: ${ent.cost}</i></td></tr>`;
	}

	/* ----- */

	_getCommonHtmlParts_gemInfo ({ent}) {
		if (!ent.gemName) return "";
		const parts = [`<b>Gemstone:</b> ${ent.gemName}`];
		if (ent.craftingDC != null) parts.push(`<b>Empowerment DC:</b> ${ent.craftingDC}`);
		return `<tr><td colspan="6">${parts.join(" | ")}</td></tr>`;
	}

	/* ----- */

	_getCommonHtmlParts_entries ({ent, renderer}) {
		return renderer.render({entries: ent.entries}, 1);
	}
}

class _RenderItemUpgradesImplClassic extends _RenderItemUpgradesImplBase {
	_style = SITE_STYLE__CLASSIC;

	_getRendered ({ent, renderer, opts}) {
		const {
			htmlPtIsExcluded,
			htmlPtName,

			htmlPtPrerequisites,

			htmlPtCost,

			htmlPtGemInfo,

			htmlPtEntries,

			htmlPtPage,
		} = this._getCommonHtmlParts({
			ent,
			renderer,
			opts,
		});

		return `
			${Renderer.utils.getBorderTr()}

			${htmlPtIsExcluded}
			${htmlPtName}

			${htmlPtPrerequisites}

			${htmlPtCost}

			${htmlPtGemInfo}

			<tr><td colspan="6" class="ve-py-0"><div class="ve-tbl-divider"></div></td></tr>

			<tr><td colspan="6">
				${htmlPtEntries}
			</td></tr>

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

class _RenderItemUpgradesImplOne extends _RenderItemUpgradesImplBase {
	_style = SITE_STYLE__ONE;

	_getRendered ({ent, renderer, opts}) {
		const {
			htmlPtIsExcluded,
			htmlPtName,

			htmlPtPrerequisites,

			htmlPtCost,

			htmlPtGemInfo,

			htmlPtEntries,

			htmlPtPage,
		} = this._getCommonHtmlParts({
			ent,
			renderer,
			opts,
		});

		const hasHeader = htmlPtPrerequisites || htmlPtCost || htmlPtGemInfo;

		return `
			${Renderer.utils.getBorderTr()}

			${htmlPtIsExcluded}
			${htmlPtName}

			${htmlPtPrerequisites}

			${htmlPtCost}

			${htmlPtGemInfo}

			<tr><td colspan="6" ${hasHeader ? `class="ve-pt-2"` : `class="ve-pt-0"`}>
				${htmlPtEntries}
			</td></tr>

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

export class RenderItemUpgrades {
	static _RENDER_CLASSIC = new _RenderItemUpgradesImplClassic();
	static _RENDER_ONE = new _RenderItemUpgradesImplOne();

	static getRenderedItemUpgrade (ent) {
		const styleHint = VetoolsConfig.get("styleSwitcher", "style");
		switch (styleHint) {
			case SITE_STYLE__CLASSIC: return this._RENDER_CLASSIC.getRendered(ent);
			case SITE_STYLE__ONE: return this._RENDER_ONE.getRendered(ent);
			default: throw new Error(`Unhandled style "${styleHint}"!`);
		}
	}
}
