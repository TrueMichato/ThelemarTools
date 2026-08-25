import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

test("private V1 multi-user lifecycle through the real stack", async ({browser}) => {
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

		await dm.signInSynthetic({providerSubject: "dm", displayName: "Dungeon Master", secret});
		await player.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		const campaignId = await dm.createCampaign("Ashen March E2E");
		const inviteUrl = await dm.createInvite(campaignId);
		await player.redeemInvite(inviteUrl, "Ashen March E2E");

		const character = await player.createCharacter({campaignId, name: "Rowan"});
		await player.openCharacterSheet({campaignId, characterId: character.id, name: "Rowan"});

		await dm.grantXp({campaignId, characterName: "Rowan", amount: 250});
		expect((await player.getCharacter(character.id)).data.xp).toBe(250);

		await player.proposeDamage({campaignId, characterName: "Rowan", amount: 4});
		await dm.applyFirstPendingAction(campaignId);
		expect((await player.getCharacter(character.id)).data.hp.current).toBe(16);

		await player.reserveGoldToParty({campaignId, characterName: "Rowan", amount: 3});
		await dm.acceptFirstPendingTransfer(campaignId);
		expect((await player.getCharacter(character.id)).data.currency.gp).toBe(7);
		expect((await dm.getPartyInventory(campaignId)).currency.gp).toBe(3);

		await secondDevice.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		await player.revokeOtherSession();
		expect((await secondDevice.page.request.get("/api/campaigns")).status()).toBe(401);

		await dm.removeMember({campaignId, displayName: "Rowan Vale"});
		expect((await player.page.request.get(`/api/campaigns/${campaignId}`)).status()).toBe(404);
		expect((await player.getCharacter(character.id)).campaignId).toBeNull();

		await player.requestDeletion();
		await grace.signInSynthetic({providerSubject: "player", displayName: "Rowan Vale", secret});
		expect((await grace.page.request.get("/api/campaigns")).status()).toBe(423);
		await grace.cancelDeletion();
		expect((await grace.page.request.get("/api/campaigns")).status()).toBe(200);
	} finally {
		await Promise.all([
			dmContext.close(),
			playerContext.close(),
			secondDeviceContext.close(),
			graceContext.close(),
		]);
	}
});
