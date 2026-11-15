/**
 * P3b — the Creature tab: quick edit, full statblock editor, templates (Elite/Weak/Minion/Legendary + creature-type
 * transforms), legendary actions, habitat traits and challenge rating. Templates are statblock changes, not effects.
 */

import {h, kbd} from "../dom.js";
import {getCockpitKeyLabels} from "../keymap.js";
import {EncounterWorkspaceState, getEncounterPartyMonster} from "../../encounterworkspace-state.js";
import {
	ENCOUNTER_TEMPLATES,
	getEncounterHasTemplate,
	getEncounterInstanceTemplates,
	withEncounterTemplate,
	withoutEncounterTemplate,
} from "../../encounterworkspace-templates.js";
import {
	ENCOUNTER_APPLIED_CR_OPERATION_ID,
	withEncounterAppliedCr,
	withoutEncounterAppliedCr,
} from "../../encounterworkspace-party.js";
import {getEncounterCrEstimate, getEncounterCrInferences} from "../../encounterworkspace-assessment.js";
import {BestiaryQuickActionsOperations} from "../../../bestiary/bestiary-quick-actions-engine.js";
import {BestiaryQuickActionsStructuredEditor} from "../../../bestiary/bestiary-quick-actions-structured.js";
import {BestiaryQuickActionsUi} from "../../../bestiary/bestiary-quick-actions-ui.js";
import {
	PREP_CREATURE_SUBS,
	fmtPrepCr,
	getPrepCrAssumptions,
	getPrepCrText,
	getPrepQuickEditChange,
	getPrepAreaTraitGroups,
	getPrepQuickEditCurrent,
	getPrepQuickEditDiff,
	validatePrepQuickEdit,
} from "./prep-model.js";
import {PREP_EDITOR_SECTIONS, pOpenPrepStatblockEditor} from "./prep-editor.js";
import {acts, btn, diffList, esc, field, getErrorText, input, lbl, muted, plural, scopeSeg, seg, tip} from "./prep-ui.js";

export const getPrepCreatureDraft = () => ({
	creSub: "edit",
	qe: {name: "", hpMax: "", ac: "", speed: "", initBonus: ""},
	tplSel: "elite",
	tplPreview: false,
	legendary: {name: "", cost: "1", text: ""},
	traitSel: null,
	crOverrides: {},
});

const getTargets = (P, ids) => ids.map(id => P.ctx.state.instances.find(it => it.id === id)).filter(Boolean);

/* -------------------------------------------- Quick edit -------------------------------------------- */

function getQuickEditPlan (P, ids) {
	const {ctx, S} = P;
	const isSingle = ids.length === 1;
	const check = validatePrepQuickEdit(S.qe, {isSingle});
	const targets = getTargets(P, ids).map(inst => ({id: inst.id, label: ctx.labels.get(inst.id), inst, current: getPrepQuickEditCurrent(inst, ctx.getEffective(inst))}));
	const diff = getPrepQuickEditDiff(targets, check.values).filter(it => it.changes.length);
	return {check, targets, diff, isSingle};
}

/** Pure-ish recipe: returns the next state for the quick edit of `targets` (party members are rebuilt from stats). */
function withQuickEdit (state, targets, values, getEffective) {
	let next = state;
	const changes = [];
	const byId = new Map(targets.map(it => [it.id, it]));
	const instances = next.instances.map(inst => {
		const target = byId.get(inst.id);
		if (!target) return inst;
		let out = inst;
		if (values.name != null) out = {...out, label: values.name === (inst.monster?.name || "") ? null : values.name};
		if (inst.kind === "party" && inst.party) {
			const stats = {...inst.party, ...(values.ac != null ? {ac: values.ac} : {}), ...(values.speed != null ? {speed: values.speed} : {}), ...(values.initBonus != null ? {initBonus: values.initBonus} : {})};
			const max = values.hpMax ?? inst.hp.max ?? 1;
			out = {
				...out,
				party: stats,
				monster: getEncounterPartyMonster({name: inst.monster.name, ac: stats.ac, hpMax: max, speed: stats.speed, initBonus: stats.initBonus}),
				hp: {...inst.hp, max, current: Math.min(inst.hp.current ?? max, max)},
			};
			return out;
		}
		const change = getPrepQuickEditChange(inst, getEffective(inst), values);
		if (change) changes.push(change);
		return out;
	});
	next = EncounterWorkspaceState.validate({...next, instances});
	if (changes.length) next = EncounterWorkspaceState.withStatblockChanges(next, changes).state;
	return next;
}

async function pApplyQuickEdit (P) {
	const {api, ctx, S} = P;
	const ids = P.getTargetIds();
	const {check, targets, diff} = getQuickEditPlan(P, ids);
	const errors = Object.values(check.errors);
	if (errors.length) return api.toast(errors[0], {kind: "error"});
	if (!diff.length) return api.toast("Nothing to change — type a new value first.");
	const who = ids.length === 1 ? ctx.labels.get(ids[0]) : plural(diff.length, "creature");
	const label = `Quick edit → ${who}`;
	const next = await api.pCommit(label, state => withQuickEdit(state, targets.filter(it => diff.some(d => d.id === it.id)), check.values, ctx.getEffective));
	if (!next) return;
	api.toast(`${label}.`, {isUndo: true});
	S.qe = {name: "", hpMax: "", ac: "", speed: "", initBonus: ""};
	P.rerender();
}

function renderQuickEdit (P, ids) {
	const {S, ctx, rerender} = P;
	if (!ids.length) return [muted("View or select a creature to edit.")];
	const {check, targets, diff, isSingle} = getQuickEditPlan(P, ids);
	const current = isSingle ? targets[0]?.current : null;
	const set = key => value => { S.qe[key] = value; rerender(); };
	const onKeydown = evt => {
		if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) { evt.preventDefault(); evt.stopPropagation(); pApplyQuickEdit(P); }
	};
	const num = (key, label, placeholder) => field(label, input({key: `qe-${key}`, value: S.qe[key], placeholder: `${placeholder ?? "—"}`, isNum: true, onInput: set(key), onKeydown}));
	const errors = Object.entries(check.errors);
	const kb = kbd(getCockpitKeyLabels(["mod", "Enter"], {isMac: ctx.isMac}));
	return [
		h("div.ewc-prep__grid", null,
			isSingle ? field("Name", input({key: "qe-name", value: S.qe.name, placeholder: current?.name || "", onInput: set("name"), onKeydown})) : null,
			num("hpMax", "Max HP", current?.hpMax),
			num("ac", "AC", current?.ac),
			num("speed", "Speed", current?.speed),
			num("initBonus", "Init", current?.initBonus == null ? null : current.initBonus >= 0 ? `+${current.initBonus}` : current.initBonus),
		),
		errors.length ? h("p.ewc-error", {role: "alert"}, errors.map(([, text]) => text).join(" ")) : null,
		diff.length
			? h("div.ewc-prep__preview", null, h("span.ewc-prep__lbl", null, "Preview"), diffList(diff.map(row => ({
				label: row.label,
				html: row.changes.map(c => `${esc(c.label)} ${esc(c.before)} → <b>${esc(c.after)}</b>`).join(" · "),
			}))))
			: null,
		acts(
			btn(`Apply to ${ids.length === 1 ? ctx.labels.get(ids[0]) : plural(ids.length, "creature")}`, () => pApplyQuickEdit(P), {key: "qe-apply", kind: "primary", disabled: !diff.length || !!errors.length, extra: kb}),
			btn("Reset", () => { S.qe = {name: "", hpMax: "", ac: "", speed: "", initBonus: ""}; rerender(); }, {key: "qe-reset", kind: "ghost", disabled: !Object.values(S.qe).some(it => `${it}`.trim())}),
		),
		tip("Blank fields stay as they are. HP changes keep damage already taken; party members change here, not on their sheet."),
	];
}

/* -------------------------------------------- Statblock -------------------------------------------- */

function renderStatblockSub (P, ids) {
	const {api, ctx} = P;
	const viewed = ctx.ui.viewedId;
	const inst = ctx.state.instances.find(it => it.id === viewed);
	if (!inst) return [muted("View a creature to edit its statblock.")];
	if (inst.kind === "party") return [muted("Party members don't have a statblock to edit — use Quick edit.")];
	const ops = (inst.statblockOperations || []).length;
	return [
		h("p.ewc-prep__desc", null, "The full editor: every action, trait, spell and number on ", h("b", null, ctx.labels.get(viewed)), "'s statblock. Each save is one undoable step."),
		acts(
			btn("Edit statblock…", () => pOpenPrepStatblockEditor(api, viewed, {section: PREP_EDITOR_SECTIONS.edit}), {key: "sb-open", kind: "primary", extra: kbd(["I"])}),
			ops ? h("span.ewc-muted", null, `${plural(ops, "change")} so far`) : null,
		),
		ids.length > 1 ? tip("The full editor works on the viewed creature. For several at once use Quick edit, Templates or Legendary.") : tip("Save with Ctrl/⌘+Enter; Esc closes without saving."),
	];
}

/* -------------------------------------------- Templates -------------------------------------------- */

const TEMPLATE_EFFECT_TEXT = {
	tier: delta => `AC, attacks & save DCs ${delta > 0 ? "+" : "−"}${Math.abs(delta)}`,
	resources: () => "+ Legendary actions 3 · Legendary resistance 3/day",
	statblock: () => "Minion statblock",
};

function getTemplatePreview (P, ids, key) {
	try {
		const result = withEncounterTemplate(P.ctx.state, {key, ids});
		return {result};
	} catch (e) {
		return {error: getErrorText(e)};
	}
}

async function pApplyTemplate (P, ids, tpl) {
	const {api, ctx, S} = P;
	let result = null;
	const next = await api.pCommit(`Template: ${tpl.name}`, state => (result = withEncounterTemplate(state, {key: tpl.key, ids})).state);
	if (!next) return;
	const skipped = result.skipped?.length ? ` (${plural(result.skipped.length, "skipped")})` : "";
	api.toast(`Template: ${tpl.name} → ${result.appliedIds.length === 1 ? ctx.labels.get(result.appliedIds[0]) : plural(result.appliedIds.length, "creature")}${skipped}.`, {isUndo: true});
	S.tplPreview = false;
	P.rerender();
}

async function pRemoveTemplate (P, ids, key, name) {
	const {api} = P;
	let result = null;
	const next = await api.pCommit(`Remove template ${name}`, state => (result = withoutEncounterTemplate(state, {key, ids})).state);
	if (next) api.toast(`Removed ${name} from ${plural(result.removedIds.length, "creature")}.`, {isUndo: true});
}

function renderTemplates (P, ids) {
	const {ctx, S, rerender} = P;
	if (!ids.length) return [muted("View or select a creature to apply a template.")];
	const targets = getTargets(P, ids);
	const monsters = targets.filter(it => it.kind !== "party");
	const tpl = ENCOUNTER_TEMPLATES.find(it => it.key === S.tplSel) || ENCOUNTER_TEMPLATES[0];
	const applied = new Map();
	targets.forEach(inst => getEncounterInstanceTemplates(inst).forEach(it => applied.set(it.key, {name: it.name, count: (applied.get(it.key)?.count || 0) + 1})));

	let preview = null;
	if (S.tplPreview) {
		const {result, error} = getTemplatePreview(P, ids, tpl.key);
		if (error) preview = h("p.ewc-error", {role: "alert"}, error);
		else {
			const after = new Map(result.state.instances.map(it => [it.id, it]));
			const rows = result.appliedIds.map(id => {
				const before = targets.find(it => it.id === id);
				const next = after.get(id);
				return {label: ctx.labels.get(id), html: `HP max ${esc(before?.hp?.max ?? "—")} → <b>${esc(next?.hp?.max ?? "—")}</b>`};
			});
			preview = h("div.ewc-prep__preview", null,
				h("span.ewc-prep__lbl", null, `Preview · ${result.appliedIds.length} of ${ids.length}`),
				h("p.ewc-muted", null, `${TEMPLATE_EFFECT_TEXT[tpl.kind]?.(tpl.delta) || ""}${result.replaced?.length ? ` · replaces ${result.replaced.map(it => it.name || it).join(", ")}` : ""}`),
				rows.length ? diffList(rows) : null,
				result.skipped?.length ? h("p.ewc-muted", null, `Skipped: ${result.skipped.map(it => `${ctx.labels.get(it.id) || "?"} (${it.reason})`).join(", ")}`) : null,
			);
		}
	}
	const isAllHave = monsters.length && monsters.every(it => getEncounterHasTemplate(it, tpl.key));

	return [
		h("div.ewc-prep__tpls", {role: "group", "aria-label": "Templates"}, ENCOUNTER_TEMPLATES.map(it => h("button.ewc-prep__card", {
			type: "button",
			"aria-pressed": `${it.key === tpl.key}`,
			dataset: {ewcFk: `tpl-${it.key}`, ewcTpl: it.key},
			onclick: () => { S.tplSel = it.key; S.tplPreview = false; rerender(); },
		}, h("b", null, it.name), h("small", null, it.description)))),
		preview,
		acts(
			btn("Preview", () => { S.tplPreview = true; rerender(); }, {key: "tpl-preview", disabled: !monsters.length}),
			btn(`Apply ${tpl.name} → ${ids.length === 1 ? ctx.labels.get(ids[0]) : plural(ids.length, "creature")}`, () => pApplyTemplate(P, ids, tpl), {key: "tpl-apply", kind: "primary", disabled: !S.tplPreview || !monsters.length || isAllHave}),
		),
		applied.size
			? h("div.ewc-prep__applied", null, h("span.ewc-prep__lbl", null, "On them"), [...applied].map(([key, it]) => h("span.ewc-pill.ewc-pill--tpl.ewc-prep__chip", null,
				`${it.name}${ids.length > 1 ? ` ×${it.count}` : ""}`,
				h("button.ewc-prep__chipx", {type: "button", "aria-label": `Remove ${it.name}`, title: "Remove", dataset: {ewcFk: `tpl-rm-${key}`}, onclick: () => pRemoveTemplate(P, ids, key, it.name)}, "×"),
			)))
			: null,
		h("div.ewc-prep__sep"),
		lbl("Creature types"),
		h("p.ewc-muted.ewc-prep__muted", null, "Half-dragon, zombie, skeleton… guided — choices are asked where the rules need them."),
		monsters.length ? null : muted("Party members can't take a creature type."),
	];
}

/* -------------------------------------------- Legendary -------------------------------------------- */

function getLegendaryPreview (P, ids) {
	const L = P.S.legendary;
	const name = L.name.trim();
	const text = L.text.trim();
	if (!name || !text) return null;
	try {
		const cost = Math.min(9, Math.max(1, Number(L.cost) || 1));
		const operation = {
			...BestiaryQuickActionsOperations.addEntry({section: "legendary", entry: {name: BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name, cost}), entries: [text]}}),
			id: CryptUtil.uid(),
		};
		const monsterIds = getTargets(P, ids).filter(it => it.kind !== "party").map(it => it.id);
		if (!monsterIds.length) return {error: "Party members can't take legendary actions."};
		return {preview: EncounterWorkspaceState.previewBulkStatblockOperation(P.ctx.state, {operation, targetIds: monsterIds}), name};
	} catch (e) {
		return {error: getErrorText(e)};
	}
}

function renderLegendary (P, ids) {
	const {api, ctx, S, rerender} = P;
	if (!ids.length) return [muted("View or select a creature to give it legendary actions.")];
	const L = S.legendary;
	const set = key => value => { L[key] = value; rerender(); };
	const plan = getLegendaryPreview(P, ids);
	const changed = plan?.preview?.changedIds || [];
	const pApply = async () => {
		const fresh = getLegendaryPreview(P, ids);
		if (!fresh?.preview?.changedIds?.length) return api.toast(fresh?.error || "Nobody can take it.", {kind: "error"});
		const next = await api.pCommit(`Legendary: ${fresh.name}`, () => fresh.preview.state);
		if (!next) return;
		api.toast(`Legendary: ${fresh.name} → ${plural(fresh.preview.changedIds.length, "creature")}.`, {isUndo: true});
		S.legendary = {name: "", cost: "1", text: ""};
		rerender();
	};
	return [
		h("div.ewc-prep__grid", null,
			field("Name", input({key: "leg-name", value: L.name, placeholder: "Tail Swipe", onInput: set("name")})),
			field("Cost", input({key: "leg-cost", value: L.cost, isNum: true, onInput: set("cost")}), {hint: "1–9"}),
			field("Text", input({key: "leg-text", value: L.text, rows: 2, placeholder: "The creature makes one claw attack.", onInput: set("text")}), {wide: true}),
		),
		plan?.error ? h("p.ewc-error", {role: "alert"}, plan.error) : null,
		plan?.preview
			? h("div.ewc-prep__preview", null,
				h("span.ewc-prep__lbl", null, `Preview · ${changed.length} of ${ids.length} eligible`),
				plan.preview.skipped?.length ? h("p.ewc-muted", null, `Skipped: ${plan.preview.skipped.map(it => `${ctx.labels.get(it.id)} (${it.reason})`).join(", ")}`) : null,
			)
			: muted("Name and text, then preview who gets it."),
		acts(btn(`Apply Legendary: ${L.name.trim() || "…"} → ${plural(changed.length, "creature")}`, pApply, {key: "leg-apply", kind: "primary", disabled: !changed.length})),
		tip("Adds a legendary action to the statblock. Use the Legendary template for the usual 3 actions and 3 resistances per day."),
	];
}

/* -------------------------------------------- Habitat traits -------------------------------------------- */

let _traits = null;
let _pTraits = null;
const pGetAreaTraits = () => (_pTraits ||= BestiaryQuickActionsUi._pLoadAreaTraits()
	.then(list => { _traits = list; return list; })
	.catch(e => { _pTraits = null; throw e; }));

const getTraitUid = trait => BestiaryQuickActionsUi.getRuleUid(trait);
const getTraitHover = trait => ({type: "entries", name: `${trait.name} (${trait._areaName})`, entries: trait.entries?.length ? trait.entries : ["No description."]});

function getTraitPreview (P, ids, trait, choices = {}) {
	const monsterIds = getTargets(P, ids).filter(it => it.kind !== "party").map(it => it.id);
	if (!monsterIds.length) return {error: "Party members don't take habitat traits."};
	try {
		const operation = {...BestiaryQuickActionsUi.getAreaTraitOperation({trait, choices}), id: CryptUtil.uid()};
		return {preview: EncounterWorkspaceState.previewBulkStatblockOperation(P.ctx.state, {operation, targetIds: monsterIds})};
	} catch (e) {
		return {error: getErrorText(e)};
	}
}

function renderTraits (P, ids) {
	const {api, ctx, S, rerender} = P;
	const viewed = ctx.ui.viewedId;
	const editorBtn = viewed && ctx.state.instances.find(it => it.id === viewed)?.kind !== "party"
		? btn("Choose a habitat trait…", () => pOpenPrepStatblockEditor(api, viewed, {section: PREP_EDITOR_SECTIONS.area, label: "Habitat trait"}), {key: "traits-open", kind: "ghost"})
		: null;
	const intro = h("p.ewc-prep__desc", null, "From ", h("i", null, "Flee, Mortals!"), " (homebrew) — ", h("b", null, "illustrative"), ". Each trait really changes the statblock (speed, senses, resistances, entries). Hover a trait to read it.");
	if (!_traits) {
		pGetAreaTraits().then(() => rerender()).catch(e => api.toast(`Could not load habitat traits: ${getErrorText(e)}.`, {kind: "error"}));
		return [intro, muted("Loading habitat traits…"), acts(editorBtn)];
	}
	const groups = getPrepAreaTraitGroups(_traits);
	if (!groups.length) return [intro, muted("No habitat traits are loaded — add the Flee, Mortals! homebrew to browse them here."), acts(editorBtn)];
	const sel = _traits.find(it => getTraitUid(it) === S.traitSel) || null;
	const monsters = getTargets(P, ids).filter(it => it.kind !== "party");
	const appliedTo = trait => monsters.filter(inst => (inst.statblockOperations || []).some(op => op.type === "applyAreaTrait" && op.sourceUid === getTraitUid(trait)));
	const plan = sel ? getTraitPreview(P, ids, sel) : null;
	const changed = plan?.preview?.changedIds || [];
	const pApply = async () => {
		const trait = sel;
		const uid = getTraitUid(trait);
		let choices;
		try {
			choices = await BestiaryQuickActionsUi._pGetAreaTraitChoices({traits: [trait]});
		} catch (e) {
			return api.toast(`Could not configure ${trait.name}: ${getErrorText(e)}.`, {kind: "error"});
		}
		if (choices == null) return api.toast(`${trait.name}: cancelled — no statblocks changed.`);
		const fresh = getTraitPreview(P, P.getTargetIds(), trait, choices.get(uid) || {});
		if (!fresh?.preview?.changedIds?.length) return api.toast(fresh?.error || `Nobody can take ${trait.name}.`, {kind: "error"});
		const next = await api.pCommit(`Habitat trait: ${trait.name}`, () => fresh.preview.state);
		if (!next) return;
		api.toast(`${trait.name} → ${plural(fresh.preview.changedIds.length, "creature")}.`, {isUndo: true});
		rerender();
	};
	return [
		intro,
		h("div.ewc-prep__traits", {dataset: {ewcTraits: "catalogue"}}, groups.map(group => h("div.ewc-prep__traitg", {role: "group", "aria-label": group.area},
			h("p.ewc-prep__lbl.ewc-prep__lbl--block.ewc-prep__traitarea", null, group.area),
			h("div.ewc-prep__acts", null, group.traits.map(trait => {
				const uid = getTraitUid(trait);
				const nApplied = appliedTo(trait).length;
				const ele = h(`button.ewc-btn.ewc-btn--sm.ewc-prep__trait${S.traitSel === uid ? ".is-on" : ""}${nApplied ? ".is-applied" : ""}`, {
					type: "button",
					"aria-pressed": `${S.traitSel === uid}`,
					dataset: {ewcFk: `trait-${uid}`, ewcTrait: uid},
					onclick: () => { S.traitSel = S.traitSel === uid ? null : uid; rerender(); },
				}, trait.name, nApplied ? h("span.ewc-prep__traitok", {"aria-label": `, on ${plural(nApplied, "creature")}`}, " ✓") : null);
				api.hover.bindEntry(ele, `ewc-trait:${uid}`, getTraitHover(trait));
				return ele;
			})),
		))),
		sel
			? h("div.ewc-prep__preview", {dataset: {ewcTraitPreview: getTraitUid(sel)}},
				h("span.ewc-prep__lbl", null, plan?.preview ? `${sel.name} · ${changed.length} of ${monsters.length} eligible` : sel.name),
				plan?.error ? h("p.ewc-error", {role: "alert"}, plan.error) : null,
				plan?.preview?.skipped?.length ? h("p.ewc-muted", null, `Skipped: ${plan.preview.skipped.map(it => `${ctx.labels.get(it.id)} (${it.reason})`).join(", ")}`) : null,
			)
			: muted("Pick a trait to preview who gets it."),
		acts(
			sel ? btn(`Apply ${sel.name} → ${plural(changed.length, "creature")}`, pApply, {key: "trait-apply", kind: "primary", disabled: !changed.length}) : null,
			editorBtn,
		),
		tip("Some traits ask a question first (a damage type, a sense). Applied traits are listed in the statblock editor, where each can be removed. Undoable."),
	];
}

/* -------------------------------------------- Challenge rating -------------------------------------------- */

let _pCrRows = null;
const pGetCrRows = () => (_pCrRows ||= DataUtil.loadJSON("data/msbcr.json").then(it => it.cr).catch(e => { _pCrRows = null; throw e; }));

function renderCr (P, ids) {
	const {api, ctx, S, rerender} = P;
	const monsters = getTargets(P, ids).filter(it => it.kind !== "party");
	if (!monsters.length) return [muted("View or select a monster to check its challenge rating.")];
	if (!S.crRows) {
		pGetCrRows().then(rows => { S.crRows = rows; rerender(); }).catch(e => api.toast(`Could not load the CR table: ${getErrorText(e)}.`, {kind: "error"}));
		return [muted("Loading the CR table…")];
	}
	const rows = monsters.slice(0, 10).map(inst => {
		const effective = ctx.getEffective(inst);
		const inf = getEncounterCrInferences(inst);
		const overrides = S.crOverrides[inst.id] || {};
		const {values, missing} = getPrepCrAssumptions(inf.values, effective, overrides);
		let estimate = null;
		let error = null;
		if (!missing.length) {
			try { estimate = getEncounterCrEstimate(values, S.crRows); } catch (e) { error = getErrorText(e); }
		}
		const listed = getPrepCrText(effective) || "—";
		const isApplied = (inst.statblockOperations || []).some(op => op.id === ENCOUNTER_APPLIED_CR_OPERATION_ID);
		return {inst, values, missing, estimate, error, listed, isApplied, overrides};
	});
	const pApply = async (row, cr) => {
		const label = `CR ${fmtPrepCr(cr)} → ${ctx.labels.get(row.inst.id)}`;
		const next = await api.pCommit(label, state => withEncounterAppliedCr(state, {ids: [row.inst.id], cr}).state);
		if (next) api.toast(`${label}.`, {isUndo: true});
	};
	const pRemove = async row => {
		const label = `Restore listed CR → ${ctx.labels.get(row.inst.id)}`;
		const next = await api.pCommit(label, state => withoutEncounterAppliedCr(state, {ids: [row.inst.id]}).state);
		if (next) api.toast(`${label}.`, {isUndo: true});
	};
	const setOverride = (id, key) => value => { S.crOverrides[id] = {...S.crOverrides[id], [key]: value}; rerender(); };
	return [
		h("ul.ewc-prep__cr", null, rows.map(row => {
			const id = row.inst.id;
			const est = row.estimate?.cr;
			const isDiff = est != null && `${est}` !== `${row.listed}`;
			return h("li.ewc-prep__crrow", {dataset: {ewcCr: id}},
				h("div.ewc-prep__crh", null,
					h("b", null, ctx.labels.get(id)),
					h("span.ewc-prep__crv", null, `CR ${fmtPrepCr(row.listed)}`, est != null ? (isDiff ? [" → ", h("b.ewc-prep__crn", null, fmtPrepCr(est))] : h("span.ewc-muted", null, " · fits")) : null),
					isDiff ? btn(`Apply CR ${fmtPrepCr(est)}`, () => pApply(row, est), {key: `cr-apply-${id}`, kind: "primary"}) : null,
					row.isApplied ? btn("Restore listed CR", () => pRemove(row), {key: `cr-rm-${id}`, kind: "link"}) : null,
				),
				row.estimate
					? h("p.ewc-prep__crd", null, `HP ${row.values.hp} · AC ${row.values.ac} · ${row.values.attackType === "save" ? `DC ${row.values.attackValue}` : `${row.values.attackValue >= 0 ? "+" : ""}${row.values.attackValue} to hit`} · ${row.estimate.dpr} dmg/round `,
						h("span.ewc-muted", null, `→ defensive ${fmtPrepCr(row.estimate.defensiveCr)}, offensive ${fmtPrepCr(row.estimate.offensiveCr)}`))
					: null,
				row.error ? h("p.ewc-error", null, row.error) : null,
				row.missing.length
					? h("div.ewc-prep__crmiss", null,
						h("span.ewc-muted", null, "Can't tell from the statblock — enter:"),
						row.missing.map(m => field(m.label, input({key: `cr-${id}-${m.key}`, value: row.overrides[m.key] || "", isNum: true, isSm: true, onInput: setOverride(id, m.key)}))))
					: null,
			);
		})),
		monsters.length > 10 ? muted(`Showing 10 of ${monsters.length}.`) : null,
		tip("Estimate from the DMG “Creating a Monster” table. Applying sets the listed CR and XP — attacks and DCs stay as written. Undoable."),
	];
}

/* -------------------------------------------- Tab -------------------------------------------- */

export function renderPrepCreatureTab (P) {
	const {S, rerender} = P;
	const ids = P.getTargetIds();
	const sub = PREP_CREATURE_SUBS.some(it => it.id === S.creSub) ? S.creSub : "edit";
	const body = {
		edit: () => renderQuickEdit(P, ids),
		sb: () => renderStatblockSub(P, ids),
		tpl: () => renderTemplates(P, ids),
		legendary: () => renderLegendary(P, ids),
		traits: () => renderTraits(P, ids),
		cr: () => renderCr(P, ids),
	}[sub]();
	return [
		seg({label: "Creature tools", key: "cre-sub", value: sub, items: PREP_CREATURE_SUBS, onPick: id => { S.creSub = id; S.tplPreview = false; rerender(); }, isWrap: true}),
		sub === "sb" ? null : scopeSeg(P),
		...body,
	];
}
