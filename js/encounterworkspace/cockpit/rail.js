/**
 * Initiative rail: one row per creature, highest initiative first.
 * Interaction model (user feedback, round 5): clicking a name VIEWS the creature; the checkbox, Ctrl/Cmd-click and
 * Shift-click SELECT. The dock acts on the selection, otherwise on the viewed creature.
 * Two views (A6 mockup roster): "Initiative" (a stacked group shows as one "Goblins ×5" row) and "Groups" (creatures
 * under their group's header, with that group's shared initiative, roll and stack controls, plus find and sort).
 */

import {h, kbd, replaceKeepingFocus} from "./dom.js";
import {
	COCKPIT_TALLY_BUCKETS,
	getCockpitAcValue,
	getCockpitConditionPills,
	getCockpitCrText,
	getCockpitHpState,
	getCockpitPlural,
	getCockpitTally,
} from "./model.js";
import {getCockpitKeyLabel} from "./keymap.js";
import {
	COCKPIT_ROSTER_SORTS,
	COCKPIT_ROSTER_VIEWS,
	getCockpitRailItems,
	getCockpitRosterSections,
	getCockpitStackSummary,
} from "./roster-model.js";

const LS_LEGEND_OFF = "ewc-legend-off";
const LS_VIEW = "ewc-rail-view";

function getStoredView () {
	try {
		const view = globalThis.localStorage?.getItem(LS_VIEW);
		return COCKPIT_ROSTER_VIEWS.includes(view) ? view : "init";
	} catch (e) {
		return "init";
	}
}

export class EncounterCockpitRail {
	/**
	 * @param root The rail container element.
	 * @param hover EncounterCockpitHover.
	 * @param isMac Platform labels.
	 * @param callbacks {onView(id), onSelect(id, mode), onSelectIds(ids), onGroupToggle(memberIds), onClearSelection(),
	 *   onSetInitiative(id, total), onRollInitiative(ids), onQuickAction(id, actionId), onEndEffect?(id, item),
	 *   group?: {pSetInit(name, total), pRoll(name), pStack(name, isStacked), openRename(name, anchor), close()}}
	 */
	constructor ({root, hover, isMac, callbacks}) {
		this._root = root;
		this._hover = hover;
		this._isMac = isMac;
		this._cb = callbacks;
		this._editInitId = null;
		this._popover = null;
		this._ctx = null;
		/** Roster view state: which view, the Groups view's find text and sort, and which stacked groups are expanded. */
		this._roster = {view: getStoredView(), query: "", sort: "init", stackOpen: new Set()};

		this._onDocPointerDown = evt => {
			if (!this._popover) return;
			if (this._popover.ele.contains(evt.target) || this._popover.anchor.contains(evt.target)) return;
			this.closePopover();
		};
		document.addEventListener("pointerdown", this._onDocPointerDown);
	}

	dispose () {
		document.removeEventListener("pointerdown", this._onDocPointerDown);
		this.closePopover();
	}

	/** Close the tally or stack-picker popover; returns true if one was open (so Esc only does one thing at a time). */
	closePopover ({isRestoreFocus = false} = {}) {
		if (!this._popover) return false;
		const {ele, anchor} = this._popover;
		ele.remove();
		anchor.setAttribute("aria-expanded", "false");
		this._popover = null;
		if (isRestoreFocus && anchor.isConnected) anchor.focus();
		return true;
	}

	/**
	 * ctx: {state, ui: {viewedId, selectedIds}, labels: Map, orderIds, isTurn(id), conditionCatalog,
	 *   effectItems(instance), getDerived(instance), getEffective(instance), quickActions: [{id, label, title}],
	 *   groupChips: [{key, name, memberIds}]}
	 */
	render (ctx) {
		this._ctx = ctx;
		const openTallyId = this._popover?.id ?? null;
		const openStackPick = this._popover?.stackPick ?? null;
		this.closePopover();
		const {state, ui} = ctx;
		const byId = new Map(state.instances.map(it => [it.id, it]));
		const rows = ctx.orderIds.map(id => byId.get(id)).filter(Boolean);
		if (this._editInitId && !byId.has(this._editInitId)) this._editInitId = null;

		const unrolled = rows.filter(it => ctx.initiativeOf(it) == null && !it.defeated);
		const isGroups = this._roster.view === "groups";
		const head = h("div.ewc-rail__head", null,
			h("h2.ewc-rail__title.ewc-sr", {id: "ewc-rail-title"}, isGroups ? "Creatures by group" : "Initiative order"),
			this._getViewToggle(rows.length),
			...this._getExtras(ctx.railHead, ctx),
			unrolled.length
				? h("button.ewc-btn.ewc-btn--sm", {
					type: "button",
					"data-ewc-fk": "rail-roll",
					title: "Roll initiative for every creature without one",
					onclick: () => this._cb.onRollInitiative(unrolled.map(it => it.id)),
				}, `Roll initiative (${unrolled.length})`)
				: null,
		);

		const legend = this._getLegend(ui);
		const chips = this._getChips(ctx);
		const groups = ctx.rosterGroups || [];
		const stackOpen = this._roster.stackOpen;
		const stackedNames = new Set(groups.filter(it => it.kind === "custom" && it.isStacked).map(it => it.name));
		[...stackOpen].filter(name => !stackedNames.has(name)).forEach(name => stackOpen.delete(name));
		const items = isGroups
			? this._getRosterItems(ctx, byId, groups)
			: getCockpitRailItems({orderIds: ctx.orderIds, byId, groups, stackOpen}).map(item => {
				if (item.type === "stack") return this._getStackRow(item.name, item.ids, ctx);
				if (item.type === "stackHead") return this._getStackHead(item.name, item.count);
				return this._getRow(byId.get(item.id), ctx);
			});
		const list = h(`ol.ewc-rail__list${isGroups ? ".ewc-rail__list--groups" : ""}`, {"aria-labelledby": "ewc-rail-title"}, items);
		const tools = isGroups && rows.length ? this._getRosterTools() : null;
		const empty = rows.length
			? (items.length ? null : h("p.ewc-rail__empty", {"data-ewc-roster-empty": "true"}, `No creature or group matches “${this._roster.query.trim()}”.`))
			: h("p.ewc-rail__empty", null, "No creatures yet. Use ", h("b", null, "⋯ → Choose saved list"), " or send an encounter from the Bestiary.");

		const top = this._getExtras(ctx.railTop, ctx);
		const foot = this._getExtras(ctx.railFoot, ctx);
		replaceKeepingFocus(this._root, [head, legend, chips, ...top, tools, list, empty, ...foot].filter(Boolean));

		if (openStackPick) {
			const anchor = this._root.querySelector(`[data-ewc-fk="${CSS.escape(openStackPick.fk)}"]`);
			if (anchor) this._openStackPick(openStackPick.name, openStackPick.qa, anchor, {isFocus: false});
		} else if (openTallyId) {
			const anchor = this._root.querySelector(`[data-ewc-tally="${CSS.escape(openTallyId)}"]`);
			if (anchor) this._openTally(openTallyId, anchor, {isFocus: false});
		}
	}

	/** Feature renderers (fn(ctx) → Node | Node[] | null); a throwing renderer is skipped, not fatal. */
	_getExtras (renderers, ctx) {
		return (renderers || []).flatMap(fn => {
			try {
				return [fn(ctx)].flat().filter(Boolean);
			} catch (e) {
				setTimeout(() => { throw e; });
				return [];
			}
		});
	}

	/* ---------------- Roster views (Initiative | Groups) ---------------- */

	_setView (view) {
		if (!COCKPIT_ROSTER_VIEWS.includes(view) || view === this._roster.view) return;
		this._roster.view = view;
		try { localStorage.setItem(LS_VIEW, view); } catch (e) { /* storage unavailable */ }
		if (this._ctx) this.render(this._ctx);
	}

	_getViewToggle (count) {
		const view = this._roster.view;
		const button = (id, text, title, extra) => h("button.ewc-seg__b", {
			type: "button",
			"data-ewc-rail-view": id,
			"data-ewc-fk": `rail-view-${id}`,
			"aria-pressed": `${view === id}`,
			title,
			onclick: () => this._setView(id),
		}, text, extra);
		return h("div.ewc-seg.ewc-rail__views", {role: "group", "aria-label": "Roster view"},
			button("init", "Initiative", "Everyone in turn order; a stacked group shows as one row", h("span.ewc-rail__n", null, ` ${count}`)),
			button("groups", "Groups", "Creatures under their group, with each group's shared initiative, roll and stack"),
		);
	}

	_getRosterTools () {
		const {query, sort} = this._roster;
		return h("div.ewc-roster__tools", null,
			h("input.ewc-input.ewc-roster__find", {
				type: "search",
				value: query,
				placeholder: "Find a creature or group",
				"aria-label": "Find a creature or group",
				"data-ewc-fk": "roster-find",
				oninput: evt => {
					this._roster.query = evt.currentTarget.value;
					if (this._ctx) this.render(this._ctx);
				},
				onkeydown: evt => {
					if (evt.key !== "Escape" || !evt.currentTarget.value) return;
					evt.preventDefault();
					evt.stopPropagation();
					this._roster.query = "";
					if (this._ctx) this.render(this._ctx);
				},
			}),
			h("select.ewc-input.ewc-roster__sort", {
				"aria-label": "Sort creatures within each group",
				title: "Sort creatures within each group",
				"data-ewc-fk": "roster-sort",
				onchange: evt => {
					this._roster.sort = evt.currentTarget.value;
					if (this._ctx) this.render(this._ctx);
				},
			}, COCKPIT_ROSTER_SORTS.map(it => h("option", {value: it.id, selected: it.id === sort}, it.label))),
		);
	}

	/** Groups view: one header per group (custom groups, the party, then "Ungrouped") followed by its rows. */
	_getRosterItems (ctx, byId, groups) {
		const sections = getCockpitRosterSections({orderIds: ctx.orderIds, byId, groups, labels: ctx.labels, query: this._roster.query, sort: this._roster.sort});
		return sections.flatMap(section => {
			const head = this._getGroupHead(section, ctx, byId);
			const isStack = section.kind === "custom" && section.group?.isStacked && !this._roster.stackOpen.has(section.name);
			const live = section.ids.filter(id => !byId.get(id).defeated);
			if (isStack && live.length > 1) {
				return [head, this._getStackRow(section.name, live, ctx), ...section.ids.filter(id => byId.get(id).defeated).map(id => this._getRow(byId.get(id), ctx))];
			}
			return [head, ...section.ids.map(id => this._getRow(byId.get(id), ctx))];
		});
	}

	_getGroupHead (section, ctx, byId) {
		const {name, kind, group} = section;
		const sel = ctx.ui.selectedIds;
		const memberIds = group?.memberIds || section.ids;
		const isSel = memberIds.length && memberIds.every(id => sel.includes(id));
		const count = section.ids.length === section.total ? `${section.total}` : `${section.ids.length} of ${section.total}`;
		const isCustom = kind === "custom" && !!group;
		const isOpenStack = isCustom && group.isStacked && this._roster.stackOpen.has(name);
		const handlers = this._cb.group;
		const acts = h("span.ewc-ghead__acts", null,
			h("button.ewc-ghead__act", {
				type: "button",
				"data-ewc-fk": `gsel-${section.key}`,
				"data-ewc-gact": "select",
				"aria-pressed": `${!!isSel}`,
				title: `${isSel ? "Unselect" : "Select"} every creature in ${name}`,
				onclick: () => this._cb.onGroupToggle(memberIds),
			}, isSel ? "Unselect" : "Select"),
			isCustom && handlers?.openRename
				? h("button.ewc-ghead__act", {
					type: "button",
					"data-ewc-fk": `gren-${section.key}`,
					"data-ewc-gact": "rename",
					"aria-haspopup": "dialog",
					title: `Rename ${name}`,
					onclick: evt => handlers.openRename(name, evt.currentTarget),
				}, "Rename")
				: null,
			isOpenStack ? this._getCollapseButton(name, `gcol-${section.key}`) : null,
		);
		const top = h("div.ewc-ghead__top", null,
			h("span.ewc-ghead__name", {title: name}, h("b", null, name), h("span.ewc-ghead__n", null, ` · ${count}`)),
			acts,
		);
		const head = h(`li.ewc-ghead.ewc-ghead--${kind}`, {role: "presentation", "data-ewc-ghead": name}, top);
		if (!isCustom || !handlers) return head;

		const members = group.memberIds.map(id => byId.get(id)).filter(Boolean);
		const inits = new Set(members.map(it => ctx.initiativeOf(it)));
		const common = inits.size === 1 ? [...inits][0] : null;
		const shared = group.sharedInit ?? common;
		const input = h("input.ewc-input.ewc-input--num.ewc-ghead__in", {
			type: "text",
			inputmode: "numeric",
			value: shared == null ? "" : `${shared}`,
			placeholder: inits.size > 1 ? "mixed" : "—",
			"data-ewc-fk": `ginit-${section.key}`,
			"data-ewc-ginit": name,
			"aria-label": `Shared initiative for ${name} — Enter to set it for every member`,
			title: "Type a number and press Enter: every member acts on it, back to back",
			onkeydown: evt => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					const raw = input.value.trim();
					if (!/^[+-]?\d+$/.test(raw)) {
						input.setCustomValidity("Type a whole number");
						input.reportValidity();
						return;
					}
					input.setCustomValidity("");
					handlers.pSetInit(name, Number(raw));
				} else if (evt.key === "Escape") {
					evt.preventDefault();
					evt.stopPropagation();
					input.value = shared == null ? "" : `${shared}`;
					input.blur();
				}
			},
			oninput: () => input.setCustomValidity(""),
		});
		head.append(h("div.ewc-ghead__init", null,
			h("label.ewc-ghead__lbl", null, "Init ", input),
			h("button.ewc-btn.ewc-btn--sm", {
				type: "button",
				"data-ewc-fk": `groll-${section.key}`,
				"data-ewc-gact": "roll",
				title: "Roll one d20 for the whole group (best initiative bonus); members stay adjacent",
				onclick: () => handlers.pRoll(name),
			}, "🎲 Roll once"),
			h("button.ewc-btn.ewc-btn--sm.ewc-ghead__stack", {
				type: "button",
				"data-ewc-fk": `gstack-${section.key}`,
				"data-ewc-gact": "stack",
				"aria-pressed": `${!!group.isStacked}`,
				title: group.isStacked ? `Show every ${name} member on its own row again` : `Show ${name} as one row in the initiative order`,
				onclick: () => {
					this._roster.stackOpen.delete(name);
					handlers.pStack(name, !group.isStacked);
				},
			}, "Stack"),
		));
		return head;
	}

	_getCollapseButton (name, fk) {
		return h("button.ewc-ghead__act", {
			type: "button",
			"data-ewc-fk": fk,
			"data-ewc-gact": "collapse",
			title: `Show ${name} as one row again`,
			onclick: () => {
				this._roster.stackOpen.delete(name);
				if (this._ctx) this.render(this._ctx);
				this._root.querySelector(`[data-ewc-stack="${CSS.escape(name)}"] .ewc-row__name`)?.focus();
			},
		}, "Collapse");
	}

	/** Initiative view: header over an expanded stack, so it can be collapsed again. */
	_getStackHead (name, count) {
		return h("li.ewc-ghead.ewc-ghead--stack", {role: "presentation", "data-ewc-ghead": name},
			h("div.ewc-ghead__top", null,
				h("span.ewc-ghead__name", null, h("b", null, name), h("span.ewc-ghead__n", null, ` · ${count} expanded`)),
				h("span.ewc-ghead__acts", null, this._getCollapseButton(name, `scol-${name}`)),
			),
		);
	}

	_expandStack (name) {
		this._roster.stackOpen.add(name);
		if (this._ctx) this.render(this._ctx);
		this._root.querySelector(`[data-ewc-ghead="${CSS.escape(name)}"] [data-ewc-gact="collapse"]`)?.focus();
	}

	/** One row for a stacked group: shared initiative, summed hit points, a mini bar per member; click to expand. */
	_getStackRow (name, ids, ctx) {
		const {ui, labels} = ctx;
		const instances = ids.map(id => ctx.state.instances.find(it => it.id === id)).filter(Boolean);
		const summary = getCockpitStackSummary(instances, {
			getAc: it => ctx.getDerived(it)?.ac ?? getCockpitAcValue(ctx.getEffective(it)?.ac),
			getInit: it => ctx.initiativeOf(it),
			getLabel: it => labels.get(it.id),
		});
		const isTurn = ids.some(id => ctx.isTurn(id));
		const viewedId = ids.includes(ui.viewedId) ? ui.viewedId : null;
		const nSel = ids.filter(id => ui.selectedIds.includes(id)).length;
		const isAllSel = nSel === ids.length;
		const row = h(`li.ewc-row.ewc-row--stack${isTurn ? ".is-turn" : ""}${viewedId ? ".is-viewed" : ""}${isAllSel ? ".is-sel" : ""}`, {
			"data-ewc-stack": name,
			"aria-current": viewedId ? "true" : null,
		});
		row.addEventListener("click", evt => {
			if (evt.target.closest("button, input, label, a, .ewc-row__qa, .ewc-pop")) return;
			this._expandStack(name);
		});

		const check = h("label.ewc-row__chk", {title: `Select every ${name}`},
			h("input", {
				type: "checkbox",
				checked: isAllSel,
				indeterminate: nSel > 0 && !isAllSel,
				"data-ewc-fk": `selg-${name}`,
				"aria-label": `Select all ${name} (${ids.length})`,
				onclick: evt => {
					evt.preventDefault();
					this._cb.onGroupToggle(ids);
				},
			}),
		);
		const initCell = h("span.ewc-row__initc", null,
			h("span.ewc-row__init.ewc-row__init--static", {title: summary.isInitMixed ? "Members have different initiatives" : "Shared initiative"}, summary.init ?? "–"),
			isTurn ? h("span.ewc-row__turntag", {"aria-hidden": "true"}, "TURN") : null,
		);
		const main = h("div.ewc-row__main", null,
			h("button.ewc-row__name", {
				type: "button",
				"data-ewc-fk": `stack-${name}`,
				"aria-expanded": "false",
				title: `Stacked group — click to show each ${name} member`,
				onclick: () => this._expandStack(name),
			}, name, h("span.ewc-row__x", null, ` ×${ids.length}`)),
			h("span.ewc-row__cls", null, viewedId ? `viewing ${labels.get(viewedId)}` : "stacked"),
		);
		const right = h("div.ewc-row__right", null,
			h("span.ewc-row__hp", {"aria-label": summary.hp == null ? "Hit points not set" : `${summary.hp} of ${summary.hpMax} hit points in total`},
				`${summary.hp ?? "—"}`, h("small", null, `/${summary.hpMax ?? "—"}`)),
			h("span.ewc-row__ac", {title: `Armor Class ${summary.acs.join(" or ") || "unknown"}`}, `AC ${summary.acs.join("/") || "—"}`),
		);
		const slot = h("span.ewc-row__slot");
		const sub = h("div.ewc-row__sub", null,
			h("span.ewc-row__minis", {role: "list", "aria-label": "Member hit points"}, summary.minis.map(mini => h(`span.ewc-mini.${mini.cls}`, {
				role: "listitem",
				title: `${mini.label} ${mini.current ?? "—"}/${mini.max ?? "—"}`,
				"aria-label": `${mini.label} ${mini.current ?? "unknown"} of ${mini.max ?? "unknown"}`,
			}, h("i", {style: {"--p": (mini.fraction ?? 1).toFixed(3)}})))),
			slot,
		);
		row.append(check, initCell, main, right, sub);
		if (ctx.quickActions.length) {
			const qa = h("div.ewc-row__qa", {role: "group", "aria-label": `Quick actions for ${name}`},
				ctx.quickActions.map(action => h("button.ewc-qa", {
					type: "button",
					"data-ewc-fk": `sqa-${action.id}-${name}`,
					"data-ewc-qa": action.id,
					"data-ewc-stackqa": action.id,
					"aria-haspopup": "dialog",
					"aria-expanded": "false",
					"aria-label": `${action.title} on ${name} — pick all or one member`,
					title: `${action.title} on ${name} — pick all or one member`,
					onclick: evt => {
						evt.stopPropagation();
						if (this._popover?.id === `stack:${name}:${action.id}`) return this.closePopover();
						this._openStackPick(name, action, evt.currentTarget, {isFocus: true});
					},
				}, action.label)),
			);
			if (viewedId) row.append(qa);
			else slot.append(qa);
		}
		return row;
	}

	/** "Damage — which Goblins?": all of them (selected together) or one member. */
	_openStackPick (name, action, anchor, {isFocus}) {
		this.closePopover();
		const ctx = this._ctx;
		if (!ctx) return;
		const byId = new Map(ctx.state.instances.map(it => [it.id, it]));
		const members = ctx.orderIds.map(id => byId.get(id)).filter(it => it && it.customGroup === name && !it.defeated);
		if (!members.length) return;
		const ids = members.map(it => it.id);
		const verb = {damage: "Damage", heal: "Heal", cond: "Conditions"}[action.id] || action.label;
		const title = `${verb} — which ${name}?`;
		const pick = (id, text, extra, isPrimary = false) => h(`button.ewc-btn.ewc-btn--sm${isPrimary ? ".ewc-btn--primary" : ""}`, {
			type: "button",
			"data-ewc-spick": id,
			onclick: evt => {
				evt.stopPropagation();
				this.closePopover();
				if (id === "all") {
					this._cb.onSelectIds(ids);
					this._cb.onQuickAction(ids.includes(ctx.ui.viewedId) ? ctx.ui.viewedId : ids[0], action.id);
				} else this._cb.onQuickAction(id, action.id);
			},
		}, text, extra);
		const ele = h("div.ewc-pop.ewc-pop--stackpick", {role: "dialog", "aria-label": title, tabindex: "-1", "data-ewc-stackpick": name},
			h("div.ewc-pop__head", null, h("b", null, title)),
			h("div.ewc-stackpick", null,
				pick("all", `All ${ids.length}`, null, true),
				members.map(it => pick(it.id, ctx.labels.get(it.id), h("small", null, `${it.hp?.current ?? "—"}/${it.hp?.max ?? "—"}`))),
			),
		);
		ele.addEventListener("keydown", evt => {
			if (evt.key === "Escape") { evt.preventDefault(); evt.stopPropagation(); this.closePopover({isRestoreFocus: true}); }
		});
		anchor.closest(".ewc-row").append(ele);
		this._flipIfClipped(ele, anchor.closest(".ewc-row"));
		anchor.setAttribute("aria-expanded", "true");
		this._popover = {id: `stack:${name}:${action.id}`, ele, anchor, stackPick: {name, qa: action, fk: anchor.dataset.ewcFk}};
		if (isFocus) ele.querySelector("button")?.focus({preventScroll: true});
	}

	/** Open a row popover upward when the rail's scroll area would cut off its bottom and there is room above. */
	_flipIfClipped (ele, rowEle) {
		let clip = {top: 0, bottom: globalThis.innerHeight};
		for (let it = rowEle.parentElement; it; it = it.parentElement) {
			if (getComputedStyle(it).overflowY === "visible") continue;
			const rect = it.getBoundingClientRect();
			clip = {top: Math.max(clip.top, rect.top), bottom: Math.min(clip.bottom, rect.bottom)};
			break;
		}
		const pop = ele.getBoundingClientRect();
		const row = rowEle.getBoundingClientRect();
		if (pop.bottom > clip.bottom && row.top - pop.height >= clip.top) ele.classList.add("ewc-pop--up");
	}

	_getLegend (ui) {
		if (ui.selectedIds.length && !globalThis.localStorage?.getItem(LS_LEGEND_OFF)) {
			try { localStorage.setItem(LS_LEGEND_OFF, "1"); } catch (e) { /* storage unavailable */ }
		}
		if (globalThis.localStorage?.getItem(LS_LEGEND_OFF)) return null;
		const mod = getCockpitKeyLabel("mod", {isMac: this._isMac});
		return h("p.ewc-rail__legend", null,
			h("span.ewc-lg.ewc-lg--view", null, h("i"), "Viewed"),
			h("span.ewc-lg.ewc-lg--turn", null, h("i", null, "TURN"), "Turn"),
			h("span.ewc-lg.ewc-lg--sel", null, h("i"), "Selected"),
			h("span.ewc-lg__how", null, `Click a name to view · tick the box, ${mod}-click or Shift-click to select`),
		);
	}

	_getChips (ctx) {
		const sel = ctx.ui.selectedIds;
		const chips = ctx.groupChips.map((chip, ix) => {
			const isOn = chip.memberIds.every(id => sel.includes(id));
			return h("button.ewc-chip", {
				type: "button",
				"data-ewc-fk": `chip-${chip.key}`,
				"data-ewc-chip": chip.key,
				"aria-pressed": `${isOn}`,
				title: `${isOn ? "Unselect" : "Select"} ${chip.name}${ix < 9 ? ` (${ix + 1})` : ""}`,
				onclick: () => this._cb.onGroupToggle(chip.memberIds),
			}, chip.name, h("span.ewc-chip__n", null, `${chip.memberIds.length}`), ix < 9 ? kbd([`${ix + 1}`]) : null);
		});
		if (sel.length) {
			chips.push(h("button.ewc-chip.ewc-chip--clear", {
				type: "button",
				"data-ewc-fk": "chip-clear",
				title: "Clear selection (Esc)",
				onclick: () => this._cb.onClearSelection(),
			}, `Clear ${sel.length}`, kbd(["Esc"])));
		}
		if (!chips.length) return null;
		return h("div.ewc-rail__chips", {role: "group", "aria-label": "Select a group"}, chips);
	}

	_getRow (instance, ctx) {
		const {ui, labels} = ctx;
		const id = instance.id;
		const label = labels.get(id);
		const isSel = ui.selectedIds.includes(id);
		const isViewed = ui.viewedId === id;
		const isTurn = ctx.isTurn(id);
		const hpState = getCockpitHpState(instance.hp);
		const derived = ctx.getDerived(instance) || {};
		const effective = ctx.getEffective(instance);
		const acBase = getCockpitAcValue(effective?.ac);
		const ac = derived.ac ?? acBase;
		const initiative = ctx.initiativeOf(instance);

		const row = h(`li.ewc-row${isTurn ? ".is-turn" : ""}${isViewed ? ".is-viewed" : ""}${isSel ? ".is-sel" : ""}${instance.defeated ? ".is-defeated" : ""}.${hpState.cls}`, {
			"data-ewc-id": id,
			"aria-current": isViewed ? "true" : null,
		});
		row.addEventListener("click", evt => {
			if (evt.target.closest("button, input, label, a, .ewc-row__qa")) return;
			this._handleRowClick(evt, id);
		});

		const check = h("label.ewc-row__chk", {title: `Select (also ${getCockpitKeyLabel("mod", {isMac: this._isMac})}-click or Shift-click a row)`},
			h("input", {
				type: "checkbox",
				checked: isSel,
				"data-ewc-fk": `sel-${id}`,
				"aria-label": `Select ${label}`,
				onclick: evt => {
					evt.preventDefault();
					this._cb.onSelect(id, evt.shiftKey ? "range" : "toggle");
				},
			}),
		);

		const initCell = h("span.ewc-row__initc", null,
			this._editInitId === id ? this._getInitInput(instance, label, initiative) : h("button.ewc-row__init", {
				type: "button",
				"data-ewc-fk": `init-${id}`,
				title: `Initiative ${initiative ?? "—"} · click to type a new number`,
				"aria-label": `Initiative ${initiative ?? "none"} for ${label}${isTurn ? ", their turn" : ""}. Click to edit`,
				onclick: () => { this._editInitId = id; this._ctx && this.render(this._ctx); },
			}, initiative ?? "–"),
			isTurn ? h("span.ewc-row__turntag", {"aria-hidden": "true"}, "TURN") : null,
		);

		const name = h("button.ewc-row__name", {
			type: "button",
			"data-ewc-fk": `name-${id}`,
			"aria-pressed": isViewed ? "true" : "false",
			title: "View this creature's statblock",
			onclick: evt => this._handleRowClick(evt, id),
		}, label);
		this._hover.bindCreature(name, instance);
		const main = h("div.ewc-row__main", null, name, h("span.ewc-row__cls", null, this._getClassLine(effective, instance)));

		const hp = instance.hp || {};
		const right = h("div.ewc-row__right", null,
			h("span.ewc-row__hp", {"aria-label": hp.max == null ? "Hit points not set" : `${hp.current ?? "?"} of ${hp.max} hit points${hp.temp ? `, ${hp.temp} temporary` : ""}`},
				`${hp.current ?? "—"}`,
				hp.temp ? h("span.ewc-row__tmp", null, `+${hp.temp}`) : null,
				h("small", null, `/${hp.max ?? "—"}`),
			),
			h(`span.ewc-row__ac${ac !== acBase ? ".is-changed" : ""}`, {title: `Armor Class ${ac ?? "unknown"}`}, `AC ${ac ?? "—"}`),
		);

		const sub = this._getSubline(instance, ctx, {label, isViewed, hpState});
		row.append(check, initCell, main, right, sub);
		if (!instance.defeated && ctx.quickActions.length) {
			const qa = this._getQuickActions(instance, label, ctx);
			// Other rows overlay their actions inside the pills slot, which ends where the effect tally begins.
			if (isViewed) row.append(qa);
			else sub.querySelector(".ewc-row__slot").append(qa);
		}
		(ctx.rowDecorators || []).forEach(fn => {
			try {
				fn(row, instance, ctx);
			} catch (e) {
				setTimeout(() => { throw e; });
			}
		});
		return row;
	}

	_handleRowClick (evt, id) {
		const isMod = this._isMac ? evt.metaKey : evt.ctrlKey;
		if (evt.shiftKey) return this._cb.onSelect(id, "range");
		if (isMod) return this._cb.onSelect(id, "toggle");
		this._cb.onView(id);
	}

	_getClassLine (effective, instance) {
		if (instance.kind === "party") return "Party";
		const cr = getCockpitCrText(effective?.cr);
		return cr ? `CR ${cr}` : "";
	}

	_getInitInput (instance, label, initiative) {
		const input = h("input.ewc-row__initin", {
			value: initiative ?? "",
			inputmode: "numeric",
			"data-ewc-fk": `initin-${instance.id}`,
			"aria-label": `Initiative for ${label} — Enter to set, Esc to cancel`,
		});
		let isDone = false;
		const commit = () => {
			if (isDone) return;
			isDone = true;
			this._editInitId = null;
			const raw = input.value.trim();
			const total = raw === "" ? null : /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN;
			if (total === initiative || (total !== null && !Number.isSafeInteger(total))) return this._ctx && this.render(this._ctx);
			this._cb.onSetInitiative(instance.id, total);
		};
		input.addEventListener("keydown", evt => {
			if (evt.key === "Enter") { evt.preventDefault(); commit(); }
			if (evt.key === "Escape") {
				evt.preventDefault();
				evt.stopPropagation();
				isDone = true;
				this._editInitId = null;
				this._ctx && this.render(this._ctx);
				this._root.querySelector(`[data-ewc-fk="init-${CSS.escape(instance.id)}"]`)?.focus();
			}
		});
		input.addEventListener("blur", () => commit());
		requestAnimationFrame(() => { if (input.isConnected && document.activeElement !== input) { input.focus(); input.select(); } });
		return input;
	}

	_getSubline (instance, ctx, {label, isViewed, hpState}) {
		const sub = h("div.ewc-row__sub");
		if (hpState.fraction != null) {
			sub.append(h(`span.ewc-row__bar.${hpState.cls}`, {"aria-hidden": "true"}, h("i", {style: {"--p": hpState.fraction.toFixed(3)}})));
		}
		if (hpState.word === "Bloodied" || hpState.word === "Down") sub.append(h(`span.ewc-row__state.${hpState.cls}`, null, hpState.word));
		if (instance.defeated) sub.append(h("span.ewc-row__state.is-down", null, "Defeated"));

		const conc = instance.resources?.concentration?.active;
		if (conc) {
			const concLabel = instance.resources.concentration.label;
			sub.append(h("button.ewc-row__conc", {
				type: "button",
				"data-ewc-fk": `conc-${instance.id}`,
				title: concLabel ? `Concentrating on ${concLabel}` : "Concentrating",
				"aria-label": `Concentrating${concLabel ? ` on ${concLabel}` : ""} — view ${label}`,
				onclick: () => this._cb.onView(instance.id),
			}, "◉ Conc", concLabel ? h("span", null, ` · ${concLabel}`) : null));
		}

		const conditions = instance.conditions || [];
		const items = ctx.effectItems(instance) || [];
		if (isViewed) {
			// The viewed row names everything; there is room and the statblock beside it has the details.
			conditions.forEach(cond => sub.append(this._getConditionPill(cond, instance, ctx)));
			items.filter(it => !it.wide).forEach(item => sub.append(this._getEffectPill(item, instance)));
			return sub;
		}
		const {shown, more} = getCockpitConditionPills(conditions, {max: conc ? 2 : 3});
		const pills = h("span.ewc-row__pills", null, shown.map(cond => this._getConditionPill(cond, instance, ctx)));
		if (more) pills.append(h("span.ewc-pill.ewc-pill--more", {title: `${getCockpitPlural(more, "more condition")} — view the creature to see all`}, `+${more}`));
		sub.append(h("span.ewc-row__slot", null, shown.length || more ? pills : null));
		const tally = getCockpitTally(items);
		if (tally) sub.append(this._getTallyButton(instance, label, tally));
		return sub;
	}

	_getConditionPill (condition, instance, ctx) {
		const details = instance.conditionDetails?.[condition];
		const level = condition.toLowerCase() === "exhaustion" ? Number(details?.level) || 1 : null;
		const pill = h("span.ewc-pill.ewc-pill--cond", {
			tabindex: "0",
			style: ctx.getConditionColor ? {"--ewc-cond": ctx.getConditionColor(condition)} : null,
		}, condition.toTitleCase(), level ? ` ${level}` : null, details?.rounds != null ? h("small", null, ` ${details.rounds}r`) : null);
		this._hover.bindCondition(pill, condition, {conditionCatalog: ctx.conditionCatalog});
		return pill;
	}

	_getEffectPill (item, instance) {
		const glyph = COCKPIT_TALLY_BUCKETS.find(([k]) => k === item.k)?.[1] || "•";
		const pill = h(`span.ewc-pill.ewc-pill--fx.ewc-pill--${item.k}`, {tabindex: "0"},
			h("span", {"aria-hidden": "true"}, `${glyph} `), item.label, item.rounds != null ? h("small", null, ` ${item.rounds}r`) : null);
		const effect = item.source === "effect" ? (instance.effects || []).find(it => it.id === item.id) : null;
		if (effect) this._hover.bindEffect(pill, instance, effect);
		else if (item.hoverEntry) this._hover.bindEntry(pill, `item:${instance.id}:${item.k}:${item.id}`, item.hoverEntry);
		return pill;
	}

	_getTallyButton (instance, label, tally) {
		const btn = h("button.ewc-tally", {
			type: "button",
			"data-ewc-fk": `tally-${instance.id}`,
			"data-ewc-tally": instance.id,
			"aria-haspopup": "dialog",
			"aria-expanded": "false",
			"aria-label": `${label}: ${tally.words.join(", ")} — show the list`,
			onclick: evt => {
				evt.stopPropagation();
				if (this._popover?.id === instance.id) return this.closePopover();
				this._openTally(instance.id, btn, {isFocus: true});
			},
		}, tally.parts.map(part => h(`b.ewc-tally__n.ewc-tally__n--${part.k}${part.isSoon ? ".is-soon" : ""}`, null, part.text)));
		return btn;
	}

	_openTally (id, anchor, {isFocus}) {
		this.closePopover();
		const ctx = this._ctx;
		const instance = ctx?.state.instances.find(it => it.id === id);
		if (!instance) return;
		const label = ctx.labels.get(id);
		const items = (ctx.effectItems(instance) || []).filter(it => !it.wide);
		const order = {up: 0, down: 1, bf: 2, tpl: 3};
		items.sort((a, b) => (order[a.k] ?? 9) - (order[b.k] ?? 9) || (a.rounds ?? 999) - (b.rounds ?? 999));
		const list = h("ul.ewc-tc", null, items.map(item => {
			const glyph = COCKPIT_TALLY_BUCKETS.find(([k]) => k === item.k)?.[1] || "•";
			const src = item.sourceText || (item.k === "tpl" ? "Template" : item.k === "bf" ? "Battlefield" : "Effect");
			const name = h("b", {tabindex: "0"}, item.label);
			const effect = item.source === "effect" ? (instance.effects || []).find(it => it.id === item.id) : null;
			if (effect) this._hover.bindEffect(name, instance, effect);
			return h(`li.ewc-tc__i.ewc-tc__i--${item.k}`, null,
				h("span.ewc-tc__g", {"aria-hidden": "true"}, glyph),
				h("span.ewc-tc__t", null, name, h("small", null, `${src} · ${item.rounds != null ? `${item.rounds}r left` : "until removed"}`)),
				this._cb.onEndEffect && item.source === "effect"
					? h("button.ewc-tc__rm", {
						type: "button",
						"aria-label": `End ${item.label} on ${label}`,
						title: `End on ${label}`,
						onclick: () => { this.closePopover(); this._cb.onEndEffect(id, item); },
					}, "×")
					: null,
			);
		}));
		const ele = h("div.ewc-pop", {role: "dialog", "aria-label": `${label} · effects`, tabindex: "-1"},
			h("div.ewc-pop__head", null, h("b", null, `${label} · effects`), h("span.ewc-muted", null, getCockpitPlural(items.length, "effect"))),
			list,
			h("p.ewc-pop__foot.ewc-muted", null, "Conditions stay named on the row · view the creature for every pill"),
		);
		ele.addEventListener("keydown", evt => {
			if (evt.key === "Escape") { evt.preventDefault(); evt.stopPropagation(); this.closePopover({isRestoreFocus: true}); }
		});
		const row = anchor.closest(".ewc-row");
		row.append(ele);
		anchor.setAttribute("aria-expanded", "true");
		this._popover = {id, ele, anchor};
		if (isFocus) ele.focus({preventScroll: true});
	}

	_getQuickActions (instance, label, ctx) {
		return h("div.ewc-row__qa", {role: "group", "aria-label": `Quick actions for ${label}`},
			ctx.quickActions.map(qa => h("button.ewc-qa", {
				type: "button",
				"data-ewc-fk": `qa-${qa.id}-${instance.id}`,
				"data-ewc-qa": qa.id,
				"aria-label": `${qa.title} on ${label}`,
				title: `${qa.title} on ${label}`,
				onclick: () => this._cb.onQuickAction(instance.id, qa.id),
			}, qa.label)),
		);
	}
}
