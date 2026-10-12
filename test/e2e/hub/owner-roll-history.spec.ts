import {expect, test, type BrowserContext} from "@playwright/test";
import pg from "pg";
import {HubCampaignPage} from "../pages/HubCampaignPage";

async function closeContext (context: BrowserContext): Promise<void> {
	await Promise.race([context.close(), new Promise<void>(resolve => setTimeout(resolve, 5_000))]);
}

test("owner roll history survives reload and lost responses, converges across devices, and excludes DM and peer inspection", async ({browser}, testInfo) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const databaseUrl = process.env.HUB_TEST_POSTGRES_URL;
	if (!databaseUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Disposable loopback PostgreSQL is required.");
	const pool = new pg.Pool({connectionString: databaseUrl, ssl: false});
	const options = {baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true};
	const contexts = await Promise.all(Array.from({length: 4}, () => browser.newContext(options)));
	try {
		const [owner, device, dm, peer] = await Promise.all(contexts.map(async context => new HubCampaignPage(await context.newPage())));
		await dm.signInSynthetic({providerSubject: "history-dm", displayName: "History DM", secret});
		await owner.signInSynthetic({providerSubject: "history-owner", displayName: "History Owner", secret});
		await device.signInSynthetic({providerSubject: "history-owner", displayName: "History Owner", secret});
		await peer.signInSynthetic({providerSubject: "history-peer", displayName: "History Peer", secret});
		const campaignId = await dm.createCampaign("Owner history E2E");
		await owner.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await peer.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const character = await owner.createCharacter({campaignId, name: "History Rowan", rollVisibility: "actor_and_dm"});
		// The raw API fixture lacks class features; complete its ordinary load-time repair
		// before measuring the history-only window, including a second clean open.
		await owner.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		const ownerAccountId = (await owner.getSession()).account.id;
		const getNoWriteEvidence = async () => {
			const result = await pool.query(`
				SELECT c.revision::text AS revision, c.lease_epoch::text AS lease_epoch,
					(SELECT count(*)::text FROM hub.command_receipts WHERE actor_account_id = $2 AND command_type = 'character.patch') AS patch_receipts,
					(SELECT count(*)::text FROM hub.domain_events WHERE campaign_id = $3 AND aggregate_id = $1 AND event_type = 'character.patched') AS patch_events,
					(SELECT count(*)::text FROM hub.domain_events WHERE campaign_id = $3 AND event_type = 'character.projection.invalidated') AS invalidations
				FROM hub.characters c WHERE c.id = $1 AND c.campaign_id = $3
			`, [character.id, ownerAccountId, campaignId]);
			expect(result.rowCount).toBe(1);
			return result.rows[0];
		};
		const before = await getNoWriteEvidence();
		expect(Number(before.patch_events)).toBeGreaterThan(0);
		expect(Number(before.lease_epoch)).toBeGreaterThan(0);
		const ownerTraffic = owner.watchRollHistoryTraffic(character.id);
		const deviceTraffic = device.watchRollHistoryTraffic(character.id);
		await owner.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		await owner.openRollHistory();
		expect(ownerTraffic.requests.filter(type => ["character-write", "lease"].includes(type)), `initial Sheet writes: ${JSON.stringify(ownerTraffic.writePaths)}`).toEqual([]);
		await device.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		await device.openRollHistory();
		await device.waitForCharacterRealtimeLive();
		let dropResponse = true;
		await owner.page.route(`**/api/campaigns/${campaignId}/rolls`, async route => {
			if (!dropResponse) return route.continue();
			dropResponse = false;
			const response = await route.fetch();
			expect(response.ok()).toBe(true);
			await route.abort("failed");
		});
		for (let count = 1; count <= 3; count++) {
			await owner.rollInitiativeForHistory(count);
			await device.expectRetainedRollCount(count);
		}
		expect((await owner.getEvents(campaignId)).filter(event => event.type === "roll.logged" && event.aggregateId === character.id)).toHaveLength(3);
		expect((await peer.getEvents(campaignId)).filter(event => event.type === "roll.logged" && event.aggregateId === character.id)).toHaveLength(0);
		await dm.logRolls({campaignId, characterId: character.id, count: 1});
		await owner.expectRetainedRollCount(3);
		await device.expectRetainedRollCount(3);
		await dm.expectPersonalRollHistoryDenied({campaignId, characterId: character.id});
		await peer.expectPersonalRollHistoryDenied({campaignId, characterId: character.id});
		const dmTraffic = dm.watchRollHistoryTraffic(character.id);
		await dm.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		await dm.openRollHistory();
		await expect(dm.page.locator(".charsheet__roll-history-list")).toContainText("inspecting another owner's character");
		await expect(dm.page.locator("#charsheet-roll-history-visibility")).toBeHidden();
		expect(dmTraffic.requests.filter(type => ["history-read", "roll", "character-write", "lease"].includes(type))).toEqual([]);
		dmTraffic.stop();
		await owner.page.unroute(`**/api/campaigns/${campaignId}/rolls`);
		await owner.page.route(`**/api/campaigns/${campaignId}/rolls`, async route => {
			await owner.suspendForBfcache();
			const response = await route.fetch();
			expect(response.ok()).toBe(true);
			await route.abort("failed");
		});
		await owner.rollInitiativeWithUnconfirmedHistory();
		await device.expectRetainedRollCount(4);
		await owner.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		await owner.openRollHistory();
		await owner.expectRetainedRollCount(4);
		await owner.page.unroute(`**/api/campaigns/${campaignId}/rolls`);
		await device.rollInitiativeOfflineForHistory();
		await device.expectRetainedRollCount(4);
		await owner.rollInitiativeForHistory(5);
		await device.reconnectRollHistory();
		await device.expectRetainedRollCount(5);
		await device.openCharacterSheet({campaignId, characterId: character.id, name: "History Rowan"});
		await device.openRollHistory();
		await device.expectRetainedRollCount(5);
		let rejectBeforeCommit = true;
		await owner.page.route(`**/api/campaigns/${campaignId}/rolls`, async route => {
			if (!rejectBeforeCommit) return route.continue();
			rejectBeforeCommit = false;
			await route.abort("failed");
		});
		await owner.rollInitiativeWithUnconfirmedHistory();
		await owner.retryRollHistoryByKeyboard(6);
		await device.expectRetainedRollCount(6);
		await device.expectRollHistoryResponsive();
		await device.captureRollHistoryReview(name => testInfo.outputPath(name));
		expect(ownerTraffic.requests.filter(type => type === "roll")).toHaveLength(7);
		expect(ownerTraffic.requests.filter(type => ["character-write", "lease"].includes(type)), `unexpected Sheet writes: ${JSON.stringify(ownerTraffic.writePaths)}`).toEqual([]);
		expect(deviceTraffic.requests.filter(type => ["roll", "character-write", "lease"].includes(type))).toEqual([]);
		expect(await getNoWriteEvidence()).toEqual(before);
		ownerTraffic.stop();
		deviceTraffic.stop();
		await dm.changeMemberRoleViaApi({campaignId, displayName: "History Owner", role: "co_dm"});
		await owner.expectSheetMembershipRole("co_dm");
		await device.expectSheetMembershipRole("co_dm");
		await owner.logRolls({campaignId, characterId: character.id, count: 1, visibility: "dm_only"});
		await owner.expectRetainedRollCount(7);
		await device.expectRetainedRollCount(7);
		await dm.changeMemberRoleViaApi({campaignId, displayName: "History Owner", role: "player"});
		await owner.expectSheetMembershipRole("player");
		await device.expectSheetMembershipRole("player");
		await owner.expectRetainedRollCount(6);
		await device.expectRetainedRollCount(6);
	} finally {
		await Promise.all([...contexts.map(closeContext), pool.end()]);
	}
});
