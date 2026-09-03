import {AuthProviderError} from "./auth-provider-error.js";
import {normalizeExternalIdentity} from "./external-identity.js";
import {pFetchProviderJson} from "./oauth-provider-http.js";

const DISCORD_AUTHORIZATION_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_PROFILE_URL = "https://discord.com/api/v10/users/@me";
const DISCORD_SCOPE = "identify";

function getBoundedText (value, {required = false} = {}) {
	if (value == null && !required) return null;
	if (typeof value !== "string") throw new AuthProviderError();
	const normalized = value.trim();
	if (!normalized) {
		if (required) throw new AuthProviderError();
		return null;
	}
	return Array.from(normalized).slice(0, 100).join("");
}

export class DiscordOAuthProvider {
	constructor ({clientId, clientSecret, fnFetch = fetch}) {
		if (typeof clientId !== "string" || !clientId || typeof clientSecret !== "string" || !clientSecret) {
			throw new TypeError(`Discord OAuth client credentials are required.`);
		}
		this._clientId = clientId;
		this._clientSecret = clientSecret;
		this._fnFetch = fnFetch;
		this.slug = "discord";
		this.label = "Discord";
		this.startPath = "/auth/discord/start";
		this.callbackPath = "/auth/discord/callback";
		this.capabilities = Object.freeze({pkce: false, oidcNonce: false});
	}

	getAuthorizationUrl ({state, redirectUri}) {
		const url = new URL(DISCORD_AUTHORIZATION_URL);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", this._clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("scope", DISCORD_SCOPE);
		url.searchParams.set("state", state);
		return url.href;
	}

	async pExchangeCodeForIdentity ({code, redirectUri}) {
		const tokenData = await pFetchProviderJson({
			fnFetch: this._fnFetch,
			url: DISCORD_TOKEN_URL,
			options: {
				method: "POST",
				headers: {
					accept: "application/json",
					authorization: `Basic ${Buffer.from(`${this._clientId}:${this._clientSecret}`).toString("base64")}`,
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
				}).toString(),
			},
		});
		if (
			typeof tokenData.access_token !== "string"
			|| !tokenData.access_token
			|| tokenData.access_token.length > 4_096
			|| typeof tokenData.token_type !== "string"
			|| tokenData.token_type.toLowerCase() !== "bearer"
			|| tokenData.scope !== DISCORD_SCOPE
		) throw new AuthProviderError();

		const profile = await pFetchProviderJson({
			fnFetch: this._fnFetch,
			url: DISCORD_PROFILE_URL,
			options: {
				headers: {
					accept: "application/json",
					authorization: `Bearer ${tokenData.access_token}`,
				},
			},
		});
		if (typeof profile.id !== "string" || !/^[1-9][0-9]{0,19}$/.test(profile.id)) throw new AuthProviderError();
		const handle = getBoundedText(profile.username, {required: true});
		const displayName = getBoundedText(profile.global_name) || handle;

		return normalizeExternalIdentity({
			provider: "discord",
			subject: profile.id,
			handle,
			displayName,
		});
	}
}
