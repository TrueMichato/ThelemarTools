import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

test("character edits and rolls update live while a second device is safely fenced", async ({browser}) => {
	test.setTimeout(150_000);
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

		await dm.signInSynthetic({providerSubject: "realtime-dm", displayName: "Realtime DM", secret});
		await player.signInSynthetic({providerSubject: "realtime-player", displayName: "Mira Thorn", secret});
		await otherDevice.signInSynthetic({providerSubject: "realtime-player", displayName: "Mira Thorn", secret});
		const campaignId = await dm.createCampaign("Realtime Table E2E");
		const invite = await dm.createInviteViaApi(campaignId);
		await player.redeemInviteTokenViaApi(invite);
		const character = await player.createCharacter({campaignId, name: "Mira"});
		await dm.gotoCampaign(campaignId);

		await player.editCharacterHpAndRollInitiative({campaignId, characterId: character.id, name: "Mira", hp: 11});
		await dm.expectLiveCharacterUpdateAndRoll({characterName: "Mira", hp: 11});

		await otherDevice.openCharacterSheet({campaignId, characterId: character.id, name: "Mira"});
		await otherDevice.editCharacterHpAndResolveDeviceConflict({
			campaignId,
			characterId: character.id,
			name: "Mira",
			hp: 10,
			resolution: "Use Local",
		});
		await expect.poll(async () => (await player.getCharacter(character.id)).data.hp.current).toBe(10);

		await player.editCharacterHpAndResolveDeviceConflict({
			campaignId,
			characterId: character.id,
			name: "Mira",
			hp: 9,
			resolution: "Use Server",
		});
		await expect(player.page.locator("#charsheet-ipt-hp-current")).toHaveValue("10");
		expect((await player.getCharacter(character.id)).data.hp.current).toBe(10);
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(otherDeviceContext),
		]);
	}
});
