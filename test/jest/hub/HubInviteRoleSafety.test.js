import crypto from "node:crypto";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

describe("invite role safety", () => {
	it("does not demote an active campaign owner who redeems a player invite", async () => {
		const store = new MemoryHubStore();
		const owner = (await store.pUpsertOAuthAccount({provider: "g", providerSubject: "o", displayName: "Owner"})).id;
		const campaign = (await store.pCreateCampaign({accountId: owner, name: "Campaign", idempotencyKey: "campaign"})).campaign;
		const tokenHash = crypto.createHash("sha256").update("invite").digest("hex");
		await store.pCreateInvite({accountId: owner, campaignId: campaign.id, role: "player", tokenHash, expiresAt: new Date(Date.now() + 10000), maxUses: 1, idempotencyKey: "invite"});
		const result = await store.pRedeemInvite({accountId: owner, tokenHash, idempotencyKey: "redeem"});
		expect(result.membership.role).toBe("dm");
	});
});
