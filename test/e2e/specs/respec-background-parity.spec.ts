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

test("real XPHB Sage replaces a free pair with weighted abilities and the canonical Wizard feat's required spell choices", async ({page}, testInfo) => {
	test.setTimeout(150_000);
	await clearCharacterStorage(page);
	await gotoWithThelemar(page);
	const {charSheet} = await createCharacterViaWizard(page, {
		...PRESET_FIGHTER, name: "Sage Background Parity", race: "Dwarf", raceSource: "PHB'24",
		classSource: "PHB", masteryCount: 0, optFeatCount: 0,
		background: "Criminal", bgSource: "PHB", prioritySources: ["PHB", "XPHB"],
		selectBackgroundAbilityBonuses: true,
	});
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const background = new RespecBackgroundPage(page);
	const original = await background.evidence();
	await charSheet.openRespecBackgroundEditor();
	await background.select("Sage", "XPHB");
	await background.choose("nestedConfiguration", ["+2/+1"]);
	await background.choose("nestedAbility", ["Intelligence"], 0);
	await background.choose("nestedAbility", ["Wisdom"], 1);
	await background.completeMissing();
	await background.commit();
	const staged = await background.evidence();
	expect(staged.live).toEqual(original.live);
	expect(staged.draft.background).toMatchObject({name: "Sage", source: "XPHB"});
	expect(staged.draft.abilities).toEqual(original.live.abilities);
	expect(staged.draft.abilityBonuses).toMatchObject({str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0});
	expect(staged.draft.skillProficiencies).toMatchObject({arcana: 1, history: 1});
	expect(staged.draft.toolProficiencies).toContain("Calligrapher's Supplies");
	expect(staged.draft.feats).toContainEqual(expect.objectContaining({name: "Magic Initiate; Wizard", source: "XPHB"}));
	const spellDecisions = staged.draft.characterBase.decisions.filter(decision => ["nestedCantrip", "nestedSpell"].includes(decision.type));
	expect(spellDecisions).toHaveLength(2);
	expect(spellDecisions.every(decision => decision.status === "resolved")).toBe(true);
	const grantedCantrips = staged.draft.spellcasting.cantripsKnown.filter(spell => spell.sourceFeature === "Magic Initiate; Wizard");
	expect(grantedCantrips).toHaveLength(2);
	expect(grantedCantrips.map(spell => ({name: spell.name, source: spell.source}))).toEqual([
		{name: "Acid Splash", source: "XPHB"}, {name: "Blade Ward", source: "XPHB"},
	]);
	expect(grantedCantrips.every(spell => spell.spellcastingAbility === "int")).toBe(true);
	expect(staged.draftInnateSpells).toEqual([expect.objectContaining({
		name: "Alarm", source: "XPHB", spellcastingAbility: "int", uses: {current: 1, max: 1}, recharge: "long",
	})]);
	expect(staged.draft.pendingSpellChoices).toEqual([]);
	expect(staged.validation.errors).toEqual([]);
	await page.screenshot({path: testInfo.outputPath("sage-staged.png"), fullPage: true});
	await charSheet.applyRespecDraft();
	await background.undo();
	expect(withoutGeneratedEffectIds((await background.evidence()).live)).toEqual(withoutGeneratedEffectIds(original.live));
	await charSheet.openRespecBackgroundEditor();
	await background.select("Sage", "XPHB");
	await background.choose("nestedConfiguration", ["+2/+1"]);
	await background.choose("nestedAbility", ["Intelligence"], 0);
	await background.choose("nestedAbility", ["Wisdom"], 1);
	await background.completeMissing();
	await background.commit();
	await charSheet.applyRespecDraft();
	const applied = await background.evidence();
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const loaded = await background.evidence();
	expect(loaded.live.background).toMatchObject({name: "Sage", source: "XPHB"});
	expect(loaded.live.feats).toEqual(JSON.parse(JSON.stringify(applied.live.feats)));
	expect(loaded.live.abilityBonuses).toEqual(staged.draft.abilityBonuses);
	expect(loaded.liveInnateSpells).toEqual(applied.liveInnateSpells);
	expect(loaded.live.spellcasting.cantripsKnown).toEqual(applied.live.spellcasting.cantripsKnown);
	expect(loaded.live.pendingSpellChoices).toEqual([]);
	expect(loaded.validation.errors).toEqual([]);
});
