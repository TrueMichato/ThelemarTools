import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("dragging a turn changes whole-number totals, preserves the active actor, and survives reload", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	for (const [index, total] of [20, 19, 18].entries()) {
		await encounter.focus(index);
		await page.locator(".ew__statblock [data-field=initiative]").fill(String(total));
		await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
		await expect(page.locator("#ew-status")).toContainText(`to ${total}`);
	}
	await encounter.openInitiative();
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-round-status")).toContainText("Round 1 · Goblin #1");
	await page.locator('.ew__turn[data-turn-id="creature-2"] .ew__turn-move')
		.dragTo(page.locator('.ew__turn[data-turn-id="two"]'), {targetPosition: {x: 8, y: 3}});
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(3);
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toHaveAttribute("data-turn-id", "one");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(1)).toHaveAttribute("data-turn-id", "creature-2");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(2)).toHaveAttribute("data-turn-id", "two");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(1)).toContainText("19");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(2)).toContainText("18");
	await expect(page.locator("#ew-move-report-list li")).toHaveText([
		"Goblin #3: 18 → 19",
		"Goblin #2: 19 → 18",
	]);
	await expect(page.locator("#ew-round-status")).toContainText("Round 1 · Goblin #1");
	await page.reload();
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(1)).toHaveAttribute("data-turn-id", "creature-2");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(2)).toContainText("18");
	await expect(page.locator("#ew-round-status")).toContainText("Round 1 · Goblin #1");
	await expect(page.locator("#ew-move-undo")).toBeDisabled();
	await encounter.openInitiative();
	await page.locator('.ew__turn[data-turn-id="two"] .ew__turn-edit').click();
	await page.locator('.ew__turn[data-turn-id="two"] .ew__turn-init').fill("17");
	await page.locator('.ew__turn[data-turn-id="two"] .ew__turn-init').press("Tab");
	await expect(page.locator("#ew-status")).toContainText("to 17");
	await expect(page.locator('.ew__roster-row[data-instance-id="two"] .ew__roster-meta')).toContainText("Init 17");
	await page.reload();
	await expect(page.locator("#ew-turn-order .ew__turn").last()).toContainText("17");
});

test("touch-sized Move controls place unrolled monsters, list every changed total, and guard one-step Undo", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	for (const [index, total] of [20, 19].entries()) {
		await encounter.focus(index);
		await page.locator(".ew__statblock [data-field=initiative]").fill(String(total));
		await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
		await expect(page.locator("#ew-status")).toContainText(`to ${total}`);
	}
	await page.setViewportSize({width: 390, height: 844});
	await encounter.openInitiative();
	await page.locator("#ew-turn-start").click();
	await page.locator("#ew-unrolled-order .ew__turn-move").click();
	await expect(page.locator("#ew-move-entry")).toHaveValue("creature-2");
	await page.locator("#ew-move-before").selectOption("two");
	await page.locator("#ew-move-apply").press("Enter");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(1)).toHaveAttribute("data-turn-id", "creature-2");
	await expect(page.locator("#ew-move-report-list li")).toHaveText([
		"Goblin #3: unrolled → 20",
		"Goblin #1: 20 → 21",
	]);
	await expect(page.locator("#ew-round-status")).toContainText("Round 1 · Goblin #1");
	await page.locator("#ew-roster-sort").selectOption("initiative");
	await expect(page.locator("#ew-turn-order .ew__turn").nth(1)).toHaveAttribute("data-turn-id", "creature-2");
	await page.locator("#ew-move-undo").click();
	await expect(page.locator("#ew-unrolled-order .ew__turn-move")).toHaveCount(1);
	await expect(page.locator("#ew-move-report-list li")).toHaveText([
		"Goblin #3: 20 → unrolled",
		"Goblin #1: 21 → 20",
	]);
	await expect(page.locator("#ew-move-undo")).toBeDisabled();
	await page.locator("#ew-move-entry").selectOption("creature-2");
	await page.locator("#ew-move-before").selectOption("two");
	await page.locator("#ew-move-apply").click();
	await expect(page.locator("#ew-move-undo")).toBeEnabled();
	await page.locator("#ew-turn-next").click();
	await expect(page.locator("#ew-round-status")).toContainText("Round 1 · Goblin #3");
	await expect(page.locator("#ew-move-undo")).toBeDisabled();
});

test("an unrolled monster can be dragged into an empty turn order", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await encounter.openInitiative();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(0);
	await page.locator("#ew-unrolled-order .ew__turn-move").first()
		.dragTo(page.locator("#ew-turn-order"), {targetPosition: {x: 30, y: 20}});
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(1);
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toContainText("0");
	await expect(page.locator("#ew-move-report-list li")).toHaveText("Goblin #1: unrolled → 0");
	await page.reload();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(1);
	await expect(page.locator("#ew-turn-order .ew__turn").first()).toContainText("0");
});

test("shared turns move as a single entry and retain individual totals for splitting", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	for (const [index, total] of [9, 20, 14].entries()) {
		await encounter.focus(index);
		await page.locator(".ew__statblock [data-field=initiative]").fill(String(total));
		await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
		await expect(page.locator("#ew-status")).toContainText(`to ${total}`);
	}
	await page.locator("#ew-none").click();
	await expect(page.locator("#ew-summary")).toContainText("0 of 3 selected");
	await page.locator('.ew__roster-row[data-instance-id="one"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("1 of 3 selected");
	await page.locator('.ew__roster-row[data-instance-id="two"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("2 of 3 selected");
	await page.locator("#ew-group-selected").click();
	await expect(page.locator("#ew-status")).toContainText("Created a persistent group");
	await page.locator(".ew__group-init").first().fill("16");
	await page.getByRole("button", {name: "Share turns"}).click();
	await page.getByRole("button", {name: /Share turn$/}).click();
	await encounter.openInitiative();
	await page.locator("#ew-turn-start").click();
	await page.locator("#ew-position > summary").click();
	await page.locator("#ew-move-entry").selectOption({index: 0});
	await expect(page.locator("#ew-move-entry option:checked")).toContainText("shared turn");
	await page.locator("#ew-move-before").selectOption("");
	await page.locator("#ew-move-apply").click();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(2);
	await expect(page.locator("#ew-turn-order .ew__turn").last()).toContainText("13");
	await expect(page.locator("#ew-move-report-list li")).toContainText("shared turn");
	await expect(page.locator("#ew-move-report-list li")).toContainText("16 → 13");
	await expect(page.locator("#ew-round-status")).toContainText("Round 1");
	await page.reload();
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await expect(page.locator("#ew-turn-order .ew__turn").last()).toContainText("13");
	await page.getByRole("button", {name: "Individual turns"}).click();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(3);
	await encounter.focus(0);
	await expect(page.locator(".ew__statblock [data-field=initiative]")).toHaveValue("9");
	await encounter.focus(1);
	await expect(page.locator(".ew__statblock [data-field=initiative]")).toHaveValue("20");
});

test("rolling six initiatives updates every roster row before advancing a turn", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 6});
	await encounter.openInitiative();
	await page.locator("#ew-all").click();
	await page.locator("#ew-init-roll").click();
	await expect(page.locator("#ew-status")).toContainText("6 initiatives saved");
	await expect(page.locator(".ew__roster-meta")).toHaveCount(6);
	for (const meta of await page.locator(".ew__roster-meta").all()) await expect(meta).not.toContainText("Init unrolled");
});

test("a full 1000-monster encounter can put an unrolled entry in turn order", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 1000});
	await encounter.openInitiative();
	await page.locator("#ew-position > summary").click();
	await expect(page.locator("#ew-move-entry option")).toHaveCount(1000);
	await page.locator("#ew-move-entry").selectOption("creature-999");
	const moveStartedAt = Date.now();
	await page.locator("#ew-move-apply").click();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(1);
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveAttribute("data-turn-id", "creature-999");
	await expect(page.locator("#ew-move-report-list li")).toContainText("Goblin #1000: unrolled → 0");
	expect(Date.now() - moveStartedAt).toBeLessThan(5000);
});
