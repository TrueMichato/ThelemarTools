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
	getCockpitAnsweredRoll,
	getCockpitRollModeFromEvent,
	getCockpitRollQuery,
	getCockpitRollQuestions,
	getCockpitRollRequest,
	getCockpitSkillMatches,
	getCockpitTrayLogText,
	getCockpitWhoRolls,
} from "./act-roll-model.js";
import {getKbd, getOption, getSeg, getWhoText, toTitle} from "./act-shared.js";
import {isolateFlowKeys} from "./flow-util.js";

const ABILITIES = Object.keys(ENCOUNTER_ABILITY_NAMES);

const PROMPT_ANSWERS = Object.freeze([
	{value: "yes", label: "Yes"},
	{value: "no", label: "No"},
	{value: "cancel", label: "Cancel that roll"},
]);

/**
 * "Before rolling…" — asks each scene-dependent question (fear source in sight, heavy rain, …) once, defaulting to
 * yes. Resolves {key: "yes"|"no"|"cancel"} on Roll, or null when the DM backs out (Esc, Cancel, backdrop).
 */
export function pAskCockpitRollQuestions (api, questions, {title, labels = new Map()}) {
	return new Promise(resolve => {
		const answers = Object.fromEntries(questions.map(it => [it.key, "yes"]));
		let result = null;
		const dlg = isolateFlowKeys(h("dialog.ewc-dialog.ewc-prompt", {"aria-labelledby": "ewc-prompt-title", "aria-describedby": "ewc-prompt-sub", "data-ewc-roll-prompt": ""}));
		const finish = value => {
			result = value;
			dlg.close();
		};
		dlg.addEventListener("close", () => {
			dlg.remove();
			resolve(result);
		});
		dlg.addEventListener("click", evt => { if (evt.target === dlg) finish(null); });
		const render = () => {
			const focusFk = dlg.contains(document.activeElement) ? document.activeElement.dataset?.ewcFk : null;
			dlg.replaceChildren(
				h("div.ewc-dialog__head", null,
					h("div", null,
						h("h2.ewc-dialog__title", {id: "ewc-prompt-title"}, "Before rolling…"),
						h("p.ewc-prompt__sub", {id: "ewc-prompt-sub"}, `${title} — some effects depend on the scene. Answer once; the roll uses it.`),
					),
					h("button.ewc-btn.ewc-btn--icon", {type: "button", "aria-label": "Cancel the roll", "data-ewc-prompt-close": "", onclick: () => finish(null)}, "×"),
				),
				h("ol.ewc-prompt__qs", null, questions.map((it, ix) => h("li.ewc-prompt__q", {"data-ewc-prompt-q": it.key}, [
					h("p.ewc-prompt__text", {id: `ewc-prompt-q-${ix}`}, it.question, " ",
						h("small.ewc-muted", null, [it.label, it.cite].filter(Boolean).join(" · "), " · ", getWhoText(it.ids, labels))),
					getSeg({
						label: `Answer: ${it.question}`,
						options: PROMPT_ANSWERS,
						value: answers[it.key],
						fk: `prompt-${ix}`,
						onPick: value => {
							answers[it.key] = value;
							render();
						},
					}),
				]))),
				h("div.ewc-prompt__foot", null,
					h("span.ewc-grow"),
					h("button.ewc-btn.ewc-btn--ghost", {type: "button", "data-ewc-prompt-cancel": "", onclick: () => finish(null)}, "Cancel"),
					h("button.ewc-btn.ewc-btn--primary", {type: "button", autofocus: true, "data-ewc-fk": "prompt-go", "data-ewc-prompt-go": "", onclick: () => finish({...answers})}, "Roll ", getKbd(["Enter"], api.isMac)),
				),
			);
			(focusFk ? dlg.querySelector(`[data-ewc-fk="${CSS.escape(focusFk)}"]`) : null)?.focus();
		};
		api.getRegion("layer").append(dlg);
		render();
		dlg.showModal();
		dlg.querySelector("[data-ewc-prompt-go]")?.focus();
	});
}

/**
 * Roll a save or check for `ids` through the shared mass-roll path (one contributor getter), log it and show the
 * tray. request: {kind: "save"|"check", ability, skill, dc, mode}. When a scene-dependent source touches the roll
 * (frightened, heavy rain on Perception, …) the DM answers "Before rolling…" first. Resolves the rolled result, or
 * null (cancelled, or toasted).
 */
export async function pRollCockpitToTray (api, tray, {ids, request, outcome = null, title, forcedLabel = "Roll tab", isFocus = true}) {
	const forcedMode = request.mode && request.mode !== "normal" ? request.mode : null;
	let state = api.getState();
	let getContributors = getCockpitContributorGetter(state, api.getSettings());
	const labels = api.getCtx().labels;
	const questions = getCockpitRollQuestions({state, ids, query: getCockpitRollQuery(request), getContributors, labels});
	if (questions.length) {
		const answers = await pAskCockpitRollQuestions(api, questions, {title, labels});
		if (!answers) return null;
		({ids, getContributors} = getCockpitAnsweredRoll({ids, questions, answers, getContributors}));
		if (!ids.length) {
			api.toast("Every roll was cancelled; nobody rolled.");
			return null;
		}
		// The dialog awaited; roll against the state as it is now, with the same answers.
		const fresh = api.getState();
		if (fresh !== state) {
			state = fresh;
			({getContributors} = getCockpitAnsweredRoll({ids, questions, answers, getContributors: getCockpitContributorGetter(state, api.getSettings())}));
		}
	}
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
	let skillQuery = "";
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
		return pRollCockpitToTray(api, tray, {ids, request, outcome, title, forcedLabel});
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
			const matches = getCockpitSkillMatches(COCKPIT_SKILLS, skillQuery);
			const pickSkill = value => {
				skillQuery = "";
				set({skill: value});
				document.querySelector(`[data-ewc-fk="roll-sk-${CSS.escape(value)}"]`)?.focus({preventScroll: true});
			};
			const search = h("input.ewc-input.ewc-input--sm", {
				type: "search",
				autocomplete: "off",
				spellcheck: "false",
				value: skillQuery,
				placeholder: `Search ${COCKPIT_SKILLS.length} skills…`,
				"aria-label": "Search skills",
				"data-ewc-fk": "roll-skill-q",
				"data-ewc-roll-skill-q": "",
				...getFieldAttrs("skill"),
				oninput: () => { skillQuery = search.value; rerender(); },
				onkeydown: evt => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						evt.stopPropagation();
						// Enter with a query picks the first match; with none it rolls, like every other field.
						if (skillQuery.trim() && matches.length) pickSkill(matches[0].skill);
						else if (!skillQuery.trim()) pRoll(evt);
					} else if (evt.key === "Escape" && skillQuery) {
						evt.preventDefault();
						evt.stopPropagation();
						skillQuery = "";
						rerender();
					}
				},
			});
			const chips = matches.map(it => h("button.ewc-act__tchip", {
				type: "button",
				role: "radio",
				"aria-checked": `${form.skill === it.skill}`,
				tabindex: form.skill === it.skill || (!matches.some(m => m.skill === form.skill) && it === matches[0]) ? "0" : "-1",
				title: `${it.label} (${ENCOUNTER_ABILITY_NAMES[ENCOUNTER_SKILL_ABILITIES[it.skill]] || it.ability})`,
				"data-ewc-fk": `roll-sk-${it.skill}`,
				"data-ewc-roll-skill": it.skill,
				onclick: () => pickSkill(it.skill),
				onkeydown: evt => {
					const ix = matches.indexOf(it);
					const next = {ArrowRight: ix + 1, ArrowDown: ix + 1, ArrowLeft: ix - 1, ArrowUp: ix - 1, Home: 0, End: matches.length - 1}[evt.key];
					if (next == null) return;
					evt.preventDefault();
					evt.stopPropagation();
					pickSkill(matches[(next + matches.length) % matches.length].skill);
				},
			}, it.label, " ", h("small", null, it.ability)));
			panel.append(h("div.ewc-field", null,
				h("span.ewc-field__l", null, "Skill ", h("span.ewc-muted", null, toTitle(form.skill || ""))),
				search,
				h("div.ewc-act__tchips", {role: "radiogroup", "aria-label": "Skill", "data-ewc-roll-skills": ""},
					chips.length ? chips : h("span.ewc-muted", {"data-ewc-roll-skill-none": ""}, "No skill matches"))));
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
