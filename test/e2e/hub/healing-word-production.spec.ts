import { expect, test, type BrowserContext } from "@playwright/test";
import { HubCampaignPage } from "../pages/HubCampaignPage";

const pClose = (context: BrowserContext) => Promise.race([context.close().catch((error) => console.warn("A5 synthetic browser context cleanup failed:", error.message)), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);

for (const sourceBook of ["PHB", "XPHB"]) {
	test(`${sourceBook} production HW/MHW use shared consent, subset and reconnect on both Sheet entry paths`, async ({ browser }) => {
		test.setTimeout(240_000);
		const secret = process.env.HUB_TEST_AUTH_SECRET;
		if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
		const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true })));
		try {
			const [dm, caster, owner, secondOwner, unrelated] = await Promise.all(contexts.map(async (context) => new HubCampaignPage(await context.newPage())));
			const names = ["DM", "Caster", "Twins owner", "Second owner", "Unrelated"];
			await Promise.all(
				[dm, caster, owner, secondOwner, unrelated].map((participant, index) =>
					participant.signInSynthetic({
						providerSubject: `a5-healing-${sourceBook}-${index}`,
						displayName: names[index],
						secret,
					}),
				),
			);
			const campaignId = await dm.createCampaign(`A5 ${sourceBook} production healing`);
			for (const participant of [caster, owner, secondOwner, unrelated]) await participant.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
			const rulesVersionId = await dm.publishDefaultCampaignRulesViaApi(campaignId);
			const source = await caster.createCharacter({
				campaignId,
				rulesVersionId,
				name: "Aster",
				className: "Cleric",
				classSource: sourceBook,
				classLevel: 5,
				hpCurrent: 4,
				spellSlots: { 1: { current: 4, max: 4 }, 2: { current: 3, max: 3 }, 3: { current: 2, max: 2 } },
				spellsKnown: [
					{ id: `healing-word|${sourceBook}`, name: "Healing Word", source: sourceBook, level: 1, prepared: true, sourceClass: "Cleric", sourceFeature: "Prepared Spells" },
					{ id: `mass-healing-word|${sourceBook}`, name: "Mass Healing Word", source: sourceBook, level: 3, prepared: true, sourceClass: "Cleric", sourceFeature: "Prepared Spells" },
				],
			});
			const twinA = await owner.createCharacter({ campaignId, rulesVersionId, name: "Twin", hpCurrent: 3 });
			const twinB = await owner.createCharacter({ campaignId, rulesVersionId, name: "Twin", hpCurrent: 5 });
			const peer = await secondOwner.createCharacter({ campaignId, rulesVersionId, name: "Bryn", hpCurrent: 3 });
			await caster.openCharacterSheetFromCampaign({ campaignId, characterId: source.id, name: "Aster" });
			expect((await caster.getCampaignContext(campaignId)).capabilities.multiTargetOperations.enabled).toBe(false);
			await caster.enableReviewedMultiTargetFixture({ campaignId, secret });
			await caster.refreshProductionMultiTargetCapability();
			await Promise.all([owner.openCharacterSheet({ campaignId, characterId: twinA.id, name: "Twin" }), secondOwner.openCharacterSheet({ campaignId, characterId: peer.id, name: "Bryn" })]);
			await Promise.all([owner.waitForCharacterRealtimeLive(), secondOwner.waitForCharacterRealtimeLive()]);
			await test.step("Propose production Healing Word", () => caster.castSpellAtPeerTarget({ spellName: "Healing Word", targetName: "Bryn" }));
			await secondOwner.expectHealingTableBoundary({ incoming: true, phb: sourceBook === "PHB" });
			expect((await caster.getCharacter(source.id)).data.spellcasting.spellSlots[1].current).toBe(4);
			await test.step("Approve singular healing on the still-open peer sheet", () => secondOwner.resolveIncomingPeerSpell({ spellName: "Healing Word", decision: "Approve" }));
			await caster.expectOutgoingPeerSpellStatus({ spellName: "Healing Word", targetName: "Bryn", status: "applied" });
			expect((await caster.getCharacter(source.id)).data.spellcasting.spellSlots[1].current).toBe(3);
			const hwHp = (await secondOwner.getCharacter(peer.id)).data.hp.current;
			expect(hwHp).toBeGreaterThan(3);
			await test.step("Converge singular HP without reopening the peer sheet", () => secondOwner.expectCharacterSheetHp(hwHp));

			const refs = await test.step("Read authorized production candidate refs", () => caster.getMultiTargetRefs(campaignId));
			const chosen = [source.id, twinA.id, twinB.id, peer.id].map((id) => {
				const ref = refs.get(id);
				if (!ref) throw new Error("An authorized production candidate reference is missing.");
				return ref;
			});
			const operation = await test.step("Propose campaign-entry production Mass Healing Word", () => caster.castProductionMassHealingWord(chosen));
			await caster.expectHealingTableBoundary({ operationId: operation.operationId, phb: sourceBook === "PHB" });
			expect((await caster.getCharacter(source.id)).data.spellcasting.spellSlots[3].current).toBe(2);
			expect(await unrelated.getMultiTargetInbox(campaignId)).toEqual([]);
			const twins = (await owner.getMultiTargetInbox(campaignId)).filter((invitation) => invitation.operationId === operation.operationId);
			expect(twins).toHaveLength(2);
			const ownRef = (await owner.getMultiTargetRefs(campaignId)).get(twinA.id);
			const first = twins.find((invitation) => invitation.targetRef === ownRef);
			const second = twins.find((invitation) => invitation.targetRef !== ownRef);
			if (!first || !second) throw new Error("Exact twin identities are missing.");
			await owner.expectHealingTableBoundary({ incoming: true, phb: sourceBook === "PHB" });
			await owner.resolveMultiTargetInvitation({ operationId: operation.operationId, invitationId: first.invitationId, decision: "Approve" });
			expect((await owner.getMultiTargetInbox(campaignId)).find((invitation) => invitation.invitationId === second.invitationId)?.status).toBe("pending");
			await owner.selectCharacterOnSheet({ characterId: twinB.id, name: "Twin" });
			await owner.resolveMultiTargetInvitation({ operationId: operation.operationId, invitationId: second.invitationId, decision: "Reject" });
			const peerInvitation = (await secondOwner.getMultiTargetInbox(campaignId)).find((invitation) => invitation.operationId === operation.operationId);
			if (!peerInvitation) throw new Error("Second owner's production invitation is missing.");
			await secondOwner.resolveMultiTargetInvitation({ operationId: operation.operationId, invitationId: peerInvitation.invitationId, decision: "Approve" });
			await test.step("Finalize independently approved subset", () => caster.finalizeMultiTargetSubset({ operationId: operation.operationId, invitationIds: [first.invitationId, peerInvitation.invitationId] }));
			expect((await caster.getCharacter(source.id)).data.hp.current).toBe(4);
			expect((await caster.getCharacter(source.id)).data.spellcasting.spellSlots[3].current).toBe(1);
			expect((await owner.getCharacter(twinB.id)).data.hp.current).toBe(5);
			const twinHp = (await owner.getCharacter(twinA.id)).data.hp.current;
			const peerHp = (await secondOwner.getCharacter(peer.id)).data.hp.current;
			expect(twinHp).toBeGreaterThan(3);
			expect(peerHp).toBe(Math.min(12, hwHp + twinHp - 3));
			await secondOwner.expectCharacterSheetHp(peerHp);
			expect((await caster.getMultiTargetDetail({ campaignId, operationId: operation.operationId })).targets.every((target) => !target.result)).toBe(true);
			expect((await dm.getMultiTargetDetail({ campaignId, operationId: operation.operationId })).targets).toHaveLength(4);
			await caster.suspendForBfcache();
			await caster.resumeFromBfcache();
			await caster.waitForCharacterRealtimeLive();
			await owner.selectCharacterOnSheet({ characterId: twinA.id, name: "Twin" });
			await owner.expectCharacterSheetHp(twinHp);

			await caster.openBareCharacterSheetDefault(campaignId);
			await caster.selectCharacterOnSheet({ characterId: source.id, name: "Aster" });
			await caster.refreshProductionMultiTargetCapability();
			const secondCast = await test.step("Propose ordinary-entry production Mass Healing Word", () => caster.castProductionMassHealingWord([chosen[1], chosen[3]]));
			const firstInvitation = (await owner.getMultiTargetInbox(campaignId)).find((invitation) => invitation.operationId === secondCast.operationId);
			const secondInvitation = (await secondOwner.getMultiTargetInbox(campaignId)).find((invitation) => invitation.operationId === secondCast.operationId);
			if (!firstInvitation || !secondInvitation) throw new Error("Ordinary-site production invitations are missing.");
			await owner.resolveMultiTargetInvitation({ operationId: secondCast.operationId, invitationId: firstInvitation.invitationId, decision: "Approve" });
			await secondOwner.resolveMultiTargetInvitation({ operationId: secondCast.operationId, invitationId: secondInvitation.invitationId, decision: "Approve" });
			await caster.finalizeMultiTargetSubset({ operationId: secondCast.operationId, invitationIds: [firstInvitation.invitationId, secondInvitation.invitationId] });
			expect((await caster.getCharacter(source.id)).data.spellcasting.spellSlots[3].current).toBe(0);
			const nextTwinHp = (await owner.getCharacter(twinA.id)).data.hp.current;
			expect(nextTwinHp).toBeGreaterThan(twinHp);
			await owner.expectCharacterSheetHp(nextTwinHp);
			await secondOwner.expectCharacterSheetHp((await secondOwner.getCharacter(peer.id)).data.hp.current);
		} finally {
			await Promise.all(contexts.map(pClose));
		}
	});
}
test("XPHB Lay on Hands binds ordinary acquisition before heal-only cross-user consent and private failure", async ({ browser }) => {
	test.setTimeout(240_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443", ignoreHTTPSErrors: true })));
	try {
		const [dm, caster, owner] = await Promise.all(contexts.map(async (context) => new HubCampaignPage(await context.newPage())));
		await Promise.all(
			[dm, caster, owner].map((participant, index) =>
				participant.signInSynthetic({
					providerSubject: `a5-lay-on-hands-${index}`,
					displayName: ["DM", "Paladin", "Peer owner"][index],
					secret,
				}),
			),
		);
		const campaignId = await dm.createCampaign("A5 ordinary Lay on Hands acquisition");
		for (const participant of [caster, owner]) await participant.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const rulesVersionId = await dm.publishDefaultCampaignRulesViaApi(campaignId);
		const source = await caster.createCharacter({ campaignId, rulesVersionId, name: "Unbound Paladin", className: "Paladin", classSource: "XPHB", classLevel: 1, hpCurrent: 3 });
		const target = await owner.createCharacter({ campaignId, rulesVersionId, name: "Bryn", hpCurrent: 3 });
		const full = await owner.createCharacter({ campaignId, rulesVersionId, name: "Full peer", hpCurrent: 12 });
		const beforeOpening = await caster.getCharacter(source.id);
		expect(beforeOpening.data.features || []).toEqual([]);
		expect(beforeOpening.data.resources || []).toEqual([]);
		await caster.openCharacterSheet({ campaignId, characterId: source.id, name: "Unbound Paladin" });
		const binding = await test.step("Persist ordinary checked-in class acquisition through an actual name edit/save", () => caster.saveOrdinaryLayOnHandsAcquisition({ characterId: source.id, name: "Bound Paladin" }));
		await owner.openCharacterSheet({ campaignId, characterId: target.id, name: "Bryn" });
		await owner.waitForCharacterRealtimeLive();
		await caster.useProductionLayOnHands({ featureId: binding.featureId, amount: 4, targetName: "Bryn" });
		expect((await caster.getCharacter(source.id)).data.resources.find((entry: { id: string }) => entry.id === binding.resourceId).current).toBe(5);
		await owner.expectHealingTableBoundary({ incoming: true });
		await owner.resolveIncomingPeerSpell({ spellName: "Lay on Hands", decision: "Approve" });
		await caster.expectOutgoingPeerSpellStatus({ spellName: "Lay on Hands", targetName: "Bryn", status: "applied" });
		const after = await caster.getCharacter(source.id);
		expect(after.data.resources.find((entry: { id: string }) => entry.id === binding.resourceId)).toMatchObject({ current: 1, max: 5, featureId: binding.featureId });
		expect(after.data.features.find((entry: { id: string }) => entry.id === binding.featureId)).toMatchObject({ resourceId: binding.resourceId, uses: { current: 1, max: 5 } });
		await owner.expectCharacterSheetHp(7);
		await caster.suspendForBfcache();
		await caster.resumeFromBfcache();
		await caster.waitForCharacterRealtimeLive();
		await owner.selectCharacterOnSheet({ characterId: full.id, name: "Full peer" });
		await owner.waitForCharacterRealtimeLive();
		const targetBefore = await owner.getCharacter(full.id);
		await caster.useProductionLayOnHands({ featureId: binding.featureId, amount: 1, targetName: "Full peer" });
		const sourceBefore = await caster.getCharacter(source.id);
		await owner.resolveIncomingPeerSpell({ spellName: "Lay on Hands", decision: "Approve" });
		await caster.expectOutgoingPeerSpellStatus({ spellName: "Lay on Hands", targetName: "Full peer", status: "failed" });
		expect(await caster.getCharacter(source.id)).toEqual(sourceBefore);
		expect(await owner.getCharacter(full.id)).toEqual(targetBefore);
		await owner.expectCharacterSheetHp(12);
	} finally {
		await Promise.all(contexts.map(pClose));
	}
});
