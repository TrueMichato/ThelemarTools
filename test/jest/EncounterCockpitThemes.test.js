import fs from "node:fs";
import {
	COCKPIT_THEMES,
	COCKPIT_THEME_DEFAULT,
	COCKPIT_THEME_STORAGE_KEY,
	applyCockpitTheme,
	getStoredCockpitTheme,
	isCockpitTheme,
	setStoredCockpitTheme,
} from "../../js/encounterworkspace/cockpit/theme-model.js";

const mkStorage = (init = {}) => {
	const map = new Map(Object.entries(init));
	return {
		map,
		getItem: k => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, `${v}`),
		removeItem: k => map.delete(k),
	};
};
const throwingStorage = {
	getItem: () => { throw new Error("SecurityError"); },
	setItem: () => { throw new Error("QuotaExceededError"); },
	removeItem: () => { throw new Error("SecurityError"); },
};

describe("cockpit theme model", () => {
	test("the current look is the default and is listed first", () => {
		expect(COCKPIT_THEME_DEFAULT).toBe("default");
		expect(COCKPIT_THEMES[0]).toMatchObject({id: "default", label: "Default"});
		expect(COCKPIT_THEMES.map(it => it.id)).toEqual(["default", "thelemar", "parchment", "forest", "arcane", "forge", "contrast"]);
	});

	test("only known ids are themes", () => {
		expect(isCockpitTheme("forest")).toBe(true);
		expect(isCockpitTheme("lantern")).toBe(false);
		expect(isCockpitTheme("toString")).toBe(false);
		expect(isCockpitTheme(null)).toBe(false);
	});

	test("reading falls back to the default for missing, unknown or unreadable storage", () => {
		expect(getStoredCockpitTheme(mkStorage({[COCKPIT_THEME_STORAGE_KEY]: "arcane"}))).toBe("arcane");
		expect(getStoredCockpitTheme(mkStorage({[COCKPIT_THEME_STORAGE_KEY]: "neon"}))).toBe("default");
		expect(getStoredCockpitTheme(mkStorage())).toBe("default");
		expect(getStoredCockpitTheme(null)).toBe("default");
		expect(getStoredCockpitTheme(throwingStorage)).toBe("default");
	});

	test("writing stores a theme, clears the key for the default and reports refusal", () => {
		const storage = mkStorage();
		expect(setStoredCockpitTheme("thelemar", storage)).toBe(true);
		expect(storage.map.get(COCKPIT_THEME_STORAGE_KEY)).toBe("thelemar");
		expect(setStoredCockpitTheme("default", storage)).toBe(true);
		expect(storage.map.has(COCKPIT_THEME_STORAGE_KEY)).toBe(false);
		expect(setStoredCockpitTheme("neon", storage)).toBe(false);
		expect(storage.map.has(COCKPIT_THEME_STORAGE_KEY)).toBe(false);
		expect(setStoredCockpitTheme("forge", throwingStorage)).toBe(false);
		expect(setStoredCockpitTheme("forge", null)).toBe(false);
	});

	test("applying sets the root attribute, and the default (or an unknown id) removes it", () => {
		const root = {dataset: {}};
		expect(applyCockpitTheme(root, "forest")).toBe("forest");
		expect(root.dataset.ewcTheme).toBe("forest");
		expect(applyCockpitTheme(root, "default")).toBe("default");
		expect("ewcTheme" in root.dataset).toBe(false);
		applyCockpitTheme(root, "arcane");
		expect(applyCockpitTheme(root, "neon")).toBe("default");
		expect("ewcTheme" in root.dataset).toBe(false);
		expect(applyCockpitTheme(null, "arcane")).toBe("arcane");
	});
});

describe("cockpit theme stylesheet", () => {
	const scss = fs.readFileSync("scss/includes/encounterworkspace-cockpit-themes.scss", "utf8");
	const tokensOf = selector => {
		const start = scss.indexOf(`${selector} {`);
		if (start < 0) return null;
		const body = scss.slice(start, scss.indexOf("}", start));
		return [...body.matchAll(/(--ewc-[\w-]+):/g)].map(m => m[1]).sort();
	};

	test.each(COCKPIT_THEMES.filter(it => it.id !== COCKPIT_THEME_DEFAULT).map(it => it.id))(
		"%s overrides the same tokens in day and night, and only --ewc-* tokens",
		id => {
			const day = tokensOf(`.ewc[data-ewc-theme="${id}"]`);
			const night = tokensOf(`.ve-night-mode .ewc[data-ewc-theme="${id}"]`);
			expect(day?.length).toBeGreaterThan(40);
			expect(night).toEqual(day);
			const start = scss.indexOf(`.ewc[data-ewc-theme="${id}"] {`);
			const decls = scss.slice(start, scss.indexOf("}", start)).split("\n").slice(1).map(it => it.trim()).filter(Boolean);
			expect(decls.filter(it => !it.startsWith("--ewc-") && !it.startsWith("color-scheme:"))).toEqual([]);
		},
	);

	test.each(COCKPIT_THEMES.map(it => it.id))("%s has a day and a night menu swatch", id => {
		expect(scss.match(new RegExp(`&__sw--${id} \\{`, "g"))).toHaveLength(2);
	});
});
