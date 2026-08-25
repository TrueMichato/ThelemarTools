import {createHubApp} from "../../../server/src/app.js";
import {getClientIpHeader, getRequestClientIp} from "../../../server/src/client-ip.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getSafeRequestLog} from "../../../server/src/observability.js";

const APP_ORIGIN = "https://tools.example";

function getApp (config = {}) {
	return createHubApp({
		store: new MemoryHubStore(),
		oauthProvider: {getAuthorizationUrl: () => "https://github.example/authorize", pExchangeCode: async () => ({})},
		config: {
			appOrigin: APP_ORIGIN,
			cookieSecret: "x".repeat(32),
			csrfSecret: "y".repeat(32),
			...config,
		},
	});
}

describe("Hub trusted client IP", () => {
	it("accepts only the provider header explicitly supported by the deployment contract", () => {
		expect(getClientIpHeader(null)).toBeNull();
		expect(getClientIpHeader("DO-CONNECTING-IP")).toBe("do-connecting-ip");
		expect(() => getClientIpHeader("x-forwarded-for")).toThrow("Unsupported trusted client IP header");
	});

	it("uses one valid provider address and safely falls back for missing or ambiguous values", () => {
		const base = {ip: "172.20.0.4", socket: {remoteAddress: "172.20.0.4"}};
		expect(getRequestClientIp({
			request: {...base, headers: {"do-connecting-ip": "203.0.113.8"}},
			clientIpHeader: "do-connecting-ip",
		})).toBe("203.0.113.8");
		for (const raw of [undefined, "203.0.113.8, 198.51.100.3", "not-an-ip"]) {
			expect(getRequestClientIp({
				request: {...base, headers: {"do-connecting-ip": raw}},
				clientIpHeader: "do-connecting-ip",
			})).toBe("172.20.0.4");
		}
	});

	it("uses the same provider address in safe structured request logs", () => {
		expect(getSafeRequestLog({
			method: "GET",
			url: "/api/session?secret=no",
			headers: {host: "tools.example", "do-connecting-ip": "2001:db8::5"},
			ip: "172.20.0.4",
			socket: {remotePort: 443},
		}, {clientIpHeader: "do-connecting-ip"})).toEqual(expect.objectContaining({
			url: "/api/session",
			remoteAddress: "2001:db8::5",
		}));
	});

	it("keys HTTP rate limits by the configured provider address", async () => {
		const app = await getApp({clientIpHeader: "do-connecting-ip"});
		try {
			for (let i = 0; i < 10; i++) {
				expect((await app.inject({
					method: "GET",
					url: "/auth/github/start",
					headers: {"do-connecting-ip": "203.0.113.9"},
				})).statusCode).toBe(302);
			}
			expect((await app.inject({
				method: "GET",
				url: "/auth/github/start",
				headers: {"do-connecting-ip": "203.0.113.9"},
			})).statusCode).toBe(429);
			expect((await app.inject({
				method: "GET",
				url: "/auth/github/start",
				headers: {"do-connecting-ip": "203.0.113.10"},
			})).statusCode).toBe(302);
			for (let i = 0; i < 10; i++) {
				expect((await app.inject({
					method: "GET",
					url: "/auth/github/start",
					headers: {"do-connecting-ip": `2001:db8:abcd:12::${i + 1}`},
				})).statusCode).toBe(302);
			}
			expect((await app.inject({
				method: "GET",
				url: "/auth/github/start",
				headers: {"do-connecting-ip": "2001:db8:abcd:12::ff"},
			})).statusCode).toBe(429);
		} finally {
			await app.close();
		}
	});

	it("rejects unsupported provider-header configuration", async () => {
		await expect(getApp({clientIpHeader: "x-real-ip"})).rejects.toThrow("Unsupported trusted client IP header");
		await expect(getApp({
			clientIpHeader: "do-connecting-ip",
			trustProxy: ["172.20.0.0/16"],
		})).rejects.toThrow("clientIpHeader and trustProxy cannot be enabled together");
	});
});
