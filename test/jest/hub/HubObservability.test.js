import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {
	getSafeRequestId,
	getSafeRequestLog,
	HUB_LOG_REDACT_PATHS,
	HubMetrics,
} from "../../../server/src/observability.js";

describe("Hub observability", () => {
	it("accepts only bounded request ids and emits route-template metrics", () => {
		expect(getSafeRequestId({headers: {"x-request-id": "request-123"}})).toBe("request-123");
		expect(getSafeRequestId({headers: {"x-request-id": "bad request"}})).toBeNull();
		expect(getSafeRequestId({headers: {"x-request-id": "x".repeat(101)}})).toBeNull();
		let now = 1_000;
		const metrics = new HubMetrics({fnNow: () => now});
		metrics.observeRequest({method: "GET", route: "/api/characters/:characterId", statusCode: 200, durationMs: 12});
		metrics.observeAuth({provider: "github", outcome: "succeeded"});
		now += 1_000;
		const text = metrics.toPrometheus({
			operational: {outboxPending: 2, outboxFailed: 1, lastBackupAgeSeconds: -1},
			websocketConnections: 3,
			dispatcher: {lastBatchCount: 4},
		});

		expect(text).toContain(`route="/api/characters/:characterId"`);
		expect(text).toContain("hub_http_requests_total");
		expect(text).toContain(`hub_auth_outcomes_total{provider="github",outcome="succeeded"} 1`);
		expect(text).toContain("hub_outbox_pending 2");
		expect(text).toContain("hub_websocket_connections 3");
		expect(text).toContain("hub_last_backup_age_seconds -1");
	});

	it("strips OAuth and other query strings from structured request logs", () => {
		expect(getSafeRequestLog({
			method: "GET",
			url: "/auth/github/callback?code=SECRET_OAUTH_CODE&state=SECRET_STATE",
			headers: {host: "tools.example"},
			ip: "127.0.0.1",
			socket: {remotePort: 1234},
		})).toEqual({
			method: "GET",
			url: "/auth/github/callback",
			host: "tools.example",
			remoteAddress: "127.0.0.1",
			remotePort: 1234,
		});
	});

	it("redacts authentication and mutation credentials", () => {
		for (const path of [
			"req.headers.authorization",
			"req.headers.cookie",
			`req.headers["x-csrf-token"]`,
			`req.headers["idempotency-key"]`,
			`res.headers["set-cookie"]`,
			"codeVerifier",
			"pkceVerifier",
			"oidcNonce",
			"accessToken",
			"refreshToken",
			"idToken",
		]) expect(HUB_LOG_REDACT_PATHS).toContain(path);
	});

	it("protects metrics with a separate bearer token and returns Prometheus text", async () => {
		const token = "m".repeat(32);
		const app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: () => "", pExchangeCode: async () => ({})},
			config: {
				appOrigin: "https://tools.example",
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				metricsToken: token,
			},
		});
		try {
			expect((await app.inject({method: "GET", url: "/api/metrics"})).statusCode).toBe(401);
			const response = await app.inject({
				method: "GET",
				url: "/api/metrics",
				headers: {authorization: `Bearer ${token}`, "x-request-id": "metrics-probe"},
			});
			expect(response.statusCode).toBe(200);
			expect(response.headers["content-type"]).toContain("text/plain");
			expect(response.headers["x-request-id"]).toBe("metrics-probe");
			expect(response.body).toContain("hub_process_uptime_seconds");
		} finally {
			await app.close();
		}
	});
});
