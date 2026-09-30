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
		const originalGuidePolicy = await dm.hub.getProjectionPolicy(dmCharacter.id);

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
				const partyRefresh = player.page.locator("#campaign-party-empty");
				await expect(partyRefresh).toBeVisible();
				await expect(partyRefresh).toHaveText("Refreshing authorized party details...");
			},
		});

		await player.hub.gotoCampaign(campaignId);
		await player.hub.openCampaignWorkbench();
		await player.page.locator("#campaign-transfer-source").selectOption({label: "Rowan"});
		await player.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		const rations = player.page.locator("#campaign-transfer-entry option", {hasText: "Rations"}).first();
		await player.page.locator("#campaign-transfer-entry").selectOption(await rations.getAttribute("value") || "");
		await player.page.locator("#campaign-transfer-quantity").fill("1");
		let signalPost = () => {};
		const postStarted = new Promise<void>(resolve => signalPost = resolve);
		let releasePost = () => {};
		const postGate = new Promise<void>(resolve => releasePost = resolve);
		await player.page.route(`**/api/campaigns/${campaignId}/transfers`, async route => {
			if (route.request().method() === "POST") {
				signalPost();
				await postGate;
			}
			await route.continue();
		});
		await player.page.locator("#campaign-transfer-form button[type='submit']").click();
		await postStarted;
		const guidePolicy = await dm.hub.getProjectionPolicy(dmCharacter.id);
		await dm.hub.setProjectionPolicy({
			characterId: dmCharacter.id,
			expectedProjectionRevision: guidePolicy.projectionRevision,
			policy: originalGuidePolicy.policy,
		});
		await expect(player.page.locator("#campaign-transfer-form button[type='submit']")).toHaveText("Retry transfer");
		await expect(player.page.locator("#campaign-transfer-form-status")).toContainText("transfer outcome is not yet confirmed");
		const firstResponse = player.page.waitForResponse(response =>
			response.request().method() === "POST"
			&& new URL(response.url()).pathname === `/api/campaigns/${campaignId}/transfers`,
		);
		releasePost();
		expect((await firstResponse).status()).toBe(201);
		await expect(player.page.locator("#campaign-transfer-form button[type='submit']")).toBeEnabled();
		await player.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(player.page.locator("#campaign-transfer-form-status")).toContainText("Transfer reserved.");
		await dm.hub.gotoCampaign(campaignId);
		await expect(dm.page.locator("#campaign-pending-transfers .hub-data-row").filter({hasText: "Party inventory"})).toHaveCount(1);
	} finally {
		await Promise.all([
			pCloseContext(playerContext),
			pCloseContext(dmContext),
		]);
	}
});
