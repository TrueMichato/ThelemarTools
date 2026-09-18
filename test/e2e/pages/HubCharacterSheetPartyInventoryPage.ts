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
		let failedRefreshRequests = 0;
		let failedRefreshRequestsAfterRetryArm = 0;
		let manualRetryRequests = 0;
		let retryPhase: "initial" | "armed" | "admitted" = "initial";
		const startedAt = Date.now();
		const requestLog: Array<{atMs: number; kind: string; event: string; phase: string}> = [];
		const onRequest = (request: Request) => {
			if (request.method() !== "GET") return;
			const pathname = new URL(request.url()).pathname;
			const kind = pathname === `/api/campaigns/${campaignId}/party-inventory`
				? "party-inventory"
				: pathname === `/api/campaigns/${campaignId}/snapshot`
					? "snapshot"
					: null;
			if (!kind) return;
			requestLog.push({atMs: Date.now() - startedAt, kind, event: "request", phase: retryPhase});
		};
		const getFailureDiagnostics = async () => ({
			harness: {
				retryPhase,
				failedRefreshRequests,
				failedRefreshRequestsAfterRetryArm,
				manualRetryRequests,
				requestLog,
			},
			product: await this.page.evaluate(() => {
				const sheet = (globalThis as any).charSheet;
				const partyInventory = sheet?._partyInventory;
				const active = partyInventory?._active;
				const refresh = partyInventory?._refreshPromise;
				return {
					active: active
						? {
							characterId: active.characterId,
							generation: active.generation,
							isOwner: active.isOwner,
							isActivationPending: active.isActivationPending,
						}
						: null,
					isCurrentActive: active ? partyInventory?._isCurrent?.(active) : false,
					hasManualRefreshPromise: !!partyInventory?._manualRefreshPromise,
					hasRefreshPromise: !!refresh,
					isRefreshActiveCurrent: !!refresh && refresh.active === active,
					refreshFlags: partyInventory?._refreshFlags,
					isScheduledRefresh: partyInventory?._scheduledRefresh,
					isLoading: partyInventory?._isLoading,
					refreshNotice: partyInventory?._refreshNotice,
					partyError: partyInventory?._partyError,
					reconcileError: partyInventory?._reconcileError,
					actionError: partyInventory?._error,
					hasPartyFetchToken: !!partyInventory?._partyFetchToken,
					currentCharacterId: sheet?._currentCharacterId,
					characterLoadGeneration: sheet?._characterLoadGeneration,
				};
			}),
		});
		let markManualRetryAdmitted: () => void = () => {};
		const manualRetryAdmitted = new Promise<void>(resolve => {
			markManualRetryAdmitted = resolve;
		});
		let releaseManualRetry: () => void = () => {};
		const manualRetryRelease = new Promise<void>(resolve => {
			releaseManualRetry = resolve;
		});
		let markManualRetryComplete: () => void = () => {};
		const manualRetryComplete = new Promise<void>(resolve => {
			markManualRetryComplete = resolve;
		});
		const handler = async (route: Route): Promise<void> => {
			if (retryPhase === "armed") {
				requestLog.push({atMs: Date.now() - startedAt, kind: "party-inventory", event: "admit", phase: retryPhase});
				retryPhase = "admitted";
				manualRetryRequests++;
				markManualRetryAdmitted();
				try {
					await manualRetryRelease;
					await route.continue();
				} finally {
					markManualRetryComplete();
				}
				return;
			}
			requestLog.push({atMs: Date.now() - startedAt, kind: "party-inventory", event: "fail", phase: retryPhase});
			if (retryPhase === "initial") failedRefreshRequests++;
			else failedRefreshRequestsAfterRetryArm++;
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		};
		this.page.on("request", onRequest);
		await this.page.route(matcher, handler);
		try {
			await this.hub.openCharacterSheet({campaignId, characterId, name});
			await this.openInventoryTab();
			await this.page.evaluate(async () => {
				const partyInventory = (globalThis as any).charSheet?._partyInventory;
				await partyInventory?._active?.activationPromise;
			});
			const root = this.root();
			await expect(root).toBeVisible();
			try {
				await expect(root.getByRole("alert")).toContainText("could not be loaded");
			} catch (error) {
				throw new Error(`${error instanceof Error ? error.message : error}\nParty Inventory diagnostics: ${JSON.stringify(await getFailureDiagnostics())}`);
			}
			expect(failedRefreshRequests, "At least one initial party-stash refresh must fail before Retry is exercised.").toBeGreaterThanOrEqual(1);
			const retryButton = root.getByRole("button", {name: "Retry", exact: true});
			await expect(retryButton).toBeEnabled();
			retryPhase = "armed";
			await retryButton.click();
			try {
				await expect.poll(
					() => retryPhase,
					{message: `Manual retry was not admitted: phase=${retryPhase}; admitted=${manualRetryRequests}; initialFailures=${failedRefreshRequests}; postArmFailures=${failedRefreshRequestsAfterRetryArm}`},
				).toBe("admitted");
			} catch (error) {
				throw new Error(`${error instanceof Error ? error.message : error}\nParty Inventory diagnostics: ${JSON.stringify(await getFailureDiagnostics())}`);
			}
			await manualRetryAdmitted;
			await expect(root.getByRole("button", {name: "Refreshing..."})).toBeDisabled();
			await expect(root.getByText("Retrying party stash sync...", {exact: true})).toBeVisible();
			releaseManualRetry();
			await manualRetryComplete;
			await expect(root).toContainText("Party stash refreshed.");
			expect(manualRetryRequests, "Only the refresh initiated by the real Retry click may succeed.").toBe(1);
			expect(retryPhase, "The one-shot retry admission must be consumed synchronously.").toBe("admitted");
			expect(failedRefreshRequestsAfterRetryArm, "No automatic refresh may race or follow the admitted manual retry.").toBe(0);
			await expect(root).toContainText("Nothing is stored here yet.");
			await expect(root.getByRole("alert")).toHaveCount(0);
		} finally {
			releaseManualRetry();
			if (manualRetryRequests) await manualRetryComplete;
			await this.page.unroute(matcher, handler);
			this.page.off("request", onRequest);
		}
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

	async _expectTransferSubmitted (): Promise<void> {
		try {
			await expect(this.root().locator("[data-party-inventory-live]"))
				.toContainText(/Transfer reserved|Transfer complete/, {timeout: 15_000});
		} catch (error) {
			const recovery = await this.page.evaluate(() => {
				const sheet: any = (globalThis as any).charSheet;
				return sheet?._characterRepository?.getConflictRecovery?.(sheet?._currentCharacterId) || null;
			});
			throw new Error(`${error instanceof Error ? error.message : error}\nConflict recovery: ${JSON.stringify(recovery)}`);
		}
	}

	async expectPrivacySafe ({forbiddenIds, recipientLabel}: {forbiddenIds: string[]; recipientLabel: string}): Promise<void> {
		const itemRow = this.page.locator("#charsheet-inventory-list .charsheet__item", {
			has: this.page.locator(".charsheet__item-name", {hasText: "Rations"}),
		}).first();
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
		}).first();
		await itemRow.getByRole("button", {name: `Share ${itemName} with the party`}).click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		await composer.getByLabel("Quantity").fill(`${quantity}`);
		await composer.getByLabel("Destination").selectOption({label: destination});
		await expect(composer.locator(".charsheet__party-inventory-confirmation")).toContainText(`${quantity} × ${itemName}`);

		if (!isSingleFlight) {
			await composer.locator("button[type='submit']").click();
			await this._expectTransferSubmitted();
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
				await this._expectTransferSubmitted();
			} finally {
				this.page.off("request", onRequest);
			}
			expect(requests, "Double submission must produce one transfer request").toBe(1);
		}
		await expect(composer).toHaveCount(0);
	}

	async takeStashItem ({itemName, quantity}: {itemName: string; quantity: number}): Promise<void> {
		const row = this.root().getByRole("listitem").filter({hasText: itemName});
		await row.getByRole("button", {name: `Move ${itemName} to this character`}).click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		await composer.getByLabel("Quantity").fill(`${quantity}`);
		await expect(composer).toContainText("DestinationThis character");
		await composer.getByRole("button", {name: "Move now"}).click();
		await expect(composer).toHaveCount(0);
		await expect(this.root().locator("[data-party-inventory-live]")).toContainText("Transfer complete");
	}

	async requestStashItem ({itemName, quantity}: {itemName: string; quantity: number}): Promise<void> {
		const row = this.root().getByRole("listitem").filter({hasText: itemName});
		await row.getByRole("button", {name: `Request ${itemName} for this character`}).click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		await composer.getByLabel("Quantity").fill(`${quantity}`);
		await expect(composer).toContainText("A DM must approve before anything leaves the stash.");
		await composer.getByRole("button", {name: "Send request"}).click();
		await expect(composer).toHaveCount(0);
		await expect(this.root().locator("[data-party-inventory-live]")).toContainText("Request sent");
	}

	async expectStashQuantity ({itemName, quantity}: {itemName: string; quantity: number}): Promise<void> {
		const row = this.root().getByRole("listitem").filter({hasText: itemName});
		await expect(row).toContainText(itemName, {timeout: 15_000});
		await expect(row.locator(".charsheet__party-inventory-quantity")).toHaveAttribute("aria-label", `Quantity ${quantity}`, {timeout: 15_000});
	}

	async expectStashEmpty (): Promise<void> {
		await expect(this.root()).toContainText("Nothing is stored here yet.", {timeout: 15_000});
		await expect(this.root().getByRole("listitem")).toHaveCount(0);
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
			const didRenderReconnect = await this.page.evaluate(async () => {
				const client = (window as any).charSheet?._hubRealtime?._active?.client;
				const socket = client?._socket;
				if (!client || !socket) return false;
				return new Promise<boolean>(resolve => {
					let unsubscribe = () => {};
					const timeout = window.setTimeout(() => {
						unsubscribe();
						resolve(false);
					}, 5_000);
					unsubscribe = client.on("state", (state: any) => {
						if (!["reconnecting", "unavailable"].includes(state?.state)) return;
						window.clearTimeout(timeout);
						unsubscribe();
						window.requestAnimationFrame(() => {
							const root = document.querySelector("[data-charsheet-party-inventory]");
							resolve(root?.textContent?.includes("Reconnecting to the Campaign Hub") === true);
						});
					});
					socket.close();
				});
			});
			expect(didRenderReconnect).toBe(true);
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
