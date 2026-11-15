import type {Page} from "@playwright/test";

export type EncounterWorkspaceUi = "legacy" | "cockpit";

/**
 * Makes every load of `encounterworkspace.html` in this page open the given UI (`?ew=1` legacy, `?ew=2` cockpit),
 * including in-app navigation such as Bestiary's "Encounter Workspace" button, which links without `ew`.
 * An explicit `ew` already in the URL is left alone.
 */
export async function pinEncounterWorkspaceUi (page: Page, ui: EncounterWorkspaceUi): Promise<void> {
	await page.addInitScript(ew => {
		const url = new URL(globalThis.location.href);
		if (!url.pathname.endsWith("/encounterworkspace.html") || url.searchParams.has("ew")) return;
		url.searchParams.set("ew", ew);
		globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}${url.hash}`);
	}, ui === "cockpit" ? "2" : "1");
}

/** Keeps a legacy spec guarding the legacy UI (`?ew=1`) whatever the router's default is. */
export const pinEncounterWorkspaceLegacyUi = (page: Page) => pinEncounterWorkspaceUi(page, "legacy");
