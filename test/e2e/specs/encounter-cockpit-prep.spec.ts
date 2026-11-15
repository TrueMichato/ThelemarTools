import {expect, test, type Page} from "@playwright/test";

/*
 * Prep mode (Q), Add (Shift+A) and the battlefield strip of the Lantern Cockpit (encounterworkspace.html?ew=2),
 * driven on a saved encounter built from real Monster Manual data. Fails on any console error.
 */

const seed = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async () => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const pick = (name: string) => {
			const found = monsters.find((it: {name: string}) => it.name === name);
			if (!found) throw new Error(`MM has no ${name}`);
			return found;
		};
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
			sourceList: {name: "Owlbear Ambush", saveId: "cockpit-prep"},
			instances: [mk("gob-1", pick("Goblin"), 18), mk("gob-2", pick("Goblin"), 9), mk("mage", pick("Mage"), 14), mk("owlbear", pick("Owlbear"), 12)],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
		};
		const savedEffects = [{
			key: "saved-war-cry",
			name: "War Cry",
			kind: "buff",
			mods: [{target: "attack", kind: "flat", value: 1}],
			duration: 3,
			conc: false,
			spell: null,
			note: "A rallying shout.",
			resist: [],
			immune: [],
			vulnerable: [],
			cover: false,
			saved: true,
		}];
		// Saved effects arrive with the v8 state; migrate the v4 seed through the real loader first.
		const stateUrl = new URL("js/encounterworkspace/encounterworkspace-state.js", location.href).href;
		const {EncounterWorkspaceState} = await import(stateUrl);
		const migrated = {...EncounterWorkspaceState.validate(state), savedEffects};
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", migrated, {page: "encounterworkspace.html"});
	});
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

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(4);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const fk = (page: Page, key: string) => page.locator(`[data-ewc-fk="${key}"]`);

/** View a creature without leaving the pointer on its hoverable name (a re-rendered anchor keeps its hover open). */
const view = async (page: Page, id: string) => {
	await row(page, id).locator(".ewc-row__ac").click();
	await expect(row(page, id)).toHaveClass(/is-viewed/);
	await page.mouse.move(640, 4);
};

const blur = async (page: Page) => {
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
};

test.describe("Encounter cockpit prep mode (?ew=2)", () => {
	test("Q toggles prep; creature, effects, battlefield and items tools change the real encounter", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await view(page, "owlbear");

		// The bar toggle says how to get in, then how to get out.
		const toggle = page.locator('[data-ewc-act="prep-toggle"]');
		await expect(toggle).toContainText("Enter Prep Mode");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator(".ewc-prep")).toBeHidden();
		await page.keyboard.press("q");
		await expect(page.locator(".ewc-prep")).toBeVisible();
		await expect(toggle).toContainText("Exit Prep Mode");
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator('[data-ewc-act="prep-exit"]')).toBeVisible();

		// ←/→ move between prep tabs (roving focus) and wrap.
		await expect(fk(page, "ptab-creature")).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(fk(page, "ptab-fx")).toHaveAttribute("aria-selected", "true");
		await expect(fk(page, "ptab-fx")).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await expect(fk(page, "ptab-add")).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("ArrowRight");
		await expect(fk(page, "ptab-creature")).toHaveAttribute("aria-selected", "true");

		// Assess CR on the untouched Owlbear, apply the estimate, then restore the listed CR.
		await fk(page, "cre-sub-cr").click();
		const crApply = page.locator('[data-ewc-fk="cr-apply-owlbear"]');
		await expect(crApply).toBeVisible();
		await crApply.click();
		await expect(fk(page, "cr-rm-owlbear")).toBeVisible();
		await fk(page, "cr-rm-owlbear").click();
		await expect(fk(page, "cr-rm-owlbear")).toHaveCount(0);

		await fk(page, "cre-sub-edit").click();

		// Quick edit: AC and HP max typed by hand land on the row and the statblock.
		await fk(page, "qe-ac").fill("15");
		await fk(page, "qe-hpMax").fill("70");
		await expect(page.locator(".ewc-prep__diff")).toContainText("70");
		await fk(page, "qe-apply").click();
		await expect(row(page, "owlbear").locator(".ewc-row__ac")).toContainText("15");
		await expect(row(page, "owlbear").locator(".ewc-row__hp")).toContainText("70");
		await expect(page.locator(".ewc-sb")).toContainText("15");
		// Invalid input blocks the apply button.
		await fk(page, "qe-ac").fill("-3");
		await expect(fk(page, "qe-apply")).toBeDisabled();
		await fk(page, "qe-reset").click();

		// Templates: preview, apply and remove Elite (a template, not an effect).
		await fk(page, "cre-sub-tpl").click();
		await expect(page.locator(".ewc-prep__ct")).toBeVisible();
		await fk(page, "tpl-elite").click();
		await fk(page, "tpl-preview").click();
		await expect(page.locator(".ewc-prep__preview")).toContainText("140");
		await fk(page, "tpl-apply").click();
		await expect(row(page, "owlbear").locator(".ewc-row__hp")).toContainText("140");
		await expect(fk(page, "tpl-rm-elite")).toBeVisible();
		await fk(page, "tpl-rm-elite").click();
		await expect(row(page, "owlbear").locator(".ewc-row__hp")).toContainText("70");

		// Legendary action written by hand goes onto the statblock.
		await fk(page, "cre-sub-legendary").click();
		await fk(page, "leg-name").fill("Tail Swipe");
		await fk(page, "leg-text").fill("The owlbear makes one claws attack.");
		await expect(fk(page, "leg-apply")).toContainText("1 creature");
		await fk(page, "leg-apply").click();
		await expect(page.locator(".ewc-sb")).toContainText("Tail Swipe");

		// I opens the full statblock editor (the shared Quick Actions modal); Esc closes it.
		await blur(page);
		await page.keyboard.press("i");
		await expect(page.locator(".bqa__modal").last()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".bqa__modal")).toHaveCount(0);
		// I opens it on Quick Edit; Ctrl+Enter saves the edit (the shared modal stays open for more edits).
		await page.keyboard.press("i");
		const modal = page.locator(".bqa__modal").last();
		const str = modal.locator("label").filter({hasText: /^Strength/}).locator("input");
		await expect(str).toHaveValue("20");
		await str.fill("22");
		await str.press("Control+Enter");
		await expect(page.getByText("Quick Edit saved in this encounter")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".bqa__modal")).toHaveCount(0);
		await expect(page.locator(".ewc-sb table.ve-stats")).toContainText("22");
		await expect(page.locator(".ewc-sb table.ve-stats")).toContainText("+6");

		// Effects: apply a saved effect, edit its duration by hand, hover it, see it on the statblock, remove it.
		await fk(page, "ptab-fx").click();
		await fk(page, "saved-apply-saved-war-cry").click();
		const fxRow = page.locator('[data-ewc-fx-row^="owlbear|"]').filter({hasText: "War Cry"});
		await expect(fxRow).toBeVisible();
		await expect(page.locator(".ewc-sb table.ve-stats .ewc-prep-sbfx")).toContainText("War Cry");
		const dur = fxRow.locator("input");
		await expect(dur).toHaveValue("3");
		await dur.fill("5");
		await dur.press("Enter");
		await expect(page.locator('[data-ewc-fx-row^="owlbear|"]').filter({hasText: "War Cry"}).locator("input")).toHaveValue("5");
		await fxRow.locator(".ewc-prep__fxn").hover();
		await expect(page.locator(".ve-hwin").last()).toContainText("War Cry");
		await page.mouse.move(640, 4);
		await fxRow.getByRole("button", {name: /Remove War Cry/}).click();
		await expect(page.locator('[data-ewc-fx-row^="owlbear|"]')).toHaveCount(0);
		// Creating a custom effect opens the shared builder inline; submitting applies + saves it and folds the form.
		await fk(page, "fx-new").click();
		const builder = page.locator('[data-ewc-fxb="prep-fxb"]');
		await expect(builder).toBeVisible();
		await builder.locator('[data-ewc-field="name"]').fill("Shield wall");
		await builder.locator("[data-ewc-fxb-submit]").click();
		await expect(builder).toHaveCount(0);
		await expect(page.locator('[data-ewc-fx-row^="owlbear|"]').filter({hasText: "Shield wall"})).toBeVisible();
		await expect(page.locator(".ewc-prep__dyn")).toContainText("Shield wall");
		await expect(fk(page, "fx-new")).toHaveAttribute("aria-expanded", "false");

		// Battlefield: add Dim light for 3 rounds; it shows in the strip with a native hover; edit focuses it; remove.
		await fk(page, "ptab-area").click();
		await expect(page.locator(".ewc-prep__rule").filter({hasText: "Lair actions"})).toBeVisible();
		await page.locator(".ewc-prep__rule").filter({hasText: /^Dim light$/}).click();
		await fk(page, "bf-rounds").fill("3");
		await fk(page, "bf-add").click();
		const chip = page.locator(".ewc-prep-strip__chip").filter({hasText: "Dim light"});
		await expect(chip).toBeVisible();
		await expect(chip).toContainText("3");
		await page.keyboard.press("q");
		await expect(page.locator(".ewc-prep")).toBeHidden();
		await expect(chip).toBeVisible();
		await chip.locator(".ewc-prep__bfn").hover();
		await expect(page.locator(".ve-hwin").last()).toContainText(/dim light/i);
		await page.mouse.move(640, 4);
		await chip.getByRole("button", {name: /Edit Dim light/}).click();
		await expect(page.locator(".ewc-prep")).toBeVisible();
		await expect(fk(page, "ptab-area")).toHaveAttribute("aria-selected", "true");
		await chip.getByRole("button", {name: /End Dim light/}).click();
		await expect(page.locator(".ewc-prep-strip__chip")).toHaveCount(0);

		// Items tab is there and opens on the viewed creature.
		await fk(page, "ptab-items").click();
		await expect(page.locator(".ewc-prep__dyn")).toContainText("Give an item");

		// The exit button leaves prep mode.
		await page.locator('[data-ewc-act="prep-exit"]').click();
		await expect(page.locator(".ewc-prep")).toBeHidden();
		await expect(toggle).toContainText("Enter Prep Mode");

		expect(errors).toEqual([]);
	});

	test("Shift+A adds real bestiary creatures into their group, and party members", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		await page.keyboard.press("Shift+A");
		const dialog = page.locator("dialog.ewc-add");
		await expect(dialog).toBeVisible();
		// The whole bestiary, not just the encounter.
		await expect(dialog).toContainText(/\d{3,} results/);
		await page.keyboard.type("gnoll pack lord");
		const hit = dialog.locator(".ewc-add__row").filter({hasText: "Gnoll Pack Lord"}).first();
		await expect(hit).toBeVisible();
		await hit.locator(".ewc-add__name").hover();
		await expect(page.locator(".ve-hwin").last()).toContainText("Gnoll Pack Lord");
		await page.mouse.move(640, 4);
		await hit.click();
		await fk(page, "add-qty-up").click();
		await expect(fk(page, "add-qty")).toHaveValue("2");
		await expect(fk(page, "add-go")).toContainText("Add 2");
		await fk(page, "add-go").click();
		await expect(page.locator(".ewc-row")).toHaveCount(6);
		await expect(page.locator(".ewc-chip").filter({hasText: "Gnoll Pack Lord"}).locator(".ewc-chip__n")).toHaveText("2");

		// Add party member by hand; stats are marked as entered.
		await page.keyboard.press("Shift+A");
		await expect(dialog).toBeVisible();
		await fk(page, "add-tab-party").click();
		await fk(page, "pc-name").fill("Rook");
		await fk(page, "pc-ac").fill("15");
		await fk(page, "pc-hp").fill("38");
		await fk(page, "pc-init").fill("3");
		await fk(page, "pc-go").click();
		await expect(page.locator(".ewc-row")).toHaveCount(7);
		await expect(page.locator(".ewc-row").filter({hasText: "Rook"}).locator(".ewc-row__hp")).toContainText("38");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		// From the prep Add tab, "+1" adds one more of a kind already in the fight, into its group.
		await page.keyboard.press("q");
		await fk(page, "ptab-add").click();
		await page.locator(".ewc-prep__dyn").getByRole("button", {name: "+1 Goblin"}).click();
		await expect(page.locator(".ewc-row")).toHaveCount(8);
		await expect(page.locator(".ewc-chip").filter({hasText: "Goblin"}).first().locator(".ewc-chip__n")).toHaveText("3");

		expect(errors).toEqual([]);
	});
});
