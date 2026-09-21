import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_CLERIC, PRESET_FIGHTER} from "../utils/characterBuilder";

test.describe("Respec workspace", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("repairs a skipped decision atomically and supports cancel, apply, undo, and mobile controls", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, bgSource: "PHB", name: "Respec Fighter"});
		const removedSkills = await charSheet.makeFirstClassSkillDecisionMissing();
		expect(removedSkills.length).toBeGreaterThan(0);

		await charSheet.openRespec();
		expect(await charSheet.getRespecDraftStatus()).toMatch(/need attention|Ready to apply/);
		const missing = await charSheet.getRespecSkillSnapshot();

		await charSheet.stageFirstMissingRespecSkillChoice(removedSkills);
		const staged = await charSheet.getRespecSkillSnapshot();
		expect(staged.live).toEqual(missing.live);
		expect(staged.draft.length).toBeGreaterThan(staged.live.length);

		await charSheet.cancelRespecDraft();
		const cancelled = await charSheet.getRespecSkillSnapshot();
		expect(cancelled.live).toEqual(missing.live);
		expect(cancelled.draft).toEqual(missing.live);

		await charSheet.stageFirstMissingRespecSkillChoice(removedSkills);
		const beforeApply = await charSheet.getRespecSkillSnapshot();
		await charSheet.applyRespecDraft();
		expect((await charSheet.getRespecSkillSnapshot()).live).toEqual(beforeApply.draft);

		await charSheet.undoAppliedRespec();
		expect((await charSheet.getRespecSkillSnapshot()).live).toEqual(missing.live);

		await page.setViewportSize({width: 390, height: 844});
		await charSheet.openRespec();
		await charSheet.expectRespecToolbarFitsViewport();
	});

	test("repairs a legacy level-19 ASI into an Epic Boon even when no feat was originally chosen", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_FIGHTER, name: "Legacy Boon Repair"});
		const before = await charSheet.prepareLegacyEpicBoonRepairFixture();

		await charSheet.openRespec();
		const draftStatus = await charSheet.getRespecDraftStatus();
		expect(draftStatus).toContain("need attention");
		expect(draftStatus).not.toContain("spell choices grouped");
		const invalid = await charSheet.getLevel19EpicBoonRepairSnapshot();
		expect(invalid.status).toBe("invalid");
		expect(invalid.selection).toMatchObject({mode: "asi", legacyAsi: {con: 2}});

		await charSheet.stageLevel19EpicBoonRepair();
		const repaired = await charSheet.getLevel19EpicBoonRepairSnapshot();
		expect(repaired.status).toBe("resolved");
		expect(repaired.featName).toBe("Boon of Combat Prowess");
		expect(repaired.con).toBe(before.con - 2);
		expect(repaired.abilityTotal).toBe(before.abilityTotal - 1);
	});

	test("edits a real nested Cleric choice inline without stacking a modal", async ({page}) => {
		const {charSheet} = await createCharacterViaWizard(page, {...PRESET_CLERIC, name: "Nested Respec Cleric"});

		await charSheet.openRespec();
		const beforeMechanics = await charSheet.getRespecMechanicsSnapshot();
		expect(beforeMechanics.choice).toBe("Protector");
		await charSheet.stageRespecFeatureChoice("Divine Order", "Thaumaturge");
		// Refresh the level editor after the parent feature transaction so its
		// nested decision rows reflect the newly staged candidate graph.
		await charSheet.closeRespecLevelEditor();
		const afterFeature = await charSheet.getRespecMechanicsSnapshot();
		const nested = await charSheet.getRespecNestedDecisionSnapshot();
		expect(nested.length).toBeGreaterThan(0);
		expect(nested.every(decision => decision.id && decision.label && decision.characterLevel > 0)).toBe(true);

		const beforeCantrips = afterFeature.cantrips;
		await charSheet.stageAllMissingNestedRespecChoices();
		const after = await charSheet.getRespecNestedDecisionSnapshot();
		expect(after.some(decision => decision.status === "resolved" || decision.status === "staged")).toBe(true);
		expect(after
			.filter(decision => /cantrip/i.test(decision.label))
			.flatMap(decision => Array.isArray(decision.selection) ? decision.selection : [decision.selection])
			.some(selection => selection?.source === "XPHB")).toBe(true);
		const withThaumaturgeCantrip = await charSheet.getRespecMechanicsSnapshot();
		expect(withThaumaturgeCantrip.cantrips.length).toBeGreaterThanOrEqual(beforeCantrips.length);
		expect(withThaumaturgeCantrip.cantrips.some(cantrip => !beforeCantrips.includes(cantrip))).toBe(true);
		await charSheet.applyRespecDraft();
		expect((await charSheet.getRespecMechanicsSnapshot()).choice).toBe("Thaumaturge");
		await charSheet.reloadCharacterSheet();
		const afterReload = await charSheet.getRespecMechanicsSnapshot();
		expect(afterReload.choice).toBe("Thaumaturge");
		await page.setViewportSize({width: 390, height: 844});
		await charSheet.openRespec();
		await charSheet.expectRespecToolbarFitsViewport();
	});
});
