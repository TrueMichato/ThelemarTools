import {InitiativeTrackerConst, InitiativeTrackerRowUtil} from "./dmscreen-initiativetracker-consts.js";
import {InitiativeTrackerNetworking} from "./dmscreen-initiativetracker-networking.js";
import {InitiativeTrackerSettings} from "./dmscreen-initiativetracker-settings.js";
import {InitiativeTrackerSettingsImport} from "./dmscreen-initiativetracker-importsettings.js";
import {InitiativeTrackerMonsterAdd} from "./dmscreen-initiativetracker-monsteradd.js";
import {InitiativeTrackerRoller} from "./dmscreen-initiativetracker-roller.js";
import {InitiativeTrackerEncounterConverter} from "./dmscreen-initiativetracker-encounterconverter.js";
import {
	InitiativeTrackerStatColumnFactory,
	IS_PLAYER_VISIBLE_ALL,
} from "./dmscreen-initiativetracker-statcolumns.js";
import {
	InitiativeTrackerRowDataViewActive,
} from "./dmscreen-initiativetracker-rowsactive.js";
import {
	InitiativeTrackerConditionCustomSerializer,
	InitiativeTrackerRowDataSerializer,
	InitiativeTrackerStatColumnDataSerializer,
} from "./dmscreen-initiativetracker-serial.js";
import {InitiativeTrackerSort} from "./dmscreen-initiativetracker-sort.js";
import {InitiativeTrackerUtil} from "../../initiativetracker/initiativetracker-utils.js";
import {DmScreenUtil} from "../dmscreen-util.js";
import {PANEL_TYP_PARTY_TRACKER} from "../dmscreen-consts.js";
import {
	InitiativeTrackerRowStateBuilderActive,
	InitiativeTrackerRowStateBuilderDefaultParty,
} from "./dmscreen-initiativetracker-rowstatebuilder.js";
import {InitiativeTrackerDefaultParty} from "./dmscreen-initiativetracker-defaultparty.js";
import {ListUtilBestiary} from "../../utils-list-bestiary.js";
import {InitiativeTrackerLairMarkers} from "./dmscreen-initiativetracker-lairmarkers.js";
import {InitiativeTrackerConditionUtil} from "./dmscreen-initiativetracker-condition.js";

// TODO(Future) refactor to subclass `DmScreenPanelAppBase`; move state to `_comp`
export class InitiativeTracker extends BaseComponent {
	constructor ({board, savedState}) {
		super();

		this._board = board;
		this._savedState = savedState;

		this._networking = new InitiativeTrackerNetworking({board});
		this._roller = new InitiativeTrackerRoller();
		this._rowStateBuilderActive = new InitiativeTrackerRowStateBuilderActive({comp: this, roller: this._roller});
		this._rowStateBuilderDefaultParty = new InitiativeTrackerRowStateBuilderDefaultParty({comp: this, roller: this._roller});

		this._viewRowsActive = null;
		this._viewRowsActiveMeta = null;

		this._compDefaultParty = null;

		this._creatureViewers = [];

		this._doUpdateExternalStates = null;
		this._sendStateToClientsDebounced = null;

		// Multi-select bulk-HP state (non-persisted, session-only).
		this._selectedRowIds = new Set();
		this._lastSelectedRowId = null;
		this._selectionHooks = [];
		this._hpApplyUndoStack = [];
		this._selectionBarRefs = null;

		// region Lair-action markers
		this._lairGroupCache = new Map(); // hash -> {legGroup, monName}
		this._lairGroupPendingLoads = new Map(); // hash -> Promise
		this._lairRowMonsterInfo = new Map(); // rowId -> {mon, groupHash}
		this._dismissedLairGroupHashes = new Set(); // session-only, not persisted
		this._isLairReconciling = false;
		// endregion
	}

	/* -------------------------------------------- */
	// region Multi-select bulk-HP API

	isRowSelected (rowId) { return this._selectedRowIds.has(rowId); }

	getSelectedRowIds () { return [...this._selectedRowIds]; }

	_addHookBaseSelection (fn) { this._selectionHooks.push(fn); }
	_removeHookBaseSelection (fn) {
		const ix = this._selectionHooks.indexOf(fn);
		if (~ix) this._selectionHooks.splice(ix, 1);
	}
	_fireSelectionHooks () { this._selectionHooks.forEach(fn => { try { fn(); } catch (e) { /* swallow */ } }); }

	toggleRowSelection (rowId, {isShift = false} = {}) {
		if (isShift && this._lastSelectedRowId && this._lastSelectedRowId !== rowId) {
			const rows = this._state.rows.filter(r => !InitiativeTrackerRowUtil.isNonCombatantRow(r));
			const ixAnchor = rows.findIndex(r => r.id === this._lastSelectedRowId);
			const ixTarget = rows.findIndex(r => r.id === rowId);
			if (~ixAnchor && ~ixTarget) {
				const [lo, hi] = ixAnchor < ixTarget ? [ixAnchor, ixTarget] : [ixTarget, ixAnchor];
				const shouldSelect = !this._selectedRowIds.has(rowId);
				for (let i = lo; i <= hi; ++i) {
					if (shouldSelect) this._selectedRowIds.add(rows[i].id);
					else this._selectedRowIds.delete(rows[i].id);
				}
				this._lastSelectedRowId = rowId;
				this._fireSelectionHooks();
				this._updateSelectionBar();
				return;
			}
		}
		if (this._selectedRowIds.has(rowId)) this._selectedRowIds.delete(rowId);
		else this._selectedRowIds.add(rowId);
		this._lastSelectedRowId = rowId;
		this._fireSelectionHooks();
		this._updateSelectionBar();
	}

	clearSelection () {
		if (!this._selectedRowIds.size) return;
		this._selectedRowIds.clear();
		this._lastSelectedRowId = null;
		this._fireSelectionHooks();
		this._updateSelectionBar();
	}

	_pruneSelection () {
		const validIds = new Set(this._state.rows.map(r => r.id));
		let changed = false;
		for (const id of [...this._selectedRowIds]) {
			if (!validIds.has(id)) { this._selectedRowIds.delete(id); changed = true; }
		}
		if (this._lastSelectedRowId && !validIds.has(this._lastSelectedRowId)) {
			this._lastSelectedRowId = null;
			changed = true;
		}
		// Also prune undo snapshots pointing at now-gone rows so undo can't
		// resurrect state for deleted creatures.
		this._hpApplyUndoStack = this._hpApplyUndoStack
			.map(entry => ({
				...entry,
				snapshots: entry.snapshots.filter(s => validIds.has(s.rowId)),
			}))
			.filter(entry => entry.snapshots.length);
		if (changed) this._fireSelectionHooks();
		this._updateSelectionBar();
	}

	_applyHpToSelection ({raw, isHalf}) {
		if (this._state.isLocked) return {ok: false, msg: "Tracker is locked."};
		const trimmed = (raw ?? "").trim();
		if (!trimmed) return {ok: false, msg: "Enter an expression, e.g. -30, +12, =15, or 8d6."};

		const selectedIds = this.getSelectedRowIds();
		if (!selectedIds.length) return {ok: false, msg: "No rows selected."};

		// Bulk-bar convention (user-confirmed): bare unsigned number = damage.
		// Rewrite `12` -> `-12` before parsing so downstream logic is unified.
		let procRaw = trimmed;
		const isSignedOrSet = /^[=+\-*/^]/.test(procRaw);
		if (!isSignedOrSet) procRaw = `-${procRaw}`;

		// Evaluate the expression ONCE against a placeholder prev of 0 so dice
		// resolve to a single shared numeric magnitude, then apply that same
		// magnitude to each selected row. Matches "one Fireball, one damage roll".
		const parsed = UiUtil.getStrNumericModified(procRaw, 0, {isInt: true, fallbackOnNaN: null});
		if (parsed?.next == null || !Number.isFinite(parsed.next)) return {ok: false, msg: "Could not parse expression."};

		let sharedDelta = null;
		let absoluteSet = null;
		if (parsed.mode === "set") {
			absoluteSet = parsed.next;
		} else {
			// parsed.delta is (next - 0) = the numeric magnitude with sign
			sharedDelta = parsed.delta ?? parsed.next;
			if (isHalf) sharedDelta = InitiativeTrackerRowUtil.getHalvedDelta(sharedDelta);
		}

		// Snapshot pre-apply values (only for currently-existing combatant rows)
		// and build the new rows array in ONE mutation so the root rows-hook
		// fires exactly once, keeping saves batched.
		const idSet = new Set(selectedIds);
		const snapshots = [];
		const nextRows = this._state.rows.map(row => {
			if (!idSet.has(row.id) || InitiativeTrackerRowUtil.isNonCombatantRow(row)) return row;
			const cur = row.entity.hpCurrent;
			const hpTemp = Math.max(0, row.entity.hpTemp || 0);
			const absorbed = absoluteSet == null && sharedDelta < 0
				? Math.min(hpTemp, Math.abs(sharedDelta))
				: 0;
			const next = absoluteSet != null ? absoluteSet : ((cur ?? 0) + sharedDelta + absorbed);
			snapshots.push({rowId: row.id, hpCurrent: cur, hpTemp: row.entity.hpTemp});
			return {
				...row,
				entity: {...row.entity, hpCurrent: next, hpTemp: hpTemp - absorbed},
			};
		});
		if (!snapshots.length) return {ok: false, msg: "Selected rows are no longer present."};

		this._hpApplyUndoStack.push({snapshots, raw: trimmed, mode: parsed.mode, isHalf: !!isHalf});
		while (this._hpApplyUndoStack.length > 5) this._hpApplyUndoStack.shift();

		this._state.rows = nextRows;
		this._updateSelectionBar();
		return {ok: true, count: snapshots.length};
	}

	_undoLastHpApply () {
		const entry = this._hpApplyUndoStack.pop();
		if (!entry) return {ok: false, msg: "Nothing to undo."};
		const byId = new Map(entry.snapshots.map(s => [s.rowId, s]));
		const nextRows = this._state.rows.map(row => {
			if (!byId.has(row.id)) return row;
			const snapshot = byId.get(row.id);
			return {...row, entity: {...row.entity, hpCurrent: snapshot.hpCurrent, hpTemp: snapshot.hpTemp}};
		});
		this._state.rows = nextRows;
		this._updateSelectionBar();
		return {ok: true, count: byId.size};
	}

	_updateSelectionBar () {
		if (!this._selectionBarRefs) return;
		this._selectionBarRefs.update();
	}

	// endregion
	/* -------------------------------------------- */

	getState () {
		return this._getSerializedState();
	}

	async pDoConnectLocalV1 () {
		const {token} = await this._networking.startServerV1({doUpdateExternalStates: this._doUpdateExternalStates});
		return token;
	}

	async pDoConnectLocalV0 (clientView) {
		await this._networking.pHandleDoConnectLocalV0({clientView});
		this._sendStateToClientsDebounced();
	}

	getSummary () {
		const names = this._state.rows
			.map(({entity}) => entity.name)
			.filter(name => name && name.trim());

		return `${this._state.rows.length} creature${this._state.rows.length === 1 ? "" : "s"} ${names.length ? `(${names.slice(0, 3).join(", ")}${names.length > 3 ? "..." : ""})` : ""}`;
	}

	async pDoLoadEncounter ({entityInfos, encounterInfo}) {
		await this._pDoLoadEncounter({entityInfos, encounterInfo});
	}

	async pDoAppendNpcTrackerEntries ({entries}) {
		if (this._state.isLocked) return {ok: false, message: "Initiative Tracker is locked."};
		if (!Array.isArray(entries) || !entries.length) return {ok: false, message: "No NPCs were provided."};
		if (entries.some(entry => !entry?.monster?.name || !entry.monster.source || !Number.isFinite(entry.initiative))) {
			return {ok: false, message: "NPC initiative data is incomplete."};
		}

		const rowsNext = [...this._state.rows];
		for (const entry of entries) {
			const conditions = (entry.conditions || [])
				.filter(condition => Parser.CONDITIONS.includes(condition))
				.map(condition => {
					const name = condition === "exhaustion" ? "Exhausted" : condition.toTitleCase();
					return InitiativeTrackerConditionUtil.getNewRowState({
						name,
						color: Parser.CONDITION_TO_COLOR[name],
					});
				});
			const row = await this._rowStateBuilderActive.pGetNewRowState({
				rows: rowsNext,
				monster: MiscUtil.copyFast(entry.monster),
				name: entry.monster.name,
				displayName: entry.monster._displayName || entry.monster.name,
				customName: entry.alias || null,
				source: entry.monster.source,
				hpCurrent: entry.hp?.current ?? null,
				hpMax: entry.hp?.max ?? null,
				hpTemp: entry.hp?.temp ?? 0,
				initiative: entry.initiative,
				conditions,
			});
			if (!row) return {ok: false, message: `Could not add "${entry.alias || entry.monster.name}".`};
			rowsNext.push(row);
		}

		this._state.rows = InitiativeTrackerSort.getSortedRows({
			rows: rowsNext,
			sortBy: this._state.sort,
			sortDir: this._state.dir,
		});
		return {ok: true, count: entries.length};
	}

	getApi () {
		return this;
	}

	render () {
		if (this._viewRowsActiveMeta) this._viewRowsActiveMeta.cbDoCleanup();
		this._resetHooks("state");
		this._resetHooksAll("state");

		this._setStateFromSerialized();

		this._render_bindSortDirHooks();

		const wrpTracker = ee`<div class="dm-init dm__panel-bg"></div>`
			.onn("drop", evt => this._pDoHandleImportDrop(evt));

		this._sendStateToClientsDebounced = MiscUtil.debounce(
			() => {
				this._networking.sendStateToClients({fnGetToSend: this._getPlayerFriendlyState.bind(this)});
				this._sendStateToCreatureViewers();
			},
			100, // long delay to avoid network spam
		);

		this._doUpdateExternalStates = () => {
			this._board.doSaveStateDebounced();
			this._sendStateToClientsDebounced();
		};
		this._addHookAllBase(this._doUpdateExternalStates);

		this._addHookBase("rows", () => { this.pReconcileLairMarkers().catch(e => setTimeout(() => { throw e; })); });
		this._addHookBase("autoAddLairActions", () => { this.pReconcileLairMarkers().catch(e => setTimeout(() => { throw e; })); });
		// Initial reconciliation, in case loaded saved state contains lair-eligible creatures without markers,
		//   or has stale markers whose creature refs were removed while the panel was closed.
		this.pReconcileLairMarkers().catch(e => setTimeout(() => { throw e; }));

		this._viewRowsActive = new InitiativeTrackerRowDataViewActive({
			comp: this,
			prop: "rows",
			roller: this._roller,
			networking: this._networking,
			rowStateBuilder: this._rowStateBuilderActive,
		});

		this._render_getWrpSelectionBar().appendTo(wrpTracker);

		this._viewRowsActiveMeta = this._viewRowsActive.getRenderedView();
		this._viewRowsActiveMeta.ele.appendTo(wrpTracker);

		// Prune selection + undo snapshots whenever the row set changes
		// (delete / reset / import). Runs after the view's own rows hook.
		this._addHookBase("rows", () => this._pruneSelection());

		this._render_getWrpFooter({wrpTracker, doUpdateExternalStates: this._doUpdateExternalStates}).appendTo(wrpTracker);

		return wrpTracker;
	}

	_render_getWrpSelectionBar () {
		const iptExpr = ee`<input type="text" class="ve-form-control ve-input-xs dm-init-lockable dm-init__sel-bar-ipt" placeholder="e.g. 30 (damage), +12, =15, 8d6" title="Bare number = damage. Use + to heal, = to set. Dice supported.">`
			.onn("keydown", evt => {
				if (evt.key === "Enter") { evt.preventDefault(); doApply(); } else if (evt.key === "Escape") iptExpr.blur();
			});

		const cbHalf = ee`<input type="checkbox" class="dm-init-lockable" title="Halve the numeric damage/heal (5e save-for-half). Ignored for =X.">`;

		const btnApply = ee`<button class="ve-btn ve-btn-danger ve-btn-xs dm-init-lockable" title="Apply HP change to all selected rows">Apply</button>`
			.onn("click", () => doApply());

		const btnUndo = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-init-lockable" title="Undo last bulk HP apply"><span class="glyphicon glyphicon-repeat" style="transform: scaleX(-1);"></span> Undo</button>`
			.onn("click", () => {
				const res = this._undoLastHpApply();
				if (!res.ok) return;
				iptExpr.focus();
			});

		const btnClear = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Clear selection"><span class="glyphicon glyphicon-remove"></span></button>`
			.onn("click", () => this.clearSelection());

		const dispCount = ee`<span class="dm-init__sel-bar-count"></span>`;
		const dispMsg = ee`<span class="dm-init__sel-bar-msg ve-muted ve-ml-2"></span>`;

		const doApply = () => {
			const raw = iptExpr.val();
			const isHalf = !!cbHalf.prop("checked");
			const res = this._applyHpToSelection({raw, isHalf});
			if (!res.ok) {
				dispMsg.txt(res.msg || "");
				dispMsg.addClass("ve-error-color");
				return;
			}
			dispMsg.removeClass("ve-error-color");
			dispMsg.txt(`Applied to ${res.count}.`);
			iptExpr.val("");
			iptExpr.focus();
		};

		const wrp = ee`<div class="dm-init__wrp-selection-bar ve-flex-v-center ve-mx-2 ve-my-1">
			${dispCount}
			${iptExpr}
			<label class="ve-flex-v-center ve-ml-2 ve-mb-0" title="Half damage on save (5e)">${cbHalf}<span class="ve-ml-1">½</span></label>
			${btnApply}
			${btnUndo}
			${btnClear}
			${dispMsg}
		</div>`;

		const update = () => {
			const n = this._selectedRowIds.size;
			wrp.toggleVe(!!n);
			dispCount.txt(`Selected: ${n}`);
			btnUndo.toggleVe(!!this._hpApplyUndoStack.length);
			// Clear stale success msg once selection changes
			if (!n) { dispMsg.txt(""); dispMsg.removeClass("ve-error-color"); }
		};

		this._selectionBarRefs = {wrp, update};
		update();

		return wrp;
	}

	_render_getWrpButtonsSort () {
		const btnSortAlpha = ee`<button title="Sort Alphabetically" class="ve-btn ve-btn-default ve-btn-xs"><span class="glyphicon glyphicon-sort-by-alphabet"></span></button>`
			.onn("click", () => {
				if (this._state.sort === InitiativeTrackerConst.SORT_ORDER_ALPHA) return this._doReverseSortDir();
				this._proxyAssignSimple(
					"state",
					{
						sort: InitiativeTrackerConst.SORT_ORDER_ALPHA,
						dir: InitiativeTrackerConst.SORT_DIR_ASC,
					},
				);
			});

		const btnSortNumber = ee`<button title="Sort Numerically" class="ve-btn ve-btn-default ve-btn-xs"><span class="glyphicon glyphicon-sort-by-order"></span></button>`
			.onn("click", () => {
				if (this._state.sort === InitiativeTrackerConst.SORT_ORDER_NUM) return this._doReverseSortDir();
				this._proxyAssignSimple(
					"state",
					{
						sort: InitiativeTrackerConst.SORT_ORDER_NUM,
						dir: InitiativeTrackerConst.SORT_DIR_DESC,
					},
				);
			});

		const hkSortDir = () => {
			btnSortAlpha.toggleClass("ve-active", this._state.sort === InitiativeTrackerConst.SORT_ORDER_ALPHA);
			btnSortNumber.toggleClass("ve-active", this._state.sort === InitiativeTrackerConst.SORT_ORDER_NUM);
		};
		this._addHookBase("sort", hkSortDir);
		this._addHookBase("dir", hkSortDir);
		hkSortDir();

		return ee`<div class="ve-btn-group ve-flex">
			${btnSortAlpha}
			${btnSortNumber}
		</div>`;
	}

	_render_getWrpFooter ({wrpTracker, doUpdateExternalStates}) {
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs dm-init-lockable" title="Add Player"><span class="glyphicon glyphicon-plus"></span></button>`
			.onn("click", async () => {
				if (this._state.isLocked) return;
				this._state.rows = [
					...this._state.rows,
					await this._rowStateBuilderActive.pGetNewRowState({
						isPlayerVisible: true,
					}),
				]
					.filter(Boolean);
			});

		const btnAddMonster = ee`<button class="ve-btn ve-btn-success ve-btn-xs dm-init-lockable ve-mr-2" title="Add Creature"><span class="glyphicon glyphicon-print"></span></button>`
			.onn("click", async () => {
				if (this._state.isLocked) return;

				const [isDataEntered, monstersToLoad] = await new InitiativeTrackerMonsterAdd({board: this._board, isRollHp: this._state.isRollHp})
					.pGetShowModalResults();
				if (!isDataEntered) return;

				this._state.isRollHp = monstersToLoad.isRollHp;

				const isGroupRollEval = monstersToLoad.count > 1 && this._state.isRollGroups;

				const mon = isGroupRollEval
					? await DmScreenUtil.pGetScaledCreature({
						name: monstersToLoad.name,
						source: monstersToLoad.source,
						scaledCr: monstersToLoad.scaledCr,
						scaledSummonSpellLevel: monstersToLoad.scaledSummonSpellLevel,
						scaledSummonClassLevel: monstersToLoad.scaledSummonClassLevel,
					})
					: null;

				const initiative = isGroupRollEval
					? await this._roller.pGetRollInitiative({mon})
					: null;

				const rowsNxt = [...this._state.rows];

				(await [...new Array(monstersToLoad.count)]
					.pSerialAwaitMap(async () => {
						const rowNxt = await this._rowStateBuilderActive.pGetNewRowState({
							name: monstersToLoad.name,
							source: monstersToLoad.source,
							initiative,
							rows: rowsNxt,
							displayName: monstersToLoad.displayName,
							customName: monstersToLoad.customName,
							scaledCr: monstersToLoad.scaledCr,
							scaledSummonSpellLevel: monstersToLoad.scaledSummonSpellLevel,
							scaledSummonClassLevel: monstersToLoad.scaledSummonClassLevel,
						});
						if (!rowNxt) return;
						rowsNxt.push(rowNxt);
					}));

				this._state.rows = rowsNxt;
			});

		const btnImportParty = ee`<button class="ve-btn ve-btn-info ve-btn-xs dm-init-lockable" title="Import from Party Tracker"><span class="glyphicon glyphicon-transfer"></span></button>`
			.onn("click", async () => {
				if (this._state.isLocked) return;

				const partyCharacters = DmScreenUtil.getPartyTrackerCharacters({board: this._board});
				if (!partyCharacters?.length) {
					JqueryUtil.doToast({content: "No characters found in Party Tracker.", type: "warning"});
					return;
				}

				const existingNames = new Set(
					this._state.rows
						.map(r => (r.entity?.customName || r.entity?.name || "").toLowerCase())
						.filter(Boolean),
				);

				const rowsNxt = [...this._state.rows];
				let addedCount = 0;

				for (const char of partyCharacters) {
					if (!char.name || existingNames.has(char.name.toLowerCase())) continue;

					const rowNxt = await this._rowStateBuilderActive.pGetNewRowState({
						name: char.name,
						isPlayerVisible: true,
					});
					if (!rowNxt) continue;
					rowsNxt.push(rowNxt);
					existingNames.add(char.name.toLowerCase());
					addedCount++;
				}

				this._state.rows = rowsNxt;
				JqueryUtil.doToast({content: `Imported ${addedCount} character${addedCount !== 1 ? "s" : ""} from Party Tracker.`});
			});

		const btnSetPrevActive = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Previous Turn"><span class="glyphicon glyphicon-step-backward"></span></button>`
			.onn("click", () => this._viewRowsActive.pDoShiftActiveRow({direction: InitiativeTrackerConst.DIR_BACKWARDS}));
		const btnSetNextActive = ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-mr-2" title="Next Turn"><span class="glyphicon glyphicon-step-forward"></span></button>`
			.onn("click", () => this._viewRowsActive.pDoShiftActiveRow({direction: InitiativeTrackerConst.DIR_FORWARDS}));

		const iptRound = ComponentUiUtil.getIptInt(this, "round", 1, {min: 1})
			.addClass("dm-init__rounds")
			.removeClass("ve-text-right")
			.addClass("ve-text-center")
			.tooltip("Round");

		const menuPlayerWindow = ContextUtil.getMenu([
			new ContextUtil.Action(
				"Standard",
				async () => {
					this._networking.handleClick_playerWindowV1({doUpdateExternalStates});
				},
			),
			new ContextUtil.Action(
				"Manual (Legacy)",
				async () => {
					this._networking.handleClick_playerWindowV0({doUpdateExternalStates});
				},
			),
		]);

		const btnNetworking = ee`<button class="ve-btn ve-btn-primary ve-btn-xs ve-mr-2" title="Configure Player View (SHIFT to Open Configuration for &quot;Standard&quot; View)"><span class="glyphicon glyphicon-user"></span></button>`
			.onn("click", evt => {
				if (evt.shiftKey) return this._networking.handleClick_playerWindowV1({doUpdateExternalStates});
				return ContextUtil.pOpenMenu(evt, menuPlayerWindow);
			});

		const btnLock = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Lock Tracker"><span class="glyphicon glyphicon-lock"></span></button>`
			.onn("click", () => this._state.isLocked = !this._state.isLocked);
		this._addHookBase("isLocked", () => {
			btnLock
				.toggleClass("ve-btn-success", !!this._state.isLocked)
				.toggleClass("ve-btn-danger", !this._state.isLocked)
				.tooltip(this._state.isLocked ? "Unlock Tracker" : "Lock Tracker");
			wrpTracker.findAll(".dm-init-lockable").forEach(ele => ele.toggleClass("ve-disabled", !!this._state.isLocked));
			wrpTracker.findAll("input.dm-init-lockable").forEach(ele => ele.prop("disabled", !!this._state.isLocked));
		})();

		this._compDefaultParty = new InitiativeTrackerDefaultParty({comp: this, roller: this._roller, rowStateBuilder: this._rowStateBuilderDefaultParty});

		const pHandleClickSettings = async () => {
			const compSettings = new InitiativeTrackerSettings({state: MiscUtil.copyFast(this._state)});
			await compSettings.pGetShowModalResults();
			Object.assign(this._state, compSettings.getStateUpdate());
		};

		const menuConfigure = ContextUtil.getMenu([
			new ContextUtil.Action(
				"Settings",
				() => pHandleClickSettings(),
			),
			null,
			new ContextUtil.Action(
				"Edit Default Party",
				async () => {
					await this._compDefaultParty.pGetShowModalResults();
				},
			),
		]);

		const btnConfigure = ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-mr-2" title="Configure (SHIFT to Open &quot;Settings&quot;)"><span class="glyphicon glyphicon-cog"></span></button>`
			.onn("click", async evt => {
				if (evt.shiftKey) return pHandleClickSettings();
				return ContextUtil.pOpenMenu(evt, menuConfigure);
			});

		const menuImport = ContextUtil.getMenu([
			...ListUtilBestiary.getContextOptionsLoadSublist({
				pFnOnSelect: this._pDoLoadEncounter.bind(this),
			}),
			null,
			new ContextUtil.Action(
				"Import Settings",
				async () => {
					const compImportSettings = new InitiativeTrackerSettingsImport({state: MiscUtil.copyFast(this._state)});
					await compImportSettings.pGetShowModalResults();
					Object.assign(this._state, compImportSettings.getStateUpdate());
				},
			),
		]);

		const btnLoad = ee`<button title="Import an encounter from the Bestiary" class="ve-btn ve-btn-success ve-btn-xs dm-init-lockable"><span class="glyphicon glyphicon-upload"></span></button>`
			.onn("click", (evt) => {
				if (this._state.isLocked) return;
				ContextUtil.pOpenMenu(evt, menuImport);
			});
		const btnReset = ee`<button title="Reset Tracker" class="ve-btn ve-btn-danger ve-btn-xs dm-init-lockable"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", async () => {
				if (this._state.isLocked) return;
				if (!await InputUiUtil.pGetUserBoolean({title: "Reset", htmlDescription: "Are you sure?", textYes: "Yes", textNo: "Cancel"})) return;

				const stateNxt = {
					rows: await this._compDefaultParty.pGetConvertedDefaultPartyActiveRows(),
				};
				const defaultState = this._getDefaultState();
				["round", "sort", "dir"]
					.forEach(prop => stateNxt[prop] = defaultState[prop]);

				this._proxyAssignSimple("state", stateNxt);
			});

		const btnSendToFoundry = ee`<button title="Send to Foundry" class="no-print ve-btn ve-btn-default ve-btn-xs dm-init-lockable"><span class="glyphicon glyphicon-send"></span></button>`
			.onn("click", async () => {
				if (this._state.isLocked) return;

				const encounterActorName = await InputUiUtil.pGetUserString({title: "Encounter Actor Name", isSkippable: true});

				const creatureMetasSerial = await Object.values(
					this._state.rows
						.filter(row => row.entity.source)
						.reduce(
							(accum, row) => {
								const uidRow = [
									row.entity.name,
									row.entity.source,
									row.entity.scaledCr,
									row.entity.scaledSummonSpellLevel,
									row.entity.scaledSummonClassLevel,
								]
									.join("__");

								if (accum[uidRow]) {
									accum[uidRow].count++;
									return accum;
								}

								accum[uidRow] = {entityPrime: row.entity, count: 1};

								return accum;
							},
							{},
						),
				)
					.pSerialAwaitMap(async ({entityPrime, count}) => {
						const creature = await DmScreenUtil.pGetScaledCreature({
							name: entityPrime.name,
							source: entityPrime.source,
							scaledCr: entityPrime.scaledCr,
							scaledSummonSpellLevel: entityPrime.scaledSummonSpellLevel,
							scaledSummonClassLevel: entityPrime.scaledSummonClassLevel,
						});

						return {
							creature,
							count,
						};
					});

				await ExtensionUtil.pDoSend({
					type: "5etools.encounterbuilder.encounter",
					data: {
						encounterActorName,
						creatureMetasSerial,
					},
				});
			});

		return ee`<div class="dm-init__wrp-controls">
			<div class="ve-flex">
				<div class="ve-btn-group ve-flex">
					${btnAdd}
					${btnImportParty}
					${btnAddMonster}
				</div>
				<div class="ve-btn-group">${btnSetPrevActive}${btnSetNextActive}</div>
				${iptRound}
			</div>

			${this._render_getWrpButtonsSort()}

			<div class="ve-flex">
				${btnNetworking}

				<div class="ve-btn-group ve-flex-v-center">
					${btnLock}
					${btnConfigure}
				</div>

				<div class="ve-btn-group ve-flex-v-center">
					${btnLoad}
					${btnSendToFoundry}
					${btnReset}
				</div>
			</div>
		</div>`;
	}

	_render_bindSortDirHooks () {
		const hkSortDir = () => {
			this._state.rows = InitiativeTrackerSort.getSortedRows({
				rows: this._state.rows,
				sortBy: this._state.sort,
				sortDir: this._state.dir,
			});
		};
		this._addHookBase("sort", hkSortDir);
		this._addHookBase("dir", hkSortDir);
		hkSortDir();
	}

	/* -------------------------------------------- */

	_doReverseSortDir () {
		this._state.dir = this._state.dir === InitiativeTrackerConst.SORT_DIR_ASC ? InitiativeTrackerConst.SORT_DIR_DESC : InitiativeTrackerConst.SORT_DIR_ASC;
	}

	/* -------------------------------------------- */

	_getPlayerFriendlyState () {
		const visibleStatsCols = this._state.statsCols
			.filter(data => data.isPlayerVisible);

		const rows = this._state.rows
			.map(({entity}) => {
				if (!entity.isPlayerVisible) return null;

				const isMon = !!entity.source;
				const isLairMarker = !!entity.isLairMarker;

				const out = {
					name: isLairMarker ? entity.displayName : entity.name,
					initiative: entity.initiative,
					isActive: entity.isActive,
					conditions: entity.conditions || [],
					rowStatColData: entity.rowStatColData
						.map(cell => {
							const mappedCol = visibleStatsCols.find(sc => sc.id === cell.id);
							if (!mappedCol) return null;

							if (mappedCol.isPlayerVisible === IS_PLAYER_VISIBLE_ALL || !isMon) {
								const meta = InitiativeTrackerStatColumnFactory.fromStateData({data: mappedCol});
								return meta.getPlayerFriendlyState({cell});
							}

							return {id: null, entity: {isUnknown: true}};
						})
						.filter(Boolean),
				};

				if (entity.customName) out.customName = entity.customName;

				if (isLairMarker) {
					// Marker has no HP; force wound level to unknown so player view doesn't render a bar.
					out.hpWoundLevel = -1;
					if (this._state.playerInitShowOrdinals && entity.isShowOrdinal) out.ordinal = entity.ordinal;
					return out;
				}

				if (isMon ? !!this._state.playerInitShowExactMonsterHp : !!this._state.playerInitShowExactPlayerHp) {
					out.hpCurrent = entity.hpCurrent;
					out.hpMax = entity.hpMax;
					out.hpTemp = entity.hpTemp;
				}

				if (isNaN(entity.hpCurrent) || isNaN(entity.hpMax)) {
					out.hpWoundLevel = -1;
				} else {
					const pctWounded = this._state.isInvertWoundDirection
						? 100 * (entity.hpMax - entity.hpCurrent) / entity.hpMax
						: 100 * entity.hpCurrent / entity.hpMax;
					out.hpWoundLevel = InitiativeTrackerUtil.getWoundLevel(pctWounded);
				}

				if (this._state.playerInitShowOrdinals && entity.isShowOrdinal) out.ordinal = entity.ordinal;

				return out;
			})
			.filter(Boolean);

		return {
			type: "state",
			payload: {
				rows,
				statsCols: visibleStatsCols
					.map(({id, abbreviation}) => ({id, abbreviation})),
				round: this._state.round,
			},
		};
	}

	/* -------------------------------------------- */

	async _pDoLoadEncounter ({entityInfos, encounterInfo}) {
		const rowsPrev = [...this._state.rows];

		// Reset rows early, such that our ordinals are correct for creatures from the encounter
		this._state.rows = [];

		const isAddPlayers = this._state.importIsAddPlayers && !this._state.rowsDefaultParty.length;

		const nxtState = await new InitiativeTrackerEncounterConverter({
			roller: this._roller,
			rowStateBuilderActive: this._rowStateBuilderActive,

			isInvertWoundDirection: this._state.isInvertWoundDirection,
			importIsAddPlayers: isAddPlayers,
			importIsRollGroups: this._state.importIsRollGroups,
			isRollInit: this._state.isRollInit,
			isRollHp: this._state.isRollHp,
			isRollGroups: this._state.isRollGroups,
		})
			.pGetConverted({entityInfos, encounterInfo});

		const rowsFromDefaultParty = await this._compDefaultParty.pGetConvertedDefaultPartyActiveRows({rowsPrev});
		const idsDefaultParty = new Set(rowsFromDefaultParty.map(({id}) => id));
		const rowsPrevNonDefaultParty = rowsPrev
			.filter(({id}) => !idsDefaultParty.has(id));

		const stateNxt = {
			rows: this._state.importIsAppend
				? [
					...rowsPrevNonDefaultParty,
					...rowsFromDefaultParty,
					...nxtState.rows,
				]
				: [
					...rowsFromDefaultParty,
					...nxtState.rows,
				],
		};

		if (nxtState.isOverwriteStatsCols) {
			const userVal = await InputUiUtil.pGetUserGenericButton({
				title: "Overwrite Additional Columns",
				buttons: [
					new InputUiUtil.GenericButtonInfo({
						text: "Yes",
						clazzIcon: "glyphicon glyphicon-ok",
						value: "yes",
					}),
					new InputUiUtil.GenericButtonInfo({
						text: "No",
						clazzIcon: "glyphicon glyphicon-remove",
						isPrimary: true,
						value: "no",
					}),
					new InputUiUtil.GenericButtonInfo({
						text: "Cancel",
						clazzIcon: "glyphicon glyphicon-stop",
						isSmall: true,
						value: "cancel",
					}),
				],
				htmlDescription: `<p>The encounter you are trying to load contains additional column data from the Encounter Builder's "Advanced" mode.<br>Do you want to overwrite your existing additional columns with columns from the encounter?</p>`,
			});

			switch (userVal) {
				case null:
				case "cancel": {
					this._state.rows = rowsPrev;
					return;
				}

				case "yes": {
					stateNxt.isStatsAddColumns = nxtState.isStatsAddColumns;
					stateNxt.statsCols = nxtState.statsCols
						.map(it => it.getAsStateData());
					break;
				}

				case "no": {
					// No-op
					break;
				}

				default: throw new Error(`Unexpected value "${userVal}"`);
			}
		}

		if (!this._state.importIsAppend) {
			const defaultState = this._getDefaultState();
			["round", "sort", "dir"]
				.forEach(prop => stateNxt[prop] = defaultState[prop]);
		}

		this._proxyAssignSimple("state", stateNxt);
	}

	/* -------------------------------------------- */

	async _pDoHandleImportDrop (evt) {
		const data = EventUtil.getDropJson(evt);
		if (!data) return;

		if (data.type !== VeCt.DRAG_TYPE_IMPORT) return;

		evt.stopPropagation();
		evt.preventDefault();

		const {page, source, hash} = data;
		if (page !== UrlUtil.PG_BESTIARY) return;

		const ent = await DataLoader.pCacheAndGet(page, source, hash, {isRequired: true});

		const rowsNxt = [...this._state.rows];
		const rowToAdd = await this._rowStateBuilderActive.pGetNewRowState({
			name: ent.name,
			source: ent.source,
			initiative: null,
			rows: rowsNxt,
		});
		if (!rowToAdd) return;
		rowsNxt.push(rowToAdd);
		this._state.rows = rowsNxt;
	}

	/* -------------------------------------------- */

	doConnectCreatureViewer ({creatureViewer}) {
		if (this._creatureViewers.includes(creatureViewer)) return this;
		this._creatureViewers.push(creatureViewer);
		creatureViewer.setCreatureState(this._getCreatureViewerFriendlyState());
		return this;
	}

	static _CREATURE_VIEWER_STATE_PROPS = [
		"name",
		"source",
		"scaledCr",
		"scaledSummonSpellLevel",
		"scaledSummonClassLevel",
	];

	_getCreatureViewerFriendlyState () {
		const activeRowPrime = this._state.rows
			.filter(({entity}) => entity.isActive)
			.find(Boolean);

		if (!activeRowPrime) {
			return Object.fromEntries(this.constructor._CREATURE_VIEWER_STATE_PROPS.map(prop => [prop, null]));
		}

		return Object.fromEntries(this.constructor._CREATURE_VIEWER_STATE_PROPS.map(prop => [prop, activeRowPrime.entity[prop]]));
	}

	doDisconnectCreatureViewer ({creatureViewer}) {
		this._creatureViewers = this._creatureViewers.filter(it => it !== creatureViewer);
	}

	_sendStateToCreatureViewers () {
		if (!this._creatureViewers.length) return;
		const creatureViewerFriendlyState = this._getCreatureViewerFriendlyState();
		this._creatureViewers.forEach(it => it.setCreatureState(creatureViewerFriendlyState));
	}

	/* -------------------------------------------- */

	_setStateFromSerialized () {
		const stateNxt = {
			// region Config
			sort: this._savedState.s || InitiativeTrackerConst.SORT_ORDER_NUM,
			dir: this._savedState.d || InitiativeTrackerConst.SORT_DIR_DESC,
			statsCols: (this._savedState.c || [])
				.map(dataSerial => this._setStateFromSerialized_statsCol({dataSerial}))
				.filter(Boolean),
			// endregion

			// region Custom conditions
			conditionsCustom: (this._savedState.cndc || [])
				.map(dataSerial => InitiativeTrackerConditionCustomSerializer.fromSerial(dataSerial)),
			// endregion

			// region Rows
			rows: (this._savedState.r || [])
				.map(dataSerial => InitiativeTrackerRowDataSerializer.fromSerial(dataSerial))
				.filter(Boolean),
			rowsDefaultParty: (this._savedState.rdp || [])
				.map(dataSerial => InitiativeTrackerRowDataSerializer.fromSerial(dataSerial))
				.filter(Boolean),
			// endregion

			// region Round
			round: isNaN(this._savedState.n) ? 1 : Number(this._savedState.n),
			// endregion

			// region Temporary
			isLocked: false,
			// endregion
		};

		// region Config
		if (this._savedState.ri != null) stateNxt.isRollInit = this._savedState.ri;
		if (this._savedState.m != null) stateNxt.isRollHp = this._savedState.m;
		if (this._savedState.rg != null) stateNxt.isRollGroups = this._savedState.rg;
		if (this._savedState.rri != null) stateNxt.isRerollInitiativeEachRound = this._savedState.rri;
		if (this._savedState.wId != null) stateNxt.isInvertWoundDirection = this._savedState.wId;
		if (this._savedState.g != null) stateNxt.importIsRollGroups = this._savedState.g;
		if (this._savedState.p != null) stateNxt.importIsAddPlayers = this._savedState.p;
		if (this._savedState.a != null) stateNxt.importIsAppend = this._savedState.a;
		if (this._savedState.k != null) stateNxt.isStatsAddColumns = this._savedState.k;
		if (this._savedState.piHp != null) stateNxt.playerInitShowExactPlayerHp = this._savedState.piHp;
		if (this._savedState.piHm != null) stateNxt.playerInitShowExactMonsterHp = this._savedState.piHm;
		if (this._savedState.piV != null) stateNxt.playerInitHideNewMonster = this._savedState.piV;
		if (this._savedState.piO != null) stateNxt.playerInitShowOrdinals = this._savedState.piO;
		if (this._savedState.alA != null) stateNxt.autoAddLairActions = this._savedState.alA;
		// endregion

		this._proxyAssignSimple("state", stateNxt);
	}

	_setStateFromSerialized_statsCol ({dataSerial}) {
		if (!dataSerial) return null;
		return InitiativeTrackerStatColumnFactory.fromStateData({dataSerial})
			.getAsStateData();
	}

	_getSerializedState () {
		return {
			// region Config
			s: this._state.sort,
			d: this._state.dir,
			ri: this._state.isRollInit,
			m: this._state.isRollHp,
			rg: this._state.isRollGroups,
			rri: this._state.isRerollInitiativeEachRound,
			wId: this._state.isInvertWoundDirection,
			g: this._state.importIsRollGroups,
			p: this._state.importIsAddPlayers,
			a: this._state.importIsAppend,
			k: this._state.isStatsAddColumns,
			piHp: this._state.playerInitShowExactPlayerHp,
			piHm: this._state.playerInitShowExactMonsterHp,
			piV: this._state.playerInitHideNewMonster,
			piO: this._state.playerInitShowOrdinals,
			alA: this._state.autoAddLairActions,
			c: (this._state.statsCols || [])
				.map(data => InitiativeTrackerStatColumnDataSerializer.toSerial(data)),
			// endregion

			// region Custom conditions
			cndc: (this._state.conditionsCustom || [])
				.map(data => InitiativeTrackerConditionCustomSerializer.toSerial(data)),
			// endregion

			// region Rows
			r: (this._state.rows || [])
				.map(data => InitiativeTrackerRowDataSerializer.toSerial(data)),
			rdp: (this._state.rowsDefaultParty || [])
				.map(data => InitiativeTrackerRowDataSerializer.toSerial(data)),
			// endregion

			// region Round
			n: this._state.round,
			// endregion
		};
	}

	_getDefaultState () {
		return {
			// region Config
			sort: InitiativeTrackerConst.SORT_ORDER_NUM,
			dir: InitiativeTrackerConst.SORT_DIR_DESC,
			isRollInit: true,
			isRollHp: false,
			isRollGroups: false,
			isRerollInitiativeEachRound: false,
			isInvertWoundDirection: false,
			importIsRollGroups: true,
			importIsAddPlayers: true,
			importIsAppend: false,
			isStatsAddColumns: false,
			playerInitShowExactPlayerHp: false,
			playerInitShowExactMonsterHp: false,
			playerInitHideNewMonster: true,
			playerInitShowOrdinals: false,
			autoAddLairActions: true,
			statsCols: [],
			// endregion

			// region Custom conditions
			conditionsCustom: [],
			// endregion

			// region Rows
			rows: [],
			rowsDefaultParty: [],
			// endregion

			// region Round
			round: 1,
			// endregion

			// region Temporary
			isLocked: false,
			// endregion
		};
	}

	/* -------------------------------------------- */

	// region Lair-action markers

	async pReconcileLairMarkers () {
		if (this._isLairReconciling) return;

		this._isLairReconciling = true;
		try {
			await this._pReconcileLairMarkers_inner();
		} finally {
			this._isLairReconciling = false;
		}
	}

	async _pReconcileLairMarkers_inner () {
		const rows = this._state.rows || [];
		const autoAddEnabled = !!this._state.autoAddLairActions;

		// Resolve legendary groups for every non-marker row that has a source.
		//   We do this even when auto-add is disabled, so that existing markers
		//   can be reconciled (kept in sync / removed when refs disappear).
		const monsterRows = rows.filter(r => !r.entity?.isLairMarker && r.entity?.source && r.entity?.name);
		const hashByRowId = new Map();

		await monsterRows
			.pSerialAwaitMap(async row => {
				await this._pResolveRowLegendaryGroup({row, hashByRowId});
			});

		const {rowsNxt, changed} = InitiativeTrackerLairMarkers.computeReconcileDiff({
			rows,
			monsterLegendaryGroupHashByRowId: hashByRowId,
			legGroupCache: this._lairGroupCache,
			autoAddEnabled,
			dismissedHashes: this._dismissedLairGroupHashes,
			fnMakeId: () => CryptUtil.uid(),
		});

		if (!changed) return;

		this._state.rows = InitiativeTrackerSort.getSortedRows({
			rows: rowsNxt,
			sortBy: this._state.sort,
			sortDir: this._state.dir,
		});
	}

	async _pResolveRowLegendaryGroup ({row, hashByRowId}) {
		const cached = this._lairRowMonsterInfo.get(row.id);
		if (cached && cached.rowName === row.entity.name && cached.rowSource === row.entity.source) {
			if (cached.groupHash) hashByRowId.set(row.id, cached.groupHash);
			return;
		}

		const mon = row.entity.monster || await DmScreenUtil.pGetScaledCreature({
			name: row.entity.name,
			source: row.entity.source,
			scaledCr: row.entity.scaledCr,
			scaledSummonSpellLevel: row.entity.scaledSummonSpellLevel,
			scaledSummonClassLevel: row.entity.scaledSummonClassLevel,
		});

		let groupHash = null;
		if (mon?.legendaryGroup?.name && mon?.legendaryGroup?.source) {
			groupHash = InitiativeTrackerLairMarkers.getGroupHash(mon.legendaryGroup);
			await this._pEnsureLegendaryGroupLoaded({legendaryGroup: mon.legendaryGroup, monName: mon.name});
			if (!InitiativeTrackerLairMarkers.hasTrackableContent(this._lairGroupCache.get(groupHash)?.legGroup)) {
				groupHash = null;
			}
		}

		this._lairRowMonsterInfo.set(row.id, {
			rowName: row.entity.name,
			rowSource: row.entity.source,
			groupHash,
		});

		if (groupHash) hashByRowId.set(row.id, groupHash);
	}

	async _pEnsureLegendaryGroupLoaded ({legendaryGroup, monName}) {
		const hash = InitiativeTrackerLairMarkers.getGroupHash(legendaryGroup);
		if (!hash) return;

		if (this._lairGroupCache.has(hash)) {
			// Update parent monster name only if not yet set (first-arrival wins)
			const entry = this._lairGroupCache.get(hash);
			if (!entry.monName && monName) entry.monName = monName;
			return;
		}

		if (this._lairGroupPendingLoads.has(hash)) {
			await this._lairGroupPendingLoads.get(hash);
			return;
		}

		const p = (async () => {
			try {
				const groupHashUrl = UrlUtil.URL_TO_HASH_BUILDER["legendaryGroup"](legendaryGroup);
				const legGroup = await DataLoader.pCacheAndGet("legendaryGroup", legendaryGroup.source, groupHashUrl);
				this._lairGroupCache.set(hash, {legGroup, monName});
			} catch (e) {
				// Loading failed — cache a null entry so we don't spin re-loading.
				this._lairGroupCache.set(hash, {legGroup: null, monName});
			} finally {
				this._lairGroupPendingLoads.delete(hash);
			}
		})();
		this._lairGroupPendingLoads.set(hash, p);
		await p;
	}

	/**
	 * Manual-add entry point (used by the row context menu).
	 * @param {object} opts
	 * @param {object} opts.rowEntity Entity object of the creature row.
	 * @returns {Promise<boolean>} True on success (marker added).
	 */
	async pAddLairMarkerManualForRow ({rowEntity}) {
		if (!rowEntity?.name || !rowEntity?.source) return false;

		const mon = rowEntity.monster || await DmScreenUtil.pGetScaledCreature({
			name: rowEntity.name,
			source: rowEntity.source,
			scaledCr: rowEntity.scaledCr,
			scaledSummonSpellLevel: rowEntity.scaledSummonSpellLevel,
			scaledSummonClassLevel: rowEntity.scaledSummonClassLevel,
		});
		if (!mon?.legendaryGroup?.name || !mon?.legendaryGroup?.source) return false;

		await this._pEnsureLegendaryGroupLoaded({legendaryGroup: mon.legendaryGroup, monName: mon.name});
		const hash = InitiativeTrackerLairMarkers.getGroupHash(mon.legendaryGroup);
		const cached = this._lairGroupCache.get(hash);
		if (!InitiativeTrackerLairMarkers.hasTrackableContent(cached?.legGroup)) return false;

		// If a marker for this group already exists, no-op.
		if ((this._state.rows || []).some(r => r.entity?.isLairMarker && InitiativeTrackerLairMarkers.getGroupHash({name: r.entity.legendaryGroupName, source: r.entity.legendaryGroupSource}) === hash)) return false;

		// Allow re-add after a shift-delete.
		this._dismissedLairGroupHashes.delete(hash);

		const marker = this._rowStateBuilderActive.pGetNewLairMarkerRowState({
			legGroup: cached.legGroup,
			monName: mon.name,
			refRowIds: [],
			isManual: true,
		});
		this._state.rows = InitiativeTrackerSort.getSortedRows({
			rows: [...this._state.rows, marker],
			sortBy: this._state.sort,
			sortDir: this._state.dir,
		});
		return true;
	}

	/**
	 * Called by the row-render layer when the DM shift-deletes an auto marker.
	 * Suppresses re-creation of the marker for the rest of the session.
	 */
	dismissLairGroupForSession ({legendaryGroupName, legendaryGroupSource}) {
		const hash = InitiativeTrackerLairMarkers.getGroupHash({name: legendaryGroupName, source: legendaryGroupSource});
		if (hash) this._dismissedLairGroupHashes.add(hash);
	}

	/**
	 * @param {object} rowEntity
	 * @returns {Promise<{isEligible: boolean, isAlreadyTracked: boolean, monName: ?string, legendaryGroup: ?object}>}
	 */
	async pGetLairMarkerEligibilityForRow ({rowEntity}) {
		const out = {isEligible: false, isAlreadyTracked: false, monName: null, legendaryGroup: null};
		if (!rowEntity?.name || !rowEntity?.source) return out;

		const mon = rowEntity.monster || await DmScreenUtil.pGetScaledCreature({
			name: rowEntity.name,
			source: rowEntity.source,
			scaledCr: rowEntity.scaledCr,
			scaledSummonSpellLevel: rowEntity.scaledSummonSpellLevel,
			scaledSummonClassLevel: rowEntity.scaledSummonClassLevel,
		});
		if (!mon?.legendaryGroup?.name || !mon?.legendaryGroup?.source) return out;

		out.monName = mon.name;
		out.legendaryGroup = mon.legendaryGroup;

		await this._pEnsureLegendaryGroupLoaded({legendaryGroup: mon.legendaryGroup, monName: mon.name});
		const hash = InitiativeTrackerLairMarkers.getGroupHash(mon.legendaryGroup);
		if (!InitiativeTrackerLairMarkers.hasTrackableContent(this._lairGroupCache.get(hash)?.legGroup)) return out;

		out.isEligible = true;
		out.isAlreadyTracked = (this._state.rows || []).some(r => r.entity?.isLairMarker
			&& InitiativeTrackerLairMarkers.getGroupHash({name: r.entity.legendaryGroupName, source: r.entity.legendaryGroupSource}) === hash);
		return out;
	}

	// endregion

	/* -------------------------------------------- */

	static getPanelApp ({board, savedState}) {
		return new this({board, savedState});
	}

	getPanelElement () {
		return this.render();
	}
}
