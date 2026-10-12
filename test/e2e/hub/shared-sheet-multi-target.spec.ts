import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

const pClose = async (context: BrowserContext) => Promise.race([
	context.close(),
	new Promise<void>(resolve => setTimeout(resolve, 5_000)),
]);

test("shared sheet collects per-character consent, finalizes one subset, and recovers across both entry paths", async ({browser}) => {
	test.setTimeout(240_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const contexts = await Promise.all(Array.from({length: 5}, () => browser.newContext({
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true,
	})));
	try {
		const [dm, source, owner, secondOwner, unrelated] = await Promise.all(contexts.map(async context => new HubCampaignPage(await context.newPage())));
		const names = ["DM", "Source", "Twins owner", "Second owner", "Unrelated"];
		await Promise.all([dm, source, owner, secondOwner, unrelated].map((participant, i) => participant.signInSynthetic({
			providerSubject: `a4-shared-sheet-${i}`, displayName: names[i], secret,
		})));
		const campaignId = await dm.createCampaign("A4 shared sheet multi-target");
		for (const participant of [source, owner, secondOwner, unrelated]) {
			await participant.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		}
		const rulesVersionId = await dm.publishDefaultCampaignRulesViaApi(campaignId);
		const sourceCharacter = await source.createCharacter({
			campaignId, rulesVersionId, name: "Aster", className: "Cleric", hpCurrent: 4,
			spellsKnown: [{id: "cure-wounds|PHB", name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceClass: "Cleric", sourceFeature: "Prepared Spells"}],
		});
		const twin1 = await owner.createCharacter({campaignId, rulesVersionId, name: "Twin", hpCurrent: 3});
		const twin2 = await owner.createCharacter({campaignId, rulesVersionId, name: "Twin", hpCurrent: 5});
		const peerCharacter = await secondOwner.createCharacter({campaignId, rulesVersionId, name: "Bryn", hpCurrent: 3});
		await source.openCharacterSheetFromCampaign({campaignId, characterId: sourceCharacter.id, name: "Aster"});
		expect((await source.getCampaignContext(campaignId)).capabilities.multiTargetOperations.enabled).toBe(false);
		await source.enableReviewedMultiTargetFixture({campaignId, secret});
		await source.prepareReviewedMultiTargetSpellFixture();
		await Promise.all([
			owner.openCharacterSheet({campaignId, characterId: twin1.id, name: "Twin"}),
			secondOwner.openCharacterSheet({campaignId, characterId: peerCharacter.id, name: "Bryn"}),
		]);
		await Promise.all([owner.waitForCharacterRealtimeLive(), secondOwner.waitForCharacterRealtimeLive()]);
		const refs = await source.getMultiTargetRefs(campaignId);
		const chosen = [sourceCharacter.id, twin1.id, twin2.id, peerCharacter.id].map(id => {
			const ref = refs.get(id);
			if (!ref) throw new Error("An authorized candidate target reference is missing.");
			return ref;
		});
		const operation = await source.castReviewedMultiTargetFixture(chosen);
		expect((await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(2);
		expect((await unrelated.getMultiTargetInbox(campaignId))).toEqual([]);
		const ownInvitations = (await owner.getMultiTargetInbox(campaignId)).filter(invitation => invitation.operationId === operation.operationId);
		expect(ownInvitations).toHaveLength(2);
		const ownRef1 = (await owner.getMultiTargetRefs(campaignId)).get(twin1.id);
		const first = ownInvitations.find(invitation => invitation.targetRef === ownRef1);
		const second = ownInvitations.find(invitation => invitation.targetRef !== ownRef1);
		if (!first || !second || first.invitationId === second.invitationId) throw new Error("Independent twin invitation identities are missing.");
		await owner.resolveMultiTargetInvitation({operationId: operation.operationId, invitationId: first.invitationId, decision: "Approve"});
		expect((await owner.getMultiTargetInbox(campaignId)).find(invitation => invitation.invitationId === second.invitationId)?.status).toBe("pending");
		await owner.selectCharacterOnSheet({characterId: twin2.id, name: "Twin"});
		await owner.resolveMultiTargetInvitation({operationId: operation.operationId, invitationId: second.invitationId, decision: "Reject"});
		const peerInvitation = (await secondOwner.getMultiTargetInbox(campaignId)).find(invitation => invitation.operationId === operation.operationId);
		if (!peerInvitation) throw new Error("Second owner's invitation is missing.");
		await secondOwner.resolveMultiTargetInvitation({operationId: operation.operationId, invitationId: peerInvitation.invitationId, decision: "Approve"});
		const sourceView = await source.getMultiTargetDetail({campaignId, operationId: operation.operationId});
		expect(sourceView.status).toBe("awaiting_source_selection");
		expect(sourceView.targets.filter(target => target.status === "approved_by_source")).toHaveLength(1);
		await source.finalizeMultiTargetSubset({operationId: operation.operationId, invitationIds: [first.invitationId, peerInvitation.invitationId]});
		expect((await source.getCharacter(sourceCharacter.id)).data.hp.current).toBe(4);
		expect((await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(1);
		expect((await owner.getCharacter(twin1.id)).data.hp.current).toBe(7);
		expect((await owner.getCharacter(twin2.id)).data.hp.current).toBe(5);
		await expect.poll(async () => (await secondOwner.getCharacter(peerCharacter.id)).data.hp.current).toBe(7);
		const privacy = await source.getMultiTargetDetail({campaignId, operationId: operation.operationId});
		expect(privacy.targets.every(target => !target.result)).toBe(true);
		const dmView = await dm.getMultiTargetDetail({campaignId, operationId: operation.operationId});
		expect(dmView.targets).toHaveLength(4);
		await source.suspendForBfcache();
		await source.resumeFromBfcache();
		await source.waitForCharacterRealtimeLive();
		await owner.selectCharacterOnSheet({characterId: twin1.id, name: "Twin"});
		await owner.expectCharacterSheetHp(7);
		await source.openBareCharacterSheetDefault(campaignId);
		await source.selectCharacterOnSheet({characterId: sourceCharacter.id, name: "Aster"});
		await source.prepareReviewedMultiTargetSpellFixture();
		const expiring = await source.castReviewedMultiTargetFixture([chosen[1], chosen[3]]);
		const expiryInvitation = (await owner.getMultiTargetInbox(campaignId)).find(invitation => invitation.operationId === expiring.operationId);
		if (!expiryInvitation) throw new Error("Expiry invitation is missing.");
		await owner.resolveMultiTargetInvitation({operationId: expiring.operationId, invitationId: expiryInvitation.invitationId, decision: "Approve"});
		await expect.poll(async () => {
			await source.refreshMultiTargetRequests();
			return (await source.getMultiTargetDetail({campaignId, operationId: expiring.operationId})).status;
		}, {timeout: 65_000, intervals: [1_000]}).toBe("awaiting_source_selection");
		await source.finalizeMultiTargetSubset({operationId: expiring.operationId, invitationIds: [expiryInvitation.invitationId]});
		expect((await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(0);
		expect((await owner.getCharacter(twin1.id)).data.hp.current).toBe(11);
		await dm.removeMember({campaignId, displayName: "Twins owner"});
		await owner.expectPrivateCharacterConcealed();
	} finally {
		await Promise.all(contexts.map(pClose));
	}
});
