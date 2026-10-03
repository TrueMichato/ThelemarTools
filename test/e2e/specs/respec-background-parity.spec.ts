import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";
import {gotoWithThelemar} from "../utils/homebrewLoader";
import {RespecBackgroundPage} from "../pages/RespecBackgroundPage";

function withoutGeneratedEffectIds (snapshot: object) {
	return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [
		key,
		["modifiers", "namedModifiers", "resources"].includes(key) && Array.isArray(value)
			? value.map(({id: _generatedId, ...effect}) => effect)
			: key === "modifiers" && value && typeof value === "object"
				? Object.fromEntries(Object.entries(value).filter(([, amount]) => amount != null && amount !== 0))
			: value,
	]));
}

test("real PHB background replacement completes all choices and preserves cancel, save, reload and undo", async ({page}) => {
	test.setTimeout(150_000);
	await clearCharacterStorage(page);
	await gotoWithThelemar(page);
	const {charSheet} = await createCharacterViaWizard(page, {
		...PRESET_FIGHTER, name: "Background Parity", race: "Dwarf", raceSource: "PHB'24",
		classSource: "PHB", masteryCount: 0, optFeatCount: 0,
		background: "Criminal", bgSource: "PHB", prioritySources: ["PHB", "XPHB"],
		selectBackgroundAbilityBonuses: true,
	});
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const background = new RespecBackgroundPage(page);
	const original = await background.evidence();
	await charSheet.openRespecBackgroundEditor();
	await background.select("Acolyte", "PHB");
	await background.completeMissing();
	await background.cancel();
	expect((await background.evidence()).live).toEqual(original.live);
	expect((await background.evidence()).draft).toEqual(original.draft);
	await charSheet.openRespecBackgroundEditor();
	await background.select("Acolyte", "PHB");
	await background.choose("nestedLanguage", ["Dwarvish", "Gnomish"]);
	await background.commit();
	const staged = await background.evidence();
	expect(staged.live).toEqual(original.live);
	expect(staged.draft.background).toMatchObject({name: "Acolyte", source: "PHB"});
	expect(staged.draft.skillProficiencies).toMatchObject({insight: 1, religion: 1});
	expect(staged.draft.languages).toEqual(expect.arrayContaining(["Dwarvish", "Gnomish"]));
	expect(staged.draft.abilityBonuses).toEqual(original.live.abilityBonuses);
	expect(staged.validation.errors).toEqual([]);
	await charSheet.applyRespecDraft();
	await background.undo();
	expect(withoutGeneratedEffectIds((await background.evidence()).live)).toEqual(withoutGeneratedEffectIds(original.live));
	await charSheet.openRespecBackgroundEditor();
	await background.select("Acolyte", "PHB");
	await background.choose("nestedLanguage", ["Dwarvish", "Gnomish"]);
	await background.commit();
	await charSheet.applyRespecDraft();
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const loaded = await background.evidence();
	expect(loaded.live.background).toMatchObject({name: "Acolyte", source: "PHB"});
	expect(loaded.live.languages).toEqual(expect.arrayContaining(["Dwarvish", "Gnomish"]));
	expect(loaded.validation.errors).toEqual([]);
});
