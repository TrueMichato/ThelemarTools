import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, levelUpTo, PRESET_FIGHTER} from "../utils/characterBuilder";
import {LevelUpPage} from "../pages/LevelUpPage";
import {FeatAbilityChoicesPage} from "../pages/FeatAbilityChoicesPage";

for (const mode of [0, 1] as const) {
	test(`XPHB ASI feat mode ${mode}: real wizard, exclusive choices, effects and reload`, async ({page}) => {
		test.setTimeout(180_000);
		await clearCharacterStorage(page);
		const {charSheet, builder} = await createCharacterViaWizard(page, {
			...PRESET_FIGHTER,
			name: `ASI Mode ${mode}`,
			classSource: "PHB'24",
			race: "Dwarf",
			raceSource: "PHB'24",
			background: "Soldier",
			bgSource: "PHB'24",
			prioritySources: ["XPHB", "PHB"],
			selectBackgroundAbilityBonuses: true,
			optFeatCount: 0,
		});
		const probe = new FeatAbilityChoicesPage(page);
		await charSheet.setStateSetting("thelemar_asiFeat", false);
		await levelUpTo(page, 3, {subclassName: "Champion", subclassSource: "PHB'24"});
		const before = await probe.evidence();
		expect(before.classes).toEqual([expect.objectContaining({name: "Fighter", source: "XPHB", level: 3})]);
		const levelUp = new LevelUpPage(page);
		await charSheet.beginLevelUp();
		await levelUp.waitForModal();
		await levelUp.selectAsiFeat();
		await levelUp.setFeatAbilityMode(1);
		await levelUp.pickFeatAbility("str");
		await levelUp.expectFeatAbilitySelection(["str"]);
		await levelUp.pickFeatAbility("str");
		await levelUp.expectFeatAbilitySelection([]);
		await levelUp.pickFeatAbility("str");
		await levelUp.expectIncompleteFeatCannotFinish();
		await levelUp.setFeatAbilityMode(0);
		await levelUp.expectFeatAbilitySelection([]);
		await levelUp.setFeatAbilityMode(mode);
		await levelUp.pickFeatAbility("str");
		if (mode === 1) await builder.autoFillRemainingSelections();
		await levelUp.autoFillAllSelections();
		await levelUp.expectFeatAbilitySelection(mode === 0 ? ["str"] : ["str", "dex"]);
		await levelUp.finish();
		await charSheet.expectLevel(4);
		const after = await probe.evidence();
		expect(after.feats).toHaveLength(1);
		expect(after.feats[0].choices).toMatchObject(mode === 0
			? {ability: "str", abilityOption: 0}
			: {ability: {str: 1, dex: 1}, abilityOption: 1});
		expect(after.feats[0].appliedEffects?.abilityDeltas).toEqual(mode === 0 ? {str: 2} : {str: 1, dex: 1});
		expect(after.scores.str - before.scores.str).toBe(mode === 0 ? 2 : 1);
		expect(after.scores.dex - before.scores.dex).toBe(mode === 0 ? 0 : 1);
		expect(after.history.find(entry => entry.level === 4)?.choices).toMatchObject({
			feat: {name: "Ability Score Improvement", source: "XPHB"},
		});
		expect(after.history.find(entry => entry.level === 4)?.choices).not.toHaveProperty("asi");
		expect(await probe.historicalScores(3)).toEqual(before.effectiveScores);
		await charSheet.reloadCharacterSheet();
		const reloaded = await probe.evidence();
		expect(reloaded.feats).toEqual(after.feats);
		expect(reloaded.scores).toEqual(after.scores);
		if (mode === 1) {
			await charSheet.switchToTab(charSheet.tabFeatures);
			await probe.freeAddSplitFeat(["con", "wis"]);
			const repeated = await probe.evidence();
			expect(repeated.feats).toHaveLength(2);
			expect(repeated.feats[0]).toEqual(after.feats[0]);
			expect(repeated.feats[1].appliedEffects?.abilityDeltas).toEqual({con: 1, wis: 1});
			expect(repeated.feats[1].sourceDecisionKey).not.toBe(after.feats[0].sourceDecisionKey);
			expect(repeated.scores.con - after.scores.con).toBe(1);
			expect(repeated.scores.wis - after.scores.wis).toBe(1);
			await charSheet.reloadCharacterSheet();
			const loadedRepeat = await probe.evidence();
			expect(loadedRepeat.feats).toEqual(repeated.feats);
			expect(loadedRepeat.scores).toEqual(repeated.scores);
		}
	});
}
