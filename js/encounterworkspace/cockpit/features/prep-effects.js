/**
 * P3b — the Effects tab: what is on the targets right now (hoverable, duration editable by hand, removable) and the
 * saved effects library (apply / delete). "New custom effect" opens P3a's shared builder inline.
 */

import {h} from "../dom.js";
import {
	applyEncounterEffect,
	deleteEncounterSavedEffect,
	fmtEncounterDuration,
	removeEncounterEffect,
	saveEncounterEffectDef,
	setEncounterEffectRounds,
} from "../../encounterworkspace-fx.js";
import {createCockpitEffectBuilder} from "./act-effect-builder.js";
import {getPrepCurrentEffectRows, parsePrepRounds} from "./prep-model.js";
import {acts, btn, input, lbl, muted, plural, scopeSeg, tip} from "./prep-ui.js";

const blurOnEnter = evt => { if (evt.key === "Enter") { evt.preventDefault(); evt.target.blur(); } };

async function pSetRounds (api, row, text) {
	const parsed = parsePrepRounds(text);
	if (parsed.error) return api.toast(parsed.error, {kind: "error"});
	if ((row.rounds ?? null) === parsed.rounds) return;
	const label = `${row.name} on ${row.label}: ${fmtEncounterDuration(parsed.rounds)}`;
	const next = await api.pCommit(label, draft => {
		if (row.kind === "fx") {
			setEncounterEffectRounds(draft, {instanceId: row.instanceId, effectId: row.effectId, rounds: parsed.rounds});
			return draft;
		}
		const inst = draft.instances.find(it => it.id === row.instanceId);
		if (!inst?.conditions.includes(row.name)) throw new Error("This condition has ended");
		inst.conditionDetails = {...inst.conditionDetails, [row.name]: {...inst.conditionDetails?.[row.name], rounds: parsed.rounds}};
		return draft;
	});
	if (next) api.toast(`${label}.`, {isUndo: true});
}

async function pRemoveRow (api, row) {
	if (row.kind === "cond") return api.actions.pCondition({condition: row.name, isAdd: false, targetIds: [row.instanceId]});
	const label = `End ${row.name} → ${row.label}`;
	const next = await api.pCommit(label, (draft, {log}) => {
		removeEncounterEffect(draft, {targetIds: [row.instanceId], effectId: row.effectId, log});
		return draft;
	});
	if (next) api.toast(`${label}.`, {isUndo: true});
}

function rowName (api, ctx, row) {
	const ele = h("span.ewc-prep__fxn", {tabindex: "0"}, row.kind === "cond" ? `${row.name}`.toTitleCase() : row.name);
	const inst = ctx.state.instances.find(it => it.id === row.instanceId);
	if (row.kind === "cond") api.hover.bindCondition(ele, row.name, {conditionCatalog: ctx.conditionCatalog});
	else if (inst) api.hover.bindEffect(ele, inst, row.effect);
	return ele;
}

function renderCurrent (P, ids) {
	const {api, ctx} = P;
	const rows = getPrepCurrentEffectRows(ctx.state, ids, {labels: ctx.labels});
	if (!rows.length) return [muted(ids.length ? "No effects or conditions on them right now." : "View or select a creature to see its effects.")];
	const isMany = ids.length > 1;
	return [h("ul.ewc-prep__fx", {"aria-label": "Current effects"}, rows.map(row => h("li", {dataset: {ewcFxRow: row.key}},
		rowName(api, ctx, row),
		isMany ? h("span.ewc-muted.ewc-prep__fxw", null, row.label) : null,
		row.casterLabel ? h("span.ewc-muted.ewc-prep__fxw", {title: "Caster"}, `◉ ${row.casterLabel}`) : null,
		h("label.ewc-prep__dur", null,
			input({
				key: `fx-dur-${row.key}`,
				value: row.rounds ?? "",
				placeholder: "∞",
				isNum: true,
				isSm: true,
				ariaLabel: `Rounds left for ${row.name} on ${row.label} — empty means until removed`,
				onChange: value => pSetRounds(api, row, value),
				onKeydown: blurOnEnter,
			}),
			h("span.ewc-muted", null, "rounds"),
		),
		btn("Remove", () => pRemoveRow(api, row), {key: `fx-rm-${row.key}`, kind: "link", ariaLabel: `Remove ${row.name} from ${row.label}`}),
	)))];
}

async function pApplySaved (P, saved, ids) {
	const {api, ctx} = P;
	if (!ids.length) return api.toast("View or select a creature first.", {kind: "error"});
	const label = `${saved.name} → ${ids.length === 1 ? ctx.labels.get(ids[0]) : plural(ids.length, "creature")}`;
	const next = await api.pCommit(label, (draft, {log}) => {
		applyEncounterEffect(draft, {targetIds: ids, def: saved.key, ruleset: ctx.ruleset, log});
		return draft;
	});
	if (next) api.toast(`${label}.`, {isUndo: true});
}

async function pDeleteSaved (P, saved) {
	const next = await P.api.pCommit(`Delete saved effect ${saved.name}`, draft => {
		if (!deleteEncounterSavedEffect(draft, saved.key)) throw new Error("This saved effect no longer exists");
		return draft;
	});
	if (next) P.api.toast(`Deleted saved effect ${saved.name}.`, {isUndo: true});
}

function renderSaved (P, ids) {
	const {api, ctx} = P;
	const saved = ctx.state.savedEffects || [];
	return [
		lbl("Saved effects"),
		saved.length
			? h("ul.ewc-prep__fx.ewc-prep__fx--saved", {"aria-label": "Saved effects"}, saved.map(it => {
				const name = h("span.ewc-prep__fxn", {tabindex: "0"}, it.name);
				api.hover.bindEntry(name, `ewc-prep-saved:${it.key}`, {type: "entries", name: it.name, entries: [it.note, `Duration: ${fmtEncounterDuration(it.duration ?? null)}`, it.conc ? "Concentration" : null].filter(Boolean)});
				return h("li", {dataset: {ewcSaved: it.key}},
					name,
					h("span.ewc-muted.ewc-prep__fxw", null, fmtEncounterDuration(it.duration ?? null)),
					btn(`Apply to ${ids.length === 1 ? ctx.labels.get(ids[0]) : ids.length ? plural(ids.length, "creature") : "—"}`, () => pApplySaved(P, it, ids), {key: `saved-apply-${it.key}`, disabled: !ids.length}),
					btn("Delete", () => pDeleteSaved(P, it), {key: `saved-del-${it.key}`, kind: "link", ariaLabel: `Delete saved effect ${it.name}`}),
				);
			}))
			: muted("No saved effects yet — save a custom effect to reuse it here."),
	];
}

export function renderPrepEffectsTab (P) {
	const ids = P.getTargetIds();
	return [
		scopeSeg(P),
		lbl("On them now"),
		...renderCurrent(P, ids),
		tip("Durations count down at the end of each round. Leave empty for “until removed”. Concentration effects end when their caster drops it."),
		h("div.ewc-prep__sep"),
		...renderSaved(P, ids),
		...renderBuilder(P),
	];
}

async function pAddCustom (P, def, {isSave}) {
	const {api} = P;
	const ctx = api.getCtx();
	const ids = P.getTargetIds();
	if (!ids.length && !isSave) throw new Error("View or select a creature to apply it to — or tick “Save for reuse”.");
	const label = ids.length ? `${def.name} → ${ids.length === 1 ? ctx.labels.get(ids[0]) : plural(ids.length, "creature")}` : `Save ${def.name}`;
	const next = await api.pCommit(label, (draft, {log}) => {
		const saved = isSave ? saveEncounterEffectDef(draft, def) : null;
		if (ids.length) applyEncounterEffect(draft, {targetIds: ids, def: saved || def, rounds: def.duration, casterId: def.conc ? ctx.activeInstanceId : null, ruleset: ctx.ruleset, log});
		return draft;
	});
	if (!next) return false;
	P.S.isFxBuilderOpen = false;
	api.toast(`${label}.`, {isUndo: true});
	P.rerender();
}

function renderBuilder (P) {
	const {S} = P;
	S.fxBuilder ||= createCockpitEffectBuilder({
		fk: "prep-fxb",
		submitLabel: "Add & apply",
		isSaveDefault: true,
		onSubmit: (def, meta) => pAddCustom(S.fxBuilderP, def, meta),
		onCancel: () => { S.isFxBuilderOpen = false; S.fxBuilderP.rerender(); },
	});
	S.fxBuilderP = P;
	const toggle = btn(S.isFxBuilderOpen ? "▾ New custom effect" : "＋ New custom effect", () => {
		S.isFxBuilderOpen = !S.isFxBuilderOpen;
		P.rerender();
		if (S.isFxBuilderOpen) S.fxBuilder.focus();
	}, {key: "fx-new"});
	toggle.setAttribute("aria-expanded", `${!!S.isFxBuilderOpen}`);
	if (!S.isFxBuilderOpen) return [acts(toggle)];
	const host = h("div.ewc-prep__fxb");
	S.fxBuilder.render(host);
	return [acts(toggle), host];
}
