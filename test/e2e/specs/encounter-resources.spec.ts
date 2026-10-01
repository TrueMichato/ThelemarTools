import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("resources and concentration belong to each monster and survive reload without auto-spending", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const first = encounter.resourcePanel("one");
	const manager = encounter.resourceManager("one");
	await expect(manager).toHaveJSProperty("open", false);
	await expect(first).toBeVisible();
	await expect(first.getByText("Blade (recharge 5–6)")).toBeVisible();
	await expect(first.getByRole("button", {name: "Blade: mark spent"})).toBeVisible();
	await expect(manager.locator(".ew__resource-fields")).toBeHidden();
	await encounter.clickRenderedRoll(0, "recharge");
	await expect(first.getByRole("button", {name: "Blade: mark spent"})).toBeVisible();
	await first.getByRole("button", {name: "Blade: mark spent"}).click();
	await expect(first.getByRole("button", {name: "Blade: mark ready"})).toBeFocused();
	await expect(manager).toHaveJSProperty("open", false);

	await manager.locator(":scope > summary").click();
	const addSlots = manager.locator('details[data-resource-key="slots:add"]');
	await addSlots.locator("summary").click();
	await addSlots.getByLabel("Remaining").fill("2");
	await addSlots.getByLabel("Maximum").fill("3");
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(first.getByLabel("Level 1: 2 of 3 remaining")).toBeVisible();
	const slotPip = first.getByRole("button", {name: /Level 1, use 2 of 3:/});
	await slotPip.click();
	await expect(slotPip).toHaveAttribute("aria-label", /spent; restore one/);
	await expect(slotPip).toBeFocused();
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();
	await slotPip.click();
	await expect(first.getByLabel("Level 1: 2 of 3 remaining")).toBeVisible();
	await slotPip.click();
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();

	const addAbility = manager.locator('details[data-resource-key="ability:add"]');
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Shield charm");
	await addAbility.getByLabel("Remaining").fill("2");
	await addAbility.getByLabel("Maximum").fill("3");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	const abilityPip = first.getByRole("button", {name: /Shield charm, use 2 of 3:/});
	await abilityPip.click();
	await expect(abilityPip).toBeFocused();
	await expect(first.getByLabel("Shield charm: 1 of 3 remaining")).toBeVisible();
	await first.getByRole("button", {name: /start concentration/}).click();
	await expect(first.getByRole("button", {name: /end concentration/})).toBeFocused();
	await manager.getByLabel("Spell or effect (optional)").fill("Haste");
	await manager.getByRole("button", {name: "Save label"}).click();
	await manager.locator(":scope > summary").click();
	await expect(first.getByText("Concentrating: Haste")).toBeVisible();
	await page.locator(".ew__statblock [data-field=initiative]").fill("17");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-active-vitals")).toContainText("Concentrating: Haste");
	await expect(page.locator("#ew-active-vitals")).toContainText("L1 slots 1/3");

	await encounter.focus(1);
	const second = encounter.resourcePanel("two");
	await expect(second).not.toContainText("Shield charm");
	await expect(second).not.toContainText("Haste");
	await expect(second.getByRole("button", {name: "Blade: mark spent"})).toBeVisible();
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await encounter.focus(0);
	await expect(first.getByText("Concentrating: Haste")).toBeVisible();
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();
	await expect(first.getByLabel("Shield charm: 1 of 3 remaining")).toBeVisible();
	await expect(first.getByRole("button", {name: "Blade: mark ready"})).toBeVisible();
	await expect(first.getByRole("button", {name: /end concentration/})).toHaveAttribute("aria-pressed", "true");
	await manager.locator(":scope > summary").click();
	await expect(manager.getByLabel("Spell or effect (optional)")).toHaveValue("Haste");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"]')).toContainText("Concentrating");
	await abilityPip.click();
	await expect(abilityPip).toBeFocused();
	await expect(first.getByLabel("Shield charm: 2 of 3 remaining")).toBeVisible();
	await first.getByRole("button", {name: /end concentration/}).click();
	await expect(first.getByRole("button", {name: /start concentration/})).toHaveAttribute("aria-pressed", "false");
	await expect(manager).toHaveJSProperty("open", true);
});

test("failed resource saves leave the last good state and unsaved form values available for retry", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const panel = encounter.resourcePanel("one");
	const manager = encounter.resourceManager("one");
	await manager.locator(":scope > summary").click();
	const addSlots = manager.locator('details[data-resource-key="slots:add"]');
	await addSlots.locator("summary").click();
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(panel.getByLabel("Level 1: 1 of 1 remaining")).toBeVisible();

	const edit = manager.locator('details[data-resource-key="slots:1"]');
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
	await expect(panel.getByLabel("Level 1: 1 of 1 remaining")).toBeVisible();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {restoreEncounterSave?: () => void};
		globals.restoreEncounterSave?.();
	});
	await edit.getByRole("button", {name: "Save"}).click();
	await expect(panel.getByLabel("Level 1: 2 of 4 remaining")).toBeVisible();
	await expect(edit.getByRole("button", {name: "Save"})).toBeFocused();
	await expect(page.locator('.ew__roster-row[data-instance-id="one"]')).toContainText("L1 slots 2/4");
	await edit.getByRole("button", {name: "Stop tracking Level 1 spell slot"}).click();
	await expect(panel).not.toContainText("Level 1 spell slot");
	await expect(manager.locator(":scope > summary")).toBeFocused();

	const addAbility = manager.locator('details[data-resource-key="ability:add"]');
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Shield charm");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	const abilityEdit = manager.locator("details[data-resource-key^='ability:']").filter({has: page.locator("summary", {hasText: "Edit Shield charm"})});
	await abilityEdit.locator("summary").click();
	await abilityEdit.getByLabel("Ability name").fill("Shield amulet");
	await abilityEdit.getByLabel("Maximum").fill("3");
	await abilityEdit.getByRole("button", {name: "Save"}).click();
	await expect(panel.getByLabel("Shield amulet: 1 of 3 remaining")).toBeVisible();
	await panel.getByRole("button", {name: "Stop tracking Shield amulet"}).click();
	await expect(panel).not.toContainText("Shield amulet");
});

test("resource pips do not publish a failed save, and large pools use bounded controls", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const panel = encounter.resourcePanel("one");
	const manager = encounter.resourceManager("one");
	await manager.locator(":scope > summary").click();
	const addSlots = manager.locator('details[data-resource-key="slots:add"]');
	await addSlots.locator("summary").click();
	await addSlots.getByLabel("Remaining").fill("9999");
	await addSlots.getByLabel("Maximum").fill("9999");
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(panel.getByLabel("Level 1: 9999 of 9999 remaining")).toBeVisible();
	await expect(panel.locator(".ew__resource-pip")).toHaveCount(0);
	const spend = panel.getByRole("button", {name: "Spend one Level 1 use"});
	await expect(spend).toBeVisible();
	const addAbility = manager.locator('details[data-resource-key="ability:add"]');
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Burst");
	await addAbility.getByLabel("Remaining").fill("2");
	await addAbility.getByLabel("Maximum").fill("2");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	const pip = panel.getByRole("button", {name: /Burst, use 2 of 2:/});

	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<void>},
			restoreEncounterSave?: () => void,
		};
		const original = globals.StorageUtil.pSetForPage;
		globals.StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
		globals.restoreEncounterSave = () => { globals.StorageUtil.pSetForPage = original; };
	});
	await pip.click();
	await expect(page.locator("#ew-status[role=alert]")).toContainText("Storage full");
	await expect(pip).toHaveAttribute("aria-label", /available; spend one/);
	await expect(panel.getByLabel("Burst: 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Level 1: 9999 of 9999 remaining")).toBeVisible();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {restoreEncounterSave?: () => void};
		globals.restoreEncounterSave?.();
	});
	await pip.click();
	await expect(panel.getByLabel("Burst: 1 of 2 remaining")).toBeVisible();
	await expect(pip).toBeFocused();
	await pip.click();
	await expect(panel.getByLabel("Burst: 2 of 2 remaining")).toBeVisible();
	await spend.click();
	await expect(panel.getByLabel("Level 1: 9998 of 9999 remaining")).toBeVisible();
	await expect(spend).toBeFocused();
	await panel.getByRole("button", {name: "Restore one Level 1 use"}).click();
	await expect(panel.getByLabel("Level 1: 9999 of 9999 remaining")).toBeVisible();
});

test("inline controls follow explicit transformed defaults without reinitializing spent uses", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({
		monsterOverride: {
			spellcasting: [{
				name: "Spellcasting",
				spells: {
					"1": {slots: 4, spells: ["{@spell shield}"]},
					"3": {slots: 2, spells: ["{@spell fireball}"]},
				},
				daily: {"1": ["{@spell shield}"]},
			}],
			trait: [{name: "Ward (2/Day)", entries: ["The goblin wards an ally."]}],
			legendaryActions: 3,
		},
	});
	await encounter.addSavedStatblockPatch(0, "transform-slots", {"spellcasting.0.spells.1.slots": 2}, true);
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	const panel = encounter.resourcePanel("one");
	await expect(panel.getByLabel("Level 1: 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Level 3: 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Ward (2/Day): 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Legendary Actions: 3 of 3 remaining")).toBeVisible();
	await expect(panel.getByRole("heading", {name: "Traits"})).toBeVisible();
	await expect(panel.getByRole("heading", {name: "Legendary actions"})).toBeVisible();
	await expect(panel.locator(".ew__resource-row")).toHaveCount(5);
	await panel.getByRole("button", {name: /Level 1, use 2 of 2: available; spend one/}).click();
	await panel.getByRole("button", {name: /Ward \(2\/Day\), use 2 of 2: available; spend one/}).click();
	await expect(panel.getByLabel("Level 1: 1 of 2 remaining")).toBeVisible();
	await encounter.addSavedStatblockPatch(0, "transform-actions", {legendaryActions: 5});
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(panel.getByLabel("Level 1: 1 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Ward (2/Day): 1 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Legendary Actions: 3 of 3 remaining")).toBeVisible();
	await encounter.focus(1);
	await expect(encounter.resourcePanel("two").getByLabel("Level 1: 4 of 4 remaining")).toBeVisible();
});

test("focused resources stay readable and usable in mobile day and night views", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({
		count: 2,
		monsterOverride: {
			name: "Dragon",
			size: ["H"],
			type: "dragon",
			trait: Array.from({length: 16}, (_, index) => ({
				name: `Ward ${index + 1} (2/Day)`,
				entries: ["The dragon protects an ally."],
			})),
			legendaryActions: 3,
		},
	});
	await page.setViewportSize({width: 390, height: 844});
	for (const night of [false, true]) {
		await page.locator("html").evaluate((html, enabled) => {
			html.classList.toggle("ve-night-mode", enabled);
			html.classList.toggle("ve-night-mode--standard", enabled);
		}, night);
		const panel = encounter.resourcePanel("one");
		const manager = encounter.resourceManager("one");
		await expect(panel).toHaveCount(1);
		await expect(panel).toBeVisible();
		await expect(page.locator(".ew__roster-row")).toHaveCount(2);
		if (await manager.evaluate(element => (element as HTMLDetailsElement).open)) await manager.locator(":scope > summary").click();
		const closed = await page.evaluate(() => ({
			managerHeight: document.querySelector(".ew__resource-manager")!.getBoundingClientRect().height,
			statblockTop: document.querySelector(".ew__statblock")!.getBoundingClientRect().top,
			headingTop: document.querySelector(".ew__statblock-heading")!.getBoundingClientRect().top,
		}));
		expect(closed.managerHeight).toBeLessThanOrEqual(70);
		expect(closed.statblockTop).toBeLessThan(844);
		expect(closed.headingTop).toBeLessThan(844);
		await expect(panel.getByRole("heading", {name: "Combat resources"})).toBeVisible();
		await expect(panel.getByRole("button", {name: /start concentration/})).toBeVisible();
		await expect(panel.getByRole("button", {name: "Ward 1 (2/Day), use 1 of 2: available; spend one"})).toBeVisible();
		await expect(panel.locator(".ew__resource-more")).toHaveCount(1);
		await manager.locator(":scope > summary").click();
		const metrics = await panel.evaluate(element => ({
			scrollWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
			controls: [...element.querySelectorAll("button, select, summary, input")].filter(it => it.getClientRects().length)
				.map(it => ({width: it.getBoundingClientRect().width, height: it.getBoundingClientRect().height})),
		}));
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
		expect(metrics.controls.every(it => it.width >= 44 && it.height >= 44)).toBe(true);
		await panel.getByRole("button", {name: "Blade: mark spent"}).click();
		await expect(manager).toHaveJSProperty("open", true);
		await expect(panel.getByRole("button", {name: "Blade: mark ready"})).toBeVisible();
		await panel.getByRole("button", {name: "Blade: mark ready"}).click();
		await expect(panel.getByRole("button", {name: "Blade: mark spent"})).toBeVisible();
		const more = panel.locator(".ew__resource-more");
		await more.locator(":scope > summary").click();
		const wardPip = panel.getByRole("button", {name: /Ward 16 \(2\/Day\), use 2 of 2:/});
		await wardPip.click();
		await expect(more).toHaveJSProperty("open", true);
		await expect(wardPip).toBeFocused();
		await more.locator(":scope > summary").click();
	}
});
