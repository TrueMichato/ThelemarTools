import {expect, test, type Page} from "@playwright/test";

/*
 * Cockpit colour themes (encounterworkspace.html?ew=2, ⋯ menu → Theme): picking each theme sets the root attribute
 * and swaps the --ewc-* tokens; the choice persists per device across reloads, is applied before the cockpit is
 * first shown, and never touches the encounter save or undo. Every optional theme is then contrast-scanned in day and
 * night: the live rail/stage/dock, the ⋯ menu, the difficulty popover, the Keys sheet and a toast, plus the token
 * pairs the DOM scan can't reach (fills and their ink, focus ring, HP bars). Fails on any console error.
 */

const SHOT_DIR = process.env.EWC_THEME_SHOT_DIR || "test-results/encounter-cockpit-themes";
const SAVE_KEY = "encounterWorkspaceState";

const THEMES = ["default", "thelemar", "parchment", "forest", "arcane", "forge", "contrast"] as const;
const LABELS: Record<string, string> = {default: "Default", thelemar: "Thelemar", parchment: "Parchment", forest: "Forest", arcane: "Arcane", forge: "Forge", contrast: "High contrast"};
// Day `--ewc-base` per theme, as authored in the stylesheets.
const DAY_BASE: Record<string, string> = {default: "#f4f6fa", thelemar: "#eef3f2", parchment: "#f2e9d6", forest: "#eef1e8", arcane: "#f5f3fb", forge: "#f1eeea", contrast: "#fff"};

type Win = typeof globalThis & {
	StorageUtil: {
		pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>;
		pGetForPage: (key: string, options: {page: string}) => Promise<unknown>;
	};
};

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async () => {
		const {monster: monsters} = await (await fetch("data/bestiary/bestiary-mm.json")).json();
		const mk = (id: string, name: string, initiative: number, extra: Record<string, unknown> = {}) => {
			const monster = monsters.find((it: {name: string}) => it.name === name);
			if (!monster) throw new Error(`MM has no ${name}`);
			return {
				id,
				hash: `${name.toLowerCase()}_mm`,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
				initiative,
				...extra,
			};
		};
		// Every state colour on screen at once: the turn row, bloodied + temp HP, a down creature, conditions with
		// durations, a buff and a debuff, concentration, and a selected row.
		const state = {
			version: 4,
			sourceList: {name: "Crypt Ambush", saveId: "cockpit-themes"},
			instances: [
				mk("gob-1", "Goblin", 18, {
					hp: {current: 3, max: 7, temp: 2},
					conditions: ["poisoned", "prone"],
					conditionDetails: {poisoned: {rounds: 3}},
					effects: [{id: "fx1", key: "bless", name: "Bless", kind: "buff", mods: [{target: "attack", kind: "dice", value: "1d4"}], rounds: 10}],
				}),
				mk("mage", "Mage", 14, {
					conditions: ["concentrating"],
					effects: [{id: "fx2", key: "bane", name: "Bane", kind: "debuff", mods: [{target: "attack", kind: "dice", value: "-1d4"}], rounds: 10}],
				}),
				mk("skel", "Skeleton", 12, {hp: {current: 0, max: 13, temp: 0}}),
				mk("owl", "Owlbear", 9, {hp: {current: 40, max: 59, temp: 0}, conditions: ["frightened"]}),
			],
			selectedIds: ["mage"],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 2, activeId: "gob-1"},
		};
		await (globalThis as Win).StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(4);
};

const readSave = (page: Page) => page.evaluate(async key => JSON.stringify(
	await (globalThis as Win).StorageUtil.pGetForPage(key, {page: "encounterworkspace.html"}),
), SAVE_KEY);

// Flips site night mode, then waits out the colour transitions so nothing is scanned mid-fade.
const setNight = (page: Page, isNight: boolean) => page.evaluate(async night => {
	const cl = document.documentElement.classList;
	if (night) cl.add("ve-night-mode", "ve-night-mode--standard");
	else cl.remove("ve-night-mode", "ve-night-mode--standard");
	await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {})));
}, isNight);

const openMenu = async (page: Page) => {
	if (!await page.locator("#ewc-menu").isVisible()) await page.locator("[data-ewc-act='menu']").click();
	await expect(page.locator("#ewc-menu .ewc-themes")).toBeVisible();
};

const token = (page: Page, name: string) => page.locator("#ew-cockpit").evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

const trackConsoleErrors = (page: Page) => {
	const errors: string[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		if (msg.location().url.endsWith("/sw-injector.js") && /404|Failed to load resource/i.test(msg.text())) return;
		errors.push(msg.text());
	});
	page.on("pageerror", err => errors.push(`${err.name}: ${err.message}`));
	return errors;
};

/*
 * In-page WCAG check. `scanText` walks every visible text node under `root` and composites its colour (and any
 * ancestor opacity) over the stacked backgrounds behind it; the statblock body keeps the site's own colours, so only
 * its themed roll chips are checked. `pairs` resolves token pairs through real computed colours.
 */
const contrastProbe = (page: Page, {root, pairs}: {root: string; pairs: [string, string, number][]}) => page.evaluate(({root, pairs}) => {
	const parse = (s: string): number[] | null => {
		const m = s.match(/rgba?\(([^)]+)\)/);
		if (m) {
			const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
			return [p[0], p[1], p[2], p[3] ?? 1];
		}
		const c = s.match(/color\(srgb ([^)]+)\)/);
		if (!c) return null;
		const p = c[1].split(/[\s/]+/).filter(Boolean).map(Number);
		return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
	};
	const over = (top: number[], bot: number[]) => [0, 1, 2].map(i => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
	const lum = (c: number[]) => {
		const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
		return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
	};
	const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
	const bgOf = (el: Element) => {
		const layers: number[][] = [];
		for (let n: Element | null = el; n; n = n.parentElement) {
			const c = parse(getComputedStyle(n).backgroundColor);
			if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
		}
		let bg = [255, 255, 255, 1];
		if (!layers.length || layers[layers.length - 1][3] < 1) bg = parse(getComputedStyle(document.body).backgroundColor) || bg;
		for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
		return bg;
	};

	const fails: string[] = [];
	let checked = 0;
	const seen = new Set<Element>();
	const walker = document.createTreeWalker(document.querySelector(root)!, NodeFilter.SHOW_TEXT);
	for (let t = walker.nextNode(); t; t = walker.nextNode()) {
		const el = t.parentElement;
		if (!el || !t.textContent?.trim() || seen.has(el)) continue;
		seen.add(el);
		if (!el.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
		const rect = el.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		if (el.closest(":disabled, [aria-disabled='true'], [inert]")) continue;
		if (el.closest(".ewc-sb") && !el.closest(".ewc-roll")) continue;
		let op = 1;
		for (let n: Element | null = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
		const cs = getComputedStyle(el);
		const fg0 = parse(cs.color);
		if (!fg0) continue;
		const bg = bgOf(el);
		const r = ratio(over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg), bg);
		const size = parseFloat(cs.fontSize);
		const need = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
		checked++;
		if (r + 1e-3 < need) fails.push(`${r.toFixed(2)}<${need} "${t.textContent.trim().slice(0, 24)}" ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(",")})`);
	}

	const probe = document.createElement("span");
	document.querySelector("#ew-cockpit")!.append(probe);
	const resolve = (tok: string, ground: number[]) => {
		probe.style.color = `var(${tok})`;
		const c = parse(getComputedStyle(probe).color)!;
		return over(c, ground);
	};
	const base = resolve("--ewc-base", [255, 255, 255, 1]);
	for (const [fgTok, bgTok, need] of pairs) {
		const bg = resolve(bgTok, base);
		const r = ratio(resolve(fgTok, bg), bg);
		checked++;
		if (r + 1e-3 < need) fails.push(`${r.toFixed(2)}<${need} token ${fgTok} on ${bgTok}`);
	}
	probe.remove();
	return {checked, fails};
}, {root, pairs});

const GROUNDS = ["--ewc-base", "--ewc-chrome", "--ewc-surface", "--ewc-raised"];
const TOKEN_PAIRS: [string, string, number][] = [
	["--ewc-on-ind", "--ewc-ind", 4.5],
	["--ewc-on-ind", "--ewc-ind-strong", 4.5],
	["--ewc-on-ind", "--ewc-ind-hover", 4.5],
	["--ewc-on-bad", "--ewc-bad-strong", 4.5],
	["--ewc-on-bad-fill", "--ewc-bad", 4.5],
	["--ewc-gold-tag-ink", "--ewc-gold-tag", 4.5],
	...GROUNDS.flatMap(g => [
		["--ewc-ind", g, 3],
		["--ewc-ok-bar", g, 3],
		["--ewc-warn-bar", g, 3],
		["--ewc-bad-bar", g, 3],
		["--ewc-ink", g, 4.5],
		["--ewc-ink-4", g, 4.5],
		["--ewc-ind-text", g, 4.5],
		["--ewc-ok", g, 4.5],
		["--ewc-warn", g, 4.5],
		["--ewc-bad", g, 4.5],
		["--ewc-gold", g, 4.5],
	] as [string, string, number][]),
];

test.describe("Encounter cockpit themes (?ew=2)", () => {
	test("each theme is picked from ⋯, persists per device, paints first and never touches the save", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		const saveBefore = await readSave(page);
		const cockpit = page.locator("#ew-cockpit");

		expect(await cockpit.getAttribute("data-ewc-theme")).toBeNull();
		await openMenu(page);
		await expect(page.locator(".ewc-themes__b")).toHaveCount(THEMES.length);
		await expect(page.locator(".ewc-themes__b[aria-checked='true']")).toHaveAttribute("data-ewc-theme-pick", "default");
		await expect(page.locator(".ewc-themes__now")).toHaveText("Default");
		await expect(page.locator("[data-ewc-act='undo']")).toBeDisabled();

		// The whole picker fits inside the window at 1280×800.
		const menuBox = await page.locator("#ewc-menu").boundingBox();
		expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(800);

		const bases = new Set<string>();
		for (const id of [...THEMES.slice(1), THEMES[0]]) {
			await openMenu(page);
			const swatch = page.locator(`.ewc-themes__b[data-ewc-theme-pick="${id}"]`);
			await expect(swatch).toHaveAccessibleName(LABELS[id]);
			await swatch.click();
			if (id === "default") expect(await cockpit.getAttribute("data-ewc-theme")).toBeNull();
			else await expect(cockpit).toHaveAttribute("data-ewc-theme", id);
			await expect(page.locator(`.ewc-themes__b[data-ewc-theme-pick="${id}"]`)).toHaveAttribute("aria-checked", "true");
			await expect(page.locator(".ewc-themes__b[aria-checked='true']")).toHaveCount(1);
			await expect(page.locator(".ewc-themes__now")).toHaveText(LABELS[id]);
			// The menu stays open and keeps keyboard focus on the swatch just chosen.
			await expect(page.locator(`.ewc-themes__b[data-ewc-theme-pick="${id}"]`)).toBeFocused();
			expect(await token(page, "--ewc-base")).toBe(DAY_BASE[id]);
			bases.add(await token(page, "--ewc-base"));
			expect(await page.evaluate(() => localStorage.getItem("ewc-theme"))).toBe(id === "default" ? null : id);
		}
		expect(bases.size).toBe(THEMES.length);

		// Keyboard: one Tab stop (the checked swatch); arrows, End and Home pick a neighbour and keep focus on it.
		await expect(page.locator(".ewc-themes__b[tabindex='0']")).toHaveAttribute("data-ewc-theme-pick", "default");
		for (const [key, id] of [["ArrowRight", "thelemar"], ["End", "contrast"], ["ArrowRight", "default"], ["ArrowLeft", "contrast"], ["Home", "default"]] as const) {
			await page.keyboard.press(key);
			await expect(page.locator(`.ewc-themes__b[data-ewc-theme-pick="${id}"]`)).toHaveAttribute("aria-checked", "true");
			await expect(page.locator(`.ewc-themes__b[data-ewc-theme-pick="${id}"]`)).toBeFocused();
			await expect(page.locator(".ewc-themes__b[tabindex='0']")).toHaveCount(1);
		}

		// Night mode swaps to each theme's night tokens.
		await openMenu(page);
		await page.locator(".ewc-themes__b[data-ewc-theme-pick='forest']").click();
		await setNight(page, true);
		expect(await token(page, "--ewc-base")).toBe("#0f1410");
		await setNight(page, false);

		// Reload: the theme is restored, and it is already on the root the moment the cockpit is first shown.
		await page.addInitScript(() => {
			const w = window as typeof window & {__ewcThemeAtShow?: string | null};
			new MutationObserver((records, obs) => {
				const el = document.getElementById("ew-cockpit");
				if (!el || el.hidden) return;
				w.__ewcThemeAtShow = el.getAttribute("data-ewc-theme");
				obs.disconnect();
			}).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"]});
		});
		await openCockpit(page);
		expect(await page.evaluate(() => (window as typeof window & {__ewcThemeAtShow?: string | null}).__ewcThemeAtShow)).toBe("forest");
		await expect(cockpit).toHaveAttribute("data-ewc-theme", "forest");
		await openMenu(page);
		await expect(page.locator(".ewc-themes__b[aria-checked='true']")).toHaveAttribute("data-ewc-theme-pick", "forest");

		// View-only: the encounter save is byte-identical and there is nothing to undo.
		await expect(page.locator("[data-ewc-act='undo']")).toBeDisabled();
		expect(await readSave(page)).toBe(saveBefore);

		await page.screenshot({path: `${SHOT_DIR}/picker-forest.png`});
		expect(errors).toEqual([]);
	});

	for (const id of THEMES.slice(1)) {
		test(`${LABELS[id]} meets WCAG AA in day and night`, async ({page}) => {
			const errors = trackConsoleErrors(page);
			await seed(page);
			await page.evaluate(t => localStorage.setItem("ewc-theme", t), id);
			await openCockpit(page);
			await expect(page.locator("#ew-cockpit")).toHaveAttribute("data-ewc-theme", id);

			for (const isNight of [false, true]) {
				const mode = isNight ? "night" : "day";
				await setNight(page, isNight);
				const results: Record<string, string[]> = {};
				const counts: Record<string, number> = {};
				const record = (label: string, res: {checked: number; fails: string[]}) => { results[label] = res.fails; counts[label] = res.checked; };

				record("cockpit + tokens", await contrastProbe(page, {root: ".ewc", pairs: TOKEN_PAIRS}));
				await page.screenshot({path: `${SHOT_DIR}/${id}-${mode}.png`});

				await openMenu(page);
				record("⋯ menu", await contrastProbe(page, {root: "#ewc-menu", pairs: []}));
				await page.keyboard.press("Escape");

				await page.locator("[aria-controls='ewc-diffpop']").click();
				await expect(page.locator("#ewc-diffpop")).toBeVisible();
				record("difficulty popover", await contrastProbe(page, {root: "#ewc-diffpop", pairs: []}));
				await page.keyboard.press("Escape");

				await page.locator("[data-ewc-act='help']").click();
				await expect(page.locator("dialog.ewc-keys")).toBeVisible();
				record("Keys sheet", await contrastProbe(page, {root: "dialog.ewc-keys", pairs: []}));
				await page.locator("[data-ewc-act='close-keys']").click();

				// Toasts (plain and error), built with the shell's own markup so they sit still for the scan.
				await page.evaluate(() => Promise.all(["", " ewc-toast--error"].map(mod => {
					const toast = document.createElement("div");
					toast.className = `ewc-toast${mod}`;
					toast.innerHTML = `<p class="ewc-toast__t">Bless applied (10 rounds).</p><button type="button" class="ewc-btn ewc-btn--sm">Undo</button>`;
					document.querySelector(".ewc-toasts")!.append(toast);
					return Promise.all(toast.getAnimations().map(a => a.finished));
				})));
				record("toast", await contrastProbe(page, {root: ".ewc-toasts", pairs: []}));
				await page.evaluate(() => document.querySelector(".ewc-toasts")!.replaceChildren());

				expect(Object.entries(counts).filter(([, n]) => !n).map(([k]) => k), `${id}/${mode}: surfaces with nothing to check`).toEqual([]);
				expect(results, `${id}/${mode}`).toEqual(Object.fromEntries(Object.keys(results).map(k => [k, []])));
			}
			expect(errors).toEqual([]);
		});
	}
});
