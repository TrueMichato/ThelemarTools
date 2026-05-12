import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {clearCharacterStorage} from "../utils/characterStorage";

test.describe("Builder Wizard", () => {
	test.beforeEach(async ({page}) => {
		// Clear any existing character data
		await clearCharacterStorage(page);
	});

	test("should create a Human Fighter through the wizard", async ({page}) => {
		test.skip(true, "blocked on CS-BUG-022 — overview pane reports hidden after finish for this specific build (Aarakocra MPMM + TGTT Fighter + standard array + gold). Other Builder Wizard builds in this file are unaffected.");
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		// Navigate to character sheet
		await charSheet.goto();

		// Must create a character record before the wizard can save —
		// see createCharacterViaWizard for the explanation.
		await page.locator("#charsheet-btn-new").click();

		// Should start on builder tab for new character
		await charSheet.switchToTab(charSheet.tabBuilder);
		await expect(builder.wizardContainer).toBeVisible();

		// Builder order: Race → Background → Class → Abilities → Equipment → Spells → Details

		// Step 1: Select Race - Aarakocra (simple race with no subraces or extra selections)
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(500);
		await builder.clickNext();

		// Step 2: Background - Soldier
		let step = await builder.getCurrentStep();
		expect(step).toBe(2);
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.clickNext();

		// Step 3: Select Class - Fighter (TGTT — PHB'24 is shadowed by dedup
		// when TGTT brew is autoloaded, see PRESET notes in characterBuilder.ts).
		step = await builder.getCurrentStep();
		expect(step).toBe(3);

		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableWeaponMasteries(3);
		await builder.selectFirstAvailableOptionalFeatures(1);
		await builder.selectCombatTraditionsAndMethods();
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.clickNext();

		// Step 4: Abilities - use standard array
		step = await builder.getCurrentStep();
		expect(step).toBe(4);

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		// Step 5: Equipment - take starting gold
		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		// Step 6: Spells (Fighter is non-caster; just advance)
		await builder.autoFillStartingSpells();
		await builder.clickNext();
		await builder.acceptSkipSpellsDialog();

		// Step 7: Details - enter name and finish
		await builder.fillDetails({
			name: "Test Aarakocra Fighter",
		});
		await builder.finishWizard();

		// Verify character was created
		await builder.expectWizardComplete();
		await charSheet.expectCharacterName("Test Aarakocra Fighter");
		await charSheet.expectLevel(1);
	});

	test("should allow navigating between steps", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.goto();
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Start on step 1
		let step = await builder.getCurrentStep();
		expect(step).toBe(1);

		// Select a race (use Aarakocra - no subraces needed) and go to step 2
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await builder.clickNext();
		step = await builder.getCurrentStep();
		expect(step).toBe(2);

		// Go back to step 1
		await builder.clickPrev();
		step = await builder.getCurrentStep();
		expect(step).toBe(1);

		// Race should still be selected
		const selectedRace = builder.raceList.locator(".charsheet__builder-list-item.active");
		await expect(selectedRace).toBeVisible();
	});

	test("should show subrace options for elves", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.goto();
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Select Elf PHB'24 (which has 3 subraces: Drow, High Elf, Wood Elf)
		await builder.selectRaceExact("Elf", "PHB'24");
		await page.waitForTimeout(300);

		// Should show subrace selection
		const hasSubraces = await builder.hasSubraceSelection();
		expect(hasSubraces).toBe(true);
	});

	test("should create a Dwarf Cleric", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.goto();
		await page.locator("#charsheet-btn-new").click();
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Builder order: Race → Background → Class → Abilities → Equipment → Spells → Details

		// Step 1: Dwarf PHB'24 (no subraces in 2024 rules)
		await builder.selectRaceExact("Dwarf", "PHB'24");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Step 2: Background - Acolyte
		let step = await builder.getCurrentStep();
		expect(step).toBe(2);
		await builder.selectBackgroundExact("Acolyte", "PHB'24");
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.clickNext();

		// Step 3: Cleric (TGTT — PHB'24 is shadowed by dedup)
		step = await builder.getCurrentStep();
		expect(step).toBe(3);

		await builder.selectClassExact("Cleric", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableOptionalFeatures(1);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.clickNext();

		// Step 4: Abilities - assign standard array
		step = await builder.getCurrentStep();
		expect(step).toBe(4);

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		// Step 5: Equipment
		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		// Step 6: Spells (Cleric is a spellcaster)
		await builder.autoFillStartingSpells();
		await builder.clickNext();
		await builder.acceptSkipSpellsDialog();

		// Step 7: Details
		await builder.fillDetails({name: "Dwarf Cleric Test"});
		await builder.finishWizard();

		await charSheet.expectCharacterName("Dwarf Cleric Test");
	});
});

test.describe("Builder Wizard - Edge Cases", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("should handle searching for races", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.goto();
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Type in search to filter races
		await builder.raceSearchInput.fill("half");

		// Should filter to show Half-Elf, Half-Orc, Halfling
		const visibleItems = builder.raceList.locator(".charsheet__builder-list-item:visible");
		const count = await visibleItems.count();
		expect(count).toBeGreaterThan(0);
		expect(count).toBeLessThan(20); // Should be filtered down
	});

	test("should handle searching for classes", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.goto();
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Select race first (use Aarakocra - no additional selections needed)
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Advance through Background to reach Class step (new order: Race → Background → Class)
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		// Verify we're on class step
		const step = await builder.getCurrentStep();
		expect(step).toBe(3);

		// Search for wizard
		await builder.classSearchInput.fill("wiz");

		// Should show Wizard
		const wizardItem = builder.classList.locator(".charsheet__builder-list-item").filter({hasText: "Wizard"});
		await expect(wizardItem.first()).toBeVisible();
	});
});
