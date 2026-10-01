import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("resources and concentration belong to each monster and survive reload without auto-spending", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const first = encounter.resourcePanel("one");
	const block = encounter.statblock("one");
	const manager = encounter.resourceManager("one");
	await expect(manager).toHaveJSProperty("open", false);
	await expect(first).toBeVisible();
	const recharge = encounter.inlineResource("one", "recharge:auto:recharge:action:0");
	await expect(recharge).toHaveAttribute("aria-pressed", "true");
	await expect(recharge).toHaveAttribute("aria-label", "Blade: mark spent");
	await expect(first).not.toContainText("Blade");
	await expect(manager.locator(".ew__resource-fields")).toBeHidden();
	await encounter.clickRenderedRoll(0, "recharge");
	await expect(recharge).toHaveAttribute("aria-pressed", "true");
	const rollsBefore = await encounter.rolledEntries.count();
	await recharge.click();
	await expect(encounter.rolledEntries).toHaveCount(rollsBefore);
	await expect(recharge).toHaveAttribute("aria-label", "Blade: mark ready");
	await expect(recharge).toBeFocused();
	await expect(manager).toHaveJSProperty("open", false);

	await manager.locator(":scope > summary").click();
	const addSlots = manager.locator('details[data-resource-key="slots:add"]');
	await addSlots.locator("summary").click();
	await addSlots.getByLabel("Remaining").fill("2");
	await addSlots.getByLabel("Maximum").fill("3");
	await addSlots.getByRole("button", {name: "Add level"}).click();
	await expect(first.getByLabel("Level 1: 2 of 3 remaining")).toBeVisible();
	const spendSlot = first.getByRole("button", {name: "Spend one Level 1 use"});
	const restoreSlot = first.getByRole("button", {name: "Restore one Level 1 use"});
	await spendSlot.click();
	await expect(spendSlot).toBeFocused();
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();
	await restoreSlot.click();
	await expect(first.getByLabel("Level 1: 2 of 3 remaining")).toBeVisible();
	await spendSlot.click();
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();

	const addAbility = manager.locator('details[data-resource-key="ability:add"]');
	await addAbility.locator("summary").click();
	await addAbility.getByLabel("Ability name").fill("Shield charm");
	await addAbility.getByLabel("Remaining").fill("2");
	await addAbility.getByLabel("Maximum").fill("3");
	await addAbility.getByRole("button", {name: "Add ability"}).click();
	const spendAbility = first.getByRole("button", {name: "Spend one Shield charm use"});
	await spendAbility.click();
	await expect(spendAbility).toBeFocused();
	await expect(first.getByLabel("Shield charm: 1 of 3 remaining")).toBeVisible();
	await block.getByRole("button", {name: /start concentration/}).click();
	await expect(block.getByRole("button", {name: /end concentration/})).toBeFocused();
	await manager.getByLabel("Spell or effect (optional)").fill("Haste");
	await manager.getByRole("button", {name: "Save label"}).click();
	await manager.locator(":scope > summary").click();
	await expect(block.getByRole("button", {name: /end concentration/})).toContainText("Concentrating: Haste");
	await page.locator(".ew__statblock [data-field=initiative]").fill("17");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator("#ew-turn-start").click();
	await page.getByRole("button", {name: /Skip/}).click();
	await expect(page.locator("#ew-active-vitals")).toContainText("Concentrating: Haste");
	await expect(page.locator("#ew-active-vitals")).toContainText("L1 slots 1/3");

	await encounter.focus(1);
	const second = encounter.resourcePanel("two");
	await expect(second).not.toContainText("Shield charm");
	await expect(second).not.toContainText("Haste");
	await expect(encounter.inlineResource("two", "recharge:auto:recharge:action:0")).toHaveAttribute("aria-label", "Blade: mark spent");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await encounter.focus(0);
	await expect(block.getByRole("button", {name: /end concentration/})).toContainText("Concentrating: Haste");
	await expect(first.getByLabel("Level 1: 1 of 3 remaining")).toBeVisible();
	await expect(first.getByLabel("Shield charm: 1 of 3 remaining")).toBeVisible();
	await expect(recharge).toHaveAttribute("aria-label", "Blade: mark ready");
	await expect(block.getByRole("button", {name: /end concentration/})).toHaveAttribute("aria-pressed", "true");
	await manager.locator(":scope > summary").click();
	await expect(manager.getByLabel("Spell or effect (optional)")).toHaveValue("Haste");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"]')).toContainText("Concentrating");
	await first.getByRole("button", {name: "Restore one Shield charm use"}).click();
	await expect(first.getByLabel("Shield charm: 2 of 3 remaining")).toBeVisible();
	await block.getByRole("button", {name: /end concentration/}).click();
	await expect(block.getByRole("button", {name: /start concentration/})).toHaveAttribute("aria-pressed", "false");
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
	const pip = panel.getByRole("button", {name: "Spend one Burst use"});

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
	await expect(panel.getByLabel("Burst: 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Burst: 2 of 2 remaining")).toBeVisible();
	await expect(panel.getByLabel("Level 1: 9999 of 9999 remaining")).toBeVisible();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {restoreEncounterSave?: () => void};
		globals.restoreEncounterSave?.();
	});
	await pip.click();
	await expect(panel.getByLabel("Burst: 1 of 2 remaining")).toBeVisible();
	await expect(pip).toBeFocused();
	await panel.getByRole("button", {name: "Restore one Burst use"}).click();
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
	const firstSlot = encounter.inlineResource("one", "slots:1");
	const thirdSlot = encounter.inlineResource("one", "slots:3");
	const ward = encounter.inlineResource("one", "ability:auto:ability:trait:0");
	await expect(firstSlot).toHaveAttribute("aria-label", "Level 1: 2 of 2 remaining");
	await expect(thirdSlot).toHaveAttribute("aria-label", "Level 3: 2 of 2 remaining");
	await expect(ward).toHaveAttribute("aria-label", "Ward (2/Day): 2 of 2 remaining");
	await expect(panel.getByLabel("Legendary Actions: 3 of 3 remaining")).toBeVisible();
	await expect(panel.getByRole("heading", {name: "Legendary actions"})).toBeVisible();
	await expect(panel.locator(".ew__resource-row")).toHaveCount(1);
	await firstSlot.getByRole("button", {name: "Spend one Level 1 use"}).click();
	await ward.getByRole("button", {name: "Spend one Ward (2/Day) use"}).click();
	await expect(firstSlot).toHaveAttribute("aria-label", "Level 1: 1 of 2 remaining");
	await encounter.addSavedStatblockPatch(0, "transform-actions", {legendaryActions: 5});
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(firstSlot).toHaveAttribute("aria-label", "Level 1: 1 of 2 remaining");
	await expect(ward).toHaveAttribute("aria-label", "Ward (2/Day): 1 of 2 remaining");
	await expect(panel.getByLabel("Legendary Actions: 3 of 3 remaining")).toBeVisible();
	await encounter.focus(1);
	await expect(encounter.inlineResource("two", "slots:1")).toHaveAttribute("aria-label", "Level 1: 4 of 4 remaining");
});

test("compact indicators wrap at headings, with separate accessible touch targets in day and night", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({
		monsterOverride: {
			spellcasting: [{name: "Spellcasting", spells: {"1": {slots: 2, spells: ["{@spell shield}"]}}}],
			trait: [{name: "Ward (2/Day)", entries: ["Ward an ally."]}],
			bonus: [{name: "Quick Ward (2/Day)", entries: ["Ward an ally."]}],
			action: [{name: "Pulse {@recharge 5}", entries: ["{@damage 1d6} damage."]}],
			legendary: [{name: "Surge (2/Day)", entries: ["Move 10 feet."]}],
			legendaryActions: 2,
		},
	});
	for (const width of [1200, 390]) {
		await page.setViewportSize({width, height: 900});
		for (const night of [false, true]) {
			await page.locator("html").evaluate((html, enabled) => {
				html.classList.toggle("ve-night-mode", enabled);
				html.classList.toggle("ve-night-mode--standard", enabled);
			}, night);
			for (const key of [
				"slots:1", "ability:auto:ability:trait:0", "ability:auto:ability:bonus:0",
				"ability:auto:ability:legendary:0", "ability:auto:legendary-actions",
			]) {
				const metrics = await encounter.inlineResource("one", key).evaluate(element => {
					const target = element.querySelector("button")!;
					const heading = element.closest(".ve-rd__h, .ve-rd__p-list-item, .ve-rd__li-spell > p, .ve-stats__sect-header-inner");
					const text = heading?.querySelector(".entry-title-inner, .ve-rd__list-item-name")
						|| heading?.firstChild;
					if (!heading || !text) return null;
					const range = document.createRange();
					range.selectNodeContents(text);
					const label = range.getClientRects()[0];
					const button = target.getBoundingClientRect();
					return {
						horizontal: button.left >= label.right - 2,
						centerOffset: Math.abs((button.top + button.bottom) / 2 - (label.top + label.bottom) / 2),
						targetWidth: button.width,
						targetHeight: button.height,
						insideDiceLink: !!target.closest("[data-packed-dice], a"),
						pipSizes: [...element.querySelectorAll(".ew__inline-resource-pip")].map(it => it.getBoundingClientRect().width),
						spend: !!element.querySelector('button[aria-label^="Spend one"]'),
						restore: !!element.querySelector('button[aria-label^="Restore one"]'),
					};
				});
				expect(metrics, `${key} at ${width}px, ${night ? "night" : "day"}`).not.toBeNull();
				expect(metrics!.horizontal).toBe(true);
				expect(metrics!.centerOffset).toBeLessThanOrEqual(12);
				expect(metrics!.targetWidth).toBeGreaterThanOrEqual(44);
				expect(metrics!.targetHeight).toBeGreaterThanOrEqual(44);
				expect(metrics!.insideDiceLink).toBe(false);
				expect(metrics!.pipSizes.length).toBeGreaterThan(0);
				expect(metrics!.pipSizes.every(size => size <= 10)).toBe(true);
				expect(metrics!.spend && metrics!.restore).toBe(true);
			}
			const recharge = encounter.inlineResource("one", "recharge:auto:recharge:action:0");
			await expect(recharge).toBeVisible();
			const rechargeMetrics = await recharge.evaluate(element => ({
				height: element.getBoundingClientRect().height,
			}));
			expect(rechargeMetrics.height).toBeLessThan(44);
			expect(rechargeMetrics.height).toBeGreaterThanOrEqual(30);
			const rolls = await encounter.rolledEntries.count();
			await recharge.hover();
			await expect(page.locator(".hwin")).toHaveCount(0);
			await recharge.click();
			await expect(encounter.rolledEntries).toHaveCount(rolls);
			await expect(recharge).toBeFocused();
		}
	}
});

test("duplicate and stale entry identities fall back to management, not a same-named statblock heading", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({
		monsterOverride: {
			trait: [
				{name: "Echo (2/Day)", entries: ["First echo."]},
				{name: "Echo (2/Day)", entries: ["Second echo."]},
			],
			bonus: [{name: "Echo (2/Day)", entries: ["Different bonus action."]}],
			action: [{name: "Blade", entries: ["Recharge {@recharge 5}."]}],
		},
	});
	const panel = encounter.resourcePanel("one");
	const manager = encounter.resourceManager("one");
	await expect(encounter.inlineResource("one", "ability:auto:ability:trait:0")).toHaveCount(0);
	await expect(encounter.inlineResource("one", "ability:auto:ability:trait:1")).toHaveCount(0);
	await expect(encounter.inlineResource("one", "ability:auto:ability:bonus:0")).toHaveCount(1);
	await expect(panel.locator(".ew__resource-row")).toHaveCount(2);
	await manager.locator(":scope > summary").click();
	const add = manager.locator('details[data-resource-key="ability:add"]');
	await add.locator("summary").click();
	await add.getByLabel("Ability name").fill("Echo (2/Day)");
	await add.getByRole("button", {name: "Add ability"}).click();
	await expect(panel.locator(".ew__resource-row")).toHaveCount(3);
	await panel.locator(".ew__resource-row").last().getByRole("button", {name: "Spend one Echo (2/Day) use"}).click();
	await expect(panel.getByLabel("Echo (2/Day): 0 of 1 remaining")).toBeVisible();
	await encounter.addSavedStatblockPatch(0, "rename-one", {"bonus.0.name": "Other Ward (2/Day)"});
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(encounter.inlineResource("one", "ability:auto:ability:bonus:0")).toHaveCount(0);
	await expect(encounter.resourcePanel("one").locator(".ew__resource-row")).toHaveCount(4);
	await expect(encounter.inlineResource("one", "recharge:auto:recharge:action:0")).toHaveCount(1);
	await encounter.focus(1);
	await expect(encounter.inlineResource("two", "ability:auto:ability:bonus:0")).toHaveCount(1);
});

test("large explicit pools use bounded inline controls and do not publish failed saves", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		trait: [{name: "Storm (20/Day)", entries: ["Call the storm."]}],
		bonus: [{name: "Surge (8/Day)", entries: ["Surge forward."]}],
	}});
	const pool = encounter.inlineResource("one", "ability:auto:ability:trait:0");
	await expect(pool).toHaveAttribute("aria-label", "Storm (20/Day): 20 of 20 remaining");
	await expect(pool.locator(".ew__inline-resource-pip")).toHaveCount(0);
	const surge = encounter.inlineResource("one", "ability:auto:ability:bonus:0");
	await expect(surge.locator(".ew__inline-resource-pip")).toHaveCount(8);
	await expect(surge.getByRole("button", {name: "Spend one Surge (8/Day) use"})).toBeVisible();
	const spend = pool.getByRole("button", {name: "Spend one Storm (20/Day) use"});
	await expect(pool.getByRole("button", {name: "Restore one Storm (20/Day) use"})).toBeDisabled();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<void>},
			restoreEncounterSave?: () => void,
		};
		const original = globals.StorageUtil.pSetForPage;
		globals.StorageUtil.pSetForPage = async () => { throw new Error("Storage full"); };
		globals.restoreEncounterSave = () => { globals.StorageUtil.pSetForPage = original; };
	});
	await spend.click();
	await expect(page.locator("#ew-status[role=alert]")).toContainText("Storage full");
	await expect(pool).toHaveAttribute("aria-label", "Storm (20/Day): 20 of 20 remaining");
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {restoreEncounterSave?: () => void};
		globals.restoreEncounterSave?.();
	});
	await spend.click();
	await expect(spend).toBeFocused();
	await expect(pool).toHaveAttribute("aria-label", "Storm (20/Day): 19 of 20 remaining");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(pool).toHaveAttribute("aria-label", "Storm (20/Day): 19 of 20 remaining");
});

test("pending resource saves disable only resource controls and restore their intended state on success and failure", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		trait: [{name: "Ward (2/Day)", entries: ["Ward an ally."]}],
		bonus: [{name: "Surge (8/Day)", entries: ["Surge forward."]}],
		spellcasting: [{name: "Spellcasting", spells: {"1": {slots: 2, spells: ["{@spell shield}"]}}}],
	}});
	const ward = encounter.inlineResource("one", "ability:auto:ability:trait:0");
	const slot = encounter.inlineResource("one", "slots:1");
	const surge = encounter.inlineResource("one", "ability:auto:ability:bonus:0");
	const recharge = encounter.inlineResource("one", "recharge:auto:recharge:action:0");
	const concentration = encounter.statblock("one").getByRole("button", {name: /start concentration/});
	const restoreSurge = surge.getByRole("button", {name: "Restore one Surge (8/Day) use"});
	await expect(restoreSurge).toBeDisabled();
	await page.evaluate(() => {
		const globals = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (...args: unknown[]) => Promise<void>},
			releaseEncounterSave?: (fail?: boolean) => void,
		};
		const original = globals.StorageUtil.pSetForPage;
		globals.StorageUtil.pSetForPage = (...args) => new Promise<void>((resolve, reject) => {
			globals.releaseEncounterSave = (fail = false) => {
				if (fail) reject(new Error("Storage full"));
				else original.apply(globals.StorageUtil, args).then(resolve, reject);
			};
		});
	});
	await ward.getByRole("button", {name: "Spend one Ward (2/Day) use"}).click();
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "true");
	await expect(ward.locator("button").first()).toBeDisabled();
	await expect(ward.locator("button").last()).toBeDisabled();
	await expect(slot.locator("button").first()).toBeDisabled();
	await expect(slot.locator("button").last()).toBeDisabled();
	await expect(surge.locator("button").first()).toBeDisabled();
	await expect(surge.locator("button").last()).toBeDisabled();
	await expect(recharge).toBeDisabled();
	await expect(concentration).toBeDisabled();
	await expect(encounter.statblock("one").locator("[data-packed-dice]").first()).toBeEnabled();
	await page.evaluate(() => (globalThis as typeof globalThis & {releaseEncounterSave: () => void}).releaseEncounterSave());
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await expect(page.locator("#ew-status")).toContainText("Saved combat resources");
	await expect(ward).toHaveAttribute("aria-label", "Ward (2/Day): 1 of 2 remaining");
	await expect(ward.locator("button").first()).toBeEnabled();
	await expect(ward.locator("button").last()).toBeEnabled();
	await expect(slot.locator("button").first()).toBeEnabled();
	await expect(slot.locator("button").last()).toBeDisabled();
	await expect(surge.getByRole("button", {name: "Spend one Surge (8/Day) use"})).toBeEnabled();
	await expect(restoreSurge).toBeDisabled();
	await expect(recharge).toBeEnabled();
	await expect(concentration).toBeEnabled();

	await concentration.click();
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "true");
	await expect(concentration).toBeDisabled();
	await expect(restoreSurge).toBeDisabled();
	await page.evaluate(() => (globalThis as typeof globalThis & {releaseEncounterSave: (fail: boolean) => void}).releaseEncounterSave(true));
	await expect(page.locator("#ew-status[role=alert]")).toContainText("Storage full");
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await expect(concentration).toBeEnabled();
	await expect(concentration).toHaveAttribute("aria-pressed", "false");
	await expect(restoreSurge).toBeDisabled();
	await expect(recharge).toBeEnabled();
});

test("a thousand collapsed cards do not render inline resources until opened", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 1000, monsterOverride: {trait: [{name: "Ward (2/Day)", entries: ["Ward an ally."]}]}});
	await page.locator("#ew-view-mode").selectOption("all");
	await expect(page.locator(".ew__card-details")).toHaveCount(12);
	await expect(page.locator("#ew-cards-more")).toContainText("12 of 1000");
	await expect(page.locator(".ew__inline-resource")).toHaveCount(1);
	await page.locator(".ew__card-details").nth(1).locator(":scope > summary").click();
	await expect(page.locator(".ew__inline-resource")).toHaveCount(2);
	await page.locator(".ew__card-details").nth(1).locator(":scope > summary").click();
	await expect(page.locator(".ew__inline-resource")).toHaveCount(1);
	await page.locator(".ew__card-details").first().locator(":scope > summary").click();
	await expect(page.locator(".ew__inline-resource")).toHaveCount(0);
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
		const block = encounter.statblock("one");
		const manager = encounter.resourceManager("one");
		await expect(panel).toHaveCount(1);
		await expect(panel).toBeVisible();
		await expect(page.locator(".ew__roster-row")).toHaveCount(2);
		if (await manager.evaluate(element => (element as HTMLDetailsElement).open)) await manager.locator(":scope > summary").click();
		const closed = await page.evaluate(() => ({
			managerHeight: document.querySelector(".ew__resource-manager")!.getBoundingClientRect().height,
			statblockTop: document.querySelector(".ew__statblock")!.getBoundingClientRect().top,
			headingTop: document.querySelector(".ew__statblock-heading")!.getBoundingClientRect().top,
			panelTop: document.querySelector(".ew__resources")!.getBoundingClientRect().top,
			tableBottom: document.querySelector(".ew__statblock .ve-stats")!.getBoundingClientRect().bottom,
		}));
		expect(closed.managerHeight).toBeLessThanOrEqual(70);
		expect(closed.statblockTop).toBeLessThan(844);
		expect(closed.headingTop).toBeLessThan(844);
		expect(closed.panelTop).toBeGreaterThanOrEqual(closed.tableBottom);
		await expect(block.getByRole("button", {name: /start concentration/})).toBeVisible();
		await expect(encounter.inlineResource("one", "ability:auto:ability:trait:0")
			.getByRole("button", {name: "Spend one Ward 1 (2/Day) use"})).toBeVisible();
		await expect(panel.locator(".ew__resource-more")).toHaveCount(0);
		await manager.locator(":scope > summary").click();
		const metrics = await panel.evaluate(element => ({
			scrollWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
			controls: [...element.querySelectorAll("button, select, summary, input")].filter(it => it.getClientRects().length)
				.map(it => ({width: it.getBoundingClientRect().width, height: it.getBoundingClientRect().height})),
		}));
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
		expect(metrics.controls.every(it => it.width >= 44 && it.height >= 44)).toBe(true);
		await encounter.inlineResource("one", "recharge:auto:recharge:action:0").click();
		await expect(manager).toHaveJSProperty("open", true);
		await expect(encounter.inlineResource("one", "recharge:auto:recharge:action:0")).toHaveAttribute("aria-label", "Blade: mark ready");
		await encounter.inlineResource("one", "recharge:auto:recharge:action:0").click();
		await expect(encounter.inlineResource("one", "recharge:auto:recharge:action:0")).toHaveAttribute("aria-label", "Blade: mark spent");
		const wardPip = encounter.inlineResource("one", "ability:auto:ability:trait:15")
			.getByRole("button", {name: "Spend one Ward 16 (2/Day) use"});
		const wardRestore = encounter.inlineResource("one", "ability:auto:ability:trait:15")
			.getByRole("button", {name: "Restore one Ward 16 (2/Day) use"});
		if (night) {
			await wardRestore.click();
			await expect(wardPip).toBeFocused();
		} else {
			await wardPip.click();
			await expect(wardPip).toBeFocused();
		}
		await expect(manager).toHaveJSProperty("open", true);
	}
});

test("recharge prompts only after saved turns, and the automatic setting survives reload and encounters", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {type: "dragon"}});
	const first = encounter.inlineResource("one", "recharge:auto:recharge:action:0");
	await first.click();
	await expect(first).toHaveAttribute("aria-pressed", "false");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(page.getByText("Roll spent recharge abilities?", {exact: true})).toHaveCount(0);
	await encounter.statblock("one").locator("[data-field=initiative]").fill("18");
	await encounter.statblock("one").locator("[data-field=initiative]").press("Tab");
	await page.locator("#ew-turn-start").click();
	await expect(page.getByText("Roll spent recharge abilities?", {exact: true})).toBeVisible();
	await expect(first).toBeDisabled();
	await page.getByRole("button", {name: /Skip/}).click();
	await expect(first).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("#ew-status")).toContainText("Recharge rolls skipped");
	await encounter.openInitiative();
	await page.locator("#ew-turn-reset").click();
	await expect(page.getByText("Roll spent recharge abilities?", {exact: true})).toHaveCount(0);

	await encounter.openInitiative();
	await page.locator(".ew__recharge-settings > summary").click();
	await page.getByLabel("Roll spent recharge abilities automatically at the start of their turn").check();
	await expect(page.locator("#ew-status")).toContainText("Automatic recharge rolls enabled");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(page.locator("#ew-auto-recharge")).toBeChecked();
	await page.locator("#ew-turn-start").click();
	await expect(page.getByText("Roll spent recharge abilities?", {exact: true})).toHaveCount(0);
	await expect(page.locator("#ew-status")).toContainText("recharge:");
	const outcome = await page.locator("#ew-status").textContent();
	expect(outcome).toMatch(/Blade: [1-6] (?:≥ 5; ready|< 5; still spent)/);
	await expect(first).toHaveAttribute("aria-pressed", outcome?.includes("; ready") ? "true" : "false");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(first).toHaveAttribute("aria-pressed", outcome?.includes("; ready") ? "true" : "false");
	await expect(page.locator("#ew-auto-recharge")).toBeChecked();
	await encounter.seed();
	await expect(page.locator("#ew-auto-recharge")).toBeChecked();
});

test("resource accents and spent symbols remain distinct on desktop and mobile in both themes", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		type: "undead",
		trait: [{name: "Ward (12/Day)", entries: ["Ward an ally."]}],
	}});
	const group = encounter.inlineResource("one", "ability:auto:ability:trait:0");
	await group.getByRole("button", {name: "Spend one Ward (12/Day) use"}).click();
	for (const width of [1200, 390]) {
		await page.setViewportSize({width, height: 844});
		for (const night of [false, true]) {
			await page.locator("html").evaluate((html, enabled) => html.classList.toggle("ve-night-mode", enabled), night);
			const metrics = await group.evaluate(element => {
				const pips = [...element.querySelectorAll(".ew__inline-resource-pip")];
				const available = getComputedStyle(pips[0]);
				const spent = getComputedStyle(pips.at(-1)!);
				const rows = new Set(pips.map(it => it.getBoundingClientRect().top));
				return {
					accent: getComputedStyle(element.closest(".ew__statblock")!).getPropertyValue("--ew-resource-accent").trim(),
					pipWidth: pips[0].getBoundingClientRect().width,
					availableFill: available.backgroundColor,
					spentSlash: spent.backgroundImage,
					rows: rows.size,
					scrollWidth: document.documentElement.scrollWidth,
					viewportWidth: document.documentElement.clientWidth,
				};
			});
			expect(metrics.accent).toBe(night ? "#d3aff5" : "#71499a");
			expect(metrics.pipWidth).toBeLessThanOrEqual(10);
			expect(metrics.availableFill).not.toBe("rgba(0, 0, 0, 0)");
			expect(metrics.spentSlash).toContain("linear-gradient");
			expect(metrics.rows).toBeGreaterThan(1);
			expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
		}
	}
});
