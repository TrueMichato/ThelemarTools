import {expect, test, type Page} from "@playwright/test";
import {CreatureTransformationPage, Round72CreatureTransformationPage} from "../pages/CreatureTransformationPage";

/*
 * Real-data sweep of the Lantern Cockpit (encounterworkspace.html?ew=2): 30 varied monsters — 2014 Monster Manual,
 * 2024 Monster Manual and an installed homebrew — in four saved encounters. For every creature: the native statblock
 * renders, a d20 and a damage die from the statblock land in the roll feed (not the native roller), a native hover
 * opens, its use trackers appear, and typed damage from the dock honours its immunities, resistances and
 * vulnerabilities. Per encounter, Elite and Weak apply to every creature at once, then the creature-type editor
 * previews a transformation on every creature. The v2 creature-type engine asks per-target, monster-specific source
 * questions, so a full answered apply runs once, on a dedicated MM Bugbear (Zombie, DMG). Any console error fails
 * the test.
 */

type Book = "mm" | "xmm" | "brew";
type Tracker = "legendary" | "recharge" | "slots" | "uses";
type HoverKind = "spells" | "conditionsdiseases" | "items" | "bestiary";

interface SweepCreature {
	id: string;
	book: Book;
	name: string;
	/**
	 * Damage dealt from the dock and the HP it should cost, given the creature's defenses. `review` answers a
	 * conditional defense ("damage from spells") the dock must ask about before applying anything.
	 */
	damage: {type: string, amount: number, loss: number, review?: "yes" | "no"};
	trackers: Tracker[];
	hover: HoverKind | null;
}

interface SweepEncounter {
	title: string;
	/** Undead (SCRE) category: the one catalog recipe that needs no per-target v2 answers on arbitrary creature types. */
	undeadCategory: string;
	creatures: SweepCreature[];
}

const TRACKER_SELECTORS: Record<Tracker, string> = {
	legendary: '[data-inline-resource="ability:auto:legendary-actions"]',
	recharge: '[data-inline-resource^="recharge:"]',
	slots: '[data-inline-resource^="slots:"]',
	uses: '[data-inline-resource^="ability:auto:ability:"]',
};

const ENCOUNTERS: SweepEncounter[] = [
	{
		title: "Legends and lairs",
		undeadCategory: "ghostly",
		creatures: [
			{id: "red-mm", book: "mm", name: "Adult Red Dragon", damage: {type: "fire", amount: 10, loss: 0}, trackers: ["legendary", "recharge", "uses"], hover: "conditionsdiseases"},
			{id: "red-xmm", book: "xmm", name: "Adult Red Dragon", damage: {type: "fire", amount: 10, loss: 0}, trackers: ["legendary", "recharge", "uses"], hover: "spells"},
			{id: "lich-mm", book: "mm", name: "Lich", damage: {type: "cold", amount: 10, loss: 5}, trackers: ["legendary", "slots", "uses"], hover: "spells"},
			{id: "lich-xmm", book: "xmm", name: "Lich", damage: {type: "necrotic", amount: 10, loss: 0}, trackers: ["legendary", "uses"], hover: "items"},
			{id: "tarrasque", book: "mm", name: "Tarrasque", damage: {type: "poison", amount: 10, loss: 0}, trackers: ["legendary", "uses"], hover: "conditionsdiseases"},
			{id: "mummy-lord", book: "mm", name: "Mummy Lord", damage: {type: "fire", amount: 10, loss: 20}, trackers: ["legendary", "slots"], hover: "spells"},
			{id: "vampire", book: "mm", name: "Vampire", damage: {type: "necrotic", amount: 10, loss: 5}, trackers: ["legendary", "uses"], hover: "bestiary"},
		],
	},
	{
		title: "Spellcasters",
		undeadCategory: "skeletal",
		creatures: [
			{id: "mage-mm", book: "mm", name: "Mage", damage: {type: "fire", amount: 10, loss: 10}, trackers: ["slots"], hover: "spells"},
			{id: "mage-xmm", book: "xmm", name: "Mage", damage: {type: "fire", amount: 10, loss: 10}, trackers: [], hover: "items"},
			{id: "archmage", book: "mm", name: "Archmage", damage: {type: "cold", amount: 10, loss: 5, review: "yes"}, trackers: ["slots"], hover: "bestiary"},
			{id: "priest", book: "mm", name: "Priest", damage: {type: "radiant", amount: 10, loss: 10}, trackers: ["slots"], hover: "items"},
			{id: "djinni", book: "mm", name: "Djinni", damage: {type: "lightning", amount: 10, loss: 0}, trackers: [], hover: "spells"},
			{id: "drow", book: "mm", name: "Drow", damage: {type: "poison", amount: 4, loss: 4}, trackers: [], hover: "conditionsdiseases"},
			{id: "couatl", book: "mm", name: "Couatl", damage: {type: "radiant", amount: 10, loss: 5}, trackers: [], hover: "spells"},
		],
	},
	{
		title: "Beasts, breath and swarms",
		undeadCategory: "vampiric",
		creatures: [
			{id: "hell-hound", book: "mm", name: "Hell Hound", damage: {type: "fire", amount: 10, loss: 0}, trackers: ["recharge"], hover: "conditionsdiseases"},
			{id: "chimera", book: "mm", name: "Chimera", damage: {type: "fire", amount: 10, loss: 10}, trackers: ["recharge"], hover: null},
			{id: "bats", book: "mm", name: "Swarm of Bats", damage: {type: "piercing", amount: 10, loss: 5}, trackers: [], hover: "conditionsdiseases"},
			{id: "rats", book: "mm", name: "Swarm of Rats", damage: {type: "slashing", amount: 10, loss: 5}, trackers: [], hover: "conditionsdiseases"},
			{id: "owlbear", book: "mm", name: "Owlbear", damage: {type: "slashing", amount: 10, loss: 10}, trackers: [], hover: null},
			{id: "werewolf", book: "mm", name: "Werewolf", damage: {type: "fire", amount: 10, loss: 10}, trackers: [], hover: "items"},
			{id: "doppelganger", book: "mm", name: "Doppelganger", damage: {type: "cold", amount: 10, loss: 10}, trackers: [], hover: "conditionsdiseases"},
			{id: "cat", book: "mm", name: "Cat", damage: {type: "bludgeoning", amount: 1, loss: 1}, trackers: [], hover: null},
		],
	},
	{
		title: "Undead, constructs and homebrew",
		undeadCategory: "mummified",
		creatures: [
			{id: "skel-mm", book: "mm", name: "Skeleton", damage: {type: "bludgeoning", amount: 4, loss: 8}, trackers: [], hover: "items"},
			{id: "skel-xmm", book: "xmm", name: "Skeleton", damage: {type: "poison", amount: 4, loss: 0}, trackers: [], hover: "conditionsdiseases"},
			{id: "iron-golem", book: "mm", name: "Iron Golem", damage: {type: "psychic", amount: 10, loss: 0}, trackers: ["recharge"], hover: "conditionsdiseases"},
			{id: "shield-guardian", book: "mm", name: "Shield Guardian", damage: {type: "poison", amount: 10, loss: 0}, trackers: [], hover: "conditionsdiseases"},
			{id: "pit-fiend", book: "mm", name: "Pit Fiend", damage: {type: "cold", amount: 10, loss: 5}, trackers: [], hover: "bestiary"},
			{id: "ghost", book: "mm", name: "Ghost", damage: {type: "fire", amount: 10, loss: 5}, trackers: ["recharge"], hover: "spells"},
			{id: "quaartzz", book: "brew", name: "Quaartzz", damage: {type: "lightning", amount: 10, loss: 5}, trackers: ["legendary", "uses"], hover: "bestiary"},
			{id: "crystalle", book: "brew", name: "Crystalle", damage: {type: "fire", amount: 10, loss: 0}, trackers: ["legendary", "slots", "uses"], hover: "spells"},
		],
	},
];

const BREW_URL = "homebrew/Moorchlyne%20Ioun%20Stones.json";

const seed = async (page: Page, encounter: SweepEncounter) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await page.locator("#encounter-workspace[aria-busy='false']").waitFor();
	await page.evaluate(async ({encounter, brewUrl}) => {
		const g = globalThis as typeof globalThis & {
			BrewUtil2: {pAddBrewFromUrl: (url: string) => Promise<unknown>},
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		const load = async (url: string) => (await (await fetch(url)).json()).monster as {name: string, source: string, hp: {average: number}}[];
		const needsBrew = encounter.creatures.some(it => it.book === "brew");
		// Homebrew monsters render through the installed brew, as they would for a DM who loaded it.
		if (needsBrew) await g.BrewUtil2.pAddBrewFromUrl(brewUrl);
		const books = {
			mm: await load("data/bestiary/bestiary-mm.json"),
			xmm: await load("data/bestiary/bestiary-xmm.json"),
			brew: needsBrew ? await load(brewUrl) : [],
		};
		const instances = encounter.creatures.map((it, ix) => {
			const monster = books[it.book].find(mon => mon.name === it.name);
			if (!monster) throw new Error(`${it.book} has no ${it.name}`);
			return {
				id: it.id,
				hash: `${it.name.toLowerCase()}_${monster.source.toLowerCase()}`,
				monster,
				conditions: [],
				areaNotes: [],
				modifiers: [],
				statblockOperations: [],
				hp: {current: monster.hp.average, max: monster.hp.average, temp: 0},
				initiative: 30 - ix,
			};
		});
		const state = {
			version: 4,
			sourceList: {name: encounter.title, saveId: `sweep-${encounter.title}`},
			instances,
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
		};
		await g.StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	}, {encounter, brewUrl: BREW_URL});
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

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const fk = (page: Page, key: string) => page.locator(`[data-ewc-fk="${key}"]`);
const sb = (page: Page) => page.locator(".ewc-sb");

type Hp = {current: number, max: number};
const getHp = (page: Page, id: string) => page.evaluate(id => {
	const api = (globalThis as typeof globalThis & {ewCockpit: {getState: () => {instances: {id: string, hp: Hp}[]}}}).ewCockpit;
	const {hp} = api.getState().instances.find(it => it.id === id)!;
	return {current: hp.current, max: hp.max};
}, id);

const view = async (page: Page, id: string) => {
	await row(page, id).locator(".ewc-row__ac").click();
	await expect(row(page, id)).toHaveClass(/is-viewed/);
	await page.mouse.move(640, 4);
};

const closeHovers = async (page: Page) => {
	await page.mouse.move(640, 4);
	const open = page.locator(".ve-hwin:visible");
	for (let ix = 0; ix < 5 && await open.count(); ix++) await open.last().locator('[title="Close (CTRL to Close All)"]').click();
	await expect(open).toHaveCount(0);
};

const nativeRolls = (page: Page) => page.locator(".out-roll-item").count();

/** The statblock, its dice, a hover and its trackers for one creature. */
const checkStatblock = async (page: Page, creature: SweepCreature) => {
	const block = sb(page);
	await expect(block.locator("table.ve-stats")).toBeVisible();
	await expect(block).toContainText(creature.name);
	await expect(page.locator(".ewc-error")).toHaveCount(0);

	for (const tracker of Object.keys(TRACKER_SELECTORS) as Tracker[]) {
		const trackers = block.locator(TRACKER_SELECTORS[tracker]);
		if (creature.trackers.includes(tracker)) await expect(trackers.first(), `${creature.id} ${tracker} tracker`).toBeVisible();
		else if (tracker !== "uses") await expect(trackers, `${creature.id} has no ${tracker} tracker`).toHaveCount(0);
	}

	// A d20 from the statblock (ability score, save, skill or attack) rolls into the feed.
	const feedCards = page.locator("[data-ewc-feed-card]");
	const rollsBefore = await nativeRolls(page);
	await block.locator('[data-packed-dice*="\\"d20\\""]').first().click();
	await expect(feedCards).toHaveCount(1);
	await expect(feedCards.first()).toContainText(creature.name);
	await expect(feedCards.first().locator(".ewc-feed__n")).toHaveText(/^-?\d+/);

	// A damage die rolls into a damage card, never the native roller.
	const damageDie = block.locator('[data-packed-dice*="\\"damage\\""]').first();
	if (await damageDie.count()) {
		await damageDie.click();
		await expect(feedCards).toHaveCount(2);
		await expect(feedCards.first()).toHaveClass(/ewc-feed__card--dmg/);
		await expect(feedCards.first().locator("[data-ewc-feed-apply]")).toBeVisible();
	}
	expect(await nativeRolls(page), `${creature.id} native roller`).toBe(rollsBefore);
	// Clear (not just close) so the next creature starts from an empty feed.
	await page.locator("[data-ewc-feed-clear]").click();
	await expect(page.locator("[data-ewc-feed]")).toBeHidden();

	if (creature.hover) {
		const link = block.locator(`a[href^="${creature.hover}.html"]`).first();
		await link.scrollIntoViewIfNeeded();
		await link.hover();
		await expect(page.locator(".ve-hwin:visible").first(), `${creature.id} ${creature.hover} hover`).toBeVisible();
		await closeHovers(page);
	}
};

const pickDamageType = async (page: Page, type: string) => {
	const chip = page.locator(`.ewc-dt[data-ewc-dt="${type}"]`);
	if (!await chip.isVisible()) await page.locator(".ewc-dt__more").click();
	if (await chip.getAttribute("aria-pressed") !== "true") await chip.click();
	await expect(chip).toHaveAttribute("aria-pressed", "true");
};

/** Typed damage from the dock HP tab against the viewed creature. */
const checkTypedDamage = async (page: Page, creature: SweepCreature) => {
	const amount = page.locator("#ewc-hp-amt");
	if (!await amount.isVisible()) {
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press("h");
	}
	const {current} = await getHp(page, creature.id);
	await amount.fill(`${creature.damage.amount}`);
	await pickDamageType(page, creature.damage.type);
	await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
	if (creature.damage.review) {
		const review = page.locator(".ewc-review");
		await expect(review, `${creature.id} asks about its conditional defense`).toBeVisible();
		expect((await getHp(page, creature.id)).current, "nothing applied before the review is answered").toBe(current);
		const selects = review.locator("select");
		for (let ix = 0; ix < await selects.count(); ix++) await selects.nth(ix).selectOption(creature.damage.review);
		await fk(page, "rv-apply").click();
	}
	await expect(page.locator(".ewc-review"), `${creature.id} has no open defense review`).toHaveCount(0);
	await expect(amount).toHaveValue("");
	await expect.poll(async () => current - (await getHp(page, creature.id)).current, {message: `${creature.id} ${creature.damage.type} loss`})
		.toBe(creature.damage.loss);
};

const selectAll = async (page: Page, encounter: SweepEncounter) => {
	for (const {id} of encounter.creatures) await row(page, id).locator(".ewc-row__chk input").check();
	await expect(page.locator(".ewc-dock__target")).toContainText(`Selected ${encounter.creatures.length}`);
};

/** Elite then Weak on every creature at once; each doubles / halves the listed HP and is fully removable. */
const checkTiers = async (page: Page, encounter: SweepEncounter, baseMax: Map<string, number>) => {
	for (const [key, scale] of [["elite", 2], ["weak", 0.5]] as const) {
		await fk(page, `tpl-${key}`).click();
		await fk(page, "tpl-preview").click();
		await expect(fk(page, "tpl-apply")).toHaveText(new RegExp(`${encounter.creatures.length} creatures`));
		await fk(page, "tpl-apply").click();
		await expect(fk(page, `tpl-rm-${key}`)).toBeVisible();
		for (const {id} of encounter.creatures) {
			await expect.poll(async () => (await getHp(page, id)).max, {message: `${id} ${key} max HP`})
				.toBe(Math.max(1, Math.floor(baseMax.get(id)! * scale)));
		}
		await fk(page, `tpl-rm-${key}`).click();
		await expect(fk(page, `tpl-rm-${key}`)).toHaveCount(0);
		for (const {id} of encounter.creatures) await expect.poll(async () => (await getHp(page, id)).max).toBe(baseMax.get(id));
	}
};

const UNDEAD_RECIPE = "catalog:undead|scre";

const statblockOps = (page: Page) => page.evaluate(() => {
	const api = (globalThis as typeof globalThis & {ewCockpit: {getState: () => {instances: {id: string, statblockOperations?: unknown[]}[]}}}).ewCockpit;
	return api.getState().instances.map(it => [it.id, (it.statblockOperations || []).length]);
});

/**
 * Undead (SCRE) previewed on every real creature. Under automation v2 each target is skipped until the DM answers its
 * own source questions; the preview must still account for every creature, offer a review per skipped one, and save
 * nothing.
 */
const checkTransformPreview = async (page: Page, encounter: SweepEncounter) => {
	const editor = new CreatureTransformationPage(page);
	const count = encounter.creatures.length;
	const before = await statblockOps(page);
	await editor.choose(UNDEAD_RECIPE);
	await editor.chooseOption("Undead category", encounter.undeadCategory);
	const summary = editor.root.locator(".bqa__transformation-summary").filter({hasText: /\d+ eligible/});
	await expect(summary).toHaveCount(1);
	const [, eligible, skipped] = (await summary.innerText()).match(/(\d+) eligible · (\d+) skipped/)!.map(Number);
	console.log(`[sweep] ${encounter.title} · Undead (${encounter.undeadCategory}): ${eligible} eligible · ${skipped} skipped`);
	expect(eligible + skipped).toBe(count);
	await expect(editor.root.getByRole("button", {name: /^Review answers for /})).toHaveCount(skipped);
	// Skipped creatures are named in the summary; eligible ones each get a preview card beside it.
	const cards = summary.locator("xpath=..").locator(".bqa__transformation-target > h5");
	await expect(cards).toHaveCount(eligible);
	const accounted = `${await summary.innerText()}\n${(await cards.allInnerTexts()).join("\n")}`;
	for (const {name} of encounter.creatures) expect(accounted).toContain(name);
	expect(await statblockOps(page)).toEqual(before);
};

test.describe("Encounter cockpit real-data sweep (?ew=2)", () => {
	test.describe.configure({mode: "parallel"});

	for (const encounter of ENCOUNTERS) {
		test(`${encounter.title}: ${encounter.creatures.map(it => it.name).join(", ")}`, async ({page}) => {
			test.setTimeout(180_000);
			const errors = trackConsoleErrors(page);
			await page.setViewportSize({width: 1440, height: 900});
			await seed(page, encounter);
			await page.goto("/encounterworkspace.html?ew=2");
			await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
			await expect(page.locator(".ewc-row")).toHaveCount(encounter.creatures.length);

			const baseMax = new Map<string, number>();
			for (const creature of encounter.creatures) {
				await test.step(`${creature.name} (${creature.book.toUpperCase()})`, async () => {
					await view(page, creature.id);
					baseMax.set(creature.id, (await getHp(page, creature.id)).max);
					await checkStatblock(page, creature);
					await checkTypedDamage(page, creature);
				});
			}

			await test.step("Elite and Weak on every creature", async () => {
				await selectAll(page, encounter);
				await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
				await page.keyboard.press("q");
				await expect(page.locator(".ewc-prep")).toBeVisible();
				await fk(page, "cre-sub-tpl").click();
				await fk(page, "prep-scope-selected").click();
				await expect(fk(page, "prep-scope-selected")).toHaveAttribute("aria-checked", "true");
				await checkTiers(page, encounter, baseMax);
			});

			await test.step(`Undead (${encounter.undeadCategory}) previewed on every creature`, () => checkTransformPreview(page, encounter));

			expect(errors).toEqual([]);
		});
	}

	test("Zombie (DMG) applies to a fully answered MM Bugbear and leaves its neighbour alone", async ({page}) => {
		test.setTimeout(120_000);
		const errors = trackConsoleErrors(page);
		const encounter: SweepEncounter = {
			title: "Zombie apply",
			undeadCategory: "zombie",
			creatures: [
				{id: "bugbear", book: "mm", name: "Bugbear", damage: {type: "slashing", amount: 1, loss: 1}, trackers: [], hover: null},
				{id: "cat", book: "mm", name: "Cat", damage: {type: "slashing", amount: 1, loss: 1}, trackers: [], hover: null},
			],
		};
		await page.setViewportSize({width: 1440, height: 900});
		await seed(page, encounter);
		await page.goto("/encounterworkspace.html?ew=2");
		await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
		await view(page, "bugbear");
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press("q");
		await fk(page, "cre-sub-tpl").click();
		await expect(fk(page, "prep-scope-viewed")).toHaveAttribute("aria-checked", "true");

		const editor = new Round72CreatureTransformationPage(page);
		await editor.choose("catalog:zombie|dmg");
		await editor.fillRound72Bugbear();
		const apply = editor.root.getByRole("button", {name: /^(Apply transformation|Apply to \d+ · one save)$/});
		const confirmation = editor.root.getByRole("group", {name: "Confirm before applying"});
		const consequences = editor.root.getByRole("region", {name: "Encounter consequences to review"});
		for (let attempt = 0; attempt < 3 && !(await statblockOps(page)).some(([id, n]) => id === "bugbear" && n); attempt++) {
			if (await confirmation.isVisible()) await editor.confirmPrerequisites();
			if (await consequences.isVisible()) for (const box of await consequences.getByRole("checkbox").all()) await box.check();
			if (await apply.isVisible()) await apply.click();
			await page.waitForTimeout(250);
		}

		await expect.poll(() => statblockOps(page)).toEqual([["bugbear", 1], ["cat", 0]]);
		await expect.poll(async () => (await getHp(page, "bugbear")).max).toBe(32);
		await page.keyboard.press("Escape");
		await view(page, "bugbear");
		await expect(sb(page)).toContainText(/undead/i);
		await expect(sb(page)).toContainText("Undead Fortitude");
		await view(page, "cat");
		await expect(sb(page)).not.toContainText("Undead Fortitude");
		expect(errors).toEqual([]);
	});
});
