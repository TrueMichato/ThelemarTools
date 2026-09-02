import fs from "node:fs";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const ORIGIN = "https://tools.example";
const CANARY = "CANARY-DO-NOT-SHARE";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "1", login: "dm", displayName: "DM"},
	coDm: {provider: "github", providerSubject: "2", login: "co-dm", displayName: "Co DM"},
	owner: {provider: "github", providerSubject: "3", login: "owner", displayName: "Owner"},
};

function cookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("projection lifecycle safety", () => {
	let app;
	let identity;
	let ix;

	beforeEach(async () => {
		identity = IDENTITIES.dm;
		ix = 0;
		app = await createHubApp({
			store: new MemoryHubStore(),
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

	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "2"};
	}

	async function setup () {
		const dm = await signIn(IDENTITIES.dm);
		const campaign = (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(dm), payload: {name: "Lifecycle"}})).json().campaign;
		const coDmInvite = (await app.inject({method: "POST", url: `/api/campaigns/${campaign.id}/invites`, headers: headers(dm), payload: {role: "co_dm"}})).json();
		const playerInvite = (await app.inject({method: "POST", url: `/api/campaigns/${campaign.id}/invites`, headers: headers(dm), payload: {role: "player"}})).json();
		const coDm = await signIn(IDENTITIES.coDm);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(coDm), payload: {token: coDmInvite.token}});
		const owner = await signIn(IDENTITIES.owner);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(owner), payload: {token: playerInvite.token}});
		const character = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(owner),
			payload: {
				clientImportId: "lifecycle",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {name: "Mira", abilities: {str: 10}, classes: [{name: "Ranger", level: 3}], notes: {backstory: CANARY}},
			},
		})).json().character;
		const members = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/members`, headers: readHeaders(dm)})).json();
		return {dm, coDm, owner, campaign, character, members};
	}

	it("narrows a demoted co-DM from truth to a peer profile on the next fetch", async () => {
		const {dm, coDm, campaign, character, members} = await setup();
		const before = (await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(coDm)})).json().projection;
		expect(before.kind).toBe("dm_truth");
		expect(before.character.data.notes.backstory).toBe(CANARY);

		const membershipId = (members.members || members).find(member => member.role === "co_dm").id;
		await app.inject({
			method: "PATCH",
			url: `/api/campaigns/${campaign.id}/members/${membershipId}`,
			headers: headers(dm),
			payload: {role: "player"},
		});

		const after = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(coDm)});
		expect(after.json().projection.kind).toBe("peer_profile");
		// A cached DM truth response cannot be reused after demotion.
		expect(after.body).not.toContain(CANARY);
	});

	it("removes a former member from projection reads entirely", async () => {
		const {dm, coDm, campaign, character, members} = await setup();
		const membershipId = (members.members || members).find(member => member.role === "co_dm").id;
		await app.inject({method: "DELETE", url: `/api/campaigns/${campaign.id}/members/${membershipId}`, headers: headers(dm)});

		for (const url of [`/api/characters/${character.id}`, `/api/campaigns/${campaign.id}/snapshot`, `/api/campaigns/${campaign.id}/character-projections`]) {
			const response = await app.inject({method: "GET", url, headers: readHeaders(coDm)});
			expect({url, status: response.statusCode}).toEqual({url, status: 404});
			expect(response.body).not.toContain(CANARY);
		}
	});

	it("drops an archived character from peer fetches and targeting", async () => {
		const {coDm, owner, campaign, character} = await setup();
		await app.inject({method: "DELETE", url: `/api/characters/${character.id}`, headers: headers(owner)});

		const result = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(coDm)})).json();
		expect(result.projections.some(entry => (entry.id || entry.character?.id) === character.id)).toBe(false);
		expect(result.roster.some(entry => entry.characterId === character.id)).toBe(false);
		// A later read cannot resurrect it.
		const read = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(coDm)});
		expect(read.statusCode).toBe(404);
	});

	it("returns the current policy on reconnect rather than a stale broader one", async () => {
		const {coDm, owner, campaign, character} = await setup();
		const base = (await app.inject({method: "GET", url: `/api/characters/${character.id}/projection-policy`, headers: readHeaders(owner)})).json();
		await app.inject({
			method: "PUT",
			url: `/api/characters/${character.id}/projection-policy`,
			headers: headers(owner),
			payload: {expectedProjectionRevision: base.projectionRevision, policy: {version: 1, preset: "private", overrides: {}}},
		});

		// Simulate a reconnecting client: the same scoped fetch is the only source.
		const first = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(coDm)})).json();
		const second = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/character-projections`, headers: readHeaders(coDm)})).json();
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		const dmView = first.projections.find(entry => entry.character?.id === character.id);
		expect(dmView.peerPreview.data).toEqual({});
	});

	it("gives a moved character no peer readers in its former campaign", async () => {
		const {dm, coDm, owner, character} = await setup();
		const other = (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(owner), payload: {name: "Elsewhere"}})).json().campaign;
		await app.inject({method: "POST", url: `/api/characters/${character.id}/move`, headers: headers(owner), payload: {campaignId: other.id}});

		const stale = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(coDm)});
		expect(stale.statusCode).toBe(404);
		expect(stale.body).not.toContain(CANARY);
		const dmStale = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(dm)});
		expect(dmStale.statusCode).toBe(404);
	});
});

describe("event privacy after account purge", () => {
	it("does not republish a purged character's suppressed rows", async () => {
		const {MemoryHubStore} = await import("../../../server/src/memory-hub-store.js");
		const store = new MemoryHubStore();
		const dm = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "purge-dm", displayName: "DM"});
		const owner = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "purge-owner", displayName: "Rowan Vale"});
		const peer = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "purge-peer", displayName: "Peer"});
		const campaign = (await store.pCreateCampaign({accountId: dm.id, name: "Purge", idempotencyKey: "c"})).campaign;
		await store.pCreateInvite({accountId: dm.id, campaignId: campaign.id, role: "player", tokenHash: "purge-token", expiresAt: new Date(Date.now() + 60_000), maxUses: 5, idempotencyKey: "i"});
		for (const account of [owner, peer]) {
			await store.pRedeemInvite({accountId: account.id, tokenHash: "purge-token", idempotencyKey: `r-${account.id}`});
		}
		const character = (await store.pCreateCharacter({
			accountId: owner.id,
			campaignId: campaign.id,
			data: {name: "Mira"},
			schemaVersion: 1,
			clientImportId: "purge-import",
			idempotencyKey: "ch",
		})).character;
		await store.pSetProjectionPolicy({accountId: owner.id, characterId: character.id, policy: {version: 1, preset: "private", overrides: {}}, expectedProjectionRevision: 1, idempotencyKey: "p"});
		await store.pLogRoll({accountId: owner.id, campaignId: campaign.id, characterId: character.id, visibility: "all_members", payload: {formula: "1d20+PURGE-SECRET", total: 12}, idempotencyKey: "roll"});

		const before = await store.pListVisibleEvents({accountId: peer.id, campaignId: campaign.id});
		expect(JSON.stringify(before)).not.toContain(character.id);
		expect(JSON.stringify(before)).not.toContain("PURGE-SECRET");

		await store.pRequestAccountDeletion({accountId: owner.id, idempotencyKey: "del", graceMs: 0});
		await new Promise(resolve => setTimeout(resolve, 5));
		await store.pPurgeDueAccounts();

		// Purge hard-deletes the character but keeps the campaign's domain events. The
		// suppression must not depend on the row still being there, or deleting an account
		// would retroactively publish everything its owner had hidden.
		const after = await store.pListVisibleEvents({accountId: peer.id, campaignId: campaign.id});
		expect(JSON.stringify(after)).not.toContain(character.id);
		expect(JSON.stringify(after)).not.toContain("PURGE-SECRET");
		expect(after.some(event => event.aggregateId === character.id)).toBe(false);

		// The DM keeps the audit trail.
		const dmAfter = await store.pListVisibleEvents({accountId: dm.id, campaignId: campaign.id});
		expect(dmAfter.some(event => event.aggregateId === character.id)).toBe(true);
	});

	it("fails closed for a missing character in the shared-event helpers", async () => {
		const {canViewSharedCharacterEvent, canViewCharacterEventActor} = await import("../../../server/src/character-projection.js");

		// A deleted row cannot demonstrate that its owner ever chose to share an identity.
		expect(canViewSharedCharacterEvent({character: null, accountId: "peer", role: "player"})).toBe(false);
		expect(canViewCharacterEventActor({character: null, accountId: "peer", role: "player", actorAccountId: "gone"})).toBe(false);
		// DMs keep the audit trail, and an actor still sees their own action.
		expect(canViewSharedCharacterEvent({character: null, accountId: "dm", role: "dm"})).toBe(true);
		expect(canViewCharacterEventActor({character: null, accountId: "me", role: "player", actorAccountId: "me"})).toBe(true);
	});

	it("resolves a missing character the same way in PostgreSQL", () => {
		const source = fs.readFileSync(new URL("../../../server/src/postgres-hub-store.js", import.meta.url), "utf8");
		// Both PostgreSQL paths pass `null` for a character the join could not resolve,
		// which is exactly the post-purge case, so they inherit the fail-closed decision.
		expect(source).toContain("character: charactersById.get(row.aggregate_id) || null");
		expect(source).toMatch(/const character = result\.rowCount[\s\S]{0,200}: null;/);
	});
});

describe("store parity guards", () => {
	it("invalidates on archived-import reactivation in both stores", () => {
		const pg = fs.readFileSync(new URL("../../../server/src/postgres-hub-store.js", import.meta.url), "utf8");
		const memory = fs.readFileSync(new URL("../../../server/src/memory-hub-store.js", import.meta.url), "utf8");
		// Reactivation replaces the document and bumps the revision, so peers must be told
		// to refetch. The memory store did this from the start; PostgreSQL must match.
		const pgReactivation = pg.slice(pg.indexOf("character.reactivated"), pg.indexOf("character.reactivated") + 600);
		expect(pgReactivation).toContain("_pAppendProjectionInvalidation");
		const memoryReactivation = memory.slice(memory.indexOf("character.reactivated"), memory.indexOf("character.reactivated") + 900);
		expect(memoryReactivation).toContain("_commitCharacterMutation");
	});

	it("joins membership in every PostgreSQL projection query that returns a roster", () => {
		const source = fs.readFileSync(new URL("../../../server/src/postgres-hub-store.js", import.meta.url), "utf8");
		const rosterCallers = ["pGetCampaignSnapshot", "pListCampaignCharacterProjections"];
		for (const caller of rosterCallers) {
			const start = source.indexOf(`async ${caller} (`);
			expect({caller, found: start > -1}).toEqual({caller, found: true});
			const body = source.slice(start, start + 2_000);
			// `_getCampaignRoster` reads `owner_membership_id`; without the join it is
			// silently undefined and owner attribution disappears from the roster.
			expect({caller, hasJoin: body.includes("owner_membership_id")}).toEqual({caller, hasJoin: true});
		}
	});
});

describe("owner character sheet safety", () => {
	const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

	it("keeps the Character Sheet off the realtime invalidation path", () => {
		const source = read("js/charactersheet/charactersheet.js");
		// An invalidation must never be able to replace an owner's unsaved local document,
		// so the sheet subscribes to no realtime channel at all.
		expect(source).not.toContain("HubRealtimeClient");
		expect(source).not.toContain("character.projection.invalidated");
		expect(source).not.toContain("requestResync");
	});

	it("keeps sharing controls out of the document write path", () => {
		const sharing = read("js/charactersheet/charactersheet-sharing.js");
		// Sharing writes policy only; it never patches, leases, or replaces the character.
		for (const forbidden of ["pPatchCharacter", "pAcquireCharacterLease", "setStateFrom", "loadFromJson"]) {
			expect({forbidden, present: sharing.includes(forbidden)}).toEqual({forbidden, present: false});
		}
		expect(sharing).toContain("pSetProjectionPolicy");
	});

	it("preserves the accepted-base rebase on save", () => {
		const repository = read("js/hub/hub-character-repository.js");
		expect(repository).toContain("rebaseJsonChanges({base: accepted.data, local: snapshot, remote: canonical.data})");
	});

	it("refuses to hydrate the sheet from a non-owner projection", () => {
		const client = read("js/hub/hub-api-client.js");
		expect(client).toContain("if (!isCanonicalProjection(projection))");
		expect(client).toContain("CHARACTER_PROJECTION_SCOPED");
	});
});
