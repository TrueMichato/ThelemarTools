import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	createDefaultCampaignRulesPolicy,
} from "../../../js/hub/hub-campaign-rules.js";

const ORIGIN = "https://tools.example";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "rules-dm", login: "rules-dm", displayName: "Rules DM"},
	player: {provider: "github", providerSubject: "rules-player", login: "rules-player", displayName: "Rules Player"},
	spectator: {provider: "github", providerSubject: "rules-spectator", login: "rules-spectator", displayName: "Rules Spectator"},
};

function getCookie (response, name) {
	return (response.cookies || []).find(cookie => cookie.name === name)?.value;
}

describe("Campaign rules policy API", () => {
	let app;
	let store;
	let identity;
	let mutationIx;

	beforeEach(async () => {
		store = new MemoryHubStore();
		identity = IDENTITIES.dm;
		mutationIx = 0;
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				allowedOAuthSubjects: Object.values(IDENTITIES).map(it => `${it.provider}:${it.providerSubject}`),
				isCampaignRulesPolicyEnabled: true,
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
		return {...session, cookie};
	}

	function headers (session, idempotencyKey = `rules-${++mutationIx}`) {
		return {
			cookie: session.cookie,
			origin: ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "3",
			"idempotency-key": idempotencyKey,
		};
	}

	async function pCreateCampaign (dm) {
		return (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: headers(dm),
			payload: {name: "Rules Campaign"},
		})).json().campaign;
	}

	async function pJoin ({dm, member, campaign, role}) {
		const invite = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/invites`,
			headers: headers(dm),
			payload: {role},
		});
		await app.inject({
			method: "POST",
			url: "/api/invites/redeem",
			headers: headers(member),
			payload: {token: invite.json().token},
		});
	}

	function publishRequest ({dm, campaign, policy, expectedActiveRulesVersionId = null, key = `publish-${++mutationIx}`}) {
		return app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-policy`,
			headers: headers(dm, key),
			payload: {policy, expectedActiveRulesVersionId},
		});
	}

	it("capability-gates the catalog routes while leaving the legacy API available", async () => {
		expect((await app.inject({method: "GET", url: "/api/meta"})).json().capabilities)
			.toContain(CAMPAIGN_RULES_POLICY_CAPABILITY);
		await app.close();
		app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				allowedOAuthSubjects: [`github:${IDENTITIES.dm.providerSubject}`],
			},
		});
		expect((await app.inject({method: "GET", url: "/api/meta"})).json().capabilities)
			.not.toContain(CAMPAIGN_RULES_POLICY_CAPABILITY);
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		expect((await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/rules-policy`,
			headers: {cookie: dm.cookie},
		})).statusCode).toBe(404);
		expect((await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions`,
			headers: headers(dm),
			payload: {rules: {exhaustionRules: "2024"}},
		})).statusCode).toBe(201);
	});

	it("reads an existing schema-v1 false-TGTT/default-Thelemar version with the capability on or off", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const legacyVersion = {
			id: "legacy-false-tgtt",
			campaignId: campaign.id,
			version: 1,
			schemaVersion: 1,
			rules: {enableTgtt: false},
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		store._rulesVersions.set(legacyVersion.id, legacyVersion);
		store._campaigns.get(campaign.id).activeRulesVersionId = legacyVersion.id;

		const readContext = async session => app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/context`,
			headers: {cookie: session.cookie},
		});
		const enabled = await readContext(dm);
		expect(enabled.statusCode).toBe(200);
		expect(enabled.json().context.rulesVersion.rules).toEqual({
			enableTgtt: false,
			exhaustionRules: "thelemar",
			thelemar_carryWeight: true,
			thelemar_encumbranceTiers: true,
			thelemar_jumping: true,
			thelemar_linguisticsBonus: true,
			thelemar_criticalRolls: true,
		});

		await app.close();
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://github.example/?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "c".repeat(32),
				csrfSecret: "s".repeat(32),
				allowedOAuthSubjects: Object.values(IDENTITIES).map(it => `${it.provider}:${it.providerSubject}`),
			},
		});
		const dmWithoutCapability = await pSignIn(IDENTITIES.dm);
		const disabled = await readContext(dmWithoutCapability);
		expect(disabled.statusCode).toBe(200);
		expect(disabled.json()).toEqual(enabled.json());
	});

	it("keeps memory legacy create and activation all-or-none when public adaptation fails", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const createKey = {key: "legacy-create-retry", requestHash: "legacy-create-retry"};
		await expect(store.pCreateRulesVersion({
			accountId: dm.account.id,
			campaignId: campaign.id,
			schemaVersion: 1,
			rules: {unknown: true},
			idempotencyKey: createKey,
		})).rejects.toEqual(expect.objectContaining({code: "RULES_INVALID"}));
		expect(store._rulesVersions.size).toBe(0);
		expect(store._audit.filter(entry => entry.action.startsWith("rules."))).toHaveLength(0);
		expect(store._commandReceipts.has(`${dm.account.id}::${createKey.key}`)).toBe(false);

		const retried = await store.pCreateRulesVersion({
			accountId: dm.account.id,
			campaignId: campaign.id,
			schemaVersion: 1,
			rules: {enableTgtt: false},
			idempotencyKey: createKey,
		});
		expect(retried.rulesVersion.version).toBe(1);
		expect(store._rulesVersions.size).toBe(1);
		expect(store._audit.filter(entry => entry.action === "rules.created")).toHaveLength(1);

		const corruptVersion = {
			id: "corrupt-legacy",
			campaignId: campaign.id,
			version: 2,
			schemaVersion: 1,
			rules: {unknown: true},
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		store._rulesVersions.set(corruptVersion.id, corruptVersion);
		const activateKey = {key: "legacy-activate-retry", requestHash: "legacy-activate-retry"};
		await expect(store.pActivateRulesVersion({
			accountId: dm.account.id,
			campaignId: campaign.id,
			rulesVersionId: corruptVersion.id,
			idempotencyKey: activateKey,
		})).rejects.toEqual(expect.objectContaining({code: "RULES_INVALID"}));
		expect(store._campaigns.get(campaign.id).activeRulesVersionId).toBeNull();
		expect(store._audit.filter(entry => entry.action === "rules.activated")).toHaveLength(0);
		expect(store._events.filter(event => event.type === "rules.activated")).toHaveLength(0);
		expect(store._commandReceipts.has(`${dm.account.id}::${activateKey.key}`)).toBe(false);

		corruptVersion.rules = {enableTgtt: false};
		const activated = await store.pActivateRulesVersion({
			accountId: dm.account.id,
			campaignId: campaign.id,
			rulesVersionId: corruptVersion.id,
			idempotencyKey: activateKey,
		});
		expect(activated.rulesVersion.id).toBe(corruptVersion.id);
		expect(store._campaigns.get(campaign.id).activeRulesVersionId).toBe(corruptVersion.id);
		expect(store._audit.filter(entry => entry.action === "rules.activated")).toHaveLength(1);
		expect(store._events.filter(event => event.type === "rules.activated")).toHaveLength(1);
	});

	it("creates and activates one immutable version atomically with private audit and event evidence", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const player = await pSignIn(IDENTITIES.player);
		await pJoin({dm, member: player, campaign, role: "player"});
		const response = await publishRequest({dm, campaign, policy: createDefaultCampaignRulesPolicy()});
		expect(response.statusCode).toBe(201);
		const created = response.json().rulesVersion;
		expect(created).toEqual(expect.objectContaining({
			version: 1,
			schemaVersion: 2,
			catalogVersion: 1,
			policy: expect.objectContaining({schemaVersion: 2, catalogVersion: 1}),
			rules: expect.objectContaining({enableTgtt: true, exhaustionRules: "thelemar"}),
		}));

		const dmContext = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/context`,
			headers: {cookie: dm.cookie},
		})).json().context;
		const playerContext = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/context`,
			headers: {cookie: player.cookie},
		})).json().context;
		expect(playerContext).toEqual(dmContext);
		expect(playerContext.rulesVersion.rules).toEqual(created.rules);
		expect(playerContext.rulesVersion.policy).toBeUndefined();
		expect(playerContext.rulesVersion.policySummary.rules).toHaveLength(7);

		const evidence = {
			audit: store._audit.filter(entry => entry.campaignId === campaign.id && entry.action.startsWith("rules.")),
			events: store._events.filter(event => event.campaignId === campaign.id && event.type === "rules.activated"),
			outbox: store._outbox.filter(entry => entry.campaignId === campaign.id),
		};
		expect(evidence.audit.map(entry => entry.action)).toEqual(["rules.created", "rules.activated"]);
		expect(evidence.events).toHaveLength(1);
		expect(evidence.events[0].payload).toEqual({
			version: 1,
			previousVersion: null,
			schemaVersion: 2,
			catalogVersion: 1,
			operation: "publish",
		});
		expect(JSON.stringify(evidence)).not.toMatch(/notes|explanation|Rules DM|rules-player/i);
		expect(evidence.outbox.map(entry => entry.eventId)).toContain(evidence.events[0].id);
	});

	it("replays idempotently, rejects key reuse, and does not duplicate evidence", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const policy = createDefaultCampaignRulesPolicy();
		const first = await publishRequest({dm, campaign, policy, key: "same-publish"});
		const replay = await publishRequest({dm, campaign, policy, key: "same-publish"});
		expect(replay.statusCode).toBe(201);
		expect(replay.json()).toEqual(first.json());
		expect(store._rulesVersions.size).toBe(1);
		expect(store._events.filter(event => event.type === "rules.activated")).toHaveLength(1);

		const changed = createDefaultCampaignRulesPolicy();
		changed.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
		const reused = await publishRequest({dm, campaign, policy: changed, key: "same-publish"});
		expect(reused.statusCode).toBe(409);
		expect(reused.json().error).toBe("IDEMPOTENCY_KEY_REUSED");
		expect(store._rulesVersions.size).toBe(1);
	});

	it("fences stale and concurrent bases without partial versions, audits, or outbox rows", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const policyA = createDefaultCampaignRulesPolicy();
		const policyB = createDefaultCampaignRulesPolicy();
		policyA.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
		policyB.rules.find(rule => rule.id === "tgtt.critical-rolls").parameters.enabled = false;
		const [resultA, resultB] = await Promise.all([
			publishRequest({dm, campaign, policy: policyA, key: "concurrent-a"}),
			publishRequest({dm, campaign, policy: policyB, key: "concurrent-b"}),
		]);
		expect([resultA.statusCode, resultB.statusCode].sort()).toEqual([201, 409]);
		expect([resultA.json().error, resultB.json().error]).toContain("RULES_VERSION_STALE");
		expect(store._rulesVersions.size).toBe(1);
		expect(store._audit.filter(entry => entry.action.startsWith("rules."))).toHaveLength(2);
		expect(store._events.filter(event => event.type === "rules.activated")).toHaveLength(1);
		expect(store._outbox.filter(entry => entry.campaignId === campaign.id)).toHaveLength(2);
	});

	it("rejects player and spectator writes before any policy evidence is created", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		for (const [role, who] of [["player", IDENTITIES.player], ["spectator", IDENTITIES.spectator]]) {
			const member = await pSignIn(who);
			await pJoin({dm, member, campaign, role});
			const management = await app.inject({
				method: "GET",
				url: `/api/campaigns/${campaign.id}/rules-policy`,
				headers: {cookie: member.cookie},
			});
			expect(management.statusCode).toBe(403);
			expect(management.json().error).toBe("FORBIDDEN");
			const response = await publishRequest({
				dm: member,
				campaign,
				policy: createDefaultCampaignRulesPolicy(),
				key: `forbidden-${role}`,
			});
			expect(response.statusCode).toBe(403);
			expect(response.json().error).toBe("FORBIDDEN");
		}
		expect(store._rulesVersions.size).toBe(0);
		expect(store._audit.filter(entry => entry.action.startsWith("rules."))).toHaveLength(0);
	});

	it("permits co-DM management while fencing rules versions to their campaign tenant", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const otherCampaign = await pCreateCampaign(dm);
		const coDm = await pSignIn(IDENTITIES.player);
		await pJoin({dm, member: coDm, campaign, role: "co_dm"});
		expect((await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/rules-policy`,
			headers: {cookie: coDm.cookie},
		})).statusCode).toBe(200);
		expect((await publishRequest({
			dm: coDm,
			campaign,
			policy: createDefaultCampaignRulesPolicy(),
		})).statusCode).toBe(201);

		const otherVersion = (await publishRequest({
			dm,
			campaign: otherCampaign,
			policy: createDefaultCampaignRulesPolicy(),
		})).json().rulesVersion;
		const crossTenant = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-policy/activate`,
			headers: headers(dm),
			payload: {
				rulesVersionId: otherVersion.id,
				expectedActiveRulesVersionId: [...store._rulesVersions.values()].find(version => version.campaignId === campaign.id).id,
			},
		});
		expect(crossTenant.statusCode).toBe(404);
		expect(crossTenant.json().error).toBe("RULES_NOT_FOUND");
	});

	it("rejects unknown rules and unsupported parameters atomically", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const unknown = createDefaultCampaignRulesPolicy();
		unknown.rules[0].id = "custom.secret-rule";
		const invalid = createDefaultCampaignRulesPolicy();
		invalid.rules[0].parameters.enabled = "yes";
		for (const [policy, code] of [[unknown, "RULES_UNKNOWN"], [invalid, "RULES_PARAMETER_INVALID"]]) {
			const response = await publishRequest({dm, campaign, policy});
			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe(code);
		}
		expect(store._rulesVersions.size).toBe(0);
		expect(store._audit.filter(entry => entry.action.startsWith("rules."))).toHaveLength(0);
	});

	it("rejects unsafe notes, unsupported combinations, and oversized bodies atomically", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const unsafe = createDefaultCampaignRulesPolicy();
		unsafe.notes = [{id: "unsafe", title: "Unsafe", explanation: "<script>alert(1)</script>"}];
		const incompatible = createDefaultCampaignRulesPolicy();
		incompatible.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled = false;
		for (const [policy, code] of [
			[unsafe, "RULES_NOTE_INVALID"],
			[incompatible, "RULES_COMBINATION_UNSUPPORTED"],
		]) {
			const response = await publishRequest({dm, campaign, policy});
			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe(code);
		}
		const oversized = createDefaultCampaignRulesPolicy();
		oversized.notes = [{id: "oversized", title: "Oversized", explanation: "x".repeat(2 * 1024 * 1024)}];
		const response = await publishRequest({dm, campaign, policy: oversized});
		expect(response.statusCode).toBe(413);
		expect(response.json().error).toBe("PAYLOAD_TOO_LARGE");
		expect(store._rulesVersions.size).toBe(0);
		expect(store._audit.filter(entry => entry.action.startsWith("rules."))).toHaveLength(0);
	});

	it("reads legacy versions through the adapter, upgrades without drift, and rolls back by activation", async () => {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = await pCreateCampaign(dm);
		const legacyCreated = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions`,
			headers: headers(dm),
			payload: {rules: {exhaustionRules: "2024", thelemar_jumping: false}},
		});
		const legacyVersion = legacyCreated.json().rulesVersion;
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-versions/${legacyVersion.id}/activate`,
			headers: headers(dm),
		});
		const management = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/rules-policy`,
			headers: {cookie: dm.cookie},
		})).json().management;
		const adaptedLegacy = management.versions[0];
		expect(adaptedLegacy).toEqual(expect.objectContaining({
			schemaVersion: 1,
			catalogVersion: 1,
			policy: expect.objectContaining({schemaVersion: 2}),
			rules: expect.objectContaining({exhaustionRules: "2024", thelemar_jumping: false}),
		}));

		const upgraded = await publishRequest({
			dm,
			campaign,
			policy: adaptedLegacy.policy,
			expectedActiveRulesVersionId: legacyVersion.id,
		});
		expect(upgraded.statusCode).toBe(201);
		expect(upgraded.json().rulesVersion.rules).toEqual(adaptedLegacy.rules);
		const rollback = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/rules-policy/activate`,
			headers: headers(dm),
			payload: {
				rulesVersionId: legacyVersion.id,
				expectedActiveRulesVersionId: upgraded.json().rulesVersion.id,
			},
		});
		expect(rollback.statusCode).toBe(200);
		expect(rollback.json().rulesVersion.id).toBe(legacyVersion.id);
		expect(store._rulesVersions.size).toBe(2);
		expect(store._audit.at(-1)).toEqual(expect.objectContaining({
			action: "rules.rollback_activated",
			targetId: legacyVersion.id,
		}));
		expect(store._events.at(-1).payload.operation).toBe("rollback");
	});
});
