/** P3c — rail-row additions: death-save pips, turn-order drag grip and Alt+↑/↓, a quiet "number vs position" hint. */
import {h, kbd} from "../dom.js";
import {getCockpitKeyLabels} from "../keymap.js";
import {EncounterWorkspaceState, getEncounterSharedGroup} from "../../encounterworkspace-state.js";
import {
	getEncounterDeathSavePipCount,
	getEncounterDeathSaveStatus,
	getEncounterUsesDeathSaves,
	markEncounterDeathSave,
	rollEncounterDeathSave,
	stabilizeEncounterCreature,
} from "../../encounterworkspace-deathsaves.js";
import {getFlowReorderDir, getFlowReorderDrop, getFlowReorderStep, getFlowReorderText} from "./flow-model.js";
import {isFlowKeyAllowed} from "./flow-util.js";

const DRAG_TYPE = "application/x-ewc-entry";

export function installFlowRows (api) {
	const getOrder = state => EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id);
	const getEntryId = (state, id) => getEncounterSharedGroup(state, id)?.id ?? id;
	const getEntryLabel = (state, entryId, labels) => state.groups.find(it => it.id === entryId)?.name || labels.get(entryId) || "Creature";

	/* ---------------- Turn order: one place for every move ---------------- */
	async function pMove (instanceId, getMove, {dir = 0} = {}) {
		const state = api.getState();
		const entryId = getEntryId(state, instanceId);
		const before = getOrder(state);
		const move = getMove(before, entryId);
		if (!move) {
			api.toast(dir < 0 ? "Already first in turn order." : dir > 0 ? "Already last in turn order." : "That is already its place in turn order.");
			return;
		}
		const labels = api.getCtx().labels;
		const label = getEntryLabel(state, entryId, labels);
		let changes = [];
		const next = await api.pCommit(`Move ${label} in turn order`, draft => {
			const result = EncounterWorkspaceState.withInitiativeReorder(draft, move);
			changes = result.changes;
			return result.state;
		});
		if (!next) return;
		const realDir = dir || getFlowReorderDir(before, getOrder(next), entryId);
		api.toast(getFlowReorderText({label, entryId, changes, labels, dir: realDir}), {isUndo: true});
	}

	const pStep = (instanceId, dir) => pMove(instanceId, (order, entryId) => getFlowReorderStep(order, entryId, dir), {dir});

	document.addEventListener("keydown", evt => {
		if (!evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey) return;
		if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
		if (!isFlowKeyAllowed(api, evt)) return;
		const id = api.getUi().viewedId;
		if (!id || !api.getState().instances.some(it => it.id === id)) return;
		evt.preventDefault();
		pStep(id, evt.key === "ArrowUp" ? -1 : 1);
	});
	// Listed in the shortcut sheet; the keymap never resolves Alt chords, so the listener above runs them.
	api.registerKey({section: "Initiative & turns", keys: ["Alt", "↑"], label: "Move the viewed creature earlier in turn order (its initiative number adjusts)", action: "flow:move-up", run: () => false});
	api.registerKey({section: "Initiative & turns", keys: ["Alt", "↓"], label: "Move the viewed creature later in turn order", action: "flow:move-down", run: () => false});

	/* ---------------- Drag & drop on the rail ---------------- */
	let dragId = null;
	const clearMarks = () => document.querySelectorAll(".ewc-row.is-drop-before, .ewc-row.is-drop-after").forEach(it => it.classList.remove("is-drop-before", "is-drop-after"));

	function decorateDrag (row, instance, ctx) {
		const isOrdered = getOrder(ctx.state).includes(getEntryId(ctx.state, instance.id));
		const label = ctx.labels.get(instance.id) || "creature";
		const mac = ctx.isMac;
		const grip = h("button.ewc-flow-grip", {
			type: "button",
			draggable: "true",
			"data-ewc-flow": "grip",
			"data-ewc-fk": `grip-${instance.id}`,
			title: `Drag to change ${label}'s position in turn order — the initiative number adjusts to fit. ${getCockpitKeyLabels(["Alt"], {isMac: mac})[0]}+↑/↓ moves the viewed creature.`,
			"aria-label": `Move ${label} in turn order. Arrow up for earlier, arrow down for later`,
			onkeydown: evt => {
				if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
				evt.preventDefault();
				evt.stopPropagation();
				pStep(instance.id, evt.key === "ArrowUp" ? -1 : 1);
			},
			onclick: evt => evt.stopPropagation(),
		}, "⋮⋮");
		grip.addEventListener("dragstart", evt => {
			dragId = instance.id;
			evt.dataTransfer.effectAllowed = "move";
			evt.dataTransfer.setData(DRAG_TYPE, instance.id);
			evt.dataTransfer.setData("text/plain", label);
			evt.dataTransfer.setDragImage?.(row, 12, 12);
			row.classList.add("is-dragging");
		});
		grip.addEventListener("dragend", () => {
			dragId = null;
			row.classList.remove("is-dragging");
			clearMarks();
		});
		row.append(grip);
		if (!isOrdered && instance.initiative == null) grip.hidden = true;

		row.addEventListener("dragover", evt => {
			if (!dragId || dragId === instance.id) return;
			evt.preventDefault();
			evt.dataTransfer.dropEffect = "move";
			const rect = row.getBoundingClientRect();
			const isAfter = evt.clientY > rect.top + rect.height / 2;
			clearMarks();
			row.classList.add(isAfter ? "is-drop-after" : "is-drop-before");
		});
		row.addEventListener("dragleave", evt => {
			if (!row.contains(evt.relatedTarget)) row.classList.remove("is-drop-before", "is-drop-after");
		});
		row.addEventListener("drop", evt => {
			if (!dragId) return;
			evt.preventDefault();
			const isAfter = row.classList.contains("is-drop-after");
			const source = dragId;
			clearMarks();
			dragId = null;
			const state = api.getState();
			const targetEntry = getEntryId(state, instance.id);
			pMove(source, (order, entryId) => getFlowReorderDrop(order, entryId, targetEntry, {isAfter}));
		});
	}

	/* ---------------- Death saves ---------------- */
	function decorateDeathSaves (row, instance, ctx) {
		const monsterDeathSaves = !!ctx.settings?.monsterDeathSaves;
		if (!instance.deathSaves || !getEncounterUsesDeathSaves(instance, {monsterDeathSaves})) return;
		const status = getEncounterDeathSaveStatus(instance);
		const ds = instance.deathSaves;
		const label = ctx.labels.get(instance.id) || "Creature";
		const pips = (kind, n, word) => h("span.ewc-ds__set", {role: "group", "aria-label": `${word} ${n} of 3`},
			h("span.ewc-ds__lbl", {"aria-hidden": "true"}, kind === "s" ? "✓" : "✗"),
			[0, 1, 2].map(ix => h(`button.ewc-ds__pip.is-${kind}${ix < n ? ".is-on" : ""}`, {
				type: "button",
				"data-ewc-ds": `${kind}${ix}`,
				"aria-pressed": `${ix < n}`,
				"aria-label": `${word} ${ix + 1}`,
				title: `${word}: click to mark ${getEncounterDeathSavePipCount(n, ix)} of 3`,
				onclick: evt => {
					evt.stopPropagation();
					const count = getEncounterDeathSavePipCount(n, ix);
					api.pCommit(`Mark ${label}'s death saves`, (draft, {log}) => { markEncounterDeathSave(draft, {id: instance.id, kind, count, monsterDeathSaves, log}); });
				},
			})),
		);
		const isDying = status === "dying";
		const tag = status === "dead" ? h("span.ewc-ds__tag.is-dead", null, "Dead") : status === "stable" ? h("span.ewc-ds__tag.is-stable", null, "Stable") : h("span.ewc-ds__tag", null, "Dying");
		const roll = isDying ? h("button.ewc-btn.ewc-btn--sm.ewc-ds__roll", {
			type: "button",
			"data-ewc-flow": "ds-roll",
			title: "Roll a death save (d20: 10+ succeeds, 1 counts twice, 20 brings them back at 1 HP)",
			onclick: async evt => {
				evt.stopPropagation();
				let result = null;
				const d20 = 1 + Math.floor(Math.random() * 20);
				await api.pCommit(`${label}'s death save`, (draft, {log}) => { result = rollEncounterDeathSave(draft, {id: instance.id, d20, log}); });
				if (result) api.toast(`${label} death save: ${result.n} — ${result.text}.`, {isUndo: true});
			},
		}, "🎲 Roll") : null;
		const stab = isDying ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
			type: "button",
			"data-ewc-flow": "ds-stable",
			title: "Stabilize (Spare the Dying, a DC 10 Medicine check): stops death saves, stays at 0 HP",
			onclick: evt => {
				evt.stopPropagation();
				api.pCommit(`Stabilize ${label}`, (draft, {log}) => { stabilizeEncounterCreature(draft, {id: instance.id, log}); });
			},
		}, "Stabilize") : null;
		row.classList.add(`is-ds-${status}`);
		row.append(h("div.ewc-ds", {"data-ewc-flow": "deathsaves", role: "group", "aria-label": `${label} death saves`},
			h("span.ewc-ds__head", null, "Death saves"),
			pips("s", ds.successes || 0, "Successes"),
			pips("f", ds.failures || 0, "Failures"),
			tag,
			roll,
			stab,
		));
	}

	api.addRailRowDecorator((row, instance, ctx) => {
		decorateDrag(row, instance, ctx);
		decorateDeathSaves(row, instance, ctx);
	});

	/* ---------------- "number vs position" hint under the rail ---------------- */
	api.addRailFoot(ctx => {
		if (!getOrder(ctx.state).length) return null;
		return h("p.ewc-flow-orderhint", {"data-ewc-flow": "order-hint"},
			h("span", null, h("b", null, "Initiative number"), ": click it to type"),
			h("span", null, h("b", null, "Position"), ": drag ", h("span.ewc-flow-orderhint__g", {"aria-hidden": "true"}, "⋮⋮"), " or ", kbd(getCockpitKeyLabels(["Alt", "↑"], {isMac: ctx.isMac})), " ", kbd(getCockpitKeyLabels(["Alt", "↓"], {isMac: ctx.isMac}))),
		);
	});
}
