import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

test("private V1 multi-user lifecycle through the real stack", async ({browser}) => {
	test.setTimeout(240_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const secondDeviceContext = await browser.newContext(contextOptions);
	const graceContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const secondDevice = new HubCampaignPage(await secondDeviceContext.newPage());
		const grace = new HubCampaignPage(await graceContext.newPage());

		await dm.expectLightweightSignedOutBoot();
		await dm.expectAccessibleResponsiveHub();
		await dm.expectReleaseAssets();
		await dm.signInSynthetic({providerSubject: "dm", displayName: "Dungeon Master", secret});
		await player.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		await dm.expectOrdinaryReadLatency();
		const campaignId = await dm.createCampaign("Ashen March E2E");
		await dm.expectLightweightCampaignBoot(campaignId);
		await dm.expectAccessibleResponsiveCampaign(campaignId);
		await dm.expectOfflineReconnectPosture(campaignId);
		const inviteUrl = await dm.createInvite(campaignId);
		await player.redeemInvite(inviteUrl, "Ashen March E2E");
		await player.expectCampaignDmScreenDenied(campaignId);

		const character = await player.copyLocalCharacterFromSheet({campaignId, name: "Rowan"});
		await dm.expectProtocolUpgradeRecovery({campaignId, characterName: "Rowan"});
		await dm.expectCampaignPartyTrackerProjection({campaignId, name: "Rowan"});
		await dm.gotoCampaign(campaignId);
		await player.editCharacterHpAndRollInitiative({campaignId, characterId: character.id, name: "Rowan", hp: 11});
		await dm.expectLiveCharacterUpdateAndRoll({characterName: "Rowan", hp: 11});

		await dm.grantXp({campaignId, characterName: "Rowan", amount: 250});
		expect((await player.getCharacter(character.id)).data.xp).toBe(250);
		const spellcaster = await player.createCharacter({campaignId, name: "Mira"});
		await dm.awardCatalogItems({
			campaignId,
			characterNames: ["Rowan", "Mira"],
			itemName: "Longsword",
			source: "PHB",
			quantity: 2,
			note: "For the Ashen Pass",
		});
		await player.expectLiveAwardArrival({itemName: "Longsword", source: "PHB", quantity: 2});
		expect((await player.getCharacter(character.id)).data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"}), quantity: 2}),
		]));
		expect((await player.getCharacter(spellcaster.id)).data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"}), quantity: 2}),
		]));

		await dm.applyDamage({campaignId, characterName: "Rowan", amount: 4});
		expect((await player.getCharacter(character.id)).data.hp.current).toBe(7);
		expect(spellcaster.data.spellcasting.spellSlots[1].current).toBe(2);
		await dm.spendSpellSlot({campaignId, characterName: "Mira", level: 1, amount: 1});
		expect((await player.getCharacter(spellcaster.id)).data.spellcasting.spellSlots[1].current).toBe(1);
		await dm.expectInsufficientSpellSlotSpend({campaignId, characterName: "Mira", level: 1, amount: 2});

		await player.reserveItemAndCurrencyToParty({
			campaignId,
			characterName: "Rowan",
			itemName: "Longsword",
			quantity: 1,
			currency: {cp: 3, sp: 2, ep: 1, gp: 3, pp: 1},
		});
		await dm.acceptFirstPendingTransfer({
			campaignId,
			expectedText: ["Rowan", "1 × Longsword · PHB", "3 CP", "2 SP", "1 EP", "3 GP", "1 PP", "Party inventory"],
			expectedAbsentText: ["Rowan Vale"],
		});
		await dm.expectTransferItemAvailable({sourceName: "Party inventory", itemName: "Longsword"});
		const transferredCharacter = await player.getCharacter(character.id);
		expect(transferredCharacter.data.currency).toEqual(expect.objectContaining({cp: 5, sp: 4, ep: 3, gp: 7, pp: 1}));
		expect(transferredCharacter.data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"}), quantity: 1}),
		]));
		const partyInventory = await dm.getPartyInventory(campaignId);
		expect(partyInventory.currency).toEqual(expect.objectContaining({cp: 3, sp: 2, ep: 1, gp: 3, pp: 1}));
		expect(partyInventory.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"}), quantity: 1}),
		]));
		await dm.awardStashItems({
			campaignId,
			characterNames: ["Mira"],
			itemName: "Longsword",
			source: "PHB",
			quantity: 1,
		});
		expect((await dm.getPartyInventory(campaignId)).inventory).not.toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"})}),
		]));
		expect((await player.getCharacter(spellcaster.id)).data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({item: expect.objectContaining({name: "Longsword", source: "PHB"}), quantity: 3}),
		]));
		await player.expectInsufficientTransferFeedback({campaignId, characterName: "Rowan"});

		await secondDevice.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		await secondDevice.gotoCampaign(campaignId);
		await player.revokeOtherSession();
		expect((await secondDevice.page.request.get("/api/campaigns")).status()).toBe(401);
		await secondDevice.expectSessionRevokedWhileOpen({characterName: "Rowan"});

		await player.gotoCampaign(campaignId);
		await dm.removeMember({campaignId, displayName: "Rowan Vale"});
		await player.expectMembershipRevokedWhileOpen({characterName: "Rowan"});
		expect((await player.page.request.get(`/api/campaigns/${campaignId}`)).status()).toBe(404);
		expect((await player.getCharacter(character.id)).campaignId).toBeNull();

		await player.requestDeletion();
		await grace.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		expect((await grace.page.request.get("/api/campaigns")).status()).toBe(423);
		await grace.cancelDeletion();
		expect((await grace.page.request.get("/api/campaigns")).status()).toBe(200);
		await player.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		await player.signOutAndExpectLocalCharacter({characterId: character.clientImportId, name: "Rowan"});
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(secondDeviceContext),
			pCloseContext(graceContext),
		]);
	}
});
