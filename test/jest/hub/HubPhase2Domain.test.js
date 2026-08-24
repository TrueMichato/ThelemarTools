import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const APP_ORIGIN = "https://tools.example";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "123", login: "dm", displayName: "DM"},
	player: {provider: "github", providerSubject: "999", login: "player", displayName: "Player"},
};

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

describe("Phase 2 campaign context and DM workspace", () => {
	let app;
	let identity;
	let mutationIx;

	beforeEach(async () => {
		identity = IDENTITIES.dm;
		mutationIx = 0;
		app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: APP_ORIGIN,
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: ["github:123", "github:999"],
			},
		});
	});

	afterEach(async () => app.close());

	async function pSignIn (nextIdentity) {
		identity = nextIdentity;
		const start = await app.inject({method: "GET", url: "/auth/github/start"});
		const state = new URL(start.headers.location).searchParams.get("state");
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${getCookie(start, "__Host-hub_oauth")}`},
		});
		const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
		return {cookie, ...session};
	}

	function headers (session) {
		return {
			cookie: session.cookie,
			origin: APP_ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "1",
			"idempotency-key": `m-${++mutationIx}`,
		};
	}

	async function pCampaign (dm) {
		return (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: headers(dm),
			payload: {name: "Context Campaign"},
		})).json().campaign;
	}

	async function pInvitePlayer ({dm, player, campaign}) {
		const invite = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: headers(dm),
			payload: {role: "player"},
		});
		await app.inject({
			method: "POST",
			url: "/api/invites/redeem",
			headers: headers(player),
			payload: {token: invite.json().token},
		});
	}

	it("publishes immutable brew and rules versions visible identically to all members", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCampaign(dm);
		const player = await pSignIn(IDENTITIES.player);
		await pInvitePlayer({dm, player, campaign});
		const brewDocs = [{
			head: {filename: "campaign.json"},
			body: {
				_meta: {sources: [{json: "CMP", abbreviation: "CMP", full: "Campaign"}]},
				spell: [{name: "Campaign Spark", source: "CMP", level: 1, entries: ["Safe."]}],
			},
		}];
		const brew = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/brew-versions`,
			headers: headers(dm),
			payload: {brewDocs},
		});
		expect(brew.statusCode).toBe(201);
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/brew-versions/${brew.json().brewBundle.id}/activate`,
			headers: headers(dm),
		});
		const rules = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions`,
			headers: headers(dm),
			payload: {rules: {exhaustionRules: "2024", thelemar_jumping: false}},
		});
		expect(rules.statusCode).toBe(201);
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions/${rules.json().rulesVersion.id}/activate`,
			headers: headers(dm),
		});

		const contexts = await Promise.all([dm, player].map(session => app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/context`,
			headers: {cookie: session.cookie},
		})));
		expect(contexts[0].json()).toEqual(contexts[1].json());
		expect(contexts[0].json().context).toEqual(expect.objectContaining({
			brewBundle: expect.objectContaining({content: brewDocs, contentHash: expect.any(String)}),
			rulesVersion: expect.objectContaining({
				rules: expect.objectContaining({exhaustionRules: "2024", thelemar_jumping: false}),
			}),
		}));
	});

	it("rejects unsafe campaign brew and player publishing attempts", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCampaign(dm);
		const unsafe = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/brew-versions`,
			headers: headers(dm),
			payload: {brewDocs: [{head: {}, body: {spell: [{entries: [{type: "wrappedHtml", html: "<b>x</b>"}]}]}}]},
		});
		expect(unsafe.statusCode).toBe(400);
		expect(unsafe.json().error).toBe("BREW_RAW_HTML_FORBIDDEN");

		const player = await pSignIn(IDENTITIES.player);
		await pInvitePlayer({dm, player, campaign});
		const forbidden = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions`,
			headers: headers(player),
			payload: {rules: {}},
		});
		expect(forbidden.statusCode).toBe(403);
	});

	it("keeps each DM workspace private and fences stale editors", async () => {
		const dmA = await pSignIn(IDENTITIES.dm);
		const campaign = await pCampaign(dmA);
		const workspace = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/dm-workspace`,
			headers: {cookie: dmA.cookie},
		});
		expect(workspace.statusCode).toBe(200);
		const workspaceId = workspace.json().workspace.id;
		const leaseA = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/dm-workspace/${workspaceId}/lease`,
			headers: headers(dmA),
			payload: {},
		});
		const dmASecondDevice = await pSignIn(IDENTITIES.dm);
		const leaseB = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/dm-workspace/${workspaceId}/lease`,
			headers: headers(dmASecondDevice),
			payload: {takeover: true},
		});
		expect(leaseB.json().lease.epoch).toBe(leaseA.json().lease.epoch + 1);
		const stale = await app.inject({
			method: "PUT",
			url: `/api/campaigns/${campaign.id}/dm-workspace/${workspaceId}`,
			headers: headers(dmA),
			payload: {baseRevision: 1, leaseEpoch: leaseA.json().lease.epoch, state: {mv: 1}},
		});
		expect(stale.statusCode).toBe(409);
		expect(stale.json().error).toBe("LEASE_FENCED");

		const player = await pSignIn(IDENTITIES.player);
		await pInvitePlayer({dm: dmASecondDevice, player, campaign});
		const forbidden = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/dm-workspace`,
			headers: {cookie: player.cookie},
		});
		expect(forbidden.statusCode).toBe(403);
	});
});
