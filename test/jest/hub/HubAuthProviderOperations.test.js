import {pGetAuthProviderRollbackBlockers} from "../../../server/src/auth-provider-operations.js";

describe("Hub authentication provider operations", () => {
	it("counts accounts which would lose every admitted rollback identity", async () => {
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
		expect(calls[0].sql).toContain("EXISTS");
		expect(calls[0].sql).toContain("identity.provider || ':' || identity.provider_subject");
		expect(calls[0].sql).toContain("account.status <> 'deleted'");
		expect(calls[0].params).toEqual([["github"], ["github:123", "github:456"]]);
	});

	it("fails closed on empty or malformed rollback policy", async () => {
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
		await expect(pGetAuthProviderRollbackBlockers({
			queryable,
			supportedProviders: ["github"],
			allowedSubjects: [],
		})).rejects.toThrow(/admitted provider subject/);
	});
});
