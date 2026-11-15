import {expect, test, type Page} from "@playwright/test";

/*
 * Parity between the approved A6 "Lantern Cockpit" mockup and the real cockpit (encounterworkspace.html?ew=2).
 *
 * The mockup was verified by a 78-step Playwright script (session files/verify-a6.cjs). Each step is mapped below to
 * where the real site proves the same behaviour, to a test in this file, or to N/A with the reason. Abbreviations:
 *   SHELL  encounter-cockpit-shell.spec.ts › "drives a real saved encounter end-to-end with zero console errors"
 *   ACT    encounter-cockpit-act.spec.ts   › "roll tab, tray, fx, builder, console and row entry point on real data"
 *   SHOTS  encounter-cockpit-act.spec.ts   › "screenshots: day and night, wide and narrow"
 *   PREP   encounter-cockpit-prep.spec.ts  › "Q toggles prep; creature, effects, battlefield and items tools …"
 *   ADD    encounter-cockpit-prep.spec.ts  › "Shift+A adds real bestiary creatures into their group, and party members"
 *   FLOW   encounter-cockpit-flow.spec.ts  › "timeline, log drawer, groups and turn-order moves"
 *   DS     encounter-cockpit-flow.spec.ts  › "death saves, concentration checks and end combat"
 *   SWEEP  encounter-cockpit-sweep.spec.ts › the four 30-monster encounters (+ "Zombie (DMG) applies …")
 *   P1/P2/P3  the tests in this file (rail & turns / statblock roll feed / templates, effects & battlefield)
 *
 * | verify-a6 step                                                          | Real site                                                                 |
 * |-------------------------------------------------------------------------|---------------------------------------------------------------------------|
 * |  43 load: no errors, no overflow, roster                                | SHELL (rows, 0 errors) + P1 (no overflow). "A6" title/feedback widget: N/A, mockup chrome |
 * |  52 §7 legend → checkbox select, legend hides                           | P1                                                                        |
 * |  68 §7 Ctrl-click toggles, Shift-click range, name click views          | P1 (+ SHELL name-click views)                                             |
 * |  85 §1 statblock damage roll → tray card → Apply to selection           | P2 (+ SWEEP: dice route to the feed for 30 monsters)                      |
 * | 108 §1 tray ½ / ×2 / → Viewed / attack + save cards / more              | P2. Save cards: ACT (Roll tab → tray)                                     |
 * | 142 Kept·A tray "Stage in console"                                      | P2                                                                        |
 * | 153 §2 caster chip ◉ Conc · Bless, target pills, click → view caster    | DS (conc chip, Con save) + P3 (◉ chip from console). Pill → caster jump: N/A, real pills open the native effect hover |
 * | 167 §2 statblock concentration strip; Held-by link                      | DS (concentration strip). Held-by link: N/A, not part of the real cockpit |
 * | 184 §2 Drop concentration removes linked effects (+undo)                | ACT (switching concentration ends Bless everywhere) + DS (conc-drop)      |
 * | 195 Kept·A header concentration Drop                                    | DS (conc strip Drop) + P3 (console `drop`)                                |
 * | 205 §3 prep toggle: label, aria-pressed, banner, 5 tabs                 | PREP + P3 (Q key hint on the toggle)                                      |
 * | 217 §3 prep Quick edit (AC ±) with preview                              | PREP                                                                      |
 * | 231 §3 prep Templates: Elite → HP×2, AC+2                               | PREP (HP×2) + SWEEP (Elite/Weak HP on 30 monsters) + P3 (AC +2)           |
 * | 251 §3 Legendary adds resources; Lair adds init-20 row                  | PREP (legendary). Lair is a Battlefield rule, not a template: PREP lists it |
 * | 264 §3 Area: half cover → AC +2 & strip chip                            | ACT (half cover via Fx, +2 in the roll breakdown) + PREP (strip chip)     |
 * | 285 Kept·A area note edits (prep + strip)                               | PREP (strip chip Edit/End)                                                |
 * | 297 §3 Add tab +1 Goblin joins group; Effects durations; exit           | ADD + PREP                                                                |
 * | 317 §5 Groups: Roll once → equal init + adjacent                        | P1                                                                        |
 * | 331 §5 Stack group → one row ×N                                         | N/A: real groups are a chip + shared turn (FLOW), no stacked row          |
 * | 356 §5 group popover "Same initiative" + auto-group on add              | FLOW (group-setinit) + ADD (adds join their group)                        |
 * | 370 §6 rail quick actions never overlap name/HP/pills                   | ACT (hover ›_ keeps row height) + SHOTS + P1 (no overflow). FIXME test: the hover quick actions cover the effect tally (shell bug) |
 * | 389 §8 statblock centred, max-width ≤ ~760                              | SHOTS (visual). Exact mockup geometry: N/A                                |
 * | 398 §9 death-save pips; 3 fails → Dead; undo; 3 successes → Stable      | DS                                                                        |
 * | 424 §10 key labels ⇧ ?, Ctrl Z / ⌘Z                                     | SHELL (Shift+? sheet) + FLOW (Esc key hint on chip)                       |
 * | 439 §11 log header: no overflow, filters wrap                           | FLOW                                                                      |
 * | 451 §4 difficulty badge → XP popover                                    | P1 (badge XP drops for the defeated, back on revive). Popover: N/A, the real badge explains itself in its title |
 * | 458 §4 ⋯ menu → Show the how-to hint                                    | N/A: no how-to hint in the real cockpit (P1 checks the ⋯ menu itself)     |
 * | 467 §4 add modal stepper & party add                                    | ADD                                                                       |
 * | 490 Kept·A defeated list + Revive                                       | P1 (0 HP → Defeated; healing revives)                                     |
 * | 500 Kept·A "Back to active" banner (Space)                              | P1                                                                        |
 * | 510 Kept·A resource pips (spell slots) clickable                        | SWEEP (slot/use/legendary/recharge trackers on 30 monsters)               |
 * | 519 Kept·A shortcut hints on new controls + hover on area chip          | PREP (strip chip hover) + P3 (Q hint)                                     |
 * | 530 typing in inputs never triggers shortcuts                           | SHELL ("nc" in the HP box) + P1 ("qlgt" in the console)                   |
 * | 550 A4 mark conc from statblock (autocomplete)                          | DS (conc strip). Autocomplete prompt: N/A, the real path is the console `conc` |
 * | 561 A4 row ⋯ → Mark concentration…; console conc / conc off             | P3 (console `conc fly` / `drop`). Row ⋯ prompt: N/A                       |
 * | 572 A4 damage → CON save on concentration; 0 HP drops it                | DS                                                                        |
 * | 581 A4 pill glyphs ▲ ▼ ⬡ + legend in ⇧?                                 | P3 (▲ pill, ✦ template in the tally card). Glyph legend in ⇧?: N/A, the tally card names each item |
 * | 595 A4 §2a in-place edit (I, Esc, Ctrl↵)                                | N/A: real edits use the one statblock editor (PREP Creature › Edit)        |
 * | 618 A4 §2b drawer Statblock tab "mixed"                                 | N/A: same reason as 595                                                   |
 * | 631 A4 §2c editor modal before/after, ⌘↵ saves                          | PREP (Creature › Edit opens the real editor)                              |
 * | 643 A4 bulk quick edit on multi-select; JSON validates                  | PREP (quick edit, invalid AC blocks Apply)                                |
 * | 655 A4 §3 Templates → creature types, eligibility, one-step apply       | SWEEP (transform preview on 30 monsters + Zombie apply on Bugbear)        |
 * | 678 A4 §4 Effects catalogue, preset, rounds, remove                     | ACT (Bless/Bane, durations) + PREP (effects tab)                          |
 * | 694 A4 §4 custom roll effect builder → affects a mass roll              | ACT (builder → Shield wall in the breakdown)                              |
 * | 710 A4 §5 darkness: no-darkvision creatures Blinded; dim for darkvision | P3 (Darkness → attack disadvantage without darkvision, none with it). Row/statblock "Blinded" badge: N/A, sight isn't surfaced on rows |
 * | 720 A4 §5 magical darkness / fog                                        | Rules: EncounterCockpitBattlefield Jest. UI: same path as 710 (P3)        |
 * | 728 A4 §5 area traits by environment → apply                            | N/A: illustrative mockup data, no such catalogue on the site              |
 * | 741 A4 §5 lair groups + magic item + add legendary action               | PREP (legendary action, items tab). Lair groups: N/A                      |
 * | 760 A4 §5 text-only area & lair reminders                               | PREP (battlefield strip)                                                  |
 * | 771 A4 §6 dock tabs H/R/C/E                                             | SHELL (C) + ACT (E) + P1 (H)                                              |
 * | 780 A4 §6 Skill: search skills, adv, per-creature rows                  | ACT (Roll tab) + P3 (console `check stealth adv`)                         |
 * | 794 A4 §6 Save DC + damage → Select those who failed                    | ACT                                                                       |
 * | 808 A4 §6 roll-time prompt before rolling                               | N/A: the real cockpit applies contributors without a pre-roll prompt      |
 * | 817 A4 §6 console roll/check/save                                       | ACT (save) + P3 (check)                                                   |
 * | 827 A4 §7 Areas "Applies to" never overflows                            | P1 (dock doesn't overflow) + SHOTS                                        |
 * | 835 A4 §8 saved-list import + DM Screen handoff                         | P1 (⋯ menu has the DM Screen entry); handoff behaviour is the handoff child's |
 * | 840 A4 §8 turns next/prev + Reset turns; roll init                      | SHELL (N/P) + P1 (Reset turns)                                            |
 * | 848 A4 §8 recharge auto-roll; recharge resource                         | SWEEP (recharge trackers). Auto-roll toggle: N/A, not in the real cockpit |
 * | 853 A4 §8 Move before… and Alt↑                                         | FLOW (Alt+↑ and drag). Row ⋯ "Move before…": N/A                          |
 * | 860 A4 §8 typed damage reviews conditional defences; heal/set/undo      | SWEEP (defence review) + P1 (heal / set / undo / redo)                    |
 * | 870 A4 §8 Assess CR                                                     | PREP                                                                      |
 * | 875 A4 §8 roster all/none/group/find/sort                               | FLOW (Esc clears, group chips). Find/sort: N/A, rail is initiative-ordered |
 * | 884 A4 §8 Cond tab apply/remove                                         | SHELL                                                                     |
 * | 890 A4 §8 bulk edits with preview (minion, transform, legendary…)       | SWEEP (Elite/Weak on whole encounters, transform preview) + PREP          |
 * | 899 A4 §8 statblock d20 Shift = adv, Ctrl = dis                         | P2                                                                        |
 * | 905 A4 typing guard: edit inputs, prep search, widget                   | SHELL + P1. Feedback widget: N/A, mockup only                             |
 * | 914 A4 undo/redo covers every mutation                                  | SHELL/ACT/PREP (undo) + P1 (redo) + P2 (undo a feed apply)                |
 * | 929 A5 roll breakdown + Elite +2 reaches attack rolls                   | P3                                                                        |
 * | 940 A5 templates never show in the timeline                             | P3                                                                        |
 * | 947 A5 "Select failed" button fits                                      | ACT                                                                       |
 * | 953 A5 Assess CR apply from dialog and Creature › CR                    | PREP                                                                      |
 * | 968 A5 prep IA: 5 tabs each with a "why" line                           | PREP (←/→ through the tabs) + P3 (each tab has a "why" line)              |
 * | 996 A6 terrain & light chips + "Applies to"                             | PREP (Dim light) + P3 (Darkness)                                          |
 * | 1013 A6 hover cards: hazards, lair, items, terrain                      | PREP (strip chip hover) + SWEEP (native hovers on 30 statblocks)          |
 * | 1032 A6 one Battlefield strip, hoverable                                | PREP                                                                      |
 * | 1051 A6 row effects: names + tally; card; × ends; viewed row names all  | ACT (tally count) + P3 (card, glyphs, × ends, viewed row names)           |
 * | 1076 §12 no overflow in doc / toolbar / rail / dock                     | P1                                                                        |
 * | 1085 final: no console errors                                           | every cockpit spec asserts errors === []                                  |
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
			sourceList: {name: "Parity Ambush", saveId: "cockpit-parity"},
			instances: [mk(ids[0], pick("Goblin"), 18), mk(ids[1], pick("Goblin"), 9), mk(ids[2], pick("Mage"), 14), mk(ids[3], pick("Owlbear"), 12)],
			selectedIds: [],
			omissions: [],
			groups: [],
			ungroupedIds: [],
			turn: {round: 0, activeId: null},
		};
		localStorage.removeItem("ewc-legend-off");
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", state, {page: "encounterworkspace.html"});
	}, SEED_IDS);
	await page.goto("/encounterworkspace.html?ew=2");
	await page.locator("#ew-cockpit[aria-busy='false']").waitFor();
	await expect(page.locator(".ewc-row")).toHaveCount(4);
};

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

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const fk = (page: Page, key: string) => page.locator(`[data-ewc-fk="${key}"]`);
const flow = (page: Page, key: string) => page.locator(`[data-ewc-flow="${key}"]`);
const sb = (page: Page) => page.locator(".ewc-sb");
const cards = (page: Page) => page.locator("[data-ewc-feed-card]");

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

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The first integer in a feed card's amount (the struck-out pre-multiplier total follows it). */
const cardAmount = async (page: Page, ix = 0) => Number((await cards(page).nth(ix).locator(".ewc-feed__n").innerText()).match(/-?\d+/)![0]);

const statblockDie = (page: Page, entry: string, kind: "d20" | "damage") =>
	sb(page).locator(`[data-roll-name-ancestor="${entry}"] [data-packed-dice*='"${kind}"']`).first();

const hpAction = async (page: Page, mode: "damage" | "heal" | "set", amount: number) => {
	await page.locator("#ewc-hp-amt").fill(`${amount}`);
	await fk(page, `hp-${mode}`).click();
};

const getOverflow = (page: Page) => page.evaluate(() => {
	const over = (el: Element | null) => el ? el.scrollWidth - el.clientWidth : 0;
	return {
		doc: over(document.documentElement),
		bar: over(document.querySelector(".ewc-bar")),
		rail: over(document.querySelector(".ewc-rail")),
		dock: over(document.querySelector(".ewc-dock")),
	};
});

test.describe("Encounter cockpit parity with the A6 mockup (?ew=2)", () => {
	test("P1 rail: legend, view vs select, turns and away banner, XP badge, HP heal/set/redo, typing guard, Roll once, no overflow", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);

		// §7 The legend explains the three row states until the first selection, then goes for good.
		const legend = page.locator("p.ewc-rail__legend");
		await expect(legend).toBeVisible();
		await expect(legend).toContainText("Viewed");
		await expect(legend).toContainText("Selected");
		await row(page, "gob-2").locator(".ewc-row__name").click();
		await page.mouse.move(640, 4);
		await expect(row(page, "gob-2")).toHaveClass(/is-viewed/);
		await expect(row(page, "gob-2")).not.toHaveClass(/is-sel/);
		await row(page, "gob-1").locator(".ewc-row__chk input").check();
		await expect(row(page, "gob-1")).toHaveClass(/is-sel/);
		await expect(legend).toHaveCount(0);

		// Ctrl/⌘-click toggles one row; Shift-click selects a range; neither changes the viewed creature.
		// (Clicks land on the AC cell: the name's native creature hover would cover the next row.)
		await row(page, "mage").locator(".ewc-row__ac").click({modifiers: ["ControlOrMeta"]});
		await expect(row(page, "mage")).toHaveClass(/is-sel/);
		await row(page, "owlbear").locator(".ewc-row__ac").click({modifiers: ["Shift"]});
		await expect(row(page, "owlbear")).toHaveClass(/is-sel/);
		await expect(row(page, "gob-2")).toHaveClass(/is-viewed/);
		await row(page, "mage").locator(".ewc-row__ac").click({modifiers: ["ControlOrMeta"]});
		await expect(row(page, "mage")).not.toHaveClass(/is-sel/);
		await blur(page);
		await page.keyboard.press("Escape");
		await expect(page.locator(".ewc-row.is-sel")).toHaveCount(0);

		// §4 The badge totals the XP still in the fight: 2 × 50 (Goblins) + 2,300 (Mage, CR 6) + 700 (Owlbear).
		const badge = page.locator(".ewc-badge");
		await expect(badge).toHaveText("3,100 XP");

		// Kept·A Viewing someone other than the active creature shows a way back (Space).
		await page.keyboard.press("n");
		await expect(page.locator(".ewc-round")).toContainText("Round 1");
		await expect(row(page, "gob-1")).toHaveClass(/is-turn/);
		await view(page, "owlbear");
		const away = page.locator("button.ewc-away");
		await expect(away).toContainText("Owlbear");
		await expect(away).toContainText("Goblin 1");
		await blur(page);
		await page.keyboard.press(" ");
		await expect(row(page, "gob-1")).toHaveClass(/is-viewed/);
		await expect(away).toHaveCount(0);

		// §8 Heal, Set, undo and redo on the HP tab (H).
		await view(page, "owlbear");
		await blur(page);
		await page.keyboard.press("h");
		await expect(page.locator('.ewc-dock__tab[aria-selected="true"]')).toContainText("HP");
		await hpAction(page, "damage", 10);
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(49);
		await hpAction(page, "heal", 5);
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(54);
		await hpAction(page, "set", 30);
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(30);
		await blur(page);
		await page.keyboard.press("ControlOrMeta+z");
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(54);
		await page.keyboard.press("ControlOrMeta+Shift+z");
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(30);

		// Kept·A A monster at 0 HP is defeated and leaves the XP total; healing brings it back.
		await hpAction(page, "damage", 100);
		await expect(row(page, "owlbear")).toHaveClass(/is-defeated/);
		await expect(row(page, "owlbear")).toContainText("Defeated");
		await expect(badge).toHaveText("2,400 XP");
		await hpAction(page, "heal", 10);
		await expect(row(page, "owlbear")).not.toHaveClass(/is-defeated/);
		await expect(badge).toHaveText("3,100 XP");

		// §8 ⋯ menu: initiative and Reset turns.
		await page.locator('[data-ewc-act="menu"]').click();
		await expect(page.locator('[data-ewc-menu="rollinit"]')).toBeVisible();
		await expect(page.locator('[data-ewc-menu="dmscreen"]')).toBeVisible();
		await page.locator('[data-ewc-menu="resetturns"]').click();
		await expect(page.locator(".ewc-round")).toContainText("Not started");
		await expect(page.locator(".ewc-row.is-turn")).toHaveCount(0);

		// Typing a shortcut letter in the console is text, not a shortcut.
		await blur(page);
		await page.keyboard.press("/");
		const input = page.locator("[data-ewc-console-in]");
		await expect(input).toBeFocused();
		await input.pressSequentially("qlgt");
		await expect(input).toHaveValue("qlgt");
		await expect(page.locator(".ewc-prep")).toBeHidden();
		await expect(flow(page, "group-dialog")).toBeHidden();
		await expect(page.locator(".ewc-log.is-open")).toHaveCount(0);
		await input.fill("");
		await input.press("Escape");
		await expect(input).not.toBeFocused();

		// §5 Group the goblins, roll their initiative once: equal numbers, adjacent rows.
		await row(page, "gob-1").locator(".ewc-row__chk input").check();
		await row(page, "gob-2").locator(".ewc-row__chk input").check();
		await blur(page);
		await page.keyboard.press("g");
		const dlg = flow(page, "group-dialog");
		await expect(dlg).toBeVisible();
		await dlg.locator('[data-ewc-flow="group-name"]').fill("Goblin pack");
		await dlg.locator('[data-ewc-flow="group-create"]').click();
		await expect(dlg).toBeHidden();
		await flow(page, "group-open").click();
		await dlg.locator('[data-ewc-flow="group-roll"]').click();
		await expect.poll(async () => {
			const [a, b] = await Promise.all(["gob-1", "gob-2"].map(id => row(page, id).locator(".ewc-row__init").innerText()));
			return a.trim() === b.trim() && /\d/.test(a);
		}, {message: "Roll once gives the group one initiative"}).toBe(true);
		const order = await page.locator(".ewc-row").evaluateAll(rows => rows.map(it => it.getAttribute("data-ewc-id")));
		expect(Math.abs(order.indexOf("gob-1") - order.indexOf("gob-2")), `rail order ${order.join(", ")}`).toBe(1);
		if (await dlg.isVisible()) await dlg.press("Escape");

		// §12 Nothing scrolls sideways: page, toolbar, rail, dock.
		expect(await getOverflow(page)).toEqual({doc: 0, bar: 0, rail: 0, dock: 0});

		expect(errors).toEqual([]);
	});

	test("P2 statblock roll feed: apply to selection, ½ / ×2, → Viewed, stage, attack verdicts, Shift / Ctrl d20, more", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await view(page, "gob-1");
		await row(page, "gob-2").locator(".ewc-row__chk input").check();
		await row(page, "owlbear").locator(".ewc-row__chk input").check();
		await expect(row(page, "gob-1")).toHaveClass(/is-viewed/);

		// §1 A damage die in the statblock lands in the feed, aimed at the selection, with a viewed-only option.
		await statblockDie(page, "Scimitar", "damage").click();
		await expect(cards(page)).toHaveCount(1);
		const dmg = cards(page).first();
		await expect(dmg).toHaveClass(/ewc-feed__card--dmg/);
		await expect(dmg.locator(".ewc-feed__meta")).toContainText("slashing");
		await expect(dmg.locator("[data-ewc-feed-viewed]")).toBeVisible();
		const total = await cardAmount(page);

		// ½ halves (rounding down) and shows the original struck out.
		const half = dmg.locator('[data-ewc-feed-mult="0.5"]');
		await half.click();
		await expect(half).toHaveAttribute("aria-pressed", "true");
		await expect(dmg.locator(".ewc-feed__n s")).toHaveText(`${total}`);
		const halved = Math.floor(total / 2);
		expect(await cardAmount(page)).toBe(halved);
		await expect(dmg.locator("[data-ewc-feed-apply]")).toHaveText(new RegExp(`^Apply ${halved} → `));

		// Stage in console puts the amount and the targets into the console to edit.
		await dmg.locator("[data-ewc-feed-stage]").click();
		const input = page.locator("[data-ewc-console-in]");
		await expect(input).toBeFocused();
		await expect(input).toHaveValue(new RegExp(`${halved} slashing`));
		await expect(input).toHaveValue(/@goblin2/i);
		await input.fill("");
		await input.press("Escape");

		// Apply hits both selected creatures, not the viewed one; undo restores them.
		const before = {gob1: (await getHp(page, "gob-1")).current, gob2: (await getHp(page, "gob-2")).current, owl: (await getHp(page, "owlbear")).current};
		await dmg.locator("[data-ewc-feed-apply]").click();
		await expect(dmg).toHaveClass(/is-applied/);
		await expect(dmg.locator(".ewc-feed__done")).toContainText("✓");
		await expect.poll(async () => (await getHp(page, "gob-2")).current).toBe(Math.max(0, before.gob2 - halved));
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(before.owl - halved);
		expect((await getHp(page, "gob-1")).current).toBe(before.gob1);
		await blur(page);
		await page.keyboard.press("ControlOrMeta+z");
		await expect.poll(async () => (await getHp(page, "gob-2")).current).toBe(before.gob2);
		await expect.poll(async () => (await getHp(page, "owlbear")).current).toBe(before.owl);

		// ×2 then → Viewed: only the viewed Goblin takes it.
		await statblockDie(page, "Scimitar", "damage").click();
		await expect(cards(page)).toHaveCount(2);
		const dmg2 = cards(page).first();
		const total2 = await cardAmount(page);
		await dmg2.locator('[data-ewc-feed-mult="2"]').click();
		expect(await cardAmount(page)).toBe(total2 * 2);
		await dmg2.locator("[data-ewc-feed-viewed]").click();
		await expect(dmg2).toHaveClass(/is-applied/);
		await expect.poll(async () => (await getHp(page, "gob-1")).current).toBe(Math.max(0, before.gob1 - total2 * 2));
		expect((await getHp(page, "gob-2")).current).toBe(before.gob2);
		expect((await getHp(page, "owlbear")).current).toBe(before.owl);

		// An attack roll names hit or miss against each selected creature's AC.
		await statblockDie(page, "Scimitar", "d20").click();
		await expect(cards(page)).toHaveCount(3);
		const atk = cards(page).first();
		await expect(atk).toHaveClass(/ewc-feed__card--atk/);
		await expect(atk.locator(".ewc-feed__meta").first()).toContainText(/(hit|miss) Goblin 2 \(AC 15\)/);
		await expect(atk.locator(".ewc-feed__meta").first()).toContainText(/(hit|miss) Owlbear \(AC 13\)/);

		// §8 Shift-click rolls with advantage, Ctrl/⌘-click with disadvantage: two dice, the right one kept.
		for (const [modifier, mode] of [["Shift", "advantage"], ["ControlOrMeta", "disadvantage"]] as const) {
			await statblockDie(page, "Scimitar", "d20").click({modifiers: [modifier]});
			const card = cards(page).first();
			await expect(card.locator(".ewc-feed__meta").first()).toContainText(`${mode} · `);
			const [a, b] = (await card.locator(".ewc-feed__bd small").innerText()).split("/").map(Number);
			const kept = Number((await card.locator(".ewc-feed__bd").getAttribute("aria-label"))!.match(/^d20 (\d+)/)![1]);
			expect(kept).toBe(mode === "advantage" ? Math.max(a, b) : Math.min(a, b));
		}

		// More than three rolls fold behind "N more".
		await expect(cards(page)).toHaveCount(3);
		const more = page.locator("[data-ewc-feed-more]");
		await expect(more).toHaveText("2 more");
		await more.click();
		await expect(cards(page)).toHaveCount(5);
		await expect(more).toHaveText("Show fewer");

		expect(errors).toEqual([]);
	});

	test("P3 Elite +2 reaches AC and attack rolls; tally card; console conc / check; no templates in the timeline; darkness", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await view(page, "gob-1");

		// §3 The prep toggle carries its Q hint; every prep tab explains itself.
		const toggle = page.locator('[data-ewc-act="prep-toggle"]');
		await expect(toggle).toHaveAttribute("aria-keyshortcuts", /q/i);
		await expect(toggle).toContainText("Q");
		await blur(page);
		await page.keyboard.press("q");
		for (const tab of ["ptab-add", "ptab-creature", "ptab-fx", "ptab-area", "ptab-items"]) {
			await fk(page, tab).click();
			await expect(page.locator(".ewc-prep__why"), `${tab} why line`).not.toBeEmpty();
		}

		// Elite on the viewed Goblin: double HP, AC 15 → 17.
		await fk(page, "ptab-creature").click();
		await fk(page, "cre-sub-tpl").click();
		await fk(page, "tpl-elite").click();
		await fk(page, "tpl-preview").click();
		await fk(page, "tpl-apply").click();
		await expect(fk(page, "tpl-rm-elite")).toBeVisible();
		await expect.poll(async () => (await getHp(page, "gob-1")).max).toBe(14);
		await expect(row(page, "gob-1").locator(".ewc-row__ac")).toContainText("17");
		await expect(row(page, "gob-2").locator(".ewc-row__ac")).toContainText("15");
		await blur(page);
		await page.keyboard.press("q");
		await expect(page.locator(".ewc-prep")).toBeHidden();

		// A5 #2/#3 The +2 reaches the Elite Goblin's attack roll and is named in the breakdown.
		await statblockDie(page, "Scimitar", "d20").click();
		await expect(cards(page).first().locator(".ewc-feed__bd")).toHaveAttribute("aria-label", /\+2 Elite/);
		await page.locator("[data-ewc-feed-clear]").click();

		// Console: Bless the Goblin, concentrate the Mage on Fly, a Stealth check with advantage.
		await blur(page);
		await page.keyboard.press("/");
		const input = page.locator("[data-ewc-console-in]");
		await input.fill("bless @goblin1");
		await input.press("Enter");
		await input.fill("conc fly @mage");
		await input.press("Enter");
		await expect(row(page, "mage").locator(".ewc-row__conc")).toContainText("Fly");
		await input.fill("check stealth adv @goblin2");
		await input.press("Enter");
		await expect(page.locator("[data-ewc-tray] .ewc-tray__title")).toContainText(/stealth/i);
		await input.fill("drop @mage");
		await input.press("Enter");
		await expect(row(page, "mage").locator(".ewc-row__conc")).toHaveCount(0);
		await input.press("Escape");

		// A6 #4 The viewed row names everything, with glyphs.
		await expect(row(page, "gob-1").locator(".ewc-pill--fx.ewc-pill--up")).toContainText("▲");
		await expect(row(page, "gob-1").locator(".ewc-pill--fx.ewc-pill--up")).toContainText("Bless");
		await expect(row(page, "gob-1").locator("[data-ewc-tally]")).toHaveCount(0);

		// Unviewed, the row tallies; the card lists the buff and the template, and × ends the buff.
		await view(page, "mage");
		const tally = row(page, "gob-1").locator("[data-ewc-tally]");
		await expect(tally).toBeVisible();
		// Keyboard: with the mouse, the row's hover quick actions cover the tally (see the fixme test below).
		await tally.focus();
		await page.keyboard.press("Enter");
		const pop = row(page, "gob-1").locator(".ewc-pop");
		await expect(pop).toBeVisible();
		await expect(pop.locator("li.ewc-tc__i--up")).toContainText("▲");
		await expect(pop.locator("li.ewc-tc__i--up")).toContainText("Bless");
		await expect(pop.locator("li.ewc-tc__i--tpl")).toContainText("✦");
		await expect(pop.locator("li.ewc-tc__i--tpl")).toContainText("Elite");
		await expect(pop.locator("li.ewc-tc__i--tpl .ewc-tc__rm")).toHaveCount(0);
		await pop.locator("li.ewc-tc__i--up .ewc-tc__rm").click();
		await expect(pop).toHaveCount(0);
		await tally.focus();
		await page.keyboard.press("Enter");
		await expect(row(page, "gob-1").locator(".ewc-pop li.ewc-tc__i--tpl")).toBeVisible();
		await expect(row(page, "gob-1").locator(".ewc-pop li.ewc-tc__i--up")).toHaveCount(0);
		await page.keyboard.press("Escape");

		// A5 #7 Templates never show in the timeline.
		await blur(page);
		await page.keyboard.press("t");
		const lane = page.locator('.ewc-tl__lane[data-ewc-lane="gob-1"]');
		await expect(lane).toBeVisible();
		await expect(lane).not.toContainText("Elite");
		await blur(page);
		await page.keyboard.press("t");

		// A4 §5 Darkness: the Mage (no darkvision) attacks at disadvantage; the Goblin (darkvision 60) does not.
		await page.keyboard.press("q");
		await fk(page, "ptab-area").click();
		await page.locator(".ewc-prep__rule").filter({hasText: /^Darkness$/}).click();
		await fk(page, "bf-add").click();
		await expect(page.locator(".ewc-prep-strip__chip").filter({hasText: "Darkness"})).toBeVisible();
		await blur(page);
		await page.keyboard.press("q");
		await expect(page.locator(".ewc-prep")).toBeHidden();
		await view(page, "mage");
		await statblockDie(page, "Dagger", "d20").click();
		await expect(cards(page).first().locator(".ewc-feed__meta").first()).toContainText("disadvantage · ");
		await page.locator("[data-ewc-feed-clear]").click();
		await view(page, "gob-1");
		await statblockDie(page, "Scimitar", "d20").click();
		await expect(cards(page).first()).not.toContainText("disadvantage");

		expect(errors).toEqual([]);
	});

	// SHELL BUG (rail.js / encounterworkspace-cockpit-rail.scss, coordinator-owned): hovering a row reveals its quick
	// actions (Dmg · Heal · Cond · ›_) on the meter line, exactly over the effect tally, so the tally can't be clicked
	// with a mouse (verify-a6 step 370: "quick actions never overlap name/HP/pills"). Repro: seed, view the Mage,
	// `bless @goblin1` in the console, then hover Goblin 1's row and click its "1 buff" tally — `.ewc-row__qa` intercepts.
	test.fixme("row quick actions never cover the effect tally (mouse)", async ({page}) => {
		const errors = trackConsoleErrors(page);
		await seed(page);
		await view(page, "mage");
		await blur(page);
		await page.keyboard.press("/");
		const input = page.locator("[data-ewc-console-in]");
		await input.fill("bless @goblin1");
		await input.press("Enter");
		await input.press("Escape");
		const tally = row(page, "gob-1").locator("[data-ewc-tally]");
		await tally.click({timeout: 5_000});
		await expect(row(page, "gob-1").locator(".ewc-pop li.ewc-tc__i--up")).toContainText("Bless");
		expect(errors).toEqual([]);
	});
});
