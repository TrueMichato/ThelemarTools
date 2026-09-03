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
					{id: "maps", item: {name: "Map", source: "HB", weight: 0.1}, quantity: 4, note: "Secret route"},
					{id: "linked", item: {name: "Linked Focus", source: "HB"}, quantity: 1, equipped: true},
					{id: "flour", item: {name: "Flour", source: "HB"}, quantity: 0.6667},
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
				inventory: [{id: "public-map", item: {name: "Map", source: "HB", weight: 0.1}, quantity: 1, note: "Public route"}],
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
				item: {name: "Map", source: "HB", weight: 0.1},
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
});
