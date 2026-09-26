import fs from "node:fs";
import path from "node:path";
import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_CLERIC, PRESET_FIGHTER} from "../utils/characterBuilder";

const BARD_FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
)).state;

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
		test.slow();
		const {charSheet} = await createCharacterViaWizard(page, {
			...PRESET_CLERIC,
			background: "Acolyte",
			bgSource: "PHB",
			name: "Nested Respec Cleric",
		});

		await charSheet.openRespec();
		const beforeMechanics = await charSheet.getRespecMechanicsSnapshot();
		expect(beforeMechanics.choice).toBe("Protector");
		const beforeLive = await page.evaluate(() => (globalThis as any).charSheet._state.toJson());
		await page.evaluate(() => {
			const state = (globalThis as any).charSheet._respec._engine.state;
			(globalThis as any).originalRespecAddFeature = state.addFeature;
			state.addFeature = () => { throw new Error("Feature catalog temporarily unavailable"); };
		});
		await charSheet.stageRespecFeatureChoice("Divine Order", "Thaumaturge");
		await expect(page.locator(".charsheet__respec-feature-modal [role='alert']"))
			.toContainText("Feature catalog temporarily unavailable");
		expect((await charSheet.getRespecMechanicsSnapshot()).choice).toBe("Protector");
		expect(await page.evaluate(() => (globalThis as any).charSheet._state.toJson())).toEqual(beforeLive);
		await page.evaluate(() => {
			const state = (globalThis as any).charSheet._respec._engine.state;
			state.addFeature = (globalThis as any).originalRespecAddFeature;
			delete (globalThis as any).originalRespecAddFeature;
		});
		await page.locator(".charsheet__respec-feature-modal button", {hasText: "Apply Changes"}).click();
		const afterFeature = await charSheet.getRespecMechanicsSnapshot();
		expect(afterFeature.choice).toBe("Thaumaturge");
		expect(afterFeature.featureNames).toContain("Thaumaturge");
		expect(afterFeature.featureNames).not.toContain("Protector");
		const ownedFeature = await page.evaluate(() => {
			const data = (globalThis as any).charSheet._respec._engine.state.toJson();
			return {
				feature: data.features.find((feature: any) => feature.name === "Thaumaturge"),
				choice: data.chosenSubfeatures.find((item: any) => item.parent === "Divine Order" && item.name === "Thaumaturge"),
			};
		});
		expect(ownedFeature.feature).toMatchObject({
			source: "XPHB",
			classSource: "TGTT",
			ref: "Thaumaturge|Cleric|XPHB|1|XPHB",
		});
		expect(ownedFeature.choice).toMatchObject({parentSource: "XPHB", parentClassSource: "TGTT"});
		const nested = await charSheet.getRespecNestedDecisionSnapshot();
		expect(nested.length).toBeGreaterThan(0);
		expect(nested.every(decision => decision.id && decision.label && decision.characterLevel > 0)).toBe(true);
		const cantrip = nested.find(decision => /cantrip/i.test(decision.label));
		expect(cantrip).toBeDefined();
		await expect(page.locator(`.charsheet__respec-choice-row[data-decision-id="${cantrip!.id}"]`)).toBeVisible();

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
		await charSheet.undoAppliedRespec();
		const afterUndo = await charSheet.getRespecMechanicsSnapshot();
		expect(afterUndo.choice).toBe("Protector");
		expect(afterUndo.featureNames).toContain("Protector");
		expect(afterUndo.featureNames).not.toContain("Thaumaturge");

		await charSheet.openRespec();
		await charSheet.stageRespecFeatureChoice("Divine Order", "Thaumaturge");
		await charSheet.stageAllMissingNestedRespecChoices();
		await charSheet.applyRespecDraft();
		await charSheet.reloadCharacterSheet();
		const afterReload = await charSheet.getRespecMechanicsSnapshot();
		expect(afterReload.choice).toBe("Thaumaturge");
		await page.setViewportSize({width: 390, height: 844});
		await charSheet.openRespec();
		await charSheet.expectRespecToolbarFitsViewport();
	});

	test("replaces a TGTT Bard Specialty and offers its skill choice in the same editor", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		await charSheet.goto();
		await page.locator("#charsheet-btn-new").click();
		await page.evaluate(data => {
			const cs: any = (globalThis as any).charSheet;
			if (cs._state.loadFromJson(data) === false) throw new Error("Could not load the anonymized Bard fixture");
			cs._renderCharacter();
		}, BARD_FIXTURE);

		await charSheet.openRespec();
		const before = await page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			return cs._state.toJson();
		});
		const oldChild = (await charSheet.getRespecNestedDecisionSnapshot())
			.find(decision => decision.provenance?.ownerUid === "showoff|tgtt");
		expect(oldChild).toBeDefined();
		await charSheet.stageRespecFeatureChoice("Specialties", "Townie", 13);

		const child = (await charSheet.getRespecNestedDecisionSnapshot())
			.find(decision => decision.provenance?.ownerUid === "townie|tgtt"
				&& /skill/i.test(decision.label));
		expect(child).toBeDefined();
		const childRow = page.locator(`.charsheet__respec-choice-row[data-decision-id="${child!.id}"]`);
		await expect(childRow).toBeVisible();
		await expect(page.locator(`.charsheet__respec-choice-row[data-decision-id="${oldChild!.id}"]`)).toHaveCount(0);
		await childRow.locator("button", {hasText: "Change"}).click();
		const editor = page.locator(".charsheet__respec-nested-editor-host .charsheet__respec-decision-editor");
		await expect(editor).toBeVisible();
		await editor.locator(".charsheet__respec-option input:enabled").first().check();
		await editor.locator("button", {hasText: "Stage Choice"}).click();
		await expect(childRow).toHaveClass(/--resolved/);
		const draft = await page.evaluate(() => {
			const state = (globalThis as any).charSheet._respec._engine.state;
			return {
				townie: state.getFeatures().find((feature: any) => feature.name === "Townie"),
				modifiers: state.getNamedModifiers().filter((modifier: any) => /Townie/i.test(modifier.name)),
			};
		});
		expect(draft.townie).toMatchObject({source: "TGTT", classSource: "TGTT"});
		expect(draft.modifiers).toEqual(expect.arrayContaining([
			expect.objectContaining({type: expect.stringMatching(/^skill:/), proficiencyBonus: true}),
		]));
		expect(await page.evaluate(() => (globalThis as any).charSheet._state.toJson())).toEqual(before);
		await charSheet.closeRespecLevelEditor();
		await charSheet.cancelRespecDraft();
		expect(await page.evaluate(() => (globalThis as any).charSheet._state.toJson())).toEqual(before);
	});
});
