export class AuthProviderError extends Error {
	constructor (code = "AUTH_PROVIDER_UNAVAILABLE") {
		super("Authentication provider request failed.");
		this.name = "AuthProviderError";
		this.code = code;
		this.status = 503;
	}
}
