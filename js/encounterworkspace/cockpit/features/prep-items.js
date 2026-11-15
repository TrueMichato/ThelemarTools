/**
 * P3b — the Items tab, kept modest: list the magic items applied to the targets (hoverable, removable) and open the
 * Bestiary Quick Actions item picker to give one.
 */

import {h} from "../dom.js";
import {EncounterWorkspaceState} from "../../encounterworkspace-state.js";
import {PREP_EDITOR_SECTIONS, pOpenPrepStatblockEditor} from "./prep-editor.js";
import {acts, btn, lbl, muted, scopeSeg, tip} from "./prep-ui.js";

/** [{instanceId, label, opId, name, source}] for every applied magic item on the given creatures. */
export function getPrepItemRows (state, ids, {labels = null} = {}) {
	const only = new Set(ids);
	return state.instances
		.filter(it => only.has(it.id))
		.flatMap(inst => (inst.statblockOperations || [])
			.filter(op => op.type === "applyItem" && op.data?.item?.name)
			.map(op => ({instanceId: inst.id, label: labels?.get(inst.id) || inst.monster.name, opId: op.id, name: op.data.item.name, source: op.data.item.source || null})));
}

async function pRemoveItem (api, row) {
	const label = `Remove ${row.name} from ${row.label}`;
	const next = await api.pCommit(label, state => EncounterWorkspaceState.withStatblockChanges(state, [{id: row.instanceId, removeIds: [row.opId], addOperations: []}]).state);
	if (next) api.toast(`${label}.`, {isUndo: true});
}

function itemName (api, row) {
	const ele = h("span.ewc-prep__fxn", {tabindex: "0"}, row.name);
	if (row.source && typeof UrlUtil !== "undefined") {
		api.hover.bindLink(ele, {page: UrlUtil.PG_ITEMS, source: row.source, hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS]({name: row.name, source: row.source})});
	}
	return ele;
}

export function renderPrepItemsTab (P) {
	const {api, ctx} = P;
	const ids = P.getTargetIds();
	const rows = getPrepItemRows(ctx.state, ids, {labels: ctx.labels});
	const viewed = ctx.ui.viewedId;
	const isParty = ctx.state.instances.find(it => it.id === viewed)?.kind === "party";
	return [
		scopeSeg(P),
		lbl("Magic items on them"),
		rows.length
			? h("ul.ewc-prep__fx", {"aria-label": "Magic items"}, rows.map(row => h("li", {dataset: {ewcItemRow: `${row.instanceId}|${row.opId}`}},
				itemName(api, row),
				ids.length > 1 ? h("span.ewc-muted.ewc-prep__fxw", null, row.label) : null,
				btn("Remove", () => pRemoveItem(api, row), {key: `item-rm-${row.opId}`, kind: "link", ariaLabel: `Remove ${row.name} from ${row.label}`}),
			)))
			: muted(ids.length ? "No magic items applied yet." : "View or select a creature to see its items."),
		acts(
			btn("Give an item…", () => pOpenPrepStatblockEditor(api, viewed, {section: PREP_EDITOR_SECTIONS.item, label: "Give an item"}), {key: "item-give", kind: "primary", disabled: !viewed || isParty, title: isParty ? "Party members keep their items on their character sheet" : null}),
		),
		tip("Items really change the viewed creature's statblock — bonuses, attacks and charges show up where they belong. Undo removes them."),
	];
}
