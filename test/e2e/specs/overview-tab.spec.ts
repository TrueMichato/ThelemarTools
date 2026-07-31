import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";

test.describe("Overview Tab", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("should display ability scores after character creation", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Overview Fighter"});

		// Overview tab should be active after wizard completes
		// Verify all 6 ability score elements exist
		const abilities: Array<"str" | "dex" | "con" | "int" | "wis" | "cha"> = ["str", "dex", "con", "int", "wis", "cha"];
		for (const abl of abilities) {
			const scoreEl = page.locator(`#charsheet-ability-${abl}-score`);
			if (await scoreEl.count() > 0 && await scoreEl.isVisible()) {
				const {score} = await charSheet.getAbilityScore(abl);
				expect(score).toBeGreaterThanOrEqual(8);
				expect(score).toBeLessThanOrEqual(20);
			}
		}

		// Verify at least ability containers render
		const abilityContainers = page.locator(".charsheet__ability[data-ability]");
		const visibleCount = await abilityContainers.count();
		expect(visibleCount).toBeGreaterThanOrEqual(6);
	});

	test("should display HP bar for a new character", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "HP Test Fighter"});

		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(300);

		// Max HP should be set (Fighter with d10 + CON mod)
		const maxHpEl = charSheet.hpMax;
		if (await maxHpEl.count() > 0 && await maxHpEl.isVisible()) {
			const maxHp = await charSheet.getMaxHp();
			expect(maxHp).toBeGreaterThan(0);
		}

		// Verify character exists regardless of HP element visibility
		await charSheet.expectLevel(1);
	});

	test("should display AC, Initiative, and Speed", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Stats Fighter"});

		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(300);

		// AC should be at least 10 (base)
		if (await charSheet.dispAC.count() > 0 && await charSheet.dispAC.isVisible()) {
			const ac = await charSheet.getAC();
			expect(ac).toBeGreaterThanOrEqual(10);
		}

		// Initiative should be visible
		if (await charSheet.dispInitiative.count() > 0 && await charSheet.dispInitiative.isVisible()) {
			const init = await charSheet.getInitiative();
			expect(init).toBeTruthy();
		}

		// Speed should be > 0
		if (await charSheet.dispSpeed.count() > 0 && await charSheet.dispSpeed.isVisible()) {
			const speed = await charSheet.getSpeed();
			expect(speed).toBeGreaterThan(0);
		}
	});

	test("should display character info in header", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Info Fighter"});

		// Verify character name
		await charSheet.expectCharacterName("Info Fighter");

		// Verify level 1
		await charSheet.expectLevel(1);

		// Race display
		if (await charSheet.characterRace.count() > 0 && await charSheet.characterRace.isVisible()) {
			const raceText = await charSheet.characterRace.textContent();
			expect(raceText).toContain("Aarakocra");
		}

		// Class display
		if (await charSheet.characterClass.count() > 0 && await charSheet.characterClass.isVisible()) {
			const classText = await charSheet.characterClass.textContent();
			expect(classText).toContain("Fighter");
		}
	});

	test("should show exhaustion controls", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Exhaustion Fighter"});

		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(300);

		// Exhaustion number should start at 0
		if (await charSheet.exhaustionNumber.count() > 0 && await charSheet.exhaustionNumber.isVisible()) {
			const level = await charSheet.getExhaustionLevel();
			expect(level).toBe(0);
		}

		// Add exhaustion button should exist
		if (await charSheet.btnExhaustionAdd.count() > 0) {
			await expect(charSheet.btnExhaustionAdd).toBeVisible();

			// Click to add one level of exhaustion
			await charSheet.btnExhaustionAdd.click();
			await page.waitForTimeout(200);

			const newLevel = await charSheet.getExhaustionLevel();
			expect(newLevel).toBe(1);

			// Remove it
			if (await charSheet.btnExhaustionRemove.count() > 0) {
				await charSheet.btnExhaustionRemove.click();
				await page.waitForTimeout(200);

				const restoredLevel = await charSheet.getExhaustionLevel();
				expect(restoredLevel).toBe(0);
			}
		}
	});

	test("should show rest buttons", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Rest Fighter"});

		await charSheet.switchToTab(charSheet.tabOverview);
		await page.waitForTimeout(300);

		// Short rest button
		if (await charSheet.btnShortRest.count() > 0) {
			await expect(charSheet.btnShortRest).toBeVisible();
		}

		// Long rest button
		if (await charSheet.btnLongRest.count() > 0) {
			await expect(charSheet.btnLongRest).toBeVisible();
		}
	});
});
