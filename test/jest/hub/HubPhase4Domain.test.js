import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const ORIGIN = "https://tools.example";
const identities = {
	dm: {provider: "github", providerSubject: "1", login: "dm", displayName: "DM"},
	a: {provider: "github", providerSubject: "2", login: "a", displayName: "A"},
	b: {provider: "github", providerSubject: "3", login: "b", displayName: "B"},
};

function cookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("Phase 4 actions, grants, and transfers", () => {
	let app;
	let store;
	let identity;
	let ix;

	beforeEach(async () => {
		identity = identities.dm;
		ix = 0;
		store = new MemoryHubStore({fnResolveAwardItem: async ({item}) => structuredClone(item)});
		app = await createHubApp({
			store,
			oauthProvider: {getAuthorizationUrl: ({state}) => `https://x/?state=${state}`, pExchangeCode: async () => identity},
			config: {appOrigin: ORIGIN, cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32), allowedOAuthSubjects: ["github:1", "github:2", "github:3"]},
		});
	});

	afterEach(async () => app.close());

	async function signIn (who) {
		identity = who;
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({method: "GET", url: `/auth/github/callback?code=x&state=${state}`, headers: {cookie: `__Host-hub_oauth=${cookie(start, "__Host-hub_oauth")}`}});
		const sessionCookie = `__Host-hub_session=${cookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie: sessionCookie}})).json();
		return {cookie: sessionCookie, ...session};
	}

	function headers (session, key = `k-${++ix}`) {
		return {cookie: session.cookie, origin: ORIGIN, "x-csrf-token": session.csrfToken, 		"x-hub-protocol-version": "3", "idempotency-key": key};
	}

	/** Projection-shaped reads must declare their protocol version, like mutations. */
	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "3"};
	}

	async function setup () {
		const dm = await signIn(identities.dm);
		const campaign = (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(dm), payload: {name: "Actions"}})).json().campaign;
		const players = [];
		for (const who of [identities.a, identities.b]) {
			const invite = await app.inject({method: "POST", url: `/api/campaigns/${campaign.id}/invites`, headers: headers(dm), payload: {role: "player"}});
			const player = await signIn(who);
			await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(player), payload: {token: invite.json().token}});
			const character = (await app.inject({
				method: "POST",
				url: "/api/characters",
				headers: headers(player),
				payload: {
					clientImportId: `local-${who.providerSubject}`,
					campaignId: campaign.id,
					schemaVersion: 1,
					data: {
						name: who.displayName,
						xp: 100,
						hp: {current: 20, max: 20, temp: 5},
						conditions: [],
						inventory: [{id: `arrows-${who.providerSubject}`, item: {name: "Arrow", source: "PHB"}, quantity: 10}],
						currency: {gp: 10, sp: 4},
					},
				},
			})).json().character;
			players.push({session: player, character});
		}
		return {dm, campaign, a: players[0], b: players[1]};
	}

	it("applies a DM semantic operation immediately for an offline target", async () => {
		const {dm, campaign, b} = await setup();
		const commandId = crypto.randomUUID();
		const applied = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: headers(dm, commandId),
			payload: {
				commandId,
				targetCharacterId: b.character.id,
				operation: {kind: "hp.damage", version: 1, arguments: {amount: 8}},
			},
		});
		expect(applied.statusCode).toBe(201);
		expect(applied.json().operation).toMatchObject({status: "applied"});
		const truth = await app.inject({method: "GET", url: `/api/characters/${b.character.id}`, headers: readHeaders(b.session)});
		expect(truth.json().projection.character.data.hp).toEqual({current: 17, max: 20, temp: 0});
	});

	it("grants XP without changing class levels and grants stable item entries", async () => {
		const {dm, campaign, a} = await setup();
		const xp = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${a.character.id}/xp-grants`,
			headers: headers(dm, "xp-once"),
			payload: {amount: 500, reason: "Milestone"},
		});
		const xpRetry = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${a.character.id}/xp-grants`,
			headers: headers(dm, "xp-once"),
			payload: {amount: 500, reason: "Milestone"},
		});
		expect(xp.json().character.data.xp).toBe(600);
		expect(xpRetry.json().character.data.xp).toBe(600);
		expect(xp.json().character.data.classes).toBeUndefined();

		const grant = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${a.character.id}/item-grants`,
			headers: headers(dm),
			payload: {item: {name: "Potion of Healing", source: "DMG"}, quantity: 2},
		});
		expect(grant.json().entry).toEqual(expect.objectContaining({id: expect.any(String), quantity: 2}));
	});

	it("commits partial-stack and denomination transfers atomically", async () => {
		const {campaign, a, b} = await setup();
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session, "transfer-once"),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: "arrows-2", quantity: 3}], currency: {gp: 4, sp: 2}},
			},
		});
		expect(proposed.statusCode).toBe(201);
		const duplicate = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session, "transfer-other"),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: "arrows-2", quantity: 8}]},
			},
		});
		expect(duplicate.statusCode).toBe(409);
		const committed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(b.session),
			payload: {decision: "accept"},
		});
		expect(committed.json().transfer.status).toBe("committed");
		const source = (await app.inject({method: "GET", url: `/api/characters/${a.character.id}`, headers: readHeaders(a.session)})).json().projection.character;
		const target = (await app.inject({method: "GET", url: `/api/characters/${b.character.id}`, headers: readHeaders(b.session)})).json().projection.character;
		expect(source.data.inventory[0].quantity).toBe(7);
		expect(source.data.currency).toEqual({cp: 0, sp: 2, ep: 0, gp: 6, pp: 0});
		expect(target.data.inventory[0].quantity).toBe(13);
		expect(target.data.currency).toEqual({cp: 0, sp: 6, ep: 0, gp: 14, pp: 0});
	});

	it("keeps transfer authority tied to source control and destination ownership", async () => {
		const {dm, campaign, a, b} = await setup();
		const dmCharacter = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(dm),
			payload: {
				clientImportId: "local-dm-authority",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {
					name: "Guide",
					inventory: [{id: "dm-arrows", item: {name: "Arrow", source: "PHB"}, quantity: 5}],
					currency: {},
				},
			},
		})).json().character;
		const secondOwned = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(a.session),
			payload: {
				clientImportId: "local-a-second",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {name: "A Two", inventory: [], currency: {}},
			},
		})).json().character;

		const playerToPeerKey = "player-to-peer";
		const playerToPeerRequest = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session, playerToPeerKey),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: "arrows-2", quantity: 1}]},
			},
		};
		const playerToPeer = await app.inject(playerToPeerRequest);
		expect(playerToPeer.statusCode).toBe(201);
		expect(playerToPeer.json().transfer).toMatchObject({
			actorAccountId: a.session.account.id,
			actorCommandId: playerToPeerKey,
			sourceKind: "character",
			sourceId: a.character.id,
			targetKind: "character",
			status: "reserved",
		});
		expect(playerToPeer.json().transfer).not.toHaveProperty("targetId");
		expect((await app.inject(playerToPeerRequest)).json()).toEqual(playerToPeer.json());
		const sourceTransferView = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: readHeaders(a.session),
		})).json().transfers.find(transfer => transfer.id === playerToPeer.json().transfer.id);
		expect(sourceTransferView).toMatchObject({
			actorAccountId: a.session.account.id,
			actorCommandId: playerToPeerKey,
			sourceKind: "character",
			sourceId: a.character.id,
			targetKind: "character",
		});
		expect(sourceTransferView).not.toHaveProperty("targetId");
		const targetTransferView = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: readHeaders(b.session),
		})).json().transfers.find(transfer => transfer.id === playerToPeer.json().transfer.id);
		expect(targetTransferView).toMatchObject({
			actorAccountId: null,
			sourceKind: "character",
			targetKind: "character",
			targetId: b.character.id,
		});
		expect(targetTransferView).not.toHaveProperty("sourceId");
		expect(targetTransferView).not.toHaveProperty("actorCommandId");
		const dmTransferView = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: readHeaders(dm),
		})).json().transfers.find(transfer => transfer.id === playerToPeer.json().transfer.id);
		expect(dmTransferView).not.toHaveProperty("actorCommandId");
		const actorCannotSelfAcceptPeer = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${playerToPeer.json().transfer.id}/resolve`,
			headers: headers(a.session),
			payload: {decision: "accept"},
		});
		expect(actorCannotSelfAcceptPeer.statusCode).toBe(403);
		expect(actorCannotSelfAcceptPeer.json().error).toBe("FORBIDDEN");
		const acceptPeerKey = "accept-player-to-peer";
		const acceptPeerRequest = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${playerToPeer.json().transfer.id}/resolve`,
			headers: headers(b.session, acceptPeerKey),
			payload: {decision: "accept"},
		};
		const acceptedPeer = await app.inject(acceptPeerRequest);
		expect(acceptedPeer.json().transfer).toMatchObject({
			actorAccountId: null,
			sourceKind: "character",
			targetKind: "character",
			targetId: b.character.id,
			status: "committed",
		});
		expect(acceptedPeer.json().transfer).not.toHaveProperty("sourceId");
		expect(acceptedPeer.json().transfer).not.toHaveProperty("actorCommandId");
		expect((await app.inject(acceptPeerRequest)).json()).toEqual(acceptedPeer.json());
		const acceptedSourceView = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: readHeaders(a.session),
		})).json().transfers.find(transfer => transfer.id === playerToPeer.json().transfer.id);
		expect(acceptedSourceView.actorCommandId).toBe(playerToPeerKey);

		const playerToOwnKey = "player-direct-own";
		const playerToOwnRequest = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session, playerToOwnKey),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: secondOwned.id,
				payload: {items: [{entryId: "arrows-2", quantity: 1}]},
			},
		};
		const playerToOwn = await app.inject(playerToOwnRequest);
		expect(playerToOwn.json().transfer.status).toBe("committed");
		expect(playerToOwn.json().transfer.actorCommandId).toBe(playerToOwnKey);
		expect((await app.inject(playerToOwnRequest)).json()).toEqual(playerToOwn.json());
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${playerToOwn.json().transfer.id}/resolve`,
			headers: headers(a.session),
			payload: {decision: "reject"},
		})).statusCode).toBe(404);

		const playerToDm = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: dmCharacter.id,
				payload: {items: [{entryId: "arrows-2", quantity: 1}]},
			},
		});
		expect(playerToDm.json().transfer.status).toBe("reserved");
		const acceptPlayerToDmKey = "accept-player-to-dm";
		const acceptPlayerToDmRequest = {
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${playerToDm.json().transfer.id}/resolve`,
			headers: headers(dm, acceptPlayerToDmKey),
			payload: {decision: "accept"},
		};
		const acceptedPlayerToDm = await app.inject(acceptPlayerToDmRequest);
		expect(acceptedPlayerToDm.json().transfer).toMatchObject({
			actorAccountId: a.session.account.id,
			sourceId: a.character.id,
			targetId: dmCharacter.id,
			status: "committed",
		});
		expect(acceptedPlayerToDm.json().transfer).not.toHaveProperty("actorCommandId");
		expect((await app.inject(acceptPlayerToDmRequest)).json()).toEqual(acceptedPlayerToDm.json());

		const dmToPlayerKey = "dm-direct-player";
		const dmToPlayer = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(dm, dmToPlayerKey),
			payload: {
				sourceKind: "character",
				sourceId: dmCharacter.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: "dm-arrows", quantity: 1}]},
			},
		});
		expect(dmToPlayer.json().transfer.status).toBe("committed");
		expect(dmToPlayer.json().transfer.actorCommandId).toBe(dmToPlayerKey);
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(dm, dmToPlayerKey),
			payload: {
				sourceKind: "character",
				sourceId: dmCharacter.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: "dm-arrows", quantity: 1}]},
			},
		})).json()).toEqual(dmToPlayer.json());
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${dmToPlayer.json().transfer.id}/resolve`,
			headers: headers(b.session),
			payload: {decision: "reject"},
		})).statusCode).toBe(404);
		const directTarget = (await app.inject({
			method: "GET",
			url: `/api/characters/${b.character.id}`,
			headers: readHeaders(b.session),
		})).json().projection.character;
		expect(directTarget.data.inventory.find(entry => entry.item.name === "Arrow").quantity).toBe(12);

		const aMembership = await store.pGetMembership({accountId: a.session.account.id, campaignId: campaign.id});
		await store.pChangeMemberRole({
			accountId: dm.account.id,
			campaignId: campaign.id,
			membershipId: aMembership.id,
			role: "spectator",
			idempotencyKey: "downgrade-a-after-transfer",
		});
		expect((await app.inject(playerToOwnRequest)).json()).toEqual(playerToOwn.json());

		const bMembership = await store.pGetMembership({accountId: b.session.account.id, campaignId: campaign.id});
		await store.pChangeMemberRole({
			accountId: dm.account.id,
			campaignId: campaign.id,
			membershipId: bMembership.id,
			role: "spectator",
			idempotencyKey: "downgrade-b-after-transfer",
		});
		expect((await app.inject(acceptPeerRequest)).json()).toEqual(acceptedPeer.json());
	});

	it("rechecks Memory direct-transfer receipts and participants after policy loading", async () => {
		const {dm, campaign, a, b} = await setup();
		const source = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(dm),
			payload: {
				clientImportId: "direct-race-source",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {
					name: "Direct race source",
					inventory: [{
						id: "direct-race-token",
						item: {name: "Direct Race Token", source: "PHB"},
						quantity: 1,
					}],
					currency: {},
				},
			},
		})).json().character;
		const originalGetEnforcement = store._pGetCampaignContentEnforcement.bind(store);
		let policyReads = 0;
		let resolvePolicyReadsStarted;
		const policyReadsStarted = new Promise(resolve => { resolvePolicyReadsStarted = resolve; });
		let releasePolicyReads;
		const policyGate = new Promise(resolve => { releasePolicyReads = resolve; });
		store._pGetCampaignContentEnforcement = async campaignId => {
			const out = await originalGetEnforcement(campaignId);
			policyReads++;
			if (policyReads === 2) resolvePolicyReadsStarted();
			await policyGate;
			return out;
		};
		const key = "direct-race-same-key";
		const propose = targetId => app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(dm, key),
			payload: {
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId,
				payload: {items: [{entryId: "direct-race-token", quantity: 1}]},
			},
		});
		const first = propose(a.character.id);
		const second = propose(b.character.id);
		await policyReadsStarted;
		releasePolicyReads();
		const responses = await Promise.all([first, second]);

		expect(responses.map(response => response.statusCode).sort()).toEqual([201, 409]);
		expect(responses.find(response => response.statusCode === 409).json().error).toBe("IDEMPOTENCY_KEY_REUSED");
		const targetCharacters = await Promise.all([a, b].map(({session, character}) => app.inject({
			method: "GET",
			url: `/api/characters/${character.id}`,
			headers: readHeaders(session),
		})));
		const receivedQuantity = targetCharacters
			.map(response => response.json().projection.character.data.inventory)
			.flat()
			.filter(entry => entry.item?.name === "Direct Race Token")
			.reduce((total, entry) => total + entry.quantity, 0);
		expect(receivedQuantity).toBe(1);
		expect((await app.inject({
			method: "GET",
			url: `/api/characters/${source.id}`,
			headers: readHeaders(dm),
		})).json().projection.character.data.inventory).toEqual([]);
	});

	it("lets a player request stash items without reserving them before DM approval", async () => {
		const {dm, campaign, a, b} = await setup();
		const party = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/party-inventory`,
			headers: readHeaders(dm),
		})).json().partyInventory;
		const deposit = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "party_inventory",
				targetId: party.id,
				payload: {items: [{entryId: "arrows-2", quantity: 4}]},
			},
		});
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${deposit.json().transfer.id}/resolve`,
			headers: headers(dm),
			payload: {decision: "accept"},
		});
		const seeded = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/party-inventory`,
			headers: readHeaders(a.session),
		})).json().partyInventory;
		const stashEntry = seeded.inventory[0];

		const requested = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "party_inventory",
				sourceId: seeded.id,
				targetKind: "character",
				targetId: a.character.id,
				payload: {items: [{entryId: stashEntry.id, quantity: 1}]},
			},
		});
		expect(requested.statusCode).toBe(201);
		expect(requested.json().transfer).toMatchObject({
			status: "proposed",
			sourceKind: "party_inventory",
			targetKind: "character",
			targetId: a.character.id,
			payload: {
				request: {items: [{entryId: stashEntry.id, quantity: 1}]},
				preview: {
					items: [expect.objectContaining({
						item: {name: "Arrow", source: "PHB"},
						quantity: 1,
					})],
				},
			},
		});
		expect((await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/party-inventory`,
			headers: readHeaders(a.session),
		})).json().partyInventory.inventory[0].quantity).toBe(4);

		const playerCannotApproveOwnRequest = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requested.json().transfer.id}/resolve`,
			headers: headers(a.session),
			payload: {decision: "accept"},
		});
		expect(playerCannotApproveOwnRequest.statusCode).toBe(403);
		expect(playerCannotApproveOwnRequest.json().error).toBe("FORBIDDEN");

		const approvalKey = "approve-player-stash-request";
		const approved = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requested.json().transfer.id}/resolve`,
			headers: headers(dm, approvalKey),
			payload: {decision: "accept"},
		});
		expect(approved.statusCode).toBe(200);
		expect(approved.json().transfer.status).toBe("committed");
		const approvalReplay = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requested.json().transfer.id}/resolve`,
			headers: headers(dm, approvalKey),
			payload: {decision: "accept"},
		});
		expect(approvalReplay.statusCode).toBe(200);
		expect(approvalReplay.json()).toEqual(approved.json());
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requested.json().transfer.id}/resolve`,
			headers: headers(dm, "approve-player-stash-request-new-key"),
			payload: {decision: "accept"},
		})).statusCode).toBe(404);

		const requestA = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "party_inventory",
				sourceId: seeded.id,
				targetKind: "character",
				targetId: a.character.id,
				payload: {items: [{entryId: stashEntry.id, quantity: 3}]},
			},
		});
		const requestB = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(b.session),
			payload: {
				sourceKind: "party_inventory",
				sourceId: seeded.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: stashEntry.id, quantity: 3}]},
			},
		});
		expect(requestA.json().transfer.status).toBe("proposed");
		expect(requestB.json().transfer.status).toBe("proposed");
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requestA.json().transfer.id}/resolve`,
			headers: headers(dm),
			payload: {decision: "accept"},
		})).json().transfer.status).toBe("committed");
		const staleApproval = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${requestB.json().transfer.id}/resolve`,
			headers: headers(dm),
			payload: {decision: "accept"},
		});
		expect(staleApproval.statusCode).toBe(409);
		expect(staleApproval.json().error).toBe("TRANSFER_INSUFFICIENT");
	});

	it("returns escrow to the source when a transfer is rejected", async () => {
		const {campaign, a, b} = await setup();
		const item = a.character.data.inventory[0];
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: item.id, quantity: item.quantity}], currency: {gp: 3}},
			},
		});
		const rejectionKey = "reject-transfer-retry";
		const rejected = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(b.session, rejectionKey),
			payload: {decision: "reject"},
		});
		const rejectionReplay = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(b.session, rejectionKey),
			payload: {decision: "reject"},
		});
		expect(rejectionReplay.json()).toEqual(rejected.json());
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(b.session, "reject-transfer-new-key"),
			payload: {decision: "reject"},
		})).statusCode).toBe(404);
		const source = (await app.inject({method: "GET", url: `/api/characters/${a.character.id}`, headers: readHeaders(a.session)})).json().projection.character;
		expect(source.data.currency.gp).toBe(10);
		expect(source.data.inventory).toContainEqual(expect.objectContaining({id: item.id, quantity: item.quantity}));
	});

	it("rejects whole-item reservations that would bypass character inventory cleanup", async () => {
		const {campaign, a, b} = await setup();
		const itemId = a.character.data.inventory[0].id;
		const lease = (await app.inject({
			method: "POST",
			url: `/api/characters/${a.character.id}/lease`,
			headers: headers(a.session),
			payload: {deviceId: "linked-item-test"},
		})).json().lease;
		await app.inject({
			method: "PATCH",
			url: `/api/characters/${a.character.id}`,
			headers: headers(a.session),
			payload: {
				baseRevision: a.character.revision,
				leaseEpoch: lease.epoch,
				patches: [{op: "add", path: "/selectedAmmo", value: {bow: itemId}}],
			},
		});
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(a.session),
			payload: {
				sourceKind: "character",
				sourceId: a.character.id,
				targetKind: "character",
				targetId: b.character.id,
				payload: {items: [{entryId: itemId, quantity: 10}]},
			},
		});
		expect(proposed.statusCode).toBe(409);
		expect(proposed.json().error).toBe("TRANSFER_ITEM_LINKED");
	});

	it("enforces the canonical byte ceiling after grants and transfer commits", async () => {
		const {dm, campaign, a, b} = await setup();
		const target = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(a.session),
			payload: {
				clientImportId: "near-limit-target",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {name: "Near Limit", notes: "x".repeat(1_499_700), inventory: [], currency: {}},
			},
		})).json().character;
		const largeItem = {
			name: `Large Journal ${"y".repeat(186)}`,
			source: "PHB",
			rarity: "z".repeat(80),
			typeCode: "x".repeat(80),
		};

		const oversizedGrant = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${target.id}/item-grants`,
			headers: headers(dm),
			payload: {item: largeItem, quantity: 1},
		});
		expect(oversizedGrant.statusCode).toBe(413);
		expect(oversizedGrant.json().error).toBe("CHARACTER_TOO_LARGE");

		const sourceGrant = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${b.character.id}/item-grants`,
			headers: headers(dm),
			payload: {item: largeItem, quantity: 1},
		});
		const entry = sourceGrant.json().entry;
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(b.session),
			payload: {
				sourceKind: "character",
				sourceId: b.character.id,
				targetKind: "character",
				targetId: target.id,
				payload: {items: [{entryId: entry.id, quantity: 1}]},
			},
		});
		const oversizedCommit = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(a.session),
			payload: {decision: "accept"},
		});
		expect(oversizedCommit.statusCode).toBe(413);
		expect(oversizedCommit.json().error).toBe("CHARACTER_TOO_LARGE");

		const rejected = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(a.session),
			payload: {decision: "reject"},
		});
		expect(rejected.statusCode).toBe(200);
		const restoredSource = (await app.inject({
			method: "GET",
			url: `/api/characters/${b.character.id}`,
			headers: readHeaders(b.session),
		})).json().projection.character;
		expect(restoredSource.data.inventory).toContainEqual(expect.objectContaining({id: entry.id}));
		// Builds and re-canonicalises documents against the 1.5 MB ceiling, so it is CPU-bound
		// rather than slow: ~1.1s alone, but well past Jest's 5s default when the full suite
		// runs it alongside 600+ other projects.
	}, 30_000);
});
