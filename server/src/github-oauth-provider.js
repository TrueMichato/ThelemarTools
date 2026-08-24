export class GitHubOAuthProvider {
	constructor ({clientId, clientSecret, fnFetch = fetch}) {
		if (!clientId || !clientSecret) throw new TypeError(`GitHub OAuth client credentials are required.`);
		this._clientId = clientId;
		this._clientSecret = clientSecret;
		this._fnFetch = fnFetch;
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

	async pExchangeCode ({code, codeVerifier, redirectUri}) {
		const tokenResponse = await this._fnFetch("https://github.com/login/oauth/access_token", {
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
		});
		if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed with status ${tokenResponse.status}.`);
		const tokenData = await tokenResponse.json();
		if (!tokenData.access_token) throw new Error(`GitHub token exchange did not return an access token.`);

		const userResponse = await this._fnFetch("https://api.github.com/user", {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${tokenData.access_token}`,
				"user-agent": "5etools-campaign-hub",
				"x-github-api-version": "2022-11-28",
			},
		});
		if (!userResponse.ok) throw new Error(`GitHub user lookup failed with status ${userResponse.status}.`);
		const user = await userResponse.json();
		if (user.id == null || !user.login) throw new Error(`GitHub user response was incomplete.`);
		const displayName = Array.from(`${user.name || user.login}`.trim()).slice(0, 100).join("")
			|| Array.from(`${user.login}`).slice(0, 100).join("");
		return {
			provider: "github",
			providerSubject: `${user.id}`,
			login: user.login,
			displayName,
		};
	}
}
