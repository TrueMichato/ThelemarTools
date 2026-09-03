import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

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
			invites: 0,
			accounts: {purgedAccountIds: [], blockedAccountIds: []},
		}));
		expect((await store.pGetOperationalMetrics()).lastMaintenanceAgeSeconds).toBeGreaterThanOrEqual(0);
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
