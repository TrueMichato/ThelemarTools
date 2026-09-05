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
					"x-hub-protocol-version": "4",
				}),
			}),
		}));
	});

	it("pins cost-bearing peer proposals and reads source-owner status", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path.endsWith("/outgoing-actions")) return getResponse({body: {actions: [{actionId: "action-1"}]}});
				return getResponse({status: 201, body: {operation: {operationId: "action-1"}}});
			},
		});
		await client.pGetSession();
		await client.pCreatePeerAction({
			campaignId: "campaign-1",
			contractVersion: 1,
			sourceCharacterId: "source-1",
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 2},
			targetRef: "opaque-target",
			rulesVersionId: "rules-1",
			idempotencyKey: "peer-command-1",
		});
		await expect(client.pListCharacterOutgoingActions({
			campaignId: "campaign-1",
			characterId: "source-1",
		})).resolves.toEqual([{actionId: "action-1"}]);

		expect(JSON.parse(calls[1].opts.body)).toEqual({
			contractVersion: 1,
			commandId: "peer-command-1",
			sourceCharacterId: "source-1",
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 2},
			targetRef: "opaque-target",
			rulesVersionId: "rules-1",
		});
		expect(calls[2].path).toBe("/api/campaigns/campaign-1/characters/source-1/outgoing-actions");
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

	it("pins transfer acceptance to the current policy and retries once after a concurrent activation", async () => {
		const calls = [];
		let contextReads = 0;
		let resolveWrites = 0;
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path.endsWith("/context")) {
					contextReads++;
					return getResponse({body: {context: {rulesVersion: {id: `rules-${contextReads}`}}}});
				}
				if (path.endsWith("/resolve")) {
					resolveWrites++;
					if (resolveWrites === 1) return getResponse({status: 409, body: {error: "RULES_VERSION_STALE"}});
					return getResponse({body: {transfer: {id: "transfer-1", status: "committed"}}});
				}
				throw new Error(`Unexpected request: ${path}`);
			},
		});
		await client.pGetSession();

		await expect(client.pResolveTransfer({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "accept",
			idempotencyKey: "accept-1",
		})).resolves.toEqual({transfer: {id: "transfer-1", status: "committed"}});

		const resolveCalls = calls.filter(call => call.path.endsWith("/resolve"));
		expect(resolveCalls.map(call => JSON.parse(call.opts.body).rulesVersionId)).toEqual(["rules-1", "rules-2"]);
		expect(resolveCalls.map(call => call.opts.headers["idempotency-key"])).toEqual(["accept-1", "accept-1"]);
	});

	it("normalizes browser fetch failures without leaking browser-specific messages", async () => {
		const original = new TypeError("Load failed");
		const client = new HubApiClient({
			fnFetch: async () => { throw original; },
		});

		await expect(client.pGetCampaign({campaignId: "campaign"})).rejects.toEqual(expect.objectContaining({
			code: "NETWORK_UNAVAILABLE",
			status: 0,
			cause: original,
		}));
	});

	it("rejects unreadable successful responses explicitly", async () => {
		const client = new HubApiClient({
			fnFetch: async () => ({
				ok: true,
				status: 200,
				async json () { throw new SyntaxError("not json"); },
			}),
		});

		await expect(client.pGetCampaign({campaignId: "campaign"})).rejects.toEqual(expect.objectContaining({
			code: "RESPONSE_INVALID",
			status: 200,
		}));
	});

	it("retains service status when an error response is unreadable", async () => {
		const client = new HubApiClient({
			fnFetch: async () => ({
				ok: false,
				status: 503,
				async json () { throw new SyntaxError("proxy response"); },
			}),
		});

		await expect(client.pGetCampaign({campaignId: "campaign"})).rejects.toEqual(expect.objectContaining({
			code: "REQUEST_FAILED",
			status: 503,
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

	it("uses the lifecycle administration routes and mutation headers", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path === "/api/account/sessions") return getResponse({body: {sessions: []}});
				if (path.endsWith("/invites") && opts.method === "GET") return getResponse({body: {invites: []}});
				return getResponse({body: {ok: true}});
			},
		});
		await client.pGetSession();
		await client.pListSessions();
		await client.pRevokeOtherSessions({idempotencyKey: "sessions"});
		await client.pListInvites({campaignId: "campaign"});
		await client.pRevokeInvite({campaignId: "campaign", inviteId: "invite", idempotencyKey: "invite"});
		await client.pChangeMemberRole({campaignId: "campaign", membershipId: "membership", role: "spectator", idempotencyKey: "role"});
		await client.pRemoveMember({campaignId: "campaign", membershipId: "membership", idempotencyKey: "remove"});
		await client.pRequestAccountDeletion({idempotencyKey: "delete"});
		expect(calls.map(call => [call.path, call.opts.method || "GET"])).toEqual(expect.arrayContaining([
			["/api/account/sessions", "GET"],
			["/api/account/sessions/revoke-others", "POST"],
			["/api/campaigns/campaign/invites", "GET"],
			["/api/campaigns/campaign/invites/invite/revoke", "POST"],
			["/api/campaigns/campaign/members/membership", "PATCH"],
			["/api/campaigns/campaign/members/membership", "DELETE"],
			["/api/account/deletion/request", "POST"],
		]));
		expect(calls.find(call => call.path === "/api/account/deletion/request").opts.headers["idempotency-key"]).toBe("delete");
	});

	it("uses compact compatibility and current-session lease release routes", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path.endsWith("/compatibility")) return getResponse({body: {compatibility: {campaignId: "campaign"}}});
				return getResponse({body: {released: true}});
			},
		});
		await client.pGetSession();

		await expect(client.pGetCampaignCompatibility({campaignId: "campaign"}))
			.resolves.toEqual({campaignId: "campaign"});
		await expect(client.pReleaseCharacterLease({characterId: "character"}))
			.resolves.toEqual({released: true});
		expect(calls.map(call => [call.path, call.opts.method || "GET"])).toEqual([
			["/api/session", "GET"],
			["/api/campaigns/campaign/compatibility", "GET"],
			["/api/characters/character/lease/release", "POST"],
		]);
	});

	it("sends one idempotent item-award batch", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				return getResponse({body: {awardId: "award-1", targets: []}});
			},
		});
		await client.pGetSession();
		await client.pAwardItems({
			campaignId: "campaign",
			source: {kind: "catalog", item: {name: "Rope", source: "PHB", weight: 10}},
			targetCharacterIds: ["character-1", "character-2"],
			quantity: 2,
			note: "For the climb",
			idempotencyKey: "award-key",
		});

		expect(calls[1]).toEqual(expect.objectContaining({
			path: "/api/campaigns/campaign/item-awards",
			opts: expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					source: {kind: "catalog", item: {name: "Rope", source: "PHB", weight: 10}},
					targetCharacterIds: ["character-1", "character-2"],
					quantity: 2,
					note: "For the climb",
				}),
				headers: expect.objectContaining({"idempotency-key": "award-key"}),
			}),
		}));
	});
});
