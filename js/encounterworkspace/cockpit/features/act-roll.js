/**
 * P3a — the Roll dock tab (R): a saving throw, ability check or skill check for every target, rolled through the
 * shared mass-roll path with the cockpit's single contributor getter (effects, conditions, battlefield, templates).
 * Shift rolls with advantage, Ctrl/⌘ with disadvantage. Results go to the roll tray; an optional save outcome
 * (damage, half on a pass, condition on a fail) is applied from there.
 */

import {ENCOUNTER_DAMAGE_TYPES} from "../../encounterworkspace-damage.js";
import {ENCOUNTER_ABILITY_NAMES, ENCOUNTER_SKILL_ABILITIES} from "../../encounterworkspace-fx.js";
import {rollEncounterChecks, rollEncounterSaves} from "../../encounterworkspace-massroll.js";
import {h} from "../dom.js";
import {getCockpitContributorGetter} from "../rules.js";
import {COCKPIT_SKILLS} from "./act-effect-model.js";
import {
	COCKPIT_ROLL_KINDS,
	COCKPIT_ROLL_MODES,
	getCockpitEmptyRollForm,
	getCockpitRollButtonText,
	getCockpitRollModeFromEvent,
	getCockpitRollRequest,
	getCockpitTrayLogText,
	getCockpitWhoRolls,
} from "./act-roll-model.js";
import {getKbd, getOption, getSeg, toTitle} from "./act-shared.js";

const ABILITIES = Object.keys(ENCOUNTER_ABILITY_NAMES);

/**
 * Roll a save or check for `ids` through the shared mass-roll path (one contributor getter), log it and show the
 * tray. request: {kind: "save"|"check", ability, skill, dc, mode}. Returns the rolled result or null (toasted).
 */
export function rollCockpitToTray (api, tray, {ids, request, outcome = null, title, forcedLabel = "Roll tab", isFocus = true}) {
	const forcedMode = request.mode && request.mode !== "normal" ? request.mode : null;
	const state = api.getState();
	const getContributors = getCockpitContributorGetter(state, api.getSettings());
	let rolled;
	try {
		rolled = request.kind === "save"
			? rollEncounterSaves({state, ids, ability: request.ability, dc: request.dc, forcedMode, forcedLabel, getContributors})
			: rollEncounterChecks({state, ids, skill: request.skill || null, ability: request.skill ? null : request.ability, dc: request.dc, forcedMode, forcedLabel, getContributors});
	} catch (e) {
		api.toast(e.message, {kind: "error"});
		return null;
	}
	if (!rolled.results.length) {
		api.toast("Everyone targeted is defeated; nobody rolled.", {kind: "error"});
		return null;
	}
	const fullTitle = `${title}${forcedMode ? ` (${forcedMode})` : ""}`;
	api.engine.pLog("roll", getCockpitTrayLogText(fullTitle, rolled));
	tray.show(rolled, {title: fullTitle, outcome, isFocus});
	return rolled;
}

export function createCockpitRollTab (api, {tray}) {
	const form = getCockpitEmptyRollForm();
	let isOutcomeOpen = false;
	let error = null; // {message, field}

	const rerender = () => api.render();
	const set = patch => {
		Object.assign(form, patch);
		if (error && Object.keys(patch).includes(error.field)) error = null;
		rerender();
	};

	function pRoll (evt) {
		const ctx = api.getCtx();
		const ids = [...ctx.targetIds];
		if (!ids.length) {
			api.toast("View or select a creature to roll for.", {kind: "error"});
			return;
		}
		const mode = getCockpitRollModeFromEvent(evt, form.mode);
		const parsed = getCockpitRollRequest(form, {mode});
		if (!parsed.ok) {
			error = {message: parsed.message, field: parsed.field};
			if (["damage", "rounds"].includes(parsed.field)) isOutcomeOpen = true;
			rerender();
			document.querySelector(`[data-ewc-roll-field="${parsed.field}"]`)?.focus();
			return;
		}
		error = null;
		const {request, outcome, title} = parsed;
		const isFromKey = mode !== form.mode;
		const forcedLabel = isFromKey ? (mode === "advantage" ? "Shift" : api.isMac ? "⌘" : "Ctrl") : "Roll tab";
		rollCockpitToTray(api, tray, {ids, request, outcome, title, forcedLabel});
	}

	function getFieldAttrs (field) {
		return {
			"data-ewc-roll-field": field,
			"aria-invalid": error?.field === field ? "true" : null,
			"aria-describedby": error?.field === field ? "ewc-roll-err" : null,
		};
	}

	function getOutcome (ctx) {
		const toggle = h("button.ewc-btn.ewc-btn--link.ewc-act__disc", {
			type: "button",
			"aria-expanded": `${isOutcomeOpen}`,
			"data-ewc-fk": "roll-outcome",
			"data-ewc-roll-outcome": "",
			onclick: () => { isOutcomeOpen = !isOutcomeOpen; rerender(); },
		}, isOutcomeOpen ? "▾ On a fail" : `▸ On a fail${form.damage || form.condition ? ` · ${[form.damage, form.condition].filter(Boolean).join(", ")}` : " (damage, condition)"}`);
		if (!isOutcomeOpen) return toggle;
		const damage = h("input.ewc-input.ewc-input--sm.ewc-act__dmg", {
			type: "text",
			autocomplete: "off",
			spellcheck: "false",
			placeholder: "8d6",
			value: form.damage,
			"aria-label": "Damage on a fail",
			"data-ewc-fk": "roll-dmg",
			...getFieldAttrs("damage"),
			oninput: () => { form.damage = damage.value; if (error?.field === "damage") error = null; },
			onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); evt.stopPropagation(); pRoll(evt); } },
		});
		const type = h("select.ewc-input.ewc-input--sm", {
			"aria-label": "Damage type",
			"data-ewc-fk": "roll-dt",
			"data-ewc-roll-field": "damageType",
			onchange: () => set({damageType: type.value || null}),
		}, getOption("", "untyped", form.damageType || ""), ENCOUNTER_DAMAGE_TYPES.map(it => getOption(it, it, form.damageType)));
		const half = h("input", {type: "checkbox", checked: form.isHalf, "data-ewc-fk": "roll-half", onchange: () => set({isHalf: half.checked})});
		const cond = h("select.ewc-input.ewc-input--sm", {
			"aria-label": "Condition on a fail",
			"data-ewc-fk": "roll-cond",
			"data-ewc-roll-field": "condition",
			onchange: () => set({condition: cond.value}),
		}, getOption("", "no condition", form.condition), (ctx.conditions || []).map(it => getOption(it.name, it.label || toTitle(it.name), form.condition)));
		const rounds = h("input.ewc-input.ewc-input--num.ewc-input--sm", {
			type: "text",
			inputmode: "numeric",
			placeholder: "∞",
			value: form.rounds,
			disabled: !form.condition,
			"aria-label": "Condition lasts (rounds)",
			"data-ewc-fk": "roll-rounds",
			...getFieldAttrs("rounds"),
			oninput: () => { form.rounds = rounds.value; },
		});
		return h("div.ewc-act__outcome", null,
			toggle,
			h("div.ewc-field", null,
				h("span.ewc-field__l", null, "Damage"),
				h("div.ewc-act__row", null, damage, type),
				h("label.ewc-check", {title: "Creatures that pass take half (minions take none)"}, half, " Half on a pass")),
			h("div.ewc-field", null,
				h("span.ewc-field__l", null, "Condition"),
				h("div.ewc-act__row", null, cond, rounds, h("span.ewc-muted", null, "rounds"))),
			h("small.ewc-field__hint", null, "Applied from the results tray, after you've seen the rolls."));
	}

	function render (ctx, panel) {
		const isSkill = form.kind === "skill";
		panel.classList.add("ewc-act-roll");
		panel.append(h("div.ewc-field", null,
			h("span.ewc-field__l", null, "Roll"),
			getSeg({label: "Roll kind", options: COCKPIT_ROLL_KINDS, value: form.kind, fk: "roll-kind", isFull: true, onPick: kind => set({kind})})));

		if (isSkill) {
			const skill = h("select.ewc-input", {
				"aria-label": "Skill",
				"data-ewc-fk": "roll-skill",
				...getFieldAttrs("skill"),
				onchange: () => set({skill: skill.value}),
			}, COCKPIT_SKILLS.map(it => getOption(it, `${toTitle(it)} (${toTitle(ENCOUNTER_SKILL_ABILITIES[it]).slice(0, 3)})`, form.skill)));
			panel.append(h("div.ewc-field", null, h("span.ewc-field__l", null, "Skill"), skill));
		} else {
			panel.append(h("div.ewc-field", null,
				h("span.ewc-field__l", null, form.kind === "save" ? "Saving throw" : "Ability"),
				getSeg({
					label: "Ability",
					options: ABILITIES.map(it => ({value: it, label: it.toUpperCase(), title: ENCOUNTER_ABILITY_NAMES[it]})),
					value: form.ability,
					fk: "roll-ab",
					isFull: true,
					onPick: ability => set({ability}),
				})));
		}

		const dc = h("input.ewc-input.ewc-input--num", {
			type: "text",
			inputmode: "numeric",
			autocomplete: "off",
			placeholder: "—",
			value: form.dc,
			"aria-label": "DC (optional)",
			"data-ewc-fk": "roll-dc",
			...getFieldAttrs("dc"),
			oninput: () => { form.dc = dc.value; if (error?.field === "dc") error = null; },
			onkeydown: evt => { if (evt.key === "Enter") { evt.preventDefault(); evt.stopPropagation(); pRoll(evt); } },
		});
		panel.append(h("div.ewc-act__row.ewc-act__modedc", null,
			getSeg({label: "Advantage", options: COCKPIT_ROLL_MODES, value: form.mode, fk: "roll-mode", onPick: mode => set({mode})}),
			h("label.ewc-act__dc", null, h("span.ewc-field__l", null, "DC"), dc)));

		if (form.kind === "save") panel.append(getOutcome(ctx));

		const parsed = getCockpitRollRequest({...form, dc: /^\d{1,2}$/.test(`${form.dc}`.trim()) ? form.dc : "", damage: "", condition: ""});
		const request = parsed.ok ? parsed.request : null;
		if (request && ctx.targetIds.length) {
			const rows = getCockpitWhoRolls(ctx.state, ctx.targetIds, request, {getContributors: getCockpitContributorGetter(ctx.state, ctx.settings), labels: ctx.labels});
			panel.append(h("div.ewc-act__who", {"aria-label": "Who rolls"},
				h("p.ewc-field__l", null, `Who rolls · ${rows.filter(it => !it.isDefeated).length}`),
				h("ul.ewc-act__wholist", null, rows.map(row => {
					const name = h("span.ewc-act__whoname", null, row.label);
					const instance = ctx.state.instances.find(it => it.id === row.id);
					if (instance) api.hover.bindCreature(name, instance);
					const modeChip = row.isAutoFail
						? h("span.ewc-act__chip.is-bad", {title: row.from}, "auto-fail")
						: row.mode !== "normal" ? h(`span.ewc-act__chip.is-${row.mode === "advantage" ? "adv" : "dis"}`, {title: row.from || (row.mode === "advantage" ? "Advantage" : "Disadvantage")}, row.mode === "advantage" ? "adv" : "dis")
							: row.isCancelled ? h("span.ewc-act__chip", {title: "Advantage and disadvantage cancel out"}, "cancel") : null;
					return h(`li${row.isDefeated ? ".is-off" : ""}`, null, name, h("span.ewc-act__whomod", null, row.text), modeChip);
				}))));
		}

		const liveCount = ctx.state.instances.filter(it => ctx.targetIds.includes(it.id) && !it.defeated).length;
		const btn = h("button.ewc-btn.ewc-btn--primary.ewc-act__go", {
			type: "button",
			disabled: !liveCount,
			"data-ewc-primary": "",
			"data-ewc-fk": "roll-go",
			"data-ewc-roll-go": "",
			title: "Shift-click: advantage · Ctrl/⌘-click: disadvantage",
			onclick: evt => pRoll(evt),
		}, request ? getCockpitRollButtonText(request, liveCount) : "Roll", getKbd(["Enter"], api.isMac));
		panel.append(h("div.ewc-act__gorow", null,
			btn,
			h("small.ewc-field__hint.ewc-act__modhint", null, getKbd(["Shift"], api.isMac), " adv · ", getKbd(["mod"], api.isMac), " dis")));
		if (error) panel.append(h("p.ewc-error", {id: "ewc-roll-err", role: "alert"}, error.message));
	}

	return {id: "roll", label: "Roll", keys: ["R"], render};
}
