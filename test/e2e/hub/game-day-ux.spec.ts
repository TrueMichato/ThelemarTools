import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

const contextOptions = {
	baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
	ignoreHTTPSErrors: true,
};

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([context.close(), new Promise<void>(resolve => setTimeout(resolve, 5_000))]);
}

test("local entry actions do not create campaign authority", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		await dm.signInSynthetic({providerSubject: "local-entry-dm", displayName: "Entry DM", secret});
		await player.signInSynthetic({providerSubject: "local-entry-player", displayName: "Entry Player", secret});
		const campaignId = await dm.createCampaign("Local Entry E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const baseline = await dm.getCampaignSnapshot(campaignId);
		const writes: string[] = [];
		player.page.on("request", request => {
			const path = new URL(request.url()).pathname;
			if (request.method() !== "GET" && /^\/api\/characters(?:\/|$)/.test(path)) writes.push(path);
		});
		for (const action of ["open", "create", "import"] as const) {
			await player.openLocalEntryAction({campaignId, action});
		}
		expect(writes).toEqual([]);
		const after = await dm.getCampaignSnapshot(campaignId);
		expect(after.characters).toEqual(baseline.characters);
		expect(after.lastSequence).toBe(baseline.lastSequence);
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(playerContext)]);
	}
});

test("nested sharing preserves unsaved drafts and focus on both entry paths", async ({browser}, testInfo) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const ownerContext = await browser.newContext(contextOptions);
	const peerContext = await browser.newContext(contextOptions);
	try {
		const owner = new HubCampaignPage(await ownerContext.newPage());
		const peer = new HubCampaignPage(await peerContext.newPage());
		await owner.signInSynthetic({providerSubject: "sharing-disclosure-owner", displayName: "Disclosure Owner", secret});
		await peer.signInSynthetic({providerSubject: "sharing-disclosure-peer", displayName: "Disclosure Peer", secret});
		const campaignId = await owner.createCampaign("Sharing Disclosure E2E");
		await peer.redeemInviteTokenViaApi(await owner.createInviteViaApi(campaignId));
		const character = await owner.createCharacter({campaignId, name: "Disclosure Mira"});
		const baseline = await owner.getProjectionPolicy(character.id);
		for (const entry of ["campaign", "ordinary"] as const) {
			if (entry === "campaign") await owner.openCharacterSheet({campaignId, characterId: character.id, name: "Disclosure Mira"});
			else {
				await owner.openBareCharacterSheetDefault(campaignId);
				await owner.selectCharacterOnSheet({characterId: character.id, name: "Disclosure Mira"});
			}
			await owner.waitForSharingReady();
			// Loading this minimal fixture backfills class features through the normal save
			// path. Measure the disclosures after that load, not against the unrepaired seed.
			const peerBaseline = await peer.getCharacterProjection(character.id);
			await owner.expectSharingDraftSurvivesDisclosures();
			const after = await owner.getProjectionPolicy(character.id);
			expect(after.policy).toEqual(baseline.policy);
			expect(after.projectionRevision).toBe(baseline.projectionRevision);
			expect(await peer.getCharacterProjection(character.id)).toEqual(peerBaseline);
		}
		for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
			for (const theme of ["day", "night"]) {
				await owner.page.setViewportSize(viewport);
				await owner.page.evaluate(theme_ => (window as any).styleSwitcher._setActiveStyleTheme(theme_), theme);
				await expect(owner.page.locator("#charsheet-sharing-hp-state")).toHaveValue("Unsaved steady");
				expect(await owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
				await testInfo.attach(`sharing-${viewport.width}-${theme}`, {
					body: await owner.page.locator(".charsheet__sharing").screenshot(),
					contentType: "image/png",
				});
			}
		}
	} finally {
		await Promise.all([pCloseContext(ownerContext), pCloseContext(peerContext)]);
	}
});
