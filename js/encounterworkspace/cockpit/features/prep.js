/**
 * P3b — prep and the battlefield: prep mode (Q) with Creature · Effects · Battlefield · Items · Add tabs, the Add
 * dialog (⇧A), the full statblock editor (I), the rail's BATTLEFIELD section (rail-battlefield.js), the rail-row ⋯
 * menu's Assess CR / Edit statblock and the rail head's "+ Add" button.
 * Built only on the cockpit API: a bar toggle, a drawer in `stageBottom`, rail top/foot slots, a dialog in `layer`.
 */

import {h, kbd, replaceKeepingFocus} from "../dom.js";
import {getCockpitKeyLabels} from "../keymap.js";
import {PREP_TABS, PREP_WHY, getNextPrepTab} from "./prep-model.js";
import {getPrepTargetIds} from "./prep-ui.js";
import {PREP_EDITOR_SECTIONS, pOpenPrepStatblockEditor, pRenderPrepCreatureTypeEditor} from "./prep-editor.js";
import {getPrepCreatureDraft, renderPrepCreatureTab} from "./prep-creature.js";
import {renderPrepEffectsTab} from "./prep-effects.js";
import {getPrepAreaDraft, renderPrepAreaTab} from "./prep-area.js";
import {renderPrepItemsTab} from "./prep-items.js";
import {PrepAddDialog, renderPrepAddTab} from "./prep-add.js";
import {installPrepStatblockEffects} from "./prep-statblock.js";
import {installCockpitRailBattlefield} from "./rail-battlefield.js";
import {getRailRowMenu} from "./rail-menu.js";

export function installCockpitPrepFeatures (api) {
	const S = {
		isOpen: false,
		tab: "creature",
		scope: "viewed",
		...getPrepCreatureDraft(),
		area: getPrepAreaDraft(),
		areaFocusId: null,
		crRows: null,
	};
	let addDialog = null;
	const openAdd = tab => (addDialog ||= new PrepAddDialog(api)).open(tab);
	const keyText = keys => kbd(getCockpitKeyLabels(keys, {isMac: api.isMac}));

	/* ---- Drawer ---- */
	const tabs = h("div.ewc-prep__tabs", {role: "tablist", "aria-label": "Prep tools", onkeydown: evt => onTabsKeydown(evt)});
	const why = h("p.ewc-prep__why");
	const dyn = h("div.ewc-prep__dyn");
	const ctMount = h("div.ewc-prep__ct", {hidden: true});
	const panel = h("div.ewc-prep__body", {id: "ewc-prep-panel", role: "tabpanel"}, why, dyn, ctMount);
	const drawer = h("section.ewc-prep", {"aria-label": "Prep mode", hidden: true},
		h("div.ewc-prep__head", null,
			tabs,
			h("button.ewc-btn.ewc-btn--ghost.ewc-btn--sm.ewc-prep__exit", {type: "button", dataset: {ewcAct: "prep-exit"}, title: "Exit prep mode (Q)", onclick: () => setOpen(false)},
				"Exit", h("span.ewc-prep__exitlong", null, " prep mode"), keyText(["Q"])),
		),
		panel,
	);
	api.getRegion("stageBottom").append(drawer);

	installPrepStatblockEffects(api);
	api.onOpenPrep?.(({tab = "creature", creSub = null} = {}) => {
		if (creSub) S.creSub = creSub;
		S.scope = "viewed";
		setOpen(true, {tab});
	});

	/* ---- Stage BATTLEFIELD strip, rail row ⋯ menu items, the rail head's "+ Add" ---- */
	installCockpitRailBattlefield(api, {
		onEdit: id => {
			setOpen(true, {tab: "area", isFocus: false, focusId: id});
			dyn.querySelector(`[data-ewc-bf-row="${CSS.escape(id)}"]`)?.scrollIntoView?.({block: "nearest"});
		},
		onAdd: () => {
			setOpen(true, {tab: "area", isFocus: false});
			dyn.querySelector(".ewc-prep__rule")?.focus({preventScroll: true});
		},
	});

	const isCreature = instance => instance?.kind !== "party";
	const menu = getRailRowMenu(api);
	menu.addItem({
		id: "assess",
		label: "Assess CR",
		order: 30,
		isShown: isCreature,
		run: instance => {
			api.view(instance.id);
			S.creSub = "cr";
			setOpen(true, {tab: "creature", isFocus: false});
		},
	});
	menu.addItem({
		id: "edit",
		label: "Edit statblock",
		order: 40,
		keys: ["I"],
		isShown: isCreature,
		run: instance => {
			api.view(instance.id);
			pOpenPrepStatblockEditor(api, instance.id, {section: PREP_EDITOR_SECTIONS.edit}).catch(e => api.toast(`Could not open the editor: ${e.message || e}.`, {kind: "error"}));
		},
	});

	api.addRailHead(() => h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost.ewc-rail__add", {
		type: "button",
		"aria-keyshortcuts": "Shift+A",
		"aria-label": "Add a creature",
		dataset: {ewcAct: "rail-add", ewcFk: "rail-add"},
		title: "Add a creature or party member to the fight (⇧A)",
		onclick: () => openAdd(null),
	}, "+ Add", kbd([getCockpitKeyLabels(["Shift", "A"], {isMac: api.isMac}).join("")])));

	let ctKey = null;
	let ctToken = 0;

	const getP = ctx => ({api, S, ctx, rerender: () => render(), getTargetIds: () => getPrepTargetIds(S, api.getCtx())});

	function setOpen (isOpen, {tab = null, isFocus = true, focusId = null} = {}) {
		S.isOpen = isOpen;
		if (tab) S.tab = tab;
		S.areaFocusId = isOpen ? focusId : null;
		api.render();
		if (!isOpen) return;
		if (isFocus) tabs.querySelector("[aria-selected=true]")?.focus({preventScroll: true});
		drawer.scrollIntoView?.({block: "nearest"});
	}

	function setTab (tab, {isFocus = false} = {}) {
		if (S.tab !== tab) {
			S.tab = tab;
			S.areaFocusId = null;
			render();
		}
		if (isFocus) tabs.querySelector(`[data-ewc-fk="ptab-${tab}"]`)?.focus();
	}

	function onTabsKeydown (evt) {
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
		const next = evt.key === "ArrowRight" ? getNextPrepTab(S.tab, 1)
			: evt.key === "ArrowLeft" ? getNextPrepTab(S.tab, -1)
				: evt.key === "Home" ? PREP_TABS[0].id
					: evt.key === "End" ? PREP_TABS.at(-1).id : null;
		if (!next) return;
		evt.preventDefault();
		evt.stopPropagation();
		setTab(next, {isFocus: true});
	}

	/** The guided creature-type editor (half-dragon etc. need selections) lives under the Templates sub-tool. */
	function renderCreatureTypeMount (P) {
		const isTpl = S.isOpen && S.tab === "creature" && S.creSub === "tpl";
		const ids = isTpl ? P.getTargetIds().filter(id => P.ctx.state.instances.find(it => it.id === id)?.kind !== "party") : [];
		ctMount.hidden = !ids.length;
		if (!ids.length) {
			if (ctKey != null) { ctKey = null; ctToken++; ctMount.replaceChildren(); }
			return;
		}
		const key = ids.join(",");
		if (key === ctKey) return;
		ctKey = key;
		const token = ++ctToken;
		pRenderPrepCreatureTypeEditor(api, {mount: ctMount, getTargetIds: () => ids, isCurrent: () => token === ctToken})
			.catch(e => { if (token === ctToken) api.toast(`Could not open creature types: ${e.message || e}.`, {kind: "error"}); });
	}

	function renderDrawer (ctx) {
		drawer.hidden = !S.isOpen;
		const P = getP(ctx);
		if (!S.isOpen) return renderCreatureTypeMount(P);
		replaceKeepingFocus(tabs, PREP_TABS.map(it => h("button.ewc-prep__tab", {
			type: "button",
			role: "tab",
			id: `ewc-ptab-${it.id}`,
			"aria-selected": `${it.id === S.tab}`,
			"aria-controls": "ewc-prep-panel",
			tabindex: it.id === S.tab ? "0" : "-1",
			dataset: {ewcFk: `ptab-${it.id}`, ewcPrepTab: it.id},
			onclick: () => setTab(it.id),
		}, it.label)));
		panel.setAttribute("aria-labelledby", `ewc-ptab-${S.tab}`);
		why.innerHTML = PREP_WHY[S.tab] || "";
		const body = {
			creature: () => renderPrepCreatureTab(P),
			fx: () => renderPrepEffectsTab(P),
			area: () => renderPrepAreaTab(P),
			items: () => renderPrepItemsTab(P),
			add: () => renderPrepAddTab(P, {onOpen: openAdd}),
		}[S.tab]?.() || [];
		replaceKeepingFocus(dyn, [body].flat(Infinity).filter(Boolean));
		renderCreatureTypeMount(P);
	}

	function render (ctx = api.getCtx()) {
		renderDrawer(ctx);
	}

	api.onRender(ctx => render(ctx));

	/* ---- Bar toggle ---- */
	api.addBarItem(() => h(`button.ewc-btn.ewc-btn--sm.ewc-prep-toggle${S.isOpen ? ".ewc-btn--primary.is-on" : ".ewc-btn--ghost"}`, {
		type: "button",
		"aria-pressed": `${S.isOpen}`,
		"aria-keyshortcuts": "Q",
		dataset: {ewcAct: "prep-toggle"},
		title: S.isOpen ? "Leave prep mode (Q)" : "Prep mode: edit creatures, effects, the battlefield and items; add to the fight (Q)",
		onclick: () => setOpen(!S.isOpen),
	}, S.isOpen ? "Exit Prep Mode" : "Enter Prep Mode", keyText(["Q"])));

	/* ---- Keys ---- */
	api.registerKey({section: "Prep", keys: ["Q"], label: "Prep mode on / off", action: "prep:toggle", run: () => setOpen(!S.isOpen)});
	api.registerKey({section: "Prep", keys: ["Shift", "A"], label: "Add creature or party member", action: "prep:add", run: () => openAdd(null)});
	api.registerKey({
		section: "Prep",
		keys: ["I"],
		label: "Edit the viewed statblock",
		action: "prep:editStatblock",
		run: () => {
			const viewed = api.getUi().viewedId;
			if (!viewed) return api.toast("View a creature first.");
			pOpenPrepStatblockEditor(api, viewed, {section: PREP_EDITOR_SECTIONS.edit}).catch(e => api.toast(`Could not open the editor: ${e.message || e}.`, {kind: "error"}));
		},
	});
	api.addMenuItem({id: "prep-add", label: "Add creature or party member…", keys: ["Shift", "A"], onclick: () => openAdd(null)});

	render();
}
