import {expect, test, type BrowserContext, type Page, type TestInfo} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
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
		const conditionModuleRequests: string[] = [];
		await dm.page.route(/\/js\/hub\/hub-condition-catalog\.js(?:\?.*)?$/, async route => {
			conditionModuleRequests.push(route.request().url());
			if (conditionModuleRequests.length === 1) {
				await route.fulfill({
					status: 503,
					contentType: "text/javascript",
					body: "throw new Error('temporary module failure');",
				});
				return;
			}
			await route.continue();
		});
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
		const dmSheet = new CharacterSheetPage(dm.page);
		await expect(dmSheet.characterName).toHaveValue("Readonly Rowan");
		await expect(dmSheet.characterName).toBeDisabled();
		await expect(dm.page.locator("#charsheet-btn-export")).toBeEnabled();
		await expect(dm.page.locator("#charsheet-campaign .charsheet__campaign-detail"))
			.toContainText("Read-only DM view");
		await expect(dm.page.locator("#charsheet-sel-character option:checked")).toContainText("(read-only)");
		await expect(dm.page.locator(".charsheet__sharing")).toHaveCount(0);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet.isCurrentCharacterReadOnly())).toBe(true);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._saveCurrentCharacter())).toBe(true);
		await dmSheet.waitForHubRealtimeLive();

		const playerSheet = new CharacterSheetPage(player.page);
		await playerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		await playerSheet.renameCharacter("Readonly Rowan Updated");
		await expect(dmSheet.characterName).toHaveValue("Readonly Rowan Updated", {timeout: 20_000});
		await expect(dmSheet.characterName).toBeDisabled();
		await dmSheet.requestHubRealtimeResyncAndWait();
		expect(ownerOnlyRequests).toEqual([]);
		expect(characterMutations).toEqual([]);
		expect((await player.getCharacter(character.id)).data.name).toBe("Readonly Rowan Updated");

		await dm.gotoCampaign(campaignId);
		const conditionDataRequests: string[] = [];
		await dm.page.route(/\/data\/conditionsdiseases\.json(?:\?.*)?$/, async route => {
			conditionDataRequests.push(route.request().url());
			if (conditionDataRequests.length === 1) {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: "temporary condition data failure"}),
				});
				return;
			}
			await route.continue();
		});
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		await dm.page.locator("#campaign-action-target").selectOption({label: "Readonly Rowan Updated"});
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		const condition = dm.page.locator("#campaign-action-condition");
		await expect(condition).toBeDisabled();
		await expect.poll(() => conditionModuleRequests.length).toBe(1);
		await playerSheet.renameCharacter("Readonly Rowan Module Retry");
		await expect.poll(() => conditionDataRequests.length).toBe(1);
		await expect(condition).toBeDisabled();
		expect(conditionModuleRequests).toHaveLength(2);
		await playerSheet.renameCharacter("Readonly Rowan Recovered");
		await expect(condition).toBeEnabled();
		expect(conditionModuleRequests).toHaveLength(2);
		expect(conditionDataRequests).toHaveLength(2);
		expect(conditionModuleRequests[1]).not.toBe(conditionModuleRequests[0]);
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

test("DM same-tab login ignores another account's failed owner recovery and stays live", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmSetupContext = await browser.newContext(contextOptions);
	const sharedContext = await browser.newContext(contextOptions);
	const ownerUpdateContext = await browser.newContext(contextOptions);
	try {
		const dmSetup = new HubCampaignPage(await dmSetupContext.newPage());
		const shared = new HubCampaignPage(await sharedContext.newPage());
		const ownerUpdate = new HubCampaignPage(await ownerUpdateContext.newPage());
		await dmSetup.signInSynthetic({providerSubject: "recovery-dm", displayName: "Recovery DM", secret});
		const ownerSession = await shared.signInSynthetic({
			providerSubject: "recovery-owner",
			displayName: "Recovery Owner",
			secret,
		});
		const ownerAccountId = ownerSession.account?.id;
		if (!ownerAccountId) throw new Error("Synthetic owner session did not return an account id.");
		const campaignId = await dmSetup.createCampaign("Recovery Authority E2E");
		await shared.redeemInviteTokenViaApi(await dmSetup.createInviteViaApi(campaignId));
		const character = await shared.createCharacter({campaignId, name: "Canonical Rowan"});

		const ownerSheet = new CharacterSheetPage(shared.page);
		await ownerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		const characterRoute = `**/api/characters/${character.id}`;
		await shared.page.route(characterRoute, async route => {
			if (route.request().method() !== "PATCH") {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "TEST_SAVE_FAILED", message: "Synthetic save failure"}}),
			});
		});
		expect(await shared.page.evaluate(async () => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setName("Unsaved Owner Draft");
			return sheet._saveCurrentCharacter();
		})).toBe(false);
		await shared.page.unroute(characterRoute);
		await expect.poll(() => shared.page.evaluate(() =>
			Object.keys(sessionStorage).find(key => key.startsWith("hub-character-recovery:")) || null,
		)).toContain(`:${ownerAccountId}:${character.id}`);
		expect((await shared.getCharacter(character.id)).data.name).toBe("Canonical Rowan");

		shared.page.on("dialog", dialog => void dialog.accept());
		await shared.gotoHub();
		await shared.page.locator("#hub-logout").click();
		await expect(shared.page.locator("#hub-signed-out")).toBeVisible();
		await shared.signInSynthetic({providerSubject: "recovery-dm", displayName: "Recovery DM", secret});
		await shared.gotoCampaign(campaignId);
		await shared.page.locator("#campaign-character-list .hub-data-row", {hasText: "Canonical Rowan"}).click();
		await shared.page.waitForFunction(() => !!(globalThis as any).charSheet, undefined, {timeout: 60_000});
		const dmSheet = new CharacterSheetPage(shared.page);
		await expect(dmSheet.characterName).toHaveValue("Canonical Rowan", {timeout: 20_000});
		await expect(dmSheet.characterName).toBeDisabled();
		await dmSheet.waitForHubRealtimeLive();

		await ownerUpdate.signInSynthetic({
			providerSubject: "recovery-owner",
			displayName: "Recovery Owner",
			secret,
		});
		const updatingOwnerSheet = new CharacterSheetPage(ownerUpdate.page);
		await updatingOwnerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		await updatingOwnerSheet.renameCharacter("Canonical Rowan Updated");
		await expect(dmSheet.characterName).toHaveValue("Canonical Rowan Updated", {timeout: 20_000});
		await expect(dmSheet.characterName).toBeDisabled();
	} finally {
		await Promise.all([
			pCloseContext(dmSetupContext),
			pCloseContext(sharedContext),
			pCloseContext(ownerUpdateContext),
		]);
	}
});

test("condition catalog module retries exhaust without request storms", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const context = await browser.newContext({
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	});
	try {
		const dm = new HubCampaignPage(await context.newPage());
		const conditionModuleRequests: string[] = [];
		await dm.page.route(/\/js\/hub\/hub-condition-catalog\.js(?:\?.*)?$/, async route => {
			conditionModuleRequests.push(route.request().url());
			await route.fulfill({
				status: 503,
				contentType: "text/javascript",
				body: "throw new Error('persistent module failure');",
			});
		});
		await dm.signInSynthetic({providerSubject: "condition-budget-dm", displayName: "Condition Budget DM", secret});
		const campaignId = await dm.createCampaign("Condition Retry Budget E2E");
		await dm.createCharacter({campaignId, name: "Budget Target"});
		await dm.gotoCampaign(campaignId);
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		await dm.page.locator("#campaign-action-target").selectOption({label: "Budget Target"});
		for (let i = 0; i < 6; ++i) {
			await dm.page.locator("#campaign-action-type").selectOption(i % 2 ? "damage" : "condition_add");
		}
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		await expect.poll(() => conditionModuleRequests.length).toBe(3);
		expect(new Set(conditionModuleRequests).size).toBe(3);
		await expect(dm.page.locator("#campaign-action-condition")).toBeDisabled();
		await expect(dm.page.locator("#campaign-action-form-status"))
			.toHaveText("Condition options are unavailable until this page is reloaded.");

		await dm.createCharacter({campaignId, name: "Realtime Refresh Target"});
		await expect(dm.page.locator("#campaign-character-list .hub-data-row", {hasText: "Realtime Refresh Target"}))
			.toBeVisible();
		await dm.page.locator("#campaign-action-type").selectOption("damage");
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		expect(conditionModuleRequests).toHaveLength(3);
	} finally {
		await pCloseContext(context);
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
