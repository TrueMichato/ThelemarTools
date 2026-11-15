import {expect, test, type Locator, type Page} from "@playwright/test";

/*
 * A6 group view of the Lantern Cockpit (encounterworkspace.html?ew=2) on real Monster Manual data plus two party
 * members: the Initiative | Groups rail toggle, per-group headers (Select / Rename / Init / Roll once / Stack), the
 * Ungrouped and Party sections, stacked rows with summed HP and mini bars, the stack picker, expand / collapse, roster
 * find and sort, the Party chip, and the always-visible Group… button opening an anchored, non-modal popover.
 * Fails on any console error.
 */

const SHOT_DIR = process.env.EWC_GROUPS_SHOT_DIR || "test-results/encounter-cockpit-groups";

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async () => {
		localStorage.removeItem("ewc-rail-view");
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
		const state = {
			version: 8,
			sourceList: {name: "Goblin den", saveId: "cockpit-groups"},
			instances: [
				mk("gob-1", "Goblin", 18),
				createEncounterPartyInstance({id: "tarn", name: "Tarn", ac: 15, hpMax: 30, hpCurrent: 30, initiative: 17}),
				createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, hpCurrent: 3, initiative: 16}),
				mk("mage", "Mage", 14),
				mk("owlbear", "Owlbear", 12),
				mk("gob-3", "Goblin", 11),
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
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row").first()).toBeVisible();
};

const GOBLINS = ["gob-1", "gob-2", "gob-3"];
const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const flow = (page: Page, id: string) => page.locator(`[data-ewc-flow="${id}"]`);
const ghead = (page: Page, name: string) => page.locator(`.ewc-ghead[data-ewc-ghead="${name}"]`);
const gact = (page: Page, name: string, act: string) => ghead(page, name).locator(`[data-ewc-gact="${act}"]`);
const stackRow = (page: Page, name: string) => page.locator(`.ewc-row--stack[data-ewc-stack="${name}"]`);
const toasts = (page: Page) => page.locator(".ewc-toasts");
const blur = (page: Page) => page.locator("body").click({position: {x: 5, y: 5}});
const railSequence = (page: Page) => page.locator(".ewc-rail__list > li").evaluateAll(items => items.map(it => {
	const el = it as HTMLElement;
	return el.dataset.ewcGhead ? `# ${el.dataset.ewcGhead}` : el.dataset.ewcStack ? `stack ${el.dataset.ewcStack}` : el.dataset.ewcId;
}));
/** One section of the Groups view: its header followed by its rows. Section order follows initiative, which "Roll once" randomises. */
const railSection = async (page: Page, name: string) => {
	const seq = await railSequence(page);
	const start = seq.indexOf(`# ${name}`);
	if (start < 0) return [];
	const end = seq.findIndex((it, ix) => ix > start && it.startsWith("# "));
	return seq.slice(start, end < 0 ? undefined : end);
};
const initOf = async (page: Page, id: string) => (await row(page, id).locator(".ewc-row__init").innerText()).trim();
const below = async (pop: Locator, anchor: Locator) => {
	const [p, a] = [await pop.boundingBox(), await anchor.boundingBox()];
	return !!p && !!a && p.y >= a.y + a.height - 1 && p.y <= a.y + a.height + 24;
};

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

/** Tick the three goblins and create "Goblins" through the always-visible Group… button. */
const createGoblins = async (page: Page) => {
	for (const id of GOBLINS) await row(page, id).locator(".ewc-row__chk input").check();
	await flow(page, "group-open").click();
	const dlg = flow(page, "group-dialog");
	await dlg.locator('[data-ewc-flow="group-name"]').fill("Goblins");
	await dlg.locator('[data-ewc-flow="group-create"]').click();
	await expect(dlg).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);
};

test.describe("Encounter cockpit group view (?ew=2)", () => {
	test("Groups roster, headers, stacks, stack picker, find / sort, Party chip and the anchored group popover", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await expect(page.locator(".ewc-row")).toHaveCount(7);

		// D26 Party chip: first (key 1), selects and un-selects the two party members.
		const party = page.locator('.ewc-chip[data-ewc-chip="party"]');
		await expect(party).toContainText("Party");
		await expect(party.locator(".ewc-chip__n")).toHaveText("2");
		await expect(party.locator(".ewc-kbd")).toContainText("1");
		await party.click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(2);
		await expect(row(page, "tarn")).toHaveClass(/is-sel/);
		await party.click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);

		// D25 Group… is always in the rail head — with no ticks it groups the viewed creature — and there is only one.
		const groupBtn = flow(page, "group-open");
		await expect(groupBtn).toHaveCount(1);
		await expect(groupBtn).toBeEnabled();
		await expect(groupBtn).toHaveAttribute("title", /Group .+ or tick several creatures first/);
		await expect(groupBtn.locator(".ewc-kbd")).toContainText("G");

		// D24 the group menu is an anchored, non-modal popover: under its button, and the rail stays clickable.
		for (const id of GOBLINS) await row(page, id).locator(".ewc-row__chk input").check();
		await expect(flow(page, "group-bar")).toContainText("3 creatures selected");
		await expect(groupBtn).toHaveCount(1);
		await groupBtn.click();
		const dlg = flow(page, "group-dialog");
		await expect(dlg).toBeVisible();
		await expect(groupBtn).toHaveAttribute("aria-expanded", "true");
		expect(await dlg.evaluate(el => el.tagName !== "DIALOG" && el.getAttribute("role") === "dialog")).toBe(true);
		expect(await below(dlg, groupBtn), "popover sits just under the Group… button").toBe(true);
		await expect(dlg.locator('[data-ewc-flow="group-name"]')).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dlg).toBeHidden();
		await expect(groupBtn).toBeFocused();
		await expect(page.locator(".ewc-row.is-sel"), "Esc closed the popover only, the selection stays").toHaveCount(3);
		await groupBtn.click();
		await expect(dlg).toBeVisible();
		await row(page, "owlbear").locator(".ewc-row__chk input").click();
		await expect(dlg, "clicking the rail closes the popover and the click lands").toBeHidden();
		await expect(row(page, "owlbear")).toHaveClass(/is-sel/);
		await row(page, "owlbear").locator(".ewc-row__chk input").uncheck();
		await page.keyboard.press("Escape");
		await createGoblins(page);
		await expect(toasts(page)).toContainText("Goblins");

		// D20 Initiative | Groups toggle.
		const toGroups = page.locator('[data-ewc-rail-view="groups"]');
		const toInit = page.locator('[data-ewc-rail-view="init"]');
		await expect(toInit).toHaveAttribute("aria-pressed", "true");
		await expect(toInit.locator(".ewc-rail__n")).toHaveText("7");
		await toGroups.click();
		await expect(toGroups).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#ewc-rail-title")).toHaveText("Creatures by group");

		// D21 one header per group, Party and Ungrouped sections, rows in initiative order inside each.
		expect(await railSequence(page)).toEqual(["# Goblins", "gob-1", "gob-3", "gob-2", "# Party", "tarn", "brenna", "# Ungrouped", "mage", "owlbear"]);
		await expect(ghead(page, "Goblins").locator(".ewc-ghead__n")).toHaveText(" · 3");
		await expect(gact(page, "Party", "rename"), "only your own groups can be renamed").toHaveCount(0);
		await expect(ghead(page, "Ungrouped").locator("[data-ewc-ginit]")).toHaveCount(0);

		await gact(page, "Goblins", "select").click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(3);
		await expect(gact(page, "Goblins", "select")).toHaveText("Unselect");
		await gact(page, "Goblins", "select").click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);

		const init = page.locator('[data-ewc-ginit="Goblins"]');
		await init.fill("abc");
		await init.press("Enter");
		expect(await init.evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(false);
		await init.fill("15");
		await init.press("Enter");
		await expect(toasts(page)).toContainText("Goblins: initiative 15 for all 3");
		for (const id of GOBLINS) await expect(row(page, id).locator(".ewc-row__init")).toHaveText("15");
		await expect(page.locator('[data-ewc-ginit="Goblins"]')).toHaveValue("15");

		await gact(page, "Goblins", "roll").click();
		await expect(toasts(page)).toContainText("Goblins rolled");
		await expect.poll(async () => {
			const inits = await Promise.all(GOBLINS.map(id => initOf(page, id)));
			return new Set(inits).size === 1 && /\d/.test(inits[0]);
		}, {message: "Roll once gives the group one initiative"}).toBe(true);

		// Rename from the header opens the same popover, anchored under the header's Rename.
		const rename = gact(page, "Goblins", "rename");
		await rename.click();
		await expect(dlg).toBeVisible();
		expect(await below(dlg, rename), "rename popover sits under the header's Rename").toBe(true);
		await dlg.locator('[data-ewc-flow="group-name"]').fill("Cave goblins");
		await dlg.locator('[data-ewc-flow="group-name"]').press("Enter");
		await expect(dlg).toBeHidden();
		await expect(ghead(page, "Cave goblins")).toBeVisible();
		await expect(page.locator(".ewc-chip", {hasText: "Cave goblins"})).toBeVisible();

		// D27 find and sort.
		const find = page.locator('[data-ewc-fk="roster-find"]');
		await find.fill("owl");
		expect(await railSequence(page)).toEqual(["# Ungrouped", "owlbear"]);
		await find.fill("cave");
		expect(await railSequence(page), "a group-name match keeps the whole group").toEqual(["# Cave goblins", "gob-1", "gob-3", "gob-2"]);
		await expect(ghead(page, "Cave goblins").locator(".ewc-ghead__n")).toHaveText(" · 3");
		await find.fill("zzz");
		await expect(page.locator("[data-ewc-roster-empty]")).toContainText("zzz");
		await find.press("Escape");
		await expect(find).toHaveValue("");
		await expect(page.locator(".ewc-rail__list > li")).toHaveCount(10);
		const sort = page.locator('[data-ewc-fk="roster-sort"]');
		await sort.selectOption("hp");
		expect(await railSection(page, "Party"), "lowest HP first inside each group").toEqual(["# Party", "brenna", "tarn"]);
		await sort.selectOption("name");
		expect(await railSection(page, "Party")).toEqual(["# Party", "brenna", "tarn"]);
		await sort.selectOption("init");
		expect(await railSection(page, "Party")).toEqual(["# Party", "tarn", "brenna"]);

		// D22 Stack: one row in both views, summed HP, one mini bar per member.
		await gact(page, "Cave goblins", "stack").click();
		await expect(gact(page, "Cave goblins", "stack")).toHaveAttribute("aria-pressed", "true");
		await expect(stackRow(page, "Cave goblins")).toBeVisible();
		for (const id of GOBLINS) await expect(row(page, id)).toHaveCount(0);
		await toInit.click();
		const stack = stackRow(page, "Cave goblins");
		await expect(stack.locator(".ewc-row__name")).toHaveText("Cave goblins ×3");
		await expect(stack.locator(".ewc-row__hp")).toContainText("21");
		await expect(stack.locator(".ewc-mini")).toHaveCount(3);
		await expect(page.locator(".ewc-row")).toHaveCount(5);

		// D23 stack picker: Esc closes back to its button; one member; then all of them.
		await stack.hover();
		const qaDamage = stack.locator('[data-ewc-stackqa="damage"]');
		await qaDamage.click();
		const picker = stack.locator("[data-ewc-stackpick]");
		await expect(picker).toBeVisible();
		await expect(picker.locator(".ewc-pop__head")).toContainText("which Cave goblins?");
		await expect(picker.locator("[data-ewc-spick]")).toHaveCount(4);
		await expect(picker.locator('[data-ewc-spick="all"]')).toHaveText("All 3");
		await page.keyboard.press("Escape");
		await expect(picker).toHaveCount(0);
		await expect(qaDamage).toBeFocused();

		await qaDamage.click();
		await stack.locator('[data-ewc-spick="gob-2"]').click();
		await page.locator("#ewc-hp-amt").fill("3");
		await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
		await expect(stack.locator(".ewc-row__hp")).toContainText("18");
		await expect(stack.locator(".ewc-mini.is-hurt")).toHaveCount(1);
		await expect(stack.locator(".ewc-row__cls")).toContainText("viewing");

		await stack.hover();
		await qaDamage.click();
		await stack.locator('[data-ewc-spick="all"]').click();
		await expect(stack).toHaveClass(/is-sel/);
		await page.locator("#ewc-hp-amt").fill("1");
		await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
		await expect(stack.locator(".ewc-row__hp")).toContainText("15");
		await page.keyboard.press("Escape");

		// Expand and collapse.
		await stack.locator(".ewc-row__name").click();
		await expect(stack).toHaveCount(0);
		for (const id of GOBLINS) await expect(row(page, id)).toBeVisible();
		const collapse = page.locator('.ewc-ghead--stack[data-ewc-ghead="Cave goblins"] [data-ewc-gact="collapse"]');
		await expect(collapse).toBeFocused();
		await collapse.click();
		await expect(stackRow(page, "Cave goblins")).toBeVisible();
		await expect(stackRow(page, "Cave goblins").locator(".ewc-row__name")).toBeFocused();

		// The chosen view survives a reload.
		await toGroups.click();
		await openCockpit(page);
		await expect(page.locator('[data-ewc-rail-view="groups"]')).toHaveAttribute("aria-pressed", "true");
		await expect(stackRow(page, "Cave goblins")).toBeVisible();

		// G opens the popover anchored to Group…; Esc closes it and returns focus there.
		await blur(page);
		await page.keyboard.press("g");
		await expect(dlg).toBeVisible();
		expect(await below(dlg, groupBtn)).toBe(true);
		await page.keyboard.press("Escape");
		await expect(dlg).toBeHidden();
		await expect(groupBtn).toBeFocused();

		expect(errors).toEqual([]);
	});

	test("screenshots: day and night, wide and narrow", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await createGoblins(page);
		// Stacking a group whose turns are scattered explains why initiative order still shows one row each.
		await page.locator('[data-ewc-rail-view="groups"]').click();
		await gact(page, "Goblins", "stack").click();
		await expect(toasts(page)).toContainText("aren't together");
		await page.locator('[data-ewc-rail-view="init"]').click();
		await expect(stackRow(page, "Goblins")).toHaveCount(0);
		await page.locator('[data-ewc-rail-view="groups"]').click();
		await gact(page, "Goblins", "stack").click();
		await expect(gact(page, "Goblins", "stack")).toHaveAttribute("aria-pressed", "false");
		await page.locator('[data-ewc-ginit="Goblins"]').fill("10");
		await page.locator('[data-ewc-ginit="Goblins"]').press("Enter");
		await expect(toasts(page)).toContainText("initiative 10");
		for (const theme of ["day", "night"]) {
			for (const width of [1280, 900]) {
				await page.setViewportSize({width, height: 800});
				await openCockpit(page);
				if (theme === "night") await page.evaluate(() => document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard"));
				await page.locator('[data-ewc-rail-view="groups"]').click();
				await page.mouse.move(width - 20, 790);
				await page.screenshot({path: `${SHOT_DIR}/groups-roster-${theme}-${width}.png`});

				const stackBtn = gact(page, "Goblins", "stack");
				if (await stackBtn.getAttribute("aria-pressed") !== "true") await stackBtn.click();
				await expect(stackBtn).toHaveAttribute("aria-pressed", "true");
				await page.locator('[data-ewc-rail-view="init"]').click();
				const stack = stackRow(page, "Goblins");
				await stack.hover();
				await page.screenshot({path: `${SHOT_DIR}/groups-stack-${theme}-${width}.png`});
				await stack.locator('[data-ewc-stackqa="damage"]').click();
				await expect(stack.locator("[data-ewc-stackpick]"), "the picker flips up rather than being cut off by the rail").toBeInViewport({ratio: 0.98});
				await page.screenshot({path: `${SHOT_DIR}/groups-stackpick-${theme}-${width}.png`});
				await page.keyboard.press("Escape");
				await stack.locator(".ewc-row__name").click();
				await page.mouse.move(width - 20, 790);
				await page.screenshot({path: `${SHOT_DIR}/groups-expanded-${theme}-${width}.png`});
				await page.locator('[data-ewc-gact="collapse"]').click();

				await row(page, "mage").locator(".ewc-row__chk input").check();
				await row(page, "owlbear").locator(".ewc-row__chk input").check();
				await flow(page, "group-open").click();
				await page.screenshot({path: `${SHOT_DIR}/groups-popover-${theme}-${width}.png`});
				await page.keyboard.press("Escape");
				await page.keyboard.press("Escape");
			}
		}
		expect(errors).toEqual([]);
	});
});
