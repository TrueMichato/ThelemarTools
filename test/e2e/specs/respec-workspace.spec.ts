import fs from "node:fs";
import path from "node:path";
import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {
	createCharacterViaWizard,
	levelUpTo,
	PRESET_CLERIC,
	PRESET_FIGHTER,
	PRESET_FULL_JESTER_DENDULRA,
	PRESET_TGTT_MERCY_MONK,
} from "../utils/characterBuilder";

const BARD_FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
));

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
		}, BARD_FIXTURE.state);

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

	test("retires an owned subclass skill feature when legacy history lacks the short name", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		await charSheet.goto();
		await charSheet.prepareJesterSkillRespecFixture({
			state: BARD_FIXTURE.state,
			feature: BARD_FIXTURE.catalogs.jesterBonusProficiencies,
		});

		await charSheet.openRespec();
		const original = await charSheet.getRespecLiveJson();
		const before = await charSheet.getRespecFeatureSkillSnapshot();
		expect(before.children).toEqual(expect.arrayContaining([
			expect.objectContaining({owner: "bonus proficiencies|tgtt", selection: "acrobatics"}),
		]));

		await charSheet.stageNestedRespecChoice("Bonus Proficiencies", "Persuasion");
		const staged = await charSheet.getRespecFeatureSkillSnapshot();
		const oldFeatureId = before.live.features.find(feature => feature.subclassShortName === "Jesters")?.id;
		expect(oldFeatureId).toBeTruthy();
		expect(staged.live).toEqual(before.live);
		expect(staged.draft.skills.acrobatics.proficiency).toBe(0);
		expect(staged.draft.skills.persuasion.proficiency).toBe(staged.draft.proficiencyBonus);
		expect(staged.draft.skills.acrobatics.total - before.draft.skills.acrobatics.total)
			.toBe(-staged.draft.proficiencyBonus);
		expect(staged.draft.skills.persuasion.total - before.draft.skills.persuasion.total)
			.toBe(staged.draft.proficiencyBonus);

		await charSheet.stageRespecSubclassChoice("Bard College", "College of Valor", "TGTT-2024", 3);
		const replaced = await charSheet.getRespecFeatureSkillSnapshot();
		expect(replaced.draft.subclass).toMatchObject({shortName: "Valor", source: "TGTT-2024"});
		expect(replaced.children.some(child => child.owner === "bonus proficiencies|tgtt")).toBe(false);
		expect(replaced.draft.skills.persuasion.proficiency).toBe(0);
		expect(replaced.draft.grants.persuasion).not.toContain(`feature-choice:${oldFeatureId}`);
		expect(replaced.draft.features.some(feature =>
			feature.className === "Bard" && feature.subclassShortName === "Jesters",
		)).toBe(false);
		expect(replaced.draft.skills.performance.proficiency).toBe(0);
		expect(replaced.live).toEqual(before.live);
		expect(await charSheet.getRespecLiveJson()).toEqual(original);

		await charSheet.cancelRespecDraft();
		expect(await charSheet.getRespecLiveJson()).toEqual(original);
	});

	test("direct Jesters-to-Valor swap removes the legacy owner's feature and skill grant", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		await charSheet.goto();
		await charSheet.prepareJesterSkillRespecFixture({
			state: BARD_FIXTURE.state,
			feature: BARD_FIXTURE.catalogs.jesterBonusProficiencies,
		});
		await charSheet.openRespec();
		const original = await charSheet.getRespecLiveJson();
		const before = await charSheet.getRespecFeatureSkillSnapshot();
		const oldFeature = before.live.features.find(feature => feature.subclassShortName === "Jesters");
		expect(oldFeature).toBeDefined();
		expect(before.live.grants.acrobatics).toContain(`feature-choice:${oldFeature!.id}`);
		expect(before.live.skills.acrobatics.level).toBe(1);

		await charSheet.stageRespecSubclassChoice("Bard College", "College of Valor", "TGTT-2024", 3);
		const after = await charSheet.getRespecFeatureSkillSnapshot();
		expect(after.live).toEqual(before.live);
		expect(after.draft.subclass).toMatchObject({shortName: "Valor", source: "TGTT-2024"});
		expect(after.draft.grants.acrobatics).not.toContain(`feature-choice:${oldFeature!.id}`);
		expect(after.draft.skills.acrobatics.level).toBe(0);
		expect(after.draft.features.map(feature => feature.id)).not.toContain(oldFeature!.id);
		await charSheet.cancelRespecDraft();
		expect(await charSheet.getRespecLiveJson()).toEqual(original);
	});

	test("keeps the subclass picker retryable after candidate staging fails", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		await charSheet.goto();
		await charSheet.prepareJesterSkillRespecFixture({
			state: BARD_FIXTURE.state,
			feature: BARD_FIXTURE.catalogs.jesterBonusProficiencies,
		});
		await charSheet.openRespec();
		await charSheet.stageNestedRespecChoice("Bonus Proficiencies", "Persuasion");
		const beforeFailure = await charSheet.getRespecFeatureSkillSnapshot();
		await charSheet.failNextRespecSubclassChangeAfterMutation("Rejected after candidate subclass feature staging");
		await charSheet.stageRespecSubclassChoice(
			"Bard College",
			"College of Valor",
			"TGTT-2024",
			3,
			"Rejected after candidate subclass feature staging",
		);
		const afterFailure = await charSheet.getRespecFeatureSkillSnapshot();
		expect(afterFailure).toEqual(beforeFailure);
		await charSheet.retryRespecSubclassChoice();
		expect((await charSheet.getRespecFeatureSkillSnapshot()).draft.subclass)
			.toMatchObject({shortName: "Valor", source: "TGTT-2024"});
		await charSheet.cancelRespecDraft();
	});

	test("makes a replacement feature's new skill choice effective through Apply, Undo, and reload", async ({page}) => {
		test.slow();
		const {charSheet} = await createCharacterViaWizard(page, {
			...PRESET_FULL_JESTER_DENDULRA,
			subclassName: "College of Valor",
			subclassSource: "TGTT-2024",
			bgSource: "PHB",
			name: "Respec Bard",
		});
		await levelUpTo(page, 3, {subclassName: "College of Valor", subclassSource: "TGTT-2024"});
		await charSheet.openRespec();
		expect((await charSheet.getRespecBlockingDecisions()).map(({label}) => label))
			.toEqual(["Current Spell Repertoire"]);
		await charSheet.stageRequiredRespecOptions("Current Spell Repertoire", 3);
		await charSheet.applyRespecDraft();
		await charSheet.openRespec();
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		const original = await charSheet.getRespecLiveJson();
		const baseline = (await charSheet.getRespecFeatureSkillSnapshot()).live;
		const label = await charSheet.getRespecSubclassDecisionLabel("Bard");
		await charSheet.stageRespecSubclassChoice(label, "College of Jesters", "TGTT", 3);
		const nested = await charSheet.getRespecNestedDecisionSnapshot();
		const skillChild = nested.find(decision => decision.type === "nestedSkill"
			&& decision.provenance?.ownerUid === "bonus proficiencies|tgtt");
		expect(skillChild, JSON.stringify(nested.map(({type, label, provenance, status}) => ({type, label, provenance, status}))))
			.toMatchObject({status: "missing"});
		const options = skillChild!.options.filter((option): option is string => typeof option === "string");
		let chosen: string | undefined;
		for (const option of options) {
			if ((await charSheet.getRespecSkillBonusSnapshot(option)).live.level < 1) {
				chosen = option;
				break;
			}
		}
		expect(chosen).toBeDefined();
		const before = await charSheet.getRespecSkillBonusSnapshot(chosen!);
		await expect(page.locator("#charsheet-respec-apply")).toBeDisabled();

		await charSheet.stageNestedRespecChoice(skillChild!.label, chosen!, undefined, "nestedSkill");
		const after = await charSheet.getRespecSkillBonusSnapshot(chosen!);
		expect(after.live).toEqual(before.live);
		expect(before.draft.level).toBe(0);
		expect(before.draft.proficiency).toBe(Math.floor(after.proficiencyBonus / 2));
		expect(after.draft.level).toBe(1);
		expect(after.draft.proficiency).toBe(after.proficiencyBonus);
		expect(after.draft.total - before.draft.total)
			.toBe(after.draft.proficiency - before.draft.proficiency);
		expect(await charSheet.getRespecLiveJson()).toEqual(original);

		await charSheet.closeRespecLevelEditor();
		await charSheet.stageAllMissingNestedRespecChoices();
		await charSheet.stageRequiredRespecOptionalFeatures("Jester's Acts", 3);
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		await charSheet.applyRespecDraft();
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(after.draft);
		await charSheet.undoAppliedRespec();
		expect((await charSheet.getRespecFeatureSkillSnapshot()).live).toEqual(baseline);
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(before.live);

		await charSheet.stageRespecSubclassChoice(label, "College of Jesters", "TGTT", 3);
		await charSheet.stageNestedRespecChoice(skillChild!.label, chosen!, undefined, "nestedSkill");
		await charSheet.closeRespecLevelEditor();
		await charSheet.stageAllMissingNestedRespecChoices();
		await charSheet.stageRequiredRespecOptionalFeatures("Jester's Acts", 3);
		await charSheet.applyRespecDraft();
		await charSheet.reloadCharacterSheet();
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(after.draft);
	});

	test("applies a new feature-owned skill from an untouched Monk build and survives Undo and reload", async ({page}) => {
		test.slow();
		const {charSheet} = await createCharacterViaWizard(page, {
			...PRESET_TGTT_MERCY_MONK,
			race: "Dwarf",
			raceSource: "PHB",
			bgSource: "PHB",
			prioritySources: ["TGTT", "PHB"],
			classToolCategory: "artisan",
			name: "Respec Monk",
			subclassName: "Way of The Shackled",
			subclassSource: "TGTT",
		});
		await levelUpTo(page, 3, {subclassName: "Way of The Shackled", subclassSource: "TGTT"});
		await charSheet.openRespec();
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		const label = await charSheet.getRespecSubclassDecisionLabel("Monk");
		await charSheet.stageRespecSubclassChoice(label, "Way of the Five Animals", "TGTT", 3);
		const child = (await charSheet.getRespecNestedDecisionSnapshot()).find(decision =>
			decision.type === "nestedSkill" && decision.provenance?.ownerUid === "animal versatility|tgtt");
		expect(child).toMatchObject({status: "missing"});
		const options = child!.options.filter((option): option is string => typeof option === "string");
		let chosen: string | undefined;
		for (const option of options) {
			if ((await charSheet.getRespecSkillBonusSnapshot(option)).live.level < 1) {
				chosen = option;
				break;
			}
		}
		expect(chosen).toBeDefined();
		const before = await charSheet.getRespecSkillBonusSnapshot(chosen!);
		const performanceBefore = await charSheet.getRespecSkillBonusSnapshot("performance");
		const acrobaticsBefore = await charSheet.getRespecSkillBonusSnapshot("acrobatics");
		expect(performanceBefore.live.level).toBe(1);
		expect(acrobaticsBefore.live.level).toBe(1);
		const beforeOwner = await charSheet.getRespecClassSkillOwnership("Monk", chosen!);
		expect(beforeOwner.live.subclass).toMatchObject({shortName: "Shackled", source: "TGTT"});
		expect(beforeOwner.live.features).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Hidden Arts", source: "TGTT", subclassSource: "TGTT"}),
		]));
		await expect(page.locator("#charsheet-respec-apply")).toBeDisabled();
		await charSheet.stageNestedRespecChoice(child!.label, chosen!, undefined, "nestedSkill");
		const after = await charSheet.getRespecSkillBonusSnapshot(chosen!);
		const stagedOwner = await charSheet.getRespecClassSkillOwnership("Monk", chosen!);
		expect(after.live).toEqual(before.live);
		expect(after.draft.level).toBe(1);
		expect(after.draft.proficiency).toBe(after.proficiencyBonus);
		expect(after.draft.total - before.draft.total).toBe(after.proficiencyBonus);
		expect((await charSheet.getRespecSkillBonusSnapshot("performance")).draft.level).toBe(0);
		expect((await charSheet.getRespecSkillBonusSnapshot("acrobatics")).draft.level).toBe(1);
		expect(stagedOwner.live).toEqual(beforeOwner.live);
		expect(stagedOwner.draft.subclass).toMatchObject({shortName: "Five Animals", source: "TGTT"});
		expect(stagedOwner.draft.features).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Animal Versatility", source: "TGTT", subclassSource: "TGTT"}),
		]));
		expect(stagedOwner.draft.features.some(feature => feature.name === "Hidden Arts")).toBe(false);
		expect(stagedOwner.draft.progressionSources).toContain(child!.semanticKey);
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		await charSheet.closeRespecLevelEditor();
		await charSheet.applyRespecDraft();
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(after.draft);
		expect((await charSheet.getRespecClassSkillOwnership("Monk", chosen!)).live).toEqual(stagedOwner.draft);
		await charSheet.undoAppliedRespec();
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(before.live);
		expect((await charSheet.getRespecClassSkillOwnership("Monk", chosen!)).live).toEqual(beforeOwner.live);
		await charSheet.stageRespecSubclassChoice(label, "Way of the Five Animals", "TGTT", 3);
		await charSheet.stageNestedRespecChoice(child!.label, chosen!, undefined, "nestedSkill");
		await charSheet.closeRespecLevelEditor();
		await charSheet.applyRespecDraft();
		await charSheet.reloadCharacterSheet();
		expect((await charSheet.getRespecSkillBonusSnapshot(chosen!)).live).toEqual(after.draft);
		const reloadedOwner = (await charSheet.getRespecClassSkillOwnership("Monk", chosen!)).live;
		expect(reloadedOwner.subclass).toEqual(stagedOwner.draft.subclass);
		expect(reloadedOwner.progressionSources).toEqual(stagedOwner.draft.progressionSources);
		expect(reloadedOwner.features.map(({name, source, subclassSource}) => ({name, source, subclassSource})))
			.toEqual(stagedOwner.draft.features.map(({name, source, subclassSource}) => ({name, source, subclassSource})));
	});
});
