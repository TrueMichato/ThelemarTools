import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";

/**
 * DM Screen Dice Calculator panel — a persistent, touch-friendly calculator
 * for building up dice expressions on the fly. Rolls are delegated to
 * `Renderer.dice.pRoll2` so results post to the shared rollbox and land in
 * the shared roll-history recall alongside inline dice.
 *
 * Persisted panel state (compressed keys, matching sibling panels):
 *   x   current expression string (e.g. "1d20+2d6+3")
 *   m   advantage mode: "n" | "adv" | "dis"
 *   h   history array (newest first, max HISTORY_MAX entries), each:
 *         { x: expression rolled, r: total, t: roll breakdown text, ts: epochMs, m: mode }
 */

const HISTORY_MAX = 10;
const DICE_FACES = [4, 6, 8, 10, 12, 20, 100];
const MODE_LABEL = {n: "Normal", adv: "Advantage", dis: "Disadvantage"};

export class DiceCalculator extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-dicecalc__root dm__panel-bg dm__data-anchor"></div>`;
		this._comp = new _DiceCalculatorRoot(board, wrpPanel);
		this._comp.setStateFrom(state);
		this._comp.render(wrpPanel);
		return wrpPanel;
	}

	getState () {
		return this._comp?.getSaveableState();
	}
}

class _DiceCalculatorRoot extends BaseComponent {
	constructor (board, wrpPanel) {
		super();
		this._board = board;
		this._wrpPanel = wrpPanel;
		this._addHookAll("state", () => this._board.doSaveStateDebounced());

		this._eleDisplay = null;
		this._eleModIpt = null;
		this._eleHist = null;
		this._eleModeBtns = {};
		this._eleModeHint = null;
	}

	_getDefaultState () {
		return {
			x: "",
			m: "n",
			h: [],
		};
	}

	/* -------------------------------------------- */
	// region Expression manipulation

	_appendDieTerm (faces) {
		const cur = this._state.x || "";
		// Coalesce onto a trailing NdX term for the same die (e.g. "2d6" → "3d6").
		const re = new RegExp(`(^|\\+)(\\d*)d${faces}$`, "i");
		const match = cur.match(re);
		if (match) {
			const prefix = match[1];
			const count = match[2] === "" ? 1 : Number(match[2]);
			const head = cur.slice(0, cur.length - match[0].length);
			this._state.x = `${head}${prefix}${count + 1}d${faces}`;
			return;
		}
		this._state.x = cur ? `${cur}+1d${faces}` : `1d${faces}`;
	}

	_appendModifier (delta) {
		if (!delta || isNaN(delta)) return;
		const cur = this._state.x || "";
		const n = Math.trunc(delta);
		if (n === 0) return;
		// Fold into a trailing bare integer literal if present (e.g. "1d20+3" + 2 -> "1d20+5")
		const reTail = /([+-])(\d+)$/;
		const match = cur.match(reTail);
		if (match) {
			const signed = (match[1] === "-" ? -1 : 1) * Number(match[2]);
			const combined = signed + n;
			const head = cur.slice(0, cur.length - match[0].length);
			if (combined === 0) {
				this._state.x = head;
			} else {
				this._state.x = `${head}${combined > 0 ? "+" : "-"}${Math.abs(combined)}`;
			}
			return;
		}
		if (!cur) {
			this._state.x = `${n > 0 ? "" : "-"}${Math.abs(n)}`;
			return;
		}
		this._state.x = `${cur}${n > 0 ? "+" : "-"}${Math.abs(n)}`;
	}

	_backspaceToken () {
		let cur = this._state.x || "";
		if (!cur) return;
		// If the tail is a dangling connector from a hand-typed edit, drop just that first.
		if (cur.endsWith("+") || cur.endsWith("-")) {
			this._state.x = cur.slice(0, -1);
			return;
		}
		// Trim the trailing token — either a signed integer or a NdX die term.
		const re = /(?:[+-]?\d*d\d+|[+-]?\d+)$/i;
		const match = cur.match(re);
		if (!match) {
			this._state.x = "";
			return;
		}
		let next = cur.slice(0, cur.length - match[0].length);
		// Guard against a dangling connector left behind after the strip.
		while (next.length && (next.endsWith("+") || next.endsWith("-"))) next = next.slice(0, -1);
		this._state.x = next;
	}

	_clearExpression () {
		this._state.x = "";
	}

	// endregion

	/* -------------------------------------------- */
	// region Rolling

	_getModeAdjustedExpression () {
		const expr = this._state.x || "";
		if (this._state.m === "n") return {expr, hasAdvTarget: true};
		// Rewrite the FIRST bare `1d20` (or plain `d20`) — one not preceded by a digit, so `2d20`
		// or `1d200` stay untouched. If the user built two `1d20`s only the leading one is
		// modified, which is the intuitive behaviour for adv/dis + extra dice.
		const re = /(^|[^\d])1?d20\b/i;
		const match = expr.match(re);
		if (!match) return {expr, hasAdvTarget: false};
		const keep = this._state.m === "adv" ? "kh1" : "kl1";
		const before = expr.slice(0, match.index) + match[1];
		const after = expr.slice(match.index + match[0].length);
		return {expr: `${before}2d20${keep}${after}`, hasAdvTarget: true};
	}

	async _pDoRoll () {
		const raw = (this._state.x || "").trim();
		if (!raw) { this._flashDisplay(); return; }

		const {expr, hasAdvTarget} = this._getModeAdjustedExpression();
		if (this._state.m !== "n" && !hasAdvTarget) {
			this._eleModeHint?.showVe();
		} else {
			this._eleModeHint?.hideVe();
		}

		// Pre-flight parse check so we can flag garbage without polluting the rollbox.
		const tree = Renderer.dice.lang.getTree3(expr);
		if (!tree) { this._flashDisplay(); return; }

		const label = MODE_LABEL[this._state.m] || "Roll";
		const result = await Renderer.dice.pRoll2(
			expr,
			{isUser: true, name: "Dice Calculator", label},
			{isResultUsed: false},
		);

		if (result === Renderer.dice._SYMBOL_PARSE_FAILED || result == null) { this._flashDisplay(); return; }

		const entry = {
			x: raw,
			r: Number(result),
			t: expr,
			ts: Date.now(),
			m: this._state.m,
		};
		this._state.h = [entry, ...(this._state.h || [])].slice(0, HISTORY_MAX);
	}

	_flashDisplay () {
		if (!this._eleDisplay) return;
		this._eleDisplay.classList.add("dm-dicecalc__display--error");
		setTimeout(() => this._eleDisplay?.classList.remove("dm-dicecalc__display--error"), 250);
	}

	// endregion

	/* -------------------------------------------- */
	// region History

	_replayHistoryItem (item) {
		this._state.x = item.x;
		this._state.m = item.m || "n";
	}

	_removeHistoryItem (ix) {
		const next = [...(this._state.h || [])];
		next.splice(ix, 1);
		this._state.h = next;
	}

	_clearHistory () {
		this._state.h = [];
	}

	// endregion

	/* -------------------------------------------- */
	// region Rendering

	render (eleParent) {
		eleParent.empty();

		this._eleDisplay = ee`<input type="text" class="ve-form-control dm-dicecalc__display ve-text-center" spellcheck="false" autocomplete="off" placeholder="Tap dice to build a roll…">`;
		this._eleDisplay.value = this._state.x || "";
		this._eleDisplay.onn("input", () => {
			this._state.x = this._eleDisplay.value || "";
		});

		this._addHookBase("x", () => {
			if (this._eleDisplay && this._eleDisplay.value !== (this._state.x || "")) {
				this._eleDisplay.value = this._state.x || "";
			}
			// Any expression edit invalidates the previous "no 1d20 to modify" hint.
			this._eleModeHint?.hideVe();
		});

		const modeRow = this._renderModeRow();
		const diceGrid = this._renderDiceGrid();
		const modRow = this._renderModRow();
		const actionRow = this._renderActionRow();
		this._eleHist = ee`<div class="dm-dicecalc__hist ve-flex-col ve-w-100"></div>`;
		this._renderHistory();
		this._addHookBase("h", () => this._renderHistory());
		this._addHookBase("m", () => this._syncModeButtons());

		ee`<div class="ve-w-100 ve-h-100 ve-flex-col ve-px-2 ve-py-2 dm-dicecalc__inner">
			${this._eleDisplay}
			${modeRow}
			${diceGrid}
			${modRow}
			${actionRow}
			<div class="dm-dicecalc__hist-header ve-flex-v-center ve-mt-2">
				<div class="ve-small-caps ve-muted ve-mr-auto">Recent rolls</div>
				<button class="ve-btn ve-btn-xs ve-btn-default dm-dicecalc__hist-clear" title="Clear history"><span class="glyphicon glyphicon-trash"></span></button>
			</div>
			${this._eleHist}
		</div>`.appendTo(eleParent);

		// Wire the clear-history button (need selector-based access after template mount).
		const btnClearHist = eleParent.querySelector(".dm-dicecalc__hist-clear");
		if (btnClearHist) btnClearHist.addEventListener("click", () => this._clearHistory());
	}

	_renderModeRow () {
		const mkBtn = (mode, label, title) => {
			const btn = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-dicecalc__mode-btn" title="${title}">${label}</button>`
				.onn("click", () => { this._state.m = mode; });
			this._eleModeBtns[mode] = btn;
			return btn;
		};
		this._eleModeHint = ee`<div class="dm-dicecalc__mode-hint ve-muted ve-small-caps ve-ml-2">No 1d20 to modify</div>`;
		this._eleModeHint.hideVe();
		const row = ee`<div class="dm-dicecalc__mode-row ve-flex-v-center ve-mt-2">
			<div class="ve-btn-group">
				${mkBtn("n", "Normal", "Roll normally")}
				${mkBtn("adv", "Adv.", "Roll first 1d20 with advantage (2d20kh1)")}
				${mkBtn("dis", "Dis.", "Roll first 1d20 with disadvantage (2d20kl1)")}
			</div>
			${this._eleModeHint}
		</div>`;
		this._syncModeButtons();
		return row;
	}

	_syncModeButtons () {
		Object.entries(this._eleModeBtns).forEach(([mode, btn]) => {
			if (!btn) return;
			btn.classList.toggle("active", this._state.m === mode);
			btn.classList.toggle("ve-btn-primary", this._state.m === mode);
			btn.classList.toggle("ve-btn-default", this._state.m !== mode);
		});
		// Any mode toggle invalidates the previous "no 1d20 to modify" hint — the next roll re-derives it.
		this._eleModeHint?.hideVe();
	}

	_renderDiceGrid () {
		const btns = DICE_FACES.map(f => ee`<button class="ve-btn ve-btn-default dm-dicecalc__die-btn" title="Add 1d${f}">d${f}</button>`
			.onn("click", () => this._appendDieTerm(f)));
		return ee`<div class="dm-dicecalc__dice-grid ve-mt-2">${btns}</div>`;
	}

	_renderModRow () {
		this._eleModIpt = ee`<input type="number" step="1" value="1" class="ve-form-control dm-dicecalc__mod-ipt ve-text-center" title="Modifier value">`;
		const btnMinus = ee`<button class="ve-btn ve-btn-danger dm-dicecalc__mod-btn" title="Subtract modifier"><span class="glyphicon glyphicon-minus"></span></button>`
			.onn("click", () => {
				const v = Number(this._eleModIpt.value);
				if (!isNaN(v)) this._appendModifier(-Math.abs(v));
			});
		const btnPlus = ee`<button class="ve-btn ve-btn-success dm-dicecalc__mod-btn" title="Add modifier"><span class="glyphicon glyphicon-plus"></span></button>`
			.onn("click", () => {
				const v = Number(this._eleModIpt.value);
				if (!isNaN(v)) this._appendModifier(Math.abs(v));
			});
		return ee`<div class="dm-dicecalc__mod-row ve-flex-v-center ve-mt-2">
			<div class="ve-small-caps ve-muted ve-mr-2">Modifier</div>
			${btnMinus}
			${this._eleModIpt}
			${btnPlus}
		</div>`;
	}

	_renderActionRow () {
		const btnClear = ee`<button class="ve-btn ve-btn-default dm-dicecalc__act-btn" title="Clear expression">Clear</button>`
			.onn("click", () => this._clearExpression());
		const btnBack = ee`<button class="ve-btn ve-btn-default dm-dicecalc__act-btn" title="Remove last token"><span class="glyphicon glyphicon-arrow-left"></span></button>`
			.onn("click", () => this._backspaceToken());
		const btnRoll = ee`<button class="ve-btn ve-btn-primary dm-dicecalc__roll-btn" title="Roll">🎲 Roll</button>`
			.onn("click", () => { this._pDoRoll().catch(e => { setTimeout(() => { throw e; }); }); });
		return ee`<div class="dm-dicecalc__action-row ve-flex ve-mt-2">
			${btnClear}
			${btnBack}
			${btnRoll}
		</div>`;
	}

	_renderHistory () {
		if (!this._eleHist) return;
		this._eleHist.empty();
		const hist = this._state.h || [];
		if (!hist.length) {
			ee`<div class="dm-dicecalc__hist-empty ve-muted ve-italic ve-text-center ve-py-2">No rolls yet.</div>`.appendTo(this._eleHist);
			return;
		}
		hist.forEach((item, ix) => {
			const modeBadge = item.m && item.m !== "n"
				? ee`<span class="dm-dicecalc__hist-mode ve-small-caps ve-mr-1" title="${MODE_LABEL[item.m] || ""}"></span>`.txt(item.m === "adv" ? "adv" : "dis")
				: "";
			const btnReplay = ee`<button class="ve-btn ve-btn-xs ve-btn-default dm-dicecalc__hist-btn" title="Load this roll into the calculator"><span class="glyphicon glyphicon-repeat"></span></button>`
				.onn("click", (evt) => { evt.stopPropagation(); this._replayHistoryItem(item); });
			const btnRemove = ee`<button class="ve-btn ve-btn-xs ve-btn-danger dm-dicecalc__hist-btn" title="Remove"><span class="glyphicon glyphicon-remove"></span></button>`
				.onn("click", (evt) => { evt.stopPropagation(); this._removeHistoryItem(ix); });
			const expr = ee`<span class="ve-code"></span>`.txt(item.x);
			const wrpExpr = ee`<div class="dm-dicecalc__hist-expr ve-mr-auto"></div>`;
			if (modeBadge) wrpExpr.appendChild(modeBadge);
			wrpExpr.appendChild(expr);
			const total = ee`<div class="dm-dicecalc__hist-total ve-bold ve-mx-2"></div>`.txt(String(item.r));
			// Single-click anywhere on the row (except action buttons) reuses the expression;
			// the buttons stop propagation so they act as explicit overrides.
			const row = ee`<div class="dm-dicecalc__hist-item ve-flex-v-center ve-py-1" title="Click to reuse this roll">
				${wrpExpr}
				${total}
				${btnReplay}
				${btnRemove}
			</div>`
				.onn("click", () => this._replayHistoryItem(item));
			row.appendTo(this._eleHist);
		});
	}

	// endregion

	/* -------------------------------------------- */
	// region State persistence

	setStateFrom (toLoad) {
		this.setBaseSaveableStateFrom(toLoad || {});
		if (!toLoad) return;
		if (typeof toLoad.x === "string") this._state.x = toLoad.x;
		if (toLoad.m === "n" || toLoad.m === "adv" || toLoad.m === "dis") this._state.m = toLoad.m;
		if (Array.isArray(toLoad.h)) {
			this._state.h = toLoad.h
				.filter(it => it && typeof it.x === "string")
				.slice(0, HISTORY_MAX)
				.map(it => ({
					x: String(it.x),
					r: Number(it.r) || 0,
					t: typeof it.t === "string" ? it.t : String(it.x),
					ts: Number(it.ts) || 0,
					m: it.m === "adv" || it.m === "dis" ? it.m : "n",
				}));
		}
	}

	getSaveableState () {
		return {
			...this.getBaseSaveableState(),
			x: this._state.x || "",
			m: this._state.m || "n",
			h: (this._state.h || []).slice(0, HISTORY_MAX),
		};
	}

	// endregion
}
