import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

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
			await context.close();
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
			await context.close();
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
			await dmContext.close();
			await playerContext.close();
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
			await context.close();
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
			await context.close();
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
			await context.close();
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
			await context.close();
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
			await dmContext.close();
			await playerContext.close();
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
			await ownerContext.close();
			await collaboratorContext.close();
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
			await context.close();
		}
	});
});
