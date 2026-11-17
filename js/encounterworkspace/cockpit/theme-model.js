/**
 * Cockpit colour themes — a per-device view preference (⋯ menu → Theme). A theme is only a `data-ewc-theme`
 * attribute on the cockpit root; scss/includes/encounterworkspace-cockpit-themes.scss swaps the `--ewc-*` tokens
 * for it in both day and night mode. Never part of the encounter save or undo.
 *
 * No imports, so the entry point can apply the stored theme before it un-hides the cockpit.
 */

export const COCKPIT_THEME_DEFAULT = "default";
export const COCKPIT_THEME_STORAGE_KEY = "ewc-theme";

export const COCKPIT_THEMES = Object.freeze([
	{id: "default", label: "Default", description: "Slate and indigo — the cockpit's standard look."},
	{id: "thelemar", label: "Thelemar", description: "The Traveler's Guide's sea-teal and gilt, with Illrigger crimson for blood."},
	{id: "parchment", label: "Parchment", description: "Vellum and iron-gall ink, lapis and gilt — a classic tabletop page."},
	{id: "forest", label: "Forest", description: "Pine and leaf on lichen, with an oiled-bark turn."},
	{id: "arcane", label: "Arcane", description: "Grimoire violet with a teal ward-glow for the turn."},
	{id: "forge", label: "Forge", description: "Ember on cold iron, with a quench-steel turn."},
	{id: "contrast", label: "High contrast", description: "Pure grounds, heavy rules and maximum text contrast."},
].map(it => Object.freeze(it)));

const THEME_IDS = new Set(COCKPIT_THEMES.map(it => it.id));

export const isCockpitTheme = id => typeof id === "string" && THEME_IDS.has(id);

export const getCockpitThemeMeta = id => COCKPIT_THEMES.find(it => it.id === id) || COCKPIT_THEMES[0];

const getStorage = storage => {
	if (storage !== undefined) return storage;
	try {
		return globalThis.localStorage || null;
	} catch {
		return null;
	}
};

/** The stored theme id, or the default when nothing valid is stored or storage is unavailable. */
export const getStoredCockpitTheme = storage => {
	try {
		const id = getStorage(storage)?.getItem(COCKPIT_THEME_STORAGE_KEY);
		return isCockpitTheme(id) ? id : COCKPIT_THEME_DEFAULT;
	} catch {
		return COCKPIT_THEME_DEFAULT;
	}
};

/** Persist a theme id; the default is stored as "no preference". Returns false when storage refused it. */
export const setStoredCockpitTheme = (id, storage) => {
	if (!isCockpitTheme(id)) return false;
	try {
		const store = getStorage(storage);
		if (!store) return false;
		if (id === COCKPIT_THEME_DEFAULT) store.removeItem(COCKPIT_THEME_STORAGE_KEY);
		else store.setItem(COCKPIT_THEME_STORAGE_KEY, id);
		return true;
	} catch {
		return false;
	}
};

/** Set the theme attribute on the cockpit root; the default theme carries no attribute. Returns the applied id. */
export const applyCockpitTheme = (root, id) => {
	const next = isCockpitTheme(id) ? id : COCKPIT_THEME_DEFAULT;
	if (!root) return next;
	if (next === COCKPIT_THEME_DEFAULT) delete root.dataset.ewcTheme;
	else root.dataset.ewcTheme = next;
	return next;
};
