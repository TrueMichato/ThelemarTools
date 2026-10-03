import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, levelUpTo, PRESET_FIGHTER} from "../utils/characterBuilder";
import {LevelUpPage} from "../pages/LevelUpPage";
import {FeatAbilityChoicesPage} from "../pages/FeatAbilityChoicesPage";
import {AbilityScoreBreakdownPage} from "../pages/AbilityScoreBreakdownPage";

test.use({hasTouch: true});
const preset = {
	...PRESET_FIGHTER, name: "Ability Provenance", classSource: "PHB'24",
	race: "Dwarf", raceSource: "PHB'24", background: "Soldier", bgSource: "PHB'24",
	prioritySources: ["XPHB", "PHB"], selectBackgroundAbilityBonuses: true, optFeatCount: 0,
};

test("real ordinary ASIs have separate legacy disclosure rows without invented numeric credit", async ({page}) => {
	test.setTimeout(180_000);
	await clearCharacterStorage(page);
	const {charSheet} = await createCharacterViaWizard(page, preset);
	await charSheet.setStateSetting("thelemar_asiFeat", false);
	await levelUpTo(page, 6, {subclassName: "Champion", subclassSource: "PHB'24"});
	const probe = new AbilityScoreBreakdownPage(page);
	const evidence = await probe.evidence("str");
	const rows = evidence.breakdown.components.filter(c => c.source === "acquisition");
	expect(rows).toHaveLength(2);
	expect(rows.map(c => c.label)).toEqual([
		expect.stringContaining("Fighter [XPHB] level 4"),
		expect.stringContaining("Fighter [XPHB] level 6"),
	]);
	expect(rows.map(c => c.amount)).toEqual([null, null]);
	expect(evidence.breakdown.components[0].amount).toBe(evidence.rawBase);
	expect(evidence.breakdown.components.reduce((sum, c) => sum + (c.amount || 0), 0)).toBe(evidence.breakdown.total);
	await probe.startRollSpy();
	const detail = await probe.inspect("compact", "str", "hover");
	expect(detail.filter(row => row.includes("Applied amount unknown"))).toHaveLength(2);
	await probe.close("compact", "str");
	await charSheet.switchToTab(charSheet.tabAbilities);
	expect(await probe.inspect("hero", "str", "keyboard")).toEqual(detail);
	await probe.close("hero", "str");
	expect(await probe.rollCount()).toBe(0);
	await charSheet.reloadCharacterSheet();
	expect((await probe.evidence("str")).breakdown).toEqual(evidence.breakdown);
});

test("real repeated scalar/split feat gains, capped gain, score hover/focus/touch, rerender and reload", async ({page}, testInfo) => {
	test.setTimeout(180_000);
	await clearCharacterStorage(page);
	const {charSheet} = await createCharacterViaWizard(page, preset);
	await charSheet.setStateSetting("thelemar_asiFeat", false);
	await levelUpTo(page, 3, {subclassName: "Champion", subclassSource: "PHB'24"});
	const probe = new AbilityScoreBreakdownPage(page);
	await charSheet.switchToTab(charSheet.tabOverview);
	await probe.editBase("str", 19);
	const levelUp = new LevelUpPage(page);
	await charSheet.beginLevelUp();
	await levelUp.waitForModal();
	await levelUp.selectAsiFeat();
	await levelUp.setFeatAbilityMode(0);
	await levelUp.pickFeatAbility("str");
	await levelUp.autoFillAllSelections();
	await levelUp.finish();
	await charSheet.expectLevel(4);
	await charSheet.switchToTab(charSheet.tabOverview);
	await probe.editBase("str", 19);
	await charSheet.switchToTab(charSheet.tabFeatures);
	await new FeatAbilityChoicesPage(page).freeAddSplitFeat(["str", "dex"]);
	const evidence = await probe.evidence("str");
	const acquisitions = evidence.breakdown.components.filter(c => c.source === "featAcquisition");
	expect(acquisitions.map(c => c.amount)).toEqual([1, 1]);
	expect(new Set(acquisitions.map(c => c.label)).size).toBe(2);
	expect(evidence.breakdown.components[0].amount).toBe(18);
	await charSheet.switchToTab(charSheet.tabOverview);
	await probe.startRollSpy();
	const detail = await probe.inspect("compact", "str", "hover");
	expect(detail.some(row => row.includes(acquisitions[0].label) && row.endsWith("+1"))).toBe(true);
	expect(detail.some(row => row.includes(acquisitions[1].label) && row.endsWith("+1"))).toBe(true);
	await probe.snapshot(testInfo.outputPath("ability-score-desktop.png"));
	await probe.close("compact", "str");
	await charSheet.switchToTab(charSheet.tabAbilities);
	const beforeInspection = await probe.evidence("str");
	expect(await probe.inspect("hero", "str", "keyboard")).toEqual(detail);
	await probe.close("hero", "str");
	await page.setViewportSize({width: 390, height: 844});
	await probe.setNightMode();
	expect(await probe.inspect("hero", "str", "touch")).toEqual(detail);
	await probe.snapshot(testInfo.outputPath("ability-score-mobile.png"));
	await probe.close("hero", "str");
	expect((await probe.evidence("str")).json).toEqual(beforeInspection.json);
	await probe.rerender();
	expect((await probe.evidence("str")).breakdown).toEqual(evidence.breakdown);
	await page.setViewportSize({width: 1280, height: 720});
	await charSheet.enterPlayMode();
	await page.setViewportSize({width: 390, height: 844});
	expect(await probe.inspect("play", "str", "touch")).toEqual(detail);
	await probe.close("play", "str");
	expect(await probe.rollCount()).toBe(0);
	await page.setViewportSize({width: 1280, height: 720});
	await charSheet.exitPlayMode();
	await charSheet.reloadCharacterSheet();
	expect((await probe.evidence("str")).breakdown).toEqual(evidence.breakdown);
	await charSheet.switchToTab(charSheet.tabAbilities);
	await page.setViewportSize({width: 390, height: 844});
	expect(await probe.inspect("hero", "str", "touch")).toEqual(detail);
	await probe.close("hero", "str");
	await probe.startRollSpy();
	await probe.clickCheck();
	expect(await probe.rollCount()).toBe(1);
});
