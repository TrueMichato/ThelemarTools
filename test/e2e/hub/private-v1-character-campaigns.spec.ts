import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

test("campaign characters recover from detachment and copy or move safely", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const otherDeviceContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const otherDevice = new HubCampaignPage(await otherDeviceContext.newPage());

		await dm.signInSynthetic({providerSubject: "character-flow-dm", displayName: "Character Flow DM", secret});
		await player.signInSynthetic({providerSubject: "character-flow-player", displayName: "Mira Thorn", secret});
		await otherDevice.signInSynthetic({providerSubject: "character-flow-player", displayName: "Mira Thorn", secret});

		const sourceCampaignId = await dm.createCampaign("Ember Coast E2E");
		const sourceInvite = await dm.createInviteViaApi(sourceCampaignId);
		await player.redeemInviteTokenViaApi(sourceInvite);
		const targetCampaignId = await dm.createCampaign("Glass Fen E2E");
		await dm.publishDefaultCampaignRulesViaApi(sourceCampaignId);
		await dm.publishDefaultCampaignRulesViaApi(targetCampaignId);
		const targetInvite = await dm.createInviteViaApi(targetCampaignId);
		await player.redeemInviteTokenViaApi(targetInvite);

		const character = await player.createCharacter({campaignId: sourceCampaignId, name: "Mira"});
		await dm.removeMember({campaignId: sourceCampaignId, displayName: "Mira Thorn"});
		expect((await player.getCharacter(character.id)).campaignId).toBeNull();
		await player.expectDetachedCharacterInHub({characterId: character.id, name: "Mira"});

		const returnInvite = await dm.createInviteViaApi(sourceCampaignId);
		await player.redeemInviteTokenViaApi(returnInvite);
		await player.attachDetachedCharacterFromSheet({
			characterId: character.id,
			campaignId: sourceCampaignId,
			name: "Mira",
		});

		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		const clone = await player.cloneCharacterFromSheet({
			characterId: character.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Mira",
		});
		expect(clone.id).not.toBe(character.id);
		expect(clone.campaignId).toBe(targetCampaignId);
		expect(clone.data.carry).toBeUndefined();
		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		await player.prepareCharacterMove({
			characterId: character.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Mira",
		});
		await player.releaseCharacterLease(character.id);
		await otherDevice.acquireCharacterLease(character.id);
		await player.attemptPreparedCharacterMoveExpectingLeaseRefusal();
		expect((await player.getCharacter(character.id)).campaignId).toBe(sourceCampaignId);

		await otherDevice.releaseCharacterLease(character.id);
		const moved = await player.completePreparedCharacterMove({
			characterId: character.id,
			targetCampaignId,
		});
		const canonicalBeforeReplay = await player.getCharacter(character.id);
		expect(canonicalBeforeReplay.campaignId).toBe(targetCampaignId);
		expect(canonicalBeforeReplay.data.carry).toBeUndefined();
		const replay = await player.replayCharacterMove({
			characterId: character.id,
			campaignId: targetCampaignId,
			idempotencyKey: moved.idempotencyKey,
			rulesVersionId: moved.rulesVersionId,
		});
		expect(replay.character.id).toBe(character.id);
		expect(replay.character.campaignId).toBe(targetCampaignId);
		expect(await player.getCharacter(character.id)).toEqual(canonicalBeforeReplay);
		await player.expectStaleCharacterUrlCanonicalized({
			characterId: character.id,
			staleCampaignId: sourceCampaignId,
			canonicalCampaignId: targetCampaignId,
		});
	} finally {
		await Promise.all([
			dmContext.close(),
			playerContext.close(),
			otherDeviceContext.close(),
		]);
	}
});

test("an open character sheet resolves peer effects and adopts authoritative outcomes inline", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const sourceContext = await browser.newContext(contextOptions);
	const targetContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const source = new HubCampaignPage(await sourceContext.newPage());
		const target = new HubCampaignPage(await targetContext.newPage());
		await dm.signInSynthetic({providerSubject: "effect-ui-dm", displayName: "Effect UI DM", secret});
		await source.signInSynthetic({providerSubject: "effect-ui-source", displayName: "Aster", secret});
		await target.signInSynthetic({providerSubject: "effect-ui-target", displayName: "Bryn", secret});

		const campaignId = await dm.createCampaign("Effect UI E2E");
		await source.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await target.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const sourceCharacter = await source.createCharacter({
			campaignId,
			name: "Aster",
			features: [{name: "Steadying Word", source: "PHB"}],
		});
		const targetCharacter = await target.createCharacter({campaignId, name: "Bryn", hpCurrent: 5});
		const targetProjection = await target.getCharacterProjection(targetCharacter.id);

		await source.createPeerEffect({
			campaignId,
			sourceCharacterId: sourceCharacter.id,
			targetRef: targetProjection.targetRef,
			amount: 4,
		});
		await target.openCharacterSheet({campaignId, characterId: targetCharacter.id, name: "Bryn"});

		const effectRegion = target.page.locator("#charsheet-hub-effects");
		await expect(effectRegion).toBeVisible();
		await expect(effectRegion).toContainText("Steadying Word");
		await expect(effectRegion).toContainText("From Aster");
		expect(await effectRegion.getAttribute("hidden")).toBeNull();
		const privateText = await effectRegion.innerText();
		expect(privateText).not.toContain(targetCharacter.id);
		expect(privateText).not.toContain(sourceCharacter.id);

		const hpInput = target.page.locator("#charsheet-ipt-hp-current");
		await target.waitForCharacterRealtimeLive();
		await hpInput.focus();
		await source.createPeerEffect({
			campaignId,
			sourceCharacterId: sourceCharacter.id,
			targetRef: targetProjection.targetRef,
			amount: 2,
		});
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(2, {timeout: 20_000});
		const fourHitPointApproval = effectRegion.getByRole("button", {
			name: "Approve Steadying Word: Restore 4 hit points from Aster",
		});
		await expect(fourHitPointApproval).toBeVisible();
		await expect(hpInput).toBeFocused();

		await fourHitPointApproval.click();
		await expect(hpInput).toHaveValue("9", {timeout: 20_000});
		await expect(effectRegion).toContainText("4 hit points restored by the campaign.");
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(1);

		await effectRegion.getByRole("button", {name: /Reject Steadying Word/}).click();
		await expect(effectRegion.getByRole("button", {name: /Approve Steadying Word/})).toHaveCount(0);
		await expect(hpInput).toHaveValue("9");
		expect(target.page.url()).toContain("/charactersheet.html");
	} finally {
		await Promise.all([dmContext.close(), sourceContext.close(), targetContext.close()]);
	}
});

test("players target Cure Wounds with approval-time source costs and atomic effects", async ({browser}) => {
	test.setTimeout(240_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const sourceContext = await browser.newContext(contextOptions);
	const targetContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const source = new HubCampaignPage(await sourceContext.newPage());
		const target = new HubCampaignPage(await targetContext.newPage());
		await dm.signInSynthetic({providerSubject: "targeting-ui-dm", displayName: "Targeting UI DM", secret});
		await source.signInSynthetic({providerSubject: "targeting-ui-source", displayName: "Aster", secret});
		await target.signInSynthetic({providerSubject: "targeting-ui-target", displayName: "Bryn", secret});

		const campaignId = await dm.createCampaign("Cure Wounds Targeting E2E");
		await dm.publishDefaultCampaignRulesViaApi(campaignId);
		await source.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await target.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const sourceCharacter = await source.createCharacter({
			campaignId,
			name: "Aster",
			hpCurrent: 4,
			className: "Cleric",
			spellsKnown: [{
				id: "cure-wounds|PHB",
				name: "Cure Wounds",
				source: "PHB",
				level: 1,
				prepared: true,
				sourceClass: "Cleric",
				sourceFeature: "Prepared Spells",
			}],
		});
		const targetCharacter = await target.createCharacter({campaignId, name: "Bryn", hpCurrent: 3});

		await Promise.all([
			source.openCharacterSheet({campaignId, characterId: sourceCharacter.id, name: "Aster"}),
			target.openCharacterSheet({campaignId, characterId: targetCharacter.id, name: "Bryn"}),
		]);
		await Promise.all([
			source.waitForCharacterRealtimeLive(),
			target.waitForCharacterRealtimeLive(),
			source.waitForPeerTargetingReady(),
		]);
		await source.page.setViewportSize({width: 390, height: 844});
		await expect.poll(async () => {
			const data = (await source.getCharacter(sourceCharacter.id)).data;
			const targetData = (await target.getCharacter(targetCharacter.id)).data;
			return {
				ability: data.spellcasting?.ability,
				abilityScore: data.abilities?.wis,
				abilityBonus: data.abilityBonuses?.wis,
				cureWounds: data.spellcasting?.spellsKnown?.some((spell: any) =>
					spell.name === "Cure Wounds" && spell.source === "PHB"),
				slots: data.spellcasting?.spellSlots?.[1]?.current,
				targetHp: targetData.hp?.current,
				targetMaxHp: targetData.hp?.effectiveMax ?? targetData.hp?.max,
			};
		}).toEqual({
			ability: "wis",
			abilityScore: 10,
			abilityBonus: 0,
			cureWounds: true,
			slots: 2,
			targetHp: 3,
			targetMaxHp: 12,
		});

		await source.castSpellAtPeerTarget({spellName: "Cure Wounds", targetName: "Bryn"});
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(2);
		await target.resolveIncomingPeerSpell({spellName: "Cure Wounds", decision: "Reject"});
		await source.expectOutgoingPeerSpellStatus({spellName: "Cure Wounds", targetName: "Bryn", status: "rejected"});
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(2);
		expect((await target.getCharacter(targetCharacter.id)).data.hp.current).toBe(3);

		await source.castSpellAtPeerTarget({spellName: "Cure Wounds", targetName: "Bryn"});
		await source.cancelOutgoingPeerSpell({spellName: "Cure Wounds", targetName: "Bryn"});
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(2);
		expect((await target.getCharacter(targetCharacter.id)).data.hp.current).toBe(3);

		await source.castSpellAtPeerTarget({spellName: "Cure Wounds", targetName: "Bryn"});
		await target.resolveIncomingPeerSpell({spellName: "Cure Wounds", decision: "Approve"});
		await source.expectOutgoingPeerSpellStatus({spellName: "Cure Wounds", targetName: "Bryn", status: "applied"});
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(1);
		await expect.poll(async () => (await target.getCharacter(targetCharacter.id)).data.hp.current).toBeGreaterThan(3);
		await expect.poll(() => target.page.locator("#charsheet-ipt-hp-current").inputValue()).not.toBe("3");

		await source.castSpellAtPeerTarget({spellName: "Cure Wounds", targetName: "Aster"});
		await source.resolveIncomingPeerSpell({spellName: "Cure Wounds", decision: "Approve"});
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.spellcasting.spellSlots[1].current).toBe(0);
		await expect.poll(async () => (await source.getCharacter(sourceCharacter.id)).data.hp.current).toBeGreaterThan(4);
	} finally {
		await Promise.all([dmContext.close(), sourceContext.close(), targetContext.close()]);
	}
});
