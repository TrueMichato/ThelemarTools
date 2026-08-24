import crypto from "node:crypto";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

describe("campaign lifecycle and export", () => {
	let store;
	let owner;
	let successor;
	let campaign;

	beforeEach(async () => {
		store = new MemoryHubStore();
		owner = (await store.pUpsertOAuthAccount({provider: "github", providerSubject: "owner", displayName: "Owner"})).id;
		successor = (await store.pUpsertOAuthAccount({provider: "github", providerSubject: "successor", displayName: "Successor"})).id;
		campaign = (await store.pCreateCampaign({accountId: owner, name: "Lifecycle", idempotencyKey: "campaign"})).campaign;
		const tokenHash = crypto.createHash("sha256").update("invite").digest("hex");
		await store.pCreateInvite({accountId: owner, campaignId: campaign.id, role: "co_dm", tokenHash, expiresAt: new Date(Date.now() + 10000), maxUses: 1, idempotencyKey: "invite"});
		await store.pRedeemInvite({accountId: successor, tokenHash, idempotencyKey: "redeem"});
	});

	it("exports owned characters and campaign membership", async () => {
		await store.pCreateCharacter({accountId: owner, campaignId: campaign.id, data: {name: "Hero"}, schemaVersion: 1, clientImportId: "local", idempotencyKey: "character"});
		const exported = await store.pExportAccountData({accountId: owner});
		expect(exported).toEqual(expect.objectContaining({
			account: expect.objectContaining({id: owner}),
			campaigns: [expect.objectContaining({id: campaign.id})],
			memberships: [expect.objectContaining({role: "dm"})],
			characters: [expect.objectContaining({data: expect.objectContaining({name: "Hero"})})],
		}));
	});

	it("transfers ownership only to an active DM membership", async () => {
		const transferred = await store.pTransferCampaignOwnership({
			accountId: owner,
			campaignId: campaign.id,
			targetAccountId: successor,
			idempotencyKey: "transfer-owner",
		});
		expect(transferred.campaign.ownerAccountId).toBe(successor);
		expect((await store.pGetMembership({accountId: owner, campaignId: campaign.id})).role).toBe("co_dm");
		expect((await store.pGetMembership({accountId: successor, campaignId: campaign.id})).role).toBe("dm");
	});

	it("blocks archive while escrow is reserved, then detaches characters safely", async () => {
		const source = (await store.pCreateCharacter({
			accountId: owner,
			campaignId: campaign.id,
			data: {name: "Hero", inventory: [], currency: {gp: 10}},
			schemaVersion: 1,
			clientImportId: "source",
			idempotencyKey: "source",
		})).character;
		const target = (await store.pCreateCharacter({
			accountId: successor,
			campaignId: campaign.id,
			data: {name: "Other", inventory: [], currency: {}},
			schemaVersion: 1,
			clientImportId: "target",
			idempotencyKey: "target",
		})).character;
		const transfer = (await store.pProposeTransfer({
			accountId: owner,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 3}},
			idempotencyKey: "transfer",
		})).transfer;
		await expect(store.pArchiveCampaign({accountId: owner, campaignId: campaign.id, idempotencyKey: "archive-1"}))
			.rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_BUSY"}));
		await store.pResolveTransfer({accountId: successor, campaignId: campaign.id, transferId: transfer.id, decision: "reject", idempotencyKey: "reject"});
		const archived = await store.pArchiveCampaign({accountId: owner, campaignId: campaign.id, idempotencyKey: "archive-2"});
		expect(archived.campaign.status).toBe("archived");
		expect((await store.pGetCharacter({accountId: owner, characterId: source.id})).campaignId).toBeNull();
		await expect(store.pCreateInvite({
			accountId: owner,
			campaignId: campaign.id,
			role: "player",
			tokenHash: "archived",
			expiresAt: new Date(Date.now() + 10000),
			maxUses: 1,
			idempotencyKey: "invite-after-archive",
		})).rejects.toEqual(expect.objectContaining({code: "CAMPAIGN_NOT_FOUND"}));
	});

	it("reactivates an archived local import instead of returning an unreadable row", async () => {
		const created = (await store.pCreateCharacter({
			accountId: owner,
			campaignId: campaign.id,
			data: {name: "First"},
			schemaVersion: 1,
			clientImportId: "same-local",
			idempotencyKey: "create-once",
		})).character;
		await store.pArchiveCharacter({accountId: owner, characterId: created.id, idempotencyKey: "archive-character"});
		const recreated = (await store.pCreateCharacter({
			accountId: owner,
			campaignId: campaign.id,
			data: {name: "Reactivated"},
			schemaVersion: 1,
			clientImportId: "same-local",
			idempotencyKey: "create-again",
		})).character;
		expect(recreated).toEqual(expect.objectContaining({id: created.id, status: "active", data: expect.objectContaining({name: "Reactivated"})}));
		await expect(store.pGetCharacter({accountId: owner, characterId: created.id})).resolves.toEqual(expect.objectContaining({status: "active"}));
		expect(store.getAuditEntries()).toContainEqual(expect.objectContaining({action: "character.reactivated", targetId: created.id}));
		expect(store.getDomainEvents()).toContainEqual(expect.objectContaining({type: "character.reactivated", aggregateId: created.id}));
	});

	it("clones the same local import into a different campaign by default", async () => {
		const first = (await store.pCreateCharacter({
			accountId: owner,
			campaignId: campaign.id,
			data: {name: "Hero"},
			schemaVersion: 1,
			clientImportId: "shared-local",
			idempotencyKey: "first-campaign",
		})).character;
		const secondCampaign = (await store.pCreateCampaign({accountId: owner, name: "Second", idempotencyKey: "second-campaign"})).campaign;
		const second = (await store.pCreateCharacter({
			accountId: owner,
			campaignId: secondCampaign.id,
			data: {name: "Hero"},
			schemaVersion: 1,
			clientImportId: "shared-local",
			idempotencyKey: "second-upload",
		})).character;
		expect(second.id).not.toBe(first.id);
		expect(second.campaignId).toBe(secondCampaign.id);
		expect(second.clonedFromCharacterId).toBe(first.id);
	});
});
