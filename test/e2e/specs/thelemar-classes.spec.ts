import {expect, test, Page} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {gotoWithThelemar, clearHomebrewStorage} from "../utils/homebrewLoader";
import {waitForListItems} from "../utils/waitHelpers";

/**
 * Helper: build a character with a TGTT class through the full wizard.
 * Uses Aarakocra (simple race) and Soldier background to isolate class testing.
 */
async function buildTgttCharacter (
	page: Page,
	className: string,
	charName: string,
	opts: {skillCount?: number; masteryCount?: number; background?: string; bgSource?: string} = {},
): Promise<{charSheet: CharacterSheetPage; builder: BuilderWizardPage}> {
	const charSheet = new CharacterSheetPage(page);
	const builder = new BuilderWizardPage(page);
	const {skillCount = 2, masteryCount = 0, background = "Soldier", bgSource = "PHB'24"} = opts;

	await gotoWithThelemar(page);
	await charSheet.switchToTab(charSheet.tabBuilder);

	// Builder steps (current order, see js/charactersheet/charactersheet-builder.js):
	//   1. Race  →  2. Background  →  3. Class  →  4. Abilities
	//   5. Equipment  →  6. Spells  →  7. Details

	// Step 1: Race - Aarakocra (MPMM) — simple, no extra selections
	await builder.selectRaceExact("Aarakocra", "MPMM");
	await page.waitForTimeout(300);
	await builder.clickNext();

	// Step 2: Background
	await builder.selectBackgroundExact(background, bgSource);
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 3: Class
	await builder.selectClassExact(className, "TGTT");
	await page.waitForTimeout(500);
	if (skillCount > 0) await builder.selectFirstAvailableSkills(skillCount);
	// Select all optional/feature/mastery checkboxes available
	await builder.selectFirstAvailableWeaponMasteries(10);
	await builder.selectFirstAvailableOptionalFeatures(20);
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.selectCombatTraditionsAndMethods();
	await builder.autoFillRemainingSelections();

	// Try to advance — retry with more filling on each attempt
	for (let attempt = 0; attempt < 4; attempt++) {
		const stepBefore = await builder.getCurrentStep();
		await builder.clickNext();
		await page.waitForTimeout(500);
		const stepAfter = await builder.getCurrentStep();
		if (stepAfter > stepBefore) break;
		// Still on same step — try more aggressive filling
		await builder.selectFirstAvailableOptionalFeatures(20);
		await builder.selectFirstAvailableWeaponMasteries(10);
		await builder.autoFillRemainingSelections();
		await page.waitForTimeout(300);
	}

	// Step 4: Abilities
	await builder.assignStandardArrayDefaults();
	await builder.clickNext();

	// Step 5: Equipment
	await builder.selectEquipmentOption("gold");
	await builder.clickNext();

	// Step 6: Spells — auto-fill any starting spell pickers, accept skip dialog
	await builder.autoFillStartingSpells();
	await builder.clickNext();
	await builder.acceptSkipSpellsDialog();

	// Step 7: Details
	await builder.fillDetails({name: charName});
	await builder.finishWizard();

	return {charSheet, builder};
}

// ─── TGTT CLASS CREATION TESTS ─────────────────────────────────────────────

test.describe("Thelemar Classes - Martial", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should create a TGTT Barbarian", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Barbarian", "TGTT Barbarian", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Barbarian");
		await charSheet.expectLevel(1);
	});

	// TODO: Fighter needs weapon mastery selector fix for TGTT edition
	test.skip("should create a TGTT Fighter", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Fighter", "TGTT Fighter", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Fighter");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Monk", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Monk", "TGTT Monk", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Monk");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Paladin", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Paladin", "TGTT Paladin", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Paladin");
		await charSheet.expectLevel(1);
	});

	// TODO: Ranger needs weapon mastery selector fix for TGTT edition
	test.skip("should create a TGTT Ranger", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Ranger", "TGTT Ranger", {skillCount: 3});
		await charSheet.expectCharacterName("TGTT Ranger");
		await charSheet.expectLevel(1);
	});

	// TODO: Rogue needs weapon mastery selector fix for TGTT edition
	test.skip("should create a TGTT Rogue", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Rogue", "TGTT Rogue", {skillCount: 4});
		await charSheet.expectCharacterName("TGTT Rogue");
		await charSheet.expectLevel(1);
	});
});

test.describe("Thelemar Classes - Casters", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should create a TGTT Bard", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Bard", "TGTT Bard", {skillCount: 3});
		await charSheet.expectCharacterName("TGTT Bard");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Cleric", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Cleric", "TGTT Cleric", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Cleric");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Druid", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Druid", "TGTT Druid", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Druid");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Sorcerer", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Sorcerer", "TGTT Sorcerer", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Sorcerer");
		await charSheet.expectLevel(1);
	});

	// TODO: Warlock needs further investigation for TGTT edition
	test.skip("should create a TGTT Warlock", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Warlock", "TGTT Warlock", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Warlock");
		await charSheet.expectLevel(1);
	});

	test("should create a TGTT Wizard", async ({page}) => {
		const {charSheet} = await buildTgttCharacter(page, "Wizard", "TGTT Wizard", {skillCount: 2});
		await charSheet.expectCharacterName("TGTT Wizard");
		await charSheet.expectLevel(1);
	});
});

test.describe("Thelemar Classes - Dreamwalker (Prestige)", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should show Dreamwalker class in the class list", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Navigate to class step (Race → Background → Class)
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();
		// Background step — pick any background to advance to Class
		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		// Search for Dreamwalker
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
});
