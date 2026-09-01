import crypto from "node:crypto";
import {PostgresHubStore} from "../../server/src/postgres-hub-store.js";
import {normalizeHubEvent} from "../../js/hub/hub-event-presentation.js";

const databaseUrl = process.env.HUB_POSTGRES_LIFECYCLE_DATABASE_URL;
const isRequired = process.env.HUB_POSTGRES_LIFECYCLE_REQUIRED === "1";
const describePostgres = databaseUrl || isRequired ? describe : describe.skip;

async function waitForPurge (store, accountId) {
	for (let attempt = 0; attempt < 20; attempt++) {
		const result = await store.pPurgeDueAccounts();
		if (result.purgedAccountIds.includes(accountId)) return result;
		await new Promise(resolve => setTimeout(resolve, 2));
	}
	throw new Error(`Account ${accountId} did not become due for purge.`);
}

describePostgres("PostgreSQL campaign activity lifecycle", () => {
	let store;

	beforeAll(() => {
		if (!databaseUrl) throw new Error("HUB_POSTGRES_LIFECYCLE_DATABASE_URL is required.");
		store = PostgresHubStore.fromConnectionString({
			connectionString: databaseUrl,
			ssl: process.env.HUB_DATABASE_SSL !== "false",
			maxConnections: 2,
		});
	});

	afterAll(async () => {
		await store?.pClose();
	});

	it("executes archive, move, detach, and public deletion with durable endpoint snapshots", async () => {
		const prefix = `activity-pg-${process.pid}-${Date.now()}`;
		const owner = await store.pUpsertOAuthAccount({provider: "github", providerSubject: `${prefix}-owner`, displayName: "Owner"});
		const player = await store.pUpsertOAuthAccount({provider: "github", providerSubject: `${prefix}-player`, displayName: "Player"});
		const deleter = await store.pUpsertOAuthAccount({provider: "github", providerSubject: `${prefix}-deleter`, displayName: "Deleter"});
		const campaign = (await store.pCreateCampaign({
			accountId: owner.id,
			name: `${prefix} Activity`,
			idempotencyKey: `${prefix}-campaign`,
		})).campaign;
		const destination = (await store.pCreateCampaign({
			accountId: owner.id,
			name: `${prefix} Destination`,
			idempotencyKey: `${prefix}-destination`,
		})).campaign;

		const join = async (account, campaignId, key) => {
			const tokenHash = crypto.randomBytes(32).toString("hex");
			await store.pCreateInvite({
				accountId: owner.id,
				campaignId,
				role: "player",
				tokenHash,
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
				idempotencyKey: `${prefix}-${key}-invite`,
			});
			return store.pRedeemInvite({
				accountId: account.id,
				tokenHash,
				idempotencyKey: `${prefix}-${key}-redeem`,
			});
		};
		await join(player, campaign.id, "player-campaign");
		await join(player, destination.id, "player-destination");
		await join(deleter, campaign.id, "deleter-campaign");

		const source = (await store.pCreateCharacter({
			accountId: owner.id,
			campaignId: campaign.id,
			data: {name: "Source", inventory: [], currency: {gp: 100}},
			schemaVersion: 1,
			clientImportId: `${prefix}-source`,
			idempotencyKey: `${prefix}-source`,
		})).character;
		const createTarget = async (account, name, key) => (await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			data: {name},
			schemaVersion: 1,
			clientImportId: `${prefix}-${key}`,
			idempotencyKey: `${prefix}-${key}`,
		})).character;
		const archiveTarget = await createTarget(player, "Before Rename", "archive-target");
		const session = await store.pCreateSession({
			accountId: player.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
			userAgent: "lifecycle-test",
		});
		const sessionId = session.id;
		const archiveLease = await store.pAcquireCharacterLease({
			accountId: player.id,
			sessionId,
			characterId: archiveTarget.id,
		});
		await store.pPatchCharacter({
			accountId: player.id,
			sessionId,
			characterId: archiveTarget.id,
			baseRevision: archiveTarget.revision,
			leaseEpoch: archiveLease.epoch,
			patches: [{op: "replace", path: "/name", value: "After Rename"}],
			idempotencyKey: `${prefix}-rename`,
		});
		const moveTarget = await createTarget(player, "Move Target", "move-target");
		const detachTarget = await createTarget(player, "Detach Target", "detach-target");
		const deleteTarget = await createTarget(deleter, "Delete Target", "delete-target");

		const propose = target => store.pProposeTransfer({
			accountId: owner.id,
			campaignId: campaign.id,
			sourceKind: "character",
			sourceId: source.id,
			targetKind: "character",
			targetId: target.id,
			payload: {currency: {gp: 1}},
			idempotencyKey: `${prefix}-transfer-${target.id}`,
		});
		await propose(archiveTarget);
		await propose(moveTarget);
		await propose(detachTarget);
		await propose(deleteTarget);

		await store.pArchiveCharacter({accountId: player.id, characterId: archiveTarget.id, idempotencyKey: `${prefix}-archive`});
		await store.pMoveCharacter({
			accountId: player.id,
			characterId: moveTarget.id,
			campaignId: destination.id,
			idempotencyKey: `${prefix}-move`,
		});
		const playerMembership = await store.pGetMembership({accountId: player.id, campaignId: campaign.id});
		await store.pRemoveMember({
			accountId: owner.id,
			campaignId: campaign.id,
			membershipId: playerMembership.id,
			idempotencyKey: `${prefix}-detach`,
		});
		await store.pRequestAccountDeletion({
			accountId: deleter.id,
			idempotencyKey: `${prefix}-delete-request`,
			graceMs: 0,
		});
		const purge = await waitForPurge(store, deleter.id);
		expect(purge.purgedAccountIds).toContain(deleter.id);

		const events = await store.pListVisibleEvents({accountId: owner.id, campaignId: campaign.id});
		const cancellations = events.filter(event => event.type === "transfer.cancelled");
		expect(cancellations).toHaveLength(4);
		expect(cancellations.map(event => event.payload.targetCharacterNameSnapshot.displayName).sort()).toEqual([
			"After Rename",
			"Delete Target",
			"Detach Target",
			"Move Target",
		]);
		for (const event of cancellations) {
			expect(event.payload).toEqual(expect.objectContaining({
				sourceKind: "character",
				sourceId: source.id,
				targetKind: "character",
				targetId: expect.any(String),
				sourceCharacterNameSnapshot: {version: 1, displayName: "Source"},
				targetCharacterNameSnapshot: {version: 1, displayName: expect.any(String)},
			}));
		}
		expect(events.find(event => event.type === "character.archived").payload.characterNameSnapshot).toEqual({
			version: 1,
			displayName: "After Rename",
		});
		for (const [characterId, name] of [
			[moveTarget.id, "Move Target"],
			[detachTarget.id, "Detach Target"],
			[deleteTarget.id, "Delete Target"],
		]) {
			expect(events.find(event => event.type === "character.moved_out" && event.aggregateId === characterId).payload.characterNameSnapshot).toEqual({
				version: 1,
				displayName: name,
			});
		}

		const normalized = cancellations.map(event => normalizeHubEvent({event, characters: [], members: []}));
		expect(normalized.map(event => event.title).sort()).toEqual([
			"After Rename's transfer was cancelled.",
			"Delete Target's transfer was cancelled.",
			"Detach Target's transfer was cancelled.",
			"Move Target's transfer was cancelled.",
		]);
		expect(JSON.stringify(normalized)).not.toMatch(new RegExp(`${campaign.id}|${source.id}`));
	});
});
