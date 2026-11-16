import {expect, test, type Page} from "@playwright/test";

/*
 * P3c flow features of the Lantern Cockpit (encounterworkspace.html?ew=2) on real Monster Manual data plus one party
 * member: timeline view (T), log drawer (L), groups (G), turn-order moves (Alt+↑ / drag), death-save pips,
 * concentration checks after damage, and End combat → summary → what's next. Fails on any console error.
 */

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async () => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const {getEncounterResourceDefaults} = await import("/js/encounterworkspace/encounterworkspace-resources.js");
		const {createEncounterPartyInstance} = await import("/js/encounterworkspace/encounterworkspace-party.js");
		const {getEncounterInstanceV8Defaults} = await import("/js/encounterworkspace/encounterworkspace-state.js");
		const pick = (name: string) => {
			const found = monsters.find((it: {name: string}) => it.name === name);
			if (!found) throw new Error(`MM has no ${name}`);
			return found;
		};
		const mk = (id: string, name: string, initiative: number) => {
			const monster = pick(name);
			const hash = `${monster.name.toLowerCase()}_mm`;
			return {
				id,
				hash,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
				initiative,
				resources: getEncounterResourceDefaults(monster),
				...getEncounterInstanceV8Defaults(hash),
			};
		};
		const mage = mk("mage", "Mage", 14);
		mage.resources.concentration = {active: true, label: "Greater Invisibility"};
		const brenna = createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, hpCurrent: 3, initiative: 16});
		const state = {
			version: 8,
			sourceList: {name: "Owlbear Ambush", saveId: "cockpit-flow"},
			instances: [mk("gob-1", "Goblin", 18), brenna, mage, mk("owlbear", "Owlbear", 12), mk("gob-2", "Goblin", 9)],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
			battlefield: [],
			groupMeta: {},
			// Already grouped once, so the goblins stay ungrouped and the test builds its own group.
			autoGrouped: true,
			log: [],
			savedEffects: [],
			combat: {status: "setup"},
		};
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(5);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const flow = (page: Page, id: string) => page.locator(`[data-ewc-flow="${id}"]`);
const order = (page: Page) => page.locator(".ewc-row").evaluateAll(rows => rows.map(it => (it as HTMLElement).dataset.ewcId));
const toasts = (page: Page) => page.locator(".ewc-toasts");
const blur = (page: Page) => page.locator("body").click({position: {x: 5, y: 5}});

const damage = async (page: Page, id: string, amount: number) => {
	await row(page, id).locator(".ewc-row__name").click();
	await page.locator("#ewc-hp-amt").fill(`${amount}`);
	await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
};

const trackConsoleErrors = (page: Page) => {
	const errors: string[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		if (msg.location().url.endsWith("/sw-injector.js") && /404|Failed to load resource/i.test(msg.text())) return;
		errors.push(msg.text());
	});
	page.on("pageerror", err => errors.push(`${err.name}: ${err.message}`));
	return errors;
};

test.describe("Encounter cockpit flow (?ew=2)", () => {
	test("timeline, log drawer, groups and turn-order moves", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		expect(await order(page)).toEqual(["gob-1", "brenna", "mage", "owlbear", "gob-2"]);

		// T: the timeline replaces the statblock; a lane click views that creature; T again returns.
		await blur(page);
		await page.keyboard.press("t");
		await expect(flow(page, "timeline-view")).toBeVisible();
		await expect(page.locator(".ewc-tl__lane")).toHaveCount(5);
		await expect(page.locator('.ewc-tl__lane[data-ewc-lane="mage"] .ewc-tl__conc')).toContainText("Greater Invisibility");
		await page.locator('.ewc-tl__lane[data-ewc-lane="owlbear"] .ewc-tl__label small').click();
		await expect(row(page, "owlbear")).toHaveClass(/is-viewed/);
		await expect(page.locator('.ewc-tl__lane[data-ewc-lane="owlbear"]')).toHaveClass(/is-viewed/);
		await flow(page, "timeline-back").click();
		await expect(flow(page, "timeline-view")).toBeHidden();
		await expect(page.locator(".ewc-vh__name")).toHaveText("Owlbear");
		await page.keyboard.press("t");
		await expect(flow(page, "timeline-view")).toBeVisible();
		await page.keyboard.press("t");
		await expect(flow(page, "timeline-view")).toBeHidden();

		// L: the log drawer opens and minimizes; turns are logged with a round separator; filters and Taller work.
		const log = flow(page, "log");
		await expect(log).toBeVisible();
		await expect(log).not.toHaveClass(/is-open/);
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");
		await page.keyboard.press("l");
		await expect(log).toHaveClass(/is-open/);
		await expect(log.locator(".ewc-log__round").first()).toContainText("Round 1");
		await expect(log.locator(".ewc-log__row.k-turn").first()).toContainText("Goblin");
		const turnChip = log.locator('[data-ewc-log-filter="turns"]');
		await turnChip.click();
		await expect(turnChip).toHaveAttribute("aria-pressed", "true");
		await expect(log.locator(".ewc-log__row:not(.k-turn):not(.k-note):not(.k-combat):not(.k-undo)")).toHaveCount(0);
		await turnChip.click();
		const listBox = await log.locator(".ewc-log__list").boundingBox();
		await flow(page, "log-tall").click();
		await expect.poll(async () => (await log.locator(".ewc-log__list").boundingBox())?.height ?? 0).toBeGreaterThan((listBox?.height ?? 0) + 20);
		await blur(page);
		await page.keyboard.press("l");
		await expect(log).not.toHaveClass(/is-open/);
		await expect(flow(page, "log-latest")).not.toBeEmpty();

		// G: group the two goblins, rename, set one initiative number for both, then ungroup.
		await row(page, "gob-1").locator(".ewc-row__chk input").check();
		await row(page, "gob-2").locator(".ewc-row__chk input").check();
		await expect(flow(page, "group-bar")).toContainText("2 creatures selected");
		await blur(page);
		await page.keyboard.press("g");
		const dlg = flow(page, "group-dialog");
		await expect(dlg).toBeVisible();
		await dlg.locator('[data-ewc-flow="group-name"]').fill("Goblin pack");
		await dlg.locator('[data-ewc-flow="group-create"]').click();
		await expect(dlg).toBeHidden();
		await expect(toasts(page)).toContainText("Goblin pack");
		await expect(page.locator(".ewc-chip", {hasText: "Goblin pack"})).toBeVisible();
		// The clear chip carries its shortcut.
		await expect(page.locator(".ewc-chip--clear .ewc-kbd")).toContainText("Esc");

		await flow(page, "group-open").click();
		await expect(dlg).toBeVisible();
		await dlg.locator('[data-ewc-flow="group-name"]').fill("Cave goblins");
		await dlg.locator('[data-ewc-flow="group-rename"]').click();
		await expect(page.locator(".ewc-chip", {hasText: "Cave goblins"})).toBeVisible();

		await flow(page, "group-open").click();
		await expect(dlg.locator(".ewc-grp__hint")).toContainText("drag");
		await dlg.locator('[data-ewc-flow="group-init"]').fill("15");
		await dlg.locator('[data-ewc-flow="group-setinit"]').click();
		await expect(dlg).toBeHidden();
		await expect(row(page, "gob-2").locator(".ewc-row__init")).toContainText("15");

		await flow(page, "group-open").click();
		await dlg.locator('[data-ewc-flow="group-ungroup"]').click();
		await expect(dlg).toBeHidden();
		await expect(page.locator(".ewc-chip", {hasText: "Cave goblins"})).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);

		// Alt+↑ moves the viewed creature one place earlier (position, not a typed number).
		await row(page, "owlbear").locator(".ewc-row__name").click();
		const before = await order(page);
		await blur(page);
		await page.keyboard.press("Alt+ArrowUp");
		await expect.poll(() => order(page)).not.toEqual(before);
		const after = await order(page);
		expect(after.indexOf("owlbear")).toBe(before.indexOf("owlbear") - 1);
		await expect(toasts(page)).toContainText("Owlbear");
		await expect(flow(page, "order-hint")).toContainText("drag");

		// Drag the last row's grip onto the first row: it moves to the top.
		const last = after[after.length - 1];
		const first = after[0];
		await row(page, last).hover();
		await row(page, last).locator('[data-ewc-flow="grip"]').dragTo(row(page, first), {targetPosition: {x: 40, y: 4}});
		await expect.poll(async () => (await order(page))[0]).toBe(last);

		expect(errors).toEqual([]);
	});

	test("death saves, concentration checks and end combat", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await blur(page);
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");

		// Brenna (3 HP) drops: the shell applies the dying rules, the row grows death-save pips.
		await damage(page, "brenna", 5);
		const ds = row(page, "brenna").locator('[data-ewc-flow="deathsaves"]');
		await expect(ds).toBeVisible();
		await ds.locator(".ewc-ds__pip.is-s").first().click();
		await expect(ds.locator(".ewc-ds__pip.is-s.is-on")).toHaveCount(1);
		await ds.locator(".ewc-ds__pip.is-f").first().click();
		await expect(ds.locator(".ewc-ds__pip.is-f.is-on")).toHaveCount(1);
		await ds.locator('[data-ewc-flow="ds-roll"]').click();
		await expect(toasts(page)).toContainText(/death save/i);
		const stab = row(page, "brenna").locator('[data-ewc-flow="ds-stable"]');
		if (await stab.count()) {
			await stab.click();
			await expect(row(page, "brenna").locator(".ewc-ds__tag")).toContainText(/stable|dead/i);
		}

		// Damage to the concentrating Mage surfaces the Con save with its DC; rolling resolves it.
		await damage(page, "mage", 4);
		const check = page.locator('.ewc-conc__item[data-ewc-conc="mage"]');
		await expect(check).toBeVisible();
		await expect(check).toContainText("DC 10");
		await expect(check).toContainText("Greater Invisibility");
		await check.locator('[data-ewc-flow="conc-roll"]').click();
		await expect(check).toHaveClass(/is-ok|is-bad/);
		const isKept = await check.evaluate(it => it.classList.contains("is-ok"));
		await check.locator('[data-ewc-flow="conc-ok"]').click();
		await expect(check).toBeHidden();
		if (isKept) {
			// A second hit, then drop it by hand.
			await damage(page, "mage", 2);
			await expect(check).toBeVisible();
			await check.locator('[data-ewc-flow="conc-drop"]').click();
			await expect(check).toBeHidden();
		}
		await expect(row(page, "mage").locator(".ewc-row__conc")).toHaveCount(0);

		// End combat: summary with XP, award, then a clear "what's next".
		await damage(page, "gob-1", 30);
		await flow(page, "end-open").click();
		const end = flow(page, "end-dialog");
		await expect(end).toBeVisible();
		await expect(end.locator(".ewc-end__tile").first()).toBeVisible();
		await end.locator('[data-ewc-flow="end-award"]').click();
		await expect(end.locator('[data-ewc-flow="end-next-choose"]')).toBeVisible();
		await expect(end.locator('[data-ewc-flow="end-next-dm"]')).toBeVisible();
		await expect(flow(page, "end-strip")).toBeVisible();
		// Shortcuts stay quiet while the dialog is open.
		await page.keyboard.press("l");
		await expect(flow(page, "log")).not.toHaveClass(/is-open/);
		await end.locator('[data-ewc-flow="end-next-choose"]').click();
		await expect(end).toBeHidden();
		await expect(toasts(page)).toContainText(/saved Bestiary lists|list/i);
		await blur(page);
		await page.keyboard.press("l");
		await expect(flow(page, "log")).toHaveClass(/is-open/);
		await expect(flow(page, "log").locator(".ewc-log__row.k-combat").last()).toContainText(/XP|ended/i);

		// The strip resumes the fight if the DM ended it by mistake.
		await flow(page, "end-strip").locator('[data-ewc-flow="end-resume"]').click();
		await expect(flow(page, "end-strip")).toBeHidden();
		await expect(flow(page, "end-open")).toBeVisible();

		expect(errors).toEqual([]);
	});
});
