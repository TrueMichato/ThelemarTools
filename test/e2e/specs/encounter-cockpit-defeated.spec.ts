import {expect, test, type Page} from "@playwright/test";

/*
 * Defeated creatures and turn tints on the cockpit rail (encounterworkspace.html?ew=2), on real Monster Manual data:
 *   - a defeated creature leaves the initiative list for a folded "Defeated · N" section at its end;
 *   - Start / Next turn / Previous turn step over the defeated, healing one brings it back to the order;
 *   - party rows carry a faint party wash, and the current turn washes its whole card gold.
 * Fails on any console error.
 */

const seed = async (page: Page, {lair = false, darkness = false} = {}) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async ({lair, darkness}) => {
		const res = await fetch("data/bestiary/bestiary-mm.json");
		const {monster: monsters} = await res.json();
		const {getEncounterResourceDefaults} = await import("/js/encounterworkspace/encounterworkspace-resources.js");
		const {createEncounterPartyInstance} = await import("/js/encounterworkspace/encounterworkspace-party.js");
		const {getEncounterInstanceV8Defaults, EncounterWorkspaceState} = await import("/js/encounterworkspace/encounterworkspace-state.js");
		const {withEncounterBattlefieldEntry} = await import("/js/encounterworkspace/encounterworkspace-battlefield.js");
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
		const brenna = createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, hpCurrent: 24, initiative: 16, classLine: "Rogue 5"});
		let state = EncounterWorkspaceState.validate({
			version: 8,
			sourceList: {name: "Cragmaw Hideout", saveId: "cockpit-defeated"},
			instances: [mk("gob-1", "Goblin", 20), brenna, mk("mage", "Mage", 14), mk("owlbear", "Owlbear", 12), mk("gob-2", "Goblin", 9)],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
			battlefield: [],
			groupMeta: {},
			log: [],
			savedEffects: [],
			combat: {status: "setup"},
		});
		// The goblin at the top of the order is already down: the order starts with Brenna.
		const gob1 = state.instances.find((it: {id: string}) => it.id === "gob-1");
		Object.assign(gob1, {defeated: true, hp: {...gob1.hp, current: 0}});
		if (lair) state = withEncounterBattlefieldEntry(state, {rule: "lair-actions", id: "bf-lair"}).state;
		if (darkness) state = withEncounterBattlefieldEntry(state, {rule: "darkness", id: "bf-dark"}).state;
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	}, {lair, darkness});
};

const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(5);
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const fk = (page: Page, key: string) => page.locator(`[data-ewc-fk="${key}"]`);
const toasts = (page: Page) => page.locator(".ewc-toasts");
const rbf = (page: Page, key: string) => page.locator(`[data-ewc-rbf="${key}"]`);
const getState = (page: Page) => page.evaluate(() => (globalThis as typeof globalThis & {ewCockpit: {getState: () => any}}).ewCockpit.getState());

const view = async (page: Page, id: string) => {
	await row(page, id).locator(".ewc-row__ac").click();
	await expect(row(page, id)).toHaveClass(/is-viewed/);
	await page.mouse.move(640, 4);
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

const liveIds = (page: Page) => page.locator(".ewc-rail__list > li.ewc-row").evaluateAll(els => els.map(it => (it as HTMLElement).dataset.ewcId));
const defeated = (page: Page) => page.locator("[data-ewc-defeated]");
const bgImage = (page: Page, id: string) => row(page, id).evaluate(ele => getComputedStyle(ele).backgroundImage);

test.describe("Encounter cockpit defeated area and turn tints (?ew=2)", () => {
	test("defeated creatures fold out of the order, turns skip them, healing brings them back", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// The fallen goblin is out of the order, in a closed "Defeated · 1" section at the list's end.
		await expect.poll(() => liveIds(page)).toEqual(["brenna", "mage", "owlbear", "gob-2"]);
		await expect(defeated(page).locator("summary")).toHaveText(/Defeated\s*1/);
		await expect(defeated(page).locator("details")).not.toHaveAttribute("open", /.*/);
		await expect(row(page, "gob-1")).toBeHidden();
		// The view toggle counts the living only.
		await expect(fk(page, "rail-view-init")).toContainText("4");

		// Opening it shows the struck-through row; the choice survives a re-render.
		await defeated(page).locator("summary").click();
		await expect(row(page, "gob-1")).toBeVisible();
		await expect(row(page, "gob-1")).toHaveClass(/is-defeated/);

		// Start skips the defeated top of the order; Next wraps past it into round 2.
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");
		await expect(row(page, "brenna")).toHaveClass(/is-turn/);
		await expect(row(page, "gob-1")).toBeVisible();
		for (const id of ["mage", "owlbear", "gob-2"]) {
			await page.keyboard.press("n");
			await expect(row(page, id)).toHaveClass(/is-turn/);
		}
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 2");
		await expect(row(page, "brenna")).toHaveClass(/is-turn/);
		await expect(row(page, "gob-1")).not.toHaveClass(/is-turn/);
		// Previous turn steps back over it too.
		await page.keyboard.press("p");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");
		await expect(row(page, "gob-2")).toHaveClass(/is-turn/);
		await page.keyboard.press("n");
		await expect(row(page, "brenna")).toHaveClass(/is-turn/);

		// Dropping the owlbear to 0 moves it into the section; Next goes from the mage straight to the goblin.
		await page.keyboard.press("n");
		await expect(row(page, "mage")).toHaveClass(/is-turn/);
		await row(page, "owlbear").locator(".ewc-row__name").click();
		await fk(page, "tab-hp").click();
		await page.locator("#ewc-hp-amt").fill("999");
		await fk(page, "hp-damage").click();
		await expect(defeated(page).locator("summary")).toHaveText(/Defeated\s*2/);
		await expect.poll(() => liveIds(page)).toEqual(["brenna", "mage", "gob-2"]);
		// The viewed creature is in the section, so it stays open on it.
		await expect(row(page, "owlbear")).toBeVisible();
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("n");
		await expect(row(page, "gob-2")).toHaveClass(/is-turn/);

		// Healing the owlbear above 0 returns it to its place in the order.
		await row(page, "owlbear").locator(".ewc-row__name").click();
		await fk(page, "tab-hp").click();
		await page.locator("#ewc-hp-amt").fill("10");
		await fk(page, "hp-heal").click();
		await expect.poll(() => liveIds(page)).toEqual(["brenna", "mage", "owlbear", "gob-2"]);
		await expect(defeated(page).locator("summary")).toHaveText(/Defeated\s*1/);

		expect(errors).toEqual([]);
	});

	test("party rows carry a party wash and the current turn washes its whole card", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await page.mouse.move(640, 4);

		await expect.poll(() => bgImage(page, "brenna")).toMatch(/gradient/);
		await expect.poll(() => bgImage(page, "mage")).toBe("none");
		await expect.poll(() => bgImage(page, "owlbear")).toBe("none");
		const partyWash = await bgImage(page, "brenna");

		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("n");
		await expect(row(page, "brenna")).toHaveClass(/is-turn/);
		await page.keyboard.press("n");
		await expect(row(page, "mage")).toHaveClass(/is-turn/);
		await page.mouse.move(640, 4);
		// The turn wash is not the party wash, and it keeps the gold hairline around the card.
		await expect.poll(() => bgImage(page, "mage")).toMatch(/gradient/);
		await expect.poll(() => bgImage(page, "mage")).not.toBe(partyWash);
		await expect.poll(() => row(page, "mage").evaluate(ele => getComputedStyle(ele).boxShadow)).toMatch(/inset/);
		await expect.poll(() => bgImage(page, "owlbear")).toBe("none");

		expect(errors).toEqual([]);
	});
});
