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
});
