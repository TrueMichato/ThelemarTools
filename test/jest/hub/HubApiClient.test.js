import {
	HubApiClient,
	HubApiError,
	HubTransferProposalDrafts,
	HubTransferRefreshQueue,
	HubTransferResolutionDrafts,
	pResolveTransferFromDraft,
} from "../../../js/hub/hub-api-client.js";

function getResponse ({status = 200, body = {}} = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json () { return structuredClone(body); },
	};
}

describe("hub API client", () => {
	it("serializes transfer refreshes in invocation order and releases the queue after failure", async () => {
		const queue = new HubTransferRefreshQueue();
		const order = [];
		let releaseFirst;
		const firstGate = new Promise(resolve => releaseFirst = resolve);
		const pFirst = queue.pRun(async () => {
			order.push("first:start");
			await firstGate;
			order.push("first:end");
		});
		const pSecond = queue.pRun(async () => order.push("second"));

		await Promise.resolve();
		expect(order).toEqual(["first:start"]);
		releaseFirst();
		await Promise.all([pFirst, pSecond]);
		expect(order).toEqual(["first:start", "first:end", "second"]);

		await expect(queue.pRun(async () => { throw new Error("refresh failed"); })).rejects.toThrow("refresh failed");
		await expect(queue.pRun(async () => "recovered")).resolves.toBe("recovered");
	});

	it("rotates a definitive stale transfer decision only after a separate reconciled attempt", async () => {
		const keys = ["accept-1", "accept-2"];
		const drafts = new HubTransferResolutionDrafts({fnCreateKey: () => keys.shift()});
		const requests = [];
		let rulesRead = 0;
		const pRun = () => pResolveTransferFromDraft({
			drafts,
			campaignId: "campaign-1",
			transferId: "transfer-1",
			pGetRulesVersionId: async () => `rules-${++rulesRead}`,
			pResolve: async request => {
				requests.push(request);
				if (requests.length === 1) throw new HubApiError({code: "RULES_VERSION_STALE", status: 409});
				return {transfer: {id: "transfer-1", status: "committed"}};
			},
		});

		await expect(pRun()).rejects.toEqual(expect.objectContaining({code: "RULES_VERSION_STALE"}));
		expect(drafts.get({campaignId: "campaign-1", transferId: "transfer-1"})).toBeNull();
		await expect(pRun()).resolves.toEqual({transfer: {id: "transfer-1", status: "committed"}});

		expect(requests).toEqual([
			expect.objectContaining({rulesVersionId: "rules-1", idempotencyKey: "accept-1"}),
			expect.objectContaining({rulesVersionId: "rules-2", idempotencyKey: "accept-2"}),
		]);
		expect(drafts.get({campaignId: "campaign-1", transferId: "transfer-1"})).toBeNull();
	});

	it("freezes one transfer proposal per account and campaign until its exact key is reconciled", () => {
		let now = 100;
		const drafts = new HubTransferProposalDrafts({fnNow: () => now, replayWindowMs: 50});
		const first = {
			sourceKind: "character",
			sourceId: "source-1",
			targetKind: "character",
			targetId: "target-1",
			payload: {items: [{entryId: "item-1", quantity: 1}]},
			rulesVersionId: "rules-1",
			idempotencyKey: "proposal-1",
			isAutoResolved: true,
		};
		const staged = drafts.stage({accountId: "account-1", campaignId: "campaign-1", request: first});
		first.targetId = "changed-locally";
		staged.payload.items[0].quantity = 99;

		expect(drafts.stage({
			accountId: "account-1",
			campaignId: "campaign-1",
			request: {...first, idempotencyKey: "proposal-2"},
		})).toEqual(expect.objectContaining({
			targetId: "target-1",
			payload: {items: [{entryId: "item-1", quantity: 1}]},
			rulesVersionId: "rules-1",
			idempotencyKey: "proposal-1",
			isAutoResolved: true,
			replayUntil: 150,
		}));
		expect(drafts.isReplayable(staged)).toBe(true);
		now = 150;
		expect(drafts.isReplayable(staged)).toBe(false);
		expect(drafts.get({accountId: "account-2", campaignId: "campaign-1"})).toBeNull();
		expect(drafts.clear({
			accountId: "account-1",
			campaignId: "campaign-1",
			idempotencyKey: "wrong-key",
		})).toBe(false);
		expect(drafts.clear({
			accountId: "account-1",
			campaignId: "campaign-1",
			idempotencyKey: "proposal-1",
		})).toBe(true);
		expect(drafts.get({accountId: "account-1", campaignId: "campaign-1"})).toBeNull();
	});

	it("reconciles expired transfer proposals without unlocking known or ambiguous commands", () => {
		const proposalRequest = {
			sourceKind: "character",
			sourceId: "source-1",
			targetKind: "character",
			targetId: "target-1",
			payload: {
				items: [{entryId: "item-b", quantity: 2}, {entryId: "item-a", quantity: 1}],
				currency: {gp: 3},
			},
			idempotencyKey: "proposal-1",
		};
		const matchingTransfer = {
			id: "transfer-1",
			actorCommandId: "proposal-1",
			status: "reserved",
			sourceKind: "character",
			targetKind: "character",
			targetId: "target-1",
			payload: {escrow: {items: [{id: "item-a", quantity: 1}, {id: "item-b", quantity: 2}], currency: {gp: 3}}},
		};

		expect(HubTransferProposalDrafts.reconcileExpiredProposal({
			proposalRequest,
			transfers: [matchingTransfer],
		})).toEqual({state: "pending", transfer: matchingTransfer});
		const terminalTransfer = {...matchingTransfer, status: "committed"};
		expect(HubTransferProposalDrafts.reconcileExpiredProposal({
			proposalRequest,
			transfers: [terminalTransfer],
		})).toEqual({state: "terminal", transfer: terminalTransfer});
		expect(HubTransferProposalDrafts.reconcileExpiredProposal({
			proposalRequest,
			transfers: [],
		})).toEqual({state: "absent"});

		const legacyMatch = {...matchingTransfer, actorCommandId: undefined};
		expect(HubTransferProposalDrafts.reconcileExpiredProposal({
			proposalRequest,
			transfers: [legacyMatch],
		})).toEqual({state: "pending", transfer: legacyMatch, isLegacy: true});
		expect(HubTransferProposalDrafts.reconcileExpiredProposal({
			proposalRequest,
			transfers: [legacyMatch, {...legacyMatch, id: "transfer-2"}],
		})).toEqual({state: "ambiguous"});
	});

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
					"x-hub-protocol-version": "6",
				}),
			}),
		}));
	});

	it("adopts unlink session rotation CSRF before the next mutation", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") {
					return getResponse({body: {signedIn: true, csrfToken: "csrf-old"}});
				}
				if (path.includes("/api/account/identities/")) {
					return getResponse({body: {
						ok: true,
						unlinkedIdentityId: "identity-1",
						csrfToken: "csrf-new",
						identities: [],
					}});
				}
				return getResponse({body: {ok: true, revokedSessionIds: []}});
			},
		});

		await client.pGetSession();
		await client.pUnlinkAccountIdentity({identityId: "identity-1", idempotencyKey: "unlink-1"});
		await client.pRevokeOtherSessions({idempotencyKey: "revoke-1"});

		expect(calls[1]).toEqual(expect.objectContaining({
			path: "/api/account/identities/identity-1",
			opts: expect.objectContaining({
				method: "DELETE",
				headers: expect.objectContaining({"x-csrf-token": "csrf-old"}),
			}),
		}));
		expect(calls[2].opts.headers["x-csrf-token"]).toBe("csrf-new");
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

	it("uses protocol-6 multi-target proposal, invitation, finalization, and read routes", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				return getResponse({body: {operation: {operationId: "operation-1"}}});
			},
		});
		await client.pGetSession();
		await client.pCreateMultiTargetOperation({
			campaignId: "campaign-1",
			sourceCharacterId: "source-1",
			sourceEntity: {type: "ability", uid: "shared restoration|tst", version: "tst-v1"},
			effectTemplateId: "ability.shared-restoration.heal",
			choice: {amount: 4},
			targetRefs: ["target-a", "target-b"],
			rulesVersionId: "rules-1",
			idempotencyKey: "proposal-1",
		});
		await client.pRespondMultiTargetInvitation({
			campaignId: "campaign-1",
			operationId: "operation-1",
			invitationId: "invitation-1",
			decision: "approve",
			idempotencyKey: "response-1",
		});
		await client.pFinalizeMultiTargetOperation({
			campaignId: "campaign-1",
			operationId: "operation-1",
			selectedInvitationIds: ["invitation-1"],
			idempotencyKey: "finalization-1",
		});
		await client.pCancelMultiTargetOperation({
			campaignId: "campaign-1",
			operationId: "operation-2",
			idempotencyKey: "cancel-1",
		});
		await client.pListMultiTargetInbox({campaignId: "campaign-1", cursor: "cursor-1", limit: 25});
		await client.pListMultiTargetOutgoing({campaignId: "campaign-1"});
		await client.pGetMultiTargetOperation({campaignId: "campaign-1", operationId: "operation-1"});

		expect(calls.slice(1).map(call => call.path)).toEqual([
			"/api/campaigns/campaign-1/multi-target-operations",
			"/api/campaigns/campaign-1/multi-target-operations/operation-1/invitations/invitation-1/respond",
			"/api/campaigns/campaign-1/multi-target-operations/operation-1/finalize",
			"/api/campaigns/campaign-1/multi-target-operations/operation-2/cancel",
			"/api/campaigns/campaign-1/multi-target-operations/inbox?limit=25&cursor=cursor-1",
			"/api/campaigns/campaign-1/multi-target-operations/outgoing?limit=100",
			"/api/campaigns/campaign-1/multi-target-operations/operation-1",
		]);
		expect(JSON.parse(calls[1].opts.body)).toMatchObject({
			contractVersion: 1,
			commandId: "proposal-1",
			targetRefs: ["target-a", "target-b"],
		});
		for (const call of calls.slice(1, 5)) {
			expect(call.opts.headers["x-hub-protocol-version"]).toBe("6");
		}
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

	it("keeps a transfer acceptance body immutable and requires a new key after a stale policy pin", async () => {
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
		})).rejects.toEqual(expect.objectContaining({code: "RULES_VERSION_STALE"}));
		await expect(client.pResolveTransfer({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "accept",
			idempotencyKey: "accept-2",
		})).resolves.toEqual({transfer: {id: "transfer-1", status: "committed"}});

		const resolveCalls = calls.filter(call => call.path.endsWith("/resolve"));
		expect(resolveCalls.map(call => JSON.parse(call.opts.body).rulesVersionId)).toEqual(["rules-1", "rules-2"]);
		expect(resolveCalls.map(call => call.opts.headers["idempotency-key"])).toEqual(["accept-1", "accept-2"]);
	});

	it("pins an atomic direct transfer proposal to the active rules version", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				return getResponse({status: 201, body: {transfer: {id: "transfer-1", status: "committed"}}});
			},
		});
		await client.pGetSession();
		await client.pProposeTransfer({
			campaignId: "campaign-1",
			sourceKind: "character",
			sourceId: "source-1",
			targetKind: "character",
			targetId: "target-1",
			payload: {items: [{entryId: "item-1", quantity: 1}], currency: {}},
			rulesVersionId: "rules-1",
			idempotencyKey: "transfer-1",
		});

		expect(JSON.parse(calls[1].opts.body)).toEqual({
			sourceKind: "character",
			sourceId: "source-1",
			targetKind: "character",
			targetId: "target-1",
			payload: {items: [{entryId: "item-1", quantity: 1}], currency: {}},
			rulesVersionId: "rules-1",
		});
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

	it("starts and retries invite admission without authenticated mutation headers", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				return getResponse({body: {authorizationUrl: "https://provider.example", retryToken: "r".repeat(32)}});
			},
		});
		await client.pCreateInviteAdmission({token: "t".repeat(32), provider: "github", returnTo: "/hub.html"});
		await client.pRetryInviteAdmission({retryToken: "r".repeat(32), provider: "github", returnTo: "/hub.html"});
		expect(calls.map(call => call.path)).toEqual([
			"/api/auth/invite-contexts",
			"/api/auth/invite-contexts/retry",
		]);
		for (const call of calls) {
			expect(call.opts.method).toBe("POST");
			expect(call.opts.headers["x-hub-protocol-version"]).toBe("6");
			expect(call.opts.headers).not.toHaveProperty("x-csrf-token");
			expect(call.opts.headers).not.toHaveProperty("idempotency-key");
		}
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

	it("uses provider reauthentication and operator entitlement routes", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path === "/api/operator/accounts") return getResponse({body: {accounts: []}});
				return getResponse({body: {authorizationUrl: "https://provider.example/authorize"}});
			},
		});
		await client.pGetSession();
		await client.pStartReauthentication({provider: "github"});
		await client.pListOperatorAccounts();
		await client.pGrantAccountEntitlement({accountId: "account", entitlement: "campaign:create", idempotencyKey: "grant"});
		await client.pRevokeAccountEntitlement({accountId: "account", entitlement: "campaign:create", idempotencyKey: "revoke"});
		expect(calls.map(call => [call.path, call.opts.method || "GET"])).toEqual([
			["/api/session", "GET"],
			["/api/account/reauthentication/github", "POST"],
			["/api/operator/accounts", "GET"],
			["/api/operator/accounts/account/entitlements/campaign%3Acreate/grant", "POST"],
			["/api/operator/accounts/account/entitlements/campaign%3Acreate/revoke", "POST"],
		]);
		expect(calls[1].opts.body).toBe(JSON.stringify({returnTo: "/hub.html"}));
		expect(calls[3].opts.headers["idempotency-key"]).toBe("grant");
		expect(calls[4].opts.headers["idempotency-key"]).toBe("revoke");
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
		await expect(client.pReleaseCharacterLease({
			characterId: "character",
			leaseEpoch: 7,
			expiresAt: "2030-01-01T00:00:00.000Z",
		}))
			.resolves.toEqual({released: true});
		expect(calls.map(call => [call.path, call.opts.method || "GET"])).toEqual([
			["/api/session", "GET"],
			["/api/campaigns/campaign/compatibility", "GET"],
			["/api/characters/character/lease/release", "POST"],
		]);
		expect(JSON.parse(calls.at(-1).opts.body)).toEqual({
			leaseEpoch: 7,
			expiresAt: "2030-01-01T00:00:00.000Z",
		});
	});

	it("uses an exclusive backward activity cursor and forwards closed spell activity", async () => {
		const calls = [];
		const client = new HubApiClient({
			fnFetch: async (path, opts = {}) => {
				calls.push({path, opts});
				if (path === "/api/session") return getResponse({body: {signedIn: true, csrfToken: "csrf-1"}});
				if (path.includes("/events?")) return getResponse({body: {events: [], history: {scannedBackThroughSequence: 20, hasMore: true}}});
				return getResponse({body: {character: {id: "character", revision: 2, data: {}}}});
			},
		});
		await client.pGetSession();
		await client.pListEventPage({campaignId: "campaign", beforeSequence: 40, limit: 8});
		const activity = {
			type: "spell.used",
			spellName: "Fireball",
			spellSource: "PHB",
			spellLevel: 3,
			slotLevel: 5,
			mode: "spell_slot",
		};
		await client.pPatchCharacter({
			characterId: "character",
			baseRevision: 1,
			leaseEpoch: 2,
			patches: [],
			activity,
			idempotencyKey: "cast",
		});

		expect(calls[1].path).toBe("/api/campaigns/campaign/events?beforeSequence=40&limit=8");
		expect(JSON.parse(calls[2].opts.body)).toEqual({
			baseRevision: 1,
			leaseEpoch: 2,
			patches: [],
			activity,
		});
		await expect(client.pListEventPage({
			campaignId: "campaign",
			afterSequence: 1,
			beforeSequence: 40,
		})).rejects.toThrow(/one event cursor/i);
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
