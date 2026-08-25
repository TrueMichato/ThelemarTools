import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

function getSessionRow ({lastSeenAt}) {
	return {
		session_id: "00000000-0000-4000-8000-000000000001",
		account_id: "00000000-0000-4000-8000-000000000002",
		user_agent: "Test",
		created_at: new Date(),
		last_seen_at: lastSeenAt,
		expires_at: new Date(Date.now() + 60_000),
		revoked_at: null,
		id: "00000000-0000-4000-8000-000000000002",
		display_name: "Player",
		status: "active",
		deletion_requested_at: null,
		purge_after: null,
	};
}

describe("Hub session activity", () => {
	it("authenticates through a read and throttles the non-critical last-seen write", async () => {
		const calls = [];
		const pool = {
			on: () => {},
			connect: async () => null,
			async query (sql) {
				calls.push(sql);
				if (calls.length === 1) return {rowCount: 1, rows: [getSessionRow({lastSeenAt: new Date(Date.now() - 120_000)})]};
				return {rowCount: 1, rows: []};
			},
		};
		const store = new PostgresHubStore({pool, fnOnPoolError: () => {}});
		await expect(store.pGetSessionByTokenHash({tokenHash: "a".repeat(64)})).resolves.toEqual(expect.objectContaining({
			account: expect.objectContaining({status: "active"}),
		}));
		await new Promise(resolve => setImmediate(resolve));
		expect(calls[0]).toMatch(/^\s*SELECT/);
		expect(calls[1]).toContain("last_seen_at = now()");
	});

	it("does not touch a recently seen session", async () => {
		const calls = [];
		const pool = {
			on: () => {},
			connect: async () => null,
			async query (sql) {
				calls.push(sql);
				return {rowCount: 1, rows: [getSessionRow({lastSeenAt: new Date()})]};
			},
		};
		const store = new PostgresHubStore({pool, fnOnPoolError: () => {}});
		await store.pGetSessionByTokenHash({tokenHash: "a".repeat(64)});
		expect(calls).toHaveLength(1);
	});
});
