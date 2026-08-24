import {HubApiClient, HubApiError} from "../../../js/hub/hub-api-client.js";

function getResponse ({status = 200, body = {}} = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json () { return structuredClone(body); },
	};
}

describe("hub API client", () => {
	it("calls the browser fetch global without rebinding its receiver", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async function () {
			expect(this).toBe(globalThis);
			return getResponse({body: {signedIn: false}});
		};
		try {
			await expect(new HubApiClient().pGetSession()).resolves.toEqual({signedIn: false});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("carries the session CSRF token and a unique mutation key", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") {
					return getResponse({
						body: {signedIn: true, account: {id: "a"}, csrfToken: "csrf-1"},
					});
				}
				return getResponse({status: 201, body: {campaign: {id: "c1"}}});
			},
		});

		await client.pGetSession();
		await client.pCreateCampaign({name: "Campaign", idempotencyKey: "stable-key"});

		expect(calls[1]).toEqual(expect.objectContaining({
			path: "/api/campaigns",
			opts: expect.objectContaining({
				method: "POST",
				credentials: "same-origin",
				headers: expect.objectContaining({
					"x-csrf-token": "csrf-1",
					"idempotency-key": "stable-key",
				}),
			}),
		}));
	});

	it("refuses a mutation before session bootstrap", async () => {
		const client = new HubApiClient({fnFetch: async () => getResponse()});
		await expect(client.pCreateCampaign({name: "Campaign"})).rejects.toEqual(expect.objectContaining({
			code: "CSRF_NOT_READY",
		}));
	});

	it("surfaces stable API error codes", async () => {
		const client = new HubApiClient({
			fnFetch: async () => getResponse({status: 404, body: {error: "CAMPAIGN_NOT_FOUND"}}),
		});
		await expect(client.pGetCampaign({campaignId: "missing"})).rejects.toEqual(expect.objectContaining({
			code: "CAMPAIGN_NOT_FOUND",
			status: 404,
		}));
	});

	it("clears mutation state after logout", async () => {
		const client = new HubApiClient({
			fnFetch: async path => path === "/api/session"
				? getResponse({body: {signedIn: true, csrfToken: "csrf-1"}})
				: getResponse({body: {ok: true}}),
		});
		await client.pGetSession();
		await client.pLogout();

		await expect(client.pCreateCampaign({name: "Campaign"})).rejects.toBeInstanceOf(HubApiError);
	});
});
