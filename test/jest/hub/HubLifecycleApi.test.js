import crypto from "node:crypto";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const ORIGIN = "https://tools.example";
const identities = {
	dm: {provider: "github", providerSubject: "1", login: "dm", displayName: "DM"},
	player: {provider: "github", providerSubject: "2", login: "player", displayName: "Player"},
};

function cookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("Hub lifecycle API", () => {
	let app;
	let identity;
	let ix;

	beforeEach(async () => {
		identity = identities.dm;
		ix = 0;
		app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: ({state}) => `https://x/?state=${state}`, pExchangeCode: async () => identity},
			config: {appOrigin: ORIGIN, cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32), allowedOAuthSubjects: ["github:1", "github:2"]},
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

	async function setupCampaign () {
		const dm = await signIn(identities.dm);
		const campaign = (await app.inject({method: "POST", url: "/api/campaigns", headers: headers(dm), payload: {name: "Lifecycle"}})).json().campaign;
		const invite = await app.inject({method: "POST", url: `/api/campaigns/${campaign.id}/invites`, headers: headers(dm), payload: {role: "player"}});
		const player = await signIn(identities.player);
		await app.inject({method: "POST", url: "/api/invites/redeem", headers: headers(player), payload: {token: invite.json().token}});
		return {dm, player, campaign};
	}

	it("exposes invite/member/session administration with role enforcement", async () => {
		const {dm, player, campaign} = await setupCampaign();
		const invites = await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/invites`, headers: {cookie: dm.cookie}});
		expect(invites.statusCode).toBe(200);
		expect(invites.json().invites[0]).not.toHaveProperty("tokenHash");
		const revoked = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites/${invites.json().invites[0].id}/revoke`,
			headers: headers(dm),
		});
		expect(revoked.json().invite.revokedAt).toBeTruthy();

		const members = (await app.inject({method: "GET", url: `/api/campaigns/${campaign.id}/members`, headers: {cookie: dm.cookie}})).json().members;
		const playerMembership = members.find(member => member.accountId === player.account.id);
		const changed = await app.inject({
			method: "PATCH",
			url: `/api/campaigns/${campaign.id}/members/${playerMembership.id}`,
			headers: headers(dm),
			payload: {role: "spectator"},
		});
		expect(changed.json().membership.role).toBe("spectator");
		const denied = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: headers(player),
			payload: {targetCharacterId: crypto.randomUUID(), effect: {type: "informational"}},
		});
		expect(denied.statusCode).toBe(403);

		const sessions = await app.inject({method: "GET", url: "/api/account/sessions", headers: {cookie: player.cookie}});
		expect(sessions.json().sessions.some(session => session.isCurrent)).toBe(true);
	});

	it("freezes a deletion-pending account until cancellation after reauthentication", async () => {
		const {player} = await setupCampaign();
		const requested = await app.inject({
			method: "POST",
			url: "/api/account/deletion/request",
			headers: headers(player, "delete"),
			payload: {confirmation: "DELETE"},
		});
		expect(requested.statusCode).toBe(200);
		expect(requested.json().deletion.status).toBe("deletion_requested");

		const grace = await signIn(identities.player);
		expect(grace.account.status).toBe("deletion_requested");
		const blocked = await app.inject({method: "GET", url: "/api/campaigns", headers: {cookie: grace.cookie}});
		expect(blocked.statusCode).toBe(423);
		expect(blocked.json().error).toBe("ACCOUNT_DELETION_PENDING");
		const exported = await app.inject({method: "GET", url: "/api/account/export", headers: {cookie: grace.cookie}});
		expect(exported.statusCode).toBe(200);
		const cancelled = await app.inject({
			method: "POST",
			url: "/api/account/deletion/cancel",
			headers: headers(grace, "cancel"),
		});
		expect(cancelled.json().deletion.status).toBe("active");
		expect((await app.inject({method: "GET", url: "/api/campaigns", headers: {cookie: grace.cookie}})).statusCode).toBe(200);
	});
});
