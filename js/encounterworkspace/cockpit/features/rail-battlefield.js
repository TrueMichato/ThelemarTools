/**
 * The battlefield extras, built only on the cockpit API:
 * - a BATTLEFIELD strip at the top of the stage, above the viewed statblock: one chip per active entry, an
 *   always-visible "+ Battlefield" and the encounter note;
 * - a "◐ Blinded" badge on rows (and a line on the statblock) when darkness or fog leaves a creature unable to see;
 * - a "Lair actions · init 20 · loses ties" row in initiative, with a reminder when the turn passes count 20.
 */

import {h, replaceKeepingFocus} from "../dom.js";
import {EncounterWorkspaceState} from "../../encounterworkspace-state.js";
import {getEncounterBattlefieldTurnRows, getEncounterSight} from "../../encounterworkspace-battlefield.js";
import {getPrepBattlefieldChips, getPrepBattlefieldHoverEntry} from "./prep-area.js";
import {RAIL_LAIR_INITIATIVE, getIsRailLairTurnCrossed, getRailLairIndex} from "./rail-battlefield-model.js";

const NOTE_MAX = 500;
const SB_ROW_CLASS = "ewc-sight-sb";

const SIGHT_TEXT = {
	blinded: {glyph: "◐", label: "Blinded", rules: "can't see: fails checks that need sight; its attack rolls have disadvantage; attack rolls against it have advantage"},
	dim: {glyph: "◑", label: "Lightly obscured", rules: "disadvantage on Wisdom (Perception) checks that rely on sight"},
};

function getSight (state, instance) {
	if (!state.battlefield?.length) return {status: "normal"};
	try {
		return getEncounterSight(state, instance);
	} catch (e) {
		return {status: "normal"};
	}
}

export function installCockpitRailBattlefield (api, {onEdit, onAdd}) {
	let noteDraft = null;
	let isLairQueued = false;

	/* ---------------- BATTLEFIELD section ---------------- */

	async function pSaveNote () {
		if (noteDraft == null) return;
		const text = noteDraft.trim().slice(0, NOTE_MAX);
		noteDraft = null;
		const before = api.getState().encounterNote || "";
		if (text === before) return api.render();
		const next = await api.pCommit(text ? "Encounter note" : "Encounter note cleared", draft => EncounterWorkspaceState.withEncounterNote(draft, text));
		if (!next) return api.render();
		api.toast(text ? "Encounter note saved." : "Encounter note cleared.", {isUndo: true});
	}

	function startNote () {
		noteDraft = api.getState().encounterNote || "";
		api.render();
		const input = document.querySelector("[data-ewc-fk=\"rbf-note-input\"]");
		if (input) {
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}
	}

	function renderNote (ctx) {
		const note = ctx.state.encounterNote || "";
		const lbl = h("span.ewc-rbf__l.ewc-rbf__l--note", {id: "ewc-rbf-note-l"}, "Note");
		if (noteDraft != null) {
			const input = h("textarea.ewc-input.ewc-rbf__noteinput", {
				rows: 2,
				maxlength: `${NOTE_MAX}`,
				"aria-labelledby": "ewc-rbf-note-l",
				"aria-describedby": "ewc-rbf-note-h",
				placeholder: "Cragmaw hideout — cave mouth, rubble everywhere…",
				"data-ewc-fk": "rbf-note-input",
				"data-ewc-rbf": "note-input",
				oninput: evt => { noteDraft = evt.target.value; },
				onkeydown: evt => {
					evt.stopPropagation();
					if (evt.key === "Escape") {
						evt.preventDefault();
						noteDraft = null;
						api.render();
						document.querySelector("[data-ewc-fk=\"rbf-note\"]")?.focus({preventScroll: true});
					} else if (evt.key === "Enter" && !evt.shiftKey) {
						evt.preventDefault();
						pSaveNote().then(() => document.querySelector("[data-ewc-fk=\"rbf-note\"]")?.focus({preventScroll: true}));
					}
				},
				onblur: () => { pSaveNote(); },
			});
			input.value = noteDraft;
			return h("div.ewc-rbf__note.is-editing", null, lbl, input,
				h("small.ewc-rbf__hint.ewc-muted", {id: "ewc-rbf-note-h"}, "Enter saves · Shift+Enter new line · Esc cancels"));
		}
		return h("div.ewc-rbf__note", null, lbl,
			h(`button.ewc-rbf__notetext${note ? "" : ".is-empty"}`, {
				type: "button",
				"data-ewc-fk": "rbf-note",
				"data-ewc-rbf": "note",
				title: note ? `${note}\n\nClick to edit the encounter note` : "Add a note for this encounter (where, what's going on)",
				"aria-label": note ? `Encounter note: ${note}. Edit` : "Add an encounter note",
				onclick: startNote,
			}, note || "Add a note…"));
	}

	// Persistent, so a note being typed keeps its focus and caret across renders (replaceKeepingFocus).
	const section = h("section.ewc-rbf", {"aria-label": "Battlefield", "data-ewc-rbf": "section", hidden: true});
	api.getRegion("stageTop").append(section);
	api.onRender(ctx => {
		section.hidden = !ctx.state.instances.length;
		if (section.hidden) return section.replaceChildren();
		replaceKeepingFocus(section, [
			h("div.ewc-rbf__row", null,
				h("span.ewc-rbf__l", {"aria-hidden": "true"}, "Battlefield"),
				getPrepBattlefieldChips(api, ctx, {onEdit}),
				h("button.ewc-rbf__add", {
					type: "button",
					"data-ewc-fk": "rbf-add",
					"data-ewc-rbf": "add",
					title: "Add light, cover, terrain, weather, a hazard or lair actions (opens prep mode → Battlefield)",
					onclick: () => onAdd(),
				}, "+ Battlefield"),
				renderNote(ctx),
			),
		]);
	});

	/* ---------------- Sight: row badge + statblock line ---------------- */

	api.addRailRowDecorator((row, instance, ctx) => {
		if (!isLairQueued) {
			isLairQueued = true;
			queueMicrotask(() => {
				isLairQueued = false;
				placeLairRow(api.getCtx());
			});
		}
		const sight = getSight(ctx.state, instance);
		if (sight.status !== "blinded") return;
		const text = SIGHT_TEXT.blinded;
		const pill = h("span.ewc-pill.ewc-pill--blind", {
			tabindex: "0",
			"data-ewc-sight": sight.status,
			title: `${text.label} by ${sight.name} (${sight.why}) — ${text.rules}`,
			"aria-label": `${text.label} by ${sight.name}`,
		}, h("span", {"aria-hidden": "true"}, `${text.glyph} `), text.label);
		if (sight.entry) api.hover.bindEntry(pill, `ewc-sight:${instance.id}:${sight.entry.id}`, getSightHover(ctx, sight));
		const pills = row.querySelector(".ewc-row__pills");
		if (pills) return pills.prepend(pill);
		const slot = row.querySelector(".ewc-row__slot");
		if (slot) return slot.prepend(h("span.ewc-row__pills", null, pill));
		const sub = row.querySelector(".ewc-row__sub");
		const conc = sub?.querySelector(".ewc-row__conc");
		if (conc) conc.after(pill);
		else sub?.append(pill);
	});

	function getSightHover (ctx, sight) {
		const text = SIGHT_TEXT[sight.status];
		const base = getPrepBattlefieldHoverEntry(ctx.state, sight.entry, {labels: ctx.labels});
		return {type: "entries", name: `${text.label} — ${sight.name}`, entries: [`{@b ${sight.why}}: ${text.rules}.`, ...base.entries]};
	}

	api.addStatblockDecorator((table, instance, ctx) => {
		if (!table) return;
		table.querySelectorAll(`tr.${SB_ROW_CLASS}`).forEach(it => it.remove());
		const sight = getSight(ctx.state, instance);
		const text = SIGHT_TEXT[sight.status];
		if (!text) return;
		const tbody = table.querySelector("tbody");
		if (!tbody) return;
		const name = h("b", {tabindex: "0"}, `${text.glyph} ${text.label}`);
		if (sight.entry) api.hover.bindEntry(name, `ewc-sight-sb:${instance.id}:${sight.entry.id}`, getSightHover(ctx, sight));
		const tr = h(`tr.${SB_ROW_CLASS}`, {"data-ewc-sight": sight.status}, h("td", {colspan: "6"},
			h(`div.ewc-sight-sb__in.is-${sight.status}`, null, name, ` (${sight.name}; ${sight.why}) — ${text.rules}.`)));
		const nameRow = tbody.querySelector("tr");
		if (nameRow?.nextSibling) tbody.insertBefore(tr, nameRow.nextSibling);
		else tbody.append(tr);
	});

	/* ---------------- Lair actions row ---------------- */

	function placeLairRow (ctx) {
		const list = document.querySelector(".ewc .ewc-rail__list");
		if (!list) return;
		list.querySelectorAll(":scope > .ewc-lairrow").forEach(it => it.remove());
		const lair = getEncounterBattlefieldTurnRows(ctx.state)[0];
		// The Groups view lists creatures by group, not by turn: no initiative slot to show.
		if (!lair || list.classList.contains("ewc-rail__list--groups")) return;
		// Creature rows, plus a stacked group's row or expanded header, which take the group's (shared) initiative.
		const rows = [...list.querySelectorAll(":scope > li.ewc-row[data-ewc-id], :scope > li[data-ewc-stack], :scope > li[data-ewc-ghead]")];
		const byId = new Map(ctx.state.instances.map(it => [it.id, it]));
		const getGroupLead = name => ctx.orderIds.map(id => byId.get(id)).find(it => it && !it.defeated && it.customGroup === name);
		const inits = rows.map(row => {
			const instance = row.dataset.ewcId ? byId.get(row.dataset.ewcId) : getGroupLead(row.dataset.ewcStack ?? row.dataset.ewcGhead);
			return instance ? ctx.initiativeOf(instance) : null;
		});
		const ix = getRailLairIndex(inits, {initiative: lair.initiative ?? RAIL_LAIR_INITIATIVE});
		if (ix < 0) return;
		const entry = (ctx.state.battlefield || []).find(it => it.id === lair.entryId);
		const name = h("button.ewc-lairrow__name", {
			type: "button",
			title: "Lair actions — edit on the battlefield",
			onclick: () => onEdit(lair.entryId),
		}, h("span", {"aria-hidden": "true"}, "⌂ "), lair.name);
		if (entry) api.hover.bindEntry(name, `ewc-lairrow:${entry.id}`, getPrepBattlefieldHoverEntry(ctx.state, entry, {labels: ctx.labels}));
		const li = h("li.ewc-lairrow", {"data-ewc-lair": lair.entryId, "aria-label": `${lair.name}: initiative ${lair.initiative}, loses ties`},
			h("span.ewc-lairrow__init", {"aria-hidden": "true"}, `${lair.initiative}`),
			name,
			h("span.ewc-lairrow__meta", null, `init ${lair.initiative} · loses ties`));
		list.insertBefore(li, rows[ix] || null);
	}

	api.onRender(ctx => placeLairRow(ctx));

	const getTurnInit = state => {
		const activeId = state?.turn?.activeId;
		if (!activeId) return null;
		return EncounterWorkspaceState.getInitiativeOrder(state).find(it => it.id === activeId)?.initiative ?? null;
	};

	api.onTurnChanged(({before, after}) => {
		const lair = after ? getEncounterBattlefieldTurnRows(after)[0] : null;
		if (!lair) return;
		const isCrossed = getIsRailLairTurnCrossed(
			{round: before?.turn?.round, init: getTurnInit(before)},
			{round: after?.turn?.round, init: getTurnInit(after)},
			{initiative: lair.initiative ?? RAIL_LAIR_INITIATIVE},
		);
		if (isCrossed) api.toast(`⌂ ${lair.name} — initiative ${lair.initiative} (loses ties) came up before this turn.`);
	});
}
