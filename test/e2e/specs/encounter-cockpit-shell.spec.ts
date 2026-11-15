import {expect, test, type Page} from "@playwright/test";

/*
 * Smoke test for the Lantern Cockpit shell (encounterworkspace.html?ew=2) on real Monster Manual data.
 * Seeds a saved encounter through the same storage key the legacy workspace uses, then drives the cockpit
 * the way a DM would: view vs select, typed damage, a condition, undo, turn order, keyboard shortcuts
 * (never while typing), native hovers — and fails on any console error.
 */

const SEED_IDS = ["gob-1", "gob-2", "mage", "owlbear"];

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async ids => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const pick = (name: string) => {
			const found = monsters.find((it: {name: string}) => it.name === name);
			if (!found) throw new Error(`MM has no ${name}`);
			return found;
		};
		const goblin = pick("Goblin");
		const mage = pick("Mage");
		const owlbear = pick("Owlbear");
		const mk = (id: string, monster: {name: string, hp: {average: number}}, initiative: number) => ({
			id,
			hash: `${monster.name.toLowerCase()}_mm`,
			monster,
			conditions: [],
			areaNotes: [],
			modifiers: [],
			statblockOperations: [],
			hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
			initiative,
		});
		const state = {
			version: 4,
			sourceList: {name: "Owlbear Ambush", saveId: "cockpit-smoke"},
			instances: [mk(ids[0], goblin, 18), mk(ids[1], goblin, 9), mk(ids[2], mage, 14), mk(ids[3], owlbear, 12)],
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
	}, SEED_IDS);
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(4);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);

const trackConsoleErrors = (page: Page) => {
	const errors: string[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		// The dev server has no built service-worker injector; that 404 is environmental, not the cockpit's.
		if (msg.location().url.endsWith("/sw-injector.js") && /404|Failed to load resource/i.test(msg.text())) return;
		errors.push(msg.text());
	});
	page.on("pageerror", err => errors.push(`${err.name}: ${err.message}`));
	return errors;
};

test.describe("Encounter cockpit shell (?ew=2)", () => {
	test("drives a real saved encounter end-to-end with zero console errors", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// Rail follows initiative order and shows real numbers.
		await expect(page.locator(".ewc-row").first()).toHaveAttribute("data-ewc-id", "gob-1");
		await expect(row(page, "owlbear").locator(".ewc-row__hp")).toContainText("59");
		await expect(row(page, "owlbear").locator(".ewc-row__ac")).toContainText("13");

		// Clicking a row VIEWS it (statblock), it does not select it.
		await row(page, "owlbear").locator(".ewc-row__name").click();
		await expect(row(page, "owlbear")).toHaveClass(/is-viewed/);
		await expect(row(page, "owlbear")).not.toHaveClass(/is-sel/);
		await expect(page.locator(".ewc-vh__name")).toHaveText("Owlbear");
		await expect(page.locator(".ewc-sb table.ve-stats")).toContainText("Multiattack");
		await expect(page.locator(".ewc-dock__target")).toContainText("Owlbear");

		// The checkbox SELECTS; the dock then targets the selection.
		await row(page, "gob-1").locator(".ewc-row__chk input").check();
		await row(page, "gob-2").locator(".ewc-row__chk input").check();
		await expect(row(page, "gob-1")).toHaveClass(/is-sel/);
		// Ticking adjacent rows must not shift rows mid-click and turn a tick into a view.
		await expect(row(page, "owlbear")).toHaveClass(/is-viewed/);
		await expect(page.locator(".ewc-dock__target")).toHaveClass(/is-sel/);
		await expect(page.locator(".ewc-dock__target")).toContainText("Selected 2");

		// Typed damage: choose slashing, then unchoose it (back to untyped), then choose again.
		await page.keyboard.press("Escape");
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);
		await row(page, "gob-1").locator(".ewc-row__name").click();
		await page.locator("#ewc-hp-amt").fill("4");
		const slashing = page.locator('.ewc-dt[data-ewc-dt="slashing"]');
		await slashing.click();
		await expect(slashing).toHaveAttribute("aria-pressed", "true");
		await slashing.click();
		await expect(slashing).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator(".ewc-dt__set legend")).toContainText("untyped");
		await page.locator(".ewc-dt__more").click();
		await expect(page.locator('.ewc-dt[data-ewc-dt="psychic"]')).toBeVisible();
		await expect(page.locator(".ewc-dt--untyped")).toHaveAttribute("aria-pressed", "true");
		await slashing.click();
		await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("3");

		// Shortcuts must not fire while typing: "n" in the amount box is text, not Next turn.
		await page.locator("#ewc-hp-amt").fill("");
		await page.locator("#ewc-hp-amt").pressSequentially("nc");
		await expect(page.locator("#ewc-hp-amt")).toHaveValue("nc");
		await expect(page.locator(".ewc-round")).toContainText("Not started");
		await expect(page.locator('.ewc-dock__tab[aria-selected="true"]')).toContainText("HP");
		await page.locator("#ewc-hp-amt").fill("");
		await page.keyboard.press("Escape");

		// C switches to conditions; toggle Prone from the real conditions data.
		await page.keyboard.press("c");
		const prone = page.locator('.ewc-cond[data-ewc-cond="prone"]');
		await expect(prone).toBeVisible();
		await prone.click();
		await expect(prone).toHaveAttribute("aria-pressed", "true");
		await expect(row(page, "gob-1").locator(".ewc-pill--cond")).toContainText("Prone");

		// Undo (Ctrl/Cmd+Z) removes the condition; the damage is still there.
		await page.keyboard.press("ControlOrMeta+z");
		await expect(row(page, "gob-1").locator(".ewc-pill--cond")).toHaveCount(0);
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("3");
		// Undo again restores the HP.
		await page.locator('[data-ewc-act="undo"]').click();
		await expect(row(page, "gob-1").locator(".ewc-row__hp")).toContainText("7");

		// Turns: N starts combat at the top, N again advances, P goes back.
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");
		await expect(row(page, "gob-1")).toHaveClass(/is-turn/);
		await page.keyboard.press("n");
		await expect(row(page, "mage")).toHaveClass(/is-turn/);
		await page.keyboard.press("p");
		await expect(row(page, "gob-1")).toHaveClass(/is-turn/);

		// Shift+? opens the shortcut sheet; Esc closes it.
		await page.keyboard.press("Shift+?");
		await expect(page.locator("dialog.ewc-keys")).toBeVisible();
		await expect(page.locator("dialog.ewc-keys")).toContainText("Next turn");
		await page.keyboard.press("Escape");
		await expect(page.locator("dialog.ewc-keys")).toBeHidden();

		// A native 5etools hover appears for a condition.
		await row(page, "mage").locator(".ewc-row__name").click();
		await page.keyboard.press("c");
		await page.locator('.ewc-cond[data-ewc-cond="blinded"]').hover();
		await expect(page.locator(".ve-hwin").first()).toBeVisible();
		await expect(page.locator(".ve-hwin").first()).toContainText(/can't see/i);

		// State survived in the shared store: reloading keeps round 1.
		await page.reload();
		await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
		await expect(page.locator(".ewc-round")).toContainText("Round 1");

		expect(errors).toEqual([]);
	});

	test("the legacy workspace (?ew=1) still loads the same saved encounter", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await page.reload();
		await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
		await expect(page.locator(".ew__roster-row")).toHaveCount(4);
		await expect(page.locator("#ew-cockpit")).toBeHidden();
		expect(errors).toEqual([]);
	});
});
