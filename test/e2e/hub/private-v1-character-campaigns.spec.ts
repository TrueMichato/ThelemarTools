import {expect, test, type BrowserContext} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

test("Builder adopts the canonical cloud character through a failed roster refresh", async ({browser}) => {
	test.setTimeout(240_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const context = await browser.newContext({
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	});
	try {
		const hub = new HubCampaignPage(await context.newPage());
		await hub.signInSynthetic({providerSubject: "builder-lifecycle-owner", displayName: "Builder Owner", secret});
		const campaignId = await hub.createCampaign("Builder Lifecycle E2E");
		await hub.gotoCampaign(campaignId);
		await hub.waitForSelectedCampaign(campaignId);

		let isCreateCommitted = false;
		let failedRosterRefreshes = 0;
		await hub.page.route(/\/api\/characters(?:\?.*)?$/, async route => {
			if (route.request().method() === "POST") {
				const response = await route.fetch();
				isCreateCommitted = response.ok();
				await route.fulfill({response});
				return;
			}
			if (route.request().method() === "GET" && isCreateCommitted && failedRosterRefreshes === 0) {
				failedRosterRefreshes++;
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: {code: "TEST_ROSTER_REFRESH_FAILED", message: "Synthetic roster refresh failure"}}),
				});
				return;
			}
			await route.continue();
		});
		const missingCharacterReads: string[] = [];
		const browserErrors: string[] = [];
		const failedApiResponses: string[] = [];
		hub.page.on("console", message => {
			if (message.type() === "error") browserErrors.push(message.text());
		});
		hub.page.on("response", response => {
			const url = new URL(response.url());
			if (url.pathname.startsWith("/api/") && response.status() >= 400) {
				failedApiResponses.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
			}
			if (
				response.request().method() === "GET"
				&& /^\/api\/characters\/[^/]+$/.test(url.pathname)
				&& response.status() === 404
			) missingCharacterReads.push(url.pathname);
		});

		const name = "Canonical Builder Hero";
		await createCharacterViaWizard(hub.page, {...PRESET_FIGHTER, name}, {campaignId});

		const active = await hub.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			const select = document.getElementById("charsheet-sel-character") as HTMLSelectElement;
			return {
				characterId: sheet?._currentCharacterId,
				selectedId: select?.value,
				optionText: select?.selectedOptions?.[0]?.textContent,
				saveStatus: document.getElementById("charsheet-save-indicator")?.getAttribute("title"),
				hubCampaignId: sheet?._hubCampaignId,
				repositoryCampaignId: sheet?._characterRepository?._campaignId,
				options: [...(select?.options || [])].map(option => ({value: option.value, text: option.textContent})),
			};
		});
		const unexpectedBrowserErrors = browserErrors.filter(message =>
			!/^Failed to register a ServiceWorker .* An SSL certificate error occurred when fetching the script\.$/.test(message),
		).filter(message =>
			message !== "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
		);
		const unexpectedFailedApiResponses = failedApiResponses.filter(response =>
			response !== "503 GET /api/characters",
		);
		expect({
			hubCampaignId: active.hubCampaignId,
			repositoryCampaignId: active.repositoryCampaignId,
			browserErrors: unexpectedBrowserErrors,
			failedApiResponses: unexpectedFailedApiResponses,
		}).toEqual({
			hubCampaignId: campaignId,
			repositoryCampaignId: campaignId,
			browserErrors: [],
			failedApiResponses: [],
		});
		expect(active.characterId).toMatch(/^[0-9a-f-]{36}$/);
		expect(active.selectedId).toBe(active.characterId);
		expect(active.optionText).toContain(name);
		expect(active.saveStatus).toBe("Auto-save status");
		expect(new URL(hub.page.url()).searchParams.get("id")).toBe(active.characterId);
		expect((await hub.getCharacter(active.characterId)).data.name).toBe(name);
		expect(missingCharacterReads).toEqual([]);
		expect(failedRosterRefreshes).toBe(1);
	} finally {
		await pCloseContext(context);
	}
});

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

test("stale move completion cannot detach the selected character and terminal delete races conceal the old sheet", async ({browser}) => {
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
		await dm.signInSynthetic({providerSubject: "stale-move-dm", displayName: "Stale Move DM", secret});
		await player.signInSynthetic({providerSubject: "stale-move-player", displayName: "Stale Move Player", secret});
		await otherDevice.signInSynthetic({providerSubject: "stale-move-player", displayName: "Stale Move Player", secret});
		const sourceCampaignId = await dm.createCampaign("Stale Move Source E2E");
		const targetCampaignId = await dm.createCampaign("Stale Move Target E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(sourceCampaignId));
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(targetCampaignId));
		const sourceCharacter = await player.createCharacter({campaignId: sourceCampaignId, name: "Deferred Source"});
		const selectedCharacter = await player.createCharacter({campaignId: sourceCampaignId, name: "Selected Survivor"});

		await player.prepareCharacterMove({
			characterId: sourceCharacter.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Deferred Source",
		});
		const retainedUiBeforeFailedLoad = await player.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			sheet._rollHistory.addRoll({
				title: "Retained load probe",
				total: 17,
				breakdown: "12 + 5",
			});
			const mobile = (globalThis as any)._charsheetMobile;
			mobile._statusModels.failedLoadProbe = {value: "retained"};
			return {
				rollCount: sheet._rollHistory._rolls.length,
				rollTitles: sheet._rollHistory._rolls.map((roll: any) => roll.title),
				isMobileScopeSuspended: mobile._isCharacterScopeUiSuspended,
				mobileStatusModels: JSON.stringify(mobile._statusModels),
			};
		});
		const failedLoadPattern = new RegExp(`/api/characters/${selectedCharacter.id}(?:\\?|$)`);
		await player.page.route(failedLoadPattern, async route => {
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {
					code: "TEST_CHARACTER_LOAD_FAILED",
					message: "Synthetic target load failure",
				}}),
			});
		});
		const failedLoadResult = await player.page.evaluate(async characterId => {
			const sheet = (globalThis as any).charSheet;
			try {
				await sheet._pLoadCharacter(characterId);
				return {errorCode: null};
			} catch (error: any) {
				const mobile = (globalThis as any)._charsheetMobile;
				const errorCode = typeof error?.code === "string" ? error.code : error?.code?.code;
				return {
					errorCode: errorCode || null,
					currentCharacterId: sheet._currentCharacterId,
					rollCount: sheet._rollHistory._rolls.length,
					rollTitles: sheet._rollHistory._rolls.map((roll: any) => roll.title),
					isMobileScopeSuspended: mobile._isCharacterScopeUiSuspended,
					mobileStatusModels: JSON.stringify(mobile._statusModels),
				};
			}
		}, selectedCharacter.id);
		await player.page.unroute(failedLoadPattern);
		expect(failedLoadResult).toEqual({
			errorCode: "TEST_CHARACTER_LOAD_FAILED",
			currentCharacterId: sourceCharacter.id,
			...retainedUiBeforeFailedLoad,
		});
		await expect(player.page.locator("#charsheet-ipt-name")).toHaveValue("Deferred Source");

		await player.page.evaluate(async ({selectedCharacterId, sourceCharacterId}) => {
			const sheet = (globalThis as any).charSheet;
			await sheet._pLoadCharacter(selectedCharacterId);
			await sheet._pLoadCharacter(sourceCharacterId);
		}, {
			selectedCharacterId: selectedCharacter.id,
			sourceCharacterId: sourceCharacter.id,
		});
		await expect.poll(() => player.page.evaluate(
			() => (globalThis as any).charSheet._campaign._movePreview,
		)).toBeNull();
		await player.prepareCharacterMove({
			characterId: sourceCharacter.id,
			sourceCampaignId,
			targetCampaignId,
			name: "Deferred Source",
		});
		const moveRequests: string[] = [];
		player.page.on("request", request => {
			if (new URL(request.url()).pathname === `/api/characters/${sourceCharacter.id}/move`) {
				moveRequests.push(request.method());
			}
		});
		await player.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			(globalThis as any).__resolveDeferredMoveSave = null;
			(globalThis as any).__originalMoveSave = sheet._saveCurrentCharacter;
			const deferred = new Promise<boolean>(resolve => {
				(globalThis as any).__resolveDeferredMoveSave = resolve;
			});
			sheet._saveCurrentCharacter = () => deferred;
		});
		const panel = player.page.locator("#charsheet-campaign-panel");
		await panel.getByLabel("I understand that this moves the character instead of creating a copy.").check();
		await panel.locator("button", {hasText: "Move character"}).click();
		await expect.poll(() => player.page.evaluate(() => (globalThis as any).charSheet._campaign._isBusy)).toBe(true);
		await player.page.evaluate(async ({selectedCharacterId, sourceCharacterId}) => {
			const sheet = (globalThis as any).charSheet;
			sheet._saveCurrentCharacter = (globalThis as any).__originalMoveSave;
			await sheet._pLoadCharacter(selectedCharacterId);
			await sheet._pLoadCharacter(sourceCharacterId);
			(globalThis as any).__resolveDeferredMoveSave(true);
		}, {
			selectedCharacterId: selectedCharacter.id,
			sourceCharacterId: sourceCharacter.id,
		});
		await expect.poll(() => player.page.evaluate(() => (globalThis as any).charSheet._campaign._isBusy)).toBe(false);
		expect(moveRequests).toEqual([]);
		await expect(player.page.locator("#charsheet-ipt-name")).toHaveValue("Deferred Source");
		expect(await player.page.evaluate(() => ({
			currentCharacterId: (globalThis as any).charSheet._currentCharacterId,
			realtimeCharacterId: (globalThis as any).charSheet._hubRealtime?._active?.characterId,
		}))).toEqual({
			currentCharacterId: sourceCharacter.id,
			realtimeCharacterId: sourceCharacter.id,
		});
		expect((await player.getCharacter(sourceCharacter.id)).campaignId).toBe(sourceCampaignId);

		await player.page.evaluate(
			characterId => (globalThis as any).charSheet._pLoadCharacter(characterId),
			selectedCharacter.id,
		);
		await player.page.evaluate(() => (globalThis as any).charSheet._detachHubRealtime());
		await otherDevice.deleteCharacterViaApi(selectedCharacter.id);
		const deleteErrorCode = await player.page.evaluate(async () => {
			const originalConfirm = (globalThis as any).InputUiUtil.pGetUserBoolean;
			(globalThis as any).InputUiUtil.pGetUserBoolean = async () => true;
			try {
				await (globalThis as any).charSheet._onDeleteCharacter();
				return null;
			} catch (error: any) {
				return error?.code || null;
			} finally {
				(globalThis as any).InputUiUtil.pGetUserBoolean = originalConfirm;
			}
		});
		expect(deleteErrorCode).toBe("CHARACTER_NOT_FOUND");
		await expect(player.page.locator("#charsheet-campaign-access-ended")).toBeVisible();
		await expect(player.page.locator("main.charsheet-page")).toBeHidden();
		expect(await player.page.evaluate(() => (globalThis as any).charSheet._currentCharacterId)).toBeNull();
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(otherDeviceContext),
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
		]);
		const disabledContext = await source.getCampaignContext(campaignId);
		expect(disabledContext.rulesVersion ?? null).toBeNull();
		expect(disabledContext.capabilities.peerSourceCosts.enabled).toBe(false);
		await source.expectPeerTargetingUnavailable();

		const rulesVersionId = await dm.publishDefaultCampaignRulesViaApi(campaignId);
		await source.waitForPeerTargetingReady();
		const enabledContext = await source.getCampaignContext(campaignId);
		expect(enabledContext.rulesVersion.id).toBe(rulesVersionId);
		expect(enabledContext.capabilities.peerSourceCosts).toMatchObject({
			enabled: true,
			contractVersion: 1,
			protocolVersion: 4,
			operationVersion: 1,
			templateRegistryVersion: "peer-effects-v1",
		});
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

		const xphbSourceCharacter = await source.createCharacter({
			campaignId,
			name: "Aster 2024",
			className: "Cleric",
			classSource: "XPHB",
			spellsKnown: [{
				id: "cure-wounds|XPHB",
				name: "Cure Wounds",
				source: "XPHB",
				level: 1,
				prepared: true,
				sourceClass: "Cleric",
				sourceFeature: "Prepared Spells",
			}],
			rulesVersionId,
		});
		await source.openCharacterSheet({
			campaignId,
			characterId: xphbSourceCharacter.id,
			name: "Aster 2024",
		});
		await source.waitForCharacterRealtimeLive();
		await source.waitForPeerTargetingReady();
		await source.castSpellAtPeerTarget({spellName: "Cure Wounds", targetName: "Bryn"});
		await target.resolveIncomingPeerSpell({spellName: "Cure Wounds", decision: "Approve"});
		await source.expectOutgoingPeerSpellStatus({
			spellName: "Cure Wounds",
			targetName: "Bryn",
			status: "applied",
		});
		await expect.poll(
			async () => (await source.getCharacter(xphbSourceCharacter.id)).data.spellcasting.spellSlots[1].current,
		).toBe(1);
	} finally {
		await Promise.all([dmContext.close(), sourceContext.close(), targetContext.close()]);
	}
});
