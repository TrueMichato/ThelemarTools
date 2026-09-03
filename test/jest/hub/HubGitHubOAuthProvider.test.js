import {GitHubOAuthProvider} from "../../../server/src/github-oauth-provider.js";

function getJsonResponse (body) {
	return {
		ok: true,
		status: 200,
		async json () { return body; },
	};
}

describe("GitHub OAuth provider", () => {
	it("bounds profile display names to the database contract", async () => {
		const longName = "A".repeat(150);
		const responses = [
			getJsonResponse({access_token: "token"}),
			getJsonResponse({id: 123, login: "user", name: longName}),
		];
		const provider = new GitHubOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async () => responses.shift(),
		});

		const identity = await provider.pExchangeCode({
			code: "code",
			codeVerifier: "verifier",
			redirectUri: "https://tools.example/auth/github/callback",
		});

		expect(Array.from(identity.displayName)).toHaveLength(100);
		expect(identity.providerSubject).toBe("123");
	});

	it("falls back to a bounded login when the profile name is blank", async () => {
		const responses = [
			getJsonResponse({access_token: "token"}),
			getJsonResponse({id: 123, login: "fallback-user", name: "   "}),
		];
		const provider = new GitHubOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async () => responses.shift(),
		});

		const identity = await provider.pExchangeCode({
			code: "code",
			codeVerifier: "verifier",
			redirectUri: "https://tools.example/auth/github/callback",
		});

		expect(identity.displayName).toBe("fallback-user");
	});

	it("returns only the normalized immutable subject at the registry boundary", async () => {
		const responses = [
			getJsonResponse({access_token: "callback-only-token"}),
			getJsonResponse({id: 900719, login: "octo", name: "Octo", email: "ignored@example.com"}),
		];
		const provider = new GitHubOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async () => responses.shift(),
		});

		const identity = await provider.pExchangeCodeForIdentity({
			code: "code",
			codeVerifier: "verifier",
			redirectUri: "https://tools.example/auth/github/callback",
		});

		expect(identity).toEqual({
			provider: "github",
			subject: "900719",
			handle: "octo",
			displayName: "Octo",
		});
		expect(identity).not.toHaveProperty("email");
		expect(identity).not.toHaveProperty("accessToken");
	});

	it("fails closed with a stable error when provider responses are invalid", async () => {
		const provider = new GitHubOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async () => ({ok: false, status: 401, json: async () => ({error: "secret-provider-body"})}),
		});

		await expect(provider.pExchangeCodeForIdentity({
			code: "code",
			codeVerifier: "verifier",
			redirectUri: "https://tools.example/auth/github/callback",
		})).rejects.toMatchObject({
			code: "AUTH_PROVIDER_UNAVAILABLE",
			message: "Authentication provider request failed.",
		});
	});
});
