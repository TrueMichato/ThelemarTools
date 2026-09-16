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

	test("prunes the inaccessible option when roster refresh fails and keeps later saves unblocked", async ({page}) => {
		const sheet = new CharacterRecoveryDropdownPage(page);
		await sheet.goto();

		const result = await sheet.pFinalizeDiscardedRecovery({isRosterRefreshFailure: true});

		expect(result.isFinalized).toBe(true);
		expect(result.selectedIndex).toBe(0);
		expect(result.value).toBe("");
		expect(result.selectedText).toContain("Create New Character");
		expect(result.options).not.toContainEqual(expect.objectContaining({value: "discarded-character-id"}));
		expect(result.toasts).toContainEqual({
			type: "warning",
			content: expect.stringContaining("blocked recovery was removed"),
		});
		expect(result.isLaterSaveSuccessful).toBe(true);
		expect(result.savedCharacterId).toBe("fresh-character-id");
	});
});
