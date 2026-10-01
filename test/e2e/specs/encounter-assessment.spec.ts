import {expect, test} from "@playwright/test";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("award XP follows effective minion conversion, explicit zero XP, unknown ratings, and reload", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 3});
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 150 · 3/3 rated");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP 50");

	await encounter.openActions();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-type").selectOption("minion");
	await page.locator("#ew-bulk-preview").click();
	await page.getByRole("button", {name: "Apply to 1"}).click();
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 110 · 3/3 rated");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP 10 · custom");
	await page.locator("#ew-cr-assessment > summary").click();
	await expect(page.locator("#ew-cr-changes")).toContainText("Traits (Minion)");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 110 · 3/3 rated");

	await page.evaluate(async () => {
		const storage = (globalThis as typeof globalThis & {StorageUtil: {
			pGetForPage: (key: string, options: {page: string}) => Promise<{
				instances: {statblockOperations: unknown[]}[],
			}>,
			pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>,
		}}).StorageUtil;
		const options = {page: "encounterworkspace.html"};
		const state = await storage.pGetForPage("encounterWorkspaceState", options);
		state.instances[1].statblockOperations.push({id: "zero-xp", type: "patch", data: {patch: {set: {cr: {cr: "0", xp: 0}}}}});
		state.instances[2].statblockOperations.push({id: "unrated", type: "patch", data: {patch: {set: {cr: "Unknown"}}}});
		await storage.pSetForPage("encounterWorkspaceState", state, options);
	});
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 10 known · 2/3 rated");
	await page.locator("#ew-focus-picker").selectOption("two");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP 0 · custom");
	await page.locator("#ew-focus-picker").selectOption("creature-2");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP unknown");
	await page.locator("#ew-none").click();
	await expect(page.locator("#ew-xp-total")).toContainText("10 known · 2/3 rated");
});

test("2014 CR assessment requires DM assumptions, remains advisory, then explicit CR edit updates award XP", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await page.locator("#ew-cr-assessment > summary").click();
	await expect(page.locator("#ew-cr-baseline")).toContainText("CR 1/4 → 1/4; HP 7 → 7; AC 15 → 15");
	await expect(page.locator("#ew-cr-notes")).toContainText("Lair note: Bell");
	await expect(page.locator("#ew-cr-damage")).toBeEmpty();
	await expect(page.locator("#ew-cr-inference")).toContainText("Other actions and choices (including recharge");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable: enter three-round damage");
	await page.locator("#ew-cr-form button").click();
	await expect(page.locator("#ew-cr-result")).toContainText("Enter three-round damage");

	await page.locator("#ew-cr-hp").fill("71");
	await page.locator("#ew-cr-ac").fill("13");
	await page.locator("#ew-cr-damage").fill("27");
	await page.locator("#ew-cr-attack").fill("3");
	await page.locator("#ew-cr-form button").click();
	await expect(page.locator("#ew-cr-result")).toContainText("2014 table estimate: CR 1 (defensive 1, offensive 1; 9 average damage/round)");
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 100 · 2/2 rated");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP 50");
	await page.locator("#ew-cr-attack-type").selectOption("save");
	await page.locator("#ew-cr-attack").fill("13");
	await page.locator("#ew-cr-form button").click();
	await expect(page.locator("#ew-cr-result")).toContainText("2014 table estimate: CR 1");
	await page.locator("#ew-cr-damage").fill("999");
	await page.locator("#ew-cr-form button").click();
	await expect(page.locator("#ew-cr-result")).toContainText("whole number from 0 to 960");
	await page.locator("#ew-cr-damage").fill("27");
	await page.locator("#ew-focus-picker").selectOption("two");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	await expect(page.locator("#ew-cr-damage")).toBeEmpty();
	await page.locator("#ew-focus-picker").selectOption("one");

	await page.locator("#ew-focus-edit").click();
	await page.getByRole("tab", {name: "Quick Edit"}).click();
	await page.getByLabel("Challenge Rating").fill("1");
	await page.getByRole("button", {name: "Apply Quick Edit"}).click();
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 250 · 2/2 rated");
	await page.getByRole("button", {name: "Done"}).click();
	await expect(page.locator("#ew-cr-baseline")).toContainText("CR 1/4 → 1");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 250 · 2/2 rated");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	await expect(page.locator("#ew-cr-damage")).toBeEmpty();
});

test("edited effective attacks and HP automatically update the advisory CR without changing saved CR or XP", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		action: [{name: "Blade", entries: ["{@atk mw} {@hit +4} to hit, one target. {@h}5 ({@damage 1d6+2}) slashing damage."]}],
	}});
	await page.locator("#ew-cr-assessment > summary").click();
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 table estimate: CR 1/4");
	await expect(page.locator("#ew-cr-damage")).toHaveValue("15");
	await expect(page.locator("#ew-cr-attack")).toHaveValue("4");
	await encounter.addSavedStatblockPatch(0, "edited-attack", {
		"hp.average": 71,
		ac: [{ac: 13}],
		action: [{name: "Blade", entries: ["{@atk mw} {@hit +6} to hit, one target. {@h}5 ({@damage 2d8+3}) slashing damage."]}],
	}, true);
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.locator("#ew-cr-assessment > summary").click();
	await expect(page.locator("#ew-cr-baseline")).toContainText("CR 1/4 → 1/4; HP 7 → 71; AC 15 → 13");
	await expect(page.locator("#ew-cr-damage")).toHaveValue("36");
	await expect(page.locator("#ew-cr-attack")).toHaveValue("6");
	await expect(page.locator("#ew-cr-inference")).toContainText("3-round damage 36: 1 × Blade (12) each round");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 table estimate: CR 2");
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 100 · 2/2 rated");
	await expect(page.locator(".ew__statblock-xp")).toHaveText("Award XP 50");

	await page.locator("#ew-cr-damage").fill("90");
	await expect(page.locator("#ew-cr-result")).toContainText("Assumptions changed");
	await page.locator("#ew-cr-form button").click();
	await expect(page.locator("#ew-cr-result")).toContainText("DM-adjusted 2014 table estimate");
	await page.locator("#ew-focus-picker").selectOption("two");
	await expect(page.locator("#ew-cr-damage")).toHaveValue("15");
	await page.locator("#ew-focus-picker").selectOption("one");
	await expect(page.locator("#ew-cr-damage")).toHaveValue("36");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 table estimate: CR 2");

	await page.locator("#ew-focus-edit").click();
	await page.getByRole("tab", {name: "Quick Edit"}).click();
	await page.getByLabel("Hit Points").fill("136");
	await page.getByRole("button", {name: "Apply Quick Edit"}).click();
	await page.getByRole("button", {name: "Done"}).click();
	await expect(page.locator("#ew-cr-baseline")).toContainText("CR 1/4 → 1/4; HP 7 → 136");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 table estimate: CR 3");
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 100 · 2/2 rated");
});

test("missing effective inputs do not produce an automatic CR or reuse a stale focused creature's result", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		action: [{name: "Blade", entries: ["{@atk mw} {@hit +4} to hit. {@h}{@damage 1d6+2} slashing damage."]}],
	}});
	await encounter.addSavedStatblockPatch(1, "uncertain", {
		hp: {special: "varies"},
		ac: [{ac: 13}, {ac: 17, condition: "with shield"}],
		action: [{name: "Blast", entries: ["Each creature in the cone takes {@damage 8d6} fire damage."]}],
	}, true);
	await page.reload();
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.locator("#ew-cr-assessment > summary").click();
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 table estimate");
	await page.locator("#ew-focus-picker").selectOption("two");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	await expect(page.locator("#ew-cr-hp")).toBeEmpty();
	await expect(page.locator("#ew-cr-damage")).toBeEmpty();
	await expect(page.locator("#ew-cr-inference")).toContainText("DM input needed: effective HP, unconditional AC, three-round damage, attack bonus or save DC");
	await expect(page.locator("#ew-xp-total")).toHaveText("Award XP: 100 · 2/2 rated");
});

test("a delayed CR reference table cannot overwrite a newly focused creature's missing-input status", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed({monsterOverride: {
		action: [{name: "Blade", entries: ["{@atk mw} {@hit +4} to hit. {@h}{@damage 1d6+2} slashing damage."]}],
	}});
	await encounter.addSavedStatblockPatch(1, "unknown-attack", {
		action: [{name: "Blast", entries: ["Each creature in a cone takes {@damage 6d6} fire damage."]}],
	}, true);
	let release!: () => void;
	let requested!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { requested = resolve; });
	await page.route("**/data/msbcr.json", async route => {
		requested();
		await held;
		await route.continue();
	});
	await page.reload({waitUntil: "domcontentloaded"});
	await started;
	await page.locator("#ew-focus-picker").selectOption("two");
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	release();
	await page.waitForResponse(response => response.url().endsWith("/data/msbcr.json"));
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await expect(page.locator("#ew-cr-result")).toContainText("Automatic 2014 estimate unavailable");
	await expect(page.locator("#ew-cr-damage")).toBeEmpty();
});

test("guided assessment stays readable and keyboard-usable on mobile in day and night mode", async ({page}) => {
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await page.setViewportSize({width: 390, height: 844});
	for (const night of [false, true]) {
		await page.locator("html").evaluate((html, enabled) => {
			html.classList.toggle("ve-night-mode", enabled);
			html.classList.toggle("ve-night-mode--standard", enabled);
		}, night);
		await page.locator("#ew-cr-assessment > summary").click();
		const layout = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			width: document.documentElement.clientWidth,
			fields: [...document.querySelectorAll("#ew-cr-form input, #ew-cr-form select, #ew-cr-form button")]
				.map(element => ({width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height})),
		}));
		expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 2);
		expect(layout.fields.every(({width, height}) => width >= 44 && height >= 44)).toBe(true);
		await page.locator("#ew-cr-hp").focus();
		await expect(page.locator("#ew-cr-hp")).toBeFocused();
		await expect(page.locator("#ew-cr-baseline")).toBeVisible();
		await page.locator("#ew-cr-assessment > summary").click();
	}
});
