import {DiscordOAuthProvider} from "../../../server/src/discord-oauth-provider.js";

function getJsonResponse (body) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {"content-type": "application/json"},
	});
}

describe("Discord OAuth provider", () => {
	it("uses the concrete Discord authorization flow without PKCE or email scope", () => {
		const provider = new DiscordOAuthProvider({clientId: "client", clientSecret: "secret"});
		const url = new URL(provider.getAuthorizationUrl({
			state: "state",
			redirectUri: "https://tools.example/auth/discord/callback",
		}));

		expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: "code",
			client_id: "client",
			redirect_uri: "https://tools.example/auth/discord/callback",
			scope: "identify",
			state: "state",
		});
		expect(provider.capabilities).toEqual({pkce: false, oidcNonce: false});
	});

	it("exchanges at the canonical token endpoint and preserves a large snowflake as text", async () => {
		const calls = [];
		const responses = [
			getJsonResponse({access_token: "callback-token", token_type: "Bearer", scope: "identify", refresh_token: "discard"}),
			getJsonResponse({
				id: "900719925474099312",
				username: "discord-user",
				global_name: "Discord Name",
				email: "ignored@example.com",
			}),
		];
		const provider = new DiscordOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async (url, options) => {
				calls.push({url, options});
				return responses.shift();
			},
		});

		const identity = await provider.pExchangeCodeForIdentity({
			code: "code",
			redirectUri: "https://tools.example/auth/discord/callback",
		});

		expect(calls[0].url).toBe("https://discord.com/api/oauth2/token");
		expect(calls[0].options.redirect).toBe("manual");
		expect(calls[0].options.headers.authorization).toBe(`Basic ${Buffer.from("client:secret").toString("base64")}`);
		expect(new URLSearchParams(calls[0].options.body)).toEqual(new URLSearchParams({
			grant_type: "authorization_code",
			code: "code",
			redirect_uri: "https://tools.example/auth/discord/callback",
		}));
		expect(calls[1].url).toBe("https://discord.com/api/v10/users/@me");
		expect(identity).toEqual({
			provider: "discord",
			subject: "900719925474099312",
			handle: "discord-user",
			displayName: "Discord Name",
		});
		expect(identity).not.toHaveProperty("email");
		expect(identity).not.toHaveProperty("accessToken");
	});

	it.each([
		[{access_token: "", token_type: "Bearer", scope: "identify"}, {id: "123", username: "user"}],
		[{access_token: "token", token_type: "mac", scope: "identify"}, {id: "123", username: "user"}],
		[{access_token: "token", token_type: "Bearer", scope: "identify email"}, {id: "123", username: "user"}],
		[{access_token: "token", token_type: "Bearer", scope: "identify"}, {id: "09007199254740993", username: "user"}],
		[{access_token: "token", token_type: "Bearer", scope: "identify"}, {id: "123", username: " "}],
	])("fails closed for malformed token or profile data", async (token, profile) => {
		const responses = [getJsonResponse(token), getJsonResponse(profile)];
		const provider = new DiscordOAuthProvider({
			clientId: "client",
			clientSecret: "secret",
			fnFetch: async () => responses.shift(),
		});

		await expect(provider.pExchangeCodeForIdentity({
			code: "code",
			redirectUri: "https://tools.example/auth/discord/callback",
		})).rejects.toMatchObject({
			code: "AUTH_PROVIDER_UNAVAILABLE",
			message: "Authentication provider request failed.",
		});
	});
});
