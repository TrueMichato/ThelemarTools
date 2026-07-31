import {Page} from "@playwright/test";

/** URL of the Thelemar JSON served by the local web server */
const THELEMAR_URL = "/TravelersGuidetoThelemar.json";

/**
 * Load the Travelers Guide to Thelemar homebrew into the character sheet.
 *
 * Uses the site's own BrewUtil2.pAddBrewFromUrl() on the character sheet page,
 * then refreshes the character sheet's internal data via page reload.
 */
export async function gotoWithThelemar (
	page: Page,
	additionalBrewUrls: string[] = [],
	{subclassName, className}: {subclassName?: string; className?: string} = {},
): Promise<void> {
	await page.route("**/homebrew/index.json", route => route.fulfill({
		contentType: "application/json",
		body: JSON.stringify({toImport: []}),
	}));
	const additionalBrews = await Promise.all(additionalBrewUrls.map(async url => {
		const response = await page.request.get(url, {timeout: 30_000});
		if (!response.ok()) throw new Error(`Failed to download additional homebrew "${url}": HTTP ${response.status()}`);
		const brew = await response.json();
		if (!subclassName) return brew;
		return {
			_meta: brew._meta,
			subclass: (brew.subclass || []).filter((it: any) =>
				(it.shortName === subclassName || it.name === subclassName)
				&& (!className || it.className === className)),
			subclassFeature: (brew.subclassFeature || []).filter((it: any) =>
				it.subclassShortName === subclassName
				&& (!className || it.className === className)),
		};
	}));
	for (let i = 0; i < additionalBrews.length; ++i) {
		await page.route(`**/__e2e-homebrew-${i}.json`, route => route.fulfill({
			contentType: "application/json",
			body: JSON.stringify(additionalBrews[i]),
		}));
	}

	// Navigate to character sheet and wait for full init
	await page.goto("/charactersheet.html");
	await page.waitForFunction(
		() => (window as any).charSheet !== undefined,
		{timeout: 60000},
	);

	// Load the brew using the site's own API
	const result = await page.evaluate(async ({url, additionalBrewCount}: {url: string; additionalBrewCount: number}) => {
		try {
			await (window as any).BrewUtil2.pAddBrewFromUrl(url);
			for (let i = 0; i < additionalBrewCount; ++i) {
				await (window as any).BrewUtil2.pAddBrewFromUrl(`/__e2e-homebrew-${i}.json`);
			}
			return "OK";
		} catch (e: any) {
			return "ERROR: " + e.message;
		}
	}, {url: THELEMAR_URL, additionalBrewCount: additionalBrews.length});

	if (result !== "OK") {
		throw new Error(`Failed to load Thelemar homebrew: ${result}`);
	}

	// The brew is now stored in IndexedDB. Navigate fresh to charactersheet.html
	// so it picks up the brew during its init flow.
	// Use a cache-bust query to avoid hitting the addInitScript from clearCharacterStorage
	await page.goto("/charactersheet.html?_brewloaded=1");
	await page.waitForFunction(
		() => (window as any).charSheet !== undefined,
		{timeout: 90000},
	);

	// Wait for builder lists to populate with homebrew data
	await page.waitForTimeout(2000);
}

/**
 * Clear all homebrew data.
 */
export async function clearHomebrewStorage (page: Page): Promise<void> {
	try {
		await page.evaluate(async () => {
			const BU2 = (window as any).BrewUtil2;
			if (BU2?.pSetBrew) {
				await BU2.pSetBrew([]);
			}
		});
	} catch { /* page may have navigated */ }
}
