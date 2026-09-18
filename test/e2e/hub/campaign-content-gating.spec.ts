import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {HubCampaignPage} from "../pages/HubCampaignPage";

test.describe("Campaign Hub content policy", () => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};

	test.beforeEach(() => {
		if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	});

	test("filters new choices, grandfathers legacy content, rejects bypasses, and converges after rollback", async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "content-gating-dm", displayName: "Content Gating DM", secret: secret!});
			const campaignId = await hub.createCampaign("Content Gating E2E");
			await hub.publishDefaultCampaignRulesViaApi(campaignId);
			const legacy = await hub.createCharacter({
				campaignId,
				name: "Legacy XPHB Fighter",
				classSource: "XPHB",
				race: {name: "Dragonborn", source: "XPHB", edition: "one"},
			});
			const {rulesVersionId, previousRulesVersionId} = await hub.publishContentPolicyViaApi({
				campaignId,
				sources: ["PHB"],
				species: ["Human (Base)|PHB"],
				editions: ["2014"],
			});

			await hub.expectDirectCharacterAdmissionRejected({
				campaignId,
				rulesVersionId,
				name: "Private Denied Character",
				source: "XPHB",
			});

			const builderPage = await context.newPage();
			const builderSheet = new CharacterSheetPage(builderPage);
			await builderSheet.gotoCampaignBuilder(campaignId);
			await builderSheet.expectCampaignBuilderSources({allowed: "PHB'14", denied: "PHB'24"});
			await builderSheet.expectCampaignBuilderRaces({allowed: "Human", denied: "Elf"});

			const legacyPage = await context.newPage();
			const legacySheet = new CharacterSheetPage(legacyPage);
			await legacySheet.gotoCampaignCharacter({campaignId, characterId: legacy.id});
			await legacySheet.expectCampaignPolicyWarning({source: "XPHB"});
			await legacySheet.renameCharacter("Playable Legacy Fighter");
			await expect.poll(async () => (await hub.getCharacter(legacy.id)).data.name).toBe("Playable Legacy Fighter");
			await legacySheet.expectMulticlassSources({allowed: "PHB'14", denied: "PHB'24"});

			const localPage = await context.newPage();
			const localHub = new HubCampaignPage(localPage);
			await localHub.expectLocalCharacterCopyRejectedByContentPolicy({
				campaignId,
				name: "Local XPHB Import",
				source: "XPHB",
			});

			await hub.activateRulesPolicyVersionViaApi({
				campaignId,
				rulesVersionId: previousRulesVersionId,
				expectedActiveRulesVersionId: rulesVersionId,
			});
			await legacySheet.expectCampaignPolicyWarning({source: "XPHB", visible: false});
			await builderSheet.gotoCampaignBuilder(campaignId);
			await builderSheet.expectCampaignBuilderSources({allowed: "PHB'24", denied: "not-present"});
		} finally {
			await context.close();
		}
	});

	test("uses a newly published rules version for import and award without reloading", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "current-context-dm", displayName: "Current Context DM", secret: secret!});
			const localCharacterName = "Current Context Fighter";
			await hub.seedLocalCharacterForCampaignImport({name: localCharacterName});
			const campaignId = await hub.createCampaign("Current Context E2E");
			await hub.publishDefaultCampaignRulesViaApi(campaignId);
			await hub.gotoCampaign(campaignId);
			const {rulesVersionId} = await hub.publishContentPolicyViaApi({
				campaignId,
				sources: ["PHB"],
				species: ["Human (Base)|PHB"],
				editions: ["2014"],
			});
			await hub.expectCurrentRulesVersionUsedForImportAndAward({
				campaignId,
				rulesVersionId,
				localCharacterName,
			});
		} finally {
			await context.close();
		}
	});
});
