import {pFetchProviderJson} from "../../../server/src/oauth-provider-http.js";

describe("OAuth provider HTTP boundary", () => {
	it("accepts one bounded JSON object over fixed HTTPS", async () => {
		const value = await pFetchProviderJson({
			url: "https://provider.example/token",
			fnFetch: async (url, options) => {
				expect(url).toBe("https://provider.example/token");
				expect(options.redirect).toBe("manual");
				return new Response(JSON.stringify({token_type: "Bearer"}), {
					status: 200,
					headers: {"content-type": "application/json; charset=utf-8"},
				});
			},
		});
		expect(value).toEqual({token_type: "Bearer"});
	});

	it("aborts a slow request and returns only the stable provider error", async () => {
		await expect(pFetchProviderJson({
			url: "https://provider.example/token",
			timeoutMs: 1,
			fnFetch: async (_url, options) => new Promise((resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(new Error("upstream detail")), {once: true});
			}),
		})).rejects.toMatchObject({
			code: "AUTH_PROVIDER_UNAVAILABLE",
			message: "Authentication provider request failed.",
		});
	});

	it.each([
		["http://provider.example/token", new Response("{}", {status: 200, headers: {"content-type": "application/json"}})],
		["https://provider.example/token", new Response("{}", {status: 302, headers: {"content-type": "application/json"}})],
		["https://provider.example/token", new Response("{}", {status: 200, headers: {"content-type": "text/plain"}})],
		["https://provider.example/token", new Response("[]", {status: 200, headers: {"content-type": "application/json"}})],
	])("rejects an unsafe URL or response shape", async (url, response) => {
		await expect(pFetchProviderJson({
			url,
			fnFetch: async () => response,
		})).rejects.toMatchObject({code: "AUTH_PROVIDER_UNAVAILABLE"});
	});
});
