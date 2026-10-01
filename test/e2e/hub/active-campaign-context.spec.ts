import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";
import {HubCharacterSheetPartyInventoryPage} from "../pages/HubCharacterSheetPartyInventoryPage";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

/**
 * ADR 0013 evidence in a real browser against the real stack.
 *
 * The Node integration suite (`test/jest/hub/HubActiveCampaignJourney.test.js`) proves the
 * request/ordering contract with fakes. Only a browser can prove the parts that depend on native
 * platform behaviour: real `localStorage` persistence across a reload, a real `BroadcastChannel`
 * between two tabs of one browser context, and the BFCache `pagehide`/`pageshow` lifecycle.
 */
test.describe("device-scoped active campaign context", () => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};

	test.beforeEach(() => {
		if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	});

	test("remembers a verified campaign across a reload and clears it on sign out", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "selection-dm", displayName: "Selection DM", secret: secret!});

			const campaignId = await hub.createCampaign("Selection Persistence E2E");

			// Opening the campaign detail page is an explicit, verified candidate.
			await hub.gotoCampaign(campaignId);
			await hub.waitForSelectedCampaign(campaignId);

			// A real reload must recover the same selection from real localStorage.
			await hub.gotoHub();
			const afterReload = await hub.getActiveCampaignRecord();
			expect(afterReload).toMatchObject({campaignId, state: "selected"});
			expect(afterReload!.accountId).toBeTruthy();
			// The record is preference metadata only — never campaign content.
			expect(Object.keys(afterReload!).sort()).toEqual([
				"accountId", "campaignId", "revision", "schemaVersion", "state", "updatedAt", "writerId",
			]);

			// Signing out must clear the record *before* the logout request leaves the page, so a
			// failed logout cannot leave campaign context live in this browser.
			const atLogout = await hub.signOutCapturingSelectionAtRequest();
			expect(atLogout).toMatchObject({state: "cleared", campaignId: null});
		} finally {
			await pCloseContext(context);
		}
	});

	test("renders an accessible responsive switcher on Hub and ordinary navigation", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const page = new HubCampaignPage(await context.newPage());
			await page.signInSynthetic({providerSubject: "switcher-dm", displayName: "Switcher DM", secret: secret!});
			const campaignId = await page.createCampaign("Switcher E2E");

			await page.gotoHub();
			await page.expectCampaignSwitcher({campaignName: "Switcher E2E", state: "active"});
			await page.expectCampaignSwitcherResponsive();

			await page.gotoOrdinaryPageWithCampaignContext({
				path: `/spells.html?hubCampaign=${encodeURIComponent(campaignId)}`,
				campaignId,
			});
			await page.expectCampaignSwitcher({campaignName: "Switcher E2E", state: "active"});
			await page.expectCampaignSwitcherResponsive();

			await page.selectLocalCampaignContext();
			expect(await page.getActiveCampaignRecord()).toMatchObject({state: "cleared", campaignId: null});
		} finally {
			await pCloseContext(context);
		}
	});

	test("activates a campaign immediately after joining it", async ({browser}) => {
		test.setTimeout(180_000);
		const dmContext = await browser.newContext(contextOptions);
		const playerContext = await browser.newContext(contextOptions);
		try {
			const dm = new HubCampaignPage(await dmContext.newPage());
			await dm.signInSynthetic({providerSubject: "join-dm", displayName: "Join DM", secret: secret!});
			const campaignId = await dm.createCampaign("Joined Context E2E");
			const inviteUrl = await dm.createInvite(campaignId);

			const player = new HubCampaignPage(await playerContext.newPage());
			await player.signInSynthetic({providerSubject: "join-player", displayName: "Join Player", secret: secret!});
			await player.redeemInvite(inviteUrl, "Joined Context E2E");

			await player.waitForSelectedCampaign(campaignId);
			await player.expectCampaignSwitcher({campaignName: "Joined Context E2E", state: "active"});
		} finally {
			await pCloseContext(dmContext);
			await pCloseContext(playerContext);
		}
	});

	test("keeps a second browser profile independent of the first", async ({browser}) => {
		test.setTimeout(180_000);
		const first = await browser.newContext(contextOptions);
		const second = await browser.newContext(contextOptions);
		try {
			const here = new HubCampaignPage(await first.newPage());
			await here.signInSynthetic({providerSubject: "device-a", displayName: "Device A", secret: secret!});
			const campaignId = await here.createCampaign("Device Independence E2E");
			await here.gotoCampaign(campaignId);
			await here.waitForSelectedCampaign(campaignId);

			// The same account in a separate storage partition starts with no selection.
			const elsewhere = new HubCampaignPage(await second.newPage());
			await elsewhere.signInSynthetic({providerSubject: "device-a", displayName: "Device A", secret: secret!});
			await elsewhere.gotoHub();
			expect(await elsewhere.getActiveCampaignRecord()).toBeNull();
		} finally {
			await first.close();
			await second.close();
		}
	});

	test("converges two tabs of one browser over the real broadcast channel", async ({browser}) => {
		test.setTimeout(180_000);
		// One context means one storage partition and one live BroadcastChannel.
		const context = await browser.newContext(contextOptions);
		try {
			const tabA = new HubCampaignPage(await context.newPage());
			await tabA.signInSynthetic({providerSubject: "convergence-dm", displayName: "Convergence DM", secret: secret!});

			const campaignA = await tabA.createCampaign("Convergence A");
			const campaignB = await tabA.createCampaign("Convergence B");

			await tabA.gotoCampaign(campaignA);
			await tabA.waitForSelectedCampaign(campaignA);

			const tabB = new HubCampaignPage(await context.newPage());
			await tabB.gotoCampaign(campaignB);
			await tabB.waitForSelectedCampaign(campaignB);

			// Tab A observes tab B's change through the shared device record without any reload.
			await tabA.waitForSelectedCampaign(campaignB);

			// Convergence is durable, and the winning record has one deterministic identity.
			const recordA = await tabA.getActiveCampaignRecord();
			const recordB = await tabB.getActiveCampaignRecord();
			expect(recordA).toEqual(recordB);
		} finally {
			await pCloseContext(context);
		}
	});

	test("does not rebind an open campaign character when another tab changes the selection", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "pinned-dm", displayName: "Pinned DM", secret: secret!});

			const openCampaign = await hub.createCampaign("Pinned Open Table");
			const otherCampaign = await hub.createCampaign("Pinned Other Table");
			const character = await hub.createCharacter({campaignId: openCampaign, name: "Pinned Hero"});

			// The sheet tab holds a resource-pinned campaign character.
			const sheet = new HubCampaignPage(await context.newPage());
			await sheet.page.goto(`/charactersheet.html?id=${encodeURIComponent(character.id)}&hubCampaign=${encodeURIComponent(openCampaign)}`);
			await sheet.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			expect(await sheet.getSheetCampaignId()).toBe(openCampaign);

			// Another tab moves the device selection.
			const other = new HubCampaignPage(await context.newPage());
			await other.gotoCampaign(otherCampaign);
			await other.waitForSelectedCampaign(otherCampaign);

			// The device default follows, but the pinned sheet keeps its own campaign...
			await sheet.waitForSelectedCampaign(otherCampaign);
			expect(await sheet.getSheetCampaignId()).toBe(openCampaign);
			// ...and enters `switch_pending` rather than tearing down or activating anything.
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.toBe("switch_pending");

			// Reselecting the pinned resource restores it as the device default without rebinding.
			await sheet.selectCampaignContext(openCampaign);
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.toBe("active");
			expect(await sheet.getSheetCampaignId()).toBe(openCampaign);

			// The same recovery works after another tab selects explicit local mode.
			await other.selectLocalCampaignContext();
			await sheet.waitForClearedSelection();
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.toBe("switch_pending");
			await sheet.selectCampaignContext(openCampaign);
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.toBe("active");
			expect(await sheet.getSheetCampaignId()).toBe(openCampaign);
		} finally {
			await pCloseContext(context);
		}
	});

	test("keeps campaign and Local authority reversible without cross-writing canonical truth", async ({browser}) => {
		test.setTimeout(240_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "authority-owner", displayName: "Authority Owner", secret: secret!});
			const campaignId = await hub.createCampaign("Authority Routing E2E");
			const character = await hub.createCharacter({
				campaignId,
				name: "Canonical Route Hero",
				className: "Sorcerer",
				subclass: {name: "Draconic Bloodline", source: "PHB", shortName: "Draconic"},
			});

			// Deliberately reuse the canonical Hub id in the local repository. Repository authority,
			// not id uniqueness, must keep the two documents isolated.
			const localSeed = new HubCampaignPage(await context.newPage());
			await localSeed.page.goto("/charactersheet.html?local=1");
			await localSeed.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await localSeed.page.evaluate(async collision => {
				await (window as any).StorageUtil.pSet("charsheet-characters", [collision]);
			}, {
				id: character.id,
				name: "Local Collision Hero",
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
				classes: [{name: "Fighter", source: "PHB", level: 1}],
				hp: {current: 3, max: 9, temp: 0},
				inventory: [],
			});
			await localSeed.page.close();

			await hub.gotoCampaign(campaignId);
			await hub.waitForSelectedCampaign(campaignId);
			await hub.applyDamage({campaignId, characterName: "Canonical Route Hero", amount: 1});
			const afterEffect = await hub.getCharacter(character.id);
			expect(afterEffect.revision).toBeGreaterThan(character.revision);

			// Ordinary site entry and Campaign Overview entry both use the same campaign repository.
			const ordinary = new HubCampaignPage(await context.newPage());
			await ordinary.page.goto("/charactersheet.html");
			await ordinary.page.waitForURL(url => url.searchParams.get("hubCampaign") === campaignId, {timeout: 60_000});
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(ordinary.page.locator(`#charsheet-sel-character option[value="${character.id}"]`))
				.toContainText("Canonical Route Hero");
			await ordinary.page.locator("#charsheet-sel-character").selectOption(character.id);
			await expect.poll(
				() => ordinary.page.evaluate(() => (window as any).charSheet?._currentCharacterId),
				{timeout: 30_000},
			).toBe(character.id);
			await expect.poll(async () => {
				const state = await ordinary.page.evaluate(id => {
					const sheet = (window as any).charSheet;
					return {
						revision: sheet?._characterRepository?._accepted?.get(id)?.revision ?? null,
						pending: sheet?._characterRepository?.hasPendingWrites?.() ?? true,
						loading: sheet?._campaign?._isLoading ?? true,
					};
				}, character.id);
				const latest = await hub.getCharacter(character.id);
				return state.revision != null && state.revision === latest.revision && !state.pending && !state.loading;
			}, {timeout: 30_000}).toBe(true);
			await ordinary.page.locator("#charsheet-ipt-hp-current").evaluate((input: HTMLInputElement) => {
				input.value = "9";
				input.dispatchEvent(new Event("change", {bubbles: true}));
			});
			await expect.poll(
				async () => (await hub.getCharacter(character.id)).data.hp.current,
				{timeout: 30_000},
			).toBe(9);
			const canonicalAfterOrdinary = await hub.getCharacter(character.id);
			const operationWatermark = (await hub.getCharacterProjection(character.id)).operationWatermark;
			expect(canonicalAfterOrdinary.revision).toBeGreaterThan(afterEffect.revision);
			expect(operationWatermark).toBeGreaterThan(0);
			await expect.poll(
				() => ordinary.page.evaluate(id => {
					const repository = (window as any).charSheet?._characterRepository;
					const coverage = repository?._coverage?.get(id)?.live;
					return {
						revision: coverage?.revision ?? null,
						sequence: coverage?.acceptedSequence ?? null,
						blocked: repository?.isSaveBlocked?.(id) ?? true,
					};
				}, character.id),
				{timeout: 30_000},
			).toEqual({revision: canonicalAfterOrdinary.revision, sequence: operationWatermark, blocked: false});
			const ordinaryAcceptedRevision = await ordinary.page.evaluate(
				id => (window as any).charSheet?._characterRepository?._accepted?.get(id)?.revision ?? null,
				character.id,
			);
			expect(ordinaryAcceptedRevision).toBe(canonicalAfterOrdinary.revision);
			expect(canonicalAfterOrdinary.data.namedModifiers?.filter(mod => mod.sourceType === "classFeature").length)
				.toBeGreaterThan(0);
			await expect.poll(
				() => ordinary.page.evaluate(id => {
					const sheet = (window as any).charSheet;
					const stored = sheet?._characterRepository?._accepted?.get(id)?.data?.namedModifiers || [];
					const live = sheet?._state?._data?.namedModifiers || [];
					const canonical = stored.filter(mod => mod.sourceType === "classFeature");
					const ids = new Set(live.filter(mod => mod.sourceType === "classFeature").map(mod => mod.id));
					return {canonical: canonical.length, matched: canonical.filter(mod => ids.has(mod.id)).length};
				}, character.id),
				{timeout: 30_000},
			).toEqual({
				canonical: canonicalAfterOrdinary.data.namedModifiers.filter(mod => mod.sourceType === "classFeature").length,
				matched: canonicalAfterOrdinary.data.namedModifiers.filter(mod => mod.sourceType === "classFeature").length,
			});

			const overview = new HubCampaignPage(await context.newPage());
			await overview.gotoCampaign(campaignId);
			await overview.page.locator("#campaign-character-list .hub-data-row", {hasText: "Canonical Route Hero"}).click();
			await overview.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			expect(new URL(overview.page.url()).searchParams.get("id")).toBe(character.id);
			const overviewAcceptedRevision = await overview.page.evaluate(
				id => (window as any).charSheet?._characterRepository?._accepted?.get(id)?.revision ?? null,
				character.id,
			);
			const canonicalAfterOverview = await hub.getCharacter(character.id);
			expect(overviewAcceptedRevision).toBe(canonicalAfterOverview.revision);
			await expect.poll(
				() => ordinary.page.evaluate(
					id => (window as any).charSheet?._characterRepository?._accepted?.get(id)?.revision ?? null,
					character.id,
				),
				{timeout: 30_000},
			).toBe(canonicalAfterOverview.revision);
			// The explicit authority transition saves the current campaign document, fences its
			// callbacks, and carries an exact route back without putting the Hub id in local `id`.
			const bfcacheToken = await ordinary.page.evaluate(() => {
				(window as any).__authorityBfcacheToken = crypto.randomUUID();
				return (window as any).__authorityBfcacheToken;
			});
			const routePatchPaths: string[] = [];
			let routePatchCount = 0;
			let routeLeaseCount = 0;
			const onRouteRequest = request => {
				if (
					request.method() === "POST"
					&& new URL(request.url()).pathname === `/api/characters/${character.id}/lease`
				) {
					routeLeaseCount++;
					return;
				}
				if (
					request.method() !== "PATCH"
					|| new URL(request.url()).pathname !== `/api/characters/${character.id}`
				) return;
				routePatchCount++;
				const body = request.postDataJSON();
				routePatchPaths.push(...(body.patches || []).map((patch: {path: string}) => patch.path.split("/")[1]));
			};
			ordinary.page.on("request", onRouteRequest);
			await ordinary.page.locator("#charsheet-campaign a", {hasText: "Open Local mode"}).click();
			await ordinary.page.waitForURL(url =>
				url.searchParams.get("local") === "1"
				&& url.searchParams.get("returnHubCampaign") === campaignId
				&& url.searchParams.get("returnHubCharacter") === character.id,
			{timeout: 60_000});
			expect(new URL(ordinary.page.url()).searchParams.get("id")).toBeNull();
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(ordinary.page.locator("#charsheet-campaign")).toContainText("Local authority");
			expect(routePatchPaths).toEqual([]);
			expect(routePatchCount).toBe(0);
			expect(routeLeaseCount).toBe(0);
			expect((await hub.getCharacter(character.id)).revision).toBe(canonicalAfterOverview.revision);

			await ordinary.page.goBack();
			await ordinary.page.waitForURL(url =>
				url.searchParams.get("id") === character.id
				&& url.searchParams.get("hubCampaign") === campaignId,
			{timeout: 60_000});
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			const restoredBfcacheToken = await ordinary.page.evaluate(() => (window as any).__authorityBfcacheToken || null);
			if (restoredBfcacheToken != null) expect(restoredBfcacheToken).toBe(bfcacheToken);
			await expect.poll(
				() => ordinary.page.evaluate(() => (window as any).charSheet?._hubActiveCampaign?.state || null),
				{timeout: 30_000},
			).toBe("active");
			await expect(ordinary.page.locator("#charsheet-campaign")).toContainText("Campaign authority");
			await new HubCharacterSheetPartyInventoryPage(ordinary.page).expectRefreshAfterAuthorityReturn();

			await ordinary.page.locator("#charsheet-campaign a", {hasText: "Open Local mode"}).click();
			await ordinary.page.waitForURL(url =>
				url.searchParams.get("local") === "1"
				&& url.searchParams.get("returnHubCampaign") === campaignId
				&& url.searchParams.get("returnHubCharacter") === character.id,
			{timeout: 60_000});
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(ordinary.page.locator("#charsheet-campaign")).toContainText("Local authority");
			const canonicalAtLocalEntry = await hub.getCharacter(character.id);
			expect(canonicalAtLocalEntry.data.name).toBe("Canonical Route Hero");
			ordinary.page.off("request", onRouteRequest);
			expect({revision: canonicalAtLocalEntry.revision, routePatchPaths}).toEqual({
				revision: canonicalAfterOverview.revision,
				routePatchPaths: [],
			});
			expect(routePatchCount).toBe(0);
			expect(routeLeaseCount).toBe(0);

			await ordinary.page.locator("#charsheet-sel-character").selectOption(character.id);
			await expect(ordinary.page.locator("#charsheet-ipt-name")).toHaveValue("Local Collision Hero");
			await ordinary.page.locator("#charsheet-ipt-name").evaluate((input: HTMLInputElement) => {
				input.value = "Changed Only In Local Authority";
				input.dispatchEvent(new Event("change", {bubbles: true}));
			});
			await expect.poll(
				() => ordinary.page.evaluate(async id => {
					const rows = await (window as any).StorageUtil.pGet("charsheet-characters");
					return rows.find((row: any) => row.id === id)?.name || null;
				}, character.id),
				{timeout: 15_000},
			).toBe("Changed Only In Local Authority");

			const canonicalAfterLocalWrite = await hub.getCharacter(character.id);
			expect(canonicalAfterLocalWrite.revision).toBe(canonicalAtLocalEntry.revision);
			expect(canonicalAfterLocalWrite.data.name).toBe("Canonical Route Hero");

			await ordinary.page.reload();
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(ordinary.page.locator("#charsheet-campaign")).toContainText("Local authority");
			await expect(ordinary.page.locator("#charsheet-ipt-name")).toHaveValue("Changed Only In Local Authority");
			const returnLink = ordinary.page.locator("#charsheet-campaign a", {hasText: "Return to campaign character"});
			await expect(returnLink).toHaveAttribute(
				"href",
				`charactersheet.html?id=${character.id}&hubCampaign=${campaignId}`,
			);

			const localUrl = ordinary.page.url();
			const reopenedLocal = new HubCampaignPage(await context.newPage());
			await reopenedLocal.page.goto(localUrl);
			await reopenedLocal.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(reopenedLocal.page.locator("#charsheet-campaign a", {hasText: "Return to campaign character"}))
				.toHaveAttribute("href", `charactersheet.html?id=${character.id}&hubCampaign=${campaignId}`);
			await reopenedLocal.page.close();

			await returnLink.click();
			await ordinary.page.waitForURL(url =>
				url.searchParams.get("id") === character.id
				&& url.searchParams.get("hubCampaign") === campaignId
				&& !url.searchParams.has("local"),
			{timeout: 60_000});
			await ordinary.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(ordinary.page.locator("#charsheet-campaign")).toContainText("Campaign authority");
			await expect(ordinary.page.locator("#charsheet-ipt-name")).toHaveValue("Canonical Route Hero");

			const canonicalAfterReturn = await hub.getCharacter(character.id);
			const returnedAcceptedRevision = await ordinary.page.evaluate(
				id => (window as any).charSheet?._characterRepository?._accepted?.get(id)?.revision ?? null,
				character.id,
			);
			expect(canonicalAfterReturn.revision).toBe(canonicalAfterLocalWrite.revision);
			expect(canonicalAfterReturn.revision).toBe(canonicalAfterOverview.revision);
			expect(returnedAcceptedRevision).toBe(canonicalAfterReturn.revision);
		} finally {
			await pCloseContext(context);
		}
	});

	test("returns a DM from Local mode to the same read-only campaign projection", async ({browser}) => {
		test.setTimeout(240_000);
		const dmContext = await browser.newContext(contextOptions);
		const playerContext = await browser.newContext(contextOptions);
		try {
			const dm = new HubCampaignPage(await dmContext.newPage());
			await dm.signInSynthetic({providerSubject: "authority-dm", displayName: "Authority DM", secret: secret!});
			const campaignId = await dm.createCampaign("DM Authority Routing E2E");
			const invite = await dm.createInviteViaApi(campaignId);

			const player = new HubCampaignPage(await playerContext.newPage());
			await player.signInSynthetic({providerSubject: "authority-player", displayName: "Authority Player", secret: secret!});
			await player.redeemInviteTokenViaApi(invite);
			const character = await player.createCharacter({campaignId, name: "Read-only Route Hero"});
			const canonicalBefore = await player.getCharacter(character.id);

			await dm.gotoCampaign(campaignId);
			await dm.page.locator("#campaign-character-list .hub-data-row", {hasText: "Read-only Route Hero"}).click();
			await dm.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(dm.page.locator("#charsheet-campaign")).toContainText("Read-only DM view");
			await expect(dm.page.locator("#charsheet-save-indicator")).toHaveAttribute("title", "Read-only DM view");

			await dm.page.locator("#charsheet-campaign a", {hasText: "Open Local mode"}).click();
			await dm.page.waitForURL(url =>
				url.searchParams.get("local") === "1"
				&& url.searchParams.get("returnHubCampaign") === campaignId
				&& url.searchParams.get("returnHubCharacter") === character.id,
			{timeout: 60_000});
			await dm.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(dm.page.locator("#charsheet-campaign a", {hasText: "Return to read-only campaign character"}))
				.toBeVisible();

			await dm.page.reload();
			await dm.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await dm.page.locator("#charsheet-campaign a", {hasText: "Return to read-only campaign character"}).click();
			await dm.page.waitForURL(url =>
				url.searchParams.get("id") === character.id
				&& url.searchParams.get("hubCampaign") === campaignId,
			{timeout: 60_000});
			await dm.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
			await expect(dm.page.locator("#charsheet-campaign")).toContainText("Read-only DM view");
			await expect(dm.page.locator("#charsheet-save-indicator")).toHaveAttribute("title", "Read-only DM view");

			const canonicalAfter = await player.getCharacter(character.id);
			expect(canonicalAfter.revision).toBe(canonicalBefore.revision);
			expect(canonicalAfter.data.name).toBe("Read-only Route Hero");
		} finally {
			await pCloseContext(dmContext);
			await pCloseContext(playerContext);
		}
	});

	test("survives a BFCache round trip without losing campaign rules", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "bfcache-dm", displayName: "BFCache DM", secret: secret!});
			const campaignId = await hub.createCampaign("BFCache E2E");
			const character = await hub.createCharacter({campaignId, name: "Restored Hero"});

			const sheet = new HubCampaignPage(await context.newPage());
			await sheet.page.goto(`/charactersheet.html?id=${encodeURIComponent(character.id)}&hubCampaign=${encodeURIComponent(campaignId)}`);
			await sheet.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});

			const before = await sheet.getSheetCampaignId();
			expect(before).toBe(campaignId);

			await sheet.suspendForBfcache();
			await sheet.resumeFromBfcache();

			// A persisted hide/show must not clear the campaign context, rules, or brew.
			await expect.poll(async () => sheet.getSheetCampaignId(), {timeout: 15_000}).toBe(campaignId);
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.not.toBe("signed_out");
			expect(await sheet.getActiveCampaignRecord()).toMatchObject({campaignId, state: "selected"});
		} finally {
			await pCloseContext(context);
		}
	});

	test("defaults bare campaign surfaces while preserving explicit local routes", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "local-dm", displayName: "Local DM", secret: secret!});
			const campaignId = await hub.createCampaign("Local Board E2E");
			await hub.createCharacter({campaignId, name: "Default Hero"});
			await hub.gotoCampaign(campaignId);
			await hub.waitForSelectedCampaign(campaignId);

			const sheet = new HubCampaignPage(await context.newPage());
			await sheet.openBareCharacterSheetDefault(campaignId);
			const localSheet = new HubCampaignPage(await context.newPage());
			await localSheet.openLocalCharacterSheet();

			const board = new HubCampaignPage(await context.newPage());
			await board.openBareDmScreenDefault(campaignId);
			const localBoard = new HubCampaignPage(await context.newPage());
			await localBoard.openLocalDmScreen();

			expect(await hub.getActiveCampaignRecord()).toMatchObject({campaignId, state: "selected"});
		} finally {
			await pCloseContext(context);
		}
	});

	test("conceals a pinned character after membership removal on BFCache resume", async ({browser}) => {
		test.setTimeout(180_000);
		const dmContext = await browser.newContext(contextOptions);
		const playerContext = await browser.newContext(contextOptions);
		try {
			const dm = new HubCampaignPage(await dmContext.newPage());
			await dm.signInSynthetic({providerSubject: "revoke-dm", displayName: "Revoke DM", secret: secret!});
			const campaignId = await dm.createCampaign("Revoked Context E2E");
			const invite = await dm.createInviteViaApi(campaignId);

			const player = new HubCampaignPage(await playerContext.newPage());
			await player.signInSynthetic({providerSubject: "revoke-player", displayName: "Revoked Player", secret: secret!});
			await player.redeemInviteTokenViaApi(invite);
			const character = await player.createCharacter({campaignId, name: "Private Revoked Hero"});
			await player.openCharacterSheet({campaignId, characterId: character.id, name: "Private Revoked Hero"});

			await player.suspendForBfcache();
			await dm.removeMember({campaignId, displayName: "Revoked Player"});
			await player.expectPrivateCharacterOpen("Private Revoked Hero");
			await player.resumeFromBfcache();

			await player.waitForClearedSelection();
			await player.expectPrivateCharacterConcealed();
		} finally {
			await pCloseContext(dmContext);
			await pCloseContext(playerContext);
		}
	});

	test("fences in-flight Character Sheet and DM workspace conflicts before access-loss concealment", async ({browser}) => {
		test.setTimeout(240_000);
		const ownerContext = await browser.newContext(contextOptions);
		const collaboratorContext = await browser.newContext(contextOptions);
		try {
			const owner = new HubCampaignPage(await ownerContext.newPage());
			await owner.signInSynthetic({providerSubject: "conflict-owner", displayName: "Conflict Owner", secret: secret!});
			const campaignId = await owner.createCampaign("Conflict Fence E2E");
			const invite = await owner.createInviteViaApi(campaignId, "co_dm");

			const collaborator = new HubCampaignPage(await collaboratorContext.newPage());
			await collaborator.signInSynthetic({
				providerSubject: "conflict-collaborator",
				displayName: "Conflict Collaborator",
				secret: secret!,
			});
			await collaborator.redeemInviteTokenViaApi(invite);
			const character = await collaborator.createCharacter({campaignId, name: "Private Conflict Hero"});

			const sheet = new HubCampaignPage(await collaboratorContext.newPage());
			await sheet.openCharacterSheet({campaignId, characterId: character.id, name: "Private Conflict Hero"});
			const board = new HubCampaignPage(await collaboratorContext.newPage());
			await board.openBareDmScreenDefault(campaignId);

			await sheet.startDeferredCharacterConflictSave();
			await board.startDeferredDmWorkspaceConflictSave();

			await owner.removeMember({campaignId, displayName: "Conflict Collaborator"});
			await Promise.all([
				sheet.revalidatePrivateSurfaceCampaignAccess(),
				board.revalidatePrivateSurfaceCampaignAccess(),
			]);
			await Promise.all([
				sheet.waitForClearedSelection(),
				board.waitForClearedSelection(),
				sheet.expectPrivateCharacterConcealed(),
				board.expectPrivateDmWorkspaceConcealed(),
			]);

			const [characterOutcome, boardOutcome] = await Promise.all([
				sheet.releaseDeferredCharacterConflictSave(),
				board.releaseDeferredDmWorkspaceConflictSave(),
			]);
			expect(characterOutcome).toEqual({
				promptCount: 0,
				resolveCount: 0,
				name: "",
				characterId: null,
			});
			expect(boardOutcome).toEqual({
				promptCount: 0,
				resolveCount: 0,
				panelCount: 0,
			});
		} finally {
			await pCloseContext(ownerContext);
			await pCloseContext(collaboratorContext);
		}
	});

	test("conceals a pinned character after campaign archive on BFCache resume", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const dm = new HubCampaignPage(await context.newPage());
			await dm.signInSynthetic({providerSubject: "archive-dm", displayName: "Archive DM", secret: secret!});
			const campaignId = await dm.createCampaign("Archived Context E2E");
			const character = await dm.createCharacter({campaignId, name: "Private Archived Hero"});
			await dm.openCharacterSheet({campaignId, characterId: character.id, name: "Private Archived Hero"});

			await dm.suspendForBfcache();
			await dm.archiveCampaign(campaignId);
			await dm.expectPrivateCharacterOpen("Private Archived Hero");
			await dm.resumeFromBfcache();

			await dm.waitForClearedSelection();
			await dm.expectPrivateCharacterConcealed();
		} finally {
			await pCloseContext(context);
		}
	});
});
