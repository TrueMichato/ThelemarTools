import {pGetAuthProviderRollbackBlockers} from "../../../server/src/auth-provider-operations.js";

describe("Hub authentication provider operations", () => {
	it("counts accounts which would lose every supported rollback identity", async () => {
		const calls = [];
		const result = await pGetAuthProviderRollbackBlockers({
			queryable: {
				query: async (sql, params) => {
					calls.push({sql, params});
					return {rows: [{blocked_accounts: "2"}]};
				},
			},
			supportedProviders: ["github"],
			allowedSubjects: ["github:123", "github:456"],
		});

		expect(result).toEqual({blockedAccounts: 2});
		expect(calls[0].sql).toContain("NOT EXISTS");
		expect(calls[0].sql).toContain("account.status <> 'deleted'");
		expect(calls[0].sql).toContain("identity.provider || ':' || identity.provider_subject");
		expect(calls[0].sql).toContain("audit.details->>'admission' = 'campaign_invite'");
		expect(calls[0].params).toEqual([["github"], ["github:123", "github:456"]]);
	});

	it("accepts an empty optional legacy allowlist and fails closed on malformed provider policy", async () => {
		const queryable = {query: async () => { throw new Error("should not query"); }};
		await expect(pGetAuthProviderRollbackBlockers({
			queryable,
			supportedProviders: [],
			allowedSubjects: ["github:123"],
		})).rejects.toThrow(/At least one rollback authentication provider/);
		await expect(pGetAuthProviderRollbackBlockers({
			queryable,
			supportedProviders: ["GitHub"],
			allowedSubjects: ["github:123"],
		})).rejects.toThrow(/lower-case registry slugs/);
		const calls = [];
		await expect(pGetAuthProviderRollbackBlockers({
			queryable: {
				query: async (sql, params) => {
					calls.push({sql, params});
					return {rows: [{blocked_accounts: "0"}]};
				},
			},
			supportedProviders: ["github"],
			allowedSubjects: [],
		})).resolves.toEqual({blockedAccounts: 0});
		expect(calls[0].params).toEqual([["github"], []]);
	});
});
