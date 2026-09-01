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
