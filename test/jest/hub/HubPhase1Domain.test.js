import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {jest} from "@jest/globals";

const APP_ORIGIN = "https://tools.example";
const COOKIE_SECRET = "cookie-secret-at-least-thirty-two-characters";
const CSRF_SECRET = "csrf-secret-at-least-thirty-two-characters--";

const IDENTITIES = {
	dm: {provider: "github", providerSubject: "123", login: "dm", displayName: "Dungeon Master"},
	player: {provider: "github", providerSubject: "999", login: "player", displayName: "Player"},
};

function getSetCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

describe("Phase 1 campaign membership and cloud characters", () => {
	let app;
	let store;
	let identity;
	let mutationIx;

	beforeEach(async () => {
		identity = IDENTITIES.dm;
		mutationIx = 0;
		store = new MemoryHubStore();
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/authorize?state=${state}`,
				pExchangeCode: jest.fn(async () => identity),
			},
			config: {
				appOrigin: APP_ORIGIN,
				cookieSecret: COOKIE_SECRET,
				csrfSecret: CSRF_SECRET,
				allowedOAuthSubjects: ["github:123", "github:999"],
			},
		});
	});

	afterEach(async () => app.close());

	async function pSignIn (identityNxt) {
		identity = identityNxt;
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=code&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getSetCookie(start, "__Host-hub_oauth")}`},
		});
		const cookie = `__Host-hub_session=${getSetCookie(callback, "__Host-hub_session")}`;
		const session = await app.inject({method: "GET", url: "/api/session", headers: {cookie}});
		return {cookie, ...session.json()};
	}

	function mutationHeaders (session, idempotencyKey = `mutation-${++mutationIx}`) {
		return {
			cookie: session.cookie,
			origin: APP_ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "2",
			"idempotency-key": idempotencyKey,
		};
	}

	/** Projection-shaped reads must declare their protocol version, like mutations. */
	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "2"};
	}

	async function pCreateCampaign (session, name) {
		const response = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: mutationHeaders(session),
			payload: {name},
		});
		expect(response.statusCode).toBe(201);
		return response.json().campaign;
	}

	it("invites a player and exposes active membership to the campaign", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm, "Ashen March");
		const inviteResponse = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: mutationHeaders(dm),
			payload: {role: "player"},
		});
		expect(inviteResponse.statusCode).toBe(201);
		const {token} = inviteResponse.json();
		expect(token).toHaveLength(43);

		const player = await pSignIn(IDENTITIES.player);
		const redeemed = await app.inject({
			method: "POST",
			url: "/api/invites/redeem",
			headers: mutationHeaders(player),
			payload: {token},
		});
		expect(redeemed.statusCode).toBe(200);
		expect(redeemed.json().membership).toEqual(expect.objectContaining({
			campaignId: campaign.id,
			role: "player",
		}));

		const members = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/members`,
			headers: {cookie: dm.cookie},
		});
		expect(members.json().members.map(it => it.displayName)).toEqual(["Dungeon Master", "Player"]);
	});

	it("claims a character idempotently, leases it, and lets the DM read the full sheet", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm, "Ashen March");
		const invite = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: mutationHeaders(dm),
			payload: {role: "player"},
		});
		const player = await pSignIn(IDENTITIES.player);
		await app.inject({
			method: "POST",
			url: "/api/invites/redeem",
			headers: mutationHeaders(player),
			payload: {token: invite.json().token},
		});

		const claimPayload = {
			clientImportId: "local-character-1",
			campaignId: campaign.id,
			schemaVersion: 1,
			data: {
				name: "Mira",
				hp: {current: 20},
				notes: {backstory: "Private history"},
				features: [{name: "Rendered", description: `<div class="ve-rd__b"><p><strong>Safe</strong><script>alert(1)</script></p></div>`}],
			},
		};
		const first = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(player, "claim-1"),
			payload: claimPayload,
		});
		const retryDifferentCommand = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(player, "claim-2"),
			payload: claimPayload,
		});
		expect(first.statusCode).toBe(201);
		expect(retryDifferentCommand.json().character.id).toBe(first.json().character.id);
		const character = first.json().character;

		const lease = await app.inject({
			method: "POST",
			url: `/api/characters/${character.id}/lease`,
			headers: mutationHeaders(player),
			payload: {},
		});
		expect(lease.statusCode).toBe(200);
		const patched = await app.inject({
			method: "PATCH",
			url: `/api/characters/${character.id}`,
			headers: mutationHeaders(player),
			payload: {
				baseRevision: 1,
				leaseEpoch: lease.json().lease.epoch,
				patches: [{op: "replace", path: "/hp/current", value: 12}],
			},
		});
		expect(patched.statusCode).toBe(200);
		expect(patched.json().character.data.hp.current).toBe(12);

		const dmRead = await app.inject({
			method: "GET",
			url: `/api/characters/${character.id}`,
			headers: readHeaders(dm),
		});
		expect(dmRead.statusCode).toBe(200);
		expect(dmRead.json().projection.kind).toBe("dm_truth");
		expect(dmRead.json().projection.character.data.notes.backstory).toBe("Private history");
		expect(dmRead.json().projection.character.data.features[0].description).toBe(`<div class="ve-rd__b"><p><strong>Safe</strong>&lt;script&gt;alert(1)&lt;/script&gt;</p></div>`);
	});

	it("fences the old device after takeover", async () => {
		const playerA = await pSignIn(IDENTITIES.player);
		const campaign = await pCreateCampaign(playerA, "Player Campaign");
		const created = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(playerA),
			payload: {
				clientImportId: "local-character-1",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {name: "Mira", hp: {current: 20}},
			},
		});
		const characterId = created.json().character.id;
		const leaseA = await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease`,
			headers: mutationHeaders(playerA),
			payload: {},
		});

		const playerB = await pSignIn(IDENTITIES.player);
		const leaseB = await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease`,
			headers: mutationHeaders(playerB),
			payload: {takeover: true},
		});
		expect(leaseB.json().lease.epoch).toBe(leaseA.json().lease.epoch + 1);

		const stale = await app.inject({
			method: "PATCH",
			url: `/api/characters/${characterId}`,
			headers: mutationHeaders(playerA),
			payload: {
				baseRevision: 1,
				leaseEpoch: leaseA.json().lease.epoch,
				patches: [{op: "replace", path: "/hp/current", value: 1}],
			},
		});
		expect(stale.statusCode).toBe(409);
		expect(stale.json().error).toBe("LEASE_FENCED");
	});

	it("clones by default and moves explicitly between campaigns", async () => {
		const player = await pSignIn(IDENTITIES.player);
		const campaignA = await pCreateCampaign(player, "Campaign A");
		const campaignB = await pCreateCampaign(player, "Campaign B");
		const created = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(player),
			payload: {
				clientImportId: "local-character-1",
				campaignId: campaignA.id,
				schemaVersion: 1,
				data: {name: "Mira", xp: 100},
			},
		});
		const source = created.json().character;
		const cloned = await app.inject({
			method: "POST",
			url: `/api/characters/${source.id}/clone`,
			headers: mutationHeaders(player),
			payload: {campaignId: campaignB.id},
		});
		expect(cloned.statusCode).toBe(200);
		expect(cloned.json().character).toEqual(expect.objectContaining({
			campaignId: campaignB.id,
			clonedFromCharacterId: source.id,
		}));

		const moved = await app.inject({
			method: "POST",
			url: `/api/characters/${cloned.json().character.id}/move`,
			headers: mutationHeaders(player),
			payload: {campaignId: campaignA.id},
		});
		expect(moved.statusCode).toBe(200);
		expect(moved.json().character.campaignId).toBe(campaignA.id);

		const archived = await app.inject({
			method: "DELETE",
			url: `/api/characters/${cloned.json().character.id}`,
			headers: mutationHeaders(player),
		});
		expect(archived.statusCode).toBe(200);
		const missing = await app.inject({
			method: "GET",
			url: `/api/characters/${cloned.json().character.id}`,
			headers: readHeaders(player),
		});
		expect(missing.statusCode).toBe(404);
	});

	it("returns compact campaign compatibility metadata", async () => {
		const player = await pSignIn(IDENTITIES.player);
		const campaign = await pCreateCampaign(player, "Campaign A");
		const rules = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions`,
			headers: mutationHeaders(player),
			payload: {rules: {exhaustionRules: "2024"}},
		});
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions/${rules.json().rulesVersion.id}/activate`,
			headers: mutationHeaders(player),
		});

		const response = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/compatibility`,
			headers: {cookie: player.cookie},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			compatibility: {
				campaignId: campaign.id,
				rulesVersion: expect.objectContaining({
					version: 1,
					rules: expect.objectContaining({exhaustionRules: "2024"}),
				}),
				brewBundle: null,
			},
		});
	});

	it("only lets the session holding a character lease release it", async () => {
		const playerA = await pSignIn(IDENTITIES.player);
		const campaign = await pCreateCampaign(playerA, "Player Campaign");
		const created = await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(playerA),
			payload: {
				clientImportId: "local-character-1",
				campaignId: campaign.id,
				schemaVersion: 1,
				data: {name: "Mira"},
			},
		});
		const characterId = created.json().character.id;
		await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease`,
			headers: mutationHeaders(playerA),
			payload: {},
		});
		const playerB = await pSignIn(IDENTITIES.player);

		const refused = await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease/release`,
			headers: mutationHeaders(playerB),
			payload: {},
		});
		expect(refused.statusCode).toBe(409);
		expect(refused.json().error).toBe("LEASE_HELD");

		const released = await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease/release`,
			headers: mutationHeaders(playerA),
			payload: {},
		});
		expect(released.statusCode).toBe(200);
		expect(released.json()).toEqual({released: true});

		const acquired = await app.inject({
			method: "POST",
			url: `/api/characters/${characterId}/lease`,
			headers: mutationHeaders(playerB),
			payload: {},
		});
		expect(acquired.statusCode).toBe(200);
	});

	it("blocks mutation calls from stale protocol clients", async () => {
		const player = await pSignIn(IDENTITIES.player);
		const response = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {
				...mutationHeaders(player),
				"x-hub-protocol-version": "0",
			},
			payload: {name: "Old Client"},
		});
		expect(response.statusCode).toBe(426);
		expect(response.json()).toEqual({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: "2"});
	});

	it("blocks projection-shaped reads from stale protocol clients", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: mutationHeaders(dm),
			payload: {name: "Stale Reader"},
		})).json().campaign;
		const character = (await app.inject({
			method: "POST",
			url: "/api/characters",
			headers: mutationHeaders(dm),
			payload: {clientImportId: "stale-read", schemaVersion: 1, campaignId: campaign.id, data: {name: "Reader"}},
		})).json().character;

		// A v1 client must be told to update rather than silently misreading a v2 envelope.
		for (const url of [
			`/api/characters/${character.id}`,
			`/api/campaigns/${campaign.id}/snapshot`,
			`/api/campaigns/${campaign.id}/character-projections`,
			`/api/characters/${character.id}/projection-policy`,
		]) {
			const stale = await app.inject({method: "GET", url, headers: {cookie: dm.cookie, "x-hub-protocol-version": "1"}});
			expect({url, status: stale.statusCode, body: stale.json()}).toEqual({
				url,
				status: 426,
				body: {error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: "2"},
			});
		}
	});
});
