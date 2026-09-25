import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("rendered encounter rolls use each creature's saved effects independently of batch selection", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await expect(page.locator(".ew__statblock")).toHaveCount(2);
	await expect(page.locator(".ew__statblock").first()).toContainText("Rally");
	await encounter.clickRenderedRoll(0, "hit");
	await expect(page.locator("#ew-status")).toContainText("Rally +3");
	await expect(encounter.rolledEntries.first()).toHaveAttribute("title", /Goblin #1.*Rally.*2d20dl1\s*\+\s*7/);
	await expect(encounter.rolledEntries.first().locator(".roll")).toContainText(/\d+/);
	const firstTotal = Number(await encounter.rolledEntries.first().locator(".roll").textContent());
	await expect(page.locator("#ew-status")).toContainText(`— ${firstTotal}.`);
	const priorCount = await encounter.rolledEntries.count();
	await encounter.clickRenderedRoll(0, "damage");
	await expect(encounter.rolledEntries).toHaveCount(priorCount + 1);
	await expect(encounter.rolledEntries.filter({hasText: /1d6\s*\+\s*2/})).toHaveCount(1);
	await expect(encounter.rolledEntries.filter({hasText: /1d6\s*\+\s*2/})).not.toHaveAttribute("title", /Rally/);
	await encounter.clickRenderedRoll(0, "recharge");
	await expect(encounter.rolledEntries).toHaveCount(priorCount + 2);
	await expect(encounter.rolledEntries.filter({hasText: /Recharged!|Did not recharge/})).toHaveAttribute("title", /1d6/);
	await expect(encounter.rolledEntries.filter({hasText: /Recharged!|Did not recharge/})).not.toHaveAttribute("title", /Rally/);
	await encounter.clickRenderedRoll(0, "unclassified");
	await expect(page.locator("#ew-status")).toContainText("no recognized");
	await expect(encounter.rolledEntries).toHaveCount(priorCount + 3);
	await expect(encounter.rolledEntries.filter({hasText: /1d20\s*\+\s*4/})).toHaveCount(1);
	await encounter.clickRenderedRoll(1, "hit");
	await expect(encounter.rolledEntries).toHaveCount(priorCount + 4);
	await expect(encounter.rolledEntries.filter({hasText: /1d20\s*\+\s*4/})).toHaveCount(2);
	for (const title of await encounter.rolledEntries.filter({hasText: /1d20\s*\+\s*4/}).evaluateAll(elements => elements.map(it => it.getAttribute("title")))) {
		expect(title).not.toContain("Rally");
	}
	await page.locator("#ew-none").click();
	await expect(page.locator("#ew-summary")).toContainText("0 of 2 selected as targets");
	const countWithNoSelection = await encounter.rolledEntries.count();
	await encounter.clickRenderedRoll(0, "hit");
	await expect(encounter.rolledEntries).toHaveCount(countWithNoSelection + 1);
	await expect(encounter.rolledEntries.filter({hasText: /2d20dl1\s*\+\s*7/})).toHaveCount(2);
	await expect(page.locator("#ew-status")).toContainText("Rally +3");
});

test("a rendered ability check and batch initiative share saved check effects without changing area notes", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await page.locator("#ew-effects-summary").click();
	await page.locator("#ew-mod-name").fill("Fortune");
	await page.locator("#ew-mod-bonus").fill("+2");
	await page.locator("#ew-mod-add").click();
	await expect(page.locator("#ew-status")).toContainText('Applied "Fortune"');
	await encounter.clickRenderedRoll(0, "abilityCheck");
	await expect(encounter.rolledEntries.first()).toHaveAttribute("title", /Fortune.*2d20dl1\s*\+\s*4/);
	await page.locator("#ew-init-roll").click();
	await expect(encounter.rolledEntries.first()).toHaveAttribute("title", /Fortune.*2d20dl1\s*\+\s*4/);
	await expect(page.locator(".ew__statblock").first()).toContainText("Lair reminder (text only): Bell");
});

test("searchable cited presets ask for unknown attack context before changing the real roll", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await page.locator("#ew-effects-summary").click();
	await page.locator("#ew-preset-search").fill("IDRotF");
	await expect(page.locator("#ew-preset option")).toHaveCount(1);
	await expect(page.locator("#ew-preset-detail")).toContainText("IDRotF p. 10 (2014)");
	await page.locator("#ew-preset-add").click();
	await expect(page.locator("#ew-status")).toContainText("Blizzard");
	await encounter.clickRenderedRoll(0, "hit");
	await expect(page.getByRole("button", {name: "Yes, apply"})).toBeVisible();
	await page.getByRole("button", {name: "Yes, apply"}).click();
	await expect(encounter.rolledEntries.first()).toHaveAttribute("title", /Rally.*Blizzard.*IDRotF p. 10.*1d20\s*\+\s*7/);
	const count = await encounter.rolledEntries.count();
	await encounter.clickRenderedRoll(0, "hit");
	await page.getByRole("button", {name: "No, skip"}).click();
	await expect(encounter.rolledEntries).toHaveCount(count + 1);
	await expect(encounter.rolledEntries.last()).toHaveAttribute("title", /Rally.*2d20dl1\s*\+\s*7/);
	await expect(encounter.rolledEntries.last()).not.toHaveAttribute("title", /IDRotF/);
});
