import {expect, test, type BrowserContext, type Page, type TestInfo} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {HubCampaignPage} from "../pages/HubCampaignPage";

async function pCloseContext (context: BrowserContext): Promise<void> {
	await Promise.race([
		context.close().catch(() => undefined),
		new Promise<void>(resolve => setTimeout(resolve, 5_000)),
	]);
}

async function pCaptureOverview ({
	helper,
	campaignId,
	label,
	primaryAction,
	role,
	testInfo,
	theme,
	viewport,
}: {
	helper: HubCampaignPage;
	campaignId: string;
	label: string;
	primaryAction: "dm" | "character" | "character-setup" | "character-choice" | "read-only";
	role: "dm" | "co_dm" | "player" | "spectator";
	testInfo: TestInfo;
	theme: "day" | "night";
	viewport: {width: number; height: number};
}): Promise<void> {
	await helper.page.setViewportSize(viewport);
	await helper.expectRoleAdaptiveCampaignOverview({campaignId, role, primaryAction});
	await helper.page.evaluate(theme_ => localStorage.setItem("StyleSwitcher_style", theme_), theme);
	await helper.page.reload();
	await expect(helper.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
	const layout = await helper.page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
		theme: document.documentElement.classList.contains("ve-night-mode") ? "night" : "day",
	}));
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
	expect(layout.theme).toBe(theme);
	await testInfo.attach(label, {
		body: await helper.page.screenshot({fullPage: true}),
		contentType: "image/png",
	});
}

test("DM inspection is read-only and condition actions use the canonical picker", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const coDmContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const coDm = new HubCampaignPage(await coDmContext.newPage());
		const conditionModuleRequests: string[] = [];
		await dm.page.route(/\/js\/hub\/hub-condition-catalog\.js(?:\?.*)?$/, async route => {
			conditionModuleRequests.push(route.request().url());
			if (conditionModuleRequests.length === 1) {
				await route.fulfill({
					status: 503,
					contentType: "text/javascript",
					body: "throw new Error('temporary module failure');",
				});
				return;
			}
			await route.continue();
		});
		await dm.signInSynthetic({providerSubject: "authority-dm", displayName: "Authority DM", secret});
		await player.signInSynthetic({providerSubject: "authority-player", displayName: "Authority Player", secret});
		await coDm.signInSynthetic({providerSubject: "authority-codm", displayName: "Authority Co-DM", secret});
		const campaignId = await dm.createCampaign("Authority and Conditions E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await coDm.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId, "co_dm"));
		const character = await player.createCharacter({campaignId, name: "Readonly Rowan"});
		const dmCharacter = await dm.createCharacter({campaignId, name: "Authority DM Character"});
		const playerSheet = new CharacterSheetPage(player.page);
		await playerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		expect(await player.page.evaluate(async () => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setViewMode("play");
			return sheet._saveCurrentCharacter();
		})).toBe(true);

		const dmOwnedSheet = new CharacterSheetPage(dm.page);
		await dmOwnedSheet.gotoCampaignCharacter({campaignId, characterId: dmCharacter.id});
		await dm.page.evaluate(async () => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setSetting("animatedDice", true);
			sheet._state.setSetting("diceSound", false);
			const dice3d = sheet._getDice3d();
			await dice3d._pInit();
			dice3d._box.roll = () => new Promise(() => {});
			(globalThis as any).__accessLossDice = sheet.pAnimateD20({roll: 12, mode: "normal"});
			sheet._customAbilities._showAbilityModal(null);
			const modal = document.querySelector(".custom-abilities__modal")!;
			(modal.querySelector("[name=name]") as HTMLInputElement).value = "SECRET PRIVATE DRAFT";
			(globalThis as any).__accessLossCustomAbilitySave = modal.querySelector(".custom-abilities__save-btn");
		});
		await expect(dm.page.locator(".charsheet__dice3d-overlay")).toHaveClass(/charsheet__dice3d-overlay--active/);
		await dm.page.evaluate(() => (globalThis as any).charSheet._concealHubPrivateCharacter());
		expect(await dm.page.evaluate(() => (globalThis as any).__accessLossDice)).toBe(false);
		await expect(dm.page.locator(".charsheet__dice3d-overlay")).not.toHaveClass(/charsheet__dice3d-overlay--active/);
		await expect(dm.page.locator(".custom-abilities__modal")).toHaveCount(0);
		await expect(dm.page.locator("body")).not.toContainText("SECRET PRIVATE DRAFT");
		await expect(dm.page.locator("main.charsheet-page")).toBeHidden();
		expect(await dm.page.evaluate(() => {
			(globalThis as any).__accessLossCustomAbilitySave?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
			return (globalThis as any).charSheet._state.getCustomAbilities().map((it: any) => it.name);
		})).not.toContain("SECRET PRIVATE DRAFT");
		await dmOwnedSheet.gotoCampaignCharacter({campaignId, characterId: dmCharacter.id});
		await dm.page.evaluate(() => (globalThis as any).charSheet._showCustomModifiersModal());
		await expect(dm.page.locator(".ve-ui-modal__overlay")).toBeVisible();
		await dm.page.locator("#charsheet-btn-add-modifier").click();
		await dm.page.locator("#mod-name").fill("Stale cross-character modifier");
		await dm.page.locator("#mod-value").fill("9");
		await dm.page.evaluate(() => {
			(globalThis as any).__staleCustomModifierSave = document.querySelector("#mod-save");
			const sheet = (globalThis as any).charSheet;
			(globalThis as any).__staleInputUiPrompt = (globalThis as any).InputUiUtil.pGetUserBoolean({
				title: "Scoped authority prompt",
				textYes: "Apply stale mutation",
				textNo: "Cancel",
			}).then((confirmed: boolean) => {
				(globalThis as any).__staleInputUiResult = confirmed;
				if (confirmed) sheet._state.addNamedModifier({
					name: "Stale InputUiUtil modifier",
					type: "ac",
					value: 13,
					enabled: true,
				});
			});
			const overlays = [...document.querySelectorAll(".ve-ui-modal__overlay")];
			(globalThis as any).__staleInputUiConfirm = [...overlays.at(-1)!.querySelectorAll("button")]
				.find(button => button.textContent?.includes("Apply stale mutation"));
		});
		await dm.page.evaluate(async () => {
			const sheet = (globalThis as any).charSheet;
			sheet._customAbilities._showAbilityModal(null);
			const customModal = document.querySelector(".custom-abilities__modal")!;
			(customModal.querySelector("[name=name]") as HTMLInputElement).value = "SECRET REPLACEMENT DRAFT";
			(globalThis as any).__replacementCustomAbilitySave = customModal.querySelector(".custom-abilities__save-btn");

			const abilityId = sheet._state.addCustomAbility({
				name: "Stale combat ability",
				description: "Must remain owned by the character that opened this modal.",
				mode: "active",
				uses: {current: 1, max: 1, recharge: "short"},
				effects: [],
			});
			sheet._combat._showAbilityModal(sheet._state.getCustomAbility(abilityId));
			(globalThis as any).__replacementCombatUseCount = 0;
			const useCustomAbility = sheet._combat._useCustomAbility.bind(sheet._combat);
			sheet._combat._useCustomAbility = (...args: any[]) => {
				(globalThis as any).__replacementCombatUseCount++;
				return useCustomAbility(...args);
			};
			(globalThis as any).__replacementCombatUse = document.querySelector(".charsheet__ability-modal-use");

			await sheet._quickBuild._showWizard();
			(globalThis as any).__replacementQuickBuildNext = document.querySelector("#quickbuild-next");
			(globalThis as any).__replacementQuickBuildStep = sheet._quickBuild._currentStep;

			const weaponId = "scope-bow";
			const quiverId = "scope-quiver";
			const ammoId = "scope-arrow";
			sheet._state.setSetting("animatedDice", true);
			sheet._state.setSetting("diceSound", false);
			const dice3d = sheet._getDice3d();
			if (!sheet._state.getSettings().animatedDice || !dice3d?.canRender?.(8)) {
				throw new Error("Replacement-scope Dice3D precondition unavailable");
			}
			sheet._state._data.inventory.push(
				{
					id: weaponId,
					item: {name: "Scope Bow", type: "R", weapon: true, ammoType: "arrow|xphb"},
					quantity: 1,
					equipped: true,
					attuned: false,
				},
				{
					id: quiverId,
					item: {name: "Scope Quiver", type: "G", containedItems: [ammoId]},
					quantity: 1,
					equipped: true,
					attuned: false,
				},
				{
					id: ammoId,
					item: {name: "Scope Arrow", type: "A", baseItem: "arrow|xphb", arrow: true},
					quantity: 2,
					equipped: false,
					attuned: false,
				},
			);
			sheet._state.setSelectedAmmoId(weaponId, ammoId);
			const weapon = sheet._state.getItems().find((item: any) => item.id === weaponId);
			sheet._combat._cachedAttacks = [{
				id: "scope-bow-attack",
				name: "Scope Bow",
				sourceItem: weapon,
				isSpell: false,
				isMelee: false,
				damage: "1d8",
				damageType: "piercing",
				abilityMod: "dex",
			}];
			(globalThis as any).__replacementAmmoConsumeCount = 0;
			const consumeAmmunition = sheet._state.consumeAmmunition.bind(sheet._state);
			sheet._state.consumeAmmunition = (...args: any[]) => {
				(globalThis as any).__replacementAmmoConsumeCount++;
				return consumeAmmunition(...args);
			};
			(globalThis as any).__replacementDamageSaveCount = 0;
			const saveCharacter = sheet.saveCharacter.bind(sheet);
			sheet.saveCharacter = (...args: any[]) => {
				(globalThis as any).__replacementDamageSaveCount++;
				return saveCharacter(...args);
			};
			(globalThis as any).__replacementDiceResultCount = 0;
			const showDiceResult = sheet.showDiceResult.bind(sheet);
			sheet.showDiceResult = (...args: any[]) => {
				(globalThis as any).__replacementDiceResultCount++;
				return showDiceResult(...args);
			};
			(globalThis as any).__replacementDamageRoll = sheet._combat._rollDamage("scope-bow-attack");
		});
		await expect(dm.page.locator(".custom-abilities__modal")).toBeVisible();
		await expect(dm.page.locator(".charsheet__ability-detail-modal")).toBeVisible();
		await expect(dm.page.locator(".charsheet__quickbuild-overlay")).toBeVisible();
		await expect(dm.page.locator(".charsheet__dice3d-overlay")).toHaveClass(/charsheet__dice3d-overlay--active/);

		let releaseProjectionRead!: () => void;
		let markProjectionReadStarted!: () => void;
		const projectionReadGate = new Promise<void>(resolve => { releaseProjectionRead = resolve; });
		const projectionReadStarted = new Promise<void>(resolve => { markProjectionReadStarted = resolve; });
		const projectionRoute = `**/api/characters/${character.id}`;
		await dm.page.route(projectionRoute, async route => {
			if (route.request().method() !== "GET") {
				await route.continue();
				return;
			}
			markProjectionReadStarted();
			await projectionReadGate;
			await route.continue();
		});
		await dm.page.evaluate(characterId => {
			const sheet = (globalThis as any).charSheet;
			sheet._selCharacter.value = characterId;
			(globalThis as any).__replacementCharacterLoad = sheet._pLoadCharacter(characterId);
		}, character.id);
		await projectionReadStarted;
		await expect(dm.page.locator(".ve-ui-modal__overlay")).toHaveCount(0);
		await expect(dm.page.locator(".custom-abilities__modal")).toHaveCount(0);
		await expect(dm.page.locator("body")).not.toContainText("SECRET REPLACEMENT DRAFT");
		await expect(dm.page.locator(".charsheet__ability-detail-modal")).toHaveCount(0);
		await expect(dm.page.locator(".charsheet__quickbuild-overlay")).toHaveCount(0);
		await expect(dm.page.locator(".charsheet__dice3d-overlay")).not.toHaveClass(/charsheet__dice3d-overlay--active/);
		expect(await dm.page.evaluate(() => document.body.classList.contains("has-quickbuild-overlay"))).toBe(false);
		await dm.page.evaluate(() => (globalThis as any).__replacementDamageRoll);
		expect(await dm.page.evaluate(() => (globalThis as any).__replacementAmmoConsumeCount)).toBe(0);
		expect(await dm.page.evaluate(() => (globalThis as any).__replacementDamageSaveCount)).toBe(0);
		expect(await dm.page.evaluate(() => (globalThis as any).__replacementDiceResultCount)).toBe(0);
		releaseProjectionRead();
		await dm.page.evaluate(() => (globalThis as any).__replacementCharacterLoad);
		await expect(dmOwnedSheet.characterName).toHaveValue("Readonly Rowan", {timeout: 20_000});
		await expect(dmOwnedSheet.characterName).toBeDisabled();
		await dm.page.evaluate(() => {
			(globalThis as any).__staleCustomModifierSave?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
			(globalThis as any).__staleInputUiConfirm?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
			(globalThis as any).__replacementCustomAbilitySave?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
			(globalThis as any).__replacementCombatUse?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
			(globalThis as any).__replacementQuickBuildNext?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		});
		await dm.page.evaluate(() => (globalThis as any).__staleInputUiPrompt);
		expect(await dm.page.evaluate(() => (globalThis as any).__staleInputUiResult)).toBeNull();
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._state.getNamedModifiers()))
			.not.toContainEqual(expect.objectContaining({name: "Stale cross-character modifier"}));
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._state.getNamedModifiers()))
			.not.toContainEqual(expect.objectContaining({name: "Stale InputUiUtil modifier"}));
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._state.getCustomAbilities().map((it: any) => it.name)))
			.toEqual(expect.not.arrayContaining(["SECRET REPLACEMENT DRAFT", "Stale combat ability"]));
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._quickBuild._currentStep))
			.toBe(await dm.page.evaluate(() => (globalThis as any).__replacementQuickBuildStep));
		expect(await dm.page.evaluate(() => (globalThis as any).__replacementCombatUseCount)).toBe(0);
		await dm.page.unroute(projectionRoute);

		await dm.gotoCampaign(campaignId);
		const row = dm.page.locator("#campaign-character-list .hub-data-row", {hasText: "Readonly Rowan"});
		await expect(row).toContainText("Inspect sheet");
		await expect(row).toHaveAttribute("title", "Open this character in a read-only DM view");

		const ownerOnlyRequests: string[] = [];
		const characterMutations: string[] = [];
		dm.page.on("request", request => {
			const pathname = new URL(request.url()).pathname;
			if ([
				`/api/characters/${character.id}/lease`,
				`/api/characters/${character.id}/projection-policy`,
				`/api/campaigns/${campaignId}/characters/${character.id}/pending-actions`,
				`/api/campaigns/${campaignId}/characters/${character.id}/outgoing-actions`,
				`/api/campaigns/${campaignId}/party-inventory`,
			].includes(pathname)) ownerOnlyRequests.push(pathname);
			if (
				pathname === `/api/characters/${character.id}`
				&& ["POST", "PATCH", "DELETE"].includes(request.method())
			) characterMutations.push(request.method());
		});

		await row.click();
		await dm.page.waitForFunction(() => !!(globalThis as any).charSheet, undefined, {timeout: 60_000});
		const dmSheet = new CharacterSheetPage(dm.page);
		await expect(dmSheet.characterName).toHaveValue("Readonly Rowan");
		await expect(dm.page.locator("#charsheet-play-mode")).toBeHidden();
		await expect(dmSheet.characterName).toBeVisible();
		await expect(dmSheet.characterName).toBeDisabled();
		await expect(dm.page.locator("#charsheet-btn-export")).toBeEnabled();
		await expect(dm.page.locator("#charsheet-btn-more")).toBeEnabled();
		await dm.page.locator("#charsheet-btn-more").click();
		await expect(dm.page.locator("#charsheet-header-secondary")).not.toHaveClass(/charsheet__header-row--collapsed/);
		await expect(dm.page.locator("#charsheet-btn-export")).toBeVisible();
		await expect(dm.page.locator("#charsheet-btn-print")).toBeVisible();
		await expect(dm.page.locator("#charsheet-btn-settings")).toBeDisabled();
		await expect(dm.page.locator("#charsheet-campaign .charsheet__campaign-detail"))
			.toContainText("Read-only DM view");
		await expect(dm.page.locator("#charsheet-sel-character option:checked")).toContainText("(read-only)");
		await expect(dm.page.locator(".charsheet__sharing")).toHaveCount(0);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet.isCurrentCharacterReadOnly())).toBe(true);
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._saveCurrentCharacter())).toBe(true);
		const stickyNoteId = await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			const noteId = sheet._state.addStickyNote({
				title: "Read-only positioning note",
				content: "The DM must not move this.",
				position: {x: 24, y: 64},
			});
			sheet._notes._renderStickyNotes();
			sheet._applyCharacterAccessMode();
			return noteId;
		});
		const stickyNote = dm.page.locator(`[data-note-id="${stickyNoteId}"]`);
		await expect(stickyNote).toBeVisible();
		const stickyNotePositionBefore = await stickyNote.evaluate((element: HTMLElement) => ({
			left: element.style.left,
			top: element.style.top,
		}));
		const stickyNoteStateBefore = await dm.page.evaluate(noteId => {
			const note = (globalThis as any).charSheet._state.getStickyNote(noteId);
			return structuredClone(note);
		}, stickyNoteId);
		const stickyTitle = stickyNote.locator(".charsheet__sticky-note-title-row");
		const stickyTitleBox = await stickyTitle.boundingBox();
		if (!stickyTitleBox) throw new Error("Read-only sticky-note title was not measurable.");
		await dm.page.mouse.move(stickyTitleBox.x + 4, stickyTitleBox.y + 4);
		await dm.page.mouse.down();
		await dm.page.mouse.move(stickyTitleBox.x + 84, stickyTitleBox.y + 64);
		await dm.page.mouse.up();
		expect(await stickyNote.evaluate((element: HTMLElement) => ({
			left: element.style.left,
			top: element.style.top,
		}))).toEqual(stickyNotePositionBefore);
		expect(await dm.page.evaluate(
			noteId => structuredClone((globalThis as any).charSheet._state.getStickyNote(noteId)),
			stickyNoteId,
		)).toEqual(stickyNoteStateBefore);
		await dmSheet.waitForHubRealtimeLive();
		await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setViewMode("play");
			sheet._playMode.activate();
		});
		const playModeMore = dm.page.locator("#charsheet-play-mode .pm-status__tool-btn--more");
		await expect(playModeMore).toBeEnabled();
		await playModeMore.click();
		const playModeMenu = dm.page.locator(".pm-context-menu");
		await expect(playModeMenu).toContainText("Export");
		await expect(playModeMenu).toContainText("Print");
		await expect(playModeMenu).not.toContainText("Import");
		await expect(playModeMenu).not.toContainText("Settings");
		await dm.page.keyboard.press("Escape");
		await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setFavorites([
				{id: "test:first", type: "feature", name: "First read-only favorite", icon: "feature"},
				{id: "test:second", type: "feature", name: "Second read-only favorite", icon: "feature"},
			]);
			sheet._playMode.render();
		});
		const lateRoleButton = dm.page.locator("#charsheet-play-mode [role='button']").first();
		await expect(lateRoleButton).toBeVisible();
		await expect(lateRoleButton).toHaveAttribute("aria-disabled", "true");
		await expect(lateRoleButton).toHaveAttribute("tabindex", "-1");
		const stateBeforeKeyboardActivation = await dm.page.evaluate(() => (globalThis as any).charSheet._state.toJson());
		await dm.page.keyboard.press("Control+Shift+P");
		await expect(dm.page.locator("#charsheet-play-mode")).toBeVisible();
		await lateRoleButton.dispatchEvent("keydown", {key: "Enter", code: "Enter"});
		await lateRoleButton.dispatchEvent("keydown", {key: " ", code: "Space"});
		const favorites = dm.page.locator("#charsheet-play-mode .pm-favorite");
		await expect(favorites).toHaveCount(2);
		await expect(favorites.first()).toHaveAttribute("draggable", "false");
		await favorites.first().dispatchEvent("contextmenu");
		await expect(dm.page.locator(".pm-context-menu")).toHaveCount(0);
		await favorites.first().dispatchEvent("dragstart");
		await favorites.nth(1).dispatchEvent("drop");
		expect(await dm.page.evaluate(() => (globalThis as any).charSheet._state.toJson()))
			.toEqual(stateBeforeKeyboardActivation);
		await dm.page.evaluate(() => (globalThis as any).charSheet._playMode.render());
		await expect(dm.page.locator("#charsheet-play-mode [role='button']").first())
			.toHaveAttribute("tabindex", "-1");
		await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setViewMode("sheet");
			sheet._playMode.deactivate();
			(globalThis as any).__dmContextActions = {spawn: 0, manage: 0, cast: 0, mobile: 0};
			sheet._pOpenSpawnDialog = () => { (globalThis as any).__dmContextActions.spawn++; };
			sheet._onManageCharacters = () => { (globalThis as any).__dmContextActions.manage++; };
		});
		await dm.page.locator("#charsheet-btn-new").dispatchEvent("contextmenu");
		await dm.page.locator("#charsheet-btn-delete").dispatchEvent("contextmenu");
		expect(await dm.page.evaluate(() => (globalThis as any).__dmContextActions))
			.toEqual({spawn: 0, manage: 0, cast: 0, mobile: 0});

		await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			const fnIsReadOnly = sheet.isCurrentCharacterReadOnly;
			sheet.isCurrentCharacterReadOnly = () => false;
			sheet._spells._showCastOptionsMenu(null, "Read-only stale cast", [{
				label: "Cast",
				onSelect: () => { (globalThis as any).__dmContextActions.cast++; },
			}]);
			sheet.isCurrentCharacterReadOnly = fnIsReadOnly;
		});
		await expect(dm.page.locator(".charsheet__cast-menu")).toBeVisible();
		await dm.page.locator(".charsheet__cast-menu-option").click();
		await expect(dm.page.locator(".charsheet__cast-menu")).toHaveCount(0);
		expect(await dm.page.evaluate(() => (globalThis as any).__dmContextActions.cast)).toBe(0);

		await dm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			const mobile = (globalThis as any)._charsheetMobile;
			const fnIsReadOnly = sheet.isCurrentCharacterReadOnly;
			const fnGetItems = mobile._getContextMenuItems;
			sheet.isCurrentCharacterReadOnly = () => false;
			mobile._getContextMenuItems = () => [{
				icon: "!",
				label: "Read-only stale mobile action",
				action: () => { (globalThis as any).__dmContextActions.mobile++; },
			}];
			mobile._showContextMenu(document.body, {clientX: 24, clientY: 24});
			mobile._getContextMenuItems = fnGetItems;
			sheet.isCurrentCharacterReadOnly = fnIsReadOnly;
		});
		await expect(dm.page.locator(".charsheet-mobile__context-menu")).toHaveClass(/charsheet-mobile--visible/);
		await dm.page.locator(".charsheet-mobile__context-menu-item").click();
		await expect(dm.page.locator(".charsheet-mobile__context-menu")).not.toHaveClass(/charsheet-mobile--visible/);
		expect(await dm.page.evaluate(() => (globalThis as any).__dmContextActions.mobile)).toBe(0);
		await dm.page.evaluate(() => {
			(globalThis as any).__dmRecipientNotices = [];
			const fnToast = (globalThis as any).JqueryUtil.doToast.bind((globalThis as any).JqueryUtil);
			(globalThis as any).JqueryUtil.doToast = (options: any) => {
				const content = options?.content?.textContent || options?.content || "";
				if (`${content}`.startsWith("Received ")) (globalThis as any).__dmRecipientNotices.push(`${content}`);
				return fnToast(options);
			};
		});
		await dm.grantXpViaApi({
			campaignId,
			characterId: character.id,
			amount: 25,
			reason: "For the player",
		});
		await expect.poll(
			() => dm.page.evaluate(() => (globalThis as any).charSheet._state.toJson().xp),
		).toBe(25);
		expect(await dm.page.evaluate(() => (globalThis as any).__dmRecipientNotices)).toEqual([]);

		let projectionReadRequests = 0;
		let allowProjectionReads = false;
		await dm.page.route(`**/api/characters/${character.id}`, async route => {
			if (route.request().method() !== "GET") {
				await route.continue();
				return;
			}
			projectionReadRequests++;
			if (!allowProjectionReads) {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: {code: "TEST_REFRESH_FAILED", message: "Synthetic projection refresh failure"}}),
				});
				return;
			}
			await route.continue();
		});
		await dm.page.evaluate(() => {
			(globalThis as any).__dmProjectionInvalidations = 0;
			(globalThis as any).__dmProjectionRefreshFailures = 0;
			(globalThis as any).charSheet._hubRealtime.on("projectionInvalidated", () => {
				(globalThis as any).__dmProjectionInvalidations++;
			});
			const fnToast = (globalThis as any).JqueryUtil.doToast.bind((globalThis as any).JqueryUtil);
			(globalThis as any).JqueryUtil.doToast = (options: any) => {
				if (`${options?.content || ""}`.startsWith("Could not refresh this read-only character")) {
					(globalThis as any).__dmProjectionRefreshFailures++;
				}
				return fnToast(options);
			};
		});
		await dmContext.setOffline(true);
		try {
			await dm.page.evaluate(() => (globalThis as any).charSheet?._hubRealtime?._active?.client?._socket?.close());
			await dm.page.waitForFunction(() => {
				const state = (globalThis as any).charSheet?._hubRealtime?._active?.client?._connectionState?.state;
				return state && state !== "live";
			});
			await playerSheet.renameCharacter("Readonly Rowan Updated");
			await expect.poll(async () => (await player.getCharacter(character.id)).data.name)
				.toBe("Readonly Rowan Updated");
		} finally {
			await dmContext.setOffline(false);
		}
		await dmSheet.waitForHubRealtimeLive();
		await expect.poll(async () => {
			const failureCount = await dm.page.evaluate(() => (globalThis as any).__dmProjectionRefreshFailures);
			return projectionReadRequests > 0 && failureCount > 0;
		}).toBe(true);
		await expect(dmSheet.characterName).toHaveValue("Readonly Rowan");
		const invalidationsAfterFailedReconnect = await dm.page.evaluate(
			() => (globalThis as any).__dmProjectionInvalidations,
		);
		expect(invalidationsAfterFailedReconnect).toBeGreaterThan(0);

		const readsBeforeSameCursorReconnect = projectionReadRequests;
		allowProjectionReads = true;
		await dmContext.setOffline(true);
		try {
			await dm.page.evaluate(() => (globalThis as any).charSheet?._hubRealtime?._active?.client?._socket?.close());
			await dm.page.waitForFunction(() => {
				const state = (globalThis as any).charSheet?._hubRealtime?._active?.client?._connectionState?.state;
				return state && state !== "live";
			});
		} finally {
			await dmContext.setOffline(false);
		}
		await dmSheet.waitForHubRealtimeLive();
		await expect(dmSheet.characterName).toHaveValue("Readonly Rowan Updated", {timeout: 20_000});
		expect(projectionReadRequests).toBe(readsBeforeSameCursorReconnect + 1);
		expect(await dm.page.evaluate(() => (globalThis as any).__dmProjectionInvalidations))
			.toBe(invalidationsAfterFailedReconnect);
		await expect(dmSheet.characterName).toBeDisabled();
		await dmSheet.requestHubRealtimeResyncAndWait();
		expect(await dm.page.evaluate(() => (globalThis as any).__dmProjectionInvalidations))
			.toBe(invalidationsAfterFailedReconnect);
		expect(ownerOnlyRequests).toEqual([]);
		expect(characterMutations).toEqual([]);
		expect((await player.getCharacter(character.id)).data.name).toBe("Readonly Rowan Updated");
		await dm.page.evaluate(async () => {
			const {eleModalInner} = await (globalThis as any).CharacterSheetModal.pGetShow({
				title: "Scoped Character Details",
			});
			eleModalInner.textContent = "Readonly Rowan Updated";
		});
		await expect(dm.page.locator(".ve-ui-modal__overlay")).toContainText("Readonly Rowan Updated");
		await dm.page.evaluate(() => (globalThis as any).charSheet._concealHubPrivateCharacter());
		await expect(dm.page.locator(".ve-ui-modal__overlay")).toHaveCount(0);
		await expect(dm.page.locator("main.charsheet-page")).toBeHidden();

		await dm.gotoCampaign(campaignId);
		const conditionDataRequests: string[] = [];
		await dm.page.route(/\/data\/conditionsdiseases\.json(?:\?.*)?$/, async route => {
			conditionDataRequests.push(route.request().url());
			if (conditionDataRequests.length === 1) {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: "temporary condition data failure"}),
				});
				return;
			}
			await route.continue();
		});
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		const actionTarget = dm.page.locator("#campaign-action-target");
		const xpTarget = dm.page.locator("#campaign-xp-target");
		await actionTarget.selectOption({label: "Authority DM Character"});
		await xpTarget.selectOption({label: "Authority DM Character"});
		const itemTargetCheckboxes = dm.page.locator("#campaign-item-targets input[type='checkbox']");
		await expect(itemTargetCheckboxes).toHaveCount(2);
		for (const checkbox of await itemTargetCheckboxes.all()) {
			if (await checkbox.isChecked()) await checkbox.uncheck();
		}
		await expect(dm.page.locator("#campaign-item-targets input[type='checkbox']:checked")).toHaveCount(0);
		await playerSheet.renameCharacter("Readonly Rowan Target Refresh");
		await expect(actionTarget.locator("option", {hasText: "Readonly Rowan Target Refresh"})).toHaveCount(1);
		await expect(actionTarget).toHaveValue(`character:${dmCharacter.id}`);
		await expect(xpTarget).toHaveValue(`character:${dmCharacter.id}`);
		await expect(dm.page.locator("#campaign-item-targets input[type='checkbox']:checked")).toHaveCount(0);
		await expect(dm.page.locator("#campaign-item-form button[type='submit']")).toBeDisabled();

		await actionTarget.selectOption({label: "Readonly Rowan Target Refresh"});
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		const condition = dm.page.locator("#campaign-action-condition");
		await expect(condition).toBeDisabled();
		await expect.poll(() => conditionModuleRequests.length).toBe(1);
		await playerSheet.renameCharacter("Readonly Rowan Module Retry");
		await expect.poll(() => conditionDataRequests.length).toBe(1);
		await expect(condition).toBeDisabled();
		expect(conditionModuleRequests).toHaveLength(2);
		await playerSheet.renameCharacter("Readonly Rowan Recovered");
		await expect.poll(
			async () => (await player.getCharacter(character.id)).data.name,
			{timeout: 20_000},
		).toBe("Readonly Rowan Recovered");
		await dm.page.locator("#campaign-action-target").selectOption({label: "Readonly Rowan Recovered"});
		await expect(condition).toBeEnabled();
		expect(conditionModuleRequests).toHaveLength(2);
		expect(conditionDataRequests).toHaveLength(2);
		expect(conditionModuleRequests[1]).not.toBe(conditionModuleRequests[0]);
		await expect(condition.locator("option", {hasText: "Blinded (PHB)"})).toHaveCount(1);
		await expect(condition.locator("option", {hasText: "Blinded (XPHB)"})).toHaveCount(1);
		await condition.selectOption({label: "Blinded (PHB)"});
		const actionResponsePromise = dm.page.waitForResponse(response => (
			response.request().method() === "POST"
			&& new URL(response.url()).pathname === `/api/campaigns/${campaignId}/actions`
		));
		await dm.page.locator("#campaign-action-form button[type='submit']").click();
		const actionResponse = await actionResponsePromise;
		expect(
			actionResponse.ok(),
			JSON.stringify({
				response: await actionResponse.text(),
				request: actionResponse.request().postDataJSON(),
			}),
		).toBe(true);
		await expect(dm.page.locator("#campaign-action-form-status")).toHaveText("Effect applied.");
		await expect.poll(
			async () => (await player.getCharacter(character.id)).data.conditions,
			{timeout: 20_000},
		).toContainEqual({name: "Blinded", source: "PHB"});

		const coDmSheet = new CharacterSheetPage(coDm.page);
		await coDmSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		await expect(coDmSheet.characterName).toHaveValue("Readonly Rowan Recovered");
		expect(await coDm.page.evaluate(() => (globalThis as any).charSheet._currentCharacterAccess)).toBe("dm_readonly");
		expect(await coDm.page.evaluate(
			characterId => [...(globalThis as any).charSheet._selCharacter.options]
				.some((option: HTMLOptionElement) => option.value === characterId),
			dmCharacter.id,
		)).toBe(true);
		await coDm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			(globalThis as any).__roleLossRealtimeAttachCount = 0;
			const attachHubRealtime = sheet._attachHubRealtime.bind(sheet);
			sheet._attachHubRealtime = (...args: any[]) => {
				(globalThis as any).__roleLossRealtimeAttachCount++;
				return attachHubRealtime(...args);
			};
			(globalThis as any).__roleLossPartyAttachCount = 0;
			const attachPartyInventory = sheet._partyInventory.pAttach.bind(sheet._partyInventory);
			sheet._partyInventory.pAttach = (...args: any[]) => {
				(globalThis as any).__roleLossPartyAttachCount++;
				return attachPartyInventory(...args);
			};
			sheet._detachHubRealtimeClient();
		});
		await dm.changeMemberRoleViaApi({
			campaignId,
			displayName: "Authority Co-DM",
			role: "player",
		});
		const scopedLoadResult = await coDm.page.evaluate(async characterId => {
			const sheet = (globalThis as any).charSheet;
			sheet._selCharacter.value = characterId;
			try {
				await sheet._onCharacterSelect();
				return {code: null};
			} catch (error) {
				return {code: (error as {code?: string})?.code ?? null};
			}
		}, dmCharacter.id);
		expect(scopedLoadResult.code).toBe("CHARACTER_PROJECTION_SCOPED");
		await expect(coDm.page.locator("main.charsheet-page")).toBeHidden();
		await expect(coDm.page.locator("#charsheet-campaign-access-ended")).toHaveAttribute("role", "alert");
		await expect(coDm.page.locator("body")).not.toContainText("Readonly Rowan Recovered");
		expect(await coDm.page.evaluate(targetCharacterId => {
			const sheet = (globalThis as any).charSheet;
			return {
				currentCharacterId: sheet._currentCharacterId,
				currentCharacterName: sheet._state.toJson().name,
				currentAccess: sheet._currentCharacterAccess,
				selectorValue: sheet._selCharacter.value,
				realtimeAttachCount: (globalThis as any).__roleLossRealtimeAttachCount,
				partyAttachCount: (globalThis as any).__roleLossPartyAttachCount,
				isPreviousPartyInventoryAttached: sheet._partyInventory.isAttachedTo?.({characterId: targetCharacterId}),
			};
		}, character.id)).toEqual({
			currentCharacterId: null,
			currentCharacterName: "",
			currentAccess: "owner",
			selectorValue: dmCharacter.id,
			realtimeAttachCount: 0,
			partyAttachCount: 0,
			isPreviousPartyInventoryAttached: false,
		});

		await dm.changeMemberRoleViaApi({
			campaignId,
			displayName: "Authority Co-DM",
			role: "co_dm",
		});
		await coDmSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		await coDmSheet.waitForHubRealtimeLive();
		await coDm.page.waitForTimeout(500);
		await expect(coDm.page.locator("#charsheet-campaign-access-ended")).toHaveCount(0);
		await expect(coDm.page.locator("main.charsheet-page")).toBeVisible();
		await expect(coDmSheet.characterName).toHaveValue("Readonly Rowan Recovered");
		expect(await coDm.page.evaluate(() => (globalThis as any).charSheet._currentCharacterAccess)).toBe("dm_readonly");

		await dm.changeMemberRoleViaApi({
			campaignId,
			displayName: "Authority Co-DM",
			role: "player",
		});
		await expect(coDm.page.locator("#charsheet-campaign-access-ended"))
			.toHaveAttribute("role", "alert", {timeout: 20_000});
		await expect(coDm.page.locator("main.charsheet-page")).toBeHidden();
		expect(await coDm.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			return {
				currentCharacterId: sheet._currentCharacterId,
				currentCharacterName: sheet._state.toJson().name,
				currentAccess: sheet._currentCharacterAccess,
			};
		})).toEqual({
			currentCharacterId: null,
			currentCharacterName: "",
			currentAccess: "owner",
		});
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(playerContext), pCloseContext(coDmContext)]);
	}
});

test("DM same-tab login ignores another account's failed owner recovery and stays live", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmSetupContext = await browser.newContext(contextOptions);
	const sharedContext = await browser.newContext(contextOptions);
	const ownerUpdateContext = await browser.newContext(contextOptions);
	try {
		const dmSetup = new HubCampaignPage(await dmSetupContext.newPage());
		const shared = new HubCampaignPage(await sharedContext.newPage());
		const ownerUpdate = new HubCampaignPage(await ownerUpdateContext.newPage());
		await dmSetup.signInSynthetic({providerSubject: "recovery-dm", displayName: "Recovery DM", secret});
		const ownerSession = await shared.signInSynthetic({
			providerSubject: "recovery-owner",
			displayName: "Recovery Owner",
			secret,
		});
		const ownerAccountId = ownerSession.account?.id;
		if (!ownerAccountId) throw new Error("Synthetic owner session did not return an account id.");
		const campaignId = await dmSetup.createCampaign("Recovery Authority E2E");
		await shared.redeemInviteTokenViaApi(await dmSetup.createInviteViaApi(campaignId));
		const character = await shared.createCharacter({campaignId, name: "Canonical Rowan"});

		const ownerSheet = new CharacterSheetPage(shared.page);
		await ownerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		const characterRoute = `**/api/characters/${character.id}`;
		await shared.page.route(characterRoute, async route => {
			if (route.request().method() !== "PATCH") {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "TEST_SAVE_FAILED", message: "Synthetic save failure"}}),
			});
		});
		expect(await shared.page.evaluate(async () => {
			const sheet = (globalThis as any).charSheet;
			sheet._state.setName("Unsaved Owner Draft");
			return sheet._saveCurrentCharacter();
		})).toBe(false);
		const hasOwnerRecovery = () => shared.page.evaluate(({ownerAccountId, characterId}) => {
			const key = Object.keys(sessionStorage)
				.find(it => it.startsWith("hub-character-recovery:") && it.endsWith(`:${characterId}`));
			if (!key) return false;
			const payload = JSON.parse(sessionStorage.getItem(key) || "null");
			return payload?.ownerAccountId === ownerAccountId;
		}, {ownerAccountId, characterId: character.id});
		await expect.poll(hasOwnerRecovery).toBe(true);
		expect((await shared.getCharacter(character.id)).data.name).toBe("Canonical Rowan");
		await shared.releaseCharacterLease(character.id);

		shared.page.on("dialog", dialog => void dialog.accept());
		await shared.gotoHub();
		await shared.page.locator("#hub-logout").click();
		await expect(shared.page.locator("#hub-signed-out")).toBeVisible();
		await shared.signInSynthetic({providerSubject: "recovery-dm", displayName: "Recovery DM", secret});
		await shared.gotoCampaign(campaignId);
		await shared.page.locator("#campaign-character-list .hub-data-row", {hasText: "Canonical Rowan"}).click();
		await shared.page.waitForFunction(() => !!(globalThis as any).charSheet, undefined, {timeout: 60_000});
		const dmSheet = new CharacterSheetPage(shared.page);
		await expect(dmSheet.characterName).toHaveValue("Canonical Rowan", {timeout: 20_000});
		await expect(dmSheet.characterName).toBeDisabled();
		await dmSheet.waitForHubRealtimeLive();
		await expect.poll(hasOwnerRecovery).toBe(true);
		await shared.page.unroute(characterRoute);

		await ownerUpdate.signInSynthetic({
			providerSubject: "recovery-owner",
			displayName: "Recovery Owner",
			secret,
		});
		const updatingOwnerSheet = new CharacterSheetPage(ownerUpdate.page);
		await updatingOwnerSheet.gotoCampaignCharacter({campaignId, characterId: character.id});
		await updatingOwnerSheet.renameCharacter("Canonical Rowan Updated");
		await expect.poll(() => ownerUpdate.page.evaluate(() => {
			const sheet = (globalThis as any).charSheet;
			const repository = sheet._characterRepository;
			return {
				access: sheet._currentCharacterAccess,
				repositoryAccess: repository.getCharacterAccess({characterId: sheet._currentCharacterId}),
				isNew: sheet._isCurrentCharacterNew,
				stateName: sheet._state.getName(),
			};
		})).toEqual({
			access: "owner",
			repositoryAccess: "owner",
			isNew: false,
			stateName: "Canonical Rowan Updated",
		});
		await expect.poll(
			async () => (await ownerUpdate.getCharacter(character.id)).data.name,
			{timeout: 20_000},
		).toBe("Canonical Rowan Updated");
		await expect(dmSheet.characterName).toHaveValue("Canonical Rowan Updated", {timeout: 20_000});
		await expect(dmSheet.characterName).toBeDisabled();
	} finally {
		await Promise.all([
			pCloseContext(dmSetupContext),
			pCloseContext(sharedContext),
			pCloseContext(ownerUpdateContext),
		]);
	}
});

test("condition catalog module retries exhaust without request storms", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const context = await browser.newContext({
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	});
	try {
		const dm = new HubCampaignPage(await context.newPage());
		const conditionModuleRequests: string[] = [];
		await dm.page.route(/\/js\/hub\/hub-condition-catalog\.js(?:\?.*)?$/, async route => {
			conditionModuleRequests.push(route.request().url());
			await route.fulfill({
				status: 503,
				contentType: "text/javascript",
				body: "throw new Error('persistent module failure');",
			});
		});
		await dm.signInSynthetic({providerSubject: "condition-budget-dm", displayName: "Condition Budget DM", secret});
		const campaignId = await dm.createCampaign("Condition Retry Budget E2E");
		await dm.createCharacter({campaignId, name: "Budget Target"});
		await dm.gotoCampaign(campaignId);
		await expect(dm.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		await dm.page.locator("#campaign-action-target").selectOption({label: "Budget Target"});
		for (let i = 0; i < 6; ++i) {
			await dm.page.locator("#campaign-action-type").selectOption(i % 2 ? "damage" : "condition_add");
		}
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		await expect.poll(() => conditionModuleRequests.length).toBe(3);
		expect(new Set(conditionModuleRequests).size).toBe(3);
		await expect(dm.page.locator("#campaign-action-condition")).toBeDisabled();
		await expect(dm.page.locator("#campaign-action-form-status"))
			.toHaveText("Condition options are unavailable until this page is reloaded.");

		let snapshotRefreshRequests = 0;
		dm.page.on("request", request => {
			if (
				request.method() === "GET"
				&& new URL(request.url()).pathname === `/api/campaigns/${campaignId}/snapshot`
			) snapshotRefreshRequests++;
		});
		await dm.page.locator("#campaign-action-type").selectOption("damage");
		await dm.page.locator("#campaign-action-value").fill("1");
		await dm.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(dm.page.locator("#campaign-action-form-status")).toHaveText("Effect applied.");
		await expect.poll(() => snapshotRefreshRequests).toBeGreaterThan(0);
		await dm.page.locator("#campaign-action-type").selectOption("condition_add");
		expect(conditionModuleRequests).toHaveLength(3);
	} finally {
		await pCloseContext(context);
	}
});

test("peer shared profiles render as visible native disclosures", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const viewerContext = await browser.newContext(contextOptions);
	const ownerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const viewer = new HubCampaignPage(await viewerContext.newPage());
		const owner = new HubCampaignPage(await ownerContext.newPage());
		await dm.signInSynthetic({providerSubject: "shared-profile-dm", displayName: "Shared Profile DM", secret});
		await viewer.signInSynthetic({providerSubject: "shared-profile-viewer", displayName: "Profile Viewer", secret});
		await owner.signInSynthetic({providerSubject: "shared-profile-owner", displayName: "Profile Owner", secret});
		const campaignId = await dm.createCampaign("Shared Profile Disclosure E2E");
		await viewer.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await owner.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const character = await owner.createCharacter({campaignId, name: "Shared Profile Hero"});

		await viewer.gotoCampaign(campaignId);
		await expect(viewer.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		const disclosure = viewer.page.locator("#campaign-party-roster details.hub-shared-profile", {
			hasText: "Shared Profile Hero",
		});
		const summary = disclosure.locator(":scope > summary");
		const body = disclosure.locator(":scope > .hub-shared-profile__body");
		await expect(disclosure).not.toHaveAttribute("open", "");
		await expect(summary).toBeVisible();
		await expect(summary).toContainText("Shared Profile Hero");
		await expect(summary).toContainText("View shared profile");
		await expect(body).toBeHidden();

		await summary.click();
		await expect(disclosure).toHaveAttribute("open", "");
		await expect(body).toBeVisible();
		await expect(body).toContainText("Server-authorized profile shared with players");

		const initialPolicy = await owner.getProjectionPolicy(character.id);
		const hiddenIdentityPolicy = {version: 1, preset: "private", overrides: {hp: {mode: "share"}}};
		const hiddenIdentityResult = await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: initialPolicy.projectionRevision,
			policy: hiddenIdentityPolicy,
		});
		await expect(viewer.page.locator("#campaign-party-roster")).not.toContainText("Shared Profile Hero");

		let markActionsRefreshStarted = () => {};
		const actionsRefreshStarted = new Promise<void>(resolve => {
			markActionsRefreshStarted = resolve;
		});
		let continueActionsRefresh = () => {};
		const actionsRefreshGate = new Promise<void>(resolve => {
			continueActionsRefresh = resolve;
		});
		let isActionsRefreshDeferred = false;
		await viewer.page.route(`**/api/campaigns/${campaignId}/actions`, async route => {
			if (route.request().method() !== "GET" || isActionsRefreshDeferred) {
				await route.continue();
				return;
			}
			isActionsRefreshDeferred = true;
			markActionsRefreshStarted();
			await actionsRefreshGate;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					actions: [{
						operationId: crypto.randomUUID(),
						status: "proposed",
						targetCharacterId: character.id,
						sourceDisplaySnapshot: {identity: {name: "Stale Shared Profile Hero"}},
						targetDisplaySnapshot: {identity: {name: "Shared Profile Hero"}},
						effectDisplaySnapshot: {label: "a stale effect"},
					}],
				}),
			});
		});
		let failSnapshotRefresh = false;
		let failedSnapshotRefreshes = 0;
		await viewer.page.route(`**/api/campaigns/${campaignId}/snapshot`, async route => {
			if (!failSnapshotRefresh) {
				await route.continue();
				return;
			}
			failedSnapshotRefreshes++;
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		});
		const unchangedPolicy = await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: hiddenIdentityResult.projectionRevision,
			policy: hiddenIdentityPolicy,
		});
		await actionsRefreshStarted;
		failSnapshotRefresh = true;
		await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: unchangedPolicy.projectionRevision,
			policy: {version: 1, preset: "private", overrides: {}},
		});
		await expect(viewer.page.locator("#campaign-party-roster")).not.toContainText("Shared Profile Hero", {timeout: 2_000});
		continueActionsRefresh();
		await expect.poll(() => failedSnapshotRefreshes).toBeGreaterThan(0);
		await expect(viewer.page.locator("#campaign-pending-actions")).not.toContainText("Stale Shared Profile Hero");
		await expect(viewer.page.locator("#campaign-party-roster")).not.toContainText("Shared Profile Hero");
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(viewerContext),
			pCloseContext(ownerContext),
		]);
	}
});

test("identity-hidden lifecycle changes converge through projection invalidations", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const ownerContext = await browser.newContext(contextOptions);
	const viewerContext = await browser.newContext(contextOptions);
	try {
		const owner = new HubCampaignPage(await ownerContext.newPage());
		const sourceViewer = new HubCampaignPage(await viewerContext.newPage());
		await owner.signInSynthetic({providerSubject: "lifecycle-owner", displayName: "Lifecycle Owner", secret});
		await sourceViewer.signInSynthetic({providerSubject: "lifecycle-viewer", displayName: "Lifecycle Viewer", secret});
		const sourceCampaignId = await owner.createCampaign("Lifecycle Projection Source");
		const destinationCampaignId = await owner.createCampaign("Lifecycle Projection Destination");
		await sourceViewer.redeemInviteTokenViaApi(await owner.createInviteViaApi(sourceCampaignId));
		await sourceViewer.redeemInviteTokenViaApi(await owner.createInviteViaApi(destinationCampaignId));
		const character = await owner.createCharacter({
			campaignId: sourceCampaignId,
			name: "Hidden Lifecycle Hero",
		});
		const initialPolicy = await owner.getProjectionPolicy(character.id);
		await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: initialPolicy.projectionRevision,
			policy: {version: 1, preset: "private", overrides: {hp: {mode: "share"}}},
		});

		const destinationViewer = new HubCampaignPage(await viewerContext.newPage());
		await sourceViewer.gotoCampaign(sourceCampaignId);
		await destinationViewer.gotoCampaign(destinationCampaignId);
		await expect(sourceViewer.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await expect(destinationViewer.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		const sourceProfiles = sourceViewer.page.locator("#campaign-party-roster details.hub-shared-profile");
		const destinationProfiles = destinationViewer.page.locator("#campaign-party-roster details.hub-shared-profile");
		await expect(sourceProfiles).toHaveCount(1);
		await expect(destinationProfiles).toHaveCount(0);
		await expect(sourceViewer.page.locator("#campaign-party-roster")).not.toContainText("Hidden Lifecycle Hero");

		const clone = await owner.cloneCharacterViaApi({
			characterId: character.id,
			campaignId: destinationCampaignId,
		});
		await expect(destinationProfiles).toHaveCount(1);
		await expect(destinationViewer.page.locator("#campaign-party-roster")).not.toContainText("Hidden Lifecycle Hero");

		await owner.moveCharacterViaApi({
			characterId: character.id,
			campaignId: destinationCampaignId,
		});
		await expect(sourceProfiles).toHaveCount(0);
		await expect(destinationProfiles).toHaveCount(2);

		await owner.archiveCharacterViaApi(clone.id);
		await expect(destinationProfiles).toHaveCount(1);
		await expect(destinationViewer.page.locator("#campaign-party-roster")).not.toContainText("Hidden Lifecycle Hero");
	} finally {
		await Promise.all([
			pCloseContext(ownerContext),
			pCloseContext(viewerContext),
		]);
	}
});

test("a stale transfer refresh cannot discard a draft needed by the next projection generation", async ({browser}) => {
	test.setTimeout(120_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const ownerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const owner = new HubCampaignPage(await ownerContext.newPage());
		await dm.signInSynthetic({providerSubject: "draft-fence-dm", displayName: "Draft Fence DM", secret});
		await owner.signInSynthetic({providerSubject: "draft-fence-owner", displayName: "Draft Fence Owner", secret});
		const campaignId = await dm.createCampaign("Transfer Draft Fence E2E");
		await owner.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		const character = await owner.createCharacter({campaignId, name: "Draft Fence Hero"});

		await dm.gotoCampaign(campaignId);
		await expect(dm.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		const workbench = dm.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		const partySource = dm.page.locator("#campaign-transfer-source option").filter({hasText: "Party inventory"}).first();
		await dm.page.locator("#campaign-transfer-source").selectOption(await partySource.getAttribute("value") || "");
		await dm.page.locator("#campaign-transfer-target").selectOption({label: "Draft Fence Hero"});
		await dm.page.locator("#campaign-transfer-gp").fill("7");
		const selections = await dm.page.evaluate(() => ({
			source: (document.getElementById("campaign-transfer-source") as HTMLSelectElement).value,
			target: (document.getElementById("campaign-transfer-target") as HTMLSelectElement).value,
		}));

		let markFirstRefreshStarted = () => {};
		const firstRefreshStarted = new Promise<void>(resolve => {
			markFirstRefreshStarted = resolve;
		});
		let continueFirstRefresh = () => {};
		const firstRefreshGate = new Promise<void>(resolve => {
			continueFirstRefresh = resolve;
		});
		let isRefreshGateEnabled = false;
		let transferRefreshCount = 0;
		await dm.page.route(`**/api/campaigns/${campaignId}/transfers`, async route => {
			if (route.request().method() !== "GET") {
				await route.continue();
				return;
			}
			if (!isRefreshGateEnabled) {
				await route.continue();
				return;
			}
			transferRefreshCount++;
			if (transferRefreshCount === 1) {
				markFirstRefreshStarted();
				await firstRefreshGate;
			}
			await route.continue();
		});

		const policy = await owner.getProjectionPolicy(character.id);
		const changedPolicy = {
			...policy.policy,
			overrides: {
				...(policy.policy.overrides || {}),
				identity: {mode: "hide"},
			},
		};
		isRefreshGateEnabled = true;
		const firstUpdate = await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: policy.projectionRevision,
			policy: changedPolicy,
		});
		await firstRefreshStarted;
		await owner.setProjectionPolicy({
			characterId: character.id,
			expectedProjectionRevision: firstUpdate.projectionRevision,
			policy: policy.policy,
		});
		continueFirstRefresh();

		await expect.poll(() => transferRefreshCount).toBeGreaterThanOrEqual(2);
		await expect.poll(() => dm.page.evaluate(() => ({
			source: (document.getElementById("campaign-transfer-source") as HTMLSelectElement).value,
			target: (document.getElementById("campaign-transfer-target") as HTMLSelectElement).value,
			gp: (document.getElementById("campaign-transfer-gp") as HTMLInputElement).value,
			hasDraft: !!(document.getElementById("campaign-transfer-form") as any)._hubProjectionTransferDraft,
		}))).toEqual({...selections, gp: "7", hasDraft: false});
		await expect(dm.page.locator("#campaign-transfer-form button[type='submit']")).toBeEnabled();
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(ownerContext)]);
	}
});

test("campaign authorization loss immediately destroys previously visible private surfaces", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		await dm.signInSynthetic({providerSubject: "concealment-dm", displayName: "Concealment DM", secret});
		await player.signInSynthetic({providerSubject: "concealment-player", displayName: "Concealed Player", secret});
		const campaignId = await dm.createCampaign("Authorization Concealment E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await player.createCharacter({campaignId, name: "Private Roster Hero"});

		await player.gotoCampaign(campaignId);
		await expect(player.page.locator("#campaign-content")).toBeVisible();
		await expect(player.page.locator("#campaign-character-list")).toContainText("Private Roster Hero");
		await expect(player.page.locator("#campaign-member-list")).toContainText("Concealed Player");

		await dm.removeMember({campaignId, displayName: "Concealed Player"});

		await expect(player.page.locator("#campaign-content")).toBeHidden({timeout: 20_000});
		await expect(player.page.locator("#campaign-content")).toHaveAttribute("aria-hidden", "true");
		await expect(player.page.locator("#campaign-content")).toBeEmpty();
		await expect(player.page.locator("#hub-error")).toBeVisible();
		await expect(player.page.locator("body")).not.toContainText("Private Roster Hero");
		await expect(player.page.locator("body")).not.toContainText("Concealed Player");
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(playerContext)]);
	}
});

test("confirmed co-DM role loss conceals Campaign Overview after offline cursor or live event", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const offlineCoDmContext = await browser.newContext(contextOptions);
	const liveCoDmContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const offlineCoDm = new HubCampaignPage(await offlineCoDmContext.newPage());
		const liveCoDm = new HubCampaignPage(await liveCoDmContext.newPage());
		await dm.signInSynthetic({providerSubject: "offline-demotion-dm", displayName: "Offline Demotion DM", secret});
		await offlineCoDm.signInSynthetic({providerSubject: "offline-demotion-codm", displayName: "Offline Demotion Co-DM", secret});
		await liveCoDm.signInSynthetic({providerSubject: "live-demotion-codm", displayName: "Live Demotion Co-DM", secret});
		const campaignId = await dm.createCampaign("Offline Authority Concealment E2E");
		await offlineCoDm.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId, "co_dm"));
		await liveCoDm.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId, "co_dm"));
		await dm.createCharacter({campaignId, name: "Offline Private Roster Hero"});

		await offlineCoDm.gotoCampaign(campaignId);
		await expect(offlineCoDm.page.locator("#campaign-content")).toHaveAttribute("data-campaign-role", "co_dm");
		await expect(offlineCoDm.page.locator("#campaign-character-list")).toContainText("Offline Private Roster Hero");
		await offlineCoDm.page.evaluate(() => (globalThis as any).__offlineAuthorityPageMarker = "retained");

		await offlineCoDmContext.setOffline(true);
		await expect(offlineCoDm.page.locator("#campaign-connection-status")).toHaveText("Offline · shown data may be stale");
		await dm.changeMemberRoleViaApi({
			campaignId,
			displayName: "Offline Demotion Co-DM",
			role: "player",
		});
		await offlineCoDmContext.setOffline(false);

		await expect(offlineCoDm.page.locator("#campaign-content")).toBeHidden({timeout: 20_000});
		await expect(offlineCoDm.page.locator("#campaign-content")).toHaveAttribute("aria-hidden", "true");
		await expect(offlineCoDm.page.locator("#campaign-content")).toBeEmpty();
		await expect(offlineCoDm.page.locator("body")).not.toContainText("Offline Private Roster Hero");
		await expect.poll(() => offlineCoDm.page.evaluate(() => (globalThis as any).__offlineAuthorityPageMarker))
			.toBe("retained");

		await liveCoDm.gotoCampaign(campaignId);
		await expect(liveCoDm.page.locator("#campaign-content")).toHaveAttribute("data-campaign-role", "co_dm");
		await expect(liveCoDm.page.locator("#campaign-character-list")).toContainText("Offline Private Roster Hero");
		await liveCoDm.page.evaluate(() => {
			(globalThis as any).__liveAuthorityPageMarker = "retained";
			window.dispatchEvent(new Event("offline"));
		});
		await expect(liveCoDm.page.locator("#campaign-connection-status")).toHaveText("Offline · shown data may be stale");
		await dm.changeMemberRoleViaApi({
			campaignId,
			displayName: "Live Demotion Co-DM",
			role: "player",
		});

		await expect(liveCoDm.page.locator("#campaign-content")).toBeHidden({timeout: 20_000});
		await expect(liveCoDm.page.locator("#campaign-content")).toHaveAttribute("aria-hidden", "true");
		await expect(liveCoDm.page.locator("#campaign-content")).toBeEmpty();
		await expect(liveCoDm.page.locator("body")).not.toContainText("Offline Private Roster Hero");
		await expect.poll(() => liveCoDm.page.evaluate(() => (globalThis as any).__liveAuthorityPageMarker))
			.toBe("retained");
	} finally {
		await offlineCoDmContext.setOffline(false).catch(() => {});
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(offlineCoDmContext),
			pCloseContext(liveCoDmContext),
		]);
	}
});

test("HTTP authorization loss conceals campaign data even when realtime cannot report it", async ({browser}) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		await dm.signInSynthetic({providerSubject: "http-concealment-dm", displayName: "HTTP Concealment DM", secret});
		await player.signInSynthetic({providerSubject: "http-concealment-player", displayName: "HTTP Concealed Player", secret});
		const campaignId = await dm.createCampaign("HTTP Authorization Concealment E2E");
		await player.redeemInviteTokenViaApi(await dm.createInviteViaApi(campaignId));
		await player.createCharacter({campaignId, name: "HTTP Private Hero"});

		await player.page.routeWebSocket(/\/ws\/campaign\//, () => {});
		await player.gotoCampaign(campaignId);
		const workbench = player.page.locator("#campaign-workbench");
		if (!await workbench.evaluate(element => (element as HTMLDetailsElement).open)) {
			await workbench.locator(":scope > summary").click();
		}
		await player.page.locator("#campaign-transfer-source").selectOption({label: "HTTP Private Hero"});
		await player.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		await player.page.locator("#campaign-transfer-gp").fill("1");
		await dm.removeMember({campaignId, displayName: "HTTP Concealed Player"});

		await player.page.locator("#campaign-transfer-form button[type='submit']").click();

		await expect(player.page.locator("#hub-error")).toContainText("no longer have access");
		await expect(player.page.locator("#campaign-content")).toBeHidden();
		await expect(player.page.locator("#campaign-content")).toBeEmpty();
		await expect(player.page.locator("body")).not.toContainText("HTTP Private Hero");
	} finally {
		await Promise.all([pCloseContext(dmContext), pCloseContext(playerContext)]);
	}
});

test("campaign overview remains role-aware across responsive day and night states", async ({browser}, testInfo) => {
	test.setTimeout(180_000);
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");

	const contextOptions = {
		baseURL: process.env.HUB_E2E_ORIGIN || "https://localhost:8443",
		ignoreHTTPSErrors: true,
	};
	const dmContext = await browser.newContext(contextOptions);
	const playerContext = await browser.newContext(contextOptions);
	const spectatorContext = await browser.newContext(contextOptions);
	const pageErrors: string[] = [];
	let archiveTransitionCampaignId: string | null = null;
	const isExpectedArchiveReadFailure = (url: string) => archiveTransitionCampaignId != null
		&& new URL(url).pathname.startsWith(`/api/campaigns/${archiveTransitionCampaignId}/`);
	const watchErrors = (page: Page) => {
		page.on("pageerror", error => pageErrors.push(error.message));
		page.on("console", message => {
			if (message.type() === "error") {
				const source = message.location().url;
				if (source && isExpectedArchiveReadFailure(source)) return;
				pageErrors.push(source ? `${message.text()} (${source})` : message.text());
			}
		});
		page.on("response", response => {
			if (response.status() === 404 && isExpectedArchiveReadFailure(response.url())) return;
			if (response.status() >= 400) pageErrors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
		});
	};

	try {
		const dm = new HubCampaignPage(await dmContext.newPage());
		const player = new HubCampaignPage(await playerContext.newPage());
		const spectator = new HubCampaignPage(await spectatorContext.newPage());
		for (const helper of [dm, player, spectator]) watchErrors(helper.page);

		await dm.signInSynthetic({providerSubject: "overview-dm", displayName: "Dungeon Master", secret});
		await player.signInSynthetic({providerSubject: "overview-player", displayName: "Rowan Vale", secret});
		await spectator.signInSynthetic({providerSubject: "overview-spectator", displayName: "Former Player Observer", secret});
		const campaignId = await dm.createCampaign("The Fellowship of the Unreasonably Long Ashen March");

		const playerInvite = await dm.createInviteViaApi(campaignId, "player");
		const spectatorInvite = await dm.createInviteViaApi(campaignId, "player");
		await player.redeemInviteTokenViaApi(playerInvite);
		await spectator.redeemInviteTokenViaApi(spectatorInvite);
		await player.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character-setup",
		});
		await expect(player.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await player.createCharacter({campaignId, name: "Rowan of the Far-Wandering Lantern"});
		await player.expectCampaignPrimaryAction({
			primaryAction: "character",
			characterName: "Rowan of the Far-Wandering Lantern",
		});
		await player.createCharacter({campaignId, name: "Morrow Quill, Keeper of the Second Watch"});
		await player.expectCampaignPrimaryAction({primaryAction: "character-choice"});
		await spectator.createCharacter({campaignId, name: "Retained Watcher"});
		await spectator.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character",
			characterName: "Retained Watcher",
		});
		await expect(spectator.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await spectator.page.goto("/hub.html");
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "spectator"});
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "player"});
		await spectator.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "character",
			characterName: "Retained Watcher",
		});
		await expect(spectator.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await dm.changeMemberRoleViaApi({campaignId, displayName: "Former Player Observer", role: "spectator"});
		await expect(spectator.page.locator("#campaign-content")).toHaveAttribute("data-campaign-role", "spectator", {timeout: 15_000});
		await spectator.expectCampaignPrimaryAction({primaryAction: "read-only"});
		await expect(spectator.page.locator("#campaign-workbench")).toBeHidden();
		for (let i = 1; i <= 6; ++i) {
			await dm.createCharacter({campaignId, name: `Expedition Member ${i} with a Long Table Name`});
		}

		await pCaptureOverview({
			helper: dm,
			campaignId,
			label: "campaign-overview-desktop-day",
			primaryAction: "dm",
			role: "dm",
			testInfo,
			theme: "day",
			viewport: {width: 1440, height: 900},
		});
		await pCaptureOverview({
			helper: player,
			campaignId,
			label: "campaign-overview-desktop-night",
			primaryAction: "character-choice",
			role: "player",
			testInfo,
			theme: "night",
			viewport: {width: 1440, height: 900},
		});
		await pCaptureOverview({
			helper: dm,
			campaignId,
			label: "campaign-overview-mobile-night",
			primaryAction: "dm",
			role: "dm",
			testInfo,
			theme: "night",
			viewport: {width: 390, height: 844},
		});
		await pCaptureOverview({
			helper: spectator,
			campaignId,
			label: "campaign-overview-mobile-day-read-only",
			primaryAction: "read-only",
			role: "spectator",
			testInfo,
			theme: "day",
			viewport: {width: 390, height: 844},
		});
		// Archival intentionally invalidates any authorization-scoped reads already in flight.
		archiveTransitionCampaignId = campaignId;
		await dm.archiveCampaign(campaignId);
		await player.expectRoleAdaptiveCampaignOverview({
			campaignId,
			role: "player",
			primaryAction: "read-only",
			campaignStatus: "archived",
		});
		const unexpectedPageErrors = pageErrors.filter(message =>
			!/^Failed to register a ServiceWorker .* An SSL certificate error occurred when fetching the script\.$/.test(message),
		);
		expect(unexpectedPageErrors).toEqual([]);
	} finally {
		await Promise.all([
			pCloseContext(dmContext),
			pCloseContext(playerContext),
			pCloseContext(spectatorContext),
		]);
	}
});
