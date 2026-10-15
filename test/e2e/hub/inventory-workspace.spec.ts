import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";
import {HubCharacterSheetPartyInventoryPage} from "../pages/HubCharacterSheetPartyInventoryPage";

const RATIONS = {
	name: "Rations",
	source: "PHB",
	type: "G",
	rarity: "common",
	weight: 2,
	value: 50,
	entries: ["Synthetic metadata for the role-adaptive inventory workspace."],
};

async function closeContext (context: BrowserContext): Promise<void> {
	await Promise.race([context.close().catch(() => undefined), new Promise<void>(resolve => setTimeout(resolve, 5_000))]);
}

test("DM, player and spectator share one stash workspace without duplicate editors or hidden character reads", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const options = {baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true};
	const dmContext = await browser.newContext(options);
	const playerContext = await browser.newContext(options);
	const spectatorContext = await browser.newContext(options);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCharacterSheetPartyInventoryPage(await playerContext.newPage());
		const spectator = new HubCampaignPage(await spectatorContext.newPage());
		await dm.signInSynthetic({providerSubject: "workspace-dm", displayName: "Workspace DM", secret});
		await player.hub.signInSynthetic({providerSubject: "workspace-player", displayName: "Workspace Player", secret});
		await spectator.signInSynthetic({providerSubject: "workspace-spectator", displayName: "Workspace Spectator", secret});
		const campaignId = await dm.createCampaign("Role-adaptive Inventory Workspace");
		await player.hub.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await spectator.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId, "spectator"));
		const guide = await dm.createCharacter({campaignId, name: "Guide", inventory: [{id: "rations", item: RATIONS, quantity: 12}]});
		const rowan = await player.hub.createCharacter({campaignId, name: "Rowan", inventory: []});
		const reads = [dm, player.hub, spectator].map(viewer => viewer.watchInventoryWorkspaceCharacterReads());
		try {
			await dm.expectLightweightCampaignBoot(campaignId);
			await player.hub.gotoCampaign(campaignId);
			await spectator.gotoCampaign(campaignId);
			await expect(dm.page.locator("[data-inventory-empty]")).toContainText("shared stash is empty");
			await dm.moveInventoryWorkspaceItem({sourceName: "Guide", targetName: "Party inventory", itemName: "Rations", quantity: 5, currency: {gp: 10}});
			await dm.expectInventoryWorkspace({role: "dm", itemName: "Rations", quantity: 5, gold: 10});
			await player.hub.expectInventoryWorkspace({role: "player", itemName: "Rations", quantity: 5, ownedNames: ["Rowan"], gold: 10});
			await spectator.expectInventoryWorkspace({role: "spectator", itemName: "Rations", quantity: 5, gold: 10});
			await expect(spectator.page.locator("#campaign-inventory-workspace")).not.toContainText("Rowan");
			await expect(player.page.locator("[data-inventory-guidance]")).toContainText("A DM must approve");
			await dm.expectInventoryWorkspaceDraftSurvives(() => dm.moveCharacterItemToPartyViaApi({campaignId, characterId: guide.id, entryId: "rations", quantity: 1}));
			for (let index = 1; index <= 3; index++) {
				await dm.moveInventoryWorkspaceItem({sourceName: "Party inventory", targetName: "Rowan", itemName: "Rations", quantity: 1, currency: {gp: 1}});
				await player.hub.expectInventoryWorkspace({role: "player", itemName: "Rations", quantity: 6 - index, ownedNames: ["Rowan"], gold: 10 - index});
			}
			for (const read of reads) expect(read.paths).toEqual([]);
		} finally {
			for (const read of reads) read.stop();
		}
		await player.hub.openInventoryWorkspaceSheet("Rowan");
		await player.openInventoryTab();
		await player.requestStashItem({itemName: "Rations", quantity: 2});
		await dm.approveInventoryWorkspaceRequest("Rowan");
		await player.expectCharacterQuantity({characterId: rowan.id, itemName: "Rations", quantity: 5});
		const character = await player.hub.getCharacter(rowan.id);
		expect(character.data.inventory.find(entry => entry.item?.name === "Rations")?.item).toEqual(RATIONS);
		const remaining = await dm.getPartyInventory(campaignId);
		expect(remaining.inventory.find(entry => entry.item?.name === "Rations")?.quantity).toBe(1);
		expect(remaining.inventory.find(entry => entry.item?.name === "Rations")?.item).toEqual(RATIONS);
		expect(remaining.currency.gp).toBe(7);
		await dm.expectAccessibleResponsiveCampaign(campaignId);
	} finally {
		await closeContext(dmContext);
		await closeContext(playerContext);
		await closeContext(spectatorContext);
	}
});

test("membership loss conceals shared inventory before a previously authorized delayed read returns", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const options = {baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true};
	const dmContext = await browser.newContext(options);
	const playerContext = await browser.newContext(options);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		await dm.signInSynthetic({providerSubject: "workspace-fence-dm", displayName: "Fence DM", secret});
		await player.signInSynthetic({providerSubject: "workspace-fence-player", displayName: "Fence Player", secret});
		const campaignId = await dm.createCampaign("Inventory Workspace Access Fence");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const source = await dm.createCharacter({campaignId, name: "Guide", inventory: [{id: "rations", item: RATIONS, quantity: 5}]});
		await dm.moveCharacterItemToPartyViaApi({campaignId, characterId: source.id, entryId: "rations", quantity: 2});
		await player.gotoCampaign(campaignId);
		await player.expectInventoryWorkspace({role: "player", itemName: "Rations", quantity: 2});
		await player.expectInventoryWorkspaceAccessLoss({
			campaignId,
			startRefresh: () => dm.moveCharacterItemToPartyViaApi({campaignId, characterId: source.id, entryId: "rations", quantity: 1}),
			revokeAccess: () => dm.removeMember({campaignId, displayName: "Fence Player"}),
		});
	} finally {
		await closeContext(dmContext);
		await closeContext(playerContext);
	}
});

test("an initial stash read failure is recoverable without sending a transfer or repeating a command", async ({browser}) => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const context = await browser.newContext({baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true});
	try {
		const dm = new HubCampaignPage(await context.newPage());
		await dm.signInSynthetic({providerSubject: "workspace-initial-read-dm", displayName: "Read Recovery DM", secret});
		const campaignId = await dm.createCampaign("Inventory Workspace Initial Read Recovery");
		const source = await dm.createCharacter({campaignId, name: "Guide", inventory: [{id: "rations", item: RATIONS, quantity: 5}]});
		await dm.moveCharacterItemToPartyViaApi({campaignId, characterId: source.id, entryId: "rations", quantity: 2});
		await dm.expectInventoryWorkspaceInitialReadRetry(campaignId);
	} finally {
		await closeContext(context);
	}
});
