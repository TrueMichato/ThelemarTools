import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";
import {gotoWithThelemar} from "../utils/homebrewLoader";
import {RespecBackgroundPage} from "../pages/RespecBackgroundPage";
import {RespecPartialRepairPage} from "../pages/RespecPartialRepairPage";

for (const mobile of [false, true]) {
	test.describe(mobile ? "Mobile partial repairs" : "Desktop partial repairs", () => {
		test.use(mobile ? {viewport: {width: 1280, height: 900}, isMobile: true, hasTouch: true} : {});
		test("repairs one of three saved issues while preserving review, decline, Apply and reload", async ({page}, testInfo) => {
			test.setTimeout(150_000);
			await clearCharacterStorage(page);
			await gotoWithThelemar(page);
			const {charSheet} = await createCharacterViaWizard(page, {
				...PRESET_FIGHTER, name: "Partial Repair", race: "Dwarf", raceSource: "PHB'24",
				classSource: "PHB", masteryCount: 0, optFeatCount: 0,
				background: "Outlander", bgSource: "PHB", prioritySources: ["PHB", "XPHB"],
				selectBackgroundAbilityBonuses: true,
			});
			const partial = new RespecPartialRepairPage(page);
			const background = new RespecBackgroundPage(page);
			await partial.importLegacyMissingSkillRecord();
			await charSheet.reloadCharacterSheet();
			if (mobile) await partial.showMobileRepairLayout();
			await charSheet.openRespec();
			const baseline = await partial.evidence();
			expect(baseline.validation).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
			expect(baseline.validation.carriedForwardIssues).toHaveLength(3);
			expect(baseline.decisions).toEqual(expect.arrayContaining([
				expect.objectContaining({type: "skills", status: "missing"}),
				expect.objectContaining({type: "nestedTool", status: "missing"}),
				expect.objectContaining({type: "nestedLanguage", status: "missing"}),
			]));
			await charSheet.openRespecBackgroundEditor();
			await background.select("Outlander", "PHB");
			await background.choose("nestedTool", ["Lute"]);
			await background.commit();
			const staged = await partial.evidence();
			expect(staged.live).toEqual(baseline.live);
			expect(staged.draft.toolProficiencies).toContain("Lute");
			expect(staged.validation).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
			const remaining = baseline.validation.carriedForwardIssues.filter(issue => issue.message !== "toolProficiencies is missing.");
			expect(remaining).toHaveLength(2);
			expect(staged.validation.carriedForwardIssues).toEqual(remaining);
			await page.screenshot({path: testInfo.outputPath(mobile ? "mobile-partial-review.png" : "desktop-partial-review.png"), fullPage: true});
			const review = await partial.review();
			expect(review).toContain("Unchanged issues");
			expect(review).toContain("will remain after Apply");
			expect(review).toContain("Lute");
			for (const issue of remaining) expect(review).toContain(issue.message);
			await partial.apply(false, remaining);
			expect((await partial.evidence()).live).toEqual(baseline.live);
			expect((await partial.evidence()).isDirty).toBe(true);
			await partial.apply(true, remaining);
			await charSheet.reloadCharacterSheet();
			await charSheet.openRespec();
			const loaded = await partial.evidence();
			expect(loaded.live.toolProficiencies).toContain("Lute");
			expect(loaded.validation).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
			expect(loaded.validation.carriedForwardIssues).toEqual(remaining);
			expect(loaded.decisions.filter(decision => ["skills", "nestedLanguage"].includes(decision.type)))
				.toEqual(baseline.decisions.filter(decision => ["skills", "nestedLanguage"].includes(decision.type)));
			await partial.expectRemainingStatus();
		});
	});
}
