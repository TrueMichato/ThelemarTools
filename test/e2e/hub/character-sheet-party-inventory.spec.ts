import {expect, test, type BrowserContext, type Route} from "@playwright/test";
import {HubCharacterSheetPartyInventoryPage} from "../pages/HubCharacterSheetPartyInventoryPage";

const RICH_RATIONS = {
	name: "Rations",
	source: "PHB",
	type: "G",
	rarity: "common",
	weight: 2,
	value: 50,
	entries: ["Synthetic metadata used to prove transfer conservation."],
};

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

test("recipient accepts and rejects incoming transfers on the open Character Sheet", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const sourceContext = await browser.newContext(contextOptions);
	const targetContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCharacterSheetPartyInventoryPage(await dmContext.newPage());
		const source = new HubCharacterSheetPartyInventoryPage(await sourceContext.newPage());
		const target = new HubCharacterSheetPartyInventoryPage(await targetContext.newPage());
		await dm.hub.signInSynthetic({providerSubject: "sheet-inbox-dm", displayName: "Inbox DM", secret});
		await source.hub.signInSynthetic({providerSubject: "sheet-inbox-source", displayName: "Inbox Sender", secret});
		await target.hub.signInSynthetic({providerSubject: "sheet-inbox-target", displayName: "Inbox Recipient", secret});
		const campaignId = await dm.hub.createCampaign("Sheet Incoming Transfers E2E");
		await source.hub.redeemInviteTokenViaApi(await dm.hub.createInviteViaApi(campaignId));
		await target.hub.redeemInviteTokenViaApi(await dm.hub.createInviteViaApi(campaignId));
		const inventory = [{id: "rations", item: RICH_RATIONS, quantity: 5}];
		const sender = await source.hub.createCharacter({campaignId, name: "Sender", inventory});
		const recipient = await target.hub.createCharacter({campaignId, name: "Recipient", inventory});
		await source.openOwnedCharacter({campaignId, characterId: sender.id, name: "Sender"});
		await target.openOwnedCharacter({campaignId, characterId: recipient.id, name: "Recipient"});

		await source.shareCharacterItem({itemName: "Rations", quantity: 1, destination: "Recipient — Fighter 1"});
		await target.expectIncomingTransfer({itemName: "Rations", senderName: "Sender"});
		let releaseTransferRefresh = () => {};
		const transferRefreshGate = new Promise<void>(resolve => releaseTransferRefresh = resolve);
		let isTransferRefreshBlocked = false;
		let isTransferRefreshContinued = false;
		const transferListUrl = `**/api/campaigns/${campaignId}/transfers`;
		await target.page.route(transferListUrl, async route => {
			if (route.request().method() !== "GET" || isTransferRefreshBlocked) return route.continue();
			isTransferRefreshBlocked = true;
			await transferRefreshGate;
			await route.continue();
			isTransferRefreshContinued = true;
		});
		try {
			const policy = await source.hub.getProjectionPolicy(sender.id);
			await source.hub.setProjectionPolicy({
				characterId: sender.id,
				expectedProjectionRevision: policy.projectionRevision,
				policy: {version: 1, preset: "private", overrides: {}},
			});
			await expect.poll(() => isTransferRefreshBlocked, {timeout: 15_000}).toBe(true);
			await expect(target.page.locator("[data-charsheet-incoming-transfers]")).not.toContainText("Sender");
		} finally {
			releaseTransferRefresh();
		}
		await expect.poll(() => isTransferRefreshContinued, {timeout: 15_000}).toBe(true);
		await target.page.unroute(transferListUrl);
		await target.expectIncomingTransfer({itemName: "Rations", senderName: "A campaign character"});
		await target.resolveIncomingTransfer({decision: "Reject"});
		await source.expectCharacterQuantity({characterId: sender.id, itemName: "Rations", quantity: 5});
		await target.expectCharacterQuantity({characterId: recipient.id, itemName: "Rations", quantity: 5});

		await source.shareCharacterItem({itemName: "Rations", quantity: 1, destination: "Recipient — Fighter 1"});
		await target.page.reload();
		await target.expectIncomingTransfer({itemName: "Rations", senderName: "A campaign character"});
		const incomingHtml = await target.page.locator("[data-charsheet-incoming-transfers]").evaluate(element => element.outerHTML);
		for (const privateId of [campaignId, sender.id, recipient.id]) expect(incomingHtml).not.toContain(privateId);
		await target.resolveIncomingTransfer({decision: "Accept"});
		await source.expectCharacterQuantity({characterId: sender.id, itemName: "Rations", quantity: 4});
		await target.expectCharacterQuantity({characterId: recipient.id, itemName: "Rations", quantity: 6});

		await source.shareCharacterItem({itemName: "Rations", quantity: 1, destination: "Recipient — Fighter 1"});
		await target.expectIncomingTransfer({itemName: "Rations", senderName: "A campaign character"});
		const resolveUrl = `**/api/campaigns/${campaignId}/transfers/*/resolve`;
		let resolutionRequests = 0;
		const loseCommittedResponse = async (route: Route) => {
			if (route.request().method() !== "POST") return route.continue();
			resolutionRequests++;
			const committed = await route.fetch();
			expect(committed.ok()).toBe(true);
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		};
		await target.page.route(resolveUrl, loseCommittedResponse);
		try {
			const notice = target.page.locator("[data-charsheet-incoming-transfers]");
			await notice.getByRole("button", {name: "Accept transfer"}).click();
			await expect(notice).toBeHidden({timeout: 20_000});
			await expect(target.page.locator(".toast__wrp-content").getByText("Transfer accepted; latest balances confirmed after refresh."))
				.toBeVisible();
			expect(resolutionRequests).toBe(1);
		} finally {
			await target.page.unroute(resolveUrl, loseCommittedResponse);
		}
		await source.expectCharacterQuantity({characterId: sender.id, itemName: "Rations", quantity: 3});
		await target.expectCharacterQuantity({characterId: recipient.id, itemName: "Rations", quantity: 7});
	} finally {
		await pCloseContext(dmContext);
		await pCloseContext(sourceContext);
		await pCloseContext(targetContext);
	}
});

test("a winning stash approval retires insufficient competing requests without manual rejection", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const firstContext = await browser.newContext(contextOptions);
	const secondContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCharacterSheetPartyInventoryPage(await dmContext.newPage());
		const first = new HubCharacterSheetPartyInventoryPage(await firstContext.newPage());
		const second = new HubCharacterSheetPartyInventoryPage(await secondContext.newPage());
		await dm.hub.signInSynthetic({providerSubject: "stash-contend-dm", displayName: "Stash DM", secret});
		await first.hub.signInSynthetic({providerSubject: "stash-contend-first", displayName: "First Requester", secret});
		await second.hub.signInSynthetic({providerSubject: "stash-contend-second", displayName: "Second Requester", secret});
		const campaignId = await dm.hub.createCampaign("Stash Contention E2E");
		for (const player of [first, second]) {
			await player.hub.redeemInviteTokenViaApi(await dm.hub.createInviteViaApi(campaignId));
		}
		const stashSource = await dm.hub.createCharacter({
			campaignId,
			name: "Stash Source",
			inventory: [{id: "rations", item: RICH_RATIONS, quantity: 3}],
		});
		const firstCharacter = await first.hub.createCharacter({campaignId, name: "First Claimant"});
		const secondCharacter = await second.hub.createCharacter({campaignId, name: "Second Claimant"});
		await dm.hub.moveCharacterItemToPartyViaApi({
			campaignId, characterId: stashSource.id, entryId: "rations", quantity: 3,
		});
		await first.openOwnedCharacter({campaignId, characterId: firstCharacter.id, name: "First Claimant"});
		await second.openOwnedCharacter({campaignId, characterId: secondCharacter.id, name: "Second Claimant"});
		await first.requestStashItem({itemName: "Rations", quantity: 2});
		await second.requestStashItem({itemName: "Rations", quantity: 2});

		await dm.hub.approveStashRequestAndExpectCompetingRequestCleared({
			campaignId,
			expectedText: ["Second Claimant", "requests", "2 × Rations", "Party inventory"],
		});
		await expect(first.page.locator(".toast__wrp-content").getByText(/stash request is no longer available/))
			.toBeVisible({timeout: 20_000});
		await first.expectCharacterQuantity({characterId: firstCharacter.id, itemName: "Rations", quantity: 5});
		await second.expectCharacterQuantity({characterId: secondCharacter.id, itemName: "Rations", quantity: 7});
		const remaining = await dm.hub.getPartyInventory(campaignId);
		expect(remaining.inventory.find(entry => entry.item?.name === "Rations")?.quantity).toBe(1);
		const transfers = await dm.hub.page.request.get(`/api/campaigns/${campaignId}/transfers`);
		expect(transfers.ok()).toBe(true);
		const cancelled = (await transfers.json()).transfers.filter(transfer =>
			transfer.status === "cancelled" && transfer.payload?.cancellationReason === "source_insufficient");
		expect(cancelled).toHaveLength(1);
	} finally {
		await pCloseContext(dmContext);
		await pCloseContext(firstContext);
		await pCloseContext(secondContext);
	}
});

test("owned Character Sheets reconcile authoritative party inventory across devices", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext({...contextOptions, serviceWorkers: "block"});
	const recipientContext = await browser.newContext(contextOptions);
	const localContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCharacterSheetPartyInventoryPage(await dmContext.newPage());
		const player = new HubCharacterSheetPartyInventoryPage(await playerContext.newPage());
		const recipient = new HubCharacterSheetPartyInventoryPage(await recipientContext.newPage());
		const local = new HubCharacterSheetPartyInventoryPage(await localContext.newPage());

		await local.expectLocalCharacterHasNoHubInventory();
		const dmSession = await dm.hub.signInSynthetic({providerSubject: "inventory-dm", displayName: "Dungeon Master", secret});
		const playerSession = await player.hub.signInSynthetic({providerSubject: "inventory-player", displayName: "Rowan Vale", secret});
		const recipientSession = await recipient.hub.signInSynthetic({providerSubject: "inventory-recipient", displayName: "Mira Vale", secret});
		const campaignId = await dm.hub.createCampaign("Sheet Inventory E2E");
		const playerInvite = await dm.hub.createInviteViaApi(campaignId);
		const recipientInvite = await dm.hub.createInviteViaApi(campaignId);
		await player.hub.redeemInviteTokenViaApi(playerInvite);
		await recipient.hub.redeemInviteTokenViaApi(recipientInvite);

		const inventory = [{id: "rations", item: RICH_RATIONS, quantity: 5}];
		const sourceCharacter = await player.hub.createCharacter({campaignId, name: "Rowan", inventory});
		const recipientCharacter = await recipient.hub.createCharacter({campaignId, name: "Mira", inventory});
		const dmCharacter = await dm.hub.createCharacter({campaignId, name: "Guide", inventory});
		const partyInventory = await dm.hub.getPartyInventory(campaignId);

		await player.openOwnedCharacterWithRetry({
			campaignId,
			characterId: sourceCharacter.id,
			name: "Rowan",
		});
		await player.expectShareOpensVisibleComposer({itemName: "Rations"});
		await player.expectPrivacySafe({
			forbiddenIds: [
				campaignId,
				partyInventory.id,
				sourceCharacter.id,
				recipientCharacter.id,
				dmSession.account.id,
				playerSession.account.id,
				recipientSession.account.id,
			],
			recipientLabel: "Mira — Fighter 1",
		});

		await dm.hub.submitAuthoritativeItemTransfer({
			campaignId,
			sourceName: "Guide",
			targetName: "Rowan",
			itemName: "Rations",
			quantity: 5,
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 10});

		await player.hub.reserveRepeatedItemTransfersAfterRefreshRetry({
			campaignId,
			sourceName: "Rowan",
			targetName: "Guide",
			itemName: "Rations",
			quantity: 1,
		});
		await dm.hub.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "1 × Rations · PHB", "Guide"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await dm.hub.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "1 × Rations · PHB", "Guide"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await player.openOwnedCharacter({campaignId, characterId: sourceCharacter.id, name: "Rowan"});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 8});

		await player.shareCharacterItem({
			itemName: "Rations",
			quantity: 3,
			destination: "Party stash",
			isSingleFlight: true,
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 5});
		await player.focusInventorySearch();
		await dm.hub.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "3 × Rations · PHB", "Party inventory"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await player.expectStashQuantity({itemName: "Rations", quantity: 3});
		await player.expectInventorySearchStillFocused();
		await player.expectReconnectRefresh();

		await player.requestStashItem({itemName: "Rations", quantity: 1});
		await player.expectStashQuantity({itemName: "Rations", quantity: 3});
		await dm.hub.resolveFirstPendingTransferAfterCommittedRefreshFailure({
			campaignId,
			expectedText: ["Rowan", "requests", "1 × Rations · PHB", "Party inventory"],
			buttonName: "Approve",
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 6});
		await player.expectStashQuantity({itemName: "Rations", quantity: 2});

		await player.requestStashItem({itemName: "Rations", quantity: 1});
		await dm.hub.resolveFirstPendingTransferAfterLostResponse({
			campaignId,
			expectedText: ["Rowan", "requests", "1 × Rations · PHB", "Party inventory"],
			buttonName: "Decline",
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 6});
		await player.expectStashQuantity({itemName: "Rations", quantity: 2});

		await player.requestStashItem({itemName: "Rations", quantity: 1});
		await dm.hub.resolveFirstPendingTransferAfterLostResponse({
			campaignId,
			expectedText: ["Rowan", "requests", "1 × Rations · PHB", "Party inventory"],
			buttonName: "Approve",
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 7});
		await player.expectStashQuantity({itemName: "Rations", quantity: 1});

		await player.shareCharacterItem({
			itemName: "Rations",
			quantity: 1,
			destination: "Mira — Fighter 1",
		});
		await recipient.hub.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "1 × Rations · PHB", "Mira"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 6});
		await recipient.expectCharacterQuantity({characterId: recipientCharacter.id, itemName: "Rations", quantity: 6});

		await player.shareCharacterItem({
			itemName: "Rations",
			quantity: 1,
			destination: "Mira — Fighter 1",
		});
		await recipient.hub.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "1 × Rations · PHB", "Mira"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await player.expectCharacterQuantity({characterId: sourceCharacter.id, itemName: "Rations", quantity: 5});
		await recipient.expectCharacterQuantity({characterId: recipientCharacter.id, itemName: "Rations", quantity: 7});

		await dm.openOwnedCharacter({campaignId, characterId: dmCharacter.id, name: "Guide"});
		await dm.expectStashQuantity({itemName: "Rations", quantity: 1});
		await dm.takeStashItem({itemName: "Rations", quantity: 1});
		await dm.expectCharacterQuantity({characterId: dmCharacter.id, itemName: "Rations", quantity: 3});
		await dm.expectStashEmpty();
		await player.expectStashEmpty();

		await player.expectAccessibleResponsiveNightMode();
		const finalPartyInventory = await dm.hub.getPartyInventory(campaignId);
		expect(finalPartyInventory.inventory).toEqual([]);
		for (const {page, characterId, quantity} of [
			{page: player, characterId: sourceCharacter.id, quantity: 5},
			{page: recipient, characterId: recipientCharacter.id, quantity: 7},
			{page: dm, characterId: dmCharacter.id, quantity: 3},
		]) {
			const character = await page.hub.getCharacter(characterId);
			const matchingEntries = character.data.inventory.filter((entry: any) => entry.item?.name === "Rations");
			expect(matchingEntries.reduce((total: number, entry: any) => total + entry.quantity, 0)).toBe(quantity);
			for (const entry of matchingEntries) expect(entry.item).toEqual(expect.objectContaining(RICH_RATIONS));
		}
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(recipientContext),
			pCloseContext(localContext),
		]);
	}
});
