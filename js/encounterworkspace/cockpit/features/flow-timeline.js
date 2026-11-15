/** P3c — the timeline stage mode (T): the round as a flow of turns, with HP, conditions, effects and concentration. */
import {h, kbd} from "../dom.js";
import {getCockpitAcValue} from "../model.js";
import {getCockpitSpellHoverMeta} from "../hover.js";
import {getEncounterConcentration} from "../../encounterworkspace-fx.js";
import {getFlowTimelineModel, getFlowTimelineSpans} from "./flow-model.js";
import {bindFlowConcentration} from "./flow-util.js";

const MODE_ID = "timeline";

export function installFlowTimeline (api) {
	const toggle = () => api.setStageMode(api.getStageMode() === MODE_ID ? "statblock" : MODE_ID);

	api.registerStageMode({id: MODE_ID, label: "Timeline", keys: ["T"], render: (el, ctx) => renderTimeline(api, el, ctx, toggle)});
	api.registerKey({section: "View & select", keys: ["T"], label: "Timeline ↔ statblock view", action: "flow:timeline", run: () => { toggle(); }});
	// List | Timeline: which view fills the stage. T toggles between the two.
	api.addBarItem(ctx => {
		if (!ctx.state.instances.length) return null;
		const isOn = ctx.stageMode === MODE_ID;
		const isList = ctx.stageMode === "statblock";
		return h("div.ewc-seg.ewc-flow-view", {role: "group", "aria-label": "View"},
			h("button.ewc-seg__b", {
				type: "button",
				"aria-pressed": `${isList}`,
				"data-ewc-flow": "list",
				title: "List view: initiative order and statblock (T)",
				onclick: () => api.setStageMode("statblock"),
			}, "List"),
			h("button.ewc-seg__b", {
				type: "button",
				"aria-pressed": `${isOn}`,
				"aria-keyshortcuts": "T",
				"data-ewc-flow": "timeline",
				title: "Timeline view: the round as lanes, with effect spans (T)",
				onclick: () => api.setStageMode(MODE_ID),
			}, "Timeline", kbd(["T"])),
		);
	});
}

function renderTimeline (api, el, ctx, toggle) {
	const {state} = ctx;
	const round = state.turn?.round || 0;
	const ids = ctx.orderIds.filter(id => !state.instances.find(it => it.id === id)?.defeated);
	const byId = new Map(state.instances.map(it => [it.id, it]));
	const itemsById = new Map();
	const lanes = ids.map(id => {
		const instance = byId.get(id);
		const items = ctx.effectItems(instance);
		itemsById.set(id, items);
		const derived = ctx.getDerived(instance) || {};
		return {
			id,
			label: ctx.labels.get(id) || instance.monster?.name || id,
			hp: instance.hp?.current,
			hpMax: instance.hp?.max,
			temp: instance.hp?.temp || 0,
			ac: derived.ac ?? getCockpitAcValue(ctx.getEffective(instance)?.ac),
			conc: getEncounterConcentration(instance),
			isSel: ctx.ui.selectedIds.includes(id),
			isViewed: ctx.ui.viewedId === id,
			spans: getFlowTimelineSpans(instance, {effectItems: items, round}),
		};
	});
	const model = getFlowTimelineModel({round, activeId: ctx.activeInstanceId, lanes});
	const turnName = ctx.activeInstanceId ? ctx.labels.get(ctx.activeInstanceId) : null;

	const head = h("div.ewc-tl__head", null,
		h("p.ewc-tl__summary", null, round
			? ["Round ", h("b", null, `${round}`), turnName ? ` · ${turnName}'s turn` : "", h("span.ewc-muted", null, " · effects run to their last round")]
			: h("span", null, "Combat hasn't started — the timeline fills in as turns pass.")),
		h("div.ewc-tl__legend", {"aria-hidden": "true"},
			h("span", null, h("i.ewc-tl__key.is-up"), "Buff"),
			h("span", null, h("i.ewc-tl__key.is-down"), "Debuff · condition"),
			h("span", null, h("i.ewc-tl__key.is-bf"), "Battlefield"),
		),
		h("button.ewc-btn.ewc-btn--ghost.ewc-btn--sm", {type: "button", "data-ewc-flow": "timeline-back", "data-ewc-fk": "tl-back", title: "Back to the statblock (T)", onclick: toggle}, "Back to statblock", kbd(["T"])),
	);

	const grid = [...Array(model.roundsShown)].map((_, i) => h("i.ewc-tl__grid", {style: {left: `${i / model.roundsShown * 100}%`}}));
	const axis = h("div.ewc-tl__axis", {"aria-hidden": "true"},
		h("span.ewc-tl__axisk", null, "Creature"),
		h("div.ewc-tl__rounds", null, model.axis.map(it => h(`span.ewc-tl__rlabel${it.isNow ? ".is-now" : ""}`, {style: {left: `${it.left}%`}, title: `Round ${it.round}`}, h("span.ewc-tl__rword", null, "Round "), h("span.ewc-tl__rshort", null, "R"), `${it.round}`))),
	);

	const laneEls = model.lanes.map(lane => {
		const instance = byId.get(lane.id);
		const name = h("b.ewc-tl__name", null, lane.label);
		api.hover.bindCreature(name, instance);
		const conc = lane.conc ? bindFlowConcentration(api, h("span.ewc-tl__conc", null, `◉ ${lane.conc}`), state, lane.id, lane.conc) : null;
		const hpText = lane.hpMax == null ? "HP —" : `${lane.hp ?? "?"}/${lane.hpMax} HP${lane.temp ? ` +${lane.temp}` : ""}`;
		const conds = (instance.conditions || []).filter(it => `${it}`.toLowerCase() !== "concentrating");
		const spans = lane.spans.map(span => getSpanEl(api, instance, span, itemsById.get(lane.id), ctx));
		const track = h("div.ewc-tl__track", null,
			grid.map(it => it.cloneNode()),
			lane.dots.map(dot => h(`i.ewc-tl__dot${dot.isDone ? ".is-done" : ""}${dot.isNow ? ".is-now" : ""}`, {style: {left: `${dot.left}%`}, title: `Round ${dot.round}`})),
			spans,
			round ? h("i.ewc-tl__now", {style: {left: `${model.nowLeft}%`}, "aria-hidden": "true"}) : null,
		);
		const laneEl = h(`div.ewc-tl__lane${lane.isTurn ? ".is-turn" : ""}${lane.isSel ? ".is-sel" : ""}${lane.isViewed ? ".is-viewed" : ""}`, {
			role: "button",
			tabindex: "0",
			"data-ewc-lane": lane.id,
			"data-ewc-fk": `lane-${lane.id}`,
			"aria-current": lane.isViewed ? "true" : null,
			"aria-label": `${lane.label}${lane.isTurn ? ", their turn" : ""}, ${hpText}, AC ${lane.ac ?? "unknown"}${lane.conc ? `, concentrating on ${lane.conc}` : ""}${conds.length ? `, ${conds.join(", ")}` : ""}. View statblock`,
			style: {"min-height": `${lane.minHeight}px`},
			onclick: evt => {
				if (evt.target.closest(".ewc-tl__span")) return;
				api.view(lane.id);
			},
			onkeydown: evt => {
				if (evt.target !== evt.currentTarget || (evt.key !== "Enter" && evt.key !== " ")) return;
				evt.preventDefault();
				evt.stopPropagation();
				api.view(lane.id);
			},
		},
		h("div.ewc-tl__label", null, name, h("small", null, `${hpText} · AC ${lane.ac ?? "—"}`), conc),
		track,
		);
		return laneEl;
	});

	const body = h("div.ewc-tl__body", null, axis, laneEls.length ? laneEls : h("p.ewc-muted.ewc-tl__empty", null, "Nobody is left in the fight."));
	const prevBody = el.querySelector(".ewc-tl__body");
	const scroll = prevBody ? {top: prevBody.scrollTop, left: prevBody.scrollLeft} : null;
	const active = document.activeElement;
	const fk = active && el.contains(active) ? active.dataset?.ewcFk : null;
	el.replaceChildren(h("div.ewc-tl", {"data-ewc-flow": "timeline-view"}, head, body));
	if (scroll) Object.assign(body, {scrollTop: scroll.top, scrollLeft: scroll.left});
	if (fk) el.querySelector(`[data-ewc-fk="${CSS.escape(fk)}"]`)?.focus({preventScroll: true});
}

function getSpanEl (api, instance, span, items, ctx) {
	const text = `${span.label}${span.rounds != null ? ` · ${span.rounds}r` : ""}`;
	const cls = span.k === "cond" ? "is-cond" : span.k === "down" ? "is-down" : span.k === "bf" ? "is-bf" : "is-up";
	const ele = h(`span.ewc-tl__span.${cls}${span.isClip ? ".is-clip" : ""}`, {
		tabindex: "0",
		style: {left: `${span.left}%`, width: `${span.width}%`, bottom: `${span.bottom}px`},
		"aria-label": `${span.label}${span.rounds != null ? `, ${span.rounds} rounds left` : ", until removed"}`,
	}, text);
	if (span.k === "cond") return api.hover.bindCondition(ele, span.id, {conditionCatalog: ctx.conditionCatalog});
	const item = (items || []).find(it => it.id === span.id && it.k === span.k);
	if (span.k === "bf") return item?.hoverEntry ? api.hover.bindEntry(ele, `flow-bf:${item.id}`, item.hoverEntry) : ele;
	const effect = (instance.effects || []).find(it => it.id === span.id);
	if (!effect) return ele;
	const spellMeta = effect.spell?.name ? getCockpitSpellHoverMeta(effect.spell) : null;
	return spellMeta ? api.hover.bindLink(ele, spellMeta) : api.hover.bindEffect(ele, instance, effect);
}
