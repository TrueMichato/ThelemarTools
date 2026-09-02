import {expect, Page, Request, Route} from "@playwright/test";
import {waitForToolsLoaded} from "../utils/waitHelpers";
import {HubCampaignPage} from "./HubCampaignPage";

export class HubCharacterSheetPartyInventoryPage {
	readonly page: Page;
	readonly hub: HubCampaignPage;

	constructor (page: Page) {
		this.page = page;
		this.hub = new HubCampaignPage(page);
	}

	async expectLocalCharacterHasNoHubInventory (): Promise<void> {
		const inventoryApiRequests: string[] = [];
		const onRequest = (request: Request) => {
			const url = new URL(request.url());
			if (
				/^\/api\/campaigns\/[^/]+\/(?:party-inventory|transfers|snapshot)(?:\/|$)/.test(url.pathname)
			) inventoryApiRequests.push(url.pathname);
		};
		this.page.on("request", onRequest);
		try {
			await this.page.goto("/charactersheet.html");
			await waitForToolsLoaded(this.page);
			await expect(this.page.locator("[data-charsheet-party-inventory]")).toHaveCount(0);
		} finally {
			this.page.off("request", onRequest);
		}
		expect(inventoryApiRequests, "A local/signed-out sheet must not activate party-inventory APIs").toEqual([]);
	}

	async openOwnedCharacterWithRetry ({
		campaignId,
		characterId,
		name,
	}: {
		campaignId: string;
		characterId: string;
		name: string;
	}): Promise<void> {
		const matcher = `**/api/campaigns/${campaignId}/party-inventory`;
		const handler = (route: Route) => route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		await this.page.route(matcher, handler);
		await this.hub.openCharacterSheet({campaignId, characterId, name});
		await this.openInventoryTab();
		const root = this.root();
		await expect(root).toBeVisible();
		await expect(root.getByRole("alert")).toContainText("could not be loaded");
		await this.page.unroute(matcher, handler);
		await root.getByRole("button", {name: "Retry"}).click();
		await expect(root).toContainText("Nothing is stored here yet.");
		await expect(root.getByRole("alert")).toHaveCount(0);
	}

	async openOwnedCharacter ({
		campaignId,
		characterId,
		name,
	}: {
		campaignId: string;
		characterId: string;
		name: string;
	}): Promise<void> {
		await this.hub.openCharacterSheet({campaignId, characterId, name});
		await this.openInventoryTab();
		await expect(this.root()).toBeVisible();
	}

	async openInventoryTab (): Promise<void> {
		await this.page.locator("a[href='#charsheet-tab-inventory']").click();
		await expect(this.page.locator("#charsheet-tab-inventory")).toBeVisible();
	}

	root () {
		return this.page.locator("[data-charsheet-party-inventory]");
	}

	async expectPrivacySafe ({forbiddenIds, recipientLabel}: {forbiddenIds: string[]; recipientLabel: string}): Promise<void> {
		const itemRow = this.page.locator("#charsheet-inventory-list .charsheet__item", {
			has: this.page.locator(".charsheet__item-name", {hasText: "Rations"}),
		});
		await itemRow.getByRole("button", {name: "Share Rations with the party"}).click();
		const destination = this.root().getByLabel("Destination");
		await expect(destination.locator("option")).toContainText(["Party stash", recipientLabel]);
		const html = await this.root().evaluate(element => element.outerHTML);
		for (const id of forbiddenIds) expect(html).not.toContain(id);
		await this.root().getByRole("button", {name: "Cancel"}).click();
	}

	async shareCharacterItem ({
		itemName,
		quantity,
		destination,
		isSingleFlight = false,
	}: {
		itemName: string;
		quantity: number;
		destination: string;
		isSingleFlight?: boolean;
	}): Promise<void> {
		const itemRow = this.page.locator("#charsheet-inventory-list .charsheet__item", {
			has: this.page.locator(".charsheet__item-name", {hasText: itemName}),
		});
		await itemRow.getByRole("button", {name: `Share ${itemName} with the party`}).click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		await composer.getByLabel("Quantity").fill(`${quantity}`);
		await composer.getByLabel("Destination").selectOption({label: destination});
		await expect(composer.locator(".charsheet__party-inventory-confirmation")).toContainText(`${quantity} × ${itemName}`);

		if (!isSingleFlight) {
			await composer.getByRole("button", {name: "Confirm transfer"}).click();
		} else {
			let requests = 0;
			const onRequest = (request: Request) => {
				if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/transfers")) requests++;
			};
			this.page.on("request", onRequest);
			try {
				await composer.evaluate((form: HTMLFormElement) => {
					form.requestSubmit();
					form.requestSubmit();
				});
				await expect(composer).toHaveCount(0);
			} finally {
				this.page.off("request", onRequest);
			}
			expect(requests, "Double submission must produce one transfer request").toBe(1);
		}
		await expect(this.root().locator("[data-party-inventory-live]")).toContainText(/Transfer reserved|Transfer complete/);
	}

	async takeStashItem ({itemName, quantity}: {itemName: string; quantity: number}): Promise<void> {
		const row = this.root().getByRole("listitem").filter({hasText: itemName});
		await row.getByRole("button", {name: `Move ${itemName} to this character`}).click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		await composer.getByLabel("Quantity").fill(`${quantity}`);
		await expect(composer).toContainText("DestinationThis character");
		await composer.getByRole("button", {name: "Confirm transfer"}).click();
		await expect(composer).toHaveCount(0);
		await expect(this.root().locator("[data-party-inventory-live]")).toContainText("Transfer complete");
	}

	async expectStashQuantity ({itemName, quantity}: {itemName: string; quantity: number}): Promise<void> {
		const row = this.root().getByRole("listitem").filter({hasText: itemName});
		await expect(row).toContainText(itemName, {timeout: 15_000});
		await expect(row.locator(".charsheet__party-inventory-quantity")).toHaveAttribute("aria-label", `Quantity ${quantity}`, {timeout: 15_000});
	}

	async expectCharacterQuantity ({characterId, itemName, quantity}: {characterId: string; itemName: string; quantity: number}): Promise<void> {
		await expect.poll(async () => {
			const character = await this.hub.getCharacter(characterId);
			return character.data.inventory
				.filter((entry: any) => entry.item?.name === itemName)
				.reduce((total: number, entry: any) => total + entry.quantity, 0);
		}).toBe(quantity);
	}

	async focusInventorySearch (): Promise<void> {
		await this.page.locator("#charsheet-ipt-inventory-search").focus();
		await expect(this.page.locator("#charsheet-ipt-inventory-search")).toBeFocused();
	}

	async expectInventorySearchStillFocused (): Promise<void> {
		await expect(this.page.locator("#charsheet-ipt-inventory-search")).toBeFocused();
	}

	async expectReconnectRefresh (): Promise<void> {
		let refreshRequests = 0;
		const onRequest = (request: Request) => {
			if (new URL(request.url()).pathname.endsWith("/party-inventory")) refreshRequests++;
		};
		this.page.on("request", onRequest);
		try {
			await this.page.context().setOffline(true);
			await this.page.evaluate(() => (window as any).charSheet?._hubRealtime?._active?.client?._socket?.close());
			await expect(this.root()).toContainText("Reconnecting to the Campaign Hub");
			await this.page.context().setOffline(false);
			await expect.poll(() => refreshRequests, {timeout: 15_000}).toBeGreaterThan(0);
			await expect(this.root().getByLabel("Party stash connected live")).toBeVisible();
		} finally {
			await this.page.context().setOffline(false);
			this.page.off("request", onRequest);
		}
	}

	async expectAccessibleResponsiveNightMode (): Promise<void> {
		await this.page.setViewportSize({width: 390, height: 844});
		await this.page.evaluate(() => document.documentElement.classList.add("night-mode"));
		const audit = await this.root().evaluate(element => {
			const controls = [...element.querySelectorAll<HTMLElement>("button, input, select")];
			const unlabeled = controls.filter(control => {
				const labels = "labels" in control ? [...((control as HTMLInputElement).labels || [])] : [];
				return !control.getAttribute("aria-label") && !control.textContent?.trim() && !labels.length;
			});
			return {
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
				unlabeled: unlabeled.map(control => control.tagName),
			};
		});
		expect(audit.scrollWidth).toBeLessThanOrEqual(audit.clientWidth);
		expect(audit.unlabeled).toEqual([]);
		await this.page.setViewportSize({width: 1280, height: 720});
	}
}
