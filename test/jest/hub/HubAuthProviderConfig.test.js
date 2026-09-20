import {
	createAuthProviderConfiguration,
	getAllowedOAuthSubjects,
} from "../../../server/src/auth-provider-config.js";

function getEnv (overrides = {}) {
	return {
		GITHUB_CLIENT_ID: "github-client",
		GITHUB_CLIENT_SECRET: "test-secret",
		DISCORD_CLIENT_ID: "discord-client",
		DISCORD_CLIENT_SECRET: "test-secret",
		GOOGLE_CLIENT_ID: "google-client",
		GOOGLE_CLIENT_SECRET: "test-secret",
		...overrides,
	};
}

describe("Hub authentication provider configuration", () => {
	it("defaults to GitHub and publishes disabled sibling metadata", () => {
		const {authProviderRegistry} = createAuthProviderConfiguration({env: getEnv()});

		expect(authProviderRegistry.getPublicMetadata()).toEqual([
			expect.objectContaining({slug: "github", status: "available"}),
			expect.objectContaining({slug: "discord", status: "disabled"}),
			expect.objectContaining({slug: "google", status: "disabled"}),
		]);
	});

	it("enables Discord and Google only as a pair", () => {
		for (const providers of ["github,discord", "github,google", "discord", "google"]) {
			expect(() => createAuthProviderConfiguration({
				env: getEnv({HUB_AUTH_PROVIDERS: providers}),
			})).toThrow("Discord and Google must be configured together.");
		}

		const {authProviderRegistry} = createAuthProviderConfiguration({
			env: getEnv({HUB_AUTH_PROVIDERS: "github,discord,google"}),
		});
		expect(authProviderRegistry.getAvailableProviders().map(it => it.slug)).toEqual(["github", "discord", "google"]);
	});

	it("isolates emergency disablement and local configuration failures", () => {
		const notices = [];
		const {authProviderRegistry} = createAuthProviderConfiguration({
			env: getEnv({
				HUB_AUTH_PROVIDERS: "github,discord,google",
				HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS: "discord",
				GOOGLE_CLIENT_SECRET: "",
			}),
			onConfigurationError: notice => notices.push(notice),
		});

		expect(authProviderRegistry.getPublicMetadata()).toEqual([
			expect.objectContaining({slug: "github", status: "available"}),
			expect.objectContaining({slug: "discord", status: "disabled"}),
			expect.objectContaining({slug: "google", status: "configuration_error"}),
		]);
		expect(notices).toEqual([{slug: "google", code: "INVALID_CREDENTIAL"}]);
		expect(JSON.stringify(notices)).not.toContain("test-secret");
	});

	it("fails startup when no provider remains usable", () => {
		expect(() => createAuthProviderConfiguration({
			env: getEnv({
				HUB_AUTH_PROVIDERS: "github",
				HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS: "github",
			}),
		})).toThrow("At least one authentication provider must be available.");
	});

	it.each([
		["github,unknown", ""],
		["github,github", ""],
		["github", "unknown"],
	])("rejects unknown or duplicate provider configuration", (configured, emergency) => {
		expect(() => createAuthProviderConfiguration({
			env: getEnv({
				HUB_AUTH_PROVIDERS: configured,
				HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS: emergency,
			}),
		})).toThrow();
	});

	it("does not derive first-account admission from provider subjects", () => {
		const configured = createAuthProviderConfiguration({
			env: getEnv({HUB_ALLOWED_OAUTH_SUBJECTS: "github:123"}),
		});
		expect(configured).not.toHaveProperty("allowedOAuthSubjects");
	});

	it("retains strict subject parsing only for legacy rollback preflight", () => {
		expect(getAllowedOAuthSubjects("github:123,google:case-sensitive:opaque"))
			.toEqual(["github:123", "google:case-sensitive:opaque"]);
		for (const value of ["github:0", "email@example.com", "unknown:123", "github:123,github:123"]) {
			expect(() => getAllowedOAuthSubjects(value)).toThrow();
		}
	});
});
