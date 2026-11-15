/**
 * P3b — the Battlefield tab (rules by category, who they reach, rounds, caster, note) and the compact battlefield strip
 * above the viewed creature. Lair actions are a battlefield rule like any other.
 */

import {h} from "../dom.js";
import {
	getEncounterBattlefieldDisplayName,
	getEncounterBattlefieldHover,
	getEncounterBattlefieldRule,
	getEncounterBattlefieldRulesByCategory,
	getEncounterBattlefieldTargets,
	withEncounterBattlefieldEntry,
	withEncounterBattlefieldEntryUpdate,
	withoutEncounterBattlefieldEntry,
} from "../../encounterworkspace-battlefield.js";
import {getPrepBattlefieldArgs, parsePrepRounds} from "./prep-model.js";
import {acts, btn, field, fk, input, muted, plural, seg, tip} from "./prep-ui.js";
import {PREP_EDITOR_SECTIONS, pOpenPrepStatblockEditor} from "./prep-editor.js";

export const getPrepAreaDraft = () => ({rule: "dim-light", name: "", note: "", rounds: "", scope: "all", group: "", casterId: ""});

const stripTags = text => typeof Renderer !== "undefined" && Renderer.stripTags ? Renderer.stripTags(`${text || ""}`) : `${text || ""}`;

/** The hover card for a battlefield entry (same content as its pill on the statblock). */
export function getPrepBattlefieldHoverEntry (state, entry, {labels} = {}) {
	const hover = getEncounterBattlefieldHover(state, entry, {labels});
	return {
		type: "entries",
		name: hover.title,
		entries: [hover.description, hover.note, `Applies to: ${hover.scope}`, hover.rounds != null ? `${plural(hover.rounds, "round")} left` : null].filter(Boolean),
	};
}

/** Group choices for the "A group" scope: [{value, label}] (custom groups by name, view groups by id). */
export function getPrepGroupOptions (ctx) {
	return (ctx.groupChips || []).map(chip => ({
		value: `${chip.key}`.startsWith("custom:") ? `${chip.key}`.slice("custom:".length) : chip.key,
		label: chip.name,
	}));
}

async function pRemoveEntry (api, entry) {
	const name = getEncounterBattlefieldDisplayName(entry);
	const next = await api.pCommit(`Battlefield: ${name} ended`, draft => withoutEncounterBattlefieldEntry(draft, entry.id));
	if (next) api.toast(`Battlefield: ${name} ended.`, {isUndo: true});
}

async function pSetEntryRounds (api, entry, text) {
	const parsed = parsePrepRounds(text);
	if (parsed.error) return api.toast(parsed.error, {kind: "error"});
	if ((entry.rounds ?? null) === parsed.rounds) return;
	const name = getEncounterBattlefieldDisplayName(entry);
	const next = await api.pCommit(`Battlefield: ${name} duration`, draft => withEncounterBattlefieldEntryUpdate(draft, entry.id, {rounds: parsed.rounds}));
	if (next) api.toast(`${name}: ${parsed.rounds == null ? "until removed" : plural(parsed.rounds, "round")}.`, {isUndo: true});
}

function entryName (api, ctx, entry, {tag = "span.ewc-prep__bfn"} = {}) {
	const ele = h(tag, {tabindex: "0"}, getEncounterBattlefieldDisplayName(entry));
	api.hover.bindEntry(ele, `ewc-prep-bf:${entry.id}`, getPrepBattlefieldHoverEntry(ctx.state, entry, {labels: ctx.labels}));
	return ele;
}

/**
 * One quiet chip per active battlefield entry (name with hover, who/how long, ✎ edit, × end) — shown in the rail's
 * BATTLEFIELD section. Lair actions get a ⌂ mark.
 */
export function getPrepBattlefieldChips (api, ctx, {onEdit}) {
	return (ctx.state.battlefield || []).map(entry => {
		const count = getEncounterBattlefieldTargets(ctx.state, entry).length;
		const name = getEncounterBattlefieldDisplayName(entry);
		const isLair = entry.rule === "lair-actions";
		return h(`span.ewc-prep-strip__chip${isLair ? ".is-lair" : ""}`, {dataset: {ewcBf: entry.id}},
			isLair ? h("span.ewc-prep-strip__glyph", {"aria-hidden": "true"}, "⌂") : null,
			entryName(api, ctx, entry),
			h("span.ewc-prep-strip__meta", null, isLair ? "init 20" : entry.scope === "all" ? "everyone" : plural(count, "creature"), entry.rounds != null ? ` · ${entry.rounds} rnd` : ""),
			h("button.ewc-prep-strip__x", {type: "button", "aria-label": `Edit ${name}`, title: "Edit", dataset: fk(`bf-edit-${entry.id}`), onclick: () => onEdit(entry.id)}, "✎"),
			h("button.ewc-prep-strip__x", {type: "button", "aria-label": `End ${name}`, title: "End", dataset: fk(`bf-x-${entry.id}`), onclick: () => pRemoveEntry(api, entry)}, "×"),
		);
	});
}

function renderActive (P) {
	const {api, ctx, S} = P;
	const entries = ctx.state.battlefield || [];
	if (!entries.length) return [h("div.ewc-prep__bfnow", null, h("span.ewc-prep__lbl", null, "On the battlefield now"), h("span.ewc-muted", null, "Nothing yet."))];
	return [
		h("p.ewc-prep__lbl.ewc-prep__lbl--block", null, "On the battlefield now"),
		h("ul.ewc-prep__fx", null, entries.map(entry => h(`li${S.areaFocusId === entry.id ? ".is-focus" : ""}`, {dataset: {ewcBfRow: entry.id}},
			entryName(api, ctx, entry, {tag: "span.ewc-prep__fxn"}),
			h("span.ewc-muted.ewc-prep__fxw", null, getEncounterBattlefieldHover(ctx.state, entry, {labels: ctx.labels}).scope),
			h("label.ewc-prep__dur", null,
				input({
					key: `bf-dur-${entry.id}`,
					value: entry.rounds ?? "",
					placeholder: "∞",
					isNum: true,
					isSm: true,
					ariaLabel: `Rounds left for ${getEncounterBattlefieldDisplayName(entry)} — empty means until removed`,
					onChange: value => pSetEntryRounds(api, entry, value),
					onKeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); evt.target.blur(); } },
				}),
				h("span.ewc-muted", null, "rounds"),
			),
			btn("Remove", () => pRemoveEntry(api, entry), {key: `bf-rm-${entry.id}`, kind: "link", ariaLabel: `Remove ${getEncounterBattlefieldDisplayName(entry)}`}),
		))),
	];
}

async function pAddEntry (P) {
	const {api, ctx, S} = P;
	const draft = S.area;
	const groups = getPrepGroupOptions(ctx);
	const {args, error} = getPrepBattlefieldArgs({...draft, group: draft.group || groups[0]?.value || ""}, {selectedIds: ctx.ui.selectedIds || [], groupNames: groups.map(it => it.value)});
	if (error) return api.toast(error, {kind: "error"});
	let added = null;
	const rule = getEncounterBattlefieldRule(args.rule);
	const next = await api.pCommit(`Battlefield: ${args.name || rule?.name || args.rule}`, state => {
		const result = withEncounterBattlefieldEntry(state, args);
		added = result.entry;
		return result.state;
	});
	if (!next || !added) return;
	const count = getEncounterBattlefieldTargets(next, added).length;
	api.toast(`Battlefield: ${getEncounterBattlefieldDisplayName(added)} → ${plural(count, "creature")}.`, {isUndo: true});
	S.area = {...S.area, name: "", note: "", rounds: ""};
	P.rerender();
}

export function renderPrepAreaTab (P) {
	const {api, ctx, S, rerender} = P;
	const draft = S.area;
	const categories = getEncounterBattlefieldRulesByCategory();
	const rule = getEncounterBattlefieldRule(draft.rule) || categories[0].rules[0];
	const groups = getPrepGroupOptions(ctx);
	const selected = ctx.ui.selectedIds || [];
	const hasLair = (ctx.state.battlefield || []).some(it => it.rule === "lair-actions");
	const casters = ctx.state.instances.filter(it => !it.defeated);
	const set = (key, isRender = false) => value => { draft[key] = value; if (isRender) rerender(); };

	const ruleList = h("div.ewc-prep__rules", {role: "radiogroup", "aria-label": "Battlefield rule"},
		categories.map(cat => h("div.ewc-prep__rulecat", null,
			h("span.ewc-prep__lbl", null, cat.name),
			h("div.ewc-prep__rulebtns", null, cat.rules.map(it => {
				const isLairTaken = it.rule === "lair-actions" && hasLair;
				const ele = h("button.ewc-prep__rule", {
					type: "button",
					role: "radio",
					"aria-checked": `${it.rule === rule.rule}`,
					disabled: isLairTaken,
					title: isLairTaken ? "This encounter already has lair actions" : null,
					"aria-description": stripTags(it.description).slice(0, 240),
					dataset: fk(`bf-rule-${it.rule}`),
					onclick: () => { draft.rule = it.rule; rerender(); },
				}, it.name);
				if (!isLairTaken && it.description) api.hover.bindEntry(ele, `ewc-bf-rule:${it.rule}`, {type: "entries", name: `${it.name} (${cat.name})`, entries: [it.description]});
				return ele;
			})),
		)),
	);

	const casterSel = h("select.ewc-input.ewc-input--sm", {dataset: fk("bf-caster"), "aria-label": "Caster", onchange: evt => { draft.casterId = evt.target.value; }},
		h("option", {value: ""}, "none"),
		casters.map(it => h("option", {value: it.id}, ctx.labels.get(it.id))),
	);
	casterSel.value = draft.casterId || "";

	const scope = draft.scope === "selection" && !selected.length ? "all" : draft.scope;
	const groupSel = scope === "group"
		? h("select.ewc-input.ewc-input--sm", {dataset: fk("bf-group"), "aria-label": "Which group", onchange: evt => { draft.group = evt.target.value; }},
			groups.map(it => h("option", {value: it.value}, it.label)))
		: null;
	if (groupSel) groupSel.value = draft.group || groups[0]?.value || "";

	return [
		...renderActive(P),
		h("div.ewc-prep__sep"),
		ruleList,
		h("p.ewc-prep__desc", null, h("b", null, rule.name), rule.description ? ` — ${stripTags(rule.description)}` : ""),
		h("div.ewc-prep__grid", null,
			rule.rule === "custom" ? field("Name", input({key: "bf-name", value: draft.name, placeholder: "Collapsing ceiling", onInput: set("name")})) : null,
			field("Rounds", input({key: "bf-rounds", value: draft.rounds, placeholder: "∞", isNum: true, onInput: set("rounds")}), {hint: "blank = until removed"}),
			field("Caster", casterSel, {hint: "ticks on their turn"}),
			field("Note", input({key: "bf-note", value: draft.note, placeholder: "optional", onInput: set("note")}), {wide: true}),
		),
		h("div.ewc-prep__reach", null,
			h("span.ewc-prep__lbl", null, "Applies to"),
			seg({
				label: "Applies to",
				key: "bf-scope",
				value: scope,
				items: [
					{id: "all", label: "Everyone"},
					{id: "group", label: "A group", disabled: !groups.length, title: groups.length ? null : "No groups yet"},
					{id: "selection", label: `Selected${selected.length ? ` · ${selected.length}` : ""}`, disabled: !selected.length, title: selected.length ? null : "Select creatures first"},
				],
				onPick: id => { draft.scope = id; if (id === "group" && !draft.group) draft.group = groups[0]?.value || ""; rerender(); },
			}),
			groupSel,
		),
		acts(
			btn("Add to battlefield", () => pAddEntry(P), {key: "bf-add", kind: "primary", disabled: rule.rule === "lair-actions" && hasLair}),
			ctx.ui.viewedId ? btn("Lair actions in the statblock…", () => pOpenPrepStatblockEditor(api, ctx.ui.viewedId, {section: PREP_EDITOR_SECTIONS.lair, label: "Lair actions"}), {key: "bf-lair", kind: "ghost"}) : null,
		),
		tip("Battlefield rules are about the place, not a creature — they reach everyone in it, one group, or the selected, and count down at the end of each round (or on the caster's turn)."),
	];
}

export function getPrepAreaTabEmpty () {
	return muted("Nothing on the battlefield yet.");
}
