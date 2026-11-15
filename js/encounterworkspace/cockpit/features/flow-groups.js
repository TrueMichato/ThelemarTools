/**
 * P3c — groups: create a group from the selection (G), rename, add to, set or roll one initiative, share a turn, ungroup.
 * The group menu is a non-modal popover anchored to the button that opened it (A6 mockup), so the rail stays usable.
 * The rail's Groups view calls back here for its per-group header (shared initiative, roll once, stack, rename).
 */
import {h, kbd} from "../dom.js";
import {getCockpitContributorGetter} from "../rules.js";
import {
	getEncounterCustomGroupNames,
	getEncounterGroupMembers,
	getEncounterGroupMeta,
	getEncounterGroupPlural,
	getEncounterGroupsV8,
	rollEncounterGroupInitiative,
	withEncounterAutoGroup,
	withEncounterCustomGroup,
	withEncounterGroupInitiative,
	withEncounterGroupRename,
	withEncounterGroupSharedTurn,
	withEncounterGroupStack,
	withEncounterUngroup,
} from "../../encounterworkspace-groups-v8.js";
import {getFlowGroupNameSuggestion, getFlowNewIds} from "./flow-model.js";
import {getFlowPlural, isolateFlowKeys} from "./flow-util.js";

const getMonsterName = it => it.monster?._displayName || it.monster?.name || "";

export function installFlowGroups (api) {
	let dlg = null;
	/** {ids, anchor, rename?} while the popover is open; `rename` is a group name for the header's rename-only mode. */
	let open = null;
	const isOpen = () => !!(open && dlg && !dlg.hidden);

	const getTargetIds = () => {
		const {selectedIds, viewedId} = api.getUi();
		return selectedIds.length ? [...selectedIds] : viewedId ? [viewedId] : [];
	};

	api.registerKey({
		section: "View & select",
		keys: ["G"],
		label: "Group the selection (create, rename, initiative, ungroup)",
		action: "flow:group",
		run: () => {
			const ids = getTargetIds();
			if (!ids.length) return false;
			pOpen(ids, null);
			return true;
		},
	});

	api.addRailTop(ctx => {
		const n = ctx.ui.selectedIds.length;
		if (!n) return null;
		const same = getSharedGroup(ctx.state, ctx.ui.selectedIds);
		return h("div.ewc-grpbar", {"data-ewc-flow": "group-bar"},
			h("span.ewc-grpbar__n", null, `${getFlowPlural(n, "creature")} selected${same ? ` · ${same}` : ""}`),
		);
	});

	// Always in the rail head: disabled only when there is nothing to group (no selection and nobody viewed).
	api.addRailHead(ctx => {
		const {selectedIds, viewedId} = ctx.ui;
		const ids = selectedIds.length ? selectedIds : viewedId && ctx.state.instances.some(it => it.id === viewedId) ? [viewedId] : [];
		const same = ids.length ? getSharedGroup(ctx.state, ids) : null;
		const title = !ids.length
			? "Select creatures first, then Group… (G)"
			: selectedIds.length
				? (same ? `Rename ${same}, set its initiative or ungroup (G)` : `Group the ${getFlowPlural(ids.length, "selected creature")} — create, add to or ungroup (G)`)
				: `Group ${ctx.labels.get(viewedId) || "the viewed creature"} — or tick several creatures first (G)`;
		return h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost.ewc-grpbtn", {
			type: "button",
			"data-ewc-flow": "group-open",
			"data-ewc-fk": "group-open",
			disabled: !ids.length,
			title,
			"aria-haspopup": "dialog",
			"aria-expanded": `${isOpen() && !open.rename}`,
			onclick: evt => {
				if (isOpen() && !open.rename) return close();
				pOpen([...ids], evt.currentTarget);
			},
		}, "Group…", kbd(["G"]));
	});

	api.setGroupHandlers({
		pSetInit: (name, total) => pSetInit(name, total),
		pRoll: name => pRoll(name),
		pStack: (name, isStacked) => pDo(isStacked ? `Stack ${name}` : `Unstack ${name}`, draft => withEncounterGroupStack(draft, {name, isStacked}), next => {
			if (!isStacked) return `${name} unstacked`;
			return isTurnsAdjacent(next, name) ? `${name} stacked into one row` : `${name} stacked in the Groups view. Their turns aren't together, so initiative order keeps one row each until they share an initiative (Roll once).`;
		}),
		openRename: (name, anchor) => pOpen([], anchor, {rename: name}),
		close: () => close({isRestoreFocus: true}),
	});

	document.addEventListener("pointerdown", evt => {
		if (!isOpen() || dlg.contains(evt.target)) return;
		if (open.anchor?.contains?.(evt.target) || evt.target.closest?.("[data-ewc-flow='group-open']")) return;
		close();
	});

	/** Every id is in the same custom group → that group's name. */
	function getSharedGroup (state, ids) {
		const groups = new Set(ids.map(id => state.instances.find(it => it.id === id)?.customGroup || null));
		const [only] = groups;
		return groups.size === 1 && only ? only : null;
	}

	/** Initiative view only folds a stack whose live members take consecutive turns (see getCockpitRailItems). */
	function isTurnsAdjacent (state, name) {
		const byId = new Map(state.instances.map(it => [it.id, it]));
		const live = api.getCtx().orderIds.filter(id => byId.get(id) && !byId.get(id).defeated);
		const pos = live.map((id, ix) => byId.get(id).customGroup === name ? ix : -1).filter(ix => ix >= 0);
		return pos.every((p, ix) => p === pos[0] + ix);
	}

	const getGroupButton = () => api.getRegion("layer")?.parentElement?.querySelector("[data-ewc-flow='group-open']");

	function pOpen (ids, anchor, {rename = null} = {}) {
		if (!dlg) {
			dlg = isolateFlowKeys(h("div.ewc-grp", {role: "dialog", "aria-labelledby": "ewc-grp-title", "data-ewc-flow": "group-dialog", hidden: true}));
			dlg.addEventListener("keydown", evt => {
				if (evt.key !== "Escape") return;
				evt.preventDefault();
				close({isRestoreFocus: true});
			});
			api.getRegion("layer").append(dlg);
		}
		open = {ids, anchor: anchor || getGroupButton(), rename};
		render();
		dlg.hidden = false;
		place();
		getGroupButton()?.setAttribute("aria-expanded", `${!rename}`);
		const field = dlg.querySelector("input");
		field?.focus();
		field?.select?.();
	}

	/** Below its anchor (the Group… button, or the header's Rename), kept inside the window. */
	function place () {
		const a = open?.anchor?.isConnected ? open.anchor : getGroupButton();
		const r = a?.getBoundingClientRect();
		const left = r ? r.left : (innerWidth - dlg.offsetWidth) / 2;
		const top = r ? r.bottom + 6 : 80;
		dlg.style.left = `${Math.max(8, Math.min(innerWidth - dlg.offsetWidth - 8, left))}px`;
		dlg.style.top = `${Math.max(8, Math.min(innerHeight - dlg.offsetHeight - 8, top))}px`;
	}

	/** Returns true if the popover was open (so Esc does one thing at a time). */
	function close ({isRestoreFocus = false} = {}) {
		if (!isOpen()) return false;
		const back = open.anchor;
		const hadFocus = dlg.contains(document.activeElement);
		dlg.hidden = true;
		open = null;
		getGroupButton()?.setAttribute("aria-expanded", "false");
		if (isRestoreFocus || hadFocus) {
			(back?.isConnected ? back : getGroupButton())?.focus();
		}
		return true;
	}

	async function pDo (label, recipe, toastText) {
		const next = await api.pCommit(label, recipe);
		if (!next) return false;
		if (toastText) api.toast(typeof toastText === "function" ? toastText(next) : toastText, {isUndo: true});
		close();
		return true;
	}

	function pSetInit (name, total) {
		const n = getEncounterGroupMembers(api.getState(), name).length;
		return pDo(`${name} initiative`, draft => withEncounterGroupInitiative(draft, {name, total}), `${name}: initiative ${total} for all ${n}`);
	}

	async function pRoll (name) {
		const n = getEncounterGroupMembers(api.getState(), name).length;
		let roll;
		const ok = await pDo(`Roll ${name} initiative`, draft => {
			const res = rollEncounterGroupInitiative(draft, {name, getContributors: getCockpitContributorGetter(draft, api.getSettings())});
			roll = res.roll;
			return res.state;
		});
		if (ok && roll) {
			api.toast(`${name} rolled ${roll.text} — one initiative for all ${n}`, {isUndo: true});
			api.engine.pLog("roll", `${name} initiative ${roll.text} (shared by ${getFlowPlural(n, "creature")})`).catch(() => {});
		}
		return ok;
	}

	function renderRename (from) {
		if (!getEncounterGroupMembers(api.getState(), from).length) return close();
		const field = h("input.ewc-input", {type: "text", value: from, "data-ewc-flow": "group-name", "aria-label": `New name for ${from}`, onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); doRename(); } }});
		const doRename = () => {
			const to = field.value.trim();
			if (!to || to === from) return close({isRestoreFocus: true});
			pDo(`Rename ${from}`, draft => withEncounterGroupRename(draft, {from, to}), `${from} renamed to ${to}`);
		};
		dlg.replaceChildren(
			h("div.ewc-grp__head", null, h("h2.ewc-grp__title", {id: "ewc-grp-title"}, `Rename ${from}`)),
			h("div.ewc-grp__sec", null,
				h("div.ewc-grp__line", null, field, h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary", {type: "button", "data-ewc-flow": "group-rename", onclick: doRename}, "Rename")),
			),
			h("div.ewc-grp__foot", null, h("span.ewc-grow"), h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "group-close", onclick: () => close({isRestoreFocus: true})}, "Cancel", kbd(["Esc"]))),
		);
	}

	function render () {
		if (open.rename) return renderRename(open.rename);
		const state = api.getState();
		const ids = open.ids.filter(id => state.instances.some(it => it.id === id));
		if (!ids.length) return close();
		const instances = ids.map(id => state.instances.find(it => it.id === id));
		const same = getSharedGroup(state, ids);
		const existing = getEncounterCustomGroupNames(state).filter(name => name !== same);
		const isGrouped = instances.some(it => it.customGroup && it.kind !== "party");
		const sections = [];

		if (same) {
			const members = getEncounterGroupMembers(state, same);
			const meta = getEncounterGroupMeta(state, same);
			const row = getEncounterGroupsV8(state).find(it => it.kind === "custom" && it.name === same);
			const inits = new Set(members.map(it => it.initiative));
			const initVal = meta.sharedInit ?? (inits.size === 1 ? members[0].initiative ?? "" : "");
			const fRename = h("input.ewc-input", {type: "text", value: same, "data-ewc-flow": "group-name", "aria-label": `Rename ${same}`, onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); doRename(); } }});
			const fInit = h("input.ewc-input.ewc-input--num", {type: "text", inputmode: "numeric", value: `${initVal}`, placeholder: "e.g. 14", "data-ewc-flow": "group-init", "aria-label": `Initiative for all of ${same}`, onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); doInit(); } }});
			const doRename = () => {
				const to = fRename.value.trim();
				if (!to || to === same) return close();
				pDo(`Rename ${same}`, draft => withEncounterGroupRename(draft, {from: same, to}), `${same} renamed to ${to}`);
			};
			const doInit = () => {
				const total = Number(fInit.value.trim());
				if (!fInit.value.trim() || !Number.isSafeInteger(total)) {
					fInit.setCustomValidity("Type a whole number");
					fInit.reportValidity();
					return;
				}
				pSetInit(same, total);
			};
			const doRoll = () => pRoll(same);
			const isShared = !!row?.sharedTurnId;
			sections.push(
				h("div.ewc-grp__sec", null,
					h("label.ewc-grp__lbl", null, `Rename ${same}`),
					h("div.ewc-grp__line", null, fRename, h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-flow": "group-rename", onclick: doRename}, "Rename")),
				),
				h("div.ewc-grp__sec", null,
					h("label.ewc-grp__lbl", null, `Initiative number for all ${members.length}`),
					h("p.ewc-grp__hint", null, "Sets the number they roll at; they then act back to back. To move them in the order instead, drag ⋮⋮."),
					h("div.ewc-grp__line", null,
						fInit,
						h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-flow": "group-setinit", onclick: doInit}, "Set initiative"),
						h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "group-roll", title: "One d20 plus the best initiative bonus in the group", onclick: doRoll}, "🎲 Roll once"),
					),
				),
				h("div.ewc-grp__sec", null,
					h("label.ewc-check", {title: "Every member takes its actions during one shared turn (only for identical statblocks)"},
						h("input", {type: "checkbox",
							checked: isShared,
							"data-ewc-flow": "group-shared",
							onchange: evt => {
								const want = evt.currentTarget.checked;
								pDo(want ? `${same} share a turn` : `${same} take separate turns`, draft => withEncounterGroupSharedTurn(draft, {name: same, isShared: want}), want ? `${same} now act on one shared turn` : `${same} now take separate turns`)
									.then(ok => { if (!ok) render(); });
							}}),
						"Act on one shared turn",
					),
				),
			);
		} else {
			const fName = h("input.ewc-input", {
				type: "text",
				"data-ewc-flow": "group-name",
				"aria-label": "New group name",
				value: getFlowGroupNameSuggestion(instances, {getName: getMonsterName, getPlural: getEncounterGroupPlural, existing: [...getEncounterCustomGroupNames(state), ...state.instances.map(it => it.id)]}),
				onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); doCreate(); } },
			});
			const doCreate = () => {
				const name = fName.value.trim();
				if (!name) return fName.focus();
				pDo(`Group ${name}`, draft => withEncounterCustomGroup(draft, {ids, name}), `Grouped ${getFlowPlural(ids.length, "creature")} as ${name}`)
					.then(ok => { if (ok) api.setSelection(ids); });
			};
			sections.push(h("div.ewc-grp__sec", null,
				h("label.ewc-grp__lbl", null, "New group"),
				h("div.ewc-grp__line", null, fName, h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary", {type: "button", "data-ewc-flow": "group-create", onclick: doCreate}, "Create group")),
			));
		}

		if (existing.length) {
			const fTo = h("select.ewc-input", {"data-ewc-flow": "group-to", "aria-label": "Existing group"}, existing.map(name => h("option", {value: name}, name)));
			sections.push(h("div.ewc-grp__sec", null,
				h("label.ewc-grp__lbl", null, "Add to existing"),
				h("div.ewc-grp__line", null, fTo, h("button.ewc-btn.ewc-btn--sm", {type: "button",
					"data-ewc-flow": "group-add",
					onclick: () => {
						const to = fTo.value;
						pDo(`Add to ${to}`, draft => withEncounterCustomGroup(draft, {ids, name: to}), `Added ${getFlowPlural(ids.length, "creature")} to ${to}`);
					}}, "Add to group")),
			));
		}

		const foot = [h("span.ewc-grow")];
		if (isGrouped) {
			foot.unshift(h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button",
				"data-ewc-flow": "group-ungroup",
				onclick: () => {
					pDo("Ungroup", draft => withEncounterUngroup(draft, {ids}), `Ungrouped ${getFlowPlural(ids.length, "creature")}`);
				}}, "Ungroup selected"));
		}
		foot.push(h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "group-close", onclick: () => close({isRestoreFocus: true})}, "Close", kbd(["Esc"])));

		dlg.replaceChildren(
			h("div.ewc-grp__head", null,
				h("h2.ewc-grp__title", {id: "ewc-grp-title"}, `${getFlowPlural(ids.length, "creature")}${same ? ` · ${same}` : " selected"}`),
			),
			h("p.ewc-grp__who", null, instances.map(it => api.getCtx().labels.get(it.id) || getMonsterName(it)).join(", ")),
			...sections,
			h("div.ewc-grp__foot", null, foot),
		);
	}

	// Creatures added later join their kind's group (two or more of a kind form one). Loads and list swaps don't count.
	let knownIds = api.getState().instances.map(it => it.id);
	let isAutoGrouping = false;
	api.engine.subscribe((next, meta) => {
		const ids = next.instances.map(it => it.id);
		const fresh = getFlowNewIds(knownIds, ids);
		knownIds = ids;
		if (isOpen()) render();
		// Only fresh commits: undo/redo restore earlier groupings, and "replace" is a different encounter.
		if (!fresh.length || isAutoGrouping || meta?.type !== "commit") return;
		const probe = withEncounterAutoGroup(next, fresh);
		if (!probe.grouped.length) return;
		isAutoGrouping = true;
		api.pCommit("Auto-group", draft => withEncounterAutoGroup(draft, fresh).state)
			.then(res => {
				if (res) api.toast(probe.grouped.map(g => `${getFlowPlural(g.ids.length, "creature")} joined ${g.name}`).join(" · "), {isUndo: true});
			})
			.finally(() => { isAutoGrouping = false; });
	});
}
