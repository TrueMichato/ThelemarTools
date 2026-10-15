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

	async expectRefreshAfterAuthorityReturn (): Promise<void> {
		await this.openInventoryTab();
		const refresh = this.root().getByRole("button", {name: "Refresh", exact: true});
		await expect(refresh).toBeEnabled();
		await refresh.click();
		await expect(this.root()).toContainText("Party stash refreshed.");
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

	async expectShareOpensVisibleComposer ({itemName}: {itemName: string}): Promise<void> {
		const itemRow = this.page.locator("#charsheet-inventory-list .charsheet__item", {
			has: this.page.locator(".charsheet__item-name", {hasText: itemName}),
		}).first();
		const share = itemRow.getByRole("button", {name: `Share ${itemName} with the party`});
		await share.click();
		const composer = this.root().getByRole("form", {name: "Confirm inventory transfer"});
		const quantity = composer.getByLabel("Quantity");
		await expect(quantity).toBeFocused();
		const box = await quantity.boundingBox();
		const viewport = this.page.viewportSize();
		expect(box).not.toBeNull();
		expect(viewport).not.toBeNull();
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
		await expect(this.root().locator("[data-party-inventory-live]")).toContainText("No item has moved");
		await composer.getByRole("button", {name: "Cancel"}).click();
		await expect(share).toBeFocused();
	}

	async expectIncomingTransfer ({itemName, senderName}: {itemName: string; senderName: string}): Promise<void> {
		const notice = this.page.locator("[data-charsheet-incoming-transfers]");
		await expect(notice).toBeVisible({timeout: 20_000});
		await expect(notice).toContainText(itemName);
		await expect(notice).toContainText(senderName);
		await expect(notice.getByRole("button", {name: "Accept transfer"})).toBeVisible();
		await expect(notice.getByRole("button", {name: "Reject transfer"})).toBeVisible();
	}

	async resolveIncomingTransfer ({decision}: {decision: "Accept" | "Reject"}): Promise<void> {
		const notice = this.page.locator("[data-charsheet-incoming-transfers]");
		await notice.getByRole("button", {name: `${decision} transfer`}).click();
		await expect(notice).toBeHidden({timeout: 20_000});
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

	async requestStashItemDuringProjectionRevalidation ({
		campaignId,
		itemName,
		quantity,
		onProposalHeld,
	}: {
		campaignId: string;
		itemName: string;
		quantity: number;
		onProposalHeld: () => Promise<void>;
	}): Promise<void> {
		await this.hub.waitForCharacterRealtimeLive();
		await expect.poll(() => this.page.evaluate(() => {
			const inventory = (globalThis as any).charSheet?._partyInventory;
			return !!inventory?._hasTransferAuthority?.() && !inventory?._refreshPromise && !inventory?._isLoading;
		})).toBe(true);
		const events: string[] = [];
		let holdSnapshots = false;
		let heldSnapshotCount = 0;
		let proposalCount = 0;
		let resolutionCount = 0;
		let transferId: string | null = null;
		let releaseProposal: () => void = () => {};
		const proposalRelease = new Promise<void>(resolve => releaseProposal = resolve);
		let releaseSnapshots: () => void = () => {};
		const snapshotsRelease = new Promise<void>(resolve => releaseSnapshots = resolve);
		const transferMatcher = `**/api/campaigns/${campaignId}/transfers`;
		const snapshotMatcher = `**/api/campaigns/${campaignId}/snapshot`;
		const onRequest = (request: Request) => {
			if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/resolve")) resolutionCount++;
		};
		const transferHandler = async (route: Route) => {
			if (route.request().method() !== "POST") return route.continue();
			proposalCount++;
			const response = await route.fetch();
			expect(response.ok(), await response.text()).toBe(true);
			transferId = (await response.json()).transfer.id;
			events.push("proposal committed; response held");
			await proposalRelease;
			events.push("proposal acknowledgement released");
			await route.fulfill({response});
		};
		const snapshotHandler = async (route: Route) => {
			if (holdSnapshots) {
				heldSnapshotCount++;
				events.push("authorized snapshot read held");
				await snapshotsRelease;
			}
			await route.continue();
		};
		await this.page.route(transferMatcher, transferHandler);
		await this.page.route(snapshotMatcher, snapshotHandler);
		this.page.on("request", onRequest);
		let submission: Promise<Error | null> | null = null;
		try {
			submission = this.requestStashItem({itemName, quantity}).then(() => null, error => error);
			await expect.poll(() => transferId).not.toBeNull();
			holdSnapshots = true;
			await onProposalHeld();
			await expect.poll(() => heldSnapshotCount).toBeGreaterThan(0);
			await expect.poll(() => this.page.evaluate(() => {
				const inventory = (globalThis as any).charSheet?._partyInventory;
				return {pending: inventory?._isAuthorityPending, role: inventory?._role, canTransfer: inventory?._hasTransferAuthority?.()};
			})).toEqual({pending: true, role: "player", canTransfer: false});
			events.push("projection authority pending; player role retained");
			releaseProposal();
			await expect.poll(() => this.page.evaluate(() =>
				(globalThis as any).charSheet?._partyInventory?._draft?.transfer?.id)).toBe(transferId);
			const error = await this.page.evaluate(() => (globalThis as any).charSheet?._partyInventory?._error);
			expect(error || "").not.toContain("role is read-only");
			holdSnapshots = false;
			events.push("fresh authorized reads released");
			releaseSnapshots();
			const submissionError = await submission;
			if (submissionError) throw submissionError;
			expect(proposalCount, "Revalidation must not re-propose the acknowledged request").toBe(1);
			expect(resolutionCount, "Revalidation must not accept the player's stash request").toBe(0);
		} catch (error) {
			const product = await this.page.evaluate(() => {
				const inventory = (globalThis as any).charSheet?._partyInventory;
				return {
					role: inventory?._role,
					pending: inventory?._isAuthorityPending,
					isSubmitting: inventory?._isSubmitting,
					transferStatus: inventory?._draft?.transfer?.status,
					error: inventory?._error,
					refreshFlags: inventory?._refreshFlags,
					hasRefresh: !!inventory?._refreshPromise,
				};
			});
			throw new Error(`${error instanceof Error ? error.message : error}\nControlled B2 authority interleaving: ${JSON.stringify({events, proposalCount, resolutionCount, heldSnapshotCount, product})}`);
		} finally {
			holdSnapshots = false;
			releaseProposal();
			releaseSnapshots();
			await submission;
			this.page.off("request", onRequest);
			await this.page.unroute(transferMatcher, transferHandler);
			await this.page.unroute(snapshotMatcher, snapshotHandler);
		}
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
