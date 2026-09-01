import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

test("campaign characters recover from detachment and copy or move safely", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const otherDeviceContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const otherDevice = new HubCampaignPage(await otherDeviceContext.newPage());

		await dm.signInSynthetic({providerSubject: "character-flow-dm", displayName: "Character Flow DM", secret});
		await player.signInSynthetic({providerSubject: "character-flow-player", displayName: "Mira Thorn", secret});
		await otherDevice.signInSynthetic({providerSubject: "character-flow-player", displayName: "Mira Thorn", secret});

		const sourceCampaignId = await dm.createCampaign("Ember Coast E2E");
		const sourceInvite = await dm.createInviteViaApi(sourceCampaignId);
		await player.redeemInviteTokenViaApi(sourceInvite);
		const targetCampaignId = await dm.createCampaign("Glass Fen E2E");
		const targetInvite = await dm.createInviteViaApi(targetCampaignId);
		await player.redeemInviteTokenViaApi(targetInvite);

		const character = await player.createCharacter({campaignId: sourceCampaignId, name: "Mira"});
		await dm.removeMember({campaignId: sourceCampaignId, displayName: "Mira Thorn"});
		expect((await player.getCharacter(character.id)).campaignId).toBeNull();
		await player.expectDetachedCharacterInHub({characterId: character.id, name: "Mira"});

		const returnInvite = await dm.createInviteViaApi(sourceCampaignId);
		await player.redeemInviteTokenViaApi(returnInvite);
		await player.attachDetachedCharacterFromSheet({
			characterId: character.id,
			campaignId: sourceCampaignId,
			name: "Mira",
		});
		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		const clone = await player.cloneCharacterFromSheet({
			characterId: character.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Mira",
		});
		expect(clone.id).not.toBe(character.id);
		expect(clone.campaignId).toBe(targetCampaignId);
		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		await player.prepareCharacterMove({
			characterId: character.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Mira",
		});
		await player.releaseCharacterLease(character.id);
		await otherDevice.acquireCharacterLease(character.id);
		await player.attemptPreparedCharacterMoveExpectingLeaseRefusal();
		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		await otherDevice.releaseCharacterLease(character.id);
		const moved = await player.completePreparedCharacterMove({
			characterId: character.id,
			targetCampaignId,
		});
		const canonicalBeforeReplay = await player.getCharacter(character.id);
		expect(canonicalBeforeReplay.campaignId).toBe(targetCampaignId);
		const replay = await player.replayCharacterMove({
			characterId: character.id,
			campaignId: targetCampaignId,
			idempotencyKey: moved.idempotencyKey,
		});
		expect(replay.character.id).toBe(character.id);
		expect(replay.character.campaignId).toBe(targetCampaignId);
		expect(await player.getCharacter(character.id)).toEqual(canonicalBeforeReplay);
		await player.expectStaleCharacterUrlCanonicalized({
			characterId: character.id,
			staleCampaignId: sourceCampaignId,
			canonicalCampaignId: targetCampaignId,
		});
	} finally {
		await Promise.all([
			dmContext.close(),
			playerContext.close(),
			otherDeviceContext.close(),
		]);
	}
});
