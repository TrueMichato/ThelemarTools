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

	it("refuses a heal against a document with no usable maximum, atomically", async () => {
		const {campaign, dm, characters} = await setup();
		// Reproduces a save written before the hit point maximum was first recalculated: the
		// sheet showed a healthy maximum while the stored document claimed zero. Clamping to it
		// would have set the character to 0 hit points.
		const stored = store._characters.get(characters.target.id);
		stored.data.hp = {current: 5, max: 0, temp: 0};
		const revisionBefore = stored.revision;
		const commandId = crypto.randomUUID();

		const response = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: getDirectBody({
				commandId,
				targetCharacterId: characters.target.id,
				amount: 10,
				kind: "hp.heal",
			}),
		});

		expect(response.statusCode).toBe(409);
		expect(response.json()).toEqual({error: "HP_MAX_UNAVAILABLE"});
		const after = store._characters.get(characters.target.id);
		expect(after.data.hp).toEqual({current: 5, max: 0, temp: 0});
		expect(after.revision).toBe(revisionBefore);
	});

	it("heals up to the applicable maximum rather than the stored base maximum", async () => {
		const {campaign, dm, characters} = await setup();
		const stored = store._characters.get(characters.target.id);
		stored.data.hp = {current: 5, max: 20, temp: 0, effectiveMax: 30};
		const commandId = crypto.randomUUID();

		const response = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: getDirectBody({
				commandId,
				targetCharacterId: characters.target.id,
				amount: 100,
				kind: "hp.heal",
			}),
		});

		expect(response.statusCode).toBe(201);
		// Clamped to the applicable maximum, and the maximum fields survive untouched.
		expect(store._characters.get(characters.target.id).data.hp).toEqual({
			current: 30, max: 20, temp: 0, effectiveMax: 30,
		});
	});

	it("applies DM operations atomically and replays the stable result exactly once", async () => {
		const {campaign, dm, source, target, characters} = await setup();
		store._characters.get(characters.target.id).data.hp.maxHpReduction = 3;
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
		expect(truth.character.data.hp.maxHpReduction).toBe(3);
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

	it("projects only owner-resolvable, privacy-safe pending actions for an open character", async () => {
		const {campaign, dm, source, target, characters} = await setup();
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
		const actionId = proposed.json().operation.operationId;
		const costActionId = crypto.randomUUID();
		store._semanticOperations.set(costActionId, {
			...structuredClone(store._semanticOperations.get(actionId)),
			id: costActionId,
			contractVersion: 1,
			templateRegistryVersion: "peer-effects-v1",
			sourceCost: {
				version: 1,
				components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
			},
		});

		const response = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/characters/${characters.target.id}/pending-actions`,
			headers: readHeaders(target.session),
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			actions: [{
				actionId,
				status: "proposed",
				expiresAt: "2026-01-02T00:00:00.000Z",
				presentation: {
					sourceName: "Aster",
					effectLabel: "Test Blessing",
					outcomeLabel: "Restore 4 hit points",
				},
				capabilities: {canApprove: true, canReject: true},
			}],
		});
		const globalResponse = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: readHeaders(target.session),
		});
		expect(globalResponse.statusCode).toBe(200);
		expect(globalResponse.json().actions.map(action => action.operationId)).toEqual([actionId]);
		const currentProtocolGlobalResponse = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: {...readHeaders(target.session), "x-hub-protocol-version": "4"},
		});
		expect(currentProtocolGlobalResponse.statusCode).toBe(200);
		expect(currentProtocolGlobalResponse.json().actions.map(action => action.operationId).sort()).toEqual(
			[actionId, costActionId].sort(),
		);
		const currentProtocolResponse = await app.inject({
			method: "GET",
			url: `/api/campaigns/${campaign.id}/characters/${characters.target.id}/pending-actions`,
			headers: {...readHeaders(target.session), "x-hub-protocol-version": "4"},
		});
		expect(currentProtocolResponse.statusCode).toBe(200);
		expect(currentProtocolResponse.json().actions.map(action => action.actionId).sort()).toEqual(
			[actionId, costActionId].sort(),
		);
		const serialized = JSON.stringify(response.json());
		for (const privateValue of [
			characters.target.id,
			characters.source.id,
			target.session.account.id,
			source.session.account.id,
			"sourceEntity",
			"effectTemplateId",
			"choice",
			"targetRef",
		]) expect(serialized).not.toContain(privateValue);

		for (const session of [dm, source.session]) {
			const forbidden = await app.inject({
				method: "GET",
				url: `/api/campaigns/${campaign.id}/characters/${characters.target.id}/pending-actions`,
				headers: readHeaders(session),
			});
			expect(forbidden.statusCode).toBe(404);
		}

		const proposedEvent = store._events.find(event => event.type === "character.operation.proposed" && event.aggregateId === actionId);
		expect(proposedEvent.payload).not.toHaveProperty("sourceEntity");
		expect(proposedEvent.payload).not.toHaveProperty("effectTemplateId");
		expect(proposedEvent.payload).not.toHaveProperty("choice");
		expect(proposedEvent.payload.effectOutcomeLabel).toBe("Restore 4 hit points");
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

	it.each(["move", "archive"])("rejects a busy character %s without cancelling semantic proposals", async lifecycleAction => {
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
		const destination = lifecycleAction === "move"
			? (await store.pCreateCampaign({
				accountId: source.session.account.id,
				name: "Destination",
				idempotencyKey: `destination-${crypto.randomUUID()}`,
			})).campaign
			: null;
		const transferId = crypto.randomUUID();
		store._transfers.set(transferId, {
			id: transferId,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: characters.source.id,
			targetKind: "party_inventory",
			targetId: "party",
			status: "reserved",
		});
		const before = {
			character: structuredClone(store._characters.get(characters.source.id)),
			operation: structuredClone(store._semanticOperations.get(operationId)),
			events: store._events.length,
			outbox: store._outbox.length,
		};

		const mutation = lifecycleAction === "move"
			? store.pMoveCharacter({
				accountId: source.session.account.id,
				characterId: characters.source.id,
				campaignId: destination.id,
				idempotencyKey: `move-${crypto.randomUUID()}`,
			})
			: store.pArchiveCharacter({
				accountId: source.session.account.id,
				characterId: characters.source.id,
				idempotencyKey: `archive-${crypto.randomUUID()}`,
			});
		await expect(mutation).rejects.toMatchObject({code: "CHARACTER_BUSY"});
		expect(store._characters.get(characters.source.id)).toEqual(before.character);
		expect(store._semanticOperations.get(operationId)).toEqual(before.operation);
		expect(store._events).toHaveLength(before.events);
		expect(store._outbox).toHaveLength(before.outbox);
	});

	it("rejects approval after the original actor loses current target visibility", async () => {
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
		await store.pSetProjectionPolicy({
			accountId: target.session.account.id,
			characterId: characters.target.id,
			policy: {version: 1, preset: "private", overrides: {}},
			expectedProjectionRevision: characters.target.projectionRevision,
			idempotencyKey: `private-${crypto.randomUUID()}`,
		});
		const before = {
			target: structuredClone(store._characters.get(characters.target.id)),
			events: store._events.length,
			outbox: store._outbox.length,
		};
		const approvalId = crypto.randomUUID();
		const approval = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${proposed.json().operation.operationId}/resolve`,
			headers: semanticHeaders(target.session, approvalId),
			payload: {commandId: approvalId, decision: "accept"},
		});
		expect(approval.statusCode).toBe(409);
		expect(approval.json()).toEqual({error: "PROPOSAL_STALE"});
		expect(store._characters.get(characters.target.id)).toEqual(before.target);
		expect(store._semanticOperations.get(proposed.json().operation.operationId).status).toBe("proposed");
		expect(store._events).toHaveLength(before.events);
		expect(store._outbox).toHaveLength(before.outbox);
	});

	it("resets a campaign-local operation watermark when a character moves campaigns", async () => {
		const {campaign, dm, target, characters} = await setup();
		const commandId = crypto.randomUUID();
		const applied = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions`,
			headers: semanticHeaders(dm, commandId),
			payload: getDirectBody({commandId, targetCharacterId: characters.target.id, amount: 1}),
		});
		expect(applied.json().operationWatermark).toBeGreaterThan(0);
		const destination = (await store.pCreateCampaign({
			accountId: target.session.account.id,
			name: "Watermark Destination",
			idempotencyKey: `watermark-destination-${crypto.randomUUID()}`,
		})).campaign;
		const moved = await store.pMoveCharacter({
			accountId: target.session.account.id,
			characterId: characters.target.id,
			campaignId: destination.id,
			idempotencyKey: `watermark-move-${crypto.randomUUID()}`,
		});
		expect(moved.character.operationWatermark).toBe(0);
		const cursor = await store.pGetCampaignCursor({
			accountId: target.session.account.id,
			campaignId: destination.id,
		});
		expect(cursor.characterRefs).toContainEqual(expect.objectContaining({
			id: characters.target.id,
			operationWatermark: 0,
		}));
		const destinationCommandId = crypto.randomUUID();
		const destinationApplied = await app.inject({
			method: "POST",
			url: `/api/campaigns/${destination.id}/actions`,
			headers: semanticHeaders(target.session, destinationCommandId),
			payload: getDirectBody({commandId: destinationCommandId, targetCharacterId: characters.target.id, amount: 1}),
		});
		expect(destinationApplied.statusCode).toBe(201);
		expect(destinationApplied.json().operationWatermark).toBeGreaterThan(0);
		expect(destinationApplied.json().operationWatermark).toBeLessThan(applied.json().operationWatermark);
		const reloaded = await store.pGetCharacter({
			accountId: target.session.account.id,
			characterId: characters.target.id,
		});
		expect(reloaded.character.data.hp.current).toBe(moved.character.data.hp.current - 1);
	});

	it("expires once and lifecycle-cancels proposals with privacy-safe terminal events", async () => {
		const {campaign, dm, source, target, characters} = await setup();
		const expiringCommandId = crypto.randomUUID();
		const expiring = await app.inject({
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
		const expiryCommandId = crypto.randomUUID();
		const expired = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${expiring.json().operation.operationId}/resolve`,
			headers: semanticHeaders(target.session, expiryCommandId),
			payload: {commandId: expiryCommandId, decision: "accept"},
		});
		expect(expired.statusCode).toBe(200);
		expect(expired.json().operation.status).toBe("expired");
		const expiryReplay = await app.inject({
			method: "POST",
			url: `/api/campaigns/${campaign.id}/actions/${expiring.json().operation.operationId}/resolve`,
			headers: semanticHeaders(target.session, expiryCommandId),
			payload: {commandId: expiryCommandId, decision: "accept"},
		});
		expect(expiryReplay.json()).toEqual(expired.json());
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

	it("cancels inbound proposals when the target owner becomes a spectator", async () => {
		const {campaign, dm, source, target, characters} = await setup();
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
		await store.pChangeMemberRole({
			accountId: dm.account.id,
			campaignId: campaign.id,
			membershipId: target.membership.id,
			role: "spectator",
			idempotencyKey: `demote-${crypto.randomUUID()}`,
		});
		expect(store._semanticOperations.get(proposed.json().operation.operationId).status).toBe("cancelled");
		expect(await store.pListPendingActions({accountId: target.session.account.id, campaignId: campaign.id})).toEqual([]);
	});
});

describe("production semantic operation registry", () => {
	it("derives a deterministic, standard-slot Cure Wounds operation", () => {
		const registry = createSemanticOperationRegistry();
		const targetRef = crypto.randomUUID();
		const input = {
			sourceCharacter: {
				id: crypto.randomUUID(),
				data: {
					abilities: {wis: 16},
					abilityBonuses: {wis: 0},
					classes: [{name: "Cleric", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "wis"}],
					spellcasting: {
						ability: "wis",
						spellsKnown: [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceClass: "Cleric"}],
						spellSlots: {1: {current: 1, max: 1}},
					},
				},
			},
			targetCharacter: {id: crypto.randomUUID(), targetRef, data: {}},
			targetRef,
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 1},
			sourceProfile: {},
			targetProfile: {},
			effectResolutionSeed: "ab".repeat(32),
		};
		const first = registry.derive(input);
		const second = registry.derive(input);
		expect(second).toEqual(first);
		expect(first.sourceCost).toEqual({
			version: 1,
			components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
		});
		expect(first.operation).toMatchObject({kind: "hp.heal", arguments: {amount: expect.any(Number)}});
	});

	it.each([
		["unprepared", [{name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"}], []],
		["innate", [], [{name: "Cure Wounds", source: "PHB", level: 1}]],
		["unattributed", [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true}], []],
		["feat-granted", [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceType: "feat"}], []],
		["race-granted", [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceType: "race"}], []],
		["item-granted", [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceType: "item"}], []],
	])("rejects %s Cure Wounds entries that are not currently usable class spells", (_label, spellsKnown, innateSpells) => {
		const registry = createSemanticOperationRegistry();
		expect(() => registry.derive({
			sourceCharacter: {
				id: crypto.randomUUID(),
				data: {
					abilities: {wis: 16},
					abilityBonuses: {wis: 0},
					classes: [{name: "Cleric", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "wis"}],
					spellcasting: {
						ability: "wis",
						spellsKnown,
						innateSpells,
						spellSlots: {1: {current: 1, max: 1}},
					},
				},
			},
			targetCharacter: {id: crypto.randomUUID(), targetRef: "target-ref", data: {}},
			targetRef: "target-ref",
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 1},
			sourceProfile: {},
			targetProfile: {},
			effectResolutionSeed: "ab".repeat(32),
		})).toThrow(expect.objectContaining({code: "SOURCE_OR_TARGET_UNAVAILABLE"}));
	});

	it("supports a positively attributed known class spell", () => {
		const registry = createSemanticOperationRegistry();
		const targetCharacter = {id: crypto.randomUUID(), targetRef: "target-ref", data: {}};
		const derived = registry.derive({
			sourceCharacter: {
				id: crypto.randomUUID(),
				data: {
					abilities: {cha: 16},
					abilityBonuses: {cha: 0},
					classes: [{name: "Bard", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "cha"}],
					spellcasting: {
						ability: "wis",
						spellsKnown: [{
							name: "Cure Wounds",
							source: "PHB",
							level: 1,
							sourceClass: "Bard",
							sourceFeature: "Spells Known",
						}],
						spellSlots: {1: {current: 1, max: 1}},
					},
				},
			},
			targetCharacter,
			targetRef: targetCharacter.targetRef,
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 1},
			sourceProfile: {},
			targetProfile: {},
			effectResolutionSeed: "ef".repeat(32),
		});
		expect(derived.operation).toMatchObject({kind: "hp.heal", arguments: {amount: expect.any(Number)}});
	});

	it("uses the owning class ability and the sheet's effective ability-score channels", () => {
		const registry = createSemanticOperationRegistry();
		const sourceCharacter = {
			id: crypto.randomUUID(),
			data: {
				abilities: {int: 18, wis: 10},
				abilityBonuses: {wis: 0},
				classes: [
					{name: "Wizard", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "int"},
					{name: "Cleric", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "wis"},
				],
				customModifiers: {abilityScores: {wis: 2}, abilityScoreStatic: {wis: 20}},
				directAbilityBonuses: {wis: 2},
				itemAbilityOverrides: {bonus: {wis: 2}, static: {wis: 19}},
				activeStates: [{
					active: true,
					customEffects: [{type: "abilityDamage", target: "wis", value: 2}],
				}],
				spellcasting: {
					ability: "int",
					spellsKnown: [{
						name: "Cure Wounds",
						source: "PHB",
						level: 1,
						prepared: true,
						sourceClass: "Cleric",
					}],
					spellSlots: {1: {current: 1, max: 1}},
				},
			},
		};
		const targetCharacter = {id: crypto.randomUUID(), targetRef: "target-ref", data: {}};
		const derive = character => registry.derive({
			sourceCharacter: character,
			targetCharacter,
			targetRef: targetCharacter.targetRef,
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 1},
			sourceProfile: {},
			targetProfile: {},
			effectResolutionSeed: "cd".repeat(32),
		}).operation.arguments.amount;
		const baseline = structuredClone(sourceCharacter);
		baseline.data.customModifiers = {};
		baseline.data.directAbilityBonuses = {};
		baseline.data.itemAbilityOverrides = {};
		baseline.data.activeStates = [];

		expect(derive(sourceCharacter) - derive(baseline)).toBe(4);
	});
});
