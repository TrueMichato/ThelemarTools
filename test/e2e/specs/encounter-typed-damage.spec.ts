import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("typed damage resolves per-target defenses, consumes temporary HP, reports changes and shares HP undo", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	await page.evaluate(async () => {
		const storage = (globalThis as typeof globalThis & {StorageUtil: {
			pGetForPage: (key: string, options: {page: string}) => Promise<{
				instances: {monster: Record<string, unknown>, hp: {current: number, max: number, temp: number}}[],
				selectedIds: string[],
			}>,
			pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
		}}).StorageUtil;
		const options = {page: "encounterworkspace.html"};
		const state = await storage.pGetForPage("encounterWorkspaceState", options);
		state.instances[0].monster.resist = [{resist: ["fire"], note: "from nonmagical attacks", cond: true}];
		state.instances[0].hp.temp = 5;
		state.instances[1].monster.immune = ["fire"];
		state.instances[2].monster.vulnerable = ["fire"];
		state.selectedIds = ["one", "two", "creature-2"];
		await storage.pSetForPage("encounterWorkspaceState", state, options);
	});
	await page.reload();
	await expect(page.locator("#ew-summary")).toContainText("3 of 3 selected");
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("9");
	await page.locator("#ew-damage-type").selectOption("fire");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-damage-review")).toBeVisible();
	await expect(page.locator("#ew-damage-decisions select")).toHaveCount(1);
	await expect(page.locator("#ew-damage-decisions")).toContainText("Goblin #1 · resistance · from nonmagical attacks");
	await expect(page.locator("#ew-status")).toContainText("no damage has been saved");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"] .ew__roster-meta')).toContainText("HP 7/7");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("Choose Applies or Does not apply");
	await page.locator("#ew-damage-decisions select").selectOption("yes");
	await page.locator("#ew-damage-apply-reviewed").click();
	await expect(page.locator("#ew-damage-review")).toBeHidden();
	await expect(page.locator("#ew-status")).toContainText("Applied 9 fire damage to 3 monsters");
	await expect(page.locator("#ew-damage-report")).toContainText("Goblin #1: 4 applied (resistant); temp 5 → 1, HP 7 → 7");
	await expect(page.locator("#ew-damage-report")).toContainText("Goblin #2: 0 applied (immune)");
	await expect(page.locator("#ew-damage-report")).toContainText("Goblin #3: 18 applied (vulnerable)");
	await expect(page.locator('.ew__roster-row[data-instance-id="creature-2"] .ew__roster-meta')).toContainText("HP 0/7");
	await page.locator("#ew-hp-undo").click();
	await expect(page.locator("#ew-status")).toContainText("Undid the last HP operation");
	await expect(page.locator("#ew-damage-report")).toBeHidden();
	await expect(page.locator('.ew__roster-row[data-instance-id="creature-2"] .ew__roster-meta')).toContainText("HP 7/7");
	await expect(page.locator(".ew__statblock [data-field=temp]")).toHaveValue("5");

	await page.locator("#ew-damage-source").selectOption("magicalAttack");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-damage-review")).toBeHidden();
	await expect(page.locator("#ew-damage-report")).toContainText("Goblin #1: 9 applied; temp 5 → 0, HP 7 → 3");
	await page.reload();
	await expect(page.locator(".ew__statblock [data-field=current]")).toHaveValue("3");
});

test("visible statblock concentration remains active after typed damage and reports the correct check DC", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 1});
	const panel = encounter.resourcePanel("one");
	await panel.getByRole("button", {name: "Goblin #1: start concentration"}).click();
	const concentrating = panel.getByRole("button", {name: "Goblin #1: end concentration"});
	await expect(concentrating).toHaveAttribute("aria-pressed", "true");
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("26");
	await page.locator("#ew-damage-type").selectOption("fire");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-damage-report")).toContainText("Goblin #1: 26 applied; temp 0 → 0, HP 7 → 0; concentration check DC 13 (not rolled)");
	await expect(concentrating).toHaveAttribute("aria-pressed", "true");
	await page.reload();
	await expect(concentrating).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".ew__statblock [data-field=current]")).toHaveValue("0");
});

test("selection changes discard a pending review and storage failures leave typed damage unapplied", async ({page}) => {
	await new EncounterRollPage(page).seed({count: 2, monsterOverride: {
		resist: [{resist: ["fire"], note: "when standing in moonlight", cond: true}],
	}});
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("5");
	await page.locator("#ew-damage-type").selectOption("fire");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-damage-review")).toBeVisible();
	await page.locator('.ew__roster-row[data-instance-id="two"] input[type=checkbox]').check();
	await expect(page.locator("#ew-damage-review")).toBeHidden();
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-damage-decisions select")).toHaveCount(2);
	await page.locator("#ew-damage-decisions select").first().selectOption("no");
	await page.locator("#ew-damage-decisions select").last().selectOption("yes");
	await page.evaluate(() => {
		const {StorageUtil} = globalThis as typeof globalThis & {StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<void>}};
		StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
	});
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("Damage was not applied: Storage full");
	await expect(page.locator("#ew-damage-review")).toBeVisible();
	await expect(page.locator("#ew-hp-undo")).toBeDisabled();
	await page.reload();
	await expect(page.locator(".ew__statblock [data-field=current]")).toHaveValue("7");
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("=0");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("Enter a positive damage amount");
	await expect(page.locator(".ew__statblock [data-field=current]")).toHaveValue("7");
});

test("damage is not rolled when all selected targets have unset HP", async ({page}) => {
	await new EncounterRollPage(page).seed({count: 2});
	await page.evaluate(async () => {
		const storage = (globalThis as typeof globalThis & {StorageUtil: {
			pGetForPage: (key: string, options: {page: string}) => Promise<{
				instances: {hp: {current: number | null, max: number | null, temp: number}}[],
			}>,
			pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
		}}).StorageUtil;
		const options = {page: "encounterworkspace.html"};
		const state = await storage.pGetForPage("encounterWorkspaceState", options);
		state.instances[0].hp.current = null;
		state.instances[0].hp.max = null;
		await storage.pSetForPage("encounterWorkspaceState", state, options);
	});
	await page.reload();
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("3d6");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("No selected monsters have usable HP");
	await expect(page.locator("#ew-damage-report")).toBeHidden();
	await expect(page.locator("#ew-hp-undo")).toBeDisabled();
	await page.locator('.ew__roster-row[data-instance-id="two"] input[type=checkbox]').check();
	await page.locator("#ew-damage-expression").fill("5");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("skipped 1 with unset HP");
	await expect(page.locator("#ew-damage-report")).toContainText("1 skipped (unset HP)");
	await expect(page.locator('.ew__roster-row[data-instance-id="two"] .ew__roster-meta')).toContainText("HP 2/7");
});

test("open damage tools remain reachable without horizontal overflow on a narrow day/night screen", async ({page}) => {
	await new EncounterRollPage(page).seed({monsterOverride: {
		resist: [{resist: ["fire"], note: "while in moonlight", cond: true}],
	}});
	await page.setViewportSize({width: 390, height: 844});
	await page.locator("#ew-fast-damage").click();
	await page.locator("#ew-damage-expression").fill("2");
	await page.locator("#ew-damage-type").selectOption("fire");
	for (const night of [false, true]) {
		await page.locator("html").evaluate((html, enabled) => html.classList.toggle("ve-night-mode", enabled), night);
		await expect(page.locator("#ew-damage-expression")).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
		for (const id of ["ew-damage-expression", "ew-damage-type", "ew-damage-source", "ew-damage-apply"]) {
			const bounds = await page.locator(`#${id}`).boundingBox();
			expect(bounds?.height).toBeGreaterThanOrEqual(44);
		}
		await page.locator("#ew-damage-apply").click();
		const decision = page.locator("#ew-damage-decisions select").first();
		await decision.selectOption("yes");
		const applyReviewed = page.locator("#ew-damage-apply-reviewed");
		await expect(applyReviewed).toBeEnabled();
		const decisionBounds = await decision.boundingBox();
		const actionBounds = await applyReviewed.boundingBox();
		expect(actionBounds!.y - (decisionBounds!.y + decisionBounds!.height)).toBeLessThan(32);
		expect(actionBounds!.height).toBeGreaterThanOrEqual(44);
		await applyReviewed.click();
		await expect(page.locator("#ew-damage-review")).toBeHidden();
		await expect(page.locator("#ew-damage-report")).toContainText("Goblin #1: 1 applied (resistant)");
	}
});
