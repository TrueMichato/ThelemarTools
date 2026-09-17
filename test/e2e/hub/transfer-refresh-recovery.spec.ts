import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCharacterSheetPartyInventoryPage} from "../pages/HubCharacterSheetPartyInventoryPage";

const RATIONS = {
	name: "Rations",
	source: "PHB",
	type: "G",
	rarity: "common",
	weight: 2,
	value: 50,
	entries: ["Synthetic inventory for the transfer refresh recovery race."],
};

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

test("a fenced transfer balance retry remains recoverable until replacement refresh succeeds", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCharacterSheetPartyInventoryPage(await dmContext.newPage());
		const player = new HubCharacterSheetPartyInventoryPage(await playerContext.newPage());
		await dm.hub.signInSynthetic({providerSubject: "transfer-recovery-dm", displayName: "Dungeon Master", secret});
		await player.hub.signInSynthetic({providerSubject: "transfer-recovery-player", displayName: "Rowan Vale", secret});
		const campaignId = await dm.hub.createCampaign("Transfer Recovery E2E");
		const invite = await dm.hub.createInviteViaApi(campaignId);
		await player.hub.redeemInviteTokenViaApi(invite);
		await player.hub.createCharacter({
			campaignId,
			name: "Rowan",
			inventory: [{id: "rations", item: RATIONS, quantity: 5}],
		});
		const dmCharacter = await dm.hub.createCharacter({
			campaignId,
			name: "Guide",
			inventory: [{id: "rations", item: RATIONS, quantity: 5}],
		});

		await player.hub.expectTransferRefreshRecoveryAcrossAuthorizationFence({
			campaignId,
			sourceName: "Rowan",
			targetName: "Guide",
			itemName: "Rations",
			quantity: 1,
			onRetryRefreshHeld: async () => {
				const policy = await dm.hub.getProjectionPolicy(dmCharacter.id);
				await dm.hub.setProjectionPolicy({
					characterId: dmCharacter.id,
					expectedProjectionRevision: policy.projectionRevision,
					policy: {
						...policy.policy,
						overrides: {
							...(policy.policy.overrides || {}),
							identity: {mode: "hide"},
						},
					},
				});
				await expect(player.page.locator("#campaign-party-empty")).toHaveText("Refreshing authorized party details...");
			},
		});
	} finally {
		await Promise.all([
			pCloseContext(playerContext),
			pCloseContext(dmContext),
		]);
	}
});
