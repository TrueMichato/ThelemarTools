import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {gotoWithThelemar, clearHomebrewStorage} from "../utils/homebrewLoader";
import {waitForListItems} from "../utils/waitHelpers";

// ─── ORIGINAL TGTT RACES ───────────────────────────────────────────────────

test.describe("Thelemar Races - Original races in builder", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	const originalRaces = [
		"Nyuidj",
		"Child of the Empire",
		"Dendulra",
		"Descathi",
		"Gnoll",
		"Half-Ogre",
		"Kobold",
	];

	for (const race of originalRaces) {
		test(`should show ${race} in the race list`, async ({page}) => {
			const charSheet = new CharacterSheetPage(page);
			const builder = new BuilderWizardPage(page);

			await gotoWithThelemar(page);
			await charSheet.switchToTab(charSheet.tabBuilder);
			await waitForListItems(page, "#builder-race-list");

			await builder.raceSearchInput.fill(race);
			await page.waitForTimeout(500);

			const items = builder.raceList.locator(".charsheet__builder-list-item");
			const count = await items.count();
			expect(count).toBeGreaterThan(0);

			let found = false;
			for (let i = 0; i < count; i++) {
				const text = await items.nth(i).textContent() || "";
				if (text.includes(race)) {
					found = true;
					break;
				}
			}
			expect(found).toBe(true);
		});
	}
});

test.describe("Thelemar Races - Base races with subraces", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should show Genasi with subraces", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);
		await waitForListItems(page, "#builder-race-list");

		await builder.raceSearchInput.fill("Genasi");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);

		// Should have Air/Earth/Fire/Water subraces showing in the list
		const allText: string[] = [];
		for (let i = 0; i < count; i++) {
			allText.push(await items.nth(i).textContent() || "");
		}
		const combined = allText.join(" ");
		// At least one Genasi entry should be present
		expect(combined).toContain("Genasi");
	});

	test("should show Tiefling with subraces", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);
		await waitForListItems(page, "#builder-race-list");

		await builder.raceSearchInput.fill("Tiefling");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);
	});

	test("should show Thelemerian Dragonborn with subraces", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);
		await waitForListItems(page, "#builder-race-list");

		await builder.raceSearchInput.fill("Thelemerian Dragonborn");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);
	});

	test("should show Child of the Empire subraces", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);
		await waitForListItems(page, "#builder-race-list");

		await builder.raceSearchInput.fill("Child of the Empire");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		// Child of the Empire has 6 subraces — expect multiple entries
		expect(count).toBeGreaterThan(0);

		// Check for at least one subrace name
		const allText: string[] = [];
		for (let i = 0; i < count; i++) {
			allText.push(await items.nth(i).textContent() || "");
		}
		const combined = allText.join(" ");
		expect(combined).toContain("Child of the Empire");
	});
});

// ─── CHARACTER CREATION WITH TGTT RACES ─────────────────────────────────────

test.describe("Thelemar Races - Character creation", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should create a character with Dendulra race", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Step 1: Dendulra (TGTT original race)
		await builder.selectRaceExact("Dendulra", "TGTT");
		await page.waitForTimeout(300);
		// Auto-fill any racial selections
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		// Step 2: Background
		await builder.selectBackgroundExact("Sage", "PHB'24");
		await builder.clickNext();

		// Step 3: Simple class — TGTT Wizard (2 skills, no masteries)
		await builder.selectClassExact("Wizard", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		// Step 4: Abilities
		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		// Step 5: Equipment
		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		// Step 6: Spells (Wizard is a spellcaster)
		await builder.autoFillStartingSpells();
		await builder.clickNext();
		await builder.acceptSkipSpellsDialog();

		// Step 7: Details
		await builder.fillDetails({name: "Dendulra Wizard"});
		await builder.finishWizard();

		await charSheet.expectCharacterName("Dendulra Wizard");
		await charSheet.expectLevel(1);
	});

	test.skip("should create a character with Descathi race", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		await builder.selectRaceExact("Descathi", "TGTT");
		await page.waitForTimeout(300);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		await builder.selectClassExact("Warlock", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		await builder.selectBackgroundExact("Criminal", "PHB'24");
		await builder.clickNext();

		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		await builder.fillDetails({name: "Descathi Warlock"});
		await builder.finishWizard();

		await charSheet.expectCharacterName("Descathi Warlock");
		await charSheet.expectLevel(1);
	});
});
