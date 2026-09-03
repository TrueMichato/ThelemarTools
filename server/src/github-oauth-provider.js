import {AuthProviderError} from "./auth-provider-error.js";
import {normalizeExternalIdentity} from "./external-identity.js";
import {pFetchProviderJson} from "./oauth-provider-http.js";

export class GitHubOAuthProvider {
	constructor ({clientId, clientSecret, fnFetch = fetch}) {
		if (!clientId || !clientSecret) throw new TypeError(`GitHub OAuth client credentials are required.`);
		this._clientId = clientId;
		this._clientSecret = clientSecret;
		this._fnFetch = fnFetch;
		this.slug = "github";
		this.label = "GitHub";
		this.startPath = "/auth/github/start";
		this.callbackPath = "/auth/github/callback";
		this.capabilities = Object.freeze({pkce: "S256", oidcNonce: false});
	}

	getAuthorizationUrl ({state, codeChallenge, redirectUri}) {
		const url = new URL("https://github.com/login/oauth/authorize");
		url.searchParams.set("client_id", this._clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("scope", "read:user");
		url.searchParams.set("state", state);
		url.searchParams.set("code_challenge", codeChallenge);
		url.searchParams.set("code_challenge_method", "S256");
		return url.href;
	}

	async pExchangeCodeForIdentity ({code, codeVerifier, redirectUri}) {
		const tokenData = await pFetchProviderJson({
			fnFetch: this._fnFetch,
			url: "https://github.com/login/oauth/access_token",
			options: {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					client_id: this._clientId,
					client_secret: this._clientSecret,
					code,
					code_verifier: codeVerifier,
					redirect_uri: redirectUri,
				}),
			},
		});
		if (typeof tokenData.access_token !== "string" || !tokenData.access_token || tokenData.access_token.length > 4_096) {
			throw new AuthProviderError();
		}

		const user = await pFetchProviderJson({
			fnFetch: this._fnFetch,
			url: "https://api.github.com/user",
			options: {
				headers: {
					accept: "application/vnd.github+json",
					authorization: `Bearer ${tokenData.access_token}`,
					"user-agent": "5etools-campaign-hub",
					"x-github-api-version": "2022-11-28",
				},
			},
		});
		if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== "string" || !user.login.trim()) {
			throw new AuthProviderError();
		}
		const handle = Array.from(user.login.trim()).slice(0, 100).join("");
		const displayName = Array.from(`${user.name || user.login}`.trim()).slice(0, 100).join("") || handle;
		return normalizeExternalIdentity({
			provider: "github",
			subject: `${user.id}`,
			handle,
			displayName,
		});
	}

	async pExchangeCode (context) {
		const identity = await this.pExchangeCodeForIdentity(context);
		return {
			provider: identity.provider,
			providerSubject: identity.subject,
			login: identity.handle,
			displayName: identity.displayName,
		};
	}
}
