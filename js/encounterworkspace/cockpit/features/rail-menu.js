/**
 * The rail row's "⋯" menu: one shared popover per cockpit that features fill with items
 * (Console… · Mark concentration… · Move before… · Assess CR · Edit statblock). Items either act at once (`run`) or swap the
 * menu for a small panel (`panel`) — a spell-name field, a list of places in turn order.
 */
import {h, kbd} from "../dom.js";
import {getCockpitKeyLabels} from "../keymap.js";

const MENUS = new WeakMap();

/**
 * @param api The cockpit API (features share one object, so every feature gets the same menu).
 * @return {{addItem(item: {id: string, label: string, order?: number, keys?: string[],
 *   isShown?(instance, ctx): boolean, run?(instance, ctx): void, panel?(instance, ctx, menu): Node[]}): void}}
 */
export function getRailRowMenu (api) {
	if (MENUS.has(api)) return MENUS.get(api);
	const items = [];
	const S = {openId: null, panelId: null};

	const getRow = id => document.querySelector(`.ewc-row[data-ewc-id="${CSS.escape(id)}"]`);
	const onOutside = evt => {
		if (evt.target.closest?.(".ewc-rowmenu, [data-ewc-qa=more]")) return;
		close();
	};
	function close ({isFocus = false} = {}) {
		const id = S.openId;
		if (!id) return;
		S.openId = null;
		S.panelId = null;
		document.removeEventListener("pointerdown", onOutside, true);
		const row = getRow(id);
		row?.querySelector(".ewc-rowmenu")?.remove();
		row?.classList.remove("is-menu-open");
		const btn = row?.querySelector("[data-ewc-qa=more]");
		btn?.setAttribute("aria-expanded", "false");
		if (isFocus) btn?.focus();
	}
	function open (id) {
		close();
		S.openId = id;
		S.panelId = null;
		document.addEventListener("pointerdown", onOutside, true);
		refresh({isFocus: true});
	}
	function showPanel (itemId) {
		S.panelId = itemId;
		refresh({isFocus: true});
	}
	/** Re-draw the open menu in place (no full cockpit render). */
	function refresh ({isFocus = false} = {}) {
		const row = S.openId ? getRow(S.openId) : null;
		const instance = S.openId ? api.getState().instances.find(it => it.id === S.openId) : null;
		if (!row || !instance) return close();
		mount(row, instance, api.getCtx(), {isFocus});
	}

	function getMenuEle (instance, ctx) {
		const label = ctx.labels.get(instance.id) || "Creature";
		const menuApi = {close, back: () => showPanel(null), refresh};
		const panelItem = S.panelId ? items.find(it => it.id === S.panelId) : null;
		const body = panelItem
			? [
				h("button.ewc-rowmenu__back", {type: "button", "data-ewc-fk": `rm-back-${instance.id}`, onclick: () => showPanel(null)}, "‹ ", panelItem.label.replace(/…$/, "")),
				...[panelItem.panel(instance, ctx, menuApi)].flat().filter(Boolean),
			]
			: items
				.filter(it => !it.isShown || it.isShown(instance, ctx))
				.map(it => h("button.ewc-rowmenu__i", {
					type: "button",
					role: "menuitem",
					"data-ewc-fk": `rm-${it.id}-${instance.id}`,
					"data-ewc-rowmenu": it.id,
					onclick: () => {
						if (it.panel) return showPanel(it.id);
						close();
						it.run(instance, ctx);
					},
				}, h("span", null, it.label), it.keys ? kbd(getCockpitKeyLabels(it.keys, {isMac: api.isMac})) : null));
		const ele = h("div.ewc-pop.ewc-rowmenu", {
			role: panelItem ? "dialog" : "menu",
			"aria-label": `${label} · ${panelItem ? panelItem.label.replace(/…$/, "") : "more actions"}`,
			onclick: evt => evt.stopPropagation(),
			onkeydown: evt => {
				if (evt.key === "Escape") {
					evt.preventDefault();
					evt.stopPropagation();
					if (S.panelId) return showPanel(null);
					return close({isFocus: true});
				}
				if (panelItem || (evt.key !== "ArrowDown" && evt.key !== "ArrowUp")) return;
				evt.preventDefault();
				const btns = [...ele.querySelectorAll(".ewc-rowmenu__i")];
				const ix = btns.indexOf(document.activeElement);
				btns[(ix + (evt.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
			},
		}, body);
		return ele;
	}

	function mount (row, instance, ctx, {isFocus}) {
		row.querySelector(".ewc-rowmenu")?.remove();
		const ele = getMenuEle(instance, ctx);
		row.append(ele);
		row.classList.add("is-menu-open");
		row.querySelector("[data-ewc-qa=more]")?.setAttribute("aria-expanded", "true");
		if (isFocus) {
			requestAnimationFrame(() => {
				ele.scrollIntoView?.({block: "nearest"});
				ele.querySelector("input, .ewc-rowmenu__i, button")?.focus({preventScroll: true});
			});
		}
	}

	api.addRailRowDecorator((row, instance, ctx) => {
		const qa = row.querySelector(".ewc-row__qa");
		if (!qa || !items.some(it => !it.isShown || it.isShown(instance, ctx))) return;
		const label = ctx.labels.get(instance.id) || "creature";
		const isOpen = S.openId === instance.id;
		qa.append(h("button.ewc-qa.ewc-qa--more", {
			type: "button",
			"data-ewc-qa": "more",
			"data-ewc-fk": `qa-more-${instance.id}`,
			"aria-haspopup": "menu",
			"aria-expanded": `${isOpen}`,
			"aria-label": `More actions for ${label}`,
			title: `More: console, concentration, move in turn order, CR, edit statblock — ${label}`,
			onclick: evt => {
				evt.stopPropagation();
				if (S.openId === instance.id) return close();
				open(instance.id);
			},
		}, "⋯"));
		// A full rail render rebuilds rows; keep an open menu open (focus is restored by data-ewc-fk).
		if (isOpen) mount(row, instance, ctx, {isFocus: false});
	});

	const menu = {
		addItem (item) {
			items.push(item);
			items.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
		},
		close,
	};
	MENUS.set(api, menu);
	return menu;
}
