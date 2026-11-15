/**
 * P3a — the Fx dock tab (E): the spell / feature presets, cover, saved custom effects and the custom effect
 * builder. Pick an effect, adjust its duration by hand (amount + unit), choose who casts it (concentration is
 * tracked — switching spells ends the old one everywhere, with a warning first) and apply it to the targets.
 * Everything is one `pCommit`, so it is undoable and logged.
 */

import {
	applyEncounterEffect,
	deleteEncounterSavedEffect,
	getEncounterEffectPresets,
	getEncounterPresetSpellRef,
	removeEncounterEffect,
	saveEncounterEffectDef,
} from "../../encounterworkspace-fx.js";
import {h} from "../dom.js";
import {getCockpitSpellHoverMeta} from "../hover.js";
import {createCockpitEffectBuilder} from "./act-effect-builder.js";
import {
	COCKPIT_DURATION_UNITS,
	getCockpitActiveEffects,
	getCockpitCasterId,
	getCockpitCasterOptions,
	getCockpitConcentrationWarning,
	getCockpitDurationParts,
	getCockpitDurationRounds,
	getCockpitDurationText,
	getCockpitEffectSummary,
	getCockpitFxGroups,
	getCockpitIsPresetOnAll,
} from "./act-effect-model.js";
import {getKbd, getOption, getWhoText} from "./act-shared.js";

export function createCockpitFxTab (api) {
	let selectedKey = "bless";
	let duration = null; // {amount, unit} typed by hand; null = the effect's default
	let caster = "@turn";
	let isBuilderOpen = false;
	let flashName = null;
	let error = null;

	const rerender = () => api.render();

	const getDef = state => getEncounterEffectPresets(state).find(it => it.key === selectedKey) || null;

	const getDuration = def => {
		const parts = duration || getCockpitDurationParts(def?.duration ?? null);
		return {parts, parsed: getCockpitDurationRounds(parts)};
	};

	const getEffectHoverEntry = def => ({
		type: "entries",
		name: def.name,
		entries: [getCockpitEffectSummary(def), def.note || null, `{@note ${getCockpitDurationText(def.duration ?? null)}${def.conc ? " · concentration" : ""}}`].filter(Boolean),
		data: {hoverTitle: def.name},
	});

	const bindDefHover = (ele, def, ruleset) => {
		const ref = getEncounterPresetSpellRef(def, {ruleset});
		const meta = ref ? getCockpitSpellHoverMeta(ref) : null;
		if (meta) return api.hover.bindLink(ele, meta);
		return api.hover.bindEntry(ele, `fxdef:${def.key}`, getEffectHoverEntry(def));
	};

	async function pApply (def, {rounds, casterId, targetIds, isSave = false}) {
		const labels = api.getCtx().labels;
		const who = getWhoText(targetIds, labels);
		let saved = null;
		const label = targetIds.length ? `${def.name} → ${who}` : `Save ${def.name}`;
		const next = await api.pCommit(label, (draft, {log}) => {
			if (isSave) saved = saveEncounterEffectDef(draft, def);
			if (targetIds.length) applyEncounterEffect(draft, {targetIds, def: saved || def, rounds, casterId, ruleset: api.getSettings().ruleset, log});
			return draft;
		});
		if (!next) return null;
		api.toast(`${label}${targetIds.length ? ` (${getCockpitDurationText(rounds)})` : ""}.`, {isUndo: true});
		return {next, saved};
	}

	async function pApplySelected () {
		const ctx = api.getCtx();
		const def = getDef(ctx.state);
		if (!def) return;
		if (!ctx.targetIds.length) {
			error = "View or select a creature first.";
			return rerender();
		}
		const {parsed} = getDuration(def);
		if (!parsed.ok) {
			error = parsed.message;
			rerender();
			document.querySelector("[data-ewc-fx-dur]")?.focus();
			return;
		}
		error = null;
		const res = await pApply(def, {rounds: parsed.rounds, casterId: getCockpitCasterId(caster, {activeId: ctx.activeInstanceId}), targetIds: [...ctx.targetIds]});
		if (res) {
			flashName = def.name;
			rerender();
		}
	}

	async function pRemove (label, recipe) {
		const next = await api.pCommit(label, (draft, {log}) => { recipe(draft, log); return draft; });
		if (next) api.toast(`${label}.`, {isUndo: true});
	}

	const builder = createCockpitEffectBuilder({
		fk: "fx-b",
		submitLabel: "Add & apply",
		onCancel: () => { isBuilderOpen = false; rerender(); },
		onSubmit: async (def, {isSave}) => {
			const ctx = api.getCtx();
			const targetIds = [...ctx.targetIds];
			if (!targetIds.length && !isSave) throw new Error("View or select a creature to apply it to — or tick “Save for reuse”.");
			const res = await pApply(def, {rounds: def.duration, casterId: def.conc ? getCockpitCasterId(caster, {activeId: ctx.activeInstanceId}) : null, targetIds, isSave});
			if (!res) return false;
			isBuilderOpen = false;
			flashName = def.name;
			if (res.saved) selectedKey = res.saved.key;
			duration = null;
			rerender();
		},
	});

	api.setOnEndEffect((instanceId, item) => {
		const label = api.getCtx().labels.get(instanceId) || instanceId;
		return pRemove(`End ${item.name || item.label || "effect"} on ${label}`, (draft, log) => removeEncounterEffect(draft, {targetIds: [instanceId], effectId: item.id, log}));
	});

	function getPresetButton (def, ctx) {
		const isOn = getCockpitIsPresetOnAll(ctx.state, ctx.targetIds, def.key);
		const btn = h("button.ewc-fxbtn", {
			type: "button",
			"aria-pressed": `${def.key === selectedKey}`,
			"data-ewc-fk": `fx-${def.key}`,
			"data-ewc-fx": def.key,
			onclick: () => {
				if (selectedKey !== def.key) duration = null;
				selectedKey = def.key;
				error = null;
				rerender();
			},
			ondblclick: () => pApplySelected(),
		},
		def.conc ? h("span.ewc-fxbtn__conc", {"aria-label": "concentration", title: "Concentration"}, "◉") : null,
		def.name,
		isOn ? h("span.ewc-fxbtn__on", {title: "Already on every target"}, "✓") : null);
		return bindDefHover(btn, def, ctx.ruleset);
	}

	function getGroups (ctx) {
		const groups = getCockpitFxGroups(getEncounterEffectPresets(ctx.state));
		return groups.map(group => h("div.ewc-fx__group", {role: "group", "aria-label": group.label},
			h("p.ewc-field__l", null, group.label, group.id === "spells" ? h("span.ewc-muted", null, " · ◉ concentration") : null),
			group.items.length
				? h("div.ewc-fx__btns", null, group.items.map(def => group.id !== "saved" ? getPresetButton(def, ctx) : h("span.ewc-fx__saved", null,
					getPresetButton(def, ctx),
					h("button.ewc-btn.ewc-btn--icon.ewc-btn--ghost.ewc-fx__del", {
						type: "button",
						title: `Delete saved effect ${def.name} (effects already applied stay)`,
						"aria-label": `Delete saved effect ${def.name}`,
						"data-ewc-fk": `fx-del-${def.key}`,
						onclick: () => {
							if (selectedKey === def.key) selectedKey = "bless";
							pRemove(`Delete saved ${def.name}`, draft => deleteEncounterSavedEffect(draft, def.key));
						},
					}, "×"))))
				: h("p.ewc-muted.ewc-fx__empty", null, "Custom effects you save appear here.")));
	}

	function getDetail (ctx) {
		const def = getDef(ctx.state);
		if (!def) return null;
		const {parts, parsed} = getDuration(def);
		const amount = h("input.ewc-input.ewc-input--sm.ewc-fx__amt", {
			type: "text",
			autocomplete: "off",
			value: parts.amount,
			disabled: parts.unit === "until",
			placeholder: parts.unit === "until" ? "—" : "1",
			"aria-label": "Duration amount",
			"aria-invalid": parsed.ok ? null : "true",
			"data-ewc-fk": "fx-dur",
			"data-ewc-fx-dur": "",
			oninput: () => { duration = {...parts, amount: amount.value}; },
			onchange: () => rerender(),
			onkeydown: evt => {
				if (evt.key !== "Enter") return;
				evt.preventDefault();
				evt.stopPropagation();
				duration = {...parts, amount: amount.value};
				pApplySelected();
			},
		});
		const unit = h("select.ewc-input.ewc-input--sm", {
			"aria-label": "Duration unit",
			"data-ewc-fk": "fx-unit",
			"data-ewc-fx-unit": "",
			onchange: () => {
				duration = {amount: unit.value === "until" ? "" : amount.value || parts.amount || "1", unit: unit.value};
				rerender();
			},
		}, COCKPIT_DURATION_UNITS.map(it => getOption(it.value, it.label, parts.unit)));
		const defaultText = getCockpitDurationText(def.duration ?? null);
		const durHint = parsed.ok
			? `= ${parsed.text}${parsed.rounds === (def.duration ?? null) ? ` · ${def.saved ? "saved" : def.cover ? "cover" : "spell"} default` : ` · default ${defaultText}`}`
			: parsed.message;

		const casterSel = h("select.ewc-input.ewc-input--sm", {
			"aria-label": "Cast by",
			"data-ewc-fk": "fx-caster",
			"data-ewc-fx-caster": "",
			onchange: () => { caster = casterSel.value; rerender(); },
		}, getCockpitCasterOptions(ctx.state, {labels: ctx.labels, activeId: ctx.activeInstanceId}).map(it => getOption(it.value, it.label, caster)));
		const casterId = getCockpitCasterId(caster, {activeId: ctx.activeInstanceId});
		const warn = getCockpitConcentrationWarning(ctx.state, {casterId, def, labels: ctx.labels});

		const isOnAny = ctx.state.instances.some(it => ctx.targetIds.includes(it.id) && (it.effects || []).some(fx => fx.key === def.key));
		const n = ctx.targetIds.length;
		const name = h("b.ewc-fx__name", null, def.name);
		bindDefHover(name, def, ctx.ruleset);
		return h("div.ewc-fx__detail", {"aria-label": `${def.name} — apply`},
			h("p.ewc-fx__sum", null, name, h("span.ewc-muted", null, ` — ${getCockpitEffectSummary(def)}`)),
			h("div.ewc-field", null,
				h("span.ewc-field__l", null, "Duration"),
				h("div.ewc-act__row", null, amount, unit),
				h(`small.ewc-field__hint${parsed.ok ? "" : ".ewc-error"}`, null, durHint)),
			h("div.ewc-field", null,
				h("span.ewc-field__l", null, "Cast by"),
				casterSel,
				def.conc && !casterId ? h("small.ewc-field__hint", null, "No caster — concentration won't be tracked.") : null),
			warn ? h("p.ewc-fx__warn", {role: "status", "data-ewc-fx-warn": ""}, h("span", {"aria-hidden": "true"}, "⚠ "), warn.text) : null,
			error ? h("p.ewc-error", {role: "alert"}, error) : null,
			h("div.ewc-act__row", null,
				h("button.ewc-btn.ewc-btn--primary.ewc-btn--sm", {
					type: "button",
					disabled: !n,
					"data-ewc-primary": "",
					"data-ewc-fk": "fx-apply",
					"data-ewc-fx-apply": "",
					onclick: () => pApplySelected(),
				}, n ? `Apply to ${n === 1 ? ctx.labels.get(ctx.targetIds[0]) : `${n} creatures`}` : "Apply", getKbd(["Enter"], api.isMac)),
				isOnAny ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
					type: "button",
					"data-ewc-fk": "fx-remove",
					"data-ewc-fx-remove": "",
					onclick: () => pRemove(`Remove ${def.name} from ${getWhoText(ctx.targetIds, ctx.labels)}`, (draft, log) => removeEncounterEffect(draft, {targetIds: [...ctx.targetIds], key: def.key, log})),
				}, `Remove ${def.name}`) : null));
	}

	function getActive (ctx) {
		const groups = getCockpitActiveEffects(ctx.state, ctx.targetIds, {labels: ctx.labels});
		if (!groups.length) return null;
		const items = groups.map(group => {
			const first = group.entries[0];
			const instance = ctx.state.instances.find(it => it.id === first.instanceId);
			const name = h("span.ewc-fx__aname", {tabindex: "0"}, group.name);
			api.hover.bindEffect(name, instance, first.effect);
			const isFlash = flashName && group.name === flashName;
			return h(`li.ewc-fx__aitem${isFlash ? ".is-new" : ""}`, {"data-ewc-fx-active": group.name},
				group.conc ? h("span.ewc-fxbtn__conc", {title: group.casterId ? `Concentration — ${ctx.labels.get(group.casterId) || "caster"}` : "Concentration"}, "◉") : null,
				name,
				group.label ? h("span.ewc-muted.ewc-fx__awho", null, group.label) : null,
				h("span.ewc-fx__arounds.ewc-muted", null, getCockpitDurationText(group.rounds)),
				h("button.ewc-btn.ewc-btn--icon.ewc-btn--ghost", {
					type: "button",
					title: `Remove ${group.name}`,
					"aria-label": `Remove ${group.name}`,
					"data-ewc-fk": `fx-x-${group.groupKey}`,
					onclick: () => {
						const pairs = group.entries.map(it => [it.instanceId, it.effectId]);
						pRemove(`Remove ${group.name}`, (draft, log) => pairs.forEach(([id, effectId]) => removeEncounterEffect(draft, {targetIds: [id], effectId, log})));
					},
				}, "×"));
		});
		flashName = null;
		return h("div.ewc-fx__active", null,
			h("p.ewc-field__l", null, `Active on ${ctx.targetIds.length === 1 ? ctx.labels.get(ctx.targetIds[0]) : "targets"}`),
			h("ul.ewc-fx__alist", null, items));
	}

	function render (ctx, panel) {
		panel.classList.add("ewc-act-fx");
		panel.append(...getGroups(ctx));
		const disc = h("button.ewc-btn.ewc-btn--link.ewc-act__disc", {
			type: "button",
			"aria-expanded": `${isBuilderOpen}`,
			"data-ewc-fk": "fx-custom",
			"data-ewc-fx-custom": "",
			onclick: () => {
				isBuilderOpen = !isBuilderOpen;
				rerender();
				if (isBuilderOpen) builder.focus();
			},
		}, isBuilderOpen ? "▾ Custom effect" : "＋ Custom effect…");
		panel.append(disc);
		if (isBuilderOpen) {
			const host = h("div.ewc-fx__builder");
			builder.render(host);
			panel.append(host);
		} else {
			panel.append(h("hr.ewc-fx__sep"), getDetail(ctx));
		}
		const active = getActive(ctx);
		if (active) panel.append(active);
	}

	return {id: "fx", label: "Fx", keys: ["E"], render};
}
