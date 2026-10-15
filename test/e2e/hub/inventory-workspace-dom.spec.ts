import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {expect, test, type Page} from "@playwright/test";

declare global {
	interface Window {
		workspace: any;
		HubInventoryWorkspace: any;
		refreshCalls: number;
		inventoryFixture: any;
		inventoryBefore: string;
		HubPageTest: any;
	}
}

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const stash = {
	id: "private-stash-id",
	inventory: [
		{id: "rich-stack", quantity: 3, item: {name: "Rations", source: "PHB", type: "G", rarity: "common", weight: 2, value: 50, entries: ["Private implementation detail"], custom: {preserved: true}}},
		{id: "unweighed-stack", quantity: 1, item: {name: "<img src=x onerror=alert(1)> Moonstone", source: "TEST"}},
	],
	currency: {cp: 3, sp: 4, ep: 5, gp: 6, pp: 7},
};
const characters = [
	{id: "owned", ownerAccountId: "viewer", data: {name: "Rowan"}},
	{id: "other", ownerAccountId: "someone-else", data: {name: "Hidden character"}},
];

test.describe("Party inventory workspace in the real browser DOM", () => {
	let page: Page;
	let script: string;
	let pageScript: string;
	test.beforeAll(async () => {
		const result = await build({
			entryPoints: ["js/hub/hub-inventory-workspace.js"],
			bundle: true,
			write: false,
			format: "iife",
			globalName: "HubInventoryWorkspace",
		});
		script = result.outputFiles[0].text;
		const pageSource = read("js/hub/hub-page.js")
			.replace("void pInit();", "export {setTransferProposalControls, syncTransferQuantity};");
		const pageResult = await build({
			stdin: {
				contents: process.env.HUB_B1_DRAFT_NEGATIVE_CONTROL === "true" ? pageSource.replace("delete form._hubTransferLatestState;", "") : pageSource,
				resolveDir: fileURLToPath(new URL("../../../js/hub/", import.meta.url)),
			},
			bundle: true,
			write: false,
			format: "iife",
			globalName: "HubPageTest",
			define: {"import.meta.url": JSON.stringify("https://workspace.test/js/hub/hub-page.js")},
		});
		pageScript = pageResult.outputFiles[0].text;
	});
	test.beforeEach(async ({page: currentPage}) => {
		page = currentPage;
		await page.setContent(read("campaign.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, ""));
		await page.addScriptTag({content: script});
	});
	const init = async (role = "dm", data: typeof stash | null = stash) => {
		await page.evaluate(({role, data, characters}) => {
			window.inventoryFixture = data;
			window.inventoryBefore = JSON.stringify(data);
			window.workspace = window.HubInventoryWorkspace.createHubInventoryWorkspace({
				root: document.getElementById("campaign-inventory-workspace"),
				campaign: {id: "campaign", role, status: "active"},
				accountId: "viewer",
				documentRef: document,
				pRefresh: async () => { window.refreshCalls = (window.refreshCalls || 0) + 1; },
			});
			if (data) window.workspace.replace({partyInventory: data, characters});
		}, {role, data, characters});
	};
	const text = () => page.locator("#campaign-inventory-workspace").textContent();

	for (const role of ["dm", "co_dm"]) test(`${role} sees existing moves, awards and approval entry points`, async () => {
		await init(role);
		const actions = page.locator("[data-inventory-actions]");
		expect(await actions.locator("a").allTextContents()).toEqual(["Move items or currency", "Award items", "Grant XP", "Review transfers"]);
		await actions.getByText("Award items", {exact: true}).click();
		expect(await page.locator("#campaign-workbench").evaluate(element => element.open)).toBe(true);
		expect(await page.evaluate(() => document.activeElement.id)).toBe("campaign-item-source-catalog");
	});

	test("players get only owned Sheet links, spectators and unknown roles get no mutation entry points", async () => {
		await init("player");
		expect(await page.locator("[data-inventory-actions] a").allTextContents()).toEqual(["Open Rowan Sheet"]);
		expect(await page.locator("[data-inventory-actions] a").getAttribute("href")).toBe("charactersheet.html?id=owned&hubCampaign=campaign");
		expect(await text()).toContain("A DM must approve");
		for (const role of ["spectator", "unknown"]) {
			await init(role);
			expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
			expect(await text()).toContain("Read-only");
		}
	});

	test("renders authorized stack and denomination detail as text without mutating complete metadata", async () => {
		await init();
		expect(await text()).toContain("3 × Rations");
		expect(await text()).toContain("PHB · common");
		expect(await text()).toContain("2 lb each");
		expect(await text()).toContain("50 CP each");
		expect(await text()).toContain("Shared item weight: at least 6 lb");
		expect(await text()).toContain("not assigned to a character");
		expect(await page.locator("[data-inventory-currency]").textContent()).toContain("7 PP");
		expect(await page.locator("[data-inventory-items] img").count()).toBe(0);
		for (const hidden of ["private-stash-id", "rich-stack", "Hidden character", "Private implementation detail", "preserved"]) expect(await text()).not.toContain(hidden);
		expect(await page.evaluate(() => JSON.stringify(window.inventoryFixture) === window.inventoryBefore)).toBe(true);
	});

	test("replaces authoritative rows, retaining the search draft and focus", async () => {
		await init();
		const search = page.locator("#campaign-inventory-search");
		await search.fill("Rations");
		await page.evaluate(() => window.workspace.replace({
			partyInventory: {inventory: [{id: "new-stack", quantity: 1, item: {name: "Rations", source: "PHB", weight: 2}}], currency: {}},
			characters: [],
		}));
		expect(await search.inputValue()).toBe("Rations");
		expect(await search.evaluate(element => document.activeElement === element)).toBe(true);
		expect(await text()).toContain("1 × Rations");
		expect(await text()).not.toContain("3 × Rations");
		await search.fill("absent");
		expect(await text()).toContain("No shared items match");
	});

	test("unlocking a recovered proposal once does not reset the next transfer draft or focus", async () => {
		await page.route("https://workspace.test/", route => route.fulfill({body: read("campaign.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, ""), contentType: "text/html"}));
		await page.goto("https://workspace.test/");
		await page.addScriptTag({content: pageScript});
		await page.evaluate(({stash, characters}) => {
			const form = document.getElementById("campaign-transfer-form");
			const source = document.getElementById("campaign-transfer-source") as HTMLSelectElement;
			source.append(new Option("Party inventory", `party_inventory:${stash.id}`));
			const target = document.getElementById("campaign-transfer-target") as HTMLSelectElement;
			target.append(new Option("Rowan", "character:owned"));
			window.HubPageTest.setTransferProposalControls({
				form,
				proposalRequest: {
					sourceKind: "party_inventory",
					sourceId: stash.id,
					targetKind: "character",
					targetId: "owned",
					payload: {items: [{entryId: "rich-stack", quantity: 1}]},
				},
				characters,
				partyInventory: stash,
				isLocked: true,
			});
			window.HubPageTest.setTransferProposalControls({form, isLocked: false});
			(document.getElementById("campaign-transfer-entry") as HTMLSelectElement).value = "rich-stack";
			window.HubPageTest.syncTransferQuantity();
		}, {stash, characters});
		await page.locator("#campaign-workbench").evaluate((element: HTMLDetailsElement) => element.open = true);
		await page.locator("#campaign-transfer-quantity").fill("2");
		await page.locator("#campaign-transfer-gp").fill("3");
		await page.locator("#campaign-transfer-quantity").focus();
		await page.evaluate(() => window.HubPageTest.setTransferProposalControls({form: document.getElementById("campaign-transfer-form"), isLocked: false}));
		await expect(page.locator("#campaign-transfer-quantity")).toHaveValue("2");
		await expect(page.locator("#campaign-transfer-gp")).toHaveValue("3");
		await expect(page.locator("#campaign-transfer-quantity")).toBeFocused();
	});

	test("distinguishes initial loading, empty, failed refresh and a GET-only retry", async () => {
		await init("dm", null);
		expect(await text()).toContain("Loading shared supplies");
		expect(await page.locator("#campaign-inventory-workspace").getAttribute("aria-busy")).toBe("true");
		await page.evaluate(() => window.workspace.setError());
		expect(await text()).toContain("could not be loaded");
		await page.locator("[data-inventory-retry]").click();
		expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
		await page.evaluate(() => window.workspace.replace({partyInventory: {inventory: [], currency: {}}, characters: []}));
		expect(await text()).toContain("The shared stash is empty");
		expect(await text()).toContain("0 CP");
		await page.evaluate(() => window.workspace.replace({partyInventory: {inventory: [], currency: {gp: 10}}, characters: []}));
		expect(await text()).toContain("No shared item stacks. Currency is available");
	});

	test("a failed refresh retains labeled stale balances and removes mutation entry points", async () => {
		await init();
		await page.evaluate(() => window.workspace.setError());
		expect(await text()).toContain("Showing last loaded balances");
		expect(await text()).toContain("3 × Rations");
		expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
		await page.locator("[data-inventory-retry]").click();
		expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
		expect(await text()).toContain("no transfer will be sent");
	});

	test("retains stale balances offline but hides action entries until an authoritative refresh", async () => {
		await init();
		await page.evaluate(() => window.workspace.setOnline(false));
		expect(await text()).toContain("Offline");
		expect(await text()).toContain("3 × Rations");
		expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
		expect(await page.locator("[data-inventory-retry]").isDisabled()).toBe(true);
		await page.evaluate(() => window.workspace.setOnline(true));
		expect(await text()).toContain("Reload");
		expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
	});

	test("conceals stale detail immediately and cannot be restored by a late terminal response", async () => {
		await init("player");
		await page.locator("#campaign-inventory-search").fill("Rations");
		await page.evaluate(({stash, characters}) => {
			window.workspace.conceal({isTerminal: true});
			window.workspace.replace({partyInventory: stash, characters});
			window.workspace.setActivity({events: [{type: "item.granted", payload: {entry: {item: {name: "Secret"}}}}]});
		}, {stash, characters});
		for (const value of ["Rations", "Rowan", "Secret", "6 GP"]) expect(await text()).not.toContain(value);
		expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
		expect(await page.locator("#campaign-inventory-search").inputValue()).toBe("");
	});

	test("uses only authorized inventory events and clears them on projection invalidation", async () => {
		await init();
		await page.locator("#campaign-inventory-search").fill("Rations");
		await page.evaluate(() => window.workspace.setActivity({
			events: [
				{id: "one", sequence: 1, type: "item.granted", payload: {entry: {item: {name: "Rations"}, quantity: 2}}, createdAt: "2026-10-14"},
				{id: "two", sequence: 2, type: "xp.granted", payload: {amount: 100}},
			],
			characters: [],
			members: [],
		}));
		expect(await page.locator("[data-inventory-activity]").textContent()).toContain("Rations");
		expect(await page.locator("[data-inventory-activity]").textContent()).not.toContain("100");
		await page.evaluate(() => window.workspace.conceal());
		expect(await page.locator("[data-inventory-items]").textContent()).toBe("");
		expect(await page.locator("[data-inventory-activity]").textContent()).not.toContain("Rations");
		expect(await page.locator("[data-inventory-actions] a").count()).toBe(0);
		expect(await page.locator("#campaign-inventory-search").inputValue()).toBe("Rations");
		await page.evaluate(({stash, characters}) => window.workspace.replace({partyInventory: stash, characters}), {stash, characters});
		expect(await page.locator("[data-inventory-items]").textContent()).toContain("Rations");
	});

	test("shared custody handles exact, zero and unavailable weights without inferring character capacity", async () => {
		await init();
		for (const value of [null, "", false, undefined]) {
			await page.evaluate(weight => window.workspace.replace({
				partyInventory: {inventory: [{quantity: 2, item: {name: "Unweighed", weight}}], currency: {}},
			}), value);
			expect(await page.locator("[data-inventory-weight]").textContent()).toContain("at least 0 lb");
		}
		await page.evaluate(() => window.workspace.replace({
			partyInventory: {inventory: [{quantity: 2, item: {name: "Weightless", weight: 0}}], currency: {}},
		}));
		expect(await page.locator("[data-inventory-weight]").textContent()).toContain("Shared item weight: 0 lb");
		expect(await page.locator("[data-inventory-weight]").textContent()).not.toContain("at least");
	});

	test("long stash lists remain keyboard-scrollable without moving focus out of the supplies", async () => {
		await init();
		await page.addStyleTag({content: read("css/hub.css")});
		await page.evaluate(() => window.workspace.replace({
			partyInventory: {inventory: Array.from({length: 50}, (_, index) => ({id: `row-${index}`, quantity: 1, item: {name: `Supply ${index}`, source: "TEST", weight: 1}})), currency: {}},
		}));
		const list = page.locator("[data-inventory-items]");
		await list.focus();
		await expect(list).toBeFocused();
		await list.press("ArrowDown");
		await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
		await expect(list).toBeFocused();
	});

	test("reflows long supplies with keyboard touch targets in desktop and mobile day and night", async ({}, testInfo) => {
		await init();
		await page.addStyleTag({content: `${read("css/hub.css")}\nbody{margin:0}.ve-hidden{display:none!important}`});
		await page.evaluate(() => {
			const root = document.getElementById("campaign-inventory-workspace")!;
			const shell = document.createElement("div");
			shell.className = "hub-shell hub-state";
			shell.append(root);
			document.body.replaceChildren(shell);
			document.body.className = "hub-page";
			document.body.style.background = "var(--hub-bg)";
		});
		for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1280, 900]] as const) {
			await page.setViewportSize({width, height});
			for (const theme of ["day", "night"]) {
				await page.evaluate(night => document.documentElement.classList.toggle("ve-night-mode", night), theme === "night");
				const audit = await page.evaluate(() => ({
					overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
					smallControls: [...document.querySelectorAll("#campaign-inventory-workspace a, #campaign-inventory-workspace button, #campaign-inventory-workspace input")]
						.filter(element => element.getClientRects().length > 0 && element.getBoundingClientRect().height < 44)
						.map(element => element.outerHTML),
				}));
				expect(audit).toEqual({overflow: false, smallControls: []});
				await page.locator("#campaign-inventory-search").focus();
				await expect(page.locator("#campaign-inventory-search")).toBeFocused();
				await page.screenshot({path: testInfo.outputPath(`b1-inventory-${name}-${theme}.png`), fullPage: true});
			}
		}
	});
});
