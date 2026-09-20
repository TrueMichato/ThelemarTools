import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import crypto from "node:crypto";

describe("Hub maintenance", () => {
	it("returns bounded cleanup counts and records successful operational status", async () => {
		const store = new MemoryHubStore();
		const result = await store.pRunMaintenance({batchSize: 10});
		expect(result).toEqual(expect.objectContaining({
			skipped: false,
			commandReceipts: 0,
			publishedOutbox: 0,
			sessions: 0,
			oauthTransactions: 0,
			inviteContexts: 0,
			invites: 0,
			accounts: {purgedAccountIds: [], blockedAccountIds: []},
		}));
		expect((await store.pGetOperationalMetrics()).lastMaintenanceAgeSeconds).toBeGreaterThanOrEqual(0);
	});

	it("removes retained expired invites in the memory authority", async () => {
		let now = new Date("2026-09-20T00:00:00.000Z");
		const store = new MemoryHubStore({fnNow: () => new Date(now)});
		const owner = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: "maintenance-owner",
			displayName: "Owner",
		});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: "Maintenance",
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: "expired-invite",
			expiresAt: new Date(now.getTime() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		now = new Date(now.getTime() + 31 * 86_400_000);
		const result = await store.pRunMaintenance({batchSize: 10});
		expect(result.invites).toBe(1);
		expect(store._invites.size).toBe(0);
	});

	it("releases the maintenance lock client and preserves the original failure when evidence/unlock fail", async () => {
		let isReleased = false;
		const secondaryErrors = [];
		const lockClient = {
			async query (sql) {
				if (sql.includes("pg_try_advisory_lock")) return {rows: [{locked: true}], rowCount: 1};
				if (sql.includes("INSERT INTO hub.operational_runs")) return {rows: [], rowCount: 1};
				if (sql.includes("UPDATE hub.operational_runs")) throw new Error("evidence unavailable");
				if (sql.includes("pg_advisory_unlock")) throw new Error("unlock unavailable");
				return {rows: [], rowCount: 0};
			},
			release () { isReleased = true; },
		};
		const store = new PostgresHubStore({
			pool: {
				connect: async () => lockClient,
				query: async () => ({rows: [], rowCount: 0}),
				on: () => {},
			},
			fnOnPoolError: error => secondaryErrors.push(error.message),
		});
		store.pDeleteExpiredCommandReceipts = async () => { throw new Error("original maintenance failure"); };
		await expect(store.pRunMaintenance()).rejects.toThrow("original maintenance failure");
		expect(isReleased).toBe(true);
		expect(secondaryErrors).toEqual(["evidence unavailable", "unlock unavailable"]);
	});
});
