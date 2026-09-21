import {Page} from "@playwright/test";

export interface CharacterFixture {
	id: string;
	name: string;
	// Allow any additional character properties
	[key: string]: unknown;
}

/**
 * Clear all character data from storage before page load.
 * Clears both localStorage and IndexedDB (localforage) entries.
 */
export async function clearCharacterStorage (page: Page): Promise<void> {
	// Clear the current document immediately, then install a one-shot init
	// guard for the next navigation. Without the guard, every page reload in a
	// persistence test would erase the character before the app can load it.
	await page.evaluate(() => {
		sessionStorage.removeItem("__charsheet_test_storage_cleared");
		localStorage.removeItem("charsheet-characters");
		localStorage.removeItem("charsheet-current-character");
		try {
			const req = indexedDB.deleteDatabase("localforage");
			req.onerror = () => {};
		} catch { /* ignore */ }
	}).catch(() => {});
	await page.addInitScript(() => {
		if (sessionStorage.getItem("__charsheet_test_storage_cleared")) return;
		sessionStorage.setItem("__charsheet_test_storage_cleared", "1");
		// Clear localStorage keys
		localStorage.removeItem("charsheet-characters");
		localStorage.removeItem("charsheet-current-character");
		// Clear IndexedDB (localforage) — the app actual storage backend
		try {
			const req = indexedDB.deleteDatabase("localforage");
			req.onerror = () => {};
		} catch { /* ignore */ }
	});
}

/**
 * Get the current character data from the page's runtime state
 */
export async function getCurrentCharacterFromPage (page: Page): Promise<Record<string, unknown> | null> {
	return await page.evaluate(() => {
		// Access the app's character sheet state if available
		const cs = (window as any).charSheet;
		if (cs?._state) {
			return cs._state.toJson?.() || cs._state._state || null;
		}
		return null;
	});
}
