import fs from "node:fs";
import path from "node:path";
import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {LevelUpPage} from "../pages/LevelUpPage";
import {QuickBuildPage} from "../pages/QuickBuildPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {
	createCharacterViaWizard,
	levelUpTo,
	PRESET_BARD,
	PRESET_CLERIC,
	PRESET_FIGHTER,
	PRESET_FULL_JESTER_DENDULRA,
	PRESET_TGTT_MERCY_MONK,
} from "../utils/characterBuilder";
import {gotoWithThelemar} from "../utils/homebrewLoader";

const BARD_FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
));

test.describe("Respec workspace", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	for (const {source, startLevel} of [{source: "TGTT", startLevel: 9}, {source: "XPHB", startLevel: 8}]) {
		test(`${source} Bard Quick Build L${startLevel}→10 keeps Magical Secrets in its level-10 Respec decision`, async ({page}) => {
			test.setTimeout(240_000);
			await gotoWithThelemar(page);
			const {charSheet} = await createCharacterViaWizard(page, {
				...PRESET_BARD,
				name: `${source} Quick Build Secrets`,
				background: "Soldier",
				bgSource: "PHB",
				classSource: source === "XPHB" ? "PHB'24" : "TGTT",
				...(source === "XPHB" ? {prioritySources: ["XPHB"]} : {}),
				subclassName: "College of Valor",
				subclassSource: source === "XPHB" ? "PHB'24" : "TGTT-2024",
			});
			await levelUpTo(page, startLevel, {
				subclassName: "College of Valor",
				subclassSource: source === "XPHB" ? "PHB'24" : "TGTT-2024",
			});
			const quickBuild = new QuickBuildPage(page);
			await quickBuild.open();
			await quickBuild.setTargetLevel(10);
			await quickBuild.advanceToSpells();
			let levelNinePicks: Array<{name: string; source: string}> = [];
			if (startLevel === 8) {
				await quickBuild.selectAcquisitionLevel(9);
				expect(await quickBuild.getSpellOptions("Spirit Guardians")).toEqual([]);
				expect(await quickBuild.getSpellOptions("Heal")).toEqual([]);
				const first = await quickBuild.selectFirstAvailableSpell();
				const second = await quickBuild.selectFirstAvailableSpell();
				expect(first.name).toBeTruthy();
				expect(second.name).toBeTruthy();
				expect(second).not.toEqual(first);
				levelNinePicks = [first, second];
				expect(await quickBuild.getLevelProgress(9)).toContain("2/2 spells");
			}
			await quickBuild.selectAcquisitionLevel(10);
			expect(await quickBuild.getSpellOptions("Spirit Guardians")).toContainEqual({
				name: "Spirit Guardians", source: "PHB'24", level: 3,
			});
			expect(await quickBuild.getSpellOptions("Shield")).toContainEqual({
				name: "Shield", source: "PHB'24", level: 1,
			});
			expect(await quickBuild.getSpellOptions("Fire Bolt")).toEqual([]);
			expect(await quickBuild.getSpellOptions("Heal")).toEqual([]);
			await quickBuild.selectSpell("Spirit Guardians", "PHB'24");
			const cantrip = await quickBuild.selectFirstAvailableCantrip();
			expect(cantrip.name).not.toBe("Fire Bolt");
			expect(await quickBuild.getLevelProgress(10)).toContain("1/1 spells");
			expect(await quickBuild.getLevelProgress(10)).toContain("1/1 cantrips");
			await quickBuild.finish();
			await charSheet.expectLevel(10);
			if (startLevel === 8) {
				const levelNine = await quickBuild.getRecordedLevelSpells(9);
				expect(levelNine.choices).toHaveLength(2);
				expect(levelNine.choices.map(({name}) => name)).toEqual(levelNinePicks.map(({name}) => name));
				expect(levelNine.choices.map(({name}) => name)).not.toContain("Spirit Guardians");
				expect(levelNine.live).toEqual(expect.arrayContaining(levelNine.choices.map(({name, source: spellSource}) =>
					expect.objectContaining({name, source: spellSource, sourceClass: "Bard", sourceClassSource: source})),
				));
			}
			const built = await charSheet.getLevelTenBardSpellEvidence();
			expect(built.classSource).toBe(source);
			expect(built.choice.knownSpells).toEqual([{name: "Spirit Guardians", source: "XPHB", level: 3}]);
			expect(built.choice.knownCantrips).toHaveLength(1);
			expect(built.choice.knownCantrips?.[0].name).toBe(cantrip.name);
			expect(built.choice.preparedSpells).toBeUndefined();
			expect(built.spells).toEqual(expect.arrayContaining([
				expect.objectContaining({
					name: "Spirit Guardians", source: "XPHB", sourceFeature: "Spells Known",
					sourceClass: "Bard", sourceClassSource: source, prepared: false,
				}),
			]));
			await charSheet.reloadCharacterSheet();
			if (startLevel === 8) expect((await quickBuild.getRecordedLevelSpells(9)).choices).toHaveLength(2);
			expect((await charSheet.getLevelTenBardSpellEvidence()).choice).toMatchObject(built.choice);
			await charSheet.openRespec();
			const decision = await charSheet.getLevelTenBardRespecDecision();
			expect(decision.status, JSON.stringify(decision.issues)).toBe("resolved");
			expect(decision.id).toContain("knownspells:known-spells:");
			expect(decision.issues).toEqual([]);
			expect(decision.selection).toEqual([expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})]);
		});
	}

	test("Bard Magical Secrets uses real level-10 known-spell Level Up choices", async ({page}) => {
		test.setTimeout(240_000);
		await gotoWithThelemar(page);
		const {charSheet} = await createCharacterViaWizard(page, {
			...PRESET_BARD, name: "Level-Up Secrets Bard", background: "Soldier", bgSource: "PHB",
			subclassName: "College of Valor", subclassSource: "TGTT-2024",
		});
		await levelUpTo(page, 9, {subclassName: "College of Valor", subclassSource: "TGTT-2024"});
		const characterId = await charSheet.getCurrentCharacterId();
		const levelUp = new LevelUpPage(page);
		await charSheet.beginLevelUp();
		await levelUp.waitForModal();

		const picker = await levelUp.getSpellPickerSnapshot();
		expect((await charSheet.getLevelTenBardSpellEvidence()).classSource).toBe("TGTT");
		expect(picker.accordion).toBe("knownspells");
		expect(picker.title).toContain("Spells Known");
		expect(picker.options).toEqual(expect.arrayContaining([
			{name: "Spirit Guardians", source: "PHB'24", level: 3},
			{name: "Conjure Animals", source: "TGTT", level: 3},
			{name: "Shield", source: "PHB'24", level: 1},
		]));
		for (const excluded of [
			{name: "Fire Bolt", source: "PHB'24", level: 0},
			{name: "Heal", source: "PHB'24", level: 6},
		]) expect(picker.options).not.toContainEqual(excluded);

		await levelUp.selectHpOption("average");
		await levelUp.chooseKnownSpell("Spirit Guardians", "PHB'24");
		await levelUp.autoFillAllSelections();
		await levelUp.finish();
		await levelUp.expectModalClosed();
		const result = await charSheet.getLevelTenBardSpellEvidence();
		expect(result.classSource).toBe("TGTT");
		expect(result.choice.knownSpells).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Spirit Guardians", source: "XPHB", level: 3}),
		]));
		expect(result.choice.knownCantrips).toHaveLength(1);
		expect(result.choice.preparedSpells).toBeUndefined();
		expect(result.choice.preparedCantrips).toBeUndefined();
		expect(result.spells).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Spirit Guardians", source: "XPHB", sourceFeature: "Spells Known", sourceClass: "Bard", sourceClassSource: "TGTT", prepared: false}),
		]));

		await charSheet.reloadCharacterSheet();
		expect(await charSheet.getLevelTenBardSpellEvidence()).toMatchObject({
			choice: {knownSpells: [expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})]},
		});
		await charSheet.openRespec();
		const recorded = await charSheet.getLevelTenBardRespecDecision();
		expect(recorded.status, JSON.stringify({
			selection: recorded.selection,
			matchingOptions: recorded.options.filter(option => ["Spirit Guardians", "Shield"].includes(option.name)),
			issues: recorded.issues,
		})).toBe("resolved");
		expect(recorded.issues).toEqual([]);
		expect(recorded.selection).toEqual([expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})]);
		expect(recorded.options).toEqual(expect.arrayContaining([
			{name: "Spirit Guardians", source: "XPHB"},
			{name: "Shield", source: "XPHB"},
		]));
		const original = await charSheet.getLevelTenBardSpellEvidence();

		await charSheet.stageLevelTenBardKnownSpell("Shield", "XPHB");
		expect(await charSheet.getLevelTenBardSpellEvidence()).toEqual(original);
		await charSheet.cancelRespecDraft();
		expect(await charSheet.getLevelTenBardSpellEvidence()).toEqual(original);
		expect((await charSheet.getLevelTenBardRespecDecision()).selection)
			.toEqual([expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})]);

		await charSheet.stageLevelTenBardKnownSpell("Shield", "XPHB");
		// CS-BUG-177: repair the Builder's unrelated L1 spell gap before Apply.
		await charSheet.repairBardStartingSpellsForRespec();
		await charSheet.applyRespecDraft();
		const applied = await charSheet.getLevelTenBardSpellEvidence();
		expect(applied.choice.knownSpells).toEqual([expect.objectContaining({name: "Shield", source: "XPHB", level: 1})]);
		expect(applied.spells.filter(spell => ["Shield", "Spirit Guardians"].includes(spell.name))).toEqual([
			expect.objectContaining({name: "Shield", source: "XPHB", sourceFeature: "Spells Known", sourceClass: "Bard", sourceClassSource: "TGTT", prepared: false}),
		]);

		const reloadedPage = await page.context().newPage();
		const reloadedSheet = new CharacterSheetPage(reloadedPage);
		await reloadedPage.goto("/charactersheet.html?_brewloaded=1");
		await reloadedSheet.selectCharacter(characterId);
		expect(await reloadedSheet.getLevelTenBardSpellEvidence()).toEqual(applied);
		await reloadedSheet.openRespec();
		expect(await reloadedSheet.getLevelTenBardRespecDecision()).toMatchObject({
			status: "resolved",
			selection: [expect.objectContaining({name: "Shield", source: "XPHB"})],
			issues: [],
		});

		await charSheet.undoAppliedRespec();
		expect(await charSheet.getLevelTenBardSpellEvidence()).toEqual(original);
	});

	test("XPHB Bard level-10 Level Up persists a Magical Secrets known spell for Respec", async ({page}) => {
		test.slow();
		await gotoWithThelemar(page);
		const charSheet = new CharacterSheetPage(page);
		await charSheet.setPrioritySources(["XPHB"]);
		await charSheet.spawnSavedCharacter("bard[XPHB]/9/human", "XPHB Secrets Bard");
		await charSheet.beginLevelUp();
		const levelUp = new LevelUpPage(page);
		await levelUp.waitForModal();
		const picker = await levelUp.getSpellPickerSnapshot();
		expect(picker.accordion).toBe("knownspells");
		expect(picker.options).toEqual(expect.arrayContaining([
			{name: "Spirit Guardians", source: "PHB'24", level: 3},
			{name: "Shield", source: "PHB'24", level: 1},
		]));
		expect(picker.options).not.toContainEqual({name: "Fire Bolt", source: "PHB'24", level: 0});
		await levelUp.selectHpOption("average");
		await levelUp.chooseKnownSpell("Spirit Guardians", "PHB'24");
		await levelUp.autoFillAllSelections();
		await levelUp.finish();
		await levelUp.expectModalClosed();
		await charSheet.reloadCharacterSheet();
		const evidence = await charSheet.getLevelTenBardSpellEvidence();
		expect(evidence.classSource).toBe("XPHB");
		expect(evidence.choice).toMatchObject({
			knownSpells: [expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})],
		});
		expect(evidence.spells).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Spirit Guardians", source: "XPHB", sourceFeature: "Spells Known", sourceClassSource: "XPHB", prepared: false}),
		]));
		await charSheet.openRespec();
		expect(await charSheet.getLevelTenBardRespecDecision()).toMatchObject({
			status: "resolved",
			selection: [expect.objectContaining({name: "Spirit Guardians", source: "XPHB"})],
			issues: [],
		});
	});

	test("TGTT Bard level-9 Level Up keeps Magical Secrets spells out of its picker", async ({page}) => {
		test.slow();
		await gotoWithThelemar(page);
		const charSheet = new CharacterSheetPage(page);
		await charSheet.spawnSavedCharacter("bard[TGTT]/8/human", "Pre-Secrets Bard");
		await charSheet.beginLevelUp();
		const levelUp = new LevelUpPage(page);
		await levelUp.waitForModal();
		const picker = await levelUp.getSpellPickerSnapshot();
		expect(picker.accordion).toBe("knownspells");
		for (const excluded of [
			{name: "Spirit Guardians", source: "PHB'24", level: 3},
			{name: "Shield", source: "PHB'24", level: 1},
		]) expect(picker.options).not.toContainEqual(excluded);
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

	test("replaces a level-owned feat's dependent skill and expertise without leaking the old grant", async ({page}) => {
		test.slow();
		const charSheet = new CharacterSheetPage(page);
		await charSheet.goto();
		await charSheet.prepareLevelFeatSkillRespecFixture();
		await charSheet.openRespec();
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		const baseline = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(baseline.live.skills.stealth.level).toBe(0);
		expect(baseline.live.skills.deception.level).toBe(0);

		await charSheet.stageLevel4SkillExpert("Stealth", "Stealth");
		const acquired = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(acquired.children).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "nestedSkill", selection: ["stealth"], status: "resolved"}),
			expect.objectContaining({type: "nestedExpertise", selection: ["stealth"], status: "resolved"}),
		]));
		expect(acquired.draft.skills.stealth.level).toBe(2);
		expect(acquired.live).toEqual(baseline.live);
		await charSheet.stageNestedRespecChoice("Skill Expert Skill Proficiency", "Deception", undefined, "nestedSkill");
		const invalid = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(invalid.children).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "nestedExpertise", selection: ["stealth"], status: "invalid"}),
		]));
		expect(invalid.children.find(child => child.type === "nestedExpertise")?.options).toContain("deception");
		await expect(page.locator("#charsheet-respec-apply")).toBeDisabled();
		expect(invalid.live).toEqual(baseline.live);
		await charSheet.closeRespecLevelEditor();
		await charSheet.cancelRespecDraft();
		expect((await charSheet.getLevelFeatSkillRespecSnapshot()).live).toEqual(baseline.live);

		await charSheet.stageLevel4SkillExpert("Stealth", "Stealth");
		await charSheet.stageNestedRespecChoice("Skill Expert Skill Proficiency", "Deception", undefined, "nestedSkill");
		await charSheet.stageNestedRespecChoice("Skill Expert Expertise", "Deception", undefined, "nestedExpertise");
		const staged = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(staged.children.every(child => child.status === "resolved")).toBe(true);
		expect(staged.draft.choices).toMatchObject({skills: ["deception"], expertise: ["deception"]});
		expect(staged.draft.receipt).toMatchObject({deception: {before: 0, after: 2}});
		expect(staged.draft.receipt).not.toHaveProperty("stealth");
		expect(staged.draft.skills.stealth.level).toBe(0);
		expect(staged.draft.skills.deception.level).toBe(2);
		expect(staged.draft.skills.deception.total - staged.live.skills.deception.total)
			.toBe(2 * staged.draft.proficiencyBonus);
		expect(staged.live).toEqual(baseline.live);
		await charSheet.closeRespecLevelEditor();
		expect(await charSheet.getRespecBlockingDecisions()).toEqual([]);
		await charSheet.applyRespecDraft();
		const applied = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(applied.live.skills).toEqual(staged.draft.skills);
		expect(await charSheet.rollFixedSkillCheck("deception")).toBe(10 + applied.live.skills.deception.mod);
		await charSheet.undoAppliedRespec();
		expect((await charSheet.getLevelFeatSkillRespecSnapshot()).live).toEqual(baseline.live);

		await charSheet.stageLevel4SkillExpert("Stealth", "Stealth");
		await charSheet.stageNestedRespecChoice("Skill Expert Skill Proficiency", "Deception", undefined, "nestedSkill");
		await charSheet.stageNestedRespecChoice("Skill Expert Expertise", "Deception", undefined, "nestedExpertise");
		await charSheet.closeRespecLevelEditor();
		await charSheet.applyRespecDraft();
		await charSheet.reloadCharacterSheet();
		const reloaded = await charSheet.getLevelFeatSkillRespecSnapshot();
		expect(reloaded.live.skills).toEqual(staged.draft.skills);
		expect(reloaded.children).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "nestedSkill", selection: ["deception"], status: "resolved"}),
			expect.objectContaining({type: "nestedExpertise", selection: ["deception"], status: "resolved"}),
		]));
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

	test("stages a Barbarian named-bonus Specialty without losing an unattributed overlap", async ({page}) => {
		test.slow();
		await gotoWithThelemar(page);
		const charSheet = new CharacterSheetPage(page);
		await charSheet.btnNew.click();
		await charSheet.prepareBarbarianSpecialtyRespecFixture();
		await charSheet.openRespec();
		const before = await charSheet.getBarbarianSpecialtyRespecSnapshot();
		expect(before.live).toEqual({might: 5, athletics: 6, acrobatics: 5, choice: "Lead the Pack"});
		expect(before.draft).toEqual(before.live);
		expect(before.namedBonusChildren).toBe(0);

		await charSheet.stageRespecFeatureChoice("Specialties", "Path of Drowning Springs", 6);
		await charSheet.closeRespecLevelEditor();
		const staged = await charSheet.getBarbarianSpecialtyRespecSnapshot();
		expect(staged.live).toEqual(before.live);
		expect(staged.draft).toEqual({might: 5, athletics: 3, acrobatics: 2, choice: "Path of Drowning Springs"});
		expect(staged.namedBonusChildren).toBe(0);
		expect(staged.warnings).toEqual(expect.arrayContaining([
			expect.stringContaining('unattributed "Lead the Pack" bonus to athletics'),
		]));
		expect(await charSheet.rollFixedSkillCheck("athletics", true)).toBe(13);
		expect(await charSheet.rollFixedSkillCheck("athletics")).toBe(16);
		expect(await charSheet.getRespecReviewText()).toContain("Review this named modifier after applying Respec");

		await charSheet.cancelRespecDraft();
		const cancelled = await charSheet.getBarbarianSpecialtyRespecSnapshot();
		expect(cancelled.live).toEqual(before.live);
		expect(cancelled.draft).toEqual(before.live);
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
