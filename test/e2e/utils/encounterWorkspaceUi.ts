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

export async function readEncounterCockpitLayout (page: Page) {
	return page.evaluate(() => {
		const rect = (selector: string) => {
			const el = document.querySelector<HTMLElement>(selector);
			if (!el) throw new Error(`Missing cockpit element: ${selector}`);
			const {left, top, right, bottom, width, height} = el.getBoundingClientRect();
			return {left, top, right, bottom, width, height, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth};
		};
		const bar = rect(".ewc-bar");
		const clusters = [".ewc-bar__enc", ".ewc-bar__turn", ".ewc-bar__tools"].map(rect);
		const turn = clusters[1];
		const turnChildren = [...document.querySelectorAll(".ewc-bar__turn > *")].map(el => el.getBoundingClientRect());
		return {
			bar,
			clusters,
			stage: rect(".ewc-stage"),
			statblock: rect(".ewc-sb"),
			turnChip: rect(".ewc-turnchip"),
			rail: rect(".ewc-rail"),
			dock: rect(".ewc-dock"),
			log: rect(".ewc-log"),
			viewportHeight: innerHeight,
			documentWidth: document.documentElement.scrollWidth,
			turnFits: turnChildren.every(child => child.left >= turn.left - 1 && child.right <= turn.right + 1),
		};
	});
}
