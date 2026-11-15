/**
 * P3b — small DOM helpers shared by the prep tabs: labelled fields, segmented controls, the "who" scope switch and
 * target wording. Every interactive element carries a `data-ewc-fk` key so re-renders keep focus.
 */

import {h} from "../dom.js";

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const fk = key => ({ewcFk: key});

export function field (label, input, {hint = null, wide = false} = {}) {
	return h(`label.ewc-prep__f${wide ? ".ewc-prep__f--wide" : ""}`, null,
		h("span.ewc-prep__lbl", null, label, hint ? h("small", null, ` ${hint}`) : null),
		input,
	);
}

export function input ({key, value = "", placeholder = "", isNum = false, isSm = false, ariaLabel = null, onInput = null, onChange = null, onKeydown = null, type = "text", rows = null}) {
	const tag = rows ? "textarea" : "input";
	const attrs = {
		dataset: fk(key),
		placeholder,
		"aria-label": ariaLabel,
		oninput: onInput ? evt => onInput(evt.target.value, evt) : null,
		onchange: onChange ? evt => onChange(evt.target.value, evt) : null,
		onkeydown: onKeydown,
	};
	if (rows) attrs.rows = `${rows}`;
	else {
		attrs.type = type;
		if (isNum) attrs.inputmode = "numeric";
	}
	const ele = h(`${tag}.ewc-input${isNum ? ".ewc-input--num" : ""}${isSm ? ".ewc-input--sm" : ""}`, attrs);
	ele.value = value ?? "";
	return ele;
}

/** A radio-style segmented control: items [{id, label, disabled?, title?}]. */
export function seg ({label, items, value, onPick, key, isWrap = false}) {
	return h(`div.ewc-seg.ewc-prep__seg${isWrap ? ".ewc-prep__seg--wrap" : ""}`, {role: "radiogroup", "aria-label": label},
		items.map(it => h("button.ewc-seg__b", {
			type: "button",
			role: "radio",
			"aria-checked": `${it.id === value}`,
			disabled: !!it.disabled,
			title: it.title || null,
			dataset: fk(`${key}-${it.id}`),
			onclick: () => onPick(it.id),
		}, it.label)),
	);
}

export function btn (label, onclick, {key, kind = "", disabled = false, title = null, ariaLabel = null, pressed = null, extra = null} = {}) {
	const mods = kind.split(" ").filter(Boolean).map(it => `.ewc-btn--${it}`).join("");
	return h(`button.ewc-btn.ewc-btn--sm${mods}`, {
		type: "button",
		dataset: key ? fk(key) : null,
		disabled,
		title,
		"aria-label": ariaLabel,
		"aria-pressed": pressed == null ? null : `${pressed}`,
		onclick,
	}, label, extra);
}

export const acts = (...children) => h("div.ewc-prep__acts", null, ...children);
export const muted = text => h("p.ewc-muted.ewc-prep__muted", null, text);
export const tip = text => h("p.ewc-muted.ewc-prep__tip", null, text);
export const lbl = text => h("p.ewc-prep__lbl.ewc-prep__lbl--block", null, text);

/** The ids prep tools act on: the selection when "Selected" is chosen and something is selected, else the viewed creature. */
export function getPrepTargetIds (S, ctx) {
	const have = new Set(ctx.state.instances.map(it => it.id));
	const selected = (ctx.ui.selectedIds || []).filter(id => have.has(id));
	if (S.scope === "selected" && selected.length) return selected;
	return ctx.ui.viewedId && have.has(ctx.ui.viewedId) ? [ctx.ui.viewedId] : [];
}

export function getPrepTargetText (ids, labels) {
	if (!ids.length) return "—";
	return ids.length === 1 ? labels.get(ids[0]) || "1 creature" : plural(ids.length, "creature");
}

/** "Viewed · Goblin 1" / "Selected · 3" — which creatures the tab's tools act on. */
export function scopeSeg (P) {
	const {S, ctx, rerender} = P;
	const selected = ctx.ui.selectedIds || [];
	const viewed = ctx.ui.viewedId ? ctx.labels.get(ctx.ui.viewedId) : null;
	const value = S.scope === "selected" && selected.length ? "selected" : "viewed";
	return h("div.ewc-prep__scope", null,
		h("span.ewc-prep__lbl", null, "Acts on"),
		seg({
			label: "Which creatures",
			key: "prep-scope",
			value,
			items: [
				{id: "viewed", label: viewed ? `Viewed · ${viewed}` : "Viewed", disabled: !viewed},
				{id: "selected", label: `Selected${selected.length ? ` · ${selected.length}` : ""}`, disabled: !selected.length, title: selected.length ? null : "Select creatures first"},
			],
			onPick: id => { S.scope = id; S.tplPreview = false; rerender(); },
		}),
	);
}

/** A before → after list: rows [{label, html}] (html is trusted, built by us). */
export function diffList (rows, {max = 8} = {}) {
	const shown = rows.slice(0, max);
	return h("ul.ewc-prep__diff", null,
		shown.map(row => h("li", null, h("span.ewc-prep__diffn", null, row.label), h("span", {html: row.html}))),
		rows.length > max ? h("li.ewc-muted", null, `… and ${rows.length - max} more`) : null,
	);
}

export const esc = text => `${text ?? ""}`.replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"})[ch]);

export function getErrorText (e) {
	return `${e?.message || e || "Something went wrong"}`.replace(/\.$/, "");
}
