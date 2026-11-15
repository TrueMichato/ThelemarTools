/**
 * P3a — the roll tray: results of a mass save / check, floating above the stage between the rail and the dock.
 * Per creature: the d20(s) (struck die shown), the total, pass / fail vs the DC and an expandable breakdown whose
 * every source hovers natively. Bulk actions: select failed / passed, apply the outcome (damage with half on a pass,
 * condition on a fail) through the shell actions so each step is undoable and logged.
 */

import {getEncounterRolledAmount} from "../../encounterworkspace-massroll.js";
import {h, replaceKeepingFocus} from "../dom.js";
import {
	COCKPIT_TRAY_SORTS,
	getCockpitOutcomeSteps,
	getCockpitOutcomeText,
	getCockpitTrayCounts,
	getCockpitTrayRows,
} from "./act-roll-model.js";
import {bindCockpitSource, getKbd, getSeg, getWhoText, plural} from "./act-shared.js";

export function createCockpitRollTray (api) {
	const root = h("section.ewc-tray", {"aria-label": "Roll results", hidden: true, "data-ewc-tray": ""});
	api.getRegion("dockTop").append(root);

	let tray = null; // {title, rolled, outcome, sort, open: Set, status, review}
	const showListeners = [];

	const hide = () => {
		tray = null;
		root.hidden = true;
		root.replaceChildren();
	};

	const show = (rolled, {title, outcome = null, isFocus = true}) => {
		tray = {title, rolled, outcome, sort: "order", open: new Set(), names: new Map(), status: null, review: null, isApplying: false};
		showListeners.forEach(fn => fn());
		root.hidden = false;
		render();
		if (isFocus) root.querySelector("[data-ewc-tray-primary]")?.focus({preventScroll: true});
	};

	const getLiveResults = () => {
		const live = new Set(api.getState().instances.map(it => it.id));
		return tray.rolled.results.filter(it => live.has(it.id));
	};

	const pApplyOutcome = async (decisions = {}) => {
		if (!tray?.outcome || tray.isApplying) return;
		const {outcome} = tray;
		tray.isApplying = true;
		try {
			let amount = tray.amount;
			if (amount == null && outcome.damage) {
				try {
					const rolled = getEncounterRolledAmount(outcome.damage.amount ?? outcome.damage.expr);
					amount = rolled.amount;
					tray.amountText = rolled.roll ? `${outcome.damage.expr} → ${amount}` : `${amount}`;
				} catch (e) {
					tray.status = {kind: "error", text: e.message};
					return;
				}
				tray.amount = amount;
			}
			const rolled = {...tray.rolled, results: getLiveResults()};
			const steps = getCockpitOutcomeSteps(api.getState(), rolled, outcome, {amount: amount || 0});
			const pending = steps.slice(tray.stepIx || 0);
			for (const step of pending) {
				if (step.kind === "damage") {
					const res = await api.actions.pDamage({
						amount: step.amount,
						amountText: step.isHalf ? `half of ${tray.amountText}` : tray.amountText,
						damageType: outcome.damageType || null,
						source: "unspecified",
						decisions,
						targetIds: step.ids,
					});
					if (res?.unresolved) {
						tray.review = {unresolved: res.unresolved, decisions: {...decisions}};
						return;
					}
				} else {
					await api.actions.pCondition({condition: step.condition, isAdd: true, rounds: step.rounds, targetIds: step.ids});
				}
				tray.stepIx = (tray.stepIx || 0) + 1;
			}
			tray.review = null;
			tray.status = {kind: "ok", text: steps.length ? `Applied${tray.amountText ? ` (${tray.amountText})` : ""}.` : "Nothing to apply — nobody failed or took damage."};
			tray.isApplied = true;
		} finally {
			if (tray) {
				tray.isApplying = false;
				render();
			}
		}
	};

	function getRow (row, ctx) {
		const isOpen = tray.open.has(row.id);
		const instance = ctx.state.instances.find(it => it.id === row.id);
		const toggle = () => {
			if (isOpen) tray.open.delete(row.id); else tray.open.add(row.id);
			render();
		};
		// Reused across re-renders: a native hover that opens after the click must still see this span's mouseleave.
		const nameKey = `${row.id}\u0000${row.label}`;
		let name = tray.names.get(nameKey);
		if (!name) {
			name = h("span.ewc-tray__name", null, row.label);
			if (instance) api.hover.bindCreature(name, instance);
			tray.names.set(nameKey, name);
		}
		const verdict = row.verdict == null ? null : h(`span.ewc-tray__verdict.is-${row.verdict}`, {title: row.isAutoFail ? "Automatic failure" : null}, row.verdict === "pass" ? "✓ pass" : "✗ fail");
		const head = h("button.ewc-tray__row", {
			type: "button",
			"aria-expanded": `${isOpen}`,
			"data-ewc-fk": `tray-${row.id}`,
			"data-ewc-tray-row": row.id,
			onclick: toggle,
		},
		h("span.ewc-tray__chev", {"aria-hidden": "true"}, isOpen ? "▾" : "▸"),
		name,
		h("span.ewc-tray__dice", {"aria-label": `rolled ${row.dice.map(it => it.value).join(" and ")}`}, row.dice.map(die => h(`span.ewc-tray__die${die.isKept ? "" : ".is-struck"}${die.isKept && row.isCrit ? ".is-crit" : ""}${die.isKept && row.isFumble ? ".is-fumble" : ""}`, null, `${die.value}`))),
		h("span.ewc-tray__total", {title: row.text}, `${row.total}`),
		h("span.ewc-tray__text.ewc-muted", null, row.text.replace(/^\d+ /, "")),
		verdict);
		const out = [head];
		if (isOpen) {
			out.push(h("ul.ewc-tray__lines", null, row.lines.map(line => {
				const label = h("span.ewc-tray__src", null, line.label);
				if (line.source && line.source !== "statblock") bindCockpitSource(label, line.source, {hover: api.hover, instance, state: ctx.state, conditionCatalog: ctx.conditionCatalog, label: line.label});
				else if (line.source === "statblock") label.title = "From the statblock";
				return h(`li${line.isNote ? ".is-note" : ""}`, null, label, line.value ? h("span.ewc-tray__val", null, line.value) : null);
			})));
		}
		return h(`li.ewc-tray__item${row.verdict ? `.is-${row.verdict}` : ""}`, null, out);
	}

	function getReview (ctx) {
		const {unresolved, decisions} = tray.review;
		const selects = unresolved.map(({id, key, defense, note}) => {
			const text = `${ctx.labels.get(id) || id} · ${defense} · ${note}`;
			const current = decisions[id]?.[key];
			return h("label.ewc-review__row", null, h("span", null, text), h("select.ewc-input.ewc-input--sm", {
				"data-ewc-fk": `tray-rv-${id}-${key}`,
				"aria-label": text,
				onchange: evt => {
					const value = evt.target.value;
					decisions[id] = {...decisions[id]};
					if (value === "") delete decisions[id][key]; else decisions[id][key] = value === "yes";
				},
			}, h("option", {value: "", selected: current == null}, "Choose…"), h("option", {value: "yes", selected: current === true}, "Applies"), h("option", {value: "no", selected: current === false}, "Does not apply")));
		});
		const go = () => {
			const missing = unresolved.find(({id, key}) => decisions[id]?.[key] == null);
			if (missing) {
				api.toast("Choose Applies or Does not apply for every conditional defense.", {kind: "error"});
				root.querySelector(`[data-ewc-fk="tray-rv-${CSS.escape(missing.id)}-${CSS.escape(missing.key)}"]`)?.focus();
				return;
			}
			pApplyOutcome(decisions);
		};
		return h("div.ewc-review.ewc-tray__review", {role: "group", "aria-label": "Conditional defenses"},
			h("p.ewc-review__head", null, h("b", null, `Rolled ${tray.amountText}${tray.outcome.damageType ? ` ${tray.outcome.damageType}` : ""} once.`), " Does each defense apply?"),
			selects,
			h("div.ewc-act__row", null,
				h("button.ewc-btn.ewc-btn--sm.ewc-btn--bad", {type: "button", "data-ewc-fk": "tray-rv-go", onclick: go}, "Continue"),
				h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-fk": "tray-rv-cancel", onclick: () => { tray.review = null; render(); }}, "Cancel")));
	}

	function render (ctx = api.getCtx()) {
		if (!tray) return;
		const live = new Set(ctx.state.instances.map(it => it.id));
		const rolled = {...tray.rolled, results: tray.rolled.results.filter(it => live.has(it.id)).map(it => ({...it, label: ctx.labels.get(it.id) || it.label}))};
		const rows = getCockpitTrayRows(rolled, {sort: tray.sort, orderIds: ctx.orderIds});
		const counts = getCockpitTrayCounts(rolled);
		const failedIds = rolled.results.filter(it => it.success === false).map(it => it.id);
		const passedIds = rolled.results.filter(it => it.success === true).map(it => it.id);
		const hasDc = rolled.dc != null;
		const undoKeys = getKbd(["mod", "Z"], api.isMac);

		const header = h("header.ewc-tray__head", null,
			h("h3.ewc-tray__title", null, tray.title),
			h("span.ewc-tray__counts.ewc-muted", null, hasDc
				? `${counts.passed} passed · ${counts.failed} failed${counts.skipped ? ` · ${counts.skipped} skipped` : ""}`
				: `${plural(counts.total, "roll")}${counts.skipped ? ` · ${counts.skipped} skipped` : ""}`),
			getSeg({label: "Sort results", options: COCKPIT_TRAY_SORTS, value: tray.sort, fk: "tray-sort", onPick: v => { tray.sort = v; render(); }}),
			h("button.ewc-btn.ewc-btn--icon.ewc-btn--ghost.ewc-tray__close", {type: "button", title: "Dismiss (Esc)", "aria-label": "Dismiss roll results", "data-ewc-tray-close": "", onclick: hide}, "×"));

		const bulk = h("div.ewc-tray__bulk", null,
			hasDc ? h("button.ewc-btn.ewc-btn--sm", {
				type: "button",
				disabled: !failedIds.length,
				"data-ewc-fk": "tray-sel-failed",
				"data-ewc-tray-select": "failed",
				title: getWhoText(failedIds, ctx.labels),
				onclick: () => api.setSelection(failedIds),
			}, `Select failed · ${failedIds.length}`) : null,
			hasDc ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
				type: "button",
				disabled: !passedIds.length,
				"data-ewc-fk": "tray-sel-passed",
				"data-ewc-tray-select": "passed",
				title: getWhoText(passedIds, ctx.labels),
				onclick: () => api.setSelection(passedIds),
			}, `Select passed · ${passedIds.length}`) : null,
			tray.outcome && hasDc ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary.ewc-tray__apply", {
				type: "button",
				disabled: tray.isApplied || tray.isApplying || !!tray.review,
				"data-ewc-fk": "tray-apply",
				"data-ewc-tray-primary": "",
				"data-ewc-tray-apply": "",
				onclick: () => pApplyOutcome(),
			}, `Apply outcome · ${getCockpitOutcomeText(tray.outcome)}`) : null);

		const status = tray.status ? h(`p.ewc-tray__status${tray.status.kind === "error" ? ".ewc-error" : ""}`, {role: tray.status.kind === "error" ? "alert" : "status"},
			tray.status.text,
			tray.status.kind === "ok" && tray.isApplied ? [" Undo with ", undoKeys, "."] : null) : null;

		replaceKeepingFocus(root, [
			header,
			h("ol.ewc-tray__list", null, rows.map(row => getRow(row, ctx))),
			rows.length ? null : h("p.ewc-muted", null, "Everyone who rolled has left the encounter."),
			bulk.childElementCount ? bulk : null,
			tray.review ? getReview(ctx) : null,
			status,
		].filter(Boolean));
	}

	root.addEventListener("keydown", evt => {
		if (evt.key !== "Escape" || evt.defaultPrevented) return;
		evt.preventDefault();
		evt.stopPropagation();
		hide();
	});

	api.onRender(ctx => { if (tray) render(ctx); });

	/** fn() whenever a new roll opens the tray — the statblock roll feed shares the slot and hides itself. */
	const onShow = fn => showListeners.push(fn);

	return {show, hide, render, onShow, getIsOpen: () => !!tray};
}
