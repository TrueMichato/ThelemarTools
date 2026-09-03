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

			await sheet.simulateBfcacheRoundTrip();

			// A persisted hide/show must not clear the campaign context, rules, or brew.
			await expect.poll(async () => sheet.getSheetCampaignId(), {timeout: 15_000}).toBe(campaignId);
			await expect.poll(async () => sheet.getActiveContextState(), {timeout: 15_000})
				.not.toBe("signed_out");
			expect(await sheet.getActiveCampaignRecord()).toMatchObject({campaignId, state: "selected"});
		} finally {
			await context.close();
		}
	});

	test("does not auto-open a private DM workspace from a remembered selection", async ({browser}) => {
		test.setTimeout(180_000);
		const context = await browser.newContext(contextOptions);
		try {
			const hub = new HubCampaignPage(await context.newPage());
			await hub.signInSynthetic({providerSubject: "local-dm", displayName: "Local DM", secret: secret!});
			const campaignId = await hub.createCampaign("Local Board E2E");
			await hub.gotoCampaign(campaignId);
			await hub.waitForSelectedCampaign(campaignId);

			// A bare DM Screen must stay fully local: a device preference is not consent to open a
			// private workspace, and local Board initialisation is never gated on an authed fetch.
			const board = new HubCampaignPage(await context.newPage());
			const workspaceRequests: string[] = [];
			board.page.on("request", request => {
				if (request.url().includes("/workspace")) workspaceRequests.push(request.url());
			});
			await board.page.goto("/dmscreen.html");
			await board.page.waitForFunction(() => !!(window as any).DM_SCREEN, undefined, {timeout: 60_000});

			expect(workspaceRequests).toEqual([]);
			// The remembered selection is untouched.
			expect(await board.getActiveCampaignRecord()).toMatchObject({campaignId, state: "selected"});
		} finally {
			await context.close();
		}
	});
});
