import {expect, test, type BrowserContext, type Page, type TestInfo} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

async function pCaptureOverview ({
	helper,
	campaignId,
	label,
	primaryAction,
	role,
	testInfo,
	theme,
	viewport,
}: {
	helper: HubCampaignPage;
	campaignId: string;
	label: string;
	primaryAction: "dm" | "character" | "character-setup" | "character-choice" | "read-only";
	role: "dm" | "co_dm" | "player" | "spectator";
	testInfo: TestInfo;
	theme: "day" | "night";
	viewport: {width: number; height: number};
}): Promise<void> {
	await helper.page.setViewportSize(viewport);
	await helper.expectRoleAdaptiveCampaignOverview({campaignId, role, primaryAction});
	await helper.page.evaluate(theme_ => localStorage.setItem("StyleSwitcher_style", theme_), theme);
	await helper.page.reload();
	await expect(helper.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
	const layout = await helper.page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
		theme: document.documentElement.classList.contains("ve-night-mode") ? "night" : "day",
	}));
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
	expect(layout.theme).toBe(theme);
	await testInfo.attach(label, {
		body: await helper.page.screenshot({fullPage: true}),
		contentType: "image/png",
	});
}

test("DM inspection is read-only and condition actions use the canonical picker", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		await dm.signInSynthetic({providerSubject: "authority-dm", displayName: "Authority DM", secret});
		await player.signInSynthetic({providerSubject: "authority-player", displayName: "Authority Player", secret});
		const campaignId = await dm.createCampaign("Authority and Conditions E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const character = await player.createCharacter({campaignId, name: "Readonly Rowan"});

		await dm.gotoCampaign(campaignId);
		const row = dm.page.locator("#campaign-character-list .hub-data-row", {hasText: "Readonly Rowan"});
		await expect(row).toContainText("Inspect sheet");
		await expect(row).toHaveAttribute("title", "Open this character in a read-only DM view");

		const ownerOnlyRequests: string[] = [];
		const characterMutations: string[] = [];
		dm.page.on("request", request => {
			const pathname = new URL(request.url()).pathname;
			if ([
				`/api/characters/${character.id}/lease`,
				`/api/characters/${character.id}/projection-policy`,
				`/api/campaigns/${campaignId}/characters/${character.id}/pending-actions`,
				`/api/campaigns/${campaignId}/characters/${character.id}/outgoing-actions`,
				`/api/campaigns/${campaignId}/party-inventory`,
			].includes(pathname)) ownerOnlyRequests.push(pathname);
			if (
				pathname === `/api/characters/${character.id}`
				&& ["POST", "PATCH", "DELETE"].includes(request.method())
			) characterMutations.push(request.method());
		});

		await row.click();
		await dm.page.waitForFunction(() => !!(globalThis as any).charSheet, undefined, {timeout: 60_000});
		await expect(dm.page.locator("#charsheet-ipt-name")).toHaveValue("Readonly Rowan");
		await expect(dm.page.locator("#charsheet-ipt-name")).toBeDisabled();
		await expect(dm.page.locator("#charsheet-btn-export")).toBeEnabled();
		await expect(dm.page.locator("#charsheet-campaign .charsheet__campaign-detail"))
			.toContainText("Read-only DM view");
		await expect(dm.page.locator("#charsheet-sel-character option:checked")).toContainText("(read-only)");
		await expect(dm.page.locator(".charsheet__sharing")).toHaveCount(0);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet.isCurrentCharacterReadOnly())).toBe(true);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._saveCurrentCharacter())).toBe(true);
		expect(ownerOnlyRequests).toEqual([]);
		expect(characterMutations).toEqual([]);
		expect((await player.getCharacter(character.id)).data.name).toBe("Readonly Rowan");

		await dm.gotoCampaign(campaignId);
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		await dm.page.locator("#campaign-action-target").selectOption({label: "Readonly Rowan"});
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		const condition = dm.page.locator("#campaign-action-condition");
		await expect(condition).toBeEnabled();
		await expect(condition.locator("option", {hasText: "Blinded (PHB)"})).toHaveCount(1);
		await expect(condition.locator("option", {hasText: "Blinded (XPHB)"})).toHaveCount(1);
		await condition.selectOption({label: "Blinded (PHB)"});
		await dm.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(dm.page.locator("#campaign-action-form-status")).toHaveText("Effect applied.");
		await expect.poll(
			async () => (await player.getCharacter(character.id)).data.conditions,
			{timeout: 20_000},
		).toContainEqual({name: "Blinded", source: "PHB"});
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(playerContext)]);
	}
});

test("campaign overview remains role-aware across responsive day and night states", async ({browser}, testInfo) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const spectatorContext = await browser.newContext(contextOptions);
	const pageErrors: string[] = [];
	let archiveTransitionCampaignId: string | null = null;
	const isExpectedArchiveReadFailure = (url: string) => archiveTransitionCampaignId != null
		&& new URL(url).pathname.startsWith(`/api/campaigns/${archiveTransitionCampaignId}/`);
	const watchErrors = (page: Page) => {
		page.on("pageerror", error => pageErrors.push(error.message));
		page.on("console", message => {
			if (message.type() === "error") {
				const source = message.location().url;
				if (source && isExpectedArchiveReadFailure(source)) return;
				pageErrors.push(source ? `${message.text()} (${source})` : message.text());
			}
		});
		page.on("response", response => {
			if (response.status() === 404 && isExpectedArchiveReadFailure(response.url())) return;
			if (response.status() >= 400) pageErrors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
		});
	};

	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const spectator = new HubCampaignPage(await spectatorContext.newPage());
		for (const helper of [dm, player, spectator]) watchErrors(helper.page);

		await dm.signInSynthetic({providerSubject: "overview-dm", displayName: "Dungeon Master", secret});
		await player.signInSynthetic({providerSubject: "overview-player", displayName: "Rowan Vale", secret});
		await spectator.signInSynthetic({providerSubject: "overview-spectator", displayName: "Former Player Observer", secret});
		const campaignId = await dm.createCampaign("The Fellowship of the Unreasonably Long Ashen March");

		const playerInvite = await dm.createInviteViaApi(campaignId, "player");
		const spectatorInvite = await dm.createInviteViaApi(campaignId, "player");
		await player.redeemInviteTokenViaApi(playerInvite);
		await spectator.redeemInviteTokenViaApi(spectatorInvite);
		await player.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character-setup",
		});
		await expect(player.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await player.createCharacter({campaignId, name: "Rowan of the Far-Wandering Lantern"});
		await player.expectCampaignPrimaryAction({
			primaryAction: "character",
			characterName: "Rowan of the Far-Wandering Lantern",
		});
		await player.createCharacter({campaignId, name: "Morrow Quill, Keeper of the Second Watch"});
		await player.expectCampaignPrimaryAction({primaryAction: "character-choice"});
		await spectator.createCharacter({campaignId, name: "Retained Watcher"});
		await spectator.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character",
			characterName: "Retained Watcher",
		});
		await expect(spectator.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await spectator.page.goto("/hub.html");
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "spectator"});
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "player"});
		await spectator.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character",
			characterName: "Retained Watcher",
		});
		await expect(spectator.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "spectator"});
		await expect(spectator.page.locator("#campaign-content")).toHaveAttribute("data-campaign-role", "spectator", {timeout: 15_000});
		await spectator.expectCampaignPrimaryAction({primaryAction: "read-only"});
		await expect(spectator.page.locator("#campaign-workbench")).toBeHidden();
		for (let i = 1; i <= 6; ++i) {
			await dm.createCharacter({campaignId, name: `Expedition Member ${i} with a Long Table Name`});
		}

		await pCaptureOverview({
			helper: dm,
			campaignId,
			label: "campaign-overview-desktop-day",
			primaryAction: "dm",
			role: "dm",
			testInfo,
			theme: "day",
			viewport: {width: 1440, height: 900},
		});
		await pCaptureOverview({
			helper: player,
			campaignId,
			label: "campaign-overview-desktop-night",
			primaryAction: "character-choice",
			role: "player",
			testInfo,
			theme: "night",
			viewport: {width: 1440, height: 900},
		});
		await pCaptureOverview({
			helper: dm,
			campaignId,
			label: "campaign-overview-mobile-night",
			primaryAction: "dm",
			role: "dm",
			testInfo,
			theme: "night",
			viewport: {width: 390, height: 844},
		});
		await pCaptureOverview({
			helper: spectator,
			campaignId,
			label: "campaign-overview-mobile-day-read-only",
			primaryAction: "read-only",
			role: "spectator",
			testInfo,
			theme: "day",
			viewport: {width: 390, height: 844},
		});
		// Archival intentionally invalidates any authorization-scoped reads already in flight.
		archiveTransitionCampaignId = campaignId;
		await dm.archiveCampaign(campaignId);
		await player.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "read-only",
			campaignStatus: "archived",
		});
		const unexpectedPageErrors = pageErrors.filter(message =>
			!/^Failed to register a ServiceWorker .* An SSL certificate error occurred when fetching the script\.$/.test(message),
		);
		expect(unexpectedPageErrors).toEqual([]);
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(spectatorContext),
		]);
	}
});
