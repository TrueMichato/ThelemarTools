import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {computePeerProfile, getDefaultProjectionPolicy} from "../../../server/src/character-projection.js";
import {HubMetrics} from "../../../server/src/observability.js";

const ORIGIN = "https://tools.example";
const CANARY = "CANARY-DO-NOT-SHARE";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "1", login: "dm", displayName: "DM"},
	owner: {provider: "github", providerSubject: "2", login: "owner", displayName: "Owner"},
	peerA: {provider: "github", providerSubject: "3", login: "peer-a", displayName: "Peer A"},
	peerB: {provider: "github", providerSubject: "4", login: "peer-b", displayName: "Peer B"},
};

const CHARACTER_DATA = {
	name: "Mira Vale",
	race: {name: "Elf"},
	classes: [{name: "Ranger", level: 5}],
	abilities: {str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 12},
	saveProficiencies: ["dex"],
	skillProficiencies: {stealth: 1},
	ac: {base: 15},
	hp: {current: 30, max: 44},
	speed: {walk: 30},
	conditions: ["Poisoned"],
	notes: {backstory: CANARY},
	inventory: [{id: "secret-item", name: CANARY, quantity: 1, weight: 2}],
	currency: {gp: 40},
};

function cookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("projection privacy canaries", () => {
	let app;
	let store;
	let identity;
	let ix;

	beforeEach(async () => {
		identity = IDENTITIES.dm;
		ix = 0;
		store = new MemoryHubStore();
		app = await createHubApp({
			store,
			oauthProvider: {getAuthorizationUrl: ({state}) => `https://x/?state=${state}`, pExchangeCode: async () => identity},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: Object.values(IDENTITIES).map(it => `github:${it.providerSubject}`),
			},
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
		return {cookie: session.cookie, origin: ORIGIN, "x-csrf-token": session.csrfToken, "x-hub-protocol-version": "2", "idempotency-key": key};
	}

	/** Projection-shaped reads must declare their protocol version, like mutations. */
	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "2"};
	}

	async function setup () {
		const dm = await signIn(IDENTITIES.dm);
		const campaign = (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(dm), payload: {name: "Canary"}})).json().campaign;
		const invite = (await app.inject({method: "POST", url: `/api/campaigns/${campaign.id}/invites`, headers: headers(dm), payload: {role: "player", maxUses: 5}})).json();
		const sessions = {};
		for (const key of ["owner", "peerA", "peerB"]) {
			sessions[key] = await signIn(IDENTITIES[key]);
			await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(sessions[key]), payload: {token: invite.token}});
		}
		const character = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(sessions.owner),
			payload: {clientImportId: "canary", campaignId: campaign.id, schemaVersion: 1, data: CHARACTER_DATA},
		})).json().character;
		return {dm, ...sessions, campaign, character};
	}

	it("keeps hidden truth out of every peer-facing HTTP surface", async () => {
		const {peerA, campaign, character} = await setup();
		const urls = [
			`/api/characters/${character.id}`,
			`/api/campaigns/${campaign.id}/snapshot`,
			`/api/campaigns/${campaign.id}/character-projections`,
			`/api/campaigns/${campaign.id}/events`,
			`/api/campaigns/${campaign.id}/party-inventory`,
			`/api/campaigns/${campaign.id}/transfers`,
			`/api/campaigns/${campaign.id}/actions`,
			"/api/characters",
		];

		for (const url of urls) {
			const response = await app.inject({method: "GET", url, headers: readHeaders(peerA)});
			expect({url, hasCanary: response.body.includes(CANARY)}).toEqual({url, hasCanary: false});
			expect({url, hasItemId: response.body.includes("secret-item")}).toEqual({url, hasItemId: false});
		}

		// `ownerAccountId` is campaign metadata, but it is never a character projection
		// field: the roster carries a membership id instead.
		const snapshot = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/snapshot`, headers: readHeaders(peerA)})).json().snapshot;
		expect(JSON.stringify(snapshot.characters)).not.toContain("ownerAccountId");
		expect(JSON.stringify(snapshot.roster)).not.toContain("ownerAccountId");
		expect(snapshot.characters.every(entry => entry.kind === "peer_profile")).toBe(true);
	});

	it("refuses a peer the owner's raw policy and gives them the peer profile instead", async () => {
		const {owner, peerA, character} = await setup();
		const denied = await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(peerA)});
		expect(denied.statusCode).toBe(404);
		expect(denied.json().error).toBe("PROJECTION_POLICY_NOT_AVAILABLE");
		expect(denied.body).not.toContain(CANARY);

		// A character that does not exist is indistinguishable from one owned by somebody
		// else, so this endpoint cannot confirm which ids are real.
		const missing = await app.inject({
			method: "GET",
			url: `/api/characters/00000000-0000-4000-8000-000000000000/projection-policy`,
			headers: readHeaders(peerA),
		});
		expect({status: missing.statusCode, body: missing.json()}).toEqual({status: denied.statusCode, body: denied.json()});

		const read = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(peerA)});
		expect(read.json().projection.kind).toBe("peer_profile");

		const ownerRead = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(owner)});
		expect(ownerRead.json().projection.kind).toBe("owner_truth");
		expect(ownerRead.json().projection.character.data.notes.backstory).toBe(CANARY);
	});

	it("gives two peers byte-identical profiles and the DM an identical preview", async () => {
		const {dm, peerA, peerB, character} = await setup();
		const [a, b, dmRead] = await Promise.all([
			app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(peerA)}),
			app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(peerB)}),
			app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(dm)}),
		]);

		expect(a.body).toBe(b.body);
		expect(dmRead.json().projection.peerPreview).toEqual(a.json().projection);
	});

	it("matches the owner's management preview to a real peer fetch", async () => {
		const {owner, peerA, character} = await setup();
		const [policy, peer] = await Promise.all([
			app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)}),
			app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(peerA)}),
		]);

		expect(policy.json().preview).toEqual(peer.json().projection);
		expect(policy.json().policy).toEqual(getDefaultProjectionPolicy());
	});

	it("emits metadata-only invalidations for every mutation that can change a shared field", async () => {
		const {dm, owner, campaign, character} = await setup();
		const lease = (await app.inject({method: "POST", url: `/api/characters/${character.id}/lease`, headers: headers(owner), payload: {}})).json().lease;
		await app.inject({
			method: "PATCH",
			url: `/api/characters/${character.id}`,
			headers: headers(owner),
			payload: {baseRevision: character.revision, leaseEpoch: lease.epoch, patches: [{op: "replace", path: "/hp/current", value: 12}]},
		});
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${character.id}/item-grants`,
			headers: headers(dm),
			payload: {item: {name: "Torch"}, quantity: 1},
		});

		const events = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/events`, headers: readHeaders(dm)})).json().events;
		const invalidations = events.filter(event => event.type === "character.projection.invalidated");

		expect(invalidations.length).toBeGreaterThanOrEqual(2);
		for (const event of invalidations) {
			// The payload may carry the projection revision and nothing else.
			expect(Object.keys(event.payload)).toEqual(["projectionRevision"]);
		}
		expect(events.some(event => event.type === "character.projection.updated")).toBe(false);
		expect(JSON.stringify(invalidations)).not.toContain(CANARY);
	});

	it("does not invalidate for a mutation that cannot change a catalog field", async () => {
		const {dm, campaign, character} = await setup();
		const before = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/events`, headers: readHeaders(dm)})).json().events
			.filter(event => event.type === "character.projection.invalidated").length;
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/characters/${character.id}/xp-grants`,
			headers: headers(dm),
			payload: {amount: 500},
		});
		const after = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/events`, headers: readHeaders(dm)})).json().events
			.filter(event => event.type === "character.projection.invalidated").length;

		// `xp` is not a catalog field, so granting it announces nothing to peers.
		expect(after).toBe(before);
	});

	it("narrows a live projection rather than leaving a broader one cached", async () => {
		const {owner, peerA, character} = await setup();
		const policy = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		const updated = await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: policy.projectionRevision, policy: {version: 1, preset: "minimal", overrides: {hp: {mode: "replace", value: {state: "steady"}}}}},
		});
		expect(updated.statusCode).toBe(200);

		const peer = (await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(peerA)})).json().projection;
		expect(peer.data.hp).toEqual({state: "steady"});
		expect(peer.data.abilities).toBeUndefined();
		expect(peer.data.conditions).toBeUndefined();
		expect(peer.projectionRevision).toBe(policy.projectionRevision + 1);
	});

	it("rejects a stale policy write without changing the stored policy or revision", async () => {
		const {owner, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "open", overrides: {}}},
		});
		const stale = await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "private", overrides: {}}},
		});

		expect(stale.statusCode).toBe(409);
		expect(stale.json().error).toBe("PROJECTION_POLICY_CONFLICT");
		// The conflict reports the current safe state, never truth or the losing write.
		expect(stale.json().details.policy.preset).toBe("open");
		expect(stale.body).not.toContain(CANARY);
		const after = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		expect(after.policy.preset).toBe("open");
		expect(after.projectionRevision).toBe(base.projectionRevision + 1);
	});

	it("replays an idempotent policy write without incrementing twice", async () => {
		const {owner, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		const request = {
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner, "policy-stable"),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "minimal", overrides: {}}},
		};
		const first = await app.inject(request);
		const retry = await app.inject(request);

		expect(first.statusCode).toBe(200);
		expect(retry.statusCode).toBe(200);
		expect(retry.json()).toEqual(first.json());
		expect(first.json().projectionRevision).toBe(base.projectionRevision + 1);
	});

	it("rejects an invalid policy without disturbing the last valid one", async () => {
		const {owner, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		const rejected = await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "table", overrides: {hp: {mode: "replace", value: {state: "<b>x</b>"}}}}},
		});

		expect(rejected.statusCode).toBe(422);
		expect(rejected.json().error).toBe("PROJECTION_POLICY_INVALID");
		const after = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		expect(after).toEqual(base);
	});

	it("stops peer targeting and roster attribution when identity is private", async () => {
		const {owner, peerA, campaign, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "private", overrides: {}}},
		});

		const result = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(peerA)})).json();
		expect(result.roster.some(entry => entry.characterId === character.id)).toBe(false);
		expect(result.projections.find(entry => entry.id === character.id).data).toEqual({});

		// The owner still sees their own roster entry.
		const ownerResult = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(owner)})).json();
		expect(ownerResult.roster.some(entry => entry.characterId === character.id)).toBe(true);
	});

	it("carries a membership id rather than an account id in roster metadata", async () => {
		const {peerA, campaign, character} = await setup();
		const result = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(peerA)})).json();
		const entry = result.roster.find(it => it.characterId === character.id);

		expect(Object.keys(entry).sort()).toEqual(["characterId", "ownerMembershipId"]);
		expect(JSON.stringify(result.roster)).not.toContain("ownerAccountId");
	});

	it("isolates a corrupt policy to its own character in a batch", async () => {
		const {owner, peerA, peerB, campaign, character} = await setup();
		const second = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(peerB),
			payload: {clientImportId: "canary-2", campaignId: campaign.id, schemaVersion: 1, data: {...CHARACTER_DATA, name: "Second Vale"}},
		})).json().character;
		// Corrupt one character's persisted policy directly, as a bad migration might.
		store._characters.get(character.id).projectionPolicy = {version: 1, preset: "everything"};

		const result = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(peerA)})).json();
		const broken = result.projections.find(it => it.id === character.id);
		const healthy = result.projections.find(it => it.id === second.id);

		expect(broken.data).toEqual({});
		// One bad row neither aborts the batch nor makes the others unusable.
		expect(healthy.data.identity).toEqual({name: "Second Vale"});
		expect(JSON.stringify(result)).not.toContain(CANARY);
		// The owner is told why, without the failure leaking to peers.
		const management = await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)});
		expect(management.json().error).toBe("PROJECTION_POLICY_INVALID");
		expect(broken.error).toBeUndefined();
	});

	it("resolves roster owner attribution from every projection source", async () => {
		const {peerA, campaign, character} = await setup();
		const snapshot = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/snapshot`, headers: readHeaders(peerA)})).json().snapshot;
		const batch = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(peerA)})).json();

		// Both projection sources must agree; a source that silently omits the membership
		// id would drop owner attribution from the roster without failing anything else.
		const fromSnapshot = snapshot.roster.find(entry => entry.characterId === character.id);
		const fromBatch = batch.roster.find(entry => entry.characterId === character.id);
		expect(fromSnapshot).toEqual(fromBatch);
		expect(fromSnapshot.ownerMembershipId).toEqual(expect.any(String));

		const members = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/members`, headers: readHeaders(peerA)})).json();
		const list = members.members || members;
		expect(list.some(member => member.id === fromSnapshot.ownerMembershipId)).toBe(true);
	});

	it("refuses peer actions and transfers targeting a private character", async () => {
		const {owner, peerA, campaign, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "private", overrides: {}}},
		});

		// Targeting is authorized on the server, not merely filtered in the browser.
		const action = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: headers(peerA),
			payload: {targetCharacterId: character.id, effect: {type: "damage", amount: 3}},
		});
		expect(action.statusCode).toBe(404);
		// Non-enumerating: identical to a character that does not exist.
		const missing = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: headers(peerA),
			payload: {targetCharacterId: "00000000-0000-4000-8000-000000000000", effect: {type: "damage", amount: 3}},
		});
		expect(action.json()).toEqual(missing.json());

		const peerCharacter = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(peerA),
			payload: {clientImportId: "peer-own", campaignId: campaign.id, schemaVersion: 1, data: {...CHARACTER_DATA, name: "Peer Own", inventory: [{id: "gift", name: "Gift", quantity: 1}]}},
		})).json().character;
		const transfer = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/transfers`,
			headers: headers(peerA),
			payload: {
				sourceKind: "character",
				sourceId: peerCharacter.id,
				targetKind: "character",
				targetId: character.id,
				payload: {entries: [{id: "gift", quantity: 1}]},
			},
		});
		expect(transfer.statusCode).toBe(404);
	});

	it("still lets the DM and the owner target a private character", async () => {
		const {dm, owner, campaign, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "private", overrides: {}}},
		});

		const dmAction = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: headers(dm),
			payload: {targetCharacterId: character.id, effect: {type: "damage", amount: 1}},
		});
		expect(dmAction.statusCode).toBe(201);
	});

	it("never returns another owner's sharing policy on a character response", async () => {
		const {dm, owner, campaign, character} = await setup();
		const responses = [
			await app.inject({method: "GET", url: `/api/characters?campaignId=${campaign.id}`, headers: readHeaders(dm)}),
			await app.inject({
				method: "POST",
				url: `/api/campaigns/${campaign.id}/characters/${character.id}/item-grants`,
				headers: headers(dm),
				payload: {item: {name: "Torch"}, quantity: 1},
			}),
			await app.inject({
				method: "POST",
				url: `/api/campaigns/${campaign.id}/characters/${character.id}/xp-grants`,
				headers: headers(dm),
				payload: {amount: 10},
			}),
		];
		for (const [index, response] of responses.entries()) {
			expect({index, leaks: response.body.includes("projectionPolicy")}).toEqual({index, leaks: false});
		}

		// The owner's own responses are equally free of it: policy is read from the
		// dedicated management endpoint, which is the only sanctioned source.
		const ownList = await app.inject({method: "GET", url: "/api/characters", headers: readHeaders(owner)});
		expect(ownList.body).not.toContain("projectionPolicy");
	});

	it("gates the campaign-scoped character list on the current protocol", async () => {
		const {dm, campaign} = await setup();
		const stale = await app.inject({
			method: "GET",
			url: `/api/characters?campaignId=${campaign.id}`,
			headers: {cookie: dm.cookie, "x-hub-protocol-version": "1"},
		});
		expect(stale.statusCode).toBe(426);
	});

	it("keeps projection truth out of logs and metrics", () => {
		const metrics = new HubMetrics({fnNow: () => 0});
		metrics.observeRequest({method: "GET", route: "/api/characters/:characterId", statusCode: 200, durationMs: 5});
		const output = metrics.toPrometheus({});

		expect(output).not.toContain(CANARY);
		// Route templates are bounded: no character id becomes a metric label.
		expect(output).toContain("/api/characters/:characterId");
	});

	it("agrees between the memory and PostgreSQL stores on the same character", async () => {
		const character = {
			id: "parity-character",
			ownerAccountId: "owner",
			campaignId: "parity-campaign",
			status: "active",
			revision: 4,
			projectionRevision: 2,
			projectionPolicy: getDefaultProjectionPolicy(),
			data: CHARACTER_DATA,
		};
		// Both stores project through the same pure module, so their peer output for one
		// character document is identical by construction; this asserts it stays so.
		const memoryStore = new MemoryHubStore();
		memoryStore._characters.set(character.id, structuredClone(character));
		memoryStore._campaigns.set("parity-campaign", {id: "parity-campaign", status: "active", ownerAccountId: "dm"});
		memoryStore._memberships.set("parity-campaign::peer", {id: "m-peer", campaignId: "parity-campaign", accountId: "peer", role: "player", status: "active"});

		const fromMemory = await memoryStore.pGetCharacter({accountId: "peer", characterId: character.id});
		const fromPostgres = new PostgresHubStore({pool: {query: () => {}, connect: () => {}, on: () => {}}})
			._projectOne({accountId: "peer", membership: {role: "player", accountId: "peer"}, character: structuredClone(character)});

		expect(JSON.stringify(fromMemory)).toBe(JSON.stringify(fromPostgres));
		expect(JSON.stringify(fromMemory)).toBe(JSON.stringify(computePeerProfile({character})));
	});
});
