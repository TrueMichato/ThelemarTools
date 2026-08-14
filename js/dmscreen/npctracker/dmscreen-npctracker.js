import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {NpcTrackerSerializer} from "./dmscreen-npctracker-serial.js";
import {NpcTrackerRoster, getNpcTrackerImportedMonsters} from "./dmscreen-npctracker-roster.js";
import {NpcTrackerDetail} from "./dmscreen-npctracker-detail.js";

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
		});
		this._detail = new NpcTrackerDetail({
			fnGetNpc: () => this._getSelectedNpc(),
			fnSetViewMode: isFull => {
				this._isFullStatblock = isFull;
				this._renderDetail();
			},
			fnUpdateHp: ({npc, prop, value}) => this._updateNpc({npc, prop: `hp.${prop}`, value}),
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
		this._detail.render({
			wrp: this._wrpDetail,
			isFullStatblock: this._isFullStatblock,
			isNarrow: true,
			fnShowRoster: () => this._setView("roster"),
		});
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
			const num = Number(value);
			if (!Number.isFinite(num)) {
				JqueryUtil.doToast({type: "warning", content: "Hit points must be a number."});
				this._renderRoster();
				this._renderDetail();
				return;
			}
			npc.hp[hpProp] = Math.max(0, num);
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
