import {pCheckAuthProviderFirstEnable} from "../../../server/scripts/check-auth-provider-first-enable.mjs";

const ORIGIN = "https://tools.example";
const TOKEN = "m".repeat(32);

function getMetaResponse (discord = "available", google = "available") {
	return new Response(JSON.stringify({
		authProviders: [
			{slug: "github", status: "available"},
			{slug: "discord", status: discord},
			{slug: "google", status: google},
		],
	}), {status: 200, headers: {"content-type": "application/json"}});
}

function getMetricsResponse ({discord, google, discordLinked = null, googleLinked = null}) {
	const lines = [
		`hub_auth_outcomes_total{provider="discord",outcome="succeeded"} ${discord}`,
		`hub_auth_outcomes_total{provider="google",outcome="succeeded"} ${google}`,
	];
	if (discordLinked != null) lines.push(`hub_auth_outcomes_total{provider="discord",outcome="linked"} ${discordLinked}`);
	if (googleLinked != null) lines.push(`hub_auth_outcomes_total{provider="google",outcome="linked"} ${googleLinked}`);
	return new Response(lines.join("\n"), {status: 200, headers: {"content-type": "text/plain"}});
}

describe("Hub paired provider first-enable preflight", () => {
	it("requires a new successful callback from each provider after the baseline", async () => {
		const output = [];
		let metricsRead = 0;
		const result = await pCheckAuthProviderFirstEnable({
			appOrigin: ORIGIN,
			metricsToken: TOKEN,
			pollIntervalMs: 1,
			timeoutMs: 1_000,
			fnSleep: async () => {},
			fnWrite: value => output.push(value),
			fnFetch: async (url, options) => {
				if (url.endsWith("/api/meta")) return getMetaResponse();
				expect(options.headers.authorization).toBe(`Bearer ${TOKEN}`);
				metricsRead++;
				if (metricsRead === 1) return getMetricsResponse({discord: 4, google: 8});
				if (metricsRead === 2) return getMetricsResponse({discord: 5, google: 8});
				return getMetricsResponse({discord: 5, google: 9});
			},
		});

		expect(result).toEqual({ok: true});
		expect(output.join("")).toContain(`${ORIGIN}/auth/discord/start?returnTo=%2Fhub.html`);
		expect(output.join("")).toContain(`${ORIGIN}/auth/google/start?returnTo=%2Fhub.html`);
		expect(output.join("")).toContain("preflight passed");
	});

	it("blocks when either provider is unavailable before or during the probe", async () => {
		await expect(pCheckAuthProviderFirstEnable({
			appOrigin: ORIGIN,
			metricsToken: TOKEN,
			fnFetch: async () => getMetaResponse("disabled", "available"),
		})).rejects.toMatchObject({code: "PROVIDERS_NOT_AVAILABLE"});

		let metadataRead = 0;
		await expect(pCheckAuthProviderFirstEnable({
			appOrigin: ORIGIN,
			metricsToken: TOKEN,
			pollIntervalMs: 1,
			timeoutMs: 100,
			fnSleep: async () => {},
			fnWrite: () => {},
			fnFetch: async url => {
				if (url.endsWith("/api/meta")) {
					metadataRead++;
					return metadataRead === 1 ? getMetaResponse() : getMetaResponse("available", "configuration_error");
				}
				return getMetricsResponse({discord: 0, google: 0});
			},
		})).rejects.toMatchObject({code: "PROVIDER_BECAME_UNAVAILABLE"});
	});

	it("accepts successful account links as paired first-enable evidence", async () => {
		let metricsRead = 0;
		await expect(pCheckAuthProviderFirstEnable({
			appOrigin: ORIGIN,
			metricsToken: TOKEN,
			pollIntervalMs: 1,
			timeoutMs: 100,
			fnSleep: async () => {},
			fnWrite: () => {},
			fnFetch: async url => {
				if (url.endsWith("/api/meta")) return getMetaResponse();
				metricsRead++;
				return metricsRead === 1
					? getMetricsResponse({discord: 2, google: 3, discordLinked: 0, googleLinked: 0})
					: getMetricsResponse({discord: 2, google: 3, discordLinked: 1, googleLinked: 1});
			},
		})).resolves.toEqual({ok: true});
	});

	it("blocks a metrics reset after the baseline", async () => {
		let metricsRead = 0;
		await expect(pCheckAuthProviderFirstEnable({
			appOrigin: ORIGIN,
			metricsToken: TOKEN,
			pollIntervalMs: 1,
			timeoutMs: 100,
			fnSleep: async () => {},
			fnWrite: () => {},
			fnFetch: async url => {
				if (url.endsWith("/api/meta")) return getMetaResponse();
				metricsRead++;
				return metricsRead === 1
					? getMetricsResponse({discord: 2, google: 3})
					: getMetricsResponse({discord: 0, google: 0});
			},
		})).rejects.toMatchObject({code: "METRICS_RESET"});
	});

	it("fails closed on malformed or unauthorized responses without echoing response data", async () => {
		for (const response of [
			new Response("secret-upstream-body", {status: 503}),
			new Response("{", {status: 200}),
			new Response(JSON.stringify({authProviders: "invalid"}), {status: 200}),
		]) {
			await expect(pCheckAuthProviderFirstEnable({
				appOrigin: ORIGIN,
				metricsToken: TOKEN,
				fnFetch: async () => response,
			})).rejects.toMatchObject({code: expect.stringMatching(/REQUEST_FAILED|INVALID_METADATA/)});
		}
	});
});
