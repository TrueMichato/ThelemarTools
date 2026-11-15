import {expect, test, type Page} from "@playwright/test";

/*
 * Lantern Cockpit (encounterworkspace.html?ew=2) top bar, ⋯ menu and Keys sheet on real Monster Manual data plus two
 * party members (one linked to a saved level-3 character): difficulty badge + popover, kbd hints on the turn chip and
 * undo/redo, the List | Timeline switch, the labelled Keys button, the compact site header, auto-rolled recharge,
 * foe initiative re-rolls with advantage, the ⋯ menu's how-to hint, and the glyph legend. Fails on any console error.
 */

const seed = async (page: Page, {isHoundSpent = false} = {}) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async ({isHoundSpent}) => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const {getEncounterResourceDefaults} = await import("/js/encounterworkspace/encounterworkspace-resources.js");
		const {createEncounterPartyInstance} = await import("/js/encounterworkspace/encounterworkspace-party.js");
		const {getEncounterInstanceV8Defaults} = await import("/js/encounterworkspace/encounterworkspace-state.js");
		const mk = (id: string, name: string, initiative: number) => {
			const monster = monsters.find((it: {name: string}) => it.name === name);
			if (!monster) throw new Error(`MM has no ${name}`);
			const hash = `${monster.name.toLowerCase()}_mm`;
			return {
				id,
				hash,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
				initiative,
				resources: getEncounterResourceDefaults(monster),
				...getEncounterInstanceV8Defaults(hash),
			};
		};
		const hound = mk("hound", "Hell Hound", 14);
		if (!hound.resources.recharges.length) throw new Error("Hell Hound has no recharge ability");
		if (isHoundSpent) hound.resources.recharges[0].ready = false;
		const state = {
			version: 8,
			sourceList: {name: "Hound Pack", saveId: "cockpit-topbar"},
			instances: [
				mk("gob-1", "Goblin", 18),
				createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, initiative: 16, characterId: "char-brenna"}),
				hound,
				createEncounterPartyInstance({id: "cael", name: "Cael", ac: 13, hpMax: 18, initiative: 11}),
				mk("owlbear", "Owlbear", 12),
				mk("gob-2", "Goblin", 9),
			],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
			battlefield: [],
			groupMeta: {},
			log: [],
			savedEffects: [],
			combat: {status: "setup"},
		};
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {
				pSet: (key: string, value: unknown) => Promise<void>,
				pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
			},
		};
		await StorageUtil.pSet("charsheet-characters", [{id: "char-brenna", name: "Brenna", classes: [{name: "Fighter", level: 3}], _savedAt: 1}]);
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	}, {isHoundSpent});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(6);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const toasts = (page: Page) => page.locator(".ewc-toasts");
const blur = (page: Page) => page.locator("body").click({position: {x: 5, y: 5}});
const openMenu = async (page: Page) => {
	// The site's dice box stays open after a roll until closed, and can cover the foot of the menu.
	const rollbox = page.locator(".rollbox .head-roll");
	if (await rollbox.isVisible()) await rollbox.click();
	await page.locator("[data-ewc-act='menu']").click();
	await expect(page.locator("#ewc-menu")).toBeVisible();
};
const initOf = async (page: Page, id: string) => Number((await row(page, id).locator(".ewc-row__init").textContent())?.trim());
const savedState = (page: Page) => page.evaluate(async () => {
	const {StorageUtil} = globalThis as typeof globalThis & {StorageUtil: {pGetForPage: (key: string, options: {page: string}) => Promise<any>}};
	return StorageUtil.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"});
});

const trackConsoleErrors = (page: Page) => {
	const errors: string[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		if (msg.location().url.endsWith("/sw-injector.js") && /404|Failed to load resource/i.test(msg.text())) return;
		if (/\/img\//.test(msg.location().url) && /404|Failed to load resource/i.test(msg.text())) return;
		errors.push(msg.text());
	});
	page.on("pageerror", err => errors.push(`${err.name}: ${err.message}`));
	return errors;
};

test.describe("Encounter cockpit top bar (?ew=2)", () => {
	test.use({viewport: {width: 1280, height: 800}});

	test("difficulty badge, kbd hints, List | Timeline, Keys button and the compact site header", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// D1: the badge rates the foes still fighting against the party (one saved level-3 character, one assumed);
		// 2014 budgets: 1,500 XP ×2.5 for four foes vs two PCs is far past the level-3 Deadly threshold.
		const badge = page.locator("[data-ewc-act='difficulty']");
		await expect(badge.locator(".ewc-badge__w")).toHaveText("Absurd");
		await expect(badge.locator(".ewc-badge__w")).toHaveClass(/is-deadly/);
		await expect(badge.locator(".ewc-badge__xp")).toHaveText("1,500 XP");
		await expect(badge).toHaveAttribute("aria-label", /Absurd/);
		await badge.click();
		const pop = page.locator("#ewc-diffpop");
		await expect(pop).toBeVisible();
		await expect(badge).toHaveAttribute("aria-expanded", "true");
		await expect(pop.locator("[data-ewc-diff-total]")).toHaveText("1,500 XP");
		await expect(pop.locator("[data-ewc-diff-earned]")).toHaveText("0 XP");
		await expect(pop.locator("[data-ewc-diff-defeated]")).toHaveText("No foes defeated yet.");
		await expect(pop).toContainText("4 foes vs 2 party members");
		await expect(pop).toContainText("1 unlinked party member is assumed");
		await page.keyboard.press("Escape");
		await expect(pop).toBeHidden();
		await expect(badge).toBeFocused();

		// Defeat a goblin: the badge drops its XP, the popover lists it as earned.
		await row(page, "gob-1").locator(".ewc-row__name").click();
		await page.locator("#ewc-hp-amt").fill("99");
		await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
		await expect(badge.locator(".ewc-badge__xp")).toHaveText("1,450 XP");
		await badge.click();
		await expect(pop.locator("[data-ewc-diff-earned]")).toHaveText("50 XP");
		await expect(pop.locator("[data-ewc-diff-defeated] li")).toHaveText([/^Goblin.*50 XP$/]);
		await blur(page);
		await expect(pop).toBeHidden();

		// D2/D3: the turn chip and undo/redo show their keys.
		await page.locator("[data-ewc-act='next']").click();
		await expect(page.locator("[data-ewc-turnchip] .ewc-kbd")).toHaveText("Space");
		await expect(page.locator("[data-ewc-act='undo'] .ewc-kbd")).toHaveText(/^(⌘Z|Ctrl Z)$/);
		await expect(page.locator("[data-ewc-act='redo'] .ewc-kbd")).toHaveText(/^(⌘⇧Z|Ctrl Y)$/);

		// In combat the one-row bar is at its widest; at every one-row width the encounter cluster keeps the whole
		// difficulty badge, and no cluster overlaps its neighbour or spills out of the bar.
		for (const width of [1441, 1400, 1280, 1241, 1181]) {
			await page.setViewportSize({width, height: 800});
			await expect.poll(() => page.evaluate(() => {
				const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
				const [enc, turn, tools, bar, badge] = [".ewc-bar__enc", ".ewc-bar__turn", ".ewc-bar__tools", ".ewc-bar", ".ewc-bar__enc .ewc-badge"].map(rect);
				const isOneRow = Math.abs(enc.top - tools.top) < 8;
				return isOneRow && badge.right <= enc.right + 0.5 && enc.right <= turn.left && turn.right <= tools.left && tools.right <= bar.right
					&& [...document.querySelectorAll(".ewc-bar > *")].every(el => el.scrollWidth <= el.clientWidth + 1);
			}), {message: `bar layout at ${width}px`}).toBe(true);
		}
		await page.setViewportSize({width: 1280, height: 800});

		// D4: List | Timeline is a segmented switch that always shows the current view.
		const list = page.locator("[data-ewc-flow='list']");
		const timeline = page.locator("[data-ewc-flow='timeline']");
		await expect(list).toHaveAttribute("aria-pressed", "true");
		await expect(timeline).toHaveAttribute("aria-pressed", "false");
		await timeline.click();
		await expect(timeline).toHaveAttribute("aria-pressed", "true");
		await expect(list).toHaveAttribute("aria-pressed", "false");
		await list.click();
		await expect(list).toHaveAttribute("aria-pressed", "true");
		await blur(page);
		await page.keyboard.press("t");
		await expect(timeline).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("t");
		await expect(list).toHaveAttribute("aria-pressed", "true");

		// D5: the Keys button keeps its label, even on the two-row narrow bar.
		const keysLbl = page.locator("[data-ewc-act='help'] .ewc-btn__lbl");
		await expect(keysLbl).toBeVisible();
		await expect(keysLbl).toHaveText("Keys");

		// D49: banner and nav share one row at 1280, so the cockpit starts right under the nav.
		const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
		const nav = await box("#navigation");
		const hdr = await box(".page__header");
		expect(Math.abs(nav.y - hdr.y)).toBeLessThanOrEqual(1);
		expect((await box(".ewc")).y).toBeLessThanOrEqual(40);
		await expect(page.locator("#navbar")).toBeVisible();

		// Narrower than both fit, they wrap to two rows and the cockpit moves down rather than overlapping or clipping.
		for (const width of [1100, 900]) {
			await page.setViewportSize({width, height: 800});
			await expect(keysLbl).toBeVisible();
			await expect.poll(async () => {
				const n = await box("#navigation");
				const c = await box(".ewc");
				return c.y >= n.y + n.height - 1 && c.y + c.height <= 801;
			}).toBe(true);
		}

		expect(errors).toEqual([]);
	});

	test("⋯ menu: auto-roll recharge at turn start, foe re-roll with advantage, how-to hint", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page, {isHoundSpent: true});
		await openCockpit(page);

		// D6: the setting persists (page-wide) and survives a reload.
		await openMenu(page);
		const auto = page.locator("[data-ewc-setting='autoRollRecharge']");
		await expect(auto).not.toBeChecked();
		await auto.check();
		await expect(toasts(page)).toContainText("Recharge abilities roll at the start of each monster's turn.");
		await openCockpit(page);
		await openMenu(page);
		await expect(page.locator("[data-ewc-setting='autoRollRecharge']")).toBeChecked();
		await page.keyboard.press("Escape");

		// D7: re-roll only the foes, with advantage; the party keeps its initiative; Undo restores the foes'.
		const before = {gob: await initOf(page, "gob-1"), owl: await initOf(page, "owlbear"), brenna: await initOf(page, "brenna"), cael: await initOf(page, "cael")};
		await page.evaluate(() => {
			// Each foe's pair of d20s shows 3 then 17: advantage keeps 17 (a normal roll would alternate 3 / 17).
			const {RollerUtil} = globalThis as typeof globalThis & {RollerUtil: {randomise: (max: number, min?: number) => number}};
			const randomise = RollerUtil.randomise.bind(RollerUtil);
			let n = 0;
			RollerUtil.randomise = (max, min) => max === 20 ? (n++ % 2 ? 17 : 3) : randomise(max, min);
		});
		await openMenu(page);
		await page.locator("[data-ewc-menu='rerollfoes-advantage']").click();
		const toast = toasts(page).locator(".ewc-toast").last();
		await expect(toast).toContainText("Foe initiative re-rolled with advantage. Initiative (advantage):");
		expect(await initOf(page, "brenna")).toBe(before.brenna);
		expect(await initOf(page, "cael")).toBe(before.cael);
		await expect(toast).toContainText("Goblin 1 19 · Hell Hound 18 · Owlbear 18 · Goblin 2 19.");
		await expect.poll(() => initOf(page, "gob-1")).toBe(19);
		await toast.getByRole("button", {name: /Undo/}).click();
		await expect.poll(() => initOf(page, "gob-1")).toBe(before.gob);
		expect(await initOf(page, "owlbear")).toBe(before.owl);

		// D6 behaviour: starting combat walks to the hound's turn; its spent Fire Breath rolls 1d6 (6 → ready).
		await page.evaluate(() => {
			const {Renderer} = globalThis as typeof globalThis & {Renderer: {dice: {pRoll2: () => Promise<number>}}};
			Renderer.dice.pRoll2 = async () => 6;
		});
		const next = page.locator("[data-ewc-act='next']");
		await next.click(); // Goblin 1
		await next.click(); // Brenna
		await expect(toasts(page)).not.toContainText("Recharge:");
		await next.click(); // Hell Hound
		await expect(page.locator("[data-ewc-turnchip]")).toContainText("Hell Hound");
		await expect(toasts(page)).toContainText("Recharge: 1 of 1 spent ability ready.");
		await expect.poll(async () => (await savedState(page)).instances.find((it: {id: string}) => it.id === "hound").resources.recharges[0].ready).toBe(true);

		// D8: "Show the how-to hint" brings the dismissed hint card back (api.showHint, drawn by stage-affordances).
		const hint = page.locator(".ewc-hint");
		if (await hint.isVisible()) await page.locator(".ewc-hint__x").click();
		await expect(hint).toBeHidden();
		await openMenu(page);
		await page.locator("[data-ewc-menu='hint']").click();
		await expect(hint).toBeVisible();
		await expect(page.locator("#ewc-menu")).toBeHidden();

		expect(errors).toEqual([]);
	});

	test("the Keys sheet lists the prep keys and explains the pill glyphs", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		await page.locator("[data-ewc-act='help']").click();
		const sheet = page.getByRole("dialog", {name: /Keyboard shortcuts/});
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText("Single keys work whenever you're not typing");

		// D48: listed on the sheet…
		const prep = sheet.locator(".ewc-keys__sec").filter({has: page.locator(".ewc-keys__h", {hasText: /^Prep$/})});
		await expect(prep).toContainText("Switch prep tabs");
		await expect(prep).toContainText("First / last prep tab");
		await expect(prep).toContainText("Save the open edit");

		// D47: …and the legend uses the rail's own pills.
		const legend = sheet.locator("[data-ewc-legend]");
		for (const [glyph, label] of [["▲", "Buff"], ["▼", "Debuff"], ["⬡", "Battlefield effect"], ["✦", "Template"]]) {
			await expect(legend.locator(".ewc-keys__row").filter({hasText: new RegExp(`^${glyph}\\s*${label}$`)}).locator(".ewc-pill--fx")).toHaveText(glyph);
		}
		await expect(legend).toContainText("◉ Conc");
		await expect(legend.locator(".ewc-pill--cond")).toContainText("2r");
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		// …and the prep tab arrows actually work.
		await page.locator("[data-ewc-act='prep'], button:has-text('Enter Prep Mode')").first().click();
		const tab = page.locator("[data-ewc-prep-tab='creature']");
		await tab.focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.locator("[data-ewc-prep-tab='fx']")).toBeFocused();
		await expect(page.locator("[data-ewc-prep-tab='fx']")).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("End");
		await expect(page.locator("[data-ewc-prep-tab='add']")).toBeFocused();

		expect(errors).toEqual([]);
	});
});
