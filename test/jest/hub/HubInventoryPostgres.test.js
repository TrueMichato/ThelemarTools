import crypto from "node:crypto";
import pg from "pg";

import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const {Pool} = pg;
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

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

	async function pJoinCampaign (account) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.id,
			campaignId: campaign.id,
			role: "player",
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
	}

	async function pReadCharacter (accountId, characterId) {
		return (await store.pGetCharacter({accountId, characterId})).character;
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
		const donor = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: {
				name: `${name} donor`,
				inventory: [{
					id: donorEntryId,
					item: item || {name, source: "PHB", weight: 0.1},
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
		return {party: seeded, entry: seeded.inventory.find(entry => entry.item.name === name)};
	}

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 6,
		});
		store = new PostgresHubStore({pool});
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
		let stash = await store.pGetPartyInventory({accountId: sourceOwner.id, campaignId: campaign.id});
		expect(stash.inventory).toEqual([
			expect.objectContaining({
				item: {name: "Map", source: "PHB", weight: 0.1},
				note: "Secret route",
				quantity: 2,
			}),
		]);

		const directPass = await store.pProposeTransfer({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: sourceCharacter.id,
			targetKind: "character",
			targetId: targetCharacter.id,
			payload: {items: [{entryId: "maps", quantity: 1}]},
			idempotencyKey: `${prefix}-direct`,
		});
		await store.pResolveTransfer({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			transferId: directPass.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-accept-direct`,
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
		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: withdraw.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-accept-withdraw`,
		});
		stash = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		expect(stash.inventory[0]).toEqual(expect.objectContaining({note: "Secret route", quantity: 1}));
		expect((await pReadCharacter(targetOwner.id, targetCharacter.id)).data.inventory.find(it => it.note === "Secret route").quantity).toBe(2);
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
		const [award, reserved] = await Promise.all([
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

		await store.pResolveTransfer({
			accountId: dm.id,
			campaignId: campaign.id,
			transferId: reserved.transfer.id,
			decision: "accept",
			idempotencyKey: `${prefix}-contention-resolve`,
		});
		expect((await pReadCharacter(targetOwner.id, target.id)).data.inventory).toEqual([
			expect.objectContaining({item: {name: `${prefix} contention ration`, source: "PHB", weight: 0.1}, quantity: 9}),
		]);
	});
});
