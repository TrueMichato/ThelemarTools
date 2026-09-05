import {expect, Page, test} from "@playwright/test";
import {ItemsPage} from "../pages/ItemsPage";

interface BrowserError {
	text: string;
	url: string;
}

function trackBrowserErrors (page: Page): BrowserError[] {
	const errors: BrowserError[] = [];
	page.on("console", msg => {
		if (msg.type() !== "error") return;
		errors.push({text: msg.text(), url: msg.location().url});
	});
	page.on("pageerror", err => errors.push({text: err.message, url: ""}));
	return errors;
}

function getUnexpectedBrowserErrors (errors: BrowserError[]): BrowserError[] {
	return errors.filter(({text, url}) => !(url.endsWith("/sw-injector.js") && /404|Failed to load resource/i.test(text)));
}

test.describe("Items page — magic-item rows", () => {
	test("renders official magic-item row fields and selected-item details", async ({page}) => {
		const browserErrors = trackBrowserErrors(page);
		const itemsPage = new ItemsPage(page);
		await itemsPage.goto();

		const potion = await itemsPage.getMagicItemRowText("Potion of Healing", "XDMG");
		expect(potion.name).toBe("Potion of Healing");
		expect(potion.type).toMatch(/potion/i);
		expect(potion.weight).toMatch(/(?:½|0\.5|1\/2)\s*lb/i);
		expect(potion.value).toMatch(/50\s*gp/i);

		const rod = await itemsPage.getMagicItemRowText("+1 Rod of the Pact Keeper", "XDMG");
		expect(rod.name).toBe("+1 Rod of the Pact Keeper");
		expect(rod.type).toMatch(/rod/i);
		expect(rod.weight).toMatch(/2\s*lb/i);
		expect(rod.attunement).toBe("×");

		await itemsPage.selectMagicItem("Potion of Healing", "XDMG");
		await expect(itemsPage.getSelectedItemDetails()).toContainText(/regain/i);
		await expect(itemsPage.getSelectedItemDetails()).toContainText(/Hit Points/i);

		expect(
			getUnexpectedBrowserErrors(browserErrors),
			`unexpected browser errors: ${browserErrors.map(it => `${it.url}: ${it.text}`).join("; ")}`,
		).toEqual([]);
	});
});
