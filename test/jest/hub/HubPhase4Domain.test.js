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
	let identity;
	let ix;

	beforeEach(async () => {
		identity = identities.dm;
		ix = 0;
		app = await createHubApp({
			store: new MemoryHubStore(),
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
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers/${proposed.json().transfer.id}/resolve`,
			headers: headers(b.session),
			payload: {decision: "reject"},
		});
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
				data: {name: "Near Limit", notes: "x".repeat(1_490_000), inventory: [], currency: {}},
			},
		})).json().character;
		const largeItem = {name: "Large Journal", source: "HB", entries: ["y".repeat(20_000)]};

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
