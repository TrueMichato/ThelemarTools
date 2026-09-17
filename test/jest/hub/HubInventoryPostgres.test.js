import crypto from "node:crypto";
import pg from "pg";

import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {getCharacterSheetSavedInventory} from "./item-award-test-utils.js";

const {Pool} = pg;
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;
const RICH_CATALOG_ITEM = Object.freeze({
	name: "Moonsteel Longsword",
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
	_baseSource: "PHB",
});

describePostgres("Campaign Hub inventory transfers (real PostgreSQL)", () => {
	let pool;
	let store;
	let dm;
	let sourceOwner;
	let targetOwner;
	let observer;
	let campaign;
	let sourceCharacter;
	let targetCharacter;
	let partyInventory;
	const prefix = `inventory-pg-${process.pid}-${Date.now()}`;

	async function pCreateAccount (label) {
		return store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `${prefix}-${label}`,
			displayName: label,
		});
	}

	async function pJoinSpecificCampaign ({owner, targetCampaign, account}) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: owner.id,
			campaignId: targetCampaign.id,
			role: "player",
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		return (await store.pRedeemInvite({
			accountId: account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		})).membership;
	}

	async function pJoinCampaign (account) {
		return pJoinSpecificCampaign({
			owner: dm,
			targetCampaign: campaign,
			account,
		});
	}

	async function pReadCharacter (accountId, characterId) {
		return (await store.pGetCharacter({accountId, characterId})).character;
	}

	async function pSaveCharacterInventoryThroughSheet ({accountId, character}) {
		const inventory = getCharacterSheetSavedInventory(character.data.inventory);
		const session = await store.pCreateSession({
			accountId,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const sessionId = session.id;
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
				value: inventory,
			}],
			idempotencyKey: crypto.randomUUID(),
		})).character;
	}

	async function pCreateTargetCharacter (label, inventory = []) {
		return (await store.pCreateCharacter({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			data: {name: label, inventory, currency: {}, carry: {schemaVersion: 1, status: "known"}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
	}

	async function pSeedPartyItem ({name, quantity, item = null, entryMetadata = {}}) {
		const donorEntryId = crypto.randomUUID();
		const seededItem = structuredClone(item || {name, source: "PHB", weight: 0.1});
		const donor = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: `${name} donor`,
				inventory: [{
					id: donorEntryId,
					item: seededItem,
					quantity,
					...entryMetadata,
				}],
				currency: {},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const currentParty = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		const transfer = await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: donor.id,
			targetKind: "party_inventory",
			targetId: currentParty.id,
			payload: {items: [{entryId: donorEntryId, quantity}]},
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: transfer.transfer.id,
			decision: "accept",
			idempotencyKey: crypto.randomUUID(),
		});
		const seeded = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		return {party: seeded, entry: seeded.inventory.find(entry => entry.item.name === seededItem.name)};
	}

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 6,
		});
		store = new PostgresHubStore({
			pool,
			fnResolveAwardItem: async ({item, sourceKind}) => ({
				sourceKind: sourceKind === "recent" ? "catalog" : sourceKind,
				authoritativeItem: `${item?.name}|${item?.source}`.toLowerCase() === "moonsteel longsword|phb"
					? structuredClone(RICH_CATALOG_ITEM)
					: structuredClone(item),
			}),
		});
		await store.pCheckHealth();

		dm = await pCreateAccount("Inventory DM");
		sourceOwner = await pCreateAccount("Inventory Source");
		targetOwner = await pCreateAccount("Inventory Target");
		observer = await pCreateAccount("Inventory Observer");
		campaign = (await store.pCreateCampaign({
			accountId: dm.id,
			name: `${prefix} campaign`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		await pJoinCampaign(sourceOwner);
		await pJoinCampaign(targetOwner);
		await pJoinCampaign(observer);

		sourceCharacter = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: "Source",
				inventory: [
					{id: "maps", item: {name: "Map", source: "PHB", weight: 0.1}, quantity: 4, note: "Secret route"},
					{id: "linked", item: {name: "Linked Focus", source: "PHB"}, quantity: 1, equipped: true},
					{id: "flour", item: {name: "Flour", source: "PHB"}, quantity: 0.6667},
				],
				currency: {},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		targetCharacter = (await store.pCreateCharacter({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			data: {
				name: "Target",
				inventory: [{id: "public-map", item: {name: "Map", source: "PHB", weight: 0.1}, quantity: 1, note: "Public route"}],
				currency: {},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		partyInventory = await store.pGetPartyInventory({accountId: sourceOwner.id, campaignId: campaign.id});
	});

	afterAll(async () => {
		await pool?.end();
	});

	test("persists resolved catalog metadata while keeping the durable grant event bounded", async () => {
		const legacyEntryId = crypto.randomUUID();
		const target = await pCreateTargetCharacter(`${prefix} rich award`, [{
			id: legacyEntryId,
			item: {
				name: RICH_CATALOG_ITEM.name,
				source: RICH_CATALOG_ITEM.source,
				typeCode: RICH_CATALOG_ITEM.type,
			},
			quantity: 1,
		}]);
		const result = await store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {
				kind: "catalog",
				item: {
					name: RICH_CATALOG_ITEM.name,
					source: RICH_CATALOG_ITEM.source,
					typeCode: "G",
					rarity: "common",
					weight: 0,
					value: 0,
				},
			},
			targetCharacterIds: [target.id],
			quantity: 2,
			idempotencyKey: `${prefix}-rich-award`,
		});

		const persisted = await pReadCharacter(targetOwner.id, target.id);
		expect(persisted.data.inventory).toEqual([
			expect.objectContaining({id: legacyEntryId, item: RICH_CATALOG_ITEM, quantity: 3}),
		]);
		expect(result.targets[0].entryId).toBe(legacyEntryId);
		expect(result.source.item).toEqual({
			name: RICH_CATALOG_ITEM.name,
			source: RICH_CATALOG_ITEM.source,
			rarity: RICH_CATALOG_ITEM.rarity,
			weight: RICH_CATALOG_ITEM.weight,
			value: RICH_CATALOG_ITEM.value,
			typeCode: RICH_CATALOG_ITEM.type,
		});
		const event = (await pool.query(`
			SELECT payload
			FROM hub.domain_events
			WHERE event_type = 'item.granted' AND payload->>'awardId' = $1
		`, [result.awardId])).rows[0];
		expect(event.payload.entry.item).toEqual({
			name: RICH_CATALOG_ITEM.name,
			source: RICH_CATALOG_ITEM.source,
			rarity: RICH_CATALOG_ITEM.rarity,
			weight: RICH_CATALOG_ITEM.weight,
			value: RICH_CATALOG_ITEM.value,
			typeCode: RICH_CATALOG_ITEM.type,
		});
		expect(event.payload.entry.item).not.toHaveProperty("entries");
		expect(event.payload.entry.item).not.toHaveProperty("_baseSource");
		expect(event.payload.sourceKind).toBe("catalog");
		const audit = (await pool.query(`
			SELECT details
			FROM hub.audit_entries
			WHERE action = 'item.award_batch' AND details->>'awardId' = $1
		`, [result.awardId])).rows[0];
		expect(audit.details.item).toEqual(result.source.item);
		expect(audit.details.sourceKind).toBe("catalog");
	});

	test("records resolved catalog authority for an unambiguous Recent award", async () => {
		const target = await pCreateTargetCharacter(`${prefix} recent authority`);
		const result = await store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "recent", item: {name: RICH_CATALOG_ITEM.name, source: RICH_CATALOG_ITEM.source}},
			targetCharacterIds: [target.id],
			quantity: 1,
			idempotencyKey: `${prefix}-recent-authority`,
		});

		expect(result.source.kind).toBe("recent");
		const event = (await pool.query(`
			SELECT payload
			FROM hub.domain_events
			WHERE event_type = 'item.granted' AND payload->>'awardId' = $1
		`, [result.awardId])).rows[0];
		expect(event.payload.sourceKind).toBe("catalog");
		const audit = (await pool.query(`
			SELECT details
			FROM hub.audit_entries
			WHERE action = 'item.award_batch' AND details->>'awardId' = $1
		`, [result.awardId])).rows[0];
		expect(audit.details.sourceKind).toBe("catalog");
	});

	test("reuses the PostgreSQL stack identity after a sheet save and party-stash return", async () => {
		const target = await pCreateTargetCharacter(`${prefix} normalized stack`);
		const first = await store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "catalog", item: {name: RICH_CATALOG_ITEM.name, source: RICH_CATALOG_ITEM.source}},
			targetCharacterIds: [target.id],
			quantity: 1,
			idempotencyKey: `${prefix}-normalized-first`,
		});
		const stackId = first.targets[0].entryId;
		const saved = await pSaveCharacterInventoryThroughSheet({
			accountId: targetOwner.id,
			character: await pReadCharacter(targetOwner.id, target.id),
		});
		const normalizedItem = saved.data.inventory[0].item;
		expect(normalizedItem).toEqual(expect.objectContaining({
			...RICH_CATALOG_ITEM,
			typeCode: RICH_CATALOG_ITEM.type,
			properties: RICH_CATALOG_ITEM.property,
			shield: false,
			armor: false,
			appliedUpgrades: [],
			socketedGemstones: [],
		}));

		const repeated = await store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "catalog", item: {name: RICH_CATALOG_ITEM.name, source: RICH_CATALOG_ITEM.source}},
			targetCharacterIds: [target.id],
			quantity: 2,
			idempotencyKey: `${prefix}-normalized-repeat`,
		});
		expect(repeated.targets[0]).toEqual(expect.objectContaining({entryId: stackId, quantity: 2}));
		expect((await pReadCharacter(targetOwner.id, target.id)).data.inventory).toEqual([
			expect.objectContaining({id: stackId, item: normalizedItem, quantity: 3}),
		]);

		const party = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		const deposit = await store.pProposeTransfer({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: target.id,
			targetKind: "party_inventory",
			targetId: party.id,
			payload: {items: [{entryId: stackId, quantity: 1}]},
			idempotencyKey: `${prefix}-normalized-deposit`,
		});
		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: deposit.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-normalized-deposit-accept`,
		});
		const stashed = (await store.pGetPartyInventory({
			accountId: dm.id,
			campaignId: campaign.id,
		})).inventory.find(entry => entry.item.name === RICH_CATALOG_ITEM.name);
		const withdraw = await store.pProposeTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			sourceKind: "party_inventory",
			sourceId: party.id,
			targetKind: "character",
			targetId: target.id,
			payload: {items: [{entryId: stashed.id, quantity: 1}]},
			idempotencyKey: `${prefix}-normalized-withdraw`,
		});
		expect(withdraw.transfer.status).toBe("committed");

		const persisted = await pReadCharacter(targetOwner.id, target.id);
		expect(persisted.data.inventory).toEqual([
			expect.objectContaining({id: stackId, item: normalizedItem, quantity: 3}),
		]);
	});

	test("keeps an archived campaign mutation-closed while preserving idempotent replay", async () => {
		const archiveOwner = await pCreateAccount("Archive Owner");
		const archiveCampaign = (await store.pCreateCampaign({
			accountId: archiveOwner.id,
			name: `${prefix} archive fence`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const removedAccount = await pCreateAccount("Archive Removed");
		const leftAccount = await pCreateAccount("Archive Left");
		const retainedAccount = await pCreateAccount("Archive Retained");
		const retainedLeaver = await pCreateAccount("Archive Retained Leaver");
		const removedMembership = await pJoinSpecificCampaign({owner: archiveOwner, targetCampaign: archiveCampaign, account: removedAccount});
		await pJoinSpecificCampaign({owner: archiveOwner, targetCampaign: archiveCampaign, account: leftAccount});
		const retainedMembership = await pJoinSpecificCampaign({owner: archiveOwner, targetCampaign: archiveCampaign, account: retainedAccount});
		await pJoinSpecificCampaign({owner: archiveOwner, targetCampaign: archiveCampaign, account: retainedLeaver});
		const removeInput = {
			accountId: archiveOwner.id,
			campaignId: archiveCampaign.id,
			membershipId: removedMembership.id,
			idempotencyKey: crypto.randomUUID(),
		};
		const leaveInput = {
			accountId: leftAccount.id,
			campaignId: archiveCampaign.id,
			idempotencyKey: crypto.randomUUID(),
		};
		const removed = await store.pRemoveMember(removeInput);
		const left = await store.pLeaveCampaign(leaveInput);
		const archiveInput = {
			accountId: archiveOwner.id,
			campaignId: archiveCampaign.id,
			idempotencyKey: crypto.randomUUID(),
		};
		const archived = await store.pArchiveCampaign(archiveInput);
		await expect(store.pArchiveCampaign(archiveInput)).resolves.toEqual(JSON.parse(JSON.stringify(archived)));
		await expect(store.pRemoveMember(removeInput)).resolves.toEqual(JSON.parse(JSON.stringify(removed)));
		await expect(store.pLeaveCampaign(leaveInput)).resolves.toEqual(JSON.parse(JSON.stringify(left)));
		await expect(store.pArchiveCampaign({
			...archiveInput,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
		await expect(store.pRemoveMember({
			accountId: archiveOwner.id,
			campaignId: archiveCampaign.id,
			membershipId: retainedMembership.id,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
		await expect(store.pLeaveCampaign({
			accountId: retainedLeaver.id,
			campaignId: archiveCampaign.id,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
		const evidence = await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.domain_events WHERE campaign_id = $1 AND event_type = 'campaign.archived') AS event_count,
				(SELECT count(*)::integer FROM hub.audit_entries WHERE campaign_id = $1 AND action = 'campaign.archived') AS audit_count,
				(SELECT count(*)::integer FROM hub.memberships WHERE campaign_id = $1 AND account_id = $2 AND status = 'active') AS retained_count,
				(SELECT count(*)::integer FROM hub.memberships WHERE campaign_id = $1 AND account_id = $3 AND status = 'active') AS retained_leaver_count
		`, [archiveCampaign.id, retainedAccount.id, retainedLeaver.id]);
		expect(evidence.rows[0]).toEqual({
			event_count: 1,
			audit_count: 1,
			retained_count: 1,
			retained_leaver_count: 1,
		});
	});

	test("preserves metadata and idempotency through character, stash, and direct-pass escrow", async () => {
		const depositInput = {
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "party_inventory",
			targetId: partyInventory.id,
			payload: {items: [{entryId: "maps", quantity: 2}]},
			idempotencyKey: `${prefix}-deposit`,
		};
		const deposit = await store.pProposeTransfer(depositInput);
		await expect(store.pProposeTransfer(depositInput)).resolves.toEqual(JSON.parse(JSON.stringify(deposit)));
		expect(deposit.transfer).toMatchObject({
			actorAccountId: sourceOwner.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "party_inventory",
			status: "reserved",
		});
		expect(deposit.transfer).not.toHaveProperty("targetId");
		expect((await pReadCharacter(sourceOwner.id, sourceCharacter.id)).data.inventory.find(it => it.id === "maps").quantity).toBe(2);
		expect((await pReadCharacter(sourceOwner.id, sourceCharacter.id)).data.inventory.find(it => it.id === "flour").quantity).toBe(0.6667);

		const acceptDepositInput = {
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: deposit.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-accept-deposit`,
		};
		const acceptedDeposit = await store.pResolveTransfer(acceptDepositInput);
		await expect(store.pResolveTransfer(acceptDepositInput)).resolves.toEqual(JSON.parse(JSON.stringify(acceptedDeposit)));
		expect(acceptedDeposit.transfer).toMatchObject({
			actorAccountId: sourceOwner.id,
			sourceId: sourceCharacter.id,
			targetId: partyInventory.id,
			status: "committed",
		});
		let stash = await store.pGetPartyInventory({accountId: sourceOwner.id, campaignId: campaign.id});
		expect(stash.inventory).toEqual([
			expect.objectContaining({
				item: {name: "Map", source: "PHB", weight: 0.1},
				note: "Secret route",
				quantity: 2,
			}),
		]);

		const sameOwnerSource = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: `${prefix} same-owner source`,
				inventory: [{
					id: "same-owner-map",
					item: {name: "Map", source: "PHB", weight: 0.1},
					note: "Secret route",
					quantity: 1,
				}],
				currency: {},
				carry: {schemaVersion: 1, status: "known"},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const sameOwnerTarget = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} same-owner target`, inventory: [], currency: {}, carry: {schemaVersion: 1, status: "known"}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const sameOwnerInput = {
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sameOwnerSource.id,
			targetKind: "character",
			targetId: sameOwnerTarget.id,
			payload: {items: [{entryId: "same-owner-map", quantity: 1}]},
			idempotencyKey: `${prefix}-same-owner-direct`,
		};
		const sameOwnerDirect = await store.pProposeTransfer(sameOwnerInput);
		expect(sameOwnerDirect.transfer.status).toBe("committed");
		await expect(store.pProposeTransfer(sameOwnerInput)).resolves.toEqual(JSON.parse(JSON.stringify(sameOwnerDirect)));
		await expect(store.pResolveTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			transferId: sameOwnerDirect.transfer.id,
			decision: "reject",
			idempotencyKey: `${prefix}-same-owner-reject`,
		})).rejects.toMatchObject({code: "TRANSFER_NOT_FOUND"});
		expect((await pReadCharacter(sourceOwner.id, sameOwnerTarget.id)).data.inventory).toContainEqual(expect.objectContaining({
			item: {name: "Map", source: "PHB", weight: 0.1},
			note: "Secret route",
			quantity: 1,
		}));

		const directPassInput = {
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "maps", quantity: 1}]},
			idempotencyKey: `${prefix}-direct`,
		};
		const directPass = await store.pProposeTransfer(directPassInput);
		await expect(store.pProposeTransfer(directPassInput)).resolves.toEqual(JSON.parse(JSON.stringify(directPass)));
		expect(directPass.transfer).toMatchObject({
			actorAccountId: sourceOwner.id,
			actorCommandId: `${prefix}-direct`,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			status: "reserved",
		});
		expect(directPass.transfer).not.toHaveProperty("targetId");
		const sourceTransferView = (await store.pListTransfers({accountId: sourceOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(sourceTransferView).toMatchObject({
			actorAccountId: sourceOwner.id,
			actorCommandId: `${prefix}-direct`,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetDisplaySnapshot: {version: 1, displayName: "Target"},
		});
		expect(sourceTransferView).not.toHaveProperty("targetId");
		const targetTransferView = (await store.pListTransfers({accountId: targetOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(targetTransferView).toMatchObject({
			actorAccountId: null,
			sourceKind: "character",
			targetKind: "character",
			targetId: targetCharacter.id,
			sourceDisplaySnapshot: {version: 1, displayName: "Source"},
		});
		expect(targetTransferView).not.toHaveProperty("sourceId");
		expect(targetTransferView).not.toHaveProperty("actorCommandId");
		const dmTransferView = (await store.pListTransfers({accountId: dm.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(dmTransferView).toMatchObject({
			sourceDisplaySnapshot: {version: 1, displayName: "Source"},
			targetDisplaySnapshot: {version: 1, displayName: "Target"},
		});
		expect(dmTransferView).not.toHaveProperty("actorCommandId");
		const acceptDirectInput = {
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: directPass.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-accept-direct`,
		};
		const acceptedDirect = await store.pResolveTransfer(acceptDirectInput);
		await expect(store.pResolveTransfer(acceptDirectInput)).resolves.toEqual(JSON.parse(JSON.stringify(acceptedDirect)));
		expect(acceptedDirect.transfer).toMatchObject({
			actorAccountId: null,
			sourceKind: "character",
			targetKind: "character",
			targetId: targetCharacter.id,
			status: "committed",
		});
		expect(acceptedDirect.transfer).not.toHaveProperty("sourceId");
		expect(acceptedDirect.transfer).not.toHaveProperty("actorCommandId");
		const acceptedSourceView = (await store.pListTransfers({accountId: sourceOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(acceptedSourceView.actorCommandId).toBe(`${prefix}-direct`);
		const aliasPolicy = await store.pSetProjectionPolicy({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			policy: {
				version: 1,
				preset: "private",
				overrides: {identity: {mode: "replace", value: {name: "Masked Source"}}},
			},
			expectedProjectionRevision: sourceCharacter.projectionRevision,
			idempotencyKey: `${prefix}-alias-source-after-transfer`,
		});
		const targetViewAfterSourceAlias = (await store.pListTransfers({accountId: targetOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(targetViewAfterSourceAlias).toMatchObject({
			sourceDisplaySnapshot: {version: 1, displayName: "Masked Source"},
		});
		expect(targetViewAfterSourceAlias).not.toHaveProperty("sourceId");
		const dmViewAfterSourceAlias = (await store.pListTransfers({accountId: dm.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(dmViewAfterSourceAlias.sourceDisplaySnapshot).toEqual({version: 1, displayName: "Source"});

		const partialPolicy = await store.pSetProjectionPolicy({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			policy: {
				version: 1,
				preset: "private",
				overrides: {hp: {mode: "share"}},
			},
			expectedProjectionRevision: aliasPolicy.projectionRevision,
			idempotencyKey: `${prefix}-share-source-hp-without-identity`,
		});
		const invalidationsBeforePrivate = (await store.pListVisibleEventPage({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			limit: 500,
		})).events.filter(
			event => event.aggregateId === campaign.id && event.type === "character.projection.invalidated",
		);
		const privatePolicy = await store.pSetProjectionPolicy({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			policy: {version: 1, preset: "private", overrides: {}},
			expectedProjectionRevision: partialPolicy.projectionRevision,
			idempotencyKey: `${prefix}-hide-source-after-transfer`,
		});
		const targetInvalidations = (await store.pListVisibleEventPage({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			limit: 500,
		})).events.filter(
			event => event.aggregateId === campaign.id && event.type === "character.projection.invalidated",
		);
		expect(targetInvalidations).toHaveLength(invalidationsBeforePrivate.length + 1);
		expect(targetInvalidations.at(-1)).toMatchObject({
			actorAccountId: null,
			aggregateId: campaign.id,
			aggregateType: "campaign",
			payload: {},
			visibleAccountIds: null,
		});
		expect(JSON.stringify(targetInvalidations.at(-1))).not.toContain(sourceOwner.id);
		expect(JSON.stringify(targetInvalidations.at(-1))).not.toContain(sourceCharacter.id);
		expect(JSON.stringify(targetInvalidations.at(-1))).not.toContain("Source");
		const targetViewAfterSourceHide = (await store.pListTransfers({accountId: targetOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(targetViewAfterSourceHide).not.toHaveProperty("sourceDisplaySnapshot");
		expect(targetViewAfterSourceHide).not.toHaveProperty("sourceId");
		await store.pSetProjectionPolicy({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			policy: {version: 1, preset: "table", overrides: {}},
			expectedProjectionRevision: privatePolicy.projectionRevision,
			idempotencyKey: `${prefix}-restore-source-after-transfer`,
		});
		const destinationCampaign = (await store.pCreateCampaign({
			accountId: sourceOwner.id,
			name: `${prefix} transfer-label-destination`,
			idempotencyKey: `${prefix}-transfer-label-destination`,
		})).campaign;
		await store.pMoveCharacter({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			campaignId: destinationCampaign.id,
			idempotencyKey: `${prefix}-move-source-after-transfer`,
		});
		const targetViewAfterSourceMove = (await store.pListTransfers({accountId: targetOwner.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(targetViewAfterSourceMove).not.toHaveProperty("sourceDisplaySnapshot");
		expect(targetViewAfterSourceMove).not.toHaveProperty("sourceId");
		const dmViewAfterSourceMove = (await store.pListTransfers({accountId: dm.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === directPass.transfer.id);
		expect(dmViewAfterSourceMove).not.toHaveProperty("sourceDisplaySnapshot");
		await store.pMoveCharacter({
			accountId: sourceOwner.id,
			characterId: sourceCharacter.id,
			campaignId: campaign.id,
			idempotencyKey: `${prefix}-restore-source-campaign`,
		});
		const directTarget = await pReadCharacter(targetOwner.id, targetCharacter.id);
		expect(directTarget.data.inventory).toHaveLength(2);
		expect(directTarget.data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "public-map", note: "Public route", quantity: 1}),
			expect.objectContaining({note: "Secret route", quantity: 1}),
		]));
		const sourceEvent = (await store.pListVisibleEvents({accountId: sourceOwner.id, campaignId: campaign.id}))
			.find(event => event.aggregateId === directPass.transfer.id && event.type === "transfer.reserved");
		expect(sourceEvent).toMatchObject({
			actorAccountId: sourceOwner.id,
			visibleAccountIds: null,
			payload: {sourceKind: "character", sourceId: sourceCharacter.id, targetKind: "character"},
		});
		expect(sourceEvent.payload).not.toHaveProperty("targetId");
		const targetEvent = (await store.pListVisibleEvents({accountId: targetOwner.id, campaignId: campaign.id}))
			.find(event => event.aggregateId === directPass.transfer.id && event.type === "transfer.reserved");
		expect(targetEvent).toMatchObject({
			actorAccountId: null,
			visibleAccountIds: null,
			payload: {sourceKind: "character", targetKind: "character", targetId: targetCharacter.id},
		});
		expect(targetEvent.payload).not.toHaveProperty("sourceId");
		expect((await store.pListVisibleEvents({accountId: observer.id, campaignId: campaign.id}))
			.some(event => event.aggregateType === "transfer")).toBe(false);

		const withdraw = await store.pProposeTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			sourceKind: "party_inventory",
			sourceId: stash.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: stash.inventory[0].id, quantity: 1}]},
			idempotencyKey: `${prefix}-withdraw`,
		});
		expect(withdraw.transfer.status).toBe("committed");
		await expect(store.pResolveTransfer({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: withdraw.transfer.id,
			decision: "reject",
			idempotencyKey: `${prefix}-reject-direct-withdraw`,
		})).rejects.toMatchObject({code: "TRANSFER_NOT_FOUND"});
		stash = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		expect(stash.inventory[0]).toEqual(expect.objectContaining({note: "Secret route", quantity: 1}));
		expect((await pReadCharacter(targetOwner.id, targetCharacter.id)).data.inventory.find(it => it.note === "Secret route").quantity).toBe(2);
	});

	test("keeps player stash requests non-escrowed until DM approval and conserves canonical metadata", async () => {
		const seeded = await pSeedPartyItem({
			name: `${prefix} requested moonsteel`,
			quantity: 3,
			item: RICH_CATALOG_ITEM,
			entryMetadata: {note: "Keep the full trusted entry"},
		});
		const requestInput = {
			accountId: targetOwner.id,
			campaignId: campaign.id,
			sourceKind: "party_inventory",
			sourceId: seeded.party.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: seeded.entry.id, quantity: 1}]},
			idempotencyKey: `${prefix}-player-stash-request`,
		};
		const requested = await store.pProposeTransfer(requestInput);
		await expect(store.pProposeTransfer(requestInput)).resolves.toEqual(JSON.parse(JSON.stringify(requested)));
		expect(requested.transfer).toMatchObject({
			status: "proposed",
			payload: {
				request: {items: [{entryId: seeded.entry.id, quantity: 1}]},
				preview: {
					items: [expect.objectContaining({
						item: RICH_CATALOG_ITEM,
						note: "Keep the full trusted entry",
						quantity: 1,
					})],
				},
			},
		});
		expect((await store.pGetPartyInventory({accountId: targetOwner.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(3);
		await expect(store.pResolveTransfer({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: requested.transfer.id,
			decision: "accept",
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "FORBIDDEN"});

		const acceptInput = {
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: requested.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-approve-player-stash-request`,
		};
		const accepted = await store.pResolveTransfer(acceptInput);
		await expect(store.pResolveTransfer(acceptInput)).resolves.toEqual(JSON.parse(JSON.stringify(accepted)));
		await expect(store.pResolveTransfer({...acceptInput, idempotencyKey: `${prefix}-approve-player-stash-request-new-key`}))
			.rejects.toMatchObject({code: "TRANSFER_NOT_FOUND"});
		expect(accepted.transfer).toMatchObject({
			status: "committed",
			payload: {
				escrow: {
					items: [expect.objectContaining({
						item: RICH_CATALOG_ITEM,
						note: "Keep the full trusted entry",
						quantity: 1,
					})],
				},
			},
		});
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(2);
		expect((await pReadCharacter(targetOwner.id, targetCharacter.id)).data.inventory).toContainEqual(expect.objectContaining({
			item: RICH_CATALOG_ITEM,
			note: "Keep the full trusted entry",
			quantity: 1,
		}));

		const secondRequest = await store.pProposeTransfer({
			...requestInput,
			idempotencyKey: `${prefix}-player-stash-request-2`,
		});
		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: secondRequest.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-approve-player-stash-request-2`,
		});
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(1);
		expect((await pReadCharacter(targetOwner.id, targetCharacter.id)).data.inventory
			.find(entry => entry.item?.name === RICH_CATALOG_ITEM.name).quantity).toBe(2);
	});

	test("serializes competing player stash requests and returns a stable insufficient code", async () => {
		const seeded = await pSeedPartyItem({name: `${prefix} requested ration`, quantity: 3});
		const [sourceRequest, targetRequest] = await Promise.all([
			store.pProposeTransfer({
				accountId: sourceOwner.id,
				campaignId: campaign.id,
				sourceKind: "party_inventory",
				sourceId: seeded.party.id,
				targetKind: "character",
				targetId: sourceCharacter.id,
				payload: {items: [{entryId: seeded.entry.id, quantity: 2}]},
				idempotencyKey: `${prefix}-source-request-contention`,
			}),
			store.pProposeTransfer({
				accountId: targetOwner.id,
				campaignId: campaign.id,
				sourceKind: "party_inventory",
				sourceId: seeded.party.id,
				targetKind: "character",
				targetId: targetCharacter.id,
				payload: {items: [{entryId: seeded.entry.id, quantity: 2}]},
				idempotencyKey: `${prefix}-target-request-contention`,
			}),
		]);
		expect(sourceRequest.transfer.status).toBe("proposed");
		expect(targetRequest.transfer.status).toBe("proposed");
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(3);

		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: sourceRequest.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-approve-source-contention`,
		});
		await expect(store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: targetRequest.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-approve-target-contention`,
		})).rejects.toMatchObject({code: "TRANSFER_INSUFFICIENT"});
		expect((await store.pListTransfers({accountId: dm.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === targetRequest.transfer.id).status).toBe("proposed");
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(1);

		await expect(store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "party_inventory",
			sourceId: seeded.party.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: seeded.entry.id, quantity: 1}]},
			idempotencyKey: `${prefix}-peer-stash-request`,
		})).rejects.toMatchObject({code: "FORBIDDEN"});
	});

	test("fails stale or linked transfers atomically and restores a rejection exactly once", async () => {
		const before = await pReadCharacter(sourceOwner.id, sourceCharacter.id);
		await expect(store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "maps", quantity: 99}]},
			idempotencyKey: `${prefix}-stale`,
		})).rejects.toMatchObject({code: "TRANSFER_INSUFFICIENT"});
		await expect(store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "linked", quantity: 1}]},
			idempotencyKey: `${prefix}-linked`,
		})).rejects.toMatchObject({code: "TRANSFER_ITEM_LINKED"});
		expect((await pReadCharacter(sourceOwner.id, sourceCharacter.id)).data.inventory).toEqual(before.data.inventory);

		const rejected = await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "maps", quantity: 1}]},
			idempotencyKey: `${prefix}-reject`,
		});
		const rejectInput = {
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: rejected.transfer.id,
			decision: "reject",
			idempotencyKey: `${prefix}-resolve-reject`,
		};
		const first = await store.pResolveTransfer(rejectInput);
		await expect(store.pResolveTransfer(rejectInput)).resolves.toEqual(JSON.parse(JSON.stringify(first)));
		await expect(store.pResolveTransfer({...rejectInput, idempotencyKey: `${prefix}-resolve-reject-new-key`}))
			.rejects.toMatchObject({code: "TRANSFER_NOT_FOUND"});
		const restored = await pReadCharacter(sourceOwner.id, sourceCharacter.id);
		expect(restored.data.inventory.find(it => it.id === "maps")).toEqual(before.data.inventory.find(it => it.id === "maps"));

		const actorCancelled = await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "maps", quantity: 1}]},
			idempotencyKey: `${prefix}-actor-cancel`,
		});
		const actorCancelInput = {
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			transferId: actorCancelled.transfer.id,
			decision: "reject",
			idempotencyKey: `${prefix}-actor-cancel-resolve`,
		};
		const cancelled = await store.pResolveTransfer(actorCancelInput);
		await expect(store.pResolveTransfer(actorCancelInput)).resolves.toEqual(JSON.parse(JSON.stringify(cancelled)));
		expect((await pReadCharacter(sourceOwner.id, sourceCharacter.id)).data.inventory.find(it => it.id === "maps"))
			.toEqual(before.data.inventory.find(it => it.id === "maps"));
	});

	test("keeps multiple restored escrow stacks beside their metadata-diverged same-ID source rows", async () => {
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
		const source = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: `${prefix} metadata restore source`,
				inventory: [
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
				],
				currency: {},
				carry: {schemaVersion: 1, status: "known"},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const target = await pCreateTargetCharacter(`${prefix} metadata restore target`);
		const reserved = await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {
				items: [
					{entryId: stackId, quantity: 2},
					{entryId: secondStackId, quantity: 3},
				],
			},
			idempotencyKey: `${prefix}-metadata-restore-reserve`,
		});
		expect(reserved.transfer.status).toBe("reserved");

		const afterReserve = await pReadCharacter(sourceOwner.id, source.id);
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
			accountId: sourceOwner.id,
			character: afterReserve,
		});

		await store.pResolveTransfer({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: reserved.transfer.id,
			decision: "reject",
			idempotencyKey: `${prefix}-metadata-restore-reject`,
		});
		const restored = (await pReadCharacter(sourceOwner.id, source.id)).data.inventory;
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

	test("awards a party stack in stable target order with exact conservation and event pairing", async () => {
		const richItem = {
			name: `${prefix} bolts`,
			source: "PHB",
			weight: 0.1,
			material: {name: "Star iron", source: "PHB"},
			charges: {current: 4, max: 6},
			custom: {maker: "Rook"},
		};
		const entryMetadata = {note: "Keep dry", chargesUsed: 2, customState: {batch: "A"}};
		const existingId = crypto.randomUUID();
		const firstTarget = await pCreateTargetCharacter(`${prefix} award first`, [
			{id: existingId, item: richItem, quantity: 1, ...entryMetadata},
		]);
		const secondTarget = await pCreateTargetCharacter(`${prefix} award second`);
		const seeded = await pSeedPartyItem({
			name: `${prefix} bolts`,
			quantity: 10,
			item: richItem,
			entryMetadata,
		});
		const response = await store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "party_inventory", entryId: seeded.entry.id},
			targetCharacterIds: [secondTarget.id, firstTarget.id],
			quantity: 2,
			note: "PostgreSQL batch",
			idempotencyKey: crypto.randomUUID(),
		});

		expect(response.targets.map(target => target.characterId)).toEqual([secondTarget.id, firstTarget.id]);
		expect(response.targets.map(target => target.index)).toEqual([0, 1]);
		expect(response.source).toEqual({
			kind: "party_inventory",
			item: {name: `${prefix} bolts`, source: "PHB", weight: 0.1},
		});
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(6);
		const secondTargetData = (await pReadCharacter(targetOwner.id, secondTarget.id)).data;
		expect(secondTargetData).not.toHaveProperty("carry");
		const created = secondTargetData.inventory[0];
		expect(created).toMatchObject({
			item: richItem,
			quantity: 2,
			...entryMetadata,
			equipped: false,
			attuned: false,
			starred: false,
		});
		const merged = (await pReadCharacter(targetOwner.id, firstTarget.id)).data.inventory[0];
		expect(merged).toMatchObject({id: existingId, item: richItem, quantity: 3, ...entryMetadata});
		expect(response.targets[1].entryId).toBe(merged.id);

		const events = await store.pListVisibleEvents({accountId: dm.id, campaignId: campaign.id});
		const firstGrantIndex = events.findIndex(event => event.payload?.awardId === response.awardId);
		expect(events.slice(firstGrantIndex, firstGrantIndex + 5).map(event => event.type)).toEqual([
			"item.granted",
			"character.projection.invalidated",
			"item.granted",
			"character.projection.invalidated",
			"party_inventory.invalidated",
		]);
		const grantEvents = events.slice(firstGrantIndex, firstGrantIndex + 5).filter(event => event.type === "item.granted");
		for (const event of grantEvents) {
			expect(event.payload.entry.item).toEqual({name: richItem.name, source: "PHB", weight: 0.1});
			expect(event.payload.entry.item).not.toHaveProperty("material");
			expect(event.payload.entry).not.toHaveProperty("note");
		}
		const auditCount = await pool.query(`
			SELECT count(*)::int AS count
			FROM hub.audit_entries
			WHERE action = 'item.award_batch' AND details->>'awardId' = $1
		`, [response.awardId]);
		expect(auditCount.rows[0].count).toBe(1);
	});

	test("enforces the DM role and current campaign target boundary", async () => {
		const target = await pCreateTargetCharacter(`${prefix} authorization target`);
		const award = {
			campaignId: campaign.id,
			source: {kind: "catalog", item: {name: `${prefix} authorization token`, source: "PHB"}},
			targetCharacterIds: [target.id],
			quantity: 1,
		};
		await expect(store.pAwardItems({
			...award,
			accountId: sourceOwner.id,
			idempotencyKey: `${prefix}-award-player-forbidden`,
		})).rejects.toMatchObject({code: "FORBIDDEN", status: 403});

		const otherCampaign = (await store.pCreateCampaign({
			accountId: dm.id,
			name: `${prefix} authorization other campaign`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		const crossCampaignTarget = (await store.pCreateCharacter({
			accountId: dm.id,
			campaignId: otherCampaign.id,
			data: {name: `${prefix} cross campaign`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		await expect(store.pAwardItems({
			...award,
			accountId: dm.id,
			targetCharacterIds: [crossCampaignTarget.id],
			idempotencyKey: `${prefix}-award-cross-campaign`,
		})).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
	});

	test("rolls back every target and the stash when a batch cannot be fully funded", async () => {
		const firstTarget = await pCreateTargetCharacter(`${prefix} rollback first`);
		const secondTarget = await pCreateTargetCharacter(`${prefix} rollback second`);
		const seeded = await pSeedPartyItem({name: `${prefix} scarce`, quantity: 3});
		const beforeFirst = await pReadCharacter(targetOwner.id, firstTarget.id);
		const beforeSecond = await pReadCharacter(targetOwner.id, secondTarget.id);
		const beforeParty = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});

		await expect(store.pAwardItems({
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "party_inventory", entryId: seeded.entry.id},
			targetCharacterIds: [firstTarget.id, secondTarget.id],
			quantity: 2,
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "TRANSFER_INSUFFICIENT"});
		expect(await pReadCharacter(targetOwner.id, firstTarget.id)).toEqual(beforeFirst);
		expect(await pReadCharacter(targetOwner.id, secondTarget.id)).toEqual(beforeSecond);
		expect(await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id})).toEqual(beforeParty);
	});

	test("serializes a concurrent same-key batch to one mutation and one event set", async () => {
		const firstTarget = await pCreateTargetCharacter(`${prefix} duplicate first`);
		const secondTarget = await pCreateTargetCharacter(`${prefix} duplicate second`);
		const input = {
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "catalog", item: {name: `${prefix} token`, source: "PHB"}},
			targetCharacterIds: [firstTarget.id, secondTarget.id],
			quantity: 3,
			note: null,
			idempotencyKey: `${prefix}-award-duplicate`,
		};
		const [first, duplicate] = await Promise.all([
			store.pAwardItems(input),
			store.pAwardItems(input),
		]);
		expect(duplicate).toEqual(first);
		expect((await pReadCharacter(targetOwner.id, firstTarget.id)).data.inventory[0].quantity).toBe(3);
		expect((await pReadCharacter(targetOwner.id, secondTarget.id)).data.inventory[0].quantity).toBe(3);
		const eventCount = await pool.query(`
			SELECT count(*)::int AS count
			FROM hub.domain_events
			WHERE event_type = 'item.granted' AND payload->>'awardId' = $1
		`, [first.awardId]);
		expect(eventCount.rows[0].count).toBe(2);
		await expect(store.pAwardItems({...input, quantity: 4}))
			.rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED", status: 409});
	});

	test("conserves one stash across overlapping concurrent batches", async () => {
		const firstTarget = await pCreateTargetCharacter(`${prefix} overlap first`);
		const sharedTarget = await pCreateTargetCharacter(`${prefix} overlap shared`);
		const thirdTarget = await pCreateTargetCharacter(`${prefix} overlap third`);
		const seeded = await pSeedPartyItem({name: `${prefix} overlap ration`, quantity: 12});
		const base = {
			accountId: dm.id,
			campaignId: campaign.id,
			source: {kind: "party_inventory", entryId: seeded.entry.id},
			quantity: 2,
		};
		await Promise.all([
			store.pAwardItems({
				...base,
				targetCharacterIds: [firstTarget.id, sharedTarget.id],
				idempotencyKey: `${prefix}-overlap-a`,
			}),
			store.pAwardItems({
				...base,
				targetCharacterIds: [sharedTarget.id, thirdTarget.id],
				idempotencyKey: `${prefix}-overlap-b`,
			}),
		]);
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(4);
		expect((await pReadCharacter(targetOwner.id, firstTarget.id)).data.inventory[0].quantity).toBe(2);
		expect((await pReadCharacter(targetOwner.id, sharedTarget.id)).data.inventory[0].quantity).toBe(4);
		expect((await pReadCharacter(targetOwner.id, thirdTarget.id)).data.inventory[0].quantity).toBe(2);
	});

	test("orders participant and stash locks consistently with a concurrent stash transfer", async () => {
		const target = await pCreateTargetCharacter(`${prefix} transfer contention`);
		const seeded = await pSeedPartyItem({name: `${prefix} contention ration`, quantity: 12});
		const [award, transferred] = await Promise.all([
			store.pAwardItems({
				accountId: dm.id,
				campaignId: campaign.id,
				source: {kind: "party_inventory", entryId: seeded.entry.id},
				targetCharacterIds: [target.id],
				quantity: 4,
				idempotencyKey: `${prefix}-contention-award`,
			}),
			store.pProposeTransfer({
				accountId: dm.id,
				campaignId: campaign.id,
				sourceKind: "party_inventory",
				sourceId: seeded.party.id,
				targetKind: "character",
				targetId: target.id,
				payload: {items: [{entryId: seeded.entry.id, quantity: 5}]},
				idempotencyKey: `${prefix}-contention-transfer`,
			}),
		]);
		expect(award.targets[0].characterId).toBe(target.id);
		expect((await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id}))
			.inventory.find(entry => entry.id === seeded.entry.id).quantity).toBe(3);
		expect(transferred.transfer.status).toBe("committed");
		expect((await pReadCharacter(targetOwner.id, target.id)).data.inventory).toEqual([
			expect.objectContaining({item: {name: `${prefix} contention ration`, source: "PHB", weight: 0.1}, quantity: 9}),
		]);
	});

	test("cancels reserved transfers on spectator downgrade and rejects later resolution", async () => {
		const source = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} role source`, inventory: [], currency: {gp: 4}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const target = (await store.pCreateCharacter({
			accountId: observer.id,
			campaignId: campaign.id,
			data: {name: `${prefix} role target`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const reserved = (await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 2}},
			idempotencyKey: crypto.randomUUID(),
		})).transfer;
		const membership = await store.pGetMembership({accountId: observer.id, campaignId: campaign.id});

		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: membership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		});

		expect((await store.pListTransfers({accountId: dm.id, campaignId: campaign.id}))
			.find(transfer => transfer.id === reserved.id).status).toBe("cancelled");
		expect((await pReadCharacter(sourceOwner.id, source.id)).data.currency.gp).toBe(4);

		const afterDowngrade = (await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 1}},
			idempotencyKey: crypto.randomUUID(),
		})).transfer;
		await expect(store.pResolveTransfer({
			accountId: observer.id,
			campaignId: campaign.id,
			transferId: afterDowngrade.id,
			decision: "accept",
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "FORBIDDEN"});
	});

	test("restores independently reserved whole stacks in original order during lifecycle cancellation", async () => {
		const lifecycleTargetOwner = await pCreateAccount("Inventory Ordered Lifecycle Target");
		const lifecycleMembership = await pJoinCampaign(lifecycleTargetOwner);
		const entryIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		const source = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: `${prefix} ordered lifecycle source`,
				inventory: [
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
				],
				currency: {},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const originalInventory = structuredClone((await pReadCharacter(sourceOwner.id, source.id)).data.inventory);
		const target = (await store.pCreateCharacter({
			accountId: lifecycleTargetOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} ordered lifecycle target`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const reservations = [];
		for (const entryId of entryIds.slice(0, 2)) {
			const response = await store.pProposeTransfer({
				accountId: sourceOwner.id,
				campaignId: campaign.id,
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId: target.id,
				payload: {items: [{entryId, quantity: 1}]},
				idempotencyKey: crypto.randomUUID(),
			});
			expect(response.transfer).not.toHaveProperty("_sourceRevision");
			reservations.push(response.transfer);
		}
		expect((await pReadCharacter(sourceOwner.id, source.id)).data.inventory.map(entry => entry.id))
			.toEqual([entryIds[2]]);

		const orderedTransferIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
		await pool.query(`
			UPDATE hub.transfers
			SET id = CASE id
				WHEN $1::uuid THEN $3::uuid
				WHEN $2::uuid THEN $4::uuid
			END
			WHERE id = ANY($5::uuid[])
		`, [
			reservations[0].id,
			reservations[1].id,
			orderedTransferIds[0],
			orderedTransferIds[1],
			reservations.map(transfer => transfer.id),
		]);

		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: lifecycleMembership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		});

		const restored = (await pReadCharacter(sourceOwner.id, source.id)).data.inventory;
		expect(restored).toEqual(originalInventory);
		expect(restored.map(entry => entry.id)).toEqual(entryIds);
		expect(restored.map(entry => entry.quantity)).toEqual([1, 1, 1]);
		const cancellationEvents = (await store.pListVisibleEvents({
			accountId: dm.id,
			campaignId: campaign.id,
		})).filter(event => event.type === "transfer.cancelled");
		expect(cancellationEvents.slice(-2).map(event => event.aggregateId))
			.toEqual([orderedTransferIds[1], orderedTransferIds[0]]);
	});

	test("rolls back every PostgreSQL lifecycle cancellation when one escrow restore is invalid", async () => {
		const lifecycleTargetOwner = await pCreateAccount("Inventory Atomic Lifecycle Target");
		const lifecycleMembership = await pJoinCampaign(lifecycleTargetOwner);
		const sources = [];
		for (const label of ["first", "second"]) {
			sources.push((await store.pCreateCharacter({
				accountId: sourceOwner.id,
				campaignId: campaign.id,
				data: {name: `${prefix} atomic ${label} source`, inventory: [], currency: {gp: Number.MAX_SAFE_INTEGER}},
				schemaVersion: 1,
				clientImportId: crypto.randomUUID(),
				idempotencyKey: crypto.randomUUID(),
			})).character);
		}
		const refillSource = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} atomic refill source`, inventory: [], currency: {gp: 1}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const target = (await store.pCreateCharacter({
			accountId: lifecycleTargetOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} atomic target`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const transfers = [];
		for (const source of sources) {
			transfers.push((await store.pProposeTransfer({
				accountId: sourceOwner.id,
				campaignId: campaign.id,
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId: target.id,
				payload: {currency: {gp: 1}},
				idempotencyKey: crypto.randomUUID(),
			})).transfer);
		}
		const laterTransfer = [...transfers].sort((a, b) => a.id.localeCompare(b.id))[1];
		await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: refillSource.id,
			targetKind: "character",
			targetId: laterTransfer.sourceId,
			payload: {currency: {gp: 1}},
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: lifecycleMembership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		})).rejects.toMatchObject({code: "NUMERIC_INVALID"});

		expect((await store.pGetMembership({accountId: lifecycleTargetOwner.id, campaignId: campaign.id})).role).toBe("player");
		const listed = await store.pListTransfers({accountId: dm.id, campaignId: campaign.id});
		for (const transfer of transfers) {
			expect(listed.find(candidate => candidate.id === transfer.id).status).toBe("reserved");
		}
		for (const source of sources) {
			const expectedGp = source.id === laterTransfer.sourceId
				? Number.MAX_SAFE_INTEGER
				: Number.MAX_SAFE_INTEGER - 1;
			expect((await pReadCharacter(sourceOwner.id, source.id)).data.currency.gp).toBe(expectedGp);
		}
	});

	test("serializes transfer and event-list authorization with concurrent role changes", async () => {
		const coDm = await pCreateAccount("Inventory Concurrent Co-DM");
		const membership = await pJoinCampaign(coDm);
		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: membership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		const source = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {name: `${prefix} concurrent-list source`, inventory: [], currency: {gp: 2}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const target = await pCreateTargetCharacter(`${prefix} concurrent-list target`);
		const unrelated = (await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 1}},
			idempotencyKey: crypto.randomUUID(),
		})).transfer;
		expect((await store.pListTransfers({accountId: coDm.id, campaignId: campaign.id}))
			.some(transfer => transfer.id === unrelated.id)).toBe(true);

		const roleClient = await pool.connect();
		try {
			await roleClient.query("BEGIN");
			await roleClient.query(`UPDATE hub.memberships SET role = 'spectator', updated_at = now() WHERE id = $1`, [membership.id]);
			let isTransferListSettled = false;
			let isEventListSettled = false;
			let isHistoryListSettled = false;
			const listing = store.pListTransfers({accountId: coDm.id, campaignId: campaign.id})
				.finally(() => { isTransferListSettled = true; });
			const eventListing = store.pListVisibleEventPage({accountId: coDm.id, campaignId: campaign.id})
				.finally(() => { isEventListSettled = true; });
			const historyListing = store.pListVisibleEventPage({
				accountId: coDm.id,
				campaignId: campaign.id,
				beforeSequence: Number.MAX_SAFE_INTEGER,
			}).finally(() => { isHistoryListSettled = true; });
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(isTransferListSettled).toBe(false);
			expect(isEventListSettled).toBe(false);
			expect(isHistoryListSettled).toBe(false);
			await roleClient.query("COMMIT");
			expect((await listing).some(transfer => transfer.id === unrelated.id)).toBe(false);
			expect((await eventListing).events.some(event => event.aggregateId === unrelated.id)).toBe(false);
			expect((await historyListing).events.some(event => event.aggregateId === unrelated.id)).toBe(false);
		} catch (error) {
			await roleClient.query("ROLLBACK");
			throw error;
		} finally {
			roleClient.release();
		}
	});

	test("pages retained activity backward past a hidden recent tail", async () => {
		const player = await pCreateAccount("Inventory History Player");
		const historyCampaign = (await store.pCreateCampaign({
			accountId: dm.id,
			name: `${prefix} history campaign`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		await pJoinSpecificCampaign({owner: dm, targetCampaign: historyCampaign, account: player});
		const character = (await store.pCreateCharacter({
			accountId: player.id,
			campaignId: historyCampaign.id,
			data: {name: `${prefix} history character`, inventory: [], currency: {}, xp: 0},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const reason = `${prefix} first session`;
		await store.pGrantXp({
			accountId: dm.id,
			campaignId: historyCampaign.id,
			characterId: character.id,
			amount: 100,
			reason,
			idempotencyKey: crypto.randomUUID(),
		});
		const xpSequence = Number((await pool.query(`
			SELECT sequence
			FROM hub.domain_events
			WHERE campaign_id = $1 AND event_type = 'xp.granted' AND payload->>'reason' = $2
		`, [historyCampaign.id, reason])).rows[0].sequence);
		for (let i = 0; i < 60; ++i) {
			await store.pCreateInvite({
				accountId: dm.id,
				campaignId: historyCampaign.id,
				role: "player",
				tokenHash: crypto.randomBytes(32).toString("hex"),
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
				idempotencyKey: crypto.randomUUID(),
			});
		}
		const cursor = await store.pGetCampaignCursor({accountId: player.id, campaignId: historyCampaign.id});

		const page = await store.pListVisibleEventPage({
			accountId: player.id,
			campaignId: historyCampaign.id,
			beforeSequence: cursor.cursor.lastSequence + 1,
			limit: 1,
		});

		expect(page.events).toEqual([
			expect.objectContaining({
				type: "xp.granted",
				payload: expect.objectContaining({amount: 100, reason}),
			}),
		]);
		expect(page.history).toEqual({
			scannedBackThroughSequence: xpSequence,
			hasMore: true,
		});
	});

	test("replays projected transfer receipts after active members become spectators", async () => {
		const actor = await pCreateAccount("Inventory Receipt Actor");
		const recipient = await pCreateAccount("Inventory Receipt Recipient");
		const actorMembership = await pJoinCampaign(actor);
		const recipientMembership = await pJoinCampaign(recipient);
		const source = (await store.pCreateCharacter({
			accountId: actor.id,
			campaignId: campaign.id,
			data: {
				name: `${prefix} receipt source`,
				inventory: [{id: "receipt-stack", item: {name: "Rope", source: "PHB"}, quantity: 2}],
				currency: {},
			},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const sameOwnerTarget = (await store.pCreateCharacter({
			accountId: actor.id,
			campaignId: campaign.id,
			data: {name: `${prefix} receipt same-owner`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const peerTarget = (await store.pCreateCharacter({
			accountId: recipient.id,
			campaignId: campaign.id,
			data: {name: `${prefix} receipt peer`, inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const directInput = {
			accountId: actor.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: sameOwnerTarget.id,
			payload: {items: [{entryId: "receipt-stack", quantity: 1}]},
			idempotencyKey: crypto.randomUUID(),
		};
		const direct = await store.pProposeTransfer(directInput);
		const peer = await store.pProposeTransfer({
			...directInput,
			targetId: peerTarget.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const resolveInput = {
			accountId: recipient.id,
			campaignId: campaign.id,
			transferId: peer.transfer.id,
			decision: "accept",
			idempotencyKey: crypto.randomUUID(),
		};
		const resolved = await store.pResolveTransfer(resolveInput);
		expect(resolved.transfer).not.toHaveProperty("sourceId");
		expect(resolved.transfer.actorAccountId).toBeNull();
		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: recipientMembership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		const promotedReplay = await store.pResolveTransfer(resolveInput);
		expect(promotedReplay.transfer.sourceId).toBe(source.id);
		expect(promotedReplay.transfer.actorAccountId).toBe(actor.id);

		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: actorMembership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: recipientMembership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		});

		await expect(store.pProposeTransfer(directInput)).resolves.toEqual(JSON.parse(JSON.stringify(direct)));
		await expect(store.pResolveTransfer(resolveInput)).resolves.toEqual(JSON.parse(JSON.stringify(resolved)));
	});
});
