/** P3c — the log drawer (L) under the stage: engine log with round separators, filters, expand/minimize and resize. */
import {h, kbd} from "../dom.js";
import {FLOW_LOG_FILTERS, getFlowLogHeight, getFlowLogModel} from "./flow-model.js";
import {getFlowPrefs, setFlowPrefs} from "./flow-util.js";

const STEP_PX = 24;
const DEFAULT_PX = 200;

export function installFlowLog (api) {
	const prefs = getFlowPrefs();
	const ui = {isOpen: !!prefs.logOpen, filter: FLOW_LOG_FILTERS.some(it => it.id === prefs.logFilter) ? prefs.logFilter : "all", height: getFlowLogHeight(prefs.logHeight || DEFAULT_PX, window.innerHeight)};
	let lastSig = null;

	const listId = "ewc-flow-log-list";
	const split = h("div.ewc-log__split", {
		role: "separator",
		tabindex: "0",
		"aria-orientation": "horizontal",
		"aria-label": "Resize the log (↑ taller, ↓ shorter)",
		"aria-controls": listId,
		"aria-valuemin": "120",
		title: "Drag to resize the log · ↑/↓ when focused · double-click to reset",
	});
	const chev = h("span.ewc-log__chev", {"aria-hidden": "true"}, "▴");
	const count = h("span.ewc-log__count");
	const toggleBtn = h("button.ewc-log__toggle", {
		type: "button",
		"aria-expanded": "false",
		"aria-controls": listId,
		"aria-keyshortcuts": "L",
		"data-ewc-flow": "log-toggle",
		onclick: () => setOpen(!ui.isOpen),
	}, chev, h("span", null, "Log"), count, kbd(["L"]));
	const latest = h("p.ewc-log__latest", {"data-ewc-flow": "log-latest"});
	const filterBtns = FLOW_LOG_FILTERS.map(f => h("button.ewc-log__fchip", {
		type: "button",
		"data-ewc-log-filter": f.id,
		onclick: () => {
			ui.filter = f.id;
			setFlowPrefs({logFilter: f.id});
			lastSig = null;
			sync(api.getState(), {isForceBottom: true});
		},
	}, f.label));
	const filters = h("div.ewc-log__filters", {role: "group", "aria-label": "Show in the log"}, filterBtns);
	const tallBtn = h("button.ewc-btn.ewc-btn--ghost.ewc-btn--sm.ewc-log__tall", {
		type: "button",
		"data-ewc-flow": "log-tall",
		onclick: () => {
			const max = getFlowLogHeight(Infinity, window.innerHeight);
			setHeight(ui.height >= max - 4 ? DEFAULT_PX : max);
		},
	});
	const list = h("ol.ewc-log__list", {id: listId, "aria-label": "Combat log", tabindex: "0"});
	const bar = h("div.ewc-log__bar", null, toggleBtn, latest, filters, tallBtn);
	const drawer = h("section.ewc-log", {"aria-label": "Combat log", "data-ewc-flow": "log"}, split, list, bar);
	api.getRegion("stageBottom").append(drawer);

	function setHeight (px) {
		ui.height = getFlowLogHeight(px, window.innerHeight);
		drawer.style.setProperty("--ewc-log-h", `${ui.height}px`);
		split.setAttribute("aria-valuenow", `${ui.height}`);
		split.setAttribute("aria-valuemax", `${getFlowLogHeight(Infinity, window.innerHeight)}`);
		setFlowPrefs({logHeight: ui.height});
		syncTall();
	}
	function syncTall () {
		const isTall = ui.height >= getFlowLogHeight(Infinity, window.innerHeight) - 4;
		tallBtn.textContent = isTall ? "Shorter" : "Taller";
		tallBtn.title = isTall ? "Shrink the log back to its usual height" : "Make the log as tall as it goes";
	}
	function setOpen (isOpen) {
		ui.isOpen = isOpen;
		setFlowPrefs({logOpen: isOpen});
		lastSig = null;
		sync(api.getState(), {isForceBottom: true});
	}

	split.addEventListener("pointerdown", evt => {
		evt.preventDefault();
		split.setPointerCapture?.(evt.pointerId);
		split.classList.add("is-drag");
		if (!ui.isOpen) setOpen(true);
		const y0 = evt.clientY;
		const h0 = list.getBoundingClientRect().height || ui.height;
		const move = ev => setHeight(h0 + (y0 - ev.clientY));
		const up = () => {
			split.classList.remove("is-drag");
			split.removeEventListener("pointermove", move);
			split.removeEventListener("pointerup", up);
			split.removeEventListener("pointercancel", up);
		};
		split.addEventListener("pointermove", move);
		split.addEventListener("pointerup", up);
		split.addEventListener("pointercancel", up);
	});
	split.addEventListener("dblclick", () => setHeight(DEFAULT_PX));
	split.addEventListener("keydown", evt => {
		if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
		evt.preventDefault();
		evt.stopPropagation();
		if (!ui.isOpen) setOpen(true);
		setHeight(ui.height + (evt.key === "ArrowUp" ? STEP_PX : -STEP_PX));
	});
	window.addEventListener("resize", () => setHeight(ui.height));

	function sync (state, {isForceBottom = false} = {}) {
		const log = state.log || [];
		const model = getFlowLogModel(log, {filter: ui.filter});
		drawer.classList.toggle("is-open", ui.isOpen);
		toggleBtn.setAttribute("aria-expanded", `${ui.isOpen}`);
		toggleBtn.title = ui.isOpen ? "Minimize the log to give the stage room (L)" : "Expand the log (L)";
		count.textContent = log.length ? `${log.length}` : "";
		split.hidden = !ui.isOpen;
		list.hidden = !ui.isOpen;
		filters.hidden = !ui.isOpen;
		tallBtn.hidden = !ui.isOpen;
		latest.hidden = ui.isOpen;
		filterBtns.forEach(btn => btn.setAttribute("aria-pressed", `${btn.dataset.ewcLogFilter === ui.filter}`));
		latest.replaceChildren(...(model.latest
			? [h("span.ewc-muted", null, model.latest.round ? `R${model.latest.round} · ` : ""), h("span", null, model.latest.text)]
			: [h("span.ewc-muted", null, "Nothing logged yet")]));
		latest.title = model.latest?.text || "";
		if (!ui.isOpen) return;
		const sig = `${ui.filter}|${log.length}|${log.at(-1)?.id || ""}`;
		if (sig === lastSig && !isForceBottom) return;
		lastSig = sig;
		const isAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
		list.replaceChildren(...(model.rows.length ? model.rows.map(row => row.type === "round"
			? h("li.ewc-log__round", {role: "presentation"}, h("span", null, row.label))
			: h(`li.ewc-log__row.k-${row.kind}`, {"data-ewc-log-kind": row.kind},
				h("span.ewc-log__k", null, row.word),
				h("span.ewc-log__t", null, row.text),
			)) : [h("li.ewc-log__empty", null, ui.filter === "all" ? "Nothing logged yet. Damage, rolls, effects and turns appear here." : "Nothing of this kind yet.")]));
		if (isForceBottom || isAtBottom) list.scrollTop = list.scrollHeight;
	}

	setHeight(ui.height);
	api.engine.subscribe(next => sync(next));
	api.onRender(ctx => sync(ctx.state));

	api.registerKey({section: "View & select", keys: ["L"], label: "Expand / minimize the log", action: "flow:log", run: () => { setOpen(!ui.isOpen); }});

	api.onTurnChanged(({after, activeInstanceId}) => {
		const round = after?.turn?.round || 0;
		if (!round) return;
		const labels = api.getCtx().labels;
		const name = labels.get(activeInstanceId) || "Next creature";
		api.engine.pLog("turn", `Round ${round} · ${name}'s turn`, {target: activeInstanceId}).catch(() => {});
	});
}
