import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";

test.describe("Respec workspace", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("repairs a skipped decision atomically and supports cancel, apply, undo, and mobile controls", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Respec Fighter"});
		const removedSkills = await charSheet.makeFirstClassSkillDecisionMissing();
		expect(removedSkills.length).toBeGreaterThan(0);

		await charSheet.openRespec();
		expect(await charSheet.getRespecDraftStatus()).toContain("need attention");
		const missing = await charSheet.getRespecSkillSnapshot();

		await charSheet.stageFirstMissingRespecSkillChoice();
		const staged = await charSheet.getRespecSkillSnapshot();
		expect(staged.live).toEqual(missing.live);
		expect(staged.draft.length).toBeGreaterThan(staged.live.length);

		await charSheet.cancelRespecDraft();
		const cancelled = await charSheet.getRespecSkillSnapshot();
		expect(cancelled.live).toEqual(missing.live);
		expect(cancelled.draft).toEqual(missing.live);

		await charSheet.stageFirstMissingRespecSkillChoice();
		const beforeApply = await charSheet.getRespecSkillSnapshot();
		await charSheet.applyRespecDraft();
		expect((await charSheet.getRespecSkillSnapshot()).live).toEqual(beforeApply.draft);

		await charSheet.undoAppliedRespec();
		expect((await charSheet.getRespecSkillSnapshot()).live).toEqual(missing.live);

		await page.setViewportSize({width: 390, height: 844});
		await charSheet.openRespec();
		await charSheet.expectRespecToolbarFitsViewport();
	});
});
