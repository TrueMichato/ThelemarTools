import {expect, test, type Page} from "@playwright/test";

/*
 * Restored A6 mockup features on the cockpit's rail rows and battlefield (encounterworkspace.html?ew=2), on real
 * Monster Manual data plus one party member:
 *   D9  row quick actions HP · Save · Cond · Fx · ⋯             D10 row ⋯ menu (console, concentration, move, …)
 *   D11 party class line                                        D12 effect pill caster ↗
 *   D13 ◐ Blinded from darkness (row + statblock)               D14 console live-preview badge on targeted rows
 *   D15 compact one-line death saves                            D17 Lair actions row at initiative 20 (loses ties)
 *   D18 "+ Add ⇧A" in the rail head, no rail footer             D19 last row not covered by the order hint
 *   D28 BATTLEFIELD strip above the statblock (+ Battlefield, note)  D29 habitat traits by environment, rule hover
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
		const {applyEncounterEffect} = await import("/js/encounterworkspace/encounterworkspace-fx.js");
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
		const brenna = createEncounterPartyInstance({id: "brenna", name: "Brenna", ac: 16, hpMax: 24, hpCurrent: 0, initiative: 16, classLine: "Rogue 5"});
		Object.assign(brenna, {deathSaveMode: "on", deathSaves: {successes: 1, failures: 1, stable: false, dead: false}});
		let state = EncounterWorkspaceState.validate({
			version: 8,
			sourceList: {name: "Cragmaw Hideout", saveId: "cockpit-rail-restore"},
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
		applyEncounterEffect(state, {targetIds: ["gob-2"], def: "bless", casterId: "mage", fnUid: () => "bless-1"});
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

test.describe("Encounter cockpit restored rail rows and battlefield (?ew=2)", () => {
	test("R1 rows: quick actions, ⋯ menu, class line, caster ↗, compact death saves, rail-head add, last row clear", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);

		// D9 — the row's quick actions on hover/view: one HP action (damage and heal live in its tab), no ›_ — the
		// console moved into ⋯.
		await view(page, "owlbear");
		const qa = row(page, "owlbear").locator(".ewc-row__qa .ewc-qa");
		await row(page, "owlbear").hover();
		await expect(qa.filter({hasNotText: /^⋯$/})).toHaveText(["HP", "Save", "Cond", "Fx"]);
		await expect(row(page, "owlbear").locator('[data-ewc-qa="more"]')).toBeVisible();
		await expect(row(page, "owlbear").locator('[data-ewc-qa="damage"], [data-ewc-qa="heal"], [data-ewc-qa="console"]')).toHaveCount(0);
		// The same set persists on the viewed row once the pointer leaves.
		await page.mouse.move(640, 4);
		await expect(qa.filter({hasNotText: /^⋯$/})).toHaveText(["HP", "Save", "Cond", "Fx"]);
		// HP opens the dock's HP tab on that creature, with both Damage and Heal at hand.
		await row(page, "gob-1").hover();
		await row(page, "gob-1").locator('[data-ewc-qa="hp"]').click();
		await expect(row(page, "gob-1")).toHaveClass(/is-viewed/);
		await expect(fk(page, "tab-hp")).toHaveAttribute("aria-selected", "true");
		await expect(page.locator(".ewc-dock__target b")).toHaveText("Goblin 1");
		await expect(fk(page, "hp-damage")).toBeVisible();
		await expect(fk(page, "hp-heal")).toBeVisible();
		await view(page, "owlbear");
		await row(page, "owlbear").hover();
		// …and never sit on top of the effect tally (Goblin 2 carries Bless).
		await row(page, "gob-2").hover();
		const tallyBox = (await fk(page, "tally-gob-2").boundingBox())!;
		for (const box of await row(page, "gob-2").locator(".ewc-row__qa .ewc-qa").evaluateAll(els => els.filter(it => it.getClientRects().length).map(it => it.getBoundingClientRect().toJSON()))) {
			const isOverlap = box.left < tallyBox.x + tallyBox.width && tallyBox.x < box.right && box.top < tallyBox.y + tallyBox.height && tallyBox.y < box.bottom;
			expect(isOverlap, `quick action at ${box.left},${box.top} covers the tally`).toBe(false);
		}

		// D10 — ⋯ opens a menu: Console… / Mark concentration / Move before / Assess CR / Edit statblock (I).
		await row(page, "owlbear").locator('[data-ewc-qa="more"]').click();
		const menu = page.locator(".ewc-rowmenu");
		await expect(menu).toBeVisible();
		await expect(row(page, "owlbear")).toHaveClass(/is-menu-open/);
		await expect(menu.locator(".ewc-rowmenu__i")).toHaveText([/Console…/, /Mark concentration/, /Move before/, /Assess CR/, /Edit statblock/]);
		await menu.locator('[data-ewc-rowmenu="conc"]').click();
		await menu.locator('[data-ewc-rowmenu="conc-input"]').fill("Fly");
		await menu.locator('[data-ewc-rowmenu="conc-input"]').press("Enter");
		await expect(menu).toBeHidden();
		await expect.poll(async () => (await getState(page)).instances.find((it: {id: string}) => it.id === "owlbear").resources.concentration).toMatchObject({active: true, label: "Fly"});

		await row(page, "owlbear").hover();
		await row(page, "owlbear").locator('[data-ewc-qa="more"]').click();
		await menu.locator('[data-ewc-rowmenu="move"]').click();
		await expect(menu.locator(".ewc-rowmenu__back")).toBeVisible();
		await menu.locator('[data-ewc-rowmenu="before-gob-1"]').click();
		await expect.poll(() => page.locator(".ewc-row").evaluateAll(rows => rows.map(it => (it as HTMLElement).dataset.ewcId))).toEqual(["owlbear", "gob-1", "brenna", "mage", "gob-2"]);

		await row(page, "mage").hover();
		await row(page, "mage").locator('[data-ewc-qa="more"]').click();
		await menu.locator('[data-ewc-rowmenu="assess"]').click();
		await expect(row(page, "mage")).toHaveClass(/is-viewed/);
		await expect(fk(page, "ptab-creature")).toHaveAttribute("aria-selected", "true");
		await expect(fk(page, "cre-sub-cr")).toHaveAttribute("aria-checked", "true");

		await row(page, "mage").hover();
		await row(page, "mage").locator('[data-ewc-qa="more"]').click();
		await menu.locator('[data-ewc-rowmenu="edit"]').click();
		await expect(page.locator(".ve-ui-modal__inner").first()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".ve-ui-modal__inner")).toHaveCount(0);

		// D11 — a PC shows its class line, not "Party".
		await expect(row(page, "brenna").locator(".ewc-row__cls")).toHaveText("Rogue 5");

		// D12 — the Bless pill on Goblin 2 links to its caster: in the effect-tally list, and on the viewed row's pill.
		await view(page, "owlbear");
		await fk(page, "tally-gob-2").click();
		const tallyCaster = page.locator('.ewc-tc [data-ewc-caster="mage"]').first();
		await expect(tallyCaster).toHaveText("↗");
		await tallyCaster.click();
		await expect(row(page, "mage")).toHaveClass(/is-viewed/);
		await view(page, "gob-2");
		const caster = row(page, "gob-2").locator('.ewc-pill--fx [data-ewc-caster="mage"]');
		await expect(caster).toHaveText("↗");
		await caster.click();
		await expect(row(page, "mage")).toHaveClass(/is-viewed/);

		// D15 — death saves on one compact line: pips, Roll, Stable; no "Death saves" heading.
		const ds = row(page, "brenna").locator('[data-ewc-flow="deathsaves"]');
		await expect(ds).toBeVisible();
		await expect(ds.locator(".ewc-ds__head")).toHaveCount(0);
		await expect(ds.locator('[data-ewc-flow="ds-roll"]')).toHaveText("Roll");
		await expect(ds.locator('[data-ewc-flow="ds-stable"]')).toHaveText("Stable");
		expect((await ds.boundingBox())!.height).toBeLessThanOrEqual(30);
		await ds.locator('[data-ewc-flow="ds-roll"]').click();
		await expect(toasts(page)).toContainText("Brenna death save:");

		// D28 — with no battlefield rules the stage strip is a single quiet line (label, "+ Battlefield", note) above the statblock.
		const emptyStrip = page.locator(".ewc-stage__top [data-ewc-rbf='section']");
		await expect(emptyStrip).toBeVisible();
		expect((await emptyStrip.boundingBox())!.height, "empty battlefield strip is one line").toBeLessThanOrEqual(48);

		// D18 — "+ Add" sits in the rail head beside Group…, on the same line; there is no rail footer. ⇧A does the same.
		const add = page.locator('[data-ewc-act="rail-add"]');
		await expect(add).toContainText("Add");
		await expect(add.locator(".ewc-kbd"), "+ Add shows its ⇧A hint").toBeVisible();
		await expect(page.locator(".ewc-rail__head [data-ewc-act='rail-add']")).toHaveCount(1);
		await expect(page.locator(".ewc-rail__foot")).toHaveCount(0);
		const addBox = (await add.boundingBox())!;
		const grpBox = (await page.locator(".ewc-rail__head .ewc-grpbtn").boundingBox())!;
		expect(Math.abs(addBox.y - grpBox.y)).toBeLessThanOrEqual(2);
		expect(addBox.x + addBox.width).toBeLessThanOrEqual(grpBox.x);
		await add.click();
		await expect(page.locator("dialog.ewc-add")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator("dialog.ewc-add")).toBeHidden();
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("Shift+A");
		await expect(page.locator("dialog.ewc-add")).toBeVisible();
		await page.keyboard.press("Escape");

		// The rail head is one toolbar line — view switch left, Add/Group… cluster right — folding words into icons as the
		// rail narrows (key chips and accessible names stay); too narrow for one line it stacks into two full-width bars.
		const views = page.locator(".ewc-rail__head .ewc-rail__views");
		const tools = page.locator(".ewc-rail__head .ewc-rail__tools");
		for (const [width, layout] of [[1280, "line"], [1180, "line"], [900, "stack"]] as const) {
			await page.setViewportSize({width, height: 800});
			const v = (await views.boundingBox())!;
			const t = (await tools.boundingBox())!;
			if (layout === "line") {
				expect(Math.abs((v.y + v.height / 2) - (t.y + t.height / 2)), `switch and actions share a line at ${width}`).toBeLessThanOrEqual(2);
				expect(v.x + v.width, `switch and actions don't overlap at ${width}`).toBeLessThanOrEqual(t.x);
			} else {
				expect(t.y, `actions stack under the switch at ${width}`).toBeGreaterThanOrEqual(v.y + v.height);
				expect(Math.abs(t.width - v.width), `stacked bars are equally wide at ${width}`).toBeLessThanOrEqual(1);
			}
			await expect(add.locator(".ewc-kbd")).toBeVisible();
			await expect(page.locator(".ewc-rail__head .ewc-grpbtn .ewc-kbd")).toBeVisible();
			await expect(add).toHaveAccessibleName(/Add/);
			await expect(page.locator(".ewc-rail__head .ewc-grpbtn")).toHaveAccessibleName(/Group/);
		}

		// D19 — scrolled to the end, nothing (order hint) sits on top of the last row; the head never squeezes the list
		// below one row.
		for (const size of [{width: 1280, height: 800}, {width: 900, height: 560}]) {
			await page.setViewportSize(size);
			const last = page.locator(".ewc-row").last();
			await page.locator(".ewc-rail__list").evaluate(ele => { ele.scrollTop = ele.scrollHeight; });
			await last.scrollIntoViewIfNeeded();
			// At the short size the list must actually scroll, or "the end" says nothing.
			if (size.height < 600) expect(await page.locator(".ewc-rail__list").evaluate(ele => ele.scrollHeight > ele.clientHeight)).toBe(true);
			const listH = (await page.locator(".ewc-rail__list").boundingBox())!.height;
			expect(listH, `rail list shorter than a row at ${size.width}×${size.height}`).toBeGreaterThanOrEqual((await last.boundingBox())!.height);
			const isClear = await last.evaluate(ele => {
				const r = ele.getBoundingClientRect();
				return [0.25, 0.5, 0.75].every(fx => document.elementFromPoint(r.left + r.width * fx, r.bottom - 3)?.closest(".ewc-row") === ele);
			});
			expect(isClear, `last row covered at ${size.width}×${size.height}`).toBe(true);
		}

		expect(errors).toEqual([]);
	});

	test("R2 battlefield: stage strip, note, darkness ◐ Blinded, lair row at 20 losing ties, console preview badge", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page, {lair: true, darkness: true});
		await openCockpit(page);

		// D28 — the BATTLEFIELD strip sits in the stage column above the statblock (not in the rail), with chips,
		// "+ Battlefield" and a note.
		const section = rbf(page, "section");
		await expect(section).toBeVisible();
		await expect(page.locator(".ewc-stage__top [data-ewc-rbf='section']")).toHaveCount(1);
		await expect(page.locator(".ewc-rail [data-ewc-rbf]")).toHaveCount(0);
		const sectionBox = (await section.boundingBox())!;
		expect(sectionBox.y + sectionBox.height).toBeLessThanOrEqual((await page.locator(".ewc-stage__head").boundingBox())!.y + 1);
		expect(sectionBox.height, "two rules and a note wrap to at most two compact lines at 1280 wide").toBeLessThanOrEqual(80);
		await expect(section.locator(".ewc-prep-strip__chip[data-ewc-bf]")).toHaveCount(2);
		await expect(section.locator('.ewc-prep-strip__chip.is-lair[data-ewc-bf="bf-lair"]')).toContainText("init 20");
		await rbf(page, "add").click();
		await expect(fk(page, "ptab-area")).toHaveAttribute("aria-selected", "true");

		await expect(rbf(page, "note")).toHaveText("Add a note…");
		await rbf(page, "note").click();
		await rbf(page, "note-input").fill("Cave mouth, rubble everywhere");
		await rbf(page, "note-input").press("Enter");
		await expect(toasts(page)).toContainText("Encounter note saved.");
		await expect(rbf(page, "note")).toHaveText("Cave mouth, rubble everywhere");
		await rbf(page, "note").click();
		await rbf(page, "note-input").fill("discard me");
		await rbf(page, "note-input").press("Escape");
		await expect(rbf(page, "note")).toHaveText("Cave mouth, rubble everywhere");
		expect((await getState(page)).encounterNote).toBe("Cave mouth, rubble everywhere");

		// D13 — darkness blinds the Mage (no darkvision) but not the goblins (darkvision 60 ft.).
		const blind = row(page, "mage").locator('.ewc-pill--blind[data-ewc-sight="blinded"]');
		await expect(blind).toContainText("◐");
		await expect(blind).toContainText("Blinded");
		await expect(row(page, "gob-1").locator(".ewc-pill--blind")).toHaveCount(0);
		await view(page, "mage");
		await expect(page.locator('.ewc-sb tr.ewc-sight-sb[data-ewc-sight="blinded"]')).toContainText("Darkness");
		await view(page, "gob-1");
		await expect(page.locator('.ewc-sb tr.ewc-sight-sb[data-ewc-sight="dim"]')).toContainText("Lightly obscured");

		// D17 — the lair row sits at initiative 20, after the goblin that also rolled 20 (lair loses ties).
		const lairRow = page.locator('li.ewc-lairrow[data-ewc-lair="bf-lair"]');
		await expect(lairRow.locator(".ewc-lairrow__init")).toHaveText("20");
		await expect(lairRow.locator(".ewc-lairrow__name")).toContainText("Lair actions");
		const listOrder = () => page.locator(".ewc-rail__list > li").evaluateAll(lis => lis.map(it => (it as HTMLElement).dataset.ewcId || (it.classList.contains("ewc-lairrow") ? "lair" : "?")));
		expect(await listOrder()).toEqual(["gob-1", "lair", "brenna", "mage", "owlbear", "gob-2"]);
		// The Groups view lists creatures by group, not by turn: no lair row there; it returns with Initiative.
		await fk(page, "rail-view-groups").click();
		await expect(page.locator(".ewc-rail__list--groups")).toBeVisible();
		await expect(lairRow).toHaveCount(0);
		await fk(page, "rail-view-init").click();
		await expect(lairRow).toHaveCount(1);
		expect(await listOrder()).toEqual(["gob-1", "lair", "brenna", "mage", "owlbear", "gob-2"]);
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("n");
		await expect(row(page, "gob-1")).toHaveClass(/is-turn/);
		await expect(toasts(page)).not.toContainText("Lair actions");
		await page.keyboard.press("n");
		await expect(row(page, "brenna")).toHaveClass(/is-turn/);
		await expect(toasts(page)).toContainText("Lair actions — initiative 20 (loses ties) came up before this turn.");

		// D14 — the console previews its effect on each targeted row, and the badges go when it closes.
		await page.keyboard.press("/");
		const input = page.locator("[data-ewc-console-in]");
		await expect(input).toBeFocused();
		await input.fill("7 @owlbear");
		const pv = row(page, "owlbear").locator("[data-ewc-console-rowpv]");
		await expect(pv).toHaveText(/^−7 → \d+/);
		await expect(pv).toHaveClass(/is-dmg/);
		await expect(row(page, "mage").locator("[data-ewc-console-rowpv]")).toHaveCount(0);
		await input.press("Escape");
		await expect(page.locator("[data-ewc-console-rowpv]")).toHaveCount(0);

		// D28 — the note survives a reload.
		await page.reload();
		await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
		await expect(rbf(page, "note")).toHaveText("Cave mouth, rubble everywhere");

		expect(errors).toEqual([]);
	});

	test("R3 prep: habitat traits by environment apply to the statblock; battlefield rules hover", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await openCockpit(page);
		await page.evaluate(async () => {
			const {BestiaryQuickActionsUi} = await import("/js/bestiary/bestiary-quick-actions-ui.js");
			BestiaryQuickActionsUi._cache.areaTraits = [
				{name: "Rockbreaker", source: "FleeMortals", _areaName: "Cave", entries: ["The creature gains a burrowing speed."]},
				{name: "Shadow Blend", source: "FleeMortals", _areaName: "Cave", entries: ["The creature can hide in dim light."]},
				{name: "Snow Walker", source: "FleeMortals", _areaName: "Arctic", entries: ["The creature ignores difficult terrain made of snow."]},
			];
		});

		// D29 — the catalogue, grouped by environment.
		await view(page, "owlbear");
		await page.locator('[data-ewc-act="prep-toggle"]').click();
		await fk(page, "ptab-creature").click();
		await fk(page, "cre-sub-traits").click();
		const cat = page.locator('[data-ewc-traits="catalogue"]');
		await expect(cat.locator(".ewc-prep__traitarea")).toHaveText(["Arctic", "Cave"]);
		await expect(cat.locator(".ewc-prep__traitg").nth(1).locator("[data-ewc-trait]")).toHaveText(["Rockbreaker", "Shadow Blend"]);
		const rock = cat.locator("[data-ewc-trait]").filter({hasText: "Rockbreaker"});
		await rock.click();
		await expect(rock).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("[data-ewc-trait-preview]")).toContainText("Rockbreaker");
		await fk(page, "trait-apply").click();
		await expect(toasts(page)).toContainText("Rockbreaker →");
		await expect(rock).toContainText("✓");
		await expect.poll(async () => (await getState(page)).instances.find((it: {id: string}) => it.id === "owlbear").statblockOperations.map((it: {type: string}) => it.type)).toContain("applyAreaTrait");

		// D29 — battlefield rules (incl. hazards & weather) show their rules text on hover.
		await fk(page, "ptab-area").click();
		const rule = page.locator(".ewc-prep__rule").filter({hasText: /^Darkness$/}).first();
		await rule.hover();
		await expect(page.locator(".ve-hwin").last()).toContainText("Heavily obscured");

		expect(errors).toEqual([]);
	});
});
