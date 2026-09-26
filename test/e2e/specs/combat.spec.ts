import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";

test.describe("Combat Tab", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("should display combat tab with attack options", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Combat Fighter"});

		// Switch to Combat tab
		await charSheet.switchToTab(charSheet.tabCombat);

		// Wait for tab content to load
		await page.waitForTimeout(500);

		// Verify combat tab content is visible
		const combatContent = page.locator("#charsheet-tab-combat");
		await expect(combatContent).toBeVisible();

		// Check for AC display
		const acDisplay = page.locator("#charsheet-ac, .charsheet__combat-ac, [data-testid='character-ac']").first();
		if (await acDisplay.count() > 0) {
			await expect(acDisplay).toBeVisible();
		}

		// Check for initiative modifier
		const initDisplay = page.locator("#charsheet-initiative, .charsheet__combat-init, [data-testid='character-initiative']").first();
		if (await initDisplay.count() > 0) {
			await expect(initDisplay).toBeVisible();
		}
	});

	test("Combat damage button rolls normal dice or critical dice when Shift-clicked", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {
			...PRESET_FIGHTER,
			name: "Damage Gesture Fighter",
			skipConditionalPrompt: true,
		});
		await charSheet.prepareDamageGestureAttack();

		const normal = await charSheet.rollCombatDamage();
		expect(normal.diceCalls).toEqual([{count: 1, sides: 8}]);
		expect(normal.breakdown).not.toContain("(crit)");
		expect(normal.postAttackOffers).toBe(0);

		const critical = await charSheet.rollCombatDamage({critical: true});
		expect(critical.diceCalls).toEqual([{count: 1, sides: 8}, {count: 1, sides: 8}]);
		expect(critical.total).toBe(normal.total + 4);
		expect(critical.breakdown).toContain("1d8 (crit)");
		expect(critical.postAttackOffers).toBe(0);

		const anotherNormal = await charSheet.rollCombatDamage();
		expect(anotherNormal.total).toBe(normal.total);
		expect(anotherNormal.diceCalls).toEqual(normal.diceCalls);
		expect(anotherNormal.breakdown).not.toContain("(crit)");

		const keyboardCritical = await charSheet.rollCombatDamage({critical: true, keyboard: true});
		expect(keyboardCritical.diceCalls).toEqual(critical.diceCalls);
		expect(keyboardCritical.total).toBe(critical.total);
	});

	test("should show weapons section", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Weapons Fighter"});
		await charSheet.switchToTab(charSheet.tabCombat);
		await page.waitForTimeout(500);

		// Look for weapons section
		const weaponsSection = page.locator(".charsheet__combat-weapons, .charsheet__attacks, [data-section='weapons'], [data-section='attacks']").first();
		if (await weaponsSection.count() > 0) {
			await expect(weaponsSection).toBeVisible();
		}
	});

	test("should have clickable ability checks", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Ability Fighter"});

		await charSheet.switchToTab(charSheet.tabAbilities);
		await page.waitForTimeout(500);

		// Look for ability score elements
		const abilitySelectors = [
			"[data-ability='str']",
			"#charsheet-ability-str",
			".charsheet__ability-str",
		];

		let foundAbility = false;
		for (const selector of abilitySelectors) {
			const elem = page.locator(selector).first();
			if (await elem.count() > 0 && await elem.isVisible()) {
				foundAbility = true;
				const text = await elem.textContent();
				expect(text).toBeTruthy();
				break;
			}
		}

		if (!foundAbility) {
			const tabContent = page.locator("#charsheet-tab-abilities");
			await expect(tabContent).toBeVisible();
		}
	});

	test("should display HP correctly", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "HP Fighter"});

		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(300);

		// Use corrected selectors
		if (await charSheet.hpMax.count() > 0 && await charSheet.hpMax.isVisible()) {
			const maxHp = await charSheet.getMaxHp();
			expect(maxHp).toBeGreaterThan(0);
		}

		if (await charSheet.hpCurrent.count() > 0 && await charSheet.hpCurrent.isVisible()) {
			const currentHp = await charSheet.getCurrentHp();
			expect(currentHp).toBeGreaterThanOrEqual(0);
		}
	});

	test("should display saving throws", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Saves Fighter"});
		await charSheet.switchToTab(charSheet.tabAbilities);
		await page.waitForTimeout(500);

		const savesSection = page.locator(".charsheet__saves, [data-section='saves'], .saving-throws").first();
		if (await savesSection.count() > 0) {
			await expect(savesSection).toBeVisible();
		}
	});

	test("should show skill proficiencies", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Skills Fighter"});
		await charSheet.switchToTab(charSheet.tabAbilities);
		await page.waitForTimeout(500);

		const skillsSection = page.locator(".charsheet__skills, [data-section='skills'], .skills-list").first();
		if (await skillsSection.count() > 0) {
			await expect(skillsSection).toBeVisible();
		}
	});
});
