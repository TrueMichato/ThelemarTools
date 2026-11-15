/** P3c — end combat: summary with XP, then a clear "what's next" (another saved encounter, DM Screen, resume). */
import {h} from "../dom.js";
import {getEncounterCombatSummary, withEncounterCombatEnded, withEncounterCombatStatus} from "../../encounterworkspace-party.js";
import {getFlowEndModel} from "./flow-model.js";
import {isolateFlowKeys} from "./flow-util.js";

export function installFlowEnd (api) {
	let dlg = null;
	/** "summary" | "next" */
	let stage = "summary";
	let note = "";

	const isEnded = state => state.combat?.status === "ended";
	const canEnd = state => !isEnded(state) && state.instances.length > 0 && (state.turn?.round || 0) > 0;

	api.addMenuItem({
		id: "flow-end",
		label: "End combat…",
		title: "Review the fight, award XP and pick the next encounter",
		disabled: ctx => !ctx.state.instances.length,
		onclick: () => open(isEnded(api.getState()) ? "next" : "summary"),
	});

	api.addBarItem(ctx => {
		if (!canEnd(ctx.state)) return null;
		return h("button.ewc-btn.ewc-btn--ghost.ewc-flow-endbtn", {
			type: "button",
			"data-ewc-flow": "end-open",
			"data-ewc-fk": "flow-end-open",
			"aria-haspopup": "dialog",
			title: "End combat: summary, XP, then choose what to run next",
			onclick: () => open("summary"),
		}, "End combat");
	});

	// While combat is over, a quiet strip above the stage keeps the next step one click away.
	const strip = h("div.ewc-endstrip", {"data-ewc-flow": "end-strip", role: "status"});
	api.getRegion("stageTop").append(strip);
	api.onRender(ctx => {
		if (!isEnded(ctx.state)) {
			if (strip.childNodes.length) strip.replaceChildren();
			return;
		}
		const rounds = ctx.state.turn?.round || 0;
		strip.replaceChildren(
			h("span.ewc-endstrip__t", null, h("b", null, "Combat over"), ` · ${rounds} round${rounds === 1 ? "" : "s"}`),
			h("span.ewc-grow"),
			h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary", {type: "button", "data-ewc-flow": "end-choose", onclick: () => api.actions.pChooseList()}, "Choose next encounter…"),
			h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "end-summary", onclick: () => open("next")}, "Summary"),
			h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "end-resume", onclick: () => pResume()}, "Resume"),
		);
	});

	function open (at) {
		if (!dlg) {
			dlg = isolateFlowKeys(h("dialog.ewc-dialog.ewc-end", {"aria-labelledby": "ewc-end-title", "data-ewc-flow": "end-dialog"}));
			dlg.addEventListener("click", evt => { if (evt.target === dlg) dlg.close(); });
			api.getRegion("layer").append(dlg);
		}
		stage = at;
		if (at === "summary") note = "";
		render();
		if (!dlg.open) dlg.showModal();
		dlg.querySelector("[autofocus]")?.focus();
	}

	const close = () => dlg?.open && dlg.close();

	async function pEnd (award) {
		const labels = api.getCtx().labels;
		let text = "";
		const next = await api.pCommit(award ? "End combat & award XP" : "End combat", (draft, {log}) => {
			const res = withEncounterCombatEnded(draft, {award, labels});
			text = res.text;
			log("combat", text);
			return res.state;
		});
		if (!next) return;
		note = text;
		stage = "next";
		render();
		dlg.querySelector("[autofocus]")?.focus();
	}

	async function pResume () {
		const next = await api.pCommit("Resume combat", (draft, {log}) => {
			log("combat", "Combat resumed.");
			return withEncounterCombatStatus(draft, "active");
		});
		if (!next) return;
		close();
		api.toast(`Combat resumed — round ${next.turn?.round || 1}`, {isUndo: true});
	}

	const closeBtn = () => h("button.ewc-btn.ewc-btn--icon", {type: "button", "aria-label": "Close", "data-ewc-flow": "end-close", onclick: close}, "×");

	function render () {
		const state = api.getState();
		const model = getFlowEndModel(getEncounterCombatSummary(state, {labels: api.getCtx().labels}));
		const ended = isEnded(state);
		if (stage === "summary") {
			dlg.replaceChildren(
				h("div.ewc-dialog__head", null,
					h("div", null,
						h("h2.ewc-dialog__title", {id: "ewc-end-title"}, `End combat · ${state.sourceList?.name || "Encounter"}`),
						h("p.ewc-end__sub", null, "Review the fight, award XP, then pick what's next."),
					),
					closeBtn(),
				),
				getSummary(model),
				h("div.ewc-end__foot", null,
					h("span.ewc-end__split", null, model.foot),
					h("span.ewc-grow"),
					h("button.ewc-btn.ewc-btn--ghost", {type: "button", "data-ewc-flow": "end-keep", onclick: close}, ended ? "Close" : "Keep fighting"),
					h("button.ewc-btn", {type: "button", "data-ewc-flow": "end-noaward", onclick: () => pEnd(false)}, "End without XP"),
					h("button.ewc-btn.ewc-btn--primary", {type: "button", autofocus: true, "data-ewc-flow": "end-award", disabled: !model.canAward, title: model.canAward ? null : "No defeated creature is worth XP", onclick: () => pEnd(true)}, "Award & end"),
				),
			);
			if (!model.canAward) dlg.querySelector("[data-ewc-flow='end-noaward']").setAttribute("autofocus", "");
			return;
		}
		const round = state.turn?.round || 0;
		dlg.replaceChildren(
			h("div.ewc-dialog__head", null,
				h("div", null,
					h("h2.ewc-dialog__title", {id: "ewc-end-title"}, "What's next?"),
					h("p.ewc-end__sub", null, note || (ended ? "Combat has ended." : "Combat is still running.")),
				),
				closeBtn(),
			),
			h("div.ewc-end__next", null,
				h("button.ewc-end__opt.is-main", {type: "button", autofocus: true, "data-ewc-flow": "end-next-choose", onclick: () => { close(); api.actions.pChooseList(); }},
					h("b", null, "Run another saved encounter…"),
					h("span", null, "Pick a list you saved in the Bestiary; it replaces this fight."),
				),
				h("button.ewc-end__opt", {type: "button", "data-ewc-flow": "end-next-dm", onclick: () => { close(); api.actions.pSendToDmScreen(); }},
					h("b", null, "Send to the DM Screen"),
					h("span", null, "Queue the selection, or everyone still standing, for its initiative tracker."),
				),
				ended ? h("button.ewc-end__opt", {type: "button", "data-ewc-flow": "end-next-resume", onclick: () => pResume()},
					h("b", null, `Resume ${state.sourceList?.name || "this fight"}`),
					h("span", null, `Back to round ${round || 1} with everyone where they were.`),
				) : null,
				h("a.ewc-end__opt", {href: "bestiary.html", "data-ewc-flow": "end-next-bestiary"},
					h("b", null, "Build a new one in the Bestiary ↗"),
					h("span", null, "Save it there, then choose it here."),
				),
			),
			h("details.ewc-end__more", null, h("summary", null, "Fight summary"), getSummary(model)),
			h("div.ewc-end__foot", null, h("span.ewc-grow"), h("button.ewc-btn.ewc-btn--ghost", {type: "button", "data-ewc-flow": "end-done", onclick: close}, "Close")),
		);
	}

	function getSummary (model) {
		const byId = id => api.getState().instances.find(it => it.id === id);
		const nameEl = it => {
			const el = h("span.ewc-end__name", null, it.label);
			const inst = byId(it.id);
			if (inst) api.hover.bindCreature(el, inst);
			return el;
		};
		return h("div.ewc-end__sum", null,
			h("div.ewc-end__tiles", null, model.tiles.map(t => h("div.ewc-end__tile", {"data-ewc-end-tile": t.key}, h("span", null, t.label), h("b", null, t.value)))),
			h("h3.ewc-end__h", null, `Defeated · ${model.defeated.reduce((s, it) => s + it.xp, 0)} XP`),
			model.defeated.length
				? h("ul.ewc-end__list", null, model.defeated.map(it => h("li", null, nameEl(it), h("span", null, `${it.xp} XP`))))
				: h("p.ewc-muted", null, "No foes defeated yet."),
			model.remaining.length ? h("p.ewc-muted.ewc-end__rem", null, `Still standing (no XP): ${model.remaining.join(", ")}`) : null,
			model.note ? h("p.ewc-muted", null, model.note) : null,
			model.party.length ? [
				h("h3.ewc-end__h", null, "Party"),
				h("ul.ewc-end__list", null, model.party.map(it => h("li", null, nameEl(it), h(`span${it.down ? ".is-bad" : ""}`, null, it.down ? "down" : `${it.hp}/${it.hpMax} HP`)))),
			] : null,
		);
	}

	api.engine.subscribe(() => { if (dlg?.open) render(); });
}
