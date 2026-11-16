/**
 * Lantern Cockpit: the redesigned Encounter Workspace (reach it with `?ew=2`).
 *
 * One engine (`createEncounterEngine`) owns the encounter; every change is `pCommit(label, recipe)` and is undoable.
 * What the DM is looking at — the viewed creature, the selection, the open dock tab — is cockpit UI state and never
 * enters the undo history. The rail, stage and dock are redrawn from the engine state on every change.
 *
 * Later phases plug in through the API returned by `getApi()` (also on `globalThis.ewCockpit`): derived numbers,
 * effect items, dock tabs, statblock decorators, roll and damage hooks.
 */

import {
	EncounterCockpitSettingsStore,
	EncounterWorkspaceSettingsStore,
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	ENCOUNTER_RULESETS,
	getEncounterEffectiveMonster,
	getEncounterInitiativeTotal,
	getEncounterSharedGroup,
	getEncounterViewGroups,
} from "../encounterworkspace-state.js";
import {createEncounterEngine} from "../encounterworkspace-engine.js";
import {getEncounterGroupsV8} from "../encounterworkspace-groups-v8.js";
import {
	endEncounterConcentration,
	getEncounterConcentration,
	getEncounterConcentrationDc,
	startEncounterConcentration,
} from "../encounterworkspace-fx.js";
import {
	applyEncounterCondition,
	ENCOUNTER_EXHAUSTION_DEATH_LEVEL,
	getEncounterConditionRule,
	removeEncounterCondition,
	setEncounterExhaustion,
} from "../encounterworkspace-conditions-rules.js";
import {applyEncounterDeathSaveDamage, applyEncounterHealing} from "../encounterworkspace-deathsaves.js";
import {
	getCockpitEffectItems,
	getCockpitExtraDefensesGetter,
	getCockpitShellDerived,
	withCockpitTurnAdvanced,
} from "./rules.js";
import {pRollEncounterInstance} from "../encounterworkspace-roll.js";
import {getEncounterXpSummary} from "../encounterworkspace-assessment.js";
import {EncounterWorkspaceHandoffStore, getEncounterHandoffSnapshot} from "../encounterworkspace-handoff.js";
import {BESTIARY_ENCOUNTER_HANDOFF_PARAM, takeBestiaryEncounterHandoff} from "../encounterworkspace-bestiary-handoff.js";
import {getNpcTrackerFallbackReferenceData, pGetNpcTrackerReferenceData} from "../../dmscreen/npctracker/dmscreen-npctracker-data.js";
import {getNpcTrackerConditionColor} from "../../dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {h, kbd} from "./dom.js";
import {EncounterCockpitHover} from "./hover.js";
import {EncounterCockpitRail} from "./rail.js";
import {EncounterCockpitStatblock} from "./statblock.js";
import {EncounterCockpitDock} from "./dock.js";
import {
	getCockpitAriaShortcut,
	COCKPIT_KEY_BINDINGS,
	getCockpitIsMac,
	getCockpitKeyLabels,
	getCockpitShortcutSheet,
	installCockpitKeymap,
} from "./keymap.js";
import {installCockpitActFeatures} from "./features/act.js";
import {installCockpitPrepFeatures} from "./features/prep.js";
import {installCockpitFlowFeatures} from "./features/flow.js";
import {installCockpitStageAffordances} from "./features/stage-affordances.js";
import {withCockpitRevived} from "./stage-model.js";
import {installCockpitTopbarFeatures} from "./features/topbar.js";
import {
	COCKPIT_ROLL_MODES,
	getCockpitFoeIds,
	getCockpitRerollToast,
	getCockpitTurnRecharges,
	withCockpitRechargeRolls,
} from "./topbar-model.js";
import {
	COCKPIT_TALLY_BUCKETS,
	getCockpitDamageSummary,
	getCockpitDockTargetIds,
	getCockpitExhaustionLevel,
	getCockpitGroupChips,
	getCockpitInstanceLabels,
	getCockpitPlural,
	getCockpitPrevTurn,
	getCockpitRailOrder,
	getCockpitSelectionAfterClick,
	getCockpitSelectionAfterGroupToggle,
	getCockpitStepId,
} from "./model.js";

const TOAST_MS = 7000;
const RULESET_LABELS = {phb: "PHB 2014", xphb: "PHB 2024", tgtt: "Thelemar"};
const QUICK_ACTIONS = [
	{id: "damage", label: "Dmg", title: "Damage this creature"},
	{id: "heal", label: "Heal", title: "Heal this creature"},
	{id: "save", label: "Save", title: "Roll a saving throw for this creature"},
	{id: "cond", label: "Cond", title: "Conditions on this creature"},
	{id: "fx", label: "Fx", title: "Add an effect to this creature"},
];
/** Quick action → dock tab. The Roll tab opens on a saving throw by default. */
const QUICK_ACTION_TABS = {damage: "hp", heal: "hp", save: "roll", cond: "cond", fx: "fx"};
const RESOURCE_REDUCERS = {
	slots: "withSpellSlots",
	removeSlots: "withoutSpellSlots",
	ability: "withAbility",
	removeAbility: "withoutAbility",
	abilityUse: "withAbilityUse",
	recharge: "withRechargeReady",
	concentration: "withConcentration",
};
const SVG_UNDO = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 2 7l4 4M2.5 7H10a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_REDO = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3 4 4-4 4M13.5 7H6a4 4 0 0 0 0 8h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_MORE = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>`;

const getErrorMessage = e => String(e?.message || e).replace(/[.!?]+$/, "");
const rethrowLater = e => setTimeout(() => { throw e; });

export class EncounterCockpit {
	constructor ({
		root,
		store = new EncounterWorkspaceStore(),
		settingsStore = new EncounterCockpitSettingsStore(),
		handoffStore = new EncounterWorkspaceHandoffStore(),
		pGetReferenceData = pGetNpcTrackerReferenceData,
		workspaceSettingsStore = new EncounterWorkspaceSettingsStore(),
	}) {
		this._root = root;
		this._store = store;
		this._settingsStore = settingsStore;
		this._wsSettingsStore = workspaceSettingsStore;
		/** Page-wide settings shared with the classic workspace (auto-roll recharge). */
		this._wsSettings = {autoRollRecharge: false};
		this._handoffStore = handoffStore;
		this._pGetReferenceData = pGetReferenceData;
		this._isMac = getCockpitIsMac();

		this._engine = null;
		this._settings = EncounterCockpitSettingsStore.getDefaults();
		this._reference = getNpcTrackerFallbackReferenceData();
		this._isCatalogReady = false;
		this._hasUnreadableSave = false;
		this._ui = {viewedId: null, selectedIds: [], anchorId: null};
		this._effectiveCache = new WeakMap();

		// Injection points (see getApi).
		this._providers = {
			getDerived: (instance, state) => this._getCachedShellDerived(state, instance),
			effectItems: (state, instance) => getCockpitEffectItems(state, instance),
			difficulty: null,
		};
		this._hooks = {damageApplied: new Set(), turnChanged: new Set(), rolled: new Set(), render: new Set(), showHint: new Set(), openPrep: new Set()};
		/** Feature extension points (P3): render callbacks, persistent regions, stage modes, extra keys. */
		this._ext = {barItems: [], railTop: [], railHead: [], railFoot: [], rowDecorators: [], stageModes: [], keys: [], menuItems: []};
		this._stageMode = "statblock";
		this._rollHandler = null;
	}

	/* -------------------------------------------- Boot -------------------------------------------- */

	async pInit () {
		this._buildShell();
		const errors = [];

		try {
			this._settings = await this._settingsStore.pLoad();
		} catch (e) {
			errors.push(`Cockpit settings could not be loaded (${getErrorMessage(e)}); defaults are in use.`);
		}
		try {
			this._wsSettings = {...this._wsSettings, ...await this._wsSettingsStore.pLoad()};
		} catch (e) {
			errors.push(`Workspace settings could not be loaded (${getErrorMessage(e)}); recharge rolls stay manual.`);
		}
		try {
			await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
			await ExcludeUtil.pInitialise();
			this._isCatalogReady = true;
		} catch (e) {
			errors.push(`Bestiary sources could not be initialised (${getErrorMessage(e)}); choosing another list is disabled.`);
		}
		if (this._isCatalogReady) {
			try {
				this._reference = await this._pGetReferenceData();
			} catch (e) {
				errors.push(`Condition reference data could not be loaded (${getErrorMessage(e)}); standard conditions remain available.`);
			}
		}

		let state;
		try {
			state = await this._store.pLoad();
		} catch (e) {
			this._hasUnreadableSave = true;
			state = EncounterWorkspaceState.getEmpty();
			errors.push(`The saved encounter could not be opened (${getErrorMessage(e)}). It has not been changed; choose a saved list to replace it.`);
		}

		this._engine = createEncounterEngine({state, pSave: next => this._store.pSave(next)});
		this._engine.subscribe((next, meta) => this._onEngineChange(meta));
		this._mountParts();
		this._installFeatures();
		this._ui.viewedId = this._getActiveInstanceId(state) ?? this._getOrderIds(state)[0] ?? null;
		this._render();

		this._root.setAttribute("aria-busy", "false");
		errors.forEach(msg => this.toast(msg, {kind: "error"}));
		await this._pOpenBestiaryHandoff();
	}

	_buildShell () {
		this._root.replaceChildren(
			h("header.ewc-bar", {"aria-label": "Encounter"}),
			h("aside.ewc-rail", {"aria-label": "Combatants"}),
			h("section.ewc-stage", {"aria-label": "Viewed creature"},
				h("div.ewc-stage__top"),
				h("div.ewc-stage__head", null, h("p.ewc-loading", {role: "status"}, "Loading the encounter…")),
				h("div.ewc-stage__scroll", {tabindex: "-1"}, h("div.ewc-stage__body")),
				h("div.ewc-stage__alt", {hidden: true}),
				h("div.ewc-stage__bottom"),
			),
			h("aside.ewc-dock", {"aria-label": "Act on the target"}, h("div.ewc-dock__top"), h("div.ewc-dock__main")),
			h("div.ewc-layer"),
			h("div.ewc-toasts", {"aria-live": "polite"}),
		);
		const get = sel => this._root.querySelector(sel);
		this._ele = {
			bar: get(".ewc-bar"),
			rail: get(".ewc-rail"),
			stageHead: get(".ewc-stage__head"),
			stageBody: get(".ewc-stage__body"),
			stageScroll: get(".ewc-stage__scroll"),
			stageTop: get(".ewc-stage__top"),
			stageAlt: get(".ewc-stage__alt"),
			stageBottom: get(".ewc-stage__bottom"),
			layer: get(".ewc-layer"),
			dock: get(".ewc-dock__main"),
			dockTop: get(".ewc-dock__top"),
			toasts: get(".ewc-toasts"),
		};
		document.body.classList.add("ewc-page");
		this._syncTopOffset();
		window.addEventListener("resize", () => this._syncTopOffset());
		// The site nav fills in after the cockpit mounts and may wrap the compact header onto two rows.
		const siteHeader = document.querySelector("[data-cancer-id=\"cancer-header\"]");
		if (siteHeader && typeof ResizeObserver === "function") new ResizeObserver(() => this._syncTopOffset()).observe(siteHeader);
	}

	/** The cockpit fills the viewport below the site navigation; the page never scrolls, the panes do. */
	_syncTopOffset () {
		const top = Math.max(0, Math.round(this._root.getBoundingClientRect().top + window.scrollY));
		this._root.style.setProperty("--ewc-top", `${top}px`);
	}

	/** Each P3 feature module gets the public API; one failing module must not take the cockpit down. */
	_installFeatures () {
		const api = this.getApi();
		[installCockpitActFeatures, installCockpitPrepFeatures, installCockpitFlowFeatures, installCockpitStageAffordances, installCockpitTopbarFeatures].forEach(install => {
			try {
				install(api);
			} catch (e) {
				rethrowLater(e);
				this.toast(`A cockpit feature failed to load (${getErrorMessage(e)}).`, {kind: "error"});
			}
		});
	}

	_mountParts () {
		this._hover = new EncounterCockpitHover();
		this._rail = new EncounterCockpitRail({
			root: this._ele.rail,
			hover: this._hover,
			isMac: this._isMac,
			callbacks: {
				onView: id => this._view(id),
				onSelect: (id, mode) => this._select(id, mode),
				onSelectIds: ids => this._setSelection(ids),
				onGroupToggle: memberIds => this._toggleGroup(memberIds),
				onClearSelection: () => this._clearSelection(),
				onSetInitiative: (id, total) => this._pSetInitiative(id, total),
				onRollInitiative: ids => this._pRollInitiative(ids),
				onQuickAction: (id, actionId) => this._quickAction(id, actionId),
				onEndEffect: null,
				group: null,
			},
		});
		this._statblock = new EncounterCockpitStatblock({
			head: this._ele.stageHead,
			body: this._ele.stageBody,
			hover: this._hover,
			callbacks: {
				onRoll: args => this._pRoll(args),
				onResourceAction: (id, action) => this._pResourceAction(id, action),
				onError: msg => this.toast(msg, {kind: "error"}),
				onViewActive: () => this._viewActive(),
				onToggleSelect: id => this._select(id, "toggle"),
				onRevive: id => this._pRevive(id),
				onDropConcentration: id => this._pDropConcentration(id),
			},
		});
		this._dock = new EncounterCockpitDock({
			root: this._ele.dock,
			hover: this._hover,
			callbacks: {
				pDamage: args => this._pDamage(args),
				pHp: args => this._pHp(args),
				pCondition: args => this._pCondition(args),
				pExhaustion: args => this._pExhaustion(args),
				onClearSelection: () => this._clearSelection(),
				onError: msg => this.toast(msg, {kind: "error"}),
			},
		});
		this._uninstallKeymap = installCockpitKeymap({
			root: this._root,
			isMac: this._isMac,
			isEnabled: () => !this._root.hidden && !document.body.classList.contains("ve-ui-modal__body-active") && !this._dlgHelp?.open,
			handlers: this._keyHandlers = this._getKeyHandlers(),
			getBindings: () => this._getKeyBindings(),
		});
	}

	/* -------------------------------------------- Public API (P3 injection points) -------------------------------------------- */

	getApi () {
		return {
			engine: this._engine,
			getState: () => this._engine.getState(),
			getUi: () => ({...this._ui, selectedIds: [...this._ui.selectedIds], tab: this._dock.tab}),
			getTargetIds: () => this._getTargets(this._engine.getState()).ids,
			/** fn(instance, state) → {ac, acText, speedText, notes, saves} overlays on the rail and statblock. */
			setDerivedProvider: fn => { this._providers.getDerived = fn; this._render(); },
			/** fn(state, instance) → [{k: "up"|"down"|"bf"|"tpl", label, rounds, id, ...}] for row tallies and statblock pills. */
			setEffectItemsProvider: fn => { this._providers.effectItems = fn; this._render(); },
			/**
			 * fn(state, ctx) → {text, word?, cls, title, ariaLabel?, renderPopover?(close) → Node} for the top-bar
			 * difficulty badge. With renderPopover the badge becomes a button that opens it.
			 */
			setDifficultyProvider: fn => { this._providers.difficulty = fn; this._render(); },
			/** Replace statblock d20 rolls: fn({instance, name, roll, rollMode, evt}) → Promise. */
			setRollHandler: fn => { this._rollHandler = fn; },
			registerDockTab: tab => this._dock.registerTab(tab),
			addStatblockDecorator: fn => this._statblock.addDecorator(fn),
			onDamageApplied: fn => this._addHook("damageApplied", fn),
			onTurnChanged: fn => this._addHook("turnChanged", fn),
			onRolled: fn => this._addHook("rolled", fn),
			/** fn(instanceId, effectItem) — "End" button in the rail's effects popover. */
			setOnEndEffect: fn => { this._rail._cb.onEndEffect = fn; this._render(); },
			/** Group actions the rail's Groups view calls: {pSetInit(name, total), pRoll(name), pStack(name, isStacked), openRename(name, anchor), close() → bool}. */
			setGroupHandlers: handlers => { this._rail._cb.group = handlers; this._render(); },
			pCommit: (label, recipe) => this._pCommit(label, recipe),
			/** True while the saved encounter could not be read: features must not write over it. */
			isSaveUnreadable: () => this._hasUnreadableSave,
			toast: (text, opts) => this.toast(text, opts),
			view: id => this._view(id),
			setSelection: ids => this._setSelection(ids),
			setDockTab: id => this._dock.setTab(id),
			/** Open a dock tab with its form prefilled (tabs that support it: "roll" → {kind, ability, dc, damage, …}). */
			presetDockTab: (id, patch) => this._dock.presetTab(id, patch),
			/** Show the stage's how-to hint card again (⋯ menu "Show the how-to hint"). */
			showHint: () => this._runHooks("showHint"),
			onShowHint: fn => this._addHook("showHint", fn),
			/** Open the prep drawer: {tab?: "creature" | …, creSub?: "cr" | …}. */
			openPrep: opts => this._runHooks("openPrep", opts || {}),
			onOpenPrep: fn => this._addHook("openPrep", fn),
			render: () => this._render(),
			hover: this._hover,
			getSettings: () => ({...this._settings}),
			getReferenceData: () => this._reference,
			getCtx: () => this._getCtx(),
			isMac: this._isMac,

			/* ---- Regions: persistent elements the shell never re-renders. Features own their contents. ---- */
			/**
			 * "stageTop" (strips above the viewed creature), "stageBottom" (drawers under it), "dockTop" (the console, roll
			 * tray and feed — persistent, above the dock tabs; never re-rendered by the dock), "layer" (overlays, dialogs).
			 */
			getRegion: name => ({stageTop: this._ele.stageTop, stageBottom: this._ele.stageBottom, dockTop: this._ele.dockTop, layer: this._ele.layer})[name] || null,
			/** fn(ctx) after every render — keep persistent regions in sync. Returns an unsubscribe. */
			onRender: fn => this._addHook("render", fn),

			/* ---- Render-time contributions: fn(ctx) → Node | Node[] | null, called on every render. ---- */
			addBarItem: fn => this._addExt("barItems", fn),
			addRailTop: fn => this._addExt("railTop", fn),
			/** Controls in the rail head next to the view toggle; return a node or null. */
			addRailHead: fn => this._addExt("railHead", fn),
			addRailFoot: fn => this._addExt("railFoot", fn),
			/** fn(rowEl, instance, ctx) — append pips, markers, drag handles to a rail row. */
			addRailRowDecorator: fn => this._addExt("rowDecorators", fn),
			/** {id, label, onclick(), keys?} entries in the ⋯ menu. */
			addMenuItem: item => this._addExt("menuItems", item),

			/* ---- Stage modes: alternative views of the stage (e.g. the timeline); "statblock" is the default. ---- */
			/** {id, label, keys?, render(el, ctx)} — while active, the statblock is hidden and render() fills `el`. */
			registerStageMode: mode => this._addExt("stageModes", mode),
			setStageMode: id => this._setStageMode(id),
			getStageMode: () => this._stageMode,

			/* ---- Keys: {section, keys: ["G"] | ["Shift", "G"], label, action, run(evt) → false to not handle} ---- */
			registerKey: binding => this._registerKey(binding),

			/* ---- The shell's own actions, so consoles and menus go through the same paths (undo, logs, toasts). ---- */
			actions: {
				pDamage: args => this._pDamage(args),
				pHp: args => this._pHp(args),
				pCondition: args => this._pCondition(args),
				pExhaustion: args => this._pExhaustion(args),
				pNextTurn: () => this._pNextTurn(),
				pPrevTurn: () => this._pPrevTurn(),
				/** opts: {isReroll, rollMode: "normal"|"advantage"|"disadvantage", toastText}. */
				pRollInitiative: (ids, opts) => this._pRollInitiative(ids, opts),
				pSetInitiative: (id, total) => this._pSetInitiative(id, total),
				pResourceAction: (id, action) => this._pResourceAction(id, action),
				pUndo: () => this._pUndo(),
				pRedo: () => this._pRedo(),
				openHelp: () => this._openHelp(),
				/** Open the saved-encounter chooser (the same dialog as ⋯ → Choose saved list…). */
				pChooseList: () => this._pChooseList(),
				pSendToDmScreen: () => this._pSendToDmScreen(),
			},
		};
	}

	_addExt (kind, item) {
		this._ext[kind].push(item);
		this._render();
		return () => {
			const ix = this._ext[kind].indexOf(item);
			if (ix >= 0) this._ext[kind].splice(ix, 1);
			if (kind === "stageModes" && item.id === this._stageMode) this._stageMode = "statblock";
			this._render();
		};
	}

	_registerKey (binding) {
		const {keys, action, run} = binding;
		if (!action || typeof run !== "function" || !Array.isArray(keys)) throw new Error("registerKey needs {keys, action, run}.");
		const clash = this._getKeyBindings().find(it => it.keys.join("+") === keys.join("+"));
		if (clash) throw new Error(`Key ${keys.join("+")} is already bound to "${clash.action}".`);
		this._ext.keys.push(binding);
		this._keyHandlers[action] = (_, evt) => run(evt);
		return () => {
			const ix = this._ext.keys.indexOf(binding);
			if (ix >= 0) this._ext.keys.splice(ix, 1);
			delete this._keyHandlers[action];
		};
	}

	_getKeyBindings () {
		return [...COCKPIT_KEY_BINDINGS, ...this._ext.keys];
	}

	_setStageMode (id) {
		const mode = id === "statblock" ? null : this._ext.stageModes.find(it => it.id === id);
		if (id !== "statblock" && !mode) return false;
		this._stageMode = id;
		this._render();
		return true;
	}

	_renderStageMode (ctx) {
		const mode = this._stageMode === "statblock" ? null : this._ext.stageModes.find(it => it.id === this._stageMode);
		if (!mode) this._stageMode = "statblock";
		this._root.dataset.ewcStage = this._stageMode;
		this._ele.stageAlt.hidden = !mode;
		this._ele.stageScroll.hidden = !!mode;
		this._ele.stageHead.hidden = !!mode;
		if (!mode) return;
		try {
			mode.render(this._ele.stageAlt, ctx);
		} catch (e) {
			rethrowLater(e);
		}
	}

	_getExtNodes (kind, ctx) {
		return this._ext[kind].flatMap(fn => {
			try {
				return [fn(ctx)].flat().filter(Boolean);
			} catch (e) {
				rethrowLater(e);
				return [];
			}
		});
	}

	_addHook (name, fn) {
		this._hooks[name].add(fn);
		return () => this._hooks[name].delete(fn);
	}

	_runHooks (name, payload) {
		this._hooks[name].forEach(fn => {
			try {
				fn(payload);
			} catch (e) {
				rethrowLater(e);
			}
		});
	}

	/* -------------------------------------------- Derived view data -------------------------------------------- */

	/** Effective statblocks are cached per monster object and operation list, so re-renders don't rebuild them. */
	_getEffective (instance) {
		const key = instance.monster;
		if (!key || typeof key !== "object") return getEncounterEffectiveMonster(instance);
		let byOps = this._effectiveCache.get(key);
		if (!byOps) this._effectiveCache.set(key, byOps = new Map());
		const opsKey = JSON.stringify(instance.statblockOperations || []);
		if (!byOps.has(opsKey)) {
			if (byOps.size > 8) byOps.clear();
			byOps.set(opsKey, getEncounterEffectiveMonster(instance));
		}
		return byOps.get(opsKey);
	}

	_getOrderIds (state) {
		return getCockpitRailOrder({instances: state.instances, initiativeOf: it => getEncounterInitiativeTotal(state, it)});
	}

	/** Derived numbers are pure per (state, settings); one render asks for the same creature several times. */
	_getCachedShellDerived (state, instance) {
		if (!state || !instance) return {};
		this._derivedCache ||= new WeakMap();
		let byKey = this._derivedCache.get(state);
		if (!byKey) this._derivedCache.set(state, byKey = new Map());
		const key = `${instance.id}|${this._settings.ruleset}|${!!this._settings.monsterDeathSaves}`;
		if (!byKey.has(key)) byKey.set(key, getCockpitShellDerived(state, instance, this._settings));
		return byKey.get(key);
	}

	_getTurnOrderIds (state) {
		return EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
	}

	/** The creature whose turn it is. For a shared group turn, the first member still standing. */
	_getActiveInstanceId (state) {
		const activeId = state.turn?.activeId;
		if (!state.turn?.round || !activeId) return null;
		if (state.instances.some(it => it.id === activeId)) return activeId;
		const group = state.groups.find(it => it.id === activeId);
		if (!group) return null;
		const members = group.memberIds.map(id => state.instances.find(it => it.id === id)).filter(Boolean);
		return (members.find(it => !it.defeated && it.hp?.current !== 0) || members[0])?.id ?? null;
	}

	_isTurn (state, id) {
		const activeId = state.turn?.activeId;
		if (!state.turn?.round || !activeId) return false;
		if (activeId === id) return true;
		return !!state.groups.find(it => it.id === activeId)?.memberIds.includes(id);
	}

	_getTargets (state) {
		return getCockpitDockTargetIds({selectedIds: this._ui.selectedIds, viewedId: this._ui.viewedId, instanceIds: state.instances.map(it => it.id)});
	}

	_getLabels (state = this._engine.getState()) {
		return getCockpitInstanceLabels(state.instances);
	}

	_getWho (targetIds, labels) {
		return targetIds.length === 1 ? labels.get(targetIds[0]) : getCockpitPlural(targetIds.length, "creature");
	}

	/** Drop UI references to creatures that no longer exist. */
	_pruneUi (state) {
		const ids = new Set(state.instances.map(it => it.id));
		this._ui.selectedIds = this._ui.selectedIds.filter(id => ids.has(id));
		if (this._ui.anchorId && !ids.has(this._ui.anchorId)) this._ui.anchorId = null;
		if (!ids.has(this._ui.viewedId)) this._ui.viewedId = this._getActiveInstanceId(state) ?? this._getOrderIds(state)[0] ?? null;
	}

	_getCtx () {
		const state = this._engine.getState();
		this._pruneUi(state);
		const targets = this._getTargets(state);
		const conditionCatalog = this._reference.conditions;
		return {
			state,
			ui: this._ui,
			labels: this._getLabels(state),
			orderIds: this._getOrderIds(state),
			activeInstanceId: this._getActiveInstanceId(state),
			isTurn: id => this._isTurn(state, id),
			initiativeOf: instance => getEncounterInitiativeTotal(state, instance),
			conditionCatalog,
			conditions: conditionCatalog,
			getConditionColor: name => getNpcTrackerConditionColor(name, {conditionCatalog}),
			effectItems: instance => this._providers.effectItems(state, instance) || [],
			getDerived: instance => this._providers.getDerived(instance, state) || {},
			getEffective: instance => this._getEffective(instance),
			quickActions: QUICK_ACTIONS,
			groupChips: getCockpitGroupChips({instances: state.instances, viewGroups: getEncounterViewGroups(state)}),
			rosterGroups: getEncounterGroupsV8(state),
			targetIds: targets.ids,
			isSelection: targets.isSelection,
			ruleset: this._settings.ruleset,
			settings: this._settings,
			isMac: this._isMac,
			stageMode: this._stageMode,
			railTop: this._ext.railTop,
			railHead: this._ext.railHead,
			railFoot: this._ext.railFoot,
			rowDecorators: this._ext.rowDecorators,
		};
	}

	/* -------------------------------------------- Render -------------------------------------------- */

	_onEngineChange (meta) {
		if (meta?.type === "replace") {
			this._ui = {viewedId: null, selectedIds: [], anchorId: null};
			this._dock.cancelReview();
		}
		this._render();
	}

	_render () {
		if (!this._engine || !this._rail) return;
		const ctx = this._getCtx();
		this._renderBar(ctx);
		this._rail.render(ctx);
		this._statblock.render(ctx);
		this._dock.render(ctx);
		const isEmpty = !ctx.state.instances.length;
		this._root.classList.toggle("is-empty", isEmpty);
		if (isEmpty) this._renderEmpty();
		else this._renderStageMode(ctx);
		this._runHooks("render", ctx);
	}

	_renderEmpty () {
		const isBroken = this._hasUnreadableSave;
		this._ele.stageHead.replaceChildren(h("div.ewc-empty", null,
			h("h2.ewc-empty__h", null, isBroken ? "Saved encounter unreadable" : "Start an encounter"),
			h("p", null, isBroken
				? "The saved encounter could not be read. It has not been changed; choose a saved list to replace it."
				: "No creatures yet. Build an encounter in the Bestiary, save it as a pinned list, then open it here."),
			h("div.ewc-empty__btns", null,
				h("button.ewc-btn.ewc-btn--primary", {type: "button", disabled: !this._isCatalogReady, onclick: () => this._pChooseList()}, "Choose saved list…"),
				h("a.ewc-btn", {href: "bestiary.html"}, "Open Bestiary"),
			),
		));
	}

	_renderBar (ctx) {
		const {state, labels} = ctx;
		const round = state.turn?.round || 0;
		const turnOrderIds = this._getTurnOrderIds(state);
		const prevTurn = round ? getCockpitPrevTurn({turn: state.turn, orderIds: turnOrderIds}) : null;
		const hasInit = turnOrderIds.length > 0;
		const sharedGroup = round && state.turn?.activeId && !state.instances.some(it => it.id === state.turn.activeId)
			? state.groups.find(it => it.id === state.turn.activeId) : null;
		const turnName = sharedGroup
			? `${labels.get(ctx.activeInstanceId) || "Group"} +${sharedGroup.memberIds.length - 1}`
			: ctx.activeInstanceId ? labels.get(ctx.activeInstanceId) : null;

		const diff = this._getDifficulty(state, ctx);
		const enc = h("div.ewc-bar__enc", null,
			h("h1.ewc-bar__title", {title: state.sourceList?.name || ""}, state.sourceList?.name || "Encounter"),
			diff ? this._getDifficultyBadge(diff) : null,
		);

		const turn = h("div.ewc-bar__turn", {role: "group", "aria-label": "Turn"},
			h("span.ewc-round", null, round ? ["Round ", h("b", {"data-ewc-round": ""}, `${round}`)] : h("span.ewc-muted", null, "Not started")),
			turnName ? h("button.ewc-turnchip", {
				type: "button",
				title: `View ${turnName}, the active creature (Space)`,
				"aria-keyshortcuts": "Space",
				"data-ewc-turnchip": "",
				onclick: () => this._viewActive(),
			}, h("span.ewc-turnchip__dot", {"aria-hidden": "true"}), h("span.ewc-turnchip__n", null, turnName), kbd(getCockpitKeyLabels(["Space"], {isMac: this._isMac}))) : null,
			h("button.ewc-btn.ewc-btn--ghost", {
				type: "button",
				"data-ewc-act": "prev",
				disabled: !prevTurn,
				title: "Previous turn (P)",
				"aria-keyshortcuts": "P",
				onclick: () => this._pPrevTurn(),
			}, h("span", {"aria-hidden": "true"}, "‹"), h("span.ewc-btn__lbl", null, "Prev"), kbd(["P"])),
			h("button.ewc-btn.ewc-btn--primary", {
				type: "button",
				"data-ewc-act": "next",
				disabled: !hasInit,
				title: hasInit ? (round ? "Next turn (N)" : "Start combat at the top of the initiative order (N)") : "Roll or enter initiative first",
				"aria-keyshortcuts": "N",
				onclick: () => this._pNextTurn(),
			}, round ? "Next turn" : "Start combat", kbd(["N"])),
		);

		const tools = h("div.ewc-bar__tools", null,
			...this._getExtNodes("barItems", ctx),
			this._getHistoryButton("undo"),
			this._getHistoryButton("redo"),
			h("span.ewc-bar__sep", {"aria-hidden": "true"}),
			h("button.ewc-btn.ewc-btn--ghost.ewc-bar__help", {
				type: "button",
				title: "Keyboard shortcuts (Shift+?)",
				"aria-keyshortcuts": "Shift+?",
				"data-ewc-act": "help",
				onclick: () => this._openHelp(),
			}, h("span.ewc-btn__lbl", null, "Keys"), kbd(["⇧?"])),
			this._getMenu(ctx),
		);
		this._ele.bar.replaceChildren(enc, turn, tools);
	}

	_getHistoryButton (kind) {
		const isUndo = kind === "undo";
		const keys = isUndo ? ["mod", "Z"] : this._isMac ? ["mod", "Shift", "Z"] : ["mod", "Y"];
		const can = isUndo ? this._engine.canUndo() : this._engine.canRedo();
		const what = isUndo ? this._engine.getUndoLabel() : this._engine.getRedoLabel();
		const verb = isUndo ? "Undo" : "Redo";
		const label = getCockpitKeyLabels(keys, {isMac: this._isMac});
		return h("button.ewc-btn.ewc-btn--ghost.ewc-bar__hist", {
			type: "button",
			"data-ewc-act": kind,
			disabled: !can,
			"aria-label": can ? `${verb}: ${what}` : `Nothing to ${kind}`,
			title: can ? `${verb}: ${what} (${label.join("+")})` : `Nothing to ${kind}`,
			"aria-keyshortcuts": getCockpitAriaShortcut(keys, {isMac: this._isMac}),
			onclick: () => isUndo ? this._pUndo() : this._pRedo(),
		}, h("span.ewc-bar__hist-ico", {"aria-hidden": "true", html: isUndo ? SVG_UNDO : SVG_REDO}), kbd([this._getKbdCombo(label)]));
	}

	/** One compact chip per shortcut ("⌘Z", "Ctrl Y") keeps the bar narrow enough for the encounter cluster. */
	_getKbdCombo (labels) {
		return labels.join(this._isMac ? "" : " ");
	}

	/** The difficulty badge; a provider with renderPopover turns it into a button that opens a details popover. */
	_getDifficultyBadge (diff) {
		const cls = diff.cls && !diff.word ? `.${diff.cls}` : "";
		const content = diff.word
			? [h(`b.ewc-badge__w${diff.cls ? `.${diff.cls}` : ""}`, null, diff.word), h("span.ewc-badge__xp", null, diff.text)]
			: diff.text;
		if (typeof diff.renderPopover !== "function") return h(`span.ewc-badge${cls}`, {title: diff.title || null}, content);

		const wasOpen = this._isDiffOpen;
		const wrap = h("div.ewc-diffwrap");
		const btn = h(`button.ewc-badge.ewc-badge--btn${cls}`, {
			type: "button",
			"aria-haspopup": "dialog",
			"aria-expanded": "false",
			"aria-controls": "ewc-diffpop",
			"aria-label": diff.ariaLabel || null,
			title: diff.title || null,
			"data-ewc-act": "difficulty",
		}, content);
		const pop = h("div.ewc-diffpop", {id: "ewc-diffpop", role: "dialog", "aria-label": "Encounter difficulty and XP", hidden: true});
		const onOutside = evt => { if (!wrap.contains(evt.target)) close(); };
		const close = ({isFocus = false} = {}) => {
			if (pop.hidden) return false;
			pop.hidden = true;
			this._isDiffOpen = false;
			btn.setAttribute("aria-expanded", "false");
			document.removeEventListener("pointerdown", onOutside, true);
			if (isFocus) btn.focus();
			return true;
		};
		const open = () => {
			let body;
			try {
				body = diff.renderPopover(() => close({isFocus: true}));
			} catch (e) {
				rethrowLater(e);
				body = h("p.ewc-muted", null, "Difficulty details are unavailable.");
			}
			pop.replaceChildren(body);
			pop.hidden = false;
			this._isDiffOpen = true;
			btn.setAttribute("aria-expanded", "true");
			document.addEventListener("pointerdown", onOutside, true);
		};
		btn.addEventListener("click", () => {
			if (!pop.hidden) return close();
			open();
			(pop.querySelector("button:not([disabled]), a[href]") || pop).focus?.();
		});
		pop.tabIndex = -1;
		pop.addEventListener("keydown", evt => {
			if (evt.key !== "Escape") return;
			evt.preventDefault();
			evt.stopPropagation();
			close({isFocus: true});
		});
		this._closeDiff?.();
		this._closeDiff = close;
		wrap.append(btn, pop);
		if (wasOpen) open();
		return wrap;
	}

	_getDifficulty (state, ctx) {
		if (this._providers.difficulty) {
			try {
				const out = this._providers.difficulty(state, ctx);
				if (out !== undefined) return out;
			} catch (e) {
				rethrowLater(e);
			}
		}
		if (!state.instances.length) return null;
		const {totalXp, unknownCount} = getEncounterXpSummary(state.instances.filter(it => !it.defeated));
		return {
			text: `${totalXp.toLocaleString()} XP`,
			title: `Total XP of the creatures still in the fight${unknownCount ? `; ${unknownCount} without a rated CR` : ""}.`,
		};
	}

	/* -------------------------------------------- Menu -------------------------------------------- */

	_getMenu (ctx) {
		const wasOpen = this._isMenuOpen;
		const wrap = h("div.ewc-menu");
		const pop = h("div.ewc-menu__pop", {role: "menu", id: "ewc-menu", "aria-label": "Encounter settings", hidden: true});
		const btn = h("button.ewc-btn.ewc-btn--icon", {
			type: "button",
			"aria-haspopup": "menu",
			"aria-controls": "ewc-menu",
			"aria-expanded": "false",
			"aria-label": "Encounter settings",
			title: "Encounter settings",
			"data-ewc-act": "menu",
			html: SVG_MORE,
		});
		const onOutside = evt => { if (!wrap.contains(evt.target)) close(); };
		const open = () => {
			pop.hidden = false;
			this._isMenuOpen = true;
			btn.setAttribute("aria-expanded", "true");
			document.addEventListener("pointerdown", onOutside, true);
		};
		const close = ({isFocus = false} = {}) => {
			if (pop.hidden) return false;
			pop.hidden = true;
			this._isMenuOpen = false;
			btn.setAttribute("aria-expanded", "false");
			document.removeEventListener("pointerdown", onOutside, true);
			if (isFocus) btn.focus();
			return true;
		};
		btn.addEventListener("click", () => {
			if (!pop.hidden) return close();
			open();
			pop.querySelector("button:not([disabled]), input")?.focus();
		});
		pop.addEventListener("keydown", evt => {
			if (evt.key !== "Escape") return;
			evt.preventDefault();
			evt.stopPropagation();
			close({isFocus: true});
		});
		this._closeMenu?.();
		this._closeMenu = close;

		const item = (text, onclick, {disabled = false, title = null, act = null} = {}) => h("button.ewc-menu__item", {
			type: "button",
			role: "menuitem",
			disabled,
			title,
			"data-ewc-menu": act,
			onclick: () => { close(); onclick(); },
		}, text);

		const ruleset = h("div.ewc-seg", {role: "radiogroup", "aria-label": "Condition rules"}, ENCOUNTER_RULESETS.map(id => h("button.ewc-seg__b", {
			type: "button",
			role: "radio",
			"aria-checked": `${this._settings.ruleset === id}`,
			"data-ewc-ruleset": id,
			onclick: () => this._pSaveSettings({ruleset: id}),
		}, RULESET_LABELS[id] || id)));
		const deathSaves = h("input", {
			type: "checkbox",
			role: "switch",
			checked: !!this._settings.monsterDeathSaves,
			"data-ewc-setting": "monsterDeathSaves",
			onchange: () => this._pSaveSettings({monsterDeathSaves: deathSaves.checked}),
		});
		const unrolled = ctx.state.instances.filter(it => getEncounterInitiativeTotal(ctx.state, it) == null && !it.defeated);
		const rollIds = (unrolled.length ? unrolled : ctx.state.instances).map(it => it.id);
		const autoRecharge = h("input", {
			type: "checkbox",
			role: "switch",
			checked: !!this._wsSettings.autoRollRecharge,
			"data-ewc-setting": "autoRollRecharge",
			onchange: () => this._pSaveWsSettings({autoRollRecharge: autoRecharge.checked}),
		});
		const foeIds = getCockpitFoeIds(ctx.state);
		const foeReroll = h("div.ewc-seg", {role: "group", "aria-label": "Re-roll foe initiative"}, COCKPIT_ROLL_MODES.map(mode => h("button.ewc-seg__b", {
			type: "button",
			disabled: !foeIds.length,
			title: foeIds.length ? `Re-roll initiative for ${getCockpitPlural(foeIds.length, "foe")} — ${mode.title}` : "No foes still fighting",
			"data-ewc-menu": `rerollfoes-${mode.id}`,
			onclick: () => {
				close();
				this._pRollInitiative(foeIds, {isReroll: true, rollMode: mode.id, toastText: getCockpitRerollToast(mode.id)});
			},
		}, mode.label)));

		pop.append(
			h("div.ewc-menu__h", null, "Encounter settings"),
			h("div.ewc-menu__row", null, h("span", null, "Condition rules"), ruleset),
			h("label.ewc-menu__row.ewc-menu__row--check", null, h("span", null, "Monsters make death saves"), deathSaves),
			h("label.ewc-menu__row.ewc-menu__row--check", {title: "Roll 1d6 for each spent Recharge ability when its creature's turn starts"}, h("span", null, "Auto-roll recharge at turn start"), autoRecharge),
			h("div.ewc-menu__sep", {role: "separator"}),
			h("div.ewc-menu__h", null, "Initiative & turns"),
			item(unrolled.length ? `Roll initiative for ${getCockpitPlural(unrolled.length, "creature")} without it` : "Re-roll everyone's initiative", () => this._pRollInitiative(rollIds, {isReroll: !unrolled.length}), {disabled: !ctx.state.instances.length, act: "rollinit"}),
			h("div.ewc-menu__row", null, h("span", null, "Re-roll foe initiative"), foeReroll),
			item("Reset turns to not started", () => this._pResetTurns(), {disabled: !ctx.state.turn?.round, act: "resetturns"}),
			h("div.ewc-menu__sep", {role: "separator"}),
			...this._ext.menuItems.map(it => item(it.keys ? [it.label, kbd(getCockpitKeyLabels(it.keys, {isMac: this._isMac}))] : it.label, () => it.onclick(), {disabled: !!it.disabled?.(ctx), title: it.title || null, act: it.id})),
			this._ext.menuItems.length ? h("div.ewc-menu__sep", {role: "separator"}) : null,
			item("Choose saved list…", () => this._pChooseList(), {disabled: !this._isCatalogReady, act: "choose"}),
			item("Send to DM Screen", () => this._pSendToDmScreen(), {disabled: !ctx.state.instances.length, title: "Queue the selection (or everyone still fighting) for the DM Screen initiative tracker", act: "dmscreen"}),
			h("a.ewc-menu__item", {role: "menuitem", href: "encounterworkspace.html?ew=1"}, "Open the classic workspace"),
			item("Show the how-to hint", () => this._runHooks("showHint"), {act: "hint"}),
			item(["Keyboard shortcuts", kbd(getCockpitKeyLabels(["Shift", "?"], {isMac: this._isMac}))], () => this._openHelp(), {act: "shortcuts"}),
		);
		wrap.append(btn, pop);
		if (wasOpen) open();
		return wrap;
	}

	async _pSaveWsSettings (patch) {
		try {
			this._wsSettings = await this._wsSettingsStore.pSave({...this._wsSettings, ...patch});
			this.toast(this._wsSettings.autoRollRecharge ? "Recharge abilities roll at the start of each monster's turn." : "Recharge rolls are manual.");
		} catch (e) {
			this.toast(`Settings were not saved: ${getErrorMessage(e)}.`, {kind: "error"});
		}
		this._render();
	}

	async _pSaveSettings (patch) {
		const next = {...this._settings, ...patch};
		try {
			this._settings = await this._settingsStore.pSave(next);
			this.toast(patch.ruleset ? `Condition rules: ${RULESET_LABELS[patch.ruleset]}.` : `Monster death saves ${next.monsterDeathSaves ? "on" : "off"}.`);
		} catch (e) {
			this.toast(`Settings were not saved: ${getErrorMessage(e)}.`, {kind: "error"});
		}
		this._render();
	}

	/* -------------------------------------------- Toasts -------------------------------------------- */

	/** kind: "info" | "error". isUndo: offer Undo for the change just made. action: {label, onclick}. */
	toast (text, {kind = "info", isUndo = false, action = null} = {}) {
		if (!this._ele?.toasts) return;
		const toast = h(`div.ewc-toast.ewc-toast--${kind}`, {role: kind === "error" ? "alert" : "status"});
		const dismiss = () => toast.remove();
		toast.append(h("p.ewc-toast__t", null, text));
		if (isUndo) {
			toast.append(h("button.ewc-btn.ewc-btn--sm", {
				type: "button",
				"data-ewc-act": "toast-undo",
				onclick: () => { dismiss(); this._pUndo(); },
			}, "Undo", kbd(getCockpitKeyLabels(["mod", "Z"], {isMac: this._isMac}))));
		}
		if (action) toast.append(h("button.ewc-btn.ewc-btn--sm", {type: "button", onclick: () => { dismiss(); action.onclick(); }}, action.label));
		toast.append(h("button.ewc-toast__x", {type: "button", "aria-label": "Dismiss"}, "×"));
		toast.lastElementChild.addEventListener("click", dismiss);
		this._ele.toasts.append(toast);
		while (this._ele.toasts.children.length > 3) this._ele.toasts.firstElementChild.remove();
		const ms = kind === "error" ? TOAST_MS * 2 : TOAST_MS;
		let timer = setTimeout(dismiss, ms);
		toast.addEventListener("pointerenter", () => clearTimeout(timer));
		toast.addEventListener("pointerleave", () => { timer = setTimeout(dismiss, ms); });
		toast.addEventListener("focusin", () => clearTimeout(timer));
	}

	/* -------------------------------------------- Commit -------------------------------------------- */

	/**
	 * Run an undoable change. Returns the new state, or null (after telling the DM) if nothing was saved.
	 * Errors carrying `unresolved` (conditional damage defenses) are rethrown for the caller to resolve.
	 */
	async _pCommit (label, recipe) {
		if (this._hasUnreadableSave) {
			this.toast("The saved encounter could not be read, so changes are disabled. Choose a saved list to replace it.", {kind: "error"});
			return null;
		}
		try {
			return await this._engine.pCommit(label, recipe);
		} catch (e) {
			if (e?.unresolved) throw e;
			this.toast(`${label} was not saved: ${getErrorMessage(e)}. Nothing changed.`, {kind: "error"});
			return null;
		}
	}

	async _pUndo () {
		if (!this._engine.canUndo()) return this.toast("Nothing to undo.");
		try {
			const label = await this._engine.pUndo();
			if (label) this.toast(`Undid: ${label}.`);
		} catch (e) {
			this.toast(`Could not undo: ${getErrorMessage(e)}.`, {kind: "error"});
		}
	}

	async _pRedo () {
		if (!this._engine.canRedo()) return this.toast("Nothing to redo.");
		try {
			const label = await this._engine.pRedo();
			if (label) this.toast(`Redid: ${label}.`);
		} catch (e) {
			this.toast(`Could not redo: ${getErrorMessage(e)}.`, {kind: "error"});
		}
	}

	/* -------------------------------------------- View & selection -------------------------------------------- */

	_view (id) {
		this._ui.viewedId = id;
		this._render();
	}

	_scrollRowIntoView (id) {
		if (!id) return;
		this._ele.rail.querySelector(`[data-ewc-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "nearest"});
	}

	_viewActive () {
		const id = this._getActiveInstanceId(this._engine.getState());
		if (!id) return false;
		this._view(id);
		this._scrollRowIntoView(id);
		return true;
	}

	_select (id, mode) {
		const next = getCockpitSelectionAfterClick({
			selectedIds: this._ui.selectedIds,
			orderIds: this._getOrderIds(this._engine.getState()),
			clickedId: id,
			anchorId: this._ui.anchorId,
			mode,
		});
		this._ui.selectedIds = next.selectedIds;
		this._ui.anchorId = next.anchorId;
		this._render();
	}

	_setSelection (ids) {
		this._ui.selectedIds = [...ids];
		this._render();
	}

	_toggleGroup (memberIds) {
		this._ui.selectedIds = getCockpitSelectionAfterGroupToggle({selectedIds: this._ui.selectedIds, memberIds});
		this._render();
	}

	_clearSelection () {
		if (!this._ui.selectedIds.length) return false;
		this._ui.selectedIds = [];
		this._ui.anchorId = null;
		this._render();
		return true;
	}

	/** Row quick action: view that creature and open the matching dock tab. A creature outside the selection becomes the sole target. */
	_quickAction (id, actionId) {
		if (!this._ui.selectedIds.includes(id)) {
			this._ui.selectedIds = [];
			this._ui.anchorId = null;
		}
		this._ui.viewedId = id;
		this._render();
		this._dock.setTab(QUICK_ACTION_TABS[actionId] || "hp", {isFocus: true});
	}

	/* -------------------------------------------- Keyboard -------------------------------------------- */

	_getKeyHandlers () {
		const isOnControl = evt => !!evt?.target?.closest?.("button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=radio], input, select, textarea");
		return {
			nextTurn: () => { this._pNextTurn(); },
			prevTurn: () => { this._pPrevTurn(); },
			viewActive: (_, evt) => isOnControl(evt) ? false : this._viewActive(),
			viewNext: () => this._step(1),
			viewPrev: () => this._step(-1),
			toggleViewed: () => {
				if (!this._ui.viewedId) return false;
				this._select(this._ui.viewedId, "toggle");
			},
			group: digit => {
				const chip = this._getCtx().groupChips[digit - 1];
				if (!chip) return false;
				this._toggleGroup(chip.memberIds);
			},
			escape: () => {
				if (this._closeMenu?.({isFocus: true})) return;
				if (this._closeDiff?.({isFocus: true})) return;
				if (this._rail.closePopover({isRestoreFocus: true})) return;
				if (this._rail._cb.group?.close?.()) return;
				if (this._dock.cancelReview()) return;
				if (this._clearSelection()) return;
				return false;
			},
			tab: name => this._dock.setTab(name),
			undo: () => { this._pUndo(); },
			redo: () => { this._pRedo(); },
			help: () => { this._openHelp(); },
		};
	}

	_step (delta) {
		const id = getCockpitStepId(this._getOrderIds(this._engine.getState()), this._ui.viewedId, delta);
		if (!id) return false;
		this._view(id);
		this._scrollRowIntoView(id);
	}

	_openHelp () {
		if (!this._dlgHelp) {
			this._dlgHelp = h("dialog.ewc-dialog.ewc-keys", {"aria-labelledby": "ewc-keys-title"});
			this._dlgHelp.addEventListener("click", evt => { if (evt.target === this._dlgHelp) this._dlgHelp.close(); });
			this._root.append(this._dlgHelp);
		}
		const sheet = getCockpitShortcutSheet({isMac: this._isMac, bindings: this._getKeyBindings()});
		this._dlgHelp.replaceChildren(
			h("div.ewc-dialog__head", null,
				h("h2.ewc-dialog__title", {id: "ewc-keys-title"}, "Keyboard shortcuts"),
				h("button.ewc-btn.ewc-btn--icon", {type: "button", "aria-label": "Close", "data-ewc-act": "close-keys", onclick: () => this._dlgHelp.close()}, "×"),
			),
			h("p.ewc-muted", null, "Single keys work whenever you're not typing in a field — press Esc to leave the field first."),
			h("div.ewc-keys__grid", null, sheet.map(section => h("section.ewc-keys__sec", null,
				h("h3.ewc-keys__h", null, section.name),
				h("dl.ewc-keys__dl", null, section.rows.map(row => h("div.ewc-keys__row", null, h("dt", null, kbd(row.keys)), h("dd", null, row.label)))),
			))),
			this._getGlyphLegend(),
		);
		this._dlgHelp.showModal();
	}

	/** D47: what the marks on rail rows and statblock pills mean — the same glyphs and pill styles the rail draws. */
	_getGlyphLegend () {
		const words = {up: "Buff", down: "Debuff", bf: "Battlefield effect", tpl: "Template"};
		const rows = [
			...COCKPIT_TALLY_BUCKETS.map(([k, glyph]) => [h(`span.ewc-pill.ewc-pill--fx.ewc-pill--${k}`, null, glyph), words[k]]),
			[h("span.ewc-pill.ewc-pill--cond", null, "Prone ", h("small", null, "2r")), "Condition · rounds left"],
			[h("span.ewc-keys__conc", null, "◉ Conc"), "Concentrating (click for the spell)"],
			[h("span.ewc-pill.ewc-pill--more", null, "+2"), "More on the viewed creature"],
		];
		return h("section.ewc-keys__sec.ewc-keys__legend", {"data-ewc-legend": ""},
			h("h3.ewc-keys__h", null, "Pill glyphs"),
			h("dl.ewc-keys__dl", null, rows.map(([mark, label]) => h("div.ewc-keys__row", null, h("dt", null, mark), h("dd", null, label)))),
		);
	}

	/* -------------------------------------------- Turns & initiative -------------------------------------------- */

	async _pNextTurn () {
		const state = this._engine.getState();
		if (!this._getTurnOrderIds(state).length) {
			this.toast("Roll or enter initiative before starting combat.", {action: {label: "Roll initiative", onclick: () => this._pRollInitiative(state.instances.map(it => it.id))}});
			return;
		}
		const isStart = !state.turn?.round;
		const mode = isStart ? "start" : "next";
		const rolls = this._wsSettings.autoRollRecharge ? await this._pRollTurnRecharges(state, mode) : [];
		if (this._engine.getState() !== state) return this.toast("The encounter changed while rolling recharge; the turn did not advance.", {kind: "error"});
		let readyCount = 0;
		const next = await this._pCommit(isStart ? "Start combat" : "Next turn", (draft, {log}) => {
			const advanced = withCockpitTurnAdvanced(EncounterWorkspaceState.withTurn(draft, mode), {previousTurn: state.turn, log});
			if (!rolls.length) return advanced;
			const out = withCockpitRechargeRolls(advanced, rolls, {labels: this._getLabels(advanced), log});
			readyCount = out.readyCount;
			return out.state;
		});
		if (!next) return;
		this._afterTurnChange(state, next);
		if (rolls.length) this.toast(`Recharge: ${readyCount} of ${rolls.length} spent ${rolls.length === 1 ? "ability" : "abilities"} ready.`, {isUndo: true});
	}

	/** D6: roll 1d6 for each spent Recharge ability of whoever's turn is about to start. Rolls happen before the commit. */
	async _pRollTurnRecharges (state, mode) {
		let preview;
		try {
			preview = EncounterWorkspaceState.withTurn(state, mode);
		} catch {
			return [];
		}
		const labels = this._getLabels(preview);
		const rolls = [];
		for (const {id, recharge} of getCockpitTurnRecharges(preview)) {
			let roll = null;
			try {
				roll = await Renderer.dice.pRoll2("1d6", {isUser: false, name: labels.get(id), label: `${recharge.name} recharge (${recharge.min}–6)`}, {isResultUsed: false});
			} catch (e) {
				rethrowLater(e);
			}
			if (!Number.isInteger(roll) || roll < 1 || roll > 6) roll = RollerUtil.randomise(6);
			rolls.push({id, rechargeId: recharge.id, roll});
		}
		return rolls;
	}

	async _pPrevTurn () {
		const state = this._engine.getState();
		const turn = getCockpitPrevTurn({turn: state.turn, orderIds: this._getTurnOrderIds(state)});
		if (!turn) return this.toast(state.turn?.round ? "This is the first turn of combat." : "Combat hasn't started.");
		// Going back only moves the marker; durations are not un-ticked (undo is the way to rewind them).
		const next = await this._pCommit("Previous turn", draft => EncounterWorkspaceState.withTurn(draft, "prev"));
		if (next) this._afterTurnChange(state, next);
	}

	async _pResetTurns () {
		await this._pCommit("Reset turns", draft => EncounterWorkspaceState.withTurn(draft, "reset"));
	}

	_afterTurnChange (before, after) {
		const id = this._getActiveInstanceId(after);
		if (id) {
			this._view(id);
			this._scrollRowIntoView(id);
		}
		this._runHooks("turnChanged", {before, after, activeInstanceId: id});
	}

	async _pSetInitiative (id, total) {
		const label = this._getLabels().get(id);
		await this._pCommit(total == null ? `Clear initiative — ${label}` : `Initiative ${total} — ${label}`, draft => EncounterWorkspaceState.withInitiative(draft, {id, total}));
	}

	async _pRollInitiative (ids, {isReroll = false, rollMode = "normal", toastText = null} = {}) {
		const state = this._engine.getState();
		const labels = this._getLabels(state);
		const seen = new Set();
		const results = [];
		const lines = [];
		for (const id of ids) {
			const instance = state.instances.find(it => it.id === id);
			if (!instance) continue;
			const group = getEncounterSharedGroup(state, id);
			const key = group?.id ?? id;
			if (seen.has(key)) continue;
			seen.add(key);
			const name = group ? `${labels.get(id)} ×${group.memberIds.length}` : labels.get(id);
			if (!Number.isSafeInteger(Renderer.monster.getInitiativeBonusNumber({mon: this._getEffective(instance)}))) {
				lines.push(`${name}: no initiative bonus`);
				continue;
			}
			try {
				const rolled = await pRollEncounterInstance({instance, name, rollType: "initiative", key: "dex", label: "Initiative (Dexterity check)", rollMode});
				results.push({id, total: rolled.total});
				lines.push(`${name} ${rolled.total}`);
			} catch (e) {
				lines.push(`${name}: ${getErrorMessage(e)}`);
			}
		}
		if (!results.length) return this.toast(lines.length ? `No initiative rolled. ${lines.join(" · ")}.` : "No initiative to roll.", {kind: "error"});
		const summary = `Initiative${rollMode === "normal" ? "" : ` (${rollMode})`}: ${lines.join(" · ")}`;
		const next = await this._pCommit(isReroll ? "Re-roll initiative" : "Roll initiative", (draft, {log}) => {
			log("roll", summary);
			return EncounterWorkspaceState.withInitiativeResults(draft, results);
		});
		if (next) this.toast(toastText ? `${toastText} ${summary}.` : `${summary}.`, {isUndo: true});
	}

	/* -------------------------------------------- Rolls & resources -------------------------------------------- */

	async _pRoll ({instance, roll, rollMode, evt}) {
		const name = this._getLabels().get(instance.id);
		if (this._rollHandler) return this._rollHandler({instance, name, roll, rollMode, evt});
		try {
			const result = await pRollEncounterInstance({instance, name, ...roll, rollMode});
			const isFail = ["autoFail", "unavailable"].includes(result.mode);
			const value = result.mode === "autoFail" ? "automatic failure" : result.mode === "unavailable" ? "unavailable" : result.total;
			const outcome = `${name}: ${result.label} — ${value}. ${result.sourcesText || "Normal roll"}.`;
			this.toast(outcome, {kind: isFail ? "error" : "info"});
			this._runHooks("rolled", {instance, roll, rollMode, result});
			if (!this._hasUnreadableSave) this._engine.pLog("roll", outcome).catch(() => {});
		} catch (e) {
			this.toast(`Could not roll ${roll?.label || "that"} for ${name}: ${getErrorMessage(e)}.`, {kind: "error"});
		}
	}

	async _pResourceAction (id, action) {
		const reducer = RESOURCE_REDUCERS[action?.kind];
		if (!reducer) return this.toast("Unknown combat resource action.", {kind: "error"});
		const label = this._getLabels().get(id);
		const text = action.kind === "concentration"
			? `${action.active === false ? "End concentration" : "Concentration"} — ${label}`
			: `Update resources — ${label}`;
		if (action.kind === "concentration") {
			// Through the rules module so ending or switching spells also ends the effects linked to the old spell.
			await this._pCommit(text, (draft, {log}) => {
				if (action.active === false) endEncounterConcentration(draft, id, {log});
				else startEncounterConcentration(draft, id, action.label || "", {log});
				return draft;
			});
			return;
		}
		await this._pCommit(text, draft => EncounterWorkspaceState[reducer](draft, {...action, id}));
	}

	async _pRevive (id) {
		const name = this._getLabels().get(id);
		await this._pCommit(`Revive ${name}`, (draft, {log}) => { withCockpitRevived(draft, id, {log, name}); });
	}

	async _pDropConcentration (id) {
		await this._pCommit(`End concentration — ${this._getLabels().get(id)}`, (draft, {log}) => { endEncounterConcentration(draft, id, {log}); });
	}

	/* -------------------------------------------- HP -------------------------------------------- */

	async _pDamage ({amount, amountText, damageType, source, isCrit, decisions, targetIds}) {
		const state = this._engine.getState();
		const labels = this._getLabels(state);
		if (!state.instances.some(it => targetIds.includes(it.id) && it.hp?.max != null && it.hp?.current != null)) {
			this.toast("None of the targets have HP set. Set their HP first.", {kind: "error"});
			return {ok: false};
		}
		let outcome = null;
		const label = `${amount}${damageType ? ` ${damageType}` : ""} damage → ${this._getWho(targetIds, labels)}`;
		let next;
		try {
			next = await this._pCommit(label, (draft, {log}) => {
				if (damageType) {
					outcome = EncounterWorkspaceState.withTypedDamage(draft, {
						amount,
						damageType,
						source,
						decisions,
						targetIds,
						getExtraDefenses: getCockpitExtraDefensesGetter(draft, this._settings),
					});
				} else {
					const result = EncounterWorkspaceState.withHpOperation(draft, {operation: {mode: "delta", value: -amount}, targetIds});
					outcome = {...result, results: result.snapshots.map(({id, before, after}) => ({id, damage: amount, defenses: {}, before, after, concentrationDc: null}))};
				}
				const extra = `${isCrit ? " (critical hit)" : ""}${amountText && amountText !== `${amount}` ? ` [${amountText}]` : ""}`;
				log("damage", `${getCockpitDamageSummary({amount, damageType, results: outcome.results, labels, skippedIds: outcome.skippedIds})}${extra}`);
				const out = outcome.state;
				outcome.results.forEach(({id, damage, before, after}) => {
					const leftover = damage - Math.max(0, (before?.temp || 0) - (after?.temp || 0));
					applyEncounterDeathSaveDamage(out, {id, damage: leftover, hpBefore: before?.current ?? 0, isCrit, monsterDeathSaves: this._settings.monsterDeathSaves, ruleset: this._settings.ruleset, log});
				});
				return out;
			});
		} catch (e) {
			if (Array.isArray(e?.unresolved)) return {unresolved: e.unresolved};
			this.toast(`${label} was not saved: ${getErrorMessage(e)}. Nothing changed.`, {kind: "error"});
			return {ok: false};
		}
		if (!next) return {ok: false};
		// A creature that dropped to 0 lost its concentration in the same commit; no save to prompt for.
		const results = outcome.results.map(it => ({...it, concentrationDc: this._getConcentrationDc(next, it)}));
		this.toast(getCockpitDamageSummary({amount, damageType, results, labels, skippedIds: outcome.skippedIds}), {isUndo: true});
		this._runHooks("damageApplied", {amount, damageType, source, isCrit, results, skippedIds: outcome.skippedIds, targetIds, state: next});
		return {ok: true};
	}

	/**
	 * Untyped damage goes through withHpOperation, which does not report concentration; add it for creatures that
	 * still concentrate after the hit (dropping to 0 HP already ended it).
	 */
	_getConcentrationDc (state, {id, before, after}) {
		const instance = state.instances.find(it => it.id === id);
		if (!instance || !getEncounterConcentration(instance) || !before || !after) return null;
		const lost = ((before.current ?? 0) - (after.current ?? 0)) + ((before.temp ?? 0) - (after.temp ?? 0));
		return lost > 0 ? getEncounterConcentrationDc(lost) : null;
	}

	async _pHp ({mode, amount, amountText, targetIds}) {
		const labels = this._getLabels();
		const who = this._getWho(targetIds, labels);
		const label = {heal: `Heal ${amount} → ${who}`, temp: `${amount} temp HP → ${who}`, set: `Set HP to ${amount} → ${who}`}[mode];
		let skipped = [];
		const next = await this._pCommit(label, (draft, {log}) => {
			let out;
			if (mode === "heal") {
				out = draft;
				skipped = targetIds.filter(id => {
					const instance = out.instances.find(it => it.id === id);
					return !instance || instance.hp?.max == null || instance.hp?.current == null;
				});
				targetIds.filter(id => !skipped.includes(id)).forEach(id => applyEncounterHealing(out, {id, amount}));
			} else if (mode === "temp") {
				out = draft;
				targetIds.forEach(id => {
					const instance = out.instances.find(it => it.id === id);
					if (!instance) return;
					out = EncounterWorkspaceState.withHp(out, {id, prop: "temp", value: Math.max(Number(instance.hp?.temp) || 0, amount)});
				});
			} else {
				const result = EncounterWorkspaceState.withHpOperation(draft, {operation: {mode: mode === "set" ? "set" : "delta", value: amount}, targetIds});
				skipped = result.skippedIds;
				out = result.state;
			}
			log("hp", `${label}${amountText && amountText !== `${amount}` ? ` [${amountText}]` : ""}`);
			return out;
		});
		if (!next) return {ok: false};
		this.toast(`${label}.${skipped.length ? ` ${skipped.length} skipped (HP unset).` : ""}`, {isUndo: true});
		return {ok: true};
	}

	/* -------------------------------------------- Conditions -------------------------------------------- */

	async _pCondition ({condition, isAdd, rounds, targetIds}) {
		const who = this._getWho(targetIds, this._getLabels());
		const name = `${condition}`.toTitleCase();
		const label = `${isAdd ? name : `End ${name}`} → ${who}${isAdd && rounds ? ` (${getCockpitPlural(rounds, "round")})` : ""}`;
		const next = await this._pCommit(label, (draft, {log}) => {
			const ruleset = this._settings.ruleset;
			// Re-applying without a duration keeps the existing one (undefined = leave rounds alone).
			if (isAdd) applyEncounterCondition(draft, {targetIds, condition, rounds: rounds ?? undefined, ruleset, log});
			else removeEncounterCondition(draft, {targetIds, condition, log});
			return draft;
		});
		if (next) this.toast(`${label}.`, {isUndo: true});
	}

	async _pExhaustion ({delta, targetIds}) {
		const state = this._engine.getState();
		const who = this._getWho(targetIds, this._getLabels(state));
		const levels = new Map(state.instances
			.filter(it => targetIds.includes(it.id))
			.map(it => [it.id, Math.max(0, Math.min(this._getMaxExhaustion(), getCockpitExhaustionLevel(it) + delta))]));
		const shown = [...new Set(levels.values())];
		const label = `Exhaustion ${shown.length === 1 ? shown[0] : delta > 0 ? "+1" : "−1"} → ${who}`;
		const next = await this._pCommit(label, (draft, {log}) => {
			const byLevel = new Map();
			levels.forEach((level, id) => byLevel.set(level, [...(byLevel.get(level) || []), id]));
			byLevel.forEach((ids, level) => setEncounterExhaustion(draft, {targetIds: ids, level, ruleset: this._settings.ruleset, log}));
			return draft;
		});
		if (next) this.toast(`${label}.`, {isUndo: true});
	}

	_getMaxExhaustion () {
		return ENCOUNTER_EXHAUSTION_DEATH_LEVEL[getEncounterConditionRule("exhaustion", this._settings.ruleset).exhaustion] ?? 6;
	}

	/* -------------------------------------------- Loading encounters -------------------------------------------- */

	_pConfirmReplace ({isFromBestiary = false} = {}) {
		return InputUiUtil.pGetUserBoolean({
			title: "Replace Working Encounter",
			htmlDescription: `Replace the current working encounter with a copy of ${isFromBestiary ? "the current Bestiary encounter" : "this saved Bestiary list"}? Its creatures, HP, conditions, initiative, turns and undo history will be lost. ${isFromBestiary ? "The Bestiary encounter and its saved list" : "The saved Bestiary list"} will not change.`,
			textYes: "Replace Encounter",
			textNo: "Keep Current",
		});
	}

	async _pLoadExported (exportedSublist, {isFromBestiary = false} = {}) {
		const current = this._hasUnreadableSave ? EncounterWorkspaceState.getEmpty() : this._engine.getState();
		if (this._hasUnreadableSave && !await this._pConfirmReplace({isFromBestiary})) {
			this.toast("The unreadable encounter was kept.");
			return;
		}
		const next = await this._store.pReplace({
			currentState: current,
			exportedSublist,
			isRequireAllItems: isFromBestiary,
			pConfirm: () => this._pConfirmReplace({isFromBestiary}),
		});
		if (next === current) {
			this.toast("The working encounter was kept.");
			return;
		}
		this._hasUnreadableSave = false;
		await this._engine.pReplace(next);
		const state = this._engine.getState();
		this._ui.viewedId = this._getOrderIds(state)[0] ?? null;
		this._render();
		this.toast(`Loaded ${getCockpitPlural(state.instances.length, "creature")} from “${state.sourceList?.name || "saved list"}”${isFromBestiary ? " in Bestiary" : ""}.${state.omissions?.length ? ` ${state.omissions.length} could not be loaded.` : ""}`);
	}

	async _pChooseList () {
		if (!this._isCatalogReady) return this.toast("Bestiary sources are not available, so lists can't be loaded.", {kind: "error"});
		try {
			const manager = new SaveManager({isReadOnlyUi: true, isStorageReadOnly: true, page: UrlUtil.PG_BESTIARY});
			await manager.pMutStateFromStorage();
			if (!await manager.pHasSaves()) return this.toast("No saved Bestiary lists found. Save a pinned list in Bestiary first.");
			const exportedSublist = await manager.pDoLoad({isIncludeManagerClientState: true});
			if (!exportedSublist) return;
			await this._pLoadExported(exportedSublist);
		} catch (e) {
			this.toast(`The saved list could not be loaded: ${getErrorMessage(e)}. The working encounter is unchanged.`, {kind: "error"});
		}
	}

	async _pOpenBestiaryHandoff () {
		if (!window.location?.href) return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has(BESTIARY_ENCOUNTER_HANDOFF_PARAM)) return;
		const token = url.searchParams.get(BESTIARY_ENCOUNTER_HANDOFF_PARAM);
		url.searchParams.delete(BESTIARY_ENCOUNTER_HANDOFF_PARAM);
		window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
		try {
			const exportedSublist = takeBestiaryEncounterHandoff({token});
			if (!this._isCatalogReady) throw new Error("Bestiary sources are not available");
			await this._pLoadExported(exportedSublist, {isFromBestiary: true});
		} catch (e) {
			this.toast(`Could not open the Bestiary encounter: ${getErrorMessage(e)}. The working encounter is unchanged; return to Bestiary and send it again.`, {kind: "error"});
		}
	}

	async _pSendToDmScreen () {
		const state = this._engine.getState();
		const ids = this._ui.selectedIds.length ? this._ui.selectedIds : state.instances.filter(it => !it.defeated).map(it => it.id);
		try {
			const snapshot = getEncounterHandoffSnapshot({state: {...state, selectedIds: ids}});
			const result = await this._handoffStore.pQueue({
				snapshot,
				pConfirmReplace: () => InputUiUtil.pGetUserBoolean({
					title: "Replace Queued Encounter",
					htmlDescription: "Another encounter is still waiting for the DM Screen. Replace it? The working encounter doesn't change.",
					textYes: "Replace Queue",
					textNo: "Keep Queue",
				}),
			});
			if (!result?.ok) return this.toast("Kept the encounter that was already queued.");
			this.toast(`Queued ${getCockpitPlural(snapshot.entries.length, "creature")} for the DM Screen. Open it and confirm Import on the initiative tracker.`, {
				action: {label: "Open DM Screen", onclick: () => { window.location.href = "dmscreen.html"; }},
			});
		} catch (e) {
			this.toast(`Could not queue for the DM Screen: ${getErrorMessage(e)}.`, {kind: "error"});
		}
	}
}

export const pBootEncounterCockpit = async ({root = document.getElementById("ew-cockpit"), ...opts} = {}) => {
	const cockpit = new EncounterCockpit({root, ...opts});
	await cockpit.pInit();
	globalThis.ewCockpit = cockpit.getApi();
	return cockpit;
};
