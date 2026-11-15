import fs from "node:fs";
import path from "node:path";
import {expect, test, type Page} from "@playwright/test";
import {pinEncounterWorkspaceUi} from "../utils/encounterWorkspaceUi";

/*
 * P4 handoffs into and out of the Lantern Cockpit (encounterworkspace.html?ew=2) on real data, with zero console errors:
 * Bestiary → cockpit (generated and saved lists), the cockpit's own saved-list picker, cockpit → DM Screen initiative
 * tracker, a real v7 save opening in the cockpit, and a legacy (?ew=1) edit of a cockpit save that keeps every
 * cockpit-only field. Bestiary links carry no `ew`, so each page is pinned to the cockpit as if the default had flipped.
 */

// A real v7 save written by the pre-cockpit reducers (fecd582d7^): MM Goblins, a Mage and grouped Zombies.
const V7_SAVE = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "test/e2e/fixtures/encounter-workspace-v7-save.json"), "utf8"));
const TIMEOUT = 30_000;

type Instance = {
	id: string,
	hash: string,
	customHashId: string | null,
	label: string | null,
	monster: {name: string, cr: string},
	hp: {current: number | null, max: number | null, temp: number},
	conditions: string[],
	initiative: number | null,
	effects: {id: string, name: string, key?: string, rounds?: number | null, casterId?: string | null}[],
	resources: {concentration: {active: boolean, label: string}, spellSlots: Record<string, {current: number, max: number}>, abilities: {id: string, current: number}[]},
};
type SavedState = {
	version: number,
	sourceList: {name: string, saveId: string} | null,
	instances: Instance[],
	battlefield: {id: string, name?: string, rule: string}[],
	savedEffects: {key: string, name: string}[],
	log: unknown[],
	combat: {status: string},
	turn: {round: number, activeId: string | null},
};

const trackConsoleErrors = (page: Page) => {
	const errors: string[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		const url = msg.location().url;
		// Dev checkouts have no sw-injector or /img/ tree (5etools images live in a separate repo); anything else counts.
		if (/404|Failed to load resource/i.test(msg.text()) && (url.endsWith("/sw-injector.js") || new URL(url, "http://x").pathname.startsWith("/img/"))) return;
		errors.push(`${msg.text()} (${msg.location().url})`);
	});
	page.on("pageerror", err => errors.push(`${err.name}: ${err.message}`));
	return errors;
};

const row = (page: Page, id: string) => page.locator(`.ewc-row[data-ewc-id="${id}"]`);
const toasts = (page: Page) => page.locator(".ewc-toasts");
const cockpitState = (page: Page) => page.evaluate(() => (globalThis as unknown as {ewCockpit: {getState: () => SavedState}}).ewCockpit.getState());
const savedState = (page: Page) => page.evaluate(() => (globalThis as unknown as {
	StorageUtil: {pGetForPage: (key: string, opts: {page: string}) => Promise<SavedState>},
}).StorageUtil.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"}));

const waitForCockpit = async (page: Page) => {
	await expect(page.locator("#ew-cockpit")).toHaveAttribute("aria-busy", "false", {timeout: TIMEOUT});
};
const openCockpit = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=2");
	await waitForCockpit(page);
};
const openLegacy = async (page: Page) => {
	await page.goto("/encounterworkspace.html?ew=1");
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false", {timeout: TIMEOUT});
};

/** Writes a raw save as-is, from a loaded legacy page so nothing else is booting or saving meanwhile. */
const writeSave = async (page: Page, state: unknown) => {
	await openLegacy(page);
	await page.evaluate(async raw => {
		const {StorageUtil} = globalThis as unknown as {StorageUtil: {pSetForPage: (key: string, value: unknown, opts: {page: string}) => Promise<void>}};
		await StorageUtil.pSetForPage("encounterWorkspaceState", raw, {page: "encounterworkspace.html"});
	}, state);
};

/**
 * Opens the v7 save through the real store and engine, then records everything only the cockpit knows about: a saved
 * effect, Haste concentrated on by the Mage, a timed debuff and condition, a stacked custom group with a timed
 * battlefield entry, a label, a template, death saves and an active combat. Returns those cockpit-only fields.
 */
const writeCockpitSave = async (page: Page) => {
	await writeSave(page, V7_SAVE);
	return page.evaluate(async () => {
		const {EncounterWorkspaceStore} = await import("/js/encounterworkspace/encounterworkspace-state.js");
		const {createEncounterEngine} = await import("/js/encounterworkspace/encounterworkspace-engine.js");
		const {applyEncounterEffect, saveEncounterEffectDef} = await import("/js/encounterworkspace/encounterworkspace-fx.js");
		const {applyEncounterCondition} = await import("/js/encounterworkspace/encounterworkspace-conditions-rules.js");
		const {withEncounterBattlefieldEntry} = await import("/js/encounterworkspace/encounterworkspace-battlefield.js");
		const {withEncounterCustomGroup, withEncounterGroupStack} = await import("/js/encounterworkspace/encounterworkspace-groups-v8.js");
		const {withEncounterTemplate} = await import("/js/encounterworkspace/encounterworkspace-templates.js");
		const {withEncounterCombatStatus} = await import("/js/encounterworkspace/encounterworkspace-party.js");
		type Draft = {instances: Record<string, unknown>[]};
		const byId = (state: Draft, id: string) => state.instances.find(it => it.id === id)!;

		const store = new EncounterWorkspaceStore();
		const engine = createEncounterEngine({state: await store.pLoad(), pSave: (next: unknown) => store.pSave(next)});
		await engine.pCommit("Cockpit prep", (draft: Draft, {log}: {log: unknown}) => {
			saveEncounterEffectDef(draft, {name: "Crypt chill", kind: "debuff", mods: [{target: "speed", kind: "flat", value: -10}], duration: 10}, {fnUid: () => "chill"});
			let ix = 0;
			applyEncounterEffect(draft, {targetIds: ["ew-1", "ew-2"], def: "haste", casterId: "ew-4", fnUid: () => `haste-${++ix}`, log});
			applyEncounterEffect(draft, {targetIds: ["ew-3"], def: {name: "Crypt chill", kind: "debuff", mods: [{target: "speed", kind: "flat", value: -10}]}, rounds: 3, fnUid: () => "chill-1", log});
			applyEncounterCondition(draft, {targetIds: ["ew-1"], condition: "restrained", rounds: 2, log});
			Object.assign(byId(draft, "ew-2"), {label: "Snik", note: "Knows the crypt layout"});
			Object.assign(byId(draft, "ew-1"), {deathSaveMode: "on", deathSaves: {successes: 1, failures: 2, stable: false, dead: false}});
		});
		await engine.pCommit("Cockpit groups", (draft: Draft) => {
			let next = withEncounterCustomGroup(draft, {ids: ["ew-1", "ew-2", "ew-3"], name: "Goblins"});
			next = withEncounterGroupStack(next, {name: "Goblins", isStacked: true});
			next = withEncounterBattlefieldEntry(next, {rule: "dim-light", scope: "group", group: "Goblins", rounds: 5, note: "Torches gutter"}).state;
			next = withEncounterTemplate(next, {key: "elite", ids: ["ew-6"]}).state;
			return withEncounterCombatStatus(next, "active");
		});
		return engine.getState();
	});
};

/** The fields the legacy UI doesn't know about; they must survive any legacy edit untouched. */
const cockpitOnly = (state: Record<string, unknown> & {instances: Record<string, unknown>[]}) => ({
	savedEffects: state.savedEffects,
	groupMeta: state.groupMeta,
	log: state.log,
	combat: state.combat,
	battlefield: state.battlefield,
	instances: state.instances.map(it => ({
		id: it.id,
		kind: it.kind,
		label: it.label,
		note: it.note,
		customGroup: it.customGroup,
		tieOrder: it.tieOrder,
		defeated: it.defeated,
		conditionDetails: it.conditionDetails,
		effects: it.effects,
		deathSaves: it.deathSaves,
		deathSaveMode: it.deathSaveMode,
		templates: it.templates,
	})),
});

const openBestiary = async (page: Page) => {
	await page.goto("/bestiary.html#goblin_mm");
	await expect.poll(() => page.evaluate(() => {
		const bestiary = (globalThis as unknown as {dbg_page?: {_sublistManager: {_hasLoadedState: boolean}}}).dbg_page;
		return bestiary?._sublistManager._hasLoadedState || false;
	}), {timeout: TIMEOUT}).toBe(true);
};

/** Saves "Goblin Ambush" (two Goblins and a CR 2 scaled Goblin) as the active Bestiary pinned list. */
const saveGoblinAmbush = async (page: Page) => {
	await openBestiary(page);
	return page.evaluate(async () => {
		const globals = globalThis as unknown as {
			dbg_page: {_sublistManager: {
				pDoLoadExportedSublist: (list: object) => Promise<void>,
				pHandleClick_save: () => Promise<boolean>,
				pGetExportableSublist: (opts: object) => Promise<{name: string, saveId: string, items: {customHashId?: string}[]}>,
			}},
			Renderer: {monster: {getCustomHashId: (mon: object) => string}},
		};
		const manager = globals.dbg_page._sublistManager;
		const variant = globals.Renderer.monster.getCustomHashId({name: "Goblin", source: "MM", _isScaledCr: true, _scaledCr: 2});
		await manager.pDoLoadExportedSublist({name: "Goblin Ambush", items: [{h: "goblin_mm", c: 2}, {h: "goblin_mm", c: 1, customHashId: variant}], sources: ["MM"]});
		await manager.pHandleClick_save();
		return manager.pGetExportableSublist({isMemoryOnly: true});
	});
};

const openMenuItem = async (page: Page, act: string) => {
	await page.locator('[data-ewc-act="menu"]').click();
	await page.locator(`[data-ewc-menu="${act}"]`).click();
};

test.describe("Encounter cockpit handoffs (?ew=2)", () => {
	test.beforeEach(({page}) => pinEncounterWorkspaceUi(page, "cockpit"));

	test("Bestiary's generated encounter opens in the cockpit through the real button, exactly once", async ({page}) => {
		test.setTimeout(120_000);
		const errors = trackConsoleErrors(page);
		await openBestiary(page);
		await page.locator("#btn-encounterbuild").click();
		await expect(page.locator(".best__ecgen-active")).toHaveCount(1);
		await page.locator('#wrp-encounterbuild-random-and-adjust button[title="Generate Encounter"]:visible').first().click();
		const expected = await expect.poll(() => page.evaluate(async () => {
			const bestiary = (globalThis as unknown as {dbg_page: {_sublistManager: {
				pGetExportableSublist: (opts: {isMemoryOnly: boolean}) => Promise<{items: {h: string, c?: number, customHashId?: string}[]}>,
			}}}).dbg_page;
			return (await bestiary._sublistManager.pGetExportableSublist({isMemoryOnly: true})).items.length;
		})).toBeGreaterThan(0).then(() => page.evaluate(async () => {
			const bestiary = (globalThis as unknown as {dbg_page: {_sublistManager: {
				pGetExportableSublist: (opts: {isMemoryOnly: boolean}) => Promise<{items: {h: string, c?: number, customHashId?: string}[]}>,
			}}}).dbg_page;
			return (await bestiary._sublistManager.pGetExportableSublist({isMemoryOnly: true})).items;
		}));
		const count = expected.reduce((sum, item) => sum + Number(item.c || 1), 0);

		await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
		await expect(page).toHaveURL(/encounterworkspace\.html\?ew=2$/, {timeout: TIMEOUT});
		await waitForCockpit(page);
		await expect(toasts(page)).toContainText(`Loaded ${count} creature${count === 1 ? "" : "s"} from “Current Bestiary Encounter” in Bestiary.`, {timeout: TIMEOUT});
		await expect(page.locator(".ewc-row")).toHaveCount(count);

		const opened = await savedState(page);
		expect(opened.version).toBe(8);
		expect(opened.sourceList).toEqual({name: "Current Bestiary Encounter", saveId: ""});
		expect(opened.instances).toHaveLength(count);
		for (const item of expected) {
			expect(opened.instances.filter(it => it.hash === item.h && it.customHashId === (item.customHashId || null))).toHaveLength(Number(item.c || 1));
		}
		for (const it of opened.instances) await expect(row(page, it.id).locator(".ewc-row__name")).toContainText(it.monster.name);

		// The one-time token is spent: a reload restores the working copy instead of loading again.
		await page.reload();
		await waitForCockpit(page);
		await expect(page.locator(".ewc-row")).toHaveCount(count);
		await expect(toasts(page)).not.toContainText("Loaded");
		expect((await savedState(page)).instances.map(it => it.id)).toEqual(opened.instances.map(it => it.id));
		expect(errors).toEqual([]);
	});

	test("a saved Bestiary list replaces the working encounter only after confirmation, keeping the saved-effects library", async ({page}) => {
		test.setTimeout(150_000);
		const errors = trackConsoleErrors(page);
		await writeCockpitSave(page);
		const saved = await saveGoblinAmbush(page);
		expect(saved.name).toBe("Goblin Ambush");

		// Keep Current leaves the cockpit save alone.
		await page.locator("#btn-encounterbuild").click();
		await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
		await expect(page.getByText("Replace Working Encounter")).toBeVisible({timeout: TIMEOUT});
		await page.getByRole("button", {name: "Keep Current"}).click();
		await expect(toasts(page)).toContainText("The working encounter was kept.", {timeout: TIMEOUT});
		await expect(page).toHaveURL(/encounterworkspace\.html\?ew=2$/);
		await expect(page.locator(".ewc-row")).toHaveCount(6);
		expect((await cockpitState(page)).sourceList?.name).toBe("Crypt ambush");

		// Replace Encounter loads the exact counts and the scaled variant, and carries the saved effects across.
		await openBestiary(page);
		await page.locator("#btn-encounterbuild").click();
		await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
		await page.getByRole("button", {name: "Replace Encounter"}).click();
		await expect(toasts(page)).toContainText("Loaded 3 creatures from “Goblin Ambush” in Bestiary.", {timeout: TIMEOUT});
		await expect(page.locator(".ewc-row")).toHaveCount(3);
		const opened = await savedState(page);
		expect(opened.sourceList).toEqual({name: saved.name, saveId: saved.saveId});
		expect(opened.instances.map(it => it.monster.cr)).toEqual(["1/4", "1/4", "2"]);
		expect(opened.instances[2].customHashId).toBe(saved.items[1].customHashId);
		expect(opened.savedEffects.map(it => it.name)).toEqual(["Crypt chill"]);
		expect(opened.battlefield).toEqual([]);
		expect(opened.combat.status).toBe("setup");
		expect(errors).toEqual([]);
	});

	test("the cockpit's own saved-list picker loads a Bestiary list", async ({page}) => {
		test.setTimeout(120_000);
		const errors = trackConsoleErrors(page);
		await writeCockpitSave(page);
		const saved = await saveGoblinAmbush(page);
		await openCockpit(page);
		await expect(page.locator(".ewc-row")).toHaveCount(6);

		await openMenuItem(page, "choose");
		const modal = page.locator(".ve-ui-modal__inner").filter({hasText: "Load Saved List"});
		await expect(modal).toBeVisible({timeout: TIMEOUT});
		await modal.locator(".ve-lst__row").filter({hasText: "Goblin Ambush"}).locator('button[title="Load"]').click();
		await page.getByRole("button", {name: "Replace Encounter"}).click();
		await expect(toasts(page)).toContainText("Loaded 3 creatures from “Goblin Ambush”.", {timeout: TIMEOUT});
		await expect(page.locator(".ewc-row")).toHaveCount(3);
		const opened = await savedState(page);
		expect(opened.sourceList).toEqual({name: saved.name, saveId: saved.saveId});
		expect(opened.savedEffects.map(it => it.name)).toEqual(["Crypt chill"]);
		expect(errors).toEqual([]);
	});

	test("Send to DM Screen queues the live encounter and the initiative tracker imports it once", async ({page}) => {
		test.setTimeout(150_000);
		const errors = trackConsoleErrors(page);
		await writeCockpitSave(page);
		await openCockpit(page);
		await expect(page.locator(".ewc-row")).toHaveCount(6);

		// A cockpit edit made just before sending travels with the snapshot.
		await row(page, "ew-3").locator(".ewc-row__name").click();
		await page.locator("#ewc-hp-amt").fill("2");
		await page.locator(".ewc-hp__btns .ewc-btn--bad").click();
		await expect(row(page, "ew-3").locator(".ewc-row__hp")).toHaveAttribute("aria-label", /^5 of 7 hit points/);
		const live = await cockpitState(page);

		// The elite template split Zombie #2 from its shared-turn group, so it has no initiative yet: sending is refused.
		expect(live.instances.find(it => it.id === "ew-6")!.initiative).toBeNull();
		await openMenuItem(page, "dmscreen");
		await expect(toasts(page).locator(".ewc-toast--error")).toContainText("Enter or roll initiative for Zombie #2 before queuing.");
		await row(page, "ew-6").locator(".ewc-row__init").click();
		await row(page, "ew-6").locator(".ewc-row__initin").fill("8");
		await row(page, "ew-6").locator(".ewc-row__initin").press("Enter");
		await expect(row(page, "ew-6").locator(".ewc-row__init")).toHaveText("8");

		await openMenuItem(page, "dmscreen");
		const queued = toasts(page).locator(".ewc-toast").filter({hasText: "Queued 6 creatures for the DM Screen."});
		await expect(queued).toBeVisible();
		await queued.getByRole("button", {name: "Open DM Screen"}).click();
		await expect(page).toHaveURL(/dmscreen\.html$/, {timeout: TIMEOUT});

		await page.locator(".ve-btn-panel-add").first().click();
		await page.locator(".panel-addmenu-tab-head", {hasText: "Special"}).click();
		await page.locator(".ve-ui-modal__row").filter({has: page.locator("span", {hasText: /^Initiative Tracker$/})}).getByRole("button", {name: "Add"}).click();
		const handoff = page.locator('section[aria-label="Encounter Workspace handoff"]');
		await expect(handoff.locator(".dm-init__handoff-summary")).toContainText("Encounter Workspace: Crypt ambush · 6 monsters", {timeout: TIMEOUT});
		await handoff.getByRole("button", {name: "Import here"}).click();
		await page.getByRole("button", {name: /Import Here$/}).click();
		await expect(handoff.locator(".dm-init__handoff-status")).toContainText("Imported 6 monsters into this panel.", {timeout: TIMEOUT});
		await expect(handoff.getByRole("button", {name: "Import here"})).toBeDisabled();

		const rows = page.locator(".dm-init__row");
		await expect(rows).toHaveCount(6);
		const hp = await rows.evaluateAll(els => els.map(el => `${(el.querySelector("input.hp") as HTMLInputElement).value}/${(el.querySelector("input.hp-max") as HTMLInputElement).value}`).sort());
		expect(hp).toEqual(live.instances.map(it => `${it.hp.current}/${it.hp.max}`).sort());
		expect(hp).toContain("5/7");
		expect(errors).toEqual([]);
	});

	test("a real v7 save opens in the cockpit with HP, conditions, initiative, resources and effects intact", async ({page}) => {
		test.setTimeout(90_000);
		const errors = trackConsoleErrors(page);
		await writeSave(page, V7_SAVE);
		await openCockpit(page);

		await expect(page.locator(".ewc-row")).toHaveCount(6);
		expect(await page.locator(".ewc-row").evaluateAll(rows => rows.map(it => (it as HTMLElement).dataset.ewcId))).toEqual(["ew-1", "ew-4", "ew-2", "ew-3", "ew-5", "ew-6"]);
		for (const [id, hp] of [["ew-1", "3 of 7"], ["ew-2", "7 of 7"], ["ew-3", "7 of 7"], ["ew-4", "31 of 40"], ["ew-5", "22 of 22"], ["ew-6", "22 of 22"]]) {
			await expect(row(page, id).locator(".ewc-row__hp")).toHaveAttribute("aria-label", new RegExp(`^${hp} hit points`));
		}
		await expect(row(page, "ew-2").locator(".ewc-row__hp")).toHaveAttribute("aria-label", /3 temporary/);
		for (const [id, init] of [["ew-1", "17"], ["ew-4", "14"], ["ew-2", "12"], ["ew-3", "9"], ["ew-5", "6"], ["ew-6", "6"]]) {
			await expect(row(page, id).locator(".ewc-row__init")).toHaveText(init);
		}
		await expect(row(page, "ew-2").locator(".ewc-row__turntag")).toHaveText("TURN");
		await expect(row(page, "ew-1").locator(".ewc-pill--cond")).toContainText(["Prone"]);
		await expect(row(page, "ew-2").locator(".ewc-pill--cond")).toContainText(["Frightened"]);
		await expect(row(page, "ew-5").locator(".ewc-pill--cond")).toContainText(["Poisoned"]);
		await expect(row(page, "ew-4").locator(".ewc-row__conc")).toContainText("Fly");

		const state = await cockpitState(page);
		expect(state.version).toBe(8);
		expect(state.sourceList).toEqual({name: "Crypt ambush", saveId: "saved-crypt"});
		expect(state.turn).toEqual({round: 1, activeId: "ew-2"});
		const byId = (id: string) => state.instances.find(it => it.id === id)!;
		expect(byId("ew-4").resources.spellSlots["1"]).toEqual({current: 2, max: 4});
		expect(byId("ew-5").resources.abilities).toEqual([expect.objectContaining({id: "custom:undead-fortitude-uses", current: 1})]);
		expect(byId("ew-1").effects.map(it => it.name)).toEqual(["Bless"]);
		expect(byId("ew-4").effects.map(it => it.name)).toEqual(["Bane"]);
		expect(state.battlefield.map(it => it.id)).toEqual(["bf:v7:note-crypt", "bf:v7:desecrated-dmg"]);
		expect(state.savedEffects).toEqual([]);
		expect(errors).toEqual([]);
	});

	test("a cockpit save edited in the legacy UI reopens in the cockpit with every cockpit-only field intact", async ({page}) => {
		test.setTimeout(120_000);
		const errors = trackConsoleErrors(page);
		const prepped = await writeCockpitSave(page);
		const expected = cockpitOnly(prepped);

		// Legacy (?ew=1): damage one Goblin through Fast actions, then advance the turn; each edit saves.
		await openLegacy(page);
		await page.locator("#ew-none").click();
		await page.locator('.ew__roster-row[data-instance-id="ew-3"] input[type=checkbox]').check();
		await page.locator("#ew-fast-damage").click();
		await page.locator("#ew-damage-expression").fill("2");
		await page.locator("#ew-damage-apply").click();
		await expect(page.locator("#ew-status")).toContainText("Applied 2 bludgeoning damage to 1 monster");
		await page.locator("#ew-turn-next").click();
		await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
		await expect.poll(async () => (await savedState(page)).turn.activeId).not.toBe("ew-2");
		const legacy = await savedState(page);
		expect(legacy.instances.find(it => it.id === "ew-3")!.hp.current).toBe(5);
		expect(cockpitOnly(legacy as unknown as Parameters<typeof cockpitOnly>[0])).toEqual(expected);

		// Cockpit (?ew=2): the legacy edits and every cockpit-only field are there, in state and on screen.
		await openCockpit(page);
		await expect(page.locator(".ewc-row")).toHaveCount(6);
		const reopened = await cockpitState(page);
		expect(cockpitOnly(reopened as unknown as Parameters<typeof cockpitOnly>[0])).toEqual(expected);
		expect(reopened.turn.activeId).toBe(legacy.turn.activeId);
		await expect(row(page, "ew-3").locator(".ewc-row__hp")).toHaveAttribute("aria-label", /^5 of 7 hit points/);
		await expect(row(page, "ew-2").locator(".ewc-row__name")).toContainText("Snik");
		await expect(row(page, "ew-4").locator(".ewc-row__conc")).toContainText("Haste");
		expect(errors).toEqual([]);
	});
});
