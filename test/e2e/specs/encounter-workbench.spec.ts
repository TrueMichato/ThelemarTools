import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("roster navigation and filters do not change the active turn or selected targets", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await encounter.focus(1);
	await expect(page.locator("#ew-focus-status")).toContainText("Goblin #2 · 2 of 2");
	await page.locator("#ew-focus-prev").click();
	await expect(page.locator("#ew-focus-status")).toContainText("Goblin #1 · 1 of 2");
	await page.locator("#ew-focus-next").click();
	await expect(page.locator(".ew__statblock-title")).toHaveText("Goblin #2");
	await page.locator(".ew__statblock [data-field=initiative]").fill("9");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await encounter.focus(0);
	await page.locator(".ew__statblock [data-field=initiative]").fill("20");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-round-status")).toContainText("Goblin #1");
	await page.locator("#ew-roster-sort").selectOption("initiative");
	await page.locator("#ew-roster-filter").selectOption("unrolled");
	await expect(page.locator("#ew-roster-count")).toHaveText("0 of 2 shown");
	await expect(page.locator("#ew-focus-status")).toContainText("outside roster filter");
	await page.locator("#ew-roster-filter").selectOption("all");
	await page.locator("#ew-roster-search").fill("no such monster");
	await expect(page.locator("#ew-roster")).toContainText("No monsters match");
	await expect(page.locator(".ew__statblock-title")).toHaveText("Goblin #1");
	await page.locator("#ew-roster-search").fill("");
	await page.locator("#ew-turn-next").click();
	await expect(page.locator("#ew-round-status")).toContainText("Goblin #2");
	await expect(page.locator(".ew__statblock-title")).toHaveText("Goblin #2");
	await expect(page.locator("#ew-summary")).toContainText("1 of 2 selected");
	await page.locator("#ew-focus-prev").click();
	await page.locator("#ew-focus-current").click();
	await expect(page.locator(".ew__statblock-title")).toHaveText("Goblin #2");
	const jumps = page.locator(".ew__roster-jump");
	await jumps.first().focus();
	await page.keyboard.press("ArrowDown");
	await expect(jumps.last()).toBeFocused();
});

test("a renamed effective monster is visible and sorted by its edited name without changing turn identity", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({renameSecond: "Acolyte"});
	await encounter.focus(0);
	await page.locator(".ew__statblock [data-field=initiative]").fill("20");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await encounter.focus(1);
	await page.locator(".ew__statblock [data-field=initiative]").fill("9");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-round-status")).toContainText("Goblin #1");
	const original = page.locator('.ew__roster-row[data-instance-id="one"]');
	const edited = page.locator('.ew__roster-row[data-instance-id="two"]');
	await expect(edited.locator(".ew__roster-name")).toHaveText("Acolyte (Goblin #2)");
	await expect(edited.getByRole("button", {name: "View statblock for Acolyte (Goblin #2)"})).toBeVisible();
	await page.locator("#ew-roster-sort").selectOption("name");
	await expect(page.locator(".ew__roster-row").first()).toHaveAttribute("data-instance-id", "two");
	await expect(original.locator(".ew__roster-name")).toHaveText("Goblin #1");
	await encounter.openActions();
	await expect(page.locator("#ew-turn-order .ew__turn")).toContainText(["Goblin #1", "Goblin #2"]);
	await page.locator("#ew-roster-search").fill("Acolyte");
	await expect(page.locator(".ew__roster-row")).toHaveCount(1);
	await expect(page.locator(".ew__roster-row")).toHaveAttribute("data-instance-id", "two");
	await page.locator("#ew-roster-search").fill("");
	await page.locator("#ew-turn-next").click();
	await expect(page.locator("#ew-round-status")).toContainText("Goblin #2");
});

test("bulk edit and notes/effects disclosures remain sibling actions and work independently", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await encounter.openActions();
	const bulk = page.locator("#ew-actions > .ew__operations > details.ew__bulk-edit");
	const effects = page.locator("#ew-actions > .ew__operations > details.ew__effect-tools");
	await expect(bulk).toHaveCount(1);
	await expect(effects).toHaveCount(1);
	await expect(bulk.locator(":scope > .ew__bulk-fields")).toHaveCount(1);
	await bulk.locator("summary").click();
	await expect(bulk).toHaveJSProperty("open", true);
	await expect(effects).toHaveJSProperty("open", false);
	await bulk.locator("#ew-bulk-name").fill("Tail Swipe");
	await bulk.locator("#ew-bulk-description").fill("The goblin attacks an adjacent creature.");
	await bulk.locator("#ew-bulk-preview").click();
	await expect(page.getByRole("button", {name: "Apply to 1"})).toBeVisible();
	await page.getByRole("button", {name: "Cancel"}).click();
	await expect(page.locator("#ew-status")).toContainText("cancelled");
	await effects.locator("summary").click();
	await expect(effects).toHaveJSProperty("open", true);
	await effects.locator("#ew-mod-name").fill("Clarity");
	await effects.locator("#ew-mod-add").click();
	await expect(page.locator("#ew-status")).toContainText('Applied "Clarity"');
	await expect(effects.locator("#ew-mod-remove")).toContainText("Clarity");
	await effects.locator("#ew-mod-remove").selectOption({label: "Roll effect: Clarity (1 selected)"});
	await effects.locator("#ew-mod-remove-selected").click();
	await expect(page.locator("#ew-status")).toContainText('Removed "Clarity"');
	await expect(page.locator(".ew__statblock")).toContainText("Lair reminder (text only): Bell");
});

test("all-cards mode constructs statblocks only when requested, in bounded batches of twelve", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 1000});
	await expect(page.locator("#ew-roster-count")).toHaveText("1000 of 1000 shown");
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
	await page.locator("#ew-view-mode").selectOption("all");
	await expect(page.locator(".ew__card")).toHaveCount(12);
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
	await expect(page.locator(".ew__statblock").first()).toContainText("Lair reminder (text only): Bell");
	await expect(page.locator(".ew__statblock-edit")).toHaveCount(1);
	await encounter.clickRenderedRoll(0, "hit");
	await expect(page.locator("#ew-status")).toContainText("Rally +3");
	await page.locator(".ew__card-details").nth(1).locator("summary").click();
	await expect(page.locator(".ew__statblock")).toHaveCount(2);
	await expect(page.locator(".ew__statblock").last().locator("[data-field=current]")).toHaveValue("7");
	await page.locator(".ew__card-details").first().locator("summary").click();
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
	await page.locator("#ew-cards-more").click();
	await expect(page.locator(".ew__card")).toHaveCount(24);
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
	await expect(page.locator("#ew-cards-more")).toContainText("24 of 1000");
	await page.locator(".ew__card-jump").nth(1).click();
	await expect(page.locator("#ew-view-mode")).toHaveValue("focused");
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
	await page.evaluate(async () => {
		const storage = (globalThis as typeof globalThis & {StorageUtil: {
			pGetForPage: (key: string, options: {page: string}) => Promise<{
				version: number,
				instances: {id: string, statblockOperations?: unknown[]}[],
				groups?: unknown,
				ungroupedIds?: string[],
				turn?: {round: number, activeId: string | null},
			} | null>,
			pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
		}}).StorageUtil;
		const options = {page: "encounterworkspace.html"};
		const state = await storage.pGetForPage("encounterWorkspaceState", options);
		if (!state) throw new Error("The seeded encounter was not saved.");
		state.version = 6;
		state.instances.forEach(instance => instance.statblockOperations = []);
		state.groups = [{id: "shared-thousand", memberIds: state.instances.map(it => it.id), sharedTurn: true, initiative: 20}];
		state.ungroupedIds = [];
		state.turn = {round: 1, activeId: "shared-thousand"};
		await storage.pSetForPage("encounterWorkspaceState", state, options);
	});
	await page.reload();
	await expect(page.locator("#ew-round-status")).toContainText("Round 1");
	await expect(page.locator("#ew-active-vitals")).toContainText("997 more group members in the roster");
	await expect(page.locator(".ew__statblock")).toHaveCount(1);
});

test("the live turn stays above setup actions and the focused statblock fits narrow day and night views", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	for (const width of [1280, 390]) {
		await page.setViewportSize({width, height: 844});
		for (const night of [false, true]) {
			await page.locator("body").evaluate((body, enabled) => body.classList.toggle("ve-night-mode", enabled), night);
			await expect(page.locator("#ew-turn-start")).toBeVisible();
			await expect(page.locator("#ew-focus-next")).toBeVisible();
			await expect(page.locator(".ew__statblock")).toBeVisible();
			const dimensions = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				viewport: document.documentElement.clientWidth,
				liveTop: document.getElementById("ew-round-status")!.getBoundingClientRect().top,
				statblockTop: document.querySelector(".ew__statblock")!.getBoundingClientRect().top,
				searchBottom: document.getElementById("ew-roster-search")!.getBoundingClientRect().bottom,
				countTop: document.getElementById("ew-roster-count")!.getBoundingClientRect().top,
			}));
			expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
			expect(dimensions.liveTop).toBeLessThan(844);
			expect(dimensions.statblockTop).toBeLessThan(844);
			expect(dimensions.searchBottom).toBeLessThan(dimensions.countTop);
		}
	}
});
