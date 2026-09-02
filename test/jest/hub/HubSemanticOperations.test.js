import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const ORIGIN = "https://tools.example";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "semantic-dm", login: "semantic-dm", displayName: "DM"},
	coDm: {provider: "github", providerSubject: "semantic-codm", login: "semantic-codm", displayName: "Co-DM"},
	source: {provider: "github", providerSubject: "semantic-source", login: "semantic-source", displayName: "Source"},
	target: {provider: "github", providerSubject: "semantic-target", login: "semantic-target", displayName: "Target"},
};
const SOURCE_ENTITY = {type: "ability", uid: "test blessing|tst", version: "test-v1"};
const EFFECT_TEMPLATE_ID = "test.blessing.heal";

function getTestTemplate ({cost = "none"} = {}) {
	return {
		sourceEntity: SOURCE_ENTITY,
		effectTemplateId: EFFECT_TEMPLATE_ID,
		cost,
		display: {label: "Test Blessing"},
		normalizeChoice: choice => {
			if (
				!choice
				|| Object.keys(choice).some(key => key !== "amount")
				|| !Number.isInteger(choice.amount)
				|| choice.amount < 1
				|| choice.amount > 10
			) throw new Error("Invalid trusted test template choice.");
			return {amount: choice.amount};
		},
		deriveOperation: ({choice}) => ({kind: "hp.heal", arguments: {amount: choice.amount}}),
	};
}

function cookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

describe("semantic character operations", () => {
	let app;
	let store;
	let identity;
	let now;
	let keyIndex;

	beforeEach(async () => {
		now = new Date("2026-01-01T00:00:00.000Z");
		keyIndex = 0;
		identity = IDENTITIES.dm;
		store = new MemoryHubStore({
			fnNow: () => new Date(now),
			semanticOperationRegistry: createSemanticOperationRegistry({templates: [getTestTemplate()]}),
		});
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://example.invalid/?state=${state}`,
				pExchangeCode: async () => identity,
			},
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
		const callback = await app.inject({
			method: "GET",
			url: `/auth/github/callback?code=x&state=${state}`,
			headers: {cookie: `__Host-hub_oauth=${cookie(start, "__Host-hub_oauth")}`},
		});
		const sessionCookie = `__Host-hub_session=${cookie(callback, "__Host-hub_session")}`;
		const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie: sessionCookie}})).json();
		return {...session, cookie: sessionCookie};
	}

	function mutationHeaders (session, idempotencyKey = `semantic-${++keyIndex}`) {
		return {
			cookie: session.cookie,
			origin: ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "3",
			"idempotency-key": idempotencyKey,
		};
	}

	function semanticHeaders (session, commandId) {
		return mutationHeaders(session, commandId);
	}

	function readHeaders (session) {
		return {cookie: session.cookie, "x-hub-protocol-version": "3"};
	}

	async function setup () {
		const dm = await signIn(IDENTITIES.dm);
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: mutationHeaders(dm),
			payload: {name: "Semantic operations"},
		})).json().campaign;
		const members = {};
		for (const [key, role] of [["coDm", "co_dm"], ["source", "player"], ["target", "player"]]) {
			const invite = (await app.inject({
				method: "POST",
				url: `/api/campaigns/${campaign.id}/invites`,
				headers: mutationHeaders(dm),
				payload: {role},
			})).json();
			const session = await signIn(IDENTITIES[key]);
			const redeemed = (await app.inject({
				method: "POST",
				url: "/api/invites/redeem",
				headers: mutationHeaders(session),
				payload: {token: invite.token},
			})).json();
			members[key] = {session, membership: redeemed.membership};
		}
		const characters = {};
		for (const key of ["source", "target"]) {
			characters[key] = (await app.inject({
				method: "POST",
				url: "/api/characters",
				headers: mutationHeaders(members[key].session),
				payload: {
					clientImportId: `semantic-${key}`,
					campaignId: campaign.id,
					schemaVersion: 1,
					data: {
						name: key === "source" ? "Aster" : "Bryn",
						hp: {current: key === "source" ? 14 : 5, max: 20, temp: 0},
						conditions: [],
						features: key === "source" ? [{name: "Test Blessing", source: "TST"}] : [],
						spellcasting: {spellSlots: {1: {current: 2, max: 2}}},
					},
				},
			})).json().character;
		}
		return {campaign, dm, ...members, characters};
	}

	function getDirectBody ({commandId, targetCharacterId, amount = 3, kind = "hp.damage"}) {
		return {
			commandId,
			targetCharacterId,
			operation: {kind, version: 1, arguments: {amount}},
		};
	}

	function getProposalBody ({commandId, sourceCharacterId, targetRef, amount = 4}) {
		return {
			commandId,
			sourceCharacterId,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {amount},
			targetRef,
		};
	}

	it("applies DM operations atomically and replays the stable result exactly once", async () => {
		const {campaign, dm, source, target, characters} = await setup();
		const commandId = crypto.randomUUID();
		const body = getDirectBody({commandId, targetCharacterId: characters.target.id, amount: 7});
		const first = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: body,
		});
		const retry = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: body,
		});
		expect(first.statusCode).toBe(201);
		expect(retry.json()).toEqual(first.json());
		expect(first.json()).toMatchObject({
			operation: {
				status: "applied",
				operation: {
					operationId: expect.any(String),
					kind: "hp.damage",
					version: 1,
					targetCharacterId: characters.target.id,
					arguments: {amount: 7},
				},
				resultingCharacterRevision: 2,
			},
			eventIds: [expect.any(String), expect.any(String)],
			operationWatermark: expect.any(Number),
		});

		const mutated = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: getDirectBody({commandId, targetCharacterId: characters.target.id, amount: 8}),
		});
		expect(mutated.statusCode).toBe(409);
		expect(mutated.json()).toEqual({error: "IDEMPOTENCY_KEY_REUSED"});

		const truth = (await app.inject({
			method: "GET",
			url: `/api/characters/${characters.target.id}`,
			headers: readHeaders(dm),
		})).json().projection;
		expect(truth.kind).toBe("dm_truth");
		expect(truth.character.data.hp.current).toBe(0);
		expect(truth.operationWatermark).toBe(first.json().operationWatermark);
		expect(truth.targetRef).toEqual(expect.any(String));

		const peerProjection = (await app.inject({
			method: "GET",
			url: `/api/characters/${characters.target.id}`,
			headers: readHeaders(source.session),
		})).json().projection;
		expect(peerProjection.kind).toBe("peer_profile");
		expect(peerProjection).not.toHaveProperty("operationWatermark");

		const events = (await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/events?afterSequence=0&limit=100`,
			headers: readHeaders(target.session),
		})).json().events;
		const applied = events.find(event => event.type === "character.operation.applied");
		expect(applied.payload).toEqual({
			operation: first.json().operation.operation,
			resultingCharacterRevision: 2,
		});
		expect(JSON.stringify(applied.payload)).not.toContain(IDENTITIES.dm.providerSubject);
		expect(events).toContainEqual(expect.objectContaining({
			type: "character.projection.invalidated",
			payload: {projectionRevision: expect.any(Number)},
		}));
	});

	it("allows co-DM direct operations but never allows a player generic JSON operation", async () => {
		const {campaign, coDm, source, characters} = await setup();
		const coDmCommandId = crypto.randomUUID();
		const coDmResult = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(coDm.session, coDmCommandId),
			payload: getDirectBody({commandId: coDmCommandId, targetCharacterId: characters.target.id, amount: 2, kind: "hp.heal"}),
		});
		expect(coDmResult.statusCode).toBe(201);
		expect(coDmResult.json().operation.status).toBe("applied");

		const playerCommandId = crypto.randomUUID();
		const forbidden = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, playerCommandId),
			payload: getDirectBody({commandId: playerCommandId, targetCharacterId: characters.source.id}),
		});
		expect(forbidden.statusCode).toBe(403);
		expect(forbidden.json()).toEqual({error: "OPERATION_FORBIDDEN"});
	});

	it("requires target-owner approval, including a distinct self-target approval command", async () => {
		const {campaign, dm, source, target, characters} = await setup();
		const sourceBefore = structuredClone(store._characters.get(characters.source.id).data);
		const commandId = crypto.randomUUID();
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, commandId),
			payload: getProposalBody({
				commandId,
				sourceCharacterId: characters.source.id,
				targetRef: characters.target.targetRef,
			}),
		});
		expect(proposed.statusCode).toBe(201);
		expect(proposed.json().operation).toMatchObject({
			operationId: expect.any(String),
			status: "proposed",
			targetCharacterId: characters.target.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {amount: 4},
		});
		expect(proposed.json().operation).not.toHaveProperty("sourceCharacterId");
		expect(proposed.json().operation).not.toHaveProperty("originActorAccountId");
		expect(store._characters.get(characters.source.id).data).toEqual(sourceBefore);
		expect(store._characters.get(characters.target.id).data.hp.current).toBe(5);

		const dmApprovalId = crypto.randomUUID();
		const dmApproval = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${proposed.json().operation.operationId}/resolve`,
			headers: semanticHeaders(dm, dmApprovalId),
			payload: {commandId: dmApprovalId, decision: "accept"},
		});
		expect(dmApproval.statusCode).toBe(403);

		const approvalId = crypto.randomUUID();
		const approved = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${proposed.json().operation.operationId}/resolve`,
			headers: semanticHeaders(target.session, approvalId),
			payload: {commandId: approvalId, decision: "accept"},
		});
		expect(approved.statusCode).toBe(200);
		expect(approved.json().operation.status).toBe("applied");
		expect(store._characters.get(characters.target.id).data.hp.current).toBe(9);
		expect(store._characters.get(characters.source.id).data).toEqual(sourceBefore);

		const selfProposalId = crypto.randomUUID();
		const selfProposal = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, selfProposalId),
			payload: getProposalBody({
				commandId: selfProposalId,
				sourceCharacterId: characters.source.id,
				targetRef: characters.source.targetRef,
				amount: 2,
			}),
		});
		expect(selfProposal.json().operation.status).toBe("proposed");
		expect(store._characters.get(characters.source.id).data.hp.current).toBe(14);
		const selfApprovalId = crypto.randomUUID();
		const selfApproved = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${selfProposal.json().operation.operationId}/resolve`,
			headers: semanticHeaders(source.session, selfApprovalId),
			payload: {commandId: selfApprovalId, decision: "accept"},
		});
		expect(selfApproved.statusCode).toBe(200);
		expect(store._characters.get(characters.source.id).data.hp.current).toBe(16);
	});

	it("fails stale or cost-bearing proposals without partial mutation", async () => {
		const {campaign, source, target, characters} = await setup();
		const commandId = crypto.randomUUID();
		const proposed = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, commandId),
			payload: getProposalBody({
				commandId,
				sourceCharacterId: characters.source.id,
				targetRef: characters.target.targetRef,
			}),
		});
		const operationId = proposed.json().operation.operationId;
		const before = {
			source: structuredClone(store._characters.get(characters.source.id)),
			target: structuredClone(store._characters.get(characters.target.id)),
			events: store._events.length,
			outbox: store._outbox.length,
		};
		store._semanticOperationRegistry = createSemanticOperationRegistry({templates: [getTestTemplate({cost: "spell_slot"})]});
		const approvalId = crypto.randomUUID();
		const stale = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${operationId}/resolve`,
			headers: semanticHeaders(target.session, approvalId),
			payload: {commandId: approvalId, decision: "accept"},
		});
		expect(stale.statusCode).toBe(409);
		expect(stale.json()).toEqual({error: "PROPOSAL_STALE"});
		expect(store._characters.get(characters.source.id)).toEqual(before.source);
		expect(store._characters.get(characters.target.id)).toEqual(before.target);
		expect(store._semanticOperations.get(operationId).status).toBe("proposed");
		expect(store._events).toHaveLength(before.events);
		expect(store._outbox).toHaveLength(before.outbox);
	});

	it("expires once and lifecycle-cancels proposals with privacy-safe terminal events", async () => {
		const {campaign, dm, source, target, characters} = await setup();
		const expiringCommandId = crypto.randomUUID();
		await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, expiringCommandId),
			payload: getProposalBody({
				commandId: expiringCommandId,
				sourceCharacterId: characters.source.id,
				targetRef: characters.target.targetRef,
			}),
		});
		now = new Date(now.getTime() + 25 * 60 * 60 * 1_000);
		for (let i = 0; i < 2; ++i) {
			const listed = await app.inject({
				method: "GET",
				url: `/api/campaigns/${campaign.id}/actions`,
				headers: readHeaders(target.session),
			});
			expect(listed.json().actions).toEqual([]);
		}
		expect(store._events.filter(event => event.type === "character.operation.expired")).toHaveLength(1);

		now = new Date(now.getTime() + 1_000);
		const cancelCommandId = crypto.randomUUID();
		const cancellable = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(source.session, cancelCommandId),
			payload: getProposalBody({
				commandId: cancelCommandId,
				sourceCharacterId: characters.source.id,
				targetRef: characters.target.targetRef,
			}),
		});
		const removed = await app.inject({
			method: "DELETE",
			url: `/api/campaigns/${campaign.id}/members/${source.membership.id}`,
			headers: mutationHeaders(dm),
		});
		expect(removed.statusCode).toBe(200);
		expect(store._semanticOperations.get(cancellable.json().operation.operationId).status).toBe("cancelled");
		const terminal = store._events.find(event =>
			event.type === "character.operation.cancelled"
			&& event.aggregateId === cancellable.json().operation.operationId,
		);
		expect(terminal.payload).toEqual(expect.objectContaining({
			operationId: cancellable.json().operation.operationId,
			targetCharacterId: characters.target.id,
			status: "cancelled",
			reason: "unavailable",
		}));
		expect(terminal.payload).not.toHaveProperty("sourceCharacterId");
		expect(terminal.payload).not.toHaveProperty("originActorAccountId");
	});
});

describe("production semantic operation registry", () => {
	it("recognizes Cure Wounds but rejects its cost before deriving an operation", () => {
		const registry = createSemanticOperationRegistry();
		let caught;
		try {
			registry.derive({
				sourceCharacter: {data: {}},
				targetCharacter: {id: crypto.randomUUID(), targetRef: crypto.randomUUID(), data: {}},
				targetRef: crypto.randomUUID(),
				sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
				effectTemplateId: "spell.cure-wounds.heal",
				choice: {},
				sourceProfile: {},
				targetProfile: {},
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({code: "SOURCE_COST_UNSUPPORTED", status: 409});
	});
});
