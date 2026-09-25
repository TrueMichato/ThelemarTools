import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("edited grouped monsters keep independent combat state through rolls, turns, reload and one-time handoff", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await expect(page.locator(".ew__group-title")).toContainText("Goblin ×2");

	await encounter.openActions();
	await page.locator("#ew-all").click();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-name").fill("Tail Swipe");
	await page.locator("#ew-bulk-description").fill("The goblin lashes out with its tail.");
	await page.locator("#ew-bulk-preview").click();
	await expect(page.getByRole("button", {name: "Apply to 2"})).toBeVisible();
	await page.getByRole("button", {name: "Apply to 2"}).click();
	await expect(page.locator("#ew-status")).toContainText("Saved statblock edits for Goblin #1, Goblin #2");
	await expect(page.locator(".ew__group-title")).toContainText("Goblin ×2");
	await expect(page.locator(".ew__statblock")).toContainText("Tail Swipe");

	await encounter.focus(0);
	await page.locator(".ew__statblock [data-field=initiative]").fill("20");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator("#ew-none").click();
	await expect(page.locator("#ew-summary")).toContainText("0 of 2 selected");
	await page.locator('.ew__roster-row[data-instance-id="one"] input[type=checkbox]').check();
	await expect(page.locator("#ew-summary")).toContainText("1 of 2 selected");
	await page.locator("#ew-effects-summary").click();
	await page.locator("#ew-mod-name").fill("Fortune");
	await page.locator("#ew-mod-mode").selectOption("normal");
	await page.locator("#ew-mod-bonus").fill("+2");
	await page.locator("#ew-mod-add").click();
	await expect(page.locator("#ew-status")).toContainText('Applied "Fortune"');
	await encounter.clickRenderedRoll(0, "abilityCheck");
	await expect(encounter.rolledEntries.first()).toHaveAttribute("title", /Goblin #1.*Fortune.*1d20\s*\+\s*4/);

	await encounter.focus(1);
	await page.locator(".ew__statblock [data-field=initiative]").fill("9");
	await page.locator(".ew__statblock [data-field=initiative]").press("Tab");
	await page.locator(".ew__statblock [data-field=current]").fill("3");
	await page.locator(".ew__statblock [data-field=current]").press("Tab");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"] .ew__roster-meta')).toContainText("HP 7/7");
	await expect(page.locator('.ew__roster-row[data-instance-id="two"] .ew__roster-meta')).toContainText("HP 3/7");
	await page.locator("#ew-turn-start").click();
	await expect(page.locator("#ew-round-status")).toContainText("Round 1");
	await page.locator("#ew-roster-sort").selectOption("hp");
	await expect(page.locator(".ew__roster-row").first()).toHaveAttribute("data-instance-id", "two");
	await expect(page.locator("#ew-round-status")).toContainText("Goblin #1");

	await page.locator(".ew__group-init").fill("16");
	await page.getByRole("button", {name: "Share turns"}).click();
	await page.getByRole("button", {name: /Share turn$/}).click();
	await expect(page.locator("#ew-turn-order .ew__turn")).toHaveCount(1);
	await page.locator("#ew-turn-next").click();
	await expect(page.locator("#ew-round-status")).toContainText("Round 2");

	await page.reload();
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await expect(page.locator(".ew__group-title")).toContainText("Goblin ×2");
	await expect(page.locator(".ew__statblock")).toContainText("Tail Swipe");
	await expect(page.locator("#ew-round-status")).toContainText("Round 2");
	await expect(page.locator('.ew__roster-row[data-instance-id="one"] .ew__roster-meta')).toContainText("HP 7/7");
	await expect(page.locator('.ew__roster-row[data-instance-id="two"] .ew__roster-meta')).toContainText("HP 3/7");
	await page.locator("#ew-all").click();
	await expect(page.locator("#ew-summary")).toContainText("2 of 2 selected");
	if (!await page.locator("#ew-setup").evaluate(element => (element as HTMLDetailsElement).open)) {
		await page.locator("#ew-setup > summary").click();
	}
	await page.locator("#ew-handoff-queue").click();
	await expect(page.locator("#ew-handoff-status")).toContainText("Queued 2 monsters");

	const handoff = await page.evaluate(async () => {
		const {EncounterWorkspaceHandoffStore} = await import("/js/encounterworkspace/encounterworkspace-handoff.js");
		const store = new EncounterWorkspaceHandoffStore();
		const snapshot = await store.pRead();
		if (!snapshot) throw new Error("The one-time handoff was not persisted.");
		await store.pImport({expectedId: snapshot.id, pAppend: async () => ({ok: true})});
		const remaining = await store.pRead();
		let replayRejected = false;
		try {
			await store.pImport({expectedId: snapshot.id, pAppend: async () => ({ok: true})});
		} catch {
			replayRejected = true;
		}
		return {entries: snapshot.entries, remaining, replayRejected};
	});
	expect(handoff.entries).toHaveLength(2);
	expect(handoff.entries.map(it => it.initiative)).toEqual([16, 16]);
	expect(handoff.entries.map(it => it.hp.current)).toEqual([7, 3]);
	expect(handoff.entries.every(it => it.monster.legendary?.some(action => action.name === "Tail Swipe"))).toBe(true);
	expect(handoff.remaining).toBeNull();
	expect(handoff.replayRejected).toBe(true);
});
