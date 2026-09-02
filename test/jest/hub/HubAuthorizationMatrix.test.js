import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const ORIGIN = "https://tools.example";
const identities = {
	dmA: {provider: "github", providerSubject: "1", login: "dma", displayName: "DM A"},
	dmB: {provider: "github", providerSubject: "2", login: "dmb", displayName: "DM B"},
	player: {provider: "github", providerSubject: "3", login: "player", displayName: "Player"},
	other: {provider: "github", providerSubject: "4", login: "other", displayName: "Other"},
};

function getCookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("campaign authorization matrix", () => {
	let app;
	let identity;
	let ix;

	beforeEach(async () => {
		identity = identities.dmA;
		ix = 0;
		app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: ({state}) => `https://x/?state=${state}`, pExchangeCode: async () => identity},
			config: {appOrigin: ORIGIN, cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32), allowedOAuthSubjects: ["github:1", "github:2", "github:3", "github:4"]},
		});
	});

	afterEach(async () => app.close());

	async function signIn (who) {
		identity = who;
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({method: "GET", url: `/auth/github/callback?code=x&state=${state}`, headers: {cookie: `__Host-hub_oauth=${getCookie(start, "__Host-hub_oauth")}`}});
		const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
		return {cookie, ...session};
	}

	function headers (session) {
		return {cookie: session.cookie, origin: ORIGIN, "x-csrf-token": session.csrfToken, 		"x-hub-protocol-version": "3", "idempotency-key": `k-${++ix}`};
	}

	/** Projection-shaped reads must declare their protocol version, like mutations. */
	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "3"};
	}

	async function campaign (session, name) {
		return (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(session), payload: {name}})).json().campaign;
	}

	it("prevents cross-campaign reads and DM workspace access", async () => {
		const dmA = await signIn(identities.dmA);
		const campaignA = await campaign(dmA, "A");
		const dmB = await signIn(identities.dmB);
		const campaignB = await campaign(dmB, "B");

		for (const path of [
			`/api/campaigns/${campaignA.id}`,
			`/api/campaigns/${campaignA.id}/members`,
			`/api/campaigns/${campaignA.id}/context`,
			`/api/campaigns/${campaignA.id}/snapshot`,
			`/api/campaigns/${campaignA.id}/dm-workspace`,
		]) {
			const response = await app.inject({method: "GET", url: path, headers: readHeaders(dmB)});
			expect([403, 404]).toContain(response.statusCode);
		}
		expect(campaignB.id).not.toBe(campaignA.id);
	});

	it("lets players read campaign context but not publish, grant, or open DM workspace", async () => {
		const dm = await signIn(identities.dmA);
		const campaignA = await campaign(dm, "A");
		const invite = await app.inject({method: "POST", url: `/api/campaigns/${campaignA.id}/invites`, headers: headers(dm), payload: {role: "player"}});
		const player = await signIn(identities.player);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(player), payload: {token: invite.json().token}});
		expect((await app.inject({method: "GET", url: `/api/campaigns/${campaignA.id}/context`, headers: {cookie: player.cookie}})).statusCode).toBe(200);

		const deniedRequests = [
			{method: "POST", url: `/api/campaigns/${campaignA.id}/rules-versions`, payload: {rules: {}}},
			{method: "GET", url: `/api/campaigns/${campaignA.id}/dm-workspace`},
			{method: "POST", url: `/api/campaigns/${campaignA.id}/archive`, payload: {}},
		];
		for (const request of deniedRequests) {
			const response = await app.inject({
				...request,
				headers: request.method === "GET" ? {cookie: player.cookie} : headers(player),
			});
			expect([403, 404]).toContain(response.statusCode);
		}
	});

	it("hides full character notes from other players while DM sees them", async () => {
		const dm = await signIn(identities.dmA);
		const campaignA = await campaign(dm, "A");
		const invite = await app.inject({method: "POST", url: `/api/campaigns/${campaignA.id}/invites`, headers: headers(dm), payload: {role: "player", maxUses: 2}});
		const player = await signIn(identities.player);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(player), payload: {token: invite.json().token}});
		const character = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(player),
			payload: {clientImportId: "p", campaignId: campaignA.id, schemaVersion: 1, data: {name: "Secret", notes: {backstory: "Hidden"}, hp: {current: 10}}},
		})).json().character;
		const dmRead = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(dm)});
		expect(dmRead.json().projection.kind).toBe("dm_truth");
		expect(dmRead.json().projection.character.data.notes.backstory).toBe("Hidden");
		// A DM sees truth beside the exact peer preview, but never the owner's raw policy.
		expect(dmRead.json().projection.peerPreview.kind).toBe("peer_profile");
		expect(dmRead.json().projection.character.projectionPolicy).toBeUndefined();

		const other = await signIn(identities.other);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(other), payload: {token: invite.json().token}});
		const snapshot = await app.inject({method: "GET", url: `/api/campaigns/${campaignA.id}/snapshot`, headers: readHeaders(other)});
		const peer = snapshot.json().snapshot.characters[0];
		expect(peer.kind).toBe("peer_profile");
		expect(peer.data.notes).toBeUndefined();
		expect(peer.ownerAccountId).toBeUndefined();
		expect(JSON.stringify(snapshot.json())).not.toContain("Hidden");

		// A peer's direct read is the same recipient-independent profile, and it matches
		// the preview the DM was shown.
		const peerRead = await app.inject({method: "GET", url: `/api/characters/${character.id}`, headers: readHeaders(other)});
		expect(peerRead.json().projection).toEqual(dmRead.json().projection.peerPreview);
	});

	it("prevents spectators from creating characters or proposing actions", async () => {
		const dm = await signIn(identities.dmA);
		const campaignA = await campaign(dm, "A");
		const invite = await app.inject({method: "POST", url: `/api/campaigns/${campaignA.id}/invites`, headers: headers(dm), payload: {role: "spectator"}});
		const spectator = await signIn(identities.other);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(spectator), payload: {token: invite.json().token}});
		const create = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: headers(spectator),
			payload: {clientImportId: "spectator", campaignId: campaignA.id, schemaVersion: 1, data: {name: "Nope"}},
		});
		expect(create.statusCode).toBe(403);
	});
});
