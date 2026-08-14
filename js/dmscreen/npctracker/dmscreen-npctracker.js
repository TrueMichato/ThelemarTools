import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {NpcTrackerSerializer, removeNpcTrackerGroup} from "./dmscreen-npctracker-serial.js";
import {NpcTrackerRoster, getNpcTrackerImportedMonsters} from "./dmscreen-npctracker-roster.js";
import {NpcTrackerDetail} from "./dmscreen-npctracker-detail.js";
import {NpcTrackerBatch} from "./dmscreen-npctracker-batch.js";
import {
	getNpcTrackerDisplayName,
	getNpcTrackerNpcsForScope,
	getNpcTrackerRollBonus,
	getNpcTrackerRollLabel,
	pRollNpcTrackerD20,
} from "./dmscreen-npctracker-roll.js";
import {
	getNpcTrackerHpAfterOperation,
	getNpcTrackerHpInputValue,
	getNpcTrackerHpOperation,
} from "./dmscreen-npctracker-hp.js";
import {getNpcTrackerConditionsAfterUpdate} from "./dmscreen-npctracker-condition.js";

export class NpcTracker extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-npc__root dm__panel-bg dm__data-anchor"></div>`;
		this._comp = new NpcTrackerRoot({board, savedState: state});
		this._comp.render(wrpPanel);
		return wrpPanel;
	}

	getState () {
		return this._comp?.getSaveableState() || NpcTrackerSerializer.serialize(NpcTrackerSerializer.getDefaultState());
	}
}

export class NpcTrackerRoot {
	constructor ({board, savedState}) {
		this._board = board;
		this._state = NpcTrackerSerializer.deserialize(savedState);
		this._isFullStatblock = false;
		this._view = this._state.settings.selectedId ? "detail" : "roster";
		this._workspaceMode = "detail";
		this._batchState = null;
		this._hpUndoStack = [];
		this._wrpRoot = null;
		this._wrpRoster = null;
		this._wrpDetail = null;

		this._roster = new NpcTrackerRoster({
			fnGetState: () => this._state,
			fnSelect: id => this._selectNpc(id),
			fnAdd: () => this._pAddNpc(),
			fnImport: file => this._pImport(file),
			fnUpdateNpc: meta => this._updateNpc(meta),
			fnRemove: id => this._removeNpc(id),
			fnToggleIncludeAll: value => this._toggleIncludeAll(value),
			fnAddGroup: () => this._pAddGroup(),
			fnRenameGroup: id => this._pRenameGroup(id),
			fnRemoveGroup: id => this._removeGroup(id),
			fnToggleGroup: id => this._toggleGroup(id),
			fnToggleUnsorted: () => this._toggleUnsorted(),
			fnAssignGroup: meta => this._assignGroup(meta),
			fnOpenBatch: scope => this._openBatch(scope),
		});
		this._detail = new NpcTrackerDetail({
			fnGetNpc: () => this._getSelectedNpc(),
			fnSetViewMode: isFull => {
				this._isFullStatblock = isFull;
				this._renderDetail();
			},
			fnUpdateHp: ({npc, prop, value}) => this._updateNpc({npc, prop: `hp.${prop}`, value}),
		});
		this._batch = new NpcTrackerBatch({
			fnGetContext: () => ({
				batch: this._batchState,
				npcs: this._batchState ? getNpcTrackerNpcsForScope({state: this._state, scope: this._batchState.scope}) : [],
				hasHpUndo: !!this._hpUndoStack.length,
			}),
			fnUpdateConfig: config => this._updateBatchConfig(config),
			fnRoll: () => this._pRollBatch(),
			fnSort: key => this._sortBatch(key),
			fnToggleNpc: id => this._toggleBatchNpc(id),
			fnToggleAll: isSelected => this._toggleBatchAll(isSelected),
			fnApplyHp: meta => this._applyBatchHp(meta),
			fnUndoHp: () => this._undoBatchHp(),
			fnUpdateCondition: meta => this._updateBatchCondition(meta),
		});
	}

	getSaveableState () {
		return NpcTrackerSerializer.serialize(this._state);
	}

	render (wrp) {
		wrp.empty();
		this._wrpRoot = ee`<div class="dm-npc__layout" data-view="${this._view}"></div>`;
		this._wrpRoster = ee`<aside class="dm-npc__roster" aria-label="NPC roster"></aside>`;
		this._wrpDetail = ee`<main class="dm-npc__workspace"></main>`;
		this._wrpRoster.appendTo(this._wrpRoot);
		this._wrpDetail.appendTo(this._wrpRoot);
		this._wrpRoot.appendTo(wrp);
		this._renderRoster();
		this._renderDetail();
	}

	_renderRoster () {
		this._roster.render(this._wrpRoster);
	}

	_renderDetail () {
		const opts = {
			wrp: this._wrpDetail,
			isNarrow: true,
			fnShowRoster: () => this._setView("roster"),
		};
		if (this._workspaceMode === "batch") this._batch.render(opts);
		else this._detail.render({...opts, isFullStatblock: this._isFullStatblock});
	}

	async _pAddNpc () {
		let chosen;
		try {
			chosen = await this._roster.pChooseCreature({
				isIncludeAllCreatures: this._state.settings.isIncludeAllCreatures,
			});
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not open NPC search: ${e.message}`});
			throw e;
		}
		if (!chosen) return;

		const monster = await DataLoader.pCacheAndGet(chosen.page, chosen.source, chosen.hash);
		if (!monster) {
			JqueryUtil.doToast({type: "danger", content: `Could not load "${chosen.n}".`});
			return;
		}

		let fluff = null;
		try {
			fluff = await Renderer.monster.pGetFluff(monster);
		} catch (e) {
			JqueryUtil.doToast({type: "warning", content: `Added "${monster.name}", but its lore could not be loaded.`});
		}

		const npc = NpcTrackerSerializer.createNpc({monster, fluff});
		this._state.npcs.push(npc);
		this._state.settings.selectedId = npc.id;
		this._workspaceMode = "detail";
		this._isFullStatblock = false;
		this._setView("detail");
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	async _pImport (file) {
		let monsters;
		try {
			monsters = getNpcTrackerImportedMonsters(await file.text());
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Import failed: ${e.message}`});
			return;
		}

		const added = monsters.map(monster => NpcTrackerSerializer.createNpc({
			monster: MiscUtil.copyFast(monster),
			fluff: monster.fluff || null,
		}));
		this._state.npcs.push(...added);
		this._state.settings.selectedId = added[0].id;
		this._workspaceMode = "detail";
		this._isFullStatblock = false;
		this._setView("detail");
		this._renderRoster();
		this._renderDetail();
		this._doSave();
		JqueryUtil.doToast({type: "success", content: `Imported ${added.length} ${added.length === 1 ? "NPC" : "NPCs"}.`});
	}

	_selectNpc (id) {
		if (!this._state.npcs.some(npc => npc.id === id)) return;
		this._state.settings.selectedId = id;
		this._workspaceMode = "detail";
		this._isFullStatblock = false;
		this._setView("detail");
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_updateNpc ({npc, prop, value}) {
		if (!this._state.npcs.includes(npc)) return;
		if (prop === "alias") npc.alias = `${value}`.trim();
		else if (prop.startsWith("hp.")) {
			const hpProp = prop.slice(3);
			if (!["current", "max", "temp"].includes(hpProp)) return;
			const num = getNpcTrackerHpInputValue(value);
			if (num == null) {
				JqueryUtil.doToast({type: "warning", content: "Hit points must be a number."});
				this._renderRoster();
				this._renderDetail();
				return;
			}
			npc.hp[hpProp] = num;
		}
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_removeNpc (id) {
		const ix = this._state.npcs.findIndex(npc => npc.id === id);
		if (!~ix) return;
		this._state.npcs.splice(ix, 1);
		if (this._state.settings.selectedId === id) {
			this._state.settings.selectedId = this._state.npcs[ix]?.id || this._state.npcs[ix - 1]?.id || null;
		}
		this._isFullStatblock = false;
		if (!this._state.settings.selectedId) this._setView("roster");
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_toggleIncludeAll (value) {
		this._state.settings.isIncludeAllCreatures = !!value;
		this._doSave();
	}

	async _pAddGroup () {
		const name = await InputUiUtil.pGetUserString({title: "New NPC Group", isSkippable: true});
		if (name == null) return;
		const cleanName = name.trim();
		if (!cleanName) {
			JqueryUtil.doToast({type: "warning", content: "Group name cannot be empty."});
			return;
		}
		if (this._state.groups.some(group => group.name.toLowerCase() === cleanName.toLowerCase())) {
			JqueryUtil.doToast({type: "warning", content: `A group named "${cleanName}" already exists.`});
			return;
		}
		this._state.groups.push({id: CryptUtil.uid(), name: cleanName, isCollapsed: false});
		this._renderRoster();
		this._doSave();
	}

	async _pRenameGroup (groupId) {
		const group = this._state.groups.find(it => it.id === groupId);
		if (!group) return;
		const name = await InputUiUtil.pGetUserString({title: "Rename NPC Group", default: group.name, isSkippable: true});
		if (name == null) return;
		const cleanName = name.trim();
		if (!cleanName) {
			JqueryUtil.doToast({type: "warning", content: "Group name cannot be empty."});
			return;
		}
		if (this._state.groups.some(it => it.id !== groupId && it.name.toLowerCase() === cleanName.toLowerCase())) {
			JqueryUtil.doToast({type: "warning", content: `A group named "${cleanName}" already exists.`});
			return;
		}
		group.name = cleanName;
		if (this._batchState?.scope.groupId === groupId) this._batchState.scopeName = cleanName;
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_removeGroup (groupId) {
		const group = this._state.groups.find(it => it.id === groupId);
		if (this._batchState?.isRolling && this._batchState.scope.groupId === groupId) {
			JqueryUtil.doToast({type: "warning", content: "Wait for the active batch roll to finish before deleting this group."});
			return;
		}
		if (!group || !confirm(`Delete group "${group.name}"? Its NPCs will move to Unsorted.`)) return;
		removeNpcTrackerGroup({state: this._state, groupId});
		if (this._batchState?.scope.groupId === groupId) {
			this._workspaceMode = "detail";
			this._batchState = null;
		}
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_toggleGroup (groupId) {
		const group = this._state.groups.find(it => it.id === groupId);
		if (!group) return;
		group.isCollapsed = !group.isCollapsed;
		this._renderRoster();
		this._doSave();
	}

	_toggleUnsorted () {
		this._state.settings.isUnsortedCollapsed = !this._state.settings.isUnsortedCollapsed;
		this._renderRoster();
		this._doSave();
	}

	_assignGroup ({npc, groupId}) {
		if (!this._state.npcs.includes(npc)) return;
		npc.groupId = this._state.groups.some(group => group.id === groupId) ? groupId : null;
		this._renderRoster();
		if (this._workspaceMode === "batch") this._renderDetail();
		this._doSave();
	}

	_openBatch (scope) {
		if (this._batchState?.isRolling) {
			JqueryUtil.doToast({type: "warning", content: "Wait for the active batch roll to finish before starting another."});
			return;
		}
		const group = scope.type === "group"
			? this._state.groups.find(it => it.id === scope.groupId)
			: null;
		if (scope.type === "group" && !group) return;
		this._batchState = {
			scope,
			scopeName: scope.type === "all" ? "All NPCs" : scope.type === "unsorted" ? "Unsorted" : group.name,
			rollType: "initiative",
			key: null,
			results: [],
			sortKey: "total",
			sortDirection: "desc",
			isRolling: false,
			error: null,
			operationMessage: null,
			selectedNpcIds: new Set(getNpcTrackerNpcsForScope({state: this._state, scope}).map(npc => npc.id)),
		};
		this._workspaceMode = "batch";
		this._setView("detail");
		this._renderDetail();
	}

	_updateBatchConfig ({rollType, key}) {
		if (!this._batchState || this._batchState.isRolling) return;
		if (rollType != null) this._batchState.rollType = rollType;
		if (key !== undefined) this._batchState.key = key;
		this._batchState.results = [];
		this._batchState.error = null;
		this._batchState.sortKey = this._batchState.rollType === "initiative" ? "total" : "order";
		this._batchState.sortDirection = this._batchState.rollType === "initiative" ? "desc" : "asc";
		this._renderDetail();
	}

	async _pRollBatch () {
		if (!this._batchState || this._batchState.isRolling) return;
		const batch = this._batchState;
		const npcs = getNpcTrackerNpcsForScope({state: this._state, scope: batch.scope})
			.filter(npc => batch.selectedNpcIds.has(npc.id));
		if (!npcs.length) return;

		batch.isRolling = true;
		batch.error = null;
		batch.results = [];
		this._renderDetail();

		const results = [];
		let failures = 0;
		for (let order = 0; order < npcs.length; ++order) {
			const npc = npcs[order];
			try {
				const bonus = getNpcTrackerRollBonus({
					npc,
					rollType: batch.rollType,
					key: batch.key,
				});
				const label = getNpcTrackerRollLabel({
					rollType: batch.rollType,
					key: batch.key,
				});
				const rolled = await pRollNpcTrackerD20({npc, label, bonus});
				if (!rolled) {
					failures++;
					continue;
				}
				results.push({
					npcId: npc.id,
					name: getNpcTrackerDisplayName(npc),
					bonus,
					die: rolled.die,
					total: rolled.total,
					order,
				});
			} catch {
				failures++;
			}
		}

		if (this._batchState !== batch) return;
		batch.results = results;
		batch.isRolling = false;
		batch.error = failures
			? `${failures} ${failures === 1 ? "roll was" : "rolls were"} cancelled or could not be completed.`
			: null;
		this._renderDetail();
	}

	_toggleBatchNpc (npcId) {
		if (!this._batchState || this._batchState.isRolling) return;
		if (this._batchState.selectedNpcIds.has(npcId)) this._batchState.selectedNpcIds.delete(npcId);
		else this._batchState.selectedNpcIds.add(npcId);
		this._clearBatchResults();
		this._renderDetail();
	}

	_toggleBatchAll (isSelected) {
		if (!this._batchState || this._batchState.isRolling) return;
		const npcs = getNpcTrackerNpcsForScope({state: this._state, scope: this._batchState.scope});
		this._batchState.selectedNpcIds = new Set(isSelected ? npcs.map(npc => npc.id) : []);
		this._clearBatchResults();
		this._renderDetail();
	}

	_applyBatchHp ({raw, isHalf}) {
		if (!this._batchState || this._batchState.isRolling) return;
		const parsed = getNpcTrackerHpOperation({raw, isHalf});
		if (!parsed.ok) {
			this._batchState.error = parsed.message;
			this._renderDetail();
			return;
		}

		const npcs = getNpcTrackerNpcsForScope({state: this._state, scope: this._batchState.scope})
			.filter(npc => this._batchState.selectedNpcIds.has(npc.id));
		if (!npcs.length) {
			this._batchState.error = "Select at least one NPC.";
			this._renderDetail();
			return;
		}

		const snapshots = npcs.map(npc => ({npcId: npc.id, hp: {...npc.hp}}));
		npcs.forEach(npc => npc.hp = getNpcTrackerHpAfterOperation({hp: npc.hp, operation: parsed.operation}));
		this._hpUndoStack.push({snapshots});
		while (this._hpUndoStack.length > 5) this._hpUndoStack.shift();

		this._batchState.error = null;
		this._batchState.operationMessage = `Updated HP for ${npcs.length} ${npcs.length === 1 ? "NPC" : "NPCs"}.`;
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_undoBatchHp () {
		if (!this._batchState || this._batchState.isRolling) return;
		const entry = this._hpUndoStack.pop();
		if (!entry) return;

		let restored = 0;
		entry.snapshots.forEach(snapshot => {
			const npc = this._state.npcs.find(it => it.id === snapshot.npcId);
			if (!npc) return;
			npc.hp = {...snapshot.hp};
			restored++;
		});
		this._batchState.error = null;
		this._batchState.operationMessage = `Restored HP for ${restored} ${restored === 1 ? "NPC" : "NPCs"}.`;
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_updateBatchCondition ({condition, isAdd}) {
		if (!this._batchState || this._batchState.isRolling) return;
		const npcs = getNpcTrackerNpcsForScope({state: this._state, scope: this._batchState.scope})
			.filter(npc => this._batchState.selectedNpcIds.has(npc.id));
		if (!npcs.length) {
			this._batchState.error = "Select at least one NPC.";
			this._renderDetail();
			return;
		}

		npcs.forEach(npc => {
			npc.conditions = getNpcTrackerConditionsAfterUpdate({conditions: npc.conditions, condition, isAdd});
		});
		this._batchState.error = null;
		this._batchState.operationMessage = `${isAdd ? "Added" : "Removed"} ${condition.toTitleCase()} ${isAdd ? "to" : "from"} ${npcs.length} ${npcs.length === 1 ? "NPC" : "NPCs"}.`;
		this._renderRoster();
		this._renderDetail();
		this._doSave();
	}

	_clearBatchResults () {
		this._batchState.results = [];
		this._batchState.error = null;
		this._batchState.operationMessage = null;
	}

	_sortBatch (key) {
		if (!this._batchState) return;
		if (this._batchState.sortKey === key) {
			this._batchState.sortDirection = this._batchState.sortDirection === "asc" ? "desc" : "asc";
		} else {
			this._batchState.sortKey = key;
			this._batchState.sortDirection = key === "total" ? "desc" : "asc";
		}
		this._renderDetail();
	}

	_setView (view) {
		this._view = view;
		this._wrpRoot?.attr("data-view", view);
	}

	_getSelectedNpc () {
		return this._state.npcs.find(npc => npc.id === this._state.settings.selectedId) || null;
	}

	_doSave () {
		this._board.doSaveStateDebounced();
	}
}
