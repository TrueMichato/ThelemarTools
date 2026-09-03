import {
	createRemoteJWKSet,
	customFetch,
	jwtVerify,
} from "jose";

import {AuthProviderError} from "./auth-provider-error.js";
import {normalizeExternalIdentity} from "./external-identity.js";
import {
	OAUTH_PROVIDER_HTTP_TIMEOUT_MS,
	OAUTH_PROVIDER_JWKS_MAX_BYTES,
	pFetchProviderJson,
} from "./oauth-provider-http.js";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_SCOPE = "openid profile";

function getOptionalDisplayName (value) {
	if (value == null) return null;
	if (typeof value !== "string") throw new AuthProviderError();
	const normalized = value.trim();
	if (!normalized) return null;
	return Array.from(normalized).slice(0, 100).join("");
}

function getBoundedJwksFetch (fnFetch) {
	return async url => {
		const jwks = await pFetchProviderJson({
			fnFetch,
			url,
			maxBytes: OAUTH_PROVIDER_JWKS_MAX_BYTES,
		});
		return new Response(JSON.stringify(jwks), {
			status: 200,
			headers: {"content-type": "application/json"},
		});
	};
}

export class GoogleOAuthProvider {
	constructor ({
		clientId,
		clientSecret,
		fnFetch = fetch,
		fnVerify = jwtVerify,
		jwksCooldownMs = 30_000,
	}) {
		if (typeof clientId !== "string" || !clientId || typeof clientSecret !== "string" || !clientSecret) {
			throw new TypeError(`Google OAuth client credentials are required.`);
		}
		this._clientId = clientId;
		this._clientSecret = clientSecret;
		this._fnFetch = fnFetch;
		this._fnVerify = fnVerify;
		this._jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
			timeoutDuration: OAUTH_PROVIDER_HTTP_TIMEOUT_MS,
			cooldownDuration: jwksCooldownMs,
			cacheMaxAge: 10 * 60_000,
			[customFetch]: getBoundedJwksFetch(fnFetch),
		});
		this.slug = "google";
		this.label = "Google";
		this.startPath = "/auth/google/start";
		this.callbackPath = "/auth/google/callback";
		this.capabilities = Object.freeze({pkce: "S256", oidcNonce: true});
	}

	getAuthorizationUrl ({state, codeChallenge, nonce, redirectUri}) {
		const url = new URL(GOOGLE_AUTHORIZATION_URL);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", this._clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("scope", GOOGLE_SCOPE);
		url.searchParams.set("state", state);
		url.searchParams.set("nonce", nonce);
		url.searchParams.set("code_challenge", codeChallenge);
		url.searchParams.set("code_challenge_method", "S256");
		return url.href;
	}

	async pExchangeCodeForIdentity ({code, codeVerifier, nonce, redirectUri}) {
		try {
			const tokenData = await pFetchProviderJson({
				fnFetch: this._fnFetch,
				url: GOOGLE_TOKEN_URL,
				options: {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/x-www-form-urlencoded",
					},
					body: new URLSearchParams({
						grant_type: "authorization_code",
						client_id: this._clientId,
						client_secret: this._clientSecret,
						code,
						code_verifier: codeVerifier,
						redirect_uri: redirectUri,
					}).toString(),
				},
			});
			if (typeof tokenData.id_token !== "string" || !tokenData.id_token || tokenData.id_token.length > 16_384) {
				throw new AuthProviderError();
			}

			const {payload} = await this._fnVerify(tokenData.id_token, this._jwks, {
				algorithms: ["RS256"],
				issuer: GOOGLE_ISSUER,
				audience: this._clientId,
				clockTolerance: 60,
				maxTokenAge: "10 minutes",
				requiredClaims: ["exp", "iat", "nonce", "sub"],
			});
			if (
				!Number.isInteger(payload.exp)
				|| !Number.isInteger(payload.iat)
				|| payload.iat > Math.floor(Date.now() / 1000) + 60
				|| payload.nonce !== nonce
				|| (payload.azp != null && payload.azp !== this._clientId)
				|| (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this._clientId)
			) throw new AuthProviderError();

			return normalizeExternalIdentity({
				provider: "google",
				subject: payload.sub,
				handle: null,
				displayName: getOptionalDisplayName(payload.name),
			});
		} catch {
			throw new AuthProviderError();
		}
	}
}
