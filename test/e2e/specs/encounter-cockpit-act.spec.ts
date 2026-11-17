import {expect, test, type Page} from "@playwright/test";

/*
 * Lantern Cockpit "Act" features (encounterworkspace.html?ew=2) on real Monster Manual data:
 * the Roll tab + roll tray, the Fx tab (presets, cover, concentration, hand-typed durations), the custom
 * effect builder, the `/` command console (a top-bar button) and the row ⋯ → Console… entry point. Fails on any
 * console error.
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

		// Row ⋯ → Console… opens the console pre-targeted at that creature; hovering never moves the row, and
		// there is no separate ›_ quick action any more.
		const mageRow = row(page, "mage");
		const before = await mageRow.boundingBox();
		await mageRow.hover();
		const more = mageRow.locator('[data-ewc-qa="more"]');
		await expect(more).toBeVisible();
		await expect(mageRow.locator('[data-ewc-qa="console"]')).toHaveCount(0);
		expect((await mageRow.boundingBox())!.height).toBe(before!.height);
		await more.click();
		await page.locator('.ewc-rowmenu [data-ewc-rowmenu="console"]').click();
		await expect(con).toBeVisible();
		await expect(input).toHaveValue("@mage ");
		await expect(input).toBeFocused();
		await expect(mageRow).toHaveClass(/ewc-row--con/);
		await input.press("Escape");
		await input.press("Escape");
		await expect(con).toBeHidden();

		expect(errors).toEqual([]);
	});

	test("dock: top-bar console, tray in the dock column, duration stepper, skill chips, roll-time prompt", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await page.setViewportSize({width: 1280, height: 800});
		await seed(page);
		await openCockpit(page);

		// The console is a top-bar button (›_ /), not part of the dock: closed until clicked or `/`, it opens as a
		// popover under the bar, over the stage only — never covering the rail or the dock.
		const dock = page.locator(".ewc-dock");
		const openBtn = page.locator(".ewc-bar [data-ewc-console-open]");
		const pop = page.locator("[data-ewc-console-pop]");
		await expect(openBtn).toBeVisible();
		await expect(openBtn).toHaveAttribute("aria-expanded", "false");
		await expect(openBtn.locator("kbd")).toContainText("/");
		await expect(dock.locator("[data-ewc-console-pop], [data-ewc-console], [data-ewc-console-in]")).toHaveCount(0);
		await expect(pop).toBeHidden();
		await openBtn.click();
		const input = page.locator("[data-ewc-console-in]");
		await expect(pop).toBeVisible();
		await expect(input).toBeFocused();
		await expect(openBtn).toHaveAttribute("aria-expanded", "true");
		await expect(pop.locator("[data-ewc-console-ex]")).not.toHaveCount(0);
		const popBox = (await pop.boundingBox())!;
		const barBox = (await page.locator(".ewc-bar").boundingBox())!;
		const railBox = (await page.locator(".ewc-rail").boundingBox())!;
		const dockColBox = (await dock.boundingBox())!;
		expect(popBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
		expect(popBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
		expect(popBox.x + popBox.width).toBeLessThanOrEqual(dockColBox.x);
		// The button toggles: an empty console goes away on a second click — held like a real click, so the input's
		// blur (and its auto-hide) lands between press and release…
		await openBtn.click({delay: 120});
		await expect(pop).toBeHidden();
		await expect(openBtn).toHaveAttribute("aria-expanded", "false");
		// …and `/` opens it straight into the input.
		await blur(page);
		await page.keyboard.press("/");
		await expect(input).toBeFocused();
		// A command typed and entered while the previous one is still applying runs next — it is not
		// dropped, and the first command finishing does not wipe it.
		await input.evaluate((el: HTMLInputElement) => {
			const enter = () => el.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
			el.value = "frightened @goblin1";
			enter();
			el.value = "frightened @goblin2";
			enter();
		});
		await expect(row(page, "gob-2").locator(".ewc-pill--cond")).toContainText("Frightened");
		await expect(row(page, "gob-1").locator(".ewc-pill--cond")).toContainText("Frightened");
		await expect(input).toHaveValue("");
		await input.press("Escape");

		// D43: searchable skill chips — by name or by ability, Enter picks the first match.
		await selectThree(page);
		await blur(page);
		await page.keyboard.press("r");
		await page.locator('[data-ewc-fk="roll-kind-skill"]').click();
		const skillQ = page.locator("[data-ewc-roll-skill-q]");
		const chips = page.locator("[data-ewc-roll-skill]");
		await expect(chips).toHaveCount(18);
		await skillQ.fill("dex");
		await expect(chips).toHaveCount(3);
		await skillQ.fill("zzz");
		await expect(page.locator("[data-ewc-roll-skill-none]")).toBeVisible();
		await skillQ.fill("perc");
		await expect(chips).toHaveCount(1);
		await skillQ.press("Enter");
		await expect(chips).toHaveCount(18);
		await expect(page.locator('[data-ewc-roll-skill="perception"]')).toHaveAttribute("aria-checked", "true");
		await expect(page.locator('[data-ewc-roll-skill="perception"]')).toBeFocused();

		// D41: frightened asks "Is the source of its fear in sight?" once for both goblins; "No" rolls them straight.
		const prompt = page.locator("[data-ewc-roll-prompt]");
		await page.locator('[data-ewc-fk="roll-dc"]').fill("10");
		await page.locator("[data-ewc-roll-go]").click();
		await expect(prompt).toBeVisible();
		await expect(prompt.locator("[data-ewc-prompt-q]")).toHaveCount(1);
		await expect(prompt.locator("[data-ewc-prompt-q]")).toContainText("fear");
		await expect(prompt.locator("[data-ewc-prompt-q]")).toContainText("Goblin 1");
		await expect(prompt.locator('[data-ewc-fk="prompt-0-yes"]')).toHaveAttribute("aria-checked", "true");
		await prompt.locator('[data-ewc-fk="prompt-0-no"]').click();
		await prompt.locator("[data-ewc-prompt-go]").click();
		await expect(prompt).toHaveCount(0);
		const tray = page.locator("[data-ewc-tray]");
		await expect(tray.locator(".ewc-tray__item")).toHaveCount(3);
		await expect(tray.locator(".ewc-tray__die")).toHaveCount(3); // no disadvantage: one die each
		await expect(tray.locator(".ewc-tray__title")).toContainText(/perception/i);

		// D45: the tray lives in the dock column and never covers the stage (statblock) or the rail.
		await expect(dock.locator(".ewc-dock__top [data-ewc-tray]")).toBeVisible();
		await expect(dock.locator("[data-ewc-feed]")).toHaveCount(1);
		const trayBox = (await tray.boundingBox())!;
		const stageBox = (await page.locator(".ewc-stage").boundingBox())!;
		const dockBox = (await dock.boundingBox())!;
		expect(trayBox.x).toBeGreaterThanOrEqual(stageBox.x + stageBox.width - 1);
		expect(trayBox.x + trayBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);

		// D46: tray chip buttons are bordered, not bare text.
		for (const which of ["failed", "passed"]) {
			const border = await tray.locator(`[data-ewc-tray-select="${which}"]`).evaluate(el => {
				const cs = getComputedStyle(el);
				return {style: cs.borderTopStyle, width: cs.borderTopWidth, color: cs.borderTopColor};
			});
			expect(border.style, which).toBe("solid");
			expect(border.width, which).not.toBe("0px");
			expect(border.color, which).not.toBe("rgba(0, 0, 0, 0)");
		}

		// "Cancel that roll" drops the frightened goblins; only the Skeleton rolls.
		await tray.locator("[data-ewc-tray-close]").click();
		await page.locator("[data-ewc-roll-go]").click();
		await prompt.locator('[data-ewc-fk="prompt-0-cancel"]').click();
		await prompt.locator("[data-ewc-prompt-go]").click();
		await expect(tray.locator(".ewc-tray__item")).toHaveCount(1);
		await expect(tray.locator('[data-ewc-tray-row="skel"]')).toBeVisible();

		// Esc backs out of the prompt without rolling.
		await tray.locator("[data-ewc-tray-close]").click();
		await page.locator("[data-ewc-roll-go]").click();
		await expect(prompt).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(prompt).toHaveCount(0);
		await expect(tray).toBeHidden();

		// D42: the Fx duration stepper and its "= 10 rounds · 1 min" readout; typed values normalise on blur.
		await blur(page);
		await page.keyboard.press("e");
		await page.locator('[data-ewc-fx="bless"]').click();
		const hint = page.locator(".ewc-fx__detail .ewc-field__hint").first();
		const amt = page.locator("[data-ewc-fx-dur]");
		await expect(hint).toContainText("10 rounds · 1 min");
		await page.locator('[data-ewc-fx-step="up"]').click();
		await expect(amt).toHaveValue("2");
		await expect(hint).toContainText("20 rounds · 2 min");
		await page.locator('[data-ewc-fx-step="down"]').click();
		await page.locator('[data-ewc-fx-step="down"]').click();
		await expect(amt).toHaveValue("1"); // never below 1
		await page.locator("[data-ewc-fx-unit]").selectOption("round");
		await amt.fill("15");
		await amt.blur();
		await expect(hint).toContainText("15 rounds · 1.5 min");
		await expect(page.locator("[data-ewc-fx-unit]")).toHaveValue("round");

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

				// Skill chips and the "Before rolling…" prompt (a frightened goblin), then put everything back.
				await page.locator("[data-ewc-console-in]").fill("frightened @goblin1");
				await page.keyboard.press("Enter");
				await expect(page.locator("[data-ewc-console-in]")).toHaveValue("");
				await page.keyboard.press("Escape");
				await expect(page.locator("[data-ewc-console]")).toBeHidden();
				await blur(page);
				await page.keyboard.press("r");
				await page.locator('[data-ewc-fk="roll-kind-skill"]').click();
				await page.locator("[data-ewc-roll-skill-q]").fill("wis");
				await page.screenshot({path: `${SHOT_DIR}/act-skill-chips-${theme}-${width}.png`});
				await page.locator("[data-ewc-roll-skill-q]").press("Enter");
				await page.locator("[data-ewc-roll-go]").click();
				await expect(page.locator("[data-ewc-roll-prompt]")).toBeVisible();
				await page.screenshot({path: `${SHOT_DIR}/act-roll-prompt-${theme}-${width}.png`});
				await page.keyboard.press("Escape");
				await expect(page.locator("[data-ewc-roll-prompt]")).toHaveCount(0);
				await page.locator('[data-ewc-fk="roll-kind-save"]').click();
				await blur(page);
				await page.keyboard.press("/");
				await page.locator("[data-ewc-console-in]").fill("-frightened @goblin1");
				await page.keyboard.press("Enter");
				await expect(page.locator("[data-ewc-console-in]")).toHaveValue("");
				await page.keyboard.press("Escape");
				await expect(page.locator("[data-ewc-console]")).toBeHidden();
				await expect(row(page, "gob-1").locator(".ewc-pill--cond")).toHaveCount(0);
			}
		}
		expect(errors).toEqual([]);
	});
});
