import {
	AuthProviderRegistry,
	AUTH_PROVIDER_REGISTRY_CAPABILITY,
	createAuthProviderRegistration,
	getLegacyGitHubAuthProviderRegistry,
} from "../../../server/src/auth-provider-registry.js";

function getProvider (overrides = {}) {
	return {
		slug: "github",
		label: "GitHub",
		startPath: "/auth/github/start",
		callbackPath: "/auth/github/callback",
		capabilities: {pkce: "S256", oidcNonce: false},
		getAuthorizationUrl: () => "https://github.example/authorize",
		pExchangeCodeForIdentity: async () => ({
			provider: "github",
			subject: "123",
			handle: "octo",
			displayName: "Octo",
			email: "ignored@example.com",
		}),
		...overrides,
	};
}

describe("Hub authentication provider registry", () => {
	it("publishes bounded provider metadata and strips non-authority claims", async () => {
		const registry = new AuthProviderRegistry({
			registrations: [{status: "available", provider: getProvider()}],
		});

		expect(AUTH_PROVIDER_REGISTRY_CAPABILITY).toBe("auth.provider_registry.v1");
		expect(registry.getPublicMetadata()).toEqual([{
			slug: "github",
			label: "GitHub",
			startPath: "/auth/github/start",
			status: "available",
		}]);
		const identity = await registry.getAvailableProviders()[0].pExchangeCodeForIdentity({});
		expect(identity).toEqual({
			provider: "github",
			subject: "123",
			handle: "octo",
			displayName: "Octo",
		});
		expect(identity).not.toHaveProperty("email");
	});

	it("keeps a valid provider available when a sibling configuration fails", () => {
		const notices = [];
		const failed = createAuthProviderRegistration({
			slug: "future",
			label: "Future Provider",
			fnCreate: () => { throw new Error("client secret must never reach metadata"); },
			onConfigurationError: notice => notices.push(notice),
		});
		const registry = new AuthProviderRegistry({
			registrations: [
				{status: "available", provider: getProvider()},
				failed,
			],
		});

		expect(registry.getAvailableProviders()).toHaveLength(1);
		expect(registry.getPublicMetadata()).toEqual([
			expect.objectContaining({slug: "github", status: "available"}),
			expect.objectContaining({slug: "future", status: "configuration_error"}),
		]);
		expect(JSON.stringify(registry.getPublicMetadata())).not.toContain("secret");
		expect(notices).toEqual([{slug: "future", code: "Error"}]);
	});

	it("fails closed on ambiguous routes, mismatched identities, or no usable provider", async () => {
		expect(() => new AuthProviderRegistry({
			registrations: [
				{status: "available", provider: getProvider()},
				{status: "available", provider: getProvider()},
			],
		})).toThrow(/Duplicate authentication provider slug/);
		expect(() => new AuthProviderRegistry({
			registrations: [{
				status: "available",
				provider: getProvider({callbackPath: "/auth/not-github/callback"}),
			}],
		})).toThrow(/callback path/);
		expect(() => new AuthProviderRegistry({
			registrations: [{
				slug: "github",
				label: "GitHub",
				startPath: "/auth/github/start",
				callbackPath: "/auth/github/callback",
				status: "configuration_error",
			}],
		})).toThrow(/At least one authentication provider must be available/);

		const mismatched = new AuthProviderRegistry({
			registrations: [{
				status: "available",
				provider: getProvider({
					pExchangeCodeForIdentity: async () => ({provider: "other", subject: "123"}),
				}),
			}],
		});
		await expect(mismatched.getAvailableProviders()[0].pExchangeCodeForIdentity({}))
			.rejects.toThrow(/mismatched identity/);
	});

	it("adapts the legacy GitHub test seam without changing its identity key", async () => {
		const registry = getLegacyGitHubAuthProviderRegistry({
			getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
			pExchangeCode: async () => ({
				provider: "github",
				providerSubject: "456",
				login: "legacy",
				displayName: "Legacy",
			}),
		});

		expect(registry.getAvailableProviders()[0].getAuthorizationUrl({state: "state"}))
			.toBe("https://github.example/?state=state");
		expect(await registry.getAvailableProviders()[0].pExchangeCodeForIdentity({})).toEqual({
			provider: "github",
			subject: "456",
			handle: "legacy",
			displayName: "Legacy",
		});
	});
});
