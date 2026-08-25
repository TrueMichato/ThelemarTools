import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

test("private V1 budgets hold across six members, replay, large documents, and transfer contention", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const contexts = await Promise.all(Array.from({length: 6}, () => browser.newContext({
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	})));
	try {
		const pages = await Promise.all(contexts.map(async context => new HubCampaignPage(await context.newPage())));
		await Promise.all(pages.map((page, index) => page.signInSynthetic({
			providerSubject: `load-${index}`,
			displayName: index === 0 ? "Load DM" : `Load Player ${index}`,
			secret,
		})));
		const campaignId = await pages[0].createCampaign("Hub Load E2E");
		for (const player of pages.slice(1)) {
			const token = await pages[0].createInviteViaApi(campaignId);
			await player.redeemInviteTokenViaApi(token);
		}
		expect(await pages[0].getMembers(campaignId)).toHaveLength(6);

		const character = await pages[1].createCharacter({campaignId, name: "Contended"});
		await pages[2].createNearLimitCharacter({campaignId, name: "Large Character"});
		await pages[1].logRolls({campaignId, characterId: character.id, count: 500});
		const events = await pages[0].getEvents(campaignId);
		expect(events).toHaveLength(500);
		expect(events.filter(event => event.type === "roll.logged").length).toBeGreaterThanOrEqual(480);

		const party = await pages[0].getPartyInventory(campaignId);
		expect(await pages[1].reserveGoldConcurrently({
			campaignId,
			characterId: character.id,
			partyInventoryId: party.id,
			amount: 7,
		})).toEqual([201, 409]);
	} finally {
		await Promise.all(contexts.map(context => context.close()));
	}
});
