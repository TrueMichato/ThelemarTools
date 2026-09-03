import {
	exportJWK,
	generateKeyPair,
	SignJWT,
} from "jose";

import {GoogleOAuthProvider} from "../../../server/src/google-oauth-provider.js";

const CLIENT_ID = "google-client";
const REDIRECT_URI = "https://tools.example/auth/google/callback";

function getJsonResponse (body) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {"content-type": "application/json"},
	});
}

async function getFixture () {
	const {privateKey, publicKey} = await generateKeyPair("RS256");
	const jwk = await exportJWK(publicKey);
	jwk.kid = "key-1";
	jwk.use = "sig";
	const now = Math.floor(Date.now() / 1000);
	const getToken = async (overrides = {}, header = {}) => new SignJWT({
		iss: "https://accounts.google.com",
		aud: CLIENT_ID,
		sub: "immutable-google-subject",
		nonce: "nonce",
		name: "Google User",
		iat: now,
		exp: now + 300,
		...overrides,
	})
		.setProtectedHeader({alg: "RS256", kid: "key-1", ...header})
		.sign(privateKey);
	return {jwk, getToken};
}

describe("Google OAuth provider", () => {
	it("builds the fixed Google OIDC authorization request", () => {
		const provider = new GoogleOAuthProvider({clientId: CLIENT_ID, clientSecret: "secret"});
		const url = new URL(provider.getAuthorizationUrl({
			state: "state",
			codeChallenge: "challenge",
			nonce: "nonce",
			redirectUri: REDIRECT_URI,
		}));

		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: "code",
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			scope: "openid profile",
			state: "state",
			nonce: "nonce",
			code_challenge: "challenge",
			code_challenge_method: "S256",
		});
		expect(provider.capabilities).toEqual({pkce: "S256", oidcNonce: true});
	});

	it.each([
		"accounts.google.com",
		"https://accounts.google.com",
	])("validates the ID token from issuer %s and returns only immutable authority plus bounded presentation", async issuer => {
		const {jwk, getToken} = await getFixture();
		const calls = [];
		const token = await getToken({iss: issuer, email: "ignored@example.com", email_verified: true, name: "G".repeat(150)});
		const provider = new GoogleOAuthProvider({
			clientId: CLIENT_ID,
			clientSecret: "secret",
			fnFetch: async (url, options) => {
				calls.push({url, options});
				if (url === "https://oauth2.googleapis.com/token") {
					return getJsonResponse({id_token: token, access_token: "discard", refresh_token: "discard"});
				}
				if (url === "https://www.googleapis.com/oauth2/v3/certs") return getJsonResponse({keys: [jwk]});
				throw new Error("unexpected URL");
			},
		});

		const identity = await provider.pExchangeCodeForIdentity({
			code: "code",
			codeVerifier: "verifier",
			nonce: "nonce",
			redirectUri: REDIRECT_URI,
		});

		expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
		expect(new URLSearchParams(calls[0].options.body)).toEqual(new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			client_secret: "secret",
			code: "code",
			code_verifier: "verifier",
			redirect_uri: REDIRECT_URI,
		}));
		expect(calls[1].url).toBe("https://www.googleapis.com/oauth2/v3/certs");
		expect(identity).toEqual({
			provider: "google",
			subject: "immutable-google-subject",
			handle: null,
			displayName: "G".repeat(100),
		});
		expect(identity).not.toHaveProperty("email");
		expect(identity).not.toHaveProperty("idToken");
	});

	it.each([
		[{iss: "https://evil.example"}, "nonce"],
		[{aud: "other-client"}, "nonce"],
		[{aud: [CLIENT_ID, "other-client"]}, "nonce"],
		[{aud: [CLIENT_ID, "other-client"], azp: "other-client"}, "nonce"],
		[{nonce: "wrong"}, "nonce"],
		[{sub: ""}, "nonce"],
		[{iat: Math.floor(Date.now() / 1000) - 700}, "nonce"],
		[{exp: Math.floor(Date.now() / 1000) - 120}, "nonce"],
	])("fails closed for invalid OIDC authority or time claims", async (claims, nonce) => {
		const {jwk, getToken} = await getFixture();
		const token = await getToken(claims);
		const provider = new GoogleOAuthProvider({
			clientId: CLIENT_ID,
			clientSecret: "secret",
			fnFetch: async url => url === "https://oauth2.googleapis.com/token"
				? getJsonResponse({id_token: token})
				: getJsonResponse({keys: [jwk]}),
		});

		await expect(provider.pExchangeCodeForIdentity({
			code: "code",
			codeVerifier: "verifier",
			nonce,
			redirectUri: REDIRECT_URI,
		})).rejects.toMatchObject({
			code: "AUTH_PROVIDER_UNAVAILABLE",
			message: "Authentication provider request failed.",
		});
	});

	it("caches JWKS between successful callbacks", async () => {
		const {jwk, getToken} = await getFixture();
		const token = await getToken();
		let jwksCalls = 0;
		const provider = new GoogleOAuthProvider({
			clientId: CLIENT_ID,
			clientSecret: "secret",
			fnFetch: async url => {
				if (url === "https://oauth2.googleapis.com/token") return getJsonResponse({id_token: token});
				jwksCalls++;
				return getJsonResponse({keys: [jwk]});
			},
		});
		const context = {code: "code", codeVerifier: "verifier", nonce: "nonce", redirectUri: REDIRECT_URI};

		await provider.pExchangeCodeForIdentity(context);
		await provider.pExchangeCodeForIdentity(context);

		expect(jwksCalls).toBe(1);
	});

	it("refreshes JWKS for a rotated unknown key after the cooldown", async () => {
		const first = await getFixture();
		const {privateKey: secondPrivateKey, publicKey: secondPublicKey} = await generateKeyPair("RS256");
		const secondJwk = await exportJWK(secondPublicKey);
		secondJwk.kid = "key-2";
		secondJwk.use = "sig";
		const now = Math.floor(Date.now() / 1000);
		const secondToken = await new SignJWT({
			iss: "https://accounts.google.com",
			aud: CLIENT_ID,
			sub: "rotated-subject",
			nonce: "nonce",
			iat: now,
			exp: now + 300,
		})
			.setProtectedHeader({alg: "RS256", kid: "key-2"})
			.sign(secondPrivateKey);
		const tokens = [await first.getToken(), secondToken];
		let jwksCalls = 0;
		const provider = new GoogleOAuthProvider({
			clientId: CLIENT_ID,
			clientSecret: "secret",
			jwksCooldownMs: 0,
			fnFetch: async url => {
				if (url === "https://oauth2.googleapis.com/token") return getJsonResponse({id_token: tokens.shift()});
				jwksCalls++;
				return getJsonResponse({keys: jwksCalls === 1 ? [first.jwk] : [first.jwk, secondJwk]});
			},
		});
		const context = {code: "code", codeVerifier: "verifier", nonce: "nonce", redirectUri: REDIRECT_URI};

		await provider.pExchangeCodeForIdentity(context);
		const rotatedIdentity = await provider.pExchangeCodeForIdentity(context);

		expect(rotatedIdentity.subject).toBe("rotated-subject");
		expect(jwksCalls).toBe(2);
	});
});
