/** P3c — small DOM helpers shared by the flow features. */
import {isCockpitTypingTarget} from "../keymap.js";
import {getCockpitSpellHoverMeta} from "../hover.js";

const PREF_KEY = "ewcFlowPrefs";

export function getFlowRoot (api) {
	return api.getRegion("layer")?.parentElement || null;
}

/** Whether a cockpit-wide key (outside the keymap) may run now: cockpit visible, nobody typing, no dialog or modal open. */
export function isFlowKeyAllowed (api, evt) {
	const root = getFlowRoot(api);
	if (!root || root.hidden || evt.defaultPrevented || evt.isComposing) return false;
	if (document.body.classList.contains("ve-ui-modal__body-active")) return false;
	if (document.querySelector("dialog[open]")) return false;
	if (evt.target instanceof Node && !root.contains(evt.target) && evt.target !== document.body && evt.target !== document.documentElement) return false;
	return !isCockpitTypingTarget(evt, {activeElement: document.activeElement});
}

/** Keys pressed inside a feature dialog or popover must not reach the cockpit keymap (N, Esc → clear selection, …). */
export function isolateFlowKeys (ele) {
	ele.addEventListener("keydown", evt => evt.stopPropagation());
	return ele;
}

export function getFlowPrefs () {
	try {
		return JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) || "{}") || {};
	} catch {
		return {};
	}
}

export function setFlowPrefs (patch) {
	try {
		globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({...getFlowPrefs(), ...patch}));
	} catch { /* private mode: keep the session value only */ }
}

/** The spell a caster concentrates on, when an effect it holds up names one ({name, source}); else null. */
export function getFlowConcentrationSpell (state, casterId, label) {
	for (const instance of state.instances) {
		const fx = (instance.effects || []).find(it => it.casterId === casterId && it.concOn === label && it.spell?.name);
		if (fx) return fx.spell;
	}
	return null;
}

/** Bind a site hover to a concentration label when it is a known spell; otherwise a plain title. */
export function bindFlowConcentration (api, ele, state, casterId, label) {
	const spell = getFlowConcentrationSpell(state, casterId, label);
	const meta = spell ? getCockpitSpellHoverMeta(spell) : null;
	if (meta) return api.hover.bindLink(ele, meta);
	ele.title = `Concentrating on ${label}`;
	return ele;
}

export function getFlowPlural (n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
