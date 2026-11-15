import {expect, test, type Page} from "@playwright/test";

/*
 * A6 stage header and statblock affordances of the Lantern Cockpit (encounterworkspace.html?ew=2), on real Monster
 * Manual and 2024 Monster Manual data: styled roll chips, DC chips that call for a save, effect-modified numbers with
 * "base → modified" titles, the active-effects line, Held by / Tools / Reminders, statblock tags, the concentration
 * line with Drop, Revive, the PC card and the how-to hint. Fails on any console error.
 */

const SHOTS = process.env.EWC_SB_SHOTS || "test-results/encounter-cockpit-statblock";

const seed = async (page: Page, {tgtt = false} = {}) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async ({tgtt}) => {
		const load = async (file: string) => (await (await fetch(file)).json()).monster;
		const mm = await load("data/bestiary/bestiary-mm.json");
		const xmm = await load("data/bestiary/bestiary-xmm.json");
		const {getEncounterResourceDefaults} = await import("/js/encounterworkspace/encounterworkspace-resources.js");
		const {createEncounterPartyInstance} = await import("/js/encounterworkspace/encounterworkspace-party.js");
		const {getEncounterInstanceV8Defaults} = await import("/js/encounterworkspace/encounterworkspace-state.js");
		const {withEncounterTemplate} = await import("/js/encounterworkspace/encounterworkspace-templates.js");
		const {withEncounterDraft} = await import("/js/encounterworkspace/encounterworkspace-fx.js");
		const {setEncounterExhaustion} = await import("/js/encounterworkspace/encounterworkspace-conditions-rules.js");
		const mk = (id: string, list: {name: string, hp: {average: number}}[], name: string, src: string, initiative: number, hp: number | null = null) => {
			const monster = list.find(it => it.name === name);
			if (!monster) throw new Error(`${src.toUpperCase()} has no ${name}`);
			const hash = `${name.toLowerCase()}_${src}`;
			return {
				id,
				hash,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: hp ?? monster.hp.average, max: monster.hp.average, temp: 0},
				initiative,
				resources: getEncounterResourceDefaults(monster),
				...getEncounterInstanceV8Defaults(hash),
			};
		};
		const mage = mk("mage", mm, "Mage", "mm", 14);
		mage.resources.concentration = {active: true, label: "Greater Invisibility"};
		let state = {
			version: 8,
			sourceList: {name: "Lich's Court", saveId: "cockpit-statblock"},
			instances: [
				mk("drag", mm, "Adult Black Dragon", "mm", 20),
				mage,
				mk("drow", mm, "Drow", "mm", 13),
				mk("lich", mm, "Lich", "mm", 12),
				mk("xmage", xmm, "Mage", "xmm", 10),
				createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, hpCurrent: 18, initiative: 16, passive: 14}),
				mk("gob", mm, "Goblin", "mm", 5, 0),
			],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
			battlefield: [{id: "bf-1", rule: "custom", name: "Collapsing ceiling", scope: "all", ids: [], rounds: 2, note: "DC 13 Dexterity save at the end of each round"}],
			groupMeta: {},
			log: [],
			savedEffects: [],
			combat: {status: "setup"},
		};
		state = withEncounterTemplate(state, {key: "elite", ids: ["lich"]}).state;
		if (tgtt) state = withEncounterDraft(state, draft => setEncounterExhaustion(draft, {targetIds: ["xmage"], level: 2, ruleset: "tgtt"})).state;
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
		await StorageUtil.pSetForPage("encounterCockpitSettings", {ruleset: tgtt ? "tgtt" : "phb", monsterDeathSaves: false}, {page: "encounterworkspace.html"});
	}, {tgtt});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(7);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const blur = (page: Page) => page.locator("body").click({position: {x: 5, y: 5}});
const sb = (page: Page) => page.locator(".ewc-sb");
const view = async (page: Page, id: string) => {
	await row(page, id).locator(".ewc-row__ac").click();
	await expect(row(page, id)).toHaveClass(/is-viewed/);
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

test.describe("Encounter cockpit statblock (?ew=2)", () => {
	test.beforeEach(async ({page}) => {
		await page.setViewportSize({width: 1280, height: 900});
	});

	test("roll chips, DC calls and effect-modified numbers", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// D30: every chip kind on the dragon; dice stay native 5etools roller spans.
		await view(page, "drag");
		await expect(sb(page).locator(".ewc-roll--hit").first()).toHaveText("+11");
		await expect(sb(page).locator(".ewc-roll--dmg").first()).toBeVisible();
		await expect(sb(page).locator(".ewc-roll--skill").first()).toBeVisible();
		await expect(sb(page).locator(".ewc-roll--save").first()).toBeVisible();
		await expect(sb(page).locator(".ewc-roll--hit").first()).toHaveAttribute("data-packed-dice", /"hit"/);

		// D31: the Acid Breath DC calls for the save — DEX, 12d8 acid — in the Roll tab.
		await sb(page).locator(".ewc-roll--dc", {hasText: "DC 18"}).first().click();
		await expect(page.locator('[data-ewc-fk="roll-dc"]')).toHaveValue("18");
		await expect(page.locator('[data-ewc-roll-field="damage"]')).toHaveValue("12d8");
		await expect(page.locator('[data-ewc-roll-field="damageType"]')).toHaveValue("acid");
		await expect(page.locator(".ewc-toasts")).toContainText("DC 18 Dexterity save is in the Roll tab");

		// D32/D33/D35: Bless from the Mage — changed chips, base → modified titles, the effects line, Held by.
		await view(page, "drow");
		await blur(page);
		await page.keyboard.press("e");
		await page.locator('[data-ewc-fx="bless"]').click();
		await page.locator("[data-ewc-fx-caster]").selectOption("mage");
		await page.locator("[data-ewc-fx-apply]").click();
		const hit = sb(page).locator(".ewc-roll--hit.is-changed").first();
		await expect(hit).toHaveText("+4+1d4");
		await expect(hit).toHaveAttribute("title", "Roll to hit — base +4 → +4 +1d4 (Bless +1d4)");
		await expect(hit.locator(".ewc-roll__mk.is-plus")).toHaveText("+1d4");
		await expect(sb(page).locator(".ewc-roll--save.is-changed")).toHaveCount(6);
		await expect(sb(page).locator(".ewc-sbdeltas")).toHaveText("Active effectsattacks +1d4 · all saves +1d4");
		await expect(sb(page).locator(".ewc-sbx__held")).toContainText("Mage 1 · Bless");

		// The changed chip still rolls through the cockpit handler into the statblock roll feed.
		await hit.click();
		await expect(page.locator("[data-ewc-feed]")).toBeVisible();
		await expect(page.locator("[data-ewc-feed]")).toContainText("Drow");

		// D35: Held by jumps to the caster.
		await sb(page).locator(".ewc-sbx__held button").click();
		await expect(row(page, "mage")).toHaveClass(/is-viewed/);

		// D36: the concentration line names its targets; Drop ends Bless on the Drow.
		await expect(page.locator(".ewc-vh__conc")).toContainText("Bless");
		await page.locator(".ewc-vh__drop").click();
		await expect(page.locator(".ewc-vh__conc")).toHaveCount(0);
		await view(page, "drow");
		await expect(sb(page).locator(".ewc-roll.is-changed")).toHaveCount(0);
		await expect(sb(page).locator(".ewc-sbdeltas")).toHaveCount(0);

		// D34: Conc mark from the Tools strip starts concentration.
		await sb(page).locator(".ewc-sbx__conc").fill("Darkness");
		await sb(page).locator('.ewc-sbx__tools button:has-text("Mark")').click();
		await expect(page.locator(".ewc-vh__conc")).toContainText("Darkness");

		expect(errors).toEqual([]);
	});

	test("TGTT exhaustion lowers the 2024 Mage's spell save DC", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page, {tgtt: true});
		await openCockpit(page);
		await view(page, "xmage");
		const dc = sb(page).locator(".ewc-roll--dc.is-changed").first();
		await expect(dc).toHaveText("DC 12");
		await expect(dc).toHaveAttribute("title", "Call for this save — spell save DC 14 → 12 (-2 from effects)");
		await expect(sb(page).locator(".ewc-sbdeltas")).toContainText("spell save DC -2");
		expect(errors).toEqual([]);
	});

	test("header, tags, reminders, Revive, PC card and the how-to hint", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// D39: the hint shows until dismissed, stays dismissed, and the cockpit API brings it back.
		await expect(page.locator(".ewc-hint")).toBeVisible();
		await page.locator(".ewc-hint__x").click();
		await expect(page.locator(".ewc-hint")).toBeHidden();
		await page.reload();
		await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
		await expect(page.locator(".ewc-hint")).toBeHidden();
		await page.evaluate(() => (globalThis as typeof globalThis & {ewCockpit: {showHint: () => void}}).ewCockpit.showHint());
		await expect(page.locator(".ewc-hint")).toBeVisible();
		await expect(page.locator(".ewc-hint__x")).toBeFocused();

		// D38: template tag and the battlefield reminder.
		await view(page, "lich");
		await expect(sb(page).locator(".ewc-sbtag--tpl")).toHaveText("⟳ Elite");
		await expect(sb(page).locator(".ewc-sbx__rem")).toContainText("Collapsing ceiling — DC 13 Dexterity save at the end of each round (2 rounds)");
		await expect(sb(page).locator('.ewc-sbx__tools button:has-text("Assess CR")')).toBeVisible();

		// D37: the PC card, with Passive in the header too.
		await view(page, "brenna");
		await expect(page.locator(".ewc-sb--pc .ewc-pccard__name")).toHaveText("Brenna");
		await expect(page.locator(".ewc-sb--pc")).not.toContainText("null");
		await expect(page.locator(".ewc-sb--pc dl")).toContainText("Passive Perception14");
		await expect(page.locator(".ewc-vh__stats")).toContainText("Passive 14");

		// D16: Revive on a creature at 0 HP.
		await view(page, "gob");
		await page.locator(".ewc-vh__revive").click();
		await expect(row(page, "gob").locator(".ewc-row__hp")).toHaveText("1/7");
		await expect(page.locator(".ewc-vh__revive")).toHaveCount(0);

		expect(errors).toEqual([]);
	});

	test("screenshots: day and night, wide and narrow", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await view(page, "drow");
		await blur(page);
		await page.keyboard.press("e");
		await page.locator('[data-ewc-fx="bless"]').click();
		await page.locator("[data-ewc-fx-caster]").selectOption("mage");
		await page.locator("[data-ewc-fx-apply]").click();
		await expect(sb(page).locator(".ewc-sbdeltas")).toBeVisible();
		await page.keyboard.press("Escape");
		await page.screenshot({path: `${SHOTS}/day-1280-drow.png`});
		await view(page, "drag");
		await page.screenshot({path: `${SHOTS}/day-1280-dragon.png`});
		await view(page, "mage");
		await page.screenshot({path: `${SHOTS}/day-1280-mage.png`});
		await view(page, "brenna");
		await page.screenshot({path: `${SHOTS}/day-1280-pc.png`});
		await page.evaluate(() => document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard"));
		await view(page, "lich");
		await page.screenshot({path: `${SHOTS}/night-1280-lich.png`});
		await view(page, "drow");
		await page.setViewportSize({width: 900, height: 900});
		await page.screenshot({path: `${SHOTS}/night-900-drow.png`});
		expect(errors).toEqual([]);
	});
});
