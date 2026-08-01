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
	// Only suppress the site's homebrew/index.json fan-out when this call
	// supplies its own brew. Specs that rely on the auto-imported brew set
	// (e.g. TGTT races such as Minotaur) must keep the real fan-out, or
	// character creation fails with "Could not find race ...".
	if (additionalBrewUrls.length) {
		await page.route("**/homebrew/index.json", route => route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({toImport: []}),
		}));
	}
	const additionalBrews = await Promise.all(additionalBrewUrls.map(async url => {
		const response = await page.request.get(url, {timeout: 30_000});
		if (!response.ok()) throw new Error(`Failed to download additional homebrew "${url}": HTTP ${response.status()}`);
		const brew = await response.json();
		if (!subclassName) return brew;
		const classes = (brew.class || []).filter((it: any) => !className || it.name === className);
		const isHomebrewClass = classes.length > 0;
		const subclasses = (brew.subclass || []).filter((it: any) =>
			(it.shortName === subclassName || it.name === subclassName)
			&& (!className || it.className === className));
		const subclassShortNames = new Set(subclasses.map((it: any) => it.shortName));
		return {
			_meta: brew._meta,
			...(isHomebrewClass ? {
				class: classes,
				classFeature: (brew.classFeature || []).filter((it: any) => !className || it.className === className),
				optionalfeature: brew.optionalfeature || [],
				// A homebrew base class may also learn `psionic` powers (MCDM's Talent).
				// Those are republished as synthetic optional features by the sheet, so
				// dropping them here would silently remove the class's core choice.
				...(brew.psionic?.length ? {psionic: brew.psionic} : {}),
			} : {}),
			subclass: subclasses,
			subclassFeature: (brew.subclassFeature || []).filter((it: any) =>
				subclassShortNames.has(it.subclassShortName)
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
