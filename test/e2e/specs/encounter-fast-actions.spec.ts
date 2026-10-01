import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("shown members from two statblock groups receive only explicitly selected damage and saves", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 5, renameIndices: [2, 3]});
	await expect(page.locator(".ew__group-header")).toHaveCount(2);
	await page.locator("#ew-none").click();
	for (const name of ["Goblin #1", "Goblin #4"]) {
		await page.locator("#ew-roster-search").fill(name);
		await expect(page.locator(".ew__roster-row")).toHaveCount(1);
		await page.getByRole("button", {name: /Select 1 shown .* group members only/}).click();
		await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	}
	await page.locator("#ew-roster-search").fill("");
	await expect(page.locator("#ew-roster-search")).toHaveValue("");
	await expect(page.locator("#ew-roster-count")).toHaveText("5 of 5 shown");
	await page.locator('.ew__roster-row[data-instance-id="creature-4"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("3 of 5 selected as targets");
	await encounter.focus(1);
	await expect(page.locator("#ew-focus-status")).toContainText("Goblin #2");
	await expect(page.locator("#ew-summary")).not.toContainText("Goblin #2");

	await page.locator("#ew-fast-damage").click();
	await expect(page.locator("#ew-damage-expression")).toBeFocused();
	await page.locator("#ew-target-list > summary").click();
	await expect(page.locator("#ew-target-names")).toContainText("Goblin #1");
	await expect(page.locator("#ew-target-names")).toContainText("Hobgoblin (Goblin #4)");
	await expect(page.locator("#ew-target-names")).toContainText("Goblin #5");
	await page.locator("#ew-damage-expression").fill("3");
	await page.locator("#ew-damage-apply").click();
	await expect(page.locator("#ew-status")).toContainText("Applied 3 bludgeoning damage to 3 monsters");
	for (const [id, hp] of [["one", 4], ["two", 7], ["creature-2", 7], ["creature-3", 4], ["creature-4", 4]] as const) {
		await expect(page.locator(`.ew__roster-row[data-instance-id="${id}"] .ew__roster-meta`)).toContainText(`HP ${hp}/7`);
	}
	await expect(page.locator(".ew__statblock [data-field=current]")).toHaveValue("7");

	await page.evaluate(() => {
		const {Renderer} = globalThis as typeof globalThis & {Renderer: {dice: {pRoll2: (...args: unknown[]) => Promise<number | null>}}};
		let rolls = 0;
		Renderer.dice.pRoll2 = async () => ++rolls === 2 ? null : 12;
	});
	await page.locator("#ew-fast-save").click();
	await expect(page.locator("#ew-roll-type")).toHaveValue("save");
	await expect(page.locator("#ew-roll-key")).toBeFocused();
	await page.locator("#ew-roll-key").selectOption("dex");
	await page.locator("#ew-roll").click();
	await expect(page.locator("#ew-roll-summary")).toHaveText("2 completed · 1 failed");
	await expect(page.locator("#ew-result-table tbody tr")).toHaveCount(3);
	await expect(page.locator("#ew-result-table tbody tr.ew__result--failed")).toContainText("Goblin #4");
	await expect(page.locator("#ew-status")).toContainText("2 completed, 1 failed");

	await page.locator("#ew-roster-search").fill("Goblin #1");
	const group = page.locator(".ew__roster-group");
	await expect(group.locator(".ew__group-selection")).toContainText("2 of 3 targeted · 1 shown");
	await expect(group.locator(".ew__group-header input[type=checkbox]")).toHaveJSProperty("indeterminate", true);
	await group.getByRole("button", {name: /Clear 1 shown/}).click();
	await expect(page.locator("#ew-summary")).toContainText("2 of 5 selected");
	await expect(page.locator("#ew-summary")).toContainText("2 outside roster filter");
	await group.locator(".ew__group-header input[type=checkbox]").check();
	await expect(page.locator("#ew-summary")).toContainText("4 of 5 selected");
	await expect(group.locator(".ew__group-selection")).toContainText("3 of 3 targeted · 1 shown");
	await group.locator(".ew__group-header input[type=checkbox]").uncheck();
	await expect(page.locator("#ew-summary")).toContainText("1 of 5 selected");
	await page.locator("#ew-roster-search").fill("");
	await expect(page.locator('.ew__roster-row[data-instance-id="creature-3"] input[type=checkbox]')).toBeChecked();
	await expect(page.locator('.ew__roster-row[data-instance-id="two"] input[type=checkbox]')).not.toBeChecked();
	await page.locator("#ew-roster-search").fill("Goblin #1");
	await page.evaluate(() => {
		const {StorageUtil} = globalThis as typeof globalThis & {StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<unknown>}};
		StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
	});
	await page.getByRole("button", {name: /Select 1 shown .* group members only/}).click();
	await expect(page.locator("#ew-status")).toContainText("Target selection was not saved: Storage full");
	await expect(page.locator("#ew-summary")).toContainText("1 of 5 selected as targets");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"] input[type=checkbox]')).not.toBeChecked();
	await page.reload();
	await expect(page.locator('.ew__roster-row[data-instance-id="one"] input[type=checkbox]')).not.toBeChecked();
	await expect(page.locator('.ew__roster-row[data-instance-id="creature-3"] input[type=checkbox]')).toBeChecked();
});

test("focused move shortcut preserves active shared turns, tied totals and guarded Undo on failed saves", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	for (const [ix, total] of [20, 19, 18].entries()) {
		await encounter.focus(ix);
		await page.locator(".ew__statblock [data-field=initiative]").fill(String(total));
		await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
		await expect(page.locator("#ew-status")).toContainText(`to ${total}`);
	}
	await page.locator("#ew-none").click();
	await expect(page.locator("#ew-summary")).toContainText("No targets selected");
	await page.locator('.ew__roster-row[data-instance-id="one"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("1 of 3 selected as targets: Goblin #1");
	await page.locator('.ew__roster-row[data-instance-id="two"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("2 of 3 selected as targets");
	await page.locator("#ew-group-selected").click();
	await page.locator(".ew__group-init").first().fill("18");
	await page.getByRole("button", {name: "Share turns"}).click();
	await page.getByRole("button", {name: /Share turn$/}).click();
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-round-status")).toContainText("shared turn");
	await page.locator("#ew-none").click();
	await encounter.focus(1);
	await page.locator("#ew-fast-move").click();
	await expect(page.locator("#ew-move-entry option:checked")).toContainText("shared turn");
	await encounter.focus(2);
	await page.locator("#ew-fast-move").click();
	await expect(page.locator("#ew-initiative")).toHaveJSProperty("open", true);
	await expect(page.locator("#ew-position")).toHaveJSProperty("open", true);
	await expect(page.locator("#ew-move-entry option:checked")).toContainText("Goblin #3");
	await expect(page.locator("#ew-move-entry")).toBeFocused();
	await page.locator("#ew-move-entry").selectOption({index: 0});
	await expect(page.locator("#ew-move-entry option:checked")).toContainText("shared turn");
	await page.locator("#ew-move-before").selectOption("");
	await page.locator("#ew-move-apply").click();
	await expect(page.locator("#ew-turn-order .ew__turn").last()).toContainText("shared turn");
	await expect(page.locator("#ew-round-status")).toContainText("shared turn");
	await expect(page.locator("#ew-summary")).toContainText("No targets selected");
	await expect(page.locator("#ew-focus-status")).toContainText("Goblin #3");
	await expect(page.locator("#ew-move-undo")).toBeEnabled();
	await page.locator("#ew-move-undo").click();
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toContainText("shared turn");
	await expect(page.locator("#ew-turn-order .ew__turn")).toContainText(["shared turn", "Goblin #3"]);

	await page.evaluate(() => {
		const {StorageUtil} = globalThis as typeof globalThis & {StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<unknown>}};
		StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
	});
	await page.locator("#ew-move-entry").selectOption({index: 0});
	await page.locator("#ew-move-before").selectOption("");
	await page.locator("#ew-move-apply").click();
	await expect(page.locator("#ew-status")).toContainText("Initiative move was not saved: Storage full");
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toContainText("shared turn");
	await expect(page.locator("#ew-move-undo")).toBeDisabled();
	await page.reload();
	await expect(page.locator("#ew-round-status")).toContainText("shared turn");
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toContainText("shared turn");
	await page.getByRole("button", {name: "Individual turns"}).click();
	await encounter.focus(0);
	await expect(page.locator(".ew__statblock [data-field=initiative]")).toHaveValue("20");
	await encounter.focus(1);
	await expect(page.locator(".ew__statblock [data-field=initiative]")).toHaveValue("19");
});

test("collapsed fast actions keep the statblock in the first viewport in day and night", async ({page}) => {
	await new EncounterRollPage(page).seed({count: 6});
	for (const viewport of [{width: 1366, height: 768}, {width: 390, height: 844}]) {
		await page.setViewportSize(viewport);
		for (const night of [false, true]) {
			await page.locator("html").evaluate((html, enabled) => html.classList.toggle("ve-night-mode", enabled), night);
			await expect(page.locator("#ew-fast")).toBeHidden();
			const sizes = await page.evaluate(() => ({
				statblockTop: document.querySelector(".ew__statblock")!.getBoundingClientRect().top,
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				rosterOverflow: getComputedStyle(document.getElementById("ew-roster")!).overflowY,
			}));
			expect(sizes.statblockTop).toBeLessThan(viewport.height);
			expect(sizes.overflow).toBeLessThanOrEqual(2);
			expect(sizes.rosterOverflow).toBe("visible");
			if (viewport.width === 390) {
				for (const id of ["ew-fast-damage", "ew-fast-save", "ew-fast-move"]) {
					const box = await page.locator(`#${id}`).boundingBox();
					expect(box?.width).toBeGreaterThanOrEqual(44);
					expect(box?.height).toBeGreaterThanOrEqual(44);
				}
			}
		}
	}
});
