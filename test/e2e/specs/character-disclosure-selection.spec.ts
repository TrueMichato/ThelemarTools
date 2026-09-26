import {test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";

test.describe("Character selection and Features disclosures", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("reload restores the actual selected character; switching and New Character keep their own state", async ({page}) => {
		const sheet = new CharacterSheetPage(page);
		await sheet.goto();
		const firstId = await sheet.spawnSavedCharacter("fighter/champion/3/human", "First Saved Fighter");
		const secondId = await sheet.spawnSavedCharacter("fighter/champion/3/human", "Second Saved Fighter");

		await sheet.selectCharacter(firstId);
		await sheet.expectCharacterName("First Saved Fighter");
		await sheet.selectCharacter(secondId);
		await sheet.expectCharacterName("Second Saved Fighter");

		await sheet.reloadCharacterSheet();
		await sheet.expectCharacterName("Second Saved Fighter");
		await sheet.expectSelectedCharacter(secondId);

		await sheet.selectCharacter("");
		await sheet.expectSelectedCharacter("");
		await sheet.expectCharacterName("");

		await sheet.selectCharacter(firstId);
		await sheet.expectCharacterName("First Saved Fighter");
		await sheet.selectCharacter(secondId);
		await sheet.expectCharacterName("Second Saved Fighter");
	});

	test("feature and feat disclosures collapse to a right chevron and work with keyboard after rerender", async ({page}) => {
		const sheet = new CharacterSheetPage(page);
		await sheet.goto();
		await sheet.spawnSavedCharacter("fighter/champion/3/human", "Feature Fighter");
		await sheet.switchToTab(sheet.tabFeatures);
		await sheet.expectDisclosureCycle("feature");
		await sheet.expectDisclosureCycle("feat");
	});
});
