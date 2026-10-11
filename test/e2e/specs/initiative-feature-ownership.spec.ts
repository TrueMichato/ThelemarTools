import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, levelUpTo} from "../utils/characterBuilder";
import {InitiativeFeatureOwnershipPage} from "../pages/InitiativeFeatureOwnershipPage";

test("real Chronurgy acquisition counts INT once through ability edits, actual rolls and two saved reloads", async ({page}) => {
	test.setTimeout(150_000);
	await clearCharacterStorage(page);
	const initiative = new InitiativeFeatureOwnershipPage(page);
	await initiative.openLocalCatalog();
	const {charSheet} = await createCharacterViaWizard(page, {
		name: "Initiative Ownership", className: "Wizard", classSource: "PHB",
		race: "Dwarf", raceSource: "PHB'24", background: "Criminal", bgSource: "PHB",
		prioritySources: ["PHB", "XPHB", "EGW"],
		abilityPriority: ["int", "dex", "con", "wis", "cha", "str"],
		skillCount: 2, optFeatCount: 1,
	});
	await levelUpTo(page, 2, {subclassName: "Chronurgy Magic", subclassSource: "EGW"});
	await initiative.editIntelligence(16);
	const featureId = await initiative.assertTemporalAwareness(3);
	await initiative.rollAndAssert();
	for (const [base, modifier] of [[10, 0], [8, -1]]) {
		await initiative.editIntelligence(base);
		expect(await initiative.assertTemporalAwareness(modifier)).toBe(featureId);
		await initiative.save();
		await charSheet.reloadCharacterSheet();
		expect(await initiative.assertTemporalAwareness(modifier)).toBe(featureId);
		await initiative.rollAndAssert();
	}
});
