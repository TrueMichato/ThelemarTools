/** P3c — groups: create a group from the selection (G), rename, add to, set or roll one initiative, share a turn, ungroup. */
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
	withEncounterUngroup,
} from "../../encounterworkspace-groups-v8.js";
import {getFlowGroupNameSuggestion, getFlowNewIds} from "./flow-model.js";
import {getFlowPlural, isolateFlowKeys} from "./flow-util.js";

const getMonsterName = it => it.monster?._displayName || it.monster?.name || "";

export function installFlowGroups (api) {
	let dlg = null;
	/** {ids, anchor} while the dialog is open. */
	let open = null;

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
			h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
				type: "button",
				"data-ewc-flow": "group-open",
				"data-ewc-fk": "group-open",
				title: same ? `Rename ${same}, set its initiative or ungroup` : "Group the selected creatures",
				"aria-haspopup": "dialog",
				onclick: evt => pOpen([...ctx.ui.selectedIds], evt.currentTarget),
			}, "Group…", kbd(["G"])),
		);
	});

	/** Every id is in the same custom group → that group's name. */
	function getSharedGroup (state, ids) {
		const groups = new Set(ids.map(id => state.instances.find(it => it.id === id)?.customGroup || null));
		const [only] = groups;
		return groups.size === 1 && only ? only : null;
	}

	function pOpen (ids, anchor) {
		if (!dlg) {
			dlg = isolateFlowKeys(h("dialog.ewc-dialog.ewc-grp", {"aria-labelledby": "ewc-grp-title", "data-ewc-flow": "group-dialog"}));
			dlg.addEventListener("click", evt => { if (evt.target === dlg) dlg.close(); });
			dlg.addEventListener("close", () => {
				const back = open?.anchor;
				open = null;
				if (back?.isConnected) back.focus();
				else api.getRegion("layer")?.parentElement?.querySelector("[data-ewc-fk='group-open']")?.focus();
			});
			api.getRegion("layer").append(dlg);
		}
		open = {ids, anchor};
		render();
		if (!dlg.open) dlg.showModal();
		place();
		const field = dlg.querySelector("input");
		field?.focus();
		field?.select?.();
	}

	function place () {
		const a = open?.anchor;
		if (!a?.isConnected) {
			dlg.style.removeProperty("margin");
			dlg.style.removeProperty("left");
			dlg.style.removeProperty("top");
			return;
		}
		const r = a.getBoundingClientRect();
		dlg.style.margin = "0";
		dlg.style.left = `${Math.max(8, Math.min(innerWidth - dlg.offsetWidth - 8, r.left))}px`;
		dlg.style.top = `${Math.max(8, Math.min(innerHeight - dlg.offsetHeight - 8, r.bottom + 6))}px`;
	}

	const close = () => dlg?.open && dlg.close();

	async function pDo (label, recipe, toastText) {
		const next = await api.pCommit(label, recipe);
		if (!next) return false;
		if (toastText) api.toast(typeof toastText === "function" ? toastText(next) : toastText, {isUndo: true});
		close();
		return true;
	}

	function render () {
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
				pDo(`${same} initiative`, draft => withEncounterGroupInitiative(draft, {name: same, total}), `${same}: initiative ${total} for all ${members.length}`);
			};
			const doRoll = async () => {
				let roll;
				const ok = await pDo(`Roll ${same} initiative`, draft => {
					const res = rollEncounterGroupInitiative(draft, {name: same, getContributors: getCockpitContributorGetter(draft, api.getSettings())});
					roll = res.roll;
					return res.state;
				});
				if (ok && roll) {
					api.toast(`${same} rolled ${roll.text} — one initiative for all ${members.length}`, {isUndo: true});
					api.engine.pLog("roll", `${same} initiative ${roll.text} (shared by ${getFlowPlural(members.length, "creature")})`).catch(() => {});
				}
			};
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
		foot.push(h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "group-close", onclick: close}, "Close", kbd(["Esc"])));

		dlg.replaceChildren(
			h("div.ewc-dialog__head", null,
				h("h2.ewc-dialog__title.ewc-grp__title", {id: "ewc-grp-title"}, `${getFlowPlural(ids.length, "creature")}${same ? ` · ${same}` : " selected"}`),
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
		if (open && dlg?.open) render();
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
