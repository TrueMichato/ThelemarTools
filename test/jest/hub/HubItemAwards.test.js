import crypto from "node:crypto";

import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
import {createHubApp} from "../../../server/src/app.js";
import {
	addAwardedEntryToCharacter,
	addAwardedItemToCharacter,
	normalizeSafeItemSummary,
} from "../../../server/src/hub-actions.js";
import {
	createItemAwardAuthorityResolver,
	resolveItemAward,
} from "../../../server/src/item-award-catalog.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {getCharacterSheetSavedInventory} from "./item-award-test-utils.js";

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

async function pCreateStoreFixture ({
	fnResolveAwardItem = async ({item}) => structuredClone(item),
} = {}) {
	const store = new MemoryHubStore({fnResolveAwardItem});
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

async function pSaveCharacterInventoryThroughSheet ({store, accountId, character}) {
	const sessionId = crypto.randomUUID();
	const lease = await store.pAcquireCharacterLease({
		accountId,
		sessionId,
		characterId: character.id,
	});
	return (await store.pPatchCharacter({
		accountId,
		sessionId,
		characterId: character.id,
		baseRevision: character.revision,
		leaseEpoch: lease.epoch,
		patches: [{
			op: "replace",
			path: "/inventory",
			value: getCharacterSheetSavedInventory(character.data.inventory),
		}],
		idempotencyKey: crypto.randomUUID(),
	})).character;
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

	it("treats only deterministic Character Sheet aliases as stack-equivalent", () => {
		const canonicalItem = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			property: ["V"],
			reqAttune: true,
			charges: 5,
			bonusSavingThrow_str: "+1",
		};
		const sheetNormalizedItem = {
			...canonicalItem,
			typeCode: "M",
			properties: ["V"],
			requiresAttunement: true,
			shield: false,
			armor: false,
			weapon: true,
			chargesCurrent: 5,
			bonusSavingThrowStr: "+1",
			appliedUpgrades: [],
			socketedGemstones: [],
		};
		const merged = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: "stable-stack", item: sheetNormalizedItem, quantity: 1}],
				currency: {},
			},
			incoming: {item: canonicalItem, quantity: 2},
		});
		expect(merged.container.inventory).toEqual([
			expect.objectContaining({id: "stable-stack", item: sheetNormalizedItem, quantity: 3}),
		]);

		const armorCanonicalItem = {name: "Plate Armor", source: "PHB", type: "HA"};
		const armorSheetItem = {
			...armorCanonicalItem,
			typeCode: "HA",
			shield: false,
			armor: true,
			armorType: "heavy",
		};
		const armorMerged = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: "stable-armor-stack", item: armorSheetItem, quantity: 1}],
				currency: {},
			},
			incoming: {item: armorCanonicalItem, quantity: 1},
		});
		expect(armorMerged.container.inventory).toEqual([
			expect.objectContaining({id: "stable-armor-stack", item: armorSheetItem, quantity: 2}),
		]);

		for (const item of [
			{...sheetNormalizedItem, chargesCurrent: 4},
			{...sheetNormalizedItem, appliedUpgrades: [{name: "Keen", source: "TST"}]},
			{...sheetNormalizedItem, socketedGemstones: [{name: "Ruby", source: "TST"}]},
			{...sheetNormalizedItem, custom: {maker: "Rook"}},
			{...sheetNormalizedItem, weapon: false},
		]) {
			const distinct = addAwardedEntryToCharacter({
				container: {
					inventory: [{id: "canonical", item: canonicalItem, quantity: 1}],
					currency: {},
				},
				incoming: {item, quantity: 1},
			});
			expect(distinct.container.inventory).toHaveLength(2);
		}
	});

	it("upgrades a legacy summary stack without merging incompatible rich or custom metadata", () => {
		const legacyId = crypto.randomUUID();
		const authoritativeItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			type: "M",
			weight: 3,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			entries: ["Trusted catalog text"],
		};
		const upgraded = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: legacyId, item: {name: authoritativeItem.name, source: authoritativeItem.source}, quantity: 1}],
				currency: {},
			},
			incoming: {item: authoritativeItem, quantity: 2},
			isAllowLegacySummaryUpgrade: true,
		});
		expect(upgraded.container.inventory).toEqual([
			expect.objectContaining({id: legacyId, item: authoritativeItem, quantity: 3}),
		]);

		const incompatible = addAwardedEntryToCharacter({
			container: {
				inventory: [{
					id: "custom",
					item: {...authoritativeItem, custom: {maker: "Rook"}},
					quantity: 1,
				}],
				currency: {},
			},
			incoming: {item: authoritativeItem, quantity: 1},
		});
		expect(incompatible.container.inventory).toHaveLength(2);

		const incomingLegacySummary = addAwardedEntryToCharacter({
			container: {
				inventory: [{
					id: "custom",
					item: {...authoritativeItem, custom: {maker: "Rook"}},
					quantity: 1,
				}],
				currency: {},
			},
			incoming: {
				item: {
					name: authoritativeItem.name,
					source: authoritativeItem.source,
					weight: authoritativeItem.weight,
				},
				quantity: 2,
			},
		});
		expect(incomingLegacySummary.container.inventory).toHaveLength(2);
		expect(incomingLegacySummary.container.inventory[0]).toEqual(expect.objectContaining({
			id: "custom",
			quantity: 1,
			item: expect.objectContaining({custom: {maker: "Rook"}}),
		}));

		const incomingCustom = addAwardedEntryToCharacter({
			container: {
				inventory: [{
					id: legacyId,
					item: {
						name: authoritativeItem.name,
						source: authoritativeItem.source,
						typeCode: authoritativeItem.type,
					},
					quantity: 2,
				}],
				currency: {},
			},
			incoming: {
				item: {...authoritativeItem, _isCustom: true, custom: {maker: "Rook"}},
				quantity: 1,
			},
			isAllowLegacySummaryUpgrade: true,
		});
		expect(incomingCustom.container.inventory).toHaveLength(2);
		expect(incomingCustom.container.inventory[0]).toEqual(expect.objectContaining({
			id: legacyId,
			quantity: 2,
			item: expect.not.objectContaining({custom: expect.anything()}),
		}));
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
				actorCommandId: "award-order",
				index: 0,
				targetCount: 2,
				sourceKind: "recent",
				note: "For the road",
				entry: {id: existing.id, item: {name: "Potion", source: "DMG", rarity: "common"}, quantity: 3},
				characterNameSnapshot: expect.any(Object),
			},
		});
		const dmGrant = (await ctx.store.pListVisibleEvents({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		})).find(event => event.type === "item.granted" && event.payload?.awardId === result.awardId);
		const playerGrant = (await ctx.store.pListVisibleEvents({
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
		})).find(event => event.type === "item.granted" && event.payload?.awardId === result.awardId);
		expect(dmGrant.payload.actorCommandId).toBe("award-order");
		expect(playerGrant.payload).not.toHaveProperty("actorCommandId");
	});

	it("persists trusted campaign-item metadata while keeping command and event summaries bounded", async () => {
		const ctx = await pCreateStoreFixture({fnResolveAwardItem: resolveItemAward});
		const authoritativeItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			page: 42,
			edition: "classic",
			type: "M",
			rarity: "rare",
			weight: 3,
			value: 25000,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			weapon: true,
			bonusWeapon: "+1",
			entries: ["A synthetic metadata-rich weapon used only by this regression."],
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
			_baseSource: "TST",
		};
		const brewId = crypto.randomUUID();
		ctx.store._brewVersions.set(brewId, {
			id: brewId,
			campaignId: ctx.campaign.id,
			version: 1,
			contentHash: crypto.createHash("sha256").update(JSON.stringify(authoritativeItem)).digest("hex"),
			content: [{body: {item: [authoritativeItem]}}],
			manifest: [],
			createdAt: new Date().toISOString(),
		});
		ctx.store._campaigns.get(ctx.campaign.id).activeBrewBundleVersionId = brewId;
		const directTarget = await ctx.pCreateCharacter(ctx.accounts.playerA, "Direct target");

		const result = await ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {
				kind: "campaign_item",
				item: {
					name: authoritativeItem.name,
					source: authoritativeItem.source,
					page: authoritativeItem.page,
					edition: authoritativeItem.edition,
					typeCode: "G",
					rarity: "common",
					weight: 0,
					value: 0,
				},
			},
			targetCharacterIds: [ctx.characterA.id, ctx.characterB.id],
			quantity: 2,
			note: "Regression",
			idempotencyKey: "award-rich-campaign-item",
		});

		for (const characterId of [ctx.characterA.id, ctx.characterB.id]) {
			expect(ctx.store._characters.get(characterId).data.inventory).toEqual([
				expect.objectContaining({
					item: authoritativeItem,
					quantity: 2,
				}),
			]);
		}
		expect(result.source.item).toEqual({
			name: authoritativeItem.name,
			source: authoritativeItem.source,
			page: authoritativeItem.page,
			rarity: authoritativeItem.rarity,
			weight: authoritativeItem.weight,
			value: authoritativeItem.value,
			typeCode: authoritativeItem.type,
			edition: authoritativeItem.edition,
		});
		const audit = ctx.store.getAuditEntries().find(entry =>
			entry.action === "item.award_batch"
			&& entry.details?.awardId === result.awardId);
		expect(audit.details.item).toEqual(result.source.item);
		for (const event of ctx.store.getDomainEvents().filter(event => event.payload?.awardId === result.awardId && event.type === "item.granted")) {
			expect(event.payload.entry.item).toEqual(result.source.item);
			expect(event.payload.entry.item).not.toHaveProperty("entries");
			expect(event.payload.entry.item).not.toHaveProperty("effects");
			expect(event.payload.entry.item).not.toHaveProperty("_baseSource");
		}

		const direct = await ctx.store.pGrantItem({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			characterId: directTarget.id,
			item: {name: authoritativeItem.name, source: authoritativeItem.source},
			quantity: 1,
			idempotencyKey: "grant-rich-campaign-item",
		});
		expect(direct.entry.item).toEqual(authoritativeItem);
		expect(ctx.store._characters.get(directTarget.id).data.inventory).toEqual([
			expect.objectContaining({item: authoritativeItem, quantity: 1}),
		]);
		const repeatedDirect = await ctx.store.pGrantItem({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			characterId: directTarget.id,
			item: {name: authoritativeItem.name, source: authoritativeItem.source},
			quantity: 1,
			idempotencyKey: "grant-rich-campaign-item-again",
		});
		expect(ctx.store._characters.get(directTarget.id).data.inventory).toEqual([
			expect.objectContaining({id: direct.entry.id, item: authoritativeItem, quantity: 1}),
			expect.objectContaining({id: repeatedDirect.entry.id, item: authoritativeItem, quantity: 1}),
		]);
		expect(repeatedDirect.entry.id).not.toBe(direct.entry.id);
		const directEvent = ctx.store.getDomainEvents().find(event =>
			event.type === "item.granted"
			&& event.aggregateId === directTarget.id);
		expect(directEvent.payload.entry.item).toEqual({
			name: authoritativeItem.name,
			source: authoritativeItem.source,
			page: authoritativeItem.page,
			rarity: authoritativeItem.rarity,
			weight: authoritativeItem.weight,
			value: authoritativeItem.value,
			typeCode: authoritativeItem.type,
			edition: authoritativeItem.edition,
		});
	});

	it("rejects ambiguous recent authority and records the exact catalog authority on success", async () => {
		const officialItem = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
			value: 1500,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			entries: ["Official site metadata."],
		};
		const campaignCollision = {
			...officialItem,
			type: "G",
			weight: 99,
			entries: ["Colliding campaign metadata."],
			effects: [{type: "skillBonus", skill: "arcana", value: 99}],
		};
		const ctx = await pCreateStoreFixture({
			fnResolveAwardItem: createItemAwardAuthorityResolver({
				fnLoadSiteItems: async () => new Map([["longsword|phb", officialItem]]),
			}),
		});
		const brewId = crypto.randomUUID();
		ctx.store._brewVersions.set(brewId, {
			id: brewId,
			campaignId: ctx.campaign.id,
			version: 1,
			contentHash: crypto.createHash("sha256").update(JSON.stringify(campaignCollision)).digest("hex"),
			content: [{body: {item: [campaignCollision]}}],
			manifest: [],
			createdAt: new Date().toISOString(),
		});
		ctx.store._campaigns.get(ctx.campaign.id).activeBrewBundleVersionId = brewId;
		const beforeCharacter = structuredClone(ctx.store._characters.get(ctx.characterA.id));
		const beforeEvents = ctx.store.getDomainEvents().length;
		const beforeAudits = ctx.store.getAuditEntries().length;

		await expect(ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "recent", item: {name: officialItem.name, source: officialItem.source}},
			targetCharacterIds: [ctx.characterA.id],
			quantity: 1,
			idempotencyKey: "ambiguous-recent-authority",
		})).rejects.toMatchObject({
			code: "ITEM_AWARD_SOURCE_INVALID",
			status: 409,
		});
		expect(ctx.store._characters.get(ctx.characterA.id)).toEqual(beforeCharacter);
		expect(ctx.store.getDomainEvents()).toHaveLength(beforeEvents);
		expect(ctx.store.getAuditEntries()).toHaveLength(beforeAudits);

		const awarded = await ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: officialItem.name, source: officialItem.source}},
			targetCharacterIds: [ctx.characterA.id],
			quantity: 1,
			idempotencyKey: "explicit-site-authority",
		});
		expect(ctx.store._characters.get(ctx.characterA.id).data.inventory).toEqual([
			expect.objectContaining({item: officialItem, quantity: 1}),
		]);
		const grant = ctx.store.getDomainEvents()
			.find(event => event.type === "item.granted" && event.payload.awardId === awarded.awardId);
		expect(grant.payload).toEqual(expect.objectContaining({
			sourceKind: "catalog",
			entry: expect.objectContaining({
				item: expect.objectContaining({
					name: officialItem.name,
					source: officialItem.source,
					typeCode: officialItem.type,
					weight: officialItem.weight,
				}),
			}),
		}));
		expect(grant.payload.entry.item).not.toHaveProperty("entries");
		expect(grant.payload.entry.item).not.toHaveProperty("effects");
		const audit = ctx.store.getAuditEntries()
			.find(entry => entry.action === "item.award_batch" && entry.details.awardId === awarded.awardId);
		expect(audit.details.sourceKind).toBe("catalog");

		ctx.store._campaigns.get(ctx.campaign.id).activeBrewBundleVersionId = null;
		const recent = await ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "recent", item: {name: officialItem.name, source: officialItem.source}},
			targetCharacterIds: [ctx.characterA.id],
			quantity: 1,
			idempotencyKey: "unambiguous-recent-site-authority",
		});
		const recentGrant = ctx.store.getDomainEvents()
			.find(event => event.type === "item.granted" && event.payload.awardId === recent.awardId);
		expect(recentGrant.payload.sourceKind).toBe("catalog");
		expect(recent.source.kind).toBe("recent");
	});

	it("rejects an unprojectable authoritative item before mutating or consuming idempotency", async () => {
		const invalidItem = {
			name: "Longsword",
			source: "PHB",
			type: "W",
			rarity: "x".repeat(81),
			entries: ["Trusted content whose summary is outside the command/event contract."],
		};
		const ctx = await pCreateStoreFixture({
			fnResolveAwardItem: async () => structuredClone(invalidItem),
		});
		const target = await ctx.pCreateCharacter(ctx.accounts.playerA, "Invalid summary target");
		const auditCount = ctx.store.getAuditEntries().length;
		const eventCount = ctx.store.getDomainEvents().length;
		const receiptCount = ctx.store._commandReceipts.size;
		const input = {
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			characterId: target.id,
			item: {name: invalidItem.name, source: invalidItem.source},
			quantity: 1,
			idempotencyKey: "invalid-authoritative-summary",
		};

		await expect(ctx.store.pGrantItem(input)).rejects.toMatchObject({code: "ITEM_AWARD_INVALID"});
		await expect(ctx.store.pGrantItem(input)).rejects.toMatchObject({code: "ITEM_AWARD_INVALID"});
		expect(ctx.store._characters.get(target.id).data.inventory).toEqual([]);
		expect(ctx.store.getAuditEntries()).toHaveLength(auditCount);
		expect(ctx.store.getDomainEvents()).toHaveLength(eventCount);
		expect(ctx.store._commandReceipts.size).toBe(receiptCount);
	});

	it("preserves one stack identity through sheet save, repeat award, direct transfer, and stash return", async () => {
		const authoritativeItem = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			rarity: "rare",
			weight: 3,
			value: 25000,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			weapon: true,
			entries: ["A synthetic metadata-rich weapon used only by this regression."],
			hasRefs: true,
			additionalSources: [{source: "XGE", page: 79}],
			custom: {provenance: "synthetic-catalog"},
		};
		const ctx = await pCreateStoreFixture({
			fnResolveAwardItem: async () => structuredClone(authoritativeItem),
		});
		const pAward = ({characterId, quantity, key}) => ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: authoritativeItem.name, source: authoritativeItem.source}},
			targetCharacterIds: [characterId],
			quantity,
			idempotencyKey: key,
		});
		const firstA = await pAward({characterId: ctx.characterA.id, quantity: 1, key: "sheet-stack-a-first"});
		const firstB = await pAward({characterId: ctx.characterB.id, quantity: 1, key: "sheet-stack-b-first"});
		const stackAId = firstA.targets[0].entryId;
		const stackBId = firstB.targets[0].entryId;

		let characterA = structuredClone(ctx.store._characters.get(ctx.characterA.id));
		characterA = await pSaveCharacterInventoryThroughSheet({
			store: ctx.store,
			accountId: ctx.accounts.playerA.id,
			character: characterA,
		});
		const normalizedItem = characterA.data.inventory[0].item;
		expect(normalizedItem).toEqual(expect.objectContaining({
			...authoritativeItem,
			typeCode: authoritativeItem.type,
			properties: authoritativeItem.property,
			shield: false,
			armor: false,
			appliedUpgrades: [],
			socketedGemstones: [],
		}));

		const repeated = await pAward({characterId: ctx.characterA.id, quantity: 2, key: "sheet-stack-a-repeat"});
		expect(repeated.targets[0]).toEqual(expect.objectContaining({entryId: stackAId, quantity: 2}));
		characterA = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: ctx.characterA.id,
		})).character;
		expect(characterA.data.inventory).toEqual([
			expect.objectContaining({id: stackAId, item: normalizedItem, quantity: 3}),
		]);

		const direct = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.characterA.id,
			targetKind: "character",
			targetId: ctx.characterB.id,
			payload: {items: [{entryId: stackAId, quantity: 1}]},
			idempotencyKey: "sheet-stack-direct",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
			transferId: direct.transfer.id,
			decision: "accept",
			idempotencyKey: "sheet-stack-direct-accept",
		});
		let characterB = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerB.id,
			characterId: ctx.characterB.id,
		})).character;
		expect(characterB.data.inventory).toEqual([
			expect.objectContaining({id: stackBId, item: authoritativeItem, quantity: 2}),
		]);

		const returned = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.characterB.id,
			targetKind: "character",
			targetId: ctx.characterA.id,
			payload: {items: [{entryId: stackBId, quantity: 1}]},
			idempotencyKey: "sheet-stack-return",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			transferId: returned.transfer.id,
			decision: "accept",
			idempotencyKey: "sheet-stack-return-accept",
		});
		characterA = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: ctx.characterA.id,
		})).character;
		expect(characterA.data.inventory).toEqual([
			expect.objectContaining({id: stackAId, item: normalizedItem, quantity: 3}),
		]);

		const party = await ctx.store.pGetPartyInventory({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		});
		const deposit = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.characterA.id,
			targetKind: "party_inventory",
			targetId: party.id,
			payload: {items: [{entryId: stackAId, quantity: 1}]},
			idempotencyKey: "sheet-stack-deposit",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			transferId: deposit.transfer.id,
			decision: "accept",
			idempotencyKey: "sheet-stack-deposit-accept",
		});
		const stashed = (await ctx.store.pGetPartyInventory({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		})).inventory[0];
		const withdraw = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			sourceKind: "party_inventory",
			sourceId: party.id,
			targetKind: "character",
			targetId: ctx.characterA.id,
			payload: {items: [{entryId: stashed.id, quantity: 1}]},
			idempotencyKey: "sheet-stack-withdraw",
		});
		expect(withdraw.transfer.status).toBe("committed");
		characterA = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: ctx.characterA.id,
		})).character;
		expect(characterA.data.inventory).toEqual([
			expect.objectContaining({id: stackAId, item: normalizedItem, quantity: 3}),
		]);
	});

	it("conserves newly awarded metadata through accepted, rejected, cancelled, and stash transfers", async () => {
		const ctx = await pCreateStoreFixture({fnResolveAwardItem: resolveItemAward});
		const authoritativeItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			page: 42,
			edition: "classic",
			type: "M",
			rarity: "rare",
			weight: 3,
			value: 25000,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			weapon: true,
			bonusWeapon: "+1",
			entries: ["A synthetic metadata-rich weapon used only by this regression."],
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
			_baseSource: "TST",
		};
		const brewId = crypto.randomUUID();
		ctx.store._brewVersions.set(brewId, {
			id: brewId,
			campaignId: ctx.campaign.id,
			version: 1,
			contentHash: crypto.createHash("sha256").update(JSON.stringify(authoritativeItem)).digest("hex"),
			content: [{body: {item: [authoritativeItem]}}],
			manifest: [],
			createdAt: new Date().toISOString(),
		});
		ctx.store._campaigns.get(ctx.campaign.id).activeBrewBundleVersionId = brewId;

		const award = await ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "campaign_item", item: {name: authoritativeItem.name, source: authoritativeItem.source}},
			targetCharacterIds: [ctx.characterA.id],
			quantity: 8,
			idempotencyKey: "award-transfer-lifecycle",
		});
		const awardedEntryId = award.targets[0].entryId;
		const getCharacterEntry = accountId => ctx.store.pGetCharacter({
			accountId,
			characterId: accountId === ctx.accounts.playerA.id ? ctx.characterA.id : ctx.characterB.id,
		}).then(({character}) => character.data.inventory.find(entry => entry.item.name === authoritativeItem.name));

		const directInput = {
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.characterA.id,
			targetKind: "character",
			targetId: ctx.characterB.id,
			payload: {items: [{entryId: awardedEntryId, quantity: 1}]},
			idempotencyKey: "award-transfer-direct",
		};
		const direct = await ctx.store.pProposeTransfer(directInput);
		await expect(ctx.store.pProposeTransfer(directInput)).resolves.toEqual(direct);
		expect(direct.transfer.payload.escrow.items[0]).toEqual(expect.objectContaining({
			id: awardedEntryId,
			item: authoritativeItem,
			quantity: 1,
		}));
		const acceptDirectInput = {
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
			transferId: direct.transfer.id,
			decision: "accept",
			idempotencyKey: "award-transfer-direct-accept",
		};
		const acceptedDirect = await ctx.store.pResolveTransfer(acceptDirectInput);
		await expect(ctx.store.pResolveTransfer(acceptDirectInput)).resolves.toEqual(acceptedDirect);
		expect(await getCharacterEntry(ctx.accounts.playerB.id)).toEqual(expect.objectContaining({
			item: authoritativeItem,
			quantity: 1,
		}));

		const party = await ctx.store.pGetPartyInventory({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		});
		const deposit = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.characterA.id,
			targetKind: "party_inventory",
			targetId: party.id,
			payload: {items: [{entryId: awardedEntryId, quantity: 2}]},
			idempotencyKey: "award-transfer-deposit",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			transferId: deposit.transfer.id,
			decision: "accept",
			idempotencyKey: "award-transfer-deposit-accept",
		});
		const stashed = (await ctx.store.pGetPartyInventory({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		})).inventory.find(entry => entry.item.name === authoritativeItem.name);
		expect(stashed).toEqual(expect.objectContaining({item: authoritativeItem, quantity: 2}));

		const withdraw = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			sourceKind: "party_inventory",
			sourceId: party.id,
			targetKind: "character",
			targetId: ctx.characterB.id,
			payload: {items: [{entryId: stashed.id, quantity: 1}]},
			idempotencyKey: "award-transfer-withdraw",
		});
		expect(withdraw.transfer.status).toBe("committed");
		expect(await getCharacterEntry(ctx.accounts.playerB.id)).toEqual(expect.objectContaining({
			item: authoritativeItem,
			quantity: 2,
		}));

		const assertRestoredAfterReject = async ({key, accountId}) => {
			const before = await getCharacterEntry(ctx.accounts.playerA.id);
			const proposed = await ctx.store.pProposeTransfer({
				accountId: ctx.accounts.playerA.id,
				campaignId: ctx.campaign.id,
				sourceKind: "character",
				sourceId: ctx.characterA.id,
				targetKind: "character",
				targetId: ctx.characterB.id,
				payload: {items: [{entryId: awardedEntryId, quantity: 1}]},
				idempotencyKey: `${key}-propose`,
			});
			const resolveInput = {
				accountId,
				campaignId: ctx.campaign.id,
				transferId: proposed.transfer.id,
				decision: "reject",
				idempotencyKey: `${key}-resolve`,
			};
			const resolved = await ctx.store.pResolveTransfer(resolveInput);
			await expect(ctx.store.pResolveTransfer(resolveInput)).resolves.toEqual(resolved);
			expect(await getCharacterEntry(ctx.accounts.playerA.id)).toEqual(before);
		};
		await assertRestoredAfterReject({key: "award-transfer-reject", accountId: ctx.accounts.playerB.id});
		await assertRestoredAfterReject({key: "award-transfer-cancel", accountId: ctx.accounts.playerA.id});
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

	it("rechecks the active rules version after asynchronous authoritative resolution", async () => {
		let fnMarkResolutionStarted;
		let fnReleaseResolution;
		const resolutionStarted = new Promise(resolve => fnMarkResolutionStarted = resolve);
		const resolutionGate = new Promise(resolve => fnReleaseResolution = resolve);
		const ctx = await pCreateStoreFixture({
			fnResolveAwardItem: async ({item}) => {
				fnMarkResolutionStarted();
				await resolutionGate;
				return {...structuredClone(item), type: "G"};
			},
		});
		const before = structuredClone(ctx.store._characters.get(ctx.characterA.id));
		const pending = ctx.store.pAwardItems({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			source: {kind: "catalog", item: {name: "Torch", source: "PHB"}},
			targetCharacterIds: [ctx.characterA.id],
			quantity: 1,
			idempotencyKey: "award-rules-race",
		});
		await resolutionStarted;

		const policy = createDefaultCampaignRulesPolicy();
		policy.rules.find(rule => rule.id === "content.sources.allowed").parameters.sources = ["DMG"];
		await ctx.store.pCreateAndActivateRulesPolicy({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			policy,
			expectedActiveRulesVersionId: null,
			idempotencyKey: "award-rules-race-policy",
		});
		fnReleaseResolution();

		await expect(pending).rejects.toMatchObject({code: "RULES_VERSION_STALE", status: 409});
		expect(ctx.store._characters.get(ctx.characterA.id)).toEqual(before);
		expect(ctx.store.getDomainEvents().filter(event => event.type === "item.granted")).toHaveLength(0);
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

	it("keeps multiple restored escrow stacks beside their metadata-diverged same-ID source rows", async () => {
		const ctx = await pCreateStoreFixture();
		const stackId = crypto.randomUUID();
		const secondStackId = crypto.randomUUID();
		const originalItem = {
			name: "Arrow",
			source: "PHB",
			_fromPack: "Wayfarer's Kit|PHB",
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
			charges: 7,
			chargesCurrent: 5,
			material: {name: "Dragonbone", source: "PHB", role: "strikingSurface"},
			appliedUpgrades: [{name: "Balanced", source: "PHB"}],
			socketedGemstones: [{name: "Journey", source: "PHB"}],
			custom: {maker: "Rook", batch: "original"},
		};
		const secondOriginalItem = {
			...structuredClone(originalItem),
			name: "Bolt",
			_fromPack: "Ranger's Kit|PHB",
			effects: [{type: "skillBonus", skill: "survival", value: 1}],
			charges: 9,
			chargesCurrent: 6,
			custom: {maker: "Rook", batch: "second-original"},
		};
		const source = await ctx.pCreateCharacter(ctx.accounts.playerA, "Escrow source", [
			{id: "before", item: {name: "Club", source: "PHB"}, quantity: 1},
			{
				id: stackId,
				item: originalItem,
				quantity: 4,
				note: "Original commission",
				customState: {privacy: "owner-only"},
			},
			{
				id: secondStackId,
				item: secondOriginalItem,
				quantity: 6,
				note: "Second commission",
				customState: {privacy: "owner-only"},
			},
			{id: "after", item: {name: "Dagger", source: "PHB"}, quantity: 1},
		]);
		const reserved = await ctx.store.pProposeTransfer({
			accountId: ctx.accounts.playerA.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: ctx.characterB.id,
			payload: {
				items: [
					{entryId: stackId, quantity: 2},
					{entryId: secondStackId, quantity: 3},
				],
			},
			idempotencyKey: "metadata-restore-reserve",
		});
		expect(reserved.transfer.status).toBe("reserved");

		const afterReserve = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: source.id,
		})).character;
		const modifiedItem = {
			...structuredClone(originalItem),
			_fromPack: "Reforged Kit|PHB",
			effects: [{type: "skillBonus", skill: "arcana", value: 2}],
			chargesCurrent: 1,
			material: {name: "Star Iron", source: "PHB", role: "strikingSurface"},
			appliedUpgrades: [{name: "Keen", source: "PHB"}],
			socketedGemstones: [{name: "Ember", source: "PHB"}],
			custom: {maker: "Vale", batch: "modified"},
		};
		const secondModifiedItem = {
			...structuredClone(secondOriginalItem),
			_fromPack: "Reforged Ranger's Kit|PHB",
			effects: [{type: "skillBonus", skill: "stealth", value: 2}],
			chargesCurrent: 2,
			material: {name: "Moon Silver", source: "PHB", role: "strikingSurface"},
			appliedUpgrades: [{name: "Keen", source: "PHB"}],
			socketedGemstones: [{name: "Frost", source: "PHB"}],
			custom: {maker: "Vale", batch: "second-modified"},
		};
		const currentStack = afterReserve.data.inventory.find(entry => entry.id === stackId);
		currentStack.item = modifiedItem;
		currentStack.note = "Reworked commission";
		currentStack.customState = {privacy: "shared"};
		const currentSecondStack = afterReserve.data.inventory.find(entry => entry.id === secondStackId);
		currentSecondStack.item = secondModifiedItem;
		currentSecondStack.note = "Second reworked commission";
		currentSecondStack.customState = {privacy: "shared"};
		await pSaveCharacterInventoryThroughSheet({
			store: ctx.store,
			accountId: ctx.accounts.playerA.id,
			character: afterReserve,
		});

		await ctx.store.pResolveTransfer({
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
			transferId: reserved.transfer.id,
			decision: "reject",
			idempotencyKey: "metadata-restore-reject",
		});
		const restored = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: source.id,
		})).character.data.inventory;
		const modified = restored.find(entry => entry.id === stackId);
		const secondModified = restored.find(entry => entry.id === secondStackId);
		const original = restored.find(entry => entry.item.custom?.batch === "original");
		const secondOriginal = restored.find(entry => entry.item.custom?.batch === "second-original");
		const restoredId = original?.id;
		const secondRestoredId = secondOriginal?.id;

		expect(restored.map(entry => entry.id)).toEqual([
			"before",
			restoredId,
			stackId,
			secondRestoredId,
			secondStackId,
			"after",
		]);
		expect(new Set(restored.map(entry => entry.id)).size).toBe(restored.length);
		expect(modified).toEqual(expect.objectContaining({
			item: expect.objectContaining(modifiedItem),
			quantity: 2,
			note: "Reworked commission",
			customState: {privacy: "shared"},
		}));
		expect(original).toEqual(expect.objectContaining({
			item: expect.objectContaining(originalItem),
			quantity: 2,
			note: "Original commission",
			customState: {privacy: "owner-only"},
		}));
		expect(secondModified).toEqual(expect.objectContaining({
			item: expect.objectContaining(secondModifiedItem),
			quantity: 3,
			note: "Second reworked commission",
			customState: {privacy: "shared"},
		}));
		expect(secondOriginal).toEqual(expect.objectContaining({
			item: expect.objectContaining(secondOriginalItem),
			quantity: 3,
			note: "Second commission",
			customState: {privacy: "owner-only"},
		}));
		expect(restoredId).not.toBe(stackId);
		expect(secondRestoredId).not.toBe(secondStackId);
		expect(modified.quantity + original.quantity).toBe(4);
		expect(secondModified.quantity + secondOriginal.quantity).toBe(6);
	});

	it("restores independently reserved whole stacks in original order during lifecycle cancellation", async () => {
		const ctx = await pCreateStoreFixture();
		const entryIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		const source = await ctx.pCreateCharacter(ctx.accounts.playerA, "Lifecycle source", [
			{
				id: entryIds[0],
				item: {
					name: "First",
					source: "PHB",
					charges: 5,
					chargesCurrent: 4,
					material: {name: "Star Iron", source: "PHB"},
					custom: {batch: "first"},
				},
				quantity: 1,
				note: "First original",
				customState: {privacy: "owner-only"},
			},
			{
				id: entryIds[1],
				item: {
					name: "Second",
					source: "PHB",
					charges: 7,
					chargesCurrent: 3,
					material: {name: "Dragonbone", source: "PHB"},
					custom: {batch: "second"},
				},
				quantity: 1,
				note: "Second original",
				customState: {privacy: "owner-only"},
			},
			{id: entryIds[2], item: {name: "Third", source: "PHB"}, quantity: 1},
		]);
		const originalInventory = structuredClone((await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: source.id,
		})).character.data.inventory);
		const reservations = [];
		for (const [index, entryId] of entryIds.slice(0, 2).entries()) {
			const response = await ctx.store.pProposeTransfer({
				accountId: ctx.accounts.playerA.id,
				campaignId: ctx.campaign.id,
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId: ctx.characterB.id,
				payload: {items: [{entryId, quantity: 1}]},
				idempotencyKey: `lifecycle-order-reserve-${index}`,
			});
			expect(response.transfer.status).toBe("reserved");
			expect(response.transfer).not.toHaveProperty("_sourceRevision");
			reservations.push(response.transfer);
		}
		expect((await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: source.id,
		})).character.data.inventory.map(entry => entry.id)).toEqual([entryIds[2]]);

		const targetMembership = await ctx.store.pGetMembership({
			accountId: ctx.accounts.playerB.id,
			campaignId: ctx.campaign.id,
		});
		await ctx.store.pChangeMemberRole({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
			membershipId: targetMembership.id,
			role: "spectator",
			idempotencyKey: "lifecycle-order-spectator",
		});

		const restored = (await ctx.store.pGetCharacter({
			accountId: ctx.accounts.playerA.id,
			characterId: source.id,
		})).character.data.inventory;
		expect(restored).toEqual(originalInventory);
		expect(restored.map(entry => entry.id)).toEqual(entryIds);
		expect(restored.map(entry => entry.quantity)).toEqual([1, 1, 1]);
		const cancellationEvents = (await ctx.store.pListVisibleEvents({
			accountId: ctx.accounts.dm.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "transfer.cancelled");
		expect(cancellationEvents.slice(-2).map(event => event.aggregateId))
			.toEqual([reservations[1].id, reservations[0].id]);
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
		store = new MemoryHubStore({fnResolveAwardItem: async ({item}) => structuredClone(item)});
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
