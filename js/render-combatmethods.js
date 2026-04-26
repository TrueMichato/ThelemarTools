import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "./consts.js";
import {VetoolsConfig} from "./utils-config/utils-config-config.js";
import {RenderPageImplBase} from "./render-page-base.js";

/** @abstract */
class _RenderCombatMethodsImplBase extends RenderPageImplBase {
	_style;
	_page = UrlUtil.PG_COMBAT_METHODS;
	_dataProp = "combatMethod";

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

			htmlPtTraditionDegree: this._getCommonHtmlParts_traditionDegree({ent}),

			htmlPtStaminaAction: this._getCommonHtmlParts_staminaAction({ent}),

			htmlPtEntries: this._getCommonHtmlParts_entries({ent, renderer}),
		};
	}

	/* ----- */

	_getCommonHtmlParts_traditionDegree ({ent}) {
		const parts = [];
		if (ent.tradition) parts.push(`<b>Tradition:</b> ${ent.tradition}`);
		if (ent.degree) parts.push(`<b>Degree:</b> ${PageFilterCombatMethods._getDegreeDisplay(ent.degree)}`);
		const content = parts.join(" &bull; ");
		return content ? `<tr><td colspan="6" class="ve-pt-0">${content}</td></tr>` : "";
	}

	/* ----- */

	_getCommonHtmlParts_staminaAction ({ent}) {
		const parts = [];
		if (ent.staminaCost != null) parts.push(`<b>Stamina Cost:</b> ${ent.staminaCost}`);
		if (ent.actionType) parts.push(`<b>Action:</b> ${ent.actionType.toTitleCase()}`);
		const content = parts.join(" &bull; ");
		return content ? `<tr><td colspan="6">${content}</td></tr>` : "";
	}

	/* ----- */

	_getCommonHtmlParts_entries ({ent, renderer}) {
		return renderer.render({entries: ent.entries}, 1);
	}
}

class _RenderCombatMethodsImplClassic extends _RenderCombatMethodsImplBase {
	_style = SITE_STYLE__CLASSIC;

	_getRendered ({ent, renderer, opts}) {
		const {
			htmlPtIsExcluded,
			htmlPtName,

			htmlPtPrerequisites,

			htmlPtTraditionDegree,
			htmlPtStaminaAction,

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

			${htmlPtTraditionDegree}
			${htmlPtStaminaAction}

			${htmlPtPrerequisites}

			<tr><td colspan="6" class="ve-py-0"><div class="ve-tbl-divider"></div></td></tr>

			<tr><td colspan="6">
				${htmlPtEntries}
			</td></tr>

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

class _RenderCombatMethodsImplOne extends _RenderCombatMethodsImplBase {
	_style = SITE_STYLE__ONE;

	_getRendered ({ent, renderer, opts}) {
		const {
			htmlPtIsExcluded,
			htmlPtName,

			htmlPtPrerequisites,

			htmlPtTraditionDegree,
			htmlPtStaminaAction,

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

			${htmlPtTraditionDegree}
			${htmlPtStaminaAction}

			${htmlPtPrerequisites}

			<tr><td colspan="6" ${htmlPtTraditionDegree || htmlPtStaminaAction || htmlPtPrerequisites ? `class="ve-pt-2"` : `class="ve-pt-0"`}>
				${htmlPtEntries}
			</td></tr>

			${htmlPtPage}
			${Renderer.utils.getBorderTr()}
		`;
	}
}

export class RenderCombatMethods {
	static _RENDER_CLASSIC = new _RenderCombatMethodsImplClassic();
	static _RENDER_ONE = new _RenderCombatMethodsImplOne();

	static getRenderedCombatMethod (ent) {
		const styleHint = VetoolsConfig.get("styleSwitcher", "style");
		switch (styleHint) {
			case SITE_STYLE__CLASSIC: return this._RENDER_CLASSIC.getRendered(ent);
			case SITE_STYLE__ONE: return this._RENDER_ONE.getRendered(ent);
			default: throw new Error(`Unhandled style "${styleHint}"!`);
		}
	}
}
