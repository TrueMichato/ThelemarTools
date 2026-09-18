import {expect, test, type BrowserContext} from "@playwright/test";
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
