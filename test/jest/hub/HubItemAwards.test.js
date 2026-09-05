import crypto from "node:crypto";

import {createHubApp} from "../../../server/src/app.js";
import {
	addAwardedEntryToCharacter,
	addAwardedItemToCharacter,
	normalizeSafeItemSummary,
} from "../../../server/src/hub-actions.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const ORIGIN = "https://tools.example";
const IDENTITIES = {
	dm: {provider: "github", providerSubject: "award-dm", login: "award-dm", displayName: "DM"},
	coDm: {provider: "github", providerSubject: "award-co", login: "award-co", displayName: "Co-DM"},
	playerA: {provider: "github", providerSubject: "award-a", login: "award-a", displayName: "Player A"},
	playerB: {provider: "github", providerSubject: "award-b", login: "award-b", displayName: "Player B"},
	outsider: {provider: "github", providerSubject: "award-out", login: "award-out", displayName: "Outsider"},
};

function getCookie (response, name) {
	return (response.cookies || []).find(it => it.name === name)?.value;
}

async function pCreateStoreFixture () {
	const store = new MemoryHubStore();
	const accounts = Object.fromEntries(await Promise.all(Object.entries(IDENTITIES).map(async ([key, identity]) => [
		key,
		await store.pUpsertOAuthAccount(identity),
	])));
	const campaign = (await store.pCreateCampaign({
		accountId: accounts.dm.id,
		name: "Awards",
		idempotencyKey: crypto.randomUUID(),
	})).campaign;
	let keyIndex = 0;
	const pJoin = async (account, role = "player") => {
		const tokenHash = `award-token-${++keyIndex}`;
		await store.pCreateInvite({
			accountId: accounts.dm.id,
			campaignId: campaign.id,
			role,
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pRedeemInvite({
			accountId: account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		});
	};
	await pJoin(accounts.coDm, "co_dm");
	await pJoin(accounts.playerA);
	await pJoin(accounts.playerB);
	const pCreateCharacter = async (account, name, inventory = []) => (await store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		data: {
			name,
			inventory,
			currency: {},
			carry: {schemaVersion: 1, status: "known"},
		},
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
	})).character;
	const characterA = await pCreateCharacter(accounts.playerA, "A");
	const characterB = await pCreateCharacter(accounts.playerB, "B");
	return {store, accounts, campaign, characterA, characterB, pCreateCharacter};
}

describe("Campaign Hub item award domain", () => {
	it("normalizes the closed item summary and reports the truthful merged entry", () => {
		expect(normalizeSafeItemSummary({
			name: "  Potion of Healing ",
			source: " DMG ",
			page: 187,
			rarity: " common ",
			weight: 0.5,
			value: 5000,
			typeCode: " P ",
			edition: "classic",
		})).toEqual({
			name: "Potion of Healing",
			source: "DMG",
			page: 187,
			rarity: "common",
			weight: 0.5,
			value: 5000,
			typeCode: "P",
			edition: "classic",
		});
		expect(() => normalizeSafeItemSummary({name: "<script>x</script>", source: "HB"})).toThrow();
		expect(() => normalizeSafeItemSummary({name: "Potion", source: "HB", entries: ["not allowed"]})).toThrow();

		const existing = {id: crypto.randomUUID(), item: {name: "Arrow", source: "PHB"}, quantity: 2};
		const added = addAwardedItemToCharacter({
			container: {inventory: [existing], currency: {}},
			item: {name: "Arrow", source: "PHB"},
			quantity: 3,
		});
		expect(added.entry).toEqual(expect.objectContaining({id: existing.id, quantity: 5}));
		expect(added.container.inventory).toHaveLength(1);
	});

	it("preserves transfer-safe awarded entry metadata while resetting only ownership-local state", () => {
		const existingId = crypto.randomUUID();
		const item = {
			name: "Charged Blade",
			source: "PHB",
			material: {name: "Star iron", source: "HB"},
			charges: {current: 3, max: 5},
			custom: {maker: "Rook"},
		};
		const wrapper = {note: "Ceremonial", chargesUsed: 2, customState: {batch: "A"}};
		const added = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: existingId, item, quantity: 1, ...wrapper}],
				currency: {},
			},
			incoming: {
				id: crypto.randomUUID(),
				item,
				quantity: 2,
				...wrapper,
				equipped: true,
				attuned: true,
				starred: true,
				_sourceIndex: 4,
			},
		});
		expect(added.container.inventory).toEqual([
			expect.objectContaining({id: existingId, item, quantity: 3, ...wrapper}),
		]);
		expect(added.entry.id).toBe(existingId);
		expect(added.entry).not.toHaveProperty("_sourceIndex");
	});

	it("locks unique PostgreSQL inventory participants in lexical order", async () => {
		const calls = [];
		const store = new PostgresHubStore({
			pool: {query () {}, connect () {}, on () {}},
		});
		const first = "00000000-0000-4000-8000-000000000001";
		const second = "00000000-0000-4000-8000-000000000002";
		await store._pLockInventoryParticipants({
			client: {query: async (_sql, params) => calls.push(params[0])},
			ids: [second, first, second],
		});
		expect(calls).toEqual([first, second]);
	});

	it("awards every target in input order, merges stacks, strips carry, and emits one bounded audit", async () => {
		const ctx = await pCreateStoreFixture();
		const existing = {
			id: crypto.randomUUID(),
			item: {name: "Potion", source: "DMG", rarity: "common"},
			quantity: 4,
		};
		ctx.store._characters.get(ctx.characterB.id).data.inventory.push(existing);
		const eventCount = ctx.store.getDomainEvents().length;
		const auditCount = ctx.store.getAuditEntries().length;
		const result = await ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "recent", item: {name: " Potion ", source: " DMG ", rarity: " common "}},
			targetCharacterIds: [ctx.characterB.id, ctx.characterA.id],
			quantity: 3,
			note: "For the road",
			idempotencyKey: "award-order",
		});

		expect(result).toMatchObject({
			awardId: expect.any(String),
			source: {kind: "recent", item: {name: "Potion", source: "DMG", rarity: "common"}},
			quantity: 3,
			note: "For the road",
			targets: [
				{index: 0, characterId: ctx.characterB.id, entryId: existing.id, quantity: 3},
				{index: 1, characterId: ctx.characterA.id, entryId: expect.any(String), quantity: 3},
			],
		});
		expect(ctx.store._characters.get(ctx.characterB.id).data.inventory[0].quantity).toBe(7);
		expect(ctx.store._characters.get(ctx.characterA.id).data.inventory[0].quantity).toBe(3);
		expect(ctx.store._characters.get(ctx.characterA.id).data).not.toHaveProperty("carry");
		expect(ctx.store._characters.get(ctx.characterB.id).data).not.toHaveProperty("carry");

		const audits = ctx.store.getAuditEntries().slice(auditCount);
		expect(audits).toEqual([expect.objectContaining({
			action: "item.award_batch",
			targetType: "campaign",
			targetId: ctx.campaign.id,
			details: expect.objectContaining({
				awardId: result.awardId,
				sourceKind: "recent",
				targetCharacterIds: [ctx.characterB.id, ctx.characterA.id],
				targetCount: 2,
				quantity: 3,
				totalQuantity: 6,
			}),
		})]);
		const events = ctx.store.getDomainEvents().slice(eventCount);
		expect(events.map(event => event.type)).toEqual([
			"item.granted",
			"character.projection.invalidated",
			"item.granted",
			"character.projection.invalidated",
		]);
		const grants = events.filter(event => event.type === "item.granted");
		expect(grants.map(event => event.aggregateId)).toEqual([ctx.characterB.id, ctx.characterA.id]);
		expect(grants.map(event => event.payload.index)).toEqual([0, 1]);
		expect(grants[0]).toMatchObject({
			aggregateRevision: result.targets[0].revision,
			visibility: "explicit_accounts",
			visibleAccountIds: expect.arrayContaining([ctx.accounts.dm.id, ctx.accounts.playerB.id]),
			payload: {
				awardId: result.awardId,
				index: 0,
				targetCount: 2,
				sourceKind: "recent",
				note: "For the road",
				entry: {id: existing.id, item: {name: "Potion", source: "DMG", rarity: "common"}, quantity: 3},
				characterNameSnapshot: expect.any(Object),
			},
		});
	});

	it("stages every target before publishing and rejects archived and cross-campaign targets without enumeration", async () => {
		const ctx = await pCreateStoreFixture();
		const before = structuredClone(ctx.store._characters.get(ctx.characterA.id));
		const auditCount = ctx.store.getAuditEntries().length;
		const eventCount = ctx.store.getDomainEvents().length;
		await expect(ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: "Torch", source: "PHB"}},
			targetCharacterIds: [ctx.characterA.id, crypto.randomUUID()],
			quantity: 1,
			idempotencyKey: "award-missing-target",
		})).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
		expect(ctx.store._characters.get(ctx.characterA.id)).toEqual(before);
		expect(ctx.store.getAuditEntries()).toHaveLength(auditCount);
		expect(ctx.store.getDomainEvents()).toHaveLength(eventCount);

		ctx.store._characters.get(ctx.characterB.id).data.notes = "x".repeat(1_500_000);
		await expect(ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: "Torch", source: "PHB"}},
			targetCharacterIds: [ctx.characterA.id, ctx.characterB.id],
			quantity: 1,
			idempotencyKey: "award-invalid-document",
		})).rejects.toMatchObject({code: "CHARACTER_TOO_LARGE"});
		expect(ctx.store._characters.get(ctx.characterA.id)).toEqual(before);
		expect(ctx.store.getAuditEntries()).toHaveLength(auditCount);
		expect(ctx.store.getDomainEvents()).toHaveLength(eventCount);

		const otherCampaign = (await ctx.store.pCreateCampaign({
			accountId: ctx.accounts.dm.id,
			name: "Other",
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const crossCampaign = (await ctx.store.pCreateCharacter({
			accountId: ctx.accounts.dm.id,
			campaignId: otherCampaign.id,
			data: {name: "Cross", inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const input = {
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: "Torch", source: "PHB"}},
			quantity: 1,
		};
		await expect(ctx.store.pAwardItems({
			...input,
			targetCharacterIds: [crossCampaign.id],
			idempotencyKey: "award-cross",
		})).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
		await ctx.store.pArchiveCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: ctx.characterA.id,
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(ctx.store.pAwardItems({
			...input,
			targetCharacterIds: [ctx.characterA.id],
			idempotencyKey: "award-archived",
		})).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
	});

	it("replays and serializes concurrent duplicates exactly once, while rejecting a changed body", async () => {
		const ctx = await pCreateStoreFixture();
		const input = {
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "campaign_item", item: {name: "Rope", source: "PHB", weight: 10}},
			targetCharacterIds: [ctx.characterA.id, ctx.characterB.id],
			quantity: 2,
			note: null,
			idempotencyKey: "award-concurrent",
		};
		const [first, duplicate] = await Promise.all([
			ctx.store.pAwardItems(input),
			ctx.store.pAwardItems(input),
		]);
		expect(duplicate).toEqual(first);
		expect(ctx.store._characters.get(ctx.characterA.id).data.inventory).toEqual([
			expect.objectContaining({quantity: 2}),
		]);
		expect(ctx.store.getAuditEntries().filter(audit => audit.action === "item.award_batch")).toHaveLength(1);
		expect(ctx.store.getDomainEvents().filter(event => event.payload?.awardId === first.awardId && event.type === "item.granted")).toHaveLength(2);
		await expect(ctx.store.pAwardItems({...input, quantity: 3})).rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED"});
	});

	it("debits exactly quantity times target count and rolls back an insufficient stash award", async () => {
		const ctx = await pCreateStoreFixture();
		const party = await ctx.store.pGetPartyInventory({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		});
		const entryId = crypto.randomUUID();
		const existingId = crypto.randomUUID();
		const authoritativeItem = {
			name: "Silvered Arrow",
			source: "PHB",
			page: 4,
			weight: 0.05,
			material: {name: "Moon silver", source: "PHB"},
			charges: {current: 3, max: 5},
			entries: ["Rich transferable content"],
			custom: {maker: "Rook"},
		};
		const entryMetadata = {note: "Blue fletching", chargesUsed: 1, customState: {batch: "A"}};
		ctx.store._characters.get(ctx.characterA.id).data.inventory.push({
			id: existingId,
			item: authoritativeItem,
			quantity: 1,
			...entryMetadata,
		});
		ctx.store._partyInventories.get(ctx.campaign.id).inventory.push({
			id: entryId,
			item: authoritativeItem,
			quantity: 7,
			...entryMetadata,
		});
		const eventCount = ctx.store.getDomainEvents().length;
		const result = await ctx.store.pAwardItems({
			accountId: ctx.accounts.coDm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "party_inventory", entryId},
			targetCharacterIds: [ctx.characterA.id, ctx.characterB.id],
			quantity: 2,
			note: null,
			idempotencyKey: "stash-award",
		});
		expect(result.source).toEqual({
			kind: "party_inventory",
			item: {name: "Silvered Arrow", source: "PHB", page: 4, weight: 0.05},
		});
		expect(result.partyInventory).toEqual({id: party.id, revision: party.revision + 1});
		expect(result.targets[0].entryId).toBe(existingId);
		expect(ctx.store._partyInventories.get(ctx.campaign.id).inventory[0].quantity).toBe(3);
		expect(ctx.store._characters.get(ctx.characterA.id).data.inventory).toEqual([
			expect.objectContaining({id: existingId, item: authoritativeItem, quantity: 3, ...entryMetadata}),
		]);
		expect(ctx.store._characters.get(ctx.characterB.id).data.inventory).toEqual([
			expect.objectContaining({
				item: authoritativeItem,
				quantity: 2,
				...entryMetadata,
				equipped: false,
				attuned: false,
				starred: false,
			}),
		]);
		const awardEvents = ctx.store.getDomainEvents().slice(eventCount);
		expect(awardEvents.map(event => event.type)).toEqual([
			"item.granted",
			"character.projection.invalidated",
			"item.granted",
			"character.projection.invalidated",
			"party_inventory.invalidated",
		]);
		for (const event of awardEvents.filter(event => event.type === "item.granted")) {
			expect(event.payload.entry.item).toEqual({
				name: "Silvered Arrow",
				source: "PHB",
				page: 4,
				weight: 0.05,
			});
			expect(event.payload.entry.item).not.toHaveProperty("material");
			expect(event.payload.entry).not.toHaveProperty("note");
		}

		const beforeCharacters = [ctx.characterA.id, ctx.characterB.id]
			.map(id => structuredClone(ctx.store._characters.get(id)));
		const beforeParty = structuredClone(ctx.store._partyInventories.get(ctx.campaign.id));
		const auditCount = ctx.store.getAuditEntries().length;
		const eventsAfterSuccess = ctx.store.getDomainEvents().length;
		await expect(ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "party_inventory", entryId},
			targetCharacterIds: [ctx.characterA.id, ctx.characterB.id],
			quantity: 2,
			idempotencyKey: "stash-insufficient",
		})).rejects.toMatchObject({code: "TRANSFER_INSUFFICIENT"});
		expect([ctx.characterA.id, ctx.characterB.id].map(id => ctx.store._characters.get(id))).toEqual(beforeCharacters);
		expect(ctx.store._partyInventories.get(ctx.campaign.id)).toEqual(beforeParty);
		expect(ctx.store.getAuditEntries()).toHaveLength(auditCount);
		expect(ctx.store.getDomainEvents()).toHaveLength(eventsAfterSuccess);
	});

	it("tightens the legacy grant to safe metadata without breaking name/source callers", async () => {
		const ctx = await pCreateStoreFixture();
		const safe = await ctx.store.pGrantItem({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.characterA.id,
			item: {name: " Torch ", source: " PHB "},
			quantity: 1,
			idempotencyKey: "legacy-safe",
		});
		expect(safe.entry.item).toEqual({name: "Torch", source: "PHB"});
		const before = structuredClone(ctx.store._characters.get(ctx.characterA.id));
		await expect(ctx.store.pGrantItem({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.characterA.id,
			item: {name: "Torch", source: "PHB", entries: [{type: "script"}]},
			quantity: 1,
			idempotencyKey: "legacy-rich",
		})).rejects.toMatchObject({code: "ITEM_AWARD_INVALID"});
		expect(ctx.store._characters.get(ctx.characterA.id)).toEqual(before);
	});
});

describe("POST /api/campaigns/:campaignId/item-awards", () => {
	let app;
	let store;
	let identity;
	let keyIndex;

	beforeEach(async () => {
		store = new MemoryHubStore();
		identity = IDENTITIES.dm;
		keyIndex = 0;
		app = await createHubApp({
			store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://x/?state=${state}`,
				pExchangeCode: async () => identity,
			},
			config: {
				appOrigin: ORIGIN,
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: Object.values(IDENTITIES).map(it => `${it.provider}:${it.providerSubject}`),
			},
		});
	});

	afterEach(async () => app.close());

	async function pSignIn (who) {
		identity = who;
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

	function getHeaders (session, key = `award-${++keyIndex}`) {
		return {
			cookie: session.cookie,
			origin: ORIGIN,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "3",
			"idempotency-key": key,
		};
	}

	async function pSetupRouteFixture () {
		const dm = await pSignIn(IDENTITIES.dm);
		const campaign = (await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: getHeaders(dm),
			payload: {name: "Route Awards"},
		})).json().campaign;
		const joined = {};
		for (const [key, who, role] of [
			["coDm", IDENTITIES.coDm, "co_dm"],
			["playerA", IDENTITIES.playerA, "player"],
			["playerB", IDENTITIES.playerB, "player"],
		]) {
			const invite = await app.inject({
				method: "POST",
				url: `/api/campaigns/${campaign.id}/invites`,
				headers: getHeaders(dm),
				payload: {role},
			});
			const session = await pSignIn(who);
			await app.inject({
				method: "POST",
				url: "/api/invites/redeem",
				headers: getHeaders(session),
				payload: {token: invite.json().token},
			});
			joined[key] = session;
		}
		const characters = [];
		for (const [session, name] of [[joined.playerA, "A"], [joined.playerB, "B"]]) {
			characters.push((await app.inject({
				method: "POST",
				url: "/api/characters",
				headers: getHeaders(session),
				payload: {
					clientImportId: crypto.randomUUID(),
					campaignId: campaign.id,
					schemaVersion: 1,
					data: {name, inventory: [], currency: {}},
				},
			})).json().character);
		}
		return {dm, campaign, ...joined, characters, outsider: await pSignIn(IDENTITIES.outsider)};
	}

	function getValidBody (characters) {
		return {
			source: {kind: "catalog", item: {name: "Torch", source: "PHB"}},
			targetCharacterIds: characters.map(character => character.id),
			quantity: 1,
			note: null,
		};
	}

	it("is mutation-secured and role-gated to DM and co-DM", async () => {
		const ctx = await pSetupRouteFixture();
		const url = `/api/campaigns/${ctx.campaign.id}/item-awards`;
		const body = getValidBody([ctx.characters[0]]);
		const insecure = await app.inject({
			method: "POST",
			url,
			headers: {cookie: ctx.dm.cookie, "x-hub-protocol-version": "3", "idempotency-key": "insecure"},
			payload: body,
		});
		expect(insecure).toMatchObject({statusCode: 403});
		expect(await app.inject({method: "POST", url, headers: getHeaders(ctx.playerA), payload: body})).toMatchObject({statusCode: 403});
		const outsider = await app.inject({method: "POST", url, headers: getHeaders(ctx.outsider), payload: body});
		expect(outsider.statusCode).toBe(404);
		expect(outsider.json()).toEqual({error: "CAMPAIGN_NOT_FOUND"});
		expect((await app.inject({method: "POST", url, headers: getHeaders(ctx.dm), payload: body})).statusCode).toBe(200);
		expect((await app.inject({method: "POST", url, headers: getHeaders(ctx.coDm), payload: body})).statusCode).toBe(200);
	});

	it.each([
		["top-level field", body => ({...body, executable: {deep: true}})],
		["source field", body => ({...body, source: {...body.source, arbitrary: true}})],
		["item field", body => ({...body, source: {...body.source, item: {...body.source.item, entries: []}}})],
		["blank name", body => ({...body, source: {...body.source, item: {...body.source.item, name: "   "}}})],
		["oversized name", body => ({...body, source: {...body.source, item: {...body.source.item, name: "x".repeat(201)}}})],
		["negative metadata", body => ({...body, source: {...body.source, item: {...body.source.item, weight: -1}}})],
		["string metadata", body => ({...body, source: {...body.source, item: {...body.source.item, weight: "1"}}})],
		["unsafe edition", body => ({...body, source: {...body.source, item: {...body.source.item, edition: "2014"}}})],
		["duplicate target", body => ({...body, targetCharacterIds: [body.targetCharacterIds[0], body.targetCharacterIds[0]]})],
		["no targets", body => ({...body, targetCharacterIds: []})],
		["too many targets", body => ({...body, targetCharacterIds: Array.from({length: 51}, () => crypto.randomUUID())})],
		["zero quantity", body => ({...body, quantity: 0})],
		["excess quantity", body => ({...body, quantity: 100_001})],
		["fractional quantity", body => ({...body, quantity: 1.5})],
		["string quantity", body => ({...body, quantity: "2"})],
		["oversized note", body => ({...body, note: "x".repeat(501)})],
	])("rejects invalid strict request bodies: %s", async (_label, fnMutate) => {
		const ctx = await pSetupRouteFixture();
		const response = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/item-awards`,
			headers: getHeaders(ctx.dm),
			payload: fnMutate(getValidBody([ctx.characters[0]])),
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({error: "INVALID_REQUEST"});
	});

	it("keeps the legacy route strict while accepting the safe legacy shape", async () => {
		const ctx = await pSetupRouteFixture();
		const url = `/api/campaigns/${ctx.campaign.id}/characters/${ctx.characters[0].id}/item-grants`;
		expect((await app.inject({
			method: "POST",
			url,
			headers: getHeaders(ctx.dm),
			payload: {item: {name: "Potion", source: "DMG"}, quantity: 2},
		})).statusCode).toBe(200);
		const rejected = await app.inject({
			method: "POST",
			url,
			headers: getHeaders(ctx.dm),
			payload: {item: {name: "Potion", source: "DMG", entries: ["arbitrary"]}, quantity: 2},
		});
		expect(rejected.statusCode).toBe(400);
		expect(rejected.json()).toEqual({error: "INVALID_REQUEST"});
	});
});
