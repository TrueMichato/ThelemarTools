import {pGrantHubDatabaseRoles} from "../../../server/src/database-roles.js";

describe("Hub database roles", () => {
	it("grants runtime writes and backup reads without schema creation", async () => {
		const calls = [];
		const client = {
			async query (sql, params = []) {
				calls.push({sql, params});
				if (sql.startsWith("SELECT 1 FROM pg_roles")) return {rowCount: 1, rows: [{exists: 1}]};
				return {rowCount: 0, rows: []};
			},
		};
		await expect(pGrantHubDatabaseRoles({
			client,
			runtimeRole: "hub_runtime",
			backupRole: "hub_backup",
		})).resolves.toEqual({runtimeRole: "hub_runtime", backupRole: "hub_backup"});
		const sql = calls.map(it => it.sql).join("\n");
		expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hub TO "hub_runtime"`);
		expect(sql).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA hub TO "hub_backup"`);
		expect(sql).toContain(`REVOKE CREATE ON SCHEMA hub FROM "hub_runtime"`);
		expect(sql).toContain(`REVOKE CREATE ON SCHEMA hub FROM "hub_backup"`);
	});

	it("rejects role-name injection before issuing a query", async () => {
		const client = {query: async () => { throw new Error("should not query"); }};
		await expect(pGrantHubDatabaseRoles({
			client,
			runtimeRole: `hub_runtime"; DROP SCHEMA hub; --`,
		})).rejects.toThrow(/lowercase PostgreSQL role identifier/);
	});

	it("fails when a configured role does not exist", async () => {
		const client = {query: async () => ({rowCount: 0, rows: []})};
		await expect(pGrantHubDatabaseRoles({
			client,
			runtimeRole: "missing_runtime",
		})).rejects.toThrow(/does not exist/);
	});
});
