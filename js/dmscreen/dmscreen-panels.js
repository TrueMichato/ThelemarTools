import {
	PANEL_TYP_ADVENTURE_DYNAMIC_MAP,
	PANEL_TYP_COUNTER,
	PANEL_TYP_CUSTOM_RANDOM_TABLE,
	PANEL_TYP_DICE_CALCULATOR,
	PANEL_TYP_INITIATIVE_TRACKER, PANEL_TYP_INITIATIVE_TRACKER_CREATURE_VIEWER,
	PANEL_TYP_INITIATIVE_TRACKER_PLAYER_V0,
	PANEL_TYP_INITIATIVE_TRACKER_PLAYER_V1, PANEL_TYP_ITEM_BUILDER, PANEL_TYP_JOURNEY_TRACKER, PANEL_TYP_MONEY_CONVERTER, PANEL_TYP_PARTY_TRACKER, PANEL_TYP_TEXTBOX, PANEL_TYP_TIME_TRACKER, PANEL_TYP_UNIT_CONVERTER,
} from "./dmscreen-consts.js";
import {PANEL_TYP_NPC_TRACKER} from "./dmscreen-consts.js";
import {InitiativeTracker} from "./initiativetracker/dmscreen-initiativetracker.js";
import {InitiativeTrackerPlayerV0, InitiativeTrackerPlayerV1} from "./dmscreen-playerinitiativetracker.js";
import {InitiativeTrackerCreatureViewer} from "./dmscreen-initiativetrackercreatureviewer.js";
import {Counter} from "./dmscreen-counter.js";
import {DiceCalculator} from "./dmscreen-dicecalculator.js";
import {NoteBox} from "./dmscreen-notebox.js";
import {UnitConverter} from "./dmscreen-unitconverter.js";
import {MoneyConverter} from "./dmscreen-moneyconverter.js";
import {TimeTracker} from "./dmscreen-timetracker.js";
import {DmMapper} from "./dmscreen-mapper.js";
import {PartyTracker} from "./partytracker/dmscreen-partytracker.js";
import {JourneyTracker} from "./dmscreen-journeytracker.js";
import {CustomRandomTable} from "./dmscreen-customrandomtable.js";
import {ItemBuilderPanel} from "./itembuilder/dmscreen-itembuilder.js";
import {NpcTracker} from "./npctracker/dmscreen-npctracker.js";

export class PanelContentManagerFactory {
	static _PANEL_TYPES = {};

	static registerPanelType ({panelType, Cls}) {
		this._PANEL_TYPES[panelType] = Cls;
	}

	/* -------------------------------------------- */

	static async pFromSavedState ({board, saved, ixTab, panel}) {
		if (!this._PANEL_TYPES[saved.t]) return undefined;

		const ContentManager = new this._PANEL_TYPES[saved.t]({board, panel});
		await ContentManager.pLoadState({ixTab, saved});

		return true;
	}

	/* -------------------------------------------- */

	static getSaveableContent (
		{
			type,
			toSaveTitle,
			panelApp,
		},
	) {
		if (!this._PANEL_TYPES[type]) return undefined;

		return this._PANEL_TYPES[type]
			.getSaveableContent({
				type,
				toSaveTitle,
				panelApp,
			});
	}
}

/* -------------------------------------------- */

class _PanelContentManager {
	static _PANEL_TYPE = null;
	static _TITLE = null;
	static _IS_STATELESS = false;

	static _register () {
		PanelContentManagerFactory.registerPanelType({panelType: this._PANEL_TYPE, Cls: this});
		return null;
	}

	static getSaveableContent (
		{
			type,
			toSaveTitle,
			panelApp,
		},
	) {
		return {
			t: type,
			r: toSaveTitle,
			s: this._IS_STATELESS
				? {}
				: panelApp.getState(),
		};
	}

	/* -------------------------------------------- */

	constructor (
		{
			board,
			panel,
		},
	) {
		this._board = board;
		this._panel = panel;
	}

	/* -------------------------------------------- */

	/**
	 * @abstract
	 * @return {*}
	 */
	_getPanelApp ({state}) {
		throw new Error("Unimplemented!");
	}

	async pDoPopulate ({state = {}, title = null} = {}) {
		const panelApp = this._getPanelApp({state});

		this._panel.setEleContentTab({
			panelType: this.constructor._PANEL_TYPE,
			contentMeta: state,
			panelApp,
			eleContent: ee`<div class="panel-content-wrapper-inner"></div>`.appends(panelApp.getPanelElement()),
			title: title || this.constructor._TITLE,
			tabCanRename: true,
		});

		this._board.fireBoardEvent({type: "panelPopulate", payload: {type: this.constructor._PANEL_TYPE}});
	}

	_doHandleTabRenamed ({ixTab, saved}) {
		if (saved.r != null) this._panel.tabDatas[ixTab].tabRenamed = true;
	}

	async pLoadState ({ixTab, saved}) {
		await this.pDoPopulate({state: saved.s, title: saved.r});
		this._doHandleTabRenamed({ixTab, saved});
	}
}

export class PanelContentManager_InitiativeTracker extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_INITIATIVE_TRACKER;
	static _TITLE = "Initiative Tracker";

	static _ = this._register();

	_getPanelApp ({state}) {
		return InitiativeTracker.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_InitiativeTrackerCreatureViewer extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_INITIATIVE_TRACKER_CREATURE_VIEWER;
	static _TITLE = "Creature Viewer";
	static _IS_STATELESS = true;

	static _ = this._register();

	_getPanelApp ({state}) {
		return InitiativeTrackerCreatureViewer.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_InitiativeTrackerPlayerViewV1 extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_INITIATIVE_TRACKER_PLAYER_V1;
	static _TITLE = "Initiative Tracker";
	static _IS_STATELESS = true;

	static _ = this._register();

	_getPanelApp ({state}) {
		return InitiativeTrackerPlayerV1.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_InitiativeTrackerPlayerViewV0 extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_INITIATIVE_TRACKER_PLAYER_V0;
	static _TITLE = "Initiative Tracker";
	static _IS_STATELESS = true;

	static _ = this._register();

	_getPanelApp ({state}) {
		return InitiativeTrackerPlayerV0.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_Counter extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_COUNTER;
	static _TITLE = "Counter";

	static _ = this._register();

	_getPanelApp ({state}) {
		return Counter.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_DiceCalculator extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_DICE_CALCULATOR;
	static _TITLE = "Dice Calculator";

	static _ = this._register();

	_getPanelApp ({state}) {
		return DiceCalculator.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_CustomRandomTable extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_CUSTOM_RANDOM_TABLE;
	static _TITLE = "Random Table";

	static _ = this._register();

	_getPanelApp ({state}) {
		return CustomRandomTable.getPanelApp({board: this._board, savedState: state});
	}

	// Override the base `pDoPopulate` so we can:
	//  - Pass `tabCanRename: false` — the in-panel title input is the single source of
	//    truth for this panel's tab title, so we suppress the double-click-rename affordance
	//    to avoid a two-way divergence.
	//  - Wire the panel-app's title state to `panel.setTabTitle(...)` so editing the
	//    in-panel title renames the tab in real time.
	async pDoPopulate ({state = {}, title = null} = {}) {
		const panelApp = this._getPanelApp({state});

		const tabIx = this._panel.setEleContentTab({
			panelType: this.constructor._PANEL_TYPE,
			contentMeta: state,
			panelApp,
			eleContent: ee`<div class="panel-content-wrapper-inner"></div>`.appends(panelApp.getPanelElement()),
			title: title || this.constructor._TITLE,
			tabCanRename: false,
		});

		const panel = this._panel;
		const DEFAULT = this.constructor._TITLE;
		panelApp.setTitleChangeCallback?.(newTitle => {
			const clean = (newTitle || "").trim();
			panel.setTabTitle(tabIx, clean || DEFAULT);
		});

		this._board.fireBoardEvent({type: "panelPopulate", payload: {type: this.constructor._PANEL_TYPE}});
	}
}

export class PanelContentManager_NoteBox extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_TEXTBOX;
	static _TITLE = "Notes";

	static _ = this._register();

	_getPanelApp ({state}) {
		return NoteBox.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_UnitConverter extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_UNIT_CONVERTER;
	static _TITLE = "Unit Converter";

	static _ = this._register();

	_getPanelApp ({state}) {
		return UnitConverter.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_MoneyConverter extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_MONEY_CONVERTER;
	static _TITLE = "Coin Converter";

	static _ = this._register();

	_getPanelApp ({state}) {
		return MoneyConverter.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_TimeTracker extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_TIME_TRACKER;
	static _TITLE = "Time Tracker";

	static _ = this._register();

	_getPanelApp ({state}) {
		return TimeTracker.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_DynamicMap extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_ADVENTURE_DYNAMIC_MAP;
	static _TITLE = "Map Viewer";

	static _ = this._register();

	_getPanelApp ({state}) {
		return DmMapper.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_PartyTracker extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_PARTY_TRACKER;
	static _TITLE = "Party Tracker";

	static _ = this._register();

	_getPanelApp ({state}) {
		return PartyTracker.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_JourneyTracker extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_JOURNEY_TRACKER;
	static _TITLE = "Journey Tracker";

	static _ = this._register();

	_getPanelApp ({state}) {
		return JourneyTracker.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_ItemBuilder extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_ITEM_BUILDER;
	static _TITLE = "Item Builder";

	static _ = this._register();

	_getPanelApp ({state}) {
		return ItemBuilderPanel.getPanelApp({board: this._board, savedState: state});
	}
}

export class PanelContentManager_NpcTracker extends _PanelContentManager {
	static _PANEL_TYPE = PANEL_TYP_NPC_TRACKER;
	static _TITLE = "NPC Tracker";

	static _ = this._register();

	_getPanelApp ({state}) {
		return NpcTracker.getPanelApp({board: this._board, savedState: state});
	}
}
