import {test, expect} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {LevelUpPage} from "../pages/LevelUpPage";
import {createCharacterViaWizard, PRESET_TGTT_DIVINE_SOUL} from "../utils/characterBuilder";
import {gotoWithThelemar, clearHomebrewStorage} from "../utils/homebrewLoader";

async function getDivineSoulKnownSpellName (page: Parameters<typeof test>[0]["page"]) {
	return page.evaluate(() => globalThis.charSheet?._state?.getDivineSoulKnownSpell?.("Sorcerer")?.name || null);
}

test.describe("Divine Soul Affinity", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should collect and persist Divine Soul affinity in Builder -> Quick Build", async ({page}) => {
		await gotoWithThelemar(page);

		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await charSheet.switchToTab(charSheet.tabBuilder);
		// Builder order: Race → Background → Class → Abilities → Equipment → Spells → Details
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		await builder.selectBackgroundExact("Acolyte", "PHB'24");
		await builder.clickNext();

		await builder.selectClassExact("Sorcerer", "TGTT");
		await page.waitForTimeout(500);
		await builder.setQuickBuildTargetLevel(3);
		await page.waitForTimeout(500);
		await builder.selectFirstAvailableSkills(2);
		await builder.selectFirstAvailableFeatureOptions(10);
		await builder.clickNext();

		await builder.assignStandardArrayDefaults();
		await builder.clickNext();

		await builder.selectEquipmentOption("gold");
		await builder.clickNext();

		await page.getByRole("heading", {name: "Starting Spells"}).waitFor({state: "visible", timeout: 10000});
		await builder.autoFillStartingSpells({divineSoulAffinity: "Good"});
		await builder.clickNext();

		await builder.fillDetails({name: "Isra Divine Soul QuickBuild"});
		await builder.finishWizard();

		await page.locator(".charsheet__quickbuild-overlay").waitFor({state: "visible", timeout: 20000});
		const chooseSubclassHeading = page.getByText("Choose Subclass", {exact: false});
		if (await chooseSubclassHeading.count()) {
			await chooseSubclassHeading.waitFor({state: "visible", timeout: 10000});
			const divineSoulOption = page.getByRole("radio").locator("..").filter({hasText: "Divine Soul"}).first();
			if (await divineSoulOption.count()) {
				await divineSoulOption.click();
			}
		}

		const affinityModal = page.locator(".ui-modal__inner").filter({hasText: "Divine Soul Affinity"}).last();
		if (await affinityModal.count()) {
			await affinityModal.waitFor({state: "visible", timeout: 2000}).catch(() => null);
			if (await affinityModal.isVisible().catch(() => false)) {
				await builder.selectDivineSoulAffinity("Good");
			}
		}

		for (let i = 0; i < 4; i++) {
			await page.getByRole("button", {name: /Next/}).click();
			await page.waitForTimeout(200);
		}

		for (const name of ["Aimed Spell", "Quickened Spell", "Subtle Spell"]) {
			const row = page.locator("label").filter({hasText: name}).first();
			if (await row.count()) await row.click();
		}

		await page.getByRole("button", {name: /Next/}).click();
		await page.getByRole("button", {name: /Next/}).click();
		await page.getByRole("button", {name: /Apply|Finish|Complete/i}).click();

		expect(await charSheet.getSubclassChoice("Sorcerer")).toEqual({key: "good", name: "Good"});
		expect(await getDivineSoulKnownSpellName(page)).toBe("Cure Wounds");
	});

	test("should collect and persist Divine Soul affinity during Level Up", async ({page}) => {
		await gotoWithThelemar(page);
		const {charSheet} = await createCharacterViaWizard(page, PRESET_TGTT_DIVINE_SOUL);

		await page.evaluate(() => {
			const state = globalThis.charSheet._state;
			const sorcerer = state.getClasses().find(cls => cls.name === "Sorcerer");
			if (sorcerer) {
				sorcerer.level = 2;
				sorcerer.subclass = null;
				sorcerer.subclassChoice = null;
			}
			state.setSubclassChoice("Sorcerer", null);
			globalThis.charSheet.renderCharacter();
		});

		const levelUp = new LevelUpPage(page);
		await charSheet.btnLevelUp.click();
		await levelUp.waitForModal();
		await levelUp.expandAccordion("subclass");
		await levelUp.selectSubclass("Divine Soul");
		await levelUp.expandAccordion("hp");
		await levelUp.selectHpOption("average");
		await levelUp.expandAccordion("optfeatures");
		for (const name of ["Aimed Spell", "Quickened Spell", "Subtle Spell"]) {
			await levelUp.selectOptionalFeature(name);
		}
		await levelUp.expandAccordion("knownspells");
		await levelUp.addFirstAvailableKnownSpells(1);
		await levelUp.finish();
		await levelUp.expectDivineSoulAffinityModalVisible();
		await levelUp.selectDivineSoulAffinity("Law");
		await levelUp.finish();
		await levelUp.expectModalClosed();

		expect(await charSheet.getSubclassChoice("Sorcerer")).toEqual({key: "law", name: "Law"});
		expect(await getDivineSoulKnownSpellName(page)).toBe("Bless");
	});
});
