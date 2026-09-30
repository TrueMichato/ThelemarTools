import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("resources and concentration belong to each monster and survive reload without auto-spending", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const first = page.locator('.ew__statblock[data-instance-id="one"] .ew__resources');
	await expect(first).toContainText("Blade (recharge 5–6)");
	await expect(first).toContainText("Ready");
	await encounter.clickRenderedRoll(0, "recharge");
	await expect(first).toContainText("Ready");
	await first.getByRole("button", {name: "Blade: mark spent"}).click();
	await expect(first).toContainText("Spent");

	const addSlots = first.locator("details").filter({has: page.locator("summary", {hasText: "Add spell level"})});
	await addSlots.locator("summary").click();
	await addSlots.getByLabel("Remaining").fill("2");
	await addSlots.getByLabel("Maximum").fill("3");
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(first.getByLabel("Level 1 spell slot: 2 of 3 remaining")).toBeVisible();
	await first.getByRole("button", {name: "Spend one Level 1 spell slot use"}).click();
	await expect(first.getByLabel("Level 1 spell slot: 1 of 3 remaining")).toBeVisible();

	const addAbility = first.locator("details").filter({has: page.locator("summary", {hasText: "Add limited-use ability"})});
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Shield charm");
	await addAbility.getByLabel("Remaining").fill("2");
	await addAbility.getByLabel("Maximum").fill("2");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	await first.getByRole("button", {name: "Spend one Shield charm use"}).click();
	await expect(first.getByLabel("Shield charm: 1 of 2 remaining")).toBeVisible();
	await first.getByRole("button", {name: /start concentration/}).click();
	await first.getByLabel("Spell or effect (optional)").fill("Haste");
	await first.getByRole("button", {name: "Save label"}).click();

	await encounter.focus(1);
	const second = page.locator('.ew__statblock[data-instance-id="two"] .ew__resources');
	await expect(second).not.toContainText("Shield charm");
	await expect(second).not.toContainText("Haste");
	await expect(second).toContainText("Ready");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await encounter.focus(0);
	await expect(first.getByLabel("Level 1 spell slot: 1 of 3 remaining")).toBeVisible();
	await expect(first.getByLabel("Shield charm: 1 of 2 remaining")).toBeVisible();
	await expect(first).toContainText("Spent");
	await expect(first.getByRole("button", {name: /end concentration/})).toHaveAttribute("aria-pressed", "true");
	await expect(first.getByLabel("Spell or effect (optional)")).toHaveValue("Haste");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"]')).toContainText("Concentrating");
	await first.getByRole("button", {name: "Restore one Shield charm use"}).click();
	await expect(first.getByLabel("Shield charm: 2 of 2 remaining")).toBeVisible();
	await first.getByRole("button", {name: /end concentration/}).click();
	await expect(first.getByRole("button", {name: /start concentration/})).toHaveAttribute("aria-pressed", "false");
});

test("failed resource saves leave the last good state and unsaved form values available for retry", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const panel = page.locator('.ew__statblock[data-instance-id="one"] .ew__resources');
	const addSlots = panel.locator('details[data-resource-key="slots:add"]');
	await addSlots.locator("summary").click();
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(panel.getByLabel("Level 1 spell slot: 1 of 1 remaining")).toBeVisible();

	const edit = panel.locator('details[data-resource-key="slots:1"]');
	await edit.locator("summary").click();
	await edit.getByLabel("Remaining").fill("2");
	await edit.getByLabel("Maximum").fill("4");
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<void>},
			restoreEncounterSave?: () => void,
		};
		const original = globals.StorageUtil.pSetForPage;
		globals.StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
		globals.restoreEncounterSave = () => { globals.StorageUtil.pSetForPage = original; };
	});
	await edit.getByRole("button", {name: "Save"}).click();
	await expect(page.locator("#ew-status[role=alert]")).toContainText("Storage full");
	await expect(edit.getByLabel("Remaining")).toHaveValue("2");
	await expect(panel.getByLabel("Level 1 spell slot: 1 of 1 remaining")).toBeVisible();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {restoreEncounterSave?: () => void};
		globals.restoreEncounterSave?.();
	});
	await edit.getByRole("button", {name: "Save"}).click();
	await expect(panel.getByLabel("Level 1 spell slot: 2 of 4 remaining")).toBeVisible();
	await expect(edit.getByRole("button", {name: "Save"})).toBeFocused();
	await expect(page.locator('.ew__roster-row[data-instance-id="one"]')).toContainText("L1 slots 2/4");
	await edit.getByRole("button", {name: "Stop tracking Level 1 spell slot"}).click();
	await expect(panel).not.toContainText("Level 1 spell slot");
	await expect(panel.locator(".ew__resource-title")).toBeFocused();

	const addAbility = panel.locator('details[data-resource-key="ability:add"]');
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Shield charm");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	const abilityEdit = panel.locator("details[data-resource-key^='ability:']").filter({has: page.locator("summary", {hasText: "Edit Shield charm"})});
	await abilityEdit.locator("summary").click();
	await abilityEdit.getByLabel("Ability name").fill("Shield amulet");
	await abilityEdit.getByLabel("Maximum").fill("3");
	await abilityEdit.getByRole("button", {name: "Save"}).click();
	await expect(panel.getByLabel("Shield amulet: 1 of 3 remaining")).toBeVisible();
	await panel.getByRole("button", {name: "Stop tracking Shield amulet"}).click();
	await expect(panel).not.toContainText("Shield amulet");
});

test("focused resources stay readable and usable in mobile day and night views", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 20});
	await page.setViewportSize({width: 390, height: 844});
	for (const night of [false, true]) {
		await page.locator("html").evaluate((html, enabled) => {
			html.classList.toggle("ve-night-mode", enabled);
			html.classList.toggle("ve-night-mode--standard", enabled);
		}, night);
		const panel = page.locator(".ew__statblock .ew__resources");
		await expect(panel).toHaveCount(1);
		await expect(panel).toBeVisible();
		await expect(page.locator(".ew__roster-row")).toHaveCount(20);
		const metrics = await panel.evaluate(element => ({
			scrollWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
			controls: [...element.querySelectorAll("button, select, summary, input")].filter(it => it.getClientRects().length)
				.map(it => ({width: it.getBoundingClientRect().width, height: it.getBoundingClientRect().height})),
		}));
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
		expect(metrics.controls.every(it => it.width >= 44 && it.height >= 44)).toBe(true);
		await panel.getByRole("button", {name: "Blade: mark spent"}).click();
		await expect(panel).toContainText("Spent");
		await panel.getByRole("button", {name: "Blade: mark ready"}).click();
		await expect(panel).toContainText("Ready");
	}
});
