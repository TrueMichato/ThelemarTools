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

test("an open character sheet resolves peer effects and adopts authoritative outcomes inline", async ({browser}) => {
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
		const dm = new HubCampaignPage(await dmContext.newPage());
		const source = new HubCampaignPage(await sourceContext.newPage());
		const target = new HubCampaignPage(await targetContext.newPage());
		await dm.signInSynthetic({providerSubject: "effect-ui-dm", displayName: "Effect UI DM", secret});
		await source.signInSynthetic({providerSubject: "effect-ui-source", displayName: "Aster", secret});
		await target.signInSynthetic({providerSubject: "effect-ui-target", displayName: "Bryn", secret});

		const campaignId = await dm.createCampaign("Effect UI E2E");
		await source.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await target.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const sourceCharacter = await source.createCharacter({
			campaignId,
			name: "Aster",
			features: [{name: "Steadying Word", source: "TST"}],
		});
		const targetCharacter = await target.createCharacter({campaignId, name: "Bryn", hpCurrent: 5});
		const targetProjection = await target.getCharacterProjection(targetCharacter.id);

		await source.createPeerEffect({
			campaignId,
			sourceCharacterId: sourceCharacter.id,
			targetRef: targetProjection.targetRef,
			amount: 4,
		});
		await target.openCharacterSheet({campaignId, characterId: targetCharacter.id, name: "Bryn"});

		const effectRegion = target.page.locator("#charsheet-hub-effects");
		await expect(effectRegion).toBeVisible();
		await expect(effectRegion).toContainText("Steadying Word");
		await expect(effectRegion).toContainText("From Aster");
		expect(await effectRegion.getAttribute("hidden")).toBeNull();
		const privateText = await effectRegion.innerText();
		expect(privateText).not.toContain(targetCharacter.id);
		expect(privateText).not.toContain(sourceCharacter.id);

		const hpInput = target.page.locator("#charsheet-ipt-hp-current");
		await target.waitForCharacterRealtimeLive();
		await hpInput.focus();
		await source.createPeerEffect({
			campaignId,
			sourceCharacterId: sourceCharacter.id,
			targetRef: targetProjection.targetRef,
			amount: 2,
		});
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(2);
		await expect(hpInput).toBeFocused();

		await effectRegion.getByRole("button", {name: /Approve Steadying Word/}).first().click();
		await expect(hpInput).toHaveValue("9");
		await expect(effectRegion).toContainText("4 hit points restored by the campaign.");
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(1);

		await effectRegion.getByRole("button", {name: /Reject Steadying Word/}).click();
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(0);
		await expect(hpInput).toHaveValue("9");
		expect(target.page.url()).toContain("/charactersheet.html");
	} finally {
		await Promise.all([dmContext.close(), sourceContext.close(), targetContext.close()]);
	}
});
