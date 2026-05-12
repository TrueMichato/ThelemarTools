import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {LevelUpPage} from "../pages/LevelUpPage";
import {gotoWithThelemar, clearHomebrewStorage} from "../utils/homebrewLoader";
import {waitForListItems} from "../utils/waitHelpers";

test.describe("Thelemar Homebrew - Race List", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should show Nyuidj in the race list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Wait for the race list to populate (389 races with homebrew takes time)
		await waitForListItems(page, "#builder-race-list");

		// Search for Nyuidj — a TGTT-original race
		await builder.raceSearchInput.fill("Nyuidj");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);

		let found = false;
		for (let i = 0; i < count; i++) {
			const text = await items.nth(i).textContent() || "";
			if (text.includes("Nyuidj")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	test("should show Child of the Empire in the race list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Wait for race list to populate with homebrew data
		await waitForListItems(page, "#builder-race-list");

		await builder.raceSearchInput.fill("Child of the Empire");
		await page.waitForTimeout(500);

		const items = builder.raceList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);

		let found = false;
		for (let i = 0; i < count; i++) {
			const text = await items.nth(i).textContent() || "";
			if (text.includes("Child of the Empire")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});
});

test.describe("Thelemar Homebrew - Class List", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should show TGTT Fighter in the class list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Wait for race list and pick a race to reach class step
		await waitForListItems(page, "#builder-race-list");
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Step 2 (new order): Background — advance through to reach Class step
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		// Wait for class list and search for Fighter — should find TGTT version
		await waitForListItems(page, "#builder-class-list");
		await builder.classSearchInput.fill("Fighter");
		await page.waitForTimeout(500);

		const items = builder.classList.locator(".charsheet__builder-list-item");
		const count = await items.count();

		let foundTgtt = false;
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const sourceEl = item.locator(".charsheet__builder-list-item-source");
			const source = await sourceEl.textContent() || "";
			if (source.includes("TGTT")) {
				foundTgtt = true;
				break;
			}
		}
		expect(foundTgtt).toBe(true);
	});

	test("should show Dreamwalker class in the class list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		await waitForListItems(page, "#builder-race-list");
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Advance through Background to reach Class step
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		// Wait for class list and search for Dreamwalker — a TGTT-original class
		await waitForListItems(page, "#builder-class-list");
		await builder.classSearchInput.fill("Dreamwalker");
		await page.waitForTimeout(500);

		const items = builder.classList.locator(".charsheet__builder-list-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);

		let found = false;
		for (let i = 0; i < count; i++) {
			const text = await items.nth(i).textContent() || "";
			if (text.includes("Dreamwalker")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	test("should show TGTT Bard in the class list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		await waitForListItems(page, "#builder-race-list");
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Advance through Background to reach Class step
		await builder.selectBackgroundExact("Entertainer", "PHB'24");
		await builder.clickNext();

		await waitForListItems(page, "#builder-class-list");
		await builder.classSearchInput.fill("Bard");
		await page.waitForTimeout(500);

		const items = builder.classList.locator(".charsheet__builder-list-item");
		const count = await items.count();

		let foundTgtt = false;
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const nameEl = item.locator(".charsheet__builder-list-item-name");
			const sourceEl = item.locator(".charsheet__builder-list-item-source");
			const name = await nameEl.textContent() || "";
			const source = await sourceEl.textContent() || "";
			if (name === "Bard" && source.includes("TGTT")) {
				foundTgtt = true;
				break;
			}
		}
		expect(foundTgtt).toBe(true);
	});
});

test.describe("Thelemar Homebrew - Character Creation", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test.skip("should create a Nyuidj TGTT Fighter", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Step 1: Select Nyuidj
		await builder.selectRaceExact("Nyuidj", "TGTT");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Step 2: Select TGTT Fighter
		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);
		// TGTT Fighter: 2 skills from list including custom skills
		await builder.selectFirstAvailableSkills(2);
		// Weapon mastery (from XPHB Fighting Style feature)
		await builder.selectFirstAvailableWeaponMasteries(3);
		// Fighting Style optional feature
		await builder.selectFirstAvailableOptionalFeatures(20);
		// Combat Methods, Specialties, and other feature options
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		// Step 3: Abilities
		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		// Step 4: Background
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		// Step 5: Equipment
		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		// Step 6: Details
		await builder.fillDetails({name: "Nyuidj Fighter"});
		await builder.finishWizard();

		// Verify character was created
		await charSheet.expectCharacterName("Nyuidj Fighter");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Bard character", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Step 1: Race — use Aarakocra for simplicity
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		// Step 2: Background
		await builder.selectBackgroundExact("Entertainer", "PHB'24");
		await builder.clickNext();

		// Step 3: TGTT Bard (3 skills, any)
		await builder.selectClassExact("Bard", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(3);
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

		// Step 6: Spells (Bard is a spellcaster)
		await builder.autoFillStartingSpells();
		await builder.clickNext();
		await builder.acceptSkipSpellsDialog();

		// Step 7: Details
		await builder.fillDetails({name: "TGTT Bard"});
		await builder.finishWizard();

		await charSheet.expectCharacterName("TGTT Bard");
		await charSheet.expectLevel(1);
	});
});

test.describe("Thelemar Homebrew - Level Up", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test.skip("should level up a TGTT Fighter from 1 to 2", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);
		const levelUp = new LevelUpPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Build a TGTT Fighter
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableWeaponMasteries(3);
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		await builder.fillDetails({name: "TGTT Fighter LvlUp"});
		await builder.finishWizard();

		await charSheet.expectLevel(1);

		// Level up
		await charSheet.btnLevelUp.click();
		await levelUp.waitForModal();

		// Handle any visible sections
		if (await levelUp.isAccordionVisible("optfeatures")) {
			await levelUp.expandAccordion("optfeatures");
			await levelUp.selectFirstAvailableOptions();
		}
		if (await levelUp.isAccordionVisible("hp")) {
			await levelUp.expandAccordion("hp");
			await levelUp.selectHpOption("average");
		}

		// Auto-fill any remaining required selections (Combat Methods, etc.)
		await levelUp.autoFillAllSelections();

		await page.waitForTimeout(300);
		await levelUp.finish();
		await levelUp.expectModalClosed();

		await charSheet.expectLevel(2);
	});
});

test.describe("Thelemar Homebrew - Overview Verification", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test.skip("should display ability scores for a TGTT character", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Quick build: Aarakocra TGTT Fighter
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableWeaponMasteries(3);
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		await builder.fillDetails({name: "TGTT Overview Check"});
		await builder.finishWizard();

		// Verify overview tab renders correctly
		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(500);

		// Ability scores should be set from standard array
		const abilities: Array<"str" | "dex" | "con" | "int" | "wis" | "cha"> = ["str", "dex", "con", "int", "wis", "cha"];
		for (const abl of abilities) {
			const scoreEl = page.locator(`#charsheet-ability-${abl}-score`);
			if (await scoreEl.count() > 0 && await scoreEl.isVisible()) {
				const score = await charSheet.getAbilityScore(abl);
				expect(score).toBeGreaterThanOrEqual(8);
				expect(score).toBeLessThanOrEqual(20);
			}
		}

		// Verify character name and level
		await charSheet.expectCharacterName("TGTT Overview Check");
		await charSheet.expectLevel(1);
	});

	test.skip("should display class info for TGTT Fighter", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableWeaponMasteries(3);
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.autoFillRemainingSelections();
		await builder.clickNext();

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		await builder.fillDetails({name: "TGTT Class Check"});
		await builder.finishWizard();

		// The class display should mention Fighter
		if (await charSheet.characterClass.count() > 0 && await charSheet.characterClass.isVisible()) {
			const classText = await charSheet.characterClass.textContent() || "";
			expect(classText.toLowerCase()).toContain("fighter");
		}

		await charSheet.expectLevel(1);
	});
});
