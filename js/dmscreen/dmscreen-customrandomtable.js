import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";

/**
 * DM Screen "Custom Random Table" panel.
 *
 * One table per panel. State schema (in-memory / on the underlying `BaseComponent`):
 *   {
 *     title:        string,                           // table title, e.g. "Wild Magic Surge"
 *     isEditMode:   boolean,                          // persisted so reload lands users in the same mode
 *     rows:         [ { id: string, text: string } ], // ordered rows; id is a stable random string
 *     lastRolledIx: number|null,                      // most recent roll result (0-based); restored on load
 *   }
 *
 * Serialized state uses compressed keys (matches the notebox/counter style):
 *   {
 *     "t": string,                        // title
 *     "e": boolean,                       // edit mode
 *     "r": [ { "i": id, "x": text } ],    // rows: id + text (mirrors notebox's "x" for a text blob)
 *     "l": number|null,                   // last rolled row index
 *   }
 */
export class CustomRandomTable extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-crandom__root dm__panel-bg dm__data-anchor ve-flex-col"></div>`;
		this._comp = new CustomRandomTableRoot(board, wrpPanel);
		this._comp.setStateFrom(state);
		this._comp.render(wrpPanel);
		return wrpPanel;
	}

	getState () {
		return this._comp?.getSaveableState();
	}
}

class CustomRandomTableComponent extends BaseComponent {
	constructor (board, wrpPanel) {
		super();
		this._board = board;
		this._wrpPanel = wrpPanel;
		this._addHookAll("state", () => this._board.doSaveStateDebounced());
	}
}

class CustomRandomTableRoot extends CustomRandomTableComponent {
	constructor (board, wrpPanel) {
		super(board, wrpPanel);
		this._childComps = [];
		this._wrpRows = null;
		this._eleFooter = null;
	}

	_getDefaultState () { return {title: "", isEditMode: true, lastRolledIx: null}; }

	render (eleParent) {
		eleParent.empty();

		const pod = this.getPod();

		// ----- Header: title + mode toggle -----
		const iptTitle = ee`<input class="ve-form-control ve-input-xs form-control--minimal dm-crandom__title" placeholder="Table title" value="${this._state.title || ""}">`
			.onn("input", () => { this._state.title = iptTitle.value; });

		const btnMode = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-crandom__btn-mode" title="Toggle edit / view"></button>`
			.onn("click", () => { this._state.isEditMode = !this._state.isEditMode; this.render(eleParent); });
		const applyBtnModeLabel = () => btnMode.textContent = this._state.isEditMode ? "Done" : "Edit";
		applyBtnModeLabel();

		const eleHeader = ee`<div class="dm-crandom__header ve-flex-v-center ve-px-2 ve-py-1 ve-no-shrink">
			${iptTitle}
			${btnMode}
		</div>`;

		// ----- Rows -----
		this._wrpRows = ee`<div class="dm-crandom__rows ve-flex-col ve-w-100 ve-overflow-y-auto ve-px-2 ve-py-1"></div>`;
		this._renderRows(pod);

		// ----- Footer -----
		this._eleFooter = ee`<div class="dm-crandom__footer ve-no-shrink ve-flex-v-center ve-px-2 ve-py-2"></div>`;
		this._renderFooter(pod, eleParent);

		ee`<div class="ve-w-100 ve-h-100 ve-flex-col">
			${eleHeader}
			${this._wrpRows}
			${this._eleFooter}
		</div>`.appendTo(eleParent);
	}

	_renderRows (pod) {
		this._wrpRows.empty();

		if (!this._childComps.length) {
			const msg = this._state.isEditMode
				? `No rows yet — click "Add Row" to get started.`
				: `No rows yet — click "Edit" to add some.`;
			ee`<div class="dm-crandom__empty ve-muted ve-italic ve-text-center ve-w-100 ve-py-3">${msg}</div>`
				.appendTo(this._wrpRows);
			return;
		}

		this._childComps.forEach((comp, ix) => {
			comp.render(this._wrpRows, pod, {
				ix,
				isEditMode: this._state.isEditMode,
				isLastRolled: this._state.lastRolledIx === ix,
			});
		});
	}

	_renderFooter (pod, eleParent) {
		this._eleFooter.empty();

		if (this._state.isEditMode) {
			const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs dm-crandom__btn-add"><span class="glyphicon glyphicon-plus"></span> Add Row</button>`
				.onn("click", () => {
					const comp = new CustomRandomTableRow(this._board, this._wrpPanel);
					this._childComps.push(comp);
					this._renderRows(pod);
					this._board.doSaveStateDebounced();
				});
			ee`<div class="ve-flex-h-right ve-w-100">${btnAdd}</div>`.appendTo(this._eleFooter);
			return;
		}

		// View mode
		const n = this._childComps.length;
		const btnRoll = ee`<button class="ve-btn ve-btn-primary dm-crandom__btn-roll"><span class="glyphicon glyphicon-th-list"></span> Roll 1d${n || "?"}</button>`
			.onn("click", () => this._pDoRoll(pod, eleParent));
		if (!n) btnRoll.attr("disabled", "disabled");

		const infoRows = ee`<div class="ve-muted ve-small">${n} ${n === 1 ? "row" : "rows"}</div>`;

		ee`<div class="ve-flex-v-center ve-w-100">
			${infoRows}
			<div class="ve-flex-1"></div>
			${btnRoll}
		</div>`.appendTo(this._eleFooter);
	}

	async _pDoRoll (pod, eleParent) {
		const n = this._childComps.length;
		if (!n) return;

		const label = (this._state.title || "").trim() || "Random Table";
		const total = await Renderer.dice.pRoll2(`1d${n}`, {isUser: false, name: label});
		if (typeof total !== "number" || total < 1 || total > n) return;

		const ix = total - 1;
		this._state.lastRolledIx = ix;

		// Push a second entry so the DM sees the chosen row content in the feed
		// (useful when the panel is off-screen).
		const chosenRow = this._childComps[ix];
		const chosenText = (chosenRow?.getSaveableState()?.x || "").trim();
		if (chosenText) {
			const html = Renderer.get().render(chosenText);
			Renderer.dice.addElement({rolledBy: {name: label}, html: `<span class="ve-muted">→ ${ix + 1}. </span>${html}`});
		}

		this._renderRows(pod);
		this._renderFooter(pod, eleParent);

		// Add a transient flash class to the chosen row
		const eleRow = this._childComps[ix]?.eleRow;
		if (eleRow) {
			eleRow.classList.remove("dm-crandom__row--rolled");
			// Force reflow so the animation restarts if the same row was picked again
			void eleRow.offsetWidth;
			eleRow.classList.add("dm-crandom__row--rolled");
			// Scroll the chosen row into view
			eleRow.scrollIntoView({behavior: "smooth", block: "nearest"});
		}
	}

	_swapRowPositions (ixA, ixB) {
		const a = this._childComps[ixA];
		this._childComps[ixA] = this._childComps[ixB];
		this._childComps[ixB] = a;

		// Track the "last rolled" pointer across the swap
		if (this._state.lastRolledIx === ixA) this._state.lastRolledIx = ixB;
		else if (this._state.lastRolledIx === ixB) this._state.lastRolledIx = ixA;

		// Rebuild children so row numbers stay in sync
		const pod = this.getPod();
		this._renderRows(pod);

		this._board.doSaveStateDebounced();
	}

	_removeRow (comp) {
		const ix = this._childComps.indexOf(comp);
		if (!~ix) return;
		this._childComps.splice(ix, 1);

		if (this._state.lastRolledIx === ix) this._state.lastRolledIx = null;
		else if (this._state.lastRolledIx != null && this._state.lastRolledIx > ix) this._state.lastRolledIx -= 1;

		const pod = this.getPod();
		this._renderRows(pod);
		this._renderFooter(pod, this._wrpPanel);
		this._board.doSaveStateDebounced();
	}

	getPod () {
		const pod = super.getPod();
		pod.swapRowPositions = this._swapRowPositions.bind(this);
		pod.removeRow = this._removeRow.bind(this);
		pod.getElesChildren = () => this._childComps.map(comp => comp.eleRow);
		return pod;
	}

	setStateFrom (toLoad) {
		toLoad = toLoad || {};

		// Migrate compressed keys → full state
		this._state.title = toLoad.t ?? toLoad.title ?? "";
		this._state.isEditMode = toLoad.e ?? toLoad.isEditMode ?? false;
		this._state.lastRolledIx = toLoad.l ?? toLoad.lastRolledIx ?? null;

		this._childComps = [];
		const rowsRaw = toLoad.r ?? toLoad.rows ?? [];
		rowsRaw.forEach(r => {
			const comp = new CustomRandomTableRow(this._board, this._wrpPanel);
			comp.setStateFrom(r);
			this._childComps.push(comp);
		});

		// Bounds-check restored lastRolledIx against loaded rows
		if (this._state.lastRolledIx != null
			&& (this._state.lastRolledIx < 0 || this._state.lastRolledIx >= this._childComps.length)) {
			this._state.lastRolledIx = null;
		}
	}

	getSaveableState () {
		return {
			t: this._state.title || "",
			e: !!this._state.isEditMode,
			r: this._childComps.map(comp => comp.getSaveableState()),
			l: this._state.lastRolledIx ?? null,
		};
	}
}

class CustomRandomTableRow extends CustomRandomTableComponent {
	constructor (board, wrpPanel) {
		super(board, wrpPanel);
		this._eleRow = null;
	}

	get eleRow () { return this._eleRow; }

	_getDefaultState () { return {id: CryptUtil.uid(), text: ""}; }

	setStateFrom (toLoad) {
		toLoad = toLoad || {};
		this._state.id = toLoad.i ?? toLoad.id ?? CryptUtil.uid();
		this._state.text = toLoad.x ?? toLoad.text ?? "";
	}

	getSaveableState () {
		return {i: this._state.id, x: this._state.text || ""};
	}

	render (eleParent, parent, {ix, isEditMode, isLastRolled}) {
		this._parent = parent;

		const num = ee`<div class="dm-crandom__row-num ve-muted ve-text-right">${ix + 1}.</div>`;

		if (isEditMode) {
			const iptText = ee`<textarea class="ve-form-control ve-input-xs form-control--minimal dm-crandom__row-ipt" rows="1" placeholder="Row text (supports {@spell fireball}, {@creature goblin}, {@dice 1d6}, …)">${this._state.text || ""}</textarea>`
				.onn("input", () => { this._state.text = iptText.value; });

			const btnDel = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs dm-crandom__btn-del" title="Delete row"><span class="glyphicon glyphicon-trash"></span></button>`
				.onn("click", () => this._parent.removeRow(this));

			this._eleRow = ee`<div class="dm-crandom__row dm-crandom__row--edit ve-flex-v-center ve-w-100 ve-py-1" data-row-id="${this._state.id}">
				${DragReorderUiUtil.getDragPad2(() => this._eleRow, eleParent, this._parent)}
				${num}
				${iptText}
				${btnDel}
			</div>`.appendTo(eleParent);
			return;
		}

		// View mode: rendered {@tag ...} content
		const eleText = ee`<div class="dm-crandom__row-text"></div>`;
		const rendered = Renderer.get().render(this._state.text || "");
		eleText.innerHTML = rendered;

		const clsLast = isLastRolled ? " dm-crandom__row--last" : "";
		this._eleRow = ee`<div class="dm-crandom__row dm-crandom__row--view ve-flex-v-center ve-w-100 ve-py-1${clsLast}" data-row-id="${this._state.id}">
			${num}
			${eleText}
		</div>`.appendTo(eleParent);
	}
}
