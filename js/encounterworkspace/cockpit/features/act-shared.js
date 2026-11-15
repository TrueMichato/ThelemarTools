/** P3a — small DOM helpers shared by the Act features (roll tab, tray, Fx tab, console). */

import {getEncounterBattlefieldHover} from "../../encounterworkspace-battlefield.js";
import {h, kbd} from "../dom.js";
import {getCockpitKeyLabels} from "../keymap.js";

export const toTitle = text => `${text ?? ""}`.replace(/\b\w/g, it => it.toUpperCase());
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `<kbd>` chips for platform keys, e.g. getKbd(["Shift"], api.isMac). */
export const getKbd = (keys, isMac) => kbd(getCockpitKeyLabels(keys, {isMac}));

/** "Goblin 1, Goblin 2 +3". */
export function getWhoText (ids, labels) {
	const names = ids.map(id => labels.get(id) || id);
	if (!names.length) return "nobody";
	return names.length > 3 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

/**
 * Bind a native hover for a contributor source ("condition:prone", "effect:fx:…", "template:minion",
 * "battlefield:bf…"). Unknown sources get a plain tooltip so every line still explains itself.
 */
export function bindCockpitSource (ele, source, {hover, instance, state, conditionCatalog, label}) {
	if (!ele || !source) return ele;
	const [kind, ...rest] = `${source}`.split(":");
	const key = rest.join(":");
	if (kind === "condition" && key) return hover.bindCondition(ele, key, {conditionCatalog});
	if (kind === "effect" && key) {
		const effect = (instance?.effects || []).find(it => it.id === key);
		if (effect) return hover.bindEffect(ele, instance, effect);
	}
	if (kind === "template" && key) {
		const template = (instance?.templates || []).find(it => it.key === key);
		if (template) return hover.bindEntry(ele, `template:${instance.id}:${key}`, {type: "entries", name: template.name || toTitle(key), entries: [template.description || "A creature template applied in this encounter."].filter(Boolean)});
	}
	if (kind === "battlefield" && key) {
		const entry = (state?.battlefield || []).find(it => it.id === key);
		if (entry) {
			const info = getEncounterBattlefieldHover(state, entry);
			return hover.bindEntry(ele, `bf:${key}`, {type: "entries", name: info.title, entries: [info.description, info.note].filter(Boolean)});
		}
	}
	ele.title = {statblock: "From the statblock", forced: "Chosen when rolling (Shift / Ctrl)", battlefield: "From the battlefield", condition: "From a condition", effect: "From an effect", template: "From a template"}[kind] || label || "";
	return ele;
}

/** A labelled radio-like segmented control using the shell's `.ewc-seg`. */
export function getSeg ({label, options, value, onPick, fk, isFull = false}) {
	return h(`div.ewc-seg${isFull ? ".ewc-act__segfull" : ""}`, {role: "radiogroup", "aria-label": label}, options.map(it => h("button.ewc-seg__b", {
		type: "button",
		role: "radio",
		"aria-checked": `${it.value === value}`,
		title: it.title || null,
		"data-ewc-fk": `${fk}-${it.value}`,
		onclick: () => onPick(it.value),
	}, it.label)));
}

export const getOption = (value, label, selected) => h("option", {value, selected: value === selected}, label);
