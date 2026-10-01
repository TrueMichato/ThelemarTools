import {expect, test} from "@playwright/test";

async function openBestiary(page: import("@playwright/test").Page) {
	await page.goto("/bestiary.html#goblin_mm");
	await expect.poll(() => page.evaluate(() => {
		const bestiary = (globalThis as typeof globalThis & {dbg_page?: {_sublistManager: {_hasLoadedState: boolean}}}).dbg_page;
		return bestiary?._sublistManager._hasLoadedState || false;
	}), {timeout: 30_000}).toBe(true);
}

async function readWorkspace(page: import("@playwright/test").Page) {
	return page.evaluate(async () => {
		const storage = (globalThis as typeof globalThis & {StorageUtil: {
			pGetForPage: (key: string, opts: {page: string}) => Promise<{
				sourceList: {name: string, saveId: string},
				instances: {hash: string, customHashId: string | null, monster: {cr: string}}[],
			}>,
		}}).StorageUtil;
		return storage.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"});
	});
}

test("a generated unsaved Bestiary encounter opens through the actual button exactly once", async ({page}) => {
	test.setTimeout(120_000);
	await openBestiary(page);
	await page.locator("#btn-encounterbuild").click();
	await expect(page.locator(".best__ecgen-active")).toHaveCount(1);
	await page.locator('#wrp-encounterbuild-random-and-adjust button[title="Generate Encounter"]:visible').first().click();
	await expect.poll(() => page.evaluate(() => {
		const bestiary = (globalThis as typeof globalThis & {dbg_page: {
			_sublistManager: {sublistItems: unknown[]},
		}}).dbg_page;
		return bestiary._sublistManager.sublistItems.length;
	})).toBeGreaterThan(0);
	const expected = await page.evaluate(async () => {
		const bestiary = (globalThis as typeof globalThis & {dbg_page: {
			_sublistManager: {pGetExportableSublist: (opts: {isMemoryOnly: boolean}) => Promise<{
				items: {h: string, c?: number, customHashId?: string}[],
			}>},
		}}).dbg_page;
		return (await bestiary._sublistManager.pGetExportableSublist({isMemoryOnly: true})).items;
	});
	await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
	await expect(page).toHaveURL(/encounterworkspace\.html$/);
	await expect(page.locator("#ew-status")).toContainText('from "Current Bestiary Encounter" in Bestiary');
	const opened = await readWorkspace(page);
	expect(opened.sourceList).toEqual({name: "Current Bestiary Encounter", saveId: ""});
	expect(opened.instances).toHaveLength(expected.reduce((sum, item) => sum + Number(item.c || 1), 0));
	for (const item of expected) {
		expect(opened.instances.filter(instance => instance.hash === item.h
			&& instance.customHashId === (item.customHashId || null))).toHaveLength(Number(item.c || 1));
	}
	await page.reload();
	await expect(page.locator("#ew-status")).toContainText("restored from this browser");
	expect((await readWorkspace(page)).instances).toHaveLength(opened.instances.length);
});

test("a saved active encounter hands over exact edited counts and a scaled variant only after confirmation", async ({page}) => {
	test.setTimeout(120_000);
	await page.goto("/encounterworkspace.html");
	await expect(page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
	await page.evaluate(async () => {
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, opts: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", {
			version: 7, sourceList: {name: "Previous Encounter", saveId: "previous"}, instances: [],
			selectedIds: [], omissions: [], groups: [], ungroupedIds: [], turn: {round: 0, activeId: null},
		}, {page: "encounterworkspace.html"});
	});
	await openBestiary(page);
	const saved = await page.evaluate(async () => {
		const bestiary = (globalThis as typeof globalThis & {
			dbg_page: {_sublistManager: {
				pDoLoadExportedSublist: (list: object) => Promise<void>,
				pHandleClick_save: () => Promise<boolean>,
				pDoSublistSetCount: (opts: object) => Promise<void>,
				sublistItems: {data: {entity: unknown}}[],
				pGetExportableSublist: (opts: object) => Promise<{name: string, saveId: string, items: unknown[]}>,
			}},
			Renderer: {monster: {getCustomHashId: (mon: object) => string}},
		});
		const manager = bestiary.dbg_page._sublistManager;
		const variant = bestiary.Renderer.monster.getCustomHashId({name: "Goblin", source: "MM", _isScaledCr: true, _scaledCr: 2});
		await manager.pDoLoadExportedSublist({name: "Goblin Ambush", items: [
			{h: "goblin_mm", c: 2},
			{h: "goblin_mm", c: 1, customHashId: variant},
		], sources: ["MM"]});
		await manager.pHandleClick_save();
		return manager.pGetExportableSublist({isMemoryOnly: true});
	});
	expect(saved.name).toBe("Goblin Ambush");
	await page.locator("#btn-encounterbuild").click();
	await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
	await expect(page.getByText("Replace Working Encounter")).toBeVisible();
	await page.getByRole("button", {name: "Keep Current"}).click();
	await expect(page.locator("#ew-status")).toContainText("working encounter was kept");
	expect((await readWorkspace(page)).sourceList.name).toBe("Previous Encounter");

	await openBestiary(page);
	await page.locator("#btn-encounterbuild").click();
	await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
	await page.getByRole("button", {name: "Replace Encounter"}).click();
	await expect(page.locator("#ew-status")).toContainText('from "Goblin Ambush" in Bestiary');
	const opened = await readWorkspace(page);
	expect(opened.sourceList).toEqual({name: saved.name, saveId: saved.saveId});
	expect(opened.instances).toHaveLength(3);
	expect(opened.instances.map(instance => instance.monster.cr)).toEqual(["1/4", "1/4", "2"]);
	expect(opened.instances[2].customHashId).toBe((saved.items[1] as {customHashId: string}).customHashId);
});

test("a missing handoff is reported without changing the working copy; ordinary Bestiary navigation stays ordinary", async ({page}) => {
	await openBestiary(page);
	await page.locator(".bestiary__wrp-controls .bestiary__encounter-workspace-link").click();
	await expect(page).toHaveURL(/encounterworkspace\.html$/);
	await expect(page.locator("#ew-status")).toContainText("Choose a saved Bestiary pinned list");
	await page.evaluate(async () => {
		const {StorageUtil} = globalThis as typeof globalThis & {
			StorageUtil: {pSetForPage: (key: string, value: unknown, opts: {page: string}) => Promise<void>},
		};
		await StorageUtil.pSetForPage("encounterWorkspaceState", {
			version: 7, sourceList: {name: "Keep Me", saveId: "kept"}, instances: [],
			selectedIds: [], omissions: [], groups: [], ungroupedIds: [], turn: {round: 0, activeId: null},
		}, {page: "encounterworkspace.html"});
	});
	await page.goto("/encounterworkspace.html?bestiaryEncounter=missing");
	await expect(page.locator("#ew-status")).toContainText("handoff is missing or has already been opened");
	await expect(page).toHaveURL(/encounterworkspace\.html$/);
	await expect(page.locator("#ew-choose")).toBeEnabled();
	expect((await readWorkspace(page)).sourceList.name).toBe("Keep Me");

	await page.evaluate(() => sessionStorage.setItem("bestiaryEncounterHandoff", "{damaged"));
	await page.goto("/encounterworkspace.html?bestiaryEncounter=damaged");
	await expect(page.locator("#ew-status")).toContainText("handoff is damaged");
	expect((await readWorkspace(page)).sourceList.name).toBe("Keep Me");

	await page.evaluate(() => sessionStorage.setItem("bestiaryEncounterHandoff", JSON.stringify({
		version: 1, token: "partial", exportedSublist: {
			name: "Broken Bestiary Encounter", saveId: "", items: [{h: "missing_creature_tst"}],
		},
	})));
	await page.goto("/encounterworkspace.html?bestiaryEncounter=partial");
	await page.getByRole("button", {name: "Replace Encounter"}).click();
	await expect(page.locator("#ew-status")).toContainText("missing_creature_tst");
	await expect(page.locator("#ew-status")).toContainText("working encounter is unchanged");
	expect((await readWorkspace(page)).sourceList.name).toBe("Keep Me");
});

test("an empty active Bestiary encounter stays in Bestiary with an actionable warning", async ({page}) => {
	await openBestiary(page);
	await page.locator("#btn-encounterbuild").click();
	await page.locator(".best-ecgen__visible--flex .bestiary__encounter-workspace-link").click();
	await expect(page).toHaveURL(/bestiary\.html/);
	await expect(page.getByText("Add creatures to the Bestiary encounter before opening it in the workspace.", {exact: false})).toBeVisible();
});

test("Bestiary footer controls wrap inside the pane in desktop and mobile day/night layouts", async ({page}) => {
	await openBestiary(page);
	const controls = page.locator(".bestiary__wrp-controls");
	for (const width of [1280, 768, 390, 320]) {
		await page.setViewportSize({width, height: 840});
		for (const night of [false, true]) {
			await page.locator("html").evaluate((html, value) => html.classList.toggle("ve-night-mode", value), night);
			await expect(controls).toBeVisible();
			const result = await controls.evaluate(wrapper => {
				const bounds = wrapper.getBoundingClientRect();
				const buttons = [...wrapper.querySelectorAll("button, a")].filter(el => !!el.getClientRects().length);
				return {
					withinPane: buttons.every(el => {
						const rect = el.getBoundingClientRect();
						return rect.left >= bounds.left - 2 && rect.right <= bounds.right + 2;
					}),
					wrapped: new Set(buttons.map(el => Math.round(el.getBoundingClientRect().top))).size > 1,
					visibleActions: buttons.map(el => el.textContent?.trim() || el.getAttribute("title")),
					scrollWidth: document.documentElement.scrollWidth,
					viewport: document.documentElement.clientWidth,
				};
			});
			expect(result.withinPane, `${width}px ${night ? "night" : "day"}: ${result.visibleActions.join(", ")}`).toBe(true);
			expect(result.scrollWidth).toBeLessThanOrEqual(result.viewport + 2);
			expect(result.wrapped).toBe(true);
			for (const label of ["Encounter Builder", "Proficiency Dice", "Encounter Workspace", "Printer View", "Table View", "Manage Content"]) {
				expect(result.visibleActions.some(action => action?.includes(label))).toBe(true);
			}
		}
	}
});
