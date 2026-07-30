import {Page} from "@playwright/test";

/**
 * Wait for the character sheet page to fully load
 * Waits for the 'toolsLoaded' event which fires when all data is ready
 */
export async function waitForToolsLoaded (page: Page): Promise<void> {
	await page.waitForFunction(
		() =>
			// @ts-ignore - window.charSheet is set by the app after initialization
			window.charSheet !== undefined,
		{timeout: 60000},
	);
}

/**
 * Wait for a specific element to have content (not empty)
 */
export async function waitForContentLoaded (page: Page, selector: string): Promise<void> {
	await page.waitForFunction(
		sel => {
			const el = document.querySelector(sel);
			return el && el.children.length > 0;
		},
		selector,
		{timeout: 15000},
	);
}

/**
 * Wait for list items to populate in a builder list.
 *
 * On timeout, reports which builder step is actually on screen. Without that,
 * a step-order change upstream surfaces only as an opaque 15s timeout on a
 * selector that will never appear (see CS-BUG-025, where the Builder gained a
 * name-first step and every spec died waiting for `#builder-race-list`).
 */
export async function waitForListItems (page: Page, listSelector: string, minCount = 1): Promise<void> {
	try {
		await page.waitForFunction(
			({sel, min}) => {
				const items = document.querySelectorAll(`${sel} .charsheet__builder-list-item`);
				return items.length >= min;
			},
			{sel: listSelector, min: minCount},
			{timeout: 15000},
		);
	} catch (e) {
		const heading = await page
			.locator("#charsheet-builder .charsheet__section h4")
			.first()
			.textContent()
			.catch(() => null);
		throw new Error(
			`Timed out waiting for >=${minCount} item(s) in "${listSelector}". `
			+ `The builder is currently showing the "${heading?.trim() ?? "unknown"}" step — `
			+ `the wizard is probably not on the step this helper expects. `
			+ `If the Builder's step order changed, update test/e2e/utils/characterBuilder.ts.`,
			{cause: e},
		);
	}
}
