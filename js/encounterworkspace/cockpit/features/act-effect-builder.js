/**
 * P3a — the reusable custom-effect builder. Renders a small form (name, buff/debuff, targeted modifiers, damage
 * defenses, a typed duration, concentration, "save for reuse") into any container and calls back with a validated
 * effect definition. Used by the Fx dock tab; P3b's prep Effects tab can import it too.
 *
 *   const builder = createCockpitEffectBuilder({onSubmit (def, {isSave}) {…}, onCancel () {…}});
 *   builder.render(container);   // call again after the host re-renders — the form state lives in the builder
 *
 * The def is ready for `applyEncounterEffect({def, rounds: def.duration})` and `saveEncounterEffectDef(draft, def)`.
 */

import {ENCOUNTER_DAMAGE_TYPES} from "../../encounterworkspace-damage.js";
import {h, replaceKeepingFocus} from "../dom.js";
import {
	COCKPIT_DEFENSE_LISTS,
	COCKPIT_DURATION_UNITS,
	COCKPIT_SKILLS,
	getCockpitDefenseOf,
	getCockpitEffectDef,
	getCockpitEffectSummary,
	getCockpitEmptyEffectForm,
	getCockpitFormWithDefense,
	getCockpitModForTarget,
	getCockpitModKinds,
	getCockpitModTargetGroups,
} from "./act-effect-model.js";

const VALUELESS_KINDS = new Set(["adv", "dis", "autoFail"]);
const DEFENSE_SHORT = {resist: "R", immune: "I", vulnerable: "V"};
const toTitle = text => `${text}`.replace(/\b\w/g, it => it.toUpperCase());

const getOption = (value, label, selected) => h("option", {value, selected: value === selected}, label);

/**
 * @param {object} opts
 * @param {(def: object, meta: {isSave: boolean}) => (boolean|void|Promise<boolean|void>)} opts.onSubmit
 *   Called with a validated def. Return false (or a promise of false) to keep the form open; anything else resets it.
 * @param {() => void} [opts.onCancel]
 * @param {object} [opts.initial] a def to start from (name, kind, mods, resist, immune, vulnerable, conc, duration)
 * @param {string} [opts.submitLabel] "Add & apply"
 * @param {boolean} [opts.isSaveDefault] whether "Save for reuse" starts ticked
 * @param {boolean} [opts.isSaveOptional] show the "Save for reuse" checkbox (default true)
 * @param {string} [opts.fk] prefix for focus keys, unique per host (default "ewc-fxb")
 * @returns {{render (container: HTMLElement): HTMLElement, getForm (): object, setForm (initial: object): void,
 *   reset (): void, focus (): void, validate (): object}}
 */
export function createCockpitEffectBuilder ({onSubmit, onCancel = null, initial = null, submitLabel = "Add & apply", isSaveDefault = false, isSaveOptional = true, fk = "ewc-fxb"} = {}) {
	let form = getCockpitEmptyEffectForm(initial || {});
	let isSave = isSaveDefault;
	let defenseList = "resist";
	let isDefenseOpen = false;
	let error = null;
	let isBusy = false;
	let container = null;

	const rerender = () => { if (container?.isConnected) draw(); };
	const set = patch => { form = {...form, ...patch}; };
	const setMod = (ix, mod) => { form = {...form, mods: form.mods.map((it, i) => i === ix ? mod : it)}; };

	const validate = () => {
		const out = getCockpitEffectDef(form);
		error = out.ok ? null : out;
		return out;
	};

	const pSubmit = async () => {
		if (isBusy) return;
		const out = validate();
		if (!out.ok) {
			rerender();
			container?.querySelector(`[data-ewc-field="${out.field}"]`)?.focus();
			return;
		}
		isBusy = true;
		let keep = false;
		try {
			keep = (await onSubmit?.(out.def, {isSave})) === false;
		} catch (e) {
			error = {message: e.message, field: null};
			keep = true;
		} finally {
			isBusy = false;
		}
		if (!keep) reset();
		else rerender();
	};

	const reset = () => {
		form = getCockpitEmptyEffectForm(initial || {});
		isSave = isSaveDefault;
		isDefenseOpen = false;
		error = null;
		rerender();
	};

	const onKeyDown = evt => {
		if (evt.key === "Enter" && evt.target.matches("input:not([type=checkbox])")) {
			evt.preventDefault();
			evt.stopPropagation();
			pSubmit();
		} else if (evt.key === "Escape" && onCancel) {
			evt.preventDefault();
			evt.stopPropagation();
			onCancel();
		}
	};

	const getModRow = (mod, ix) => {
		const kinds = getCockpitModKinds(mod.target);
		const isErr = error?.field === `mod-${ix}`;
		const targetSel = h("select.ewc-input.ewc-input--sm.ewc-fxb__target", {
			"aria-label": `Modifier ${ix + 1} affects`,
			"data-ewc-fk": `${fk}-mt-${ix}`,
			"data-ewc-field": `mod-${ix}`,
			"aria-invalid": isErr ? "true" : null,
			onchange: evt => { setMod(ix, getCockpitModForTarget(evt.target.value, mod)); rerender(); },
		}, getCockpitModTargetGroups().map(group => h("optgroup", {label: group.label}, group.targets.map(it => getOption(it.value, it.label, mod.target)))));
		const skillSel = mod.target === "skill" ? h("select.ewc-input.ewc-input--sm", {
			"aria-label": `Modifier ${ix + 1} skill`,
			"data-ewc-fk": `${fk}-ms-${ix}`,
			onchange: evt => setMod(ix, {...form.mods[ix], skill: evt.target.value}),
		}, COCKPIT_SKILLS.map(it => getOption(it, toTitle(it), mod.skill))) : null;
		const kindSel = h("select.ewc-input.ewc-input--sm", {
			"aria-label": `Modifier ${ix + 1} kind`,
			"data-ewc-fk": `${fk}-mk-${ix}`,
			onchange: evt => { setMod(ix, getCockpitModForTarget(mod.target, {...form.mods[ix], kind: evt.target.value})); rerender(); },
		}, kinds.map(it => getOption(it.value, it.label, mod.kind)));
		const valueIn = VALUELESS_KINDS.has(mod.kind) ? null : h("input.ewc-input.ewc-input--sm.ewc-fxb__val", {
			type: "text",
			inputmode: mod.kind === "dice" ? "text" : "numeric",
			"aria-label": `Modifier ${ix + 1} value`,
			"data-ewc-fk": `${fk}-mv-${ix}`,
			value: `${mod.value ?? ""}`,
			placeholder: mod.kind === "dice" ? "1d4" : "2",
			oninput: evt => setMod(ix, {...form.mods[ix], value: evt.target.value}),
		});
		const dexCheck = mod.kind === "set" ? h("label.ewc-check", null,
			h("input", {type: "checkbox", checked: !!mod.addDex, "data-ewc-fk": `${fk}-md-${ix}`, onchange: evt => setMod(ix, {...form.mods[ix], addDex: evt.target.checked})}),
			"+ DEX") : null;
		return h(`li.ewc-fxb__mod${isErr ? ".is-err" : ""}`, null,
			targetSel, skillSel, kindSel, valueIn, dexCheck,
			h("button.ewc-btn.ewc-btn--ghost.ewc-btn--sm.ewc-fxb__x", {
				type: "button",
				title: "Remove this modifier",
				"aria-label": `Remove modifier ${ix + 1}`,
				"data-ewc-fk": `${fk}-mx-${ix}`,
				onclick: () => { form = {...form, mods: form.mods.filter((_, i) => i !== ix)}; rerender(); },
			}, "×"),
		);
	};

	const getDefenses = () => {
		const count = COCKPIT_DEFENSE_LISTS.reduce((n, {value}) => n + (form[value]?.length || 0), 0);
		const toggle = h("button.ewc-btn.ewc-btn--link.ewc-fxb__more", {
			type: "button",
			"aria-expanded": `${isDefenseOpen}`,
			"data-ewc-fk": `${fk}-def`,
			onclick: () => { isDefenseOpen = !isDefenseOpen; rerender(); },
		}, isDefenseOpen ? "Hide damage defenses" : `＋ Resistance / immunity / vulnerability${count ? ` (${count})` : ""}`);
		if (!isDefenseOpen) return h("div.ewc-fxb__defs", null, toggle);
		const listLabel = COCKPIT_DEFENSE_LISTS.find(it => it.value === defenseList)?.label;
		return h("div.ewc-fxb__defs", null,
			toggle,
			h("div.ewc-seg", {role: "radiogroup", "aria-label": "Defense to add"}, COCKPIT_DEFENSE_LISTS.map(it => h("button.ewc-seg__b", {
				type: "button",
				role: "radio",
				"aria-checked": `${it.value === defenseList}`,
				"data-ewc-fk": `${fk}-dl-${it.value}`,
				onclick: () => { defenseList = it.value; rerender(); },
			}, it.label))),
			h("div.ewc-dt__chips.ewc-fxb__types", {role: "group", "aria-label": `${listLabel}: damage types — press again to remove`},
				ENCOUNTER_DAMAGE_TYPES.map(type => {
					const list = getCockpitDefenseOf(form, type);
					return h(`button.ewc-dt.ewc-fxb__type${list ? `.is-${list}` : ""}`, {
						type: "button",
						"aria-pressed": `${!!list}`,
						"data-ewc-fk": `${fk}-dt-${type}`,
						"data-ewc-dt": type,
						title: list ? `${toTitle(list)} to ${type} — press to ${list === defenseList ? "remove" : `change to ${listLabel.toLowerCase()}`}` : `${listLabel} ${type}`,
						onclick: () => {
							form = list && list !== defenseList ? getCockpitFormWithDefense(getCockpitFormWithDefense(form, list, type), defenseList, type) : getCockpitFormWithDefense(form, defenseList, type);
							rerender();
						},
					}, type, list ? h("span.ewc-fxb__tag", {"aria-hidden": "true"}, DEFENSE_SHORT[list]) : null);
				}),
			),
			count ? h("button.ewc-btn.ewc-btn--link.ewc-fxb__clear", {
				type: "button",
				"data-ewc-fk": `${fk}-defclr`,
				onclick: () => { form = {...form, resist: [], immune: [], vulnerable: []}; rerender(); },
			}, "Clear all defenses") : null,
		);
	};

	const draw = () => {
		const preview = getCockpitEffectDef({...form, name: form.name || "Effect"});
		const isUntil = form.durationUnit === "until";
		replaceKeepingFocus(container, [h("div.ewc-fxb", {"data-ewc-fxb": fk, onkeydown: onKeyDown},
			h("div.ewc-fxb__line",
				null,
				h("input.ewc-input.ewc-fxb__name", {
					type: "text",
					placeholder: "Effect name — e.g. Cover, Rally, Web",
					"aria-label": "Effect name",
					maxlength: "60",
					"data-ewc-fk": `${fk}-name`,
					"data-ewc-field": "name",
					"aria-invalid": error?.field === "name" ? "true" : null,
					value: form.name,
					oninput: evt => set({name: evt.target.value}),
				}),
				h("div.ewc-seg", {role: "radiogroup", "aria-label": "Effect kind"}, [["buff", "Buff"], ["debuff", "Debuff"]].map(([value, label]) => h("button.ewc-seg__b", {
					type: "button",
					role: "radio",
					"aria-checked": `${form.kind === value}`,
					"data-ewc-fk": `${fk}-kind-${value}`,
					onclick: () => { set({kind: value}); rerender(); },
				}, label))),
			),
			form.mods.length ? h("ol.ewc-fxb__mods", {"aria-label": "Modifiers"}, form.mods.map(getModRow)) : null,
			h("div.ewc-fxb__adds", null,
				h("button.ewc-btn.ewc-btn--link.ewc-fxb__more", {
					type: "button",
					"data-ewc-fk": `${fk}-addmod`,
					onclick: () => {
						form = {...form, mods: [...form.mods, getCockpitModForTarget("ac")]};
						rerender();
						container.querySelector(`[data-ewc-fk="${fk}-mt-${form.mods.length - 1}"]`)?.focus();
					},
				}, "＋ Modifier"),
			),
			getDefenses(),
			h("div.ewc-fxb__line.ewc-fxb__dur", null,
				h("span.ewc-field__l", null, "Lasts"),
				h("input.ewc-input.ewc-input--sm.ewc-input--num", {
					type: "text",
					inputmode: "numeric",
					"aria-label": "Duration amount",
					"data-ewc-fk": `${fk}-dur`,
					"data-ewc-field": "duration",
					"aria-invalid": error?.field === "duration" ? "true" : null,
					disabled: isUntil,
					value: isUntil ? "" : form.durationAmount,
					placeholder: isUntil ? "—" : "1",
					oninput: evt => set({durationAmount: evt.target.value}),
				}),
				h("select.ewc-input.ewc-input--sm", {
					"aria-label": "Duration unit",
					"data-ewc-fk": `${fk}-unit`,
					onchange: evt => {
						set({durationUnit: evt.target.value, durationAmount: evt.target.value === "until" ? "" : form.durationAmount || "1"});
						rerender();
					},
				}, COCKPIT_DURATION_UNITS.map(it => getOption(it.value, it.label, form.durationUnit))),
				h("label.ewc-check", {title: "The caster concentrates on it; it ends when their concentration does"},
					h("input", {type: "checkbox", checked: form.conc, "data-ewc-fk": `${fk}-conc`, onchange: evt => set({conc: evt.target.checked})}),
					"Concentration"),
			),
			h("input.ewc-input.ewc-input--sm.ewc-fxb__note", {
				type: "text",
				placeholder: "Note (optional) — shown on hover",
				"aria-label": "Note",
				"data-ewc-fk": `${fk}-note`,
				value: form.note,
				oninput: evt => set({note: evt.target.value}),
			}),
			preview.ok ? h("p.ewc-fxb__sum.ewc-muted", null, getCockpitEffectSummary(preview.def)) : null,
			error ? h("p.ewc-error.ewc-fxb__err", {role: "alert"}, error.message) : null,
			h("div.ewc-fxb__btns", null,
				isSaveOptional ? h("label.ewc-check", {title: "Keep it in this encounter's saved effects so you can apply it again"},
					h("input", {type: "checkbox", checked: isSave, "data-ewc-fk": `${fk}-save`, onchange: evt => { isSave = evt.target.checked; }}),
					"Save for reuse") : null,
				h("span.ewc-fxb__gap"),
				onCancel ? h("button.ewc-btn.ewc-btn--ghost.ewc-btn--sm", {type: "button", "data-ewc-fk": `${fk}-cancel`, onclick: () => onCancel()}, "Cancel") : null,
				h("button.ewc-btn.ewc-btn--primary.ewc-btn--sm", {type: "button", "data-ewc-fk": `${fk}-submit`, "data-ewc-fxb-submit": "", disabled: isBusy, onclick: () => pSubmit()}, submitLabel),
			),
		)]);
		return container;
	};

	return {
		render (ele) {
			container = ele;
			return draw();
		},
		getForm: () => ({...form, isSave}),
		setForm (next) {
			form = getCockpitEmptyEffectForm(next || {});
			error = null;
			rerender();
		},
		reset,
		focus: () => container?.querySelector(`[data-ewc-fk="${fk}-name"]`)?.focus(),
		validate,
		submit: () => pSubmit(),
	};
}

/** One-shot convenience: create a builder and render it into `container`. Returns the builder. */
export function renderCockpitEffectBuilder (container, opts) {
	const builder = createCockpitEffectBuilder(opts);
	builder.render(container);
	return builder;
}
