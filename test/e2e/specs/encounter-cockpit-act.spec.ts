import {expect, test, type Page} from "@playwright/test";

/*
 * Lantern Cockpit "Act" features (encounterworkspace.html?ew=2) on real Monster Manual data:
 * the Roll tab + roll tray, the Fx tab (presets, cover, concentration, hand-typed durations), the custom
 * effect builder, the `/` command console and the rail's `›_` row entry point. Fails on any console error.
 */

const SHOT_DIR = process.env.EWC_ACT_SHOT_DIR || "test-results/encounter-cockpit-act";

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async () => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const mk = (id: string, name: string, initiative: number) => {
			const monster = monsters.find((it: {name: string}) => it.name === name);
			if (!monster) throw new Error(`MM has no ${name}`);
			return {
				id,
				hash: `${name.toLowerCase()}_mm`,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
				initiative,
			};
		};
		const state = {
			version: 4,
			sourceList: {name: "Crypt Ambush", saveId: "cockpit-act"},
			instances: [mk("gob-1", "Goblin", 18), mk("mage", "Mage", 14), mk("skel", "Skeleton", 12), mk("gob-2", "Goblin", 9)],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
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
	await expect(page.locator(".ewc-row")).toHaveCount(4);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const blur = (page: Page) => page.locator("body").click({position: {x: 5, y: 5}});

const selectThree = async (page: Page) => {
	for (const id of ["gob-1", "skel", "gob-2"]) await row(page, id).locator(".ewc-row__chk input").check();
	await expect(page.locator(".ewc-dock__target")).toContainText("Selected 3");
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

test.describe("Encounter cockpit Act features (?ew=2)", () => {
	test("roll tab, tray, fx, builder, console and row entry point on real data", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await page.setViewportSize({width: 1280, height: 800});
		await seed(page);
		await openCockpit(page);
		await selectThree(page);

		// Fx (E): Half cover is a premade +2 AC / +2 Dex saves preset.
		await blur(page);
		await page.keyboard.press("e");
		await expect(page.locator('.ewc-dock__tab[aria-selected="true"]')).toContainText("Fx");
		await page.locator('[data-ewc-fx="half-cover"]').click();
		await expect(page.locator(".ewc-fx__sum")).toContainText("DEX save +2");
		await page.locator("[data-ewc-fx-apply]").click();
		await expect(row(page, "gob-1").locator(".ewc-pill--fx")).toContainText("Half cover");
		await expect(page.locator('[data-ewc-fx-active="Half cover"]')).toBeVisible();

		// Roll (R): Dex save vs DC 30 with a damage + condition outcome; Shift-click rolls with advantage.
		await page.keyboard.press("r");
		await expect(page.locator('.ewc-dock__tab[aria-selected="true"]')).toContainText("Roll");
		await expect(page.locator(".ewc-act__wholist li")).toHaveCount(3);
		await expect(page.locator(".ewc-act__wholist")).toContainText("+4"); // Goblin +2 Dex, +2 Half cover
		await page.locator('[data-ewc-fk="roll-dc"]').fill("30");
		await page.locator("[data-ewc-roll-outcome]").click();
		await page.locator('[data-ewc-fk="roll-dmg"]').fill("1");
		await page.locator('[data-ewc-fk="roll-cond"]').selectOption("prone");
		await expect(page.locator(".ewc-act__modhint")).toContainText("adv");
		await page.locator("[data-ewc-roll-go]").click({modifiers: ["Shift"]});

		const tray = page.locator("[data-ewc-tray]");
		await expect(tray).toBeVisible();
		await expect(tray.locator(".ewc-tray__item")).toHaveCount(3);
		await expect(tray.locator(".ewc-tray__item.is-fail")).toHaveCount(3);
		await expect(tray.locator(".ewc-tray__die")).toHaveCount(6); // advantage: two dice each
		await expect(tray.locator(".ewc-tray__die.is-struck")).toHaveCount(3);
		await expect(tray).not.toContainText("null");
		await expect(tray.locator('[data-ewc-tray-row="gob-1"]')).toContainText("Goblin 1");

		// Expandable breakdown: the cover contributor is listed and hoverable.
		await tray.locator('[data-ewc-tray-row="gob-1"]').click();
		const coverLine = tray.locator(".ewc-tray__src", {hasText: "Half cover"});
		await expect(coverLine).toBeVisible();
		await coverLine.hover();
		await expect(page.locator(".ve-hwin").last()).toContainText(/Half cover/i);
		await page.mouse.move(640, 200);

		// Select failed re-targets the dock to every creature that failed.
		await page.locator("[data-ewc-fk=\"dock-clear\"]").click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);
		await tray.locator('[data-ewc-tray-select="failed"]').click();
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(3);

		// Apply outcome: 1 damage and Prone on every failure.
		await tray.locator("[data-ewc-tray-apply]").click();
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("6");
		await expect(row(page, "skel").locator(".ewc-row__hp")).toContainText("12");
		await expect(row(page, "gob-2").locator(".ewc-pill--cond")).toContainText("Prone");
		await expect(row(page, "mage").locator(".ewc-pill--cond")).toHaveCount(0);
		await expect(tray.locator(".ewc-tray__status")).toContainText("Applied");

		// The tray is dismissable and never covers the rail.
		const trayBox = await tray.boundingBox();
		const railBox = await page.locator(".ewc-rail").boundingBox();
		expect(trayBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
		await tray.locator("[data-ewc-tray-close]").click();
		await expect(tray).toBeHidden();

		// Undo: the condition goes, the damage stays.
		await blur(page);
		await page.keyboard.press("ControlOrMeta+z");
		await expect(row(page, "gob-2").locator(".ewc-pill--cond")).toHaveCount(0);
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("6");

		// Fx: Bless with a hand-typed duration and unit, cast by the Mage.
		await page.keyboard.press("e");
		await page.locator('[data-ewc-fx="bless"]').click();
		await page.locator("[data-ewc-fx-dur]").fill("3");
		await page.locator("[data-ewc-fx-unit]").selectOption("round");
		await expect(page.locator(".ewc-fx__detail .ewc-field__hint").first()).toContainText("3 rounds");
		await page.locator("[data-ewc-fx-caster]").selectOption("mage");
		await page.locator("[data-ewc-fx-apply]").click();
		await expect(page.locator('[data-ewc-fx-active="Bless"]')).toContainText("3 rounds");
		await expect(row(page, "gob-1").locator(".ewc-pill--fx", {hasText: "Bless"})).toHaveCount(1);
		await expect(row(page, "skel").locator("[data-ewc-tally]")).toHaveAttribute("aria-label", /2/); // unviewed rows tally: cover + Bless

		// Switching the Mage's concentration warns, then ends Bless everywhere.
		await page.locator('[data-ewc-fx="bane"]').click();
		await page.locator("[data-ewc-fx-caster]").selectOption("mage");
		await expect(page.locator("[data-ewc-fx-warn]")).toContainText("Bless");
		await page.locator("[data-ewc-fx-apply]").click();
		await expect(page.locator('[data-ewc-fx-active="Bane"]')).toBeVisible();
		await expect(page.locator('[data-ewc-fx-active="Bless"]')).toHaveCount(0);
		await expect(page.locator(".ewc-pill--fx", {hasText: "Bless"})).toHaveCount(0);

		// Custom effect builder: Dex-save-only modifier + fire resistance (toggle off and on), saved for reuse.
		await page.locator("[data-ewc-fx-custom]").click();
		await expect(page.locator("[data-ewc-fxb]")).toBeVisible();
		await page.locator('[data-ewc-field="name"]').fill("Shield wall");
		await page.locator('[data-ewc-fk="fx-b-addmod"]').click();
		await page.locator('[data-ewc-fk="fx-b-mt-0"]').selectOption("save:dex");
		await page.locator('[data-ewc-fk="fx-b-mv-0"]').fill("3");
		await page.locator('[data-ewc-fk="fx-b-def"]').click();
		const fire = page.locator('[data-ewc-fk="fx-b-dt-fire"]');
		await fire.click();
		await expect(fire).toHaveAttribute("aria-pressed", "true");
		await fire.click();
		await expect(fire).toHaveAttribute("aria-pressed", "false");
		await fire.click();
		await expect(page.locator('[data-ewc-fk="fx-b-dt-psychic"]')).toBeVisible();
		await page.locator('[data-ewc-fk="fx-b-save"]').check();
		await page.locator("[data-ewc-fxb-submit]").click();
		await expect(page.locator("[data-ewc-fxb]")).toHaveCount(0);
		await expect(page.locator('[data-ewc-fx-active="Shield wall"]')).toBeVisible();
		await expect(page.locator(".ewc-fx__saved [data-ewc-fx]")).toContainText("Shield wall");
		await page.keyboard.press("r");
		await expect(page.locator(".ewc-act__wholist")).toContainText("+7"); // +2 Dex, +2 cover, +3 Shield wall

		// Command console (/): cheat-sheet, inline error, live preview, Enter, history.
		await blur(page);
		await page.keyboard.press("/");
		const con = page.locator("[data-ewc-console]");
		const input = page.locator("[data-ewc-console-in]");
		await expect(con).toBeVisible();
		await expect(input).toBeFocused();
		await expect(con.locator("[data-ewc-console-ex]").first()).toBeVisible();
		await input.fill("frobnicate");
		await expect(con.locator(".ewc-con__err")).toBeVisible();
		await input.fill("3 fire @goblin1");
		await expect(con.locator("[data-ewc-console-preview]")).toContainText("Goblin 1");
		await expect(con.locator('[data-ewc-console-pvrow="gob-1"]')).toBeVisible();
		await input.press("Enter");
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("5/7"); // Shield wall resists fire: 3 → 1
		await expect(input).toHaveValue("");
		await input.press("ArrowUp");
		await expect(input).toHaveValue("3 fire @goblin1");
		await input.fill("save dex 30 1 half @goblin2");
		await input.press("Enter");
		await expect(page.locator("[data-ewc-tray] .ewc-tray__item")).toHaveCount(1);
		await expect(page.locator("[data-ewc-tray] .ewc-tray__title")).toContainText("Dex save");
		await input.fill("bless @mage");
		await input.press("Enter");
		await expect(row(page, "mage").locator("[data-ewc-tally]")).toHaveCount(1);
		await input.press("Escape");
		await expect(con).toBeHidden();
		await expect(input).not.toBeFocused(); // a hidden input must not swallow ⌘Z

		// Console changes are undoable.
		await page.keyboard.press("ControlOrMeta+z");
		await expect(row(page, "mage").locator("[data-ewc-tally]")).toHaveCount(0);

		// Row hover ›_ opens the console pre-targeted at that creature without moving the row.
		const mageRow = row(page, "mage");
		const before = await mageRow.boundingBox();
		await mageRow.hover();
		const qa = mageRow.locator('[data-ewc-qa="console"]');
		await expect(qa).toBeVisible();
		expect((await mageRow.boundingBox())!.height).toBe(before!.height);
		await qa.click();
		await expect(con).toBeVisible();
		await expect(input).toHaveValue("@mage ");
		await expect(input).toBeFocused();
		await expect(mageRow).toHaveClass(/ewc-row--con/);
		await input.press("Escape");
		await input.press("Escape");
		await expect(con).toBeHidden();

		expect(errors).toEqual([]);
	});

	test("screenshots: day and night, wide and narrow", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		for (const theme of ["day", "night"]) {
			for (const width of [1280, 900]) {
				await page.setViewportSize({width, height: 800});
				await openCockpit(page);
				if (theme === "night") await page.evaluate(() => document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard"));
				await selectThree(page);
				await blur(page);
				await page.keyboard.press("r");
				await page.locator('[data-ewc-fk="roll-dc"]').fill("13");
				await page.locator("[data-ewc-roll-outcome]").click();
				await page.locator('[data-ewc-fk="roll-dmg"]').fill("2d6");
				await page.locator("[data-ewc-roll-go]").click();
				await expect(page.locator("[data-ewc-tray] .ewc-tray__item")).toHaveCount(3);
				await page.locator('[data-ewc-tray-row="gob-1"]').click();
				await page.mouse.move(width - 20, 790); // let the creature hover window close
				await expect(page.locator(".ve-hwin")).toHaveCount(0);
				await page.screenshot({path: `${SHOT_DIR}/act-roll-tray-${theme}-${width}.png`});
				await page.locator("[data-ewc-tray-close]").click();

				await page.keyboard.press("e");
				await page.locator("[data-ewc-fx-custom]").click();
				await page.locator('[data-ewc-fk="fx-b-addmod"]').click();
				await page.locator('[data-ewc-fk="fx-b-def"]').click();
				await page.screenshot({path: `${SHOT_DIR}/act-fx-builder-${theme}-${width}.png`});
				await page.locator('[data-ewc-fk="fx-b-cancel"]').click();
				await page.screenshot({path: `${SHOT_DIR}/act-fx-${theme}-${width}.png`});

				await blur(page);
				await page.keyboard.press("/");
				await page.locator("[data-ewc-console-in]").fill("save dex 14 8d6 fire half");
				await page.screenshot({path: `${SHOT_DIR}/act-console-${theme}-${width}.png`});
				await page.locator("[data-ewc-console-in]").fill("");
				await page.screenshot({path: `${SHOT_DIR}/act-console-cheat-${theme}-${width}.png`});
				await page.keyboard.press("Escape");
			}
		}
		expect(errors).toEqual([]);
	});
});
