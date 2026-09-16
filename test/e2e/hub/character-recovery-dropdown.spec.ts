import {expect, test, type Page} from "@playwright/test";

class CharacterRecoveryDropdownPage {
	constructor (private readonly page: Page) {}

	async goto (): Promise<void> {
		await this.page.goto("/charactersheet.html?local=1");
		await this.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
	}

	async pFinalizeDiscardedRecovery ({isRosterRefreshFailure}: {isRosterRefreshFailure: boolean}): Promise<{
		isFinalized: boolean;
		isLaterSaveSuccessful: boolean;
		options: Array<{text: string; value: string}>;
		savedCharacterId: string | null;
		selectedIndex: number;
		selectedText: string | null;
		toasts: Array<{content?: string; type?: string}>;
		value: string;
	}> {
		return this.page.evaluate(async ({isRosterRefreshFailure}) => {
			const sheet = (window as any).charSheet;
			const select = document.querySelector<HTMLSelectElement>("#charsheet-sel-character");
			if (!sheet || !select) throw new Error("Character Sheet dropdown is unavailable.");

			const discardedCharacterId = "discarded-character-id";
			const freshCharacterId = "fresh-character-id";
			sheet._currentCharacterId = discardedCharacterId;
			sheet._updateCharacterDropdown([{
				id: discardedCharacterId,
				name: "Inaccessible Character",
			}]);
			sheet._currentCharacterId = freshCharacterId;
			sheet._state.setId(freshCharacterId);
			sheet._pClaimUnboundLegacyHubRecovery = async () => false;

			let savedCharacterId: string | null = null;
			sheet._characterRepository = {
				isRescueMirrorEnabled: false,
				pList: async () => {
					if (isRosterRefreshFailure) throw new Error("Roster unavailable.");
					return [];
				},
				pUpsert: async ({character}: {character: {id: string}}) => {
					savedCharacterId = character.id;
					return structuredClone(character);
				},
			};

			const toasts: Array<{content?: string; type?: string}> = [];
			const originalDoToast = (globalThis as any).JqueryUtil.doToast;
			(globalThis as any).JqueryUtil.doToast = (toast: {content?: string; type?: string}) => toasts.push(toast);
			try {
				const isFinalized = await sheet._pFinalizeDiscardedHubRecovery({discardedCharacterId});
				sheet._state.setName("Later Save");
				const isLaterSaveSuccessful = await sheet._saveCurrentCharacter();
				return {
					isFinalized,
					isLaterSaveSuccessful,
					options: [...select.options].map(option => ({text: option.textContent || "", value: option.value})),
					savedCharacterId,
					selectedIndex: select.selectedIndex,
					selectedText: select.selectedOptions[0]?.textContent || null,
					toasts,
					value: select.value,
				};
			} finally {
				(globalThis as any).JqueryUtil.doToast = originalDoToast;
			}
		}, {isRosterRefreshFailure});
	}

	async pResolveAliasedDiscardedRecovery (): Promise<{
		freshCharacterId: string;
		isLaterSaveSuccessful: boolean;
		isResolved: boolean;
		options: Array<{text: string; value: string}>;
		savedCharacterId: string | null;
		selectedIndex: number;
		selectedText: string | null;
		toasts: Array<{content?: string; type?: string}>;
		value: string;
	}> {
		return this.page.evaluate(async () => {
			const sheet = (window as any).charSheet;
			const select = document.querySelector<HTMLSelectElement>("#charsheet-sel-character");
			if (!sheet || !select) throw new Error("Character Sheet dropdown is unavailable.");

			const aliasCharacterId = "discarded-client-alias";
			const canonicalCharacterId = "discarded-canonical-id";
			sheet._currentCharacterId = aliasCharacterId;
			sheet._state.setId(aliasCharacterId);
			sheet._updateCharacterDropdown([
				{id: canonicalCharacterId, name: "Inaccessible Character"},
				{id: "other-character-id", name: "Other Character"},
			]);
			sheet._pClaimUnboundLegacyHubRecovery = async () => false;

			let savedCharacterId: string | null = null;
			sheet._characterRepository = {
				isRescueMirrorEnabled: false,
				pList: async () => { throw new Error("Roster unavailable."); },
				pResolveUnprovableRecovery: async ({fnDiscardLive}: {
					fnDiscardLive: (opts: {characterId: string}) => boolean;
				}) => {
					fnDiscardLive({characterId: canonicalCharacterId});
					return null;
				},
				pUpsert: async ({character}: {character: {id: string}}) => {
					savedCharacterId = character.id;
					return structuredClone(character);
				},
			};

			const recovery = {
				intent: "patch",
				character: {id: aliasCharacterId, name: "Inaccessible Character"},
				commands: [{
					character: {id: aliasCharacterId, name: "Inaccessible Character"},
					failureCode: "CHARACTER_NOT_FOUND",
					intent: "patch",
					state: "failed",
				}],
			};
			const toasts: Array<{content?: string; type?: string}> = [];
			const originalDoToast = (globalThis as any).JqueryUtil.doToast;
			const originalPrompt = (globalThis as any).InputUiUtil.pGetUserBoolean;
			const originalDownload = (globalThis as any).DataUtil.userDownload;
			(globalThis as any).JqueryUtil.doToast = (toast: {content?: string; type?: string}) => toasts.push(toast);
			(globalThis as any).InputUiUtil.pGetUserBoolean = async () => true;
			(globalThis as any).DataUtil.userDownload = () => {};
			try {
				const isResolved = await sheet._pResolveUnprovableHubRecovery({
					characterId: aliasCharacterId,
					recovery,
				});
				const freshCharacterId = sheet._currentCharacterId;
				sheet._state.setName("Later Save");
				const isLaterSaveSuccessful = await sheet._saveCurrentCharacter();
				return {
					freshCharacterId,
					isLaterSaveSuccessful,
					isResolved,
					options: [...select.options].map(option => ({text: option.textContent || "", value: option.value})),
					savedCharacterId,
					selectedIndex: select.selectedIndex,
					selectedText: select.selectedOptions[0]?.textContent || null,
					toasts,
					value: select.value,
				};
			} finally {
				(globalThis as any).JqueryUtil.doToast = originalDoToast;
				(globalThis as any).InputUiUtil.pGetUserBoolean = originalPrompt;
				(globalThis as any).DataUtil.userDownload = originalDownload;
			}
		});
	}
}

test.describe("discarded character recovery dropdown", () => {
	test("selects the visible Create New Character option after a successful roster refresh", async ({page}) => {
		const sheet = new CharacterRecoveryDropdownPage(page);
		await sheet.goto();

		const result = await sheet.pFinalizeDiscardedRecovery({isRosterRefreshFailure: false});

		expect(result.isFinalized).toBe(true);
		expect(result.selectedIndex).toBe(0);
		expect(result.value).toBe("");
		expect(result.selectedText).toContain("Create New Character");
		expect(result.options).toEqual([{text: "➕ Create New Character", value: ""}]);
		expect(result.isLaterSaveSuccessful).toBe(true);
		expect(result.savedCharacterId).toBe("fresh-character-id");
	});

	test("prunes a canonical inaccessible option after aliased recovery when roster refresh fails", async ({page}) => {
		const sheet = new CharacterRecoveryDropdownPage(page);
		await sheet.goto();

		const result = await sheet.pResolveAliasedDiscardedRecovery();

		expect(result.isResolved).toBe(true);
		expect(result.selectedIndex).toBe(0);
		expect(result.value).toBe("");
		expect(result.selectedText).toContain("Create New Character");
		expect(result.options).not.toContainEqual(expect.objectContaining({value: "discarded-canonical-id"}));
		expect(result.options).toContainEqual(expect.objectContaining({value: "other-character-id"}));
		expect(result.toasts).toContainEqual({
			type: "warning",
			content: expect.stringContaining("blocked recovery was removed"),
		});
		expect(result.isLaterSaveSuccessful).toBe(true);
		expect(result.freshCharacterId).not.toBe("discarded-client-alias");
		expect(result.freshCharacterId).not.toBe("discarded-canonical-id");
		expect(result.savedCharacterId).toBe(result.freshCharacterId);
	});
});
