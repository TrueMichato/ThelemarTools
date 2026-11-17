/**
 * ⋯ menu → Theme: a swatch per cockpit colour theme, with a check on the active one. View-only and per device —
 * it writes localStorage (see theme-model.js), never the encounter save or undo.
 */
import {h} from "../dom.js";
import {COCKPIT_THEMES, applyCockpitTheme, getCockpitThemeMeta, getStoredCockpitTheme, setStoredCockpitTheme} from "../theme-model.js";

const SVG_CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function installCockpitThemePicker (api, {root = globalThis.document?.getElementById("ew-cockpit")} = {}) {
	let active = applyCockpitTheme(root, getStoredCockpitTheme());

	const choose = id => {
		if (id === active) return;
		active = applyCockpitTheme(root, id);
		if (!setStoredCockpitTheme(active)) api.toast("Theme applied for this visit only: this browser would not store it.", {kind: "error"});
		api.render();
		// The top bar rebuilds the menu on render; keep keyboard focus on the swatch just chosen.
		globalThis.document?.querySelector(`.ewc-themes__b[data-ewc-theme-pick="${active}"]`)?.focus();
	};

	// A radio group: the checked swatch is the one Tab stop, and arrows / Home / End pick a neighbour.
	const onKey = evt => {
		const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[evt.key];
		const ix = COCKPIT_THEMES.findIndex(it => it.id === active);
		const next = evt.key === "Home" ? 0 : evt.key === "End" ? COCKPIT_THEMES.length - 1 : step == null ? null : (ix + step + COCKPIT_THEMES.length) % COCKPIT_THEMES.length;
		if (next == null) return;
		evt.preventDefault();
		evt.stopPropagation();
		choose(COCKPIT_THEMES[next].id);
	};

	// One row of swatches keeps the menu inside a 800px-tall window; the heading names the active theme and each
	// swatch's tooltip (and accessible name) carries its own.
	return api.addMenuSection(() => [
		h("div.ewc-menu__h.ewc-themes__h", {"aria-hidden": "true"}, "Theme", h("span.ewc-themes__now", null, getCockpitThemeMeta(active).label)),
		h("div.ewc-themes", {role: "radiogroup", "aria-label": "Theme", onkeydown: onKey}, COCKPIT_THEMES.map(theme => h("button.ewc-themes__b", {
			type: "button",
			role: "radio",
			"aria-checked": `${theme.id === active}`,
			tabindex: theme.id === active ? "0" : "-1",
			"aria-label": theme.label,
			"data-ewc-theme-pick": theme.id,
			title: `${theme.label} — ${theme.description}`,
			onclick: () => choose(theme.id),
		}, h(`span.ewc-themes__sw.ewc-themes__sw--${theme.id}`, {"aria-hidden": "true"}, h("span.ewc-themes__chk", {html: SVG_CHECK}))))),
	]);
}
