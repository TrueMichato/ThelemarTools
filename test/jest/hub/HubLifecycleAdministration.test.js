import crypto from "node:crypto";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

describe("Hub lifecycle administration", () => {
	let now;
	let store;
	let dm;
	let coDm;
	let player;
	let observer;
	let campaign;
	let ix;

	beforeEach(async () => {
		now = new Date("2026-08-24T00:00:00.000Z");
		store = new MemoryHubStore({fnNow: () => new Date(now)});
		ix = 0;
		const createAccount = (subject, displayName) => store.pUpsertOAuthAccount({provider: "github", providerSubject: subject, displayName});
		dm = await createAccount("1", "DM");
		coDm = await createAccount("2", "Co-DM");
		player = await createAccount("3", "Player");
		observer = await createAccount("4", "Observer");
		campaign = (await store.pCreateCampaign({accountId: dm.id, name: "Lifecycle", idempotencyKey: key("campaign")})).campaign;
		await join(coDm, "co_dm");
		await join(player, "player");
		await join(observer, "player");
	});

	function key (label) {
		return `${label}-${++ix}`;
	}

	async function join (account, role) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.id,
			campaignId: campaign.id,
			role,
			tokenHash,
			expiresAt: new Date(now.getTime() + 86_400_000),
			maxUses: 1,
			idempotencyKey: key(`invite-${role}`),
		});
		return (await store.pRedeemInvite({accountId: account.id, tokenHash, idempotencyKey: key(`redeem-${role}`)})).membership;
	}

	it("lists/revokes invites and restricts role changes to the owner", async () => {
		const invites = await store.pListInvites({accountId: dm.id, campaignId: campaign.id});
		expect(invites).toHaveLength(3);
		expect(invites.every(invite => invite.tokenHash === undefined)).toBe(true);
		const revoked = await store.pRevokeInvite({
			accountId: coDm.id,
			campaignId: campaign.id,
			inviteId: invites[0].id,
			idempotencyKey: key("revoke"),
		});
		expect(revoked.invite.revokedAt).toBeTruthy();

		const observerMembership = await store.pGetMembership({accountId: observer.id, campaignId: campaign.id});
		await expect(store.pChangeMemberRole({
			accountId: coDm.id,
			campaignId: campaign.id,
			membershipId: observerMembership.id,
			role: "spectator",
			idempotencyKey: key("co-role"),
		})).rejects.toMatchObject({code: "FORBIDDEN"});
		const changed = await store.pChangeMemberRole({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: observerMembership.id,
			role: "spectator",
			idempotencyKey: key("owner-role"),
		});
		expect(changed.membership.role).toBe("spectator");
	});

	it("removes a member atomically, restores escrow, and detaches owned characters", async () => {
		const character = (await store.pCreateCharacter({
			accountId: player.id,
			campaignId: campaign.id,
			clientImportId: "player-local",
			schemaVersion: 1,
			data: {
				name: "Player Character",
				inventory: [{id: "map", item: {name: "Map", source: "HB"}, quantity: 1}],
				currency: {gp: 4},
			},
			idempotencyKey: key("character"),
		})).character;
		const party = await store.pGetPartyInventory({accountId: dm.id, campaignId: campaign.id});
		const transfer = (await store.pProposeTransfer({
			accountId: player.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: character.id,
			targetKind: "party_inventory",
			targetId: party.id,
			payload: {items: [{entryId: "map", quantity: 1}], currency: {gp: 2}},
			idempotencyKey: key("transfer"),
		})).transfer;
		const action = (await store.pCreateStructuredAction({
			accountId: coDm.id,
			campaignId: campaign.id,
			targetCharacterId: character.id,
			effect: {type: "damage", amount: 2},
			idempotencyKey: key("action"),
		})).action;
		const membership = await store.pGetMembership({accountId: player.id, campaignId: campaign.id});
		const removed = await store.pRemoveMember({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: membership.id,
			idempotencyKey: key("remove"),
		});
		expect(removed).toEqual(expect.objectContaining({
			removedAccountId: player.id,
			detachedCharacterIds: [character.id],
		}));
		expect(await store.pGetMembership({accountId: player.id, campaignId: campaign.id})).toBeNull();
		const detached = (await store.pGetCharacter({accountId: player.id, characterId: character.id})).character;
		expect(detached.campaignId).toBeNull();
		expect(detached.clientImportId).toBeNull();
		expect(detached.data.inventory).toContainEqual(expect.objectContaining({id: "map", quantity: 1}));
		expect(detached.data.currency.gp).toBe(4);
		expect((await store.pListTransfers({accountId: dm.id, campaignId: campaign.id})).find(it => it.id === transfer.id).status).toBe("cancelled");
		expect((await store.pListPendingActions({accountId: dm.id, campaignId: campaign.id})).find(it => it.id === action.id).status).toBe("cancelled");
	});

	it("protects campaign ownership and limits co-DM removal", async () => {
		const ownerMembership = await store.pGetMembership({accountId: dm.id, campaignId: campaign.id});
		await expect(store.pRemoveMember({
			accountId: coDm.id,
			campaignId: campaign.id,
			membershipId: ownerMembership.id,
			idempotencyKey: key("remove-owner"),
		})).rejects.toMatchObject({code: "MEMBERSHIP_OWNER_PROTECTED"});
		const coMembership = await store.pGetMembership({accountId: coDm.id, campaignId: campaign.id});
		await expect(store.pRemoveMember({
			accountId: coDm.id,
			campaignId: campaign.id,
			membershipId: coMembership.id,
			idempotencyKey: key("remove-co"),
		})).rejects.toMatchObject({code: "FORBIDDEN"});
		await expect(store.pLeaveCampaign({
			accountId: dm.id,
			campaignId: campaign.id,
			idempotencyKey: key("owner-leave"),
		})).rejects.toMatchObject({code: "MEMBERSHIP_OWNER_PROTECTED"});
	});

	it("lists/revokes sessions and completes deletion grace, cancellation, and purge", async () => {
		const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
		const first = await store.pCreateSession({accountId: player.id, tokenHash: "a".repeat(64), expiresAt, userAgent: "Laptop"});
		const second = await store.pCreateSession({accountId: player.id, tokenHash: "b".repeat(64), expiresAt, userAgent: "Phone"});
		expect(await store.pListSessions({accountId: player.id, currentSessionId: first.id})).toEqual(expect.arrayContaining([
			expect.objectContaining({id: first.id, isCurrent: true}),
			expect.objectContaining({id: second.id, isCurrent: false}),
		]));
		const revoked = await store.pRevokeOtherSessions({accountId: player.id, currentSessionId: first.id, idempotencyKey: key("revoke-others")});
		expect(revoked.revokedSessionIds).toEqual([second.id]);

		await expect(store.pRequestAccountDeletion({
			accountId: dm.id,
			idempotencyKey: key("owner-delete"),
		})).rejects.toMatchObject({code: "ACCOUNT_OWNS_CAMPAIGN"});

		const requested = await store.pRequestAccountDeletion({
			accountId: player.id,
			idempotencyKey: key("delete"),
		});
		expect(requested.deletion.status).toBe("deletion_requested");
		expect(await store.pGetSessionByTokenHash({tokenHash: "a".repeat(64)})).toBeNull();
		const graceSession = await store.pCreateSession({accountId: player.id, tokenHash: "c".repeat(64), expiresAt, userAgent: "Grace"});
		expect((await store.pGetSessionById({sessionId: graceSession.id})).account.status).toBe("deletion_requested");
		expect((await store.pCancelAccountDeletion({accountId: player.id, idempotencyKey: key("cancel")})).deletion.status).toBe("active");

		await store.pRequestAccountDeletion({accountId: player.id, idempotencyKey: key("delete-again")});
		now = new Date(now.getTime() + 8 * 86_400_000);
		expect(await store.pPurgeDueAccounts()).toEqual({purgedAccountIds: [player.id], blockedAccountIds: []});
		await expect(store.pExportAccountData({accountId: player.id})).rejects.toMatchObject({code: "ACCOUNT_NOT_FOUND"});
	});
});
